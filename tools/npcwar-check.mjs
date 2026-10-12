#!/usr/bin/env node
/* tools/npcwar-check.mjs — the fast gate for NPC War's files (< 1 s, no browser).

   games/battle.html is a thin page over src/battle/*.js, which share ONE
   script scope (docs/npcwar/ARCHITECTURE.md). Fifty agents edit those files
   at once, so the two ways to break everybody are held here:

     1  every file the page lists parses (node --check, per file);
     2  no top-level name is declared in two battle files (a second `let x`
        is a SyntaxError that kills the page; a second `function x` silently
        replaces the first — both are caught);
     3  every unit file (src/units/species|vehicles/<id>.js) parses, loads
        without THREE, registers exactly the id its file name says through
        CBZ.unitKit, and has its row in src/units/manifest.js (and every
        manifest row has its file);
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
const battle = listed.filter((r) => r.startsWith("src/battle/") || r.startsWith("src/units/"));
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

// 3: the unit files (src/units/species|vehicles/<id>.js) register exactly
// their own id, and every one of them has a manifest row (that row is what
// makes CBZ.unitKit.need() load it) and every manifest row has its file
const sb = { console, Math, JSON, Object, Array, Number, String, Boolean, Map, Set, Symbol, Error, Promise };
sb.window = sb; sb.CBZ = {};
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, "src/units/unitkit.js"), "utf8"), sb, { filename: "units/unitkit.js" });
vm.runInContext(fs.readFileSync(path.join(ROOT, "src/units/manifest.js"), "utf8"), sb, { filename: "units/manifest.js" });
const MAN = sb.CBZ.UNIT_MANIFEST;
for (const kind of ["species", "vehicles"]) {
  const dir = path.join(ROOT, "src/units", kind);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".js")) : [];
  for (const f of files) {
    const rel = "src/units/" + kind + "/" + f, id = f.replace(/\.js$/, "");
    try { execFileSync(process.execPath, ["--check", path.join(ROOT, rel)], { stdio: "pipe" }); }
    catch (e) { check(false, rel + " does not parse:\n" + String(e.stderr || e.message).split("\n").slice(0, 6).join("\n")); continue; }
    check(!!MAN[id] && MAN[id].kind === (kind === "species" ? "species" : "vehicle"), rel + " has no " + kind + " row in src/units/manifest.js");
    const before = new Set(sb.CBZ.unitKit.ids());
    try { vm.runInContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), sb, { filename: rel }); }
    catch (e) { check(false, rel + " threw at load (unit files must load without THREE): " + e.message); continue; }
    const added = sb.CBZ.unitKit.ids().filter((x) => !before.has(x));
    check(added.length === 1 && added[0] === id, rel + " must register exactly '" + id + "' (registered: " + JSON.stringify(added) + ")");
  }
}
for (const id of Object.keys(MAN)) {
  if (MAN[id].kind === "men") continue;
  const rel = "src/units/" + (MAN[id].kind === "species" ? "species" : "vehicles") + "/" + id + ".js";
  check(fs.existsSync(path.join(ROOT, rel)), "manifest row '" + id + "' has no file " + rel);
}
console.log("  " + sb.CBZ.unitKit.ids().length + " unit files register (" + sb.CBZ.unitKit.ids("species").length + " species, " + sb.CBZ.unitKit.ids("vehicle").length + " vehicles)");

// 5: the battle core is page-free: every core file loads with no DOM and no
// THREE, and its small contracts hold
const core = { console, Math, JSON, Object, Array, Number, String, Boolean, Map, Set, Symbol, Error, Promise,
  Float32Array, Uint8Array, Int32Array };
core.window = core; core.CBZ = {};
vm.createContext(core);
for (const f of ["src/units/unitkit.js", "src/units/manifest.js", "src/battle/core/roster.js", "src/battle/core/sides.js",
  "src/battle/core/series.js", "src/battle/core/host.js", "src/battle/core/store.js", "src/battle/core/lod.js"]) {
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), core, { filename: f }); check(true); }
  catch (e) { check(false, f + " must load with no DOM and no THREE: " + e.message); }
}
const C = core.CBZ;
if (C.battleRoster && C.battleSides && C.battleSeries && C.battleStore && C.battleLod && C.battleHost) {
  const R = C.battleRoster;
  check(R.size("m1_abrams*3,men*20") === 23 && R.kindAt("m1_abrams*3,men*20", 3) === "men" && R.kindAt("men|dolphin", 1) === "dolphin", "roster grammar");
  const s = C.battleSides.make({ roster: "m1_abrams*1,men*1", tier: "elite", nation: "kesh" });
  check(s.label === "1 M1 Abrams + 1 soldier" && s.army && s.vehicles, "a side is named by what is on it (" + s.label + ")");
  check(C.battleSides.make({ roster: "gorilla", n: 40 }).label === "40 gorillas" && C.battleSides.make({ roster: "bengal_tiger", n: 1 }).label === "1 Bengal tiger", "species labels");
  const S = C.battleSeries;
  check(S.record(S.make(3, 1, 0), "red").over && !S.record(S.make(5, 1, 1), "blue").over && S.record(S.make(3, 0, 0), null).a === 0, "best of N");
  const st = C.battleStore.create(64);
  for (let i = 0; i < 200; i++) st.alloc(i % 2 ? "blue" : "red", "man");
  check(st.cap >= 200 && st.count("red") === 100 && st.count("blue") === 100, "the store grows and counts");
  check(C.battleLod.animEvery(69 * 69) === 1 && C.battleLod.animEvery(149 * 149) === 2 && C.battleLod.animEvery(151 * 151) === 4, "render LOD table (70 / 150 m)");
  check(C.battleHost.validate(C.battleHost.fromCity({})).length === 0, "the city host seam satisfies the host contract");
}

// 6: ONE SIM, TWO HOSTS (src/battle/core/realm.js). Gang City compiles the
// sim files into a realm between its page layer (city/armypage.js) and its
// glue (city/armyrealm.js). Held here: every sim file is on battle.html in
// the realm's order; the names the sim reads from NPC War's page files are
// exactly the realm's PAGE_NAMES; the city's page layer declares every one;
// and the whole realm compiles (a name declared twice across the city's
// files and the sim is a SyntaxError here, not on a phone).
{
  const { pageNames, topNames } = await import("./lib/realm-names.mjs");
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/battle/core/realm.js"), "utf8"), core, { filename: "realm.js" });
  const RM = core.CBZ.battleRealm;
  check(!!RM && Array.isArray(RM.SIM), "battle/core/realm.js loads page-free");
  if (RM) {
    const order = battle.map((r) => r.replace(/^src\//, ""));
    let last = -1, inOrder = true;
    for (const f of RM.SIM) {
      const k = order.indexOf(f);
      check(k >= 0, "realm SIM file " + f + " is not on games/battle.html");
      if (k < last) inOrder = false;
      last = k;
    }
    check(inOrder, "realm SIM files are in games/battle.html's order");
    const used = pageNames(ROOT, RM.SIM);
    const miss = [...used.keys()].filter((k) => RM.PAGE_NAMES.indexOf(k) < 0);
    const extra = RM.PAGE_NAMES.filter((k) => !used.has(k));
    check(!miss.length, "the sim reads page names the realm does not list: " + miss.map((k) => k + " (" + used.get(k).owner + " <- " + used.get(k).by.join(", ") + ")").join("; "));
    check(!extra.length, "realm PAGE_NAMES lists names the sim no longer reads: " + extra.join(", "));
    const pageSrc = fs.readFileSync(path.join(ROOT, "src/city/armypage.js"), "utf8");
    const declared = new Set(topNames(pageSrc));
    const undecl = RM.PAGE_NAMES.filter((k) => !declared.has(k));
    check(!undecl.length, "city/armypage.js must declare every page name: missing " + undecl.join(", "));
    const files = ["city/armypage.js"].concat(RM.SIM, ["city/armyrealm.js"]).map((rel) => ({ name: rel, code: fs.readFileSync(path.join(ROOT, "src", rel), "utf8") }));
    const comp = RM.compile(files, { name: "city-war" });
    check(!!comp.fn, "Gang City's realm compiles: " + (comp.err ? comp.err.message : "ok"));
  }
}
console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
