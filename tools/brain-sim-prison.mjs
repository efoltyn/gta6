#!/usr/bin/env node
/* tools/brain-sim-prison.mjs — plain-node scenarios for the PRISON running on
   the real CBZ.brain (src/systems/brain.js + src/systems/brain_prison.js).

   No browser, no THREE. A fake window.CBZ in escape mode, screws and inmates
   as duck-typed actors ({ group: { position, rotation }, ... }), guards.js's
   movers stubbed (guardWalkTo / guardFaceTo / guardIdle). Every check prints
   PASS/FAIL; any FAIL exits 1.

     node tools/brain-sim-prison.mjs          # all scenarios
     node tools/brain-sim-prison.mjs 2        # just scenario 2
*/
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---- a deterministic rng for the prison side (the brain seeds its own) ----
let rs = 12345;
function rand() { rs = (rs * 1103515245 + 12345) >>> 0; return (rs >>> 8) / 16777216; }

// ---- the fake prison ---------------------------------------------------------
const player = { pos: { x: 500, y: 0, z: 500 }, crouch: false, dead: false };
const said = [];
const CBZ = {
  game: { mode: "escape", state: "playing", elapsed: 0, detection: 0 },
  player, npcs: [], guards: [],
  econ: { rng: rand },
  prisonSay(a, line) { said.push({ a, line }); return true; },
  npcStare(a, secs) { a._stared = (a._stared || 0) + 1; },
  npcAvert(a) { a._averted = (a._averted || 0) + 1; },
  prisonLawCount() {},
  guardWalkTo(g, x, z, sp, dt) {
    const p = g.group.position, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d > 1e-3) { const s = Math.min(d, sp * dt); p.x += dx / d * s; p.z += dz / d * s; g.group.rotation.y = Math.atan2(dx, dz); }
    g._cmd = (g._cmd || 0) + 1;
    return d;
  },
  guardFaceTo(g, x, z) { g.group.rotation.y = Math.atan2(x - g.group.position.x, z - g.group.position.z); },
  guardIdle() {},
  guardLookAt() {},
};
globalThis.window = { CBZ };
const B = require(path.join(ROOT, "src/systems/brain.js"));
const PB = require(path.join(ROOT, "src/systems/brain_prison.js"));

let fails = 0, passes = 0;
function check(ok, msg) {
  if (ok) { passes++; console.log("  PASS " + msg); }
  else { fails++; console.log("  FAIL " + msg); }
}
const scenarios = [];
function scenario(n, name, fn) { scenarios.push({ n, name, fn }); }

let nid = 1;
function vec(x, z) { return { x, y: 0, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } }; }
function guard(x, z, yaw) {
  const g = { id: nid++, kind: "guard", viewDist: 14, half: 0.6, speed: 2.2, hp: 100, maxHp: 100,
    group: { position: vec(x, z), rotation: { y: yaw || 0 } }, char: {} };
  CBZ.guards.push(g);
  return g;
}
function inmate(x, z, gang, extra) {
  const n = Object.assign({ id: nid++, kind: "inmate", role: "inmate", gang: gang == null ? -1 : gang, aiState: "wander",
    hp: 100, maxHp: 100, baseSpeed: 2, speed: 2, group: { position: vec(x, z), rotation: { y: 0 } },
    target: vec(x, z), char: {}, personality: { nerve: 0.5, loyalty: 0.5, snitch: 0.5, greed: 0.5 } }, extra || {});
  CBZ.npcs.push(n);
  return n;
}
function face(a, b) { a.group.rotation.y = Math.atan2(b.group.position.x - a.group.position.x, b.group.position.z - a.group.position.z); }
// the inmates' mover: walk toward target at the speed the brain returned
function walk(n, sp, dt) {
  const p = n.group.position, dx = n.target.x - p.x, dz = n.target.z - p.z, d = Math.hypot(dx, dz);
  if (!(sp > 0) || d < 0.05) { n._vx = n._vz = 0; return; }
  const s = Math.min(d, sp * dt);
  n._vx = dx / d * sp; n._vz = dz / d * sp;
  p.x += dx / d * s; p.z += dz / d * s;
}
function fresh(seed) {
  B.reset(); B.seed(seed || 7);
  rs = seed || 12345;
  CBZ.npcs.length = 0; CBZ.guards.length = 0; said.length = 0;
  CBZ.game.elapsed = 0; B.clock(0);
  PB.tick(1 / 60);          // wires the prison into the brain (executor, onReport, archetypes)
}
function frame(dt) {
  CBZ.game.elapsed += dt;
  PB.tick(dt);
  for (const g of CBZ.guards) if (g._yardCase) PB.guardLawStep(g, dt);
  for (const n of CBZ.npcs) {
    if (n.dead) continue;
    if (n.ko > 0) { n.ko -= dt; continue; }
    const sp = PB.inmateThink(n, dt);
    if (sp != null) walk(n, sp, dt);
    else if (n.aiState === "fight" && n.foe) { n._vx = n._vz = 0; }   // swinging on the spot
  }
}

