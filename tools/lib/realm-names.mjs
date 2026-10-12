/* tools/lib/realm-names.mjs — WHAT THE SIM ASKS ITS PAGE FOR.

   The battle sim (src/battle/core/realm.js SIM) shares one scope with NPC
   War's page files on games/battle.html. A second host (Gang City) compiles
   the same sim into a realm with its OWN page layer, so it has to declare
   every name a sim file reads from a non-sim battle file. This finds them:
   the top-level names of every battle file the page lists, minus the sim's
   own, that a sim file uses as a bare identifier (comments, strings and
   property accesses stripped; a name the sim file declares itself anywhere
   is its own local). Used by tools/npcwar-check.mjs. */
import fs from "node:fs";
import path from "node:path";

const TOP = /^(?:async\s+)?(?:function\*?\s+([A-Za-z_$][\w$]*)|(?:let|const|var|class)\s+([^=;(]+?)\s*(?:=|;))/gm;
export function topNames(src) {
  const out = [];
  for (const m of src.matchAll(TOP)) {
    const names = m[1] ? [m[1]] : m[2].split(",").map((s) => s.trim().replace(/\s*=.*$/, "")).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
    out.push(...names);
  }
  return out;
}
// comments, strings and template text out (good enough for this code base:
// regex literals here never hold quotes that would confuse it)
export function strip(src) {
  let out = "", i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      i++; out += " 0 "; continue;
    }
    out += c; i++;
  }
  return out;
}
const LOCAL = (name) => new RegExp("\\b(?:const|let|var|function)\\s+" + name.replace(/\$/g, "\\$") + "\\b");
const PARAM = (name) => new RegExp("function\\s*[\\w$]*\\s*\\([^)]*\\b" + name.replace(/\$/g, "\\$") + "\\b[^)]*\\)");
export function pageNames(root, simFiles) {
  const html = fs.readFileSync(path.join(root, "games/battle.html"), "utf8");
  const listed = [...html.matchAll(/<script src="\.\.\/src\/(battle\/[^"?]+)/g)].map((m) => m[1]);
  const sim = new Set(simFiles);
  const decl = new Map();
  const simSrc = {};
  for (const rel of listed) {
    const src = fs.readFileSync(path.join(root, "src", rel), "utf8");
    if (sim.has(rel)) { simSrc[rel] = strip(src); continue; }
    if (rel.startsWith("battle/core/")) continue;          // page-free modules on CBZ, not scope names
    for (const nm of topNames(src)) decl.set(nm, rel);
  }
  const simDecl = new Set();
  for (const rel of simFiles) for (const nm of topNames(fs.readFileSync(path.join(root, "src", rel), "utf8"))) simDecl.add(nm);
  const used = new Map();
  for (const [nm, owner] of decl) {
    if (simDecl.has(nm)) continue;
    // a bare use, not a property (a.cam) and not an object key ({ cam: 1 })
    const re = new RegExp("(?<![\\w$.])" + nm.replace(/\$/g, "\\$") + "(?![\\w$])(?!\\s*:(?!:))");
    for (const rel of simFiles) {
      const s = simSrc[rel];
      if (!s || !re.test(s)) continue;
      if (LOCAL(nm).test(s) || PARAM(nm).test(s)) continue;   // its own local of the same name
      if (!used.has(nm)) used.set(nm, { owner, by: [] });
      used.get(nm).by.push(rel);
    }
  }
  return used;
}
