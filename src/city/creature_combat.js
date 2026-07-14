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
// Everything eases back to the rest pose (pitch/roll/offset -> 0, feet on the
// ground via CBZ.floorAt) between attacks so the mesh never drifts.
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

  // ---- tuning ----------------------------------------------------------
  var STRIKE_DUR = 0.4;      // seconds for one attack animation
  var STRIKE_AT = 0.45;      // point in 0..1 progress where damage lands
  var DEFAULT_RATE = 1.1;    // seconds between attacks
  var FLINCH_DUR = 0.28;     // seconds of hit recoil
  var TURN_RATE = 6.0;       // rad/s facing turn speed

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
    if (/cat|leopard|cheetah|lion|tiger|panther|jaguar|cougar|puma|lynx/.test(id)) return 'pounce';
    if (/wolf|dog|coyote|fox|bear|hyena/.test(id)) return 'maul';
    if (/rhino|bison|boar|bull|moose|elephant|buffalo/.test(id)) return 'gore';
    if (/horse|deer|goat|elk|donkey|mule|ram/.test(id)) return 'stomp';
    if (/bird|hawk|eagle|crow|raven|gull|owl|vulture|chicken|rooster|ostrich/.test(id) || species.bird) return 'peck';
    if (/snake|viper|cobra|python|rattler/.test(id)) return 'strike';
    return 'bite';
  }

  function speedFor(species) {
    var st = creatureStyleFor(species);
    if (st === 'pounce') return 7;
    if (st === 'maul') return (/bear/.test(String(species && (species.id || species.name) || '').toLowerCase())) ? 4.5 : 6;
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
    // settle to ground
    var gy = groundAt(g.position.x, g.position.z);
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
    var gy = groundAt(g.position.x, g.position.z);
    var sc = actorScale(actor);
    var head = findHead(g);
    if (head && head.userData._cbzRX === undefined) head.userData._cbzRX = head.rotation.x;

    // forward offset applied as delta from last frame (allocation-free):
    // we track the previously applied lunge amount on the actor and adjust.
    var prevL = actor._lungeAmt || 0;
    var lunge = 0;   // desired forward displacement right now
    var yOff = 0;    // desired height above ground
    var pitch = 0, roll = 0, pulse = 1;

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
    g.rotation.x = pitch;
    if (style === 'maul' || roll !== 0) g.rotation.z = roll;
    if (pulse !== 1) { g.scale.x = pulse; g.scale.y = pulse; g.scale.z = pulse; }
    else if (g.scale.x !== 1) { g.scale.x = g.scale.y = g.scale.z = 1; }
  }

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
          if (typeof opts.onHit === 'function') {
            opts.onHit(dmg);
          } else {
            target.hp -= dmg;
            creatureFlinch(target);
            if (target.hp <= 0 && typeof opts.onDown === 'function') opts.onDown();
          }
          RES.dealt = dmg;
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
        // APPROACH: move toward target, feet on ground
        var step = speed * dt;
        if (step > _dist - reach * 0.7) step = _dist - reach * 0.7;
        if (step > 0 && _dist > 0.001) {
          g.position.x += (_dx / _dist) * step;
          g.position.z += (_dz / _dist) * step;
        }
        g.position.y = groundAt(g.position.x, g.position.z);
        // slight run-bob for life (only when actually moving)
        if (step > 0.0005) {
          attacker._runPh = (attacker._runPh || 0) + dt * speed * 2.2;
          g.position.y += Math.abs(Math.sin(attacker._runPh)) * 0.08 * aScale;
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
})();
