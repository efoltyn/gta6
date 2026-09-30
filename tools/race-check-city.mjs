#!/usr/bin/env node
/* ============================================================
   tools/race-check-city.mjs — THE RACE IN GANG CITY, CHECKED IN PLAIN NODE.

   No browser. Loads the real racing modules, systems/solidground.js (the one
   owner of CBZ.floorAt), city/island_speedway.js and city/speedway_race.js
   against a small stub of the city (onUpdate, landmasses, colliders, the
   vehicle registry, a DOM that only has to exist), then walks and drives:

   THE WALK IN
     - the banking is ground: floorAt on the turns = race_core.surfaceY
     - the drivers' tunnel: the ramp is 1:8, the stairs rise <= the step-up,
       there is >= 2.8 m of headroom under a >= 0.5 m lid, and a body walking
       the corridor from the gate plaza goes down, under the track and up
       into garage bay 7 with no wall in its way and no step it cannot take
     - the corridor's side walls exist, the stadium's outside is shut but for
       the gate, and the way from the bay door through the crew gap in the
       pit wall to car No. 17's grid box is open
   THE RACE
     - ten stock cars are real city vehicles on the grid (city = V - circuit)
     - sitting in No. 17 (the helm, exactly as vehicles.js calls it) lights
       the lamps and starts the race; a driver on the city's own pedals
       finishes it; the purse is paid; the speed the city reads is mph
     - the record's heading and velocity agree (the chase camera is right)
     - getting out mid-race winds the field down; going into the tunnel puts
       it back on the grid; walking far away gives the cars back

       node tools/race-check-city.mjs
============================================================ */
import path from "node:path";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let fails = 0;
const check = (n, ok, got) => { if (!ok) fails++; console.log(`${ok ? "  ok  " : "  FAIL"} ${n}${got != null ? "  (" + got + ")" : ""}`); };

// ---- a DOM that only has to exist ---------------------------------------------------
globalThis.window = globalThis;
const ctx = new Proxy(function () {}, { get(t, p) { return p === "width" ? 10 : function () { return ctx; }; }, set() { return true; } });
function el() {
  const e = {
    style: {}, textContent: "", innerHTML: "", className: "", width: 0, height: 0, clientHeight: 800, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    getContext() { return ctx; }, appendChild(c) { this.children.push(c); return c; }, addEventListener() {},
    querySelector() { return el(); }, querySelectorAll() { return [el(), el(), el(), el(), el()]; }, setAttribute() {},
  };
  return e;
}
globalThis.document = { createElement: el, head: el(), body: el(), getElementById: () => null, addEventListener() {} };
Object.defineProperty(globalThis, "navigator", { value: { maxTouchPoints: 0 }, configurable: true });
let nowMs = 0;
globalThis.performance = { now: () => nowMs };

const THREE = globalThis.THREE = require(path.join(ROOT, "src/vendor/three.r128.min.js"));

