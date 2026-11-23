/* ============================================================
   city/lowport_harbour.js — LOWPORT'S HARBOUR.

   Veridia's second town is "Lowport, the harbour town", and it had nothing
   of a harbour: a grid of shops and houses 200 m inland of a sand beach.
   This lays its working fishing harbour on that shore, east of the town at
   the end of its main street:
     · a stone quay along the coast (the plan's own coastline, walked from
       the town toward the sea), 24 m deep and following the shore, at
       grade, with its face, fender line, cope and bollards:
       city/kingsport_docks.js's harbour kit, the pieces Kingsport's
       terminal is built from;
     · the Harbour Road from the town's east street down to the quay, on the
       traffic graph;
     · a slipway at the south end with a boat hauled out on its trailer;
     · two timber jetties square to the quay out over the water on their
       piles, walkable, the fishing boats moored alongside (hull, deck,
       wheelhouse, mast and boom, a gantry on the trawler);
     · the fish market, an open shed on the quay with its slab counters and
       fish boxes, and the chandlery across the road (a closed store, its
       door and windows to the road);
     · what a working harbour leaves lying about: stacks of crates, nets,
       pots, and the quay lamps.
   Everything on the quay is laid in the coast's own frame (u along the
   shore, v out to sea), so it stands square to the water it serves.
   On a phone the nets, pots, lamps and every other pile are left out.

   COST: one merged mesh per colour (twelve), about 7k triangles, and the
   road's own deck: about what one small town block of shells costs, and
   nothing at all until a slice is near it. Landmass order 36 (after the
   nations' towns, whose street records it reads).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.addLandmass) return;
  const THREE = window.THREE;

  // (tones that come out right under this sun: colour management is off)
  const C = {
    timber: 0x2a1e13, pile: 0x1c140d, white: 0x6e6e68, roof: 0x24282b, green: 0x163a2a,
    hullRed: 0x4a0e08, hullBlue: 0x0c1e3a, hullGreen: 0x0a2412, net: 0x14301c, box: 0x0e2a46, iron: 0x141516, wall: 0x3a3026,
  };
  const WATER = -0.48;
  const D = 24;                                   // the quay's depth, face to back edge

  function settlement(id) {
    for (const cd of CBZ.COUNTRIES || []) for (const s of cd.settlements || []) if (s.id === id) return s;
    return null;
  }

  CBZ.addLandmass(function (city) {
    const K = CBZ.harbourKit, P = CBZ.worldPlan;
    if (!city || !city.root || !K || !P || !P.landAt) return;
    const S = settlement("lowport");
    if (!S) return;
    // the town's east street and its main street, as drawn
    let eastX = S.cx + S.hx, eastC = eastX - 6, RZ = S.cz;
    {
      let bv = null, bh = null;
      for (const r of city.roads || []) {
        if (!r || r.district !== "lowport" || !isFinite(r.x) || r.owner) continue;
        if (r.vertical) { if (!bv || r.x > bv.x) bv = r; }
        else if (r.main) bh = r;
        else if (!bh || (!bh.main && Math.abs(r.z - S.cz) < Math.abs(bh.z - S.cz))) bh = r;
      }
      if (bv) { eastC = bv.x; eastX = bv.x + (bv.w || 12) / 2; }
      if (bh) RZ = bh.z;
    }
    // the quay line: the coast walked east from the town, every 10 m
    const Z0 = RZ - 80, Z1 = RZ + 70;
    const line = [];
    for (let z = Z0; z <= Z1 + 0.1; z += 10) { const p = K.shore(eastX + 20, z, 1, 0, 700); if (p) line.push(p); }
    if (line.length < 8) return;
    const xAt = function (z) {
      const k = Math.max(0, Math.min(line.length - 2, Math.floor((z - line[0].z) / 10)));
      const a = line[k], b = line[k + 1];
      return a.x + (b.x - a.x) * Math.max(0, Math.min(1, (z - a.z) / (b.z - a.z || 1)));
    };
    // THE COAST'S FRAME: t along the shore (south to north), n out to sea
    let tx = line[line.length - 1].x - line[0].x, tz = line[line.length - 1].z - line[0].z;
    { const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; }
    const nx = tz, nz = -tx;                              // (+x, the sea side)
    const ROT = Math.atan2(-nz, nx);                      // a box's local x along n, local z along t
    const O = { x: xAt(RZ), z: RZ };                      // the quay face where the road comes down
    const at = function (u, v) { return { x: O.x + tx * u + nx * v, z: O.z + tz * u + nz * v }; };
    // a box in the coast's frame: (u, v) its middle, sv its size out to sea, su along the shore
    const root = city.root, H = K.begin(root), LITE = H.lite, Y = K.QUAY_Y;
    const fbox = function (col, u, y, v, sv, h, su) { const p = at(u, v); H.box(col, p.x, y, p.z, sv, h, su, ROT); };
    const fsolid = function (u, v, sv, su, y1, y0) {
      const ex = Math.abs(nx) * sv / 2 + Math.abs(tx) * su / 2, ez = Math.abs(nz) * sv / 2 + Math.abs(tz) * su / 2, p = at(u, v);
      H.solid(p.x - ex, p.z - ez, p.x + ex, p.z + ez, y1, y0);
    };

    const segs = K.quay(H, line, function (p) { return { x: p.x - nx * D, z: p.z - nz * D }; }, { x: nx, z: nz }, { bollard: 10, minDepth: 8 });
    if (!segs.length) return;
    let lineMax = -Infinity; for (const p of line) lineMax = Math.max(lineMax, p.x);
    if (CBZ.terrainFlattenUnder) CBZ.terrainFlattenUnder({ minX: eastX, maxX: lineMax + 30, minZ: Z0 - 20, maxZ: Z1 + 20, pad: 6, name: "lowport harbour" });
    // where the road meets the quay's back edge (its line, at z = RZ)
    const back = at(0, -D), bx = back.x + (tx / (tz || 1)) * (RZ - back.z);
    const uR = (RZ - back.z) / (tz || 1);                 // ...and where that is along the shore

    // ---- the slipway at the south end: a concrete ramp from the deck down
    //      into the water between two low kerbs, a boat on its trailer at the top
    {
      const u = (Z0 + 12 - RZ) / (tz || 1), RL = 20, RW = 8, yE = -2.2;
      const q = function (uu, vv, y) { const p = at(uu, vv); return [p.x, y, p.z]; };
      H.sheet(K.COL.deck, [[q(u - RW / 2, 0, Y), q(u - RW / 2, RL, yE), q(u + RW / 2, RL, yE), q(u + RW / 2, 0, Y)]], 0, 1, 0);
      for (const sg of [-1, 1]) H.sheet(K.COL.face, [[q(u + sg * RW / 2, 0, Y), q(u + sg * RW / 2, RL, yE), q(u + sg * RW / 2, RL, -4.2), q(u + sg * RW / 2, 0, -4.2)]], tx * sg, 0, tz * sg);
      for (const sg of [-1, 1]) {                                        // the kerbs, falling with the ramp
        const g = new THREE.BoxGeometry(RL, 0.3, 0.4); g.rotateZ(Math.atan2(yE - Y, RL)); g.translate(RL / 2, (Y + yE) / 2 + 0.15, 0); g.rotateY(ROT);
        const p = at(u + sg * (RW / 2 - 0.2), 0); g.translate(p.x, 0, p.z); H.put(K.COL.cope, g);
      }
      const bp = at(u, -9);
      boat(bp.x, Y + 1.8, bp.z, ROT, 8, 2.8, C.hullBlue, false);          // hauled out, on its trailer
      fbox(C.iron, u, Y + 0.35, -9, 7, 0.25, 2.2);                       // the trailer's frame
      for (const sv of [-1.5, 1.5]) for (const su of [-1.2, 1.2]) fbox(C.iron, u + su, Y + 0.32, -9 + sv, 0.7, 0.64, 0.25);
      fsolid(u, -9, 9, 3.2, Y + 3);
    }

    // ---- two timber jetties square to the quay on their piles, the boats alongside
    const JL = 28, JW = 3.2;
    const plats = (CBZ.platforms = CBZ.platforms || []);
    const fleet = [[C.hullRed, true], [C.hullGreen, false], [C.hullBlue, false], [C.hullRed, false]];
    let bi = 0;
    for (const ju of [-36, 30]) {
      fbox(C.timber, ju, Y - 0.06, JL / 2 - 0.5, JL, 0.24, JW);                       // the deck
      for (const sg of [-1, 1]) fbox(C.pile, ju + sg * (JW / 2 - 0.1), Y - 0.28, JL / 2 - 0.5, JL, 0.22, 0.22);   // the stringers
      for (let v = 2; v <= JL; v += LITE ? 8 : 4) for (const sg of [-1, 1]) fbox(C.pile, ju + sg * (JW / 2 + 0.12), -1.5, v, 0.32, 3.5, 0.32);
      // walkable: an axis-aligned platform every 3 m along it (a turned deck)
      for (let v = 0; v < JL; v += 3) { const p = at(ju, v + 1.5); plats.push({ minX: p.x - 1.5, maxX: p.x + 1.5, minZ: p.z - 1.5, maxZ: p.z + 1.5, top: Y + 0.06 }); }
      // a boat each side, bow to seaward
      for (const sg of [-1, 1]) {
        const f = fleet[bi++ % fleet.length];
        const L = f[1] ? 14 : 10, B = f[1] ? 4.4 : 3.4;
        const bu = ju + sg * (JW / 2 + 0.6 + B / 2), bv = 6 + L / 2, bp = at(bu, bv);
        boat(bp.x, WATER, bp.z, ROT, L, B, f[0], f[1]);
        fsolid(bu, bv, L, B, WATER + 2.8, WATER - 1);
      }
    }

    // ---- the harbour road, the town's main street run on to the quay
    const ROAD_W = 9;
    if (CBZ.buildHighway) {
      CBZ.buildHighway(root, { path: [{ x: eastX, z: RZ }, { x: bx + 1, z: RZ }], width: ROAD_W, lanesPerDir: 1, median: false,
        laneW: 3.6, theme: "asphalt", registerRoads: false, owner: "lowportharbour", guardrail: false });
    }
    if (city.roads) city.roads.push({ x: (eastC + bx + 1) / 2, z: RZ, vertical: false, len: bx + 1 - eastC, district: "lowport",
      w: ROAD_W, lanesPerDir: 1, laneW: 3.6, owner: "lowportharbour", name: "Harbour Road" });
    CBZ.registerCityRegion(city, { name: "Harbour Road", subtitle: "Lowport", kind: "rect", road: true,
      minX: eastX, maxX: bx + 2, minZ: RZ - ROAD_W / 2 - 1, maxZ: RZ + ROAD_W / 2 + 1, pad: 1 });

    // ---- the fish market: an open shed on the quay north of the road, its
    //      slab counters and boxes under the roof, a closed back wall
    {
      const mu = uR + 19, mv = -12, MW = 22, MD = 10, MH = 4.2;      // MW along the shore, MD across
      for (const su of [-MW / 2 + 0.3, -MW / 6, MW / 6, MW / 2 - 0.3]) for (const sv of [-MD / 2 + 0.3, MD / 2 - 0.3]) {
        fbox(C.green, mu + su, Y + MH / 2, mv + sv, 0.3, MH, 0.3);
        fsolid(mu + su, mv + sv, 0.4, 0.4, Y + MH);
      }
      fbox(C.white, mu, Y + MH / 2, mv - MD / 2 + 0.1, 0.2, MH, MW);                    // the back wall, on the landward side
      fsolid(mu, mv - MD / 2 + 0.1, 0.3, MW, Y + MH);
      for (const sg of [-1, 1]) {                                                       // the roof: two pitches over the ridge
        const g = new THREE.BoxGeometry(MD / 2 + 0.9, 0.14, MW + 1.2);
        g.rotateZ(-sg * 0.32); g.translate(sg * (MD / 4 + 0.2), Y + MH + 0.8, 0); g.rotateY(ROT);
        const p = at(mu, mv); g.translate(p.x, 0, p.z); H.put(C.roof, g);
      }
      fbox(C.green, mu, Y + MH + 0.22, mv, 0.3, 0.35, MW + 0.2);                         // the ridge beam
      for (const sv of [-1.6, 1.6]) {
        fbox(C.white, mu, Y + 0.45, mv + sv, 1.2, 0.9, MW - 4);                          // the slab counters
        if (!LITE) for (let k = 0; k < 6; k++) fbox(C.box, mu - MW / 2 + 3.5 + k * 3, Y + 1.02, mv + sv, 0.7, 0.24, 1.0);
      }
      fsolid(mu, mv, 4.4, MW - 4, Y + 0.95);
    }
    // ---- the chandlery, south of the road: a closed store, its door and
    //      windows to the road
    {
      const cu = uR - 15, cv = -14, CW = 12, CD = 8, CH = 4.4;                          // CW along the shore
      fbox(C.wall, cu, Y + CH / 2, cv, CD, CH, CW);
      fbox(C.roof, cu, Y + CH + 0.15, cv, CD + 0.8, 0.3, CW + 0.8);
      fbox(C.iron, cu + CW / 2 + 0.04, Y + 1.1, cv, 1.2, 2.2, 0.1);                     // the door, to the road (+u)
      for (const sv of [-2.2, 2.2]) fbox(C.iron, cu + CW / 2 + 0.04, Y + 1.8, cv + sv, 1.8, 1.3, 0.08);   // the windows
      fbox(C.white, cu + CW / 2 + 0.1, Y + 2.95, cv, CD - 1, 0.5, 0.12);                // the board over them
      fsolid(cu, cv, CD, CW, Y + CH);
    }
    // ---- what lies about on the quay: crate stacks, nets, pots, lamps
    {
      for (const s of [[8, -4], [-30, -6], [44, -18], [-52, -10]]) {
        const n = 3 + (Math.abs(Math.round(s[0] * 7 + s[1] * 3)) % 3);
        for (let k = 0; k < n; k++) fbox(C.timber, s[0] + (k % 2) * 1.3, Y + 0.4 + Math.floor(k / 2) * 0.8, s[1], 1.2, 0.8, 1.2);
        fsolid(s[0] + 0.6, s[1], 1.4, 2.6, Y + 1.6);
      }
      if (!LITE) {
        for (const nu of [4, -24, 50]) {                                                  // the nets, heaped by the edge
          fbox(C.net, nu, Y + 0.25, -4, 2.2, 0.5, 3.2);
          fbox(C.net, nu + 0.2, Y + 0.6, -3.6, 1.4, 0.35, 1.8);
        }
        for (let k = 0; k < 8; k++) fbox(C.iron, uR - 34 + (k % 4) * 0.9, Y + 0.3 + Math.floor(k / 4) * 0.6, -14, 0.6, 0.6, 0.8);   // the pots
        for (const lu of [-60, -20, 20, 58]) {                                            // the quay lamps
          fbox(C.iron, lu, Y + 3, -3, 0.18, 6, 0.18);
          fbox(C.iron, lu, Y + 6, -2.4, 1.4, 0.12, 0.12);
          fbox(C.white, lu, Y + 5.85, -1.8, 0.3, 0.18, 0.5);
          fsolid(lu, -3, 0.3, 0.3, Y + 6);
        }
      }
    }

    // a boat: hull (a box and a pointed bow), a timber deck, a wheelhouse aft
    // of midships, a mast and boom; a trawler carries a gantry over its stern.
    // (x, z) its middle, y its waterline, heading: its bow along the box
    // helper's local +x turned by `heading`.
    function boat(x, y, z, heading, L, B, hull, trawler) {
      const parts = [];
      const add = function (col, g) { parts.push([col, g]); };
      const BL = L * 0.72, BOW = L - BL, BD = 1.9;
      { const g = new THREE.BoxGeometry(BL, BD, B); g.translate(-L / 2 + BL / 2, 0.4 - BD / 2 + 0.25, 0); add(hull, g); }
      {
        // the bow: a three-sided prism, one edge forward at +x
        const g = new THREE.CylinderGeometry(1, 1, BD, 3);
        g.rotateY(Math.PI / 2);                                          // its point from +z to +x
        g.scale(BOW / 1.5, 1, B / 1.732);
        g.translate(-L / 2 + BL + BOW / 3, 0.4 - BD / 2 + 0.25, 0);
        add(hull, g);
      }
      { const g = new THREE.BoxGeometry(BL - 0.4, 0.08, B - 0.4); g.translate(-L / 2 + BL / 2, 0.68, 0); add(C.timber, g); }
      { const g = new THREE.BoxGeometry(L * 0.22, 1.9, B * 0.62); g.translate(-L * 0.08, 0.68 + 0.95, 0); add(C.white, g); }
      { const g = new THREE.BoxGeometry(L * 0.24, 0.1, B * 0.7); g.translate(-L * 0.08, 0.68 + 1.95, 0); add(C.roof, g); }
      { const g = new THREE.BoxGeometry(0.16, 5.2, 0.16); g.translate(L * 0.12, 0.68 + 2.6, 0); add(C.iron, g); }
      { const g = new THREE.BoxGeometry(L * 0.34, 0.1, 0.1); g.rotateZ(-0.35); g.translate(0, 0.68 + 3.4, 0); add(C.iron, g); }
      if (trawler) {
        for (const sg of [-1, 1]) { const g = new THREE.BoxGeometry(0.2, 3.6, 0.2); g.translate(-L / 2 + 0.6, 0.68 + 1.8, sg * (B / 2 - 0.3)); add(C.iron, g); }
        { const g = new THREE.BoxGeometry(0.2, 0.2, B - 0.4); g.translate(-L / 2 + 0.6, 0.68 + 3.6, 0); add(C.iron, g); }
        if (!LITE) { const g = new THREE.BoxGeometry(2.4, 0.5, B * 0.6); g.translate(-L / 2 + 2.2, 0.68 + 0.3, 0); add(C.net, g); }
      }
      for (const pr of parts) { pr[1].rotateY(heading); pr[1].translate(x, y, z); H.put(pr[0], pr[1]); }
    }

    H.flush("lowport-harbour");

    // the quay's ground: strips that follow it (a region holds land,
    // city/waterfield.js: down to the quay line and no further)
    for (let i = 0; i + 5 < line.length; i += 5) {
      const seg = line.slice(i, i + 6);
      let xf = 1e9, xb = 1e9, z0 = 1e9, z1 = -1e9;
      for (const p of seg) { xf = Math.min(xf, p.x); xb = Math.min(xb, p.x - nx * D); z0 = Math.min(z0, p.z, p.z - nz * D); z1 = Math.max(z1, p.z, p.z - nz * D); }
      CBZ.registerCityRegion(city, { name: "Lowport Harbour", subtitle: "Fishing Harbour", kind: "rect", biome: "lowport",
        minX: xb - 2, maxX: xf + 1, minZ: z0, maxZ: z1, pad: 0 });
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }, 36);
})();
