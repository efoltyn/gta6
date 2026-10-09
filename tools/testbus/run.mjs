#!/usr/bin/env node
/* tools/testbus/run.mjs — THE BATCHER. One warm Chrome, one boot per world,
   every agent's checks in it.

     node tools/testbus/run.mjs            start the daemon (no-op if one is running)
     node tools/testbus/run.mjs --now      ...and batch whatever is queued right away
     node tools/testbus/run.mjs --once     process the queue until empty, then exit
     node tools/testbus/run.mjs --stop     stop the running daemon (closes its Chrome)

   Builders never run this by hand: tools/testbus/submit.mjs starts it.

   TWO LANES, so a cheap answer never waits behind an expensive one:
     node lane   requests with only node checks; batched after TESTBUS_NODE_ONLY_S (3 s)
     world lane  requests with probes; batched after TESTBUS_WINDOW_S (60 s, 20 s when
                 a world is already warm) or as soon as TESTBUS_K (6) are waiting.
   A batch = origin/main + every queued branch merged in the object store
   (tools/testbus/tree.mjs), checked out once, then:
     - node checks (deduped across requests) run in a pool of cores-headroom,
       FIRST, and land in the results as each finishes;
     - each world is booted ONCE in the warm Chrome (or reused warm: no reboot
       when the batch changed nothing the page serves, a hot script swap when
       every changed page file is marked `testbus:hot-safe`); its probes run in
       sequence on sim time, clean ones first; a probe that needs a fresh world
       after a dirtying one gets a parallel page;
     - a failing check is bisected over the batch's branches (prefix bisect,
       log2(M) extra runs) and checked on bare origin/main, so the report names
       the branch to fix, or says the failure was already on main. */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, unlinkSync, existsSync, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { BUS, DIRS, LOCK, CFG, CORES, sleep, now, load1, writeJson, readJson, pidAlive, daemonInfo, slug, resultPath } from "./lib.mjs";
import { fetchMain, integrate, chain, checkout, dropSlots, changedFiles } from "./tree.mjs";
import { launchChrome, serve } from "./browser.mjs";
import { worldKey, parseKey, bootWorld, loadProbe, runProbe } from "./worlds.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}] ` + a.join(" "));

// ---------------------------------------------------------------- lifecycle
if (has("--stop")) {
  const L = daemonInfo();
  if (!L) { console.log("testbus: no daemon running"); process.exit(0); }
  process.kill(L.pid, "SIGTERM");
  for (let i = 0; i < 50 && pidAlive(L.pid); i++) await sleep(200);
  console.log(`testbus: stopped daemon ${L.pid}`);
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
if (!takeLock()) {
  const L = daemonInfo();
  if (has("--now") && L) { writeFileSync(path.join(BUS, "now"), now()); console.log(`testbus: daemon ${L.pid} running; asked it to batch now`); }
  else console.log(`testbus: daemon already running (pid ${L && L.pid})`);
  process.exit(0);
}
let NOW = has("--now") || has("--once");
const ONCE = has("--once");

let browser = null;
const pool = [];            // { key, pg, srv, commit, dirty, busy, loaded, bootMs }
const bisectPages = [];
async function shutdown(code = 0) {
  for (const p of pool.concat(bisectPages)) { try { p.srv.close(); } catch (_) {} }
  if (browser) await browser.close().catch(() => {});
  try { dropSlots(); } catch (_) {}
  try { const L = readJson(LOCK); if (L && L.pid === process.pid) unlinkSync(LOCK); } catch (_) {}
  writeJson(path.join(BUS, "status.json"), { pid: null, stopped: now() });
  process.exit(code);
}
for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => { log("signal " + s); shutdown(0); });
process.on("uncaughtException", (e) => { log("UNCAUGHT " + (e && e.stack || e)); });
process.on("unhandledRejection", (e) => { log("UNHANDLED " + (e && e.stack || e)); });

