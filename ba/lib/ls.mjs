// `ba ls [--json]` — the board.
//
// One line per drawer. The columns are chosen so the board answers the only
// two questions worth asking about twenty terminal tabs: is this one still
// working, and has it produced evidence yet.
//
//   slug · agent · branch · window · <preset> · <age>  [· unarchived run]
//
// Note what is deliberately NOT here: the diff. Every other agent-management
// surface shows the diff, because the diff is what version control hands it
// for free. The unit here is the receipt — what changed in the world, not what
// changed in the text. The diff is one level deeper, for the rare descent.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadDrawers, latestReceipt, latestRunFor, readReceiptMeta } from "./store.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_SESSION = "ba";

/**
 * The CLI verb. Returns an EXIT CODE — bin/ba.mjs passes this to
 * process.exit(), which rejects anything that is not a number. The rows
 * themselves come from board() below, for other verbs and for tests.
 */
export default async function lsCommand(argv = [], ctx = {}) {
  try {
    if (argv.includes("--help") || argv.includes("-h")) {
      console.log("ba ls [--json]\n\nThe board: one line per drawer, with its newest receipt.");
      return 0;
    }
    const rows = await board(ctx);
    if (argv.includes("--json")) {
      console.log(JSON.stringify(rows, null, 2));
    } else if (rows.length === 0) {
      console.log('no drawers yet — ba new "<problem statement>"');
    } else {
      for (const line of render(rows)) console.log(line);
    }
    return 0;
  } catch (err) {
    process.stderr.write(`ba ls: ${err?.message || err}\n`);
    if (process.env.BA_DEBUG) process.stderr.write(`${err?.stack || ""}\n`);
    return 1;
  }
}

/** One row per drawer, with its live-ness and its newest receipt. */
export async function board(ctx = {}) {
  const root = ctx.projectRoot || process.cwd();
  const config = ctx.config || {};
  const session = config.tmuxSession || DEFAULT_SESSION;

  const drawers = await loadDrawers(root);
  const live = await liveWindowIds(session);

  const rows = [];
  for (const drawer of drawers) {
    const receiptPath = await latestReceipt(root, drawer.slug);
    const receipt = receiptPath ? await readReceiptMeta(receiptPath) : null;

    // A run newer than the newest archived receipt means the agent produced
    // evidence that only exists in the project's out dir — which is git-ignored
    // in every project this tool has ever run in, so it is one `git clean` away
    // from never having happened. Worth a word on the board.
    const runDir = await latestRunFor(config, drawer.slug, root);
    const run = runDir ? await readReceiptMeta(runDir) : null;
    const unarchived = run && (!receipt || (run.generatedAtMs ?? 0) > (receipt.generatedAtMs ?? 0))
      ? run.dir
      : null;

    rows.push({
      slug: drawer.slug,
      problem: drawer.problem ?? null,
      agent: drawer.agent ?? "?",
      branch: drawer.branch ?? "?",
      worktree: drawer.worktree,
      tmux: drawer.tmux ?? null,
      createdAt: drawer.createdAt ?? null,
      window: windowState(drawer, live),
      receipt: receipt && {
        preset: receipt.presetId,
        generatedAt: receipt.generatedAt,
        path: receipt.path,
        dir: receipt.dir,
      },
      unarchivedRun: unarchived,
    });
  }

  return rows;
}

/** Rows -> board lines. Columns are padded to the widest cell so slugs align. */
export function render(rows, now = Date.now()) {
  const w = (key) => Math.max(...rows.map((r) => String(r[key]).length));
  const widths = { slug: w("slug"), agent: w("agent"), branch: w("branch"), window: w("window") };
  return rows.map((r) => {
    const receipt = r.receipt
      ? `${r.receipt.preset || "receipt"} · ${ago(now - Date.parse(r.receipt.generatedAt ?? ""))}`
      : "no receipt yet";
    const cells = [
      r.slug.padEnd(widths.slug),
      r.agent.padEnd(widths.agent),
      r.branch.padEnd(widths.branch),
      r.window.padEnd(widths.window),
      receipt,
    ];
    if (r.unarchivedRun) cells.push("unarchived run");
    return cells.join(" · ");
  });
}

function windowState(drawer, live) {
  if (!drawer.tmux) return "detached"; // opened with --no-tmux, or tmux wiring failed
  if (live === null) return "no tmux";
  // tmux destroys a window when its process exits, so window presence is a
  // good proxy for "the agent is still sitting there". A window kept alive by
  // remain-on-exit would read live with a dead pane; that is rare enough to
  // not be worth a second tmux call per drawer.
  return live.has(drawer.tmux) ? "live" : "gone";
}

/**
 * Window ids in the session, or null when tmux itself is absent.
 * A missing session is an empty set, not null: tmux works, the drawers are
 * just gone.
 */
async function liveWindowIds(session) {
  try {
    const { stdout } = await execFileAsync(
      "tmux",
      ["list-windows", "-t", session, "-F", "#{window_id}"],
      { maxBuffer: 1024 * 1024 },
    );
    return new Set(stdout.split("\n").map((s) => s.trim()).filter(Boolean));
  } catch (err) {
    if (err?.code === "ENOENT") return null; // no tmux binary on this machine
    return new Set(); // session does not exist
  }
}

function ago(ms) {
  if (!Number.isFinite(ms)) return "unknown";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
