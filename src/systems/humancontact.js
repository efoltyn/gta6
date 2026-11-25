/* ============================================================
   systems/humancontact.js - BODIES ARE SOLID AND HAVE WEIGHT. The one
   person-to-person contact solver for every game (city, prison, disaster,
   gun game, multiplayer).

   Owner, 2026-09-28: "when I run into another player, there's no bumping
   into and knocking over. It's like those colliders are missing. I really
   like physics and I really want real physics in this game."

   What was here before was a positional de-overlap with a speed gate on top:
   below 6.2 m/s a body was a wall that let you through 12% at a time, above
   it the city rolled an 8% "frail" dice and the prison did nothing at all.
   Nobody's weight, nobody's facing, nobody's own motion mattered, and a man
   walking into your back felt the same as one walking into your chest.

   NOW, per pair of people in contact:

   1. SOLID. Every standing person is a vertical capsule (radius r, band
      feet+0.25 .. 1.7 m). Overlap is split by MASS (the lighter man gives
      more), a standing man is planted (his feet add friction: x3 effective
      mass against a positional push), and the correction is SOFT between two
      NPCs (a fraction of the overlap per pass past a 2 cm slop) so a queue or
      a crowd settles instead of buzzing. Two people meeting head-on slide off
      each other's shoulders (a tangential give) instead of pushing forever.
      NO PASS-THROUGH AT ANY SPEED: every body's position is stamped after
      each pass and the relative motion since then is swept (CCD); a pair that
      swapped sides inside one step is put back on the side it came from.

   2. MOMENTUM. Velocity is measured (displacement since the last stamp, so
      whatever moved a body - its mover, a verb, a shove - counts). At first
      contact the closing speed vc along the contact normal makes an impulse
      J = mu * vc (mu = mA*mB/(mA+mB), perfectly inelastic: bodies do not
      bounce). Each body's velocity change is J/m. What that change DOES is
      scaled by where it arrived and how he stood:
        angle   pushed into his face (he saw it, leans in) 0.8, from the side
                1.15, from behind 1.4
        stance  guard up 0.8, crouched 0.75, running himself 1.1, cuffed
                1.35, frail 1.4, weak from blood loss up to 1.6, carrying a
                man 1.2, the charger himself 0.85 (he chose it, shoulder set)
      and the result is a TIER:
        none    < 0.45 m/s   leaning on each other
        brush   < 1.25       shoulder brush: he sidesteps and turns
        shove   < 2.2        a stagger step along the push, a little spin
        stumble >= 2.2       two steps to catch it, and a CHANCE TO GO DOWN
                             rising to certain at 3.4 (bodyfall / the rig's
                             own keyed fall through CBZ.verbs.knockdown)
      Walking (2 m/s) into a standing man's chest = brush; into his back =
      shove. Sprinting (6.4) head-on into an equal braced man = he stumbles
      and sometimes goes down, you stagger; into his side or back = he goes
      down. Into a 140 kg man and you are the one likely on the floor.
      Carrying a man and knocked hard = you drop him.
      The victim's BRAIN hears it: grudge, fight / flee / curse per temper,
      the city's read.js line, a short line over the head elsewhere (rare).

   3. THE SAME MATH for the deliberate verbs (CBZ.bodyImpact.verbPower: the
      shove and the tackle take their power from it), for cars at walking
      pace (CBZ.bodyImpact.car: a car rolling at 1 m/s pushes you, at 10 km/h
      it takes your legs), and for the city's instanced crowd (crowd.js).

   4. THE DOWNED ARE NOT GHOSTS. A corpse or a KO'd man is stepped over at a
      walk (he gets nudged: CBZ.bodyFall.poke / the city ragdoll, no wound)
      and tripped over at a run (a stumble, a small chance of going down).

   5. MULTIPLAYER. A remote player is solid: each client pushes only its OWN
      player (by its mass share, so the two halves add up to one
      separation), and the faster body of the pair is the authority for the
      impact: it rolls, applies its own half, animates the other's avatar and
      sends {e:"bump"} so the other client applies the same outcome to its
      own player.

   Cost: one spatial hash per mode per pass (3x3 neighbour cells), pure
   arithmetic per near pair, no allocation per frame. Bodies far from the
   player never reach here (callers pass culled/parked lists).

   CBZ.bodyImpact (pure, node-testable):
     solve(q, out)            the pair model; q = {mA,mB,vAx,vAz,vBx,vBz,nx,nz,
                              fAx,fAz,fBx,fBz,stabA,stabB,rollA,rollB}
     tierOf(e, roll)  pDown(e)  TIERS  angleFactor(fx,fz,tx,tz)
     massOf(a)  stability(a, role)  verbPower(a, t, verb)
     car(victim, car, vmag, dirX, dirZ) -> {tier, e, dv}
     apply(a, tier, o)        act out a tier on any body (o: nx,nz,dv,e,spin,
                              source,mode)
   CBZ.humanContact: resolve(list, dt, opts), react, knockdown, inventoryOf,
     reactionLevel, resolveAmbientPlayer, stats
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.makeGrid) return;

  const CELL = 2.4, PERSON_R = 0.36;
  const REF_MASS = 78;
  const TIERS = ["none", "brush", "shove", "stumble", "down"];
  const NONE = 0, BRUSH = 1, SHOVE = 2, STUMBLE = 3, DOWN = 4;
  // effective velocity change (m/s) at each step up
  const T_BRUSH = 0.45, T_SHOVE = 1.25, T_STUMBLE = 2.2, T_DOWN = 3.4;
  const V_CLOSE_MIN = 0.3;     // closing slower than this is leaning, not an impact
  const PAIR_CD = 0.7;         // s before the same two bodies can trade another impact
  const SLOP = 0.02;           // m of overlap two NPCs may keep (no buzz in a queue)
  const SOFT = 0.6;            // fraction of the NPC-NPC overlap closed per pass
  const PLANT = 3;             // a standing man's feet: effective mass x3 against a push
  const V_TELEPORT = 16;       // m/s: faster than any body runs = a respawn/teleport
  const STALE = 0.5;           // s: a stamp older than this measures nothing
  const CAR_MASS = 1400;
  const Y_BAND = 1.6;
  const FIGHT_GAP = 0.16;
  const RELAX = 2;             // extra positional sweeps per pass (crowds settle)

  const grids = Object.create(null);
  const cityList = [];
  const cityPlayer = { _p: true, isPlayer: true, pos: null, r: 0.55 };
  let clock = 0, hardHits = 0, blocks = 0, impacts = 0, downs = 0, crossings = 0, stepOvers = 0;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function smooth01(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  function posOf(a) { return a.pos || (a.group && a.group.position); }
  function radiusOf(a) { return a.r != null ? a.r : (a.radius != null ? a.radius : PERSON_R); }
  function isPlayer(a) { return !!(a && !a._remote && (a._p || a.isPlayer)); }
  function rng() { return (BI.rng || Math.random)(); }
  function mode() { return (CBZ.game && CBZ.game.mode) || ""; }
  function realPlayerActor(m) {
    m = m || mode();
    if (m === "city" && CBZ.city && CBZ.city.playerActor) return CBZ.city.playerActor;
    if (CBZ.islandModeOn && CBZ.islandModeOn(m) && CBZ.surv && CBZ.surv.playerActor) return CBZ.surv.playerActor;
    if (CBZ.verbs && CBZ.verbs.playerActor) { try { return CBZ.verbs.playerActor(); } catch (e) { /* no verbs body */ } }
    return {
      isPlayer: true,
      pos: CBZ.player && CBZ.player.pos,
      group: CBZ.playerChar && CBZ.playerChar.group,
      dead: CBZ.player && CBZ.player.dead,
    };
  }

  /* ============================================================
     THE PURE MODEL
     ============================================================ */
  // t = the direction the body is PUSHED. f.t = -1: pushed straight back into
  // his own face (he saw it and leans into it); +1: shoved along his facing,
  // from behind. Side = 1.15.
  function angleFactor(fx, fz, tx, tz) {
    const c = clamp(fx * tx + fz * tz, -1, 1);
    return c < 0 ? 1.15 + 0.35 * c : 1.15 + 0.25 * c;
  }
  function pDown(e) { return e < T_STUMBLE ? 0 : smooth01((e - T_STUMBLE) / (T_DOWN - T_STUMBLE)); }
  function tierOf(e, roll) {
    if (!(e >= T_BRUSH)) return NONE;
    if (e < T_SHOVE) return BRUSH;
    if (e < T_STUMBLE) return SHOVE;
    return (roll == null ? rng() : roll) < pDown(e) ? DOWN : STUMBLE;
  }
  function solve(q, out) {
    out = out || {};
    const vc = (q.vAx - q.vBx) * q.nx + (q.vAz - q.vBz) * q.nz;
    out.vc = vc;
    out.j = 0; out.dvA = 0; out.dvB = 0; out.eA = 0; out.eB = 0;
    out.tierA = NONE; out.tierB = NONE; out.spinA = 0; out.spinB = 0; out.pA = 0; out.pB = 0;
    if (!(vc > V_CLOSE_MIN)) return out;
    const mA = q.mA > 0 ? q.mA : REF_MASS, mB = q.mB > 0 ? q.mB : REF_MASS;
    const j = (mA * mB / (mA + mB)) * vc;
    out.j = j;
    out.dvA = j / mA; out.dvB = j / mB;
    // B is pushed along +n, A along -n
    out.eB = out.dvB * angleFactor(q.fBx || 0, q.fBz || 0, q.nx, q.nz) * (q.stabB || 1);
    out.eA = out.dvA * angleFactor(q.fAx || 0, q.fAz || 0, -q.nx, -q.nz) * (q.stabA || 1);
    out.pA = pDown(out.eA); out.pB = pDown(out.eB);
    out.tierA = tierOf(out.eA, q.rollA);
    out.tierB = tierOf(out.eB, q.rollB);
    // a glancing blow turns him: the tangential part of the relative motion
    const tx = -q.nz, tz = q.nx;
    const vt = (q.vAx - q.vBx) * tx + (q.vAz - q.vBz) * tz;
    out.spinB = clamp(vt * (mA / (mA + mB)) * 0.12, -0.45, 0.45);
    out.spinA = clamp(-vt * (mB / (mA + mB)) * 0.12, -0.45, 0.45);
    return out;
  }

  function massOf(a) {
    if (!a) return REF_MASS;
    if (a._bcMass > 0) return a._bcMass;
    let m = 0;
    // a remote player's own rig (his profile), never the local player's
    const who = a._remote ? (a._remote.char || a._remote.ch || null)
      : isPlayer(a) ? (CBZ.city && CBZ.game.mode === "city" && CBZ.city.playerActor) || a : a;
    if (CBZ.bodyMass) { try { m = CBZ.bodyMass(who); } catch (e) { m = 0; } }
    if (!(m > 0)) {
      const ch = a._remote ? (a._remote.char || a._remote.ch) : (a.char || a.ch || (isPlayer(a) ? CBZ.playerChar : null));
      const P = ch && ch.profile;
      const s = P && P.statureMul > 0 ? P.statureMul : 1;
      m = REF_MASS * s * s * s;
    }
    if (!(m > 0) || !isFinite(m)) m = REF_MASS;
    try { a._bcMass = m; } catch (e) { /* frozen adapter */ }
    return m;
  }

  function held(a) {
    const V = CBZ.verbs;
    if (!V || !V.holding) return null;
    try { return V.holding(isPlayer(a) ? realPlayerActor() : a); } catch (e) { return null; }
  }
  // how easily this body goes over (>1 = less stable). role "A" = the one who
  // ran into the other (shoulder set, committed).
  function stability(a, role, speed) {
    let s = 1;
    const P = CBZ.player;
    if (isPlayer(a)) {
      if (P && (P.crouch || P.prone)) s *= 0.75;
      if (P && P.cuffed) s *= 1.35;
    } else {
      const ch = a.char || a.ch;
      if (ch && (ch.fightStance || ch.blockT > 0)) s *= 0.8;
      if (a.crouch || a.crouched) s *= 0.75;
      if (a._frail || a.elderly || a.frail) s *= 1.4;
      if (CBZ.verbs && CBZ.verbs.cuffed) { try { if (CBZ.verbs.cuffed(a)) s *= 1.35; } catch (e) { /* no cuffs */ } }
    }
    if (speed > 3) s *= 1.1;
    if (CBZ.vitals && CBZ.vitals.weak) {
      try { const w = CBZ.vitals.weak(isPlayer(a) ? realPlayerActor() : a) || 0; s *= 1 + 0.6 * clamp(w, 0, 1); } catch (e) { /* no vitals */ }
    }
    if (role === "A") s *= 0.72;            // he chose it: shoulder set, weight driving through
    if (held(a)) s *= 1.2;                  // a man over your shoulder: top-heavy
    return s;
  }
  function facingOf(a, out) {
    let yaw = null;
    if (isPlayer(a)) yaw = CBZ.playerChar && CBZ.playerChar.group ? CBZ.playerChar.group.rotation.y : null;
    else if (a._remote) yaw = a._remote.group ? a._remote.group.rotation.y : null;
    else if (a.group) yaw = a.group.rotation.y;
    else if (a.char && a.char.group) yaw = a.char.group.rotation.y;
    if (yaw == null || !isFinite(yaw)) { out.x = 0; out.z = 0; return out; }   // unknown: side-on
    out.x = Math.sin(yaw); out.z = Math.cos(yaw);
    return out;
  }

  /* A DELIBERATE SHOVE OR TACKLE, THE SAME MATH. The arms deliver an
     effective 2.6 m/s into him on top of whatever the shover's own run
     carries; the tackle is the lunge speed. Power 0..1 = e / T_DOWN. */
  const _vq = {}, _vo = {}, _fa = { x: 0, z: 0 }, _fb = { x: 0, z: 0 };
  function verbPower(a, t, verb) {
    try { return verbPowerRaw(a, t, verb); } catch (e) { return 1; }
  }
  function verbPowerRaw(a, t, verb) {
    const ap = a && posOf(isPlayer(a) ? { pos: CBZ.player.pos } : a), tp = t && posOf(t);
    if (!ap || !tp) return 1;
    let nx = tp.x - ap.x, nz = tp.z - ap.z;
    const d = Math.hypot(nx, nz) || 1; nx /= d; nz /= d;
    const own = velOf(a);
    const along = Math.max(0, own.x * nx + own.z * nz);
    const vA = (verb === "tackle" ? Math.max(5.5, along) : 2.6 + along);
    facingOf(a, _fa); facingOf(t, _fb);
    _vq.mA = massOf(a); _vq.mB = massOf(t);
    _vq.vAx = nx * vA; _vq.vAz = nz * vA; _vq.vBx = 0; _vq.vBz = 0;
    _vq.nx = nx; _vq.nz = nz;
    _vq.fAx = _fa.x; _vq.fAz = _fa.z; _vq.fBx = _fb.x; _vq.fBz = _fb.z;
    _vq.stabA = stability(a, "A", vA); _vq.stabB = stability(t, "B", 0);
    _vq.rollA = 1; _vq.rollB = 1;
    solve(_vq, _vo);
    return clamp(_vo.eB / T_DOWN, 0.25, 1);
  }
  function velOf(a) {
    if (isPlayer(a)) return PV;
    _vv.x = a && a._bcVx || 0; _vv.z = a && a._bcVz || 0;
    return _vv;
  }
  const _vv = { x: 0, z: 0 };

  /* A CAR IS A VERY HEAVY BODY THAT HITS LOW. Same impulse law, the car's
     mass against his, and the bumper takes the legs (x1.3: below the centre
     of mass, the worst place to be pushed). ~2.7 m/s (10 km/h) is a certain
     knockdown; a car creeping at 1 m/s is a push you step out of. */
  function car(victim, carObj, vmag, dirX, dirZ) {
    const mB = massOf(victim), mA = (carObj && carObj.mass > 200 ? carObj.mass : CAR_MASS);
    const dv = (mA / (mA + mB)) * Math.max(0, vmag || 0);
    const e = dv * 1.3 * stability(victim, "B", 0);
    return { tier: tierOf(e), e, dv, dirX: dirX || 0, dirZ: dirZ || 0 };
  }

  /* ============================================================
     THE PLAYER'S OWN VELOCITY, every frame (after physics.js at order 10),
     so a throttled resolve still reads a true speed.
     ============================================================ */
  const PV = { x: 0, z: 0, lx: null, lz: null };
  if (CBZ.onUpdate) CBZ.onUpdate(10.8, function (dt) {
    const P = CBZ.player;
    if (!P || !P.pos || !(dt > 0)) return;
    if (PV.lx != null) {
      let vx = (P.pos.x - PV.lx) / dt, vz = (P.pos.z - PV.lz) / dt;
      if (vx * vx + vz * vz > V_TELEPORT * V_TELEPORT || P.driving) { vx = 0; vz = 0; }
      PV.x = PV.x * 0.4 + vx * 0.6; PV.z = PV.z * 0.4 + vz * 0.6;
    }
    PV.lx = P.pos.x; PV.lz = P.pos.z;
  });

  /* ============================================================
     SLIDES: the root motion of a push on a body that has no feet to step
     with (the player, a rig-less body). Integrated every frame, not at the
     resolve's rate, and slid against the world.
     ============================================================ */
  const kicks = [];
  const _kickO = { posture: "stand", radius: 0.3, clearRadius: 0.4, out: { hit: false, nx: 0, nz: 0, c: null, pushed: false, landed: false, y: 0, floor: 0 } };
  function kick(a, vx, vz) {
    const p = posOf(a); if (!p) return;
    for (let i = 0; i < kicks.length; i++) {
      const k = kicks[i];
      if (k.p === p) { k.vx += vx; k.vz += vz; return; }
    }
    kicks.push({ a, p, r: radiusOf(a), vx, vz });
  }
  function stepKicks(dt) {
    for (let i = kicks.length - 1; i >= 0; i--) {
      const k = kicks[i];
      // THE ONE MOVER (systems/bodymove.js): swept and slid along the wall;
      // what the wall takes comes off the push
      if (CBZ.bodyMove) {
        _kickO.clearRadius = k.r;
        const sw = CBZ.bodyMove(k.p, k.vx * dt, 0, k.vz * dt, _kickO);
        if (sw.hit || sw.pushed) { const vn = k.vx * sw.nx + k.vz * sw.nz; if (vn < 0) { k.vx -= vn * sw.nx; k.vz -= vn * sw.nz; } }
      } else { k.p.x += k.vx * dt; k.p.z += k.vz * dt; }
      const dec = Math.exp(-9 * dt);
      k.vx *= dec; k.vz *= dec;
      if (k.vx * k.vx + k.vz * k.vz < 0.01) kicks.splice(i, 1);
    }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(11.5, function (dt) { if (kicks.length) stepKicks(dt); });

  /* ============================================================
     ACTING OUT A TIER on any body
     ============================================================ */
  const _dir = { x: 0, z: 0 };
  function koMode(m) { return m === "city" || m === "escape"; }
  function dropHeld(a, chance) {
    const S = held(a);
    if (!S || rng() >= chance) return;
    try { CBZ.verbs.release(S, "drop"); } catch (e) { /* not ours */ }
  }
  function apply(a, tier, o) {
    if (!a || tier <= NONE) return;
    o = o || {};
    const m = o.mode || mode();
    const nx = o.nx || 0, nz = o.nz || 0, dv = o.dv || 0;
    _dir.x = nx; _dir.z = nz;
    const V = CBZ.verbs;
    if (a._remote) { applyRemote(a._remote, tier, o); return; }
    if (isPlayer(a)) { applyPlayer(tier, o, m); return; }
    const ch = a.char || a.ch;
    if (tier === BRUSH) {
      // a shoulder brush: he gives a half step off the line and turns a touch
      const side = o.side || 1;
      const sx = -nz * side * 0.7 + nx * 0.3, sz = nx * side * 0.7 + nz * 0.3;
      if (!(V && V.step && ch && !(ch.footStep && ch.footStep.on) && V.step(a, sx, sz, 0.14 + 0.08 * clamp(dv, 0, 1), 0.3))) kick(a, sx * 0.9, sz * 0.9);
      if (a.group && o.spin) a.group.rotation.y += o.spin * 0.5;
      return;
    }
    if (tier === SHOVE || tier === STUMBLE) {
      const stumble = tier === STUMBLE;
      const power = stumble ? 0.85 : clamp(0.35 + 0.3 * (o.e - T_SHOVE) / (T_STUMBLE - T_SHOVE), 0.35, 0.65);
      const reach = clamp(dv / 1.6, 0.6, 1.6);
      let done = false;
      if (ch && intoWall(a, posOf(a), nx, nz, Math.max(dv, 0.9), (0.16 + 0.34 * power) * reach * (stumble ? 1.55 : 1), false, m)) done = true;
      else if (V && V.react && ch) {
        try { done = !!V.react(a, { reaction: "stagger", zone: "body", dir: _dir, power, stagger: true, heavy: stumble, mass: reach }); } catch (e) { done = false; }
      }
      if (!done) kick(a, nx * dv * 0.9, nz * dv * 0.9);
      if (a.group && o.spin) a.group.rotation.y += o.spin;
      if (stumble) dropHeld(a, 0.5);
      return;
    }
    // DOWN
    downs++;
    dropHeld(a, 1);
    let done = false;
    const after = afterDir(o, nx, nz);
    if (ch && intoWall(a, posOf(a), _dir.x, _dir.z, Math.max(after.speed, dv), after.travel, true, m)) done = true;
    else if (V && V.knockdown && ch) {
      try { done = !!V.knockdown(a, { dir: _dir, power: clamp(o.e / 4.5, 0.5, 1), travel: after.travel, dur: 1.0 + clamp(o.e - T_DOWN, 0, 2) * 0.5, ko: false, noKo: !koMode(m) }); } catch (e) { done = false; }
    }
    if (!done) {
      if (CBZ.body && CBZ.body.knockdown && a.group) CBZ.body.knockdown(a, { dir: _dir, force: 3 + dv * 1.5, t: 1.2 });
      else if (m === "escape" && CBZ.knockback && a.group) { a.ko = Math.max(a.ko || 0, 2.2); CBZ.knockback(a, (posOf(a).x - nx), (posOf(a).z - nz), 0.6 + dv * 0.2); }
      else kick(a, nx * dv, nz * dv);
    }
    if (a.group && o.spin) a.group.rotation.y += o.spin;
  }
  /* A BODY FALLS THE WAY IT IS STILL MOVING. The push on a runner who hits a
     man points back at him, so he used to sit down BACKWARD out of a full
     sprint, and the man he hit dropped on the spot with none of the 3 m/s he
     had just been given. The direction and the ground covered are the body's
     velocity the instant after the impact (its own run less what the impact
     took, or the push itself for a man who stood still). Leaves the unit
     direction in _dir. */
  const _after = { travel: 0, speed: 0 };
  function afterDir(o, nx, nz) {
    let vx = o.vx, vz = o.vz;
    if (vx == null || vz == null) { vx = nx * (o.dv || 0); vz = nz * (o.dv || 0); }
    const sp = Math.hypot(vx, vz);
    // (only a body still really travelling falls along its travel: two men
    // who met head on are left with a crawl of residual speed, and go over
    // backward off each other, not forward on top of each other)
    if (sp > 2 || (sp > 0.5 && vx * nx + vz * nz > 0)) { _dir.x = vx / sp; _dir.z = vz / sp; } else { _dir.x = nx; _dir.z = nz; }
    _after.speed = sp;
    _after.travel = clamp(sp * 0.34, 0.3, 1.7);
    return _after;
  }
  // the player's run is broken by a hit: no sprint, a slowed stride (physics.js hitT)
  function breakStride(secs) {
    const P = CBZ.player;
    if (P && !(P.hitT > secs)) P.hitT = secs;
  }
  // what is left of your own motion after the impact that the slowed legs do
  // not already carry: you keep going INTO him, you do not bounce back off him
  function carry(o, nx, nz, k) {
    const P = CBZ.player;
    let vx = o.vx, vz = o.vz;
    if (vx == null || vz == null) { vx = nx * (o.dv || 0); vz = nz * (o.dv || 0); }
    kick({ pos: P.pos, r: P.radius || 0.55 }, vx * k, vz * k);
  }
  /* ============================================================
     THE WALL BEHIND HIM. A push used to know nothing about what stood behind
     the man it moved: he reeled or fell his usual distance and the collider
     quietly stopped him, or (a shove) he was launched into a hop at it and
     lay down in front of it. Now anything that drives a body (a run-in, a
     shove) asks what is along the push first. A wall inside the ground he
     would have covered means he is driven INTO it: his steps end at the wall,
     his back and skull meet it at what is left of his speed, and that speed
     decides the rest:
       slow   (< 1.6 m/s)  he fetches up against it, braced
       hard   (< 3.4)      a slam (trauma, the sound), the head snaps and he
                           comes off the wall a step, dazed
       harder, or a man already going down: the slam, and he crumples off
                           the wall onto the floor in front of it
     v0 = his speed the instant after the push, travel = the ground an open
     floor would have given him. true = the wall has him (the caller does
     nothing more).
     ============================================================ */
  const wallQ = [];
  const _wd = { x: 0, z: 0 }, _wo = { x: 0, z: 0 };
  function isPlayerBody(a) {
    if (!a) return false;
    if (isPlayer(a)) return true;
    const V = CBZ.verbs;
    try { return !!(V && V.playerActor && V.playerActor() === a); } catch (e) { return false; }
  }
  function intoWall(a, pos, dx, dz, v0, travel, down, m) {
    const V = CBZ.verbs;
    if (!a || !pos || !V || !V.context || !V.react || !(v0 > 0.8)) return false;
    let c;
    try { c = V.context(pos, { x: dx, z: dz }, Math.max(0.6, travel + 0.5)); } catch (e) { return false; }
    if (!c || c.kind !== "wall") return false;
    const gap = Math.max(0, c.dist - 0.32);            // the floor between his back and it
    const vHit = v0 * clamp(1 - 0.5 * gap / Math.max(travel, 0.3), 0.3, 1);
    let t = 0.04;
    if (down && gap >= 0.3 && V.knockdown) {
      /* GOING DOWN WITH A WALL BEHIND HIM. He falls the way he was hit and
         is carried back until the wall stops him (the one mover holds him out
         of it); on the way down his back and skull meet it (the slam, timed
         to the sit of the fall) and he ends slumped against its foot. */
      const isP = isPlayerBody(a);
      _wd.x = dx; _wd.z = dz;
      let ok = false;
      try { ok = !!V.knockdown(a, { dir: _wd, power: clamp(v0 / 4.5, 0.5, 1), travel: Math.max(0.05, Math.min(travel, gap + 0.1)), dur: 1.2 + clamp(vHit - 3, 0, 2) * 0.5, ko: false, noKo: !isP && !koMode(m || mode()) }); } catch (e) { ok = false; }
      if (!ok) return false;
      downs++;
      for (let i = wallQ.length - 1; i >= 0; i--) if (wallQ[i].a === a) wallQ.splice(i, 1);
      wallQ.push({ a: a, t: 0.4, v: Math.max(vHit, 1.8), dx: dx, dz: dz, down: false, m: m || mode(), slamOnly: true });
      return true;
    }
    if (gap > 0.12) {
      // the steps that carry him to it
      const power = clamp(v0 / 5.5, 0.3, 1);
      _wd.x = dx; _wd.z = dz;
      try { V.react(a, { reaction: "stagger", zone: "body", dir: _wd, power: power, stagger: true, mass: gap / (0.16 + 0.34 * power) }); } catch (e) { /* no rig */ }
      t = clamp(gap / Math.max(1.5, v0) + 0.12, 0.15, 0.42);
    }
    for (let i = wallQ.length - 1; i >= 0; i--) if (wallQ[i].a === a) wallQ.splice(i, 1);
    wallQ.push({ a: a, t: t, v: vHit, dx: dx, dz: dz, down: !!down, m: m || mode() });
    return true;
  }
  function wallHit(q) {
    const a = q.a, V = CBZ.verbs;
    if (!a || a.dead || !V) return;
    const isP = isPlayerBody(a);
    if (isP && CBZ.player && CBZ.player.dead) return;
    _wo.x = -q.dx; _wo.z = -q.dz;                        // off the wall
    const sp = 2 + q.v * 1.2;
    if (q.v > 1.2) {
      if (CBZ.trauma && CBZ.trauma.slam) { try { CBZ.trauma.slam(a, sp, { wall: true, dir: _wo }); } catch (e) { /* no trauma */ } }
      if (CBZ.sfx) { try { CBZ.sfx("hit"); } catch (e) { /* no audio */ } }
    }
    if (isP) { if (CBZ.shake) CBZ.shake(clamp(q.v * 0.09, 0.06, 0.42)); breakStride(q.v > 1.6 ? 0.6 : 0.25); }
    if (q.slamOnly) return;                              // already on his way to the floor
    try {
      if (q.down || q.v >= 3.4) {
        downs++;
        if (sp > 5.5 && CBZ.goreImpact) {
          const p = isP ? CBZ.player.pos : posOf(a);
          if (p) CBZ.goreImpact(p.x + q.dx * 0.3, (p.y || 0) + 1.5, p.z + q.dz * 0.3, { dir: { x: q.dx, y: 0, z: q.dz }, amount: 0.3 + 0.08 * q.v, wall: true });
        }
        if (V.knockdown) V.knockdown(a, { dir: _wo, power: clamp(q.v / 5, 0.4, 1), travel: 0.28, dur: 1.2 + clamp(q.v - 3, 0, 2) * 0.5, ko: false, noKo: !isP && !koMode(q.m) });
      } else if (q.v >= 1.6) {
        V.react(a, { reaction: "stagger", zone: "head", kind: "cross", dir: _wo, power: clamp(q.v / 4, 0.4, 0.85), stagger: true, mass: 0.5 });
      } else {
        V.react(a, { reaction: "stagger", zone: "body", dir: _wo, power: 0.25 });
      }
    } catch (e) { /* no rig */ }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(11.6, function (dt) {
    for (let i = wallQ.length - 1; i >= 0; i--) {
      const q = wallQ[i];
      q.t -= dt;
      if (q.t > 0) continue;
      wallQ.splice(i, 1);
      wallHit(q);
    }
  });
  function applyPlayer(tier, o, m) {
    const P = CBZ.player;
    if (!P || P.dead) return;
    const nx = o.nx || 0, nz = o.nz || 0, dv = o.dv || 0;
    const pa = realPlayerActor(m);
    if (tier === BRUSH) {
      kick({ pos: P.pos, r: P.radius || 0.55 }, nx * dv * 0.5, nz * dv * 0.5);
      if (dv > 0.7) breakStride(0.12);
      return;
    }
    if (tier === SHOVE || tier === STUMBLE) {
      const stumble = tier === STUMBLE;
      breakStride(stumble ? 0.55 : 0.3);
      // (only a push that is actually moving you its own way can put a wall behind you)
      const pvx = o.vx != null ? o.vx : nx * dv, pvz = o.vz != null ? o.vz : nz * dv;
      if (pvx * nx + pvz * nz > 0.6 && intoWall(pa, P.pos, nx, nz, Math.hypot(pvx, pvz), stumble ? 0.9 : 0.5, false, m)) { if (stumble) dropHeld(pa, 0.4); return; }
      carry(o, nx, nz, stumble ? 0.75 : 0.6);
      if (CBZ.verbs && CBZ.verbs.react) { try { _dir.x = nx; _dir.z = nz; CBZ.verbs.react(pa, { reaction: "stagger", zone: "body", dir: _dir, power: stumble ? 0.75 : 0.45 }); } catch (e) { /* no rig */ } }
      if (CBZ.shake) CBZ.shake(stumble ? 0.12 : 0.05);
      if (stumble) dropHeld(pa, 0.4);
      return;
    }
    downs++;
    dropHeld(pa, 1);
    breakStride(0.6);
    const after = afterDir(o, nx, nz);
    /* IN THE JAIL YOU FELL AS A PLANK. CBZ.body.knockdown on the prison's
       player has no rig fall behind it: the whole group tipped 90 degrees
       about the feet in a fifth of a second and tipped back up. The inmates
       already go down in their own rig (knees, hips, back or face, then the
       get-up); so do you now, along the way you were still moving, carried
       over the ground your momentum had left. */
    let done = false;
    if (after.speed > 0.8 && intoWall(pa, P.pos, _dir.x, _dir.z, after.speed, after.travel, true, m)) done = true;
    else if (m === "escape" && CBZ.verbs && CBZ.verbs.knockdown) {
      try { done = !!CBZ.verbs.knockdown(pa, { dir: _dir, power: clamp((o.e || 0) / 4.5, 0.5, 1), travel: after.travel, dur: 0.7 + clamp((o.e || 0) - T_DOWN, 0, 2) * 0.3, ko: false }); } catch (e) { done = false; }
    }
    if (!done) {
      if (CBZ.body && CBZ.body.knockdown) CBZ.body.knockdown(pa, { dir: _dir, force: 3 + dv * 1.4, t: 1.1 + clamp((o.e || 0) - T_DOWN, 0, 2) * 0.3 });
      else kick({ pos: P.pos, r: P.radius || 0.55 }, nx * dv, nz * dv);
    }
    if (CBZ.shake) CBZ.shake(0.3);
    if (CBZ.sfx) { try { CBZ.sfx("hit"); } catch (e) { /* no audio */ } }
  }
  // what a remote player's avatar does on THIS screen (his own client moves him)
  function applyRemote(R, tier, o) {
    const V = CBZ.verbs, ch = R && R.ch;
    if (!V || !ch || tier <= BRUSH) return;
    _dir.x = o.nx || 0; _dir.z = o.nz || 0;
    try {
      if (tier === DOWN) V.knockdown(ch, { dir: _dir, power: 0.8, dur: 1.2, ko: false, noKo: true });
      else V.react(ch, { reaction: "stagger", zone: "body", dir: _dir, power: tier === STUMBLE ? 0.85 : 0.5 });
    } catch (e) { /* puppet without a rig */ }
  }

  /* ============================================================
     WHAT THE VICTIM MAKES OF IT (mode abilities + the shared brain)
     ============================================================ */
  function reactionLevel(a) {
    if (!a) return 0.35;
    if (a.reactivity != null) return clamp(+a.reactivity || 0, 0, 1);
    if (a.aggr != null) return clamp(+a.aggr || 0, 0, 1);
    const b = CBZ.BEHAVIORS && CBZ.BEHAVIORS[a.behavior];
    if (b) return clamp((b.retaliate * 0.55 + b.guts * 0.30 + b.init * 0.15), 0, 1);
    if (a.kind === "cop" || a.kind === "guard") return 0.82;
    return 0.35;
  }

  function inventoryOf(a) {
    const items = a && a.loadout && a.loadout.items ? a.loadout.items : [];
    return {
      armed: !!(a && (a.armed || a.hasGun)),
      weapon: a && (a.weapon || (a.hasGun ? "concealed weapon" : null)),
      items,
      canCarjack: !!(CBZ.game.mode === "city" && a && !a.inCar && CBZ.cityNpcCarjack),
    };
  }

  function fleeFrom(a, source) {
    const p = posOf(a), s = source && posOf(source);
    if (!p || !s || !a.target || !a.target.set) return;
    const dx = p.x - s.x, dz = p.z - s.z, d = Math.hypot(dx, dz) || 1;
    a.target.set(p.x + dx / d * 18, 0, p.z + dz / d * 18);
  }

  function reactCity(a, source, level, severity) {
    const src = source && isPlayer(source) ? realPlayerActor("city") : source;
    if (a.kind === "cop") {
      // the same ladder as a screw's (staffContact): a bump is a look and a
      // word (read.js), a second one inside 40 s or a real shove is noted,
      // the third, or force, is assaulting an officer
      if (!source || !isPlayer(source)) return;
      if (severity < 0.45 && a._pushAt != null && clock - a._pushAt < 2.5) return;
      if (a._pushAt == null || clock - a._pushAt > 40) a._pushN = 0;
      a._pushAt = clock;
      a._pushN = (a._pushN || 0) + (severity >= 0.7 ? 3 : severity >= 0.45 ? 2 : 1);
      if (a._pushN >= 3 || severity >= 0.7) {
        a._pushN = 0;
        if (CBZ.cityCrime) CBZ.cityCrime(30, { x: a.pos.x, z: a.pos.z, type: "assault-officer" });
        a.curTarget = realPlayerActor("city"); a.retarget = 0;
      }
      return;
    }
    a.mem = src && src.pos ? src : a.mem;
    a.alarmed = Math.max(a.alarmed || 0, 3 + severity * 5);
    a.fear = Math.min(10, (a.fear || 0) + severity * 3);
    if (severity < 0.55) return;

    const inv = inventoryOf(a);
    if (a.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(a.gang, 0.25 + severity * 0.35);
    if (level >= 0.88 && !inv.armed && inv.canCarjack && Math.random() < 0.58) {
      if (CBZ.cityNpcCarjack(a, src)) return;
    }
    // the victim remembers it and answers in his own time (cityBrain grudge:
    // peds.js's think runs fight / flee / freeze off mem + alarmed after his
    // own reaction delay)
    const CB = CBZ.cityBrain;
    if (CB && src && src.pos) {
      CB.grudge(a, src, 0.25 + severity * 0.5);
      if (a.gang && (a._rallyT || 0) <= 0 && CBZ.cityRallyGang) { CBZ.cityRallyGang(a, src, severity * 0.5); a._rallyT = 6; }
      return;
    }
    if (level >= 0.70 || (inv.armed && level >= 0.46)) {
      if (src && src.pos) { a.rage = src; a.state = "fight"; }
    } else {
      a.state = "flee"; fleeFrom(a, src);
    }
  }

  /* A HAND ON A SCREW (owner, 2026-10-20: "if you run into a cop, they
     don't get mad at you"). It was one line: alert 1.1 s and a 2-4 s hunt
     that ended before he got his order out, the same for a shoulder brush as
     for a sprint that put him on the floor, no word, no push, no record. And
     a brush never reached here at all unless it was the third in a row.
     Now contact with an officer is a LADDER he remembers (40 s):
       1  a brush: he turns on you, "Watch it." (his eyes stay on you)
       2  again, or a real shove: he puts you back a step with both hands,
          "Back off." It goes on the record (minor: the next order is a
          warning, not cuffs) and he watches you a while
       3+ or force (a stumble, a man on the floor): assault on staff. The
          record, the hunt, the order and the cuffs (prisonlaw.js), and the
          warden hears of it. */
  // the officer's words are CBZ.voice's (systems/voice.js), his role's pool
  function staffSay(a, kind) {
    if (CBZ.voice) CBZ.voice.say(a, kind === "push" ? "shoved" : "bumped", { by: CBZ.player, force: true, secs: 1.5 });
  }
  function staffContact(a, source, severity) {
    if (a.dead || (a.ko || 0) > 0 || a.asleep || a._escort || a.intimidMode === "scared" || (a.bribed || 0) > 0) return;
    const G = CBZ.game || {};
    if (G.role === "cop") return;                       // a colleague's elbow
    const P = CBZ.player, pp = P && P.pos, gp = posOf(a);
    if (!pp || !gp) return;
    // a man in cuffs, on the floor or being walked is not bumping anybody
    if (P.dead || (P.captureState && P.captureState !== "normal") || (CBZ.playerChar && CBZ.playerChar.cuffed)) return;
    // one shoulder is one bump: a brush inside 2.5 s of the last is the same one
    if (severity < 0.45 && a._pushAt != null && clock - a._pushAt < 2.5) return;
    if ((a._pushAt == null) || clock - a._pushAt > 40) a._pushN = 0;
    a._pushAt = clock;
    a._pushN = (a._pushN || 0) + (severity >= 0.7 ? 3 : severity >= 0.45 ? 2 : 1);
    // he turns on you and keeps you in his eyes
    a.alert = Math.max(a.alert || 0, 2.5);
    a.sus = Math.max(a.sus || 0, 0.5); a.susX = pp.x; a.susZ = pp.z; a.susHold = Math.max(a.susHold || 0, 2);
    if (CBZ.guardFaceTo) { try { CBZ.guardFaceTo(a, pp.x, pp.z, 0.0001, 1 / 30); } catch (e) { /* not a guard body */ } }
    const n = a._pushN;
    if (n >= 3 || severity >= 0.7) {
      a._pushN = 0;
      if (CBZ.prisonOffense) { try { CBZ.prisonOffense("assault", { severity: 3, seenBy: a, why: "staff" }); } catch (e) { /* no law */ } }
      a.hunt = Math.max(a.hunt || 0, 6);
      if (CBZ.addHeat) { try { CBZ.addHeat(10); } catch (e) { /* no heat */ } }
      return;
    }
    if (n >= 2) {
      // both hands on your chest: a step back along the line between you
      let nx = pp.x - gp.x, nz = pp.z - gp.z;
      const d = Math.hypot(nx, nz) || 1; nx /= d; nz /= d;
      _pushEv.nx = nx; _pushEv.nz = nz; _pushEv.dv = 1.5; _pushEv.e = 1.6; _pushEv.mode = "escape"; _pushEv.source = a; _pushEv.spin = 0;
      applyPlayer(SHOVE, _pushEv, "escape");
      // his arms do it (character.js's shove beat, the one brain_prison.js's PB.shove plays)
      if (a.char && !(a.char.punchT > 0)) { a.char.punchKind = "shove"; a.char.punchDur = 0.30; a.char.punchT = 0.30; }
      staffSay(a, "push");
      if (CBZ.prisonOffense) { try { CBZ.prisonOffense("minor", { seenBy: a, why: "staff" }); } catch (e) { /* no law */ } }
      if (CBZ.addHeat) { try { CBZ.addHeat(3); } catch (e) { /* no heat */ } }
      a.alert = Math.max(a.alert || 0, 5);
      return;
    }
    staffSay(a, "bump");
  }
  const _pushEv = {};

  function reactEscape(a, source, level, severity) {
    const byPlayer = source && isPlayer(source);
    if (a.kind === "guard" || a.kind === "warden") {
      if (byPlayer) staffContact(a, source, severity);
      return;
    }
    if (!byPlayer) return;
    a.playerGrudge = Math.min(14, (a.playerGrudge || 0) + 1 + severity * 2.2);
    if (a._crowd && a._id >= 0 && CBZ.ambient && CBZ.ambient.grudge) {
      CBZ.ambient.grudge[a._id] = Math.min(255, (CBZ.ambient.grudge[a._id] + 28 + severity * 72) | 0);
    }
    // what he carries decides how far he takes it (economy.js mints pockets)
    const inv = inventoryOf(a);
    let nerve = level;
    for (let i = 0; i < inv.items.length; i++) {
      const it = inv.items[i];
      if (it === "Shiv" || it === "Brass Knuckles" || it === "Baton") { nerve = Math.min(1, nerve + 0.18); break; }
    }
    // a brush is not a fight: only a real shove or worse starts one
    if (severity < 0.45) return;
    if (nerve >= 0.63) {
      a.huntPlayer = Math.max(a.huntPlayer || 0, 3.5 + nerve * 5);
      if (CBZ.provokeGang && a.gang >= 0) CBZ.provokeGang(a, 4 + nerve * 4);
    } else if (nerve >= 0.35) {
      a.aiState = "flee"; a.fleeT = Math.max(a.fleeT || 0, 1.8 + severity * 2);
    }
  }

  function reactSurvival(a, source, level, severity) {
    if (!source || !isPlayer(source)) return;
    a.grudge = Math.min(10, (a.grudge || 0) + 0.5 + severity * 1.5);
    if (severity < 0.45) return;
    a.state = level > 0.82 ? "move" : "flee";
    fleeFrom(a, source);
  }

  // WHAT HE DOES AND SAYS about it is CBZ.voice's (systems/voice.js): the
  // threat he sees in you, who he is, what he carries. Bodies the game above
  // already moved (a jail hunt, a flee) are passed as `how` and only speak.
  const VOICE_EV = { bump: "bumped", shoved: "shoved", "repeated-shove": "repeated", "run-over": "runOver" };

  function react(a, event) {
    if (!a || a.dead) return;
    const severity = clamp(event.severity == null ? 1 : event.severity, 0, 1);
    const level = reactionLevel(a);
    a._contactGrudge = Math.min(20, (a._contactGrudge || 0) + severity * (0.5 + level));
    a._lastContact = { kind: event.kind || "bump", severity, at: clock };
    const m = event.mode || CBZ.game.mode;
    if (m === "city") reactCity(a, event.source, level, severity);
    else if (m === "escape") reactEscape(a, event.source, level, severity);
    else if (CBZ.islandModeOn && CBZ.islandModeOn(m)) reactSurvival(a, event.source, level, severity);
    // the one brain keeps the grudge whatever game this is
    const B = CBZ.brain, src = event.source && isPlayer(event.source) ? realPlayerActor(m) : event.source;
    if (B && B.memory && B.memory.grudge && src && severity >= 0.3) {
      try { B.memory.grudge(a, src, 0.15 + severity * 0.5); } catch (e) { /* not a brain actor */ }
    }
    // (an officer in the jail said his own line in staffContact)
    if (event.source && isPlayer(event.source) && !(m === "escape" && (a.kind === "guard" || a.kind === "warden"))) {
      if (m === "city" && CBZ.cityContactReact) {
        try { CBZ.cityContactReact(a, event.kind || "bump", severity); } catch (e) { /* read.js off */ }
      } else if (CBZ.voice) {
        const how = (a.huntPlayer || 0) > 0 ? "squareUp" : (a.aiState === "flee" || a.state === "flee") ? "hurry" : undefined;
        CBZ.voice.react(a, VOICE_EV[event.kind] || "bumped", { by: src || event.source, severity: severity, how: how });
      }
    }
  }

  // kept for callers that knock a man down without a pair (legacy seam)
  function knockdown(a, event) {
    if (!a || a.dead) return;
    const p = posOf(a), source = event.source, sp = source && posOf(source);
    let nx = event.nx || 0, nz = event.nz || 0;
    if (sp && p) { nx = p.x - sp.x; nz = p.z - sp.z; const d = Math.hypot(nx, nz) || 1; nx /= d; nz /= d; }
    apply(a, DOWN, { nx, nz, dv: 2.5 + (event.severity || 1), e: T_DOWN + (event.severity || 1), mode: event.mode });
  }

  /* ============================================================
     THE PAIR
     ============================================================ */
  function fightingYou(a) {
    return !!(a && !isPlayer(a) && ((a.huntPlayer || 0) > 0 || (a.char && a.char.fightStance)));
  }
  /* HANDS ON EACH OTHER. The man being held, carried, dragged or walked is
     placed by the verb that holds him: he is not a collider (the verb puts
     him inside his captor's arms on purpose). The one holding him IS one -
     a man carrying a body still walks into people - but never into the body
     he carries (same session: the pair is skipped). */
  function sessionOf(a) {
    const V = CBZ.verbs;
    if (!V || !V.sessionOf) return null;
    try { return V.sessionOf(isPlayer(a) ? realPlayerActor() : a) || null; } catch (e) { return null; }
  }
  function heldTarget(a, S) {
    if (!S) return false;
    const me = isPlayer(a) ? realPlayerActor() : a;
    return S.t === me && !S.tFree;
  }
  /* GOING DOWN IS NOT GONE. The frame a man's fall started he became "a body
     on the floor": no collider, stepped over. So the runner who hit him ran
     on at full speed straight THROUGH a man still upright with his knees
     folding, and then tripped over him 0.1 s later. For the first beats of a
     fall (the buckle, until the hips are down) and the last of a get-up (off
     his knees, rising) he is still a standing body: solid, pushed along by
     whoever is driving into him, but he trades no new impact (he is already
     on his way down). */
  const FALL_SOLID = 0.36, RISE_SOLID = 0.95;
  function going(a) {
    if (!a || a.dead) return false;
    const ch = (isPlayer(a) && !a._remote) ? CBZ.playerChar : (a.char || a.ch);
    const f = ch && ch.fall;
    if (!f || !f.on) return false;
    if (f.variant === "liver" || f.variant === "kneel") return false;
    if (f.phase === "fall") return (f.t || 0) < FALL_SOLID;
    if (f.phase === "getup") return (f.gt || 0) > RISE_SOLID;
    return false;
  }
  function lying(a) {
    if (!a) return false;
    if (going(a)) return false;
    if (isPlayer(a) && !a._remote) {
      // YOU, ON THE FLOOR (tased, tackled, knocked down: the rig's fall) are a
      // body on the floor like any other: stepped over, never a standing
      // capsule. As one, every screw walking in to cuff you shoved you along
      // the floor, and a running one bowled you into a SECOND knockdown.
      const P = CBZ.player, pc = CBZ.playerChar, f = pc && pc.fall;
      if (!P || P.dead) return !!P;
      return (P.ko || 0) > 0 || !!(f && f.on && f.phase !== "getup");
    }
    if (a.dead || (a.ko || 0) > 0) return true;
    const ch = a.char || a.ch;
    if (ch && ch.fall && ch.fall.on) return true;
    if (a._phys && (a._phys.down > 0 || a._phys.air)) return true;
    return false;
  }

  function measure(a, p) {
    const t = a._bcT;
    if (t == null || clock - t > STALE || clock - t <= 1e-6) { a._bcVx = 0; a._bcVz = 0; a._bcFresh = false; return; }
    if (isPlayer(a)) { a._bcVx = PV.x; a._bcVz = PV.z; a._bcFresh = true; return; }
    const el = clock - t;
    let vx = (p.x - a._bcX) / el, vz = (p.z - a._bcZ) / el;
    if (vx * vx + vz * vz > V_TELEPORT * V_TELEPORT) { vx = 0; vz = 0; a._bcFresh = false; }
    else a._bcFresh = true;
    a._bcVx = (a._bcVx || 0) * 0.35 + vx * 0.65;
    a._bcVz = (a._bcVz || 0) * 0.35 + vz * 0.65;
  }
  function stamp(a, p) { a._bcX = p.x; a._bcZ = p.z; a._bcT = clock; }

  const _q = {}, _o = {};
  function speedOf(a) { return Math.hypot(a._bcVx || 0, a._bcVz || 0); }
  function cooling(A, B) {
    return (A._bcWith === B && clock - A._bcAt < PAIR_CD) || (B._bcWith === A && clock - B._bcAt < PAIR_CD);
  }
  // the last pass found these two overlapping (one slot a body: the man he is pressed on)
  function inContact(A, B) {
    return (A._bcCon === B && clock - A._bcConT < 0.12) || (B._bcCon === A && clock - B._bcConT < 0.12);
  }
  function markPair(A, B) { A._bcWith = B; A._bcAt = clock; B._bcWith = A; B._bcAt = clock; }

  function swimming(a) {
    if (isPlayer(a)) return !!(CBZ.player && CBZ.player._swim);
    return !!(a.swim || (a.char && a.char.swimming));
  }
  function impact(A, B, nx, nz, m) {
    if (cooling(A, B)) return;
    if (A._bcGoing || B._bcGoing) return;                // already on his way down: pushed, not hit again
    if (swimming(A) || swimming(B)) return;              // water takes a push, nobody falls over in it
    const vAx = A._bcVx || 0, vAz = A._bcVz || 0, vBx = B._bcVx || 0, vBz = B._bcVz || 0;
    const vc = (vAx - vBx) * nx + (vAz - vBz) * nz;
    if (!(vc > V_CLOSE_MIN)) return;
    const pa = isPlayer(A), pb = isPlayer(B);
    // the network: the faster body of the pair is the authority
    const remote = A._remote ? A : (B._remote ? B : null);
    if (remote) {
      const local = remote === A ? B : A;
      if (!isPlayer(local)) return;                       // only the local player trades impacts with a remote
      const sgn = remote === A ? 1 : -1;
      const vLocal = (local._bcVx * nx + local._bcVz * nz) * -sgn;   // local's speed INTO the remote
      const vRem = (remote._bcVx * nx + remote._bcVz * nz) * sgn;
      const R = remote._remote, net = CBZ.net;
      const mine = vLocal > vRem + 0.2 || (Math.abs(vLocal - vRem) <= 0.2 && net && net.id < R.id);
      if (!mine) { markPair(A, B); return; }
    }
    facingOf(A, _fa); facingOf(B, _fb);
    _q.mA = massOf(A); _q.mB = massOf(B);
    _q.vAx = vAx; _q.vAz = vAz; _q.vBx = vBx; _q.vBz = vBz; _q.nx = nx; _q.nz = nz;
    _q.fAx = _fa.x; _q.fAz = _fa.z; _q.fBx = _fb.x; _q.fBz = _fb.z;
    // the one moving INTO the other is the charger ("A" stance)
    const intoA = vAx * nx + vAz * nz, intoB = -(vBx * nx + vBz * nz);
    _q.stabA = stability(A, intoA >= intoB ? "A" : "B", speedOf(A));
    _q.stabB = stability(B, intoB > intoA ? "A" : "B", speedOf(B));
    _q.rollA = rng(); _q.rollB = rng();
    solve(_q, _o);
    markPair(A, B);
    if (_o.tierA === NONE && _o.tierB === NONE) return;
    impacts++;
    if (_o.tierA >= STUMBLE || _o.tierB >= STUMBLE) hardHits++;
    // brushes: each gives to his own right, so they pass
    const eo = _ev;
    eo.mode = m;
    eo.nx = -nx; eo.nz = -nz; eo.dv = _o.dvA; eo.e = _o.eA; eo.spin = _o.spinA; eo.side = 1; eo.source = B;
    const tA = _o.tierA, tB = _o.tierB;
    const dvB = _o.dvB, eB = _o.eB, spinB = _o.spinB;
    // what each body is still doing the instant after: its own velocity plus
    // the change the impact made (the runner is slower, the man he hit is moving)
    eo.vx = vAx - nx * _o.dvA; eo.vz = vAz - nz * _o.dvA;
    apply(A, tA, eo);
    eo.nx = nx; eo.nz = nz; eo.dv = dvB; eo.e = eB; eo.spin = spinB; eo.side = 1; eo.source = A;
    eo.vx = vBx + nx * dvB; eo.vz = vBz + nz * dvB;
    apply(B, tB, eo);
    eo.vx = eo.vz = undefined;
    if (remote && CBZ.net && CBZ.net.sendEv) {
      const R = remote._remote, rTier = remote === A ? tA : tB, lTier = remote === A ? tB : tA;
      const rn = remote === A ? -1 : 1;
      try { CBZ.net.sendEv({ e: "bump", to: R.id, tier: rTier, at: lTier, nx: +(nx * rn).toFixed(3), nz: +(nz * rn).toFixed(3), dv: +(remote === A ? _o.dvA : dvB).toFixed(2), ev: +(remote === A ? _o.eA : eB).toFixed(2) }); } catch (e) { /* offline */ }
    }
    // the victims hear about it
    social(A, B, tB, eB, m);
    social(B, A, tA, _o.eA, m);
  }
  const _ev = {};
  const KIND = [null, "bump", "shoved", "shoved", "run-over"];
  function social(src, victim, tier, e, m) {
    if (tier <= NONE || isPlayer(victim) || victim._remote || victim.dead) return;
    const byPlayer = isPlayer(src);
    const sev = tier === BRUSH ? 0.2 : tier === SHOVE ? 0.5 : tier === STUMBLE ? 0.75 : 1;
    if (tier === BRUSH) {
      // a brush is nothing, three in a row from the same man is something
      if (!byPlayer) return;
      // ...except to a man in uniform: your shoulder in an officer is noticed
      // every time (staffContact keeps his own count)
      if ((m === "escape" && (victim.kind === "guard" || victim.kind === "warden")) || (m === "city" && victim.kind === "cop")) {
        react(victim, { mode: m, source: src, kind: "bump", severity: sev });
        return;
      }
      victim._bumpCount = (victim._bumpCount || 0) + 1;
      if (victim._bumpCount >= 3 && reactionLevel(victim) > 0.6) {
        victim._bumpCount = 0;
        react(victim, { mode: m, source: src, kind: "repeated-shove", severity: 0.34 });
      }
      return;
    }
    react(victim, { mode: m, source: src, kind: KIND[tier], severity: sev });
    // an NPC who ran a man over and is not a brute says so
    if (!isPlayer(src) && !src._remote && reactionLevel(src) < 0.5 && !src.dead && isPlayer(victim) && CBZ.voice && rng() < 0.3) CBZ.voice.say(src, "bumpSorry", { by: victim });
  }

  /* HOW HARD A BODY IS TO PUSH ALONG (px,pz). A standing man is planted (his
     feet: x3). Against YOU a man is planted unless he is already walking the
     way you push: a man walking into you used to count as "moving", so you
     slid him backward across the yard at a jog. A man whose legs are going
     (the first beat of a fall) is pushed along by whoever is driving in. */
  function plant(a, px, pz, self, vsPlayer) {
    if (self) return 1;
    if (a._bcGoing) return 0.5;
    if (vsPlayer) return ((a._bcVx || 0) * px + (a._bcVz || 0) * pz) > 1.0 ? 1 : PLANT;
    return speedOf(a) < 0.3 ? PLANT : 1;
  }
  /* LEANING ON A MAN. Walking into somebody and keeping the stick forward is
     not an impact (nothing closes fast), so nothing happened: he stood there
     and you ground against him. Half a second of your weight on him and he
     gives the half step a shoulder brush gets, and hears about it. */
  let passDt = 0;
  function press(H, nx, nz, m) {
    const P = CBZ.player;
    if (!P || H._bcGoing || H._remote) return;
    const into = PV.x * nx + PV.z * nz;
    if (!(into > 0.5) && !((P.speed || 0) > 0.5)) return;
    if (H._bcPressAt == null || clock - H._bcPressAt > 0.3) H._bcPress = 0;
    H._bcPressAt = clock;
    H._bcPress = (H._bcPress || 0) + passDt;
    if (H._bcPress < 0.3) return;
    H._bcPress = 0;
    _ev.mode = m; _ev.nx = nx; _ev.nz = nz; _ev.dv = 0.6; _ev.e = T_BRUSH; _ev.spin = 0; _ev.source = playerOf(m);
    _ev.side = (H._contactIndex & 1) ? 1 : -1; _ev.vx = _ev.vz = undefined;
    apply(H, BRUSH, _ev);
    social(_ev.source, H, BRUSH, T_BRUSH, m);
  }
  function playerOf(m) { for (let i = 0; i < _live.length; i++) if (isPlayer(_live[i])) return _live[i]; return cityPlayer; }
  /* where the pair touches and how they are pushed apart */
  const TIGHT_MIN = 0.46, TIGHT_EASE = 0.6;
  function tightT(a) {
    const ch = (isPlayer(a) && !a._remote) ? CBZ.playerChar : (a.char || a.ch);
    if (ch && (ch.punchT > 0 || ch.kickT > 0)) a._bcTight = clock;
    return a._bcTight != null ? clock - a._bcTight : 9;
  }
  function separatePair(A, B, m, relax) {
    const ap = posOf(A), bp = posOf(B); if (!ap || !bp) return;
    let dx = bp.x - ap.x, dz = bp.z - ap.z;
    let min = radiusOf(A) + radiusOf(B);
    const pa = isPlayer(A), pb = isPlayer(B);
    if (m === "escape" && (pa ? fightingYou(B) : (pb && fightingYou(A)))) min += FIGHT_GAP;
    /* IN A BLOW THE PARTS DECIDE, NOT THE BARREL. The root capsule is 72 cm
       across two men (88 for the player in a fight); a knee is thrown from
       52, an uppercut from 74. The lunge put the striker inside the barrel
       and the barrel put him back out, every frame: he was shoved off the
       man he was hitting and the close blows could not reach. While either
       man of a pair is mid-blow (and for a moment after, easing back) the
       barrel shrinks to the trunks' own depth and the part pass keeps what
       is actually solid apart. */
    const tg = Math.min(tightT(A), tightT(B)), inFight = tg < TIGHT_EASE;
    if (inFight) min = TIGHT_MIN + Math.max(0, min - TIGHT_MIN) * smooth01(tg / TIGHT_EASE);
    const d2 = dx * dx + dz * dz;
    let nx = 0, nz = 0, overlap = 0, found = false;
    // where they stood at the end of the last pass: already touching then =
    // a sustained contact (leaning, a press, a queue), not a new impact
    const stamped = !relax && A._bcFresh && B._bcFresh && A._bcX != null && B._bcX != null;
    const r0x = stamped ? B._bcX - A._bcX : 0, r0z = stamped ? B._bcZ - A._bcZ : 0;
    const r02 = r0x * r0x + r0z * r0z;
    /* "Already touching" used to be a 5 cm band outside the contact distance.
       A sprint closes 10.7 cm a frame, so about half of all run-ins put the
       frame before contact inside that band, were read as a lean, and never
       became an impact at all: you bulldozed a standing man like a sled. A
       pair is touching when the last pass left them IN contact (it leaves a
       pair at exactly `min`, or a soft pair inside it). */
    const touching = stamped && (r02 < (min + 0.004) * (min + 0.004) || inContact(A, B));
    if (stamped && !touching) {
      /* SWEPT (CCD): the relative path r0 -> r1 since the last stamp. The
         first moment it reaches min is the real contact, and the normal
         THERE is the honest one: a fast pair that ends a step overlapped,
         swapped or clean through each other is put back on the side it came
         from, and a graze on the way past still counts as a hit. */
      const ex = dx - r0x, ez = dz - r0z, L2 = ex * ex + ez * ez;
      if (L2 > 1e-10) {
        const b2 = r0x * ex + r0z * ez;
        const disc = b2 * b2 - L2 * (r02 - min * min);
        if (disc >= 0) {
          const t = (-b2 - Math.sqrt(disc)) / L2;
          if (t >= 0 && t <= 1) {
            const cx = r0x + ex * t, cz = r0z + ez * t, cl = Math.hypot(cx, cz) || min;
            nx = cx / cl; nz = cz / cl;
            const sN = dx * nx + dz * nz;
            if (sN >= min) { impact(A, B, nx, nz, m); return; }   // a graze on the way past
            if (d2 >= min * min || dx * r0x + dz * r0z < 0) crossings++;
            overlap = min - sN;
            found = true;
          }
        }
      }
      if (!found && d2 >= min * min) return;
    } else if (stamped && r0x * dx + r0z * dz < 0 && r02 > 1e-8) {
      // they were touching and are now on each other's far side (a burst
      // of speed through a man already leaned on): back to the near side
      const r0 = Math.sqrt(r02);
      nx = r0x / r0; nz = r0z / r0;
      overlap = min - (dx * nx + dz * nz);
      crossings++;
      found = true;
    } else if (d2 >= min * min) return;
    if (!found) {
      let d;
      if (d2 <= 1e-8) {
        const sgn = ((A._contactIndex * 1103515245 + B._contactIndex * 12345) & 1) ? 1 : -1;
        dx = sgn; dz = 0; d = 1;
      } else d = Math.sqrt(d2);
      nx = dx / d; nz = dz / d; overlap = min - Math.min(d, min);
    }
    // an impact is a NEW contact; bodies already leaning on each other push
    // (below), they do not keep re-colliding every pass
    if (!touching && !relax) impact(A, B, nx, nz, m);

    // POSITIONAL: split by mass, a standing man planted
    const mA = massOf(A) * plant(A, -nx, -nz, pa, pb);
    const mB = massOf(B) * plant(B, nx, nz, pb, pa);
    let wA = mB / (mA + mB), wB = 1 - wA;
    const remote = A._remote || B._remote;
    if (remote) {
      // only my own player moves on my screen; his client moves him
      if (A._remote) { wA = 0; } else { wB = 0; }
    } else if (pa || pb) {
      // you: never inside a man (the camera is in your head) - full close,
      // and the player never gives less than half (he walked into it)
      if (pa) wA = Math.max(wA, 0.5); else wB = Math.max(wB, 0.5);
      const s = wA + wB; wA /= s; wB /= s;
      blocks++;
    }
    if (overlap > 0) { A._bcCon = B; A._bcConT = clock; B._bcCon = A; B._bcConT = clock; }
    if (touching && !relax && overlap > 0 && !remote) {
      if (pa && !pb) press(B, nx, nz, m); else if (pb && !pa) press(A, -nx, -nz, m);
    }
    let close = overlap;
    /* (TWO NPCs IN A FIGHT ARE CLOSED IN FULL, like a pair the player is in.
       The soft 60%-past-2-cm correction is for a queue or a crowd, so it
       does not buzz; on two men trading blows, with the barrel already
       shrunk to let the blows in, it let their roots sit inside even
       that: 43 cm apart, a trunk in a forearm.) */
    if (!pa && !pb && !remote && !inFight) {
      if (overlap <= SLOP) close = 0;
      else close = (overlap - SLOP) * SOFT;
    }
    if (close > 0) {
      ap.x -= nx * close * wA; ap.z -= nz * close * wA;
      bp.x += nx * close * wB; bp.z += nz * close * wB;
    }
    // (sliding along each other is this projection itself: a push that is
    // not dead centre leaves its tangential part, so bodies slip past; the
    // dead-centre case is the brush sidestep in impact())
    if (pa || pb) {
      const P = CBZ.player;
      if (P && (P.speed || 0) > 1.5 && !remote) P.speed = Math.min(P.speed, 1.5);
    }
  }

  /* ============================================================
     THE DOWNED: stepped over at a walk, tripped over at a run
     ============================================================ */
  const downed = [];
  let downGrid = null;
  function gatherDowned(m, list) {
    downed.length = 0;
    const P = CBZ.player && CBZ.player.pos;
    function take(a) {
      if (!a || a.culled || a.inCar || a.collected || a._npcAttached) return;
      const p = posOf(a); if (!p) return;
      if (P) { const dx = p.x - P.x, dz = p.z - P.z; if (dx * dx + dz * dz > 40 * 40) return; }   // cheap reject first
      if (!lying(a)) return;
      if (a._phys && a._phys.heldBy) return;
      if (CBZ.verbs && CBZ.verbs.held) { try { if (CBZ.verbs.held(isPlayer(a) ? realPlayerActor() : a)) return; } catch (e) { /* no verbs */ } }
      downed.push(a);
    }
    if (m === "city") {
      const L = CBZ.cityPeds, C = CBZ.cityCops;
      if (L) for (let i = 0; i < L.length; i++) take(L[i]);
      if (C) for (let i = 0; i < C.length; i++) take(C[i]);
    } else if (m === "escape") {
      const N = CBZ.npcs, G = CBZ.guards;
      if (N) for (let i = 0; i < N.length; i++) if (!N[i]._crowd) take(N[i]);
      if (G) for (let i = 0; i < G.length; i++) take(G[i]);
    } else if (CBZ.bots) {
      for (let i = 0; i < CBZ.bots.length; i++) take(CBZ.bots[i]);
    }
    const K = CBZ.corpses && CBZ.corpses.list;
    if (K) for (let i = 0; i < K.length; i++) take(K[i]);
    if (list) for (let i = 0; i < list.length; i++) if (list[i]._bcDown) take(list[i]);
    return downed.length;
  }
  function nudge(a, dx, dz, f, px, py, pz) {
    if (a.dead && CBZ.cityCorpseHit && a._ragSlot != null) {
      try { if (CBZ.cityCorpseHit(a, { x: px, y: py, z: pz }, { x: dx, y: 0, z: dz }, f * 2, { wound: false })) return true; } catch (e) { /* no ragdoll */ }
    }
    if (CBZ.bodyFall && CBZ.bodyFall.active && CBZ.bodyFall.active(a)) {
      try { return !!CBZ.bodyFall.poke(a, dx, dz, f, { x: px, y: py, z: pz }); } catch (e) { return false; }
    }
    return false;
  }
  /* A MAN ON THE FLOOR IS STILL A BODY. (OWNER: "I knock someone down and
     they have no colliders on the ground, I then can stand through them, it's
     dumb.") This used to be a 0.55 m ring round his hips that only a MOVING
     man ever tested: stand still on him, or walk down the length of him from
     the head, and you stood inside him. Now a lying man is what he is on the
     floor, a capsule from his feet to the crown of his head read off his live
     rig, and the rule is the one a real floor full of bodies obeys: you can
     STEP OVER him (a stride across him), and you can never STAND in him. A
     foot that stops inside him, or travels along him, is put down beside him.
     The man on top of him in the mount (verbs_strike's ground and pound) is
     kneeling astride him on purpose and is left there. */
  const CAP_R = 0.21;                 // a lying torso/leg's half-width on the floor (m)
  // world positions straight off the last rendered matrices (no THREE needed)
  const _cw = { x: 0, z: 0 }, _cw2 = { x: 0, z: 0 };
  function wpos(o, out) { const e = o.matrixWorld && o.matrixWorld.elements; if (!e) return false; out.x = e[12]; out.z = e[14]; return true; }
  let capFrame = 0;
  function capsuleOf(D) {
    let c = D._bcCap;
    if (c && c.f === capFrame) return c;
    if (!c) c = D._bcCap = { f: 0, ax: 0, az: 0, bx: 0, bz: 0, r: CAP_R };
    c.f = capFrame;
    const p = posOf(D), ch = D.char || D.ch || (isPlayer(D) && !D._remote ? CBZ.playerChar : null);
    if (ch && ch.head && ch.body && ch.group && ch.group.visible !== false && wpos(ch.head, _cw) && wpos(ch.body, _cw2)) {
      let ux = _cw.x - _cw2.x, uz = _cw.z - _cw2.z;
      const L = Math.hypot(ux, uz);
      const sc = (ch.group.userData && ch.group.userData.humanScale) ? ch.group.userData.humanScale / 0.7 : 1;
      if (L > 0.25) {
        ux /= L; uz /= L;
        c.ax = _cw.x + ux * 0.12 * sc; c.az = _cw.z + uz * 0.12 * sc;     // the crown
        c.bx = _cw2.x - ux * 0.95 * sc; c.bz = _cw2.z - uz * 0.95 * sc;   // the heels
        c.r = CAP_R * sc;
        return c;
      }
      // knelt / folded / sat up: a heap round the hips
      c.ax = c.bx = _cw2.x; c.az = c.bz = _cw2.z; c.r = 0.40 * sc;
      return c;
    }
    c.ax = c.bx = p.x; c.az = c.bz = p.z; c.r = 0.42;
    return c;
  }
  const _dq = { x: 0, z: 0, d: 0 };
  // closest point of segment a-b to (px, pz): leaves the push normal in _dq
  function capNormal(c, px, pz) {
    const abx = c.bx - c.ax, abz = c.bz - c.az, l2 = abx * abx + abz * abz;
    let t = l2 > 1e-8 ? ((px - c.ax) * abx + (pz - c.az) * abz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    let nx = px - (c.ax + abx * t), nz = pz - (c.az + abz * t);
    let d = Math.hypot(nx, nz);
    if (d < 1e-4) {                                  // dead on his spine: off to the nearer side of the line
      const l = Math.sqrt(l2) || 1;
      nx = -abz / l; nz = abx / l; d = 0;
      if (!(l2 > 1e-8)) { nx = 1; nz = 0; }
    } else { nx /= d; nz /= d; }
    _dq.x = nx; _dq.z = nz; _dq.d = d;
    return _dq;
  }
  function stepOver(list, m, dt, clampFn) {
    if (!gatherDowned(m, list)) return;
    capFrame++;
    if (!downGrid) downGrid = CBZ.makeGrid(CELL);
    downGrid.rebuild(downed, posOf);
    for (let i = 0; i < list.length; i++) {
      const S = list[i];
      if (S._remote || S._bcDown || S._bcSkip) continue;
      if (swimming(S)) continue;
      const p = posOf(S); if (!p) continue;
      const sp = speedOf(S);
      const gx = downGrid.cellIndex(p.x), gz = downGrid.cellIndex(p.z);
      for (let cx = gx - 1; cx <= gx + 1; cx++) for (let cz = gz - 1; cz <= gz + 1; cz++) {
        const bucket = downGrid.bucket(cx, cz); if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const D = bucket[k];
          if (D === S) continue;
          // (his real limbs and trunk, wherever they lie, are what a standing
          // man is kept off: partPass. The line below is only for a pair the
          // part solver cannot take: no rig, or over its cap.)
          const dq = posOf(D), qx = dq.x - p.x, qz = dq.z - p.z, q2 = qx * qx + qz * qz;
          const byParts = q2 < 4.4 && Math.abs((dq.y || 0) - (p.y || 0)) <= 1.2 && notePair(S, D, q2);
          if (S._gnpOn === D || (isPlayer(S) && CBZ.player && CBZ.player._gnpOn === D)) continue;
          // the officer walking in to kneel on him (the same verb, still in
          // its approach) is going to him on purpose: never pushed off him
          if (S._bcSess && S._bcSess === sessionOf(D)) continue;
          const dp = posOf(D);
          if (Math.abs((dp.y || 0) - (p.y || 0)) > 1.2) continue;
          const cap = capsuleOf(D);
          const n = capNormal(cap, p.x, p.z);
          const foot = radiusOf(S) * 0.45;           // a foot, not the whole shoulder width
          const min = cap.r + foot;
          if (n.d >= min) continue;
          // a stride ACROSS him is a step over; standing on him or walking
          // down the length of him is not
          const ux = sp > 1e-3 ? (S._bcVx || 0) / sp : 0, uz = sp > 1e-3 ? (S._bcVz || 0) / sp : 0;
          const across = sp >= 0.6 && Math.abs(ux * n.x + uz * n.z) > 0.45;
          if (!across) {
            if (byParts) continue;
            // put the foot down beside him, quickly but not as a snap
            const push = Math.min(min - n.d, Math.max(0.03, 3.2 * (dt || 0.016)));
            p.x += n.x * push; p.z += n.z * push;
            if (clampFn) clampFn(S);
            else if (CBZ.collide) CBZ.collide(p, radiusOf(S));
            continue;
          }
          if ((D._bcStepAt || -9) > clock - 0.45) continue;
          D._bcStepAt = clock;
          stepOvers++;
          // the foot catches him: a nudge along your stride, harder at a run
          nudge(D, ux, uz, sp < 2.6 ? 1.2 : 2 + sp * 0.5, dp.x, (dp.y || 0) + 0.2, dp.z);
          if (sp < 2.6) continue;                            // a walk steps over
          // a run: a trip. A stumble most of the time, down now and then
          const e = (sp - 2.6) * 0.55 + 1.3;
          const pd = sp > 5.2 ? 0.14 : 0;
          const tier = rng() < pd ? DOWN : (e >= T_STUMBLE ? STUMBLE : SHOVE);
          _ev.mode = m; _ev.nx = ux; _ev.nz = uz; _ev.dv = Math.min(2.4, sp * 0.3); _ev.e = e; _ev.spin = 0; _ev.side = 1; _ev.source = D;
          apply(S, tier, _ev);
        }
      }
    }
  }

  /* ============================================================
     BODY PARTS - a person is solid part by part (CBZ.bodyParts).

   Owner, 2026-11-24, looking at a stomp: "one guy is literally standing
   through another guy with their foot phased through the other guy... Why
   are there not mesh colliders with people?"

   Because a person was ONE vertical capsule at the root (and one line on
   the floor when down). Nothing below the root existed for contact: no
   foot, shin, thigh, forearm, fist or head. A foot was planted, a lunge
   stepped and a fist driven by the pose code with no test against the
   other man, and a blow "landed" on a zone sphere, not on him.

   Now every rig has its drawn parts as colliders, read live off its own
   joints in whatever pose it is in (standing, crouched, falling, lying,
   seated, carried): 13 capsules fitted to the drawn limbs.
       trunk (two side by side, pelvis to shoulders: the box's width and
       depth), head, upper arm and forearm+hand x2, thigh and shin x2,
       foot x2 (heel to toe along the sole)
   A rig's set is rebuilt at most once a frame, on demand, only when
   something near it asks. One service, used by everything:
     - the pass above finds who is near whom (the root capsule stays as the
       cheap broad phase and is all the instanced crowd ever gets) and
       hands the nearest pairs to partPass (order 92, after every pose
       writer), which
         . tests every limb of each man, segment against segment, against
           every part of the other, and re-solves a limb found in him (the
           elbow or knee swung out, the hand or foot moved off him): no
           source can leave a limb in somebody. A standing foot is moved
           along the floor and keeps its new spot;
         . moves the two ROOTS apart for what only the root can clear
           (trunk, head, the thighs at the hip).
     - footSpot / topAt: where a foot may come down. entities/gait.js asks
       for every landing, rest step and plant; entities/meleeposes.js for the
       feet it holds (a kick's standing foot, a lunge, a stagger step). A
       landing inside somebody is moved to the nearest free floor, and the
       swing clears what it crosses.
     - strikeHit: what a fist, elbow, knee, shin or foot is touching, how
       deep, and the surface normal there (systems/verbs_strike.js: the
       contact test of every blow; the zone spheres only name the result).
   People with their hands ON each other by a verb (a hold, a carry, an
   escort: one session) keep their arms and their roots where the verb put
   them: a gripping hand is in the thing it grips. Their legs, trunks and
   heads are tested like anyone's.

   Cost: nothing for a body with nobody within 1.6 m. A near pair that is
   not touching: 169 segment tests. One that is: ~600, at worst ~1,150
   (pure arithmetic, no allocation) plus an IK solve for each limb moved;
   at most PAIR_MAX pairs a frame, the ones nearest the player first. CBZ.bodyPartAudit() reports
   what it did and the deepest overlap it left.
     ============================================================ */
  const NP = 13, ST = 7;
  const PART = ["trunkL", "trunkR", "head", "upperArmL", "forearmL", "upperArmR", "forearmR", "thighL", "shinL", "thighR", "shinR", "footL", "footR"];
  const M_ALL = (1 << NP) - 1;
  const M_SELF = 1 | 2 | 4;
  const M_ARMS = (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6);
  const PAIR_MAX = 16, CAND_MAX = 64, NEAR = 1.6;
  let bpFrame = 1;
  if (CBZ.onUpdate) CBZ.onUpdate(0.2, function () { bpFrame++; });
  function rigOf(a) {
    if (!a) return null;
    if (isPlayer(a) && !a._remote) return CBZ.playerChar || a.char || null;
    const ch = a.char || a.ch;
    return ch && ch.parts && ch.group ? ch : null;
  }
  function wp(o, f, i) { const e = o.matrixWorld.elements; f[i] = e[12]; f[i + 1] = e[13]; f[i + 2] = e[14]; }
  function lp(o, x, y, z, f, i) {
    const e = o.matrixWorld.elements;
    f[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    f[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    f[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  // fresh: 0 = the matrices as last drawn (a frame old at worst), 1 = bring
  // this rig's world matrices up to date first, 2 = the caller just did
  function partsOf(ch, fresh) {
    let P = ch._bp;
    if (!P) P = ch._bp = { f: new Float32Array(NP * ST), frame: -1, mf: -1, x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0, s: 0.7, ok: false, ch: ch };
    if (P.frame === bpFrame && (!fresh || P.mf === bpFrame)) return P;
    const pr = ch.parts, lo = ch.low, body = ch.body, g = ch.group, sk = ch.sockets;
    P.ok = false;
    if (!pr || !lo || !body || !g || !sk || !pr.la || !pr.ra || !pr.ll || !pr.rl || !lo.la || !lo.ra || !lo.ll || !lo.rl || !sk.leftHand || !sk.rightHand) return P;
    if (fresh === 1 && P.mf !== bpFrame) g.updateMatrixWorld(true);
    if (fresh) P.mf = bpFrame;
    P.frame = bpFrame;
    const pf = ch.profile || {}, f = P.f;
    const be = body.matrixWorld.elements;
    const s = Math.hypot(be[0], be[1], be[2]) || 0.7;
    P.s = s;
    const tW = pf.torsoW || 0.412, tD = pf.torsoD || 0.29, lW = pf.legW || 0.268, aW = pf.armW || 0.174;
    const hipY = ch.hipY > 0 ? ch.hipY : (pf.legUp || 0.585) + (pf.legLo || 0.655);
    const shY = pr.la.position.y;
    const x1 = Math.max(0, tW * 0.5 - tD * 0.5);
    // trunk: his left half, his right half
    lp(body, x1, hipY - 0.06, 0, f, 0); lp(body, x1, shY - 0.10, 0, f, 3); f[6] = tD * 0.5 * s;
    lp(body, -x1, hipY - 0.06, 0, f, ST); lp(body, -x1, shY - 0.10, 0, f, ST + 3); f[ST + 6] = tD * 0.5 * s;
    // head
    let o = 2 * ST;
    if (ch.head) { wp(ch.head, f, o); wp(ch.head, f, o + 3); }
    else { lp(body, 0, shY + 0.34, 0, f, o); lp(body, 0, shY + 0.34, 0, f, o + 3); }
    f[o + 6] = 0.47 * (pf.headSize || 0.55) * (pf.headK || 1) * s;
    // arms: shoulder -> elbow, elbow -> past the wrist into the hand
    for (let k = 0; k < 2; k++) {
      const up = k ? pr.ra : pr.la, el = k ? lo.ra : lo.la, hd = k ? sk.rightHand : sk.leftHand;
      o = (3 + 2 * k) * ST;
      wp(up, f, o); wp(el, f, o + 3); f[o + 6] = aW * 0.5 * s;
      o += ST;
      wp(el, f, o); wp(hd, f, o + 3);
      const vx = f[o + 3] - f[o], vy = f[o + 4] - f[o + 1], vz = f[o + 5] - f[o + 2], vl = Math.hypot(vx, vy, vz) || 1, ex = 0.09 * s / vl;
      f[o + 3] += vx * ex; f[o + 4] += vy * ex; f[o + 5] += vz * ex;
      f[o + 6] = aW * 0.45 * s;
    }
    // legs: hip -> knee, knee -> ankle, the foot heel to toe
    for (let k = 0; k < 2; k++) {
      const th = k ? pr.ll : pr.rl, kn = k ? lo.ll : lo.rl, ft = th.userData && th.userData.foot;
      o = (7 + 2 * k) * ST;
      wp(th, f, o); wp(kn, f, o + 3); f[o + 6] = lW * 0.5 * s;
      o += ST;
      wp(kn, f, o);
      if (ft) wp(ft, f, o + 3); else lp(kn, 0, -(pf.legLo || 0.655), 0, f, o + 3);
      f[o + 6] = lW * (pf.shinK || 0.9) * 0.5 * s;
      const fo = (11 + k) * ST;
      const d = ft && ft.userData && ft.userData.dims;
      if (d) {
        const ha = ft.position.y - d.sole, rf = Math.min(d.W, d.H) * 0.5;
        lp(ft, 0, -ha + rf, -0.30 * d.D + rf, f, fo); lp(ft, 0, -ha + rf, 0.70 * d.D - rf, f, fo + 3);
        f[fo + 6] = rf * s;
      } else {
        f[fo] = f[fo + 3] = f[o + 3]; f[fo + 1] = f[fo + 4] = f[o + 4]; f[fo + 2] = f[fo + 5] = f[o + 5];
        f[fo + 6] = 0.06 * s / 0.7;
      }
    }
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, xm = -1e9, ym = -1e9, zm = -1e9;
    for (let i = 0, q = 0; i < NP; i++, q += ST) {
      const r = f[q + 6];
      for (let e = 0; e < 6; e += 3) {
        const x = f[q + e], y = f[q + e + 1], z = f[q + e + 2];
        if (!(x === x)) return P;                                  // a rig not placed yet
        if (x - r < x0) x0 = x - r; if (x + r > xm) xm = x + r;
        if (y - r < y0) y0 = y - r; if (y + r > ym) ym = y + r;
        if (z - r < z0) z0 = z - r; if (z + r > zm) zm = z + r;
      }
    }
    P.x0 = x0; P.x1 = xm; P.y0 = y0; P.y1 = ym; P.z0 = z0; P.z1 = zm;
    P.ok = true;
    return P;
  }
  // ---- the two tests (pure arithmetic) ----
  // out: depth (m, > 0 = inside), n (out of the part), s (the point on the
  // part's surface), part, d (centre to axis), rr (the two radii)
  function hitRec() { return { depth: 0, nx: 0, ny: 1, nz: 0, sx: 0, sy: 0, sz: 0, part: -1, d: 0, rr: 0, cx: 0, cy: 0, cz: 0 }; }
  const _h = hitRec(), _h2 = hitRec(), _fh = hitRec();
  let tests = 0;
  function sphVsParts(P, px, py, pz, r, mask, out) {
    out.depth = 0; out.part = -1;
    if (!P.ok || px + r < P.x0 || px - r > P.x1 || py + r < P.y0 || py - r > P.y1 || pz + r < P.z0 || pz - r > P.z1) return false;
    const f = P.f;
    for (let i = 0, o = 0; i < NP; i++, o += ST) {
      if (!((mask >> i) & 1)) continue;
      tests++;
      const ax = f[o], ay = f[o + 1], az = f[o + 2], ex = f[o + 3] - ax, ey = f[o + 4] - ay, ez = f[o + 5] - az;
      const rr = f[o + 6] + r, l2 = ex * ex + ey * ey + ez * ez;
      let t = l2 > 1e-10 ? ((px - ax) * ex + (py - ay) * ey + (pz - az) * ez) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + ex * t, cy = ay + ey * t, cz = az + ez * t;
      const dx = px - cx, dy = py - cy, dz = pz - cz, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2), dep = rr - d;
      if (dep <= out.depth) continue;
      out.depth = dep; out.part = i; out.d = d; out.rr = rr;
      if (d > 1e-5) { out.nx = dx / d; out.ny = dy / d; out.nz = dz / d; } else { out.nx = 0; out.ny = 1; out.nz = 0; }
      out.cx = cx; out.cy = cy; out.cz = cz;
      out.sx = cx + out.nx * f[o + 6]; out.sy = cy + out.ny * f[o + 6]; out.sz = cz + out.nz * f[o + 6];
    }
    return out.depth > 0;
  }
  // capsule i of A against capsule j of B: depth and the normal from B to A
  const _cc = { depth: 0, nx: 0, ny: 0, nz: 0, bx: 0, by: 0, bz: 0, s: 0 };
  function capVsCap(fa, oa, fb, ob) {
    tests++;
    const p1x = fa[oa], p1y = fa[oa + 1], p1z = fa[oa + 2], d1x = fa[oa + 3] - p1x, d1y = fa[oa + 4] - p1y, d1z = fa[oa + 5] - p1z;
    const p2x = fb[ob], p2y = fb[ob + 1], p2z = fb[ob + 2], d2x = fb[ob + 3] - p2x, d2y = fb[ob + 4] - p2y, d2z = fb[ob + 5] - p2z;
    const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
    const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, ff = d2x * rx + d2y * ry + d2z * rz;
    let s = 0, t = 0;
    if (a <= 1e-10 && e <= 1e-10) { s = 0; t = 0; }
    else if (a <= 1e-10) { t = ff / e; t = t < 0 ? 0 : t > 1 ? 1 : t; }
    else {
      const c = d1x * rx + d1y * ry + d1z * rz;
      if (e <= 1e-10) { s = -c / a; s = s < 0 ? 0 : s > 1 ? 1 : s; }
      else {
        const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
        s = den > 1e-12 ? (b * ff - c * e) / den : 0;
        s = s < 0 ? 0 : s > 1 ? 1 : s;
        t = (b * s + ff) / e;
        if (t < 0) { t = 0; s = -c / a; s = s < 0 ? 0 : s > 1 ? 1 : s; }
        else if (t > 1) { t = 1; s = (b - c) / a; s = s < 0 ? 0 : s > 1 ? 1 : s; }
      }
    }
    const qx = p2x + d2x * t, qy = p2y + d2y * t, qz = p2z + d2z * t;
    const nx = p1x + d1x * s - qx, ny = p1y + d1y * s - qy, nz = p1z + d1z * s - qz;
    const d = Math.sqrt(nx * nx + ny * ny + nz * nz), rr = fa[oa + 6] + fb[ob + 6];
    _cc.depth = rr - d; _cc.bx = qx; _cc.by = qy; _cc.bz = qz; _cc.s = s; _cc.rr = rr;
    if (d > 1e-5) { _cc.nx = nx / d; _cc.ny = ny / d; _cc.nz = nz / d; } else { _cc.nx = 0; _cc.ny = 1; _cc.nz = 0; }
    return _cc.depth;
  }

  // ---- who is near whom (filled by resolve, used by partPass and the gait) ----
  const candA = new Array(CAND_MAX), candB = new Array(CAND_MAX), candS = new Float32Array(CAND_MAX);
  const pairA = new Array(PAIR_MAX), pairB = new Array(PAIR_MAX);
  let candN = 0, pairN = 0, pairsDropped = 0, bpClamp = null;
  function nearRig(ch, other) {
    if (ch._bpNf !== bpFrame) { ch._bpNf = bpFrame; ch._bpNn = 0; if (!ch._bpN) ch._bpN = [null, null, null, null]; }
    if (ch._bpNn < 4) ch._bpN[ch._bpNn++] = other;
  }
  function notePair(A, B, d2) {
    const ca = rigOf(A), cb = rigOf(B);
    if (!ca || !cb || ca === cb) return false;
    nearRig(ca, cb); nearRig(cb, ca);
    if (candN >= CAND_MAX) { pairsDropped++; return false; }
    // nearest the player first (a pair the player is in: first of all)
    let sc = d2;
    const P = CBZ.player && CBZ.player.pos, ap = posOf(A), bp = posOf(B);
    if (isPlayer(A) || isPlayer(B)) sc = -1 + d2 * 0.01;
    else if (ca.punchT > 0 || ca.kickT > 0 || cb.punchT > 0 || cb.kickT > 0 || (ca.hitReact && ca.hitReact.on) || (cb.hitReact && cb.hitReact.on)) sc = -0.5 + d2 * 0.01;
    else if (P && ap && bp) { const mx = (ap.x + bp.x) * 0.5 - P.x, mz = (ap.z + bp.z) * 0.5 - P.z; sc = mx * mx + mz * mz + d2 * 0.01; }
    candA[candN] = A; candB[candN] = B; candS[candN] = sc; candN++;
    return true;
  }
  function selectPairs() {
    pairN = 0;
    const n = Math.min(PAIR_MAX, candN);
    for (let k = 0; k < n; k++) {
      let bi = -1, bs = 1e18;
      for (let i = 0; i < candN; i++) if (candS[i] < bs) { bs = candS[i]; bi = i; }
      if (bi < 0) break;
      pairA[pairN] = candA[bi]; pairB[pairN] = candB[bi]; pairN++;
      candS[bi] = 1e19;
    }
    if (candN > PAIR_MAX) pairsDropped += candN - PAIR_MAX;
    for (let i = 0; i < candN; i++) { candA[i] = null; candB[i] = null; }
    candN = 0;
  }

  // ---- the audit ----
  const AU = { frames: 0, pairs: 0, tests: 0, deepest: 0, deepestA: "", deepestB: "", deepestPartA: "", deepestPartB: "",
    deepestBefore: 0, rootPushes: 0, feetReplaced: 0, limbsPushed: 0, limbFrames: 0, strikesStopped: 0, heldPairs: 0, pairsDropped: 0 };
  // limb re-solves and standing-foot moves by contact (his part * NP + the other's part)
  const LFB = new Int32Array(NP * NP), FRB = new Int32Array(NP * NP);
  const strikeLog = [];
  function byTable(T) {
    const o = {};
    for (let i = 0; i < NP; i++) for (let j = 0; j < NP; j++) if (T[i * NP + j]) o[PART[i] + ">" + PART[j]] = T[i * NP + j];
    return o;
  }
  // the worst frame of the window: what the two men were doing when the pass left the most overlap
  const WORST = { depth: 0, frame: 0, parts: ["", ""], actors: ["", ""], attackerState: "", targetState: "", bothStriking: false,
    rootDist: 0, rigDist: 0, at: [0, 0, 0, 0, 0, 0], capsuleR: [0, 0], capsuleShrunk: false, firstToYield: "", solvesThatFrame: 0, rootPushesThatFrame: 0, before: 0 };
  function stateOf(a, ch) {
    const f = ch.fall, knee = f && f.on && (f.variant === "liver" || f.variant === "kneel");
    if (lying(a)) return knee ? "kneeling" : f && f.on && f.ko ? "down (out cold)" : "down";
    if (f && f.on) return f.phase === "getup" ? "getting up" : knee ? "kneeling" : "falling";
    if (ch.punchT > 0) return "striking (" + (ch.punchKind || "punch") + ")";
    if (ch.kickT > 0) return "striking (" + (ch.kickKind || "kick") + " kick)";
    if (ch.mount) return "mounted";
    if (ch._mountGo) return "getting on";
    if ((ch.blockK || 0) > 0.55) return "blocking";
    if ((ch.hitReact && ch.hitReact.on) || (ch.footStep && ch.footStep.on) || ch.staggerT > 0) return "staggering";
    return ch.fightStance ? "guard" : "standing";
  }
  function nameOf(a) { return a ? (isPlayer(a) ? "player" : String(a.name || a.id || a.kind || "actor")) : ""; }
  function seen(depth, A, B, pa, pb) {
    if (depth > AU.deepest) { AU.deepest = depth; AU.deepestA = nameOf(A); AU.deepestB = nameOf(B); AU.deepestPartA = pa; AU.deepestPartB = pb; }
  }
  /* CBZ.bodyPartAudit(keep): what the part solver did since the last call
     (keep = true: do not reset the window).
       frames          part passes run
       pairs           pairs of people narrow-tested
       tests           segment tests made
       deepest         the deepest overlap LEFT between any part of one
                       man and any part of another after the pass acted
                       (m, segment against segment), with who and which
                       parts (for two people in one hold: all but the arms)
       deepestBefore   the deepest overlap FOUND before anything was moved
       rootPushes      times two roots were moved apart by their parts
       feetReplaced    standing feet put down somewhere else (each move
                       stays: it is not repeated)
       limbsPushed     times a limb STARTED being held off a body (it was
                       not the frame before)
       limbFrames      limb re-solves in all (a limb held off a body it is
                       posed into is re-solved every frame it is)
       strikesStopped  blows stopped at the surface they met
       limbFramesBy    the same, by contact: "his part>the other's part":
                       the contact that is re-solved every frame is the
                       one with the big number
       feetReplacedBy  the standing-foot moves, by the same key
       strikes         what became of each blow in the window ("kind: ...")
       worst           the frame of the window that was left with the most
                       overlap: depth (after) and before, frame (the pass
                       number in the window), parts, actors [first, second],
                       attackerState / targetState (striking (kind), blocking,
                       staggering, guard, standing, falling, down, kneeling,
                       getting up, getting on, mounted; the attacker is the
                       one striking, else the first), bothStriking, rootDist
                       (m, between the two positions), rigDist (between the
                       two rigs the parts are read from), at (the middle of
                       each of the two parts, world x y z, x y z),
                       capsuleR [each], capsuleShrunk (the pair's root
                       capsules are at their mid-blow 0.46 m), firstToYield
                       (whose limbs were solved first), solvesThatFrame,
                       rootPushesThatFrame
       heldPairs       pairs in one hold whose gripping hands were left alone
       pairsDropped    near pairs not tested (over the per-frame cap) */
  CBZ.bodyPartAudit = function (keep) {
    const r = { frames: AU.frames, pairs: AU.pairs, tests: AU.tests, deepest: AU.deepest,
      deepestActors: [AU.deepestA, AU.deepestB], deepestParts: [AU.deepestPartA, AU.deepestPartB], deepestBefore: AU.deepestBefore,
      rootPushes: AU.rootPushes, feetReplaced: AU.feetReplaced, limbsPushed: AU.limbsPushed, limbFrames: AU.limbFrames, strikesStopped: AU.strikesStopped,
      heldPairs: AU.heldPairs, pairsDropped: AU.pairsDropped,
      limbFramesBy: byTable(LFB), feetReplacedBy: byTable(FRB), strikes: strikeLog.slice(),
      worst: WORST.depth > 0 ? { depth: WORST.depth, before: WORST.before, frame: WORST.frame, parts: WORST.parts.slice(), actors: WORST.actors.slice(),
        attackerState: WORST.attackerState, targetState: WORST.targetState, bothStriking: WORST.bothStriking, rootDist: WORST.rootDist,
        rigDist: WORST.rigDist, at: WORST.at.slice(),
        capsuleR: WORST.capsuleR.slice(), capsuleShrunk: WORST.capsuleShrunk, firstToYield: WORST.firstToYield,
        solvesThatFrame: WORST.solvesThatFrame, rootPushesThatFrame: WORST.rootPushesThatFrame } : null };
    if (!keep) {
      WORST.depth = 0;
      LFB.fill(0); FRB.fill(0); strikeLog.length = 0;
      AU.frames = AU.pairs = AU.tests = AU.rootPushes = AU.feetReplaced = AU.limbsPushed = AU.limbFrames = AU.strikesStopped = AU.heldPairs = AU.pairsDropped = 0;
      AU.deepest = AU.deepestBefore = 0; AU.deepestA = AU.deepestB = AU.deepestPartA = AU.deepestPartB = "";
    }
    return r;
  };

  // ---- re-solving a limb (entities/meleeposes.js's two-bone IK) ----
  let _T = null, _Pv = null;
  function scratch() { const T3 = window.THREE; if (!_T && T3) { _T = new T3.Vector3(); _Pv = new T3.Vector3(); } return !!_T; }
  function mounted(A, B) {
    const P = CBZ.player;
    return A._gnpOn === B || B._gnpOn === A || (P && ((isPlayer(A) && P._gnpOn === B) || (isPlayer(B) && P._gnpOn === A)));
  }
  // the horizontal way out of a part, and how far (a point at height: the
  // sideways distance at which a sphere clears a capsule it is over)
  const _esc = { x: 0, z: 0, d: 0 };
  function escape(h, fromX, fromZ) {
    let nx = h.nx, nz = h.nz;
    const nh = Math.hypot(nx, nz);
    if (nh < 0.2) { nx = fromX - h.cx; nz = fromZ - h.cz; const l = Math.hypot(nx, nz); if (l > 1e-4) { nx /= l; nz /= l; } else { nx = 1; nz = 0; } }
    else { nx /= nh; nz /= nh; }
    const dy = h.d * h.ny, h0 = h.d * nh;
    const need = Math.sqrt(Math.max(0, h.rr * h.rr - dy * dy));
    _esc.x = nx; _esc.z = nz; _esc.d = Math.max(0, need - h0);
    return _esc;
  }
  /* WHERE A FOOT MAY COME DOWN. (x, z) on the floor at height y, the foot
     heading yaw; out.x / out.z = the nearest spot where the foot and the
     ankle over it (heel and ball, each a sphere the width of the shin) are
     in nobody. False when nothing had to move. */
  const _fs = { x: 0, z: 0 };
  function footSpot(ch, x, y, z, yaw, out) {
    out = out || _fs;
    out.x = x; out.z = z;
    if (!ch || !(ch._bpNf >= bpFrame - 1) || !ch._bpNn) return false;
    const sc = ((ch._bp && ch._bp.s) || 0.7) / 0.7, r = 0.088 * sc;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), g = ch.group.position;
    let moved = false;
    for (let it = 0; it < 3; it++) {
      let best = 0.002, ex = 0, ez = 0;
      for (let n = 0; n < ch._bpNn; n++) {
        const o = ch._bpN[n];
        if (!o || !o.group || o.group.visible === false) continue;
        const P = partsOf(o, 0);
        if (!P.ok) continue;
        for (let e = 0; e < 2; e++) {
          const off = e ? 0.12 * sc : -0.05 * sc;
          if (sphVsParts(P, out.x + fx * off, y + r, out.z + fz * off, r, M_ALL, _fh) && _fh.depth > best) {
            const q = escape(_fh, g.x, g.z);
            best = _fh.depth; ex = q.x * (q.d + 0.012); ez = q.z * (q.d + 0.012);
          }
        }
      }
      if (best <= 0.002) break;
      out.x += ex; out.z += ez; moved = true;
    }
    // (never further than a stride from where it was asked: past that it is asked again next step)
    if (moved) { const dx = out.x - x, dz = out.z - z, d = Math.hypot(dx, dz), lim = 0.45 * sc; if (d > lim) { out.x = x + dx / d * lim; out.z = z + dz / d * lim; } }
    return moved;
  }
  // the top of whatever body lies over (x, z): world y, or -1e9 for bare floor
  // pad: how far beyond a part's own radius still counts as over it (7 cm: a sole's width; a caller
  // asking for a standing SHIN's clearance passes more)
  function topAt(ch, x, z, pad) {
    let top = -1e9;
    if (!ch || !(ch._bpNf >= bpFrame - 1) || !ch._bpNn) return top;
    for (let n = 0; n < ch._bpNn; n++) {
      const o = ch._bpN[n];
      if (!o || !o.group || o.group.visible === false) continue;
      const P = partsOf(o, 0);
      if (!P.ok || x < P.x0 || x > P.x1 || z < P.z0 || z > P.z1) continue;
      const f = P.f;
      for (let i = 0, q = 0; i < NP; i++, q += ST) {
        const ax = f[q], az = f[q + 2], ex = f[q + 3] - ax, ez = f[q + 5] - az, l2 = ex * ex + ez * ez;
        let t = l2 > 1e-10 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - (ax + ex * t), dz = z - (az + ez * t), rr = f[q + 6] + (pad > 0 ? pad : 0.07);
        if (dx * dx + dz * dz > rr * rr) continue;
        const y = f[q + 1] + (f[q + 4] - f[q + 1]) * t + f[q + 6];
        if (y > top) top = y;
      }
    }
    return top;
  }
  // the deepest overlap of X's parts in mx against Y's parts in my (the
  // record: i, j, depth, the normal out of Y, where along X's part, the
  // point on Y's axis and Y's radius there)
  function dRec() { return { depth: 0, i: -1, j: -1, nx: 0, ny: 1, nz: 0, s: 0, qx: 0, qy: 0, qz: 0, rb: 0, rr: 0 }; }
  const _d = dRec(), _d2 = dRec(), _d3 = dRec();
  function deepest(PX, mx, PY, my, out, floor) {
    out.depth = floor; out.i = -1; out.j = -1;
    const fa = PX.f, fb = PY.f;
    for (let i = 0; i < NP; i++) {
      if (!((mx >> i) & 1)) continue;
      for (let j = 0; j < NP; j++) {
        if (!((my >> j) & 1)) continue;
        const d = capVsCap(fa, i * ST, fb, j * ST);
        if (d > out.depth) {
          out.depth = d; out.i = i; out.j = j; out.nx = _cc.nx; out.ny = _cc.ny; out.nz = _cc.nz;
          out.s = _cc.s; out.qx = _cc.bx; out.qy = _cc.by; out.qz = _cc.bz; out.rb = fb[j * ST + 6]; out.rr = _cc.rr;
        }
      }
    }
    return out.i >= 0;
  }
  /* WHAT A BLOW IS TOUCHING. The striking SEGMENT of the attacker (segs: his
     forearm and fist, his shin and foot, his thigh to the knee, his head: a
     mask of his own parts) and the striking point (a sphere, r: a weapon's
     tip, the knuckles) against the target's parts as posed this frame. A
     round kick's foot wrapping round a guard, a forearm crossing a forearm,
     are contacts like the fist's own. An arm in the way is met first.
     Returns { part, depth (m; > 0 inside, down to -skin = touching), n (out
     of him), s (the point on his surface) } or null. */
  const _sh = { part: -1, depth: 0, nx: 0, ny: 1, nz: 0, sx: 0, sy: 0, sz: 0 };
  function strikeHit(tch, ach, segs, px, py, pz, r, skin) {
    const PY = partsOf(tch, 2);
    if (!PY.ok) return null;
    return shTake(PY, ach, segs, px, py, pz, r, skin, M_ARMS) || shTake(PY, ach, segs, px, py, pz, r, skin, M_ALL & ~M_ARMS) ? _sh : null;
  }
  function shTake(PY, ach, segs, px, py, pz, r, skin, my) {
    {
      let dep = -skin, src = 0;
      if (ach && segs) {
        const PX = partsOf(ach, 1);
        if (PX.ok && deepest(PX, segs, PY, my, _d3, -skin)) { dep = _d3.depth; src = 1; }
      }
      if (sphVsParts(PY, px, py, pz, r + skin, my, _h2) && _h2.depth - skin > dep) { dep = _h2.depth - skin; src = 2; }
      if (!src) return false;
      _sh.depth = dep;
      if (src === 1) {
        _sh.part = _d3.j; _sh.nx = _d3.nx; _sh.ny = _d3.ny; _sh.nz = _d3.nz;
        _sh.sx = _d3.qx + _d3.nx * _d3.rb; _sh.sy = _d3.qy + _d3.ny * _d3.rb; _sh.sz = _d3.qz + _d3.nz * _d3.rb;
      } else {
        _sh.part = _h2.part; _sh.nx = _h2.nx; _sh.ny = _h2.ny; _sh.nz = _h2.nz; _sh.sx = _h2.sx; _sh.sy = _h2.sy; _sh.sz = _h2.sz;
      }
      return true;
    }
  }

  /* ---- THE PASS (order 92, after every pose writer) ----------------------
     For each near pair, in this order:
       1. every LIMB of each man (upper and lower segment, and the foot)
          against every part of the other, segment against segment. A limb
          found in him is re-solved: the contact is on the forearm or the
          shin -> the elbow / knee and the hand / foot are both moved off
          him, in the share that moves the touching point out; on the upper
          arm or the thigh -> the elbow / knee swings out round the limb's
          own line (the IK's pole), and if that cannot clear it the hand or
          foot gives too. A foot that is STANDING is moved along the floor
          and stays where it is put (the gait's plant, the strike layer's
          spot, a kick's anchor): placed once, not pushed every frame.
       2. what only the ROOT can clear (trunk, head, the thighs at the hip)
          moves the roots apart, the whole overlap, the same frame.
     The overlap left after both is what the audit calls `deepest`.
     People in one hold keep their arms where the hold put them (a gripping
     hand is in what it grips) and their roots where the verb put them;
     their legs, trunks and heads are tested like anyone's. */
  const M_TRUNK = 1 | 2 | 4 | (1 << 7) | (1 << 9);
  const M_LIMB = [(1 << 3) | (1 << 4), (1 << 5) | (1 << 6), (1 << 7) | (1 << 8) | (1 << 11), (1 << 9) | (1 << 10) | (1 << 12)];
  function plantedFoot(ch, k) {
    if (ch._mountK > 0 || ch.sitting || ch.lying) return false;
    if (ch.fall && ch.fall.on) return false;
    if (ch.kickT > 0 && ((ch.kickLeg === "l") === !k)) return false;
    const fs = ch.footStep;
    if (fs && fs.on) return false;
    const G = ch._gv;
    if (G && G.init && G.w > 0.5 && G.feet) return !G.feet[k ? 0 : 1].sw;
    return !!(ch._mOwn && ch._mFt);
  }
  function movePlant(ch, k, dx, dz) {
    const G = ch._gv, g = ch.group;
    if (G && G.init && G.w > 0.5 && G.feet) { const F = G.feet[k ? 0 : 1]; if (F && !F.sw) { F.x += dx; F.z += dz; } }
    if (ch._mFt && g) {
      const MP = CBZ.meleePoses, sc = (MP && MP.dims ? MP.dims(ch).scale : 0.7) || 0.7;
      const yaw = g.rotation.y, c = Math.cos(yaw), sn = Math.sin(yaw), i = k ? 2 : 0;
      ch._mFt[i] += (dx * c - dz * sn) / sc; ch._mFt[i + 1] += (dx * sn + dz * c) / sc;
      const A = ch._mPl;
      if (A && A.on && ((ch.kickLeg === "l") === !!k)) { A.x += dx; A.z += dz; }
    }
  }
  function pushed(ch, li) {
    let st = ch._bpLp;
    if (!st) st = ch._bpLp = new Int32Array(4);
    if (st[li] < bpFrame - 1) AU.limbsPushed++;
    st[li] = bpFrame;
    AU.limbFrames++;
  }
  // li: 0 left arm, 1 right arm, 2 left leg, 3 right leg (his own left / right)
  // flat: he is lying on the floor: his limb gives along the floor, never up off it
  function fixLimb(X, chX, PX, li, PY, round, flat) {
    const MP = CBZ.meleePoses;
    if (!MP || !MP.solveArm || !MP.solveLeg || !MP.dims || !scratch() || !chX.model) return false;
    if (!deepest(PX, M_LIMB[li], PY, M_ALL, _d, 0.003)) return false;
    const f = PX.f, arm = li < 2, k = li & 1;
    const iU = arm ? 3 + 2 * k : 7 + 2 * k, oW = (iU + 1) * ST;
    const dep = _d.depth + 0.002;
    const dx = _d.nx * dep, dy = _d.ny * dep, dz = _d.nz * dep;
    let mx = 0, my = 0, mz = 0, ex = 0, ey = 0, ez = 0;
    const onUpper = _d.i === iU, onFoot = !arm && _d.i === 11 + k;
    const planted = !arm && plantedFoot(chX, k);
    if (flat) {
      /* A LIMB LYING ON THE FLOOR SLIDES, IT DOES NOT RISE. A lying man's
         arm in a standing man's shin was solved like any limb: out along
         the contact, and for a contact on the upper arm by swinging the
         elbow round the line from shoulder to hand. For an arm flat on
         the floor that swing has only one way to go, UP: the elbow tented
         off the floor, the rider's leg met it higher, pushed it higher,
         and a knocked-out man's arm stood straight up beside the rider
         (thigh in upper arm, half a metre off the floor). On the floor
         the whole limb is moved SIDEWAYS, elbow and hand (knee and foot)
         by the same amount, away from what is in it, by the distance at
         which it clears at its own height. */
      let hx = _d.nx, hz = _d.nz;
      const nh0 = Math.hypot(hx, hz);
      let nh = nh0;
      if (nh < 0.25) {
        // (something is ON it: off to the side its own middle is on, from the other part's axis)
        const o = _d.i * ST;
        hx = (f[o] + f[o + 3]) * 0.5 - _d.qx; hz = (f[o + 2] + f[o + 5]) * 0.5 - _d.qz;
        nh = Math.hypot(hx, hz);
        if (nh < 1e-3) { const gp = chX.group.position; hx = gp.x - _d.qx; hz = gp.z - _d.qz; nh = Math.hypot(hx, hz) || 1; }
      }
      hx /= nh; hz /= nh;
      const dc = _d.rr - _d.depth, dyc = dc * _d.ny, hc = dc * nh0;
      const sideOff = Math.sqrt(Math.max(0, _d.rr * _d.rr - dyc * dyc)) - hc + 0.004;
      const dist = Math.min(0.25, Math.max(dep / Math.max(nh0, 0.4), sideOff));
      mx = ex = hx * dist; mz = ez = hz * dist;
      pushed(chX, li);
    } else if (planted && !onUpper) {
      // a standing foot: along the floor, and it stays there
      let hx = _d.nx, hz = _d.nz, nh = Math.hypot(hx, hz);
      if (nh < 0.25) { const gp = chX.group.position; hx = gp.x - _d.qx; hz = gp.z - _d.qz; const l = Math.hypot(hx, hz) || 1; hx /= l; hz /= l; nh = 0.4; }
      else { hx /= nh; hz /= nh; }
      const t = onFoot ? 1 : Math.max(_d.s, 0.4);
      // (a foot ON a part, the contact pointing up, has to come off it sideways by the
      // distance at which a foot at that height clears it, not by the overlap: the root rule's own sum)
      const dc = _d.rr - _d.depth, dyc = dc * _d.ny, hc = dc * Math.hypot(_d.nx, _d.nz);
      const sideOff = Math.sqrt(Math.max(0, _d.rr * _d.rr - dyc * dyc)) - hc + 0.004;
      const dist = Math.min(0.3, Math.max(dep / Math.max(nh, 0.4), sideOff) / t);
      ex = hx * dist; ez = hz * dist; mx = ex * 0.5; mz = ez * 0.5;
      movePlant(chX, k, ex, ez);
      AU.feetReplaced++; FRB[_d.i * NP + _d.j]++;
    } else if (onUpper) {
      const tt = Math.max(_d.s, 0.35), q = 1 / tt;
      mx = dx * q; my = dy * q; mz = dz * q;
      const ml = Math.hypot(mx, my, mz);
      if (ml > 0.25) { mx *= 0.25 / ml; my *= 0.25 / ml; mz *= 0.25 / ml; }
      if (round > 0 && !planted) { ex = dx * 0.6; ey = dy * 0.6; ez = dz * 0.6; }
      pushed(chX, li);
    } else {
      const t = onFoot ? 1 : _d.s, S = (1 - t) * (1 - t) + t * t, a = (1 - t) / S, b = t / S;
      mx = dx * a; my = dy * a; mz = dz * a; ex = dx * b; ey = dy * b; ez = dz * b;
      pushed(chX, li);
    }
    if (flat || !(planted && !onUpper)) LFB[_d.i * NP + _d.j]++;
    let part;
    if (arm) {
      part = k ? chX.parts.ra : chX.parts.la;
      const low = k ? chX.low.ra : chX.low.la, sock = k ? chX.sockets.rightHand : chX.sockets.leftHand;
      const e = sock.matrixWorld.elements;
      _T.set(e[12] + ex, e[13] + ey, e[14] + ez); chX.body.worldToLocal(_T);
      _Pv.set(f[oW] + mx, f[oW + 1] + my, f[oW + 2] + mz); chX.body.worldToLocal(_Pv); _Pv.sub(part.position);
      MP.solveArm(chX, k ? "R" : "L", _T, _Pv, low.rotation.y, part.position.z, 1, null);
    } else {
      part = k ? chX.parts.ll : chX.parts.rl;
      const D = MP.dims(chX);
      // the leg solve's end: g2 down the shin from the knee
      const vx = f[oW + 3] - f[oW], vy = f[oW + 4] - f[oW + 1], vz = f[oW + 5] - f[oW + 2], vl = Math.hypot(vx, vy, vz) || 1, q = D.g2 * PX.s / vl;
      _T.set(f[oW] + vx * q + ex, f[oW + 1] + vy * q + ey, f[oW + 2] + vz * q + ez); chX.model.worldToLocal(_T);
      _Pv.set(f[oW] + mx, f[oW + 1] + my, f[oW + 2] + mz); chX.model.worldToLocal(_Pv); _Pv.sub(part.position);
      MP.solveLeg(chX, k ? "R" : "L", _T, _Pv, 1);
    }
    // the limb as it now is
    part.updateMatrixWorld(true);
    PX.frame = -1; partsOf(chX, 2);
    return true;
  }
  // a fighter's own fists out of his own trunk and head
  function ownHands(X, chX, PX) {
    if (!((chX._mK || 0) > 0.05) || chX.cuffed) return;
    const MP = CBZ.meleePoses;
    if (!MP || !MP.solveArm || !scratch()) return;
    const f = PX.f, sc = PX.s / 0.7;
    for (let k = 0; k < 2; k++) {
      const o = (4 + 2 * k) * ST;
      if (!sphVsParts(PX, f[o + 3], f[o + 4], f[o + 5], 0.045 * sc, M_SELF, _h) || _h.depth <= 0.004) continue;
      const part = k ? chX.parts.ra : chX.parts.la, low = k ? chX.low.ra : chX.low.la, sock = k ? chX.sockets.rightHand : chX.sockets.leftHand;
      const e = sock.matrixWorld.elements, dp = _h.depth + 0.002;
      _T.set(e[12] + _h.nx * dp, e[13] + _h.ny * dp, e[14] + _h.nz * dp); chX.body.worldToLocal(_T);
      _Pv.set(f[o], f[o + 1], f[o + 2]); chX.body.worldToLocal(_Pv); _Pv.sub(part.position);
      MP.solveArm(chX, k ? "R" : "L", _T, _Pv, low.rotation.y, part.position.z, 1, null);
      part.updateMatrixWorld(true);
      PX.frame = -1; partsOf(chX, 2);
      pushed(chX, k);
    }
  }
  /* UNDER A RIDER, THE LIMP ARM GIVES, ONCE. A knocked-out man's arm lying
     where the rider's thigh or shin comes down was re-solved off the leg
     and the leg off the arm, both, every frame (the fall keys the arm
     back, the mount keys the leg back). The arm has no muscle in it: it is
     the one that moves, and it stays moved (entities/meleeposes.js
     limpNudge shifts where it rests); the rider's leg is then not touched.
     A conscious man's arms are his own and are left to the limb pass. */
  function limpYield(B, chB, PB, PA) {
    const MP = CBZ.meleePoses, fl = chB.fall;
    if (!MP || !MP.limpNudge || !fl || !fl.on || !fl.ko) return;
    const f = PB.f;
    const cx = (f[0] + f[3] + f[7] + f[10]) * 0.25, cy = (f[1] + f[4] + f[8] + f[11]) * 0.25, cz = (f[2] + f[5] + f[9] + f[12]) * 0.25;
    for (let k = 0; k < 2; k++) {
      if (!deepest(PB, M_LIMB[k], PA, M_ALL, _d, 0.003)) continue;
      const o = (4 + 2 * k) * ST;
      // out from his body, or in toward it: whichever way the contact pushes his elbow
      const out = _d.nx * (f[o] - cx) + _d.ny * (f[o + 1] - cy) + _d.nz * (f[o + 2] - cz) >= 0 ? 1 : -1;
      MP.limpNudge(chB, k, out * 0.08);
      fixLimb(B, chB, PB, k, PA, 0, true);
    }
  }
  /* WHERE A HELD MAN FITS (CBZ.bodyParts.holdClear, asked by systems/verbs.js
     placeTarget each time it places him). A hold's table says where the
     held man goes (a grab: so far in front; a carry: belly on the shoulder,
     so far behind it), tuned on one pair of bodies; on another pair, or
     with the holder's thigh forward, that spot is inside the holder. This
     answers, from the two men's drawn parts, how far along which line the
     held man has to be moved from the table's spot for his trunk and head
     (and, standing, his thighs) to be clear of the holder's trunk, head and
     thighs by a finger's width: nothing if he already is; else the
     shortest distance along the line of the deepest contact (kept on the
     floor's plane for a man who is standing; any way, up included, for a
     man who is carried), found by halving. No memory: the same two poses
     give the same answer.
       b: the move from where his parts were last drawn to the table's spot
       (the holder's own move since then taken off). out: the extra move. */
  function shift3(P, dx, dy, dz) {
    const f = P.f;
    for (let o = 0; o < NP * ST; o += ST) { f[o] += dx; f[o + 1] += dy; f[o + 2] += dz; f[o + 3] += dx; f[o + 4] += dy; f[o + 5] += dz; }
    P.x0 += dx; P.x1 += dx; P.y0 += dy; P.y1 += dy; P.z0 += dz; P.z1 += dz;
  }
  const HC_A = 1 | 2 | 4 | (1 << 7) | (1 << 9), HC_GAP = 0.008;
  let _hcCur = 0;
  function hcAt(PT, mT, PA, ax, ay, az, d) {
    shift3(PT, ax * (d - _hcCur), ay * (d - _hcCur), az * (d - _hcCur));
    _hcCur = d;
    return deepest(PT, mT, PA, HC_A, _d2, -HC_GAP);
  }
  function holdClear(chA, chT, bx, by, bz, carried, awayX, awayZ, out) {
    out.x = out.y = out.z = 0;
    if (!chA || !chT || !chA.group || !chT.group) return false;
    const PA = partsOf(chA, 0), PT = partsOf(chT, 0);
    if (!PA.ok || !PT.ok) return false;
    const mT = carried ? 1 | 2 | 4 : HC_A;
    let moved = false;
    shift3(PT, bx, by, bz);
    if (deepest(PT, mT, PA, HC_A, _d2, -HC_GAP)) {
      let ax = _d2.nx, ay = carried ? _d2.ny : 0, az = _d2.nz, al = Math.hypot(ax, ay, az);
      if (!carried && al < 0.35) { ax = awayX; az = awayZ; al = Math.hypot(ax, az); }
      if (al > 1e-4) {
        ax /= al; ay /= al; az /= al;
        _hcCur = 0;
        let lo = 0, hi = 0.4;
        if (hcAt(PT, mT, PA, ax, ay, az, hi)) lo = hi;
        else for (let it = 0; it < 6; it++) { const mid = (lo + hi) * 0.5; if (hcAt(PT, mT, PA, ax, ay, az, mid)) lo = mid; else hi = mid; }
        const d = lo >= 0.4 ? 0.4 : hi;
        shift3(PT, -ax * _hcCur, -ay * _hcCur, -az * _hcCur);
        out.x = ax * d; out.y = ay * d; out.z = az * d;
        moved = true;
      }
    }
    shift3(PT, -bx, -by, -bz);
    return moved;
  }
  function shiftParts(P, dx, dz) {
    const f = P.f;
    for (let o = 0; o < NP * ST; o += ST) { f[o] += dx; f[o + 2] += dz; f[o + 3] += dx; f[o + 5] += dz; }
    P.x0 += dx; P.x1 += dx; P.z0 += dz; P.z1 += dz;
  }
  function moveRoot(a, ch, P, dx, dz) {
    const p = posOf(a);
    if (!p) return;
    p.x += dx; p.z += dz;
    if (bpClamp) { const x0 = p.x, z0 = p.z; bpClamp(a); dx += p.x - x0; dz += p.z - z0; }
    // (the player's rig is placed from his position next frame: it goes now, so what is drawn is what was solved)
    if (ch.group.position !== p) { ch.group.position.x += dx; ch.group.position.z += dz; }
    shiftParts(P, dx, dz);
  }
  // all: every part of both (what the limbs could not clear is the roots' to
  // clear); else only what a limb never can (trunk, head, the thighs at the hip)
  /* (THE STRIKING LIMB IS NOT LEFT OUT of the `all` stage. It was, on the
     thought that a blow's own contact must never move the roots; but the
     jammed cases ARE a striking limb: a jab's upper arm against a
     staggering man's flung forearm, a hook's forearm in his trunk as he
     reels into it, two men both throwing with an upper arm across a
     forearm. Left out, nothing was allowed to clear them: 2-11 cm stayed.
     A blow that lands is already on his surface (the strike holds it
     there), so it leaves nothing for this stage to act on.) */
  function rootStage(A, B, PA, PB, chA, chB, all, dA, dB) {
    let mA = all ? M_ALL : M_TRUNK, mB = all ? M_ALL : M_TRUNK;
    if (!all && chA.kickT > 0) mA &= ~(chA.kickLeg === "l" ? 1 << 7 : 1 << 9);
    if (!all && chB.kickT > 0) mB &= ~(chB.kickLeg === "l" ? 1 << 7 : 1 << 9);
    for (let it = 0; it < 3; it++) {
      if (!deepest(PA, mA, PB, mB, _d2, 0.006)) return;
      let nx = _d2.nx, nz = _d2.nz, nh = Math.hypot(nx, nz);
      const ap = posOf(A), bp = posOf(B);
      if (!ap || !bp) return;
      if (nh < 0.3) {
        // (a contact that is one part ON the other: apart along the line between the two men;
        // for the trunk stage, as it was, away from the point of the other man that is touched)
        if (all) { nx = ap.x - bp.x; nz = ap.z - bp.z; }
        else { nx = ap.x - _d2.qx; nz = ap.z - _d2.qz; }
        nh = Math.hypot(nx, nz);
        if (nh < 1e-4) { nx = ap.x - bp.x; nz = ap.z - bp.z; nh = Math.hypot(nx, nz) || 1; }
        nx /= nh; nz /= nh; nh = 0.5;
      } else { nx /= nh; nz /= nh; }
      /* HOW FAR: when the two parts are side by side, the overlap itself.
         When one is ON the other (a thigh over a trunk, a forearm across a
         shoulder: the contact points mostly up), moving the roots apart by
         the overlap does not clear it: the upper part has to come off the
         lower one sideways, by the distance at which a part at that height
         clears it. (The trunk stage used to move by overlap / 0.5 and stop:
         a thigh 6 cm into the top of a man's trunk stayed in it.) */
      const dc = _d2.rr - _d2.depth, dyc = dc * _d2.ny, hc = dc * Math.hypot(_d2.nx, _d2.nz);
      const side = Math.sqrt(Math.max(0, _d2.rr * _d2.rr - dyc * dyc)) - hc;
      // (the whole of it, the frame it is found: 15 cm a frame left an 11-17 cm jam between two NPCs there for the eye)
      const push = Math.min(0.3, Math.max(_d2.depth, side) + 0.003);
      const pa = isPlayer(A), pb = isPlayer(B);
      let wA, wB;
      if (dA && dB) return;
      if (dA) { wA = 0; wB = 1; } else if (dB) { wA = 1; wB = 0; }
      else {
        const ma = massOf(A), mb = massOf(B);
        wA = mb / (ma + mb); wB = 1 - wA;
        if (pa) wA = Math.max(wA, 0.5); else if (pb) wB = Math.max(wB, 0.5);
        const sm = wA + wB; wA /= sm; wB /= sm;
      }
      if (A._remote) wA = 0;
      if (B._remote) wB = 0;
      if (wA <= 0 && wB <= 0) return;
      if (wA > 0) moveRoot(A, chA, PA, nx * push * wA, nz * push * wA);
      if (wB > 0) moveRoot(B, chB, PB, -nx * push * wB, -nz * push * wB);
      AU.rootPushes++;
    }
  }
  let rigSeq = 0;
  function partPass() {
    if (!pairN) return;
    AU.frames++;
    const t0 = tests;
    for (let p = 0; p < pairN; p++) {
      let A = pairA[p], B = pairB[p];
      pairA[p] = pairB[p] = null;
      /* WHO IS ON THE FLOOR IS ASKED HERE. It was read off `_bcDown`, which
         the contact pass writes only on the bodies in the list it is handed,
         and the prison hands it the STANDING cast: a knocked-out man never
         got the flag. To this pass he was a man on his feet (the audit
         called him "falling"): the limp-arm rule under a rider never ran,
         "the man on his feet answers first" never applied, and the roots
         of a standing man and a lying one were split by mass. */
      let dA = lying(A), dB = lying(B);
      // (the man on his feet answers first: his legs move off a lying man's limbs, not the limbs off his legs)
      if (dA && !dB) { const t = A; A = B; B = t; dA = false; dB = true; }
      const chA = rigOf(A), chB = rigOf(B);
      if (!chA || !chB || chA === chB || chA.group.visible === false || chB.group.visible === false) continue;
      const PA = partsOf(chA, 1), PB = partsOf(chB, 1);
      if (!PA.ok || !PB.ok) continue;
      if (PA.x0 > PB.x1 + 0.03 || PB.x0 > PA.x1 + 0.03 || PA.z0 > PB.z1 + 0.03 || PB.z0 > PA.z1 + 0.03 || PA.y0 > PB.y1 + 0.03 || PB.y0 > PA.y1 + 0.03) continue;
      AU.pairs++;
      const sa = sessionOf(A), grip = !!sa && sa === sessionOf(B);
      // what is tested and reported: everything, but the arms of two people in one hold
      const mm = grip ? M_ALL & ~M_ARMS : M_ALL;
      if (grip) AU.heldPairs++;
      const any = deepest(PA, mm, PB, mm, _d, 0);
      if (any && _d.depth > AU.deepestBefore) AU.deepestBefore = _d.depth;
      if (any && _d.depth > 0.003) {
        const before = _d.depth, lf0 = AU.limbFrames, rp0 = AU.rootPushes;
        /* (A RIDER is one who is over the man: stepping across him or down on
           his knees. While he is still WALKING to his place beside the man
           he is a man on his feet next to a man on the floor like any
           other: his feet are placed clear of the limbs and his root is
           kept off them, and nothing of the lying man is moved for him.) */
        const over = mounted(A, B) && (chA.mount || !!(chA._mStep && chA._mStep.on));
        const ride = dB && !dA && over;
        /* ONE MAN GIVES WAY, THEN THE OTHER, THEN THE ROOTS. It used to take
           turns limb by limb (his arm, the other's arm, his leg, the
           other's leg, three times round): with both men moving, each
           re-solve of one man's limb was made against a pose of the other
           that the very next call changed, an elbow swung out of a forearm
           went into the trunk behind it, and which man was "first" was
           whichever the grid happened to list first that frame. Two men
           both throwing, or one throwing while the other flinched or
           stepped, never settled: 100-500 re-solves a move and 5-17 cm
           left at the end of them.
             WHO YIELDS is fixed for the pair and does not change from
           frame to frame: a man on his feet before a man on the floor
           (his feet are placed once and kept); of two on their feet, the
           one who is striking when only one is (the blow stops on the
           other man, the other man is not moved by it); otherwise the one
           whose rig was built first (an order that never flips).
             HE IS SOLVED TO THE END FIRST: all four limbs against the other
           man as he stands, up to four passes, until nothing of his is in
           him. Only then is what is still left solved on the other man.
             WHAT IS STILL LEFT AFTER BOTH is something no limb can clear
           (an upper arm in an upper arm with the shoulders too close, a
           thigh in a trunk): the two ROOTS go apart by it, the whole of
           it, the same frame. That is the case that never converged: two
           men both mid-blow, their root capsules both shrunk to let the
           blows in, chest to chest with their arms jammed. */
        let X = A, chX = chA, PX = PA, Y = B, chY = chB, PY = PB;
        if (ride) {
          /* A RIDER AND THE MAN UNDER HIM. The seat places the rider: his
             hips over the trunk, his thighs down its sides, his knees out
             past its width (entities/meleeposes.js mountPose, solved from
             the man's own trunk). Those legs are not this pass's to move:
             solved first, "to the end", against a trunk they are placed
             ON, four re-solves each bent them off the seat and into him
             (that was the regression: 3-7 cm of thigh in trunk, 180-545
             re-solves). Under a rider the man on the floor gives: a limp
             arm is moved aside and stays (limpYield), then whatever of his
             is still in the rider is solved; of the rider only the arms
             (and, until he is down on his knees, the feet he is still
             standing on). */
          limpYield(B, chB, PB, PA);
          for (let it = 0; it < 4; it++) {
            let did = false;
            for (let li = 0; li < 4; li++) if (fixLimb(B, chB, PB, li, PA, it, true)) did = true;
            if (!did) break;
          }
          for (let it = 0; it < 4; it++) {
            let did = false;
            for (let li = 0; li < (chA.mount ? 2 : 4); li++) if (fixLimb(A, chA, PA, li, PB, it)) did = true;
            if (!did) break;
          }
        } else {
        if (!dA && !dB) {
          const sA = chA.punchT > 0 || chA.kickT > 0, sB = chB.punchT > 0 || chB.kickT > 0;
          const idA = chA._bpId || (chA._bpId = ++rigSeq), idB = chB._bpId || (chB._bpId = ++rigSeq);
          if (sA !== sB ? sB : idB < idA) { X = B; chX = chB; PX = PB; Y = A; chY = chA; PY = PA; }
        }
        for (let side = 0; side < 2; side++) {
          for (let it = 0; it < 4; it++) {
            let did = false;
            for (let li = grip ? 2 : 0; li < 4; li++) if (fixLimb(X, chX, PX, li, PY, it, X === B ? dB : dA)) did = true;
            if (!did) break;
          }
          const t = X; X = Y; Y = t;
          const tc = chX; chX = chY; chY = tc;
          const tp = PX; PX = PY; PY = tp;
        }
        }
        if (!grip && !over && !A._bcSkip && !B._bcSkip) {
          rootStage(A, B, PA, PB, chA, chB, false, dA, dB);
          if (deepest(PA, mm, PB, mm, _d, 0) && _d.depth > 0.008) rootStage(A, B, PA, PB, chA, chB, true, dA, dB);
        }
        let left = 0;
        if (deepest(PA, mm, PB, mm, _d, 0)) { left = _d.depth; seen(left, A, B, PART[_d.i], PART[_d.j]); }
        if (left > WORST.depth) {
          const sA = chA.punchT > 0 || chA.kickT > 0, sB = chB.punchT > 0 || chB.kickT > 0;
          const atkB = sB && !sA, ap = posOf(A), bp = posOf(B);
          WORST.depth = left; WORST.before = before; WORST.frame = AU.frames;
          WORST.parts[0] = PART[_d.i]; WORST.parts[1] = PART[_d.j];
          WORST.actors[0] = nameOf(A); WORST.actors[1] = nameOf(B);
          WORST.attackerState = (atkB ? nameOf(B) : nameOf(A)) + ": " + (atkB ? stateOf(B, chB) : stateOf(A, chA));
          WORST.targetState = (atkB ? nameOf(A) : nameOf(B)) + ": " + (atkB ? stateOf(A, chA) : stateOf(B, chB));
          WORST.bothStriking = sA && sB;
          WORST.rootDist = ap && bp ? Math.hypot(ap.x - bp.x, ap.z - bp.z) : 0;
          // (the two RIGS, which is what the parts are read from, and the middle of each of the two parts, world x y z:
          // a record whose rootDist says the men are apart and whose rigDist says they are not has found a body
          // whose position and whose rig disagree)
          const ga = chA.group.position, gb = chB.group.position, fa = PA.f, fb = PB.f, oa = _d.i * ST, ob = _d.j * ST;
          WORST.rigDist = Math.hypot(ga.x - gb.x, ga.z - gb.z);
          WORST.at[0] = (fa[oa] + fa[oa + 3]) * 0.5; WORST.at[1] = (fa[oa + 1] + fa[oa + 4]) * 0.5; WORST.at[2] = (fa[oa + 2] + fa[oa + 5]) * 0.5;
          WORST.at[3] = (fb[ob] + fb[ob + 3]) * 0.5; WORST.at[4] = (fb[ob + 1] + fb[ob + 4]) * 0.5; WORST.at[5] = (fb[ob + 2] + fb[ob + 5]) * 0.5;
          WORST.capsuleR[0] = radiusOf(A); WORST.capsuleR[1] = radiusOf(B);
          WORST.capsuleShrunk = Math.min(A._bcTight != null ? clock - A._bcTight : 9, B._bcTight != null ? clock - B._bcTight : 9) < TIGHT_EASE;
          WORST.firstToYield = nameOf(X);          // (swapped twice above: X is again the one solved first)
          WORST.solvesThatFrame = AU.limbFrames - lf0; WORST.rootPushesThatFrame = AU.rootPushes - rp0;
        }
      }
      if (!grip) { ownHands(A, chA, PA); ownHands(B, chB, PB); }
    }
    pairN = 0;
    AU.tests += tests - t0;
    AU.pairsDropped += pairsDropped; pairsDropped = 0;
  }
  if (CBZ.onUpdate) CBZ.onUpdate(92, partPass);
  CBZ.bodyParts = {
    NAMES: PART, partsOf, strikeHit, footSpot, topAt, holdClear,
    near(ch) { return !!(ch && ch._bpNf >= bpFrame - 1 && ch._bpNn); },
    count(what) { if (what === "feet") AU.feetReplaced++; else if (what === "strike") AU.strikesStopped++; },
    // what became of a blow (systems/verbs_strike.js): kept for the audit
    note(kind, what) { if (strikeLog.length < 24) strikeLog.push(kind + ": " + what); },
    // a point out of everybody near this rig (the hand of a man reeling, about to be flung into the man who hit him)
    clearPoint(ch, v, r) {
      if (!ch || !(ch._bpNf >= bpFrame - 1) || !ch._bpNn) return false;
      let moved = false;
      for (let n = 0; n < ch._bpNn; n++) {
        const o = ch._bpN[n];
        if (!o || !o.group || o.group.visible === false) continue;
        const P = partsOf(o, 0);
        if (!P.ok || !sphVsParts(P, v.x, v.y, v.z, r, M_ALL, _h)) continue;
        const d = _h.depth + 0.004;
        v.x += _h.nx * d; v.y += _h.ny * d; v.z += _h.nz * d;
        moved = true;
      }
      return moved;
    },
    // a point (a hand a pose is about to place) out of a body's parts, to its surface: true if it moved
    pushOut(tch, v, r) {
      const P = partsOf(tch, 0);
      if (!P.ok || !sphVsParts(P, v.x, v.y, v.z, r, M_ALL, _h)) return false;
      const d = _h.depth + 0.004;
      v.x += _h.nx * d; v.y += _h.ny * d; v.z += _h.nz * d;
      return true;
    },
  };

  /* ============================================================
     THE PASS
     ============================================================ */
  const _live = [];
  function resolve(list, dt, opts) {
    opts = opts || {};
    const m = opts.mode || CBZ.game.mode;
    clock += Math.max(0, dt || 0);
    passDt = Math.max(0, dt || 0);
    bpClamp = opts.clamp || null;
    hookNet();
    let grid = grids[m];
    if (!grid) grid = grids[m] = CBZ.makeGrid(opts.cell || CELL);
    // standing bodies only: a man on the floor is stepped over (below), a man
    // in somebody's hands belongs to the verb that holds him
    _live.length = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i], p = posOf(a);
      if (!p) continue;
      a._bcSkip = false;
      if (!a._remote && lying(a)) { a._bcDown = true; a._bcGoing = false; continue; }
      a._bcDown = false;
      a._bcGoing = !a._remote && going(a);
      const S = a._remote ? null : sessionOf(a);
      a._bcSess = S;
      if (heldTarget(a, S)) {
        a._bcSkip = true; a._bcFresh = false; a._bcDown = false;
        // (he is the verb's to place, but his parts and his holder's are still
        // tested, all but the arms that have hold of each other: partPass)
        if (S.a && S.a !== a) notePair(a, S.a, 0);
        continue;
      }
      measure(a, p);
      a._bcX0 = p.x; a._bcZ0 = p.z;     // where this pass found him (the city clamp skips the unmoved)
      a._contactIndex = _live.length;
      _live.push(a);
    }
    grid.rebuild(_live, posOf);
    for (let i = 0; i < _live.length; i++) {
      const A = _live[i], ap = posOf(A);
      const gx = grid.cellIndex(ap.x), gz = grid.cellIndex(ap.z);
      for (let cx = gx - 1; cx <= gx + 1; cx++) for (let cz = gz - 1; cz <= gz + 1; cz++) {
        const bucket = grid.bucket(cx, cz); if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const B = bucket[k];
          if (B._contactIndex <= i) continue;
          if (A._remote && B._remote) continue;
          const bq = posOf(B);
          if (Math.abs((bq.y || 0) - (ap.y || 0)) > Y_BAND) continue;
          // near enough to touch: their PARTS are tested after the poses (partPass)
          const ndx = bq.x - ap.x, ndz = bq.z - ap.z, nd2 = ndx * ndx + ndz * ndz;
          if (nd2 < NEAR * NEAR) notePair(A, B, nd2);
          if (A._bcSess && A._bcSess === B._bcSess) continue;
          separatePair(A, B, m, false);
        }
      }
    }
    /* RELAXATION: one pass cannot carry a push through a crowd (the man in
       the middle is corrected against his first neighbour and then shoved
       back into him by the second). Two more positional-only sweeps over the
       same pairs let a press settle instead of compressing and buzzing. */
    for (let it = 0; it < RELAX; it++) {
      for (let i = 0; i < _live.length; i++) {
        const A = _live[i], ap = posOf(A);
        const gx = grid.cellIndex(ap.x), gz = grid.cellIndex(ap.z);
        for (let cx = gx - 1; cx <= gx + 1; cx++) for (let cz = gz - 1; cz <= gz + 1; cz++) {
          const bucket = grid.bucket(cx, cz); if (!bucket) continue;
          for (let k = 0; k < bucket.length; k++) {
            const B = bucket[k];
            if (B._contactIndex <= i || (A._remote && B._remote)) continue;
            if (A._bcSess && A._bcSess === B._bcSess) continue;
            if (Math.abs((posOf(B).y || 0) - (ap.y || 0)) > Y_BAND) continue;
            separatePair(A, B, m, true);
          }
        }
      }
    }
    if (opts.clamp) for (let i = 0; i < _live.length; i++) if (!_live[i]._remote) opts.clamp(_live[i]);
    /* YOUR BACK IS TO THE WALL: after the clamp put you back out of the wall,
       close any residual on HIM (and on you only if he is pinned too); both
       pinned, he slides sideways along the wall instead of into your lens. */
    for (let i = 0; i < _live.length; i++) {
      const P = _live[i]; if (!isPlayer(P)) continue;
      const pp = posOf(P);
      const gx = grid.cellIndex(pp.x), gz = grid.cellIndex(pp.z);
      for (let cx = gx - 1; cx <= gx + 1; cx++) for (let cz = gz - 1; cz <= gz + 1; cz++) {
        const bucket = grid.bucket(cx, cz); if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const H = bucket[k]; if (H === P || isPlayer(H)) continue;
          if (P._bcSess && P._bcSess === H._bcSess) continue;
          const hp = posOf(H);
          if (Math.abs((hp.y || 0) - (pp.y || 0)) > Y_BAND) continue;
          let min = radiusOf(P) + radiusOf(H);
          if (m === "escape" && fightingYou(H)) min += FIGHT_GAP;
          let dx = hp.x - pp.x, dz = hp.z - pp.z, d = Math.hypot(dx, dz);
          if (d >= min) continue;
          if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
          if (H._remote) {                                   // his side is his: I give it all
            pp.x -= (dx / d) * (min - d) * 0.5; pp.z -= (dz / d) * (min - d) * 0.5;
            if (opts.clamp) opts.clamp(P);
            continue;
          }
          hp.x += (dx / d) * (min - d); hp.z += (dz / d) * (min - d);
          if (opts.clamp) opts.clamp(H);
          dx = hp.x - pp.x; dz = hp.z - pp.z; d = Math.hypot(dx, dz) || 1;
          if (d < min) { pp.x -= (dx / d) * (min - d); pp.z -= (dz / d) * (min - d); if (opts.clamp) opts.clamp(P); }
          dx = hp.x - pp.x; dz = hp.z - pp.z; d = Math.hypot(dx, dz) || 1;
          if (d < min - 0.02) {
            const need = Math.sqrt(Math.max(0, min * min - d * d)) + 0.01;
            const tx = -dz / d, tz = dx / d, hx0 = hp.x, hz0 = hp.z;
            hp.x = hx0 + tx * need; hp.z = hz0 + tz * need;
            if (opts.clamp) opts.clamp(H);
            if (Math.hypot(hp.x - pp.x, hp.z - pp.z) < min - 0.02) {
              hp.x = hx0 - tx * need; hp.z = hz0 - tz * need;
              if (opts.clamp) opts.clamp(H);
            }
          }
        }
      }
      break;
    }
    if (opts.downed !== false) stepOver(list, m, dt, opts.clamp || null);
    selectPairs();
    for (let i = 0; i < list.length; i++) { const a = list[i], p = posOf(a); if (p) stamp(a, p); }
  }

  /* ============================================================
     THE PRISON'S TYPED-ARRAY CROWD vs YOU (entities/crowd.js calls this per
     agent): the same pair model on the struct of arrays.
     ============================================================ */
  const crowdA = { _p: true, isPlayer: true, pos: null, r: 0.55 };
  function resolveAmbientPlayer(S, id, dt) {
    const P = CBZ.player;
    if (!S || S.dead[id] || S.downT[id] > 0 || P.dead || P._traversal) return;
    const dx = S.posX[id] - P.pos.x, dz = S.posZ[id] - P.pos.z;
    const min = (P.radius || 0.55) + PERSON_R, d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2) || 1, nx = d2 > 1e-8 ? dx / d : 1, nz = d2 > 1e-8 ? dz / d : 0;
    const overlap = min - Math.min(d, min);
    if (S.contactCD[id] <= 0) {
      const vBx = S.velX[id] || 0, vBz = S.velZ[id] || 0;
      const vc = (PV.x - vBx) * nx + (PV.z - vBz) * nz;
      if (vc > V_CLOSE_MIN) {
        const hd = S.heading ? S.heading[id] : 0;
        crowdA.pos = P.pos;
        _q.mA = massOf(crowdA); _q.mB = 74;
        _q.vAx = PV.x; _q.vAz = PV.z; _q.vBx = vBx; _q.vBz = vBz; _q.nx = nx; _q.nz = nz;
        facingOf(crowdA, _fa);
        _q.fAx = _fa.x; _q.fAz = _fa.z; _q.fBx = Math.sin(hd || 0); _q.fBz = Math.cos(hd || 0);
        _q.stabA = stability(crowdA, "A", Math.hypot(PV.x, PV.z)); _q.stabB = 1;
        _q.rollA = rng(); _q.rollB = rng();
        solve(_q, _o);
        S.contactCD[id] = PAIR_CD;
        const tB = _o.tierB;
        if (tB >= SHOVE) {
          S.velX[id] += nx * _o.dvB * (tB >= STUMBLE ? 1.4 : 1); S.velZ[id] += nz * _o.dvB * (tB >= STUMBLE ? 1.4 : 1);
          S.posX[id] += nx * (overlap + 0.08 * _o.dvB); S.posZ[id] += nz * (overlap + 0.08 * _o.dvB);
          if (tB === DOWN) { S.downT[id] = 2.2 + Math.random() * 0.8; downs++; }
          S.grudge[id] = Math.min(255, (S.grudge[id] + (tB === DOWN ? 36 : 14) + (S.reactivity[id] / 255) * (tB === DOWN ? 84 : 40)) | 0);
          S.panic[id] = Math.max(S.panic[id], tB === DOWN ? 0.9 : 0.35);
          hardHits++;
        }
        if (_o.tierA > NONE) { _ev.mode = CBZ.game.mode; _ev.nx = -nx; _ev.nz = -nz; _ev.dv = _o.dvA; _ev.e = _o.eA; _ev.spin = _o.spinA; _ev.side = 1; _ev.source = null; applyPlayer(_o.tierA, _ev, _ev.mode); }
        if (_o.tierB > NONE || _o.tierA > NONE) impacts++;
      }
    }
    // positional: you give most of it, he is planted
    const mv = Math.sqrt(dx * dx + dz * dz) < min ? min - Math.sqrt(dx * dx + dz * dz) : 0;
    if (mv > 0) {
      // (the player's give goes through the one mover: never into a wall)
      if (CBZ.bodyMove) CBZ.bodyMove(P, -nx * mv * 0.75, 0, -nz * mv * 0.75, null);
      else { P.pos.x -= nx * mv * 0.75; P.pos.z -= nz * mv * 0.75; }
      S.posX[id] += nx * mv * 0.25; S.posZ[id] += nz * mv * 0.25;
      P.speed = Math.min(P.speed || 0, 1.5);
      blocks++;
    }
  }

  /* ============================================================
     THE CITY PASS (after pedestrians, police and cars), with the remote
     players of a multiplayer session in it
     ============================================================ */
  function clampCity(a) {
    if (a && (a._traversal || (a._p && CBZ.player._traversal))) return;
    const p = posOf(a); if (!p) return;
    /* NOT PUSHED, NOT CLAMPED. Every city body collides itself in its own
       mover (peds.js, the cop and player controllers) before this pass, so a
       body this pass did not move is exactly where its owner already made it
       legal. Only a push can put someone into a wall; re-running the collider
       broadphase + region clamp for the whole standing crowd on every pass
       bought nothing. */
    if (p.x === a._bcX0 && p.z === a._bcZ0) return;
    if (CBZ.collide) CBZ.collide(p, radiusOf(a), p.y, (p.y || 0) + 1.7);
    if (p === CBZ.player.pos && CBZ.cityWaterAt && CBZ.cityWaterAt(p.x, p.z)) return;
    if (CBZ.city && CBZ.city.arena) CBZ.city.arena.clampToCity(p, radiusOf(a));
  }
  const remoteEntries = new Map();
  const _rl = [];
  function remoteEntry(R) {
    let e = remoteEntries.get(R.id);
    if (!e) { e = { _remote: R, pos: null, r: 0.45 }; remoteEntries.set(R.id, e); }
    e._remote = R; e.pos = R.pos; e._bcMass = 0;
    return e;
  }
  let cityAcc = 0;
  CBZ.onUpdate(38, function (dt) {
    if (CBZ.game.mode !== "city" || !CBZ.city || CBZ.player.driving) return;
    cityAcc += dt;
    const hz = CBZ.qScale ? CBZ.qScale(12, 30) : 30;
    if (cityAcc < 1 / hz) return;
    const step = Math.min(cityAcc, 0.12);
    cityAcc = 0;
    cityList.length = 0;
    for (let i = 0; i < CBZ.cityPeds.length; i++) {
      const p = CBZ.cityPeds[i];
      // ONLY WHAT YOU CAN SEE IS IN YOUR WAY. A body minted spawn-hidden
      // (peds.js `_spawnHidden`, not yet drawn) or a pooled rig parked off
      // the map is not a person on the street yet: solid while undrawn, it
      // was an invisible wall (a mob's freshly promoted front rows).
      if (p._spawnHidden || p._parked) continue;
      if (!p.dead && !p.culled && !p.inCar && !p._traversal &&
          !(CBZ.body && CBZ.body.busy(p))) cityList.push(p);
    }
    for (let i = 0; i < CBZ.cityCops.length; i++) {
      const c = CBZ.cityCops[i];
      if (!c.dead && !c._traversal && !(CBZ.body && CBZ.body.busy(c))) cityList.push(c);
    }
    if (!CBZ.player.dead && !CBZ.player._traversal) {
      cityPlayer.pos = CBZ.player.pos; cityPlayer.r = CBZ.player.radius || 0.55; cityList.push(cityPlayer);
    }
    if (CBZ.net && CBZ.net.active && CBZ.netRemoteList) {
      _rl.length = 0;
      CBZ.netRemoteList(_rl);
      for (let i = 0; i < _rl.length; i++) {
        const R = _rl[i];
        if (R && R.pos && R.group && !R.dead && !R.driving) cityList.push(remoteEntry(R));
      }
    }
    resolve(cityList, step, { mode: "city", clamp: clampCity });
  });

  /* the other half of a multiplayer impact: HE ran into ME */
  let netHooked = false;
  function hookNet() {
    if (netHooked || !CBZ.net || !CBZ.net.onEv) return;
    netHooked = true;
    CBZ.net.onEv("bump", function (msg) {
      if (!msg || CBZ.game.mode !== "city" || CBZ.player.dead) return;
      const t = msg.tier | 0, at = msg.at | 0;
      _ev.mode = "city"; _ev.nx = +msg.nx || 0; _ev.nz = +msg.nz || 0; _ev.dv = +msg.dv || 0; _ev.e = +msg.ev || 0; _ev.spin = 0; _ev.side = 1; _ev.source = null;
      if (t > NONE) applyPlayer(Math.min(DOWN, t), _ev, "city");
      const R = CBZ.netRemoteActor ? CBZ.netRemoteActor(msg.id) : null;
      if (R && at > BRUSH) { _ev.nx = -_ev.nx; _ev.nz = -_ev.nz; applyRemote(R, Math.min(DOWN, at), _ev); }
      const e = R ? remoteEntries.get(R.id) : null;
      if (e) { cityPlayer._bcWith = e; cityPlayer._bcAt = clock; e._bcWith = cityPlayer; e._bcAt = clock; }
    });
  }

  const BI = CBZ.bodyImpact = {
    TIERS, T_BRUSH, T_SHOVE, T_STUMBLE, T_DOWN, NONE, BRUSH, SHOVE, STUMBLE, DOWN,
    solve, tierOf, pDown, angleFactor, massOf, stability, verbPower, car, apply,
    playerVel: PV,
    intoWall,
    rng: null,
  };
  CBZ.humanContact = {
    resolve,
    react,
    knockdown,
    inventoryOf,
    reactionLevel,
    resolveAmbientPlayer,
    stepKicks,
    stats() { return { hardHits, blocks, impacts, downs, crossings, stepOvers }; },
  };
})();
