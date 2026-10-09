#!/usr/bin/env node
/* ============================================================
   tools/custody-check.mjs — THE ONE ARREST PIPELINE (city/custody.js).

   Plain node. Loads the real city/restrain.js, city/custody.js and
   city/orders.js into a vm with a stub world (a President, his two agents,
   a citizen, a road-less city that can make a car), then plays the owner's
   complaint: the President says Detain.

     1. the order is not the act: nothing is priced and nobody moves out of
        the world when the word is given
     2. the agents close in and give the order; the cuffs go on
        (restrain.js's enum: "cuffed"), and only now does the act fire
     3. he is walked by the arm ("escorted") to a unit that drove up
     4. he is put in the back ("in_vehicle") and the car pulls away
     5. he leaves the world only once the car is out of draw range, and a
        custody record holds him (who he is, where, in custody)
     6. the guard: while in custody nobody else can remove him
     7. Stand down before the cuffs calls it off; he is a free man
   Exit 0 = ok.
============================================================ */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0, passes = 0;
function ok(c, m) { if (c) { passes++; console.log("  ok " + m); } else { fails++; console.log("  FAIL " + m); } }

class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
const upd = [];
const said = [];
const acts = [];
const removed = [];
let blockedUnpost = 0;
const P = { pos: new V3(0, 0, 0), dead: false };
const peds = [], cars = [];
let clock = 0;
const root = { add() {}, remove() {} };
function mkPed(name, x, z, o) {
  const pos = new V3(x, 0, z);
  const p = Object.assign({ name, pos, target: new V3(x, 0, z), group: { position: pos, rotation: { y: 0 }, parent: root, visible: true }, char: {}, dead: false, gender: "m", state: "walk", hp: 100 }, o || {});
  peds.push(p);
  return p;
}
const regs = [];
const I = {
  register: (kind, o) => { regs.push(Object.assign({ kind }, o)); },
  registerZone() {}, describe() {}, refresh() {},
};
const CBZ = {
  game: { mode: "city" }, player: P, CONFIG: {}, city: { playerActor: P },
  onUpdate: (o, fn) => { upd.push({ o, fn }); upd.sort((a, b) => a.o - b.o); },
  interactions: I,
  cityPeds: peds, cityCops: [], cityCars: cars,
  citySay: (p, line) => { said.push({ t: clock, by: p.name, line }); return true; },
  worldDay: () => 3,
  presidency: { seat: () => ({ id: "republic", kind: "country" }), emit() {} },
  protection: { get: (id) => (id === "off_republic" ? { id, memberPedRefs: detail } : null), release() {} },
  politics: { act: (verb, o) => { acts.push({ t: clock, verb, target: o.target, by: o.by }); return { ok: true }; } },
  // the President's sightline: anything inside 100 m is on screen
  npcTransitionSafe: (x, z, o) => { const d = Math.hypot(x - P.pos.x, z - P.pos.z); if (d < (o.minDistance || 0)) return false; if (d > (o.maxDistance || 150)) return true; return d > 100; },
  cityMakeCar: (x, z, heading) => {
    const pos = new V3(x, 0, z);
    const c = { pos, heading, v: 0, ai: true, group: { position: pos, rotation: { y: heading }, parent: root, visible: true }, dead: false };
    cars.push(c);
    return c;
  },
  cityScrapCar: (c) => { const i = cars.indexOf(c); if (i >= 0) cars.splice(i, 1); c.dead = true; c._scrapped = true; return true; },
  // occupy.js's guard, verbatim in effect: a body in custody is refused
  cityUnpostNpc: (p) => {
    if (CBZ.custody && CBZ.custody.holds(p)) { blockedUnpost++; return false; }
    const i = peds.indexOf(p); if (i >= 0) peds.splice(i, 1);
    removed.push({ p, t: clock });
    return true;
  },
};
const detail = [mkPed("Agent Cole", 2, 1, { job: "secret service", _protUnit: "off_republic" }), mkPed("Agent Ruiz", 3, -1, { job: "secret service", _protUnit: "off_republic" })];
const citizen = mkPed("Dale Morrow", 12, 4, { job: "plumber", _sid: "sid_dale", armed: true, weapon: "Pistol" });
const bystander = mkPed("Ana Lind", 16, 9, { job: "teacher", _sid: "sid_ana" });

const sb = { window: null, CBZ, THREE: {}, console, Math, Object, Array, Set, Map, JSON, isFinite, Number, String, Date, Infinity, parseInt, setInterval: () => 0, clearInterval() {}, setTimeout: (f) => 0, clearTimeout() {}, performance: { now: () => clock * 1000 } };
sb.window = sb;
vm.createContext(sb);
for (const f of ["src/city/restrain.js", "src/city/custody.js", "src/city/orders.js"]) vm.runInContext(readFileSync(path.join(ROOT, f), "utf8"), sb, { filename: f });

const DT = 1 / 30;
const step = () => { clock += DT; for (const u of upd) u.fn(DT); };
const reg = (id) => regs.find((r) => r.id === id);
const CU = CBZ.custody;
ok(!!CU && !!reg("pv-detain"), "custody.js and the President's Detain verb are loaded");

