#!/usr/bin/env node
/* ba — the receipt machine.

   An agent that says "fixed the shadows" has told you nothing you can check.
   A matched pair of screenshots from two real builds, plus the numbers the
   preset declared it was measuring, is a RECEIPT: it either shows the change
   or it doesn't, and nobody has to take anyone's word for it.

   One argument runs one:

       ba                      → list every preset, with what its "before" is
       ba beach-shores         → run one, sane defaults
       ba beach-shores --before https://example.test/  → any engine flag passes through
       ba beach-shores --json  → the same run, machine-readable on stdout

   Defaults it applies (each one only when you did not pass it yourself):
     --before      the preset's own defaultBefore if it declares one (flag-A/B
                   presets compare this checkout against itself with the flag
                   off), otherwise `baseline` from ba.config.mjs
     --keep-going  one broken subject becomes an error page, not a dead run
     --no-open     headless/CI friendly; the report path prints instead

   AND IT READS THE ANSWER BACK. The engine writes screenshots, an HTML contact
   sheet, a PDF and a metadata.json, and then prints a PATH — the right output
   for a person with a screen and a useless one for anyone (a CI job, an agent,
   an ssh session) who cannot open a PDF. So when a run finishes this prints the
   preset's MEASUREMENTS TABLE — every metric it declared, before against after,
   marked against the direction the preset says is better. `--no-summary` turns
   it off; `--json` prints the same facts as JSON instead, with all human
   chatter moved to stderr so stdout is parseable.

   Only DECLARED metrics are printed, deliberately: a stage function often
   returns a full audit dump so the metadata can answer later questions, and
   printing all of it would reproduce the wall of numbers the report's own
   whitelist exists to prevent. */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig, resolvePresetPath, CONFIG_FILENAME } from "../lib/config.mjs";

/* THE SUBCOMMAND CONTRACT. Each of these is one file in lib/ exporting a
   default async (argv, ctx) => exitCode. They are the receipt STORE — start a
   receipt, list them, show one, land or drop it — and they are deliberately
   loaded on demand: `ba <preset>` must not pay to import a store it will not
   touch, and a build where one of them is missing must still run comparisons. */
const SUBCOMMANDS = ["new", "adopt", "ls", "show", "log", "land", "drop"];

const PKG_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);

const config = await loadConfig(process.cwd());
const ctx = {
  projectRoot: config.projectRoot,
  config,
  // where receipts live for THIS project, next to the config that defines it
  baDir: path.join(config.projectRoot, ".ba"),
  // where ba itself is installed, for anything that needs its own assets
  pkgDir: PKG_DIR,
};

const first = argv[0];

if (SUBCOMMANDS.includes(first)) {
  const url = new URL(`../lib/${first}.mjs`, import.meta.url);
  if (!existsSync(fileURLToPath(url))) {
    process.stderr.write(`ba ${first}: not built yet (no lib/${first}.mjs in this install).\n` +
      `Comparisons work: run \`ba\` to list presets, or \`ba <preset>\` to make a report.\n`);
    process.exit(1);
  }
  const mod = await import(url);
  if (typeof mod.default !== "function") {
    process.stderr.write(`ba ${first}: lib/${first}.mjs must default-export (argv, ctx) => exitCode\n`);
    process.exit(1);
  }
  /* A subcommand returns its exit code — but several of them usefully return
     their DATA instead (ls hands back the rows it printed, so it can also be
     called as a function). process.exit() throws on anything that is not an
     integer, which turned "returned an array" into a node bootstrap stack
     trace after the command had already done its job perfectly. A dispatcher
     has no business dying over a return value: an integer is an exit code,
     anything else is success, and a module that wants to fail says so with a
     number. */
  const returned = await mod.default(argv.slice(1), ctx) ?? 0;
  process.exit(Number.isInteger(returned) ? Math.min(255, Math.max(0, returned)) : 0);
}

if (first === "--version" || first === "-v") {
  const pkg = JSON.parse(await readFile(path.join(PKG_DIR, "package.json"), "utf8"));
  process.stdout.write(`${pkg.name} ${pkg.version}\n`);
  process.exit(0);
}

const wantsHelp = first === "help" || first === "--help" || first === "-h";
const presetName = first && !first.startsWith("-") ? first : null;
const rest = presetName ? argv.slice(1) : argv;

/* THE LISTING, WITH A BASELINE COLUMN. The first thing you need to know
   before trusting a "before" column is what the before actually WAS: a
   flag-A/B preset compares this checkout against itself with one switch off,
   which is a far stronger claim than a diff against a build that is forty
   commits old — and you cannot tell which kind you are looking at from the
   name. So the listing says it. */
