#!/usr/bin/env node
/* tools/shot/daemon.mjs — THE CAPTURE SERVICE. A pool of 2-4 warm headless
   Chromes, each holding warm, frozen game pages, taking everybody's shot
   requests off one queue. req.mjs starts it; a lockfile keeps it to one per
   machine; it exits after SHOT_IDLE_MIN (20) idle minutes.

     node tools/shot/daemon.mjs           start (no-op if one is running)
     node tools/shot/daemon.mjs --stop    stop it (closes its Chromes)

   Built on the testbus, not beside it: the same Chrome launcher and CDP page
   handle (tools/testbus/browser.mjs, every call with a deadline), the same
   world table and boot (tools/testbus/worlds.mjs), the same object-store merge
   (tools/testbus/tree.mjs), the same directory. The testbus batcher BORROWS a
   Chrome from this pool when the service is up (status.json lists them), so
   the machine runs one browser pool, not two.

   WHY IT IS FAST
   - No checkouts. Pages are served straight out of .git (tools/shot/gitserve.mjs):
     any commit, any number of them, zero disk churn.
   - One boot serves many branches. A request whose commit differs from a warm
     page only in files the page never loaded reuses it as is (warm); one whose
     loaded changes are all HOT-SAFE (the bestiary's species files, which only
     call CBZ.defineSpecies, or any file marked `testbus:hot-safe`) is
     hot-swapped in (the page pulls /@<sha>/<file>, restages, shoots, swaps the
     base file back). Only a branch that changes the engine itself boots its
     own page, and that page stays warm for its next request.
   - Frozen worlds: rAF is off, time moves only through __battle.advance or the
     puppet walk, so every frame is a stated moment, and an idle warm page costs
     nothing.
   - Small frames (640x400) by default; a contact sheet composed by canvas in
     the same Chrome.

   LOAD SAFETY: no new Chrome/boot while load > SHOT_MAX_LOAD_PER_CORE x cores
   (held, max 5 min); a second/third Chrome only while load < SHOT_GROW x cores;
   a per-agent fairness queue (round robin, SHOT_PER_AGENT in flight); every
   page call has a deadline and a whole request has SHOT_JOB_MS, after which
   its page is closed (a wedged page cannot hang the service). */
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { SHOT, SD, LOCK, STATUS, CFG, CORES, NPCWAR_BASE_QUERY,
  readJson, writeJson, pidAlive, now, sleep, load1, resultPath, daemonInfo } from "./lib.mjs";
import { launchChrome } from "../testbus/browser.mjs";
import { WORLDS, bootWorld } from "../testbus/worlds.mjs";
import { mainRepo } from "../testbus/lib.mjs";
import { serveCommit } from "./gitserve.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 23)}] ` + a.join(" "));
const REPO = mainRepo(HERE);

// ------------------------------------------------------------------ lifecycle
if (argv.includes("--stop")) {
  const L = daemonInfo();
  if (!L) { console.log("shot: no daemon running"); process.exit(0); }
  process.kill(L.pid, "SIGTERM");
  for (let i = 0; i < 50 && pidAlive(L.pid); i++) await sleep(200);
  console.log("shot: stopped daemon " + L.pid);
  process.exit(0);
}
function takeLock() {
  for (let i = 0; i < 2; i++) {
    try { writeFileSync(LOCK, JSON.stringify({ pid: process.pid, started: now(), code: import.meta.url }), { flag: "wx" }); return true; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      const L = readJson(LOCK);
      if (L && pidAlive(L.pid) && L.pid !== process.pid) return false;
      try { unlinkSync(LOCK); } catch (_) {}
    }
  }
  return false;
}
if (!takeLock()) { console.log("shot: daemon already running (pid " + (daemonInfo() || {}).pid + ")"); process.exit(0); }

