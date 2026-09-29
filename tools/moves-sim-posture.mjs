#!/usr/bin/env node
/* tools/moves-sim-posture.mjs — plain-node sims for CBZ.moves POSTURE
   (src/entities/moves_posture.js, over src/entities/moves.js and
   src/city/propuse.js). No browser, no THREE: the actor is a stub
   {group:{position,rotation,userData}, char:{profile, hipY, metric}} with the
   shipped rig's numbers (humanScale 0.70, legUp 0.48, legLo 0.47, hipY 0.95,
   height 2.60 x 0.70), and the bunk is the cell wing's (bunkRig: LAT 1.12,
   mattress 0.96 x 2.35, lower top 0.62, deck underside 1.94, upper top 2.28,
   ladder at the foot end).

   What each scenario asserts is what the owner sees as "glitchy":
     · no frame where the root jumps more than 0.1 m (a teleport)
     · yaw rate <= 6 rad/s (a snap)
     · SIT: hip height monotonic from standing to the cushion, ending ON it
       (no dip, no hover), soles planted while the hips go down, never under
       the floor
     · LIE: hips and head never below the mattress top once on it, the head
       at the pillow end, the whole body inside the mattress rectangle
     · GET UP: ends clear of the frame collider, walked there
     · TOP BUNK: climbed (rung by rung, no lift), lies on the upper mattress,
       climbs down and steps back clear
   Run: node tools/moves-sim-posture.mjs    (exit 1 on any failure) */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { window: { CBZ: {} }, Math, console, Set, Map, Object, Array, JSON };
ctx.globalThis = ctx;
vm.createContext(ctx);
const CBZ = ctx.window.CBZ;
CBZ.CONFIG = {};
CBZ.game = { mode: "escape", state: "playing" };
CBZ.hash01 = (x, z, s) => { const v = Math.sin(x * 12.9898 + z * 78.233 + s * 0.123) * 43758.5453; return v - Math.floor(v); };
CBZ.charSeatPosture = (k) => ({ bunk: "bunk", "bunk-back": "bunkback", "bunk-brace": "bunkbrace", stool: "stool" }[k] || null);
CBZ.charLieRoll = { back: 1.2, side: 0.2 };
CBZ.animChar = (ch, spd, dt) => { ch.phase = (ch.phase || 0) + (spd || 0) * dt; };
for (const f of ["src/entities/moves.js", "src/city/propuse.js", "src/entities/moves_posture.js"])
  vm.runInContext(readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const M = CBZ.moves;

let fails = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) fails++;
}
const DT = 1 / 60, wrap = M.wrap;

function actor(x, z, yaw, y) {
  const g = { position: { x, y: y || 0, z }, rotation: { x: 0, y: yaw || 0, z: 0 }, userData: { humanScale: 0.70 } };
  const ch = {
    group: g, hipY: 0.95, phase: 0, metric: { height: 2.60 * 0.70 },
    profile: { legUp: 0.48, legLo: 0.47, torsoW: 0.90, torsoD: 0.50, armUp: 0.46 },
  };
  return { char: ch, group: g, target: { x, y: 0, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; } } };
}
// the rig's shared numbers for the stub (what the sequencer tracks)
const probe = actor(0, 0, 0);
const HIP_STAND = 0.95 * 0.70, HEIGHT = 2.60 * 0.70;
function headOf(a) {
  const g = a.group, y = g.rotation.y, r = g.rotation.z, h = HEIGHT;
  return { x: g.position.x - h * Math.sin(r) * Math.cos(y), y: g.position.y + h * Math.cos(r), z: g.position.z + h * Math.sin(r) * Math.sin(y) };
}

