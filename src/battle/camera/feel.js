"use strict";
/* src/battle/camera/feel.js — NPC War: THE OPERATOR.

   camera.js decides where the lens is and what it looks at. This file is the
   person holding it. A war filmed by a tripod on a dolly reads as a diagram;
   the same war filmed by somebody who is THERE reads as footage:

     the hand      a held camera is never still. Two slow octaves on the aim
                   and a little roll, sized by the shot: a shoulder rig running
                   behind a charge moves most, a long lens on sticks hardly at
                   all, your own hands (FREE, YOU) not at all.
     the gun       the unit on the lens fires and the frame takes it: a rifle
                   is a tick, a 120 mm is a shove and a breath of wider glass.
                   From inside (first person) it is the weapon in your shoulder.
     the blast     an explosion does not shake the camera when it happens. It
                   shakes it when the pressure wave ARRIVES, at 340 m/s: the
                   flash at 300 m is silent for most of a second, then the
                   frame jumps, away from the blast. That gap is the thing war
                   footage has and games do not.
     the ride      first person in a moving hull rumbles with the tracks, a
                   helicopter buzzes with the rotor, a running man's head bobs.

   None of it is state: camApply() builds the lens from scratch every frame
   and camFeel() tilts and nudges what it built, so nothing drifts, the
   director's numbers stay clean and FREE gets exactly the frame you asked
   for. It has its own dice (never the battle's lcg, never the director's
   crand: feel must not change who wins or where the cuts land).

   ?feel=0 turns it off; a tool's page (probe=1) has it off unless ?feel=1;
   "reduce motion" in the OS turns it off. */
let FEEL_ON = true;
const FEEL = {
  t: 0, amp: 0,                       // the hand: wall clock and its eased size
  // damped springs: aim (pitch, yaw, roll, radians) and the body (metres)
  p: 0, vp: 0, y: 0, vy: 0, r: 0, vr: 0,
  x: 0, vx: 0, h: 0, vh: 0, z: 0, vz: 0,
  fov: 0,                             // the glass opening on a concussion, degrees
  shotM: null, shotT: -9,             // the subject's last trigger pull we answered
  gait: 0, ride: 0,
  q: [],                              // pressure waves on their way to the lens
};
let _feelSeed = 4177;
function frand() { _feelSeed = (_feelSeed * 1103515245 + 12345) & 0x7fffffff; return _feelSeed / 0x7fffffff; }
CBZ.npcwar.onBoot(function () {
  const f = Q.get("feel");
  let calm = false;
  try { calm = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) {}
  FEEL_ON = f === "1" || (f !== "0" && !PROBE && !calm);
});

/* how much the hand moves, radians, for the shot in hand */
function feelHand() {
  const md = cam.mode;
  if (md === "free" || md === "you" || md === "youdead" || md === "study" || md === "under" || md === "surface") return 0;
  if (md === "fp") return 0.0022;
  if (md === "lock") return 0.0032;
  if (md === "kill") return 0.004;
  if (md === "follow") return 0.0045;
  const s = cam.shot;
  if (s === "charge") return 0.0085;            // running with them
  if (s === "hero") return 0.0048;
  if (s === "round") return 0.006;              // strapped to a rocket
  if (s === "tripod") return 0.0011;            // sticks, a long lens: it only breathes
  if (s === "establish") return 0.0012;
  return 0.0005;                                // the crane
}
// a shove on the springs: aim in radians / s, body in metres / s
function feelKick(pitch, yaw, roll, bx, by, bz, fov) {
  if (!FEEL_ON) return;
  FEEL.vp += pitch; FEEL.vy += yaw; FEEL.vr += roll;
  FEEL.vx += bx || 0; FEEL.vh += by || 0; FEEL.vz += bz || 0;
  if (fov) FEEL.fov = Math.min(9, FEEL.fov + fov);
}
/* AN EXPLOSION, HEARD OF BY THE DIRECTOR (camera.js camBoom). The wave is
   queued and lands when sound would: battle seconds, so slow motion slows
   the wave with everything else. */
