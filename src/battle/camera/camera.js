"use strict";
/* src/battle/camera/camera.js — NPC War: THE CAMERA.
   Owned by the camera agent (docs/npcwar/ARCHITECTURE.md). Every src/battle
   file shares ONE script scope: top-level names here are visible to the other
   battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in.

   The postures (cam.mode):
     auto     THE DIRECTOR. Scores every unit for how much is happening at it
              (fights, deaths, charges, big guns firing, explosions) and cuts
              between four cinematic shots of whatever scores highest:
                hero       a close follow on one unit, over its shoulder at
                           whatever it is fighting
                charge     low and behind a unit running into the enemy,
                           tracking with it
                establish  wide and side-on to the line the armies fight on
                general    high overhead, the whole field
                tripod     a long lens on sticks, planted ahead of a hull
                           or under an aircraft: the lens stays where it
                           is and pans as the thing goes by
                round      strapped to a bomb, a rocket or a missile, all
                           the way down, then the beat on what it did
              It slows the clock for a beat on a knockout, a kill on the lens
              and an explosion near it. The operator (camera/feel.js) is
              the hand on every one of these: sway, recoil, concussion.
     follow   the front rank of one army (F, the camera button)
     study / under / surface   one animal, locked (camera/study.js)
     kill     the beast kill cam (camera/killcam.js)
     you      YOU: the chase cam on the unit you took over (player.js)
     youdead  the beat after the unit you were dies, before you hop
     free     your hands: drag to orbit, right-drag or two fingers to pan,
              wheel or pinch to zoom, two-finger twist to turn, WASD pans,
              a flick keeps gliding (hud.js owns the pointers)
     lock     one unit (a man, a tank, a plane), chased on rails: drag
              orbits it, wheel / pinch dollies, T / the arrows pick another
     fp       the same unit from inside: the soldier's eyes, the commander's
              cupola, the cockpit. Drag looks around, it drifts back.

   Every posture writes the same targets (wFocus, wYaw, wPitch, wDist, wFov)
   and camApply() turns them into a lens that never goes through a wall, the
   ground, a dune or a body. */

/* set in onBoot below (they need THREE / the raised world) */
let cam;

/* THE CAMERA HAS ITS OWN DICE. The director used to roll the battle's lcg(),
   so where the lens pointed changed who won: every cut consumed numbers the
   next round of fire would have used. Direction is not part of the battle. */
let _cs = 90217;
function crand() { _cs = (_cs * 1103515245 + 12345) & 0x7fffffff; return _cs / 0x7fffffff; }

CBZ.npcwar.onBoot(function () {
  cam = {
    mode: "auto",
    focus: V(), yaw: 0.9, pitch: 0.62, dist: 64,
    wFocus: V(), wYaw: 0.9, wPitch: 0.62, wDist: 64,
    followM: null, cutAt: 0, shot: "establish", craneSpin: 0.05,
    followTeam: "red", holdT: 0, reptT: 0,
    waveLock: false, waveY: 0.3,
    // how fast the lens chases its targets (smaller = snappier); a cut snaps
    ease: 0.002, snap: false,
    fov0: (CBZ.camera && CBZ.camera.fov) || 60, fov: 0, wFov: 0,
    side: 1, score: 0, cuts: 0, sinceWide: 0,
    // lock / fp: the unit, the viewer's orbit round it, the smoothed heading
    lockM: null, lockRel: 0.35, lockPitch: 0, lockZoom: 1, lockIdle: 9, lockH: 0, lockHM: null,
    fpYaw: 0, fpPitch: 0, fpZoom: 1, fpH: 0, fpP: 0, fpHM: null,
    hH: 0, hHM: null,
  };
  cam.fov = cam.wFov = cam.fov0;
  /* EVERY EXPLOSION REPORTS TO THE DIRECTOR. studio.boom is the one door all
     of them come through (rockets, shells, bombs, a hull going up), so the
     director listens at it rather than at five call sites. */
  const boom0 = CBZ.studio && CBZ.studio.boom;
  if (boom0 && !boom0._camTap) {
    const tap = function (at, o) {
      try { camBoom(at, o); } catch (e) {}
      return boom0.apply(this, arguments);
    };
    tap._camTap = true;
    CBZ.studio.boom = tap;
  }
});

/* ============================================================ THE LENS
   THE CAMERA DOES NOT GO THROUGH A WALL, THE GROUND, A DUNE OR A BODY.

   Walls: one segment test from the focus outward, and the arm shortens until
   the line is clear. It SNAPS in (a frame of masonry across the lens is worse
   than a jump) and eases back out.
   Ground: never below camFloor. Dunes: the eye line is lifted over a crest
   (shortening would walk the lens INTO the sand).
   Bodies: a lens inside a gorilla is a black frame, and the low tracking
   shots live at exactly the height of everything on the field. Any body the
   lens ends up inside is stepped out of, and a hull is climbed over. */
let camOccl = 1, camLift = 0;
/* HOW LOW THE LENS MAY LOOK FROM. In OPEN WATER the sea is NOT a wall, so
   the clamp goes negative exactly there (?swim=old restores the flat one). */
function pitchLo() { return (MAP && MAP.water && !SWIM_OLD) ? -1.15 : 0.04; }
const _camNear = [];
function camOutOfBodies(p) {
  // hulls first: few of them, and a lens inside one must climb, not slide
  for (let i = 0; i < men.length; i++) {
    const o = men[i];
    if (!o.vehicle || o.air || o.fled) continue;
    const rx = p.x - o.pos.x, rz = p.z - o.pos.z;
    if (Math.abs(rx) > o.vlen + 3 || Math.abs(rz) > o.vlen + 3) continue;
    const fx = Math.sin(o.h), fz = Math.cos(o.h);
    const along = rx * fx + rz * fz, across = rx * fz - rz * fx;
    if (Math.abs(along) < o.vlen + 0.7 && Math.abs(across) < o.vwid + 0.7) {
      const top = o.pos.y + (o.vheight || 2.5) + 0.9;
      if (p.y < top) p.y = top;
    }
  }
  const a = fineNear(p.x, p.z, 3.5, _camNear);
  for (let i = 0; i < a.length; i++) {
    const o = a[i];
    if (o.vehicle || o.fled || (o.dead && !o.beast)) continue;
    if (cam.mode === "you" && o === YOU.m && !o.beast) continue;   // the shoulder IS the shot
    const big = o.beast ? Math.max(o.rad || 0.5, (o.noseR || 0) * 0.8) : (o.rad || 0.45);
    const r = big + 0.38;
    const h = o.beast ? Math.max(1, (o.eyeH || 1) * 1.25) : 1.95;
    if (p.y > o.pos.y + h || p.y < o.pos.y - 0.5) continue;
    const dx = p.x - o.pos.x, dz = p.z - o.pos.z, d = Math.hypot(dx, dz);
    if (d >= r) continue;
    if (d < 0.05) { p.y = o.pos.y + h + 0.3; continue; }
    p.x = o.pos.x + dx / d * r; p.z = o.pos.z + dz / d * r;
  }
}
/* THE GLASS. A phone held upright is a 0.46 aspect: the same vertical angle
   that frames a battlefield on a laptop is a keyhole there. The vertical
   angle opens up as the screen narrows (never past 78 degrees, which is
   where a lens starts to bend the edges). */
function lensFov(v) {
  const a = window.innerWidth / Math.max(1, window.innerHeight);
  if (a >= 1.3) return v;
  const t = Math.tan(v * Math.PI / 360) * Math.pow(1.3 / Math.max(0.3, a), 0.6);
  return Math.min(78, Math.max(v, 2 * Math.atan(t) * 180 / Math.PI));
}
/* A PORTRAIT SCREEN IS NARROW: the same arm that frames a tank on a laptop
   crops it on a phone held upright, so every lens but your own hands stands
   a little further back there. */