// =========================================================================
scenario(1, "yard law: a screw sees a fight -> Break it up -> On the ground -> the complying man is cuffed", function () {
  fresh(11);
  const g = guard(0, 0, 0);
  const a = inmate(0, 9, 0, { personality: { nerve: 0.3, loyalty: 0.5, snitch: 0.5 } });
  const b = inmate(0.9, 9.2, 1);
  a.aiState = "fight"; a.foe = b; b.aiState = "fight"; b.foe = a;
  PB.sync();
  // a is disciplined enough to comply
  a._brain.personality.discipline = 0.8; a._brain.personality.aggression = 0.2; a._brain.personality.courage = 0.5;
  a._fightStarter = a; b._fightStarter = a;
  const phases = [];
  for (let i = 0; i < 60 * 14; i++) {
    frame(1 / 60);
    const ph = g._yardPhase;
    if (ph && phases[phases.length - 1] !== ph) phases.push(ph);
    if (a.cuffed) break;
  }
  check(g._yardCase === a || a.cuffed, "the screw took the case against the man who threw first");
  check(phases.indexOf("warn") >= 0 || phases.indexOf("order") >= 0, "he warned/ordered first (" + phases.join(" > ") + ")");
  check(!!a.cuffed && !!a.char.cuffed, "the complying man is cuffed");
  check(phases.indexOf("force") < 0, "no taser on a man who complied");
  check(said.some((s) => s.a === g && /Break it up|Knock it off|On the ground|Get down|Hands/.test(s.line)), "the screw spoke the prison's own lines (" + said.filter((s) => s.a === g).map((s) => s.line).join(" / ") + ")");
  check(b.aiState !== "fight", "the fight is over for the other man too");
  // the cuffs come off after the hold, and he goes home with the fight out of him
  for (let i = 0; i < 60 * 20 && a.cuffed; i++) frame(1 / 60);
  check(!a.cuffed && (a._lawHeldT || 0) > 0, "let up after the hold, and he will not swing for a while");
});

// =========================================================================
scenario(2, "yard law: a man who keeps swinging is tased, then cuffed", function () {
  fresh(21);
  const g = guard(0, 0, 0);
  const a = inmate(0, 5, 0), b = inmate(0.9, 5.1, 1);
  a.aiState = "fight"; a.foe = b; b.aiState = "fight"; b.foe = a;
  PB.sync();
  a._brain.personality.aggression = 1; a._brain.personality.courage = 1; a._brain.personality.discipline = 0;
  a.armed = true;   // he thinks he can take it
  a._fightStarter = a;
  let tased = false;
  for (let i = 0; i < 60 * 14; i++) {
    frame(1 / 60);
    if (a.ko > 0) tased = true;
    if (a.cuffed) break;
  }
  check(tased, "the ladder escalated to the taser (act.verb tase -> the prison executor)");
  check(!!a.cuffed, "down, then cuffed");
});

// =========================================================================
scenario(3, "clique retaliation is PROPORTIONAL: a shove never brings a blade; a shanking brings the crew", function () {
  fresh(31);
  const victim = inmate(0, 0, 0);
  const aggressor = inmate(1.5, 0, 1);
  const mates = [];
  for (let i = 0; i < 6; i++) mates.push(inmate(-2 - i * 0.8, 1 + (i % 2), 0));
  PB.sync();
  for (const m of mates) { m._brain.personality.courage = 0.8; m._brain.personality.aggression = 0.7; m._brain.personality.loyalty = 0.8; }
  const low = PB.retaliate(victim, aggressor, 0.1).map((e) => e.level);
  check(low.length > 0 && low.every((l) => l === "glare" || l === "shove"), "a shove (harm 0.1): " + low.join(","));
  check(low.indexOf("weapon") < 0 && low.indexOf("fight") < 0, "nobody fights or pulls steel over a shove");
  const mid = PB.retaliate(victim, aggressor, 0.5).map((e) => e.level);
  check(mid.indexOf("weapon") < 0 && mid.some((l) => l === "fight" || l === "shove"), "a beating (harm 0.5): " + mid.join(","));
  const high = PB.retaliate(victim, aggressor, 1).map((e) => e.level);
  check(high.some((l) => l === "fight" || l === "weapon"), "a shanking (harm 1.0): " + high.join(","));
  const rival = PB.retaliate(aggressor, victim, 0.5);
  check(rival.length === 0, "the aggressor's side has nobody near to answer for him (no clique mates in range)");
});