// ---- the city, stubbed ---------------------------------------------------------------
const updates = [], landmasses = [], providers = [];
const cityCars = [], colliders = [], notes = [];
let cash = 0;
const CBZ = globalThis.CBZ = {
  CONFIG: {}, game: { mode: "city" }, colliders, cityCars,
  onUpdate(order, fn) { updates.push({ order, fn }); updates.sort((a, b) => a.order - b.order); },
  addLandmass(fn, order) { landmasses.push({ fn, order: order == null ? 50 : order }); },
  registerCityGroundHeight(fn) { providers.push(fn); return {}; },
  registerCityRegion() {}, buildHighway() {}, seedStream() { return null; }, freeCanvasAfterUpload() {},
  markCollidersDirty() {}, sfx() {},
  speedMph: (v) => Math.abs(v || 0) * 2.2369362920544,
  city: { addCash(n) { cash += n; }, note(t) { notes.push(t); } },
  carAudio: { update() {}, start() {}, stop() {} },
  camera: new THREE.PerspectiveCamera(60, 1.6, 0.1, 3000),
  player: { pos: new THREE.Vector3(), driving: false, _vehicle: null, dead: false },
};
CBZ.orientedCollider = function (cx, cz, hw, hd, yaw, y0, y1) {       // systems/physics.js's
  yaw = +yaw || 0;
  const co = Math.cos(yaw), si = Math.sin(yaw), ac = Math.abs(co), as = Math.abs(si);
  const ex = hw * ac + hd * as, ez = hw * as + hd * ac;
  const c = { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez };
  if (as > 1e-4 && ac > 1e-4) { c.cx = cx; c.cz = cz; c.hw = hw; c.hd = hd; c.yaw = yaw; }
  if (y0 != null) { c.y0 = y0; c.y1 = y1; }
  return c;
};
CBZ.cityRegisterVehicle = function (grp, opts) {                        // vehicles.js's record, the fields that matter here
  const c = { group: grp, pos: grp.position, heading: opts.heading || 0, model: opts.model, v: 0, vx: 0, vz: 0, dims: opts.dims, player: false, ai: false, dead: false };
  cityCars.push(c);
  return c;
};
for (const f of ["race_core", "race_track", "race_venue", "race_physics", "race_ai", "race_session", "race_car"]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "src/race", f + ".js"), "utf8"), { filename: f + ".js" });
}
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "src/systems/solidground.js"), "utf8"), { filename: "solidground.js" });
CBZ.registerGroundBase("city", (x, z) => { let b = 0; for (const f of providers) b = Math.max(b, f(x, z)); return b; });
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "src/city/island_speedway.js"), "utf8"), { filename: "island_speedway.js" });
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "src/city/speedway_race.js"), "utf8"), { filename: "speedway_race.js" });

const city = { root: new THREE.Group(), roads: [], annex: null };
for (const l of landmasses.sort((a, b) => a.order - b.order)) l.fn(city);
const SW = CBZ.speedway, TU = SW.tunnel, RC = CBZ.race.core, D = RC.DIMS, P = CBZ.player;
check("the place is published (transforms, spec, tunnel)", !!(SW && TU && SW.spec));
check("the field module is published", !!(CBZ.speedwayRace && CBZ.speedwayRaceAudit));

// ---- helpers: circuit ↔ city, walls ---------------------------------------------------
const C = (x, z) => SW.toCity(x, z);                                   // circuit → city
const tunnelCity = (d, u) => C(TU.x + d, TU.z0 + u);
function colliderHits(x, z, r, y0, y1) {
  let n = 0;
  for (const c of colliders) {
    if (c.y0 != null && (y1 <= c.y0 || y0 >= c.y1)) continue;
    if (c.cx != null) {
      const dx = x - c.cx, dz = z - c.cz, co = Math.cos(c.yaw), si = Math.sin(c.yaw);
      const lx = dx * co - dz * si, lz = dx * si + dz * co;             // into the box's own frame
      if (Math.abs(lx) < c.hw + r && Math.abs(lz) < c.hd + r) n++;
    } else if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) n++;
  }
  return n;
}
function tick(dt) { nowMs += dt * 1000; for (const u of updates) u.fn(dt); }

// ==================================================================== THE WALK IN
console.log("\n-- the banking is ground");
{
  let worst = 0;
  for (const [s, u] of [[D.L * 0.27, 5], [D.L * 0.27, -4], [D.L * 0.5, 0], [D.L * 0.75, 8], [30, 2]]) {
    const w = RC.toWorld(s, u), c = C(w.x, w.z);
    worst = Math.max(worst, Math.abs(CBZ.floorAt(c.x, c.z) - RC.surfaceY(s, u)));
  }
  check("floorAt on the turns and straights = the racing surface", worst < 0.05, worst.toFixed(3) + " m");
  const inf = C(0, 0);
  check("the infield is at grade", Math.abs(CBZ.floorAt(inf.x, inf.z)) < 0.01);
}

