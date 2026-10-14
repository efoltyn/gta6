// node tools/placement-check.js — CBZ.placement (typed-array store + linked
// cell lists, city/placement.js) answers isFree exactly like a brute-force
// scan of every live reservation, through reserves, zone-only queries, Y
// bands, stackables, degenerate rects, stream-job drops (the free list
// reuses ids) and a reset. Plain node, no browser.
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "../src/city/placement.js"), "utf8");
const hooks = [];
const win = { CBZ: { streamBusHook: (h) => hooks.push(h), colliders: [] }, THREE: {} };
win.window = win;
vm.runInNewContext(src, win);
const P = win.CBZ.placement, hook = hooks[0];

// the reference: the rules isFree documents, over a plain list
let live = [];
function overlaps(a, b) {
  if (!(a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ)) return false;
  const aMinY = a.minY != null ? a.minY : -Infinity, aMaxY = a.maxY != null ? a.maxY : Infinity;
  const bMinY = b.minY != null ? b.minY : -Infinity, bMaxY = b.maxY != null ? b.maxY : Infinity;
  return aMinY < bMaxY && aMaxY > bMinY;
}
function refFree(rect, opts) {
  const zone = rect.zone || null, zoneOnly = !!(opts && opts.zoneOnly);
  for (const r of live) {
    // (the hash only visits cells a rect touches: a rect is in no cell when its bounds are NaN)
    if (!(Math.floor(r.minX / 8) <= Math.floor(r.maxX / 8) && Math.floor(r.minZ / 8) <= Math.floor(r.maxZ / 8))) continue;
    if (rect.stackable && r.stackable) continue;
    const rz = r.zone || null;                  // (reserve stores a falsy zone as none)
    if (zoneOnly && zone != null && rz != null && rz !== zone) continue;
    if (overlaps(rect, r)) return false;
  }
  return true;
}
let seed = 90210; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
const zones = [null, "world", "nature", "a", ""];
function rect() {
  const x = (rnd() - 0.5) * 1500, z = (rnd() - 0.5) * 1500;
  const w = rnd() < 0.05 ? rnd() * 300 : rnd() * 12, d = rnd() < 0.05 ? rnd() * 300 : rnd() * 12;
  const r = { minX: x, maxX: x + w, minZ: z, maxZ: z + d, stackable: rnd() < 0.2, zone: zones[(rnd() * zones.length) | 0] };
  if (rnd() < 0.2) { r.minY = rnd() * 10; r.maxY = r.minY + rnd() * 10; }
  if (rnd() < 0.03) r.minX = r.maxX = x;
  if (rnd() < 0.01) { r.minX = -2e5; r.maxX = -2e5 + 30; }     // past the small-integer cell keys
  return r;
}
let bad = 0, n = 0;
for (let round = 0; round < 8; round++) {
  if (round === 6) { P.reset(); live = []; }
  const m = hook.mark(), mine = [];
  for (let i = 0; i < 2500; i++) { const r = rect(); P.reserve(r); mine.push(r); live.push(r); }
  for (let i = 0; i < 3000; i++) {
    const r = rect(), zo = rnd() < 0.3 ? { zoneOnly: true } : undefined;
    n++; if (P.isFree(r, zo) !== refFree(r, zo)) bad++;
  }
  if (round % 2 === 1) { hook.drop(hook.since(m)); const gone = new Set(mine); live = live.filter((r) => !gone.has(r)); }
  if (P.snapshot().length !== live.length) { console.log("snapshot length", P.snapshot().length, "!= live", live.length); bad++; }
}
const st = P.stats();
console.log(`placement: ${n} isFree queries vs brute force, ${bad} mismatches; store ${JSON.stringify(st)}`);
if (bad) { console.log("PLACEMENT FAIL"); process.exit(1); }
console.log("PLACEMENT OK");
