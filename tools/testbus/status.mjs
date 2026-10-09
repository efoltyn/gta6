#!/usr/bin/env node
/* tools/testbus/status.mjs — where are my checks? Returns instantly, never waits.

     node tools/testbus/status.mjs <id> [<id>...]   one line each (+ failing checks)
     node tools/testbus/status.mjs --branch B       the latest request for a branch
     node tools/testbus/status.mjs --all            the last 15 requests
     node tools/testbus/status.mjs --batch [latest|<bid>]   a batch's report
     node tools/testbus/status.mjs --daemon         is the batcher up, what is warm
     -v  every check with its log path

   Exit: 0 PASS, 1 FAIL/BLOCKED/CONFLICT/ERROR, 2 still pending. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { BUS, DIRS, readJson, daemonInfo, resultPath } from "./lib.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const V = has("-v");

if (has("--daemon")) {
  const L = daemonInfo(), S = readJson(path.join(BUS, "status.json"));
  console.log(L ? `batcher pid ${L.pid} up since ${L.started}` : "batcher: not running (submit.mjs starts it)");
  if (L && S) console.log(JSON.stringify({ chrome: S.chrome, warm: S.warm, lanes: S.lanes, queued: S.queued }, null, 1));
  process.exit(0);
}
if (has("--batch")) {
  let b = val("--batch");
  if (!b || b.startsWith("-") || b === "latest") b = (readJson(path.join(BUS, "last-batch.json")) || {}).id;
  if (!b) { console.log("no batch yet"); process.exit(0); }
  try { process.stdout.write(readFileSync(path.join(DIRS.batches, b, "report.txt"), "utf8")); } catch (_) { console.log("batch " + b + " is still running (or unknown)"); }
  process.exit(0);
}
const recent = () => readdirSync(DIRS.results).filter((f) => f.endsWith(".json"))
  .map((f) => ({ f, t: statSync(path.join(DIRS.results, f)).mtimeMs })).sort((a, b) => b.t - a.t).map((x) => x.f.replace(/\.json$/, ""));
let ids = argv.filter((a, i) => !a.startsWith("-") && !["--branch"].includes(argv[i - 1]));
if (has("--all")) ids = recent().slice(0, 15);
if (val("--branch")) { const b = val("--branch"); const hit = recent().find((id) => (readJson(resultPath(id)) || {}).branch === b); ids = hit ? [hit] : []; }
if (!ids.length) { console.log("usage: status.mjs <id> | --branch B | --all | --batch [latest] | --daemon"); process.exit(2); }

let code = 0;
for (const id of ids) {
  const r = readJson(resultPath(id));
  if (!r) { console.log(`${id}  UNKNOWN`); code = Math.max(code, 1); continue; }
  const done = ["pass", "fail", "blocked", "conflict", "error"].includes(r.status);
  const n = (r.checks || []).length, ok = (r.checks || []).filter((c) => c.status === "pass").length;
  if (!done) {
    const st = (r.checks || []).map((c) => `${c.name}=${c.status}`).join(", ");
    console.log(`${id}  ${r.status.toUpperCase()}  ${ok}/${n} done  [${st}]` + (r.status === "queued" && !daemonInfo() ? "  (batcher not running: node tools/testbus/run.mjs)" : ""));
    code = Math.max(code, 2); continue;
  }
  console.log(`${id}  ${r.short || r.status.toUpperCase()}`);
  for (const c of r.checks || []) {
    if (!V && (c.status === "pass" || c.status === "preexisting")) continue;
    console.log(`   ${c.status.padEnd(11)} ${c.name}${c.ms ? `  ${(c.ms / 1000).toFixed(1)} s` : ""}${c.culprit ? `  culprit: ${c.culprit}` : ""}${c.log ? `\n               log ${c.log}` : ""}`);
    if (!V && c.tail) for (const l of c.tail.slice(-5)) console.log("               | " + l);
  }
  for (const b of r.breaks || []) console.log(`   BREAKS     ${b.check} for ${b.submittedBy.join(", ")}${b.log ? `\n               log ${b.log}` : ""}`);
  if (r.status !== "pass") code = Math.max(code, 1);
}
process.exit(code === 2 ? 2 : code);