// Run the sim until `until()` or `secs`; record every frame's transform.
function run(a, secs, until, onFrame) {
  const g = a.group;
  let px = g.position.x, py = g.position.y, pz = g.position.z, pyaw = g.rotation.y;
  const st = { maxJump: 0, maxYawRate: 0, frames: 0, maxRollRate: 0 };
  let proll = g.rotation.z;
  for (let i = 0; i < secs * 60; i++) {
    M.postureTick(DT);
    const jump = Math.hypot(g.position.x - px, g.position.y - py, g.position.z - pz);
    st.maxJump = Math.max(st.maxJump, jump);
    st.maxYawRate = Math.max(st.maxYawRate, Math.abs(wrap(g.rotation.y - pyaw)) / DT);
    st.maxRollRate = Math.max(st.maxRollRate, Math.abs(g.rotation.z - proll) / DT);
    px = g.position.x; py = g.position.y; pz = g.position.z; pyaw = g.rotation.y; proll = g.rotation.z;
    st.frames++;
    if (onFrame) onFrame(i);
    if (until && until()) break;
  }
  return st;
}
const f3 = (v) => v.toFixed(3);

// ---- THE CELL: bunk centred at (0,0), laid along z, pillow at -z, room at +x ----
const BUNK = { x: 0, z: 0, latOut: 0.56, lonOut: 1.30, top: 0.62, deckY: 1.94, topBunk: 2.28, mattLat: 0.96, mattLon: 2.35 };
const BODY_R = 0.5;
const ENTRY = { x: BUNK.x + BUNK.latOut + BODY_R + 0.08, z: 0 };
function edgeSeat() {
  return {
    x: BUNK.x + (BUNK.latOut - 0.01), y: 0, z: 0, face: Math.atan2(1, 0),
    cushionH: BUNK.top, floorBelow: 0, kind: "bunk", ceiling: BUNK.deckY,
    entry: ENTRY, exit: ENTRY,
  };
}
function clearOfFrame(p) {
  // distance from the body centre to the frame's footprint rectangle
  const dx = Math.max(0, Math.abs(p.x - BUNK.x) - BUNK.latOut), dz = Math.max(0, Math.abs(p.z - BUNK.z) - BUNK.lonOut);
  return Math.hypot(dx, dz);
}

