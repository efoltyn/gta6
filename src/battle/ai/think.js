"use strict";
/* src/battle/ai/think.js — NPC War: THINK: one man's decision.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ THINK
   Slow tick per man: pick a mark, hand steering to combat_iq's posture
   (cover, fire token, band, bearing slot), advance when walls have kept
   the mark unseen too long. The fast path below only moves and shoots. */
// nobody in sight: MARCH. Squads move as ranked columns behind their
// senior man — the approach reads as an army, and it costs one lookup
// per follower. Contact dissolves the parade: the moment anyone has a
// mark, combat_iq (or the beast brain) owns him.
//
// THE SENIOR MAN IS THE ONLY ONE WHO NAVIGATES. He descends the flow
// field, the column trails him on his own bearing, and a squad rounds a
// block as a squad. Before this, every follower solved the same wall
// independently and the formation came apart on the first corner.
// (Shared with the beasts verbatim: a wolf pack files through the same
// streets the men do, and spreads the same way when it finds the fight.)
function marchGoal(m) {
  if (m.home && holding(m)) {
    m.target.set(m.home.x, 0, m.home.z);
    m.slot = "march";
    return;
  }
  const com = teamCOM[m.team === "red" ? "blue" : "red"];
  const sq = squads[m.team][m.sq];
  let lead = null;
  if (sq) for (let i = 0; i < sq.length; i++) if (!sq[i].dead && !sq[i].fled && !sq[i].routed) { lead = sq[i]; break; }
  if (lead && lead !== m) {
    const ahead = lead.target;
    const my = Math.atan2(ahead.x - lead.pos.x, ahead.z - lead.pos.z);
    const row = ((m.sqSlot / 2) | 0) + 1, col = (m.sqSlot & 1) ? 1.25 : -1.25;
    m.target.set(
      lead.pos.x - Math.sin(my) * row * 2.0 + Math.cos(my) * col, 0,
      lead.pos.z - Math.cos(my) * row * 2.0 - Math.sin(my) * col);
  } else if (!navStep(m, m.target)) {
    const j = m.hunt ? 0 : 14;      // a hunt marches STRAIGHT at them
    m.target.set(com.x + (lcg() - 0.5) * j, 0, com.z + (lcg() - 0.5) * j);
  }
  // a pack marching in also spreads: the column-follow above is a MAN's
  // formation, and animals that ignore it would otherwise walk in a stack
  if (m.beast) spreadGoal(m);
  m.slot = "march";
}
/* THE WALL RULE — the fix this wave is actually for. A combat goal is only
   a straight line if the world agrees: posture()'s bearing and band goals
   are pure geometry around the mark, and in a real downtown they routinely
   land through a building, which is the man pressing his face into the
   facade until the detour timer spins him. One torso-height segment test
   per think; when the line is walled, descend the flow field instead — the
   same "around, not through" the marches already use. ?steer=old reverts. */
function goalBlocked(m) {
  return CBZ.micro.segmentBlocked(
    m.pos.x, m.pos.y + 1.1, m.pos.z,
    m.target.x, MAP.groundAt(m.target.x, m.target.z) + 1.1, m.target.z);
}
function steerAroundWalls(m) {
  if (STEER_OLD) return;
  const gd = Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z);
  if (gd > 8 && goalBlocked(m) && navStep(m, m.target)) {
    // the field hands every man in a cell the SAME cell centre, and two
    // walled men approaching it from opposite sides would meet head-on at
    // a point by construction. A man-stable lateral inside the 4 m cell
    // keeps the descent direction and loses the pile-up.
    m.target.x += ((m.i % 5) - 2) * 0.8;
    m.target.z += (((m.i * 7) % 5) - 2) * 0.8;
  }
}
/* A CHARGE IS NOT A QUEUE.

   The men have had a goal-level anti-clump since the first build: after
   combat_iq picks a spot, the goal is pushed off whichever mates are
   already standing near it, so two riflemen are never sent to the same
   metre of street. The beasts had NOTHING — every lion in the pride was
   steered at the same enemy body, so a hundred goals stacked on one point
   and the separation pass spent every frame shoving apart bodies that the
   steering shoved straight back together. Measured on 120 lions v 400 dogs:
   70 overlapping pairs at peak, and the probe named them for what they were
   — same team, both charging, mostly not even fighting anybody yet.

   Same rule as the men's, in the pair's own units: two lions need more room
   than two dogs, and the fine grid already knows who is nearby. */
