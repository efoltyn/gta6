#!/usr/bin/env node
/* ============================================================
   tools/custody-check.mjs — THE ONE ARREST PIPELINE (city/custody.js).

   Plain node, no browser. Loads the real city/restrain.js, city/custody.js
   and city/orders.js into a vm with a stub world (a President, his two
   agents, citizens, a road-less city that can make a car and post a body),
   then plays the owner's two complaints:

   "Detain doesn't always work. They put their hands up and act like they're
   going to be detained, but nobody goes to detain them." A SURRENDER ALWAYS
   RESOLVES:
     A. the agents walk over, the cuffs go on, the act fires once at the cuffs
     B. both agents are stuck within shouting range (his hands go up): each is
        unstuck, then swapped out, then a unit is dispatched and ITS crew gets
        out, walks over and cuffs him; the order is not stood down meanwhile
     C. truly nobody can come: he holds his hands up until GIVEUP_T, then
        lowers them, says so, and walks off (CBZ.leave). Never before REACH_T.
     D. nobody else near: the President's own hands cuff him, lawfully

   "When someone is detained they stay with YOU" (the hold):
     E. cuffed, he is walked at your shoulder by the agent who cuffed him; the
        second agent goes back to the detail; no car is called
     F. walk away far and the agent stands with him and keeps him
     G. Search says what he carries
     H. drive: he goes in the back of your car, rides, comes out when you get
        out, and an agent near him takes him over
     I. Jail: a unit drives up, he is put in, the car leaves, and only then
        does the body leave the world; the record holds him
     J. Release: the cuffs come off and he walks away (CBZ.leave)
     K. Execute: the agent shoots him (cityKillPed, "executed"), the
        President's bill fires once, the record says died
     L. Stand down before the cuffs: he is a free man where he stands
   Exit 0 = ok.
============================================================ */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, passes = 0;
function ok(c, m) { if (c) { passes++; console.log("  ok " + m); } else { fails++; console.log("  FAIL " + m); } }
const SRC = {};
for (const f of ["src/city/restrain.js", "src/city/custody.js", "src/city/orders.js"]) SRC[f] = readFileSync(path.join(ROOT, f), "utf8");

class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
const hyp = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

