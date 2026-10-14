#!/usr/bin/env node
/* tools/island-check.mjs — THE DISASTER ISLAND'S PLAN, AUDITED IN NODE.

   Runs world/island_roads.js plan() and world/island_plan.js make() exactly
   as the game does (no browser, no THREE) and prints what a builder asks:

     size        radius, land area, the town's extent
     streets     lines, pieces, junctions (4-way / T / bend), bridges
     lots        by district and kind, storeys, towers, the helipad
     audit       overlaps (must be 0), footprints past their lot line (0),
                 lots on a street (0), footprints off the land (0)
     cars        kerbside / car park / driveway, any off the road (0), any
                 two in one place (0)
     boats       berths in the harbour

     node tools/island-check.mjs            # the report; exit 1 on a failed audit
     node tools/island-check.mjs --json     # the numbers as JSON
     node tools/island-check.mjs --svg out.svg   # a plan drawing to look at

   The full build (meshes, facades, boot time) is the lab's:
     node tools/lab/run.mjs --kit island */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };

// the facade registry, read off the grammar files (id + storey range)
function facadeTable() {
  const dir = path.join(ROOT, "src/city/facades");
  const ids = [], tall = {}, low = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".js")).sort()) {
    const s = readFileSync(path.join(dir, f), "utf8");
    const m = /registerFacade\("([^"]+)"/.exec(s);
    if (!m) continue;
    ids.push(m[1]);
    const mn = /minStoreys:\s*(\d+)/.exec(s), mx = /maxStoreys:\s*(\d+)/.exec(s);
    if (mn) tall[m[1]] = +mn[1];
    if (mx) low[m[1]] = +mx[1];
  }
  return { ids, tall, low };
}