// ------------------------------------------------------------------ results
const RES = new Map();
function res(id) { return RES.get(id) || readJson(resultPath(id)); }
function saveRes(r) { RES.set(r.id, r); writeJson(resultPath(r.id), r); }
function setCheck(r, name, patch) {
  const c = r.checks.find((x) => x.name === name);
  if (c) Object.assign(c, patch);
  saveRes(r);
}

// --------------------------------------------------------------------- queue
function queued() {
  const out = [];
  for (const f of readdirSync(DIRS.queue)) {
    if (!f.endsWith(".json")) continue;
    const q = readJson(path.join(DIRS.queue, f));
    if (q && q.id) out.push(q);
  }
  return out.sort((a, b) => a.submittedMs - b.submittedMs);
}
function claim(q) {
  try { renameSync(path.join(DIRS.queue, q.id + ".json"), path.join(DIRS.running, q.id + ".json")); return true; } catch (_) { return false; }
}
const isWorld = (q) => (q.probes || []).length > 0;

// ----------------------------------------------------------------- the pool
async function ensureBrowser() {
  if (browser && browser.alive()) return { fresh: false };
  for (const p of pool.splice(0)) { try { p.srv.close(); } catch (_) {} }
  browser = await launchChrome();
  log(`chrome up in ${browser.startMs} ms (pid ${browser.pid}, :${browser.dbg})`);
  return { fresh: true };
}
async function loadGate() {
  const lim = CORES * CFG.maxLoadPerCore; const t0 = Date.now();
  while (load1() > lim && Date.now() - t0 < 10 * 60e3) { log(`load ${load1().toFixed(1)} > ${lim}: holding the boot`); await sleep(15000); }
  return Date.now() - t0;
}
const SERVED = (f) => !/^(tools|docs|artifacts|scrolls|ios|apps|rust|server|\.claude|\.github|\.harness)\//.test(f) && !/\.md$/i.test(f);

/* acquire a booted page for `key` on tree `dir` at `commit`. how = warm | hot | reload | newpage | cold */
async function acquire(key, dir, commit, { mustBeClean = false, newOnly = false } = {}) {
  const t0 = Date.now();
  const br = await ensureBrowser();
  let p = newOnly ? null : pool.find((x) => x.key === key && !x.busy && !x.pg.closed);
  if (p) {
    p.busy = true;
    p.srv.setRoot(dir);
    const changed = changedFiles(p.commit, commit);
    const served = changed == null ? null : changed.filter(SERVED);
    let how = "reload";
    if (!(p.dirty && mustBeClean) && served && served.length === 0) how = "warm";
    else if (!(p.dirty && mustBeClean) && served && served.every((f) => f.endsWith(".js") && hotSafe(dir, f))) {
      const live = served.filter((f) => p.loaded.includes(f));
      const ok = await p.pg.evl(`Promise.all(${JSON.stringify(live)}.map(function(f){return new Promise(function(r){var s=document.createElement('script');s.src='/'+f+'?v=tb'+Date.now();s.onload=function(){r(true)};s.onerror=function(){r(false)};document.head.appendChild(s);});})).then(function(a){return a.every(Boolean)})`, 120000).catch(() => false);
      how = ok ? "hot" : "reload";
    }
    if (how === "reload") {
      await loadGate();
      const b = await bootWorld(p.pg, p.srv.origin, key, CFG.bootTimeoutMs);
      Object.assign(p, { loaded: b.loaded, bootMs: b.bootMs, dirty: false });
    }
    p.commit = commit;
    return { p, how, ms: Date.now() - t0, chromeMs: 0 };
  }
  if (pool.filter((x) => !x.pg.closed).length >= CFG.maxPages) {
    const idle = pool.find((x) => !x.busy);
    if (idle) { await idle.pg.closeTarget(); idle.srv.close(); pool.splice(pool.indexOf(idle), 1); }
  }
  const waited = await loadGate();
  const srv = await serve(dir);
  const pg = await browser.newPage();
  const b = await bootWorld(pg, srv.origin, key, CFG.bootTimeoutMs);
  p = { key, pg, srv, commit, dirty: false, busy: true, loaded: b.loaded, bootMs: b.bootMs };
  pool.push(p);
  return { p, how: br.fresh ? "cold" : "newpage", ms: Date.now() - t0 - waited, chromeMs: br.fresh ? browser.startMs : 0, loadWaitMs: waited };
}
function hotSafe(dir, f) {
  try { return /testbus:hot-safe/.test(readFileSync(path.join(dir, f), "utf8").slice(0, 4000)); } catch (_) { return false; }
}
function release(p) { if (p) p.busy = false; }