function aspectPull() {
  const a = window.innerWidth / Math.max(1, window.innerHeight);
  return a >= 1.3 ? 1 : Math.min(1.5, Math.pow(1.3 / Math.max(0.3, a), 0.45));
}
// the director's glass: a real lens, never the arena's wide vista angle
function lensBase() { return Math.min(cam.fov0, 54); }
let _fpWas = false, _fpNear = 0.1;
const _fpE = [];
function camApply(dt) {
  dt = Math.min(dt, 0.05);              // one hitched frame must not fling the lens
  // a NaN anywhere upstream (a body with no position, a zero-length axis)
  // would poison the lens for good: the last good targets stand instead
  if (!Number.isFinite(cam.wFocus.x + cam.wFocus.y + cam.wFocus.z + cam.wYaw + cam.wPitch + cam.wDist + cam.wFov)) {
    cam.wFocus.copy(cam.focus); cam.wYaw = cam.yaw; cam.wPitch = cam.pitch; cam.wDist = cam.dist; cam.wFov = cam.fov;
  }
  // THE LENS AT WAVE HEIGHT is a property of the SHOT
  cam.waveLock = cam.mode === "surface" && SEA.on && !SWIM_OLD;
  if (cam.snap) {
    cam.snap = false;
    cam.focus.copy(cam.wFocus);
    cam.yaw = cam.wYaw; cam.pitch = cam.wPitch; cam.dist = cam.wDist;
    camOccl = 1;
  }
  const k = 1 - Math.pow(cam.ease, dt);
  if (eyeShot()) { camApplyFp(dt); return; }
  if (_fpWas) { _fpWas = false; CBZ.camera.near = _fpNear; CBZ.camera.rotation.order = "XYZ"; CBZ.camera.updateProjectionMatrix(); }
  cam.focus.lerp(cam.wFocus, k);
  let dy = cam.wYaw - cam.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  cam.yaw += dy * k;
  cam.pitch += (cam.wPitch - cam.pitch) * k;
  cam.dist += (cam.wDist - cam.dist) * k;
  const c = CBZ.camera;
  const cp = Math.max(pitchLo(), Math.min(1.42, cam.pitch));
  const sx = Math.sin(cam.yaw) * Math.cos(cp), sz = Math.cos(cam.yaw) * Math.cos(cp), sy = Math.sin(cp);
  const fy = cam.focus.y + 1.2;
  let want = 1;
  // (nothing stands between a chase plane and its subject but the subject's own wing)
  if (CBZ.micro.segmentBlocked && !(cam.mode === "auto" && cam.shot === "wing")) {
    for (let t = 0; t < 6; t++) {
      const d = cam.dist * want;
      const px = cam.focus.x + sx * d, pz = cam.focus.z + sz * d;
      let py = cam.focus.y + sy * d;
      const g = MAP.camFloor(px, pz);
      if (py < g) py = g;
      if (!CBZ.micro.segmentBlocked(cam.focus.x, fy, cam.focus.z, px, py, pz)) break;
      want *= 0.62;
      if (cam.dist * want < 1.6) { want = 1.6 / Math.max(0.001, cam.dist); break; }
    }
  }
  camOccl = want < camOccl ? want : camOccl + (want - camOccl) * Math.min(1, dt * 1.6);
  const dist = cam.dist * camOccl * (cam.mode === "free" ? 1 : aspectPull());
  const P = _camP.set(cam.focus.x + sx * dist, cam.focus.y + sy * dist, cam.focus.z + sz * dist);
  const g = MAP.camFloor(P.x, P.z);
  if (P.y < g) P.y = g;
  if (MAP.terrainTrue && !MAP.water) {
    let lift = 0;
    for (let t = 0; t < 8 && terrainBlocked(cam.focus.x, fy, cam.focus.z, P.x, P.y + lift, P.z); t++) lift += 2.2;
    camLift += (lift - camLift) * Math.min(1, lift > camLift ? dt * 6 : dt * 1.2);
    P.y += camLift;
  }
  if (cam.waveLock) P.y = swellAt(P.x, P.z) + (cam.waveY == null ? 0.3 : cam.waveY);
  else if (cam.mode !== "under") camOutOfBodies(P);
  c.position.copy(P);
  c.lookAt(cam.focus.x, fy, cam.focus.z);
  // the lens: a wider glass at speed, a longer one for a slow-motion beat
  cam.fov += (cam.wFov - cam.fov) * Math.min(1, dt * 4);
  const fv = lensFov(cam.fov) + feelFov();
  if (Math.abs(c.fov - fv) > 0.05) { c.fov = fv; c.updateProjectionMatrix(); }
  camFeel(dt);
}
/* THE EYE IS THE POSITION: first person, and the director's tripod (a lens
   on the ground looking UP at a helicopter is not an orbit; the orbit's arm
   never goes below the horizon). */
function eyeShot() {
  return cam.mode === "fp" || (cam.mode === "auto" && cam.shot === "tripod" && !!cam.tri) ||
    (cam.mode === "you" && typeof SH !== "undefined" && SH.on);        // YOU with a rifle (player.js)
}
/* FIRST PERSON is not an orbit with a short arm: the eye IS the position and
   the glass looks where the unit looks. No occlusion pass (the eye is inside
   the thing that would block it); the ground still holds it up. */
function camApplyFp(dt) {
  const c = CBZ.camera;
  if (!_fpWas) { _fpWas = true; _fpNear = c.near; c.rotation.order = "YXZ"; }
  c.near = 0.12;
  const P = cam.fpEye;
  if (!P) return;
  const g = MAP.camFloor(P.x, P.z);
  c.position.set(P.x, Math.max(P.y, g + 0.25), P.z);
  c.rotation.set(cam.fpUp, cam.fpDir + Math.PI, cam.fpRoll || 0);
  cam.fov += (cam.wFov - cam.fov) * Math.min(1, dt * 5);
  const sticks = cam.mode !== "fp";
  const fv = lensFov(cam.fov / (sticks ? 1 : cam.fpZoom)) + feelFov();
  if (Math.abs(c.fov - fv) > 0.05 || c.near !== 0.12) { c.fov = fv; c.near = 0.12; c.updateProjectionMatrix(); }
  // the rest of the page reads the focus (LOD, culling, sound): keep it with
  // the eye, or with what a long lens on sticks is looking at
  if (sticks) cam.focus.copy(cam.wFocus); else cam.focus.set(P.x, P.y - 1.2, P.z);
  camFeel(dt);
}
let _camP = null;
CBZ.npcwar.onBoot(function () { _camP = V(); });

/* ============================================================ WHERE IT IS
   THE INTEREST MAP. Things that happen are written here as they happen, with
   a weight and a time; the director reads them back as heat around a unit.
   Fire comes from shotsRing (fire.js / vehicles.js already keep it). */
const CAMEV = [];
function camEvent(kind, x, z, w, m) {
  if (CAMEV.length > 64) CAMEV.shift();
  CAMEV.push({ kind: kind, x: x, z: z, w: w, t: simT, m: m || null });
}
function heatAt(x, z, r) {
  let h = 0;
  const r2 = r * r;
  for (let i = 0; i < CAMEV.length; i++) {
    const e = CAMEV[i], age = simT - e.t;
    if (age > 9) continue;
    const dx = e.x - x, dz = e.z - z;
    if (dx * dx + dz * dz > r2) continue;
    h += e.w * Math.exp(-age / 3);
  }
  for (let i = Math.max(0, shotsRing.length - 60); i < shotsRing.length; i++) {
    const s = shotsRing[i], age = simT - s.t;
    if (age > 4) continue;
    const dx = s.x - x, dz = s.z - z;
    if (dx * dx + dz * dz > r2) continue;
    const big = s.m && (s.m.vehicle || s.m.launcher) ? 1.6 : 0.22;
    h += big * Math.exp(-age / 1.5);
  }
  return h;
}
/* THE HOTTEST FIGHT, AND IT HOLDS STILL. This used to roll the camera's dice
   on EVERY CALL for which recent shot seeds the cluster, and every wide shot
   and the swimmers' lens call it every frame: with the core flying a whole
   front's rounds (one in eight lands in shotsRing) the seed jumped kilometres
   between frames and the lens shook 5-11 m a frame in the GENERAL and
   ESTABLISH shots (tools/npcwar-camera-check.mjs). Now the densest knot of
   recent fire is found by count, not dice, at most every 1.5 s of battle,
   and the point every caller reads glides to it; a cut lands on it. */