function feelBoom(at, pw, rad) {
  const c = CBZ.camera;
  const dx = c.position.x - at.x, dy = c.position.y - at.y, dz = c.position.z - at.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > 900) return;
  if (FEEL.q.length > 24) FEEL.q.shift();
  FEEL.q.push({ at: simT + d / 340, d: d, pw: pw, rad: rad, nx: dx / (d || 1), ny: dy / (d || 1), nz: dz / (d || 1) });
}
function feelWave(e) {
  // overpressure falls off a little faster than 1 / d; a big charge carries
  const size = e.pw * 0.6 + e.rad * 0.05;
  const s = Math.min(1.8, size * 16 / (8 + e.d) * (e.d < 420 ? 1 : Math.max(0, 1 - (e.d - 420) / 480)));
  if (s < 0.02) return;
  if (CBZ.shake) CBZ.shake(Math.min(1.6, s * 1.25));
  if (!FEEL_ON) return;
  const sg = frand() < 0.5 ? -1 : 1;
  // shoved away from it, the horizon tips, the glass opens for a breath
  feelKick(0.5 * s, sg * 0.35 * s, sg * 0.55 * s, e.nx * 3.2 * s, Math.abs(e.ny) * 1.2 * s + 0.6 * s, e.nz * 3.2 * s, s > 0.5 ? 3 * s : 0);
}
/* THE SUBJECT FIRED. Read off the unit (lastShotT moves on every trigger
   pull, on foot and in a hull) so no weapon file has to know there is a
   camera. */
