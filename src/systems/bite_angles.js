/* src/systems/bite_angles.js — EVERY BITE IS A GEOMETRIC CONTEST.

   Owner, 2026-08-25: "like agario over and over again for each bite — angles
   of collision decide kills — so a shark at the right angle can kill a bigger
   shark."

   THE HOLE THIS FILLS. Before today a bite was a scalar: whoever had the
   bigger `bite` stat and the most hp won, and the only thing geometry decided
   was whether the teeth reached at all. A bull shark could not beat an orca
   by out-PLAYING it, only by out-statting it, so the one interesting fight in
   Shark Sim — small thing, big thing — was a stat check with a swimming
   animation on top. And the deaths looked mid because nothing was contested:
   one body simply drained.

   THE LAW, and it is ONE angle. Take the bearing from the VICTIM's centre to
   the point where the teeth arrive, and measure it against the VICTIM's own
   facing. Call it `rel`. That single number is the whole system:

     |rel| >= REAR (100 deg)   REAR   the ambush. Behind the pectorals, past
                               the reach of the victim's own jaws. Full damage
                               plus a bonus, and NO answer. This is the bite
                               you orbit for.
     FACE..REAR                FLANK  square on the beam. Ordinary damage, no
                               answer — the jaws cannot come round that far.
     |rel| < FACE (60 deg)     FACE   the victim is looking at you. Your bite
                               is weakened AND it counter-bites you while you
                               are still winding up.
     |rel| < NOSE (30 deg)     CLASH  ...and if YOU are also nose-first, that
     and attacker nose-on             is a jaw clash, and the BIGGER GAPE wins
                               the exchange outright. Charging a bigger mouth
                               mouth-first is how you die.

   IT IS SYMMETRIC BY CONSTRUCTION. Nothing below asks who the player is. The
   pod hunting you needs YOUR angle exactly as much as you need the orca's, so
   turning into a threat is real defence and denying the angle is real play —
   which is also what a pod IS for: three flankers on three bearings mean one
   of them always has your tail.

   WHAT IT DOES NOT DO. It never decides whether a bite HAPPENS. The trigger
   stays where it was (Shark Sim's auto-bite still fires the moment prey is in
   front of the mouth — move is the only control), and creature_combat still
   owns the clock, the reach and the animation. This decides only what the
   bite COSTS and what it DOES once the teeth are already there.

   STATS ARE CONSUMED, NEVER WRITTEN. Bite force comes out of predatorKit
   (whatever scaling that block applies is already in it) with the species row
   as the fallback; gape and length come from marine_predation's measurers.
   There is no table here and no species name.

   ?cfg_BITE_ANGLES=0 reverts every consumer to the flat pre-angle bite.

   PUBLIC API
     CBZ.biteAngle(attacker, victim, opts) -> contest | null
       opts.point  {x,y,z} where the teeth actually land (preferred)
       opts.style  the attack style, for the audit only
       -> { zone, rel, aim, mult, counter, gapeAdv, canAnswer, ... }
     CBZ.biteAnswer(contest)        -> counter damage actually dealt (0 = none)
     CBZ.biteAngleOn()              -> is the law live
     CBZ.biteAngleZones()           -> the thresholds, for tools
     CBZ.biteAngleAudit()           -> {rear, flank, face, clash, answers, ...}
     CBZ.biteAngleAuditReset()
*/
(function () {
  const CBZ = (window.CBZ = window.CBZ || {});
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.BITE_ANGLES == null) CBZ.CONFIG.BITE_ANGLES = true;
  function ON() { return CBZ.CONFIG.BITE_ANGLES !== false; }
  CBZ.biteAngleOn = ON;

  // ---- the three thresholds, in radians off the victim's nose --------------
  // NOSE  the victim's own bite cone: inside this its jaws are pointing at you.
  // FACE  it is still looking at you and can turn its head far enough to answer.
  // REAR  behind the pectorals. Nothing it does reaches you.
  const NOSE = 0.52;      // 30 deg
  const FACE = 1.05;      // 60 deg
  const REAR = 1.75;      // 100 deg

  // ---- what each zone is worth --------------------------------------------
  const REAR_MULT = 1.55;      // the ambush pays
  const FLANK_MULT = 1.00;     // the honest bite
  const FACE_MULT = 0.72;      // biting something that is biting back
  const FACE_ANSWER = 0.60;    // fraction of the victim's own bite it answers with
  const CLASH_ANSWER = 1.00;   // a clash answers with everything it has
  const ANSWER_CD = 1.10;      // s — one answer per victim per this, or it is a race

  const AUDIT = {
    rear: 0, flank: 0, face: 0, clash: 0,
    answers: 0, answerDmg: 0, denied: 0, cd: 0, unusable: 0,
    lastZone: "", lastMult: 0, lastCounter: 0,
  };
  CBZ.biteAngleAudit = function () {
    return {
      rear: AUDIT.rear, flank: AUDIT.flank, face: AUDIT.face, clash: AUDIT.clash,
      contests: AUDIT.rear + AUDIT.flank + AUDIT.face + AUDIT.clash,
      answers: AUDIT.answers, answerDmg: Number(AUDIT.answerDmg.toFixed(1)),
      denied: AUDIT.denied, cd: AUDIT.cd, unusable: AUDIT.unusable,
      lastZone: AUDIT.lastZone, lastMult: AUDIT.lastMult, lastCounter: AUDIT.lastCounter,
    };
  };
  CBZ.biteAngleAuditReset = function () {
    AUDIT.rear = AUDIT.flank = AUDIT.face = AUDIT.clash = 0;
    AUDIT.answers = AUDIT.denied = AUDIT.cd = AUDIT.unusable = 0;
    AUDIT.answerDmg = 0; AUDIT.lastZone = ""; AUDIT.lastMult = 0; AUDIT.lastCounter = 0;
  };
  CBZ.biteAngleZones = function () {
    return { nose: NOSE, face: FACE, rear: REAR,
      rearMult: REAR_MULT, flankMult: FLANK_MULT, faceMult: FACE_MULT,
      faceAnswer: FACE_ANSWER, clashAnswer: CLASH_ANSWER, answerCd: ANSWER_CD };
  };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function shortAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
  /* SIM TIME, NOT WALL TIME — the same clock predator.js's cooldowns read.
     CBZ.now is advanced synthetically by core/loop.js's stepSim, so a burst
     of a thousand ticks moves it a thousand ticks' worth. Reading
     performance.now() here (which the first cut did) would have made the
     answer cooldown behave completely differently in a headless burst than
     in play, and every verification number taken off it a lie. */
  function nowS() {
    return (CBZ.now != null ? CBZ.now
      : (typeof performance !== "undefined" ? performance.now() : Date.now())) * 0.001;
  }
  function actorPos(a) { return (a && (a.pos || (a.group && a.group.position))) || null; }
  /* WHICH WAY IS THIS THING POINTING — and `null` when nobody knows.

     THE GUARD IS THE FEATURE, and it is the difference between a law and a
     random number generator. A contest measured against a facing that does
     not exist is not a weaker contest, it is noise: every zone would be
     decided by where world +X happens to be. So this answers null for
     anything that does not publish a heading, biteAngle returns null on a
     null facing, and every consumer falls straight back to the flat pre-angle
     bite.

     WHO THAT LEAVES OUT, deliberately. CBZ.player is a bare {pos, hp} record
     with no heading at all, and peds/cops/survivors are humanoids built on
     the OPPOSITE yaw convention (rotation.y = PI/2 - heading, nose at +Z).
     Guessing either would have silently rolled dice on every land predator in
     the game. Animals — which this repo builds nose-at-+X and turns through
     faceAnimal — are the ones that can be measured, and the ridden shark is
     one of them, so the whole symmetric contest lands exactly where it was
     designed to and eating a mackerel keeps its old tempo. */
  function facingOf(a) {
    if (!a) return null;
    if (typeof a.heading === "number" && isFinite(a.heading)) return a.heading;
    if (typeof a.faceH === "number" && isFinite(a.faceH)) return a.faceH;
    // the animal rig convention: nose at +X, group yaw is the NEGATED heading
    // (faceAnimal / faceAnimalHeading). Only claimed for actual animals.
    if (a.species && a.group && a.group.rotation && isFinite(a.group.rotation.y)) {
      return -a.group.rotation.y;
    }
    return null;
  }

  /* HOW HARD DOES THIS THING BITE. predatorKit first — whatever mass/stat
     scaling that block applies is already merged into `dmg`, and this file
     must never grow a second opinion about it — then the bestiary row. A
     tuna, a survivor and a ped all answer 0, which is exactly why they never
     counter-bite without a single "can this thing fight back" list existing. */
  function biteOf(a) {
    if (!a) return 0;
    if (typeof CBZ.predatorKit === "function") {
      try { const k = CBZ.predatorKit(a); if (k && k.dmg > 0) return k.dmg; } catch (e) {}
    }
    return (a.species && a.species.bite) || 0;
  }
  /* HOW WIDE DOES IT OPEN. marine_predation measures this off the authored
     mouth contract; its own fallback is a fraction of the measured body, so
     land animals and unauthored rigs still answer something honest. */
  function gapeOf(a) {
    if (typeof CBZ.marineGape === "function") {
      try { const g = +CBZ.marineGape(a); if (g > 0 && isFinite(g)) return g; } catch (e) {}
    }
    if (typeof CBZ.marineBodyLen === "function") {
      try { const L = +CBZ.marineBodyLen(a); if (L > 0 && isFinite(L)) return L * 0.19; } catch (e) {}
    }
    return Math.max(0.2, ((a && a.species && a.species.scale) || 1) * 0.8);
  }

  const _cp = { x: 0, y: 0, z: 0 };
  let _jawV = null;
  /* WHERE THE TEETH ARE. A caller that already clamped a contact point onto
     the victim's surface (the mounted bite does) hands it over and this is
     exact. Otherwise the attacker's authored jaw point is transformed into
     world space — the ORIGIN is the wrong answer for anything long, because a
     shark alongside its prey with its nose turned in is biting the flank from
     a body that is squarely abeam. Origin is only the last resort. */
  function contactPoint(attacker, opts) {
    if (opts && opts.point && isFinite(opts.point.x)) return opts.point;
    const g = attacker && attacker.group;
    if (g && typeof CBZ.creatureJawPoint === "function" && window.THREE) {
      try {
        const p = CBZ.creatureJawPoint(attacker);
        if (p && isFinite(p.x)) {
          g.updateMatrixWorld(true);
          if (!_jawV) _jawV = new window.THREE.Vector3();
          const v = _jawV.set(p.x, p.y || 0, p.z || 0).applyMatrix4(g.matrixWorld);
          if (isFinite(v.x) && isFinite(v.z)) { _cp.x = v.x; _cp.y = v.y; _cp.z = v.z; return _cp; }
        }
      } catch (e) {}
    }
    const ap = actorPos(attacker);
    if (!ap) return null;
    _cp.x = ap.x; _cp.y = ap.y || 0; _cp.z = ap.z;
    return _cp;
  }

  /* CAN THIS VICTIM ANSWER AT ALL. Everything here is a state some other
     block owns and that means "it is not currently a fighting animal":
     already dead, already in somebody's jaws, rolled over into tonic
     immobility, or restrained. A held body must never counter-bite — that is
     the whole point of holding it. */
  function ableToAnswer(v) {
    if (!v || v.dead || !(v.hp > 0)) return false;
    if (v._seizedBy || v._jawHeld) return false;
    if (v._mpRoll || v._mpTonic) return false;
    if (v.restraint || v.cuffed) return false;
    if (biteOf(v) <= 0) return false;
    return true;
  }

  /* A SMALL RING OF RESULT OBJECTS, and the ring is not premature caution.
     A strike frame must not allocate, so the result is reused — but the
     caller reads `mult` AFTER biteAnswer() has run, and biteAnswer bills
     damage on the world's own bus (kills, carcasses, wound decals). One
     re-entrant contest inside that call would have silently rewritten the
     object the caller was still holding, and the bug it produced would be a
     single wrong damage number once in a while: unreproducible, and
     indistinguishable from tuning. Four slots is more nesting than any of
     these paths can physically reach, and it still allocates nothing. */
  const RING = [], RING_N = 4;
  for (let i = 0; i < RING_N; i++) {
    RING.push({
      ok: false, zone: "none", rel: 0, aim: 0, mult: 1, counter: 0,
      gapeAdv: 0.5, canAnswer: false, denied: false,
      attacker: null, victim: null,
      // its OWN point object: `point` is the contact the caller may want for
      // blood or a wound, and handing back a shared scratch that the next
      // contest overwrites is the same aliasing bug one level down.
      point: { x: 0, y: 0, z: 0 },
    });
  }
  let ringAt = 0;

  /* ============================================================
     THE CONTEST. Returns null when the law is off or the geometry cannot be
     taken, and every consumer treats null as "bill it the old way" — that is
     what makes ?cfg_BITE_ANGLES=0 a byte-identical revert instead of a second
     code path anybody has to maintain.
     ============================================================ */
  function biteAngle(attacker, victim, opts) {
    if (!ON() || !attacker || !victim) return null;
    const vp = actorPos(victim);
    if (!vp) { AUDIT.unusable++; return null; }
    const cp = contactPoint(attacker, opts);
    if (!cp) { AUDIT.unusable++; return null; }
    const dx = cp.x - vp.x, dz = cp.z - vp.z;
    if (!(isFinite(dx) && isFinite(dz))) { AUDIT.unusable++; return null; }
    // degenerate: teeth exactly on the victim's origin tells us nothing about
    // where they landed. Fall back to the attacker's own bearing.
    let bearing;
    if (dx * dx + dz * dz < 1e-4) {
      const ap = actorPos(attacker);
      if (!ap) { AUDIT.unusable++; return null; }
      bearing = Math.atan2(ap.z - vp.z, ap.x - vp.x);
    } else bearing = Math.atan2(dz, dx);

    const vFace = facingOf(victim);
    if (vFace == null) { AUDIT.unusable++; return null; }
    const rel = shortAngle(bearing - vFace);
    const arel = Math.abs(rel);
    // the attacker's own aim: is it driving nose-first at this thing, or
    // crossing it? Only a nose-first attacker can be in a jaw clash — and an
    // attacker whose own facing is unknown is never given one, because a
    // clash it cannot be shown to have chosen is not a clash.
    const ap = actorPos(attacker);
    const aFace = facingOf(attacker);
    const aim = (ap && aFace != null) ? Math.abs(shortAngle(
      Math.atan2(vp.z - ap.z, vp.x - ap.x) - aFace)) : Math.PI;

    const RES = RING[ringAt = (ringAt + 1) % RING_N];
    RES.ok = true; RES.rel = rel; RES.aim = aim;
    RES.attacker = attacker; RES.victim = victim;
    RES.point.x = cp.x; RES.point.y = cp.y || 0; RES.point.z = cp.z;
    RES.denied = false; RES.counter = 0; RES.gapeAdv = 0.5;
    RES.canAnswer = ableToAnswer(victim);

    if (arel >= REAR) {
      // ---- THE AMBUSH. Nothing it can do.
      RES.zone = "rear"; RES.mult = REAR_MULT; RES.canAnswer = false;
      AUDIT.rear++;
    } else if (arel >= FACE) {
      // ---- THE FLANK. The honest bite: it felt you, it could not reach you.
      RES.zone = "flank"; RES.mult = FLANK_MULT; RES.canAnswer = false;
      AUDIT.flank++;
    } else if (arel < NOSE && aim < NOSE) {
      /* ---- THE JAW CLASH. Two mouths arriving at each other, and the wider
         one closes around the narrower one's head. `adv` is a share, not a
         ratio, so it is bounded by construction and a 10x mismatch cannot
         produce a 10x number: an even clash costs BOTH animals 0.65 of a
         bite, which is why a head-on meeting between equals is a mauling
         neither of them wanted. */
      const gA = gapeOf(attacker), gV = gapeOf(victim);
      const adv = clamp(gA / Math.max(1e-3, gA + gV), 0, 1);
      RES.zone = "clash"; RES.gapeAdv = adv;
      RES.mult = clamp(2.0 * adv - 0.35, 0.10, 1.35);
      if (RES.canAnswer) {
        RES.counter = biteOf(victim) * clamp(2.0 * (1 - adv) - 0.35, 0, 1.35) * CLASH_ANSWER;
      }
      AUDIT.clash++;
    } else {
      /* ---- THE FACE. It saw you coming and turned into you. Your bite lands
         weakened and it gets its own in while you are still opening — how
         square it is facing decides how much of an answer it gets. */
      RES.zone = "face"; RES.mult = FACE_MULT;
      if (RES.canAnswer) {
        const square = 0.25 + 0.75 * (1 - arel / FACE);
        RES.counter = biteOf(victim) * FACE_ANSWER * square;
      }
      AUDIT.face++;
    }
    if (!(RES.counter > 0)) { RES.counter = 0; RES.canAnswer = false; }
    AUDIT.lastZone = RES.zone;
    AUDIT.lastMult = Number(RES.mult.toFixed(2));
    AUDIT.lastCounter = Number(RES.counter.toFixed(1));
    return RES;
  }
  CBZ.biteAngle = biteAngle;

  /* ============================================================
     THE ANSWER. Called BEFORE the attacker's own damage is billed, because
     the owner's word is "counter-bite during the attacker's WINDUP" — and
     because a counter that killed the attacker has to be allowed to cancel
     the bite that provoked it. That cancellation (`denied`) is the single
     most important thing in this file: it is the moment where turning into a
     charge is not merely cheaper but actually WINS, and it is what a smaller
     animal's whole game is built on.

     One answer per victim per ANSWER_CD. Without that, two animals nose to
     nose trade a counter every strike frame and the fight becomes a tick
     race that the higher frame rate wins.
     ============================================================ */
  function biteAnswer(c) {
    if (!c || !c.ok || !(c.counter > 0)) return 0;
    const a = c.attacker, v = c.victim;
    if (!a || !v) return 0;
    if (!ableToAnswer(v)) return 0;
    if (a.dead || !(a.hp > 0)) return 0;
    const t = nowS();
    if (t - (v._biteAnswerT || -1e9) < ANSWER_CD) { AUDIT.cd++; return 0; }
    v._biteAnswerT = t;

    const dmg = c.counter;
    const cause = "bitten defending itself";
    // MEASURED, NOT ASSUMED: marine_predation's damage bus has a floor on
    // mob relations (a lone orca may not finish a megalodon), so "how much
    // did the answer actually take" is an hp delta and never the number we
    // asked for. The audit is a measurement tool; it must not report damage
    // that another block refused to apply.
    const wasHp = (a.hp == null) ? 100 : a.hp;
    let dealt = 0, billed = false;
    // the counter is a real bite by a real animal, so it is billed on the bus
    // that animal's ordinary bites are billed on — never a raw .hp write, or
    // a countered orca becomes a frozen prop with no carcass and no killfeed.
    if (a.species && a.species.aquatic && typeof CBZ.marineHurt === "function") {
      try { CBZ.marineHurt(a, dmg, v, cause); billed = true; } catch (e) { billed = false; }
    } else if (typeof CBZ.cityWildlifeHit === "function") {
      try {
        CBZ.cityWildlifeHit(a,
          { head: false, point: actorPos(a), dir: null, from: actorPos(v) },
          { damage: dmg, by: v, cause: cause });
        billed = true;
      } catch (e) { billed = false; }
    }
    if (!billed) { a.hp = wasHp - dmg; if (a.hp <= 0) a.dead = true; }
    dealt = Math.max(0, wasHp - ((a.hp == null) ? 100 : a.hp));
    if (!(dealt > 0) && !a.dead) { AUDIT.answers++; return 0; }

    // IT LEAVES A MARK. The counter is invisible otherwise — the same hole the
    // pod's flank pass had before creatureBiteChunk was wired into it — and an
    // invisible answer teaches the player nothing about why they lost.
    if (typeof CBZ.creatureBiteWound === "function") {
      try { CBZ.creatureBiteWound(v, a, "lunge"); } catch (e) {}
    }
    if (typeof CBZ.creatureFlinch === "function") { try { CBZ.creatureFlinch(a); } catch (e) {} }

    AUDIT.answers++; AUDIT.answerDmg += dealt;
    // THE WINDUP LOST. A counter that put the attacker down cancels the bite
    // it was answering; the strike animation still plays out on a dying body,
    // which is exactly the read we want.
    if (a.dead || !(a.hp > 0)) { c.denied = true; c.mult = 0; AUDIT.denied++; }
    return dealt;
  }
  CBZ.biteAnswer = biteAnswer;

  /* ONE CALL FOR THE ORDINARY CASE: resolve the geometry, let the victim
     answer, and hand back the multiplier the caller should bill its own bite
     at. Returns 1 (and the contest, if there was one) when the law is off. */
  CBZ.biteContest = function (attacker, victim, opts) {
    const c = biteAngle(attacker, victim, opts);
    if (!c) return null;
    if (c.counter > 0) biteAnswer(c);
    return c;
  };
})();
