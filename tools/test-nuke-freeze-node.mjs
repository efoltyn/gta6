#!/usr/bin/env node
/*
  Renderer-free nuclear aftermath regression.

  This executes the real structural ledger and ordnance bus inside Node's V8
  `vm` context. There is deliberately no DOM, canvas, WebGL context or browser:
  the freeze under test is the gameplay state machine that starts behind the
  already-rendered white dome.
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, p), "utf8");
const impactSource = read("../src/systems/impactbus.js");
const structuralSource = read("../src/city/structural.js");
const crowdSource = read("../src/city/crowd.js");
const strategicSource = read("../src/city/strategic.js");

// Static contracts cover owners that cannot be meaningfully booted without
// their full actor/aircraft worlds.
// (The old assertion here pinned the ring wave's 5 Hz `tick: 0.20` cadence;
// the analytic nuclear field replaced polling with arrival-sorted rosters,
// so the honest contract is the field model plus its bounded drains.)
assert.match(impactSource, /wave: \{ model: "nuclear", speed: 343, maxR: 3276/,
  "nuclear wave must remain the analytic 1 psi / 343 m/s field");
assert.match(impactSource, /NUKE_DRAIN_BUDGET_MS == null\) CBZ\.CONFIG\.NUKE_DRAIN_BUDGET_MS = 5/,
  "nuclear drains must carry the per-frame millisecond budget");
assert.match(impactSource, /function drainOverBudget\(\)/,
  "nuclear drains must be time-bounded, not just item-bounded");
assert.match(impactSource, /defer: w\.kind === "nuke"/,
  "nuclear structure work must use the deferred ledger path");
assert.match(crowdSource, /CBZ\.cityCrowdAnnulusKill = function/,
  "crowd owner must expose a one-pass annulus query");

const copStart = strategicSource.indexOf("if (!nk.copsDone)");
const copEnd = strategicSource.indexOf("// (vehicles:", copStart);
assert.ok(copStart >= 0 && copEnd > copStart, "nuclear cop aftermath block must exist");
const copBlock = strategicSource.slice(copStart, copEnd);
assert.match(copBlock, /EXAMINE_CAP = 24/, "cop aftermath must cap roster work per frame");
assert.match(copBlock, /nk\.copI\+\+/, "each cop must receive one cursor-owned verdict");
assert.doesNotMatch(copBlock, /if\s*\(\s*seen\s*===\s*0/,
  "a surviving cop must not keep the full-roster scan alive for 24 seconds");

const stats = {
  lotReads: 0,
  pedReads: 0,
  carReads: 0,
  structureSweeps: 0,
  annulusSweeps: 0,
  circleSweeps: 0,
  carDamage: 0,
};

function countedArray(items, key) {
  return new Proxy(items, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && /^(0|[1-9]\d*)$/.test(prop)) stats[key]++;
      return Reflect.get(target, prop, receiver);
    },
  });
}

function radialRows(n, minR, maxR, make) {
  const out = [];
  const golden = 2.399963229728653;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    const r = minR + (maxR - minR) * Math.sqrt(f);
    const a = i * golden;
    out.push(make(i, Math.cos(a) * r, Math.sin(a) * r));
  }
  return out;
}

const lots = countedArray(radialRows(5000, 80, 3200, (i, x, z) => ({
  cx: x,
  cz: z,
  kind: "block",
  demolished: false,
  building: {
    ox: x,
    oz: z,
    w: 12,
    d: 12,
    h: 18,
    FH: 3,
    storeys: 6,
    // Kept structurally valid even though demolition is disabled in this
    // harness. The test exercises ledger admission and damage, not rendering.
    group: {},
    colliders: [{}],
  },
})), "lotReads");

const peds = countedArray(radialRows(2000, 30, 3250, (_i, x, z) => ({
  dead: false,
  pos: { x, y: 0, z },
})), "pedReads");

const cars = countedArray(radialRows(800, 30, 3250, (_i, x, z) => ({
  dead: false,
  pos: { x, y: 0, z },
  dims: { width: 2 },
})), "carReads");

const updates = [];
const CBZ = {
  CONFIG: {
    STRUCT_LEDGER: true,
    STRUCT_COLLAPSE_V1: false,
    STRUCT_FIRE: false,
    CITY_DEMOLITION: false,
    IMPACT_BUS: true,
    IMPACT_SHOCKWAVE: true,
    IMPACT_STRUCTURAL: true,
    IMPACT_CAR_BLAST: true,
  },
  game: { mode: "city" },
  city: { arena: { lots } },
  camera: { position: { x: 0, y: 20, z: 0 }, far: 1000 },
  cityPeds: peds,
  cityCars: cars,
  qScale: (_lo, hi) => hi,
  floorAt: () => 0,
  hash01: () => 0.99,                 // worst case: roster members survive and remain scannable
  nukeLethalAt: () => 0.40,
  onUpdate: (order, fn) => updates.push({ order, fn }),
  cityExplosion: () => {},
  cityAirstrikeExplosion: () => {},
  cityShatter: () => {},
  cityKillPed: () => {},
  cityDamageCar: () => { stats.carDamage++; },
  cityCrowdAnnulusKill: () => { stats.annulusSweeps++; },
  cityCrowdCircleKill: () => { stats.circleSweeps++; },
};

const sandbox = {
  console,
  performance,
  CBZ,
  THREE: {},
  __updates: updates,
  __stats: stats,
};
sandbox.window = sandbox;
const context = vm.createContext(sandbox, { name: "nuke-aftermath" });

vm.runInContext(structuralSource, context, {
  filename: "src/city/structural.js",
  timeout: 2000,
});

const realSweep = CBZ.structure.sweep;
CBZ.structure.sweep = function (...args) {
  stats.structureSweeps++;
  if (args[5] && args[5].kind === "nuke") {
    assert.equal(args[5].defer, true, "nuclear lot admission must be deferred");
  }
  return realSweep.apply(this, args);
};

vm.runInContext(impactSource, context, {
  filename: "src/systems/impactbus.js",
  timeout: 2000,
});

const started = performance.now();
vm.runInContext(`
  __updates.sort((a, b) => a.order - b.order);
  CBZ.detonate(0, 1, 0, "nuke", { quiet: true, byPlayer: false });
  let maxHitsInFrame = 0;
  let maxCarsInFrame = 0;
  let maxPending = 0;
  for (let frame = 0; frame < 24 * 60; frame++) {
    const before = CBZ.structure.damagedCount();
    const carsBefore = __stats.carDamage;
    for (let i = 0; i < __updates.length; i++) __updates[i].fn(1 / 60);
    const after = CBZ.structure.damagedCount();
    maxHitsInFrame = Math.max(maxHitsInFrame, after - before);
    maxCarsInFrame = Math.max(maxCarsInFrame, __stats.carDamage - carsBefore);
    maxPending = Math.max(maxPending, CBZ.structure.debug().waveHitsPending);
  }
  window.__result = {
    waveCount: CBZ.impact.waveCount(),
    waveState: CBZ.impact.waveState(),
    damaged: CBZ.structure.damagedCount(),
    pending: CBZ.structure.debug().waveHitsPending,
    maxHitsInFrame,
    maxCarsInFrame,
    maxPending,
  };
`, context, {
  filename: "nuke-aftermath-simulation.js",
  timeout: 5000,
});
const elapsedMs = performance.now() - started;
const result = context.__result;

assert.equal(result.waveCount, 0, "nuclear wave must finish rather than remain live");
assert.equal(result.pending, 0, "deferred structural work must drain completely");
// The rebuild bounded structural damage at the 2 psi contour (structR: 2016 m)
// instead of the 1 psi glass reach — window-breaking pressure no longer
// manufactures rubble. Of this stress world's 5,000 lots (spiral, 80-3,250 m),
// the ring inside 2,016 m holds 5000*(2016^2-80^2)/(3250^2-80^2) ~= 1,925 —
// and the ledger measures 1,923. The old `> 4000` pin described the removed
// 1 psi behaviour. Both bounds asserted so neither regression direction hides.
assert.ok(result.damaged > 1800 && result.damaged < 2100,
  `structural damage must fill the 2 psi contour (~1925 lots), got ${result.damaged}`);
assert.ok(result.maxHitsInFrame <= 8,
  `structural execution burst exceeded the high-tier budget: ${result.maxHitsInFrame}`);
assert.ok(result.maxCarsInFrame <= 24,
  `vehicle execution burst exceeded the established budget: ${result.maxCarsInFrame}`);
assert.ok(stats.carDamage > 500,
  `coarse nuclear bands silently skipped admitted cars: ${stats.carDamage}`);
// The 5 Hz polling wave is gone: the analytic field snapshots its rosters
// ONCE at compile (structure.radialTargets) and drains sorted arrivals, so
// zero periodic structure.sweep evaluations is the architecture, not a bug.
// (The old 80-90 band measured the retired ring wave's 17.2 s x 5 Hz poll.)
assert.equal(stats.structureSweeps, 0,
  `analytic nuclear field must never poll structure.sweep, got ${stats.structureSweeps}`);
assert.ok(stats.annulusSweeps >= 0 && stats.annulusSweeps < 90,
  `crowd annulus must stay a bounded pass, got ${stats.annulusSweeps}`);
assert.equal(stats.circleSweeps, 0,
  "shipping crowd owner must avoid the legacy six-disc fallback");
assert.ok(stats.lotReads < 5000 * 100,
  `lot roster exceeded the 5 Hz scan budget: ${stats.lotReads}`);
assert.ok(stats.pedReads < 2000 * 100,
  `ped roster exceeded the 5 Hz scan budget: ${stats.pedReads}`);
assert.ok(elapsedMs < 5000, `renderer-free aftermath exceeded hard budget: ${elapsedMs.toFixed(1)}ms`);

console.table({
  "wave evaluations": stats.structureSweeps,
  "one-pass crowd bands": stats.annulusSweeps,
  "legacy crowd discs": stats.circleSweeps,
  "lots damaged": result.damaged,
  "max structural hits/frame": result.maxHitsInFrame,
  "cars damaged": stats.carDamage,
  "max car hits/frame": result.maxCarsInFrame,
  "max queued hits": result.maxPending,
  "simulation wall time (ms)": +elapsedMs.toFixed(1),
});
console.log("nuke aftermath VM contract: OK (no DOM, canvas, WebGL, or browser)");
