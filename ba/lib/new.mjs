// `ba new "<problem statement>" [--agent claude|codex] [--no-tmux]`
//
// Opens a drawer. A drawer is: a git worktree, a branch, an opening prompt on
// disk, a tmux window running the stock vendor CLI in that worktree, and a
// record in .ba/drawers.json.
//
// Two design facts worth stating up front, because most of the code below is
// in service of them:
//
// 1. A task IS a worktree. That is what makes "fully safe to revert" a
//    structural property instead of a promise — dropping a drawer deletes one
//    directory and one branch and touches nothing else, so a bad agent run
//    cannot bleed into the checkout you are sitting in.
// 2. The tool launches; it never puppets. We spawn the vendor's own binary in
//    a real pty with an opening prompt and then stop. There is no second
//    send-keys, no scripted turn, no supervisor. Everything after the launch
//    belongs to the human and the receipt.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { launchCommand, isKnownAgent, KNOWN_AGENTS } from "./agents.mjs";
import { baPaths, ensureBaDir, loadDrawers, saveDrawers } from "./store.mjs";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SESSION = "ba";
const MAX_SLUG = 40;

const USAGE = `ba new "<problem statement>" [--agent claude|codex] [--no-tmux]

Opens a drawer: a worktree on branch ba/<slug>, an opening prompt, and a tmux
window running the agent inside it.

  --agent <name>   which CLI to launch (default: claude; known: ${KNOWN_AGENTS.join(", ")})
  --no-tmux        prepare everything, print the launch command, start nothing`;

/**
 * The CLI verb. Returns an EXIT CODE, because bin/ba.mjs feeds this return
 * value straight to process.exit() — anything but a number crashes the
 * process after the work already succeeded. Programmatic callers want
 * createDrawer() below, which returns the drawer itself.
 *
 * Expected failures are printed as one line, not thrown: the dispatcher has no
 * catch, so a forgotten problem statement would otherwise land as a stack
 * trace. BA_DEBUG=1 brings the stack back.
 */
export default async function newDrawerCommand(argv = [], ctx = {}) {
  try {
    await createDrawer(argv, ctx);
    return 0;
  } catch (err) {
    process.stderr.write(`ba new: ${err?.message || err}\n`);
    if (process.env.BA_DEBUG) process.stderr.write(`${err?.stack || ""}\n`);
    return 1;
  }
}

/** Open a drawer. Returns the drawer record, or null if only help was asked for. */
export async function createDrawer(argv = [], ctx = {}) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return null;
  }
  const problem = opts.words.join(" ").trim();
  if (!problem) throw new Error(`a drawer needs a problem statement\n\n${USAGE}`);
  if (!isKnownAgent(opts.agent)) {
    throw new Error(`unknown agent "${opts.agent}" — known agents: ${KNOWN_AGENTS.join(", ")}`);
  }

  const root = ctx.projectRoot || process.cwd();
  const config = ctx.config || {};
  const session = config.tmuxSession || DEFAULT_SESSION;
  const paths = await ensureBaDir(root);

  // A drawer is a worktree, so a non-repo has nowhere to put one. Say that
  // rather than letting `git worktree add` explain it in git's own words.
  try {
    await git(root, ["rev-parse", "--git-dir"]);
  } catch {
    throw new Error(`ba new needs a git repository (a drawer IS a worktree): ${root}`);
  }

  const drawers = await loadDrawers(root);
  const slug = await uniqueSlug(problem, drawers, paths.worktreesDir);
  const branch = `ba/${slug}`;
  const worktreeRel = path.join(".ba", "worktrees", slug);
  const worktree = path.join(root, worktreeRel);

  // Reuse an existing ba/<slug> branch instead of failing on it: the slug was
  // already deduped against open drawers, so a branch by this name is the
  // residue of a dropped drawer and its history is the one you want back.
  const branchExists = await gitOk(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  const addArgs = branchExists
    ? ["worktree", "add", worktreeRel, branch]
    : ["worktree", "add", "-b", branch, worktreeRel];
  try {
    await git(root, addArgs);
  } catch (err) {
    throw new Error(`git worktree add failed: ${err.message}`);
  }

  const promptText = await composePrompt(root, problem);
  const promptFile = path.join(paths.promptsDir, `${slug}.txt`);
  await fs.mkdir(paths.promptsDir, { recursive: true });
  await fs.writeFile(promptFile, promptText);

  const launchShell = shellLaunch(opts.agent, promptText, promptFile);

  // The drawer is registered whatever happens to tmux. A worktree that exists
  // on disk but not in drawers.json is invisible to `ba ls` and orphaned from
  // `ba drop`, which is worse than any launch failure.
  let windowId = null;
  let tmuxNote = null;
  if (opts.tmux && (await hasTmux())) {
    try {
      windowId = await openWindow({ session, slug, worktree, launchShell, root });
    } catch (err) {
      tmuxNote = `tmux wiring failed (${err.message.trim()}) — drawer is ready anyway`;
    }
  } else if (opts.tmux) {
    tmuxNote = "tmux is not installed";
  }

  const drawer = {
    slug,
    problem,
    agent: opts.agent,
    branch,
    worktree,
    tmux: windowId,
    createdAt: new Date().toISOString(),
  };
  drawers.push(drawer);
  await saveDrawers(root, drawers);

  report({ drawer, session, promptFile, launchShell, tmuxNote, manual: !windowId, branchExists });
  return drawer;
}