// -------------------------------------------------------------- node checks
function runNode(dir, chk, logFile) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    mkdirSync(path.dirname(logFile), { recursive: true });
    const out = createWriteStream(logFile);
    const ch = spawn(process.execPath, [chk.cmd, ...(chk.args || [])], { cwd: dir, env: { ...process.env, TESTBUS: "1" }, detached: true });
    let tail = "";
    const keep = (d) => { out.write(d); tail = (tail + d.toString()).slice(-4000); };
    ch.stdout.on("data", keep); ch.stderr.on("data", keep);
    const timer = setTimeout(() => { try { process.kill(-ch.pid, "SIGKILL"); } catch (_) {} keep(Buffer.from(`\n[testbus] killed after ${CFG.nodeTimeoutMs / 1000} s\n`)); }, CFG.nodeTimeoutMs);
    ch.on("close", (code) => {
      clearTimeout(timer); out.end();
      const lines = tail.trim().split("\n");
      resolve({ status: code === 0 ? "pass" : "fail", code, ms: Date.now() - t0, summary: lines[lines.length - 1].slice(0, 200), tail: lines.slice(-12) });
    });
  });
}
async function pooled(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
const nodeSlots = () => Math.max(1, Math.min(CORES - CFG.headroom, Math.floor(CORES * 2 - load1())));

// ------------------------------------------------------------------- batch
let batchSeq = 0;
async function runBatch(lane, reqs) {
  const bid = `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${lane}-${++batchSeq}`;
  const BD = path.join(DIRS.batches, bid); mkdirSync(path.join(BD, "logs"), { recursive: true });
  const t0 = Date.now(), load0 = load1(); let peak = load0;
  const sampler = setInterval(() => { peak = Math.max(peak, load1()); }, 2000);
  const B = { id: bid, lane, started: now(), requests: reqs.map((q) => ({ id: q.id, branch: q.branch, commit: q.commit })), worlds: [], node: [], bisect: [] };
  log(`batch ${bid}: ${reqs.length} request(s): ${reqs.map((q) => q.branch).join(", ")}`);
  const solo = [];
  try {
    const base = fetchMain();
    const I = integrate(base, reqs);
    B.base = base; B.head = I.head; B.merged = I.merged.map((q) => q.branch);
    for (const c of I.conflicts) {
      const r = res(c.req.id);
      if (c.with[0] === "origin/main") {
        Object.assign(r, { status: "conflict", batch: bid, finished: now(), conflict: { with: c.with, files: c.files },
          short: `CONFLICT with origin/main in ${c.files.slice(0, 4).join(", ")}: rebase/merge main into ${c.req.branch} and resubmit` });
        saveRes(r); unclaim(c.req);
      } else { solo.push(c.req); log(`  ${c.req.branch} conflicts with ${c.with.join(", ")}: own mini-batch`); }
    }
    B.conflicts = I.conflicts.map((c) => ({ branch: c.req.branch, with: c.with, files: c.files }));
    if (!I.merged.length) return;
    const dir = checkout(lane, I.head);

    // unique checks across the batch
    const nodeU = new Map(), probeU = new Map();
    for (const q of I.merged) {
      const r = res(q.id);
      Object.assign(r, { status: "running", batch: bid, base, integration: I.head, mergedWith: I.merged.filter((o) => o !== q).map((o) => o.branch) });
      saveRes(r);
      for (const c of q.checks || []) {
        const k = "node:" + [c.cmd, ...(c.args || [])].join(" ");
        if (!nodeU.has(k)) nodeU.set(k, { key: k, kind: "node", cmd: c.cmd, args: c.args || [], owners: [] });
        nodeU.get(k).owners.push({ q, name: c.name });
      }
      for (const pr of q.probes || []) {
        const probe = await loadProbe(pr.file).catch((e) => ({ err: e }));
        if (probe.err) { setCheck(r, pr.name, { status: "error", summary: "probe did not load: " + probe.err.message }); continue; }
        const world = probe.meta.world || pr.world || q.world;
        const wk = worldKey(world, probe.meta.seed != null ? probe.meta.seed : q.seed, q.query);
        const hash = createHash("sha1").update(readFileSync(pr.file)).digest("hex").slice(0, 10);
        const k = `probe:${wk}:${hash}:${(pr.args || []).join(" ")}`;
        if (!probeU.has(k)) probeU.set(k, { key: k, kind: "probe", wk, probe, file: pr.file, args: pr.args || [], name: pr.name, owners: [] });
        probeU.get(k).owners.push({ q, name: pr.name });
      }
    }
    const fan = (u, patch) => { for (const o of u.owners) setCheck(res(o.q.id), o.name, patch); };
    const logFor = (u) => path.join(BD, "logs", slug(u.kind === "node" ? [u.cmd, ...u.args].join(" ") : `${u.name}-${u.wk}`) + ".log");

    // node checks: cheap, first, in parallel
    const nodeList = [...nodeU.values()];
    for (const u of nodeList) fan(u, { status: "running" });
    const nodeP = pooled(nodeList, nodeSlots(), async (u) => {
      const lf = logFor(u);
      const r = await runNode(dir, u, lf);
      u.result = r;
      B.node.push({ check: u.key, ms: r.ms, status: r.status });
      fan(u, { status: r.status, ms: r.ms, summary: r.summary, tail: r.tail, log: lf });
      log(`  node ${r.status.toUpperCase()} ${u.cmd} (${(r.ms / 1000).toFixed(1)} s)`);
      return r;
    });

    // worlds: one boot each, probes in sequence (clean first), extra pages for fresh-after-dirty
    const byWorld = new Map();
    for (const u of probeU.values()) { if (!byWorld.has(u.wk)) byWorld.set(u.wk, []); byWorld.get(u.wk).push(u); }
    const worldP = Promise.all([...byWorld.entries()].map(([wk, list]) => runWorld(B, wk, list, dir, I.head, fan, logFor)));
    await Promise.all([nodeP, worldP]);

    // bisect what failed
    const failed = [...nodeU.values(), ...probeU.values()].filter((u) => u.result && (u.result.status === "fail" || u.result.status === "error") && !u.result.infra).slice(0, 6);
    if (failed.length) {
      const at = atCommit(failed, BD, lane);      // every failing check, together, once per commit
      for (const u of failed) {
        const c = await culprit(u, base, I.merged, at);
        u.culprit = c;
        B.bisect.push({ check: u.key, ...c });
        log(`  bisect ${u.key}: ${c.preexisting ? "already fails on origin/main" : "caused by " + c.branch}`);
      }
    }

    // finalize
    for (const q of I.merged) finalize(q, bid, nodeU, probeU, I.merged);
  } catch (e) {
    log(`batch ${bid} ERROR ${e && e.stack || e}`);
    for (const q of reqs) {
      const r = res(q.id);
      if (r && !["pass", "fail", "conflict", "blocked"].includes(r.status)) {
        Object.assign(r, { status: "error", finished: now(), short: "testbus infrastructure error: " + String(e && e.message || e).slice(0, 200) });
        saveRes(r);
      }
      unclaim(q);
    }
  } finally {
    clearInterval(sampler);
    B.wallMs = Date.now() - t0; B.peakLoad = +Math.max(peak, load1()).toFixed(1); B.startLoad = +load0.toFixed(1); B.finished = now();
    writeJson(path.join(BD, "batch.json"), B);
    writeFileSync(path.join(BD, "report.txt"), report(B));
    writeJson(path.join(BUS, "last-batch.json"), { id: bid, dir: BD });
    log(`batch ${bid} done in ${(B.wallMs / 1000).toFixed(1)} s, peak load ${B.peakLoad}`);
  }
  for (const q of solo) await runBatch(lane, [q]);
}
function unclaim(q) { try { rmSync(path.join(DIRS.running, q.id + ".json"), { force: true }); } catch (_) {} }

/* order probes into RUNS that can share one world: clean+fresh first, then one
   fresh+dirtying probe, then the ones that don't care; every further
   fresh+dirtying probe opens its own run (its own page, booted in parallel). */
function plan(list) {
  const cleanFresh = list.filter((u) => u.probe.meta.fresh && !u.probe.meta.dirties);
  const dirtyFresh = list.filter((u) => u.probe.meta.fresh && u.probe.meta.dirties);
  const any = list.filter((u) => !u.probe.meta.fresh);
  const runs = [[...cleanFresh, ...dirtyFresh.slice(0, 1), ...any]];
  for (const u of dirtyFresh.slice(1)) runs.push([u]);
  return runs;
}
async function runWorld(B, wk, list, dir, commit, fan, logFor) {
  const runs = plan(list);
  const W = { key: wk, runs: [] };
  B.worlds.push(W);
  for (const u of list) fan(u, { status: "booting" });
  await Promise.all(runs.map(async (run, ri) => {
    const R = { probes: [] };
    W.runs.push(R);
    let a;
    try { a = await acquire(wk, dir, commit, { mustBeClean: run.some((u) => u.probe.meta.fresh), newOnly: ri > 0 }); }
    catch (e) {
      R.error = String(e.message || e);
      for (const u of run) { u.result = { status: "error", summary: "world did not boot: " + R.error, infra: true }; fan(u, { status: "error", summary: u.result.summary }); }
      return;
    }
    Object.assign(R, { how: a.how, acquireMs: a.ms, chromeMs: a.chromeMs, bootMs: a.how === "warm" || a.how === "hot" ? 0 : a.p.bootMs, loadWaitMs: a.loadWaitMs || 0 });
    log(`  world ${wk} ${a.how} in ${(a.ms / 1000).toFixed(1)} s`);
    try {
      for (const u of run) {
        if (a.p.pg.closed) { u.result = { status: "error", summary: "page died before this probe", infra: true }; fan(u, { status: "error", summary: u.result.summary }); continue; }
        fan(u, { status: "running" });
        const { seed } = parseKey(wk);
        const wasDirty = a.p.dirty;
        let r = await runProbe(a.p.pg, u.probe, { args: u.args, seed, world: parseKey(wk).name, timeoutMs: CFG.probeTimeoutMs });
        if (u.probe.meta.dirties) a.p.dirty = true;
        /* A fresh:false probe that FAILS on a world an earlier probe dirtied may
           be the earlier probe's fault (measured: president --quick passes alone
           and halts its motorcade after president-verbs leaves 11 guns drawn).
           Re-run it once on a rebooted world before anyone is blamed. */
        if (r.status === "fail" && wasDirty && !r.broken && !a.p.pg.closed) {
          log(`  probe ${u.name} failed on a dirtied world: rebooting to re-run it clean`);
          const b = await bootWorld(a.p.pg, a.p.srv.origin, wk, CFG.bootTimeoutMs);
          Object.assign(a.p, { loaded: b.loaded, bootMs: b.bootMs, dirty: false });
          const r2 = await runProbe(a.p.pg, u.probe, { args: u.args, seed, world: parseKey(wk).name, timeoutMs: CFG.probeTimeoutMs });
          if (u.probe.meta.dirties) a.p.dirty = true;
          if (r2.status === "pass") r2.summary += "  [failed on a shared world, passed on a fresh one: this probe should declare fresh:true]";
          r2.log.unshift(`[testbus] first run on a dirtied world: ${r.status} ${r.summary}`);
          r2.ms += r.ms; R.reruns = (R.reruns || 0) + 1;
          r = r2;
        }
        const lf = logFor(u);
        writeFileSync(lf, r.log.concat(["", "SUMMARY " + r.summary, "page errors: " + JSON.stringify(a.p.pg.errors.slice(-10))]).join("\n"));
        u.result = { ...r, infra: r.broken };
        R.probes.push({ name: u.name, ms: r.ms, status: r.status });
        fan(u, { status: r.status, ms: r.ms, summary: r.summary, tail: r.log.slice(-12), log: lf, data: r.data });
        log(`  probe ${r.status.toUpperCase()} ${u.name} (${(r.ms / 1000).toFixed(1)} s) ${r.summary}`);
        if (r.broken) { await a.p.pg.closeTarget(); }
      }
    } finally { release(a.p); }
  }));
}

/* atCommit(checks) -> async (commit, label) => Map(key -> status). Runs ALL the
   failing checks at a commit in one go (node ones in the pool, probes sharing
   one booted page per world, rebooting only for a fresh-after-dirty probe),
   so bisecting three failures costs the same boots as bisecting one. */
function atCommit(checks, BD, lane) {
  const cache = new Map();
  return async (commit, label) => {
    if (cache.has(commit)) return cache.get(commit);
    const out = new Map();
    const dir = checkout("bisect-" + lane, commit);
    const nodes = checks.filter((u) => u.kind === "node"), probes = checks.filter((u) => u.kind === "probe");
    await pooled(nodes, nodeSlots(), async (u) => {
      // a check a branch introduced is absent on main: not there = not broken
      if (!existsSync(path.join(dir, u.cmd))) return out.set(u.key, "absent");
      out.set(u.key, (await runNode(dir, u, path.join(BD, "logs", "bisect-" + slug(label) + "-" + slug(u.cmd) + ".log"))).status);
    });
    const byWorld = new Map();
    for (const u of probes) { if (!byWorld.has(u.wk)) byWorld.set(u.wk, []); byWorld.get(u.wk).push(u); }
    for (const [wk, list] of byWorld) {
      let srv = null, pg = null, dirty = false;
      try {
        await ensureBrowser(); await loadGate();
        srv = await serve(dir); pg = await browser.newPage();
        const b = await bootWorld(pg, srv.origin, wk, CFG.bootTimeoutMs);
        log(`  bisect @ ${label}: ${wk} booted in ${(b.bootMs / 1000).toFixed(1)} s`);
        for (const u of plan(list).flat()) {
          // attribution must not depend on probe order: every probe gets a clean world here
          if (dirty) { await bootWorld(pg, srv.origin, wk, CFG.bootTimeoutMs); dirty = false; }
          const r = await runProbe(pg, u.probe, { args: u.args, seed: parseKey(wk).seed, world: parseKey(wk).name, timeoutMs: CFG.probeTimeoutMs });
          if (u.probe.meta.dirties) dirty = true;
          out.set(u.key, r.status);
          log(`  bisect @ ${label}: ${u.name} ${r.status} (${(r.ms / 1000).toFixed(1)} s)`);
          if (r.broken) break;
        }
      } catch (e) { log(`  bisect boot ${wk} at ${label} failed: ${e.message}`); }
      finally { if (pg) await pg.closeTarget(); if (srv) srv.close(); }
      for (const u of list) if (!out.has(u.key)) out.set(u.key, "error");
    }
    out.label = label;
    cache.set(commit, out);
    return out;
  };
}

/* culprit(u): is it already broken on bare origin/main? if not, prefix-bisect
   the merged branches: the first prefix that fails names the branch to fix. */
async function culprit(u, base, merged, at) {
  const runs = [];
  const fails = async (commit, label) => {
    const st = (await at(commit, label)).get(u.key) || "error";
    runs.push({ on: label, status: st });
    return st !== "pass" && st !== "absent";
  };
  if (await fails(base, "origin/main")) return { preexisting: true, branch: null, runs };
  if (merged.length === 1) return { preexisting: false, branch: merged[0].branch, id: merged[0].id, runs };
  let lo = 0, hi = merged.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const c = chain(base, merged.slice(0, mid + 1));
    if (c && await fails(c, "main+" + merged.slice(0, mid + 1).map((q) => q.branch).join("+"))) hi = mid; else lo = mid + 1;
  }
  return { preexisting: false, branch: merged[lo].branch, id: merged[lo].id, interaction: lo > 0, runs };
}

