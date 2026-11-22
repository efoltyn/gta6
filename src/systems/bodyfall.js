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
   AND NOT TWO ALIKE (2026-11-22, owner: "much more real movement getting
   shot"): what hit him and where picks the fall's STYLE and its CLOCK
   (readRound below: a head shot drops him where he stands in under half a
   second, a rifle round in the trunk folds him over it before he sits, a
   close shotgun throws him back a long step, a leg takes him over toward
   it, a man shot at a run slides on along it, a man with a wall behind him
   slides down it and sits against it, a man who bled out sags), and once
   the muscles are gone his limbs are loose weight on springs
   (entities/meleeposes.js LIMP WEIGHT): they trail, flop on the floor,
   overshoot and settle, and every later round kicks the part it hits.

   Cost per falling body: one keyed pose write and 12 limb springs per frame
   for about two seconds, three ground samples and a few collider tests;
   zero while asleep.

   API (CBZ.bodyFall):
     plan(yaw, ux, uz, out?)  -> { variant "back"|"face", side +-1, drift, hx, hz }
                                 pure: which fall carries a body facing `yaw`
                                 along world (ux, uz), and where the head ends
     start(a, o)              o = { dirX, dirZ, force, vx, vz, dead, hold, dur,
                                    landed, fromX, fromZ, and the round that
                                    did it: zone, cal, wkey, dist, point,
                                    cause } -> record | null
     floorOnly(ch, o)         the same fall in a rig whose root is somebody
                                 else's (the player's: physics.js)
     drag(a, dt, from?)       a man down and awake drags himself off
     tick(a, dt)              drive it; true while it owns the body's transform
     getUp(a)                 a living man gets up (the rig's own get-up)
     poke(a, dirX, dirZ, f, point?)  a settled body takes another hit: a
                              shove you can see, a jolt in the part struck
   CBZ.corpseHit(target, point, dir, force)  a round into a dead body, any game
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
  const _bfO = { posture: "down", radius: 0.3, feet: 0.05, height: 1.6, cars: false,
    out: { hit: false, nx: 0, nz: 0, c: null, pushed: false, landed: false, y: 0, floor: 0 } };
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

  /* ---- WHAT HIT HIM, AND WHAT HE WAS DOING: the one read every death and
     every floored man goes through. Two men shot one after the other used
     to go down as twins (one of two keyed falls, on one clock, with one
     shove of 0.3 m/s whatever the gun). A body answers the round:
       · WHERE: the head (or the spine) takes the legs at once: no buckle and
         no step, he drops where he stood ("drop"); a heavy round through the
         trunk doubles him over it before he sits ("fold"); a leg takes that
         leg and he goes over toward it; a man bleeding out sags down slowly.
       · WHAT: the round's energy (calibre, a shotgun's whole blast, which
         falls off with range) sets the clock of the fall and the shove: a
         pocket pistol barely moves him, a rifle round more, a shotgun from
         two metres throws the whole body back a long step.
       · DOING: a man shot at a run goes on along his run, on his face, and
         slides; a man with a wall a step behind him goes back into it and
         slides down it to sit dead against it ("wall").
       · and the round's line across his body turns his shoulders (the limp
         springs, entities/meleeposes.js, take the kick).
     o (all optional) = { zone head|torso|armL|armR|legL|legR, cal, wkey,
       dist, point {x,y,z}, cause } on top of start()'s own. */
  const _rd = { E: 0, round: false, close: false, style: "", rate: 1, shove: 0 };
  function readRound(o, runSp, seed) {
    const r = _rd;
    r.round = o.cal > 0 || !!o.zone || !!o.wkey;
    let E = r.round ? (o.cal > 0 ? o.cal : 1) : 0;
    if (o.wkey === "shotgun") { const d = o.dist != null ? o.dist : 6; E *= d < 3 ? 1.4 : d > 16 ? 0.3 : 1.4 - (d - 3) * 0.085; }
    r.E = E;
    r.close = o.wkey === "shotgun" && (o.dist != null ? o.dist : 9) < 4.5;
    const running = runSp > 2.2;
    let style = "", rate = 1;
    if (o.cause === "bled out") { style = "fold"; rate = 0.72; }
    else if (o.zone === "head") { style = "drop"; rate = 1.3 + 0.12 * Math.min(2, E); }
    else if (r.close) rate = 1.3;
    else if (o.zone === "torso" || (!o.zone && r.round)) {
      if (E >= 1.15 && !running) { style = "fold"; rate = 0.95 + 0.1 * Math.min(2, E); }
      else rate = 0.82 + 0.12 * Math.min(1.5, E);
    } else if (o.zone === "legL" || o.zone === "legR") rate = 1.0;
    else if (o.zone === "armL" || o.zone === "armR") rate = 0.9;
    if (running) rate = Math.max(rate, 1.12);
    // no two the same: a seeded tenth either way
    rate *= 0.92 + 0.16 * (0.5 + 0.5 * Math.sin(seed * 7.13));
    r.style = style; r.rate = rate;
    r.shove = r.round ? (0.22 + 0.28 * E + (r.close ? 1.7 : 0)) * (o.zone === "head" ? 0.35 : 1) : -1;
    if (o.cause === "bled out") r.shove = 0;
    return r;
  }
  // a wall (or a shut door, a locker) this close behind the line he falls along
  function wallBehind(px, pz, py, hx, hz) {
    for (let t = 0.3; t <= 0.86; t += 0.28) if (blockedAt(px + hx * t, pz + hz * t, py, 0.18)) return true;
    return false;
  }
  // the round's line across him: it turns the shoulders it went through, and
  // jolts the part it went into (MP.limpKick)
  function roundKick(ch, g, o, dx, dz, E) {
    const M = MP();
    if (!M || !M.limpKick || !(E > 0)) return;
    const ya = g.rotation.y || 0, c = Math.cos(ya), s = Math.sin(ya);
    const fx = dx * c - dz * s, fz = dx * s + dz * c;        // the round in his frame (+x his left, +z his front)
    let tw = 0;
    if (o.point && o.point.x != null) {
      const rx = (o.point.x - g.position.x) * c - (o.point.z - g.position.z) * s;
      const rz = (o.point.x - g.position.x) * s + (o.point.z - g.position.z) * c;
      tw = rz * fx - rx * fz;                                 // (r x F).y: the yaw it puts in the trunk
    }
    const k = Math.min(2.2, E);
    const z = o.zone || "torso";
    const part = z === "armL" ? "la" : z === "armR" ? "ra" : z === "legL" ? "rl" : z === "legR" ? "ll" : z === "head" ? "head" : "core";
    M.limpKick(ch, part, fx >= 0 ? 1 : -1, 0.35 + 0.45 * k, fz, tw * 10 * k);
  }

  const _pl = {};
  /* ---- ONTO THE FLOOR, IN THE RIG: the keyed collapse picked for this
     body and this hit, keeping a fall it is already in. Every game's rig,
     the player's too (systems/capture.js floors yours through it). */
  function floorRig(ch, P, o, dead, rd, seed) {
    const M = MP();
    const cur = ch.fall;
    const lying = cur && (cur.variant === "back" || cur.variant === "face");
    if (cur && cur.on && cur.phase !== "getup" && cur.phase !== "" && !lying) {
      // DOWN ON A KNEE (a leg shot, the liver) AND NOW DEAD OR FLOORED: he
      // does not kneel forever. From the knee he goes on over, the fall
      // picked up past its standing buckle, since his legs have already gone.
      M.startFall(ch, { variant: P.variant, side: P.side, ko: dead || o.ko !== false, hold: true, rate: rd.rate, seed });
      ch.fall.t = 0.2;
      return "knee";
    }
    if (cur && cur.on && cur.phase !== "getup" && cur.phase !== "") {
      // ALREADY GOING DOWN (the blow that killed him was a knockdown, or a
      // second round found a falling man): keep that fall. Restarting it would
      // blend the collapse from wherever he is, i.e. stand a lying man back up
      // to the first beat. Only its ending changes: the dead stay down.
      if (dead) { cur.ko = true; cur.hold = true; }
      return "kept";
    }
    M.startFall(ch, { variant: P.variant, side: P.side, ko: dead || o.ko !== false, hold: dead || o.hold !== false,
      dur: o.dur, style: rd.style, rate: rd.rate, seed });
    return "new";
  }
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
    const seed = a._deathSeed != null ? a._deathSeed : (a._deathSeed = Math.random() * 6.28);
    const mv = moverVel(a, o);
    const runSp = Math.hypot(mv[0], mv[1]);
    const rd = readRound(o, runSp, seed);
    // the round's share of the root speed (readRound: by its energy); a blow
    // with no round behind it keeps the force scale; his own run dominates
    // when he has one
    const shove = rd.shove >= 0 ? rd.shove : Math.min(2.2, 0.06 * f);
    const mvk = rd.style === "fold" && o.cause === "bled out" ? 0 : 0.85;
    let vx = dx * shove + mv[0] * mvk, vz = dz * shove + mv[1] * mvk;
    const vs = Math.hypot(vx, vz);
    if (vs > MAX_SLIDE) { vx *= MAX_SLIDE / vs; vz *= MAX_SLIDE / vs; }
    // the direction the fall goes is the momentum's, or the blow's when he is still
    let ux = vx, uz = vz;
    if (Math.hypot(ux, uz) < 0.05) { ux = dx; uz = dz; }
    const yaw0 = g.rotation.y || 0;
    let P = plan(yaw0, ux, uz, _pl);
    // A LEG GOES: he goes over toward it (the keyed falls fall to his left
    // for side +1; parts.rl is his left leg)
    if (o.zone === "legL") P.side = 1; else if (o.zone === "legR") P.side = -1;
    const py = pos.y || 0;
    // A WALL A STEP BEHIND HIM: he goes back into it and slides down it, and
    // sits dead against it. Never lying through it, never bent 30 degrees off
    // the round to dodge it.
    if (P.variant === "back" && runSp < 2.2 && CBZ.collide && wallBehind(pos.x, pos.z, py, -Math.sin(yaw0), -Math.cos(yaw0))) {
      rd.style = "wall"; rd.rate = Math.min(rd.rate, 1.1);
      P.drift = 0; P.hx = -Math.sin(yaw0); P.hz = -Math.cos(yaw0);
      const sp = Math.max(0.9, Math.hypot(vx, vz));
      vx = P.hx * sp; vz = P.hz * sp;                       // into the wall: the mover stops him on it
    }
    // the walls bend the lie when the natural one is blocked: the same way
    // over (never back toward what hit him), turned as far as the drift
    // allows either side. Nothing clear? Keep the natural fall: he goes down
    // against the wall and the ends resolve out of it on the floor (tick).
    const ends0 = P.variant === "face" ? [HEAD_FACE, FEET_FACE] : [HEAD_BACK, FEET_BACK];
    if (rd.style !== "wall" && CBZ.collide && !lieClear(pos.x, pos.z, py, P.hx, P.hz, ends0[0], ends0[1])) {
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
    const how = floorRig(ch, P, o, dead, rd, seed);
    if (how === "kept") {
      const cur = ch.fall;
      P.variant = cur.variant === "face" ? "face" : "back";
      P.side = cur.side;
      P.drift = 0;
      const ya = g.rotation.y || 0, hs = P.variant === "face" ? 1 : -1;
      P.hx = Math.sin(ya) * hs; P.hz = Math.cos(ya) * hs;
      rd.style = cur.style || ""; rd.rate = cur.rate || 1;
    }
    const fl = ch.fall;
    fl.dead = dead;
    if (o.landed) {
      // a body that arrives from the air (thrown, blasted) is already on the
      // floor: straight to the last beat of the collapse (key time)
      const T = M.fallTimes(P.variant, rd.style).fall;
      fl.t = Math.max(0, T - 0.12);
    }
    if (g.rotation.order !== "YXZ") g.rotation.order = "YXZ";
    // the round goes into the part it found, and turns the shoulders
    if (rd.round && how !== "kept") roundKick(ch, g, o, dx, dz, rd.E);
    const R = a._bf = a._bf || {};
    R.on = true; R.asleep = false; R.dead = dead;
    R.variant = P.variant; R.side = P.side; R.style = rd.style;
    R.yaw0 = yaw0; R.drift = P.drift; R.hx = P.hx; R.hz = P.hz;
    R.vx = vx; R.vz = vz;
    R.t = 0; R.still = 0;
    R.fallT = M.fallTimes(P.variant, rd.style, rd.rate).fall;   // seconds, on this death's clock
    R.tx0 = g.rotation.x || 0; R.tz0 = g.rotation.z || 0;   // any tumble it arrives with eases out
    R.seed = seed;
    return R;
  }
  /* A RIG ONTO THE FLOOR WITHOUT THE ROOT (the player: physics.js owns his
     root; the fall and the limp are the rig's). o = start()'s, dirX/dirZ the
     way he is carried. Returns ch.fall. */
  function floorOnly(ch, o) {
    o = o || {};
    const M = MP();
    if (!ch || !ch.parts || !ch.group || !M || !M.startFall) return null;
    const g = ch.group, yaw = g.rotation.y || 0;
    let dx = o.dirX || 0, dz = o.dirZ || 0;
    if (!(dx || dz)) { dx = -Math.sin(yaw); dz = -Math.cos(yaw); }
    const seed = Math.random() * 6.28;
    const rd = readRound(o, o.runSp || 0, seed);
    const P = plan(yaw, dx, dz, _pl);
    if (o.zone === "legL") P.side = 1; else if (o.zone === "legR") P.side = -1;
    const dead = !!o.dead;
    const how = floorRig(ch, P, o, dead, rd, seed);
    if (ch.fall) ch.fall.dead = dead;
    // the fall owns the body: no roll left over from anything before it
    g.rotation.x = 0; g.rotation.z = 0;
    if (rd.round && how !== "kept") roundKick(ch, g, o, dx, dz, rd.E);
    return ch.fall;
  }

  function lieEnds(R) {
    return R.variant === "face" ? [HEAD_FACE, FEET_FACE] : [HEAD_BACK, FEET_BACK];
  }

  /* The corpse's own sprawl (seeded, so two men dropped by one burst do not
     land as twins) and every jolt of a round are the LIMP SPRINGS now
     (entities/meleeposes.js limp): the sprawl is where each limb's spring
     comes to rest, a round is a kick to the springs of the part it struck,
     and the limbs trail, flop, overshoot and settle on their own. */
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
    const jolting = !!(M.limpBusy && M.limpBusy(ch));
    if (fall && fall.on) {
      groundFit(ch, R, fall.phase === "down" ? 1
        : fall.phase === "fall" ? Math.max(0, Math.min(1, (R.t / Math.max(0.2, R.fallT) - 0.6) / 0.4))
        : fall.phase === "getup" ? Math.max(0, 1 - (fall.gt || 0) / 0.3) : 0);
    }
    // the pose is written outright every frame here: hold its neck to the range
    if (CBZ.human && CBZ.human.clampNeck) CBZ.human.clampNeck(ch.neck);
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
      // THE ONE MOVER (systems/bodymove.js): the skid stops on the wall or
      // the shut door it runs into and slides along it (a swept move: no
      // substep count to get wrong), and the wall takes the normal part of
      // the velocity
      _bfO.height = onFloor ? 0.5 : 1.6;
      if (CBZ.bodyMove) {
        const sw = CBZ.bodyMove(pos, R.vx * dt, 0, R.vz * dt, _bfO);
        if (sw.hit || sw.pushed) { const vn = R.vx * sw.nx + R.vz * sw.nz; if (vn < 0) { R.vx -= vn * sw.nx; R.vz -= vn * sw.nz; } }
      } else { pos.x += R.vx * dt; pos.z += R.vz * dt; }
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
    // sat against a wall he sits on the floor: nothing to lie along
    if (kd > 0.3 && R.style !== "wall") {
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
    const still = down && !jolting && Math.hypot(R.vx, R.vz) < 0.05;
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
  /* ---- A SETTLED BODY TAKES ANOTHER HIT. It used to be a root velocity of
     0.05 * force against a 9 m/s^2 floor skid: a pistol round (force ~5)
     moved a corpse 3 MILLIMETRES and nothing else happened, so shooting a
     body in any game but the city (whose verlet slots re-kick) read as
     shooting a picture of one. Now the round does what it does to a body:
       - a shove along its line that you can see (a pistol ~5 cm, a close
         shotgun ~20 cm), sliding against the walls like the fall's own;
       - a JOLT in the part it struck: a kick to that part's limp springs
         (entities/meleeposes.js), so the limb flicks along the round and
         swings back past where it lay and settles; a head hit turns the head
         over, a trunk hit shudders the shoulders and both arms;
     and the body settles and sleeps again once the springs are still.
     `point` (world {x,y,z}, optional) picks the part; no point = the core. */
  function nearestPart(ch, point) {
    const THREE = window.THREE;
    if (!point || !THREE || !ch.parts) return "core";
    const V = _V || (_V = new THREE.Vector3());
    const P = ch.parts, L = ch.low || {}, S = ch.sockets || {};
    const cand = [["la", L.la || P.la], ["ra", L.ra || P.ra], ["ll", L.ll || P.ll], ["rl", L.rl || P.rl],
      ["la", S.leftHand], ["ra", S.rightHand], ["head", ch.head], ["head", ch.neck], ["core", ch.body]];
    let best = "core", bd = 1e9;
    for (let i = 0; i < cand.length; i++) {
      const o = cand[i][1];
      if (!o || !o.getWorldPosition) continue;
      o.getWorldPosition(V);
      const d = (V.x - point.x) * (V.x - point.x) + (V.y - point.y) * (V.y - point.y) + (V.z - point.z) * (V.z - point.z);
      if (d < bd) { bd = d; best = cand[i][0]; }
    }
    return best;
  }
  /* A round into a falling or fallen body (dead, out cold, or a living man
     down on the floor in his own fall): it never restarts the fall or stands
     him up, it moves what it hit. A body with no muscle in it takes it in
     the limp springs (the part flicks along the round and swings back); a
     conscious man on the floor turns off it and covers (MP.groundHit). */
  function poke(a, dirX, dirZ, f, point) {
    const l = Math.hypot(dirX || 0, dirZ || 0);
    if (!(l > 1e-6)) return false;
    const R = a && a._bf;
    const ch = rigOf(a), g = grpOf(a), M = MP();
    const F = Math.max(0, f || 4);
    if (!R || !R.on) {
      const fl = ch && ch.fall;
      if (!fl || !fl.on || !g || !M) return false;
      const ya = g.rotation.y || 0;
      const lx = (dirX / l) * Math.cos(ya) - (dirZ / l) * Math.sin(ya);
      if (fl.ko && M.limpKick) {
        const fz = (dirX / l) * Math.sin(ya) + (dirZ / l) * Math.cos(ya);
        M.limpKick(ch, nearestPart(ch, point), lx >= 0 ? 1 : -1, Math.min(1.6, 0.1 + 0.06 * F), fz, 0);
      } else if (M.groundHit && fl.phase === "down") M.groundHit(ch, lx, Math.min(1.2, 0.3 + 0.05 * F));
      return true;
    }
    // v^2 / (2 * G_SLIDE_FLOOR): 0.18 * 5 = 0.9 m/s slides ~4.5 cm
    const imp = Math.min(1.8, 0.18 * F);
    R.vx += dirX / l * imp; R.vz += dirZ / l * imp;
    // the jolt: the springs of the part it struck, along the round
    if (ch && g && M && M.limpKick) {
      const ya = g.rotation.y || 0, c = Math.cos(ya), s = Math.sin(ya);
      const lx = (dirX / l) * c - (dirZ / l) * s, fz = (dirX / l) * s + (dirZ / l) * c;
      M.limpKick(ch, nearestPart(ch, point), lx >= 0 ? 1 : -1, Math.min(1.6, 0.1 + 0.06 * F), fz, 0);
    }
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

  /* ============================================================
     CBZ.corpseHit(target, point, dir, force, o) -> bool: A ROUND INTO A BODY,
     IN EVERY GAME. Every gun asks this one question about a dead man it hit:
       - a body in a verlet ragdoll slot (the city, warlord's solver) re-kicks
         there (city/ragdoll.js cityCorpseHit, which also stamps the wound);
       - a body lying in its collapse (this file: prison, survival, gun game,
         warlord, the city's cheap path) takes it as a shove and a jolt
         (poke) and wears the wound (systems/wounds.js).
     And every one of them is another hole that lets out what is in him:
     CBZ.vitals.wound on a dead man grows the pool under him (to its cap).
     dir is the round's travel ({x,z}, y ignored), force on the ragdoll's
     scale (~6 pistol, ~14 shotgun). o = { cal, head, by } (optional).
     False = nothing here could take it.
   ============================================================ */
  function ooze(target, kind, point, o) {
    if (!CBZ.vitals || !target || !target.dead) return;
    try {
      CBZ.vitals.wound(target, { kind, point: point || null, head: !!(o && o.head), cal: o && o.cal, by: (o && o.by) || null });
    } catch (e) { /* vitals off */ }
  }
  CBZ.corpseHit = function (target, point, dir, force, o) {
    if (!target) return false;
    if (!target.group && target.actor) target = target.actor;
    let took = false;
    if (CBZ.cityCorpseHit) { try { took = !!CBZ.cityCorpseHit(target, point, dir, force); } catch (e) { /* ragdoll off */ } }
    if (!took) {
      if (!target.dead || !target._bf || !target._bf.on) return false;
      if (!poke(target, dir ? dir.x : 0, dir ? dir.z : 0, Math.max(1, force || 6), point)) return false;
      if (CBZ.bodyWound && point) {
        try { CBZ.bodyWound(target, point, { dir: dir || null, head: !!(o && o.head), cal: o && o.cal }); } catch (e) { /* wounds off */ }
      }
      took = true;
    }
    ooze(target, "bullet", point, o);
    return took;
  };

  /* ============================================================
     CBZ.corpseStab(target, point, dir, o) -> bool: A BLADE INTO A BODY.
     The knife does not stop working because he stopped breathing: a small
     push where it went in, a cut on the part it went into (wounds.js blade
     mark), a little blood out of it, and another ooze into the pool
     (vitals). A fist or a boot into a corpse is CBZ.bodyFall.poke alone:
     no mark. o = { by, force } (optional).
   ============================================================ */
  CBZ.corpseStab = function (target, point, dir, o) {
    if (!target) return false;
    if (!target.group && target.actor) target = target.actor;
    if (!target.dead || !target.group) return false;
    o = o || {};
    const dx = dir ? dir.x || 0 : 0, dz = dir ? dir.z || 0 : 0;
    if (target._bf && target._bf.on) poke(target, dx, dz, o.force != null ? o.force : 1.6, point);
    if (!point) {
      const gp = target.group.position;
      point = { x: gp.x, y: (gp.y || 0) + 0.3, z: gp.z };
    }
    if (CBZ.bodyWound) { try { CBZ.bodyWound(target, point, { melee: "blade", dir: dir || null }); } catch (e) { /* wounds off */ } }
    // what comes out of the cut: a short wet spatter along the blade, then
    // the drip where it lands (gore.js's own drops, never a painted blob)
    if (CBZ.gore && CBZ.gore.spray) { try { CBZ.gore.spray(point, 0.3, dir || null, { exit: false }); } catch (e) { /* gore off */ } }
    else if (CBZ.goreDrip) { try { CBZ.goreDrip(point.x, point.z, 0.25, point.y); } catch (e) { /* gore off */ } }
    ooze(target, "stab", point, o);
    return true;
  };

  /* ============================================================
     DRAGGING HIMSELF. A man down on the floor and awake (the gut gone, both
     legs, the blood: CBZ.vitals' "critical") does not lie there like a
     sleeper waiting for the medic. He gets himself away from the gun:
     face down he reaches out along the floor and pulls himself up to the
     hand, on his back he digs his heels in and shoves himself along, head
     first, in pulls with a rest between (MP's dragPose plays the limbs, this
     moves the root through the one mover). Never toward what shot him, never
     while hands are on him, a few metres and he is spent.
     drag(a, dt, from{x,z}?) -> true while he is dragging
     ============================================================ */
  const DRAG_CYC = 1.5, DRAG_V = 0.6, DRAG_MAX = 3.5;
  const _dgO = { posture: "down", radius: 0.3, feet: 0.05, height: 0.5, cars: false,
    out: { hit: false, nx: 0, nz: 0, c: null, pushed: false, landed: false, y: 0, floor: 0 } };
  function drag(a, dt, from) {
    const ch = rigOf(a), g = grpOf(a);
    const f = ch && ch.fall;
    const d = ch ? ch._drag : null;
    const held = !!(CBZ.verbs && typeof CBZ.verbs.held === "function" && CBZ.verbs.held(a));
    const ok = !!(g && f && f.on && f.phase === "down" && !f.ko && (f.variant === "back" || f.variant === "face") &&
      !a.dead && !a.isPlayer && !(a._bf && a._bf.on) && !held && !a.cuffed && !(ch && ch.cuffed));
    if (!ok || (d && d.went >= DRAG_MAX)) { if (d) d.on = false; a._dragT = 0; return false; }
    const D = d || (ch._drag = { on: false, t: 0, went: 0 });
    const ya = g.rotation.y || 0, hs = f.variant === "face" ? 1 : -1;
    const hx = Math.sin(ya) * hs, hz = Math.cos(ya) * hs;
    if (!D.on && from && from.x != null) {
      // his head points back at the gun: he lies still rather than crawl to it
      const ax = g.position.x - from.x, az = g.position.z - from.z;
      if (ax * hx + az * hz < -0.2 * Math.hypot(ax, az)) return false;
    }
    D.on = true; D.t += dt; a._dragT = 0.25;
    const ph = (D.t % DRAG_CYC) / DRAG_CYC;
    const pull = ph > 0.45 ? Math.sin((ph - 0.45) / 0.55 * Math.PI) : 0;
    const step = DRAG_V * pull * dt;
    if (step > 0) {
      if (CBZ.bodyMove) {
        const sw = CBZ.bodyMove(g.position, hx * step, 0, hz * step, _dgO);
        if (sw && sw.hit) D.went = DRAG_MAX;                // up against something: he stops there
      } else { g.position.x += hx * step; g.position.z += hz * step; }
      D.went += step;
    }
    return true;
  }

  CBZ.bodyFall = {
    plan, start, tick, getUp, poke, clear, resume, unwall, floorOnly, drag,
    active(a) { return !!(a && a._bf && a._bf.on); },
    asleep(a) { return !!(a && a._bf && a._bf.on && a._bf.asleep); },
    FALL_DRIFT,
  };
})();
