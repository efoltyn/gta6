#!/usr/bin/env node
/* tools/verbs-pickup-check.mjs — CBZ.verbs.pickup, in plain node, in seconds.

   OWNER: "you press Take keycard and it doesn't actually show you picking
   it up." This loads the REAL rig (tools/lib/verbs-vm.mjs: three r128,
   character.js, fphands.js, the verbs core) plus systems/verbs_pickup.js and
   asserts, frame by frame at 60 fps:

   FIRST PERSON (a stub viewmodel built exactly the way fpsmode.js builds its
   own: vm under the camera, fphands hands at HAND_K, the wrist placed at the
   fistT target the hook writes):
     1. the phases run reach -> close -> lift -> done in ~0.35 s;
     2. onTaken fires exactly once, on the grab frame;
     3. the copy appears on the grab frame on the SAME pixels as the thing it
        replaces (NDC delta), and from then on it moves with the hand: never
        more than a few cm per frame, never far from the hand's grip point;
     4. the world object is hidden from the grab frame, not before;
     5. armed: the gun dips first and comes back after (lower/raise).
   THIRD PERSON (real NPC rigs, animChar, the late pass):
     6. the hand's grip point is within 5 cm of the thing on the grab frame,
        for a floor item and a table item (and a player at a table);
     7. the floor take bends the knees (hips go down), the table take leans;
     8. the copy follows the hand after the grab (no per-frame jump > 8 cm);
     9. after done the rig is handed back (model height 0, hand relaxed).
   And: a second pickup of the same item while one runs returns the same
   handle (no double take), and a headless call still fires onTaken.

     node tools/verbs-pickup-check.mjs
*/
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadVerbsVM } from "./lib/verbs-vm.mjs";

const ROOT = new URL("../", import.meta.url);
const vmx = loadVerbsVM({ mode: "city" });
const { CBZ, THREE, ctx } = vmx;
CBZ.scene = new THREE.Scene();
vm.runInContext(readFileSync(new URL("src/systems/verbs_pickup.js", ROOT), "utf8"), ctx, { filename: "src/systems/verbs_pickup.js" });
const V = CBZ.verbs;
const pickupUpdate = V.pickupUpdate;

let fails = 0, checks = 0;
function check(ok, msg, info) {
  checks++;
  if (!ok) { fails++; console.log("  FAIL " + msg + (info != null ? "  (" + info + ")" : "")); }
  else console.log("  ok   " + msg + (info != null ? "  (" + info + ")" : ""));
}
const DT = 1 / 60;
const f3 = (v) => v.toFixed(3);

function card(x, y, z) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.172, 0.003, 0.108), new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }));
  g.add(m);
  g.position.set(x, y, z);
  g.rotation.y = 0.42;
  CBZ.scene.add(g);
  g.updateMatrixWorld(true);
  return g;
}
function gunProp(x, y, z) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.035), new THREE.MeshLambertMaterial({ color: 0x222222 })));
  g.position.set(x, y + 0.02, z);
  CBZ.scene.add(g);
  g.updateMatrixWorld(true);
  return g;
}
const _p = new THREE.Vector3(), _q = new THREE.Vector3();
function proxyWorld(P, out) {
  P.proxy.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(P.proxy).getCenter(out);
}

