#!/usr/bin/env node
/* tools/fp-hands-shot.mjs — one PNG per first-person hold, no world boot.

     node tools/fp-hands-shot.mjs carbine:hip carbine:ads shotgun:hip sidearm:ads carbine:reload:0.5
     [--out dir] [--size 960x600]

   Serves the repo, opens tools/fp-hands-studio.html in the headless shell per
   subject (w:pose[:reloadP]) and writes <out>/<w>-<pose>.png. A few seconds a
   frame, a single swiftshader process at a time: cheap on a loaded machine. */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
let out = path.join(os.tmpdir(), "fp-hands-shots"), size = "960,600";
const subs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") out = args[++i];
  else if (args[i] === "--size") size = args[++i].replace("x", ",");
  else subs.push(args[i]);
}
mkdirSync(out, { recursive: true });
function chromePath() {
  if (process.env.CBZ_CHROME) return process.env.CBZ_CHROME;
  const base = path.join(os.homedir(), ".cache/puppeteer/chrome-headless-shell");
  if (existsSync(base)) for (const d of readdirSync(base)) {
    const p = path.join(base, d, "chrome-headless-shell-mac-arm64/chrome-headless-shell");
    if (existsSync(p)) return p;
  }
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
}
const port = 20000 + Math.floor(Math.random() * 20000);
const srv = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 700));
try {
  for (const s of subs) {
    const [w, pose, p, view] = s.split(":");
    const file = path.join(out, `${w}-${pose || "hip"}${p ? "-" + p : ""}${view ? "-" + view : ""}.png`);
    const url = `http://127.0.0.1:${port}/tools/fp-hands-studio.html?w=${w}&pose=${pose || "hip"}${p ? "&p=" + p : ""}${view ? "&view=" + view : ""}`;
    const r = spawnSync(chromePath(), ["--headless", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars",
      "--no-first-run", `--user-data-dir=${path.join(os.tmpdir(), "fphs-" + port)}`,
      `--window-size=${size}`, "--virtual-time-budget=8000", `--screenshot=${file}`, url], { encoding: "utf8", timeout: 90000 });
    console.log(existsSync(file) ? file : `FAILED ${s}: ${(r.stderr || "").slice(-400)}`);
  }
} finally { srv.kill(); }
