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
// Since the d186a55 rebuild the coherent cloud IS the depth-writing 3D lobe
// field (the baked far-card is the flag-off legacy tier), so the volumes run
// and the impostor mix is pinned to 0 — the exact inverse of the density-field
// era this contract was first written against.
match(/const mix = L\.coherentCloud \? 0/,
  "the 3D lobe field must own the whole coherent post-flash timeline");
match(/NUKE_FX_FOGPROOF == null\) CBZ\.CONFIG\.NUKE_FX_FOGPROOF = true/,
  "the cloud must default to punching through distance fog");
match(/fog: !CBZ\.CONFIG\.NUKE_FX_FOGPROOF/,
  "lobe materials must gate their fog mix on the fogproof flag");
/* THE LOBES ARE SMOKE, NOT SURFACES (2026-08-05). Each of these is one of the
   four properties the RPG blast has and the lit, depth-writing cloud did not;
   any one of them silently reverting puts the boulders back. */
match(/NUKE_FX_SMOKE_LOBES == null\) CBZ\.CONFIG\.NUKE_FX_SMOKE_LOBES = true/,
  "smoke-shaded lobes must default on");
match(/transparent: true, opacity: opacity, depthWrite: !smoke/,
  "lobes must stop writing depth in smoke mode, or overlaps hard-clip again");
match(/function flushVolume\(mesh, sorted\)/,
  "blended lobes must be flushed in an explicit depth order");
match(/gl_FragColor\.rgb = diffuse \* smLit/,
  "smoke lobes must discard Lambert's terminator for wrap-scatter shading");
// Pin the PROPERTY (the RPG mask is sampled in the lobe's own object space,
// offset per instance so no two billows wear the same lumps), never the tiling
// constant — that number is a look dial and pinning it turns every future
// adjustment into a false contract failure.
match(/texture2D\(uSmokeMask, vSmO\.[xz]y[^)]*smOff/,
  "the RPG's own smoke mask must erode the lobe silhouette");
match(/if \(smokeLobes\(\)\) return Math\.min\(1, smokePeak != null \? smokePeak : peak \* 0\.68\)/,
  "per-lobe alpha must be a per-layer smoke peak once overlap supplies density");
/* THE SILHOUETTE HAS NO FLOOR. The old soft-lobe patch kept a per-role alpha
   floor (0.22/0.45/0.60) purely because a depth-WRITING rim punched holes in
   the lobes behind it; nothing writes depth now, so the rim must be free to
   reach a true zero. A floor term reappearing here is a lobe getting its
   outline back, and it is the one rim property that is decidable in source. */
assert.doesNotMatch(
  source.slice(source.indexOf("if (smoke) {"), source.indexOf("// NUKE_FX_SOFT_LOBES:")),
  /gl_FragColor\.a \*= \(0\./,
  "smoke lobes must not reintroduce an alpha floor at the silhouette");
match(/smDen \*= smoothstep\([0-9.]+, [0-9.]+, smDen\)/,
  "thin density must erode to nothing, or the silhouette is smooth like a ball");
match(/TEX\.smokeMask = TEX\.blastSmoke\.clone\(\)/,
  "the lobe mask must be a clone — re-wrapping crashfx's live texture would " +
  "change every blast sprite in the game");
match(/NUKE_FX_BIG_FORMATION == null\) CBZ\.CONFIG\.NUKE_FX_BIG_FORMATION = true/,
  "photographic formation scale must default on");
match(/NUKE_FX_AFTERMATH == null\) CBZ\.CONFIG\.NUKE_FX_AFTERMATH = true/,
  "the maturing aftermath cloud must default on");
match(/live\.matureFrom = P\.dur;[\s\S]{0,40}live\.dur = 420/,
  "the aftermath must extend the sequence instead of hiding it at 34 s");
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
  // Mirrors the code's two-stage model: formationDims (NUKE_FX_BIG_FORMATION)
  // carries the 34 s sequence, then the NUKE_FX_AFTERMATH walk lerps the live
  // targets toward the mature nukeDims over 170 s starting at t=34.
  const R = 126;
  const formCapW = R * 11.0;               // 1,386 m
  const formCapY = R * 20.0;               // 2,520 m
  const matureCapW = 5106;
  const matureCapY = 8004;
  const k = ease(clamp((t - 34) / 170, 0, 1));
  const capWTarget = formCapW + (matureCapW - formCapW) * k;
  const capYTarget = formCapY + (matureCapY - formCapY) * k;
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
    capW: (capWTarget / BLOOM_MAX) * bloom,
    capY: R * 0.6 + (capYTarget - R * 0.6) * rise,
    phase,
  };
}

const handoff = sample(1.47);
assert.ok(handoff.capW < 1000, `handoff cap is too wide: ${handoff.capW.toFixed(0)}m`);
assert.ok(handoff.capY < 500, `handoff cap is too high: ${handoff.capY.toFixed(0)}m`);
assert.ok(handoff.phase < 0.10, `handoff texture is too mature: ${handoff.phase.toFixed(3)}`);

const times = [0.55, 1.05, 1.47, 3.5, 8, 15, 26.9, 60, 210];
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
  "(3D lobe cloud owns post-flash, fogproof, photographic formation + 420s maturing aftermath, " +
  "0 detail planes, 0 generic nuclear puff events)"
);