// ---- one fresh world per scenario ------------------------------------------------------------
function world(o) {
  o = o || {};
  const W = { upd: [], said: [], acts: [], removed: [], left: [], kills: [], crimes: [], clock: 0, blockedUnpost: 0, posted: 0 };
  const P = W.P = { pos: new V3(0, 0, 0), dead: false, driving: false, _vehicle: null };
  const peds = W.peds = [], cars = W.cars = [];
  const root = { add() {}, remove() {} };
  const mkPed = W.mkPed = function (name, x, z, extra) {
    const pos = new V3(x, 0, z);
    const p = Object.assign({ name, pos, target: new V3(x, 0, z), group: { position: pos, rotation: { y: 0 }, parent: root, visible: true }, char: {}, dead: false, gender: "m", state: "walk", hp: 100 }, extra || {});
    peds.push(p);
    return p;
  };
  const regs = W.regs = [];
  const I = { register: (kind, r) => { regs.push(Object.assign({ kind }, r)); }, registerZone() {}, registerSource() {}, describe() {}, refresh() {} };
  const mkCar = W.mkCar = function (x, z, heading) {
    const pos = new V3(x, 0, z);
    const c = { pos, heading: heading || 0, v: 0, ai: true, group: { position: pos, rotation: { y: heading || 0 }, parent: root, visible: true }, dead: false };
    cars.push(c);
    return c;
  };
  const CBZ = W.CBZ = {
    game: { mode: "city" }, player: P, CONFIG: {}, city: { playerActor: P },
    onUpdate: (ord, fn) => { W.upd.push({ o: ord, fn }); W.upd.sort((a, b) => a.o - b.o); },
    interactions: I,
    cityPeds: peds, cityCops: [], cityCars: cars,
    citySay: (p, line) => { W.said.push({ t: W.clock, by: p && p.name, line }); return true; },
    worldDay: () => 3,
    presidency: { seat: () => ({ id: "republic", kind: "country" }), emit() {} },
    protection: { get: (id) => (id === "off_republic" ? { id, memberPedRefs: W.detail } : null), release() {} },
    politics: { act: (verb, a) => { W.acts.push({ t: W.clock, verb, target: a.target, by: a.by }); return { ok: true }; } },
    // the President's sightline: anything inside 100 m is on screen
    npcTransitionSafe: (x, z, q) => { const d = Math.hypot(x - P.pos.x, z - P.pos.z); if (d < (q.minDistance || 0)) return false; if (d > (q.maxDistance || 150)) return true; return d > 100; },
    leave: {
      go: (b, q) => { W.left.push({ b, tag: q && q.tag, t: W.clock }); b._leaving = { tag: q && q.tag }; return b._leaving; },
      unseen: (p, q) => { const d = Math.hypot(p.x - P.pos.x, p.z - P.pos.z); if (q && q.minDistance && d < q.minDistance) return false; return d > 100; },
    },
    // city/boarding.js in effect: a body is put in a free seat of the car
    boarding: {
      freeSeats: () => 3,
      board: (b, car) => { b._cbzSeat = { veh: car }; b.inCar = true; return true; },
      alight: (b) => { b._cbzSeat = null; b.inCar = false; },
    },
    cityKillPed: (p, imp, cause) => { if (p.dead) return; p.dead = true; p.hp = 0; W.kills.push({ p, imp, cause, t: W.clock }); },
    cityCrime: (heat, q) => { W.crimes.push({ heat, type: q && q.type, t: W.clock }); },
    cityMakeCar: o.noCars ? null : (x, z, heading) => mkCar(x, z, heading),
    cityPostNpc: o.noPost ? null : (x, z, q) => { W.posted++; return mkPed("Crew " + W.posted, x, z, { job: q && q.job }); },
    cityScrapCar: (c) => { const i = cars.indexOf(c); if (i >= 0) cars.splice(i, 1); c.dead = true; c._scrapped = true; return true; },
    // occupy.js's guard, verbatim in effect: a body in custody is refused
    cityUnpostNpc: (p) => {
      if (CBZ.custody && CBZ.custody.holds(p)) { W.blockedUnpost++; return false; }
      const i = peds.indexOf(p); if (i >= 0) peds.splice(i, 1);
      W.removed.push({ p, t: W.clock });
      return true;
    },
  };
  if (o.noCars) delete CBZ.cityMakeCar;
  if (o.noPost) delete CBZ.cityPostNpc;
  // a body with a verb that never ends (stuck on a stair, wedged on a wall):
  // custody's walk cannot move it
  const frozen = o.frozenAgents ? { _verbS: { done: false, verb: "watch" } } : {};
  W.detail = [
    mkPed("Agent Cole", 2, 1, Object.assign({ job: "secret service", _protUnit: "off_republic" }, frozen)),
    mkPed("Agent Ruiz", 3, -1, Object.assign({ job: "secret service", _protUnit: "off_republic" }, o.frozenAgents ? { _verbS: { done: false, verb: "watch" } } : {})),
  ];
  const sb = { window: null, CBZ, THREE: {}, console, Math, Object, Array, Set, Map, JSON, isFinite, Number, String, Date, Infinity, parseInt, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, performance: { now: () => W.clock * 1000 } };
  sb.window = sb;
  vm.createContext(sb);
  for (const f in SRC) vm.runInContext(SRC[f], sb, { filename: f });
  const DT = 1 / 30;
  W.step = (n) => { for (let i = 0; i < (n || 1); i++) { W.clock += DT; for (const u of W.upd) u.fn(DT); } };
  W.secs = (s) => W.step(Math.round(s * 30));
  W.until = (fn, maxS) => { for (let i = 0; i < Math.round((maxS || 60) * 30); i++) { if (fn()) return true; W.step(1); } return !!fn(); };
  W.reg = (id) => regs.find((r) => r.id === id);
  W.CU = CBZ.custody;
  W.st = (p) => (p.restraint ? p.restraint.state : null);
  return W;
}
const f1 = (x) => (x == null ? "never" : x.toFixed(1) + " s");

