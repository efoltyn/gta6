#!/usr/bin/env node
/* tools/shot/req.mjs — ask for pictures. Returns at once with an id; the warm
   capture service (tools/shot/daemon.mjs, started for you) does the rest.

   node tools/shot/req.mjs --preset turntable --setup 'species=lion' [--wait]
   node tools/shot/req.mjs --world npcwar --branch <b> --setup '<url params or JS>' \
        --cams 'front,side' --times '0,0.5' --out <dir>

   WHAT IS SHOT
     default            your working tree AS IT IS NOW, uncommitted edits and new
                        files included (snapshotted into a commit object; your
                        branch and index are not touched), merged onto origin/main
     --branch B         branch/ref B instead (committed work only)
     --ba               before/after: origin/main vs the above, one side-by-side sheet
     --before REF       before/after against REF instead of origin/main
     --no-merge         shoot the commit as is, not merged onto origin/main

   WHAT TO SHOOT (NPC War)
     --preset P         glance | turntable | gait | walk | trot | run | attack | death | matchup
     --setup S          URL params: species=lion  n=3  vs=men  vn=20  pose=walk,trot
                        (the matchup URL names work too: a=lion b=men n=3v20 aw at arena)
                        heading=30  speed=5  style=maul  stage=studio|map  grid=0  ruler=0
                        any OTHER key goes on the page URL (map=water, blood=0, ...)
                        or a JS snippet: run after spawning with (S=subjects, B=__battle, CBZ, THREE, spec)
     --js CODE          a JS snippet in addition to URL params
     --cams L           front,side,back,left,3q,3qb,top,head,feet,wide,hot,orbit:<yaw>:<pitch>[:dist]
     --times L          sim seconds (attack: strike phase 0..1); cycle:N = N frames over one gait cycle
     --size WxH         default 640x400; --big = 1280x800
     --jpg              JPEG frames (smaller, faster to Read)

   GETTING IT
     --wait [S]         block until done (default 90 s), print the sheet path
     otherwise:         node tools/shot/get.mjs <id>   (instant)
     --out DIR          where the PNGs go (default ~/harness/out/gta6/shots/<id>/)
     --agent NAME       who you are, for the fairness queue (default: your branch) */
import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, openSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SD, LOG, OUT_ROOT, PRESETS, NPCWAR_STAGE_KEYS, WORLD_STAGE_KEYS, NPCWAR_BASE_QUERY, npcwarAliases, CFG, parseSetup, newId, daemonInfo, writeJson, readJson, resultPath, now, sleep } from "./lib.mjs";
import { merge2 } from "../testbus/tree.mjs";
import { mainRepo } from "../testbus/lib.mjs";

