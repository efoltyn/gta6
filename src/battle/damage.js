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
  STUDIO.join({
    id: "npcwar", label: "NPC War",
    caps: { traverse: 1, stepLedge: 1, blast: 1, blastActors: 1, breach: 1 },
    actors: function (out) {
      for (let i = 0; i < men.length; i++) if (!men[i].dead) out.push(men[i]);
      return out;
    },
    hurt: function (a, dmg, imp) { hurtMan(a, dmg, imp || {}); return true; },
    // a detonation is pressure and impulse by distance, on this roster's
    // real masses: src/battle/physics.js blastBodies
    blast: function (x, y, z, R, power, opts) { return blastBodies(x, y, z, R, power, opts); },
    hurtPlayer: function () { return true; },   // nobody IS the player here
    route: "npcwar roster + hurtMan",
  });
});

/* ============================================================ DAMAGE */
/* THE BODY ANSWERS WITH ITS KIT FIRST. A man's hit goes through
   systems/armour.js (CBZ.armour.resolve): the zone it landed in, the piece
   that covers it (plate, soft panel, helmet), stopped or beaten. What it
   returns is what reaches him, plus a stagger and a winded man behind a
   plate that held. What kind of hit it is comes from the caller (fire.js
   says "bullet"; the weapons agent's rounds say their own) or from who did
   it: a bomb is a blast, a beast bites, a fist is a blow, a hull crushes. */