const HOT = { x: 0, z: 0, tx: 0, tz: 0, has: false, at: -9, t: -9 };
function hotspotFind() {
  let bi = -1, bn = 0;
  for (let i = 0; i < shotsRing.length; i++) {
    const a = shotsRing[i];
    if (simT - a.t > 7) continue;
    let n = 0;
    for (let j = 0; j < shotsRing.length; j++) {
      const b = shotsRing[j];
      if (simT - b.t > 7) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      if (dx * dx + dz * dz < 46 * 46) n++;
    }
    if (n >= bn) { bn = n; bi = i; }           // ties go to the newer shot
  }
  if (bi < 0) return false;
  const seed = shotsRing[bi];
  let x = 0, z = 0, n = 0;
  for (let i = 0; i < shotsRing.length; i++) {
    const s = shotsRing[i];
    if (simT - s.t > 7) continue;
    if (Math.hypot(s.x - seed.x, s.z - seed.z) > 46) continue;
    x += s.x; z += s.z; n++;
  }
  HOT.tx = x / n; HOT.tz = z / n;
  return true;
}
function hotspot(snap) {
  if (simT - HOT.at > 1.5 || simT < HOT.at) {
    HOT.at = simT;
    if (hotspotFind() && !HOT.has) { HOT.has = true; HOT.x = HOT.tx; HOT.z = HOT.tz; HOT.t = simT; }
  }
  if (!HOT.has) return null;
  if (snap) { HOT.x = HOT.tx; HOT.z = HOT.tz; }
  else {
    const k = 1 - Math.exp(-Math.max(0, simT - HOT.t) * 0.9);
    HOT.x += (HOT.tx - HOT.x) * k; HOT.z += (HOT.tz - HOT.z) * k;
  }
  HOT.t = simT;
  return { x: HOT.x, z: HOT.z };
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
// a body's size for framing: half its length, metres
function bodySize(m) {
  if (!m) return 0.5;
  if (m.vehicle) return m.vlen || 3;
  return Math.max(0.45, m.beast ? (m.noseR || m.rad || 0.6) : 0.45);
}
// how high the lens aims above a body's feet (camApply adds 1.2)
function bodyAimY(m) {
  if (m.vehicle) return m.pos.y + (m.vheight || 2.5) * 0.7 - 1.2;
  if (m.beast) return m.pos.y + (m.eyeH || 1) * 0.65 - 1.2;
  return m.pos.y + 0.15;
}
// charging: running hard, at an enemy that is near enough to matter
function charging(m) {
  if (!m || m.dead || m.vehicle) return false;
  const t = m.tgt;
  if (!t || t.dead) return false;
  const d = Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z);
  const fast = m.beast ? m.speed > (m.tn ? m.tn.chase * 0.7 : 5) : m.speed > 5.8;
  return fast && d > 4 && d < 60;
}
function inContact(m) {
  const t = m && m.tgt;
  if (!t || t.dead || m.dead) return false;
  const d = Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z);
  return d < Math.max(5, (m.reach || 1.9) * 1.7 + bodySize(t));
}
// one unit's worth to the director, right now
function interestOf(m) {
  let s = heatAt(m.pos.x, m.pos.z, 16);
  if (inContact(m)) s += 2.6;
  if (charging(m)) s += 2.2;
  if (m.beast) s += 0.8 + Math.min(2, bodySize(m) * 0.6);
  if (m.vehicle) s += 1.2 + (simT - (m.lastShotT || -9) < 2.5 ? 2 : 0);
  // an aircraft about to let go: the next few seconds of this war are its
  if (m.air && m.runLeft != null && m.runLeft < 6 && m.runLeft > -1) s += 7;
  s += Math.min(3, (m.kills || 0) * 0.55);
  if (m.hp < m.maxHp * 0.4 && inContact(m)) s += 0.8;          // the last of him
  if (m === cam.followM) s *= 1.35;                            // the shot in hand is worth keeping
  return s;
}
/* THE DIRECTOR HAS A MEMORY. The best score on the field is usually the same
   unit it was six seconds ago (the helicopter, the tank with the kills), and
   a director that cuts from it to it has not cut: measured, six frames in a
   row of one Apache over empty sand while the battle went on behind the
   lens. A subject that has just had a full shot is tired for a while, and
   one filmed in the last half minute is worth a little less. */
const SEEN = new WeakMap();
function freshness(m) {
  if (m === cam.tired) return 0.04;                 // it just had its shot: anything else first
  const t = SEEN.get(m);
  if (t == null || simT < t) return 1;
  const age = simT - t;
  return age > 30 ? 1 : 0.3 + 0.7 * age / 30;
}
// the best subject on the field (a stride over a huge war: it is a camera)
function bestSubject() {
  const n = men.length, stride = n > 500 ? Math.ceil(n / 500) : 1;
  const off = stride > 1 ? (cam.cuts % stride) : 0;
  let best = null, bs = -1;
  for (let i = off; i < n; i += stride) {
    const m = men[i];
    if (m.dead || m.fled || m.inVeh || m._apeHeld || (m.group && !m.group.visible)) continue;
    const s = interestOf(m) * freshness(m);
    if (s > bs) { bs = s; best = m; }
  }
  cam.score = bs;
  return best;
}

/* ============================================================ THE POINT MAN
   FOLLOW rides the FRONT of an army: the living man CLOSEST TO THE ENEMY'S
   MASS who still has his own group around him (three mates inside fifteen
   metres), not the lunatic forty metres ahead of everybody. */
const POINT = { red: null, blue: null, at: -9 };
const _pc = [];
const _pn = [];
function pointMan(team) {
  const foe = teamCOM[team === "red" ? "blue" : "red"];
  _pc.length = 0;
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.dead || m.team !== team) continue;
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
    const near = fineNear(m.pos.x, m.pos.z, 15, _pn);
    let mates = 0;
    for (let k = 0; k < near.length; k++) {
      if (near[k] !== m && !near[k].dead && near[k].team === team && ++mates >= 3) break;
    }
    if (mates >= 3) return m;
  }
  return first;
}
function updatePoint() {
  POINT.red = pointMan("red");
  POINT.blue = pointMan("blue");
  POINT.at = simT;
}
function subjectFor(team) {
  const p = POINT[team];
  if (p && !p.dead && !p.fled) return p;
  updatePoint();
  return POINT[team] && !POINT[team].dead ? POINT[team] : null;
}
/* THE FIGHT AXIS: the bearing from one army's mass to the other. */
function fightAxis() {
  const a = teamCOM.red, b = teamCOM.blue;
  const dx = b.x - a.x, dz = b.z - a.z;
  if (Math.abs(dx) + Math.abs(dz) < 0.001) return 0;
  return Math.atan2(dx, dz);              // camera-yaw convention: (sin, cos)
}
// is there sky between this focus and a camera parked on this bearing?
function clearYaw(fx, fz, want, dist, spread) {
  const fy = MAP.groundAt(fx, fz) + 1.2;
  const tries = [0, spread, -spread, spread * 2, -spread * 2, Math.PI];
  for (let i = 0; i < tries.length; i++) {
    const y = want + tries[i];
    const px = fx + Math.sin(y) * dist * 0.86, pz = fz + Math.cos(y) * dist * 0.86;
    const py = Math.max(MAP.camFloor(px, pz), fy + dist * Math.sin(Math.max(0.1, cam.wPitch)));
    if (!CBZ.micro.segmentBlocked || !CBZ.micro.segmentBlocked(fx, fy, fz, px, py, pz)) return y;
  }
  return want;
}
/* THE WAR'S MIDDLE AND ITS SPREAD, AS THE LENS SEES THEM. teamCOM is
   re-counted every 0.6 s (tick.js) and a death or a rout moves it in a
   step; the wide shots read these instead, which glide (a 1.2 s time
   constant on battle time, no faster than a slow pan) and land exactly on
   a cut (warSnap). */
