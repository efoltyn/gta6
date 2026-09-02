#!/usr/bin/env node
/* The roll model, on its own, with no browser and no world.

   world/water_stability.js is a single-degree-of-freedom roll ODE plus a
   righting-arm curve, and both are pure arithmetic: they need a `rec` with a
   .group, a .pos and a ._hullSpec and nothing else. So the six statements
   that actually matter can be asserted in node, in milliseconds, against the
   real file — not a copy of its maths:

     a) a bull shark's ram rolls a KAYAK over inside 1.5 s
     b) THE SAME MOMENT barely moves a 16 t CRUISER (< 8 deg) and rings down
     c) a 30 t megalodon on the cruiser's own beam arm takes it past phiV
     d) a 0.5 s frame does not NaN the state (the substep guard)
     e) an inverted hull with no input STAYS inverted for 20 s
     f) green water reaches `flooded` at exactly swampT

   Run: node tools/test-water-stability.mjs */

import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import * as THREE from "three";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// The page this file expects: window.CBZ, window.THREE, and nothing else it
// cannot feature-detect its way around. No onUpdate, so the 38.4 pass never
// registers and every tick below is an explicit call — which is the point.
const sandbox = { window: {}, Math, Date, console };
sandbox.window.window = sandbox.window;
sandbox.window.THREE = THREE;
sandbox.window.CBZ = { SEA_Y: -0.48 };
vm.createContext(sandbox);
vm.runInContext(
  await readFile(path.join(ROOT, "src/world/water_stability.js"), "utf8"),
  sandbox, { filename: "water_stability.js" });
const CBZ = sandbox.window.CBZ;

const fail = [];
const ok = (cond, msg) => { if (!cond) fail.push(msg); return cond; };
const deg = (r) => (r * 180 / Math.PI);

// A record is a .group, a .pos, a .heading and a ._hullSpec. That is the
// whole contract, and it is what both a cityCars boat and a sea_craft record
// already are.
function hull(key, spec, stab) {
  const group = new THREE.Object3D();
  group.userData.hullKey = key;
  const rec = {
    group, pos: { x: 0, y: 0, z: 0 }, heading: 0, v: 0, vx: 0, vz: 0,
    _hullSpec: Object.assign({ key, rideAbove: 0.06 }, spec, stab ? { stab } : {}),
  };
  group.position.set(0, -0.12, 0);
  return rec;
}
// Heading 0 => hull local +X is world +X and is the PORT side, so a push
// point at +x heels her to starboard (+phi). Every impulse below is aimed
// from port, which is what "a shark hit her port beam" means.
const fromPort = (rec, beam, from) => ({ x: rec.pos.x + beam * 0.5, z: rec.pos.z, from });

// The three hulls the wave's own numbers describe.
const KAYAK = { loa: 4.2, beam: 0.72, draft: 0.16, massT: 0.03 };
const KAYAK_STAB = { gm: 0.05, phiV: 0.70, freeboard: 0.18, swampT: 2, selfRight: 0 };
const CRUISER = { loa: 14, beam: 4.2, draft: 1.1, massT: 16 };
const CRUISER_STAB = { gm: 1.40, phiV: 1.45, freeboard: 1.05, swampT: 60, selfRight: 0 };
const BOAT = { loa: 6.2, beam: 2.1, draft: 0.5, massT: 1.6 };
const BOAT_STAB = { gm: 0.90, phiV: 1.25, freeboard: 0.62, swampT: 14, selfRight: 0 };

// The heeling moment an animal makes: tonnes * closing speed * lever arm,
// kN*m. This is the formula the contract hands marine_predation.js, written
// here ONCE so every row below is the same arithmetic the game will do.
const ram = (tonnes, speedMs, armM) => tonnes * speedMs * armM;
const MEG_T_TEST = 30;

