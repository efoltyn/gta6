#!/usr/bin/env node
/* tools/shot/get.mjs — is my shot ready? Instant, never waits (unless --wait).

     node tools/shot/get.mjs <id> [<id>...]   status + the sheet path
     node tools/shot/get.mjs --last           your most recent request
     node tools/shot/get.mjs <id> --wait 60   block up to 60 s
     node tools/shot/get.mjs --status         the service: Chromes, warm pages, queue
     -v                                       every frame path, timings
   Exit: 0 done, 1 error, 2 still pending. */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { SD, STATUS, readJson, resultPath, daemonInfo, sleep } from "./lib.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
if (has("--status")) {
  const L = daemonInfo(), S = readJson(STATUS);
  console.log(L ? `shot service pid ${L.pid} up since ${L.started}` : "shot service: not running (req.mjs starts it)");
  if (L && S) console.log(JSON.stringify({ load: S.load, chromes: S.chromes, running: S.running, queued: readdirSync(SD.queue).length }, null, 1));
  process.exit(0);
}
let ids = argv.filter((a, i) => !a.startsWith("-") && argv[i - 1] !== "--wait");
if (has("--last") || !ids.length) {
  const f = readdirSync(SD.results).filter((x) => x.endsWith(".json")).map((x) => ({ x, t: statSync(path.join(SD.results, x)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
  if (!f) { console.log("no shots yet"); process.exit(2); }
  ids = [f.x.replace(/\.json$/, "")];
}
const lim = (+val("--wait") || 0) * 1000, t0 = Date.now();
const fin = (r) => r && (r.status === "done" || r.status === "error");
while (lim && !ids.every((id) => fin(readJson(resultPath(id)))) && Date.now() - t0 < lim) await sleep(250);
let code = 0;
for (const id of ids) {
  const r = readJson(resultPath(id));
  if (!r) { console.log(`${id}  UNKNOWN`); code = Math.max(code, 1); continue; }
  if (!fin(r)) {
    const q = r.status === "queued" ? readdirSync(SD.queue).length : 0;
    console.log(`${id}  ${String(r.status).toUpperCase()}${q ? `  (${q} in the queue)` : ""}${!daemonInfo() ? "  (service not running: node tools/shot/daemon.mjs)" : ""}`);
    code = Math.max(code, 2); continue;
  }
  const T = r.timings || {};
  if (r.status === "error") { console.log(`${id}  ERROR  ${r.error}`); code = Math.max(code, 1); }
  else console.log(`${id}  DONE  ${r.frames.length} frame(s) in ${((T.totalMs || 0) / 1000).toFixed(1)} s (${(r.sides || []).map((s) => s.how).join("/")})`);
  if (r.sheet) console.log(`  sheet  ${r.sheet}`);
  for (const w of r.warn || []) console.log(`  warn   ${w}`);
  if (has("-v")) {
    for (const f of r.frames || []) console.log(`  frame  ${f}`);
    console.log("  timings " + JSON.stringify(T));
  } else if (r.out) console.log(`  frames ${r.out}/`);
}
process.exit(code);
