#!/usr/bin/env node
/* ============================================================
   tools/speed.mjs (v2) — THE SPEED TEST. One command, one table, one JSON.

   Closes the loop on game speed: how long each mode takes to LOAD (by phase)
   and what a frame of PLAY costs (per updater, per render pass, CPU and real
   GPU), and whether a change is REALLY faster: an interleaved, paired A/B
   against any commit that stops as soon as the statistics are decisive, with
   a pixel look guard so a "win" that costs the HD look is called out.

   THE FAST PATH (seconds per answer): a WARM WORLD per tree. The first
   --ask boots the city once in the background (one measured load) and every
   later question is answered from that live, held world:
     node tools/speed.mjs --ask frames                    # frame/GPU/updaters at every spot (~5-10 s)
     node tools/speed.mjs --ask frames --spot spawn --frames 12
     node tools/speed.mjs --ask ab --toggle 'CBZ.myCull = on' [--spot aerial]
         # IN-PAGE A/B at the same instant: the toggle flips the candidate on
         # and off between blocks (ABBA) in the one live world; paired t verdict
         # per spot, stops when decisive; then a frozen-time (dt = 0) pixel
         # check, so culling passes and a visible change is a LOOK REGRESSION
     node tools/speed.mjs --ask ab --toggle-file toggle.js   # a longer toggle (JS; `on` is the switch)
     node tools/speed.mjs --ask eval 'CBZ.treeAudit()'       # anything, in the live world
     node tools/speed.mjs --ask prof 'CBZ.startRun()'        # ... under the CPU profiler: self + inclusive tops
     node tools/speed.mjs --ask drive [--mps 40 --secs 60 --route x,z;x,z]  # fast drive: peak memory per second + POP-INS in view
     node tools/speed.mjs --ask drive --allocs     # ... + who ALLOCATED during it (incl. collected garbage), by site
     node tools/speed.mjs --ask reload                       # rebuild from edited sources (measured load)
     node tools/speed.mjs --ask info | stop
     node tools/speed.mjs --serve                            # run the world in the foreground instead
   A query first reloads the world if any served file changed since it
   booted (never an answer about stale code); --no-reload skips that. frames
   waits for the machine lock (--no-lock skips it); an in-page ab is paired,
   so it runs at once without the lock (--lock waits). The world exits after
   --idle 1200 s without a question. One world per tree: /tmp/cbz-speed-world-<hash>.json.

   THE FULL RUN (a fresh browser, every number; the verdict before a merge):
     node tools/speed.mjs                         # Gang City: load + in-game (default)
     node tools/speed.mjs --against origin/main   # PAIRED A/B vs a commit (the hill-climb loop)
     node tools/speed.mjs --against http://127.0.0.1:8000/   # ... vs a running server
     node tools/speed.mjs --against baseline      # vs tools/speed-baseline.json (unpaired, weaker)
     node tools/speed.mjs --against x.json        # vs any saved result file (unpaired)
     node tools/speed.mjs --pairs 6 --min-pairs 3 # A/B pair budget (stops early when decisive)
     node tools/speed.mjs --shaders cold          # every run compiles every shader from scratch
     node tools/speed.mjs --return                # + a RETURN VISIT load (same profile, reload)
     node tools/speed.mjs --modes all             # every mode + the games/ pages
     node tools/speed.mjs --modes city,escape     # a list
     node tools/speed.mjs --slice kingsport-downtown   # ONE piece of the city as its own world
     node tools/speed.mjs --slice -2900,3050,450       # ... any x,z,r (src/core/slice.js)
     node tools/speed.mjs --slice-spots estate         # whole city, measured at that slice's spots
     node tools/speed.mjs --load | --play         # one half only
     node tools/speed.mjs --runs 3                # repeats (fresh page each)
     node tools/speed.mjs --save tools/speed-baseline.json
     node tools/speed.mjs --ref origin/main       # measure ANOTHER COMMIT (git archive → temp dir)
     node tools/speed.mjs --root <dir>            # measure a directory (a snapshot, another tree)
     node tools/speed.mjs --url http://127.0.0.1:8000/   # an already-running server / other worktree
     node tools/speed.mjs --profile               # + V8 sampling profile: top functions (file:function)
     node tools/speed.mjs --profile --profile-dir d  # ... and keep the raw .cpuprofile files
     node tools/speed.mjs --attribute             # + DIAGNOSTIC: what HD settings / vegetation cost
     node tools/speed.mjs --serial                # v1 frame model: readPixels every frame, frame = cpu + gpuWait
     node tools/speed.mjs --no-look               # skip the pixel grabs (A/B look guard off)
     node tools/speed.mjs --look-dir <dir>        # where the A/B look diff PNGs go (default: tmp)
     node tools/speed.mjs --device tablet         # iPad viewport + touch preload (absorbs ipad-perf)
     node tools/speed.mjs --device phone          # iPhone: 390x844 @3x, touch, iOS Safari UA (the game picks its tier)
     node tools/speed.mjs --mem-budget 600        # the phone-total budget in MB (default 600)
     node tools/speed.mjs --gpu swiftshader       # software GL (default is the real GPU)
     node tools/speed.mjs --json out.json         # write the full result anywhere
     node tools/speed.mjs --preload probe.js      # inject a diagnostic script before the game (e.g. an allocation tracker)
     node tools/speed.mjs --seed 90210 --frames 90 --warm 20

   WHAT IT MEASURES (in-page performance.now(), Chrome's own CPU counters,
   and GPU timer queries; no wall-clock guessing):
     LOAD, per mode: fetch+eval of every <script> (per-file, from each script's
       load event vs its responseEnd), bootComplete, the synchronous build
       (CBZ.startRun) split by every CBZ.bootStep checkpoint and every landmass
       builder, then the first frames (shader compile + upload) one by one,
       each finished on the GPU (a load is done when the player SEES it).
       Plus CPU TIME from Chrome (load.cpu.*): the renderer main thread's
       ThreadTime (Performance.getMetrics) and the GPU PROCESS's cpuTime
       (SystemInfo.getProcessInfo) — where shader compile and ANGLE's
       translation happen. CPU time barely moves when the box is busy; wall
       time does.
       games/ pages: navigation → ready → entry → first draw call.
     PLAY (city by default): rAF is HELD and frames are stepped by hand with a
       synthetic 1/60 clock — the REAL loop() runs, updaters + always + render
       — at fixed camera spots (spawn street, densest downtown, an aerial look
       over the densest forest) plus a drive path. Per frame: every updater's
       ms, render() CPU ms, REAL GPU ms PER PASS from
       EXT_disjoint_timer_query_webgl2 (main scene / shadow map / every
       render-target pass such as the cctv feed, named by the file:line that
       rendered it), renderer.info calls/triangles, GL-level draws, programs.
       frame = max(CPU, GPU) — a browser pipelines the two, so that is the
       frame a player gets; frameSum = CPU + GPU is reported beside it. v1
       read a pixel back after every frame, which serialized CPU and GPU and
       under-weighted every GPU win (--serial brings that model back).
       Median and p95 over the stepped frames; per-spot main-thread and
       GPU-process CPU ms per frame from Chrome.
     MEMORY, as a phone feels it (every load, every play spot; MB). iOS
       Safari kills a tab near 1-1.5 GB of JS heap + GPU memory together.
       JS heap: performance.memory (Chrome runs with
       --enable-precise-memory-info), sampled in-page at every script load,
       bootStep, landmass builder, stepped frame, GL allocation and every
       100 ms. Chrome's figure is the V8 heap PLUS ArrayBuffer backing
       stores (typed arrays: geometry kept in JS after upload), both real
       memory on a phone; CDP's split is printed beside it. mem.heapPeak over the whole load, mem.heap steady after settle
       (CDP Runtime.getHeapUsage beside it). GPU: accounted at the GL level
       (bufferData, texImage2D/3D, texStorage2D/3D, compressedTexImage2D,
       copyTexImage2D, generateMipmap, renderbufferStorage[Multisample],
       and the deletes; bytes per GL object in a WeakMap) plus the drawing
       buffer (w*h*(4+4)*MSAA samples + resolve): live, peak, split into
       textures / buffers / renderbuffers. PHONE TOTAL = heap + GPU, its
       peak and steady value, printed OK / OVER against --mem-budget (600).
       2D canvases (w*h*4 of live ones) beside it: iOS caps those too.
     SHADERS, COLD OR WARM. macOS keeps compiled Metal shaders in a SYSTEM
       cache that survives a fresh Chrome profile (40 programs: 4.4 s cold,
       0.37 s warm), so v1's compile numbers were bimodal: warm usually, cold
       on the first run after any shader edit. --shaders cold renames every
       shader's main() with a per-run nonce (void cbz_main_<nonce>(), called
       from a new main) — identical GPU code, but new source text, so neither
       the Metal cache nor Chrome's program cache can serve it: every run is
       a first-time player. --shaders warm (default) injects nothing. The
       system cache is NEVER deleted (the owner's own Chrome shares it).
       --return reloads the same page in the same profile after the first
       visit and measures the load again (same nonce: warm shaders, warm HTTP
       and V8 code caches) = a returning player.
     A/B, PAIRED AND INTERLEAVED (--against <ref|url|baseline|file.json>).
       Base and candidate run alternately in ONE browser under ONE lock
       window (ABBA...), both at the same fixed spots (located once on the
       base). Each pair gives a log-ratio per metric; a Student-t interval on
       the mean pair ratio decides: CHANGED when the 99% interval excludes 0
       and the effect is past a practical floor ε (3% / 150 ms load /
       0.5 ms frame), SAME when the 90% interval sits inside ±ε (TOST), else
       "no detectable difference" with the interval printed. It stops after
       --min-pairs (3) as soon as every headline metric is decided, or at
       --pairs (5). A box drifting from load 9 to 25 hits both sides of a
       pair alike, so it cancels instead of turning into a verdict. (Why t
       and not a bootstrap: with 3-6 pairs a bootstrap interval is too narrow
       and cries wolf; t is exact for normal log-ratios and conservative.)
       Against a saved FILE the runs are unpaired: Mann-Whitney U when both
       sides have 4+ runs, else v1's noise rule, printed as LOW CONFIDENCE.
     LOOK GUARD, IN PIXELS. At each fixed spot the last measured frame is
       read back at the game's own HD settings (the drawing buffer, whatever
       pixel ratio / tier / shadows the game chose) and scored with block
       SSIM against base run 1. Base-vs-base pairs say which blocks are
       STABLE (moving peds, cars, particles are masked out) and how much a
       re-run moves on its own; a candidate that changes a larger share of
       the stable picture than a base re-run does is a LOOK REGRESSION, with
       a before | after | heat-map PNG per spot. An invisible change (frustum
       culling, far impostors under the fog) passes; a visible one fails. The
       settings record (pixel ratio, drawing buffer, tier, shadow map, fog)
       is the second check: any drop is a LOOK REGRESSION. Scene counts
       (tree instances, textures) are printed as notes, never failures —
       culling legitimately lowers them. Owner order 2026-09-28: "don't kill
       the HDness"; a faster run that fails either check is never a win.

   HOW IT STAYS HONEST ON ANY COMMIT. Everything is injected by a preload
   (Page.addScriptToEvaluateOnNewDocument) that wraps what every commit has:
   CBZ.bootStep, CBZ._landmassBuilders, CBZ.updaters/always, renderer.render,
   requestAnimationFrame and the WebGL draw entry points. Nothing in the game
   is edited to be measured, so --ref <old sha> measures old code the same way.

   REAL GPU, HEADLESS. Measured 2026-09-28 on the owner's M1 Pro: headless
   Chrome's default GL is ANGLE-on-Metal (the real GPU); 20 fullscreen draws
   cost 2-3 ms there against 70-230 ms on SwiftShader. The old tools forced
   SwiftShader, which is why their frame numbers were noise. This one uses
   the real GPU by default (--gpu swiftshader to compare).

   HD, AS THE GAME PICKS IT. The window is a MacBook viewport (1512x982 CSS)
   at devicePixelRatio 2, on a FRESH profile, so the quality tier is whatever
   the game chooses for a first-time desktop player (--device tablet for the
   iPad class). Nothing is lowered to be measured.

   NOISE. Each metric carries a noise figure: across runs (half the range)
   when --runs > 1, else the within-run spread of the frame samples. That is
   for reading one result; VERDICTS come from the A/B statistics above.
   `uptime` load averages are recorded at start and end of every result: a
   box at load 30 is not a regression.

   JSON. Backward compatible with v1 (version 2 adds fields, renames none).
   One meaning changed: play.<spot>.frame is max(CPU, GPU) in v2 (v1: CPU +
   the readback wait). A compare against a v1 file skips the frame-model
   metrics and says so; re-save the baseline, or better, --against <ref>.

   LOCK. Every measurement holds /tmp/cbz-speed.lock (machine-wide; waits,
   then runs; a lock whose pid is dead or >30 min old is stale and is taken).
   An A/B holds it for all of its pairs. Other tools that boot headless
   cities should honour it.

   Exit: 0 ok, 1 a mode failed to boot/build, 4 --against found a regression
   (a headline metric SLOWER, or a LOOK REGRESSION).
============================================================ */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "./lib/png.mjs";

const TOOL_T0 = Date.now();
const ROOT0 = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
if (has("--help") || has("-h")) {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  console.log(src.slice(src.indexOf("/*"), src.indexOf("*/") + 2));
  process.exit(0);
}

const PAGE_MODES = {
  // index.html modes: ?mode=X, then CBZ.startRun()
  city: { kind: "cbz", page: "index.html", mode: "city" },
  escape: { kind: "cbz", page: "index.html", mode: "escape" },
  survival: { kind: "cbz", page: "index.html", mode: "survival" },
  sharksim: { kind: "cbz", page: "index.html", mode: "sharksim" },
  gungame: { kind: "cbz", page: "index.html", mode: "gungame" },
  // standalone pages: ready → entry (click or URL door) → first draw
  battle: { kind: "page", page: "games/battle.html", ready: "!!(window.__battle && document.getElementById('start'))", entry: "document.getElementById('start').click()" },
  warlord: { kind: "page", page: "games/warlord.html", query: "go=1", ready: "!!window.__warlordReady", entry: "" },
  bomb: { kind: "page", page: "games/bomb-survivor.html", ready: "!!(window.__bomb && document.getElementById('go'))", entry: "document.getElementById('go').click()" },
  race: { kind: "page", page: "games/race.html", query: "go=1", ready: "!!window.__raceReady", entry: "" },
};
const ALL_MODES = Object.keys(PAGE_MODES);
const modesArg = opt("--modes", opt("--mode", "city"));
const MODES = modesArg === "all" ? ALL_MODES : modesArg.split(",").map((s) => s.trim()).filter(Boolean);
for (const m of MODES) if (!PAGE_MODES[m]) { console.error(`unknown mode ${m}; known: ${ALL_MODES.join(", ")}`); process.exit(2); }
const DO_LOAD = !has("--play") || has("--load");
const DO_PLAY = !has("--load") || has("--play");
const RUNS = Math.max(1, +opt("--runs", 1) || 1);
const SEED = opt("--seed", "90210");
const FRAMES = Math.max(10, +opt("--frames", 20) || 20);
const WARM = Math.max(0, +opt("--warm", 8));
const GPU = opt("--gpu", "real");
const DEVICE = opt("--device", "desktop");
const QUERY = opt("--query", "");
/* --preload <file.js>: extra page script injected before the game (after the
   measuring preload), e.g. a diagnostic allocation tracker. */
const PRELOAD_EXTRA = opt("--preload", "");
/* CITY SLICES (src/core/slice.js): --slice boots ONE piece of Gang City as
   its own world (a name from CBZ.SLICES, or "x,z,r"); the play spots move
   into the slice (its spawn street, its centre, an aerial over it).
   --slice-spots boots the WHOLE city but measures at that slice's spots:
   the fair frame comparison, same place, full world vs slice. */
const SLICE = opt("--slice", "");
const SLICE_SPOTS = opt("--slice-spots", "") || SLICE;
const PROFILE = has("--profile");
/* --heap-sites: V8's sampling heap profiler runs from navigation to settle;
   after the forced GC, the LIVE V8 bytes are listed by allocating game site
   (nearest src/ frame) and by file. ArrayBuffer backing stores are not V8
   heap objects: --preload tools/preload/abtrack.js lists those. */
// --heap-garbage: the same sampler over the load, INCLUDING what the GC
// collected (who makes the build's garbage, not only who holds the heap)
const HEAP_GARBAGE = has("--heap-garbage");
const HEAP_SITES = has("--heap-sites") || HEAP_GARBAGE;
const ATTRIBUTE = has("--attribute");
const SAVE = opt("--save", "");
const JSON_OUT = opt("--json", "");
const URL_ARG = opt("--url", "");
const REF = opt("--ref", "");
const ROOT_ARG = opt("--root", "");
const SHADERS = opt("--shaders", "warm");
if (!/^(warm|cold)$/.test(SHADERS)) { console.error("--shaders is warm or cold"); process.exit(2); }
const RETURN = has("--return");
const SERIAL = has("--serial");
const LOOK_PIX = !has("--no-look");
const MAX_PAIRS = Math.max(1, +opt("--pairs", 5) || 5);
const MIN_PAIRS = Math.min(MAX_PAIRS, Math.max(2, +opt("--min-pairs", 3) || 3));
const LOOK_DIR_ARG = opt("--look-dir", "");
const SERVE = has("--serve");
const ASK = opt("--ask", "");
const QUIET = has("--quiet");
const NO_NORM = has("--no-norm");
const BUILD_BUDGET_S = +opt("--budget", 420);
const SETTLE_MAX = Math.max(6, +opt("--settle", 40));
const LOCK = "/tmp/cbz-speed.lock";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => { if (!QUIET) process.stderr.write(s + "\n"); };
const since = () => ((Date.now() - TOOL_T0) / 1000).toFixed(1) + "s";

/* ---------------- the machine-wide lock (a FIFO queue) ---------------- */
/* /tmp/cbz-speed.lock is the one measurement lock on this Mac (other tools
   write it too: {pid, at: ISO} or a bare pid). v1 waiters polled every 2 s and
   the next owner was whoever polled first, so a short job could starve behind
   long ones for 20+ minutes. v2 waiters take a TICKET in /tmp/cbz-speed.q/
   (a file named by time + pid) and only the OLDEST live ticket may take the
   lock; it polls every 150 ms, so a queue of short jobs (warm-world queries)
   hands over in a blink. Tools that don't queue still just grab it when free. */
const QDIR = "/tmp/cbz-speed.q";
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }
let myTicket = "";
function lockHolder() {
  let cur = null;
  try { cur = JSON.parse(fs.readFileSync(LOCK, "utf8")); } catch (_) {}
  if (cur && typeof cur !== "object") cur = { pid: cur };
  let pid = cur && +cur.pid, born = cur && (+cur.started || Date.parse(cur.at || "") || 0);
  if (!pid) { try { pid = parseInt(fs.readFileSync(LOCK, "utf8"), 10) || 0; } catch (_) {} }
  if (!born) { try { born = fs.statSync(LOCK).mtimeMs; } catch (_) { born = 0; } }
  return { cur, pid, born };
}
async function takeLock(what) {
  const t0 = Date.now();
  try { fs.mkdirSync(QDIR, { recursive: true }); } catch (_) {}
  myTicket = path.join(QDIR, `${String(Date.now()).padStart(15, "0")}-${process.pid}`);
  try { fs.writeFileSync(myTicket, what || argv.join(" ")); } catch (_) { myTicket = ""; }
  let told = false;
  for (;;) {
    // drop dead tickets; am I first in line?
    let first = true;
    try {
      for (const f of fs.readdirSync(QDIR).sort()) {
        const pid = +f.split("-")[1];
        if (!pidAlive(pid)) { try { fs.unlinkSync(path.join(QDIR, f)); } catch (_) {} continue; }
        if (myTicket && path.join(QDIR, f) !== myTicket) first = false;
        break;
      }
    } catch (_) {}
    if (first) {
      try {
        fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, started: Date.now(), cmd: "speed.mjs " + (what || argv.join(" ")) }), { flag: "wx" });
        if (myTicket) try { fs.unlinkSync(myTicket); } catch (_) {}
        myTicket = "";
        return (Date.now() - t0) / 1000;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        // Stale = owner pid dead, or older than 30 min.
        const h = lockHolder();
        if ((h.pid && !pidAlive(h.pid)) || Date.now() - h.born > 30 * 60 * 1000) { try { fs.unlinkSync(LOCK); } catch (_) {} continue; }
        if (!told) { log(`[speed] waiting for ${LOCK} (pid ${h.pid}: ${(h.cur && (h.cur.cmd || h.cur.who || h.cur.tool)) || "?"})`); told = true; }
      }
    } else if (!told) { log(`[speed] queued behind other speed jobs in ${QDIR}`); told = true; }
    await sleep(150);
  }
}
function releaseLock() {
  if (myTicket) { try { fs.unlinkSync(myTicket); } catch (_) {} myTicket = ""; }
  try { const cur = JSON.parse(fs.readFileSync(LOCK, "utf8")); if (cur.pid === process.pid) fs.unlinkSync(LOCK); } catch (_) {}
}
function uptime() {
  const l = os.loadavg();
  return { load1: +l[0].toFixed(2), load5: +l[1].toFixed(2), load15: +l[2].toFixed(2), cpus: os.cpus().length };
}

