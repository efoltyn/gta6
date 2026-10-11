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
              It slows the clock for a beat on a knockout, a kill on the lens
              and an explosion near it.
     follow   the front rank of one army (F, the camera button)
     study / under / surface   one animal, locked (camera/study.js)
     kill     the beast kill cam (camera/killcam.js)
     you      YOU: the chase cam on the unit you took over (player.js)
     youdead  the beat after the unit you were dies, before you hop
     free     your hands: drag to orbit, right-drag or two fingers to pan,
              wheel or pinch to zoom, WASD pans (hud.js owns the pointers)

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
function camApply(dt) {
  // THE LENS AT WAVE HEIGHT is a property of the SHOT
  cam.waveLock = cam.mode === "surface" && SEA.on && !SWIM_OLD;
  if (cam.snap) {
    cam.snap = false;
    cam.focus.copy(cam.wFocus);
    cam.yaw = cam.wYaw; cam.pitch = cam.wPitch; cam.dist = cam.wDist;
    camOccl = 1;
  }
  const k = 1 - Math.pow(cam.ease, dt);
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
  if (CBZ.micro.segmentBlocked) {
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
  const dist = cam.dist * camOccl;
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
  if (Math.abs(c.fov - cam.fov) > 0.05) { c.fov = cam.fov; c.updateProjectionMatrix(); }
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
function hotspot() {
  if (!shotsRing.length) return null;
  const seed = shotsRing[(crand() * shotsRing.length) | 0];
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
  s += Math.min(3, (m.kills || 0) * 0.55);
  if (m.hp < m.maxHp * 0.4 && inContact(m)) s += 0.8;          // the last of him
  if (m === cam.followM) s *= 1.35;                            // the shot in hand is worth keeping
  return s;
}
// the best subject on the field (a stride over a huge war: it is a camera)
function bestSubject() {
  const n = men.length, stride = n > 500 ? Math.ceil(n / 500) : 1;
  const off = stride > 1 ? (cam.cuts % stride) : 0;
  let best = null, bs = -1;
  for (let i = off; i < n; i += stride) {
    const m = men[i];
    if (m.dead || m.fled || m.inVeh || m._apeHeld || (m.group && !m.group.visible)) continue;
    const s = interestOf(m);
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
// how far apart the war is: the arm a wide shot needs to hold all of it
function warSpread() {
  const a = teamCOM.red, b = teamCOM.blue;
  const gap = Math.hypot(b.x - a.x, b.z - a.z);
  const alive = aliveCount("red") + aliveCount("blue");
  return Math.max(30, Math.min(260, gap * 0.75 + 18 + Math.sqrt(alive) * 2.2));
}
function warMid() {
  const a = teamCOM.red, b = teamCOM.blue;
  const hs = hotspot();
  let x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
  if (hs) { x = x * 0.5 + hs.x * 0.5; z = z * 0.5 + hs.z * 0.5; }
  return { x: x, z: z };
}

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
function directorCut(force) {
  const subj = bestSubject();
  const prev = cam.followM;
  cam.cuts++;
  cam.anchor = null;
  const quiet = cam.score < 1.2;
  let shot;
  if (!subj || quiet && cam.sinceWide >= 1) shot = crand() < 0.55 ? "establish" : "general";
  else if (cam.sinceWide >= 2 && !force) shot = crand() < 0.6 ? "establish" : "general";
  else if (charging(subj)) shot = "charge";
  else shot = "hero";
  cam.shot = shot;
  cam.followM = shot === "hero" || shot === "charge" ? subj : null;
  cam.sinceWide = shot === "hero" || shot === "charge" ? cam.sinceWide + 1 : 0;
  cam.side = crand() < 0.5 ? -1 : 1;
  cam.craneSpin = (crand() < 0.5 ? -1 : 1) * (0.012 + crand() * 0.02);
  cam.holdT = 0;
  cam.cutAt = simT + (shot === "hero" ? 6 + crand() * 4 : shot === "charge" ? 4.5 + crand() * 2 : 4.5 + crand() * 2.5);
  cam.ease = shot === "general" || shot === "establish" ? 0.06 : 0.012;
  // place the shot once, then snap to it (a cut is a cut, not a flight)
  frameDirector(0);
  const moved = Math.hypot(cam.wFocus.x - cam.focus.x, cam.wFocus.z - cam.focus.z);
  if (moved > 18 || shot !== cam._lastShot || cam.followM !== prev) cam.snap = true;
  cam._lastShot = shot;
}
function frameDirector(dt) {
  const m = cam.followM;
  const shot = cam.shot;
  if ((shot === "hero" || shot === "charge") && m) {
    const sz = bodySize(m);
    const t = m.tgt && !m.tgt.dead ? m.tgt : null;
    const h = m.vehicle ? m.h : m.beast ? Math.atan2(Math.cos(m.heading || 0), Math.sin(m.heading || 0)) : m.yaw;
    if (shot === "charge") {
      // LOW AND BEHIND, the ground rushing under the lens and the enemy ahead
      const fx = Math.sin(h), fz = Math.cos(h);
      cam.wFocus.set(m.pos.x + fx * (2 + sz * 2), bodyAimY(m), m.pos.z + fz * (2 + sz * 2));
      cam.wYaw = h + Math.PI + cam.side * 0.28;
      cam.wPitch = 0.07;
      cam.wDist = 4.5 + sz * 4.2;
      cam.wFov = cam.fov0 + 10;
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
      cam.wDist = m.beast ? Math.max(5, studyRange(m) * 0.75) : m.vehicle ? Math.max(12, sz * 3.4) : 6.2;
      cam.wFov = cam.fov0 - 4;
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
    cam.wFov = cam.fov0;
  } else {
    // ESTABLISHING: side-on to the fight axis, both lines in profile
    cam.wFocus.set(mid.x, MAP.groundAt(mid.x, mid.z), mid.z);
    cam.wDist = spread * 0.95;
    cam.wPitch = 0.2;
    if (dt === 0) cam.wYaw = clearYaw(mid.x, mid.z, ax + cam.side * Math.PI / 2, cam.wDist, 0.4);
    else cam.wYaw += cam.craneSpin * dt;
    cam.wFov = cam.fov0;
  }
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
  const close = cam.shot === "hero" || cam.shot === "charge";
  const gone = close && (!subj || subj.fled || (subj.dead && cam.holdT <= 0 && simT > cam.cutAt - 0.01));
  dirScanT -= dt;
  let cut = simT >= cam.cutAt || gone;
  if (!cut && dirScanT <= 0) {
    dirScanT = 0.6;
    // something much bigger elsewhere earns an early cut (never mid death beat)
    const held = simT - (cam.cutAt - 6);
    if (held > 2.5 && cam.holdT <= 0) {
      const now = subj && !subj.dead ? interestOf(subj) : 0;
      const best = bestSubject();
      if (best && best !== subj && cam.score > now * 2 + 4) cut = true;
    }
  }
  if (cut) directorCut();
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
  if (!m || (cam.shot !== "hero" && cam.shot !== "charge")) { _slowSubjKo = false; return; }
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
    (Math.hypot(m.pos.x - cam.focus.x, m.pos.z - cam.focus.z) < 12 && (cam.shot === "hero" || cam.shot === "charge"));
  if (onLens) camSlow(0.28, 0.9, 6);
}
// an explosion: heat for the director, a kick for the lens, a beat if close
function camBoom(at, o) {
  if (!at || !started || !cam) return;
  const pw = (o && o.power) || 1, rad = (o && o.radius) || 5;
  camEvent("boom", at.x, at.z, 4 + pw * 3 + rad * 0.3, null);
  const d = Math.sqrt(camDist2(at));
  if (CBZ.shake && d < 160) CBZ.shake(Math.min(1.6, (pw * 0.6 + rad * 0.05) * (1 - d / 160) * 1.6));
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
