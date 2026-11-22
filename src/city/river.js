/* ============================================================
   city/river.js — THE RIVERS. Authored courses, carved as real water.

   The courses are the WORLD PLAN's (src/world/worldplan.js `rivers`): each
   rises in the Mercy Range and runs to the sea, or into a city's own river.
   The Mercy comes down Mercy Valley to the head of the gulf beside Gang
   City; the Redhollow runs out through the woods to Mbeya Bay; the upper
   Kings and Karvel feed the two metros' rivers.

   This file used to SEARCH for one river: the downtown harbour was a closed
   moat 7 km from any coast, so a grid router hunted a way from the marina to
   the sea round whatever happened to be built (it ran 8.7 km north through
   the mountains). The plan brings the sea to the harbour, so that search is
   gone and so is the lake-outlet router that reused it: a river is drawn
   where the geography puts it, and a place that stands in a river's way is a
   mistake on the map (tools/citymap marks it), not something to route round.

   WHAT THIS FILE DOES WITH A COURSE
     · smooths it, lets it wander a little (hash noise, none at either end),
       tapers it from a stream at the source to an estuary at the mouth;
     · registers ONE `path` water body (city/continent.js's shore field
       carves it like any other water: it renders, you can swim it, boats
       float on it, wildlife navigates it, the map shows it);
     · bridges every road record that crosses it: a link region (water is
       carved under it, the deck reads as land above: the name is load-
       bearing, see below) plus piers and parapets so it reads as a bridge;
     · gives its banks three fishing stations.

   A BOAT CAN PASS UNDER A BRIDGE: waterfield.js's isSurfaceWater() answers
   "not water" over any deck (right for a road car), so a marine hull asks
   CBZ.cityNavWaterAt, which lets a registered channel through under a deck.
   CBZ.cityChannelAt below is that registration.

   CBZ.cityRiverAudit() flood fills from a real marina berth, through the
   BOAT's oracle, and reports whether it reaches open sea.

   DETERMINISM: pure geometry plus CBZ.hash01 for the wander. No Math.random.
   FLAGS: CBZ.CONFIG.CITY_RIVER (carve them), CITY_RIVER_BRIDGES (crossings).

   Exposes: CBZ.cityRiversCarve (continent.js calls it), CBZ.cityRiver (the
   harbour's river), CBZ.cityRivers, CBZ.cityRiverAudit, CBZ.cityChannelAt.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (C.CITY_RIVER == null) C.CITY_RIVER = true;
  if (C.CITY_RIVER_BRIDGES == null) C.CITY_RIVER_BRIDGES = true;

  /* THE WIDTH IS SET BY THE PLATE. continent.js builds the ground on a ~38 m
     grid; a channel narrower than about two cells renders as a notch that
     closes and re-opens along its length. So even a source is 48 m across,
     and every river widens to its mouth. */
  const MEANDER = 70;         // metres of lateral wander
  const WAVE = 950;           // metres per meander cycle
  const STEP = 120;           // polyline spacing

  let river = null;           // the harbour's river { pts, half[], bridges[], length, body, name }
  const outlets = [];         // every other carved river, same record shape
  let audit = { built: false, reason: "not run", length: 0, points: 0, bridges: 0, crossings: 0 };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function sm01(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
  function wobble(t, salt) {
    if (!CBZ.hash01) return 0;
    const g = t / WAVE, i0 = Math.floor(g), f = sm01(g - i0);
    const a = CBZ.hash01(i0 * WAVE, salt, 5501), b = CBZ.hash01((i0 + 1) * WAVE, salt, 5501);
    return (a + (b - a) * f) * 2 - 1;
  }
  // Catmull-Rom through the control points (open), sampled about every `step`
  function smoothOpen(ctrl, step) {
    const P = [ctrl[0]].concat(ctrl, [ctrl[ctrl.length - 1]]), out = [];
    for (let i = 1; i + 2 < P.length; i++) {
      const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
      const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          z: 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
        });
      }
    }
    const e = ctrl[ctrl.length - 1];
    out.push({ x: e[0], z: e[1] });
    return out;
  }

  /* ============================================================
     CBZ.cityRiversCarve(city) — CALLED BY city/continent.js, once its coast
     exists and before it folds inland water in. Returns the bodies to carve.
     It is a callback and not a landmass builder because the crossings have
     to see every road record (the highway network lays its own at order 91)
     and the bodies have to reach the continent's shore field before the
     plate is baked.
     ============================================================ */
  CBZ.cityRiversCarve = function (city) {
    river = null; outlets.length = 0;
    audit = { built: false, reason: "off", length: 0, points: 0, bridges: 0, crossings: 0 };
    if (C.CITY_RIVER === false) return [];
    const plan = CBZ.worldPlan;
    if (!plan || !plan.rivers || !plan.rivers.length) { audit.reason = "the world plan states no rivers"; return []; }
    const out = [];
    for (let i = 0; i < plan.rivers.length; i++) {
      try { const b = carveOne(city, plan.rivers[i], i); if (b) out.push(b); }
      catch (e) { console.error("[river] " + plan.rivers[i].name, e); }
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    return out;
  };

  function carveOne(city, def, index) {
    const HARB = !!def.harbour;
    const regs = city.regions || [], roads = city.roads || [];
    const BAY1 = 95;                       // continent.js's harbour ring, outer edge
    const RPAD = 160;
    let ROAD_G = null, ROAD_W = 0;
    function roadGrid() {
      if (ROAD_G && ROAD_G.n === roads.length) return ROAD_G;
      ROAD_W = 0;
      for (let i = 0; i < roads.length; i++) ROAD_W = Math.max(ROAD_W, (roads[i].w || 18) / 2);
      ROAD_G = CBZ.rectGrid ? CBZ.rectGrid(roads.length, function (i) {
        const r = roads[i], hl = (r.len || 0) / 2;
        return r.vertical ? [r.x, r.x, r.z - hl, r.z + hl] : [r.x - hl, r.x + hl, r.z, r.z];
      }, RPAD) : null;
      return ROAD_G;
    }
    function roadsCrossing(x, z, m) {
      const out = [];
      const G = roadGrid();
      const L = G && ROAD_W + m <= RPAD ? G.list(x, z) : null;
      const n = L ? L.length : roads.length;
      for (let j = 0; j < n; j++) {
        const r = roads[L ? L[j] : j];
        const hw = (r.w || 18) / 2 + m;
        const dx = r.vertical ? Math.abs(x - r.x) : Math.max(0, Math.abs(x - r.x) - r.len / 2);
        const dz = r.vertical ? Math.max(0, Math.abs(z - r.z) - r.len / 2) : Math.abs(z - r.z);
        if (dx <= hw && dz <= hw) out.push(r);
      }
      return out;
    }

    // ---- the course: the plan's line, smoothed, then walked at a fixed
    //      spacing with a wander that dies away at both ends (the source
    //      stays where it rises, the mouth stays pointed at its water)
    const line = smoothOpen(def.pts, 60);
    // run the mouth on past its last point: the sea (or the city's river) is
    // already water there and the shore field takes the minimum, so an
    // overshoot costs nothing while a shortfall leaves a dam of dry land
    {
      const a = line[line.length - 2], b = line[line.length - 1];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      line.push({ x: b.x + dx / L * 260, z: b.z + dz / L * 260 });
    }
    const cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z));
    const total = cum[cum.length - 1];
    if (!(total > 300)) return null;
    function atDist(d) {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const L = (cum[i] - cum[i - 1]) || 1, t = clamp((d - cum[i - 1]) / L, 0, 1), a = line[i - 1], b = line[i];
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx: -(b.z - a.z) / L, nz: (b.x - a.x) / L };
    }
    const h0 = Math.max(24, +def.half[0] || 26), h1 = Math.max(h0, +def.half[1] || 54);
    const pts = [], halves = [];
    const n = Math.max(3, Math.ceil(total / STEP));
    for (let k = 0; k <= n; k++) {
      const d = total * k / n, u = k / n, base = atDist(d);
      const taper = Math.sin(Math.PI * clamp(u * 1.2 - 0.08, 0, 1));
      const off = wobble(d, 17 + index * 13) * MEANDER * taper;
      pts.push({ x: base.x + base.nx * off, z: base.z + base.nz * off });
      // a stream at the source, widening all the way down, an estuary at the mouth
      halves.push(h0 + (h1 - h0) * (0.55 * u + 0.45 * sm01((u - 0.72) / 0.28)));
    }
    const bbox = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (let i = 0; i < pts.length; i++) {
      const h = halves[i] + 4;
      if (pts[i].x - h < bbox.minX) bbox.minX = pts[i].x - h;
      if (pts[i].x + h > bbox.maxX) bbox.maxX = pts[i].x + h;
      if (pts[i].z - h < bbox.minZ) bbox.minZ = pts[i].z - h;
      if (pts[i].z + h > bbox.maxZ) bbox.maxZ = pts[i].z + h;
    }
    const a0 = pts[0], a1 = pts[pts.length - 1];
    const body = { kind: "path", pts: pts, half: halves, bbox: bbox, name: def.name, river: def.id,
      axis: Math.abs(a1.x - a0.x) > Math.abs(a1.z - a0.z) ? "x" : "z" };
    if (CBZ.registerCityWaterBody) CBZ.registerCityWaterBody(city, body);

    /* ---- THE CROSSINGS, from the final polyline. Every road record within
       the channel gets a link region (which is both halves of a bridge: water
       carved under it, deck read as land above it) and a pier line so it
       reads as one from the water.                                        */
    const bridges = [];
    if (C.CITY_RIVER_BRIDGES !== false) {
      const claimed = new Set();
      // probed every ~40 m, not only at the polyline's own vertices: a country
      // road is narrower than the vertex spacing and must not slip between two
      const probe = [], probeH = [];
      for (let i = 0; i < pts.length; i++) {
        probe.push(pts[i]); probeH.push(halves[i]);
        if (i + 1 < pts.length) for (let k = 1; k < 3; k++) {
          probe.push({ x: pts[i].x + (pts[i + 1].x - pts[i].x) * k / 3, z: pts[i].z + (pts[i + 1].z - pts[i].z) * k / 3 });
          probeH.push(halves[i] + (halves[i + 1] - halves[i]) * k / 3);
        }
      }
      /* ONE BRIDGE PER ROAD, AND IT COVERS THE WHOLE CROSSING. A river rarely
         meets a road square-on: on a slant the channel runs beside the road
         for a while before it is under it. So every probe within reach of a
         road is gathered first, and the deck is laid over the full stretch
         of them (its middle is the middle of the crossing, its length the
         stretch plus the channel plus an abutment either side). It used to
         be centred on the FIRST probe to come within reach, which on a slant
         is one bank: the far half of the channel was left with a road record
         over open water and no deck. */
      const cross = new Map();
      for (let i = 0; i < probe.length; i++) {
        const h = probeH[i];
        for (const r of roadsCrossing(probe[i].x, probe[i].z, h + 14)) {
          /* NEVER BRIDGE THE HARBOUR ITSELF. A link region is land to
             everything that asks, so one laid across the bay ring severs the
             ring. Inside the ring band the road already crosses water and
             already has whatever deck it was built with; this file does not
             get to add another. */
          const cheb = Math.max(Math.max(city.minX - probe[i].x, probe[i].x - city.maxX),
                                Math.max(city.minZ - probe[i].z, probe[i].z - city.maxZ));
          if (cheb < BAY1 + 40) continue;
          const along = r.vertical ? probe[i].z : probe[i].x;
          let c = cross.get(r);
          if (!c) cross.set(r, c = { lo: along, hi: along, h: h });
          if (along < c.lo) c.lo = along; if (along > c.hi) c.hi = along; if (h > c.h) c.h = h;
        }
      }
      cross.forEach(function (c, r) {
        const k = (r.vertical ? "V" : "H") + Math.round(r.x) + "," + Math.round(r.z);
        if (claimed.has(k)) return;
        claimed.add(k);
        // never past the road's own ends: the deck is that road's deck
        const r0 = (r.vertical ? r.z : r.x) - r.len / 2, r1 = (r.vertical ? r.z : r.x) + r.len / 2;
        const lo = Math.max(r0, c.lo - c.h - 45), hi = Math.min(r1, c.hi + c.h + 45);
        if (!(hi - lo > 8)) return;
        const mid = (lo + hi) / 2, span = hi - lo, deckW = (r.w || 18) + 8;
        const b = { road: r, x: r.vertical ? r.x : mid, z: r.vertical ? mid : r.z, vertical: !!r.vertical, span: span, w: deckW };
        bridges.push(b);
        const reg = {
          // THE NAME IS LOAD-BEARING, twice over: continent.js's
          // isLinkReg() and waterfield.js's overDeck() both test
          // /bridge|causeway|link/ against it. Rename this and the deck
          // starts holding its land (no water under the bridge) AND stops
          // reading as land (cars swim on it).
          name: body.name + " Bridge " + (bridges.length),
          subtitle: "River Crossing", biome: "wilds", kind: "rect", pad: 0,
          minX: b.vertical ? b.x - deckW / 2 : b.x - span / 2,
          maxX: b.vertical ? b.x + deckW / 2 : b.x + span / 2,
          minZ: b.vertical ? b.z - span / 2 : b.z - deckW / 2,
          maxZ: b.vertical ? b.z + span / 2 : b.z + deckW / 2,
        };
        // through the shared registrar, not a raw push: it owns pad
        // defaults, the map-reserve ledger and the collider dirty flag.
        if (CBZ.registerCityRegion) CBZ.registerCityRegion(city, reg); else regs.push(reg);
        b.region = reg;
      });
    }

    const rec = { pts: pts, half: halves, bridges: bridges, length: Math.round(total), body: body, name: body.name, id: def.id };
    if (HARB && !river) river = rec; else outlets.push(rec);
    const fin = { built: true, reason: "", length: rec.length, points: pts.length, bridges: bridges.length, crossings: bridges.length,
      name: body.name, head: [Math.round(pts[0].x), Math.round(pts[0].z)] };
    if (HARB && river === rec) audit = fin; else rec.audit = fin;

    /* ---- AND THE THING YOU CAN SEE: piers and parapets at each crossing.
       Drawn LAST and drawn cheap — two merged meshes for the whole river —
       because the region above is what makes the bridge work and this is
       only what makes it read. A crossing with no visible structure is a
       road that appears to float over a river, which is the same "geometry
       with nothing holding it up" this repo keeps catching. */
    if (window.THREE && bridges.length && city.root) {
      const THREE = window.THREE;
      const BGU = THREE.BufferGeometryUtils;
      const cmat = CBZ.cmat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
      function boxAt(x, y, z, w, hh, d) {
        const g = new THREE.BoxGeometry(w, hh, d); g.translate(x, y, z); return g;
      }
      const piers = [], rails = [];
      for (const b of bridges) {
        const half = b.span / 2, along = b.vertical ? "z" : "x";
        // piers every ~26 m down the span, in pairs across the deck
        for (let t = -half + 13; t <= half - 13; t += 26) {
          for (const s of [-1, 1]) {
            const px2 = b.vertical ? b.x + s * (b.w / 2 - 1.4) : b.x + t;
            const pz2 = b.vertical ? b.z + t : b.z + s * (b.w / 2 - 1.4);
            piers.push(boxAt(px2, -1.2, pz2, 1.6, 3.0, 1.6));
          }
        }
        // a parapet down each edge of the deck
        for (const s of [-1, 1]) {
          const rx = b.vertical ? b.x + s * (b.w / 2) : b.x;
          const rz = b.vertical ? b.z : b.z + s * (b.w / 2);
          rails.push(boxAt(rx, 0.55, rz, b.vertical ? 0.4 : b.span, 0.9, b.vertical ? b.span : 0.4));
          if (CBZ.colliders) {
            CBZ.colliders.push({
              minX: rx - (b.vertical ? 0.25 : b.span / 2), maxX: rx + (b.vertical ? 0.25 : b.span / 2),
              minZ: rz - (b.vertical ? b.span / 2 : 0.25), maxZ: rz + (b.vertical ? b.span / 2 : 0.25),
              y0: 0, y1: 1.0, noCam: true,
            });
          }
        }
      }
      function merge(list, hex, cast) {
        if (!list.length) return;
        const mat = cmat(hex);
        if (BGU && BGU.mergeBufferGeometries) {
          const mesh = new THREE.Mesh(BGU.mergeBufferGeometries(list), mat);
          mesh.castShadow = !!cast; mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false; mesh.updateMatrix();
          city.root.add(mesh);
          return;
        }
        for (const g of list) { const mm = new THREE.Mesh(g, mat); mm.receiveShadow = true; city.root.add(mm); }
      }
      merge(piers, 0x8b9097, true);
      merge(rails, 0xb4b9bf, false);
    }
    /* ---- AND A REASON TO BE ON IT. Kilometres of navigable water with
       nothing on the banks is "geometry with nobody in it". Three bank
       stations, on alternating sides, at quarter/half/three-quarter of the
       run: city/fishing.js validates each one against the water point it is
       given and REFUSES a station whose water is not water, so a bank that a
       future coastline moves out from under loses its angler rather than
       lying about him. No new loop, no new body — fishSpotRegister is the
       same call the marina quay and the fuel dock already use. */
    if (CBZ.fishSpotRegister && pts.length > 8) {
      const NAMES = ["Upper Reach", "The Oxbow", "River Mouth"];
      [0.25, 0.55, 0.85].forEach(function (u, k) {
        const i = Math.max(1, Math.min(pts.length - 2, Math.round(u * (pts.length - 1))));
        const a = pts[i - 1], b = pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
        const nx = -dz / L, nz = dx / L;              // bank normal
        const side = k % 2 ? 1 : -1;                  // alternate banks
        const h = halves[i];
        const bx = pts[i].x + nx * side * (h + 2.5), bz = pts[i].z + nz * side * (h + 2.5);
        try {
          CBZ.fishSpotRegister(bx, bz, {
            name: body.name.replace(/^The /, "") + " · " + NAMES[k],
            // face the water, which is back down the bank normal
            face: Math.atan2(-nx * side, -nz * side),
            water: { x: pts[i].x, z: pts[i].z },
          });
        } catch (e) {}
      });
    }

    return body;
  }

  /* ============================================================
     THE RATCHET — CBZ.cityRiverAudit()
     ------------------------------------------------------------
     `connected` is the entire feature expressed as a boolean, and it is
     MEASURED on every call, never stored: a flood fill over the LIVE
     CBZ.cityWaterAt from a real registered berth, out until it either
     reaches open sea or runs dry. A river that registers, draws bridges and
     reports a length while the marina is still a pond would pass every other
     number in this file and fail this one.

     The step is 30 m against a channel that is at minimum 80 m across, so
     the fill cannot hop a bank; the cap is what stops a genuinely connected
     river from walking the whole 54,000 u ocean before answering.
     ============================================================ */
  CBZ.cityRiverAudit = function () {
    const out = Object.assign({ connected: false, reach: 0, cells: 0 }, audit);
    const berths = (CBZ.cityBerth && CBZ.cityBerth.list) ? CBZ.cityBerth.list() : [];
    /* THE BOAT'S OWN ORACLE, not the car's. The question this audit exists to
       answer is "can a HULL get from the marina to the sea", and under a
       bridge those two oracles deliberately disagree — cityWaterAt keeps the
       deck dry so cars do not flood, cityNavWaterAt lets the channel through.
       Asking the wrong one here reported the river disconnected while boats
       could in fact run it. */
    const wetAt = CBZ.cityNavWaterAt || CBZ.cityWaterAt;
    if (!berths.length || !wetAt) { out.reason = out.reason || "no berths to test from"; return out; }
    const start = berths[0];
    const STEP2 = 30, CAP = 30000;
    // OPEN SEA = far enough from the city that nothing else could be. The bay
    // ring is 95 u out; a mainland lake would be a lake. 3 km is past every
    // registered POI's own footprint and short enough to answer fast.
    const A = CBZ.city && CBZ.city.arena;
    const cx = A ? (A.minX + A.maxX) / 2 : 0, cz = A ? (A.minZ + A.maxZ) / 2 : 0;
    const OPEN = 3000;
    const seen = new Set(), q = [[Math.round(start.x), Math.round(start.z)]];
    seen.add(q[0][0] + "," + q[0][1]);
    let head = 0, reach = 0;
    while (head < q.length && q.length < CAP) {
      const p = q[head++];
      const d = Math.hypot(p[0] - cx, p[1] - cz);
      if (d > reach) reach = d;
      if (d > OPEN) { out.connected = true; break; }
      const dirs = [[STEP2, 0], [-STEP2, 0], [0, STEP2], [0, -STEP2]];
      for (let i = 0; i < 4; i++) {
        const nx = p[0] + dirs[i][0], nz = p[1] + dirs[i][1], k = nx + "," + nz;
        if (seen.has(k)) continue;
        let ok = false;
        try { ok = !!wetAt(nx, nz); } catch (e) {}
        if (!ok) continue;
        seen.add(k); q.push([nx, nz]);
      }
    }
    out.cells = seen.size;
    out.reach = Math.round(reach);

    /* ---- THE ONE THING A BOAT CAN DO HERE THAT A SWIMMER CANNOT, in
       metres, measured live rather than described. Under a road deck this
       engine answers "not water" to cityWaterAt (so a car on the causeway
       does not flood) while cityNavWaterAt lets the hull through — so on the
       shipping seed there is one 31 m stretch, the width of the road itself,
       where you can drive a boat but not swim.

       IT IS NOT PAPERED OVER, and deliberately. The honest fix is a y-gated
       water test, and the y's are not there to gate on: at that crossing the
       deck sits at grade (0.085) and the sea surface at -0.31, so "standing
       on the bridge" and "swimming under it" are 0.4 m apart — closer than
       the swell moves. A gate that tight is a guess wearing a fix's clothes,
       and the failure mode is a pedestrian on a bridge who starts swimming.
       So it is REPORTED: 31 m of 8675 is a known limit of a y-less water
       oracle, and the number is here for whoever gets to fix that properly. */
    if (river && CBZ.cityWaterAt && CBZ.cityNavWaterAt) {
      let blocked = 0;
      const p = river.pts;
      for (let i = 0; i + 1 < p.length; i++) {
        const L = Math.hypot(p[i + 1].x - p[i].x, p[i + 1].z - p[i].z);
        const n = Math.max(1, Math.ceil(L / 8));
        for (let k = 0; k < n; k++) {
          const t = k / n, x = p[i].x + (p[i + 1].x - p[i].x) * t, z = p[i].z + (p[i + 1].z - p[i].z) * t;
          if (!CBZ.cityWaterAt(x, z) && CBZ.cityNavWaterAt(x, z)) blocked += L / n;
        }
      }
      out.swimBlocked = Math.round(blocked);
    }
    if (!out.connected && !out.reason) out.reason = "flood fill from berth '" + start.id + "' stopped at " + out.reach + " m";
    return out;
  };

  /* ---- CBZ.cityChannelAt(x, z) — "is this point inside the river?"
     THE ONE THING waterfield.js ASKS THIS FILE, and the reason it has to.
     isSurfaceWater() answers "not water" over any bridge or causeway deck,
     because with no y in the question a deck is the best proxy it has for
     "whoever is asking is probably standing on it". That proxy is wrong in
     exactly one place: under a bridge, where the whole point of the bridge
     is that water passes beneath it. With 31 highway link regions across
     this country there is no route from the harbour to any coast that does
     not cross one, so without this the river cannot exist — the router said
     so in as many words before decks were re-priced from walls to tolls.

     Deliberately NARROW: it is true only inside this river's own channel, so
     every other deck in the world keeps the old behaviour exactly. */
  function inChannel(rv, x, z) {
    const p = rv.pts, h = rv.half;
    const bb = rv.body && rv.body.bbox;
    if (bb && (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ)) return false;
    for (let i = 0; i + 1 < p.length; i++) {
      const ax = p[i].x, az = p[i].z, vx = p[i + 1].x - ax, vz = p[i + 1].z - az;
      const L2 = vx * vx + vz * vz;
      let t = L2 > 0 ? ((x - ax) * vx + (z - az) * vz) / L2 : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const dx = x - (ax + vx * t), dz = z - (az + vz * t);
      const half = h[i] + (h[i + 1] - h[i]) * t;
      if (dx * dx + dz * dz <= half * half) return true;
    }
    return false;
  }
  CBZ.cityChannelAt = function (x, z) {
    if (river && inChannel(river, x, z)) return true;
    for (let i = 0; i < outlets.length; i++) if (inChannel(outlets[i], x, z)) return true;
    return false;
  };

  CBZ.cityRiver = {
    exists: function () { return !!river; },
    path: function () { return river ? river.pts.slice() : []; },
    name: function () { return river ? river.name : null; },
    bridges: function () { return river ? river.bridges.slice() : []; },
    info: function () { return river; },
  };
  // every carved river (the harbour's first, then the rest)
  CBZ.cityRivers = function () { return (river ? [river] : []).concat(outlets); };
})();
