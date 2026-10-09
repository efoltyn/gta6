/* tools/testbus/tree.mjs — integration trees without touching anybody's branch.

   Merging happens in the OBJECT STORE: `git merge-tree --write-tree` + `git
   commit-tree` build origin/main + branch A + branch B ... as a chain of real
   merge commits that no ref points at. No checkout, no index, no lock, and it
   takes milliseconds, so a conflict probe or a bisect subset costs nothing.
   Only the tree a check actually runs in is checked out, into a persistent
   slot worktree under $BUS/trees/<slot> (`git checkout --detach -f`, so only
   the files that differ are rewritten). */
import { execFileSync } from "node:child_process";
import { existsSync, symlinkSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import { DIRS, git, gitOk, mainRepo } from "./lib.mjs";

const ENV = { ...process.env, GIT_AUTHOR_NAME: "testbus", GIT_AUTHOR_EMAIL: "testbus@localhost",
  GIT_COMMITTER_NAME: "testbus", GIT_COMMITTER_EMAIL: "testbus@localhost" };
let REPO = null;
export const repo = () => (REPO || (REPO = mainRepo()));

export function fetchMain() {
  gitOk(["fetch", "-q", "origin", "main"], repo());
  return git(["rev-parse", "origin/main"], repo());
}

/* merge2(a, b) -> { ok, commit } | { ok:false, files[] } */
export function merge2(a, b, label) {
  let out, code = 0;
  try {
    out = execFileSync("git", ["merge-tree", "--write-tree", "--name-only", "--no-messages", a, b],
      { cwd: repo(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: ENV });
  } catch (e) { out = String(e.stdout || ""); code = e.status || 1; if (!out) throw e; }
  const lines = out.trim().split("\n");
  if (code !== 0) return { ok: false, files: lines.slice(1).filter(Boolean) };
  const tree = lines[0].trim();
  const commit = execFileSync("git", ["commit-tree", tree, "-p", a, "-p", b, "-m", `testbus: merge ${label || b}`],
    { cwd: repo(), encoding: "utf8", env: ENV }).trim();
  return { ok: true, commit };
}

/* integrate(base, reqs) -> { head, merged[], conflicts[{ req, files, with[] }] }
   Requests merge in submit order. A request that conflicts is left out (the
   rest of the batch goes on) and the branches it collides with are named. */
export function integrate(base, reqs) {
  let head = base; const merged = [], conflicts = [];
  for (const r of reqs) {
    const m = merge2(head, r.commit, r.branch);
    if (m.ok) { head = m.commit; merged.push(r); continue; }
    const alone = merge2(base, r.commit, r.branch);
    if (!alone.ok) { conflicts.push({ req: r, files: alone.files, with: ["origin/main"] }); continue; }
    const w = [];
    for (const o of merged) {
      const mo = merge2(base, o.commit, o.branch);
      if (mo.ok && !merge2(mo.commit, r.commit, r.branch).ok) w.push(o.branch);
    }
    conflicts.push({ req: r, files: m.files, with: w.length ? w : merged.map((o) => o.branch) });
  }
  return { head, merged, conflicts };
}

/* chain(base, reqs) -> the commit of base + reqs merged in order (must merge clean) */
export function chain(base, reqs) {
  let head = base;
  for (const r of reqs) { const m = merge2(head, r.commit, r.branch); if (!m.ok) return null; head = m.commit; }
  return head;
}

/* checkout(slot, commit) -> dir. node_modules is linked from the main checkout
   (worktrees have none and a few tools need it). */
export function checkout(slot, commit) {
  const dir = path.join(DIRS.trees, slot);
  if (!existsSync(path.join(dir, ".git"))) {
    rmSync(dir, { recursive: true, force: true });
    gitOk(["worktree", "prune"], repo());
    git(["worktree", "add", "--detach", "-f", dir, commit], repo());
  } else {
    git(["checkout", "--detach", "-f", "-q", commit], dir);
    gitOk(["clean", "-fdq", "-e", "node_modules"], dir);
  }
  const nm = path.join(repo(), "node_modules");
  if (existsSync(nm) && !existsSync(path.join(dir, "node_modules"))) { try { symlinkSync(nm, path.join(dir, "node_modules")); } catch (_) {} }
  return dir;
}

export function dropSlots() {
  for (const s of readdirSync(DIRS.trees)) {
    const dir = path.join(DIRS.trees, s);
    if (existsSync(dir)) { gitOk(["worktree", "remove", "--force", dir], repo()); rmSync(dir, { recursive: true, force: true }); }
  }
  gitOk(["worktree", "prune"], repo());
}

export function changedFiles(a, b) {
  if (!a || !b || a === b) return [];
  const r = gitOk(["diff", "--name-only", a, b], repo());
  return r.ok ? r.out.split("\n").filter(Boolean) : null;
}
