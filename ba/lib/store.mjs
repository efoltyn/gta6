// The drawer registry and the receipt archive. All state lives under
// <projectRoot>/.ba/ :
//
//   .ba/drawers.json          the registry: one record per open drawer
//   .ba/receipts/<slug>/<stamp>/   the archive: a full copy of a report dir
//   .ba/worktrees/<slug>/     the drawer's checkout (git-ignored, see below)
//   .ba/prompts/<slug>.txt    the opening prompt handed to the agent
//   .ba/.gitignore            written by ensureBaDir()
//
// Why an archive exists at all: report dirs land in the project's `out` dir,
// which is git-ignored in every project that has ever used this tool (in the
// repo this was extracted from, `artifacts/visual-comparisons/`). That means a
// fresh clone of a repo with a year of daily before/after runs contains zero
// receipts — the entire evidentiary record lives on one machine and gets
// overwritten run by run. Archiving copies the run somewhere durable and
// keyed by the PROBLEM (the slug), not by the preset that happened to
// photograph it, so the history reads as "what did this drawer do" rather than
// "what ran on Tuesday".
//
// Copy, never move: the agent may still be looking at the run in `out`, and a
// receipt is a record — taking the original away to file it is how you end up
// with neither.

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_OUT = path.join("artifacts", "visual-comparisons");

// Run dirs are named `<presetId>-<safeStamp>`, where safeStamp is an ISO
// timestamp with `:` and `.` beaten into `-`. Same shape is used for archive
// dir names, which is what makes them sort chronologically as plain strings.
const SAFE_STAMP_RE = /(\d{4}-\d{2}-\d{2}T[\dZ-]+)$/;

const GITIGNORE = `# Managed by \`ba\`. The first rule is the one that matters.
#
# A worktree is a full second checkout of this repository. Committing one would
# commit the repo into itself, and a drawer is disposable by design — \`ba drop\`
# deletes the worktree and nothing else is lost. Never tracked.
worktrees/

# Deliberately NOT ignored: receipts/. The omission IS the feature. Before/after
# reports land in the project's out dir, which is git-ignored everywhere, so the
# record of what the agents actually did has always died on one machine. The
# archive under receipts/ is the durable copy; whether to commit it is the
# owner's call to make, so this file does not make it for them.

# drawers.json and prompts/ are live machine state (absolute paths to worktrees
# on this box). Add them here locally if a committed .ba/ gets noisy.
`;

/** Every path under .ba/, derived from the project root. */
export function baPaths(root) {
  const baDir = path.join(root, ".ba");
  return {
    baDir,
    drawersFile: path.join(baDir, "drawers.json"),
    receiptsDir: path.join(baDir, "receipts"),
    worktreesDir: path.join(baDir, "worktrees"),
    promptsDir: path.join(baDir, "prompts"),
    gitignoreFile: path.join(baDir, ".gitignore"),
  };
}

/**
 * Create .ba/ and make sure its .gitignore is present and still ignores
 * worktrees/. Self-healing rather than write-once: a hand-edited .gitignore
 * that lost the worktrees/ rule would silently offer a second checkout of the
 * repo up for commit, so the rule gets appended back.
 */