// ---------------------------------------------------------------------------
// 1. SIT on the bottom bunk from across the cell, then GET UP and step out
{
  const a = actor(2.4, 1.6, Math.PI);
  const seat = edgeSeat();
  const ok = M.sit(a, seat);
  check("sit: sequence starts", ok && M.busy(a), `posture ${M.posture(a)}`);
  const legs = M.seatLegs(a.char, { cushion: seat.cushionH, floorBelow: 0, kind: "bunk" }, "bunk", {});
  const hips = [], feet = [];
  let lowering = false;
  const st = run(a, 12, () => M.posture(a) === "sit", () => {
    const R = a._pz, Q = R.seq;
    const nm = Q ? Q.names[Q.i] : "held";
    if (nm === "lower" || (lowering && nm !== "lower")) {
      if (nm === "lower") lowering = true;
      const b = R.b == null ? 1 : R.b;
      hips.push(R.hip.y);
      // soles: hip minus the leg drop at this fold, and where they are horizontally
      // relative to where the STANDING rig's soles are (its shin carries a shoe cap)
      const fy = (R.hip.y - M.footDrop(legs, b)) - (HIP_STAND - M.footDrop(legs, 0));
      const fx = a.group.position.x + Math.sin(seat.face) * M.footFwd(legs, b);
      feet.push({ y: fy, x: fx, b });
    }
  });
  check("sit: seated", M.posture(a) === "sit" && a.char.sitting, `after ${(st.frames * DT).toFixed(2)} s`);
  check("sit: no root jump > 0.1 m", st.maxJump <= 0.1, `max ${f3(st.maxJump)} m/frame`);
  check("sit: yaw rate <= 6 rad/s", st.maxYawRate <= 6, `max ${st.maxYawRate.toFixed(2)} rad/s`);
  let mono = true;
  const dir = Math.sign(legs.hipF - HIP_STAND);
  for (let i = 1; i < hips.length; i++) if ((hips[i] - hips[i - 1]) * dir < -1e-6) mono = false;
  const endHip = hips[hips.length - 1];
  check("sit: hip height monotonic toward the cushion", mono && hips.length > 20, `${f3(hips[0])} -> ${f3(endHip)} over ${hips.length} frames`);
  check("sit: hips land ON the cushion (no hover, no dip)", Math.abs(endHip - legs.hipF) < 1e-3 && legs.hipF - BUNK.top >= 0 && legs.hipF - BUNK.top <= 0.12,
    `hip ${f3(endHip)} vs cushion top ${BUNK.top} (+${f3(legs.hipF - BUNK.top)})`);
  check("sit: hips never below the cushion top", Math.min(...hips) >= BUNK.top - 1e-6, `min ${f3(Math.min(...hips))}`);
  const minFoot = Math.min(...feet.map((f) => f.y));
  check("sit: soles never under the floor", minFoot >= -0.01, `min sole ${f3(minFoot)} m`);
  const planted = feet.filter((f) => f.y < 0.02);
  const drift = planted.length ? Math.max(...planted.map((f) => f.x)) - Math.min(...planted.map((f) => f.x)) : 0;
  check("sit: grounded soles stay planted while the hips go down", drift < 0.02, `${planted.length} grounded frames, drift ${f3(drift)} m`);
  const g = a.group.position;
  check("sit: root on the seat", Math.hypot(g.x - seat.x, g.z - seat.z) < 1e-3, `off ${f3(Math.hypot(g.x - seat.x, g.z - seat.z))}`);

  // held: a mover writing the transform is overridden the next tick, no drift
  a.group.position.x += 0.4;
  M.postureTick(DT);
  check("sit: hold pins the seated body", Math.abs(a.group.position.x - seat.x) < 1e-6);

  // GET UP
  M.stand(a);
  check("stand: sequence starts", M.busy(a));
  const st2 = run(a, 8, () => !M.busy(a));
  check("stand: done, standing", M.posture(a) === "stand" && !a.char.sitting && a.char.seatBlend == null, `after ${(st2.frames * DT).toFixed(2)} s`);
  check("stand: no root jump > 0.1 m", st2.maxJump <= 0.1, `max ${f3(st2.maxJump)} m/frame`);
  check("stand: yaw rate <= 6 rad/s", st2.maxYawRate <= 6, `max ${st2.maxYawRate.toFixed(2)}`);
  const c = clearOfFrame(a.group.position);
  check("stand: walked out clear of the frame collider", c >= BODY_R - 0.02, `${f3(c)} m from the frame (body r ${BODY_R})`);
}

// ---------------------------------------------------------------------------
// 2. LIE on the bottom bunk (perch → swing), then RISE and step out
{
  const a = actor(1.6, -0.8, 0.3);
  const bed = { x: 0, y: 0, z: 0, hx: 0, hz: -1, len: BUNK.mattLon, top: BUNK.top, lieY: BUNK.top + 0.3,
    face: Math.atan2(-1, -0), kind: "bunk", ceiling: BUNK.deckY, entry: ENTRY };
  check("lie: sequence starts", M.lie(a, bed) && M.busy(a));
  let minHipOn = Infinity, minHeadOn = Infinity, swingFrames = 0;
  const st = run(a, 12, () => M.posture(a) === "lie", () => {
    const Q = a._pz.seq, nm = Q ? Q.names[Q.i] : "";
    if (nm === "swing") {
      swingFrames++;
      minHipOn = Math.min(minHipOn, a._pz.hip.y);
      minHeadOn = Math.min(minHeadOn, headOf(a).y);
    }
  });
  check("lie: lying", M.posture(a) === "lie" && !!a.char.lying, `after ${(st.frames * DT).toFixed(2)} s`);
  check("lie: no root jump > 0.1 m", st.maxJump <= 0.1, `max ${f3(st.maxJump)} m/frame`);
  check("lie: yaw rate <= 6 rad/s", st.maxYawRate <= 6, `max ${st.maxYawRate.toFixed(2)}`);
  check("lie: hips never below the mattress top in the swing", minHipOn >= BUNK.top, `${swingFrames} frames, min hip ${f3(minHipOn)}`);
  check("lie: head never below the mattress top in the swing", minHeadOn >= BUNK.top, `min head ${f3(minHeadOn)}`);
  const g = a.group.position, hd = headOf(a), hp = a._pz.hip;
  const inside = (p) => Math.abs(p.x - bed.x) <= BUNK.mattLat / 2 && Math.abs(p.z - bed.z) <= BUNK.mattLon / 2;
  check("lie: feet, hips and head inside the mattress", inside(g) && inside(hp) && inside(hd),
    `feet (${f3(g.x)},${f3(g.z)}) hip (${f3(hp.x)},${f3(hp.z)}) head (${f3(hd.x)},${f3(hd.z)})`);
  check("lie: head at the pillow end", hd.z < -0.75, `head z ${f3(hd.z)} (pillow -0.8..-1.2)`);
  check("lie: body on the mattress, not under it", g.y >= BUNK.top && Math.abs(a.group.rotation.z - Math.PI / 2) < 1e-6, `root y ${f3(g.y)}`);

  M.stand(a);
  const st2 = run(a, 10, () => !M.busy(a));
  check("rise: standing", M.posture(a) === "stand" && !a.char.lying && !a.char.sitting && a.group.rotation.z === 0);
  check("rise: no root jump > 0.1 m", st2.maxJump <= 0.1, `max ${f3(st2.maxJump)} m/frame`);
  check("rise: yaw rate <= 6 rad/s", st2.maxYawRate <= 6, `max ${st2.maxYawRate.toFixed(2)}`);
  check("rise: feet back on the floor", Math.abs(a.group.position.y) < 1e-6, `y ${f3(a.group.position.y)}`);
  const c = clearOfFrame(a.group.position);
  check("rise: walked out clear of the frame collider", c >= BODY_R - 0.02, `${f3(c)} m`);
}

