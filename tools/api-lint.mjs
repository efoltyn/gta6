#!/usr/bin/env node
/* tools/api-lint.mjs — DOES THIS PAGE CALL THINGS THAT EXIST?

   OWNER DOCTRINE (2026-08-07): "no testing at all, only coding and testing for
   errors."

   A one-shot page reaches into the engine by NAME, and a name that is subtly
   wrong fails silently: `CBZ.radarScope` instead of `CBZ.radar`, `af.control`
   instead of `af.steerTo`, `predict().pos` instead of `predict().x`. Every one
   of those shipped in this repo inside a single day, and none of them is a
   syntax error, so `node --check` is blind to all of them.

   This reads a page (or any src/ file), collects every `CBZ.<name>` it
   mentions, and asks whether anything under src/ ever assigns that name. It
   proves nothing about behaviour. It catches the entire class of "you called a
   function that does not exist", which is the class that actually bites when
   writing against a 471-file engine from memory.

   Usage: node tools/api-lint.mjs                    every games/ page
          node tools/api-lint.mjs games/foo.html …   just these
   Exit 0 = every name resolves.                                             */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* Names the engine creates dynamically or that are plain data bags, so an
   assignment search will never find them. Kept short and explicit: a long
   allowlist is how a linter stops linting. */
const KNOWN = new Set([
  "CONFIG", "scene", "camera", "renderer", "clock", "game", "modes", "colliders",
  "always", "updaters", "player", "npcs", "guards", "bots", "cityPeds", "cityCops",
  "cityCars", "cityMedics", "WORLD_SEED", "MODE_CAPS", "PRIO", "now", "micro",
]);

async function walk(dir, out) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "vendor") await walk(p, out); }
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

const srcFiles = await walk(path.join(ROOT, "src"), []);
const defined = new Set(KNOWN);
const definedIn = new Map();
for (const f of srcFiles) {
  const t = await readFile(f, "utf8");
  // `CBZ.foo =`, `CBZ.foo=`, and the `const x = (CBZ.foo = CBZ.foo || {})` idiom
  for (const m of t.matchAll(/CBZ\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) {
    defined.add(m[1]);
    if (!definedIn.has(m[1])) definedIn.set(m[1], path.relative(ROOT, f));
  }
}

// studio's own verbs, which live behind CBZ.studio rather than on CBZ
const studioSrc = await readFile(path.join(ROOT, "src/core/studio.js"), "utf8");
const studioVerbs = new Set();
for (const m of studioSrc.matchAll(/CBZ\.studio\.([A-Za-z_$][\w$]*)\s*=/g)) studioVerbs.add(m[1]);
for (const m of studioSrc.matchAll(/^\s{2}CBZ\.studio\.([A-Za-z_$][\w$]*)\s*=/gm)) studioVerbs.add(m[1]);
studioVerbs.add("PACKS"); studioVerbs.add("root"); studioVerbs.add("touchDevice");

/* SECOND-LEVEL MEMBERS, which is where the real typos live: CBZ.radar.drawIt,
   CBZ.ordnance.fire, CBZ.studio.spawn. For each namespace we can find the
   owning file for, collect every member name that file ever assigns or names in
   an object literal. Deliberately loose — it is looking for names that appear
   NOWHERE in the owner, which is what a typo looks like. */
const NAMESPACES = ["studio", "ordnance", "airframe", "micro", "radar", "teammatch",
  "desertCity", "airbase", "modeCapsAudit"];
const members = new Map();
for (const ns of NAMESPACES) {
  const owner = definedIn.get(ns);
  if (!owner) continue;
  const t = await readFile(path.join(ROOT, owner), "utf8");
  const set = new Set();
  // Any member the owner file MENTIONS at all, assigned or read. Reads matter:
  // an engine hook a page installs (`ord.onShake = ...`) only ever appears in
  // the owner as `if (ord.onShake)`, and treating that as unknown would flag
  // every correctly-installed hook in the repo.
  for (const m of t.matchAll(/\.([A-Za-z_$][\w$]*)/g)) set.add(m[1]);
  for (const m of t.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) set.add(m[1]);
  members.set(ns, set);
}

let targets = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (!targets.length) {
  targets = (await readdir(path.join(ROOT, "games")))
    .filter((f) => f.endsWith(".html")).map((f) => "games/" + f);
}

let problems = 0;
const lines = [];
for (const rel of targets) {
  const text = await readFile(path.join(ROOT, rel), "utf8");
  const used = new Map();
  for (const m of text.matchAll(/CBZ\.([A-Za-z_$][\w$]*)/g)) {
    // ignore the ones the page itself is defining (a page may extend CBZ)
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 3);
    if (/^\s*=[^=]/.test(after)) { defined.add(m[1]); continue; }
    if (!used.has(m[1])) used.set(m[1], 0);
    used.set(m[1], used.get(m[1]) + 1);
  }
  const missing = [...used.keys()].filter((n) => !defined.has(n));
  const badVerbs = [];
  // A PAGE MAY INSTALL AN ENGINE HOOK. `CBZ.ordnance.onShake = fn` is the page
  // filling in a slot the engine reads, not a call into something missing.
  const installed = new Set();
  for (const m of text.matchAll(/CBZ\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) {
    installed.add(m[1] + "." + m[2]);
  }
  for (const m of text.matchAll(/CBZ\.studio\.([A-Za-z_$][\w$]*)/g)) {
    if (!studioVerbs.has(m[1]) && !installed.has("studio." + m[1]) && !badVerbs.includes(m[1])) badVerbs.push(m[1]);
  }
  // second level
  for (const [ns, set] of members) {
    if (ns === "studio") continue;                 // already handled, more precisely
    const re = new RegExp("CBZ\\." + ns + "\\.([A-Za-z_$][\\w$]*)", "g");
    for (const m of text.matchAll(re)) {
      const key = ns + "." + m[1];
      if (!set.has(m[1]) && !installed.has(key) && !badVerbs.includes(key)) badVerbs.push(key);
    }
  }
  const bad = missing.length + badVerbs.length;
  problems += bad;
  lines.push((bad ? "  FAIL " : "  ok   ") + rel.padEnd(34) +
    used.size + " engine names" + (studioVerbs.size && /CBZ\.studio/.test(text) ? ", studio" : "") +
    (bad ? "   UNRESOLVED: " + missing.concat(badVerbs.map((v) => v.indexOf(".") < 0 ? "studio." + v : "CBZ." + v)).join(", ") : ""));
}

console.log(lines.join("\n"));
console.log("\n" + defined.size + " names are assigned somewhere under src/; " +
  studioVerbs.size + " studio verbs.");
if (problems) { console.error("API-LINT: FAIL — " + problems + " unresolved name(s)"); process.exit(1); }
console.log("API-LINT: ok — every CBZ name these pages call is assigned in the engine.");
