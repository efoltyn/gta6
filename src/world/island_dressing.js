/* ============================================================
   world/island_dressing.js — THE DISASTER ISLAND'S TOWN, BETWEEN THE BUILDINGS.

   The island was a street grid, houses and towers seated on the kerb, cars,
   kit trees, the volcano and the beaches, and NOTHING in between: no yard, no
   fence, no path to a front door, no square, no car park, no dock, no farm.
   Every building stood on bare grass like a box dropped on a lawn, and the
   26 "boulders" were a box re-geometried into a near-black dodecahedron.

   This file lays everything a real small island town has between its
   buildings, each thing for a reason:

     YARDS       every house gets a lot: side and back yards fenced (white
                 picket, a low rendered block wall or a clipped hedge, one per
                 house by position hash), the street edge left open where the
                 house already meets the sidewalk, a GATE where the path goes
                 through, a concrete path from the front door (always on -z)
                 to the sidewalk, planted beds either side of the door, a
                 mailbox where the path meets the street and a wheelie bin
                 against the side wall. Neighbouring yards share one fence.
     TOWERS      two concrete planters flanking the door where there is room.
     HYDRANTS    one per street block, behind the kerb (a town has water mains
                 because a town burns).
     SQUARE      a paved town square on the best open ground in town: pavers,
                 granite border, a round raised planter in the middle, benches
                 facing it, litter bins, post-top lanterns, corner planters,
                 bollards on the street side, tree pits round any tree that
                 already grew there.
     CAR LOT     the showroom's forecourt: an asphalt lot with painted bays,
                 wheel stops and cars for sale in some of them.
     DOCK        a timber pier on piles off the beach, straight out to swimming
                 depth, with a ramp up, a T head, bollards and a ladder.
     FARM        a fenced field or two on flat ground out past the town's
                 last street: ploughed crop rows, a gable barn, round bales.
     ROCKS       the arena's boulder sites (disaster_arena.js "rocks / cover")
                 as real rock: displaced, facet-cut, part-buried, weathered,
                 wearing the rock surface map, in clusters.

   COST. One merged mesh per MATERIAL for the whole island: wood, masonry,
   planting, painted metal, asphalt, soil, rock, lantern lenses = 8 draws.
   No lights (lantern lenses brighten with CBZ.lightsOnAmount like the
   street lights). Colliders only on what you would visibly walk through
   (fences, walls, hedges, benches, bins, bales, barn, planters, bollards);
   the pier deck, its T head and its ramp are walkable platforms.

   DETERMINISM. Every choice is a position hash; the arena's rng() stream is
   never touched, so the town it places is byte-identical.

   API
     CBZ.islandDressing.build(ctx) -> {
       fences[], benches[], bins[], bales[], barns[], pier, plaza, lot, fields[],
       rocks[], flammable[], meshes{}, draws, stats }
     ctx (from world/disaster_arena.js, one hook line before `arena = {`):
       root, cx, cz, R, GRID, ROADW, groundHeightAt (terrain), surfaceHeightAt
       (walkable), onRoad, placed, fragile, roadSegs, h01, trees, rocks
       (sites), cars, makeCar, showroom, stations, oceanY
============================================================ */
(function () {
  "use strict";
  const G = typeof window !== "undefined" ? window : globalThis;
  const CBZ = G.CBZ = G.CBZ || {};

  // ---- street section (world/island_roads.js is the source of truth) -----
  function roadC() {
    const k = CBZ.islandRoadKit && CBZ.islandRoadKit.C;
    return { HW: k ? k.HW : 3.5, WALK: k ? k.WALK : 5.5, LIFT: k ? k.LIFT : 0.04, CURB: k ? k.CURB : 0.15 };
  }

  // ---- continuous hash noise (CBZ.hash01 rounds to 0.1 m) -----------------
  function ih(a, b, c) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vn3(x, y, z, s) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = x - xi, fy = y - yi, fz = z - zi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
    let out = 0;
    for (let k = 0; k < 8; k++) {
      const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
      const w = (dx ? ux : 1 - ux) * (dy ? uy : 1 - uy) * (dz ? uz : 1 - uz);
      out += w * ih(xi + dx + s * 131, yi + dy + s * 17, zi + dz - s * 71);
    }
    return out;
  }
  const clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };

  /* ======================================================================
     GEOMETRY ACCUMULATOR: flat arrays per material, world space, with
     world-metre UVs projected per triangle on its dominant axis (so a map
     reads at real scale on every face) and a ground-contact darkening.
     ====================================================================== */
  function Acc(name, tile) { this.name = name; this.tile = tile; this.p = []; this.n = []; this.c = []; this.uv = []; }
  Acc.prototype.count = function () { return this.p.length / 3; };

  let THREE = null;
  let V3 = null, _e1, _e2, _fn, _nm, _tv, _tn, _m4, _q, _s, _pos, _eul;
  function initTemps() {
    V3 = THREE.Vector3;
    _e1 = new V3(); _e2 = new V3(); _fn = new V3();
    _nm = new THREE.Matrix3(); _m4 = new THREE.Matrix4(); _q = new THREE.Quaternion(); _s = new V3(); _pos = new V3();
    _eul = new THREE.Euler(0, 0, 0, "YXZ");
    _tv = [new V3(), new V3(), new V3()]; _tn = [new V3(), new V3(), new V3()];
  }

  // o: { grain: "x"|"z" (top faces), hgrain: true (side faces: grain horizontal),
  //      ao: ground y, aoK, aoH, uo, vo }
  function emitTri(A, v, n, col, o) {
    _e1.subVectors(v[1], v[0]); _e2.subVectors(v[2], v[0]); _fn.crossVectors(_e1, _e2);
    const ax = Math.abs(_fn.x), ay = Math.abs(_fn.y), az = Math.abs(_fn.z);
    const top = ay >= ax && ay >= az, sideX = !top && ax >= az;
    const T = A.tile, uo = o.uo || 0, vo = o.vo || 0;
    for (let k = 0; k < 3; k++) {
      const p = v[k], q = n[k];
      let u, w;
      if (top) { if (o.grain === "x") { u = p.z; w = p.x; } else { u = p.x; w = p.z; } }
      else if (o.hgrain) { u = p.y; w = sideX ? p.z : p.x; }
      else { u = sideX ? p.z : p.x; w = p.y; }
      A.uv.push((u + uo) / T, (w + vo) / T);
      let f = 1;
      if (o.ao != null) {
        const t = clamp01((p.y - o.ao) / (o.aoH || 0.5));
        f = 1 - (o.aoK != null ? o.aoK : 0.38) * (1 - t);
      }
      A.p.push(p.x, p.y, p.z); A.n.push(q.x, q.y, q.z);
      A.c.push(col[0] * f, col[1] * f, col[2] * f);
    }
  }
  // append a template (non-indexed BufferGeometry) through a matrix
  function addGeo(A, g, m, col, o) {
    o = o || {};
    const P = g.attributes.position.array, N = g.attributes.normal.array, cnt = g.attributes.position.count;
    _nm.getNormalMatrix(m);
    for (let i = 0; i < cnt; i += 3) {
      for (let k = 0; k < 3; k++) {
        const j = (i + k) * 3;
        _tv[k].set(P[j], P[j + 1], P[j + 2]).applyMatrix4(m);
        _tn[k].set(N[j], N[j + 1], N[j + 2]).applyMatrix3(_nm).normalize();
      }
      emitTri(A, _tv, _tn, col, o);
    }
  }
  // a quad p0..p3 counter-clockwise seen from the side it faces
  const _qv = [null, null, null], _qn = [null, null, null];
  function quad(A, p0, p1, p2, p3, col, o) {
    o = o || {};
    _e1.subVectors(p1, p0); _e2.subVectors(p2, p0);
    const nn = new V3().crossVectors(_e1, _e2).normalize();
    // faceUp: a ground decal must face the sky whichever way it was wound
    if (o.faceUp && nn.y < 0) { const t = p1; p1 = p3; p3 = t; nn.negate(); }
    _qn[0] = _qn[1] = _qn[2] = nn;
    _qv[0] = p0; _qv[1] = p1; _qv[2] = p2; emitTri(A, _qv, _qn, col, o);
    _qv[0] = p0; _qv[1] = p2; _qv[2] = p3; emitTri(A, _qv, _qn, col, o);
  }
  function tri(A, p0, p1, p2, col, o) {
    _e1.subVectors(p1, p0); _e2.subVectors(p2, p0);
    const nn = new V3().crossVectors(_e1, _e2).normalize();
    _qn[0] = _qn[1] = _qn[2] = nn;
    _qv[0] = p0; _qv[1] = p1; _qv[2] = p2; emitTri(A, _qv, _qn, col, o || {});
  }

  // cached unit templates
  const TPL = {};
  function tBox() { return TPL.box || (TPL.box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed()); }
  function tCyl(seg, taper, open) {
    const k = "c" + seg + "|" + taper + "|" + (open ? 1 : 0);
    return TPL[k] || (TPL[k] = new THREE.CylinderGeometry(taper, 1, 1, seg, 1, !!open).toNonIndexed());
  }
  function tSphere(w, h) {
    const k = "s" + w + "|" + h;
    return TPL[k] || (TPL[k] = new THREE.SphereGeometry(1, w, h).toNonIndexed());
  }
  function mat4(x, y, z, sx, sy, sz, yaw, pitch, roll) {
    _eul.set(pitch || 0, yaw || 0, roll || 0, "YXZ");
    _q.setFromEuler(_eul); _s.set(sx, sy, sz); _pos.set(x, y, z);
    return _m4.compose(_pos, _q, _s);
  }
  function box(A, x, y, z, w, h, d, yaw, col, o) { addGeo(A, tBox(), mat4(x, y, z, w, h, d, yaw), col, o); }
  function cylY(A, x, y0, z, rBot, rTop, h, seg, col, o) {
    addGeo(A, tCyl(seg, +(rTop / rBot).toFixed(3), o && o.open), mat4(x, y0 + h / 2, z, rBot, h, rBot, 0), col, o);
  }
  // a box whose LONG axis runs p0 -> p1 (rails, beams, rafters). sy = the
  // thickness in the plane holding world-up, sz = across.
  function beam(A, x0, y0, z0, x1, y1, z1, sy, sz, col, o) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L = Math.hypot(dx, dy, dz) || 1e-4;
    const X = new V3(dx / L, dy / L, dz / L);
    let S = new V3().crossVectors(X, new V3(0, 1, 0));
    if (S.lengthSq() < 1e-6) S.set(1, 0, 0); else S.normalize();
    const Y = new V3().crossVectors(S, X).normalize();
    const m = new THREE.Matrix4().makeBasis(X.multiplyScalar(L), Y.multiplyScalar(sy), S.multiplyScalar(sz));
    m.setPosition((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    addGeo(A, tBox(), m, col, o);
  }
  // a cylinder whose axis runs p0 -> p1
  function rod(A, x0, y0, z0, x1, y1, z1, r, seg, col, o) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L = Math.hypot(dx, dy, dz) || 1e-4;
    const Yd = new V3(dx / L, dy / L, dz / L);
    let S = new V3().crossVectors(Yd, new V3(0, 1, 0));
    if (S.lengthSq() < 1e-6) S.set(1, 0, 0); else S.normalize();
    const Z = new V3().crossVectors(S, Yd).normalize();
    const m = new THREE.Matrix4().makeBasis(S.multiplyScalar(r), Yd.multiplyScalar(L), Z.multiplyScalar(r));
    m.setPosition((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    addGeo(A, tCyl(seg, 1, o && o.open), m, col, o);
  }
  // a soft irregular blob (a shrub, a bale's bulge): sphere template pushed by
  // noise, normals left radial so it shades like foliage, not like facets
  function blob(A, x, y, z, rx, ry, rz, col, salt, o) {
    const g = tSphere(7, 5), P = g.attributes.position.array, cnt = g.attributes.position.count;
    const vv = [new V3(), new V3(), new V3()], nn = [new V3(), new V3(), new V3()];
    for (let i = 0; i < cnt; i += 3) {
      for (let k = 0; k < 3; k++) {
        const j = (i + k) * 3, px = P[j], py = P[j + 1], pz = P[j + 2];
        const f = 0.78 + 0.44 * vn3(px * 1.6 + salt, py * 1.6, pz * 1.6 - salt, 5);
        vv[k].set(x + px * rx * f, y + py * ry * f, z + pz * rz * f);
        nn[k].set(px, py * 0.8 + 0.25, pz).normalize();
      }
      emitTri(A, vv, nn, col, o || {});
    }
  }
  function shade(col, f) { return [col[0] * f, col[1] * f, col[2] * f]; }
  function vary(col, h, amt) { const f = 1 + (h - 0.5) * 2 * amt; return [col[0] * f, col[1] * f, col[2] * f]; }

  /* ---- palette: LINEAR albedo (this pipeline outputs sRGB) ------------ */
  const COL = {
    paintWhite: [0.62, 0.61, 0.57], paintCream: [0.52, 0.46, 0.34],
    timber: [0.19, 0.155, 0.115], timberGrey: [0.15, 0.14, 0.125], timberDark: [0.075, 0.06, 0.045],
    render: [[0.42, 0.38, 0.31], [0.36, 0.33, 0.29], [0.44, 0.35, 0.26], [0.30, 0.30, 0.29]],
    capstone: [0.46, 0.44, 0.40],
    concrete: [0.30, 0.29, 0.27], pavers: [0.34, 0.31, 0.27], granite: [0.16, 0.155, 0.15],
    hedge: [0.028, 0.068, 0.018], shrub: [0.035, 0.085, 0.022], shrubB: [0.055, 0.09, 0.03],
    mulch: [0.06, 0.035, 0.018], soil: [0.085, 0.058, 0.035], straw: [0.36, 0.27, 0.11],
    crop: [0.05, 0.11, 0.025], steelDark: [0.028, 0.03, 0.032], galv: [0.34, 0.35, 0.36],
    ironGreen: [0.02, 0.05, 0.03], hydrantRed: [0.42, 0.035, 0.02], hydrantYel: [0.55, 0.36, 0.02],
    binGreen: [0.025, 0.07, 0.035], binGrey: [0.07, 0.075, 0.08], lidBlue: [0.02, 0.05, 0.16], lidYel: [0.5, 0.33, 0.02],
    barnRed: [0.19, 0.03, 0.022], roofTin: [0.22, 0.23, 0.235], asphalt: [0.055, 0.055, 0.058], line: [0.55, 0.55, 0.52],
    flowerR: [0.5, 0.04, 0.05], flowerY: [0.6, 0.45, 0.04], flowerW: [0.6, 0.6, 0.58],
  };

  /* ======================================================================
     BUILD
     ====================================================================== */
  function build(ctx) {
    THREE = G.THREE;
    if (!THREE || !ctx || !ctx.root) return null;
    initTemps();
    const RC = roadC();
    const WALK = RC.WALK;
    const cx = ctx.cx, cz = ctx.cz, R = ctx.R, GRID = ctx.GRID || 40;
    const gh = ctx.groundHeightAt, sh = ctx.surfaceHeightAt || gh;
    const h01 = ctx.h01 || function (x, z, s) { return ih(Math.round(x * 10), Math.round(z * 10), s); };
    const placed = ctx.placed || [], fragile = ctx.fragile || [];
    const trees = ctx.trees || [], rockSites = ctx.rocks || [];

    const A = {
      wood: new Acc("wood", 1.6), mason: new Acc("masonry", 2.2), plant: new Acc("planting", 0.9),
      paint: new Acc("painted", 1.2), asph: new Acc("asphalt", 4), soil: new Acc("soil", 2.4),
      rock: new Acc("rock", 2.6), lens: new Acc("lens", 1),
    };
    const out = {
      fences: [], benches: [], bins: [], bales: [], barns: [], pier: null, plaza: null, lot: null,
      fields: [], rocks: [], hydrants: [], mailboxes: [], flammable: [], colliders: [], platforms: [],
      meshes: {}, draws: 0, stats: {},
    };

    // ---- colliders near the island (for clearance tests) ----------------
    const near = [];
    const COLS = CBZ.colliders || [];
    for (let i = 0; i < COLS.length; i++) {
      const c = COLS[i];
      if (c.maxX < cx - R - 80 || c.minX > cx + R + 80 || c.maxZ < cz - R - 80 || c.minZ > cz + R + 80) continue;
      near.push(c);
    }
    // allowTrees: a tree trunk inside the box does not count (a square or a
    // car park keeps the trees that grew there and paves round them)
    function blocked(x0, x1, z0, z1, gy, allowTrees) {
      for (let i = 0; i < near.length; i++) {
        const c = near[i];
        if (c.maxX <= x0 || c.minX >= x1 || c.maxZ <= z0 || c.minZ >= z1) continue;
        if (c.y1 != null && c.y1 < gy + 0.1) continue;
        if (c.y0 != null && c.y0 > gy + 2.0) continue;
        if (allowTrees && (c.maxX - c.minX) < 0.8 && (c.maxZ - c.minZ) < 0.8 && treeNear((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2, 0.6)) continue;
        return true;
      }
      return false;
    }
    function addCol(x0, x1, z0, z1, y0, y1, tag) {
      const c = { minX: x0, maxX: x1, minZ: z0, maxZ: z1, y0: y0, y1: y1, ref: null, noCam: true, dressing: tag };
      if (CBZ.colliders) CBZ.colliders.push(c);
      near.push(c);
      out.colliders.push(c);
      return c;
    }
    function addPlat(x0, x1, z0, z1, top, ramp) {
      const p = { minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: top };
      if (ramp) p.ramp = ramp;
      if (CBZ.platforms) CBZ.platforms.push(p);
      out.platforms.push(p);
      return p;
    }

    // ---- the grid ----------------------------------------------------------
    function nearestLine(v, origin) {
      const k = Math.max(-2, Math.min(2, Math.round((v - origin) / GRID)));
      return { line: origin + k * GRID, off: v - (origin + k * GRID) };
    }
    // inside a street corridor out to the back of the sidewalk (+pad)
    function inStreet(x, z, pad) {
      const a = nearestLine(x, cx), c = nearestLine(z, cz);
      return Math.abs(a.off) < WALK + pad || Math.abs(c.off) < WALK + pad;
    }
    // inside a street that is actually LAID (a road piece or its junction),
    // out to the back of the sidewalk. The grid corridors run on across the
    // outskirts where no road was ever built: that ground is farmland.
    const segs = ctx.roadSegs || [];
    function nearLaidRoad(x, z, pad) {
      for (let i = 0; i < segs.length; i++) {
        const g = segs[i];
        const perp = g.vertical ? Math.abs(x - g.x) : Math.abs(z - g.z);
        const along = g.vertical ? Math.abs(z - g.z) : Math.abs(x - g.x);
        if (perp < WALK + pad && along < g.len / 2 + 3.5 + WALK + pad) return true;
      }
      return false;
    }
    function isWalk(x, z) { return sh(x, z) - gh(x, z) > 0.06; }
    // ground this pass has already given to something (the car lot, the
    // square): the yards laid after them stop at their edge
    const claims = [];
    function inPlaced(x, z, pad, skip) {
      for (let i = 0; i < placed.length; i++) {
        const p = placed[i];
        if (p === skip) continue;
        if (Math.abs(p.x - x) < p.w / 2 + pad && Math.abs(p.z - z) < p.d / 2 + pad) return true;
      }
      for (let i = 0; i < claims.length; i++) {
        const p = claims[i];
        if (Math.abs(p.x - x) < p.w / 2 + pad && Math.abs(p.z - z) < p.d / 2 + pad) return true;
      }
      return false;
    }
    function treeNear(x, z, r) {
      for (let i = 0; i < trees.length; i++) { const t = trees[i]; if (Math.hypot(t.x - x, t.z - z) < r) return t; }
      return null;
    }
    function rockNear(x, z, r) {
      for (let i = 0; i < rockSites.length; i++) { const k = rockSites[i]; if (Math.hypot(k.x - x, k.z - z) < r + k.s * 0.8) return k; }
      return null;
    }
    const dC = function (x, z) { return Math.hypot(x - cx, z - cz); };

    /* ==================================================================
       FENCES. A run is laid bay by bay (<= 2.4 m) so it follows the ground,
       steps round a tree trunk, a rock or a pole, and never lays a second
       fence along a line a neighbour already fenced.
       ================================================================== */
    const runs = [];     // {axis:'x'|'z', c: fixed coord, a0, a1} for dedupe
    function alreadyFenced(axis, c, a0, a1) {
      for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        if (r.axis !== axis || Math.abs(r.c - c) > 1.1) continue;
        if (Math.min(a1, r.a1) - Math.max(a0, r.a0) > 0.3) return true;
      }
      return false;
    }
    function fenceBay(style, x0, z0, x1, z1, tone, owner) {
      const g0 = gh(x0, z0), g1 = gh(x1, z1);
      const L = Math.hypot(x1 - x0, z1 - z0);
      const ux = (x1 - x0) / L, uz = (z1 - z0) / L;
      const nx = -uz, nz = ux;                 // across the fence
      const yaw = Math.atan2(-uz, ux);         // box local x along the run
      const post = function (px, pz, gy, h, w, col, acc, o) { box(acc, px, gy + h / 2 - 0.05, pz, w, h + 0.1, w, yaw, col, o || { ao: gy }); };
      let H = 1.0;
      if (style === "picket") {
        H = 0.95;
        const col = vary(COL.paintWhite, h01(x0, z0, 0xf01), 0.06);
        post(x0, z0, g0, H + 0.08, 0.09, col, A.wood, { ao: g0, aoK: 0.3 });
        post(x1, z1, g1, H + 0.08, 0.09, col, A.wood, { ao: g1, aoK: 0.3 });
        // rails on the inside face
        for (const ry of [0.22, H - 0.22]) {
          beam(A.wood, x0 - nx * 0.05, g0 + ry, z0 - nz * 0.05, x1 - nx * 0.05, g1 + ry, z1 - nz * 0.05, 0.085, 0.035, col, {});
        }
        // pickets: pointed boards, both faces, 0.078 wide on a 0.135 pitch
        const n = Math.max(1, Math.floor((L - 0.1) / 0.135));
        const hw = 0.039, tip = 0.07, th = 0.01;
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n, px = x0 + ux * L * t, pz = z0 + uz * L * t;
          const gy = g0 + (g1 - g0) * t - 0.03, ph = H - 0.02 + (h01(px, pz, 0xf02) - 0.5) * 0.02;
          const c2 = vary(col, h01(px, pz, 0xf03), 0.05);
          for (const sgn of [1, -1]) {
            const ox = nx * th * sgn, oz = nz * th * sgn;
            const a = new V3(px - ux * hw * sgn + ox, gy, pz - uz * hw * sgn + oz);
            const b = new V3(px + ux * hw * sgn + ox, gy, pz + uz * hw * sgn + oz);
            const c = new V3(px + ux * hw * sgn + ox, gy + ph - tip, pz + uz * hw * sgn + oz);
            const d = new V3(px + ox, gy + ph, pz + oz);
            const e = new V3(px - ux * hw * sgn + ox, gy + ph - tip, pz - uz * hw * sgn + oz);
            const o = { ao: gy + 0.03, aoK: 0.35 };
            quad(A.wood, a, b, c, e, c2, o);
            tri(A.wood, e, c, d, c2, o);
          }
        }
      } else if (style === "wall") {
        H = 0.8;
        const col = tone;
        const n = Math.max(1, Math.round(L / 0.9));
        for (let i = 0; i < n; i++) {
          const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2;
          const gy = g0 + (g1 - g0) * tm;
          const px = x0 + ux * L * tm, pz = z0 + uz * L * tm;
          box(A.mason, px, gy + (H - 0.06) / 2 - 0.1, pz, L / n + 0.002, H - 0.06 + 0.2, 0.2, yaw, col, { ao: gy, aoK: 0.4, aoH: 0.4 });
          box(A.mason, px, gy + H - 0.03, pz, L / n + 0.004, 0.06, 0.27, yaw, COL.capstone, {});
        }
        box(A.mason, x0, g0 + 0.45 - 0.1, z0, 0.34, 1.0, 0.34, yaw, col, { ao: g0 });
        box(A.mason, x0, g0 + 0.92, z0, 0.4, 0.06, 0.4, yaw, COL.capstone, {});
        box(A.mason, x1, g1 + 0.45 - 0.1, z1, 0.34, 1.0, 0.34, yaw, col, { ao: g1 });
        box(A.mason, x1, g1 + 0.92, z1, 0.4, 0.06, 0.4, yaw, COL.capstone, {});
        H = 0.95;
      } else if (style === "hedge") {
        H = 1.15;
        const n = Math.max(1, Math.round(L / 1.2));
        for (let i = 0; i < n; i++) {
          const tm = (i + 0.5) / n, gy = g0 + (g1 - g0) * tm;
          const px = x0 + ux * L * tm, pz = z0 + uz * L * tm;
          const c = vary(COL.hedge, h01(px, pz, 0xf11), 0.18);
          const hh = H + (h01(px, pz, 0xf12) - 0.5) * 0.12;
          box(A.plant, px, gy + (hh - 0.18) / 2 - 0.05, pz, L / n + 0.06, hh - 0.18 + 0.1, 0.78, yaw, c, { ao: gy, aoK: 0.55, aoH: 0.7 });
          box(A.plant, px, gy + hh - 0.1, pz, L / n + 0.02, 0.2, 0.62, yaw, shade(c, 1.12), {});
        }
      } else if (style === "rail") {           // farm post-and-rail
        H = 1.2;
        const col = vary(COL.timberGrey, h01(x0, z0, 0xf21), 0.12);
        rod(A.wood, x0, g0 - 0.3, z0, x0, g0 + H + 0.05, z0, 0.075, 7, COL.timberDark, { ao: g0 });
        rod(A.wood, x1, g1 - 0.3, z1, x1, g1 + H + 0.05, z1, 0.075, 7, COL.timberDark, { ao: g1 });
        for (const ry of [0.4, 0.75, 1.1]) beam(A.wood, x0 + nx * 0.08, g0 + ry, z0 + nz * 0.08, x1 + nx * 0.08, g1 + ry, z1 + nz * 0.08, 0.1, 0.045, col, { hgrain: true });
      }
      // one collider per bay (axis-aligned: every run here is on an axis)
      const t = style === "hedge" ? 0.4 : style === "wall" ? 0.17 : 0.1;
      const c = addCol(Math.min(x0, x1) - t, Math.max(x0, x1) + t, Math.min(z0, z1) - t, Math.max(z0, z1) + t,
        Math.min(g0, g1) - 0.2, Math.max(g0, g1) + H, "fence");
      const rec = { kind: style, x0: x0, z0: z0, x1: x1, z1: z1, h: H, collider: c, owner: owner || null,
        flammable: style !== "wall", fragile: true };
      out.fences.push(rec);
      if (rec.flammable) out.flammable.push(rec);
      return rec;
    }
    /* A straight run along an axis from (x0,z0) to (x1,z1), with optional
       gate gaps [{at, w}] measured along it. Bays that would stand in a
       street, a building, a tree, a rock or another collider are skipped. */
    function fenceRun(style, x0, z0, x1, z1, gates, tone, owner, skipIn) {
      const axis = Math.abs(x1 - x0) >= Math.abs(z1 - z0) ? "x" : "z";
      const a0 = axis === "x" ? Math.min(x0, x1) : Math.min(z0, z1);
      const a1 = axis === "x" ? Math.max(x0, x1) : Math.max(z0, z1);
      const c = axis === "x" ? z0 : x0;
      if (a1 - a0 < 0.5) return 0;
      const pieces = [[a0, a1]];
      (gates || []).forEach(function (g) {
        for (let i = pieces.length - 1; i >= 0; i--) {
          const p = pieces[i], lo = g.at - g.w / 2, hi = g.at + g.w / 2;
          if (hi <= p[0] || lo >= p[1]) continue;
          pieces.splice(i, 1);
          if (lo - p[0] > 0.3) pieces.push([p[0], lo]);
          if (p[1] - hi > 0.3) pieces.push([hi, p[1]]);
        }
      });
      let laid = 0;
      for (const p of pieces) {
        if (alreadyFenced(axis, c, p[0], p[1])) continue;
        const n = Math.max(1, Math.ceil((p[1] - p[0]) / 2.4));
        for (let i = 0; i < n; i++) {
          const b0 = p[0] + (p[1] - p[0]) * i / n, b1 = p[0] + (p[1] - p[0]) * (i + 1) / n;
          const bx0 = axis === "x" ? b0 : c, bz0 = axis === "x" ? c : b0;
          const bx1 = axis === "x" ? b1 : c, bz1 = axis === "x" ? c : b1;
          const mx = (bx0 + bx1) / 2, mz = (bz0 + bz1) / 2;
          const gA = gh(bx0, bz0), gB = gh(bx1, bz1);
          if (Math.abs(gA - gB) > 0.6) continue;
          if (inStreet(mx, mz, 0.15) && !(skipIn && skipIn(mx, mz))) continue;
          if (isWalk(mx, mz) || isWalk(bx0, bz0) || isWalk(bx1, bz1)) continue;
          if (inPlaced(mx, mz, 0.15, owner && owner.placedRec)) continue;
          if (owner && owner.b && Math.abs(mx - owner.b.x) < owner.b.w / 2 + 0.12 && Math.abs(mz - owner.b.z) < owner.b.d / 2 + 0.12) continue;
          if (treeNear(mx, mz, 0.7) || treeNear(bx0, bz0, 0.5) || treeNear(bx1, bz1, 0.5)) continue;
          if (rockNear(mx, mz, 0.3)) continue;
          // the bay's own span, pulled in off its ends: the neighbouring bay's
          // (and the corner run's) collider overlaps the joint by design
          const inX = axis === "x" ? 0.3 : -0.15, inZ = axis === "x" ? -0.15 : 0.3;
          if (blocked(Math.min(bx0, bx1) + inX, Math.max(bx0, bx1) - inX, Math.min(bz0, bz1) + inZ, Math.max(bz0, bz1) - inZ, Math.min(gA, gB))) continue;
          fenceBay(style, bx0, bz0, bx1, bz1, tone, owner);
          laid++;
        }
      }
      runs.push({ axis: axis, c: c, a0: a0, a1: a1 });
      return laid;
    }
    function gatePosts(style, x, z, alongX, w, tone) {
      const gy = gh(x, z);
      const off = w / 2 + 0.08;
      const ps = alongX ? [[x - off, z], [x + off, z]] : [[x, z - off], [x, z + off]];
      for (const p of ps) {
        const g = gh(p[0], p[1]);
        if (style === "wall") {
          box(A.mason, p[0], g + 0.5, p[1], 0.38, 1.2, 0.38, 0, tone, { ao: g });
          box(A.mason, p[0], g + 1.13, p[1], 0.44, 0.06, 0.44, 0, COL.capstone, {});
        } else if (style === "picket") {
          box(A.wood, p[0], g + 0.55, p[1], 0.11, 1.2, 0.11, 0, COL.paintWhite, { ao: g });
          box(A.wood, p[0], g + 1.17, p[1], 0.15, 0.04, 0.15, 0, COL.paintWhite, {});
        }
      }
      void gy;
    }

    /* ==================================================================
       PATHS: poured concrete in 1.15 m bays with a joint between, 3 cm
       proud of the grass (below any step-up; nothing to trip on).
       ================================================================== */
    function pathSeg(x0, z0, x1, z1, w) {
      const L = Math.hypot(x1 - x0, z1 - z0);
      if (L < 0.2) return;
      const ux = (x1 - x0) / L, uz = (z1 - z0) / L;
      const n = Math.max(1, Math.round(L / 1.15));
      const yaw = Math.atan2(-uz, ux);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, px = x0 + ux * L * t, pz = z0 + uz * L * t;
        if (isWalk(px, pz)) continue;
        const gy = gh(px, pz);
        const c = vary(COL.concrete, h01(px, pz, 0xa11), 0.07);
        box(A.mason, px, gy - 0.06, pz, L / n - 0.03, 0.18, w, yaw, c, {});
      }
    }

    /* ---- small props ----------------------------------------------------- */
    function mailbox(x, z, yaw) {
      const gy = gh(x, z);
      box(A.wood, x, gy + 0.5, z, 0.09, 1.1, 0.09, yaw, COL.timber, { ao: gy });
      const bc = h01(x, z, 0xb31) < 0.5 ? COL.steelDark : [0.34, 0.34, 0.33];
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      box(A.paint, x, gy + 1.13, z, 0.2, 0.17, 0.46, yaw, bc, {});
      // the rounded top: a half cylinder along the box
      rod(A.paint, x - fx * 0.23, gy + 1.21, z - fz * 0.23, x + fx * 0.23, gy + 1.21, z + fz * 0.23, 0.1, 10, bc, {});
      // red flag, down
      box(A.paint, x + Math.cos(yaw) * 0.11, gy + 1.13, z - Math.sin(yaw) * 0.11, 0.015, 0.05, 0.2, yaw, COL.hydrantRed, {});
      out.mailboxes.push({ x: x, z: z });
    }
    function wheelieBin(x, z, yaw, salt) {
      const gy = gh(x, z);
      const body = h01(x, z, salt) < 0.55 ? COL.binGreen : COL.binGrey;
      const lid = h01(x, z, salt + 1) < 0.5 ? body : (h01(x, z, salt + 2) < 0.5 ? COL.lidBlue : COL.lidYel);
      box(A.paint, x, gy + 0.5, z, 0.58, 0.95, 0.7, yaw, body, { ao: gy, aoK: 0.3 });
      box(A.paint, x, gy + 1.0, z, 0.62, 0.05, 0.76, yaw, lid, {});
      const bx = Math.sin(yaw), bz = Math.cos(yaw);     // local +z (back)
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);    // local +x
      for (const s of [-1, 1]) rod(A.paint, x + bx * 0.3 + rx * s * 0.3, gy + 0.1, z + bz * 0.3 + rz * s * 0.3, x + bx * 0.3 + rx * s * 0.22, gy + 0.1, z + bz * 0.3 + rz * s * 0.22, 0.1, 10, COL.steelDark, {});
      const c = addCol(x - 0.38, x + 0.38, z - 0.38, z + 0.38, gy, gy + 1.03, "bin");
      out.bins.push({ x: x, z: z, collider: c });
    }
    function litterBin(x, z, surfY) {
      const gy = surfY != null ? surfY : gh(x, z);
      cylY(A.paint, x, gy, z, 0.26, 0.26, 0.85, 12, COL.ironGreen, { ao: gy });
      cylY(A.paint, x, gy + 0.85, z, 0.29, 0.22, 0.12, 12, shade(COL.ironGreen, 1.2), {});
      const c = addCol(x - 0.28, x + 0.28, z - 0.28, z + 0.28, gy, gy + 0.97, "bin");
      out.bins.push({ x: x, z: z, collider: c });
    }
    function bench(x, z, yaw, surfY) {
      const gy = surfY != null ? surfY : gh(x, z);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);      // local +z: the back is behind the sitter
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const L = 1.8;
      // cast iron ends
      for (const s of [-0.78, 0.78]) {
        const ex = x + rx * s, ez = z + rz * s;
        box(A.paint, ex - fx * 0.12, gy + 0.22, ez - fz * 0.12, 0.06, 0.44, 0.07, yaw, COL.steelDark, {});
        box(A.paint, ex + fx * 0.18, gy + 0.22, ez + fz * 0.18, 0.06, 0.44, 0.07, yaw, COL.steelDark, {});
        box(A.paint, ex + fx * 0.03, gy + 0.43, ez + fz * 0.03, 0.06, 0.05, 0.5, yaw, COL.steelDark, {});
        beam(A.paint, ex + fx * 0.2, gy + 0.44, ez + fz * 0.2, ex + fx * 0.3, gy + 0.86, ez + fz * 0.3, 0.06, 0.06, COL.steelDark, {});
        box(A.paint, ex - fx * 0.1, gy + 0.6, ez - fz * 0.1, 0.05, 0.04, 0.34, yaw, COL.steelDark, {});
      }
      // timber slats: four on the seat, three on the back
      const wc = vary([0.2, 0.12, 0.06], h01(x, z, 0xbe1), 0.1);
      for (let i = 0; i < 4; i++) {
        const o = -0.16 + i * 0.105;
        box(A.wood, x + fx * o, gy + 0.46, z + fz * o, L, 0.035, 0.085, yaw, wc, { grain: Math.abs(rx) > 0.7 ? "x" : "z", hgrain: true });
      }
      for (let i = 0; i < 3; i++) {
        const t = 0.55 + i * 0.13;
        const bx = x + fx * (0.21 + 0.1 * (t - 0.44) / 0.42), bz = z + fz * (0.21 + 0.1 * (t - 0.44) / 0.42);
        box(A.wood, bx, gy + t, bz, L, 0.085, 0.03, yaw, wc, { hgrain: true });
      }
      const hx = Math.abs(rx) * 0.95 + Math.abs(fx) * 0.35, hz = Math.abs(rz) * 0.95 + Math.abs(fz) * 0.35;
      const c = addCol(x - hx, x + hx, z - hz, z + hz, gy, gy + 0.5, "bench");
      const rec = { x: x, z: z, yaw: yaw, collider: c, flammable: true };
      out.benches.push(rec); out.flammable.push(rec);
    }
    function lantern(x, z, surfY) {
      const gy = surfY != null ? surfY : gh(x, z);
      cylY(A.paint, x, gy, z, 0.16, 0.16, 0.35, 10, COL.steelDark, {});
      cylY(A.paint, x, gy + 0.35, z, 0.075, 0.05, 3.2, 10, COL.steelDark, {});
      cylY(A.paint, x, gy + 3.5, z, 0.09, 0.09, 0.12, 10, COL.steelDark, {});
      // the lantern: glass box, frame, a pyramid cap
      const y = gy + 3.62;
      box(A.lens, x, y + 0.26, z, 0.3, 0.46, 0.3, 0, [1, 1, 1], {});
      for (const s of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(A.paint, x + s[0] * 0.16, y + 0.26, z + s[1] * 0.16, 0.03, 0.5, 0.03, 0, COL.steelDark, {});
      box(A.paint, x, y + 0.02, z, 0.36, 0.05, 0.36, 0, COL.steelDark, {});
      cylY(A.paint, x, y + 0.5, z, 0.26, 0.02, 0.26, 8, COL.steelDark, {});
      addCol(x - 0.14, x + 0.14, z - 0.14, z + 0.14, gy, gy + 4, "lamp");
    }
    function shrubs(x, z, rx, rz, n, salt, surfY, flowers) {
      for (let i = 0; i < n; i++) {
        const a = h01(x + i, z, salt) * Math.PI * 2, d = Math.sqrt(h01(x, z + i, salt + 1));
        const px = x + Math.cos(a) * rx * d * 0.7, pz = z + Math.sin(a) * rz * d * 0.7;
        const gy = surfY != null ? surfY : gh(px, pz);
        const r = 0.28 + 0.2 * h01(px, pz, salt + 2);
        const c = vary(h01(px, pz, salt + 3) < 0.5 ? COL.shrub : COL.shrubB, h01(px, pz, salt + 4), 0.2);
        blob(A.plant, px, gy + r * 0.62, pz, r, r * 0.85, r, c, (salt + i * 7) % 97, { ao: gy, aoK: 0.5, aoH: r * 1.2 });
        if (flowers && h01(px, pz, salt + 5) < 0.6) {
          const fc = [COL.flowerR, COL.flowerY, COL.flowerW][(h01(px, pz, salt + 6) * 3) | 0];
          blob(A.plant, px + r * 0.3, gy + r * 1.15, pz - r * 0.2, r * 0.35, r * 0.2, r * 0.35, fc, salt + i, {});
        }
      }
    }
    function planterBox(x, z, s, h, surfY) {
      const gy = surfY != null ? surfY : gh(x, z);
      const t = 0.12;
      box(A.mason, x, gy + h / 2, z - s / 2 + t / 2, s, h, t, 0, COL.concrete, { ao: gy });
      box(A.mason, x, gy + h / 2, z + s / 2 - t / 2, s, h, t, 0, COL.concrete, { ao: gy });
      box(A.mason, x - s / 2 + t / 2, gy + h / 2, z, t, h, s - 2 * t, 0, COL.concrete, { ao: gy });
      box(A.mason, x + s / 2 - t / 2, gy + h / 2, z, t, h, s - 2 * t, 0, COL.concrete, { ao: gy });
      box(A.soil, x, gy + h - 0.08, z, s - 2 * t, 0.04, s - 2 * t, 0, COL.mulch, {});
      shrubs(x, z, s * 0.3, s * 0.3, 3, 0x7c1 + ((x * 3) | 0), gy + h - 0.06, true);
      addCol(x - s / 2, x + s / 2, z - s / 2, z + s / 2, gy, gy + h, "planter");
    }
    function hydrant(x, z, gy, red) {
      const c = red ? COL.hydrantRed : COL.hydrantYel;
      cylY(A.paint, x, gy, z, 0.17, 0.17, 0.08, 10, c, {});
      cylY(A.paint, x, gy + 0.08, z, 0.12, 0.11, 0.5, 10, c, { ao: gy, aoK: 0.3 });
      cylY(A.paint, x, gy + 0.58, z, 0.14, 0.14, 0.05, 10, c, {});
      cylY(A.paint, x, gy + 0.63, z, 0.12, 0.03, 0.14, 10, c, {});
      cylY(A.paint, x, gy + 0.77, z, 0.035, 0.035, 0.05, 5, COL.galv, {});
      rod(A.paint, x - 0.19, gy + 0.42, z, x + 0.19, gy + 0.42, z, 0.045, 8, c, {});
      rod(A.paint, x, gy + 0.4, z, x, gy + 0.4, z - 0.2, 0.06, 8, c, {});
      out.hydrants.push({ x: x, z: z });
    }

    /* ==================================================================
       1. THE SHOWROOM'S CAR LOT (first: it claims the showroom's own ground)
       ================================================================== */
    (function carLot() {
      const S = ctx.showroom;
      if (!S) return;
      const sp = placedOf(S) || S;
      const W = S.w || 18, D = S.d || 13;
      const tries = [];
      // the deepest lot that fits on each side (a single display row needs 5.8 m)
      for (let ld = 12; ld >= 5.8 - 1e-6; ld -= 0.5) for (const lw of [18, 14, 11, 8.5]) for (const sl of [0, -3, 3, -6, 6]) {
        tries.push({ x: S.x + sl, z: S.z - D / 2 - 1.2 - ld / 2, w: lw, d: ld, rowAxis: "x", face: -1 });      // in front of the bay
        tries.push({ x: S.x - W / 2 - 1.2 - ld / 2, z: S.z + sl, w: ld, d: lw, rowAxis: "z", face: -1 });
        tries.push({ x: S.x + W / 2 + 1.2 + ld / 2, z: S.z + sl, w: ld, d: lw, rowAxis: "z", face: 1 });
      }
      let L = null;
      for (const t of tries) {
        let ok = true, lo = 1e9, hi = -1e9;
        for (let i = -t.w / 2; i <= t.w / 2 + 1e-6 && ok; i += 1.5) for (let j = -t.d / 2; j <= t.d / 2 + 1e-6; j += 1.5) {
          const px = t.x + i, pz = t.z + j;
          if (inStreet(px, pz, 0.05) || isWalk(px, pz) || inPlaced(px, pz, 0.6, sp) || rockNear(px, pz, 0.8)) { ok = false; break; }
          const g = gh(px, pz); if (g < lo) lo = g; if (g > hi) hi = g;
        }
        if (!ok || hi - lo > 0.3) continue;
        if (blocked(t.x - t.w / 2, t.x + t.w / 2, t.z - t.d / 2, t.z + t.d / 2, lo, true)) continue;
        L = t; L.gy = hi; break;
      }
      if (!L) return;
      const top = 0.05;
      // a tree that grew here keeps its ground: a kerbed planting island
      const isl = trees.filter(function (t) { return Math.abs(t.x - L.x) < L.w / 2 + 0.3 && Math.abs(t.z - L.z) < L.d / 2 + 0.3; });
      const inIsl = function (px, pz, r) { for (const t of isl) if (Math.abs(t.x - px) < 1.0 + r && Math.abs(t.z - pz) < 1.0 + r) return true; return false; };
      for (const t of isl) {
        const gy = gh(t.x, t.z);
        box(A.soil, t.x, gy + 0.04, t.z, 1.9, 0.1, 1.9, 0, COL.mulch, {});
        for (const s of [-1, 1]) {
          box(A.mason, t.x + s * 1.0, gy + 0.08, t.z, 0.15, 0.2, 2.15, 0, COL.concrete, {});
          box(A.mason, t.x, gy + 0.08, t.z + s * 1.0, 1.85, 0.2, 0.15, 0, COL.concrete, {});
        }
      }
      // asphalt in 2 m cells following the ground, a concrete kerb round it
      const nX = Math.max(1, Math.round(L.w / 2)), nZ = Math.max(1, Math.round(L.d / 2));
      for (let i = 0; i < nX; i++) for (let j = 0; j < nZ; j++) {
        const x0 = L.x - L.w / 2 + L.w * i / nX, x1 = L.x - L.w / 2 + L.w * (i + 1) / nX;
        const z0 = L.z - L.d / 2 + L.d * j / nZ, z1 = L.z - L.d / 2 + L.d * (j + 1) / nZ;
        if (inIsl((x0 + x1) / 2, (z0 + z1) / 2, 0)) continue;
        quad(A.asph, new V3(x0, gh(x0, z0) + top, z0), new V3(x0, gh(x0, z1) + top, z1), new V3(x1, gh(x1, z1) + top, z1), new V3(x1, gh(x1, z0) + top, z0), vary(COL.asphalt, h01(x0, z0, 0xc01), 0.08), { faceUp: true });
      }
      const k = 0.15;
      for (const s of [-1, 1]) {
        beam(A.mason, L.x - L.w / 2 - k / 2, gh(L.x - L.w / 2, L.z + s * (L.d / 2 + k / 2)) + 0.03, L.z + s * (L.d / 2 + k / 2), L.x + L.w / 2 + k / 2, gh(L.x + L.w / 2, L.z + s * (L.d / 2 + k / 2)) + 0.03, L.z + s * (L.d / 2 + k / 2), 0.2, k, COL.concrete, {});
        beam(A.mason, L.x + s * (L.w / 2 + k / 2), gh(L.x + s * L.w / 2, L.z - L.d / 2) + 0.03, L.z - L.d / 2, L.x + s * (L.w / 2 + k / 2), gh(L.x + s * L.w / 2, L.z + L.d / 2) + 0.03, L.z + L.d / 2, 0.2, k, COL.concrete, {});
      }
      // one row of 2.6 m bays along the far side, 5.2 deep, open to an aisle
      const alongX = L.rowAxis === "x";
      const span = alongX ? L.w : L.d, deep = 5.2;
      const nB = Math.floor((span - 0.6) / 2.6);
      const a0 = -nB * 2.6 / 2;
      const rowSide = alongX ? -1 : L.face;          // the row sits away from the showroom
      const base = alongX ? L.z + rowSide * (L.d / 2 - 0.2) : L.x + rowSide * (L.w / 2 - 0.2);
      const lineC = COL.line;
      const lineY = function (px, pz) { return gh(px, pz) + top + 0.008; };
      const bays = [];
      for (let i = 0; i <= nB; i++) {
        const a = a0 + i * 2.6;
        const px0 = alongX ? L.x + a : base, pz0 = alongX ? base : L.z + a;
        const px1 = alongX ? px0 : base - rowSide * deep, pz1 = alongX ? base - rowSide * deep : pz0;
        const hwx = alongX ? 0.05 : 0, hwz = alongX ? 0 : 0.05;
        quad(A.asph, new V3(px0 - hwx, lineY(px0, pz0), pz0 - hwz), new V3(px1 - hwx, lineY(px1, pz1), pz1 - hwz), new V3(px1 + hwx, lineY(px1, pz1), pz1 + hwz), new V3(px0 + hwx, lineY(px0, pz0), pz0 + hwz), lineC, { faceUp: true });
        if (i < nB) bays.push(a + 1.3);
      }
      bays.forEach(function (a, i) {
        const cxb = alongX ? L.x + a : base - rowSide * 0.55, czb = alongX ? base - rowSide * 0.55 : L.z + a;
        const g = gh(cxb, czb) + top;
        box(A.mason, cxb, g + 0.06, czb, alongX ? 1.7 : 0.14, 0.12, alongX ? 0.14 : 1.7, 0, COL.concrete, {});
        const px = alongX ? L.x + a : base - rowSide * 2.9, pz = alongX ? base - rowSide * 2.9 : L.z + a;
        if (h01(cxb, czb, 0xc03 + i) < 0.62 && ctx.makeCar && !inIsl(px, pz, alongX ? 1.1 : 2.3) && !inIsl(px, pz, alongX ? 2.3 : 1.1)) {
          const pal = [0xc9ccd1, 0x1f2328, 0x7a1d1d, 0x23395b, 0xe6e6e3, 0x55595e];
          ctx.makeCar(px, pz, alongX, pal[(h01(px, pz, 0xc04) * pal.length) | 0]);
        }
      });
      out.lot = { x: L.x, z: L.z, w: L.w, d: L.d, bays: bays.length };
      claims.push({ x: L.x, z: L.z, w: L.w + 0.4, d: L.d + 0.4 });
    })();

    /* ==================================================================
       2. THE TOWN SQUARE
       ================================================================== */
    (function square() {
      let best = null;
      for (const H of [10, 8.5, 7]) {
        for (let x = cx - R; x <= cx + R; x += 2) for (let z = cz - R; z <= cz + R; z += 2) {
          const d = dC(x, z);
          if (d < 42 || d > R - 30) continue;
          if (inStreet(x, z, H + 0.35)) continue;          // a street runs through it
          if (inPlaced(x, z, H + 1.2)) continue;
          let ok = true, trees0 = 0, lo = 1e9, hi = -1e9;
          for (let i = -H; i <= H + 1e-6 && ok; i += 2) for (let j = -H; j <= H + 1e-6; j += 2) {
            const px = x + i, pz = z + j;
            if (inStreet(px, pz, 0.35) || isWalk(px, pz) || inPlaced(px, pz, 1.2)) { ok = false; break; }
            if (rockNear(px, pz, 1.0)) { ok = false; break; }
            const g = gh(px, pz); if (g < lo) lo = g; if (g > hi) hi = g;
          }
          if (!ok || hi - lo > 0.35 || hi > 1.2) continue;
          if (blocked(x - H, x + H, z - H, z + H, lo, true)) continue;   // trees become the square's trees
          for (const t of trees) if (Math.abs(t.x - x) < H && Math.abs(t.z - z) < H) trees0++;
          // a square belongs on a street: how many of its edges touch a sidewalk
          let front = 0;
          for (const s of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isWalk(x + s[0] * (H + 1.2), z + s[1] * (H + 1.2))) front++;
          const centreTree = treeNear(x, z, 3.2) ? 1 : 0;
          const score = front * 10 - d * 0.08 - trees0 * 0.5 - centreTree * 20 + H * 1.5;
          if (!best || score > best.score) best = { x: x, z: z, H: H, score: score, gy: hi, front: front };
        }
        if (best) break;
      }
      if (!best) return;
      const x = best.x, z = best.z, H = best.H, top = 0.07;
      // one flat paved level at the lot's high point, walkable; on the low
      // side its granite edge stands proud like a real square's kerb
      const YT = best.gy + top;
      const Y = function () { return YT; };
      addPlat(x - H, x + H, z - H, z + H, YT);
      // tree pits for trees that grew here
      const pits = trees.filter(function (t) { return Math.abs(t.x - x) < H && Math.abs(t.z - z) < H; });
      const inPit = function (px, pz) { for (const t of pits) if (Math.abs(t.x - px) < 0.9 && Math.abs(t.z - pz) < 0.9) return true; return false; };
      // pavers: 1.0 m running bond, hashed tones; a 0.6 m granite sett border
      const P = 1.0, B = 0.6;
      for (let i = -H + B; i < H - B - 1e-6; i += P) for (let j = -H + B; j < H - B - 1e-6; j += P / 2) {
        const shift = (Math.round((j + H) / (P / 2)) & 1) ? P / 2 : 0;
        let a0 = i + shift, a1 = Math.min(H - B, a0 + P);
        if (a0 >= H - B) continue;
        const px = x + (a0 + a1) / 2, pz = z + j + P / 4;
        if (inPit(px, pz)) continue;
        const cc = vary(COL.pavers, h01(px, pz, 0xa21), 0.1);
        const y = Y(px, pz);
        box(A.mason, px, y - 0.3, pz, (a1 - a0) - 0.012, 0.6, P / 2 - 0.012, 0, cc, {});
        void a1;
      }
      for (let k = -H; k < H - 1e-6; k += 0.3) for (const s of [-1, 1]) {
        const c1 = vary(COL.granite, h01(x + k, z + s, 0xa22), 0.14), c2 = vary(COL.granite, h01(x + s, z + k, 0xa23), 0.14);
        for (let r = 0; r < 2; r++) {
          const o = H - 0.15 - r * 0.3;
          box(A.mason, x + k + 0.15, YT - 0.3, z + s * o, 0.29, 0.6, 0.29, 0, c1, {});
          if (Math.abs(k + 0.15) < H - 0.6) box(A.mason, x + s * o, YT - 0.3, z + k + 0.15, 0.29, 0.6, 0.29, 0, c2, {});
        }
      }
      for (const t of pits) {
        const gy = gh(t.x, t.z), mt = YT - 0.04;
        box(A.soil, t.x, (mt + gy - 0.1) / 2, t.z, 1.7, mt - gy + 0.1, 1.7, 0, COL.mulch, {});
        for (const s of [-1, 1]) {
          box(A.paint, t.x + s * 0.88, YT - 0.03, t.z, 0.04, 0.08, 1.8, 0, COL.steelDark, {});
          box(A.paint, t.x, YT - 0.03, t.z + s * 0.88, 1.8, 0.08, 0.04, 0, COL.steelDark, {});
        }
      }
      // the round raised planter in the middle
      const cy = Y(x, z), RO = 2.4, RI = 2.1, SEG = 20;
      for (let k = 0; k < SEG; k++) {
        const a = (k + 0.5) / SEG * Math.PI * 2, w = 2 * Math.PI * (RO + RI) / 2 / SEG + 0.04;
        const rm = (RO + RI) / 2;
        box(A.mason, x + Math.cos(a) * rm, cy + 0.22, z + Math.sin(a) * rm, w, 0.46, RO - RI, -a + Math.PI / 2, COL.concrete, { ao: cy });
        box(A.mason, x + Math.cos(a) * rm, cy + 0.47, z + Math.sin(a) * rm, w + 0.02, 0.05, RO - RI + 0.1, -a + Math.PI / 2, COL.capstone, {});
      }
      cylY(A.soil, x, cy, z, RI, RI, 0.4, 20, COL.mulch, {});
      shrubs(x, z, RI * 0.9, RI * 0.9, 9, 0x5a1, cy + 0.4, true);
      addCol(x - RO * 0.8, x + RO * 0.8, z - RO * 0.8, z + RO * 0.8, cy - 0.1, cy + 0.5, "planter");
      // benches facing it, a bin beside two of them
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + Math.PI / 4;
        const bx = x + Math.cos(a) * 4.4, bz = z + Math.sin(a) * 4.4;
        if (inPit(bx, bz) || treeNear(bx, bz, 1.4)) continue;
        // bench local -z faces the sitter's front; face the planter
        const yaw = Math.atan2(Math.cos(a), Math.sin(a));
        bench(bx, bz, yaw, Y(bx, bz));
        if (k % 2 === 0) {
          const ta = a + 0.36;
          const lx = x + Math.cos(ta) * 4.6, lz = z + Math.sin(ta) * 4.6;
          if (!treeNear(lx, lz, 1.0)) litterBin(lx, lz, Y(lx, lz));
        }
      }
      // lanterns on the axes, planters in the corners
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2;
        const lx = x + Math.cos(a) * (H - 2.2), lz = z + Math.sin(a) * (H - 2.2);
        if (!treeNear(lx, lz, 1.2)) lantern(lx, lz, Y(lx, lz));
      }
      for (const s of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const px = x + s[0] * (H - 1.9), pz = z + s[1] * (H - 1.9);
        if (!treeNear(px, pz, 1.3)) planterBox(px, pz, 1.3, 0.55, Y(px, pz));
      }
      // bollards along every edge that meets a sidewalk
      for (const s of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!isWalk(x + s[0] * (H + 1.2), z + s[1] * (H + 1.2))) continue;
        for (let k = -H + 1.2; k <= H - 1.2 + 1e-6; k += 1.8) {
          const bx = s[0] ? x + s[0] * (H - 0.35) : x + k, bz = s[1] ? z + s[1] * (H - 0.35) : z + k;
          const gy = Y(bx, bz);
          cylY(A.paint, bx, gy - 0.05, bz, 0.1, 0.1, 0.95, 10, COL.steelDark, {});
          cylY(A.paint, bx, gy + 0.9, bz, 0.1, 0.03, 0.08, 10, COL.steelDark, {});
          box(A.paint, bx, gy + 0.75, bz, 0.205, 0.04, 0.205, 0, COL.galv, {});
          addCol(bx - 0.11, bx + 0.11, bz - 0.11, bz + 0.11, gy, gy + 1, "bollard");
        }
      }
      out.plaza = { x: x, z: z, half: H, y: best.gy + top, trees: pits.length };
      claims.push({ x: x, z: z, w: 2 * H, d: 2 * H });
    })();

    /* ==================================================================
       3. YARDS
       ================================================================== */
    const houses = [], towers = [];
    for (let i = 0; i < fragile.length; i++) {
      const b = fragile[i];
      if (!b || b.x == null) continue;
      const kind = b.interior && b.interior.kind;
      if (kind === "house") houses.push(b); else if (kind === "tower") towers.push(b);
    }
    function placedOf(b) {
      for (let i = 0; i < placed.length; i++) { const p = placed[i]; if (Math.abs(p.x - b.x) < 0.01 && Math.abs(p.z - b.z) < 0.01) return p; }
      return null;
    }
    // how far a face can push out before it meets the street, another lot,
    // the beach or a slope. f: 0 -z, 1 +z, 2 -x, 3 +x (the arena's faces)
    function faceRoom(b, f, want, skip) {
      const hx = b.w / 2, hz = b.d / 2;
      const nx = f === 2 ? -1 : f === 3 ? 1 : 0, nz = f === 0 ? -1 : f === 1 ? 1 : 0;
      let e = 0;
      for (let s = 0.3; s <= want + 1e-6; s += 0.3) {
        let ok = true;
        const span = nx ? hz : hx;
        for (let k = -2; k <= 2 && ok; k++) {
          const t = k / 2 * (span - 0.45);       // across the face only: past a corner is the NEXT face's business
          const px = b.x + nx * (hx + s) + (nx ? 0 : t), pz = b.z + nz * (hz + s) + (nz ? 0 : t);
          if (inStreet(px, pz, 0.25) || isWalk(px, pz)) ok = false;
          else if (inPlaced(px, pz, 1.4, skip)) ok = false;
          else if (dC(px, pz) > R - 12) ok = false;
          else if (Math.abs(gh(px, pz) - b.gy) > 0.55) ok = false;
        }
        if (!ok) break;
        e = s;
      }
      return e;
    }
    // is this face on a street: its line sits at the sidewalk's back edge
    function streetFace(b, f) {
      const hx = b.w / 2, hz = b.d / 2;
      if (f >= 2) {
        const a = nearestLine(b.x, cx);
        if (f === 2 && a.off > 0) return a.off - hx < WALK + 0.9;
        if (f === 3 && a.off < 0) return -a.off - hx < WALK + 0.9;
        return false;
      }
      const c = nearestLine(b.z, cz);
      if (f === 0 && c.off > 0) return c.off - hz < WALK + 0.9;
      if (f === 1 && c.off < 0) return -c.off - hz < WALK + 0.9;
      return false;
    }
    const WANT = [3.2, 4.0, 2.4, 2.4];
    let nYards = 0;
    houses.forEach(function (b) {
      const pr = placedOf(b);
      const hx = b.w / 2, hz = b.d / 2;
      const st = [0, 1, 2, 3].map(function (f) { return streetFace(b, f); });
      const e = [0, 1, 2, 3].map(function (f) { return st[f] ? 0 : faceRoom(b, f, WANT[f], pr); });
      for (let f = 0; f < 4; f++) if (!st[f] && e[f] < 0.9) e[f] = 0;
      if (ctx.debug) b._dbg = { st: st, e: e };
      const X0 = b.x - hx - e[2], X1 = b.x + hx + e[3], Z0 = b.z - hz - e[0], Z1 = b.z + hz + e[1];
      const hs = h01(b.x, b.z, 0xd01);
      const style = hs < 0.45 ? "picket" : hs < 0.75 ? "wall" : "hedge";
      const tone = COL.render[(h01(b.x, b.z, 0xd02) * COL.render.length) | 0];
      const owner = { b: b, placedRec: pr };
      const doorX = b.x, doorZ = b.z - hz;

      // ---- the path from the door to the street, and where it crosses the
      // yard line (that is where the gate goes)
      const pts = [];
      let gate = null;       // {edge, at}
      let mailAt = null;     // {x, z, yaw}
      if (st[0] || e[0] < 0.9) {
        // the door opens straight onto the sidewalk (or onto nothing): the
        // mailbox goes on the wall beside it
        if (st[0]) wallMailbox();
      } else {
        const zp = doorZ - Math.min(e[0] * 0.55, 1.6);
        pts.push([doorX, doorZ - 0.05], [doorX, zp]);
        if (st[2] || st[3]) {
          const sx = st[2] ? -1 : 1;
          const edgeX = sx < 0 ? b.x - hx : b.x + hx;         // the side face line = the sidewalk edge
          pts.push([edgeX - sx * 0.05, zp]);
          gate = { run: sx < 0 ? "Lx" : "Rx", at: zp };
          // beside the gate, on whichever side of the path the yard has room
          mailAt = { x: edgeX - sx * 0.55, z: zp - 0.9, yaw: sx < 0 ? -Math.PI / 2 : Math.PI / 2 };
          if (mailAt.z < Z0 + 0.3) mailAt.z = zp + 0.9;
        } else if (st[1]) {
          const side = e[2] >= e[3] ? 2 : 3;
          if (e[side] >= 1.2) {
            const sx = side === 2 ? -1 : 1;
            const xp = b.x + sx * (hx + e[side] * 0.5);
            pts.push([xp, zp], [xp, b.z + hz]);
            gate = { run: "back", at: xp };
            mailAt = { x: xp + sx * Math.max(0, e[side] * 0.5 - 0.4), z: Z1 - 0.55, yaw: 0 };
          }
        } else {
          pts.push([doorX, Z0 + 0.05]);
          gate = { run: "front", at: doorX };
          mailAt = { x: doorX + 1.0, z: Z0 + 0.35, yaw: Math.PI };
        }
        for (let i = 0; i + 1 < pts.length; i++) pathSeg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 1.0);
        // planted beds along the front wall either side of the door
        if (e[0] >= 1.6) {
          for (const s of [-1, 1]) {
            const x0 = doorX + s * 1.0, x1 = b.x + s * (hx - 0.35);
            const w = Math.abs(x1 - x0);
            if (w < 0.8) continue;
            const mx = (x0 + x1) / 2, mz = doorZ - 0.5;
            const gy = gh(mx, mz);
            box(A.soil, mx, gy - 0.02, mz, w, 0.08, 0.85, 0, COL.mulch, {});
            box(A.mason, mx, gy + 0.02, mz - 0.45, w + 0.1, 0.1, 0.06, 0, COL.granite, {});
            shrubs(mx, mz, w * 0.5, 0.25, Math.max(1, Math.round(w / 0.9)), 0x3e1 + i4(b.x), undefined, true);
          }
        }
      }
      function i4(v) { return (Math.abs(v * 13) | 0) % 911; }
      // a letterbox on the wall beside the door (no room for a post one)
      function wallMailbox() {
        const mx = doorX + 1.35, mz = doorZ - 0.06, gy = b.gy;
        box(A.paint, mx, gy + 1.25, mz, 0.34, 0.26, 0.1, 0, COL.steelDark, {});
        box(A.paint, mx, gy + 1.39, mz - 0.02, 0.36, 0.03, 0.14, 0, COL.steelDark, {});
        out.mailboxes.push({ x: mx, z: mz });
      }

      // ---- the fence: every yard edge that is not the house's own wall
      const skipIn = null;
      const runsDef = [
        // front (-z) edge
        { id: "front", x0: X0, z0: Z0, x1: X1, z1: Z0, on: e[0] > 0 || st[0] },
        { id: "back", x0: X0, z0: Z1, x1: X1, z1: Z1, on: e[1] > 0 || st[1] },
        { id: "Lx", x0: X0, z0: Z0, x1: X0, z1: Z1, on: e[2] > 0 || st[2] },
        { id: "Rx", x0: X1, z0: Z0, x1: X1, z1: Z1, on: e[3] > 0 || st[3] },
      ];
      const any = e[0] + e[1] + e[2] + e[3] > 0;
      if (any) nYards++;
      runsDef.forEach(function (r) {
        if (!r.on || !any) return;
        // pull a street edge 0.3 m in off the back of the sidewalk
        let x0 = r.x0, z0 = r.z0, x1 = r.x1, z1 = r.z1;
        if (r.id === "front" && st[0]) { z0 += 0.3; z1 += 0.3; }
        if (r.id === "back" && st[1]) { z0 -= 0.3; z1 -= 0.3; }
        if (r.id === "Lx" && st[2]) { x0 += 0.3; x1 += 0.3; }
        if (r.id === "Rx" && st[3]) { x0 -= 0.3; x1 -= 0.3; }
        const gates = [];
        if (gate && gate.run === r.id) gates.push({ at: gate.at, w: 1.2 });
        fenceRun(style, x0, z0, x1, z1, gates, tone, owner, skipIn);
        if (gate && gate.run === r.id) {
          const alongX = r.id === "front" || r.id === "back";
          gatePosts(style, alongX ? gate.at : x0, alongX ? z0 : gate.at, alongX, 1.2, tone);
        }
      });

      // ---- the mailbox where the path meets the street
      const inYard = function (q) {
        return q.x > X0 + 0.25 && q.x < X1 - 0.25 && q.z > Z0 + 0.25 && q.z < Z1 - 0.25 &&
          !(Math.abs(q.x - b.x) < hx + 0.25 && Math.abs(q.z - b.z) < hz + 0.25) &&
          Math.abs(q.x - doorX) + Math.abs(q.z - (doorZ - 0.6)) > 0.9;
      };
      if (mailAt && inYard(mailAt) && !isWalk(mailAt.x, mailAt.z) && !inStreet(mailAt.x, mailAt.z, 0.1) && !treeNear(mailAt.x, mailAt.z, 0.6)) {
        mailbox(mailAt.x, mailAt.z, mailAt.yaw);
      } else if (!st[0] && e[0] > 0) wallMailbox();
      // ---- the wheelie bin against a side wall, a pace behind the front
      const binSide = e[2] >= 1.0 ? 2 : e[3] >= 1.0 ? 3 : -1;
      if (binSide > 0) {
        const sx = binSide === 2 ? -1 : 1;
        const bx = b.x + sx * (hx + 0.62), bz = b.z - hz + 1.1 + h01(b.x, b.z, 0xd05) * 1.2;
        if (!treeNear(bx, bz, 0.8) && !blocked(bx - 0.4, bx + 0.4, bz - 0.4, bz + 0.4, gh(bx, bz))) wheelieBin(bx, bz, sx < 0 ? Math.PI / 2 : -Math.PI / 2, 0xd06);
      } else if (e[0] >= 1.4) {
        const bx = doorX + (hx > 2.6 ? 2.1 : -2.1), bz = doorZ - 0.5;
        if (!treeNear(bx, bz, 0.8) && !blocked(bx - 0.4, bx + 0.4, bz - 0.4, bz + 0.4, gh(bx, bz))) wheelieBin(bx, bz, Math.PI, 0xd07);
      }
      // ---- a rotary washing line in a back yard deep enough to hang one
      if (e[1] >= 3.0 && h01(b.x, b.z, 0xd08) < 0.6) {
        const wx = b.x + (h01(b.x, b.z, 0xd09) - 0.5) * (b.w - 2), wz = b.z + hz + e[1] * 0.55;
        const gy = gh(wx, wz);
        if (!treeNear(wx, wz, 1.6)) {
          cylY(A.paint, wx, gy - 0.2, wz, 0.03, 0.025, 2.1, 6, COL.galv, {});
          for (let k = 0; k < 4; k++) {
            const a = k * Math.PI / 2 + 0.3;
            rod(A.paint, wx, gy + 1.8, wz, wx + Math.cos(a) * 1.15, gy + 1.72, wz + Math.sin(a) * 1.15, 0.012, 4, COL.galv, {});
          }
          for (const rr of [0.5, 0.85]) for (let k = 0; k < 4; k++) {
            const a0 = k * Math.PI / 2 + 0.3, a1 = a0 + Math.PI / 2;
            rod(A.paint, wx + Math.cos(a0) * rr, gy + 1.76, wz + Math.sin(a0) * rr, wx + Math.cos(a1) * rr, gy + 1.76, wz + Math.sin(a1) * rr, 0.006, 3, COL.paintWhite, {});
          }
          addCol(wx - 0.05, wx + 0.05, wz - 0.05, wz + 0.05, gy, gy + 2, "pole");
        }
      }
    });

    /* ==================================================================
       4. TOWER FORECOURTS: two planters flanking the door where they fit
       ================================================================== */
    towers.forEach(function (b) {
      const dz = b.z - b.d / 2;
      for (const s of [-1, 1]) {
        const px = b.x + s * 2.3, pz = dz - 0.95;
        if (inStreet(px, pz, -0.1) || isWalk(px, pz) || inPlaced(px, pz, 0.6, placedOf(b))) continue;
        if (Math.abs(gh(px, pz) - b.gy) > 0.3 || treeNear(px, pz, 1.2) || blocked(px - 0.7, px + 0.7, pz - 0.7, pz + 0.7, b.gy)) continue;
        planterBox(px, pz, 1.1, 0.55);
      }
    });

    /* ==================================================================
       5. HYDRANTS: one per road piece, behind the kerb
       ================================================================== */
    (ctx.roadSegs || []).forEach(function (seg) {
      if (seg.len < 18) return;
      const side = h01(seg.x, seg.z, 0xe01) < 0.5 ? -1 : 1;
      const along = (h01(seg.x, seg.z, 0xe02) - 0.5) * seg.len * 0.5;
      const off = side * (RC.HW + 0.55);
      const x = seg.x + (seg.vertical ? off : along), z = seg.z + (seg.vertical ? along : off);
      if (!isWalk(x, z)) return;
      const gy = sh(x, z);
      if (blocked(x - 0.7, x + 0.7, z - 0.7, z + 0.7, gy)) return;
      hydrant(x, z, gy, h01(x, z, 0xe03) < 0.7);
    });

    /* ==================================================================
       6. THE DOCK: a timber pier straight out off the beach, on an axis
       (platforms are boxes) where the water gets deep soonest
       ================================================================== */
    (function dock() {
      const oy = ctx.oceanY != null ? ctx.oceanY : -0.8;
      const DECK = oy + 1.75, HW = 1.6;
      let best = null;
      for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let off = -44; off <= 44; off += 4) {
        const px = dir[0] ? 0 : off, pz = dir[1] ? 0 : off;
        let t0 = null;
        for (let t = 60; t < R + 40; t += 0.5) {
          const x = cx + px + dir[0] * t, z = cz + pz + dir[1] * t;
          if (gh(x, z) < -0.15 && dC(x, z) > R - 4) { t0 = t; break; }
        }
        if (t0 == null) continue;
        let tDeep = null;
        for (let t = t0; t < t0 + 60; t += 0.5) {
          const x = cx + px + dir[0] * t, z = cz + pz + dir[1] * t;
          if (gh(x, z) < oy - 2.2) { tDeep = t; break; }
        }
        if (tDeep == null) continue;
        const len = tDeep - t0 + 6;
        // clear of everything on the land end
        const lx = cx + px + dir[0] * (t0 - 3), lz = cz + pz + dir[1] * (t0 - 3);
        if (inPlaced(lx, lz, 3) || treeNear(lx, lz, 3) || rockNear(lx, lz, 2)) continue;
        // no islet in the way
        let clear = true;
        for (let t = t0; t <= t0 + len + 8 && clear; t += 2) {
          const x = cx + px + dir[0] * t, z = cz + pz + dir[1] * t;
          for (const s of [-HW - 4, 0, HW + 4]) if (gh(x + dir[1] * s, z + dir[0] * s) > DECK - 0.8 && t > t0 + 6) clear = false;
        }
        if (!clear) continue;
        const score = -len - Math.abs(off) * 0.05 + h01(off, dir[0] * 3 + dir[1], 0xd0c) * 2;
        if (!best || score > best.score) best = { dir: dir, px: px, pz: pz, t0: t0, len: len, score: score };
      }
      if (!best) return;
      const d = best.dir, ax = d[0] !== 0;        // pier along x?
      const P = function (t, s) { return { x: cx + best.px + d[0] * t + (ax ? 0 : s), z: cz + best.pz + d[1] * t + (ax ? s : 0) }; };
      const RAMP = 5.5;
      const tA = best.t0 - RAMP, tB = best.t0, tE = best.t0 + best.len;
      const gA = gh(P(tA, 0).x, P(tA, 0).z);
      const wood = COL.timberGrey, dark = COL.timberDark;
      // piles every 3 m down both sides, into the seabed
      for (let t = tB; t <= tE + 1e-6; t += 3) for (const s of [-HW + 0.15, HW - 0.15]) {
        const p = P(t, s), bed = gh(p.x, p.z);
        rod(A.wood, p.x, bed - 0.6, p.z, p.x, DECK - 0.05, p.z, 0.15, 9, dark, { ao: oy + 0.2, aoK: 0.45, aoH: 1.6 });
      }
      // T head piles
      const TH = 4.5, TW = 5.5;
      for (let t = tE; t <= tE + TH + 1e-6; t += 2.25) for (const s of [-TW, -TW / 2, TW / 2, TW]) {
        const p = P(t, s), bed = gh(p.x, p.z);
        rod(A.wood, p.x, bed - 0.6, p.z, p.x, DECK - 0.05, p.z, 0.15, 9, dark, { ao: oy + 0.2, aoK: 0.45, aoH: 1.6 });
      }
      // stringers + planks. Planks run ACROSS the pier.
      const deckRun = function (t0, t1, w) {
        for (const s of [-w + 0.25, 0, w - 0.25]) {
          const a = P(t0, s), b = P(t1, s);
          beam(A.wood, a.x, DECK - 0.22, a.z, b.x, DECK - 0.22, b.z, 0.26, 0.1, dark, { hgrain: true });
        }
        const n = Math.floor((t1 - t0) / 0.2);
        for (let i = 0; i < n; i++) {
          const t = t0 + (i + 0.5) * (t1 - t0) / n;
          const p = P(t, 0), c = vary(wood, h01(p.x, p.z, 0xd11), 0.14);
          box(A.wood, p.x, DECK - 0.04, p.z, ax ? 0.18 : 2 * w, 0.07, ax ? 2 * w : 0.18, 0, c, { grain: ax ? "z" : "x", hgrain: true });
        }
      };
      deckRun(tB, tE, HW);
      deckRun(tE, tE + TH, TW + 0.3);
      // the ramp: the same planks climbing from the sand to the deck
      {
        const n = Math.floor(RAMP / 0.2);
        for (let i = 0; i < n; i++) {
          const u = (i + 0.5) / n, t = tA + RAMP * u;
          const p = P(t, 0), y = gA + 0.05 + (DECK - gA - 0.05) * u;
          box(A.wood, p.x, y - 0.04, p.z, ax ? 0.18 : 2 * HW, 0.07, ax ? 2 * HW : 0.18, 0, vary(wood, h01(p.x, p.z, 0xd12), 0.14), { grain: ax ? "z" : "x", hgrain: true });
        }
        for (const s of [-HW + 0.25, HW - 0.25]) {
          const a = P(tA, s), b = P(tB, s);
          beam(A.wood, a.x, gA - 0.12, a.z, b.x, DECK - 0.2, b.z, 0.24, 0.1, dark, { hgrain: true });
        }
      }
      // bollards and cleats on the T head, a ladder down at the end
      for (const s of [-TW + 0.4, TW - 0.4]) for (const tt of [tE + 0.5, tE + TH - 0.4]) {
        const p = P(tt, s);
        cylY(A.paint, p.x, DECK, p.z, 0.16, 0.13, 0.42, 12, COL.steelDark, {});
        cylY(A.paint, p.x, DECK + 0.42, p.z, 0.22, 0.22, 0.07, 12, COL.steelDark, {});
        addCol(p.x - 0.2, p.x + 0.2, p.z - 0.2, p.z + 0.2, DECK, DECK + 0.5, "bollard");
      }
      {
        const e = P(tE + TH + 0.08, 0.6), e2 = P(tE + TH + 0.08, -0.6);
        for (const q of [e, e2]) rod(A.paint, q.x, oy - 1.6, q.z, q.x, DECK + 0.9, q.z, 0.025, 6, COL.galv, {});
        for (let y = oy - 1.4; y < DECK; y += 0.3) rod(A.paint, e.x, y, e.z, e2.x, y, e2.z, 0.018, 5, COL.galv, {});
      }
      // walkable: ramp (axis ramp), deck, T head
      const rect = function (t0, t1, w) {
        const a = P(t0, -w), b = P(t1, w);
        return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) };
      };
      const rr = rect(tA, tB, HW), dr = rect(tB, tE, HW), tr = rect(tE, tE + TH, TW + 0.3);
      const ra = P(tA, 0), rb = P(tB, 0);
      addPlat(rr.x0, rr.x1, rr.z0, rr.z1, DECK, ax
        ? { axis: "x", x0: ra.x, x1: rb.x, y0: gA + 0.05, y1: DECK }
        : { z0: ra.z, z1: rb.z, y0: gA + 0.05, y1: DECK });
      addPlat(dr.x0, dr.x1, dr.z0, dr.z1, DECK);
      addPlat(tr.x0, tr.x1, tr.z0, tr.z1, DECK);
      const tip = P(tE + TH, 0);
      out.pier = { x0: ra.x, z0: ra.z, x1: tip.x, z1: tip.z, deck: DECK, width: HW * 2, head: TW * 2, flammable: true };
      out.flammable.push(out.pier);
    })();

    /* ==================================================================
       7. THE FARM, out past the last street
       ================================================================== */
    (function farm() {
      const fields = [];
      const want = [[24, 16], [18, 13]];
      // one ground test per 2 m lattice point, shared by every candidate
      const memo = new Map();
      const farmGround = function (px, pz) {
        const key = Math.round(px * 2) * 100003 + Math.round(pz * 2);
        let v = memo.get(key);
        if (v === undefined) {
          v = (dC(px, pz) > R - 7 || nearLaidRoad(px, pz, 0.8) || isWalk(px, pz) || inPlaced(px, pz, 2.5) || treeNear(px, pz, 1.5) || rockNear(px, pz, 1.0)) ? NaN : gh(px, pz);
          memo.set(key, v);
        }
        return v;
      };
      for (let f = 0; f < want.length; f++) {
        let best = null;
        for (const rot of [0, 1]) {
          const W = rot ? want[f][1] : want[f][0], D = rot ? want[f][0] : want[f][1];
          for (let x = cx - R; x <= cx + R; x += 4) for (let z = cz - R; z <= cz + R; z += 4) {
            const d = dC(x, z);
            if (d < 58) continue;
            if (inPlaced(x, z, Math.max(W, D) / 2 + 2.5) && inPlaced(x, z, Math.min(W, D) / 2 + 2.5)) continue;
            if (dC(x - W / 2, z - D / 2) > R - 7 || dC(x + W / 2, z + D / 2) > R - 7 || dC(x - W / 2, z + D / 2) > R - 7 || dC(x + W / 2, z - D / 2) > R - 7) continue;
            if (nearLaidRoad(x, z, 0.8) || nearLaidRoad(x - W / 2, z - D / 2, 0.8) || nearLaidRoad(x + W / 2, z + D / 2, 0.8)) continue;
            let overl = false;
            for (const q of fields) if (Math.abs(q.x - x) < (q.w + W) / 2 + 4 && Math.abs(q.z - z) < (q.d + D) / 2 + 4) overl = true;
            if (overl) continue;
            let ok = true, lo = 1e9, hi = -1e9;
            for (let i = -W / 2 - 1; i <= W / 2 + 1 + 1e-6 && ok; i += 2) for (let j = -D / 2 - 1; j <= D / 2 + 1 + 1e-6; j += 2) {
              const g = farmGround(x + i, z + j);
              if (g !== g) { ok = false; break; }
              if (g < lo) lo = g; if (g > hi) hi = g;
            }
            if (!ok || hi - lo > 0.8) continue;
            if (blocked(x - W / 2, x + W / 2, z - D / 2, z + D / 2, lo)) continue;
            const score = d * 0.5 - (hi - lo) * 10 + (out.plaza ? Math.hypot(x - out.plaza.x, z - out.plaza.z) * 0.1 : 0);
            if (!best || score > best.score) best = { x: x, z: z, w: W, d: D, score: score };
          }
        }
        if (!best) break;
        fields.push(best);
      }
      fields.forEach(function (F, fi) {
        const x0 = F.x - F.w / 2, x1 = F.x + F.w / 2, z0 = F.z - F.d / 2, z1 = F.z + F.d / 2;
        // the gate faces the town
        const toC = [cx - F.x, cz - F.z];
        const gateRun = Math.abs(toC[0]) > Math.abs(toC[1]) ? (toC[0] > 0 ? "R" : "L") : (toC[1] > 0 ? "B" : "F");
        const gAt = gateRun === "L" || gateRun === "R" ? F.z : F.x;
        const owner = { field: fi };
        fenceRun("rail", x0, z0, x1, z0, gateRun === "F" ? [{ at: gAt, w: 3.8 }] : [], null, owner);
        fenceRun("rail", x0, z1, x1, z1, gateRun === "B" ? [{ at: gAt, w: 3.8 }] : [], null, owner);
        fenceRun("rail", x0, z0, x0, z1, gateRun === "L" ? [{ at: gAt, w: 3.8 }] : [], null, owner);
        fenceRun("rail", x1, z0, x1, z1, gateRun === "R" ? [{ at: gAt, w: 3.8 }] : [], null, owner);
        // the field gate, a galvanised five-bar, swung open against the fence
        {
          const alongX = gateRun === "F" || gateRun === "B";
          const hx = alongX ? gAt - 1.8 : (gateRun === "L" ? x0 : x1);
          const hz = alongX ? (gateRun === "F" ? z0 : z1) : gAt - 1.8;
          const gy = gh(hx, hz);
          const ex = alongX ? hx : hx + (gateRun === "L" ? 1 : -1) * 3.4;
          const ez = alongX ? hz + (gateRun === "F" ? 1 : -1) * 3.4 : hz;
          for (let k = 0; k < 5; k++) rod(A.paint, hx, gy + 0.3 + k * 0.2, hz, ex, gy + 0.3 + k * 0.2, ez, 0.022, 6, COL.galv, {});
          rod(A.paint, hx, gy + 0.25, hz, hx, gy + 1.15, hz, 0.03, 6, COL.galv, {});
          rod(A.paint, ex, gy + 0.25, ez, ex, gy + 1.15, ez, 0.03, 6, COL.galv, {});
          rod(A.paint, hx, gy + 0.3, hz, ex, gy + 1.1, ez, 0.02, 6, COL.galv, {});
        }
        // the barn goes in the first field's far corner, away from the gate
        let barn = null;
        if (fi === 0) {
          const bw = 8, bd = 6.5;
          const bx = gateRun === "L" ? x1 - bw / 2 - 1.5 : gateRun === "R" ? x0 + bw / 2 + 1.5 : F.x + F.w / 2 - bw / 2 - 1.5;
          const bz = gateRun === "F" ? z1 - bd / 2 - 1.5 : gateRun === "B" ? z0 + bd / 2 + 1.5 : F.z + F.d / 2 - bd / 2 - 1.5;
          barn = makeBarn(bx, bz, bw, bd, gateRun);
        }
        // crop rows over ploughed soil (clear of the barn), or pasture + bales
        const crops = fi === 0 || h01(F.x, F.z, 0xf31) < 0.5;
        const m = 1.4;
        const rx0 = x0 + m, rx1 = x1 - m, rz0 = z0 + m, rz1 = z1 - m;
        const inBarn = function (px, pz) { return barn && Math.abs(px - barn.x) < barn.w / 2 + 1.8 && Math.abs(pz - barn.z) < barn.d / 2 + 2.3; };
        if (crops) {
          const rowsAlongX = (rx1 - rx0) >= (rz1 - rz0);
          const cell = 2;
          for (let px = rx0; px < rx1 - 1e-6; px += cell) for (let pz = rz0; pz < rz1 - 1e-6; pz += cell) {
            const qx1 = Math.min(rx1, px + cell), qz1 = Math.min(rz1, pz + cell);
            if (inBarn((px + qx1) / 2, (pz + qz1) / 2)) continue;
            quad(A.soil, new V3(px, gh(px, pz) + 0.03, pz), new V3(px, gh(px, qz1) + 0.03, qz1), new V3(qx1, gh(qx1, qz1) + 0.03, qz1), new V3(qx1, gh(qx1, pz) + 0.03, pz), vary(COL.soil, h01(px, pz, 0xf32), 0.1), { faceUp: true });
          }
          const span0 = rowsAlongX ? rz0 : rx0, span1 = rowsAlongX ? rz1 : rx1;
          const run0 = rowsAlongX ? rx0 : rz0, run1 = rowsAlongX ? rx1 : rz1;
          for (let r = span0 + 0.45; r < span1 - 0.2; r += 0.9) {
            for (let a = run0; a < run1 - 1e-6; a += 3) {
              const b = Math.min(run1, a + 3);
              const pa = rowsAlongX ? [a, r] : [r, a], pb = rowsAlongX ? [b, r] : [r, b];
              if (inBarn((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)) continue;
              const c = vary(COL.crop, h01(pa[0], pa[1], 0xf33), 0.2);
              const ya = gh(pa[0], pa[1]), yb = gh(pb[0], pb[1]);
              // the furrow ridge, then the crop on it
              beam(A.soil, pa[0], ya + 0.06, pa[1], pb[0], yb + 0.06, pb[1], 0.14, 0.42, shade(COL.soil, 0.85), {});
              beam(A.plant, pa[0], ya + 0.26, pa[1], pb[0], yb + 0.26, pb[1], 0.34, 0.26, c, { ao: Math.min(ya, yb) + 0.1, aoK: 0.5, aoH: 0.35 });
            }
          }
        }
        // round bales: by the barn, and a few out in a pasture
        const baleAt = [];
        if (barn) {
          // a row along the long wall that faces into the field
          const zs = barn.z > F.z ? -1 : 1;
          for (let k = 0; k < 4; k++) baleAt.push([barn.x - barn.w / 2 + 1.0 + k * 1.6, barn.z + zs * (barn.d / 2 + 1.0), 0]);
        }
        if (!crops) {
          for (let k = 0; k < 5; k++) {
            const px = F.x + (h01(F.x + k, F.z, 0xf41) - 0.5) * (F.w - 5), pz = F.z + (h01(F.x, F.z + k, 0xf42) - 0.5) * (F.d - 5);
            baleAt.push([px, pz, h01(px, pz, 0xf43) * Math.PI]);
          }
        }
        baleAt.forEach(function (q) {
          const px = q[0], pz = q[1], gy = gh(px, pz), yaw = q[2];
          if (inStreet(px, pz, 0.5) || treeNear(px, pz, 1.2) || blocked(px - 0.8, px + 0.8, pz - 0.8, pz + 0.8, gy)) return;
          const r = 0.72, L2 = 0.6, ex = Math.cos(yaw) * L2, ez = -Math.sin(yaw) * L2;
          const c = vary(COL.straw, h01(px, pz, 0xf44), 0.12);
          rod(A.plant, px - ex, gy + r - 0.04, pz - ez, px + ex, gy + r - 0.04, pz + ez, r, 16, c, { ao: gy, aoK: 0.45, aoH: 0.6 });
          const col = addCol(px - 0.8, px + 0.8, pz - 0.8, pz + 0.8, gy, gy + 1.4, "bale");
          const rec = { x: px, z: pz, collider: col, flammable: true };
          out.bales.push(rec); out.flammable.push(rec);
        });
        out.fields.push({ x: F.x, z: F.z, w: F.w, d: F.d, crops: crops, barn: barn });
      });

      function makeBarn(bx, bz, w, d, gateRun) {
        const gy = Math.max(gh(bx - w / 2, bz - d / 2), gh(bx + w / 2, bz - d / 2), gh(bx - w / 2, bz + d / 2), gh(bx + w / 2, bz + d / 2));
        const lo = Math.min(gh(bx - w / 2, bz - d / 2), gh(bx + w / 2, bz - d / 2), gh(bx - w / 2, bz + d / 2), gh(bx + w / 2, bz + d / 2));
        const EH = 3.4, RH = 5.6;
        const red = vary(COL.barnRed, h01(bx, bz, 0xf51), 0.12), trim = COL.paintWhite;
        // concrete plinth
        box(A.mason, bx, (gy + lo) / 2 - 0.05, bz, w + 0.3, gy - lo + 0.35, d + 0.3, 0, COL.concrete, {});
        const y0 = gy + 0.12;
        // board-and-batten walls: long walls along x, gable walls on the x ends
        box(A.wood, bx, y0 + EH / 2, bz - d / 2 + 0.08, w, EH, 0.16, 0, red, { ao: y0, aoK: 0.3 });
        box(A.wood, bx, y0 + EH / 2, bz + d / 2 - 0.08, w, EH, 0.16, 0, red, { ao: y0, aoK: 0.3 });
        for (let k = 0; k <= Math.floor(w / 0.4); k++) for (const s of [-1, 1]) {
          box(A.wood, bx - w / 2 + 0.2 + k * 0.4 - 0.2, y0 + EH / 2, bz + s * (d / 2 + 0.005), 0.05, EH, 0.03, 0, shade(red, 0.9), {});
        }
        // gable ends: pentagon walls
        for (const s of [-1, 1]) {
          const gx = bx + s * (w / 2 - 0.08);
          const pts = [[-d / 2, 0], [d / 2, 0], [d / 2, EH], [0, RH], [-d / 2, EH]];
          const V = pts.map(function (p) { return new V3(gx + s * 0.08, y0 + p[1], bz + p[0] * -s); });
          quad(A.wood, V[0], V[1], V[2], V[4], red, { ao: y0, aoK: 0.3 });
          tri(A.wood, V[4], V[2], V[3], red, {});
          const Vb = pts.map(function (p) { return new V3(gx - s * 0.08, y0 + p[1], bz + p[0] * s); });
          quad(A.wood, Vb[0], Vb[1], Vb[2], Vb[4], shade(red, 0.5), {});
          tri(A.wood, Vb[4], Vb[2], Vb[3], shade(red, 0.5), {});
          // corner trim + gable trim
          for (const t of [-1, 1]) box(A.wood, gx + s * 0.1, y0 + EH / 2, bz + t * (d / 2 - 0.06), 0.06, EH, 0.16, 0, trim, {});
          for (const t of [-1, 1]) beam(A.wood, gx + s * 0.13, y0 + EH, bz + t * (d / 2 + 0.2), gx + s * 0.13, y0 + RH + 0.05, bz, 0.16, 0.05, trim, {});
        }
        // the big doors on the gable that faces the field's middle
        const doorSide = bx > F_mid() ? -1 : 1;     // the doors open onto the field
        const dx = bx + doorSide * (w / 2 + 0.03);
        box(A.wood, dx + doorSide * 0.03, y0 + 1.5, bz, 0.06, 3.0, 3.2, 0, shade(red, 0.8), {});
        for (const t of [-1, 1]) {
          beam(A.wood, dx + doorSide * 0.07, y0 + 0.1, bz + t * 1.55, dx + doorSide * 0.07, y0 + 2.95, bz + t * 1.55, 0.12, 0.04, trim, {});
          beam(A.wood, dx + doorSide * 0.07, y0 + 0.15, bz + t * 1.5, dx + doorSide * 0.07, y0 + 2.9, bz + t * 0.05, 0.1, 0.04, trim, {});
          beam(A.wood, dx + doorSide * 0.07, y0 + 2.9, bz + t * 1.5, dx + doorSide * 0.07, y0 + 0.15, bz + t * 0.05, 0.1, 0.04, trim, {});
        }
        beam(A.wood, dx + doorSide * 0.07, y0 + 3.0, bz - 1.6, dx + doorSide * 0.07, y0 + 3.0, bz + 1.6, 0.12, 0.04, trim, {});
        // loft door
        box(A.wood, dx + doorSide * 0.04, y0 + 4.1, bz, 0.05, 0.9, 1.0, 0, shade(red, 0.75), {});
        // corrugated tin roof: two slopes with an overhang, ribs as darker strips
        const ov = 0.35;
        for (const s of [-1, 1]) {
          const a = new V3(bx - w / 2 - ov, y0 + RH + 0.08, bz), b = new V3(bx + w / 2 + ov, y0 + RH + 0.08, bz);
          const c = new V3(bx + w / 2 + ov, y0 + EH - 0.2, bz + s * (d / 2 + ov)), e = new V3(bx - w / 2 - ov, y0 + EH - 0.2, bz + s * (d / 2 + ov));
          const tin = vary(COL.roofTin, h01(bx, bz + s, 0xf52), 0.1);
          if (s > 0) quad(A.paint, a, e, c, b, tin, {}); else quad(A.paint, a, b, c, e, tin, {});
          // underside
          if (s > 0) quad(A.paint, a, b, c, e, shade(tin, 0.35), {}); else quad(A.paint, a, e, c, b, shade(tin, 0.35), {});
          for (let k = 0; k <= Math.floor((w + 2 * ov) / 0.5); k++) {
            const xx = bx - w / 2 - ov + k * 0.5;
            beam(A.paint, xx, y0 + RH + 0.1, bz, xx, y0 + EH - 0.18, bz + s * (d / 2 + ov), 0.025, 0.05, shade(tin, 0.8), {});
          }
        }
        box(A.paint, bx, y0 + RH + 0.12, bz, w + 2 * ov, 0.08, 0.35, 0, shade(COL.roofTin, 0.8), {});
        const col = addCol(bx - w / 2 - 0.1, bx + w / 2 + 0.1, bz - d / 2 - 0.1, bz + d / 2 + 0.1, lo - 0.2, y0 + RH, "barn");
        const rec = { x: bx, z: bz, w: w, d: d, h: RH, collider: col, doorSide: doorSide, flammable: true, fragile: true };
        out.barns.push(rec); out.flammable.push(rec);
        return rec;
      }
      function F_mid() { return fields.length ? fields[0].x : cx; }
    })();

    /* ==================================================================
       8. ROCKS (sites from the arena's own boulder stream)
       ================================================================== */
    (function rocks() {
      const ico = new THREE.IcosahedronGeometry(1, 2);
      const icoS = new THREE.IcosahedronGeometry(1, 1);
      function rock(x, y, z, sx, sy, sz, yaw, tilt, salt, small) {
        const g = small ? icoS : ico;
        const P = g.attributes.position.array, cnt = g.attributes.position.count;
        // three cleavage planes: the flat broken faces that make a rock a rock
        const cuts = [];
        for (let k = 0; k < 3; k++) {
          const a = ih(salt, k, 1) * Math.PI * 2, e = (ih(salt, k, 2) - 0.3) * 1.2;
          cuts.push({ x: Math.cos(a) * Math.cos(e), y: Math.sin(e), z: Math.sin(a) * Math.cos(e), o: 0.7 + 0.14 * ih(salt, k, 3) });
        }
        const m = mat4(x, y, z, sx, sy, sz, yaw, tilt, tilt * 0.6);
        const pos = new Float32Array(cnt * 3);
        const v = new V3();
        for (let i = 0; i < cnt; i++) {
          let px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
          const r = 1 + 0.2 * (vn3(px * 1.5 + salt, py * 1.5, pz * 1.5, 11) - 0.5) + 0.08 * (vn3(px * 4.1, py * 4.1 + salt, pz * 4.1, 12) - 0.5);
          px *= r; py *= r; pz *= r;
          for (const c of cuts) {
            const dd = px * c.x + py * c.y + pz * c.z;
            if (dd > c.o) { const k2 = dd - c.o; px -= c.x * k2; py -= c.y * k2; pz -= c.z * k2; }
          }
          if (py < -0.55) py = -0.55;
          v.set(px, py, pz).applyMatrix4(m);
          pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        }
        // flat normals, then averaged over coincident corners, mixed 55/45 so
        // the cleavage faces stay crisp and the weathered body reads round
        const fnA = new Float32Array(cnt * 3);
        const key = new Map();
        for (let i = 0; i < cnt; i += 3) {
          _e1.set(pos[i * 3 + 3] - pos[i * 3], pos[i * 3 + 4] - pos[i * 3 + 1], pos[i * 3 + 5] - pos[i * 3 + 2]);
          _e2.set(pos[i * 3 + 6] - pos[i * 3], pos[i * 3 + 7] - pos[i * 3 + 1], pos[i * 3 + 8] - pos[i * 3 + 2]);
          _fn.crossVectors(_e1, _e2).normalize();
          for (let k = 0; k < 3; k++) {
            const j = i + k;
            fnA[j * 3] = _fn.x; fnA[j * 3 + 1] = _fn.y; fnA[j * 3 + 2] = _fn.z;
            const kk = Math.round(pos[j * 3] * 500) + "," + Math.round(pos[j * 3 + 1] * 500) + "," + Math.round(pos[j * 3 + 2] * 500);
            let s = key.get(kk);
            if (!s) { s = [0, 0, 0]; key.set(kk, s); }
            s[0] += _fn.x; s[1] += _fn.y; s[2] += _fn.z;
          }
        }
        const baseT = [0.13 + 0.03 * ih(salt, 9, 4), 0.122 + 0.025 * ih(salt, 9, 5), 0.108 + 0.02 * ih(salt, 9, 6)];
        const gyl = y - sy * 0.55;
        const vv = [new V3(), new V3(), new V3()], nn = [new V3(), new V3(), new V3()];
        for (let i = 0; i < cnt; i += 3) {
          let lichen = 0, up = 0;
          for (let k = 0; k < 3; k++) {
            const j = i + k;
            const kk = Math.round(pos[j * 3] * 500) + "," + Math.round(pos[j * 3 + 1] * 500) + "," + Math.round(pos[j * 3 + 2] * 500);
            const s = key.get(kk);
            const l = Math.hypot(s[0], s[1], s[2]) || 1;
            vv[k].set(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
            nn[k].set(fnA[j * 3] * 0.45 + s[0] / l * 0.55, fnA[j * 3 + 1] * 0.45 + s[1] / l * 0.55, fnA[j * 3 + 2] * 0.45 + s[2] / l * 0.55).normalize();
            up += nn[k].y / 3;
          }
          lichen = vn3(vv[0].x * 0.9, vv[0].y * 0.9, vv[0].z * 0.9, salt & 63);
          // sun-bleached tops, lichen patches on the up faces, soil stain low
          let c = baseT.slice();
          const bleach = clamp01(up) * 0.35;
          c = [c[0] * (1 + bleach), c[1] * (1 + bleach), c[2] * (1 + bleach * 0.8)];
          if (up > 0.35 && lichen > 0.62) { const L = (lichen - 0.62) * 2.2; c = [c[0] * (1 - L * 0.2) + 0.03 * L, c[1] + 0.045 * L, c[2] * (1 - L * 0.3)]; }
          emitTri(A.rock, vv, nn, c, { ao: gyl, aoK: 0.45, aoH: Math.max(0.35, sy * 0.5) });
        }
      }
      rockSites.forEach(function (s, i) {
        const gy = gh(s.x, s.z);
        const salt = (i * 7919 + 17) & 0xffff;
        const sx = s.s * 0.5 * s.kx, sy = s.s * 0.5 * s.ky, sz = s.s * 0.5 * s.kz;
        rock(s.x, gy + sy * 0.3, s.z, sx, sy, sz, s.yaw, s.tilt, salt, false);
        const c = addCol(s.x - Math.max(sx, sz) * 0.8, s.x + Math.max(sx, sz) * 0.8, s.z - Math.max(sx, sz) * 0.8, s.z + Math.max(sx, sz) * 0.8, gy - 0.2, gy + sy * 1.2, "rock");
        out.rocks.push({ x: s.x, z: s.z, r: Math.max(sx, sz), collider: c });
        // one or two fallen pieces beside the big one
        const n = (ih(salt, 1, 7) * 3) | 0;
        for (let k = 0; k < n; k++) {
          const a = ih(salt, k, 8) * Math.PI * 2, dd = Math.max(sx, sz) * (1.05 + 0.35 * ih(salt, k, 9));
          const px = s.x + Math.cos(a) * dd, pz = s.z + Math.sin(a) * dd;
          if (inStreet(px, pz, 0.3) || isWalk(px, pz)) continue;
          const k2 = 0.22 + 0.2 * ih(salt, k, 10);
          const g2 = gh(px, pz);
          rock(px, g2 + sy * k2 * 0.25, pz, sx * k2, sy * k2 * 0.8, sz * k2, a, 0.2, salt + 101 * (k + 1), true);
        }
      });
    })();

    /* ==================================================================
       MESHES: one per material
       ================================================================== */
    const mapMean = CBZ.surfaceMapMean || function () { return [1, 1, 1]; };
    function lam(surface, extra) {
      const m = new THREE.MeshLambertMaterial(Object.assign({ color: 0xffffff, vertexColors: true }, extra || {}));
      const maps = surface && CBZ.surfaceMaps ? CBZ.surfaceMaps(surface, { repeat: 1 }) : null;
      if (maps && maps.map) {
        m.map = maps.map;
        const mn = mapMean(maps.map);
        m.color.setRGB(1 / Math.max(0.02, mn[0]), 1 / Math.max(0.02, mn[1]), 1 / Math.max(0.02, mn[2]));
      }
      return m;
    }
    function std(surface) {
      const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.92, metalness: 0, envMap: CBZ.ENV || null });
      if (CBZ.surfaceApply) CBZ.surfaceApply(m, surface, { repeat: 1 });
      if (m.map) {
        const mn = mapMean(m.map);
        m.color.setRGB(1 / Math.max(0.02, mn[0]), 1 / Math.max(0.02, mn[1]), 1 / Math.max(0.02, mn[2]));
      }
      return m;
    }
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    lensMat.color.setRGB(0.32, 0.31, 0.28);
    const MATS = {
      wood: lam("wood"), mason: lam("concrete"), plant: lam("grass"), paint: lam("metal"),
      asph: lam("asphalt"), soil: lam("dirt"), rock: std("rock"), lens: lensMat,
    };
    const sharedRef = {};
    Object.keys(A).forEach(function (k) {
      const a = A[k];
      if (!a.p.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(a.p, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(a.n, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(a.c, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(a.uv, 2));
      g.computeBoundingSphere();
      const mat = MATS[k];
      mat.name = "island-dressing-" + a.name;
      const m = new THREE.Mesh(g, mat);
      m.name = "island-dressing-" + a.name;
      m.userData.dynamic = true;                  // own maps: never batch-merged
      m.matrixAutoUpdate = false; m.updateMatrix();
      m.castShadow = k !== "asph" && k !== "soil" && k !== "lens";
      m.receiveShadow = k !== "lens";
      ctx.root.add(m);
      out.meshes[k] = m;
      sharedRef[k] = m;
      out.draws++;
      out.stats[k] = a.count();
    });
    // colliders point at the mesh they belong to (physics asks .ref.visible)
    for (const c of out.colliders) {
      const k = c.dressing === "rock" ? "rock" : c.dressing === "fence" ? null : c.dressing === "bale" ? "plant" : c.dressing === "barn" ? "wood" : "paint";
      c.ref = (k && sharedRef[k]) || null;
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();

    // lantern lenses brighten with the dark, like the street lights
    if (out.meshes.lens && CBZ.onUpdate) {
      let lastK = -1;
      CBZ.onUpdate(48.4, function () {
        if (!(CBZ.game && CBZ.islandModeOn && CBZ.islandModeOn(CBZ.game.mode))) return;
        const n = CBZ.lightsOnAmount ? CBZ.lightsOnAmount() : (CBZ.nightAmount || 0);
        const k = clamp01((n - 0.3) / 0.4);
        if (Math.abs(k - lastK) < 0.003) return;
        lastK = k;
        lensMat.color.setRGB(0.32 + 0.8 * k, 0.31 + 0.6 * k, 0.28 + 0.3 * k);
      });
    }
    out.stats.yards = nYards;
    out.stats.verts = Object.keys(A).reduce(function (s, k) { return s + A[k].count(); }, 0);
    api.current = out;
    return out;
  }

  const api = CBZ.islandDressing = { build: build, current: null };
})();
