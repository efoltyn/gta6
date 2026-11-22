/* tools/citymap/plan.mjs: draw the WORLD PLAN alone, without booting the game.

   src/world/worldplan.js is pure data and math, so node can evaluate it: this
   samples its coast, range and land cover on a 40 m grid, lays the places and
   the routes over it as the plan states them, and writes a map.json that
   tools/citymap/render.py draws like a real dump. Two seconds instead of a
   three-minute boot: design the geography here, then check it against what
   the game actually builds with dump.mjs.

     node tools/citymap/plan.mjs && CITYMAP_OUT=<out>/plan/ python3 tools/citymap/render.py 6

   Writes into CITYMAP_OUT + "plan/" (default ~/harness/out/gta6/citymap/plan/).
   The sizes of places below are for this drawing only (the game's own
   builders own the real ones); a plan map is a sketch, the dump is the truth. */
import fs from "fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const out = (process.env.CITYMAP_OUT || "/Users/elifoltyn/harness/out/gta6/citymap/") + "plan/";
fs.mkdirSync(out, { recursive: true });
const sandbox = { window: {}, console };
sandbox.globalThis = sandbox.window;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, "src/world/worldplan.js"), "utf8"), sandbox);
const CBZ = sandbox.window.CBZ, P = CBZ.worldPlan, B = P.bounds;

const STEP = 40, nx = Math.ceil((B.maxX - B.minX) / STEP), nz = Math.ceil((B.maxZ - B.minZ) / STEP);
const H = new Array(nx * nz), W = new Array(nx * nz), Bi = new Array(nx * nz);
const biomes = ["wilds", "desert", "farmland", "forest", "snow"];
const GM = { minX: -1450, maxX: 1750, minZ: -4100 + CBZ.worldOff("snow").dz, maxZ: -1780 + CBZ.worldOff("snow").dz + (330 - 429) };
const t0 = Date.now();
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
  const x = B.minX + (i + 0.5) * STEP, z = B.minZ + (j + 0.5) * STEP, k = j * nx + i;
  const land = P.landAt(x, z);
  W[k] = land < 0 ? 1 : 0;
  const R = P.reliefAt(x, z);
  let h = land < 0 ? 0 : R.h * Math.min(1, land / 300);
  let b = 0, bw = 0.5;
  for (let q = 1; q < biomes.length; q++) { const w = P.coverAt(x, z, biomes[q]); if (w > bw) { bw = w; b = q; } }
  if (R.alp > 0.45) b = 4;
  // the authored massif, sketched so the range reads whole
  if (x > GM.minX && x < GM.maxX && z > GM.minZ && z < GM.maxZ) {
    const e = Math.min(x - GM.minX, GM.maxX - x, z - GM.minZ, GM.maxZ - z);
    h = Math.max(h, Math.min(1, e / 500) * 300); if (e > 250) b = 4;
  }
  H[k] = Math.round(h); Bi[k] = b;
}
for (const r of P.rivers) {
  // rivers as inland water on the grid
  const pts = r.pts;
  for (let s = 0; s + 1 < pts.length; s++) {
    const a = pts[s], c = pts[s + 1], L = Math.hypot(c[0] - a[0], c[1] - a[1]), n = Math.ceil(L / 15);
    for (let t = 0; t <= n; t++) {
      const x = a[0] + (c[0] - a[0]) * t / n, z = a[1] + (c[1] - a[1]) * t / n;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const i = Math.floor((x - B.minX) / STEP) + dx, j = Math.floor((z - B.minZ) / STEP) + dz;
        if (i >= 0 && j >= 0 && i < nx && j < nz && !W[j * nx + i]) W[j * nx + i] = 2;
      }
    }
  }
}

