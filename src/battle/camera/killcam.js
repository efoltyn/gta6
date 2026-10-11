"use strict";
/* src/battle/camera/killcam.js — NPC War: THE KILL CAM.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* set in onBoot below (they need THREE / the raised world) */
let KILLCAM;

CBZ.npcwar.onBoot(function () {
  /* ============================================================ THE KILL CAM
     A TAKEDOWN IS OVER IN ABOUT A FIFTH OF A SECOND.

     creature_combat's strike lands, quadruped_ragdoll takes the body, and at
     SPEED 1 the whole event is three frames — which is exactly why "eight
     orcas kill a megalodon" reads as a health bar emptying rather than as a
     kill. The page already owns a sim clock that can go to a quarter and a
     camera that can be pointed at a body; the kill cam is those two things
     fired by the death itself.

     WALL-CLOCKED, NOT SIM-CLOCKED, and that is not a detail: this is a piece
     of DIRECTION, not part of the battle, so a two-second beat measured on the
     clock it just slowed would take eight seconds to play. It restores the
     speed it found, never the dial's default.

     It refuses in three situations, all of them for the same reason — the shot
     would be a lie or a cost:
       · during a benchmark (the benchmark exists to report frames, and an
         unannounced camera cut and a speed change are two variables in it);
       · while a person is driving the camera by hand (FREE means free);
       · for a body that is not in the shot, or a man (a rifleman falling is
         the ordinary texture of this page; a 15 m animal going down is not).
     ?killcam=0 is the revert. */
  KILLCAM = Q.get("killcam") !== "0";
});
const KILL = { t: 0, cool: 0, m: null, speed: 1, mode: null, shot: null, n: 0 };
function killCam(m) {
  if (!KILLCAM || bench || over || !started) return;
  if (!m || !m.beast || KILL.t > 0 || KILL.cool > 0) return;
  if (cam.mode === "free" || cam.mode === "kill" || cam.mode === "you") return;
  if (camDist2(m.pos) > 110 * 110) return;
  KILL.t = 2.1; KILL.cool = 7; KILL.n++;
  KILL.m = m; KILL.speed = speed > 0 ? speed : lastSpeed;
  KILL.mode = cam.mode; KILL.shot = cam.shot;
  setSpeed(0.25);
  cam.mode = "kill";
  cam.wYaw = (m.faceH == null ? 0 : m.faceH) + 1.35;
  cam.wPitch = 0.18;
  cam.wDist = Math.max(4.5, studyRange(m) * 0.6);
  // SNAP the arm in rather than easing: a two-second beat spent flying the
  // camera across the map from wherever the director was is a beat that
  // photographs the journey and misses the death.
  cam.dist = cam.wDist; cam.yaw = cam.wYaw; cam.pitch = cam.wPitch;
  cam.wFocus.set(m.pos.x, m.pos.y + (m.eyeH || 1) * 0.4, m.pos.z);
  cam.focus.copy(cam.wFocus);
  studyHold(m);
  STUDY.m = m;
}
function stepKill(dt) {
  if (KILL.cool > 0) KILL.cool -= dt;
  if (KILL.t <= 0) return;
  KILL.t -= dt;
  const m = KILL.m;
  if (m) {
    // the body keeps solving under the lens — follow it down
    cam.wFocus.set(m.pos.x, m.pos.y + (m.eyeH || 1) * 0.4, m.pos.z);
    cam.wYaw += dt * 0.55;
  }
  if (KILL.t <= 0) {
    setSpeed(KILL.speed);
    cam.mode = KILL.mode || "auto";
    cam.shot = KILL.shot || "crane";
    cam.cutAt = simT;                    // and the director takes a fresh shot
    KILL.m = null;
  }
}

function stepCamera(dt) {
  const IN = CBZ.micro.input;
  if (simT - POINT.at > 0.5) updatePoint();
  if (cam.mode === "auto") {
    const subj = cam.followM;
    const subjGone = (cam.shot === "point" || cam.shot === "push") &&
      (!subj || subj.fled || (subj.dead && cam.holdT <= 0));
    if (subj && subj.dead && cam.holdT === 0) subjectDied();
    if (simT >= cam.cutAt || subjGone) directorCut();
    if ((cam.shot === "point" || cam.shot === "push") && cam.followM) frameSubject(cam.followM, dt);
    else cam.wYaw += cam.craneSpin * dt * 8;
  } else if (cam.mode === "follow") {
    /* FOLLOW IS THE FRONT OF THE GROUP, ALWAYS — and "always" is the word
       the first build got wrong. Latching onto the point man once and
       riding him until he died measured at frontness 0.55 over a 150-a-side
       city fight: the man the camera picked at the start of the advance was
       mid-pack by the time the armies met, because the FRONT MOVED and the
       camera did not. Half the army was ahead of the lens, which is the
       original complaint wearing a new hat.

       So the lens also hands over while he lives — but only when the front
       has genuinely left him behind (twelve metres, on a three-second
       cadence), never on the metre-to-metre jostle of a firing line. He
       dies, the camera holds the beat, then it takes the man who stepped
       over him. */
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
    if (cam.followM) frameSubject(cam.followM, dt);
  } else if (cam.mode === "kill") {
    // stepKill owns the targets this frame; nothing else may touch them
  } else if (cam.mode === "study") {
    frameStudy(dt);
  } else if (cam.mode === "under") {
    frameUnder(dt);
  } else if (cam.mode === "surface") {
    frameWave(dt);
  } else if (cam.mode === "you") {
    frameYou(dt);
  } else if (IN) {
    const fwd = 46 * dt * (cam.dist / 60 + 0.4);
    const mx = IN.axis("KeyA", "KeyD"), mz = IN.axis("KeyS", "KeyW");
    if (mx || mz) {
      cam.wFocus.x += (-Math.sin(cam.yaw) * mz - Math.cos(cam.yaw) * mx) * fwd;
      cam.wFocus.z += (-Math.cos(cam.yaw) * mz + Math.sin(cam.yaw) * mx) * fwd;
      cam.wFocus.y = MAP.groundAt(cam.wFocus.x, cam.wFocus.z);
    }
  }
  camApply(dt);
}