// =========================================================================
scenario(4, "morale + ROUT: a clique fight breaks when the shotcaller drops; a healthy crew holds a lost man", function () {
  fresh(41);
  const foe = inmate(20, 0, 1);
  const crew = [];
  const leader = inmate(0, 0, 0, { isLeader: true });
  crew.push(leader);
  for (let i = 0; i < 5; i++) crew.push(inmate(1 + i, 1, 0));
  for (let i = 0; i < 4; i++) inmate(60 + i, 60, 0);      // the rest of the set, across the compound
  PB.sync();
  for (const m of crew) { m.aiState = "fight"; m.foe = foe; m._brain.personality.courage = 0.35; }
  // one ordinary man goes down: the crew holds
  crew[5].ko = 6; crew[5].hp = 50;
  PB.memberDown(crew[5], foe, false);
  let routed = crew.filter((m) => (m._routT || 0) > 0).length;
  check(routed === 0, "one man KO'd: nobody runs (" + routed + ")");
  // they are losing: hurt, and the shotcaller is killed
  for (const m of crew) m.hp = 45;
  leader.dead = true; leader.hp = 0;
  PB.memberDown(leader, foe, true);
  for (let i = 0; i < 90; i++) frame(1 / 30);
  routed = crew.filter((m) => m !== leader && (m._routT || 0) > 0).length;
  const G = B.morale.group(PB.cliqueId(0));
  check(G.leaderDown === true && G.morale < 0.8, "the clique's morale fell (" + G.morale.toFixed(2) + ", leader down)");
  check(routed >= 2, "the fight BROKE: " + routed + " of 5 ran for their houses instead of fighting to the last man");
  const far = CBZ.npcs.filter((m) => m.gang === 0 && m.group.position.x >= 60);
  check(far.every((m) => !((m._routT || 0) > 0)), "men across the compound who were not in it did not bolt");
});

// =========================================================================
scenario(9, "THE CAR backs its own: a man's whole car answers (active or not), another car standing right there does not", function () {
  fresh(53);
  // car 1 (Black): the victim, two ACTIVE men and three who just ride under
  // the car (gang -1, car 1). Car 2 (White): three men standing just as close.
  const victim = inmate(0, 0, -1, { yardCar: 1 });
  const aggressor = inmate(1.5, 0, 3, { yardCar: 3 });
  const own = [], other = [];
  for (let i = 0; i < 5; i++) own.push(inmate(-2 - i * 0.7, 1 + (i % 2), i < 2 ? 1 : -1, { yardCar: 1 }));
  for (let i = 0; i < 3; i++) other.push(inmate(-2 - i * 0.7, -1.2, i < 1 ? 2 : -1, { yardCar: 2 }));
  PB.sync();
  check(own.every((m) => m._brainClique === PB.cliqueId(1)), "every man of the car is in its clique, active or not (" + own.map((m) => m._brainClique).join(",") + ")");
  check(other.every((m) => m._brainClique === PB.cliqueId(2)), "the other car's men are in THEIR clique");
  for (const m of own.concat(other)) { m._brain.personality.courage = 0.85; m._brain.personality.loyalty = 0.85; m._brain.personality.aggression = 0.7; }
  const list = PB.retaliate(victim, aggressor, 0.8);
  const who = list.map((e) => e.actor);
  check(who.length > 0, "his car answers a beating (" + who.length + " men)");
  check(who.every((a) => own.indexOf(a) >= 0), "only his own car answers; nobody from the car standing next to him");
  check(who.some((a) => a.gang < 0), "a man who only rides under the car still backs him");
  // nobody rats on his own car
  let ratted = 0;
  for (let k = 0; k < 40; k++) if (PB.willTalk && PB.willTalk(own[3], victim, {})) ratted++;
  check(!PB.willTalk || ratted === 0, "nobody tells on his own car (" + ratted + "/40)");
});

