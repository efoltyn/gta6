#!/usr/bin/env node
/* tools/dialogue-spoiler-check.mjs - NOBODY TELLS YOU THE WAY OUT.

   Owner, 2026-09-28: "Nobody should ever tell you to go in the gun room.
   That should be something you figure out on your own. Nothing should tell
   you that." This pure-node check reads every sentence the prison can say
   (string literals that read as a spoken line, comments skipped) and fails
   when one names the gun room, the armory, the keycard, a crawl/cut route or
   a way out. The few lines allowed to name those places are REACTIONS to a
   player already standing there (a CO yelling in the gun room) or the lock
   speaking for itself when pressed; each carries its reason below.

   Also: the escape plan panel lists no routes, quests.js has no chain intel
   or armory favour, every prison line is short and free of em dashes and
   middle dots, and systems/prisonvoice.js reacts to what it should.
       node tools/dialogue-spoiler-check.mjs */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let failed = 0;
const fail = (m) => { failed++; console.log("  FAIL " + m); };
const ok = (m) => console.log("  ok   " + m);

const FILES = [
  "src/entities/ai.js", "src/entities/npc.js", "src/entities/guards.js",
  "src/systems/quests.js", "src/systems/economy.js", "src/systems/escapeplan.js",
  "src/systems/prisonvoice.js", "src/systems/prisonwarden.js", "src/systems/prisonfriends.js",
  "src/systems/detection.js", "src/systems/brain_prison.js", "src/systems/interact.js",
  "src/systems/capture.js", "src/systems/intimidate.js", "src/systems/interactions.js",
  "src/world/cellblock.js", "src/world/gunroom.js", "src/world/adminwing.js",
];
// a spoiler names the place/tool/route the player is meant to find
const SPOILER = /gun[ -]?room|armou?ry|key ?card|culvert|\bgrate\b|\bvents?\b|tunnel|ditch|sewer|\bdrain\b|hacksaw|searchlight|blind spot|side gate|back gate|way out|get you out|escape route|the fence\b|far fence|cut (it|the|through)|crawl/i;
const ALLOW = new Map([
  ["Gun room! Stand still!", "a CO yelling at a man already inside it (detection.js)"],
  ["The armory door needs a Keycard.", "the reader speaking for itself when pressed (gunroom.js)"],
  ["You tried my fence.", "the warden naming what you already did (prisonwarden.js)"],
  ["On the fence! Stop!", "a CO yelling at a man already on it (detection.js)"],
  ["The grate is welded again.", "the screws undoing your own cut after a shakedown (escapeplan.js)"],
]);
const STR = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
function spokenLiterals(file) {
  const out = [];
  const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
  let inBlock = false;
  lines.forEach((ln, i) => {
    let t = ln.trim();
    if (inBlock) { if (t.includes("*/")) { inBlock = false; t = t.slice(t.indexOf("*/") + 2).trim(); } else return; }
    if (t.startsWith("/*") && !t.includes("*/")) { inBlock = true; return; }
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    let m; STR.lastIndex = 0;
    while ((m = STR.exec(ln))) {
      const s = m[2];
      // a spoken line: a capitalised run of words ending in . ! or ?
      if (s.length < 6 || !/ /.test(s) || !/^[A-Z"'.(]/.test(s) || !/[.!?]$/.test(s)) continue;
      if (/[{}=;<>]|\\n/.test(s) && !/\$\{/.test(s)) continue;
      out.push({ file, line: i + 1, s });
    }
  });
  return out;
}

console.log("DIALOGUE SPOILERS");
let all = [];
for (const f of FILES) all = all.concat(spokenLiterals(f));
let spoilers = 0;
for (const L of all) {
  if (!SPOILER.test(L.s) || ALLOW.has(L.s)) continue;
  spoilers++;
  fail(`${L.file}:${L.line} tells the player the way: ${JSON.stringify(L.s)}`);
}
if (!spoilers) ok(`${all.length} prison lines, none names the gun room, a key, a route or a way out`);

let punct = 0;
for (const L of all) if (/[—·]/.test(L.s)) { punct++; fail(`${L.file}:${L.line} em dash or middle dot: ${JSON.stringify(L.s)}`); }
if (!punct) ok("no em dashes or middle dots in a prison line");

// ---- the two walkthroughs that were deleted stay deleted -------------------
const quests = readFileSync(join(ROOT, "src/systems/quests.js"), "utf8");
if (/CHAIN_TALK|chainLine|type: "armory"/.test(quests)) fail("quests.js grew back the gun-room intel or the armory favour");
else ok("quests.js: no chain intel, no armory favour");
const plan = readFileSync(join(ROOT, "src/systems/escapeplan.js"), "utf8");
if (/function (gateRoute|culvertRoute|favourRoute)\b|ep-routes/.test(plan)) fail("escapeplan.js lists routes again");
else ok("escapeplan.js: the plan panel lists no routes");

// ---- systems/prisonvoice.js: short lines, and it answers the right thing ---
const voiceSrc = readFileSync(join(ROOT, "src/systems/prisonvoice.js"), "utf8");
let seq = 0;
const CBZ = {
  game: { mode: "escape", state: "playing", elapsed: 400, role: "inmate", kos: 0 },
  player: { pos: { x: 0, z: 0 }, hp: 100 },
  econ: { rng: () => ((seq = (seq * 9301 + 49297) % 233280) / 233280) },
  onUpdate() {},
  equippedWeapon: () => null,
};
const box = { window: { CBZ }, Math, String, Object };
box.window.window = box.window;
vm.createContext(box);
vm.runInContext(voiceSrc, box);
const PV = CBZ.prisonVoice;
let long = 0;
for (const k in PV.lines) for (const l of PV.lines[k]) {
  if (l.length > 56) { long++; fail(`prisonvoice ${k} line over 56 chars: ${l}`); }
  if (SPOILER.test(l)) fail(`prisonvoice ${k} line is a spoiler: ${l}`);
}
if (!long) ok("prisonvoice: every line fits over a head");
const inmate = { kind: "inmate", data: { name: "Vince" } };
const guard = { kind: "guard", data: { name: "Officer Diaz" } };
const hit = (list, line) => list.indexOf(line) >= 0;
CBZ.equippedWeapon = () => ({ id: "sidearm", melee: false });
if (hit(PV.lines.seesGun, PV.react(inmate))) ok("a man sees the gun in your hand"); else fail("gun in hand not noticed");
CBZ.equippedWeapon = () => ({ id: "shank", melee: true });
if (hit(PV.lines.seesBlade, PV.react(inmate))) ok("a man sees the shank"); else fail("shank not noticed");
CBZ.equippedWeapon = () => null;
CBZ.player.hp = 20;
if (hit(PV.lines.hurt, PV.react(inmate))) ok("a man sees you bleeding"); else fail("blood not noticed");
CBZ.player.hp = 100;
CBZ.game.role = "cop";
if (hit(PV.lines.toCop, PV.react(inmate))) ok("an inmate talks to the uniform"); else fail("uniform not noticed");
CBZ.game.role = "inmate";
let gl = 0; for (let i = 0; i < 40; i++) { const r = PV.react(guard); if (r && !hit(PV.lines.coProcedure, r)) gl++; }
if (!gl) ok("a CO answers only with procedure"); else fail("a CO said something that is not procedure");
CBZ.game.mode = "city";
if (PV.react(inmate) === null) ok("silent outside the prison"); else fail("prisonvoice spoke outside the prison");

console.log(failed ? `\nDIALOGUE SPOILERS: ${failed} FAIL` : "\nDIALOGUE SPOILERS: ok");
process.exit(failed ? 1 : 0);
