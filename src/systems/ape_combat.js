// ============================================================================
// ape_combat.js — THE APE FIGHTS LIKE AN APE (CBZ)
// ----------------------------------------------------------------------------
// WHY THIS FILE EXISTS. A silverback in this game had exactly one attack, and
// it was a dog's. creature_combat's style table put `gorilla` on the `maul`
// row (creature_combat.js:173), and the ATTACK arm of `maul` is four lines:
// pitch a little, lunge forward, wobble on the roll axis. The body layer's
// dramatic rear-and-slam pose (predator_anim.js:551) is the SEIZE `maul`, which
// only systems/predator.js ever passes — and predator.js is not in the `beasts`
// studio pack, so in `games/battle.html` — the page that actually runs 100 men
// against one gorilla — the ape's entire animated repertoire is its jaw opening
// on the strike envelope (predator_anim.js:678, the `default:` branch).
//
// A gorilla does not bite people to death. Measured, sourced ape combat is:
// a quadrupedal bluff-or-real CHARGE, a two-handed overhead SMASH, a lateral
// BACKHAND that clears a whole arc because the arm is 1.2 m long, a canine BITE
// (the 5 cm canines are the actual killing tool), the chest-beat DISPLAY, and —
// the one everybody knows and nothing in this engine could do — GRABBING A
// BODY AND USING IT. An animal with a 4:1 strength ratio over a man does not
// wrestle him; it picks him up, and once it is holding a 75 kg mass at the end
// of a 1.2 m arm, that mass is a club. That is not a stunt, it is what the
// physics of the situation makes free.
//
// WHAT WAS ALREADY HERE AND IS NOT REBUILT:
//   · the strike clock (windup → STRIKE_AT 0.45 → recover)  creature_combat.js
//   · the discovered leg/jaw rig and the pose appliers        predator_anim.js
//   · the gait, the lumber sway, the +X nose convention       wildlife_rig.js
//   · the damage switchboard and the live roster              modecaps.js
//         CBZ.hurtWorldActor(a, dmg, imp) / CBZ.worldActors(out)
// This file adds the MOVE SET on top of them and owns exactly one thing no
// other file could: a body held in a hand.
//
// THE THREE SEAMS IT IS DRIVEN THROUGH (all in creature_combat.js, all guarded
// so this file being absent restores the old behaviour byte for byte):
//   apeMove(attacker, target, opts, dist, reach) -> a style for the NEXT swing
//   apeStrike(attacker, target, style, opts, dmg) -> damage dealt, or null to
//        mean "not mine, resolve it the ordinary way"
//   apeOwns(attacker) -> true while a hold runs; the strike driver stands down
// plus ONE the host drives, because a hold has to keep ticking after the man in
// the hand is dead and the driver has stopped being called for him:
//   apeStep(dt)  — every live hold and every body still in the air.
//
// ALLOCATION-FREE PER FRAME. No `new THREE.*` anywhere in this file. The rig
// measurement is cached per actor, the roster scratch is one module array, and
// every pose is arithmetic on module temps — the same discipline predator_anim
// and creature_combat already keep.
//
// r128 NOTE: THREE.Euler default order is 'XYZ' (R = Rx·Ry·Rz). With the ape
// authored nose-toward-+X, `group.rotation.z` is the model-local PITCH and
// `group.rotation.y` is the yaw the whole engine steers with — which is why the
// spin below is written to `.y` and the rear-up to `.z`, matching predator_anim
// exactly rather than inventing a second convention.
// ============================================================================
(function () {
  'use strict';
  var CBZ = window.CBZ;
  if (!CBZ) return;

  // ---- the one-line reverts (declared here, the file that owns them) -------
  if (!CBZ.CONFIG) CBZ.CONFIG = {};
  if (CBZ.CONFIG.APE_COMBAT == null) CBZ.CONFIG.APE_COMBAT = true;   // the whole move set
  if (CBZ.CONFIG.APE_FLAIL == null) CBZ.CONFIG.APE_FLAIL = true;     // the body-as-a-club only
  function ON() { return CBZ.CONFIG.APE_COMBAT !== false; }
  function FLAIL_ON() { return ON() && CBZ.CONFIG.APE_FLAIL !== false; }

  // THE ONLY PLACE APES ARE NAMED. creature_combat.js:162 is the precedent:
  // one file holds the species→behaviour table so nothing downstream ever has
  // to test an id again. Everything below this line is derived.
  var APE_RE = /gorilla|silverback|chimp|orangutan|bonobo|gibbon|mandrill|baboon|\bape\b|kong/;
  function speciesId(sp) {
    return String((sp && (sp.id || sp.name)) || '').toLowerCase();
  }
  function isApeSpecies(sp) {
    if (!sp || sp.aquatic || sp.snake || sp.bird) return false;
    return APE_RE.test(speciesId(sp));
  }
  function apeIs(actor) {
    if (!actor) return false;
    if (actor._isApe != null) return actor._isApe;
    var sp = actor.species;
    // arena_fights.js hands a STRING as `.species` (a known quirk of that
    // caller); accept it rather than silently answering "not an ape".
    var ok = (typeof sp === 'string') ? APE_RE.test(sp.toLowerCase()) : isApeSpecies(sp);
    actor._isApe = ok;
    return ok;
  }

  // ---- the move set --------------------------------------------------------
  // dur : seconds for the whole windup→strike→recover arc. creature_combat's
  //       flat 0.4 s is a bite's clock; a two-handed overhead needs more air
  //       under it and a chest-beat is a performance, so each move carries its
  //       own (handed over as `attacker._atkDur`, which the driver honours).
  // arc : half-angle of the damage fan, radians. 0 = a single mark.
  // rng : reach multiplier for the damage fan.
  // pow : damage multiplier on the caller's own per-hit number.
  var MOVES = {
    ape_bite:   { dur: 0.38, arc: 0,    rng: 1.00, pow: 1.30, push: 0.6 },
    ape_smash:  { dur: 0.66, arc: 0.62, rng: 0.95, pow: 1.55, push: 2.4 },
    ape_sweep:  { dur: 0.46, arc: 1.22, rng: 1.40, pow: 0.85, push: 4.2 },
    ape_charge: { dur: 0.58, arc: 0.85, rng: 1.15, pow: 0.95, push: 5.0 },
    ape_grab:   { dur: 0.50, arc: 0,    rng: 1.10, pow: 0.35, push: 0 },
    ape_drum:   { dur: 0.88, arc: 0,    rng: 0,    pow: 0,    push: 0 },
  };
  function moveOf(style) { return MOVES[style] || null; }
  CBZ.apeMoves = MOVES;

  // ---- hold tuning ---------------------------------------------------------
  var LIFT_T = 0.38;        // s — the body comes off the ground
  var SPIN_HZ_LO = 1.20;    // rev/s at the start of the spin
  var SPIN_HZ_HI = 2.10;    // rev/s at full wind (it accelerates — that is the read)
  /* HOW MANY TURNS. Authored at 2.6 and measured: not one hold in eight
     battles ever reached its release, because 2.6 revolutions is ~2.3 s and a
     stationary silverback with sixty men on it does not have 2.3 s. Every grab
     ended with the ape dying mid-swing — the throw and the slam were code that
     had never once run. 1.7 turns is also the better ANIMATION: a hammer throw
     is two winds and a release, and a body going round and round past that
     stops reading as violence and starts reading as a carousel. */
  var SPIN_REVS = 1.7;      // revolutions before the release, scaled by the crowd
  var SLAM_T = 0.46;        // s — overhead to the floor
  var THROW_T = 0.20;       // s — the release beat
  var FLIGHT_MAX = 2.6;     // s — a thrown body is nobody's problem after this
  var CLUB_DMG = 1.15;      // the swung body hits HARDER than a fist: it is 75 kg
  var CLUB_SELF = 0.30;     // ...and it costs the club something every time
  var THROW_SPD_CAP = 17;   // m/s — ω·r uncapped reaches silly numbers
  var GRAV = 21;            // m/s² — matches CBZ.TUNE.gravity's default register
  var GRAB_CD = 4.2;        // s — an ape does not grab twice in a row
  var MAX_HOLDS = 3;        // concurrent flails; a troop of apes must not thrash
  var APE_TEMPO = 0.5;      // multiplier on the caller's between-blow cooldown

  // ---- module scratch (never allocated in a frame) ------------------------
  var HOLDS = [];           // live { ape, victim, phase, ... }
  var FLYING = [];          // live { victim, vx, vy, vz, t, spin, by, team, dmg }
  var _roster = [];         // reused CBZ.worldActors sink
  var _hostDriven = false;  // set by the first explicit apeStep(); kills the fallback tick
  // `picks` counts every time the driver asked for a move. It exists because
  // "the repertoire never fired" and "the driver only ever asked once" look
  // identical in the other counters and have completely different causes.
  var STATS = { picks: 0, grabs: 0, spins: 0, clubHits: 0, throws: 0, slams: 0, drops: 0, sweeps: 0, smashes: 0, charges: 0, drums: 0, bites: 0 };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function ease(t) { return t <= 0 ? 0 : (t >= 1 ? 1 : t * t * (3 - 2 * t)); }
  function shortest(a) { while (a > Math.PI) a -= 6.283185307179586; while (a < -Math.PI) a += 6.283185307179586; return a; }
  function groundAt(x, z) {
    if (typeof CBZ.floorAt === 'function') {
      var y = CBZ.floorAt(x, z);
      if (typeof y === 'number' && isFinite(y)) return y;
    }
    return 0;
  }
  function scaleOf(a) {
    var s = (a && a.group && a.group.scale && a.group.scale.x) || 1;
    if (!(s > 0) || !isFinite(s)) s = 1;
    return s;
  }
  function posOf(a) { return (a && (a.pos || (a.group && a.group.position))) || null; }
  function headingOf(a) {
    if (a && typeof a.heading === 'number') return a.heading;
    return a && a.group ? -a.group.rotation.y : 0;
  }
  function alive(a) { return !!(a && !a.dead && !a.escaped && a.group && a.group.parent); }

  // ============================================================
  //  THE ARM. Discovered, never tabled — same law as predator_anim: the 46th
  //  ape must work for free. The gait rig already sorted this body's ground
  //  columns into front and rear (wildlife_rig.js:108); on a knuckle-walker
  //  the FRONT columns ARE the arms, so their height IS the arm length and
  //  their x IS how far in front of centre the hands hang. Falls back to the
  //  actor's own scale when no gait was ever built (arena_fights.js never
  //  calls buildGait), so nothing here can divide by a missing rig.
  // ============================================================
  function apeRig(a) {
    if (a._apeArm) return a._apeArm;
    var sc = scaleOf(a);
    var armX = 0.7, armH = 1.25, topY = 1.95;
    var gt = a.gait;
    if (gt && gt.cols && gt.cols.length) {
      var fx = 0, fh = 0, n = 0, hi = 0;
      for (var i = 0; i < gt.cols.length; i++) {
        var c = gt.cols[i];
        if (c.top > hi) hi = c.top;
        if (c.x > 0) { fx += c.x; fh = Math.max(fh, c.h); n++; }
      }
      if (n > 0) { armX = fx / n; armH = fh; }
      if (hi > 0) topY = hi * 1.35;          // the columns end at the shoulder line
    }
    // the hand's world radius from body centre, and the height it holds at
    var out = {
      armX: armX * sc,
      armH: armH * sc,
      hold: Math.max(1.15, (armX + armH * 0.62) * sc),   // horizontal hold radius
      holdY: Math.max(0.95, topY * 0.86 * sc),           // shoulder-height carry
      sc: sc,
    };
    a._apeArm = out;
    return out;
  }

  // ============================================================
  //  WHO IS IN FRONT OF IT. One roster walk, filtered to living enemies with a
  //  body. `CBZ.worldActors` is the shared live-cast seam (modecaps.js) that
  //  the registered game answers for itself, so this works in the city, in
  //  survival, in the prison and on battle.html without one branch per host.
  // ============================================================
  function roster() {
    if (typeof CBZ.worldActors === 'function') {
      try { return CBZ.worldActors(_roster); } catch (e) { _roster.length = 0; return _roster; }
    }
    _roster.length = 0;
    return _roster;
  }
  function isEnemy(ape, o) {
    if (!o || o === ape || o.dead || o.escaped) return false;
    if (ape.team && o.team && ape.team === o.team) return false;
    if (!ape.team && o.species && apeIs(o)) return false;   // no ape-on-ape flail in the wild
    return true;
  }
  // Can this body be picked up? It needs a group to reparent-by-position, and
  // it must not out-mass the ape — a gorilla does not swing a bear.
  function grabbable(ape, o) {
    if (!isEnemy(ape, o)) return false;
    if (!o.group || !o.group.parent) return false;
    if (o._apeHeld || o._apeFlying) return false;
    if (o.isPlayer || (CBZ.player && o.pos === CBZ.player.pos)) return false;  // the player has no rig to swing
    var os = scaleOf(o) * ((o.rad || 0.45) / 0.45);
    return os <= scaleOf(ape) * 1.35;
  }

  function hurt(a, dmg, imp) {
    if (!(dmg > 0) || !a || a.dead) return false;
    if (typeof CBZ.hurtWorldActor === 'function') {
      try { return !!CBZ.hurtWorldActor(a, dmg, imp); } catch (e) {}
    }
    // last resort: the actor's own numbers, so a host with no switchboard
    // still sees a body die rather than an immortal one soak the whole fight
    if (a.hp == null) a.hp = 100;
    a.hp -= dmg;
    if (a.hp <= 0 && !a.dead) { a.hp = 0; a.dead = true; }
    return true;
  }
  var _imp = { by: null, byTeam: null, cause: '', fromX: 0, fromZ: 0, force: 0, melee: 'ape' };
  function impOf(ape, cause, force, fx, fz) {
    _imp.by = ape; _imp.byTeam = ape && ape.team; _imp.cause = cause;
    _imp.force = force || 0; _imp.fromX = fx || 0; _imp.fromZ = fz || 0;
    return _imp;
  }

  // ============================================================
  //  BEING HIT BY A GORILLA MOVES YOU. There is no shared "launch this actor"
  //  verb every host implements — CBZ.body.hit exists in the city and survival
  //  and nowhere else — so this is BOTH: hand the impulse to the body layer
  //  when it is loaded (it owns the ragdoll and does it better), and otherwise
  //  run the small ballistic tumble below, which is self-contained and works on
  //  any page. Either way a struck man leaves his feet.
  // ============================================================
  function launch(ape, o, dirx, dirz, spd, up, dmg, cause) {
    if (!o || o.dead) { if (dmg > 0) hurt(o, dmg, impOf(ape, cause, spd)); return; }
    var p = posOf(ape);
    if (dmg > 0) hurt(o, dmg, impOf(ape, cause, spd, p ? p.x : 0, p ? p.z : 0));
    if (CBZ.combatIQ && CBZ.combatIQ.suppress) { try { CBZ.combatIQ.suppress(o, 1.2); } catch (e) {} }
    if (CBZ.body && CBZ.body.hit && !o._apeHeld) {
      try {
        CBZ.body.hit(o, { dir: { x: dirx, z: dirz }, force: spd, fling: up, knockdown: up < 2 ? 1.1 : 0 });
        return;
      } catch (e) {}
    }
    if (o._apeHeld || o._apeFlying) return;
    fly(o, dirx * spd, up, dirz * spd, ape, 0, cause);
  }

  /* PUT A BODY IN THE AIR, through whichever owner of "airborne" this host has.
     The shared body layer (systems/grapple.js) is the right one wherever it is
     loaded: it runs the ragdoll, the landing and the settle, AND — the part
     that actually matters — city/peds.js already stands a walker down on
     `_phys.air` (peds.js:5771), so a pedestrian thrown by a gorilla stops
     walking his route mid-flight. The local integrator below is for the hosts
     that have no body layer at all, which is precisely games/battle.html: the
     `beasts` studio pack does not include grapple.js and never should. */
  function hurl(o, vx, vy, vz, by, landDmg, cause) {
    if (!o || o.dead) { if (landDmg > 0) hurt(o, landDmg, impOf(by, cause, 0)); return; }
    if (CBZ.body && CBZ.body.hit) {
      var sp = Math.hypot(vx, vz) || 1;
      try {
        CBZ.body.hit(o, { dir: { x: vx / sp, z: vz / sp }, force: sp, fling: vy });
        if (landDmg > 0) hurt(o, landDmg, impOf(by, cause, sp));
        return;
      } catch (e) {}
    }
    fly(o, vx, vy, vz, by, landDmg, cause);
  }

  // put a body into the air under this file's own integrator
  function fly(o, vx, vy, vz, by, landDmg, cause) {
    if (!o || !o.group) return;
    o._apeFlying = 1;
    FLYING.push({
      v: o, vx: vx, vy: vy, vz: vz, t: 0,
      spin: (vx * vx + vz * vz > 40 ? 9 : 5) * (Math.random() < 0.5 ? -1 : 1),
      by: by || null, dmg: landDmg || 0, cause: cause || 'thrown by a gorilla',
      hit: 0,
    });
  }

  // ============================================================
  //  THE MOVE PICKER — situational, not a dice roll on a flat table. What a
  //  silverback does next is decided by how many men are inside its arms:
  //  a mob gets the arc moves and the club, a single holdout gets teeth.
  // ============================================================
  function crowdAround(ape, r) {
    var list = roster(), n = 0;
    var p = posOf(ape); if (!p) return 0;
    var r2 = r * r;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!isEnemy(ape, o)) continue;
      var q = posOf(o); if (!q) continue;
      var dx = q.x - p.x, dz = q.z - p.z;
      if (dx * dx + dz * dz <= r2) n++;
    }
    return n;
  }

  function apeMove(attacker, target, opts, dist, reach) {
    if (!ON() || !apeIs(attacker)) return null;
    if (attacker._apeHold) return null;                    // the hold owns the beat
    var now = (CBZ.now || 0) / 1000;
    var crowd = crowdAround(attacker, reach * 2.3);
    var style;
    var swings = attacker._apeSwings = (attacker._apeSwings || 0) + 1;

    /* ONE ROLL PER GATE, and this is not a style preference — the first build
       drew a single `r` and tested it against a descending chain of thresholds,
       which makes every later branch with a SMALLER threshold unreachable by
       construction. Measured: with the grab claiming r < 0.30 and the backhand
       claiming r < 0.62, the smash's `r < 0.34` could only ever be reached with
       r already in [0.30, 0.34) — so across eight battles the overhead smash
       and the backhand fired exactly zero times and it looked like a tuning
       problem. Independent rolls, and each number below means what it says. */
    function roll() { return Math.random(); }

    // THE DISPLAY. A silverback that has just arrived, or one that is losing,
    // beats its chest — this is the single most documented gorilla behaviour
    // there is and it is a real tactic, not decoration: it buys distance.
    var hurtish = attacker.maxHp > 0 && attacker.hp < attacker.maxHp * 0.55;
    if ((attacker._apeDrumT || 0) < now - 9 && crowd >= 2 && swings > 1 &&
        roll() < (hurtish ? 0.22 : 0.10)) {
      attacker._apeDrumT = now;
      style = 'ape_drum';
    }
    /* THE CLUB. Three or more bodies inside the arms is exactly the situation a
       75 kg flail solves, and it is the situation the meme is about.

       IT IS NOT AN OPENER, and the first build made it one — measured, and the
       measurement is the reason this clause has four guards instead of one. A
       silverback that grabbed on its very first swing spent the next three
       seconds stationary with a man in its hand while sixty of them punched it,
       and died having thrown exactly ONE attack in its entire life
       (tools/ape-check.mjs: picks 1, grabs 1, everything else 0). That is not
       the gorilla being weak, it is the gorilla never getting to fight: the
       hold is the most committed thing in the move set and committing to it
       cold, before anything has been cleared off you, is simply a bad move.
       So it now takes THREE swings of the ordinary repertoire to earn — which
       is also how it actually goes: you scatter the ring first, THEN you pick
       one up. */
    else if (FLAIL_ON() && HOLDS.length < MAX_HOLDS && crowd >= 2 && swings >= 2 &&
             (attacker._apeGrabT || -99) < now - GRAB_CD &&
             grabbable(attacker, target) && roll() < (crowd >= 4 ? 0.45 : 0.26)) {
      style = 'ape_grab';
    }
    /* THE CHARGE IS THE ARRIVAL. Authored as "throw it when the target is out
       of reach" and measured at exactly zero across eight battles, for a
       structural reason: creature_combat only ever begins a swing once it is
       INSIDE reach, and the locomotion seam closes to 1.67 m, so `dist > reach`
       is a condition the picker is never called under. It is also the wrong
       idea — a silverback's charge is not a gap-closer it throws from range,
       it is what it does the moment it arrives, which is `swings <= 1`. */
    else if ((swings <= 1 || dist > reach * 1.08) && roll() < 0.62) style = 'ape_charge';
    // reach out and clear the ring — the arm is longer than any of theirs
    else if (crowd >= 3 && roll() < 0.30) style = 'ape_sweep';
    else {
      // the standing repertoire, one draw over a real partition
      var r = roll();
      style = r < 0.36 ? 'ape_smash' : r < 0.68 ? 'ape_sweep' : 'ape_bite';
    }

    STATS.picks++;
    var mv = MOVES[style];
    attacker._atkDur = mv.dur;
    /* AND IT DOES NOT WAIT A FULL SECOND BETWEEN BLOWS. The caller's `rate` is
       a stalking quadruped's cadence — creature_combat's own DEFAULT_RATE is
       1.1 s and battle.html derives 1.055 s for a gorilla — which is right for
       an animal that closes, bites and backs off, and wrong for the one animal
       in the bestiary that fights with HANDS. Measured against sixty men: at
       the inherited cadence a silverback threw two blows in its entire life,
       so five of its six moves were unreachable no matter how the picker was
       weighted. The recovery is cut, not the damage: it still lands exactly
       what `opts.dmg` says, it simply strings its blows the way a thing with
       arms does. Everything else in the bestiary keeps the cadence it had. */
    attacker._atkT *= APE_TEMPO;
    attacker._apeSide = (attacker._apeSide === 1) ? -1 : 1;   // backhands alternate
    return style;
  }

  // ============================================================
  //  THE STRIKE MOMENT. creature_combat has advanced the clock across
  //  STRIKE_AT and is asking who pays. Returns the damage dealt (0 is a real
  //  answer — a chest-beat lands nothing on purpose) or null for "not mine".
  // ============================================================
  function apeStrike(attacker, target, style, opts, dmg) {
    if (!ON()) return null;
    var mv = moveOf(style);
    if (!mv || !apeIs(attacker)) return null;
    var p = posOf(attacker); if (!p) return null;
    var h = headingOf(attacker);
    var reach = (opts && typeof opts.reach === 'number') ? opts.reach : (1.6 + scaleOf(attacker));
    dmg = (dmg > 0) ? dmg : 12;

    if (style === 'ape_drum') {
      STATS.drums++;
      return drum(attacker, reach);
    }
    if (style === 'ape_grab') {
      if (FLAIL_ON() && grabbable(attacker, target) && HOLDS.length < MAX_HOLDS) {
        STATS.grabs++;
        beginHold(attacker, target, dmg, opts);
        return 0;                                    // the hold bills the damage
      }
      // refused (he died in the windup, or something bigger stepped in): the
      // arm is already out, so it lands as an ordinary blow rather than a whiff
      style = 'ape_smash'; mv = MOVES.ape_smash;
    }
    if (style === 'ape_bite') STATS.bites++;
    else if (style === 'ape_sweep') STATS.sweeps++;
    else if (style === 'ape_smash') STATS.smashes++;
    else if (style === 'ape_charge') STATS.charges++;

    var dealt = 0;
    var rng = reach * mv.rng;
    var side = attacker._apeSide || 1;
    // the backhand travels ACROSS the front; its fan is centred off the heading
    var centre = (style === 'ape_sweep') ? h + side * 0.42 : h;

    if (mv.arc <= 0) {
      // a single mark: the thing it was actually swinging at
      dealt = dmg * mv.pow;
      if (target && !target.dead) {
        var tp = posOf(target);
        var tx = tp ? (tp.x - p.x) : Math.cos(h), tz = tp ? (tp.z - p.z) : Math.sin(h);
        var tl = Math.hypot(tx, tz) || 1;
        if (style === 'ape_bite' && CBZ.creatureBiteWound) {
          try { CBZ.creatureBiteWound(attacker, target, 'maul'); } catch (e) {}
        }
        launch(attacker, target, tx / tl, tz / tl, mv.push, mv.push > 3 ? 3.2 : 0.8,
          dealt, 'a gorilla');
      }
      return dealt;
    }

    // THE FAN. Everything inside the arc takes it — that is the whole reason a
    // 1.2 m arm matters against a crowd, and it is why a ring of men cannot
    // simply stand shoulder to shoulder around a silverback.
    var list = roster();
    var rng2 = rng * rng;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!isEnemy(attacker, o) || o._apeHeld) continue;
      var q = posOf(o); if (!q) continue;
      var dx = q.x - p.x, dz = q.z - p.z;
      var d2 = dx * dx + dz * dz;
      if (d2 > rng2) continue;
      var d = Math.sqrt(d2) || 0.001;
      if (Math.abs(shortest(Math.atan2(dz, dx) - centre)) > mv.arc) continue;
      // a blow falls off across the arc: the knuckles carry more than the wrist
      var near = 1 - 0.35 * (d / rng);
      var pay = dmg * mv.pow * near;
      dealt += pay;
      // a SMASH drives you into the ground, a SWEEP and a CHARGE throw you clear
      var upK = (style === 'ape_smash') ? 1.1 : 3.4;
      launch(attacker, o, dx / d, dz / d, mv.push * near, upK * near, pay,
        style === 'ape_smash' ? 'flattened by a gorilla' : 'swatted by a gorilla');
    }
    if (CBZ.shake && dealt > 0) { try { CBZ.shake(style === 'ape_smash' ? 0.35 : 0.2); } catch (e) {} }
    return dealt;
  }

  // THE CHEST BEAT. No damage — the point is that it does none and still
  // changes the fight. Every man who can see it is suppressed, which in
  // combat_iq's own grammar means his fire discipline and his nerve both drop.
  function drum(ape, reach) {
    var p = posOf(ape); if (!p) return 0;
    var list = roster(), r = reach * 4.5, r2 = r * r;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!isEnemy(ape, o)) continue;
      var q = posOf(o); if (!q) continue;
      var dx = q.x - p.x, dz = q.z - p.z;
      if (dx * dx + dz * dz > r2) continue;
      if (CBZ.combatIQ && CBZ.combatIQ.suppress) { try { CBZ.combatIQ.suppress(o, 1.6); } catch (e) {} }
      o._apeAwe = (CBZ.now || 0) / 1000;
    }
    if (CBZ.sfx) { try { CBZ.sfx('punch'); } catch (e) {} }
    if (CBZ.shake) { try { CBZ.shake(0.28); } catch (e) {} }
    return 0;
  }

  // ============================================================
  //  THE HOLD — lift, spin, and the release. This is the part no other file in
  //  the engine could own, because it is the only place a living body's world
  //  transform belongs to something other than its own brain.
  //
  //  The victim is NOT reparented. Reparenting a rig mid-fight fights every
  //  system that assumes `group.position` is world space (separation, the body
  //  grid, line of sight, the death topple). Instead the hold WRITES his world
  //  position every step and flags `_apeHeld`, which is the one thing hosts
  //  check to stand their own movers down — exactly how grapple.js's `heldBy`
  //  works for the player's carry.
  // ============================================================
  function beginHold(ape, victim, dmg, opts) {
    var arm = apeRig(ape);
    var revs = SPIN_REVS * (crowdAround(ape, arm.hold * 3.4) >= 4 ? 1.25 : 1);
    var h = {
      ape: ape, victim: victim, phase: 'lift', t: 0,
      ph: headingOf(ape),                  // the swing angle, absolute world radians
      dmg: dmg, revs: revs, turned: 0,
      arm: arm, lastTag: -1, tag: 0,
      opts: opts || null,
    };
    ape._apeHold = h;
    ape._apeGrabT = (CBZ.now || 0) / 1000;
    victim._apeHeld = ape;
    /* AND THE CITY'S OWN MOVER HAS TO KNOW. `_apeHeld` is this file's flag and
       games/battle.html tests it directly, but city/peds.js has stood its
       walkers down for months on a DIFFERENT one — the shared body layer's
       `heldBy` (peds.js:5771, `ph.air || ph.down > 0 || ph.heldBy`), which is
       how the player's own carry already works (grapple.js:798). Setting both
       is not belt and braces: without this a pedestrian in a gorilla's fist
       keeps walking his route while his position is being written by a swing,
       and the two writers tear. Guarded, because the body layer is not in the
       `beasts` pack and battle.html has no CBZ.body at all. */
    if (CBZ.body && CBZ.body.phys) {
      try { CBZ.body.phys(victim).heldBy = ape; } catch (e) {}
    }
    victim._apeSeed = Math.random() * 6.28;
    // he stops being a combatant the instant he leaves the ground
    victim.tgt = null;
    if (victim.char) victim.char.fightStance = false;
    HOLDS.push(h);
    if (CBZ.sfx) { try { CBZ.sfx('whoosh'); } catch (e) {} }
    return h;
  }

  function endHold(h, thrown, finished) {
    // A HOLD THAT ENDED WITHOUT A FINISHER STILL ENDED, and it has to be
    // countable separately or "no throw ever happened" reads as a leak when it
    // is really the ape dying with a man still in its hand — which is a
    // perfectly good outcome and the commonest one in a losing fight.
    if (!finished) STATS.drops++;
    var ape = h.ape, v = h.victim;
    if (ape) { ape._apeHold = null; ape._atkDur = 0; }
    if (v) {
      v._apeHeld = null;
      // give the body layer its walker back, or a released pedestrian is
      // "held by" a gorilla that let go of him for the rest of the run
      if (CBZ.body && CBZ.body.phys) { try { CBZ.body.phys(v).heldBy = null; } catch (e) {} }
    }
    var i = HOLDS.indexOf(h);
    if (i >= 0) HOLDS.splice(i, 1);
    if (ape && CBZ.creatureEndAttack) { try { CBZ.creatureEndAttack(ape); } catch (e) {} }
    if (ape && CBZ.predatorPose) { try { CBZ.predatorPose(ape, 'ape_flail', 1, 0, 0); } catch (e) {} }
    if (!thrown && v && CBZ.deathPose && v.dead && v.char) {
      try { CBZ.deathPose(v.char, v._apeSeed || 1.7); } catch (e) {}
    }
  }

  // where the hand is this instant
  function handAt(h, out) {
    var p = posOf(h.ape);
    var arm = h.arm;
    var lift = (h.phase === 'lift') ? ease(h.t / LIFT_T)
      : (h.phase === 'slam') ? (1 - ease(clamp(h.t / (SLAM_T * 0.6), 0, 1))) : 1;
    var r = arm.hold * (0.55 + 0.45 * lift);
    out.x = p.x + Math.cos(h.ph) * r;
    out.z = p.z + Math.sin(h.ph) * r;
    var gy = groundAt(out.x, out.z);
    // hoisted OVERHEAD for the slam's windup, carried at the shoulder otherwise
    var hy = arm.holdY * (h.phase === 'slam' ? 1.35 : 1.0);
    out.y = gy + 0.35 + (hy - 0.35) * lift;
    return out;
  }
  var _hand = { x: 0, y: 0, z: 0 };

  function stepHold(h, dt) {
    var ape = h.ape, v = h.victim;
    // the ape died, or the body left the world (a corpse cap recycled it)
    if (!alive(ape) || !v || !v.group || !v.group.parent) { endHold(h, false); return; }
    h.t += dt;
    var arm = h.arm;
    var p = posOf(ape);

    if (h.phase === 'lift') {
      // the arm comes round and the man leaves the ground. The ape turns with
      // him, so the wind-up is already the first quarter of the swing.
      h.ph += dt * 3.2;
      if (h.t >= LIFT_T) { h.phase = 'spin'; h.t = 0; STATS.spins++; }
    } else if (h.phase === 'spin') {
      // IT ACCELERATES. A constant rate reads as a turntable; a rising one
      // reads as something winding up a mass it can barely hold on to.
      var wind = clamp(h.turned / Math.max(0.6, h.revs), 0, 1);
      var hz = SPIN_HZ_LO + (SPIN_HZ_HI - SPIN_HZ_LO) * wind;
      var d = dt * hz * 6.283185307179586;
      h.ph += d;
      h.turned += d / 6.283185307179586;
      h.tag = Math.floor(h.turned * 2);          // two contact windows a turn
      sweepClub(h, hz);
      if (h.turned >= h.revs) {
        // FINISH. Into the ground if a body is standing where he would land,
        // otherwise let go and let 75 kg travel.
        h.phase = (Math.random() < 0.42) ? 'slam' : 'throw';
        h.t = 0;
        h.hz = hz;
      }
    } else if (h.phase === 'slam') {
      h.ph += dt * 1.4;
      if (h.t >= SLAM_T) { doSlam(h); return; }
    } else if (h.phase === 'throw') {
      h.ph += dt * (h.hz || SPIN_HZ_HI) * 6.283185307179586;
      if (h.t >= THROW_T) { doThrow(h); return; }
    }

    // the ape faces the way the swing is going — the whole body drives it
    ape.heading = h.ph;
    if (CBZ.faceAnimalHeading) { try { CBZ.faceAnimalHeading(ape, h.ph); } catch (e) {} }
    else if (ape.group) ape.group.rotation.y = -h.ph;
    // a spinning silverback digs in and leans AGAINST the mass on the arm
    if (ape.group) {
      var lean = (h.phase === 'spin') ? -0.16 : (h.phase === 'slam' ? -0.34 + 0.62 * ease(h.t / SLAM_T) : -0.10);
      ape.group.rotation.z = lean;
      ape.group.position.y = groundAt(p.x, p.z);
    }
    // and the arms are up: the pose layer's rear-up IS a knuckle-walker's
    // arms leaving the ground, which is exactly the shape we want here
    if (CBZ.predatorPose) {
      var pp = (h.phase === 'slam') ? clamp(h.t / SLAM_T, 0, 0.999) : (h.turned % 1);
      try { CBZ.predatorPose(ape, 'ape_flail', pp, 1, dt); } catch (e) {}
    }

    // seat the body in the hand
    handAt(h, _hand);
    var vp = posOf(v);
    if (vp) { vp.x = _hand.x; vp.y = _hand.y; vp.z = _hand.z; }
    if (v.group && v.group.position !== vp) {
      v.group.position.set(_hand.x, _hand.y, _hand.z);
    }
    if (v.group) {
      // held by an ankle, head down and trailing the swing
      v.group.rotation.y = -h.ph + Math.PI * 0.5;
      v.group.rotation.x = (h.phase === 'lift') ? -1.05 * ease(h.t / LIFT_T) : -1.05;
      v.group.rotation.z = Math.sin(h.ph * 2 + (v._apeSeed || 0)) * 0.26;
    }
  }

  // THE CLUB CONNECTS. Everyone the swung body passes through takes it, once
  // per contact window, and so does the body — being the weapon is fatal.
  function sweepClub(h, hz) {
    if (h.tag === h.lastTag) return;
    var v = h.victim, ape = h.ape;
    var vp = posOf(v); if (!vp) return;
    var ap = posOf(ape); if (!ap) return;
    var list = roster();
    /* WHAT THE CLUB ACTUALLY SWEEPS. The first build tested a ball around the
       swung man's centre, which is the volume a thrown ROCK occupies — and it
       left every man standing between the ape and its own hand untouched,
       inside a swing that was physically passing straight through them. A body
       held by the ankle at the end of a 1.2 m arm is a ~3 m bar hinged at the
       shoulder, so the test is the distance to the SEGMENT from the ape to the
       hand, and the radius is the width of a man, not the length of one. */
    var sx = vp.x - ap.x, sz = vp.z - ap.z;
    var seg2 = sx * sx + sz * sz;
    var r = 0.95 + (v.rad || 0.45), r2 = r * r;
    var struck = 0;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === v || !isEnemy(ape, o) || o._apeHeld) continue;
      var q = posOf(o); if (!q) continue;
      // nearest point on the arm-plus-body segment, clamped to its ends
      var t = seg2 > 1e-6 ? ((q.x - ap.x) * sx + (q.z - ap.z) * sz) / seg2 : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      // the inner third is the ape's own chest — that is a shoulder barge, not
      // the club, and it belongs to the ordinary moves
      if (t < 0.34) continue;
      var cx = ap.x + sx * t, cz = ap.z + sz * t;
      var ex = q.x - cx, ez = q.z - cz;
      if (ex * ex + ez * ez > r2) continue;
      var dx = q.x - vp.x, dz = q.z - vp.z;
      var d = Math.hypot(dx, dz) || 0.001;
      // he is thrown along the tangent of the swing, not away from the ape:
      // that is what being hit by something moving in a circle does to you
      var tx = -Math.sin(h.ph), tz = Math.cos(h.ph);
      var spd = clamp(hz * 6.283 * h.arm.hold * 0.42, 4, 13);
      launch(ape, o, (tx * 0.75 + dx / d * 0.25), (tz * 0.75 + dz / d * 0.25),
        spd, 3.6, h.dmg * CLUB_DMG, 'clubbed with a body');
      struck++;
      STATS.clubHits++;
    }
    if (struck) {
      h.lastTag = h.tag;
      // the club pays for every landing — a man used as a weapon does not
      // survive being used as a weapon
      hurt(v, h.dmg * CLUB_SELF * struck, impOf(ape, 'used as a club', 0));
      if (CBZ.sfx) { try { CBZ.sfx('punch'); } catch (e) {} }
      if (CBZ.shake) { try { CBZ.shake(0.22); } catch (e) {} }
    }
  }

  function doSlam(h) {
    STATS.slams++;
    var ape = h.ape, v = h.victim;
    handAt(h, _hand);
    var vp = posOf(v);
    var gx = vp ? vp.x : _hand.x, gz = vp ? vp.z : _hand.z;
    // the body goes into the ground, and the ground answers back: everything
    // standing on the impact takes the shock
    var list = roster(), r = 2.5, r2 = r * r;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === v || !isEnemy(ape, o) || o._apeHeld) continue;
      var q = posOf(o); if (!q) continue;
      var dx = q.x - gx, dz = q.z - gz;
      var d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      var d = Math.sqrt(d2) || 0.001;
      launch(ape, o, dx / d, dz / d, 5.5, 2.4, h.dmg * 0.8, 'floored by a gorilla');
    }
    if (vp) vp.y = groundAt(gx, gz);
    hurt(v, h.dmg * 3.2, impOf(ape, 'slammed into the ground by a gorilla', 6, gx, gz));
    if (v.group) { v.group.rotation.x = -1.45; v.group.rotation.z = 0.2; }
    if (CBZ.shake) { try { CBZ.shake(0.6); } catch (e) {} }
    if (CBZ.doHitstop) { try { CBZ.doHitstop(0.05); } catch (e) {} }
    if (CBZ.sfx) { try { CBZ.sfx('ko'); } catch (e) {} }
    endHold(h, false, true);
  }

  function doThrow(h) {
    STATS.throws++;
    var ape = h.ape, v = h.victim;
    var hz = h.hz || SPIN_HZ_HI;
    var spd = clamp(hz * 6.283185307179586 * h.arm.hold, 6, THROW_SPD_CAP);
    var tx = -Math.sin(h.ph), tz = Math.cos(h.ph);
    v._apeHeld = null;
    endHold(h, true, true);
    hurl(v, tx * spd, 4.2 + spd * 0.14, tz * spd, ape, h.dmg * 1.6, 'thrown by a gorilla');
    if (CBZ.sfx) { try { CBZ.sfx('whoosh'); } catch (e) {} }
  }

  // ============================================================
  //  BODIES IN THE AIR. One integrator for everything this file throws: the
  //  flung man, the swatted man, the man who was the club. It is deliberately
  //  small — the point is that the body ARRIVES somewhere, hits whatever is
  //  standing there, and then stops being ours so the host's own death topple
  //  and corpse handling take over untouched.
  // ============================================================
  function stepFly(f, dt) {
    var v = f.v;
    if (!v || !v.group || !v.group.parent) return false;
    var p = posOf(v); if (!p) return false;
    f.t += dt;
    f.vy -= GRAV * dt;
    var nx = p.x + f.vx * dt, nz = p.z + f.vz * dt, ny = p.y + f.vy * dt;
    var gy = groundAt(nx, nz);
    // a body in flight is still a 75 kg object travelling at 15 m/s
    if (!f.hit && (f.vx * f.vx + f.vz * f.vz) > 36) {
      var list = roster();
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o === v || o._apeHeld || o._apeFlying || !o.group || o.dead) continue;
        if (f.by && o.team && f.by.team && o.team === f.by.team) continue;
        var q = posOf(o); if (!q) continue;
        var dx = q.x - nx, dz = q.z - nz;
        if (dx * dx + dz * dz > 1.5 || Math.abs(q.y - ny) > 2.2) continue;
        var d = Math.hypot(dx, dz) || 0.001;
        launch(f.by, o, dx / d, dz / d, 6, 3, f.dmg * 0.7, 'bowled over by a flying body');
        f.hit = 1;
        f.vx *= 0.45; f.vz *= 0.45;
        break;
      }
    }
    if (ny <= gy) {
      p.x = nx; p.z = nz; p.y = gy;
      if (v.group) {
        v.group.rotation.x = 0; v.group.rotation.z = 0;
        if (v.group.position !== p) v.group.position.set(nx, gy, nz);
      }
      if (f.dmg > 0) hurt(v, f.dmg, impOf(f.by, f.cause, 0));
      if (v.dead && v.char && CBZ.deathPose) { try { CBZ.deathPose(v.char, v._apeSeed || 2.1); } catch (e) {} }
      v._apeFlying = 0;
      return false;
    }
    p.x = nx; p.y = ny; p.z = nz;
    if (v.group) {
      if (v.group.position !== p) v.group.position.set(nx, ny, nz);
      v.group.rotation.x += f.spin * dt;
      v.group.rotation.z = Math.sin(f.t * 7) * 0.3;
    }
    if (f.t > FLIGHT_MAX) {
      p.y = gy; v._apeFlying = 0;
      if (v.group) { v.group.rotation.x = 0; v.group.rotation.z = 0; }
      if (f.dmg > 0) hurt(v, f.dmg, impOf(f.by, f.cause, 0));
      return false;
    }
    return true;
  }

  // ============================================================
  //  THE TICK. Hosts call this once per frame (or per sim sub-step, which is
  //  why it takes dt rather than reading a clock). The first explicit call
  //  disables the onUpdate fallback below, so a page with its own sim loop can
  //  never be double-stepped.
  // ============================================================
  function stepAll(dt) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;                 // a stalled frame must not teleport a body
    for (var i = HOLDS.length - 1; i >= 0; i--) {
      var h = HOLDS[i];
      if (HOLDS.indexOf(h) < 0) continue;   // ended itself inside the step
      stepHold(h, dt);
    }
    for (var j = FLYING.length - 1; j >= 0; j--) {
      var f = FLYING[j];
      var keep = false;
      try { keep = stepFly(f, dt); } catch (e) { keep = false; }
      if (!keep) {
        if (f.v) f.v._apeFlying = 0;
        FLYING.splice(j, 1);
      }
    }
  }
  function apeStep(dt) { _hostDriven = true; stepAll(dt); }

  // ============================================================
  //  THE VICTIM'S OWN BODY. The host animates its people AFTER the sim (that
  //  is the ordering every rig in this engine assumes), so a pose written in
  //  the step would be stomped. Hosts call this instead of their animator for
  //  a held body; index.html gets it for free off the late-write order the
  //  shared body layer already uses (90).
  // ============================================================
  function poseVictim(v, dt) {
    if (!v || !v.char || !v.char.parts) return false;
    if (!v._apeHeld && !v._apeFlying) return false;
    var ch = v.char, P = ch.parts;
    var s = v._apeSeed || 0;
    var t = ((CBZ.now || 0) / 1000) * 9 + s;
    // a man held by one ankle is not limp — he is fighting it, hard, and that
    // is the difference between a body and a prop
    var a = v._apeHeld ? 1 : 0.55;
    if (ch.body) ch.body.rotation.set(-0.22 * a, Math.sin(t * 0.7) * 0.2 * a, Math.sin(t * 1.1) * 0.18 * a);
    if (ch.neck) ch.neck.rotation.set(0.3 * a, Math.sin(t * 1.3) * 0.3 * a, 0);
    if (P.la) P.la.rotation.set(-1.5 + Math.sin(t) * 0.55 * a, 0, 0.6 + Math.sin(t * 1.7) * 0.3 * a);
    if (P.ra) P.ra.rotation.set(-1.5 + Math.sin(t + 2.1) * 0.55 * a, 0, -0.6 - Math.sin(t * 1.4) * 0.3 * a);
    if (P.ll) P.ll.rotation.set(0.5 + Math.sin(t * 1.2) * 0.4 * a, 0, 0.18);
    if (P.rl) P.rl.rotation.set(-0.2 + Math.sin(t * 0.9) * 0.4 * a, 0, -0.18);
    if (CBZ.lockCharacterHips) { try { CBZ.lockCharacterHips(ch); } catch (e) {} }
    return true;
  }

  // ---- the fallback drive, for hosts with no sim loop of their own --------
  if (typeof CBZ.onUpdate === 'function') {
    CBZ.onUpdate(23.5, function (dt) { if (!_hostDriven) stepAll(dt); });
    CBZ.onUpdate(91, function () {
      for (var i = 0; i < HOLDS.length; i++) poseVictim(HOLDS[i].victim, 0);
      for (var j = 0; j < FLYING.length; j++) poseVictim(FLYING[j].v, 0);
    });
  }

  // ---- public surface ------------------------------------------------------
  CBZ.apeIs = apeIs;
  CBZ.apeMove = apeMove;
  CBZ.apeStrike = apeStrike;
  CBZ.apeOwns = function (a) { return !!(a && a._apeHold); };
  CBZ.apeHeld = function (a) { return !!(a && (a._apeHeld || a._apeFlying)); };
  CBZ.apeStep = apeStep;
  CBZ.apePoseVictim = poseVictim;
  // Drop every hold and every body in the air, upright and unowned. A mode
  // change or a scenario reset must never strand a man in a fist.
  CBZ.apeReset = function () {
    for (var i = HOLDS.length - 1; i >= 0; i--) endHold(HOLDS[i], false);
    HOLDS.length = 0;
    for (var j = 0; j < FLYING.length; j++) {
      var v = FLYING[j].v;
      if (v) { v._apeFlying = 0; if (v.group) { v.group.rotation.x = 0; v.group.rotation.z = 0; } }
    }
    FLYING.length = 0;
  };
  // WHAT ACTUALLY HAPPENED, countable. tools/ape-check.mjs reads exactly this:
  // a move set nobody can see firing is a claim, not a feature.
  CBZ.apeAudit = function () {
    return {
      on: ON(), flail: FLAIL_ON(),
      holds: HOLDS.length, flying: FLYING.length,
      picks: STATS.picks, grabs: STATS.grabs, spins: STATS.spins, clubHits: STATS.clubHits,
      throws: STATS.throws, slams: STATS.slams, drops: STATS.drops,
      sweeps: STATS.sweeps, smashes: STATS.smashes, charges: STATS.charges,
      drums: STATS.drums, bites: STATS.bites,
      moves: Object.keys(MOVES),
    };
  };
})();
