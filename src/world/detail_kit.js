/* ============================================================
   world/detail_kit.js — THE WORLD-DRESSING TOOLKIT (layer 1 of 5).

   WHY THIS EXISTS
   ---------------
   Big empty clean surfaces are the #1 reason a procedural city reads as
   fake. This file is the shared machinery for the four dressing passes
   that follow it (utility_lines, street_furniture, world_grime,
   building_dress): the layer of accumulated stuff a real place has —
   poles and wires, litter and weeds, rooftop plant, wall stains.

   THE PERFORMANCE CONTRACT (read before adding anything)
   ------------------------------------------------------
   The engine is DRAW-CALL bound, not triangle bound (core/batch.js:6 —
   ~60k tris but ~2200 calls pre-batching). These passes add ~10k props.
   That is only survivable because EVERY repeated prop goes through one
   of exactly two primitives here:

     • Batch      — one THREE.InstancedMesh per PROP TYPE for the whole
                    world. core/batch.js:411 skips InstancedMesh, so it
                    stays exactly ONE draw call no matter the count.
                    A prop's sub-parts (pole + crossarm + insulators…)
                    are merged into ONE prototype geometry with baked
                    VERTEX COLOURS, so a multi-coloured prop is still a
                    single instanced draw.
     • Sheet      — one merged non-indexed triangle soup per SURFACE
                    CLASS (ground decals, wires, wall grime). Also one
                    draw call, and because it is built non-indexed with
                    a per-item vertex ledger we can scale it live with
                    geometry.setDrawRange().

   Both primitives are QUALITY-TIERED at runtime: every batch/sheet
   registers a density class and CBZ.onQualityChange shrinks
   InstancedMesh.count / geometry.drawRange. Tier 0 renders none of the
   decorative classes at all.

   THE DETERMINISM CONTRACT
   ------------------------
   Placement is WORLD GENERATION: byte-identical per seed across clients
   (multiplayer). Nothing here ever calls Math.random, and nothing draws
   on city.rng (order-fragile — an extra draw would reflow every sibling
   module's content). All variation comes from CBZ.hash01(x, z, salt),
   the order-independent position hash.

   Quality tier is a per-CLIENT value, so it may NEVER change what gets
   generated — only what gets DRAWN. That is why colliders are attached
   exclusively to the "solid" density class, which is always built at
   full count on every tier. Two players on different GPUs collide with
   exactly the same world.

   THE HOOK
   --------
   city/world.js calls CBZ.cityProps(city) at the end of buildCity()
   (world.js:934), after buildings, after the island/biome landmasses,
   with city.lots / city.roads / city.streetProps all populated. We WRAP
   that function (never edit it) and run every registered pass right
   after the original returns — so we can see, and avoid, every prop
   props.js already placed. Wrapper markers are copied forward per the
   house rule in CLAUDE.md.

   Flags (all one-line reverts, all URL-overridable as ?cfg_NAME=0):
     DETAIL_WORLD_V1        master switch for the whole dressing layer
     DETAIL_DENSITY         global density multiplier (1 = authored)
     DETAIL_UTILITY_LINES   poles / transformers / catenary wires
     DETAIL_STREET_FURNITURE signs / bollards / bins / alley junk
     DETAIL_GROUND_GRIME    kerb paint / cracks / puddles / tyre marks
     DETAIL_BUILDING_DRESS  rooftop plant / AC / awnings / wall stains
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = CBZ.CONFIG || (CBZ.CONFIG = {});

  // DETAIL_WORLD_V1 (owner: "make the world like 100x realer feeling"). On →
  // the five world-dressing passes run at the end of buildCity. Flip false
  // (or ?cfg_DETAIL_WORLD_V1=0) for a one-line revert to the bare city.
  if (CFG.DETAIL_WORLD_V1 == null) CFG.DETAIL_WORLD_V1 = true;
  // DETAIL_DENSITY — global multiplier on every authored count. 0.5 halves
  // the whole layer without touching a single pass. Revert = 1.
  if (CFG.DETAIL_DENSITY == null) CFG.DETAIL_DENSITY = 1;
  // Per-pass switches so a single bad layer can be killed without losing the
  // other four. Each defaults ON; ?cfg_DETAIL_<PASS>=0 disables just that one.
  if (CFG.DETAIL_UTILITY_LINES == null) CFG.DETAIL_UTILITY_LINES = true;
  if (CFG.DETAIL_STREET_FURNITURE == null) CFG.DETAIL_STREET_FURNITURE = true;
  if (CFG.DETAIL_GROUND_GRIME == null) CFG.DETAIL_GROUND_GRIME = true;
  if (CFG.DETAIL_BUILDING_DRESS == null) CFG.DETAIL_BUILDING_DRESS = true;
  // DETAIL_AIR_LOD — see AERIAL LOD below. One-line revert to always-drawn.
  if (CFG.DETAIL_AIR_LOD == null) CFG.DETAIL_AIR_LOD = true;

  const DK = CBZ.detailKit = CBZ.detailKit || {};

  // =====================================================================
  //  DETERMINISM PRIMITIVES
  // =====================================================================
  // Everything positional derives from CBZ.hash01 (order-independent, quantised
  // to decimetres, folded with WORLD_SEED). The tiny fallbacks keep the module
  // usable if seed.js ever fails to load — they are still pure functions of
  // position, never Math.random.
  DK.h01 = function (x, z, salt) {
    if (CBZ.hash01) return CBZ.hash01(x, z, salt);
    const n = Math.sin(x * 127.1 + z * 311.7 + (salt || 0) * 0.017) * 43758.5453;
    return n - Math.floor(n);
  };
  // signed [-1,1]
  DK.h11 = function (x, z, salt) { return DK.h01(x, z, salt) * 2 - 1; };
  // deterministic pick from a list AT a place
  DK.hpick = function (list, x, z, salt) {
    if (!list || !list.length) return null;
    return list[Math.min(list.length - 1, (DK.h01(x, z, salt) * list.length) | 0)];
  };
  // gate: true with probability p, keyed to a place
  DK.hgate = function (x, z, salt, p) { return DK.h01(x, z, salt) < p; };

  // =====================================================================
  //  QUALITY TIERS — what gets DRAWN, never what gets BUILT
  // =====================================================================
  // Three density classes:
  //   solid — carries colliders. ALWAYS full count on every tier, or two
  //           clients on different GPUs would disagree about physics.
  //   decor — mid-size visual mass (rooftop plant, wires, dumpsters, signs).
  //   fine  — small grain (litter, weeds, stains, small decals). First to go.
  // Tier 0 is the emergency tier (it even kills the sun's shadow pass,
  // core/quality.js:235) so it gets none of the decorative layer at all.
  const TIER_DENSITY = [
    { decor: 0.00, fine: 0.00 },   // 0 Fastest
    { decor: 0.34, fine: 0.14 },   // 1 Fast
    { decor: 0.66, fine: 0.44 },   // 2 Balanced
    { decor: 0.90, fine: 0.78 },   // 3 High
    { decor: 1.00, fine: 1.00 },   // 4 Best
  ];
  const scalables = [];            // {apply(density)} — batches + sheets
  let tierApplied = -1;

  /* ------------------------------------------------------------------
     AERIAL LOD — THE FITTINGS MUST NOT OUTLIVE THE WALLS THEY ARE BOLTED TO.

     Every batch and sheet in this file is ONE InstancedMesh (or one merged
     soup) per prop type FOR THE WHOLE WORLD, `frustumCulled = false`,
     `userData.dynamic = true` — deliberately, because a world-spanning pool
     cannot be dropped wholesale and one always-submitted draw is the right
     trade. The consequence nobody had priced: core/farcull.js culls a distant
     building's SHELL (its group, and core/batch.js's merged walls) and
     replaces it with a solid box proxy, but it cannot cull one building's
     share of a world pool. So past the cull radius the walls go and the
     FITTINGS STAY — fire escapes, downpipes, roof plant, aerials, window AC
     units, wall grime — standing proud of a box that is 4% narrower than the
     facade they were bolted to. That is the owner's ghost: "the EXACT metal
     frames from those TWO CITIES TOGETHER". It reads as both cities at once
     because these pools span both cities (and everything else) BY DESIGN —
     one mesh, one draw, the whole world in it.

     THE GATE IS ALTITUDE, and the two numbers are derived, not tasted:
       • it must sit ABOVE every rotorcraft posture, because this file's own
         header promises roof plant "from every window and every helicopter"
         and city/aircraft.js flies SEARCH at 150 m AGL / ENGAGED at 85 m.
       • it must sit BELOW aeroplane cruise, which is where the ghost is seen.
       • and by then the fittings are speckle anyway: a 2 m fire escape at
         320 m subtends 2/320 rad, about 6 px on a 1080-line 60° view, and
         4 px at the 563 m the owner was flying. Speckle with no wall behind
         it is a ghost; speckle with a wall behind it was never worth a draw.
     80 m of hysteresis (engage 320, release 240) so a climb or a descent
     cannot flap the layer — the flicker half of the same bug.

     ONLY `decor` and `fine` are gated. `solid` carries this file's colliders
     and is full count on every tier by contract: two clients on different
     GPUs — or one client at two altitudes — must collide with the same world.
  ------------------------------------------------------------------ */
  const AIR_ON = 320, AIR_OFF = 240;
  let aloft = false;
  function airFactor() { return (CFG.DETAIL_AIR_LOD === false || !aloft) ? 1 : 0; }

  function densityFor(cls, q) {
    if (cls === "solid") return 1;
    const row = TIER_DENSITY[Math.max(0, Math.min(TIER_DENSITY.length - 1, q | 0))];
    return (cls === "fine" ? row.fine : row.decor) * airFactor();
  }
  function applyTier(q) {
    tierApplied = q | 0;
    for (let i = 0; i < scalables.length; i++) {
      try { scalables[i].apply(densityFor(scalables[i].cls, tierApplied)); } catch (e) { /* one bad batch never kills the rest */ }
    }
  }
  if (CBZ.onQualityChange) CBZ.onQualityChange(function (q) { applyTier(q); });
  else tierApplied = 4;

  // 4 Hz on the WALL clock (core/farcull.js's reasoning: game dt is clamped,
  // so a dt-accumulated poll degrades on exactly the machines that need it).
  // Costs one height query per quarter-second and re-writes instance COUNTS
  // only on a state change — never per frame.
  let _airAt = 0;
  if (CBZ.onAlways) CBZ.onAlways(3.7, function () {
    if (CFG.DETAIL_AIR_LOD === false) { if (aloft) { aloft = false; applyTier(DK.currentTier()); } return; }
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (now - _airAt < 250) return;
    _airAt = now;
    const P = CBZ.player && CBZ.player.pos;
    if (!P || !Number.isFinite(P.y)) return;
    let gy = 0;
    try { gy = DK.groundY(P.x, P.z) || 0; } catch (e) { gy = 0; }
    const agl = P.y - gy;
    const next = aloft ? (agl > AIR_OFF) : (agl > AIR_ON);
    if (next === aloft) return;
    aloft = next;
    applyTier(DK.currentTier());
  });

  // Pure read for the gate: is the decorative layer currently suppressed, and
  // at what height did it decide that.
  DK.airLOD = function () { return { aloft: aloft, on: AIR_ON, off: AIR_OFF, enabled: CFG.DETAIL_AIR_LOD !== false }; };
  DK.currentTier = function () { return tierApplied < 0 ? (CBZ.qualityLevel != null ? CBZ.qualityLevel : 2) : tierApplied; };

  // The AUTHORED count multiplier. Note this is NOT the tier scale — it is a
  // build-time knob the owner can turn, and it is identical on every client.
  DK.densityMul = function () {
    const v = +CFG.DETAIL_DENSITY;
    return Number.isFinite(v) && v >= 0 ? v : 1;
  };
  DK.count = function (n) { return Math.max(0, Math.round(n * DK.densityMul())); };

  // =====================================================================
  //  GEOMETRY: PROTOTYPE BUILDER (many parts → one vertex-coloured geometry)
  // =====================================================================
  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _v3 = new THREE.Vector3();
  const _s3 = new THREE.Vector3();
  const _col = new THREE.Color();

  function prepPart(geo, color, x, y, z, rx, ry, rz) {
    // Non-indexed + a uniform attribute set (position/normal/color) is what
    // mergeBufferGeometries demands; uv is dropped because none of these
    // prototypes are textured (textured materials would also opt the mesh out
    // of every merge path in core/batch.js:171).
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (g.attributes.uv) g.deleteAttribute("uv");
    if (g.attributes.uv2) g.deleteAttribute("uv2");
    _e.set(rx || 0, ry || 0, rz || 0);
    _q.setFromEuler(_e);
    _v3.set(x || 0, y || 0, z || 0);
    _s3.set(1, 1, 1);
    _m4.compose(_v3, _q, _s3);
    g.applyMatrix4(_m4);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    _col.setHex(color == null ? 0xffffff : color);
    for (let i = 0; i < n; i++) { arr[i * 3] = _col.r; arr[i * 3 + 1] = _col.g; arr[i * 3 + 2] = _col.b; }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return g;
  }

  function Proto() { this.parts = []; }
  Proto.prototype.add = function (geo, color, x, y, z, rx, ry, rz) {
    this.parts.push(prepPart(geo, color, x, y, z, rx, ry, rz));
    return this;
  };
  Proto.prototype.box = function (w, h, d, color, x, y, z, rx, ry, rz) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
  };
  Proto.prototype.cyl = function (rt, rb, h, seg, color, x, y, z, rx, ry, rz) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg || 8), color, x, y, z, rx, ry, rz);
  };
  Proto.prototype.cone = function (r, h, seg, color, x, y, z, rx, ry, rz) {
    return this.add(new THREE.ConeGeometry(r, h, seg || 8), color, x, y, z, rx, ry, rz);
  };
  Proto.prototype.sphere = function (r, wseg, hseg, color, x, y, z) {
    return this.add(new THREE.SphereGeometry(r, wseg || 8, hseg || 6), color, x, y, z);
  };
  Proto.prototype.plate = function (w, d, color, x, y, z, rx, ry, rz) {
    // a zero-thickness quad lying in the XZ plane (rx = -PI/2 baked in)
    return this.add(new THREE.PlaneGeometry(w, d), color, x, y, z, (rx == null ? -Math.PI / 2 : rx), ry, rz);
  };
  Proto.prototype.done = function () {
    if (!this.parts.length) return null;
    if (this.parts.length === 1) return this.parts[0];
    const U = THREE.BufferGeometryUtils;
    if (!U || !U.mergeBufferGeometries) return this.parts[0];
    const merged = U.mergeBufferGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    return merged || null;
  };
  DK.proto = function () { return new Proto(); };

  // =====================================================================
  //  BATCH — one InstancedMesh per prop type, for the entire world
  // =====================================================================
  // Shared vertex-colour materials. Two variants only: lit (Lambert, the
  // house default) and unlit (Basic, for things that should read the same
  // day or night, e.g. painted markings carried as geometry).
  let _litMat = null, _unlitMat = null;
  DK.litMaterial = function () {
    if (!_litMat) { _litMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }); _litMat._shared = true; }
    return _litMat;
  };
  DK.unlitMaterial = function () {
    if (!_unlitMat) { _unlitMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }); _unlitMat._shared = true; }
    return _unlitMat;
  };

  function Batch(name, geo, opts) {
    opts = opts || {};
    this.name = name;
    this.geo = geo;
    this.opts = opts;
    this.cls = opts.cls || "decor";
    this.items = [];               // {x,y,z,ry,sx,sy,sz,tint,key}
    this.mesh = null;
  }
  // Add one instance. `tint` is a gentle per-instance multiplier (weathering
  // variety) — the prototype already carries real per-part vertex colours, so
  // keep tints near 1.0 or you will wash the colour scheme out.
  Batch.prototype.add = function (x, y, z, o) {
    o = o || {};
    this.items.push({
      x: x, y: y, z: z,
      ry: o.ry || 0, rx: o.rx || 0, rz: o.rz || 0,
      sx: o.sx == null ? 1 : o.sx, sy: o.sy == null ? 1 : o.sy, sz: o.sz == null ? 1 : o.sz,
      tint: o.tint == null ? 1 : o.tint,
      // shuffle key: a tier downgrade trims a PREFIX of the list, so the list
      // must be in deterministic pseudo-random order or the layer would thin
      // out geographically instead of evenly.
      key: DK.h01(x, z, 0x9e37 + this.items.length % 7),
    });
    return this;
  };
  Batch.prototype.build = function (root) {
    const n = this.items.length;
    if (!n || !this.geo || !THREE.InstancedMesh) return null;
    this.items.sort(function (a, b) { return a.key - b.key; });
    const mat = this.opts.unlit ? DK.unlitMaterial() : (this.opts.material || DK.litMaterial());
    const im = new THREE.InstancedMesh(this.geo, mat, n);
    im.name = "detail-" + this.name;
    im.castShadow = !!this.opts.cast;
    im.receiveShadow = this.opts.receive !== false;
    // r128 frustum-culls an InstancedMesh by the PROTOTYPE's bounds, which do
    // not span the instances — a city-wide batch would pop out the moment the
    // origin left the frustum. One always-submitted draw is the correct trade.
    im.frustumCulled = false;
    // Non-empty userData spares it from core/batch.js's merge passes (which it
    // would skip anyway at batch.js:411) and from core/farcull.js's group
    // sweep — these batches span the whole map, so per-group culling is
    // meaningless for them.
    im.userData.worldDetail = this.name;
    im.userData.dynamic = true;
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      _e.set(it.rx, it.ry, it.rz);
      _q.setFromEuler(_e);
      _v3.set(it.x, it.y, it.z);
      _s3.set(it.sx, it.sy, it.sz);
      _m4.compose(_v3, _q, _s3);
      im.setMatrixAt(i, _m4);
      if (it.tint !== 1) { _col.setScalar(it.tint); im.setColorAt(i, _col); }
    }
    // r128 defines USE_COLOR whenever instanceColor exists, and the prototype
    // always carries a real `color` attribute, so vertex colour × instance
    // tint is fully-defined here (a tint-less geometry would render black).
    if (im.instanceColor) {
      for (let i = 0; i < n; i++) if (this.items[i].tint === 1) { _col.setScalar(1); im.setColorAt(i, _col); }
      im.instanceColor.needsUpdate = true;
    }
    im.instanceMatrix.needsUpdate = true;
    root.add(im);
    this.mesh = im;
    const full = n, cls = this.cls;
    scalables.push({
      cls: cls,
      apply: function (d) {
        const c = cls === "solid" ? full : Math.round(full * d);
        im.count = Math.max(0, Math.min(full, c));
        im.visible = im.count > 0;
      },
    });
    if (tierApplied >= 0) {
      const d = densityFor(cls, tierApplied);
      im.count = cls === "solid" ? full : Math.max(0, Math.min(full, Math.round(full * d)));
      im.visible = im.count > 0;
    }
    DK.stats.batches++;
    DK.stats.instances += n;
    DK.stats.drawCalls += 1 + (im.castShadow ? 1 : 0);
    return im;
  };
  DK.batch = function (name, geo, opts) { return new Batch(name, geo, opts); };

  // =====================================================================
  //  SHEET — one merged triangle soup per surface class
  // =====================================================================
  // For things that cannot be instanced because every item has a different
  // SHAPE: catenary wire spans, ground decals of varying size, wall stains.
  // Built non-indexed so a per-item vertex ledger makes setDrawRange() an
  // exact "draw the first K items" control for the tier scaler.
  function Sheet(name, opts) {
    opts = opts || {};
    this.name = name;
    this.opts = opts;
    this.cls = opts.cls || "fine";
    this.items = [];      // {pos:[...], nrm:[...], col:[...], uv:[...]|null, key}
    this.textured = !!opts.map;
  }
  // Add one item: flat arrays of triangle vertices (multiples of 3 verts).
  Sheet.prototype.push = function (pos, nrm, col, uv, key) {
    this.items.push({ pos: pos, nrm: nrm, col: col, uv: uv || null, key: key });
  };
  // Convenience: a horizontal quad (ground decal) with an optional yaw.
  Sheet.prototype.quadXZ = function (cx, y, cz, w, d, yaw, color, uvRect) {
    const c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
    const hw = w / 2, hd = d / 2;
    const P = [];
    const corner = function (ox, oz) { P.push(cx + ox * c - oz * s, y, cz + ox * s + oz * c); };
    // Winding matters: this order makes the triangle normal +Y, so a decal is
    // FRONT-facing seen from above. (The mirrored order renders back-faces and
    // the whole sheet silently vanishes under default face culling.)
    corner(-hw, -hd); corner(hw, hd); corner(hw, -hd);
    corner(-hw, -hd); corner(-hw, hd); corner(hw, hd);
    const N = [];
    for (let i = 0; i < 6; i++) N.push(0, 1, 0);
    this.push(P, N, colArray(color, 6), uvRect ? uvQuad(uvRect) : null, DK.h01(cx, cz, 0x5171));
    return this;
  };
  // Convenience: a vertical quad glued to a wall. (nx,nz) is the OUTWARD wall
  // normal; the quad is centred at (cx,y,cz) and spans `w` along the wall and
  // `h` vertically.
  Sheet.prototype.quadWall = function (cx, y, cz, w, h, nx, nz, color, uvRect) {
    // Tangent along the wall = normal rotated 90° in XZ. This particular sign
    // (t = (-nz, nx)) puts texture-left on the VIEWER's left for all four
    // axis-aligned faces, so lettering reads the right way round everywhere.
    const tx = -nz, tz = nx;
    const hw = w / 2, hh = h / 2;
    const P = [];
    const corner = function (ot, oy) { P.push(cx + tx * ot, y + oy, cz + tz * ot); };
    // ...and this winding makes the triangle normal equal (nx,0,nz), i.e. the
    // quad faces OUT of the wall rather than into it.
    corner(-hw, -hh); corner(hw, hh); corner(hw, -hh);
    corner(-hw, -hh); corner(-hw, hh); corner(hw, hh);
    const N = [];
    for (let i = 0; i < 6; i++) N.push(nx, 0, nz);
    this.push(P, N, colArray(color, 6), uvRect ? uvQuad(uvRect) : null, DK.h01(cx, cz, 0x77a1));
    return this;
  };
  Sheet.prototype.build = function (root) {
    const n = this.items.length;
    if (!n) return null;
    this.items.sort(function (a, b) { return a.key - b.key; });
    let total = 0;
    for (let i = 0; i < n; i++) total += this.items[i].pos.length / 3;
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const uvs = this.textured ? new Float32Array(total * 2) : null;
    const ledger = new Int32Array(n);   // cumulative vertex count per item
    let p = 0, u = 0, v = 0;
    for (let i = 0; i < n; i++) {
      const it = this.items[i], vc = it.pos.length / 3;
      pos.set(it.pos, p * 3);
      nrm.set(it.nrm, p * 3);
      col.set(it.col, p * 3);
      if (uvs) { if (it.uv) uvs.set(it.uv, p * 2); else for (let k = 0; k < vc * 2; k++) uvs[p * 2 + k] = 0; }
      p += vc; u = p; v = i;
      ledger[i] = p;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    if (uvs) geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.computeBoundingSphere();
    const o = this.opts;
    const matOpts = { color: 0xffffff, vertexColors: true };
    if (o.map) {
      matOpts.map = o.map;
      if (o.alphaTest) {
        // CUTOUT, not blend: an alpha-tested sign still writes depth, so a
        // stop octagon sorts correctly against everything instead of ghosting
        // through the pole it is bolted to.
        matOpts.alphaTest = o.alphaTest;
      } else {
        matOpts.transparent = true; matOpts.depthWrite = false;
      }
    }
    if (o.transparent) { matOpts.transparent = true; matOpts.opacity = o.opacity == null ? 1 : o.opacity; matOpts.depthWrite = false; }
    if (o.decal) {
      // painted marking → polygonOffset so it hugs the surface instead of
      // hovering (the exact fix city/world.js:paintMesh documents for lane paint)
      matOpts.polygonOffset = true; matOpts.polygonOffsetFactor = -3; matOpts.polygonOffsetUnits = -3;
    }
    if (o.side) matOpts.side = o.side;
    const mat = o.unlit ? new THREE.MeshBasicMaterial(matOpts) : new THREE.MeshLambertMaterial(matOpts);
    mat._shared = true;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "detail-sheet-" + this.name;
    mesh.castShadow = false;
    mesh.receiveShadow = !o.unlit && !o.map;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    if (o.renderOrder != null) mesh.renderOrder = o.renderOrder;
    // Spare it from core/batch.js: it is ALREADY merged, and the V2 merge
    // re-materials its buckets with a shared plain material — which silently
    // drops polygonOffset and makes painted decals z-fight (world.js:paintMesh
    // documents this exact regression).
    mesh.userData.worldDetail = this.name;
    mesh.userData.roadPaint = !!o.decal;
    root.add(mesh);
    this.mesh = mesh;
    const cls = this.cls;
    scalables.push({
      cls: cls,
      apply: function (d) {
        if (cls === "solid" || d >= 1) { geo.setDrawRange(0, total); mesh.visible = true; return; }
        const k = Math.max(0, Math.min(n, Math.round(n * d)));
        const verts = k ? ledger[k - 1] : 0;
        geo.setDrawRange(0, verts);
        mesh.visible = verts > 0;
      },
    });
    if (tierApplied >= 0) {
      const d = densityFor(cls, tierApplied);
      if (d >= 1) geo.setDrawRange(0, total);
      else {
        const k = Math.max(0, Math.min(n, Math.round(n * d)));
        const verts = k ? ledger[k - 1] : 0;
        geo.setDrawRange(0, verts);
        mesh.visible = verts > 0;
      }
    }
    DK.stats.sheets++;
    DK.stats.drawCalls += 1;
    return mesh;
  };
  DK.sheet = function (name, opts) { return new Sheet(name, opts); };

  function colArray(hex, count) {
    _col.setHex(hex == null ? 0xffffff : hex);
    const a = new Array(count * 3);
    for (let i = 0; i < count; i++) { a[i * 3] = _col.r; a[i * 3 + 1] = _col.g; a[i * 3 + 2] = _col.b; }
    return a;
  }
  function uvQuad(r) {
    // r = {u0,v0,u1,v1}; vertex-for-vertex against quadXZ/quadWall's winding
    // above (v0, v1v1, v1v0 / v0, v0v1, v1v1).
    return [r.u0, r.v0, r.u1, r.v1, r.u1, r.v0, r.u0, r.v0, r.u0, r.v1, r.u1, r.v1];
  }
  // Atlas cell → uv rect, for an N×N grid indexed left-to-right, top-to-bottom.
  DK.atlasCell = function (index, grid) {
    const g = grid || 8, col = index % g, row = (index / g) | 0;
    return { u0: col / g, u1: (col + 1) / g, v0: 1 - (row + 1) / g, v1: 1 - row / g };
  };
  DK.colArray = colArray;
  DK.uvQuad = uvQuad;

  // =====================================================================
  //  PLACEMENT ORACLES — "is this spot legal?"
  // =====================================================================
  // Built fresh per world in DK.begin(city). Everything here is pure geometry
  // against live world records; no rng draws are taken, ever.
  const OR = DK.oracle = {
    city: null, roads: [], doors: [], props: null, rects: [],
    grid: null, rgrid: null, dgrid: null, cell: 24, bcell: 48,
  };

  function gridKey(ix, iz) { return ix * 8192 + iz; }
  // Insert a record into a bucket map under every cell its padded AABB touches.
  // The kerb walkers ask "is this legal?" tens of thousands of times; a linear
  // scan over every road and every door in the world would dominate buildCity.
  function bucket(map, rec, minX, maxX, minZ, maxZ, cell) {
    const i0 = Math.floor(minX / cell), i1 = Math.floor(maxX / cell);
    const j0 = Math.floor(minZ / cell), j1 = Math.floor(maxZ / cell);
    for (let ix = i0; ix <= i1; ix++) for (let iz = j0; iz <= j1; iz++) {
      const k = gridKey(ix, iz);
      let a = map.get(k); if (!a) { a = []; map.set(k, a); }
      a.push(rec);
    }
  }
  function lookup(map, x, z, cell) {
    return map ? map.get(gridKey(Math.floor(x / cell), Math.floor(z / cell))) : null;
  }

  DK.begin = function (city) {
    OR.city = city;
    OR.roads = [];
    OR.rgrid = new Map();
    const roads = city.roads || [], defW = (city.ROAD || 18);
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i];
      if (!r || !Number.isFinite(r.x) || !Number.isFinite(r.z) || !Number.isFinite(r.len)) continue;
      OR.roads.push(r);
      // PAD 3 covers every margin any caller passes to onRoad(), so a hit can
      // never be missed by falling into a neighbouring bucket.
      const half = (r.w != null ? r.w : defW) / 2 + 3;
      const hx = r.vertical ? half : r.len / 2 + 2;
      const hz = r.vertical ? r.len / 2 + 2 : half;
      bucket(OR.rgrid, r, r.x - hx, r.x + hx, r.z - hz, r.z + hz, OR.bcell);
    }
    // door approach segments — the math gate asserts every shop door sits
    // within 45u of a road (tools/math-gate.mjs:136), and a prop parked in the
    // threshold would be the fastest way to make a shop feel broken. Reserve
    // the doorway AND its outward approach, exactly like props.js:nearDoor.
    OR.doors = [];
    OR.dgrid = new Map();
    const lotSets = [city.lots || []];
    if (city.annex && city.annex.lots) lotSets.push(city.annex.lots);
    for (const set of lotSets) {
      for (let i = 0; i < set.length; i++) {
        const b = set[i] && set[i].building, d = b && b.door;
        if (!d || !Number.isFinite(d.x)) continue;
        const nx = Number.isFinite(d.nx) ? d.nx : 0, nz = Number.isFinite(d.nz) ? d.nz : 0;
        const rec = { ax: d.x, az: d.z, bx: d.x - nx * 5.0, bz: d.z - nz * 5.0 };
        OR.doors.push(rec);
        // PAD 7 > the largest doorR any caller asks for (4.2)
        bucket(OR.dgrid, rec,
          Math.min(rec.ax, rec.bx) - 7, Math.max(rec.ax, rec.bx) + 7,
          Math.min(rec.az, rec.bz) - 7, Math.max(rec.az, rec.bz) + 7, OR.bcell);
      }
    }
    // building footprints (so nothing is buried inside a wall), bucketed
    OR.rects = [];
    for (const set of lotSets) {
      for (let i = 0; i < set.length; i++) {
        const lot = set[i], b = lot && lot.building;
        if (!b || b.park || !(b.w > 0) || !(b.d > 0)) continue;
        const ox = Number.isFinite(b.ox) ? b.ox : lot.cx, oz = Number.isFinite(b.oz) ? b.oz : lot.cz;
        if (!Number.isFinite(ox) || !Number.isFinite(oz)) continue;
        OR.rects.push({ minX: ox - b.w / 2, maxX: ox + b.w / 2, minZ: oz - b.d / 2, maxZ: oz + b.d / 2 });
      }
    }
    OR.grid = new Map();
    for (let i = 0; i < OR.rects.length; i++) {
      const r = OR.rects[i];
      // PAD 2 > the largest `pad` insideBuilding() is ever asked for, so a
      // point just outside a wall still finds that wall's bucket.
      bucket(OR.grid, r, r.minX - 2, r.maxX + 2, r.minZ - 2, r.maxZ + 2, OR.cell);
    }
    // everything props.js already placed + everything WE place, so two passes
    // never stack two props on one square metre
    OR.props = new Map();
    const sp = city.streetProps || [];
    for (let i = 0; i < sp.length; i++) DK.claim(sp[i].x, sp[i].z);
    DK.stats = { batches: 0, sheets: 0, instances: 0, drawCalls: 0, colliders: 0 };
    _pendingColliders = 0;
  };

  // ---- occupancy: a coarse 2m claim grid --------------------------------
  DK.claim = function (x, z) {
    const k = gridKey(Math.round(x / 2), Math.round(z / 2));
    OR.props.set(k, (OR.props.get(k) || 0) + 1);
  };
  DK.occupied = function (x, z, ring) {
    const ix = Math.round(x / 2), iz = Math.round(z / 2), r = ring == null ? 1 : ring;
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      if (OR.props.get(gridKey(ix + a, iz + b))) return true;
    }
    return false;
  };

  // ---- roads: is this point on a carriageway? ---------------------------
  // Same math city/props.js:clearOfRoadSurface uses, including the per-road
  // stamped width (a 24m highway deck is not the 18m city grid default).
  DK.onRoad = function (x, z, margin) {
    const m = margin == null ? 0.4 : margin;
    const roads = lookup(OR.rgrid, x, z, OR.bcell), def = (OR.city && OR.city.ROAD) || 18;
    if (!roads) return false;
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i];
      const half = (r.w != null ? r.w : def) / 2 + m;
      if (r.vertical) {
        if (Math.abs(z - r.z) > r.len / 2 + 1) continue;
        if (Math.abs(x - r.x) < half) return true;
      } else {
        if (Math.abs(x - r.x) > r.len / 2 + 1) continue;
        if (Math.abs(z - r.z) < half) return true;
      }
    }
    return false;
  };

  function segD2(px, pz, ax, az, bx, bz) {
    const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
    const den = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / den));
    const dx = px - (ax + vx * t), dz = pz - (az + vz * t);
    return dx * dx + dz * dz;
  }
  DK.nearDoor = function (x, z, radius) {
    const rr = radius == null ? 3.2 : radius, r2 = rr * rr;
    const d = lookup(OR.dgrid, x, z, OR.bcell);
    if (!d) return false;
    for (let i = 0; i < d.length; i++) {
      if (segD2(x, z, d[i].ax, d[i].az, d[i].bx, d[i].bz) < r2) return true;
    }
    return false;
  };
  DK.insideBuilding = function (x, z, pad) {
    const p = pad == null ? 0.3 : pad;
    const a = OR.grid && OR.grid.get(gridKey(Math.floor(x / OR.cell), Math.floor(z / OR.cell)));
    if (!a) return false;
    for (let i = 0; i < a.length; i++) {
      const r = a[i];
      if (x > r.minX - p && x < r.maxX + p && z > r.minZ - p && z < r.maxZ + p) return true;
    }
    return false;
  };
  // The one call every placement site should make.
  DK.free = function (x, z, o) {
    o = o || {};
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    // NOTHING GENERIC STANDS ON RESTRICTED GROUND. Every dressing pass funnels
    // through this oracle, and three of them (utility_lines, street_furniture,
    // world_grime) walk DK.streetRoads with their OWN loops rather than
    // eachKerb — which is how a line of utility poles ended up marching down
    // the airport's east perimeter INSIDE the airside keep-out. One call here
    // and all of them inherit the law (city/roadrules.js) instead of each
    // growing its own test. `o.keepOut = false` opts a pass out; no caller
    // does today. Degrade-safe: no roadrules.js, original behaviour.
    // NOTE the null: `o.road` here is an existing BOOLEAN switch for the
    // carriageway test, not a road record. The road-aware half of the law
    // (a place this road is merely passing) runs in eachKerb above, which is
    // the only walker that knows which road a point belongs to.
    if (o.keepOut !== false && CBZ.roadPropClear && !CBZ.roadPropClear(x, z, null)) return false;
    if (o.road !== false && DK.onRoad(x, z, o.roadMargin)) return false;
    if (o.door !== false && DK.nearDoor(x, z, o.doorR)) return false;
    if (o.build !== false && DK.insideBuilding(x, z, o.buildPad)) return false;
    if (o.props !== false && DK.occupied(x, z, o.ring)) return false;
    // A GAP BETWEEN TWO BUILDINGS IS A ROUTE, NOT A SHELF (city/props.js's
    // ALLEY LAW). Every dressing pass funnels through this oracle, and THREE of
    // them fill the back of a block — the dumpster/crate/barrier walk, the
    // bollard triples, the weeds — with no idea whether the metre they were
    // filling was a pavement or the only way through. One call here and all of
    // them inherit it, exactly like the roadPropClear adoption above.
    //   o.alley = {solid, r}  declare a collider and its half-width
    //   o.alley = false       opt out (nothing does today)
    // LAST on purpose: alleyOk CLAIMS the slot on success, so it must not be
    // spent on a point some cheaper test above was going to refuse anyway.
    // Degrade-safe: no props.js, original behaviour.
    if (o.alley !== false && CBZ.alleyOk && !CBZ.alleyOk(x, z, o.alley || null)) return false;
    return true;
  };

  // ---- ground height ----------------------------------------------------
  // The gameplay-facing oracle. CBZ.terrainHeight is the DECORATIVE backdrop
  // (config.js:627 — exactly 0 across the whole walkable world) and is the
  // wrong function here; landmasses publish their real floor through
  // registerCityGroundHeight, which is what cityGroundHeightAt sums.
  DK.groundY = function (x, z) {
    if (CBZ.cityGroundHeightAt) { const h = +CBZ.cityGroundHeightAt(x, z); return Number.isFinite(h) && h > 0 ? h : 0; }
    return 0;
  };

  // ---- colliders --------------------------------------------------------
  let _pendingColliders = 0;
  // Only genuinely solid things get one: poles, bollards, dumpsters, cabinets,
  // barriers. Flat decals, litter and wall/roof dressing never do — a collider
  // on a crisp packet is how a city becomes unwalkable.
  DK.solid = function (x, z, rx, rz, ref, y0, y1) {
    if (!CBZ.colliders) return;
    // noCam: the chase camera must never snap in on a bollard or a pole
    // (city/props.js:solidCollider sets the same flag for the same reason).
    const c = { minX: x - rx, maxX: x + rx, minZ: z - rz, maxZ: z + rz, ref: ref || null, noCam: true };
    // Only ATTACH the height gate when there is one — core/batch.js:376 keys
    // its carveable-wall test on `c.y1 == null`, so an explicit undefined is
    // equivalent but a missing key is what every other producer writes.
    if (y0 != null) c.y0 = y0;
    if (y1 != null) c.y1 = y1;
    CBZ.colliders.push(c);
    _pendingColliders++;
    DK.stats.colliders++;
  };
  DK.flushColliders = function () {
    if (_pendingColliders && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    _pendingColliders = 0;
  };

  // =====================================================================
  //  WORLD WALKERS — the two iterators every pass is built on
  // =====================================================================
  // Streets worth dressing: the city grid, the island annex, town lanes.
  // NOT highways/bridges/causeways: those are elevated 24m decks whose kerb
  // line is nowhere near the ground plane, and a pole at ground level beside
  // an elevated deck reads as a bug.
  DK.streetRoads = function (city) {
    const out = [];
    const roads = city.roads || [];
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i];
      if (!r || !Number.isFinite(r.len) || r.len < 8) continue;
      const d = r.district;
      if (d === "highway" || d === "bridge" || d === "link" || d === "ramp" || d === "goldspire") continue;
      if (r.w != null && r.w > 20) continue;
      if (r.elevated || (r.y != null && r.y > 0.6)) continue;
      // NOT restricted ground either (city/roadrules.js). A road reserved to a
      // vehicle class — the airport apron's service lanes, a compound's gate
      // spur — is not a street, and this walker is what strung city kerb
      // furniture down the middle of a live airfield. One call, shared law,
      // and it fixes utility_lines / street_furniture / world_grime at once
      // because all three iterate THIS list. Degrade-safe.
      if (CBZ.roadPropRoadOk && !CBZ.roadPropRoadOk(r)) continue;
      out.push(r);
    }
    return out;
  };
  // Walk both kerbs of every street at `spacing`, calling cb with a legal,
  // unclaimed point. Returns how many points were yielded.
  //   cb({x, z, y, nx, nz, yaw, road, t, side})
  //     nx/nz = outward normal (away from the carriageway)
  //     yaw   = rotation for a prop whose FRONT is local +z, facing the street
  DK.eachKerb = function (city, spacing, salt, cb, opts) {
    opts = opts || {};
    const roads = opts.roads || DK.streetRoads(city);
    const def = city.ROAD || 18;
    const band = opts.band == null ? 1.15 : opts.band;
    let placed = 0;
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i];
      const off = (r.w != null ? r.w : def) / 2 + band;
      const n = Math.floor(r.len / spacing);
      if (n < 1) continue;
      for (let k = 0; k <= n; k++) {
        const t = -r.len / 2 + (k + 0.5) * (r.len / (n + 1));
        for (let s = -1; s <= 1; s += 2) {
          const x = r.vertical ? r.x + s * off : r.x + t;
          const z = r.vertical ? r.z + t : r.z + s * off;
          const nx = r.vertical ? s : 0, nz = r.vertical ? 0 : s;
          // ROADS CONNECT PLACES, THEY DO NOT OVERLAP THEM — and neither does
          // their furniture. A kerb point inside a place this road is merely
          // passing, or inside any declared keep-out, is refused before any
          // pass ever sees it (city/roadrules.js). Every DK dressing pass
          // inherits it here; none of them changed a line. Degrade-safe.
          if (CBZ.roadPropClear && !CBZ.roadPropClear(x, z, r)) continue;
          if (!DK.free(x, z, opts.free)) continue;
          const yaw = Math.atan2(-nx, -nz);
          const res = cb({
            x: x, z: z, y: DK.groundY(x, z), nx: nx, nz: nz, yaw: yaw,
            road: r, t: t, side: s, index: placed,
            h: DK.h01(x, z, salt),
          });
          if (res !== false) { DK.claim(x, z); placed++; }
        }
      }
    }
    return placed;
  };
  // Every real building in the world, mainland + annex + towns, with its
  // footprint, height and door already resolved. Skips parks and anything
  // without the standard makeBuilding record (buildings.js:3295).
  let _buildCache = null, _buildCacheFor = null;
  function buildingList(city) {
    if (_buildCacheFor === city && _buildCache) return _buildCache;
    const sets = [city.lots || []];
    if (city.annex && city.annex.lots) sets.push(city.annex.lots);
    const seen = new Set(), out = [];
    for (const set of sets) {
      for (let i = 0; i < set.length; i++) {
        const lot = set[i], b = lot && lot.building;
        if (!b || b.park || !b.group || seen.has(b.group)) continue;
        const w = +b.w, d = +b.d, h = +b.h;
        if (!(w > 2 && d > 2 && h > 2)) continue;
        seen.add(b.group);
        const ox = Number.isFinite(b.ox) ? b.ox : lot.cx;
        const oz = Number.isFinite(b.oz) ? b.oz : lot.cz;
        if (!Number.isFinite(ox) || !Number.isFinite(oz)) continue;
        const gy = DK.groundY(ox, oz);
        out.push({
          lot: lot, b: b, x: ox, z: oz, w: w, d: d, h: h,
          y0: gy, roofY: gy + h,
          storeys: b.storeys || Math.max(1, Math.round(h / (b.FH || 3.2))),
          door: b.door || null, shop: !!(b.shop || (lot.kind && lot.kind !== "home")),
          key: DK.h01(ox, oz, 0xb17e),
        });
      }
    }
    // SHUFFLED, deterministically. Every dressing pass carries a hard cap, and
    // a cap applied in array order would dress the first N buildings fully and
    // leave the rest of the map bare — a visible, geographic bias. Iterating
    // in hash order makes a cap remove a spatially UNIFORM subset instead.
    out.sort(function (a, b2) { return a.key - b2.key; });
    for (let i = 0; i < out.length; i++) out[i].index = i;
    _buildCache = out; _buildCacheFor = city;
    return out;
  }
  DK.buildingCount = function (city) { return buildingList(city).length; };
  DK.eachBuilding = function (city, cb) {
    const list = buildingList(city);
    for (let i = 0; i < list.length; i++) cb(list[i]);
    return list.length;
  };
  // The four wall faces of an axis-aligned building shell.
  //   returns [{nx,nz, cx,cz, span}] — span = face width along the wall
  DK.buildingFaces = function (bi) {
    return [
      { nx: 0, nz: -1, cx: bi.x, cz: bi.z - bi.d / 2, span: bi.w },
      { nx: 0, nz: 1, cx: bi.x, cz: bi.z + bi.d / 2, span: bi.w },
      { nx: -1, nz: 0, cx: bi.x - bi.w / 2, cz: bi.z, span: bi.d },
      { nx: 1, nz: 0, cx: bi.x + bi.w / 2, cz: bi.z, span: bi.d },
    ];
  };
  // Is this face the one with the front door? (Doors get awnings and signage,
  // never a fire escape or a dumpster.)
  DK.isDoorFace = function (bi, face) {
    const d = bi.door;
    if (!d) return false;
    const px = d.x - face.cx, pz = d.z - face.cz;
    return Math.abs(px * face.nx + pz * face.nz) < 2.5;
  };

  // =====================================================================
  //  PASS REGISTRY + THE POST-BUILD HOOK
  // =====================================================================
  const passes = [];
  DK.register = function (order, name, fn) { passes.push({ order: order, name: name, fn: fn }); };

  DK.stats = { batches: 0, sheets: 0, instances: 0, drawCalls: 0, colliders: 0 };

  function runPasses(city) {
    if (!CFG.DETAIL_WORLD_V1) return;
    if (!city || !city.root) return;
    if (city._worldDetailDone) return;      // buildCity is once-only, but be idempotent anyway
    city._worldDetailDone = true;
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    try { DK.begin(city); } catch (e) { console.error("[world-detail begin]", e); return; }
    passes.sort(function (a, b) { return a.order - b.order; });
    for (let i = 0; i < passes.length; i++) {
      try { passes[i].fn(city, DK); } catch (e) { console.error("[world-detail " + passes[i].name + "]", e); }
    }
    DK.flushColliders();
    if (tierApplied >= 0) applyTier(tierApplied);
    else if (CBZ.qualityLevel != null) applyTier(CBZ.qualityLevel);
    const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    CBZ.worldDetailStats = {
      batches: DK.stats.batches, sheets: DK.stats.sheets,
      instances: DK.stats.instances, drawCalls: DK.stats.drawCalls,
      colliders: DK.stats.colliders, ms: Math.round(ms),
    };
  }
  DK.run = runPasses;

  // ---- WRAP city/world.js's furnish hook --------------------------------
  // world.js:934 calls CBZ.cityProps(city) as the last "let sibling modules
  // furnish the city" step. Wrapping it (rather than editing world.js, which
  // several agents share) gives us the fully-generated world INCLUDING every
  // prop props.js placed, so the occupancy oracle can avoid all of them.
  // House rule (CLAUDE.md): copy every *Wrapped marker forward so a chain of
  // wrappers never loses a sibling's flag.
  function installHook() {
    const prev = CBZ.cityProps;
    if (typeof prev === "function") {
      if (prev._worldDetailWrapped) return true;
      const wrapped = function (city) {
        let out;
        try { out = prev.apply(this, arguments); } finally { runPasses(city); }
        return out;
      };
      for (const k in prev) { if (/Wrapped$/.test(k)) wrapped[k] = prev[k]; }
      wrapped._worldDetailWrapped = true;
      CBZ.cityProps = wrapped;
      return true;
    }
    return false;
  }
  if (!installHook()) {
    // Fallback only: props.js somehow absent. A landmass builder at a very
    // high order still runs inside buildCity, after every other landmass —
    // just without props.js's furniture in the occupancy map.
    if (CBZ.addLandmass) CBZ.addLandmass(function (city) { runPasses(city); }, 99);
  }
})();
