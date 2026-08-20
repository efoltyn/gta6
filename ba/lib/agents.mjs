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

export default launchCommand;