// ---------------------------------------------------------------------------
// 3. TOP BUNK: climb the ladder, roll onto the upper mattress, then climb down
{
  const a = actor(1.5, 2.6, -2.0);
  const lad = { x: 0, z: BUNK.lonOut + 0.05 };
  const bed = { x: 0, y: BUNK.topBunk - BUNK.top, z: 0, hx: 0, hz: -1, len: BUNK.mattLon, top: BUNK.topBunk,
    lieY: BUNK.topBunk + 0.3, face: Math.atan2(-1, -0), kind: "bunk", floorY: 0, ladder: lad };
  check("climb: sequence starts", M.lie(a, bed) && M.busy(a));
  let maxDy = 0, py = 0, minHipOn = Infinity, rolled = 0;
  const st = run(a, 20, () => M.posture(a) === "lie", () => {
    const Q = a._pz.seq, nm = Q ? Q.names[Q.i] : "";
    maxDy = Math.max(maxDy, Math.abs(a.group.position.y - py) / DT); py = a.group.position.y;
    if (nm === "rollOn") { rolled++; minHipOn = Math.min(minHipOn, a._pz.hip.y); }
  });
  check("climb: lying on the top bunk", M.posture(a) === "lie", `after ${(st.frames * DT).toFixed(2)} s`);
  check("climb: no root jump > 0.1 m", st.maxJump <= 0.1, `max ${f3(st.maxJump)} m/frame`);
  check("climb: yaw rate <= 6 rad/s", st.maxYawRate <= 6, `max ${st.maxYawRate.toFixed(2)}`);
  check("climb: climbs, never lifts (vertical <= 1.6 m/s)", maxDy <= 1.6, `max ${maxDy.toFixed(2)} m/s`);
  check("climb: hips at/over the upper mattress while rolling on", minHipOn >= BUNK.topBunk - 0.01, `${rolled} frames, min ${f3(minHipOn)}`);
  const g = a.group.position, hd = headOf(a);
  const inside = (p) => Math.abs(p.x - bed.x) <= BUNK.mattLat / 2 && Math.abs(p.z - bed.z) <= BUNK.mattLon / 2;
  check("climb: body inside the upper mattress, head at the pillow", inside(g) && inside(hd) && hd.z < -0.75 && g.y >= BUNK.topBunk,
    `feet (${f3(g.x)},${f3(g.y)},${f3(g.z)}) head z ${f3(hd.z)}`);

  M.stand(a);
  let maxDy2 = 0; py = a.group.position.y;
  const st2 = run(a, 20, () => !M.busy(a), () => { maxDy2 = Math.max(maxDy2, Math.abs(a.group.position.y - py) / DT); py = a.group.position.y; });
  check("climb down: standing on the floor", M.posture(a) === "stand" && Math.abs(a.group.position.y) < 1e-6 && a.group.rotation.z === 0,
    `y ${f3(a.group.position.y)} after ${(st2.frames * DT).toFixed(2)} s`);
  check("climb down: no root jump > 0.1 m", st2.maxJump <= 0.1, `max ${f3(st2.maxJump)} m/frame`);
  check("climb down: yaw rate <= 6 rad/s", st2.maxYawRate <= 6, `max ${st2.maxYawRate.toFixed(2)}`);
  check("climb down: climbs, never drops (vertical <= 1.6 m/s)", maxDy2 <= 1.6, `max ${maxDy2.toFixed(2)} m/s`);
  const c = clearOfFrame(a.group.position);
  check("climb down: stepped back clear of the frame", c >= BODY_R - 0.02, `${f3(c)} m`);
}