// ======================================================================================
console.log("A/E-K. Detain: the agents take him, he is held with you, then you choose");
{
  const W = world();
  const { CU, P } = W;
  const citizen = W.mkPed("Dale Morrow", 12, 4, { job: "plumber", _sid: "sid_dale", armed: true, weapon: "Pistol", cash: 40 });
  ok(!!CU && !!W.reg("order-detain"), "custody.js and the President's Detain verb are loaded");
  ok(W.reg("order-detain").canShow(citizen), "Detain shows on a citizen");
  W.reg("order-detain").onSelect(citizen);
  const job = CU.jobOf(citizen);
  ok(!!job && job.officers.length === 2, "the two nearest agents take the job");
  ok(W.acts.length === 0, "the order is not the act: nothing priced at the word");
  W.until(() => W.st(citizen), 30);
  const cuffedAt = W.clock;
  ok(W.st(citizen) === "cuffed" || W.st(citizen) === "escorted", "he is cuffed at " + f1(cuffedAt));
  ok(W.said.some((l) => /Secret Service/.test(l.line)), "the order was shouted");
  ok(W.acts.length === 1 && W.acts[0].verb === "detain" && W.acts[0].by === "president", "the act fires once, at the cuffs");
  W.secs(1);
  const j = CU.jobOf(citizen);
  const holder = j && j.officers[0];
  ok(j && j.phase === "hold" && j.held, "E. he is HELD, not shipped (phase " + (j && j.phase) + ")");
  ok(!!holder && holder._custodyJob === j.id && W.st(citizen) === "escorted" && citizen.restraint.officer === holder, "E. " + (holder && holder.name) + " has him by the arm");
  const other = W.detail.find((a) => a !== holder);
  ok(!other._custodyJob && !other._order, "E. the second agent went back to the detail");
  ok(!W.cars.length && !j.car, "E. no car was called");
  ok(W.reg("cu-jail").canShow(citizen) && W.reg("cu-search").canShow(citizen) && W.reg("cu-execute").canShow(citizen) && W.reg("cu-let-go").canShow(citizen), "his verbs: Jail / Search / Execute / Release");
  ok(!W.reg("order-call-off").canShow(citizen), "Stand down is not offered on a cuffed man");

  // the President walks 36 m down the street
  for (let i = 0; i < 30 * 18; i++) { P.pos.x += 2 / 30; W.step(1); }
  ok(hyp(citizen, P) < 6 && hyp(holder, P) < 5, "E. he walked with you (" + hyp(citizen, P).toFixed(1) + " m from you, agent " + hyp(holder, P).toFixed(1) + " m)");
  ok(CU.jobOf(citizen) === j && W.peds.includes(citizen), "E. still held, still in the world");

  // F. walk far away: the agent stands with him and keeps him
  const hx = holder.pos.x;
  P.pos.x += 60; W.secs(3);
  ok(Math.abs(holder.pos.x - hx) < 1 && W.st(citizen) === "escorted" && CU.jobOf(citizen) === j, "F. you walked away: the agent stands and keeps him");
  P.pos.x -= 58; W.secs(8);
  ok(hyp(citizen, P) < 6, "F. you came back: he walks with you again (" + hyp(citizen, P).toFixed(1) + " m)");

  // G. Search
  W.reg("cu-search").onSelect(citizen);
  const sl = W.said.filter((l) => l.by === holder.name).pop();
  ok(sl && /Pistol/.test(sl.line) && /\$40/.test(sl.line), "G. Search: \"" + (sl && sl.line) + "\"");
  ok(!W.reg("cu-search").canShow(citizen), "G. searched once");

  // H. drive: in the back, ride, out again
  const mine = W.mkCar(P.pos.x + 3, P.pos.z + 2, 0);
  P.driving = true; P._vehicle = mine;
  W.secs(1);
  ok(W.st(citizen) === "in_vehicle" && citizen.restraint.vehicle === mine, "H. you drive: he is in the back of your car");
  ok(!holder._custodyJob && j.officers.length === 0 && CU.jobOf(citizen) === j, "H. the agent went back to work; he is still held");
  for (let i = 0; i < 30 * 5; i++) { mine.pos.x += 8 / 30; P.pos.x += 8 / 30; if (citizen._cbzSeat) { citizen.pos.x = mine.pos.x; citizen.pos.z = mine.pos.z; } W.step(1); }
  // an agent of the detail is standing at the kerb where you stop
  W.detail[1].pos.set(mine.pos.x + 4, 0, mine.pos.z + 1);
  P.driving = false; P._vehicle = null; P.pos.set(mine.pos.x - 1.5, 0, mine.pos.z);
  W.secs(3);
  ok(W.st(citizen) === "escorted" && citizen.restraint.officer === W.detail[1], "H. you got out: he is out of the car and " + W.detail[1].name + " has him");

  // I. Jail
  W.reg("cu-jail").onSelect(citizen);
  const seen = {};
  let removedEarly = false, maxCarD = 0;
  for (let i = 0; i < 30 * 120 && !seen.delivered; i++) {
    W.step(1);
    const s = W.st(citizen);
    if (s && !seen[s]) seen[s] = W.clock;
    const jj = CU.jobOf(citizen);
    if (jj && jj.car && !seen.carAt) seen.carAt = W.clock;
    if (jj && jj.departed && !seen.departed) seen.departed = W.clock;
    if (jj && jj.car) maxCarD = Math.max(maxCarD, Math.hypot(jj.car.pos.x - P.pos.x, jj.car.pos.z - P.pos.z));
    if (!W.peds.includes(citizen) && !seen.departed) removedEarly = true;
    if (W.removed.some((r) => r.p === citizen)) seen.delivered = W.clock;
    if (seen.in_vehicle && !seen.guardTried) { seen.guardTried = true; W.CBZ.cityUnpostNpc(citizen); }
  }
  ok(seen.carAt > 0, "I. Jail: a unit is called and drives up");
  ok(seen.in_vehicle > 0, "I. he is put in the back of it at " + f1(seen.in_vehicle));
  ok(seen.departed > seen.in_vehicle, "I. the car pulls away at " + f1(seen.departed));
  ok(!removedEarly && seen.delivered > seen.departed, "I. he leaves the world only after the car left (" + f1(seen.delivered) + ", car " + maxCarD.toFixed(0) + " m out)");
  ok(W.blockedUnpost >= 1, "I. the guard refused a removal while he was in custody");
  const rec = CU.held().find((r) => r.sid === "sid_dale");
  ok(!!rec && rec.status === "held" && rec.verb === "detain" && rec.seized.includes("Pistol"), "I. record: " + (rec ? rec.name + ", " + rec.status + " at " + rec.facility.name + ", seized " + rec.seized.join("/") : "none"));
  ok(W.detail.every((a) => !a._custodyJob && !a._order), "I. the agents are handed back to the detail");
  ok(!W.cars.some((c) => c._custodyUnit), "I. the unit drove out of sight and is gone");
}

