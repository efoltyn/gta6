#!/usr/bin/env node
/* ============================================================
   tools/warlord-sand-tone.mjs — WHY DOES THE SAND'S COLOUR CRAWL.

   OWNER (2026-09-01): "look at how the sand in warlord varies in a colour a
   little too much idk why it looks weird."

   The "idk why" is the interesting half, and a screenshot cannot answer it,
   because the thing that is wrong is not visible in any ONE frame: the same
   patch of ground is painted a DIFFERENT COLOUR depending on which clipmap
   ring happens to be covering it. Ride toward it and the ring changes and the
   patch changes tone under you. That is a comparison across LODs, so this
   tool draws it as one.

   desert.js paints the terrain per-vertex, and colourAt() ends with a
   break-up term:

       const g = 0.93 + h2(Math.round(x), Math.round(z), S(1301)) * 0.14;

   h2 is a HASH — white noise, no correlation whatsoever between neighbours —
   evaluated at the VERTEX. Three things follow, and all three are the bug:

     1. IT IS NOT ATTACHED TO THE WORLD. The clipmap's seven levels sample
        every 10, 20, 40 ... 640 m, and the arena mesh and the minimap sample
        at their own spacings again. A hash asked at 10 m spacing and at 40 m
        spacing returns unrelated values for the same ground, so one patch of
        desert has four different tones depending on who is drawing it.
     2. IT IS THE WRONG FREQUENCY. The comment calls it "one cheap per-vertex
        break-up so a cell does not read as a tile", i.e. it wants GRAIN. But a
        value carried on vertices 10 m apart and Gouraud-interpolated across
        the triangles between them is not grain: it is a soft blotch ten metres
        wide. It is precisely the frequency the eye reads as "blotchy", and it
        is +/-7% of the albedo, which is a lot of tone on flat sand.
     3. IT DRAWS THE MESH. White noise interpolated over a triangle grid puts a
        tone extremum on every vertex, so the break-up meant to HIDE the grid
        is the thing that makes the grid legible.

   This renders the term over one 640 m patch of desert, sampled the way each
   clipmap level samples it, and prints how far apart the columns are. No
   browser, no GPU, no game: h2 is copied verbatim from desert.js and the term
   depends on nothing else, so this is the real function under a ruler.

     node tools/warlord-sand-tone.mjs
     node tools/warlord-sand-tone.mjs --out /tmp/tone.png --span 640
   ============================================================ */
import fs from "node:fs";
import os from "node:os";
import zlib from "node:zlib";

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const SPAN = +arg("--span", 640);            // metres across the rendered patch
const PX = +arg("--px", 240);                // pixels per panel
/* Artifacts land in ~/harness/out/<repo>/ per the harness contract — NOT in
   the repo. This is a shared checkout with other sessions live in it, and a
   new untracked directory here shows up in everyone's git status and gets
   swept by the next `git add -A`. */
const OUT = arg("--out", `${os.homedir()}/harness/out/gta6/warlord-sand-tone.png`);

/* ---- copied VERBATIM from src/warlord/desert.js -------------------------- */
function h2(ix, iz, salt) {
  let n = (Math.imul(ix | 0, 73856093) ^ Math.imul(iz | 0, 19349663) ^ Math.imul(salt | 0, 83492791)) | 0;
  n = Math.imul(n ^ (n >>> 13), 0x85ebca6b);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}
function vn(x, z, cell, salt) {
  const gx = x / cell, gz = z / cell;
  const ix = Math.floor(gx), iz = Math.floor(gz);
  let fx = gx - ix, fz = gz - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = h2(ix, iz, salt), b = h2(ix + 1, iz, salt);
  const c = h2(ix, iz + 1, salt), d = h2(ix + 1, iz + 1, salt);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
}
const SALT = 0;
const S = (n) => (n + SALT) | 0;

/* THE TERM AS SHIPPED, and the term as proposed. Both are given the sample
   spacing they are being asked at, because that is the whole argument. */
const OLD = (x, z) => 0.93 + h2(Math.round(x), Math.round(z), S(1301)) * 0.14;
/* Coherent, world-locked, and faded out where the grid cannot carry it — see
   the matching comment in desert.js. Two octaves so it reads as patchy sand
   rather than as one rolling wave. */
const TONE_W = +arg("--wave", 260);          // matches desert.js TONE_WAVE          // metres per tonal patch
const TONE_A = +arg("--amp", 0.025);         // +/- fraction of albedo
function NEW(x, z, cell) {
  // NYQUIST, NOT TASTE: a lattice sampled coarser than about a quarter of its
  // own wavelength returns noise, so the term is faded out before the level
  // gets too coarse to carry it. Below that it is the SAME function of world
  // position at every level, which is the whole point.
  const amp = TONE_A * Math.max(0, Math.min(1, (TONE_W / 2 - cell) / (TONE_W / 4)));
  if (amp <= 0) return 1;
  return 1 + (vn(x, z, TONE_W, S(1301)) - 0.5) * 2 * amp;
}