const chromes = [];          // { n, B, pages: [], busy, sheet, launching }
let shuttingDown = false;
async function shutdown(code = 0) {
  shuttingDown = true;
  for (const c of chromes) {
    for (const p of c.pages) { try { p.srv.close(); } catch (_) {} }
    try { await c.B.close(); } catch (_) {}
  }
  try { const L = readJson(LOCK); if (L && L.pid === process.pid) unlinkSync(LOCK); } catch (_) {}
  writeJson(STATUS, { pid: null, stopped: now() });
  process.exit(code);
}
for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => { log("signal " + s); shutdown(0); });
process.on("uncaughtException", (e) => log("UNCAUGHT " + (e && e.stack || e)));
process.on("unhandledRejection", (e) => log("UNHANDLED " + (e && e.stack || e)));

// ---------------------------------------------------------------- git helpers
const diffCache = new Map();
function changed(a, b) {
  if (a === b) return [];
  const k = a + ".." + b;
  if (diffCache.has(k)) return diffCache.get(k);
  let out = null;
  try { out = execFileSync("git", ["diff", "--name-only", a, b], { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean); } catch (_) {}
  diffCache.set(k, out);
  if (diffCache.size > 2000) diffCache.delete(diffCache.keys().next().value);
  return out;
}
let mainSha = null, mainAt = 0;
function originMain() {
  if (mainSha && Date.now() - mainAt < 60e3) return mainSha;
  try { execFileSync("git", ["fetch", "-q", "origin", "main"], { cwd: REPO, stdio: "ignore", timeout: 20e3 }); } catch (_) {}
  try { mainSha = execFileSync("git", ["rev-parse", "origin/main"], { cwd: REPO, encoding: "utf8" }).trim(); mainAt = Date.now(); } catch (_) {}
  return mainSha;
}
/* HOT-SAFE: a file that only (re)defines things, so loading it again into a
   live page swaps it cleanly. The bestiary's species files are (each is one
   CBZ.defineSpecies per animal, last write wins); anything else opts in with
   the testbus marker. wildlife_orca.js is NOT (it stands up its own fight). */
const hotCache = new Map();
/* THE UNIT FILES (docs/npcwar/ARCHITECTURE.md): src/units/species|vehicles/<id>.js
   only call CBZ.unitKit.register (last write wins) and the kit files only
   (re)define their namespace. A page loads unit files LAZILY (a roster asks
   for them), so a changed one is swapped in even when the page never loaded
   it: that is the 1-2 s glance an animal or vehicle agent gets. */
const UNIT_FILE = /^src\/units\/(species|vehicles|kit)\/[^/]+\.js$/;
function hotSafe(commit, f) {
  if (/^src\/city\/wildlife\/[^/]+\.js$/.test(f)) return true;
  if (UNIT_FILE.test(f)) return true;
  if (!f.endsWith(".js")) return false;
  const k = commit + ":" + f;
  if (hotCache.has(k)) return hotCache.get(k);
  let ok = false;
  try { ok = /testbus:hot-safe/.test(execFileSync("git", ["show", `${commit}:${f}`], { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20 }).slice(0, 4000)); } catch (_) {}
  hotCache.set(k, ok);
  return ok;
}

// ------------------------------------------------------------------- the pool
const knownLoaded = new Map();      // world key -> files an npcwar page loads (learned on first boot)
async function loadGate(what, perCore) {
  const lim = CORES * (perCore || CFG.maxLoadPerCore), t0 = Date.now();
  while (load1() > lim && Date.now() - t0 < 5 * 60e3) { log(`load ${load1().toFixed(1)} > ${lim}: holding ${what}`); await sleep(5000); }
  return Date.now() - t0;
}
/* lightOnly: the backlog is all lab requests (a kit boots in ~0.1-0.5 s of
   CPU): the first Chrome for them waits only above SHOT_LAB_LOAD_PER_CORE
   (8) x cores, so a lab glance is not held for minutes behind a gate sized
   for the city */
async function addChrome(lightOnly) {
  const c = { n: chromes.length, B: null, pages: [], busy: false, sheet: null, launching: true };
  chromes.push(c);
  try {
    await loadGate("a Chrome launch", lightOnly ? CFG.labLoadPerCore : 0);
    c.B = await launchChrome();
    c.launching = false;
    log(`chrome #${c.n} up in ${c.B.startMs} ms (pid ${c.B.pid}, :${c.B.dbg})`);
  } catch (e) { chromes.splice(chromes.indexOf(c), 1); log("chrome launch failed: " + e.message); return null; }
  writeStatus();
  return c;
}
/* THE SHEET'S OWN DOOR. Frames go to the sheet page by URL and the sheet comes
   back by POST, never through a CDP message: a fight-map PNG is ~1 MB and a
   dozen of them in one Runtime.evaluate (and a 6 MB dataURL back) closed the
   DevTools socket ("page went away", measured on the matchup preset). The
   page lives on this server's origin so its canvas is never tainted. Only
   paths this daemon wrote (or is about to write) are reachable. */
const servable = new Set();
let FS = null;
async function fileServer() {
  if (FS) return FS;
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"), p = u.searchParams.get("p");
    if (u.pathname === "/") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<!doctype html><title>sheet</title>"); }
    if (!p || !servable.has(p)) { res.writeHead(403); return res.end(); }
    if (u.pathname === "/f" && req.method === "GET") {
      try { const b = readFileSync(p); res.writeHead(200, { "Content-Type": p.endsWith(".jpg") ? "image/jpeg" : "image/png", "Cache-Control": "no-store" }); return res.end(b); }
      catch (_) { res.writeHead(404); return res.end(); }
    }
    if (u.pathname === "/put" && req.method === "POST") {
      const parts = [];
      req.on("data", (d) => parts.push(d));
      req.on("end", () => { try { writeFileSync(p, Buffer.concat(parts)); res.writeHead(200); res.end("ok"); } catch (e) { res.writeHead(500); res.end(String(e.message)); } });
      return;
    }
    res.writeHead(404); res.end();
  });
  for (let t = 0; t < 40 && !FS; t++) {
    const port = 49200 + Math.floor(Math.random() * 700);
    const ok = await new Promise((r) => { srv.once("error", () => r(false)); srv.listen(port, "127.0.0.1", () => r(true)); });
    if (ok) FS = { origin: `http://127.0.0.1:${port}/` };
  }
  if (!FS) throw new Error("shot: no port for the sheet server");
  return FS;
}
async function sheetPage(c) {
  if (c.sheet && !c.sheet.closed) return c.sheet;
  const F = await fileServer();
  c.sheet = await c.B.newPage();
  await c.sheet.send("Page.navigate", { url: F.origin }, 10e3);
  for (let i = 0; i < 50; i++) { if (await c.sheet.evl("document.readyState==='complete'", 5e3).catch(() => false)) break; await sleep(100); }
  await c.sheet.evl(readFileSync(path.join(HERE, "page/sheet.js"), "utf8"), 10e3);
  return c.sheet;
}
async function closePage(c, p) {
  try { await p.pg.closeTarget(); } catch (_) {}
  try { p.srv.close(); } catch (_) {}
  const i = c.pages.indexOf(p); if (i >= 0) c.pages.splice(i, 1);
}
import { createHash } from "node:crypto";
/* the in-page half, stamped with its content hash: injected before every job
   (a no-op when the page already has this version), so editing
   tools/shot/page/*.js takes effect on the next request without a reboot */
