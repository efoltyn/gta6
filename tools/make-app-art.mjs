#!/usr/bin/env node
/* tools/make-app-art.mjs — THE APP ICON AND THE LAUNCH SCREEN, DRAWN IN CODE.

   The App Store wants a 1024×1024 icon with no alpha and no rounded corners
   (iOS rounds it), and Capacitor wants a big square splash it can letterbox.
   Both are drawn here as pure functions of (x, y) — no image library, no
   design file to lose, and the palette comes straight off the game's own
   CBZ.COL. Change a number, run the tool, look at the PNG.

     node tools/make-app-art.mjs               # write ios/art/*.png
     node tools/make-app-art.mjs --preview     # + a 256px copy to eyeball

   WHAT IT DRAWS, and why this and not a logo: an app icon is read at 60 px on
   a home screen, so it gets THREE shapes and nothing else — the storm sky, the
   island under it with the volcano lit, and the wave coming for it. That is
   the whole game in one frame: the world, and two of the eleven ways it kills
   you. Type at 60 px is unreadable, so there is none.

   The splash reuses the same scene, calmer and wider, with the wordmark. */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writePng } from "./lib/png.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "ios/art");
mkdirSync(OUT, { recursive: true });
const has = (f) => process.argv.slice(2).includes(f);

// ---------------------------------------------------------------- palette
const C = {
  skyTop: [7, 13, 24],
  skyMid: [26, 38, 58],
  ember: [232, 98, 44],
  emberHot: [255, 196, 92],
  land: [10, 20, 30],
  landLit: [38, 30, 34],
  sea: [9, 44, 58],
  seaDeep: [5, 24, 36],
  // the wave itself is LIT — it has to separate from the water behind it
  waveBody: [18, 84, 104],
  waveDeep: [9, 46, 62],
  foam: [214, 240, 248],
  bolt: [206, 232, 255],
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/* distance from p to the segment ab, all in normalised units */
function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy || 1e-9), 0, 1);
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

/* the lightning channel: a forked polyline, the same shape systems/lightningfx.js
   draws in the world — a main channel with one branch peeling off it */
const CHANNEL = [[0.66, 0.04], [0.60, 0.16], [0.69, 0.24], [0.62, 0.37], [0.665, 0.47]];
const BRANCH = [[0.62, 0.37], [0.53, 0.44], [0.555, 0.51]];

function boltGlow(x, y) {
  let d = 9;
  for (let i = 1; i < CHANNEL.length; i++) d = Math.min(d, segDist(x, y, ...CHANNEL[i - 1], ...CHANNEL[i]));
  for (let i = 1; i < BRANCH.length; i++) d = Math.min(d, segDist(x, y, ...BRANCH[i - 1], ...BRANCH[i]) * 1.5);
  return d;
}

/* THE ISLAND. One cone with a notched crater, standing on the waterline. The
   flank exponent is what makes it read as a volcano rather than a pyramid. */
function landHeight(x) {
  const peak = 0.30, shore = 0.70;
  const cx = 0.575, halfW = 0.33;
  const t = clamp(Math.abs(x - cx) / halfW, 0, 1);
  if (t >= 1) return 9;                                // no land out here
  const flank = peak + (shore - peak) * Math.pow(t, 0.62);
  const crater = Math.abs(x - cx) < 0.045 ? peak + 0.026 : flank;
  return Math.min(flank, crater) + 0.006 * Math.sin(x * 63);
}

/* THE WAVE. Not a horizon — a single swell rearing up on the LEFT and running
   out flat to the right, so the island keeps its shoreline and the wave reads
   as coming AT it. This is the tsunami, which is the hazard every player on
   this island learns first. */
const CREST_X = 0.30, HORIZON = 0.695;
function waveTop(x) {
  return 0.99 - 0.40 * Math.exp(-Math.pow((x - CREST_X) / 0.235, 2))
    + 0.010 * Math.sin(x * 15.0 + 1.2);
}

