// tools/streetlife-check.mjs — one quick node check of city/streetlife.js.
// A downtown grid (world.js's shape: 34 m blocks, 18 m roads, a 2 m footway
// round every 30 m lot pad, a building with a door on each lot) at noon on a
// tablet budget, run for two simulated minutes on the real crowd store.
// Asserts: the street row count sits at its target inside the budget, at
// least 55% of people are in groups, walking members stay within 2 m of
// their formation slots, and nobody is ever inside a building footprint.
//   node tools/streetlife-check.mjs
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = globalThis;
const updaters = [];
let simT = 0;
const CBZ = globalThis.CBZ = {
  CONFIG: {}, deviceClass: "tablet", game: { mode: "city" }, now: 0,
  onUpdate(order, fn) { updaters.push({ order, fn }); updaters.sort((a, b) => a.order - b.order); },
  cityHour: () => +(process.env.HOUR || 12),   // HOUR=2 node tools/streetlife-check.mjs: the same street at another hour
  // traffic.js's signal clock
  cityPhase() {
    const t = simT % 14;
    if (t < 5) return { ns: "green", ew: "red" };
    if (t < 6.5) return { ns: "yellow", ew: "red" };
    if (t < 7) return { ns: "red", ew: "red" };
    if (t < 12) return { ns: "red", ew: "green" };
    if (t < 13.5) return { ns: "red", ew: "yellow" };
    return { ns: "red", ew: "red" };
  },
};

// ---- the downtown grid
const N = 6, BLK = 34, ROAD = 18, STEP = BLK + ROAD;
const x0 = -N * STEP / 2, lines = [];
for (let i = 0; i <= N; i++) lines.push(x0 + i * STEP);
const KINDS = ["commercial", "core", "commercial", "residential", "core", "industrial", "residential", "commercial", "projects"];
const SHOPS = ["food", "bar", "clothing", null, "bank", null];
const lots = [], buildings = [], streetProps = [], seats = [];
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
  const cx = (lines[i] + lines[i + 1]) / 2, cz = (lines[j] + lines[j + 1]) / 2;
  const q = Math.min(2, (i / 2) | 0) + 3 * Math.min(2, (j / 2) | 0);
  // the building: 3 m in from the pad, a door in the middle of one facade
  const half = (BLK - 4) / 2 - 3;
  const side = (i + j) % 4;               // which facade has the door
  const n = [[0, 1], [-1, 0], [0, -1], [1, 0]][side];   // into the room
  const door = { x: cx - n[0] * (half - 0.3), z: cz - n[1] * (half - 0.3), nx: n[0], nz: n[1] };
  const shop = SHOPS[(i * 7 + j * 3) % SHOPS.length];
  const lot = { cx, cz, w: BLK - 4, d: BLK - 4, i, j, district: q, office: (i + j) % 3 === 0,
    building: { door, shop: shop ? { kind: shop } : null } };
  lots.push(lot);
  buildings.push({ minX: cx - half, maxX: cx + half, minZ: cz - half, maxZ: cz + half });
  // the kerb furniture: lamps near the kerb, a tree pit, a bin; a bus stop and a bench on some
  for (const [sx, sz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const off = (BLK - 4) / 2 + 1.0;
    for (let t = -10; t <= 10; t += 10) {
      const px = cx + sx * (off + 0.55) + (sx === 0 ? t : 0), pz = cz + sz * (off + 0.55) + (sz === 0 ? t : 0);
      streetProps.push({ x: px, z: pz, type: t === 0 ? "tree" : "lamp" });
    }
  }
  if ((i + j) % 3 === 1) {
    const bx = cx + 6, bz = cz - (BLK - 4) / 2 - 1.5;
    streetProps.push({ x: bx, z: bz, type: "busstop" });
    for (const l of [-0.6, 0, 0.6]) seats.push({ x: bx + 2 + l, y: 0.15, z: bz + 0.3, face: Math.PI, kind: "bench" });
    streetProps.push({ x: bx + 2, z: bz + 0.3, type: "bench" });
  }
}
const A = {
  lots, streetProps, root: null, minX: lines[0], maxX: lines[N], minZ: lines[0], maxZ: lines[N], roads: [], regions: [],
  districts: KINDS.map((kind) => ({ kind })),
  officeLot: (l) => !!l.office,
  groundHeightAt: () => 0.15,
};
CBZ.city = { arena: A };
CBZ.propSeats = seats;
// the full-rig seam, as thin as peds.js's contract: a rig walks to its
// moveOrder (so promotion, the follow and the hand-back are exercised)
const vec = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
A.root = { add() {} };
CBZ.cityPeds = [];
CBZ.cityMakePed = (x, z, r, o) => ({ pos: vec(), target: vec(), group: { rotation: { y: 0 }, visible: true }, char: {},
  hp: 100, maxHp: 100, state: "walk", gender: o.gender, child: o.age != null });
updaters.push({ order: 34, fn(dt) {
  for (const p of CBZ.cityPeds) {
    const o = p.moveOrder; if (!o || p._parked) continue;
    const dx = o.x - p.pos.x, dz = o.z - p.pos.z, d = Math.hypot(dx, dz), st = Math.min(d, (o.speed || 0) * dt);
    if (d > 1e-3 && st > 0) { p.pos.x += dx / d * st; p.pos.z += dz / d * st; p.group.rotation.y = Math.atan2(dx, dz); }
  }
} });
// the player on a downtown corner
CBZ.player = { pos: { x: lines[3] + 10, y: 0.15, z: lines[3] + 10 } };

for (const f of ["src/city/zoning.js", "src/entities/crowdstore.js", "src/city/streetlife.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f });
}
const SL = CBZ.streetLife;
if (!SL) throw new Error("streetlife did not load");

const fails = [];
function check(ok, msg) { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) fails.push(msg); }

