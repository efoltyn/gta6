#!/usr/bin/env node
/* tools/brain-sim-city-law.mjs — plain-node scenarios for the CITY'S LAW
   (src/city/law.js) running on the real CBZ.brain (src/systems/brain.js).

   No browser, no THREE. A fake window.CBZ with a player, officers as plain
   duck-typed actors, police.js's hooks stubbed (step/hold/face/say/tackle)
   and wanted.js's report stubbed. Every check prints PASS/FAIL; any FAIL
   exits 1.

     node tools/brain-sim-city-law.mjs          # all scenarios
     node tools/brain-sim-city-law.mjs 2        # just scenario 2
*/
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---- the fake city ---------------------------------------------------------
const player = { pos: { x: 0, y: 0, z: 0 }, speed: 0, dead: false, driving: false };
const playerActor = { isPlayer: true, get pos() { return player.pos; }, get dead() { return player.dead; }, group: { rotation: { y: 0 } } };
const CBZ = {
  game: { mode: "city", wanted: 1, busted: false, elapsed: 0 },
  player, city: { playerActor, note() {} }, playerChar: { group: { rotation: { y: 0 } } },
  cityCops: [], now: 0,
};
globalThis.window = { CBZ };
const B = require(path.join(ROOT, "src/systems/brain.js"));
const L = require(path.join(ROOT, "src/city/law.js"));
const g = CBZ.game;

let fails = 0, passes = 0;
function check(ok, msg) {
  if (ok) { passes++; console.log("  PASS " + msg); }
  else { fails++; console.log("  FAIL " + msg); }
}
const scenarios = [];
function scenario(n, name, fn) { scenarios.push({ n, name, fn }); }

// ---- police.js / wanted.js stand-ins ----------------------------------------
const said = [], busts = [], tackles = [], reports = [], npcArrests = [], offenses = [];
let armedOut = false;
L.bindPolice({
  step(c, dx, dz, spd) {
    const d = Math.hypot(dx, dz) || 1;
    c.pos.x += dx / d * spd * DT; c.pos.z += dz / d * spd * DT;
    c.group.rotation.y = Math.atan2(dx, dz); c.speed = spd;
  },
  hold(c) { c.speed = 0; },
  face(c, x, z) { c.group.rotation.y = Math.atan2(x - c.pos.x, z - c.pos.z); },
  say(c, line) { said.push({ c, line, t: T }); return true; },
  drawGun(c) { c.armed = true; }, holster(c) { c.armed = false; },
  tackle(c) { tackles.push({ c, t: T }); c._seizing = true; return true; },
  openCarry() { return armedOut; },
});
L.bindWanted({
  report(heat, o) { reports.push({ heat, type: o.type, x: o.x, z: o.z, t: T }); },
  npcOffense(p, heat, type) { offenses.push({ p, heat, type, t: T }); },
});
CBZ.cityBust = function (o) { g.busted = true; busts.push({ cop: o.cop, peaceful: o.peaceful, t: T }); };
CBZ.cityNpcArrest = function (p) { p.npcWanted = 0; npcArrests.push({ p, t: T }); };