/* ---------------- what to serve ---------------- */
let ROOT = ROOT0, commit = "";
const tmpDirs = [];
function git(args, cwd) { return execFileSync("git", args, { cwd: cwd || ROOT0, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
function archiveRef(ref) {
  const sha = git(["rev-parse", ref + "^{commit}"]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbz-speed-ref-"));
  tmpDirs.push(dir);
  execFileSync("sh", ["-c", `git archive ${sha} | tar -x -C ${JSON.stringify(dir)}`], { cwd: ROOT0 });
  return { dir, label: sha.slice(0, 10) + " (" + ref + ")" };
}
if (REF) {
  const a = archiveRef(REF); ROOT = a.dir; commit = a.label;
} else if (ROOT_ARG) {
  ROOT = path.resolve(ROOT_ARG); commit = "root " + ROOT;
  try { commit = git(["rev-parse", "--short=10", "HEAD"], ROOT) + (git(["status", "--porcelain", "--untracked-files=no"], ROOT) ? "+dirty" : "") + " (" + ROOT + ")"; } catch (_) {}
} else if (!URL_ARG) {
  try { commit = git(["rev-parse", "--short=10", "HEAD"]) + (git(["status", "--porcelain", "--untracked-files=no"]) ? "+dirty" : ""); } catch (_) {}
}
/* --against: a saved result FILE (unpaired compare), or a live A/B side — a
   git ref (archived to a temp dir) or a URL. "baseline" = the committed file. */
let AGAINST = opt("--against", "");
if (AGAINST === "baseline") AGAINST = path.join(ROOT0, "tools/speed-baseline.json");
let AGAINST_KIND = "";
if (AGAINST) {
  if (/\.json$/i.test(AGAINST) || (fs.existsSync(AGAINST) && fs.statSync(AGAINST).isFile())) AGAINST_KIND = "file";
  else if (/^https?:\/\//.test(AGAINST)) AGAINST_KIND = "url";
  else { try { git(["rev-parse", "--verify", AGAINST + "^{commit}"]); AGAINST_KIND = "ref"; } catch (_) { console.error(`--against ${AGAINST}: not a file, URL or git ref`); process.exit(2); } }
}
const AB = AGAINST_KIND === "ref" || AGAINST_KIND === "url";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".wasm": "application/wasm",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".hdr": "application/octet-stream",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain", ".3mf": "model/3mf" };
function startServer(root) {
  // In-process static server: no python spawn, keep-alive. "no-cache" + an
  // ETag: every page runs in a FRESH browser context, so a first visit is
  // still a cold load, while a --return reload revalidates (304) and gets the
  // HTTP cache and V8's code cache, the way a returning player's browser does.
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(root, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
    if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.stat(f, (e0, st) => {
      if (e0 || !st.isFile()) { res.writeHead(404); return res.end(); }
      const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
      const hdr = { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache", ETag: etag };
      if (req.headers["if-none-match"] === etag) { res.writeHead(304, hdr); return res.end(); }
      fs.readFile(f, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, hdr); res.end(buf);
      });
    });
  });
  srv.keepAliveTimeout = 30000;
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

/* ---------------- Chrome + CDP (one browser, flat sessions) ---------------- */
const CHROME = process.env.CBZ_CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const VIEW = DEVICE === "tablet" ? { w: 1180, h: 820, dpr: 2 } : DEVICE === "phone" ? { w: 390, h: 844, dpr: 3 } : { w: 1512, h: 982, dpr: 2 };
if (!/^(desktop|tablet|phone)$/.test(DEVICE)) { console.error("--device is desktop, tablet or phone"); process.exit(2); }
/* --device phone: an iPhone 14/15-class Safari (390x844 CSS @3x, touch, iOS
   UA). The game reads the UA itself (config.js: /iPhone/ → phone), so no
   ?device= is forced: the tier is whatever the game picks for that phone. */
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
/* iOS Safari kills a tab near 1-1.5 GB (JS heap + GPU together); past
   "reload at 99%" reports were exactly that. The phone total is judged
   against this hard budget. */
const MEM_BUDGET_MB = +opt("--mem-budget", 600);
async function launchChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cbz-speed-chrome-"));
  const gl = GPU === "swiftshader" ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    : GPU === "metal" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : ["--ignore-gpu-blocklist"];
  const proc = spawn(CHROME, ["--headless=new", "--no-sandbox", ...gl, "--enable-webgl", "--mute-audio",
    `--window-size=${VIEW.w},${VIEW.h}`, `--force-device-scale-factor=${VIEW.dpr}`,
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--disable-background-networking", "--disable-component-update", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--enable-precise-memory-info",   // performance.memory live, not bucketed (the memory accounting)
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = "";
    const to = setTimeout(() => rej(new Error("chrome never printed its DevTools endpoint")), 30000);
    proc.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(to); res(m[1]); } });
    proc.on("exit", () => rej(new Error("chrome exited")));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map(); const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id != null && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    for (const l of listeners) l(m);
  };
  const send = (method, params = {}, sessionId, timeoutMs = 60000) => new Promise((res, rej) => {
    const mid = ++id; const t = setTimeout(() => { if (pend.delete(mid)) rej(new Error(`CDP timeout ${method}`)); }, timeoutMs);
    pend.set(mid, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
    ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { proc, ws, send, listeners, profile,
    close() { try { ws.close(); } catch (_) {} try { proc.kill("SIGKILL"); } catch (_) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {} } };
}

/* ---------------- the preload: every commit, every page ---------------- */
const PRELOAD = String.raw`(function(){
if (window.top !== window || window.__speed) return;
var now = function(){ return performance.now(); };
var S = window.__speed = { scripts: [], errs: [], errN: 0, hold: false, q: [], t: 0, marks: {}, raf: [], rafLog: true,
  gls: [], draws: 0, tris: 0, firstDrawAt: 0, steps: [], builders: [], uacc: {}, useries: {}, render: 0, rdepth: 0, finishMs: 0 };
document.addEventListener("load", function(e){ var t = e.target; if (t && t.tagName === "SCRIPT" && t.src) {
  /* prisonRoot's child count after each script: the scripts that grow it are
     the prison being built at parse time, in EVERY mode */
  var pr = -1; try { pr = window.CBZ && CBZ.prisonRoot ? CBZ.prisonRoot.children.length : -1; } catch (_) {}
  S.scripts.push([t.src, now(), pr]); if (S.memSample) S.memSample(); } }, true);
/* window "load" handlers (core/batch.js batches + freezes the prison there): time each */
S.loadHandlers = [];
var wael = window.addEventListener;
window.addEventListener = function(type, fn, o){
  if (type === "load" && typeof fn === "function" && !fn.__sp) { var src = srcOf() || fn.name || "?"; var f = fn;
    var w = function(e){ var s = now(); try { return f.apply(this, arguments); } finally { S.loadHandlers.push([src, now() - s, s]); } };
    w.__sp = 1; return wael.call(this, type, w, o); }
  return wael.apply(this, arguments); };
addEventListener("load", function(){ S.marks.loadStart = now(); });
document.addEventListener("DOMContentLoaded", function(){ S.marks.dcl = now(); });
addEventListener("error", function(e){ S.errN++; if (S.errs.length < 12) S.errs.push(String(e.message || e.type) + (e.filename ? " @" + String(e.filename).split("/").pop() + ":" + e.lineno : "")); }, true);
var ce = console.error; console.error = function(){ S.errN++; if (S.errs.length < 12) { try { S.errs.push(Array.prototype.map.call(arguments, function(a){ return a && a.stack ? String(a.stack).split("\n").slice(0,2).join(" ") : String(a); }).join(" ").slice(0, 240)); } catch (_) {} } return ce.apply(console, arguments); };
/* rAF: live frames are logged; held frames queue for S.step() */
var rAF = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = function(cb){
  if (S.hold) { S.q.push(cb); return 1e7 + S.q.length; }
  /* a frame requested BEFORE the hold that fires after it is queued too, or
     the title loop's in-flight frame would run the first (compiling) render
     unmeasured right after the build */
  return rAF(function(t){ if (S.hold) { S.q.push(cb); return; } var s = now(); try { cb(t); } finally { if (S.rafLog && S.raf.length < 6000) S.raf.push([t, s, now() - s]); } });
};
/* WebGL: capture contexts; count draws (always on; ~20 ns per call) */
var gc = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function(type){ var c = gc.apply(this, arguments); if (c && /webgl/.test(type) && S.gls.indexOf(c) < 0) S.gls.push(c); return c; };
function tri(mode, n){ return mode === 4 ? n / 3 : (mode === 5 || mode === 6) ? Math.max(0, n - 2) : 0; }
function hook(proto, name, cntIdx, instIdx){
  if (!proto || !proto[name]) return; var f = proto[name];
  proto[name] = function(){ if (!S.firstDrawAt) S.firstDrawAt = now(); S.draws++; S.tris += tri(arguments[0], arguments[cntIdx]) * (instIdx != null ? arguments[instIdx] : 1); return f.apply(this, arguments); };
}
[window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach(function(C){ if (!C) return; var p = C.prototype;
  hook(p, "drawArrays", 2); hook(p, "drawElements", 1); hook(p, "drawArraysInstanced", 2, 3); hook(p, "drawElementsInstanced", 1, 4); hook(p, "drawRangeElements", 3); });
/* shader compile: time every GL call that can block on the GPU process's
   compiler (r128 with checkShaderErrors=false blocks at the first
   getProgramParameter/getActiveUniform of a new program, at first draw) */
S.compileMs = 0;
[window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach(function(C){ if (!C) return; var p = C.prototype;
  ["compileShader","linkProgram","getProgramParameter","getShaderParameter","getActiveUniform","getActiveAttrib","getUniformLocation","getAttribLocation","getProgramInfoLog","getShaderInfoLog"].forEach(function(n){
    var f = p[n]; if (!f) return; p[n] = function(){ var s = now(); try { return f.apply(this, arguments); } finally { S.compileMs += now() - s; } }; }); });
var ANGLE = window.ANGLEInstancedArrays; if (ANGLE) { hook(ANGLE.prototype, "drawArraysInstancedANGLE", 2, 3); hook(ANGLE.prototype, "drawElementsInstancedANGLE", 1, 4); }
/* ---- MEMORY, the way a phone feels it (iOS kills a tab near 1-1.5 GB of
   JS heap + GPU allocations together). GPU bytes are accounted at the GL
   level: every allocating call records bytes per GL object in a WeakMap,
   every delete takes them back; live totals + peaks. RGB / RGB16F / RGB32F
   count as 4 channels (Metal has no 3-channel formats; the driver pads).
   The drawing buffer: w*h*(4 color + 4 depth-stencil) * MSAA samples, plus
   the 4-byte resolve buffer when antialiased. JS heap: performance.memory
   (live with --enable-precise-memory-info), sampled at every script load,
   bootStep, landmass builder, stepped frame, GL allocation (throttled) and a
   100 ms timer; the combined "phone" peak is taken at the same instants. */
var M = S.mem = { buf: 0, tex: 0, rb: 0, db: 0, peak: { buf: 0, tex: 0, rb: 0, gpu: 0, heap: 0, heapTotal: 0, phone: 0, cv2d: 0 },
  win: null, nBuf: 0, nTex: 0, nRb: 0, subBytes: 0, samples: 0, lastHeapAt: 0, heap: 0, heapTotal: 0 };
var OBJ = new WeakMap(), cv2d = [];
var BIND = { 34962: 34964, 34963: 34965, 35345: 35368, 36662: 36662, 36663: 36663, 35051: 35053, 35052: 35055, 35982: 35983 };
var TEXB = { 3553: 32873, 32879: 32874, 35866: 35869, 34067: 34068 };
function texBinding(t){ return (t >= 34069 && t <= 34074) ? 34068 : TEXB[t]; }
var SIZED = { 33321: 1, 33323: 2, 32849: 4, 32856: 4, 35905: 4, 35907: 4, 33325: 2, 33327: 4, 34843: 8, 34842: 8, 33326: 4, 33328: 8, 34837: 16, 34836: 16,
  35898: 4, 32857: 4, 33189: 2, 33190: 4, 36012: 4, 35056: 4, 36013: 8, 32854: 2, 36194: 2, 32855: 2, 36168: 1, 33330: 1, 33336: 2, 33334: 4, 33340: 8, 36220: 4, 36208: 16 };
var BASEC = { 6408: 4, 6407: 4, 6410: 2, 6409: 1, 6406: 1, 6402: 1, 34041: 1, 6403: 1, 33319: 2 };
var TYPEB = { 5121: 1, 5120: 1, 5123: 2, 5122: 2, 5125: 4, 5124: 4, 5126: 4, 5131: 2, 36193: 2 };
function bpp(ifmt, type){ if (SIZED[ifmt]) return SIZED[ifmt];
  if (type === 33635 || type === 32819 || type === 32820) return 2; if (type === 34042) return 4;
  return (BASEC[ifmt] || 4) * (TYPEB[type] || 1); }
function srcWH(s){ if (!s) return [0, 0]; var w = s.naturalWidth || s.videoWidth || s.displayWidth || s.width || 0, h = s.naturalHeight || s.videoHeight || s.displayHeight || s.height || 0; return [w, h]; }
function heapNow(force){ var t = now(); if (!force && t - M.lastHeapAt < 4) return; M.lastHeapAt = t; var pm = performance.memory; if (!pm) return;
  M.heap = pm.usedJSHeapSize; M.heapTotal = pm.totalJSHeapSize; M.samples++; }
function dbBytes(){ var sum = 0; for (var i = 0; i < S.gls.length; i++) { var g = S.gls[i]; try { var a = g.__cbzAttr || (g.__cbzAttr = g.getContextAttributes() || {});
    var w = g.drawingBufferWidth, h = g.drawingBufferHeight, per = 4 + (a.depth || a.stencil ? 4 : 0), smp = a.antialias ? 4 : 1;
    sum += w * h * per * smp + (a.antialias ? w * h * 4 : 0); } catch (_) {} } return sum; }
function cv2dBytes(){ var sum = 0, keep = []; for (var i = 0; i < cv2d.length; i++) { var c = cv2d[i].deref ? cv2d[i].deref() : cv2d[i]; if (!c) continue; keep.push(cv2d[i]); sum += (c.width || 0) * (c.height || 0) * 4; } cv2d = keep; return sum; }
function bump(){ var P = M.peak, gpu = M.buf + M.tex + M.rb + M.db, ph = gpu + M.heap;
  if (M.buf > P.buf) P.buf = M.buf; if (M.tex > P.tex) P.tex = M.tex; if (M.rb > P.rb) P.rb = M.rb; if (gpu > P.gpu) P.gpu = gpu; if (M.heap > P.heap) P.heap = M.heap;
  if (M.heapTotal > P.heapTotal) P.heapTotal = M.heapTotal; if (ph > P.phone) P.phone = ph;
  var W = M.win; if (W) { if (gpu > W.gpu) W.gpu = gpu; if (M.heap > W.heap) W.heap = M.heap; if (ph > W.phone) W.phone = ph; } }
S.memSample = function(force){ heapNow(force !== false); M.db = dbBytes(); bump(); };
function setObj(o, kind, key, bytes){ if (!o) return; var r = OBJ.get(o); if (!r) { r = { kind: kind, total: 0, parts: {} }; OBJ.set(o, r); if (kind === "buf") M.nBuf++; else if (kind === "tex") M.nTex++; else M.nRb++; }
  var old = r.parts[key] || 0; r.parts[key] = bytes; r.total += bytes - old; M[kind] += bytes - old; heapNow(false); bump(); }
function freeObj(o){ var r = o && OBJ.get(o); if (!r) return; M[r.kind] -= r.total; if (r.kind === "buf") M.nBuf--; else if (r.kind === "tex") M.nTex--; else M.nRb--; OBJ.delete(o); }
function wrapGL(p, name, fn){ var f = p[name]; if (!f) return; p[name] = function(){ var r = f.apply(this, arguments); try { fn.call(this, arguments); } catch (_) {} return r; }; }
[window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach(function(C){ if (!C) return; var p = C.prototype;
  wrapGL(p, "bufferData", function(a){ var t = a[0], b = this.getParameter(BIND[t] || 34964), d = a[1], n = 0;
    if (typeof d === "number") n = d; else if (d && d.byteLength != null) { var bpe = d.BYTES_PER_ELEMENT || 1, off = a[3] || 0; n = a[4] ? a[4] * bpe : d.byteLength - off * bpe; }
    setObj(b, "buf", "d", n); });
  wrapGL(p, "bufferSubData", function(a){ var d = a[2]; if (d && d.byteLength != null) M.subBytes += a[4] ? a[4] * (d.BYTES_PER_ELEMENT || 1) : d.byteLength; });
  wrapGL(p, "deleteBuffer", function(a){ freeObj(a[0]); });
  wrapGL(p, "texImage2D", function(a){ var t = a[0], tex = this.getParameter(texBinding(t)), w, h, bp;
    if (a.length >= 8 && typeof a[5] === "number") { w = a[3]; h = a[4]; bp = bpp(a[2], a[7]); }
    else { var wh = srcWH(a[5]); w = wh[0]; h = wh[1]; bp = bpp(a[2], a[4]); }
    setObj(tex, "tex", t + ":" + a[1], w * h * bp); });
  wrapGL(p, "texImage3D", function(a){ var tex = this.getParameter(texBinding(a[0])); setObj(tex, "tex", a[0] + ":" + a[1], a[3] * a[4] * a[5] * bpp(a[2], a[8])); });
  wrapGL(p, "copyTexImage2D", function(a){ var tex = this.getParameter(texBinding(a[0])); setObj(tex, "tex", a[0] + ":" + a[1], a[5] * a[6] * bpp(a[2], 5121)); });
  wrapGL(p, "compressedTexImage2D", function(a){ var tex = this.getParameter(texBinding(a[0])), d = a[6]; var n = typeof d === "number" ? d : (a[8] ? a[8] * (d.BYTES_PER_ELEMENT || 1) : d ? d.byteLength : 0);
    setObj(tex, "tex", a[0] + ":" + a[1], n); });
  wrapGL(p, "texStorage2D", function(a){ var tex = this.getParameter(texBinding(a[0])), faces = a[0] === 34067 ? 6 : 1, w = a[3], h = a[4], n = 0;
    for (var l = 0; l < a[1]; l++) { n += Math.max(1, w >> l) * Math.max(1, h >> l) * bpp(a[2], 0); } setObj(tex, "tex", "storage", n * faces); });
  wrapGL(p, "texStorage3D", function(a){ var tex = this.getParameter(texBinding(a[0])), n = 0;
    for (var l = 0; l < a[1]; l++) n += Math.max(1, a[3] >> l) * Math.max(1, a[4] >> l) * (a[0] === 32879 ? Math.max(1, a[5] >> l) : a[5]) * bpp(a[2], 0); setObj(tex, "tex", "storage", n); });
  wrapGL(p, "generateMipmap", function(a){ var tex = this.getParameter(texBinding(a[0])), r = tex && OBJ.get(tex); if (!r || r.parts.storage) return;
    var base = 0; for (var k in r.parts) if (/:0$/.test(k)) base += r.parts[k]; setObj(tex, "tex", "mips", Math.round(base / 3)); });
  wrapGL(p, "deleteTexture", function(a){ freeObj(a[0]); });
  wrapGL(p, "renderbufferStorage", function(a){ var rb = this.getParameter(36007); setObj(rb, "rb", "s", a[2] * a[3] * (a[1] === 34041 ? 4 : bpp(a[1], 5121))); });
  wrapGL(p, "renderbufferStorageMultisample", function(a){ var rb = this.getParameter(36007); setObj(rb, "rb", "s", Math.max(1, a[1]) * a[3] * a[4] * (a[2] === 34041 ? 4 : bpp(a[2], 5121))); });
  wrapGL(p, "deleteRenderbuffer", function(a){ freeObj(a[0]); });
});
/* 2D canvases: iOS caps total canvas memory too (a past bug). Live = still referenced. */
[window.HTMLCanvasElement, window.OffscreenCanvas].forEach(function(K){ if (!K) return; var g2 = K.prototype.getContext;
  K.prototype.getContext = function(type){ var c = g2.apply(this, arguments); if (c && type === "2d" && !this.__cbz2d) { this.__cbz2d = 1; cv2d.push(window.WeakRef ? new WeakRef(this) : this); } return c; }; });
S.memWin = function(){ S.memSample(); M.win = { gpu: M.buf + M.tex + M.rb + M.db, heap: M.heap, phone: M.buf + M.tex + M.rb + M.db + M.heap }; };
S.memRead = function(){ S.memSample(); var c2 = cv2dBytes(); if (c2 > M.peak.cv2d) M.peak.cv2d = c2; var MB = function(x){ return +(x / 1048576).toFixed(1); }, P = M.peak, W = M.win;
  return { heap: MB(M.heap), heapTotal: MB(M.heapTotal), gpu: MB(M.buf + M.tex + M.rb + M.db), buf: MB(M.buf), tex: MB(M.tex), rb: MB(M.rb), db: MB(M.db),
    phone: MB(M.buf + M.tex + M.rb + M.db + M.heap), cv2d: MB(c2), nBuf: M.nBuf, nTex: M.nTex, nRb: M.nRb, subMB: MB(M.subBytes), samples: M.samples, precise: !!(performance.memory && performance.memory.usedJSHeapSize % 4096),
    peak: { heap: MB(P.heap), heapTotal: MB(P.heapTotal), gpu: MB(P.gpu), buf: MB(P.buf), tex: MB(P.tex), rb: MB(P.rb), phone: MB(P.phone), cv2d: MB(P.cv2d) },
    win: W ? { heap: MB(W.heap), gpu: MB(W.gpu), phone: MB(W.phone) } : null }; };
setInterval(function(){ S.memSample(); }, 100);
/* COLD SHADERS: rename main() with this run's nonce and call it from a new
   main(). Same GPU code after the driver inlines it, but new source text, so
   macOS's system Metal cache and Chrome's program cache both miss (verified:
   30 programs 3.8 s salted vs 0.32 s re-run; a comment or #define does NOT
   miss, ANGLE strips them). "" = warm: nothing injected. */
S.salt = __CBZ_SALT__; S.salted = 0;
if (S.salt) [window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach(function(C){ if (!C) return; var p = C.prototype, f = p.shaderSource;
  p.shaderSource = function(sh, src){ if (typeof src === "string" && /\bvoid\s+main\s*\(/.test(src)) { var nm = "cbz_main_" + S.salt;
    src = src.replace(/\bvoid\s+main\s*\(\s*(?:void\s*)?\)/, "void " + nm + "()") + "\nvoid main() { " + nm + "(); }\n"; S.salted++; }
    return f.call(this, sh, src); }; });
/* REAL GPU MS PER PASS: EXT_disjoint_timer_query_webgl2 (verified linear on
   headless ANGLE-Metal). TIME_ELAPSED queries cannot nest, so a pass that
   starts inside another (the shadow map inside render(), a cctv render
   inside an updater) closes the outer segment and reopens it after. Results
   become readable only after the page returns to its event loop; they are
   collected after the stepped frames (S.tqCollect). */
S.tq = { on: false, ext: null, gl: null, cur: null, stack: [], pend: [], frame: 0 };
S.tqInit = function(){ var T = S.tq; if (T.ext) return true; var gl = S.gl(); if (!gl || !window.WebGL2RenderingContext || !(gl instanceof WebGL2RenderingContext)) return false;
  var e = null; try { e = gl.getExtension("EXT_disjoint_timer_query_webgl2"); } catch (_) {} if (!e) return false; T.gl = gl; T.ext = e; return true; };
function tqStart(cat){ var T = S.tq, q = T.gl.createQuery(); T.gl.beginQuery(T.ext.TIME_ELAPSED_EXT, q); T.cur = [cat, q]; }
function tqStop(){ var T = S.tq; if (!T.cur) return; T.gl.endQuery(T.ext.TIME_ELAPSED_EXT); T.pend.push([T.frame, T.cur[0], T.cur[1]]); T.cur = null; }
S.tqPush = function(cat){ var T = S.tq; if (!T.on || !T.ext) return; var prev = T.cur ? T.cur[0] : null; tqStop(); T.stack.push(prev); tqStart(cat); };
S.tqPop = function(){ var T = S.tq; if (!T.on || !T.ext) return; tqStop(); var prev = T.stack.pop(); if (prev) tqStart(prev); };
S.tqCur = function(){ return S.tq.cur ? S.tq.cur[0] : ""; };
S.tqCollect = function(timeoutMs){ var T = S.tq; return new Promise(function(res){
  if (!T.ext) return res({ frames: {}, disjoint: false, lost: 0 });
  var gl = T.gl, t0 = now(), out = {}, bad = false;
  (function chk(){ var rest = [];
    for (var i = 0; i < T.pend.length; i++) { var e = T.pend[i];
      if (gl.getQueryParameter(e[2], gl.QUERY_RESULT_AVAILABLE)) { var ms = gl.getQueryParameter(e[2], gl.QUERY_RESULT) / 1e6; var f = out[e[0]] || (out[e[0]] = {}); f[e[1]] = (f[e[1]] || 0) + ms; gl.deleteQuery(e[2]); }
      else rest.push(e); }
    T.pend = rest; if (gl.getParameter(T.ext.GPU_DISJOINT_EXT)) bad = true;
    if (!rest.length || now() - t0 > timeoutMs) { rest.forEach(function(e){ gl.deleteQuery(e[2]); }); T.pend = []; res({ frames: out, disjoint: bad, lost: rest.length }); }
    else setTimeout(chk, 10); })(); }); };
/* PIXELS for the look guard: the finished frame as the game drew it (same
   task as the render, so the drawing buffer is still intact). */
S.grab = function(gl){ var w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
  try { gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); S.shot = { w: w, h: h, px: px }; } catch (_) { S.shot = null; } };
function b64(u){ var s = "", CH = 0x8000; for (var i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH)); return btoa(s); }
S.shotOut = function(){ var s = S.shot; if (!s) return null; S.shot = null;
  var w = s.w, h = s.h, px = s.px, k = (w * h > 2.6e6) ? 2 : 1, lw = Math.floor(w / k), lh = Math.floor(h / k), L = new Uint8Array(lw * lh);
  /* luma (Rec.709 weights on the sRGB bytes), top row first; box-downsampled only past 2.6 MP */
  for (var y = 0; y < lh; y++) for (var x = 0; x < lw; x++) { var acc = 0;
    for (var dy = 0; dy < k; dy++) for (var dx = 0; dx < k; dx++) { var i = ((h - 1 - (y * k + dy)) * w + x * k + dx) * 4; acc += px[i] * 54 + px[i + 1] * 183 + px[i + 2] * 19; }
    L[y * lw + x] = (acc / (k * k)) >> 8; }
  var hw = w >> 1, hh = h >> 1, R = new Uint8Array(hw * hh * 3);
  for (var y2 = 0; y2 < hh; y2++) for (var x2 = 0; x2 < hw; x2++) { var a = ((h - 1 - 2 * y2) * w + 2 * x2) * 4, b = a - w * 4, d = (y2 * hw + x2) * 3;
    for (var c = 0; c < 3; c++) R[d + c] = (px[a + c] + px[a + 4 + c] + px[b + c] + px[b + 4 + c]) >> 2; }
  return { w: lw, h: lh, luma: b64(L), hw: hw, hh: hh, rgb: b64(R) }; };
/* Name every updater: trap CBZ.onUpdate/onAlways so each entry carries the file:line that registered it (config.js's own source tag only exists under ?profile=1). */
function srcOf(){ var st = (new Error()).stack || ""; var L = st.split("\n");
  for (var i = 2; i < L.length; i++) { var m = L[i].match(/((?:src|games)\/[^:?)]+\.js)(?:\?[^:)\s]+)?:(\d+)/); if (m && !/src\/(config|core\/prio|core\/microboot|core\/studio)\.js/.test(m[1])) return m[1] + ":" + m[2]; }
  return ""; }
function trapReg(C, name, listName){ var cur = C[name];
  Object.defineProperty(C, name, { configurable: true, enumerable: true, get: function(){ return cur; }, set: function(fn){
    if (typeof fn !== "function" || fn.__sp) { cur = fn; return; }
    var w = function(order, f){ var list = C[listName]; var n0 = list ? list.length : 0; var r = fn.apply(this, arguments);
      list = C[listName]; if (list && list.length > n0) { var e = list[list.length - 1]; if (e && !e.__src) e.__src = srcOf(); } return r; };
    w.__sp = 1; cur = w; } });
  if (cur) C[name] = cur; }
var CBZv;
try { Object.defineProperty(window, "CBZ", { configurable: true, enumerable: true, get: function(){ return CBZv; }, set: function(v){
  CBZv = v; if (v && typeof v === "object" && !v.__spTrap) { v.__spTrap = 1; trapReg(v, "onUpdate", "updaters"); trapReg(v, "onAlways", "always"); } } }); } catch (_) {}

/* ---- the build: checkpoints + landmass builders (armed before startRun) ---- */
S.armBuild = function(){
  var C = window.CBZ; if (!C || S.buildArmed) return; S.buildArmed = 1;
  var bs = C.bootStep; C.bootStep = function(k){ S.steps.push([k == null ? "?" : String(k), now()]); S.memSample(); if (bs) return bs.apply(this, arguments); };
  (C._landmassBuilders || []).forEach(function(b, i){ if (b.__sp) return; b.__sp = 1; var f = b.fn;
    var name = String(b.bootKey || b.file || (f && f.name) || ("builder#" + i)).replace(/^lm:/, "").replace(/^.*\//, "");
    b.fn = function(){ var st = S.steps[S.steps.length - 1]; if (st && st[0] === "?") st[0] = "lm:" + name;
      var s = now(); try { return f.apply(this, arguments); } finally { S.builders.push([name, now() - s]); S.memSample(); } }; });
};
/* ---- per-frame accounting ---- */
function keyOf(e, kind){ return kind + "@" + e.order + " " + (e.__src || e.source || (e.fn && e.fn.name) || "?"); }
S.wrapUpdaters = function(){
  var C = window.CBZ; if (!C) return 0; var n = 0;
  [["u", C.updaters], ["a", C.always]].forEach(function(p){ var list = p[1] || [];
    for (var i = 0; i < list.length; i++) (function(e){ if (!e || e.__spw || typeof e.fn !== "function") return; e.__spw = 1; n++;
      var f = e.fn, k = keyOf(e, p[0]); if (S.uacc[k] == null) S.uacc[k] = 0;
      e.fn = function(dt){ var s = now(); try { return f.call(this, dt); } finally { S.uacc[k] += now() - s; } }; })(list[i]); });
  return n;
};
S.wrapRender = function(){
  var C = window.CBZ, r = C && C.renderer; if (!r || r.render.__sp) return !!r;
  var real = r.render;
  r.render = function(scene, cam){
    var main = cam === C.camera;
    if (S.rdepth++ === 0 && S.pose && main) S.applyPose(cam);
    /* GPU pass name: "main" for the player's camera; any other render is
       "rt:" (into a render target) or "other:" + the file:line that asked */
    if (S.tq.on) { var tgt = null; try { tgt = this.getRenderTarget(); } catch (_) {}
      S.tqPush(main ? "main" : (tgt ? "rt:" : "other:") + (srcOf() || "?")); }
    var s = now(); try { return real.apply(this, arguments); } finally { if (S.tq.on) S.tqPop(); if (--S.rdepth === 0) { if (main) S.render += now() - s; else S.renderOther += now() - s; } } };
  r.render.__sp = 1;
  var sm = r.shadowMap; if (sm && sm.render && !sm.render.__sp) { var sr = sm.render;
    sm.render = function(){ var outer = S.tqCur(); S.tqPush(outer === "main" || !outer ? "shadow" : "shadow(" + outer.split(":")[0] + ")");
      try { return sr.apply(this, arguments); } finally { S.tqPop(); } }; sm.render.__sp = 1; }
  return true;
};
S.gl = function(){ var C = window.CBZ; if (C && C.renderer && C.renderer.getContext) return C.renderer.getContext(); return S.gls[S.gls.length - 1] || null; };
/* MACHINE SPEED: a fixed JS workload, median of 5, taken beside every
   measurement. On a shared Mac, run-to-run noise is the box, not the frames
   (measured: 3 runs at load 9→25 spread 20% while 20 vs 60 frames changed
   nothing). A compare scales CPU-ms metrics by the ratio of the two results'
   calibrations so a busy box is not read as a regression. */
S.calib = function(){ var a = [];
  for (var k = 0; k < 5; k++) { var t = now(), x = 0; for (var i = 0; i < 1500000; i++) { x += Math.sqrt(i ^ (x & 1023)); } a.push(now() - t); S._cx = x; }
  a.sort(function(p, q){ return p - q; }); return a[2]; };
S.hold_ = function(){ S.hold = true; S.rafLog = false; S.t = now(); };
/* Step n held frames with a synthetic 1/60 clock. Returns per-frame rows.
   o.finish: read a pixel back after every frame (row.fin = the GPU wait;
   serializes CPU and GPU: the load's first frames and --serial).
   o.gpu: time every pass with timer queries (row.tf = the frame's query key;
   S.tqCollect() fills them in later). o.grab: keep the last frame's pixels. */
S.step = function(n, o){
  o = o || {}; var C = window.CBZ, r = C && C.renderer, gl = S.gl(), out = [];
  if (r && r.info) r.info.autoReset = false;
  var useTq = !!(o.gpu && S.tqInit());
  for (var i = 0; i < n; i++) {
    if (o.path) o.path(i, n);
    if (!o.frozen) S.t += 1000 / 60;   /* frozen: dt = 0, the world stands still (the look guard's A/B shots) */
    if (useTq) { S.tq.frame++; S.tq.on = true; S.tqPush("frame"); }
    if (!S.q.length && !S.kicked && C && C.startLoop) { S.kicked = 1; C.startLoop(); }   // loop not pending: restart it into the hold queue
    var cbs = S.q; S.q = [];
    for (var k in S.uacc) S.uacc[k] = 0;
    S.render = 0; S.renderOther = 0; S.draws = 0; S.tris = 0; S.compileMs = 0;
    var p0 = r && r.info && r.info.programs ? r.info.programs.length : 0;
    if (r && r.info) r.info.reset();
    var s = now();
    for (var j = 0; j < cbs.length; j++) { try { cbs[j](S.t); } catch (e) { S.errN++; if (S.errs.length < 12) S.errs.push("[step] " + (e && e.message)); } }
    var cpu = now() - s, fin = 0;
    S.memSample();
    if (useTq) { S.tqPop(); S.tq.on = false; S.tq.stack.length = 0; }
    /* GPU proxy: a 1-pixel readback cannot return until the GPU has finished
       the frame (gl.finish() is a no-op wait in Chrome: measured 0.0 ms). */
    if (gl && o.finish) { var f0 = now(); try { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, S.px || (S.px = new Uint8Array(4))); } catch (_) {} fin = now() - f0; }
    if (gl && o.grab && i === n - 1) S.grab(gl);
    var sim = 0, alw = 0, row = { cpu: cpu, fin: fin, render: S.render, rOther: S.renderOther, compile: S.compileMs, draws: S.draws, glTris: Math.round(S.tris) };
    if (useTq) row.tf = S.tq.frame;
    if (o.perUpdater) row.u = {};
    for (var key in S.uacc) { var v = S.uacc[key]; if (key.charCodeAt(0) === 117) sim += v; else alw += v; if (o.perUpdater && v > 0) row.u[key] = v; }
    row.sim = sim; row.alw = alw;
    if (r && r.info) { row.calls = r.info.render.calls; row.tris = r.info.render.triangles; row.programs = r.info.programs ? r.info.programs.length : 0; row.newPrograms = row.programs - p0; }
    if (!cbs.length) row.empty = 1;
    out.push(row);
  }
  if (r && r.info) r.info.autoReset = true;
  return out;
};
})();`;

/* ---------------- page helpers (in-page functions sent as source) ---------------- */
// Everything below is evaluated in the page. Plain ES5-ish, no backticks.
const PAGE_LIB = String.raw`(function(){
var S = window.__speed, C = window.CBZ, now = function(){ return performance.now(); };
var VEG = /tree|forest|canopy|foliage|vegetation|palm|pine|spruce|conifer|bush|shrub|grass|frond|leaf|crown|trunk|thicket|hedge|saguaro|cactus|jungle|wood(?!en|work)|orchard|reed|fern/i;
function isVeg(o){ if (VEG.test(o.name || "")) return true; var m = o.material; if (Array.isArray(m)) m = m[0];
  if (m && /vegetation|foliage|leaf|bark|palm|tree|grass/i.test(m.name || "")) return true;
  if (o.geometry && VEG.test(o.geometry.name || "")) return true; return false; }
function visibleUp(o){ while (o) { if (!o.visible) return false; o = o.parent; } return true; }
function triOf(g){ if (!g) return 0; var n = g.index ? g.index.count : (g.attributes && g.attributes.position ? g.attributes.position.count : 0); var dr = g.drawRange; if (dr && dr.count !== Infinity) n = Math.min(n, dr.count); return n / 3; }
/* scene census: counts + vegetation + the LOOK fields */
S.census = function(){
  var sc = C.scene, out = { objects: 0, meshes: 0, visibleMeshes: 0, instanced: 0, instances: 0, visibleInstances: 0, sceneTris: 0,
    veg: { meshes: 0, instancedMeshes: 0, instances: 0, visibleInstances: 0, tris: 0, visibleTris: 0, castShadow: 0, names: {} } };
  var texSeen = new Set(), texPx = 0, texMax = 0;
  sc.traverse(function(o){ out.objects++;
    if (!o.isMesh && !o.isInstancedMesh && !o.isPoints && !o.isLine) return;
    out.meshes++; var vis = visibleUp(o); if (vis) out.visibleMeshes++;
    var inst = o.isInstancedMesh ? o.count : 1, t = triOf(o.geometry) * inst;
    if (o.isInstancedMesh) { out.instanced++; out.instances += inst; if (vis) out.visibleInstances += inst; }
    if (vis) out.sceneTris += t;
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    for (var i = 0; i < mats.length; i++) { var m = mats[i]; if (!m) continue;
      ["map","normalMap","roughnessMap","emissiveMap","alphaMap","aoMap","bumpMap"].forEach(function(k){ var tx = m[k]; if (!tx || texSeen.has(tx)) return; texSeen.add(tx);
        var im = tx.image; var w = im && (im.width || (im.data && im.width)) || 0, h = im && im.height || 0; texPx += w * h; texMax = Math.max(texMax, w, h); }); }
    if (isVeg(o)) { var v = out.veg; if (o.isInstancedMesh) { v.instancedMeshes++; v.instances += inst; if (vis) v.visibleInstances += inst; } else v.meshes++;
      v.tris += t; if (vis) v.visibleTris += t; if (o.castShadow) v.castShadow++;
      var nm = (o.name || (o.material && o.material.name) || "?").replace(/[0-9]+/g, "#").slice(0, 40); v.names[nm] = (v.names[nm] || 0) + inst; }
  });
  out.sceneTris = Math.round(out.sceneTris); out.veg.tris = Math.round(out.veg.tris); out.veg.visibleTris = Math.round(out.veg.visibleTris);
  var top = Object.keys(out.veg.names).map(function(k){ return [k, out.veg.names[k]]; }).sort(function(a,b){ return b[1]-a[1]; }).slice(0, 12);
  out.veg.names = top;
  try { if (C.treeAudit) { var ta = C.treeAudit(); out.veg.registeredTrees = ta && ta.trees; } } catch (_) {}
  out.textures = { unique: texSeen.size, megapixels: +(texPx / 1e6).toFixed(2), maxDim: texMax };
  return out;
};
S.look = function(){
  var r = C.renderer, gl = r && r.getContext && r.getContext(), sun = C.sun, L = {};
  try { L.pixelRatio = +r.getPixelRatio().toFixed(3); } catch (_) {}
  try { L.drawingBuffer = gl.drawingBufferWidth + "x" + gl.drawingBufferHeight; L.bufferMP = +((gl.drawingBufferWidth * gl.drawingBufferHeight) / 1e6).toFixed(3); } catch (_) {}
  try { L.devicePixelRatio = devicePixelRatio; L.css = innerWidth + "x" + innerHeight; } catch (_) {}
  try { if (C.getQualityLevel) L.tier = C.getQualityLevel(); } catch (_) {}
  try { L.deviceClass = C.deviceClass; L.gpu = C.gpuName || ""; } catch (_) {}
  try { L.shadows = !!(r.shadowMap && r.shadowMap.enabled) && !!(sun && sun.castShadow); L.shadowMap = sun && sun.shadow ? sun.shadow.mapSize.x : 0; } catch (_) {}
  try { L.fogFar = C.scene.fog ? Math.round(C.scene.fog.far) : 0; } catch (_) {}
  try { L.antialias = gl.getContextAttributes().antialias; } catch (_) {}
  return L;
};
/* ---- the city's fixed spots (deterministic from the seed's world) ---- */
function P(){ return C.player; }
function ground(x, z){ try { var f = C.groundAt || C.cityGroundHeightAt || C.terrainHeight; if (f) { var y = f(x, z); if (y != null && isFinite(y)) return y; } } catch (_) {} return null; }
S.spots = function(){
  var p = P(), out = {};
  if (p && p.pos) out.spawn = { x: p.pos.x, y: p.pos.y, z: p.pos.z, player: true };
  /* densest downtown: the 160 m cell holding the most building-ish meshes */
  var cells = {}, vcells = {}, sc = C.scene, v3 = new THREE.Vector3(), m4 = new THREE.Matrix4();
  var root = (C.city && C.city.arena && C.city.arena.root) || sc;
  root.updateMatrixWorld(true);
  root.traverse(function(o){
    if (!o.isMesh) return;
    if (o.isInstancedMesh && isVeg(o)) {
      var step = Math.max(1, Math.floor(o.count / 400));
      for (var i = 0; i < o.count; i += step) { o.getMatrixAt(i, m4); v3.setFromMatrixPosition(m4).applyMatrix4(o.matrixWorld);
        var k = Math.floor(v3.x / 400) + "," + Math.floor(v3.z / 400); vcells[k] = (vcells[k] || 0) + step; }
      return;
    }
    if (isVeg(o)) return;
    var g = o.geometry; if (!g) return; if (!g.boundingBox) try { g.computeBoundingBox(); } catch (_) { return; }
    var bb = g.boundingBox; if (!bb || !isFinite(bb.max.y)) return;
    var hgt = (bb.max.y - bb.min.y) * o.matrixWorld.elements[5];
    if (hgt < 12) return;
    v3.setFromMatrixPosition(o.matrixWorld);
    var k2 = Math.floor(v3.x / 160) + "," + Math.floor(v3.z / 160); cells[k2] = (cells[k2] || 0) + 1;
  });
  function best(c, sz){ var bk = null, bn = -1; for (var k in c) if (c[k] > bn) { bn = c[k]; bk = k; } if (!bk) return null; var a = bk.split(","); return { x: (+a[0] + 0.5) * sz, z: (+a[1] + 0.5) * sz, n: bn }; }
  var d = best(cells, 160); if (d) {
    /* stand where a pedestrian stands (a pavement), not inside a tower */
    var bp = null, bd = 1e18; (C.cityPeds || []).forEach(function(q){ var qp = q && (q.pos || (q.group && q.group.position) || (q.mesh && q.mesh.position)); if (!qp || q.dead) return;
      var dd = (qp.x - d.x) * (qp.x - d.x) + (qp.z - d.z) * (qp.z - d.z); if (dd < bd) { bd = dd; bp = qp; } });
    if (bp && bd < 150 * 150) out.downtown = { x: bp.x, y: bp.y, z: bp.z, n: d.n, player: true, via: "ped" };
    else { var gy = ground(d.x, d.z); out.downtown = { x: d.x, y: (gy != null ? gy : (p ? p.pos.y : 0)), z: d.z, n: d.n, player: true }; } }
  var f = best(vcells, 400); if (f) { var fy = ground(f.x, f.z); if (fy == null) fy = 0;
    out.aerial = { x: f.x, y: fy, z: f.z, n: f.n, cam: { x: f.x - 160, y: fy + 110, z: f.z - 160, lx: f.x, ly: fy, lz: f.z } }; }
  return out;
};
/* CITY SLICES: the slice's own three places. spawn = where a slice boot puts
   the player (its nearest street to the centre); downtown = the slice centre
   at street level (the "in the thick of it" spot, named downtown so the
   table lines up with the whole city's); aerial = 110 m over it. The same
   spots are computed on a whole-city boot (--slice-spots) for the pair. */
S.sliceSpots = function(name){
  var s = C.slice || (C.sliceParse && C.sliceParse(name)); if (!s) return S.spots();
  var A = C.city && C.city.arena, tmp = { pos: new THREE.Vector3() }, saved = C.slice;
  C.slice = s; try { C.slicePlacePlayer(A, tmp); } finally { C.slice = saved; }
  var out = { spawn: { x: tmp.pos.x, y: tmp.pos.y, z: tmp.pos.z, player: true, slice: s.name } };
  var gy = ground(s.x, s.z); if (gy == null) gy = 0;
  out.downtown = { x: s.x, y: gy, z: s.z, player: true, slice: s.name };
  out.aerial = { x: s.x, y: gy, z: s.z, cam: { x: s.x - 160, y: gy + 110, z: s.z - 160, lx: s.x, ly: gy, lz: s.z } };
  return out;
};
S.applyPose = function(cam){ var q = S.pose; cam.position.set(q.x, q.y, q.z); cam.lookAt(q.lx, q.ly, q.lz); cam.updateMatrixWorld(true);
  try { var rig = C.skyDome && C.skyDome.parent; if (rig && rig.position) rig.position.set(q.x, 0, q.z); } catch (_) {} };
S.place = function(s){
  var p = P(); S.pose = s.cam || null;
  if (p && p.pos) { try { if (p.driving && C.exitVehicle) C.exitVehicle(); } catch (_) {}
    p.pos.x = s.x; p.pos.z = s.z; if (s.y != null && isFinite(s.y)) p.pos.y = s.y;
    if (p.vel) { p.vel.x = 0; p.vel.y = 0; p.vel.z = 0; } p.hp = Math.max(p.hp || 0, 100); }
  if (S.pose) S.applyPose(C.camera);
};
/* PIN: a spot is a spot. The campaign spawn is a rooftop drop, so an unpinned
   player falls through the measurement and every run sees a different view. */
S.pin = function(s){ return function(){ var p = P(); if (!p || !p.pos) return; p.pos.x = s.x; p.pos.z = s.z; if (s.y != null && isFinite(s.y)) p.pos.y = s.y;
  if (p.vel) { p.vel.x = 0; p.vel.y = 0; p.vel.z = 0; } p.hp = Math.max(p.hp || 0, 100); }; };
/* a straight drive from spawn toward downtown at 25 m/s */
S.pathFn = function(a, b){ return function(i, n){ var p = P(); if (!p || !p.pos) return; var f = Math.min(1, (i * 25 / 60) / Math.max(1, Math.hypot(b.x - a.x, b.z - a.z)));
  p.pos.x = a.x + (b.x - a.x) * f; p.pos.z = a.z + (b.z - a.z) * f; var gy = ground(p.pos.x, p.pos.z); if (gy != null) p.pos.y = gy; p.hp = Math.max(p.hp || 0, 100); }; };
/* Fill each row's GPU pass times from the collected timer queries, then the
   frame model: frame = max(cpu, gpu) when the GPU was timed (a browser
   pipelines CPU and GPU), cpu + readback wait when it was serialized. */
S.finishRows = function(rows, col){
  var F = (col && col.frames) || {}, anyGpu = false;
  rows.forEach(function(r){
    var g = r.tf != null ? F[r.tf] : null;
    if (g) { anyGpu = true; var tot = 0, sh = 0, rt = 0, mn = 0, lo = 0;
      /* "frame" = GPU work outside any render() (uploads, clears, a page that never calls CBZ.renderer) */
      for (var k in g) { var v = g[k]; tot += v; if (k === "main") mn += v; else if (k.indexOf("shadow") === 0) sh += v; else if (k === "frame") lo += v; else rt += v; }
      r.gpu = tot; r.gMain = mn; r.gShadow = sh; r.gRt = rt; r.gLoose = lo; r.gp = g; }
    r.frameSum = r.cpu + (g ? r.gpu : r.fin);
    r.frame = g && !r.fin ? Math.max(r.cpu, r.gpu) : r.cpu + r.fin;
  });
  return anyGpu;
};
S.summ = function(rows){
  if (rows.length && rows[0].frame == null) S.finishRows(rows, null);
  function st(k){ var a = rows.map(function(r){ return r[k] || 0; }).sort(function(x,y){ return x-y; }); var n = a.length; if (!n) return null;
    var med = a[n >> 1], p95 = a[Math.min(n - 1, Math.floor(n * 0.95))];
    var dev = a.map(function(v){ return Math.abs(v - med); }).sort(function(x,y){ return x-y; })[n >> 1];
    return { med: med, p95: p95, mad: dev, n: n }; }
  var o = {}; ["cpu","fin","frame","frameSum","render","rOther","compile","sim","alw","calls","tris","draws","glTris","programs"].forEach(function(k){ o[k] = st(k); });
  if (rows.some(function(r){ return r.gpu != null; })) { ["gpu","gMain","gShadow","gRt","gLoose"].forEach(function(k){ o[k] = st(k); });
    /* per pass: MEAN ms/frame (a cctv feed that renders every 4th frame counts at its real weight) */
    var pa = {}; rows.forEach(function(r){ if (r.gp) for (var k in r.gp) pa[k] = (pa[k] || 0) + r.gp[k]; });
    o.gpuPasses = Object.keys(pa).map(function(k){ return [k, pa[k] / rows.length]; }).sort(function(a, b){ return b[1] - a[1]; }).slice(0, 12); }
  /* hitches: frames over 3x the median, with who did it */
  var cm = o.cpu ? o.cpu.med : 0; o.hitches = []; o.hitchMs = 0;
  rows.forEach(function(r, i){ if (r.cpu > Math.max(3 * cm, cm + 50)) { o.hitchMs += r.cpu - cm; var w = null, wv = 0; if (r.u) for (var k in r.u) if (r.u[k] > wv) { wv = r.u[k]; w = k; }
    if (r.render - cm > wv) { w = "render"; wv = r.render; } o.hitches.push([i, Math.round(r.cpu), w, Math.round(wv), r.newPrograms || 0]); } });
  o.hitches = o.hitches.slice(0, 12);
  var s0 = 0; rows.forEach(function(r){ s0 += r.frame; }); o.meanFrame = s0 / rows.length;
  o.series = rows.map(function(r){ return Math.round(r.frame * 10) / 10; });
  var ups = {}; rows.forEach(function(r){ if (r.u) for (var k in r.u) (ups[k] = ups[k] || []).push(r.u[k]); });
  var ul = Object.keys(ups).map(function(k){ var a = ups[k].concat(); while (a.length < rows.length) a.push(0); a.sort(function(x,y){ return x-y; });
    var sum = 0; for (var i = 0; i < a.length; i++) sum += a[i];
    return [k, a[a.length >> 1], a[Math.min(a.length - 1, Math.floor(a.length * 0.95))], sum / a.length]; });
  ul.sort(function(x, y){ return y[3] - x[3]; });
  o.updaters = ul.slice(0, 40);
  return o;
};
return true;
})()`;

/* ---------------- one page run ---------------- */
function modeUrl(base, m) {
  const d = PAGE_MODES[m];
  const q = [];
  if (d.kind === "cbz") q.push("mode=" + d.mode);
  if (d.query) q.push(d.query);
  q.push("seed=" + SEED);
  if (DEVICE === "tablet") q.push("device=" + DEVICE);   // phone: the game detects it from the UA
  if (QUERY) q.push(QUERY.replace(/^[?&]/, ""));
  if (SLICE && d.mode === "city") q.push("slice=" + encodeURIComponent(SLICE));
  return base.replace(/\/?$/, "/") + d.page + "?" + q.join("&");
}

let NONCE_N = 0;
function newNonce() { return SHADERS === "cold" ? (Date.now() % 1e8).toString(36) + (++NONCE_N).toString(36) + Math.floor(Math.random() * 1e6).toString(36) : ""; }
async function newPage(B, salt = newNonce()) {
  const { browserContextId } = await B.send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await B.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await B.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p, t) => B.send(m, p, sessionId, t);
  await s("Page.enable"); await s("Runtime.enable");
  try { await s("Performance.enable"); } catch (_) {}
  const ev = async (expression, timeoutMs = 60000) => {
    const r = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, timeout: timeoutMs }, timeoutMs + 5000);
    if (r.exceptionDetails) throw new Error("page threw: " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 400));
    return r.result.value;
  };
  let pre = PRELOAD.replace("__CBZ_SALT__", JSON.stringify(salt));
  if (DEVICE !== "desktop") {
    try { pre = fs.readFileSync(path.join(ROOT0, "tools/preload/ipad.js"), "utf8") + "\n;" + pre; } catch (_) {}
    await s("Emulation.setDeviceMetricsOverride", { width: VIEW.w, height: VIEW.h, deviceScaleFactor: VIEW.dpr, mobile: DEVICE === "phone" });
    await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    if (DEVICE === "phone") await s("Emulation.setUserAgentOverride", { userAgent: PHONE_UA, platform: "iPhone", acceptLanguage: "en-US" });
  }
  if (PRELOAD_EXTRA) pre += "\n;" + fs.readFileSync(path.resolve(PRELOAD_EXTRA), "utf8");
  await s("Page.addScriptToEvaluateOnNewDocument", { source: pre });
  return { s, ev, salt, close: async () => { try { await B.send("Target.closeTarget", { targetId }); } catch (_) {} try { await B.send("Target.disposeBrowserContext", { browserContextId }); } catch (_) {} } };
}