function scene(u, v, opts) {
  const bold = opts.bold;                    // icon: harder contrast, more weather
  // ---- sky, with the eruption's glow low and behind the cone
  let col = mix(C.skyTop, C.skyMid, smooth(0, 0.66, v));
  const glow = Math.exp(-(Math.pow((u - 0.575) / 0.26, 2) + Math.pow((v - 0.42) / 0.24, 2)));
  col = mix(col, C.ember, glow * (bold ? 0.60 : 0.38));

  // ---- rain first, so everything solid lands on top of it
  if (bold) {
    const s = (u * 2.1 + v * 0.9) * 7;
    const r = Math.abs(s - Math.round(s));
    col = mix(col, [176, 202, 226], smooth(0.20, 0.02, r) * 0.032);
  }

  // ---- the ash plume standing over the crater
  const plume = Math.exp(-Math.pow((u - 0.575) / (0.045 + (0.34 - v) * 0.30), 2)) * smooth(0.33, 0.02, v);
  col = mix(col, [62, 56, 62], plume * 0.5);

  // ---- the lightning channel and its halo
  const d = boltGlow(u, v);
  col = mix(col, C.ember, Math.exp(-d * 24) * 0.28);
  col = mix(col, C.bolt, smooth(0.010, 0.004, d));

  // ---- the sea behind everything, from the horizon down
  if (v > HORIZON) {
    col = mix(C.sea, C.seaDeep, smooth(HORIZON, 1.0, v) * 0.9);
    col = mix(col, C.ember, Math.exp(-Math.pow((u - 0.575) / 0.20, 2)) * smooth(HORIZON + 0.10, HORIZON, v) * 0.30);
  }

  // ---- the island
  const lh = landHeight(u);
  if (v > lh) {
    const lit = Math.exp(-Math.pow((u - 0.575) / 0.15, 2)) * smooth(0.70, 0.30, v);
    col = mix(C.land, C.landLit, lit * 0.85);
    // lava out of the notch, down the flank
    const lava = Math.exp(-Math.pow((u - 0.576 - (v - 0.31) * 0.13) / 0.014, 2))
      * smooth(0.30, 0.36, v) * smooth(0.70, 0.56, v);
    col = mix(col, C.emberHot, lava);
    col = mix(col, C.emberHot, smooth(lh + 0.006, lh, v) * Math.exp(-Math.pow((u - 0.575) / 0.06, 2)) * 0.8);
  }

  // ---- and the wave, in front of all of it
  const wt = waveTop(u);
  if (v > wt) {
    col = mix(C.waveBody, C.waveDeep, smooth(wt, 1.05, v) * 0.9);
    col = mix(col, C.ember, Math.exp(-Math.pow((u - 0.55) / 0.26, 2)) * smooth(wt + 0.22, wt, v) * 0.16);
    col = mix(col, C.foam, smooth(wt + 0.034, wt, v) * 0.95);          // the crest cap
    // the curl: the arc of foam already broken off the lip and running down the face
    const curl = Math.abs(v - (wt + 0.062 + 0.022 * Math.sin((u - CREST_X) * 6.5)));
    col = mix(col, C.foam, smooth(0.024, 0.006, curl) * 0.45 * smooth(0.30, 0.06, Math.abs(u - CREST_X)));
  }

  // ---- vignette so the icon has a centre at 60 px
  const vig = 1 - 0.45 * Math.pow(Math.hypot(u - 0.5, v - 0.5) * 1.5, 2.6);
  return col.map((c) => clamp(c * vig, 0, 255));
}

// ---------------------------------------------------------------- the files
const jobs = [
  ["AppIcon-1024.png", 1024, 1024, { bold: true }],
  ["Splash-2732.png", 2732, 2732, { bold: false }],
];
if (has("--preview")) jobs.push(["preview-256.png", 256, 256, { bold: true }]);

for (const [name, w, h, opts] of jobs) {
  const bytes = writePng(path.join(OUT, name), w, h, (x, y) => scene((x + 0.5) / w, (y + 0.5) / h, opts));
  console.log(`${name.padEnd(20)} ${w}×${h}  ${(bytes / 1024).toFixed(0)} KB`);
}
console.log("→ " + path.relative(ROOT, OUT));
