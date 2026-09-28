#!/usr/bin/env node
// tools/check-blast-aftermath.mjs — plain-node check of THE ONE EXPLOSION's
// pure half (city/crashfx.js, CBZ.blastFxPure). No browser, no THREE.
//   1. the kind -> look table: every row complete, every alias lands on a row,
//      and the proportions say what they claim (a grenade is dust and
//      fragments, a car is a tall fuel ball, the heli ember leaves nothing).
//   2. the persistent-mark ledger never exceeds its cap across hundreds of
//      blasts, never hands out a slot twice, merges overlapping blasts into
//      one growing mark and retires the OLDEST past the cap.
//   3. the flash light pool makes exactly ONE light across 20 blasts
//      (overlapping and not), keeps the brighter peak when blasts overlap,
//      and is dark again ~0.26 s after the last one.
//   4. the distance curves: shake falls off monotonically to nothing, sound
//      is late by d/343 s past 40 m.
//   5. static: crashfx.js constructs exactly one PointLight and never removes
//      a light from the scene.
// Run: node tools/check-blast-aftermath.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(path.join(root, "src/city/crashfx.js"), "utf8");

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.log("FAIL " + msg); } }

// load the file with a window that has a CBZ and no THREE: the pure block
// runs, the render block returns at its own guard
const win = { CBZ: {} };
const ctx = vm.createContext({ window: win, console, Math, Object, Number, Array });
vm.runInContext(src, ctx, { filename: "crashfx.js" });
const X = win.CBZ.blastFxPure;
ok(!!X, "CBZ.blastFxPure exists without THREE");
if (!X) { console.log("blast-aftermath: FAIL (pure block missing)"); process.exit(1); }

// ---- 1. kinds ----------------------------------------------------------------
const FIELDS = ["fire", "core", "fireSize", "rise", "smoke", "tone", "dust", "frag", "sparks", "embers",
  "dirK", "column", "mushroom", "fires", "fireDur", "decal", "light", "surface"];
for (const [name, row] of Object.entries(X.KINDS)) {
  for (const f of FIELDS) ok(f in row, `kind ${name} missing ${f}`);
  ok(Object.isFrozen(row), `kind ${name} is frozen (shared, never mutated by a blast)`);
  ok(Array.isArray(row.tone) && row.tone.length === 3 && row.tone.every((v) => v >= 0 && v <= 1), `kind ${name} tone`);
  ok(row.fireDur[0] > 0 && row.fireDur[1] >= row.fireDur[0], `kind ${name} fireDur`);
  ok(row.column >= 0 && row.column <= 60, `kind ${name} column seconds in 0..60`);
}
for (const [a, t] of Object.entries(X.ALIAS)) ok(!!X.KINDS[t], `alias ${a} -> ${t} exists`);
const K = X.KINDS;
ok(X.blastKind("carcook") === K.car, "carcook (impactbus row) draws as car");
ok(X.blastKind("airstrike") === K.heavy && X.blastKind("jdam") === K.heavy, "heavy ordnance rows draw heavy");
ok(X.blastKind("crashAirliner") === K.aircraft, "aircraft crash rows draw aircraft");
ok(X.blastKind(undefined) === K.blast && X.blastKind("nonsense") === K.blast, "unknown kind falls back to the plain blast");
ok(X.kindName("kinetic") === "impact", "kindName resolves aliases");
ok(K.grenade.fire < K.rpg.fire && K.grenade.dust > K.rpg.dust && K.grenade.frag > K.rpg.frag, "grenade: less fire, more dust + fragments than an RPG");
ok(K.car.rise > K.rpg.rise && K.car.fire > K.rpg.fire, "car: a taller, bigger fuel fireball");
ok(K.car.tone[0] < K.rpg.tone[0], "car smoke is blacker (oil)");
ok(K.c4.dirK > K.rpg.dirK, "c4 throws itself along its normal harder than a rocket");
ok(K.heavy.mushroom && !K.rpg.mushroom, "only heavy/aircraft columns mushroom");
ok(K.rpg.column >= 20 && K.rpg.column <= 40 && K.c4.column >= 20 && K.c4.column <= 40, "RPG/C4 smoke columns linger 20-40 s");
ok(K.ember.decal === 0 && K.ember.fires === 0 && K.ember.column === 0, "the heli ember leaves no aftermath");