function finalize(q, bid, nodeU, probeU, merged) {
  const r = res(q.id);
  const all = [...nodeU.values(), ...probeU.values()];
  let mineBroke = 0, otherBroke = 0, pre = 0;
  for (const c of r.checks) {
    const u = all.find((x) => x.owners.some((o) => o.q.id === q.id && o.name === c.name));
    if (!u || !u.result) { if (c.status === "queued" || c.status === "running" || c.status === "booting") c.status = "error"; continue; }
    if (u.result.status === "pass") continue;
    if (u.culprit) {
      c.culprit = u.culprit.preexisting ? "origin/main (already failing before this batch)" : u.culprit.branch;
      if (u.culprit.preexisting) { pre++; c.status = "preexisting"; }
      else if (u.culprit.branch === q.branch) mineBroke++;
      else otherBroke++;
    } else mineBroke++;
  }
  // checks this branch broke for OTHER requests
  const breaks = all.filter((u) => u.culprit && !u.culprit.preexisting && u.culprit.branch === q.branch && !u.owners.some((o) => o.q.id === q.id))
    .map((u) => ({ check: u.owners[0].name, submittedBy: u.owners.map((o) => o.q.branch), log: u.result && u.result.log }));
  if (breaks.length) r.breaks = breaks;
  const n = r.checks.length, ok = r.checks.filter((c) => c.status === "pass").length;
  r.status = mineBroke || breaks.length ? "fail" : otherBroke ? "blocked" : r.checks.some((c) => c.status === "error") ? "error" : "pass";
  r.finished = now();
  const bad = r.checks.filter((c) => !["pass", "preexisting"].includes(c.status));
  r.short = r.status === "pass"
    ? `PASS ${ok}/${n}${pre ? ` (+${pre} already failing on main)` : ""} in batch ${bid} with ${merged.length - 1} other branch(es)`
    : r.status === "blocked"
      ? `BLOCKED: your branch is fine; ${bad.map((c) => `${c.name} broken by ${c.culprit}`).join("; ")}`
      : `${r.status.toUpperCase()} ${ok}/${n}: ` + [...bad.map((c) => `${c.name}${c.culprit ? " (culprit " + c.culprit + ")" : ""}: ${c.summary || ""}`.slice(0, 160)),
        ...breaks.map((b) => `your branch breaks ${b.check} (submitted by ${b.submittedBy.join(", ")})`)].join(" | ");
  saveRes(r);
  unclaim(q);
}

