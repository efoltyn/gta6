#!/usr/bin/env node
/* tools/protected-land-check.mjs — NOTHING IS BUILT ON A BASE OR AN AIRFIELD.

   Bug (seed 90210): the parked B-2 at Fort Brandt stood between office
   buildings. Law this enforces: military bases, airfields and bunkers are
   PROTECTED LAND in the one zoning field (city/zoning.js), and no generator
   puts a building or a street inside their footprint + clear buffer.

   Runs the exact placement code the game runs, in plain node (no browser):
     world/layout.js        the layout dial (where Fort Brandt actually is)
     city/zoning.js         the protected sites + their buffers
     city/metro.js +        every planned city: Kingsport, Karvel, Gang City
     city/metroplan.js      West + North, the Goldspire / Cape Harbor / Neon
                            Reef rings. Their P.bldgs ARE what the facade fills
                            and the far HLOD tiles draw (metro_fabric.js), so
                            checking the plan checks those too.
     city/countryside.js    farms, roadside houses, diners
   against tools/metro-world-snapshot.json (the live region/road layout).
   The walk-in downtowns (buildings.js, towngen.js, minicities.js) build only
   inside their own authored rects; those rects are checked as footprints.

   FAILS (exit 1) when, for any seed:
     - a building footprint (oriented box) intersects a protected site's
       rect + buffer
     - a street's carriageway intersects a protected site's rect + buffer
     - a walk-in town rect intersects one
     - a Fort Brandt fixture (the B-2 pad, the deep shelter) is not inside
       the Fort Brandt region the base actually stands on
   Usage: node tools/protected-land-check.mjs [--seeds 90210,1337,4242] [-v]
*/
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const SEEDS = (argv.indexOf("--seeds") >= 0 ? argv[argv.indexOf("--seeds") + 1] : "90210,1337,4242").split(",").map(Number);
const VERBOSE = argv.includes("-v");
const snap = JSON.parse(readFileSync(path.join(ROOT, "tools/metro-world-snapshot.json"), "utf8"));
const SRC = ["src/world/layout.js", "src/city/zoning.js", "src/city/metroplan.js", "src/city/countryside.js", "src/city/metro.js"].map((f) => path.join(ROOT, f));

function boot(seed) {
  for (const f of SRC) delete require.cache[f];
  globalThis.window = { CBZ: { CONFIG: {}, WORLD_SEED: seed, highwayNetTable: () => snap.hw, HIGHWAY_NET_HALF: snap.H } };
  for (const f of SRC) require(f);
  return globalThis.window.CBZ;
}
function makeCity() {
  return {
    regions: snap.regions.map((r) => Object.assign({ kind: "rect" }, r)),
    roads: snap.roads.map((r) => ({ x: r[0], z: r[1], vertical: !!r[2], len: r[3], w: r[4], district: r[5] })),
    minX: snap.city.minX, maxX: snap.city.maxX, minZ: snap.city.minZ, maxZ: snap.city.maxZ, annex: snap.annex,
  };
}

// ---- geometry: oriented box (metroplan's rot convention) vs an AABB, by SAT
function obb(b) {
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0), hw = b.w / 2, hd = b.d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map((p) => ({ x: b.x + p[0] * c + p[1] * s, z: b.z - p[0] * s + p[1] * c }));
}
function polyHitsRect(P, r) {
  const R = [{ x: r.minX, z: r.minZ }, { x: r.maxX, z: r.minZ }, { x: r.maxX, z: r.maxZ }, { x: r.minX, z: r.maxZ }];
  const axes = [{ x: 1, z: 0 }, { x: 0, z: 1 }];
  for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; axes.push({ x: q.z - p.z, z: p.x - q.x }); }
  for (const a of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of P) { const v = p.x * a.x + p.z * a.z; if (v < a0) a0 = v; if (v > a1) a1 = v; }
    for (const p of R) { const v = p.x * a.x + p.z * a.z; if (v < b0) b0 = v; if (v > b1) b1 = v; }
    if (a1 <= b0 + 1e-6 || b1 <= a0 + 1e-6) return false;
  }
  return true;
}
function segQuad(a, b, half) {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, nx = -dz / L * half, nz = dx / L * half;
  return [{ x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz }, { x: b.x - nx, z: b.z - nz }, { x: a.x - nx, z: a.z - nz }];
}
const grow = (r, p) => ({ minX: r.minX - p, maxX: r.maxX + p, minZ: r.minZ - p, maxZ: r.maxZ + p, name: r.name, kind: r.kind, fence: r });

// the walk-in towns: built inside their own rects (minicities.js PLACEMENTS)
const TOWNS = [["goldspire", 150, 470, 118, 120], ["capeharbor", 430, 175, 120, 120], ["neonreef", -1080, -260, 130, 128], ["foundry", -1080, 225, 135, 130]];

