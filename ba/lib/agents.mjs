// The launch table: (agent, promptText) -> argv array. That is the entire file.
//
// The constraint that shapes it: the cabinet HOSTS the stock vendor CLIs. It
// puts them in a pty, hands them the first prompt, and then gets out of the
// way. Handing a CLI its opening prompt as an argument is ordinary CLI usage —
// the same thing a human types. Scripted keystrokes past that point would be
// puppeting, which both leaves the category this tool is allowed to live in
// (a terminal that runs the vendor's own binary under the subscriber's own
// hands) and breaks the product's loop: the human is the judge, and the loop
// closes through the receipt, not through a supervisor bot.
//
// So this table stays deliberately dumb. No flags, no env vars, no per-vendor
// cleverness, no feature detection. Adding a CLI is one line, and that is the
// point — the tool is positively exposed to vendor progress.

const AGENTS = {
  claude: (promptText) => ["claude", promptText],
  codex: (promptText) => ["codex", promptText],
};

/* The RESUME table: same idea, for continuing a conversation that already
   exists instead of starting one. `ba adopt --reborn` is the only caller — an
   agent running loose in an ordinary terminal tab cannot have its PROCESS
   moved into the cabinet, so the conversation is what moves, and that means
   asking the vendor CLI to pick its own thread back up.

   The rule for entries here is stricter than for the launch table above,
   because a wrong guess is silent: a resume flag that does not exist makes the
   CLI exit with a usage error inside a tmux window nobody is watching, and a
   resume flag that exists but ignores its argument starts a FRESH conversation
   that looks exactly like a resumed one. Neither failure is visible from the
   outside. So: documented forms only, no invented flags, and no prompt is
   passed unless the CLI is known to accept one alongside the resume. */
const RESUMES = {
  /* Verified by reading `claude --help` and then running it: the usage line is
     `claude [options] [command] [prompt]`, `-c, --continue` is "Continue the
     most recent conversation in the current directory", and the two compose —
     the positional prompt is delivered as the next turn of the resumed
     conversation. Directory-scoped, which is why adopt.mjs anchors the drawer
     to the loose agent's own directory rather than to a new worktree. */
  claude: (promptText) => (promptText ? ["claude", "--continue", promptText] : ["claude", "--continue"]),

  /* NOT verified: no codex binary existed on the machine where this line was
     written, so this is the documented resume form and nothing more. The
     open question is whether `codex resume --last` accepts a trailing prompt;
     rather than guess, no prompt is passed and adopt.mjs tells the human their
     problem statement was recorded but not handed over. If you have codex
     installed: check `codex resume --help`, and if a prompt is accepted, give
     this entry the same shape as claude's above. */
  codex: () => ["codex", "resume", "--last"],
};

/** Agent names this build knows how to launch, in table order. */
export const KNOWN_AGENTS = Object.freeze(Object.keys(AGENTS));

/** True if `agent` is in the table. Cheap pre-flight for arg parsing. */
export function isKnownAgent(agent) {
  return Object.hasOwn(AGENTS, String(agent));
}

/**
 * Build the argv for launching `agent` with `promptText` as its opening turn.
 *
 * Returns a plain argv array — NOT a shell string. Callers that need a shell
 * string (tmux send-keys) must quote it themselves; see new.mjs, which swaps
 * the prompt element for a `"$(cat …)"` read of a file rather than trying to
 * quote a multiline prompt through two layers of parsing.
 *
 * The prompt is required and must be non-empty, because that swap identifies
 * the prompt element by value: an empty string could match another argv slot.
 */
export function launchCommand(agent, promptText) {
  const build = AGENTS[String(agent)];
  if (!build) {
    throw new Error(
      `unknown agent "${agent}" — known agents: ${KNOWN_AGENTS.join(", ")}`,
    );
  }
  if (typeof promptText !== "string" || promptText.length === 0) {
    throw new Error(`launchCommand(${agent}): promptText must be a non-empty string`);
  }
  return build(promptText);
}

/**
 * Build the argv that makes `agent` pick its most recent conversation back up.
 *
 * `promptText` is OPTIONAL and advisory: an agent whose resume verb is not
 * known to accept an opening prompt gets none, and the returned argv simply
 * will not contain it. Callers must therefore check whether the prompt is
 * actually in the result rather than assuming it was handed over —
 * adopt.mjs does exactly that, and says so in its output when it was not.
 *
 * Returns a plain argv array, not a shell string; see launchCommand above for
 * why the caller does its own quoting.
 */
export function resumeCommand(agent, promptText = null) {
  const build = RESUMES[String(agent)];
  if (!build) {
    throw new Error(
      `agent "${agent}" has no known resume command — agents that can resume: ${RESUMABLE_AGENTS.join(", ")}`,
    );
  }
  // An empty string is treated as "no prompt": the caller locates the prompt in
  // the argv by value, and "" would match any slot.
  return build(typeof promptText === "string" && promptText.length > 0 ? promptText : null);
}

/** Agent names this build knows how to RESUME, in table order. */
export const RESUMABLE_AGENTS = Object.freeze(Object.keys(RESUMES));

/** True if `agent` has a resume command in the table. */
export function canResume(agent) {
  return Object.hasOwn(RESUMES, String(agent));
}

export default launchCommand;