/* ================================================================ FIRST PERSON */
function fpRun(label, armed) {
  console.log("\nFIRST PERSON: " + label);
  const cam = CBZ.camera;
  cam.position.set(0, 1.65, 0);
  cam.rotation.set(-0.55, 0, 0);
  cam.updateMatrixWorld(true);
  const H = CBZ.fpHands;
  const vmG = new THREE.Group();
  cam.add(vmG);
  vmG.position.set(0.12, -0.30, -0.66);
  const skin = new THREE.MeshLambertMaterial({ color: 0xd6a57e });
  const handR = H.makeHand(1, "relaxed", skin), handL = H.makeHand(-1, "fist", skin);
  handR.scale.setScalar(1.9); handL.scale.setScalar(1.9);
  const fists = new THREE.Group(); fists.add(handR, handL); vmG.add(fists);
  const fistT = [
    { x: 0.26, y: -0.26, z: 0.04, roll: 0.95, bend: -0.2, vis: true, curl: "relaxed", hook: 0 },
    { x: -0.30, y: -0.60, z: 0.10, roll: 0.95, bend: -0.2, vis: false, curl: "fist", hook: 0 },
  ];
  const REST = Object.assign({}, fistT[0]);
  CBZ.fpsActive = () => true;
  CBZ.playerArmed = () => armed;
  const item = card(0.12, 0.94, -0.75);
  const ndc = (p) => p.clone().project(cam);
  const itemNdc = ndc(new THREE.Box3().setFromObject(item).getCenter(new THREE.Vector3()));
  let taken = 0, takenAt = -1, doneAt = -1, frame = 0;
  const P = V.pickup(CBZ.player, item, { onTaken() { taken++; takenAt = frame; }, onDone() { doneAt = frame; } });
  check(!!P && P.fp, "the player's take in first person is a running FP take");
  const again = V.pickup(CBZ.player, item, { onTaken() { taken += 10; } });
  check(again === P, "a second Take on the same item returns the same take");
  const phases = [];
  let prev = null, maxStep = 0, maxOff = 0, grabNdc = null, hiddenBefore = false, gunDip0 = 0, gunDipMax = 0, dipEnd = -1;
  const sOf = (ph) => { if (phases[phases.length - 1] !== ph) phases.push(ph); };
  const S = new THREE.Vector3(0.30, -0.45, 0.12);
  for (frame = 1; frame < 120 && !P.done; frame++) {
    // fpsmode: animFists would write the rest pose; the hook overrides it
    Object.assign(fistT[0], REST);
    vmx.frame(DT);
    if (P.done) { sOf("done"); break; }
    sOf(P.phase);
    if (!P.grabbed && !item.visible) hiddenBefore = true;
    const out = V.fpPickup(vmG, fistT, handR, handL, armed);
    if (out && frame === 1) gunDip0 = out.gunDip;
    if (out) gunDipMax = Math.max(gunDipMax, out.gunDip);
    if (out && armed && P.phase === "raise") dipEnd = out.gunDip;
    // fpsmode's poseFpArms: wrist at the target, hand oriented along the arm
    const T = fistT[0];
    handR.position.set(T.x, T.y, T.z);
    vmG.updateMatrix();
    const Svm = S.clone().applyMatrix4(vmG.matrix.clone().invert());
    H.orientAlong(1, handR.position.clone().sub(Svm), T.roll, T.bend, handR.quaternion);
    H.setPose(handR, T.curl);
    cam.updateMatrixWorld(true);
    if (P.proxy && P.fpReady && !P.proxyGone) {
      proxyWorld(P, _p);
      if (!grabNdc) grabNdc = ndc(_p);
      if (prev) maxStep = Math.max(maxStep, _p.distanceTo(prev));
      if (process.env.DBG && prev) console.log("    f" + frame, P.phase, P.t.toFixed(3), f3(_p.distanceTo(prev)), f3(_p.x), f3(_p.y), f3(_p.z));
      prev = (prev || new THREE.Vector3()).copy(_p);
      // distance from the hand's pinch point, once seated (after close)
      if (P.phase === "lift") {
        const g = new THREE.Vector3(-0.030, -0.022, -0.100);
        handR.updateMatrixWorld(true);
        g.applyMatrix4(handR.matrixWorld);
        maxOff = Math.max(maxOff, g.distanceTo(_p) / 1.9);   // in hand-scale metres
      }
    }
  }
  const dur = (doneAt) * DT;
  const want = armed ? ["lower", "reach", "close", "lift", "raise", "done"] : ["reach", "close", "lift", "done"];
  check(JSON.stringify(phases) === JSON.stringify(want), "phases " + want.join(" -> "), phases.join(","));
  check(armed ? dur > 0.45 && dur < 0.62 : dur > 0.30 && dur < 0.42, "total time ~" + (armed ? "0.53" : "0.36") + " s", dur.toFixed(3) + " s");
  check(taken === 1, "onTaken fired exactly once", taken);
  check(takenAt > 0 && Math.abs(takenAt * DT - (P.T.lower + P.T.reach)) < DT * 1.5, "onTaken fired on the grab frame", (takenAt * DT).toFixed(3) + " s");
  check(!hiddenBefore, "the desk card stays on the desk until the hand is on it");
  check(!item.visible, "the desk card is gone after the take");
  check(grabNdc && Math.hypot(grabNdc.x - itemNdc.x, grabNdc.y - itemNdc.y) < 0.03, "the copy appears on the same pixels as the card",
    grabNdc ? "ndc delta " + Math.hypot(grabNdc.x - itemNdc.x, grabNdc.y - itemNdc.y).toFixed(4) : "no copy");
  // the viewmodel world is drawn at ~1.9x real (fpsmode HAND_K): real cm = vm / 1.9
  check(maxStep / 1.9 < 0.07, "the copy never jumps more than a few cm per frame", "max " + f3(maxStep / 1.9) + " m/frame real, " + f3(maxStep) + " vm");
  check(maxOff < 0.05, "the copy sits in the pinch while lifted", "max " + f3(maxOff) + " m (hand scale)");
  check(!P.proxy, "the copy is gone at the end (into the pocket)");
  if (armed) {
    check(gunDipMax > 0.99 && gunDip0 < 0.5, "the gun dips out before the hand comes in", "first " + gunDip0.toFixed(2));
    check(dipEnd >= 0 && dipEnd < 0.35, "the gun comes back up after", dipEnd.toFixed(2));
  }
  CBZ.scene.remove(item);
  cam.remove(vmG);
  CBZ.fpsActive = () => false;
  CBZ.playerArmed = () => false;
}

