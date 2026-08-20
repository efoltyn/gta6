// `ba adopt <window>` — pull a tmux window that is already running somewhere
// into the cabinet, without touching the process inside it.
//
// `ba adopt --reborn "<problem>" [--dir <path>]` — for an agent sitting in a
// plain terminal tab, where the process CANNOT be moved: move the
// CONVERSATION instead, by opening a cabinet window in the same directory and
// resuming the agent's most recent conversation there.
//
// The constraint that produced two verbs instead of one:
//
//   A window belonging to another process cannot be adopted on macOS. There is
//   no cross-process window adoption in the OS, and no reptyr to re-parent a
//   live pty to another terminal. So "pull my loose tabs into the cabinet" has
//   exactly two honest implementations, depending on what the tab is:
//
//     - the tab is a tmux window  -> tmux itself can move it between sessions,
//       process and scrollback intact. That is TRUE adoption. `ba adopt <win>`.
//     - the tab is a bare terminal -> nothing can move that process. What can
//       move is the agent's conversation, which lives in the vendor CLI's own
//       storage keyed by directory. `ba adopt --reborn` opens a fresh window in
//       that directory and resumes. The process is reborn; the thread of work
//       continues. The original tab is left alone for the human to close.
//
// What this file never does: send-keys into an adopted window. A drawer opened
// by `ba new` gets exactly one opening prompt and then silence; a drawer that
// was ALREADY running when ba found it gets not even that. Typing into a live
// agent's pty is puppeting, and it would land in the middle of whatever turn
// that agent is in.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { launchCommand, resumeCommand, isKnownAgent, KNOWN_AGENTS } from "./agents.mjs";
import { slugify } from "./new.mjs";
import { ensureBaDir, loadDrawers, saveDrawers } from "./store.mjs";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SESSION = "ba";

/* Field separator for tmux -F output.

   Not a space, because window_name and pane_current_path both routinely
   contain spaces, and splitting a path on spaces is how you adopt the wrong
   window. And NOT a control character either, which cost a debugging round
   worth writing down: tmux sanitizes its own format output. An ASCII unit
   separator (0x1f) comes back as the four literal characters \037, and a tab
   or a newline comes back as "_". Measured on tmux 3.4. Only printable ASCII
   survives the round trip.

   Which means no separator is collision-proof - someone can name a window
   "a|ba|b". Two things make that safe rather than merely unlikely:

     - window_id is FIRST and is always @<digits>, so it parses correctly no
       matter what the later fields contain.
     - a line that does not split into exactly five fields is never guessed at.
       It keeps its id and is re-read one field per tmux call (repairWindow),
       where there is no separator in play to collide with. */
const SEP = "|ba|";
const LIST_FORMAT = [
  "#{window_id}",
  "#{session_name}",
  "#{window_index}",
  "#{window_name}",
  "#{pane_current_path}",
].join(SEP);

const USAGE = `ba adopt <window> [--problem "<text>"] [--agent <name>]
ba adopt --reborn "<problem>" [--agent ${KNOWN_AGENTS.join("|")}] [--dir <path>] [--worktree]

Pulls an agent that is already running loose into the cabinet.

  <window>         a tmux window already running somewhere: a window id (@7),
                   a session:window spec, or a window name unique across
                   sessions. The window is MOVED into the cabinet session; the
                   process inside it is never touched.

  --reborn         for an agent in a plain terminal tab, whose process cannot
                   be moved: open a cabinet window in --dir and resume that
                   directory's most recent conversation there.
  --dir <path>     directory the loose agent is working in (default: cwd)
  --worktree       also move the work onto a branch ba/<slug>. See the note it
                   prints — a resumed conversation cannot follow into a new
                   directory, so this starts a fresh one.
  --problem <text> what this drawer is for (default: "(adopted) <window name>")
  --agent <name>   which CLI is in there (default: unknown when adopting a
                   window, ${KNOWN_AGENTS[0]} when reborn)
  --no-tmux        prepare and register, print the commands, start nothing`;

/**
 * The CLI verb. Returns an EXIT CODE, because bin/ba.mjs feeds this straight to
 * process.exit() and anything that is not a number crashes the process after
 * the work already succeeded. Programmatic callers want adoptDrawer().
 */