console.log("\n-- the drivers' tunnel");
{
  check("the ramp is 1:8", Math.abs(TU.grade - 0.125) < 1e-9);
  check("the stairs rise no more than the step-up (0.45) and stay under 0.2 m", TU.riser <= 0.2, TU.steps + " x " + TU.riser + " m");
  check("3.0 m clear under the lid", TU.lid - TU.floor >= 2.8, (TU.lid - TU.floor).toFixed(2));
  // the lid over the level run: whatever is above it stands >= 0.5 m over the tunnel ceiling
  let thin = Infinity;
  for (let u = TU.uStairBot; u <= TU.uRampEnd; u += 0.5) {
    const p = tunnelCity(0, u);
    thin = Math.min(thin, CBZ.groundBaseAt(p.x, p.z) - TU.lid);
  }
  check("the lid over the tunnel is >= 0.5 m everywhere (track, apron, pit road)", thin >= 0.5, thin.toFixed(2) + " m");
  // the mouth is in the gate's recess, the stairwell is inside garage bay 7
  const GATE = SW.spec.gate;
  check("the mouth is inside the main gate", TU.x - TU.hw > -GATE.hw + 0.3 && TU.x + TU.hw < GATE.hw - 0.3, (TU.x - TU.hw).toFixed(1) + ".." + (TU.x + TU.hw).toFixed(1) + " of +-" + GATE.hw);
  const bayLo = RC.toWorld(TU.bayS0, (TU.garage.uF + TU.garage.uB) / 2), bayHi = RC.toWorld(TU.bayS1, (TU.garage.uF + TU.garage.uB) / 2);
  check("the stairwell stands inside garage bay 7", TU.x - TU.hw > bayLo.x + 0.3 && TU.x + TU.hw < bayHi.x - 0.3, "x " + bayLo.x.toFixed(1) + ".." + bayHi.x.toFixed(1));
  check("the stairwell is inside the building (behind its front, before its back)", TU.uStairBot < TU.garage.uF && TU.uStairTop > TU.garage.uB, TU.uStairBot.toFixed(1) + " / " + TU.uStairTop.toFixed(1));

  // walk it: the plaza → the recess → down → under → up into the bay
  let y = 0, maxUp = 0, maxDown = 0, blocked = 0, lowHead = Infinity, yMin = 0, walked = 0;
  const uStart = SW.spec.outerU(0) + 4, uEnd = TU.garage.uB + 1.2;
  for (let u = uStart; u >= uEnd; u -= 0.1) {
    const p = tunnelCity(0, u);
    const f = CBZ.floorAt(p.x, p.z, y);
    const dy = f - y;
    if (dy > maxUp) maxUp = dy;
    if (-dy > maxDown) maxDown = -dy;
    y = f; yMin = Math.min(yMin, y);
    const head = CBZ.ceilAt(p.x, p.z, y) - y;
    if (u < TU.uRampEnd && u > TU.uStairBot) lowHead = Math.min(lowHead, head);
    if (colliderHits(p.x, p.z, 0.35, y + 0.1, y + 1.7)) blocked++;
    walked++;
  }
  check("walking the corridor: every step up is one a body takes (<= 0.45 m)", maxUp <= 0.45, maxUp.toFixed(3) + " m");
  check("walking the corridor: no drop you would fall down (<= 0.45 m)", maxDown <= 0.45, maxDown.toFixed(3) + " m");
  check("the walk goes down to the tunnel floor", Math.abs(yMin - TU.floor) < 0.05, yMin.toFixed(2));
  check("and comes up to the garage floor", Math.abs(y) < 0.05, y.toFixed(2));
  check("headroom under the track >= 2.8 m", lowHead >= 2.8, lowHead.toFixed(2) + " m");
  check("nothing in the way from the plaza to the bay", blocked === 0, blocked + " of " + walked + " steps blocked");
  // and it is a corridor: walls either side at every depth
  let open = 0;
  for (let u = TU.uMouth - 1; u > TU.uStairTop + 0.5; u -= 2) {
    for (const d of [-TU.hw - 0.3, TU.hw + 0.3]) {
      const p = tunnelCity(d, u), yy = TU.floorAt(u);
      if (!colliderHits(p.x, p.z, 0.2, yy + 0.2, yy + 1.5)) open++;
    }
  }
  check("the corridor has a wall either side all the way", open === 0, open + " open side samples");
}

