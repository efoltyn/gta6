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

  let ready = false;
  if (fs.existsSync(path.join(dir, ".git"))) {
    try {
      const at = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      if (at === sha) ready = true;
      else { execFileSync("git", ["-C", dir, "checkout", "--detach", sha], { stdio: "ignore" }); ready = true; }
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

   So: if the only uncommitted files are the ones this preset says it owns,
   BEFORE is pristine HEAD — the strongest claim available. If anything else is
   in flight, BEFORE becomes THE SAME BUILD with the law under test switched
   off through its CONFIG flag (the preset's beforeParams), which is the
   stronger claim anyway for a behaviour change: the two columns then differ by
   exactly one boolean instead of by every commit and every neighbour's edit.

     launchSides(ctx) { return baselineBuild(ctx, { owned: [...], flag: "GORE_SWASH" }); }

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
