#!/usr/bin/env node
/* tools/palm-contact-check.mjs — DOES THE HAND GO ON THE THING IT TOUCHES?

   Owner: "palm contact for the rest of the physical world using the same
   plant solver": door leaves, car handles, the car's frame getting in/out,
   lift buttons, pushing a crate, leaning on cover, a keycard on a reader.
   Every one of those goes through CBZ.verbs.touch (systems/verbs_pickup.js),
   which is a clock around entities/character.js charArmTo.plant. Plain node,
   no browser: the REAL three r128 + fphands + character + the verbs core +
   verbs_pickup.js (tools/lib/verbs-vm.mjs), real rigs, real slabs.

   Per body (man, woman, teen) and per contact kind it asserts, at the middle
   of the hold (weight 1):
     · on       the posed hand's own contact point (fpHands.contactOf: the
                palm plane / the index pad / the grip axis / the card pinch)
                is within 2 cm of the surface point, whenever the point is in
                reach (share of the palm's span < 1);
     · facing   palm/card/handle: the back of the hand along the surface
                normal (palm flat on it, < 20 deg); press: the finger along
                -normal (into the button, < 25 deg);
     · rigid    no arm segment stretched;
     · clock    onTouch fires exactly once; the hand lets go afterwards (its
                pose handed back, weight 0, the touch gone);
     · sustain  a lean / a push held by refreshing every frame stays on, and
                lets go within ~0.5 s of the refreshes stopping;
     · surface  CBZ.verbs.touchSurface finds the near face of a turned slab
                (its point on the face, its normal out of it toward the actor);
     · busy     CBZ.verbs.handBusy names the touching arm while it is on.

     node tools/palm-contact-check.mjs [--verbose]     exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadVerbsVM } from "./lib/verbs-vm.mjs";

const ROOT = new URL("../", import.meta.url);
const verbose = process.argv.includes("--verbose");
const vmx = loadVerbsVM({ mode: "city" });
const { CBZ, THREE: T, ctx } = vmx;
CBZ.scene = new T.Scene();
vm.runInContext(readFileSync(new URL("src/systems/verbs_pickup.js", ROOT), "utf8"), ctx, { filename: "src/systems/verbs_pickup.js" });
const V = CBZ.verbs, H = CBZ.fpHands, CA = CBZ.charArmTo;
let fails = 0, checks = 0;
const failList = [];
function check(ok, msg) { checks++; if (!ok) { fails++; failList.push(msg); } if (verbose) console.log((ok ? "  ok   " : "  FAIL ") + msg); }
if (!V.touch || !CA || !CA.plant || !H.contactOf) { console.log("FAIL verbs.touch / charArmTo.plant / fpHands.contactOf missing"); process.exit(1); }
if (!vmx.updaters.some((u) => u.fn === V.touchUpdate)) { console.log("FAIL touchUpdate not registered on CBZ.onUpdate"); process.exit(1); }
const DT = 1 / 60;

const _v = new T.Vector3(), _q = new T.Quaternion();
function contactWorld(ch, arm, pose) {
  const hand = (arm === "l" ? ch.parts.la : ch.parts.ra).userData.cap;
  const c = H.contactOf(pose, new T.Vector3());
  if (hand.userData.side < 0) c.x = -c.x;
  hand.updateMatrixWorld(true);
  return hand.localToWorld(c);
}
function handAxes(ch, arm) {
  const hand = (arm === "l" ? ch.parts.la : ch.parts.ra).userData.cap;
  hand.getWorldQuaternion(_q);
  return { back: new T.Vector3(0, 1, 0).applyQuaternion(_q), fing: new T.Vector3(0, 0, -1).applyQuaternion(_q) };
}
function armLens(ch, arm) {
  const part = arm === "l" ? ch.parts.la : ch.parts.ra, low = part.userData.low, hand = part.userData.cap;
  part.updateMatrixWorld(true);
  const sh = part.getWorldPosition(new T.Vector3()), el = low.getWorldPosition(new T.Vector3());
  const wr = low.localToWorld(new T.Vector3(0, hand.userData.fit.wristY, 0));
  return [sh.distanceTo(el), el.distanceTo(wr)];
}
const deg = (c) => Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
const POSE = { palm: "plant", press: "point", handle: "grip", card: "card" };

const BODIES = [{ label: "man", c: {} }, { label: "woman", c: { build: "f" } }, { label: "teen", c: { age: 13 } }];
const rows = [];

function fresh(body) {
  vmx.clearActors();
  for (let i = V.touches.length - 1; i >= 0; i--) V.touches.splice(i, 1);
  const a = vmx.actor(Object.assign({ x: 0, z: 0, yaw: 0 }, body.c));
  for (let i = 0; i < 12; i++) vmx.frame(DT);
  return a;
}
function shoulderY(ch) { ch.group.updateMatrixWorld(true); return ch.parts.ra.getWorldPosition(new T.Vector3()).y; }

/* One contact: run it through, sample the middle of the hold. */
function oneShot(body, tag, make) {
  const a = fresh(body), ch = a.char;
  const spec = make(ch);
  const rest = [armLens(ch, "l"), armLens(ch, "r")];
  let touched = 0, done = 0;
  const C = V.touch(a, Object.assign({}, spec, { onTouch() { touched++; }, onDone() { done++; } }));
  check(!!C, `${tag}: the touch plays`);
  if (!C) return;
  const pose = POSE[C.kind];
  let sample = null, stretch = 0, busy = false;
  for (let f = 0; f < 200 && !C.done; f++) {
    vmx.frame(DT);
    const L = armLens(ch, C.arm), R0 = rest[C.arm === "l" ? 0 : 1];
    stretch = Math.max(stretch, L[0] - R0[0], L[1] - R0[1]);
    if (V.handBusy(a, C.arm) === "touch") busy = true;
    if (!sample && C.w >= 0.999 && C.t > C.T.reach + C.T.hold * 0.5) {
      const p = contactWorld(ch, C.arm, pose), ax = handAxes(ch, C.arm);
      sample = { res: p.distanceTo(C.point), share: C.share, ax, n: C.n.clone(), pose: (C.arm === "l" ? ch.parts.la : ch.parts.ra).userData.cap.userData.handPose };
    }
  }
  check(C.done, `${tag}: the touch ends`);
  check(!!sample, `${tag}: the hand reaches full weight`);
  check(touched === 1 && done === 1, `${tag}: onTouch/onDone fire once (${touched}/${done})`);
  check(busy, `${tag}: handBusy names the ${C.arm} arm while it is on`);
  check(stretch < 1e-4, `${tag}: no arm segment stretched (${(stretch * 1000).toFixed(2)} mm)`);
  const handPose = (C.arm === "l" ? ch.parts.la : ch.parts.ra).userData.cap.userData.handPose;
  check(handPose !== pose, `${tag}: the hand lets go (${handPose})`);
  check(V.handBusy(a, C.arm) == null, `${tag}: the arm is free again`);
  if (!sample) return;
  check(sample.pose === pose, `${tag}: the hand wears ${pose} (${sample.pose})`);
  if (sample.share < 1) check(sample.res < 0.02, `${tag}: contact on the point (${(sample.res * 100).toFixed(2)} cm, share ${sample.share.toFixed(2)})`);
  else check(false, `${tag}: point in reach after the step-in (share ${sample.share.toFixed(2)})`);
  const face = C.kind === "press" ? deg(sample.ax.fing.dot(sample.n.clone().negate())) : deg(sample.ax.back.dot(sample.n));
  check(face < (C.kind === "press" ? 25 : 20), `${tag}: ${C.kind === "press" ? "finger into the button" : "palm against the surface"} (${face.toFixed(1)} deg)`);
  rows.push([tag, C.arm, (sample.res * 100).toFixed(2), sample.share.toFixed(2), face.toFixed(1), (stretch * 1000).toFixed(2)]);
}