const _bn = [];
function spreadGoal(m) {
  const reach = (m.rad + bodyRadMax) * 1.3;
  const a = fineNear(m.target.x, m.target.z, reach, _bn);
  let ox = 0, oz = 0, n = 0;
  for (let i = 0; i < a.length && n < 5; i++) {
    const o = a[i];
    if (o === m || o.dead || o.team !== m.team) continue;
    const want = (m.rad + (o.rad || 0.45)) * 1.1;
    const dx = m.target.x - o.pos.x, dz = m.target.z - o.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > want || d < 0.001) continue;
    ox += (dx / d) * (want - d); oz += (dz / d) * (want - d); n++;
  }
  if (n) { m.target.x += ox; m.target.z += oz; }
}
// the beast's slow tick: pick the fight, close on it, surround it. The
// strike itself is creature_combat's, in the bubble stepMan owns.
function thinkBeast(m, tgt, thinkDt) {
  const tn = m.tn;
  /* AN ANIMAL DOES NOT CHASE ONE MARK ACROSS THE WHOLE MAP WHILE SOMETHING
     ELSE IS BITING ITS FLANK.

     Targets are sticky until the mark dies, which is right on land: a lion
     runs a deer down, terrain corners it, and the fight ends. In OPEN WATER
     it never ends — two animals of similar speed in a stern chase are a
     conga line, and MEASURED, eight orcas and a megalodon spent seventy
     simulated seconds in one with nobody so much as bleeding out, because the
     megalodon had latched onto the one orca that broke off at 64 m while
     seven more were inside ten.

     So a beast that is FAR from its mark re-asks, on a slow cadence, and only
     switches for something genuinely nearer (0.6x). Cheap (one grid query a
     second per far-off animal), and it is a fix for land packs too — a wolf
     should take the man in front of it, not the one it first saw. */
  if (tgt && !tgt.dead) {
    const far = Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z);
    if (far > 16) {
      m.repickT = (m.repickT || 0) - thinkDt;
      if (m.repickT <= 0) {
        m.repickT = 0.9 + (m.i % 5) * 0.13;      // staggered, never a whole pod at once
        const o = pickTarget(m, far);
        if (o && o !== tgt &&
            Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z) < far * 0.6) {
          m.tgt = o; tgt = o; m.losBadT = 0;
        }
      }
    }
  }
  // a mauled animal that is not one of the brave ones quits and runs — and
  // is run down or lives by the same chase-and-retreat physics the men
  // already play by. Prey species skip straight to flight.
  const beaten = m.hp < m.maxHp * 0.3 && !tn.brave;
  if (beaten || tn.prey) {
    const com = teamCOM[m.team === "red" ? "blue" : "red"];
    const fx = m.pos.x - (tgt ? tgt.pos.x : com.x), fz = m.pos.z - (tgt ? tgt.pos.z : com.z);
    const fl = Math.hypot(fx, fz) || 1;
    m.target.set(m.pos.x + (fx / fl) * 16, 0, m.pos.z + (fz / fl) * 16);
    m.slot = "fallback"; m.state = "flee"; m.tgt = null;
    return;
  }
  m.state = "charge";                        // the gait's flee-bound reads this
  const sees = eyeLos(m, tgt);
  m.sees = sees;
  if (!sees) {
    m.losBadT += thinkDt;
    if (m.losBadT > 7) { m.tgt = null; m.losBadT = 0; return; }
    if (m.losBadT > 2.0) {                   // an animal does not trade with a facade at all
      if (!navStep(m, m.target)) m.target.set(tgt.pos.x, 0, tgt.pos.z);
      m.slot = "push";
      return;
    }
  } else m.losBadT = 0;
  const d = Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z);
  if (d < 14) {
    /* THE SURROUND: a pack does not queue single file behind the prey.
       Each pack index takes a bearing around the mark — the same slot idea
       the gunmen's fire arcs use, at claw range.

       The ring is the two BODIES' own sizes, not a fraction of the reach.
       Sizing it off reach put every attacker inside the clearance the
       separation pass was simultaneously trying to keep them at, so the two
       rules fought each other and the pack shimmered through itself — 25 of
       the 32 overlapping pairs in the lions-and-dogs measurement were on a
       surround ring. Twelve bearings around the WHOLE circle, too: seven
       slots across 172 degrees left the far side of the prey empty. */
    /* AND THE RING HAS A CAPACITY. One ring at touching distance holds
       2*pi*r / (bodies wide) animals and no more — for dogs on a lion that
       is eight — so when four hundred dogs pick the same lion, the ring
       itself was ordering three hundred of them to stand inside each other.
       Twelve bearings on THREE concentric rings, assigned off the animal's
       own stable index: the front rank bites, the ranks behind wait their
       turn at a body's distance back, and a pack reads as a pack closing in
       rather than a single pile. */
    const slot = (m.i % 12) * (Math.PI / 6);
    const ringN = (((m.i / 12) | 0) % 3);
    const base = Math.atan2(m.pos.x - tgt.pos.x, m.pos.z - tgt.pos.z) + slot;
    const r = m.rad + (tgt.rad || 0.45) + 0.12 + ringN * m.rad * 1.9;
    m.target.set(tgt.pos.x + Math.sin(base) * r, 0, tgt.pos.z + Math.cos(base) * r);
  } else {
    m.target.set(tgt.pos.x, 0, tgt.pos.z);
    steerAroundWalls(m);
  }
  spreadGoal(m);
  m.slot = "push";
}

