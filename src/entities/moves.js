/* ============================================================
   entities/moves.js — CBZ.moves, THE ONE LOCOMOTION LAYER.

   Every AI-driven person in every game walks through this file: the jail's
   inmates and guards, the city's peds, the President's detail, gun-game
   bots, survival bots, warlord soldiers. Brains decide WHERE (a target, a
   speed, maybe a facing); this decides HOW a human body gets there.

   Before this file every game had its own mover, and each one was wrong in
   its own way: the city integrated `speed * dt` along the target with no
   velocity (instant starts, instant stops, a 180 in one frame), the jail had
   a velocity but an unbounded yaw, the President's agents flipped between
   "walk" and "idle" at a 0.7 m threshold and got a second catch-up step on
   top of the ped mover's own, so they surged and stopped at their slots.
   Everyone fed the rig the ORDERED speed, so a body held on a wall ran on
   the spot, and the stride was a constant 1.15 m per footfall on a 0.78 m
   leg, so every walker skated.

   WHAT A BODY GETS HERE
   · A VELOCITY with acceleration limits (speed up ~0.4 s to a walk, stop
     over a real braking distance) — never a flip inside a frame.
   · ARRIVAL: speed is capped by sqrt(2·decel·distance-to-stop), so a body
     brakes into its goal and stops ON it: no overshoot, no hunting. Once
     arrived it STAYS arrived until the goal moves further than a re-arm
     distance (hysteresis), so a goal jittering by a centimetre can never
     start a walk cycle.
   · TURN RATE: yaw turns at a bounded rate that falls with speed (a pivot
     on the spot is quick, a runner carves). Forward speed is gated by how
     well the body faces its travel direction, so a man told to walk behind
     himself TURNS IN PLACE and then steps off — no moonwalk, no crab.
     `strafe` opts out for combat footwork (face the mark, legs go sideways).
   · LOCAL AVOIDANCE, predictive: each neighbour's closest approach over the
     next ~2 s. Both parties of a head-on pass keep RIGHT (the same rule, so
     they never mirror each other into a dance), the push is low-passed so it
     cannot vibrate, and a slower walker directly ahead is followed at his
     pace instead of bumped.
   · STUCK RECOVERY: achieved ground speed vs. ordered, over time. A body
     that makes no progress for ~1 s takes a committed side-step detour
     (alternating sides) and bumps `m.stuckN`, which a brain may read to
     re-plan or give the goal up.
   · GROUND SPEED: measured from where the body actually ended up (after the
     wall resolver, knockback, anything), damped — that is what the legs
     animate with (`m.gs`), so a held body stands still.
   · GAITS walk / jog / run with a STRIDE MATCHED TO THE LEG (phaseDelta, which
     entities/character.js's animChar uses): one footfall covers exactly the
     ground the planted foot sweeps under the hip, so feet do not slide.
   · LOD: `lod` 0 full, 1 no avoidance, 2 bare integration — callers pick it
     by distance/visibility (`CBZ.moves.lodFor`). 650 city peds stay cheap.

   FORMATIONS (CBZ.moves.formation): the frame follows a principal's
   SMOOTHED velocity, its heading turns at a bounded rate, slots are
   PREDICTED ahead by a speed-scaled lead, members get the principal's
   velocity as FEED-FORWARD (they match his pace instead of chasing and
   stopping), assignment re-solves only on a real gain (no reshuffle), and a
   member at rest scans outward with slow, held glances.

   POSTURE (sit / lie / stand / kneel / crouch / climb a bunk) is the second
   half of this layer: entities/moves_posture.js publishes CBZ.moves.sit /
   lie / stand / kneel / crouch / climb / posture / busy / seatLegs. The seat
   and bed ANCHOR registry stays in city/propuse.js, whose propSit/propSleep/
   propWake/propStand are thin front ends to it.

   Pure math on {x, z} objects: no THREE, no allocation on the hot path, so
   tools/moves-sim.mjs runs it in plain node.
============================================================ */
(function () {
  "use strict";
  const CBZ = (typeof window !== "undefined" ? window : globalThis).CBZ;
  if (!CBZ) return;

  const PI = Math.PI, TAU = PI * 2;
  function wrap(a) { a = (a + PI) % TAU; if (a < 0) a += TAU; return a - PI; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function damp(cur, target, rate, dt) { return cur + (target - cur) * (1 - Math.exp(-rate * dt)); }
  // bounded turn: never more than maxStep radians toward `want`
  function turnToward(cur, want, maxStep) {
    const d = wrap(want - cur);
    if (Math.abs(d) <= maxStep) return cur + d;
    return cur + (d > 0 ? maxStep : -maxStep);
  }

  /* ---- GAITS ------------------------------------------------------------
     Speeds are the preferred speeds of the gait (m/s, world units = metres).
     `turn` is the yaw rate a body can hold at that gait (rad/s): ~0.55 s for
     a 180 on the spot, a runner needs a lot longer. */
  const GAIT = {
    idle: { speed: 0, turn: 5.6 },
    walk: { speed: 1.4, turn: 4.6 },
    jog: { speed: 3.0, turn: 3.6 },
    run: { speed: 5.0, turn: 2.7 },
  };
  function gaitOf(speed) {
    return speed < 0.15 ? "idle" : speed < 2.2 ? "walk" : speed < 4.0 ? "jog" : "run";
  }
  // yaw rate at a given ground speed, interpolated across the gait table
  function turnRate(speed) {
    if (speed <= 1.4) return 5.6 - (5.6 - 4.6) * (speed / 1.4);
    if (speed <= 3.0) return 4.6 - (4.6 - 3.6) * ((speed - 1.4) / 1.6);
    if (speed <= 5.0) return 3.6 - (3.6 - 2.7) * ((speed - 3.0) / 2.0);
    return Math.max(2.0, 2.7 - (speed - 5.0) * 0.15);
  }

  /* ---- MOTOR STATE --------------------------------------------------------
     One small record per body (`actor._mv`). Fields a caller may read:
       vx, vz   the velocity this layer is carrying (m/s)
       yaw      the facing it wants the body at (write it to the group)
       gs       measured ground speed (feed THIS to the rig)
       speed    |velocity|
       gait     "idle" | "walk" | "jog" | "run" (by ground speed)
       arrived  at the goal and holding
       stuckN   consecutive stuck recoveries (0 once progress resumes) */
  function motor(a) {
    let m = a && a._mv;
    if (m) return m;
    m = {
      vx: 0, vz: 0, yaw: null, gs: 0, speed: 0, gait: "idle", arrived: false,
      lx: null, lz: null,            // position at the previous step (achieved-speed probe)
      ax: 0, az: 0,                  // low-passed avoidance push
      stuckT: 0, stuckN: 0, goodT: 0, detourT: 0, detourS: 1, passS: 0, passT: 0,
      gx: null, gz: null,            // the goal the arrival latch belongs to
      id: (motor._seq = (motor._seq || 0) + 1),
    };
    if (a) a._mv = m;
    return m;
  }
  // forget motion (teleport, spawn, seat, death): the next step starts from rest
  function reset(m, pos) {
    if (!m) return;
    m.vx = m.vz = 0; m.speed = 0; m.gs = 0; m.arrived = false; m.ax = m.az = 0;
    m.stuckT = 0; m.stuckN = 0; m.goodT = 0; m.detourT = 0;
    m.lx = pos ? pos.x : null; m.lz = pos ? pos.z : null;
  }

  const REARM = 0.35;        // metres the goal must move off a latched arrival to walk again
  const DEF = {
    speed: 1.4, stop: 0.3, accel: 3.6, decel: 3.2, radius: 0.32,
  };

  // scratch for neighbour avoidance (no allocation)
  const _av = { x: 0, z: 0, follow: Infinity };

  /* PREDICTIVE AVOIDANCE. For each neighbour: time of closest approach under
     current velocities (clamped to a 2.2 s horizon); if the pass would come
     closer than the two radii plus a comfort margin, push sideways off the
     line — harder the sooner it is. A head-on pass (closest point near the
     centreline) is resolved by the KEEP-RIGHT rule, identical for both, so
     two people meeting in a corridor each step to their own right and pass
     cleanly instead of mirroring each other. Overlap gets plain separation.
     Also reports the along-track speed of a slower walker directly ahead so
     the caller can FOLLOW instead of bumping (`_av.follow`). */
  function avoid(m, pos, hx, hz, want, nbrs, nbrN, getPos, radius) {
    _av.x = 0; _av.z = 0; _av.follow = Infinity;
    if (!nbrs || !nbrN) return _av;
    const vx = m.vx, vz = m.vz;
    for (let i = 0; i < nbrN; i++) {
      const o = nbrs[i];
      if (!o) continue;
      const op = getPos ? getPos(o) : (o.pos || (o.group && o.group.position));
      if (!op || op === pos) continue;
      const om = o._mv;
      if (om === m) continue;
      const rx = op.x - pos.x, rz = op.z - pos.z;
      const d2 = rx * rx + rz * rz;
      if (d2 > 16 || d2 < 1e-6) continue;             // 4 m sense radius
      const d = Math.sqrt(d2);
      const R = radius + ((om && om.radius) || radius) + 0.18;
      const ovx = om ? om.vx : 0, ovz = om ? om.vz : 0;
      // relative motion of the other in my frame
      const wx = ovx - vx, wz = ovz - vz, w2 = wx * wx + wz * wz;
      let t = w2 > 1e-4 ? -(rx * wx + rz * wz) / w2 : 0;
      t = clamp(t, 0, 2.2);
      const cx = rx + wx * t, cz = rz + wz * t;       // his position relative to me at closest approach
      const cd = Math.hypot(cx, cz);
      // overlap now: plain separation (strong, short)
      if (d < R) {
        const k = (R - d) / R * 2.2;
        _av.x -= (rx / d) * k; _av.z -= (rz / d) * k;
      }
      // ahead of me along my heading?
      const ahead = rx * hx + rz * hz;
      if (ahead <= 0 && d > R) continue;
      if (cd < R + 0.25 && t > 0) {
        const urg = (1 - t / 2.2) * (1 - Math.max(0, cd - R * 0.6) / (R * 0.8 + 0.25));
        if (urg > 0) {
          // side: away from where he will be; near the centreline, KEEP RIGHT.
          // right of heading (hx,hz) in this yaw convention (yaw = atan2(x,z)) is (-hz, hx)
          const lat = cx * -hz + cz * hx;               // + = he'll be on my right
          // A COMMITTED SIDE: the choice is held for a beat (m.passS/passT),
          // so a neighbour drifting across the centreline cannot flip it
          // frame to frame. A fresh choice keeps right unless he is clearly
          // already on my right.
          let side;
          if (m.passT > 0 && m.passS && lat * m.passS < 0.35) side = m.passS;
          else side = lat > 0.3 ? -1 : lat < -0.3 ? 1 : (m.passS || 1);
          if (side !== m.passS || m.passT <= 0) { m.passS = side; m.passT = 0.9; }
          const k = clamp(urg, 0, 1) * 1.25;
          _av.x += -hz * side * k; _av.z += hx * side * k;
        }
      }
      // near-contact comfort: anyone within arm's length who is not overlapping
      // yet still gets a gentle push apart (side-by-side walkers converging on
      // one goal never register a closing time)
      if (d >= R && d < R + 0.3) {
        const k = (R + 0.3 - d) / 0.3 * 0.45;
        _av.x -= (rx / d) * k; _av.z -= (rz / d) * k;
      }
      // a slower body in my lane, going my way: follow at his pace (checked
      // whatever the closing speed — once matched, the gap must hold)
      if (ahead > 0 && Math.abs(rx * -hz + rz * hx) < R && d < 2.4) {
        const along = ovx * hx + ovz * hz;
        if (along > 0.3 && along < want) _av.follow = Math.min(_av.follow, Math.max(0, along) + Math.max(0, d - R - 0.15) * 0.9);
      }
    }
    return _av;
  }

  /* ---- THE STEP -------------------------------------------------------------
     step(m, pos, yaw, tx, tz, o, dt) moves `pos` (x/z written in place) one
     frame toward (tx, tz) and leaves the facing it wants in `m.yaw`.
       yaw   the body's CURRENT facing (read from the group each frame, so a
             system that turned the body — face the player, a shove — is
             respected rather than fought).
     o (all optional):
       speed    desired top speed (m/s)                         [1.4]
       stop     arrival radius (m)                              [0.3]
       leg      true = a waypoint, pass through at speed (no braking)
       accel    m/s² speeding up                                [3.6]
       decel    m/s² braking / arrival profile                  [3.2]
       face     a yaw to hold instead of the travel direction (combat, a
                formation member at rest, a counter at a desk)
       strafe   true = legs go any direction while the torso holds `face`
       vffX, vffZ  feed-forward velocity (formation: the principal's)
       nbrs, nbrN, getPos   neighbours for avoidance (array + count +
                optional pos accessor); omit = no avoidance
       radius   body radius for avoidance                       [0.32]
       lod      0 full | 1 no avoidance | 2 bare               [0]
     Returns m (m.arrived, m.gs, m.yaw, m.vx/vz ...). */
  function step(m, pos, yaw, tx, tz, o, dt) {
    o = o || DEF;
    if (!(dt > 0)) return m;
    if (dt > 0.1) dt = 0.1;
    const lod = o.lod | 0;
    const speedMax = o.speed != null ? o.speed : DEF.speed;
    const stop = o.stop != null ? o.stop : DEF.stop;
    const accel = o.accel || DEF.accel, decel = o.decel || DEF.decel;
    const radius = o.radius || DEF.radius;
    m.radius = radius;
    if (m.yaw == null || yaw != null) m.yaw = yaw != null ? yaw : (m.yaw || 0);

    // ---- measured ground speed (what the body ACTUALLY did since last step)
    if (m.lx != null) {
      const ddx = pos.x - m.lx, ddz = pos.z - m.lz;
      const moved2 = ddx * ddx + ddz * ddz;
      if (moved2 > 9) m.gs = 0;                         // a teleport is not a stride
      else m.gs = damp(m.gs, Math.sqrt(moved2) / dt, 14, dt);
    }
    // measured start-to-start, so the probe sees our own step AND whatever the
    // wall resolver / a shove did to it after we wrote it
    m.lx = pos.x; m.lz = pos.z;

    const vffX = o.vffX || 0, vffZ = o.vffZ || 0;
    const vff = Math.hypot(vffX, vffZ);
    let dx = tx - pos.x, dz = tz - pos.z;
    const dist = Math.hypot(dx, dz);

    // ---- arrival latch (hysteresis) --------------------------------------
    if (m.arrived) {
      const moved = m.gx == null ? 0 : Math.hypot(tx - m.gx, tz - m.gz);
      if (vff > 0.25 || dist > stop + REARM || moved > REARM) m.arrived = false;
    }
    if (!m.arrived && !o.leg && vff < 0.25 && dist <= stop && Math.hypot(m.vx, m.vz) < 0.6) {
      m.arrived = true; m.gx = tx; m.gz = tz;
    }

    let wx = 0, wz = 0, want = 0;
    let hx = 0, hz = 0;
    if (!m.arrived) {
      if (dist > 1e-4) { hx = dx / dist; hz = dz / dist; }
      // ARRIVAL PROFILE: brake to a stop exactly at `stop`.
      const room = Math.max(0, dist - stop);
      want = speedMax;
      if (!o.leg) {
        const brake = Math.sqrt(2 * decel * room);
        want = Math.min(want, Math.max(brake, room > 0.01 ? 0.18 : 0));
      }
      // STUCK DETOUR: a committed side-step for a moment, then straight again
      if (m.detourT > 0) {
        m.detourT -= dt;
        const c = Math.cos(1.45), s = Math.sin(1.45) * m.detourS;
        const nx = hx * c - hz * s, nz = hx * s + hz * c;
        hx = nx; hz = nz;
      }
      wx = hx * want; wz = hz * want;
      // feed-forward (formations): his velocity plus our correction
      if (vff > 0) {
        wx += vffX; wz += vffZ;
        const wl = Math.hypot(wx, wz), cap = Math.max(speedMax, vff * 1.25);
        if (wl > cap) { wx *= cap / wl; wz *= cap / wl; }
        want = Math.hypot(wx, wz);
        if (want > 1e-4) { hx = wx / want; hz = wz / want; }
      }
      // ---- local avoidance ------------------------------------------------
      if (m.passT > 0) m.passT -= dt;
      if (lod === 0 && o.nbrs && want > 0.05) {
        const av = avoid(m, pos, hx, hz, want, o.nbrs, o.nbrN != null ? o.nbrN : o.nbrs.length, o.getPos, radius);
        m.ax = damp(m.ax, av.x, 5, dt); m.az = damp(m.az, av.z, 5, dt);
        if (av.follow < want) {
          const f = Math.max(av.follow, want * 0.25);
          wx *= f / want; wz *= f / want; want = f;
        }
      } else { m.ax = damp(m.ax, 0, 7, dt); m.az = damp(m.az, 0, 7, dt); }
      if (lod === 0 && (m.ax || m.az)) {
        // bend the desired DIRECTION, keep its magnitude (avoidance steers, it does not brake)
        let nx = hx + m.ax, nz = hz + m.az;
        const nl = Math.hypot(nx, nz);
        if (nl > 1e-4) { nx /= nl; nz /= nl; wx = nx * want; wz = nz * want; }
      }
    } else if (vff > 0) {
      wx = vffX; wz = vffZ; want = vff;
    }

    // ---- facing: bounded yaw rate ---------------------------------------
    const vNow = Math.hypot(m.vx, m.vz);
    let faceWant;
    if (o.face != null) faceWant = o.face;
    else if (want > 0.05) faceWant = Math.atan2(wx, wz);
    else faceWant = m.yaw;
    const rate = (o.turnRate || turnRate(vNow)) * dt;
    if (lod >= 2 && !o.face) m.yaw = want > 0.05 ? turnToward(m.yaw, faceWant, rate * 2) : m.yaw;
    else m.yaw = turnToward(m.yaw, faceWant, rate);

    // ---- TURN IN PLACE: forward speed gated by how well we face the travel
    let wantG = want;
    if (!o.strafe && want > 0.05 && lod < 2) {
      const e = Math.abs(wrap(Math.atan2(wx, wz) - m.yaw));
      const g = clamp((Math.cos(e) - 0.15) / 0.75, 0, 1);
      wx *= g; wz *= g; wantG = want * g;
    }

    // ---- velocity with acceleration limits --------------------------------
    let ex = wx - m.vx, ez = wz - m.vz;
    const el = Math.hypot(ex, ez);
    if (el > 1e-6) {
      const wl = Math.hypot(wx, wz);
      // speeding up along the way we already go uses accel; turning/stopping uses decel (a bit harder)
      const speedingUp = wl > vNow && (m.vx * wx + m.vz * wz) >= 0.7 * vNow * wl;
      const cap = (lod >= 2 ? 3 : 1) * (speedingUp ? accel : decel * 1.6) * dt;
      if (el > cap) { ex *= cap / el; ez *= cap / el; }
      m.vx += ex; m.vz += ez;
    }
    // never step past the goal (the last frame of an arrival)
    let sx = m.vx * dt, sz = m.vz * dt;
    if (!o.leg && vff < 0.25 && !m.arrived) {
      const along = sx * dx + sz * dz;
      const remain = dist - stop * 0.5;
      if (dist > 1e-4 && along > 0 && along / dist > remain && remain > 0) {
        const k = remain / (along / dist);
        sx *= k; sz *= k;
      }
    }
    if (m.arrived && vff < 0.25) {
      // latched: bleed the last of the velocity, move no further than the goal allows
      const r2 = (pos.x + sx - tx) ** 2 + (pos.z + sz - tz) ** 2;
      if (r2 > (stop + 0.05) * (stop + 0.05)) { sx = 0; sz = 0; m.vx = 0; m.vz = 0; }
    }
    pos.x += sx; pos.z += sz;
    // ---- BODIES DO NOT PASS THROUGH BODIES (near tier): after the step, any
    // neighbour closer than two shoulder radii gets half the overlap resolved
    // from this side (he resolves his half on his own step), and the velocity
    // component driving into him is dropped. Positional, so it cannot ring.
    if (lod === 0 && o.nbrs) {
      const nN = o.nbrN != null ? o.nbrN : o.nbrs.length, HARD = radius * 2 * 0.82;
      for (let i = 0; i < nN; i++) {
        const q = o.nbrs[i];
        if (!q || q._mv === m) continue;
        const op = o.getPos ? o.getPos(q) : (q.pos || (q.group && q.group.position));
        if (!op || op === pos) continue;
        const rx = pos.x - op.x, rz = pos.z - op.z, d2 = rx * rx + rz * rz;
        if (d2 >= HARD * HARD || d2 < 1e-8) continue;
        const d = Math.sqrt(d2), nx = rx / d, nz = rz / d, pen = (HARD - d) * 0.5;
        pos.x += nx * pen; pos.z += nz * pen;
        const into = m.vx * nx + m.vz * nz;
        if (into < 0) { m.vx -= nx * into; m.vz -= nz * into; }
      }
    }
    m.speed = Math.hypot(m.vx, m.vz);

    // ---- stuck recovery ---------------------------------------------------
    const trying = !m.arrived && wantG > 0.3 && dist > stop + 0.5 && m.speed > wantG * 0.5;
    if (trying) {
      if (m.gs < wantG * 0.22) { m.stuckT += dt; m.goodT = 0; }
      else { m.stuckT = Math.max(0, m.stuckT - dt * 2); m.goodT += dt; if (m.goodT > 2) m.stuckN = 0; }
      if (m.stuckT > 1.0 && m.detourT <= 0) {
        m.stuckT = 0;
        // one side per episode (committed, never see-sawing), each retry longer
        if (m.stuckN === 0) m.detourS = (m.id & 1) ? 1 : -1;
        else if (m.stuckN === 4) m.detourS = -m.detourS;   // that side is a dead end: try the other
        m.stuckN++;
        m.detourT = Math.min(3, 0.8 + 0.6 * m.stuckN);
      }
    } else { m.stuckT = 0; }

    m.gait = gaitOf(m.gs);
    return m;
  }

  /* Turn a standing body toward a yaw at the gait's own rate (the one
     place every "face the player / face the desk / face the threat" should
     go through — the old code wrote rotation.y directly, a snap). */
  function face(m, yaw, want, dt, rate) {
    if (m.yaw == null || yaw != null) m.yaw = yaw != null ? yaw : (m.yaw || 0);
    m.yaw = turnToward(m.yaw, want, (rate || turnRate(m.gs || 0)) * dt);
    return m.yaw;
  }
  function faceAt(m, yaw, pos, x, z, dt, rate) {
    const dx = x - pos.x, dz = z - pos.z;
    if (dx * dx + dz * dz < 1e-4) { if (yaw != null) m.yaw = yaw; return m.yaw; }
    return face(m, yaw, Math.atan2(dx, dz), dt, rate);
  }

  // LOD by distance to the camera/player (m²) and whether the body is drawn
  function lodFor(d2, visible) {
    if (d2 < 900 && visible !== false) return 0;
    if (d2 < 3600) return 1;
    return 2;
  }

  /* ---- STRIDE: foot-plant-matched gait phase --------------------------------
     animChar advances ch.phase by PI per footfall. The ground one footfall
     covers must equal the ground the planted foot sweeps under the hip, or the
     foot slides: 2 · leg · sin(hipAmp), plus a little heel-to-toe roll-over.
     The hip amplitude here mirrors animChar's own formula so the two agree.
     At a run the flight phase carries the body further than the stance sweep,
     so the step blends back to the rig's authored run stride above ~2 m/s. */
  const LEG_WORLD_DEFAULT = 0.80;
  function legWorld(ch) {
    if (ch._legW > 0) return ch._legW;
    const pf = ch.profile;
    const hs = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 0.7;
    const L = pf ? (pf.legUp + pf.legLo + (pf.shoeH || 0.2) * 0.5) * hs : LEG_WORLD_DEFAULT;
    ch._legW = L > 0.2 ? L : LEG_WORLD_DEFAULT;
    return ch._legW;
  }
  function phaseDelta(ch, speed, dt, walkRef, GA) {
    if (!(speed > 0.2)) return dt * 0.9;
    walkRef = walkRef || 6.4;
    const norm = Math.min(speed / walkRef, 1);
    const run = clamp((speed - walkRef) / (walkRef * 0.7), 0, 1);
    const stepMul = GA && GA.step > 0 ? GA.step : 1;
    const legacy = (1.15 + 0.10 * norm + 0.55 * run) * stepMul;
    const cb = ch ? (ch._cb || 0) : 0;
    const A = (0.30 + 0.26 * norm + 0.16 * run) * (1 - 0.35 * cb) * ((GA && GA.hipAmp) || 1);
    const contact = 2 * (ch ? legWorld(ch) : LEG_WORLD_DEFAULT) * Math.sin(A) * 1.18;
    const w = clamp((speed - 2.0) / 2.5, 0, 1);
    const stepLen = Math.max(0.25, contact * (1 - w) + Math.max(contact, legacy) * w);
    return (speed * dt / stepLen) * PI;
  }

  /* ---- FORMATIONS -------------------------------------------------------------
     const F = CBZ.moves.formation();       one per principal
     F.update(px, pz, pyaw, dt)             every frame (principal's position)
     F.slot(f, s, out)                      local offset (f forward, s right)
                                            → out {x, z, vx, vz, face}
     F.assign(key, members, cost)           stable member→slot assignment
     F.scan(i, baseYaw, dt)                 outward glances for member i at rest
     F.moving / F.speed / F.h               frame state for callers */
  function formation(opts) {
    opts = opts || {};
    const F = {
      px: null, pz: null, vx: 0, vz: 0, speed: 0, moving: false,
      h: null, ax: 0, az: 0, t: 0,
      turn: opts.turn || 1.7,              // rad/s the frame may rotate
      leadMax: opts.lead != null ? opts.lead : 0.2,
      _asg: null, _asgKey: "", _asgT: 0,
      _scan: [],
      update(px, pz, pyaw, dt) {
        if (!(dt > 0)) return F;
        F.t += dt;
        if (F.px == null || Math.hypot(px - F.px, pz - F.pz) > 8) {
          F.px = px; F.pz = pz; F.vx = F.vz = 0;
          if (F.h == null) F.h = pyaw || 0;
        }
        const ivx = (px - F.px) / dt, ivz = (pz - F.pz) / dt;
        F.px = px; F.pz = pz;
        // smoothed principal velocity (a footstep wobble is not a heading)
        F.vx = damp(F.vx, ivx, 5, dt); F.vz = damp(F.vz, ivz, 5, dt);
        F.speed = Math.hypot(F.vx, F.vz);
        F.moving = F.moving ? F.speed > 0.25 : F.speed > 0.5;
        // frame heading follows TRAVEL at a bounded rate; at rest it eases to
        // where he faces, slowly (a man turning on the spot does not spin his detail)
        const want = F.moving ? Math.atan2(F.vx, F.vz) : (pyaw != null ? pyaw : F.h);
        F.h = turnToward(F.h, want, (F.moving ? F.turn : F.turn * 0.35) * dt);
        // predicted anchor: where he will be a speed-scaled beat from now
        const lead = F.moving ? clamp(F.speed * 0.25, 0, F.leadMax) : 0;
        F.ax = px + F.vx * lead; F.az = pz + F.vz * lead;
        return F;
      },
      slot(f, s, out) {
        out = out || {};
        const h = F.h || 0;
        const fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
        out.x = F.ax + fx * f + rx * s;
        out.z = F.az + fz * f + rz * s;
        out.vx = F.moving ? F.vx : 0; out.vz = F.moving ? F.vz : 0;
        out.face = h + Math.atan2(s, f);
        return out;
      },
      /* STABLE ASSIGNMENT. members: array of {x,z} positions (or bodies with
         pos); slots: array of {x,z}. Re-solved greedily when the roster
         changes, and otherwise only every 2.5 s and only if the new total
         cost beats the current one by 30% — so nobody reshuffles each frame
         and two agents never trade places back and forth. Returns an array
         member index → slot index. */
      assign(members, slots, getPos) {
        const n = Math.min(members.length, slots.length);
        let key = n + ":";
        for (let i = 0; i < members.length; i++) key += (members[i] && (members[i]._mv ? members[i]._mv.id : i)) + ",";
        const P = (i) => { const q = members[i]; return getPos ? getPos(q) : (q.pos || (q.group && q.group.position) || q); };
        const cost = (asg) => {
          let c = 0;
          for (let i = 0; i < asg.length; i++) {
            const j = asg[i]; if (j < 0) continue;
            const p = P(i); c += Math.hypot(p.x - slots[j].x, p.z - slots[j].z);
          }
          return c;
        };
        const greedy = () => {
          const out = new Array(members.length).fill(-1), used = new Array(slots.length).fill(false);
          for (let k = 0; k < n; k++) {
            let bi = -1, bj = -1, bd = Infinity;
            for (let i = 0; i < members.length; i++) {
              if (out[i] >= 0) continue;
              const p = P(i);
              for (let j = 0; j < slots.length; j++) {
                if (used[j]) continue;
                const d = Math.hypot(p.x - slots[j].x, p.z - slots[j].z);
                if (d < bd) { bd = d; bi = i; bj = j; }
              }
            }
            if (bi < 0) break;
            out[bi] = bj; used[bj] = true;
          }
          return out;
        };
        if (!F._asg || F._asgKey !== key) { F._asg = greedy(); F._asgKey = key; F._asgT = F.t; }
        else if (F.t - F._asgT > 2.5) {
          F._asgT = F.t;
          const g = greedy();
          if (cost(g) < cost(F._asg) * 0.7) F._asg = g;
        }
        return F._asg;
      },
      /* A MAN ON A DETAIL AT REST LOOKS OUT, AND HOLDS EACH LOOK. Glances
         step between left / centre / right of his outward bearing every
         2.5-4.5 s (per-member phase), and the step's own turn rate carries
         the head round — never a sweeping metronome. */
      scan(i, baseYaw, dt) {
        let s = F._scan[i];
        if (!s) s = F._scan[i] = { t: 0.6 + (i * 1.37) % 2.4, off: 0, k: i * 7 + 3 };
        s.t -= dt;
        if (s.t <= 0) {
          s.k = (s.k * 1103515245 + 12345) & 0x7fffffff;
          const r = (s.k % 1000) / 1000;
          s.off = r < 0.34 ? -0.55 : r < 0.67 ? 0 : 0.55;
          s.t = 2.5 + ((s.k >> 10) % 1000) / 500;
        }
        return baseYaw + s.off;
      },
    };
    return F;
  }

  CBZ.moves = Object.assign(CBZ.moves || {}, {
    GAIT, gaitOf, turnRate, motor, reset, step, face, faceAt, lodFor,
    phaseDelta, legWorld, formation, wrap, turnToward,
  });
})();