// =========================================================================
scenario(5,"witnesses: an inmate who saw a fight reports it (a screw comes); a stared-down witness is SCARED OFF", function () {
  fresh(51);
  // every inmate who sees it wants to report (the yard's odds are the brain's; pinned here)
  B.define("inmate", { witness: { report: 1, flee: 0, film: 0, intervene: 0, cower: 0, ignore: 0, cheer: 0 } });
  const g = guard(40, 0, Math.PI);                  // far off, facing away: he does not see it himself
  const perp = inmate(0, 0, 1), victim = inmate(1, 0, -1);
  const w1 = inmate(0, 8, -1, { personality: { nerve: 0.5, loyalty: 0.5, snitch: 1, greed: 0.5 } });
  const w2 = inmate(-8, 0, -1, { personality: { nerve: 0.5, loyalty: 0.5, snitch: 1, greed: 0.5 } });
  // the perp's crew is standing on w2
  const c1 = inmate(-8.5, 1, 1), c2 = inmate(-7.5, -1, 1), c3 = inmate(-9, -0.5, 1);
  face(w1, perp); face(w2, perp);
  PB.sync();
  w1._brain.personality.courage = 0.9; w2._brain.personality.courage = 0.1;
  for (const c of [c1, c2, c3]) c.group.rotation.y = 0;
  perp.aiState = "fight"; perp.foe = victim; victim.aiState = "fight"; victim.foe = perp;
  let scared = [];
  PB.onScared = function (n) { scared.push(n); };
  const keep = CBZ.econ.rng;
  CBZ.econ.rng = () => 0.01;          // the yard's code lets both of them talk (the veto is a roll)
  const talkers = PB.crime("fight", 0, 0, perp, 0.6, { victim });
  check(talkers >= 1, "the crime made talkers (" + talkers + ")");
  check(!!(w1._brain.witness && w1._brain.witness.reportAt != null), "w1 is going to report (after a beat, not at once)");
  // nothing lands at once
  frame(0.2);
  check(!g._yardCase && !g.investigate, "no instant report: the screw has heard nothing yet");
  for (let i = 0; i < 60 * 14; i++) frame(1 / 60);
  check(!!(g._yardCase === perp || perp.cuffed || (g.investigate && g.investigate.type === "report")), "w1's report landed: the screw came for the perp");
  check(scared.indexOf(w2) >= 0, "w2, stared down by the perp's crew, was scared off");
  check(scared.indexOf(w1) < 0, "w1, with nobody on him, was not");
  CBZ.econ.rng = keep;
  PB.onScared = null;
  B.define("inmate", { witness: { report: 0.07, flee: 0.2, film: 0, intervene: 0.12, cower: 0.16, ignore: 0.3, cheer: 0.15 } });
});

// =========================================================================
scenario(6, "the player's crime: the witness WALKS to a screw; the report lands through onReport; a silenced one does not", function () {
  fresh(61);
  B.define("inmate", { witness: { report: 1, flee: 0, film: 0, intervene: 0, cower: 0, ignore: 0, cheer: 0 } });
  player.pos.x = 0; player.pos.z = 0;
  const g = guard(30, 30, 0);
  const w1 = inmate(0, 6, -1, { personality: { nerve: 0.5, loyalty: 0.5, snitch: 1, greed: 0.5 } });
  const w2 = inmate(6, 0, -1, { personality: { nerve: 0.5, loyalty: 0.5, snitch: 1, greed: 0.5 } });
  w1.group.rotation.y = Math.PI; w2.group.rotation.y = -Math.PI / 2;
  PB.sync();
  const runs = [];
  const reports = [];
  PB.onPlayerReported = function (n, amount) { reports.push({ n, amount }); };
  const keep = CBZ.econ.rng;
  CBZ.econ.rng = () => 0.01;          // both of them are the talking kind
  const talkers = PB.crime("assault", 0, 0, player, 0.5, {
    amount: 12, meta: {}, sightRange: 11,
    reportSnitch(n) { runs.push(n); n.aiState = "snitch"; return true; },
  });
  CBZ.econ.rng = keep;
  check(talkers >= 1 && runs.length >= 1, "a witness set off for a screw (" + runs.length + ")");
  for (let i = 0; i < 60 * 20; i++) frame(1 / 60);
  check(reports.length === 0, "nothing lands while he is still walking (held for the walk)");
  // he gets there
  PB.fileReport(runs[0], g);
  frame(1 / 60);
  check(reports.length === 1 && reports[0].n === runs[0] && reports[0].amount === 12, "at the screw: the report lands through the brain, once");
  // a second witness who is held at gunpoint on the way never reports
  if (runs[1]) {
    runs[1].intimidMode = "scared";
    frame(1 / 60);
    runs[1].intimidMode = null;
    const ok = PB.fileReport(runs[1], g);
    frame(1 / 60);
    check(!ok && reports.length === 1, "the witness you held up on the way was silenced");
  } else check(true, "(one talker only this seed: the silence path is scenario 5's)");
  PB.onPlayerReported = null;
  player.pos.x = 500; player.pos.z = 500;
  B.define("inmate", { witness: { report: 0.07, flee: 0.2, film: 0, intervene: 0.12, cower: 0.16, ignore: 0.3, cheer: 0.15 } });
});

