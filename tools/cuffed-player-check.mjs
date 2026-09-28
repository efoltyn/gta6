#!/usr/bin/env node
/* tools/cuffed-player-check.mjs — A MAN IN CUFFS, in plain node.

   OWNER: "fix the appearance of handcuffs and what I'm capable of doing with
   handcuffs and how people treat me when I have handcuffs on. And in first
   person, I still see my hands even when I'm in handcuffs, which is dumb."

   No Chrome. Runs the REAL systems/cuffedplayer.js, systems/brain.js and
   systems/brain_prison.js under node and asserts:

     1  the body numbers: walk 0.65x, sprint 0.75x, stamina 1.6x, get-up 0.6x,
        a stagger that exists only in cuffs and stays small; the look clamp.
     2  the hands gate: every hand key is refused (E refused everywhere but the
        city, whose registry decides), and the struggle / movement / camera /
        menu keys never are; the grey bar; the prison card keeps its talk verbs
        and loses every hand verb.
     3  treatment is rare and honest: over thousands of rolls a cheap shot is
        only ever a rival with a temper, close, with no screw near; a lift is a
        rival right on you; a line waits out the gap; nothing at 8 m+.
     4  CBZ.brain: a cuffed player is harmless — capability "none" even with a
        gun in the inventory, assess level 0, respond "ignore" for the hardest
        inmate in the yard; uncuffed, the same scene is a threat again.
     5  the yard (brain_prison cuffedPoll): with a screw at 3 m nobody takes a
        shot; lines never come faster than one per LINE_GAP (10 s), and no man repeats himself; over a minute the yard
        does something, but little.
     6  wiring ratchets (source reads): the viewmodel, armed(), the reticle,
        the helper in arrest.js, the grey-bar CSS, the load order.

     node tools/cuffed-player-check.mjs
*/
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => readFileSync(path.join(ROOT, f), "utf8");

