/* tools/lib/infantry-node.mjs — THE INFANTRY CORE IN NODE, with nothing else.

   src/battle/core/infantry.js is page-free: this loads it with the files it
   reads (weapons/ballistics.js, systems/armour.js, the weapon table, the
   unit store, the countries table) into one vm context and hands back the
   pieces every infantry tool needs:

     ctx()                     the context (CBZ.*)
     field(o)                  a ground: { flat | rolling | folds }, seeded,
                               turned 180 degrees about its centre so both
                               starts are the same ground
     side(country, o)          a unit spec off a real country row: its rifle,
                               optic, training, plates and helmet
     battle(o)                 a store + an infantry sim on a field, armies laid
                               out by o.place(side, i) -> {x, z, h}
   The tools (tools/npcwar-duel-check.mjs, npcwar-squad-check.mjs,
   npcwar-scale-bench.mjs) build on these. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const FILES = ["src/weapons/weapon-data.js", "src/weapons/ballistics.js", "src/systems/armour.js", "src/systems/brain.js",
  "src/battle/core/store.js", "src/battle/core/countries.js", "src/battle/core/infantry.js"];
let SB = null;
export function ctx() {
  if (SB) return SB;
  // (no Math, Date, typed arrays from this realm: a context has its own, and a
  // cross-realm builtin is a call V8 will not inline: 10-20x slower sight lines)
  const sb = { console, performance: globalThis.performance, setTimeout, clearTimeout };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  /* HARNESS TRAP: inside a vm context every read of a global (Math, Infinity,
     Float32Array) goes through the sandbox's interceptor, ~100 ns a time: a
     sight-line loop ran 10-20x slower than the same file in a browser or in
     node's own realm. Each file (all of them are IIFEs that publish on CBZ)
     runs inside a wrapper that binds those names as locals: the code is the
     game's, unchanged; only the lookups are a browser's. */
  const NAMES = ["Math", "Infinity", "NaN", "Float32Array", "Float64Array", "Int32Array", "Int16Array", "Uint8Array", "Uint16Array", "Uint32Array",
    "Object", "Array", "JSON", "Number", "String", "isFinite", "isNaN", "parseInt", "parseFloat", "Error"];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    const wrapped = "(function (" + NAMES.join(", ") + ") {\n" + src + "\n}).call(this, " + NAMES.join(", ") + ");";
    try { vm.runInContext(wrapped, sb, { filename: f }); }
    catch (e) { if (!/weapon-data/.test(f)) throw e; }
  }
  SB = sb;
  return sb;
}

// value noise, seeded
function noise2(seed) {
  const P = new Uint32Array(512);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < 512; i++) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; P[i] = s; }
  const h = (ix, iz) => (P[(ix & 255) + P[iz & 255] % 256] & 0xffff) / 65535;
  return (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = h(ix, iz), b = h(ix + 1, iz), c = h(ix, iz + 1), d = h(ix + 1, iz + 1);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  };
}
/* A FIELD. kind:
     flat      a billiard table (the control: nothing to hide behind)
     rolling   open ground: long swells (1-2 m over 80-150 m) and the
               micro-relief a prone man uses (0.2-0.5 m over 6-15 m)
     folds     broken ground: the rolling field plus 2-3 m folds every ~40 m
   Every field is f(x, z) + f(-x, -z) about its centre: a turn, so each
   start line gets the same ground. */
export function field(o) {
  o = o || {};
  const kind = o.kind || "rolling", seed = o.seed || 1, half = o.half || 700, cell = o.cell || 1.5;
  const n1 = noise2(seed * 7 + 1), n2 = noise2(seed * 13 + 5), n3 = noise2(seed * 29 + 11);
  const f = (x, z) => {
    if (kind === "flat") return 0;
    let h = (n1(x / 120, z / 120) - 0.5) * 2.6 + (n2(x / 11, z / 11) - 0.5) * 0.7 + (n3(x / 5, z / 5) - 0.5) * 0.25;
    if (kind === "folds") h += (n3(x / 38 + 50, z / 38 + 50) - 0.5) * 5.0;
    return h;
  };
  const w = Math.ceil(half * 2 / cell) + 1, hgt = new Float32Array(w * w);
  for (let iz = 0; iz < w; iz++) for (let ix = 0; ix < w; ix++) {
    const x = -half + ix * cell, z = -half + iz * cell;
    hgt[iz * w + ix] = (f(x, z) + f(-x, -z)) * 0.5;
  }
  return { x0: -half, z0: -half, cell, w, h: w, hgt };
}

/* A SIDE off a real country (battle/core/countries.js): its rifle, its
   sight, its training, its plates and helmet. o.trn / o.gun / o.optic
   override (a mirror match, a what-if). */
export function side(country, o) {
  o = o || {};
  const CBZ = ctx().CBZ, C = CBZ.countries;
  const R = C && C.get(country);
  const rifle = R ? R.rifle : { gun: "ak47" };
  const trn = o.trn || (R ? R.training : "pro");
  return {
    trn: trn,
    gun: o.gun || rifle.gun,
    optic: o.optic != null ? o.optic : (rifle.optic || 0),
    // the armour the page's rig would wear (CBZ.battleInfantry.kitFor -> CBZ.armour.kitSpec)
    kit: o.noKit ? {} : CBZ.battleInfantry.kitFor(R ? R.kit : null, trn, !!R),
  };
}

/* A BATTLE. o = { ground, seed, a: spec, b: spec, na, nb, place(side, i) -> {x,z,h},
   order: [o0, o1] }. Squads of ten, in spawn order. */
export function battle(o) {
  const sb = ctx(), CBZ = sb.CBZ;
  const n = (o.na || 1) + (o.nb || 1);
  const S = CBZ.battleStore.create(n + 16);
  const I = CBZ.battleInfantry.create(S, { ground: o.ground, cover: o.cover || null, seed: o.seed || 1 });
  const ta = I.unitType(o.a), tb = I.unitType(o.b);
  let sqId = 0;
  for (let s = 0; s < 2; s++) {
    const N = s ? (o.nb || 1) : (o.na || 1);
    const base = sqId;
    for (let i = 0; i < N; i++) {
      const r = S.alloc(s, "man");
      const p = o.place(s, i);
      S.cols.x[r] = p.x; S.cols.z[r] = p.z; S.cols.heading[r] = p.h;
      I.add(r, s ? tb : ta, N > 1 ? base + ((i / 10) | 0) : -1, i % 10, s);
    }
    sqId = base + Math.ceil(N / 10);
  }
  if (o.order) { I.order[0] = o.order[0]; I.order[1] = o.order[1]; }
  return { S, I };
}
// how a side stands: men who can still fight
export function standing(B, side) {
  const C = B.S.cols;
  let n = 0;
  for (let r = 0; r < B.S.rows; r++) if (C.side[r] === side && C.life[r] === 1 && !C.down[r]) n++;
  return n;
}
