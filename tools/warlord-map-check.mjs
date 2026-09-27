#!/usr/bin/env node
/* warlord-map-check: load every war map through mapkit in Node, print its
   numbers, draw it as ASCII, and write PNGs (terrain + owners, and relief)
   so a person can LOOK at whether Italy is a boot.

   node tools/warlord-map-check.mjs [mapId ...] [--cols 110] [--png DIR] [--no-ascii]
*/
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const COLS = +opt("--cols", 110);
const PNG_DIR = opt("--png", null);
const ASCII = !args.includes("--no-ascii");
// --crop lonW,latS,lonE,latN (projection units) --scale N: a zoomed PNG of one region
const CROP = opt("--crop", null);
const SCALE = +opt("--scale", 3);
const want = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--no-ascii") && !/^-?\d/.test(a));

require(join(ROOT, "src/warlord/war/mapkit.js"));
for (const f of readdirSync(join(ROOT, "src/warlord/war/maps"))) if (f.endsWith(".js")) require(join(ROOT, "src/warlord/war/maps", f));
const WAR = globalThis.CBZ.warlord.war;

/* ---------------------------------------------------------------- png */
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const CH = { 0: " ", 1: ".", 2: "f", 3: "h", 4: "M", 5: ":", 6: "~", 7: "o" };