console.log("J/K/L. Release, Execute, Stand down");
{
  const W = world();
  const { CU } = W;
  const ana = W.mkPed("Ana Lind", 10, 6, { job: "teacher", _sid: "sid_ana" });
  W.reg("order-detain").onSelect(ana);
  W.until(() => CU.jobOf(ana) && CU.jobOf(ana).held, 30);
  ok(CU.jobOf(ana) && CU.jobOf(ana).held, "J. Ana is held");
  W.reg("cu-let-go").onSelect(ana);
  W.secs(0.5);
  ok(!ana.restraint && !CU.jobOf(ana) && !ana.controlled, "J. Release: the cuffs are off, no job");
  ok(W.left.some((l) => l.b === ana), "J. she walks away (CBZ.leave)");
  ok(W.said.some((l) => /free to go/.test(l.line)), "J. \"You're free to go.\"");
  W.secs(2);

  const vic = W.mkPed("Ray Okafor", 8, -6, { job: "driver", _sid: "sid_ray" });
  W.reg("order-detain").onSelect(vic);
  W.until(() => CU.jobOf(vic) && CU.jobOf(vic).held, 30);
  const hj = CU.jobOf(vic), shooter = hj && hj.officers[0];
  const actsBefore = W.acts.length;
  W.reg("cu-execute").onSelect(vic);
  W.secs(1);
  const k = W.kills.find((x) => x.p === vic);
  ok(vic.dead && k && k.cause === "executed" && k.imp.attacker === shooter, "K. Execute: " + (shooter && shooter.name) + " shot him (cityKillPed, executed)");
  const kills = W.acts.slice(actsBefore).filter((a) => a.verb === "kill");
  ok(kills.length === 1 && kills[0].by === "president", "K. the President's bill fires once (" + kills.length + ")");
  const r = W.CU.records().find((x) => x.sid === "sid_ray");
  ok(r && r.status === "died", "K. the record says " + (r && r.status));
  ok(!CU.jobOf(vic) && W.detail.every((a) => !a._custodyJob), "K. the job is over, the agents are back");

  const bys = W.mkPed("Lee Ward", 14, 9, { job: "clerk" });
  W.reg("order-detain").onSelect(bys);
  W.step(6);
  ok(CU.jobOf(bys) && !CU.jobOf(bys).cuffed && W.reg("order-call-off").canShow(bys), "L. a Detain is under way, Stand down offered");
  W.reg("order-call-off").onSelect(bys);
  W.step(30);
  ok(!CU.jobOf(bys) && !bys.restraint && !bys.controlled && W.peds.includes(bys), "L. Stand down before the cuffs: he is free and still there");
}