function report(B) {
  const L = [`testbus batch ${B.id} (${B.lane} lane)  ${((B.wallMs || 0) / 1000).toFixed(1)} s  load ${B.startLoad} -> peak ${B.peakLoad}`,
    `base origin/main ${String(B.base || "").slice(0, 10)}  merged: ${(B.merged || []).join(", ") || "-"}`];
  for (const c of B.conflicts || []) L.push(`CONFLICT ${c.branch} with ${c.with.join(", ")}: ${c.files.slice(0, 5).join(", ")}`);
  for (const w of B.worlds) for (const r of w.runs) L.push(`world ${w.key}: ${r.how || "-"} ${((r.acquireMs || 0) / 1000).toFixed(1)} s` + (r.chromeMs ? ` (chrome ${(r.chromeMs / 1000).toFixed(1)} s)` : "") + (r.error ? " ERROR " + r.error : "") +
    "  probes: " + r.probes.map((p) => `${p.name} ${p.status} ${(p.ms / 1000).toFixed(1)} s`).join(", "));
  for (const n of B.node) L.push(`node ${n.status} ${(n.ms / 1000).toFixed(1)} s  ${n.check}`);
  for (const b of B.bisect) L.push(`BISECT ${b.check}: ${b.preexisting ? "already fails on origin/main" : "FIX " + b.branch + (b.interaction ? " (only with the branches merged before it)" : "")}  runs: ${b.runs.map((r) => r.on + "=" + r.status).join(", ")}`);
  for (const q of B.requests) { const r = res(q.id); if (r) L.push(`${q.id}  ${r.status}  ${r.short || ""}`); }
  return L.join("\n") + "\n";
}