const pageLib = (world) => {
  const src = readFileSync(path.join(HERE, "page", world + ".js"), "utf8");
  return src.replace('var V = "dev";', `var V = "${createHash("sha1").update(src).digest("hex").slice(0, 12)}";`);
};

/* a page for (world, query) able to show `commit`: warm | hot | boot */
async function acquire(c, world, query, commit, T) {
  const wk = world + "|" + query;
  let best = null, bestHow = null, bestSwap = null;
  for (const p of c.pages) {
    if (p.wk !== wk || p.pg.closed || p.dirty) continue;
    const ch = changed(p.commit, commit);
    if (ch == null) continue;
    const rel = ch.filter((f) => p.loaded.has(f) || UNIT_FILE.test(f));
    if (!rel.length) { best = p; bestHow = "warm"; bestSwap = []; break; }
    if (rel.every((f) => hotSafe(commit, f)) && (!best || bestHow !== "warm")) { best = p; bestHow = "hot"; bestSwap = rel; }
  }
  if (best) {
    best.lastUsed = Date.now();
    if (bestSwap.length) {
      const t0 = Date.now();
      await injectFiles(best, commit, bestSwap);
      best.swapped = bestSwap;
      T.hotMs = Date.now() - t0;
    }
    return { p: best, how: bestHow };
  }
  // boot one. Boot it at origin/main when the request is hot-reachable from
  // there, so the page serves everybody afterwards, not just this branch.
  let base = commit;
  const main = originMain(), known = knownLoaded.get(wk);
  let swap = [];
  if (main && known && main !== commit) {
    const ch = changed(main, commit);
    const rel = ch ? ch.filter((f) => known.has(f) || UNIT_FILE.test(f)) : null;
    if (rel && rel.every((f) => hotSafe(commit, f))) { base = main; swap = rel; }
  }
  while (c.pages.length >= CFG.pagesPerChrome) {
    const idle = c.pages.slice().sort((a, b) => a.lastUsed - b.lastUsed)[0];
    await closePage(c, idle);
  }
  // a lab boot is ~0.1-0.5 s of CPU (a kit's few dozen scripts, no world):
  // holding it for minutes behind a load gate built for the city costs more
  // than it saves, so only the heavy worlds wait
  if (world !== "lab") T.loadWaitMs = (T.loadWaitMs || 0) + await loadGate("a world boot");
  const t0 = Date.now();
  const srv = await serveCommit(REPO, base);
  const pg = await c.B.newPage();
  const p = { wk, world, query, commit: base, srv, pg, loaded: new Set(), dirty: false, swapped: null, lastUsed: Date.now() };
  c.pages.push(p); c.cur = p;
  try {
    const W = WORLDS[world];
    const seed = new URLSearchParams(query).get("seed") || W.seed;
    const b = await bootWorld(pg, srv.origin, `${world}|${seed}|${query}`, W.bootMs || (world === "npcwar" ? CFG.bootMs : 10 * 60e3));
    p.loaded = new Set(b.loaded);
    knownLoaded.set(wk, p.loaded);
    const ok = await pg.evl(pageLib(libOf(world)), 20e3);
    if (ok !== true) throw new Error("page/" + world + ".js did not install (" + ok + ")");
    if (libOf(world) === "world") await pg.evl("__shot.warm()", 10 * 60e3);   // shader compile, once, inside the boot
  } catch (e) { await closePage(c, p); throw e; }
  T.bootMs = Date.now() - t0;
  log(`  chrome #${c.n}: booted ${wk} @${base.slice(0, 8)} in ${(T.bootMs / 1000).toFixed(1)} s`);
  if (swap.length) { const t1 = Date.now(); await injectFiles(p, commit, swap); p.swapped = swap; T.hotMs = Date.now() - t1; return { p, how: "boot+hot" }; }
  return { p, how: "boot" };
}
async function injectFiles(p, commit, files) {
  const ok = await p.pg.evl(`(function(files){var i=0;return new Promise(function(done){(function next(){if(i>=files.length)return done(true);var s=document.createElement('script');s.src='/@${commit}/'+files[i++];s.onload=next;s.onerror=function(){done('failed '+s.src)};document.head.appendChild(s);})();});})(${JSON.stringify(files)})`, CFG.evalMs);
  if (ok !== true) throw new Error("hot swap: " + ok);
}
async function unswap(p) {
  if (!p.swapped || !p.swapped.length || p.pg.closed) return;
  try { await injectFiles(p, p.commit, p.swapped); p.swapped = null; }
  catch (e) { p.dirty = true; }
}