function parseArgs(argv) {
  const out = { agent: "claude", tmux: true, help: false, words: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { out.words.push(...argv.slice(i + 1)); break; }
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--agent") out.agent = argv[++i] ?? "";
    else if (a.startsWith("--agent=")) out.agent = a.slice("--agent=".length);
    else if (a === "--no-tmux") out.tmux = false;
    else if (a.startsWith("-") && a !== "-") throw new Error(`unknown flag ${a}\n\n${USAGE}`);
    // Bare words are joined, so a forgotten pair of quotes still opens the
    // drawer you meant instead of one named after your first word.
    else out.words.push(a);
  }
  return out;
}

/**
 * Problem statement -> slug. Lowercase, dashes, <=40 chars, cut on a word
 * boundary when the cut lands mid-word.
 */
export function slugify(problem) {
  let s = String(problem)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length > MAX_SLUG) {
    s = s.slice(0, MAX_SLUG);
    const lastDash = s.lastIndexOf("-");
    if (lastDash >= Math.floor(MAX_SLUG / 2)) s = s.slice(0, lastDash);
    s = s.replace(/-+$/, "");
  }
  // A statement with no latin characters slugs to nothing; it still deserves a
  // drawer, and the dedupe below will number it.
  return s || "drawer";
}

async function uniqueSlug(problem, drawers, worktreesDir) {
  const base = slugify(problem);
  const taken = new Set(drawers.map((d) => d.slug));
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(candidate) && !(await exists(path.join(worktreesDir, candidate)))) return candidate;
  }
}

/**
 * The opening prompt: the problem statement, a blank line, then the protocol.
 *
 * The protocol is looked up in the project first so a project can override the
 * standing instruction, then in the tool's own directory so the file ships
 * with `ba` rather than having to exist in every consumer repo. Absence is
 * fine — the drawer degrades to a problem statement, which is still the unit
 * of work.
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

/**
 * Build the shell string that launches the agent.
 *
 * The trap this dodges: a prompt is multiline, contains quotes and backticks,
 * and has to survive being typed into a pty by tmux send-keys — two layers of
 * shell parsing over text the user wrote. Quoting that correctly is possible
 * and is not worth owning. So the prompt goes to a file and the command reads
 * it back with "$(cat …)": the double quotes keep it one argument, newlines
 * and all, and nothing in the prompt is ever parsed as shell.
 *
 * The prompt element is found by value, which is why launchCommand() insists
 * on a non-empty prompt — an empty string could match another argv slot.
 */
function shellLaunch(agent, promptText, promptFile) {
  return launchCommand(agent, promptText)
    .map((a) => (a === promptText ? `"$(cat ${shq(promptFile)})"` : shq(a)))
    .join(" ");
}