function feelGun(m) {
  if (m !== FEEL.shotM) { FEEL.shotM = m; FEEL.shotT = m ? (m.lastShotT || -9) : -9; return; }
  if (!m || m.dead) return;
  const t = m.lastShotT || -9;
  if (t === FEEL.shotT) return;
  const gap = t - FEEL.shotT;
  FEEL.shotT = t;
  const fp = cam.mode === "fp";
  const sg = frand() - 0.5;
  if (m.vehicle) {
    // the big gun speaks seldom; an autocannon or a launcher chatters
    const f = m.actx && m.actx.firing, k = f && f.kind;
    const big = k === "cannon" || (!k && gap > 1.2);
    if (big) feelKick(fp ? 0.9 : 0.34, sg * 0.3, sg * 0.5, 0, fp ? 0.5 : 0.25, 0, fp ? 6 : 3.5);
    else feelKick(fp ? 0.16 : 0.06, sg * 0.1, sg * 0.08);
  } else if (!m.beast) {
    // a rifle in the shoulder: up and a hair to one side, every round
    feelKick(fp ? 0.2 : 0.035, sg * (fp ? 0.14 : 0.03), sg * (fp ? 0.05 : 0.01));
  }
}
function feelSpring(dt, k, c) {
  const F = FEEL;
  F.vp += (-k * F.p - c * F.vp) * dt; F.p += F.vp * dt;
  F.vy += (-k * F.y - c * F.vy) * dt; F.y += F.vy * dt;
  F.vr += (-k * F.r - c * F.vr) * dt; F.r += F.vr * dt;
  F.vx += (-k * F.x - c * F.vx) * dt; F.x += F.vx * dt;
  F.vh += (-k * F.h - c * F.vh) * dt; F.h += F.vh * dt;
  F.vz += (-k * F.z - c * F.vz) * dt; F.z += F.vz * dt;
}
/* ONE STEP, on wall time, after camApply has built the frame. */
function camFeel(dt) {
  const F = FEEL;
  // the waves land whether or not the hand is on (CBZ.shake is the old kick)
  for (let i = F.q.length - 1; i >= 0; i--) {
    if (simT >= F.q[i].at || simT < F.q[i].at - 4) { const e = F.q[i]; F.q.splice(i, 1); if (simT >= e.at) feelWave(e); }
  }
  if (!FEEL_ON || !started) return;
  dt = Math.min(dt, 0.05);
  F.t += dt;
  const m = cam.followM;
  const riding = cam.mode === "fp" || cam.mode === "lock" || cam.mode === "follow" ||
    (cam.mode === "auto" && (cam.shot === "hero" || cam.shot === "charge" || cam.shot === "tripod"));
  feelGun(riding ? m : null);
  // two sub-steps keep a stiff spring honest on a slow frame
  feelSpring(dt * 0.5, 190, 17); feelSpring(dt * 0.5, 190, 17);
  F.fov *= Math.exp(-dt / 0.22);
  F.amp += (feelHand() - F.amp) * Math.min(1, dt * 3);
  const t = F.t, a = F.amp;
  let pitch = F.p + a * (Math.sin(t * 1.31 + 0.7) + 0.5 * Math.sin(t * 2.93 + 4.1) + 0.22 * Math.sin(t * 7.3));
  let yaw = F.y + a * (Math.sin(t * 1.07 + 2.2) + 0.5 * Math.sin(t * 2.51 + 0.3) + 0.2 * Math.sin(t * 6.1 + 1.0));
  let roll = F.r + a * 0.6 * (Math.sin(t * 0.83 + 5.0) + 0.4 * Math.sin(t * 2.2 + 1.7));
  let bob = 0;
  if (cam.mode === "fp" && m && !m.dead) {
    const sp = Math.abs(m.vehicle ? ((m.ds && m.ds.v) || m.speed || 0) : (m.speed || 0));
    if (m.air) {
      // the rotor: a buzz you feel more than see
      const b = m.def && m.def.drive === "jet" ? 0.0006 : 0.0016;
      pitch += b * Math.sin(t * 61); roll += b * 0.7 * Math.sin(t * 47 + 1);
    } else if (m.vehicle) {
      // tracks and wheels on rough ground: more of it the faster it goes
      const r = Math.min(1, sp / 12) * (m.def && m.def.drive === "tracked" ? 0.0042 : 0.0026);
      pitch += r * (Math.sin(t * 17.3) + 0.6 * Math.sin(t * 29.1 + 2));
      roll += r * 0.8 * Math.sin(t * 13.7 + 0.6);
      bob = r * 9 * Math.sin(t * 15.1);
    } else {
      // a man's head on a man's stride: two steps to a cycle, and it sways
      F.gait += dt * (2.2 + sp * 1.45);
      const g = Math.min(1, sp / 5.5);
      bob = 0.045 * g * Math.sin(F.gait * 2);
      roll += 0.012 * g * Math.sin(F.gait);
      pitch += 0.006 * g * Math.sin(F.gait * 2 + 0.8);
    }
  }
  if (!Number.isFinite(pitch + yaw + roll + bob + F.x + F.h + F.z)) {
    F.p = F.vp = F.y = F.vy = F.r = F.vr = F.x = F.vx = F.h = F.vh = F.z = F.vz = 0;
    return;
  }
  const c = CBZ.camera;
  // never more than a hand could do: a spring that ran away must not spin the frame
  const lim = 0.09;
  c.rotateY(Math.max(-lim, Math.min(lim, yaw)));
  c.rotateX(Math.max(-lim, Math.min(lim, pitch)));
  c.rotateZ(Math.max(-lim, Math.min(lim, roll)));
  const px = Math.max(-0.9, Math.min(0.9, F.x)), pz = Math.max(-0.9, Math.min(0.9, F.z));
  const py = Math.max(-0.5, Math.min(0.9, F.h)) + bob;
  c.position.x += px; c.position.z += pz;
  c.position.y = Math.max(c.position.y + py, MAP.camFloor(c.position.x, c.position.z));
}
// the concussion's breath of wider glass, for camApply's lens
function feelFov() { return FEEL_ON ? FEEL.fov : 0; }