/* CPU TIME from Chrome itself (contention-proof: a busy box stretches wall
   time, not CPU time much). main = the page's renderer main thread
   (Performance.getMetrics ThreadTime, s); gpuProc = the GPU process's
   cpuTime (s), where shader compiles and ANGLE's Metal translation run. */
async function cpuSnap(B, P) {
  const o = {};
  try { const { metrics } = await P.s("Performance.getMetrics", {}, 10000); for (const m of metrics) if (/^(ThreadTime|ProcessTime|TaskDuration|ScriptDuration|V8CompileDuration)$/.test(m.name)) o[m.name] = m.value; } catch (_) {}
  try { const { processInfo } = await B.send("SystemInfo.getProcessInfo", {}, undefined, 10000); let g = null; for (const p of processInfo) if (p.type === "GPU") g = (g || 0) + p.cpuTime; if (g != null) o.gpuProc = g; } catch (_) {}
  return o;
}
/* MEMORY snapshot: the preload's in-page accounting (JS heap via
   performance.memory, GPU bytes at the GL level, 2D canvases) plus CDP's own
   heap numbers as a cross-check. MB throughout. */
async function memSnap(P) {
  let o = null;
  try { o = await P.ev("window.__speed.memRead()", 30000); } catch (_) {}
  try { const h = await P.s("Runtime.getHeapUsage", {}, 10000); if (o) { o.cdpHeap = +(h.usedSize / 1048576).toFixed(1); o.cdpHeapTotal = +(h.totalSize / 1048576).toFixed(1); if (h.backingStorageSize != null) o.arrayBuffers = +(h.backingStorageSize / 1048576).toFixed(1); o.cdpRaw = h; } } catch (_) {}
  // LIVE = after a forced full GC: what the world really holds (the steady
  // figure above still counts garbage the build left for the collector; a
  // phone's GC reclaims that under pressure, so live is the resident floor).
  try { await P.s("HeapProfiler.collectGarbage", {}, 30000); const r = await P.ev("(function(){ var m = performance.memory; return m ? m.usedJSHeapSize : 0; })()", 10000);
    const h = await P.s("Runtime.getHeapUsage", {}, 10000);
    if (o) { o.liveHeap = +(r / 1048576).toFixed(1); o.liveV8 = +(h.usedSize / 1048576).toFixed(1); if (h.backingStorageSize != null) o.liveArrayBuffers = +(h.backingStorageSize / 1048576).toFixed(1); o.livePhone = +(o.liveHeap + (o.gpu || 0)).toFixed(1); } } catch (_) {}
  try { const { metrics } = await P.s("Performance.getMetrics", {}, 10000); if (o) o.cdpMetrics = Object.fromEntries(metrics.filter((x) => /Heap|Nodes|Documents|Frames/.test(x.name)).map((x) => [x.name, x.value])); } catch (_) {}
  return o;
}
const memVerdict = (mb) => (mb == null ? "-" : mb <= MEM_BUDGET_MB ? "OK" : "OVER");
const cpuD = (a, b, k) => (a && b && a[k] != null && b[k] != null ? (b[k] - a[k]) * 1000 : null);

