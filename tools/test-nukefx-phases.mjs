#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../src/city/nukefx.js"), "utf8");
const crashfx = readFileSync(resolve(here, "../src/city/crashfx.js"), "utf8");
const impactbus = readFileSync(resolve(here, "../src/systems/impactbus.js"), "utf8");

function match(re, message) {
  assert.match(source, re, message);
}

match(
  /NUKE_FX_LEGACY_PUFFS == null\) CBZ\.CONFIG\.NUKE_FX_LEGACY_PUFFS = false/,
  "generic nuclear puff storm must default off"
);
match(
  /if \(legacyPuffs\) \{[\s\S]*?live\.genericPuffEvents = nSat \+ nSat2 \+ nTherm;/,
  "all decorative explosion receipts must live behind the legacy gate"
);
match(
  /if \(L\.legacyPuffs && t < L\.frontLife && r < L\.maxR\)/,
  "shock-front cityDustKick walker must live behind the legacy gate"
);
match(
  /NUKE_FX_COHERENT_CLOUD == null\) CBZ\.CONFIG\.NUKE_FX_COHERENT_CLOUD = true/,
  "the one-owner nuclear cloud must default on"
);
match(
  /NUKE_FX_ASH == null\) CBZ\.CONFIG\.NUKE_FX_ASH = false/,
  "camera-local ash must default off so it cannot veil the mushroom"
);
const textureStart = source.indexOf("function makeMushroomTexture(stage)");
const textureEnd = source.indexOf("function stemProfile(f)", textureStart);
assert.ok(textureStart >= 0 && textureEnd > textureStart, "mushroom texture owner must exist");
const textureSource = source.slice(textureStart, textureEnd);
assert.match(textureSource, /const img = ctx\.createImageData\(IMP_W, IMP_H\)/,
  "mushroom must be sampled as a continuous density field");
assert.match(textureSource, /const structure = Math\.max\(capField, collarField, stemField, baseField\)/,
  "cap, collar, stem and base must form one connected union");
assert.doesNotMatch(textureSource, /ctx\.arc|createRadialGradient/,
  "no circles may define post-flash nuclear smoke");
match(/const nBills = oneCloud \? 0/, "coherent nuke must allocate zero detail planes");
match(/live\.volume = !!P\.volume && !live\.coherentCloud/,
  "coherent nuke must not animate the six solid-lobe fields");
match(/const mix = L\.coherentCloud \? 1/,
  "coherent density field must own the whole post-flash timeline");
match(/noVisual: \(row\.id \|\| "nuke"\) === "nuke" && coherentCloud\(\)/,
  "nuke must suppress the redundant generic airstrike picture");
assert.match(crashfx, /if \(opts\.noVisual !== true\) \{[\s\S]*?const nSmoke =/,
  "crashfx must retain gameplay while gating its generic smoke/fire picture");
match(/coherentPostFlash:/, "audit must pin the one-draw post-flash contract");
match(/mushEarly: null, mushForm: null, mush: null/, "three formation masks must exist");
match(/uPhase: \{ value: 0 \}/, "far cloud must expose its formation phase");
assert.match(
  crashfx,
  /opts\.ordnance === "nuke" \? "nuclear blast" : "explosion"/,
  "near-field nuke deaths must carry their ordnance cause"
);
assert.match(
  crashfx,
  /cause === "nuclear blast" \? "killed by a nuclear blast"/,
  "near-field player death must say nuclear blast"
);
assert.match(
  impactbus,
  /w\.kind === "nuke" \? "nuclear blast" : "explosion"/,
  "wave ped and crowd deaths must carry the nuclear cause"
);
assert.match(
  impactbus,
  /w\.kind === "nuke" \? "killed by a nuclear blast"/,
  "wave player death must say nuclear blast"
);

const BLOOM_MAX = 1.41;
const RISE_T = 26;
const riseKeys = [
  [0.00, 0.00], [0.08, 0.06], [0.28, 0.30], [0.58, 0.68], [1.00, 1.00],
];
const bloomKeys = [
  [0.00, 0.055], [0.06, 0.16], [0.18, 0.38],
  [0.40, 0.82], [0.70, 1.22], [1.00, BLOOM_MAX],
];
const ease = (t) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function keyed(u, keys) {
  u = clamp(u, 0, 1);
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i];
      const p = (u - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * ease(p);
    }
  }
  return keys.at(-1)[1];
}
function sample(t) {
  const R = 126;
  const capMature = 5106;
  const capCentre = 8004;
  const rise = keyed((t - 0.9) / RISE_T, riseKeys);
  const bloom = keyed((t - 0.55) / RISE_T, bloomKeys);
  const phase = clamp(
    0.5 * ease((t - 1.2) / 6.8) +
    0.5 * ease((t - 7.5) / 16.5),
    0, 1
  );
  return {
    t,
    rise,
    capW: (capMature / BLOOM_MAX) * bloom,
    capY: R * 0.6 + (capCentre - R * 0.6) * rise,
    phase,
  };
}

const handoff = sample(1.47);
assert.ok(handoff.capW < 1000, `handoff cap is too wide: ${handoff.capW.toFixed(0)}m`);
assert.ok(handoff.capY < 500, `handoff cap is too high: ${handoff.capY.toFixed(0)}m`);
assert.ok(handoff.phase < 0.10, `handoff texture is too mature: ${handoff.phase.toFixed(3)}`);

const times = [0.55, 1.05, 1.47, 3.5, 8, 15, 26.9];
const rows = times.map(sample).map((s) => ({
  seconds: s.t.toFixed(2),
  rise: s.rise.toFixed(3),
  capWidthM: s.capW.toFixed(0),
  capCentreM: s.capY.toFixed(0),
  phase: s.phase.toFixed(3),
}));
for (let i = 1; i < rows.length; i++) {
  assert.ok(+rows[i].capWidthM >= +rows[i - 1].capWidthM, "cap width must be monotonic");
  assert.ok(+rows[i].capCentreM >= +rows[i - 1].capCentreM, "cap rise must be monotonic");
  assert.ok(+rows[i].phase >= +rows[i - 1].phase, "formation phase must be monotonic");
}

console.table(rows);
console.log(
  "nukefx phase contract: OK " +
  "(1 coherent post-flash draw, 0 lobe fields, 0 detail planes, 0 generic nuclear puff events)"
);
