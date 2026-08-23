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
// stylized transform of the WHOLE group over a short strike window (0.4 s for
// the legacy land/default grammar; aquatic bites use the longer measured
// expansion/compression/recovery cadence published below),
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
// THE BITE CONNECTS, AND THE BITE BLEEDS (jawReaches / biteBlood). Two faults
// lived in the strike frame below and both of them made a maul read as a shove:
//   1. damage landed on a CENTRE-TO-CENTRE range test (`_dist <= reach*1.6`),
//      and `reach` on a lion is metres — so the jaws closed on air and a man
//      two and a half metres away took the hit. jawReaches() asks instead where
//      the animal's OWN teeth are at the frame they close (creatureJawWorld)
//      and whether that point is inside the victim's body. A short bite MISSES
//      (RES.missed), re-arms fast and closes the last step. This is the animal
//      sibling of the survival brawl's "punch lands on real fist contact, not
//      at click range". Flag: CREATURE_JAW_CONTACT.
//   2. a bite drew no blood anywhere in this game — only a decal, and only on
//      humanoid rigs. biteBlood() fires systems/gore.js's CBZ.goreImpact from
//      the jaw point along the bite line, with the same restraint the disaster
//      island's beatings earn through systems/trauma.js (mist only on a real
//      crunch, a ground pool only once the skin is open) and the same
//      escalation (a body worried repeatedly opens further). Flag:
//      CREATURE_BITE_BLOOD.
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

  // ---- feature flags: the one-line reverts ------------------------------
  // (declared here, not in config.js — every agent declares its own default)
  var CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.CREATURE_SEIZE == null) CFG.CREATURE_SEIZE = true;
  // THE JAW HAS TO ARRIVE. See jawReaches() — damage lands on real tooth
  // contact rather than on a centre-to-centre range test.
  if (CFG.CREATURE_JAW_CONTACT == null) CFG.CREATURE_JAW_CONTACT = true;
  // A BITE BLEEDS. See biteBlood() — the spray, the mist and the pool the
  // disaster island's punches already earn, fired from the teeth.
  if (CFG.CREATURE_BITE_BLOOD == null) CFG.CREATURE_BITE_BLOOD = true;
  function SEIZE_ON() { return CFG.CREATURE_SEIZE !== false; }
  function CONTACT_ON() { return CFG.CREATURE_JAW_CONTACT !== false; }
  function BLOOD_ON() { return CFG.CREATURE_BITE_BLOOD !== false; }

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
  // `missed` is the jaw-contact gate's verdict: the animal committed to a
  // strike and the teeth did not arrive. Read it immediately like the rest.
  var RES = { inRange: false, dealt: 0, missed: false };

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

  // ---- THE BITE CURVE (docs/SHARK-REFERENCE.md §6) --------------------------
  // A real bite is ASYMMETRIC, but it is still a SEQUENCE somebody can read:
  // expansion, a held full gape through contact, compression, then recovery.
  // The previous 0.10/.38/.58/.70 curve spent only 12% of the swing closing;
  // on the mounted shark's 0.56 s clock that was 67 ms, effectively one snap.
  // High-speed shark kinematics put peak gape, prey seizure, jaw closure and
  // recovery in distinct beats. Keep those beats distinct here too.
  // Shared on CBZ so EVERY biter inherits the grammar instead of each species
  // shaping its own — the aquatic 'lunge' below uses it directly and
  // predator_anim.js feeds it to the land biters' maw layer.
  // One-line revert: CBZ.CONFIG.BITE_SNAP = false restores the old envelope.
  var BITE_OPEN_AT = 0.08, BITE_FULL_AT = 0.36, BITE_HOLD_TO = 0.56, BITE_SHUT_AT = 0.82;
  var AQUATIC_BITE_BASE_S = 0.86;
  function biteCurve(p) {
    if (CBZ.CONFIG && CBZ.CONFIG.BITE_SNAP === false) return Math.min(1, strikeEnv(p) * 1.45);
    if (p <= BITE_OPEN_AT || p >= BITE_SHUT_AT) return 0;
    if (p < BITE_FULL_AT) return ease((p - BITE_OPEN_AT) / (BITE_FULL_AT - BITE_OPEN_AT));
    if (p < BITE_HOLD_TO) return 1;
    var s = (p - BITE_HOLD_TO) / (BITE_SHUT_AT - BITE_HOLD_TO);
    return 1 - s * s;
  }
  CBZ.biteCurve = biteCurve;

  /* ONE AQUATIC BITE CLOCK. Wild sharks, Shark Sim's mounted animal, tamed
     aquatics and pod combat already share the same jaw and contact owners; the
     last duplicate was duration. Scale adds only a restrained amount of mass
     to the beat, while an actual ship bite gets another tenth of a second.
     This is not a species table: any authored aquatic biter inherits it. */
  function aquaticBiteDuration(actor, targetKind) {
    var sc = actorScale(actor);
    var d = AQUATIC_BITE_BASE_S + Math.max(-0.04, Math.min(0.14, (sc - 1) * 0.08));
    if (targetKind === 'ship') d += 0.10;
    return Math.max(0.82, Math.min(1.10, d));
  }
  CBZ.aquaticBiteDuration = aquaticBiteDuration;
  // Tooling and tests read the same declared beats the runtime uses; no copied
  // timing constants in a visual preset can quietly drift from production.
  CBZ.biteTimeline = {
    version: 2,
    openAt: BITE_OPEN_AT,
    fullAt: BITE_FULL_AT,
    holdTo: BITE_HOLD_TO,
    shutAt: BITE_SHUT_AT,
    aquaticBaseS: AQUATIC_BITE_BASE_S,
  };

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
    if (/wolf|dog|coyote|fox|bear|hyena|gorilla|ape/.test(id)) return 'maul';
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
  /* THE SCALE THE BODY WAS BUILT AT. Both the impact pulse below and the rest
     settle used to write ABSOLUTE scale values — `g.scale.x = pulse`, then
     `g.scale.x += (1 - g.scale.x) * e` — which quietly assumes every animal in
     the game is authored at 1. games/battle.html scales each beast group to
     its species' own `scale` (a silverback is 1.15), so the first swing any
     beast threw shrank it by fifteen percent and the settle held it there for
     the rest of the war. Nothing SAID it had happened: the animal was simply a
     bit smaller than the row it came from, forever, and the first thing to
     notice was a mass derivation reading 125 kg off a gorilla that should have
     measured 190. Captured once, before either writer runs. */
  function baseScale(actor, g) {
    if (!(actor._baseScale > 0)) actor._baseScale = (g && g.scale && g.scale.x > 0) ? g.scale.x : 1;
    return actor._baseScale;
  }

  function restPose(actor, dt) {
    var g = actor.group;
    if (!g) return;
    var bs = baseScale(actor, g);
    // damp any leftover strike transforms back to rest
    _e = Math.min(1, dt * 10);
    g.rotation.x += (0 - g.rotation.x) * _e;
    g.rotation.z += (0 - g.rotation.z) * _e;
    if (g.scale.x !== bs) {
      g.scale.x += (bs - g.scale.x) * _e;
      g.scale.y += (bs - g.scale.y) * _e;
      g.scale.z += (bs - g.scale.z) * _e;
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
    // YAW is normally nobody's business here — creatureFight sets it from the
    // heading every frame. One family of blows IS a yaw, though (an ape's
    // backhand is the body turning through the arm), so it is written as a
    // tracked OFFSET on top of whatever facing wrote: remembered and backed out
    // like `lunge`, so a frame where the face block does not run (target
    // exactly co-located) cannot accumulate it into a spin.
    var yawOff = 0;
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
        // THE GAPE IS THE BITE CURVE, not the strike envelope: readable
        // expansion, a held beat through contact, then compression (see biteCurve above —
        // §6's "equal-speed open and close reads as a puppet's mouth"). Owned
        // by wildlife.js's shared swim rig.
        if (CBZ.swimJaw) { try { CBZ.swimJaw(actor, biteCurve(p)); } catch (e) {} }
        // THE HEAD SHAKE ON CONTACT (§6: "the head shakes on contact"). As the
        // jaws slam home the whole animal worries the hit — a decaying roll +
        // yaw oscillation in the window right after the snap. Whole-group,
        // exactly the transform pattern the file header documents; for a rigid
        // +X-forward swimmer the group IS the head. Deterministic in p.
        var shakeT = (p - BITE_HOLD_TO) / 0.30;
        if (shakeT > 0 && shakeT < 1) {
          var shakeK = (1 - shakeT) * (1 - shakeT);
          roll += Math.sin(shakeT * 34) * 0.17 * shakeK;
          yawOff += Math.sin(shakeT * 25 + 1.3) * 0.09 * shakeK;
        }
        break;
      case 'bite_flank':
        /* THE FLANK BITE (the orca pod's pass, owner 2026-08-21: "it doesn't
           bite, it headbutts"). Same silhouette family as ram_flank — a pod
           member leaves its bearing, comes in ACROSS the quarry's beam and
           carries straight through — but the weapon is the MOUTH: the jaws
           ride the bite curve (readable expansion, held contact, compression),
           the bank is halved so the gape faces the flank instead of the sky,
           and the head worries the hit after the snap exactly like `lunge`.
           Contact honesty comes free: this style is NOT in jawReaches()'s
           exempt list, so the pass only scores when the teeth actually
           arrive, and setLungeCap() holds the drive so the teeth stop AT the
           quarry's surface instead of the two bodies passing through each
           other. */
        if (p < STRIKE_AT) {
          lunge = -0.16 * sc * wind;                     // gather off the beam
          roll = -0.14 * wind;                           // a shallow wind-up bank
          pitchZ = -0.08 * wind;
        } else {
          var bp = (p - STRIKE_AT) / (1 - STRIKE_AT);    // 0..1 drive phase
          var bdrive = Math.min(1, bp * bp * 2.8);       // same quadratic launch
          lunge = reachHint * 1.15 * bdrive * (1 - ease(Math.max(0, bp - 0.7) / 0.3));
          roll = 0.20 * Math.sin(Math.min(1, bp * 1.5) * Math.PI * 0.9);
          pitchZ = 0.10 * Math.sin(Math.min(1, bp * 2) * Math.PI);
          yOff = 0.12 * sc * Math.sin(Math.min(1, bp * 2.2) * Math.PI);
        }
        if (CBZ.swimJaw) { try { CBZ.swimJaw(actor, biteCurve(p)); } catch (e) {} }
        var bShakeT = (p - BITE_HOLD_TO) / 0.30;
        if (bShakeT > 0 && bShakeT < 1) {
          var bShakeK = (1 - bShakeT) * (1 - bShakeT);
          roll += Math.sin(bShakeT * 34) * 0.15 * bShakeK;
          yawOff += Math.sin(bShakeT * 25 + 1.3) * 0.08 * bShakeK;
        }
        break;
      case 'ram_flank':
        /* THE FLANK RAM (city/marine_predation.js's orca pod). `lunge` is a
           bite from below with the mouth open; this is the opposite blow and
           it needed to be a separate silhouette or the pod read as four
           sharks queueing. A pod member that is NOT the one committing comes
           in ACROSS the quarry's beam with its mouth SHUT, banks hard into
           the hit so the impact is shoulder-and-melon rather than teeth, and
           carries straight through and out the far side.

           Three things make it read as a body blow instead of a bite:
             * the jaw stays closed for the whole pass (the swimJaw write is
               an explicit 0 — without it the mouth holds whatever the last
               style left it at);
             * the bank is a real ROLL that peaks AT contact and unwinds on
               the way out, which is the thing you actually see from a boat;
             * there is almost no recovery — like `lunge`, it does not rear
               back, it leaves. A ram that pulls up short reads as a bump. */
        if (p < STRIKE_AT) {
          lunge = -0.14 * sc * wind;                     // gather off the beam
          roll = -0.30 * wind;                           // bank AWAY, winding up
          pitchZ = -0.10 * wind;
        } else {
          var fp = (p - STRIKE_AT) / (1 - STRIKE_AT);    // 0..1 drive phase
          var drive = Math.min(1, fp * fp * 2.8);        // same quadratic launch
          lunge = reachHint * 1.15 * drive * (1 - ease(Math.max(0, fp - 0.7) / 0.3));
          roll = 0.46 * Math.sin(Math.min(1, fp * 1.5) * Math.PI * 0.9);  // roll INTO it
          pitchZ = 0.16 * Math.sin(Math.min(1, fp * 2) * Math.PI);
          yOff = 0.18 * sc * Math.sin(Math.min(1, fp * 2.2) * Math.PI);
          pulse = 1 + 0.035 * Math.sin(Math.min(fp * 3, 1) * Math.PI);
        }
        if (CBZ.swimJaw) { try { CBZ.swimJaw(actor, 0); } catch (e) {} }
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
      /* ---- THE APE FAMILY (systems/ape_combat.js owns which one is thrown and
         who pays for it; this owns where the BODY goes). Every one of these is
         a knuckle-walker's real mechanic rather than a quadruped's bite:

           ape_charge  the quadrupedal rush. It does not stop at contact — a
                       silverback's charge carries through, which is why the
                       damage fan is a line and not a point.
           ape_smash   rear onto the hind legs, both forearms hammer DOWN. The
                       rear-up is the tell you get a beat to read.
           ape_sweep   the backhand. The arm is 1.2 m long and the power is the
                       BODY turning behind it, so this is the one blow that
                       writes a yaw; `_apeSide` alternates it left/right.
           ape_grab    a short, low, committed reach — the arm goes UNDER the
                       man, not at him. On contact the hold takes over and the
                       group transform stops being ours entirely.
           ape_bite    the canines. Head-dip, like every biter, but harder and
                       shorter — this animal's mouth is a finisher, not an
                       opener.
           ape_drum    the chest beat. Reared, planted, no travel at all: the
                       whole point is that it goes nowhere and still works. */
      case 'ape_charge':
        if (p < STRIKE_AT) { pitch = 0.20 * wind; yOff = -0.10 * sc * wind; lunge = -0.18 * sc * wind; }
        else {
          var cp = (p - STRIKE_AT) / (1 - STRIKE_AT);
          lunge = reachHint * 1.25 * ease(Math.min(1, cp * 3.0)) * (1 - ease(Math.max(0, cp - 0.68) / 0.32));
          pitch = 0.30 * Math.sin(Math.min(1, cp * 2) * Math.PI * 0.7);
          yOff = Math.sin(Math.min(1, cp * 2.2) * Math.PI) * 0.10 * sc;
          roll = Math.sin(cp * 11) * 0.09 * (1 - cp);
        }
        break;
      case 'ape_smash':
        if (p < STRIKE_AT) { pitch = -0.72 * wind; yOff = 0.42 * sc * wind; lunge = -0.12 * sc * wind; }
        else {
          var mp = (p - STRIKE_AT) / (1 - STRIKE_AT);
          var fall = ease(Math.min(1, mp * 2.3));
          pitch = -0.72 * (1 - fall) + 0.34 * fall;          // the hammer comes over
          yOff = 0.42 * sc * (1 - fall) - 0.10 * sc * Math.sin(Math.min(1, mp * 2.6) * Math.PI);
          lunge = reachHint * 0.45 * fall * (1 - ease(Math.max(0, mp - 0.6) / 0.4));
          pulse = 1 + 0.07 * Math.sin(Math.min(1, mp * 2.6) * Math.PI);
        }
        break;
      case 'ape_sweep':
        var sw = actor._apeSide || 1;
        if (p < STRIKE_AT) { yawOff = sw * 0.62 * wind; pitch = -0.16 * wind; lunge = -0.10 * sc * wind; }
        else {
          var wp = (p - STRIKE_AT) / (1 - STRIKE_AT);
          var whip = ease(Math.min(1, wp * 2.2));
          yawOff = sw * (0.62 - 1.30 * whip) * (1 - ease(Math.max(0, wp - 0.7) / 0.3));
          lunge = reachHint * 0.35 * whip * (1 - ease(Math.max(0, wp - 0.55) / 0.45));
          roll = -sw * 0.16 * whip;
        }
        break;
      case 'ape_grab':
        if (p < STRIKE_AT) { pitch = 0.18 * wind; yOff = -0.16 * sc * wind; lunge = -0.08 * sc * wind; }
        else {
          var gr = (p - STRIKE_AT) / (1 - STRIKE_AT);
          lunge = reachHint * 0.80 * ease(Math.min(1, gr * 2.6)) * (1 - ease(Math.max(0, gr - 0.5) / 0.5));
          pitch = 0.18 - 0.40 * ease(Math.min(1, gr * 1.8));   // straightens up with the load
          yOff = -0.16 * sc * (1 - gr) + 0.16 * sc * gr;
        }
        break;
      case 'ape_bite':
        lunge = reachHint * 0.55 * env;
        pitch = 0.42 * env;
        if (head) head.rotation.x = head.userData._cbzRX + 0.55 * env;
        break;
      case 'ape_drum':
        // planted and reared; the only travel is the chest heaving under the
        // fists, which reads as a fast double bounce on the body pitch
        pitch = -0.50 * Math.min(1, p * 2.6) * (1 - ease(Math.max(0, p - 0.72) / 0.28));
        yOff = 0.34 * sc * Math.min(1, p * 2.6) * (1 - ease(Math.max(0, p - 0.72) / 0.28));
        pulse = 1 + 0.035 * Math.max(0, Math.sin(p * Math.PI * 7));
        break;

      default: // 'bite' — simple forward head-dip lunge
        lunge = reachHint * 0.5 * env;
        pitch = 0.35 * env;                        // head-dip
        if (head) head.rotation.x = head.userData._cbzRX + 0.45 * env;
        break;
    }

    // apply lunge as a delta so position never drifts. _lungeCap is
    // setLungeCap()'s body-stops-at-body limit for the committed water
    // styles; null everywhere else.
    if (actor._lungeCap != null && lunge > actor._lungeCap) lunge = actor._lungeCap;
    var dL = lunge - prevL;
    g.position.x += cs * dL;
    g.position.z += sn * dL;
    actor._lungeAmt = lunge;

    // the same delta discipline for the yaw an ape's backhand writes
    var prevY = actor._yawOff || 0;
    if (yawOff !== 0 || prevY !== 0) { g.rotation.y += yawOff - prevY; actor._yawOff = yawOff; }

    g.position.y = gy + yOff;
    g.rotation.x = (pitchZ !== 0) ? roll : pitch;      // aquatic: rotation.x is the ROLL
    if (pitchZ !== 0) g.rotation.z = pitchZ;           // ..and rotation.z is the true pitch
    else if (style === 'maul' || roll !== 0) g.rotation.z = roll;
    // the impact pop is a MULTIPLIER on the body's authored size, not a
    // replacement for it — see baseScale()
    var bsA = baseScale(actor, g);
    if (pulse !== 1) { g.scale.x = g.scale.y = g.scale.z = bsA * pulse; }
    else if (g.scale.x !== bsA) { g.scale.x = g.scale.y = g.scale.z = bsA; }

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
    // Authored aquatic mouths publish the point at the front-centre of their
    // actual tooth ring. Prefer that contract over the legacy "farthest direct
    // mesh" guess, which cannot see nested hinged jaw groups and could put
    // damage out at the snout while the visible mouth closed somewhere else.
    var mouth = g && g.userData && g.userData.aquaticMouth;
    if (mouth && mouth.bite) {
      out.x = mouth.bite.x; out.y = mouth.bite.y; out.z = mouth.bite.z || 0;
    } else if (g && g.children) {
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

  // ==========================================================================
  //  WHERE THE TEETH ACTUALLY ARE — and whether they got there.
  // ==========================================================================
  // jawPoint() answers in GROUP-LOCAL units. Everything below needs the same
  // point in the world, because "did it bite you" is a question about metres of
  // ground, not about a model's coordinate frame. One reused vector, no
  // allocation: applyEuler goes through THREE's own module-scope quaternion and
  // honours the group's rotation ORDER, which matters — a corpse or a rolling
  // predator may be on 'YXZ'.
  var _jw = new THREE.Vector3();
  function jawWorld(actor) {
    var g = actor && actor.group;
    if (!g) return null;
    var jl = jawPoint(actor);
    _jw.set(jl.x, jl.y, jl.z);
    if (g.scale) _jw.multiply(g.scale);        // the species' own build scale
    _jw.applyEuler(g.rotation).add(g.position);
    return _jw;
  }

  // How wide is the thing being bitten, as a circle on the ground? Callers who
  // measured their own body (games/battle.html measures every animal's box)
  // publish `rad`; anything else is derived from its scale the same way the
  // default reach is. Never a species table.
  function bodyRadius(t) {
    if (t && typeof t.rad === 'number' && t.rad > 0) return t.rad;
    return 0.42 + actorScale(t) * 0.45;
  }

  /* THE BODY STOPS AT THE BODY (owner, 2026-08-21: the orca "overlaps instead
     of colliding with the shape of sharks"). The committed water styles carry
     the whole animal forward by up to 1.3x reach; on land-sized reaches that
     was centimetres, but a 7 m orca driving at an 11 m megalodon buried
     itself to the dorsal fin inside the thing it was hitting. The cap holds
     the pose so the attacker's own TEETH stop a shade inside the victim's
     surface — a tooth's worth of penetration is the grip — and everything
     behind the teeth therefore stays outside the body. Same law during the
     run-in (the approach branch below). Reverts with the bite-pass flag,
     because the before/after preset's BEFORE column has to be able to
     reproduce the old drive-through. */
  function bitePassOn() {
    if (typeof location !== 'undefined' && location.search &&
        /(^|[?&])bitepass=off(&|$)/.test(location.search)) return false;
    return !(CBZ.CONFIG && CBZ.CONFIG.MARINE_BITE_PASS === false);
  }
  function marineCommitted(style) {
    return style === 'lunge' || style === 'ram_flank' || style === 'bite_flank';
  }
  // The victim's surface, as the caller measured it. bodyRadius()'s scale
  // guess is fine for a man or a wolf and off by a metre on a megalodon —
  // whose real half-beam the marine callers have measured off the named hull
  // mesh — so a caller that knows better says so in opts.targetRad.
  function targetRadFor(target, opts) {
    if (opts && opts.targetRad > 0) return opts.targetRad;
    return bodyRadius(target);
  }
  function setLungeCap(attacker, target, style, tp, opts) {
    if (marineCommitted(style) && bitePassOn()) {
      var J = jawWorld(attacker);
      if (J) {
        var jx = tp.x - J.x, jz = tp.z - J.z;
        attacker._lungeCap = Math.max(0, (attacker._lungeAmt || 0) +
          Math.sqrt(jx * jx + jz * jz) - targetRadFor(target, opts));
        return;
      }
    }
    attacker._lungeCap = null;
  }

  /* DID THE BITE REACH? — the tooth-contact gate.

     The strike used to land whenever the two CENTRES were inside reach*1.6 at
     the strike frame, and `reach` on a big animal is several metres: a lion
     opened its mouth two and a half metres from a man's chest, the damage
     applied, and the blood appeared on a body nothing had touched. That is the
     same fault the survival brawl had before "punch/shove land on real fist
     contact, not at click range" — a click-range hit dressed as an animation.

     So the test is now the one the picture makes: take the attacker's OWN jaw
     point, in the world, at the frame the jaws close, and ask whether it is
     inside the victim's body. TOL is deliberately generous — a low-poly snout
     is a box, a body is a circle, and neither is the creature — but it is a
     fixed hand's breadth plus a fraction of the biter, not a free three metres.

     Two styles are exempt because their weapon is not the mouth: `stomp` lands
     with a forefoot and `ram` with a shoulder, so their contact is the body's,
     and gating them on the snout would make a horse that kicks you miss.

     THE TOLERANCE IS THE CALLER'S OWN REACH, and it has to be — the first
     version derived it from the attacker's scale alone and that quietly broke
     two whole shelves of the bestiary. Not every style carries its lunge INTO
     the strike frame: `bite` peaks its forward offset exactly at STRIKE_AT
     (env = 1), but `pounce` and `strike` are measured from the START of their
     leap/snap phase, so at the damage frame their offset is still ~0 and the
     jaw is a whole body-length short of where the animation ends up. A snake
     would have missed every bite it ever threw. `reach` is the one number the
     caller has already stated for this pairing ("this animal can hit from
     here"), so the gate is anchored at the TEETH and sized by it, which still
     roughly halves the old window (jaw + 0.42·reach against centre + 1.6·reach)
     without ever telling a species its own attack does not connect. */
  function jawReaches(attacker, target, style, tp, reach) {
    if (!CONTACT_ON()) return true;
    // `ram_flank` joins them for the same reason: an orca's flank pass
    // connects with the melon and the shoulder, and holding it to the
    // muzzle would score a hit you can plainly see as a miss.
    if (style === 'stomp' || style === 'ram' || style === 'ram_flank') return true;
    /* AN ARM IS NOT A JAW, and every ape style except the bite connects with
       one. The test below measures from the MOUTH — for a gorilla that is the
       nose, at model-local x = 1.48 — and asks whether the mark is within a
       body radius of it. A backhand's whole point is that it reaches a metre
       further than that and sweeps sideways; a charge connects with the
       shoulder and a grab goes under the man rather than at him. Held to the
       muzzle they would read as misses on contact they visibly made, and the
       re-arm below would loop the animal on a blow it kept "missing". The
       canines are the one ape move that IS a mouth, so `ape_bite` is
       deliberately absent from this list and answers to the test like every
       other biter. */
    if (style === 'ape_sweep' || style === 'ape_smash' ||
        style === 'ape_charge' || style === 'ape_grab' || style === 'ape_drum') return true;
    var J = jawWorld(attacker);
    if (!J) return true;
    var tol = bodyRadius(target) + Math.max(0.4, (reach || 2) * 0.42);
    var jx = tp.x - J.x, jz = tp.z - J.z;
    return (jx * jx + jz * jz) <= tol * tol;
  }

  /* ==========================================================================
     BLOOD FROM TEETH.

     THE REFERENCE, and it is a real one in this repo: systems/trauma.js already
     answers "what does a beating look like" for the disaster island — a blunt
     blow accrues on a ledger, and when it crosses the bar systems/gore.js's
     CBZ.goreImpact throws a directional spray, atomises a mist only on a real
     crunch, stains the ground only once the skin is genuinely open, and
     systems/wounds.js marks the body so the survivor carries it. Nothing in
     this game bled from a BITE. A bear closed its jaws on a man and the only
     evidence was a decal — which is why a maul read as a shove.

     This is that model with teeth in place of a fist:
       • the spray leaves the JAW, along the bite line, not from the victim's
         navel — the point jawReaches() just proved was in contact;
       • severity is the style (a shark's rush is not a magpie's peck) times the
         size of the animal doing it, so the 46th species is priced for free;
       • the ledger idea survives: a body worried by a pack opens further with
         each closing of the jaws, which is exactly the owner's "punch someone a
         bunch of times" applied to a wolf pack. It lives on the VICTIM as two
         numbers, decays, and costs nothing when nothing is biting.
     CBZ.CONFIG.CREATURE_BITE_BLOOD = false restores the decal-only behaviour. */
  var BITE_SEV = { lunge: 1.0, maul: 0.85, gore: 0.8, ram: 0.75, ram_flank: 0.55, pounce: 0.7, bite: 0.62, strike: 0.4, peck: 0.28, stomp: 0.5 };
  var LEDGER_DECAY = 0.09;      // units/s — a worrying counts, last minute's bite does not
  var LEDGER_MAX = 1.8;
  function biteBlood(attacker, target, style) {
    if (!BLOOD_ON() || typeof CBZ.goreImpact !== 'function') return;
    var J = jawWorld(attacker);
    if (!J) return;
    var tp = target.pos || (target.group && target.group.position);
    if (!tp) return;
    var sc = actorScale(attacker);
    // the bite LINE: from the animal's centre through its own teeth. That is
    // the direction the flesh tears along, and the axis gore.js fans the spray
    // and stamps a wall splat on.
    var g = attacker.group;
    var dx = J.x - g.position.x, dz = J.z - g.position.z;
    var dl = Math.sqrt(dx * dx + dz * dz);
    if (dl > 0.001) { dx /= dl; dz /= dl; } else { dx = 1; dz = 0; }

    var base = (BITE_SEV[style] != null ? BITE_SEV[style] : 0.6) * Math.min(1.7, 0.55 + sc * 0.55);
    // the ledger — a body being worried opens further every time.
    var now = (CBZ.now != null ? CBZ.now * 0.001 : (Date.now() * 0.001));
    var led = target._biteLedger || 0;
    var last = target._biteLedgerT;
    if (last != null) led = Math.max(0, led - LEDGER_DECAY * Math.max(0, now - last));
    led = Math.min(LEDGER_MAX, led + base * 0.55);
    target._biteLedger = led; target._biteLedgerT = now;

    var sev = Math.min(2, base + led * 0.5);
    // ONE EMISSION PER BITE, never per frame: creature_combat crosses
    // STRIKE_AT exactly once a swing, so this is called exactly once per
    // closing of the jaws by construction.
    _bd.x = dx; _bd.y = 0.18; _bd.z = dz;   // a bite tears slightly upward
    _bo2.dir = _bd;
    _bo2.amount = Math.max(0.35, Math.min(1.9, sev));
    _bo2.mist = sev > 0.85;                 // only a real crunch atomises anything
    _bo2.pool = sev > 0.6;                  // only an open wound stains the ground
    _bo2.player = !!(target.isPlayer || (CBZ.player && target === CBZ.player));
    _bo2.sfx = sev > 0.7 ? 'hit' : false;
    try { CBZ.goreImpact(J.x, J.y, J.z, _bo2); } catch (e) {}
  }
  // reused, so the hot path allocates nothing and gore.js keeps taking plain
  // data (opts.dir has never been a THREE type).
  var _bd = { x: 0, y: 0, z: 0 };
  var _bo2 = { dir: null, amount: 0.7, mist: false, pool: false, player: false, sfx: false };

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
    // the backhand's yaw offset is given back on the same terms as the lunge:
    // a swing abandoned mid-arc must not leave the body permanently turned
    if (g && actor._yawOff) { g.rotation.y -= actor._yawOff; actor._yawOff = 0; }
    actor._lungeAmt = 0;
    actor._lungeCap = null;
    actor._atkAnim = -1;
    // back to the shared clock, the shared weight and the caller's own style:
    // a per-move override lives for exactly one swing
    actor._atkDur = 0;
    actor._atkPow = 0;
    actor._apeStyle = null;
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
    RES.missed = false;
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

      /* AN APE WITH A MAN IN ITS HAND IS NOT TAKING ORDERS FROM THIS DRIVER.
         While a hold runs, systems/ape_combat.js owns the attacker's position,
         facing, pitch and pose outright, and it is ticked by the HOST (its own
         apeStep) precisely so the swing keeps going after the man in the hand
         is dead and this driver has stopped being called for him. Standing down
         here is the whole hand-off; with ape_combat absent the guard is false
         and nothing about this file changes. */
      if (CBZ.apeOwns && CBZ.apeOwns(attacker)) { RES.inRange = true; return RES; }

      // advance own flinch so a mid-fight hit still reads
      if (attacker._flinchT > 0) creatureAnimateFlinch(attacker, dt);

      var sp = attacker.species;
      var aScale = actorScale(attacker), tScale = actorScale(target);
      var speed = (typeof opts.speed === 'number') ? opts.speed : speedFor(sp);
      var reach = (typeof opts.reach === 'number') ? opts.reach : (1.6 + aScale + tScale);
      var rate = (typeof opts.rate === 'number') ? opts.rate : DEFAULT_RATE;
      /* THE APE'S CHOICE OUTRANKS THE CALLER'S STANDING STYLE, and it has to.
         city/wildlife.js and systems/predator.js both pin `opts.style` once
         (wildlife.js:2740, off creatureStyleFor) and hand the same bundle back
         every frame — which is exactly right for an animal with ONE attack, and
         wrong for the one animal with six: the picker's answer would survive a
         single frame and then be overwritten mid-swing, so the pose snapped from
         a charge to a maul on frame two and the strike moment resolved as the
         style nobody chose. `_apeStyle` is set at the top of a swing and lives
         for that swing only (endAttack clears it), so a host that pins a style
         still pins it for every other species in the bestiary. */
      var style = attacker._apeStyle || opts.style || attacker._atkStyle || creatureStyleFor(sp);
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
        /* PER-MOVE STRIKE CLOCK. `_atkDur` remains the explicit move override
           (ape_combat's repertoire uses it). Unset aquatic mouth attacks take
           the shared expansion/compression/recovery duration; every other
           existing style keeps the flat 0.4 s legacy clock. */
        var aquaticMouthStyle = !!(sp && sp.aquatic &&
          (style === 'lunge' || style === 'bite_flank'));
        var sdur = (attacker._atkDur > 0) ? attacker._atkDur
          : (aquaticMouthStyle ? aquaticBiteDuration(attacker, null) : STRIKE_DUR);
        _p = attacker._atkAnim + dt / sdur;
        // strike moment: crossed STRIKE_AT this frame -> deal damage
        if (attacker._atkAnim < STRIKE_AT && _p >= STRIKE_AT && _dist <= reach * 1.6) {
          var dmg = (typeof opts.dmg === 'number') ? opts.dmg : ((sp && sp.bite) || 12);
          // per-move weight, the damage sibling of `_atkDur`: an overhead
          // two-handed smash is not worth the same as a jab and only the thing
          // that CHOSE the move knows by how much. Unset = 1, i.e. every
          // existing style bills exactly what it always billed.
          if (attacker._atkPow > 0) dmg *= attacker._atkPow;
          /* THE APE'S EXTRA REACH. A backhand does not hit one man, it hits
             everyone the arm passes through, and a grab hits nobody and takes a
             body instead — neither fits `opts.onHit(dmg)`, which is a contract
             for ONE mark and one number.

             So ape_combat is asked first, and it answers one of two ways.
             A number means it consumed the strike outright (the grab, which
             hands the whole beat to a hold; the chest beat, which costs
             nothing on purpose). `null` — the common answer — means it has
             resolved the SPLASH on the bystanders and the primary mark is
             still the caller's to bill, which is the only shape that keeps
             `opts.onHit` intact. That matters more than it looks: in the city
             the caller's onHit IS the player's damage (wildlife.js's
             animalStrikePlayer), so an ape style that swallowed the strike
             would have made a gorilla completely harmless to the player. */
          var apeDealt = null;
          if (CBZ.apeStrike) {
            try { apeDealt = CBZ.apeStrike(attacker, target, style, opts, dmg); } catch (e) { apeDealt = null; }
          }
          if (apeDealt != null) {
            RES.dealt = apeDealt;
          /* THE JAWS HAVE TO ARRIVE. Everything above this line decided the
             animal committed to a bite; jawReaches() decides whether the bite
             CONNECTED, by asking where the teeth actually are at the frame they
             close. A miss is a real outcome — the snap on empty air you can see
             — and it must not cost the animal its whole cooldown, or a lion
             that lunged an inch short would stand there for a second doing
             nothing. It re-arms fast, closes the last step and tries again.
             Asked AFTER the ape seam on purpose: a move ape_combat consumed
             has already resolved (a grab is a hold, not a bite) and a splash
             it dealt to the bystanders stands whether or not the mark the
             driver was aiming at was reached. */
          } else if (!jawReaches(attacker, target, style, tp, reach)) {
            RES.missed = true;
            attacker._atkT = rate * 0.3;
          } else if (!trySeize(attacker, target, opts, style)) {
            // THE SEIZE takes precedence over the hit: if the block accepts, it
            // owns the damage, the camera and the death from here. Anything else
            // — flag off, no block loaded, refused (already holding someone) —
            // falls through to the ordinary strike exactly as before.
            if (style === 'bite' || style === 'maul' || style === 'strike' || style === 'lunge' ||
                style === 'gore' || style === 'ram' || style === 'ram_flank' ||
                style === 'bite_flank' || style === 'ape_bite') {
              biteWound(attacker, target, style === 'ape_bite' ? 'maul' : style);
            }
            // ...and it BLEEDS. The decal above marks the skin; this is the
            // spray, and it leaves the teeth rather than the victim's centre.
            biteBlood(attacker, target, style);
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
          setLungeCap(attacker, target, style, tp, opts);
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
        // the body-stops-at-body law during the run-in too: a marine
        // attacker's teeth never cross the quarry's surface just by closing
        if (marineCommitted(style) && bitePassOn()) {
          var Ja = jawWorld(attacker);
          if (Ja) {
            var ajx = tp.x - Ja.x, ajz = tp.z - Ja.z;
            var alim = Math.sqrt(ajx * ajx + ajz * ajz) - targetRadFor(target, opts) * 1.05;
            if (step > alim) step = alim;
          }
        }
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
        /* WHICH BLOW? For every animal in the bestiary the answer is its one
           style and always has been. An ape has a repertoire — charge, smash,
           backhand, bite, the chest beat, and the grab — and which one it
           throws depends on how many men are inside its arms, so the choice is
           made HERE, once, at the top of the swing, and latched into
           `_atkStyle` for the arc. Absent ape_combat this returns nothing and
           the style is whatever it always was. */
        if (CBZ.apeMove) {
          var picked = null;
          try { picked = CBZ.apeMove(attacker, target, opts, _dist, reach); } catch (e) { picked = null; }
          if (picked) { style = picked; attacker._atkStyle = picked; attacker._apeStyle = picked; }
        }
        animateAttack(attacker, style, 0, _h, Math.min(reach, _dist), dt);
      } else {
        // waiting between attacks: ease back to rest pose
        restPose(attacker, dt);
      }
      return RES;
    } catch (e) {
      RES.inRange = false;
      RES.dealt = 0;
      RES.missed = false;
      return RES;
    }
  }

  // ---- expose --------------------------------------------------------------
  CBZ.creatureFight = creatureFight;
  CBZ.creatureBitePass = bitePassOn;   // one flag, one reader — marine callers ask here
  CBZ.creatureFlinch = creatureFlinch;
  CBZ.creatureAnimateFlinch = creatureAnimateFlinch;
  CBZ.creatureStyleFor = creatureStyleFor;
  CBZ.creatureSeizeStyleFor = creatureSeizeStyleFor;
  CBZ.creatureJawPoint = jawPoint;      // group-LOCAL hold point, cached per actor
  // The same point IN THE WORLD, and the contact test built on it. Exported
  // because a probe has to be able to photograph and measure "the teeth were
  // here when they closed" — that claim is the whole of the bite repair, and a
  // claim only this file can answer honestly. Returns a REUSED vector.
  CBZ.creatureJawWorld = jawWorld;
  CBZ.creatureJawReaches = jawReaches;
  CBZ.creatureBiteBlood = biteBlood;
  CBZ.creatureBiteWound = biteWound;    // mounted predators reuse the same paired wound owner
  CBZ.creatureRestY = restY;            // medium-aware rest height (land or water)

  /* ==========================================================================
     TONIC IMMOBILITY — the roll-over.
     ==========================================================================
     A shark held upside down goes limp. That is a real, well-documented
     reflex, it is exactly how a pod of orcas kills a big one, and it is the
     single animation that makes city/marine_predation.js's pod fight legible
     from a boat 200 m away: the thing that has been fighting for a minute
     turns white-belly-up and stops.

     IT LIVES HERE and not in the pod file for the same reason every other
     pose in this game lives here: this is the file that owns "what an animal's
     body does", and a second module writing rotations onto a wildlife group
     is the two-writers bug that produces an animal calmly swimming out of the
     jaws holding it. The pod file supplies WHEN and WHO; this supplies the
     motion.

     THE AXIS. Our animals are authored nose at +X, so the body's own ROLL is
     rotation.x and its PITCH is rotation.z — the opposite of the intuition,
     and the exact mistake predator.js's BODY_AXIS_STYLE comment records. A
     roll written to rotation.z would pitch the shark nose-down through the
     seabed instead of turning it over. The euler order is switched to 'YXZ'
     for the duration so the yaw still reads as a heading with a full 180
     degrees of roll on it, and creatureTonicClear puts the original order and
     rotations back — a body that is released half-inverted must not stay
     that way.

     THE SHAPE, in one progress value 0..1:
       0.00-0.18  IT FIGHTS IT. Hard, fast, shrinking-amplitude thrash — the
                  beat that says this is being DONE to it.
       0.18-0.70  THE INVERSION. Eased, slow, monotone to belly-up. Slow is
                  the whole point; a fast flip reads as a rotation glitch,
                  which is the one failure mode this animation has.
       0.70-1.00  LIMP. Held inverted, a long slow sway with no drive in it,
                  nose drooping, sinking a little. Nothing twitches.

     Allocation-free and idempotent: all state is three numbers on the victim.
  ========================================================================== */
  function tonicState(victim) {
    var st = victim._tonic;
    if (st) return st;
    var g = victim.group;
    st = victim._tonic = {
      order: (g && g.rotation && g.rotation.order) || 'XYZ',
      rx: g ? g.rotation.x : 0, ry: g ? g.rotation.y : 0, rz: g ? g.rotation.z : 0,
      y0: g ? g.position.y : 0, ph: 0,
    };
    if (g && g.rotation && g.rotation.reorder) { try { g.rotation.reorder('YXZ'); } catch (e) {} }
    return st;
  }

  // p: 0..1 progress through the roll. Call every frame while it runs.
  function creatureTonicRoll(victim, p, dt) {
    if (!victim || !victim.group) return false;
    var g = victim.group;
    var st = tonicState(victim);
    if (!(dt > 0)) dt = 0;
    p = p < 0 ? 0 : (p > 1 ? 1 : p);
    st.ph += dt;
    var sc = actorScale(victim);
    var sq = Math.sqrt(Math.max(0.35, sc));           // big things move slower

    var roll = 0, pitch = 0;
    if (p < 0.18) {
      // THE FIGHT. Amplitude falls as it loses, so the struggle visibly ends.
      var f = p / 0.18;
      roll = Math.sin(st.ph * (13 / sq)) * 0.55 * (1 - f);
      pitch = Math.sin(st.ph * (9 / sq)) * 0.16 * (1 - f);
    } else if (p < 0.70) {
      var u = (p - 0.18) / 0.52;
      var e = u * u * (3 - 2 * u);                    // smoothstep: no snap at either end
      roll = Math.PI * e;
      // it still twitches early in the turn, and stops well before the end
      roll += Math.sin(st.ph * (10 / sq)) * 0.20 * Math.max(0, 1 - u * 2.2);
      pitch = -0.12 * e;
    } else {
      var w = (p - 0.70) / 0.30;
      roll = Math.PI + Math.sin(st.ph * (1.1 / sq)) * 0.09;   // a long dead sway
      pitch = -0.12 - 0.16 * w;                               // nose droops
    }
    g.rotation.x = roll;
    g.rotation.z = pitch;
    // GOING DOWN, not through the floor: the medium's own rest line is the
    // reference and it only ever drifts BELOW it, by a fraction of the body.
    var rest = restY(victim, g.position.x, g.position.z);
    var want = rest - (p > 0.70 ? (p - 0.70) / 0.30 : 0) * sc * 0.55;
    g.position.y += (want - g.position.y) * Math.min(1, dt * 1.4);
    // the mouth hangs open on a limp animal
    if (CBZ.swimJaw && p > 0.55) { try { CBZ.swimJaw(victim, (p - 0.55) / 0.45 * 0.5); } catch (e) {} }
    return true;
  }

  // Put the body back. Called when a roll is abandoned (the roller died, the
  // pod broke off) — never after a kill, where the corpse owner takes over.
  function creatureTonicClear(victim) {
    var st = victim && victim._tonic;
    if (!st) return false;
    var g = victim.group;
    if (g && g.rotation) {
      g.rotation.x = st.rx; g.rotation.z = st.rz;
      if (g.rotation.reorder) { try { g.rotation.reorder(st.order); } catch (e) {} }
    }
    victim._tonic = null;
    return true;
  }
  CBZ.creatureTonicRoll = creatureTonicRoll;
  CBZ.creatureTonicClear = creatureTonicClear;
  // read-only, for the before/after probe: how far over is it, right now?
  CBZ.creatureTonicAngle = function (victim) {
    var g = victim && victim.group;
    return (victim && victim._tonic && g) ? g.rotation.x : 0;
  };
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
