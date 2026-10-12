/* ============================================================
   core/farcull.js — distance culling for the static city.

   WHY: at low quality tiers the fog is pulled in hard (quality.js
   publishes CBZ.cityFogFar), so everything beyond fog.far renders as a
   fully fog-coloured silhouette — invisible, yet still fully drawn.
   Frustum culling can't reject what's IN FRONT of the camera, and the
   glass/emissive window meshes can't be batch-merged (they shatter
   individually), so a distant tower still costs hundreds of draw calls
   to paint pure fog. This module hides whole top-level city groups
   (building shells + their windows + towns + islands) once they sit
   entirely past the full-detail radius. Real lot buildings continue through
   the atmospheric range as the measured instanced LOD below; only their
   unseen panes/interiors are removed (see core/quality.js's QUALITY table).

   SAFETY RULES (why this can't break gameplay):
     • visible=false does NOT affect r128 raycasts (LOS keeps hitting),
       colliders read rects, so physics/AI are untouched — the exact
       fact the wall-batch pass (core/batch.js) is built on.
     • We only ever RE-SHOW groups WE hid (own WeakSet). A group some
       other system hid (demolition's batchHideGroup companion
       b.group.visible=false, mode roots…) is skipped entirely, so we
       never resurrect a demolished building.
     • Anything dynamic is skipped: userData.dynamic subtrees, the
       named crowd root, and any group whose position moves between
       sweeps gets permanently blacklisted from culling.
     • Bounds are cached once per group (radius from a one-time Box3);
       the 4Hz sweep is a flat distance test per top-level child.
   Flag: CBZ.CONFIG.CITY_FAR_CULL (default ON). Flip false → every
   group this module hid is restored on the next sweep and it goes idle.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.CONFIG && CBZ.CONFIG.CITY_FAR_CULL == null) CBZ.CONFIG.CITY_FAR_CULL = true;

  const hidByUs = new Set();        // groups WE set visible=false on
  // a group this sweep just showed again (the drive test's pop census counts
  // these as LOD handoffs, not as something built in view)
  const shownAt = new WeakMap();
  CBZ.farcullShownAt = function (o) { return shownAt.get(o) || 0; };
  /* GPU EVICTION (owner, 2026-09-29: "when I drive the car ... the screen just
     goes to dark navy": iOS dropping the context under GPU memory). Everything
     a drive passes used to stay on the GPU for the rest of the session. A
     group we hid that is also EVICT metres past the cull radius gives its
     vertex buffers back (geometry.dispose(): three uploads them again, from
     the arrays it keeps, the next time the group is drawn, which is the cull
     radius, inside the fog). Only geometry marked _evictable (core/batch.js's
     merged meshes: each owned by exactly one mesh) and only while its CPU
     arrays are there to bring it back. */
  const EVICT = 220;
  const evicted = new WeakSet();
  const _evStats = { groups: 0, geos: 0 };
  CBZ.farcullEvictStats = _evStats;
  function evict(o) {
    evicted.add(o); _evStats.groups++;
    o.traverse(function (c) {
      if (!c.isMesh || c.isInstancedMesh) return;
      const g = c.geometry;
      if (!g || !g._evictable || !g.attributes || !g.attributes.position) return;
      if (!g.attributes.position._cbzUploaded) return;          // never on the GPU
      if (CBZ.geoReuploadable && !CBZ.geoReuploadable(g)) {
        // GPU-ONLY (its arrays were dropped after upload): read back ASYNC
        // (core/batch.js: fenced, one per frame), packed, then released
        if (!CBZ.batchQueueEvict) return;
        CBZ.batchQueueEvict(g, function () { return evicted.has(o) && o.visible === false; }, function () {
          if (CBZ.geoCompactOwned) CBZ.geoCompactOwned(g);
          g.dispose();
          for (const k in g.attributes) g.attributes[k]._cbzUploaded = false;
          if (g.index) g.index._cbzUploaded = false;
          _evStats.readback = (_evStats.readback || 0) + 1;
        });
        return;
      }
      g.dispose();
      for (const k in g.attributes) g.attributes[k]._cbzUploaded = false;
      if (g.index) g.index._cbzUploaded = false;
      _evStats.geos++;
    });
  }
  const bounds = new WeakMap();     // group -> {x,z,r,px,pz,dynamic}
  const _box = new THREE.Box3();
  const _v = new THREE.Vector3();

  /* ---- HYSTERESIS THAT OUTRUNS THE VIEWER --------------------------------
     The show/hide band was a flat literal 20 u, and the sweep's own comment
     names the assumption it was sized against: "4Hz is plenty for walking/
     driving speeds". Two facts make that false in an aircraft, and the
     aircraft is what is new:
       • the sweep is AMORTIZED — at most a quarter of the root's children are
         tested per 250 ms tick, so any ONE object is re-tested about once a
         SECOND, not four times;
       • a plane covers 90-200 m in that second — 4.5 to 10 times the entire
         20 u band.
     So an object can cross the whole band between two consecutive tests of
     itself and toggle on every test: hide, show, hide. That is the flicker,
     it only appears at flight speed, and no amount of tuning a CONSTANT fixes
     it — the band has to be DERIVED from how far the viewer travels between
     two looks at the same object. 1.5x that distance, floored at the original
     20 u so a standing player behaves exactly as before. Widening the band
     only ever keeps things visible LONGER, which is the safe direction.
  ------------------------------------------------------------------------ */
  let _spd = 0, _lastPX = null, _lastPZ = 0, _lastSpdT = 0, _retest = 1;
  function hysBand() { return Math.max(20, _spd * _retest * 1.5); }
  function trackViewer(P, now, kids, slice) {
    // objects per sweep vs. objects total = how many 250 ms ticks until this
    // one comes round again. Measured from the live sweep, never assumed.
    _retest = (slice > 0 && kids > 0) ? Math.max(0.25, (kids / slice) * 0.25) : 1;
    if (!P) { _spd = 0; _lastPX = null; return; }
    if (_lastPX == null) { _lastPX = P.x; _lastPZ = P.z; _lastSpdT = now; return; }
    const dt = (now - _lastSpdT) / 1000;
    if (dt <= 0) return;
    const v = Math.hypot(P.x - _lastPX, P.z - _lastPZ) / dt;
    // rise fast (a launch must widen the band immediately), fall slow (landing
    // must not snap the band shut while things are still mid-band).
    _spd = v > _spd ? v : _spd + (v - _spd) * 0.25;
    _lastPX = P.x; _lastPZ = P.z; _lastSpdT = now;
  }

  // ---- THE FAR SKYLINE: EVERY BUILDING, BUILT OR NOT --------------------
  // One box per real building, instanced in ONE draw, painted with that
  // building's own wall colour and its own window rhythm (below). It is the
  // far form of a shell, the way a metro tile has its far HLOD:
  //   • a shell that is in the scene draws itself out to the fog's end and
  //     its box stands in past it (the sweep's radius);
  //   • a shell that is NOT in the scene (the streamer has not built its
  //     job yet, parked it or freed it) is drawn by its box at every
  //     distance, so a town seen from a helicopter is a town, never bare
  //     ground that a town then assembles on (owner 2026-10-11: "I don't like
  //     things spawning in view").
  // WHERE THE RECORDS COME FROM, best first:
  //   live   a shell that was built this session (root.userData.shells,
  //          every cityMakeBuilding; lots for the demolished flag);
  //   lot    a lot whose shell is deferred to a streamer job (buildings.js
  //          streamed apartment blocks, towngen parcels): footprint, height
  //          and sign colour are decided before the shell exists;
  //   baked  what earlier visits measured, kept in core/bakecache.js under a
  //          signature of the seed + every script that shapes a building, so
  //          a skipped builder (a minicity, a country town, an estate) has
  //          its skyline from the first frame. A first visit after such a
  //          change measures it once at load (core/citystream.js census).
  // A record is matched to its shell by position (4 m grid, best source
  // wins), never by identity, so the baked box and the built shell of one
  // building are one record.
  let proxyArena = null, proxyMesh = null, proxyRecords = [], proxyCap = 0;
  const winU = { uWinNight: { value: 0 } };
  const proxyDummy = new THREE.Object3D();
  const proxyColor = new THREE.Color();
  const RANK = { baked: 1, lot: 2, live: 3 };
  const recGrid = new Map();
  let recArena = null;
  let scanned = { lots: -1, shells: -1, annex: -1 }, recsDirty = false, lastRebuild = 0, bakeLoaded = false, bakeDirtyAt = 0;
  const FAR_BAKE = "far-skyline";
  const SHAPING = /\/(buildings|towngen|minicities|countries|settlements|citytemplates|facade_[a-z]+|govcomplex|island_[a-z]+|airport[a-z_]*|biome_[a-z]+|estate[a-z_]*|metroplan|worldmap|layout|expansion|plots)\.js/;
  let _farSig = null;
  function farSig() {
    if (_farSig) return _farSig;
    let s = "farsky1";
    if (typeof document !== "undefined" && document.getElementsByTagName) {
      const tags = document.getElementsByTagName("script");
      for (let i = 0; i < tags.length; i++) { const src = tags[i].getAttribute("src") || ""; if (SHAPING.test(src)) s += "|" + src.replace(/^.*\/src\//, ""); }
    }
    return (_farSig = CBZ.bakeSig ? CBZ.bakeSig(s) : s);
  }
  function gk(x, z) { return Math.round(x / 4) + "," + Math.round(z / 4); }
  function findRec(x, z) {
    const ix = Math.round(x / 4), iz = Math.round(z / 4);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const r = recGrid.get((ix + a) + "," + (iz + b));
      if (r && Math.abs(r.x - x) < 3 && Math.abs(r.z - z) < 3) return r;
    }
    return null;
  }
  function hexOf(wc) {
    if (wc && wc.isColor) return wc.getHex();
    if (typeof wc === "number" && isFinite(wc)) return wc & 0xffffff;
    if (typeof wc === "string") { try { return proxyColor.set(wc).getHex(); } catch (_) {} }
    return 0x8a8a86;
  }
  // the window rhythm a far box paints: the shell's own (FO.pattern), or for
  // a shell not cut yet the street's typical punched rhythm (a bay ~3.4 m,
  // 45 % glazed, sill 0.9 / head 2.2 in a 3.2 m storey)
  function winOf(P, w, d, h) {
    const f = new Float32Array(12);
    if (P && P.faces) {
      const pair = function (A, B, span, o) {
        const L = [A, B].filter(function (q) { return q && q.n > 0 && q.t1 > q.t0; });
        if (!L.length) return;
        let n = 0, t0 = 0, t1 = 0, fr = 0;
        for (const q of L) { n += q.n; t0 += q.t0; t1 += q.t1; fr += q.frac * span / Math.max(0.1, q.t1 - q.t0); }
        n /= L.length; t0 /= L.length; t1 /= L.length; fr /= L.length;
        f[o] = Math.max(1, Math.round(n)); f[o + 1] = Math.min(0.98, fr);
        f[8 + o] = (t0 + span / 2) / span; f[8 + o + 1] = (t1 + span / 2) / span;
      };
      pair(P.faces[0], P.faces[1], w, 0);
      pair(P.faces[2], P.faces[3], d, 2);
      let sl = 0, hd = 0, c = 0;
      for (const q of P.faces) if (q && q.n > 0) { sl += q.sill; hd += q.head; c++; }
      f[4] = c ? sl / c : 0; f[5] = c ? hd / c : 0; f[6] = c ? (P.fh || 3.2) : 0; f[7] = P.storeys || 1;
      return f;
    }
    const fh = 3.2;
    f[0] = Math.max(1, Math.round((w - 2) / 3.4)); f[1] = 0.45; f[2] = Math.max(1, Math.round((d - 2) / 3.4)); f[3] = 0.45;
    f[4] = 0.9; f[5] = 2.2; f[6] = fh; f[7] = Math.max(1, Math.round(h / fh));
    f[8] = 1 / w; f[9] = 1 - 1 / w; f[10] = 1 / d; f[11] = 1 - 1 / d;
    return f;
  }
  function putRec(rec) {
    const old = findRec(rec.x, rec.z);
    if (old) {
      if (RANK[old.src] > RANK[rec.src]) return false;
      if (old.src === rec.src && old.grp === rec.grp && old.lot === rec.lot && old.h === rec.h) return false;
      recGrid.delete(old.key);
    }
    rec.key = gk(rec.x, rec.z); rec.shown = false;
    recGrid.set(rec.key, rec);
    recsDirty = true;
    return true;
  }
  function groundAt(A, x, z) {
    try { if (A && A.groundHeightAt) { const y = A.groundHeightAt(x, z); if (isFinite(y)) return y; } } catch (e) {}
    return 0;
  }
  // harvest what the arena holds now (cheap: only when a list grew)
  function harvest(A, force) {
    if (!A || !A.root) return;
    // a rebuilt city is a new arena: its records start over
    if (A !== recArena) { recArena = A; recGrid.clear(); scanned = { lots: -1, shells: -1, annex: -1 }; bakeLoaded = false; }
    // (read once the bake has landed: a read before that would miss it)
    if (!bakeLoaded && !(CBZ.bakeStats && !CBZ.bakeStats.ready)) {
      bakeLoaded = true;
      const hit = CBZ.bakeGet ? CBZ.bakeGet(FAR_BAKE, farSig()) : null;
      const F = hit && hit.f;
      if (F) for (let i = 0; i + 20 <= F.length; i += 20) {
        putRec({ src: "baked", grp: null, lot: null, x: F[i], z: F[i + 1], y: F[i + 2], w: F[i + 3], d: F[i + 4], h: F[i + 5],
          col: F[i + 6] | 0, win: F.slice(i + 7, i + 19), r: Math.hypot(F[i + 3], F[i + 4]) * 0.5 });
      }
    }
    let lots = A.lots || [];
    const annex = A.annex && Array.isArray(A.annex.lots) ? A.annex.lots : null;
    const shells = (A.root.userData && A.root.userData.shells) || [];
    if (!force && scanned.lots === lots.length && scanned.shells === shells.length && scanned.annex === (annex ? annex.length : 0)) return;
    scanned = { lots: lots.length, shells: shells.length, annex: annex ? annex.length : 0 };
    if (annex && annex.length) lots = lots.concat(annex);
    const lotOfGroup = new Map();
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i], b = lot && lot.building;
      if (!b || b.park) continue;
      if (b.group) { lotOfGroup.set(b.group, lot); continue; }
      // a deferred shell: its far box from the lot's own numbers
      const w = +b.w || +lot.w, d = +b.d || +lot.d, h = +b.h || (+b.storeys > 0 ? b.storeys * 3.2 : 0);
      if (!(w > 1 && d > 1 && h > 1)) continue;
      const x = +lot.cx, z = +lot.cz;
      if (!isFinite(x) || !isFinite(z)) continue;
      putRec({ src: "lot", grp: null, lot: lot, x: x, z: z, y: groundAt(A, x, z), w: w, d: d, h: h, col: hexOf(b.wallColor || b.sign), win: winOf(null, w, d, h), r: Math.hypot(w, d) * 0.5 });
    }
    const add = function (b, lot) {
      if (!b || b.park || !b.group) return;
      const w = +b.w, d = +b.d, h = +b.h;
      if (!(w > 1 && d > 1 && h > 1)) return;
      const x = Number.isFinite(b.ox) ? b.ox : ((lot && +lot.cx) || 0);
      const z = Number.isFinite(b.oz) ? b.oz : ((lot && +lot.cz) || 0);
      // buildings stand on the ground: the arena's own height there
      const y = Number.isFinite(b.oy) ? b.oy : groundAt(A, x, z);
      putRec({ src: "live", grp: b.group, lot: lot || lotOfGroup.get(b.group) || null, x: x, z: z, y: y, w: w, d: d, h: h, col: hexOf(b.wallColor), win: winOf(b.facadePattern, w, d, h), r: Math.hypot(w, d) * 0.5 });
    };
    for (let i = 0; i < lots.length; i++) if (lots[i] && lots[i].building && lots[i].building.group) add(lots[i].building, lots[i]);
    for (let i = 0; i < shells.length; i++) add(shells[i], null);
  }
  CBZ.farSkylineSig = farSig;
  CBZ.farSkylineSave = function () { bakeDirtyAt = 0; saveBake(); };
  CBZ.farSkylineHarvest = function () {
    const A = CBZ.city && CBZ.city.arena;
    harvest(A, true);
    bakeDirtyAt = performance.now();
    return recGrid.size;
  };
  function saveBake() {
    if (!CBZ.bakePut || !recGrid.size) return;
    const F = new Float32Array(recGrid.size * 20);
    let i = 0;
    recGrid.forEach(function (r) {
      F[i] = r.x; F[i + 1] = r.z; F[i + 2] = r.y; F[i + 3] = r.w; F[i + 4] = r.d; F[i + 5] = r.h; F[i + 6] = r.col;
      F.set(r.win, i + 7); i += 20;
    });
    CBZ.bakePut(FAR_BAKE, farSig(), { f: F });
  }

  function disposeProxy() {
    if (proxyMesh && proxyMesh.parent) proxyMesh.parent.remove(proxyMesh);
    if (proxyMesh && proxyMesh.geometry) proxyMesh.geometry.dispose();
    if (proxyMesh && proxyMesh.material) proxyMesh.material.dispose();
    proxyMesh = null; proxyRecords = []; proxyArena = null; proxyCap = 0;
  }

  let proxyMat = null;
  function farMaterial() {
    if (proxyMat) return proxyMat;
    // NO vertexColors: BoxGeometry has no `color` attribute, and r128 then
    // multiplies every instance colour by the attribute's default (0,0,0).
    // instanceColor needs no flag (USE_INSTANCING_COLOR is set by the mesh).
    /* THE SAME WINDOWS AT EVERY DISTANCE (owner: "near and far must look the
       same"). Every shell publishes the rhythm of the openings it actually cut
       (city/facade_openings.js FO.pattern: per face the openings per storey,
       the extent they occupy, the share of it they glaze, sill and head in
       the storey); the box paints exactly that rhythm per pixel: glass where
       the near shell has glass, wall where it has wall, lit rooms at night. */
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: true });
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uWinNight = winU.uWinNight;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 aWinA;\nattribute vec4 aWinB;\nattribute vec4 aWinC;\nattribute float aWinBase;\nvarying vec4 vWinA;\nvarying vec4 vWinB;\nvarying vec4 vWinC;\nvarying vec3 vWinT;")
        .replace("#include <project_vertex>", [
          "#include <project_vertex>",
          "vWinA = aWinA; vWinB = aWinB; vWinC = aWinC;",
          // across the face 0..1, metres above the building's own base, and
          // which way the face looks
          "vWinT = vec3( position.x + 0.5, ( instanceMatrix * vec4( position, 1.0 ) ).y - aWinBase, abs( normal.z ) > 0.5 ? 1.0 : ( abs( normal.x ) > 0.5 ? 2.0 : 0.0 ) );",
          "if ( vWinT.z > 1.5 ) vWinT.x = position.z + 0.5;",
        ].join("\n"));
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uWinNight;\nvarying vec4 vWinA;\nvarying vec4 vWinB;\nvarying vec4 vWinC;\nvarying vec3 vWinT;\nfloat winH( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }")
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "vec3 winEmit = vec3( 0.0 );",
          "if ( vWinB.z > 0.5 && vWinT.z > 0.5 ) {",
          "  bool xf = vWinT.z < 1.5;",
          "  float n = xf ? vWinA.x : vWinA.z, fr = xf ? vWinA.y : vWinA.w;",
          "  float a0 = xf ? vWinC.x : vWinC.z, a1 = xf ? vWinC.y : vWinC.w;",
          "  float tn = vWinT.x;",
          "  if ( n > 0.5 && tn > a0 && tn < a1 ) {",
          "    float fh = vWinB.z;",
          "    float k = floor( vWinT.y / fh ), cy = vWinT.y - k * fh;",
          "    float u = ( tn - a0 ) / max( 1e-3, a1 - a0 ) * n;",
          "    float bay = fract( u );",
          "    float win = step( abs( bay - 0.5 ), clamp( fr, 0.05, 0.98 ) * 0.5 ) * step( vWinB.x, cy ) * step( cy, vWinB.y ) * step( 0.0, k ) * step( k, vWinB.w - 1.0 );",
          "    if ( win > 0.5 ) {",
          "      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.15, 0.19, 0.23 ), 0.86 );",
          "      float h = winH( vec2( floor( u ) + vWinT.z * 31.0, k + n * 7.0 + a0 * 13.0 ) );",
          "      winEmit = vec3( 1.0, 0.78, 0.48 ) * step( h, 0.28 ) * uWinNight * 0.85;",
          "    }",
          "  }",
          "}",
        ].join("\n"))
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += winEmit;");
    };
    mat.customProgramCacheKey = function () { return "cbz-far-windows2"; };
    return (proxyMat = mat);
  }

  // (re)build the one instanced draw from the record set: when the set grew
  // past the mesh's capacity or its membership changed (at most once a second)
  function ensureProxy(A) {
    if (!A || !A.root || !THREE.InstancedMesh) return;
    if (proxyArena !== A) { disposeProxy(); proxyArena = A; }
    harvest(A, false);
    const now = performance.now();
    if (proxyMesh && !recsDirty) return;
    if (proxyMesh && now - lastRebuild < 1000) return;
    lastRebuild = now; recsDirty = false;
    if (bakeDirtyAt === 0) bakeDirtyAt = now;
    proxyRecords = Array.from(recGrid.values());
    const nP = proxyRecords.length;
    if (!nP) return;
    if (!proxyMesh || nP > proxyCap) {
      if (proxyMesh) { if (proxyMesh.parent) proxyMesh.parent.remove(proxyMesh); proxyMesh.geometry.dispose(); }
      proxyCap = Math.max(64, Math.ceil(nP * 1.25));
      const geo = new THREE.BoxGeometry(1, 1, 1);
      geo.setAttribute("aWinA", new THREE.InstancedBufferAttribute(new Float32Array(proxyCap * 4), 4));
      geo.setAttribute("aWinB", new THREE.InstancedBufferAttribute(new Float32Array(proxyCap * 4), 4));
      geo.setAttribute("aWinC", new THREE.InstancedBufferAttribute(new Float32Array(proxyCap * 4), 4));
      geo.setAttribute("aWinBase", new THREE.InstancedBufferAttribute(new Float32Array(proxyCap), 1));
      proxyMesh = new THREE.InstancedMesh(geo, farMaterial(), proxyCap);
      proxyMesh.name = "real-building-distance-lod";
      proxyMesh.userData.dynamic = true;       // batch/farcull must not consume its one draw
      proxyMesh.frustumCulled = false;          // prototype bounds do not span all instances in r128
      proxyMesh.castShadow = false; proxyMesh.receiveShadow = false;
      proxyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      proxyMesh.setColorAt(0, proxyColor.setHex(0x8a8a86));
      A.root.add(proxyMesh);
    }
    const g = proxyMesh.geometry;
    const wa = g.attributes.aWinA.array, wb = g.attributes.aWinB.array, wc = g.attributes.aWinC.array, base = g.attributes.aWinBase.array;
    for (let i = 0; i < nP; i++) {
      const r = proxyRecords[i];
      r.shown = false;
      wa.set(r.win.subarray(0, 4), i * 4); wb.set(r.win.subarray(4, 8), i * 4); wc.set(r.win.subarray(8, 12), i * 4);
      base[i] = r.y || 0;
      proxyDummy.position.set(r.x, -10000, r.z);
      proxyDummy.scale.set(0.001, 0.001, 0.001);
      proxyDummy.rotation.set(0, 0, 0); proxyDummy.updateMatrix();
      proxyMesh.setMatrixAt(i, proxyDummy.matrix);
      // THE BUILDING'S OWN WALL COLOUR (buildings.js `wallColor`, the final
      // colourway the shell was painted with), one colour at every distance
      proxyMesh.setColorAt(i, proxyColor.setHex(r.col));
    }
    proxyMesh.count = nP;
    g.attributes.aWinA.needsUpdate = g.attributes.aWinB.needsUpdate = g.attributes.aWinC.needsUpdate = g.attributes.aWinBase.needsUpdate = true;
    proxyMesh.instanceMatrix.needsUpdate = true;
    if (proxyMesh.instanceColor) proxyMesh.instanceColor.needsUpdate = true;
    CBZ.realBuildingLOD = { total: nP, visible: 0, drawCalls: 1, detailRadius: 0 };
  }

  // is the shell itself in the scene (so it can draw itself)?
  function inScene(grp, root) {
    let p = grp, n = 0;
    while (p && n++ < 12) { if (p === root) return true; p = p.parent; }
    return false;
  }
  function updateProxy(A, P, R) {
    ensureProxy(A);
    if (!proxyMesh || !P) return;
    const root = A.root;
    let dirty = false, visible = 0;
    // The box must ALWAYS be up before its shell goes down, so it reads the
    // same derived band the shell sweep uses — never its own literal.
    const enter = Math.max(0, R - hysBand()); // overlap while inset: the box is hidden inside the full shell
    for (let i = 0; i < proxyRecords.length; i++) {
      const r = proxyRecords[i];
      const d = Math.hypot(r.x - P.x, r.z - P.z) - r.r;
      // r.lot is null for a shell that never registered a lot (govcomplex, the
      // military island, the airport terminal, forest cabins) — and those are
      // precisely the ones demolition never touches, since it walks city.lots.
      const own = !!(r.grp && inScene(r.grp, root));
      const show = !(r.lot && r.lot.demolished) && (!own || (!!R && d > enter));
      if (show) visible++;
      if (show === r.shown) continue;
      r.shown = show; dirty = true;
      if (show) {
        // A slight inset makes the transition overlap depth-safe: while the
        // detailed shell still exists, it fully covers this box.
        proxyDummy.position.set(r.x, (r.y || 0) + r.h * 0.49, r.z);
        proxyDummy.scale.set(r.w * 0.92, r.h * 0.98, r.d * 0.92);
      } else {
        proxyDummy.position.set(r.x, -10000, r.z);
        proxyDummy.scale.set(0.001, 0.001, 0.001);
      }
      proxyDummy.rotation.set(0, 0, 0); proxyDummy.updateMatrix();
      proxyMesh.setMatrixAt(i, proxyDummy.matrix);
    }
    proxyMesh.visible = visible > 0;
    winU.uWinNight.value = CBZ.nightAmount == null ? 0 : Math.max(0, Math.min(1, CBZ.nightAmount));
    if (dirty) proxyMesh.instanceMatrix.needsUpdate = true;
    // the measured skyline goes to the bake a few seconds after it changed
    if (bakeDirtyAt && performance.now() - bakeDirtyAt > 5000) { bakeDirtyAt = 0; try { saveBake(); } catch (e) {} }
    CBZ.realBuildingLOD = { total: proxyRecords.length, visible, drawCalls: visible ? 1 : 0, detailRadius: R };
  }

  function boundsFor(o) {
    let b = bounds.get(o);
    // A pool's bounds are its INSTANCES, so the "it MOVED → don't trust the
    // cache" rule the sweep applies to o.position has to apply to them too:
    // an InstancedMesh never moves its object transform, it rewrites matrices.
    // BufferAttribute bumps `version` on every needsUpdate, so that is the
    // cheap tell. Re-measure rather than blacklist — the pane pools legitimately
    // rewrite matrices on every shatter and every dusk flip, and a pool that
    // gets blacklisted for doing its job is the exemption bug all over again.
    if (b && b.dynamic) return b;
    if (b && !(o.isInstancedMesh && o.instanceMatrix && b.iv !== o.instanceMatrix.version)) return b;
    // one-time measure. Meshes with a bounding sphere are cheap; groups pay
    // one Box3 walk. Anything unmeasurable or world-spanning is marked
    // dynamic=true (== never cull).
    b = { x: 0, z: 0, r: 1e9, px: o.position.x, pz: o.position.z, dynamic: false };
    // A verdict taken from a TRANSIENT state must not be cached. The warm
    // night-pane pools sit at count 0 all day (city/buildings.js zeroes them so
    // ~60k degenerate instances stop entering the vertex shader); measuring one
    // at noon and caching "dynamic" would exempt it from culling for the whole
    // session, and it is exactly the pool that lights up after dusk.
    let cacheable = true;
    try {
      if (o.userData && (o.userData.dynamic || o.userData.terrain)) { b.dynamic = true; }
      else if (o.name === "city-crowd") { b.dynamic = true; }
      else if (o.isInstancedMesh) {
        // an InstancedMesh's geometry sphere is ONE prototype at the object's
        // own (usually origin) transform — measuring that hid far-flung pools
        // whenever the player left the origin, or never culled them at all.
        // Aggregate the true spread from the instance matrices once (positions
        // live at elements 12/14 of each 16-float block).
        //
        // THE GHOST CITY WAS THIS LINE. The per-instance slack used to be
        // `geometry.boundingSphere.radius * 3` — which assumes that sphere
        // describes ONE instance. city/buildings.js's pooledIM() deliberately
        // HAND-SETS an AGGREGATE sphere spanning its whole 320 u sector, so
        // r128 can frustum-cull the sector (its own comment: "core/farcull.js
        // can drop far cells wholesale"). Two files describing one object
        // independently: a populated downtown sector reads radius ~230, x3 =
        // ~690 of "slack", and b.r lands ~920 — straight past the 400 u
        // never-cull guard below. EVERY glass-pane, interior-mullion and
        // masonry-veneer pool in the world was therefore permanently exempt
        // from the culling it exists to enable, while the SHELLS those panes
        // belong to (building groups + core/batch.js's per-building merged
        // walls) culled normally. Past the radius the walls went and the
        // windows stayed: a see-through city of frames on empty ground.
        // The slack is now measured off the instances themselves — the
        // prototype's own extent (boundingBox, which never touches the
        // hand-set boundingSphere) times the largest instance scale — so it
        // is correct for a hand-set sphere and a real prototype alike.
        const a = o.instanceMatrix && o.instanceMatrix.array;
        const n = o.count | 0;
        if (!a || !n) { b.dynamic = true; cacheable = false; }
        else {
          let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, maxS = 0;
          for (let i = 0; i < n; i++) {
            const o16 = i * 16;
            const x = a[o16 + 12], z = a[o16 + 14];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
            // columns 0..2 of the instance matrix are the SCALED basis vectors:
            // their lengths are the instance's scale on each axis.
            const sx = Math.hypot(a[o16], a[o16 + 1], a[o16 + 2]);
            const sy = Math.hypot(a[o16 + 4], a[o16 + 5], a[o16 + 6]);
            const sz = Math.hypot(a[o16 + 8], a[o16 + 9], a[o16 + 10]);
            if (sx > maxS) maxS = sx; if (sy > maxS) maxS = sy; if (sz > maxS) maxS = sz;
          }
          // computeBoundingBox does NOT write boundingSphere, so a pool that
          // published its own sector sphere keeps it (and keeps frustum-culling).
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox;
          const protoR = bb
            ? Math.hypot(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) * 0.5
            : 2;
          const proto = Math.max(0.5, protoR * (maxS > 0 ? maxS : 1));
          // instance positions are pool-local; nearly every pool sits at the
          // identity, but honour a translated pool object anyway.
          b.x = (minX + maxX) / 2 + o.position.x; b.z = (minZ + maxZ) / 2 + o.position.z;
          b.r = Math.hypot(maxX - minX, maxZ - minZ) / 2 + proto;
          b.iv = o.instanceMatrix.version;     // the measurement's own receipt
        }
      }
      else if (o.isMesh && o.geometry) {
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        const s = o.geometry.boundingSphere;
        _v.copy(s.center).applyMatrix4(o.matrixWorld);
        b.x = _v.x; b.z = _v.z; b.r = s.radius * Math.max(o.scale.x, o.scale.z, 1);
      } else {
        _box.setFromObject(o);
        if (isFinite(_box.min.x) && isFinite(_box.max.x)) {
          b.x = (_box.min.x + _box.max.x) / 2; b.z = (_box.min.z + _box.max.z) / 2;
          b.r = Math.hypot(_box.max.x - _box.min.x, _box.max.z - _box.min.z) / 2;
        } else b.dynamic = true;
      }
      // a footprint wider than a few blocks (terrain tiles, the sea, road
      // webs) never culls anyway — skip it forever instead of re-testing.
      // (world/detail_kit.js's dressing pools are ONE InstancedMesh per prop
      // type for the WHOLE world by design, so they land here and stay drawn;
      // that is correct — a world-spanning pool cannot be dropped wholesale.)
      if (b.r > 400) b.dynamic = true;
    } catch (e) { b.dynamic = true; }
    if (cacheable) bounds.set(o, b);
    return b;
  }

  let lastSweepAt = 0, cursor = 0;
  CBZ.onAlways(3.6, function () {
    // WALL-CLOCK pacing, not game-dt: dt is clamped to 0.05s/frame, so on a
    // low-fps machine (the exact machines the cull radius exists FOR) a
    // dt-accumulated "4Hz" sweep degraded to once per several wall-seconds
    // and freshly-built worlds sat unculled for minutes.
    const now = performance.now();
    if (now - lastSweepAt < 250) return;   // 4Hz is plenty for walking/driving speeds
    lastSweepAt = now;
    const g = CBZ.game;
    const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    /* WHAT THE CAMERA SEES (core/sight.js): measured from the EYE, out to
       the fog this eye has. It was the player's feet and a private airborne
       radius; from a heli boom or a lifted lens that hid groups standing in
       the picture. NO SWAP INSIDE THE FOG (owner: "nothing may visibly
       generate or pop within view"): every group, a lot building included, is
       drawn as itself out to the fog's end; the measured LOD box only stands
       in past it, where the fog has made the difference invisible. */
    const SG = CBZ.sight();
    const P = (CBZ.camera || CBZ.player) ? { x: SG.x, z: SG.z } : null;
    const baseR = (CBZ.CONFIG && CBZ.CONFIG.CITY_FAR_CULL !== false && g && g.mode === "city")
      ? (CBZ.cityCullRadius || 0) : 0;
    const R0 = baseR;
    const RV = R0 ? Math.max(SG.far + 30, R0) : 0;
    if (!root) return;
    const kids = root.children;
    // amortize: at most ~1/4 of the children measured/tested per sweep → the
    // whole city re-evaluates every ~1s, still far faster than you can drive
    // through a fog wall. Hysteresis (show at R - hysBand()) stops boundary
    // flicker — and the band is DERIVED from this very slice, see hysBand().
    const slice = Math.max(64, Math.ceil(kids.length / 4));
    // measure the viewer BEFORE anything reads hysBand() this tick
    trackViewer(P, now, kids.length, slice);
    updateProxy(CBZ.city && CBZ.city.arena, P, RV);
    if (!R0) {                      // OFF (high tiers / flag) — restore and idle
      if (hidByUs.size) { hidByUs.forEach(function (o) { o.visible = true; }); hidByUs.clear(); }
      return;
    }
    if (!P) return;
    // First-time measurements are the expensive part (a group pays a Box3
    // subtree walk) — measured 30-50ms hitch-stacks right after a tier drop
    // when ~1000 unmeasured children landed in one sweep. Cap fresh measures
    // per sweep; already-measured children stay full-rate (they're a Map hit).
    // MESHES with a precomputed bounding sphere are O(1) to measure (batch.js
    // computes spheres for every merged tile/shell) — measuring them free of
    // the budget keeps ~1k merged meshes from sitting unculled for ~30s after
    // a build/tier change while the budget crawls to them.
    let freshMeasures = 32;
    for (let n = 0; n < slice; n++) {
      cursor = (cursor + 1) % kids.length;
      const o = kids[cursor];
      if (!o || (!o.isMesh && !o.isGroup)) continue;
      if (!bounds.has(o)) {
        // plain mesh with a precomputed sphere = O(1); instanced pools pay an
        // O(instances) aggregate scan, so they stay on the budget.
        const cheap = o.isMesh && !o.isInstancedMesh && o.geometry && o.geometry.boundingSphere;
        if (!cheap) {
          if (freshMeasures <= 0) continue;
          freshMeasures--;
        }
      }
      const b = boundsFor(o);
      if (b.dynamic) continue;
      if (o.position.x !== b.px || o.position.z !== b.pz) {
        // it MOVED — an actor/vehicle, not static city. Blacklist forever and
        // hand visibility back if we were the ones who hid it.
        b.dynamic = true;
        if (hidByUs.has(o)) { o.visible = true; hidByUs.delete(o); }
        continue;
      }
      const dx = b.x - P.x, dz = b.z - P.z;
      const d = Math.sqrt(dx * dx + dz * dz) - b.r;   // nearest possible point
      // (RV: see above. Everything is held to the fog's end.)
      const R = RV;
      if (d > R) {
        // no `!hidByUs.has(o)` guard: if another system handed visibility back
        // (a quality tier restoring the masonry veneer), the sweep must be able
        // to re-take it, or the object stays drawn forever while the set still
        // claims we own it. Re-adding to a Set is free.
        if (o.visible) { o.visible = false; hidByUs.add(o); }
        if (d > R + EVICT && hidByUs.has(o) && !evicted.has(o)) evict(o);
      } else if (d < R - hysBand()) {
        // userData.cullLocked = "another system wants this hidden at this
        // quality tier" (city/buildings.js's masonry veneer is dropped whole at
        // tier 0). Re-showing on approach would override that owner. Culling it
        // is still fine — hidden is hidden.
        if (evicted.has(o) && CBZ.geoExpandAll) {
          // a packed eviction comes back to full size before it can draw
          o.traverse(function (c) { const g = c.geometry; if (g && g._cbzNoDraw) CBZ.geoExpandAll(g); });
        }
        if (hidByUs.has(o) && !(o.userData && o.userData.cullLocked)) { o.visible = true; hidByUs.delete(o); shownAt.set(o, performance.now()); }
        evicted.delete(o);
      }
    }
  });

  /* ==================================================================
     SCENERY POOLS ARE DEALT INTO CELLS (2026-09-28, the "too many trees"
     wave).

     MEASURED (Metal GPU headless, Medium tier, Gang City spawn): 5.5 M of
     the 9.6 M triangles in a frame were trees, drawn whatever the camera
     looked at, and the shadow casters among them (Redhollow's mature wood,
     Mount Mercy's crowns: 1.5 M) went into every sun-map refresh as well.
     r128 tests an InstancedMesh by its prototype's sphere, so every forest
     pool is built `frustumCulled = false`.

     core/instcull.js makes every InstancedMesh cullable by the union box of
     its instances, for every camera. That is exact, but a pool is as big as
     its builder made it: continent.js deals the backcountry in 1.6 km
     chunks, Redhollow is one pool per species for the whole biome, and a box
     that size meets almost any frustum. So each scenery pool is re-dealt,
     once, into CELL-sized children: the same geometry and material, the
     same instance matrices and colours, split by position. Each cell's box
     is then tight, and the view and the sun draw only the cells they can
     see. No pixel changes.

     The original pool object stays exactly where it was, matrices and all,
     as the cells' parent: every reference other code holds (collider refs,
     continent.js's chunk disc toggling `.visible`, tier code flipping
     `castShadow`) still points at the thing it always did. It is taken off
     the draw list with layers (mask 0; children keep their own), and ray
     hits on a cell come back as hits on the original pool with the original
     instance index. Kept honest every second: flags are mirrored onto the
     cells; a pool that rewrites its matrices or colours or changes count or
     geometry is re-dealt; one that keeps doing it is an actor pool, not
     scenery, and is handed back whole.
  ================================================================== */
  const CELL = 600;                    // metres: the widest a cell may be (420/700/1000 measured: same GPU, fewer calls wider)
  const CELL_MIN = 48;                 // ...unless it is already this sparse
  // A pool that casts shadows is dealt finer: the sun's box is ~300 m across,
  // and a caster cell that clips it sends every tree it holds to the shadow map.
  const CELL_CASTER = 240;
  const splitPools = new Set();
  const HIDDEN_LAYER_MASK = 0;
  const _cellSphereC = new THREE.Vector3();
  // What the BUILDER set. core/instcull.js turns InstancedMesh.frustumCulled
  // into an accessor that answers true for any pool it can bound, and keeps
  // the owner's own value in _cbzFrustumCulled.
  function ownerCulled(o) { return o._cbzFrustumCulled !== undefined ? o._cbzFrustumCulled : o.frustumCulled; }
  function scenic(o) {
    const ud = o.userData || {};
    return !!(ud.vegetationLayer || ud.forestBelt || ud.sceneryScale || ud.terrain);
  }
  function cellRaycast(raycaster, hits) {
    const pool = this.userData.cellOf;
    const before = hits.length;
    THREE.InstancedMesh.prototype.raycast.call(this, raycaster, hits);
    const map = this.userData.cellIndex;
    for (let i = before; i < hits.length; i++) {
      const h = hits[i];
      h.object = pool;
      if (h.instanceId != null) h.instanceId = map[h.instanceId];
    }
  }
  function syncFlags(o) {
    const cells = o.userData.cells;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      c.material = o.material;
      c.castShadow = o.castShadow;
      c.receiveShadow = o.receiveShadow;
      c.customDepthMaterial = o.customDepthMaterial;
      c.customDistanceMaterial = o.customDistanceMaterial;
      c.renderOrder = o.renderOrder;
    }
  }
  function unsplit(o) {
    const cells = o.userData.cells || [];
    for (let i = 0; i < cells.length; i++) o.remove(cells[i]);
    o.userData.cells = null;
    o.userData.cellSplit = 0;
    o.layers.mask = o.userData.cellLayerMask == null ? 1 : o.userData.cellLayerMask;
    splitPools.delete(o);
  }
  function split(o) {
    const n = o.count | 0, g = o.geometry;
    const a = o.instanceMatrix.array, col = o.instanceColor ? o.instanceColor.array : null;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const ps = g.boundingSphere;
    // THE DEAL: a k-d split on the instance positions, longer axis at the
    // median, until a cell is no wider than CELL or holds no more than
    // 2 x CELL_MIN trees. A dense wood comes out as CELL-sized blocks; a
    // sparse scatter (forty rocks across the country) stays a few big cells
    // instead of forty one-rock draw calls.
    const all = new Array(n);
    for (let i = 0; i < n; i++) all[i] = i;
    const groups = [], W = o.castShadow ? CELL_CASTER : CELL;
    (function deal(idx) {
      let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
      for (let j = 0; j < idx.length; j++) {
        const q = idx[j] * 16, x = a[q + 12], z = a[q + 14];
        if (x < mnx) mnx = x; if (x > mxx) mxx = x;
        if (z < mnz) mnz = z; if (z > mxz) mxz = z;
      }
      const wx = mxx - mnx, wz = mxz - mnz;
      if ((wx <= W && wz <= W) || idx.length <= CELL_MIN * 2) { groups.push(idx); return; }
      const off = wx >= wz ? 12 : 14;
      idx.sort(function (p, q) { return a[p * 16 + off] - a[q * 16 + off]; });
      const h = idx.length >> 1;
      deal(idx.slice(0, h)); deal(idx.slice(h));
    })(all);
    const cells = [];
    groups.forEach(function (idx) {
      const m = idx.length;
      const im = new THREE.InstancedMesh(g, o.material, m);
      const dst = im.instanceMatrix.array;
      const cc = col ? new Float32Array(m * 3) : null;
      // the cell's sphere: prototype sphere centre through each instance
      // matrix, radius = prototype radius x that instance's largest scale
      let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
      const cs = new Array(m * 4);
      for (let j = 0; j < m; j++) {
        const q = idx[j] * 16;
        for (let k = 0; k < 16; k++) dst[j * 16 + k] = a[q + k];
        if (cc) { const s = idx[j] * 3; cc[j * 3] = col[s]; cc[j * 3 + 1] = col[s + 1]; cc[j * 3 + 2] = col[s + 2]; }
        const cx = ps.center.x, cy = ps.center.y, cz = ps.center.z;
        const x = a[q] * cx + a[q + 4] * cy + a[q + 8] * cz + a[q + 12];
        const y = a[q + 1] * cx + a[q + 5] * cy + a[q + 9] * cz + a[q + 13];
        const z = a[q + 2] * cx + a[q + 6] * cy + a[q + 10] * cz + a[q + 14];
        const s = Math.max(Math.hypot(a[q], a[q + 1], a[q + 2]), Math.hypot(a[q + 4], a[q + 5], a[q + 6]), Math.hypot(a[q + 8], a[q + 9], a[q + 10]));
        const r = ps.radius * s;
        cs[j * 4] = x; cs[j * 4 + 1] = y; cs[j * 4 + 2] = z; cs[j * 4 + 3] = r;
        if (x - r < mnx) mnx = x - r; if (x + r > mxx) mxx = x + r;
        if (y - r < mny) mny = y - r; if (y + r > mxy) mxy = y + r;
        if (z - r < mnz) mnz = z - r; if (z + r > mxz) mxz = z + r;
      }
      _cellSphereC.set((mnx + mxx) / 2, (mny + mxy) / 2, (mnz + mxz) / 2);
      let R = 0;
      for (let j = 0; j < m; j++) {
        const d = Math.hypot(cs[j * 4] - _cellSphereC.x, cs[j * 4 + 1] - _cellSphereC.y, cs[j * 4 + 2] - _cellSphereC.z) + cs[j * 4 + 3];
        if (d > R) R = d;
      }
      if (cc) im.instanceColor = new THREE.InstancedBufferAttribute(cc, 3);
      im.instanceMatrix.needsUpdate = true;
      im.name = o.name;
      // Culling is core/instcull.js's: it bounds the cell by its own
      // instances. The owner value stays what the scenery builders set.
      im.frustumCulled = false;
      im.matrixAutoUpdate = false;
      im.matrixWorldNeedsUpdate = true;    // one world multiply under the (frozen) pool, then static
      im.userData = {
        cellOf: o, cellIndex: idx, sphere: new THREE.Sphere(_cellSphereC.clone(), R),
        vegetationLayer: o.userData.vegetationLayer, sceneryScale: o.userData.sceneryScale,
      };
      im.raycast = cellRaycast;
      cells.push(im);
      o.add(im);
    });
    o.userData.cells = cells;
    o.userData.cellSplit = cells.length;
    o.userData.cellStamp = { iv: o.instanceMatrix.version, cv: o.instanceColor ? o.instanceColor.version : -1, n: n, g: g };
    if (o.userData.cellLayerMask == null) o.userData.cellLayerMask = o.layers.mask;
    o.layers.mask = HIDDEN_LAYER_MASK;
    syncFlags(o);
    splitPools.add(o);
  }
  /* Dealing ~430 pools (~136k instances) takes a noticeable slice of a
     frame, so it is done under a per-frame BUDGET from a queue: the first
     second of play never hitches for it, and a pool simply draws the old
     way until its turn comes. */
  const SPLIT_BUDGET_MS = 3;
  const queue = [];
  let lastPoolScan = 0, scannedKids = -1, scannedRoot = null;
  let cellsOn = true;                   // tools' in-page A/B handle only (CBZ.sceneryCells.set)
  function honest(root) {
    // a rebuilt city is a new root: let go of the old one's pools
    if (root !== scannedRoot && splitPools.size) splitPools.forEach(unsplit);
    // keep the split pools honest (cheap: a handful of number compares each)
    splitPools.forEach(function (o) {
      const st = o.userData.cellStamp;
      if (o.parent !== root) { unsplit(o); return; }
      if (o.instanceMatrix.version !== st.iv || (o.instanceColor ? o.instanceColor.version : -1) !== st.cv ||
          (o.count | 0) !== st.n || o.geometry !== st.g) {
        unsplit(o);
        o.userData.cellResplits = (o.userData.cellResplits || 0) + 1;
        if (o.userData.cellResplits <= 3) queue.push(o);
        return;
      }
      syncFlags(o);
    });
  }
  function scan(root) {
    // Cells only pay off when something culls them: core/instcull.js. Without
    // it they would be the same triangles in more draw calls.
    if (!root || !THREE.InstancedMesh.cbzCull) return;
    if (root === scannedRoot && root.children.length === scannedKids) return;
    if (root !== scannedRoot) queue.length = 0;
    scannedRoot = root; scannedKids = root.children.length;
    const kids = root.children;
    for (let i = 0; i < kids.length; i++) {
      const o = kids[i];
      if (!o.isInstancedMesh || ownerCulled(o) !== false || splitPools.has(o) || queue.indexOf(o) >= 0) continue;
      if (!scenic(o) || (o.userData && o.userData.dynamic) || (o.userData.cellResplits || 0) > 3) continue;
      if ((o.count | 0) < 8 || !o.instanceMatrix || o.geometry.morphAttributes.position) continue;
      queue.push(o);
    }
  }
  function drain(budgetMs) {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < budgetMs) {
      const o = queue.shift();
      if (o.parent === scannedRoot && !splitPools.has(o)) split(o);
    }
  }
  CBZ.onAlways(3.59, function () {
    if (!cellsOn) return;
    drain(SPLIT_BUDGET_MS);
    const now = performance.now();
    if (now - lastPoolScan < 1000) return;
    lastPoolScan = now;
    const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    honest(root);
    scan(root);
  });

  CBZ.sceneryCells = {
    audit: function () {
      let pools = 0, cells = 0, instances = 0;
      const byName = Object.create(null);
      splitPools.forEach(function (o) {
        pools++; cells += o.userData.cellSplit; instances += o.count;
        const k = o.name || "?", r = byName[k] || (byName[k] = { pools: 0, cells: 0, instances: 0 });
        r.pools++; r.cells += o.userData.cellSplit; r.instances += o.count;
      });
      return { on: cellsOn, cell: CELL, min: CELL_MIN, pools: pools, queued: queue.length, cells: cells, instances: instances, byName: byName };
    },
    // IN-PAGE A/B for tools (the way core/instcull.js exposes `on`): applied
    // at once, so a probe can time both sides in the same world, same frame.
    set: function (o) {
      o = o || {};
      // off = the pools draw themselves again and their cells stand aside
      // (no re-deal either way, so flipping costs microseconds)
      if (o.on != null && !!o.on !== cellsOn) {
        cellsOn = !!o.on;
        splitPools.forEach(function (p) {
          p.layers.mask = cellsOn ? HIDDEN_LAYER_MASK : p.userData.cellLayerMask;
          for (let i = 0; i < p.userData.cells.length; i++) p.userData.cells[i].visible = cellsOn;
        });
      }
      if (cellsOn && queue.length) drain(1e9);
      return cellsOn;
    },
  };

  /* ==================================================================
     CBZ.farcullAudit() — WHAT IS EXEMPT FROM DISTANCE CULLING, AND WHY.

     The ghost city was not a coordinate bug: it was a shell that culled
     and a window that did not. Two numbers therefore have to be visible
     together, or a "fix" that simply stops drawing something passes.

       poolsExempt — pooled facade geometry (glass panes, interior sky/
                     mullion strips, masonry veneer) that boundsFor marks
                     dynamic, i.e. can never be dropped with the wall it
                     is stuck to. MUST BE 0.
       unproxied   — buildings with no distance-LOD box, so past the cull
                     radius they leave nothing but their fittings. MUST
                     BE 0.
       shells/lots/proxied/pools are printed BESIDE them so neither can
       be zeroed by building or drawing less.

     Pure read: it measures through the same boundsFor the sweep uses, so
     it cannot disagree with the live behaviour. NOT YET PINNED — whoever
     runs it first writes the numbers into CLAUDE.md (do not repeat the
     propUseAudit mistake of pinning a guess).
  ================================================================== */
  CBZ.farcullAudit = function () {
    const A = CBZ.city && CBZ.city.arena;
    const root = A && A.root;
    const air = (CBZ.detailKit && CBZ.detailKit.airLOD) ? CBZ.detailKit.airLOD() : null;
    const out = {
      radius: CBZ.cityCullRadius || 0, hidden: hidByUs.size,
      // the derived show/hide band and the viewer speed it came from — a band
      // stuck at 20 while `viewerSpd` is 150 is the flicker, visible as a number
      hysBand: Math.round(hysBand()), viewerSpd: Math.round(_spd), retestSec: Math.round(_retest * 100) / 100,
      // world-pool dressing suppressed at altitude (the fittings-without-walls
      // ghost); null when world/detail_kit.js is absent
      dressingAloft: air ? !!air.aloft : null,
      shells: 0, lots: 0, proxied: proxyRecords.length, unproxied: 0,
      pools: 0, poolsExempt: 0, poolsIdle: 0, worldPools: 0,
    };
    if (!root) return out;
    const shells = (root.userData && root.userData.shells) || [];
    out.shells = shells.length;
    let lots = (A.lots || []);
    if (A.annex && Array.isArray(A.annex.lots)) lots = lots.concat(A.annex.lots);
    out.lots = lots.length;
    // A building is "proxied" when the live proxy carries its group — an
    // identity test, not a coordinate one, so two towers on one spot can never
    // cover for each other.
    const have = new Set();
    for (let i = 0; i < proxyRecords.length; i++) have.add(proxyRecords[i].grp);
    const all = [];
    for (let i = 0; i < lots.length; i++) if (lots[i] && lots[i].building) all.push(lots[i].building);
    for (let i = 0; i < shells.length; i++) all.push(shells[i]);
    const seenB = new Set();
    for (let i = 0; i < all.length; i++) {
      const b = all[i];
      if (!b || b.park || !b.group || seenB.has(b.group)) continue;
      if (!(+b.w > 1 && +b.d > 1 && +b.h > 1)) continue;
      seenB.add(b.group);
      if (!have.has(b.group)) out.unproxied++;
    }
    // pooled facade geometry: buildings.js tags every one of its pools.
    // A pool at count 0 submits nothing (the warm night panes by day), so it
    // cannot ghost anything and is reported apart rather than failing the gate.
    const kids = root.children;
    for (let i = 0; i < kids.length; i++) {
      const o = kids[i];
      if (!o || !o.isInstancedMesh) continue;
      const ud = o.userData || {};
      if (!(ud.glassPool || ud.masonryPool)) { if (!ud.dynamic) out.worldPools++; continue; }
      if (!(o.count | 0)) { out.poolsIdle++; continue; }
      out.pools++;
      if (boundsFor(o).dynamic) out.poolsExempt++;
    }
    return out;
  };

  // tier changed → new radius applies next sweep; if it WIDENED, groups past
  // the old radius but inside the new one re-show within a second via the
  // rolling cursor. Nothing to do here beyond an immediate restore when OFF.
  if (CBZ.onQualityChange) CBZ.onQualityChange(function () {
    if (!(CBZ.cityCullRadius || 0) && hidByUs.size) {
      hidByUs.forEach(function (o) { o.visible = true; });
      hidByUs.clear();
    }
  });

  /* ---- FOG REACH (phones and tablets only) --------------------------------
     MEASURED 2026-09-27 (tools/ipad-perf.mjs, Gang City spawn, iPad viewport):
     8.7 M triangles a frame at the Fast tier, and ~6 M of them were scenery
     pools that are NEVER frustum-culled (backcountry forest chunks, Redhollow
     crowns and wood, scatter rocks): r128 tests an InstancedMesh by its
     prototype's sphere, so every such pool is `frustumCulled = false` and
     draws in full from anywhere in the country. The farcull sweep above
     exempts them (terrain-flagged, r > 400), and continent.js's forest disc
     keeps chunks out to 3.5 km whatever the fog says.
     On a desktop that is a fair price for a horizon. On a tablet at the Fast
     tier the fog ends at 560 m, and a low tree 1.5 km away is fog colour that
     still costs its whole vertex pass, every frame, in the main pass and the
     shadow pass. So here a scenery pool (or cell) whose NEAREST point is past
     the eye's fog (core/sight.js: the airborne range once the eye is up) is
     removed from rendering via layers (never .visible, which the owners and
     the tier gates own), and put back before it comes within reach. Mountains
     are plain meshes and are left to their own tier gates. */
  if (CBZ.isMobileDevice) {
    const reachHidden = new Set();
    let reachT = 0;
    const reachStat = { cands: 0, reach: 0, camY: 0 };
    // Own measurement, not viewscope's subtreeSphere: that one marks anything
    // wider than 400 m unscopeable, which is every forest chunk (1.6 km).
    // Instanced pools are measured over their instances (r128 only knows the
    // prototype), cached until the pool rewrites its matrices.
    const reachBounds = new WeakMap();
    const _rv = new THREE.Vector3();
    function reachSphere(o) {
      let b = reachBounds.get(o);
      if (b && (b.moving || b.iv == null || !o.instanceMatrix || o.instanceMatrix.version === b.iv)) return b;
      // A pool that keeps rewriting its matrices is actors (crowd, instanced
      // peds, traffic), not scenery: after three rewrites it is left alone.
      const rewrites = b ? (b.rewrites || 0) + 1 : 0;
      if (rewrites > 3) { b.moving = true; return b; }
      b = { x: 0, y: 0, z: 0, r: 0, iv: null, ok: false, rewrites: rewrites, moving: false };
      try {
        const g = o.geometry;
        if (o.isInstancedMesh) {
          const a = o.instanceMatrix && o.instanceMatrix.array, n = o.count | 0;
          if (a && n) {
            let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, mnz = 1e9, mxz = -1e9, maxS = 0;
            for (let i = 0; i < n; i++) {
              const q = i * 16, x = a[q + 12], y = a[q + 13], z = a[q + 14];
              if (x < mnx) mnx = x; if (x > mxx) mxx = x;
              if (y < mny) mny = y; if (y > mxy) mxy = y;
              if (z < mnz) mnz = z; if (z > mxz) mxz = z;
              const s = Math.max(Math.hypot(a[q], a[q + 1], a[q + 2]), Math.hypot(a[q + 4], a[q + 5], a[q + 6]), Math.hypot(a[q + 8], a[q + 9], a[q + 10]));
              if (s > maxS) maxS = s;
            }
            if (!g.boundingSphere) g.computeBoundingSphere();
            const proto = (g.boundingSphere ? g.boundingSphere.radius : 2) * (maxS || 1);
            b.x = (mnx + mxx) / 2 + o.position.x; b.y = (mny + mxy) / 2 + o.position.y; b.z = (mnz + mxz) / 2 + o.position.z;
            b.r = Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) * 0.5 + proto;
            b.iv = o.instanceMatrix.version; b.ok = true;
          }
        } else if (g) {
          if (!g.boundingSphere) g.computeBoundingSphere();
          const s = g.boundingSphere;
          if (s) {
            _rv.copy(s.center).applyMatrix4(o.matrixWorld);
            b.x = _rv.x; b.y = _rv.y; b.z = _rv.z;
            b.r = s.radius * Math.max(Math.abs(o.scale.x), Math.abs(o.scale.y), Math.abs(o.scale.z), 1); b.ok = true;
          }
        }
      } catch (e) { b.ok = false; }
      reachBounds.set(o, b);
      return b;
    }
    function restoreReach() { reachHidden.forEach(function (o) { o.layers.mask = 1; }); reachHidden.clear(); }
    CBZ.onAlways(3.61, function () {
      const now = performance.now();
      if (now - reachT < 300) return;
      reachT = now;
      const g = CBZ.game, root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
      const cam = CBZ.camera, fog = CBZ.scene && CBZ.scene.fog;
      if (!g || g.mode !== "city" || !root || !cam || (CBZ.CONFIG && CBZ.CONFIG.MOBILE_FOG_REACH === false)) {
        if (reachHidden.size) restoreReach();
        return;
      }
      // core/sight.js: the fog this eye has (the airborne range once it is
      // up). Past it a pool is fog colour; the height fog's floor leaves a
      // tall hill a trace of contrast there, which is the terrain's (never
      // held back), not a pool's.
      const reach = CBZ.sight().reach;
      const kids = root.children;
      let cands = 0;
      const hold = function (o, b) {
        cands++;
        const d = Math.hypot(b.x - cam.position.x, b.y - cam.position.y, b.z - cam.position.z) - b.r;
        if (d > reach) {
          if (o.layers.mask !== 0) { o.layers.mask = 0; reachHidden.add(o); }
        } else if (reachHidden.has(o)) {
          o.layers.mask = 1; reachHidden.delete(o);
        }
      };
      for (let i = 0; i < kids.length; i++) {
        const o = kids[i];
        const ud = o.userData || {};
        // A pool dealt into frustum cells (above) is held back cell by cell:
        // its own layer mask is the split's, never this pass's.
        if (ud.cellSplit && ud.cells) {
          if (reachHidden.has(o)) reachHidden.delete(o);
          for (let k = 0; k < ud.cells.length; k++) {
            const c = ud.cells[k], s = c.userData.sphere;
            hold(c, { x: s.center.x + o.position.x, y: s.center.y + o.position.y, z: s.center.z + o.position.z, r: s.radius });
          }
          continue;
        }
        if (!(o.isInstancedMesh || ud.vegetationLayer || ud.sceneryScale)) continue;
        if (o.frustumCulled !== false && !o.isInstancedMesh) continue;   // r128 already culls it
        if (ud.dynamic) continue;
        const b = reachSphere(o);
        if (!b.ok || b.moving) continue;
        hold(o, b);
      }
      reachStat.cands = cands; reachStat.reach = reach; reachStat.camY = cam.position.y;
    });
    CBZ.fogReachAudit = function () { return { hidden: reachHidden.size, candidates: reachStat.cands, reach: Math.round(reachStat.reach), camY: Math.round(reachStat.camY) }; };
  }
})();
