/* ============================================================
   city/metro_ground.js — EVERYTHING ON THE GROUND OF A METRO, AND THE FLOOR.

   WHY: city/metroplan.js plans a metro kilometres across (Kingsport: ~390
   streets, 318 grid blocks, ~50 superblock pads, a river with 17 bridges, a
   rail line, 9 freeway overpasses, 3 diamond interchanges). The downtown's
   street kit (city/streetkit.js) solves ONE rectangular grid; a metro is
   many grids, curving suburbs, decks and rails. This file renders all of
   it with the street kit's own look — the SAME asphalt program, footway,
   granite kerb and paint materials (CBZ.streetKit.look / sharedAsphalt), so
   a metro street up close is a downtown street — and it owns the physics
   floor under all of it.

   WHAT (one cross-section, the street kit's): carriageway top 0.05, kerb
   face 13 cm to the footway at 0.18, lot ground 0.16.
     • straight streets: strips between junctions, one junction piece per
       crossing built in rays from the kerb (rings at 0 / 0.45 / 0.9 m) so the
       asphalt shader's gutter pan follows the rounded kerb returns exactly;
       nothing overlaps, so nothing z-fights
     • grid blocks: rounded corners, granite kerb with a real face, scored
       footway, lot ground by use (plaza pavers, paving, courtyard lawn, yard
       asphalt), parking with stall lines
     • superblock pads: kerb + 3 m footway ring, lawn, the curving
       collectors / loops / cul-de-sacs as ribbons with rolled kerbs, bulbs,
       collector sidewalks, T-junction mouths, dropped ramps where a street
       meets an arterial, driveway aprons to every house, parks with paths,
       sound walls (behind the footway, gapped at every street)
     • bridges, overpass decks + retained approach ramps (the integrator's
       CBZ.roadDeckY profile: flat 7.6 over the freeway, linear 90 m ramps),
       diamond slip ramps, rail (ballast, instanced sleepers, rails, level
       crossings, embankments + a viaduct over the freeway, a Warren truss
       over the river, station platforms), fields, a ballfield, lamps
       (instanced, heads glow with CBZ.nightAmount, no real lights)

   THE FLOOR: heightAt(x,z) is a bucket grid (32 m) of prioritised items —
   ELEV (approach ramps, slip ramps, rail embankments) > EXCL (freeway
   corridors, compounds: null so the highway owns its floor) > PAD > BLOCK >
   STREET > BRIDGE WALK > RAIL > FIELD. It answers ONE height, so anything
   with something UNDER it is not in it: the overpass deck and the rail
   viaduct are CBZ.platforms records (STEP_UP gated: freeway cars below are
   never lifted) and the overpass decks are also ONE static CBZ.movingPlatform
   rig (the layered surface the driven car reads, like interchange.js).

   PERF: everything is written straight into typed arrays (Float32 position,
   Int8 normal, Uint8 colour / surface kind), indexed, one mesh per 800 m
   tile per material; lamps and sleepers instanced. No Math.random: every
   choice is plan data or a position hash.

   API
     CBZ.metroGround.solve(P)            pure: {heightAt, kindAt, platforms,
                                          colliders, decks, stats}
     CBZ.metroGround.prepare(P, opts)    {tiles:[{key,x0,z0,x1,z1,meshes,built}]}
     CBZ.metroGround.buildTile(P, tile)  -> {stats}
     CBZ.metroGround.disposeTile(P, tile)
     CBZ.metroGround.build(P, opts)      solve + prepare + every tile
     CBZ.metroGround.tileArrays(P, key)  pure typed arrays of one tile (node)
============================================================ */
(function (G) {
  "use strict";
  const CBZ = G.CBZ || null;

  // ---- THE CROSS-SECTION (metres). streetkit.js table P + what a metro adds.
  const Y = {
    road: 0.05, walk: 0.18, lot: 0.16, lawn: 0.16, padRoad: 0.18, side: 0.172, drive: 0.176, path: 0.172,
    field: 0.04, bed: 0.12, plat: 1.10, deck: 7.6, deckDepth: 1.65, fw: 0.085, soffitClear: 5.95,
  };
  const KT = 0.30;          // granite kerb top band
  const KB = 0.02;          // kerb face foot (just under the carriageway)
  const GUT = 0.45;         // gutter pan (the asphalt shader draws it from `e`)
  const ROLL = 0.6;         // rolled (mountable) kerb on the suburban ribbons
  const PAD_SW = 3.3;       // kerb top + 3 m footway round a superblock pad
  const PAD_R = 6;          // pad corner radius at an arterial junction
  const RJ = 6;             // junction leg stub: the kerb returns live inside it
  const PAR_H = 1.07, PAR_W = 0.4;
  const RAMP_LEN = 90;      // == metro.js roadRecords ramp / CBZ.roadDeckY
  const CORR_PAD = 10;      // freeway corridor exclusion = half + 10 (blocks keep the same clearance)
  const BANK = 14;          // land stops this far outside the river's half width (the continent carves the bank)
  const CELL = 32;          // floor bucket
  const RAIL = { sp: 4.5, gauge: 1.435, bedHalf: 4.6, toe: 6.2, wall: 4.9, sleeperH: 0.16, top: 0.31, step: 0.62 };
  const ALPHA = [0, 15, 30, 45, 60, 75, 90].map(function (d) { return d * Math.PI / 180; });
  const RINGS = [0, GUT, 0.9];

  // surface kinds (the `gk` attribute the ground shader reads)
  const GK = { lawn: 0, paving: 1, dirt: 2, crop: 3, ballast: 4, concrete: 5, metal: 6, lens: 7, soundwall: 8, rubber: 9 };
  // floor kinds (kindAt)
  const FK = { none: 0, road: 1, walk: 2, lot: 3, lawn: 4, padRoad: 5, elev: 6, rail: 7, field: 8, excl: 9 };

  // colours: stored as sqrt(linear) (the ground shader squares them back)
  function sq(c) { return [Math.sqrt(c[0]), Math.sqrt(c[1]), Math.sqrt(c[2])]; }
  const COL = {
    // TURF, NOT LIME. The old lawn (0.075, 0.135, 0.032) had g/b 4.2 and
    // g/r 1.8: after the grade's +14% saturation the whole metro read neon
    // from the air (owner's flyover). Measured summer turf sits near g/r 1.4-1.5,
    // g/b 2.5-3 at the same ~0.11 luminance, the same family as the country
    // meadow round the city (continent plate ~0.10/0.135/0.058). Mown
    // lawn, the lusher irrigated park, and the yards' drier grass.
    lawn: sq([0.086, 0.125, 0.047]), lawnPark: sq([0.076, 0.126, 0.042]), lawnDry: sq([0.112, 0.118, 0.056]),
    paving: sq([0.20, 0.195, 0.18]), concrete: sq([0.24, 0.232, 0.215]), concreteDark: sq([0.17, 0.165, 0.155]),
    ballast: sq([0.15, 0.14, 0.125]), gravel: sq([0.17, 0.15, 0.115]), dirt: sq([0.26, 0.135, 0.065]),
    metal: sq([0.045, 0.05, 0.055]), steel: sq([0.12, 0.10, 0.085]), railTop: sq([0.34, 0.34, 0.35]),
    truss: sq([0.075, 0.10, 0.095]), sleeper: sq([0.19, 0.18, 0.17]), rubber: sq([0.045, 0.045, 0.045]),
    lens: sq([0.45, 0.43, 0.38]), soundwall: sq([0.28, 0.25, 0.20]), mound: sq([0.28, 0.15, 0.075]),
    crops: [sq([0.30, 0.235, 0.09]), sq([0.075, 0.12, 0.04]), sq([0.055, 0.095, 0.035]), sq([0.15, 0.095, 0.055])],
  };
  const YELLOW = [1.0, 0.656, 0.083], WHITE = [1, 1, 1];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hsh(x, z, salt) {
    let h = (Math.round(x * 8) * 374761393 + Math.round(z * 8) * 668265263 + (salt | 0) * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function now() { return (G.performance && G.performance.now) ? G.performance.now() : Date.now(); }
  function segDist(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t - px, qz = az + dz * t - pz;
    return Math.sqrt(qx * qx + qz * qz);
  }
  // world point of a straight street at (along a, lateral u)
  function SP(s, a, u) { return s.axis === "x" ? [s.at + u, a] : [a, s.at + u]; }

  /* ==================================================================
     THE SOLVE — pure data. Cached per plan.
     ================================================================== */
  const CACHE = typeof WeakMap !== "undefined" ? new WeakMap() : null;

  function solve(P) {
    if (CACHE && CACHE.has(P)) return CACHE.get(P);
    const T0 = now();
    const S = {
      P: P, streets: [], byId: new Map(), nodes: [], nodeMap: new Map(), blocks: [], pads: [], padByCell: new Map(),
      ovps: [], slips: [], bridges: [], rails: [], stations: [], fields: P.fields || [], walls: [], parks: [], lots: [],
      drives: [], lamps: [], excl: [], items: [], platforms: [], colliders: [], decks: [], pieces: [], tile: 800,
    };
    const river = P.river || null;
    const riverDist = P.riverDist || function () { return 1e9; };
    function wet(x, z, pad) { return river ? riverDist(x, z) < river.half + pad : false; }

    // ---------------- exclusions: freeway corridors + compounds ----------------
    for (const c of P.corridors || []) {
      const ax = c.ax || (c.axis === "z" ? "x" : "z");
      const hw = c.half + CORR_PAD;
      const r = ax === "x" ? { minX: c.at - hw, maxX: c.at + hw, minZ: c.a0 - c.half, maxZ: c.a1 + c.half }
                           : { minX: c.a0 - c.half, maxX: c.a1 + c.half, minZ: c.at - hw, maxZ: c.at + hw };
      r.kind = "fw"; r.c = c; r.ax = ax; S.excl.push(r);
    }
    for (const o of P.obstacles || []) S.excl.push({ minX: o.minX, maxX: o.maxX, minZ: o.minZ, maxZ: o.maxZ, kind: "obs" });
    function inExcl(x, z) {
      for (let i = 0; i < S.excl.length; i++) { const r = S.excl[i]; if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r; }
      return null;
    }
    const rail0 = (P.rail && P.rail[0]) || null;
    function inRailBand(x, z, pad) {
      for (const r of P.rail || []) {
        const lat = r.axis === "x" ? z - r.at : x - r.at, a = r.axis === "x" ? x : z;
        if (Math.abs(lat) < r.half + (pad || 0) && a > r.a0 && a < r.a1) return r;
      }
      return null;
    }
    S.inExcl = inExcl; S.inRailBand = inRailBand;

    // ---------------- straight streets ----------------
    for (const s of P.streets) {
      if (!s.axis || s.pts.length !== 2) continue;
      const r = { id: s.id, k: s.k, w: s.w, h: s.w / 2, axis: s.axis, at: s.at, a0: Math.min(s.a0, s.a1), a1: Math.max(s.a0, s.a1),
        lanes: s.lanes || 1, ovs: [], nodes: [], src: s };
      S.streets.push(r); S.byId.set(s.id, r);
    }
    function streetY(s, a) {
      let y = Y.road;
      for (let i = 0; i < s.ovs.length; i++) {
        const o = s.ovs[i];
        if (a <= o.lo || a >= o.hi) continue;
        const d = Math.min(a - o.lo, o.hi - a);
        const t = Y.deck * Math.min(1, d / RAMP_LEN);
        if (t > y) y = t;
      }
      return y;
    }
    S.streetY = streetY;

    // ---------------- junction nodes (grouped: two locals ending on one arterial = one node) ----
    for (const j of P.junctions || []) {
      const v = S.byId.get(j.a), h = S.byId.get(j.b);
      if (!v || !h) continue;
      const key = Math.round(j.x * 10) + "|" + Math.round(j.z * 10);
      let n = S.nodeMap.get(key);
      if (!n) {
        n = { x: j.x, z: j.z, hA: 0, hB: 0, hN: 0, hS: 0, hE: 0, hW: 0, vs: [], hs: [], legN: false, legS: false, legE: false, legW: false, art: false,
          skip: false, q: [0, 0, 0, 0], qRect: [null, null, null, null], id: S.nodes.length };
        S.nodeMap.set(key, n); S.nodes.push(n);
      }
      if (n.vs.indexOf(v) < 0) {
        n.vs.push(v); n.hA = Math.max(n.hA, v.h);
        if (v.a1 > j.z + 0.5) { n.legN = true; n.hN = Math.max(n.hN, v.h); }
        if (v.a0 < j.z - 0.5) { n.legS = true; n.hS = Math.max(n.hS, v.h); }
      }
      if (n.hs.indexOf(h) < 0) {
        n.hs.push(h); n.hB = Math.max(n.hB, h.h);
        if (h.a1 > j.x + 0.5) { n.legE = true; n.hE = Math.max(n.hE, h.h); }
        if (h.a0 < j.x - 0.5) { n.legW = true; n.hW = Math.max(n.hW, h.h); }
      }
      if (v.k === "art" || h.k === "art") n.art = true;
    }
    // the half widths a quadrant (sx, sz) of a node sees: the vertical street
    // on its sz side, the horizontal one on its sx side (a rural road ending
    // under an arterial keeps its own width)
    function qHalf(n, sx, sz) {
      const hA = sz > 0 ? (n.legN ? n.hN : n.hA) : (n.legS ? n.hS : n.hA);
      const hB = sx > 0 ? (n.legE ? n.hE : n.hB) : (n.legW ? n.hW : n.hB);
      return [hA, hB];
    }
    S.qHalf = qHalf;
    for (const n of S.nodes) {
      for (const v of n.vs) v.nodes.push({ pos: n.z, hc: n.hB, n: n });
      for (const h of n.hs) h.nodes.push({ pos: n.x, hc: n.hA, n: n });
      const lv = P.landValue ? P.landValue(n.x, n.z) : 0;
      n.cross = n.art || lv > 0.55;          // crosswalks: every arterial junction, and downtown's locals
      n.stops = n.cross;
    }
    for (const s of S.streets) s.nodes.sort(function (a, b) { return a.pos - b.pos; });

    // ---------------- overpasses: the elevated piece (metro.js / CBZ.roadDeckY) ----------
    for (const o of P.overpasses || []) {
      const s = S.byId.get(o.street);
      if (!s) continue;
      let c = null;
      for (const cc of P.corridors || []) if (cc.name === o.over && Math.abs(cc.at - o.fwAt) < 0.5) c = cc;
      const ov = { s: s, o: o, b0: o.a0, b1: o.a1, lo: Math.max(s.a0, o.a0 - RAMP_LEN), hi: Math.min(s.a1, o.a1 + RAMP_LEN),
        fwAt: o.fwAt, half: c ? c.half : 15.3, slipGaps: [] };
      s.ovs.push(ov); S.ovps.push(ov);
      // a junction ON the ramp cannot be at grade: the crossing street dead-ends
      // at the retaining wall (reported to the integrator)
      for (const nn of s.nodes) if (nn.pos > ov.lo - nn.hc && nn.pos < ov.hi + nn.hc) nn.n.skip = true;
    }

    // ---------------- blocks + pads: rects with per-corner radii ----------------
    const cornerIdx = new Map();
    function ckey(x, z) { return Math.round(x * 10) + "|" + Math.round(z * 10); }
    function addCorners(rec) {
      const cs = [[rec.x0, rec.z0], [rec.x1, rec.z0], [rec.x1, rec.z1], [rec.x0, rec.z1]];
      for (let q = 0; q < 4; q++) {
        const k = ckey(cs[q][0], cs[q][1]);
        let l = cornerIdx.get(k); if (!l) cornerIdx.set(k, l = []);
        l.push({ rec: rec, q: q });
      }
    }
    const plazas = P.plazas || [];
    const parking = P.parking || [];
    for (const b of P.blocks || []) {
      const rec = { t: "block", x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, sw: b.sw, r: b.r, use: b.use, cr: [0, 0, 0, 0], plaza: false, lotAll: false, src: b };
      const ix0 = b.x0 + b.sw, ix1 = b.x1 - b.sw, iz0 = b.z0 + b.sw, iz1 = b.z1 - b.sw;
      for (const pz of plazas) if (pz.x0 < ix1 && pz.x1 > ix0 && pz.z0 < iz1 && pz.z1 > iz0) rec.plaza = true;
      for (const pk of parking) {
        if (pk.x0 >= ix0 - 1 && pk.x1 <= ix1 + 1 && pk.z0 >= iz0 - 1 && pk.z1 <= iz1 + 1) {
          const ar = (pk.x1 - pk.x0) * (pk.z1 - pk.z0), ia = (ix1 - ix0) * (iz1 - iz0);
          if (pk.kind === "lot" && ar > ia * 0.8) { rec.lotAll = true; pk.inBlock = rec; pk.fills = true; }
          else pk.inBlock = rec;
        }
      }
      S.blocks.push(rec); addCorners(rec);
    }
    for (const p of P.pads || []) {
      const rec = { t: "pad", x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1, sw: PAD_SW, r: PAD_R, use: p.use, cell: p.cell, cr: [0, 0, 0, 0],
        ribs: [], bulbs: [], mouths: [], cut: false, segGrid: new Map(), src: p };
      S.pads.push(rec); S.padByCell.set(p.cell, rec); addCorners(rec);
    }
    // radii from the nodes: a corner is rounded only where both of its streets exist
    for (const n of S.nodes) {
      if (n.skip) continue;
      const Q = [[1, 1, 0], [-1, 1, 1], [-1, -1, 2], [1, -1, 3]];     // (sx, sz, rect corner index)
      for (let qi = 0; qi < 4; qi++) {
        const sx = Q[qi][0], sz = Q[qi][1];
        const legX = sx > 0 ? n.legE : n.legW, legZ = sz > 0 ? n.legN : n.legS;
        n.q[qi] = legX && legZ ? 0 : -1;
        if (!(legX && legZ)) continue;
        const qh = qHalf(n, sx, sz);
        const l = cornerIdx.get(ckey(n.x + sx * qh[0], n.z + sz * qh[1]));
        if (!l) continue;
        for (const e of l) if (e.q === Q[qi][2]) {
          e.rec.cr[e.q] = e.rec.r; n.q[qi] = e.rec.r; n.qRect[qi] = e.rec;
        }
      }
    }

    // ---------------- pads: ribbons, bulbs, mouths ----------------
    const ribsByCell = new Map();
    for (const s of P.streets) {
      if (s.axis || !s.cell) continue;
      let l = ribsByCell.get(s.cell); if (!l) ribsByCell.set(s.cell, l = []);
      l.push(s);
    }
    let _padNearRiver = false;
    for (const pad of S.pads) solvePad(pad, ribsByCell.get(pad.cell) || []);

    function ribExcluded(x, z) { return !!inExcl(x, z) || (_padNearRiver && wet(x, z, BANK)); }
    function solvePad(pad, srcs) {
      const R = { x0: pad.x0, x1: pad.x1, z0: pad.z0, z1: pad.z1 };
      _padNearRiver = !!river && riverDist((pad.x0 + pad.x1) / 2, (pad.z0 + pad.z1) / 2) < Math.hypot(pad.x1 - pad.x0, pad.z1 - pad.z0) / 2 + river.half + 40;
      // cut flag: something the lawn must not cover runs through the pad
      for (const r of S.excl) if (r.minX < pad.x1 && r.maxX > pad.x0 && r.minZ < pad.z1 && r.maxZ > pad.z0) pad.cut = true;
      for (const r of P.rail || []) {
        if (r.axis === "x" ? (r.at + r.half > pad.z0 && r.at - r.half < pad.z1) : (r.at + r.half > pad.x0 && r.at - r.half < pad.x1)) { pad.cut = true; pad.rail = r; }
      }
      if (_padNearRiver) {
        for (let x = pad.x0; x <= pad.x1 + 0.1; x += 20) for (let z = pad.z0; z <= pad.z1 + 0.1; z += 20) if (wet(x, z, 20)) { pad.cut = true; pad.wet = true; }
      }
      // polylines
      const ribs = [];
      for (const s of srcs) {
        let pts = s.pts.map(function (p) { return { x: p.x, z: p.z }; });
        if (s.closed && pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) < 0.01) pts.pop();
        pts = subdivide(pts, 7);
        ribs.push({ k: s.k, w: s.w, h: s.w / 2, closed: !!s.closed, pts: pts, src: s, bulb: s.bulb || null, gaps: [], ends: [null, null], s: null });
      }
      for (const r of ribs) r.s = arcLen(r.pts);
      // mouths: clip open ribbons to the pad rect
      for (const r of ribs) {
        if (r.closed) continue;
        clipEnds(r, R);
      }
      // T-junctions (an end inside another ribbon) and bulbs
      const orig = ribs.map(function (r) { return { a: r.pts[0], b: r.pts[r.pts.length - 1] }; });
      for (let i = 0; i < ribs.length; i++) {
        const r = ribs[i];
        if (r.closed || r.dead) continue;
        for (let e = 0; e < 2; e++) {
          if (r.ends[e]) continue;                     // a mouth
          const p = e === 0 ? orig[i].a : orig[i].b;
          if (e === 1 && r.bulb) { trimToCircle(r, r.bulb, e); continue; }
          let host = null, hd = 1e9, hq = null;
          for (let j = 0; j < ribs.length; j++) {
            if (j === i || ribs[j].dead) continue;
            const bb = bbOf(ribs[j]), m = ribs[j].h + 1;
            if (p.x < bb[0] - m || p.x > bb[1] + m || p.z < bb[2] - m || p.z > bb[3] + m) continue;
            const q = polyNearest(ribs[j], p.x, p.z);
            if (q.d < ribs[j].h + 1.0 && q.d < hd) { hd = q.d; host = ribs[j]; hq = q; }
          }
          if (!host) continue;
          if (!trimOutOf(r, host, e)) { r.dead = true; break; }
          const g = r.h + ROLL + 0.4;
          host.gaps.push({ s0: hq.s - g, s1: hq.s + g, side: hq.side, all: false });
          r.ends[e] = { t: "tee", host: host };
        }
      }
      // X crossings: the narrower street is split and tees into the wider one twice
      for (let i = 0; i < ribs.length; i++) for (let j = 0; j < ribs.length; j++) {
        if (i === j) continue;
        const A = ribs[i], H = ribs[j];
        if (A.dead || H.dead || A.closed || A.w > H.w || (A.w === H.w && i < j)) continue;
        const ba = bbOf(A), bh = bbOf(H);
        if (ba[1] < bh[0] || ba[0] > bh[1] || ba[3] < bh[2] || ba[2] > bh[3]) continue;
        const X = polyCross(A, H);
        if (!X) continue;
        const B = splitAt(A, X.sa);
        if (!B) continue;
        ribs.push(B);
        const g = A.h + ROLL + 0.4;
        H.gaps.push({ s0: X.sh - g, s1: X.sh + g, side: 0, all: true });
        trimOutOf(A, H, 1); A.ends[1] = { t: "tee", host: H };
        trimOutOf(B, H, 0); B.ends[0] = { t: "tee", host: H };
      }
      // bulbs: window where the cul-de-sac enters
      for (const r of ribs) {
        if (r.dead || !r.bulb) continue;
        const b = r.bulb;
        if (wet(b.x, b.z, BANK) || inExcl(b.x, b.z)) continue;
        const e = r.pts[r.pts.length - 1];
        pad.bulbs.push({ x: b.x, z: b.z, r: b.r, th: Math.atan2(e.z - b.z, e.x - b.x), ph: Math.asin(clamp(r.h / b.r, 0, 0.99)), h: r.h });
      }
      // runs: split on exclusions (river, corridor, compound)
      for (const r of ribs) {
        if (r.dead) continue;
        r.s = arcLen(r.pts);
        // clean rail crossings (near-square to the line): the only place a pad
        // street may be inside the rail band
        const rx = [];
        for (const rl of P.rail || []) for (let k = 0; k < r.pts.length - 1; k++) {
          const a = r.pts[k], b = r.pts[k + 1];
          const la = rl.axis === "x" ? a.z - rl.at : a.x - rl.at, lb = rl.axis === "x" ? b.z - rl.at : b.x - rl.at;
          if (la * lb > 0 || la === lb) continue;
          const tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1;
          if (Math.abs(rl.axis === "x" ? tx : tz) / L > 0.5) continue;
          rx.push(r.s[k] + L * la / (la - lb));
        }
        const runs = [];
        let cur = null;
        for (let k = 0; k < r.pts.length; k++) {
          const p = r.pts[k];
          let bad = ribExcluded(p.x, p.z);
          if (!bad && inRailBand(p.x, p.z, r.h + 1)) {
            let near = false;
            for (const c of rx) if (Math.abs(r.s[k] - c) < rail0.half + r.h + 6) near = true;
            if (!near) bad = true;
          }
          if (bad) { if (cur && cur.length > 1) runs.push(cur); cur = null; continue; }
          if (!cur) cur = [];
          cur.push(k);
        }
        if (cur && cur.length > 1) runs.push(cur);
        const whole = runs.length === 1 && runs[0].length === r.pts.length;
        for (const run of runs) {
          const pts = run.map(function (k) { return r.pts[k]; });
          const ss = run.map(function (k) { return r.s[k]; });
          const rr = { k: r.k, w: r.w, h: r.h, pts: pts, s: ss, closed: r.closed && whole, gaps: r.gaps,
            ends: [run[0] === 0 ? r.ends[0] : null, run[run.length - 1] === r.pts.length - 1 ? r.ends[1] : null], pad: pad };
          pad.ribs.push(rr);
        }
      }
      // mouths -> ring gaps (the ribbon ramps down over the kerb there)
      for (const r of pad.ribs) for (let e = 0; e < 2; e++) {
        const m = r.ends[e];
        if (!m || m.t !== "mouth") continue;
        pad.mouths.push({ edge: m.edge, c: m.c, g: r.h + ROLL, rib: r });
        insertAtEdge(r, e, pad, PAD_SW);          // the ramp's kink: over the kerb, then flat
      }
      // segment grid for the floor (16 m)
      for (const r of pad.ribs) {
        const n = r.pts.length;
        for (let k = 0; k < n - 1; k++) addSeg(pad, r, r.pts[k], r.pts[k + 1]);
        if (r.closed) addSeg(pad, r, r.pts[n - 1], r.pts[0]);
      }
      for (const b of pad.bulbs) {
        const rr = b.r + ROLL;
        for (let ix = Math.floor((b.x - rr) / 16); ix <= Math.floor((b.x + rr) / 16); ix++)
          for (let iz = Math.floor((b.z - rr) / 16); iz <= Math.floor((b.z + rr) / 16); iz++) {
            const k = ix * 65536 + iz; let l = pad.segGrid.get(k); if (!l) pad.segGrid.set(k, l = []);
            l.push({ c: true, x: b.x, z: b.z, r: rr });
          }
      }
    }
    function insertAtEdge(r, e, pad, dist) {
      // a station where the centreline is exactly `dist` inside the pad edge,
      // walking in from end e (the ramp bends exactly there)
      const n = r.pts.length;
      const ge = function (p) { return Math.min(p.x - pad.x0, pad.x1 - p.x, p.z - pad.z0, pad.z1 - p.z); };
      for (let k = 0; k < n - 1; k++) {
        const i = e === 0 ? k : n - 1 - k, j = e === 0 ? k + 1 : n - 2 - k;
        const a = r.pts[i], b = r.pts[j], ga = ge(a), gb = ge(b);
        if (ga < dist && gb >= dist) {
          if (gb - dist < 0.05) return;
          const t = (dist - ga) / Math.max(1e-6, gb - ga);
          const np = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
          const sv = r.s[i] + (r.s[j] - r.s[i]) * t;
          const at = Math.max(i, j);
          r.pts.splice(at, 0, np); r.s.splice(at, 0, sv);
          return;
        }
      }
    }
    function bbOf(r) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const q of r.pts) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.z < z0) z0 = q.z; if (q.z > z1) z1 = q.z; }
      return [x0, x1, z0, z1];
    }
    function addSeg(pad, r, a, b) {
      const hw = r.h + ROLL;
      const sg = { ax: a.x, az: a.z, bx: b.x, bz: b.z, hw: hw, rib: r };
      for (let ix = Math.floor((Math.min(a.x, b.x) - hw) / 16); ix <= Math.floor((Math.max(a.x, b.x) + hw) / 16); ix++)
        for (let iz = Math.floor((Math.min(a.z, b.z) - hw) / 16); iz <= Math.floor((Math.max(a.z, b.z) + hw) / 16); iz++) {
          const k = ix * 65536 + iz; let l = pad.segGrid.get(k); if (!l) pad.segGrid.set(k, l = []);
          l.push(sg);
        }
    }
    function subdivide(pts, maxL) {
      const out = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L < 0.05) continue;
        const n = Math.max(1, Math.ceil(L / maxL));
        for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
      }
      return out;
    }
    function arcLen(pts) {
      const s = [0];
      for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
      return s;
    }
    function insideR(R, p) { return p.x > R.x0 + 0.01 && p.x < R.x1 - 0.01 && p.z > R.z0 + 0.01 && p.z < R.z1 - 0.01; }
    function edgeHit(R, a, b) {
      // the boundary crossing on a->b (a outside, b inside): param + edge
      let best = null;
      const cand = [["x0", R.x0], ["x1", R.x1], ["z0", R.z0], ["z1", R.z1]];
      for (const c of cand) {
        const isX = c[0][0] === "x";
        const da = (isX ? a.x : a.z) - c[1], db = (isX ? b.x : b.z) - c[1];
        if (da === db || da * db > 0) continue;
        const t = da / (da - db);
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        if (x < R.x0 - 0.01 || x > R.x1 + 0.01 || z < R.z0 - 0.01 || z > R.z1 + 0.01) continue;
        if (!best || t > best.t) best = { t: t, x: x, z: z, edge: c[0], c: isX ? z : x };
      }
      return best;
    }
    function clipEnds(r, R) {
      const pts = r.pts;
      if (!insideR(R, pts[0])) {
        let i = 0; while (i < pts.length && !insideR(R, pts[i])) i++;
        if (i >= pts.length) { r.dead = true; return; }
        const h = edgeHit(R, pts[i - 1], pts[i]);
        if (h) { r.pts = [{ x: h.x, z: h.z }].concat(pts.slice(i)); r.ends[0] = { t: "mouth", edge: h.edge, c: h.c }; }
        else r.pts = pts.slice(i);
      }
      const p2 = r.pts;
      if (!insideR(R, p2[p2.length - 1])) {
        let i = p2.length - 1; while (i >= 0 && !insideR(R, p2[i])) i--;
        if (i < 0) { r.dead = true; return; }
        const h = edgeHit(R, p2[i + 1], p2[i]);
        if (h) { r.pts = p2.slice(0, i + 1).concat([{ x: h.x, z: h.z }]); r.ends[1] = { t: "mouth", edge: h.edge, c: h.c }; }
        else r.pts = p2.slice(0, i + 1);
      }
      if (r.pts.length < 2) r.dead = true;
      r.s = arcLen(r.pts);
    }
    function polyNearest(r, x, z) {
      const pts = r.pts, n = pts.length;
      let bd = 1e9, bs = 0, side = 1;
      const segs = r.closed ? n : n - 1;
      const s = r.s || arcLen(pts);
      for (let i = 0; i < segs; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
        if (L2 < 1e-9) continue;
        let t = ((x - a.x) * dx + (z - a.z) * dz) / L2; t = clamp(t, 0, 1);
        const qx = a.x + dx * t, qz = a.z + dz * t, d = Math.hypot(x - qx, z - qz);
        if (d < bd) { bd = d; bs = s[i] + Math.sqrt(L2) * t; side = ((x - qx) * -dz + (z - qz) * dx) >= 0 ? 1 : -1; }
      }
      return { d: bd, s: bs, side: side };
    }
    function trimOutOf(r, host, e) {
      // drop the part of r's end e that lies inside host's carriageway
      const pts = e === 0 ? r.pts.slice().reverse() : r.pts.slice();
      let i = pts.length - 1;
      const dAt = function (p) { return polyNearest(host, p.x, p.z).d; };
      let dNext = dAt(pts[i]);
      if (dNext >= host.h) return true;
      while (i > 0) {
        const di = dAt(pts[i - 1]);
        if (di >= host.h) {
          const t = (di - host.h) / Math.max(1e-6, di - dNext);
          const a = pts[i - 1], b = pts[i];
          const np = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
          const out = pts.slice(0, i).concat([np]);
          r.pts = e === 0 ? out.reverse() : out;
          r.s = arcLen(r.pts);
          return r.pts.length >= 2;
        }
        dNext = di; i--;
      }
      return false;
    }
    function trimToCircle(r, b, e) {
      const lim = Math.sqrt(Math.max(1, b.r * b.r - r.h * r.h));
      const pts = r.pts.slice();
      let i = pts.length - 1;
      const dAt = function (p) { return Math.hypot(p.x - b.x, p.z - b.z); };
      let dn = dAt(pts[i]);
      if (dn >= lim) { r.ends[1] = { t: "bulb" }; return; }
      while (i > 0) {
        const di = dAt(pts[i - 1]);
        if (di >= lim) {
          const t = (di - lim) / Math.max(1e-6, di - dn);
          const a = pts[i - 1], c = pts[i];
          r.pts = pts.slice(0, i).concat([{ x: a.x + (c.x - a.x) * t, z: a.z + (c.z - a.z) * t }]);
          r.s = arcLen(r.pts); r.ends[1] = { t: "bulb" };
          return;
        }
        dn = di; i--;
      }
    }
    function polyCross(A, H) {
      const pa = A.pts, ph = H.pts, sa = arcLen(pa), sh = arcLen(ph);
      const nh = H.closed ? ph.length : ph.length - 1;
      for (let i = 0; i < pa.length - 1; i++) {
        const a = pa[i], b = pa[i + 1];
        for (let j = 0; j < nh; j++) {
          const c = ph[j], d = ph[(j + 1) % ph.length];
          const den = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x);
          if (Math.abs(den) < 1e-9) continue;
          const t = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / den;
          const u = ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const s = sa[i] + t * (sa[i + 1] - sa[i]);
          if (s < H.h + 4 || s > sa[sa.length - 1] - H.h - 4) continue;
          return { sa: s, sh: sh[j] + u * Math.hypot(d.x - c.x, d.z - c.z) };
        }
      }
      return null;
    }
    function splitAt(A, s) {
      const pts = A.pts, ss = arcLen(pts);
      let i = 0; while (i < ss.length - 1 && ss[i + 1] < s) i++;
      if (i >= pts.length - 1) return null;
      const t = (s - ss[i]) / Math.max(1e-6, ss[i + 1] - ss[i]);
      const m = { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, z: pts[i].z + (pts[i + 1].z - pts[i].z) * t };
      const B = { k: A.k, w: A.w, h: A.h, closed: false, pts: [m].concat(pts.slice(i + 1)), src: A.src, bulb: A.bulb, gaps: [], ends: [null, A.ends[1]] };
      A.pts = pts.slice(0, i + 1).concat([m]); A.bulb = null; A.ends = [A.ends[0], null];
      A.s = arcLen(A.pts); B.s = arcLen(B.pts);
      return B;
    }

    // ---------------- road bridges: walks + parapets over the wet part ----------------
    for (const b of P.bridges || []) {
      const s = S.byId.get(b.street);
      if (!s) continue;
      const a0 = Math.max(s.a0, Math.min(b.a0, b.a1)), a1 = Math.min(s.a1, Math.max(b.a0, b.a1));
      if (a1 - a0 < 4) continue;
      S.bridges.push({ s: s, a0: a0, a1: a1, walk: 2.5, runs: [] });
    }

    // ---------------- interchanges: four slip ramps each ----------------
    for (const ic of P.interchanges || []) {
      const s = S.byId.get(ic.street);
      if (!s) continue;
      let ov = null;
      for (const o of s.ovs) if (Math.abs(o.fwAt - (ic.fwAxis === "x" ? ic.x : ic.z)) < 1) ov = o;
      if (!ov) continue;
      const fw = ov.fwAt, half = ov.half, at = s.at;
      for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) {
        const f0 = fw + sx * (half + 1.0), f1 = fw + sx * (half + 8.0);
        const sl = { fwAxis: ic.fwAxis, F0: Math.min(f0, f1), F1: Math.max(f0, f1), Fin: f0, sx: sx, sz: sz,
          R0: at + sz * s.h, plateau: 6, L: 150, merge: 44, ov: ov, s: s, fw: fw, half: half };
        sl.Rend = sl.R0 + sz * (sl.plateau + sl.L + sl.merge);
        S.slips.push(sl);
        ov.slipGaps.push([sl.F0 - 0.2, sl.F1 + 0.2, sz]);
      }
    }
    function slipY(sl, F, R) {
      const d = (R - sl.R0) * sl.sz;
      const top = Math.max(Y.road, deckOn(sl.ov, F));
      let g;
      if (d <= sl.plateau) g = 1;
      else if (d >= sl.plateau + sl.L) g = 0;
      else { const t = (d - sl.plateau) / sl.L; g = 1 - t * t * (3 - 2 * t); }
      return Y.fw + 0.004 + (top - Y.fw - 0.004) * g;
    }
    function deckOn(ov, a) { const d = Math.min(a - ov.lo, ov.hi - a); return d <= 0 ? 0 : Y.deck * Math.min(1, d / RAMP_LEN); }
    S.slipY = slipY;

    // ---------------- rail: sections, elevation, crossings, bridges, stations -------
    for (const r of P.rail || []) S.rails.push(solveRail(r));
    function solveRail(r) {
      const R = { r: r, axis: r.axis, at: r.at, a0: r.a0, a1: r.a1, half: r.half, tracks: r.tracks || 2, xings: [], elev: [], wetR: [], secs: [] };
      // level crossings: straight streets across + pad ribbons across
      for (const s of S.streets) {
        if (s.axis !== r.axis) continue;               // parallel (a street axis names its FIXED coordinate, a rail axis the one it runs along)
        if (!(s.a0 < r.at && s.a1 > r.at)) continue;
        if (s.at < r.a0 || s.at > r.a1) continue;
        R.xings.push({ pos: s.at, h: s.h, y: Y.road, s: s });
      }
      for (const pad of S.pads) for (const rb of pad.ribs) {
        const pts = rb.pts;
        for (let k = 0; k < pts.length - 1; k++) {
          const a = pts[k], b = pts[k + 1];
          const la = r.axis === "x" ? a.z - r.at : a.x - r.at, lb = r.axis === "x" ? b.z - r.at : b.x - r.at;
          if (la * lb > 0 || la === lb) continue;
          const t = la / (la - lb), pos = r.axis === "x" ? a.x + (b.x - a.x) * t : a.z + (b.z - a.z) * t;
          const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
          const sinA = Math.abs(r.axis === "x" ? dz : dx) / L;
          R.xings.push({ pos: pos, h: rb.h / Math.max(0.35, sinA), y: Y.padRoad, rib: rb });
        }
      }
      R.xings.sort(function (a, b) { return a.pos - b.pos; });
      // the rail rises over every freeway it meets, and bridges any street in
      // the rise that would otherwise be a crossing on a slope
      for (const c of P.corridors || []) {
        const ax = c.ax || (c.axis === "z" ? "x" : "z");
        if (ax !== r.axis) continue;
        if (r.at < c.a0 || r.at > c.a1 || c.at < r.a0 || c.at > r.a1) continue;
        let lo = c.at - c.half - 8, hi = c.at + c.half + 8;
        const G_MAX = 170, G_MIN = 110;
        let Lhi = G_MAX, Llo = G_MAX;
        for (let it = 0; it < 12; it++) {
          let nx = null;
          for (const x of R.xings) if (x.pos - x.h - 5 > hi - 0.1 && (!nx || x.pos < nx.pos)) nx = x;
          const gap = nx ? nx.pos - nx.h - 5 - hi : 1e9;
          if (gap >= G_MIN) { Lhi = Math.min(G_MAX, gap); break; }
          hi = nx.pos + nx.h + 5;
        }
        for (let it = 0; it < 12; it++) {
          let nx = null;
          for (const x of R.xings) if (x.pos + x.h + 5 < lo + 0.1 && (!nx || x.pos > nx.pos)) nx = x;
          const gap = nx ? lo - (nx.pos + nx.h + 5) : 1e9;
          if (gap >= G_MIN) { Llo = Math.min(G_MAX, gap); break; }
          lo = nx.pos - nx.h - 5;
        }
        R.elev.push({ lo: lo - Llo, flo: lo, fhi: hi, hi: hi + Lhi, c: c });
      }
      for (const x of R.xings) {
        x.over = false;
        for (const e of R.elev) if (x.pos + x.h > e.lo && x.pos - x.h < e.hi) x.over = true;
      }
      // river spans
      if (river) {
        let inW = false, w0 = 0;
        for (let a = r.a0; a <= r.a1; a += 4) {
          const p = r.axis === "x" ? [a, r.at] : [r.at, a];
          const w = riverDist(p[0], p[1]) < river.half + 12;
          if (w && !inW) { inW = true; w0 = a; }
          if (!w && inW) { inW = false; R.wetR.push([w0 - 4, a]); }
        }
        if (inW) R.wetR.push([w0 - 4, r.a1]);
      }
      return R;
    }
    function railBed(R, a) {
      for (const e of R.elev) {
        if (a <= e.lo || a >= e.hi) continue;
        if (a >= e.flo && a <= e.fhi) return Y.deck;
        const t = a < e.flo ? (a - e.lo) / (e.flo - e.lo) : (e.hi - a) / (e.hi - e.fhi);
        return Y.bed + (Y.deck - Y.bed) * t;
      }
      let y = Y.bed;
      for (const x of R.xings) {
        if (x.over) continue;
        const d = Math.abs(a - x.pos) - x.h - 1;
        const dip = x.y - RAIL.top + 0.035;
        if (d < 0) return dip;
        if (d < 8) { const t = d / 8, k = t * t * (3 - 2 * t); y = Math.min(y, dip + (Y.bed - dip) * k); }
      }
      return y;
    }
    function railZone(R, a) {
      for (const e of R.elev) if (a > e.lo && a < e.hi) return (a >= e.flo && a <= e.fhi) ? "via" : "ramp";
      return "grade";
    }
    S.railBed = railBed; S.railZone = railZone;
    for (const st of P.stations || []) {
      const R = S.rails.find(function (q) { return q.axis === st.axis; }) || S.rails[0];
      if (!R) continue;
      const along = st.axis === "x" ? st.x : st.z, len = st.axis === "x" ? st.w : st.d;
      let segs = [[along - len / 2 + 6, along + len / 2 - 6]];
      for (const x of R.xings) {
        const c0 = x.pos - x.h - 2, c1 = x.pos + x.h + 2, out = [];
        for (const sg of segs) {
          if (c1 <= sg[0] || c0 >= sg[1]) { out.push(sg); continue; }
          if (c0 - sg[0] > 1) out.push([sg[0], c0]);
          if (sg[1] - c1 > 1) out.push([c1, sg[1]]);
        }
        segs = out;
      }
      segs = segs.filter(function (sg) { return sg[1] - sg[0] >= 30 && railZone(R, (sg[0] + sg[1]) / 2) === "grade"; });
      S.stations.push({ R: R, segs: segs, st: st, lat0: RAIL.sp / 2 + 1.6, lat1: Math.min(R.half - 0.3, RAIL.sp / 2 + 6.35) });
    }

    // ---------------- sound walls: behind the pad footway, gapped at streets ------------
    for (const w of P.walls || []) {
      const mx = (w.x0 + w.x1) / 2, mz = (w.z0 + w.z1) / 2;
      let pad = null;
      for (const p of S.pads) if (mx > p.x0 && mx < p.x1 && mz > p.z0 - 0.5 && mz < p.z1 + 0.5) pad = p;
      if (!pad) continue;
      const alongX = Math.abs(w.z1 - w.z0) < 0.01;
      const south = alongX ? (mz - pad.z0 < pad.z1 - mz) : (mx - pad.x0 < pad.x1 - mx);
      const off = PAD_SW + 0.45;
      const line = alongX ? (south ? pad.z0 + off : pad.z1 - off) : (south ? pad.x0 + off : pad.x1 - off);
      const a0 = (alongX ? pad.x0 : pad.z0) + PAD_SW + 2, a1 = (alongX ? pad.x1 : pad.z1) - PAD_SW - 2;
      // cut: every pad street crossing the wall line, plus exclusions
      const cuts = [];
      for (const rb of pad.ribs) {
        const pts = rb.pts, n = rb.closed ? pts.length : pts.length - 1;
        for (let k = 0; k < n; k++) {
          const a = pts[k], b = pts[(k + 1) % pts.length];
          const la = (alongX ? a.z : a.x) - line, lb = (alongX ? b.z : b.x) - line;
          if (la * lb > 0 || la === lb) continue;
          const t = la / (la - lb), c = alongX ? a.x + (b.x - a.x) * t : a.z + (b.z - a.z) * t;
          cuts.push([c - rb.h - ROLL - 2.5, c + rb.h + ROLL + 2.5]);
        }
      }
      for (let a = a0; a < a1; a += 3) {
        const x = alongX ? a : line, z = alongX ? line : a;
        if (inExcl(x, z) || wet(x, z, BANK) || inRailBand(x, z, 2)) cuts.push([a - 2, a + 2]);
      }
      cuts.sort(function (p, q) { return p[0] - q[0]; });
      let s0 = a0;
      for (const c of cuts) {
        if (c[1] <= s0) continue;
        if (c[0] > s0 + 3) S.walls.push({ alongX: alongX, line: line, a0: s0, a1: Math.min(c[0], a1), h: w.h || 2.2 });
        s0 = Math.max(s0, c[1]);
        if (s0 >= a1) break;
      }
      if (a1 > s0 + 3) S.walls.push({ alongX: alongX, line: line, a0: s0, a1: a1, h: w.h || 2.2 });
    }

    // ---------------- parks + parking (clipped to the pad / block they stand in) --------
    for (const pk of P.parks || []) S.parks.push(pk);
    for (const pk of parking) {
      if (pk.fills) continue;
      if (pk.inBlock && pk.inBlock.use === "industrial") continue;     // the yard IS the block's asphalt
      let r = { x0: pk.x0, x1: pk.x1, z0: pk.z0, z1: pk.z1, kind: pk.kind };
      for (const p of S.pads) if (pk.x0 < p.x1 && pk.x1 > p.x0 && pk.z0 < p.z1 && pk.z1 > p.z0) {
        r.x0 = Math.max(r.x0, p.x0 + PAD_SW + 0.4); r.x1 = Math.min(r.x1, p.x1 - PAD_SW - 0.4);
        r.z0 = Math.max(r.z0, p.z0 + PAD_SW + 0.4); r.z1 = Math.min(r.z1, p.z1 - PAD_SW - 0.4);
      }
      if (pk.inBlock) {
        const b = pk.inBlock;
        r.x0 = Math.max(r.x0, b.x0 + b.sw + 0.2); r.x1 = Math.min(r.x1, b.x1 - b.sw - 0.2);
        r.z0 = Math.max(r.z0, b.z0 + b.sw + 0.2); r.z1 = Math.min(r.z1, b.z1 - b.sw - 0.2);
      }
      for (const rl of P.rail || []) {
        // a lot never runs over the rail: keep its bigger side of the band
        const lo = rl.at - rl.half - 2, hi = rl.at + rl.half + 2;
        if (rl.axis === "x" && r.z0 < hi && r.z1 > lo) { if (lo - r.z0 > r.z1 - hi) r.z1 = Math.min(r.z1, lo); else r.z0 = Math.max(r.z0, hi); }
        if (rl.axis === "z" && r.x0 < hi && r.x1 > lo) { if (lo - r.x0 > r.x1 - hi) r.x1 = Math.min(r.x1, lo); else r.x0 = Math.max(r.x0, hi); }
      }
      if (r.x1 - r.x0 > 8 && r.z1 - r.z0 > 8 && !wet((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, BANK)) S.lots.push(r);
    }

    // ================= THE FLOOR: prioritised items in a bucket grid =================
    let K = 0, RIB = null;              // side channel: the kind (and ribbon) of the last probe
    const items = S.items;
    function item(pri, minX, maxX, minZ, maxZ, f) { items.push({ pri: pri, minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, f: f }); }
    // 0 ELEV — overpass approaches (the integrator's profile), slip ramps
    for (const ov of S.ovps) {
      const s = ov.s, h = s.h;
      const fn = function (x, z) {
        const a = s.axis === "x" ? z : x;
        if (a > ov.b0 && a < ov.b1) return undefined;
        K = FK.elev; return streetY(s, a);
      };
      if (s.axis === "x") item(0, s.at - h, s.at + h, ov.lo, ov.hi, fn); else item(0, ov.lo, ov.hi, s.at - h, s.at + h, fn);
    }
    for (const sl of S.slips) {
      const rA = Math.min(sl.R0, sl.Rend), rB = Math.max(sl.R0, sl.Rend);
      const fn = function (x, z) {
        const F = sl.fwAxis === "x" ? x : z, R = sl.fwAxis === "x" ? z : x;
        const d = (R - sl.R0) * sl.sz;
        if (F < sl.F0 || F > sl.F1) {
          // the merge apron between the ramp foot and the freeway shoulder
          if (d < sl.plateau + sl.L - 6) return undefined;
        }
        K = FK.elev; return slipY(sl, F, R);
      };
      const g0 = Math.min(sl.F0, sl.fw + sl.sx * sl.half), g1 = Math.max(sl.F1, sl.fw + sl.sx * sl.half);
      if (sl.fwAxis === "x") item(0, g0, g1, rA, rB, fn); else item(0, rA, rB, g0, g1, fn);
    }
    // rail embankments
    for (const R of S.rails) for (const e of R.elev) {
      for (const part of [[e.lo, e.flo], [e.fhi, e.hi]]) {
        const fn = function (x, z) {
          const a = R.axis === "x" ? x : z, l = R.axis === "x" ? z - R.at : x - R.at;
          K = FK.elev;
          return railBed(R, a) + (onSleepers(R, l) ? RAIL.sleeperH : 0);
        };
        const hw = RAIL.wall;
        if (R.axis === "x") item(0, part[0], part[1], R.at - hw, R.at + hw, fn); else item(0, R.at - hw, R.at + hw, part[0], part[1], fn);
      }
    }
    function onSleepers(R, l) {
      const n = R.tracks, off = (n - 1) * RAIL.sp / 2;
      for (let t = 0; t < n; t++) if (Math.abs(l - (-off + t * RAIL.sp)) < 1.3) return true;
      return false;
    }
    // 1 EXCL
    for (const r of S.excl) item(1, r.minX, r.maxX, r.minZ, r.maxZ, function () { K = FK.excl; return null; });
    // 2 PAD
    for (const pad of S.pads) {
      item(2, pad.x0, pad.x1, pad.z0, pad.z1, function (x, z) {
        if (pad.wet && wet(x, z, BANK)) { K = FK.excl; return null; }
        const l = pad.segGrid.get(Math.floor(x / 16) * 65536 + Math.floor(z / 16));
        if (l) {
          let bd = 1e18, bx = 0, bz = 0, br = null;
          for (let i = 0; i < l.length; i++) {
            const g = l[i];
            if (g.c) {
              if (Math.hypot(x - g.x, z - g.z) <= g.r) { K = FK.padRoad; RIB = null; return Y.padRoad; }
              continue;
            }
            const dx = g.bx - g.ax, dz = g.bz - g.az, L2 = dx * dx + dz * dz;
            let t = L2 > 0 ? ((x - g.ax) * dx + (z - g.az) * dz) / L2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = g.ax + dx * t, qz = g.az + dz * t;
            const d2 = (x - qx) * (x - qx) + (z - qz) * (z - qz);
            if (d2 <= g.hw * g.hw && d2 < bd) { bd = d2; bx = qx; bz = qz; br = g.rib; }
          }
          if (br) {
            // the ramp over the pad's kerb follows the nearest CENTRELINE
            // point's distance to the edge (the drawn stations do), so a
            // slanted mouth agrees too
            K = FK.padRoad; RIB = br;
            const e = Math.min(bx - pad.x0, pad.x1 - bx, bz - pad.z0, pad.z1 - bz);
            return e < PAD_SW ? Y.road + (Y.padRoad - Y.road) * clamp(e / PAD_SW, 0, 1) : Y.padRoad;
          }
        }
        if (pad.rail && inRailBand(x, z, 0)) return undefined;
        const k = rectKerb(pad, x, z);
        if (k < 0) { if (k === -2) { K = FK.road; return Y.road; } return undefined; }
        if (k < PAD_SW) { K = FK.walk; return Y.walk; }
        K = FK.lawn; return Y.lawn;
      });
    }
    // 3 BLOCK
    for (const b of S.blocks) {
      item(3, b.x0, b.x1, b.z0, b.z1, function (x, z) {
        const k = rectKerb(b, x, z);
        if (k < 0) { if (k === -2) { K = FK.road; return Y.road; } return undefined; }
        if (k < b.sw || b.plaza) { K = FK.walk; return Y.walk; }
        K = FK.lot; return Y.lot;
      });
    }
    // distance inside a rounded rect to its kerb line; -2 = in a rounded-off
    // corner (carriageway: the junction fillet), -1 = in a square-cut corner miss
    function rectKerb(r, x, z) {
      const dx0 = x - r.x0, dx1 = r.x1 - x, dz0 = z - r.z0, dz1 = r.z1 - z;
      const dx = dx0 < dx1 ? dx0 : dx1, dz = dz0 < dz1 ? dz0 : dz1;
      const q = dx0 < dx1 ? (dz0 < dz1 ? 0 : 3) : (dz0 < dz1 ? 1 : 2);
      const rr = r.cr[q];
      if (rr > 0 && dx < rr && dz < rr) {
        const d = Math.hypot(rr - dx, rr - dz);
        if (d > rr) return -2;
        return rr - d;
      }
      return dx < dz ? dx : dz;
    }
    S.rectKerb = rectKerb;
    // 4 STREET
    for (const s of S.streets) {
      const h = s.h;
      const fn = function () { K = FK.road; return Y.road; };
      if (s.axis === "x") item(4, s.at - h, s.at + h, s.a0, s.a1, fn); else item(4, s.a0, s.a1, s.at - h, s.at + h, fn);
    }
    // junction boxes where the node's box is wider than the street records
    for (const n of S.nodes) {
      if (n.skip) continue;
      for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) {
        const qh = qHalf(n, sx, sz);
        const xa = n.x, xb = n.x + sx * qh[0], za = n.z, zb = n.z + sz * qh[1];
        item(4, Math.min(xa, xb), Math.max(xa, xb), Math.min(za, zb), Math.max(za, zb), function () { K = FK.road; return Y.road; });
      }
    }
    // 7 FIELD
    for (const f of S.fields) item(7, f.x0, f.x1, f.z0, f.z1, function () { K = FK.field; return Y.field; });

    // bucket + probe (bridge walks and grade rail are added after the land
    // probe below, so a bridge walk is only laid where there is no footway)
    let buckets = new Map(), BB = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 }, bucketed = 0;
    function rebucket() {
      const touched = new Set();
      for (let i = bucketed; i < items.length; i++) {
        const it = items[i];
        if (it.minX < BB.minX) BB.minX = it.minX; if (it.maxX > BB.maxX) BB.maxX = it.maxX;
        if (it.minZ < BB.minZ) BB.minZ = it.minZ; if (it.maxZ > BB.maxZ) BB.maxZ = it.maxZ;
        for (let ix = Math.floor(it.minX / CELL); ix <= Math.floor(it.maxX / CELL); ix++)
          for (let iz = Math.floor(it.minZ / CELL); iz <= Math.floor(it.maxZ / CELL); iz++) {
            const k = ix * 65536 + iz; let l = buckets.get(k); if (!l) buckets.set(k, l = []);
            l.push(it); touched.add(l);
          }
      }
      bucketed = items.length;
      touched.forEach(function (l) { if (l.length > 1) l.sort(function (a, b) { return a.pri - b.pri; }); });
    }
    function probe(x, z) {
      K = FK.none; RIB = null;
      if (x < BB.minX || x > BB.maxX || z < BB.minZ || z > BB.maxZ) return null;
      const l = buckets.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL));
      if (!l) return null;
      for (let i = 0; i < l.length; i++) {
        const it = l[i];
        if (x < it.minX || x > it.maxX || z < it.minZ || z > it.maxZ) continue;
        const y = it.f(x, z);
        if (y !== undefined) return y;
      }
      K = FK.none;
      return null;
    }
    rebucket();
    // bridge walks where no land footway already is
    for (const br of S.bridges) {
      const s = br.s;
      for (let side = -1; side <= 1; side += 2) {
        let cur = null;
        for (let a = br.a0; a <= br.a1 + 0.01; a += 2) {
          const u = side * (s.h + br.walk / 2);
          const p = SP(s, a, u);
          let ok = true;
          for (const nn of s.nodes) if (!nn.n.skip && Math.abs(a - nn.pos) < nn.hc + RJ + 1) ok = false;
          if (ok) { probe(p[0], p[1]); if (K !== FK.none) ok = false; }
          if (ok) { if (!cur) cur = [a, a]; cur[1] = a; }
          else if (cur) { if (cur[1] - cur[0] >= 6) br.runs.push({ side: side, a0: cur[0], a1: cur[1] }); cur = null; }
        }
        if (cur && cur[1] - cur[0] >= 6) br.runs.push({ side: side, a0: cur[0], a1: cur[1] });
      }
      for (const run of br.runs) {
        const u0 = run.side > 0 ? s.h : -s.h - br.walk, u1 = run.side > 0 ? s.h + br.walk : -s.h;
        const p0 = SP(s, run.a0, u0), p1 = SP(s, run.a1, u1);
        item(5, Math.min(p0[0], p1[0]), Math.max(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1]), function () { K = FK.walk; return Y.walk; });
      }
    }
    // 6 RAIL at grade
    for (const R of S.rails) {
      const fn = function (x, z) {
        const a = R.axis === "x" ? x : z, l = R.axis === "x" ? z - R.at : x - R.at;
        if (railZone(R, a) !== "grade") return undefined;
        const al = Math.abs(l);
        if (al > RAIL.toe) return undefined;
        const bed = railBed(R, a);
        K = FK.rail;
        if (al <= RAIL.bedHalf) return Math.max(0.01, bed + (onSleepers(R, l) ? RAIL.sleeperH : 0));
        return Math.max(0.01, lerp(bed, 0.02, (al - RAIL.bedHalf) / (RAIL.toe - RAIL.bedHalf)));
      };
      if (R.axis === "x") item(6, R.a0, R.a1, R.at - RAIL.toe, R.at + RAIL.toe, fn); else item(6, R.at - RAIL.toe, R.at + RAIL.toe, R.a0, R.a1, fn);
    }
    rebucket();
    S.heightAt = function (x, z) { return probe(x, z); };
    S.kindAt = function (x, z) { probe(x, z); return K; };
    S.ribbonAt = function (x, z) { probe(x, z); return RIB; };
    S.topAt = function (x, z) {
      // the highest drivable surface (decks included): for traffic that rides
      // the metro's elevated streets without a layered query
      let y = probe(x, z);
      for (const d of S.decks) if (x >= d.minX && x <= d.maxX && z >= d.minZ && z <= d.maxZ) { const t = d.top(x, z); if (t === t && (y == null || t > y)) y = t; }
      return y;
    };

    // ================= platforms, decks, colliders =================
    const PL = S.platforms, CO = S.colliders;
    function col(minX, maxX, minZ, maxZ, y0, y1, extra) {
      const c = { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, y0: y0, y1: y1, metro: P.id, tileKey: null };
      if (extra) for (const k in extra) c[k] = extra[k];
      CO.push(c); return c;
    }
    function colAlong(axis, at0, at1, a0, a1, y0, y1) {
      // a wall running along `axis` ('x' = along z at fixed x-band [at0,at1])
      if (axis === "x") return col(Math.min(at0, at1), Math.max(at0, at1), Math.min(a0, a1), Math.max(a0, a1), y0, y1);
      return col(Math.min(a0, a1), Math.max(a0, a1), Math.min(at0, at1), Math.max(at0, at1), y0, y1);
    }
    S.colAlong = colAlong;
    for (const ov of S.ovps) {
      const s = ov.s, h = s.h;
      // the deck over the freeway: a platform (STEP_UP gated: cars below stay below)
      if (s.axis === "x") PL.push({ minX: s.at - h, maxX: s.at + h, minZ: ov.b0, maxZ: ov.b1, top: Y.deck, metro: P.id });
      else PL.push({ minX: ov.b0, maxX: ov.b1, minZ: s.at - h, maxZ: s.at + h, top: Y.deck, metro: P.id });
      // the layered deck (whole elevated piece, integrator's profile) for the driven car
      const bb = s.axis === "x" ? { minX: s.at - h, maxX: s.at + h, minZ: ov.lo, maxZ: ov.hi } : { minX: ov.lo, maxX: ov.hi, minZ: s.at - h, maxZ: s.at + h };
      bb.top = function (x, z) { const a = s.axis === "x" ? z : x; return Math.max(Y.road, streetY(s, a)); };
      S.decks.push(bb);
      // retaining walls + parapets on the ramps, parapets on the deck
      for (let side = -1; side <= 1; side += 2) {
        const u0 = side * (h - PAR_W), u1 = side * (h + 0.05);
        for (let a = ov.lo; a < ov.hi - 0.01; a += 8) {
          const b = Math.min(ov.hi, a + 8), m = (a + b) / 2;
          if (gapHit(ov, side, a, b)) continue;
          const yTop = Math.max(streetY(s, a), streetY(s, b));
          if (yTop < 0.3) continue;
          const onDeck = m > ov.b0 && m < ov.b1;
          const y0 = onDeck ? Y.deck - Y.deckDepth : -0.5;
          colAlong(s.axis, s.at + u0, s.at + u1, a, b, y0, yTop + PAR_H);
        }
      }
      // piers just outside the freeway pavement
      for (let e = -1; e <= 1; e += 2) {
        const a = ov.fwAt + e * (ov.half + 2.2);
        for (const u of [-h + 3, 0, h - 3]) {
          const p = SP(s, a, u);
          col(p[0] - 0.55, p[0] + 0.55, p[1] - 0.55, p[1] + 0.55, -0.5, Y.deck - Y.deckDepth - 0.05);
        }
      }
    }
    function gapHit(ov, side, a, b) {
      for (const g of ov.slipGaps) if (g[2] === side && b > g[0] && a < g[1]) return true;
      return false;
    }
    S.gapHit = gapHit;
    for (const sl of S.slips) {
      for (const Fw of [sl.F0, sl.F1]) {
        for (let d = 0; d < sl.plateau + sl.L; d += 8) {
          const R0 = sl.R0 + sl.sz * d, R1 = sl.R0 + sl.sz * (d + 8);
          const yTop = Math.max(slipY(sl, Fw, R0), slipY(sl, Fw, R1));
          if (yTop < 0.3) continue;
          // a wall along the freeway's run axis: retaining face + parapet
          colAlong(sl.fwAxis === "x" ? "x" : "z", Fw - 0.2, Fw + 0.2, R0, R1, -0.5, yTop + PAR_H);
        }
      }
    }
    for (const br of S.bridges) for (const run of br.runs) {
      const s = br.s, u = run.side * (s.h + br.walk);
      colAlong(s.axis, s.at + u - run.side * PAR_W, s.at + u, run.a0, run.a1, -3, Y.walk + PAR_H);
    }
    for (const w of S.walls) {
      if (w.alongX) col(w.a0, w.a1, w.line - 0.13, w.line + 0.13, -0.2, Y.lawn + w.h);
      else col(w.line - 0.13, w.line + 0.13, w.a0, w.a1, -0.2, Y.lawn + w.h);
    }
    for (const R of S.rails) {
      for (const e of R.elev) {
        // viaduct: flat platform pieces (<= 200 m), parapets, piers
        for (let a = e.flo; a < e.fhi - 0.01; a += 200) {
          const b = Math.min(e.fhi, a + 200);
          if (R.axis === "x") PL.push({ minX: a, maxX: b, minZ: R.at - RAIL.wall, maxZ: R.at + RAIL.wall, top: Y.deck, metro: P.id });
          else PL.push({ minX: R.at - RAIL.wall, maxX: R.at + RAIL.wall, minZ: a, maxZ: b, top: Y.deck, metro: P.id });
        }
        for (let side = -1; side <= 1; side += 2) {
          for (let a = e.lo; a < e.hi - 0.01; a += 8) {
            const b = Math.min(e.hi, a + 8);
            const yTop = Math.max(railBed(R, a), railBed(R, b));
            if (yTop < 0.6) continue;
            const via = a >= e.flo - 0.01 && b <= e.fhi + 0.01;
            const along = R.axis === "x" ? "z" : "x";
            colAlong(along, R.at + side * (RAIL.bedHalf), R.at + side * RAIL.wall, a, b, via ? Y.deck - Y.deckDepth : -0.5, yTop + 1.0);
          }
        }
        for (const pa of viaPiers(R, e)) {
          const p = R.axis === "x" ? [pa, R.at] : [R.at, pa];
          if (R.axis === "x") col(p[0] - 0.8, p[0] + 0.8, p[1] - 3.2, p[1] + 3.2, -0.5, Y.deck - Y.deckDepth - 0.05);
          else col(p[0] - 3.2, p[0] + 3.2, p[1] - 0.8, p[1] + 0.8, -0.5, Y.deck - Y.deckDepth - 0.05);
        }
      }
      for (const w of R.wetR) for (let side = -1; side <= 1; side += 2) {
        const along = R.axis === "x" ? "z" : "x";
        colAlong(along, R.at + side * 5.1, R.at + side * 5.6, w[0], w[1], Y.bed - 0.3, Y.bed + 7.2);
      }
    }
    function viaPiers(R, e) {
      const out = [];
      for (let a = e.flo + 10; a < e.fhi - 5; a += 24) {
        let ok = true;
        for (const x of R.xings) if (Math.abs(a - x.pos) < x.h + 2.5) ok = false;
        const c = e.c;
        if (Math.abs(a - c.at) < c.half + 1.5) ok = false;
        if (ok) out.push(a);
      }
      return out;
    }
    S.viaPiers = viaPiers;
    for (const st of S.stations) {
      const R = st.R;
      for (const sg of st.segs) for (let side = -1; side <= 1; side += 2) {
        const l0 = R.at + side * st.lat0, l1 = R.at + side * st.lat1;
        const ramp = 13.2;
        // flat top + two ramps (physics.js ramp records)
        const flat = R.axis === "x" ? { minX: sg[0] + ramp, maxX: sg[1] - ramp, minZ: Math.min(l0, l1), maxZ: Math.max(l0, l1), top: Y.plat, metro: P.id }
                                    : { minX: Math.min(l0, l1), maxX: Math.max(l0, l1), minZ: sg[0] + ramp, maxZ: sg[1] - ramp, top: Y.plat, metro: P.id };
        PL.push(flat);
        for (const end of [[sg[0], sg[0] + ramp], [sg[1], sg[1] - ramp]]) {
          const lo = Math.min(end[0], end[1]), hi = Math.max(end[0], end[1]);
          const rec = R.axis === "x"
            ? { minX: lo, maxX: hi, minZ: Math.min(l0, l1), maxZ: Math.max(l0, l1), top: Y.plat, metro: P.id, ramp: { axis: "x", x0: end[0], x1: end[1], y0: 0.02, y1: Y.plat } }
            : { minX: Math.min(l0, l1), maxX: Math.max(l0, l1), minZ: lo, maxZ: hi, top: Y.plat, metro: P.id, ramp: { z0: end[0], z1: end[1], y0: 0.02, y1: Y.plat } };
          PL.push(rec);
        }
        // faces: stepped along the ramps, full along the flat
        const along = R.axis === "x" ? "z" : "x";
        for (const edge of [l0, l1]) {
          const e0 = edge - 0.1, e1 = edge + 0.1;
          colAlong(along, e0, e1, sg[0] + ramp, sg[1] - ramp, -0.2, Y.plat);
          for (let k = 0; k < 3; k++) {
            const t0 = (k + 1) / 3 * ramp, y1 = Y.plat * (k + 0.5) / 3;
            colAlong(along, e0, e1, sg[0] + k / 3 * ramp, sg[0] + t0, -0.2, y1);
            colAlong(along, e0, e1, sg[1] - t0, sg[1] - k / 3 * ramp, -0.2, y1);
          }
        }
      }
    }
    // the layered surface the driven car reads (systems/platforms_moving.js):
    // ONE static rig for all of this metro's overpass decks
    if (CBZ && CBZ.movingPlatform && S.decks.length) {
      const cx = P.cx || 0, cz = P.cz || 0;
      const decks = S.decks.map(function (d, i) {
        return { id: P.id + "-deck" + i, x: (d.minX + d.maxX) / 2 - cx, z: (d.minZ + d.maxZ) / 2 - cz, w: d.maxX - d.minX, d: d.maxZ - d.minZ, top: 0,
          topAt: function (lx, lz) { return d.top(lx + cx, lz + cz); } };
      });
      try {
        S.rig = CBZ.movingPlatform(function (o) { o.x = cx; o.y = 0; o.z = cz; o.yaw = 0; return o; },
          { id: P.id + "-overpasses", yaw: false, tilt: false, riders: true, onLeave: "none", decks: decks });
      } catch (e) { S.rig = null; }
    }

    // ================= lamps + drives (need the floor) =================
    S.pieces = streetPieces();
    for (const pc of S.pieces) {
      const s = pc.s;
      if (s.k !== "art" && s.k !== "loc") continue;
      const sp = s.k === "art" ? 36 : 42;
      const len = pc.a1 - pc.a0;
      if (len < 12) continue;
      const k0 = Math.ceil((pc.a0 + 8) / sp), k1 = Math.floor((pc.a1 - 8) / sp);
      for (let k = k0; k <= k1; k++) {
        const a = k * sp + (s.at % 7);
        if (a < pc.a0 + 6 || a > pc.a1 - 6) continue;
        if (streetY(s, a) > Y.road + 0.01) continue;
        const side = (k & 1) ? 1 : -1;
        const u = side * (s.h + 0.75);
        const p = SP(s, a, u);
        probe(p[0], p[1]);
        if (K !== FK.walk) continue;
        const yaw = s.axis === "x" ? (side > 0 ? Math.PI : 0) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
        S.lamps.push({ x: p[0], z: p[1], y: Y.walk, yaw: yaw, H: s.k === "art" ? 1.0 : 0.86 });
        col(p[0] - 0.16, p[0] + 0.16, p[1] - 0.16, p[1] + 0.16, 0, Y.walk + 8.2);
      }
    }
    for (const b of P.bldgs || []) {
      if (!b.drive) continue;
      const nx = -Math.sin(b.rot || 0), nz = -Math.cos(b.rot || 0);
      const fx = b.x - nx * b.d / 2, fz = b.z - nz * b.d / 2;
      let ex = null, ez = null, kind = 0, rib = null;
      for (let t = 0.5; t < 40; t += 0.75) {
        const x = fx - nx * t, z = fz - nz * t;
        probe(x, z);
        if (K === FK.padRoad || K === FK.road) { ex = x; ez = z; kind = K; rib = RIB; break; }
        if (K === FK.excl || K === FK.walk) break;
      }
      if (ex == null) continue;
      const skip = kind === FK.padRoad ? (rib && rib.k === "col" ? 3.6 : 0.1) : 0.2;
      const sx = ex + nx * skip, sz = ez + nz * skip;
      const L = (fx - sx) * nx + (fz - sz) * nz;
      if (L < 1.5) continue;
      const dw = b.garage ? 5.4 : 3.2;
      const off = (hsh(b.x, b.z, 71) < 0.5 ? -1 : 1) * Math.max(0, b.w / 2 - dw / 2 - 1.2);
      const tx = -nz, tz = nx;
      const my = probe(sx + nx * L / 2 + tx * off, sz + nz * L / 2 + tz * off);
      const y = (K === FK.lawn || K === FK.padRoad) ? Y.drive : Math.max(0, my || 0) + 0.016;
      S.drives.push({ x0: sx + tx * off, z0: sz + tz * off, nx: nx, nz: nz, tx: tx, tz: tz, L: L, w: dw, y: y });
    }


    /* ---------------- coverAt: THE GRASS FIELD'S QUESTION ----------------
       (world/grassfield.js) Where this metro's floor is lawn (pads, lawn
       blocks, parks, campus), blades grow; everything drawn ON the lawn
       (houses, driveways, park paths, parking lots, row-house stoops) is
       cut out of it, from the same plan data the meshes are laid from. The
       colour handed back is the lawn's own linear albedo with the shader's
       dry-patch shift, so the blades average to the ground under them.
       Owns every point on this metro's floor. Built on first use. */
    let covIx = null;
    function coverIndex() {
      const CB = 16, map = new Map();
      function add(minX, maxX, minZ, maxZ, sh) {
        for (let ix = Math.floor(minX / CB); ix <= Math.floor(maxX / CB); ix++)
          for (let iz = Math.floor(minZ / CB); iz <= Math.floor(maxZ / CB); iz++) {
            const k = ix * 100003 + iz; let l = map.get(k); if (!l) map.set(k, l = []); l.push(sh);
          }
      }
      function rect(x0, x1, z0, z1) { add(x0, x1, z0, z1, { t: 0, x0: x0, x1: x1, z0: z0, z1: z1 }); }
      function orect(cx, cz, c, s, hw, hd) {
        const ex = Math.abs(c) * hw + Math.abs(s) * hd, ez = Math.abs(s) * hw + Math.abs(c) * hd;
        add(cx - ex, cx + ex, cz - ez, cz + ez, { t: 1, x: cx, z: cz, c: c, s: s, hw: hw, hd: hd });
      }
      // houses and every other building standing on a lawn
      for (const b of P.bldgs || []) {
        const r = b.rot || 0;
        orect(b.x, b.z, Math.cos(r), Math.sin(r), b.w / 2 + 0.35, b.d / 2 + 0.35);
      }
      // driveways (n along, t across)
      for (const v of S.drives) {
        const cx = v.x0 + v.nx * v.L / 2, cz = v.z0 + v.nz * v.L / 2;
        // local axes: u along t (tx,tz), w along n (nx,nz) -> as a rotation c/s
        orect(cx, cz, v.tx, -v.tz, v.w / 2 + 0.25, v.L / 2 + 0.3);
      }
      for (const l of S.lots) rect(l.x0 - 0.3, l.x1 + 0.3, l.z0 - 0.3, l.z1 + 0.3);
      // park paths: the ring just inside the inset + the cross (park())
      for (const pk of S.parks) {
        const inset = pk.kind === "pocket" ? 2 : pk.kind === "quad" ? 0 : PAD_SW + 6;
        const wdt = (pk.kind === "pocket" ? 2.0 : 2.8) + 0.2;
        const x0 = pk.x0 + inset, x1 = pk.x1 - inset, z0 = pk.z0 + inset, z1 = pk.z1 - inset;
        if (x1 - x0 < 12 || z1 - z0 < 12) continue;
        rect(x0, x1, z0, z0 + wdt); rect(x0, x1, z1 - wdt, z1); rect(x0, x0 + wdt, z0, z1); rect(x1 - wdt, x1, z0, z1);
        if (pk.kind === "central" || pk.kind === "quad" || pk.kind === "park") {
          const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hw = wdt / 2;
          rect(x0, x1, cz - hw, cz + hw); rect(cx - hw, cx + hw, z0, z1);
        }
      }
      // lawn blocks (and their row-house stoop strips)
      for (const b of S.blocks) {
        if (b.plaza || b.lotAll || b.use === "industrial" || b.use === "cbd" || b.use === "midtown") continue;
        add(b.x0, b.x1, b.z0, b.z1, { t: 2, b: b });
        if (b.use === "rows") {
          const alongX = (b.x1 - b.x0) >= (b.z1 - b.z0), i0 = b.sw - 0.2, i1 = b.sw + 1.7;
          if (alongX) { rect(b.x0 + b.sw + 1.8, b.x1 - b.sw - 1.8, b.z0 + i0, b.z0 + i1); rect(b.x0 + b.sw + 1.8, b.x1 - b.sw - 1.8, b.z1 - i1, b.z1 - i0); }
          else { rect(b.x0 + i0, b.x0 + i1, b.z0 + b.sw + 1.8, b.z1 - b.sw - 1.8); rect(b.x1 - i1, b.x1 - i0, b.z0 + b.sw + 1.8, b.z1 - b.sw - 1.8); }
        }
      }
      return { CB: CB, map: map };
    }
    function mgHashJ(px, py) {
      const fr = function (v) { return v - Math.floor(v); };
      let x = fr(px * 0.1031), y = fr(py * 0.1031), z = fr(px * 0.1031);
      const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
      x += d; y += d; z += d;
      return fr((x + y) * z);
    }
    function mgNoiseJ(px, py) {
      const ix = Math.floor(px), iy = Math.floor(py);
      let fx = px - ix, fy = py - iy;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const a = mgHashJ(ix, iy), b = mgHashJ(ix + 1, iy), c = mgHashJ(ix, iy + 1), d = mgHashJ(ix + 1, iy + 1);
      return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
    }
    S.coverAt = function (x, z, out) {
      const y = probe(x, z);
      if (y == null) return false;
      out.g = 0;
      const k = K;
      if (k !== FK.lawn && k !== FK.lot) return true;
      if (!covIx) covIx = coverIndex();
      const l = covIx.map.get(Math.floor(x / covIx.CB) * 100003 + Math.floor(z / covIx.CB));
      let col = COL.lawn, lawnBlock = k === FK.lawn;
      if (l) for (let i = 0; i < l.length; i++) {
        const sh = l[i];
        if (sh.t === 0) { if (x >= sh.x0 && x <= sh.x1 && z >= sh.z0 && z <= sh.z1) return true; }
        else if (sh.t === 1) {
          const dx = x - sh.x, dz = z - sh.z;
          if (Math.abs(dx * sh.c - dz * sh.s) <= sh.hw && Math.abs(dx * sh.s + dz * sh.c) <= sh.hd) return true;
        } else if (k === FK.lot && x >= sh.b.x0 && x <= sh.b.x1 && z >= sh.b.z0 && z <= sh.b.z1) {
          lawnBlock = true; col = sh.b.use === "rows" ? COL.lawn : COL.lawnDry;
        }
      }
      if (!lawnBlock) return true;
      if (k === FK.lawn) for (const p of S.pads) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) { if (p.use === "park") col = COL.lawnPark; break; }
      // the shader's lawn: base^2 x its mottle, and the dry-patch shift
      const dp = Math.max(0, Math.min(1, (mgNoiseJ(x * 0.031 + 7.3, z * 0.031 + 7.3) - 0.6) / 0.22));
      const dry = dp * dp * (3 - 2 * dp) * 0.55;
      const t = 0.95;
      out.r = col[0] * col[0] * t * (1 + 0.55 * dry);
      out.gr = col[1] * col[1] * t * (1 + 0.25 * dry);
      out.b = col[2] * col[2] * t * (1 - 0.28 * dry);
      out.g = 1; out.y = y; out.dry = dry; out.wild = 0; out.h = 1; out.flw = 0.025;
      return true;
    };

    // ================= tile bins =================
    binAll(S, S.tile);
    S.stats = {
      solveMs: +(now() - T0).toFixed(1), items: items.length, buckets: buckets.size, nodes: S.nodes.length, pieces: S.pieces.length,
      pads: S.pads.length, ribbons: S.pads.reduce(function (n, p) { return n + p.ribs.length; }, 0), bulbs: S.pads.reduce(function (n, p) { return n + p.bulbs.length; }, 0),
      lamps: S.lamps.length, drives: S.drives.length, walls: S.walls.length, platforms: PL.length, colliders: CO.length, decks: S.decks.length,
      skippedNodes: S.nodes.filter(function (n) { return n.skip; }).length,
    };
    if (CACHE) CACHE.set(P, S);
    return S;

    // ---- street pieces between junction boxes, minus exclusions, split per tile later
    function streetPieces() {
      const out = [];
      for (const s of S.streets) {
        const cuts = [];
        for (const nn of s.nodes) {
          if (!nn.n.skip) cuts.push([nn.pos - nn.hc - RJ, nn.pos + nn.hc + RJ, nn.n]);
          else if (!s.ovs.some(function (o) { return nn.pos > o.lo - nn.hc && nn.pos < o.hi + nn.hc; })) cuts.push([nn.pos - nn.hc - 0.02, nn.pos + nn.hc + 0.02, null]);
        }
        // a crossing street's ramp band: the piece stops at the retaining wall
        for (const r of S.excl) {
          const hit = s.axis === "x" ? (s.at + s.h > r.minX && s.at - s.h < r.maxX) : (s.at + s.h > r.minZ && s.at - s.h < r.maxZ);
          if (!hit) continue;
          const e0 = s.axis === "x" ? r.minZ : r.minX, e1 = s.axis === "x" ? r.maxZ : r.maxX;
          if (s.ovs.some(function (o) { return o.lo < e1 && o.hi > e0; })) continue;
          cuts.push([e0, e1, null]);
        }
        cuts.sort(function (a, b) { return a[0] - b[0]; });
        let a = s.a0, fromNode = false;
        for (const c of cuts) {
          if (c[1] <= a) { if (c[2]) fromNode = true; continue; }
          if (c[0] > a + 0.05) out.push({ s: s, a0: a, a1: Math.min(c[0], s.a1), w0: fromNode, w1: !!c[2] });
          a = Math.max(a, c[1]); fromNode = !!c[2];
          if (a >= s.a1) break;
        }
        if (s.a1 > a + 0.05) out.push({ s: s, a0: a, a1: s.a1, w0: fromNode, w1: false });
      }
      return out;
    }
  }

  /* ==================================================================
     TILE BINS — what each 800 m tile draws
     ================================================================== */
  function binAll(S, T) {
    S.tile = T;
    const bins = new Map();
    function key(x, z) { return Math.floor(x / T) + "," + Math.floor(z / T); }
    function put(x, z, d) { const k = key(x, z); let l = bins.get(k); if (!l) bins.set(k, l = []); l.push(d); }
    function splitAlong(a0, a1, cb) {
      let a = a0;
      while (a < a1 - 1e-6) { const b = Math.min(a1, (Math.floor(a / T + 1e-9) + 1) * T); cb(a, b); a = b; }
    }
    for (const pc of S.pieces) {
      const s = pc.s;
      splitAlong(pc.a0, pc.a1, function (a, b) {
        const p = SP(s, (a + b) / 2, 0);
        put(p[0], p[1], { t: "piece", pc: pc, a0: a, a1: b, w0: a === pc.a0 && pc.w0, w1: b === pc.a1 && pc.w1 });
      });
    }
    for (const n of S.nodes) if (!n.skip) put(n.x, n.z, { t: "node", n: n });
    for (const b of S.blocks) put((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, { t: "block", b: b });
    for (const p of S.pads) {
      put((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, { t: "pad", p: p });
      for (const r of p.ribs) { const m = r.pts[r.pts.length >> 1]; put(m.x, m.z, { t: "rib", r: r }); }
      for (const bu of p.bulbs) put(bu.x, bu.z, { t: "bulb", b: bu });
    }
    for (const ov of S.ovps) { const p = SP(ov.s, (ov.b0 + ov.b1) / 2, 0); put(p[0], p[1], { t: "ovp", ov: ov }); }
    for (const sl of S.slips) { const R = (sl.R0 + sl.Rend) / 2, F = (sl.F0 + sl.F1) / 2; put(sl.fwAxis === "x" ? F : R, sl.fwAxis === "x" ? R : F, { t: "slip", sl: sl }); }
    for (const br of S.bridges) { const p = SP(br.s, (br.a0 + br.a1) / 2, 0); put(p[0], p[1], { t: "bridge", br: br }); }
    for (const R of S.rails) {
      const cuts = [R.a0, R.a1];
      for (const e of R.elev) cuts.push(e.lo, e.flo, e.fhi, e.hi);
      for (const w of R.wetR) cuts.push(w[0], w[1]);
      for (let a = Math.ceil(R.a0 / T) * T; a < R.a1; a += T) cuts.push(a);
      cuts.sort(function (a, b) { return a - b; });
      for (let i = 0; i < cuts.length - 1; i++) {
        const a = Math.max(R.a0, cuts[i]), b = Math.min(R.a1, cuts[i + 1]);
        if (b - a < 0.05) continue;
        const m = (a + b) / 2;
        put(R.axis === "x" ? m : R.at, R.axis === "x" ? R.at : m, { t: "rail", R: R, a0: a, a1: b, zone: S.railZone(R, m),
          wet: R.wetR.some(function (w) { return m > w[0] && m < w[1]; }) });
      }
      for (const e of R.elev) for (const pa of S.viaPiers(R, e)) put(R.axis === "x" ? pa : R.at, R.axis === "x" ? R.at : pa, { t: "vpier", R: R, a: pa });
      for (const w of R.wetR) { const m = (w[0] + w[1]) / 2; put(R.axis === "x" ? m : R.at, R.axis === "x" ? R.at : m, { t: "truss", R: R, a0: w[0], a1: w[1] }); }
      for (const x of R.xings) if (!x.over) put(R.axis === "x" ? x.pos : R.at, R.axis === "x" ? R.at : x.pos, { t: "xing", R: R, x: x });
    }
    for (const st of S.stations) for (const sg of st.segs) { const m = (sg[0] + sg[1]) / 2; put(st.R.axis === "x" ? m : st.R.at, st.R.axis === "x" ? st.R.at : m, { t: "platform", st: st, sg: sg }); }
    for (const f of S.fields) put((f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2, { t: "field", f: f });
    for (const w of S.walls) { const m = (w.a0 + w.a1) / 2; put(w.alongX ? m : w.line, w.alongX ? w.line : m, { t: "wall", w: w }); }
    for (const pk of S.parks) put((pk.x0 + pk.x1) / 2, (pk.z0 + pk.z1) / 2, { t: "park", pk: pk });
    for (const l of S.lots) put((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2, { t: "lot", l: l });
    for (const d of S.drives) put(d.x0, d.z0, { t: "drive", d: d });
    for (const l of S.lamps) put(l.x, l.z, { t: "lamp", l: l });
    S.bins = bins;
    // stamp colliders with their tile key
    for (const c of S.colliders) c.tileKey = key((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2);
  }

  /* ==================================================================
     THE WRITER — growable typed arrays, one per (tile, material)
     ================================================================== */
  function Buf(spec) {
    this.spec = spec; this.n = 0; this.cap = 512; this.ni = 0;
    this.pos = new Float32Array(this.cap * 3); this.nrm = new Int8Array(this.cap * 3);
    this.uv = spec.uv ? new Float32Array(this.cap * 2) : null;
    this.col = spec.col ? new Uint8Array(this.cap * 3) : null;
    this.lane = spec.lane ? new Float32Array(this.cap * 3) : null;
    this.gk = spec.gk ? new Uint8Array(this.cap * 2) : null;
    this.idx = new Uint32Array(this.cap * 3);
    this.cn = [0, 127, 0]; this.cc = [255, 255, 255]; this.ck = [0, 255]; this.cl = [0, 99, 0];
    this.minX = 1e9; this.maxX = -1e9; this.minY = 1e9; this.maxY = -1e9; this.minZ = 1e9; this.maxZ = -1e9;
  }
  function growF(a, n) { const b = new a.constructor(n); b.set(a); return b; }
  Buf.prototype.grow = function () {
    const c = this.cap * 2; this.cap = c;
    this.pos = growF(this.pos, c * 3); this.nrm = growF(this.nrm, c * 3);
    if (this.uv) this.uv = growF(this.uv, c * 2);
    if (this.col) this.col = growF(this.col, c * 3);
    if (this.lane) this.lane = growF(this.lane, c * 3);
    if (this.gk) this.gk = growF(this.gk, c * 2);
  };
  Buf.prototype.N = function (x, y, z) {
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    this.cn[0] = Math.round(x / l * 127); this.cn[1] = Math.round(y / l * 127); this.cn[2] = Math.round(z / l * 127);
    return this;
  };
  Buf.prototype.C = function (c, k) {
    k = k == null ? 1 : k;
    this.cc[0] = clamp(Math.round(c[0] * k * 255), 0, 255); this.cc[1] = clamp(Math.round(c[1] * k * 255), 0, 255); this.cc[2] = clamp(Math.round(c[2] * k * 255), 0, 255);
    return this;
  };
  Buf.prototype.T = function (t) { const v = clamp(Math.round(t * 255), 0, 255); this.cc[0] = this.cc[1] = this.cc[2] = v; return this; };
  Buf.prototype.K = function (k, p) { this.ck[0] = k; this.ck[1] = p == null ? 255 : p; return this; };
  Buf.prototype.L = function (u, e, w) { this.cl[0] = u; this.cl[1] = e; this.cl[2] = w; return this; };
  Buf.prototype.v = function (x, y, z, u, v) {
    if (this.n >= this.cap) this.grow();
    const i = this.n++, i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.nrm[i3] = this.cn[0]; this.nrm[i3 + 1] = this.cn[1]; this.nrm[i3 + 2] = this.cn[2];
    if (this.uv) { this.uv[i * 2] = u || 0; this.uv[i * 2 + 1] = v || 0; }
    if (this.col) { this.col[i3] = this.cc[0]; this.col[i3 + 1] = this.cc[1]; this.col[i3 + 2] = this.cc[2]; }
    if (this.lane) { this.lane[i3] = this.cl[0]; this.lane[i3 + 1] = this.cl[1]; this.lane[i3 + 2] = this.cl[2]; }
    if (this.gk) { this.gk[i * 2] = this.ck[0]; this.gk[i * 2 + 1] = this.ck[1]; }
    if (x < this.minX) this.minX = x; if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y; if (y > this.maxY) this.maxY = y;
    if (z < this.minZ) this.minZ = z; if (z > this.maxZ) this.maxZ = z;
    return i;
  };
  // triangle wound to face its first vertex's normal
  Buf.prototype.t = function (a, b, c) {
    const p = this.pos, a3 = a * 3, b3 = b * 3, c3 = c * 3;
    const ux = p[b3] - p[a3], uy = p[b3 + 1] - p[a3 + 1], uz = p[b3 + 2] - p[a3 + 2];
    const vx = p[c3] - p[a3], vy = p[c3 + 1] - p[a3 + 1], vz = p[c3 + 2] - p[a3 + 2];
    const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
    if (wx * wx + wy * wy + wz * wz < 1e-12) return;
    if (this.ni + 3 > this.idx.length) this.idx = growF(this.idx, this.idx.length * 2);
    const n = this.nrm;
    if (wx * n[a3] + wy * n[a3 + 1] + wz * n[a3 + 2] < 0) { this.idx[this.ni++] = a; this.idx[this.ni++] = c; this.idx[this.ni++] = b; }
    else { this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
  };
  Buf.prototype.q = function (a, b, c, d) { this.t(a, b, c); this.t(a, c, d); };
  Buf.prototype.bytes = function () {
    const n = this.n;
    return n * (12 + 3 + (this.uv ? 8 : 0) + (this.col ? 3 : 0) + (this.lane ? 12 : 0) + (this.gk ? 2 : 0)) + this.ni * (n > 65535 ? 4 : 2);
  };
  // axis-aligned box (bottom face omitted), faces wound outward
  Buf.prototype.box = function (x0, x1, y0, y1, z0, z1, noTop) {
    const faces = [
      [[1, 0, 0], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]]],
      [[-1, 0, 0], [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]]],
      [[0, 0, 1], [[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]]],
      [[0, 0, -1], [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]]],
    ];
    if (!noTop) faces.push([[0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]]);
    for (const f of faces) {
      this.N(f[0][0], f[0][1], f[0][2]);
      const q = f[1].map(function (p) { return this.v(p[0], p[1], p[2], 0, 0); }, this);
      this.q(q[0], q[1], q[2], q[3]);
    }
  };
  // a beam between two points with a w x h section (four sides, no ends)
  Buf.prototype.beam = function (ax, ay, az, bx, by, bz, w, h) {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; dx /= L; dy /= L; dz /= L;
    let sx = -dz, sy = 0, sz = dx;
    let sl = Math.sqrt(sx * sx + sz * sz);
    if (sl < 1e-4) { sx = 1; sz = 0; sl = 1; }
    sx /= sl; sz /= sl;
    const ux = sy * dz - sz * dy, uy = sz * dx - sx * dz, uz = sx * dy - sy * dx;
    const hw = w / 2, hh = h / 2;
    const off = [[hw, hh], [-hw, hh], [-hw, -hh], [hw, -hh]];
    const nrm = [[0, 1], [-1, 0], [0, -1], [1, 0]];
    for (let k = 0; k < 4; k++) {
      const o0 = off[k], o1 = off[(k + 1) % 4];
      const nn = k === 0 ? [ux, uy, uz] : k === 1 ? [-sx, -sy, -sz] : k === 2 ? [-ux, -uy, -uz] : [sx, sy, sz];
      this.N(nn[0], nn[1], nn[2]);
      const p0 = [ax + sx * o0[0] + ux * o0[1], ay + sy * o0[0] + uy * o0[1], az + sz * o0[0] + uz * o0[1]];
      const p1 = [ax + sx * o1[0] + ux * o1[1], ay + sy * o1[0] + uy * o1[1], az + sz * o1[0] + uz * o1[1]];
      const a = this.v(p0[0], p0[1], p0[2]), b = this.v(p1[0], p1[1], p1[2]);
      const c = this.v(p1[0] + dx * L, p1[1] + dy * L, p1[2] + dz * L), d = this.v(p0[0] + dx * L, p0[1] + dy * L, p0[2] + dz * L);
      this.q(a, b, c, d);
      void nrm;
    }
  };

  const SPECS = {
    roadA: { uv: true, lane: true }, roadL: { uv: true, lane: true },
    foot: { uv: true, col: true }, kerb: { uv: true, col: true }, paint: { col: true },
    ground: { col: true, gk: true }, struct: { col: true, gk: true },
  };

  /* ==================================================================
     EMIT — one tile's geometry as typed arrays (pure; node measures it)
     ================================================================== */
  function tileArrays(P, key) {
    const S = solve(P);
    const T0 = now();
    const B = {};
    for (const k in SPECS) B[k] = new Buf(SPECS[k]);
    const lampM = [], sleeperM = [];
    const list = S.bins.get(key) || [];
    const E = emitters(S, B, lampM, sleeperM);
    for (const d of list) { const f = E[d.t]; if (f) f(d); }
    let verts = 0, bytes = 0;
    for (const k in B) { verts += B[k].n; bytes += B[k].bytes(); }
    bytes += (lampM.length + sleeperM.length) / 12 * 64;
    return { bufs: B, lamps: lampM, sleepers: sleeperM, stats: { ms: +(now() - T0).toFixed(2), vertices: verts, bytes: bytes, items: list.length } };
  }

  function emitters(S, B, lampM, sleeperM) {
    const P = S.P;
    const RA = B.roadA, RL = B.roadL, FO = B.foot, KE = B.kerb, PA = B.paint, GR = B.ground, ST = B.struct;

    // ---------- paint helpers ----------
    function paintQuad(p0, p1, p2, p3, y, c, tone) {
      PA.N(0, 1, 0).C(c, tone == null ? 1 : tone);
      const a = PA.v(p0[0], y, p0[1]), b = PA.v(p1[0], y, p1[1]), cc = PA.v(p2[0], y, p2[1]), d = PA.v(p3[0], y, p3[1]);
      PA.q(a, b, cc, d);
    }
    // a quad on a straight street between along a0..a1, lateral u0..u1 (follows the ramp)
    function paintAlong(s, a0, a1, u0, u1, c, tone) {
      if (a1 - a0 < 0.02) return;
      const st = [a0];
      for (const o of s.ovs) for (const b of [o.lo, o.b0, o.b1, o.hi]) if (b > a0 && b < a1) st.push(b);
      st.sort(function (a, b) { return a - b; }); st.push(a1);
      PA.N(0, 1, 0).C(c, tone == null ? wornTone(s.at + u0, a0) : tone);
      for (let i = 0; i < st.length - 1; i++) {
        const A = st[i], Bb = st[i + 1];
        const ya = S.streetY(s, A) + 0.004, yb = S.streetY(s, Bb) + 0.004;
        const p0 = SP(s, A, u0), p1 = SP(s, A, u1), p2 = SP(s, Bb, u1), p3 = SP(s, Bb, u0);
        const a = PA.v(p0[0], ya, p0[1]), b = PA.v(p1[0], ya, p1[1]), cc = PA.v(p2[0], yb, p2[1]), d = PA.v(p3[0], yb, p3[1]);
        PA.q(a, b, cc, d);
      }
    }
    function wornTone(x, z) { return 0.82 + 0.18 * hsh(x, z, 5); }
    function dashes(s, a0, a1, u, period, len, w, c) {
      const k0 = Math.floor(a0 / period), k1 = Math.floor(a1 / period);
      for (let k = k0; k <= k1; k++) {
        const d0 = Math.max(a0, k * period), d1 = Math.min(a1, k * period + len);
        if (d1 - d0 > 0.3) paintAlong(s, d0, d1, u - w / 2, u + w / 2, c);
      }
    }

    // ---------- STRAIGHT STREET PIECE ----------
    function piece(d) {
      const s = d.pc.s, h = s.h, a0 = d.a0, a1 = d.a1;
      const buf = (s.k === "loc") ? RL : RA;
      const st = [a0];
      if (d.w0 && a1 - a0 > 5.5) st.push(a0 + 5);
      if (d.w1 && a1 - a0 > 5.5) st.push(a1 - 5);
      for (const o of s.ovs) {
        for (let a = Math.ceil(o.lo / 4) * 4; a < o.hi; a += 4) if (a > a0 && a < a1) st.push(a);
        const kink = Y.road / Y.deck * RAMP_LEN;             // where the linear ramp leaves the road level
        for (const b of [o.lo, o.lo + kink, o.b0, o.b1, o.hi - kink, o.hi]) if (b > a0 && b < a1) st.push(b);
      }
      st.push(a1);
      st.sort(function (p, q) { return p - q; });
      const U = [-h, -h + GUT, -h + 0.9, 0, h - 0.9, h - GUT, h];
      let prev = null;
      for (let i = 0; i < st.length; i++) {
        const a = st[i];
        if (prev && a - prev.a < 0.01) continue;
        const y = S.streetY(s, a);
        const dy = (S.streetY(s, a + 0.5) - S.streetY(s, a - 0.5));
        if (s.axis === "x") buf.N(0, 1, -dy); else buf.N(-dy, 1, 0);
        let w = 1;
        if (d.w0) w = Math.min(w, clamp((a - a0) / 5, 0, 1));
        if (d.w1) w = Math.min(w, clamp((a1 - a) / 5, 0, 1));
        const row = [];
        for (let k = 0; k < U.length; k++) {
          const u = U[k], p = SP(s, a, u);
          buf.L(u, h - Math.abs(u), w);
          row.push(buf.v(p[0], y, p[1], p[0] * 0.25, p[1] * 0.25));
        }
        if (prev) for (let k = 0; k < U.length - 1; k++) buf.q(prev.row[k], prev.row[k + 1], row[k + 1], row[k]);
        prev = { a: a, row: row };
      }
      // edges: gravel shoulder on a country road, an asphalt skirt elsewhere
      const elevated = s.ovs.some(function (o) { return o.lo < a1 && o.hi > a0; });
      if (s.k === "rural") {
        GR.K(GK.ballast).C(COL.gravel);
        for (let side = -1; side <= 1; side += 2) {
          GR.N(0, 1, 0);
          const p0 = SP(s, a0, side * h), p1 = SP(s, a1, side * h), p2 = SP(s, a1, side * (h + 1.6)), p3 = SP(s, a0, side * (h + 1.6));
          const A = GR.v(p0[0], Y.road - 0.004, p0[1]), Bv = GR.v(p1[0], Y.road - 0.004, p1[1]), C = GR.v(p2[0], 0.012, p2[1]), D = GR.v(p3[0], 0.012, p3[1]);
          GR.q(A, Bv, C, D);
        }
      } else if (!elevated) {
        for (let side = -1; side <= 1; side += 2) {
          if (s.axis === "x") buf.N(side, 0, 0); else buf.N(0, 0, side);
          const u = side * (h + 0.012);
          const p0 = SP(s, a0, u), p1 = SP(s, a1, u);
          buf.L(u, 0, 0);
          const A = buf.v(p0[0], Y.road, p0[1], p0[0] * 0.25, p0[1] * 0.25), Bv = buf.v(p1[0], Y.road, p1[1], p1[0] * 0.25, p1[1] * 0.25);
          const C = buf.v(p1[0], -0.12, p1[1], p1[0] * 0.25, p1[1] * 0.25 + 0.04), D = buf.v(p0[0], -0.12, p0[1], p0[0] * 0.25, p0[1] * 0.25 + 0.04);
          buf.q(A, Bv, C, D);
        }
      }
      // markings
      if (s.k === "art") {
        paintAlong(s, a0, a1, 0.1, 0.2, YELLOW); paintAlong(s, a0, a1, -0.2, -0.1, YELLOW);
        const lw = 3.6;
        if (s.lanes >= 2) { dashes(s, a0, a1, lw, 12, 3, 0.1, WHITE); dashes(s, a0, a1, -lw, 12, 3, 0.1, WHITE); }
        const eu = Math.min(h - 0.9, s.lanes * lw);
        paintAlong(s, a0, a1, eu, eu + 0.1, WHITE); paintAlong(s, a0, a1, -eu - 0.1, -eu, WHITE);
      } else if (s.k === "rural") {
        dashes(s, a0, a1, 0, 12, 3, 0.1, YELLOW);
        paintAlong(s, a0, a1, h - 0.35, h - 0.25, WHITE); paintAlong(s, a0, a1, -h + 0.25, -h + 0.35, WHITE);
      }
    }

    // ---------- JUNCTION NODE: rays from the kerb, rings at 0 / .45 / .9 ----------
    function node(d) {
      const n = d.n, buf = n.art ? RA : RL;
      const X = n.x, Z = n.z, HA = n.hA, HB = n.hB;
      const Q = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
      buf.N(0, 1, 0);
      for (let qi = 0; qi < 4; qi++) {
        const sx = Q[qi][0], sz = Q[qi][1];
        const qh = S.qHalf(n, sx, sz), hA = qh[0], hB = qh[1];
        const legX = sx > 0 ? n.legE : n.legW, legZ = sz > 0 ? n.legN : n.legS;
        const K = [], C = [];
        if (legX && legZ) {
          const r = Math.max(0, n.q[qi]);
          // kerb: B-side stub edge -> arc (or square corner) -> A-side stub edge
          const kp = [];
          kp.push([X + sx * (HA + RJ), Z + sz * hB]);
          if (r > 0) {
            const ax = X + sx * (hA + r), az = Z + sz * (hB + r);
            for (let k = 0; k < ALPHA.length; k++) { const al = ALPHA[k]; kp.push([ax - sx * r * Math.sin(al), az - sz * r * Math.cos(al)]); }
          } else kp.push([X + sx * hA, Z + sz * hB]);
          kp.push([X + sx * hA, Z + sz * (HB + RJ)]);
          // dedupe coincident first/last (r == RJ)
          const kk = [];
          for (const p of kp) if (!kk.length || Math.hypot(p[0] - kk[kk.length - 1][0], p[1] - kk[kk.length - 1][1]) > 1e-4) kk.push(p);
          // ray ends: first half of the kerb -> B centreline, second half -> A
          // centreline; a station at exactly half way owns the crossing point
          let sl = [0]; for (let i = 1; i < kk.length; i++) sl.push(sl[i - 1] + Math.hypot(kk[i][0] - kk[i - 1][0], kk[i][1] - kk[i - 1][1]));
          const tot = sl[sl.length - 1];
          if (!sl.some(function (v) { return Math.abs(v - tot / 2) < 1e-3; })) {
            let i = 0; while (sl[i + 1] < tot / 2) i++;
            const t = (tot / 2 - sl[i]) / (sl[i + 1] - sl[i]);
            kk.splice(i + 1, 0, [kk[i][0] + (kk[i + 1][0] - kk[i][0]) * t, kk[i][1] + (kk[i + 1][1] - kk[i][1]) * t]);
            sl.splice(i + 1, 0, tot / 2);
          }
          for (let i = 0; i < kk.length; i++) {
            const t = sl[i] / tot;
            K.push(kk[i]);
            if (t <= 0.5) C.push([X + sx * (HA + RJ) * (1 - t * 2), Z]);
            else C.push([X, Z + sz * (HB + RJ) * (t * 2 - 1)]);
          }
        } else if (legZ) {
          K.push([X + sx * hA, Z]); K.push([X + sx * hA, Z + sz * (HB + RJ)]);
          C.push([X, Z]); C.push([X, Z + sz * (HB + RJ)]);
        } else if (legX) {
          K.push([X + sx * (HA + RJ), Z + sz * hB]); K.push([X, Z + sz * hB]);
          C.push([X + sx * (HA + RJ), Z]); C.push([X, Z]);
        } else {
          K.push([X + sx * hA, Z]); K.push([X + sx * hA, Z + sz * hB]); K.push([X, Z + sz * hB]);
          C.push([X, Z]); C.push([X, Z]); C.push([X, Z]);
        }
        let prev = null;
        for (let i = 0; i < K.length; i++) {
          const kx = K[i][0], kz = K[i][1], cx = C[i][0], cz = C[i][1];
          const L = Math.hypot(cx - kx, cz - kz);
          const col = [];
          const es = [0, Math.min(GUT, L * 0.3), Math.min(0.9, L * 0.6), L];
          for (const e of es) {
            const t = L > 1e-6 ? e / L : 0;
            const x = kx + (cx - kx) * t, z = kz + (cz - kz) * t;
            buf.L(0, e, 0);
            col.push(buf.v(x, Y.road, z, x * 0.25, z * 0.25));
          }
          if (prev) for (let m = 0; m < col.length - 1; m++) buf.q(prev[m], prev[m + 1], col[m + 1], col[m]);
          prev = col;
        }
      }
      // markings: crosswalks + stop bars on each leg
      if (!n.cross) return;
      const legs = [["N", 0, 1], ["S", 0, -1], ["E", 1, 1], ["W", 1, -1]];
      for (const lg of legs) {
        if (!n["leg" + lg[0]]) continue;
        const horiz = lg[1] === 1, sg = lg[2];
        const hl = lg[0] === "N" ? n.hN : lg[0] === "S" ? n.hS : lg[0] === "E" ? n.hE : n.hW;   // this leg's half width
        const hc = horiz ? HA : HB;                                                              // the crossing's
        const pt = function (along, lat) { return horiz ? [X + sg * along, Z + lat] : [X + lat, Z + sg * along]; };
        const d0 = hc + 0.6, d1 = hc + 0.6 + 3.0;
        const nb = Math.floor((2 * hl - 1.2) / 1.1);
        const start = -((nb - 1) * 1.1) / 2;
        for (let k = 0; k < nb; k++) {
          const c = start + k * 1.1;
          paintQuad(pt(d0, c - 0.25), pt(d1, c - 0.25), pt(d1, c + 0.25), pt(d0, c + 0.25), Y.road + 0.004, WHITE, wornTone(X + k, Z + sg));
        }
        // stop bar on the approach side (right-hand traffic: CBZ.roadLaneSideAxis)
        const side = horiz ? -sg : sg;
        const l0 = side * 0.25, l1 = side * (hl - 0.35);
        paintQuad(pt(d1 + 1.2, Math.min(l0, l1)), pt(d1 + 1.7, Math.min(l0, l1)), pt(d1 + 1.7, Math.max(l0, l1)), pt(d1 + 1.2, Math.max(l0, l1)), Y.road + 0.004, WHITE, 0.92);
      }
    }

    // ---------- PERIMETER (block / pad) ----------
    // stations round a rect with per-corner radii: {x,z, ox,oz (inward
    // offset), fx,fz (outward face), s, e (edge index or -1)}
    function perimeter(r, inserts) {
      const cs = [[r.x0, r.z0, 1, 1], [r.x1, r.z0, -1, 1], [r.x1, r.z1, -1, -1], [r.x0, r.z1, 1, -1]];
      const nIn = [[1, 0], [0, 1], [-1, 0], [0, -1]];    // inward normal of the edge ARRIVING at corner q
      const nOut = [[0, 1], [-1, 0], [0, -1], [1, 0]];   // ... and of the edge LEAVING it
      const out = [];
      for (let q = 0; q < 4; q++) {
        const cx = cs[q][0], cz = cs[q][1], dx = cs[q][2], dz = cs[q][3], rr = r.cr[q];
        const ni = nIn[q], no = nOut[q];
        if (rr > 0) {
          const ax = cx + dx * rr, az = cz + dz * rr;
          for (let k = 0; k < ALPHA.length; k++) {
            const t = ALPHA[k];
            const nx = ni[0] * Math.cos(t) + no[0] * Math.sin(t), nz = ni[1] * Math.cos(t) + no[1] * Math.sin(t);
            out.push({ x: ax - rr * nx, z: az - rr * nz, ox: nx, oz: nz, fx: -nx, fz: -nz, e: -1 });
          }
        } else {
          const mx = ni[0] + no[0], mz = ni[1] + no[1];
          out.push({ x: cx, z: cz, ox: mx, oz: mz, fx: -ni[0], fz: -ni[1], e: -1 });
          out.push({ x: cx, z: cz, ox: mx, oz: mz, fx: -no[0], fz: -no[1], e: -1 });
        }
        // the edge leaving corner q: extra stations
        const ins = inserts && inserts[q];
        if (ins && ins.length) {
          const ne = no;
          for (const v of ins) {
            const x = q === 0 || q === 2 ? v : (q === 1 ? r.x1 : r.x0);
            const z = q === 0 || q === 2 ? (q === 0 ? r.z0 : r.z1) : v;
            out.push({ x: x, z: z, ox: ne[0], oz: ne[1], fx: -ne[0], fz: -ne[1], e: q });
          }
        }
      }
      let s = 0;
      for (let i = 0; i < out.length; i++) {
        if (i > 0) s += Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z);
        out[i].s = s;
      }
      return out;
    }
    // kerb face + granite top + footway band [KT, sw], back edge down to yIn
    function kerbRing(st, sw, yIn, skip, tone) {
      const n = st.length;
      const kf = [], kt = [], fw = [];
      for (let i = 0; i < n; i++) {
        const p = st[i];
        KE.N(p.fx, 0, p.fz).T(0.86);
        const f0 = KE.v(p.x, KB, p.z, p.s / 4, 0.0), f1 = KE.v(p.x, Y.walk, p.z, p.s / 4, 0.5);
        KE.N(0, 1, 0).T(1);
        const t0 = KE.v(p.x, Y.walk, p.z, p.s / 4, 0.53), t1 = KE.v(p.x + p.ox * KT, Y.walk, p.z + p.oz * KT, p.s / 4, 0.98);
        kf.push([f0, f1]); kt.push([t0, t1]);
        FO.N(0, 1, 0).T(tone * (0.93 + 0.07 * hsh(p.x, p.z, 3)));
        const back = Math.max(KT + 0.2, sw - 0.35);
        fw.push([
          FO.v(p.x + p.ox * KT, Y.walk, p.z + p.oz * KT, p.s / 6, 0),
          FO.v(p.x + p.ox * back, Y.walk, p.z + p.oz * back, p.s / 6, (back - KT) / (sw - KT)),
          FO.v(p.x + p.ox * sw, yIn, p.z + p.oz * sw, p.s / 6, 1),
        ]);
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (skip && skip(st[i], st[j])) continue;
        KE.q(kf[i][0], kf[j][0], kf[j][1], kf[i][1]);
        KE.q(kt[i][0], kt[j][0], kt[j][1], kt[i][1]);
        FO.q(fw[i][0], fw[j][0], fw[j][1], fw[i][1]);
        FO.q(fw[i][1], fw[j][1], fw[j][2], fw[i][2]);
      }
    }
    function fanInner(st, sw, buf, y, uvf, centre) {
      const cx = centre[0], cz = centre[1];
      const c = buf.v(cx, y, cz, uvf ? uvf(cx, cz)[0] : 0, uvf ? uvf(cx, cz)[1] : 0);
      const ids = [];
      for (const p of st) {
        const x = p.x + p.ox * sw, z = p.z + p.oz * sw;
        const uv = uvf ? uvf(x, z) : [0, 0];
        ids.push(buf.v(x, y, z, uv[0], uv[1]));
      }
      for (let i = 0; i < ids.length; i++) buf.t(c, ids[i], ids[(i + 1) % ids.length]);
    }
    const worldUV = function (x, z) { return [x / 6, z / 1.5]; };
    const roadUV = function (x, z) { return [x * 0.25, z * 0.25]; };

    // ---------- BLOCK ----------
    function block(d) {
      const b = d.b;
      const st = perimeter(b, null);
      const tone = b.use === "cbd" ? 1.0 : b.use === "industrial" ? 0.9 : 0.96;
      const yIn = b.plaza ? Y.walk : Y.lot;
      kerbRing(st, b.sw, yIn, null, tone);
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      if (b.plaza) { FO.N(0, 1, 0).T(0.97); fanInner(st, b.sw, FO, Y.walk, worldUV, [cx, cz]); return; }
      if (b.use === "industrial" || b.lotAll) {
        RA.N(0, 1, 0).L(0, 99, 0); fanInner(st, b.sw, RA, Y.lot, roadUV, [cx, cz]);
        if (b.lotAll) stalls({ x0: b.x0 + b.sw + 0.3, x1: b.x1 - b.sw - 0.3, z0: b.z0 + b.sw + 0.3, z1: b.z1 - b.sw - 0.3 }, Y.lot);
        return;
      }
      if (b.use === "cbd" || b.use === "midtown") { GR.N(0, 1, 0).K(GK.paving).C(COL.paving); fanInner(st, b.sw, GR, Y.lot, null, [cx, cz]); return; }
      GR.N(0, 1, 0).K(GK.lawn, hsh(cx, cz, 9) < 0.5 ? 0 : 1).C(b.use === "rows" ? COL.lawn : COL.lawnDry);
      fanInner(st, b.sw, GR, Y.lot, null, [cx, cz]);
      if (b.use === "rows") {
        // stoops + front paths: a paved strip along the two long faces
        const alongX = (b.x1 - b.x0) >= (b.z1 - b.z0);
        FO.N(0, 1, 0).T(0.9);
        for (const side of [0, 1]) {
          const i0 = b.sw, i1 = b.sw + 1.5;
          let q;
          if (alongX) {
            const z0 = side ? b.z1 - i1 : b.z0 + i0, z1 = side ? b.z1 - i0 : b.z0 + i1;
            q = [[b.x0 + b.sw + 2, z0], [b.x1 - b.sw - 2, z0], [b.x1 - b.sw - 2, z1], [b.x0 + b.sw + 2, z1]];
          } else {
            const x0 = side ? b.x1 - i1 : b.x0 + i0, x1 = side ? b.x1 - i0 : b.x0 + i1;
            q = [[x0, b.z0 + b.sw + 2], [x1, b.z0 + b.sw + 2], [x1, b.z1 - b.sw - 2], [x0, b.z1 - b.sw - 2]];
          }
          const ids = q.map(function (p) { return FO.v(p[0], Y.lot + 0.012, p[1], p[0] / 6, p[1] / 1.5); });
          FO.q(ids[0], ids[1], ids[2], ids[3]);
        }
      }
    }

    // ---------- PAD: ring (gapped at mouths and exclusions) + lawn ----------
    function pad(d) {
      const p = d.p;
      const inserts = [[], [], [], []];
      const gaps = [[], [], [], []];
      const eIdx = { z0: 0, x1: 1, z1: 2, x0: 3 };
      for (const m of p.mouths) {
        const q = eIdx[m.edge];
        gaps[q].push([m.c - m.g, m.c + m.g]);
        inserts[q].push(m.c - m.g, m.c + m.g);
      }
      if (p.cut) for (let q = 0; q < 4; q++) {
        const a0 = (q === 0 || q === 2) ? p.x0 : p.z0, a1 = (q === 0 || q === 2) ? p.x1 : p.z1;
        for (let a = a0 + 8; a < a1 - 8; a += 8) inserts[q].push(a);
      }
      for (let q = 0; q < 4; q++) {
        const a0 = (q === 0 || q === 2) ? p.x0 : p.z0, a1 = (q === 0 || q === 2) ? p.x1 : p.z1;
        const c0 = q === 0 ? p.cr[0] : q === 1 ? p.cr[1] : q === 2 ? p.cr[3] : p.cr[0];
        const c1 = q === 0 ? p.cr[1] : q === 1 ? p.cr[2] : q === 2 ? p.cr[2] : p.cr[3];
        let list = inserts[q].filter(function (v) { return v > a0 + Math.max(c0, 0.5) + 0.05 && v < a1 - Math.max(c1, 0.5) - 0.05; });
        list = Array.from(new Set(list.map(function (v) { return Math.round(v * 1000) / 1000; }))).sort(function (a, b) { return a - b; });
        if (q === 2 || q === 3) list.reverse();       // edges 2 (z1, -x) and 3 (x0, -z) run backwards
        inserts[q] = list;
      }
      const st = perimeter(p, inserts);
      const skip = function (a, b) {
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        const e = a.e >= 0 ? a.e : b.e;
        if (e >= 0) {
          const along = (e === 0 || e === 2) ? mx : mz;
          for (const g of gaps[e]) if (along > g[0] && along < g[1]) return true;
        }
        if (p.cut && (S.inExcl(mx, mz) || S.inRailBand(mx, mz, 0) || (P.river && P.riverDist(mx, mz) < P.river.half + BANK))) return true;
        return false;
      };
      kerbRing(st, PAD_SW, Y.lawn, skip, 0.95);
      // lawn
      const lawnCol = p.use === "park" ? COL.lawnPark : COL.lawn;
      GR.N(0, 1, 0).K(GK.lawn, p.use === "park" || p.use === "campus" || p.use === "stadium" ? 0 : 255).C(lawnCol);
      if (!p.cut) { fanInner(st, PAD_SW, GR, Y.lawn, null, [(p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2]); return; }
      lawnStrips(p);
    }
    function dryIntervals(p, z, x0, x1) {
      // x-intervals of [x0,x1] at row z that are not excluded
      const cuts = [];
      for (const r of S.excl) if (z >= r.minZ && z <= r.maxZ) cuts.push([r.minX, r.maxX]);
      for (const r of P.rail || []) if (r.axis === "z" && z > r.a0 && z < r.a1) cuts.push([r.at - r.half, r.at + r.half]);
      if (P.river) {
        const H = P.river.half + BANK;
        let inW = false, w0 = 0;
        const step = 4;
        const isW = function (x) { return P.riverDist(x, z) < H; };
        for (let x = x0; x <= x1 + 0.01; x += step) {
          const w = isW(x);
          if (w && !inW) { inW = true; w0 = refine(isW, x - step, x); }
          if (!w && inW) { inW = false; cuts.push([w0, refine(function (q) { return !isW(q); }, x - step, x)]); }
        }
        if (inW) cuts.push([w0, x1]);
      }
      cuts.sort(function (a, b) { return a[0] - b[0]; });
      const out = []; let a = x0;
      for (const c of cuts) { if (c[1] <= a) continue; if (c[0] > a + 0.5) out.push([a, Math.min(c[0], x1)]); a = Math.max(a, c[1]); if (a >= x1) break; }
      if (x1 > a + 0.5) out.push([a, x1]);
      return out;
    }
    function refine(test, lo, hi) {
      // first point in (lo, hi] where test() is true (bisection, 5 steps)
      for (let i = 0; i < 5; i++) { const m = (lo + hi) / 2; if (test(m)) hi = m; else lo = m; }
      return (lo + hi) / 2;
    }
    function lawnStrips(p) {
      const x0 = p.x0 + PAD_SW, x1 = p.x1 - PAD_SW, z0 = p.z0 + PAD_SW, z1 = p.z1 - PAD_SW;
      const zs = [];
      for (let z = z0; z < z1; z += 8) zs.push(z);
      zs.push(z1);
      for (const r of S.excl) { if (r.minZ > z0 && r.minZ < z1) zs.push(r.minZ); if (r.maxZ > z0 && r.maxZ < z1) zs.push(r.maxZ); }
      for (const r of P.rail || []) if (r.axis === "x") for (const e of [r.at - r.half, r.at + r.half]) if (e > z0 && e < z1) zs.push(e);
      zs.sort(function (a, b) { return a - b; });
      for (let i = 0; i < zs.length - 1; i++) {
        const za = zs[i], zb = zs[i + 1];
        if (zb - za < 0.05) continue;
        const zm = (za + zb) / 2;
        let railRow = false;
        for (const r of P.rail || []) if (r.axis === "x" && Math.abs(zm - r.at) < r.half) railRow = true;
        if (railRow) continue;
        const ia = dryIntervals(p, za + 0.01, x0, x1), ib = dryIntervals(p, zb - 0.01, x0, x1);
        if (ia.length === ib.length) {
          for (let k = 0; k < ia.length; k++) {
            const A = GR.v(ia[k][0], Y.lawn, za), Bv = GR.v(ia[k][1], Y.lawn, za), C = GR.v(ib[k][1], Y.lawn, zb), D = GR.v(ib[k][0], Y.lawn, zb);
            GR.q(A, Bv, C, D);
          }
        } else {
          for (const iv of dryIntervals(p, zm, x0, x1)) {
            const A = GR.v(iv[0], Y.lawn, za), Bv = GR.v(iv[1], Y.lawn, za), C = GR.v(iv[1], Y.lawn, zb), D = GR.v(iv[0], Y.lawn, zb);
            GR.q(A, Bv, C, D);
          }
        }
      }
    }

    // ---------- RIBBON (pad street) ----------
    function rib(d) {
      const r = d.r, pad = r.pad, h = r.h, pts = r.pts, n = pts.length, closed = r.closed;
      // station normals (mitred)
      const nx = [], nz = [], ss = [], ys = [], ge = [];
      for (let i = 0; i < n; i++) {
        const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
        let tx = b.x - a.x, tz = b.z - a.z; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
        let mx = -tz, mz = tx;
        // mitre scale from the two adjacent segments
        if (i > 0 && i < n - 1 || closed) {
          const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
          let ax = p1.x - p0.x, az = p1.z - p0.z; const la = Math.hypot(ax, az) || 1; ax /= la; az /= la;
          const dot = (-az) * mx + ax * mz;
          const k = 1 / Math.max(0.5, dot);
          mx *= k; mz *= k;
        }
        nx.push(mx); nz.push(mz);
        ss.push(r.s[i] != null ? r.s[i] : 0);
        const e = Math.min(pts[i].x - pad.x0, pad.x1 - pts[i].x, pts[i].z - pad.z0, pad.z1 - pts[i].z);
        ge.push(e);
        ys.push(e < PAD_SW ? Y.road + (Y.padRoad - Y.road) * clamp(e / PAD_SW, 0, 1) : Y.padRoad);
      }
      const U = [-h, -h + GUT, -h + 0.9, 0, h - 0.9, h - GUT, h];
      const rows = [];
      RL.N(0, 1, 0);
      for (let i = 0; i < n; i++) {
        const row = [];
        for (const u of U) {
          const x = pts[i].x + nx[i] * u, z = pts[i].z + nz[i] * u;
          RL.L(u, h - Math.abs(u), 1);
          row.push(RL.v(x, ys[i], z, x * 0.25, z * 0.25));
        }
        rows.push(row);
      }
      const segs = closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % n;
        for (let k = 0; k < U.length - 1; k++) RL.q(rows[i][k], rows[i][k + 1], rows[j][k + 1], rows[j][k]);
      }
      // rolled kerbs (+ collector sidewalks), gapped at tees and inside the ramp
      const gapped = function (i, side) {
        if (ge[i] < PAD_SW - 0.01) return true;
        const s = ss[i];
        for (const g of r.gaps) if ((g.all || g.side === side) && s > g.s0 && s < g.s1) return true;
        return false;
      };
      for (let side = -1; side <= 1; side += 2) {
        const kr = [], sw = [], ap = [], swBad = [];
        for (let i = 0; i < n; i++) {
          const px = pts[i].x, pz = pts[i].z, mx = nx[i] * side, mz = nz[i] * side;
          KE.N(mx * 0.25, 1, mz * 0.25).T(0.97);
          kr.push([KE.v(px + mx * h, ys[i], pz + mz * h, ss[i] / 4, 0.55), KE.v(px + mx * (h + 0.3), ys[i] + 0.025, pz + mz * (h + 0.3), ss[i] / 4, 0.78),
                   KE.v(px + mx * (h + ROLL), Y.lawn + 0.006, pz + mz * (h + ROLL), ss[i] / 4, 0.98)]);
          if (r.k === "col") {
            FO.N(0, 1, 0).T(0.94);
            const ox = px + mx * (h + 3.6), oz = pz + mz * (h + 3.6);
            swBad[i] = !!S.inExcl(ox, oz) || !!S.inRailBand(ox, oz, 0) || (P.river ? P.riverDist(ox, oz) < P.river.half + BANK : false);
            sw.push([FO.v(px + mx * (h + 2.1), Y.side, pz + mz * (h + 2.1), ss[i] / 6, 0), FO.v(px + mx * (h + 3.6), Y.side, pz + mz * (h + 3.6), ss[i] / 6, 1)]);
          }
          if (ge[i] <= PAD_SW + 0.01) {
            // the dropped kerb where the street ramps over the pad's footway:
            // a flat concrete apron to the ring's cut, and its cheek
            KE.N(0, 1, 0).T(0.92);
            const a0 = KE.v(px + mx * h, ys[i], pz + mz * h, ss[i] / 4, 0.6), a1 = KE.v(px + mx * (h + ROLL), ys[i], pz + mz * (h + ROLL), ss[i] / 4, 0.95);
            KE.N(mx, 0, mz).T(0.86);
            const c0 = KE.v(px + mx * (h + ROLL), ys[i] - 0.02, pz + mz * (h + ROLL), ss[i] / 4, 0.05), c1 = KE.v(px + mx * (h + ROLL), Y.walk, pz + mz * (h + ROLL), ss[i] / 4, 0.5);
            ap[i] = [a0, a1, c0, c1];
          }
        }
        for (let i = 0; i < segs; i++) {
          const j = (i + 1) % n;
          if (ap[i] && ap[j]) { KE.q(ap[i][0], ap[j][0], ap[j][1], ap[i][1]); KE.q(ap[i][2], ap[j][2], ap[j][3], ap[i][3]); }
          if (gapped(i, side) || gapped(j, side)) continue;
          KE.q(kr[i][0], kr[j][0], kr[j][1], kr[i][1]); KE.q(kr[i][1], kr[j][1], kr[j][2], kr[i][2]);
          if (sw.length && ge[i] > PAD_SW + 3.6 && ge[j] > PAD_SW + 3.6 && !swBad[i] && !swBad[j]) FO.q(sw[i][0], sw[j][0], sw[j][1], sw[i][1]);
        }
      }
      // centre line on collectors: dashed yellow by arclength
      if (r.k === "col") {
        PA.C(YELLOW, 0.9).N(0, 1, 0);
        for (let i = 0; i < segs; i++) {
          const j = (i + 1) % n;
          const s0 = ss[i], s1 = (j === 0 && closed) ? ss[i] + Math.hypot(pts[0].x - pts[i].x, pts[0].z - pts[i].z) : ss[j];
          if (s1 - s0 < 0.05) continue;
          for (let k = Math.floor(s0 / 12); k <= Math.floor(s1 / 12); k++) {
            const d0 = Math.max(s0, k * 12), d1 = Math.min(s1, k * 12 + 3);
            if (d1 - d0 < 0.2) continue;
            const t0 = (d0 - s0) / (s1 - s0), t1 = (d1 - s0) / (s1 - s0);
            const ax = lerp(pts[i].x, pts[j].x, t0), az = lerp(pts[i].z, pts[j].z, t0), bx = lerp(pts[i].x, pts[j].x, t1), bz = lerp(pts[i].z, pts[j].z, t1);
            const ya = lerp(ys[i], ys[j], t0) + 0.004, yb = lerp(ys[i], ys[j], t1) + 0.004;
            const tx = bx - ax, tz = bz - az, L = Math.hypot(tx, tz) || 1, qx = -tz / L * 0.06, qz = tx / L * 0.06;
            const A = PA.v(ax - qx, ya, az - qz), Bv = PA.v(ax + qx, ya, az + qz), C = PA.v(bx + qx, yb, bz + qz), D = PA.v(bx - qx, yb, bz - qz);
            PA.q(A, Bv, C, D);
          }
        }
      }
    }
    // ---------- BULB (cul-de-sac turning circle) ----------
    function bulb(d) {
      const b = d.b, r = b.r;
      const th0 = b.th + b.ph, th1 = b.th + Math.PI * 2 - b.ph;
      const nSeg = Math.max(8, Math.ceil((th1 - th0) / (Math.PI / 12)));
      RL.N(0, 1, 0);
      RL.L(0, r, 0);
      const c = RL.v(b.x, Y.padRoad, b.z, b.x * 0.25, b.z * 0.25);
      let prev = null, first = null, last = null;
      const kr = [];
      for (let k = 0; k <= nSeg; k++) {
        const t = th0 + (th1 - th0) * k / nSeg, ux = Math.cos(t), uz = Math.sin(t);
        const col = [];
        for (const e of [0, GUT, 0.9]) {
          const x = b.x + ux * (r - e), z = b.z + uz * (r - e);
          RL.L(0, e, 0);
          col.push(RL.v(x, Y.padRoad, z, x * 0.25, z * 0.25));
        }
        if (prev) { RL.q(prev[0], col[0], col[1], prev[1]); RL.q(prev[1], col[1], col[2], prev[2]); RL.t(c, prev[2], col[2]); }
        if (!first) first = col;
        prev = col; last = col;
        KE.N(ux * 0.25, 1, uz * 0.25).T(0.97);
        kr.push([KE.v(b.x + ux * r, Y.padRoad, b.z + uz * r, t * r / 4, 0.55), KE.v(b.x + ux * (r + 0.3), Y.padRoad + 0.025, b.z + uz * (r + 0.3), t * r / 4, 0.78),
                 KE.v(b.x + ux * (r + ROLL), Y.lawn + 0.006, b.z + uz * (r + ROLL), t * r / 4, 0.98)]);
      }
      for (let k = 0; k < kr.length - 1; k++) { KE.q(kr[k][0], kr[k + 1][0], kr[k + 1][1], kr[k][1]); KE.q(kr[k][1], kr[k + 1][1], kr[k + 1][2], kr[k][2]); }
      // the chord the cul-de-sac enters through: centre, the two ends, the mid (e = h)
      const mx = b.x + Math.cos(b.th) * r * Math.cos(b.ph), mz = b.z + Math.sin(b.th) * r * Math.cos(b.ph);
      RL.L(0, b.h, 0);
      const m = RL.v(mx, Y.padRoad, mz, mx * 0.25, mz * 0.25);
      RL.t(c, last[2], last[0]); RL.t(c, last[0], m); RL.t(c, m, first[0]); RL.t(c, first[0], first[2]);
    }

    // ---------- OVERPASS: retained ramps, deck, piers ----------
    function ovp(d) {
      const ov = d.ov, s = ov.s, h = s.h;
      ST.K(GK.concrete).C(COL.concrete);
      // side walls: outer face (ground -> parapet top), parapet top, inner face
      for (let side = -1; side <= 1; side += 2) {
        const st = [];
        for (let a = ov.lo; a < ov.hi; a += 4) st.push(a);
        st.push(ov.hi);
        for (const b of [ov.b0, ov.b1]) st.push(b);
        for (const g of ov.slipGaps) if (g[2] === side) st.push(g[0], g[1]);
        st.sort(function (p, q) { return p - q; });
        const uo = side * (h + 0.03), ui = side * (h - PAR_W);
        let prev = null;
        for (const a of st) {
          if (prev && a - prev.a < 0.01) continue;
          const y = S.streetY(s, a);
          const onDeck = a >= ov.b0 - 0.01 && a <= ov.b1 + 0.01;
          const yb = onDeck ? Y.deck - Y.deckDepth : -0.2;
          const po = SP(s, a, uo), pi = SP(s, a, ui);
          if (s.axis === "x") ST.N(side, 0, 0); else ST.N(0, 0, side);
          const o0 = ST.v(po[0], yb, po[1]), o1 = ST.v(po[0], y + PAR_H, po[1]);
          ST.N(0, 1, 0);
          const t0 = ST.v(po[0], y + PAR_H, po[1]), t1 = ST.v(pi[0], y + PAR_H, pi[1]);
          if (s.axis === "x") ST.N(-side, 0, 0); else ST.N(0, 0, -side);
          const i0 = ST.v(pi[0], y + PAR_H, pi[1]), i1 = ST.v(pi[0], y - 0.02, pi[1]);
          const cur = { a: a, y: y, o: [o0, o1], t: [t0, t1], i: [i0, i1] };
          if (prev) {
            const m = (prev.a + a) / 2;
            const low = Math.max(prev.y, y) < 0.25;
            if (!low && !S.gapHit(ov, side, prev.a + 0.01, a - 0.01)) {
              ST.q(prev.o[0], cur.o[0], cur.o[1], prev.o[1]);
              ST.q(prev.t[0], cur.t[0], cur.t[1], prev.t[1]);
              ST.q(prev.i[0], cur.i[0], cur.i[1], prev.i[1]);
            } else if (!low && m > ov.b0 && m < ov.b1) {
              // under a slip-ramp join the deck still has its fascia
              ST.q(prev.o[0], cur.o[0], cur.i[1], prev.i[1]);
            }
          }
          prev = cur;
        }
      }
      // abutments (the embankment ends under the deck) + soffit + piers
      const ys = Y.deck - Y.deckDepth;
      for (const e of [[ov.b0, -1], [ov.b1, 1]]) {
        const a = e[0];
        const p0 = SP(s, a, -h), p1 = SP(s, a, h);
        if (s.axis === "x") ST.N(0, 0, e[1]); else ST.N(e[1], 0, 0);
        const A = ST.v(p0[0], -0.2, p0[1]), Bv = ST.v(p1[0], -0.2, p1[1]), C = ST.v(p1[0], ys, p1[1]), D = ST.v(p0[0], ys, p0[1]);
        ST.q(A, Bv, C, D);
      }
      ST.N(0, -1, 0).C(COL.concreteDark);
      {
        const p0 = SP(s, ov.b0, -h - 0.03), p1 = SP(s, ov.b0, h + 0.03), p2 = SP(s, ov.b1, h + 0.03), p3 = SP(s, ov.b1, -h - 0.03);
        const A = ST.v(p0[0], ys, p0[1]), Bv = ST.v(p1[0], ys, p1[1]), C = ST.v(p2[0], ys, p2[1]), D = ST.v(p3[0], ys, p3[1]);
        ST.q(A, Bv, C, D);
        // girders under the slab
        for (const u of [-h + 2.5, -h / 3, h / 3, h - 2.5]) {
          const q0 = SP(s, ov.b0, u), q1 = SP(s, ov.b1, u);
          ST.beam(q0[0], ys - 0.45, q0[1], q1[0], ys - 0.45, q1[1], 0.7, 0.9);
        }
      }
      ST.C(COL.concrete);
      for (let e = -1; e <= 1; e += 2) {
        const a = ov.fwAt + e * (ov.half + 2.2);
        for (const u of [-h + 3, 0, h - 3]) {
          const p = SP(s, a, u);
          ST.box(p[0] - 0.55, p[0] + 0.55, -0.2, ys - 1.0, p[1] - 0.55, p[1] + 0.55, true);
        }
        const c0 = SP(s, a - 0.7, -h + 1), c1 = SP(s, a + 0.7, h - 1);
        ST.box(Math.min(c0[0], c1[0]), Math.max(c0[0], c1[0]), ys - 1.0, ys - 0.9 + 0.0, Math.min(c0[1], c1[1]), Math.max(c0[1], c1[1]), false);
      }
    }

    // ---------- SLIP RAMP ----------
    function slip(d) {
      const sl = d.sl;
      const pt = function (F, R) { return sl.fwAxis === "x" ? [F, R] : [R, F]; };
      const Fc = (sl.F0 + sl.F1) / 2, hw = (sl.F1 - sl.F0) / 2;
      const total = sl.plateau + sl.L + sl.merge;
      const U = [-hw, -hw + GUT, -hw + 0.9, 0, hw - 0.9, hw - GUT, hw];
      let prev = null;
      const wallRows = [];
      for (let dd = 0; dd < total + 2.99; dd += 3) {
        const R = sl.R0 + sl.sz * Math.min(dd, total);
        const row = [];
        RA.N(0, 1, 0);
        for (const u of U) {
          const F = Fc + u, p = pt(F, R), y = S.slipY(sl, F, R);
          RA.L(u, hw - Math.abs(u), 1);
          row.push(RA.v(p[0], y, p[1], p[0] * 0.25, p[1] * 0.25));
        }
        if (prev) for (let k = 0; k < U.length - 1; k++) RA.q(prev[k], prev[k + 1], row[k + 1], row[k]);
        prev = row;
        wallRows.push(R);
      }
      // merge apron to the freeway shoulder
      {
        const Fa = sl.fw + sl.sx * sl.half, Fb = sl.Fin;
        const Ra = sl.R0 + sl.sz * (sl.plateau + sl.L - 6), Rb = sl.R0 + sl.sz * total;
        const y = Y.fw + 0.004;
        RA.N(0, 1, 0).L(0, 99, 0);
        const p0 = pt(Fa, Ra), p1 = pt(Fb, Ra), p2 = pt(Fb, Rb), p3 = pt(Fa, Rb);
        const A = RA.v(p0[0], y, p0[1], p0[0] * 0.25, p0[1] * 0.25), Bv = RA.v(p1[0], y, p1[1], p1[0] * 0.25, p1[1] * 0.25);
        const C = RA.v(p2[0], y, p2[1], p2[0] * 0.25, p2[1] * 0.25), D = RA.v(p3[0], y, p3[1], p3[0] * 0.25, p3[1] * 0.25);
        RA.q(A, Bv, C, D);
      }
      // walls + parapets both sides, edge lines
      ST.K(GK.concrete).C(COL.concrete);
      for (const Fw of [sl.F0, sl.F1]) {
        const out = Fw === sl.F0 ? -1 : 1;
        let pv = null;
        for (const R of wallRows) {
          const y = S.slipY(sl, Fw, R);
          const po = pt(Fw + out * 0.03, R), pi = pt(Fw - out * PAR_W, R);
          if (sl.fwAxis === "x") ST.N(out, 0, 0); else ST.N(0, 0, out);
          const o0 = ST.v(po[0], -0.2, po[1]), o1 = ST.v(po[0], y + PAR_H, po[1]);
          ST.N(0, 1, 0);
          const t0 = ST.v(po[0], y + PAR_H, po[1]), t1 = ST.v(pi[0], y + PAR_H, pi[1]);
          if (sl.fwAxis === "x") ST.N(-out, 0, 0); else ST.N(0, 0, -out);
          const i0 = ST.v(pi[0], y + PAR_H, pi[1]), i1 = ST.v(pi[0], y - 0.02, pi[1]);
          const cur = { y: y, o: [o0, o1], t: [t0, t1], i: [i0, i1] };
          if (pv && Math.max(pv.y, y) > 0.3) {
            ST.q(pv.o[0], cur.o[0], cur.o[1], pv.o[1]); ST.q(pv.t[0], cur.t[0], cur.t[1], pv.t[1]); ST.q(pv.i[0], cur.i[0], cur.i[1], pv.i[1]);
          }
          pv = cur;
        }
      }
      PA.N(0, 1, 0).C(WHITE, 0.9);
      for (const u of [-hw + 0.55, hw - 0.65]) {
        for (let i = 0; i < wallRows.length - 1; i++) {
          const Ra = wallRows[i], Rb = wallRows[i + 1];
          const p0 = pt(Fc + u, Ra), p1 = pt(Fc + u + 0.1, Ra), p2 = pt(Fc + u + 0.1, Rb), p3 = pt(Fc + u, Rb);
          const ya = S.slipY(sl, Fc + u, Ra) + 0.005, yb = S.slipY(sl, Fc + u, Rb) + 0.005;
          PA.q(PA.v(p0[0], ya, p0[1]), PA.v(p1[0], ya, p1[1]), PA.v(p2[0], yb, p2[1]), PA.v(p3[0], yb, p3[1]));
        }
      }
    }

    // ---------- ROAD BRIDGE: walks, kerbs, fascia, parapets, piers ----------
    function bridge(d) {
      const br = d.br, s = br.s, h = s.h;
      for (const run of br.runs) {
        const sd = run.side, a0 = run.a0, a1 = run.a1;
        const uK = sd * h, uW = sd * (h + br.walk);
        // kerb face + top, walk
        const pk0 = SP(s, a0, uK), pk1 = SP(s, a1, uK);
        if (s.axis === "x") KE.N(-sd, 0, 0); else KE.N(0, 0, -sd);
        KE.T(0.86);
        KE.q(KE.v(pk0[0], KB, pk0[1], a0 / 4, 0), KE.v(pk1[0], KB, pk1[1], a1 / 4, 0), KE.v(pk1[0], Y.walk, pk1[1], a1 / 4, 0.5), KE.v(pk0[0], Y.walk, pk0[1], a0 / 4, 0.5));
        KE.N(0, 1, 0).T(1);
        const pt0 = SP(s, a0, uK + sd * KT), pt1 = SP(s, a1, uK + sd * KT);
        KE.q(KE.v(pk0[0], Y.walk, pk0[1], a0 / 4, 0.53), KE.v(pk1[0], Y.walk, pk1[1], a1 / 4, 0.53), KE.v(pt1[0], Y.walk, pt1[1], a1 / 4, 0.98), KE.v(pt0[0], Y.walk, pt0[1], a0 / 4, 0.98));
        FO.N(0, 1, 0).T(0.93);
        const pw0 = SP(s, a0, uW - sd * PAR_W), pw1 = SP(s, a1, uW - sd * PAR_W);
        FO.q(FO.v(pt0[0], Y.walk, pt0[1], a0 / 6, 0), FO.v(pt1[0], Y.walk, pt1[1], a1 / 6, 0), FO.v(pw1[0], Y.walk, pw1[1], a1 / 6, 1), FO.v(pw0[0], Y.walk, pw0[1], a0 / 6, 1));
        // parapet
        ST.K(GK.concrete).C(COL.concrete);
        const po0 = SP(s, a0, uW + sd * 0.02), po1 = SP(s, a1, uW + sd * 0.02);
        if (s.axis === "x") ST.N(-sd, 0, 0); else ST.N(0, 0, -sd);
        ST.q(ST.v(pw0[0], Y.walk, pw0[1]), ST.v(pw1[0], Y.walk, pw1[1]), ST.v(pw1[0], Y.walk + PAR_H, pw1[1]), ST.v(pw0[0], Y.walk + PAR_H, pw0[1]));
        ST.N(0, 1, 0);
        ST.q(ST.v(pw0[0], Y.walk + PAR_H, pw0[1]), ST.v(pw1[0], Y.walk + PAR_H, pw1[1]), ST.v(po1[0], Y.walk + PAR_H, po1[1]), ST.v(po0[0], Y.walk + PAR_H, po0[1]));
        // fascia down to the soffit
        if (s.axis === "x") ST.N(sd, 0, 0); else ST.N(0, 0, sd);
        ST.q(ST.v(po0[0], -1.5, po0[1]), ST.v(po1[0], -1.5, po1[1]), ST.v(po1[0], Y.walk + PAR_H, po1[1]), ST.v(po0[0], Y.walk + PAR_H, po0[1]));
      }
      // soffit + piers over the wet part
      if (!P.river) return;
      ST.K(GK.concrete).C(COL.concreteDark);
      let wa = null;
      const wetRuns = [];
      for (let a = br.a0; a <= br.a1 + 0.01; a += 4) {
        const p = SP(s, a, 0), w = P.riverDist(p[0], p[1]) < P.river.half + 2;
        if (w && wa == null) wa = a;
        if (!w && wa != null) { wetRuns.push([wa - 4, a]); wa = null; }
      }
      if (wa != null) wetRuns.push([wa - 4, br.a1]);
      const W = h + br.walk + 0.02;
      for (const wr of wetRuns) {
        ST.N(0, -1, 0);
        const p0 = SP(s, wr[0], -W), p1 = SP(s, wr[0], W), p2 = SP(s, wr[1], W), p3 = SP(s, wr[1], -W);
        ST.q(ST.v(p0[0], -1.5, p0[1]), ST.v(p1[0], -1.5, p1[1]), ST.v(p2[0], -1.5, p2[1]), ST.v(p3[0], -1.5, p3[1]));
        // road fascia where there is no walk on that side
        for (let sd = -1; sd <= 1; sd += 2) {
          if (br.runs.some(function (r) { return r.side === sd && r.a0 <= wr[0] + 1 && r.a1 >= wr[1] - 1; })) continue;
          const q0 = SP(s, wr[0], sd * (h + 0.02)), q1 = SP(s, wr[1], sd * (h + 0.02));
          if (s.axis === "x") ST.N(sd, 0, 0); else ST.N(0, 0, sd);
          ST.q(ST.v(q0[0], -1.5, q0[1]), ST.v(q1[0], -1.5, q1[1]), ST.v(q1[0], Y.road, q1[1]), ST.v(q0[0], Y.road, q0[1]));
        }
        for (let a = wr[0] + 16; a < wr[1] - 8; a += 32) {
          const c0 = SP(s, a - 0.9, -W + 1.5), c1 = SP(s, a + 0.9, W - 1.5);
          ST.box(Math.min(c0[0], c1[0]), Math.max(c0[0], c1[0]), -14, -1.5, Math.min(c0[1], c1[1]), Math.max(c0[1], c1[1]), true);
        }
      }
    }

    // ---------- RAIL ----------
    function trackOffsets(R) { const n = R.tracks, off = (n - 1) * RAIL.sp / 2, o = []; for (let t = 0; t < n; t++) o.push(-off + t * RAIL.sp); return o; }
    function rail(d) {
      const R = d.R, a0 = d.a0, a1 = d.a1, zone = d.zone;
      const RP = function (a, l) { return R.axis === "x" ? [a, R.at + l] : [R.at + l, a]; };
      // stations: ends + every 6 m where the bed moves
      const st = [a0];
      const moving = zone === "ramp" || R.xings.some(function (x) { return !x.over && x.pos + x.h + 12 > a0 && x.pos - x.h - 12 < a1; });
      if (moving) for (let a = Math.ceil(a0 / 3) * 3; a < a1; a += 3) if (a > a0) st.push(a);
      for (const x of R.xings) if (!x.over) for (const b of [x.pos - x.h - 1, x.pos + x.h + 1]) if (b > a0 && b < a1) st.push(b);
      st.push(a1);
      st.sort(function (p, q) { return p - q; });
      const beds = st.map(function (a) { return S.railBed(R, a); });
      const elev = zone !== "grade";
      // ballast bed
      GR.K(GK.ballast).C(COL.ballast).N(0, 1, 0);
      const lat = elev ? [-RAIL.bedHalf, RAIL.bedHalf] : [-RAIL.toe, -RAIL.bedHalf, RAIL.bedHalf, RAIL.toe];
      let prev = null;
      for (let i = 0; i < st.length; i++) {
        const row = [];
        for (const l of lat) {
          const p = RP(st[i], l);
          const y = Math.abs(l) > RAIL.bedHalf + 0.01 ? 0.02 : beds[i];
          row.push(GR.v(p[0], y, p[1]));
        }
        if (prev) for (let k = 0; k < lat.length - 1; k++) GR.q(prev[k], prev[k + 1], row[k + 1], row[k]);
        prev = row;
      }
      // rails: head + two sides
      const offs = trackOffsets(R);
      for (const o of offs) for (const rs of [-RAIL.gauge / 2, RAIL.gauge / 2]) {
        const l = o + rs;
        let pv = null;
        for (let i = 0; i < st.length; i++) {
          const yt = beds[i] + RAIL.top, yb = beds[i] + RAIL.sleeperH;
          const pa = RP(st[i], l - 0.037), pb = RP(st[i], l + 0.037);
          ST.K(GK.metal).C(COL.railTop).N(0, 1, 0);
          const t0 = ST.v(pa[0], yt, pa[1]), t1 = ST.v(pb[0], yt, pb[1]);
          ST.C(COL.steel);
          if (R.axis === "x") ST.N(0, 0, -1); else ST.N(-1, 0, 0);
          const s0 = ST.v(pa[0], yb, pa[1]), s1 = ST.v(pa[0], yt, pa[1]);
          if (R.axis === "x") ST.N(0, 0, 1); else ST.N(1, 0, 0);
          const s2 = ST.v(pb[0], yb, pb[1]), s3 = ST.v(pb[0], yt, pb[1]);
          const cur = [t0, t1, s0, s1, s2, s3];
          if (pv) { ST.q(pv[0], cur[0], cur[1], pv[1]); ST.q(pv[2], cur[2], cur[3], pv[3]); ST.q(pv[4], cur[4], cur[5], pv[5]); }
          pv = cur;
        }
      }
      // sleepers (instanced), not inside a crossing's panels
      for (const o of offs) {
        for (let k = Math.ceil(a0 / RAIL.step); k * RAIL.step < a1; k++) {
          const a = k * RAIL.step;
          let inX = false;
          for (const x of R.xings) if (!x.over && Math.abs(a - x.pos) < x.h + 0.8) inX = true;
          if (inX) continue;
          const y = S.railBed(R, a) + RAIL.sleeperH / 2;
          const p = RP(a, o);
          // local x = across the track
          if (R.axis === "x") sleeperM.push(0, 0, -1, 0, 1, 0, 1, 0, 0, p[0], y, p[1]);
          else sleeperM.push(1, 0, 0, 0, 1, 0, 0, 0, 1, p[0], y, p[1]);
        }
      }
      // retained / viaduct sides
      if (elev) {
        ST.K(GK.concrete).C(COL.concrete);
        for (let side = -1; side <= 1; side += 2) {
          let pv = null;
          for (let i = 0; i < st.length; i++) {
            const y = beds[i], yb = zone === "via" ? y - Y.deckDepth : -0.2;
            const po = RP(st[i], side * RAIL.wall), pi = RP(st[i], side * RAIL.bedHalf);
            if (R.axis === "x") ST.N(0, 0, side); else ST.N(side, 0, 0);
            const o0 = ST.v(po[0], yb, po[1]), o1 = ST.v(po[0], y + 1.0, po[1]);
            ST.N(0, 1, 0);
            const t0 = ST.v(po[0], y + 1.0, po[1]), t1 = ST.v(pi[0], y + 1.0, pi[1]);
            if (R.axis === "x") ST.N(0, 0, -side); else ST.N(-side, 0, 0);
            const i0 = ST.v(pi[0], y + 1.0, pi[1]), i1 = ST.v(pi[0], y - 0.02, pi[1]);
            const cur = [o0, o1, t0, t1, i0, i1];
            if (pv) { ST.q(pv[0], cur[0], cur[1], pv[1]); ST.q(pv[2], cur[2], cur[3], pv[3]); ST.q(pv[4], cur[4], cur[5], pv[5]); }
            pv = cur;
          }
        }
        if (zone === "via") {
          ST.N(0, -1, 0).C(COL.concreteDark);
          const p0 = RP(a0, -RAIL.wall), p1 = RP(a0, RAIL.wall), p2 = RP(a1, RAIL.wall), p3 = RP(a1, -RAIL.wall), yb = Y.deck - Y.deckDepth;
          ST.q(ST.v(p0[0], yb, p0[1]), ST.v(p1[0], yb, p1[1]), ST.v(p2[0], yb, p2[1]), ST.v(p3[0], yb, p3[1]));
        }
      }
      // at-grade river span: a deck under the ballast
      if (d.wet && !elev) {
        ST.K(GK.concrete).C(COL.concreteDark);
        for (let side = -1; side <= 1; side += 2) {
          const p0 = RP(a0, side * RAIL.wall), p1 = RP(a1, side * RAIL.wall);
          if (R.axis === "x") ST.N(0, 0, side); else ST.N(side, 0, 0);
          ST.q(ST.v(p0[0], -1.3, p0[1]), ST.v(p1[0], -1.3, p1[1]), ST.v(p1[0], Y.bed + 0.1, p1[1]), ST.v(p0[0], Y.bed + 0.1, p0[1]));
        }
        ST.N(0, -1, 0);
        const p0 = RP(a0, -RAIL.wall), p1 = RP(a0, RAIL.wall), p2 = RP(a1, RAIL.wall), p3 = RP(a1, -RAIL.wall);
        ST.q(ST.v(p0[0], -1.3, p0[1]), ST.v(p1[0], -1.3, p1[1]), ST.v(p2[0], -1.3, p2[1]), ST.v(p3[0], -1.3, p3[1]));
      }
    }
    function vpier(d) {
      const R = d.R, a = d.a, ys = Y.deck - Y.deckDepth;
      ST.K(GK.concrete).C(COL.concrete);
      if (R.axis === "x") ST.box(a - 0.8, a + 0.8, -0.2, ys, R.at - 3.2, R.at + 3.2, true);
      else ST.box(R.at - 3.2, R.at + 3.2, -0.2, ys, a - 0.8, a + 0.8, true);
    }
    function truss(d) {
      const R = d.R, a0 = d.a0, a1 = d.a1;
      const RP = function (a, l, y) { return R.axis === "x" ? [a, y, R.at + l] : [R.at + l, y, a]; };
      const yb = Y.bed + 0.25, yt = Y.bed + 7.0, L = a1 - a0;
      const nP = Math.max(2, Math.round(L / 10)), step = L / nP;
      ST.K(GK.metal).C(COL.truss);
      for (const side of [-5.35, 5.35]) {
        const b0 = RP(a0, side, yb), b1 = RP(a1, side, yb);
        ST.beam(b0[0], b0[1], b0[2], b1[0], b1[1], b1[2], 0.5, 0.6);
        const t0 = RP(a0 + step, side, yt), t1 = RP(a1 - step, side, yt);
        ST.beam(t0[0], t0[1], t0[2], t1[0], t1[1], t1[2], 0.55, 0.55);
        for (let k = 0; k < nP; k++) {
          const aa = a0 + k * step, ab = aa + step;
          // Warren diagonals + verticals; portal ends slope up to the top chord
          const p = RP(aa, side, k === 0 ? yb : yt), q = RP(ab, side, k === nP - 1 ? yb : yt);
          if (k === 0) { const e = RP(ab, side, yt); ST.beam(p[0], p[1], p[2], e[0], e[1], e[2], 0.45, 0.45); continue; }
          if (k === nP - 1) { const e = RP(aa, side, yt); ST.beam(e[0], e[1], e[2], q[0], q[1], q[2], 0.45, 0.45); continue; }
          const lowA = RP(aa, side, yb), topB = RP(ab, side, yt), lowB = RP(ab, side, yb), topA = RP(aa, side, yt);
          if (k & 1) ST.beam(lowA[0], lowA[1], lowA[2], topB[0], topB[1], topB[2], 0.32, 0.32);
          else ST.beam(topA[0], topA[1], topA[2], lowB[0], lowB[1], lowB[2], 0.32, 0.32);
          ST.beam(topA[0], topA[1], topA[2], lowA[0], lowA[1], lowA[2], 0.22, 0.22);
        }
      }
      for (let k = 1; k < nP; k++) {
        const aa = a0 + k * step, l = RP(aa, -5.35, yt), r = RP(aa, 5.35, yt);
        ST.beam(l[0], l[1], l[2], r[0], r[1], r[2], 0.3, 0.4);
      }
      ST.K(GK.concrete).C(COL.concreteDark);
      for (let k = 1; k < nP; k += 3) {
        const aa = a0 + k * step;
        if (!P.river) break;
        const pp = RP(aa, 0, 0);
        if (P.riverDist(pp[0], pp[2]) > P.river.half) continue;
        if (R.axis === "x") ST.box(aa - 1.0, aa + 1.0, -14, -1.3, R.at - 5.6, R.at + 5.6, true);
        else ST.box(R.at - 5.6, R.at + 5.6, -14, -1.3, aa - 1.0, aa + 1.0, true);
      }
    }
    function xing(d) {
      const R = d.R, x = d.x, hw = x.h + 0.5, y = x.y + 0.025;
      const RP = function (a, l) { return R.axis === "x" ? [a, R.at + l] : [R.at + l, a]; };
      GR.K(GK.rubber).C(COL.rubber).N(0, 1, 0);
      const p0 = RP(x.pos - hw, -3.9), p1 = RP(x.pos + hw, -3.9), p2 = RP(x.pos + hw, 3.9), p3 = RP(x.pos - hw, 3.9);
      GR.q(GR.v(p0[0], y, p0[1]), GR.v(p1[0], y, p1[1]), GR.v(p2[0], y, p2[1]), GR.v(p3[0], y, p3[1]));
      // stop lines on the street approaches (straight streets only)
      const s = x.s;
      if (!s) return;
      for (let sg = -1; sg <= 1; sg += 2) {
        // traffic arriving from the sg side drives toward -sg: its lanes sit on
        // CBZ.roadLaneSideAxis(vertical, -sg)
        const b0 = R.at + sg * (R.half + 1.5), b1 = b0 + sg * 0.5;
        const side = (s.axis === "x" ? -1 : 1) * -sg;
        const u0 = side > 0 ? 0.25 : -s.h + 0.4, u1 = side > 0 ? s.h - 0.4 : -0.25;
        paintAlong(s, Math.min(b0, b1), Math.max(b0, b1), u0, u1, WHITE, 0.92);
      }
    }
    function platform(d) {
      const st = d.st, R = st.R, a0 = d.sg[0], a1 = d.sg[1], ramp = 13.2;
      const RP = function (a, l) { return R.axis === "x" ? [a, R.at + l] : [R.at + l, a]; };
      const yAt = function (a) { const e = Math.min(a - a0, a1 - a); return e >= ramp ? Y.plat : lerp(0.02, Y.plat, e / ramp); };
      for (let side = -1; side <= 1; side += 2) {
        const l0 = side * st.lat0, l1 = side * st.lat1;
        const as = [a0, a0 + ramp, a1 - ramp, a1];
        FO.N(0, 1, 0).T(0.95);
        const top = as.map(function (a) { const p = RP(a, l0), q = RP(a, l1); return [FO.v(p[0], yAt(a), p[1], a / 6, 0), FO.v(q[0], yAt(a), q[1], a / 6, 1)]; });
        for (let i = 0; i < 3; i++) FO.q(top[i][0], top[i + 1][0], top[i + 1][1], top[i][1]);
        ST.K(GK.concrete).C(COL.concrete);
        for (const l of [l0, l1]) {
          const out = Math.sign(l - (l0 + l1) / 2) || side;
          if (R.axis === "x") ST.N(0, 0, out); else ST.N(out, 0, 0);
          const rows = as.map(function (a) { const p = RP(a, l); return [ST.v(p[0], -0.1, p[1]), ST.v(p[0], yAt(a), p[1])]; });
          for (let i = 0; i < 3; i++) ST.q(rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]);
        }
        // yellow safety line along the track edge (flat part)
        PA.N(0, 1, 0).C(YELLOW, 0.95);
        const e0 = l0 + side * 0.15, e1 = l0 + side * 0.75;
        const q0 = RP(a0 + ramp, e0), q1 = RP(a1 - ramp, e0), q2 = RP(a1 - ramp, e1), q3 = RP(a0 + ramp, e1);
        PA.q(PA.v(q0[0], Y.plat + 0.004, q0[1]), PA.v(q1[0], Y.plat + 0.004, q1[1]), PA.v(q2[0], Y.plat + 0.004, q2[1]), PA.v(q3[0], Y.plat + 0.004, q3[1]));
      }
    }

    // ---------- FIELDS ----------
    function field(d) {
      const f = d.f;
      if (f.ballfield) { ballfield(f); return; }
      const c = COL.crops[(f.crop | 0) % 4];
      GR.N(0, 1, 0).K(GK.crop, f.dir === "z" ? 0 : 1).C(c);
      GR.q(GR.v(f.x0, Y.field, f.z0), GR.v(f.x1, Y.field, f.z0), GR.v(f.x1, Y.field, f.z1), GR.v(f.x0, Y.field, f.z1));
    }
    function ballfield(f) {
      // lawn over the whole rect, the skinned infield, mound, foul lines
      GR.N(0, 1, 0).K(GK.lawn, 0).C(COL.lawnPark);
      const yl = Y.lawn + 0.004;
      GR.q(GR.v(f.x0, yl, f.z0), GR.v(f.x1, yl, f.z0), GR.v(f.x1, yl, f.z1), GR.v(f.x0, yl, f.z1));
      const hx = f.x0 + 6, hz = f.z0 + 6;             // home plate; fair territory toward +x/+z
      GR.K(GK.dirt).C(COL.dirt);
      const yd = yl + 0.02;
      const c = GR.v(hx, yd, hz);
      const R = 29;
      let prev = null;
      for (let k = 0; k <= 12; k++) {
        const t = k / 12 * Math.PI / 2;
        const i = GR.v(hx + Math.cos(t) * R, yd, hz + Math.sin(t) * R);
        if (prev != null) GR.t(c, prev, i);
        prev = i;
      }
      // grass infield diamond inside the base paths
      GR.K(GK.lawn, 255).C(COL.lawnPark);
      const yg = yd + 0.012, g = 25.6, o = 1.3;
      const dA = GR.v(hx + o * 1.4, yg, hz + o * 1.4), dB = GR.v(hx + g, yg, hz + o), dC = GR.v(hx + g, yg, hz + g), dD = GR.v(hx + o, yg, hz + g);
      GR.q(dA, dB, dC, dD);
      GR.K(GK.dirt).C(COL.mound);
      const mx = hx + 13.0, mz = hz + 13.0, ym = yg + 0.02;
      const mc = GR.v(mx, ym + 0.2, mz);
      let pm = null, fm = null;
      for (let k = 0; k <= 12; k++) {
        const t = k / 12 * Math.PI * 2;
        const i = GR.v(mx + Math.cos(t) * 2.7, ym, mz + Math.sin(t) * 2.7);
        if (pm != null) GR.t(mc, pm, i);
        if (fm == null) fm = i;
        pm = i;
      }
      PA.N(0, 1, 0).C(WHITE, 0.95);
      const yp = yd + 0.02;
      PA.q(PA.v(hx, yp, hz - 0.05), PA.v(f.x1 - 2, yp, hz - 0.05), PA.v(f.x1 - 2, yp, hz + 0.05), PA.v(hx, yp, hz + 0.05));
      PA.q(PA.v(hx - 0.05, yp, hz), PA.v(hx + 0.05, yp, hz), PA.v(hx + 0.05, yp, f.z1 - 2), PA.v(hx - 0.05, yp, f.z1 - 2));
    }

    // ---------- SOUND WALL ----------
    function wall(d) {
      const w = d.w, t = 0.13, y0 = -0.1, y1 = Y.lawn + w.h;
      ST.K(GK.soundwall).C(COL.soundwall);
      if (w.alongX) ST.box(w.a0, w.a1, y0, y1, w.line - t, w.line + t, false);
      else ST.box(w.line - t, w.line + t, y0, y1, w.a0, w.a1, false);
      // coping
      ST.C(COL.concrete);
      if (w.alongX) ST.box(w.a0, w.a1, y1, y1 + 0.12, w.line - t - 0.04, w.line + t + 0.04, false);
      else ST.box(w.line - t - 0.04, w.line + t + 0.04, y1, y1 + 0.12, w.a0, w.a1, false);
    }

    // ---------- PARKS: paths ----------
    function pathBand(x0, z0, x1, z1, wdt) {
      // a ring of path of width wdt just inside the rect
      const r = { x0: x0, x1: x1, z0: z0, z1: z1, cr: [0, 0, 0, 0] };
      const st = perimeter(r, null);
      FO.N(0, 1, 0).T(0.9);
      const ids = st.map(function (p) {
        return [FO.v(p.x, Y.path, p.z, p.s / 6, 0), FO.v(p.x + p.ox * wdt, Y.path, p.z + p.oz * wdt, p.s / 6, 1)];
      });
      for (let i = 0; i < ids.length; i++) { const j = (i + 1) % ids.length; FO.q(ids[i][0], ids[j][0], ids[j][1], ids[i][1]); }
    }
    function pathRect(x0, z0, x1, z1) {
      FO.N(0, 1, 0).T(0.9);
      const alongX = (x1 - x0) > (z1 - z0);
      const uv = function (x, z) { return alongX ? [x / 6, (z - z0) / (z1 - z0)] : [z / 6, (x - x0) / (x1 - x0)]; };
      const q = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(function (p) { const u = uv(p[0], p[1]); return FO.v(p[0], Y.path, p[1], u[0], u[1]); });
      FO.q(q[0], q[1], q[2], q[3]);
    }
    function park(d) {
      const pk = d.pk;
      const inset = pk.kind === "pocket" ? 2 : pk.kind === "quad" ? 0 : PAD_SW + 6;
      const wdt = pk.kind === "pocket" ? 2.0 : 2.8;
      const x0 = pk.x0 + inset, x1 = pk.x1 - inset, z0 = pk.z0 + inset, z1 = pk.z1 - inset;
      if (x1 - x0 < 12 || z1 - z0 < 12) return;
      pathBand(x0, z0, x1, z1, wdt);
      if (pk.kind === "central" || pk.kind === "quad" || pk.kind === "park") {
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hw = wdt / 2;
        pathRect(x0 + wdt, cz - hw, x1 - wdt, cz + hw);
        pathRect(cx - hw, z0 + wdt, cx + hw, cz - hw);
        pathRect(cx - hw, cz + hw, cx + hw, z1 - wdt);
      }
    }

    // ---------- PARKING ----------
    function stalls(r, y) {
      const alongX = (r.x1 - r.x0) >= (r.z1 - r.z0);
      const L0 = alongX ? r.x0 : r.z0, L1 = alongX ? r.x1 : r.z1, S0 = alongX ? r.z0 : r.x0, S1 = alongX ? r.z1 : r.x1;
      const pt = function (l, s) { return alongX ? [l, s] : [s, l]; };
      const bands = [];
      let s = S0 + 0.8;
      while (s + 18.2 <= S1 - 0.5) { bands.push([s, s + 5.4]); bands.push([s + 12.8, s + 18.2]); s += 18.2 + 0.4; }
      if (!bands.length) return;
      PA.N(0, 1, 0).C(WHITE, 0.85);
      const yp = y + 0.006;
      for (const b of bands) {
        for (let l = L0 + 3; l <= L1 - 3; l += 2.7) {
          const p0 = pt(l - 0.05, b[0]), p1 = pt(l + 0.05, b[0]), p2 = pt(l + 0.05, b[1]), p3 = pt(l - 0.05, b[1]);
          PA.q(PA.v(p0[0], yp, p0[1]), PA.v(p1[0], yp, p1[1]), PA.v(p2[0], yp, p2[1]), PA.v(p3[0], yp, p3[1]));
        }
      }
    }
    function lot(d) {
      const r = d.l, y = Y.lot + 0.004;
      RA.N(0, 1, 0).L(0, 99, 0);
      RA.q(RA.v(r.x0, y, r.z0, r.x0 * 0.25, r.z0 * 0.25), RA.v(r.x1, y, r.z0, r.x1 * 0.25, r.z0 * 0.25), RA.v(r.x1, y, r.z1, r.x1 * 0.25, r.z1 * 0.25), RA.v(r.x0, y, r.z1, r.x0 * 0.25, r.z1 * 0.25));
      if (r.kind === "lot") stalls(r, y);
    }

    // ---------- DRIVEWAY ----------
    function drive(d) {
      const v = d.d;
      FO.N(0, 1, 0).T(0.97);
      const hw = v.w / 2;
      const ax = v.x0, az = v.z0, bx = v.x0 + v.nx * v.L, bz = v.z0 + v.nz * v.L;
      const q = [[ax - v.tx * hw, az - v.tz * hw, 0, 0], [ax + v.tx * hw, az + v.tz * hw, 0, 1], [bx + v.tx * hw, bz + v.tz * hw, v.L / 6, 1], [bx - v.tx * hw, bz - v.tz * hw, v.L / 6, 0]];
      const ids = q.map(function (p) { return FO.v(p[0], v.y, p[1], p[2], p[3]); });
      FO.q(ids[0], ids[1], ids[2], ids[3]);
    }

    // ---------- LAMP (instance) ----------
    function lamp(d) {
      const l = d.l, c = Math.cos(l.yaw), s = Math.sin(l.yaw), k = l.H;
      // column-major 3x3 (rotation about y, uniform scale) + translation
      lampM.push(c * k, 0, -s * k, 0, k, 0, s * k, 0, c * k, l.x, l.y, l.z);
    }

    return { piece: piece, node: node, block: block, pad: pad, rib: rib, bulb: bulb, ovp: ovp, slip: slip, bridge: bridge,
      rail: rail, vpier: vpier, truss: truss, xing: xing, platform: platform, field: field, wall: wall, park: park, lot: lot,
      drive: drive, lamp: lamp };
  }

  // ---- instanced prototypes (built once) ----
  let _lampProto = null, _sleeperProto = null;
  function lampProto() {
    if (_lampProto) return _lampProto;
    const b = new Buf(SPECS.struct);
    b.K(GK.metal).C(COL.metal);
    b.box(-0.2, 0.2, 0, 0.5, -0.2, 0.2, false);                  // base
    const H = 8.2, seg = 8;
    const ring = function (y, r) { const o = []; for (let k = 0; k <= seg; k++) { const t = k / seg * Math.PI * 2; b.N(Math.cos(t), 0, Math.sin(t)); o.push(b.v(Math.cos(t) * r, y, Math.sin(t) * r)); } return o; };
    const r0 = ring(0.5, 0.11), r1 = ring(H, 0.065);
    for (let k = 0; k < seg; k++) b.q(r0[k], r0[k + 1], r1[k + 1], r1[k]);
    b.beam(0, H - 0.05, 0, 2.2, H + 0.25, 0, 0.09, 0.09);        // the arm, toward local +x (over the road)
    b.box(1.85, 2.65, H + 0.08, H + 0.3, -0.19, 0.19, false);    // head housing
    b.K(GK.lens).C(COL.lens).N(0, -1, 0);                         // the lens (glows)
    b.q(b.v(1.9, H + 0.075, -0.15), b.v(2.6, H + 0.075, -0.15), b.v(2.6, H + 0.075, 0.15), b.v(1.9, H + 0.075, 0.15));
    _lampProto = b;
    return b;
  }
  function sleeperProto() {
    if (_sleeperProto) return _sleeperProto;
    const b = new Buf(SPECS.struct);
    b.K(GK.concrete).C(COL.sleeper);
    b.box(-1.3, 1.3, -RAIL.sleeperH / 2, RAIL.sleeperH / 2, -0.13, 0.13, false);
    _sleeperProto = b;
    return b;
  }

  /* ==================================================================
     THREE — materials, meshes, tiles
     ================================================================== */
  const NIGHT = { value: 0 };
  let _mats = null;
  const MG_FUNCS = [
    "uniform float uMgNight;",
    "varying vec2 vMgK; varying vec3 vMgW; varying float vMgD;",
    "float mgH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }",
    "float mgN(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(mgH(i), mgH(i + vec2(1.0, 0.0)), u.x), mix(mgH(i + vec2(0.0, 1.0)), mgH(i + vec2(1.0, 1.0)), u.x), u.y); }",
    "vec3 mgSurface(vec3 base) {",
    "  float k = vMgK.x; float pr = vMgK.y; vec2 p = vMgW.xz;",
    "  float fine = 1.0 - smoothstep(18.0, 75.0, vMgD); float mid = 1.0 - smoothstep(70.0, 420.0, vMgD);",
    "  float t = 1.0; vec3 col = base;",
    "  if (k < 0.5) {",                                   // LAWN: mottle, mow stripes, dry patches, blades
    "    t = 0.80 + 0.30 * mgN(p * 0.043 + 1.7) + 0.14 * (mgN(p * 0.21 + 3.1) - 0.5);",
    "    if (pr < 1.5) { float ax = pr > 0.5 ? p.y : p.x; float band = step(0.5, fract(ax * 0.2273)); t *= 1.0 + 0.10 * (band - 0.5) * mid; }",
    // near grain: soil and thatch between the blades (world/grassfield.js
    // stands the blades up) — was one hash per 14 cm SQUARE, a pixel mosaic
    // up close; now smooth multi-scale grain, still zero-mean (MG_MEAN holds)
    "    t *= 1.0 + fine * ((mgN(p * 9.0) - 0.5) * 0.22 + (mgN(p * 31.0 + 5.1) - 0.5) * 0.14 + (mgN(p * 2.3 + 1.9) - 0.5) * 0.12);",
    "    col = mix(col, col * vec3(1.55, 1.25, 0.72), smoothstep(0.60, 0.82, mgN(p * 0.031 + 7.3)) * 0.55);",
    "  } else if (k < 1.5) {",                            // PAVING: 4.5 m slabs, joints, stains
    "    vec2 g = abs(fract(p / 4.5 + 0.5) - 0.5) * 4.5; float jd = min(g.x, g.y);",
    "    t = 0.90 + 0.14 * mgN(p * 0.17) + fine * (mgH(floor(p * 11.0)) - 0.5) * 0.10;",
    "    t *= 1.0 - 0.45 * (1.0 - smoothstep(0.012, 0.035, jd)) * mid;",
    "    t *= 1.0 - 0.18 * smoothstep(0.55, 0.85, mgN(p * 0.09 + 5.0));",
    "  } else if (k < 2.5) {",                            // DIRT
    "    t = 0.82 + 0.28 * mgN(p * 0.33) + fine * (mgH(floor(p * 18.0)) - 0.5) * 0.25;",
    "  } else if (k < 3.5) {",                            // CROP ROWS over soil
    "    float ax = pr > 0.5 ? p.y : p.x; float f = fract(ax / 0.9);",
    "    float row = smoothstep(0.12, 0.30, f) * (1.0 - smoothstep(0.62, 0.80, f));",
    "    row = mix(row, 0.62, smoothstep(30.0, 140.0, vMgD));",
    "    col = mix(vec3(0.085, 0.06, 0.04), base, row);",
    "    t = 0.84 + 0.26 * mgN(p * 0.027 + 9.0) + 0.1 * (mgN(p * 0.4) - 0.5);",
    "  } else if (k < 4.5) {",                            // BALLAST / GRAVEL
    "    float g1 = mgH(floor(p * 13.0)); float g2 = mgH(floor(p * 5.0 + 3.0));",
    "    t = mix(0.9 + 0.2 * mgN(p * 0.5), 0.62 + 0.75 * g1 * g1 + 0.1 * g2, fine * 0.9);",
    "  } else if (k < 5.5) {",                            // CAST CONCRETE (walls, decks, piers)
    "    float al = vMgW.x + vMgW.z; float pj = abs(fract(al / 6.0 + 0.5) - 0.5) * 6.0;",
    "    t = 0.88 + 0.16 * mgN(vec2(al * 0.35, vMgW.y * 0.6));",
    "    t *= 1.0 - 0.30 * (1.0 - smoothstep(0.015, 0.04, pj)) * mid;",
    "    t *= 1.0 - 0.16 * smoothstep(0.55, 0.9, mgN(vec2(al * 1.7, vMgW.y * 0.05 + 3.0)));",
    "  } else if (k < 6.5) {",                            // PAINTED METAL
    "    t = 0.92 + 0.12 * mgN(vec2(vMgW.x + vMgW.z, vMgW.y) * 0.8);",
    "  } else if (k < 7.5) {",                            // LAMP LENS
    "    t = 1.0;",
    "  } else if (k < 8.5) {",                            // SOUND WALL: 4 m panels, split-face courses
    "    float al = vMgW.x + vMgW.z; float pj = abs(fract(al / 4.0 + 0.5) - 0.5) * 4.0;",
    "    float cy = fract(vMgW.y / 0.4); float course = smoothstep(0.0, 0.08, cy) * (1.0 - smoothstep(0.92, 1.0, cy));",
    "    t = 0.86 + 0.18 * mgN(vec2(al * 2.1, vMgW.y * 2.5));",
    "    t *= mix(0.80, 1.0, course * mid + (1.0 - mid));",
    "    t *= 1.0 - 0.45 * (1.0 - smoothstep(0.03, 0.08, pj)) * mid;",
    "  } else {",                                          // RUBBER CROSSING PANELS (1.8 m)
    "    vec2 g = abs(fract(p / 1.8 + 0.5) - 0.5) * 1.8; float jd = min(g.x, g.y);",
    "    t = (0.85 + 0.2 * mgN(p * 1.3)) * (1.0 - 0.5 * (1.0 - smoothstep(0.01, 0.03, jd)) * mid);",
    "  }",
    "  return col * t; }",
  ].join("\n");
  function groundMaterial(THREE, offset) {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    if (offset) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1; }
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uMgNight = NIGHT;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 gk;\nvarying vec2 vMgK; varying vec3 vMgW; varying float vMgD;")
        .replace("#include <project_vertex>", "#include <project_vertex>\n{ vec4 mgW = vec4(transformed, 1.0);\n" +
          "#ifdef USE_INSTANCING\n  mgW = instanceMatrix * mgW;\n#endif\n" +
          "  mgW = modelMatrix * mgW; vMgW = mgW.xyz; vMgK = gk; vMgD = -mvPosition.z; }");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\n" + MG_FUNCS)
        .replace("#include <color_fragment>", "#ifdef USE_COLOR\n  diffuseColor.rgb *= mgSurface(vColor * vColor);\n#else\n  diffuseColor.rgb *= mgSurface(vec3(0.5));\n#endif")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\nif (abs(vMgK.x - 7.0) < 0.5) totalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * uMgNight * 3.0;");
    };
    m.customProgramCacheKey = function () { return "metroGround1"; };
    if (CBZ && CBZ.terrainFogScale) CBZ.terrainFogScale(m, 0.10);
    return m;
  }
  function materials(THREE) {
    if (_mats) return _mats;
    const kit = CBZ && CBZ.streetKit;
    const L = kit && kit.look ? kit.look() : null;
    const fb = function (c) { return new THREE.MeshLambertMaterial({ color: c, vertexColors: true }); };
    let roadA = kit && kit.sharedAsphalt ? kit.sharedAsphalt(3.6, 2) : null;
    let roadL = kit && kit.sharedAsphalt ? kit.sharedAsphalt(3.6, 1) : null;
    if (!roadA) { roadA = new THREE.MeshLambertMaterial({ color: 0x2a2a2c, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }); roadL = roadA; }
    _mats = {
      roadA: roadA, roadL: roadL,
      foot: L ? L.footMat : fb(0x9a968e), kerb: L ? L.kerbMat : fb(0xaaa8a0), paint: L ? L.white : fb(0xdddddd),
      ground: groundMaterial(THREE, true), struct: groundMaterial(THREE, false),
    };
    return _mats;
  }
  function geometryOf(THREE, b) {
    const n = b.n;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(b.pos.slice(0, n * 3), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(b.nrm.slice(0, n * 3), 3, true));
    if (b.uv) g.setAttribute("uv", new THREE.BufferAttribute(b.uv.slice(0, n * 2), 2));
    if (b.col) g.setAttribute("color", new THREE.BufferAttribute(b.col.slice(0, n * 3), 3, true));
    if (b.lane) g.setAttribute("asphaltLane", new THREE.BufferAttribute(b.lane.slice(0, n * 3), 3));
    if (b.gk) g.setAttribute("gk", new THREE.BufferAttribute(b.gk.slice(0, n * 2), 2));
    const idx = n > 65535 ? b.idx.slice(0, b.ni) : Uint16Array.from(b.idx.subarray(0, b.ni));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, cz = (b.minZ + b.maxZ) / 2;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), Math.hypot(b.maxX - cx, b.maxY - cy, b.maxZ - cz) + 0.01);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(b.minX, b.minY, b.minZ), new THREE.Vector3(b.maxX, b.maxY, b.maxZ));
    return g;
  }
  let _protoGeo = { lamp: null, sleeper: null };
  function protoGeo(THREE, kind) {
    if (!_protoGeo[kind]) _protoGeo[kind] = geometryOf(THREE, kind === "lamp" ? lampProto() : sleeperProto());
    return _protoGeo[kind];
  }
  function instanced(THREE, kind, mats, arr, reach) {
    const n = arr.length / 12;
    if (!n) return null;
    const src = protoGeo(THREE, kind);
    // a per-tile view of the shared prototype: same attributes, its OWN bounds
    // (r128 culls an InstancedMesh by its geometry's sphere)
    const g = new THREE.BufferGeometry();
    for (const k in src.attributes) g.setAttribute(k, src.attributes[k]);
    g.setIndex(src.index);
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
    const M = new Float32Array(n * 16);
    for (let i = 0; i < n; i++) {
      const s = i * 12, o = i * 16;
      M[o] = arr[s]; M[o + 1] = arr[s + 1]; M[o + 2] = arr[s + 2]; M[o + 3] = 0;
      M[o + 4] = arr[s + 3]; M[o + 5] = arr[s + 4]; M[o + 6] = arr[s + 5]; M[o + 7] = 0;
      M[o + 8] = arr[s + 6]; M[o + 9] = arr[s + 7]; M[o + 10] = arr[s + 8]; M[o + 11] = 0;
      M[o + 12] = arr[s + 9]; M[o + 13] = arr[s + 10]; M[o + 14] = arr[s + 11]; M[o + 15] = 1;
      const x = arr[s + 9], y = arr[s + 10], z = arr[s + 11];
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), Math.hypot(maxX - cx, maxY - cy, maxZ - cz) + reach);
    const mesh = new THREE.InstancedMesh(g, mats.struct, n);
    mesh.instanceMatrix = new THREE.InstancedBufferAttribute(M, 16);
    mesh._mgShared = true;
    return mesh;
  }
  function nightTick() {
    const n = CBZ && CBZ.nightAmount != null ? CBZ.nightAmount : 0;
    let k = (n - 0.32) / 0.3; k = k < 0 ? 0 : k > 1 ? 1 : k * k * (3 - 2 * k);
    NIGHT.value = k;
  }

  const TILES = typeof WeakMap !== "undefined" ? new WeakMap() : null;
  function prepare(P, opts) {
    opts = opts || {};
    const S = solve(P);
    const T = opts.tile || 800;
    if (S.tile !== T) binAll(S, T);
    S.opts = { root: opts.root || null, tile: T, name: opts.name || P.id };
    const tiles = [];
    S.bins.forEach(function (list, key) {
      const ij = key.split(",").map(Number);
      tiles.push({ key: key, x0: ij[0] * T, z0: ij[1] * T, x1: (ij[0] + 1) * T, z1: (ij[1] + 1) * T, meshes: [], built: false, n: list.length });
    });
    tiles.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    const R = { tiles: tiles, solve: S };
    if (TILES) TILES.set(P, R);
    return R;
  }
  function buildTile(P, tile) {
    const THREE = G.THREE;
    const S = solve(P);
    if (!S.opts) prepare(P, {});
    const T0 = now();
    const A = tileArrays(P, tile.key);
    const out = { ms: 0, vertices: A.stats.vertices, bytes: A.stats.bytes, drawCalls: 0 };
    if (!THREE) { out.ms = +(now() - T0).toFixed(2); tile.built = true; return { stats: out, arrays: A }; }
    const mats = materials(THREE);
    const root = S.opts.root;
    const order = { roadA: 0, roadL: 0, foot: 0, kerb: 0, ground: 0, struct: 0, paint: 1 };
    for (const k in A.bufs) {
      const b = A.bufs[k];
      if (!b.ni) continue;
      const m = new THREE.Mesh(geometryOf(THREE, b), mats[k]);
      m.name = S.opts.name + "-ground-" + k + "-" + tile.key;
      m.receiveShadow = true; m.castShadow = k === "struct";
      m.matrixAutoUpdate = false; m.updateMatrix();
      m.userData = { metro: P.id, metroTile: tile.key, terrain: true };
      if (k === "paint") { m.userData.roadPaint = true; m.renderOrder = order.paint; }
      if (root) root.add(m);
      tile.meshes.push(m); out.drawCalls++;
    }
    const lm = instanced(THREE, "lamp", mats, A.lamps, 10);
    if (lm) {
      lm.name = S.opts.name + "-lamps-" + tile.key; lm.castShadow = true; lm.receiveShadow = false;
      lm.matrixAutoUpdate = false; lm.updateMatrix();
      lm.userData = { metro: P.id, metroTile: tile.key, lamps: true };
      lm.onBeforeRender = nightTick;
      if (root) root.add(lm);
      tile.meshes.push(lm); out.drawCalls++;
    }
    const sm = instanced(THREE, "sleeper", mats, A.sleepers, 2);
    if (sm) {
      sm.name = S.opts.name + "-sleepers-" + tile.key; sm.castShadow = false; sm.receiveShadow = true;
      sm.matrixAutoUpdate = false; sm.updateMatrix();
      sm.userData = { metro: P.id, metroTile: tile.key, terrain: true };
      if (root) root.add(sm);
      tile.meshes.push(sm); out.drawCalls++;
    }
    tile.built = true;
    out.ms = +(now() - T0).toFixed(2);
    tile.stats = out;
    return { stats: out };
  }
  function disposeTile(P, tile) {
    for (const m of tile.meshes) {
      if (m.parent) m.parent.remove(m);
      if (m.isInstancedMesh) { if (m.dispose) m.dispose(); }
      else if (m.geometry) m.geometry.dispose();
    }
    tile.meshes.length = 0;
    tile.built = false;
  }
  function build(P, opts) {
    const T0 = now();
    const S = solve(P);
    const R = prepare(P, opts || {});
    const meshes = [];
    const st = { vertices: 0, bytes: 0, ms: 0, drawCalls: 0, tiles: R.tiles.length, tileMsMax: 0, solveMs: S.stats.solveMs };
    for (const t of R.tiles) {
      const r = buildTile(P, t);
      st.vertices += r.stats.vertices; st.bytes += r.stats.bytes; st.drawCalls += r.stats.drawCalls;
      st.tileMsMax = Math.max(st.tileMsMax, r.stats.ms);
      for (const m of t.meshes) meshes.push(m);
    }
    st.ms = +(now() - T0).toFixed(1);
    return { meshes: meshes, heightAt: S.heightAt, platforms: S.platforms, colliders: S.colliders, stats: st, tiles: R.tiles, solve: S };
  }

  /* ==================================================================
     THE FAR GROUND — what this city's ground looks like from kilometres off.
     Past the near/far swap the tiles above are dropped and the far skyline
     (metro_fabric.js) stands on the continent plate, which used to paint it
     country: the whole distant city stood on green meadow. This rasterises
     the plan's land use into one small RGBA map (~4.5 m a texel): asphalt
     streets, sidewalk rings, paved downtown blocks, courtyard blocks, yards,
     suburban lawn/driveway/shade mix, parks, plazas, parking with parked
     cars, crop strips, rail ballast. RGB = sqrt(linear albedo) from the SAME
     COL table the near tiles use (so the swap agrees), A = 0 nothing (the
     plate's own country shows) / 128 ground / 150 unlit road / 255 lamp-lit
     street. city/metro.js packs the maps into one mipmapped atlas that the
     plate's ground skin samples (world/textures_surface.js cityMap): zero
     geometry, zero draw calls. Pure and deterministic (position hashes);
     sliced: farMap(P).step(ms) returns true when done.
     ================================================================== */
  const FARMAP_CELL = 4.5, FARMAP_MAX = 1024;
  function lin(c) { return [c[0] * c[0], c[1] * c[1], c[2] * c[2]]; }   // COL is sqrt(linear)
  function mul(c, k) { return [c[0] * k[0], c[1] * k[1], c[2] * k[2]]; }
  /* ONE WORLD, SEEN FROM FURTHER AWAY (owner: "long distance and short
     distance should look the same; what changes is the horizon you can see,
     not what's in it"). Every far colour is the MEAN of what the near tile
     draws there, never a tint of its own: the COL albedo times the mean of
     mgSurface's per-pixel pattern for that surface (MG_MEAN, the averages of
     its mottle / joints / stains / dry patches / crop rows), the street
     kit's own asphalt (materials.js asphaltDetail base) and footway (the
     decoded ~122 sRGB slab canvas). tools/metro-far-ground-check.mjs holds
     it to that: per 100 m cell, far map vs the near tile's area-weighted
     mean. */
  const MG_MEAN = { lawn: [1.0, 0.965, 0.915], paving: [0.94, 0.94, 0.94], crop: 0.97, soil: [0.085, 0.06, 0.04], rowK: 0.62, dirt: 0.96, gravel: 0.99, concrete: 0.9 };
  const FM = {
    asphalt: [0.068, 0.067, 0.066], walk: [0.19, 0.186, 0.176],
    paving: mul(lin(COL.paving), MG_MEAN.paving), concrete: lin(COL.concrete).map(function (v) { return v * MG_MEAN.concrete; }),
    lawn: mul(lin(COL.lawn), MG_MEAN.lawn), park: mul(lin(COL.lawnPark), MG_MEAN.lawn), dry: mul(lin(COL.lawnDry), MG_MEAN.lawn),
    gravel: lin(COL.gravel).map(function (v) { return v * MG_MEAN.gravel; }), ballast: lin(COL.ballast).map(function (v) { return v * MG_MEAN.gravel; }),
    pavers: mul(lin(COL.paving), MG_MEAN.paving).map(function (v) { return v * 1.25; }), shade: [0.035, 0.055, 0.028], lot: [0.068, 0.067, 0.066],
    crops: COL.crops.map(function (c) { const b = lin(c), k = MG_MEAN.rowK, s = MG_MEAN.soil;
      return [(s[0] * (1 - k) + b[0] * k) * MG_MEAN.crop, (s[1] * (1 - k) + b[1] * k) * MG_MEAN.crop, (s[2] * (1 - k) + b[2] * k) * MG_MEAN.crop]; }),
    dirt: lin(COL.dirt).map(function (v) { return v * MG_MEAN.dirt; }),
    cars: [[0.62, 0.62, 0.6], [0.36, 0.37, 0.38], [0.03, 0.03, 0.035], [0.15, 0.15, 0.16], [0.32, 0.035, 0.03], [0.04, 0.08, 0.2]],
  };
  function nextPow2(n) { let p = 1; while (p < n) p *= 2; return p; }
  function farMap(P, opts) {
    opts = opts || {};
    // bounds: everything the plan paints on the ground
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    function grow(a, b, c, d) { if (a < x0) x0 = a; if (b < z0) z0 = b; if (c > x1) x1 = c; if (d > z1) z1 = d; }
    const R = [].concat(P.blocks || [], P.pads || [], P.parks || [], P.plazas || [], P.parking || [], P.fields || []);
    for (const r of R) grow(r.x0, r.z0, r.x1, r.z1);
    for (const st of P.streets || []) for (const q of st.pts) grow(q.x - st.w, q.z - st.w, q.x + st.w, q.z + st.w);
    if (!(x1 > x0)) return null;
    x0 -= 24; z0 -= 24; x1 += 24; z1 += 24;
    const cellWant = opts.cell || FARMAP_CELL, maxN = opts.max || FARMAP_MAX;
    const w = Math.min(maxN, nextPow2(Math.ceil((x1 - x0) / cellWant)));
    const cell = Math.max(cellWant, (x1 - x0) / w, (z1 - z0) / maxN);
    const h = Math.min(maxN, nextPow2(Math.ceil((z1 - z0) / cell)));
    const data = new Uint8Array(w * h * 4);
    const out = { w: w, h: h, x0: x0, z0: z0, cell: cell, data: data, ms: 0 };
    function put(i, j, c, a, k) {
      const o = (j * w + i) * 4;
      if (k < 1 && data[o + 3]) {             // edge coverage: blend over what is there
        const r0 = data[o] / 255, g0 = data[o + 1] / 255, b0 = data[o + 2] / 255;
        data[o] = Math.round(255 * Math.sqrt(r0 * r0 * (1 - k) + c[0] * k));
        data[o + 1] = Math.round(255 * Math.sqrt(g0 * g0 * (1 - k) + c[1] * k));
        data[o + 2] = Math.round(255 * Math.sqrt(b0 * b0 * (1 - k) + c[2] * k));
        data[o + 3] = Math.max(data[o + 3], Math.round(a * Math.min(1, k * 2)));
        return;
      }
      if (k < 0.5) return;
      data[o] = Math.round(255 * Math.sqrt(c[0])); data[o + 1] = Math.round(255 * Math.sqrt(c[1])); data[o + 2] = Math.round(255 * Math.sqrt(c[2]));
      data[o + 3] = a;
    }
    const tmp = [0, 0, 0];
    function vary(c, v) { tmp[0] = c[0] * v; tmp[1] = c[1] * v; tmp[2] = c[2] * v; return tmp; }
    // fill a world rect; pick(x, z) -> linear colour for that texel
    function rect(ax, az, bx, bz, a, pick) {
      const i0 = Math.max(0, Math.floor((ax - x0) / cell)), i1 = Math.min(w - 1, Math.ceil((bx - x0) / cell));
      const j0 = Math.max(0, Math.floor((az - z0) / cell)), j1 = Math.min(h - 1, Math.ceil((bz - z0) / cell));
      for (let j = j0; j <= j1; j++) {
        const cz = z0 + (j + 0.5) * cell;
        const kz = Math.max(0, Math.min(1, (Math.min(bz, cz + cell / 2) - Math.max(az, cz - cell / 2)) / cell));
        if (kz <= 0) continue;
        for (let i = i0; i <= i1; i++) {
          const cx = x0 + (i + 0.5) * cell;
          const kx = Math.max(0, Math.min(1, (Math.min(bx, cx + cell / 2) - Math.max(ax, cx - cell / 2)) / cell));
          if (kx <= 0) continue;
          put(i, j, pick(cx, cz), a, kx * kz);
        }
      }
    }
    function ring(r, wd, a, c) {                 // a band of width wd just inside a rect's edge
      rect(r.x0, r.z0, r.x1, r.z0 + wd, a, c); rect(r.x0, r.z1 - wd, r.x1, r.z1, a, c);
      rect(r.x0, r.z0 + wd, r.x0 + wd, r.z1 - wd, a, c); rect(r.x1 - wd, r.z0 + wd, r.x1, r.z1 - wd, a, c);
    }
    function seg(ax, az, bx, bz, half, a, pick) {
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - half - x0) / cell)), i1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + half - x0) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - half - z0) / cell)), j1 = Math.min(h - 1, Math.ceil((Math.max(az, bz) + half - z0) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const cx = x0 + (i + 0.5) * cell, cz = z0 + (j + 0.5) * cell;
        const d = segDist(cx, cz, ax, az, bx, bz);
        const k = Math.max(0, Math.min(1, (half - d) / cell + 0.5));
        if (k > 0) put(i, j, pick(cx, cz), a, k);
      }
    }
    function disc(x, z, r, a, pick) { seg(x, z, x + 0.01, z, r, a, pick); }
    const hv = function (x, z, salt) { return 0.94 + 0.12 * hsh(Math.floor(x / 9), Math.floor(z / 9), salt); };
    const flat = function (c, salt) { return function (x, z) { return vary(c, hv(x, z, salt)); }; };
    const tone = function (c, k) { return [c[0] * k, c[1] * k, c[2] * k]; };
    // EXACTLY what emitters() draws for each record (block(), pad(), lots),
    // as its mean: footway rings at the kerb, then the lot surface
    const ops = [];
    // a big rect is painted in 160 m bands, one slice each (no slice may
    // cost a frame)
    function bandRect(b, a, pick) {
      for (let zb = b.z0; zb < b.z1; zb += 160) {
        const zt = Math.min(b.z1, zb + 160);
        ops.push(function () { rect(b.x0, zb, b.x1, zt, a, pick); });
      }
    }
    for (const b of P.pads || []) {
      bandRect(b, 128, flat(b.use === "park" ? FM.park : FM.lawn, 901));
      ops.push(function () { ring(b, PAD_SW, 128, flat(tone(FM.walk, 0.95), 902)); });
    }
    // which blocks are a plaza or a whole parking lot (the solve's own test)
    const lotAll = new Set(), plazaB = new Set();
    for (const b of P.blocks || []) {
      const ix0 = b.x0 + b.sw, ix1 = b.x1 - b.sw, iz0 = b.z0 + b.sw, iz1 = b.z1 - b.sw;
      for (const pz of P.plazas || []) if (pz.x0 < ix1 && pz.x1 > ix0 && pz.z0 < iz1 && pz.z1 > iz0) plazaB.add(b);
      for (const pk of P.parking || []) if (pk.kind === "lot" && pk.x0 >= ix0 - 1 && pk.x1 <= ix1 + 1 && pk.z0 >= iz0 - 1 && pk.z1 <= iz1 + 1 &&
        (pk.x1 - pk.x0) * (pk.z1 - pk.z0) > (ix1 - ix0) * (iz1 - iz0) * 0.8) lotAll.add(b);
    }
    for (const b of P.blocks || []) {
      const inner = { x0: b.x0 + b.sw, x1: b.x1 - b.sw, z0: b.z0 + b.sw, z1: b.z1 - b.sw };
      const c = plazaB.has(b) ? tone(FM.walk, 0.97)
        : (b.use === "industrial" || lotAll.has(b)) ? FM.asphalt
        : (b.use === "cbd" || b.use === "midtown") ? FM.paving
        : b.use === "rows" ? FM.lawn : FM.dry;
      bandRect(inner, 128, flat(c, 903));
      const tk = b.use === "cbd" ? 1.0 : b.use === "industrial" ? 0.9 : 0.96;
      ops.push(function () { ring(b, b.sw, 128, flat(tone(FM.walk, tk), 904)); });
    }
    for (const b of P.fields || []) ops.push(function () {
      const c = b.ballfield ? FM.park : FM.crops[(b.crop | 0) % FM.crops.length];
      rect(b.x0, b.z0, b.x1, b.z1, 128, function (x, z) { return vary(c, 0.95 + 0.1 * hsh(Math.floor(x / 30), Math.floor(z / 30), 915)); });
    });
    // lots that do not fill a block (yards in industrial blocks are the
    // block's own asphalt already)
    for (const pk of P.parking || []) {
      if (pk.kind === "yard") continue;
      bandRect(pk, 128, flat(FM.asphalt, 916));
    }
    for (const r of P.rail || []) ops.push(function () {
      const ax = r.axis === "x" ? r.at : r.a0, az = r.axis === "x" ? r.a0 : r.at, bx = r.axis === "x" ? r.at : r.a1, bz = r.axis === "x" ? r.a1 : r.at;
      seg(ax, az, bx, bz, Math.max(4, (r.half || 9) * 0.6), 128, function (x, z) { return vary(FM.ballast, hv(x, z, 919)); });
    });
    for (const st of P.streets || []) ops.push(function () {
      const lit = st.k !== "rural" ? 255 : 150;
      const pk = function (x, z) { return vary(FM.asphalt, 0.95 + 0.1 * hsh(x, z, 920)); };
      for (let k = 0; k + 1 < st.pts.length; k++) seg(st.pts[k].x, st.pts[k].z, st.pts[k + 1].x, st.pts[k + 1].z, st.w / 2, lit, pk);
      if (st.closed && st.pts.length > 2) { const a = st.pts[st.pts.length - 1], b = st.pts[0]; seg(a.x, a.z, b.x, b.z, st.w / 2, lit, pk); }
      if (st.bulb && st.bulb.r) disc(st.bulb.x, st.bulb.z, st.bulb.r, lit, pk);
    });
    let k = 0;
    out.step = function (budgetMs) {
      const t0 = now(), end = t0 + (budgetMs > 0 ? budgetMs : Infinity);
      while (k < ops.length) { ops[k++](); if (now() >= end) break; }
      out.ms += now() - t0;
      return k >= ops.length;
    };
    out.ops = ops.length;
    return out;
  }

  const API = { solve: solve, prepare: prepare, buildTile: buildTile, disposeTile: disposeTile, build: build, tileArrays: tileArrays,
    farMap: farMap, FARMAP_COLOURS: FM, Y: Y, GK: GK, FK: FK };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (CBZ) CBZ.metroGround = API;
  // the grass field asks every metro in turn (world/grassfield.js)
  if (CBZ && CBZ.groundCover) CBZ.groundCover.register("metro", function (x, z, out) {
    const L = CBZ.metroCities || [];
    for (let i = 0; i < L.length; i++) { const S = L[i] && L[i].solve; if (S && S.coverAt && S.coverAt(x, z, out)) return true; }
    return false;
  }, 20);
})(typeof window !== "undefined" ? window : globalThis);