let T = 0; const DT = 0.05;
function cop(x, z, faceX, faceZ, extra) {
  const c = { kind: "cop", pos: { x, y: 0, z }, group: { rotation: { y: Math.atan2(faceX - x, faceZ - z) } }, baseSpeed: 4.6, hp: 90, speed: 0, swat: false };
  if (extra) Object.assign(c, extra);
  CBZ.cityCops.push(c);
  L.enlist(c);
  return c;
}
function fresh() {
  B.reset(); B.seed(4242); B.perception.setOcclusion(null); B.perception.setLight(null);
  L.reset();
  for (const c of CBZ.cityCops.slice()) L.discharge(c);
  CBZ.cityCops.length = 0;
  said.length = busts.length = tackles.length = reports.length = npcArrests.length = offenses.length = 0;
  player.pos.x = 0; player.pos.z = 0; player.speed = 0; player.dead = false; player.driving = false;
  g.busted = false; g.wanted = 1; g._copsFiredUponT = undefined; armedOut = false;
  CBZ.isAimingWeapon = null; CBZ.aimedActor = null;
  T = 0; g.elapsed = 0; B.clock(0);
}
function tick() {
  T += DT; g.elapsed = T; CBZ.now = T * 1000;
  B.clock(T);
  L.frame(DT);
}
// one officer's frame the way police.js's hunt branch runs it
function lawFrame(c, roe) {
  const dx = player.pos.x - c.pos.x, dz = player.pos.z - c.pos.z, dist = Math.hypot(dx, dz);
  const st = L.playerState(c, false);
  const d = L.decide(c, playerActor, DT, st, { roe, dist, sees: true, reason: "test" });
  if (!d.lethal && !L.acted(c)) {
    // police.js lawMove, reduced: chase runs, approach walks, hold/cover close to ~8 m
    const sp = d.mode === "chase" ? c.baseSpeed * 1.05 : d.mode === "approach" ? c.baseSpeed * 0.42 : (d.mode === "hold" || d.mode === "cover") && dist > 10.5 ? c.baseSpeed * 0.75 : 0;
    if (sp > 0 && dist > 1.1) { c.pos.x += dx / dist * sp * DT; c.pos.z += dz / dist * sp * DT; c.group.rotation.y = Math.atan2(dx, dz); }
  }
  return d;
}
function phasesOf(c, fn, secs) {
  const seq = [];
  for (let t = 0; t < secs; t += DT) {
    tick();
    if (fn) fn(t);
    const d = lawFrame(c, fn && fn.roe || "nonlethal");
    if (seq[seq.length - 1] !== d.phase) seq.push(d.phase);
    if (g.busted) break;
  }
  return seq;
}
function inOrder(seq, want) {
  let i = 0;
  for (const p of seq) if (p === want[i]) i++;
  return i === want.length;
}

// ============================================================================
scenario(1, "cop spots a crime -> warn -> order -> comply -> cuff", function () {
  fresh();
  const c = cop(0, 18, 0, 0);                     // 18 m out, looking straight at you
  check(!!(c._brain && c._brain.game === "city-law"), "officer registered with brain.game = city-law");
  const seq = phasesOf(c, null, 20);             // the player just stands there, gun away
  console.log("    phases: " + seq.join(" > "));
  check(inOrder(seq, ["warn", "order", "approach", "cuff"]), "the ladder ran warn > order > approach > cuff");
  check(busts.length === 1 && busts[0].cop === c && busts[0].peaceful === true, "cuffed through act.verb(restrain) -> the existing cityBust, peaceful, by THIS officer");
  check(!seq.includes("lethal") && !seq.includes("force"), "a complying suspect is never forced or shot");
  const lines = said.map((s) => s.line);
  console.log("    said: " + lines.join(" | "));
  check(lines.length >= 3 && lines.some((l) => /fine/i.test(l)), "he spoke the ladder, and said the stakes (a fine at 1 star)");
  check(L.player.stillT >= 1.5 && L.player.handsUp, "standing still with the gun away for 1.5 s reads as hands shown");
});

scenario(2, "suspect flees -> escalate -> force (tackle), never lethal under nonlethal ROE", function () {
  fresh();
  const c = cop(0, 12, 0, 0);
  let ordered = false;
  const fn = function () {
    const K = c._law;
    if (K && K.phase === "order") ordered = true;
    if (ordered) { player.speed = 3.2; player.pos.z -= 3.2 * DT; }      // he bolts away from the officer
  };
  const seq = phasesOf(c, fn, 14);
  console.log("    phases: " + seq.join(" > "));
  check(inOrder(seq, ["order", "escalate", "force"]), "running after the order escalates to force");
  check(tackles.length >= 1 && tackles[0].c === c, "within arm's reach of a runner the officer TACKLES (act.verb tackle -> predator seize)");
  check(!seq.includes("lethal"), "no bullet: the ROE is nonlethal");
  check(tackles.length <= 1, "one takedown attempt at a time (force-wide cooldown)");
});