console.log("\n-- the stadium is shut but for the gate");
{
  // walk round the outside of the stands 4 m out: every point but the gate plaza is up against a wall
  let gaps = 0;
  for (let s = 12; s < D.L - 12; s += 3) {
    const u = SW.spec.outerU(s) - 1.2, w = RC.toWorld(s, u), c = C(w.x, w.z);
    if (!colliderHits(c.x, c.z, 0.35, 0.1, 1.7)) { gaps++; if (process.env.DBG) console.log("gap at s", s.toFixed(1), "x", w.x.toFixed(1), "z", w.z.toFixed(1)); }
  }
  check("the outside of the stands is solid all the way round", gaps === 0, gaps + " gaps");
  const g = SW.spec.outerU(0) - 1.2, c = tunnelCity(0, g);
  check("the gate is open where the tunnel lane runs", !colliderHits(c.x, c.z, 0.35, 0.1, 1.7));
  // the SAFER wall from the track side
  let safer = 0;
  for (let s = 0; s < D.L; s += 5) { const w = RC.toWorld(s, D.WALL_U + 0.2), c2 = C(w.x, w.z); if (colliderHits(c2.x, c2.z, 0.3, RC.surfaceY(s, D.WALL_U) + 0.1, RC.surfaceY(s, D.WALL_U) + 1.7)) safer++; }
  check("you cannot walk up the banking into the stands", safer === Math.ceil(D.L / 5), safer + "/" + Math.ceil(D.L / 5));
}

console.log("\n-- from the bay door to car No. 17");
{
  const PIT = RC.PIT, pts = [];
  // out of the door onto pit road, through the crew gap, over the apron to the grid box
  const sl = RC.GRID.slot(5);
  const path_ = [[TU.bayS + 1.5, TU.garage.uF - 3], [TU.bayS + 0.5, TU.garage.uF + 1.5], [TU.bayS, PIT.wallU - 1.5], [TU.bayS, PIT.wallU + 1.5], [TU.bayS - 4, D.INNER + 1], [sl.s + 4, sl.u - 2.3]];
  for (let i = 0; i < path_.length - 1; i++) {
    const [s0, u0] = path_[i], [s1, u1] = path_[i + 1];
    for (let k = 0; k <= 20; k++) pts.push([s0 + (s1 - s0) * k / 20, u0 + (u1 - u0) * k / 20]);
  }
  let hit = 0, first = null;
  for (const [s, u] of pts) {
    const w = RC.toWorld(s, u), c = C(w.x, w.z), y = CBZ.floorAt(c.x, c.z);
    if (colliderHits(c.x, c.z, 0.3, y + 0.1, y + 1.7)) { hit++; if (!first) first = s.toFixed(1) + "/" + u.toFixed(1); }
  }
  check("the bay door, pit road, the crew gap and the apron are open to walk", hit === 0, hit ? hit + " blocked, first at s/u " + first : "clear");
  const w0 = RC.toWorld(TU.bayS + 5, PIT.wallU), c0 = C(w0.x, w0.z);
  check("the pit wall is a wall beside the gap", colliderHits(c0.x, c0.z, 0.3, 0.1, 1.0) > 0);
}

