"use strict";
/* src/battle/camera/killcam.js — NPC War: THE KILL CAM + THE CAMERA STEP.
   Owned by the camera agent (docs/npcwar/ARCHITECTURE.md). Every src/battle
   file shares ONE script scope: top-level names here are visible to the other
   battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* set in onBoot below (they need THREE / the raised world) */
let KILLCAM;

CBZ.npcwar.onBoot(function () {
  /* ============================================================ THE KILL CAM
     A TAKEDOWN IS OVER IN ABOUT A FIFTH OF A SECOND. At speed 1 an orca pod
     killing a megalodon is three frames, so the death itself slows the clock
     to a quarter and puts the lens on the body for two seconds of WALL time
     (it is direction, not battle: measured on the slowed clock it would take
     eight). It restores the speed it found.

     It refuses during a benchmark, while a person drives the camera (FREE,
     YOU), during your own death beat, and for a body off the shot or a man
     (a rifleman falling is the texture of this page; the director's own
     slow-motion beat in camera.js covers a kill on the lens). ?killcam=0. */
  KILLCAM = Q.get("killcam") !== "0";
});
const KILL = { t: 0, cool: 0, m: null, speed: 1, mode: null, shot: null, n: 0 };
function killCam(m) {
  // every death reports to the director first (camera.js: heat, the beat)
  if (cam) camKill(m);
  if (!KILLCAM || bench || over || !started) return;
  if (!m || !m.beast || KILL.t > 0 || KILL.cool > 0 || YOU.beat) return;
  if (cam.mode === "free" || cam.mode === "kill" || cam.mode === "you" || cam.mode === "youdead") return;
  if (camDist2(m.pos) > 110 * 110) return;
  if (SLOW.t > 0) { SLOW.t = 0; setSpeed(SLOW.back); }
  KILL.t = 2.1; KILL.cool = 7; KILL.n++;
  KILL.m = m; KILL.speed = speed > 0 ? speed : lastSpeed;
  KILL.mode = cam.mode; KILL.shot = cam.shot;
  setSpeed(0.25);
  cam.mode = "kill";
  const fh = m.faceH == null ? 0 : m.faceH;
  cam.wYaw = Math.atan2(Math.cos(fh), Math.sin(fh)) + 1.35;
  cam.wPitch = 0.18;
  cam.wDist = Math.max(4.5, studyRange(m) * 0.6);
  cam.wFov = cam.fov0 - 8;
  // SNAP the arm in: a beat spent flying the camera across the map is a beat
  // that photographs the journey and misses the death
  cam.wFocus.set(m.pos.x, m.pos.y + (m.eyeH || 1) * 0.4, m.pos.z);
  cam.snap = true;
  studyHold(m);
  STUDY.m = m;
}
function stepKill(dt) {
  stepSlow(dt);
  if (KILL.cool > 0) KILL.cool -= dt;
  if (KILL.t <= 0) return;
  KILL.t -= dt;
  const m = KILL.m;
  if (m) {
    // the body keeps solving under the lens: follow it down
    cam.wFocus.set(m.pos.x, m.pos.y + (m.eyeH || 1) * 0.4, m.pos.z);
    cam.wYaw += dt * 0.55;
  }
  if (KILL.t <= 0) {
    setSpeed(KILL.speed);
    cam.mode = KILL.mode || "auto";
    cam.shot = KILL.shot || "establish";
    cam.cutAt = simT;                    // and the director takes a fresh shot
    cam.wFov = cam.fov0;
    KILL.m = null;
  }
}

/* FOLLOW IS THE FRONT OF THE GROUP, ALWAYS. The lens hands over while he
   lives too, but only when the front has genuinely left him behind (twelve
   metres, on a three-second cadence). He dies, the camera holds the beat,
   then it takes the man who stepped over him. */
function frameFollow(dt) {
  const m = cam.followM;
  if (m && m.dead && cam.holdT === 0) subjectDied();
  if (!m || m.fled || (m.dead && cam.holdT <= 0)) {
    const next = subjectFor(cam.followTeam);
    if (next) { cam.followM = next; cam.holdT = 0; cam.reptT = simT + 3; }
  } else if (!m.dead && simT >= cam.reptT) {
    cam.reptT = simT + 3;
    const p = POINT[cam.followTeam];
    if (p && p !== m && !p.dead) {
      const foe = teamCOM[cam.followTeam === "red" ? "blue" : "red"];
      const dm = Math.hypot(m.pos.x - foe.x, m.pos.z - foe.z);
      const dp = Math.hypot(p.pos.x - foe.x, p.pos.z - foe.z);
      if (dm - dp > 12) cam.followM = p;
    }
  }
  const f = cam.followM;
  if (!f) return;
  const h = f.vehicle ? f.h : f.beast ? Math.atan2(Math.cos(f.heading || 0), Math.sin(f.heading || 0)) : f.yaw;
  cam.wFocus.set(f.pos.x, bodyAimY(f), f.pos.z);
  cam.wYaw = h + Math.PI + 0.35;
  cam.wPitch = 0.16;
  cam.wDist = f.beast ? Math.max(5, studyRange(f) * 0.8) : f.vehicle ? Math.max(12, bodySize(f) * 3.4) : 7.8;
  cam.wFov = cam.fov0;
  if (cam.holdT > 0) cam.holdT -= dt;
}

/* ONE CAMERA STEP A FRAME, on wall time: the posture writes its targets, the
   ease is the posture's own (a director drifts, a chase cam is on rails, free
   hands are instant), and camApply makes a lens out of them. */
function stepCamera(dt) {
  const IN = CBZ.micro.input;
  if (simT - POINT.at > 0.5) updatePoint();
  let ease = 0.002;
  if (cam.mode === "auto") {
    stepDirector(dt);
    ease = cam.ease;
  } else if (cam.mode === "follow") {
    frameFollow(dt);
  } else if (cam.mode === "kill") {
    // stepKill owns the targets this frame; nothing else may touch them
    ease = 0.01;
  } else if (cam.mode === "study") {
    frameStudy(dt);
  } else if (cam.mode === "under") {
    frameUnder(dt);
  } else if (cam.mode === "surface") {
    frameWave(dt);
  } else if (cam.mode === "you") {
    frameYou(dt);
    ease = cam.ease;
  } else if (cam.mode === "youdead") {
    frameYouBeat(dt);
    ease = 0.03;
  } else {
    // FREE: WASD pans, Q / E turn; the pointers are hud.js's
    ease = 0.0004;
    if (IN) {
      const fwd = 46 * dt * (cam.dist / 60 + 0.4);
      const mx = IN.axis("KeyA", "KeyD"), mz = IN.axis("KeyS", "KeyW");
      if (mx || mz) {
        cam.wFocus.x += (-Math.sin(cam.yaw) * mz - Math.cos(cam.yaw) * mx) * fwd;
        cam.wFocus.z += (-Math.cos(cam.yaw) * mz + Math.sin(cam.yaw) * mx) * fwd;
        cam.wFocus.y = MAP.groundAt(cam.wFocus.x, cam.wFocus.z);
      }
      const turn = IN.axis("KeyE", "KeyQ");
      if (turn) cam.wYaw += turn * dt * 1.6;
    }
    cam.wFov = cam.fov0;
  }
  cam.ease = ease;
  camApply(dt);
}