async function openWindow({ session, slug, worktree, launchShell, root }) {
  if (!(await tmuxOk(["has-session", "-t", session]))) {
    try {
      await tmux(["new-session", "-d", "-s", session, "-c", root]);
    } catch (err) {
      // Lost a race with another `ba new`; if the session is there now, fine.
      if (!(await tmuxOk(["has-session", "-t", session]))) throw err;
    }
  }
  // Target the window by id (@7), not by name. Names collide and can be
  // renamed by the shell or the agent's own title updates; an id is stable for
  // the window's whole life, which is what makes `ba ls` liveness honest.
  const { stdout } = await tmux([
    "new-window", "-t", session, "-n", slug, "-c", worktree, "-P", "-F", "#{window_id}",
  ]);
  const windowId = stdout.trim();
  if (!windowId) throw new Error("tmux new-window returned no window id");

  // -l sends the string literally. Without it tmux parses arguments as key
  // names, so a command containing something like "Enter" or "C-c" would be
  // typed as a keystroke instead of text. Enter is then sent as its own key.
  //
  // Sending before the shell has drawn its prompt is safe: the pty buffers the
  // input and the shell reads it when it is ready.
  //
  // Trap, measured: the agent is resolved by the PANE's PATH, which its login
  // shell rebuilds from the user's profile — NOT the PATH `ba` itself is
  // running with. So a `claude` that works in your shell but lives outside the
  // profile's PATH (or is a shell alias/function, which is not a binary at
  // all) fails inside the window with "command not found" while ba reports
  // success. A pre-existing tmux server makes it worse: it hands new panes the
  // environment it was started with, which may predate today's PATH.
  await tmux(["send-keys", "-t", windowId, "-l", launchShell]);
  await tmux(["send-keys", "-t", windowId, "Enter"]);
  return windowId;
}

function report({ drawer, session, promptFile, launchShell, tmuxNote, manual, branchExists }) {
  const lines = [
    `drawer  ${drawer.slug}`,
    `problem ${drawer.problem}`,
    `branch  ${drawer.branch}${branchExists ? " (reused)" : ""}`,
    `worktree ${drawer.worktree}`,
    `prompt  ${promptFile}`,
  ];
  if (drawer.tmux) {
    lines.push(`tmux    ${session}:${drawer.slug} (${drawer.tmux}) running ${drawer.agent}`);
    lines.push("", `  tmux attach -t ${session}    # then select the ${drawer.slug} window`);
  }
  if (tmuxNote) lines.push(`note    ${tmuxNote}`);
  if (manual) {
    // Never fail the verb because tmux is missing or unwanted: the drawer is
    // real either way, and the human just needs the two commands.
    lines.push("", "run it yourself:", "", `  cd ${shq(drawer.worktree)}`, `  ${launchShell}`);
    if (!tmuxNote) {
      lines.push(
        "",
        "or wire it into tmux later:",
        "",
        `  tmux has-session -t ${session} || tmux new-session -d -s ${session}`,
        `  tmux new-window -t ${session} -n ${drawer.slug} -c ${shq(drawer.worktree)}`,
        `  tmux send-keys -t ${session}:${drawer.slug} -l ${shq(launchShell)} \\; send-keys -t ${session}:${drawer.slug} Enter`,
      );
    }
  }
  console.log(lines.join("\n"));
}

/**
 * POSIX single-quote, skipped for strings that cannot mean anything to a
 * shell. These commands get printed for a human to copy, so `claude "$(cat
 * /path)"` beats `'claude' "$(cat '/path')"` — same behavior, one of them
 * readable. Inside single quotes everything is literal; `'` itself has to
 * close the quote, escape, and reopen.
 */
function shq(s) {
  const str = String(s);
  if (str !== "" && /^[A-Za-z0-9_@%+=:,.\/-]+$/.test(str)) return str;
  return `'${str.replaceAll("'", `'\\''`)}'`;
}

async function git(cwd, args) {
  return execFileAsync("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });
}

async function gitOk(cwd, args) {
  try {
    await git(cwd, args);
    return true;
  } catch {
    return false;
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

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
