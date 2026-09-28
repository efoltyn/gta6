#!/usr/bin/env node
/* tools/vitals-check.mjs — THE ONE INJURY MODEL (systems/vitals.js), IN PLAIN NODE.

   What the owner asked for, as numbers:
     1. fists knock a man OUT, they do not kill him: a flurry to the head ends
        in "ko", never "dead", and opens no bleed (no hole from a punch);
     2. a KO lasts a real time (12-30 s) and he comes to GROGGY, then "ok";
     3. only a long beating of a man who is already out kills him (>= 15 blows);
     4. a leg round bleeds and weakens but a graze does not kill; a femoral
        empties him inside ~70 s; the head kills outright;
     5. a bandage all but stops a limb bleed and he survives;
     6. a man whose hp ran out (critical) is "down" awake, bleeds out unwrapped;
     7. a corpse takes unlimited wounds: 200 rounds, no throw, bounded list,
        the pool grows to its cap and stops;
     8. the taser: "tased", cuffable, then back to "ok".

     node tools/vitals-check.mjs     exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../src/systems/vitals.js", import.meta.url), "utf8");
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL: " + m); } else console.log("ok   " + m); };

function world(seedSeq) {
  const pools = [], drips = [];
  const ctx = { console, Math };
  ctx.window = ctx;
  const CBZ = ctx.CBZ = {
    game: { mode: "escape", state: "playing" },
    player: { pos: { x: 0, y: 0, z: 0 }, hp: 100 },
    gorePool: (x, z, g) => pools.push(g),
    goreDrip: () => drips.push(1),
    aiKill: (a) => { a.dead = true; a.hp = 0; },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const V = CBZ.vitals;
  let i = 0;
  V.rng = seedSeq ? () => seedSeq[(i++) % seedSeq.length] : (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  // the games' own movers count a.ko down; nobody here is "safe" to wrap
  // himself unless a test says so (an NPC who is safe does it on his own)
  V.on("*", { safe: () => !!ctx.safe });
  const run = (secs) => {
    for (let t = 0; t < secs; t += 1 / 30) {
      V.tick(1 / 30);
      for (const m of MEN) if (m.ko > 0) m.ko = Math.max(0, m.ko - 1 / 30);
    }
  };
  return { CBZ, V, run, pools, drips, ctx };
}
const MEN = [];
const man = () => { const m = { pos: { x: 0, y: 0, z: 0 }, hp: 100, ko: 0 }; MEN.push(m); return m; };

// 1 + 2: fists
{
  const { V, run } = world();
  const a = man();
  let out = "", n = 0;
  for (; n < 40 && out !== "ko"; n++) { out = V.blunt(a, { zone: n % 3 === 0 ? "jaw" : "head", power: 0.75, weapon: "fist" }); run(0.6); }
  ok(out === "ko" && V.state(a) === "ko", `fists knock him out (${n} blows), state=${V.state(a)}`);
  ok(n >= 3, "not on the first punch");
  ok(V.bleedRate(a) === 0 && !a.dead, "a punch opens no bleed and kills nobody");
  let koT = 0; while (V.state(a) === "ko" && koT < 60) { run(0.5); koT += 0.5; }
  ok(koT >= 11 && koT <= 31, `out for a real time: ${koT.toFixed(1)} s`);
  ok(V.weak(a) > 0.2, "comes to groggy (weak " + V.weak(a).toFixed(2) + ")");
  run(15);
  ok(V.state(a) === "ok" && V.weak(a) < 0.05, "and then he is fine");
}
// 3: beating a man who is out
{
  const { V, run } = world();
  const a = man();
  V.ko(a, 20);
  let n = 0;
  while (!a.dead && n < 400) { V.blunt(a, { zone: "head", power: 0.7, weapon: "fist" }); n++; run(0.5); if (!a.dead && V.state(a) !== "ko") V.ko(a, 20); }
  ok(a.dead && n >= 15, `only a long beating of a man who is out kills him (${n} blows)`);
}
// 4: rounds
{
  const { V, run } = world([0.99, 0.99, 0.99]);          // no artery, no heart
  const a = man();
  const r = V.wound(a, { kind: "bullet", zone: "legL", cal: 1 });
  ok(r.outcome === "ok" && V.bleedRate(a) > 0, "a leg round bleeds");
  run(20);
  ok(V.weak(a) >= 0 && V.blood(a) < 1 && V.speedMul(a) < 1, "he is slower (" + V.speedMul(a).toFixed(2) + ")");
  run(300);
  ok(!a.dead, "a plain leg wound does not kill (blood " + V.blood(a).toFixed(2) + ")");
}
{
  const { V, run } = world([0.01]);                        // the femoral
  const a = man();
  V.wound(a, { kind: "bullet", zone: "legR", cal: 1 });
  let t = 0; while (!a.dead && t < 200) { run(1); t++; }
  ok(a.dead && t <= 75, `a femoral bleeds him out in ${t} s`);
}
{
  const { V } = world([0.5]);
  const a = man();
  const r = V.wound(a, { kind: "bullet", head: true, cal: 1 });
  ok(r.outcome === "dead" && a.dead, "a round through the head kills outright");
}
// 5: a bandage
{
  const { V, CBZ, run } = world([0.01]);
  const a = man();
  V.wound(a, { kind: "bullet", zone: "legR", cal: 1 });
  run(8);
  const before = V.bleedRate(a);
  CBZ.vitals.giveBandage(1);
  const P = CBZ.player;
  ok(V.bandage(P, P) === false, "the player cannot wrap what is not bleeding");
  ok(V.bandage(a, a, { roll: true }), "an NPC starts wrapping his leg");
  ok(V.busy(a), "and holds still while he does it");
  run(5);
  ok(V.bleedRate(a) < before * 0.1, `the wrap all but stops it (${(before * 1000).toFixed(2)} -> ${(V.bleedRate(a) * 1000).toFixed(2)} permille/s)`);
  run(200);
  ok(!a.dead, "and he lives (blood " + V.blood(a).toFixed(2) + ")");
}
{
  const { V, CBZ, run } = world([0.99]);
  const P = CBZ.player;
  V.wound(P, { kind: "stab", zone: "armL" });
  ok(V.bandage(P, P) === false, "no roll, no bandage for the player");
  V.giveBandage(2);
  ok(V.bandage(P, P), "with a roll he starts");
  run(1); V.blunt(P, { zone: "body", power: 0.5 }); run(0.2);
  ok(V.bandaging(P) < 0, "a hit interrupts it");
  ok(V.bandage(P, P), "starts again");
  run(5);
  ok(V.bandages() === 1 && V.unbandaged(P) === 0, "done: one roll used, the arm wrapped");
}
{
  const { V, run, ctx } = world([0.99]);
  const a = man();
  V.wound(a, { kind: "bullet", zone: "armR", cal: 1 });
  ctx.safe = true;
  run(V.K.SAFE_T + V.K.BAND_CLOTH + 1);
  ok(V.unbandaged(a) === 0, "an NPC who is safe tears his shirt and wraps himself");
}
// 6: critical
{
  const { V, run } = world([0.99]);
  const a = man();
  const r = V.wound(a, { kind: "bullet", zone: "abdomen", cal: 1, critical: true });
  ok(r.outcome === "down" && V.state(a) === "down" && V.cuffable(a), "hp gone, nothing vital: down, awake, cuffable");
  let t = 0; while (!a.dead && t < 400) { run(1); t++; if (V.busy(a)) V.cancelBandage(a); }
  ok(a.dead && t > 20, `unwrapped he bleeds out (${t} s)`);
}
// 7: the corpse
{
  const { V, run, pools } = world();
  const a = man(); a.dead = true;
  let threw = false;
  try { for (let i = 0; i < 200; i++) { V.wound(a, { kind: i % 2 ? "stab" : "bullet", zone: "chest" }); run(0.3); } } catch (e) { threw = e; }
  ok(!threw, "200 rounds and stabs into a corpse: no throw" + (threw ? " " + threw : ""));
  ok(V.peek(a).bleeds.length <= 24, "the bleed list stays bounded (" + V.peek(a).bleeds.length + ")");
  ok(pools.length >= 8 && pools.length <= V.K.POOL_CAP, `the pool grew in ${pools.length} layers to its cap`);
  ok(pools[pools.length - 1] > pools[0], "each layer bigger than the first");
}
// 8: taser
{
  const { V, run } = world();
  const a = man();
  V.tase(a, 5);
  ok(V.state(a) === "tased" && V.cuffable(a), "tased: down and cuffable");
  run(6);
  ok(V.state(a) === "ok", "then back up");
}
console.log(fails ? `\n${fails} FAIL` : "\nALL OK");
process.exit(fails ? 1 : 0);