export default async function adoptCommand(argv = [], ctx = {}) {
  try {
    await adoptDrawer(argv, ctx);
    return 0;
  } catch (err) {
    process.stderr.write(`ba adopt: ${err?.message || err}\n`);
    if (process.env.BA_DEBUG) process.stderr.write(`${err?.stack || ""}\n`);
    return 1;
  }
}

/** Adopt something. Returns the drawer record, or null if only help was asked for. */
export async function adoptDrawer(argv = [], ctx = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return null;
  }
  return opts.reborn ? await rebornDrawer(opts, ctx) : await adoptRunningWindow(opts, ctx);
}

// ---------------------------------------------------------------------------
// form 1: true adoption of a live tmux window
// ---------------------------------------------------------------------------

async function adoptRunningWindow(opts, ctx) {
  if (opts.dir || opts.worktree) {
    throw new Error(`--dir and --worktree only apply to --reborn\n\n${USAGE}`);
  }
  if (opts.words.length === 0) throw new Error(`which window?\n\n${USAGE}`);
  if (opts.words.length > 1) {
    // A window spec is one token. More than one usually means an unquoted
    // --problem, and adopting words[0] silently would be the wrong window.
    throw new Error(
      `a window spec is one token, got ${opts.words.length}: ${opts.words.join(" ")}\n` +
      `(quote it, or use --problem "<text>" for the description)\n\n${USAGE}`,
    );
  }
  const spec = opts.words[0];

  if (!(await hasTmux())) {
    throw new Error(
      "adopting a window needs tmux (that is the only thing on this machine that can " +
      `move a running window between sessions).\nFor an agent in a plain terminal tab, use: ba adopt --reborn "<problem>"`,
    );
  }

  const root = ctx.projectRoot || process.cwd();
  const session = (ctx.config || {}).tmuxSession || DEFAULT_SESSION;
  await ensureBaDir(root);

  const windows = await listWindows();
  if (windows.length === 0) throw new Error("tmux is running no windows to adopt");

  let target = resolveWindowSpec(windows, spec);
  // Resolved by id but unparseable in the listing: go get its real fields.
  if (target.garbled) target = await repairWindow(target.id);

  const drawers = await loadDrawers(root);
  // Window ids are unique per tmux server and stable for the window's whole
  // life, so this is an exact "already in the cabinet" test — no name guessing.
  const already = drawers.find((d) => d.tmux && d.tmux === target.id);
  if (already) {
    throw new Error(`${target.id} is already the drawer "${already.slug}" — nothing to adopt`);
  }

  const slug = uniqueSlug(target.name || "adopted", drawers);

  // Where the window is actually sitting. This is the honest worktree for an
  // adopted drawer: nothing was created for it, it was already working here.
  const cwd = target.path || null;
  const branch = cwd ? await gitBranch(cwd) : null;

  // Moving a session's last window destroys that session. Worth saying out
  // loud, because the human may have that session attached in another terminal
  // and is about to watch it disappear.
  //
  // Counted with a fresh id-only listing rather than from `windows` above:
  // window ids never garble, so this count is exact even when some other
  // window on the server has a hostile name.
  const siblings = await countWindows(target.session);
  const emptiesSource = target.session !== session && siblings === 1;

  let moved = false;
  if (target.session === session) {
    // Already in the cabinet. Skip the move: it would succeed but renumber the
    // window for no reason.
  } else {
    await ensureSession(session, root);
    // The window id survives the move (verified on tmux 3.4), which is what
    // makes recording it as drawer.tmux correct — `ba ls` liveness keeps
    // working across the adoption.
    await tmux(["move-window", "-s", target.id, "-t", `${session}:`]);
    moved = true;
  }

  const drawer = {
    slug,
    problem: opts.problem || `(adopted) ${target.name || target.id}`,
    // No validation and no default of "claude": ba did not launch this process
    // and cannot know what is in it. "unknown" is the honest label, and the
    // human can correct it with --agent.
    agent: opts.agent || "unknown",
    branch,
    worktree: cwd,
    tmux: target.id,
    createdAt: new Date().toISOString(),
  };
  drawers.push(drawer);
  await saveDrawers(root, drawers);

  const lines = [
    `adopted ${target.id} → drawer ${drawer.slug}`,
    `problem  ${drawer.problem}`,
    `agent    ${drawer.agent}`,
    `branch   ${drawer.branch || "(not a git checkout)"}`,
    `worktree ${drawer.worktree || "(unknown)"}`,
    moved
      ? `tmux     ${session}:${target.name} (${target.id}) — moved from ${target.session}, process untouched`
      : `tmux     ${session}:${target.name} (${target.id}) — already in the cabinet, left where it was`,
  ];
  if (emptiesSource) lines.push(`note     session "${target.session}" had no other windows and is now gone`);
  lines.push("", `  tmux attach -t ${session}    # then select the ${target.name} window`);
  console.log(lines.join("\n"));
  return drawer;
}

