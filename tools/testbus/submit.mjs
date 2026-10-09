#!/usr/bin/env node
/* tools/testbus/submit.mjs — hand your checks to the bus and KEEP WORKING.

     node tools/testbus/submit.mjs [--world president] \
       [--probe tools/probes/president-people.mjs] [--probe "tools/probes/president.mjs --quick"] \
       [--check tools/president-staff-check.mjs] [--check "tools/moves-sim.mjs --seed 3"] \
       [--branch B] [--commit SHA] [--seed N] [--query "cfg_X=1"] [--now] [--no-start]

   Returns in well under a second with an id. It never boots anything. The
   bus tests your COMMITTED branch merged with everyone else's on top of
   origin/main; uncommitted edits are not seen (you get a warning).

   Read the answer later, at a natural point (before you report), with
     node tools/testbus/status.mjs <id>        instant: pending / PASS / FAIL + culprit
   --now asks the daemon to batch at once instead of waiting for its window. */
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, openSync, existsSync } from "node:fs";
import path from "node:path";
import { BUS, DIRS, DAEMON_LOG, TOOL_ROOT, git, gitOk, mainRepo, writeJson, daemonInfo, slug, resultPath, now } from "./lib.mjs";

const t0 = Date.now();
const argv = process.argv.slice(2);
const many = (f) => argv.flatMap((a, i) => (a === f && argv[i + 1] != null ? [argv[i + 1]] : []));
const one = (f, d) => { const v = many(f); return v.length ? v[v.length - 1] : d; };
const has = (f) => argv.includes(f);
const cwd = process.cwd();

if (has("--help") || has("-h") || (!many("--probe").length && !many("--check").length)) {
  console.log("usage: submit.mjs [--world W] --probe FILE[ args] ... --check tools/x.mjs[ args] ... [--branch B] [--commit SHA] [--seed N] [--now]");
  process.exit(has("--help") || has("-h") ? 0 : 2);
}

const branch = one("--branch", gitOk(["rev-parse", "--abbrev-ref", "HEAD"], cwd).out || "HEAD");
const commit = one("--commit", git(["rev-parse", branch === "HEAD" ? "HEAD" : branch], cwd));
const dirty = gitOk(["status", "--porcelain", "--untracked-files=no"], cwd);
if (!one("--commit") && dirty.ok && dirty.out) console.error("testbus: WARNING uncommitted changes in " + cwd + " are NOT tested (the bus tests " + commit.slice(0, 10) + ")");

const id = `${Date.now().toString(36)}-${slug(branch).slice(0, 24)}-${Math.random().toString(36).slice(2, 6)}`;
const split = (s) => s.trim().split(/\s+/);
const names = new Set();
const uniq = (n) => { let k = n, i = 2; while (names.has(k)) k = `${n}#${i++}`; names.add(k); return k; };

const fdir = path.join(DIRS.files, id);
const probes = many("--probe").map((spec, i) => {
  const [file, ...args] = split(spec);
  const abs = path.resolve(cwd, file);
  if (!existsSync(abs)) { console.error("testbus: no such probe " + abs); process.exit(2); }
  mkdirSync(fdir, { recursive: true });
  const copy = path.join(fdir, `${i}-${path.basename(abs)}`);
  copyFileSync(abs, copy);                     // frozen: later edits to your file don't change this request
  return { name: uniq(path.basename(abs).replace(/\.(m?js)$/, "") + (args.length ? " " + args.join(" ") : "")), file: copy, src: abs, args };
});
const checks = many("--check").map((spec) => {
  const [cmd, ...args] = split(spec);
  const rel = path.isAbsolute(cmd) ? path.relative(path.resolve(cwd, git(["rev-parse", "--show-toplevel"], cwd)), cmd) : cmd;
  return { name: uniq(path.basename(rel).replace(/\.m?js$/, "") + (args.length ? " " + args.join(" ") : "")), cmd: rel, args };
});

const req = {
  id, branch, commit, world: one("--world", "city"), seed: one("--seed", null), query: one("--query", ""),
  probes, checks, urgent: has("--now"), submitted: now(), submittedMs: Date.now(), cwd,
};
writeJson(resultPath(id), {
  id, branch, commit, status: "queued", submitted: req.submitted,
  checks: [...probes.map((p) => ({ name: p.name, kind: "probe", status: "queued" })), ...checks.map((c) => ({ name: c.name, kind: "node", status: "queued" }))],
});
writeJson(path.join(DIRS.queue, id + ".json"), req);

// start the daemon if nobody has (the lockfile makes a race harmless)
let started = "";
if (!has("--no-start") && !daemonInfo()) {
  let runner = path.join(TOOL_ROOT, "tools/testbus/run.mjs");
  try { const m = path.join(mainRepo(cwd), "tools/testbus/run.mjs"); if (existsSync(m)) runner = m; } catch (_) {}
  const fd = openSync(DAEMON_LOG, "a");
  spawn(process.execPath, [runner], { detached: true, stdio: ["ignore", fd, fd], cwd: path.dirname(runner) }).unref();
  started = " (started the batcher)";
}
console.log(`testbus ${id} queued: ${probes.length} probe(s), ${checks.length} node check(s) on ${branch}@${commit.slice(0, 10)}${started} [${Date.now() - t0} ms]`);
console.log(`  later: node tools/testbus/status.mjs ${id}`);
