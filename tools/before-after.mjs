#!/usr/bin/env node
/* tools/before-after.mjs — the EASY button for the before/after tool.

   tools/visual-compare.mjs is the engine and it is flag-rich; every run of it
   in practice starts with the same three decisions (which preset, what is
   "before", don't block on a PDF viewer). This wrapper makes those decisions
   so a comparison is ONE argument:

       node tools/before-after.mjs                 → list every preset
       node tools/before-after.mjs beach-shores    → run one, sane defaults
       npm run ba -- beach-shores                  → same thing
       node tools/before-after.mjs beach-shores --before https://efoltyn.github.io/gta6/
                                                   → any engine flag passes through

   Defaults it applies (each one only when you did not pass it yourself):
     --before   the preset's own defaultBefore if it declares one (flag-A/B
                presets compare this checkout against itself with the flag
                off), otherwise the deployed build
     --keep-going  one broken subject becomes an error page, not a dead run
     --no-open     headless/CI friendly; the report path prints instead

   Everything else — devices, subjects, reuse-before, out dir — passes
   straight through to visual-compare.mjs unchanged.

   ---------------------------------------------------------------------------
   AND IT READS THE ANSWER BACK. The engine writes screenshots, an HTML contact
   sheet, a PDF and a metadata.json, and then prints a PATH — which is the right
   output for a person with a screen and a useless one for anyone (a CI job, an
   agent, an ssh session) who cannot open a PDF. The numbers were already in the
   report; the only way to see them was to look at it. So when a run finishes,
   this prints the preset's own MEASUREMENTS TABLE — every metric it declared,
   before against after, with the delta and whether that delta went the way the
   preset says is better — straight to stdout. `--no-summary` turns it off.

   The listing at the top also says which presets are flag A/B (`self`) rather
   than comparisons against the deployed build, because that is the first thing
   you need to know before trusting a "before" column. */

import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PRESET_DIR = path.join(ROOT, "tools", "visual-presets");
const DEPLOYED = "https://efoltyn.github.io/gta6/";

const argv = process.argv.slice(2);
const presetName = argv[0] && !argv[0].startsWith("--") ? argv[0] : null;
const rest = presetName ? argv.slice(1) : argv;

if (!presetName || presetName === "help") {
  const files = (await readdir(PRESET_DIR)).filter((f) => f.endsWith(".mjs")).sort();
  process.stdout.write("before/after — pick a preset:\n\n");
  for (const f of files) {
    let title = "", baseline = "deployed";
    try {
      const mod = await import(pathToFileURL(path.join(PRESET_DIR, f)).href);
      title = (mod.default && mod.default.title) || "";
      // WHAT IS THE "BEFORE"? A flag-A/B preset compares this checkout against
      // itself with one switch off, which is a far stronger claim than a diff
      // against a build that is forty commits old — and you cannot tell which
      // kind you are looking at from the name. Say it in the listing.
      if (mod.default && mod.default.defaultBefore === "local") baseline = "self";
      else if (mod.default && mod.default.defaultBefore) baseline = "pinned";
    } catch (_) { title = "(failed to load)"; }
    process.stdout.write(`  ${f.replace(/\.mjs$/, "").padEnd(26)} ${baseline.padEnd(9)} ${title}\n`);
  }
  process.stdout.write(
    "\nusage: node tools/before-after.mjs <preset> [visual-compare flags]\n" +
    "       npm run ba -- <preset>\n" +
    "baseline column: self = flag A/B against this same checkout (strongest),\n" +
    "                 pinned = the preset names its own before, deployed = the live site.\n" +
    "The report (screenshots + HTML + PDF) lands in artifacts/visual-comparisons/,\n" +
    "its path prints when the run finishes, and the preset's measurements table\n" +
    "prints with it (--no-summary to suppress).\n");
  process.exit(presetName === "help" ? 0 : 1);
}

// resolve the preset the same way the engine does, to read its declared shape
const presetPath = presetName.includes("/") || presetName.endsWith(".mjs")
  ? path.resolve(ROOT, presetName)
  : path.join(PRESET_DIR, `${presetName}.mjs`);
let preset = null;
try { preset = (await import(pathToFileURL(presetPath).href)).default; }
catch (err) {
  process.stderr.write(`No such preset: ${presetName} (${err.message})\n` +
    "Run with no arguments to list what exists.\n");
  process.exit(1);
}

