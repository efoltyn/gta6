/* tools/ba-lib/head-build.mjs — THE BEFORE SIDE, SERVED BY THE PRESET ITSELF.

   Every "is this change better?" run in this repo needs two builds of the same
   game on two ports: pristine HEAD as BEFORE, the working tree as AFTER. Until
   now that was a HAND-RUN STEP typed in front of a tool whose whole promise is
   one word — start a worktree, start a server, remember the port, pass
   --before. The next person forgets, starts one side, and photographs a build
   against itself.

   ba's web adapter has an opt-in for exactly this (`preset.launchSides(ctx)`,
   see harness/ba/adapters/web.mjs). This is the gta6 implementation of it:

       import { headBuild } from "../ba-lib/head-build.mjs";
       export default {
         ...,
         async launchSides(ctx) { return headBuild(ctx); },
       };

   and `ba <preset>` then photographs HEAD against the working tree with no
   flags at all. An explicit --before still wins; this is the default, not a
   cage.

   NO DEPENDENCIES ON HARNESS INTERNALS. The static server here is thirty lines
   of node:http rather than an import out of the harness lib, because a preset
   that reaches into another tool's private modules breaks the next time that
   tool is refactored — and this file has to keep working when it does.

   THE WORKTREE IS REUSED, NOT REBUILT. `git worktree add` on this repo takes
   seconds and a wave of presets would pay it each time, so the checkout lives
   at a stable path keyed to the repo and is only re-pointed when HEAD moves.
   It is left in place on purpose: `git worktree list` shows it, `git worktree
   remove` kills it, and the next run is instant. */

import http from "node:http";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".wasm": "application/wasm",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".txt": "text/plain; charset=utf-8",
};

function freePort(base) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(base || 0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

export function serveStatic(root, port) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(String(req.url || "/").split("?")[0].split("#")[0]);
    if (rel.endsWith("/")) rel += "index.html";
    // never serve outside the root — a "../" in a URL is not a mistake worth honouring
    const file = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(root)) { res.writeHead(403).end("no"); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end("not found"); return; }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

/* Check out HEAD (detached) into a stable scratch worktree and serve it.
   Returns the shape ba's web adapter wants back from launchSides(). */
export async function headBuild(ctx) {
  const repoRoot = ctx && ctx.repoRoot ? ctx.repoRoot : process.cwd();
  const log = (ctx && ctx.log) || ((s) => process.stdout.write(s + "\n"));
  const git = (...a) => execFileSync("git", ["-C", repoRoot, ...a], { encoding: "utf8" }).trim();

  const sha = git("rev-parse", "HEAD");
  const dir = path.join(os.tmpdir(), `ba-head-${path.basename(repoRoot)}`);

  /* PRISTINE MEANS PRISTINE, EVERY RUN.
     HARNESS TRAP (2026-08-29, cost two full ba runs to find): this worktree is
     REUSED, and baselineBuild below now WRITES INTO IT (it replays the
     neighbours' uncommitted edits). The old code only re-pointed the worktree
     when HEAD had moved, so a second run on the same commit inherited whatever
     the first run had left lying there. What that produced was the worst
     possible failure: run 2's replay refused to apply on top of run 1's, the
     code fell back to "BEFORE is pristine HEAD" and SAID SO IN THE LOG, and
     the build it served was neither — it was HEAD plus a neighbour's
     half-finished edit, snapshotted mid-keystroke, which did not even parse.
     The report blamed the browser.
     So: reset --hard and clean every time. It costs milliseconds on a clean
     tree and it makes the label on the column true. */
  let ready = false;
  if (fs.existsSync(path.join(dir, ".git"))) {
    try {
      execFileSync("git", ["-C", dir, "checkout", "--detach", sha], { stdio: "ignore" });
      execFileSync("git", ["-C", dir, "reset", "--hard", sha], { stdio: "ignore" });
      execFileSync("git", ["-C", dir, "clean", "-fdq"], { stdio: "ignore" });
      ready = true;
    } catch (_) { ready = false; }
  }
  if (!ready) {
    try { git("worktree", "remove", "--force", dir); } catch (_) {}
    fs.rmSync(dir, { recursive: true, force: true });
    git("worktree", "add", "--detach", dir, sha);
  }

  const port = await freePort(0);
  const server = await serveStatic(dir, port);
  log(`[head-build] BEFORE = HEAD ${sha.slice(0, 7)} served from ${dir} on :${port}`);
  return {
    before: `http://127.0.0.1:${port}/`,
    label: `HEAD ${sha.slice(0, 7)} vs working tree`,
    async close() { await new Promise((r) => server.close(r)); },
  };
}

export default headBuild;

/* A FAIR BASELINE, WHICHEVER ONE THAT IS TODAY.

   `headBuild` above compares HEAD against the working tree, which is the right
   answer when the working tree differs from HEAD only by the change under
   test. This checkout is shared: at any moment two or three other agents have
   their own half-finished work sitting in it (measured while writing this —
   sixteen modified files across five subsystems nobody in this run had
   touched). Photographing HEAD against that is not a report about one change,
   it is a report about everybody's afternoon.

   So there are three baselines, in descending order of strength, and the
   function picks the best one the checkout can actually offer today:

     1. NOTHING ELSE IN FLIGHT -> pristine HEAD. The strongest claim available.
     2. NEIGHBOURS IN FLIGHT   -> HEAD with every un-owned uncommitted edit
        REPLAYED into the scratch worktree. The two columns then differ by
        exactly the files this run owns, which is a HEAD-quality diff of one
        change on a checkout three other agents are writing to. No flag needed.
     3. THE REPLAY FAILED      -> THE SAME BUILD with the law under test
        switched off through its CONFIG flag (the preset's beforeParams).

     launchSides(ctx) { return baselineBuild(ctx, { owned: [...], flag: "GORE_SWASH" }); }

   `flag` is now only the LAST-DITCH baseline, so a preset that has no flag can
   simply omit it and still get (1) or (2).

   Either way the run says out loud which baseline it got, so nobody reads a
   flag A/B as a HEAD diff or the reverse. */