/* ================================================================ THIRD PERSON */
function tpRun(label, who, itemPos, kind) {
  console.log("\nTHIRD PERSON: " + label);
  vmx.clearActors();
  let a, ch;
  if (who === "player") {
    ch = CBZ.playerChar;
    CBZ.player.pos.set(0, 0, 0);
    ch.group.position.copy(CBZ.player.pos);
    ch.group.rotation.y = 0.3;
    a = CBZ.player;
  } else {
    a = vmx.actor({ x: 0, z: 0, yaw: 0.3, build: who === "f" ? "f" : "m" });
    ch = a.char;
  }
  for (let i = 0; i < 20; i++) { if (who === "player") CBZ.animChar(ch, 0, DT); vmx.frame(DT); }
  const item = kind === "gun" ? gunProp(itemPos[0], itemPos[1], itemPos[2]) : card(itemPos[0], itemPos[1], itemPos[2]);
  const itemC = new THREE.Box3().setFromObject(item).getCenter(new THREE.Vector3());
  let taken = 0, grabResid = null, grabSock = null, minModelY = 0, maxLean = 0, maxKnee = 0;
  const P = V.pickup(a, item, { onTaken() { taken++; } });
  check(!!P && !P.fp, "a third-person take is running", P && P.heightKind);
  const phases = [];
  let prev = null, maxStep = 0;
  let frame = 0;
  for (frame = 1; frame < 200 && !P.done; frame++) {
    if (who === "player") CBZ.animChar(ch, 0, DT);
    vmx.frame(DT);
    if (who === "player" && !vmx.updaters.some((u) => u.fn === pickupUpdate)) pickupUpdate(DT);
    if (phases[phases.length - 1] !== P.phase) phases.push(P.phase);
    if (ch.model) minModelY = Math.min(minModelY, ch.model.position.y);
    maxLean = Math.max(maxLean, ch.body.rotation.x);
    if (ch.low && ch.low.ll) maxKnee = Math.max(maxKnee, ch.low.ll.rotation.x);
    if (P.grabbed && grabResid == null) {
      ch.group.updateMatrixWorld(true);
      V.pickupGripPoint(ch, P.hand, P.pose, _p);
      grabResid = _p.distanceTo(itemC);
      const s = P.hand === "l" ? ch.sockets.leftHand : ch.sockets.rightHand;
      s.getWorldPosition(_q);
      grabSock = _q.distanceTo(itemC);
    }
    if (P.proxy && !P.proxyGone) {
      proxyWorld(P, _p);
      if (prev) maxStep = Math.max(maxStep, _p.distanceTo(prev));
      if (process.env.DBG && prev) console.log("    t" + frame, P.phase, P.t.toFixed(3), f3(_p.distanceTo(prev)));
      prev = (prev || new THREE.Vector3()).copy(_p);
    }
  }
  if (P.done && phases[phases.length - 1] !== "done") phases.push("done");
  check(JSON.stringify(phases) === JSON.stringify(["reach", "close", "lift", "done"]), "phases reach -> close -> lift -> done", phases.join(","));
  check(taken === 1, "onTaken fired exactly once", taken);
  check(grabResid != null && grabResid <= 0.05, "the hand is ON the " + (kind || "card") + " at the grab frame (<= 5 cm)",
    grabResid != null ? "grip " + f3(grabResid) + " m, wrist socket " + f3(grabSock) + " m" : "never grabbed");
  check(maxStep < 0.08, "the copy follows the hand, no jump", "max " + f3(maxStep) + " m/frame");
  if (P.heightKind === "floor") check(minModelY < -0.12 && maxKnee > 0.7, "a floor take bends the knees (hips down)", "hips " + f3(minModelY) + " m, knee " + maxKnee.toFixed(2));
  if (P.heightKind === "table") check(maxLean > 0.15, "a table take leans from the waist", "lean " + maxLean.toFixed(2));
  check(Math.abs(ch.model.position.y) < 1e-6, "the rig is handed back (hips at 0)");
  check(!item.visible && !P.proxy, "the thing is gone and so is its copy");
  CBZ.scene.remove(item);
  return P;
}