/* A held contact (lean / push): refreshed every frame for `frames`, then left. */
function sustained(body, tag, make, frames) {
  const a = fresh(body), ch = a.char;
  const rest = [armLens(ch, "l"), armLens(ch, "r")];
  let C = null, worst = 0, sampled = 0, stretch = 0, face = 0;
  for (let f = 0; f < frames; f++) {
    const spec = make(ch, f);
    C = V.touch(a, Object.assign({ sustain: true }, spec));
    vmx.frame(DT);
    if (!C) break;
    const L = armLens(ch, C.arm), R0 = rest[C.arm === "l" ? 0 : 1];
    stretch = Math.max(stretch, L[0] - R0[0], L[1] - R0[1]);
    if (C.w >= 0.999 && C.share < 1) {
      const p = contactWorld(ch, C.arm, POSE[C.kind]);
      worst = Math.max(worst, p.distanceTo(C.point));
      face = Math.max(face, deg(handAxes(ch, C.arm).back.dot(C.n)));
      sampled++;
    }
  }
  check(!!C, `${tag}: the held touch plays`);
  if (!C) return;
  check(sampled > frames * 0.5, `${tag}: on for most of the hold (${sampled}/${frames} frames)`);
  check(worst < 0.02, `${tag}: palm stays on the point (worst ${(worst * 100).toFixed(2)} cm)`);
  check(face < 20, `${tag}: palm flat on it (worst ${face.toFixed(1)} deg)`);
  check(stretch < 1e-4, `${tag}: no arm segment stretched (${(stretch * 1000).toFixed(2)} mm)`);
  let off = 0;
  for (; off < 60 && !C.done; off++) vmx.frame(DT);
  check(C.done && off < 35, `${tag}: lets go once the refreshes stop (${off} frames)`);
  rows.push([tag, C.arm, (worst * 100).toFixed(2), "-", face.toFixed(1), (stretch * 1000).toFixed(2)]);
}