let failed = 0;
for (const seed of SEEDS) {
  const CBZ = boot(seed);
  const city = makeCity();
  const Z = CBZ.zoningFor(city);
  // THE PROTECTED SITES the zoning field publishes (bases, airfields,
  // bunkers, the fixed Fort Brandt hardware), each grown by its buffer
  const sites = (Z.airfields ? Z.airfields() : Z.protect.filter((p) => /military|airport/.test(p.kind)))
    .map((p) => grow(p, p.buffer || 0));
  const perSite = {};
  const fails = [];
  // fixtures stand inside the base they belong to
  const fb = city.regions.find((r) => r.name === "Fort Brandt" && r.biome === "military");
  for (const id of ["b2-pad", "brandt-shelter"]) {
    const f = CBZ.protectedSite ? CBZ.protectedSite(id) : null;
    if (!f) { fails.push(`fixture ${id}: zoning publishes no spot for it`); continue; }
    if (!(f.minX >= fb.minX && f.maxX <= fb.maxX && f.minZ >= fb.minZ && f.maxZ <= fb.maxZ))
      fails.push(`fixture ${id} at (${f.cx}, ${f.cz}) is outside Fort Brandt (${fb.minX}..${fb.maxX} x ${fb.minZ}..${fb.maxZ})`);
  }
  let nb = 0, ns = 0, hitsB = 0, hitsS = 0, inFence = 0;
  const ex = [];
  const note = (what, gen, site, x, z, fence) => { if (ex.length < 12 || fence) ex.push(`${what} of ${gen} at (${Math.round(x)}, ${Math.round(z)}) ${fence ? "INSIDE" : "in the buffer of"} ${site.name}`); };
  function checkPlan(P, gen) {
    for (const b of P.bldgs || []) {
      nb++;
      const poly = obb(b);
      for (const s of sites) if (polyHitsRect(poly, s)) { hitsB++; perSite[s.name] = (perSite[s.name] || 0) + 1; const f = polyHitsRect(poly, s.fence); if (f) inFence++; note("building", gen, s, b.x, b.z, f); break; }
    }
    for (const st of P.streets || []) {
      ns++;
      let hit = null;
      for (let i = 0; i + 1 < st.pts.length && !hit; i++) {
        const q = segQuad(st.pts[i], st.pts[i + 1], (st.w || 8) / 2);
        for (const s of sites) if (polyHitsRect(q, s)) { hit = s; note("street", gen, s, st.pts[i].x, st.pts[i].z); if (VERBOSE) ex.push("      " + st.k + " w " + st.w + " " + JSON.stringify(st.pts.map((p) => [Math.round(p.x), Math.round(p.z)]))); break; }
      }
      if (hit) { hitsS++; perSite[hit.name + " (streets)"] = (perSite[hit.name + " (streets)"] || 0) + 1; }
    }
  }
  const L = CBZ.metroLib, planned = [];
  for (const site of L.siteTable(city)) {
    const P = L.planSite(city, site, planned);
    planned.push({ id: site.id, regions: L.planRegions(P), plan: P });
    checkPlan(P, site.id);
    // a street cut at the fence must still reach the network (the rest of
    // the plan's laws are tools/metro-plan-check.mjs's)
    const A = CBZ.metroPlanAudit(P);
    if (A.disconnected) fails.push(`${site.id}: ${A.disconnected} streets cut off from the network`);
  }
  // countryside plans round the cities registered before it (metro.js order)
  for (const p of planned) for (const r of p.regions) city.regions.push(Object.assign({ kind: "rect", metro: true, biome: p.id, name: p.id }, r));
  const CP = CBZ.countrysidePlan ? CBZ.countrysidePlan(city, Z) : null;
  if (CP) {
    checkPlan(CP, "countryside");
    for (const pd of CP.pads || []) for (const s of sites) if (polyHitsRect([{ x: pd.minX, z: pd.minZ }, { x: pd.maxX, z: pd.minZ }, { x: pd.maxX, z: pd.maxZ }, { x: pd.minX, z: pd.maxZ }], s)) { hitsB++; note("pad", "countryside", s, pd.minX, pd.minZ); break; }
  }
  for (const [id, ax, az, hx, hz] of TOWNS) {
    const o = CBZ.worldOff(id), r = { minX: ax + o.dx - hx, maxX: ax + o.dx + hx, minZ: az + o.dz - hz, maxZ: az + o.dz + hz };
    for (const s of sites) if (polyHitsRect([{ x: r.minX, z: r.minZ }, { x: r.maxX, z: r.minZ }, { x: r.maxX, z: r.maxZ }, { x: r.minX, z: r.maxZ }], s)) { hitsB++; note("town", id, s, (r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2); }
  }
  // the downtown grid (buildings.js) is the city rect
  for (const s of sites) if (polyHitsRect([{ x: city.minX, z: city.minZ }, { x: city.maxX, z: city.minZ }, { x: city.maxX, z: city.maxZ }, { x: city.minX, z: city.maxZ }], s)) { hitsB++; note("downtown", "buildings.js", s, 0, -700); }
  if (hitsB) fails.push(`${hitsB} building footprints on protected land: ${JSON.stringify(perSite)}`);
  if (hitsS) fails.push(`${hitsS} streets on protected land`);
  console.log(`seed ${seed}: ${sites.length} protected sites (${sites.map((s) => s.name).join(", ")}), ${nb} buildings, ${ns} streets -> ${hitsB} building hits (${inFence} inside the fence itself), ${hitsS} street hits${fails.length ? " FAIL" : " PASS"}`);
  for (const f of fails) console.log("  FAIL " + f);
  if (VERBOSE || fails.length) for (const e of ex) console.log("    " + e);
  if (fails.length) failed++;
}
process.exit(failed ? 1 : 0);
