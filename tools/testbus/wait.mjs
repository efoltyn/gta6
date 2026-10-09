#!/usr/bin/env node
/* tools/testbus/wait.mjs — BLOCK until requests finish. The rare path: a
   builder should not sit in this; use status.mjs at a natural point instead.
   For the orchestrator or a script that truly has nothing else to do.

     node tools/testbus/wait.mjs <id> [<id>...] [--timeout 1800]   (seconds)
   Exit as status.mjs; 2 on timeout. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, resultPath, sleep } from "./lib.mjs";

const argv = process.argv.slice(2);
const ti = argv.indexOf("--timeout");
const limit = (ti >= 0 ? +argv[ti + 1] : 1800) * 1000;
const ids = argv.filter((a, i) => !a.startsWith("--") && i !== ti + 1);
if (!ids.length) { console.log("usage: wait.mjs <id>... [--timeout s]"); process.exit(2); }
const done = (id) => ["pass", "fail", "blocked", "conflict", "error"].includes((readJson(resultPath(id)) || {}).status);
const t0 = Date.now();
while (!ids.every(done) && Date.now() - t0 < limit) await sleep(2000);
const st = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "status.mjs"), ...ids], { stdio: "inherit" });
process.exit(ids.every(done) ? st.status : 2);
