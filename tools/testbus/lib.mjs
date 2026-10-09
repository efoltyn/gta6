/* tools/testbus/lib.mjs — the bus's shared ground: where things live, the
   knobs, git, atomic files, the machine's load.

   One shared directory on this Mac (not per worktree, not per agent):
     $TESTBUS_DIR (default ~/harness/out/gta6/testbus)
       queue/<id>.json        submitted, not yet claimed by a batch
       files/<id>/            the probe files the submitter handed in (frozen copies)
       running/<id>.json      claimed by a batch
       results/<id>.json      the answer, rewritten as each check lands
       batches/<bid>/         batch.json + report.txt + logs/<check>.log per batch
       trees/<bid>/           scratch integration worktrees (detached, deleted after)
       daemon.lock / daemon.log */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, renameSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOOL_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const BUS = process.env.TESTBUS_DIR || path.join(os.homedir(), "harness/out/gta6/testbus");
export const DIRS = {
  queue: path.join(BUS, "queue"), running: path.join(BUS, "running"), results: path.join(BUS, "results"),
  files: path.join(BUS, "files"), batches: path.join(BUS, "batches"), trees: path.join(BUS, "trees"),
};
export const LOCK = path.join(BUS, "daemon.lock");
export const DAEMON_LOG = path.join(BUS, "daemon.log");
for (const d of Object.values(DIRS)) mkdirSync(d, { recursive: true });

const num = (k, d) => (process.env[k] != null && process.env[k] !== "" ? +process.env[k] : d);
export const CFG = {
  // a batch with probes forms when the oldest request is this old, or K are waiting
  windowS: num("TESTBUS_WINDOW_S", 60),
  windowWarmS: num("TESTBUS_WINDOW_WARM_S", 20),   // shorter when a world is already booted
  k: num("TESTBUS_K", 6),
  nodeOnlyS: num("TESTBUS_NODE_ONLY_S", 3),        // node-only requests: nearly no wait
  idleExitMin: num("TESTBUS_IDLE_MIN", 20),        // close Chrome + exit after this long idle
  headroom: num("TESTBUS_HEADROOM", 2),            // cores left free for builders
  maxPages: num("TESTBUS_MAX_PAGES", 3),           // live game pages in the one Chrome
  bootTimeoutMs: num("TESTBUS_BOOT_MS", 15 * 60e3),
  probeTimeoutMs: num("TESTBUS_PROBE_MS", 30 * 60e3),
  nodeTimeoutMs: num("TESTBUS_NODE_MS", 10 * 60e3),
  // wait (not fail) before a cold boot while the machine is this loaded
  maxLoadPerCore: num("TESTBUS_MAX_LOAD_PER_CORE", 4),
};
export const CORES = os.cpus().length;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => new Date().toISOString();
export const load1 = () => os.loadavg()[0];

export function writeJson(file, obj) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 1));
  renameSync(tmp, file);
}
export function readJson(file, dflt = null) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch (_) { return dflt; }
}

export function git(args, cwd = TOOL_ROOT, opts = {}) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20, ...opts }).trim();
}
export function gitOk(args, cwd = TOOL_ROOT) {
  try { return { ok: true, out: git(args, cwd) }; }
  catch (e) { return { ok: false, out: String((e.stdout || "") + (e.stderr || "") || e.message) }; }
}
/* The main checkout: every worktree shares its object store and refs, so the
   bus runs its git work from there and never from the worktree of whichever
   agent happened to start it (that worktree may be deleted mid-run). */
export function mainRepo(cwd = TOOL_ROOT) {
  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  return path.dirname(common);
}

export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}
export function daemonInfo() {
  const L = readJson(LOCK);
  return L && pidAlive(L.pid) ? L : null;
}
export const slug = (s) => String(s || "x").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";
export const resultPath = (id) => path.join(DIRS.results, `${id}.json`);
export { existsSync };