// Roll the hull forward in 1/60 s frames, reporting the peak.
function run(rec, seconds, step) {
  const h = step || 1 / 60;
  let peak = 0, tOver = null, t = 0;
  const phiV = CBZ.hullStab(rec).g.phiV;
  for (let i = 0; i < Math.round(seconds / h); i++) {
    CBZ.hullStabTick(rec, h);
    t += h;
    const a = Math.abs(CBZ.hullStabRoll(rec));
    if (a > peak) peak = a;
    if (tOver == null && a > phiV) tOver = t;
  }
  return { peak, tOver, t };
}

const rows = [];

// ---- (a) a kayak goes over -------------------------------------------------
{
  const k = hull("kayak", KAYAK, KAYAK_STAB);
  const M = ram(1.5, 8, 0.36);                       // bull/white shark, kayak arm
  CBZ.hullHeelImpulse(k, M, fromPort(k, KAYAK.beam, "ram"));
  const r = run(k, 3.0);
  rows.push({ case: "a  kayak + 1.5 t @ 8 m/s", momentKNm: +M.toFixed(2),
    peakDeg: +deg(r.peak).toFixed(1), capsizeAtS: r.tOver == null ? null : +r.tOver.toFixed(2),
    capsized: CBZ.hullCapsized(k) });
  ok(CBZ.hullCapsized(k), "(a) kayak did not capsize");
  ok(r.tOver != null && r.tOver <= 1.5, `(a) kayak took ${r.tOver}s to go over (want <= 1.5)`);
}

// ---- (b) the same moment on the cruiser ------------------------------------
{
  const c = hull("cruiser", CRUISER, CRUISER_STAB);
  const M = ram(1.5, 8, 0.36);
  CBZ.hullHeelImpulse(c, M, fromPort(c, CRUISER.beam, "ram"));
  const r = run(c, 20);
  const st = CBZ.hullStab(c);
  const settled = Math.abs(st.phi);
  rows.push({ case: "b  cruiser + the same moment", momentKNm: +M.toFixed(2),
    peakDeg: +deg(r.peak).toFixed(2), settledDeg20s: +deg(settled).toFixed(3),
    capsized: CBZ.hullCapsized(c) });
  ok(deg(r.peak) < 8, `(b) cruiser peaked at ${deg(r.peak).toFixed(2)} deg (want < 8)`);
  ok(settled < r.peak * 0.1, "(b) cruiser did not ring down inside 20 s");
  ok(!CBZ.hullCapsized(c), "(b) cruiser capsized on a kayak-sized hit");
}

// ---- (b2) the contrast frame: a great white ON THE CRUISER'S OWN BEAM ------
{
  const c = hull("cruiser", CRUISER, CRUISER_STAB);
  const M = ram(1.5, 8, CRUISER.beam * 0.5);
  CBZ.hullHeelImpulse(c, M, fromPort(c, CRUISER.beam, "ram"));
  const r = run(c, 12);
  rows.push({ case: "b2 cruiser + 1.5 t on its own beam arm", momentKNm: +M.toFixed(2),
    peakDeg: +deg(r.peak).toFixed(2), capsized: CBZ.hullCapsized(c) });
  ok(!CBZ.hullCapsized(c), "(b2) a great white rolled a 16 t cruiser");
}

// ---- (b3) the speedboat: heeled hard, rail under, NOT over -----------------
{
  const b = hull("boat", BOAT, BOAT_STAB);
  const M = ram(1.5, 8, BOAT.beam * 0.5);
  CBZ.hullHeelImpulse(b, M, fromPort(b, BOAT.beam, "ram"));
  const r = run(b, 4);
  const gunwale = Math.atan2(BOAT_STAB.freeboard, BOAT.beam * 0.5);
  rows.push({ case: "b3 speedboat + 1.5 t great white", momentKNm: +M.toFixed(2),
    peakDeg: +deg(r.peak).toFixed(1), railUnderDeg: +deg(gunwale).toFixed(1),
    swamp: +CBZ.hullStab(b).swamp.toFixed(3), capsized: CBZ.hullCapsized(b) });
  ok(r.peak > gunwale, "(b3) a great white did not even put the speedboat's rail under");
  ok(!CBZ.hullCapsized(b), "(b3) one great-white hit rolled a speedboat (want 2-3)");
}

