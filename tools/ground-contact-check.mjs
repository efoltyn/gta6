#!/usr/bin/env node
/* tools/ground-contact-check.mjs — THE GROUND, THE TREES ON IT, THE ROAD
   OVER IT, CHECKED IN PLAIN NODE (no browser, ~2 s).

   Owner 2026-09-30: "the green ground that is very unrealistic in Gang City,
   especially that trees are on it, makes trees look like floating and ruins
   the world, and roads have fake curved lines going through".

   1. LAWN ALBEDO. Every grass ground in Gang City hands the lights one linear
      albedo; they must be ONE family (one world at every distance) and real
      turf (lum 0.08-0.15, g/r 1.2-1.8, g/b 2-3.6). Reads the palettes from
      the shipped sources: city/cityground.js (CBZ.cityGround.palette),
      city/expansion.js (annex turf, decoded by the ground skin),
      city/metro_ground.js and city/continent.js.
   2. TREE CONTACT (world/treefoot.js). The AO profile is dark at the trunk
      and gone at the rim; a disc laid on a slope lies ON the slope (its rim
      within a few cm of the ground, where a flat disc on a 22 deg slope was
      ~0.4 m off); the mature-wood buttress roots end below the trunk base.
   3. METRO TREES. Every planned tree gets a ground height and a contact
      disc; counts the trees the metro floor has no answer for (they used to
      be planted at a flat y 0).
   4. ROAD LINES. The asphalt shader draws no noise-isoline cracks (the
      curved lines) and the baked asphalt map has no ridge cracks; the
      junction pass leaves every street-kit crossing alone; highway decks
      are trimmed off street-kit surfaces.

   Exit 1 on any FAIL.  Usage: node tools/ground-contact-check.mjs
*/
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (f) => readFileSync(path.join(ROOT, f), "utf8");
const fails = [];
const ok = (cond, msg) => { console.log((cond ? "   ok   " : "   FAIL ") + msg); if (!cond) fails.push(msg); };

/* ---------------- 1. lawn albedo ---------------- */
console.log("1. lawn albedo (linear, what the lights see)");
const raw = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((c) => c / 255);
const dec = (h) => raw(h).map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
const skin = (h) => { const f = (v) => v * (v * (v * 0.305306011 + 0.682171111) + 0.012522878); const c = raw(h).map(f); const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return c.map((x) => l + (x - l) * 0.8); };
const hexIn = (file, re) => { const m = src(file).match(re); if (!m) throw new Error("palette not found in " + file + ": " + re); return parseInt(m[1], 16); };
const lawns = [
  ["downtown lots (cityground)", dec(hexIn("src/city/cityground.js", /GRASS_HEX = 0x([0-9a-f]{6})/))],
  ["annex island (ground skin)", skin(hexIn("src/city/expansion.js", /C_TURF = new THREE\.Color\(0x([0-9a-f]{6})\)/))],
  ["backcountry (ground skin)", skin(hexIn("src/city/continent.js", /cGrass = new THREE\.Color\(0x([0-9a-f]{6})\)/))],
  ["metro lawn", (function () { const m = src("src/city/metro_ground.js").match(/lawn: sq\(\[([0-9.]+), ([0-9.]+), ([0-9.]+)\]\)/); return [+m[1], +m[2], +m[3]]; })()],
];
const lums = [];
for (const [name, c] of lawns) {
  const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], gr = c[1] / c[0], gb = c[1] / c[2];
  lums.push(L);
  ok(L > 0.08 && L < 0.15 && gr > 1.2 && gr < 1.8 && gb > 2 && gb < 3.6,
    name.padEnd(30) + " lin " + c.map((v) => v.toFixed(3)).join(",") + "  lum " + L.toFixed(3) + "  g/r " + gr.toFixed(2) + "  g/b " + gb.toFixed(2));
}
const spread = Math.max(...lums) / Math.min(...lums);
ok(spread < 1.25, "one family: brightest / darkest lawn = " + spread.toFixed(2) + " (< 1.25)");
ok(!/checkerTex\(CBZ\.COL\.GRASS_A/.test(src("src/city/expansion.js")), "annex: no checker turf path left");
ok(/groundSkin/.test(src("src/city/expansion.js")), "annex: island + beach wear the one ground skin (decoded albedo)");

/* ---------------- 2. tree contact ---------------- */
console.log("\n2. tree contact (world/treefoot.js)");
const ctx = vm.createContext({ console });
ctx.window = ctx; ctx.self = ctx;
ctx.CBZ = { CONFIG: {}, qScale: (_lo, hi) => hi };
for (const f of ["src/vendor/three.r128.min.js", "src/vendor/BufferGeometryUtils.js", "src/world/treeaudit.js", "src/world/vegetation.js", "src/world/treefoot.js"]) {
  vm.runInContext(src(f), ctx, { filename: f });
}
const { THREE: T, CBZ: C } = ctx;
const prof = C.treeFoot._profile;
ok(prof(0, 0) > 0.6 && prof(0.5, 0) > 0.1 && prof(0.5, 0) < 0.4 && prof(0.99, 0) < 0.02,
  "AO profile: trunk " + prof(0, 0).toFixed(2) + ", half radius " + prof(0.5, 0).toFixed(2) + ", rim " + prof(0.99, 0).toFixed(3));
const parent = new T.Group();
const slope = 0.4;                                    // 22 deg
const H = (x, z) => slope * x + 0.1 * z;
const feet = [];
for (let i = 0; i < 20; i++) { const x = i * 7, z = i * 3; feet.push(x, H(x, z), z, 1.5 + (i % 5), i % 2 ? 0.9 : 0); }
const meshes = C.treeFoot.add(parent, feet, { name: "check", heightAt: H });
ok(meshes.length === 2 && meshes.every((m) => m.isInstancedMesh), "one AO pool + one mulch pool (" + meshes.map((m) => m.name + " x" + m.count).join(", ") + ")");
function rimError(m, tilt) {
  const M = new T.Matrix4(), p = new T.Vector3();
  let worst = 0;
  for (let i = 0; i < m.count; i++) {
    m.getMatrixAt(i, M);
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2;
      p.set(Math.cos(a), 0, Math.sin(a)).applyMatrix4(M);
      worst = Math.max(worst, Math.abs(p.y - H(p.x, p.z)));
    }
  }
  return worst;
}
const ao = meshes.find((m) => /foot-ao/.test(m.name));
const tilted = rimError(ao);
const flatParent = new T.Group();
const flat = C.treeFoot.add(flatParent, feet, { name: "flat" }).find((m) => /foot-ao/.test(m.name));
const untilted = rimError(flat);
ok(tilted < 0.12, "a disc on a 22 deg slope lies on it: worst rim offset " + tilted.toFixed(3) + " m (flat disc: " + untilted.toFixed(2) + " m)");
const mw = C.vegetationKit && C.vegetationKit.geometry ? C.vegetationKit.geometry("mature-wood", 0) : null;
if (mw) { mw.computeBoundingBox(); ok(mw.boundingBox.min.y < -0.08, "mature-wood buttress roots end below the trunk base (min y " + mw.boundingBox.min.y.toFixed(3) + ")"); }
else ok(false, "mature-wood geometry not built");

