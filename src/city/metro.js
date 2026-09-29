/* ============================================================
   city/metro.js — REAL CITIES AT REAL SCALE: where they go, what they
   register, and how they stream.

   OWNER (2026-09-29): "making the Gang Life cities realistically large.
   Some absolutely massive cities could be made. Realistically sized cities,
   not just one mass of tall buildings. You know what I mean?"

   BEFORE (measured in the live world, seed 90210): the Gang City downtown is
   a 330 m square of 36 lots; every other settlement is a 3x4..4x4 towngen
   grid of ~240 m with a clump of towers; 328 buildings in the whole world,
   232 of them one storey. Nothing anywhere had the structure of a city.

   THIS FILE places cities planned by city/metroplan.js (the pure planner:
   land value -> zoning -> arterials -> blocks -> parcels) and wires them into
   the world the same way every landmass is wired (city/worldmap.js
   addLandmass contract):

     KINGSBRIDGE — the metro. ~4.4 x 3.2 km in the open south-west country
       the Continental Loop already crosses: a CBD of 20-70 storey towers on
       a 100 m grid, a midtown, walk-up and rowhouse districts, a central
       park, a university, a stadium on the freeway, three regional malls,
       suburbs of curving streets and cul-de-sacs, an industrial belt on the
       rail line and the river, exurbs and farms at the edge. A river runs
       through it from Kings Pond to Kings Lake; the Loop and the Southgate
       Spur cross it on grade-separated overpasses with diamond interchanges.
     THE CITY RINGS — Goldspire, Cape Harbor and Neon Reef keep their
       walk-in towngen downtowns (the enterable shops, jobs and homes) and
       GROW: midrise, rowhouses and suburbs laid round them by the same
       planner, clipped to the land they actually have.
     GANG CITY WEST — the downtown gets a borough across the harbour, so the
       main city stops being an island blob with countryside on its doorstep.

   WHAT IT REGISTERS AT LOAD (landmass order 43 — after govcomplex (42) has
   claimed its compounds, before highwaynet (91) and the continent (97)):
     • regions (biome = the city id, owner = the city id, terrainGrade:true)
       cut into rects that never cover a freeway, a road deck or somebody
       else's compound — so the continent flattens the ground under the city
       and nobody's road is clamped by it;
     • arterials as road records (district/owner = city id, litByTown: the
       metro draws its own lamps) split at every overpass, the span over the
       freeway `elevated` — traffic drives the city's through streets;
     • the river as ONE path water body + two lakes, and a bridge region
       over every crossing (water carved under, deck reads as land);
     • the physics floor (metro_ground.js solve), overpass platforms and the
       wall/parapet colliders.

   WHAT STREAMS (the load-time rule — the metro is 3-5 km from the spawn, so
   none of its geometry may cost the load): every city is cut into 800 m
   tiles, and every tile has TWO builds of the same buildings:
     NEAR — every detail + colliders (metro_fabric.js) and the streets and
       ground (metro_ground.js); built when the camera comes within range,
       dropped when it is far;
     FAR  — the HLOD: the same buildings at their true footprint, height,
       setbacks, roofs and facades, merged into one draw call per tile.
       Built once, after the near work, and KEPT (it is video memory only).
   Owner, 2026-09-29: "if there's no difference when you do the fake
   skyline, then why are we doing a fake skyline? I want real skyline. I
   want the actual shit in the distance." So there is no stand-in: past the
   near radius the tile you see IS the tile's buildings, and the city
   stays on screen to the distance where its haze completes (it rides the
   ground's fog scale, see metro_fabric.js), with the camera's far plane
   pushed out to reach it (CBZ.metroViewFar, read by city/mode.js). All
   building work runs as sliced jobs under a per-frame millisecond budget,
   so no single frame pays for a whole tile. Trees are instanced at load (a
   few thousand matrices) and dealt into cells by core/farcull.js.

   DETERMINISM: plans are pure functions of (world seed, city id, the live
   region layout). Nothing here draws from an rng stream.

   Exposes: CBZ.metroCities (the map, crowd and tools read it),
   CBZ.metroAudit() (sizes, heights, tiles, streaming state).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  // THREE is only touched when a world is actually built: the placement,
  // constraint, region and road-record logic below is pure and runs in node
  // (tools/metro-plan-check.mjs) against a snapshot of the live layout.
  const THREE = window.THREE;

  const TILE = 800;
  // streaming radii (metres from the camera to a tile's rect)
  const BUILD_R = 1500, DROP_R = 2600;          // on the ground
  const BUILD_R_AIR = 2800, DROP_R_AIR = 4200;  // above ~120 m
  // the city's haze completes where the ground's does: fog.far / its scale
  // (metro_fabric.js FOG_SCALE == metro_ground.js's 0.10). Capped so the far
  // plane never runs past what depth precision can order.
  const HAZE_SCALE = 0.10, VIEW_MAX = 14000;
  // per-frame budget for all metro building work (sliced jobs)
  const BUDGET_MS = 3;

  CBZ.metroCities = [];

  // ------------------------------------------------------------------
  //  THE SITES. Coordinates are where the land is (measured against the
  //  shipped region layout); the planner avoids whatever is actually there
  //  at build time, so a moved compound or a new road never gets built on.
  // ------------------------------------------------------------------
  function siteTable(city) {
    const out = [];
    // THE METRO. The Loop's west leg (x -2380) runs through its east side
    // mid-superblock (the arterial grid is phased so no arterial hugs it),
    // the Southgate Spur (x -280) is its east edge, the Bureau's compound
    // (x -5120..-4812) its north-west corner. minX stays inside the settled
    // union (-5120) so the continent plate does not move a vertex.
    out.push({
      id: "kingsport", name: "Kingsport", tier: "metro", biome: "kingsport",
      cx: -2780, cz: 3050, rx: 2150, rz: 1650,
      bounds: { minX: -5080, maxX: -330, minZ: 950, maxZ: 4660 },
      river: { axis: "z", at: -3450, from: 1010, to: 5000, amp: 150, wave: 1300, name: "Kings River" },
      lakes: [
        { name: "Kings Pond", x: -3450, z: 1010, r: 125 },
        { name: "Kings Lake", x: -3450, z: 5260, r: 560 },
      ],
      rail: { axis: "x", at: 3720, tracks: 2 },
      port: { x: -3450, z: 4450, r: 900 },
    });
    // GANG CITY WEST: the land across the west harbour, between the Brandt
    // bridge and the West Shore Highway. The downtown is its core, so land
    // value falls away from the harbour: walk-ups on the water, rowhouses,
    // then the suburbs toward the Loop.
    if (isFinite(city.minX)) {
      const d = { minX: city.minX, maxX: city.maxX, minZ: city.minZ, maxZ: city.maxZ, name: "downtown" };
      out.push({
        id: "cityborough", name: "Gang City West", tier: "city", biome: "cityborough",
        cx: (d.minX + d.maxX) / 2, cz: (d.minZ + d.maxZ) / 2, rx: 1400, rz: 1000,
        bounds: { minX: d.minX - 1330, maxX: d.minX - 90, minZ: d.minZ - 470, maxZ: d.maxZ + 120 },
        cores: [padR(d, 110)], coreIsDowntown: true,
      });
    }
    // THE RINGS round the walk-in towngen downtowns (read live: the layout
    // dial moves them)
    const rings = [
      { id: "goldspire", name: "Goldspire", grow: 820, rx: 780, rz: 820, tier: "city" },
      { id: "capeharbor", name: "Cape Harbor", grow: 640, rx: 620, rz: 600, tier: "town" },
      { id: "neonreef", name: "Neon Reef", grow: 700, rx: 650, rz: 620, tier: "town" },
    ];
    for (const r of rings) {
      const reg = (city.regions || []).find(function (g) { return g.biome === r.id && g.name === r.name && g.kind !== "circle" && !g.metro; });
      if (!reg) continue;
      const core = { minX: reg.minX, maxX: reg.maxX, minZ: reg.minZ, maxZ: reg.maxZ, name: r.name };
      out.push({
        id: r.id + "-ring", name: r.name, tier: r.tier, biome: r.id,
        cx: (core.minX + core.maxX) / 2, cz: (core.minZ + core.maxZ) / 2, rx: r.rx, rz: r.rz,
        bounds: { minX: core.minX - r.grow, maxX: core.maxX + r.grow, minZ: core.minZ - r.grow, maxZ: core.maxZ + r.grow },
        cores: [padR(core, 24)],
      });
    }
    return out;
  }
  function padR(r, p) { return { minX: r.minX - p, maxX: r.maxX + p, minZ: r.minZ - p, maxZ: r.maxZ + p, name: r.name }; }
  function hit(a, b) { return !(a.maxX <= b.minX || a.minX >= b.maxX || a.maxZ <= b.minZ || a.minZ >= b.maxZ); }

  // ------------------------------------------------------------------
  //  WHAT IS ALREADY THERE: obstacles (places) and corridors (roads)
  // ------------------------------------------------------------------
  const ROADLIKE = /bridge|causeway|link|approach|spur|connector|corridor|ramp|highway|road/i;
  function worldConstraints(city, site, planned) {
    const box = padR(site.bounds, 60);
    const obstacles = [], corridors = [];
    // regions: road-like ones are corridors (crossed at grade), the rest
    // are places nobody builds on
    for (const r of city.regions || []) {
      if (!r || r.underlay || r.biome === "wilds" || r.metro) continue;   // metro cities: `planned` below
      const R = { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ };
      if (!hit(R, box)) continue;
      if (site.cores && site.cores.some(function (c) { return inside(R, padR(c, 30)); })) continue;   // the core's own region
      const w = R.maxX - R.minX, d = R.maxZ - R.minZ;
      if (ROADLIKE.test(r.name || "") && Math.min(w, d) <= 40 && Math.max(w, d) > 3 * Math.min(w, d)) {
        const vert = d > w;
        corridors.push({ axis: vert ? "z" : "x", at: vert ? (R.minX + R.maxX) / 2 : (R.minZ + R.maxZ) / 2,
          a0: vert ? R.minZ : R.minX, a1: vert ? R.maxZ : R.maxX, half: Math.min(w, d) / 2 + 2, name: r.name, grade: true });
      } else {
        obstacles.push({ minX: R.minX, maxX: R.maxX, minZ: R.minZ, maxZ: R.maxZ, name: r.name || r.biome, pad: 16 });
      }
    }
    // road records laid before us (causeways, connectors, town streets
    // outside a core): crossed at grade, never built on
    for (const r of city.roads || []) {
      if (!r || !isFinite(r.x) || !isFinite(r.len) || r.metro) continue;
      const hw = (r.w || r.width || 12) / 2;
      const R = r.vertical ? { minX: r.x - hw, maxX: r.x + hw, minZ: r.z - r.len / 2, maxZ: r.z + r.len / 2 }
                           : { minX: r.x - r.len / 2, maxX: r.x + r.len / 2, minZ: r.z - hw, maxZ: r.z + hw };
      if (!hit(R, box)) continue;
      if (site.cores && site.cores.some(function (c) { return inside(R, padR(c, 2)); })) continue;
      corridors.push({ axis: r.vertical ? "z" : "x", at: r.vertical ? r.x : r.z, a0: r.vertical ? R.minZ : R.minX, a1: r.vertical ? R.maxZ : R.maxX,
        half: hw + 2, name: r.name || r.district || "road", grade: true });
    }
    // the freeway network (highwaynet.js builds it at 91; its table is data
    // now): grade-separated
    const H = CBZ.HIGHWAY_NET_HALF || 15.3;
    const table = CBZ.highwayNetTable ? CBZ.highwayNetTable() : [];
    for (const route of table) {
      const pts = route.pts || [];
      const fillet = route.fillet || 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        const vert = Math.abs(a.x - b.x) < 1e-3;
        const R = vert ? { minX: a.x - H, maxX: a.x + H, minZ: Math.min(a.z, b.z) - fillet, maxZ: Math.max(a.z, b.z) + fillet }
                       : { minX: Math.min(a.x, b.x) - fillet, maxX: Math.max(a.x, b.x) + fillet, minZ: a.z - H, maxZ: a.z + H };
        if (!hit(R, box)) continue;
        corridors.push({ axis: vert ? "z" : "x", at: vert ? a.x : a.z, a0: vert ? Math.min(a.z, b.z) : Math.min(a.x, b.x),
          a1: vert ? Math.max(a.z, b.z) : Math.max(a.x, b.x), half: H + 2, name: route.name, fillet: fillet });
      }
    }
    // the Gang City downtown + its harbour ring, for every site that does
    // not grow from it; the annex island too
    if (isFinite(city.minX) && !site.coreIsDowntown) obstacles.push({ minX: city.minX - 110, maxX: city.maxX + 110, minZ: city.minZ - 110, maxZ: city.maxZ + 110, name: "downtown", pad: 0 });
    if (city.annex && isFinite(city.annex.cx)) {
      const r = (city.annex.radius || 120) + 30;
      obstacles.push({ minX: city.annex.cx - r, maxX: city.annex.cx + r, minZ: city.annex.cz - r, maxZ: city.annex.cz + r, name: "annex", pad: 0 });
    }
    // cities already planned this build are places too
    for (const p of planned) for (const r of p.regions) obstacles.push({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, name: p.id, pad: 30 });
    return { obstacles: obstacles, corridors: corridors };
  }
  function inside(a, b) { return a.minX >= b.minX && a.maxX <= b.maxX && a.minZ >= b.minZ && a.maxZ <= b.maxZ; }

  // one site -> one plan, from the live layout (shared with the node check)
  function planSite(city, site, planned) {
    const C = worldConstraints(city, site, planned);
    const P = CBZ.metroPlan({
      id: site.id, name: site.name, tier: site.tier, seed: CBZ.WORLD_SEED | 0,
      cx: site.cx, cz: site.cz, rx: site.rx, rz: site.rz, bounds: site.bounds,
      obstacles: C.obstacles.concat((site.lakes || []).map(function (l) { return { minX: l.x - l.r, maxX: l.x + l.r, minZ: l.z - l.r, maxZ: l.z + l.r, name: l.name, pad: 18 }; })),
      corridors: C.corridors, cores: site.cores || [], river: site.river, rail: site.rail, port: site.port,
    });
    P.cores = site.cores || [];
    return P;
  }

  // ------------------------------------------------------------------
  //  REGIONS: the cells the plan builds on, as rects with every corridor,
  //  obstacle and core cut out (rect difference; tiny pieces dropped)
  // ------------------------------------------------------------------
  function rectMinus(r, c) {
    if (!hit(r, c)) return [r];
    const out = [];
    if (c.minX > r.minX) out.push({ minX: r.minX, maxX: c.minX, minZ: r.minZ, maxZ: r.maxZ });
    if (c.maxX < r.maxX) out.push({ minX: c.maxX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ });
    const x0 = Math.max(r.minX, c.minX), x1 = Math.min(r.maxX, c.maxX);
    if (c.minZ > r.minZ) out.push({ minX: x0, maxX: x1, minZ: r.minZ, maxZ: c.minZ });
    if (c.maxZ < r.maxZ) out.push({ minX: x0, maxX: x1, minZ: c.maxZ, maxZ: r.maxZ });
    return out;
  }
  function planRegions(P) {
    // rows of consecutive used cells
    let rects = [];
    for (let j = 0; j < P.NZ; j++) {
      let run = null;
      for (let i = 0; i <= P.NX; i++) {
        const c = i < P.NX ? P.cellAt(i, j) : null;
        const used = c && c.use !== "void";
        if (used) {
          if (!run) run = { minX: c.x0, maxX: c.x1, minZ: c.z0, maxZ: c.z1 };
          else run.maxX = c.x1;
        } else if (run) { rects.push(run); run = null; }
      }
    }
    // merge vertically identical runs
    rects.sort(function (a, b) { return a.minX - b.minX || a.maxX - b.maxX || a.minZ - b.minZ; });
    const merged = [];
    for (const r of rects) {
      const m = merged.find(function (q) { return q.minX === r.minX && q.maxX === r.maxX && Math.abs(q.maxZ - r.minZ) < 1e-6; });
      if (m) m.maxZ = r.maxZ; else merged.push(Object.assign({}, r));
    }
    rects = merged;
    // cut: corridors (+4 m), obstacles (their own pad), cores, bounds
    const cuts = [];
    for (const c of P.corridors) {
      const h = c.half + 4;
      cuts.push(c.ax === "x" ? { minX: c.at - h, maxX: c.at + h, minZ: c.a0 - h - (c.fillet || 0), maxZ: c.a1 + h + (c.fillet || 0) }
                             : { minX: c.a0 - h - (c.fillet || 0), maxX: c.a1 + h + (c.fillet || 0), minZ: c.at - h, maxZ: c.at + h });
    }
    for (const o of P.obstacles) cuts.push({ minX: o.minX, maxX: o.maxX, minZ: o.minZ, maxZ: o.maxZ });
    for (const c of (P.cores || [])) cuts.push(c);
    for (const c of cuts) {
      const next = [];
      for (const r of rects) for (const q of rectMinus(r, c)) next.push(q);
      rects = next;
    }
    const B = P.bounds;
    rects = rects.map(function (r) { return { minX: Math.max(r.minX, B.minX), maxX: Math.min(r.maxX, B.maxX), minZ: Math.max(r.minZ, B.minZ), maxZ: Math.min(r.maxZ, B.maxZ) }; })
      .filter(function (r) { return r.maxX - r.minX >= 40 && r.maxZ - r.minZ >= 40; });
    return rects;
  }

  // ------------------------------------------------------------------
  //  ARTERIAL ROAD RECORDS (traffic): one per straight arterial piece,
  //  split at the overpasses so the span over a freeway never pairs with it
  // ------------------------------------------------------------------
  function roadRecords(P, id) {
    const out = [];
    const ov = {};
    for (const o of P.overpasses) (ov[o.street] = ov[o.street] || []).push(o);
    for (const s of P.streets) {
      if (s.k !== "art" && s.k !== "rural") continue;
      const lanes = s.k === "art" ? 2 : 1;
      const pieces = [];
      const spans = (ov[s.id] || []).map(function (o) { return [o.a0 - 90, o.a1 + 90]; }).sort(function (a, b) { return a[0] - b[0]; });
      let a = s.a0;
      for (const sp of spans) {
        const e0 = Math.max(s.a0, sp[0]), e1 = Math.min(s.a1, sp[1]);
        if (e0 > a + 8) pieces.push({ a0: a, a1: e0, elevated: false });
        pieces.push({ a0: e0, a1: e1, elevated: true });
        a = e1;
      }
      if (s.a1 > a + 8) pieces.push({ a0: a, a1: s.a1, elevated: false });
      for (const p of pieces) {
        const len = p.a1 - p.a0, mid = (p.a0 + p.a1) / 2;
        const rec = {
          x: s.axis === "x" ? s.at : mid, z: s.axis === "x" ? mid : s.at, vertical: s.axis === "x", len: len,
          w: s.w, width: s.w, lanesPerDir: lanes, laneW: s.k === "art" ? 3.6 : 3.25,
          district: id, owner: id, litByTown: true, metro: id,
          // the boot fleet stays where the player starts; the recycler in
          // traffic.js brings cars to these streets when he is on them
          trafficWeight: 0.25, speedLimit: s.k === "art" ? 40 : 45,
        };
        // the piece over a freeway carries its 90 m approach ramps
        // (CBZ.roadDeckY reads y/ramp: flat at y, straight ramps at the ends)
        if (p.elevated) { rec.elevated = true; rec.y = 7.6; rec.ramp = 90; }
        out.push(rec);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------
  //  RIVER BODY + BRIDGE REGIONS
  // ------------------------------------------------------------------
  function riverBody(P) {
    if (!P.river) return null;
    const pts = [], halves = [];
    const src = P.river.pts;
    // decimate to ~120 m (the field is evaluated per plate vertex and per
    // physics water query: fewer segments inside the bbox is the cost)
    for (let i = 0; i < src.length; i += 2) pts.push({ x: src[i].x, z: src[i].z });
    if (pts[pts.length - 1] !== src[src.length - 1]) pts.push({ x: src[src.length - 1].x, z: src[src.length - 1].z });
    for (let i = 0; i < pts.length; i++) {
      // taper at the head (the pond) and flare into the lake
      const t = i / (pts.length - 1);
      halves.push(P.river.half * (t < 0.08 ? 0.75 + 0.25 * (t / 0.08) : 1) * (t > 0.92 ? 1 + 0.4 * ((t - 0.92) / 0.08) : 1));
    }
    const bbox = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 };
    for (let i = 0; i < pts.length; i++) {
      const h = halves[i] + 4;
      bbox.minX = Math.min(bbox.minX, pts[i].x - h); bbox.maxX = Math.max(bbox.maxX, pts[i].x + h);
      bbox.minZ = Math.min(bbox.minZ, pts[i].z - h); bbox.maxZ = Math.max(bbox.maxZ, pts[i].z + h);
    }
    return { kind: "path", pts: pts, half: halves, axis: P.river.along, bbox: bbox, name: P.river.name, metro: P.id };
  }

  // ------------------------------------------------------------------
  //  TREES: the street-tree kit the downtown plants (props.js), instanced.
  //  Two crowns: the street/yard tree and the big park/avenue tree.
  // ------------------------------------------------------------------
  let treeKit = null;
  function trees(root, P, floorAt) {
    if (!P.trees.length || !CBZ.treeCrownGeo || !CBZ.treeTrunkGeo) return [];
    const VK = CBZ.vegetationKit;
    if (!treeKit) {
      treeKit = {
        trunk: CBZ.treeTrunkGeo({ rTop: 0.1, rBase: 0.17, h: 3.2, seg: 7, roots: 4, rise: 0.18, dip: 0.04, spread: 1.6, flare: 1.4, uvRepeat: 3, site: "metro" }),
        crownS: CBZ.treeCrownGeo({ tiers: 2, r: 1.5, h: 3.1, seg: 7, taper: 0.66, site: "metro-street", leaf: !!VK, cards: 12 }),
        crownL: CBZ.treeCrownGeo({ tiers: 2, r: 2.6, h: 4.6, seg: 7, taper: 0.7, site: "metro-park", leaf: !!VK, cards: 16 }),
        trunkM: VK ? VK.material("wood", 0x8c6a48) : new THREE.MeshLambertMaterial({ color: 0x6e4a2c }),
        crownM: VK ? [VK.material("foliage", 0x5f9a4c), VK.material("foliage", 0x6f9e50)] : [new THREE.MeshLambertMaterial({ color: 0x3f7d3a }), new THREE.MeshLambertMaterial({ color: 0x4f9942 })],
      };
    }
    const big = function (k) { return k === "park" || k === "avenue" || k === "hedge"; };
    const lists = { trunk: [], s0: [], s1: [], l0: [], l1: [] };
    const hsh = CBZ.hash01 || function () { return 0.5; };
    for (const t of P.trees) {
      const L = big(t.k);
      const sc = t.s * (L ? 1.05 : 1);
      const ci = hsh(t.x, t.z, 0x7e2) < 0.5 ? 0 : 1;
      const ry = hsh(t.x, t.z, 0x7e1) * 6.283;
      const y = floorAt ? (floorAt(t.x, t.z) || 0) : 0.16;
      lists.trunk.push([t.x, y, t.z, ry, sc * (L ? 1.35 : 1)]);
      lists[(L ? "l" : "s") + ci].push([t.x, y + (L ? 3.4 : 2.6) * sc, t.z, ry, sc]);
    }
    const out = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
    function pool(name, geo, mat, items, shadow) {
      if (!items.length || !geo) return;
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        e.set(0, it[3], 0); q.setFromEuler(e); v.set(it[0], it[1], it[2]); s.set(it[4], it[4], it[4]);
        m4.compose(v, q, s); im.setMatrixAt(i, m4);
      }
      im.instanceMatrix.needsUpdate = true;
      im.name = "metro-" + P.id + "-" + name;
      im.frustumCulled = false;                 // core/instcull.js bounds it; core/farcull.js deals it into cells
      im.castShadow = !!shadow; im.receiveShadow = true;
      im.userData = { vegetationLayer: "metro", metro: P.id };
      root.add(im);
      out.push(im);
    }
    pool("trunks", treeKit.trunk, treeKit.trunkM, lists.trunk, true);
    pool("crowns-s0", treeKit.crownS, treeKit.crownM[0], lists.s0, true);
    pool("crowns-s1", treeKit.crownS, treeKit.crownM[1], lists.s1, true);
    pool("crowns-l0", treeKit.crownL, treeKit.crownM[0], lists.l0, true);
    pool("crowns-l1", treeKit.crownL, treeKit.crownM[1], lists.l1, true);
    return out;
  }

  // ------------------------------------------------------------------
  //  THE BUILDER
  // ------------------------------------------------------------------
  let solidRef = null;
  function build(city) {
    // a rebuilt world: let go of the last one's cities
    for (const m of CBZ.metroCities) { try { if (m.group && m.group.parent) m.group.parent.remove(m.group); } catch (e) {} }
    CBZ.metroCities.length = 0;
    if (!CBZ.metroPlan || !city || !city.root) return;
    const T0 = performance.now();
    const planned = [];
    for (const site of siteTable(city)) {
      try {
        const P = planSite(city, site, planned);
        const regions = planRegions(P);
        const rec = { id: site.id, name: site.name, tier: site.tier, biome: site.biome, plan: P, regions: regions, group: null, tiles: [], site: site, lakes: site.lakes || [] };
        planned.push(rec);
        register(city, rec);
      } catch (e) { console.error("[metro] " + site.id, e); }
    }
    CBZ.metroCities.push.apply(CBZ.metroCities, planned);
    _audit.buildMs = Math.round(performance.now() - T0);
  }

  function register(city, M) {
    const P = M.plan, id = M.id;
    // ---- the group every mesh of this city hangs from. `terrain` keeps
    //      core/farcull.js from hiding the whole city as one far group;
    //      streaming below owns its distance behaviour.
    const g = new THREE.Group();
    g.name = "metro-" + id;
    g.userData.terrain = true; g.userData.metro = id;
    city.root.add(g);
    M.group = g;
    // ---- regions. A city's NAME must never match /bridge|causeway|link/:
    //      waterfield.js reads every such region as a road deck (dry land
    //      over water), so a metro once called "Kingsbridge" had no river.
    if (/bridge|causeway|link/i.test(M.name)) console.warn("[metro] a city named '" + M.name + "' reads as a deck to waterfield.js");
    M.regionRecs = [];
    M.regions.forEach(function (r, k) {
      const reg = CBZ.registerCityRegion(city, {
        name: M.name, subtitle: M.tier === "metro" ? "Metro" : "City", biome: M.biome, owner: id, metro: id,
        kind: "rect", minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, pad: 1, terrainGrade: true, mapLabel: false,
      });
      M.regionRecs.push(reg);
    });
    // ---- water: the river (one path body) + its lakes, then a bridge
    //      region over every crossing
    city.waterBodies = city.waterBodies || [];
    const body = riverBody(P);
    if (body) city.waterBodies.push(body);
    for (const l of M.lakes) {
      if (CBZ.registerCityWaterBody) CBZ.registerCityWaterBody(city, { id: id + "-" + l.name.toLowerCase().replace(/\s+/g, "-"), name: l.name, kind: "circle", cx: l.x, cz: l.z, r: l.r, inland: true, metro: id });
    }
    for (const b of P.bridges) {
      const hw = b.w / 2 + 3;
      const R = b.axis === "x" ? { minX: b.at - hw, maxX: b.at + hw, minZ: b.a0, maxZ: b.a1 } : { minX: b.a0, maxX: b.a1, minZ: b.at - hw, maxZ: b.at + hw };
      CBZ.registerCityRegion(city, Object.assign({ name: M.name + " Bridge", biome: M.biome, kind: "rect", owner: id, metro: id, pad: 0.5 }, R));
    }
    // ---- arterials into the traffic network
    const recs = roadRecords(P, id);
    city.roads = city.roads || [];
    for (const r of recs) city.roads.push(r);
    M.roadCount = recs.length;
    // ---- the floor, the platforms, the ground colliders (data only)
    if (CBZ.metroGround && CBZ.metroGround.solve) {
      try {
        const S = CBZ.metroGround.solve(P);
        M.solve = S;
        if (S.heightAt && CBZ.registerCityGroundHeight) CBZ.registerCityGroundHeight(function (x, z) { const y = S.heightAt(x, z); return y == null ? 0 : y; }, { name: "metro:" + id });
        if (S.platforms) for (const p of S.platforms) CBZ.platforms.push(p);
        if (S.colliders && S.colliders.length) {
          if (!solidRef) solidRef = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ color: 0x8a8680 }));
          for (const c of S.colliders) { if (!c.ref) c.ref = solidRef; CBZ.colliders.push(c); }
        }
      } catch (e) { console.error("[metro ground solve] " + id, e); }
    }
    // ---- tiles (no geometry yet: a near and a far mesh each) + trees
    M.fabric = null; M.ground = null;
    if (CBZ.metroFabric && CBZ.metroFabric.prepare) {
      try { M.fabric = CBZ.metroFabric.prepare(P, { root: g, tile: TILE, name: id }); } catch (e) { console.error("[metro fabric prepare] " + id, e); }
    }
    if (CBZ.metroGround && CBZ.metroGround.prepare) {
      try { M.ground = CBZ.metroGround.prepare(P, { root: g, tile: TILE, name: id }); } catch (e) { console.error("[metro ground prepare] " + id, e); }
    }
    M.tiles = mergeTiles(M);
    // trees hang from the ARENA root (core/farcull.js deals root-level
    // scenery pools into cells)
    try { M.trees = trees(city.root, P, M.solve && M.solve.heightAt); } catch (e) { console.error("[metro trees] " + id, e); M.trees = []; }
  }

  // one streaming record per tile key, holding both halves
  function mergeTiles(M) {
    const map = new Map();
    function add(list, kind) {
      if (!list || !list.tiles) return;
      for (const t of list.tiles) {
        let r = map.get(t.key);
        if (!r) { r = { key: t.key, x0: t.x0, z0: t.z0, x1: t.x1, z1: t.z1, fab: null, gnd: null, built: false, cols: null }; map.set(t.key, r); }
        r.x0 = Math.min(r.x0, t.x0); r.z0 = Math.min(r.z0, t.z0); r.x1 = Math.max(r.x1, t.x1); r.z1 = Math.max(r.z1, t.z1);
        r[kind] = t;
      }
    }
    add(M.fabric, "fab"); add(M.ground, "gnd");
    return Array.from(map.values());
  }

  // ------------------------------------------------------------------
  //  STREAMING: near tiles in range, far tiles everywhere in view, every
  //  build a sliced job under BUDGET_MS a frame
  // ------------------------------------------------------------------
  // the ground half (metro_ground.js) is one atomic build; the buildings
  // (near or far) run through metro_fabric's job slicer
  function buildPart(M, t, part) {
    const T0 = performance.now();
    if (part === "gnd") {
      if (t.gnd && CBZ.metroGround.buildTile && !t.gndBuilt) { try { CBZ.metroGround.buildTile(M.plan, t.gnd); } catch (e) { console.error("[metro ground tile]", e); } }
      t.gndBuilt = true;
    } else if (part === "far") {
      if (t.fab && !t.fab.farBuilt) { try { fabDone(M, t, "far", CBZ.metroFabric.buildFarTile(M.plan, t.fab)); } catch (e) { console.error("[metro far tile]", e); } }
      t.fab && (t.fab.farBuilt = true);
    } else {
      if (t.fab && CBZ.metroFabric.buildTile && !t.fabBuilt) {
        try { fabDone(M, t, "fab", CBZ.metroFabric.buildTile(M.plan, t.fab)); } catch (e) { console.error("[metro fabric tile]", e); }
      }
      t.fabBuilt = true;
    }
    t.built = !!(t.gndBuilt && t.fabBuilt);
    note(performance.now() - T0);
  }
  function note(ms) { _audit.tileBuilds++; _audit.tileMsMax = Math.max(_audit.tileMsMax, ms); _audit.tileMsSum += ms; }
  // a finished building job: colliders in (near), then show the right one
  function fabDone(M, t, part, r) {
    if (part === "fab") {
      t.cols = (r && r.colliders) || [];
      for (const c of t.cols) { if (CBZ.colliderAdd) CBZ.colliderAdd(c); else CBZ.colliders.push(c); }
      if (!CBZ.colliderAdd && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      t.fabBuilt = true;
      t.nearEmpty = !!(r && r.empty);
      t.built = !!(t.gndBuilt && t.fabBuilt);
    } else {
      t.farEmpty = !!(r && r.empty);
      _audit.farBuilds++; _audit.farBytes += (r && r.stats && r.stats.bytes) || 0;
    }
    showTile(t, _cx, _cz);
  }
  function dropTile(M, t) {
    if (_cur && _cur.t === t && _cur.part === "fab") _cur = null;
    if (t.fab && CBZ.metroFabric.disposeTile) {
      try { CBZ.metroFabric.disposeTile(M.plan, t.fab); } catch (e) {}
    }
    if (t.gnd && CBZ.metroGround.disposeTile) { try { CBZ.metroGround.disposeTile(M.plan, t.gnd); } catch (e) {} }
    if (t.cols && t.cols.length) {
      const gone = new Set(t.cols);
      const cols = CBZ.colliders;
      let w = 0;
      for (let i = 0; i < cols.length; i++) if (!gone.has(cols[i])) cols[w++] = cols[i];
      cols.length = w;
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    t.cols = null; t.built = false; t.gndBuilt = false; t.fabBuilt = false;
    _audit.tileDrops++;
    showTile(t, _cx, _cz);
  }
  function rectDist(t, x, z) {
    const dx = Math.max(t.x0 - x, 0, x - t.x1), dz = Math.max(t.z0 - z, 0, z - t.z1);
    return Math.hypot(dx, dz);
  }
  function rectFar(t, x, z) {
    const dx = Math.max(Math.abs(t.x0 - x), Math.abs(t.x1 - x)), dz = Math.max(Math.abs(t.z0 - z), Math.abs(t.z1 - z));
    return Math.hypot(dx, dz);
  }
  // WHICH OF THE PAIR IS DRAWN. The near tile inside its build radius (plus
  // a band so a tile on the edge doesn't flip), the far tile everywhere
  // else in view; never both, never neither while either exists.
  let _cx = 0, _cz = 0, _showR = BUILD_R + 300, _viewR = 1e9;
  function showTile(t, x, z) {
    const f = t.fab;
    const d = rectDist(t, x, z);
    const nearOK = !!(f && t.fabBuilt && !t.nearEmpty);
    const farOK = !!(f && f.farBuilt && !t.farEmpty);
    const inView = d < _viewR;
    const nearOn = nearOK && inView && (d < _showR || !farOK);
    const farOn = farOK && inView && !nearOn;
    if (f && f.mesh && f.mesh.visible !== nearOn) f.mesh.visible = nearOn;
    if (f && f.far && f.far.visible !== farOn) f.far.visible = farOn;
    // the streets go with the near buildings: past the swap the far tile's
    // city stands on the continent plate (flattened under it at load)
    const gOn = inView && !!t.gndBuilt && d < _showR;
    if (t.gnd && t.gnd.meshes) for (const m of t.gnd.meshes) if (m.visible !== gOn) m.visible = gOn;
  }

  let _lastSweep = 0;
  const _pending = [];
  let _cur = null;                 // the building job in flight: { M, t, part, J }
  function pump() {
    let left = BUDGET_MS;
    while (left > 0.25) {
      if (!_cur) {
        const job = _pending.shift();
        if (!job) return;
        const t = job.t;
        if (job.part === "gnd") {
          if (t.gndBuilt) continue;
          buildPart(job.M, t, "gnd");
          showTile(t, _cx, _cz);
          return;                                  // atomic: it had this frame
        }
        if (!t.fab || (job.part === "fab" ? t.fabBuilt : t.fab.farBuilt)) continue;
        _cur = { M: job.M, t: t, part: job.part, J: CBZ.metroFabric.job(job.M.plan, t.fab, job.part === "far"), t0: performance.now() };
      }
      const s0 = performance.now();
      const r = CBZ.metroFabric.runJob(_cur.J, left);
      const ms = performance.now() - s0;
      left -= ms;
      _audit.sliceMsMax = Math.max(_audit.sliceMsMax, ms);
      if (r) {
        const c = _cur; _cur = null;
        note(r.stats.ms);
        if (c.part === "far") c.t.fab.farBuilt = true; else c.t.fabBuilt = true;
        fabDone(c.M, c.t, c.part, r);
      }
    }
  }
  /* ------------------------------------------------------------------
     THE FAR GROUND. Past the swap the far skyline stands on the continent
     plate, and the plate painted it country: the distant city stood on
     meadow. metro_ground.js rasterises each city's land use (streets,
     blocks, lawns, lots, fields, lamps) into a small map; here they are
     made after load, a slice at a time while no tile work is waiting, and
     packed into ONE mipmapped atlas the plate's ground skin samples
     (textures_surface.js cityMap). No geometry, no draw call.
     ------------------------------------------------------------------ */
  let _maps = null, _mapI = 0, _mapsDone = false;
  const MAP_BUDGET_MS = 2;
  function farMapPump() {
    const FC = CBZ.farCityMap, MG = CBZ.metroGround;
    if (_mapsDone || !FC || !MG || !MG.farMap || !THREE) { _mapsDone = true; return; }
    if (!_maps) {
      _maps = [];
      for (const M of CBZ.metroCities) {
        if (_maps.length >= FC.max) break;
        try { const m = MG.farMap(M.plan); if (m) { m.id = M.id; _maps.push(m); } } catch (e) { console.error("[metro far map] " + M.id, e); }
      }
      return;
    }
    const end = performance.now() + MAP_BUDGET_MS;
    while (_mapI < _maps.length && performance.now() < end) {
      if (_maps[_mapI].step(end - performance.now())) _mapI++;
    }
    if (_mapI < _maps.length) return;
    _mapsDone = true;
    try { packFarMaps(_maps, FC.uniforms); } catch (e) { console.error("[metro far map atlas]", e); }
    _maps = null;
  }
  // guillotine-pack the maps (power-of-two each, largest first) into the
  // smallest power-of-two atlas that holds them; every city gets its world
  // rect and its atlas rect
  function packInto(order, AW, AH) {
    const free = [{ x: 0, y: 0, w: AW, h: AH }];
    for (const m of order) {
      let bi = -1;
      for (let i = 0; i < free.length; i++) {
        const f = free[i];
        if (f.w >= m.w && f.h >= m.h && (bi < 0 || f.w * f.h < free[bi].w * free[bi].h)) bi = i;
      }
      if (bi < 0) return false;
      const f = free.splice(bi, 1)[0];
      m.ax = f.x; m.ay = f.y;
      if (f.w - m.w > 0) free.push({ x: f.x + m.w, y: f.y, w: f.w - m.w, h: m.h });
      if (f.h - m.h > 0) free.push({ x: f.x, y: f.y + m.h, w: f.w, h: f.h - m.h });
    }
    return true;
  }
  function packFarMaps(maps, U) {
    const order = maps.slice().sort(function (a, b) { return b.w * b.h - a.w * a.h; });
    let AW = 256, AH = 256;
    while (!packInto(order, AW, AH)) { if (AW <= AH) AW *= 2; else AH *= 2; }
    const data = new Uint8Array(AW * AH * 4);
    for (const m of order) {
      for (let j = 0; j < m.h; j++) data.set(m.data.subarray(j * m.w * 4, (j + 1) * m.w * 4), ((m.ay + j) * AW + m.ax) * 4);
      m.data = null;
    }
    const tex = new THREE.DataTexture(data, AW, AH, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = CBZ.renderer && CBZ.renderer.capabilities && CBZ.renderer.capabilities.getMaxAnisotropy ? Math.min(8, CBZ.renderer.capabilities.getMaxAnisotropy()) : 1;
    tex.needsUpdate = true;
    order.forEach(function (m, i) {
      U.uGndCityR.value[i].set(m.x0, m.z0, 1 / (m.w * m.cell), 1 / (m.h * m.cell));
      U.uGndCityA.value[i].set(m.ax / AW, m.ay / AH, m.w / AW, m.h / AH);
    });
    U.uGndCity.value = tex;
    U.uGndCityN.value = order.length;
    _audit.farMapMB = +(AW * AH * 4 * 4 / 3 / 1048576).toFixed(1);
    _audit.farMapMs = Math.round(order.reduce(function (s, m) { return s + m.ms; }, 0));
  }

  CBZ.onAlways && CBZ.onAlways(58, function () {
    const g = CBZ.game;
    if (!g || g.mode !== "city" || !CBZ.metroCities.length) return;
    if (_cur || _pending.length) pump();
    else if (!_mapsDone) farMapPump();
    const now = performance.now();
    if (now - _lastSweep < 400) return;
    _lastSweep = now;
    const cam = CBZ.camera, P = CBZ.player;
    const x = cam ? cam.position.x : (P ? P.x : 0), z = cam ? cam.position.z : (P ? P.z : 0);
    const alt = cam ? cam.position.y : 2;
    const air = alt > 120;
    _cx = x; _cz = z;
    // THE NEAR RADIUS is a detail distance (the street fog still sets it:
    // inside it the near tile's awnings, AC boxes and stoops are over a
    // pixel). THE VIEW RADIUS is where the city's own haze completes.
    const fog = CBZ.scene && CBZ.scene.fog;
    const fogFar = (fog && fog.far) || CBZ.cityFogFar || 1400;
    const SEE = fogFar + 60;
    const BR = Math.min(air ? BUILD_R_AIR : BUILD_R, SEE + 200), DR = Math.max(BR + 600, air ? DROP_R_AIR : DROP_R);
    _showR = BR + 150;
    _viewR = Math.min(VIEW_MAX, fogFar / HAZE_SCALE);
    // high up the aerial melt (core/renderer.js) completes the fog at
    // fog.far on true depth: past it a tile is pure fog colour, not drawn
    if (alt > 900) _viewR = Math.min(_viewR, fogFar + 100);
    let reach = 0;
    for (const M of CBZ.metroCities) {
      if (!M.group) continue;
      const F = M.plan.stats.footprint;
      const dc = rectDist({ x0: F.minX, z0: F.minZ, x1: F.maxX, z1: F.maxZ }, x, z);
      const on = dc < _viewR;
      if (M.group.visible !== on) M.group.visible = on;
      // trees wear the world's vegetation fog (they fade where every other
      // tree does); past it they are pure fog colour, so not drawn
      const treesOn = dc < SEE;
      for (const tp of M.trees || []) if (tp.visible !== treesOn) tp.visible = treesOn;
      if (!on) continue;
      for (const t of M.tiles) {
        showTile(t, x, z);
        if (rectDist(t, x, z) < _viewR) reach = Math.max(reach, rectFar(t, x, z));
      }
    }
    // the camera's far plane must reach the farthest tile in view
    CBZ.metroViewFar = reach > 0 && !(CBZ.CONFIG && CBZ.CONFIG.METRO_VIEW_FAR === false) ? Math.min(_viewR, reach) + 60 : 0;
    _pending.length = 0;
    const want = [], wantFar = [];
    for (const M of CBZ.metroCities) {
      if (!M.group || !M.tiles) continue;
      for (const t of M.tiles) {
        const d = rectDist(t, x, z);
        if (!t.built && d < BR) want.push({ M: M, t: t, d: d });
        // a near tile is let go only once its far tile can stand in
        else if ((t.gndBuilt || t.fabBuilt) && d > DR && (!t.fab || t.fab.farBuilt)) dropTile(M, t);
        if (t.fab && !t.fab.farBuilt && (d < _viewR || t.fabBuilt)) wantFar.push({ M: M, t: t, d: d });
      }
    }
    want.sort(function (a, b) { return a.d - b.d; });
    wantFar.sort(function (a, b) { return a.d - b.d; });
    for (const w of want) {
      if (!w.t.gndBuilt) _pending.push({ M: w.M, t: w.t, part: "gnd" });
      if (!w.t.fabBuilt) _pending.push({ M: w.M, t: w.t, part: "fab" });
    }
    for (const w of wantFar) _pending.push({ M: w.M, t: w.t, part: "far" });
  });

  // ------------------------------------------------------------------
  //  AUDIT — what the tools (and the report) read
  // ------------------------------------------------------------------
  const _audit = { buildMs: 0, tileBuilds: 0, tileDrops: 0, tileMsMax: 0, tileMsSum: 0, sliceMsMax: 0, farBuilds: 0, farBytes: 0 };
  CBZ.metroAudit = function () {
    return {
      buildMs: _audit.buildMs, tileBuilds: _audit.tileBuilds, tileDrops: _audit.tileDrops,
      tileMsMax: Math.round(_audit.tileMsMax * 10) / 10, tileMsMean: _audit.tileBuilds ? Math.round(_audit.tileMsSum / _audit.tileBuilds * 10) / 10 : 0,
      sliceMsMax: Math.round(_audit.sliceMsMax * 10) / 10, farBuilds: _audit.farBuilds, farMB: +(_audit.farBytes / 1048576).toFixed(1),
      farMap: _mapsDone ? { MB: _audit.farMapMB || 0, ms: _audit.farMapMs || 0 } : null,
      viewFar: CBZ.metroViewFar || 0, viewR: Math.round(_viewR), showR: Math.round(_showR),
      cities: CBZ.metroCities.map(function (M) {
        const S = M.plan.stats;
        return {
          id: M.id, name: M.name, tier: M.tier, footprint: S.footprint, buildings: S.buildings, storeyBands: S.storeyBands,
          tallest: S.tallest, population: S.population, jobs: S.jobs, streetKm: S.streetKm, districts: M.plan.districts.map(function (d) { return d.name + " (" + d.kind + ")"; }),
          landmarks: M.plan.landmarks.map(function (l) { return l.name; }), regions: M.regions.length, roads: M.roadCount,
          tiles: M.tiles.length, built: M.tiles.filter(function (t) { return t.built; }).length,
          farBuilt: M.tiles.filter(function (t) { return t.fab && t.fab.farBuilt; }).length,
          drawnNear: M.tiles.filter(function (t) { return t.fab && t.fab.mesh && t.fab.mesh.visible; }).length,
          drawnFar: M.tiles.filter(function (t) { return t.fab && t.fab.far && t.fab.far.visible; }).length,
          trees: M.plan.trees.length, planMs: M.plan.ms,
        };
      }),
    };
  };

  // tools force a build/drop without walking there (speed/probe scripts)
  CBZ.metroStream = { buildPart: buildPart, dropTile: dropTile };
  CBZ.metroLib = { siteTable: siteTable, planSite: planSite, worldConstraints: worldConstraints, planRegions: planRegions, roadRecords: roadRecords, riverBody: riverBody, TILE: TILE };
  if (THREE && CBZ.addLandmass) CBZ.addLandmass(function (city) {
    try { build(city); } catch (e) { console.error("[metro]", e); }
  }, 43);
})();