console.log("B. both agents stuck within shouting range: unstuck, swapped, a unit and its crew");
{
  const W = world({ frozenAgents: true });
  const { CU } = W;
  const t = W.mkPed("Vic Haines", 10, 3, { job: "welder", _sid: "sid_vic" });
  W.reg("order-detain").onSelect(t);
  W.secs(1);
  ok(t.surrender, "his hands are up (the agents are " + hyp(W.detail[0], t).toFixed(1) + " m away)");
  let handsDownEarly = false, cuffedAt = null, standDown = false;
  for (let i = 0; i < 30 * 70 && !cuffedAt; i++) {
    W.step(1);
    if (!CU.jobOf(t)) { standDown = true; break; }
    if (!CU.jobOf(t).cuffed && !t.surrender) handsDownEarly = true;
    if (W.st(t)) cuffedAt = W.clock;
  }
  const a = CU.audit();
  ok(!standDown, "the order was not stood down while the agents were swapped out");
  ok(a.unstuck >= 1 && a.swapped >= 2, "the stuck agents were unstuck (" + a.unstuck + ") then swapped out (" + a.swapped + ")");
  ok(a.dispatched === 1 && W.posted >= 2, "a unit was dispatched and its crew got out (" + W.posted + " posted)");
  ok(!handsDownEarly, "his hands stayed up the whole time somebody was coming");
  ok(cuffedAt != null && cuffedAt < 45, "the crew cuffed him at " + f1(cuffedAt));
  W.secs(1);
  const j = CU.jobOf(t);
  ok(j && j.held && j.officers[0] && /^Crew/.test(j.officers[0].name), "he is held by " + (j && j.officers[0] && j.officers[0].name));
  ok(W.detail.every((q) => !q._custodyJob), "the stuck agents are off the job");
}

console.log("C. truly nobody can come: hands down, a line, he walks off");
{
  const W = world({ frozenAgents: true, noCars: true, noPost: true });
  const { CU, P } = W;
  P.pos.set(-20, 0, 0);
  const t = W.mkPed("Moe Price", 8, 2, { job: "baker" });
  W.reg("order-detain").onSelect(t);
  let gaveAt = null, early = false;
  for (let i = 0; i < 30 * 90 && gaveAt == null; i++) {
    W.step(1);
    if (!CU.jobOf(t)) { gaveAt = W.clock; break; }
    if (W.clock > 2 && !t.surrender) early = true;
  }
  ok(gaveAt != null && gaveAt >= 44 && gaveAt < 50, "the job resolved at " + f1(gaveAt) + " (GIVEUP_T 45 s), not silently at a minute");
  ok(!early, "his hands stayed up until then");
  ok(!t.surrender && !t.poseHandsUp && !t.restraint, "his hands are down");
  ok(W.said.some((l) => l.by === "Moe Price" && /nobody/i.test(l.line)), "he says so: \"" + ((W.said.find((l) => l.by === "Moe Price" && /nobody/i.test(l.line)) || {}).line) + "\"");
  ok(W.left.some((l) => l.b === t && l.tag === "custody:nobody"), "he walks off through CBZ.leave");
  ok(CU.audit().nobody === 1, "custody counts it (audit.nobody)");
}

console.log("D. nobody else near: the President cuffs him himself");
{
  const W = world({ frozenAgents: true, noCars: true, noPost: true });
  const { CU, P } = W;
  // his hands are already up (a gunpoint surrender: no run is rolled)
  const t = W.mkPed("Kit Shaw", 8, 2, { job: "cook", surrender: true, surrenderT: 3 });
  W.reg("order-detain").onSelect(t);
  W.secs(20);   // both agents unstuck then swapped out (2 x 2 x STALL_T), no unit to send
  const j = CU.jobOf(t);
  ok(j && j.playerHands && t.surrender, "the President's own hands are asked (playerHands), his hands are up");
  P.pos.set(7, 0, 2);
  W.CBZ.cityRestrain.cuff(t);
  W.secs(1);
  const j2 = CU.jobOf(t);
  ok(j2 && j2.cuffed && j2.held, "cuffed by you: held");
  ok(!W.crimes.some((c) => c.type === "kidnapping"), "a detention the state ordered is not a kidnapping");
  ok(W.acts.filter((a) => a.verb === "detain").length <= 1, "priced at most once");
}

console.log((fails ? "FAIL" : "PASS") + " custody-check: " + passes + " ok, " + fails + " failed");
process.exit(fails ? 1 : 0);