/* ---------------- 3. metro trees ---------------- */
console.log("\n3. metro trees (plan + floor, tools/metro-world-snapshot.json)");
{
  const require = createRequire(import.meta.url);
  const snap = JSON.parse(src("tools/metro-world-snapshot.json"));
  const prevWin = globalThis.window;
  globalThis.window = { CBZ: { CONFIG: {}, WORLD_SEED: 90210, highwayNetTable: () => snap.hw, HIGHWAY_NET_HALF: snap.H } };
  require(path.join(ROOT, "src/city/zoning.js")); require(path.join(ROOT, "src/city/metroplan.js")); require(path.join(ROOT, "src/city/metro.js")); require(path.join(ROOT, "src/city/metro_ground.js"));
  const MC = globalThis.window.CBZ, L = MC.metroLib;
  const city = { regions: snap.regions.map((r) => Object.assign({ kind: "rect" }, r)), roads: snap.roads.map((r) => ({ x: r[0], z: r[1], vertical: !!r[2], len: r[3], w: r[4], district: r[5] })), minX: snap.city.minX, maxX: snap.city.maxX, minZ: snap.city.minZ, maxZ: snap.city.maxZ, annex: snap.annex };
  const planned = []; let tot = 0, off = 0;
  for (const site of L.siteTable(city)) {
    const P = L.planSite(city, site, planned); planned.push({ id: site.id, regions: L.planRegions(P), plan: P });
    const S = MC.metroGround.solve(P);
    for (const t of P.trees) { tot++; if (S.heightAt(t.x, t.z) == null) off++; }
  }
  globalThis.window = prevWin;
  const m = src("src/city/metro.js");
  ok(/CBZ\.treeFoot\.add\(root, feet/.test(m) && /CBZ\.floorAt\(x, z\)/.test(m), tot + " metro trees, each gets a contact disc; " + off + " stand off the metro floor (were planted at a flat y 0, now seated on CBZ.floorAt)");
}

/* ---------------- 4. road lines ---------------- */
console.log("\n4. road lines");
const mats = src("src/world/materials.js");
ok(!/asIsoDist\s*\(/.test(mats), "asphalt shader: no noise-isoline crack network (the curved lines)");
ok(/float tar = seal \* \(1\.0 - smoothstep\(0\.035, 0\.07, jd\)\)/.test(mats), "asphalt shader: crack sealant follows the lane joints");
const ts = src("src/world/textures_surface.js");
const asphaltAuthor = ts.slice(ts.indexOf("    asphalt: {"), ts.indexOf("    roofing: {"));
ok(!/ridge\(/.test(asphaltAuthor), "baked asphalt map: no ridge-noise crack grooves");
ok(/\(J\.a && \(J\.a\.grid \|\| J\.a\.kit\)\) \|\| \(J\.b && \(J\.b\.grid \|\| J\.b\.kit\)\)/.test(src("src/city/props.js")), "junction pass: no fan / curved kerb / patch over any street-kit crossing");
ok(/stationize\(trimToKit\(S\.path\), STEP\)/.test(src("src/city/highways.js")), "highway decks: trimmed off street-kit surfaces (airport + military causeways ran 31-32 m over the grid)");

console.log(fails.length ? "\nGROUND CONTACT CHECK FAILED (" + fails.length + ")" : "\nALL GROUND CONTACT CHECKS OK");
process.exit(fails.length ? 1 : 0);