/**
 * Resolve a user's window spec against every window on the tmux server.
 *
 * Three accepted shapes, because these are the three things a human actually
 * has to hand: the id they read out of `ba ls`, the session:window spec tmux
 * itself prints, and the name on the tab.
 *
 * Ambiguity is an error, never a guess. Adopting the wrong window moves a
 * stranger's work into the cabinet and there is no undo that puts the window
 * back where it was with the human none the wiser.
 */
export function resolveWindowSpec(windows, spec) {
  const text = String(spec);
  let matches;

  // A garbled row (its name or path contained the field separator) keeps a
  // trustworthy id and nothing else, so it answers id lookups and is invisible
  // to name and session lookups.
  const named = windows.filter((w) => !w.garbled);

  if (text.startsWith("@")) {
    matches = windows.filter((w) => w.id === text);
  } else if (text.includes(":")) {
    const cut = text.indexOf(":");
    const wantSession = text.slice(0, cut);
    const wantWindow = text.slice(cut + 1);
    const inSession = named.filter((w) => w.session === wantSession);
    // "sess:" with no window part means the session, which is unambiguous only
    // when it holds exactly one window.
    matches = wantWindow === ""
      ? inSession
      : inSession.filter((w) => w.name === wantWindow || w.index === wantWindow);
    // Only if nothing matched do we consider a trailing ".N" to be a pane
    // suffix — window names contain dots (build.sh) more often than people
    // hand-write pane specs.
    if (matches.length === 0 && /\.\d+$/.test(wantWindow)) {
      const noPane = wantWindow.replace(/\.\d+$/, "");
      matches = inSession.filter((w) => w.name === noPane || w.index === noPane);
    }
  } else {
    matches = named.filter((w) => w.name === text);
  }

  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new Error(
      `no tmux window matches "${text}"\n\nwindows on this server:\n${describe(windows)}`,
    );
  }
  throw new Error(
    `"${text}" matches ${matches.length} windows — say which one by id:\n${describe(matches)}`,
  );
}

function describe(windows) {
  return windows
    .map((w) => (w.garbled
      ? `  ${w.id.padEnd(5)} (its name or path contains "${SEP}" — adopt this one by id)`
      : `  ${w.id.padEnd(5)} ${`${w.session}:${w.index}`.padEnd(16)} ${(w.name || "").padEnd(20)} ${w.path || ""}`))
    .join("\n");
}

async function listWindows() {
  const { stdout } = await tmux(["list-windows", "-a", "-F", LIST_FORMAT]);
  const rows = [];
  for (const raw of stdout.split("\n")) {
    // Only \r is stripped: trimming would eat a trailing space in a path.
    const line = raw.replace(/\r$/, "");
    if (!line) continue;
    const parts = line.split(SEP);
    const id = parts[0];
    // tmux window ids are always @<digits>. Anything else is not a window
    // record and must not be matched against.
    if (!/^@\d+$/.test(id)) continue;
    if (parts.length !== 5) {
      // A free-form field contained the separator. The id is still sound, so
      // the window stays adoptable BY ID; it is simply excluded from name and
      // session matching, where a wrong guess would move a stranger's work.
      rows.push({ id, session: null, index: null, name: null, path: null, garbled: true });
      continue;
    }
    rows.push({ id, session: parts[1], index: parts[2], name: parts[3], path: parts[4] || null, garbled: false });
  }
  return rows;
}

/**
 * Re-read one window's fields, one tmux call per field.
 *
 * Used only for a window whose listing line could not be split — with a single
 * field per call there is no separator, so there is nothing left to collide
 * with and the values come back exact.
 */