fpRun("desk keycard, unarmed", false);
fpRun("desk keycard, gun out", true);
tpRun("NPC, gun on the floor 0.9 m ahead", "m", [0.25, 0.0, 0.85], "gun");
tpRun("NPC, keycard on a desk 1.2 m ahead", "m", [0.35, 0.94, 1.1]);
tpRun("NPC woman, card on the floor, close", "f", [-0.15, 0.0, 0.5]);
tpRun("player, keycard on the desk", "player", [0.3, 0.94, 0.95]);

/* ================================================================ SECOND WAVE
   10. a MOVING player is not pulled onto the thing: no step-in, no turn, a
       shorter scoop, and the take still lands exactly once;
   11. putDown (TP): the thing is hidden from the start, its copy rides the
       hand and lands EXACTLY on the rest pose on the release frame, where the
       real object reappears; onPlaced fires once; phases reach -> release ->
       withdraw -> done; the rig is handed back;
   12. putDown (FP): the release frame is the same pixels as the object;
   13. the LENS hand: with the body hidden and first person off (an inspect
       camera), the take is played on a hand under the camera;
   14. takeFrom: a reach into a corpse's pocket lands on the pocket point and
       a stand-in comes out in the hand; copy:false reaches with nothing. */
function fpHarness() {
  const cam = CBZ.camera;
  cam.position.set(0, 1.65, 0);
  cam.rotation.set(-0.55, 0, 0);
  cam.updateMatrixWorld(true);
  const H = CBZ.fpHands;
  const vmG = new THREE.Group();
  cam.add(vmG);
  vmG.position.set(0.12, -0.30, -0.66);
  const skin = new THREE.MeshLambertMaterial({ color: 0xd6a57e });
  const handR = H.makeHand(1, "relaxed", skin), handL = H.makeHand(-1, "fist", skin);
  handR.scale.setScalar(1.9); handL.scale.setScalar(1.9);
  vmG.add(handR, handL);
  const fistT = [
    { x: 0.26, y: -0.26, z: 0.04, roll: 0.95, bend: -0.2, vis: true, curl: "relaxed", hook: 0 },
    { x: -0.30, y: -0.60, z: 0.10, roll: 0.95, bend: -0.2, vis: false, curl: "fist", hook: 0 },
  ];
  const REST = Object.assign({}, fistT[0]);
  const S = new THREE.Vector3(0.30, -0.45, 0.12);
  function frame() {
    Object.assign(fistT[0], REST);
    vmx.frame(DT);
    const out = V.fpPickup(vmG, fistT, handR, handL, false);
    const T = fistT[0];
    handR.position.set(T.x, T.y, T.z);
    vmG.updateMatrix();
    const Svm = S.clone().applyMatrix4(vmG.matrix.clone().invert());
    H.orientAlong(1, handR.position.clone().sub(Svm), T.roll, T.bend, handR.quaternion);
    cam.updateMatrixWorld(true);
    return out;
  }
  return { cam, vmG, handR, frame, dispose() { cam.remove(vmG); } };
}

