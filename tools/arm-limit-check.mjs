#!/usr/bin/env node
/* tools/arm-limit-check.mjs — DO THE ARMS STAY ARMS? (shoulder, elbow, wrist)

   Owner (iPad): "when the player's holding the phone, their arm looks really
   stupid. It contorts weirdly." The third-person phone hold solved the upper
   arm horizontal across the chest (shoulder z +87 deg); a ped's call put the
   hand 47 cm out from the ear. entities/character.js now gives every arm
   joint a range (CBZ.human.armLimits, THE ARMS HAVE A RANGE) and holds the
   phone with the body's own measures (CBZ.human.phoneHold).

   Plain node, the REAL rig + poses + verbs (tools/lib/verbs-vm.mjs):
     1. DRAWN: across the animChar states (idle, walk, run, hands up, cuffed,
        aiming, seated, typing, carrying, riding, skydiving, prone) and the
        phone holds, every arm's drawn shoulder / elbow / wrist (what the
        joint's matrix composes) is in range — the elbow never bends
        backward, never past 150, the upper arm never across the chest.
     2. STORED: the phone holds write in-range rotations themselves.
     3. THE PHONE READS AS A PHONE: at the ear the wrist sits under the ear
        lobe on its own side, the elbow forward of the shoulder and below the
        hand; reading, the elbow hangs at the side below the shoulder, the
        hand is in front of the chest and the glass faces the eyes; filming,
        the hand is in front of the face. Man, woman, teen.
     4. The old chicken wing (charArmTo to the old chest point) is drawn in
        range.

     node tools/arm-limit-check.mjs        exit 0 = ok */
import { loadVerbsVM } from "./lib/verbs-vm.mjs";

const vmx = loadVerbsVM({ mode: "survival" });
const { CBZ, THREE: T } = vmx;
const H = CBZ.human, L = H.armLimits, D = 180 / Math.PI;
let fails = 0, checks = 0;
function check(ok, msg) { checks++; if (!ok) { fails++; console.log("  FAIL " + msg); } }

// the DRAWN angles: decompose each joint's composed matrix into a stand-in rig
const _p = new T.Vector3(), _s = new T.Vector3();
function drawnRig(ch, arm) {
  const part = ch.parts[arm === "l" ? "la" : "ra"], low = part.userData.low, cap = part.userData.cap;
  const q = (o) => { o.updateMatrix(); const out = new T.Quaternion(); o.matrix.decompose(_p, out, _s); return out; };
  return { parts: { [arm === "l" ? "la" : "ra"]: { position: part.position, quaternion: q(part),
    userData: { low: { quaternion: q(low) }, cap: cap ? { quaternion: q(cap), userData: cap.userData } : null } } } };
}
function inRange(ch, arm, drawn) {
  const r = H.armInRange(drawn ? drawnRig(ch, arm) : ch, arm, 2e-3);
  return r === true ? null : r.join(",");
}

/* 1. every state, both arms, drawn */
const states = {
  idle: {}, walk: { speed: 3 }, run: { speed: 8 }, handsUp: { handsUp: true }, surrender: { surrender: true }, cuffed: { cuffed: true },
  aim: { aimingPose: true }, aimLong: { aimingPose: true, aimLong: true }, sitting: { sitting: true },
  typing: { typing: true, sitting: true }, carry: { carryPose: true }, riding: { riding: true },
  skydiving: { skydiving: true }, prone: { pronePose: true },
};
let storedOut = 0;
for (const [tag, o] of Object.entries(states)) {
  vmx.clearActors();
  const a = vmx.actor({});
  for (const k in o) if (k !== "speed") a.char[k] = o[k];
  vmx.setSpeed(a, o.speed || 0);
  let bad = null;
  for (let i = 0; i < 90 && !bad; i++) {
    vmx.frame(1 / 60);
    for (const arm of ["l", "r"]) { const b = inRange(a.char, arm, true); if (b) { bad = arm + " " + b + " @" + i; break; } if (inRange(a.char, arm, false)) storedOut++; }
  }
  check(!bad, "state " + tag + ": drawn arm out of range: " + bad);
}