// ---- 2. the mark ledger ------------------------------------------------------
{
  const CAP = 24, L = X.makeDecalLedger(CAP);
  let s = 12345; const r = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  let adds = 0, merges = 0, evictions = 0, maxLive = 0;
  for (let i = 0; i < 400; i++) {
    const res = L.place((r() - 0.5) * 600, (r() - 0.5) * 600, 1 + r() * 5, (r() * 4) | 0, r() * 6);
    if (res.op === "add") adds++; else merges++;
    if (res.evicted) evictions++;
    maxLive = Math.max(maxLive, L.live.length);
    const slots = L.live.map((d) => d.slot);
    ok(new Set(slots).size === slots.length, `blast ${i}: a slot handed out twice`);
    ok(slots.every((q) => q >= 0 && q < CAP), `blast ${i}: slot out of range`);
  }
  ok(maxLive <= CAP, `ledger never exceeds its cap (max ${maxLive}/${CAP})`);
  ok(L.live.length === CAP && evictions === adds - CAP, `past the cap every add retires one (adds ${adds}, evictions ${evictions})`);

  const M = X.makeDecalLedger(4);
  const a = M.place(0, 0, 3, 0, 0).rec;
  const r1 = a.r;
  const m = M.place(0.8, 0.2, 3, 1, 0);
  ok(m.op === "merge" && m.rec === a && M.live.length === 1, "an overlapping blast merges into the existing mark");
  ok(a.r > r1 && a.r <= r1 * 1.45 + 1e-9, `the merged mark grows, bounded (${r1} -> ${a.r.toFixed(2)})`);
  M.place(50, 0, 2, 0, 0); M.place(100, 0, 2, 0, 0); M.place(150, 0, 2, 0, 0);
  M.place(0.5, 0, 2, 0, 0);                 // refreshes `a` (now the newest)
  const ev = M.place(200, 0, 2, 0, 0);
  ok(ev.evicted && ev.evicted.x === 50, "past the cap the OLDEST mark retires (a refreshed mark is kept)");
  ok(ev.rec.slot === ev.evicted.slot, "the new mark takes the retired mark's instance slot");
  const W = X.makeDecalLedger(4);
  W.place(0, 0, 2, 0, 0, 1.5); const hi = W.place(0, 0, 2, 0, 0, 9.0);
  ok(hi.op === "add" && W.live.length === 2, "wall soot two storeys apart does not merge (3D distance)");
  const gone = W.live[0], gslot = gone.slot;
  ok(W.remove(gone) && W.live.length === 1 && !W.remove(gone), "remove() drops a mark once");
  ok(W.place(300, 0, 1, 0, 0, 0).rec.slot === gslot, "a removed mark's slot is reused");
  W.clear();
  ok(W.live.length === 0 && W.place(0, 0, 1, 0, 0).rec.slot === 0, "clear() frees every slot");
}

// ---- 3. the ONE flash light --------------------------------------------------
{
  let made = 0;
  const light = { intensity: 0, distance: 0, position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } } };
  const F = X.makeFlashPool(() => { made++; return light; }, 0.26);
  F.init();
  ok(made === 1 && light.intensity === 0, "light made once at init, idle at intensity 0");
  let t = 0, peakSeen = 0;
  for (let i = 0; i < 20; i++) {
    const pk = 2 + (i % 5);
    F.flash(i * 10, 1, 0, pk, 30);
    ok(light.intensity >= pk - 1e-9, `blast ${i}: light spikes to at least its peak`);
    ok(light.position.x === i * 10, `blast ${i}: light moves to the newest blast`);
    peakSeen = Math.max(peakSeen, light.intensity);
    // half the blasts overlap (0.05 s apart), half let the light go dark
    const gap = i % 2 ? 0.05 : 0.5;
    for (let s = 0; s < gap; s += 1 / 60) { F.step(1 / 60); t += 1 / 60; }
  }
  ok(made === 1, `20 blasts made ${made} light(s): must be exactly 1`);
  ok(F.made() === 1, "pool reports one light");
  for (let s = 0; s < 0.4; s += 1 / 60) F.step(1 / 60);
  ok(light.intensity === 0 && F.level() === 0, "dark again after the decay");
  // overlap keeps the brighter peak
  F.flash(0, 0, 0, 8, 30); F.step(0.01); F.flash(5, 0, 0, 2, 30);
  ok(light.intensity >= 7.9, `an overlapping weaker blast keeps the brighter peak (${light.intensity.toFixed(2)})`);
  let prev = Infinity, mono = true;
  for (let s = 0; s < 0.3; s += 1 / 60) { const v = F.step(1 / 60); if (v > prev + 1e-9) mono = false; prev = v; }
  ok(mono, "the decay never brightens");
}

// ---- 4. distance curves ------------------------------------------------------
{
  const R = 24.7;   // the RPG row: 13 * 1.9
  ok(Math.abs(X.shakeAtten(0, R) - 1) < 1e-9, "shake is full at the seat");
  let prev = 2, mono = true;
  for (let d = 0; d <= 400; d += 5) { const v = X.shakeAtten(d, R); if (v > prev + 1e-12) mono = false; prev = v; }
  ok(mono, "shake falls off monotonically");
  ok(X.shakeAtten(40, R) > 0.4 && X.shakeAtten(40, R) < 0.8, `shake at 40 m is partial (${X.shakeAtten(40, R).toFixed(2)})`);
  ok(X.shakeAtten(300, R) === 0, "nothing shakes from 300 m");
  ok(X.soundDelay(10) === 0 && Math.abs(X.soundDelay(343) - 1) < 1e-9 && X.soundDelay(1e5) === 6, "sound: none close, d/343 far, capped at 6 s");
}

// ---- 5. static: one light, never removed -------------------------------------
{
  const lights = (src.match(/new THREE\.PointLight\(/g) || []).length;
  ok(lights === 1, `crashfx.js constructs ${lights} PointLight(s): must be exactly 1 (the pooled flash)`);
  ok(!/scene\.remove\([^)]*[Ll]ight/.test(src), "crashfx.js never removes a light from the scene");
  ok(/flashPool\.init\(\)/.test(src), "the flash light is created at load (prewarm), not on the first blast");
}

console.log(`blast-aftermath: ${fails ? "FAIL" : "PASS"} (${checks} checks, ${fails} failed)`);
process.exit(fails ? 1 : 0);