const WAR = { x: 0, z: 0, spread: 60, t: -9, has: false };
function warRaw() {
  const a = teamCOM.red, b = teamCOM.blue;
  const hs = hotspot();
  let x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
  if (hs) { x = x * 0.5 + hs.x * 0.5; z = z * 0.5 + hs.z * 0.5; }
  const gap = Math.hypot(b.x - a.x, b.z - a.z);
  const alive = aliveCount("red") + aliveCount("blue");
  return { x: x, z: z, spread: Math.max(30, Math.min(260, gap * 0.75 + 18 + Math.sqrt(alive) * 2.2)) };
}
function warGlide(snap) {
  if (snap) hotspot(true);
  const r = warRaw();
  if (snap || !WAR.has || simT < WAR.t) { WAR.x = r.x; WAR.z = r.z; WAR.spread = r.spread; WAR.has = true; }
  else {
    const dt = Math.max(0, simT - WAR.t), k = 1 - Math.exp(-dt / 1.2);
    let mx = (r.x - WAR.x) * k, mz = (r.z - WAR.z) * k;
    // a pan, never a swoop: at most a fifth of the frame's width a second
    const cap = WAR.spread * 0.2 * dt, mv = Math.hypot(mx, mz);
    if (mv > cap && mv > 0) { mx *= cap / mv; mz *= cap / mv; }
    WAR.x += mx; WAR.z += mz; WAR.spread += (r.spread - WAR.spread) * k;
  }
  WAR.t = simT;
}
// how far apart the war is: the arm a wide shot needs to hold all of it
function warSpread() { if (simT !== WAR.t) warGlide(false); return WAR.spread; }
function warMid() { if (simT !== WAR.t) warGlide(false); return { x: WAR.x, z: WAR.z }; }
function warSnap() { warGlide(true); }

/* ============================================================ THE DIRECTOR
   A CUT IS A DECISION. Every 0.6 s the director scores the field; it cuts
   when the shot in hand has run its length, when its subject is gone, or
   when something much bigger is happening somewhere else. Which shot it cuts
   to is the subject's situation, not a dice table:
     running at the enemy   CHARGE (low, behind, tracking)
     in contact             HERO (close, over its shoulder at the fight)
     two close shots in a row, or nothing happening   a WIDE: ESTABLISH
                            (side-on to the fight axis) or GENERAL (overhead)
   Cuts snap; inside a shot the lens moves smoothly. */
let dirScanT = 0;
function directorCut(force, round, wing) {
  const prev = cam.followM;
  // a subject that held the lens for its whole shot gives it up
  cam.tired = prev && !prev.dead && closeShot(cam.shot) && simT >= cam.cutAt ? prev : null;
  if (prev) SEEN.set(prev, simT);
  const subj = round ? null : wing || bestSubject();
  cam.tired = null;
  cam.cuts++;
  cam.anchor = null;
  cam.tri = null;
  cam.round = round || null;
  cam.side = crand() < 0.5 ? -1 : 1;
  const quiet = cam.score < 1.2;
  let shot;
  if (round) shot = "round";
  else if (wing) shot = "wing";
  else if (!subj || quiet && cam.sinceWide >= 1) shot = crand() < 0.55 ? "establish" : "general";
  else if (cam.sinceWide >= 2 && !force) shot = crand() < 0.6 ? "establish" : "general";
  else if (charging(subj)) shot = crand() < 0.25 && tripodPlace(subj) ? "tripod" : "charge";
  else if (tripodWants(subj) && tripodPlace(subj)) shot = "tripod";
  else shot = subj.air ? "wing" : "hero";
  if (round) cam.roundAt = simT;
  cam.shot = shot;
  cam.followM = closeShot(shot) ? subj : null;
  cam.sinceWide = closeShot(shot) || round ? cam.sinceWide + 1 : 0;
  cam.craneSpin = (crand() < 0.5 ? -1 : 1) * (0.012 + crand() * 0.02);
  cam.holdT = 0;
  cam.wingAt = simT;
  cam.cutAt = simT + (shot === "hero" ? 6 + crand() * 4 : shot === "round" ? 9 : shot === "wing" ? 7 + crand() * 2 : shot === "tripod" ? 5.5 + crand() * 2.5
    : shot === "charge" ? 4.5 + crand() * 2 : 4.5 + crand() * 2.5);
  cam.ease = shot === "general" || shot === "establish" ? 0.06 : 0.012;
  warSnap();
  // place the shot once, then snap to it (a cut is a cut, not a flight)
  frameDirector(0);
  const moved = Math.hypot(cam.wFocus.x - cam.focus.x, cam.wFocus.z - cam.focus.z);
  // establish to establish on the OTHER side of the axis is a cut too: eased, it
  // was a 20 m-a-frame swoop round the whole field
  if (moved > 18 || shot !== cam._lastShot || cam.followM !== prev || cam.side !== cam._lastSide) cam.snap = true;
  cam._lastShot = shot; cam._lastSide = cam.side;
}
// the shots that are ON a unit (the who card, the death beat, the kill beat)
function closeShot(s) { return s === "hero" || s === "charge" || s === "tripod" || s === "wing"; }

/* ============================================================ THE TRIPOD
   The lens does not move. It is planted on the ground AHEAD of the thing and
   off to one side, on a long glass, and it pans: the tank comes out of its
   own dust, fills the frame and goes by; the helicopter crosses the sky over
   your head. The zoom rides with the range so the subject keeps its size
   (which is what a camera operator's left hand is doing). */
function unitSpeed(m) { return Math.abs(m.vehicle ? ((m.ds && m.ds.v) || m.speed || 0) : (m.speed || 0)); }
function tripodWants(m) {
  if (!m || m.dead || m.beast) return false;
  // a jet at 250 m/s is through a planted frame in a blink: it gets the wing shot
  if (m.air) return !(m.def && m.def.drive === "jet") && crand() < 0.45;
  if (m.vehicle) return unitSpeed(m) > 2.5 && crand() < 0.55;
  return false;
}
function tripodClear(ax, ay, az, m, my) {
  if (CBZ.micro.segmentBlocked && CBZ.micro.segmentBlocked(ax, ay, az, m.pos.x, my, m.pos.z)) return false;
  if (typeof terrainBlocked === "function" && HOST.terrainLos && terrainBlocked(ax, ay, az, m.pos.x, my, m.pos.z)) return false;
  return true;
}
function tripodPlace(m) {
  const h = rawHeading(m);
  if (!Number.isFinite(h)) return false;
  const sp = unitSpeed(m), size = bodySize(m);
  const fx = Math.sin(h), fz = Math.cos(h);
  const lead = m.air ? sp * 2 : Math.min(70, sp * 2.8 + size * 1.5);
  const off = m.air ? Math.max(70, Math.min(320, sp * 1.6 + 60)) : m.vehicle ? 7 + size * 1.7 : 5.5;
  const my = m.air ? m.pos.y + (m.vheight || 3) * 0.4 : bodyAimY(m) + 1.2;
  for (let k = 0; k < 2; k++) {
    const sd = k ? -cam.side : cam.side;
    const ax = m.pos.x + fx * lead + fz * sd * off, az = m.pos.z + fz * lead - fx * sd * off;
    const ay = Math.max(MAP.camFloor(ax, az), MAP.groundAt(ax, az) + (m.air ? 1.5 : m.vehicle ? 1.0 : 0.6));
    if (!Number.isFinite(ax + ay + az) || !tripodClear(ax, ay, az, m, my)) continue;
    cam.tri = { x: ax, y: ay, z: az, fx: m.pos.x, fy: my, fz: m.pos.z, m: m,
      d0: Math.hypot(ax - m.pos.x, ay - my, az - m.pos.z),
      // how much world the frame holds top to bottom at the subject
      frame: m.air ? size * 5 : m.vehicle ? size * 3.1 : 5.2 };
    return true;
  }
  return false;
}
function frameTripod(m, dt) {
  const T = cam.tri;
  const my = m.air ? m.pos.y + (m.vheight || 3) * 0.4 : bodyAimY(m) + 1.2;
  // the operator's pan is a beat behind the thing he is panning with
  const k = dt > 0 ? 1 - Math.exp(-dt / 0.14) : 1;
  T.fx += (m.pos.x - T.fx) * k; T.fy += (my - T.fy) * k; T.fz += (m.pos.z - T.fz) * k;
  const dx = T.fx - T.x, dy = T.fy - T.y, dz = T.fz - T.z, hd = Math.hypot(dx, dz), d = Math.hypot(hd, dy) || 1;
  if (!cam.fpEye) cam.fpEye = V();
  cam.fpEye.set(T.x, T.y, T.z);
  cam.fpDir = Math.atan2(dx, dz);
  cam.fpUp = Math.max(-1.2, Math.min(1.35, Math.atan2(dy, Math.max(0.01, hd))));
  cam.fpRoll = 0;
  cam.wFov = Math.max(6, Math.min(46, 2 * Math.atan(T.frame * 0.5 / d) * 180 / Math.PI));
  if (dt === 0) cam.fov = cam.wFov;
  cam.wFocus.set(T.fx, T.fy - 1.2, T.fz);
  if (m.dead && cam.holdT === 0) { cam.holdT = 1.6; cam.cutAt = Math.max(cam.cutAt, simT + 1.6); }
  if (cam.holdT > 0) cam.holdT -= dt;
  // it has gone by and away: that was the shot
  if (dt > 0 && cam.holdT <= 0 && d > T.d0 * 2.6 + 30) cam.cutAt = Math.min(cam.cutAt, simT);
}

