/* ============================================================
   systems/bodyfall.js — HOW A PERSON GOES DOWN. One fall for every human
   in every game: the shot, the dead, the knocked flat by a car or a quake.

   THE BUG THIS REPLACES (owner: "when someone gets shot they do this weird
   pivot, almost like one part of their foot is stuck to the ground and
   they're spinning around it"). Every human rig's origin is at the FEET, and
   every corpse path in this repo laid the body down by rotating that origin:
     · grapple.js tipped group.rotation.x to -90 degrees about the feet AND
       lerped group.rotation.y to (hit direction + pi) at the same time. A man
       shot from behind spun 180 degrees about his planted feet while he fell;
       from the side, 90. city/peds.js then fired a second "belt-and-braces"
       knockdown with a hardcoded direction of +z, which overwrote the real
       one, so every cheap-path corpse in the city pirouetted to face the same
       compass point whatever had killed it.
     · prisoncorpse.js rolled rotation.z to 90 degrees about the feet while
       damping rotation.y toward a lie direction it had picked for the walls,
       up to half a turn away from the way he was facing.
   A body does not do that. When a man is shot the legs give first: the knees
   fold, the hips drop almost straight down, and the upper body goes over the
   way the momentum (the round, and his own running) is carrying it. His
   centre of mass falls; nothing pivots on a foot.

   THE FALL (what this file does):
     · the rig's own keyed collapse (entities/meleeposes.js: buckle -> seat ->
       lie on the back, or buckle -> knees -> lie face down), so the hips drop
       under their own height and the feet stay where the legs put them;
     · picked by the MOMENTUM in his own frame: carried backward (shot from
       the front, standing) he sits down and goes over onto his back; carried
       forward (shot in the back, or running) he goes to his knees and onto
       his face; the side of the push picks which way he twists;
     · the group turns at most FALL_DRIFT (about 29 degrees), eased through
       the collapse, about the vertical line through his hips, so the body
       lands along the push without ever spinning;
     · the root carries the momentum (the round's shove plus the run) with
       friction that rises once he is on the floor, and slides against the
       world's colliders, never through them;
     · on the floor: it follows the ground under the hips, tilts to the
       slope or step between the head end and the feet end, and resolves
       both ends out of walls. Then it SLEEPS: no more writes, so the limbs
       stay put (no slide, no twitch, no re-standing).
   Cost: one keyed pose write per falling body per frame for about a second,
   three ground samples and a few collider tests; zero while asleep.

   API (CBZ.bodyFall):
     plan(yaw, ux, uz, out?)  -> { variant "back"|"face", side +-1, drift, hx, hz }
                                 pure: which fall carries a body facing `yaw`
                                 along world (ux, uz), and where the head ends
     start(a, o)              o = { dirX, dirZ, force, vx, vz, dead, hold, dur,
                                    landed, fromX, fromZ } -> record | null
     tick(a, dt)              drive it; true while it owns the body's transform
     getUp(a)                 a living man gets up (the rig's own get-up)
     poke(a, dirX, dirZ, f)   a settled body takes another hit (a nudge)
     active(a) / asleep(a) / clear(a)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const FALL_DRIFT = 0.5;        // rad: the most the body may turn while it goes down (~29 degrees)
  const G_SLIDE_FALL = 2.6;      // m/s^2 root deceleration while still on his feet (legs giving)
  const G_SLIDE_FLOOR = 9.0;     // m/s^2 once he is on the floor (a skid, and it stops)
  const MAX_SLIDE = 7;           // m/s cap on the root's carried speed
  const SLOPE_MAX = 0.45;        // rad: the most the lying body tilts to the ground under it
  const SETTLE_T = 0.45;         // s still on the floor before the pose freezes
  const HEAD_BACK = 1.0;         // m from the hips to the crown, lying on the back (measured off the rig)
  const HEAD_FACE = 0.95;        // ...face down
  const FEET_BACK = 0.62;        // m from the hips to the soles, lying on the back
  const FEET_FACE = 0.62;
  const END_R = 0.22;            // radius of each end against walls
  const TAU = Math.PI * 2;

  function wrap(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
  function MP() { return CBZ.meleePoses || null; }
  function floorAt(x, z, y) {
    if (CBZ.groundAt) { const g = CBZ.groundAt(x, z, y); if (Number.isFinite(g)) return g; }
    if (CBZ.floorAt) { const f = CBZ.floorAt(x, z, y); if (Number.isFinite(f)) return f; }
    return 0;
  }

  /* ---- THE PLAN: pure. Facing `yaw` (the rig's forward is (sin yaw, cos yaw)),
     carried along (ux, uz). Backward -> on his back, head along the push;
     forward -> on his face, head along the push. The yaw drift lines the lie
     up with the push, capped, and `side` is the way the lateral part of the
     push twists him (it mirrors the keyed fall). */
  function plan(yaw, ux, uz, out) {
    out = out || {};
    let ul = Math.hypot(ux, uz);
    const s = Math.sin(yaw), c = Math.cos(yaw);
    if (!(ul > 1e-6)) { ux = -s; uz = -c; ul = 1; }       // no push at all: he sits down and goes back
    ux /= ul; uz /= ul;
    const fwd = ux * s + uz * c;                          // + = carried forward
    const lat = ux * c - uz * s;                          // + = carried to his right (+x local)
    const variant = fwd > 0.05 ? "face" : "back";
    // head direction of that fall with no drift: back = -forward, face = +forward
    const hx0 = variant === "face" ? s : -s, hz0 = variant === "face" ? c : -c;
    let drift = wrap(Math.atan2(ux, uz) - Math.atan2(hx0, hz0));
    if (drift > FALL_DRIFT) drift = FALL_DRIFT; else if (drift < -FALL_DRIFT) drift = -FALL_DRIFT;
    const ha = Math.atan2(hx0, hz0) + drift;
    out.variant = variant;
    // the keyed falls are authored falling to the LEFT side (+1); a push to
    // his right mirrors them
    out.side = lat > 0 ? -1 : 1;
    out.drift = drift;
    out.hx = Math.sin(ha); out.hz = Math.cos(ha);
    out.err = Math.abs(wrap(Math.atan2(ux, uz) - ha));   // how far off the push the head lands
    return out;
  }

  /* ---- is a straight lie from the hips clear of walls? ---- */
  const _pt = { x: 0, y: 0, z: 0 };
  function blockedAt(x, z, y, r) {
    if (!CBZ.collide) return false;
    _pt.x = x; _pt.y = y; _pt.z = z;
    CBZ.collide(_pt, r, y + 0.04, y + 0.5);
    return Math.abs(_pt.x - x) + Math.abs(_pt.z - z) > 0.01;
  }
  function lieClear(px, pz, py, hx, hz, head, feet) {
    for (let t = 0.35; t <= head + 0.01; t += 0.33) if (blockedAt(px + hx * t, pz + hz * t, py, 0.18)) return false;
    if (blockedAt(px - hx * feet, pz - hz * feet, py, 0.16)) return false;
    return true;
  }

  function rigOf(a) { return a ? (a.char || (a.isPlayer ? CBZ.playerChar : null)) : null; }
  function grpOf(a) { const ch = rigOf(a); return (a && a.group) || (ch && ch.group) || null; }
  function moverVel(a, o) {
    if (o && (o.vx || o.vz)) return [o.vx || 0, o.vz || 0];
    const m = a && a._mv;
    if (m && (m.vx || m.vz)) return [m.vx || 0, m.vz || 0];
    if (a && a.vel && (a.vel.x || a.vel.z)) return [a.vel.x || 0, a.vel.z || 0];
    return [0, 0];
  }

  const _pl = {};
  function start(a, o) {
    o = o || {};
    const ch = rigOf(a), g = grpOf(a), M = MP();
    if (!ch || !g || !ch.parts || !M || !M.startFall) return null;
    const pos = g.position;
    // what carries him: the round/blow along its line, plus his own motion
    let dx = o.dirX, dz = o.dirZ;
    if (!(Number.isFinite(dx) && Number.isFinite(dz)) || (dx === 0 && dz === 0)) {
      if (o.fromX != null && o.fromZ != null) { dx = pos.x - o.fromX; dz = pos.z - o.fromZ; }
      else { dx = 0; dz = 0; }
    }
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-6) { dx /= dl; dz /= dl; }
    const f = o.force != null ? Math.max(0, +o.force || 0) : 4;
    // the round's share of the root speed: a pistol barely moves a man, a
    // close shotgun shoves him; his own run dominates when he has one
    const shove = Math.min(2.2, 0.06 * f);
    const mv = moverVel(a, o);
    let vx = dx * shove + mv[0] * 0.85, vz = dz * shove + mv[1] * 0.85;
    const vs = Math.hypot(vx, vz);
    if (vs > MAX_SLIDE) { vx *= MAX_SLIDE / vs; vz *= MAX_SLIDE / vs; }
    // the direction the fall goes is the momentum's, or the blow's when he is still
    let ux = vx, uz = vz;
    if (Math.hypot(ux, uz) < 0.05) { ux = dx; uz = dz; }
    const yaw0 = g.rotation.y || 0;
    let P = plan(yaw0, ux, uz, _pl);
    // the walls bend the lie when the natural one is blocked: the same way
    // over (never back toward what hit him), turned as far as the drift
    // allows either side. Nothing clear? Keep the natural fall: he goes down
    // against the wall and the ends resolve out of it on the floor (tick).
    const py = pos.y || 0;
    const ends0 = P.variant === "face" ? [HEAD_FACE, FEET_FACE] : [HEAD_BACK, FEET_BACK];
    if (CBZ.collide && !lieClear(pos.x, pos.z, py, P.hx, P.hz, ends0[0], ends0[1])) {
      const base = Math.atan2(P.hx, P.hz) - P.drift;       // the undrifted head direction
      const DR = [FALL_DRIFT, -FALL_DRIFT, FALL_DRIFT * 0.5, -FALL_DRIFT * 0.5];
      for (let i = 0; i < DR.length; i++) {
        const ha = base + DR[i], hx = Math.sin(ha), hz = Math.cos(ha);
        if (lieClear(pos.x, pos.z, py, hx, hz, ends0[0], ends0[1])) { P.drift = DR[i]; P.hx = hx; P.hz = hz; break; }
      }
    }
    // a strike pose, a reaction, a footstep: the fall owns the body now
    ch.punchT = 0; ch.kickT = 0;
    const dead = !!(o.dead || a.dead);
    const cur = ch.fall;
    const lying = cur && (cur.variant === "back" || cur.variant === "face");
    if (cur && cur.on && cur.phase !== "getup" && cur.phase !== "" && !lying && dead) {
      // DOWN ON A KNEE (a leg shot, the liver) AND NOW DEAD: he does not
      // kneel forever. From the knee he goes on over, the fall picked up
      // past its standing buckle, since his legs have already gone.
      M.startFall(ch, { variant: P.variant, side: P.side, ko: true, hold: true });
      ch.fall.t = 0.2;
    } else if (cur && cur.on && cur.phase !== "getup" && cur.phase !== "") {
      // ALREADY GOING DOWN (the blow that killed him was a knockdown, or a
      // second round found a falling man): keep that fall. Restarting it would
      // blend the collapse from wherever he is, i.e. stand a lying man back up
      // to the first beat. Only its ending changes: the dead stay down.
      P.variant = cur.variant === "face" ? "face" : "back";
      P.side = cur.side;
      P.drift = 0;
      const ya = g.rotation.y || 0, hs = P.variant === "face" ? 1 : -1;
      P.hx = Math.sin(ya) * hs; P.hz = Math.cos(ya) * hs;
      if (dead) { cur.ko = true; cur.hold = true; }
    } else {
      M.startFall(ch, { variant: P.variant, side: P.side, ko: dead || o.ko !== false, hold: dead || o.hold !== false, dur: o.dur });
    }
    const fl = ch.fall;
    fl.dead = dead;
    if (o.landed) {
      // a body that arrives from the air (thrown, blasted) is already on the
      // floor: straight to the last beat of the collapse
      const T = M.fallTimes(P.variant).fall;
      fl.t = Math.max(0, T - 0.12);
    }
    if (g.rotation.order !== "YXZ") g.rotation.order = "YXZ";
    const R = a._bf = a._bf || {};
    R.on = true; R.asleep = false; R.dead = dead;
    R.variant = P.variant; R.side = P.side;
    R.yaw0 = yaw0; R.drift = P.drift; R.hx = P.hx; R.hz = P.hz;
    R.vx = vx; R.vz = vz;
    R.t = 0; R.still = 0;
    R.fallT = M.fallTimes(P.variant).fall;
    R.tx0 = g.rotation.x || 0; R.tz0 = g.rotation.z || 0;   // any tumble it arrives with eases out
    R.seed = a._deathSeed != null ? a._deathSeed : (a._deathSeed = Math.random() * 6.28);
    return R;
  }

  function lieEnds(R) {
    return R.variant === "face" ? [HEAD_FACE, FEET_FACE] : [HEAD_BACK, FEET_BACK];
  }

  /* ---- the corpse's own sprawl: seeded, small, on top of the keyed lie, so
     two men dropped by one burst do not land as twins. Absolute writes over
     the key the fall just wrote this frame. ---- */
  // Only ABDUCTION (z) varies: lying on the back or the face, the body's
  // coronal plane is the floor, so swinging a limb out sideways keeps it ON
  // the floor; flexing it (x) would lift it into the air or bury it.
  function sprawl(ch, R, w) {
    if (!(w > 0)) return;
    const P = ch.parts, s = R.seed, j = (k) => Math.sin(s * k);
    if (P.la) P.la.rotation.z += 0.30 * j(2.3) * w;
    if (P.ra) P.ra.rotation.z -= 0.30 * j(3.1) * w;
    if (P.ll) P.ll.rotation.z += 0.10 * j(3.7) * w;
    if (P.rl) P.rl.rotation.z -= 0.10 * j(4.1) * w;
    if (ch.neck) ch.neck.rotation.y += 0.45 * j(1.3) * w;
  }
  // FACE DOWN THE FEET GO TOES-DOWN. The keyed lie stretches the legs flat,
  // and a straight leg on its front drives the shoe 12 cm into the floor
  // (measured, tools/bodyfall-check.mjs). A real body lying prone rests on
  // its toes with the knees a touch bent; bend them by the amount that lifts
  // the shoe onto the floor.
  const PRONE_KNEE = 0.5;
  function groundFit(ch, R, w) {
    if (R.variant !== "face" || !(w > 0)) return;
    const L = ch.low || {};
    if (L.ll) L.ll.rotation.x = Math.max(0, L.ll.rotation.x) + PRONE_KNEE * w;
    if (L.rl) L.rl.rotation.x = Math.max(0, L.rl.rotation.x) + PRONE_KNEE * w;
  }

  const _e = { x: 0, y: 0, z: 0 };
  const NPT = 14, PX = new Float32Array(NPT), PY = new Float32Array(NPT), PZ = new Float32Array(NPT);
  // head, hands, elbows, knees, feet, shoulders, neck, hips: metres around each joint, with a skin of margin
  const PR = [0.36, 0.15, 0.15, 0.13, 0.13, 0.14, 0.14, 0.19, 0.19, 0.19, 0.19, 0.25, 0.2, 0.2];
  let _V = null;
  function unwall(ch, g, pos) {
    const THREE = window.THREE;
    if (!THREE) return;
    const V = _V || (_V = new THREE.Vector3());
    g.updateMatrixWorld(true);
    const P = ch.parts, L = ch.low || {}, S = ch.sockets || {};
    const src = [ch.head, S.leftHand, S.rightHand, L.la, L.ra, L.ll, L.rl,
      P.ll && P.ll.userData && P.ll.userData.cap, P.rl && P.rl.userData && P.rl.userData.cap, P.la, P.ra, ch.neck, P.ll, P.rl];
    let n = 0;
    for (let i = 0; i < NPT; i++) {
      const o = src[i];
      if (!o || !o.matrixWorld) { PY[i] = NaN; continue; }
      V.setFromMatrixPosition(o.matrixWorld);
      PX[i] = V.x; PY[i] = V.y; PZ[i] = V.z; n++;
    }
    if (!n) return;
    let sx = 0, sz = 0;
    for (let pass = 0; pass < 3; pass++) {
      let bx = 0, bz = 0, bd = 0;
      for (let i = 0; i < NPT; i++) {
        if (PY[i] !== PY[i]) continue;
        _e.x = PX[i] + sx; _e.y = PY[i]; _e.z = PZ[i] + sz;
        const ex = _e.x, ez = _e.z;
        CBZ.collide(_e, PR[i], PY[i] - 0.08, PY[i] + 0.08);
        const dx = _e.x - ex, dz = _e.z - ez, d = dx * dx + dz * dz;
        if (d > bd) { bd = d; bx = dx; bz = dz; }
      }
      if (bd < 1e-8) break;
      sx += bx; sz += bz;
    }
    pos.x += sx; pos.z += sz;
  }
  function tick(a, dt) {
    const R = a && a._bf;
    if (!R || !R.on) return false;
    const ch = rigOf(a), g = grpOf(a), M = MP();
    if (!ch || !g || !M) { R.on = false; return false; }
    if (R.asleep) return true;                     // frozen where it lies: nothing writes
    if (R.resume) {
      // somebody else had the body (a carry, a drag) and put it down: it
      // lies where and how it was left, and settles from there
      R.resume = false;
      R.yaw0 = g.rotation.y || 0; R.drift = 0;
      R.tx0 = g.rotation.x || 0; R.tz0 = g.rotation.z || 0;
      R.t = Math.max(R.t, R.fallT); R.still = 0;
    }
    dt = Math.min(0.05, Math.max(0, dt || 0));
    R.t += dt;
    const pos = g.position;
    const fall = ch.fall;
    // ---- the pose: the rig's keyed collapse (animChar is skipped for a body
    //      this owns, so we run the pose layer ourselves) ----
    M.react(ch, dt, false, ch.low || {});
    const down = !fall || !fall.on || fall.phase === "down";
    if (R.dead) sprawl(ch, R, Math.min(1, R.t / Math.max(0.2, R.fallT)));
    if (fall && fall.on) {
      const ft = fall.t || 0;
      groundFit(ch, R, fall.phase === "down" ? 1
        : fall.phase === "fall" ? Math.max(0, Math.min(1, (ft - 0.4) / 0.26))
        : fall.phase === "getup" ? Math.max(0, 1 - (fall.gt || 0) / 0.3) : 0);
    }
    if (CBZ.lockCharacterHips) CBZ.lockCharacterHips(ch);
    // the FEET (entities/character.js ANKLE SOLVE): animChar is skipped for a
    // body this owns, so solve them here off the pose just written: slack and
    // pointing away on the back, instep to the floor face down, flat again
    // through the get-up. Frozen with the rest of the body once asleep.
    if (CBZ.charAnkleSolve) CBZ.charAnkleSolve(ch, dt, false);
    // ---- the turn: eased through the collapse, about the hips' vertical ----
    const k = Math.min(1, R.t / Math.max(0.2, R.fallT * 0.85));
    const ek = k * k * (3 - 2 * k);
    g.rotation.y = R.yaw0 + R.drift * ek;
    // ---- the root carries the momentum ----
    const onFloor = R.t >= R.fallT * 0.6;
    const sp = Math.hypot(R.vx, R.vz);
    if (sp > 1e-3) {
      const dec = (onFloor ? G_SLIDE_FLOOR : G_SLIDE_FALL) * dt;
      const ns = Math.max(0, sp - dec);
      R.vx *= ns / sp; R.vz *= ns / sp;
      const n = Math.max(1, Math.ceil(ns * dt / 0.25));
      for (let i = 0; i < n; i++) {
        const bx = pos.x, bz = pos.z;
        pos.x += R.vx * dt / n; pos.z += R.vz * dt / n;
        if (CBZ.collide) {
          CBZ.collide(pos, 0.3, pos.y + 0.05, pos.y + (onFloor ? 0.5 : 1.6));
          // the wall took it: the normal part of the velocity is gone
          const cx = pos.x - bx - R.vx * dt / n, cz = pos.z - bz - R.vz * dt / n;
          const cl = Math.hypot(cx, cz);
          if (cl > 1e-4) { const nx = cx / cl, nz = cz / cl, vn = R.vx * nx + R.vz * nz; if (vn < 0) { R.vx -= vn * nx; R.vz -= vn * nz; } }
        }
      }
    }
    // ---- the ground under the hips, and the lie across the slope / step ----
    const gy = floorAt(pos.x, pos.z, pos.y + 0.5);
    pos.y = gy;
    const ends = lieEnds(R);
    const ya = g.rotation.y, s = Math.sin(ya), c = Math.cos(ya);
    const hsg = R.variant === "face" ? 1 : -1;               // head along +forward (face) or -forward (back)
    const hx = s * hsg, hz = c * hsg;
    let tx = 0, tz = 0;
    const kd = fall && fall.phase === "getup" ? Math.max(0, 1 - (fall.gt || 0) / 0.8)
      : down ? 1 : Math.min(1, k * 1.2);
    if (kd > 0.3) {
      const fh = floorAt(pos.x + hx * ends[0], pos.z + hz * ends[0], gy + 0.6);
      const ff = floorAt(pos.x - hx * ends[1], pos.z - hz * ends[1], gy + 0.6);
      let rise = Math.atan2(fh - ff, ends[0] + ends[1]);     // + = head end higher
      if (rise > SLOPE_MAX) rise = SLOPE_MAX; else if (rise < -SLOPE_MAX) rise = -SLOPE_MAX;
      // rotation.x > 0 raises the rig's -z end (the back-lying head); the
      // face-down head is at +z, so it takes the other sign
      tx = (R.variant === "face" ? -rise : rise) * kd;
      const rx = c, rz = -s;                                 // his right, world
      const fr = floorAt(pos.x + rx * 0.3, pos.z + rz * 0.3, gy + 0.6);
      const fL = floorAt(pos.x - rx * 0.3, pos.z - rz * 0.3, gy + 0.6);
      let roll = Math.atan2(fr - fL, 0.6);
      if (roll > SLOPE_MAX) roll = SLOPE_MAX; else if (roll < -SLOPE_MAX) roll = -SLOPE_MAX;
      tz = roll * kd;
    }
    // any tumble the body arrived with (a throw) eases out as it settles
    const ta = Math.min(1, R.t / 0.18);
    g.rotation.x = R.tx0 * (1 - ta) + tx * ta;
    g.rotation.z = R.tz0 * (1 - ta) + tz * ta;
    // ---- out of the walls: the body's own extremities (head, hands, elbows,
    //      knees, feet, read off the posed rig) are each resolved against the
    //      colliders at their own height, and the WHOLE body moves by the
    //      deepest push. An arm flung into a wall slides the body off it
    //      instead of passing through. ----
    if (CBZ.collide) unwall(ch, g, pos);
    // ---- sleep: on the floor, not sliding, the collapse played out ----
    const still = down && Math.hypot(R.vx, R.vz) < 0.05;
    R.still = still ? R.still + dt : 0;
    if (R.still > SETTLE_T && fall && fall.phase === "down" && (R.dead || fall.hold)) R.asleep = true;
    if (!fall || !fall.on) {                         // a living man finished his get-up
      R.on = false;
      g.rotation.x = 0; g.rotation.z = 0;
      return false;
    }
    return true;
  }
  // a holder (carry, drag, a jaw) let go: settle from where it was left
  function resume(a) {
    const R = a && a._bf;
    if (!R || !R.on) return false;
    R.resume = true; R.asleep = false;
    return true;
  }

  function getUp(a) {
    const R = a && a._bf, ch = rigOf(a), M = MP();
    if (!R || !R.on || R.dead || !ch || !M) return false;
    R.asleep = false;
    return M.getUp(ch);
  }
  function poke(a, dirX, dirZ, f) {
    const R = a && a._bf;
    if (!R || !R.on) return false;
    const imp = Math.min(1.2, 0.05 * (f || 4));
    const l = Math.hypot(dirX || 0, dirZ || 0);
    if (!(l > 1e-6)) return false;
    R.vx += dirX / l * imp; R.vz += dirZ / l * imp;
    R.asleep = false; R.still = 0;
    return true;
  }
  function clear(a) {
    if (!a || !a._bf) return;
    a._bf.on = false; a._bf.asleep = false;
    const ch = rigOf(a);
    if (ch && ch.fall && ch.fall.on) {
      ch.fall.on = false; ch.fall.phase = ""; ch.fall.dead = false;
      // the collapse dropped the model inside the group (meleeposes' setModel,
      // delta-tracked on the rig); a revived man stands at full height at once
      const m = ch.model;
      if (m) {
        m.position.y -= ch._mMy || 0; m.position.z -= ch._mMz || 0; m.position.x -= ch._mMx || 0;
        m.rotation.y -= ch._mMr || 0;
      }
      ch._mMy = ch._mMz = ch._mMx = ch._mMr = 0;
    }
  }

  /* ---- A KO THAT CAME WITHOUT A FALL (a taser, a baton, a knockout the
     prison movers are told about only through `a.ko`) goes down in the rig
     too, instead of the movers' side roll about the feet. The movers call
     koFall every KO frame (idempotent) and koRise the frame the KO runs
     out, which starts the rig's own get-up and holds the KO open until it
     has played, so the brain does not walk a man who is still on his knees. */
  CBZ.koFall = function (a) {
    const ch = rigOf(a), M = MP();
    if (!a || a.dead || !ch || !ch.parts || !M || !M.startFall) return false;
    if (a._koRising || (ch.fall && ch.fall.on)) return false;
    const g = grpOf(a), ph = a._phys;
    let variant = "back", side = 1;
    if (g && ph && (ph.fdx || ph.fdz)) {
      const P = plan(g.rotation.y || 0, ph.fdx, ph.fdz, _pl);
      variant = P.variant; side = P.side;
    } else if (a._deathSeed != null) side = Math.sin(a._deathSeed * 3.3) >= 0 ? 1 : -1;
    M.startFall(ch, { variant, side, ko: true, hold: true });
    a._koFall = true;
    return true;
  };
  CBZ.koRise = function (a) {
    const ch = rigOf(a), M = MP();
    if (!a) return false;
    if (a._koRising) { a._koRising = false; return false; }
    if (!a._koFall) return false;
    a._koFall = false;
    if (a.dead || !ch || !M || !ch.fall || !ch.fall.on) return false;
    M.getUp(ch);
    a._koRising = true;
    a.ko = M.fallTimes(ch.fall.variant).getup + 0.05;
    return true;
  };

  /* ============================================================
     THE CORPSE LAW (owner 2026-09-28: "when you shoot someone, they just
     DISAPPEAR. There's no physics.") One rule every game's corpse cull asks:
       · a body is NEVER removed while it could be on screen,
       · NEVER within NEAR (60 m) of the player,
       · otherwise only when the game is over its CAP (oldest first) or the
         body is older than AGE (10 minutes).
     CBZ.corpseLaw.hidden(pos)          off screen AND far from the player
     CBZ.corpseLaw.mayRemove(a, over)   the whole rule for one body
   ============================================================ */
  const LAW = { CAP: 48, AGE: 600, NEAR: 60 };
  let _fr = null, _pm = null, _sp = null;
  function onScreen(x, y, z) {
    const cam = CBZ.camera, THREE = window.THREE;
    if (!cam || !THREE || !cam.projectionMatrix) return true;       // cannot tell: assume seen
    if (!_fr) { _fr = new THREE.Frustum(); _pm = new THREE.Matrix4(); _sp = new THREE.Sphere(); }
    cam.updateMatrixWorld();
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _fr.setFromProjectionMatrix(_pm);
    _sp.center.set(x, (y || 0) + 0.5, z); _sp.radius = 1.4;           // a lying body, padded
    return _fr.intersectsSphere(_sp);
  }
  function hidden(pos) {
    if (!pos) return false;
    const P = CBZ.player && CBZ.player.pos;
    if (P) { const dx = pos.x - P.x, dz = pos.z - P.z; if (dx * dx + dz * dz < LAW.NEAR * LAW.NEAR) return false; }
    const C = CBZ.camera && CBZ.camera.position;
    if (C) { const dx = pos.x - C.x, dz = pos.z - C.z; if (dx * dx + dz * dz < LAW.NEAR * LAW.NEAR) return false; }
    return !onScreen(pos.x, pos.y, pos.z);
  }
  CBZ.corpseLaw = {
    LAW, hidden, onScreen,
    mayRemove(a, overCap) {
      if (!a || !a.pos) return false;
      if (!(overCap || (a.deadT || 0) > LAW.AGE)) return false;
      return hidden(a.pos);
    },
  };

  /* ============================================================
     THE CORPSE KEEPER: a body a game would otherwise take away with the man
     (a gun-game bot who respawns, a pooled rig reused) is DETACHED into a
     record of its own here, left where it fell, finished by the collapse,
     and removed only under the corpse law.
       CBZ.corpses.keep(rig, opts) -> record   rig: { char, group }  opts.tag
       CBZ.corpses.clear(tag)                  a match / mode ends: all of them
       CBZ.corpses.list
   ============================================================ */
  const KEPT = [];
  function disposeRig(g) {
    if (g.parent) g.parent.remove(g);
    g.traverse(function (o) {
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) { /* shared */ } }
      const m = o.material;
      if (m) {
        if (Array.isArray(m)) { for (let i = 0; i < m.length; i++) if (m[i] && !m[i]._shared && m[i].dispose) try { m[i].dispose(); } catch (e) { /* shared */ } }
        else if (!m._shared && m.dispose) { try { m.dispose(); } catch (e) { /* shared */ } }
      }
    });
  }
  function keep(src, opts) {
    opts = opts || {};
    const ch = rigOf(src), g = grpOf(src);
    if (!ch || !g) return null;
    const r = {
      char: ch, group: g, pos: g.position, dead: true, deadT: src.deadT || 0, _corpse: true,
      _bf: src._bf || null, _deathSeed: src._deathSeed, tag: opts.tag || "", name: src.name,
    };
    src._bf = null;
    // not started yet (a body that died out of reach of the fall): start it here
    if (!r._bf || !r._bf.on) start(r, { dirX: opts.dirX, dirZ: opts.dirZ, force: opts.force || 0, dead: true, hold: true });
    KEPT.push(r);
    return r;
  }
  function clearKept(tag) {
    for (let i = KEPT.length - 1; i >= 0; i--) {
      const r = KEPT[i];
      if (tag != null && r.tag !== tag) continue;
      KEPT.splice(i, 1);
      disposeRig(r.group);
    }
  }
  CBZ.corpses = { keep, clear: clearKept, list: KEPT };
  if (CBZ.onUpdate) CBZ.onUpdate(24.5, function (dt) {
    if (!KEPT.length) return;
    let oldest = -1, oAge = -1;
    for (let i = 0; i < KEPT.length; i++) {
      const r = KEPT[i];
      r.deadT += dt;
      if (r._bf && r._bf.on && !r._bf.asleep) tick(r, dt);
      if (r.deadT > oAge && hidden(r.pos)) { oAge = r.deadT; oldest = i; }
    }
    if (oldest >= 0 && (KEPT.length > LAW.CAP || oAge > LAW.AGE)) {
      const r = KEPT.splice(oldest, 1)[0];
      disposeRig(r.group);
    }
  });

  CBZ.bodyFall = {
    plan, start, tick, getUp, poke, clear, resume, unwall,
    active(a) { return !!(a && a._bf && a._bf.on); },
    asleep(a) { return !!(a && a._bf && a._bf.on && a._bf.asleep); },
    FALL_DRIFT,
  };
})();
