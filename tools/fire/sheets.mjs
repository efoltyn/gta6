#!/usr/bin/env node
/* tools/fire/sheets.mjs — side-by-side before/after sheets from two tools/fire/shot.mjs runs.
     node tools/fire/sheets.mjs <beforeDir> <afterDir> <outDir> [beforeLabel] [afterLabel]
   Writes <outDir>/<beat>.png (before | after) for every PNG both dirs share (ffmpeg hstack). */
import { readdirSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
const [A, B, OUT, la = "BEFORE  WebGL (today)", lb = "AFTER  WebGPU fire engines"] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const esc = (s) => s.replace(/[:']/g, "");
for (const f of readdirSync(B).filter((f) => f.endsWith(".png"))) {
  if (!existsSync(path.join(A, f))) continue;
  // (this ffmpeg has no drawtext: left = before, right = after, written in the README beside the sheets)
  const vf = "[0]scale=960:-1[a];[1]scale=960:-1[b];[a][b]hstack";
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", path.join(A, f), "-i", path.join(B, f), "-filter_complex", vf, path.join(OUT, f)]);
  console.log(path.join(OUT, f));
}
