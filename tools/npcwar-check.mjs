#!/usr/bin/env node
/* tools/npcwar-check.mjs — the fast gate for NPC War's files (< 1 s, no browser).

   games/battle.html is a thin page over src/battle/*.js, which share ONE
   script scope (docs/npcwar/ARCHITECTURE.md). Fifty agents edit those files
   at once, so the two ways to break everybody are held here:

     1  every file the page lists parses (node --check, per file);
     2  no top-level name is declared in two battle files (a second `let x`
        is a SyntaxError that kills the page; a second `function x` silently
        replaces the first — both are caught);
     3  every unit file (src/battle/units/**, species + vehicles) parses and
        registers exactly the id its file name says, through CBZ.unitKit;
     4  every <script src> the page lists exists on disk.

     node tools/npcwar-check.mjs                                              */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log("  FAIL " + msg); } };

const html = fs.readFileSync(path.join(ROOT, "games/battle.html"), "utf8");
const listed = [...html.matchAll(/<script src="\.\.\/([^"?]+)/g)].map((m) => m[1]);
for (const rel of listed) check(fs.existsSync(path.join(ROOT, rel)), "page lists a missing file: " + rel);
const battle = listed.filter((r) => r.startsWith("src/battle/"));
check(battle.length > 10, "the page lists its src/battle files (" + battle.length + ")");

// 1 + 2
const seen = new Map();
const TOP = /^(?:async\s+)?(?:function\*?\s+([A-Za-z_$][\w$]*)|(?:let|const|var|class)\s+([^=;(]+?)\s*(?:=|;))/gm;
for (const rel of battle) {
  const file = path.join(ROOT, rel);
  try { execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }); check(true); }
  catch (e) { check(false, rel + " does not parse:\n" + String(e.stderr || e.message).split("\n").slice(0, 6).join("\n")); continue; }
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(TOP)) {
    const names = m[1] ? [m[1]] : m[2].split(",").map((s) => s.trim().replace(/\s*=.*$/, "")).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
    for (const n of names) {
      if (seen.has(n) && seen.get(n) !== rel) check(false, "top-level `" + n + "` is declared in both " + seen.get(n) + " and " + rel);
      else seen.set(n, rel);
    }
  }
}

// 3: the unit files register themselves under their own id
const UNITS = path.join(ROOT, "src/battle/units");
const unitFiles = [];
(function walk(d) { if (!fs.existsSync(d)) return; for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith(".js")) unitFiles.push(p); } })(UNITS);
const sb = { console, Math, JSON, Object, Array, Number, String, Boolean, Map, Set, Symbol, Error };
sb.window = sb; sb.CBZ = {};
vm.createContext(sb);
const kitFile = path.join(ROOT, "src/battle/unitkit.js");
if (fs.existsSync(kitFile)) {
  vm.runInContext(fs.readFileSync(kitFile, "utf8"), sb, { filename: "unitkit.js" });
  for (const p of unitFiles) {
    const rel = path.relative(ROOT, p);
    if (/\/_[^/]*\.js$/.test(rel)) continue;            // shared helpers (_rig.js ...) register nothing
    const id = path.basename(p, ".js");
    const before = new Set(sb.CBZ.unitKit.ids());
    try { vm.runInContext(fs.readFileSync(p, "utf8"), sb, { filename: rel }); }
    catch (e) { check(false, rel + " threw at load: " + e.message); continue; }
    const added = sb.CBZ.unitKit.ids().filter((x) => !before.has(x));
    check(added.length === 1 && added[0] === id, rel + " must register exactly '" + id + "' (registered: " + JSON.stringify(added) + ")");
    check(battle.includes(rel) || !html.length, rel + " is on disk but games/battle.html does not load it");
  }
  console.log("  " + sb.CBZ.unitKit.ids().length + " units registered (" + sb.CBZ.unitKit.ids("species").length + " species, " + sb.CBZ.unitKit.ids("vehicle").length + " vehicles)");
}
console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
