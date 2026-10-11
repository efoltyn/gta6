"use strict";
/* src/battle/camera/study.js — NPC War: THE STUDY DESK.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ THE STUDY DESK
   AN ARENA YOU CANNOT STAND STILL IN IS NOT A TEST BED.

   The owner's brief for OPEN WATER was "a lightweight test arena, great for
   animation" — and every camera this page had was built for the opposite
   job. AUTO cuts every eight seconds by design, FOLLOW rides a rifleman's
   shoulder, FREE is a pair of hands. None of them will hold one shark in
   frame long enough to watch a single tail beat finish, which is the only
   thing an animation test bed is for.

   So: three more postures, each of them ABOUT one body or about the water it
   is in, and none of them ever cuts.

     study    LOCKED ON ONE ANIMAL, orbiting it at a range taken off the
              BODY'S OWN measured length — noseR, the half-length this page
              already measures off the bounding box at spawn — so a sardine
              and a megalodon fill the same fraction of the frame and you
              never have to touch the wheel. [ and ] walk the roster. With
              the sim clock at a quarter (key 5) and the frame step (.), that
              is the whole test bed the brief asked for.
     under    THE SEAT NOBODY HAD. Below the swell looking UP, the animal a
              silhouette against a bright surface. This shot was not merely
              missing, it was IMPOSSIBLE: the arm's pitch clamped at +0.12
              rad, so the lens could never get below the thing it was
              pointing at. See pitchLo().
     surface  THE LENS AT WAVE HEIGHT — y is the swell itself, at the
              camera's own position, so crests roll between you and the fish
              and a dorsal fin cuts the frame at eye level.

   STUDY.m is a REFERENCE to a live body, so it can go stale exactly once (a
   corpse), and every framing function revalidates before it reads. */
const STUDY = { m: null, idx: 0, orbit: 0.9, spin: 0.28 };
function studyList() {
  const out = [];
  for (let i = 0; i < men.length; i++) if (!men[i].dead && men[i].beast) out.push(men[i]);
  // a battle with no animals in it still deserves a locked lens
  if (!out.length) for (let i = 0; i < men.length; i++) if (!men[i].dead) out.push(men[i]);
  return out;
}
// no argument: the BIGGEST thing alive, because that is what you came to
// look at and because it is stable across two runs of the same war.
// +/-1: walk the roster from wherever the lens already was.
function studyPick(delta) {
  const list = studyList();
  if (!list.length) { STUDY.m = null; return null; }
  if (delta == null) {
    let bi = 0;
    for (let i = 1; i < list.length; i++) {
      if ((list[i].noseR || list[i].rad || 0) > (list[bi].noseR || list[bi].rad || 0)) bi = i;
    }
    STUDY.idx = bi;
  } else {
    const cur = STUDY.m ? list.indexOf(STUDY.m) : -1;
    const from = cur >= 0 ? cur : STUDY.idx;
    STUDY.idx = ((from + delta) % list.length + list.length) % list.length;
  }
  STUDY.m = list[STUDY.idx];
  return STUDY.m;
}
// a tool asks for a body by species id or by index; a person never does
function studyPickBy(sel) {
  const list = studyList();
  if (!list.length) { STUDY.m = null; return null; }
  let idx = -1;
  if (typeof sel === "number") idx = ((sel | 0) % list.length + list.length) % list.length;
  else if (typeof sel === "string") {
    for (let i = 0; i < list.length; i++) {
      if (list[i].beast && list[i].species && list[i].species.id === sel) { idx = i; break; }
    }
    if (idx < 0) return studyPick(null);
  }
  if (idx < 0) return studyPick(null);
  STUDY.idx = idx; STUDY.m = list[idx];
  return STUDY.m;
}
/* HOW FAR BACK THE LENS SITS, and it is the body that answers. A constant
   distance is the reason a shot of a sardine and a shot of a megalodon are
   the same picture of nothing: 2.4 body lengths puts the whole animal in
   frame with room for the water it is moving through, at 0.6 m and at 18 m
   alike. Bounded so a bait fish is not photographed from inside its own gills
   and a whale is not photographed from orbit. */
function studyRange(m) {
  const len = Math.max(0.6, (m.noseR || m.rad || 0.5) * 2);
  return Math.max(3.2, Math.min(140, len * 2.4 + 1.5));
}
function studyBody() {
  let m = STUDY.m;
  if (!m || m.dead) m = studyPick(null);
  return m;
}
function studyHold(m) {
  cam.followM = m;              // the card names whatever the lens is on
  cam.shot = "study";
}
function frameStudy(dt) {
  const m = studyBody();
  if (!m) { cam.wFocus.set(MAP.cx, MAP.groundAt(MAP.cx, MAP.cz), MAP.cz); cam.wDist = 60; return; }
  STUDY.orbit += STUDY.spin * dt;
  cam.wFocus.set(m.pos.x, m.pos.y + (m.eyeH || 1) * 0.3, m.pos.z);
  cam.wYaw = (m.faceH == null ? 0 : m.faceH) + STUDY.orbit;
  cam.wPitch = 0.22;
  cam.wDist = studyRange(m);
  studyHold(m);
}
function frameUnder(dt) {
  const m = studyBody();
  STUDY.orbit += STUDY.spin * 0.5 * dt;
  const hs = m ? { x: m.pos.x, z: m.pos.z } : (hotspot() || { x: MAP.cx, z: MAP.cz });
  const y = m ? m.pos.y
    : (MAP.water ? swellAt(hs.x, hs.z) - 3 : MAP.groundAt(hs.x, hs.z) + 1);
  cam.wFocus.set(hs.x, y, hs.z);
  cam.wYaw = STUDY.orbit;
  cam.wPitch = -0.46;                       // below the body, looking up at it
  cam.wDist = m ? Math.max(7, studyRange(m) * 0.85) : 26;
  studyHold(m);
}
function frameWave(dt) {
  const m = studyBody();
  STUDY.orbit += STUDY.spin * 0.4 * dt;
  const hs = m ? { x: m.pos.x, z: m.pos.z } : (hotspot() || { x: MAP.cx, z: MAP.cz });
  cam.wFocus.set(hs.x, MAP.water ? swellAt(hs.x, hs.z) : MAP.groundAt(hs.x, hs.z) + 0.6, hs.z);
  cam.wYaw = STUDY.orbit;
  cam.wPitch = 0.02;                        // dead level: the horizon is the shot
  cam.wDist = m ? Math.max(9, studyRange(m) * 1.15) : 30;
  studyHold(m);
}