/* ============================================================ THE ROUND
   A bomb leaving the bay, a rocket off the rail, a missile off the wing:
   the director sees it leave (camRoundScan reads the sim's own lists; the
   sim never calls the camera, it runs without one) and, if the round has far
   enough to go to be a shot, the lens goes with it, close behind and a
   little above, the ground coming up. When it lands the lens is THERE, and
   it pulls back to show what the round did. One ride at a time and not one
   after another: a HIMARS ripple is a single shot, not six cuts. */
const CAMRND = { o: null, kind: "", by: null, at: -9 };
function camRound(o, kind, by) {
  if (!cam || !started || !o) return;
  let fly;
  if (kind === "missile") fly = (o.d0 || 0) / Math.max(50, (o.w && o.w.speed) || 300);
  else if (kind === "bomb") fly = 9;
  else fly = o.grav > 0 && o.vel ? 2 * o.vel.y / o.grav : 0;      // back down to the height it left from
  if (fly < 1.7) return;
  // the first of a salvo keeps the ride
  if (CAMRND.o && simT - CAMRND.at < 0.5 && simT >= CAMRND.at) return;
  CAMRND.o = o; CAMRND.kind = kind; CAMRND.by = by; CAMRND.at = simT;
}
const _rndSeen = new WeakSet();
function camRoundScan() {
  for (let i = rockets.length - 1; i >= 0 && i >= rockets.length - 40; i--) {
    const r = rockets[i];
    if (r.t > 0.4) break;                                 // the list is in launch order
    if (_rndSeen.has(r)) continue;
    _rndSeen.add(r);
    camRound(r, r.bomb ? "bomb" : "rocket", r.by);
  }
  // a guided round lives on its launcher; the launcher just went into the fire ring
  for (let i = shotsRing.length - 1; i >= 0 && i >= shotsRing.length - 8; i--) {
    const u = shotsRing[i].m;
    if (simT - shotsRing[i].t > 0.4) break;
    if (!u || !u.vehicle || !u.shots || !u.shots.length) continue;
    const s = u.shots[u.shots.length - 1];
    if (s.t > 0.4 || _rndSeen.has(s)) continue;
    _rndSeen.add(s);
    camRound(s, "missile", u);
  }
}
function roundAlive(R) {
  if (R.kind === "missile") return !!(R.by && R.by.shots && R.by.shots.indexOf(R.o) >= 0);
  return rockets.indexOf(R.o) >= 0;
}
function roundWanted() {
  const o = CAMRND.o;
  if (!o) return null;
  if (simT - CAMRND.at > 0.7 || simT < CAMRND.at) { CAMRND.o = null; return null; }
  if (cam.shot === "round" || cam.holdT > 0 || simT - (cam.roundAt == null ? -99 : cam.roundAt) < 14) return null;
  const R = { o: o, kind: CAMRND.kind, by: CAMRND.by, x: 0, y: 0, z: 0, hv: 0, landed: false };
  CAMRND.o = null;
  return roundAlive(R) ? R : null;
}
function frameRound(dt) {
  const R = cam.round;
  if (!R.landed && roundAlive(R)) {
    const o = R.o;
    let px, py, pz, vx, vy, vz;
    if (R.kind === "missile") {
      px = o.vp.x; py = o.vp.y; pz = o.vp.z;
      vx = px - (R.has ? R.x : o.pos.x); vy = py - (R.has ? R.y : o.pos.y); vz = pz - (R.has ? R.z : o.pos.z);
      if (Math.abs(vx) + Math.abs(vy) + Math.abs(vz) < 1e-4 && o.tgt) { vx = o.tgt.pos.x - px; vy = 0; vz = o.tgt.pos.z - pz; }
    } else { px = o.pos.x; py = o.pos.y; pz = o.pos.z; vx = o.vel.x; vy = o.vel.y; vz = o.vel.z; }
    const hs = Math.hypot(vx, vz);
    if (hs > 1e-4) {
      let hv = Math.atan2(vx, vz), d = hv - R.hv;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      R.hv = R.has && dt > 0 ? R.hv + d * Math.min(1, dt * 6) : hv;
    }
    R.x = px; R.y = py; R.z = pz; R.has = true;
    const dive = Math.atan2(-vy, Math.max(1e-3, hs));
    cam.wFocus.set(px, py - 1.2, pz);
    cam.focus.copy(cam.wFocus);                       // rails: a round does 300 m/s
    cam.wYaw = R.hv + Math.PI + cam.side * 0.2;
    cam.wPitch = Math.max(0.07, Math.min(1.1, 0.14 + dive * 0.75));
    cam.wDist = R.kind === "bomb" ? 8.5 : 6;
    cam.wFov = lensBase() + 10;
    cam.ease = 0.006;
    // a ride is a few seconds, not a flight: a long-range missile is left to arrive on its own
    if (simT - cam.roundAt < 8) cam.cutAt = Math.max(cam.cutAt, simT + 1);
    if (dt === 0) { cam.yaw = cam.wYaw; cam.pitch = cam.wPitch; cam.dist = cam.wDist; }
  } else {
    // IT LANDED. Stay, and back off far enough to see what it did.
    if (!R.landed) { R.landed = true; cam.cutAt = simT + 2.4; }
    if (!R.has) { cam.cutAt = Math.min(cam.cutAt, simT); return; }
    cam.wFocus.set(R.x, MAP.groundAt(R.x, R.z), R.z);
    cam.wPitch = 0.3; cam.wDist = 46; cam.wFov = lensBase() - 4;
    cam.ease = 0.12;
  }
}
/* ============================================================ THE WING
   AN AIRCRAFT, FILMED FROM THE AIR. The lens flies in formation with it: off
   the nose quarter and a little above to begin with, so the whole airframe is
   in the frame with the battlefield sliding by underneath, and it drifts back
   along the wing as the shot runs until it is looking over the tail at where
   the aircraft is going. When it lets a weapon go the lens watches the store
   fall away for a beat (stepDirector holds the ride back), and THEN goes with
   it. */
