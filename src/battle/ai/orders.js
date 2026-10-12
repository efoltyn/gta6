"use strict";
/* src/battle/ai/orders.js — NPC War: ORDERS: hold or advance.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ ORDERS
   A BATTLE HAS A SHAPE: somebody holds a line and somebody comes for it.
   Before this every army walked at the other's centre of mass and the two
   crowds melted together in the middle of the map — a meeting engagement
   every time, nothing held, nothing taken. Now a side is told one of two
   things:
     advance  the march it always had
     hold     stay on the line it formed on: kneel there, take the reverse
              slope of the nearest crest when there is one, fire from it,
              and only go forward to run down a broken enemy (or when the
              sweep, 3:1, says the fight is over)
   Who holds: on the war room, the smaller army of MEN digs in when the
   other side outnumbers it half again — the few hold, the many come — and
   equal armies still meet. A host that fields forces (Gang City) gives each
   force its own order (below). */
const ORDER = { red: "advance", blue: "advance" };
/* A FORCE'S ORDER. A host that fields forces (Gang City's CBZ.army) gives
   every unit of a force one shared order object, m.order = { type, at }:
     attack    march on `at` (not the enemy's centre) and fight what is there
     hold      stay on the homes the host laid out round `at`
     move      go to those homes (they fight back from them, they do not chase)
     withdraw  the same, to a rally point away from the fight
   A unit with no order follows its side's ORDER, as the war room always did. */
function holding(m) {
  if (m.beast || m.you || m.hunt) return false;
  const o = m.order;
  if (o ? o.type === "attack" : ORDER[m.team] !== "hold") return false;
  if (o && o.type !== "hold") return true;     // sent somewhere: it goes, broken enemy or not
  const F = ARMY[m.team === "red" ? "blue" : "red"];
  return !(F && F.broken);                 // a broken enemy is run down
}
// where a unit marches when nobody is in front of it
function objectiveOf(m) {
  const o = m && m.order;
  if (o && o.type === "attack" && o.at) return o.at;
  return teamCOM[m.team === "red" ? "blue" : "red"];
}
// an attack still far from its objective marches on it, not down the flow
// field to whichever enemy happens to be nearest
function farObjective(m) {
  const o = m.order;
  return !!(o && o.type === "attack" && o.at && Math.hypot(o.at.x - m.pos.x, o.at.z - m.pos.z) > 120);
}
// a squad's word for the squad brain (core/tactics.js asks the adapter)
function squadOrderOf(t, S) {
  const m = S && S.men && S.men[0];
  const o = m && m.order;
  if (!o) return ORDER[t];
  return o.type === "attack" ? "advance" : "hold";
}
let comAt = -1;
function updateCOM() {
  // the morale tick rides this one: same cadence, and it splices the fled
  // out of `men` before anything below counts them
  updateMorale();
  /* THE CENTRE IS WHERE THE FIGHTING MEN ARE. A routing man running for his
     edge is not where his army's guns are, and averaging him in dragged
     every march goal and every rout direction toward the runners. The
     living are the fallback when nobody is left fighting. */
  const count = { red: 0, blue: 0 }, live = { red: 0, blue: 0 };
  if (MASS.on) {
    // a tiered battle: the centre of every fighting row (src/battle/mass.js)
    const k = MASS.com();
    count.red = k.red; count.blue = k.blue; live.red = k.liveRed; live.blue = k.liveBlue;
  } else ["red", "blue"].forEach(function (t) {
    let x = 0, z = 0, n = 0, ax = 0, az = 0, an = 0;
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (m.team !== t || m.dead || m.fled || m.air) continue;
      ax += m.pos.x; az += m.pos.z; an++;
      if (m.routed) continue;
      x += m.pos.x; z += m.pos.z; n++;
    }
    count[t] = n; live[t] = an;
    if (n) { teamCOM[t].x = x / n; teamCOM[t].z = z / n; }
    else if (an) { teamCOM[t].x = ax / an; teamCOM[t].z = az / an; }
  });
  /* THE MOP-UP IS A PHASE, AND EIGHT TO ONE IS NOT WHERE IT STARTS.
     `hunt` is what ends a battle — a wider look, a straight march and a run
     (stepMan: speed 8.0, fireMax x1.6) — and it was gated on a ratio so
     extreme that by the time it could fire there was nothing left to hunt.
     MEASURED, 26 v 26 on `city`: at t=83 s it stood 17 v 4, a comfortable
     rout at 4.25:1, and the flag was still false; twenty-one men held a mark
     none of them could SEE, all of them in slot `push`, and the shot counter
     sat unchanged at 715 for the last three samples. That is dead air with
     the result already decided.

     Three to one is where an army stops manoeuvring and starts sweeping,
     which is both the real answer and the measured one. */
  // counted in FIGHTING men: an army whose line has broken is swept, even
  // while its runners still outnumber the men chasing them
  HUNT.red = count.red > 0 && (count.blue > 0 ? count.red >= count.blue * 3 : live.blue > 0);
  HUNT.blue = count.blue > 0 && (count.red > 0 ? count.blue >= count.red * 3 : live.red > 0);
  comAt = simT;
  // the unit store's rows follow the full units on this slow tick (the fled
  // have been spliced out of `men` above and still owe their row a verdict)
  if (STORE) {
    for (let i = 0; i < men.length; i++) if (men[i].row != null) STORE.sync(men[i].row, men[i]);
    for (let i = 0; i < fledMen.length; i++) if (fledMen[i].row != null) STORE.sync(fledMen[i].row, fledMen[i]);
  }
}