function movingRun() {
  console.log("\nTHIRD PERSON: player RUNNING past a gun on the floor");
  vmx.clearActors();
  const ch = CBZ.playerChar;
  CBZ.player.pos.set(0, 0, 0);
  ch.group.position.copy(CBZ.player.pos);
  ch.group.rotation.y = 0;
  CBZ.player.speed = 5.5;
  for (let i = 0; i < 10; i++) { CBZ.animChar(ch, 5.5, DT); vmx.frame(DT); }
  const item = gunProp(0.5, 0, 1.3);
  let taken = 0;
  const P = V.pickup(CBZ.player, item, { onTaken() { taken++; } });
  check(!!P && P.moving && P.stepLen === 0, "a running player takes it on the move (no step-in)");
  let maxPull = 0, frames = 0, lastGap = null;
  const yaw0 = ch.group.rotation.y;
  while (!P.done && frames < 200) {
    // the player keeps running: physics moves him 5.5 m/s along +z
    CBZ.player.pos.z += 5.5 * DT; ch.group.position.copy(CBZ.player.pos);
    const before = CBZ.player.pos.clone();
    CBZ.animChar(ch, 5.5, DT);
    vmx.frame(DT);
    maxPull = Math.max(maxPull, before.distanceTo(CBZ.player.pos));
    if (P.proxy && P.phase === "lift") {
      proxyWorld(P, _p); ch.group.updateMatrixWorld(true);
      V.pickupGripPoint(ch, P.hand, P.pose, _q);
      lastGap = _p.distanceTo(_q);
    }
    frames++;
  }
  check(lastGap != null && lastGap < 0.08, "the gun trails in to the hand (in the hand before the pocket)", lastGap != null ? f3(lastGap) + " m" : "no copy");
  check(maxPull < 1e-6, "the take never moves the running player's root", f3(maxPull) + " m");
  check(Math.abs(ch.group.rotation.y - yaw0) < 1e-6, "nor turns him off his line");
  check(taken === 1 && P.done, "the take lands once", taken);
  check(frames * DT < 0.75, "a shorter scoop on the move", (frames * DT).toFixed(2) + " s");
  CBZ.player.speed = 0;
  CBZ.scene.remove(item);
}

