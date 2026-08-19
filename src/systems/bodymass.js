// ============================================================================
// bodymass.js — HOW MUCH BODY IS THERE, AND WHAT DOES A PUNCH DO TO IT (CBZ)
// ----------------------------------------------------------------------------
// OWNER: "consider how punches work... men's punches work the same against a
// man as against a girl. Gorilla and other animals now. One simple or a couple
// simple statistics could fix this."
//
// He is right and it is a one-line bug repeated in four files. Every melee
// damage site in this game reads a number off the ATTACKER and hands it to the
// target untouched:
//
//   games/battle.html   hurtMan(tgt, m.punch * (0.85 + lcg() * 0.4))
//   systems/combat.js   the prison's landPunch, a flat tier number
//   city/combat.js      the street's land(), same shape
//   entities/ai.js      MELEE_BLOW rows, straight into CBZ.hurtPlayer
//
// So a civilian's fist takes the same bite out of a 190 kg silverback as it
// does out of a 62 kg woman, and the silverback's own blow lands on a man with
// no more authority than a man's lands on it. That is not a difficulty
// question, it is the one thing a punch is actually about.
//
// TWO STATISTICS, and both are DERIVED — nothing new is authored anywhere:
//
//   mass(actor)     kg. For a person it comes out of the anthropometric
//                   profile entities/character.js already builds (statureMul,
//                   torso breadth and depth) — the same record that decides
//                   the body's shoulders and stride. For an animal it comes
//                   off the species row's own `scale`, cubed, because mass
//                   goes as the cube of a linear dimension and always has.
//   hardness(actor) how much a strike is BLUNTED before it reaches anything
//                   that matters — fur, hide, the slab of muscle over a
//                   silverback's chest. 1 for people; for an animal it rides
//                   the species' own `danger`, which is the row's existing
//                   statement of how much animal you are dealing with.
//
// AND TWO READS USE THEM, which is one more than it looks and the difference
// matters:
//
//   meleeScale(attacker, target)  a BARE-HANDED blow, where the thrower's own
//                   body is part of the answer. A fist delivers roughly a fixed
//                   impulse; what it does depends on the mass it has to move
//                   and the hide it has to get through first.
//   meleeAbsorb(target)  the same statistic with the attacker divided out —
//                   what this body soaks, full stop. Animals go through THIS
//                   one, because `species.bite` is already authored as what
//                   that animal does to a man: running it through the two-body
//                   form would multiply a silverback by its own weight twice
//                   and hand the row a 70% buff nobody wrote.
//
// Man on man is 1.0 by construction and an animal's bite against a person is
// 1.0 by construction, so every existing fight in the game is numerically
// untouched and only the MISMATCHES change. That is the entire point.
//
// DELIBERATELY NOT APPLIED TO BULLETS. A round does not care how big you are —
// it carries its own energy and the body is just what stops it. This is the
// melee seam only, which is why it is a function the melee sites call rather
// than something buried in a damage funnel every source shares.
// ============================================================================
(function () {
  'use strict';
  var CBZ = window.CBZ;
  if (!CBZ) return;

  if (!CBZ.CONFIG) CBZ.CONFIG = {};
  if (CBZ.CONFIG.BODY_MASS == null) CBZ.CONFIG.BODY_MASS = true;   // the one-line revert
  function ON() { return CBZ.CONFIG.BODY_MASS !== false; }

  // ---- the reference body -------------------------------------------------
  // The shipped adult male rig, and the mass a real one of that stature and
  // build carries. Every other person in the game is this number moved by the
  // profile that already describes them.
  var REF_MASS = 78;            // kg
  var REF_TORSO_W = 0.92;       // ADULT_M.torsoW  (character.js profileBase)
  var REF_TORSO_D = 0.50;       // ADULT_M.torsoD

  /* THE ANIMAL CONSTANT. Mass goes as the cube of length, so a species' own
     `scale` is very nearly the whole answer; this is the coefficient that puts
     the cube in kilograms. Anchored on the silverback (scale 1.15 -> ~190 kg,
     a real adult male gorilla) and checked across the land bestiary rather
     than fitted to one row:

       lion        1.15 -> 190   (real ~190)
       brown bear  1.35 -> 307   (real ~300)
       polar bear  1.45 -> 381   (real ~450)
       tiger       1.10 -> 166   (real ~220)
       cheetah     0.95 -> 107   (real ~55, the one that runs heavy)

     Monotonic and the right order of magnitude everywhere, which is all a
     damage ratio needs. A species that cares can author `mass` and this is
     skipped entirely. */
  var ANIMAL_K = 125;

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

  // The rig behind an actor, whichever way this game hands it over: peds and
  // battle men carry `.char`, studio casts hang it on the group's userData,
  // and the player's is a global.
  function rigOf(a) {
    if (!a) return null;
    if (a.char && a.char.profile) return a.char;
    if (a.profile) return a;
    if (a.group && a.group.userData && a.group.userData.charRig) return a.group.userData.charRig;
    if ((a.isPlayer || (CBZ.player && a.pos === CBZ.player.pos)) && CBZ.playerChar) return CBZ.playerChar;
    return null;
  }

  /* A PERSON'S MASS, out of the profile that already describes their body.
     Stature enters cubed (a body scaled in every direction) and BREADTH enters
     as a square root rather than linearly, on purpose: the rig's female torso
     is stylised narrower than anthropometry to read at thirty metres
     (character.js says so in its own note), so taking it at face value would
     put an adult woman at 53 kg. The root respects the direction without
     inheriting the exaggeration — it lands her at ~61 kg against the male 78,
     which is the real ratio. */
  function personMass(rig) {
    var P = rig && rig.profile;
    if (!P) return REF_MASS;
    var stature = num(P.statureMul, 1);
    var breadth = (num(P.torsoW, REF_TORSO_W) * num(P.torsoD, REF_TORSO_D)) /
                  (REF_TORSO_W * REF_TORSO_D);
    if (!(breadth > 0)) breadth = 1;
    return REF_MASS * stature * stature * stature * Math.sqrt(breadth);
  }

  function animalMass(sp, a) {
    if (!sp) return REF_MASS;
    var m = num(sp.mass, 0);
    if (m > 0) return m;                       // authored wins, always
    /* THE ROW WINS, and the live group scale is only a fallback. The obvious
       version of this preferred whatever the actor was actually built at —
       which read a gorilla as 125 kg instead of 190, because creature_combat's
       impact pulse had been overwriting the group's scale with an absolute 1
       on every swing (fixed there, but the lesson stands): a transform is a
       thing the animation layer is entitled to move, and a mass must not be
       derived from something that can be animated. */
    var s = num(sp.scale, 0);
    if (!(s > 0)) s = (a && a.group && a.group.scale && a.group.scale.x > 0.05) ? a.group.scale.x : 1;
    return ANIMAL_K * s * s * s;
  }

  function bodyMass(a) {
    if (!a) return REF_MASS;
    if (a._mass > 0) return a._mass;
    var sp = a.species;
    var m;
    if (sp && typeof sp === 'object') m = animalMass(sp, a);
    else m = personMass(rigOf(a));
    if (!(m > 0) || !isFinite(m)) m = REF_MASS;
    a._mass = m;
    return m;
  }

  /* HOW MUCH OF A BLOW SURVIVES THE OUTSIDE OF THE THING. People are 1: a fist
     to a person reaches them. An animal's `danger` is already this game's
     statement of how much animal it is, so it carries the hide too — a
     silverback (0.85) blunts a third of a punch before it is felt, a rabbit
     (0) blunts none. */
  function hardness(a) {
    var sp = a && a.species;
    if (!sp || typeof sp !== 'object') return 1;
    return 1 + num(sp.danger, 0) * 0.5;
  }

  /* THE MULTIPLIER A BARE-HANDED BLOW CARRIES.

     A fist delivers roughly a fixed impulse. What that impulse DOES depends on
     the mass it has to move — so the ratio of the two bodies is the whole
     statistic — and on what it has to get through first.

     The 0.6 exponent is the softening every game needs and physics does not
     forbid: a man is not literally four times more dangerous to a child than
     to another man, because a blow that is already enough stops scaling. Man
     on man is exactly 1.0, so nothing that exists today moves.

       civilian (78) on a silverback (190, hide 1.43)   0.40
       silverback (190) on a man (78)                   1.70
       a man (78) on a woman (61)                       1.16
       a man (78) on a ten-year-old (~30)               2.00 (the cap)

     Clamped at both ends because neither a rounding-error tickle nor a
     one-punch kill is what any of these fights are for. */
  var LO = 0.28, HI = 2.0;

  /* HOW MUCH A BODY SOAKS, with no attacker in the question at all.

     This is the same statistic seen from the other end, and it exists because
     scaling an ANIMAL's blow by its own mass would double-count: `species.bite`
     is already authored as what that animal does TO A MAN. A silverback's 30 is
     a silverback-hitting-a-person number, so multiplying it by the silverback's
     own weight again would hand the row a 70% buff nobody wrote.

     Divide the two-body ratio through by the same ratio against a reference man
     and the attacker cancels out exactly, leaving what the TARGET absorbs. So a
     species' authored bite stays worth precisely what it says against a person
     (1.0, by construction — no balance moves) while the same animal hitting a
     bear, or another silverback, correctly finds a body that soaks more. */
  function meleeAbsorb(target) {
    if (!ON() || !target) return 1;
    var mt = bodyMass(target);
    if (!(mt > 0)) return 1;
    var k = Math.pow(REF_MASS / mt, 0.6) / hardness(target);
    return k < LO ? LO : (k > HI ? HI : k);
  }

  function meleeScale(attacker, target) {
    if (!ON() || !attacker || !target) return 1;
    var ma = bodyMass(attacker), mt = bodyMass(target);
    if (!(ma > 0) || !(mt > 0)) return 1;
    var k = Math.pow(ma / mt, 0.6) / hardness(target);
    return k < LO ? LO : (k > HI ? HI : k);
  }

  // Forget a cached mass — for a body whose rig or species was swapped after
  // it was first asked (an outfit change never matters; a re-cast does).
  function forget(a) { if (a) a._mass = 0; }

  CBZ.bodyMass = bodyMass;
  CBZ.bodyHardness = hardness;
  CBZ.meleeScale = meleeScale;
  CBZ.meleeAbsorb = meleeAbsorb;
  CBZ.bodyMassForget = forget;
  // What it thinks, for a console read — no gate, just a way to look.
  CBZ.bodyMassAudit = function (a, b) {
    return { on: ON(), massA: a ? Math.round(bodyMass(a)) : null,
      massB: b ? Math.round(bodyMass(b)) : null,
      hardB: b ? hardness(b) : null,
      scale: (a && b) ? Math.round(meleeScale(a, b) * 100) / 100 : null };
  };
})();
