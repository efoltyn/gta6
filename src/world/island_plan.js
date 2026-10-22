/* ============================================================
   world/island_plan.js — THE DISASTER ISLAND, LAID OUT AS A PLACE.

   The island used to be a 120 m disc with a volcano in the dead centre, a
   5 x 5 street lattice painted over everything flat, and ~30 buildings
   dropped at random angles from the middle and then shoved onto the nearest
   kerb, every one of them with its front door on -z whichever side of the
   street it stood. It read as a sample book on a lawn.

   This file is the PLAN of a small volcanic harbour town on a 240 m island,
   as data, with no THREE in it (node runs it: tools/island-check.mjs):

     TERRAIN     a coastal plain that climbs ~4 m from the beach to the
                 interior, the volcano off to the north-west with its breach
                 facing the town, three lesser hills, and a GHAUT (the dry
                 ravine every Caribbean volcano town has) running from the
                 breach down through the west of town to the beach: the bed
                 lahars and flash floods take, crossed by road bridges.
     HARBOUR     reclaimed land out over the south beach with a sheet-piled
                 quay face, a rubble breakwater enclosing the basin, a
                 lighthouse on its head, marina jetties and a cargo pier.
     STREETS     a downtown grid behind the waterfront, residential grids
                 west and north, an industrial grid on the east, a ring road
                 round the lot, a farm road out to the north and the coast
                 road on the quay. Axis-aligned (the street kit lays
                 pieces and junctions; world/island_roads.js plan()).
     LOTS        every building on a lot that faces its street: frontage,
                 setback, side yards and depth by district, the door on the
                 street side (yaw), density and height falling off from the
                 harbour core, the building types that belong in each
                 district (towers downtown, houses on the residential
                 streets, villas on the estates, sheds in the industrial
                 blocks, harbour buildings on the quay). Lots never overlap
                 each other, a road corridor, the ghaut, the water or a hill.
     PLACES      the town square, car parks, the car showroom, filling
                 stations, the helipad hotel, the beach, farm fields.
     CARS        a slot for every parked car: kerbside on the residential
                 streets (facing the way its lane runs), in the bays of the
                 car parks and on house driveways.
     BOATS       a berth for every moored hull in the harbour.

   Everything is a position hash or a fixed list: no Math.random, no rng
   stream, the same island on every boot.

   API (CBZ.islandPlan)
     make({ cx, cz, R, facades:[ids], tall:{id:minStoreys}, low:{id:maxStoreys} }) -> plan
       plan.R, plan.cx, plan.cz
       plan.plainAt(x, z)      the plain (>= 0 inside R, 0 at the coast),
                               ghaut carved in
       plan.plainBaseAt(x, z)  the plain without the ghaut (bridge decks)
       plan.madeAt(x, z)       quay / pier fill / breakwater top, or -Infinity
       plan.hills              [{x, z, r, peak, volcano?}] volcano first
       plan.ghaut              {pts:[{x,z}], half, bank, depth}
       plan.harbour            {quay, face, basin, breakwater, piers, light, berths}
       plan.streets            {ave:[{at, runs, name}], cross:[...]} (world)
       plan.roads              island_roads plan() result, or null
       plan.bridges            [{x0,x1,z0,z1, vertical, at}]
       plan.lots               [{id, x, z, w, d, yaw, door, lot:{x0,x1,z0,z1},
                                 bx0..bz1 (footprint, world), district, kind,
                                 storeys, style, gyHint, driveway?, helipad?,
                                 use (cfg.venues only: see assignUses), name?}]
       plan.parking, plan.plaza, plan.showroom, plan.stations, plan.fields,
       plan.beaches, plan.trees, plan.cars, plan.districts, plan.lowGround
     check(plan) -> { overlaps, lotLine, onRoad, carsOffRoad, ... } pure audit
============================================================ */
(function () {
  "use strict";
  const G = typeof window !== "undefined" ? window : globalThis;
  const CBZ = G.CBZ = G.CBZ || {};

  // ---- street section: world/island_roads.js is the source of truth -------
  function roadC() {
    const k = CBZ.islandRoadKit && CBZ.islandRoadKit.C;
    return { HW: k ? k.HW : 3.5, WALK: k ? k.WALK : 5.5 };
  }

  // ---- deterministic hashing (never the arena's rng stream) ---------------
  function ihash(a, b, s) {
    let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul((s | 0) + 0x27d4eb2f, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  // SEEDX salts every placement hash (make() sets it from cfg.seed): seed 0
  // is the disaster island exactly as it always was; any other seed is the
  // same town grammar laid out with different lot widths, heights and styles
  let SEEDX = 0;
  function wh(x, z, s) { return ihash(Math.round(x * 10), Math.round(z * 10), s ^ SEEDX); }
  const clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  function ss(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function rectHit(a, b, pad) {
    pad = pad || 0;
    return a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.z0 < b.z1 + pad && a.z1 > b.z0 - pad;
  }
  function segDist(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t - px, qz = az + dz * t - pz;
    return { d: Math.sqrt(qx * qx + qz * qz), t: t };
  }

  /* ======================================================================
     THE LAYOUT, in metres relative to the island centre (u east, v south:
     +v is +z, toward the harbour). R is 240; every number below was laid
     out against that radius, so make() scales them by R / 240.
     ====================================================================== */
  const BASE_R = 240;
  const L = {
    plainRise: 4.0, plainRun: 170,              // m the plain climbs, over m inland
    volcano: { u: -95, v: -105, r: 82, peak: 62 },
    hills: [
      { u: -188, v: -22, r: 34, peak: 13 },     // the west foothill
      { u: 150, v: -122, r: 42, peak: 18 },     // the north-east headland
      { u: 32, v: -168, r: 30, peak: 11 },      // the north hill
    ],
    // the ghaut, from the breach to the beach (bed half-width, bank to, depth)
    ghaut: { pts: [[-63, -28], [-70, 18], [-62, 66], [-74, 118], [-67, 166], [-80, 212], [-86, 246]], half: 4.5, bank: 12, depth: 3.2 },
    // the harbour (reclaimed land, the basin, the breakwater, the piers)
    quay: { u0: -60, u1: 95, v0: 204, v1: 278, top: 0.65 },
    breakwater: [[[95, 278], [95, 332]], [[95, 332], [8, 332]]],
    bwCrest: 1.5, bwHalf: 3.2, bwSlope: 1.4,
    piers: [
      { kind: "jetty", u0: -47.2, u1: -44.8, v0: 278, v1: 300, deck: 0.55 },
      { kind: "jetty", u0: -25.2, u1: -22.8, v0: 278, v1: 300, deck: 0.55 },
      { kind: "jetty", u0: -3.2, u1: -0.8, v0: 278, v1: 300, deck: 0.55 },
      { kind: "cargo", u0: 52, u1: 66, v0: 278, v1: 314, deck: 0.65 },
    ],
    // the streets: avenues run along v at u = at, cross streets along u at v = at
    ave: [
      { at: -150, runs: [[24, 200]], name: "West Ring" },
      { at: -104, runs: [[24, 220]], name: "Ghaut Road" },
      { at: -40, runs: [[24, 244]], name: "Church Street" },
      { at: 16, runs: [[24, 244]], name: "Harbour Street" },
      { at: 72, runs: [[-100, 244]], name: "Market Street" },
      { at: 128, runs: [[24, 220]], name: "Foundry Road" },
      { at: 184, runs: [[-60, 140]], name: "East Ring" },
    ],
    cross: [
      { at: -60, runs: [[72, 184]], name: "Estate Lane" },
      { at: 24, runs: [[-150, 184]], name: "Ring Road" },
      { at: 68, runs: [[-150, 184]], name: "Hill Street" },
      { at: 112, runs: [[-150, 184]], name: "Main Street" },
      { at: 156, runs: [[-150, 172]], name: "Bay Street" },
      { at: 200, runs: [[-150, 128]], name: "Front Street" },
      { at: 244, runs: [[-58, 93]], name: "The Quay" },
    ],
  };

  // the facade grammars each district wears (only the ones the registry has)
  const STYLE = {
    house: ["ranch", "brickhouse", "queenanne", "techhouse", "desertmod", "machiya", "adobe", "victorian"],
    villa: ["greekrev", "plantation", "spanish", "manor", "romanvilla"],
    shop: ["brick", "stone", "victorian", "artdeco", "gothic", "pagoda", "brutalist", "hightech"],
    tower: ["intl", "ziggurat", "postmodern", "sunburst"],
    works: ["brick", "brutalist"],
    harbour: ["brick", "stone", "brutalist"],
  };

  /* ======================================================================
     ISLAND STYLES. The same harbour town grammar (streets, lots, places,
     cars, berths) with its districts built as something else. `remap` says
     which district's RULE a district's frontages are built by (a "core"
     rule builds shops and towers, "estates" villas, "industrial" sheds);
     the district itself keeps its name and its streets. harbour is the
     disaster island: no remap, the five-tower cap.
     ====================================================================== */
  const STYLES = {
    harbour: {},
    // a downtown island: towers wherever the frontage faces its street
    downtown: { remap: { midtown: "core", northside: "core", westside: "core" }, maxTowers: 14, towerU: 0.12, volcanoPeak: 0.62 },
    // a residential island: villas and houses, no towers
    estates: { remap: { core: "midtown", midtown: "westside", northside: "westside", industrial: "estates" }, maxTowers: 0, volcanoPeak: 0.8 },
    // a works / port island: sheds and yards, one tower
    works: { remap: { westside: "industrial", northside: "industrial", midtown: "industrial", estates: "industrial" }, maxTowers: 1, volcanoPeak: 0.5 },
  };

  /* ======================================================================
     make()
     ====================================================================== */
  /* makeSteps(cfg) is make as a generator: a streamed island
     (world/archipelago.js) lays its town out a few loop turns a step.
     make(cfg) runs it to the end, as it always ran. */
  function make(cfg) {
    const it = makeSteps(cfg);
    let r = it.next();
    while (!r.done) r = it.next();
    return r.value;
  }
  function* makeSteps(cfg) {
    let __dn = 0;      // the seam counter (a yield every few loop turns)
    cfg = cfg || {};
    SEEDX = (cfg.seed | 0) ? Math.imul(cfg.seed | 0, 0x9e3779b1) | 0 : 0;
    const ST = STYLES[cfg.style] || STYLES.harbour;
    const REMAP = ST.remap || {};
    const cx = cfg.cx || 0, cz = cfg.cz || 0, R = cfg.R || BASE_R;
    const K = R / BASE_R;                       // every layout number scales with the island
    const RC = roadC(), WALK = RC.WALK, HW = RC.HW;
    const W = function (u) { return cx + u * K; };
    const Z = function (v) { return cz + v * K; };
    const facades = new Set(cfg.facades || []);
    const tall = cfg.tall || {};

    /* ---- TERRAIN ---------------------------------------------------------
       The plain: 0 at the grass edge (where the beach's berm takes over),
       rising to plainRise metres plainRun metres in, with a broad swell of
       +-0.25 m so it is ground and not a table. Zero exactly at d = R. */
    const RISE = L.plainRise, RUN = L.plainRun * K;
    function plainBaseAt(x, z) {
      const u = x - cx, v = z - cz, d = Math.sqrt(u * u + v * v);
      if (d >= R) return 0;
      const inl = R - d;
      const swell = 0.25 * Math.sin(u * 0.019 / K + 1.1) * Math.sin(v * 0.023 / K + 0.3) * ss(0, 40 * K, inl);
      return RISE * ss(0, RUN, inl) + swell;
    }
    // the ghaut: a V-floored ravine (flat bed, graded banks), carved into the
    // plain, its bed never below +0.25 so it is a DRY wash, not a creek
    const GH = { pts: L.ghaut.pts.map(function (p) { return { x: W(p[0]), z: Z(p[1]) }; }), half: L.ghaut.half * K, bank: L.ghaut.bank * K, depth: L.ghaut.depth };
    let gx0 = 1e9, gx1 = -1e9, gz0 = 1e9, gz1 = -1e9;
    for (const p of GH.pts) { gx0 = Math.min(gx0, p.x); gx1 = Math.max(gx1, p.x); gz0 = Math.min(gz0, p.z); gz1 = Math.max(gz1, p.z); }
    GH.box = { x0: gx0 - GH.bank, x1: gx1 + GH.bank, z0: gz0 - GH.bank, z1: gz1 + GH.bank };
    function ghautDist(x, z) {
      if (x < GH.box.x0 || x > GH.box.x1 || z < GH.box.z0 || z > GH.box.z1) return 1e9;
      let best = 1e9;
      for (let i = 0; i + 1 < GH.pts.length; i++) {
        const a = GH.pts[i], b = GH.pts[i + 1];
        const r = segDist(x, z, a.x, a.z, b.x, b.z);
        if (r.d < best) best = r.d;
      }
      return best;
    }
    function ghautCut(x, z, base) {
      const e = ghautDist(x, z);
      if (e >= GH.bank) return 0;
      const room = Math.max(0, base - 0.25);
      const deep = Math.min(GH.depth, room);
      if (deep <= 0) return 0;
      const k = e <= GH.half ? 1 : 1 - ss(GH.half, GH.bank, e);
      return deep * k;
    }
    function plainAt(x, z) {
      const b = plainBaseAt(x, z);
      if (b <= 0.25) return b;
      return b - ghautCut(x, z, b);
    }

    /* ---- THE HARBOUR -----------------------------------------------------
       Reclaimed land: a fill whose deck is QUAY_TOP over the sea (1.45 m of
       freeboard at mean sea), or the plain + 3 cm where the plain stands
       higher (the inland edge meets the town flush). The breakwater is a
       rubble mound: a crest, then 1:1.4 armour slopes down to the bed. */
    const Q = { x0: W(L.quay.u0), x1: W(L.quay.u1), z0: Z(L.quay.v0), z1: Z(L.quay.v1), top: L.quay.top };
    const BW = L.breakwater.map(function (s) { return { ax: W(s[0][0]), az: Z(s[0][1]), bx: W(s[1][0]), bz: Z(s[1][1]) }; });
    const BW_CREST = L.bwCrest, BW_HALF = L.bwHalf * K, BW_SLOPE = L.bwSlope;
    let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
    for (const s of BW) { bx0 = Math.min(bx0, s.ax, s.bx); bx1 = Math.max(bx1, s.ax, s.bx); bz0 = Math.min(bz0, s.az, s.bz); bz1 = Math.max(bz1, s.az, s.bz); }
    const BW_REACH = BW_HALF + (BW_CREST + 30) * BW_SLOPE;
    const bwBox = { x0: bx0 - BW_REACH, x1: bx1 + BW_REACH, z0: bz0 - BW_REACH, z1: bz1 + BW_REACH };
    const PIERS = L.piers.map(function (p) { return { kind: p.kind, x0: W(p.u0), x1: W(p.u1), z0: Z(p.v0), z1: Z(p.v1), deck: p.deck }; });
    // a pier is a deck on piles, not fill: madeAt answers it only for the
    // solid cargo pier; the timber jetties are walk platforms (dressing)
    function quayTop(x, z) { return Math.max(Q.top, plainBaseAt(x, z) + 0.03); }
    /* THE AIRSTRIP (cfg.airstrip): reclaimed land off the east coast, the
       way small island airports are built: a 40 m fill, a 30 m runway on
       it, north-south, touching the beach mid-island. Its deck is ground
       (madeAt), so you walk, drive, land and take off on the one height
       field. Off by default: the disaster island has none. */
    const AIR = cfg.airstrip ? (function () {
      /* LONG ENOUGH TO LEAVE. The jet (city/playeraircraft.js WING_V2.jet:
         13 m/s2 at full throttle from the 0.35 idle the parked craft is
         handed, Vr 55 m/s) reaches rotate speed 122 m down the runway and
         is 15 m up by 182 m (city/aircraftphysics.js planeStep, integrated).
         400 m from a stand 22 m in leaves ~370 m: twice what it needs, for a
         pilot who does not pull back the instant the nose can lift. */
      const len = 400;
      const a = { x0: cx + R + 2, x1: cx + R + 42, z0: cz - len / 2, z1: cz + len / 2, deck: 0.45, width: 30 };
      a.x = (a.x0 + a.x1) / 2; a.z = cz; a.len = len;
      // where a plane waits: the north threshold, nose down the runway (+z)
      a.stand = { x: a.x, z: a.z0 + 22, heading: 0 };
      return a;
    })() : null;
    function madeAt(x, z) {
      let h = -Infinity;
      if (AIR && x >= AIR.x0 && x <= AIR.x1 && z >= AIR.z0 && z <= AIR.z1) h = AIR.deck;
      if (x >= Q.x0 && x <= Q.x1 && z >= Q.z0 && z <= Q.z1) h = quayTop(x, z);
      for (let i = 0; i < PIERS.length; i++) {
        const p = PIERS[i];
        if (p.kind === "cargo" && x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && p.deck > h) h = p.deck;
      }
      if (x >= bwBox.x0 && x <= bwBox.x1 && z >= bwBox.z0 && z <= bwBox.z1) {
        for (let i = 0; i < BW.length; i++) {
          const s = BW[i], e = segDist(x, z, s.ax, s.az, s.bx, s.bz).d;
          const y = e <= BW_HALF ? BW_CREST : BW_CREST - (e - BW_HALF) / BW_SLOPE;
          if (y > h) h = y;
        }
      }
      return h;
    }

    /* ---- HILLS -------------------------------------------------------- */
    const V = L.volcano;
    const volcano = { x: W(V.u), z: Z(V.v), r: V.r * K, peak: V.peak * (cfg.volcanoPeak || ST.volcanoPeak || 1), volcano: true };
    // the breach faces the town: the thing everyone in it looks up at
    const town = { x: W(20), z: Z(170) };
    volcano.breachA = Math.atan2(town.z - volcano.z, town.x - volcano.x);
    const hills = [volcano].concat(L.hills.map(function (h) { return { x: W(h.u), z: Z(h.v), r: h.r * K, peak: h.peak }; }));
    function hillAt(x, z) {
      // the cones, for placement only (the arena owns the real volcano profile)
      let h = 0;
      for (const hl of hills) {
        const d = Math.hypot(x - hl.x, z - hl.z);
        if (d < hl.r) h = Math.max(h, hl.peak * (1 - d / hl.r) * (hl.volcano ? 1.2 : 1));
      }
      return h;
    }
    function onLand(x, z, margin) {
      const d = Math.hypot(x - cx, z - cz);
      if (d <= R - (margin || 0)) return true;
      return x >= Q.x0 + 1 && x <= Q.x1 - 1 && z >= Q.z0 && z <= Q.z1 - 1;
    }

    /* ---- STREETS ------------------------------------------------------
       The layout's runs, clipped to dry land (12 m in from the grass edge,
       or on the quay), off every hill and out of the volcano's skirt. */
    function clipRun(vertical, at, a, b) {
      const out = [];
      let s0 = null;
      const step = 2;
      for (let t = a; t <= b + 1e-6; t += step) {
        const x = vertical ? at : t, z = vertical ? t : at;
        const ok = onLand(x, z, 12 * K) && hillAt(x, z) < 0.6;
        if (ok && s0 === null) s0 = t;
        if ((!ok || t + step > b + 1e-6) && s0 !== null) {
          const e = ok ? t : t - step;
          if (e - s0 >= 12) out.push([s0, e]);
          s0 = null;
        }
      }
      return out;
    }
    const streets = { ave: [], cross: [] };
    for (const l of L.ave) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      const at = W(l.at), runs = [];
      for (const r of l.runs) for (const c of clipRun(true, at, Z(r[0]), Z(r[1]))) runs.push(c);
      if (runs.length) streets.ave.push({ at: at, runs: runs, name: l.name });
    }
    for (const l of L.cross) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      const at = Z(l.at), runs = [];
      for (const r of l.runs) for (const c of clipRun(false, at, W(r[0]), W(r[1]))) runs.push(c);
      if (runs.length) streets.cross.push({ at: at, runs: runs, name: l.name });
    }
    const kit = CBZ.islandRoadKit;
    // (an archipelago town's main crossings are signalled; the disaster
    // island's stay signed STOP, exactly as they always were)
    const roads = kit && kit.plan ? kit.plan({ lines: streets, signals: !!cfg.venues }) : null;
    // every rectangle of street (carriageway + both sidewalks), world AABBs
    const streetRects = [];
    if (roads) {
      for (const p of roads.pieces) {
        const r = p.vertical
          ? { x0: p.fixed - WALK, x1: p.fixed + WALK, z0: p.a - (p.jA ? 0 : 2), z1: p.b + (p.jB ? 0 : 2) }
          : { x0: p.a - (p.jA ? 0 : 2), x1: p.b + (p.jB ? 0 : 2), z0: p.fixed - WALK, z1: p.fixed + WALK };
        r.piece = p; streetRects.push(r);
      }
      for (const j of roads.junctions) streetRects.push({ x0: j.x - WALK, x1: j.x + WALK, z0: j.z - WALK, z1: j.z + WALK, junction: j });
    }
    function inStreet(r, pad) {
      for (let i = 0; i < streetRects.length; i++) if (rectHit(r, streetRects[i], pad)) return streetRects[i];
      return null;
    }

    /* ---- BRIDGES: wherever a street corridor crosses the ghaut -------- */
    const bridges = [];
    if (roads) for (const p of roads.pieces) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      let t0 = null, t1 = null;
      for (let t = p.a; t <= p.b; t += 1) {
        let cut = 0;
        for (const off of [-WALK, 0, WALK]) {
          const x = p.vertical ? p.fixed + off : t, z = p.vertical ? t : p.fixed + off;
          const b = plainBaseAt(x, z);
          cut = Math.max(cut, b - plainAt(x, z));
        }
        if (cut > 0.05) { if (t0 === null) t0 = t; t1 = t; }
      }
      if (t0 === null) continue;
      t0 -= 1.5; t1 += 1.5;
      bridges.push(p.vertical
        ? { vertical: true, at: p.fixed, a: t0, b: t1, x0: p.fixed - WALK, x1: p.fixed + WALK, z0: t0, z1: t1 }
        : { vertical: false, at: p.fixed, a: t0, b: t1, x0: t0, x1: t1, z0: p.fixed - WALK, z1: p.fixed + WALK });
    }
    function bridgeAt(x, z) {
      for (let i = 0; i < bridges.length; i++) {
        const b = bridges[i];
        if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
      }
      return null;
    }

    /* ---- DISTRICTS ---------------------------------------------------- */
    const districts = [
      { id: "waterfront", name: "The Quay", x0: Q.x0, x1: Q.x1, z0: Z(238), z1: Q.z1 },
      { id: "core", name: "Downtown", x0: W(-46), x1: W(132), z0: Z(106), z1: Z(238) },
      { id: "midtown", name: "Midtown", x0: W(-46), x1: W(132), z0: Z(62), z1: Z(106) },
      { id: "industrial", name: "The Works", x0: W(132), x1: W(240), z0: Z(62), z1: Z(240) },
      { id: "westside", name: "Ghaut Side", x0: W(-240), x1: W(-46), z0: Z(18), z1: Z(240) },
      { id: "northside", name: "Hill Street", x0: W(-46), x1: W(240), z0: Z(18), z1: Z(62) },
      { id: "estates", name: "The Estates", x0: W(34), x1: W(240), z0: Z(-90), z1: Z(18) },
    ];
    function districtAt(x, z) {
      for (const d of districts) if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d.id;
      return "rural";
    }
    const coreC = { x: W(44), z: Z(190) };
    // 1 at the harbour core, 0 at the town's edge: what density and height follow
    function urban(x, z) { return 1 - ss(30 * K, 190 * K, Math.hypot(x - coreC.x, z - coreC.z)); }

    /* ---- LOTS --------------------------------------------------------- */
    const lots = [], claims = [];
    // claims: rects already given to something (lots, plaza, car parks, the
    // ghaut park, the volcano's skirt) — no lot may touch one
    function claimed(r, pad) {
      for (let i = 0; i < claims.length; i++) if (rectHit(r, claims[i], pad)) return claims[i];
      return null;
    }
    function groundOk(r, tol) {
      // dry land, off the ghaut banks and the hills, slope within tol
      let lo = 1e9, hi = -1e9;
      const nx = Math.max(2, Math.ceil((r.x1 - r.x0) / 4)), nz = Math.max(2, Math.ceil((r.z1 - r.z0) / 4));
      for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
        const x = r.x0 + (r.x1 - r.x0) * i / nx, z = r.z0 + (r.z1 - r.z0) * j / nz;
        if (!onLand(x, z, 6 * K)) return null;
        if (ghautDist(x, z) < GH.bank + 1.5) return null;
        if (hillAt(x, z) > 0.05) return null;
        if (x >= Q.x0 && x <= Q.x1 && z >= Q.z0 && z <= Q.z1) {
          const y = quayTop(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y); continue;
        }
        const y = plainAt(x, z);
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
      if (hi - lo > tol) return null;
      return { lo: lo, hi: hi };
    }
    function pickStyle(list, x, z, salt, storeys) {
      const ok = list.filter(function (id) {
        if (!facades.has(id)) return false;
        const lo = cfg.low && cfg.low[id];
        return !(lo && storeys > lo);
      });
      if (!ok.length) return null;
      return ok[(wh(x, z, salt) * ok.length) | 0];
    }
    // a lot along a street frontage. f: {vertical, at (street line), side
    // (+1: the lot is on the + side of the line), t0, t1 (along, world)}
    // spec: {front (lot frontage), depth, setback, side, rear, w?, d?}
    function frontLot(f, t0, spec) {
      const s = f.side, t1 = t0 + spec.front;
      const n0 = f.at + s * WALK, n1 = n0 + s * spec.depth;
      const lot = f.vertical
        ? { x0: Math.min(n0, n1), x1: Math.max(n0, n1), z0: t0, z1: t1 }
        : { x0: t0, x1: t1, z0: Math.min(n0, n1), z1: Math.max(n0, n1) };
      const bw = spec.w != null ? spec.w : spec.front - 2 * spec.side;     // along the street
      const bd = spec.d != null ? spec.d : spec.depth - spec.setback - spec.rear;
      const along = spec.offset != null ? t0 + spec.offset + bw / 2 : (t0 + t1) / 2;
      const nb = n0 + s * (spec.setback + bd / 2);
      const x = f.vertical ? nb : along, z = f.vertical ? along : nb;
      // the door faces the street: rotation.y maps local -z to (-sin y, -cos y)
      const yaw = f.vertical ? (s > 0 ? Math.PI / 2 : -Math.PI / 2) : (s > 0 ? 0 : Math.PI);
      const wx = f.vertical ? bd : bw, wz = f.vertical ? bw : bd;
      return { lot: lot, x: x, z: z, w: bw, d: bd, yaw: yaw, wx: wx, wz: wz,
        bx0: x - wx / 2, bx1: x + wx / 2, bz0: z - wz / 2, bz1: z + wz / 2,
        street: { vertical: f.vertical, at: f.at, side: s, name: f.name } };
    }
    const why = { street: 0, claim: 0, bridge: 0, ground: 0 };
    function accept(L0, extra) {
      const r = L0.lot;
      if (inStreet(r, -0.02)) { why.street++; return null; }
      { const cl = claimed(r, 0); if (cl) { why.claim++; const k = (cl.kind || "rect") + ">" + ((extra && extra.district) || "?"); why[k] = (why[k] || 0) + 1; return null; } }
      if (bridgeAt((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2)) { why.bridge++; return null; }
      const g = groundOk(r, extra && extra.tol != null ? extra.tol : 2.6);
      if (!g) { why.ground++; return null; }
      const out = Object.assign(L0, extra || {});
      out.gyHint = g.hi; out.gyLo = g.lo;
      out.id = lots.length;
      lots.push(out);
      claims.push(r);
      return out;
    }
    // every frontage of every street piece, both sides, in priority order
    const fronts = [];
    if (roads) for (const p of roads.pieces) for (const side of [-1, 1]) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      // the lot line starts clear of the junction's corner returns
      const t0 = p.a + (p.jA ? (WALK - HW) + 0.2 : 2.2), t1 = p.b - (p.jB ? (WALK - HW) + 0.2 : 2.2);
      if (t1 - t0 < 10) continue;
      const mx = p.vertical ? p.fixed + side * (WALK + 6) : (t0 + t1) / 2;
      const mz = p.vertical ? (t0 + t1) / 2 : p.fixed + side * (WALK + 6);
      const nm = (p.vertical ? streets.ave[p.m] : streets.cross[p.m]) || {};
      fronts.push({ vertical: p.vertical, at: p.fixed, side: side, t0: t0, t1: t1, mx: mx, mz: mz,
        district: districtAt(mx, mz), u: urban(mx, mz), name: nm.name || "" });
    }
    // blocks are fronted on their CROSS streets (the long faces, back to back);
    // an avenue face gets what the corners leave. Then nearest the core first.
    fronts.sort(function (a, b) { return (a.vertical - b.vertical) || (b.u - a.u); });

    /* THE PLACES FIRST: the square, the car parks, the helipad hotel, the
       showroom, the filling stations, the harbour buildings. Each claims
       its ground before the street fronts fill in. */
    function frontNear(vertical, at, side, along) {
      let best = null, bd = 1e9;
      for (const f of fronts) {
        if (f.vertical !== vertical || f.side !== side || Math.abs(f.at - at) > 0.5) continue;
        if (along < f.t0 - 1 || along > f.t1 + 1) continue;
        const d = Math.abs((f.t0 + f.t1) / 2 - along);
        if (d < bd) { bd = d; best = f; }
      }
      return best;
    }
    const places = { plaza: null, parking: [], showroom: null, stations: [], helipad: null, harbour: [] };

    // the TOWN SQUARE: the south half of the block between Harbour and
    // Market Streets on Front Street, looking down Harbour Street to the sea
    (function plaza() {
      const x0 = W(16) + WALK + 4, x1 = W(72) - WALK - 4, z1 = Z(200) - WALK, z0 = z1 - 24 * K;
      const r = { x0: x0, x1: x1, z0: z0, z1: z1 };
      if (inStreet(r, -0.02) || !groundOk(r, 2.6)) return;
      places.plaza = { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, half: Math.min(x1 - x0, z1 - z0) / 2 - 0.5, rect: r };
      claims.push(r);
    })();
    // the HELIPAD HOTEL: nine storeys on Bay Street, the tallest flat roof in town
    (function hotel() {
      const f = frontNear(false, Z(156), 1, W(100));
      if (!f) return;
      const spec = { front: Math.min(26 * K, f.t1 - f.t0), depth: 26 * K, setback: 2, side: 2, rear: 3, w: 20, d: 18 };
      const t0 = Math.max(f.t0, W(100) - spec.front / 2);
      if (t0 + spec.front > f.t1 + 1e-6) return;
      const l = accept(frontLot(f, t0, spec), { district: "core", kind: "hotel", storeys: 9, helipad: true,
        style: pickStyle(["brutalist", "hightech", "stone"], W(100), Z(156), 0x4e1, 9), name: hotelName(cfg) });
      if (l) places.helipad = l;
    })();
    // CAR PARKS: downtown (behind Customs Street), the quay's west end, the beach
    function carPark(x0, x1, z0, z1, name, tol) {
      const r = { x0: x0, x1: x1, z0: z0, z1: z1 };
      if (inStreet(r, -0.02) || claimed(r, 0)) return null;
      const g = groundOk(r, tol || 2.6);
      if (!g) return null;
      const P = { rect: r, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, name: name, gy: g.hi, lo: g.lo, bays: [] };
      // bays: rows of 2.6 x 5.2 m bays facing a 6 m aisle, along the long side
      const alongX = P.w >= P.d;
      const span = alongX ? P.w : P.d, deep = alongX ? P.d : P.w;
      const rows = deep >= 16.4 ? 2 : deep >= 11.2 ? 1 : 0;
      const nB = Math.floor((span - 1.2) / 2.6);
      const a0 = -nB * 2.6 / 2 + 1.3;
      for (let row = 0; row < rows; row++) {
        const off = rows === 2 ? (row === 0 ? -(deep / 2 - 2.6 - 0.3) : deep / 2 - 2.6 - 0.3) : -(deep / 2 - 2.6 - 0.3);
        const facing = row === 0 ? 1 : -1;     // nose toward the aisle
        for (let i = 0; i < nB; i++) {
          const a = a0 + i * 2.6;
          // nose-in toward the aisle: row 0 sits on the - side, so its nose points +
          P.bays.push(alongX
            ? { x: P.x + a, z: P.z + off, yaw: facing > 0 ? Math.PI : 0, alongX: true }
            : { x: P.x + off, z: P.z + a, yaw: facing > 0 ? -Math.PI / 2 : Math.PI / 2, alongX: false });
        }
      }
      places.parking.push(P);
      claims.push(r);
      return P;
    }
    carPark(W(72) + WALK + 0.5, W(72) + WALK + 0.5 + 30 * K, Z(156) - WALK - 0.5 - 18 * K, Z(156) - WALK - 0.5, "Bay Street car park");
    carPark(W(77), Q.x1 - 1, Z(244) + WALK + 0.5, Z(244) + WALK + 0.5 + 17 * K, "Quay car park", 0.4);
    carPark(W(-150) + WALK + 0.5, W(-150) + WALK + 0.5 + 28 * K, Z(156) + WALK + 0.5, Z(156) + WALK + 0.5 + 17 * K, "Beach car park");
    // the CAR SHOWROOM on Main Street in the Works (bay door faces the street:
    // its builder's front is -z, so it takes a lot on the + side of a cross street)
    (function showroom() {
      const f = frontNear(false, Z(112), 1, W(156));
      if (!f) return;
      const spec = { front: 26 * K, depth: 30 * K, setback: 11, side: 4, rear: 6, w: 18, d: 13 };
      const t0 = Math.max(f.t0, W(156) - spec.front / 2);
      if (t0 + spec.front > f.t1) return;
      const l = accept(frontLot(f, t0, spec), { district: "industrial", kind: "showroom", storeys: 1, name: "Island Motors" });
      if (l) places.showroom = l;
    })();
    // FILLING STATIONS: on the Ring Road and on Foundry Road (world/fuel_station.js
    // builds them; its lot is 24 m of frontage by 26 deep, rotY = front to the street)
    (function stations() {
      const SZ = CBZ.FUEL_STATION_SIZE || { frontage: 24, depth: 26 };
      const want = [[false, Z(24), 1, W(-12)], [true, W(128), 1, Z(178)]];
      for (const w of want) {
        const f = frontNear(w[0], w[1], w[2], w[3]);
        if (!f) continue;
        const spec = { front: SZ.frontage, depth: SZ.depth + 0.5, setback: 0, side: 0, rear: 0.5, w: SZ.frontage, d: SZ.depth };
        const t0 = Math.max(f.t0, w[3] - spec.front / 2);
        if (t0 + spec.front > f.t1) continue;
        const L0 = frontLot(f, t0, spec);
        const l = accept(L0, { district: districtAt(L0.x, L0.z), kind: "station", storeys: 1, name: "Fuel" });
        if (l) {
          // the station's own frame: rotY = 0 when its front faces -z
          l.rotY = l.yaw;
          places.stations.push(l);
        }
      }
    })();
    // THE QUAY: the fish market, the harbour office and the transit sheds,
    // shoulder to shoulder on the landward side of the quay road... no: on its
    // seaward side, between the road and the quay face, doors to the road
    (function harbourFront() {
      const plan2 = [
        { from: -54, front: 22, depth: 22, w: 18, d: 14, kind: "market", storeys: 1, style: "brick", name: "Fish Market" },
        { from: -30, front: 14, depth: 22, w: 10, d: 10, kind: "office", storeys: 3, style: "stone", name: "Harbour Office" },
        { from: -14, front: 16, depth: 22, w: 12, d: 11, kind: "shop", storeys: 2, style: "victorian", name: "Chandlery" },
        { from: 22, front: 26, depth: 22, w: 22, d: 15, kind: "shed", storeys: 2, style: "brick", name: "Transit Shed 1" },
        { from: 49, front: 17, depth: 22, w: 14, d: 13, kind: "shed", storeys: 2, style: "brutalist", name: "Transit Shed 2" },
      ];
      for (const h of plan2) {
        const f = frontNear(false, Z(244), 1, W(h.from + h.front / 2));
        if (!f) continue;
        const t0 = W(h.from);
        if (t0 < f.t0 || t0 + h.front * K > f.t1) continue;
        const spec = { front: h.front * K, depth: h.depth * K, setback: 2, side: 0, rear: 0, w: h.w, d: h.d };
        const l = accept(frontLot(f, t0, spec), { district: "waterfront", kind: h.kind, storeys: h.storeys,
          style: facades.has(h.style) ? h.style : pickStyle(STYLE.harbour, W(h.from), Z(244), 0x4f1, h.storeys), name: h.name });
        if (l) places.harbour.push(l);
      }
    })();

    /* THE LANDMARKS a town this size has one of each of: the church, the
       mosque, the town hall on the square, the bank on Main Street, the
       school. Each on its own street, its door to the street. */
    (function landmarks() {
      const want = [
        // [vertical, line, side, along, front, depth, w, d, storeys, style, kind, name]
        [false, Z(200), 1, W(44), 28, 22, 18, 13, 3, "greekrev", "civic", "Town Hall"],
        [false, Z(112), -1, W(44), 22, 16, 16, 12, 3, "stone", "civic", "Bank"],
        [true, W(-40), 1, Z(90), 22, 26, 13, 16, 2, "gothic", "civic", "St. Mary's"],
        [false, Z(68), 1, W(-127), 30, 28, 20, 18, 2, "mosque", "civic", "Mosque"],
        [true, W(72), -1, Z(46), 30, 24, 22, 15, 2, "brutalist", "civic", "School"],
      ];
      for (const w of want) {
        const f = frontNear(w[0], w[1], w[2], w[3]);
        if (!f || !facades.has(w[9])) continue;
        const front = Math.min(w[4] * K, f.t1 - f.t0);
        const spec = { front: front, depth: w[5] * K, setback: (w[5] * K - w[7]) * 0.55, side: (front - w[6]) / 2, rear: 1, w: Math.min(w[6], front - 2), d: w[7] };
        const t0 = Math.max(f.t0, Math.min(f.t1 - front, w[3] - front / 2));
        accept(frontLot(f, t0, spec), { district: districtAt(f.mx, f.mz), kind: w[10], storeys: w[8], style: w[9], name: w[11] });
      }
    })();

    /* THE MOTEL AND THE USED CAR LOT (an archipelago island whose trades
       include them: WANT below). Neither is a building on a shop lot. A motel
       is long and low on the ring road: two storeys of rooms in a row with
       an open gallery along the front, every room's door off it, a stair at
       the end, the office at the other end, and its own car park in front,
       nose-in to the rooms. A used car lot is a forecourt: the cars stand on
       it in rows, a little sales cabin at the back. Both claim their ground
       before the street fronts fill in (the lot's footprint is the whole
       graded forecourt; world/island_lots.js builds them). */
    function wantsUse(u) {
      const w = WANT[cfg.style || "harbour"] || WANT.harbour;
      for (let i = 0; i < w.length; i++) if (w[i][0] === u) return true;
      return false;
    }
    function ruleOf(f) { return REMAP[f.district] || f.district; }
    function onFronts(ok, order, spec, extra) {
      const cands = fronts.filter(ok).sort(order);
      for (const f of cands) {
        if (f.t1 - f.t0 < spec.front + 0.5) continue;
        const mid = (f.t0 + f.t1) / 2 - spec.front / 2;
        for (const t0 of [mid, f.t0 + 0.2, f.t1 - spec.front - 0.2]) {
          const L0 = frontLot(f, t0, spec);
          const l = accept(L0, Object.assign({ district: f.district, tol: 1.8 }, extra));
          if (l) return l;
        }
      }
      return null;
    }
    // a building-local rect (door on -z) of lot l, in world coordinates
    function lotRect(l, x0, x1, z0, z1) {
      const co = Math.cos(l.yaw), si = Math.sin(l.yaw);
      const ax = l.x + x0 * co + z0 * si, az = l.z - x0 * si + z0 * co;
      const bx = l.x + x1 * co + z1 * si, bz = l.z - x1 * si + z1 * co;
      return { x0: Math.min(ax, bx), x1: Math.max(ax, bx), z0: Math.min(az, bz), z1: Math.max(az, bz) };
    }
    if (cfg.venues && wantsUse("motel")) (function motel() {
      const ring = function (f) { return /Ring/.test(f.name); };
      const spec = { front: 38, depth: 25, setback: 0.6, side: 2.5, rear: 1.5, w: 33, d: 22.9 };
      const l = onFronts(function (f) { return ruleOf(f) !== "core" && ruleOf(f) !== "waterfront"; },
        function (a, b) { return (ring(b) - ring(a)) || (a.u - b.u); }, spec, { kind: "motel", storeys: 2, style: null });
      if (!l) return;
      // the plan of it, building-local: the car park across the front, the
      // block behind it (a gallery 1.7 m deep, rooms 7.6 m deep), the office
      // at the -x end of the block, the stair at the +x end
      const parkD = l.d - 9.6;
      l.motel = { parkD: parkD, blockD: 9.6, galleryD: 1.7, officeW: 5.4, stairW: 1.6, roomW: 4.0, rooms: 6 };
      const P = { rect: lotRect(l, -l.w / 2, l.w / 2, -l.d / 2, -l.d / 2 + parkD), name: "Motel car park", bays: [], motel: true };
      P.x = (P.rect.x0 + P.rect.x1) / 2; P.z = (P.rect.z0 + P.rect.z1) / 2; P.w = P.rect.x1 - P.rect.x0; P.d = P.rect.z1 - P.rect.z0;
      // nose-in to the rooms: one row against the block, a bay per room front
      const co = Math.cos(l.yaw), si = Math.sin(l.yaw);
      const alongX = Math.abs(co) > 0.5;
      const bz = -l.d / 2 + parkD - 2.9;
      for (let i = 0; i < l.motel.rooms; i++) {
        const bx = -l.w / 2 + l.motel.officeW + l.motel.roomW * (i + 0.5);
        P.bays.push({ x: l.x + bx * co + bz * si, z: l.z - bx * si + bz * co, yaw: l.yaw + Math.PI, alongX: alongX });
      }
      places.parking.push(P);
      // the way in off the street: the footway drops to a crossing there
      l.entry = lotRect(l, l.w / 2 - 7, l.w / 2 - 1, -l.d / 2 - 0.6 - WALK + HW, -l.d / 2 - 0.6);
    })();
    if (cfg.venues && wantsUse("usedcars")) (function carlot() {
      const spec = { front: 30, depth: 22, setback: 0.5, side: 1, rear: 1, w: 28, d: 20.5 };
      const l = onFronts(function (f) { return ruleOf(f) !== "core" && ruleOf(f) !== "waterfront" && ruleOf(f) !== "estates"; },
        function (a, b) { return ((ruleOf(b) === "industrial") - (ruleOf(a) === "industrial")) || (b.u - a.u); },
        spec, { kind: "carlot", storeys: 1, style: null });
      if (!l) return;
      l.entry = lotRect(l, -l.w / 2 + 1, -l.w / 2 + 8, -l.d / 2 - 0.5 - WALK + HW, -l.d / 2 - 0.5);
    })();

    /* THE STREET FRONTS. Per district: frontage, depth, setback, side and
       rear yards, storeys, and what is built. Walked along every frontage
       from the end nearer the core, a lot at a time; a lot that would hit a
       claim, a street or bad ground is skipped one metre on. */
    const RULE = {
      core: { front: [13.5, 16], depth: 15, setback: 1.0, side: 1.2, rear: 1.0, kinds: "shop" },
      waterfront: { front: [16, 20], depth: 15, setback: 1.0, side: 1.5, rear: 1.0, kinds: "shop" },
      midtown: { front: [14, 16.5], depth: 16, setback: 2.0, side: 1.5, rear: 2.0, kinds: "shop" },
      westside: { front: [15.5, 17.5], depth: 16.5, setback: 4.5, side: 1.2, rear: 2.0, kinds: "house" },
      northside: { front: [15.5, 17.5], depth: 16.5, setback: 4.5, side: 1.2, rear: 2.0, kinds: "house" },
      industrial: { front: [20, 23], depth: 16.5, setback: 2.5, side: 1.5, rear: 1.0, kinds: "works" },
      estates: { front: [32, 38], depth: 28, setback: 9.0, side: 4.0, rear: 4.0, kinds: "villa" },
    };
    let towers = 0, nLots = 0;
    const MAX_TOWERS = cfg.maxTowers != null ? cfg.maxTowers : (ST.maxTowers != null ? ST.maxTowers : 5);
    const TOWER_U = ST.towerU != null ? ST.towerU : 0.5;
    for (const f of fronts) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      const dRule = REMAP[f.district] || f.district;
      const rule = RULE[dRule];
      if (!rule) continue;
      // walk the frontage from the end nearer the core
      const fromLow = Math.abs(f.t0 - (f.vertical ? coreC.z : coreC.x)) <= Math.abs(f.t1 - (f.vertical ? coreC.z : coreC.x));
      let t = fromLow ? f.t0 : f.t1;
      let guard = 0;
      while (guard++ < 400) {
        const hx = f.vertical ? f.at : t, hz = f.vertical ? t : f.at;
        const front = rule.front[0] + (rule.front[1] - rule.front[0]) * wh(hx, hz, 0x501);
        const t0 = fromLow ? t : t - front;
        if (t0 < f.t0 - 1e-6 || t0 + front > f.t1 + 1e-6) break;
        const midX = f.vertical ? f.at + f.side * (WALK + rule.depth / 2) : t0 + front / 2;
        const midZ = f.vertical ? t0 + front / 2 : f.at + f.side * (WALK + rule.depth / 2);
        const U = urban(midX, midZ);
        let kind = rule.kinds, storeys = 1, style = null, spec;
        const hs = wh(midX, midZ, 0x502);
        if (kind === "shop") {
          // TOWERS: only where the door can face its street (their builder's
          // door is on -z: a lot on the + side of a cross street), in the core
          const towerOk = !f.vertical && f.side > 0 && dRule === "core" && U > TOWER_U && towers < MAX_TOWERS && hs < 0.8;
          if (towerOk) {
            kind = "tower";
            style = pickStyle(STYLE.tower, midX, midZ, 0x503, 99);
            const minS = style && tall[style] ? tall[style] : 10;
            storeys = Math.min(15, minS + 1 + ((hs * 3) | 0));
            spec = { front: 18 * K, depth: 18 * K, setback: 2.5, side: 2.5, rear: 2.5 };
          } else {
            storeys = Math.max(2, Math.min(6, Math.round(2 + U * 4 + (hs - 0.5) * 1.6)));
            if (dRule === "midtown") storeys = Math.min(storeys, 4);
            style = pickStyle(STYLE.shop, midX, midZ, 0x504, storeys);
            spec = { front: front, depth: Math.min(rule.depth, 13 + storeys * 0.4), setback: rule.setback, side: rule.side, rear: rule.rear };
          }
        } else if (kind === "house") {
          storeys = hs < 0.55 ? 1 : 2;
          style = pickStyle(STYLE.house, midX, midZ, 0x505, storeys);
          spec = { front: front, depth: rule.depth, setback: rule.setback, side: rule.side, rear: rule.rear };
        } else if (kind === "villa") {
          storeys = hs < 0.5 ? 2 : 3;
          style = pickStyle(STYLE.villa, midX, midZ, 0x506, storeys);
          spec = { front: front, depth: rule.depth, setback: rule.setback, side: rule.side, rear: rule.rear };
        } else if (kind === "works") {
          storeys = hs < 0.6 ? 1 : 2;
          style = pickStyle(STYLE.works, midX, midZ, 0x507, storeys);
          spec = { front: front, depth: rule.depth, setback: rule.setback, side: rule.side, rear: rule.rear };
        }
        // the island builder's footprint limits: a house is a house (<= 11 x 11),
        // a shop <= 16 x 13, a shed <= 22 x 18, a villa <= 16 x 13
        const cap = { house: [10.5, 10], shop: [14, 12.5], works: [19, 13], villa: [16, 13], tower: [13, 13] }[kind];
        let w = Math.min(cap[0], spec.front - 2 * spec.side), d = Math.min(cap[1], spec.depth - spec.setback - spec.rear);
        if (w < 6.5 || d < 7) { t += fromLow ? 1 : -1; continue; }
        // a house keeps one side yard wide enough for a driveway
        let offset = null, drive = null;
        if (kind === "house" || kind === "villa") {
          const room = spec.front - w;
          const dsideRight = wh(midX, midZ, 0x508) < 0.5;
          if (room >= 2 * spec.side + 3.4) {
            const dw = 3.0;
            offset = dsideRight ? spec.side : room - spec.side;
            drive = { right: dsideRight, w: dw };
          } else offset = (spec.front - w) / 2;
        }
        const L0 = frontLot(f, t0, Object.assign({}, spec, { w: w, d: d, offset: offset }));
        const lot = accept(L0, { district: f.district, kind: kind, storeys: storeys, style: style,
          tol: 2.6 });
        if (!lot) { t += fromLow ? 1 : -1; continue; }
        nLots++;
        if (kind === "tower") towers++;
        if (drive) lot.driveway = makeDriveway(lot, f, drive);
        t = fromLow ? t0 + spec.front : t0;
      }
    }
    // the driveway: from the sidewalk to the front wall + 6 m, 3 m wide, on
    // the side yard the lot left for it, with a car standing on it
    function makeDriveway(lot, f, dv) {
      const s = f.side;
      const r = lot.lot;
      const along0 = f.vertical ? r.z0 : r.x0, along1 = f.vertical ? r.z1 : r.x1;
      // which end of the frontage the house left room at
      const bA0 = f.vertical ? lot.bz0 : lot.bx0, bA1 = f.vertical ? lot.bz1 : lot.bx1;
      const gapLo = bA0 - along0, gapHi = along1 - bA1;
      const useHi = gapHi >= gapLo;
      const a0 = useHi ? bA1 + 0.6 : bA0 - 0.6 - dv.w, a1 = a0 + dv.w;
      if (a0 < along0 + 0.3 || a1 > along1 - 0.3) return null;
      const n0 = f.at + s * WALK;
      const depthIn = Math.abs((f.vertical ? lot.x : lot.z) - n0) + 2;
      const n1 = n0 + s * Math.min(depthIn, (f.vertical ? r.x1 - r.x0 : r.z1 - r.z0) - 1);
      const rect = f.vertical
        ? { x0: Math.min(n0, n1), x1: Math.max(n0, n1), z0: a0, z1: a1 }
        : { x0: a0, x1: a1, z0: Math.min(n0, n1), z1: Math.max(n0, n1) };
      // the car: nose to the street, 1.2 m in from the sidewalk
      const carN = n0 + s * 3.6, carA = (a0 + a1) / 2;
      // nose to the street: a lot on the + side faces the street on its - side
      const car = f.vertical
        ? { x: carN, z: carA, yaw: s > 0 ? Math.PI / 2 : -Math.PI / 2, alongX: true }
        : { x: carA, z: carN, yaw: s > 0 ? 0 : Math.PI, alongX: false };
      return { rect: rect, car: wh(carA, carN, 0x509) < 0.7 ? car : null,
        cut: f.vertical ? { x0: Math.min(f.at + s * HW, n0), x1: Math.max(f.at + s * HW, n0), z0: a0, z1: a1 }
          : { x0: a0, x1: a1, z0: Math.min(f.at + s * HW, n0), z1: Math.max(f.at + s * HW, n0) } };
    }

    /* ---- KERBSIDE CARS: the residential streets, parked against the kerb
       on the right (traffic keeps right), facing the way their lane runs,
       clear of junction mouths, driveways and each other. Not on the ring
       road, the quay or downtown's through streets (no parking lane: the
       street kit's carriageway is two 3.5 m lanes). */
    const cars = [];
    function carHits(x, z, alongX) {
      const hx = alongX ? 2.3 : 1.05, hz = alongX ? 1.05 : 2.3;
      const r = { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz };
      for (const c of cars) if (Math.abs(c.x - x) < 5.2 && Math.abs(c.z - z) < 5.2) return true;
      for (const l of lots) {
        if (rectHit(r, { x0: l.bx0, x1: l.bx1, z0: l.bz0, z1: l.bz1 }, 0.4)) return true;
        if (l.driveway && rectHit(r, l.driveway.cut, 0.3) && !(l.driveway.car && Math.abs(l.driveway.car.x - x) < 0.01)) return true;
      }
      return false;
    }
    if (roads) for (const p of roads.pieces) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      const mx = p.vertical ? p.fixed : (p.a + p.b) / 2, mz = p.vertical ? (p.a + p.b) / 2 : p.fixed;
      const dist = districtAt(mx, mz);
      if (dist !== "westside" && dist !== "northside" && dist !== "industrial" && dist !== "midtown") continue;
      const nm = (p.vertical ? streets.ave[p.m] : streets.cross[p.m]) || {};
      if (nm.name === "Ring Road" || nm.name === "East Ring" || nm.name === "West Ring") continue;
      const len = p.b - p.a;
      if (len < 30) continue;
      for (const side of [-1, 1]) {
        let t = p.a + 10;
        while (t < p.b - 10) {
          const h = wh(p.fixed + side, t, 0x60a);
          if (h < 0.45) {
            const off = side * 2.25;
            const x = p.vertical ? p.fixed + off : t, z = p.vertical ? t : p.fixed + off;
            const alongX = !p.vertical;
            // right-hand traffic: on an avenue the +x lane runs toward -z,
            // on a cross street the -z lane runs toward -x
            // the nose points the way its lane runs: yaw turns the body's
            // local -z front (rotation.y = yaw sends -z to (-sin yaw, -cos yaw))
            const yaw = p.vertical ? (side > 0 ? 0 : Math.PI) : (side < 0 ? Math.PI / 2 : -Math.PI / 2);
            if (!carHits(x, z, alongX) && !bridgeAt(x, z)) cars.push({ x: x, z: z, yaw: yaw, alongX: alongX, where: "kerb", street: nm.name || "" });
          }
          t += 6 + h * 9;
        }
      }
    }
    for (const P of places.parking) for (const b of P.bays) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      if (wh(b.x, b.z, 0x60b) < 0.62) cars.push({ x: b.x, z: b.z, yaw: b.yaw, alongX: !b.alongX, where: "park", lot: P.name });
    }
    for (const l of lots) if (l.driveway && l.driveway.car) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      const c = l.driveway.car;
      cars.push({ x: c.x, z: c.z, yaw: c.yaw, alongX: c.alongX, where: "drive", lot: l.id });
    }

    /* ---- BOATS: the berths in the harbour ----------------------------- */
    const berths = [];
    // beam (m) of the hulls world/water_hulls.js registers: a boat lies its
    // own half-beam plus a fender's width off the pier face
    const BEAM = { dinghy: 2.0, boat: 2.1, console: 2.6, diveboat: 4.0, cruiser: 4.2, yacht: 7.6 };
    const LOA = { dinghy: 4.5, boat: 6.2, console: 7.5, diveboat: 12, cruiser: 14, yacht: 34 };
    const MARINA = ["dinghy", "boat", "console", "diveboat", "boat", "cruiser", "console", "dinghy"];
    let mi = 0;
    for (const p of PIERS) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      if (p.kind === "jetty") {
        for (const side of [-1, 1]) {
          let z = p.z0 + 2;
          for (let guard = 0; guard < 12; guard++) {
            const key = MARINA[(mi + ((wh(p.x0 + side, z, 0x70a) * 3) | 0)) % MARINA.length];
            const loa = LOA[key];
            if (z + loa > p.z1 + 1) break;
            mi++;
            if (wh(p.x0 * side, z, 0x70b) < 0.2) { z += loa + 1.5; continue; }     // an empty berth
            const x = (side < 0 ? p.x0 : p.x1) + side * (BEAM[key] / 2 + 0.6);
            berths.push({ x: x, z: z + loa / 2, heading: wh(x, z, 0x70c) < 0.5 ? 0 : Math.PI, key: key, loa: loa, beam: BEAM[key] });
            z += loa + 1.5;
          }
        }
      } else {
        // the cargo pier: the big yacht alongside its east face, a dive boat on its west
        berths.push({ x: p.x1 + BEAM.yacht / 2 + 0.8, z: (p.z0 + p.z1) / 2, heading: Math.PI, key: "yacht", loa: LOA.yacht, beam: BEAM.yacht, big: true });
        berths.push({ x: p.x0 - BEAM.diveboat / 2 - 0.8, z: p.z0 + 4 + LOA.diveboat / 2, heading: Math.PI, key: "diveboat", loa: LOA.diveboat, beam: BEAM.diveboat });
      }
    }

    /* ---- THE BEACH, THE FIELDS, THE TREES ----------------------------- */
    const beaches = [
      { name: "West Beach", a0: 1.9, a1: 2.55 },          // bearings (rad) of open sand
      { name: "Volcano Beach", a0: 3.6, a1: 4.4 },
      { name: "East Beach", a0: 0.05, a1: 0.75 },
    ];
    const fields = [];
    for (const fz of [[66, 104, -150, -100], [-10, 28, -112, -72]]) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      const r = { x0: W(fz[0]), x1: W(fz[1]), z0: Z(fz[2]), z1: Z(fz[3]) };
      if (inStreet(r, 1) || claimed(r, 2) || !groundOk(r, 3)) continue;
      fields.push(r); claims.push(r);
    }
    // trees: street trees on the residential streets' verges, palms along
    // the quay road and the beach, a park along the ghaut, orchards by the
    // fields, scattered bush on the volcano's lower skirt
    const trees = [];
    function treeOk(x, z, r) {
      if (!onLand(x, z, 4)) return false;
      const box = { x0: x - r, x1: x + r, z0: z - r, z1: z + r };
      if (inStreet(box, -0.05)) return false;
      for (const l of lots) if (rectHit(box, { x0: l.bx0, x1: l.bx1, z0: l.bz0, z1: l.bz1 }, 1.2)) return false;
      for (const l of lots) if (l.driveway && rectHit(box, l.driveway.rect, 0.4)) return false;
      for (const P of places.parking) if (rectHit(box, P.rect, 0.3)) return false;
      if (places.plaza && rectHit(box, places.plaza.rect, -2)) return false;
      for (const fl of fields) if (rectHit(box, fl, 0.5)) return false;
      if (x >= Q.x0 - 1 && x <= Q.x1 + 1 && z >= Q.z0 && z <= Q.z1 + 1) return false;
      for (const t of trees) if (Math.abs(t.x - x) < 4.5 && Math.abs(t.z - z) < 4.5) return false;
      return true;
    }
    function addTree(x, z, kind) { if (treeOk(x, z, 0.8)) trees.push({ x: x, z: z, kind: kind }); }
    // the ghaut park: both banks, every ~11 m
    for (let i = 0; i + 1 < GH.pts.length; i++) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      const a = GH.pts[i], b = GH.pts[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
      for (let s = 4; s < len; s += 11) for (const side of [-1, 1]) {
        const off = side * (GH.bank + 2.5 + wh(a.x + s, a.z, 0x801 + side) * 3);
        addTree(a.x + (b.x - a.x) * s / len + nx * off, a.z + (b.z - a.z) * s / len + nz * off, wh(a.x, s, 0x802) < 0.25 ? "palm" : "broad");
      }
    }
    // street trees between the kerb parking on residential verges (behind the walk)
    if (roads) for (const p of roads.pieces) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      const mx = p.vertical ? p.fixed : (p.a + p.b) / 2, mz = p.vertical ? (p.a + p.b) / 2 : p.fixed;
      const dist = districtAt(mx, mz);
      const palms = dist === "waterfront" || dist === "core";
      if (dist === "industrial" || dist === "rural") continue;
      for (const side of [-1, 1]) for (let t = p.a + 9; t < p.b - 9; t += palms ? 14 : 16) {
        const off = side * (WALK + 1.4);
        const x = p.vertical ? p.fixed + off : t, z = p.vertical ? t : p.fixed + off;
        if (wh(x, z, 0x803) < 0.25) continue;
        addTree(x, z, palms ? "palm" : "broad");
      }
    }
    // the coast: palms on the grass edge where the beaches are open
    for (let a = 0; a < Math.PI * 2; a += 0.045) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      const open = beaches.some(function (b) { return a >= b.a0 && a <= b.a1; });
      if (!open && wh(a * 100, 3, 0x804) > 0.25) continue;
      const rr = R - 5 - wh(a * 100, 7, 0x805) * 9;
      addTree(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr, "palm");
    }
    // the volcano's lower skirt and the hills' feet: bush and broadleaf
    for (const hl of hills) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      const n = hl.volcano ? 46 : 14;
      for (let i = 0; i < n; i++) {
        const a = wh(hl.x, i, 0x806) * Math.PI * 2, rr = hl.r * (hl.volcano ? 0.78 + 0.32 * wh(i, hl.z, 0x807) : 0.9 + 0.4 * wh(i, hl.z, 0x807));
        addTree(hl.x + Math.cos(a) * rr, hl.z + Math.sin(a) * rr, "broad");
      }
    }
    // the countryside between the farm fields and the hills
    for (let i = 0; i < 60; i++) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      const x = W(-200 + wh(i, 1, 0x808) * 400), z = Z(-220 + wh(i, 2, 0x809) * 230);
      if (districtAt(x, z) !== "rural") continue;
      addTree(x, z, "broad");
    }
    // the plaza's own trees, in pits (the dressing paves round them)
    if (places.plaza) {
      const P = places.plaza;
      for (const s of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = P.x + s[0] * (P.w / 2 - 3), z = P.z + s[1] * (P.d / 2 - 3);
        trees.push({ x: x, z: z, kind: "palm", plaza: true });
      }
    }

    /* ---- GRADED LOTS ------------------------------------------------------
       A lot on a slope is graded flat before anything is built on it: the
       footprint (and 0.6 m round it) is a level pad at the height of the
       lot's front edge, so the door is at the sidewalk's level, and the
       yard eases back to the natural ground by the lot line. Nothing stands
       on a plinth over a void and nothing is sunk into a hillside: the
       ground under every building IS its floor. Car parks and the square are
       pads too. landAt() is the plain with every pad blended in. */
    const pads = [];
    function addPad(lotR, core, y) {
      const c = { x0: Math.max(lotR.x0, core.x0), x1: Math.min(lotR.x1, core.x1), z0: Math.max(lotR.z0, core.z0), z1: Math.min(lotR.z1, core.z1) };
      const P = { lot: lotR, core: c, y: y };
      pads.push(P);
      return P;
    }
    for (const l of lots) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      const st = l.street;
      // the middle of the lot's street edge
      const fx = st.vertical ? st.at + st.side * WALK : (l.lot.x0 + l.lot.x1) / 2;
      const fz = st.vertical ? (l.lot.z0 + l.lot.z1) / 2 : st.at + st.side * WALK;
      const onQuay = l.x >= Q.x0 && l.x <= Q.x1 && l.z >= Q.z0 && l.z <= Q.z1;
      const y = onQuay ? quayTop(l.x, l.z) : plainAt(fx, fz) + 0.12;
      l.pad = addPad(l.lot, { x0: l.bx0 - 0.6, x1: l.bx1 + 0.6, z0: l.bz0 - 0.6, z1: l.bz1 + 0.6 }, y);
      l.gy = y;
    }
    for (const P of places.parking) { P.pad = addPad(P.rect, { x0: P.rect.x0 + 0.4, x1: P.rect.x1 - 0.4, z0: P.rect.z0 + 0.4, z1: P.rect.z1 - 0.4 }, plainAt(P.x, P.z)); P.gy = P.pad.y; }
    if (places.plaza) { const P = places.plaza; P.pad = addPad(P.rect, { x0: P.rect.x0 + 0.3, x1: P.rect.x1 - 0.3, z0: P.rect.z0 + 0.3, z1: P.rect.z1 - 0.3 }, plainAt(P.x, P.z)); P.gy = P.pad.y; }
    const PCELL = 16;
    const padGrid = new Map();
    for (const P of pads) {
      if ((++__dn & 3) === 0) { const __sx = SEEDX; yield 0; SEEDX = __sx; }
      const i0 = Math.floor(P.lot.x0 / PCELL), i1 = Math.floor(P.lot.x1 / PCELL), k0 = Math.floor(P.lot.z0 / PCELL), k1 = Math.floor(P.lot.z1 / PCELL);
      for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) {
        const key = i * 100003 + k;
        let a = padGrid.get(key); if (!a) padGrid.set(key, a = []);
        a.push(P);
      }
    }
    function padAt(x, z) {
      const a = padGrid.get(Math.floor(x / PCELL) * 100003 + Math.floor(z / PCELL));
      if (!a) return null;
      for (let i = 0; i < a.length; i++) {
        const P = a[i], r = P.lot;
        if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return P;
      }
      return null;
    }
    function landAt(x, z) {
      const b = plainAt(x, z);
      const P = padAt(x, z);
      if (!P) return b;
      const c = P.core, r = P.lot;
      let t = 0;
      if (x < c.x0) t = Math.max(t, (c.x0 - x) / Math.max(0.01, c.x0 - r.x0));
      else if (x > c.x1) t = Math.max(t, (x - c.x1) / Math.max(0.01, r.x1 - c.x1));
      if (z < c.z0) t = Math.max(t, (c.z0 - z) / Math.max(0.01, c.z0 - r.z0));
      else if (z > c.z1) t = Math.max(t, (z - c.z1) / Math.max(0.01, r.z1 - c.z1));
      const w = 1 - ss(0, 1, t);
      return b + (P.y - b) * w;
    }

    /* ---- LOW GROUND: where water goes first ----------------------------- */
    const lowGround = [
      { kind: "ghaut", pts: GH.pts.map(function (p) { return { x: p.x, z: p.z }; }), half: GH.half, bank: GH.bank },
      { kind: "quay", x0: Q.x0, x1: Q.x1, z0: Q.z0, z1: Q.z1, top: Q.top },
      { kind: "beach", r0: R, r1: R + 26 },
    ];

    if (cfg.venues) assignUses(lots, cfg.style || "harbour", urban);

    return {
      cx: cx, cz: cz, R: R, K: K,
      plainAt: plainAt, plainBaseAt: plainBaseAt, landAt: landAt, padAt: padAt, pads: pads, madeAt: madeAt, ghautDist: ghautDist, hillAt: hillAt, onLand: onLand,
      quayTop: quayTop, districtAt: districtAt, urban: urban, bridgeAt: bridgeAt, inStreet: inStreet,
      hills: hills, volcano: volcano, ghaut: GH,
      harbour: { quay: Q, face: Q.z1, breakwater: BW, crest: BW_CREST, half: BW_HALF, slope: BW_SLOPE, piers: PIERS,
        basin: { x0: Q.x0, x1: BW[0].ax, z0: Q.z1, z1: BW[1].az },
        light: { x: BW[1].bx, z: BW[1].bz }, berths: berths },
      streets: streets, roads: roads, streetRects: streetRects, bridges: bridges,
      lots: lots, places: places, plaza: places.plaza, parking: places.parking, showroom: places.showroom,
      stations: places.stations, helipad: places.helipad, fields: fields, beaches: beaches, trees: trees, cars: cars,
      districts: districts, lowGround: lowGround, rejects: why,
      airstrip: AIR, style: cfg.style || "harbour", seed: cfg.seed | 0,
    };
  }

  /* ======================================================================
     WHAT EVERY BUILDING IS FOR (lot.use). An archipelago island
     (cfg.venues) gives every lot a use, by the same position hash as the
     rest of the plan, so an island is the same town on every boot. The
     fixed places keep what they are (the town hall, the bank, the hotel,
     the showroom); the island's style decides which trades it has, and
     each trade takes the shop lot that suits it best: the jewellers and the
     tailors downtown, the pawn shop and the cheque casher further out, the
     used car lot on a yard with a forecourt, the motel on the ring road.
     Every other shop is an ordinary trade with its name over the door, and
     the tall ones are flats over a shop. A use with a name gets a sign
     (world/island_dressing.js). The disaster island has no uses: it builds
     exactly as it always did.
     ====================================================================== */
  const USE_NAMES = {
    police: ["Police Station"],
    guns: ["Island Arms", "Coast Firearms", "Harbour Guns"],
    pawn: ["Harbour Pawn & Loan", "Island Pawn", "Quay Pawnbrokers"],
    loans: ["Cash Advance", "Cheques Cashed", "Quick Cash Loans"],
    jewelry: ["Coral Jewellers", "Gold & Pearl", "Harbour Jewellers"],
    eyewear: ["Coastal Optics", "Island Eyewear", "Bay Opticians"],
    clothing: ["Harbour Outfitters", "Trade Winds Clothing", "Island Clothing"],
    suits: ["Bay Street Tailors", "Harbour Tailoring", "Fine Suits"],
    phones: ["Island Mobile", "Bay Phones", "Cell Shop"],
    motel: ["Ring Road Motel", "Sea Breeze Motel", "Palm Motel"],
    recruit: ["Army Recruiting"],
    usedcars: ["Used Cars", "Island Auto Sales", "Quay Motors"],
    bankhq: ["Island Bank"],
    bar: ["The Anchor", "Rum Runner", "The Crow's Nest", "Harbour Tavern", "Blue Marlin", "The Lantern", "Salt & Barrel", "The Tide Inn"],
    hospital: ["General Hospital", "Island Hospital", "St. Luke's Hospital"],
    firestation: ["Fire Station"],
  };
  /* EVERY ISLAND'S HOTEL HAS ITS OWN NAME. The disaster island's is the
     Harbour Hotel, as it always was; an archipelago island's is its own,
     by island (cfg.id), else picked by its seed from the pool. */
  const HOTEL_NAMES = { "port-royal": "The Admiralty", "highgate": "Highgate Grand", "palm-cay": "Palm Cay Beach Hotel",
    "ironworks": "Foundry Inn", "saint-anne": "Saint Anne Bay Hotel" };
  const HOTEL_POOL = ["Windward Hotel", "Crown & Anchor", "Royal Palm Hotel", "Coral Bay Hotel", "The Belvedere", "Trade Winds Hotel"];
  function hotelName(cfg) {
    if (!cfg || !cfg.venues) return "Harbour Hotel";
    if (cfg.id && HOTEL_NAMES[cfg.id]) return HOTEL_NAMES[cfg.id];
    return HOTEL_POOL[Math.abs(cfg.seed | 0) % HOTEL_POOL.length];
  }
  // the ordinary trades a town's other shops are (the sign words the
  // dressing always had), and where a dive shop makes sense
  const TRADES = ["Bakery", "Chemist", "Hardware", "Cafe", "Grocer", "Barber", "Books", "Diner", "Deli",
    "Florist", "Butcher", "Ice Cream", "Laundry", "Newsagent"];
  const SEA_TRADES = ["Surf Shop", "Dive Shop"];
  // what each kind of island has, in the order it chooses (the rarer and
  // pickier first). [use, how many]
  const WANT = {
    // (every town has its emergency services: the fire station's engine bay
    // and the hospital the ambulance runs from; and its bars, where the
    // evening goes)
    harbour: [["police", 1], ["firestation", 1], ["hospital", 1], ["usedcars", 1], ["motel", 1], ["recruit", 1], ["guns", 1], ["pawn", 1], ["loans", 1],
      ["jewelry", 1], ["suits", 1], ["eyewear", 1], ["clothing", 1], ["phones", 1], ["bar", 2], ["apartments", 3]],
    downtown: [["bankhq", 1], ["police", 1], ["firestation", 1], ["hospital", 1], ["jewelry", 1], ["suits", 1], ["phones", 1], ["eyewear", 1],
      ["clothing", 1], ["bar", 1], ["apartments", 3]],
    estates: [["police", 1], ["firestation", 1], ["hospital", 1], ["motel", 1], ["boutiques", 1], ["bar", 1]],
    works: [["police", 1], ["firestation", 1], ["hospital", 1], ["usedcars", 1], ["motel", 1], ["recruit", 1], ["guns", 1], ["pawn", 1], ["loans", 1], ["bar", 2]],
  };
  // the use a lot is by what was built there (the places the plan named)
  function fixedUse(l) {
    if (l.kind === "hotel") return "hotel";
    if (l.kind === "showroom") return "cardealer";
    if (l.kind === "motel") return "motel";
    if (l.kind === "carlot") return "usedcars";
    if (l.kind === "station") return "fuel";
    if (l.kind === "market") return "market";
    if (l.kind === "shed") return "warehouse";
    if (l.kind === "office") return "office";
    if (l.kind === "civic") {
      return { "Town Hall": "cityhall", "Bank": "bank", "St. Mary's": "church", "Mosque": "mosque", "School": "school" }[l.name] || "civic";
    }
    if (l.name === "Chandlery") return "chandlery";
    return null;
  }
  function assignUses(lots, style, urban) {
    const want = WANT[style] || WANT.harbour;
    const h = function (l, s) { return wh(l.x, l.z, s); };
    const nameOf = function (use, l) { const a = USE_NAMES[use]; return a ? a[(h(l, 0x7c1) * a.length) | 0] : null; };
    for (const l of lots) {
      l.use = fixedUse(l); l.U = urban(l.x, l.z);
      // the motel and the car lot the plan laid as places take their trade's name
      if ((l.kind === "motel" || l.kind === "carlot") && !l.name) l.name = nameOf(l.use, l);
    }
    const free = function (l) { return l.use == null; };
    const sname = function (l) { return (l.street && l.street.name) || ""; };
    const ring = function (l) { return /Ring/.test(sname(l)); };
    // the best free lot by score (ties broken by the hash, never by list order)
    function pick(ok, score) {
      let best = null, bs = -1e9;
      for (const l of lots) {
        if (!free(l) || !ok(l)) continue;
        const s = score(l) + h(l, 0x7c2) * 0.01;
        if (s > bs) { bs = s; best = l; }
      }
      return best;
    }
    const shop = function (l) { return l.kind === "shop"; };
    const shopOrWorks = function (l) { return l.kind === "shop" || l.kind === "works"; };
    const SCORE = {
      // a station house: two or three storeys, a main street, not the very centre
      police: [shopOrWorks, function (l) { return (l.storeys >= 2 && l.storeys <= 4 ? 2 : 0) + (1 - Math.abs(l.U - 0.55)) + (l.w >= 11 ? 0.5 : 0) + (l.kind === "shop" ? 1.5 : 0); }],
      // a yard with a forecourt: the works' sheds first, else the deepest setback
      usedcars: [shopOrWorks, function (l) { return (l.kind === "works" ? 3 : 0) + (l.storeys === 1 ? 1 : 0) + (1 - l.U) + l.w * 0.05; }],
      // long and low, out on the ring road
      motel: [function (l) { return l.kind !== "villa" && l.kind !== "tower"; }, function (l) {
        return (ring(l) ? 4 : 0) + (l.storeys === 2 ? 2 : l.storeys === 1 ? 1 : 0) + l.w * 0.15 + (1 - l.U); }],
      recruit: [shop, function (l) { return (l.storeys <= 3 ? 1 : 0) + (1 - Math.abs(l.U - 0.5)); }],
      guns: [shopOrWorks, function (l) { return (l.storeys <= 3 ? 1 : 0) + (1 - Math.abs(l.U - 0.4)) + (l.kind === "shop" ? 1.5 : 0); }],
      pawn: [shopOrWorks, function (l) { return (1 - l.U) * 2 + (l.kind === "shop" ? 1 : 0); }],
      loans: [shop, function (l) { return (1 - l.U) * 2; }],
      jewelry: [shop, function (l) { return l.U * 3; }],
      suits: [shop, function (l) { return l.U * 3; }],
      eyewear: [shop, function (l) { return l.U * 2.5; }],
      clothing: [shop, function (l) { return l.U * 2.5; }],
      phones: [shop, function (l) { return l.U * 2; }],
      apartments: [function (l) { return l.kind === "shop" && l.storeys >= 4; }, function (l) { return l.storeys; }],
      bankhq: [function (l) { return l.kind === "tower"; }, function (l) { return l.storeys + l.U; }],
      // the engine bay: a works shed first (its big door), else a low wide shop, never the very centre
      firestation: [shopOrWorks, function (l) { return (l.kind === "works" ? 3 : 0) + (l.storeys <= 2 ? 1 : 0) + l.w * 0.12 + (1 - Math.abs(l.U - 0.45)); }],
      // the hospital: a broad building of a few storeys, near the middle of town
      hospital: [shop, function (l) { return (l.storeys >= 2 && l.storeys <= 4 ? 2 : 0) + l.w * 0.15 + l.d * 0.05 + (1 - Math.abs(l.U - 0.6)) * 1.5; }],
      // a bar: a low shop between the middle and the edge, the waterfront first;
      // a second one is kept off the first one's street
      // (a works town's bar can be an old shed on the yard road)
      bar: [function (l) { return shopOrWorks(l) && l.storeys <= 4 && !lots.some(function (o) { return o.use === "bar" && sname(o) && sname(o) === sname(l); }); },
        function (l) { return (l.kind === "shop" ? 3 : 0) + (l.district === "waterfront" ? 1.5 : 0) + (l.storeys <= 3 ? 1 : 0) + (1 - Math.abs(l.U - 0.45)) * 1.5 + l.w * 0.04; }],
    };
    function place(use, n) {
      const sc = SCORE[use];
      // a motel or a car lot the plan already laid out is the island's one
      if ((use === "motel" || use === "usedcars") && lots.some(function (l) { return l.use === use; })) return;
      for (let i = 0; i < n; i++) {
        const l = pick(sc[0], sc[1]);
        if (!l) return;
        l.use = use === "bankhq" ? "bank" : use;
        let nm = nameOf(use, l);
        // a town's second bar is not called what its first one is
        const a = USE_NAMES[use];
        if (nm && a && lots.some(function (o) { return o !== l && o.name === nm; })) {
          const k0 = a.indexOf(nm);
          for (let k = 1; k < a.length; k++) { const c = a[(k0 + k) % a.length]; if (!lots.some(function (o) { return o.name === c; })) { nm = c; break; } }
        }
        if (nm) l.name = nm;
      }
    }
    for (const w of want) {
      if (w[0] === "boutiques") {
        // a row: the street with the most free shops, its three nearest the
        // centre of town are the jewellers, the optician and the outfitter
        const by = new Map();
        for (const l of lots) if (free(l) && shop(l)) { const k = sname(l); by.set(k, (by.get(k) || []).concat([l])); }
        let row = null;
        by.forEach(function (ls) { if (!row || ls.length > row.length) row = ls; });
        if (!row) continue;
        row.sort(function (a, b) { return b.U - a.U; });
        const uses = ["jewelry", "eyewear", "clothing"];
        for (let i = 0; i < uses.length && i < row.length; i++) { row[i].use = uses[i]; row[i].name = nameOf(uses[i], row[i]); }
        continue;
      }
      place(w[0], w[1]);
    }
    // everything else: towers are offices, tall shops are flats over a shop,
    // the rest are the town's trades; houses, villas and yards are what they are
    const usedTrade = new Set();
    for (const l of lots) {
      if (!free(l)) continue;
      if (l.kind === "tower") { l.use = "office"; continue; }
      if (l.kind === "house" || l.kind === "villa" || l.kind === "works") { l.use = l.kind; continue; }
      if (l.kind !== "shop") { l.use = "shop"; continue; }
      if (l.storeys >= 5) { l.use = "apartments"; continue; }
      const sea = l.district === "waterfront";
      const pool = sea ? SEA_TRADES.concat(TRADES) : TRADES;
      let k = (h(l, 0x7c3) * pool.length) | 0;
      for (let n = 0; n < pool.length && usedTrade.has(pool[k]); n++) k = (k + 1) % pool.length;
      const t = pool[k];
      // a trade a town has twice is unnamed the second time
      if (!usedTrade.has(t)) { l.name = t; usedTrade.add(t); }
      l.use = t.toLowerCase().replace(/\s+/g, "");
    }
    for (const l of lots) delete l.U;
  }

  /* ======================================================================
     check(plan) — the audit tools/island-check.mjs and the lab kit print.
     Pure: lots against lots, streets, the coast; cars against the
     carriageway / bays / driveways; buildings inside their lots.
     ====================================================================== */
  function check(P) {
    const out = { lots: P.lots.length, overlaps: 0, lotLine: 0, lotOnStreet: 0, offLand: 0, carsTotal: P.cars.length,
      carsOnRoad: 0, carsInBays: 0, carsOnDrive: 0, carsBad: 0, carsOverlap: 0, bad: [] };
    const L = P.lots;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (rectHit(a.lot, b.lot, -0.01)) { out.overlaps++; if (out.bad.length < 12) out.bad.push("overlap " + a.id + "/" + b.id); }
      }
      const fp = { x0: a.bx0, x1: a.bx1, z0: a.bz0, z1: a.bz1 };
      if (fp.x0 < a.lot.x0 - 0.01 || fp.x1 > a.lot.x1 + 0.01 || fp.z0 < a.lot.z0 - 0.01 || fp.z1 > a.lot.z1 + 0.01) {
        out.lotLine++; if (out.bad.length < 12) out.bad.push("footprint past lot " + a.id);
      }
      if (P.inStreet(a.lot, -0.02)) { out.lotOnStreet++; if (out.bad.length < 12) out.bad.push("lot on street " + a.id); }
      for (const c of [[fp.x0, fp.z0], [fp.x1, fp.z0], [fp.x0, fp.z1], [fp.x1, fp.z1]]) if (!P.onLand(c[0], c[1], 0)) { out.offLand++; break; }
    }
    // cars: in a carriageway lane, a car park bay or a driveway
    const HW = roadC().HW;
    for (let i = 0; i < P.cars.length; i++) {
      const c = P.cars[i];
      let ok = false;
      if (c.where === "kerb" && P.roads) {
        for (const p of P.roads.pieces) {
          const perp = p.vertical ? Math.abs(c.x - p.fixed) : Math.abs(c.z - p.fixed);
          const al = p.vertical ? c.z : c.x;
          if (perp + 1.0 <= HW + 0.01 && al - 2.3 >= p.a - 0.01 && al + 2.3 <= p.b + 0.01) { ok = true; break; }
        }
        if (ok) out.carsOnRoad++;
      } else if (c.where === "park") {
        ok = P.parking.some(function (p) { return c.x > p.rect.x0 && c.x < p.rect.x1 && c.z > p.rect.z0 && c.z < p.rect.z1; });
        if (ok) out.carsInBays++;
      } else if (c.where === "drive") {
        const l = P.lots[c.lot];
        ok = !!(l && l.driveway && c.x > l.driveway.rect.x0 && c.x < l.driveway.rect.x1 && c.z > l.driveway.rect.z0 && c.z < l.driveway.rect.z1);
        if (ok) out.carsOnDrive++;
      }
      if (!ok) { out.carsBad++; if (out.bad.length < 16) out.bad.push("car off road " + i + " " + c.where); }
      for (let j = i + 1; j < P.cars.length; j++) {
        const d = P.cars[j];
        if (Math.abs(c.x - d.x) < 2.0 && Math.abs(c.z - d.z) < 2.0) out.carsOverlap++;
      }
    }
    return out;
  }

  CBZ.islandPlan = { make: make, makeSteps: makeSteps, check: check, LAYOUT: L, STYLE: STYLE, STYLES: STYLES };
})();