// ==================================================================== THE RACE
console.log("\n-- the field");
const gate = CBZ.speedwayGate();
P.pos.set(gate.x, 0, gate.z);
for (let i = 0; i < 3; i++) tick(1 / 60);                               // the stadium is built at 1300 m
check("the stadium builds when you come near", SW.ready());
for (let i = 0; i < 3; i++) tick(1 / 60);
const A0 = CBZ.speedwayRaceAudit();
check("ten stock cars stand on the grid", A0.built && A0.cars.length === 10 && A0.onGrid, A0.cars.length + " cars, onGrid " + A0.onGrid);
const recs = cityCars.filter((c) => c._raceCar);
check("each is a real city vehicle (enterable, owned, with the race's helm)", recs.length === 10 && recs.every((r) => r.owned && typeof r._raceHelm === "function" && r.group.userData.cabinInfo));
let gridErr = 0;
for (const r of recs) {
  const e = r._raceEntry, sl = RC.GRID.slot(e.i), f = RC.frame(sl.s), c = C(f.x + f.nx * sl.u, f.z + f.nz * sl.u);
  gridErr = Math.max(gridErr, Math.hypot(r.pos.x - c.x, r.pos.z - c.z));
}
check("the cars stand in their grid boxes in the city (city = V - circuit)", gridErr < 0.05, gridErr.toFixed(3) + " m");
const car17 = recs.find((r) => r._raceEntry.number === 17);
check("No. 17 is the home car in the third row", !!car17 && car17._raceEntry.i === 5);
const one = car17.group.userData.cabinInfo.seatLayout;
check("one seat, one door: the window on the driver's left", one.seats.length === 1 && one.doors.length === 1 && one.doors[0].side === 1);

console.log("\n-- a race, on the city's own pedals");
{
  // sit down exactly as vehicles.js does: P.driving + P._vehicle, then the helm every frame
  P.driving = true; P._vehicle = car17; car17.player = true;
  const S = CBZ.speedwayRace.F.ses;
  // the "thumb": a race_ai driver on the same car, its outputs mapped to the
  // city's pedal (+1 gas / -1 brake) and wheel (+1 left), as the keys would be
  let thumb = null;
  let phases = new Set(), maxMph = 0, headingErr = 0, nan = false, frames = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 240 && S.phase !== "done"; i++) {
    const e = car17._raceEntry;
    let throttle = 0, steer = 0;
    if (S.phase === "race") {
      if (!thumb || thumb._car !== e.car) { thumb = CBZ.race.ai.create(e.car, { skill: 0.95, aggression: 0.3, seed: 77 }); thumb._car = e.car; }
      const cars = S.entries.map((x) => x.car);
      const inp = thumb.drive(e.car, cars, dt);
      throttle = (inp.throttle || 0) - (inp.brake || 0);
      steer = Math.max(-1, Math.min(1, (inp.steer || 0) * 1.4));
    }
    const rs = car17._raceHelm(car17, throttle, steer, false, dt);        // vehicles.js's seam
    P.pos.set(car17.pos.x, car17.pos.y, car17.pos.z);
    tick(dt);
    phases.add(S.phase);
    frames++;
    if (!rs || !isFinite(car17.pos.x + car17.pos.z + car17.heading)) nan = true;
    const mph = CBZ.speedMph(car17.v);
    maxMph = Math.max(maxMph, mph);
    if (Math.abs(car17.v) > 15) {
      const fx = Math.sin(car17.heading), fz = Math.cos(car17.heading), vm_ = Math.hypot(car17.vx, car17.vz);
      headingErr = Math.max(headingErr, 1 - (fx * car17.vx + fz * car17.vz) / vm_);
    }
  }
  check("sitting in No. 17 on the grid lit the lights, and they went green", phases.has("grid") && phases.has("race"), [...phases].join(" > "));
  check("the race reached the flag", S.phase === "done", S.phase + " after " + (frames / 60).toFixed(0) + " s");
  check("no NaN in the car the city drives", !nan);
  check("No. 17 finished", !!S.me && S.me.finishT > 0, "P" + (S.me && S.me.place));
  check("the purse was paid", cash > 0, "$" + cash);
  check("the city's speed read is mph and a stock car's speed (90-140 mph flat out here)", maxMph > 90 && maxMph < 140, maxMph.toFixed(0) + " mph");
  check("the city record faces where it goes (the chase camera is right)", headingErr < 0.15, headingErr.toFixed(3));
  let maxU = -1e9;
  for (const e of S.entries) maxU = Math.max(maxU, e.car.u);
  check("nobody through the SAFER wall", maxU < D.WALL_U + 0.5, maxU.toFixed(2));
  const fin = S.entries.filter((e) => e.finishT).length;
  check("the field took the flag", fin >= 7, fin + "/10");
  const A = CBZ.speedwayRaceAudit();
  check("the audit reads the race", A.me === 17 && A.phase === "done");
}