function putRunTP() {
  console.log("\nTHIRD PERSON: NPC puts a card DOWN on a desk");
  vmx.clearActors();
  const a = vmx.actor({ x: 0, z: 0, yaw: 0.3 });
  const ch = a.char;
  for (let i = 0; i < 20; i++) vmx.frame(DT);
  const item = card(0.35, 0.94, 1.0);
  const rest = new THREE.Box3().setFromObject(item).getCenter(new THREE.Vector3());
  let placed = 0, placedAt = -1, frame = 0, visBefore = false, lastCopy = null, maxStep = 0, prev = null;
  const P = V.putDown(a, item, null, { onPlaced() { placed++; placedAt = frame; } });
  check(!!P && P.put && !item.visible, "putDown hides the thing: it is in the hand");
  const phases = [];
  for (frame = 1; frame < 200 && !P.done; frame++) {
    vmx.frame(DT);
    if (phases[phases.length - 1] !== P.phase) phases.push(P.phase);
    if (!P.grabbed && item.visible) visBefore = true;
    if (P.proxy && !P.proxyGone) {
      proxyWorld(P, _p);
      if (prev && frame > 12) maxStep = Math.max(maxStep, _p.distanceTo(prev));
      prev = (prev || new THREE.Vector3()).copy(_p);
      lastCopy = _p.clone();
    }
  }
  if (P.done && phases[phases.length - 1] !== "done") phases.push("done");
  check(JSON.stringify(phases) === JSON.stringify(["reach", "release", "withdraw", "done"]), "phases reach -> release -> withdraw -> done", phases.join(","));
  check(placed === 1 && item.visible && !visBefore, "the real card reappears on the release frame, once", placed);
  check(lastCopy && lastCopy.distanceTo(rest) < 0.02, "the copy lands on the card's rest pose (no pop)", lastCopy ? f3(lastCopy.distanceTo(rest)) + " m" : "no copy");
  check(maxStep < 0.08, "the copy rides the hand, no jump", "max " + f3(maxStep) + " m/frame");
  check(Math.abs(ch.model.position.y) < 1e-6 && !P.proxy, "the rig is handed back, no copy left");
  CBZ.scene.remove(item);
}

function putRunFP() {
  console.log("\nFIRST PERSON: player puts a card DOWN");
  CBZ.fpsActive = () => true;
  const R = fpHarness();
  const item = card(0.12, 0.94, -0.75);
  const want = new THREE.Box3().setFromObject(item).getCenter(new THREE.Vector3()).project(R.cam);
  let placed = 0, lastNdc = null;
  const P = V.putDown(CBZ.player, item, null, { onPlaced() { placed++; } });
  check(!!P && P.fp && P.put, "a first-person put");
  for (let f = 0; f < 120 && !P.done; f++) {
    R.frame();
    if (P.proxy && !P.grabbed) { P.proxy.updateMatrixWorld(true); lastNdc = new THREE.Box3().setFromObject(P.proxy).getCenter(new THREE.Vector3()).project(R.cam); }
  }
  const dn = lastNdc ? Math.hypot(lastNdc.x - want.x, lastNdc.y - want.y) : 9;
  check(placed === 1 && item.visible, "placed once, the real card is back");
  check(dn < 0.03, "the last carried frame is on the card's own pixels", "ndc delta " + dn.toFixed(4));
  R.dispose();
  CBZ.fpsActive = () => false;
  CBZ.scene.remove(item);
}