// ---------------------------------------------------------------------------
// 4. THE "BACK" PERCH (sat into the bed at the head end) and a get-up called MID-LOWER
{
  const a = actor(1.3, 0.4, 2.0);
  const seat = Object.assign(edgeSeat(), { z: -0.72, entry: { x: ENTRY.x, z: -0.72 }, exit: { x: ENTRY.x, z: -0.72 },
    scoot: { x: 0.06, z: -0.72, face: 0, kind: "bunk-back" } });
  M.sit(a, seat);
  const st = run(a, 12, () => M.posture(a) === "sit");
  check("back perch: seated into the bed", M.posture(a) === "sit" && a.char.seatRef && a.char.seatRef.kind === "bunk-back",
    `at (${f3(a.group.position.x)},${f3(a.group.position.z)})`);
  check("back perch: no jump / yaw snap", st.maxJump <= 0.1 && st.maxYawRate <= 6, `jump ${f3(st.maxJump)}, yaw ${st.maxYawRate.toFixed(2)}`);
  M.stand(a);
  const st2 = run(a, 10, () => !M.busy(a));
  check("back perch: gets up via the edge and out", M.posture(a) === "stand" && clearOfFrame(a.group.position) >= BODY_R - 0.02 && st2.maxJump <= 0.1 && st2.maxYawRate <= 6,
    `jump ${f3(st2.maxJump)}, clear ${f3(clearOfFrame(a.group.position))}`);

  // interrupt: the brain wants out halfway down
  const b = actor(1.3, 0.2, 2.0);
  M.sit(b, edgeSeat());
  run(b, 8, () => b._pz.seq && b._pz.seq.names[b._pz.seq.i] === "lower" && b._pz.seq.t > 0.3);
  const bMid = b._pz.b;
  M.stand(b);
  const st3 = run(b, 8, () => !M.busy(b));
  check("interrupt mid-lower: reverses from where the hips are", bMid > 0.2 && bMid < 0.95 && st3.maxJump <= 0.1 && M.posture(b) === "stand",
    `blend at call ${f3(bMid)}, jump ${f3(st3.maxJump)}`);
}

// ---------------------------------------------------------------------------
// 5. KNEEL (tending a body) and back up
{
  const a = actor(0, 0, 0);
  M.kneel(a, { at: { x: 1.0, z: 1.0 }, look: { x: 1.8, z: 1.0 } });
  const kb = [];
  const st = run(a, 8, () => M.posture(a) === "kneel", () => kb.push(a.char.kneelB || 0));
  let mono = true; for (let i = 1; i < kb.length; i++) if (kb[i] < kb[i - 1] - 1e-9) mono = false;
  check("kneel: down on one knee", M.posture(a) === "kneel" && a.char.kneelB === 1 && mono, `after ${(st.frames * DT).toFixed(2)} s`);
  check("kneel: no jump / yaw snap", st.maxJump <= 0.1 && st.maxYawRate <= 6, `jump ${f3(st.maxJump)}, yaw ${st.maxYawRate.toFixed(2)}`);
  const kl = M.kneelLegs(a.char, {});
  check("kneel: hips at knee height (thigh + knee cap)", Math.abs(a._pz.hip.y - kl.hip) < 1e-3 && kl.hip > 0.3 && kl.hip < 0.45, `hip ${f3(a._pz.hip.y)}`);
  M.stand(a);
  const st2 = run(a, 4, () => !M.busy(a));
  check("kneel: back up", M.posture(a) === "stand" && !(a.char.kneelB > 0) && st2.maxJump <= 0.1);
  M.crouch(a, true);
  check("crouch: posture flag", M.posture(a) === "crouch" && a.char.crouch === true && !M.busy(a));
  M.crouch(a, false);
}