console.log("\n-- getting out, the tunnel, going home");
{
  const S = CBZ.speedwayRace.F.ses;
  P.driving = false; P._vehicle = null; car17.player = false;
  P.pos.set(car17.pos.x + 2, car17.pos.y, car17.pos.z);
  tick(1 / 60);
  check("the seat is empty in the race (the car you left has no driver)", !S.me && !car17._raceEntry.driver);
  for (let i = 0; i < 60 * 40; i++) tick(1 / 60);
  if (process.env.DBG) console.log(S.entries.map((e) => e.number + ":" + e.car.speed.toFixed(2) + (e.driver ? "D" : "")).join(" "));
  check("the field winds down and parks", S.phase === "idle" && !CBZ.speedwayRace.F.live, S.phase + " live " + CBZ.speedwayRace.F.live);
  check("nothing re-laid while you can see the track", !CBZ.speedwayRace.F.onGrid);
  const t = tunnelCity(0, 0);
  P.pos.set(t.x, TU.floor, t.z);
  tick(1 / 60);
  check("in the tunnel the field is back on the grid", CBZ.speedwayRace.F.onGrid && S.phase === "idle");
  let err = 0;
  for (const r of recs) { const e = r._raceEntry, sl = RC.GRID.slot(e.i), f = RC.frame(sl.s), c = C(f.x + f.nx * sl.u, f.z + f.nz * sl.u); err = Math.max(err, Math.hypot(r.pos.x - c.x, r.pos.z - c.z)); }
  check("every car in its box again", err < 0.05, err.toFixed(3) + " m");
  // a second race starts the same way
  P.driving = true; P._vehicle = car17; car17.player = true;
  car17._raceHelm(car17, 0, 0, false, 1 / 60);
  check("sitting down again lights the lights again", S.phase === "grid");
  // get out on the grid: the lights stop, the field stays in its boxes
  P.driving = false; P._vehicle = null; car17.player = false;
  tick(1 / 60);
  check("getting out on the grid puts it back as it was", S.phase === "idle" && CBZ.speedwayRace.F.onGrid);
  // any car: No. 3 on the pole
  const car3 = recs.find((r) => r._raceEntry.number === 3);
  P.driving = true; P._vehicle = car3; car3.player = true;
  car3._raceHelm(car3, 0, 0, false, 1 / 60);
  check("any of the ten is yours to race (No. 3 from the pole)", S.phase === "grid" && S.me === car3._raceEntry);
  P.driving = false; P._vehicle = null; car3.player = false; tick(1 / 60);
  // walk far away: the cars are given back
  P.pos.set(SW.VX + 3000, 0, SW.VZ);
  tick(1 / 60);
  check("far away the field is given back (no records left)", !CBZ.speedwayRace.F.built && cityCars.filter((c) => c._raceCar).length === 0);
}

console.log(fails ? `\n${fails} FAILED` : "\nall in-city race checks pass");
process.exit(fails ? 1 : 0);