// ---- (b4) ...and a second ram ON THE ROLL takes her over ------------------
// A boat is not rolled over by ONE big push, it is rolled over by pushes that
// arrive IN PHASE — the same reason a beam sea capsizes a boat at its own
// roll period and not at any other. So the second ram is applied when the
// hull next comes back through upright still rolling to starboard, which is
// read off the state rather than from a stopwatch.
{
  const b = hull("boat", BOAT, BOAT_STAB);
  const M = ram(1.5, 8, BOAT.beam * 0.5);
  const st = CBZ.hullStab(b);
  const ladder = [];
  let hits = 0, t = 0, prevPhi = 0;
  CBZ.hullHeelImpulse(b, M, fromPort(b, BOAT.beam, "ram")); hits++;
  let peak = 0;
  for (let i = 0; i < 60 * 12 && !CBZ.hullCapsized(b); i++) {
    prevPhi = st.phi;
    CBZ.hullStabTick(b, 1 / 60);
    t += 1 / 60;
    if (Math.abs(st.phi) > peak) peak = Math.abs(st.phi);
    // back through upright, rolling the way the shark is pushing
    if (hits < 4 && prevPhi < 0 && st.phi >= 0 && st.phiDot > 0) {
      ladder.push(+deg(peak).toFixed(1));
      CBZ.hullHeelImpulse(b, M, fromPort(b, BOAT.beam, "ram"));
      hits++;
    }
  }
  ladder.push(+deg(peak).toFixed(1));
  rows.push({ case: "b4 speedboat, rams IN PHASE (the beam-sea mechanism)",
    peakBeforeEachHitDeg: ladder, hits: hits,
    capsizedAtS: CBZ.hullCapsized(b) ? +t.toFixed(2) : null,
    capsized: CBZ.hullCapsized(b) });
  ok(CBZ.hullCapsized(b), "(b4) in-phase great-white rams never rolled a speedboat");
  ok(hits >= 2 && hits <= 3, `(b4) took ${hits} great-white rams (want 2-3)`);
}

// ---- (c) a megalodon rolls the cruiser -------------------------------------
{
  const c = hull("cruiser", CRUISER, CRUISER_STAB);
  const M = ram(30, 10, CRUISER.beam * 0.5);
  CBZ.hullHeelImpulse(c, M, fromPort(c, CRUISER.beam, "under"));
  const lift = CBZ.hullStabLift(c);
  const r = run(c, 6);
  rows.push({ case: "c  cruiser + 30 t megalodon (under)", momentKNm: +M.toFixed(1),
    peakDeg: +deg(r.peak).toFixed(1), capsizeAtS: r.tOver == null ? null : +r.tOver.toFixed(2),
    liftM: +lift.toFixed(2), capsized: CBZ.hullCapsized(c),
    dropM: +CBZ.hullStabDrop(c).toFixed(2) });
  ok(r.peak > CRUISER_STAB.phiV, `(c) megalodon only reached ${deg(r.peak).toFixed(1)} deg`);
  ok(CBZ.hullCapsized(c), "(c) the cruiser did not go over");
  ok(lift > 0.1, `(c) an "under" impulse produced ${lift.toFixed(3)} m of lift`);
}

// ---- (d) a 0.5 s frame must not tunnel or NaN ------------------------------
{
  const k = hull("kayak", KAYAK, KAYAK_STAB);
  CBZ.hullHeelImpulse(k, ram(30, 10, 0.36), fromPort(k, KAYAK.beam, "ram"));
  for (let i = 0; i < 40; i++) CBZ.hullStabTick(k, 0.5);
  const st = CBZ.hullStab(k);
  rows.push({ case: "d  kayak + megalodon @ dt = 0.5 s",
    phiDeg: +deg(st.phi).toFixed(1), phiDot: +st.phiDot.toFixed(4),
    finite: Number.isFinite(st.phi) && Number.isFinite(st.phiDot) });
  ok(Number.isFinite(st.phi) && Number.isFinite(st.phiDot), "(d) phi/phiDot went non-finite");
  ok(Math.abs(deg(st.phi)) > 150, `(d) settled at ${deg(st.phi).toFixed(1)} deg, want ~180 (inverted)`);
}

