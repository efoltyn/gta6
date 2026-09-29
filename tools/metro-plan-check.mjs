#!/usr/bin/env node
/* tools/metro-plan-check.mjs — THE CITY PLAN, CHECKED IN PLAIN NODE.

   Runs the exact placement code the game runs (src/city/metro.js's site
   table, constraints, regions and road records, src/city/metroplan.js's
   planner) against tools/metro-world-snapshot.json — the region/road layout
   of a live world (seed 90210), dumped once with
     node tools/speed.mjs --ask eval '...'   (see the snapshot's header note)
   and prints, per city: footprint, buildings by type, the storey
   distribution, the mean height by distance band (it must FALL with
   distance), street km by class, districts, landmarks, population.

   FAILS (exit 1) when a plan breaks one of its laws:
     • a building on a street, a bulb, the river, a freeway or a compound
     • two buildings overlapping
     • a street not connected to the arterial network
     • a city region overlapping another city region, a compound or a road
       corridor it would clamp
     • height not falling from the core band to the suburb band
   Zero browser, ~1 s. Usage: node tools/metro-plan-check.mjs [--seed N] [--json]
*/
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const seedArg = argv.indexOf("--seed") >= 0 ? +argv[argv.indexOf("--seed") + 1] : 90210;
const snap = JSON.parse(readFileSync(path.join(ROOT, "tools/metro-world-snapshot.json"), "utf8"));

globalThis.window = { CBZ: { CONFIG: {}, WORLD_SEED: seedArg, highwayNetTable: () => snap.hw, HIGHWAY_NET_HALF: snap.H } };
require(path.join(ROOT, "src/city/metroplan.js"));
require(path.join(ROOT, "src/city/metro.js"));
const CBZ = globalThis.window.CBZ;
const L = CBZ.metroLib;

const city = {
  regions: snap.regions.map((r) => Object.assign({ kind: "rect" }, r)),
  roads: snap.roads.map((r) => ({ x: r[0], z: r[1], vertical: !!r[2], len: r[3], w: r[4], district: r[5] })),
  minX: snap.city.minX, maxX: snap.city.maxX, minZ: snap.city.minZ, maxZ: snap.city.maxZ, annex: snap.annex,
};
const fails = [];
const planned = [];
const out = [];
const T0 = Date.now();
for (const site of L.siteTable(city)) {
  const P = L.planSite(city, site, planned);
  const regions = L.planRegions(P);
  const roads = L.roadRecords(P, site.id);
  const A = CBZ.metroPlanAudit(P);
  planned.push({ id: site.id, regions, plan: P });
  const S = P.stats;
  // region law: never over another place, never over a road corridor
  let regionHits = 0; const regionEx = [];
  for (const r of regions) {
    for (const o of city.regions) {
      if (o.biome === site.biome && o.name === site.name) continue;          // its own core
      const w = Math.min(r.maxX, o.maxX) - Math.max(r.minX, o.minX), d = Math.min(r.maxZ, o.maxZ) - Math.max(r.minZ, o.minZ);
      if (w > 0.5 && d > 0.5) { regionHits++; if (regionEx.length < 4) regionEx.push(o.name); }
    }
    for (const p of planned) if (p.id !== site.id) for (const q of p.regions) {
      const w = Math.min(r.maxX, q.maxX) - Math.max(r.minX, q.minX), d = Math.min(r.maxZ, q.maxZ) - Math.max(r.minZ, q.minZ);
      if (w > 0.5 && d > 0.5) { regionHits++; if (regionEx.length < 4) regionEx.push(p.id); }
    }
  }
  const bands = A.bands;
  const core = bands["0-0.25"], rim = bands["0.75-1"] || bands["0.5-0.75"];
  const falls = !core || !rim || core.mean > rim.mean;
  const rec = {
    id: site.id, name: site.name, tier: site.tier, footprint: S.footprint, buildings: S.buildings, byType: S.byType,
    storeyBands: S.storeyBands, meanStoreysByDistance: bands, tallest: S.tallest, streetKm: S.streetKm, blocks: S.blocks,
    districts: P.districts.map((d) => d.name + ":" + d.kind), landmarks: P.landmarks.map((l) => l.name), trees: S.trees,
    population: S.population, jobs: S.jobs, regions: regions.length, arterialRecords: roads.length,
    bridges: S.bridges, overpasses: S.overpasses, interchanges: S.interchanges, planMs: S.planMs,
    map: (function () {
      const ch = { cbd: "C", midtown: "M", inner: "I", rows: "R", suburb: "s", exurb: "e", farm: "f", industrial: "X", park: "P", stadium: "S", campus: "U", mall: "L", void: "." };
      const rows = [];
      for (let j = P.NZ - 1; j >= 0; j--) { let l = ""; for (let i = 0; i < P.NX; i++) l += ch[P.cellAt(i, j).use] || "?"; rows.push(l); }
      return rows;
    })(),
    audit: { onStreet: A.onStreet, onRiver: A.onRiver, onCorridor: A.onCorridor, onObstacle: A.onObstacle, overlaps: A.overlaps, disconnected: A.disconnected, regionHits, regionEx },
  };
  out.push(rec);
  if (!A.ok) fails.push(site.id + ": plan audit " + JSON.stringify(rec.audit) + " " + JSON.stringify(A.examples.slice(0, 4)));
  if (regionHits) fails.push(site.id + ": " + regionHits + " region overlaps (" + regionEx.join(", ") + ")");
  if (!falls) fails.push(site.id + ": height does not fall from the core");
}
if (argv.includes("--json")) console.log(JSON.stringify(out, null, 1));
else for (const r of out) {
  console.log(`\n== ${r.name} (${r.tier}) ${r.footprint.w} x ${r.footprint.d} m (${r.footprint.km2} km2 bbox), ${r.buildings} buildings, tallest ${r.tallest} storeys, pop ~${r.population}, jobs ~${r.jobs}, plan ${r.planMs} ms`);
  console.log("   by type   " + Object.entries(r.byType).map(([k, v]) => k + " " + v).join(" · "));
  console.log("   storeys   " + ["1", "2", "3-4", "5-9", "10-19", "20-39", "40+"].map((k) => k + ": " + (r.storeyBands[k] || 0)).join(" · "));
  console.log("   mean st.  " + Object.entries(r.meanStoreysByDistance).sort().map(([k, v]) => "e " + k + " = " + v.mean + " (max " + v.max + ", n " + v.n + ")").join(" · "));
  console.log("   streets   " + Object.entries(r.streetKm).map(([k, v]) => k + " " + v + " km").join(" · ") + ` · ${r.blocks} blocks · ${r.bridges} bridges · ${r.overpasses} overpasses · ${r.interchanges} interchanges`);
  console.log("   districts " + r.districts.join(", "));
  console.log("   landmarks " + (r.landmarks.join(", ") || "-"));
  for (const line of r.map) console.log("   | " + line);
  console.log(`   ${r.regions} regions · ${r.arterialRecords} arterial road records · ${r.trees} trees · audit ${JSON.stringify(r.audit)}`);
}
console.log(`\n${out.length} cities in ${Date.now() - T0} ms — ${fails.length ? "FAIL" : "PASS"}`);
for (const f of fails) console.log("  FAIL " + f);
process.exit(fails.length ? 1 : 0);