function check(id) {
  const t0 = performance.now();
  const M = WAR.mapkit.load(WAR.mapData[id], { fresh: true });
  const ms = performance.now() - t0;
  const N = M.w * M.h;
  let land = 0; const tc = new Array(8).fill(0);
  let rural = 0, riv = 0, coast = 0, hmin = Infinity, hmax = -Infinity;
  for (let i = 0; i < N; i++) {
    tc[M.terrain[i]]++; if (M.land[i]) land++; rural += M.rural[i]; riv += M.river[i]; coast += M.coast[i];
    if (M.height[i] < hmin) hmin = M.height[i]; if (M.height[i] > hmax) hmax = M.height[i];
  }
  console.log(`\n=== ${M.id}: ${M.name}  (${M.w}x${M.h}, ${M.tileKm.toFixed(2)} km/tile, load ${ms.toFixed(0)} ms)`);
  console.log(M.blurb);
  console.log(`land ${(land / N * 100).toFixed(1)}%  coast ${coast}  river tiles ${riv}  height ${hmin.toFixed(0)}..${hmax.toFixed(0)} m  rural ${Math.round(rural).toLocaleString()}  towns ${M.towns.length}  town pop ${M.towns.reduce((a, t) => a + t.pop, 0).toLocaleString()}`);
  console.log("terrain: " + M.TERRAIN.map((T) => `${T.key} ${tc[T.code]}`).join(", "));
  const fo = new Array(M.factions.length + 1).fill(0), fp = new Array(M.factions.length + 1).fill(0), ft = new Array(M.factions.length + 1).fill(0), fm = new Array(M.factions.length + 1).fill(0);
  for (let i = 0; i < N; i++) { fo[M.startOwner[i]]++; fp[M.startOwner[i]] += M.rural[i]; }
  for (const T of M.towns) { ft[T.owner]++; fp[T.owner] += T.pop; }
  for (const A of M.startArmies) fm[A.owner] += A.men;
  console.log("faction                 tiles   towns     people   soldiers  capital");
  for (const f of M.factions) {
    console.log(`${(f.name + " " + f.css).padEnd(22)} ${String(fo[f.i]).padStart(6)} ${String(ft[f.i]).padStart(6)} ${String(Math.round(fp[f.i]).toLocaleString()).padStart(11)} ${String(fm[f.i].toLocaleString()).padStart(10)}  ${f.capital >= 0 ? M.towns[f.capital].name : "-"}`);
  }
  console.log(`${"(nobody)".padEnd(22)} ${String(fo[0]).padStart(6)} ${String(ft[0]).padStart(6)} ${String(Math.round(fp[0]).toLocaleString()).padStart(11)}`);
  console.log("wars: " + M.wars.map(([a, b]) => M.factions[a - 1].id + "-" + M.factions[b - 1].id).join(", "));
  console.log("alliances: " + M.alliances.map(([a, b]) => M.factions[a - 1].id + "-" + M.factions[b - 1].id).join(", "));
  if (M.rogues.length) console.log("rogues: " + M.rogues.map((r) => `${r.name} ${r.men}`).join(", "));
  if (M.warnings.length) console.log("WARNINGS:\n  " + M.warnings.join("\n  "));
  // determinism: a second load is byte-identical
  const M2 = WAR.mapkit.load(WAR.mapData[id], { fresh: true });
  let same = true;
  for (let i = 0; i < N; i++) if (M2.terrain[i] !== M.terrain[i] || M2.height[i] !== M.height[i] || M2.startOwner[i] !== M.startOwner[i]) { same = false; break; }
  console.log("deterministic: " + (same ? "yes" : "NO"));

  if (ASCII) {
    const cols = Math.min(COLS, M.w), sx = M.w / cols, sy = sx * 2;   // terminal cells are ~2:1
    const rows = Math.floor(M.h / sy);
    for (let r = 0; r < rows; r++) {
      let line = "";
      for (let c = 0; c < cols; c++) {
        // majority of the block: land shows unless the block is mostly sea
        const x0 = Math.floor(c * sx), x1 = Math.max(x0 + 1, Math.floor((c + 1) * sx));
        const y0 = Math.floor(r * sy), y1 = Math.max(y0 + 1, Math.floor((r + 1) * sy));
        const cnt = new Array(8).fill(0); let town = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { cnt[M.terrain[x + y * M.w]]++; if (M.townAt[x + y * M.w]) town = 1; }
        let bi = 0; for (let k = 1; k < 8; k++) if (cnt[k] > cnt[bi]) bi = k;
        const tot = (x1 - x0) * (y1 - y0);
        line += town ? "*" : cnt[0] > tot * 0.5 ? " " : CH[bi];
      }
      console.log("|" + line + "|");
    }
  }

  if (PNG_DIR) {
    mkdirSync(PNG_DIR, { recursive: true });
    const S = SCALE;
    let X0 = 0, Y0 = 0, X1 = M.w, Y1 = M.h;
    if (CROP) {
      const c = CROP.split(",").map(Number);
      const a = M.toTile(c[0], c[3]), b = M.toTile(c[2], c[1]);
      X0 = Math.max(0, Math.floor(Math.min(a[0], b[0]))); X1 = Math.min(M.w, Math.ceil(Math.max(a[0], b[0])));
      Y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]))); Y1 = Math.min(M.h, Math.ceil(Math.max(a[1], b[1])));
    }
    const W2 = (X1 - X0) * S, H2 = (Y1 - Y0) * S;
    const img = Buffer.alloc(W2 * H2 * 3), rel = Buffer.alloc(W2 * H2 * 3);
    const g = (v) => Math.max(0, Math.min(255, Math.round(Math.pow(Math.max(0, v), 1 / 2.2) * 255)));
    const hs = M.height;
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
      const i = x + y * M.w, T = M.TERRAIN[M.terrain[i]];
      let c = T.colour.slice();
      const o = M.startOwner[i];
      let c2 = c.slice();
      if (o && M.land[i]) {
        const f = M.factions[o - 1].colour;
        const fc = [((f >> 16) & 255) / 255, ((f >> 8) & 255) / 255, (f & 255) / 255].map((v) => Math.pow(v, 2.2));
        c2 = c.map((v, k) => v * 0.45 + fc[k] * 0.55);
      }
      if (M.river[i]) { c = [0.05, 0.2, 0.45]; c2 = c; }
      // relief: hillshade from the NW + hypsometric tint
      const hl = hs[x > 0 ? i - 1 : i], hr = hs[x < M.w - 1 ? i + 1 : i], hu = hs[y > 0 ? i - M.w : i], hd = hs[y < M.h - 1 ? i + M.w : i];
      const shade = Math.max(0.35, Math.min(1.5, 1 + ((hl - hr) + (hu - hd)) / (M.tileKm * 1000) * 3));
      let rc;
      if (hs[i] <= 0) { const d = Math.min(1, -hs[i] / 3000); rc = [0.02 + 0.1 * (1 - d), 0.08 + 0.2 * (1 - d), 0.2 + 0.25 * (1 - d)]; }
      else { const t = Math.min(1, hs[i] / 3000); rc = [(0.25 + 0.6 * t) * shade, (0.35 + 0.4 * t) * shade, (0.15 + 0.6 * t) * shade]; }
      if (M.terrain[i] === 7) rc = [0.1, 0.3, 0.5];
      if (M.river[i]) rc = [0.1, 0.3, 0.6];
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
        const p = (((y - Y0) * S + dy) * W2 + (x - X0) * S + dx) * 3;
        img[p] = g(c2[0]); img[p + 1] = g(c2[1]); img[p + 2] = g(c2[2]);
        rel[p] = g(rc[0]); rel[p + 1] = g(rc[1]); rel[p + 2] = g(rc[2]);
      }
    }
    for (const T of M.towns) {
      const cx = Math.floor((T.x - X0) * S), cy = Math.floor((T.y - Y0) * S), r = T.capital ? 3 : 2;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const px = cx + dx, py = cy + dy; if (px < 0 || py < 0 || px >= W2 || py >= H2) continue;
        const p = (py * W2 + px) * 3, edge = Math.max(Math.abs(dx), Math.abs(dy)) === r;
        const v = edge ? 0 : 255; img[p] = img[p + 1] = img[p + 2] = v;
      }
    }
    for (const A of M.startArmies) {
      const q = M.xy(A.tile), cx = (q[0] - X0) * S + 1, cy = (q[1] - Y0) * S + 1;
      for (let d = -4; d <= 4; d++) for (const [px, py] of [[cx + d, cy + d], [cx + d, cy - d]]) {
        if (px < 0 || py < 0 || px >= W2 || py >= H2) continue;
        const p = (py * W2 + px) * 3; img[p] = 255; img[p + 1] = 40; img[p + 2] = 40;
      }
    }
    const tag = CROP ? "-crop" : "";
    writeFileSync(join(PNG_DIR, M.id + tag + ".png"), png(W2, H2, img));
    writeFileSync(join(PNG_DIR, M.id + tag + "-relief.png"), png(W2, H2, rel));
    console.log("png: " + join(PNG_DIR, M.id + tag + ".png") + " and " + M.id + tag + "-relief.png");
  }
  return M;
}

const ids = want.length ? want : Object.keys(WAR.mapData);
for (const id of ids) check(id);
console.log("\nmapkit.list(): " + JSON.stringify(WAR.mapkit.list().map((m) => ({ id: m.id, name: m.name, factions: m.factions.length }))));