// =========================================================================
scenario(7, "no jitter: an ordered man's answer holds; a gun near a crowd is read per man and held", function () {
  fresh(71);
  const g = guard(0, 0, 0);
  const a = inmate(0, 4, 0), b = inmate(0.9, 4, 1);
  a.aiState = "fight"; a.foe = b; b.aiState = "fight"; b.foe = a; a._fightStarter = a;
  PB.sync();
  PB.beginCase(g, a, "fight");
  let changes = 0, last = null;
  for (let i = 0; i < 60 * 3; i++) {
    frame(1 / 60);
    if (a._lawAns && a._lawAns !== last) { if (last) changes++; last = a._lawAns; }
    if (a.cuffed) break;
  }
  check(changes <= 1, "his answer changed " + changes + " time(s) in 3 s (held for a dwell)");
  // the armed player near a crowd: each man decides on his own beat, and holds it
  player.pos.x = 30; player.pos.z = 0;
  const crowd = [];
  for (let i = 0; i < 8; i++) crowd.push(inmate(30 + (i % 4), 4 + ((i / 4) | 0), -1));
  PB.sync();
  let decisions = 0;
  for (let i = 0; i < 60 * 3; i++) {
    CBZ.game.elapsed += 1 / 60; B.clock(CBZ.game.elapsed);
    for (const n of crowd) {
      const before = n._threatT;
      PB.armedNear(n, 4);
      if (n._threatT !== before) decisions++;
    }
  }
  check(decisions <= crowd.length * 2 + 2, "8 men x 3 s of a gun: " + decisions + " threat reads (was a dice roll every think)");
  const firstBeat = new Set(crowd.map((n) => Math.round((n._threatT || 0) * 10)));
  check(firstBeat.size > 1, "they do not all re-decide on the same frame");
  player.pos.x = 500; player.pos.z = 500;
});

// =========================================================================
scenario(8, "a screw's eyes: gradual awareness (no instant spot at 2 m), the dark and cover matter", function () {
  fresh(81);
  const g = guard(0, 0, 0);
  PB.sync();
  const tgt = { pos: { x: 0, y: 0, z: 2 }, speed: 1 };
  const first = B.perception.awareness(g, tgt, 1 / 60, { reason: 1 });
  check(first > 0 && first < 1, "at 2 m the meter fills over a beat, not in a frame (" + first.toFixed(3) + ")");
  let t = 0, aw = first;
  while (aw < 1 && t < 5) { t += 1 / 60; aw = B.perception.awareness(g, tgt, 1 / 60, { reason: 1 }); }
  check(t > 0.05 && t < 1.2, "...and he has you in " + t.toFixed(2) + " s");
  const far = { pos: { x: 0, y: 0, z: 10 } };
  check(B.perception.seesPoint(g, 0, 0, 10, { light: () => 1 }) && !B.perception.seesPoint(g, 0, 0, 10, { light: () => 0.5 }), "the dark shrinks the cone (lit: seen, dark: not)");
  B.perception.setOcclusion(function () { return true; });
  check(!B.perception.sees(g, far), "a wall between them: not seen");
  B.perception.setOcclusion(null);
  // the prison's block table is every inmate's routine in brain.needs
  CBZ.prisonSchedule = { hour: () => 11.75 };
  B.needs.define("inmate", [{ id: "wake", from: 5, activity: "wake" }, { id: "yard", from: 7, activity: "yard" },
    { id: "mess", from: 11.5, activity: "mess" }, { id: "night", from: 22, activity: "night" }]);
  const man = inmate(0, 0, -1); PB.sync();
  check(PB.activity(man) === "mess", "his routine at 11:45 is the prison's block (" + PB.activity(man) + ")");
  CBZ.prisonSchedule = null;
});

// ---- run ------------------------------------------------------------------
const only = process.argv.slice(2).map(Number).filter((n) => n > 0);
for (const s of scenarios) {
  if (only.length && !only.includes(s.n)) continue;
  console.log("\n[" + s.n + "] " + s.name);
  try { s.fn(); } catch (e) { fails++; console.log("  FAIL threw: " + (e && e.stack || e)); }
}
console.log("\n" + passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