// ---- the places as the plan stands them (sizes: this sketch only)
const SIZE = {
  speedway: { r: 210, n: "Diamond Speedway" }, airport: { hx: 595, hz: 160, n: "Halloran Field" }, military: { hx: 240, hz: 250, n: "Fort Brandt" },
  goldspire: { hx: 940, hz: 940, n: "Goldspire", metro: 1 }, capeharbor: { hx: 330, hz: 315, n: "Cape Harbor", dx: 325, dz: -208, extra: [{ n: "Cape Harbor Regional", dx: 485, dz: 515, hx: 522, hz: 250 }] },
  neonreef: { hx: 830, hz: 830, n: "Neon Reef", metro: 1 }, foundry: { hx: 135, hz: 130, n: "Foundry Flats" },
  veridia: { hx: 165, hz: 268, n: "Veridia", dz: -108 }, kesh: { hx: 235, hz: 210, n: "Kesh", dx: 115, dz: 54 }, solara: { hx: 150, hz: 145, n: "Solara" }, mbeya: { hx: 346, hz: 203, n: "Mbeya", dz: -95 },
  snow: { n: "Mount Mercy" }, desert: { n: "The Saltlands" }, farmland: { n: "Coyle Valley" }, forest: { n: "Redhollow Woods" },
};
const regions = [];
const rect = (n, b, x0, x1, z0, z1, extra) => regions.push(Object.assign({ n, b, k: "rect", x0, x1, z0, z1, road: 0, metro: 0, under: 0, lab: 1 }, extra || {}));
rect("Gang City", "city", -165, 165, -865, -535);
regions.push({ n: "Commerce Annex", b: "annex", k: "circle", cx: 380, cz: -700, r: 120, x0: 260, x1: 500, z0: -820, z1: -580, road: 0, metro: 0, under: 0, lab: 1 });
rect("Ironjaw Arena", "arena", 520, 760, -1070, -830);
rect("Greater Mercy Range", "snow", GM.minX, GM.maxX, GM.minZ, GM.maxZ);
for (const id in P.places) {
  const p = P.places[id], s = SIZE[id] || {}, f = CBZ.worldFoot(id);
  const cx = p.at[0] + (s.dx || 0), cz = p.at[1] + (s.dz || 0);
  if (f) rect(s.n || id, id, f.minX, f.maxX, f.minZ, f.maxZ);
  else if (s.r) regions.push({ n: s.n || id, b: id, k: "circle", cx, cz, r: s.r, x0: cx - s.r, x1: cx + s.r, z0: cz - s.r, z1: cz + s.r, road: 0, metro: 0, under: 0, lab: 1 });
  else rect(s.n || id, id, cx - (s.hx || 150), cx + (s.hx || 150), cz - (s.hz || 150), cz + (s.hz || 150), { metro: s.metro || 0 });
  for (const e of (s.extra || [])) rect(e.n, id + "x", p.at[0] + e.dx - e.hx, p.at[0] + e.dx + e.hx, p.at[1] + e.dz - e.hz, p.at[1] + e.dz + e.hz);
}
const K = P.metros.kingsport.bounds;
rect("Kingsport", "kingsport", K.minX, K.maxX, K.minZ, K.maxZ, { metro: 1 });
{ const f = P.metros.karvel.frame; rect("Karvel", "karvel", -4530 + f.dx, -1030 + f.dx, 950 + f.dz, 4130 + f.dz, { metro: 1 }); }
rect("Gang City West", "cityborough", -1495, -255, -1335, -415, { metro: 1 });
rect("Gang City North", "cityborough2", -545, 440, -1765, -955, { metro: 1 });
for (const id in P.sites) { const s = P.sites[id]; rect(id, "gov:" + id, s.x - 130, s.x + 130, s.z - 120, s.z + 120); }
// the grain towns (their real 148 x 124 m grid) and the roadside stops
for (const t of P.towns || []) rect(t.name, "town:" + t.id, t.cx - 74, t.cx + 74, t.cz - 62, t.cz + 62);
for (const s of P.stops || []) { const x = s.axis === "x" ? s.along : s.roadAt + s.side * (s.half + 16), z = s.axis === "x" ? s.roadAt + s.side * (s.half + 16) : s.along; rect(s.name, "stop:" + s.id, x - 14, x + 14, z - 14, z + 14); }

const net = P.routes.map((r) => ({ id: r.id, n: r.name, w: r.kind === "road" ? 11 : 30.6, rural: r.kind === "road" ? 1 : 0, raw: r.pts.map((q) => [q[0], q[1]]), pts: r.pts.map((q) => [q[0], q[1]]) }));
const highways = net.map((r) => ({ n: r.n, rt: r.id, w: r.w, L: 0, pts: r.pts, rural: r.rural, wet: [] }));
const o = { bounds: B, playable: B, authored: P.settled, seed: 0, streamed: false, skipped: [], planOnly: true,
  city: { minX: -165, maxX: 165, minZ: -865, maxZ: -535 }, annex: { cx: 380, cz: -700, r: 120 }, spawn: null, spawnWet: null,
  regions, roads: [], roadWet: [], highways, net, water: [],
  grid: { step: STEP, nx, nz, H, W, B: Bi, biomes, sea: 0 }, metros: [], types: [], nColliders: 0, foot: [], lots: [], plan: P.mapData() };
fs.writeFileSync(out + "map.json", JSON.stringify(o));
console.log("plan sampled in", Date.now() - t0, "ms ->", out + "map.json", "signature", P.signature());