// ---------------------------------------------------------------------------
// 6. propuse's verbs are thin aliases of the one sequencer
{
  const a = actor(1.5, 0.3, 0);
  const seat = CBZ.propRegisterSeat(0.55, 0, 0, Math.PI / 2, "bunk", null, { cushion: 0.62, floorBelow: 0 });
  const ok = CBZ.propSit(a, seat);
  check("propSit: starts the moves sequence", ok && CBZ.propArcActive(a) && M.busy(a) && seat.occupant === a);
  run(a, 10, () => M.posture(a) === "sit");
  check("propSit: seated through CBZ.moves", M.posture(a) === "sit" && a._propSeat === seat);
  CBZ.propStand(a);
  run(a, 10, () => !M.busy(a));
  check("propStand: walked out, seat released", M.posture(a) === "stand" && !seat.occupant && !a._propSeat);

  // a seated NPC whose own brain stands him up (city/peds.js clears the flag on
  // a threat) is let go by the hold, claim and all, not sat back down
  CBZ.propSit(a, seat);
  run(a, 10, () => M.posture(a) === "sit");
  a.char.sitting = false;
  M.postureTick(DT);
  check("hold yields to an interrupt", M.posture(a) === "stand" && !seat.occupant && !a._propSeat && !a.char.sitting);

  // KO mid-sequence: the sequence lets go, the claim is released
  CBZ.propSit(a, seat);
  run(a, 0.5);
  a.ko = 3;
  M.postureTick(DT);
  check("KO aborts a sit mid-way", !M.busy(a) && M.posture(a) === "stand" && !seat.occupant, `occupant ${seat.occupant ? "held" : "free"}`);
  a.ko = 0;
}