// --------------------------------------------------------------------- loop
const lanes = { node: { busy: false }, world: { busy: false } };
let lastWork = Date.now();
function writeStatus() {
  writeJson(path.join(BUS, "status.json"), {
    pid: process.pid, updated: now(), chrome: browser && browser.alive() ? { pid: browser.pid, dbg: browser.dbg } : null,
    warm: pool.map((p) => ({ key: p.key, commit: p.commit, dirty: p.dirty, busy: p.busy, bootMs: p.bootMs })),
    lanes: { node: lanes.node.busy, world: lanes.world.busy }, queued: queued().length,
  });
}
async function tick() {
  if (existsSync(path.join(BUS, "now"))) { rmSync(path.join(BUS, "now"), { force: true }); NOW = true; }
  const Q = queued();
  const urgent = NOW || Q.some((q) => q.urgent);
  const age = (q) => (Date.now() - q.submittedMs) / 1000;
  for (const lane of ["node", "world"]) {
    if (lanes[lane].busy) continue;
    const mine = Q.filter((q) => (lane === "world") === isWorld(q));
    if (!mine.length) continue;
    const warm = pool.some((p) => !p.pg.closed);
    const win = lane === "node" ? CFG.nodeOnlyS : warm ? CFG.windowWarmS : CFG.windowS;
    if (!(urgent || age(mine[0]) >= win || mine.length >= CFG.k)) continue;
    const take = mine.filter(claim);
    if (!take.length) continue;
    lanes[lane].busy = true; lastWork = Date.now();
    runBatch(lane, take).finally(() => { lanes[lane].busy = false; lastWork = Date.now(); writeStatus(); });
  }
  if (NOW && !Q.length) NOW = has("--now") ? false : NOW;
}
log(`testbus daemon ${process.pid} up; bus ${BUS}; cores ${CORES}, load ${load1().toFixed(1)}`);
for (;;) {
  try { await tick(); } catch (e) { log("tick error " + (e && e.stack || e)); }
  writeStatus();
  const busy = lanes.node.busy || lanes.world.busy;
  if (ONCE && !busy && !queued().length) { log("--once: queue empty, exiting"); await shutdown(0); }
  if (!busy && !queued().length && Date.now() - lastWork > CFG.idleExitMin * 60e3) { log(`idle ${CFG.idleExitMin} min: closing Chrome and exiting`); await shutdown(0); }
  await sleep(1000);
}