export async function baselineBuild(ctx, opts) {
  const repoRoot = ctx && ctx.repoRoot ? ctx.repoRoot : process.cwd();
  const log = (ctx && ctx.log) || ((s) => process.stdout.write(s + "\n"));
  const owned = new Set(((opts && opts.owned) || []).map((p) => p.replace(/^\.\//, "")));

  let foreign = [];
  try {
    const porcelain = execFileSync("git", ["-C", repoRoot, "status", "--porcelain"], { encoding: "utf8" });
    foreign = porcelain.split("\n").map((line) => line.slice(3).trim())
      .map((p) => (p.includes(" -> ") ? p.split(" -> ")[1] : p))
      .filter((p) => p && !owned.has(p));
  } catch (_) { foreign = ["<git unavailable>"]; }

  if (!foreign.length) return headBuild(ctx);

  /* THE NEIGHBOURS' WORK IS PART OF THE BASELINE, NOT PART OF THE CHANGE.
     (2026-08-29.) The flag fallback below is a real answer, but it is the
     SECOND-best one and it forces every wave to grow a config flag it does not
     want, purely so a tool can find a baseline. There is a better baseline
     available for free: HEAD, plus every uncommitted edit this run does NOT
     own, replayed into the scratch worktree. BEFORE and AFTER then differ by
     exactly the owned files — a true HEAD-quality diff of ONE change, on a
     checkout three other agents are writing to.

     `git diff HEAD -- <paths>` carries staged and unstaged together, so one
     patch is the whole of a tracked neighbour's edit. Untracked neighbours are
     copied in whole (there is no diff to apply). If ANY of that fails — a
     binary patch, a file deleted underneath us, a rename — we do not guess: we
     fall through to the flag baseline and say so, because a half-applied
     neighbour is a worse lie than an honest flag A/B. */
  if (!opts || opts.replayForeign !== false) {
    try {
      const side = await headBuild(ctx);          // resets the worktree first
      const dir = path.join(os.tmpdir(), `ba-head-${path.basename(repoRoot)}`);
      /* COPY, DO NOT PATCH. The first shape of this used `git diff HEAD
         --binary | git apply`, which is elegant and which fell over on the
         first run that met a modified JPEG. A patch has to be understood; a
         file only has to be copied. Copying is also the only thing that
         survives a neighbour renaming, deleting, or half-writing a file
         between the status call and the read. */
      let copied = 0, removed = 0;
      const porcelain = execFileSync("git", ["-C", repoRoot, "status", "--porcelain"], { encoding: "utf8" });
      for (const line of porcelain.split("\n")) {
        if (!line.trim()) continue;
        let rel = line.slice(3).trim();
        if (rel.includes(" -> ")) rel = rel.split(" -> ")[1];
        rel = rel.replace(/^"|"$/g, "");
        if (!rel || owned.has(rel)) continue;
        const from = path.join(repoRoot, rel), to = path.join(dir, rel);
        if (!fs.existsSync(from)) {                       // the neighbour deleted it
          if (fs.existsSync(to)) { fs.rmSync(to, { force: true }); removed++; }
          continue;
        }
        if (fs.statSync(from).isDirectory()) continue;
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        copied++;
      }
      log(`[baseline] BEFORE = HEAD + ${copied} neighbour edit(s) replayed`
        + (removed ? ` (+${removed} deleted)` : "")
        + `; the two columns differ by exactly ${owned.size} owned file(s)`);
      return { ...side, label: `HEAD + neighbours vs ${owned.size} owned file(s)` };
    } catch (err) {
      const why = ((err && (err.stderr || err.message)) || err).toString().replace(/\s+/g, " ").slice(0, 200);
      log(`[baseline] could not replay the neighbours' edits (${why}) — falling back`);
    }
  }

  /* NO FLAG TO FALL BACK TO. A preset that owns its whole change and refuses a
     config flag (this repo's standing order: git is the undo) has nothing left
     to switch off, so the honest answer is pristine HEAD with the label saying
     out loud that other people's edits are in the diff too. Silently serving
     the same build on both sides would be the one unacceptable outcome. */
  if (!opts || !opts.flag) {
    const side = await headBuild(ctx);
    log(`[baseline] no flag baseline available — BEFORE is pristine HEAD and ${foreign.length} `
      + `neighbour edit(s) are part of the diff: ${foreign.slice(0, 6).join(", ")}`);
    return { ...side, label: `${side.label} (+${foreign.length} foreign edits in the diff)` };
  }

  const port = await freePort(0);
  const server = await serveStatic(repoRoot, port);
  const flag = (opts && opts.flag) || "the flag";
  log(`[baseline] ${foreign.length} uncommitted file(s) in flight that this change does not own `
    + `(${foreign.slice(0, 4).join(", ")}${foreign.length > 4 ? ", …" : ""})`);
  log(`[baseline] BEFORE = this same working tree with ${flag} off, on :${port} — not HEAD`);
  return {
    before: `http://127.0.0.1:${port}/`,
    label: `same build, ${flag} off (${foreign.length} foreign edits in flight)`,
    async close() { await new Promise((r) => server.close(r)); },
  };
}