const DT = 1 / 30;
let slotMax = 0, slotN = 0, slotOver = 0, inside = 0, insideAt = null, samples = 0;
let rowsMin = 1e9, rowsMax = 0, groupedMin = 1, last = null, crossSeen = 0, waitSeen = 0, standSeen = 0, rigsMax = 0;
const t0 = performance.now();
for (let step = 0; step < 120 / DT; step++) {
  simT += DT; CBZ.now = simT * 1000;
  for (const u of updaters) u.fn(DT);
  if (simT < 20 || step % 15) continue;          // warm up, then sample twice a second
  samples++;
  for (const m of SL.inspect()) {
    if (m.life !== 1) continue;
    for (const b of buildings) {
      if (m.x > b.minX && m.x < b.maxX && m.z > b.minZ && m.z < b.maxZ) { inside++; insideAt = insideAt || m; }
    }
    // walking (WALK, CROSS) in a group: within 2 m of the slot
    if (m.n > 1 && (m.mode === SL.MODE.WALK || m.mode === SL.MODE.CROSS)) {
      const d = Math.hypot(m.x - m.sx, m.z - m.sz);
      slotN++; if (d > slotMax) slotMax = d; if (d > 2) slotOver++;
    }
  }
  const a = SL.audit();
  last = a;
  rowsMin = Math.min(rowsMin, a.rows); rowsMax = Math.max(rowsMax, a.rows);
  groupedMin = Math.min(groupedMin, a.grouped);
  crossSeen += a.crossing; waitSeen += a.waiting; standSeen += a.standing;
  rigsMax = Math.max(rigsMax, a.rigs);
}
const ms = performance.now() - t0;
const B = SL.budget();
console.log("streetlife: downtown noon, tablet budget", JSON.stringify({ rows: B.rows, rigs: B.rigs, radius: B.radius }));
console.log("  audit", JSON.stringify(last));
console.log(`  ${samples} samples, rows ${rowsMin}..${rowsMax}, grouped >= ${groupedMin}, slot max ${slotMax.toFixed(2)} m over ${slotN} member-samples (${slotOver} > 2 m), ` +
  `waiting ${waitSeen}, crossing ${crossSeen}, standing ${standSeen}, sim ${(ms / 120).toFixed(2)} ms per simulated second`);
check(last.target >= 150, `a downtown block at noon wants hundreds on the street (target ${last.target})`);
check(rowsMin >= Math.min(last.target, B.rows) * 0.85 && rowsMax <= B.rows, `street rows within the target and the tablet budget (${rowsMin}..${rowsMax}, target ${last.target}, cap ${B.rows})`);
check(groupedMin >= 0.55, `at least 55% of people in groups (min ${groupedMin})`);
check(last.solo >= 0.3 && last.solo <= 0.45, `solo walkers 30-45% (${last.solo})`);
check(slotN > 1000 && slotMax <= 2.0, `walking members within 2 m of their slots (max ${slotMax.toFixed(2)} m)`);
check(inside === 0, `nobody inside a building footprint (${inside}${insideAt ? " e.g. " + JSON.stringify(insideAt) : ""})`);
check(waitSeen > 0 && crossSeen > 0, "groups wait at the kerb and cross on the signal");
check(rigsMax > 0 && rigsMax <= B.rigs + B.kids, `the nearest are promoted to full rigs inside the budget (peak ${rigsMax}, budget ${B.rigs}+${B.kids} kids)`);
check(standSeen > 0 && Object.keys(last.kinds).length >= 6, `standing groups and a mix of kinds (${Object.keys(last.kinds).join(", ")})`);

// ---- a planned city (city/metroplan.js blocks with their own footways): walk
// there; the downtown street goes home behind you and the metro's fills
const MX = 3000, blocks = [];
for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
  const x0 = MX + i * 96, z0 = j * 96, core = i > 1 && i < 4 && j > 1 && j < 4;
  blocks.push({ x0, x1: x0 + 80, z0, z1: z0 + 80, use: core ? "cbd" : (i + j) % 3 ? "midtown" : "rows", sw: core ? 4.5 : 3.2, L: core ? 0.95 : 0.6 });
}
CBZ.metroCities = [{ id: "testmetro", name: "Testport", plan: { bounds: { minX: MX - 10, maxX: MX + 590, minZ: -10, maxZ: 590 }, blocks,
  parks: [{ x0: MX + 96 * 5, x1: MX + 96 * 5 + 80, z0: 0, z1: 80 }], trees: [{ x: MX + 2, z: 40 }] } }];
CBZ.player.pos.x = MX + 280; CBZ.player.pos.z = 280;
let metroInside = 0;
for (let step = 0; step < 40 / DT; step++) {
  simT += DT; CBZ.now = simT * 1000;
  for (const u of updaters) u.fn(DT);
  if (step % 30) continue;
  for (const m of SL.inspect()) for (const b of blocks) {
    const s = b.sw;   // the buildings stand behind the footway
    if (m.x > b.x0 + s && m.x < b.x1 - s && m.z > b.z0 + s && m.z < b.z1 - s) metroInside++;
  }
}
const am = SL.audit();
console.log("  metro", JSON.stringify({ target: am.target, rows: am.rows, grouped: am.grouped, sites: SL.sites() }));
check(am.rows >= Math.min(am.target, B.rows) * 0.85 && am.target >= 150 && am.grouped >= 0.55, `a planned city's blocks fill the same way (${am.rows} of ${am.target}, ${am.grouped} grouped)`);
check(metroInside === 0, `nobody inside a metro block's buildings (${metroInside})`);
if (fails.length) { console.log(`streetlife-check: ${fails.length} FAILED`); process.exit(1); }
console.log("streetlife-check: PASS");