async function waitFor(ev, expr, budgetS, what) {
  const t = Date.now();
  while ((Date.now() - t) / 1000 < budgetS) {
    try { if (await ev(expr, 5000)) return true; } catch (_) {}
    await sleep(60);
  }
  throw new Error(`${what}: not ready after ${budgetS}s`);
}

// Aggregate the per-script table: eval = load(i) - max(load(i-1), responseEnd(i))
const SCRIPT_TABLE = String.raw`(function(){
  var S = window.__speed, res = {}; performance.getEntriesByType("resource").forEach(function(e){ res[e.name] = e; });
  var prev = 0, rows = [], fetchWait = 0, prisonEval = 0, prisonFiles = 0, pk = -1;
  S.scripts.forEach(function(s){ var e = res[s[0]]; var re = e ? e.responseEnd : 0; var st = Math.max(prev, re); fetchWait += Math.max(0, re - prev);
    var ev = Math.max(0, s[1] - st);
    if (pk >= 0 && s[2] > pk) { prisonEval += ev; prisonFiles++; } if (s[2] >= 0) pk = s[2];
    rows.push([s[0].replace(location.origin + "/", "").replace(/\?.*$/, ""), ev, e ? e.transferSize || e.encodedBodySize || 0 : 0]); prev = s[1]; });
  var lh = 0, lhTop = []; (S.loadHandlers || []).forEach(function(h){ lh += h[1]; lhTop.push([h[0], h[1]]); }); lhTop.sort(function(a,b){ return b[1]-a[1]; });
  var nav = performance.getEntriesByType("navigation")[0] || {};
  var byDir = {}; rows.forEach(function(r){ var d = r[0].split("/").slice(0, 2).join("/"); byDir[d] = (byDir[d] || 0) + r[1]; });
  var top = rows.slice().sort(function(a,b){ return b[1]-a[1]; }).slice(0, 15);
  var evalSum = 0; rows.forEach(function(r){ evalSum += r[1]; });
  var loadEnd = 0; (S.loadHandlers || []).forEach(function(h){ loadEnd = Math.max(loadEnd, h[2] + h[1]); });
  return { n: rows.length, lastScriptAt: prev, evalMs: evalSum, prisonEvalMs: prisonEval, prisonFiles: prisonFiles, loadHandlersMs: lh, loadHandlers: lhTop.slice(0, 5),
    titleReadyAt: prev, loadEventAt: S.marks.loadStart || 0, loadEnd: loadEnd, fetchWaitMs: fetchWait, dcl: S.marks.dcl || nav.domContentLoadedEventEnd || 0,
    responseStart: nav.responseStart || 0, top: top, byDir: byDir };
})()`;

/* One cbz LOAD, from navigation to the settled first frames, on page P.
   Used for the first visit and, with --return, again for the reload. */
async function measureLoad(B, P, url, out, prof) {
  const sn0 = await cpuSnap(B, P);
  const tNav = Date.now();
  if (HEAP_SITES) { await P.s("HeapProfiler.enable"); await P.s("HeapProfiler.startSampling", HEAP_GARBAGE ? { samplingInterval: 524288, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true } : { samplingInterval: 32768 }); }
  await P.s("Page.navigate", { url });
  await waitFor(P.ev, "!!(window.CBZ && CBZ.bootComplete && CBZ.startRun && window.__speed && document.readyState === 'complete')", 240, "bootComplete");
  await P.ev(PAGE_LIB);
  const scr = await P.ev(SCRIPT_TABLE);
  const bootAt = await P.ev("(function(){ var S = window.__speed; S.bootAt = performance.now(); S.armBuild(); S.hold_(); return S.bootAt; })()");
  out.calibs = [await P.ev("window.__speed.calib()")];
  out.scripts = scr;
  out.tool = { booted: Date.now() - tNav };
  const memTitle = await memSnap(P);
  const sn1 = await cpuSnap(B, P);
  if (prof) { await P.s("Profiler.enable"); await P.s("Profiler.setSamplingInterval", { interval: 1000 }); await P.s("Profiler.start"); }
  // THE BUILD: one synchronous task. Timed in-page.
  const b = await P.ev(`(function(){ var S = window.__speed; S.compileMs = 0; var t0 = performance.now(); var err = null;
    try { CBZ.startRun(); } catch (e) { err = String(e && e.stack || e).slice(0, 400); }
    var t1 = performance.now(); S.t = t1; S.wrapRender(); S.wrapUpdaters();
    return { t0: t0, t1: t1, err: err, compile: S.compileMs, state: CBZ.game && CBZ.game.state, steps: S.steps, builders: S.builders }; })()`, BUILD_BUDGET_S * 1000);
  if (b.err) throw new Error("startRun threw: " + b.err);
  if (prof) { const { profile } = await P.s("Profiler.stop", {}, 240000); prof.build = profile; }
  const sn2 = await cpuSnap(B, P);
  const memBuild = await memSnap(P);
  out.buildMs = b.t1 - b.t0;
  out.buildCompileMs = b.compile;
  out.state = b.state;
  // checkpoint gaps (gap = work BEFORE that key) + builder table
  // CBZ.bootStep(key) marks the START of step `key` (systems/bootprogress.js
  // step()): a key's cost runs to the next checkpoint.
  const phases = [];
  if (b.steps.length) phases.push(["(before first checkpoint)", b.steps[0][1] - b.t0]);
  for (let i = 0; i < b.steps.length; i++) phases.push([b.steps[i][0], (i + 1 < b.steps.length ? b.steps[i + 1][1] : b.t1) - b.steps[i][1]]);
  out.phases = phases;
  out.builders = b.builders.slice().sort((x, y) => y[1] - x[1]);
  // the title loop's in-flight frame lands in the hold queue (see the preload)
  await P.ev("new Promise(function(r){ setTimeout(r, 40); })");
  // FIRST FRAMES: shader compile + uploads. One by one, each finished on the
  // GPU (the player sees a frame when the GPU is done with it).
  if (prof) { await P.s("Profiler.start"); }
  /* SETTLE: step frames one at a time until the last 5 compiled nothing
     and none of them is a hitch (max < 2x min, all < 250 ms). Frame 1 is
     "first frame"; frames 2.. up to the steady tail are "settle". */
  const first = await P.ev(`(function(){ var S = window.__speed, rows = [];
    for (var i = 0; i < ${SETTLE_MAX}; i++) { rows.push(S.step(1, { finish: true, perUpdater: true })[0]);
      if (rows.length >= 6) { var t = rows.slice(-5), mx = 0, mn = 1e9, np = 0;
        t.forEach(function(r){ var f = r.cpu + r.fin; mx = Math.max(mx, f); mn = Math.min(mn, f); np += r.newPrograms || 0; });
        if (!np && mx < 2 * mn && mx < 250) break; } }
    return rows; })()`, 600000);
  if (prof) { const { profile } = await P.s("Profiler.stop", {}, 240000); prof.first = profile; }
  const sn3 = await cpuSnap(B, P);
  /* MEMORY: peak over the whole load (script eval, build, first frames:
     sampled in-page through all of it), and the steady value after settle */
  const ms = await memSnap(P);
  if (HEAP_SITES) { try { const { profile } = await P.s("HeapProfiler.getSamplingProfile", {}, 300000); await P.s("HeapProfiler.stopSampling", {}, 120000); out.heapSites = heapSites(profile); } catch (e) { out.heapSites = { err: String(e).slice(0, 200) }; } }
  if (ms) out.mem = { boot: ms.peak, steady: { heap: ms.heap, heapTotal: ms.heapTotal, gpu: ms.gpu, buf: ms.buf, tex: ms.tex, rb: ms.rb, db: ms.db, phone: ms.phone, cv2d: ms.cv2d, cdpHeap: ms.cdpHeap, cdpHeapTotal: ms.cdpHeapTotal, arrayBuffers: ms.arrayBuffers, liveHeap: ms.liveHeap, liveV8: ms.liveV8, liveArrayBuffers: ms.liveArrayBuffers, livePhone: ms.livePhone, cdpRaw: ms.cdpRaw, cdpMetrics: ms.cdpMetrics },
    objects: { buffers: ms.nBuf, textures: ms.nTex, renderbuffers: ms.nRb }, subDataMB: ms.subMB, samples: ms.samples, precise: ms.precise, budgetMB: MEM_BUDGET_MB,
    atTitle: memTitle && { heap: memTitle.heap, gpu: memTitle.gpu, phone: memTitle.phone, peakPhone: memTitle.peak.phone },
    afterBuild: memBuild && { heap: memBuild.heap, gpu: memBuild.gpu, phone: memBuild.phone, peakPhone: memBuild.peak.phone } };
  const top1 = (r) => { let w = "", v = 0; for (const k in r.u || {}) if (r.u[k] > v) { v = r.u[k]; w = k; } return w ? `${w} ${v.toFixed(0)}` : ""; };
  out.firstFrames = first.map((r) => ({ cpu: +r.cpu.toFixed(1), fin: +r.fin.toFixed(1), render: +r.render.toFixed(1), rOther: +r.rOther.toFixed(1), sim: +r.sim.toFixed(1), newPrograms: r.newPrograms, calls: r.calls, top: top1(r) }));
  const settled = first.length < SETTLE_MAX ? first.length - 5 : first.length;
  out.settleFrames = settled;
  out.firstFrameMs = first[0].cpu + first[0].fin;
  out.firstFrameCompileMs = first[0].compile;
  out.settleCompileMs = first.slice(1).reduce((a, r) => a + r.compile, 0);
  out.warmMs = first.slice(1, settled).reduce((a, r) => a + r.cpu + r.fin, 0);
  out.programs = first[first.length - 1].programs;
  out.boot = { dcl: scr.dcl, bootComplete: bootAt, scriptEval: scr.evalMs, fetchWait: scr.fetchWaitMs };
  out.loadMs = scr.titleReadyAt + out.buildMs + out.firstFrameMs + out.warmMs;   // nav → title interactive → build → frames until steady
  /* CPU time (ms). main: the renderer main thread from process start (the
     page's process is fresh: a new browser context per run) to settled. */
  const mainK = sn3.ThreadTime != null ? "ThreadTime" : "TaskDuration";
  out.cpu = { main: sn3[mainK] != null ? sn3[mainK] * 1000 : null, mainBoot: sn1[mainK] != null ? sn1[mainK] * 1000 : null,
    mainBuild: cpuD(sn1, sn2, mainK), mainFirstFrames: cpuD(sn2, sn3, mainK), v8Compile: sn3.V8CompileDuration != null ? sn3.V8CompileDuration * 1000 : null,
    gpuProc: cpuD(sn0, sn3, "gpuProc"), gpuProcFirstFrames: cpuD(sn2, sn3, "gpuProc"), key: mainK };
  out.tool.built = Date.now() - tNav;
  return tNav;
}

/* live V8 bytes by allocating site: each sample node's selfSize is charged to
   the nearest src/ (game) frame on its stack, and to that frame's file. */
function heapSites(profile) {
  const bySite = new Map(), byFile = new Map(), byVendor = new Map(); let total = 0;
  const walk = (n, game) => {
    const cf = n.callFrame || {}, m = /\/(src\/[^?]+|games\/[^?]+)/.exec(cf.url || "");
    const g = m && !/vendor\//.test(m[1]) ? { site: m[1].replace(/^src\//, "") + ":" + (cf.lineNumber + 1) + " " + (cf.functionName || "(anon)"), file: m[1].replace(/^src\//, "") } : game;
    if (n.selfSize) { total += n.selfSize; const s = g ? g.site : "(engine/no game frame)", f = g ? g.file : "(engine)"; bySite.set(s, (bySite.get(s) || 0) + n.selfSize); byFile.set(f, (byFile.get(f) || 0) + n.selfSize);
      // inside a vendored library: which of ITS functions (three's render internals)
      if (/vendor\//.test(cf.url || "")) { const v = (cf.url.split("/").pop().replace(/\?.*$/, "")) + ":" + (cf.functionName || "(anon)") + "@" + cf.columnNumber; byVendor.set(v, (byVendor.get(v) || 0) + n.selfSize); } }
    for (const c of n.children || []) walk(c, g);
  };
  walk(profile.head, null);
  const top = (mp, k) => [...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([s, b]) => [s, +(b / 1048576).toFixed(1)]);
  return { totalMB: +(total / 1048576).toFixed(0), sites: top(bySite, 50), files: top(byFile, 40), vendor: top(byVendor, 20) };
}

async function runCbz(B, base, m, withPlay, ctx = {}) {
  const P = await newPage(B);
  const out = { mode: m, ok: false, salt: P.salt || undefined };
  const prof = PROFILE ? {} : null;
  try {
    const url = modeUrl(base, m);
    const tNav = await measureLoad(B, P, url, out, prof);
    out.look = await P.ev("window.__speed.look()");
    out.census = await P.ev("window.__speed.census()", 120000);
    out.ok = true;
    out.tool.census = Date.now() - tNav;
    if (withPlay) out.play = await playSpots(B, P, m, ctx);
    out.tool.played = Date.now() - tNav;
    if (out.play) for (const o of Object.values(out.play.spots)) if (o.calib) out.calibs.push(o.calib);
    out.calib = out.calibs.reduce((a, b) => a + b, 0) / out.calibs.length;
    if (PROFILE && withPlay) {
      await P.s("Profiler.start");
      await P.ev("window.__speed.step(" + FRAMES + ", {})", 300000);
      const { profile } = await P.s("Profiler.stop", {}, 240000); prof.play = profile;
    }
    out.errors = await P.ev("({ n: window.__speed.errN, first: window.__speed.errs.slice(0, 6), salted: window.__speed.salted })");
    /* RETURN VISIT: the same page reloads in the same profile (same nonce,
       so the shaders it compiled are warm; the HTTP and V8 code caches too) */
    if (RETURN) {
      const rv = {};
      try { await measureLoad(B, P, url, rv, null); out.returnVisit = rv; log(`[speed ${since()}]   ${m}/return visit: load ${fmt(rv.loadMs, 0)} ms (build ${fmt(rv.buildMs, 0)}, first frame ${fmt(rv.firstFrameMs, 0)}, script eval ${fmt(rv.scripts.evalMs, 0)})`); }
      catch (e) { out.returnVisit = { error: String(e.message || e) }; }
    }
    out.wallS = (Date.now() - tNav) / 1000;
  } catch (e) {
    out.error = String(e.message || e);
    try { out.errors = await P.ev("({ n: window.__speed.errN, first: window.__speed.errs.slice(0, 6) })", 5000); } catch (_) {}
  } finally {
    await P.close();
  }
  if (prof && Object.keys(prof).length) out.profile = summarizeProfiles(prof);
  // --profile-dir <dir>: keep the raw .cpuprofile files (DevTools / custom rollups)
  if (prof && opt("--profile-dir", "")) { const dir = path.resolve(opt("--profile-dir", "")); fs.mkdirSync(dir, { recursive: true }); for (const k in prof) fs.writeFileSync(path.join(dir, `${m}-${k}.cpuprofile`), JSON.stringify(prof[k])); }
  return out;
}

/* One measured window at the current spot: stepped frames with every pass
   GPU-timed, Chrome's CPU counters around it, the last frame's pixels kept. */
async function measureFrames(B, P, n, pathExpr, grab) {
  const c0 = await cpuSnap(B, P);
  await P.ev(`(function(){ var S = window.__speed; S.lastRows = S.step(${n}, { finish: ${SERIAL}, gpu: ${!SERIAL}, grab: ${!!grab}, perUpdater: true, path: ${pathExpr} }); return 1; })()`, 300000);
  const c1 = await cpuSnap(B, P);
  const o = await P.ev(`(function(){ var S = window.__speed; return S.tqCollect(3000).then(function(col){ var got = S.finishRows(S.lastRows, col);
    var o = S.summ(S.lastRows); o.gpuTimer = got; o.gpuDisjoint = col.disjoint; o.gpuLost = col.lost;
    o.emptyFrames = S.lastRows.filter(function(r){ return r.empty; }).length; S.lastRows = null; return o; }); })()`, 60000);
  const mk = c1.ThreadTime != null ? "ThreadTime" : "TaskDuration";
  const dm = cpuD(c0, c1, mk), dg = cpuD(c0, c1, "gpuProc");
  o.cpuThread = dm != null ? dm / n : null;          // renderer main-thread CPU ms per frame
  o.gpuProcCpu = dg != null ? dg / n : null;         // GPU-process CPU ms per frame
  if (grab) o.shot = await P.ev("window.__speed.shotOut()", 60000);
  return o;
}

/* per play spot: the value after its frames, and the peak over the spot's window (place + warm + measured frames) */
const spotMem = (x) => x && { heap: x.heap, gpu: x.gpu, buf: x.buf, tex: x.tex, rb: x.rb, db: x.db, phone: x.phone, cv2d: x.cv2d, cdpHeap: x.cdpHeap, peak: x.win, runPeakPhone: x.peak.phone };
async function playSpots(B, P, m, ctx = {}) {
  const tS = Date.now();
  const spots = ctx.spots || (m === "city" ? await P.ev(SLICE_SPOTS ? `window.__speed.sliceSpots(${JSON.stringify(SLICE_SPOTS)})` : "window.__speed.spots()", 120000) : await P.ev("(function(){ var p = CBZ.player; return p && p.pos ? { spawn: { x: p.pos.x, y: p.pos.y, z: p.pos.z, player: true } } : { spawn: { x: 0, y: 0, z: 0 } }; })()"));
  const res = { spots: {}, spotsMs: Date.now() - tS, spotsAt: spots };
  log(`[speed ${since()}]   spots ${ctx.spots ? "given (A/B: located once, on the base)" : "located in " + res.spotsMs + " ms"}`);
  const order = Object.keys(spots);
  for (const name of order) {
    const sp = JSON.stringify(spots[name]);
    const cal = await P.ev(`(function(){ var S = window.__speed; S.memWin(); S.place(${sp}); var cal = S.calib(); S.step(${WARM}, { finish: ${SERIAL}, path: S.pin(${sp}) }); return cal; })()`, 300000);
    const r = await measureFrames(B, P, FRAMES, `S.pin(${sp})`, LOOK_PIX && ctx.grab !== false);
    r.spot = spots[name];
    r.look = await P.ev("window.__speed.look()");
    r.mem = spotMem(await memSnap(P));
    r.calib = (cal + await P.ev("window.__speed.calib()")) / 2;
    res.spots[name] = r;
    log(`[speed ${since()}]   ${m}/${name}: frame ${fmt(r.frame.med)} ms (cpu ${fmt(r.cpu.med)}, gpu ${r.gpu ? fmt(r.gpu.med) : "-"}${r.gpu ? ` = main ${fmt(r.gMain.med)} shadow ${fmt(r.gShadow.med)} rt ${fmt(r.gRt.med)}` : ""}${SERIAL ? `, wait ${fmt(r.fin.med)}` : ""}; sim ${fmt(r.sim.med)}, render ${fmt(r.render.med)}) calls ${r.calls && r.calls.med} tris ${r.tris && r.tris.med}`);
  }
  if (m === "city" && spots.spawn && spots.downtown) {
    await P.ev(`(function(){ var S = window.__speed; S.memWin(); S.pose = null; S.place(${JSON.stringify(spots.spawn)}); return 1; })()`);
    const r = await measureFrames(B, P, FRAMES * 2, `S.pathFn(${JSON.stringify(spots.spawn)}, ${JSON.stringify(spots.downtown)})`, false);
    r.spot = { path: "spawn->downtown @25m/s" };
    r.mem = spotMem(await memSnap(P));
    res.spots.drive = r;
    log(`[speed ${since()}]   ${m}/drive: frame ${fmt(r.frame.med)} ms (cpu ${fmt(r.cpu.med)}, gpu ${r.gpu ? fmt(r.gpu.med) : "-"}; sim ${fmt(r.sim.med)}, render ${fmt(r.render.med)}) calls ${r.calls && r.calls.med}`);
  }
  /* the diagnostic pass runs AFTER every measured spot, so its extra frames
     (world time moves on: aircraft fall, fires spread) never leak into them */
  if (ATTRIBUTE) for (const name of order) {
    await P.ev(`(function(){ var S = window.__speed, sp = ${JSON.stringify(spots[name])}; S.place(sp); S.step(${WARM}, { finish: true, path: S.pin(sp) }); return 1; })()`, 300000);
    res.spots[name].attribute = await attribute(P, spots[name]);
    log(`[speed ${since()}]   ${m}/${name}: attribution done`);
  }
  return res;
}

/* DIAGNOSTIC ONLY: what share of the frame do the HD settings and the trees
   explain at this spot? Same spot, same frame; toggles restored after. Never
   a default, never a "win". */
async function attribute(P, sp) {
  return P.ev(`(function(){
    var S = window.__speed, C = window.CBZ, r = C.renderer, sun = C.sun, N = 24, pin = S.pin(${JSON.stringify(sp)});
    function meas(){ S.step(4, { finish: true, path: pin }); var rows = S.step(N, { finish: true, path: pin }); var o = S.summ(rows);
      return { frame: +(o.cpu.med + o.fin.med).toFixed(2), render: +o.render.med.toFixed(2), fin: +o.fin.med.toFixed(2), sim: +o.sim.med.toFixed(2), calls: o.calls && o.calls.med, tris: o.tris && o.tris.med }; }
    var out = { base: meas() };
    var pr0 = r.getPixelRatio();
    r.setPixelRatio(devicePixelRatio); out.fullDPR = meas(); out.fullDPR.pr = devicePixelRatio;
    r.setPixelRatio(Math.max(0.5, pr0 / 2)); out.halfPR = meas(); out.halfPR.pr = Math.max(0.5, pr0 / 2);
    r.setPixelRatio(pr0);
    var sm0 = r.shadowMap.enabled, cs0 = sun && sun.castShadow;
    r.shadowMap.enabled = false; if (sun) sun.castShadow = false; out.noShadows = meas();
    r.shadowMap.enabled = sm0; if (sun) sun.castShadow = cs0;
    var q0 = C.getQualityLevel ? C.getQualityLevel() : null;
    if (q0 != null && q0 > 0 && C.setQualityLevel) { C.setQualityLevel(q0 - 1); out.tierDown = meas(); out.tierDown.tier = q0 - 1; C.setQualityLevel(q0); }
    if (q0 != null && q0 < 4 && C.setQualityLevel) { C.setQualityLevel(q0 + 1); out.tierUp = meas(); out.tierUp.tier = q0 + 1; C.setQualityLevel(q0); }
    /* vegetation by subtraction: hide every vegetation mesh, re-measure */
    var VEG = /tree|forest|canopy|foliage|vegetation|palm|pine|spruce|conifer|bush|shrub|grass|frond|leaf|crown|trunk|thicket|hedge|saguaro|cactus|jungle|wood(?!en|work)|orchard|reed|fern/i;
    var hid = [];
    C.scene.traverse(function(o){ if (!(o.isMesh || o.isInstancedMesh) || !o.visible) return; var m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (VEG.test(o.name || "") || (m && /vegetation|foliage|leaf|bark|palm|tree|grass/i.test(m.name || "")) || (o.geometry && VEG.test(o.geometry.name || ""))) hid.push(o); });
    var vis0 = hid.map(function(o){ return o.visible; });
    /* systems may re-show things each frame; hide inside a render wrapper */
    var rr = r.render; r.render = function(){ for (var i = 0; i < hid.length; i++) hid[i].visible = false; return rr.apply(this, arguments); };
    out.noVegetation = meas(); out.noVegetation.hidden = hid.length;
    r.render = rr; for (var i = 0; i < hid.length; i++) hid[i].visible = vis0[i];
    out.base2 = meas();
    return out; })()`, 300000);
}

async function runPage(B, base, m, withPlay) {
  const d = PAGE_MODES[m];
  const P = await newPage(B);
  const out = { mode: m, ok: false };
  try {
    const tNav = Date.now();
    await P.s("Page.navigate", { url: modeUrl(base, m) });
    await waitFor(P.ev, `!!(window.__speed && (${d.ready}))`, 240, "ready");
    const scr = await P.ev(SCRIPT_TABLE);
    out.scripts = scr;
    const readyAt = await P.ev("performance.now()");
    // entry: click (or the URL door already started it); then first draw after entry
    const entryAt = await P.ev(`(function(){ var S = window.__speed; S.firstDrawAt = 0; S.entryAt = performance.now(); ${d.entry || ""}; return S.entryAt; })()`);
    await waitFor(P.ev, "window.__speed.firstDrawAt > 0", 240, "first draw");
    // frames until cheap: live rAF log, 3 frames in a row under 50 ms or 8 s
    await P.ev(`new Promise(function(res){ var S = window.__speed, t0 = performance.now(); (function chk(){
      var f = S.raf.filter(function(x){ return x[1] >= S.entryAt; }); var c = 0; for (var i = f.length - 1; i >= 0 && f[i][2] < 50; i--) c++;
      if (c >= 3 || performance.now() - t0 > 8000) return res(1); setTimeout(chk, 50); })(); })`, 20000);
    const t = await P.ev(`(function(){ var S = window.__speed; var f = S.raf.filter(function(x){ return x[1] >= S.entryAt; });
      var warm = 0, heavy = f.length; for (var i = f.length - 1; i >= 0; i--) if (f[i][2] >= 50) { heavy = i; break; }
      var lastHeavy = heavy < f.length ? f[heavy][1] + f[heavy][2] : S.firstDrawAt;
      return { firstDraw: S.firstDrawAt, cheapAt: Math.max(lastHeavy, S.firstDrawAt), frames: f.slice(0, 8).map(function(x){ return +x[2].toFixed(1); }) }; })()`);
    out.boot = { dcl: scr.dcl, ready: readyAt, scriptEval: scr.evalMs, fetchWait: scr.fetchWaitMs };
    out.calib = await P.ev("window.__speed.calib()");
    out.entryToFirstDraw = t.firstDraw - entryAt;
    out.firstFrames = t.frames;
    out.loadMs = (d.entry ? readyAt : 0) + (t.cheapAt - (d.entry ? entryAt : 0));
    { const ms = await memSnap(P); if (ms) out.mem = { boot: ms.peak, steady: { heap: ms.heap, heapTotal: ms.heapTotal, gpu: ms.gpu, buf: ms.buf, tex: ms.tex, rb: ms.rb, db: ms.db, phone: ms.phone, cv2d: ms.cv2d, cdpHeap: ms.cdpHeap, liveHeap: ms.liveHeap, livePhone: ms.livePhone }, budgetMB: MEM_BUDGET_MB }; }
    out.phases = [["script eval + page ready", readyAt], ["entry → first draw", t.firstDraw - entryAt], ["first draw → frames cheap", t.cheapAt - t.firstDraw]];
    out.ok = true;
    if (withPlay) {
      await P.ev("(function(){ var S = window.__speed; S.hold_(); return new Promise(function(r){ setTimeout(r, 60); }); })()");
      await P.ev(PAGE_LIB.replace("var S = window.__speed, C = window.CBZ", "var S = window.__speed, C = window.CBZ || {}"));
      await P.ev(`(function(){ var S = window.__speed; S.memWin(); S.wrapUpdaters && window.CBZ && window.CBZ.updaters && S.wrapUpdaters(); window.CBZ && window.CBZ.renderer && S.wrapRender(); S.step(${WARM}, { finish: ${SERIAL} }); return 1; })()`, 300000);
      const r = await measureFrames(B, P, FRAMES, "null", false);
      r.mem = spotMem(await memSnap(P));
      out.play = { spots: { live: r } };
      log(`[speed ${since()}]   ${m}/live: frame ${fmt(r.frame.med)} ms (cpu ${fmt(r.cpu.med)}, gpu ${r.gpu ? fmt(r.gpu.med) : "-"}), draws ${r.draws && r.draws.med}`);
    }
    out.errors = await P.ev("({ n: window.__speed.errN, first: window.__speed.errs.slice(0, 6) })");
    out.wallS = (Date.now() - tNav) / 1000;
  } catch (e) {
    out.error = String(e.message || e);
    try { out.errors = await P.ev("({ n: window.__speed.errN, first: window.__speed.errs.slice(0, 6) })", 5000); } catch (_) {}
  } finally { await P.close(); }
  return out;
}

/* ---------------- V8 profile → top self-time functions ---------------- */
function summarizeProfiles(prof) {
  const res = {};
  for (const k of Object.keys(prof)) {
    const p = prof[k]; if (!p) continue;
    const byId = new Map(), parent = new Map(); for (const n of p.nodes) byId.set(n.id, n);
    for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const fileOf = (cf) => (cf.url || "").replace(/^https?:\/\/[^/]+\//, "").replace(/\?.*$/, "") || "(native)";
    const keyOf = (cf) => `${fileOf(cf)}:${cf.functionName || "(anon)"}:${cf.lineNumber + 1}`;
    const self = new Map(), inclF = new Map(), inclFile = new Map();
    const dts = p.timeDeltas || [];
    for (let i = 0; i < p.samples.length; i++) {
      const n = byId.get(p.samples[i]); const dt = (dts[i + 1] != null ? dts[i + 1] : dts[i] || 0) / 1000;
      if (n.callFrame.functionName === "(idle)") continue;
      const key = keyOf(n.callFrame);
      self.set(key, (self.get(key) || 0) + dt);
      // inclusive: every function / file on the stack, once per sample
      const seenF = new Set(), seenFile = new Set();
      for (let id = n.id; id != null; id = parent.get(id)) {
        const cf = byId.get(id).callFrame; if (!cf.url) continue;
        const k = keyOf(cf), f = fileOf(cf);
        if (!seenF.has(k)) { seenF.add(k); inclF.set(k, (inclF.get(k) || 0) + dt); }
        if (!seenFile.has(f)) { seenFile.add(f); inclFile.set(f, (inclFile.get(f) || 0) + dt); }
      }
    }
    // inclusive-ish by file
    const byFile = new Map();
    for (const [key, ms] of self) { const f = key.split(":")[0]; byFile.set(f, (byFile.get(f) || 0) + ms); }
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    res[k] = { totalMs: +total.toFixed(1),
      topFunctions: [...self].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([f, ms]) => [f, +ms.toFixed(1)]),
      topFiles: [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([f, ms]) => [f, +ms.toFixed(1)]),
      inclusiveFunctions: [...inclF].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([f, ms]) => [f, +ms.toFixed(1)]),
      inclusiveFiles: [...inclFile].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([f, ms]) => [f, +ms.toFixed(1)]) };
  }
  return res;
}