export async function ensureBaDir(root) {
  const p = baPaths(root);
  await fs.mkdir(p.baDir, { recursive: true });
  let existing = null;
  try {
    existing = await fs.readFile(p.gitignoreFile, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  if (existing === null) {
    await fs.writeFile(p.gitignoreFile, GITIGNORE);
  } else if (!existing.split(/\r?\n/).some((line) => line.trim() === "worktrees/")) {
    const sep = existing.endsWith("\n") ? "" : "\n";
    await fs.appendFile(p.gitignoreFile, `${sep}\n# re-added by ba: worktrees are never committed\nworktrees/\n`);
  }
  return p;
}

/**
 * Read the drawer registry. Missing file is an empty cabinet, not an error.
 *
 * Corrupt JSON, however, throws loudly: silently returning [] would let the
 * next saveDrawers() overwrite a registry that still points at live worktrees,
 * which is the one way this tool could lose someone's work.
 */
export async function loadDrawers(root) {
  const { drawersFile } = baPaths(root);
  let raw;
  try {
    raw = await fs.readFile(drawersFile, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${drawersFile} is not valid JSON (${err.message}). Refusing to continue — ` +
      `fix or move the file; it is the only record of which worktrees are open.`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${drawersFile} must contain a JSON array of drawers`);
  }
  return parsed.map((d) => normalizeDrawer(root, d)).filter(Boolean);
}

/**
 * Write the drawer registry. Written to a temp file and renamed, so a crash
 * mid-write leaves the previous registry intact rather than a truncated one.
 */
export async function saveDrawers(root, list) {
  if (!Array.isArray(list)) throw new Error("saveDrawers(root, list): list must be an array");
  const { drawersFile } = await ensureBaDir(root);
  const tmp = `${drawersFile}.tmp-${process.pid}`;
  await fs.writeFile(tmp, `${JSON.stringify(list, null, 2)}\n`);
  await fs.rename(tmp, drawersFile);
  return drawersFile;
}

function normalizeDrawer(root, d) {
  if (!d || typeof d !== "object" || !d.slug) return null;
  // Worktrees are stored absolute (they are live paths on this machine), but a
  // hand-written or copied registry may hold a repo-relative path. Resolve
  // either shape so every consumer can just use drawer.worktree.
  const worktree = d.worktree
    ? (path.isAbsolute(d.worktree) ? d.worktree : path.resolve(root, d.worktree))
    : path.join(root, ".ba", "worktrees", d.slug);
  return { ...d, worktree };
}

/**
 * Copy a finished report dir into the drawer's archive.
 *
 * The archive dir is named for the run's own generatedAt, not for the moment
 * of filing, which makes archiving idempotent: filing the same run twice is a
 * no-op that returns the existing path instead of growing a duplicate. Copy
 * goes to a scratch dir and is renamed into place, so "the archive dir exists"
 * always means "the copy finished" — latestReceipt() relies on that.
 *
 * Returns the absolute path of the archived dir.
 */
export async function archiveReceipt(root, slug, reportDir) {
  if (!slug) throw new Error("archiveReceipt(root, slug, reportDir): slug is required");
  const src = path.resolve(reportDir ?? "");
  let stat;
  try {
    stat = await fs.stat(src);
  } catch (err) {
    if (err.code === "ENOENT") throw new Error(`no such report dir: ${src}`);
    throw err;
  }
  if (!stat.isDirectory()) throw new Error(`not a report dir: ${src}`);

  const meta = await readReceiptMeta(src);
  const stamp = safeStamp(meta?.generatedAt) || stampFromDirName(src) || safeStamp(new Date());

  const { receiptsDir } = await ensureBaDir(root);
  const drawerDir = path.join(receiptsDir, slug);
  await fs.mkdir(drawerDir, { recursive: true });

  const target = path.join(drawerDir, stamp);
  if (await exists(target)) return target; // same run, already filed

  const scratch = path.join(drawerDir, `.partial-${stamp}-${process.pid}`);
  await fs.rm(scratch, { recursive: true, force: true });
  await fs.cp(src, scratch, { recursive: true });
  // Provenance the copy would otherwise lose: which drawer filed this, when,
  // and where it came from. Matters most once receipts/ is committed and read
  // by someone who never saw the machine that produced it.
  await fs.writeFile(
    path.join(scratch, "ba-archive.json"),
    `${JSON.stringify({ slug, archivedAt: new Date().toISOString(), sourceDir: src, preset: meta?.presetId ?? null }, null, 2)}\n`,
  );
  try {
    await fs.rename(scratch, target);
  } catch (err) {
    // Lost a race with a concurrent archive of the same run: theirs is just as
    // good as ours, so drop the scratch copy and use it.
    await fs.rm(scratch, { recursive: true, force: true });
    if (!(await exists(target))) throw err;
  }
  return target;
}

/**
 * Newest archived metadata.json path for a drawer, or null.
 *
 * Archive dir names are safe-ISO stamps, so a plain descending string sort is
 * a chronological sort. Dirs without a metadata.json are skipped rather than
 * reported: an archive that cannot answer "which preset, when" is not a
 * receipt yet.
 */
export async function latestReceipt(root, slug) {
  const dir = path.join(baPaths(root).receiptsDir, slug);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const stamps = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort()
    .reverse();
  for (const name of stamps) {
    const metaPath = path.join(dir, name, "metadata.json");
    if (await exists(metaPath)) return metaPath;
  }
  return null;
}

/**
 * Newest *unfiled* run dir for a drawer under config.out, or null.
 *
 * Attribution works because a task IS a worktree: the agent runs the tool
 * inside its own checkout, so its reports land under that worktree's out dir
 * and belong to nobody else. config.out is therefore re-anchored onto the
 * drawer's worktree — including when the caller already resolved it to an
 * absolute path inside the project.
 *
 * `root` is optional; it falls back to config.projectRoot / config.root / cwd
 * so the documented two-argument call still works.
 */
export async function latestRunFor(config, slug, root = null) {
  const projectRoot = root || config?.projectRoot || config?.root || process.cwd();
  const drawers = await loadDrawers(projectRoot);
  const drawer = drawers.find((d) => d.slug === slug) || null;
  const outDir = outDirFor(config, projectRoot, drawer);

  let entries;
  try {
    entries = await fs.readdir(outDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return null;
    throw err;
  }
  const runs = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const dir = path.join(outDir, e.name);
    // A run without metadata.json is still being written; it is not a receipt
    // yet and must not be reported as one waiting to be filed.
    if (!(await exists(path.join(dir, "metadata.json")))) continue;
    const meta = await readReceiptMeta(dir);
    runs.push({ dir, at: meta?.generatedAtMs ?? stampMs(stampFromDirName(dir)) ?? 0 });
  }
  if (runs.length === 0) return null;
  runs.sort((a, b) => a.at - b.at || (a.dir < b.dir ? -1 : 1));
  return runs.at(-1).dir;
}

/** Where a given drawer's runs land. Exported because `ls` prints it on error paths. */
export function outDirFor(config, root, drawer = null) {
  const out = config?.out || DEFAULT_OUT;
  let rel = out;
  if (path.isAbsolute(out)) {
    const r = path.relative(root, out);
    // An absolute out dir pointing outside the project is a shared drop box:
    // it cannot be re-anchored per worktree, so every drawer sees the same
    // runs. Use it as-is rather than inventing an attribution that isn't there.
    if (r === "" || r.startsWith("..")) return out;
    rel = r;
  }
  return path.join(drawer?.worktree || root, rel);
}

/**
 * Read a run's metadata.json. Accepts either the file path or its dir.
 * Returns null for anything unreadable — a board must not die on one bad run.
 */
export async function readReceiptMeta(metadataPathOrDir) {
  if (!metadataPathOrDir) return null;
  let file = metadataPathOrDir;
  try {
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, "metadata.json");
  } catch {
    return null;
  }
  let meta;
  try {
    meta = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
  const generatedAt = typeof meta?.generatedAt === "string" ? meta.generatedAt : null;
  const ms = generatedAt ? Date.parse(generatedAt) : NaN;
  return {
    path: file,
    dir: path.dirname(file),
    presetId: meta?.preset?.id ?? null,
    presetTitle: meta?.preset?.title ?? null,
    generatedAt,
    generatedAtMs: Number.isNaN(ms) ? (stampMs(stampFromDirName(path.dirname(file))) ?? null) : ms,
  };
}

/** ISO timestamp with `:` and `.` replaced by `-`, matching the engine's run dirs. */
export function safeStamp(when) {
  if (!when) return null;
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/[:.]/g, "-");
}

function stampFromDirName(dir) {
  return path.basename(dir).match(SAFE_STAMP_RE)?.[1] ?? null;
}

/** Parse a safe stamp back into epoch ms, or null. */
export function stampMs(stamp) {
  if (!stamp) return null;
  // 2026-08-19T23-52-03-502Z -> 2026-08-19T23:52:03.502Z
  const iso = stamp.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{1,3})Z$/,
    (_, d, h, m, s, ms) => `${d}T${h}:${m}:${s}.${ms.padStart(3, "0")}Z`,
  );
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