// ---- (e) inverted stays inverted -------------------------------------------
{
  const b = hull("boat", BOAT, BOAT_STAB);
  CBZ.hullCapsize(b, { from: "test" });
  const r = run(b, 20);
  const st = CBZ.hullStab(b);
  rows.push({ case: "e  speedboat inverted, 20 s, no input",
    phiDeg: +deg(st.phi).toFixed(1), stillCapsized: st.capsized,
    swamp: +st.swamp.toFixed(3), flooded: st.flooded });
  ok(st.capsized, "(e) an inverted hull righted itself with no input");
  ok(Math.abs(deg(st.phi)) > 150, `(e) inverted hull drifted to ${deg(st.phi).toFixed(1)} deg`);
}

// ---- (e1) ...and she SETTLES there, fast: a turtled hull does not wallow ---
{
  const b = hull("boat", BOAT, BOAT_STAB);
  CBZ.hullHeelImpulse(b, ram(MEG_T_TEST, 10, BOAT.beam * 0.5), fromPort(b, BOAT.beam, "ram"));
  const marks = {};
  for (const at of [1, 2, 3]) {
    run(b, at - (marks._t || 0)); marks._t = at;
    marks["t" + at + "sDeg"] = +Math.abs(deg(CBZ.hullStab(b).phi)).toFixed(1);
  }
  delete marks._t;
  rows.push(Object.assign({ case: "e1 speedboat settling at the inverted point" }, marks));
  ok(marks.t3sDeg > 168, `(e1) three seconds after going over she is at ${marks.t3sDeg} deg, not ~180`);
}

// ---- (e2) but a PWC comes back ---------------------------------------------
{
  const j = hull("jetski", { loa: 3.3, beam: 1.2, draft: 0.25, massT: 0.4 },
    { gm: 0.25, phiV: 1.0, freeboard: 0.28, swampT: 4, selfRight: 5 });
  CBZ.hullCapsize(j, { from: "test" });
  const r = run(j, 20);
  const st = CBZ.hullStab(j);
  rows.push({ case: "e2 jetski (selfRight 5 s), 20 s",
    phiDeg: +deg(st.phi).toFixed(1), stillCapsized: st.capsized });
  ok(!st.capsized, "(e2) a self-righting PWC stayed turtled");
}

// ---- (f) swamping reaches flooded at swampT --------------------------------
{
  const d = hull("dinghy", { loa: 4.5, beam: 2.0, draft: 0.4, massT: 0.7 },
    { gm: 0.60, phiV: 1.15, freeboard: 0.50, swampT: 20, selfRight: 0 });
  const half = CBZ.hullSwampAdd(d, 10);
  const beforeFlood = CBZ.hullStab(d).flooded;
  const full = CBZ.hullSwampAdd(d, 10);
  const st = CBZ.hullStab(d);
  rows.push({ case: "f  RIB, 20 s of green water (swampT 20)",
    swampAt10s: +half.toFixed(3), swampAt20s: +full.toFixed(3),
    floodedAt10s: beforeFlood, flooded: st.flooded,
    dead: !!d.dead, dropM: +CBZ.hullStabDrop(d).toFixed(2) });
  ok(Math.abs(half - 0.5) < 1e-9, `(f) half a swampT gave swamp ${half}`);
  ok(!beforeFlood, "(f) flooded early");
  ok(st.flooded, "(f) did not flood at swampT");
  ok(d.dead === true && d.abandoned === true,
    "(f) a flooded cityCar was not handed to water_float (dead+abandoned)");
}

// ---- the audit, which is what the preset reads -----------------------------
const audit = CBZ.hullStabAudit();

console.log(JSON.stringify({ rows, audit, failures: fail }, null, 2));
if (fail.length) { console.error(`\n${fail.length} FAILURE(S)`); process.exitCode = 1; }
else console.error("\nwater_stability: all checks pass");