/* ---------------- metrics: flatten, aggregate runs, compare ---------------- */
const fmt = (v, d = 1) => (v == null || !isFinite(v) ? "-" : (+v).toFixed(d));
function flatten(r) {
  // metric name → { v, noise (within-run), unit, lowerBetter }
  const M = {};
  const put = (k, v, noise = 0, unit = "ms") => { if (v != null && isFinite(v)) M[k] = { v: +(+v).toFixed(3), noise: +(+noise).toFixed(3), unit }; };
  const m = r.mode;
  if (r.calib) put(`${m}.calib`, r.calib, 0, "calib");
  if (r.loadMs != null) {
    put(`${m}.load.total`, r.loadMs);
    if (r.scripts) { put(`${m}.load.title`, r.scripts.titleReadyAt); put(`${m}.load.scriptEval`, r.scripts.evalMs);
      put(`${m}.load.prisonAtParse`, r.scripts.prisonEvalMs); put(`${m}.load.loadHandlers`, r.scripts.loadHandlersMs);
      if (r.scripts.loadEventAt) put(`${m}.load.loadEventAt`, r.scripts.loadEventAt); }
    if (r.buildMs != null) put(`${m}.load.build`, r.buildMs);
    if (r.firstFrameMs != null) put(`${m}.load.firstFrame`, r.firstFrameMs);
    if (r.firstFrameCompileMs != null) put(`${m}.load.firstFrameCompile`, r.firstFrameCompileMs + (r.settleCompileMs || 0));
    if (r.buildCompileMs != null) put(`${m}.load.buildCompile`, r.buildCompileMs);
    if (r.warmMs != null) put(`${m}.load.warmFrames`, r.warmMs);
    if (r.entryToFirstDraw != null) put(`${m}.load.entryToFirstDraw`, r.entryToFirstDraw);
    if (r.programs != null) put(`${m}.load.programs`, r.programs, 0, "n");
    if (r.phases && PAGE_MODES[m].kind === "cbz") for (const [k, v] of r.phases) put(`${m}.build.${k}`, v);
    if (r.builders) for (const [k, v] of r.builders) put(`${m}.builder.${k}`, v);
    if (r.mem) {   // MB: the load's peak (script eval + build + first frames) and the steady value after settle
      const b = r.mem.boot || {}, st = r.mem.steady || {};
      put(`${m}.mem.heapPeak`, b.heap, 0, "MB"); put(`${m}.mem.heap`, st.heap, 0, "MB");
      put(`${m}.mem.gpuPeak`, b.gpu, 0, "MB"); put(`${m}.mem.gpu`, st.gpu, 0, "MB");
      put(`${m}.mem.gpuTex`, st.tex, 0, "MB"); put(`${m}.mem.gpuBuf`, st.buf, 0, "MB"); put(`${m}.mem.gpuRb`, st.rb, 0, "MB");
      put(`${m}.mem.phonePeak`, b.phone, 0, "MB"); put(`${m}.mem.phone`, st.phone, 0, "MB"); if (st.livePhone != null) put(`${m}.mem.phoneLive`, st.livePhone, 0, "MB"); put(`${m}.mem.canvas2d`, st.cv2d, 0, "MB");
    }
    if (r.cpu) {   // Chrome's CPU counters (ms): contention-proof load cost
      put(`${m}.load.cpu.main`, r.cpu.main); put(`${m}.load.cpu.mainBuild`, r.cpu.mainBuild); put(`${m}.load.cpu.mainFirstFrames`, r.cpu.mainFirstFrames);
      put(`${m}.load.cpu.gpuProc`, r.cpu.gpuProc); put(`${m}.load.cpu.gpuProcFirstFrames`, r.cpu.gpuProcFirstFrames); put(`${m}.load.cpu.v8Compile`, r.cpu.v8Compile);
    }
    const rv = r.returnVisit;
    if (rv && rv.loadMs != null) {
      put(`${m}.load.return.total`, rv.loadMs); put(`${m}.load.return.title`, rv.scripts && rv.scripts.titleReadyAt); put(`${m}.load.return.scriptEval`, rv.scripts && rv.scripts.evalMs);
      put(`${m}.load.return.build`, rv.buildMs); put(`${m}.load.return.firstFrame`, rv.firstFrameMs); put(`${m}.load.return.warmFrames`, rv.warmMs);
      put(`${m}.load.return.firstFrameCompile`, rv.firstFrameCompileMs + (rv.settleCompileMs || 0));
      if (rv.cpu) { put(`${m}.load.return.cpu.main`, rv.cpu.main); put(`${m}.load.return.cpu.gpuProc`, rv.cpu.gpuProc); put(`${m}.load.return.cpu.v8Compile`, rv.cpu.v8Compile); }
    }
  }
  if (r.play) for (const [s, o] of Object.entries(r.play.spots)) {
    const nz = (x) => (x ? 1.253 * 1.4826 * x.mad / Math.sqrt(x.n) : 0);   // std. error of a median
    // frame = max(cpu, gpu) per frame (pipelined), or cpu + readback wait (--serial / no timer)
    if (o.frame) put(`${m}.play.${s}.frame`, o.frame.med, nz(o.frame));
    else if (o.cpu && o.fin) put(`${m}.play.${s}.frame`, o.cpu.med + o.fin.med, Math.hypot(nz(o.cpu), nz(o.fin)));
    if (o.cpu) put(`${m}.play.${s}.frameCpu`, o.cpu.med, nz(o.cpu));
    if (o.fin && o.fin.med > 0) put(`${m}.play.${s}.gpuWait`, o.fin.med, nz(o.fin));
    if (o.frameSum) put(`${m}.play.${s}.frameSum`, o.frameSum.med, nz(o.frameSum));
    if (o.gpu) { put(`${m}.play.${s}.gpu`, o.gpu.med, nz(o.gpu)); put(`${m}.play.${s}.gpuMain`, o.gMain.med, nz(o.gMain));
      put(`${m}.play.${s}.gpuShadow`, o.gShadow.med, nz(o.gShadow)); put(`${m}.play.${s}.gpuRt`, o.gRt.med, nz(o.gRt)); }
    if (o.gpuPasses) for (const [k, v] of o.gpuPasses) put(`${m}.play.${s}.gpuPass.${k}`, v);
    if (o.cpuThread != null) put(`${m}.play.${s}.cpuThread`, o.cpuThread);
    if (o.mem) { put(`${m}.play.${s}.mem.heap`, o.mem.heap, 0, "MB"); put(`${m}.play.${s}.mem.gpu`, o.mem.gpu, 0, "MB"); put(`${m}.play.${s}.mem.phone`, o.mem.phone, 0, "MB");
      if (o.mem.peak) put(`${m}.play.${s}.mem.phonePeak`, o.mem.peak.phone, 0, "MB"); }
    if (o.gpuProcCpu != null) put(`${m}.play.${s}.gpuProcCpu`, o.gpuProcCpu);
    if (o.frame || o.cpu) put(`${m}.play.${s}.frameP95`, o.frame ? o.frame.p95 : o.cpu.p95 + (o.fin ? o.fin.p95 : 0), 2 * nz(o.frame || o.cpu));
    if (o.sim) put(`${m}.play.${s}.sim`, o.sim.med, nz(o.sim));
    if (o.alw) put(`${m}.play.${s}.always`, o.alw.med, nz(o.alw));
    if (o.render) put(`${m}.play.${s}.render`, o.render.med, nz(o.render));
    if (o.calls) put(`${m}.play.${s}.calls`, o.calls.med, o.calls.mad, "n");
    if (o.tris) put(`${m}.play.${s}.tris`, o.tris.med, o.tris.mad, "n");
    if (o.draws) put(`${m}.play.${s}.glDraws`, o.draws.med, o.draws.mad, "n");
    if (o.meanFrame != null) put(`${m}.play.${s}.meanFrame`, o.meanFrame, o.cpu ? 1.4826 * o.cpu.mad / Math.sqrt(o.cpu.n) + (o.hitchMs || 0) / o.cpu.n : 0);
    if (o.hitchMs != null) put(`${m}.play.${s}.hitchMs`, o.hitchMs, Math.max(20, 0.5 * o.hitchMs));
    if (o.rOther && o.rOther.med) put(`${m}.play.${s}.renderOther`, o.rOther.med, nz(o.rOther));
    // per updater: MEAN ms/frame (periodic and bursty work counts), noise from its spread
    if (o.updaters) for (const [k, med, p95, mean] of o.updaters.slice(0, 25)) put(`${m}.play.${s}.upd.${k}`, mean, Math.max(0.05, (p95 - med) / Math.sqrt(o.cpu ? o.cpu.n : 60)));
  }
  return M;
}
function aggregate(runs) {
  // runs: [{metrics}] → metric → { v: median of runs, noise: max(within, across) }
  const keys = new Set(); runs.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
  const A = {};
  for (const k of keys) {
    const xs = runs.map((r) => r[k]).filter(Boolean);
    const vs = xs.map((x) => x.v).sort((a, b) => a - b);
    const med = vs[vs.length >> 1];
    const within = Math.max(...xs.map((x) => x.noise || 0));
    const across = vs.length > 1 ? (vs[vs.length - 1] - vs[0]) / 2 : 0;
    A[k] = { v: +med.toFixed(3), noise: +Math.max(within, across).toFixed(3), n: vs.length, unit: xs[0].unit, runs: vs.map((v) => +v.toFixed(2)) };
  }
  return A;
}
/* ---------------- statistics: paired A/B, unpaired file compare ---------------- */
// Student-t quantiles by degrees of freedom (index = df); past the table, the normal value
const T95 = [0, 6.314, 2.920, 2.353, 2.132, 2.015, 1.943, 1.895, 1.860, 1.833, 1.812, 1.796, 1.782, 1.771, 1.761, 1.753];
const T995 = [0, 63.657, 9.925, 5.841, 4.604, 4.032, 3.707, 3.499, 3.355, 3.250, 3.169, 3.106, 3.055, 3.012, 2.977, 2.947];
const tq = (tab, df, z) => (df < tab.length ? tab[df] : z);
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const SUBKEY = /\.upd\.|\.builder\.|\.build\.|\.gpuPass\./;
/* ε, the practical floor: a change smaller than this is "the same" even when
   it is real. Relative, with an absolute floor so tiny numbers don't flap. */
function epsRel(k, unit, baseMed) {
  const b = Math.max(1e-9, Math.abs(baseMed));
  if (unit === "n") return Math.max(0.02, 1 / Math.max(1, b));
  if (unit === "MB") return Math.max(0.03, 5 / b);
  if (SUBKEY.test(k)) return Math.max(0.15, (/\.builder\.|\.build\./.test(k) ? 30 : 0.3) / b);
  if (/\.load\./.test(k)) return Math.max(0.03, 150 / b);
  return Math.max(0.03, 0.5 / b);
}
/* Paired test on log-ratios r_i = ln(cand_i / base_i): a multiplicative
   slowdown of the whole box scales both sides of a pair and cancels. */
function pairedTest(k, unit, bs, cs) {
  const n = Math.min(bs.length, cs.length);
  const bm = median(bs.slice(0, n)), cm = median(cs.slice(0, n));
  const e = epsRel(k, unit, bm), eL = Math.log(1 + e);
  const off = unit === "n" ? 1 : (/\.load\./.test(k) ? 1 : 0.05);   // keeps ln() finite at 0
  const r = []; for (let i = 0; i < n; i++) if (isFinite(bs[i]) && isFinite(cs[i])) r.push(Math.log((Math.max(0, cs[i]) + off) / (Math.max(0, bs[i]) + off)));
  const m = r.length, mean = m ? r.reduce((a, b) => a + b, 0) / m : 0;
  const sd = m > 1 ? Math.sqrt(r.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (m - 1)) : Infinity;
  const se = sd / Math.sqrt(Math.max(1, m));
  const lo99 = mean - tq(T995, m - 1, 2.576) * se, hi99 = mean + tq(T995, m - 1, 2.576) * se;
  const lo90 = mean - tq(T95, m - 1, 1.645) * se, hi90 = mean + tq(T95, m - 1, 1.645) * se;
  let verdict = "unsure";
  if (m >= Math.min(MIN_PAIRS, 2) && m >= 2) {
    const cnt = unit === "n" || unit === "MB";
    if ((lo99 > 0 || hi99 < 0) && Math.abs(mean) > eL) verdict = mean > 0 ? (cnt ? "MORE" : "SLOWER") : (cnt ? "fewer" : "faster");
    else if (lo90 > -eL && hi90 < eL) verdict = "same";
  }
  const pct = (x) => +((Math.exp(x) - 1) * 100).toFixed(2);
  return { k, unit, n: m, base: +bm.toFixed(3), cand: +cm.toFixed(3), pct: pct(mean), lo: isFinite(lo99) ? pct(lo99) : null, hi: isFinite(hi99) ? pct(hi99) : null, eps: +(e * 100).toFixed(1), verdict };
}
function headlineKeys(metrics) {
  // the metrics that decide when an A/B stops and what fails it
  return Object.keys(metrics).filter((k) => /\.load\.(total|cpu\.main|cpu\.gpuProc)$/.test(k) || /\.play\.[^.]+\.(frame|gpu|cpuThread)$/.test(k));
}
function abTable(baseRuns, candRuns) {
  const keys = new Set(); candRuns.forEach((M) => Object.keys(M).forEach((k) => keys.add(k)));
  const heads = new Set(headlineKeys(Object.fromEntries([...keys].map((k) => [k, 1]))));
  const rows = [];
  for (const k of keys) {
    const bs = [], cs = []; let unit = "ms";
    const n = Math.min(baseRuns.length, candRuns.length);
    for (let i = 0; i < n; i++) { const a = baseRuns[i][k], b = candRuns[i][k]; if (a && b) { bs.push(a.v); cs.push(b.v); unit = b.unit; } }
    if (!bs.length || unit === "calib") continue;
    if (SUBKEY.test(k) && Math.max(median(bs), median(cs)) < 1) continue;   // sub-items under 1 ms: noise
    if (/\.build\.lm:/.test(k)) continue;                                   // same number as .builder.<file>
    const t = pairedTest(k, unit, bs, cs); t.headline = heads.has(k); rows.push(t);
  }
  return rows;
}
// normal CDF (Abramowitz-Stegun erf)
function phi(z) { const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2); return z >= 0 ? (1 + y) / 2 : (1 - y) / 2; }
function mannWhitney(a, b) {
  const all = a.map((v) => [v, 0]).concat(b.map((v) => [v, 1])).sort((x, y) => x[0] - y[0]);
  const N = all.length, ranks = new Array(N); let tie = 0;
  for (let i = 0; i < N;) { let j = i; while (j + 1 < N && all[j + 1][0] === all[i][0]) j++; const rk = (i + j + 2) / 2; for (let q = i; q <= j; q++) ranks[q] = rk; const t = j - i + 1; tie += t * t * t - t; i = j + 1; }
  let R1 = 0; for (let i = 0; i < N; i++) if (all[i][1] === 0) R1 += ranks[i];
  const n1 = a.length, n2 = b.length, U = R1 - n1 * (n1 + 1) / 2, mu = n1 * n2 / 2;
  const sg = Math.sqrt(n1 * n2 / 12 * ((N + 1) - tie / (N * (N - 1))));
  if (!sg) return 1;
  const z = (Math.abs(U - mu) - 0.5) / sg; return Math.min(1, 2 * (1 - phi(z)));
}
/* frame-model metrics mean different things in v1 (cpu + readback wait) and
   v2 (max(cpu, gpu)): never compared across the two */
