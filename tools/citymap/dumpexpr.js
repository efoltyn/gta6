/* Evaluated in the page by tools/citymap/dump.mjs once Gang City is playing.
   Returns ONE JSON string: everything the map and its problems layer need,
   read off what the game built. Where the answer needs one of the game's own
   oracles (is this point water, which biome is here) it is asked here, in the
   page; everything else is plain records the renderer measures itself, so
   the problems layer never grades a system by that system's own declaration. */
(() => {
  const A = CBZ.city.arena, ws = A.worldScale, B = ws.terrainBounds;
  const r1 = (v) => Math.round(v * 10) / 10;
  const o = { bounds: B, playable: ws.playableBounds, authored: ws.authoredBounds, seed: CBZ.WORLD_SEED,
    streamed: !!(CBZ.slicePlanResult && CBZ.slicePlanResult.skipped && CBZ.slicePlanResult.skipped.length),
    skipped: (CBZ.slicePlanResult && CBZ.slicePlanResult.skipped) || [] };
  o.city = { minX: A.minX, maxX: A.maxX, minZ: A.minZ, maxZ: A.maxZ };
  o.annex = A.annex ? { cx: A.annex.cx, cz: A.annex.cz, r: A.annex.radius } : null;
  try {
    const P = CBZ.player || {}, cand = [P.pos, P.group && P.group.position, P.mesh && P.mesh.position, P.position, P];
    const p = cand.find(q => q && Number.isFinite(q.x) && Number.isFinite(q.z));
    o.spawn = p ? { x: r1(p.x), y: r1(p.y || 0), z: r1(p.z) } : null;
  } catch (e) { o.spawn = null; }
  // 0 dry land, 1 open water, 2 water with a deck over it (a bridge, a causeway):
  // the shore field is the water itself, cityWaterAt is what a road car meets
  const shoreRaw = A.mapTerrain && A.mapTerrain.shoreAt;
  const wet = (x, z) => {
    try {
      if (CBZ.cityWaterAt(x, z)) return 1;
      return shoreRaw && shoreRaw(x, z) < 0 ? 2 : 0;
    } catch (e) { return 0; }
  };

  o.spawnWet = o.spawn ? wet(o.spawn.x, o.spawn.z) : null;

  // ---- regions (every flag the renderer sorts them by)
  o.regions = A.regions.map(r => ({ n: r.name, b: r.biome, k: r.kind, cx: r.cx, cz: r.cz, r: r.r, x0: r.minX, x1: r.maxX, z0: r.minZ, z1: r.maxZ,
    road: r.road ? 1 : 0, metro: r.metro ? 1 : 0, under: r.underlay ? 1 : 0, lab: r.mapLabel === false ? 0 : 1, sub: r.subtitle || null, grade: r.terrainGrade ? 1 : 0 }));

  // ---- road records (what traffic and the road graph use)
  const rd = (r) => ({ x: r1(r.x), z: r1(r.z), v: r.vertical ? 1 : 0, len: r1(+r.len || 0), w: r.w || r.width || 8,
    d: r.district || null, rt: r.route || null, rural: r.rural ? 1 : 0, el: r.elevated ? 1 : 0, nt: r.noTraffic ? 1 : 0, metro: r.metro ? 1 : 0, n: r.name || null });
  o.roads = A.roads.map(rd);
  // wet samples along every record (a deck reads dry: cityWaterAt answers for a road car)
  o.roadWet = [];
  for (let i = 0; i < A.roads.length; i++) {
    const r = A.roads[i], L = +r.len || 0, n = Math.max(1, Math.ceil(L / 25));
    for (let k = 0; k <= n; k++) {
      const t = -L / 2 + L * k / n, x = r.vertical ? r.x : r.x + t, z = r.vertical ? r.z + t : r.z;
      const wc = wet(x, z);
      if (wc) o.roadWet.push([Math.round(x), Math.round(z), i, wc]);
    }
  }

  // ---- highways as built decks, and the network table as its smooth centrelines
  const hw = (CBZ.cityHighways ? CBZ.cityHighways() : []) || [];
  o.highways = hw.map(h => {
    const pts = [], L = h.length || 0;
    try { for (let d = 0; d <= L; d += 20) { const q = h.at(d); if (q) pts.push([Math.round(q.x), Math.round(q.z)]); } const e = h.at(L); if (e) pts.push([Math.round(e.x), Math.round(e.z)]); } catch (e) {}
    const s = h.spec || {};
    return { n: s.name || s.route || s.id || "", rt: s.route || null, w: h.width, L: Math.round(L), pts, rural: (h.width || 0) < 20 ? 1 : 0, lanes: s.lanesPerDir || null, theme: s.theme || null, wet: pts.map(q => [q[0], q[1], wet(q[0], q[1])]).filter(q => q[2]) };
  });
  const net = (CBZ.cityHighwayNet ? CBZ.cityHighwayNet() : []) || [];
  o.net = net.map(h => {
    let sp = h.pts || [];
    try { if (CBZ.highwaySmoothPath) sp = CBZ.highwaySmoothPath(h.pts, h.fillet, 9); } catch (e) {}
    return { id: h.id, n: h.name, w: h.width, rural: h.rural ? 1 : 0, raw: (h.pts || []).map(q => [Math.round(q.x), Math.round(q.z)]), pts: sp.map(q => [Math.round(q.x), Math.round(q.z)]) };
  });

  o.water = A.waterBodies;

  // ---- terrain, water and biome on one grid
  const STEP = 40, nx = Math.ceil((B.maxX - B.minX) / STEP), nz = Math.ceil((B.maxZ - B.minZ) / STEP);
  const H = new Array(nx * nz), W = new Array(nx * nz), Bi = new Array(nx * nz);
  const biomes = [], bix = {};
  const inl = A.mapTerrain && A.mapTerrain.inlandWaterAt;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = B.minX + (i + 0.5) * STEP, z = B.minZ + (j + 0.5) * STEP, k = j * nx + i;
    let h = 0; try { h = A.groundHeightAt(x, z); } catch (e) {}
    H[k] = Math.round(h * 10) / 10;
    // 0 land, 1 sea, 2 inland water (lake, river); decks do not hide the water under them
    let w = wet(x, z) ? 1 : 0; if (w && inl) { try { if (inl(x, z)) w = 2; } catch (e) {} }
    W[k] = w;
    let b = "city"; try { b = CBZ.cityBiomeAt(x, z) || "city"; } catch (e) {}
    if (bix[b] == null) { bix[b] = biomes.length; biomes.push(b); }
    Bi[k] = bix[b];
  }
  o.grid = { step: STEP, nx, nz, H, W, B: Bi, biomes, sea: CBZ.waterSeaY ? CBZ.waterSeaY() : 0 };

  // ---- every planned building in the world. A metro plans its whole city at
  //      boot and builds meshes only near the camera; the plan is the city.
  const types = [], tix = {};
  const tcode = (t) => { t = t || "?"; if (tix[t] == null) { tix[t] = types.length; types.push(t); } return tix[t]; };
  function corners(b) {
    const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0), hw2 = (b.w || 0) / 2, hd = (b.d || 0) / 2, out = [[b.x, b.z]];
    for (const q of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const lx = q[0] * hw2, lz = q[1] * hd; out.push([b.x + lx * c + lz * s, b.z - lx * s + lz * c]); }
    return out;
  }
  o.metros = [];
  const cities = (CBZ.metroCities || []).slice();
  if (CBZ.metroCountryside) cities.push(CBZ.metroCountryside);
  for (const M of cities) {
    const P = M.plan; if (!P) continue;
    const rec = { id: M.id, n: M.name, tier: M.tier, country: M.country ? 1 : 0, bounds: P.bounds || null, b: [], st: [], pk: [], river: null };
    for (const b of P.bldgs || []) {
      if (!Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
      let w = 0; for (const q of corners(b)) { const wc = wet(q[0], q[1]); if (wc) { w = wc; break; } }
      rec.b.push([r1(b.x), r1(b.z), r1(b.w || 0), r1(b.d || 0), Math.round((b.rot || 0) * 1000) / 1000, Math.round(b.h || 0), tcode(b.kind === "mainstreet" ? "mainstreet" : b.type), w]);
    }
    for (const s of P.streets || []) {
      if (!s.pts || s.pts.length < 2) continue;
      const pts = s.pts.map(q => [Math.round(q.x), Math.round(q.z)]);
      let w = 0;
      for (let i = 0; i + 1 < s.pts.length && !w; i++) {
        const a = s.pts[i], c = s.pts[i + 1], L = Math.hypot(c.x - a.x, c.z - a.z), n = Math.max(1, Math.ceil(L / 25));
        for (let k = 0; k <= n; k++) if (wet(a.x + (c.x - a.x) * k / n, a.z + (c.z - a.z) * k / n) === 1) { w = 1; break; }
      }
      rec.st.push({ k: s.k || "", w: s.w || 8, p: pts, wet: w, el: s.elevated || s.bridge ? 1 : 0 });
    }
    for (const k of P.parks || []) rec.pk.push([Math.round(k.x0), Math.round(k.z0), Math.round(k.x1), Math.round(k.z1), k.kind || ""]);
    if (P.river && P.river.pts) rec.river = { half: P.river.half, p: P.river.pts.map(q => [Math.round(q.x), Math.round(q.z)]) };
    o.metros.push(rec);
  }
  o.types = types;

  // ---- what is actually standing: tall solid colliders (towns, compounds, the downtown)
  const C = CBZ.colliders || [], F = [];
  for (let i = 0; i < C.length; i++) {
    const c = C[i]; if (!c) continue;
    const w = c.maxX - c.minX, d = c.maxZ - c.minZ, h = (c.y1 != null && c.y0 != null) ? c.y1 - c.y0 : 9;
    if (Math.max(w, d) > 3.5 && Math.min(w, d) > 0.2 && h > 2.6 && w < 400 && d < 400) {
      const mx = (c.minX + c.maxX) / 2, mz = (c.minZ + c.maxZ) / 2;
      const wt = (wet(mx, mz) || wet(c.minX, c.minZ) || wet(c.maxX, c.maxZ) || wet(c.minX, c.maxZ) || wet(c.maxX, c.minZ)) ? 1 : 0;
      // a wet one says what it is (its mesh's name, or the nearest named parent, or who built it)
      let tag = "";
      if (wt) {
        try {
          let q = c.ref || null, hops = 0;
          while (q && hops++ < 6) { if (q.name) { tag = q.name; break; } if (q.userData && q.userData._builder) { tag = q.userData._builder; break; } q = q.parent; }
          if (!tag) tag = c.kind || c.tag || c.type || "";
        } catch (e) {}
      }
      F.push([r1(c.minX), r1(c.minZ), r1(c.maxX), r1(c.maxZ), Math.round(h), wt, (c.y0 != null && c.y0 > 3) ? 1 : 0, tag]);
    }
  }
  o.nColliders = C.length; o.foot = F;
  // the marina stands in the water on purpose (its desk, its fuel dock and
  // its pontoons): its berths say where it is, so the map does not flag it
  try {
    const bl = CBZ.cityMarina && CBZ.cityMarina.berths ? CBZ.cityMarina.berths() : [];
    if (bl && bl.length) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const b of bl) { if (b.x < x0) x0 = b.x; if (b.x > x1) x1 = b.x; if (b.z < z0) z0 = b.z; if (b.z > z1) z1 = b.z; }
      o.marina = { x0: x0 - 45, x1: x1 + 45, z0: z0 - 45, z1: z1 + 45, berths: bl.length };
    }
  } catch (e) {}
  o.lots = (A.lots || []).map(l => ({ x: r1(l.cx), z: r1(l.cz), w: l.w, d: l.d, k: l.kind || (l.building && l.building.kind) || null,
    dist: l.district && l.district.name, wet: (wet(l.cx, l.cz) || wet(l.cx - l.w / 2, l.cz - l.d / 2) || wet(l.cx + l.w / 2, l.cz + l.d / 2)) ? 1 : 0 }));
  // ---- the VENUES: every mounted game package (its group's position is its
  //      origin), every shop lot with a kind, the motel, and the law's desk.
  //      tools/citymap/zoom.py letters them; the map checks they stand on land
  //      by a street, not on a beach and not inside another building.
  o.venues = [];
  try {
    const V3 = new THREE.Vector3();
    CBZ.scene.traverse(function (q) {
      if (!q.userData || !q.userData.gamePkg || !q.parent) return;
      for (let p = q.parent; p; p = p.parent) if (p.userData && p.userData.gamePkg) return;      // a venue's own child
      q.getWorldPosition(V3);
      o.venues.push({ id: "pkg:" + q.userData.gamePkg, x: r1(V3.x), z: r1(V3.z), wet: wet(V3.x, V3.z) });
    });
  } catch (e) {}
  try {
    for (const l of (A.shopLots || [])) {
      if (!l || !l.kind) continue;
      const d = l.building && l.building.door;
      o.venues.push({ id: "shop:" + l.kind, n: (l.building && (l.building.name || l.building.label)) || null, x: r1(l.cx), z: r1(l.cz), w: l.w, d: l.d,
        door: d ? [r1(d.x), r1(d.z)] : null, wet: wet(l.cx, l.cz) });
    }
  } catch (e) {}
  try { const m = CBZ.cityFindMotelLot && CBZ.cityFindMotelLot(); if (m) o.venues.push({ id: "motel", x: r1(m.cx), z: r1(m.cz), w: m.w, d: m.d, wet: wet(m.cx, m.cz) }); } catch (e) {}
  try { const s = CBZ.cityPoliceStation && CBZ.cityPoliceStation(); if (s) o.venues.push({ id: "policeStation", x: r1(s.x), z: r1(s.z), wet: wet(s.x, s.z) }); } catch (e) {}
  try { const j = CBZ.cityJailAnchors && CBZ.cityJailAnchors(); if (j && j.weak) o.venues.push({ id: "jailWeakGate", x: r1(j.weak.x), z: r1(j.weak.z), wet: wet(j.weak.x, j.weak.z) }); } catch (e) {}
  try { if (A.spawn) o.venues.push({ id: "arenaSpawn", x: r1(A.spawn.x), z: r1(A.spawn.z), wet: wet(A.spawn.x, A.spawn.z) }); } catch (e) {}
  try { const fc = CBZ.fuelForecourts || []; for (const f of fc) if (f && Number.isFinite(f.cx)) o.venues.push({ id: "fuel", x: r1(f.cx), z: r1(f.cz), wet: wet(f.cx, f.cz) }); } catch (e) {}
  // the geography the plan states, when there is one (the map draws the built
  // world; this is only so a label can name a cape or a bay)
  try { o.plan = CBZ.worldPlan && CBZ.worldPlan.mapData ? CBZ.worldPlan.mapData() : null; } catch (e) { o.plan = null; }
  return JSON.stringify(o);
})()