// ------------------------------------------------------------------ the work
function expandTimes(times, period) {
  const out = [];
  for (const t of times) {
    const m = /^cycle:(\d+)$/.exec(String(t));
    if (m) { const n = Math.max(1, Math.min(24, +m[1])); for (let k = 0; k < n; k++) out.push(+(k * period / n).toFixed(4)); }
    else out.push(+t || 0);
  }
  return out;
}
/* which in-page half drives a world: NPC War has its own; every CBZ world
   (city, president, escape, survival and their aliases) shares page/world.js */
const libOf = (world) => (world === "npcwar" ? "npcwar" : world === "lab" ? "lab" : "world");
// the light worlds: seconds, not minutes (NPC War, the lab)
const lightWorld = (world) => world === "npcwar" || world === "lab";
async function worldSide(c, req, side, T, warns) {
  // a CBZ world's main thread is busy streaming even while frozen: give its calls room
  const ms = lightWorld(req.world) ? CFG.evalMs : CFG.evalMs * 4;
  if (!WORLDS[req.world]) throw new Error(`unknown world "${req.world}" (know: ${Object.keys(WORLDS).join(", ")})`);
  let { p, how } = await acquire(c, req.world, req.query, side.commit, T);
  side.how = how; c.cur = p;
  if ((await p.pg.evl(pageLib(libOf(req.world)), ms)) !== true) throw new Error(`page/${libOf(req.world)}.js did not install`);
  const frames = [];
  try {
    for (const pose of req.poses) {
      const spec = { ...req.stage, pose, js: req.js || undefined };
      // a CBZ world that will be stepped is changed for good: it is nobody else's afterwards
      if (req.world !== "npcwar" && expandTimes(req.times, 1).some((t) => t > 0)) p.dirty = true;
      let st = await p.pg.evl(`__shot.stage(${JSON.stringify(spec)})`, ms);
      if (!st || !st.ok) throw new Error((st && st.error) || "stage failed");
      for (const w of st.warn || []) warns.add(w);
      const times = expandTimes(req.times, st.period || 1);
      for (const t of times) {
        await p.pg.evl(`__shot.at(${t})`, ms).catch((e) => { throw new Error(`at(${t}) [${pose}]: ${e.message}`); });
        for (const cam of req.cams) {
          const r = await p.pg.evl(`__shot.shot(${JSON.stringify(cam)}, ${req.W}, ${req.H}, ${JSON.stringify(req.mime)})`, ms)
            .catch((e) => { throw new Error(`shot(${cam}) t=${t} [${pose}]: ${e.message}; page errors: ${p.pg.errors.slice(-3).join(" | ")}`); });
          frames.push({ pose, t, cam, url: r && r.url, error: r && r.error });
          if (r && r.error) warns.add(r.error);
          if (r && r.info) warns.add("info " + pose + " t=" + t + " " + cam + ": " + r.info);
        }
      }
    }
    // the lab answers with numbers too: the kit's probe at the end of the run
    if (req.world === "lab") side.probe = await p.pg.evl("__shot.probe()", ms).catch((e) => ({ ok: false, summary: "probe failed: " + e.message }));
    await p.pg.evl("__shot.clear()", ms).catch(() => {});
    if (req.js) p.dirty = true;          // arbitrary JS: nobody else gets this page
  } finally {
    await unswap(p);
    if (p.dirty || p.pg.closed) await closePage(c, p);
  }
  return frames;
}
function decode(url) /* a dataURL's bytes */ { return Buffer.from(String(url).split(",")[1] || "", "base64"); }
const fname = (side, f, ext) => `${side ? side + "-" : ""}${f.pose}-t${String(f.t).replace(".", "_")}-${f.cam.replace(/[^\w]+/g, "_")}.${ext}`;