const FRAME_MODEL_KEY = /\.play\.[^.]+\.(frame|frameP95|meanFrame|gpuWait|hitchMs|frameCpu)$/;
const LOOK_KEYS = ["pixelRatio", "bufferMP", "tier", "shadowMap", "shadows", "fogFar"];
/* The SETTINGS half of the look guard (the pixel half needs a live A/B):
   any drop in pixel ratio, buffer, tier, shadows or fog is a LOOK
   REGRESSION. Scene counts are notes, never failures (culling lowers them). */
function lookSettings(curLook, baseLook, curCensus, baseCensus) {
  const bad = [], notes = [];
  for (const m of Object.keys(curLook || {})) {
    const L1 = curLook[m], L0 = baseLook && baseLook[m]; if (!L0 || !L1) continue;
    for (const f of LOOK_KEYS) {
      const x0 = L0[f], x1 = L1[f]; if (x0 == null || x1 == null) continue;
      if ((typeof x0 === "boolean" && x0 && !x1) || (typeof x0 === "number" && x1 < x0 - 1e-6)) bad.push(`${m}.${f}: ${x0} → ${x1}`);
    }
    const c0 = baseCensus && baseCensus[m], c1 = curCensus && curCensus[m];
    if (c0 && c1) {
      if (c1.veg && c0.veg && c1.veg.instances < c0.veg.instances * 0.9) notes.push(`${m}.trees(instances): ${c0.veg.instances} → ${c1.veg.instances}`);
      if (c1.visibleInstances < c0.visibleInstances * 0.9) notes.push(`${m}.visibleInstances: ${c0.visibleInstances} → ${c1.visibleInstances}`);
      if (c1.textures && c0.textures && c1.textures.megapixels < c0.textures.megapixels * 0.9) notes.push(`${m}.textureMP: ${c0.textures.megapixels} → ${c1.textures.megapixels}`);
    }
  }
  return { bad, notes };
}
/* Unpaired compare against a saved FILE. Mann-Whitney U when both sides
   carry 4+ runs of a metric; otherwise v1's rule (3x noise, 5% floor, CPU
   ms scaled by the machine-speed calibration), marked low-confidence. */
function compare(cur, base) {
  const rows = []; let regress = 0, lowConf = 0, skippedModel = 0;
  const factors = {};
  const sameModel = (base.version || 1) >= 2 && (base.frameModel || "serial") === (cur.frameModel || "serial");
  for (const k of Object.keys(cur.metrics)) {
    if (/\.calib$/.test(k) && base.metrics[k] && !NO_NORM) factors[k.split(".")[0]] = base.metrics[k].v / cur.metrics[k].v;
  }
  for (const k of Object.keys(cur.metrics)) {
    let a = base.metrics[k], b = cur.metrics[k]; if (!a || !b || b.unit === "calib") continue;
    if (!sameModel && FRAME_MODEL_KEY.test(k)) { skippedModel++; continue; }
    if (/\.build\.lm:/.test(k)) continue;              // same number as .builder.<file>
    const sub = SUBKEY.test(k);
    if (sub && Math.max(a.v, b.v) < 3) continue;
    const ra = a.runs || [a.v], rb = b.runs || [b.v];
    let verdict = "", thr = 0;
    const d = b.v - a.v;
    if (ra.length >= 4 && rb.length >= 4) {
      const p = mannWhitney(ra, rb), e = epsRel(k, b.unit, a.v) * Math.abs(a.v);
      thr = e;
      if (p < 0.01 && Math.abs(d) > e) verdict = d > 0 ? "SLOWER" : "faster";
    } else {
      const f = factors[k.split(".")[0]];
      // machine-speed normalisation: CPU ms only (GPU time and counts are not CPU)
      if (f && b.unit === "ms" && !/gpu/i.test(k)) b = { ...b, v: b.v * f, noise: b.noise * f };
      const d2 = b.v - a.v;
      const noise = Math.hypot(a.noise || 0, b.noise || 0);
      const floor = b.unit === "n" ? Math.max(1, 0.02 * a.v) : sub ? Math.max(15, 0.15 * a.v) : Math.max(0.5, 0.05 * a.v);
      thr = Math.max(3 * noise, floor);
      if (Math.abs(d2) > thr) { verdict = d2 > 0 ? "SLOWER" : "faster"; lowConf++; }
    }
    if (!verdict) continue;
    if (verdict === "SLOWER" && !sub) regress++;
    rows.push([k, a.v, b.v, b.v - a.v, thr, verdict, b.unit]);
  }
  const L = lookSettings(cur.look, base.look, cur.census, base.census);
  return { rows, regress, lookBad: L.bad, lookNotes: L.notes, factors, lowConf, skippedModel };
}

/* ---------------- the PIXEL look guard ---------------- */
function decodeShot(s) { return s && { w: s.w, h: s.h, L: Buffer.from(s.luma, "base64"), hw: s.hw, hh: s.hh, rgb: Buffer.from(s.rgb, "base64") }; }
/* SSIM per 8x8 block on luma (Wang et al. 2004 constants for 8-bit) */
function blockSsim(a, b, w, h, bs = 8) {
  const bw = Math.floor(w / bs), bh = Math.floor(h / bs), out = new Float32Array(bw * bh), C1 = 6.5025, C2 = 58.5225, n = bs * bs;
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let y = by * bs; y < by * bs + bs; y++) { let i = y * w + bx * bs; for (let x = 0; x < bs; x++, i++) { const p = a[i], q = b[i]; sa += p; sb += q; saa += p * p; sbb += q * q; sab += p * q; } }
    const ma = sa / n, mb = sb / n, va = saa / n - ma * ma, vb = sbb / n - mb * mb, cv = sab / n - ma * mb;
    out[by * bw + bx] = ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
  }
  return { s: out, bw, bh };
}
const STABLE_SSIM = 0.9, BAD_SSIM = 0.8;
function scoreOn(mask, ss) { let n = 0, sum = 0, bad = 0; for (let i = 0; i < mask.length; i++) if (mask[i]) { n++; sum += ss.s[i]; if (ss.s[i] < BAD_SSIM) bad++; } return { mean: n ? sum / n : 1, bad: n ? bad / n : 0 }; }
/* One spot. Base run 1 is the reference. Base run 2 marks the STABLE blocks
   (what re-renders the same without any code change: moving peds, cars and
   particles fall out). Base runs 3+ say how much of the stable picture a
   plain re-run changes (the floor, measured on blocks it did not choose).
   A candidate that changes clearly more than that is a LOOK REGRESSION. */
function lookSpot(name, B, C, outDir) {
  const r = { spot: name, baseShots: B.length, candShots: C.length };
  if (B.length < 2 || !C.length) { r.verdict = "n/a"; r.why = "needs 2+ base and 1+ candidate shots"; return r; }
  const ref = B[0];
  if (C.some((c) => c.w !== ref.w || c.h !== ref.h)) { r.verdict = "LOOK REGRESSION"; r.why = `drawing buffer ${ref.w}x${ref.h} → ${C[0].w}x${C[0].h}`; return r; }
  const st = blockSsim(ref.L, B[1].L, ref.w, ref.h);
  const mask = new Uint8Array(st.s.length); let nm = 0; for (let i = 0; i < mask.length; i++) if (st.s[i] >= STABLE_SSIM) { mask[i] = 1; nm++; }
  r.stableArea = +(nm / mask.length).toFixed(3);
  const floorImgs = B.length >= 3 ? B.slice(2) : [B[1]];
  r.floorBiased = B.length < 3;
  const fl = floorImgs.map((x) => scoreOn(mask, blockSsim(ref.L, x.L, ref.w, ref.h)));
  const cs = C.map((x) => blockSsim(ref.L, x.L, ref.w, ref.h)), cc = cs.map((ss) => scoreOn(mask, ss));
  r.floor = { changed: +Math.max(...fl.map((x) => x.bad)).toFixed(4), ssim: +Math.min(...fl.map((x) => x.mean)).toFixed(4) };
  r.cand = { changed: +median(cc.map((x) => x.bad)).toFixed(4), ssim: +median(cc.map((x) => x.mean)).toFixed(4), runs: cc.map((x) => +x.bad.toFixed(4)) };
  /* changed share of the stable picture: past the re-run floor by 0.5% of
     the frame AND by half again, or the stable picture's mean SSIM down 0.01 */
  const over = r.cand.changed - r.floor.changed;
  r.verdict = (over > 0.005 && r.cand.changed > 1.5 * r.floor.changed) || r.cand.ssim < r.floor.ssim - 0.01 ? "LOOK REGRESSION" : "same look";
  if (outDir) { try { r.png = writeLookPng(path.join(outDir, `look-${name}.png`), ref, C[0], cs[0], mask); } catch (e) { r.pngError = String(e.message || e); } }
  return r;
}
/* top: before | after. bottom: the SSIM heat map over "before" (red =
   changed, dark grey = masked as moving) | the absolute difference x4 */
function writeLookPng(file, a, b, ss, mask) {
  const hw = a.hw, hh = a.hh, sx = a.w / hw, sy = a.h / hh, bw = ss.bw;
  encodeAndWrite(file, hw * 2, hh * 2, (x, y) => {
    if (y < hh) { const src = x < hw ? a : b, xx = x % hw, i = (y * hw + xx) * 3; return [src.rgb[i], src.rgb[i + 1], src.rgb[i + 2]]; }
    const yy = y - hh, xx = x % hw, i = (yy * hw + xx) * 3;
    if (x >= hw) return [Math.min(255, 4 * Math.abs(a.rgb[i] - b.rgb[i])), Math.min(255, 4 * Math.abs(a.rgb[i + 1] - b.rgb[i + 1])), Math.min(255, 4 * Math.abs(a.rgb[i + 2] - b.rgb[i + 2]))];
    const g = (a.rgb[i] * 54 + a.rgb[i + 1] * 183 + a.rgb[i + 2] * 19) >> 8;
    const bi = Math.min(ss.bh - 1, Math.floor(yy * sy / 8)) * bw + Math.min(bw - 1, Math.floor(xx * sx / 8));
    if (!mask[bi]) return [g * 0.2 + 30, g * 0.2 + 30, g * 0.2 + 30];
    const v = Math.max(0, Math.min(1, (1 - ss.s[bi]) * 3));
    return [g * 0.45 * (1 - v) + 255 * v, g * 0.45 * (1 - v), g * 0.45 * (1 - v)];
  });
  return file;
}
function encodeAndWrite(file, w, h, px) { fs.writeFileSync(file, encodePng(w, h, px)); }

/* ---------------- printing ---------------- */
function table(res) {
  const L = [];
  const p = (s) => L.push(s);
  p("");
  if (res.slice || res.sliceSpots) p(`CITY SLICE  ${res.slice ? "booted: " + res.slice : "whole city"}${res.sliceSpots ? "  spots: " + res.sliceSpots : ""}  (src/core/slice.js)`);
  p(`SPEED v2  ${res.commit || res.url}  seed ${res.seed}  gpu ${res.gpu}  ${res.device} ${res.viewport}  runs ${res.runs}  shaders ${res.shaders}  frame ${res.frameModel}  load avg ${res.uptimeStart.load1}→${res.uptimeEnd.load1} (${res.uptimeStart.cpus} cpu)  tool ${res.toolWallS}s`);
  for (const m of res.modes) {
    const r = res.detail[m] && res.detail[m][0]; if (!r) continue;
    const M = res.metrics, g = (k) => M[`${m}.${k}`];
    const pm = (k, label, u = "ms") => { const x = g(k); if (x) p(`  ${label.padEnd(30)} ${fmt(x.v, u === "n" ? 0 : 1).padStart(10)} ${u === "n" ? "  " : "ms"} ±${fmt(x.noise, u === "n" ? 0 : 1)}`); };
    p("");
    p(`== ${m.toUpperCase()} ${r.ok ? "" : "FAILED: " + r.error}`);
    if (r.look) p(`  look: tier ${r.look.tier} pr ${r.look.pixelRatio} buffer ${r.look.drawingBuffer} (${r.look.css}@${r.look.devicePixelRatio}x) shadows ${r.look.shadows ? r.look.shadowMap : "off"} fog ${r.look.fogFar}  gpu ${String(r.look.gpu || "").slice(0, 50)}`);
    pm("load.total", "LOAD nav→playable");
    pm("load.title", "  title ready (nav → last script)");
    pm("load.scriptEval", "    script eval (all tags)");
    pm("load.prisonAtParse", `    of which prison built at parse (${r.scripts ? r.scripts.prisonFiles : "?"} files)`);
    pm("load.loadHandlers", "    window load handlers (prison batch)");
    pm("load.loadEventAt", "    (window load event fired at)");
    pm("load.build", "  build (startRun, one task)");
    pm("load.buildCompile", "    of which shader compile (in build)");
    pm("load.firstFrame", "  first frame");
    pm("load.firstFrameCompile", "  shader compile blocking (first+settle)");
    pm("load.warmFrames", "  settle (frames 2..steady)");
    pm("load.entryToFirstDraw", "  entry → first draw");
    pm("load.programs", "  programs compiled", "n");
    if (r.mem) { const b = r.mem.boot || {}, st = r.mem.steady || {};
      p(`  MEMORY (MB)  JS heap peak ${fmt(b.heap, 0)} / steady ${fmt(st.heap, 0)}${st.cdpHeap != null ? ` (= V8 heap ${fmt(st.cdpHeap, 0)} + ArrayBuffers ${fmt(st.arrayBuffers, 0)})` : ""}   GPU peak ${fmt(b.gpu, 0)} / steady ${fmt(st.gpu, 0)} [textures ${fmt(st.tex, 0)} buffers ${fmt(st.buf, 0)} renderbuffers ${fmt(st.rb, 0)} drawing buffer ${fmt(st.db, 0)}]   2D canvases ${fmt(st.cv2d, 0)}`);
      if (r.heapSites && r.heapSites.files) { p(`  ${HEAP_GARBAGE ? "ALLOCATED (incl. garbage)" : "LIVE"} V8 BY FILE (sampled, ${r.heapSites.totalMB} MB): ` + r.heapSites.files.slice(0, 25).map(([f, mb]) => `${f} ${mb}`).join(" · "));
        p(`  ${HEAP_GARBAGE ? "ALLOCATED" : "LIVE"} V8 BY SITE: ` + r.heapSites.sites.slice(0, 30).map(([f, mb]) => `${f} ${mb}`).join(" · ")); }
      if (st.liveHeap != null) p(`  LIVE after a forced GC: JS heap ${fmt(st.liveHeap, 0)} (V8 ${fmt(st.liveV8, 0)} + ArrayBuffers ${fmt(st.liveArrayBuffers, 0)})   phone live ${fmt(st.livePhone, 0)} MB ${memVerdict(st.livePhone)}`);
      p(`  PHONE TOTAL (heap + GPU)  peak ${fmt(b.phone, 0)} MB ${memVerdict(b.phone)}   steady ${fmt(st.phone, 0)} MB ${memVerdict(st.phone)}   (budget ${r.mem.budgetMB || MEM_BUDGET_MB} MB; iOS kills a tab near 1-1.5 GB)${r.mem.precise === false ? "  [heap NOT precise]" : ""}`); }
    if (g("load.cpu.main")) p(`  CPU time (Chrome): main thread ${fmt(g("load.cpu.main").v, 0)} ms (build ${fmt(g("load.cpu.mainBuild") && g("load.cpu.mainBuild").v, 0)}, first frames ${fmt(g("load.cpu.mainFirstFrames") && g("load.cpu.mainFirstFrames").v, 0)}, V8 compile ${fmt(g("load.cpu.v8Compile") && g("load.cpu.v8Compile").v, 0)})  GPU process ${fmt(g("load.cpu.gpuProc") && g("load.cpu.gpuProc").v, 0)} ms (first frames ${fmt(g("load.cpu.gpuProcFirstFrames") && g("load.cpu.gpuProcFirstFrames").v, 0)})`);
    if (g("load.return.total")) p(`  RETURN VISIT ${fmt(g("load.return.total").v, 0)} ms = title ${fmt(g("load.return.title") && g("load.return.title").v, 0)} (script eval ${fmt(g("load.return.scriptEval") && g("load.return.scriptEval").v, 0)}) + build ${fmt(g("load.return.build") && g("load.return.build").v, 0)} + first frame ${fmt(g("load.return.firstFrame") && g("load.return.firstFrame").v, 0)} (compile ${fmt(g("load.return.firstFrameCompile") && g("load.return.firstFrameCompile").v, 0)}) + settle ${fmt(g("load.return.warmFrames") && g("load.return.warmFrames").v, 0)}; GPU process ${fmt(g("load.return.cpu.gpuProc") && g("load.return.cpu.gpuProc").v, 0)} ms`);
    if (r.firstFrames && r.firstFrames.length && r.firstFrames[0].top != null) p("  settle frames: " + r.firstFrames.slice(0, 12).map((f) => `${fmt(f.cpu + f.fin, 0)}${f.newPrograms ? "/" + f.newPrograms + "p" : ""}`).join(" ") + `  (${r.settleFrames} to steady; worst: ${r.firstFrames.slice().sort((a, b) => b.cpu - a.cpu)[0].top})`);
    if (r.phases && PAGE_MODES[m].kind === "cbz") {
      const top = r.phases.slice().sort((a, b) => b[1] - a[1]).slice(0, 8);
      p("  build checkpoints (ms from key to next): " + top.map(([k, v]) => `${k} ${fmt(v, 0)}`).join(" · "));
    }
    if (r.builders && r.builders.length) p("  landmass builders: " + r.builders.slice(0, 8).map(([k, v]) => `${k} ${fmt(v, 0)}`).join(" · "));
    if (r.scripts && r.scripts.top) p("  slowest scripts (eval): " + r.scripts.top.slice(0, 6).map(([k, v]) => `${k.split("/").pop()} ${fmt(v, 0)}`).join(" · "));
    if (r.census) p(`  scene: ${r.census.meshes} meshes (${r.census.visibleMeshes} visible), ${r.census.instances} instances, ${(r.census.sceneTris / 1e6).toFixed(2)}M visible tris; VEGETATION ${r.census.veg.instancedMeshes} inst-meshes + ${r.census.veg.meshes} meshes, ${r.census.veg.instances} instances (${r.census.veg.visibleInstances} visible), ${(r.census.veg.tris / 1e6).toFixed(2)}M tris${r.census.veg.registeredTrees != null ? ", treeAudit " + r.census.veg.registeredTrees + " trees" : ""}`);
    if (r.play) for (const s of Object.keys(r.play.spots)) {
      const o = r.play.spots[s];
      const gv = (k) => g(`play.${s}.${k}`);
      p(`  PLAY ${s.padEnd(9)} frame ${fmt(gv("frame") && gv("frame").v)} ms ±${fmt(gv("frame") && gv("frame").noise, 2)} (p95 ${fmt(gv("frameP95") && gv("frameP95").v)}, mean ${fmt(o.meanFrame)})  cpu ${fmt(o.cpu && o.cpu.med)} [sim ${fmt(o.sim && o.sim.med)} always ${fmt(o.alw && o.alw.med)} render ${fmt(o.render && o.render.med)}]  gpu ${o.gpu ? fmt(o.gpu.med) + ` [main ${fmt(o.gMain.med)} shadow ${fmt(o.gShadow.med)} rt ${fmt(o.gRt.med)}]` : "-"}${o.fin && o.fin.med ? "  wait " + fmt(o.fin.med) : ""}  calls ${o.calls ? o.calls.med : "-"}  tris ${o.tris ? (o.tris.med / 1e6).toFixed(2) + "M" : "-"}${o.emptyFrames ? "  EMPTY " + o.emptyFrames : ""}`);
      if (o.mem) p(`     memory (MB): heap ${fmt(o.mem.heap, 0)} GPU ${fmt(o.mem.gpu, 0)} [tex ${fmt(o.mem.tex, 0)} buf ${fmt(o.mem.buf, 0)} rb ${fmt(o.mem.rb, 0)}]  phone ${fmt(o.mem.phone, 0)} ${memVerdict(o.mem.phone)}${o.mem.peak ? `, peak here ${fmt(o.mem.peak.phone, 0)} ${memVerdict(o.mem.peak.phone)}` : ""}`);
      if (o.cpuThread != null || o.gpuPasses) p(`     CPU/frame (Chrome): main thread ${fmt(o.cpuThread)} ms, GPU process ${fmt(o.gpuProcCpu)} ms${o.gpuPasses ? "   GPU passes (mean ms/frame): " + o.gpuPasses.slice(0, 6).map(([k, v]) => `${k.replace(/src\//, "")} ${fmt(v, 2)}`).join(" · ") : ""}${o.gpuDisjoint ? "  (GPU DISJOINT: timings suspect)" : ""}`);
      if (o.updaters && o.updaters.length) p("     top updaters (mean/median ms): " + o.updaters.slice(0, 8).map((u) => `${u[0].replace(/^([ua])@/, "$1").replace(/^([ua][0-9.]+) src\//, "$1 ")} ${fmt(u[3], 1)}/${fmt(u[1], 1)}`).join(" · "));
      if (o.hitches && o.hitches.length) p("     hitches [frame, ms, worst, its ms, new programs]: " + o.hitches.slice(0, 5).map((h) => JSON.stringify(h)).join(" "));
      if (o.attribute) {
        const A = o.attribute, b = (A.base.frame + A.base2.frame) / 2;
        const gb = (A.base.fin + A.base2.fin) / 2;
        const sh = (x) => x ? `${fmt(x.frame, 1)}ms (${fmt(100 * (b - x.frame) / b, 0)}%, gpu ${fmt(100 * (gb - x.fin) / gb, 0)}%)` : "-";
        p(`     ATTRIBUTE (diagnostic, % saved of frame / of GPU wait): base ${fmt(b)}ms gpu ${fmt(gb)}ms · no shadows ${sh(A.noShadows)} · pr/2 ${sh(A.halfPR)} · full DPR ${sh(A.fullDPR)} · tier-1 ${sh(A.tierDown)} · tier+1 ${sh(A.tierUp)} · no vegetation ${sh(A.noVegetation)} [calls ${A.base.calls}→${A.noVegetation.calls}, tris ${A.base.tris}→${A.noVegetation.tris}]`);
      }
    }
    if (r.errors && r.errors.n) p(`  console errors: ${r.errors.n}  ${(r.errors.first || []).slice(0, 2).join(" | ").slice(0, 200)}`);
    if (r.profile) for (const [k, pr] of Object.entries(r.profile)) {
      p(`  V8 PROFILE ${k} (${pr.totalMs} ms sampled) top self-time:`);
      for (const [f, ms] of pr.topFunctions.slice(0, 15)) p(`     ${fmt(ms, 0).padStart(7)} ms  ${f}`);
      p(`    inclusive by file (on the stack): ` + pr.inclusiveFiles.filter(([f]) => !/three\.r128|^\(/.test(f)).slice(0, 12).map(([f, ms]) => `${f.replace(/^src\//, "")} ${fmt(ms, 0)}`).join(" · "));
    }
  }
  return L.join("\n");
}

/* ---------------- main ---------------- */
let B = null;
const servers = [];
const cleanup = () => { try { B && B.close(); } catch (_) {} for (const s of servers) try { s.close(); } catch (_) {} for (const d of tmpDirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} releaseLock(); };
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

async function serve(root) { const srv = await startServer(root); servers.push(srv); return `http://127.0.0.1:${srv.address().port}/`; }
async function runMode(base, m, ctx) {
  const withPlay = DO_PLAY && (m === "city" || MODES.length > 1 || has("--play"));
  return PAGE_MODES[m].kind === "cbz" ? runCbz(B, base, m, withPlay, ctx) : runPage(B, base, m, withPlay);
}
/* pull the pixels out of a run (they never go into the JSON) */
function takeShots(r, into) {
  if (!r.play) return;
  for (const [name, o] of Object.entries(r.play.spots)) if (o.shot) { const k = r.mode + "/" + name; (into[k] = into[k] || []).push(decodeShot(o.shot)); delete o.shot; }
}
function resultShell(extra) {
  return { tool: "speed.mjs", version: 2, at: new Date().toISOString(), commit, url: URL_ARG || null, seed: SEED, gpu: GPU, device: DEVICE,
    viewport: `${VIEW.w}x${VIEW.h}@${VIEW.dpr}`, frames: FRAMES, warm: WARM, modes: MODES, shaders: SHADERS, frameModel: SERIAL ? "serial" : "pipelined",
    returnVisit: RETURN, slice: SLICE || undefined, sliceSpots: SLICE_SPOTS || undefined, lockWaitS: +LOCK_WAIT_S.toFixed(1), host: os.hostname(), cpu: os.cpus()[0].model, ...extra };
}
function lookOf(detail, k) { return Object.fromEntries(MODES.map((m) => [m, detail[m] && detail[m][0] && detail[m][0][k]]).filter((x) => x[1])); }

/* ---------------- THE WARM WORLD: --serve / --ask ----------------
   Boot the city ONCE (a measured load, under the lock), keep it held, and
   answer queries in seconds: frames at the fixed spots, an IN-PAGE A/B of a
   toggle at the same instant, an eval, a reload. One world per served tree
   (state file keyed by the tree's path), so every builder's branch has its
   own. Each query takes the machine lock only while it measures (the FIFO
   queue makes that a short wait). A query notices edited files under the
   served tree and reloads the page first, so it never answers for stale code.
   The world exits after --idle seconds (default 1200) without a query. */
const WORLD_KEY = crypto.createHash("md5").update((URL_ARG || ROOT) + (SLICE ? "#slice=" + SLICE : "")).digest("hex").slice(0, 10);
const WORLD_FILE = opt("--world", "") || `/tmp/cbz-speed-world-${WORLD_KEY}.json`;
const IDLE_S = Math.max(60, +opt("--idle", 1200) || 1200);
function readWorld() { try { const w = JSON.parse(fs.readFileSync(WORLD_FILE, "utf8")); return w && pidAlive(w.pid) ? w : null; } catch (_) { return null; } }
/* newest mtime of anything the page loads (index.html, src/, games/) */
function treeMtime(root) {
  let t = 0;
  const walk = (d) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of es) { const f = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== "node_modules" && e.name[0] !== ".") walk(f); } else if (/\.(js|html|glsl|json|css)$/.test(e.name)) { try { const m = fs.statSync(f).mtimeMs; if (m > t) t = m; } catch (_) {} } } };
  try { t = Math.max(t, fs.statSync(path.join(root, "index.html")).mtimeMs); } catch (_) {}
  walk(path.join(root, "src")); walk(path.join(root, "games"));
  return t;
}
const compact = (o) => o && ({
  frame: o.frame && +o.frame.med.toFixed(2), p95: o.frame && +o.frame.p95.toFixed(1), cpu: o.cpu && +o.cpu.med.toFixed(2),
  gpu: o.gpu ? +o.gpu.med.toFixed(2) : null, gpuMain: o.gMain ? +o.gMain.med.toFixed(2) : null, gpuShadow: o.gShadow ? +o.gShadow.med.toFixed(2) : null, gpuRt: o.gRt ? +o.gRt.med.toFixed(2) : null,
  sim: o.sim && +o.sim.med.toFixed(2), always: o.alw && +o.alw.med.toFixed(2), render: o.render && +o.render.med.toFixed(2), cpuThread: o.cpuThread != null ? +o.cpuThread.toFixed(2) : null, gpuProcCpu: o.gpuProcCpu != null ? +o.gpuProcCpu.toFixed(2) : null,
  calls: o.calls && o.calls.med, tris: o.tris && o.tris.med, frames: o.frame && o.frame.n,
  passes: (o.gpuPasses || []).slice(0, 6).map(([k, v]) => [k, +v.toFixed(2)]), updaters: (o.updaters || []).slice(0, 8).map((u) => [u[0], +u[3].toFixed(2)]), hitches: (o.hitches || []).slice(0, 3) });