let rs = 99;
function rand() {   // mulberry32: the treatment grid needs independent draws
  rs = (rs + 0x6D2B79F5) >>> 0;
  let t = rs;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const player = { pos: { x: 0, y: 0, z: 0 }, dead: false };
const said = [], hunts = [], lifts = [];
const CBZ = {
  game: { mode: "escape", state: "playing", elapsed: 0, cigs: 20 },
  player, npcs: [], guards: [],
  econ: { rng: rand, thiefTick(n) { lifts.push(n); return ""; } },
  fps: { reloading: 0 },
  currentGun() { return { key: "pistol" }; },       // he OWNS a gun; the cuffs decide
  fpsHasWeapon() { return true; },
  prisonSay(a, line) { said.push({ a, line, t: CBZ.game.elapsed }); return true; },
  requestInmateHunt(n, secs, why) { hunts.push({ n, why }); n.huntPlayer = secs; return true; },
  cellblock: { cells: [] },
};
CBZ.playerChar = { cuffed: false, group: { rotation: { y: 0 } } };
CBZ.arrest = { playerCuffed() { const pc = CBZ.playerChar; return !!(pc && pc.cuffed); } };   // the helper, verbatim
globalThis.window = { CBZ };
const C = require(path.join(ROOT, "src/systems/cuffedplayer.js"));
const B = require(path.join(ROOT, "src/systems/brain.js"));
const PB = require(path.join(ROOT, "src/systems/brain_prison.js"));

let fails = 0, passes = 0;
function check(ok, msg) {
  if (ok) { passes++; console.log("  PASS " + msg); }
  else { fails++; console.log("  FAIL " + msg); }
}
const cuff = (on) => { CBZ.playerChar.cuffed = !!on; };

// ------------------------------------------------------------------ 1
console.log("1  the body");
cuff(true);
check(C.on() === true, "C.on() reads CBZ.arrest.playerCuffed");
check(C.moveScale(true, false) === 0.65 && C.moveScale(true, true) === 0.75, "walk 0.65x, sprint 0.75x in cuffs");
check(C.moveScale(false, false) === 1 && C.moveScale(false, true) === 1, "free: untouched");
check(C.staminaMul(true) === 1.6 && C.staminaMul(false) === 1, "stamina drain 1.6x only in cuffs");
check(C.getUpMul(true) === 0.6 && C.getUpMul(false) === 1, "getting up takes longer only in cuffs");
let swMax = 0, swRun = 0, swFree = 0;
for (let t = 0; t < 20; t += 0.013) {
  swMax = Math.max(swMax, Math.abs(C.sway(true, false, t)));
  swRun = Math.max(swRun, Math.abs(C.sway(true, true, t)));
  swFree = Math.max(swFree, Math.abs(C.sway(false, true, t)));
}
check(swFree === 0, "no stagger without cuffs");
check(swMax > 0.02 && swMax < 0.08, "a walk in cuffs weaves a little (" + swMax.toFixed(3) + ")");
check(swRun > swMax && swRun < 0.25, "a run in cuffs staggers more, still under a quarter stride (" + swRun.toFixed(3) + ")");
check(C.clampPitch(true, 1.3) === C.PITCH_UP && C.clampPitch(true, -1.3) === C.PITCH_DOWN && C.clampPitch(true, 0.3) === 0.3 && C.clampPitch(false, 1.3) === 1.3,
  "look is clamped a little in cuffs, free otherwise");

// ------------------------------------------------------------------ 2
console.log("2  the hands");
for (const k of ["e", "f", "g", "q", "r", "b", "t", "1", "5", "9", "E", "G"]) check(C.handKey(k, "escape"), "prison: [" + k + "] needs hands");
for (const k of ["f", "g", "q", "r", "1", "y"]) check(C.handKey(k, "city"), "city: [" + k + "] needs hands");
check(!C.handKey("e", "city"), "city: [E] is the registry's to refuse (booking desk stays usable)");
for (const k of [" ", "w", "a", "s", "d", "shift", "v", "m", "escape", "control", "c", "j", "k", "l", "enter"]) {
  check(!C.handKey(k, "escape") && !C.handKey(k, "city"), "never swallowed: [" + (k === " " ? "space" : k) + "]");
}
check(C.barDisabled(true) && !C.barDisabled(false), "the bar greys only in cuffs");
for (const v of ["trade", "steal", "bribe", "payoff", "pay", "rob", "restrain", "detain", "search", "settle", "whand", "squash"]) check(!C.verbAllowed(v), "card: " + v + " needs hands");
for (const v of ["talk", "listen", "insult", "refuse", "accept", "haggle", "tell", "tellA", "question", "warn", "respect", "fight"]) check(C.verbAllowed(v), "card: " + v + " stays");

// ------------------------------------------------------------------ 3
console.log("3  pickTreatment");
const tally = { cheap: 0, steal: 0, jeer: 0, none: 0 };
let badCheap = 0, badSteal = 0, farAny = 0, gapJeer = 0;
for (let i = 0; i < 20000; i++) {
  const o = {
    dist: rand() * 10, rival: rand() < 0.4, aggression: rand(), guardNear: rand() < 0.3,
    sinceLine: rand() * 16, sinceCheap: rand() * 60, sinceSteal: rand() * 90, roll: rand(), canSteal: rand() < 0.7,
  };
  const r = C.pickTreatment(o) || "none";
  tally[r]++;
  if (r === "cheap" && (!o.rival || o.aggression < 0.6 || o.guardNear || o.dist >= 2.2 || o.sinceCheap < C.CHEAP_GAP)) badCheap++;
  if (r === "steal" && (!o.rival || !o.canSteal || o.guardNear || o.dist >= 1.8 || o.sinceSteal < C.STEAL_GAP)) badSteal++;
  if (r !== "none" && o.dist >= 7) farAny++;
  if (r === "jeer" && o.sinceLine < C.LINE_GAP) gapJeer++;
}
check(badCheap === 0, "a cheap shot is only ever a close rival with a temper and no screw near");
check(badSteal === 0, "a lift is only ever a rival right on you, no screw near");
check(farAny === 0, "nobody 7 m+ away does anything");
check(gapJeer === 0, "a line always waits out the " + C.LINE_GAP + " s gap");
check(tally.none / 20000 > 0.9, "rare: " + (100 * (1 - tally.none / 20000)).toFixed(1) + "% of rolls do anything");
check(tally.cheap > 0 && tally.jeer > tally.cheap, "it does happen: " + JSON.stringify(tally));

// ------------------------------------------------------------------ 4
console.log("4  CBZ.brain: cuffs are not a threat");
function actor(x, z, extra) { return Object.assign({ pos: { x, y: 0, z }, yaw: Math.PI, hp: 100, maxHp: 100 }, extra || {}); }
B.reset(); B.seed(3); B.clock(0);
const pl = actor(0, 0, { isPlayer: true, armed: true, weapon: "Pistol" });
const hard = actor(0, 2.5, { armed: false });
B.register(hard, "inmate", { game: "sim", clique: "reds", personality: { courage: 1, aggression: 1, discipline: 0.1, curiosity: 0.5, loyalty: 1 } });
B.memory.grudge(hard, pl, 1);
const th = () => ({ source: pl, x: 0, z: 0, armed: true, aimingAtMe: true, distance: 2.5, kind: "armed" });
cuff(false);
const free = { cap: B.threat.capability(pl), lvl: B.threat.assess(hard, th()).level, r: B.threat.respond(hard, th()) };
check(free.cap === "gun" && free.lvl > 0.5 && free.r !== "ignore", "uncuffed + a gun: a threat (" + JSON.stringify(free) + ")");
B.reset(); B.seed(3); B.clock(0);
B.register(hard, "inmate", { game: "sim", clique: "reds", personality: { courage: 1, aggression: 1, discipline: 0.1, curiosity: 0.5, loyalty: 1 } });
cuff(true);
const cf = { cap: B.threat.capability(pl), lvl: B.threat.assess(hard, th()).level, r: B.threat.respond(hard, th()), w: B.threat.weaponOf(th()) };
check(cf.cap === "none", "cuffed: capability 'none' with a gun on the belt");
check(cf.lvl === 0 && cf.r === "ignore" && cf.w === "none", "cuffed: assess 0, respond ignore, weapon none (" + JSON.stringify(cf) + ")");
const blast = B.threat.assess(hard, { source: pl, x: 0, z: 0, kind: "explosion", distance: 3 }).level;
check(blast > 0.5, "an explosion next to a cuffed man is still an explosion");
const npcCuffed = actor(1, 1, { cuffed: true, armed: true, weapon: "Pistol" });
check(B.threat.capability(npcCuffed) === "none" && B.threat.restrained(npcCuffed), "a cuffed NPC holds nothing either");
check(B.threat.capability(actor(1, 1, { restraint: { state: "escorted" }, armed: true, weapon: "Pistol" })) === "none", "a marched city ped (restraint.state) holds nothing");

// ------------------------------------------------------------------ 5
console.log("5  the yard sees you in cuffs (brain_prison cuffedPoll)");
function yard(guardAt) {
  B.reset(); B.seed(5); rs = 5;
  CBZ.npcs.length = 0; CBZ.guards.length = 0; said.length = 0; hunts.length = 0; lifts.length = 0;
  CBZ.game.elapsed = 0; B.clock(0);
  for (let i = 0; i < 14; i++) {
    const ang = i * 0.9, r = 1.2 + (i % 5) * 1.3;
    const n = { kind: "inmate", gang: i % 2, group: { position: { x: Math.sin(ang) * r, y: 0, z: Math.cos(ang) * r } }, hp: 100,
      playerGrudge: i % 3 === 0 ? 5 : 0, aiState: "wander" };
    B.register(n, "inmate", { game: "prison", personality: { courage: 0.8, aggression: i % 3 === 0 ? 0.9 : 0.3, discipline: 0.3, curiosity: 0.5, loyalty: 0.5 } });
    CBZ.npcs.push(n);
  }
  if (guardAt != null) CBZ.guards.push({ kind: "guard", group: { position: { x: guardAt, y: 0, z: 0 } } });
  for (let s = 0; s < 60; s++) {
    CBZ.game.elapsed = s + 1; B.clock(s + 1);
    PB.cuffedPoll(1.0);
    for (const n of CBZ.npcs) if (n.huntPlayer > 0) n.huntPlayer = 0;   // the blow lands and he walks
  }
  return { said: said.slice(), hunts: hunts.slice(), lifts: lifts.slice() };
}
cuff(true);
const watched = yard(3);
check(watched.hunts.length === 0 && watched.lifts.length === 0, "a screw at 3 m: no cheap shot, no lift (" + watched.hunts.length + "/" + watched.lifts.length + ")");
const alone = yard(null);
let gapOk = true;
for (let i = 1; i < alone.said.length; i++) if (alone.said[i].t - alone.said[i - 1].t < C.LINE_GAP - 1e-6) gapOk = false;
check(gapOk, "lines are never closer than " + C.LINE_GAP + " s (" + alone.said.length + " in a minute)");
check(alone.said.length <= 4, "a minute in the yard is a few lines, not a chorus (" + alone.said.length + ")");
check(watched.said.length <= 4, "and with a screw near, still only a few (" + watched.said.length + ")");
let repeat = false;
for (const run of [alone, watched]) { const seen = new Map(); for (const x of run.said) { if (seen.has(x.a) && x.t - seen.get(x.a) < C.MAN_GAP) repeat = true; seen.set(x.a, x.t); } }
check(!repeat, "no man says it twice inside " + C.MAN_GAP + " s");
check(C.novelty(0) === 1 && C.novelty(C.NOVELTY * 2) === 0.15 && C.novelty(C.NOVELTY / 2) > 0.4, "the room loses interest: novelty 1 -> 0.15");
check(alone.hunts.every((h) => h.why === "cheap" && (h.n.playerGrudge >= 3)), "only rivals take the cheap shot");
check(alone.hunts.length <= 2, "at most a couple of cheap shots a minute (" + alone.hunts.length + ")");
check(alone.said.length + alone.hunts.length + alone.lifts.length > 0, "the yard does react to a man in cuffs");
cuff(false);
const loose = yard(null);
check(loose.said.length === 0 && loose.hunts.length === 0 && loose.lifts.length === 0, "uncuffed: none of it");

// ------------------------------------------------------------------ 6
console.log("6  wiring");
const fps = read("src/systems/fpsmode.js");
check(/function armed\(\) \{[\s\S]{0,120}if \(cuffedHands\(\)\) return false;/.test(fps), "fpsmode armed() is false in cuffs (no fire, swap, aim, carried gun)");
check(/vm\.visible = !!\(\(fps\.active \|\| seatGun\)[^;]*!cuffs\)/.test(fps), "the first-person viewmodel is hidden in cuffs every frame");
check(/vm\.visible = on && !aquaticRide\(\) && !cuffedHands\(\)/.test(fps), "and on the [V] toggle");
check(/crossShow = aiming[^;]*!cuffs/.test(fps), "no reticle in cuffs");
check(/A\.playerCuffed = function \(\) \{ const pc = CBZ\.playerChar; return !!\(pc && pc\.cuffed\); \};/.test(read("src/systems/arrest.js")), "the ONE helper lives in arrest.js");
check(/body\.cuffed #hotbar[\s\S]{0,80}#cHud \.cSlots[\s\S]{0,200}pointer-events:none/.test(read("css/inventory.css")), "the bar greys and goes dead (both bars)");
for (const html of ["index.html", "disaster.html"]) {
  const s = read(html);
  const a = s.indexOf("src/systems/arrest.js"), c = s.indexOf("src/systems/cuffedplayer.js"), i = s.indexOf("src/systems/input.js");
  check(a >= 0 && c > a && (i < 0 || c < i), html + ": cuffedplayer.js loads after arrest.js and before input.js");
}
check(/if \(ctx\.cuffed && !o\.cuffOk\) return false;/.test(read("src/city/interactions.js")), "city registry: only cuffOk options in cuffs");
check(/cuffOk: true/.test(read("src/games/jail.js")), "the booking desk stays usable in cuffs");
check(/kind = cuffs \? "kick"/.test(read("src/systems/combat.js")), "prison: the punch is a kick in cuffs");
check(/function cuffKick\(\)/.test(read("src/city/combat.js")), "city: the swing is a kick in cuffs");
check(/opts\.instant[^;]*cuffedPlayer/.test(read("src/city/vehicles.js")), "city: no getting into a car in cuffs (scripted seats aside)");
check(/cuffedPlayer && CBZ\.cuffedPlayer\.on\(\)\) return \{ open: false/.test(read("src/city/loyalty.js")), "no card reader or key opens for a cuffed man");

console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