async function runJob(c, req) {
  const T = { queuedMs: Date.now() - req.submittedMs };
  const t0 = Date.now();
  const res = { ...(readJson(resultPath(req.id)) || {}), id: req.id, status: "running", started: now(), chrome: c.n };
  writeJson(resultPath(req.id), res);
  const warns = new Set();
  const out = req.out; mkdirSync(out, { recursive: true });
  const ext = req.mime === "image/jpeg" ? "jpg" : "png";
  const sides = [];
  for (const s of req.sides) {
    const frames = await worldSide(c, req, s, T, warns);
    sides.push({ ...s, frames });
  }
  T.captureMs = Date.now() - t0 - (T.bootMs || 0);
  // files
  const files = [];
  for (const s of sides) for (const f of s.frames) {
    if (!f.url) continue;
    const fp = path.join(out, fname(req.sides.length > 1 ? s.label : "", f, ext));
    writeFileSync(fp, decode(f.url)); files.push(fp);
    f.file = fp; f.url = null; servable.add(fp);
  }
  // the contact sheet: rows of poses/times, columns of cams (or times for one cam)
  const n0 = sides[0].frames.length;
  const cols = req.cams.length > 1 ? req.cams.length : Math.min(8, Math.max(1, Math.round(n0 / req.poses.length)));
  const tileW = Math.min(req.W, Math.floor(2400 / cols)), tileH = Math.round(tileW * req.H / req.W);
  const F = await fileServer();
  const src = (f) => (f && f.file ? `${F.origin}f?p=${encodeURIComponent(f.file)}` : null);
  const lab = (s, f) => `${sides.length > 1 ? s.label.toUpperCase() + "  " : ""}${f.pose}${req.times.length > 1 || f.t ? " t=" + f.t : ""}  ${f.cam}`;
  const tiles = [];
  if (sides.length === 1) for (const f of sides[0].frames) tiles.push({ url: src(f), label: lab(sides[0], f), sub: f.error });
  else {
    // before/after: each row of the single layout, then the same row after
    for (let r = 0; r < n0; r += cols) for (const s of sides) for (let k = r; k < Math.min(n0, r + cols); k++) {
      const f = s.frames[k] || {};
      tiles.push({ url: src(f), label: lab(s, f), sub: f.error, tint: s.label === "after" ? "#1d3f6b" : "#3a3c42" });
    }
  }
  const title = `${req.world}  ${Object.entries(req.stage).map(([k, v]) => k + "=" + v).join(" ")}${req.query && req.query !== NPCWAR_BASE_QUERY ? "  [" + req.query + "]" : ""}  ` +
    sides.map((s) => `${s.label}: ${s.branch}@${s.commit.slice(0, 8)} (${s.how})`).join("  |  ");
  const sp = await sheetPage(c);
  const sheet = path.join(out, sides.length > 1 ? "ba.png" : "sheet.png");
  servable.add(sheet);
  const put = `${F.origin}put?p=${encodeURIComponent(sheet)}`;
  const ok = await sp.evl(`__sheet(${JSON.stringify({ title, cols, tileW, tileH, tiles, fmt: "image/png", put })})`, CFG.evalMs);
  if (ok !== true) warns.add("contact sheet failed: " + ok);
  for (const f of files) servable.delete(f);
  servable.delete(sheet);
  T.totalMs = Date.now() - req.submittedMs; T.workMs = Date.now() - t0;
  Object.assign(res, {
    status: sides.every((s) => s.frames.some((f) => f.file)) ? "done" : "error",
    finished: now(), sheet, frames: files, out, warn: [...warns].slice(0, 12), timings: T,
    sides: sides.map((s) => ({ label: s.label, branch: s.branch, commit: s.commit, how: s.how, frames: s.frames.length, probe: s.probe || undefined })),
  });
  if (req.world === "lab") res.probe = sides[sides.length - 1].probe || null;
  if (res.status === "error") res.error = "no frames rendered: " + [...warns].slice(0, 3).join(" | ");
  writeJson(resultPath(req.id), res);
  log(`  ${req.id} ${res.status} in ${(T.workMs / 1000).toFixed(1)} s (queued ${(T.queuedMs / 1000).toFixed(1)} s) ${sides.map((s) => s.how).join("/")} -> ${sheet}`);
}