async function serveMain() {
  const prev = readWorld();
  if (prev) { console.error(`[speed] a warm world already serves this tree: pid ${prev.pid} port ${prev.port} (${WORLD_FILE}); --ask stop first`); process.exit(2); }
  const m = MODES[0];
  if (PAGE_MODES[m].kind !== "cbz") { console.error("--serve serves index.html modes (city, escape, survival, sharksim, gungame)"); process.exit(2); }
  let base = URL_ARG || await serve(ROOT);
  const url = modeUrl(base, m);
  let P = null, spots = null, bootInfo = null, bootMtime = 0;
  const bootWorld = async (why) => {
    const w = await takeLock(`serve ${why} ${ROOT}`);
    try {
      if (!B) B = await launchChrome();
      if (P) { try { await P.close(); } catch (_) {} }
      P = await newPage(B);
      bootMtime = URL_ARG ? 0 : treeMtime(ROOT);
      const out = { mode: m };
      await measureLoad(B, P, url, out, null);
      out.look = await P.ev("window.__speed.look()");
      spots = m === "city" ? await P.ev("window.__speed.spots()", 120000) : await P.ev("(function(){ var p = CBZ.player; return p && p.pos ? { spawn: { x: p.pos.x, y: p.pos.y, z: p.pos.z, player: true } } : { spawn: { x: 0, y: 0, z: 0 } }; })()");
      bootInfo = { load: Math.round(out.loadMs), build: Math.round(out.buildMs), firstFrame: Math.round(out.firstFrameMs), settle: Math.round(out.warmMs), programs: out.programs,
        cpuMain: out.cpu && Math.round(out.cpu.main), gpuProc: out.cpu && Math.round(out.cpu.gpuProc), look: out.look, lockWaitS: +w.toFixed(1), why, at: new Date().toISOString() };
      return bootInfo;
    } finally { releaseLock(); }
  };
  log(`[speed ${since()}] warm world: booting ${m} from ${URL_ARG || ROOT}`);
  await bootWorld("boot");
  log(`[speed ${since()}] warm world READY: load ${bootInfo.load} ms (build ${bootInfo.build}, first frame ${bootInfo.firstFrame}); spots ${Object.keys(spots).join(", ")}`);
  let idleAt = Date.now(), chain = Promise.resolve();
  const place = (sp) => `(function(){ var S = window.__speed; S.pose = null; S.place(${JSON.stringify(sp)}); return 1; })()`;
  const spotList = (q) => { const names = q.spots && q.spots.length ? q.spots : Object.keys(spots); const bad = names.filter((n) => !spots[n]); if (bad.length) throw new Error(`unknown spot ${bad.join(",")}; this world has ${Object.keys(spots).join(", ")}`); return names; };
  const setToggle = (code, on) => P.ev(`(function(on){ ${code}\n; return 1; })(${on})`, 60000);
  async function frozenShot(n) { await P.ev(`(function(){ var S = window.__speed; S.step(${n}, { frozen: true, grab: true }); return 1; })()`, 120000); return decodeShot(await P.ev("window.__speed.shotOut()", 60000)); }
  async function handle(q) {
    const t0 = Date.now(), op = q.op || "frames";
    if (op === "info") return { root: ROOT, url, commit, spots, boot: bootInfo, pid: process.pid };
    if (op === "stop") { setTimeout(() => { cleanup(); try { fs.unlinkSync(WORLD_FILE); } catch (_) {} process.exit(0); }, 50); return { stopped: true }; }
    const res = { op };
    // stale code? reload first, so an answer is never about the old tree
    if (op === "reload" || (!URL_ARG && q.reload !== false && treeMtime(ROOT) > bootMtime)) {
      res.reloaded = await bootWorld(op === "reload" ? "reload" : "edited files");
      if (op === "reload") { res.ms = Date.now() - t0; return res; }
    }
    // --ask eval '<expr>' --allocs: who ALLOCATED (garbage included) while the expression ran
    if (op === "eval") {
      // --gc: a full collection first (what is LIVE, not what is garbage)
      if (q.gc) { try { await P.s("HeapProfiler.collectGarbage", {}, 30000); await P.s("HeapProfiler.collectGarbage", {}, 30000); } catch (e) {} }
      if (q.allocs) { await P.s("HeapProfiler.enable"); await P.s("HeapProfiler.startSampling", q.liveOnly ? { samplingInterval: 65536 } : { samplingInterval: 262144, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }
      res.value = await P.ev(q.expr, (q.timeoutS || 60) * 1000);
      if (q.allocs && q.liveOnly) { try { await P.s("HeapProfiler.collectGarbage", {}, 30000); } catch (e) {} }
      if (q.allocs) { try { const { profile } = await P.s("HeapProfiler.getSamplingProfile", {}, 300000); await P.s("HeapProfiler.stopSampling", {}, 60000); const h = heapSites(profile); res.allocs = { totalMB: h.totalMB, files: h.files.slice(0, 20), sites: h.sites.slice(0, 30), vendor: h.vendor }; } catch (e) { res.allocs = { err: String(e).slice(0, 200) }; } }
      res.ms = Date.now() - t0; return res;
    }
    /* --ask drive [--route x,z;x,z;...] [--mps 40] [--secs 60]: a FAST DRIVE on
       the live world. The player is carried along the route at a fixed speed
       (the streamer, farcull, metro and grass see a real mover), the camera
       looks down the road, frames are stepped at 1/60 s. Every second: JS heap,
       GPU bytes, phone total, stream built/parked/queued, frame ms. POP-INS:
       every frame each top-level object under the city root and the scene is
       checked; one that turns from not-drawn to drawn (added, shown, or its
       first mesh appears) while its bounding sphere is inside the camera
       frustum AND nearer than the fog's far distance is a pop-in (the owner's
       rule: nothing may assemble itself in view). Target 0. */
    if (op === "drive") {
      const route = q.route || null, mps = q.mps || 40, secs = q.secs || 60;
      // --allocs: V8's sampling heap profiler over the drive, INCLUDING what
      // the collector already took (the churn behind the sawtooth), by site
      if (q.allocs) { await P.s("HeapProfiler.enable"); await P.s("HeapProfiler.startSampling", { samplingInterval: 262144, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }
      res.value = await P.ev(`(async function(route, MPS, SECS){
        var S = window.__speed, C = window.CBZ, T = window.THREE, Pl = C.player; if (!Pl || !Pl.pos) return { err: "no player" };
        /* EVERY FRAME ITS OWN TASK, like real play: a GL fence can only
           signal and the collector only idles between tasks, so a drive
           stepped inside one task measured neither (GPU read-back never ran,
           garbage never collected). ?YIELD=0 in --query keeps the old loop. */
        var YIELD = !/[?&]YIELD=0\b/.test(location.search);
        var A = C.city && C.city.arena; var root = A && A.root;
        /* --route road (the default): a real drive along the city's streets.
           From the nearest road segment, run to one of its ends, then turn
           onto the connected segment that continues farthest without doubling
           back, until the route is long enough. --route straight keeps the old
           through-the-blocks line (a crash-stress case: it hits walls). */
        if (route === "road") {
          var R0 = (A && A.roads || []).filter(function (r) { return r && r.x != null && r.z != null && r.len > 8; });
          var ends = function (r) { var h = r.len / 2; return r.vertical ? [[r.x, r.z - h], [r.x, r.z + h]] : [[r.x - h, r.z], [r.x + h, r.z]]; };
          var cur = null, bd = Infinity;
          for (var ri = 0; ri < R0.length; ri++) { var dd = Math.hypot(R0[ri].x - Pl.pos.x, R0[ri].z - Pl.pos.z); if (dd < bd) { bd = dd; cur = R0[ri]; } }
          route = null;
          if (cur) {
            var E = ends(cur), used = new Set([cur]), len = 0, need = MPS * SECS * 1.05;
            route = [[cur.x, cur.z], E[1]]; len += cur.len / 2;
            var at2 = E[1], dir = cur.vertical ? [0, 1] : [1, 0], guard = 0;
            while (len < need && guard++ < 400) {
              var best = null, bs = -Infinity, bend = null;
              for (var rj = 0; rj < R0.length; rj++) {
                var r2 = R0[rj]; if (used.has(r2)) continue;
                var e2 = ends(r2);
                // the current point must lie ON this road (a crossing or a T,
                // not only end-to-end): within 14 m of its centre line
                var hl = r2.len / 2, onIt = r2.vertical
                  ? (Math.abs(at2[0] - r2.x) < 14 && at2[1] > r2.z - hl - 14 && at2[1] < r2.z + hl + 14)
                  : (Math.abs(at2[1] - r2.z) < 14 && at2[0] > r2.x - hl - 14 && at2[0] < r2.x + hl + 14);
                if (!onIt) continue;
                for (var k2 = 0; k2 < 2; k2++) {
                  var far2 = e2[k2], vx2 = far2[0] - at2[0], vz2 = far2[1] - at2[1], vl = Math.hypot(vx2, vz2) || 1;
                  if (vl < 30) continue;
                  var sc = (vx2 * dir[0] + vz2 * dir[1]) / vl * 50 + r2.len * 0.05;   // prefer straight on, then long
                  if (sc > bs && (vx2 * dir[0] + vz2 * dir[1]) / vl > -0.2) { bs = sc; best = r2; bend = far2; }
                }
              }
              if (!best) break;
              used.add(best);
              // turn at the crossing: the route runs along the new road's line
              var cross = best.vertical ? [best.x, at2[1]] : [at2[0], best.z];
              if (Math.hypot(cross[0] - at2[0], cross[1] - at2[1]) > 0.5) route.push(cross);
              route.push(bend); len += Math.hypot(bend[0] - cross[0], bend[1] - cross[1]);
              dir = [(bend[0] - at2[0]) / (Math.hypot(bend[0] - at2[0], bend[1] - at2[1]) || 1), (bend[1] - at2[1]) / (Math.hypot(bend[0] - at2[0], bend[1] - at2[1]) || 1)];
              at2 = bend;
            }
            if (route.length < 2) route = null;
          }
        }
        if (route === "straight" || !route || !route.length) { var sx = Pl.pos.x, sz = Pl.pos.z; route = [[sx, sz], [sx - MPS * SECS * 0.5, sz - 300], [sx - MPS * SECS * 0.7, sz + MPS * SECS * 0.45]]; }
        var legs = [], tot = 0; for (var i = 0; i + 1 < route.length; i++) { var L = Math.hypot(route[i+1][0]-route[i][0], route[i+1][1]-route[i][1]); legs.push(L); tot += L; }
        function at(d){ for (var i = 0; i < legs.length; i++) { if (d <= legs[i] || i === legs.length - 1) { var f = Math.min(1, d / legs[i]); return [route[i][0] + (route[i+1][0]-route[i][0]) * f, route[i][1] + (route[i+1][1]-route[i][1]) * f, Math.atan2(route[i+1][0]-route[i][0], route[i+1][1]-route[i][1])]; } d -= legs[i]; } }
        var gh = function(x, z){ try { var y = A && A.groundHeightAt ? A.groundHeightAt(x, z) : 0; return isFinite(y) ? y : 0; } catch (e) { return 0; } };
        var fr = new T.Frustum(), pm = new T.Matrix4(), bx = new T.Box3(), sph = new T.Sphere(), cache = new WeakMap(), was = new WeakMap();
        /* no closures, no allocation per call: the scan itself must not be
           the garbage the drive measures (a traverse() callback per object
           per frame was ~300k closures a second) */
        var _st = [];
        function drawn(o){ if (!o.visible) return false; _st.length = 0; _st.push(o);
          while (_st.length) { var c = _st.pop(); if (!c.visible) continue;
            if ((c.isMesh || c.isPoints || c.isLine) && (c.count == null || c.count > 0)) { _st.length = 0; return true; }
            var ch = c.children; for (var i = 0; i < ch.length; i++) _st.push(ch[i]); }
          return false; }
        function label(o){ var n = o.name || ""; if (!n) { var ch = o.children; for (var i = 0; i < ch.length && !n; i++) n = ch[i].name || ""; }
          var u = o.userData || {}, uk = Object.keys(u).filter(function(k){ return k !== "_builder"; }).slice(0, 3).join(",");
          var nm = 0; o.traverse && (function(){ var st = [o]; while (st.length && nm < 999) { var c = st.pop(); if (c.isMesh) nm++; for (var i = 0; i < c.children.length; i++) st.push(c.children[i]); } })();
          return (o.type) + (n ? ":" + n : "") + (u._builder ? "@" + u._builder : "") + (uk ? "{" + uk + "}" : "") + "#" + nm; }
        var pops = [], popN = 0, checks = 0, handoffs = 0;
        function scan(first){
          var cam = C.camera; cam.updateMatrixWorld(); pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); fr.setFromProjectionMatrix(pm);
          var fog = (C.scene && C.scene.fog && C.scene.fog.far) || C.cityFogFar || 760;
          var lists = [root ? root.children : [], C.scene.children];
          for (var li = 0; li < lists.length; li++) { var L = lists[li]; for (var k = 0; k < L.length; k++) { var o = L[k]; if (o === root) continue;
            var d = drawn(o), w = was.get(o); was.set(o, d); if (first || !d || w === true) continue;
            var u = o.userData || {}; if (u.dynamic || u.worldSurface || u.terrain) continue;
            // a LOD HANDOFF is not a build in view: a car the pools drew until
            // this frame, a building whose LOD box stood in until farcull's
            // radius. Counted apart (handoffs) so the pop number is creations.
            var tnow = performance.now();
            if ((u._handoffAt && tnow - u._handoffAt < 400) || (C.farcullShownAt && tnow - C.farcullShownAt(o) < 400)) { handoffs++; continue; }
            var sp, dist;
            if (o.isInstancedMesh) {
              // a pool (car-instances): its own bounds are one prototype at
              // the origin, so measure its NEAREST drawn instance instead
              var im = o.instanceMatrix.array, nI = Math.min(o.count | 0, 256), best = Infinity, e = o.matrixWorld.elements;
              for (var ii = 0; ii < nI; ii++) { var ix = im[ii * 16 + 12] + e[12], iz = im[ii * 16 + 14] + e[14], dd = Math.hypot(ix - cam.position.x, iz - cam.position.z); if (dd < best) best = dd; }
              if (best === Infinity) continue;
              checks++;
              sp = sph; sp.center.set(cam.position.x, cam.position.y, cam.position.z); sp.radius = 0.5;
              dist = best;
              if (dist < fog) { popN++; if (pops.length < 30) pops.push([label(o), Math.round(dist), 0]); }
              continue;
            }
            sp = cache.get(o); if (!sp) { bx.setFromObject(o); if (bx.isEmpty()) continue; sp = bx.getBoundingSphere(new T.Sphere()); cache.set(o, sp); }
            checks++;
            dist = sp.center.distanceTo(cam.position) - sp.radius;
            if (dist < fog && sp.radius < fog && fr.intersectsSphere(sp)) { popN++; if (pops.length < 30) pops.push([label(o), Math.round(dist), Math.round(sp.radius)]); } } }
        }
        var samples = [], t0 = performance.now(), frames = SECS * 60, d = 0;
        scan(true);
        var hp = 0, gp = 0, php = 0;
        for (var f = 0; f < frames; f++) {
          d += MPS / 60; var q = at(Math.min(d, tot));
          S.step(1, { path: function(){ Pl.pos.x = q[0]; Pl.pos.z = q[1]; Pl.pos.y = gh(q[0], q[1]); if (Pl.vel) { Pl.vel.x = 0; Pl.vel.y = 0; Pl.vel.z = 0; } Pl.hp = Math.max(Pl.hp || 0, 100);
            if (C.playerChar && C.playerChar.group) { C.playerChar.group.position.set(q[0], Pl.pos.y, q[1]); C.playerChar.group.rotation.y = q[2]; }
            if (C.cam) C.cam.yaw = q[2] + Math.PI; } });
          if (f & 1) scan(false);
          if (YIELD) await new Promise(function (r) { setTimeout(r, 0); });
          if (f % 60 === 59) { var m = S.memRead(); hp = Math.max(hp, m.heap); gp = Math.max(gp, m.gpu); php = Math.max(php, m.phone);
            var st = C.streamStats || {}; samples.push([Math.round((f + 1) / 60), Math.round(m.heap), Math.round(m.gpu), Math.round(m.phone), st.built, st.parked, st.queued, C.slice ? Math.round(C.slice.keepR()) : null]); }
        }
        return { routeLegs: route.length - 1, routeKm: +(tot / 1000).toFixed(2), km: +(Math.min(d, tot) / 1000).toFixed(2), wallS: +((performance.now() - t0) / 1000).toFixed(1), peak: { heap: Math.round(hp), gpu: Math.round(gp), phone: Math.round(php) },
          pops: popN, popChecks: checks, lodHandoffs: handoffs, popSamples: pops, cols: "s heap gpu phone built parked queued keepR", samples: samples };
      })(${JSON.stringify(route)}, ${+mps}, ${+secs})`, 1800000);
      if (q.allocs) { try { const { profile } = await P.s("HeapProfiler.getSamplingProfile", {}, 300000); await P.s("HeapProfiler.stopSampling", {}, 60000); res.allocs = heapSites(profile); } catch (e) { res.allocs = { err: String(e).slice(0, 200) }; } }
      res.ms = Date.now() - t0; return res;
    }
    // --ask prof '<expr>': the expression under V8's CPU profiler (1 ms), the
    // same self / inclusive tables as --profile, plus the expression's value
    if (op === "prof") {
      await P.s("Profiler.enable"); await P.s("Profiler.setSamplingInterval", { interval: 1000 }); await P.s("Profiler.start");
      try { res.value = await P.ev(q.expr, (q.timeoutS || 300) * 1000); }
      finally { const { profile } = await P.s("Profiler.stop", {}, 240000); const sm = summarizeProfiles({ run: profile }).run; res.profile = { totalMs: sm.totalMs, self: sm.topFunctions.slice(0, 25), inclusive: sm.inclusiveFunctions.slice(0, 50), files: sm.inclusiveFiles.slice(0, 25) }; }
      res.ms = Date.now() - t0; return res;
    }
    /* LOCKING. frames are absolute numbers: they wait for the machine lock
       (--no-lock skips it and says so). An in-page ab is PAIRED — base and
       candidate blocks alternate within a second of each other, so other
       load hits both — and it runs at once without waiting (--lock waits). */
    const wantLock = op === "ab" ? q.lock === true : q.lock !== false;
    if (wantLock) { const lw = await takeLock(`world ${op}`); res.lockWaitS = +lw.toFixed(1); }
    else { const h = lockHolder(); if (h.pid && pidAlive(h.pid) && h.pid !== process.pid) res.contention = `ran unlocked while pid ${h.pid} held the lock (${String((h.cur && (h.cur.cmd || h.cur.tool)) || "?").slice(0, 80)})`; }
    try {
      const n = Math.max(3, q.frames || 12), warm = q.warm != null ? q.warm : 4;
      if (op === "frames") {
        res.spots = {};
        for (const name of spotList(q)) {
          const sp = spots[name];
          await P.ev(place(sp)); await P.ev(`(function(){ var S = window.__speed; S.step(${warm}, { path: S.pin(${JSON.stringify(sp)}) }); return 1; })()`, 120000);
          res.spots[name] = compact(await measureFrames(B, P, n, `S.pin(${JSON.stringify(sp)})`, false));
        }
      } else if (op === "ab") {
        /* IN-PAGE A/B: the same live world, the toggle flipped between
           blocks (ABBA...), each block = settle frames + measured frames at
           the spot; pairs of adjacent blocks → the paired t verdict; then a
           frozen-time pixel check (dt = 0: the world stands still, so A and
           B differ only by the toggle). */
        if (!q.toggle) throw new Error("ab needs a toggle: JS that switches the candidate ON when `on` is true");
        const blk = Math.max(3, q.frames || 6), settle = q.settle != null ? q.settle : 2, minP = Math.max(2, q.minPairs || 3), maxP = Math.max(minP, q.maxPairs || 8);
        res.spots = {};
        for (const name of spotList(q)) {
          const sp = spots[name], pin = `S.pin(${JSON.stringify(sp)})`, A = [], Bv = [];
          await P.ev(place(sp)); await setToggle(q.toggle, false);
          await P.ev(`(function(){ var S = window.__speed; S.step(${warm}, { path: ${pin} }); return 1; })()`, 120000);
          let rows = [], pairs = 0;
          for (let i = 0; i < maxP; i++) {
            for (const on of (i % 2 === 0 ? [false, true] : [true, false])) {
              await setToggle(q.toggle, on);
              if (settle) await P.ev(`(function(){ var S = window.__speed; S.step(${settle}, { path: ${pin} }); return 1; })()`, 120000);
              const o = await measureFrames(B, P, blk, pin, false);
              const M = {}; const put = (k, x) => { if (x != null && isFinite(x)) M[k] = { v: x, unit: /calls|tris/.test(k) ? "n" : "ms" }; };
              put("frame", o.frame && o.frame.med); put("cpu", o.cpu && o.cpu.med); put("gpu", o.gpu && o.gpu.med); put("gpuMain", o.gMain && o.gMain.med); put("gpuShadow", o.gShadow && o.gShadow.med);
              put("gpuRt", o.gRt && o.gRt.med); put("sim", o.sim && o.sim.med); put("render", o.render && o.render.med); put("cpuThread", o.cpuThread); put("calls", o.calls && o.calls.med); put("tris", o.tris && o.tris.med);
              (on ? Bv : A).push(M);
            }
            pairs = i + 1;
            rows = abTable(A, Bv).map((r) => ({ ...r, headline: /^(frame|gpu|cpu)$/.test(r.k) }));
            if (pairs >= minP && rows.filter((r) => r.headline && r.verdict === "unsure").length === 0) break;
          }
          const sres = { pairs, rows };
          if (LOOK_PIX && q.look !== false) {
            const shots = { A: [], B: [] };
            for (const on of [false, true, false, true, false]) { await setToggle(q.toggle, on); shots[on ? "B" : "A"].push(await frozenShot(Math.max(2, settle + 1))); }
            const dir = q.lookDir || fs.mkdtempSync(path.join(os.tmpdir(), "cbz-speed-look-")); fs.mkdirSync(dir, { recursive: true });
            sres.look = lookSpot(name, shots.A, shots.B, dir);
          }
          await setToggle(q.toggle, q.leave === "on");
          res.spots[name] = sres;
        }
      } else throw new Error(`unknown op ${op} (frames, ab, eval, reload, info, stop)`);
    } finally { if (wantLock) releaseLock(); }
    res.ms = Date.now() - t0;
    return res;
  }
  const ctl = http.createServer((req, rsp) => {
    let body = ""; req.on("data", (d) => (body += d));
    req.on("end", () => {
      idleAt = Date.now();
      let q = {}; try { q = body ? JSON.parse(body) : {}; } catch (_) {}
      chain = chain.then(() => handle(q)).then((r) => { rsp.writeHead(200, { "Content-Type": "application/json" }); rsp.end(JSON.stringify(r)); },
        (e) => { rsp.writeHead(500, { "Content-Type": "application/json" }); rsp.end(JSON.stringify({ error: String(e && e.message || e) })); }).then(() => { idleAt = Date.now(); });
    });
  });
  ctl.requestTimeout = 0; ctl.headersTimeout = 0;
  await new Promise((r) => ctl.listen(0, "127.0.0.1", r));
  servers.push(ctl);
  fs.writeFileSync(WORLD_FILE, JSON.stringify({ pid: process.pid, port: ctl.address().port, root: ROOT, url: URL_ARG || null, commit, mode: m, started: new Date().toISOString(), boot: bootInfo }, null, 1));
  process.stdout.write(`READY ${WORLD_FILE} port ${ctl.address().port}\n`);
  const bye = () => { try { const w = JSON.parse(fs.readFileSync(WORLD_FILE, "utf8")); if (w.pid === process.pid) fs.unlinkSync(WORLD_FILE); } catch (_) {} };
  process.on("exit", bye);
  setInterval(() => { if (Date.now() - idleAt > IDLE_S * 1000) { log(`[speed] warm world idle ${IDLE_S}s: exiting`); cleanup(); bye(); process.exit(0); } }, 5000);
  await new Promise(() => {});
}

function post(port, q, timeoutMs) {
  return new Promise((res, rej) => {
    const body = JSON.stringify(q);
    const rq = http.request({ host: "127.0.0.1", port, method: "POST", path: "/", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: timeoutMs }, (r) => {
      let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => { try { const j = JSON.parse(d); r.statusCode === 200 ? res(j) : rej(new Error(j.error || d)); } catch (e) { rej(new Error(d || e.message)); } });
    });
    rq.on("error", rej); rq.on("timeout", () => rq.destroy(new Error("query timed out")));
    rq.end(body);
  });
}
async function askMain() {
  const t0 = Date.now();
  let w = readWorld();
  if (!w) {
    if (ASK === "stop" || ASK === "info") { console.log("no warm world for this tree"); process.exit(0); }
    // start one, detached, with the same serving flags
    const logf = WORLD_FILE.replace(/\.json$/, ".log");
    const pass = []; for (const f of ["--root", "--url", "--ref", "--seed", "--device", "--gpu", "--shaders", "--mode", "--modes", "--idle", "--world", "--query", "--slice", "--slice-spots", "--preload"]) { const v = opt(f, null); if (v != null) pass.push(f, v); }
    const fd = fs.openSync(logf, "a");
    const ch = spawn(process.execPath, [fileURLToPath(import.meta.url), "--serve", ...pass], { detached: true, stdio: ["ignore", fd, fd], cwd: ROOT0 });
    ch.unref();
    log(`[speed] no warm world for this tree: starting one (pid ${ch.pid}, log ${logf}); a boot is a full city load, once`);
    for (let i = 0; !w; i++) {
      await sleep(500); w = readWorld();
      if (!pidAlive(ch.pid)) { console.error("[speed] the warm world died while booting; see " + logf); process.exit(1); }
      if (i > 2400) { console.error("[speed] the warm world never became ready; see " + logf); process.exit(1); }
    }
    log(`[speed ${since()}] warm world ready (boot load ${w.boot && w.boot.load} ms)`);
  }
  const spotsArg = opt("--spot", opt("--spots", ""));
  const q = { op: ASK, spots: spotsArg ? spotsArg.split(",").map((s) => s.trim()).filter(Boolean) : null };
  if (has("--frames")) q.frames = +opt("--frames");
  if (has("--warm")) q.warm = +opt("--warm");
  if (has("--settle-frames")) q.settle = +opt("--settle-frames");
  if (has("--min-pairs")) q.minPairs = MIN_PAIRS;
  if (has("--pairs")) q.maxPairs = MAX_PAIRS;
  if (has("--no-reload")) q.reload = false;
  if (has("--no-lock")) q.lock = false;
  if (has("--lock")) q.lock = true;
  if (has("--no-look")) q.look = false;
  if (LOOK_DIR_ARG) q.lookDir = path.resolve(LOOK_DIR_ARG);
  if (has("--leave-on")) q.leave = "on";
  const tg = opt("--toggle", ""), tgf = opt("--toggle-file", "");
  if (tg || tgf) q.toggle = tgf ? fs.readFileSync(tgf, "utf8") : tg;
  if (ASK === "eval" && has("--allocs")) q.allocs = true;
  if (ASK === "eval" && has("--gc")) q.gc = true;
  // --allocs --live: only what the expression allocated and is STILL alive after it (a leak finder)
  if (ASK === "eval" && has("--live")) { q.allocs = true; q.liveOnly = true; q.timeoutS = 300; }
  if (ASK === "drive") { const r = opt("--route", "road"); q.route = r === "road" || r === "straight" ? r : r.split(";").map((p) => p.split(",").map(Number)); q.mps = +opt("--mps", 40); q.secs = +opt("--secs", 60); q.allocs = has("--allocs"); }
  if (ASK === "prof") { const f = opt("--eval-file", ""); q.expr = f ? fs.readFileSync(f, "utf8") : argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--ask" && !/^--(spot|spots|frames|warm|world|root|url|eval-file|toggle|toggle-file|look-dir|pairs|min-pairs|settle-frames|idle|seed|device|preload|query|slice|slice-spots|gpu|shaders|mode|modes|ref|mem-budget|route|mps|secs)$/.test(argv[i - 1] || "")).join(" "); }
  if (ASK === "eval") { const f = opt("--eval-file", ""); q.expr = f ? fs.readFileSync(f, "utf8") : argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--ask" && !/^--(spot|spots|frames|warm|world|root|url|eval-file|toggle|toggle-file|look-dir|pairs|min-pairs|settle-frames|idle|seed|device|preload|query|slice|slice-spots|gpu|shaders|mode|modes|ref|mem-budget|route|mps|secs)$/.test(argv[i - 1] || "")).join(" "); }
  let r;
  try { r = await post(w.port, q, 30 * 60 * 1000); } catch (e) { console.error("[speed] query failed: " + e.message); process.exit(1); }
  const O = (s) => process.stdout.write(s + "\n");
  if (has("--json-out") || ASK === "info" || ASK === "eval" || ASK === "prof" || ASK === "drive" || ASK === "stop") O(JSON.stringify(r, null, 1));
  if (r.reloaded) O(`reloaded (${r.reloaded.why}): load ${r.reloaded.load} ms = build ${r.reloaded.build} + first frame ${r.reloaded.firstFrame} + settle ${r.reloaded.settle}; CPU main ${r.reloaded.cpuMain} ms, GPU process ${r.reloaded.gpuProc} ms`);
  if (ASK === "frames") for (const [n, o] of Object.entries(r.spots || {}))
    O(`${n.padEnd(9)} frame ${fmt(o.frame)} ms (p95 ${fmt(o.p95)})  cpu ${fmt(o.cpu)} [sim ${fmt(o.sim)} always ${fmt(o.always)} render ${fmt(o.render)}]  gpu ${fmt(o.gpu)} [main ${fmt(o.gpuMain)} shadow ${fmt(o.gpuShadow)} rt ${fmt(o.gpuRt)}]  CPU/frame main ${fmt(o.cpuThread)} gpuProc ${fmt(o.gpuProcCpu)}  calls ${o.calls} tris ${((o.tris || 0) / 1e6).toFixed(2)}M\n` +
      `          passes: ${o.passes.map(([k, v]) => `${k.replace(/src\//, "")} ${fmt(v, 2)}`).join(" · ")}\n          updaters: ${o.updaters.map(([k, v]) => `${k.replace(/^([ua])@([0-9.]+) src\//, "$1$2 ")} ${fmt(v, 2)}`).join(" · ")}`);
  if (ASK === "ab") {
    let bad = false;
    for (const [n, s] of Object.entries(r.spots || {})) {
      O(`${n}: ${s.pairs} pair(s) of in-page blocks (toggle off = base, on = candidate)`);
      for (const x of s.rows.sort((a, b) => (b.headline - a.headline) || a.k.localeCompare(b.k)))
        O(`  ${x.headline ? "*" : " "} ${x.verdict.padEnd(7)} ${x.k.padEnd(10)} ${fmt(x.base, x.unit === "n" ? 0 : 2).padStart(10)} → ${fmt(x.cand, x.unit === "n" ? 0 : 2).padStart(10)}  ${(x.pct > 0 ? "+" : "") + fmt(x.pct, 1)}%  [${fmt(x.lo, 1)}%, ${fmt(x.hi, 1)}%]  ε ${fmt(x.eps, 1)}%`);
      if (s.look) O(`  look: ${s.look.verdict}  ${s.look.cand ? `changed ${fmt(100 * s.look.cand.changed, 2)}% vs re-render ${fmt(100 * s.look.floor.changed, 2)}%, SSIM ${fmt(s.look.cand.ssim, 4)} vs ${fmt(s.look.floor.ssim, 4)}` : s.look.why || ""}  ${s.look.png || ""}`);
      if (s.rows.some((x) => x.headline && x.verdict === "SLOWER") || (s.look && s.look.verdict === "LOOK REGRESSION")) bad = true;
    }
    if (bad) process.exitCode = 4;
  }
  if (r.contention) O(`note: ${r.contention}`);
  O(`[answered in ${((Date.now() - t0) / 1000).toFixed(1)} s; world ${r.ms != null ? (r.ms / 1000).toFixed(1) + " s" : "-"}${r.lockWaitS ? `, of which lock wait ${r.lockWaitS} s` : ""}]`);
  process.exit(process.exitCode || 0);
}

if (SERVE) await serveMain();
if (ASK) await askMain();

const LOCK_WAIT_S = await takeLock();
const uptimeStart = uptime();
let exitCode = 0;
try {
  let base = URL_ARG;
  if (!base) base = await serve(ROOT);
  B = await launchChrome();
  log(`[speed ${since()}] chrome up (${GPU} gpu, shaders ${SHADERS}${SERIAL ? ", serial frames" : ""}), serving ${URL_ARG || ROOT}  load ${uptimeStart.load1}`);
  let res;
  if (!AB) {
    const detail = {}, perRun = [];
    for (let run = 0; run < RUNS; run++) {
      const M = {};
      for (const m of MODES) {
        const t = Date.now();
        const r = await runMode(base, m, { grab: false });
        (detail[m] = detail[m] || []).push(r);
        Object.assign(M, flatten(r));
        log(`[speed ${since()}] run ${run + 1}/${RUNS} ${m}: ${r.ok ? `load ${fmt(r.loadMs, 0)} ms${r.buildMs != null ? ` (build ${fmt(r.buildMs, 0)}, first frame ${fmt(r.firstFrameMs, 0)})` : ""}` : "FAILED " + r.error}  [${((Date.now() - t) / 1000).toFixed(1)}s]`);
        if (!r.ok) exitCode = 1;
      }
      perRun.push(M);
    }
    res = resultShell({ runs: RUNS, uptimeStart, uptimeEnd: uptime(), toolWallS: +((Date.now() - TOOL_T0) / 1000).toFixed(1),
      look: lookOf(detail, "look"), census: lookOf(detail, "census"), metrics: aggregate(perRun), detail });
    process.stdout.write(table(res) + "\n");
    if (AGAINST_KIND === "file") {
      const base0 = JSON.parse(fs.readFileSync(AGAINST, "utf8"));
      const c = compare(res, base0);
      process.stdout.write(`\nCOMPARE vs ${AGAINST} (${base0.commit || base0.url}, v${base0.version || 1}, load avg ${base0.uptimeStart && base0.uptimeStart.load1}) — UNPAIRED; for a paired verdict use --against <ref>\n`);
      if (c.skippedModel) process.stdout.write(`  (skipped ${c.skippedModel} frame-model metrics: the file is v1 / a different frame model; re-save it with this tool)\n`);
      if (c.lowConf) process.stdout.write(`  LOW CONFIDENCE: ${c.lowConf} row(s) came from v1's noise rule (fewer than 4 runs a side); CPU ms normalised by machine speed x${Object.entries(c.factors).map(([m, f]) => m + " " + f.toFixed(3)).join(", ") || " (none)"}\n`);
      if (!c.rows.length) process.stdout.write("  no change beyond noise\n");
      for (const [k, a, b, d, thr, v, u] of c.rows.sort((x, y) => Math.abs(y[3]) / (y[1] || 1) - Math.abs(x[3]) / (x[1] || 1)).slice(0, 40))
        process.stdout.write(`  ${v.padEnd(7)} ${k.padEnd(58)} ${fmt(a, u === "n" ? 0 : 1).padStart(9)} → ${fmt(b, u === "n" ? 0 : 1).padStart(9)}  (${d > 0 ? "+" : ""}${fmt(d, 1)}, ${fmt(100 * d / (a || 1), 0)}%, thr ${fmt(thr, 1)})\n`);
      if (c.lookBad.length) process.stdout.write("  LOOK REGRESSION (settings dropped; any speedup here is NOT a win):\n" + c.lookBad.map((s) => "    " + s).join("\n") + "\n");
      if (c.lookNotes.length) process.stdout.write("  look notes (counts, not failures): " + c.lookNotes.join(" · ") + "\n");
      res.compare = { against: AGAINST, rows: c.rows, lookRegression: c.lookBad, lookNotes: c.lookNotes, lowConfidence: c.lowConf, skippedFrameModel: c.skippedModel };
      if (c.regress || c.lookBad.length) exitCode = exitCode || 4;
    }
  } else {
    /* ---- the paired A/B ---- */
    let baseUrl = AGAINST, baseLabel = AGAINST;
    if (AGAINST_KIND === "ref") { const a = archiveRef(AGAINST); baseUrl = await serve(a.dir); baseLabel = a.label; }
    const sides = { base: { url: baseUrl, label: baseLabel, runs: [], detail: {}, shots: {} }, cand: { url: base, label: commit || URL_ARG, runs: [], detail: {}, shots: {} } };
    const lookDir = LOOK_DIR_ARG ? path.resolve(LOOK_DIR_ARG) : fs.mkdtempSync(path.join(os.tmpdir(), "cbz-speed-look-"));
    fs.mkdirSync(lookDir, { recursive: true });
    log(`[speed ${since()}] A/B  base ${baseLabel}  vs  candidate ${sides.cand.label}; ${MIN_PAIRS}..${MAX_PAIRS} pairs, interleaved ABBA`);
    const spotsFixed = {};
    let rows = [], pairs = 0, stopWhy = `pair budget (${MAX_PAIRS}) spent`;
    for (let i = 0; i < MAX_PAIRS; i++) {
      const order = i % 2 === 0 ? ["base", "cand"] : ["cand", "base"];
      for (const who of order) {
        const S = sides[who], M = {};
        for (const m of MODES) {
          const t = Date.now();
          const r = await runMode(S.url, m, { spots: spotsFixed[m], grab: LOOK_PIX });
          if (!spotsFixed[m] && r.play && r.play.spotsAt) spotsFixed[m] = r.play.spotsAt;
          takeShots(r, S.shots);
          (S.detail[m] = S.detail[m] || []).push(r);
          Object.assign(M, flatten(r));
          log(`[speed ${since()}] pair ${i + 1} ${who.padEnd(4)} ${m}: ${r.ok ? `load ${fmt(r.loadMs, 0)} ms` : "FAILED " + r.error}${r.play && r.play.spots.spawn ? `, spawn frame ${fmt(r.play.spots.spawn.frame && r.play.spots.spawn.frame.med)} ms` : ""}  [${((Date.now() - t) / 1000).toFixed(1)}s]`);
          if (!r.ok) exitCode = 1;
        }
        S.runs.push(M);
      }
      pairs = i + 1;
      rows = abTable(sides.base.runs, sides.cand.runs);
      const heads = rows.filter((r) => r.headline), open = heads.filter((r) => r.verdict === "unsure");
      log(`[speed ${since()}] after ${pairs} pair(s): ${heads.length - open.length}/${heads.length} headline metrics decided${open.length ? " (open: " + open.slice(0, 4).map((r) => r.k).join(", ") + (open.length > 4 ? ", ..." : "") + ")" : ""}`);
      if (pairs >= MIN_PAIRS && !open.length) { stopWhy = "every headline metric decided"; break; }
    }
    /* the pixel look guard, per spot */
    const look = [];
    for (const k of Object.keys(sides.cand.shots)) look.push(lookSpot(k.replace("/", "-"), sides.base.shots[k] || [], sides.cand.shots[k], lookDir));
    const settings = lookSettings(lookOf(sides.cand.detail, "look"), lookOf(sides.base.detail, "look"), lookOf(sides.cand.detail, "census"), lookOf(sides.base.detail, "census"));
    res = resultShell({ runs: pairs, uptimeStart, uptimeEnd: uptime(), toolWallS: +((Date.now() - TOOL_T0) / 1000).toFixed(1),
      look: lookOf(sides.cand.detail, "look"), census: lookOf(sides.cand.detail, "census"), metrics: aggregate(sides.cand.runs), detail: sides.cand.detail,
      base: { label: baseLabel, url: AGAINST_KIND === "url" ? AGAINST : null, metrics: aggregate(sides.base.runs), look: lookOf(sides.base.detail, "look"), census: lookOf(sides.base.detail, "census") } });
    process.stdout.write(table(res) + "\n");
    const slower = rows.filter((r) => r.headline && (r.verdict === "SLOWER" || r.verdict === "MORE"));
    const lookBad = look.filter((l) => l.verdict === "LOOK REGRESSION");
    const O = (s) => process.stdout.write(s + "\n");
    O(`\nA/B  base ${baseLabel}  vs  candidate ${sides.cand.label}  —  ${pairs} pair(s), interleaved, same lock window (${stopWhy}); shaders ${SHADERS}`);
    O(`  pair = log(candidate / base) of adjacent runs; CHANGED = 99% t-interval excludes 0 and |Δ| > ε; same = 90% interval inside ±ε`);
    const line = (r) => `  ${(r.headline ? "* " : "  ")}${r.verdict.padEnd(7)} ${r.k.padEnd(52)} ${fmt(r.base, r.unit === "n" ? 0 : 1).padStart(9)} → ${fmt(r.cand, r.unit === "n" ? 0 : 1).padStart(9)}  ${(r.pct > 0 ? "+" : "") + fmt(r.pct, 1)}%  [${r.lo == null ? "-" : fmt(r.lo, 1)}%, ${r.hi == null ? "-" : fmt(r.hi, 1)}%]  ε ${fmt(r.eps, 1)}%`;
    const heads = rows.filter((r) => r.headline).sort((a, b) => a.k.localeCompare(b.k));
    O(`  HEADLINE (* decides the verdict and the exit code):`);
    heads.forEach((r) => O(line(r)));
    const other = rows.filter((r) => !r.headline && (r.verdict === "SLOWER" || r.verdict === "faster" || r.verdict === "MORE" || r.verdict === "fewer"))
      .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 30);
    if (other.length) { O(`  OTHER CHANGES (diagnostic, not a verdict):`); other.forEach((r) => O(line(r))); }
    O(`  LOOK (pixels, block SSIM at the game's HD settings; changed = share of the stable picture with SSIM < ${BAD_SSIM}):`);
    for (const l of look) O(`    ${l.verdict.padEnd(15)} ${l.spot.padEnd(16)} ${l.cand ? `candidate changed ${fmt(100 * l.cand.changed, 2)}% vs a base re-run ${fmt(100 * l.floor.changed, 2)}%, SSIM ${fmt(l.cand.ssim, 4)} vs ${fmt(l.floor.ssim, 4)} (stable area ${fmt(100 * l.stableArea, 0)}%${l.floorBiased ? ", floor from 2 base shots: biased low" : ""})` : l.why || ""}${l.png ? "  " + l.png : ""}`);
    if (!look.length) O(`    (no pixel shots${LOOK_PIX ? "" : ": --no-look"})`);
    if (settings.bad.length) O("  LOOK REGRESSION (settings dropped): " + settings.bad.join(" · "));
    if (settings.notes.length) O("  look notes (counts, not failures): " + settings.notes.join(" · "));
    const faster = heads.filter((r) => r.verdict === "faster"), same = heads.filter((r) => r.verdict === "same"), unsure = heads.filter((r) => r.verdict === "unsure");
    const lookFail = lookBad.length || settings.bad.length;
    O(`\nVERDICT: ${slower.length ? `SLOWER (${slower.map((r) => r.k).join(", ")})` : faster.length ? `faster (${faster.map((r) => `${r.k} ${fmt(r.pct, 1)}%`).join(", ")})` : unsure.length ? "no detectable difference" : "same"}` +
      `${!slower.length && faster.length && unsure.length ? `; ${unsure.length} other headline metric(s) undecided` : ""}${!slower.length && !faster.length ? ` (${same.length} same, ${unsure.length} within noise)` : ""}` +
      `${lookFail ? "  +  LOOK REGRESSION: NOT A WIN" : "  ·  look unchanged"}`);
    res.ab = { against: AGAINST, kind: AGAINST_KIND, base: baseLabel, candidate: sides.cand.label, pairs, stop: stopWhy, minPairs: MIN_PAIRS, maxPairs: MAX_PAIRS, rows, look, lookSettings: settings, lookDir };
    // v1-shaped compare block, for scripts that read it
    res.compare = { against: AGAINST, rows: rows.filter((r) => /SLOWER|faster|MORE|fewer/.test(r.verdict)).map((r) => [r.k, r.base, r.cand, r.cand - r.base, r.eps, r.verdict === "MORE" ? "SLOWER" : r.verdict === "fewer" ? "faster" : r.verdict, r.unit]),
      lookRegression: [...settings.bad, ...lookBad.map((l) => `${l.spot}: pixels changed ${fmt(100 * l.cand.changed, 2)}% vs ${fmt(100 * l.floor.changed, 2)}% on a re-run`)] };
    if (slower.length || lookFail) exitCode = exitCode || 4;
  }
  const json = JSON.stringify(res, null, 1);
  if (SAVE) {
    // the committed baseline keeps metrics + look + census + run 1's detail (no per-frame series)
    const slim = { ...res, detail: Object.fromEntries(Object.entries(res.detail).map(([m, rs]) => {
      const r = JSON.parse(JSON.stringify(rs[0] || {}));
      if (r.play) for (const o of Object.values(r.play.spots)) { delete o.series; if (o.updaters) o.updaters = o.updaters.slice(0, 20); }
      if (r.scripts) r.scripts.byDir = undefined;
      return [m, [r]]; })) };
    fs.writeFileSync(SAVE, JSON.stringify(slim, null, 1)); log(`[speed] saved ${SAVE}`);
  }
  if (JSON_OUT) { fs.writeFileSync(JSON_OUT, json); log(`[speed] wrote ${JSON_OUT}`); }
  if (!SAVE && !JSON_OUT) { const f = path.join(os.tmpdir(), `cbz-speed-${Date.now()}.json`); fs.writeFileSync(f, json); log(`[speed] full JSON: ${f}`); }
  log(`[speed] done in ${((Date.now() - TOOL_T0) / 1000).toFixed(1)}s`);
} catch (e) {
  console.error("[speed] FAILED:", e.stack || e);
  exitCode = 1;
} finally {
  cleanup();
}
process.exit(exitCode);
