"use strict";
/* src/battle/damage.js — NPC War: REACHABLE + DAMAGE.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

CBZ.npcwar.onBoot(function () {
  /* ============================================================ REACHABLE
     One join and the engine's shared verbs can find these men: a rocket's
     studio.boom sweeps THIS roster (both sides — a blast has no team), and
     the hurt funnel is the same one the scoreboard reads. */
  CBZ.studio.join({
    id: "npcwar", label: "NPC War",
    caps: { traverse: 1, stepLedge: 1, blast: 1, blastActors: 1, breach: 1 },
    actors: function (out) {
      for (let i = 0; i < men.length; i++) if (!men[i].dead) out.push(men[i]);
      return out;
    },
    hurt: function (a, dmg, imp) { hurtMan(a, dmg, imp || {}); return true; },
    hurtPlayer: function () { return true; },   // nobody IS the player here
    route: "npcwar roster + hurtMan",
  });
});

/* ============================================================ DAMAGE */
function hurtMan(m, dmg, imp) {
  // a ghost is a row in the tier sim (src/battle/mass.js): the round lands there
  if (m && m.ghost) { if (dmg > 0) MASS.hurtGhost(m, dmg, imp); return; }
  // a hull answers with its armour first (src/battle/vehicles.js)
  if (m && m.vehicle) { hurtVehicle(m, dmg, imp); return; }
  if (!m || m.dead || m.fled || !(dmg > 0) || over) return;
  m.hp -= dmg;
  if (CBZ.combatIQ && CBZ.combatIQ.suppress) CBZ.combatIQ.suppress(m, 0.9);
  // a round that lands rattles harder than one that snaps past
  m.supp = Math.min(SUPP_CAP, (m.supp || 0) + SUPP_HIT);
  // getting shot IS information: retaliate at the shooter if unengaged —
  // unless he is running, in which case it is only a reason to run faster
  if (!m.routed && imp && imp.by && imp.by.team && imp.by.team !== m.team &&
      (!m.tgt || m.tgt.dead || m.tgt.fled)) m.tgt = imp.by;
  if (m.hp <= 0) killMan(m, imp);
  // a hit he lives through: the body's reaction, and maybe DOWN (ai/squad.js)
  else tacticsOnHurt(m, dmg, imp);
}
const DEADN = { red: 0, blue: 0 };       // the dead, by side (corpses retire; this does not)
function killMan(m, imp) {
  m.dead = true; m.hp = 0;
  DEADN[m.team] = (DEADN[m.team] || 0) + 1;
  if (m.you) youDown(m);
  // a beast that dies mid-swing must let the pose go, or the strike offset
  // stays latched on the corpse — the exact leak creatureEndAttack exists for
  if (m.beast && CBZ.creatureEndAttack) { try { CBZ.creatureEndAttack(m); } catch (e) {} }
  if (m.ordTgt) {
    m.ordTgt.alive = false;
    if (CBZ.ordnance && CBZ.ordnance.removeTarget) CBZ.ordnance.removeTarget(m.ordTgt);
    m.ordTgt = null;
  }
  const byT = (imp && imp.by && imp.by.team) || (imp && imp.byTeam) || null;
  if (byT && byT !== m.team) stats[byT].kills++;
  else if (!byT) stats[m.team === "red" ? "blue" : "red"].kills++;   // blast with no author still scores the other side
  // fratricide (a bomb is a blunt tool) credits nobody
  // and the man who did it keeps his own tally, with his gun
  const by = imp && imp.by;
  if (by && by.team && by.team !== m.team) {
    by.kills = (by.kills || 0) + 1;
    if (by.wid) gunLedger(by.wid).kills++;
    // A MAN ON A RUN is a thing the HUD can point at
    if (by.kills === 3 || by.kills === 5 || by.kills === 8) {
      emitWar("streak", { team: by.team, id: by.id, name: manName(by), kills: by.kills });
    }
  }
  // sprawl: the rig's own death variety; the topple is ours (caller owns it)
  if (m.char && CBZ.deathPose) { try { CBZ.deathPose(m.char, m.i * 3.7 + 1.3, lcg()); } catch (e) {} }
  m.dieT = 0.0001;
  m.dieDir = lcg() < 0.5 ? -1 : 1;
  if (m.vehicle) vehicleWrecked(m, imp);
  else if (m.beast) beastDeathPhysics(m, imp);
  else manDeathPhysics(m, imp);
  // the rifle leaves his hands and lands like hardware, not like a prop
  const prop = m._weaponProp;
  if (prop && CBZ.weaponPhysics && CBZ.weaponPhysics.drop) {
    try {
      CBZ.scene.attach(prop);
      m._weaponProp = null; m._weaponPropId = null;
      CBZ.weaponPhysics.drop(prop, {
        vx: (lcg() - 0.5) * 2.4, vy: 1.6 + lcg(), vz: (lcg() - 0.5) * 2.4,
        source: "npcwar-death",
      });
      dropGuns.push(prop);
      if (dropGuns.length > 140) {
        const old = dropGuns.shift();
        if (old && old.parent) old.parent.remove(old);
      }
    } catch (e) {}
  }
  m.armed = false;
  // AND THE PAGE LOOKS AT IT. A 15 m animal going down is the moment this
  // arena exists for and it used to happen in three frames somewhere off
  // camera; killCam refuses politely on every path that would make it a lie.
  killCam(m);
  corpses.push(m);
  if (corpses.length > (DEATH_OLD ? 260 : CORPSE_MAX)) retireOldestCorpse();
  const aliveMine = aliveCount(m.team);
  moraleOnDeath(m, aliveMine);
}
// a fled man has been spliced out of `men` by updateMorale, so this is
// "still on the field", which is what the HUD bars and the win check mean
function aliveCount(team) {
  if (MASS.on) return MASS.aliveCount(team);
  let n = 0;
  for (let i = 0; i < men.length; i++) if (men[i].team === team && !men[i].dead && !men[i].fled) n++;
  return n;
}
function manName(m) {
  return m.beast ? TEAMS[m.team].name + " " + String(m.species.name).toUpperCase()
    : TEAMS[m.team].name + " " + (m.i + 1);
}