// ---- A CAR DOOR (CBZ.moves.board / .alight): a sedan at (10, 0) heading
// 0.6 rad, driver seat on the left (+X local), the door plane at x 0.92 ----
{
  const CX = 10, CZ = 0, HD = 0.6;
  function carSpec(extra) {
    const s = 1, halfW = 0.92, z1 = 0.55, len = 1.1, z0 = z1 - len;
    const V = {
      side: s,
      toWorld(lx, ly, lz, o) {
        o.x = CX + lx * Math.cos(HD) + lz * Math.sin(HD);
        o.z = CZ - lx * Math.sin(HD) + lz * Math.cos(HD);
        o.y = ly; return o;
      },
      yaw: () => HD,
      H: { x: s * (halfW + 0.46), z: z0 - 0.02 }, A: { x: s * (halfW + 0.26), z: -0.10 },
      S: { x: 0.40, y: 0.30, z: -0.15 }, C: { x: s * (halfW + 0.62), z: z0 - 0.38 },
      yawH: -s * (Math.PI / 2 - 0.3), yawA: -s * Math.PI / 4, yawS: 0, yawOut: s * 0.95, yawShut: 0.4,
      doorX: s * halfW, sillY: 0.36, fit: 0.62,
      ref: { cushion: (0.52 - 0.30) / 0.62, floorBelow: 0, kind: "car" },
      groundY: 0, beats: [], beat(n, u) { if (this.beats[this.beats.length - 1] !== n) this.beats.push(n); },
    };
    return Object.assign(V, extra || {});
  }
  const a = actor(CX + 4, CZ - 3, 0);
  a.group.scale = { x: 1, y: 1, z: 1, setScalar(v) { this.x = this.y = this.z = v; } };
  const V = carSpec();
  let done = 0;
  const ok = M.board(a, V, { onDone: () => { done = 1; } });
  check("car: board starts", ok && M.busy(a));
  let minScale = 1, t = 0;
  const st = run(a, 8, () => done, () => { minScale = Math.min(minScale, a.group.scale.x); t += DT; });
  const seatW = V.toWorld(V.S.x, V.S.y, V.S.z, {});
  const g = a.group.position;
  check("car: sat in the seat", done && Math.hypot(g.x - seatW.x, g.z - seatW.z) < 0.02 && Math.abs(g.y - seatW.y) < 0.01,
    `at ${f3(g.x)},${f3(g.y)},${f3(g.z)} seat ${f3(seatW.x)},${f3(seatW.y)},${f3(seatW.z)}`);
  check("car: beats in order", V.beats.join(",") === "walk,pull,swing,in", V.beats.join(","));
  check("car: never a teleport (<= 0.12 m/frame)", st.maxJump <= 0.12, `max ${f3(st.maxJump)}`);
  check("car: never a yaw snap (<= 7 rad/s)", st.maxYawRate <= 7, `max ${st.maxYawRate.toFixed(2)}`);
  check("car: shrinks to the cabin fit, ends on it", Math.abs(a.group.scale.x - V.fit) < 1e-6 && minScale >= V.fit - 1e-6);
  check("car: seated rig on the seat's ref", a.char.sitting && a.char.seatRef === V.ref && a.char.seatBlend == null);
  check("car: door part quick (walk + ~1.2 s)", t < 4, `${t.toFixed(2)} s total`);

  // OUT: from this seat, same frame
  const V2 = carSpec();
  let out = 0;
  check("car: alight starts IN the seat", M.alight(a, V2, { onDone: () => { out = 1; } }) &&
    Math.hypot(a.group.position.x - seatW.x, a.group.position.z - seatW.z) < 0.01);
  let t2 = 0;
  const st2 = run(a, 5, () => out, () => { t2 += DT; });
  const cW = V2.toWorld(V2.C.x, 0, V2.C.z, {});
  check("car: stood clear of the door", out && Math.hypot(a.group.position.x - cW.x, a.group.position.z - cW.z) < 0.02 && a.group.position.y === 0);
  check("car: out beats", V2.beats.join(",") === "open,out,step,shut", V2.beats.join(","));
  check("car: out never a teleport", st2.maxJump <= 0.12, `max ${f3(st2.maxJump)}`);
  check("car: full size again, standing", a.group.scale.x === 1 && !a.char.sitting && !M.busy(a));
  check("car: out takes 1-1.6 s", t2 > 1.0 && t2 < 1.6, `${t2.toFixed(2)} s`);

  // SKIP: a second press plays the rest fast
  const V3 = carSpec();
  let d3 = 0; M.board(a, V3, { onDone: () => { d3 = 1; } });
  run(a, 0.2);
  M.skip(a, 4);
  let t3 = 0; run(a, 3, () => d3, () => { t3 += DT; });
  check("car: skip finishes seated", d3 === 1, `${t3.toFixed(2)} s after skip`);
  const V4 = carSpec();
  let d4 = 0; M.alight(a, V4, { onDone: () => { d4 = 1; } });
  // a carjack: the pull drags them out and the door waits for the aperture
  let jacked = 0, clearAt = 0.8, tj = 0;
  run(a, 5, () => d4);
  const V5 = carSpec({ jack: () => { jacked++; }, clear: () => tj > clearAt });
  let d5 = 0; M.board(a, V5, { onDone: () => { d5 = 1; } });
  run(a, 8, () => d5, () => { tj += DT; });
  check("car: jack fires once at the pull, then waits", jacked === 1 && V5.beats.indexOf("wait") > 0 && d5 === 1, V5.beats.join(","));
}

console.log(fails ? `\n${fails} FAILED` : "\nall posture scenarios pass");
process.exit(fails ? 1 : 0);
