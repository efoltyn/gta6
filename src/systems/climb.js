/* ============================================================
   systems/climb.js — LADDERS. One climb for every body in every game.

   OWNER: "a ladders agent about getting up to the tower and also getting
   down from the tower, because nobody comes down from those towers right
   now."

   WHAT WAS HERE: the tower ladders were `vents` with `ladder:true`, and
   pressing E on one blacked the screen, set player.pos to the other end and
   faded back (systems/interactions.js climbLadder). Nobody climbed; the
   rungs were a picture. No NPC could use them at all, so a tower guard could
   never come down and a guard could never follow you up. That teleport is
   deleted. This file is the climb.

   THE LADDER (CBZ.climb.add(spec) — or push the spec on CBZ.ladderSpecs
   before this file has loaded; it drains that queue):
     x, z      the rung line at its foot (world)
     nx, nz    unit normal: from the rungs toward the side a climber hangs on
     y0, y1    the floor at the foot, the floor at the head (the landing)
     rung      rung pitch (0.30), r0 first rung above y0 (0.35)
     rungTop   highest rung (default y1): a hatch ladder's rails and rungs
               run on past the landing, and the hands use them to come off
     stand     how far the climber's feet line hangs off the rungs (0.42)
     bottom    {x,z} where you stand at the foot (default 0.75 out along n)
     top       {x,z} where you stand at the head (default 0.6 past the rungs)
     name, tag, meta   free data (the prison tower hangs its record on meta)
     over      {x, y, z}: a FENCE, not a ladder. There is no landing at the
               head (y1 is the top rail): at the top you swing over it and
               drop down the far side onto (x, y, z). The Bullring's catch
               fence (city/island_speedway.js) is climbed this way, both ways.

   THE CLIMB (a body, not a fade):
     mount     walk up to the foot and take it (E, or walk into it facing
               it), or at the head turn round and back onto it;
     climb     rung by rung: a diagonal gait (right hand with left foot, then
               left hand with right foot), every hand SOLVED onto its rung
               (CBZ.charArmTo, the arm contact solver, in the "grip" pose) and
               every foot solved onto its rung (a two-bone leg solve here);
               W up, S down, Shift+S slides down the rails, Space lets go;
               it always settles onto a rung, never with a hand in the air;
     dismount  over the top / out of the hatch onto the landing, or off the
               last rung onto the floor;
     interrupt a hit (a round, a stomp, a blast) knocks you off: you FALL,
               and in the prison a fall off a tower is paid in blood.
   Cuffed hands cannot climb. A drawn gun is put away (slung) for the climb
   and comes back at the top or the bottom. First and third person: in first
   person your own bare hands take the rungs (systems/fpsmode.js fpPlants
   reads CBZ.climb.fpSource()).

   NPCs: CBZ.climb.start(actor, ladder, "up"|"down", opts) hands the body to
   this file for the climb; the caller's own loop skips it while
   CBZ.climb.owns(actor). CBZ.climb.detour(actor, tx, ty, tz) is the NAV LINK:
   a brain walking to a point on another level asks it where to walk first
   (a ladder's foot or head), and when the body is standing there the link
   starts the climb itself. entities/guards.js (every walk) and entities/
   npc.js (every wander) ask it, so a guard follows you up a tower and comes
   back down it.

   physics.js carries ONE line for this: `if (CBZ.climb && CBZ.climb.
   playerStep(dt)) return;` — while you are on a ladder this file owns your
   transform the way a vehicle does.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const player = CBZ.player;

  const PI = Math.PI;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function wrapA(a) { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; }
  function lerpA(a, b, t) { return a + wrapA(b - a) * t; }

  /* ================================================================
     1. THE LADDERS
     ================================================================ */
  const LADDERS = [];
  let seq = 0;
  function add(s) {
    if (!s || !isFinite(+s.x) || !isFinite(+s.z) || !isFinite(+s.y1)) return null;
    let nx = +s.nx || 0, nz = +s.nz || 0;
    const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    if (!(Math.hypot(nx, nz) > 0.5)) { nx = 0; nz = 1; }
    const y0 = +s.y0 || 0, y1 = +s.y1;
    const R = s.rung || 0.30, r0 = s.r0 != null ? s.r0 : 0.35;
    const rungTop = s.rungTop != null ? s.rungTop : y1;
    const L = {
      id: ++seq, x: +s.x, z: +s.z, nx: nx, nz: nz, px: -nz, pz: nx,
      y0: y0, y1: y1, R: R, r0: r0,
      iMax: Math.max(1, Math.floor((rungTop - y0 - r0) / R + 1e-6)),
      stand: s.stand || 0.42,
      bottom: s.bottom || { x: +s.x + nx * 0.8, z: +s.z + nz * 0.8 },
      top: s.top || { x: +s.x - nx * 0.6, z: +s.z - nz * 0.6 },
      name: s.name || "", tag: s.tag || "", meta: s.meta || null,
      mode: s.mode || null,             // game mode it belongs to (null = any)
      // topVia {cx, cz, r, x, z}: a landing inside a room (a tower cabin) is
      // left through its door: inside r of (cx,cz), walk to (x,z) first
      topVia: s.topVia || null,
      over: s.over && isFinite(+s.over.x) && isFinite(+s.over.y) && isFinite(+s.over.z)
        ? { x: +s.over.x, y: +s.over.y, z: +s.over.z } : null,
      climber: null,
    };
    L.cx = L.x + nx * L.stand; L.cz = L.z + nz * L.stand;   // the body's column
    L.yaw = Math.atan2(-nx, -nz);                            // facing the rungs
    L.sTop = y1 - y0;
    LADDERS.push(L);
    return L;
  }
  function remove(L) { const i = LADDERS.indexOf(L); if (i >= 0) LADDERS.splice(i, 1); }
  function removeTag(tag) { for (let i = LADDERS.length - 1; i >= 0; i--) if (LADDERS[i].tag === tag) LADDERS.splice(i, 1); }
  function modeOk(L) { return !L.mode || !CBZ.game || CBZ.game.mode === L.mode; }
  // a rung's point: index i (-1 = the floor at the foot), `lat` metres across
  function rungPt(L, i, lat, out) {
    const y = i < 0 ? L.y0 : L.y0 + L.r0 + i * L.R;
    return out.set(L.x + L.px * lat, y, L.z + L.pz * lat);
  }

  /* ================================================================
     2. THE BODY ON THE RUNGS — a diagonal gait read off one number, `s`,
        the height of the climber's feet line above the foot of the ladder.
        Each limb holds its rung for half a 0.6 m cycle and moves two rungs
        in the other half; the diagonal pairs are half a cycle apart.
     ================================================================ */
  const CYC = 0.6;
  // rung index (fractional while moving) and the move's ease for one limb pair
  function pairIdx(s, off, out) {
    const u = (s - off) / CYC;
    const f = Math.floor(u), fr = u - f;
    const e = smooth(fr * 2);
    out.i = 2 * f + 2 * e; out.e = fr < 0.5 ? e : 1; out.m = fr < 0.5 ? Math.sin(PI * e) : 0;
    return out;
  }
  const _pa = { i: 0, e: 0, m: 0 }, _pb = { i: 0, e: 0, m: 0 };
  const HAND_UP = 5;                    // hands ride five rungs above their foot
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3();

  /* THE LEG, SOLVED. Hip -> knee -> ankle in the leg's own sagittal plane
     (model space: +y up, +z the way he faces). Measured off the live rig
     (knee = the leg's `low` group, ankle = the foot group), so any build's
     legs land on the same rung. */
  function legTo(ch, side, world, w) {
    const leg = ch.parts && ch.parts[side], knee = ch.low && ch.low[side];
    if (!leg || !knee || !leg.parent || w <= 0) return;
    const foot = ch.feet && ch.feet[side];
    leg.parent.updateWorldMatrix(true, false);
    _t.copy(world); leg.parent.worldToLocal(_t);
    const dy = _t.y - leg.position.y, dz = _t.z - leg.position.z;
    const L1 = Math.max(0.1, knee.position.length());
    const L2 = Math.max(0.1, foot ? foot.position.length() : L1);
    const D = clamp(Math.hypot(dy, dz), Math.abs(L1 - L2) + 0.02, (L1 + L2) * 0.998);
    const k = Math.acos(clamp((D * D - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));
    const phi = Math.atan2(-dz, -dy);
    const th = phi - Math.atan2(L2 * Math.sin(k), L1 + L2 * Math.cos(k));
    leg.rotation.x += (th - leg.rotation.x) * w;
    leg.rotation.y += (0 - leg.rotation.y) * w;
    knee.rotation.x += (k - knee.rotation.x) * w;
    knee.rotation.y += (0 - knee.rotation.y) * w;
    knee.rotation.z += (0 - knee.rotation.z) * w;
    // the sole level on the rung, the ball of the foot on the bar
    if (foot) foot.rotation.x += (-(th + k) + 0.08 - foot.rotation.x) * w;
  }
  function armTo(ch, arm, world, w) {
    const A = CBZ.charArmTo;
    if (!A || w <= 0) return;
    try { A(ch, world, arm, w); } catch (e) {}
    if (ch.setHandPose) ch.setHandPose(arm, w > 0.35 ? "grip" : "relaxed");
  }
  // which side of the ladder each limb is on, read off the rig itself (never
  // a guess about which way "left" is authored)
  function sidesOf(ch, L, C) {
    const P = ch.parts || {};
    const side = function (part) {
      if (!part) return 1;
      part.getWorldPosition(_v);
      return ((_v.x - L.cx) * L.px + (_v.z - L.cz) * L.pz) >= 0 ? 1 : -1;
    };
    // measured as he will hang: facing the rungs
    const y0 = ch.group.rotation.y, px = ch.group.position.x, pz = ch.group.position.z;
    ch.group.rotation.y = L.yaw; ch.group.position.x = L.cx; ch.group.position.z = L.cz;
    ch.group.updateMatrixWorld(true);
    C.sRA = side(P.ra); C.sLA = -C.sRA;
    C.sLL = side(P.ll); C.sRL = -C.sLL;
    ch.group.rotation.y = y0; ch.group.position.x = px; ch.group.position.z = pz;
    ch.group.updateMatrixWorld(true);
  }
  /* Put the limbs on the ladder at climb height s, weight w (0..1).
     `slide`: sliding down the rails — hands on the stiles, feet off the
     rungs on the rails, no gait. */
  function poseLimbs(ch, L, C, s, w, slide) {
    if (!ch || !ch.parts || w <= 0.001) return;
    ch.group.updateMatrixWorld(true);
    const nx = L.nx, nz = L.nz;
    if (slide) {
      const hy = L.y0 + s + 1.45, fy = L.y0 + s + 0.25;
      _w.set(L.x + L.px * 0.24 * C.sRA + nx * 0.05, hy, L.z + L.pz * 0.24 * C.sRA + nz * 0.05); armTo(ch, "r", _w, w);
      _w.set(L.x + L.px * 0.24 * C.sLA + nx * 0.05, hy + 0.12, L.z + L.pz * 0.24 * C.sLA + nz * 0.05); armTo(ch, "l", _w, w);
      _w.set(L.x + L.px * 0.2 * C.sLL + nx * 0.16, fy, L.z + L.pz * 0.2 * C.sLL + nz * 0.16); legTo(ch, "ll", _w, w);
      _w.set(L.x + L.px * 0.2 * C.sRL + nx * 0.16, fy + 0.3, L.z + L.pz * 0.2 * C.sRL + nz * 0.16); legTo(ch, "rl", _w, w);
      return;
    }
    // pair A: right hand + left foot; pair B: left hand + right foot
    pairIdx(s, 0, _pa); pairIdx(s, 0.3, _pb);
    const fA = _pa.i - 1, fB = _pb.i;
    const hA = Math.min(L.iMax, fA + HAND_UP), hB = Math.min(L.iMax, fB + HAND_UP);
    const limb = function (idx, lat, off, up, arc) {
      const i0 = Math.floor(idx), fr = idx - i0;
      rungPt(L, i0, lat, _c);
      if (fr > 1e-4) { rungPt(L, i0 + 1, lat, _w); _c.lerp(_w, fr); }
      _c.x += nx * (off + arc); _c.z += nz * (off + arc); _c.y += up;
      return _c;
    };
    // hands: the wrist a touch below the bar and on the climber's side of it
    armTo(ch, "r", limb(hA, 0.17 * C.sRA, 0.05, -0.04, 0.11 * _pa.m), w);
    armTo(ch, "l", limb(hB, 0.17 * C.sLA, 0.05, -0.04, 0.11 * _pb.m), w);
    // feet: the ankle over the rung, the ball of the foot on it; the floor
    // (index -1) is stood on a pace back from the rails
    legTo(ch, "ll", limb(fA, 0.12 * C.sLL, fA < 0 ? 0.22 : 0.10, fA < 0 ? 0.09 : 0.085, 0.10 * _pa.m), w);
    legTo(ch, "rl", limb(fB, 0.12 * C.sRL, fB < 0 ? 0.22 : 0.10, fB < 0 ? 0.09 : 0.085, 0.10 * _pb.m), w);
    // a clank on each rung the gait takes
    const step = Math.floor(s / 0.3);
    if (C.lastStep != null && step !== C.lastStep && w > 0.5) clank(C);
    C.lastStep = step;
  }
  function clank(C) {
    if (!CBZ.sfx) return;
    const p = posOf(C.who);
    const d = C.who.isPlayer ? null : Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
    if (d != null && d > 30) return;
    try { CBZ.sfx("step", d == null ? { volume: 0.45 } : { dist: d, volume: 0.4, ghost: true }); } catch (e) {}
  }

  /* ================================================================
     3. CLIMBERS — the player and NPCs share one record and one tick.
     ================================================================ */
  const PLAYER = { isPlayer: true };
  const LIVE = new Map();                 // actor -> climb record
  function chOf(a) { return a.isPlayer ? CBZ.playerChar : a.char; }
  function posOf(a) {
    if (a.isPlayer) return player.pos;
    if (a.pos && a.pos.isVector3 && a.group && a.pos !== a.group.position) return a.pos;
    return a.group.position;
  }
  function setPos(a, x, y, z) {
    const p = posOf(a);
    p.set(x, y, z);
    if (a.isPlayer) { const pc = CBZ.playerChar; if (pc) pc.group.position.copy(p); }
    else if (a.group && a.group.position !== p) a.group.position.copy(p);
  }
  function setYaw(a, yaw) {
    const ch = chOf(a);
    if (ch && ch.group) ch.group.rotation.y = yaw;
    if (!a.isPlayer && a.yaw != null) a.yaw = yaw;
  }
  function yawOf(a) { const ch = chOf(a); return ch && ch.group ? ch.group.rotation.y : 0; }
  function anim(ch, dt) { if (ch && CBZ.animChar) { try { CBZ.animChar(ch, 0, dt); } catch (e) {} } }
  function hpOf(a) { return a.isPlayer ? (player.hp == null ? 100 : player.hp) : (a.hp == null ? 100 : a.hp); }

  // a gun in the hands goes away for the climb (slung), and comes back after
  function stowGun(C) {
    const a = C.who;
    if (a.isPlayer) {
      const armed = CBZ.fpsArmed ? CBZ.fpsArmed() : false;
      if (armed && CBZ.playerHolster && CBZ.playerHolster(true)) C.redraw = true;
      else if (armed) return false;
      return true;
    }
    if (a.armed && a.weapon && !a._holstered && CBZ.actorHolster) { CBZ.actorHolster(a, true); C.redraw = true; }
    return true;
  }
  function drawGun(C) {
    if (!C.redraw) return;
    C.redraw = false;
    const a = C.who;
    if (a.isPlayer) { if (CBZ.playerHolster) CBZ.playerHolster(false); }
    else if (CBZ.actorHolster && !a.dead) CBZ.actorHolster(a, false);
  }

  function canClimb(a) {
    if (a.isPlayer) {
      if (player.dead || player.ko > 0 || player.driving || player._doorArc || player._traversal) return false;
      if (CBZ.cuffedPlayer && CBZ.cuffedPlayer.on && CBZ.cuffedPlayer.on()) return false;
      if (CBZ.verbs && CBZ.verbs.playerHeld && CBZ.verbs.playerHeld()) return false;
      if (player.captureState && player.captureState !== "normal") return false;
      if (CBZ.crawling) return false;
      return true;
    }
    if (a.dead || a.ko > 0 || a.tied || a.asleep || a._escort) return false;
    if (a.char && a.char.cuffed) return false;
    if (CBZ.verbs && CBZ.verbs.held && CBZ.verbs.held(a)) return false;
    return true;
  }

  /* start a climb. dir "up" (mounted at the foot) or "down" (at the head). */
  function start(a, L, dir, opts) {
    if (!a || !L || LIVE.has(a) || !canClimb(a)) return false;
    if (L.climber && L.climber !== a) return false;        // one body on a ladder
    const ch = chOf(a);
    if (!ch || !ch.group) return false;
    opts = opts || {};
    const p = posOf(a);
    const C = {
      who: a, L: L, ch: ch, dir: dir === "down" ? -1 : 1,
      ph: dir === "down" ? "mountTop" : "mount", t: 0,
      s: dir === "down" ? L.sTop : 0, w: 0, want: 0, lastMove: dir === "down" ? -1 : 1,
      fx: p.x, fy: p.y, fz: p.z, fyaw: yawOf(a),
      speedUp: opts.speedUp || (a.isPlayer ? 1.3 : 1.05),
      speedDown: opts.speedDown || (a.isPlayer ? 1.55 : 1.3),
      onDone: opts.onDone || null, hp: hpOf(a), lastStep: null, redraw: false,
      slide: false, fall: null,
    };
    if (!stowGun(C)) return false;
    sidesOf(ch, L, C);
    L.climber = a;
    LIVE.set(a, C);
    a._climb = C;
    if (a.isPlayer) {
      player.crouch = false; player.prone = false; player.speed = 0; player.vy = 0;
      if (CBZ.playerChar) { CBZ.playerChar.crouch = false; CBZ.playerChar.pronePose = false; CBZ.playerChar.airPose = null; CBZ.playerChar.landPose = null; }
    } else if (CBZ.moves && CBZ.moves.reset) {
      try { CBZ.moves.reset(CBZ.moves.motor(a), posOf(a)); } catch (e) {}
    }
    if (CBZ.sfx && a.isPlayer) { try { CBZ.sfx("cloth", { volume: 0.4 }); } catch (e) {} }
    return true;
  }
  function finish(C, where) {
    const a = C.who;
    LIVE.delete(a);
    if (C.L.climber === a) C.L.climber = null;
    a._climb = null;
    const ch = C.ch;
    if (ch && ch.setHandPose) { try { ch.setHandPose("both", "relaxed"); } catch (e) {} }
    if (a.isPlayer) { player.vy = 0; player.grounded = true; }
    else if (CBZ.moves && CBZ.moves.reset) { try { CBZ.moves.reset(CBZ.moves.motor(a), posOf(a)); } catch (e) {} }
    drawGun(C);
    if (C.onDone) { try { C.onDone(a, where, C.L); } catch (e) {} }
  }

  /* ---- THE FALL: knocked or let go. The player falls under physics.js's own
     gravity (this file only watches the landing, to charge it in the prison);
     an NPC falls here, and lands in systems/bodyfall.js's collapse. */
  function knockOff(a, dirX, dirZ, why) {
    const C = a ? LIVE.get(a.isPlayer ? PLAYER : a) : null;
    if (!C || C.fall) return false;
    const L = C.L, p = posOf(C.who);
    const ox = dirX != null ? dirX : L.nx, oz = dirZ != null ? dirZ : L.nz;
    if (L.climber === C.who) L.climber = null;
    drawGun(C);
    if (C.ch && C.ch.setHandPose) { try { C.ch.setHandPose("both", "open"); } catch (e) {} }
    if (C.who.isPlayer) {
      LIVE.delete(PLAYER); PLAYER._climb = null;
      // off the rungs and falling: physics.js takes the body from here
      setPos(PLAYER, p.x + ox * 0.25, p.y, p.z + oz * 0.25);
      player.vy = why === "let go" ? 0 : 1.2; player.grounded = false;
      const ph = player._phys;
      if (why !== "let go" && ph) { ph.air = true; ph.vx = ox * 1.6; ph.vz = oz * 1.6; ph.vy = 1.5; ph.spin = -1.4; }
      FALL.on = true; FALL.y0 = p.y; FALL.t = 0;
      return true;
    }
    C.fall = { vx: ox * 1.8, vz: oz * 1.8, vy: why === "let go" ? 0 : 1.2, y0: p.y, t: 0, spin: 0 };
    C.ph = "fall";
    return true;
  }
  const FALL = { on: false, y0: 0, t: 0 };
  function groundAt(x, z, y) { return CBZ.groundAt ? CBZ.groundAt(x, z, y) : 0; }

  // a hit while hanging on: how hard it has to be to lose the rungs
  function hitCheck(C) {
    const hp = hpOf(C.who);
    const lost = C.hp - hp;
    C.hp = hp;
    if (!(lost > 0)) return false;
    if (lost >= 25) return true;
    return lost >= 10 && Math.random() < lost / 30;
  }

  function tick(C, dt) {
    const a = C.who, L = C.L, ch = C.ch;
    // the body can be taken away from the ladder by the game (a new run, a
    // scene, a death card, a cuff): let go of it quietly
    if (!a.isPlayer && a.dead && C.ph !== "fall") { knockOff(a, null, null, "dead"); }
    if (C.ph === "fall") return fallTick(C, dt);
    if ((a.isPlayer && (player.dead || player.ko > 0)) || (!a.isPlayer && (a.ko > 0))) { knockOff(a, null, null, "ko"); return; }
    if (hitCheck(C) && C.s > 0.4 && C.s < L.sTop + 0.01) { knockOff(a, null, null, "hit"); return; }
    if (a.isPlayer && player._phys && (player._phys.air || player._phys.down > 0)) { knockOff(a, null, null, "blast"); return; }

    C.t += dt;
    let x = L.cx, z = L.cz, yaw = L.yaw, y = L.y0 + C.s;
    let w = 1;
    if (C.ph === "mount") {
      const k = smooth(C.t / 0.42);
      x = C.fx + (L.cx - C.fx) * k; z = C.fz + (L.cz - C.fz) * k; y = C.fy + (L.y0 - C.fy) * k;
      yaw = lerpA(C.fyaw, L.yaw, smooth(C.t / 0.3));
      w = k;
      if (C.t >= 0.42) { C.ph = "climb"; C.t = 0; }
    } else if (C.ph === "mountTop") {
      // turn round at the head and back onto the rungs
      const k = smooth(C.t / 0.95);
      x = C.fx + (L.cx - C.fx) * k; z = C.fz + (L.cz - C.fz) * k;
      y = C.fy + (L.y1 - C.fy) * k;
      yaw = lerpA(C.fyaw, L.yaw, smooth(C.t / 0.55));
      w = smooth((C.t - 0.2) / 0.75);
      if (C.t >= 0.95) { C.ph = "climb"; C.t = 0; }
    } else if (C.ph === "climb") {
      const want = a.isPlayer ? playerWant(C) : C.dir;
      C.slide = a.isPlayer && want < 0 && !!(CBZ.keys && CBZ.keys["shift"]) && C.s > 1.2;
      let v = 0;
      if (want > 0) v = C.speedUp; else if (want < 0) v = C.slide ? 4.2 : C.speedDown;
      let mv = want;
      if (!want) {
        // never stop with a limb in the air: finish onto the next rung
        const r = C.s / 0.3, near = Math.round(r);
        if (Math.abs(r - near) > 0.02) { mv = C.lastMove; v = C.lastMove > 0 ? C.speedUp : C.speedDown; }
      }
      if (mv) {
        C.lastMove = mv;
        let ns = C.s + mv * v * dt;
        if (!want) {
          // stop exactly on the rung we were heading for
          const tgt = mv > 0 ? Math.ceil(C.s / 0.3 - 0.02) * 0.3 : Math.floor(C.s / 0.3 + 0.02) * 0.3;
          if ((mv > 0 && ns >= tgt) || (mv < 0 && ns <= tgt)) ns = tgt;
        }
        C.s = clamp(ns, 0, L.sTop);
      }
      y = L.y0 + C.s;
      if (a.isPlayer && CBZ.keys && CBZ.keys[" "] && !C._jumpLatch) {
        C._jumpLatch = true;
        if (C.s > 0.9) { knockOff(a, L.nx, L.nz, "let go"); return; }
      }
      if (C.s >= L.sTop - 1e-4 && mv > 0) { C.ph = L.over ? "over" : "offTop"; C.t = 0; C.fyaw = L.yaw; }
      else if (C.s <= 1e-4 && mv < 0) { C.ph = "offBottom"; C.t = 0; }
    } else if (C.ph === "offTop") {
      const T = L.top, k = smooth(C.t / 0.9);
      x = L.cx + (T.x - L.cx) * k; z = L.cz + (T.z - L.cz) * k;
      y = L.y1 + Math.sin(PI * clamp(C.t / 0.9, 0, 1)) * 0.12;
      const dx = T.x - L.cx, dz = T.z - L.cz;
      if (Math.hypot(dx, dz) > 0.25) yaw = lerpA(L.yaw, Math.atan2(dx, dz), smooth((C.t - 0.3) / 0.6));
      w = 1 - smooth((C.t - 0.1) / 0.75);
      C.s = L.sTop;
      if (C.t >= 0.9) { place(a, T.x, L.y1, T.z, yaw); anim(ch, dt); finish(C, "top"); return; }
    } else if (C.ph === "over") {
      // a leg over the top rail and the body after it: from the near column
      // to the far one, a hand's height over the rail, still facing the way
      // you were climbing (forward, over it)
      const T = 0.85, k = smooth(C.t / T);
      const fx = L.x - L.nx * L.stand, fz = L.z - L.nz * L.stand;
      x = L.cx + (fx - L.cx) * k; z = L.cz + (fz - L.cz) * k;
      y = L.y1 + Math.sin(PI * clamp(C.t / T, 0, 1)) * 0.35;
      w = 1 - smooth((C.t - 0.15) / 0.6);
      C.s = L.sTop;
      if (C.t >= T) { C.ph = "drop"; C.t = 0; C.fx = fx; C.fz = fz; }
    } else if (C.ph === "drop") {
      // let go on the far side and drop onto the ground there (feet first:
      // a fall you chose, not one that put you down)
      const O = L.over, h = Math.max(0, L.y1 - O.y);
      const Td = clamp(Math.sqrt(2 * h / 9.8), 0.3, 1.1), p = clamp(C.t / Td, 0, 1);
      x = C.fx + (O.x - C.fx) * p; z = C.fz + (O.z - C.fz) * p;
      y = L.y1 - h * p * p;
      w = 0;
      if (p >= 1) { place(a, O.x, O.y, O.z, yaw); anim(ch, dt); finish(C, "over"); return; }
    } else if (C.ph === "offBottom") {
      const B = L.bottom, k = smooth(C.t / 0.45);
      x = L.cx + (B.x - L.cx) * k; z = L.cz + (B.z - L.cz) * k; y = L.y0;
      w = 1 - k;
      if (C.t >= 0.45) { place(a, B.x, L.y0, B.z, yaw); anim(ch, dt); finish(C, "bottom"); return; }
    }
    place(a, x, y, z, yaw);
    C.w = w;
    anim(ch, dt);
    poseLimbs(ch, L, C, C.s, w, C.slide);
    if (a.isPlayer) {
      player.speed = 0; player.vy = 0; player.grounded = true;
      if (player._airT) player._airT = 0;
      // never draw on a ladder: both hands are on it
      if (CBZ.fpsArmed && CBZ.fpsArmed() && CBZ.playerHolster && CBZ.playerHolster(true)) C.redraw = true;
    }
  }
  function place(a, x, y, z, yaw) {
    setPos(a, x, y, z);
    setYaw(a, yaw);
    const ch = chOf(a);
    if (ch && ch.group) { ch.group.rotation.x = 0; ch.group.rotation.z = 0; }
  }
  function playerWant(C) {
    const K = CBZ.keys || {};
    if (!K[" "]) C._jumpLatch = false;
    const stunned = player.stun > 0;
    if (stunned) return 0;
    if (K["w"] && !K["s"]) return 1;
    if (K["s"] && !K["w"]) return -1;
    return 0;
  }

  function fallTick(C, dt) {
    const a = C.who, F = C.fall, p = posOf(a), ch = C.ch;
    F.t += dt;
    F.vy -= 9.8 * dt;
    let x = p.x + F.vx * dt, z = p.z + F.vz * dt, y = p.y + F.vy * dt;
    const fl = groundAt(x, z, y + 0.3);
    if (ch && ch.group) {
      ch.group.rotation.x = CBZ.damp ? CBZ.damp(ch.group.rotation.x, -0.9, 3, dt) : ch.group.rotation.x;
    }
    if (y <= fl) {
      y = fl;
      setPos(a, x, y, z);
      if (ch && ch.group) ch.group.rotation.x = 0;
      const h = F.y0 - fl;
      LIVE.delete(a); a._climb = null;
      if (C.L.climber === a) C.L.climber = null;
      landNpc(a, h, F);
      if (C.onDone) { try { C.onDone(a, "fell", C.L); } catch (e) {} }
      return;
    }
    setPos(a, x, y, z);
    if (ch && !a.dead) anim(ch, dt);
  }
  // an NPC off a ladder: a long drop kills, a short one puts him down
  function landNpc(a, h, F) {
    if (CBZ.sfx) { const d = Math.hypot(posOf(a).x - player.pos.x, posOf(a).z - player.pos.z); try { CBZ.sfx("ko", { dist: d, volume: 0.7, ghost: true }); } catch (e) {} }
    const dirX = F.vx || 0, dirZ = F.vz || 1;
    if (!a.dead && h > 7.5) {
      a.hp = 0;
      if (CBZ.aiKill && CBZ.game && CBZ.game.mode === "escape") { try { CBZ.aiKill(a, null, { noKnock: true }); } catch (e) { a.dead = true; } }
      else a.dead = true;
    } else if (!a.dead && h > 1.5) {
      a.hp = Math.max(1, (a.hp == null ? 100 : a.hp) - h * 9);
      a.ko = Math.max(a.ko || 0, 2.5 + h * 0.8);
    }
    const B = CBZ.bodyFall;
    if (B && B.start) { try { B.start(a, { dirX: dirX, dirZ: dirZ, force: 1.5, dead: !!a.dead, landed: true }); } catch (e) {} }
  }

  /* ---- the player's landing after a fall off a ladder. A man knocked off
     the rungs lands through physics.js's thrown-body path, which has no
     landing charge of its own, so this watches for it and hands the height
     to the prison's one fall rule (systems/capture.js CBZ.prisonFallLand,
     which also takes physics.js's ordinary landings and charges once). */
  function fallWatch(dt) {
    if (!FALL.on) return;
    FALL.t += dt;
    if (FALL.t > 8) { FALL.on = false; return; }
    const ph = player._phys;
    const airborne = !player.grounded || (ph && ph.air);
    if (airborne && FALL.t < 0.1) return;
    if (airborne) return;
    FALL.on = false;
    const h = FALL.y0 - player.pos.y;
    if (!(h > 2.5) || !CBZ.game || CBZ.game.mode !== "escape") return;
    if (CBZ.prisonFallLand) { try { CBZ.prisonFallLand(h, { knocked: true }); } catch (e) {} }
  }

  /* ================================================================
     4. THE PLAYER — walk up to it, take it.
     ================================================================ */
  const REACH_FOOT = 0.95, REACH_HEAD = 1.05;
  let armed = null;                        // {L, dir} the verb on screen is about
  function nearestFor(x, y, z) {
    let best = null, bd = 1e9;
    for (let i = 0; i < LADDERS.length; i++) {
      const L = LADDERS[i];
      if (!modeOk(L) || (L.climber && L.climber !== PLAYER)) continue;
      if (Math.abs(y - L.y0) < 0.6) {
        const d = Math.hypot(x - L.cx, z - L.cz);
        const d2 = Math.hypot(x - L.bottom.x, z - L.bottom.z);
        const dd = Math.min(d, d2);
        if (dd < REACH_FOOT && dd < bd) { bd = dd; best = { L: L, dir: "up", d: dd }; }
      }
      if (Math.abs(y - L.y1) < 0.6) {
        const d = Math.min(Math.hypot(x - L.top.x, z - L.top.z), Math.hypot(x - L.cx, z - L.cz));
        if (d < REACH_HEAD && d < bd) { bd = d; best = { L: L, dir: "down", d: d }; }
      }
    }
    return best;
  }
  function grab() {
    if (!armed || LIVE.has(PLAYER)) return false;
    return start(PLAYER, armed.L, armed.dir);
  }
  CBZ.climbGrab = grab;                     // the verb's act (@climbGrab)

  function playerIdle(dt) {
    armed = null;
    if (!CBZ.game || CBZ.game.state !== "playing" || !canClimb(PLAYER)) return;
    const pp = player.pos;
    const n = nearestFor(pp.x, pp.y, pp.z);
    if (!n) return;
    armed = n;
    const L = n.L;
    const at = n.dir === "up"
      ? { x: L.x, y: L.y0 + 1.4, z: L.z }
      : { x: L.x, y: L.y1 + 0.9, z: L.z };
    if (CBZ.prisonPrompt) CBZ.prisonPrompt("climb", "@climbGrab", n.dir === "up" ? (L.over ? "Climb over" : "Climb") : "Climb down",
      { at: at, d2: n.d * n.d, bind: true, key: "e", city: true });
    // walking INTO the foot of it, facing it, takes it (the way a body does)
    if (n.dir === "up" && CBZ.keys && CBZ.keys["w"] && n.d < 0.6) {
      const fwdX = -Math.sin(CBZ.cam ? CBZ.cam.yaw : 0), fwdZ = -Math.cos(CBZ.cam ? CBZ.cam.yaw : 0);
      if (fwdX * -L.nx + fwdZ * -L.nz > 0.82) start(PLAYER, L, "up");
    }
  }

  /* the physics.js hook: while on a ladder this file owns the transform */
  function playerStep(dt) {
    const C = LIVE.get(PLAYER);
    if (!C) return false;
    tick(C, dt);
    // the lens faces the rungs while you mount (first person looks where
    // your hands are going; the chase camera swings in behind you)
    if (LIVE.get(PLAYER) === C && (C.ph === "mount" || C.ph === "mountTop") && CBZ.cam) {
      const want = Math.atan2(C.L.nx, C.L.nz);
      CBZ.cam.yaw = lerpA(CBZ.cam.yaw, want, 1 - Math.exp(-6 * dt));
    }
    // (a climb that ended inside this call placed the body itself; physics
    // takes it from the next frame)
    return true;
  }

  /* ================================================================
     5. THE NAV LINK — where a body on one level walks to reach another.
     detour(actor, tx, ty, tz): null when the target is on the actor's own
     level; otherwise { x, z } to walk to (a ladder's foot or head), and when
     the body is standing there it starts the climb itself and returns
     { climbing: true }. `ty` undefined = the floor under the target.
     ================================================================ */
  const LEVEL = 1.6;
  function levelOf(x, z, y) { return y != null && isFinite(y) ? y : groundAt(x, z, 0.5); }
  function detour(a, tx, ty, tz, opts) {
    if (!a || LIVE.has(a) || !LADDERS.length) return null;
    const p = posOf(a);
    const ay = p.y || 0;
    ty = levelOf(tx, tz, ty);
    // a target hanging on a ladder: go to that ladder
    const onL = findOnLadder(tx, ty, tz);
    if (!onL && Math.abs(ty - ay) < LEVEL) return null;
    let best = null, bc = 1e9;
    const cands = onL ? [onL] : LADDERS;
    for (let i = 0; i < cands.length; i++) {
      const L = cands[i];
      if (!modeOk(L)) continue;
      let dir = 0, ex = 0, ez = 0, cost = 0;
      if (Math.abs(ay - L.y0) < 1.2 && (onL || Math.abs(ty - L.y1) < LEVEL)) {
        // up: the target stands near the head of this one
        const reach = Math.hypot(tx - L.top.x, tz - L.top.z);
        if (!onL && reach > 14) continue;
        dir = 1; ex = L.bottom.x; ez = L.bottom.z;
        cost = Math.hypot(p.x - ex, p.z - ez) + reach;
      } else if (Math.abs(ay - L.y1) < 1.2 && (onL || ty < L.y1 - LEVEL)) {
        // down: the only way off the landing he is standing on
        const onDeck = Math.hypot(p.x - L.top.x, p.z - L.top.z);
        if (onDeck > 14) continue;
        dir = -1; ex = L.top.x; ez = L.top.z;
        cost = onDeck + Math.hypot(tx - L.bottom.x, tz - L.bottom.z) * 0.2;
      } else continue;
      if (cost < bc) { bc = cost; best = { L: L, dir: dir, x: ex, z: ez }; }
    }
    if (!best) return null;
    const L = best.L;
    const V = best.dir < 0 ? L.topVia : null;
    if (V && Math.hypot(p.x - V.cx, p.z - V.cz) < V.r && Math.hypot(p.x - V.x, p.z - V.z) > 0.45) {
      best.x = V.x; best.z = V.z; best.via = true;
      return best;
    }
    const d = Math.hypot(p.x - best.x, p.z - best.z);
    const busy = L.climber && L.climber !== a;
    if (busy) {
      // someone is on it: wait off to the side of the way off it
      best.x += L.px * 1.1; best.z += L.pz * 1.1;
      best.wait = true;
      return best;
    }
    if (d < ((opts && opts.arrive) || 0.6) && !(opts && opts.noStart)) {
      if (start(a, L, best.dir > 0 ? "up" : "down", opts)) return { climbing: true, L: L };
    }
    return best;
  }
  function findOnLadder(x, y, z) {
    for (let i = 0; i < LADDERS.length; i++) {
      const L = LADDERS[i];
      if (y > L.y0 + 0.6 && y < L.y1 - 0.4 && Math.hypot(x - L.cx, z - L.cz) < 0.7) return L;
    }
    return null;
  }

  /* ================================================================
     6. FIRST PERSON — your own bare hands on the rungs. systems/fpsmode.js
        fpPlants reads this beside a vault's plants: [{arm, p, w}], the way
        the body faces, and the "grip" curl.
     ================================================================ */
  const FP = { _plants: [{ arm: "r", p: new THREE.Vector3(), w: 0 }, { arm: "l", p: new THREE.Vector3(), w: 0 }], dirX: 0, dirZ: 1, curl: "grip" };
  function fpSource() {
    const C = LIVE.get(PLAYER);
    if (!C || C.ph === "fall" || !(C.w > 0.05)) return null;
    const L = C.L;
    FP.dirX = -L.nx; FP.dirZ = -L.nz;
    if (C.slide) {
      const hy = L.y0 + C.s + 1.45;
      FP._plants[0].p.set(L.x + L.px * 0.24 * C.sRA, hy, L.z + L.pz * 0.24 * C.sRA);
      FP._plants[1].p.set(L.x + L.px * 0.24 * C.sLA, hy + 0.12, L.z + L.pz * 0.24 * C.sLA);
    } else {
      pairIdx(C.s, 0, _pa); pairIdx(C.s, 0.3, _pb);
      const hA = Math.min(L.iMax, _pa.i - 1 + HAND_UP), hB = Math.min(L.iMax, _pb.i + HAND_UP);
      const set = function (out, idx, lat, m) {
        const i0 = Math.floor(idx), fr = idx - i0;
        rungPt(L, i0, lat, out);
        if (fr > 1e-4) { rungPt(L, i0 + 1, lat, _w); out.lerp(_w, fr); }
        out.x += L.nx * 0.11 * m; out.z += L.nz * 0.11 * m;
      };
      set(FP._plants[0].p, hA, 0.17 * C.sRA, _pa.m);
      set(FP._plants[1].p, hB, 0.17 * C.sLA, _pb.m);
    }
    FP._plants[0].w = FP._plants[1].w = C.w;
    return FP;
  }

  /* ================================================================
     7. THE TICKS
     ================================================================ */
  function drain() {
    const q = CBZ.ladderSpecs;
    if (!q || !q.length) return;
    CBZ.ladderSpecs = [];
    for (let i = 0; i < q.length; i++) { const L = add(q[i]); if (L && q[i].onAdd) { try { q[i].onAdd(L); } catch (e) {} } }
  }
  drain();
  // The prison's ladders (towers, wings, grounds) are queued by builders that
  // now run lazily (core/prisonlazy.js); they were drained right here at
  // parse, so the build drains them at this same point.
  if (CBZ.definePrison) CBZ.definePrison("systems/climb.js#drain", drain);
  let runE = 0;
  CBZ.onUpdate(20.3, function (dt) {
    drain();
    // a new run (elapsed falls back): every climb is off
    const e = (CBZ.game && CBZ.game.elapsed) || 0;
    if (e + 1e-6 < runE) {
      LIVE.forEach(function (C) { if (C.L.climber === C.who) C.L.climber = null; C.who._climb = null; });
      LIVE.clear(); FALL.on = false;
    }
    runE = e;
    // the NPCs on ladders (the player ticks inside physics.js's slot)
    LIVE.forEach(function (C, a) { if (!a.isPlayer) tick(C, dt); });
    if (!LIVE.has(PLAYER)) playerIdle(dt);
    fallWatch(dt);
  });

  CBZ.climb = {
    add: add, remove: remove, removeTag: removeTag, list: LADDERS,
    start: start, owns: function (a) { return !!(a && LIVE.has(a.isPlayer ? PLAYER : a)); },
    playerOn: function () { return LIVE.has(PLAYER); },
    player: PLAYER,
    playerStep: playerStep,
    knockOff: function (a, dx, dz) { return knockOff(a === CBZ.player ? PLAYER : a, dx, dz, "hit"); },
    detour: detour, onLadder: findOnLadder,
    climbing: function (a) { return (a && LIVE.get(a === CBZ.player ? PLAYER : a)) || null; },
    fpSource: fpSource,
    // pure maths for plain-node checks
    _math: { pairIdx: pairIdx, rungPt: rungPt },
    audit: function () {
      return { ladders: LADDERS.length, live: LIVE.size, playerOn: LIVE.has(PLAYER),
        tags: LADDERS.reduce(function (o, L) { o[L.tag || "-"] = (o[L.tag || "-"] || 0) + 1; return o; }, {}) };
    },
  };
})();
