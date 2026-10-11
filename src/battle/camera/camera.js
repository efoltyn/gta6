"use strict";
/* src/battle/camera/camera.js — NPC War: CAMERA + THE POINT MAN.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* set in onBoot below (they need THREE / the raised world) */
let cam;

CBZ.npcwar.onBoot(function () {
  /* ============================================================ CAMERA
     Three postures. FREE: drag orbits, wheel zooms, WASD pans. FOLLOW: over
     the shoulder of whoever is doing the shooting. AUTO: a director that
     cuts between crane shots and shoulders wherever the fire is. Any manual
     input takes the camera back. */
  cam = {
    mode: "auto",
    focus: V(), yaw: 0.9, pitch: 0.62, dist: 64,
    wFocus: V(), wYaw: 0.9, wPitch: 0.62, wDist: 64,
    followM: null, cutAt: 0, shot: "crane", craneSpin: 0.05,
    followTeam: "red", holdT: 0, reptT: 0,
    waveLock: false, waveY: 0.3,
  };
});
/* THE CAMERA DOES NOT GO THROUGH A WALL.

   On sand and in the kill box the only thing between the lens and the fight
   was air, so the orbit arm never had to ask. Put the same director in the
   real downtown and it parks inside the Exchange Bank every other cut —
   measured, the first city capture of this wave is a screenshot of an
   office interior with a battle somewhere outside it.

   One segment test from the focus outward, and the arm shortens until the
   line is clear. It SNAPS in (a frame of masonry across the lens is worse
   than a jump) and eases back out, which is the ordinary third-person
   answer and the reason a pillar does not make the shot pump. */
let camOccl = 1, camLift = 0;
/* HOW LOW THE LENS MAY LOOK FROM. Everywhere else the ground is opaque, so a
   camera below its own focus is a camera inside a hill and the arm has always
   been clamped to +0.12 rad. In OPEN WATER the sea is NOT a wall — the shot
   that shows a shark best is the one taken from under it, looking up at a
   bright surface — so the clamp goes negative exactly there and nowhere else.
   (?swim=old restores the flat clamp with everything else in that wave.) */
function pitchLo() { return (MAP && MAP.water && !SWIM_OLD) ? -1.15 : 0.12; }
function camApply(dt) {
  // THE LENS AT WAVE HEIGHT is a property of the SHOT, so it is read here
  // rather than written by three different framing functions that would each
  // have to remember to clear it.
  cam.waveLock = cam.mode === "surface" && SEA.on && !SWIM_OLD;
  const k = 1 - Math.pow(0.002, dt);
  cam.focus.lerp(cam.wFocus, k);
  cam.yaw += (cam.wYaw - cam.yaw) * k;
  cam.pitch += (cam.wPitch - cam.pitch) * k;
  cam.dist += (cam.wDist - cam.dist) * k;
  const c = CBZ.camera;
  const cp = Math.max(pitchLo(), Math.min(1.42, cam.pitch));
  const sx = Math.sin(cam.yaw) * Math.cos(cp), sz = Math.cos(cam.yaw) * Math.cos(cp), sy = Math.sin(cp);
  const fy = cam.focus.y + 1.2;
  let want = 1;
  if (CBZ.micro.segmentBlocked) {
    for (let t = 0; t < 6; t++) {
      const d = cam.dist * want;
      const px = cam.focus.x + sx * d, pz = cam.focus.z + sz * d;
      let py = cam.focus.y + sy * d;
      const g = MAP.camFloor(px, pz);
      if (py < g) py = g;
      if (!CBZ.micro.segmentBlocked(cam.focus.x, fy, cam.focus.z, px, py, pz)) break;
      want *= 0.62;
      if (cam.dist * want < 2.6) { want = 2.6 / Math.max(0.001, cam.dist); break; }
    }
  }
  camOccl = want < camOccl ? want : camOccl + (want - camOccl) * Math.min(1, dt * 1.6);
  const dist = cam.dist * camOccl;
  const x = cam.focus.x + sx * dist, z = cam.focus.z + sz * dist;
  let y = cam.focus.y + sy * dist;
  const g = MAP.camFloor(x, z);
  if (y < g) y = g;
  /* A DUNE IS A WALL THE COLLIDERS DO NOT KNOW ABOUT. The low framings on
     the erg can park the lens behind a crest, looking at a face of sand with
     the war on the other side of it. The arm is not shortened (that would
     walk the lens INTO the crest); it is lifted until the eye line clears,
     eased like the occlusion above so the shot rises rather than pops. */
  if (MAP.terrainTrue && !MAP.water) {
    let lift = 0;
    for (let t = 0; t < 8 && terrainBlocked(cam.focus.x, fy, cam.focus.z, x, y + lift, z); t++) lift += 2.2;
    camLift += (lift - camLift) * Math.min(1, lift > camLift ? dt * 6 : dt * 1.2);
    y += camLift;
  }
  /* AND THE ONE SHOT WHOSE HEIGHT IS NOT THE ARM'S TO DECIDE. A lens riding
     the swell has to be ON the swell — at the water under ITSELF, not at the
     water under the animal it is watching — so the crests between the two
     rise past the glass and a dorsal fin cuts the frame at eye level. It is
     the same swellAt() every body in the sea floats on, read one more time. */
  if (cam.waveLock) y = swellAt(x, z) + (cam.waveY == null ? 0.3 : cam.waveY);
  c.position.set(x, y, z);
  c.lookAt(cam.focus.x, fy, cam.focus.z);
}
function hotspot() {
  if (!shotsRing.length) return null;
  const seed = shotsRing[(lcg() * shotsRing.length) | 0];
  let x = 0, z = 0, n = 0;
  for (let i = 0; i < shotsRing.length; i++) {
    const s = shotsRing[i];
    if (simT - s.t > 7) continue;
    if (Math.hypot(s.x - seed.x, s.z - seed.z) > 46) continue;
    x += s.x; z += s.z; n++;
  }
  return n ? { x: x / n, z: z / n } : { x: seed.x, z: seed.z };
}
function hottestMan() {
  let best = null, bt = -1e9;
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.dead || m.lastShotT < bt) continue;
    bt = m.lastShotT; best = m;
  }
  return best;
}
/* ============================================================ THE POINT MAN
   THE CAMERA WAS RIDING THE BACK OF THE ARMY.

   "Whoever shot last" sounds like the action and is not: with five hundred
   men firing, the most recent trigger pull is a coin toss across the whole
   line, and because a column's REAR ranks have the clearest lanes past
   their own mates, the coin landed behind the army more often than in front
   of it. You watched shoulders and backpacks while the war happened three
   hundred metres up the street.

   The front of the group is a different man and a better one: he is the one
   in contact, he is the one being shot at, and he is the one who is about to
   die — which is exactly why the shot is worth taking. He is found as the
   living man CLOSEST TO THE ENEMY'S MASS, with one guard that matters: he
   must have his own group around him. Without it the pick is always the
   lunatic who broke ranks and sprinted forty metres ahead of everybody —
   the front of NOTHING, alone in a street, the least interesting man alive.
   So the deepest dozen are ranked, and the first one with mates at his
   shoulder takes the lens. */