/* ---- sample a panel the way a clipmap level samples the ground ----------- */
/* A level lays vertices every `cell` metres and the GPU interpolates linearly
   between them, so that is exactly what is reproduced here: snap to the
   lattice, bilinear between the four corners. */
function panel(fn, cell, span, px) {
  const buf = new Float64Array(px * px);
  for (let j = 0; j < px; j++) {
    for (let i = 0; i < px; i++) {
      const x = (i / px) * span, z = (j / px) * span;
      const gx = x / cell, gz = z / cell;
      const ix = Math.floor(gx), iz = Math.floor(gz);
      const fx = gx - ix, fz = gz - iz;
      const a = fn(ix * cell, iz * cell, cell), b = fn((ix + 1) * cell, iz * cell, cell);
      const c = fn(ix * cell, (iz + 1) * cell, cell), d = fn((ix + 1) * cell, (iz + 1) * cell, cell);
      const top = a + (b - a) * fx, bot = c + (d - c) * fx;
      buf[j * px + i] = top + (bot - top) * fz;
    }
  }
  return buf;
}

/* ---- a minimal PNG writer (zlib is built in; no dependency) -------------- */
function crc32(b) {
  let c, t = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < b.length; i++) crc = t[(crc ^ b[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(path, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.mkdirSync(path.replace(/\/[^/]+$/, ""), { recursive: true });
  fs.writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]));
}

/* ---- draw: sand albedo x the break-up term, per level ------------------- */
const C_SAND = [0.76, 0.66, 0.46];           // a representative dune tone
const LEVELS = [10, 20, 40, 80];
const GAP = 8, LAB = 0;
const cols = LEVELS.length, rows = 2;
const W = cols * PX + (cols - 1) * GAP, H = rows * PX + GAP + LAB;
const img = Buffer.alloc(W * H * 3, 24);

function blit(buf, cx, cy) {
  for (let j = 0; j < PX; j++) {
    for (let i = 0; i < PX; i++) {
      const g = buf[j * PX + i];
      const o = ((cy + j) * W + (cx + i)) * 3;
      img[o] = Math.max(0, Math.min(255, C_SAND[0] * g * 255));
      img[o + 1] = Math.max(0, Math.min(255, C_SAND[1] * g * 255));
      img[o + 2] = Math.max(0, Math.min(255, C_SAND[2] * g * 255));
    }
  }
}

const stats = [];
for (let l = 0; l < LEVELS.length; l++) {
  const cell = LEVELS[l];
  const o = panel(OLD, cell, SPAN, PX);
  const n = panel(NEW, cell, SPAN, PX);
  blit(o, l * (PX + GAP), 0);
  blit(n, l * (PX + GAP), PX + GAP);
  stats.push({ cell, o, n });
}
writePNG(OUT, W, H, img);

/* ---- and the numbers the picture is claiming ---------------------------- */
const spread = (b) => {
  let mn = Infinity, mx = -Infinity, s = 0;
  for (const v of b) { if (v < mn) mn = v; if (v > mx) mx = v; s += v; }
  const m = s / b.length;
  let q = 0; for (const v of b) q += (v - m) * (v - m);
  return { range: (mx - mn) * 100, sd: Math.sqrt(q / b.length) * 100 };
};
/* THE HEADLINE NUMBER: how far the SAME GROUND moves in tone when a different
   clipmap level draws it. Zero is the only correct answer — ground does not
   change colour because you walked toward it. */
const drift = (key) => {
  let worst = 0, sum = 0, n = 0;
  for (let a = 0; a < stats.length; a++) {
    for (let b = a + 1; b < stats.length; b++) {
      for (let i = 0; i < stats[a][key].length; i++) {
        const d = Math.abs(stats[a][key][i] - stats[b][key][i]);
        if (d > worst) worst = d;
        sum += d; n++;
      }
    }
  }
  return { worst: worst * 100, mean: (sum / n) * 100 };
};

const pc = (v) => v.toFixed(2).padStart(6);
console.log(`\nWARLORD SAND TONE — one ${SPAN} m patch, drawn by each clipmap level\n`);
console.log(`  ${"level cell".padEnd(14)}${"SHIPPED spread".padStart(16)}${"PROPOSED spread".padStart(18)}`);
for (const s of stats) {
  const so = spread(s.o), sn = spread(s.n);
  console.log(`  ${(s.cell + " m").padEnd(14)}${(pc(so.range) + "% (sd " + so.sd.toFixed(2) + ")").padStart(16)}` +
              `${(pc(sn.range) + "% (sd " + sn.sd.toFixed(2) + ")").padStart(18)}`);
}
const dO = drift("o"), dN = drift("n");
console.log(`\n  SAME GROUND, DIFFERENT LEVEL — how much the tone moves:`);
console.log(`    shipped   worst ${dO.worst.toFixed(2)}%   mean ${dO.mean.toFixed(2)}%`);
console.log(`    proposed  worst ${dN.worst.toFixed(2)}%   mean ${dN.mean.toFixed(2)}%`);
console.log(`\n  top row = shipped, bottom row = proposed; left to right = 10/20/40/80 m levels`);
console.log(`  ${OUT}\n`);
