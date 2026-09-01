/* tools/visual-presets/lib/pristine-head.mjs — A FLAGLESS BEFORE.

   THE PROBLEM THIS SOLVES. ba's web adapter has two honest baselines: a
   deployed URL (which differs from your work by every commit since the
   deploy) and `--before local` with a per-side query flag (which differs by
   exactly the change under test — but only if the change HAS a flag). This
   repo's standing rule is that a behaviour change does NOT get a flag: "git
   is the undo", and a flag on a design decision is a second version of the
   game nobody ever photographs. That left the flagless waves with no before.

   ba grew `preset.launchSides(ctx)` for exactly this and its own comment
   notes that none of gta6's presets had used it. This is the missing forty
   lines: a DETACHED git worktree of HEAD, served on a free port by python3's
   own static server, torn down afterwards.

   WHY A FRESH mkdtemp EVERY RUN, and it is not tidiness. A reused baseline
   directory is a trap this repo has already fallen into once — a build step
   wrote into the "pristine" worktree and the before column quietly became the
   after. A directory that did not exist ten seconds ago cannot be dirty.

   USE:
     import { pristineHead } from "./lib/pristine-head.mjs";
     export default { ..., launchSides: pristineHead };
*/
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on("error", reject);
  });
}

export async function pristineHead(ctx) {
  const dir = mkdtempSync(join(tmpdir(), "ba-pristine-head-"));
  const wt = join(dir, "head");
  /* --detach so this never claims a branch name another session might want,
     and HEAD rather than a ref so the baseline is whatever this checkout is
     actually built on top of right now. */
  execFileSync("git", ["worktree", "add", "--detach", wt, "HEAD"],
    { cwd: ctx.repoRoot, stdio: "pipe" });
  const port = await freePort();
  const srv = spawn("python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", wt],
    { stdio: "ignore" });
  const url = `http://127.0.0.1:${port}/`;
  const end = Date.now() + 20000;
  for (;;) {
    try { if ((await fetch(url, { method: "HEAD" })).ok) break; } catch (_) {}
    if (Date.now() > end) {
      try { srv.kill("SIGKILL"); } catch (_) {}
      throw new Error("the pristine HEAD worktree server never answered at " + url);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ctx.repoRoot })
    .toString().trim();
  return {
    before: url,
    label: `pristine worktree of HEAD (${sha}) vs the working tree`,
    async close() {
      try { srv.kill("SIGKILL"); } catch (_) {}
      try { execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: ctx.repoRoot, stdio: "pipe" }); } catch (_) {}
      try { rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    },
  };
}