scenario(3, "gun out + aimed at him -> lethal only under a lethal ROE, after his reaction, and it holds", function () {
  fresh();
  const c = cop(0, 8, 0, 0);
  armedOut = true;
  CBZ.isAimingWeapon = () => true;
  CBZ.aimedActor = () => ({ actor: c });
  let tLethal = -1;
  const fnA = function (t) { };
  fnA.roe = "lethal";
  for (let t = 0; t < 4; t += DT) {
    tick();
    const d = lawFrame(c, "lethal");
    if (d.lethal && tLethal < 0) tLethal = T;
  }
  check(tLethal > 0, "an armed man pointing it at an officer under lethal ROE draws lethal force");
  check(tLethal >= L.react(c) - 1e-6, "not on the first frame: after his own reaction time (" + L.react(c).toFixed(2) + " s)");
  // he lowers the gun: the officer keeps his up for LETHAL_HOLD before stepping back down
  CBZ.isAimingWeapon = () => false; armedOut = false;
  let lethalFor = 0;
  for (let t = 0; t < 5; t += DT) { tick(); const d = lawFrame(c, "lethal"); if (d.lethal) lethalFor += DT; else break; }
  check(lethalFor >= 2.9, "lethal is latched (" + lethalFor.toFixed(2) + " s) instead of flickering with the muzzle");
  // the SAME threat under nonlethal ROE never becomes a bullet
  fresh();
  const c2 = cop(0, 8, 0, 0);
  armedOut = true; CBZ.isAimingWeapon = () => true; CBZ.aimedActor = () => ({ actor: c2 });
  let everLethal = false;
  for (let t = 0; t < 4; t += DT) { tick(); if (lawFrame(c2, "nonlethal").lethal) everLethal = true; }
  check(!everLethal, "under nonlethal ROE an aimed gun is still met with the ladder, never a bullet");
  check(L.roe(c2, playerActor, true, 1, false, true) === "nonlethal" && L.roe(c2, playerActor, true, 3, false, true) === "lethal" &&
    L.roe(c2, playerActor, true, 4, false, true) === "shoot" && L.roe(c2, playerActor, true, 2, true, true) === "shoot" &&
    L.roe(c2, playerActor, true, 2, false, false) === "shoot", "ROE ladder: 1-2 stars nonlethal, 3 lethal-if-threatened, 4+/fired-upon/no Chief = shoot");
});

scenario(4, "one voice: the cover officers hold, then adopt the escalation on DIFFERENT frames", function () {
  fresh();
  const a = cop(0, 7, 0, 0), b = cop(4, 7, 0, 0), c = cop(-4, 7, 0, 0);
  // everybody sees him; the first to open the case is the primary
  tick();
  const da = L.decide(a, playerActor, DT, L.playerState(a, false), { roe: "lethal", dist: 7, sees: true });
  const pa = da.primary;
  const db = L.decide(b, playerActor, DT, L.playerState(b, false), { roe: "lethal", dist: 8, sees: true });
  const dc = L.decide(c, playerActor, DT, L.playerState(c, false), { roe: "lethal", dist: 8, sees: true });
  check(pa && !db.primary && !dc.primary && db.mode === "cover" && dc.mode === "cover", "one primary runs the ladder; the others hold the cover ring");
  // the suspect draws on the primary
  armedOut = true; CBZ.isAimingWeapon = () => true; CBZ.aimedActor = () => ({ actor: a });
  const firstLethal = new Map();
  for (let t = 0; t < 3; t += DT) {
    tick();
    for (const o of [a, b, c]) {
      const d = L.decide(o, playerActor, DT, L.playerState(o, false), { roe: "lethal", dist: 7, sees: true });
      if (d.lethal && !firstLethal.has(o)) firstLethal.set(o, T);
    }
  }
  const ts = [a, b, c].map((o) => firstLethal.get(o));
  console.log("    lethal at: " + ts.map((x) => x == null ? "never" : x.toFixed(2)).join(", "));
  check(ts.every((x) => x != null), "the whole stack goes lethal once the primary does");
  check(new Set(ts.map((x) => Math.round(x / DT))).size === 3, "...but each on his own frame (no squad-wide same-frame flip)");
});