async function listPresets() {
  if (!existsSync(config.presets)) {
    process.stderr.write(`No preset directory at ${config.presets}\n` +
      (config.configPath
        ? `Set \`presets\` in ${config.configPath}.\n`
        : `Create ${CONFIG_FILENAME} here (presets, baseline, serve, out) or add ./ba-presets/.\n`));
    return 1;
  }
  const files = (await readdir(config.presets)).filter((f) => f.endsWith(".mjs")).sort();
  process.stdout.write("before/after — pick a preset:\n\n");
  for (const file of files) {
    let title = "", baseline = config.baseline ? "deployed" : "(none)";
    try {
      const mod = await import(pathToFileURL(path.join(config.presets, file)).href);
      title = (mod.default && mod.default.title) || "";
      if (mod.default && mod.default.defaultBefore === "local") baseline = "self";
      else if (mod.default && mod.default.defaultBefore) baseline = "pinned";
    } catch (_) { title = "(failed to load)"; }
    process.stdout.write(`  ${file.replace(/\.mjs$/, "").padEnd(26)} ${baseline.padEnd(9)} ${title}\n`);
  }
  process.stdout.write(
    `\nusage: ba <preset> [flags]        (ba <preset> --help for every engine flag)\n` +
    "baseline column: self = flag A/B against this same checkout (strongest),\n" +
    "                 pinned = the preset names its own before,\n" +
    `                 deployed = \`baseline\` from ${CONFIG_FILENAME}.\n` +
    `The report (screenshots + HTML + PDF) lands in ${config.out}/,\n` +
    "its path prints when the run finishes, and the preset's measurements table\n" +
    "prints with it (--no-summary to suppress, --json for machines).\n");
  return 0;
}

if (wantsHelp) {
  process.stdout.write(
    "ba — before/after receipts from two real browser builds\n\n" +
    "  ba                       list every preset in this project\n" +
    "  ba <preset> [flags]      run one comparison, print its measurements\n" +
    "  ba <preset> --help       every engine flag (devices, frames, reuse, labels)\n" +
    "  ba <preset> --json       machine-readable results on stdout\n" +
    `  ba <${SUBCOMMANDS.join("|")}>   the receipt store\n` +
    "  ba adopt <window|--reborn>  pull an agent already running loose into the cabinet\n\n" +
    `project: ${config.projectRoot}\n` +
    `config:  ${config.configPath || `(none — defaults; create ${CONFIG_FILENAME} to configure)`}\n` +
    `presets: ${config.presets}\n` +
    `out:     ${config.out}\n` +
    `baseline: ${config.baseline || "(none — presets must declare defaultBefore, or pass --before)"}\n`);
  process.exit(0);
}

if (!presetName) process.exit(await listPresets());

// resolve the preset the same way the engine does, to read its declared shape
const presetPath = resolvePresetPath(presetName, config);
let preset = null;
try { preset = (await import(pathToFileURL(presetPath).href)).default; }
catch (err) {
  process.stderr.write(`No such preset: ${presetName} (${err.message})\n` +
    "Run `ba` with no arguments to list what exists.\n");
  process.exit(1);
}

const has = (flag) => rest.some((token) => token === flag || token.startsWith(flag + "="));

// `ba <preset> --help` asks the engine for its flag reference. Applying this
// wrapper's defaults on top of that would print a run line for a run that is
// never going to happen.
if (has("--help") || has("-h")) {
  const { run: engineHelp } = await import("../lib/engine.mjs");
  await engineHelp(["--preset", presetName, "--help"], ctx);
  process.exit(0);
}

const wantSummary = !has("--no-summary");
const wantJson = has("--json");
const passThrough = rest.filter((token) => token !== "--no-summary" && token !== "--json");

const engineArgs = ["--preset", presetName, ...passThrough];
if (!has("--before")) {
  const before = preset && preset.defaultBefore ? String(preset.defaultBefore) : config.baseline;
  if (!before) {
    process.stderr.write(
      `No baseline for "${presetName}": pass --before URL, give the preset a defaultBefore,\n` +
      `or set \`baseline\` in ${config.configPath || CONFIG_FILENAME}.\n` +
      `(--before local runs the honest flag-A/B: this same checkout on both sides.)\n`);
    process.exit(1);
  }
  engineArgs.push("--before", before);
}
if (!has("--keep-going")) engineArgs.push("--keep-going");
if (!has("--no-open")) engineArgs.push("--no-open");