async function repairWindow(id) {
  const field = async (fmt) => {
    const { stdout } = await tmux(["display-message", "-p", "-t", id, "-F", fmt]);
    return stdout.replace(/\r?\n$/, "");
  };
  return {
    id,
    session: await field("#{session_name}"),
    index: await field("#{window_index}"),
    name: await field("#{window_name}"),
    path: (await field("#{pane_current_path}")) || null,
    garbled: false,
  };
}

// ---------------------------------------------------------------------------
// form 2: adoption by rebirth — the conversation moves, the process cannot
// ---------------------------------------------------------------------------

async function rebornDrawer(opts, ctx) {
  const problem = (opts.problem || opts.words.join(" ")).trim();
  if (!problem) throw new Error(`--reborn needs a problem statement\n\n${USAGE}`);

  const agent = opts.agent || KNOWN_AGENTS[0];
  // Here the agent IS launched, so an unknown name is a real error — unlike
  // window adoption, where the label is only ever metadata.
  if (!isKnownAgent(agent)) {
    throw new Error(`unknown agent "${agent}" — known agents: ${KNOWN_AGENTS.join(", ")}`);
  }

  const root = ctx.projectRoot || process.cwd();
  const session = (ctx.config || {}).tmuxSession || DEFAULT_SESSION;
  const paths = await ensureBaDir(root);

  // The directory IS the anchor. A vendor CLI's "continue" resumes the most
  // recent conversation in the current directory, so pointing at the wrong
  // directory does not error — it silently starts a fresh conversation. Being
  // strict about the path existing is the only check available.
  const dir = path.resolve(opts.dir || process.cwd());
  let stat = null;
  try {
    stat = await fs.stat(dir);
  } catch {
    throw new Error(`--dir does not exist: ${dir}`);
  }
  if (!stat.isDirectory()) throw new Error(`--dir is not a directory: ${dir}`);

  const drawers = await loadDrawers(root);
  const slug = uniqueSlug(problem, drawers);

  let branch = null;
  let worktree = dir;
  let launchDir = dir;
  let resumed = true;

  if (opts.worktree) {
    /* --worktree is a TRADE, and the honest thing is to make it visible.
       The resume verb is scoped to a directory: it continues the newest
       conversation found in the directory the CLI is started in. A brand new
       worktree has no conversation, so resuming inside it would quietly start
       a fresh one while printing the word "reborn" — a silent downgrade, which
       is the exact failure this tool exists to prevent.
       So asking for a branch means asking for a fresh agent on that branch,
       carrying the problem statement instead of the history, and it says so.
       (A vendor CLI that can resume by SESSION ID rather than by directory
       could do better here, but finding that id means reading the vendor's
       private on-disk session store, which is the kind of coupling agents.mjs
       exists to refuse.) */
    if (!(await gitOk(root, ["rev-parse", "--git-dir"]))) {
      throw new Error(`--worktree needs a git repository: ${root}`);
    }
    branch = `ba/${slug}`;
    const worktreeRel = path.join(".ba", "worktrees", slug);
    worktree = path.join(root, worktreeRel);
    const exists = await gitOk(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    try {
      await git(root, exists
        ? ["worktree", "add", worktreeRel, branch]
        : ["worktree", "add", "-b", branch, worktreeRel]);
    } catch (err) {
      throw new Error(`git worktree add failed: ${err.message}`);
    }
    launchDir = worktree;
    resumed = false;
  } else {
    // No worktree by default, and this is the whole point of --reborn: the
    // loose agent's conversation is anchored to the directory it has been
    // working in. Creating a worktree would move the agent away from the one
    // thing that makes the rebirth work.
    branch = await gitBranch(dir);
  }

  // A resumed conversation already holds the context; the problem statement is
  // a nudge into it, not a briefing. A fresh launch (--worktree) is a new
  // conversation and gets the full opening prompt, exactly like `ba new`.
  const promptText = resumed ? `${problem}\n` : await composePrompt(root, problem);
  const argv = resumed ? resumeCommand(agent, promptText) : launchCommand(agent, promptText);

  // Some resume verbs take no prompt (see the table in agents.mjs). When the
  // prompt is not in the argv, nothing was handed over and there is no prompt
  // file to write — the problem statement lives in the drawer record only, and
  // the output says so rather than implying a handoff that did not happen.
  const handedOver = argv.includes(promptText);
  let promptFile = null;
  if (handedOver) {
    promptFile = path.join(paths.promptsDir, `${slug}.txt`);
    await fs.mkdir(paths.promptsDir, { recursive: true });
    await fs.writeFile(promptFile, promptText);
  }
  const launchShell = shellLaunch(argv, handedOver ? promptText : null, promptFile);

  let windowId = null;
  let tmuxNote = null;
  if (opts.tmux && (await hasTmux())) {
    try {
      windowId = await openWindow({ session, slug, cwd: launchDir, launchShell, root });
    } catch (err) {
      tmuxNote = `tmux wiring failed (${err.message.trim()}) — drawer is ready anyway`;
    }
  } else if (opts.tmux) {
    tmuxNote = "tmux is not installed";
  }

  const drawer = {
    slug,
    problem,
    agent,
    branch,
    worktree,
    tmux: windowId,
    createdAt: new Date().toISOString(),
  };
  drawers.push(drawer);
  await saveDrawers(root, drawers);

  const lines = [
    `reborn   ${drawer.slug}`,
    `problem  ${drawer.problem}`,
    `agent    ${drawer.agent}`,
    `branch   ${drawer.branch || "(not a git checkout)"}`,
    `worktree ${drawer.worktree}${opts.worktree ? "" : "  (the loose agent's own directory)"}`,
  ];
  if (promptFile) lines.push(`prompt   ${promptFile}`);
  if (resumed) {
    lines.push(
      `resume   ${launchShell}`,
      "",
      "The conversation moves, not the process: your original tab still holds the",
      "old one and is yours to close. If that directory has no conversation to",
      "resume, the agent starts fresh there instead — no error, so check the tab.",
    );
    if (!handedOver) {
      lines.push(
        "",
        `This agent's resume verb takes no opening prompt, so the problem statement`,
        "was recorded in the drawer and not handed to it. Paste it in yourself.",
      );
    }
  } else {
    lines.push(
      "",
      "--worktree: this is a FRESH conversation on a new branch, not a resumed one.",
      "A resume is scoped to its directory, so the loose agent's history cannot",
      `follow it into ${worktree}. It carries the problem statement instead.`,
    );
  }
  if (drawer.tmux) {
    lines.push("", `tmux     ${session}:${slug} (${drawer.tmux})`, `  tmux attach -t ${session}    # then select the ${slug} window`);
  }
  if (tmuxNote) lines.push(`note     ${tmuxNote}`);
  if (!windowId) {
    // Never fail the verb over tmux: the drawer is real either way and the
    // human just needs the two commands.
    lines.push("", "run it yourself:", "", `  cd ${shq(launchDir)}`, `  ${launchShell}`);
  }
  console.log(lines.join("\n"));
  return drawer;
}

/**
 * The opening prompt for a FRESH launch: problem, blank line, then the
 * protocol. Looked up in the project first so a project can override the
 * standing instruction, then in the tool's own directory so it ships with
 * `ba`. Absence is fine — the drawer degrades to a problem statement.
 */
async function composePrompt(root, problem) {
  for (const candidate of [path.join(root, "ba", "PROTOCOL.md"), path.join(HERE, "..", "PROTOCOL.md")]) {
    try {
      const protocol = (await fs.readFile(candidate, "utf8")).trim();
      if (protocol) return `${problem}\n\n${protocol}\n`;
    } catch { /* next candidate */ }
  }
  return `${problem}\n`;
}

// ---------------------------------------------------------------------------
// shared plumbing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    help: false, reborn: false, worktree: false, tmux: true,
    agent: null, problem: null, dir: null, words: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { out.words.push(...argv.slice(i + 1)); break; }
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--reborn") out.reborn = true;
    // `--reborn "<problem>"` reads like the text is the flag's value, so accept
    // that spelling too rather than making the human learn which it is.
    else if (a.startsWith("--reborn=")) { out.reborn = true; out.problem = a.slice("--reborn=".length); }
    else if (a === "--worktree") out.worktree = true;
    else if (a === "--no-tmux") out.tmux = false;
    else if (a === "--agent") out.agent = argv[++i] ?? "";
    else if (a.startsWith("--agent=")) out.agent = a.slice("--agent=".length);
    else if (a === "--problem") out.problem = argv[++i] ?? "";
    else if (a.startsWith("--problem=")) out.problem = a.slice("--problem=".length);
    else if (a === "--dir") out.dir = argv[++i] ?? "";
    else if (a.startsWith("--dir=")) out.dir = a.slice("--dir=".length);
    else if (a.startsWith("-") && a !== "-") throw new Error(`unknown flag ${a}\n\n${USAGE}`);
    else out.words.push(a);
  }
  return out;
}

