/* tools/lib/layout-dump.js — PAGE SIDE of tools/layout-audit.mjs.

   Evaluated inside a booted Gang City (index.html?mode=city) after
   CBZ.startRun(). Returns one JSON string: every building footprint, every
   road segment and every land-use record the world was built from, each
   tagged with the GENERATOR that produced it. Reads plan DATA (lots, metro
   plans, road records, the highway table, regions), never meshes, so a
   streamed or HLOD'd tile is counted exactly like a built one.

   Keep it a single expression: the tool reads this file and evaluates it. */
(function () {
  var A = CBZ.city && CBZ.city.arena;
  if (!A) return JSON.stringify({ error: "no arena" });
  var R1 = function (v) { return Math.round(v * 10) / 10; };
  var out = { city: { minX: A.minX, maxX: A.maxX, minZ: A.minZ, maxZ: A.maxZ }, seed: CBZ.WORLD_SEED, bldgs: [], roads: [], regions: [], water: [], parks: [], hw: [], ix: [], metros: [], settlements: [], other: [] };

  // ---- buildings: [x, z, w, d, rot, h, storeys, type, gen, place, use]
  function B(x, z, w, d, rot, h, st, type, gen, place, use) {
    out.bldgs.push([R1(x), R1(z), R1(w), R1(d), Math.round((rot || 0) * 100) / 100, R1(h || 0), st || 0, type || "", gen, place || "", use || ""]);
  }
  (A.lots || []).forEach(function (l) {
    var b = l.building; if (!b) return;
    var gen = l.town ? "towngen" : (l.grid ? "downtown" : "lots");
    var use = l.grid ? "downtown" : (l.zone || l.kind || "");
    B(b.ox != null ? b.ox : l.cx, b.oz != null ? b.oz : l.cz, b.w || l.w, b.d || l.d, 0, b.h, b.storeys, l.kind, gen, l.town || l.district, use);
  });
  if (A.annex && A.annex.lots) A.annex.lots.forEach(function (l) {
    var b = l.building || {};
    B(b.ox != null ? b.ox : l.cx, b.oz != null ? b.oz : l.cz, b.w || l.w, b.d || l.d, 0, b.h, b.storeys, l.kind, "annex", "Commerce Annex", "commercial");
  });
  (CBZ.metroCities || []).forEach(function (c) {
    var P = c.plan; if (!P) return;
    var dk = {}; (P.districts || []).forEach(function (d) { dk[d.id] = d.kind; });
    (P.bldgs || []).forEach(function (b) {
      B(b.x, b.z, b.w, b.d, b.rot, b.h, b.st, b.type, "metro", c.id, dk[b.dist] || "");
    });
    (P.streets || []).forEach(function (s) {
      var p = s.pts || []; for (var i = 0; i + 1 < p.length; i++)
        out.roads.push([R1(p[i].x), R1(p[i].z), R1(p[i + 1].x), R1(p[i + 1].z), s.w, s.k, "metro", c.id, s.elevated ? 1 : 0]);
    });
    (P.parks || []).forEach(function (p) { out.parks.push([R1(p.x0), R1(p.z0), R1(p.x1), R1(p.z1), p.kind, c.id]); });
    (P.plazas || []).forEach(function (p) { out.parks.push([R1(p.x0), R1(p.z0), R1(p.x1), R1(p.z1), "plaza", c.id]); });
    (P.fields || []).forEach(function (p) { out.parks.push([R1(p.x0), R1(p.z0), R1(p.x1), R1(p.z1), "field", c.id]); });
    var cells = (P.cells || []).map(function (q) { return [R1(q.x0), R1(q.z0), R1(q.x1), R1(q.z1), q.use, Math.round((q.L || 0) * 1000) / 1000]; });
    out.metros.push({ id: c.id, name: c.name, tier: c.tier, bounds: P.bounds, cx: P.cx, cz: P.cz, cells: cells, cores: P.cores || [],
      interchanges: (P.interchanges || []).map(function (q) { return [R1(q.x), R1(q.z), q.fwName]; }),
      districts: (P.districts || []).map(function (d) { return [d.name, d.kind, R1(d.cx), R1(d.cz), d.cells]; }) });
  });

  // the countryside (city/countryside.js, streamed by metro.js): farms,
  // roadside houses, diners; its gas stops are forecourts
  var CS = CBZ.metroCountryside && CBZ.metroCountryside.plan;
  if (CS) (CS.bldgs || []).forEach(function (b) {
    B(b.x, b.z, b.w, b.d, b.rot, b.h, b.st, b.type, "countryside", "countryside", b.farm || b.type === "barn" || b.type === "silo" ? "rural" : b.diner ? "commercial" : "exurb");
  });
  if (CS) (CS.forecourts || []).forEach(function (f) { B(f.x, f.z, 24, 26, f.rotY, 5, 1, "gas", "countryside", "countryside", "commercial"); });
  // ---- roads (non-metro records): [x0, z0, x1, z1, w, class, gen, place, elevated]
  function cls(r) {
    if (r.district === "highway") return r.frontier ? "frontier" : "highway";
    if (r.grid) return r.avenue ? "arterial" : "local";
    if (r.district === "arterial" || r.district === "causeway" || r.district === "bridge" || r.route) return "arterial";
    if (r.rural) return "rural";
    return "local";
  }
  function gen(r) {
    if (r.metro) return null;                       // metro streets come from the plan
    if (r.district === "highway") return "highway";
    if (r.grid) return "downtown";
    if (r.district === "island") return "annex";
    if (r._govOwner) return "estate";
    if (r.district === "arterial" || r.district === "causeway" || r.district === "bridge" || r.route) return "connector";
    return "towngen";
  }
  (A.roads || []).forEach(function (r) {
    var g = gen(r); if (!g) return;
    var h = r.len / 2, w = r.w || r.width || 8;
    if (r.vertical) out.roads.push([R1(r.x), R1(r.z - h), R1(r.x), R1(r.z + h), w, cls(r), g, r.district || "", r.elevated ? 1 : 0]);
    else out.roads.push([R1(r.x - h), R1(r.z), R1(r.x + h), R1(r.z), w, cls(r), g, r.district || "", r.elevated ? 1 : 0]);
  });
  if (A.annex && A.annex.roads) A.annex.roads.forEach(function (r) {
    if (!r || r.len == null) return; var h = r.len / 2;
    if (r.vertical) out.roads.push([R1(r.x), R1(r.z - h), R1(r.x), R1(r.z + h), r.w || 10, "local", "annex", "annex", 0]);
    else out.roads.push([R1(r.x - h), R1(r.z), R1(r.x + h), R1(r.z), r.w || 10, "local", "annex", "annex", 0]);
  });
  (CBZ.highwayNetTable ? CBZ.highwayNetTable() : []).forEach(function (h) {
    // the deck's own centreline: the corners filleted exactly as highways.js draws them
    var sp = CBZ.highwaySmoothPath ? CBZ.highwaySmoothPath(h.pts, h.fillet || 60, 9) : h.pts;
    out.hw.push({ id: h.id, name: h.name, width: h.width, rural: !!h.rural, pts: sp.map(function (p) { return [R1(p.x), R1(p.z)]; }) });
  });
  (CBZ.cityInterchanges ? CBZ.cityInterchanges() : []).forEach(function (G) { out.ix.push([R1(G.X0), R1(G.Z0), G.thrId, G.stemId, "flyover"]); });

  // ---- regions + water
  (A.regions || []).forEach(function (r) {
    if (r.kind && r.kind !== "rect" && r.minX == null) return;
    out.regions.push([r.name || "", r.biome || "", R1(r.minX), R1(r.maxX), R1(r.minZ), R1(r.maxZ), r.owner || "", r.terrainGrade ? 1 : 0]);
  });
  // water: the share of 5 samples per 100 m cell that are surface water
  // (CBZ.cityWaterAt — the oracle cars and swimmers use), over the built span
  var G = { x0: -5400, z0: -4800, cell: 100, nx: 140, nz: 100 };
  out.waterGrid = G; out.water = [];
  if (CBZ.cityWaterAt) for (var j = 0; j < G.nz; j++) {
    var row = "";
    for (var i = 0; i < G.nx; i++) {
      var x = G.x0 + (i + 0.5) * G.cell, z = G.z0 + (j + 0.5) * G.cell, n = 0;
      if (CBZ.cityWaterAt(x, z)) n++;
      if (CBZ.cityWaterAt(x - 30, z - 30)) n++; if (CBZ.cityWaterAt(x + 30, z - 30)) n++;
      if (CBZ.cityWaterAt(x - 30, z + 30)) n++; if (CBZ.cityWaterAt(x + 30, z + 30)) n++;
      row += n;
    }
    out.water.push(row);
  }
  (CBZ.settlements || []).forEach(function (s) { out.settlements.push([s.name, R1(s.cx), R1(s.cz), s.biome, s.lots.length, s.rect ? [R1(s.rect.minX), R1(s.rect.maxX), R1(s.rect.minZ), R1(s.rect.maxZ)] : null]); });

  // ---- everything else that stands up (estates, airports, bases, arenas):
  //      tall solid colliders, reduced to a 25 m presence grid so walls of one
  //      building collapse to its footprint cells.
  var seen = {};
  (CBZ.colliders || []).forEach(function (c) {
    if (c.minX == null || c.y1 == null) return;
    if ((c.y1 - (c.y0 || 0)) < 2.4) return;
    // a wall or a solid, not a tree trunk (1-2 m square) or a parked vehicle
    if (Math.max(c.maxX - c.minX, c.maxZ - c.minZ) < 3) return;
    var nm = (c.ref && c.ref.name) || "";
    if (/tree|backcountry|milair|^mbt|^ifv|^apc|^luv|truck|patriot|mlrs/.test(nm)) return;
    var cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    var k = Math.floor(cx / 25) + "," + Math.floor(cz / 25);
    var top = c.y1;
    if (!seen[k] || seen[k] < top) seen[k] = top;
  });
  for (var k in seen) { var p = k.split(","); out.other.push([+p[0] * 25 + 12.5, +p[1] * 25 + 12.5, R1(seen[k])]); }

  return JSON.stringify(out);
})()