const t0 = performance.now();
const ctx = { console, Math, Object, Array, Set, Map, JSON, Number, Infinity, isFinite };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["src/world/island_roads.js", "src/world/island_plan.js"]) {
  vm.runInContext(readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
}
const CBZ = ctx.CBZ;
// the arena's own numbers (src/config.js CBZ.SURV.arena)
const cfgSrc = readFileSync(path.join(ROOT, "src/config.js"), "utf8");
const am = /arena:\s*\{\s*cx:\s*(-?\d+),\s*cz:\s*(-?\d+),\s*radius:\s*(\d+)/.exec(cfgSrc);
const A = am ? { cx: +am[1], cz: +am[2], R: +am[3] } : { cx: 0, cz: 600, R: 240 };
const F = facadeTable();
const P = CBZ.islandPlan.make({ cx: A.cx, cz: A.cz, R: A.R, facades: F.ids, tall: F.tall, low: F.low });
const C = CBZ.islandPlan.check(P);
const ms = performance.now() - t0;

const by = (list, key) => list.reduce((o, x) => { const k = typeof key === "function" ? key(x) : x[key]; o[k] = (o[k] || 0) + 1; return o; }, {});
const J = P.roads ? P.roads.junctions : [];
const styles = by(P.lots.filter((l) => l.style), "style");
const missing = F.ids.filter((id) => !styles[id]);
let tx0 = 1e9, tx1 = -1e9, tz0 = 1e9, tz1 = -1e9;
for (const l of P.lots) { tx0 = Math.min(tx0, l.lot.x0); tx1 = Math.max(tx1, l.lot.x1); tz0 = Math.min(tz0, l.lot.z0); tz1 = Math.max(tz1, l.lot.z1); }
const report = {
  size: { radius: P.R, diameter: 2 * P.R, landHa: +(Math.PI * P.R * P.R / 1e4).toFixed(2), town: [+(tx1 - tx0).toFixed(0), +(tz1 - tz0).toFixed(0)] },
  streets: {
    lines: P.streets.ave.length + P.streets.cross.length,
    pieces: P.roads ? P.roads.pieces.length : 0,
    km: +((P.roads ? P.roads.pieces.reduce((s, p) => s + p.b - p.a, 0) : 0) / 1000).toFixed(2),
    junctions: J.length, fourWay: J.filter((j) => j.n === 4).length, tee: J.filter((j) => j.n === 3).length, bend: J.filter((j) => j.n === 2).length,
    bridges: P.bridges.length,
  },
  lots: {
    total: P.lots.length, byDistrict: by(P.lots, "district"), byKind: by(P.lots, "kind"),
    storeys: by(P.lots, (l) => l.storeys), towers: P.lots.filter((l) => l.kind === "tower").length,
    helipad: P.helipad ? { x: +P.helipad.x.toFixed(1), z: +P.helipad.z.toFixed(1), storeys: P.helipad.storeys, style: P.helipad.style } : null,
    styles: Object.keys(styles).length, stylesMissing: missing,
    driveways: P.lots.filter((l) => l.driveway).length,
  },
  places: { plaza: !!P.plaza, carParks: P.parking.length, bays: P.parking.reduce((s, p) => s + p.bays.length, 0),
    showroom: !!P.showroom, stations: P.stations.length, fields: P.fields.length, trees: P.trees.length },
  audit: { overlaps: C.overlaps, lotLine: C.lotLine, lotOnStreet: C.lotOnStreet, offLand: C.offLand },
  cars: { total: C.carsTotal, kerb: C.carsOnRoad, carPark: C.carsInBays, driveway: C.carsOnDrive, offRoad: C.carsBad, stacked: C.carsOverlap },
  boats: P.harbour.berths.length, rejects: P.rejects,
  ms: +ms.toFixed(0),
  bad: C.bad,
};
const fail = C.overlaps || C.lotLine || C.lotOnStreet || C.offLand || C.carsBad || C.carsOverlap || !P.helipad;

if (has("--svg")) {
  const out = arg("--svg", "island-plan.svg");
  const S = 2, ox = P.cx - P.R - 40, oz = P.cz - P.R - 40, N = (2 * P.R + 80) * S;
  const NZ = (Math.max(2 * P.R + 80, P.harbour.basin.z1 + 30 - oz)) * S;
  const X = (x) => ((x - ox) * S).toFixed(1), Zs = (z) => ((z - oz) * S).toFixed(1);
  const rect = (r, fill, stroke) => `<rect x="${X(r.x0)}" y="${Zs(r.z0)}" width="${((r.x1 - r.x0) * S).toFixed(1)}" height="${((r.z1 - r.z0) * S).toFixed(1)}" fill="${fill}" stroke="${stroke || "none"}" stroke-width="0.6"/>`;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${NZ}" viewBox="0 0 ${N} ${NZ}"><rect width="100%" height="100%" fill="#2a5d7a"/>`,
    `<circle cx="${X(P.cx)}" cy="${Zs(P.cz)}" r="${(P.R + 12) * S}" fill="#c9b78a"/><circle cx="${X(P.cx)}" cy="${Zs(P.cz)}" r="${P.R * S}" fill="#5f8a45"/>`];
  for (const h of P.hills) parts.push(`<circle cx="${X(h.x)}" cy="${Zs(h.z)}" r="${h.r * S}" fill="${h.volcano ? "#5a4a42" : "#4b6e36"}"/>`);
  parts.push(`<polyline points="${P.ghaut.pts.map((p) => X(p.x) + "," + Zs(p.z)).join(" ")}" fill="none" stroke="#8a7a5a" stroke-width="${P.ghaut.bank * S * 1.4}" stroke-linejoin="round"/>`);
  parts.push(rect(P.harbour.quay, "#9a9a92"));
  for (const s of P.harbour.breakwater) parts.push(`<line x1="${X(s.ax)}" y1="${Zs(s.az)}" x2="${X(s.bx)}" y2="${Zs(s.bz)}" stroke="#6d6a64" stroke-width="${P.harbour.half * 2 * S}"/>`);
  for (const p of P.harbour.piers) parts.push(rect(p, p.kind === "cargo" ? "#9a9a92" : "#8a6a48"));
  for (const r of P.streetRects) parts.push(rect(r, "#cfcac0"));
  if (P.roads) for (const p of P.roads.pieces) parts.push(p.vertical ? rect({ x0: p.fixed - 3.5, x1: p.fixed + 3.5, z0: p.a, z1: p.b }, "#3a3c40") : rect({ x0: p.a, x1: p.b, z0: p.fixed - 3.5, z1: p.fixed + 3.5 }, "#3a3c40"));
  if (P.roads) for (const j of P.roads.junctions) parts.push(rect({ x0: j.x - 3.5, x1: j.x + 3.5, z0: j.z - 3.5, z1: j.z + 3.5 }, "#3a3c40"));
  for (const b of P.bridges) parts.push(rect(b, "none", "#e0b040"));
  for (const f of P.fields) parts.push(rect(f, "#a08a4a"));
  for (const p of P.parking) parts.push(rect(p.rect, "#55575c"));
  if (P.plaza) parts.push(rect(P.plaza.rect, "#d8cfb8"));
  const KC = { tower: "#6a7aa0", hotel: "#a05a6a", shop: "#c08a5a", house: "#e0d0b0", villa: "#f0e8d0", works: "#8a8a80", showroom: "#c0c0d0", station: "#d06040", market: "#b07050", office: "#b07050", shed: "#8a8a80" };
  for (const l of P.lots) {
    parts.push(rect(l.lot, "none", "#ffffff55"));
    parts.push(rect({ x0: l.bx0, x1: l.bx1, z0: l.bz0, z1: l.bz1 }, KC[l.kind] || "#fff", "#222"));
    const dx = -Math.sin(l.yaw), dz = -Math.cos(l.yaw);
    parts.push(`<line x1="${X(l.x)}" y1="${Zs(l.z)}" x2="${X(l.x + dx * (l.yaw % Math.PI === 0 ? l.wz : l.wx) / 2)}" y2="${Zs(l.z + dz * (l.yaw % Math.PI === 0 ? l.wz : l.wx) / 2)}" stroke="#c00" stroke-width="1"/>`);
    if (l.driveway) parts.push(rect(l.driveway.rect, "#77777a"));
  }
  for (const c of P.cars) parts.push(rect(c.alongX ? { x0: c.x - 2.2, x1: c.x + 2.2, z0: c.z - 0.95, z1: c.z + 0.95 } : { x0: c.x - 0.95, x1: c.x + 0.95, z0: c.z - 2.2, z1: c.z + 2.2 }, "#e04040"));
  for (const t of P.trees) parts.push(`<circle cx="${X(t.x)}" cy="${Zs(t.z)}" r="${2.2 * S}" fill="${t.kind === "palm" ? "#2f7a3a" : "#24552a"}"/>`);
  for (const b of P.harbour.berths) parts.push(`<circle cx="${X(b.x)}" cy="${Zs(b.z)}" r="${(b.big ? 6 : 2.5) * S}" fill="#fff"/>`);
  parts.push("</svg>");
  writeFileSync(out, parts.join("\n"));
  console.log("wrote " + out);
}

if (has("--json")) console.log(JSON.stringify(report, null, 1));
else {
  const r = report;
  console.log(`island  R ${r.size.radius} m (${r.size.diameter} m across, ${r.size.landHa} ha), town ${r.size.town[0]} x ${r.size.town[1]} m   plan in ${r.ms} ms`);
  console.log(`streets ${r.streets.lines} lines, ${r.streets.pieces} pieces, ${r.streets.km} km, junctions ${r.streets.junctions} (${r.streets.fourWay} 4-way, ${r.streets.tee} T, ${r.streets.bend} bend), bridges ${r.streets.bridges}`);
  console.log(`lots    ${r.lots.total}  ${JSON.stringify(r.lots.byDistrict)}`);
  console.log(`        kinds ${JSON.stringify(r.lots.byKind)}  storeys ${JSON.stringify(r.lots.storeys)}`);
  console.log(`        towers ${r.lots.towers}, driveways ${r.lots.driveways}, styles ${r.lots.styles} (missing: ${r.lots.stylesMissing.join(", ") || "none"})`);
  console.log(`        helipad ${r.lots.helipad ? JSON.stringify(r.lots.helipad) : "NONE"}`);
  console.log(`places  plaza ${r.places.plaza}, car parks ${r.places.carParks} (${r.places.bays} bays), showroom ${r.places.showroom}, stations ${r.places.stations}, fields ${r.places.fields}, trees ${r.places.trees}`);
  console.log(`audit   overlaps ${r.audit.overlaps}  lot-line ${r.audit.lotLine}  lot-on-street ${r.audit.lotOnStreet}  off-land ${r.audit.offLand}`);
  console.log(`cars    ${r.cars.total} (kerb ${r.cars.kerb}, car park ${r.cars.carPark}, driveway ${r.cars.driveway})  off-road ${r.cars.offRoad}  stacked ${r.cars.stacked}`);
  console.log(`boats   ${r.boats} berths`);
  if (r.bad.length) console.log("bad     " + r.bad.join("; "));
  console.log(fail ? "FAIL" : "PASS");
}
process.exit(fail ? 1 : 0);