/* --json means stdout belongs to the machine. Every human line the engine
   prints — progress, the report path, the measurements table — goes to stderr
   instead, so a caller can pipe stdout straight into a parser and a person
   watching the run still sees everything. */
const human = wantJson ? process.stderr : process.stdout;
human.write(`ba → ${presetName} ${engineArgs.slice(2).join(" ")}\n`);

const { run } = await import("../lib/engine.mjs");
let result;
try {
  result = await run(engineArgs, { ...ctx, stdout: human });
} catch (err) {
  process.stderr.write(`\nba ${presetName} failed: ${err && err.message ? err.message : err}\n`);
  if (process.env.BA_DEBUG && err && err.stack) process.stderr.write(err.stack + "\n");
  process.exit(1);
}

async function readMetadata(dir) {
  if (!dir) return null;
  try { return JSON.parse(await readFile(path.join(dir, "metadata.json"), "utf8")); }
  catch (_) { return null; }
}

const format = (value) => {
  if (value == null) return "—";
  if (typeof value !== "number") return String(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
};

/* THE MEASUREMENTS TABLE, ON STDOUT. Everything needed for it is already in
   the run's metadata.json — the engine writes each subject's `metrics` on both
   sides — and the only place it was ever rendered was a page of the PDF. */
function printSummary(meta) {
  const specs = (preset && preset.metrics) || {};
  const keys = Object.keys(specs);
  if (!keys.length || !meta || !meta.captures) return;
  const rows = [];
  for (const capture of meta.captures) {
    const before = capture.before && capture.before.metrics;
    const after = capture.after && capture.after.metrics;
    if (!before && !after) continue;
    for (const key of keys) {
      if ((!before || before[key] == null) && (!after || after[key] == null)) continue;
      rows.push({ subject: capture.id, key, before: before ? before[key] : null, after: after ? after[key] : null });
    }
  }
  if (!rows.length) return;
  const labelWidth = Math.max(7, ...keys.map((key) => (specs[key].label || key).length));
  human.write(`\nMEASUREMENTS — ${meta.preset && meta.preset.title ? meta.preset.title : presetName}\n`);
  let lastSubject = null;
  for (const row of rows) {
    if (row.subject !== lastSubject) {
      human.write(`\n  ${row.subject}\n`);
      lastSubject = row.subject;
    }
    const spec = specs[row.key] || {};
    let mark = " ";
    if (typeof row.before === "number" && typeof row.after === "number" && row.after !== row.before) {
      const up = row.after > row.before;
      mark = spec.better === "lower" ? (up ? "✗" : "✓") : spec.better === "higher" ? (up ? "✓" : "✗") : "·";
    }
    human.write(
      `    ${mark} ${(spec.label || row.key).padEnd(labelWidth)}  ` +
      `${format(row.before).padStart(8)} → ${format(row.after).padStart(8)}` +
      `${spec.unit ? "  " + spec.unit : ""}\n`);
  }
  if (preset && preset.metricsNote) human.write(`\n  ${preset.metricsNote}\n`);
}

/* THE SAME FACTS, FOR A MACHINE. One JSON object on stdout: where the report
   is, which preset made it, and every declared metric's before/after per
   capture. A preset that declares no metrics falls back to whatever its stages
   measured, so a receipt is never empty just because nobody wrote labels. */
function jsonReport(meta) {
  const specs = (preset && preset.metrics) || {};
  const declared = Object.keys(specs);
  const captures = [];
  for (const capture of (meta && meta.captures) || []) {
    const before = (capture.before && capture.before.metrics) || {};
    const after = (capture.after && capture.after.metrics) || {};
    const keys = declared.length ? declared : [...new Set([...Object.keys(before), ...Object.keys(after)])];
    const metrics = {};
    for (const key of keys) {
      if (before[key] == null && after[key] == null) continue;
      const spec = specs[key] || {};
      metrics[key] = {
        before: before[key] ?? null,
        after: after[key] ?? null,
        ...(spec.label ? { label: spec.label } : {}),
        ...(spec.unit ? { unit: spec.unit } : {}),
        ...(spec.better ? { better: spec.better } : {}),
      };
    }
    captures.push({ subject: capture.id, frame: capture.frame || "custom", metrics });
  }
  return {
    reportDir: result.reportDir,
    preset: presetName,
    captures,
    ...(result.pdfPath ? { pdf: result.pdfPath } : {}),
    ...(result.htmlPath ? { html: result.htmlPath } : {}),
  };
}

const metadata = await readMetadata(result.reportDir);
if (wantSummary) printSummary(metadata);
if (wantJson) process.stdout.write(JSON.stringify(jsonReport(metadata), null, 2) + "\n");
process.exit(0);