function lensRun() {
  console.log("\nLENS: body hidden, first person off (an inspect camera)");
  const cam = CBZ.camera;
  cam.position.set(0, 1.4, 0.3);
  cam.rotation.set(-0.7, 0, 0);
  cam.updateMatrixWorld(true);
  CBZ.fpsActive = () => false;
  CBZ.playerChar.group.visible = false;
  const item = gunProp(0.05, 0.94, -0.35);
  let taken = 0, lensSeen = false, handAtGrab = null;
  const P = V.pickup(CBZ.player, item, { pose: "grip", keep: true, onTaken() { taken++; } });
  check(!!P && P.lens && P.fp, "the take goes to the lens hand");
  for (let f = 0; f < 120 && !P.done; f++) {
    vmx.frame(DT);
    V.pickupLensTick();
    const L = V.pickupLens;
    if (L.vm && L.vm.visible && L.hR.visible) lensSeen = true;
    if (P.grabbed && handAtGrab == null && L.hR) {
      L.vm.updateMatrixWorld(true);
      const g = new THREE.Vector3(-0.006, -0.033, -0.086).applyMatrix4(L.hR.matrixWorld).project(cam);
      const it = new THREE.Box3().setFromObject(item).getCenter(new THREE.Vector3());
      item.visible = true; const w = it.project(cam); item.visible = false;
      handAtGrab = Math.hypot(g.x - w.x, g.y - w.y);
    }
  }
  V.pickupLensTick();
  check(lensSeen, "the lens hand is drawn during the take");
  check(handAtGrab != null && handAtGrab < 0.12, "the lens hand is over the gun on screen at the grab", handAtGrab != null ? "ndc " + handAtGrab.toFixed(3) : "never");
  check(taken === 1 && !V.pickupLens.vm.visible, "taken once, the lens hand gone after");
  CBZ.playerChar.group.visible = true;
  CBZ.scene.remove(item);
}

function takeFromRun() {
  console.log("\nTHIRD PERSON: player goes through a corpse's pocket (takeFrom)");
  vmx.clearActors();
  const ch = CBZ.playerChar;
  CBZ.player.pos.set(0, 0, 0); ch.group.position.set(0, 0, 0); ch.group.rotation.y = 0;
  const body = vmx.actor({ x: 0.2, z: 0.75, yaw: 2.0 });
  body.dead = true;
  for (let i = 0; i < 10; i++) { CBZ.animChar(ch, 0, DT); vmx.frame(DT); }
  let taken = 0, resid = null, sawCopy = false;
  const P = V.takeFrom(CBZ.player, body, { kind: "cash", onTaken() { taken++; } });
  check(!!P, "a reach into the body is running", P && P.heightKind);
  const target = P.point.clone();
  for (let f = 0; f < 200 && !P.done; f++) {
    CBZ.animChar(ch, 0, DT);
    vmx.frame(DT);
    if (P.grabbed && resid == null) { ch.group.updateMatrixWorld(true); V.pickupGripPoint(ch, P.hand, P.pose, _p); resid = _p.distanceTo(target); }
    if (P.proxy) sawCopy = true;
  }
  check(resid != null && resid <= 0.05, "the hand is at the pocket on the grab frame", resid != null ? f3(resid) + " m" : "never");
  check(taken === 1 && sawCopy, "taken once, and a wallet comes out in the hand");
  let n2 = 0;
  const Q = V.pickup(CBZ.player, { x: 0.3, y: 0.94, z: 0.8 }, { copy: false, onTaken() { n2++; } });
  let any = false;
  for (let f = 0; f < 200 && !Q.done; f++) { CBZ.animChar(ch, 0, DT); vmx.frame(DT); if (Q.proxy) any = true; }
  check(n2 === 1 && !any, "copy:false reaches with nothing in the hand");
}

movingRun();
putRunTP();
putRunFP();
lensRun();
takeFromRun();

console.log("\nHEADLESS");
{
  let n = 0;
  const r = V.pickup({ pos: new THREE.Vector3() }, { x: 0, y: 0, z: 0 }, { onTaken() { n++; } });
  check(r === null && n === 1, "an actor with no body: the take still happens at once", n);
}
if (vmx.errors.length) { fails++; console.log("  FAIL updater errors:\n    " + vmx.errors.slice(0, 5).join("\n    ")); }
console.log(`\n${checks - fails}/${checks} checks passed` + (fails ? `, ${fails} FAILED` : ""));
process.exit(fails ? 1 : 0);