// ---- 1. the word ------------------------------------------------------------------------
ok(reg("pv-detain").canShow(citizen), "Detain shows on a citizen");
reg("pv-detain").onSelect(citizen);
const job = CU.jobOf(citizen);
ok(!!job && job.officers.length === 2, "the two nearest agents take the job");
ok(acts.length === 0, "the order is not the act: nothing priced at the word");
ok(peds.includes(citizen) && citizen.group.visible, "he is still standing there");

// ---- 2..5. play it out ----------------------------------------------------------------------
const seen = {};
let removedEarly = false, maxCarD = 0, recAt = -1;
for (let i = 0; i < 30 * 90 && !seen.delivered; i++) {
  step();
  const s = citizen.restraint ? citizen.restraint.state : null;
  if (s && !seen[s]) seen[s] = clock;
  const j = CU.jobOf(citizen);
  if (j && j.departed && !seen.departed) seen.departed = clock;
  if (j && j.car && !seen.carAt) seen.carAt = clock;
  if (j && j.car) maxCarD = Math.max(maxCarD, Math.hypot(j.car.pos.x - P.pos.x, j.car.pos.z - P.pos.z));
  if (!peds.includes(citizen) && !seen.departed) removedEarly = true;
  if (removed.some((r) => r.p === citizen)) seen.delivered = clock;
  if (recAt < 0 && CU.held().some((r) => r.sid === "sid_dale")) recAt = clock;
  // 6. the guard, mid-scene: another system tries to take him out of play
  if (seen.escorted && !seen.guardTried) { seen.guardTried = true; CBZ.cityUnpostNpc(citizen); }
}
const fmt = (k) => (seen[k] != null ? seen[k].toFixed(1) + " s" : "never");
console.log("  timeline: cuffed " + fmt("cuffed") + ", escorted " + fmt("escorted") + ", in_vehicle " + fmt("in_vehicle") + ", departed " + fmt("departed") + ", out of the world " + fmt("delivered"));
ok(said.some((l) => /Secret Service/.test(l.line)), "the order is shouted: \"" + (said.find((l) => /Secret Service/.test(l.line)) || {}).line + "\"");
ok(seen.cuffed > 0, "he is cuffed (restraint enum \"cuffed\") at " + fmt("cuffed"));
ok(acts.length === 1 && acts[0].verb === "detain" && acts[0].t >= seen.cuffed - 1e-6 && acts[0].by === "president", "the act fires once, when the cuffs go on (" + (acts[0] ? acts[0].verb + " by " + acts[0].by + " at " + acts[0].t.toFixed(1) + " s" : "none") + ")");
ok(seen.escorted > seen.cuffed, "he is walked by the arm (\"escorted\") at " + fmt("escorted"));
ok(seen.carAt > 0, "a unit is called and drives up");
ok(seen.in_vehicle > seen.escorted, "he is put in the back (\"in_vehicle\") at " + fmt("in_vehicle"));
ok(seen.departed > seen.in_vehicle, "the car pulls away at " + fmt("departed"));
ok(!removedEarly && seen.delivered > seen.departed, "he leaves the world only after the car left (" + fmt("delivered") + ", car " + maxCarD.toFixed(0) + " m out)");
ok(blockedUnpost >= 1, "the guard refused a removal while he was in custody (" + blockedUnpost + ")");
const rec = CU.held().find((r) => r.sid === "sid_dale");
ok(!!rec && rec.status === "held" && rec.name === "Dale Morrow" && rec.verb === "detain" && rec.seized.includes("Pistol"), "custody record: " + (rec ? rec.name + ", " + rec.status + " at " + rec.facility.name + ", " + rec.verb + ", seized " + rec.seized.join("/") : "none"));
ok(recAt > 0 && recAt >= seen.cuffed - 1e-6, "the record exists from the cuffs on");
ok(detail.every((a) => !a._custodyJob && !a._order), "the agents are handed back to the detail");
ok(!cars.some((c) => c._custodyUnit) && maxCarD > 90, "the unit drove out of sight (" + maxCarD.toFixed(0) + " m) and is gone");

// ---- 7. Stand down before the cuffs ---------------------------------------------------------
reg("pv-detain").onSelect(bystander);
for (let i = 0; i < 6; i++) step();
const j2 = CU.jobOf(bystander);
ok(!!j2 && !j2.cuffed && reg("pv-call-off").canShow(bystander), "a second Detain is under way, Stand down offered");
reg("pv-call-off").onSelect(bystander);
for (let i = 0; i < 30; i++) step();
ok(!CU.jobOf(bystander) && !bystander.restraint && !bystander.controlled && peds.includes(bystander), "Stand down before the cuffs: he is free and still there");

// ---- afterwards: a pardon walks him out, a trial is a verdict ---------------------------------
const r2 = CU.release(rec.id, { how: "pardoned", at: { x: 50, z: 50 } });
ok(r2 && r2.status === "pardoned" && !CU.held().some((r) => r.sid === "sid_dale"), "release: he is no longer held");

console.log((fails ? "FAIL" : "PASS") + " custody-check: " + passes + " ok, " + fails + " failed");
process.exit(fails ? 1 : 0);