/** slugify + a number, deduped against the open drawers. */
function uniqueSlug(text, drawers) {
  const base = slugify(text);
  const taken = new Set(drawers.map((d) => d.slug));
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * argv -> one shell string, with the prompt element swapped for a `"$(cat …)"`
 * read of the file it was written to.
 *
 * The trap: the prompt is text a human wrote, and it has to survive tmux
 * send-keys plus a layer of shell parsing. Quoting that correctly is possible
 * and is not worth owning, so the prompt never appears in the command at all.
 *
 * The element is found by scanning from the END rather than by matching every
 * equal string: the prompt is always the last element in these tables, and a
 * problem statement of literally "--continue" must not rewrite the flag.
 */
function shellLaunch(argv, promptText, promptFile) {
  const at = promptText == null ? -1 : argv.lastIndexOf(promptText);
  return argv
    .map((a, i) => (i === at ? `"$(cat ${shq(promptFile)})"` : shq(a)))
    .join(" ");
}

/** How many windows a session holds. Ids only, so nothing can garble the count. */
async function countWindows(session) {
  try {
    const { stdout } = await tmux(["list-windows", "-t", session, "-F", "#{window_id}"]);
    return stdout.split("\n").filter((l) => /^@\d+$/.test(l.trim())).length;
  } catch {
    return 0;
  }
}

async function ensureSession(session, root) {
  if (await tmuxOk(["has-session", "-t", session])) return;
  try {
    await tmux(["new-session", "-d", "-s", session, "-c", root]);
  } catch (err) {
    // Lost a race with another ba; if the session is there now, fine.
    if (!(await tmuxOk(["has-session", "-t", session]))) throw err;
  }
}

async function openWindow({ session, slug, cwd, launchShell, root }) {
  await ensureSession(session, root);
  // Target by id (@7), never by name: names collide across sessions and agents
  // rename their own windows, so a name captured now may point somewhere else
  // by the time anything reads it back.
  const { stdout } = await tmux([
    "new-window", "-t", session, "-n", slug, "-c", cwd, "-P", "-F", "#{window_id}",
  ]);
  const windowId = stdout.trim();
  if (!windowId) throw new Error("tmux new-window returned no window id");
  // -l sends the string literally; without it tmux reads arguments as key
  // names, so a command containing "Enter" or "C-c" would be typed as a
  // keystroke. Enter is then sent as its own key.
  await tmux(["send-keys", "-t", windowId, "-l", launchShell]);
  await tmux(["send-keys", "-t", windowId, "Enter"]);
  return windowId;
}

/**
 * POSIX single-quote, skipped for strings a shell cannot misread. These
 * commands get printed for a human to copy, so `claude --continue "$(cat
 * /path)"` beats a fully quoted version that says the same thing unreadably.
 */
function shq(s) {
  const str = String(s);
  if (str !== "" && /^[A-Za-z0-9_@%+=:,.\/-]+$/.test(str)) return str;
  return `'${str.replaceAll("'", `'\\''`)}'`;
}

// `git -C <dir>` rather than {cwd}: it fails with git's own message instead of
// an ENOENT from spawn when the directory has gone away underneath us.
async function git(dir, args) {
  return execFileAsync("git", ["-C", dir, ...args], { maxBuffer: 8 * 1024 * 1024 });
}

async function gitOk(dir, args) {
  try {
    await git(dir, args);
    return true;
  } catch {
    return false;
  }
}

/** Current branch of a checkout, or null — for a non-repo AND for detached HEAD. */
async function gitBranch(dir) {
  if (!(await gitOk(dir, ["rev-parse", "--git-dir"]))) return null;
  try {
    const { stdout } = await git(dir, ["branch", "--show-current"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function tmux(args) {
  return execFileAsync("tmux", args, { maxBuffer: 1024 * 1024 });
}

async function tmuxOk(args) {
  try {
    await tmux(args);
    return true;
  } catch {
    return false;
  }
}

async function hasTmux() {
  return tmuxOk(["-V"]);
}