const t0 = Date.now();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
if (has("--help") || has("-h")) {
  const src = (await import("node:fs")).readFileSync(fileURLToPath(import.meta.url), "utf8");
  console.log(src.split("*/")[0].replace(/^#!.*\n\/\* ?/, ""));
  process.exit(0);
}
const cwd = process.cwd();
const g = (args, opts = {}) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const die = (m) => { console.error("shot: " + m); process.exit(2); };

// ---------------------------------------------------------------- the sides
const SERVED_ONLY = [".", ":!artifacts", ":!tools", ":!docs", ":!*.md", ":!scrolls"];
function snapshot() {
  const head = g(["rev-parse", "HEAD"]);
  const dirty = g(["status", "--porcelain", "--untracked-files=all", "--", ...SERVED_ONLY]);
  if (!dirty) return { commit: head, wip: false };
  const idx = g(["rev-parse", "--path-format=absolute", "--git-path", "index"]);
  const tmp = path.join(mkdtempSync(path.join(os.tmpdir(), "shot-idx-")), "index");
  try {
    if (existsSync(idx)) copyFileSync(idx, tmp);
    const env = { ...process.env, GIT_INDEX_FILE: tmp };
    g(["add", "-A", "--", ...SERVED_ONLY], { env });
    const tree = g(["write-tree"], { env });
    const commit = g(["commit-tree", tree, "-p", head, "-m", "shot: working-tree snapshot"]);
    return { commit, wip: true };
  } finally { try { rmSync(path.dirname(tmp), { recursive: true, force: true }); } catch (_) {} }
}
let branch = val("--branch"), after;
try {
  if (branch) after = { commit: g(["rev-parse", branch + "^{commit}"]), wip: false };
  else { branch = (() => { try { return g(["rev-parse", "--abbrev-ref", "HEAD"]); } catch (_) { return "HEAD"; } })(); after = snapshot(); }
} catch (e) { die("cannot resolve what to shoot: " + String(e.stderr || e.message).trim()); }
let main = null;
try { main = g(["rev-parse", "origin/main"]); } catch (_) {}
let mergedNote = "";
if (!has("--no-merge") && main && after.commit !== main) {
  try {
    const isAnc = (() => { try { g(["merge-base", "--is-ancestor", main, after.commit]); return true; } catch (_) { return false; } })();
    if (!isAnc) {
      const m = merge2(main, after.commit, branch);
      if (m.ok) { after.commit = m.commit; mergedNote = "merged onto origin/main"; }
      else mergedNote = "does not merge with origin/main: shot as is";
    }
  } catch (_) {}
}
const sides = [];
const beforeRef = val("--before", has("--ba") ? "origin/main" : null);
if (beforeRef) {
  let bc; try { bc = g(["rev-parse", beforeRef + "^{commit}"]); } catch (_) { die("no such ref " + beforeRef); }
  sides.push({ label: "before", branch: beforeRef, commit: bc });
}
sides.push({ label: beforeRef ? "after" : "shot", branch: branch + (after.wip ? "+wip" : ""), commit: after.commit });

// ---------------------------------------------------------------- the shot
const world = val("--world", "npcwar");
const presetName = val("--preset", null);
const P = presetName ? (PRESETS[world] || {})[presetName] : null;
if (presetName && !P) die(`no preset "${presetName}" for ${world} (know: ${Object.keys(PRESETS[world] || {}).join(", ")})`);
const S = parseSetup(val("--setup", ""));
const params0 = { ...(P ? P.setup : {}), ...S.params };
const params = world === "npcwar" ? npcwarAliases(params0) : params0;
const js = [S.js, val("--js", "")].filter(Boolean).join(";\n");
const stage = {}, page = new URLSearchParams(world === "npcwar" ? NPCWAR_BASE_QUERY : "");
const STAGE_KEYS = world === "npcwar" ? NPCWAR_STAGE_KEYS : WORLD_STAGE_KEYS;
for (const [k, v] of Object.entries(params)) {
  if (STAGE_KEYS.has(k)) stage[k] = v;
  else page.set(k, v);         // a page param: map=water, cfg_FLAG=1, seed=7 ...
}
page.sort();
const poses = String(stage.pose || (world === "npcwar" ? "idle" : "still")).split(",").filter(Boolean);
delete stage.pose;
const list = (s) => String(s).split(",").map((x) => x.trim()).filter(Boolean);
const cams = val("--cams") ? list(val("--cams")) : P ? P.cams : ["3q"];
const times = val("--times") ? list(val("--times")) : P ? P.times : ["0"];
let [W, H] = (val("--size", has("--big") ? "1280x800" : "640x400")).split("x").map((n) => +n);
if (!(W > 0 && H > 0)) die("--size WxH");

const agent = val("--agent", branch);
const id = newId(agent);
const out = path.resolve(cwd, val("--out", path.join(OUT_ROOT, id)));
const req = {
  id, agent, world, sides, stage, js, poses, cams, times, W, H, query: page.toString(),
  mime: has("--jpg") ? "image/jpeg" : "image/png", out, preset: presetName, cwd,
  submitted: now(), submittedMs: Date.now(),
};
writeJson(resultPath(id), { id, status: "queued", submitted: req.submitted, out, sides });
writeJson(path.join(SD.queue, id + ".json"), req);

// start the service if nobody has (the lockfile makes a race harmless)
let started = "";
if (!has("--no-start") && !daemonInfo()) {
  let runner = path.join(HERE, "daemon.mjs");
  try { const m = path.join(mainRepo(cwd), "tools/shot/daemon.mjs"); if (existsSync(m)) runner = m; } catch (_) {}
  const fd = openSync(LOG, "a");
  spawn(process.execPath, [runner], { detached: true, stdio: ["ignore", fd, fd], cwd: path.dirname(runner) }).unref();
  started = " (started the shot service)";
}
const nFrames = poses.length * cams.length * times.length;
console.log(`shot ${id} queued: ${world} ${Object.entries(stage).map(([k, v]) => k + "=" + v).join(" ")} ${poses.join(",")} x ${cams.length} cam(s) x ${times.length} time(s)` +
  ` = ${nFrames}${times.some((t) => /cycle/.test(t)) ? "+" : ""} frame(s) x ${sides.length} side(s) on ${sides.map((s) => s.branch + "@" + s.commit.slice(0, 8)).join(" vs ")}` +
  `${mergedNote ? " (" + mergedNote + ")" : ""}${started} [${Date.now() - t0} ms]`);

if (!has("--wait")) { console.log(`  get: node tools/shot/get.mjs ${id}`); process.exit(0); }
const lim = (+val("--wait", 90) || 90) * 1000;
for (;;) {
  const r = readJson(resultPath(id)) || {};
  if (r.status === "done" || r.status === "error") break;
  if (Date.now() - t0 > lim) { console.log(`still ${r.status || "queued"} after ${lim / 1000} s; later: node tools/shot/get.mjs ${id}`); process.exit(2); }
  await sleep(250);
}
const r = readJson(resultPath(id));
const { spawnSync } = await import("node:child_process");
process.exit(spawnSync(process.execPath, [path.join(HERE, "get.mjs"), id], { stdio: "inherit" }).status);