// ----------------------------------------------------------------- scheduler
const running = new Map();       // id -> agent
const lastServed = new Map();    // agent -> ms
function pending() {
  const out = [];
  for (const f of readdirSync(SD.queue)) {
    if (!f.endsWith(".json")) continue;
    const q = readJson(path.join(SD.queue, f));
    if (q && q.id) out.push(q);
  }
  return out.sort((a, b) => a.submittedMs - b.submittedMs);
}
/* fair pick: agents in order of who was served longest ago; within an agent,
   oldest first; among the first few fair candidates prefer one this Chrome
   already has a warm page for (a warm page is ~0 s, a boot is ~10-40 s). */
function pick(c, Q) {
  const inflight = (a) => [...running.values()].filter((x) => x === a).length;
  const byAgent = new Map();
  for (const q of Q) { if (inflight(q.agent) >= CFG.perAgent) continue; if (!byAgent.has(q.agent)) byAgent.set(q.agent, q); }
  const fair = [...byAgent.values()].sort((a, b) => (lastServed.get(a.agent) || 0) - (lastServed.get(b.agent) || 0) || a.submittedMs - b.submittedMs);
  if (!fair.length) return null;
  const warmFor = (q) => c.pages.some((p) => p.wk === `${q.world}|${q.query}` && !p.dirty && !p.pg.closed);
  return fair.slice(0, 3).find(warmFor) || fair[0];
}
function claim(q) {
  try { rmSync(path.join(SD.queue, q.id + ".json")); return true; } catch (_) { return false; }
}
let lastWork = Date.now();
async function work(c, q) {
  c.busy = true; running.set(q.id, q.agent); lastServed.set(q.agent, Date.now()); lastWork = Date.now();
  writeStatus();
  let timer;
  // a CBZ world's cold boot alone can take minutes on a loaded Mac: its budget includes one
  const jobMs = lightWorld(q.world) ? CFG.jobMs : CFG.jobMs + 10 * 60e3;
  try {
    await Promise.race([runJob(c, q), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`request timed out after ${jobMs / 1000} s`)), jobMs); })]);
  } catch (e) {
    log(`  ${q.id} ERROR ${e.stack || e.message}`);
    const r = readJson(resultPath(q.id)) || { id: q.id };
    Object.assign(r, { status: "error", finished: now(), error: String(e.message || e).slice(0, 600) });
    writeJson(resultPath(q.id), r);
    // the page that was mid-call is suspect: closing it also makes the
    // abandoned job's pending calls fail at once instead of running on
    if (/timed out|went away/.test(e.message) && c.cur) await closePage(c, c.cur);
  } finally {
    clearTimeout(timer); c.cur = null;
    running.delete(q.id); c.busy = false; lastWork = Date.now();
    writeStatus();
  }
}
function writeStatus() {
  writeJson(STATUS, {
    pid: process.pid, updated: now(), load: +load1().toFixed(1),
    chromes: chromes.filter((c) => c.B).map((c) => ({ n: c.n, pid: c.B.pid, dbg: c.B.dbg, busy: c.busy,
      pages: c.pages.map((p) => ({ world: p.world, query: p.query, commit: p.commit.slice(0, 10), dirty: p.dirty })) })),
    running: [...running.keys()],
  });
}
async function foreignTargets() {
  let n = 0;
  for (const c of chromes) {
    if (!c.B) continue;
    try {
      const list = await (await fetch(`http://127.0.0.1:${c.B.dbg}/json/list`)).json();
      const mine = new Set(c.pages.map((p) => p.pg.targetId).concat(c.sheet ? [c.sheet.targetId] : []));
      n += list.filter((t) => t.type === "page" && !mine.has(t.id) && t.url !== "about:blank").length;
    } catch (_) {}
  }
  return n;
}