// ---------------------------------------------------------------- the world pieces
function slab(w, h, t, x, y, z, yaw) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, t), new T.MeshBasicMaterial());
  m.position.set(x, y, z); m.rotation.y = yaw || 0;
  CBZ.scene.add(m); m.updateMatrixWorld(true);
  return m;
}

for (const body of BODIES) {
  const B = body.label;
  // a door leaf a stride ahead, turned a little: the palm finds its near face (the body steps in)
  oneShot(body, `${B}/door leaf`, (ch) => {
    const leaf = slab(0.95, 2.05, 0.05, 0.1, 1.05, 1.05, 0.25);
    const sy = shoulderY(ch);
    const s = V.touchSurface(leaf, { x: 0, y: sy, z: 0 }, sy - 0.18);
    check(s && s.normal.z < -0.9, `${B}/door leaf: touchSurface faces the actor (n ${s && s.normal.toArray().map((v) => v.toFixed(2))})`);
    return { point: s.point, normal: s.normal, kind: "palm", key: "door" };
  });
  // a car's door handle: a bar along the flank at belt height (hand closes round it)
  oneShot(body, `${B}/car handle`, (ch) => {
    const sy = shoulderY(ch);
    return { point: { x: -0.22, y: Math.min(0.98, sy - 0.30), z: 0.50 }, normal: { x: 0, y: 0, z: -1 }, axis: { x: 1, y: 0, z: 0 }, kind: "handle", key: "car-handle" };
  });
  // the car's frame: a palm on the roof edge over the open door, getting in
  oneShot(body, `${B}/car frame`, (ch) => {
    const sy = shoulderY(ch);
    return { point: { x: 0.26, y: Math.min(1.42, sy + 0.12), z: 0.42 }, normal: { x: 0, y: 1, z: 0 }, along: { x: 0, y: 0, z: 1 }, kind: "palm", key: "car-frame" };
  });
  // a lift's call button on the wall ahead
  oneShot(body, `${B}/lift button`, (ch) => {
    const sy = shoulderY(ch);
    return { point: { x: -0.18, y: Math.min(1.42, sy - 0.05), z: 0.60 }, normal: { x: 0, y: 0, z: -1 }, kind: "press", key: "lift-call" };
  });
  // a keycard onto the reader beside a door
  oneShot(body, `${B}/card reader`, (ch) => {
    const sy = shoulderY(ch);
    return { point: { x: -0.12, y: Math.min(1.18, sy - 0.1), z: 0.55 }, normal: { x: 0, y: 0, z: -1 }, kind: "card", key: "reader" };
  });
  // pushing a crate: both palms on its near face, held while the push lasts
  {
    const crate = slab(0.9, 0.9, 0.9, 0, 0.45, 0.84, 0.1);   // the body against it (player radius 0.38)
    for (const arm of ["l", "r"]) {
      let sy0 = null;                          // the standing shoulder: the push height does not chase the lean
      sustained(body, `${B}/crate push ${arm}`, (ch) => {
        const sy = sy0 != null ? sy0 : (sy0 = shoulderY(ch));
        const from = { x: arm === "l" ? 0.2 : -0.2, y: sy, z: 0 };
        const s = V.touchSurface(crate, from, Math.min(0.78, sy - 0.35));
        return { point: s.point, normal: s.normal, kind: "palm", arm, key: "crate-" + arm };
      }, 50);
    }
    CBZ.scene.remove(crate);
  }
  // leaning on cover: a wall at the left shoulder, the palm flat on it
  sustained(body, `${B}/cover lean`, (ch) => {
    const sy = shoulderY(ch);
    return { point: { x: 0.52, y: sy - 0.05, z: 0.18 }, normal: { x: -1, y: 0, z: 0 }, kind: "palm", arm: "l", key: "cover" };
  }, 50);
}