const POINT = { red: null, blue: null, at: -9 };
const _pc = [];
const _pn = [];
function pointMan(team) {
  const foe = teamCOM[team === "red" ? "blue" : "red"];
  _pc.length = 0;
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.dead || m.team !== team) continue;
    // depth INTO the enemy, plus a nudge for a man who is actually in a
    // fight — at equal depth the engaged man is the one to watch
    const d = Math.hypot(m.pos.x - foe.x, m.pos.z - foe.z) - (m.tgt && !m.tgt.dead ? 5 : 0);
    _pc.push(m, d);
  }
  if (!_pc.length) return null;
  let first = null;
  for (let pass = 0; pass < 12; pass++) {
    let bi = -1, bd = 1e18;
    for (let i = 0; i < _pc.length; i += 2) {
      if (_pc[i] && _pc[i + 1] < bd) { bd = _pc[i + 1]; bi = i; }
    }
    if (bi < 0) break;
    const m = _pc[bi];
    _pc[bi] = null;
    if (!first) first = m;
    // does he have his group with him? three mates inside fifteen metres is
    // a spearhead; nobody inside fifteen metres is a man who has run away
    const near = fineNear(m.pos.x, m.pos.z, 15, _pn);
    let mates = 0;
    for (let k = 0; k < near.length; k++) {
      if (near[k] !== m && !near[k].dead && near[k].team === team && ++mates >= 3) break;
    }
    if (mates >= 3) return m;
  }
  return first;               // a squad of two left: the deepest IS the front
}
function updatePoint() {
  POINT.red = pointMan("red");
  POINT.blue = pointMan("blue");
  POINT.at = simT;
}
// who the lens should be on for a team: its point man, and never a corpse
// (except for the death beat the director deliberately holds — see below)
function subjectFor(team) {
  const p = POINT[team];
  if (p && !p.dead && !p.fled) return p;
  updatePoint();
  return POINT[team] && !POINT[team].dead ? POINT[team] : null;
}
/* THE FIGHT AXIS: the bearing from one army's mass to the other. Every shot
   below is framed off it, which is the whole difference between this
   director and the one that rolled `lcg() * 2PI` for its yaw and pointed the
   lens at a car park half the time. */