log(`shot daemon ${process.pid} up; dir ${SHOT}; repo ${REPO}; cores ${CORES}, load ${load1().toFixed(1)}`);
writeStatus();
let tick = 0;
for (;;) {
  if (shuttingDown) break;
  try {
    let Q = pending();
    for (const c of chromes) {
      if (c.busy || c.launching || !c.B) continue;
      if (!c.B.alive()) { log(`chrome #${c.n} died: dropping it`); chromes.splice(chromes.indexOf(c), 1); continue; }
      const q = pick(c, Q);
      if (!q || !claim(q)) continue;
      Q = Q.filter((x) => x !== q);
      work(c, q);
    }
    // grow the pool while there is a backlog nobody is serving
    const idle = chromes.filter((c) => !c.busy && !c.launching).length;
    if (Q.length > idle && chromes.length < CFG.chromes && !chromes.some((c) => c.launching) &&
        (chromes.length === 0 || load1() < CORES * CFG.growLoadPerCore)) addChrome(Q.every((q) => q.world === "lab"));
  } catch (e) { log("tick error " + (e && e.stack || e)); }
  if (++tick % 20 === 0) writeStatus();
  if (!running.size && Date.now() - lastWork > CFG.idleMin * 60e3) {
    const f = await foreignTargets();
    if (!f) { log(`idle ${CFG.idleMin} min: closing Chromes and exiting`); await shutdown(0); }
    else lastWork = Date.now() - (CFG.idleMin - 2) * 60e3;    // the testbus is borrowing a Chrome: look again in 2 min
  }
  await sleep(120);
}
