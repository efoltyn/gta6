#!/usr/bin/env node
// Prints a map of the repo to stdout. Nothing reads this at startup and it
// writes no file — it is here so a session that wants the layout can get it in
// one call instead of a dozen globs, and pays nothing on the messages where it
// doesn't.
//
//   node tools/claude-tree.mjs            everything you could edit
//   node tools/claude-tree.mjs --engine   src/ modules only, no vendor
//   node tools/claude-tree.mjs --all      include assets and vendor too
//
// Default view omits three things on purpose:
//   assets/     you look a clip up in audio.js, you never guess its name
//   src/vendor/ three.js and loaders, vendored, not ours to edit
//   archive/    83 of its 84 paths shadow a live src/ path exactly, so in a
//               flat list they read as real modules. That is a trap, not a map.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIDTH = 94;

const argv = new Set(process.argv.slice(2));
const ALL = argv.has("--all");
const ENGINE = argv.has("--engine");

const HIDE = [/^scrolls\//];
if (!ALL) HIDE.push(/^assets\//, /^src\/vendor\//, /^archive\//);
if (ENGINE) HIDE.push(/^(?!src\/)/, /^src\/vendor\//);

// -c -o --exclude-standard: tracked PLUS untracked-not-ignored, so a file you
// just added shows up before it is committed. existsSync because `ls-files`
// still reports a tracked file you have deleted.
const files = execFileSync(
  "git",
  ["ls-files", "-c", "-o", "--exclude-standard", "--deduplicate"],
  { cwd: ROOT, encoding: "utf8" },
)
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((p) => !HIDE.some((re) => re.test(p)))
  .filter((p) => existsSync(resolve(ROOT, p)));

const dirs = new Map();
for (const p of files) {
  const i = p.lastIndexOf("/");
  const d = i === -1 ? "." : p.slice(0, i);
  if (!dirs.has(d)) dirs.set(d, []);
  dirs.get(d).push(i === -1 ? p : p.slice(i + 1));
}

// lossless: stem.m4a + stem.ogg -> stem.{m4a,ogg}
function collapse(list) {
  const stems = new Map();
  for (const f of [...list].sort()) {
    const i = f.lastIndexOf(".");
    const [stem, ext] = i <= 0 ? [f, null] : [f.slice(0, i), f.slice(i + 1)];
    if (!stems.has(stem)) stems.set(stem, []);
    stems.get(stem).push(ext);
  }
  return [...stems].map(([stem, exts]) => {
    if (exts.length === 1) return exts[0] === null ? stem : `${stem}.${exts[0]}`;
    const named = exts.filter((e) => e !== null);
    return `${stem}.{${named.join(",")}}` + (exts.includes(null) ? `  ${stem}` : "");
  });
}

function wrap(tokens, width) {
  const out = [];
  let line = "";
  for (const t of tokens) {
    const next = line ? `${line}  ${t}` : t;
    if (line && next.length > width) {
      out.push(line);
      line = t;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

const order = [...dirs.keys()].sort((a, b) =>
  a === "." ? -1 : b === "." ? 1 : a < b ? -1 : a > b ? 1 : 0,
);

const out = ["gta6/"];
for (const d of order) {
  out.push(d === "." ? "  ./" : `  ${d}/`);
  for (const l of wrap(collapse(dirs.get(d)), WIDTH)) out.push(`    ${l}`);
}
console.log(out.join("\n"));
console.error(`\n[claude-tree] ${files.length} files, ${dirs.size} folders`);
