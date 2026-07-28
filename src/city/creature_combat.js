// ============================================================================
// creature_combat.js — shared animal-combat system (CBZ)
// ----------------------------------------------------------------------------
// WHY: wild predators, the arena beast pit, and tamed companions all need the
// same "animal attacks a thing" behavior. Rather than three bespoke copies,
// this file exposes one driver — CBZ.creatureFight(attacker, target, dt, opts)
// — that any caller ticks once per frame per attacker.
//
// HOW THE ANIMATION WORKS: our animals are simple low-poly THREE.Groups with
// NO named skeleton, so there is nothing to key. Instead every attack is a
// stylized transform of the WHOLE group over a short (~0.4s) strike window,
// driven by a normalized progress p in 0..1 (windup -> strike -> recover):
//   - position offset along the attacker's facing (lunge/thrust/jab)
//   - a sin() arc on y (pounce leap, stomp slam)
//   - rotation.x pitch (head-dip bites, gore head-drop, stomp rear-up)
//   - rotation.z roll oscillation (maul shake, flinch shudder)
//   - occasionally a tiny scale pulse for impact punch
// We additionally try to find a child tagged as a "head" (userData.head) and
// dip it for bite-ish styles, but never assume mesh structure — if there's no
// head the whole-group motion still reads. Snake trail segments stored in
// group.userData.segs are left untouched.
//
// THE BODY LAYER (systems/predator_anim.js): whole-group motion is all this
// file could ever do, because it has no access to a skeleton — which is why a
// bear biting you moved the bear and nothing ON the bear. The 'lunge' style
// already reached out to CBZ.swimJaw for the shark's gape; animateAttack now
// makes that same call for EVERY style through CBZ.predatorPose, which finds
// the legs and the lower jaw geometrically in wildlife.js's gait rig and poses
// them on this animation's own 0..1 progress. It is called LAST in
// animateAttack (it composes on top of the group writes, so anything earlier
// would be stomped in the same frame) and handed back in endAttack. Fully
// degrade-safe: no predator_anim loaded, or its flag off, and every style
// animates exactly as it did before.
//
// Everything eases back to the rest pose (pitch/roll/offset -> 0, feet on the
// REST HEIGHT via restY()) between attacks so the mesh never drifts.
//
// MEDIUM (why restY exists): this driver used to hardcode the rest height to
// CBZ.floorAt — the seabed. Every style then wrote g.position.y = ground + yOff,
// which made it STRUCTURALLY IMPOSSIBLE for an aquatic predator to use the
// shared driver at all: a shark handed to creatureFight teleported onto the
// sand. restY() resolves an aquatic/swimming actor to the live water surface
// minus its swim depth instead, which is the one fix that opens this block to
// every water creature. Land actors resolve to floorAt exactly as before.
//
// LOCOMOTION (opts.move): optional. opts.move(actor, dx, dz, step, dt) — unit
// direction, step in metres — replaces the raw g.position write in the APPROACH
// branch and takes ownership of the vertical with it (we stop writing
// position.y). That is what lets an aquatic caller keep ONE mover: its water
// mask, shore clearance and depth easing stay authoritative instead of being
// fought by a second, land-shaped mover in the same frame. Omit it and the
// approach is byte-identical to what it has always been.
//
// SEIZE (the shared grab): opts.seize hands the strike frame to
// CBZ.predatorSeize (systems/predator.js) instead of opts.onHit, so "it bit
// you" can escalate to "it HAS you" without any caller writing a grab state
// machine. Degrade-safe: no predator block (or a refused seize) falls straight
// back to opts.onHit. `maul` (bears/wolves) opts in automatically on the
// player — that is the second consumer of the block, not a shark special case.
//
// ALLOCATION-FREE PER FRAME: no vectors or objects are created in the hot
// path. Per-actor scratch lives on the actor itself (_atkT, _atkAnim,
// _atkStyle, _flinchT, _lungeX/_lungeZ...), math uses module-scope temp
// numbers, and creatureFight returns one reused result object (read it
// immediately; do not retain it across frames).
// ============================================================================
(function () {
  'use strict';
  var CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;

  // ---- feature flag: the one-line revert for the seize hand-off ---------
  // (declared here, not in config.js — every agent declares its own default)
  if (CBZ.CONFIG && CBZ.CONFIG.CREATURE_SEIZE == null) CBZ.CONFIG.CREATURE_SEIZE = true;
  function SEIZE_ON() { return !(CBZ.CONFIG && CBZ.CONFIG.CREATURE_SEIZE === false); }

  // ---- tuning ----------------------------------------------------------
  var STRIKE_DUR = 0.4;      // seconds for one attack animation
  var STRIKE_AT = 0.45;      // point in 0..1 progress where damage lands
  var DEFAULT_RATE = 1.1;    // seconds between attacks
  var FLINCH_DUR = 0.28;     // seconds of hit recoil
  var TURN_RATE = 6.0;       // rad/s facing turn speed
  var MAUL_SEIZE_P = 0.35;   // chance a maul on the PLAYER escalates to a seize

  // ---- module-scope scratch (numbers only, reused every call) ----------
  var _dx = 0, _dz = 0, _dist = 0, _h = 0, _p = 0, _e = 0, _amt = 0;

  // reused result object for creatureFight (never allocated per frame)
  var RES = { inRange: false, dealt: 0 };

  // ---- helpers ----------------------------------------------------------
  function groundAt(x, z) {
    if (typeof CBZ.floorAt === 'function') {
      var g = CBZ.floorAt(x, z);
      if (typeof g === 'number' && isFinite(g)) return g;
    }
    return 0;
  }

  // THE MEDIUM FIX. Where does this actor's body BELONG at (x,z) with no attack
  // running? Land: the floor. Aquatic/swimming: the live water surface minus its
  // swim depth. Without this every style's `position.y = rest + yOff` dragged a
  // shark down to the seabed, which is why no water creature could ever use the
  // shared driver. Degrades to floorAt if the water API is absent.
  function restY(actor, x, z) {
    var sp = actor && actor.species;
    if ((sp && sp.aquatic) || (actor && actor._swims)) {
      var s = (typeof CBZ.citySeaHeightAt === 'function') ? CBZ.citySeaHeightAt(x, z) : null;
      if (typeof s !== 'number' || !isFinite(s)) s = (CBZ.SEA_Y != null ? CBZ.SEA_Y : 0);
      var d = (actor && typeof actor.swimDepth === 'number') ? actor.swimDepth : 1;
      return s - d;
    }
    return groundAt(x, z);
  }

  // smooth ease: 0..1 -> 0..1 (smoothstep)
  function ease(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t);
  }

  // triangular envelope peaking at STRIKE_AT: 0 at p=0, 1 at strike, 0 at p=1
  function strikeEnv(p) {
    if (p <= 0 || p >= 1) return 0;
    if (p < STRIKE_AT) return ease(p / STRIKE_AT);
    return ease(1 - (p - STRIKE_AT) / (1 - STRIKE_AT));
  }

  function shortestAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function actorScale(a) {
    if (a && a.species && typeof a.species.scale === 'number') return a.species.scale;
    if (a && typeof a.scale === 'number') return a.scale;
    return 1;
  }

  // find a plausible "head" child once and cache it on the group.
  // Safe: only used for an extra dip; whole-group motion carries the read.
  function findHead(group) {
    if (!group) return null;
    if (group.userData._cbzHeadSearched) return group.userData._cbzHead || null;
    group.userData._cbzHeadSearched = true;
    var head = null;
    var kids = group.children;
    if (kids) {
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        if (!c) continue;
        if (c.userData && (c.userData.head || c.name === 'head')) { head = c; break; }
      }
    }
    group.userData._cbzHead = head;
    return head;
  }

  // ---- style derivation --------------------------------------------------
  function creatureStyleFor(species) {
    if (!species) return 'bite';
    if (species.snake) return 'strike';
    var id = String(species.id || species.name || '').toLowerCase();
    // Open-water hunters do not bite from a standstill: they RUSH, usually from
    // below, and carry through. Tested first so nothing else can claim them.
    if (/shark|megalodon|orca|barracuda/.test(id)) return 'lunge';
    // Crocodilians maul like a bear, but their seize is the DEATH ROLL — see
    // creatureSeizeStyleFor().
    if (/crocodile|alligator|gator/.test(id)) return 'maul';
    if (/cat|leopard|cheetah|lion|tiger|panther|jaguar|cougar|puma|lynx/.test(id)) return 'pounce';
    if (/wolf|dog|coyote|fox|bear|hyena/.test(id)) return 'maul';
    // Heavy horned/shouldered animals do not "bite" at contact: they lower the
    // head, drive through the target and hand the actual body impulse to their
    // caller. Keep boars/elephants on the shorter gore animation; the big bovine
    // charge gets a longer, unmistakable RAM silhouette.
    if (/rhino|bison|bull|buffalo/.test(id)) return 'ram';
    if (/boar|moose|elephant/.test(id)) return 'gore';
    // THE HOOFED FALL-THROUGH. A whole shelf of this bestiary was landing on
    // the generic 'bite' — animals whose only weapon is a hoof or a horn,
    // animated as a mouth: bighorn sheep, caribou, zebra, giraffe, the white
    // stag. `ram` was already in this alternation but only ever matched a
    // species literally CALLED "ram" ("bighorn_sheep" contains no token here at
    // all). It matters now in two places it never used to: the cornered
    // defence picks its pose from this string, and predatorKit reads the
    // archetype row off it. Domestic cattle and the barnyard ewe deliberately
    // stay where they are — `cow` and `sheep` do NOT appear.
    if (/horse|deer|goat|elk|donkey|mule|ram|bighorn|ibex|argali|mouflon|caribou|reindeer|stag|zebra|giraffe|antelope|gazelle/.test(id)) return 'stomp';
    if (/bird|hawk|eagle|crow|raven|gull|owl|vulture|chicken|rooster|ostrich/.test(id) || species.bird) return 'peck';
    if (/snake|viper|cobra|python|rattler/.test(id)) return 'strike';
    return 'bite';
  }

  // Which grab does this species do once it HAS you? (predatorSeize opts.style)
  // Crocodilians roll, everything else thrashes. One line, no per-caller table.
  function creatureSeizeStyleFor(species) {
    var id = String((species && (species.id || species.name)) || '').toLowerCase();
    if (/crocodile|alligator|gator|anaconda|python|constrictor/.test(id)) return 'roll';
    return 'shake';
  }

  function speedFor(species) {
    var st = creatureStyleFor(species);
    if (st === 'lunge') return 9;      // a committed water rush is the fastest thing here
    if (st === 'pounce') return 7;
    if (st === 'maul') return (/bear/.test(String(species && (species.id || species.name) || '').toLowerCase())) ? 4.5 : 6;
    if (st === 'ram') return 6.5;
    if (st === 'gore' || st === 'stomp') return 4;
    if (st === 'strike') return 5;
    if (st === 'peck') return 5;
    return 5;
  }

  // ---- pose reset ---------------------------------------------------------
  function restPose(actor, dt) {
    var g = actor.group;
    if (!g) return;
    // damp any leftover strike transforms back to rest
    _e = Math.min(1, dt * 10);
    g.rotation.x += (0 - g.rotation.x) * _e;
    g.rotation.z += (0 - g.rotation.z) * _e;
    if (g.scale.x !== 1) {
      g.scale.x += (1 - g.scale.x) * _e;
      g.scale.y += (1 - g.scale.y) * _e;
      g.scale.z += (1 - g.scale.z) * _e;
    }
    var head = findHead(g);
    if (head && head.userData._cbzRX !== undefined) {
      head.rotation.x += (head.userData._cbzRX - head.rotation.x) * _e;
    }
    // settle to the medium's rest height (ground on land, swim line in water)
    var gy = restY(actor, g.position.x, g.position.z);
    g.position.y += (gy - g.position.y) * _e;
  }

  // ---- flinch -------------------------------------------------------------
  function creatureFlinch(actor) {
    if (!actor || actor.dead) return;
    actor._flinchT = FLINCH_DUR;
    // jerk direction: straight back along current facing
    var g = actor.group;
    if (g) {
      actor._flinchH = -g.rotation.y; // +X-authored creature: recover world heading from yaw
    }
  }

  function creatureAnimateFlinch(actor, dt) {
    if (!actor || !actor.group) return;
    var t = actor._flinchT || 0;
    if (t <= 0) return;
    t -= dt;
    var g = actor.group;
    if (t <= 0) {
      actor._flinchT = 0;
      g.rotation.z = 0;
      // clear positional offset by settling: rest pose handles y; x/z offsets
      // were applied incrementally and are naturally small — no restore needed.
      return;
    }
    actor._flinchT = t;
    _amt = t / FLINCH_DUR; // 1 -> 0
    // sharp backward jerk (against facing), strongest at start, damping out
    var h = (actor._flinchH !== undefined) ? actor._flinchH : -g.rotation.y;
    var jerk = 2.2 * _amt * _amt * dt; // integrated backward slide
    g.position.x -= Math.cos(h) * jerk;
    g.position.z -= Math.sin(h) * jerk;
    // rotation.z shudder that damps as _flinchT runs out
    g.rotation.z = Math.sin(t * 55) * 0.22 * _amt;
    // slight recoil pitch
    g.rotation.x = -0.18 * _amt;
  }

  // ---- attack animation ---------------------------------------------------
  // p: 0..1 progress. h: heading toward target. reachHint: distance scale.
  function animateAttack(actor, style, p, h, reachHint, dt) {
    var g = actor.group;
    if (!g) return;
    var env = strikeEnv(p);           // 0..1..0 peaking at strike moment
    var wind = (p < STRIKE_AT) ? ease(p / STRIKE_AT) : 0; // windup ramp
    var cs = Math.cos(h), sn = Math.sin(h);
    var gy = restY(actor, g.position.x, g.position.z);
    var sc = actorScale(actor);
    var head = findHead(g);
    if (head && head.userData._cbzRX === undefined) head.userData._cbzRX = head.rotation.x;

    // forward offset applied as delta from last frame (allocation-free):
    // we track the previously applied lunge amount on the actor and adjust.
    var prevL = actor._lungeAmt || 0;
    var lunge = 0;   // desired forward displacement right now
    var yOff = 0;    // desired height above the rest line
    var pitch = 0, roll = 0, pulse = 1;
    // TRUE pitch for +X-forward bodies is rotation.Z (rotation.X rolls them).
    // The land styles have always written their "pitch" to rotation.x and the
    // read works, so they are left alone byte-for-byte; the aquatic styles,
    // which must genuinely nose up through the water, use this instead.
    var pitchZ = 0;

    switch (style) {
      case 'pounce':
        if (p < STRIKE_AT) {
          // crouch: dip down, pitch nose down, coil
          yOff = -0.25 * sc * wind;
          pitch = 0.25 * wind;
          lunge = -0.15 * sc * wind; // slight coil back
        } else {
          // LEAP: sin arc up + forward, landing on/near target at strike
          var lp = (p - STRIKE_AT) / (1 - STRIKE_AT); // 0..1 leap phase
          yOff = Math.sin(Math.min(lp * 2, 1) * Math.PI) * (0.9 * sc);
          lunge = reachHint * 0.8 * ease(Math.min(lp * 1.6, 1)) * (1 - ease(Math.max(0, lp - 0.6) / 0.4));
          pitch = -0.3 * (1 - lp); // nose up in flight, level on land
        }
        break;
      case 'maul':
        pitch = -0.3 * wind;                       // rear up slightly in windup
        lunge = reachHint * 0.55 * env;            // lunge forward
        if (p >= STRIKE_AT) roll = Math.sin(p * 60) * 0.3 * env; // shake at strike
        break;
      case 'gore':
        pitch = 0.45 * env;                        // drop the head (pitch fwd)
        if (head) head.rotation.x = head.userData._cbzRX + 0.5 * env;
        if (p < STRIKE_AT) lunge = -0.2 * sc * wind;      // gather back
        else {
          var gp = (p - STRIKE_AT) / (1 - STRIKE_AT);
          // hard THRUST forward at strike, then knock back on recover
          lunge = reachHint * 0.9 * Math.sin(Math.min(gp * 2, 1) * Math.PI * 0.5) * (1 - ease(Math.max(0, gp - 0.5) / 0.5) * 1.3);
        }
        break;
      case 'ram':
        // A real shoulder charge: head stays tucked through contact and the
        // whole mass accelerates forward. Unlike the generic gore jab this
        // carries THROUGH the strike instead of looking like a bite/nod.
        pitch = 0.26 + 0.24 * (p < STRIKE_AT ? wind : env);
        if (head) head.rotation.x = head.userData._cbzRX + 0.62 * (p < STRIKE_AT ? wind : Math.max(0.45, env));
        if (p < STRIKE_AT) {
          lunge = -0.12 * sc * wind;                    // plant and lower
          yOff = -0.05 * sc * wind;
        } else {
          var rp = (p - STRIKE_AT) / (1 - STRIKE_AT);
          // Fast step-function drive followed by a controlled recovery. The hit
          // callback owns the target's launch; this only moves the bison body.
          lunge = reachHint * 1.05 * ease(Math.min(1, rp * 3.2)) * (1 - ease(Math.max(0, rp - 0.62) / 0.38));
          yOff = Math.sin(Math.min(1, rp * 2.2) * Math.PI) * 0.07 * sc;
          roll = Math.sin(rp * Math.PI) * 0.035;
        }
        break;
      case 'stomp':
        if (p < STRIKE_AT) {
          pitch = -0.5 * wind;                     // rear back on hind legs
          yOff = 0.3 * sc * wind;
        } else {
          var sp2 = (p - STRIKE_AT) / (1 - STRIKE_AT);
          pitch = 0.25 * (1 - sp2);                // slam nose-down
          yOff = -0.2 * sc * Math.sin(Math.min(sp2 * 2, 1) * Math.PI); // downward dip
          lunge = reachHint * 0.4 * ease(Math.min(sp2 * 2, 1)) * (1 - ease(sp2));
          pulse = 1 + 0.06 * Math.sin(Math.min(sp2 * 3, 1) * Math.PI); // impact pop
        }
        break;
      case 'lunge':
        // THE RUSH FROM BELOW (sharks, orca, barracuda). Not a bite from a
        // standstill — a committed drive that the animal cannot call off. It
        // sinks and coils under the target line, then accelerates HARD with the
        // nose coming UP through contact and glides out the far side. The
        // acceleration is quadratic (not the smoothstep every land style uses)
        // because the tell is the sudden change of speed, and there is
        // deliberately almost no recovery arc: it does not rear back, it leaves.
        if (p < STRIKE_AT) {
          lunge = -0.18 * sc * wind;                   // gather
          yOff = -0.42 * sc * wind;                    // drop UNDER the target
          pitchZ = -0.24 * wind;                       // nose down while coiling
        } else {
          var up = (p - STRIKE_AT) / (1 - STRIKE_AT);  // 0..1 drive phase
          var accel = Math.min(1, up * up * 2.4);      // quadratic launch
          lunge = reachHint * 1.3 * accel * (1 - ease(Math.max(0, up - 0.62) / 0.38));
          yOff = (0.55 * sc) * Math.min(1, up * 1.8) * (1 - 0.35 * up);   // rises through the hit
          pitchZ = 0.5 * Math.sin(Math.min(1, up * 1.6) * Math.PI * 0.85);  // nose UP, then level
          roll = Math.sin(up * 9) * 0.12 * (1 - up);   // the body works as it drives
        }
        // the gape rides the same envelope — the jaw is wide at contact and
        // shuts on the far side. Owned by wildlife.js's shared swim rig.
        if (CBZ.swimJaw) { try { CBZ.swimJaw(actor, Math.min(1, env * 1.45)); } catch (e) {} }
        break;
      case 'peck':
        // quick repeated forward head-jabs: high-frequency nudges
        _amt = Math.max(0, Math.sin(p * Math.PI * 6));
        lunge = reachHint * 0.35 * _amt * env;
        pitch = 0.35 * _amt * env;
        if (head) head.rotation.x = head.userData._cbzRX + 0.6 * _amt * env;
        break;
      case 'strike':
        // snake: fast twitchy forward lunge then snap back
        if (p < STRIKE_AT) {
          lunge = -0.25 * sc * wind;               // coil back
          yOff = 0.15 * sc * wind;                 // raise up
          pitch = -0.2 * wind;
        } else {
          var kp = (p - STRIKE_AT) / (1 - STRIKE_AT);
          lunge = reachHint * 0.85 * (kp < 0.35 ? ease(kp / 0.35) : (1 - ease((kp - 0.35) / 0.65))); // snap out, snap back
          pitch = 0.3 * (kp < 0.35 ? kp / 0.35 : 1 - kp);
        }
        break;
      default: // 'bite' — simple forward head-dip lunge
        lunge = reachHint * 0.5 * env;
        pitch = 0.35 * env;                        // head-dip
        if (head) head.rotation.x = head.userData._cbzRX + 0.45 * env;
        break;
    }

    // apply lunge as a delta so position never drifts
    var dL = lunge - prevL;
    g.position.x += cs * dL;
    g.position.z += sn * dL;
    actor._lungeAmt = lunge;

    g.position.y = gy + yOff;
    g.rotation.x = (pitchZ !== 0) ? roll : pitch;      // aquatic: rotation.x is the ROLL
    if (pitchZ !== 0) g.rotation.z = pitchZ;           // ..and rotation.z is the true pitch
    else if (style === 'maul' || roll !== 0) g.rotation.z = roll;
    if (pulse !== 1) { g.scale.x = pulse; g.scale.y = pulse; g.scale.z = pulse; }
    else if (g.scale.x !== 1) { g.scale.x = g.scale.y = g.scale.z = 1; }

    // ---- THE BODY LAYER, the land sibling of the swimJaw call in 'lunge' -----
    // Everything above moves the GROUP. This moves the ANIMAL: predator_anim
    // discovers the leg columns and the lower jaw out of the gait rig every land
    // species already carries and poses them off the same progress p — so a maul
    // finally opens a mouth, a pounce finally crouches and a stomp finally rears.
    //
    // LAST, deliberately. The pose layer composes on top of whatever value it
    // finds (that is how it survives gaitAnimate's absolute per-frame writes),
    // so calling it before the g.rotation/g.position writes above would have
    // them stomp the pose in the same frame.
    //
    // k rides the strike envelope (saturated, so it holds through the middle of
    // the swing and only tapers at the two ends): the pose fades in with the
    // windup and is nearly back to rest by the recovery, which means the meshes
    // are already handed back to the gait before endAttack's hard release.
    if (CBZ.predatorPose) {
      try { CBZ.predatorPose(actor, style, p, Math.min(1, env * 1.6), dt); } catch (e) {}
    }
  }

  // ---- the seize hand-off --------------------------------------------------
  // Is this target the player? Callers hand us a reusable DECOY object whose
  // .pos IS CBZ.player.pos (wildlife.js's PT) precisely so the hot path never
  // allocates, so identity alone is not enough.
  function isPlayerTarget(t) {
    var P = CBZ.player;
    if (!P || !t) return false;
    return t === P || (!!P.pos && t.pos === P.pos);
  }

  // Where the victim is held: the front of the attacker's own geometry, in
  // GROUP-LOCAL units, discovered once and cached. Nothing is hand-tabled, so a
  // jackal and a megalodon run the identical line and both read correctly.
  function jawPoint(actor) {
    if (actor._jawL) return actor._jawL;
    var g = actor.group, out = { x: 1, y: 0.9, z: 0 };
    if (g && g.children) {
      var kids = g.children, bx = -1e9, by = 0, seen = false;
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        if (!c || !c.isMesh || !c.position) continue;
        if (c.position.x > bx) { bx = c.position.x; by = c.position.y; seen = true; }
      }
      if (seen) { out.x = bx; out.y = by; out.z = 0; }
    }
    actor._jawL = out;
    return out;
  }

  // Build (once per actor) the seize a MAUL offers on the player. This is the
  // block's second consumer: bears and wolves get "it has you" for one line.
  function maulSeizeOpts(attacker) {
    if (attacker._maulSeize) return attacker._maulSeize;
    var sp = attacker.species || {};
    var sc = actorScale(attacker);
    var label = String(sp.name || sp.id || 'animal').toLowerCase();
    attacker._maulSeize = {
      jaw: jawPoint(attacker),
      dps: Math.max(12, (sp.bite || 12) * 1.4),
      hold: 2.2 + Math.min(1.4, sc * 0.5),
      escape: 0.42,
      thrash: 1,
      style: creatureSeizeStyleFor(sp),
      cause: 'mauled by a ' + label,
    };
    return attacker._maulSeize;
  }

  // Returns true when the predator block took the hit (so we must NOT also run
  // opts.onHit — the seize owns the damage from here).
  function trySeize(attacker, target, opts, style) {
    if (!SEIZE_ON() || typeof CBZ.predatorSeize !== 'function') return false;
    var so = opts.seize;
    // AN EXPLICIT `false` IS A REFUSAL, NOT AN OMISSION. A rhino, a bison and a
    // viper commit as hard as anything here, but their commit ENDS at the
    // impact — predatorKit gives those archetypes `seize: false` on purpose.
    // Without this line the opportunistic roll below could still grab with a
    // bundle the caller never asked for; today only the style test happens to
    // stop it, which is coincidence, not safety.
    if (so === false) return false;
    if (!so) {
      if (style !== 'maul' || !isPlayerTarget(target)) return false;
      if (Math.random() >= MAUL_SEIZE_P) return false;
      so = maulSeizeOpts(attacker);
    }
    var victim = so.victim || (isPlayerTarget(target) ? CBZ.player : target);
    if (!victim) return false;
    try { return !!CBZ.predatorSeize(attacker, victim, so); } catch (e) { return false; }
  }

  // A BITE LEAVES A JAW PRINT. wounds.js stamps two opposing crescents of torn
  // punctures for melee:"bite"; the radius is derived from the attacker so
  // every present and future biter is correct for free — never special-cased.
  // Humanoid rigs only (bodyBite needs .char.skinSlots); the player has no
  // .char and gets damage + gore + the seize camera instead of a decal.
  // A TUSK IS A MOUTH TOO. bodyBite draws two opposing crescents of torn
  // punctures — which is exactly what a pair of tusks, a pair of horns or a
  // pair of antler tines leaves, and exactly what a boar goring a pedestrian
  // should show. The only thing that changes is the SPAN: a jaw is as wide as
  // the head, and a tusk pair is a fraction of it, so `gore` and `ram` pass a
  // narrowed radius through the same call rather than getting a second wound
  // system. (`stomp` is a hoof, not a paired point — it stays out.)
  var GORE_SPAN = 0.55;
  function biteWound(attacker, target, style) {
    if (typeof CBZ.bodyBite !== 'function') return;
    if (!target || !target.char || !target.pos) return;
    var g = attacker.group; if (!g) return;
    var sc = actorScale(attacker);
    var jaw = Math.max(0.12, Math.min(1.2, 0.10 + sc * 0.16));
    if (style === 'gore' || style === 'ram') jaw = Math.max(0.10, jaw * GORE_SPAN);
    var sev = (style === 'lunge') ? 0.95 : (style === 'maul') ? 0.8 : (style === 'strike') ? 0.45
      : (style === 'gore' || style === 'ram') ? 0.75 : 0.6;
    try {
      _bp.x = target.pos.x; _bp.y = target.pos.y + 1.0; _bp.z = target.pos.z;
      _bo.jaw = jaw; _bo.sev = sev; _bo.sever = (style === 'lunge' && sc >= 1.6);
      _bo.fromX = g.position.x; _bo.fromZ = g.position.z;
      CBZ.bodyBite(target, _bp, _bo);
    } catch (e) {}
  }
  // module-scope scratch for biteWound (allocation-free hot path)
  var _bp = { x: 0, y: 0, z: 0 };
  var _bo = { jaw: 0.22, sev: 0.7, sever: false, fromX: 0, fromZ: 0 };

  function endAttack(actor) {
    // remove any residual lunge offset so repeated attacks don't drift
    var g = actor.group;
    var prevL = actor._lungeAmt || 0;
    if (g && prevL !== 0) {
      var h = -g.rotation.y;
      g.position.x -= Math.cos(h) * prevL;
      g.position.z -= Math.sin(h) * prevL;
    }
    actor._lungeAmt = 0;
    actor._atkAnim = -1;
    // hand the body layer back to the gait in one pass: k<=0 restores every
    // discovered leg/jaw offset to its authored base. Without this a strike that
    // ends on a non-zero pose (a pounce's extension, a stomp's forefoot) would
    // freeze that limb until the next attack happened to move it again. Cheap
    // when nothing is applied — the rig latches itself off and returns.
    if (CBZ.predatorPose) {
      try { CBZ.predatorPose(actor, actor._atkStyle, 1, 0, 0); } catch (e) {}
    }
  }

  // ---- main driver ---------------------------------------------------------
  function creatureFight(attacker, target, dt, opts) {
    RES.inRange = false;
    RES.dealt = 0;
    try {
      if (!attacker || !target || !attacker.group || !dt) return RES;
      opts = opts || attacker._atkOpts0 || (attacker._atkOpts0 = {});
      var g = attacker.group;

      // dead guard: idle, ease to rest
      if (attacker.dead || target.dead) {
        if (attacker._atkAnim !== undefined && attacker._atkAnim >= 0) endAttack(attacker);
        restPose(attacker, dt);
        return RES;
      }

      // advance own flinch so a mid-fight hit still reads
      if (attacker._flinchT > 0) creatureAnimateFlinch(attacker, dt);

      var sp = attacker.species;
      var aScale = actorScale(attacker), tScale = actorScale(target);
      var speed = (typeof opts.speed === 'number') ? opts.speed : speedFor(sp);
      var reach = (typeof opts.reach === 'number') ? opts.reach : (1.6 + aScale + tScale);
      var rate = (typeof opts.rate === 'number') ? opts.rate : DEFAULT_RATE;
      var style = opts.style || attacker._atkStyle || creatureStyleFor(sp);
      attacker._atkStyle = style;

      var tp = target.pos || (target.group && target.group.position);
      if (!tp) return RES;

      _dx = tp.x - g.position.x;
      _dz = tp.z - g.position.z;
      _dist = Math.sqrt(_dx * _dx + _dz * _dz);

      // FACE: turn heading toward target
      if (_dist > 0.001) {
        _h = Math.atan2(_dz, _dx);
        var cur = (typeof attacker.heading === 'number') ? attacker.heading : -g.rotation.y;
        var diff = shortestAngle(_h - cur);
        var maxTurn = TURN_RATE * dt;
        if (diff > maxTurn) diff = maxTurn; else if (diff < -maxTurn) diff = -maxTurn;
        cur += diff;
        attacker.heading = cur;
        if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(attacker, cur);
        else g.rotation.y = -cur;
        _h = cur; // heading actually used this frame
      } else {
        _h = (typeof attacker.heading === 'number') ? attacker.heading : -g.rotation.y;
      }

      // scratch init
      if (attacker._atkT === undefined) attacker._atkT = rate * (0.3 + Math.random() * 0.5);
      if (attacker._atkAnim === undefined) attacker._atkAnim = -1;

      var animating = attacker._atkAnim >= 0;

      if (animating) {
        // advance strike animation
        RES.inRange = _dist <= reach * 1.5;
        _p = attacker._atkAnim + dt / STRIKE_DUR;
        // strike moment: crossed STRIKE_AT this frame -> deal damage
        if (attacker._atkAnim < STRIKE_AT && _p >= STRIKE_AT && _dist <= reach * 1.6) {
          var dmg = (typeof opts.dmg === 'number') ? opts.dmg : ((sp && sp.bite) || 12);
          // THE SEIZE takes precedence over the hit: if the block accepts, it
          // owns the damage, the camera and the death from here. Anything else
          // — flag off, no block loaded, refused (already holding someone) —
          // falls through to the ordinary strike exactly as before.
          if (!trySeize(attacker, target, opts, style)) {
            if (style === 'bite' || style === 'maul' || style === 'strike' || style === 'lunge' ||
                style === 'gore' || style === 'ram') {
              biteWound(attacker, target, style);
            }
            if (typeof opts.onHit === 'function') {
              opts.onHit(dmg);
            } else {
              target.hp -= dmg;
              creatureFlinch(target);
              if (target.hp <= 0 && typeof opts.onDown === 'function') opts.onDown();
            }
            RES.dealt = dmg;
          } else {
            // the seize consumed the strike and owns the damage from here.
            // Reporting `dealt` for damage nobody applied is a latent lie for
            // the first caller that ever reads it.
            RES.dealt = 0;
          }
          RES.inRange = true;
        }
        if (_p >= 1) {
          endAttack(attacker);
          restPose(attacker, dt);
        } else {
          attacker._atkAnim = _p;
          animateAttack(attacker, style, _p, _h, Math.min(reach, _dist), dt);
        }
        return RES;
      }

      // not mid-attack: cooldown ticks always
      if (attacker._atkT > 0) attacker._atkT -= dt;

      if (_dist > reach) {
        // APPROACH: move toward target, feet on ground.
        //
        // THE LOCOMOTION HOOK (opts.move). Writing g.position raw here is only
        // correct for something that walks on floorAt: it has no water mask, no
        // shore clearance and no seabed test, so an aquatic caller whose own
        // mover had ALREADY been run this frame got shoved a second time,
        // straight at the beach, and had its Y snapped to restY() while its
        // swim depth was easing somewhere else entirely. When the caller
        // supplies opts.move(actor, dx, dz, step, dt) — a unit direction and a
        // step in metres — that mover does the translation AND owns the
        // vertical: we do not touch g.position.y at all.
        //
        // NO opts.move => the original three lines, byte for byte. Every land
        // creature in the game is on that path and is unchanged.
        var step = speed * dt;
        if (step > _dist - reach * 0.7) step = _dist - reach * 0.7;
        var hasMove = (typeof opts.move === 'function');
        if (step > 0 && _dist > 0.001) {
          if (hasMove) {
            try { opts.move(attacker, _dx / _dist, _dz / _dist, step, dt); } catch (e) {}
          } else {
            g.position.x += (_dx / _dist) * step;
            g.position.z += (_dz / _dist) * step;
          }
        }
        if (!hasMove) {
          g.position.y = restY(attacker, g.position.x, g.position.z);
          // slight run-bob for life (only when actually moving)
          if (step > 0.0005) {
            attacker._runPh = (attacker._runPh || 0) + dt * speed * 2.2;
            g.position.y += Math.abs(Math.sin(attacker._runPh)) * 0.08 * aScale;
          }
        }
        if (attacker._flinchT <= 0 || attacker._flinchT === undefined) {
          // keep pitch/roll settling while running (flinch owns them otherwise)
          _e = Math.min(1, dt * 8);
          g.rotation.x += (0 - g.rotation.x) * _e;
          g.rotation.z += (0 - g.rotation.z) * _e;
        }
        RES.inRange = false;
        return RES;
      }

      // in range
      RES.inRange = true;
      if (attacker._atkT <= 0) {
        // begin an attack
        attacker._atkT = rate * (0.9 + Math.random() * 0.25);
        attacker._atkAnim = 0;
        attacker._lungeAmt = 0;
        animateAttack(attacker, style, 0, _h, Math.min(reach, _dist), dt);
      } else {
        // waiting between attacks: ease back to rest pose
        restPose(attacker, dt);
      }
      return RES;
    } catch (e) {
      RES.inRange = false;
      RES.dealt = 0;
      return RES;
    }
  }

  // ---- expose --------------------------------------------------------------
  CBZ.creatureFight = creatureFight;
  CBZ.creatureFlinch = creatureFlinch;
  CBZ.creatureAnimateFlinch = creatureAnimateFlinch;
  CBZ.creatureStyleFor = creatureStyleFor;
  CBZ.creatureSeizeStyleFor = creatureSeizeStyleFor;
  CBZ.creatureJawPoint = jawPoint;      // group-LOCAL hold point, cached per actor
  CBZ.creatureRestY = restY;            // medium-aware rest height (land or water)
  // CANCEL A SWING IN FLIGHT, cleanly. Exported because this file is the only
  // one that can: it owns `_lungeAmt` (the un-applied forward offset), `_atkAnim`
  // and the predatorPose hand-back, and a caller that abandons an attacker
  // mid-animation without them leaves the body permanently pitched, the pose
  // latched and the next swing's first frame yanking backwards by a stale
  // offset. predator.js's break-off is the first consumer; anything that yanks
  // an attacker out of a fight (a tame, a teleport, a mode change) is the next.
  CBZ.creatureEndAttack = function (actor) {
    if (!actor || !(actor._atkAnim >= 0)) return false;
    endAttack(actor);
    return true;
  };

  // ---- the predator block's ratchet ---------------------------------------
  // We DID migrate: trySeize() gives every style the opts.seize seam and opts
  // `maul` in on the player by itself. Only this file can honestly say so, so
  // it says so here rather than letting predator.js guess from the outside
  // (its old source-sniffing probe read this file's `trySeize` and concluded
  // the opposite). The `else` buffers the id when predator.js has not loaded
  // yet, so script order in index.html cannot change the count.
  if (typeof CBZ.predatorAdopt === 'function') {
    try { CBZ.predatorAdopt('creature_combat:seize-seam'); } catch (e) {}
  } else {
    try {
      CBZ._predatorAdopted = CBZ._predatorAdopted || [];
      CBZ._predatorAdopted.push('creature_combat:seize-seam');
    } catch (e) {}
  }
})();
