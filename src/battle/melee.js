"use strict";
/* src/battle/melee.js — NPC War: MEN FIGHTING WITH THEIR HANDS. Owned by the
   melee agent (docs/npcwar/ARCHITECTURE.md). Lifted out of step.js so the
   fist fight is one file; the fighter brain itself is shared with every game:
   combat_iq's IQ.melee, which hands the exchange to systems/melee.js
   (CBZ.melee, the `verbs` pack) wherever both men have a rig.
   Every src/battle file shares ONE script scope. */

/* THE PUNCH EXCHANGE is combat_iq's own melee brain — close, circle, guard,
   windup, swing — the same beat structure every brawler in the city fights
   with. It writes m.target for the footwork; "swing" is the one frame a blow
   lands, through the same funnel as a bullet. */
function stepFists(m, tgt, dist, sdt) {
  const mr = meleeReach(m, tgt);
  if (!(dist < mr * 1.9 && CBZ.combatIQ && CBZ.combatIQ.melee)) return;
  // `incoming` is how a brawler reads the other man's windup and gets his
  // guard up — without it two NPCs never block each other
  // quit: a beaten fighter gives up (hands up) or runs (systems/melee.js judge)
  // and the page makes it count: a prisoner, or a man routing (ai/squad.js)
  const st = CBZ.combatIQ.melee(m, tgt, sdt,
    { reach: mr, incoming: (tgt._windup || 0) > 0 || (tgt._iqM && tgt._iqM.st === "windup"), quit: TAC.on });
  if (TAC.on && m._vfS && m._vfS.quit && fistQuit(m)) return;
  if (st !== "swing") return;
  /* AND IT MATTERS WHO HE IS HITTING. `m.punch` is a number off the THROWER
     and nothing else, so a civilian's fist used to take the same bite out of
     a 190 kg silverback as out of another man. systems/bodymass.js turns the
     pair into a ratio; man on man is 1.0.
     ...AND WHERE IT LANDED. With the melee layer in, "swing" comes back once
     per blow that actually LANDED on the rig, and IQ.lastBlow(m) says where:
     a jab to the guard and a hook to the jaw are not the same number.
     Feature-detected: 1.0 before systems/melee.js is loaded. */
  /* ...AND HOW HARD. The melee layer measures the blow's FORCE (res.force:
     the swing's power x the body behind it, ~1 a clean full punch), and
     bodymass.js meets a hide with it: a hide is a threshold the force has to
     clear, so a jab off an elephant's flank is nothing at all. */
  const lb = CBZ.combatIQ.lastBlow ? CBZ.combatIQ.lastBlow(m) : null;
  const mk = CBZ.meleeScale ? CBZ.meleeScale(m, tgt, lb && lb.force > 0 ? lb.force : 1) : 1;
  const zm = lb && isFinite(lb.dmgMul) ? lb.dmgMul : 1;
  hurtMan(tgt, m.punch * (0.85 + lcg() * 0.4) * mk * zm, { by: m });
  stats[m.team].shots++; stats[m.team].hits++;   // the ledger counts blows thrown and landed
  m.shotsF++; m.hitsF++; gunLedger("fists").shots++; gunLedger("fists").hits++;
}

/* A MAN ON THE FLOOR IS NOT STEERED. A knockdown (verbs_strike: a.ko, the
   rig's koPose / fall) owns his body until he gets up; the march, the
   footwork and the possessed man's stick all wait. */
function knockedDown(m) {
  if (!m || m.beast || m.vehicle) return false;
  if (m.ko > 0) return true;
  const ch = m.char;
  return !!(ch && (ch.koPose || (ch.fall && ch.fall.on)));
}
