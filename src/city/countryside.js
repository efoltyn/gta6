/* ============================================================
   city/countryside.js — THE COUNTRY'S PEOPLE: farms, roadside houses and the
   gas stop at the junction, planned from the world zoning field.

   OWNER (iPad): "everything feeling overly sparse ... Sparse is fine, but it
   just feels like different parts were done unintentionally."

   MEASURED BEFORE THIS FILE (tools/layout-audit.mjs, seed 90210): 79 of
   10,100 ha of open country had any building at all, and every one of those
   belonged to a metro's own exurb ring. The continent already grows the
   LAND of a countryside — crop parcels on a 190 m grid round every town,
   hedgerows, woods on the uplands (city/continent.js) — but nobody lived on
   it: a field with no farm, a country road with no house, a junction with no
   gas station. That is the "done unintentionally" feeling in the country.

   THIS FILE IS A PLANNER, pure data like city/metroplan.js (no THREE, no
   rng stream, every choice a position hash). It reads:
     - the ZONING FIELD (city/zoning.js): exurb ground (intensity .08-.18)
       gets houses on big lots along the road; rural ground (< .08) gets
       farmsteads; protected ground and the freeway buffer get nothing;
     - the COUNTRY ROADS: the network's two-lane routes (highwaynet.js
       `rural` entries: the town links) and every rural road record a biome
       registered (the Coyle causeway). Freeways get no frontage: nobody's
       drive opens onto a six-lane motorway;
     - every registered REGION (towns, biomes, compounds, metros): nothing is
       planned inside a place that already has an owner.
   It returns a plan in the metro planner's own vocabulary (house / barn /
   silo / ware / strip buildings, trees), which city/metro.js streams through
   the same fabric as every city: one merged draw per 800 m tile, a far HLOD,
   colliders only near the camera. The ground under every yard is declared
   built (CBZ.terrainFlattenUnder) so the continent lays it flat and the
   buildings stand on it. The gas stations are the real forecourt
   (world/fuel_station.js) and they pump fuel (city/fuel.js reads
   CBZ.fuelForecourts).

   DENSITY IS BUDGETED, NOT SPRINKLED: a farmstead every 260-380 m of road,
   a house every 110-170 m in the exurb band, one gas stop + diner per
   country-road junction with the Loop.

   Exposes CBZ.countrysidePlan(city, zoning) -> plan | null.
============================================================ */
(function (G) {
  "use strict";
  const CBZ = (G.CBZ = G.CBZ || {});

  function lib() { return CBZ.metroPlanLib || null; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function r2(v) { return Math.round(v * 100) / 100; }

  const ROADLIKE = /bridge|causeway|link|approach|spur|connector|corridor|ramp|highway|road/i;

  function plan(city, Z) {
    const L = lib();
    if (!L || !city || !Z) return null;
    const h01 = function (x, z, salt) { return L.h01(0x0c0f17e ^ ((CBZ.WORLD_SEED | 0) * 31), x, z, salt); };
    const SUB = L.LOOKS.suburb;
    const P = { id: "countryside", name: "Countryside", tier: "town", bldgs: [], trees: [], districts: [],
      pads: [], forecourts: [], diners: [], uniform: false, stats: null };

    // ---- what is already somebody's: every place, every road, every freeway
    const places = [], builtPlaces = [];
    const LAND_COVER = /^(desert|forest|farmland|snow)$/;
    for (const r of city.regions || []) {
      if (!r || r.kind === "circle" || r.underlay || r.biome === "wilds" || !isFinite(r.minX)) continue;
      if (ROADLIKE.test(r.name || "") && Math.min(r.maxX - r.minX, r.maxZ - r.minZ) <= 40) continue;
      places.push({ minX: r.minX - 40, maxX: r.maxX + 40, minZ: r.minZ - 40, maxZ: r.maxZ + 40 });
      // a biome's whole ground (the Saltlands is one region 4.5 km across)
      // refuses a farm, not a gas station on the road through it
      if (!LAND_COVER.test(r.biome || "")) builtPlaces.push({ minX: r.minX - 20, maxX: r.maxX + 20, minZ: r.minZ - 20, maxZ: r.maxZ + 20 });
    }
    for (const r of city.regions || []) if (r && r.kind === "circle" && isFinite(r.cx)) places.push({ minX: r.cx - r.r - 40, maxX: r.cx + r.r + 40, minZ: r.cz - r.r - 40, maxZ: r.cz + r.r + 40 });
    for (const w of city.waterBodies || []) {
      if (w && w.kind === "circle" && isFinite(w.cx)) places.push({ minX: w.cx - w.r - 30, maxX: w.cx + w.r + 30, minZ: w.cz - w.r - 30, maxZ: w.cz + w.r + 30 });
      else if (w && w.bbox) places.push({ minX: w.bbox.minX - 30, maxX: w.bbox.maxX + 30, minZ: w.bbox.minZ - 30, maxZ: w.bbox.maxZ + 30 });
    }
    // every road's carriageway (records + the network table), for clearance
    const roads = [];
    for (const r of city.roads || []) {
      if (!r || !isFinite(r.x) || !isFinite(r.len)) continue;
      const hw = (r.w || r.width || 10) / 2, h = r.len / 2;
      roads.push(r.vertical ? { minX: r.x - hw, maxX: r.x + hw, minZ: r.z - h, maxZ: r.z + h } : { minX: r.x - h, maxX: r.x + h, minZ: r.z - hw, maxZ: r.z + hw });
    }
    const table = CBZ.highwayNetTable ? CBZ.highwayNetTable() : [];
    for (const route of table) {
      const hw = route.width / 2 + (route.rural ? 1 : 4);
      for (let i = 0; i + 1 < route.pts.length; i++) {
        const a = route.pts[i], b = route.pts[i + 1];
        roads.push({ minX: Math.min(a.x, b.x) - hw, maxX: Math.max(a.x, b.x) + hw, minZ: Math.min(a.z, b.z) - hw, maxZ: Math.max(a.z, b.z) + hw });
      }
      // a corner's fillet arc cuts inside the corner: keep its square clear
      const F = (route.fillet || 0) + hw;
      for (let i = 1; i + 1 < route.pts.length; i++) {
        const c = route.pts[i];
        roads.push({ minX: c.x - F, maxX: c.x + F, minZ: c.z - F, maxZ: c.z + F });
      }
    }
    const taken = [];
    function hits(list, x0, z0, x1, z1) {
      for (const r of list) if (x1 > r.minX && x0 < r.maxX && z1 > r.minZ && z0 < r.maxZ) return true;
      return false;
    }
    // A HOME stands 70 m back from a freeway's edge (the owner: "houses too
    // close to highway"). The zoning field's own buffer (Z.BUFFER, 30 m) is a
    // city's sound-wall setback, where land is short; out here land is not,
    // and a house on a country road that tees off a freeway, or beside a
    // 3+3 causeway a place built for itself, used to stand 30 m off it.
    const HOME_SETBACK = 72;
    function free(x0, z0, x1, z1, setback) {
      if (hits(places, x0, z0, x1, z1) || hits(roads, x0, z0, x1, z1) || hits(taken, x0, z0, x1, z1)) return false;
      // protected land (bases, airfields, bunkers + their clear buffer): the
      // whole footprint, not a few sample points
      if (Z.protectedHit ? Z.protectedHit(x0, z0, x1, z1) : Z.protectedAt((x0 + x1) / 2, (z0 + z1) / 2)) return false;
      // the freeway buffer, sampled at the corners + centre
      const pts = [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2]];
      const buf = setback == null ? Z.BUFFER : setback;
      for (const p of pts) if (Z.freewayEdge(p[0], p[1]) < buf) return false;
      // THE GEOGRAPHY (the world plan): a farm stands on land, back from the
      // shore; nobody farms the Saltlands' sand; and the range is not farmed.
      // (A country road crosses all three: the Overseas Highway runs down the
      // desert and out over the Keys with nothing beside it.)
      const WP = CBZ.worldPlan;
      if (WP && WP.landAt) for (const p of pts) {
        if (WP.landAt(p[0], p[1]) < 70 || WP.riverDist(p[0], p[1]) < 110) return false;
        if (WP.coverAt(p[0], p[1], "desert") > 0.25) return false;
        if (WP.reliefAt(p[0], p[1]).h > 28) return false;
      }
      return true;
    }
    function take(x0, z0, x1, z1, pad) {
      taken.push({ minX: x0 - pad, maxX: x1 + pad, minZ: z0 - pad, maxZ: z1 + pad });
      P.pads.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
    }
    function bld(b) { b.x = r2(b.x); b.z = r2(b.z); b.id = P.bldgs.length; P.bldgs.push(b); return b; }
    function tree(x, z, k) { P.trees.push({ x: r2(x), z: r2(z), s: r2(lerp(0.85, 1.25, h01(x, z, 41))), k: k }); }

    // ---- the frontage roads: axis-aligned legs of every country road
    const legs = [];
    for (const route of table) {
      if (!route.rural) continue;
      for (let i = 0; i + 1 < route.pts.length; i++) legs.push({ a: route.pts[i], b: route.pts[i + 1], half: route.width / 2, name: route.name });
    }
    for (const r of city.roads || []) {
      if (!r || !r.rural || r.metro || r.district !== "highway" || !isFinite(r.x)) continue;
      const h = r.len / 2;
      legs.push(r.vertical ? { a: { x: r.x, z: r.z - h }, b: { x: r.x, z: r.z + h }, half: (r.w || 11) / 2, name: r.owner || "road" }
                           : { a: { x: r.x - h, z: r.z }, b: { x: r.x + h, z: r.z }, half: (r.w || 11) / 2, name: r.owner || "road" });
    }

    // ---- a FARMSTEAD beside the road at (px,pz), its yard opening on it
    //      (n = unit normal from the road into the yard). Laid out in road
    //      terms: u runs along the road, v away from it; footprints below are
    //      [u extent, v extent] and never overlap.
    //        house  u -27..-13  v 20..32   (faces the road)
    //        barn   u   5..23   v 37..63
    //        silo   u  26..34   v 40..48
    //        shed   u -26..-6   v 52..64
    //        windbreak along v 77, the yard tree behind the house
    function farmstead(px, pz, nx, nz, half) {
      const ax = Math.abs(nx) > 0.5;                       // the road runs along z
      const toW = function (u, v) { return ax ? { x: px + nx * (half + v), z: pz + u } : { x: px + u, z: pz + nz * (half + v) }; };
      const ext = function (eu, ev) { return ax ? { w: ev, d: eu } : { w: eu, d: ev }; };
      const A = toW(-36, 12), B = toW(36, 80);
      const x0 = Math.min(A.x, B.x), x1 = Math.max(A.x, B.x), z0 = Math.min(A.z, B.z), z1 = Math.max(A.z, B.z);
      if (!free(x0, z0, x1, z1, HOME_SETBACK)) return false;
      take(x0, z0, x1, z1, 6);
      const f = h01(px, pz, 11) < 0.5 ? 1 : -1;             // mirror the yard
      const lk = SUB[(h01(px, pz, 12) * SUB.length) | 0];
      const H = toW(-20 * f, 26);
      bld({ x: H.x, z: H.z, w: 14, d: 11, rot: r2(Math.atan2(-nx, -nz)), h: 6, st: 2, fh: 3, type: "house", style: "house",
        wall: lk.walls[(h01(px, pz, 13) * lk.walls.length) | 0], roofCol: lk.roofs[(h01(px, pz, 14) * lk.roofs.length) | 0],
        roof: "gable", garage: false, face: "rot", farm: true });
      const Bn = toW(14 * f, 50), be = ext(18, 26);
      bld({ x: Bn.x, z: Bn.z, w: be.w, d: be.d, rot: 0, h: 9, st: 1, fh: 9, type: "barn", style: "barn",
        wall: h01(px, pz, 15) < 0.7 ? 0x8a2e22 : 0x9a8a72, roofCol: 0x55565a, roof: "gambrel" });
      const S = toW(30 * f, 44);
      bld({ x: S.x, z: S.z, w: 7, d: 7, rot: 0, h: r2(lerp(13, 18, h01(px, pz, 16))), st: 1, fh: 16, type: "silo", style: "metal", wall: 0xc9cbc8, roof: "dome" });
      if (h01(px, pz, 17) < 0.6) {
        const M = toW(-16 * f, 58), me = ext(20, 12);
        bld({ x: M.x, z: M.z, w: me.w, d: me.d, rot: 0, h: 6, st: 1, fh: 6, type: "ware", style: "metal", wall: 0x8c9296, roof: "flat" });
      }
      for (let u = -32; u <= 32; u += 8) { const T = toW(u, 77); tree(T.x, T.z, "hedge"); }
      const T2 = toW(-20 * f, 40); tree(T2.x, T2.z, "yard");
      return true;
    }
    // ---- a HOUSE on a big lot facing the road
    function house(px, pz, nx, nz, half) {
      const setback = lerp(12, 20, h01(px, pz, 21));
      const w = lerp(11, 15, h01(px, pz, 22)), d = lerp(9, 12, h01(pz, px, 23));
      const off = half + setback + d / 2;
      const x = px + nx * off, z = pz + nz * off;
      const R = Math.max(w, d) / 2 + 8;
      if (!free(x - R, z - R, x + R, z + R, HOME_SETBACK)) return false;
      take(x - R, z - R, x + R, z + R, 10);
      const lk = SUB[(h01(px, pz, 24) * SUB.length) | 0];
      const st = h01(px, pz, 25) < 0.4 ? 2 : 1;
      bld({ x: x, z: z, w: w, d: d, rot: r2(Math.atan2(-nx, -nz)), h: st * 3.0, st: st, fh: 3.0, type: "house", style: "house",
        wall: lk.walls[(h01(px, pz, 26) * lk.walls.length) | 0], roofCol: lk.roofs[(h01(px, pz, 27) * lk.roofs.length) | 0],
        roof: h01(px, pz, 28) < 0.6 ? "gable" : "hip", garage: h01(px, pz, 29) < 0.7, face: "rot",
        drive: { x: px + nx * (half + 2), z: pz + nz * (half + 2) } });
      if (h01(x, z, 30) < 0.8) tree(x - nx * (d / 2 + 6) + (nz !== 0 ? 5 : 0), z - nz * (d / 2 + 6) + (nx !== 0 ? 5 : 0), "yard");
      return true;
    }

    // ---- THE PLAN'S OWN ROADSIDE (src/world/worldplan.js `stops`, `towns`):
    //      the gas stations and diners it stood where nobody else is (the long
    //      desert leg of the Overseas Highway, Brandt Crossing's corner), and
    //      the grain elevator of every elevator town, on the road beside it.
    //      They claim their ground before any farm. A stop is not a farm: the
    //      desert and the freeway buffer do not refuse it, only the sea, a
    //      place, a road or another claim does.
    const WPL = CBZ.worldPlan;
    function stopFree(x0, z0, x1, z1) {
      if (hits(builtPlaces, x0, z0, x1, z1) || hits(roads, x0, z0, x1, z1) || hits(taken, x0, z0, x1, z1)) return false;
      if (WPL && WPL.landAt) for (const p of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) if (WPL.landAt(p[0], p[1]) < 30) return false;
      return true;
    }
    for (const S of (WPL && WPL.stops) || []) {
      const ax = S.axis === "z";                        // the road runs along z: its normal is x
      const at = function (along, side, off) { return ax ? { x: S.roadAt + side * (S.half + off), z: along } : { x: along, z: S.roadAt + side * (S.half + off) }; };
      const F = at(S.along, S.side, 16);
      if (stopFree(F.x - 14, F.z - 14, F.x + 14, F.z + 14)) {
        take(F.x - 14, F.z - 14, F.x + 14, F.z + 14, 4);
        const nx = ax ? S.side : 0, nz = ax ? 0 : S.side;
        P.forecourts.push({ x: r2(F.x), z: r2(F.z), rotY: Math.round(Math.atan2(nx, nz) / (Math.PI / 2)) * (Math.PI / 2), road: S.road, name: S.name });
      }
      if (S.diner) {
        const D = at(S.diner.along, S.diner.side, 16), bw = ax ? 14 : 24, bd = ax ? 24 : 14;
        if (stopFree(D.x - bw / 2 - 8, D.z - bd / 2 - 8, D.x + bw / 2 + 8, D.z + bd / 2 + 8)) {
          take(D.x - bw / 2 - 8, D.z - bd / 2 - 8, D.x + bw / 2 + 8, D.z + bd / 2 + 8, 4);
          // the shopfront faces the road ("s" = -z, "n" = +z, the planner's faces)
          const face = ax ? (S.diner.side > 0 ? "w" : "e") : (S.diner.side > 0 ? "s" : "n");
          bld({ x: D.x, z: D.z, w: bw, d: bd, rot: 0, h: 5, st: 1, fh: 5, type: "strip", style: "strip", wall: 0xd8cbb0, glass: 0x33424c,
            roof: "flat", shop: true, face: face, diner: true });
          P.diners.push({ x: r2(D.x), z: r2(D.z), road: S.road });
        }
      }
    }
    // THE ELEVATORS: two rows of four concrete silos and the headhouse at
    // their end, 30 m off the road beside the town (minicities.js lays the
    // siding between them and the road). In road terms: u along the road
    // from the town's link, v away from the road toward the town.
    P.elevators = [];
    for (const T of (WPL && WPL.towns) || []) {
      if (T.reason !== "elevator") continue;
      const vert = T.side === "E" || T.side === "W";
      const vs = (T.side === "N" || T.side === "W") ? 1 : -1;         // +v is +z (N) / +x (W)
      const w = function (u, v) { return vert ? { x: T.roadAt + vs * v, z: T.cz + u } : { x: T.cx + u, z: T.roadAt + vs * v }; };
      const U0 = 96, V0 = T.half + 30, PITCH = 9.3;
      const A = w(U0 - 4, V0 - 4), B = w(U0 + 4 * PITCH + 22, V0 + 2 * PITCH + 12);
      const x0 = Math.min(A.x, B.x), x1 = Math.max(A.x, B.x), z0 = Math.min(A.z, B.z), z1 = Math.max(A.z, B.z);
      if (hits(taken, x0, z0, x1, z1)) continue;
      take(x0, z0, x1, z1, 4);
      // the silos and the headhouse: the metro planner's grain elevator
      // (city/metroplan.js grainElevator, the one builder), u along the road
      // from U0 and v away from it from V0
      const E = L.grainElevator(function (a0, a1, b0, b1, rec) {
        const p = w(U0 + a0, V0 + b0), q = w(U0 + a1, V0 + b1);
        return bld(Object.assign({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, w: Math.abs(q.x - p.x), d: Math.abs(q.z - p.z), rot: 0 }, rec));
      }, { n: 4, siloH: 34, headH: 48, era: 1931 });
      if (E.head) P.elevators.push({ town: T.id, name: T.name + " Grain Elevator", x: r2(E.head.x), z: r2(E.head.z) });
    }

    // ---- FIRST the GAS STOP + DINER where a country road meets the Loop
    //      (they claim the junction before any house can): the
    //      forecourt on one side of the country road, the diner across it,
    //      both 40-70 m in from the freeway's edge
    for (const route of table) {
      if (!route.rural) continue;
      const a = route.pts[0], b = route.pts[1];
      // only routes that leave a freeway (their first point on a deck edge)
      let onFreeway = false;
      for (const fr of table) {
        if (fr.rural) continue;
        for (let i = 0; i + 1 < fr.pts.length; i++) {
          const p = fr.pts[i], q = fr.pts[i + 1];
          const d = L.segDist(a.x, a.z, p.x, p.z, q.x, q.z);
          if (d < fr.width / 2 + 2) onFreeway = true;
        }
      }
      if (!onFreeway) continue;
      const Lr = Math.hypot(b.x - a.x, b.z - a.z); if (Lr < 140) continue;
      const tx = (b.x - a.x) / Lr, tz = (b.z - a.z) / Lr, nx = -tz, nz = tx;
      const half = route.width / 2;
      // the forecourt: 26 x 26, its road edge on the country road
      const fu = 60, fx = a.x + tx * fu + nx * (half + 16), fz = a.z + tz * fu + nz * (half + 16);   // the lot front 2 m off the carriageway
      if (free(fx - 14, fz - 14, fx + 14, fz + 14)) {
        take(fx - 14, fz - 14, fx + 14, fz + 14, 4);
        // the station's local -z faces the road: rotY turns -z onto -n
        const rotY = Math.round(Math.atan2(nx, nz) / (Math.PI / 2)) * (Math.PI / 2);
        P.forecourts.push({ x: r2(fx), z: r2(fz), rotY: rotY, road: route.name });
      }
      const du = 64, dxw = a.x + tx * du - nx * (half + 16), dzw = a.z + tz * du - nz * (half + 16);
      const dw = 24, dd = 14;
      const ax = Math.abs(nx) > 0.5;
      const bw = ax ? dd : dw, bd = ax ? dw : dd;
      if (free(dxw - bw / 2 - 8, dzw - bd / 2 - 8, dxw + bw / 2 + 8, dzw + bd / 2 + 8)) {
        take(dxw - bw / 2 - 8, dzw - bd / 2 - 8, dxw + bw / 2 + 8, dzw + bd / 2 + 8, 4);
        // the strip's shopfront faces the country road
        const face = ax ? (nx > 0 ? "e" : "w") : (nz > 0 ? "n" : "s");      // the planner's faces: "s" = -z, "n" = +z
        bld({ x: dxw, z: dzw, w: bw, d: bd, rot: 0, h: 5, st: 1, fh: 5, type: "strip", style: "strip", wall: 0xd8cbb0, glass: 0x33424c,
          roof: "flat", shop: true, face: face, diner: true });
        P.diners.push({ x: r2(dxw), z: r2(dzw), road: route.name });
      }
    }

    // ---- walk every country road; the zoning field picks what each stretch is
    for (const g of legs) {
      const dx = g.b.x - g.a.x, dz = g.b.z - g.a.z, Lg = Math.hypot(dx, dz);
      if (Lg < 60) continue;
      const tx = dx / Lg, tz = dz / Lg, nx = -tz, nz = tx;
      let t = 40 + h01(g.a.x, g.a.z, 31) * 60;
      while (t < Lg - 40) {
        const px = g.a.x + tx * t, pz = g.a.z + tz * t;
        const I = Z.intensityAt(px, pz);
        const side = h01(px, pz, 32) < 0.5 ? 1 : -1;
        let placed = false;
        if (I >= 0.08 && I < 0.33) {                       // exurb: a house on a big lot
          placed = house(px, pz, nx * side, nz * side, g.half) || house(px, pz, -nx * side, -nz * side, g.half);
          t += placed ? lerp(110, 170, h01(px, pz, 33)) : 30;
        } else if (I < 0.08) {                             // rural: a farm
          placed = farmstead(px, pz, nx * side, nz * side, g.half) || farmstead(px, pz, -nx * side, -nz * side, g.half);
          t += placed ? lerp(260, 380, h01(px, pz, 34)) : 40;
        } else t += 60;                                    // town ground: the town builds it
      }
    }

    // ---- the footprint the streamer reads
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const b of P.bldgs) { minX = Math.min(minX, b.x - 30); maxX = Math.max(maxX, b.x + 30); minZ = Math.min(minZ, b.z - 30); maxZ = Math.max(maxZ, b.z + 30); }
    if (!P.bldgs.length) { minX = maxX = minZ = maxZ = 0; }
    P.stats = { footprint: { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ }, buildings: P.bldgs.length,
      farms: P.bldgs.filter(function (b) { return b.type === "barn"; }).length,
      houses: P.bldgs.filter(function (b) { return b.type === "house" && !b.farm; }).length,
      forecourts: P.forecourts.length, diners: P.diners.length, trees: P.trees.length };
    return P;
  }

  CBZ.countrysidePlan = plan;
  if (typeof module !== "undefined" && module.exports) module.exports = { plan: plan };
})(typeof window !== "undefined" ? window : globalThis);
