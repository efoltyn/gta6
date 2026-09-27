/* ============================================================
   city/highways.js — THE FREEWAY BUILDER.

   CBZ.buildHighway(root, opts) is the one builder every causeway, approach
   road and the continental network (highwaynet.js) calls. It returns its
   record SYNCHRONOUSLY (drivable city.roads records, footprint, deckTop) and
   builds its GEOMETRY LATE — in one landmass pass after the continent has
   published the coast (order 97.5). That is not a convenience, it is the only
   way to be honest: whether a stretch of deck crosses water, which other roads
   T into it, where the towns are — none of that exists when an island module
   at order 30 calls this. Built late, every highway knows all of it.

   THE CROSS-SECTION (paved roads; dirt tracks stay plain)
     lanes as the record says (traffic drives CBZ.roadLanes' lane centres —
     the paint is laid on exactly those offsets), a 3 m outer shoulder with a
     solid white edge line and milled rumble strips, an inner shoulder with a
     yellow edge line, 3 m dashes on a 12 m cycle, raised pavement markers,
     and on divided roads an F-shape concrete median barrier. The shoulder is
     ADDED outside the record's travelled way, so a 24 m causeway record keeps
     every lane where it was; the deck is simply wider than the old ribbon.

   WATER: a deck 0.56 m over the sea is a CAUSEWAY ON FILL, so that is what
   it is drawn as: rip-rap armour stone from the shoulder down below the
   waterline on every side the coast oracle says is sea, and a W-beam
   guardrail on posts along it. (The old suspension-bridge dressing hung a
   26 m tower and a catenary off a deck lying ON the water — a bridge with no
   clearance is not a bridge. It is gone; the network's real bridge is the
   interchange flyover, city/interchange.js.)

   BENDS on the network are SUPERELEVATED (banked toward the centre, 4 %),
   and the bank is solid: a ground-height provider (worldmap.js
   registerCityGroundHeight) serves the same surface to feet, AI wheels and
   the player car, with a 1:2 fill slope outside the raised edge.

   PHYSICS OF THE FURNITURE: every barrier, guardrail and sound wall that is
   drawn is solid (CBZ.orientedCollider, height-banded), and nothing that is
   not drawn is. Colliders are only placed on straight axis-aligned runs,
   where AI lane-followers stay inside the lines; on filleted bends the AI
   drives the axis-aligned legs across the fillet, so furniture there is
   visual only (a traffic limitation, reported, not hidden). Every junction
   another road record makes with a highway gaps the barrier and the edge
   furniture, so traffic can still turn.

   DRAW CALLS: geometry is merged per ~400 m CHUNK per highway (deck, paint,
   furniture = 3 calls, each chunk frustum-culls on its own bounds); paint and
   furniture of chunks far from the camera are hidden by a tiny distance pass.
   All highways share one material per kind. Gantry steel and the one sign
   atlas are two draws for the whole world.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const CHUNK = 400;             // metres of route per merged chunk
  const STEP = 8;                // station spacing (deck/furniture sampling)
  const SHOULDER_OUT = 3.0;      // paved outer shoulder on multi-lane roads
  const BANK = 0.04;             // superelevation cross-slope on network bends
  const RUNOFF = 70;             // metres of bank runoff either side of an arc
  const DETAIL_FAR = 650;        // paint/furniture chunks beyond this hide

  let _highways = [];
  let _pending = [];
  let _lateDone = false;
  CBZ.cityHighways = function () { return _highways; };

  // ============================================================
  //  SMOOTH POLYLINE (highwaynet): fillet every interior corner into an arc.
  // ============================================================
  CBZ.highwaySmoothPath = function (pts, radius, step) {
    radius = radius || 60; step = step || 9;
    if (!pts || pts.length < 3) return (pts || []).map(function (p) { return { x: p.x, z: p.z }; });
    const out = [{ x: pts[0].x, z: pts[0].z }];
    for (let i = 1; i < pts.length - 1; i++) {
      const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      let ax = p1.x - p0.x, az = p1.z - p0.z, bx = p2.x - p1.x, bz = p2.z - p1.z;
      const la = Math.hypot(ax, az) || 1e-6, lb = Math.hypot(bx, bz) || 1e-6;
      ax /= la; az /= la; bx /= lb; bz /= lb;
      const dot = Math.max(-1, Math.min(1, ax * bx + az * bz));
      const turn = Math.acos(dot);
      if (turn < 0.02) { out.push({ x: p1.x, z: p1.z }); continue; }
      let r = radius, t = r * Math.tan(turn / 2);
      const tMax = Math.min(la * 0.45, lb * 0.45);
      if (t > tMax) { t = tMax; r = t / Math.tan(turn / 2); }
      const Ax = p1.x - ax * t, Az = p1.z - az * t;
      const Bx = p1.x + bx * t, Bz = p1.z + bz * t;
      const s = (ax * bz - az * bx) >= 0 ? 1 : -1;
      const Cx = Ax + (-az * s) * r, Cz = Az + (ax * s) * r;
      const a0 = Math.atan2(Az - Cz, Ax - Cx);
      let sweep = Math.atan2(Bz - Cz, Bx - Cx) - a0;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      const n = Math.max(2, Math.ceil(Math.abs(sweep) * r / step));
      for (let k = 0; k <= n; k++) {
        const ang = a0 + sweep * (k / n);
        out.push({ x: Cx + Math.cos(ang) * r, z: Cz + Math.sin(ang) * r });
      }
    }
    out.push({ x: pts[pts.length - 1].x, z: pts[pts.length - 1].z });
    return out;
  };

  // ============================================================
  //  SHARED MATERIALS (one of each for every highway in the world)
  // ============================================================
  let _mats = null;
  const _detailU = { value: 1 };
  function deckMaterial(hex, kind) {
    const m = new THREE.MeshLambertMaterial({ color: hex });
    m.onBeforeCompile = function (sh) {
      // the grain/patch/crack/wheel-path layer is ours only when the shared
      // street shader (CBZ.asphaltDetail) is not on this material
      if (!m._asphalt) sh.fragmentShader = "#define HW_OWN_GRAIN\n" + sh.fragmentShader;
      sh.uniforms.uDetail = _detailU;
      sh.uniforms.uKind = { value: kind };
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec4 aSec;\nattribute vec4 aLane;\nvarying vec4 vSec;\nvarying vec4 vLane;\nvarying vec3 vHw;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvSec = aSec; vLane = aLane; vHw = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", [
          "#include <common>",
          "uniform float uDetail; uniform float uKind;",
          "varying vec4 vSec; varying vec4 vLane; varying vec3 vHw;",
          // hash without sine (Hoskins) on a 256-periodic lattice: world
          // coordinates run to +-7 km, and a float hash of raw coordinates
          // there collapses to stripes on a mobile GPU
          "float hwH(vec2 p){ p = mod(p, 256.0); vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }",
          "float hwN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
          "  return mix(mix(hwH(i), hwH(i + vec2(1.0, 0.0)), f.x), mix(hwH(i + vec2(0.0, 1.0)), hwH(i + vec2(1.0, 1.0)), f.x), f.y); }",
        ].join("\n"))
        .replace("#include <color_fragment>", [
          "#include <color_fragment>",
          "{",
          "  vec2 w = vHw.xz;",
          "  float lat = abs(vSec.x), along = vSec.y;",
          "  float agg = hwH(floor(mod(w, 64.0) * 16.0));",                        // aggregate at ~6 cm
          "  float patchy = hwN(mod(w, 4000.0) * 0.045) * 0.6 + hwN(mod(w, 320.0) * 0.6) * 0.4;",   // repairs, oil, age
          "#ifdef HW_OWN_GRAIN",
          "  vec3 c = diffuseColor.rgb * (0.84 + 0.26 * patchy) * (0.92 + 0.16 * agg);",
          "#else",
          "  vec3 c = diffuseColor.rgb;",                                             // CBZ.asphaltDetail already did grain/patches/cracks/wheel paths
          "#endif",
          "  if (uKind < 0.5) {",                                                     // asphalt/concrete
          "    float o = lat - vLane.x;",
          "#ifdef HW_OWN_GRAIN",
          "    if (vLane.z > 0.5 && o > 0.0 && o < vLane.y * vLane.z) {",
          "      float lc = mod(o, vLane.y) - 0.5 * vLane.y;",
          "      float tr = smoothstep(0.42, 0.0, abs(abs(lc) - 0.85));",              // polished wheel paths
          "      c *= 1.0 - 0.11 * tr;",
          "      c *= 1.0 + 0.05 * smoothstep(0.3, 0.0, abs(lc)) * uDetail;",         // oil-drip band between them
          "    }",
          "#endif",
          "    float sh = step(vSec.z + 0.2, lat) + step(lat, vSec.w - 0.2) * step(0.9, vSec.w);",
          "    c *= 1.0 + 0.07 * min(sh, 1.0);",                                        // shoulders: lighter, less worn
          "    float g = step(0.55, fract(along / 0.3));",                              // milled rumble grooves, 0.3 m pitch
          "    float rbO = step(vSec.z + 0.3, lat) * step(lat, vSec.z + 0.72);",
          "    float rbI = step(1.2, vSec.w) * step(vSec.w - 0.62, lat) * step(lat, vSec.w - 0.25);",
          "    c *= 1.0 - (rbO + rbI) * g * 0.32 * uDetail;",
          "    c *= 1.0 + (rbO + rbI) * (1.0 - g) * 0.06 * uDetail;",
          "#ifdef HW_OWN_GRAIN",
          "    vec2 wc = mod(w, 800.0); float ck = abs(hwN(vec2(wc.x * 0.31 + along * 0.02, wc.y * 0.29)) - 0.5);",   // hairline cracks
          "    c *= 1.0 - 0.22 * smoothstep(0.010, 0.0, ck) * uDetail;",
          "#endif",
          "    if (uKind < -0.5) { float j = step(0.985, fract(along / 4.5)); c *= 1.0 - 0.25 * j; }", // concrete slab joints
          "  } else {",                                                                // dirt: ruts + gravel
          "    float rut = smoothstep(0.6, 0.0, abs(mod(lat, 3.6) - 1.8 - 0.9)) + smoothstep(0.6, 0.0, abs(mod(lat, 3.6) - 1.8 + 0.9));",
          "    c *= 1.0 - 0.12 * min(rut, 1.0);",
          "    c *= 0.9 + 0.2 * hwH(floor(mod(w, 64.0) * 7.0));",
          "  }",
          "  diffuseColor.rgb = c;",
          "}",
        ].join("\n"));
    };
    m.customProgramCacheKey = function () { return "hwdeck" + kind; };
    return m;
  }
  function mats() {
    if (_mats) return _mats;
    _mats = {
      asphalt: deckMaterial(0x2c2e33, 0),
      // bridge decks get their own, darker, fresher surfacing (a flyover is
      // newer pavement than the road it crosses and reads as its own layer)
      ramp: deckMaterial(0x202125, 0),
      concrete: deckMaterial(0x8a8e94, -1),
      dirt: deckMaterial(0x6b5a42, 1),
      // LIT paint (Lambert), pulled toward the camera in depth only: no
      // coplanar fight with the deck and no floating either.
      paint: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      furn: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    };
    if (CBZ.onQualityChange) CBZ.onQualityChange(function (lv) { _detailU.value = lv >= 1 ? 1 : 0; });
    // ONE asphalt for city streets and freeways: the street builder's shader
    // (world/materials.js) when it is loaded — base colour white, its tone
    // owns the albedo — chained after ours (rumble, shoulders stay ours).
    if (CBZ.asphaltDetail) {
      try {
        _mats.asphalt.color.setHex(0xffffff);
        CBZ.asphaltDetail(_mats.asphalt, { scale: 1, crackiness: 0.7, patchiness: 0.6, lanes: { laneW: 3.6, lanesPerDir: 3, median: 0 } });
      } catch (e) { _mats.asphalt.color.setHex(0x2c2e33); }
      try {
        _mats.ramp.color.setHex(0xffffff);
        CBZ.asphaltDetail(_mats.ramp, { scale: 1, crackiness: 0.25, patchiness: 0.15, tone: 0.72 });
      } catch (e) { _mats.ramp.color.setHex(0x202125); }
    }
    return _mats;
  }

  // ============================================================
  //  GEOMETRY ACCUMULATOR — flat-shaded, vertex-coloured, non-indexed.
  // ============================================================
  const _col = new THREE.Color();
  const PAL = {};
  function col(hex) {
    let c = PAL[hex];
    if (!c) { _col.setHex(hex); c = PAL[hex] = [_col.r, _col.g, _col.b]; }
    return c;
  }
  function Acc(withSec) { this.p = []; this.n = []; this.c = []; this.sec = withSec ? [] : null; this.lane = withSec ? [] : null; }
  Acc.prototype.tri = function (a, b, c, color, up, sa, sb, sc, lane) {
    let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    let vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (up && ny < 0) { const t = b; b = c; c = t; const ts = sb; sb = sc; sc = ts; nx = -nx; ny = -ny; nz = -nz; }
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-9) return;
    nx /= L; ny /= L; nz /= L;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    const cc = color || [1, 1, 1];
    this.c.push(cc[0], cc[1], cc[2], cc[0], cc[1], cc[2], cc[0], cc[1], cc[2]);
    if (this.sec) {
      this.sec.push(sa[0], sa[1], sa[2], sa[3], sb[0], sb[1], sb[2], sb[3], sc[0], sc[1], sc[2], sc[3]);
      this.lane.push(lane[0], lane[1], lane[2], lane[3], lane[0], lane[1], lane[2], lane[3], lane[0], lane[1], lane[2], lane[3]);
    }
  };
  Acc.prototype.quad = function (a, b, c, d, color, up) { this.tri(a, b, c, color, up); this.tri(a, c, d, color, up); };
  // oriented box: centre, half extents along (ux,uz) / up / (vx,vz)
  Acc.prototype.box = function (cx, cy, cz, ux, uz, hl, hh, hw, color, noBottom) {
    const vx = -uz, vz = ux;
    const P = [];
    for (let i = 0; i < 8; i++) {
      const sl = (i & 1) ? 1 : -1, sw = (i & 2) ? 1 : -1, sy = (i & 4) ? 1 : -1;
      P.push([cx + ux * hl * sl + vx * hw * sw, cy + hh * sy, cz + uz * hl * sl + vz * hw * sw]);
    }
    const F = [[4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];
    if (!noBottom) F.push([0, 1, 3, 2]);
    for (const f of F) this.quad(P[f[0]], P[f[1]], P[f[2]], P[f[3]], color);
  };
  Acc.prototype.empty = function () { return !this.p.length; };
  Acc.prototype.mesh = function (mat) {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    if (this.sec) {
      g.setAttribute("aSec", new THREE.Float32BufferAttribute(this.sec, 4));
      g.setAttribute("aLane", new THREE.Float32BufferAttribute(this.lane, 4));
      // CBZ.asphaltDetail's lane contract (world/materials.js): (u, e, w) =
      // median-relative signed lateral, metres to the deck edge, lane-effect
      // weight (only the standard 3.6 m x3 cross-section it is compiled for)
      const n = this.sec.length / 4, al = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const lat = this.sec[i * 4], med = this.lane[i * 4], lw = this.lane[i * 4 + 1], nl = this.lane[i * 4 + 2], hf = this.lane[i * 4 + 3];
        const a = Math.abs(lat);
        al[i * 3] = (lat < 0 ? -1 : 1) * Math.max(0, a - med);
        al[i * 3 + 1] = Math.max(0, (hf || a) - a);
        al[i * 3 + 2] = (nl === 3 && Math.abs(lw - 3.6) < 1e-3) ? 1 : 0;
      }
      g.setAttribute("asphaltLane", new THREE.BufferAttribute(al, 3));
    }
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false; m.updateMatrix();
    m.userData.hwy = true;            // batch-exempt: custom shader / polygonOffset survive
    return m;
  };

  // ============================================================
  //  STATIONS — the route resampled every <= STEP m, with frames + s.
  // ============================================================
  function stationize(path, step) {
    const st = [];
    let s = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 1e-6) continue;
      const n = Math.max(1, Math.ceil(L / step));
      for (let k = (st.length ? 1 : 0); k <= n; k++) {
        const t = k / n;
        st.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, s: s + L * t, seg: i, vtx: k === 0 || k === n });
      }
      s += L;
    }
    // frames: tangent (tx,tz), lateral n = (tz,-tx), mitre scale at path vertices
    for (let i = 0; i < st.length; i++) {
      const p = st[i], a = st[Math.max(0, i - 1)], b = st[Math.min(st.length - 1, i + 1)];
      let t0x = p.x - a.x, t0z = p.z - a.z, t1x = b.x - p.x, t1z = b.z - p.z;
      const l0 = Math.hypot(t0x, t0z), l1 = Math.hypot(t1x, t1z);
      if (l0 > 1e-6) { t0x /= l0; t0z /= l0; } else { t0x = t1x / (l1 || 1); t0z = t1z / (l1 || 1); }
      if (l1 > 1e-6) { t1x /= l1; t1z /= l1; } else { t1x = t0x; t1z = t0z; }
      let tx = t0x + t1x, tz = t0z + t1z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      p.tx = tx; p.tz = tz; p.nx = tz; p.nz = -tx;
      p.mit = 1 / Math.max(0.5, tx * t1x + tz * t1z);
      p.turn = t0x * t1z - t0z * t1x;               // signed turn at this station (for banking)
      p.dn = (t1x - t0x) * p.nx + (t1z - t0z) * p.nz; // >0: the curve centre is on the +n side
    }
    return st;
  }
  // straight axis-aligned runs: [i0, i1] station ranges
  function straightRuns(st) {
    const runs = [];
    let i0 = 0;
    function axisOf(i) {
      const a = st[i], b = st[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      if (Math.abs(dx / L) < 1e-4) return "v";
      if (Math.abs(dz / L) < 1e-4) return "h";
      return null;
    }
    for (let i = 0; i < st.length - 1; i++) {
      const ax = axisOf(i);
      const nxt = i + 1 < st.length - 1 ? axisOf(i + 1) : null;
      if (ax && nxt === ax) continue;
      if (ax && (i + 1 - i0) >= 1 && axisOf(i0) === ax) runs.push({ i0: i0, i1: i + 1, axis: ax });
      i0 = i + 1;
    }
    return runs;
  }

  // ============================================================
  //  CBZ.buildHighway — record now, geometry in the late pass.
  // ============================================================
  CBZ.buildHighway = function (root, opts) {
    opts = opts || {};
    const cityRoads = opts.cityRoads || (CBZ.city && CBZ.city.roads) || null;
    let path = (opts.path && opts.path.length >= 2) ? opts.path : [{ x: 0, z: 0 }, { x: 0, z: 100 }];
    const smooth = !!opts.smooth;
    if (smooth && path.length > 2) path = CBZ.highwaySmoothPath(path, opts.filletRadius || 60, opts.filletStep || 9);
    const width = opts.width != null ? opts.width : 24;
    const isDirt = opts.theme === "dirt";
    const lanesPerDir = Math.max(1, (opts.lanesPerDir != null ? opts.lanesPerDir : (!isDirt && width >= 23) ? 3 : 2) | 0);
    const laneW = opts.laneW != null ? opts.laneW : 3.6;
    const median = opts.median != null ? !!opts.median : (!isDirt && lanesPerDir >= 3);
    const medianW = opts.medianW != null ? opts.medianW : 1.2;
    const markings = opts.markings != null ? !!opts.markings : !isDirt;
    const medHalf = median ? medianW / 2 : 0;
    const trav = medHalf + lanesPerDir * laneW;           // edge-line offset == traffic's outer lane edge
    // multi-lane: a real 3 m shoulder OUTSIDE the record's travelled way;
    // single-lane approaches keep the footprint their caller sized
    const shoulder = isDirt ? 0 : (lanesPerDir >= 2 ? SHOULDER_OUT : Math.max(1.2, width / 2 - trav));
    const half = isDirt ? width / 2 : trav + shoulder;
    // tiny deterministic depth layer: separate builders meet at one elevation
    const deckY = 0.085 + ((_highways.length % 8) * 0.0008);
    const heightAt = typeof opts.heightAt === "function" ? opts.heightAt : null;
    function gradeAt(x, z) { return (heightAt ? heightAt(x, z) : 0) + deckY; }

    const group = new THREE.Group();
    group.name = "highway";
    group.userData.terrain = true;
    (root || CBZ.scene).add(group);

    let totLen = 0;
    for (let i = 0; i < path.length - 1; i++) totLen += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const p of path) {
      minX = Math.min(minX, p.x - half); maxX = Math.max(maxX, p.x + half);
      minZ = Math.min(minZ, p.z - half); maxZ = Math.max(maxZ, p.z + half);
    }

    // ---- DRIVABLE RECORDS (unchanged contract: axis-aligned legs) ----------
    const builtRoads = [];
    if (opts.registerRoads !== false && cityRoads) {
      const roads = cityRoads;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        const adx = Math.abs(b.x - a.x), adz = Math.abs(b.z - a.z);
        if (adx < 0.5 && adz < 0.5) continue;
        let seg;
        if (adx > adz) seg = { x: (a.x + b.x) / 2, z: a.z, vertical: false, len: adx, district: "highway" };
        else seg = { x: a.x, z: (a.z + b.z) / 2, vertical: true, len: adz, district: "highway" };
        seg.w = width; seg.lanesPerDir = lanesPerDir; seg.laneW = laneW;
        if (median) { seg.median = true; seg.medianW = medianW; }
        let dup = false;
        for (let k = 0; k < roads.length; k++) {
          const r = roads[k];
          if (!!r.vertical !== !!seg.vertical) continue;
          if (Math.abs(r.x - seg.x) < 1.0 && Math.abs(r.z - seg.z) < 1.0) { dup = true; break; }
        }
        if (dup) continue;
        if (CBZ.roadClamp) CBZ.roadClamp(seg, { dest: path[path.length - 1], origin: path[0], owner: opts.owner });
        roads.push(seg);
        builtRoads.push(seg);
      }
    }

    const rec = {
      group,
      deckTop: gradeAt,
      footprint: { minX, maxX, minZ, maxZ },
      length: totLen, deckY: deckY, width: width, half: half,
      roads: builtRoads,
      // the late pass's inputs
      spec: {
        path, smooth, isDirt, markings, theme: opts.theme || "asphalt", lanesPerDir, laneW, median, medianW,
        medHalf, trav, half, deckY, heightAt, route: opts.route || null,
        bank: smooth && !heightAt && !isDirt && opts.bank !== false,
      },
      // interchange hooks (set before the late pass): world rects where the
      // OUTER shoulder is replaced by an attached ramp lane, and points the
      // median barrier must clear (piers)
      cuts: [], barrierGaps: [], built: false,
    };
    _highways.push(rec);
    // before the late pass: queue; after it (a runtime road) or with no world
    // pipeline (tools): build at once against whatever world exists
    if (CBZ.addLandmass && !_lateDone) _pending.push(rec);
    else buildNow(rec, (CBZ.city && CBZ.city.arena) || CBZ.city || null);
    return rec;
  };

  // ============================================================
  //  THE LATE PASS
  // ============================================================
  const _chunks = [];            // {center:Vector3, detail:[mesh...]} for the distance pass
  const _bends = [];             // banked bend zones for the ground provider
  let _signAcc = null, _gantryAcc = null, _atlas = null;

  function waterOracle(city) {
    const T = city && city.mapTerrain;
    if (T && typeof T.shoreAt === "function") {
      return function (x, z) { try { return T.shoreAt(x, z) < -0.5; } catch (e) { return false; } };
    }
    return function () { return false; };
  }

  // junction gaps along straight runs from every other road record
  function junctionGaps(rec, st, runs, roads) {
    const S = rec.spec, gaps = [];
    if (!roads) return gaps;
    const own = new Set(rec.roads);
    for (const run of runs) {
      const a = st[run.i0], b = st[run.i1];
      const vert = run.axis === "v";
      const lo = vert ? Math.min(a.z, b.z) : Math.min(a.x, b.x), hi = vert ? Math.max(a.z, b.z) : Math.max(a.x, b.x);
      const c = vert ? a.x : a.z;
      const sgn = vert ? Math.sign(b.z - a.z) || 1 : Math.sign(b.x - a.x) || 1;
      for (let k = 0; k < roads.length; k++) {
        const r = roads[k];
        if (own.has(r) || !r || r.len == null) continue;
        if (!!r.vertical === vert) continue;                       // parallel: not a junction
        const along = vert ? r.z : r.x;                            // where it meets our axis
        // a road whose deck edge meets our deck END (a T stem's end) counts too
        const reachEnd = (r.w || 18) / 2 + 3;
        if (along < lo - reachEnd || along > hi + reachEnd) continue;
        const r0 = (vert ? r.x : r.z) - r.len / 2, r1 = (vert ? r.x : r.z) + r.len / 2;
        if (r1 < c - S.half - 4 || r0 > c + S.half + 4) continue;
        const s = a.s + (along - (vert ? a.z : a.x)) * sgn;
        const gh = (r.w || 18) / 2 + 6;
        // which lateral sides does it reach? n = (tz,-tx); lat = dot(p - a, n)
        const latOf = function (v) { return vert ? (v - c) * a.nx : (v - c) * a.nz; };
        const l0 = latOf(r0), l1 = latOf(r1);
        gaps.push({ s0: s - gh, s1: s + gh, neg: Math.min(l0, l1) < -1, pos: Math.max(l0, l1) > 1,
          m0: s - gh - 20, m1: s + gh + 20, cross: Math.min(l0, l1) < 1 && Math.max(l0, l1) > -1 });
      }
    }
    return gaps;
  }

  function buildNow(rec, city) {
    if (rec.built) return;
    rec.built = true;
    const S = rec.spec, M = mats();
    const st = stationize(S.path, STEP);
    if (st.length < 2) return;
    const runs = straightRuns(st);
    const isWater = waterOracle(city);
    const roads = city ? city.roads : null;
    const gaps = junctionGaps(rec, st, runs, roads);
    const totalS = st[st.length - 1].s;
    const half = S.half;

    // ---- banking: per-station cross slope e and the outer side ------------
    for (const p of st) { p.e = 0; p.out = 0; }
    if (S.bank) {
      const arc = st.map(function (p) { return Math.abs(p.dn) > 1e-3 ? (p.dn > 0 ? -1 : 1) : 0; });   // outer side
      // arc stations are the fillet's own vertices; a station within 6 m of
      // one (the midpoints stationize adds) is on the arc too
      for (let i = 0; i < st.length; i++) {
        let best = 0, side = 0;
        for (let j = 0; j < st.length; j++) {
          if (!arc[j]) continue;
          const d = Math.abs(st[j].s - st[i].s);
          if (d > RUNOFF + 6) continue;
          const v = d <= 6 ? BANK : BANK * (1 - (d - 6) / RUNOFF);
          if (v > best) { best = v; side = arc[j]; }
        }
        st[i].e = best; st[i].out = side;
      }
      // bend zones for the ground provider
      let z0 = -1;
      for (let i = 0; i <= st.length; i++) {
        const on = i < st.length && st[i].e > 0;
        if (on && z0 < 0) z0 = i;
        if (!on && z0 >= 0) {
          const pts = st.slice(Math.max(0, z0 - 1), Math.min(st.length, i + 1));
          let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
          const reach = half + 2 * BANK * 2 * half + 1;
          for (const p of pts) { bx0 = Math.min(bx0, p.x - reach); bx1 = Math.max(bx1, p.x + reach); bz0 = Math.min(bz0, p.z - reach); bz1 = Math.max(bz1, p.z + reach); }
          _bends.push({ pts: pts, half: half, minX: bx0, maxX: bx1, minZ: bz0, maxZ: bz1 });
          z0 = -1;
        }
      }
    }
    // height of the road surface at station i, lateral offset lat
    function yAt(p, lat) {
      const x = p.x + p.nx * lat, z = p.z + p.nz * lat;
      let y = (S.heightAt ? S.heightAt(x, z) : 0) + S.deckY;
      if (p.e > 0) { const l = Math.max(-half, Math.min(half, lat)); y += p.e * (p.out * l + half); }
      return y;
    }
    function groundAt(x, z) { return S.heightAt ? S.heightAt(x, z) : 0; }
    function P3(p, lat, dy) { const m = p.mit || 1; return [p.x + p.nx * lat * m, yAt(p, lat) + (dy || 0), p.z + p.nz * lat * m]; }
    // interpolated station at arbitrary s (for dashes, posts)
    function at(s) {
      let lo = 0, hi = st.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (st[mid].s <= s) lo = mid; else hi = mid; }
      const a = st[lo], b = st[hi], t = b.s > a.s ? Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s))) : 0;
      const nx = a.nx + (b.nx - a.nx) * t, nz = a.nz + (b.nz - a.nz) * t, nl = Math.hypot(nx, nz) || 1;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, s: s, nx: nx / nl, nz: nz / nl, tx: -nz / nl, tz: nx / nl,
        e: a.e + (b.e - a.e) * t, out: a.out || b.out, mit: 1 };
    }
    function inGap(s, side, median) {
      for (const g of gaps) {
        if (median) { if (g.cross && s >= g.m0 && s <= g.m1) return true; continue; }
        if (s >= g.s0 && s <= g.s1 && (side < 0 ? g.neg : g.pos)) return true;
      }
      return false;
    }
    function isCut(p, side) {
      if (!rec.cuts.length) return false;
      const x = p.x + p.nx * side * (S.trav + 0.6), z = p.z + p.nz * side * (S.trav + 0.6);
      for (const c of rec.cuts) if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) return true;
      return false;
    }
    function waterSide(p, side) {
      const o = half + 3;
      return isWater(p.x + p.nx * side * o, p.z + p.nz * side * o);
    }
    // THE SHOULDER IS DECK, NOT SEA. A causeway's Link region was sized by its
    // caller to the old 24 m ribbon; the water oracle (waterfield overDeck)
    // would call the new shoulder water and float a car parked on it. Widen
    // the region to the deck, under the caller's own name, per straight run.
    if (city && city.regions && CBZ.registerCityRegion) {
      for (const run of runs) {
        const a = st[run.i0], b = st[run.i1], mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        const need = { minX: Math.min(a.x, b.x) - half - 0.3, maxX: Math.max(a.x, b.x) + half + 0.3,
          minZ: Math.min(a.z, b.z) - half - 0.3, maxZ: Math.max(a.z, b.z) + half + 0.3 };
        let host = null;
        for (const r of city.regions) {
          if (!r || r.kind === "circle" || !/bridge|causeway|link/i.test(r.name || "")) continue;
          if (mx >= r.minX && mx <= r.maxX && mz >= r.minZ && mz <= r.maxZ) { host = r; break; }
        }
        if (!host) continue;
        const pad = host.pad || 0;
        if (host.minX - pad <= need.minX && host.maxX + pad >= need.maxX && host.minZ - pad <= need.minZ && host.maxZ + pad >= need.maxZ) continue;
        CBZ.registerCityRegion(city, { name: host.name, subtitle: host.subtitle, biome: host.biome, kind: "rect",
          minX: need.minX, maxX: need.maxX, minZ: need.minZ, maxZ: need.maxZ, pad: 0.5 });
      }
    }
    for (const p of st) {
      p.cutN = isCut(p, -1); p.cutP = isCut(p, 1);
      p.wN = waterSide(p, -1); p.wP = waterSide(p, 1);
    }
    // stations a long strip needs: a flat straight run is exact with a vertex
    // every 64 m, a bend, a bank or a terrain-following deck needs all of them
    for (let i = 0; i < st.length; i++) {
      const p = st[i], q = st[Math.max(0, i - 1)];
      p.keep = !!S.heightAt || p.e > 0 || Math.abs(p.dn) > 1e-6 || (i % 8) === 0 ||
        p.cutN !== q.cutN || p.cutP !== q.cutP || p.wN !== q.wN || p.wP !== q.wP;
    }

    // ---- chunks ------------------------------------------------------------
    const chunks = [];
    function chunkOf(s) {
      const k = Math.max(0, Math.min(Math.floor(totalS / CHUNK), Math.floor(s / CHUNK)));
      let c = chunks[k];
      if (!c) c = chunks[k] = { deck: new Acc(true), paint: new Acc(false), furn: new Acc(false), s0: k * CHUNK };
      return c;
    }

    // ---- DECK --------------------------------------------------------------
    const laneAttr = [S.isDirt ? 0 : S.medHalf, S.laneW, S.isDirt ? 0 : S.lanesPerDir, half];
    // A JUNCTION BOX IS PLAIN ASPHALT: no rumble, no lane paint, no markers
    // where another road's box crosses this deck. The deck is split exactly
    // at every box boundary so the rumble stops square, not on a station.
    function inBox(sq) {
      for (const g of gaps) if (sq >= g.s0 && sq <= g.s1) return true;
      return false;
    }
    const cutsS = [];
    for (const g of gaps) { if (g.s0 > 0 && g.s0 < totalS) cutsS.push(g.s0); if (g.s1 > 0 && g.s1 < totalS) cutsS.push(g.s1); }
    cutsS.sort(function (x, y) { return x - y; });
    const deckPts = [];
    let ci = 0;
    for (let i = 0; i < st.length; i++) {
      while (ci < cutsS.length && cutsS[ci] < st[i].s - 1e-6) {
        const q = at(cutsS[ci]);
        const lo = st[Math.max(0, i - 1)];
        q.cutN = lo.cutN; q.cutP = lo.cutP; q.e = lo.e; q.out = lo.out; q.mit = 1;
        if (!deckPts.length || cutsS[ci] > deckPts[deckPts.length - 1].s + 1e-3) deckPts.push(q);
        ci++;
      }
      deckPts.push(st[i]);
    }
    for (let i = 0; i < deckPts.length - 1; i++) {
      const a = deckPts[i], b = deckPts[i + 1], C = chunkOf((a.s + b.s) / 2);
      const eN_a = a.cutN ? S.trav : half, eP_a = a.cutP ? S.trav : half;
      const eN_b = b.cutN ? S.trav : half, eP_b = b.cutP ? S.trav : half;
      const aL = P3(a, -eN_a), aR = P3(a, eP_a), bL = P3(b, -eN_b), bR = P3(b, eP_b);
      const va = a.s - C.s0, vb = b.s - C.s0;
      const box = inBox((a.s + b.s) / 2);
      const eo = (S.isDirt || box) ? 1e4 : S.trav, ei = (S.median && !S.isDirt && !box) ? S.medHalf : 0;
      const la = box ? [0, 3.6, 0, half] : laneAttr;
      C.deck.tri(aL, aR, bR, null, true, [-eN_a, va, eo, ei], [eP_a, va, eo, ei], [eP_b, vb, eo, ei], la);
      C.deck.tri(aL, bR, bL, null, true, [-eN_a, va, eo, ei], [eP_b, vb, eo, ei], [-eN_b, vb, eo, ei], la);
    }

    // ---- PAINT (paved only) -------------------------------------------------
    const WHITE = col(0xe6e9ec), YELLOW = col(0xdcb035), RPM = col(0xf5f3e8), RPMY = col(0xe8b820);
    function stripe(s0, s1, lat, w, color) {
      // solid line along [s0,s1] at lateral lat, sampled on stations
      const pts = [at(s0)];
      for (const p of st) if (p.s > s0 && p.s < s1 && p.keep) pts.push(p);
      pts.push(at(s1));
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], C = chunkOf((a.s + b.s) / 2);
        C.paint.quad(P3(a, lat - w / 2, 0.012), P3(a, lat + w / 2, 0.012), P3(b, lat + w / 2, 0.012), P3(b, lat - w / 2, 0.012), color, true);
      }
    }
    function runsWhere(test, s0, s1, step) {
      // contiguous s-intervals where test(s) holds, at `step` resolution
      const out = []; let a = null;
      for (let s = s0; s <= s1 + 1e-6; s += step) {
        const ok = test(s);
        if (ok && a == null) a = s;
        if (!ok && a != null) { out.push([a, s - step]); a = null; }
      }
      if (a != null) out.push([a, s1]);
      return out;
    }
    function cutAtS(s, side) { const p = at(s); return isCut(p, side); }
    if (S.markings && !S.isDirt) {
      const endPad = 1.0;
      for (const side of [-1, 1]) {
        // outer edge line — broken where an attached ramp lane owns the edge
        for (const r of runsWhere(function (s) { return !cutAtS(s, side) && !inGap(s, side, false); }, endPad, totalS - endPad, 2)) {
          if (r[1] - r[0] > 1) stripe(r[0], r[1], side * (S.trav + 0.1), 0.2, WHITE);
        }
        if (S.median) {
          for (const r of runsWhere(function (s) { return !inGap(s, 0, true); }, endPad, totalS - endPad, 2))
            if (r[1] - r[0] > 1) stripe(r[0], r[1], side * (S.medHalf - 0.1), 0.16, YELLOW);
        }
        // lane dividers: 3 m dash / 9 m gap, with a raised marker mid-gap
        for (let k = 1; k < S.lanesPerDir; k++) {
          const lat = side * (S.medHalf + k * S.laneW);
          for (let s = 6; s + 3 < totalS - endPad; s += 12) {
            if (inBox(s) || inBox(s + 3)) continue;
            const a = at(s), b = at(s + 3), C = chunkOf(s + 1.5);
            C.paint.quad(P3(a, lat - 0.075, 0.012), P3(a, lat + 0.075, 0.012), P3(b, lat + 0.075, 0.012), P3(b, lat - 0.075, 0.012), WHITE, true);
            if (((s / 12) | 0) % 2 === 0) {
              const m = at(s + 7.5);
              const q0 = P3(m, lat - 0.06, 0.03), q1 = P3(m, lat + 0.06, 0.03);
              const q2 = [q1[0] + m.tx * 0.12, q1[1], q1[2] + m.tz * 0.12], q3 = [q0[0] + m.tx * 0.12, q0[1], q0[2] + m.tz * 0.12];
              C.paint.quad(q0, q1, q2, q3, RPM, true);
            }
          }
        }
        // yellow markers along the inner edge line every 24 m
        if (S.median) {
          for (let s = 12; s < totalS - 2; s += 24) {
            if (inGap(s, 0, true) || inBox(s)) continue;
            const m = at(s), lat = side * (S.medHalf + 0.12), C = chunkOf(s);
            const q0 = P3(m, lat - 0.06, 0.03), q1 = P3(m, lat + 0.06, 0.03);
            C.paint.quad(q0, q1, [q1[0] + m.tx * 0.12, q1[1], q1[2] + m.tz * 0.12], [q0[0] + m.tx * 0.12, q0[1], q0[2] + m.tz * 0.12], RPMY, true);
          }
        }
      }
      if (!S.median) {                                    // undivided: double yellow centreline
        for (const r of runsWhere(function (s) { return !inGap(s, 0, true); }, endPad, totalS - endPad, 2)) {
          if (r[1] - r[0] < 1) continue;
          stripe(r[0], r[1], -0.2, 0.12, YELLOW); stripe(r[0], r[1], 0.2, 0.12, YELLOW);
        }
      }
    }

    // ---- MEDIAN BARRIER (F-shape) -------------------------------------------
    const CONC = col(0xa4a39b), CONC_D = col(0x8d8c85), STEEL = col(0x9aa1a8), POST = col(0x707780);
    const CUSH_Y = col(0xe2b418), CUSH_K = col(0x1f1f21), DEL_W = col(0xe8e8e2), DEL_A = col(0xd8861c);
    const STONE = [col(0x6f6a61), col(0x5f5b54), col(0x7c776c), col(0x55524c), col(0x837d71)];
    const FILL = col(0x4f7445), WALL_A = col(0x9e998e), WALL_B = col(0x928d82);
    const F_SHAPE = [[-0.305, 0], [-0.305, 0.075], [-0.18, 0.255], [-0.075, 0.81], [0.075, 0.81], [0.18, 0.255], [0.305, 0.075], [0.305, 0]];
    const W_BEAM = [[0, -0.155], [0.06, -0.1], [0.02, -0.05], [0.02, 0.05], [0.06, 0.1], [0, 0.155]];
    function extrude(acc, s0, s1, lat, profile, color, yBase, closed) {
      // profile [latOffset, height]; along stations between s0..s1
      const pts = [at(s0)];
      for (const p of st) if (p.s > s0 + 0.5 && p.s < s1 - 0.5 && p.keep) pts.push(p);
      pts.push(at(s1));
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], C = acc || chunkOf((a.s + b.s) / 2);
        const A = C.furn || C;
        for (let k = 0; k < profile.length - 1 + (closed ? 1 : 0); k++) {
          const p0 = profile[k], p1 = profile[(k + 1) % profile.length];
          const ya = yBase != null ? yBase : 0;
          A.quad(P3(a, lat + p0[0], ya + p0[1]), P3(a, lat + p1[0], ya + p1[1]), P3(b, lat + p1[0], ya + p1[1]), P3(b, lat + p0[0], ya + p0[1]),
            k === 1 || k === 5 ? CONC_D : color);
        }
      }
    }
    function cushion(s, lat, dir) {
      const p = at(s), C = chunkOf(s), y = yAt(p, lat);
      const cx = p.x + p.nx * lat + p.tx * dir * 1.2, cz = p.z + p.nz * lat + p.tz * dir * 1.2;
      C.furn.box(cx, y + 0.45, cz, p.tx, p.tz, 1.1, 0.45, 0.32, CUSH_Y);
      for (let k = -1; k <= 1; k += 2) C.furn.box(cx + p.tx * k * 0.55, y + 0.46, cz + p.tz * k * 0.55, p.tx, p.tz, 0.12, 0.46, 0.33, CUSH_K);
      pendingCushions.push([Math.min(s, s + dir * 2.3), Math.max(s, s + dir * 2.3), lat]);
    }
    const pendingCushions = [];
    const colliders = [];
    function addWallColliders(s0, s1, lat, hwid, h, yOff) {
      // honest boxes on straight axis-aligned runs only (see header)
      for (const run of runs) {
        const ra = st[run.i0].s, rb = st[run.i1].s;
        const a0 = Math.max(s0, ra), b0 = Math.min(s1, rb);
        if (b0 - a0 < 0.5) continue;
        for (let s = a0; s < b0 - 0.01; s += 40) {
          const e = Math.min(b0, s + 40), m = at((s + e) / 2);
          const cx = m.x + m.nx * lat, cz = m.z + m.nz * lat;
          const y = yAt(m, lat) + (yOff || 0);
          const c = CBZ.orientedCollider
            ? CBZ.orientedCollider(cx, cz, hwid, (e - s) / 2, Math.atan2(m.tx, m.tz), y - 0.3, y + h)
            : { minX: cx - hwid, maxX: cx + hwid, minZ: cz - (e - s) / 2, maxZ: cz + (e - s) / 2, y0: y - 0.3, y1: y + h };
          colliders.push(c);
        }
      }
    }
    if (S.median && !S.isDirt && S.medianW >= 0.8) {
      const pierHit = function (s) {
        if (!rec.barrierGaps.length) return false;
        const p = at(s);
        for (const g of rec.barrierGaps) if (Math.hypot(p.x - g.x, p.z - g.z) < g.r) return true;
        return false;
      };
      for (const r of runsWhere(function (s) { return !inGap(s, 0, true) && !pierHit(s); }, 3, totalS - 3, 2)) {
        if (r[1] - r[0] < 6) continue;
        extrude(null, r[0], r[1], 0, F_SHAPE, CONC, 0, false);
        cushion(r[0], 0, -1); cushion(r[1], 0, 1);
        addWallColliders(r[0], r[1], 0, 0.3, 0.81, 0);
      }
      for (const c of pendingCushions) addWallColliders(c[0], c[1], c[2], 0.33, 0.9, 0);
    }

    // ---- GUARDRAILS, RIP-RAP FILL, DELINEATORS ------------------------------
    function railWanted(p, side) {
      if (S.isDirt) return false;
      if (side < 0 ? p.cutN : p.cutP) return false;
      if (side < 0 ? p.wN : p.wP) return true;                      // over water: a causeway edge
      if (p.e > 0 && p.out === side) return true;                   // outside of a curve
      return false;
    }
    function stoneStrip(side, s0, s1) {
      // armour stone from the deck edge down below the sea surface
      const seaY = (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48);
      const rows = [[0, 0], [0.7, -0.12], [1.9, -0.75], [3.2, -1.55], [4.8, -2.7]];
      const pts = [at(s0)];
      for (const p of st) if (p.s > s0 && p.s < s1) pts.push(p);
      pts.push(at(s1));
      // resample to ~1.6 m for lumpy stones
      const fine = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const n = Math.max(1, Math.ceil((pts[i + 1].s - pts[i].s) / 1.6));
        for (let k = 0; k < n; k++) fine.push(at(pts[i].s + (pts[i + 1].s - pts[i].s) * k / n));
      }
      fine.push(pts[pts.length - 1]);
      const edge = side * half;
      function V(p, r) {
        const lat = edge + side * rows[r][0];
        const top = yAt(p, edge);
        const jx = CBZ.hash01 ? CBZ.hash01(Math.round(p.x * 3), Math.round(p.z * 3), 71 + r) : 0.5;
        const jy = CBZ.hash01 ? CBZ.hash01(Math.round(p.z * 3), Math.round(p.x * 3), 13 + r) : 0.5;
        const y = r === 0 ? top - 0.02 : Math.max(seaY - 2.8, top + rows[r][1] + (jy - 0.5) * 0.45);
        return [p.x + p.nx * (lat + side * (r ? (jx - 0.5) * 0.5 : 0)), y, p.z + p.nz * (lat + side * (r ? (jx - 0.5) * 0.5 : 0))];
      }
      for (let i = 0; i < fine.length - 1; i++) {
        const a = fine[i], b = fine[i + 1], C = chunkOf((a.s + b.s) / 2);
        for (let r = 0; r < rows.length - 1; r++) {
          const h = CBZ.hash01 ? CBZ.hash01(Math.round(a.s * 2), r, 5 + side) : 0.5;
          C.furn.quad(V(a, r), V(a, r + 1), V(b, r + 1), V(b, r), STONE[(h * STONE.length) | 0]);
        }
      }
    }
    function guardrail(side, s0, s1, collide) {
      const lat = side * (half - 0.45);
      const beamProf = W_BEAM.map(function (q) { return [side * q[0], q[1]]; });
      extrude(null, s0, s1, lat, beamProf, STEEL, 0.62, false);
      for (let s = s0; s <= s1 + 0.01; s += 1.905) {
        const p = at(Math.min(s, s1)), C = chunkOf(s), y = yAt(p, lat);
        const x = p.x + p.nx * (lat + side * 0.12), z = p.z + p.nz * (lat + side * 0.12);
        C.furn.box(x, y + 0.36, z, p.tx, p.tz, 0.05, 0.4, 0.075, POST);
        C.furn.box(x - p.nx * side * 0.07, y + 0.62, z - p.nz * side * 0.07, p.tx, p.tz, 0.18, 0.1, 0.05, POST);   // blockout
      }
      // flared end terminals (turned-down ends)
      for (const end of [[s0, -1], [s1, 1]]) {
        const p = at(end[0]), C = chunkOf(end[0]), y = yAt(p, lat);
        const x = p.x + p.nx * lat + p.tx * end[1] * 1.6, z = p.z + p.nz * lat + p.tz * end[1] * 1.6;
        C.furn.box(x + p.nx * side * 0.35, y + 0.35, z + p.nz * side * 0.35, p.tx, p.tz, 1.6, 0.13, 0.05, STEEL);
        C.furn.box(x + p.tx * end[1] * 1.6 + p.nx * side * 0.6, y + 0.3, z + p.tz * end[1] * 1.6 + p.nz * side * 0.6, p.tx, p.tz, 0.22, 0.3, 0.2, CUSH_Y);
      }
      if (collide) addWallColliders(s0, s1, lat, 0.18, 0.82, 0);
    }
    for (const side of [-1, 1]) {
      // water fill
      for (const r of runsWhere(function (s) { const p = at(s); return side < 0 ? waterSide(p, -1) : waterSide(p, 1); }, 0, totalS, 4)) {
        stoneStrip(side, Math.max(0, r[0] - 4), Math.min(totalS, r[1] + 4));
      }
      if (S.isDirt) continue;
      // rails: water edges (solid), curve outsides (visual on arcs)
      for (const r of runsWhere(function (s) {
        const p = at(s);
        p.cutN = isCut(p, -1); p.cutP = isCut(p, 1);
        p.wN = side < 0 && waterSide(p, -1); p.wP = side > 0 && waterSide(p, 1);
        return railWanted(p, side) && !inGap(s, side, false);
      }, 2, totalS - 2, 2)) {
        if (r[1] - r[0] < 16) continue;
        guardrail(side, r[0], r[1], true);
      }
      // delineators where there is no rail
      for (let s = 20; s < totalS - 10; s += 48) {
        const p = at(s);
        if (inGap(s, side, false) || isCut(p, side)) continue;
        if (waterSide(p, side) || (p.e > 0 && p.out === side)) continue;
        const lat = side * (half + 0.7), x = p.x + p.nx * lat, z = p.z + p.nz * lat, g = groundAt(x, z), C = chunkOf(s);
        C.furn.box(x, g + 0.55, z, p.tx, p.tz, 0.06, 0.55, 0.04, DEL_W, true);
        C.furn.box(x - p.tx * 0.001, g + 0.95, z - p.tz * 0.001, p.tx, p.tz, 0.065, 0.09, 0.045, DEL_A, true);
      }
    }
    // superelevation fill slope outside the raised edge
    if (S.bank) {
      for (let i = 0; i < st.length - 1; i++) {
        const a = st[i], b = st[i + 1];
        if (!(a.e > 0 || b.e > 0)) continue;
        const side = a.out || b.out; if (!side) continue;
        const C = chunkOf((a.s + b.s) / 2);
        const ha = yAt(a, side * half) - S.deckY, hb = yAt(b, side * half) - S.deckY;
        const aT = P3(a, side * half, -0.01), bT = P3(b, side * half, -0.01);
        const aB = [a.x + a.nx * side * (half + 2 * ha + 0.3), -0.02, a.z + a.nz * side * (half + 2 * ha + 0.3)];
        const bB = [b.x + b.nx * side * (half + 2 * hb + 0.3), -0.02, b.z + b.nz * side * (half + 2 * hb + 0.3)];
        C.furn.quad(aT, aB, bB, bT, FILL);
      }
    }

    // ---- SOUND WALLS near towns --------------------------------------------
    if (!S.isDirt && S.lanesPerDir >= 2 && city && city.regions) {
      const towns = city.regions.filter(function (r) {
        if (!r || r.kind !== "rect" || r.underlay) return false;
        if (/bridge|causeway|link|approach/i.test(r.name || "")) return false;
        const area = (r.maxX - r.minX) * (r.maxZ - r.minZ);
        return area < 900 * 900 && /city|town|district|strip|flats|port|village|harbor/i.test((r.subtitle || "") + " " + (r.name || ""));
      });
      if (towns.length) {
        const wallLat = half + 5;
        for (const side of [-1, 1]) {
          const near = function (s) {
            const p = at(s);
            const x = p.x + p.nx * side * wallLat, z = p.z + p.nz * side * wallLat;
            if (inGap(s, side, false) || isCut(p, side) || waterSide(p, side)) return false;
            for (const r of towns) {
              if (x > r.minX - 6 && x < r.maxX + 6 && z > r.minZ - 6 && z < r.maxZ + 6) return false;   // never inside the town
              const dx = Math.max(r.minX - x, 0, x - r.maxX), dz = Math.max(r.minZ - z, 0, z - r.maxZ);
              if (Math.hypot(dx, dz) < 150) {
                // the town must lie on THIS side of the road
                const cx = (r.minX + r.maxX) / 2 - p.x, cz = (r.minZ + r.maxZ) / 2 - p.z;
                if ((cx * p.nx + cz * p.nz) * side > 0) return true;
              }
            }
            return false;
          };
          for (const run of runs) {
            for (const r of runsWhere(near, st[run.i0].s + 6, st[run.i1].s - 6, 4)) {
              if (r[1] - r[0] < 30) continue;
              const lat = side * wallLat;
              for (let s = r[0]; s < r[1] - 0.5; s += 4) {
                const e = Math.min(r[1], s + 4), m = at((s + e) / 2), C = chunkOf(m.s);
                const x = m.x + m.nx * lat, z = m.z + m.nz * lat, g = groundAt(x, z);
                const tone = (((s / 4) | 0) % 3 === 0) ? WALL_B : WALL_A;
                C.furn.box(x, g + 2.25, z, m.tx, m.tz, (e - s) / 2 - 0.12, 2.25, 0.12, tone);
                C.furn.box(x + m.tx * ((e - s) / 2), g + 2.4, z + m.tz * ((e - s) / 2), m.tx, m.tz, 0.16, 2.4, 0.2, POST);
                C.furn.box(x, g + 4.55, z, m.tx, m.tz, (e - s) / 2, 0.06, 0.16, CONC_D);
              }
              addWallColliders(r[0], r[1], lat, 0.2, 4.6, -S.deckY);
            }
          }
        }
      }
    }

    // ---- emit chunk meshes ---------------------------------------------------
    const deckMat = S.isDirt ? M.dirt : (S.theme === "concrete" ? M.concrete : M.asphalt);
    for (const C of chunks) {
      if (!C) continue;
      const d = C.deck.mesh(deckMat);
      if (d) { d.receiveShadow = true; rec.group.add(d); }
      const detail = [];
      const pm = C.paint.mesh(M.paint);
      if (pm) { pm.renderOrder = 1; pm.userData.roadPaint = true; rec.group.add(pm); detail.push(pm); }
      const fm = C.furn.mesh(M.furn);
      if (fm) { fm.castShadow = false; fm.receiveShadow = true; rec.group.add(fm); detail.push(fm); }
      if (detail.length && d) registerChunk(d, detail);
    }
    if (CBZ.colliders) for (const c of colliders) CBZ.colliders.push(c);
    rec.stations = st;
    rec.at = at;
    rec.yAt = yAt;
    // open water on BOTH sides along a straight run: bridge-landmark candidates
    rec.waterRuns = [];
    if (!S.isDirt) for (const run of runs) {
      for (const r of runsWhere(function (sq) { const p = at(sq); return waterSide(p, -1) && waterSide(p, 1); }, st[run.i0].s, st[run.i1].s, 4)) {
        if (r[1] - r[0] >= 150) rec.waterRuns.push({ s0: st[run.i0].s, s1: st[run.i1].s, wet: r[1] - r[0] });
      }
    }
  }

  // ============================================================
  //  THE SUSPENSION-BRIDGE LANDMARK (owner's favourite: kept). Dressing over
  //  the causeway-on-fill: two towers standing BESIDE the deck (solid, full
  //  height colliders), catenary main cables (Newton-solved, below) and an
  //  instanced run of hangers. It is chosen by the world, not by a
  //  fingerprint: the late pass dresses the straight run with the longest
  //  open-water span (>= 150 m) nearest downtown.
  // ============================================================
  function solveCatenary(dx, dy, sag) {
    sag = Math.max(0.05, sag);
    if (dx <= 1e-4) return { a: 1e6, offsetX: dx / 2, offsetY: -1e6 };
    // vertex sag relative to the straight chord, for a trial `a` — the exact
    // (non-approximated) quantity Newton-Raphson drives to zero below.
    function vertexSag(a) {
      const half = dx / 2;
      const sh = Math.sinh(half / a) || 1e-12;
      const offX = half - a * Math.asinh(dy / (2 * a * sh));
      const offY = -a * Math.cosh(-offX / a);
      const chordY = dy * (offX / dx);           // straight chord's height at x=offX
      return chordY - (offY + a);                // chord height minus the curve's vertex height
    }
    // shallow-cable parabolic approximation (exact in the small-sag limit) —
    // a well-conditioned starting guess with no large-number cancellation.
    let a = (dx * dx) / (8 * sag);
    for (let i = 0; i < 40; i++) {
      const h = Math.max(a * 1e-4, 1e-6);
      const g = vertexSag(a) - sag;
      const gPrime = (vertexSag(a + h) - sag - g) / h;
      if (!isFinite(g) || Math.abs(gPrime) < 1e-9) break;
      let next = a - g / gPrime;
      if (!isFinite(next) || next <= 0) next = a / 2;    // keep it in-domain
      if (Math.abs(next - a) < 1e-4) { a = next; break; }
      a = next;
    }
    if (!isFinite(a) || a <= 0) a = (dx * dx) / (8 * sag);   // non-convergent — safe fallback
    const half = dx / 2;
    const sh = Math.sinh(half / a) || 1e-12;
    const offX = half - a * Math.asinh(dy / (2 * a * sh));
    const offY = -a * Math.cosh(-offX / a);
    return { a, offsetX: offX, offsetY: offY };
  }
  // sample nPts points along the solved catenary from anchor A to anchor B
  // (world-space, A/B are {x,y,z}); returns an array of THREE.Vector3 in the
  // curve's own local sag plane mapped back into world XYZ. `sag` is metres
  // of droop below the straight A→B chord at the curve's lowest point.
  function catenaryPoints(A, B, sag, nPts) {
    const dx = Math.hypot(B.x - A.x, B.z - A.z);   // horizontal span (XZ plane)
    const dy = B.y - A.y;
    const { a, offsetX, offsetY } = solveCatenary(dx, dy, sag);
    const ux = dx > 1e-6 ? (B.x - A.x) / dx : 0, uz = dx > 1e-6 ? (B.z - A.z) / dx : 0;
    const pts = [];
    for (let i = 0; i <= nPts; i++) {
      const t = i / nPts, x = t * dx;
      const y = a * Math.cosh((x - offsetX) / a) + offsetY;
      pts.push(new THREE.Vector3(A.x + ux * x, A.y + y, A.z + uz * x));
    }
    return pts;
  }
  function buildSuspensionDressing(group, path, width, deckY, gradeAt) {
    if (!THREE.TubeGeometry || !THREE.CatmullRomCurve3) return;   // headless/minimal THREE stub — skip gracefully
    // the span runs along path[0]->path[1] (the fingerprinted call is a
    // straight 2-point causeway); towers stand 1/5 of the way in from each
    // end so the cable's central sag reads clearly over the main gap, with a
    // shorter "back-stay" segment from each tower down to its own deck anchor.
    const a0 = path[0], a1 = path[path.length - 1];
    let dx = a1.x - a0.x, dz = a1.z - a0.z;
    const span = Math.hypot(dx, dz) || 1e-3;
    dx /= span; dz /= span;
    const px = -dz, pz = dx;                    // unit perpendicular (across the deck)
    const towerT = span * 0.18;                 // towers stand 18% of the way in from each end
    const towerY = deckY + 26;                   // tower deck-top height (tall enough to read over the gap)
    // A TOWER STANDS BESIDE THE CARRIAGEWAY, NEVER IN IT. This was
    // `width/2 - 1.2`, which put a 26 m concrete leg 1.2 m INBOARD of the deck
    // edge — on a 24 m deck the outer travel lane ends at 11.4 and the leg
    // occupied 10.02..11.58, i.e. squarely in traffic — and drew it with no
    // collider, so cars drove straight THROUGH a bridge tower. Two faults, one
    // number: pushing the offset out by exactly one leg half-width seats the
    // leg's INNER face on the deck edge, so the silhouette still straddles the
    // deck, the outer lane is clear, and the leg can be solid (below) without
    // turning that lane into a trap. Cables and hangers ride the SAME constant
    // — one object, one number (the lampMast/ATTACH law).
    const LEG_R = 0.55;                          // half-width of the 1.1 m square leg
    const railOff = width / 2 + LEG_R;           // cable line == tower line == deck edge + leg

    const towerMat = new THREE.MeshLambertMaterial({ color: 0x8b929c });
    const cableMat = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
    const hangerMat = new THREE.MeshLambertMaterial({ color: 0x3a3e46 });

    function towerAt(t) {
      const bx = a0.x + dx * t, bz = a0.z + dz * t;
      return { x: bx, z: bz, y: gradeAt(bx, bz) };
    }
    const towers = [towerAt(towerT), towerAt(span - towerT)];

    // ---- two A-frame towers straddling the deck (one leg each side + a
    //      crossbeam near the top, like a real suspension tower silhouette) ----
    towers.forEach((tw) => {
      const tg = new THREE.Group();
      tg.position.set(tw.x, tw.y, tw.z);
      const yaw = Math.atan2(dx, dz);
      tg.rotation.y = yaw;
      const legH = towerY - tw.y;
      const legGeo = new THREE.BoxGeometry(LEG_R * 2, legH, LEG_R * 2);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, towerMat);
        leg.position.set(s * railOff, legH / 2, 0);
        leg.castShadow = true;
        tg.add(leg);
        // SOLIDITY: the one piece of this bridge a body can actually reach.
        // The group is yawed by atan2(dx,dz), so local +X maps to world
        // (dz, -dx) — take the leg's world centre through THAT, never by
        // re-typing an offset (the utility_lines wire bug). The AABB is the
        // yawed square's own extent, so it is honest at any bearing, and it
        // is FULL HEIGHT because the leg is a 26 m column: nothing on this
        // bridge should be able to pass through it at any altitude.
        const lx = tw.x + s * railOff * dz, lz = tw.z - s * railOff * dx;
        const ext = LEG_R * (Math.abs(dz) + Math.abs(dx));
        if (CBZ.colliders) CBZ.colliders.push({
          minX: lx - ext, maxX: lx + ext, minZ: lz - ext, maxZ: lz + ext,
          ref: leg, noCam: true,
        });
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(railOff * 2 + 1.1, 1.0, 1.0), towerMat);
      beam.position.set(0, legH - 3.0, 0);
      tg.add(beam);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(railOff * 2 + 1.4, 0.8, 1.4), towerMat);
      cap.position.set(0, legH + 0.4, 0);
      tg.add(cap);
      group.add(tg);
    });

    // ---- main cable per side: three catenary spans (back-stay/main/back-stay)
    //      strung tower-to-tower over deck anchors, sampled into one smooth
    //      CatmullRomCurve3 per side and extruded as a single TubeGeometry ----
    const hangerSpots = [];   // {x,y,z, hx,hy,hz (deck point)} accumulated across both sides
    [-1, 1].forEach((s) => {
      const offX = px * s * railOff, offZ = pz * s * railOff;
      const anchorA = { x: a0.x + offX, y: gradeAt(a0.x, a0.z) + 1.2, z: a0.z + offZ };
      const tA = { x: towers[0].x + offX, y: towerY, z: towers[0].z + offZ };
      const tB = { x: towers[1].x + offX, y: towerY, z: towers[1].z + offZ };
      const anchorB = { x: a1.x + offX, y: gradeAt(a1.x, a1.z) + 1.2, z: a1.z + offZ };

      // sample each of the 3 sub-spans with its own catenary SAG in metres
      // (Newton-solved `a` per span — a real hanging cable, not a hand-tuned
      // bezier), stitched into one point list for the smooth CatmullRomCurve3
      // below. A real suspension bridge's main cable sags gently (roughly
      // span/9..span/11 — the classic engineering ratio) while the back-stay
      // from tower down to the low deck anchor is short and much straighter.
      const mainSag = Math.hypot(tB.x - tA.x, tB.z - tA.z) / 10;
      const backSag = Math.max(0.3, Math.hypot(tA.x - anchorA.x, tA.z - anchorA.z) / 30);
      const segPts = [];
      [[anchorA, tA, backSag], [tA, tB, mainSag], [tB, anchorB, backSag]].forEach(([A, B, sag], si) => {
        const pts = catenaryPoints(A, B, sag, 14);
        for (let i = si === 0 ? 0 : 1; i < pts.length; i++) segPts.push(pts[i]);   // skip dup joint point
      });
      const curve = new THREE.CatmullRomCurve3(segPts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.22, 6, false), cableMat);
      tube.castShadow = false;
      group.add(tube);

      // ---- hangers: vertical drops from the MAIN span (tA..tB, the sagging
      //      part) down to the existing deck, every ~10m. Sampled straight off
      //      the same segPts (the main-span slice) rather than re-solving. ----
      const mainSpan = catenaryPoints(tA, tB, mainSag, 20);
      for (let i = 1; i < mainSpan.length - 1; i += 2) {   // every other sample ≈ 10 spots
        const p = mainSpan[i];
        const deckY2 = gradeAt(p.x, p.z);
        if (p.y - deckY2 < 1.0) continue;   // near the towers the cable is nearly AT deck height — skip degenerate hangers
        hangerSpots.push({ x: p.x, y: p.y, z: p.z, dy: deckY2 + 0.3 });
      }
    });

    // one InstancedMesh for every hanger cable (thin vertical tube, scaled per
    // instance to its own drop length) — a single draw call no matter how many
    // hangers the span has.
    if (hangerSpots.length) {
      const hangGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 5);
      const him = new THREE.InstancedMesh(hangGeo, hangerMat, hangerSpots.length);
      const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), q0 = new THREE.Quaternion(), scl = new THREE.Vector3();
      hangerSpots.forEach((hs, i) => {
        const drop = Math.max(0.1, hs.y - hs.dy);
        pos.set(hs.x, (hs.y + hs.dy) / 2, hs.z);
        scl.set(1, drop, 1);
        m4.compose(pos, q0, scl);
        him.setMatrixAt(i, m4);
      });
      him.instanceMatrix.needsUpdate = true; him.castShadow = false;
      group.add(him);
    }
  }

  // ============================================================
  //  GANTRIES + ONE SIGN ATLAS (shared with city/interchange.js)
  // ============================================================
  const ATLAS_W = 1024, ATLAS_H = 1024, SLOT_W = 512, SLOT_H = 204;
  let _slot = 0;
  function atlas() {
    if (_atlas) return _atlas;
    let cv = null;
    try { cv = document.createElement("canvas"); } catch (e) { cv = null; }
    if (!cv || !cv.getContext) return null;
    cv.width = ATLAS_W; cv.height = ATLAS_H;
    const g = cv.getContext("2d");
    if (!g) return null;
    g.fillStyle = "#1f6b3a"; g.fillRect(0, 0, ATLAS_W, ATLAS_H);
    const tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;           // sRGB-authored colours (the pale-sign bug class)
    tex.anisotropy = 4;
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0x111111, emissiveMap: tex });
    _atlas = { cv: cv, g: g, tex: tex, mat: mat };
    return _atlas;
  }
  function shield(g, x, y, s, num) {
    // plain white route shield, black numerals
    g.save(); g.translate(x, y);
    g.fillStyle = "#ffffff"; g.strokeStyle = "#111"; g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-s * 0.5, -s * 0.5); g.lineTo(s * 0.5, -s * 0.5); g.lineTo(s * 0.5, s * 0.05);
    g.quadraticCurveTo(s * 0.5, s * 0.45, 0, s * 0.6); g.quadraticCurveTo(-s * 0.5, s * 0.45, -s * 0.5, s * 0.05);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = "#111"; g.font = "bold " + Math.round(s * 0.62) + "px Arial, Helvetica, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(num), 0, s * 0.02);
    g.restore();
  }
  function arrow(g, x, y, s, ang) {
    g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(0, -s * 0.5); g.lineTo(s * 0.32, -s * 0.12); g.lineTo(s * 0.1, -s * 0.12); g.lineTo(s * 0.1, s * 0.5);
    g.lineTo(-s * 0.1, s * 0.5); g.lineTo(-s * 0.1, -s * 0.12); g.lineTo(-s * 0.32, -s * 0.12); g.closePath(); g.fill();
    g.restore();
  }
  // panel content: { routes:[n...], dir:"NORTH", arrow: radians (0 = up), exit: "5" }
  function drawPanel(spec) {
    const A = atlas();
    if (!A || _slot >= 10) return null;
    const i = _slot++, sx = (i % 2) * SLOT_W, sy = Math.floor(i / 2) * SLOT_H;
    const g = A.g;
    if (spec.chevron) {
      g.fillStyle = "#e8b81a"; g.fillRect(sx, sy, SLOT_W, SLOT_H);
      g.fillStyle = "#111";
      for (let k = 0; k < 3; k++) {
        const cx = sx + 110 + k * 150;
        g.beginPath(); g.moveTo(cx - 40, sy + 20); g.lineTo(cx + 30, sy + SLOT_H / 2); g.lineTo(cx - 40, sy + SLOT_H - 20);
        g.lineTo(cx - 5, sy + SLOT_H - 20); g.lineTo(cx + 65, sy + SLOT_H / 2); g.lineTo(cx - 5, sy + 20); g.closePath(); g.fill();
      }
    } else {
      g.fillStyle = "#1f6b3a"; g.fillRect(sx, sy, SLOT_W, SLOT_H);
      g.strokeStyle = "#ffffff"; g.lineWidth = 6; g.strokeRect(sx + 8, sy + 8, SLOT_W - 16, SLOT_H - 16);
      let x = sx + 70;
      const routes = spec.routes || [];
      for (const r of routes) { shield(g, x, sy + 88, 92, r); x += 104; }
      g.fillStyle = "#ffffff"; g.font = "bold 50px Arial, Helvetica, sans-serif"; g.textAlign = "left"; g.textBaseline = "middle";
      if (spec.dir) g.fillText(spec.dir, x - 16, sy + 84);
      if (spec.arrow != null) arrow(g, sx + SLOT_W - 70, sy + 110, 110, spec.arrow);
      if (spec.exit) {
        g.fillStyle = "#ffffff"; g.font = "bold 34px Arial, Helvetica, sans-serif"; g.textAlign = "left";
        g.fillText("EXIT " + spec.exit, sx + 30, sy + 170);
      }
    }
    A.tex.needsUpdate = true;
    return { u0: sx / ATLAS_W, u1: (sx + SLOT_W) / ATLAS_W, v0: 1 - (sy + SLOT_H) / ATLAS_H, v1: 1 - sy / ATLAS_H };
  }
  function signQuad(uv, cx, cy, cz, fx, fz, w, h) {
    // face normal (fx,fz) toward the approaching driver; right vector r
    if (!uv) return;
    if (!_signAcc) _signAcc = { p: [], n: [], uv: [] };
    // the reader's RIGHT, looking at the face (whose normal is (fx,fz))
    const rx = fz, rz = -fx;
    const P = [
      [cx - rx * w / 2, cy - h / 2, cz - rz * w / 2], [cx + rx * w / 2, cy - h / 2, cz + rz * w / 2],
      [cx + rx * w / 2, cy + h / 2, cz + rz * w / 2], [cx - rx * w / 2, cy + h / 2, cz - rz * w / 2],
    ];
    const U = [[uv.u0, uv.v0], [uv.u1, uv.v0], [uv.u1, uv.v1], [uv.u0, uv.v1]];
    for (const t of [[0, 1, 2], [0, 2, 3]]) {
      for (const k of t) { _signAcc.p.push(P[k][0], P[k][1], P[k][2]); _signAcc.n.push(fx, 0, fz); _signAcc.uv.push(U[k][0], U[k][1]); }
    }
  }
  function gantryAcc() { if (!_gantryAcc) _gantryAcc = new Acc(false); return _gantryAcc; }
  /* A truss gantry across ONE carriageway: posts outside both edges (on the
     median side it stands in the barrier line), a two-chord box truss, and
     the panels hung from it facing the driver. (x,z) = carriageway centre,
     (tx,tz) = direction of travel, span = post-to-post, y0 = road top. */
  CBZ.highwayGantry = function (o) {
    const A = gantryAcc(), fx = -o.tx, fz = -o.tz, rx = -o.tz, rz = o.tx;
    const H = 6.6, half = o.span / 2;
    const pcx = o.px != null ? o.px : o.x, pcz = o.pz != null ? o.pz : o.z;   // where the panels hang
    const STEELG = col(0x8d949b), DARK = col(0x5d636a);
    for (const s of [-1, 1]) {
      const px = o.x + rx * s * half, pz = o.z + rz * s * half;
      A.box(px, o.y0 + H / 2, pz, o.tx, o.tz, 0.22, H / 2 + 0.3, 0.22, STEELG);
      A.box(px, o.y0 + 0.3, pz, o.tx, o.tz, 0.5, 0.3, 0.5, col(0x9a9890));                  // footing
      if (CBZ.colliders) CBZ.colliders.push(CBZ.orientedCollider ? CBZ.orientedCollider(px, pz, 0.35, 0.35, 0, o.y0 - 1, o.y0 + H + 1)
        : { minX: px - 0.35, maxX: px + 0.35, minZ: pz - 0.35, maxZ: pz + 0.35 });
    }
    // truss chords (4) + verticals/diagonals
    const L = half + 0.3;
    for (const c of [[H + 0.9, 0.45], [H + 0.9, -0.45], [H - 0.1, 0.45], [H - 0.1, -0.45]]) {
      A.box(o.x + o.tx * c[1], o.y0 + c[0], o.z + o.tz * c[1], rx, rz, L, 0.07, 0.07, STEELG);
    }
    for (let d = -half; d <= half; d += 1.5) {
      for (const k of [0.45, -0.45]) A.box(o.x + rx * d + o.tx * k, o.y0 + H + 0.4, o.z + rz * d + o.tz * k, rx, rz, 0.04, 0.5, 0.04, DARK);
    }
    // panels (and their catwalk) on the upstream face
    const n = o.panels.length;
    const pw = Math.min(7.5, (o.panelSpan || o.span - 1.5) / Math.max(1, n) - 0.4), ph = pw * (SLOT_H / SLOT_W);
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * (pw + 0.4);
      const cx = pcx + rx * off + fx * 0.62, cz = pcz + rz * off + fz * 0.62;
      signQuad(drawPanel(o.panels[i]), cx, o.y0 + H + 0.4, cz, fx, fz, pw, Math.max(2.4, ph));
      A.box(cx - fx * 0.05, o.y0 + H + 0.4, cz - fz * 0.05, rx, rz, pw / 2, Math.max(2.4, ph) / 2, 0.03, DARK);   // panel back
    }
  };
  // a chevron/object marker on a post, facing (fx,fz)
  CBZ.highwayChevronSign = function (x, y0, z, fx, fz) {
    const A = gantryAcc();
    A.box(x, y0 + 1.0, z, fx, fz, 0.05, 1.0, 0.05, col(0x8d949b));
    signQuad(drawPanel({ chevron: true }), x + fx * 0.06, y0 + 2.1, z + fz * 0.06, fx, fz, 1.9, 0.76);
  };

  // ============================================================
  //  GROUND PROVIDER: banked bends are solid for everybody
  // ============================================================
  function bendHeight(x, z) {
    for (let k = 0; k < _bends.length; k++) {
      const B = _bends[k];
      if (x < B.minX || x > B.maxX || z < B.minZ || z > B.maxZ) continue;
      const P = B.pts;
      let best = 1e9, bi = -1, bt = 0, blat = 0;
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1];
        const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez;
        let t = L2 > 0 ? ((x - a.x) * ex + (z - a.z) * ez) / L2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const px = a.x + ex * t, pz = a.z + ez * t, d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
        if (d2 < best) { best = d2; bi = i; bt = t; }
      }
      if (bi < 0) continue;
      const a = P[bi], b = P[bi + 1];
      const nx = a.nx + (b.nx - a.nx) * bt, nz = a.nz + (b.nz - a.nz) * bt;
      const px = a.x + (b.x - a.x) * bt, pz = a.z + (b.z - a.z) * bt;
      blat = (x - px) * nx + (z - pz) * nz;
      const e = a.e + (b.e - a.e) * bt, out = a.out || b.out;
      if (!(e > 0) || !out) continue;
      const h = B.half, al = Math.abs(blat);
      const edgeH = e * 2 * h;
      if (al <= h) return Math.max(0, e * (out * blat + h));
      if (Math.sign(blat) === out && al <= h + 2 * edgeH + 0.3) return Math.max(0, edgeH - (al - h) / 2);
      return 0;
    }
    return 0;
  }
  if (CBZ.registerCityGroundHeight) CBZ.registerCityGroundHeight(bendHeight, { name: "Highway superelevation", biome: "road" });

  // ---- distance pass: hide far paint/furniture chunks -----------------------
  // Driven by the RENDER, not the sim: the chunk's always-drawn deck checks
  // the camera that is actually drawing it (a paused sim, a photo rig that
  // teleports the camera, a cutscene — all still see near paint). A far
  // chunk re-shows its detail within one frame of the camera arriving.
  function detailCull(k) {
    return function (renderer, scene, camera) {
      const far = DETAIL_FAR * ((CBZ.getQualityLevel && CBZ.getQualityLevel() >= 3) ? 1.4 : 1);
      const p = camera.position;
      const d = Math.hypot(k.c.x - p.x, k.c.z - p.z, (k.c.y - p.y) * 0.5) - k.r;
      const on = d < far;
      if (on !== k.on) { k.on = on; for (let j = 0; j < k.detail.length; j++) k.detail[j].visible = on; }
    };
  }
  function registerChunk(deckMesh, detail) {
    const k = { c: deckMesh.geometry.boundingSphere.center.clone(), r: deckMesh.geometry.boundingSphere.radius, detail: detail, on: true };
    _chunks.push(k);
    deckMesh.onBeforeRender = detailCull(k);
  }

  // ---- the kit city/interchange.js builds with --------------------------------
  CBZ._hwyKit = { Acc: Acc, col: col, mats: mats, registerChunk: registerChunk, stationize: stationize };

  // ---- pipeline hooks -----------------------------------------------------------
  if (CBZ.addLandmass) {
    // a fresh world: forget the previous build's highways, bends, chunks, signs
    CBZ.addLandmass(function () {
      // records already built belong to the previous world; anything still
      // pending was registered for THIS one (a caller outside the pipeline)
      _highways = _highways.filter(function (r) { return !r.built; });
      _lateDone = false;
      _bends.length = 0; _chunks.length = 0;
      _signAcc = null; _gantryAcc = null; _slot = 0;
      if (_atlas) { _atlas.g.fillStyle = "#1f6b3a"; _atlas.g.fillRect(0, 0, ATLAS_W, ATLAS_H); _atlas.tex.needsUpdate = true; }
    }, -1000);
    // the late build: after the continent (97) has published the coast
    CBZ.addLandmass(function (city) {
      const list = _pending.slice(); _pending = []; _lateDone = true;
      for (const rec of list) { try { buildNow(rec, city); } catch (e) { console.error("[highways]", e); } }
      if (CBZ.buildInterchanges) { try { CBZ.buildInterchanges(city); } catch (e) { console.error("[interchange]", e); } }
      try { causewayMouthGantries(city); } catch (e) { console.error("[highways] gantries", e); }
      try { dressLandmarkBridge(city); } catch (e) { console.error("[highways] bridge", e); }
      // the world's gantry steel + sign faces: two draws
      const root = city && city.root;
      if (root && _gantryAcc && !_gantryAcc.empty()) {
        const gm = _gantryAcc.mesh(mats().furn); root.add(gm);
      }
      if (root && _signAcc && _signAcc.p.length && _atlas) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(_signAcc.p, 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute(_signAcc.n, 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(_signAcc.uv, 2));
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, _atlas.mat);
        m.matrixAutoUpdate = false; m.updateMatrix(); m.userData.hwy = true;
        root.add(m);
      }
    }, 97.5);
  }

  function dressLandmarkBridge(city) {
    const cx = city && city.center ? city.center.x : 0, cz = city && city.center ? city.center.z : -700;
    let best = null, bd = 1e18;
    for (const rec of _highways) {
      if (!rec.waterRuns || !rec.waterRuns.length || rec.spec.route) continue;   // causeways, not the network
      for (const w of rec.waterRuns) {
        const m = rec.at((w.s0 + w.s1) / 2), d = Math.hypot(m.x - cx, m.z - cz);
        if (d < bd) { bd = d; best = { rec: rec, w: w }; }
      }
    }
    if (!best) return;
    const R = best.rec, a = R.at(best.w.s0 + 1), b = R.at(best.w.s1 - 1);
    buildSuspensionDressing(R.group, [{ x: a.x, z: a.z }, { x: b.x, z: b.z }], R.half * 2, R.deckY,
      function (x, z) { return R.spec.heightAt ? R.spec.heightAt(x, z) + R.deckY : R.deckY; });
  }

  /* Gantries at the causeway mouths that leave the downtown grid: over the
     OUTBOUND carriageway, 70 m out, showing the route numbers that dock onto
     that causeway (highwaynet docks), the heading as a cardinal, an arrow. */
  function causewayMouthGantries(city) {
    if (!city || !isFinite(city.minX)) return;
    const net = CBZ.cityHighwayNet ? CBZ.cityHighwayNet() : null;
    const card = function (tx, tz) {
      if (Math.abs(tx) > Math.abs(tz)) return tx > 0 ? "EAST" : "WEST";
      return tz > 0 ? "SOUTH" : "NORTH";                        // -Z is north
    };
    let n = 0;
    for (const rec of _highways) {
      if (n >= 3 || !rec.stations || rec.spec.isDirt || rec.spec.lanesPerDir < 3) continue;
      const st = rec.stations, a = st[0], b = st[st.length - 1];
      const dA = Math.max(city.minX - a.x, 0, a.x - city.maxX, city.minZ - a.z, 0, a.z - city.maxZ);
      const dB = Math.max(city.minX - b.x, 0, b.x - city.maxX, city.minZ - b.z, 0, b.z - city.maxZ);
      if (Math.min(dA, dB) > 45) continue;
      const fromA = dA <= dB;
      const s = fromA ? 70 : rec.length - 70;
      if (s < 10 || s > rec.length - 10) continue;
      const p = rec.at(s);
      const tx = fromA ? p.tx : -p.tx, tz = fromA ? p.tz : -p.tz;
      // outbound carriageway = the side traffic moving (tx,tz) uses (CBZ.roadLaneCenter)
      const r0 = rec.roads[0] || { vertical: Math.abs(tz) > Math.abs(tx), w: rec.width, lanesPerDir: 3, laneW: 3.6, median: true, medianW: rec.spec.medianW };
      const dir = r0.vertical ? (tz > 0 ? 1 : -1) : (tx > 0 ? 1 : -1);
      const off = CBZ.roadLaneCenter ? CBZ.roadLaneCenter(r0, dir, 0) : dir * 2;
      const sideSign = Math.sign(off) || 1;                     // world axis sign of the carriageway
      // posts: one in the median barrier line, one beyond the outer shoulder
      const S = rec.spec, mid = S.medHalf + (S.trav - S.medHalf) / 2, outer = S.half + 1.2;
      const gx = r0.vertical ? p.x + sideSign * outer / 2 : p.x, gz = r0.vertical ? p.z : p.z + sideSign * outer / 2;
      const cx = r0.vertical ? p.x + sideSign * mid : p.x, cz = r0.vertical ? p.z : p.z + sideSign * mid;
      const routes = [];
      if (net) for (const R of net) for (const d of (R.docks || [])) {
        if (d.x >= rec.footprint.minX - 2 && d.x <= rec.footprint.maxX + 2 && d.z >= rec.footprint.minZ - 2 && d.z <= rec.footprint.maxZ + 2) {
          const num = parseInt(String(R.id).replace(/\D/g, ""), 10);
          if (num && routes.indexOf(num) < 0) routes.push(num);
        }
      }
      if (!routes.length) continue;
      CBZ.highwayGantry({ x: gx, z: gz, px: cx, pz: cz, tx: tx, tz: tz, y0: rec.yAt(p, 0), span: outer, panelSpan: S.trav - S.medHalf,
        panels: [{ routes: routes.slice(0, 2), dir: card(tx, tz), arrow: 0 }] });
      n++;
    }
  }
})();