function frameWing(m, dt) {
  const sz = bodySize(m), h = camHeading(m, dt, 0.35);
  const jet = !!(m.def && m.def.drive === "jet");
  cam.wFocus.set(m.pos.x, m.pos.y + (m.vheight || 3) * 0.35 - 1.2, m.pos.z);
  cam.focus.copy(cam.wFocus);                         // rails: it does 250 m/s
  const age = Math.max(0, simT - (cam.wingAt || 0));
  /* How the real ones are shot (a chase plane over Death Valley, a tanker
     boom over the Gulf): from ABOVE and well off, on a long lens. The aircraft
     sits against the ground, not the sky, so you read its whole planform and
     the desert streaks past behind it; the horizon is barely in the frame.
     It opens high off the nose quarter and slides back to the tail quarter. */
  cam.wYaw = h + cam.side * Math.min(2.45, 0.85 + age * (jet ? 0.2 : 0.13));
  cam.wPitch = (jet ? 0.5 : 0.36) - Math.min(0.16, age * 0.02);
  // room for the whole span: a B-52 is 56 m across, an F-35 eleven
  cam.wDist = Math.max(sz, m.vwid || 0) * (jet ? 4.4 : 3.6) + 10;
  cam.wFov = jet ? 27 : 31;
  cam.ease = 0.03;
  if (dt === 0) { cam.yaw = cam.wYaw; cam.pitch = cam.wPitch; cam.dist = cam.wDist; }
  if (m.dead && cam.holdT === 0) { cam.holdT = 2.4; cam.cutAt = Math.max(cam.cutAt, simT + 2.4); }
  if (cam.holdT > 0) cam.holdT -= dt;
}
function frameDirector(dt) {
  const m = cam.followM;
  const shot = cam.shot;
  if (shot === "round" && cam.round) { frameRound(dt); return; }
  if (shot === "wing" && m) { frameWing(m, dt); return; }
  if (shot === "tripod" && m && cam.tri) { frameTripod(m, dt); return; }
  if ((shot === "hero" || shot === "charge") && m) {
    const sz = bodySize(m);
    /* THE MARK HOLDS. A row of the core re-picks its mark every 0.1 s step
       and the hero shot is framed on the bearing to it, so every flip swung
       the lens round the man. The shot keeps its mark until that one is
       down or gone, or he has been on another for 1.5 s. */
    let t = m.tgt && !m.tgt.dead ? m.tgt : null;
    const L = cam.mark;
    if (L && L !== t && !L.dead && !L.fled && cam.markM === m && simT < cam.markUntil) t = L;
    else if (t !== L || cam.markM !== m) { cam.mark = t; cam.markM = m; cam.markUntil = simT + 1.5; }
    else cam.markUntil = Math.max(cam.markUntil, simT + 1.5);
    const h = camHeading(m, dt, 0.45);
    if (shot === "charge") {
      // LOW AND BEHIND, the ground rushing under the lens and the enemy ahead
      const fx = Math.sin(h), fz = Math.cos(h);
      cam.wFocus.set(m.pos.x + fx * (2 + sz * 2), bodyAimY(m), m.pos.z + fz * (2 + sz * 2));
      cam.wYaw = h + Math.PI + cam.side * 0.28;
      cam.wPitch = 0.07;
      cam.wDist = 4.5 + sz * 4.2;
      cam.wFov = lensBase() + 2;
      if (!charging(m) && dt > 0) { cam.shot = "hero"; cam.cutAt = Math.max(cam.cutAt, simT + 3); }
    } else {
      // OVER ITS SHOULDER AT WHAT IT IS FIGHTING, both of them in the frame
      let bear = h;
      if (t) bear = Math.atan2(t.pos.x - m.pos.x, t.pos.z - m.pos.z);
      const mid = t && Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) < 18 ? 0.32 : 0;
      cam.wFocus.set(m.pos.x + (t ? (t.pos.x - m.pos.x) * mid : 0), bodyAimY(m),
        m.pos.z + (t ? (t.pos.z - m.pos.z) * mid : 0));
      cam.wYaw = bear + Math.PI + cam.side * 0.55;
      cam.wPitch = 0.16 + Math.min(0.12, sz * 0.03);
      cam.wDist = m.beast ? Math.max(5, studyRange(m) * 0.75) : m.vehicle ? Math.max(14, sz * 3.9) : 6.2;
      cam.wFov = lensBase() - 12;          // a long-ish glass: the background compresses behind the fight
    }
    if (m.dead && cam.holdT === 0) subjectDied();
    if (cam.holdT > 0) cam.holdT -= dt;
    return;
  }
  const mid = cam.anchor || warMid();
  const spread = cam.anchor ? Math.min(warSpread(), 70) : warSpread();
  const ax = fightAxis();
  if (shot === "general") {
    // THE GENERAL'S VIEW: high over the middle, the shape of the whole thing
    cam.wFocus.set(mid.x, MAP.groundAt(mid.x, mid.z), mid.z);
    cam.wDist = spread * 1.25;
    cam.wPitch = 1.08;
    if (dt === 0) cam.wYaw = ax + Math.PI / 2;
    else cam.wYaw += cam.craneSpin * dt * 2;
    cam.wFov = lensBase() - 6;
  } else {
    // ESTABLISHING: side-on to the fight axis, both lines in profile
    cam.wFocus.set(mid.x, MAP.groundAt(mid.x, mid.z), mid.z);
    cam.wDist = spread * 0.95;
    cam.wPitch = 0.2;
    if (dt === 0) cam.wYaw = clearYaw(mid.x, mid.z, ax + cam.side * Math.PI / 2, cam.wDist, 0.4);
    else cam.wYaw += cam.craneSpin * dt;
    cam.wFov = lensBase() - 6;
  }
}
/* A UNIT'S HEADING, LOW-PASSED. A rifleman's yaw flips the instant his mark
   changes and a tank's hull wobbles over rough ground; a lens chained to the
   raw number swings round the subject. This one follows with a time constant
   (seconds of wall time) and lands exactly on a new subject. */
function rawHeading(m) {
  return m.vehicle ? m.h : m.beast ? Math.atan2(Math.cos(m.heading || 0), Math.sin(m.heading || 0)) : m.yaw;
}
function camHeading(m, dt, tau) {
  const h = rawHeading(m);
  if (!Number.isFinite(h)) return cam.hH;
  if (cam.hHM !== m || dt <= 0) { cam.hHM = m; cam.hH = h; return h; }
  let d = h - cam.hH;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  cam.hH += d * (1 - Math.exp(-dt / tau));
  return cam.hH;
}
// the death beat: the lens STAYS on its subject a moment when it falls
function subjectDied() {
  cam.holdT = 1.6;
  cam.wPitch = 0.22;
  cam.wDist = Math.max(6, bodySize(cam.followM) * 3 + 4);
  cam.cutAt = Math.max(cam.cutAt, simT + 1.6);
}
function stepDirector(dt) {
  const subj = cam.followM;
  const close = closeShot(cam.shot);
  const gone = close && (!subj || subj.fled || (subj.dead && cam.holdT <= 0 && simT > cam.cutAt - 0.01));
  dirScanT -= dt;
  let cut = simT >= cam.cutAt || gone;
  if (!cut && dirScanT <= 0) {
    dirScanT = 0.6;
    // something much bigger elsewhere earns an early cut (never mid death beat)
    const held = simT - (cam.cutAt - 6);
    // (a ride is seen through to what the round did)
    if (held > 2.5 && cam.holdT <= 0 && cam.shot !== "round") {
      const now = subj && !subj.dead ? interestOf(subj) : 0;
      const best = bestSubject();
      if (best && best !== subj && cam.score > now * 2 + 4) cut = true;
    }
  }
  camRoundScan();
  // one ride in hand (or promised) at a time: the rest of a stick falls unfilmed
  const rd = cam.pend ? (CAMRND.o = null, null) : roundWanted();
  if (rd) {
    /* THE AIRCRAFT FIRST, THEN WHAT IT DROPPED. A round off an aircraft is
       not ridden from the instant it leaves: the lens is on (or cuts to) the
       aircraft, watches the store come off and fall away, and goes after it
       a beat later. Anything launched from the ground is ridden at once. */
    const by = rd.by && rd.by.air && !rd.by.dead ? rd.by : null;
    if (by) {
      const on = cam.shot === "wing" && cam.followM === by;
      cam.pend = { R: rd, at: simT + (on ? 1.1 : 1.7) };
      if (!on) directorCut(false, null, by);
      else cam.cutAt = Math.max(cam.cutAt, cam.pend.at + 0.1);
    } else directorCut(false, rd);
  } else if (cam.pend && simT >= cam.pend.at) {
    const R = cam.pend.R; cam.pend = null;
    if (roundAlive(R)) directorCut(false, R); else if (cut) directorCut();
  } else if (cam.pend && simT < cam.pend.at - 3) cam.pend = null;
  else if (cut && !cam.pend) directorCut();
  frameDirector(dt);
  slowmoWatch();
}

/* ============================================================ SLOW MOTION
   A BEAT, NOT A MODE. The clock goes to a fraction for under a second of
   WALL time and comes back to exactly what it was. The director asks for
   one on a knockout, a kill on the lens and an explosion near it; YOU get a
   hit-stop on every kill you make. Tools (probe=1) see none of it unless
   they ask (?slowmo=1), because a battle check measures the battle. */
