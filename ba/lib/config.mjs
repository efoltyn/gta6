/* ba/lib/config.mjs — the one file that makes this tool project-agnostic.

   The engine used to be welded to one repo: presets lived at
   tools/visual-presets/, the baseline was a hardcoded GitHub Pages URL, the
   local server was a python script two directories up. None of that is a
   property of the COMPARISON — it is a property of the project being
   photographed. `ba.config.mjs` is where a project states those four facts
   once, and finding that file is also how `ba` decides where the project
   ROOT is: every relative path in the config resolves against the config
   file's own directory, so `ba` works the same from a subdirectory as it does
   from the top.

   No config file is not an error. A repo with a ba-presets/ directory and a
   preset that declares its own `defaultBefore` needs no configuration at all;
   the defaults below are then resolved against the current directory. */

import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CONFIG_FILENAME = "ba.config.mjs";

export const DEFAULTS = {
  // where preset modules live (a bare `ba <name>` resolves <name>.mjs here)
  presets: "./ba-presets",
  // the default "before" for presets that do not pin their own. null means a
  // preset must declare defaultBefore, or the caller must pass --before.
  baseline: null,
  // "builtin" = ba's own zero-dependency static server over projectRoot.
  // {command, url} = spawn the project's own dev server instead; "{port}" is
  // substituted in both, so the command and the URL agree on a free port.
  serve: "builtin",
  // report directories are created under here, one per run
  out: "./artifacts/ba",
  // chrome/chromium binary. null = probe the usual locations.
  browser: null,
};

/** Walk up from `cwd` looking for ba.config.mjs. Returns null at the root. */
export function findConfigFile(cwd = process.cwd()) {
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/* serve: "builtin" | { command, url } — normalized once here so the engine
   never has to re-decide what shape it was given. */
function normalizeServe(value) {
  if (value == null || value === "builtin") return { mode: "builtin" };
  if (typeof value === "string") {
    // a bare string other than "builtin" is a command line; the URL then has
    // to be the conventional local one, because nothing else was said.
    return { mode: "command", command: value, url: "http://127.0.0.1:{port}/" };
  }
  if (typeof value === "object" && value.command) {
    return {
      mode: "command",
      command: String(value.command),
      url: String(value.url || "http://127.0.0.1:{port}/"),
    };
  }
  throw new Error(`${CONFIG_FILENAME}: serve must be "builtin" or {command, url}`);
}

/* A browser path is resolved against the project only when it LOOKS like a
   path. "chromium" is a name for $PATH to answer; "./bin/chrome" is ours. */
function normalizeBrowser(value, projectRoot) {
  if (!value) return null;
  const text = String(value);
  return text.includes("/") || text.includes("\\") ? path.resolve(projectRoot, text) : text;
}

/**
 * Load the nearest ba.config.mjs, merged over the defaults, with every path
 * already absolute. Returns { projectRoot, configPath, presets, baseline,
 * serve, out, browser } plus any extra keys the config declared.
 */
export async function loadConfig(cwd = process.cwd()) {
  const configPath = findConfigFile(cwd);
  const projectRoot = configPath ? path.dirname(configPath) : path.resolve(cwd);

  let declared = {};
  if (configPath) {
    // Cache-busted on purpose. Node's ESM cache is keyed by URL, so a plain
    // import of the same path returns the FIRST version this process saw
    // forever after — which is invisible in a one-shot CLI and a genuinely
    // confusing bug in anything long-lived (a watcher, a test harness, an
    // agent loop that edits the config and re-reads it). "Load the config"
    // should mean the file as it is now. The engine does the same for presets.
    const module = await import(`${pathToFileURL(configPath).href}?ba=${Date.now()}`);
    const value = module.default ?? module.config ?? module;
    // a config may be a function so it can look at the environment it is
    // being loaded in (CI vs. laptop) before answering.
    declared = typeof value === "function" ? await value({ projectRoot }) : value;
    if (!declared || typeof declared !== "object") {
      throw new Error(`${configPath} must default-export an object (or a function returning one)`);
    }
  }

  const merged = { ...DEFAULTS, ...declared };
  return {
    ...merged,
    projectRoot,
    configPath,
    presets: path.resolve(projectRoot, String(merged.presets ?? DEFAULTS.presets)),
    out: path.resolve(projectRoot, String(merged.out ?? DEFAULTS.out)),
    baseline: merged.baseline ? String(merged.baseline) : null,
    serve: normalizeServe(merged.serve),
    browser: normalizeBrowser(merged.browser, projectRoot),
  };
}

/* Preset resolution, in one place so the CLI and the engine can never
   disagree about which file a name meant:
     "beach-shores"                  → <config.presets>/beach-shores.mjs
     "./recipes/one-off.mjs"         → resolved against the project root
     "/abs/path/one-off.mjs"         → itself
   A name with a separator or an .mjs suffix is a path; anything else is a
   name looked up in the preset directory. */
export function resolvePresetPath(name, config) {
  const text = String(name);
  if (path.isAbsolute(text)) return text;
  if (text.includes("/") || text.includes("\\") || text.endsWith(".mjs")) {
    return path.resolve(config.projectRoot, text);
  }
  return path.join(config.presets, `${text}.mjs`);
}