function fightAxis() {
  const a = teamCOM.red, b = teamCOM.blue;
  const dx = b.x - a.x, dz = b.z - a.z;
  if (Math.abs(dx) + Math.abs(dz) < 0.001) return 0;
  return Math.atan2(dx, dz);              // camera-yaw convention: (sin, cos)
}
// is there sky between this focus and a camera parked on this bearing? The
// arm-shortening in camApply saves a shot that is BLOCKED; it cannot save a
// shot that is blocked in every direction because nobody checked before
// committing. Four candidate bearings, one segment test each, per cut.
function clearYaw(fx, fz, want, dist, spread) {
  const fy = MAP.groundAt(fx, fz) + 1.2;
  const tries = [0, spread, -spread, spread * 2, -spread * 2, Math.PI];
  for (let i = 0; i < tries.length; i++) {
    const y = want + tries[i];
    const px = fx + Math.sin(y) * dist * 0.86, pz = fz + Math.cos(y) * dist * 0.86;
    const py = Math.max(MAP.camFloor(px, pz), fy + dist * 0.4);
    if (!CBZ.micro.segmentBlocked || !CBZ.micro.segmentBlocked(fx, fy, fz, px, py, pz)) return y;
  }
  return want;
}
/* THE SHOT DECK. Four framings, all of them ABOUT something:
     point — over the point man's shoulder, looking where he is looking,
             which is at the men trying to kill him. The default, and the
             one the death beat belongs to.
     push  — planted in front of the advancing front rank, looking back
             INTO it: the shot that makes five hundred men read as five
             hundred men instead of a texture.
     line  — broadside of the contact, across the fight axis, both armies
             in frame trading fire.
     crane — high and wide down the axis, for the shape of the whole thing.
   Weights favour the point man because he is where the war is. */
function directorCut() {
  const alive = aliveCount("red") + aliveCount("blue");
  const r = lcg();
  const subjTeam = lcg() < 0.5 ? "red" : "blue";
  const subj = subjectFor(subjTeam) || subjectFor(subjTeam === "red" ? "blue" : "red");
  cam.shot = !subj ? "crane" : r < 0.5 ? "point" : r < 0.7 ? "push" : r < 0.88 ? "line" : "crane";
  cam.followM = subj;
  cam.craneSpin = (lcg() < 0.5 ? -1 : 1) * (0.02 + lcg() * 0.035);
  // a good shot is held; a wide is a punctuation mark
  cam.cutAt = simT + (cam.shot === "point" ? 8 + lcg() * 5 : 5 + lcg() * 3);
  const ax = fightAxis();
  if (cam.shot === "line" || cam.shot === "crane") {
    const hs = (subj ? { x: subj.pos.x, z: subj.pos.z } : hotspot()) || { x: MAP.cx, z: MAP.cz };
    cam.wFocus.set(hs.x, MAP.groundAt(hs.x, hs.z), hs.z);
    if (cam.shot === "line") {
      // across the axis: both firing lines in profile
      cam.wDist = 18 + Math.min(40, Math.sqrt(alive) * 3.0);
      cam.wPitch = 0.1 + lcg() * 0.14;
      cam.wYaw = clearYaw(hs.x, hs.z, ax + (lcg() < 0.5 ? 1 : -1) * Math.PI / 2, cam.wDist, 0.5);
    } else {
      cam.wDist = 38 + Math.min(95, Math.sqrt(alive) * 5.5);
      cam.wPitch = 0.34 + lcg() * 0.24;
      cam.wYaw = clearYaw(hs.x, hs.z, ax + Math.PI + (lcg() - 0.5) * 0.8, cam.wDist, 0.6);
    }
  }
}
// the death beat: when the man on the lens goes down, the camera STAYS on
// him for a moment. He is the point man — watching him fall IS the shot, and
// cutting away on the frame he dies is throwing away the only moment the
// whole follow was built to catch.
function subjectDied() {
  cam.holdT = 1.5;
  cam.wPitch = 0.22;
  cam.wDist = 7.5;
}
function frameSubject(m, dt) {
  cam.wFocus.set(m.pos.x, m.pos.y, m.pos.z);
  if (cam.shot === "push") {
    // ahead of him, walking backwards as the army comes on
    cam.wYaw = m.yaw + (lcg() - 0.5) * 0.02;
    cam.wPitch = 0.12; cam.wDist = 11;
  } else {
    cam.wYaw = m.yaw + Math.PI + 0.35;
    cam.wPitch = 0.16; cam.wDist = 7.8;
  }
  if (cam.holdT > 0) cam.holdT -= dt;
}