const has = (flag) => rest.some((a) => a === flag || a.startsWith(flag + "="));
const wantSummary = !has("--no-summary");
const passThrough = rest.filter((a) => a !== "--no-summary");
const args = ["tools/visual-compare.mjs", "--preset", presetName, ...passThrough];
if (!has("--before")) args.push("--before", preset && preset.defaultBefore ? String(preset.defaultBefore) : DEPLOYED);
if (!has("--keep-going")) args.push("--keep-going");
if (!has("--no-open")) args.push("--no-open");

// where the engine will write, so the summary can find metadata.json without
// scraping stdout. Same default the engine computes, and --out wins if given.
const outFlagIdx = passThrough.findIndex((a) => a === "--out" || a.startsWith("--out="));
let outDir = null;
if (outFlagIdx >= 0) {
  const raw = passThrough[outFlagIdx];
  outDir = raw.includes("=") ? raw.slice(raw.indexOf("=") + 1) : passThrough[outFlagIdx + 1];
  if (outDir) outDir = path.resolve(ROOT, outDir);
}

/* THE MEASUREMENTS TABLE, ON STDOUT.

   Everything needed for it is already in the run's metadata.json — the engine
   writes each subject's `metrics` on both sides — and the only place it was
   ever rendered was a page of the PDF. That is fine for a person and useless
   for the two callers this wrapper mostly has: a CI job and an agent, neither
   of which can open a PDF. So read the file back and print what the preset
   declared in `preset.metrics`, before against after, with the delta marked
   against the direction the preset says is better.

   Only DECLARED metrics are printed, deliberately: a stage function often
   returns a full audit dump so the metadata can answer later questions, and
   printing all of it would reproduce the wall of numbers the report's own
   whitelist exists to prevent. */
function fmt(v) {
  if (v == null) return "—";
  if (typeof v !== "number") return String(v);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
async function printSummary(dir) {
  let meta;
  try { meta = JSON.parse(await readFile(path.join(dir, "metadata.json"), "utf8")); }
  catch (_) { return; }
  const specs = (preset && preset.metrics) || {};
  const keys = Object.keys(specs);
  if (!keys.length || !meta.captures) return;
  const rows = [];
  for (const cap of meta.captures) {
    const b = cap.before && cap.before.metrics, a = cap.after && cap.after.metrics;
    if (!b && !a) continue;
    for (const k of keys) {
      if ((!b || b[k] == null) && (!a || a[k] == null)) continue;
      rows.push({ subject: cap.id, key: k, before: b ? b[k] : null, after: a ? a[k] : null });
    }
  }
  if (!rows.length) return;
  const w = (sel, min) => Math.max(min, ...rows.map((r) => String(sel(r)).length));
  const wS = w((r) => r.subject, 7), wM = Math.max(7, ...keys.map((k) => (specs[k].label || k).length));
  process.stdout.write(`\nMEASUREMENTS — ${meta.preset && meta.preset.title ? meta.preset.title : presetName}\n`);
  let lastSubject = null;
  for (const r of rows) {
    if (r.subject !== lastSubject) {
      process.stdout.write(`\n  ${r.subject}\n`);
      lastSubject = r.subject;
    }
    const spec = specs[r.key] || {};
    let mark = " ";
    if (typeof r.before === "number" && typeof r.after === "number" && r.after !== r.before) {
      const up = r.after > r.before;
      mark = spec.better === "lower" ? (up ? "✗" : "✓") : spec.better === "higher" ? (up ? "✓" : "✗") : "·";
    }
    process.stdout.write(
      `    ${mark} ${(spec.label || r.key).padEnd(wM)}  ` +
      `${fmt(r.before).padStart(8)} → ${fmt(r.after).padStart(8)}` +
      `${spec.unit ? "  " + spec.unit : ""}\n`);
  }
  if (preset && preset.metricsNote) process.stdout.write(`\n  ${preset.metricsNote}\n`);
  void wS;
}

process.stdout.write(`before/after → node ${args.join(" ")}\n`);
// the engine prints the report directory it chose; catch it so the summary can
// read that run's metadata even when --out was not given.
let reportDir = outDir;
const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ["inherit", "pipe", "inherit"] });
let tail = "";
child.stdout.on("data", (chunk) => {
  const text = String(chunk);
  process.stdout.write(text);
  tail = (tail + text).slice(-4000);
});
child.on("exit", async (code) => {
  if (wantSummary) {
    if (!reportDir) {
      const m = tail.match(/artifacts\/visual-comparisons\/[^\s"']+/g);
      if (m && m.length) reportDir = path.resolve(ROOT, path.dirname(m[m.length - 1]).replace(/\/$/, ""));
    }
    if (reportDir) { try { await printSummary(reportDir); } catch (_) {} }
  }
  process.exit(code == null ? 1 : code);
});