const SLOW = { t: 0, k: 1, back: 1, cool: 0, n: 0 };
let SLOWMO_ON = true;
CBZ.npcwar.onBoot(function () {
  SLOWMO_ON = Q.get("slowmo") === "1" || (Q.get("slowmo") !== "0" && !PROBE);
});
function camSlow(k, secs, cool, force) {
  if (bench || over || !started || speed === 0) return false;
  if (force && SLOW.t > 0) { SLOW.t = 0; setSpeed(SLOW.back); }
  if (KILL.t > 0 || (SLOW.cool > 0 && !force) || SLOW.t > 0) return false;
  SLOW.back = speed; SLOW.k = k; SLOW.t = secs; SLOW.cool = cool == null ? 5 : cool; SLOW.n++;
  setSpeed(Math.min(speed, k));
  cam.wFov = Math.min(cam.wFov, cam.fov0 - 6);
  return true;
}
function stepSlow(rdt) {
  if (SLOW.cool > 0) SLOW.cool -= rdt;
  if (SLOW.t <= 0) return;
  SLOW.t -= rdt;
  if (SLOW.t <= 0) { if (speed !== 0) setSpeed(SLOW.back); }
}
// the director's triggers: a knockout or a kill under the lens
let _slowSubjKo = false;
function slowmoWatch() {
  if (!SLOWMO_ON) return;
  const m = cam.followM;
  if (!m || !closeShot(cam.shot)) { _slowSubjKo = false; return; }
  const t = m.tgt;
  const ko = !!(t && !t.dead && knockedDown(t));
  if (ko && !_slowSubjKo) camSlow(0.3, 0.75, 5);
  _slowSubjKo = ko;
}
// a death: the director's beat if it was on the lens (killMan -> killCam)
function camKill(m) {
  if (!m) return;
  camEvent("kill", m.pos.x, m.pos.z, m.vehicle ? 9 : m.beast ? 5 : 2.5, m);
  if (!SLOWMO_ON || cam.mode !== "auto") return;
  const f = cam.followM;
  const onLens = m === f || (f && f.tgt === m) ||
    (Math.hypot(m.pos.x - cam.focus.x, m.pos.z - cam.focus.z) < 12 && closeShot(cam.shot));
  if (onLens) camSlow(0.28, 0.9, 6);
}
// an explosion: heat for the director, a kick for the lens, a beat if close
function camBoom(at, o) {
  if (!at || !started || !cam) return;
  // the munition's own size when the round names one (weapons/munitiontable.js)
  const mf = o && o.mun && CBZ.munitionTable ? CBZ.munitionTable.fx(o.mun) : null;
  const pw = (mf && mf.power) || (o && o.power) || 1, rad = (mf && mf.R) || (o && o.radius) || 5;
  camEvent("boom", at.x, at.z, 4 + pw * 3 + rad * 0.3, null);
  const d = Math.sqrt(camDist2(at));
  // the kick is the pressure wave's, and it lands when sound would (camera/feel.js)
  feelBoom(at, pw, rad);
  if (SLOWMO_ON && cam.mode === "auto" && pw >= 1.3 && Math.hypot(at.x - cam.focus.x, at.z - cam.focus.z) < 45) camSlow(0.32, 0.8, 7);
}

/* ============================================================ THE CHASE CAM
   YOU, from behind. Your look is the camera's yaw (1:1, no lag on a mouse);
   the arm, the height and the glass are the body's:
     a man        over the right shoulder (centred with bare hands), 3.5 m,
                  2.8 m in a fist fight, wider when the mark is far
     an animal    back by its own length, the glass wider in a sprint
     a vehicle    over the hull; when you are working the gun the lens rides
                  the TURRET, so you watch it traverse onto the mark
   With a fight in reach the frame leans toward the mark so both bodies are
   in it. A hit you take kicks the lens (player.js), and camApply keeps it
   out of walls, sand and bodies. */
function frameChase(u, dt) {
  const t = YOU.tgt && !YOU.tgt.dead ? YOU.tgt : null;
  const td = t ? Math.hypot(t.pos.x - u.pos.x, t.pos.z - u.pos.z) : 99;
  let look = YOU.yaw, dist, fy, side = 0, fov = cam.fov0, pitch = YOU.pitch;
  if (u.vehicle) {
    const tr = u.def && u.def.turret;
    const gun = !!tr && (simT - YOU.fireAt < 1.8 || !!(t && td < youRange(u)));
    YOU.gunK += ((gun ? 1 : 0) - YOU.gunK) * Math.min(1, dt * 3);
    if (tr && YOU.gunK > 0.01) {
      let d = (u.h + u.tur.yaw) - look;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      look += d * YOU.gunK;
    }
    fy = u.pos.y + (u.vheight || 2.5) + (u.air ? 2 : 1.2);
    dist = Math.max(9, (u.vlen || 3) * 2.6) * (1 - YOU.gunK * 0.12);
    pitch = Math.max(0.12, pitch);
    fov += Math.min(10, Math.abs((u.ds && u.ds.v) || 0) * 0.45);
  } else if (u.beast) {
    const sz = bodySize(u), tn = u.tn || { march: 3, chase: 7 };
    fy = u.pos.y + (u.eyeH || 1) * 0.95 + 0.3;
    dist = Math.max(3.6, sz * 3.1 + 2.4);
    const run = Math.max(0, Math.min(1, (u.speed - tn.march) / Math.max(1, tn.chase - tn.march)));
    fov += run * 12;
    dist *= 1 - run * 0.08;
    if (t && td < (u.reach || 2) * 2.4 + bodySize(t)) dist *= 0.82;
    else if (t && td > 20) dist *= 1.12;
  } else {
    const low = u.stance === "crouch";
    fy = u.pos.y + (low ? 0.02 : 0.4) + 1.2;
    const melee = t && td < 3.6;
    dist = melee ? 2.8 : u.fists ? 3.2 : (t && td > 30 ? 3.9 : 3.5);
    side = u.fists || melee ? 0.22 : 0.55;
    fov += Math.max(0, Math.min(9, (u.speed - 4.4) * 4));
  }
  // a fight in reach: lean the frame onto it
  let fx = u.pos.x, fz = u.pos.z;
  const near = t && !u.vehicle && td < (u.beast ? (u.reach || 2) * 2.4 + bodySize(t) : 3.6);
  if (near) {
    fx += (t.pos.x - u.pos.x) * 0.3; fz += (t.pos.z - u.pos.z) * 0.3;
    const want = Math.atan2(t.pos.x - u.pos.x, t.pos.z - u.pos.z);
    let d = want - look;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) < 1.3) look += d * 0.35;
  }
  // the right shoulder: (-cos, +sin) of the look is screen-right
  fx -= Math.cos(look) * side; fz += Math.sin(look) * side;
  cam.wFocus.set(fx, fy - 1.2, fz);
  cam.wYaw = look + Math.PI;
  cam.wPitch = pitch;
  cam.wDist = dist;
  cam.wFov = fov;
  cam.followM = u;
  if (YOU.blendT > 0) {
    // the swoop in: eased for half a second, then on rails
    YOU.blendT -= dt;
    cam.ease = 0.004;
  } else {
    cam.focus.copy(cam.wFocus);
    cam.yaw = cam.wYaw; cam.pitch = cam.wPitch;
    cam.ease = 0.0015;
  }
}

/* ============================================================ LOCK + FIRST PERSON
   ONE UNIT, CHOSEN BY YOU. The director picks for you; this is for when you
   want the Abrams, the Apache, the sergeant. LOCK chases it on rails (the
   focus IS the unit, so nothing drifts off the frame at 100 m/s); the glass
   eases. Your orbit round it is stored relative to its smoothed heading, so a
   tank that turns carries the lens with it and a drag stays where you left it.
   FP sits inside it: the eyes of a soldier, the commander's hatch of a tank,
   the cockpit of a plane. ] and [ are the study desk's; T / Shift+T (and the
   two arrows on screen) walk this roster. */
