#!/usr/bin/env node
/* tools/ba-head.mjs — BEFORE/AFTER WHEN THE CHANGE HAS NO FLAG.

       node tools/ba-head.mjs volcano-stages --subjects ash-onset,ash-aftermath
       npm run ba:head -- volcano-stages

   THE GAP THIS FILLS. tools/before-after.mjs can compare this checkout against
   the deployed build, or against ITSELF with a cfg_* flag flipped off. Both
   are real answers and neither one fits a DELETION: the deployed build is
   every commit since the last deploy, and you cannot flip a flag off a feature
   whose code is gone. The right baseline for "I removed a thing" is pristine
   HEAD served on its own port — which tools/ba-lib/head-build.mjs has done for
   a while, except it only ever ran through `preset.launchSides()`, a hook that
   lives in the external `ba` harness. Anyone working inside this repo alone
   could not reach it. This is the twenty lines that connect the two.

   WHAT IT DOES. Checks out HEAD (detached) into a reused scratch worktree,
   serves it on a free port, and runs tools/before-after.mjs with that port as
   --before. Everything else — preset, subjects, devices, --gate — passes
   straight through. The server is torn down on the way out, including on ^C.

   AND IT REPLAYS THE NEIGHBOURS. This checkout is shared; other agents have
   half-finished work in it at any moment. baselineBuild() copies every
   uncommitted edit this run does NOT own into the HEAD worktree, so the two
   columns differ by exactly the files you name with --owned and nothing else.
   Without --owned you get plain HEAD, which is right when the tree is clean
   and a report about everybody's afternoon when it is not — so it says out
   loud which baseline it got, every run.  */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { baselineBuild } from "./ba-lib/head-build.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);

if (!argv.length || argv[0] === "--help" || argv[0] === "help") {
  process.stdout.write(
    "before/after against pristine HEAD (for changes with no config flag)\n\n" +
    "  node tools/ba-head.mjs <preset> [--owned a.js,b.js] [before-after flags]\n\n" +
    "  --owned a,b   repo-relative paths THIS change owns. Every other\n" +
    "                uncommitted edit in the tree is replayed into the HEAD\n" +
    "                worktree, so the columns differ by your files alone.\n" +
    "  everything else passes through to tools/before-after.mjs\n"
  );
  process.exit(0);
}

const ownedIx = argv.indexOf("--owned");
const owned = ownedIx >= 0 && argv[ownedIx + 1]
  ? argv[ownedIx + 1].split(",").map((s) => s.trim()).filter(Boolean)
  : [];
const rest = ownedIx >= 0 ? argv.filter((_, i) => i !== ownedIx && i !== ownedIx + 1) : argv;

if (rest.includes("--before")) {
  process.stderr.write("ba-head: --before is what this tool is FOR; drop it or use before-after.mjs directly\n");
  process.exit(2);
}

const sides = await baselineBuild({ repoRoot: ROOT, log: (s) => process.stdout.write(s + "\n") }, { owned });

let closed = false;
const close = async () => { if (closed) return; closed = true; try { await sides.close(); } catch (_) {} };
process.on("SIGINT", async () => { await close(); process.exit(130); });
process.on("SIGTERM", async () => { await close(); process.exit(143); });

const child = spawn(process.execPath, [
  path.join(ROOT, "tools", "before-after.mjs"),
  ...rest,
  "--before", sides.before,
], { cwd: ROOT, stdio: "inherit" });

const code = await new Promise((resolve) => child.on("exit", (c) => resolve(c == null ? 1 : c)));
await close();
process.exit(code);