function hitKind(imp) {
  if (!imp) return null;
  if (imp.kind) return imp.kind;
  // a flown round (fire.js armsHit) was already resolved against the kit by
  // CBZ.battleArmour.layer: its damage is final here
  if (imp.bullet || imp.pen != null) return null;
  if (imp.cause === "bomb") return "blast";
  if (imp.cause === "crush") return "crush";
  const by = imp.by;
  if (!by) return null;
  if (by.vehicle) return "blast";
  if (by.beast) return "bite";
  return "blunt";
}
function armourHit(m, res, imp) {
  m.lastHit = res;
  if (res.winded > 0) m.windedT = Math.max(m.windedT || 0, res.winded);
  const by = imp && imp.by;
  let dx = 0, dz = 0;
  if (by && by.pos) { dx = m.pos.x - by.pos.x; dz = m.pos.z - by.pos.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
  const S = CBZ.soldier;
  if (!m.char || !S || m.hp <= 0) return;
  if (res.stagger > 0.2 && S.hit && camDist2(m.pos) < 120 * 120) {
    try { S.hit(m.char, { sev: res.stagger, zone: res.wound || undefined, dirX: dx, dirZ: dz }); } catch (e) {}
  } else if (res.wound && S.wound && res.dmg > m.maxHp * 0.08) {
    try { S.wound(m.char, res.wound, Math.min(1, res.dmg / (m.maxHp * 0.5))); } catch (e) {}
  }
}
function hurtMan(m, dmg, imp) {
  // a host's actor (HOST.targets: Gang City's player) takes it through the host
  if (m && m.hostActor) { if (dmg > 0 && m.hurt) m.hurt(dmg, imp || {}); return null; }
  // a ghost is a row in the tier sim (src/battle/mass.js): the round lands there
  if (m && m.ghost) { if (dmg > 0) MASS.hurtGhost(m, dmg, imp); return; }
  // a hull answers with its armour first (src/battle/vehicles.js)
  if (m && m.vehicle) { hurtVehicle(m, dmg, imp); return null; }
  if (!m || m.dead || m.fled || !(dmg > 0) || over) return null;
  let res = null;
  const kind = hitKind(imp);
  if (kind && !m.beast && CBZ.armour) {
    const by = imp.by;
    res = CBZ.armour.resolve({
      target: m, dmg: dmg, kind: kind, wid: imp.wid, round: imp.round, zone: imp.zone, headshot: imp.headshot, raw: imp.raw,
      dirX: by && by.pos ? m.pos.x - by.pos.x : undefined, dirZ: by && by.pos ? m.pos.z - by.pos.z : undefined,
      yaw: m.yaw, rng: lcg,
    });
    dmg = res.dmg;
  } else if (kind === "bullet" && imp.headshot) dmg *= 2.2;      // a beast's head: the old rule
  // an animal shot through the heart is dead on its feet, not dropped
  if (m.beast && imp && imp.bullet && m.hp - dmg <= 0 && imp.organ !== "brain" && imp.organ !== "spine" &&
      m.maxHp < 1e8 && onItsFeet(m, dmg, imp)) dmg = 0;
  m.hp -= dmg;
  if (res) armourHit(m, res, imp);
  // ...and what the kit did to that round (systems/armour.js layer: a stop
  // still winds him and rocks him; fire.js already flinched him)
  else if (imp && imp.bullet && m.armour && m.armour.last && m.armour.last.t === m.armour.hits) {
    const L = m.armour.last; m.armour.last = null;
    if (L.winded > 0) m.windedT = Math.max(m.windedT || 0, L.winded);
    m.lastHit = L;
  }
  if (CBZ.combatIQ && CBZ.combatIQ.suppress) CBZ.combatIQ.suppress(m, 0.9);
  // a round that lands rattles harder than one that snaps past
  m.supp = Math.min(SUPP_CAP, (m.supp || 0) + SUPP_HIT);
  // getting shot IS information: retaliate at the shooter if unengaged —
  // unless he is running, in which case it is only a reason to run faster
  if (!m.routed && imp && imp.by && imp.by.team && imp.by.team !== m.team &&
      (!m.tgt || m.tgt.dead || m.tgt.fled)) m.tgt = imp.by;
  if (m.hp <= 0) {
    // his mates heard where it came from (ai/squad.js returnFire)
    if (imp && imp.by && imp.by.team && imp.by.team !== m.team && !m.beast) returnFire(m, imp.by);
    killMan(m, imp);
  }
  // a hit he lives through: maybe DOWN (ai/squad.js); the rig's flinch is
  // armourHit's when the armour layer resolved the round (res)
  else tacticsOnHurt(m, dmg, imp, res);
  return res;
}
/* DEAD ON ITS FEET. A round that would finish an animal without touching its
   brain or spine does not drop it: it has CBZ.ballistics.onFeet(kg) seconds
   (a tiger ~6, an elephant ~15, +-30%) of oxygen left and spends them on
   whoever shot it. Every further hit spends that time faster, in proportion
   to the share of the animal it takes; a brain or spine hit, or anything
   that is not a bullet (a bite, a blast, a fall), ends it at once. Measured
   before: a charging tiger at 10 m died in 1.1-1.4 s and landed nothing
   (BALANCE.md F6). While it stands, a lethal round's hp is not taken: the
   species files slow a body by its hp (a tiger at 1 hp ran at 55%), and a
   dead-on-its-feet animal runs on adrenaline, not on its wounds. Bleeding
   still runs it down, held at 1 hp. stepBleed (fire.js) runs the clock.
   Answers true while the animal still stands. */
function onItsFeet(m, dmg, imp) {
  const B = CBZ.ballistics;
  const win = B && B.onFeet ? B.onFeet(bodyKg(m)) : 6;
  if (!(m._doomT > 0)) {
    m._doomT = simT + win * (0.7 + 0.6 * lcg());
    // more holes empty it faster, but the brain's own oxygen is a floor
    // no number of body hits takes away (~40% of the window)
    m._doomMin = simT + win * 0.4;
    m._doomBy = imp.by || null;
    if (!m._bleeding) { m._bleeding = true; m._bleed = m._bleed || 0; BLEEDERS.push(m); }
  } else m._doomT = Math.max(m._doomMin || 0, m._doomT - win * Math.min(0.15, 0.25 * dmg / Math.max(1, m.maxHp)));
  return simT < m._doomT;
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
  if (byT && byT !== m.team) { if (stats[byT]) stats[byT].kills++; }   // (a host actor, the city's player, is no side)
  else if (!byT) stats[m.team === "red" ? "blue" : "red"].kills++;   // blast with no author still scores the other side
  // fratricide (a bomb is a blunt tool) credits nobody
  // and the man who did it keeps his own tally, with his gun
  const by = imp && imp.by;
  if (by && by.team && by.team !== m.team && !by.hostActor) {
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