/* 2-3. the phone holds */
function L3(ch, o, p) { return ch.body.worldToLocal(o.localToWorld(p ? p.clone() : new T.Vector3())); }
for (const spec of [{ build: "m" }, { build: "f" }, { build: "m", age: 15 }, { build: "m", physique: "heavy" }]) {
  vmx.clearActors();
  const a = vmx.actor(Object.assign({ yaw: 0.9, x: 2, z: -3 }, spec));
  const ch = a.char, tag = spec.build + (spec.age ? spec.age : "") + (spec.physique || "");
  vmx.frame(1 / 60);
  const ra = ch.parts.ra, low = ra.userData.low, cap = ra.userData.cap, P = ch.profile;
  const l1 = -low.position.y;
  for (const mode of ["ear", "read", "film"]) {
    const res = H.phoneHold(ch, mode, { arm: "r" });
    if (mode === "film") H.phoneHold(ch, mode, { arm: "l", support: true });
    ch.group.updateMatrixWorld(true);
    check(res != null && res < 0.02, tag + " " + mode + ": the wrist lands (residual " + (res == null ? "null" : res.toFixed(3)) + ")");
    for (const arm of mode === "film" ? ["r", "l"] : ["r"]) {
      check(!inRange(ch, arm, false), tag + " " + mode + " " + arm + ": stored arm in range: " + inRange(ch, arm, false));
      check(!inRange(ch, arm, true), tag + " " + mode + " " + arm + ": drawn arm in range: " + inRange(ch, arm, true));
    }
    const S = L3(ch, ra), E = L3(ch, low), W = L3(ch, cap), hk = P.headSize / 0.6;
    const eye = L3(ch, ch.neck, new T.Vector3(0, 0.34 * hk, 0.302 * hk));
    const palm = L3(ch, cap, new T.Vector3(0, -0.1, 0)).sub(W).normalize();
    const A = H.armAngles(ch, "r");
    if (mode === "ear") {
      const lb = CBZ.charHeadLandmarks(ch).lobe;
      const lobe = L3(ch, ch.neck, new T.Vector3(-Math.abs(lb[0]), lb[1], lb[2]));
      const off = W.clone().sub(lobe);
      check(off.y < -0.12 * hk && off.y > -0.36 * hk && Math.abs(off.x) < 0.12 * hk && off.z > 0 && off.z < 0.25 * hk,
        tag + " ear: the wrist under the lobe on its own side (" + off.toArray().map((v) => v.toFixed(2)) + ")");
      check(E.z > S.z + 0.15 && E.y < W.y && E.y < S.y + 0.6 * l1, tag + " ear: elbow forward of the shoulder and below the hand");
      check(A.flex > 1.9, tag + " ear: elbow folded (" + (A.flex * D).toFixed(0) + " deg)");
      check(palm.x * (ra.position.x >= 0 ? -1 : 1) > 0.5, tag + " ear: palm to the cheek");
    } else if (mode === "read") {
      check(E.y < S.y - 0.75 * l1 && Math.abs(E.x - S.x) < 0.3 * l1, tag + " read: elbow hangs at the side");
      check(W.z > 0.2 && W.y > E.y && W.y < S.y, tag + " read: the hand in front of the chest, above the elbow");
      check(palm.dot(eye.clone().sub(W).normalize()) > 0.8, tag + " read: glass to the eyes");
      check((ch.neck.userData.tiltX || 0) > 0.2, tag + " read: chin down");
    } else {
      check(W.z > eye.z && W.y > S.y, tag + " film: the phone up in front of the face");
    }
    // the handset seated in the palm rides the hand
    const prop = new T.Group();
    H.phoneSeat(ch, prop, { arm: "r" });
    check(prop.parent === cap, tag + " " + mode + ": handset in the palm");
    cap.remove(prop);
    H.phoneHold.release(ch, "r"); H.phoneHold.release(ch, "l");
    check(!(ch.neck.userData.tiltX) && !ch._phoneHold, tag + " " + mode + ": release lets go");
  }
}

/* 3b. every held pose in the shared registry (entities/poses.js): stored and
   drawn in range, no arm inside the body, the hands where the job is */
for (const pose of Object.keys(CBZ.charPoses || {})) {
  vmx.clearActors();
  const a = vmx.actor({});
  a.char.pose = pose;
  let jump = 0, prev = null;
  for (let i = 0; i < 100; i++) {
    vmx.frame(1 / 60);
    a.char.group.updateMatrixWorld(true);
    const c = CBZ.charArmTo.crease(a.char, "r", new T.Vector3());
    if (prev && i > 40) jump = Math.max(jump, c.distanceTo(prev));
    prev = c;
  }
  const ch = a.char;
  for (const arm of ["l", "r"]) {
    check(!inRange(ch, arm, false) && !inRange(ch, arm, true), "pose " + pose + " " + arm + ": in range " + (inRange(ch, arm, false) || ""));
    check(CBZ.charArmTo.armPen(ch, arm) < 0.01, "pose " + pose + " " + arm + ": the arm stays out of the body (" + CBZ.charArmTo.armPen(ch, arm).toFixed(3) + ")");
  }
  check(jump < 0.03, "pose " + pose + ": the hand moves smoothly (" + (jump * 100).toFixed(1) + " cm/frame)");
  const W = ch.body.worldToLocal(CBZ.charArmTo.crease(ch, "r", new T.Vector3())), S = ch.torsoShape;
  if (pose === "table" || pose === "deal" || pose === "handsOnTable" || pose === "croupier" || pose === "dealer")
    check(W.y < S.shoulderY - 0.30 && W.z > S.D, pose + ": the hands at the table / counter, not at the chest (" + W.toArray().map((v) => v.toFixed(2)) + ")");
  if (pose === "foldarms") check(W.y < S.shoulderY - 0.15 && Math.abs(W.x) < S.AX - 0.15, "foldarms: the forearms across the ribs, not at the chin (" + W.toArray().map((v) => v.toFixed(2)) + ")");
}

/* 4. the old chicken wing is drawn in range */
{
  vmx.clearActors();
  const a = vmx.actor({});
  vmx.frame(1 / 60);
  CBZ.charArmTo(a.char, new T.Vector3(-0.16, 1.28, 0.30), "r", 1);
  const st = H.armAngles(a.char, "r");
  check(st.out < -0.9, "the old phone target still throws the stored arm across the chest (out " + st.out.toFixed(2) + ") — the clamp is what this proves");
  check(!inRange(a.char, "r", true), "the old chicken wing is DRAWN in range: " + inRange(a.char, "r", true));
}

console.log((fails ? "FAIL" : "ok") + "  arm-limit-check: " + (checks - fails) + "/" + checks + " (stored out-of-range samples in animChar states, informational: " + storedOut + ")");
process.exit(fails ? 1 : 0);
