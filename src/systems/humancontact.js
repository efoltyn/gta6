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
  let speechT = -99;

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
    if (role === "A") s *= 0.85;
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
      k.p.x += k.vx * dt; k.p.z += k.vz * dt;
      if (CBZ.collide) { try { CBZ.collide(k.p, k.r, (k.p.y || 0) + 0.25, (k.p.y || 0) + 1.7); } catch (e) { /* no world */ } }
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
      if (V && V.react && ch) {
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
    if (V && V.knockdown && ch) {
      try { done = !!V.knockdown(a, { dir: _dir, power: clamp(o.e / 4.5, 0.5, 1), dur: 1.0 + clamp(o.e - T_DOWN, 0, 2) * 0.5, ko: false, noKo: !koMode(m) }); } catch (e) { done = false; }
    }
    if (!done) {
      if (CBZ.body && CBZ.body.knockdown && a.group) CBZ.body.knockdown(a, { dir: _dir, force: 3 + dv * 1.5, t: 1.2 });
      else if (m === "escape" && CBZ.knockback && a.group) { a.ko = Math.max(a.ko || 0, 2.2); CBZ.knockback(a, (posOf(a).x - nx), (posOf(a).z - nz), 0.6 + dv * 0.2); }
      else kick(a, nx * dv, nz * dv);
    }
    if (a.group && o.spin) a.group.rotation.y += o.spin;
  }
  function applyPlayer(tier, o, m) {
    const P = CBZ.player;
    if (!P || P.dead) return;
    const nx = o.nx || 0, nz = o.nz || 0, dv = o.dv || 0;
    const pa = realPlayerActor(m);
    if (tier === BRUSH) {
      kick({ pos: P.pos, r: P.radius || 0.55 }, nx * dv * 0.5, nz * dv * 0.5);
      return;
    }
    if (tier === SHOVE || tier === STUMBLE) {
      const stumble = tier === STUMBLE;
      kick({ pos: P.pos, r: P.radius || 0.55 }, nx * dv * (stumble ? 1.05 : 0.8), nz * dv * (stumble ? 1.05 : 0.8));
      if (CBZ.verbs && CBZ.verbs.react) { try { _dir.x = nx; _dir.z = nz; CBZ.verbs.react(pa, { reaction: "stagger", zone: "body", dir: _dir, power: stumble ? 0.75 : 0.45 }); } catch (e) { /* no rig */ } }
      if (CBZ.shake) CBZ.shake(stumble ? 0.12 : 0.05);
      if (stumble) dropHeld(pa, 0.4);
      return;
    }
    downs++;
    dropHeld(pa, 1);
    if (CBZ.body && CBZ.body.knockdown) {
      _dir.x = nx; _dir.z = nz;
      CBZ.body.knockdown(pa, { dir: _dir, force: 3 + dv * 1.4, t: 1.1 + clamp((o.e || 0) - T_DOWN, 0, 2) * 0.3 });
    } else kick({ pos: P.pos, r: P.radius || 0.55 }, nx * dv, nz * dv);
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
      if (severity >= 0.7 && source && isPlayer(source)) {
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

  function reactEscape(a, source, level, severity) {
    const byPlayer = source && isPlayer(source);
    if (a.kind === "guard") {
      if (byPlayer) { a.alert = Math.max(a.alert || 0, 1.1); a.hunt = Math.max(a.hunt || 0, 2 + severity * 2); }
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

  // short, real, rare; over the head only (speech.js). The city speaks
  // through read.js instead.
  const LINES = {
    shoved: ["Hey!", "Watch it.", "Easy.", "What the hell?", "Hey, back off."],
    "run-over": ["Ow!", "What's your problem?"],
    sorry: ["Sorry.", "My bad.", "Whoa, sorry."],
  };
  function sayRare(a, kind, chance) {
    const S = CBZ.speech;
    if (!S || !S.say || clock - speechT < 5 || rng() >= chance) return;
    const L = LINES[kind]; if (!L) return;
    try { if (S.say(a, L[(rng() * L.length) | 0])) speechT = clock; } catch (e) { /* no speaker */ }
  }

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
    if (event.source && isPlayer(event.source)) {
      if (CBZ.cityContactReact) {
        try { CBZ.cityContactReact(a, event.kind || "bump", severity); } catch (e) { /* read.js off */ }
      } else if (event.kind === "shoved" || event.kind === "repeated-shove") {
        sayRare(a, "shoved", 0.35 + 0.3 * level);
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
  function lying(a) {
    if (!a) return false;
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
  function markPair(A, B) { A._bcWith = B; A._bcAt = clock; B._bcWith = A; B._bcAt = clock; }

  function swimming(a) {
    if (isPlayer(a)) return !!(CBZ.player && CBZ.player._swim);
    return !!(a.swim || (a.char && a.char.swimming));
  }
  function impact(A, B, nx, nz, m) {
    if (cooling(A, B)) return;
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
    apply(A, tA, eo);
    eo.nx = nx; eo.nz = nz; eo.dv = dvB; eo.e = eB; eo.spin = spinB; eo.side = 1; eo.source = A;
    apply(B, tB, eo);
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
      victim._bumpCount = (victim._bumpCount || 0) + 1;
      if (victim._bumpCount >= 3 && reactionLevel(victim) > 0.6) {
        victim._bumpCount = 0;
        react(victim, { mode: m, source: src, kind: "repeated-shove", severity: 0.34 });
      }
      return;
    }
    react(victim, { mode: m, source: src, kind: KIND[tier], severity: sev });
    // an NPC who ran a man over and is not a brute says so
    if (!isPlayer(src) && !src._remote && reactionLevel(src) < 0.5 && !src.dead && !CBZ.cityContactReact && (byPlayer || isPlayer(victim))) sayRare(src, "sorry", 0.3);
  }

  /* where the pair touches and how they are pushed apart */
  function separatePair(A, B, m, relax) {
    const ap = posOf(A), bp = posOf(B); if (!ap || !bp) return;
    let dx = bp.x - ap.x, dz = bp.z - ap.z;
    let min = radiusOf(A) + radiusOf(B);
    const pa = isPlayer(A), pb = isPlayer(B);
    if (m === "escape" && (pa ? fightingYou(B) : (pb && fightingYou(A)))) min += FIGHT_GAP;
    const d2 = dx * dx + dz * dz;
    let nx = 0, nz = 0, overlap = 0, found = false;
    // where they stood at the end of the last pass: already touching then =
    // a sustained contact (leaning, a press, a queue), not a new impact
    const stamped = !relax && A._bcFresh && B._bcFresh && A._bcX != null && B._bcX != null;
    const r0x = stamped ? B._bcX - A._bcX : 0, r0z = stamped ? B._bcZ - A._bcZ : 0;
    const r02 = r0x * r0x + r0z * r0z;
    const touching = stamped && r02 < (min + 0.05) * (min + 0.05);
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
    const mA = massOf(A) * (speedOf(A) < 0.3 && !pa ? PLANT : 1);
    const mB = massOf(B) * (speedOf(B) < 0.3 && !pb ? PLANT : 1);
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
    let close = overlap;
    if (!pa && !pb && !remote) {
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
      if (CBZ.verbs && CBZ.verbs.held) { try { if (CBZ.verbs.held(a)) return; } catch (e) { /* no verbs */ } }
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
    const p = posOf(D), ch = D.char || D.ch;
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
          if (D === S || S._gnpOn === D || (isPlayer(S) && CBZ.player && CBZ.player._gnpOn === D)) continue;
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
     THE PASS
     ============================================================ */
  const _live = [];
  function resolve(list, dt, opts) {
    opts = opts || {};
    const m = opts.mode || CBZ.game.mode;
    clock += Math.max(0, dt || 0);
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
      if (!isPlayer(a) && !a._remote && lying(a)) { a._bcDown = true; continue; }
      a._bcDown = false;
      const S = a._remote ? null : sessionOf(a);
      a._bcSess = S;
      if (heldTarget(a, S)) { a._bcSkip = true; a._bcFresh = false; continue; }
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
          if (A._bcSess && A._bcSess === B._bcSess) continue;
          if (Math.abs((posOf(B).y || 0) - (ap.y || 0)) > Y_BAND) continue;
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
      P.pos.x -= nx * mv * 0.75; P.pos.z -= nz * mv * 0.75;
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