function lockRoster() {
  const L = [];
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.dead || m.fled || m.inVeh || m._apeHeld || (m.group && !m.group.visible)) continue;
    // machines, beasts and anyone who has been in a fight: the men worth riding
    if (m.vehicle || m.beast || (m.kills || 0) > 0 || m === cam.lockM) L.push(m);
  }
  return L;
}
function lockPick(dir) {
  const L = lockRoster();
  if (!L.length) return null;
  const rank = function (m) { return (m.vehicle ? (m.air ? 0 : 1) : m.beast ? 2 : 3) * 1e6 + men.indexOf(m); };
  L.sort(function (a, b) { return rank(a) - rank(b); });
  const i = L.indexOf(cam.lockM);
  if (i < 0 || !dir) {
    // first pick: what the lens was on, else the machine nearest the fight
    const f = cam.followM && !cam.followM.dead ? cam.followM : null;
    if (f && L.indexOf(f) >= 0) return f;
    const hs = hotspot() || warMid();
    let best = null, bd = 1e18;
    for (let k = 0; k < L.length; k++) {
      const d = Math.hypot(L[k].pos.x - hs.x, L[k].pos.z - hs.z) - (L[k].vehicle ? 80 : 0);
      if (d < bd) { bd = d; best = L[k]; }
    }
    return best;
  }
  return L[(i + (dir > 0 ? 1 : L.length - 1)) % L.length];
}
function lockTo(m) {
  cam.lockM = m;
  cam.followM = m;
  cam.lockHM = null; cam.fpHM = null;
  // an aircraft is looked at from off its nose (from behind it is a shot of sand)
  cam.lockRel = (m && m.air ? Math.PI - 0.95 : 0.35) * (crand() < 0.5 ? -1 : 1);
  cam.lockPitch = 0; cam.holdT = 0; cam.deadSeen = false;
  cam.fpYaw = cam.fpPitch = 0;
  cam.snap = true;
}
function lockStep(dir) {
  const m = lockPick(dir);
  if (m) lockTo(m);
  return m;
}
// a unit's heading with a time constant; lands exactly on a new subject
function lockSmooth(m, key, dt, tau) {
  const h = rawHeading(m);
  if (!Number.isFinite(h)) return cam[key];
  if (cam[key + "M"] !== m || dt <= 0) { cam[key + "M"] = m; cam[key] = h; return h; }
  let d = h - cam[key];
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  cam[key] += d * (1 - Math.exp(-dt / tau));
  return cam[key];
}
function lockAlive(dt) {
  let m = cam.lockM;
  if (m && (m.fled || m.inVeh)) m = null;
  if (m && m.dead) {
    // the beat on the body, then the next machine
    if (!cam.deadSeen) { cam.deadSeen = true; cam.holdT = 1.8; }
    cam.holdT -= dt;
    if (cam.holdT > 0) return m;
    m = null;
  }
  if (!m) {
    m = lockPick(0);
    if (m && m !== cam.lockM) lockTo(m);
    else if (!m) { setCamMode("auto"); return null; }
  }
  return m;
}
function frameLock(dt) {
  const m = lockAlive(dt);
  if (!m) return;
  const h = lockSmooth(m, "lockH", dt, m.vehicle ? 0.5 : 0.8);
  const sz = bodySize(m);
  const base = m.beast ? Math.max(5, studyRange(m) * 0.8) : m.vehicle ? Math.max(m.air ? 16 : 11, sz * 3.2) : 4.6;
  cam.wFocus.set(m.pos.x, bodyAimY(m), m.pos.z);
  cam.wYaw = h + Math.PI + cam.lockRel;
  cam.wPitch = Math.max(pitchLo(), Math.min(1.42, (m.air ? 0.14 : m.vehicle ? 0.2 : 0.15) + cam.lockPitch));
  cam.wDist = base * cam.lockZoom;
  cam.wFov = lensBase() - (m.vehicle ? 6 : 2);
  cam.followM = m;
  cam.focus.copy(cam.wFocus);               // rails on the unit; the angles and the arm ease
}
// a drag in LOCK / FP (pixels): the orbit round the unit, or a look round the cockpit
function lockLook(dx, dy) {
  if (cam.mode === "fp") {
    cam.fpYaw -= dx * 0.0042 / cam.fpZoom;
    cam.fpPitch = Math.max(-1.2, Math.min(1.2, cam.fpPitch + dy * 0.0035 / cam.fpZoom));
    cam.fpIdle = 0;
  } else {
    cam.lockRel -= dx * 0.0052;
    cam.lockPitch = Math.max(-0.7, Math.min(1.2, cam.lockPitch + dy * 0.004));
  }
}
function lockZoom(k) {      // k > 1 = away; in FP that is a wider glass back to 1
  if (cam.mode === "fp") cam.fpZoom = Math.max(1, Math.min(5, cam.fpZoom / k));
  else cam.lockZoom = Math.max(0.15, Math.min(8, cam.lockZoom * k));
}
function frameFp(dt) {
  const m = lockAlive(dt);
  if (!m) return;
  cam.fpIdle = (cam.fpIdle == null ? 9 : cam.fpIdle) + dt;
  // looking around is a glance: it drifts home after a couple of seconds
  if (cam.fpIdle > 2.2) {
    const r = Math.exp(-dt / 0.7);
    cam.fpYaw *= r; cam.fpPitch *= r;
  }
  let ex, ey, ez, yaw, up = 0, roll = 0;
  if (m.air && m.group) {
    // the cockpit: forward and up in the airframe, looking where the nose does
    const E = _fpE;
    if (!E.length) E.push(new THREE.Quaternion(), new THREE.Euler());
    m.group.updateMatrixWorld();
    m.group.getWorldQuaternion(E[0]);
    E[1].setFromQuaternion(E[0], "YXZ");
    const fl = (m.vlen || 8) * 0.3;
    ex = m.pos.x + Math.sin(E[1].y) * fl; ez = m.pos.z + Math.cos(E[1].y) * fl;
    ey = m.pos.y + (m.vheight || 3) * 0.55 - Math.sin(E[1].x) * fl;
    yaw = E[1].y; up = -E[1].x; roll = -E[1].z * 0.6;
  } else if (m.vehicle) {
    // the commander's hatch; the glass follows the turret when there is one
    const h = lockSmooth(m, "fpH", dt, 0.12);
    const turret = !!(m.def && m.def.turret && m.tur);
    const back = (m.vlen || 3) * 0.12;
    ex = m.pos.x - Math.sin(h) * back; ez = m.pos.z - Math.cos(h) * back;
    ey = m.pos.y + (m.vheight || 2.5) + 0.35;
    yaw = turret ? h + m.tur.yaw : h;
    up = turret ? Math.max(-0.3, Math.min(0.5, m.tur.elev || 0)) : 0;
  } else if (m.beast) {
    const h = lockSmooth(m, "fpH", dt, 0.18);
    const r = bodySize(m) * 0.9;
    ex = m.pos.x + Math.sin(h) * r; ez = m.pos.z + Math.cos(h) * r;
    ey = m.pos.y + (m.eyeH || 1) * 0.95;
    yaw = h;
  } else {
    // a soldier's eyes: his yaw, tipped onto the mark he is shooting at
    const h = lockSmooth(m, "fpH", dt, 0.1);
    const low = m.stance === "crouch" || m.stance === "prone";
    ex = m.pos.x + Math.sin(h) * 0.16; ez = m.pos.z + Math.cos(h) * 0.16;
    ey = m.pos.y + (m.stance === "prone" ? 0.35 : low ? 1.1 : 1.62);
    yaw = h;
    const t = m.tgt && !m.tgt.dead ? m.tgt : null;
    if (t) {
      const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.5 && d < 120) up = Math.max(-0.5, Math.min(0.5, Math.atan2(bodyAimY(t) + 1.2 + (t.vehicle ? 0.3 : 0.5) - ey, d)));
    }
  }
  if (!Number.isFinite(ex + ey + ez + yaw + up)) return;
  if (!cam.fpEye) cam.fpEye = V();
  cam.fpEye.set(ex, ey, ez);
  cam.fpDir = yaw + cam.fpYaw;
  cam.fpUp = Math.max(-1.3, Math.min(1.3, up + cam.fpPitch));
  cam.fpRoll = roll;
  cam.wFov = lensBase() + 4;
  cam.followM = m;
}