// THE WALL: the player stood facing a wall rests a palm on it; walking into one braces a hand on it
for (const mode of ["lean", "brace"]) {
  vmx.clearActors();
  for (let i = V.touches.length - 1; i >= 0; i--) V.touches.splice(i, 1);
  const P = CBZ.player, ch = CBZ.playerChar;
  P.pos.set(0, 0, 0); P.grounded = true; P.moveX = 0; P.moveZ = mode === "brace" ? 2.5 : 0;
  ch.group.position.copy(P.pos); ch.group.rotation.set(0, 0.15, 0);
  vmx.world({ colliders: [{ minX: -2, maxX: 2, minZ: 0.52, maxZ: 0.9, y0: 0, y1: 3 }] });
  let on = 0, worst = 0, face = 0, offFace = 0;
  for (let f = 0; f < 120; f++) {
    CBZ.animChar(ch, 0, DT);
    vmx.frame(DT);
    const C = V.touchOf(P, "wall");
    if (C && C.w >= 0.999 && C.share < 1) {
      on++;
      worst = Math.max(worst, contactWorld(ch, C.arm, "plant").distanceTo(C.point));
      face = Math.max(face, deg(handAxes(ch, C.arm).back.dot(C.n)));
      if (!(Math.abs(C.point.z - 0.52) < 1e-6 && C.n.z < -0.99)) offFace++;
    }
  }
  check(on > 30, `wall ${mode}: a palm goes on the wall (${on} frames)`);
  check(offFace === 0, `wall ${mode}: the palm's point is on the wall's face, facing out (${offFace} frames off)`);
  check(worst < 0.02 && face < 20, `wall ${mode}: flat on it (${(worst * 100).toFixed(2)} cm, ${face.toFixed(1)} deg)`);
  P.moveZ = 0;
  vmx.world({ colliders: [] });
  let off = 0;
  for (; off < 60 && V.touchOf(P, "wall"); off++) { CBZ.animChar(ch, 0, DT); vmx.frame(DT); }
  check(!V.touchOf(P, "wall"), `wall ${mode}: lets go when the wall is gone (${off} frames)`);
  rows.push(["player/wall " + mode, "-", (worst * 100).toFixed(2), "-", face.toFixed(1), "-"]);
}

// a point across the room gets no hand (the consequence still fires, at once)
{
  const a = fresh(BODIES[0]);
  let n = 0;
  const C = V.touch(a, { point: { x: 0, y: 1.2, z: 4.0 }, normal: { x: 0, y: 0, z: -1 }, kind: "press", onTouch() { n++; } });
  check(C == null && n === 1, "a button 4 m away: no hand thrown at it, the press still happens");
}
// first person reads the player's live touches as plants (fpsmode fpPlants)
{
  vmx.clearActors();
  for (let i = V.touches.length - 1; i >= 0; i--) V.touches.splice(i, 1);
  const P = CBZ.player, ch = CBZ.playerChar;
  P.pos.set(0, 0, 0); ch.group.position.copy(P.pos); ch.group.rotation.set(0, 0, 0);
  const C = V.touch(P, { point: { x: -0.15, y: 1.2, z: 0.55 }, normal: { x: 0, y: 0, z: -1 }, kind: "press", key: "fp" });
  for (let f = 0; f < 20; f++) { CBZ.animChar(ch, 0, DT); vmx.frame(DT); }
  const L = V.touchPlants();
  const rec = L && L[0];
  check(!!C && rec && rec.p === C.point && rec.pose === "point" && rec.w > 0.99 && rec.bk && rec.fg, "touchPlants hands fpPlants the player's press (point, pose, weight, frame)");
  C.release();
  for (let f = 0; f < 40; f++) { CBZ.animChar(ch, 0, DT); vmx.frame(DT); }
  check(V.touchPlants().length === 0 && C.done, "released: first person lets go too");
}

// a touch nothing can play still fires its consequence
{
  let n = 0;
  V.touch(null, { point: null, normal: null, onTouch() { n++; } });
  check(n === 1, "a touch with no point still fires onTouch");
}
// the traversal's palm plant is untouched by the generalisation
{
  const a = fresh(BODIES[0]), ch = a.char;
  const sh = ch.parts.ra.getWorldPosition(new T.Vector3());
  const p = sh.clone().add(new T.Vector3(-0.05, -0.35, 0.3));
  const res = CA.plant(ch, p, "r", new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1), 1);
  check(res < 0.002, `plant (no pose arg) still lands exactly (${(res * 1000).toFixed(2)} mm)`);
  check(ch.parts.ra.userData.cap.userData.handPose === "plant", "plant (no pose arg) wears plant");
  CA.contactRelease(ch, "r");
  check(ch.parts.ra.userData.cap.userData.handPose === "relaxed", "contactRelease hands the pose back");
}
if (vmx.errors.length) { for (const e of vmx.errors.slice(0, 5)) console.log("ERR " + e); check(false, "no updater threw"); }

console.log("contact                 arm   cm     share  deg    stretch mm");
for (const r of rows) console.log(r[0].padEnd(24) + r[1].padEnd(6) + r[2].padStart(5) + "  " + r[3].padStart(5) + "  " + r[4].padStart(5) + "  " + r[5].padStart(6));
if (fails) { console.log("\nFAILS:"); for (const f of failList) console.log("  " + f); }
console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
