#!/usr/bin/env node
/* tools/map-labels-check.mjs — EVERY WORD THE MAP CAN PRINT, AND NONE OF IT AN ID.

   OWNER (on the iPad map): "The map says things like 'approach one',
   'approach two' at the end of a bunch of places. That's really stupid."
   Those were builder keys: govcomplex.js filed each access-road leg as a
   region named "<Place> Approach N" and the map letters every region.

   This lists the strings the map can letter and fails on id-like ones:
     1. every region the live world registers for this seed (the slice
        manifest is the recorded copy of exactly that), passed through the
        map's OWN placeLabel(), lifted out of systems/fullmap.js, so this tests
        the rule the map runs, not a copy of it;
     2. every region / water body a builder registers, read from source,
        with composed names ("X + ' Approach ' + (i + 1)") rendered;
     3. the road names (highwaynet.js route tables), the district name pool,
        and every capitalised `name: "..."` in the place builders.
   Id-like = an index on a part-of-a-road word (approach 2, link 3, leg,
   seg, stub, spur 4), "#3", "(2)", underscores, camelCase, or an em dash /
   middle dot (signage law).
   No browser. Usage: node tools/map-labels-check.mjs [--list]   Exit 0 = clean. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LIST = process.argv.includes("--list");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ---- 0. the map's own rule ------------------------------------------------
const FM = read("src/systems/fullmap.js");
const a = FM.indexOf("  function isLink(rg)"), b = FM.indexOf("CBZ.mapLabelIdLike = idLike;");
if (a < 0 || b < 0) { console.error("FAIL: placeLabel block not found in systems/fullmap.js"); process.exit(1); }
const ctx = vm.createContext({ CBZ: {} });
vm.runInContext(FM.slice(a, b + "CBZ.mapLabelIdLike = idLike;".length), ctx);
const placeLabel = ctx.CBZ.mapPlaceName, idLike = ctx.CBZ.mapLabelIdLike;

const bad = [], labels = new Map();   // label -> where
function seen(str, where) {
  if (!str) return;
  if (!labels.has(str)) labels.set(str, where);
  if (idLike(str)) bad.push(str + "   <- " + where);
}

// ---- 1. the recorded live region list --------------------------------------
{
  const src = read("src/city/slice_manifest.js");
  const pre = "window.CBZ.SLICE_MANIFEST = ";
  const M = JSON.parse(src.slice(src.indexOf(pre) + pre.length, src.lastIndexOf(";")));
  let n = 0, kept = 0;
  for (const k in M.builders) {
    for (const r of (M.builders[k].data && M.builders[k].data.regions) || []) {
      n++;
      // registerCityRegion's own normalisation: a road strip never letters
      const reg = Object.assign({}, r); if (reg.road) reg.mapLabel = false;
      const nm = placeLabel(reg);
      if (nm) { kept++; seen(nm, "region (manifest " + k + ")"); }
      // a road strip may keep an internal name, but never a numbered one
      else if (/\b(approach|link|leg|seg|segment|stub|spur)\s*\d+\b/i.test(r.name || "")) bad.push(r.name + "   <- numbered road strip (manifest " + k + ")");
    }
  }
  if (LIST) console.log("manifest regions: " + n + ", lettered: " + kept);
}

// ---- 2. region / water registrations in source ----------------------------
function balanced(s, i) {           // s[i] === "{" -> index after the matching "}"
  let d = 0, q = null;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (q) { if (c === "\\") j++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === "{") d++; else if (c === "}" && --d === 0) return j + 1;
  }
  return -1;
}
function topValue(obj, key) {       // the expression after `key:` up to the next top-level comma
  const m = new RegExp("[{,\\s]" + key + "\\s*:").exec(obj); if (!m) return null;
  let j = m.index + m[0].length, d = 0, q = null, out = "";
  for (; j < obj.length; j++) {
    const c = obj[j];
    if (q) { out += c; if (c === "\\") { out += obj[++j]; } else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; out += c; continue; }
    if ("([{".includes(c)) d++;
    if (")]}".includes(c)) { if (d === 0) break; d--; }
    if (c === "," && d === 0) break;
    out += c;
  }
  return out.trim();
}
function render(expr) {             // "a.name + ' Approach ' + (i + 1)" -> "Place Approach 1"
  const parts = []; let d = 0, q = null, cur = "";
  for (let j = 0; j < expr.length; j++) {
    const c = expr[j];
    if (q) { cur += c; if (c === "\\") cur += expr[++j]; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; cur += c; continue; }
    if (c === "(") d++; if (c === ")") d--;
    if (c === "+" && d === 0) { parts.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  parts.push(cur.trim());
  return parts.map(function (p) {
    const lit = /^(["'`])([\s\S]*)\1$/.exec(p);
    if (lit) return lit[2];
    if (/^\(?\s*[a-z]\w{0,2}\s*(\+\s*\d+)?\s*\)?$/.test(p) || /^\d+$/.test(p)) return "1";   // i, k, (i + 1)
    return "Place";
  }).join("");
}
const BUILDERS = fs.readdirSync(path.join(ROOT, "src/city")).filter((f) => f.endsWith(".js") && f !== "slice_manifest.js").map((f) => "src/city/" + f)
  .concat(["src/games/jail.js"]);
for (const rel of BUILDERS) {
  const s = read(rel);
  const re = /registerCity(Region|WaterBody)\s*\(/g; let m;
  while ((m = re.exec(s))) {
    const o = s.indexOf("{", m.index); if (o < 0 || o - m.index > 200) continue;
    const e = balanced(s, o); if (e < 0) continue;
    const obj = s.slice(o, e);
    const line = s.slice(0, m.index).split("\n").length;
    if (/^\s*(\/\/|\*)/.test(s.slice(s.lastIndexOf("\n", m.index) + 1, m.index))) continue;   // a comment
    const ex = topValue(obj, "name"); if (!ex) continue;
    if (/Object\.assign/.test(s.slice(m.index, o))) {}
    const nm = render(ex);
    const quiet = /\broad\s*:\s*true\b/.test(obj) || /\bmapLabel\s*:\s*false\b/.test(obj) || /\bunderlay\s*:\s*true\b/.test(obj);
    const where = rel + ":" + line;
    if (quiet) {
      if (/\b(approach|link|leg|seg|segment|stub|spur)\s*\d+\b/i.test(nm)) bad.push(nm + "   <- numbered road strip " + where);
      continue;
    }
    seen(nm, where);
  }
}

// ---- 3. road names, district pool, capitalised place names ---------------
{
  const hn = read("src/city/highwaynet.js");
  for (const m of hn.matchAll(/\bname:\s*"([^"]+)"/g)) seen(m[1], "highwaynet.js route");
  for (const m of hn.matchAll(/\bR\("C\d+",\s*"([^"]+)"/g)) seen(m[1], "highwaynet.js country road");
  const mp = read("src/city/metroplan.js");
  const pool = mp.slice(mp.indexOf("const NAME_POOL"), mp.indexOf("};", mp.indexOf("const NAME_POOL")));
  for (const m of pool.matchAll(/"([^"]+)"/g)) seen(m[1], "metroplan.js district pool");
  const PLACES = ["metro.js", "countries.js", "settlements.js", "citytemplates.js", "villagekit.js", "minicities.js",
    "river.js", "countryside.js", "zoning.js", "towngen.js", "govcomplex.js", "airport_kit.js", "bunkers.js"];
  for (const f of PLACES) {
    const rel = "src/city/" + f; if (!fs.existsSync(path.join(ROOT, rel))) continue;
    for (const m of read(rel).matchAll(/\bname:\s*"([A-Z][^"]*)"/g)) seen(m[1], rel);
  }
  // literal words the map draws itself
  for (const m of FM.matchAll(/mapLabel\(\s*"([^"]+)"/g)) seen(m[1], "fullmap.js mapLabel");
}

if (LIST) for (const [k, v] of [...labels.entries()].sort()) console.log(k.padEnd(44) + " " + v);
console.log("map label strings: " + labels.size + ", id-like: " + bad.length);
if (bad.length) { for (const x of bad) console.log("  FAIL " + x); process.exit(1); }
console.log("PASS");
