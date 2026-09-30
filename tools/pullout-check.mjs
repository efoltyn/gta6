#!/usr/bin/env node
/* tools/pullout-check.mjs — DOES EVERYBODY HAVE A WAY TO PULL SOMEBODY OUT
   OF A CAR?

   Owner, 2026-09-30: "Cops have no way to pull you out of a car yet, so
   while you're in one they just chase you. Everyone should have a way to
   do this."

   Loads the REAL src/city/pullout.js in plain node against a scripted
   world: the door beats (CBZ.moves.board's cwalk / cpull / cwait / cswing /
   cin, on their real durations), a car with a speed and a position, a seat
   map, and recording stand-ins for the bodies (knockdown / stagger / exit /
   arrest). Frame by frame at 60 fps:

     RULES     the pure table: speed, the driver's answer, the break, the
               fall, the lock
     COP/YOU   a stopped car: one officer walks to your door, pulls it, you
               are out on the ground (subdued) and the real take is called
               with his hands, ~1.5 s from the handle
     FLOOR IT  the same, but you drive off during the grab: the pull breaks,
               the officer is knocked off the door, you are still driving
     LOCKED    a car you have driven is locked: the window goes in first
               (slower), then the same pull
     MOVING    a rolling car is never started on
     SUSPECT   an officer on a fleeing NPC car: the driver goes down and
               cityNpcArrest gets him; the car stops being a suspect
     CARJACK   an NPC carjacker: a timid driver freezes (brake held), is
               dragged out stumbling, the jacker gets in (onDone); a brave
               one floors it and the jacker is knocked back
     YOURS     the player's own carjack (prepare + hooks): the car answers
               through cityJackNow and the door clears for him

     node tools/pullout-check.mjs [--verbose]   exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const VERBOSE = process.argv.includes("--verbose");
const DT = 1 / 60;
const ROOT = new URL("../", import.meta.url);
let fails = 0;
const rows = [];
function check(ok, name, detail) { rows.push({ ok: !!ok, name, detail: detail || "" }); if (!ok) fails++; }

// ---------------------------------------------------------------- the world
function makeWorld() {
  const log = [];
  const updaters = [];
  const P = { pos: { x: 0, y: 0, z: 0 }, driving: false, _vehicle: null, dead: false };
  const CBZ = {
    player: P, playerChar: { group: {} }, city: { playerActor: { isPlayer: true, pos: P.pos } },
    game: { mode: "city", elapsed: 0 },
    cityCops: [],
    onUpdate: function (o, fn) { updaters.push({ o, fn }); },
  };
  CBZ.city.playerActor.pos = P.pos;
  // --- the door beats (entities/moves_posture.js MV.board, on its real clocks)
  const recs = new Map();
  const DUR = { cwalk: 0.8, cpull: 0.30, cswing: 0.30, cin: 0.62 };
  CBZ.moves = {
    board: function (a, V, opts) {
      if (recs.has(a)) return false;
      const names = ["cwalk", "cpull"];
      if (V.jack) names.push("cwait");
      if (!(opts && opts.pullOnly && V.jack)) names.push("cswing", "cin");
      const ap = a === P ? P.pos : a.pos;
      recs.set(a, { names, i: 0, t: 0, V, jacked: false, ap, sx: ap.x, sz: ap.z });
      log.push({ ev: "board", a, pullOnly: !!(opts && opts.pullOnly) });
      return true;
    },
    carBeat: function (a) { const r = recs.get(a); return r ? r.names[r.i] : null; },
    carAbort: function (a) { if (recs.delete(a)) log.push({ ev: "abort", a }); },
    stand: function () { return true; },
    update: function (dt) {
      for (const [a, r] of recs) {
        r.t += dt;
        const nm = r.names[r.i];
        // the walk: the body really crosses to the handle (1.4 m off the flank)
        if (nm === "cwalk" && r.V._car) {
          const k = Math.min(1, r.t / DUR.cwalk), c = r.V._car;
          r.ap.x = r.sx + (c.pos.x + 1.4 - r.sx) * k; r.ap.z = r.sz + (c.pos.z - r.sz) * k;
        }
        let done = false;
        if (nm === "cwait") done = r.t > 0.3 && (!r.V.clear || r.V.clear() || r.t > (r.V.waitMax || 1.8));
        else done = r.t >= DUR[nm];
        if (nm === "cpull" && done && r.V.jack && !r.jacked) { r.jacked = true; r.V.jack(); }
        if (done) { r.i++; r.t = 0; if (r.i >= r.names.length) { recs.delete(a); log.push({ ev: "mvdone", a }); } }
      }
    },
  };
  CBZ.boarding = {
    pullSpec: function (car, seat, actor, hooks) { return Object.assign({ side: 1, _car: car }, hooks); },
    doorBusy: function () { return false; },
    door: function (car, seat, t) { log.push({ ev: "door", t }); return true; },
  };
  CBZ.carSeats = {
    occupant: function (car, id) { return car.seatOcc[id] || null; },
    playerSeat: function (car) { return P.driving && P._vehicle === car ? { id: "driver" } : null; },
    seatOf: function (car, ref) { for (const k in car.seatOcc) if (car.seatOcc[k].ref === ref) return k; return null; },
  };
  CBZ.cityPullOccupant = function (car, slot, by, opts) {
    const out = [];
    for (const k of Object.keys(car.seatOcc)) {
      if (!opts.all && k !== slot) continue;
      const o = car.seatOcc[k];
      if (o.kind !== "npc") continue;
      o.ref._occLastReact = o.ref.react || "freeze";
      o.ref.pos = { x: car.pos.x + 1.8, y: 0, z: car.pos.z };
      delete car.seatOcc[k];
      out.push(o.ref);
    }
    if (out.length) { car.ai = false; car.v = 0; }
    log.push({ ev: "pullOcc", n: out.length, cop: !!opts.cop });
    return out;
  };
  CBZ.cityJackNow = function (car) { const n = Object.keys(car.seatOcc).length; car.seatOcc = {}; car._jackDone = true; log.push({ ev: "jackNow", n }); return n; };
  CBZ.cityExitVehicle = function () {
    const car = P._vehicle;
    P.driving = false; P._vehicle = null;
    if (car) { car.player = false; delete car.seatOcc.driver; P.pos.x = car.pos.x + 1.6; P.pos.z = car.pos.z; }
    log.push({ ev: "exit", pulled: !!P._pulledOut });
  };
  CBZ.verbs = {
    playerActor: function () { return CBZ.city.playerActor; },
    knockdown: function (t, o) { log.push({ ev: "knockdown", t, dur: o.dur }); if (t && t !== CBZ.city.playerActor) t.ko = 3; return true; },
    react: function (t, o) { log.push({ ev: "stagger", t }); return true; },
  };
  CBZ.arrest = { subdue: function (s, why) { log.push({ ev: "subdue", s, why }); } };
  CBZ.cityArrestTake = function (cop) { log.push({ ev: "take", cop }); return true; };
  CBZ.cityNpcArrest = function (ped, cop) { log.push({ ev: "npcArrest", ped, cop }); ped.npcWanted = 0; };
  CBZ.cityCarFrost = function () { log.push({ ev: "frost" }); };
  CBZ.cityTraits = function (p) { return { nerve: p.nerve == null ? 0.4 : p.nerve }; };
  CBZ.cityHasGun = function () { return false; };
  CBZ.sfx = function () {};

  const ctx = vm.createContext({ window: { CBZ }, console, Math, Object, Number });
  vm.runInContext(readFileSync(new URL("src/city/pullout.js", ROOT), "utf8"), ctx, { filename: "src/city/pullout.js" });
  const PO = CBZ.pullOut;
  let time = 0;
  function step(car) {
    time += DT;
    CBZ.game.elapsed = time;
    CBZ.moves.update(DT);
    for (const u of updaters) u.fn(DT);
    // the car: an NPC flooring it (vehicles.js's _pullFleeT), the brake held, or the player's foot
    for (const c of [].concat(car || [])) {
      if (c._pullFleeT > 0) { c._pullFleeT -= DT; c.v = Math.min(12, (c.v || 0) + 3.2 * DT); }
      if (c._pullHoldT > 0) { c._pullHoldT -= DT; c.v = 0; }
      if (c._throttle) c.v = Math.min(12, (c.v || 0) + 4 * DT);
      c.vx = c.v || 0; c.vz = 0;
      c.pos.x += (c.v || 0) * DT;
      if (P.driving && P._vehicle === c) { P.pos.x = c.pos.x; P.pos.z = c.pos.z; }
    }
  }
  function run(car, secs, until) {
    const n = Math.round(secs / DT);
    for (let i = 0; i < n; i++) { step(car); if (until && until()) return true; }
    return false;
  }
  return { CBZ, PO, P, log, step, run, now: () => time };
}
function makeCar(x, z, extra) {
  return Object.assign({ pos: { x, y: 0, z }, v: 0, vx: 0, vz: 0, heading: 0, seatOcc: {}, group: { parent: {} }, ai: true, road: {} }, extra || {});
}
function ped(x, z, extra) { return Object.assign({ pos: { x, y: 0, z }, group: {}, char: {}, target: { set() {} } }, extra || {}); }
const has = (log, ev, f) => log.some((e) => e.ev === ev && (!f || f(e)));
const at = (log, ev) => log.findIndex((e) => e.ev === ev);

// ---------------------------------------------------------------- 1. RULES
{
  const { PO } = makeWorld();
  check(PO.speedOf({ v: -1.5, vx: 0, vz: 0 }) === 1.5, "rules: speed is |v| or |(vx,vz)|, the larger");
  check(PO.speedOf({ v: 0, vx: 3, vz: 4 }) === 5, "rules: speed from the velocity vector");
  check(PO.driverAnswer({ fleeing: true, nerve: 0 }) === "floor", "rules: a fleeing suspect always floors it");
  check(PO.driverAnswer({ cop: true, nerve: 0.6 }) === "hold", "rules: most drivers stop for a badge");
  check(PO.driverAnswer({ armed: true, nerve: 0.6 }) === "hold" && PO.driverAnswer({ armed: true, nerve: 0.8 }) === "floor", "rules: a gun at the door freezes all but the bravest");
  check(PO.driverAnswer({ nerve: 0.3 }) === "hold" && PO.driverAnswer({ nerve: 0.7 }) === "floor", "rules: unarmed, nerve decides");
  check(PO.broke("grab", 3.5, 0) && PO.broke("walk", 0, 2) && !PO.broke("grab", 1, 0.5) && !PO.broke("drag", 9, 9), "rules: the break (before the grab only)");
  check(PO.fall({ cop: true }) === "down" && PO.fall({ player: true }) === "down" && PO.fall({ react: "flee" }) === null && PO.fall({}) === "stumble", "rules: how the body lands");
  check(PO.lockedNow({ locked: true }) && PO.lockedNow({ pullover: 4 }) && !PO.lockedNow({ pullover: 4, _pullSmashed: true }) && !PO.lockedNow({}), "rules: the lock (and a smashed window stays open)");
}

// ---------------------------------------------------------------- 2. COP / YOU
function copOnPlayer(opts) {
  opts = opts || {};
  const W = makeWorld();
  const { CBZ, PO, P, log } = W;
  const car = makeCar(0, 0, { player: true, ai: false, road: null });
  car.seatOcc.driver = { kind: "player", ref: P };
  P.driving = true; P._vehicle = car;
  const cop = ped(6, 0, { kind: "cop", armed: true });
  CBZ.cityCops.push(cop);
  if (opts.locked) {
    // he drove it (the doors lock over 4 m/s), then stopped
    car.v = 6; W.step(car); car.v = 0; car.vx = 0;
  }
  let started = false, tStart = 0;
  for (let i = 0; i < 120 && !started; i++) { started = PO.copTry(cop, car, 6); W.step(car); if (started) tStart = W.now(); }
  return { W, car, cop, started, tStart };
}
{
  const { W, car, cop, started, tStart } = copOnPlayer();
  const { PO, P, log } = W;
  check(started, "cop/you: an officer commits to your door once the car has been stopped a beat");
  check(cop._pulling && cop._boardOwn, "cop/you: the door beats own his body (police.js skips a _pulling officer)");
  check(PO.copTry(ped(5, 0, { kind: "cop" }), car, 5) === false, "cop/you: one officer at the door, the rest cover");
  let tExit = -1;
  W.run(car, 6, () => { if (tExit < 0 && has(log, "exit")) tExit = W.now(); return has(log, "take"); });
  const walk = 0.8, fromHandle = tExit - tStart - walk;
  check(tExit > 0 && !P.driving, "cop/you: you are pulled out of the seat", "t=" + (tExit - tStart).toFixed(2) + "s");
  check(has(log, "exit", (e) => e.pulled), "cop/you: dragged, not the climb-out exit (P._pulledOut)");
  check(fromHandle > 0.6 && fromHandle < 1.8, "cop/you: ~1.5 s at the door, not instant", fromHandle.toFixed(2) + " s after the handle");
  check(has(log, "knockdown", (e) => e.t === W.CBZ.city.playerActor) && has(log, "subdue", (e) => e.why === "down"), "cop/you: on the ground and subdued, so the cuffs can go on");
  check(has(log, "take", (e) => e.cop === cop) && at(log, "take") > at(log, "exit"), "cop/you: the real take is called, with his hands, after you are out");
  check(!cop._pulling && !cop._boardOwn, "cop/you: the officer's body is his again");
}

// ---------------------------------------------------------------- 3. FLOOR IT
{
  const { W, car, cop } = copOnPlayer();
  const { PO, P, log } = W;
  W.run(car, 3, () => { const j = PO.busy(car); return j && j.phase === "grab"; });
  car._throttle = true;
  W.run(car, 3, () => !PO.busy(car));
  check(P.driving && !has(log, "exit"), "floor it: driving off during the grab keeps you in the car");
  check(has(log, "knockdown", (e) => e.t === cop), "floor it: the officer is knocked back off the door");
  check(PO.tally.broken >= 1 && !cop._pulling, "floor it: the pull is broken and his body is his again");
}

// ---------------------------------------------------------------- 4. LOCKED
{
  const plain = copOnPlayer();
  let tA = -1;
  plain.W.run(plain.car, 8, () => { if (has(plain.W.log, "exit")) { tA = plain.W.now() - plain.tStart; return true; } return false; });
  const lk = copOnPlayer({ locked: true });
  check(lk.car.locked === true, "locked: the car you drove locked itself");
  let tB = -1;
  lk.W.run(lk.car, 8, () => { if (has(lk.W.log, "exit")) { tB = lk.W.now() - lk.tStart; return true; } return false; });
  check(has(lk.W.log, "frost") && at(lk.W.log, "frost") < at(lk.W.log, "exit"), "locked: the window goes in before the door opens");
  check(tB > tA + 0.8, "locked: the smash is a slower step", "unlocked " + tA.toFixed(2) + " s, locked " + tB.toFixed(2) + " s");
  check(lk.car._pullSmashed && !lk.car.locked, "locked: the window stays in (never locked again)");
}

// ---------------------------------------------------------------- 5. MOVING
{
  const W = makeWorld();
  const car = makeCar(0, 0, { v: 5, vx: 5 });
  const drv = ped(0, 0); car.seatOcc.driver = { kind: "npc", ref: drv };
  const cop = ped(4, 0, { kind: "cop" });
  check(W.PO.why(cop, car, "driver") === "moving" && !W.PO.start(cop, car, { cop: true }), "moving: a rolling car is never started on");
  check(W.PO.why(cop, makeCar(0, 0), "driver") === "empty", "moving: an empty seat has nobody to pull");
}

// ---------------------------------------------------------------- 6. SUSPECT
{
  const W = makeWorld();
  const { PO, log } = W;
  const car = makeCar(0, 0, { pullover: 4, npcWanted: 1 });
  const drv = ped(0, 0, { nerve: 0.2 }); car.seatOcc.driver = { kind: "npc", ref: drv };
  const cop = ped(7, 0, { kind: "cop" });
  let started = false;
  for (let i = 0; i < 90 && !started; i++) { started = PO.copTry(cop, car, 7); W.step(car); }
  check(started, "suspect: an officer goes to a stopped fleeing car's door");
  check(PO.busy(car) && PO.busy(car).locked, "suspect: a fleeing car is locked (the window first)");
  // boxed in: however hard he floors it, the car cannot go
  W.run(car, 7, () => { car._pullFleeT = 0; car.v = 0; return has(log, "npcArrest"); });
  check(has(log, "pullOcc", (e) => e.cop), "suspect: the driver is pulled out (one seat, hands up)");
  check(has(log, "knockdown", (e) => e.t === drv), "suspect: he goes down beside the car");
  check(has(log, "npcArrest", (e) => e.ped === drv && e.cop === cop), "suspect: cityNpcArrest with the officer's hands");
  check(car.pullover === 0 && car.npcWanted === 0, "suspect: the car is not a suspect any more");
  W.run(car, 1);
  check(has(log, "door", (e) => e.t < 0.05), "suspect: the door he opened is swung shut after");
}

// ---------------------------------------------------------------- 7. CARJACK
{
  const W = makeWorld();
  const { PO, log } = W;
  const car = makeCar(0, 0);
  const drv = ped(0, 0, { nerve: 0.2 }); car.seatOcc.driver = { kind: "npc", ref: drv };
  const jacker = ped(5, 0, { aggr: 0.9 });
  let got = null;
  const job = PO.start(jacker, car, { take: true, run: true, onDone: (j) => { got = j; } });
  check(!!job && has(log, "board", (e) => !e.pullOnly), "carjack: the jacker's beats go on into the seat (take)");
  let held = false;
  W.run(car, 6, () => { if (car._pullHoldT > 0) held = true; return !!got || !PO.busy(car); });
  check(held, "carjack: a timid driver freezes with his foot on the brake");
  check(has(log, "pullOcc", (e) => !e.cop && e.n === 1) && has(log, "stagger", (e) => e.t === drv), "carjack: the driver is dragged out, stumbling");
  check(!!got && got.victims[0] === drv, "carjack: then the car is his (onDone -> vehicles.js npcTakeCar)");
  check(!jacker._boardOwn, "carjack: the body is handed back to the car's seat");

  const W2 = makeWorld();
  const car2 = makeCar(0, 0);
  const brave = ped(0, 0, { nerve: 0.8 }); car2.seatOcc.driver = { kind: "npc", ref: brave };
  const j2 = ped(5, 0, { aggr: 0.9 });
  let failed = null;
  W2.PO.start(j2, car2, { take: true, onFail: (j, why) => { failed = why; } });
  W2.run(car2, 6, () => !!failed);
  check(failed === "broken" && car2.seatOcc.driver, "carjack: a brave driver floors it and keeps his car");
  check(has(W2.log, "knockdown", (e) => e.t === j2) || W2.log.some((e) => e.ev === "abort"), "carjack: the jacker is left behind (knocked back if he was at the door)");
}

// ---------------------------------------------------------------- 8. YOURS
{
  const W = makeWorld();
  const { PO, P, log, CBZ } = W;
  const car = makeCar(0, 0);
  const drv = ped(0, 0, { nerve: 0.1 }); car.seatOcc.driver = { kind: "npc", ref: drv };
  P.pos.x = 4;
  const job = PO.prepare(P, car, { seat: "driver", take: true });
  check(!!(job && job.hooks.jack && job.hooks.clear && job.hooks.waitMax), "yours: the player's door arc gets the same hooks");
  CBZ.moves.board(P, Object.assign({ _car: car }, job.hooks), {});
  let clearAt = -1;
  W.run(car, 6, () => { if (clearAt < 0 && job.hooks.clear()) clearAt = W.now(); return !PO.busy(car); });
  check(has(log, "jackNow"), "yours: the car answers you through vehicles.js occJack (cityJackNow)");
  check(clearAt > 0 && job.outcome === "done", "yours: the door clears and the arc seats you");
}

// ---------------------------------------------------------------- report
for (const r of rows) if (VERBOSE || !r.ok) console.log((r.ok ? "  ok   " : "  FAIL ") + r.name + (r.detail ? "  (" + r.detail + ")" : ""));
console.log(fails ? "FAIL: " + fails + " of " + rows.length : "PASS: " + rows.length + " checks");
process.exit(fails ? 1 : 0);
