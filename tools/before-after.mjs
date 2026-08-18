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
   straight through to visual-compare.mjs unchanged. */

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
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
    let title = "";
    try {
      const mod = await import(pathToFileURL(path.join(PRESET_DIR, f)).href);
      title = (mod.default && mod.default.title) || "";
    } catch (_) { title = "(failed to load)"; }
    process.stdout.write(`  ${f.replace(/\.mjs$/, "").padEnd(26)} ${title}\n`);
  }
  process.stdout.write(
    "\nusage: node tools/before-after.mjs <preset> [visual-compare flags]\n" +
    "       npm run ba -- <preset>\n" +
    "The report (screenshots + HTML + PDF) lands in artifacts/visual-comparisons/\n" +
    "and its path prints when the run finishes.\n");
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
const args = ["tools/visual-compare.mjs", "--preset", presetName, ...rest];
if (!has("--before")) args.push("--before", preset && preset.defaultBefore ? String(preset.defaultBefore) : DEPLOYED);
if (!has("--keep-going")) args.push("--keep-going");
if (!has("--no-open")) args.push("--no-open");

process.stdout.write(`before/after → node ${args.join(" ")}\n`);
const child = spawn(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
child.on("exit", (code) => process.exit(code == null ? 1 : code));