scenario(5, "witness report -> wanted rises after a delay, at the witness's LAST SIGHTING", function () {
  fresh();
  // a civilian who always phones it in, watching the corner
  B.define("sim_snitch", { witness: { report: 1, flee: 0, film: 0, intervene: 0, cower: 0, ignore: 0, cheer: 0 } });
  const w = { pos: { x: 10, y: 0, z: 0 }, yaw: -Math.PI / 2, hp: 100, maxHp: 100 };
  B.register(w, "sim_snitch", { game: "city", personality: { discipline: 1, loyalty: 1 } });
  player.pos.x = 2; player.pos.z = 0;
  tick();                                              // law hooks onReport("city")
  const n = B.social.crime("mugging", 2, 0, playerActor, 0.4, { heat: 60, type: "mugging", game: "city" });
  check(n >= 1, "the crime has a witness (" + n + ")");
  // the mugger walks off; the police must NOT get his live position
  let tReport = -1;
  for (let t = 0; t < 25 && tReport < 0; t += DT) {
    tick();
    player.pos.x -= 1.5 * DT; player.pos.z += 2.5 * DT;
    if (reports.length) tReport = T;
  }
  check(reports.length === 1, "exactly one report reached wanted (" + reports.length + ")");
  check(tReport > 3.0, "no stars on the act: the report landed " + tReport.toFixed(2) + " s later (call + dispatch)");
  const r = reports[0] || {};
  check(r.type === "mugging" && r.heat === 60, "the charge and heat ride through (" + r.type + ", " + r.heat + ")");
  check(Math.hypot(r.x - 2, r.z - 0) < 0.5, "the position dispatched is where the witness last SAW him (" + (r.x || 0).toFixed(1) + ", " + (r.z || 0).toFixed(1) + ")");
  check(Math.hypot(r.x - player.pos.x, r.z - player.pos.z) > 5, "...not where he actually is now");
  // an OFFICER witness radios it himself (instant path); his brain report is not a second charge
  const before = reports.length;
  const c = cop(3, 6, 2, 0);
  L.onWitnessReport({ kind: "assault", x: 2, z: 0, perp: playerActor, severity: 0.3, witness: c, opts: { heat: 25, type: "assault" } });
  for (let t = 0; t < 4; t += DT) tick();
  check(reports.length === before, "a cop's brain report is ignored (he already radioed it)");
  // an NPC perpetrator becomes a city offender the police can hunt
  const thug = { pos: { x: 20, y: 0, z: 0 }, npcWanted: 0 };
  L.onWitnessReport({ kind: "robbery", x: 20, z: 0, perp: thug, severity: 0.5, witness: w, opts: { heat: 40, type: "robbery" } });
  for (let t = 0; t < 4; t += DT) tick();
  check(offenses.length === 1 && offenses[0].p === thug && L.reportedRecently(thug, 30), "an NPC perp's report files a city offence and marks him KNOWN to patrols");
});

scenario(6, "hearing: a gunshot reaches officers through perception.noise, each reacts on his own beat", function () {
  fresh();
  const near1 = cop(10, 0, 20, 0), near2 = cop(-12, 0, -20, 0), far = cop(200, 0, 0, 0);
  tick();
  check(L.gunshot(0, 0, playerActor, 48) === true, "CBZ.cityGunshot routes the bang into brain.perception.noise");
  check(L.gunshot(0, 0, playerActor, 48) === false, "an SMG burst is one event (per-shooter throttle)");
  const heardAt = new Map();
  for (let t = 0; t < 2; t += DT) {
    tick();
    for (const o of [near1, near2, far]) { const h = L.heard(o); if (h && !heardAt.has(o)) heardAt.set(o, T); }
  }
  check(heardAt.has(near1) && heardAt.has(near2), "officers inside earshot heard it (even facing away)");
  check(!heardAt.has(far), "an officer 200 m out did not");
  check(heardAt.get(near1) !== heardAt.get(near2), "they turn their heads on different frames (" + [...heardAt.values()].map((x) => x.toFixed(2)).join(", ") + ")");
  check(L.heard(near1) === null, "a heard shot is acted on once, not every frame");
});

scenario(7, "perception: a cop who is looking away does not notice you; one facing you does", function () {
  fresh();
  const away = cop(0, 20, 0, 40);          // back turned
  const facing = cop(20, 0, 0, 0);
  let seenAway = false, seenFacing = false;
  for (let t = 0; t < 2.4; t += 0.6) {
    for (let k = 0; k < 12; k++) tick();             // police.js looks on its 0.6 s retarget beat
    if (L.acquire(away, playerActor, 48)) seenAway = true;
    if (L.acquire(facing, playerActor, 48)) seenFacing = true;
  }
  check(!seenAway, "the officer with his back to you never acquires you at 20 m (no omniscience)");
  check(seenFacing, "the officer looking your way does (awareness meter filled)");
  const close = cop(0, 3.5, 0, 20);         // right behind you, back turned
  tick();
  check(L.acquire(close, playerActor, 48), "within footstep range he senses you regardless of the cone");
});

// ============================================================================
const only = process.argv.slice(2).map(Number).filter((n) => n > 0);
for (const s of scenarios) {
  if (only.length && only.indexOf(s.n) < 0) continue;
  console.log(`\n[${s.n}] ${s.name}`);
  try { s.fn(); } catch (e) { fails++; console.log("  FAIL threw: " + (e && e.stack || e)); }
}
console.log(`\ncity-law sim: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