/* Any think that does not end in the fold gives the fold up: a man told to
   push, chase or run does not carry a crouch across open sand. */
function think(m, now) {
  if (m.you) return;
  thinkMan(m, now);
  if (m.hull && m.slot !== "hull") m.hull = null;
}
function thinkMan(m, now) {
  const thinkDt = Math.min(1.2, now - m.lastThink);
  m.lastThink = now;
  const crowd = men.length;
  m.thinkAt = now + 0.14 + Math.min(0.42, crowd / 2600) + lcg() * 0.06;
  m.hunt = HUNT[m.team];
  // HIS NERVE FIRST: a man who has broken is not deciding anything else
  if (routCheck(m, thinkDt)) return;
  // a man stepping off his own man's firing line finishes the step. Half a
  // second of not re-deciding is the whole point: re-deciding is what put
  // him back in the lane.
  if (m.stepAsideT > 0 && m.tgt && !m.tgt.dead && !m.tgt.fled) { m.stepAsideT -= thinkDt; return; }

  if (!m.tgt || m.tgt.dead || m.tgt.fled) { m.tgt = pickTarget(m, m.hunt ? SIGHT * 2 : SIGHT); m.losBadT = 0; }
  // CONTACT IS INFORMATION A SQUAD SHARES. Before marching blind past a
  // fight, a man asks his own column: a mate already engaged hands him the
  // mark, and the squad turns to the guns together instead of one man
  // duelling while nine file past. One squad scan per think, only while
  // unengaged — this is what "acting under orders" costs when it is real.
  if (!m.tgt && !SHARE_OLD) {
    /* AT MOST TWO MEN TURN ON ONE SHOUT. Whole-column adoption was a
       measured pile-up (ten mates beelining one mark crossed files into a
       sub-0.62 m pair on the arena probe); two is a buddy answering a
       contact, and the rest of the column keeps its shape and its march,
       acquiring organically as the fight arrives. The pair still tells
       the watcher the squad is a squad — without a scrum. */
    const sqB = squads[m.team][m.sq];
    if (sqB) for (let i = 0; i < sqB.length; i++) {
      const b = sqB[i];
      if (b === m || b.dead || b.routed || !b.tgt || b.tgt.dead || b.tgt.fled) continue;
      let onIt = 0;
      for (let j = 0; j < sqB.length; j++) {
        if (sqB[j] !== m && !sqB[j].dead && sqB[j].tgt === b.tgt) onIt++;
      }
      if (onIt >= 2) continue;
      const bd = Math.hypot(b.tgt.pos.x - m.pos.x, b.tgt.pos.z - m.pos.z);
      if (bd < SIGHT * 1.3) {
        m.tgt = b.tgt; m.losBadT = 0;
        // and hold rank for the rest of this beat — the man engages on his
        // own next think, with the fire arcs handing him a bearing.
        marchGoal(m);
        return;
      }
    }
  }
  const tgt = m.tgt;
  if (!tgt) { marchGoal(m); return; }
  if (m.beast) { thinkBeast(m, tgt, thinkDt); return; }
  const sees = seesStanding(m, tgt);
  m.sees = sees;
  if (!sees) {
    m.losBadT += thinkDt;
    // a wall has held this line too long: push up on the mark instead of
    // trading nothing with a facade. The assault around the corner IS the
    // readable behaviour — and "around" is the field's word, not a straight
    // line into the facade, which is what it used to mean.
    if (m.losBadT > 2.6) {
      // and a mark that stays unseeable even at arm's length is a dead end
      // (a body wedged in geometry, a hole nobody can shoot into) — let it
      // go and take the next fight rather than freezing the war on it
      if (m.losBadT > 7) { m.tgt = null; m.losBadT = 0; return; }
      if (!navStep(m, m.target)) m.target.set(tgt.pos.x, 0, tgt.pos.z);
      m.slot = "push";
      return;
    }
  } else m.losBadT = 0;

  /* THE PURSUIT. A man whose mark has broken and is running does not hold
     his band and trade with a back: if he still has the nerve for it he
     goes after him, shooting (slot "push" fires). This is the half of a
     rout the watcher actually sees. */
  if (tgt.routed && !m.launcher && manMorale(m) > m.nerve + 0.12) {
    const pd = Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z);
    if (pd < 110 && (!m.fists || pd > meleeReach(m, tgt))) {
      m.target.set(tgt.pos.x, 0, tgt.pos.z);
      steerAroundWalls(m);
      spreadGoal(m);
      m.slot = "push";
      return;
    }
  }

  if (m.fists) {
    // an unarmed man has one range: his arms. Close on the mark; inside it
    // IQ.melee (stepMan) owns the footwork, the guard and the swing.
    const d = Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z);
    if (d > meleeReach(m, tgt)) {
      m.target.set(tgt.pos.x, 0, tgt.pos.z);
      steerAroundWalls(m);
    }
    m.slot = "push";
    return;
  }
  if (m.launcher) {
    // launchers stand off; combat_iq has no rocket column, so the band is ours
    const d = Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z);
    if (d < 22) { m.target.set(m.pos.x + (m.pos.x - tgt.pos.x) / d * 12, 0, m.pos.z + (m.pos.z - tgt.pos.z) / d * 12); m.slot = "back"; }
    else if (d > 52) { m.target.set(tgt.pos.x, 0, tgt.pos.z); m.slot = "close"; }
    else { m.slot = "fire"; m.target.set(m.pos.x, 0, m.pos.z); }
    return;
  }
  const slot = CBZ.combatIQ && CBZ.combatIQ.posture
    ? CBZ.combatIQ.posture(m, tgt, thinkDt) : "fire";
  m.slot = slot || "fire";

  // THE WALL RULE RUNS BEFORE THE SPREAD, deliberately: a projected goal is
  // a flow-field cell CENTRE, and two men walled off the same bearing would
  // otherwise be handed the same metre of street — the anti-clump below has
  // to get the last word on every goal, projected or not. (cover and peek
  // hug walls by design — the hide point sits just past the box — so the
  // rule only audits the long moves: bands, bearings, flanks.)
  if (m.slot !== "cover" && m.slot !== "peek") steerAroundWalls(m);

  /* THE GROUND IS COVER. A rattled man on real dunes (or one already in
     his fold) takes the reverse slope behind the nearest crest instead of
     standing in the open — hullFor() throttles and budgets the search.
     Not on the sweep: a hunting army does not go to ground. The fold gets
     the body-scale spread, not the 2.6 m anti-clump, which could shove the
     goal out over the lip. */
  const holds = holding(m);
  if (MAP.terrainLos && !m.hunt && (m.supp > 0.3 || m.hull || holds)) {
    const hd = hullFor(m, tgt);
    if (hd) {
      m.target.set(hd.x, 0, hd.z);
      m.slot = "hull";
      spreadGoal(m);
      return;
    }
  }

  /* A HELD LINE IS HELD. combat_iq's posture walks a rifleman into his
     band (26 m for a rifle); a man holding a line fires from it instead —
     his goal is leashed to ten metres of where he formed, and anything he
     can see inside his gun's reach he shoots from where he is. */
  if (holds && m.home) {
    const hx = m.target.x - m.home.x, hz = m.target.z - m.home.z, hd = Math.hypot(hx, hz);
    if (hd > 10) { m.target.x = m.home.x + hx / hd * 10; m.target.z = m.home.z + hz / hd * 10; }
    if (m.sees && m.slot !== "cover" && m.slot !== "peek") m.slot = "fire";
  }
  // anti-clump on the goal, from the grid: posture's own separation scans
  // city rosters, which are empty out here
  const a = grid.get(gridKey(Math.floor(m.pos.x / GRID_CELL), Math.floor(m.pos.z / GRID_CELL)));
  if (a && a.length > 1) {
    let ox = 0, oz = 0, n = 0;
    for (let i = 0; i < a.length && n < 4; i++) {
      const o = a[i];
      if (o === m || o.dead) continue;
      const dx = m.target.x - o.pos.x, dz = m.target.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.6 || d < 0.001) continue;
      ox += dx / d * (2.6 - d); oz += dz / d * (2.6 - d); n++;
    }
    m.target.x += ox; m.target.z += oz;
  }
}
