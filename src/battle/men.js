"use strict";
/* src/battle/men.js — NPC War: THE MEN + UNIFORMS.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ THE MEN */
const trainingOf = function (id) {
  for (let i = 0; i < TRAININGS.length; i++) if (TRAININGS[i].id === id) return TRAININGS[i];
  return TRAININGS[3];
};
function pickGun(choice, i) {
  if (choice === "fists") return "fists";
  // A NATION'S ISSUE is a list (city/frontline.js: "carbine,carbine,lmg,..."),
  // dealt out man by man on the same cycle MIXED uses
  if (String(choice).indexOf(",") > 0) {
    const L = String(choice).split(",");
    const id = L[(i * 7 + ((i / L.length) | 0)) % L.length];
    return GUN_NAME[id] ? id : "ak47";
  }
  if (choice === "mixed") return MIX_RIFLES[(i * 7 + ((i / MIX_RIFLES.length) | 0)) % MIX_RIFLES.length];
  if (choice === "everything") return GUN_ORDER[(i * 5 + ((i / GUN_ORDER.length) | 0)) % GUN_ORDER.length];
  return GUN_NAME[choice] ? choice : "ak47";
}
/* ============================================================ UNIFORMS
   TWO ARMIES, NOT TWO PAINT BUCKETS. Every man used to be cast with one flat
   team colour over torso, collar and cap (0xff5a3d / 0x3fa8ff) — traffic-cone
   orange and swimming-pool blue on olive trousers, which is what made the
   whole page read as a toy. A side is a uniform: fatigues that belong on the
   ground, a helmet cover in the team colour so a crane shot still sorts the
   two lines, and a little fade from man to man so a rank is not one clone.
   Soldiers/SWAT/guards wear the full kit; untrained men and street thugs keep
   their own trousers and wear the colour as a shirt, which is what a militia
   looks like. */
const UNIFORM = {
  red:  { torso: 0x7a3b28, arms: 0x6e3525, legs: 0x5e4a36, cap: 0x9c2f22, shoes: 0x2a2119, belt: 0x3a2e22,
          shirt: 0x9a3c2c, swatT: 0x4a2a24 },
  blue: { torso: 0x2f4a66, arms: 0x2b4460, legs: 0x363f4a, cap: 0x2a63a8, shoes: 0x1c1d20, belt: 0x23272c,
          shirt: 0x2f5f95, swatT: 0x1f2c3a },
};
function shade(hex, k) {
  const r = Math.min(255, ((hex >> 16) & 255) * k) | 0, g = Math.min(255, ((hex >> 8) & 255) * k) | 0,
    b = Math.min(255, (hex & 255) * k) | 0;
  return (r << 16) | (g << 8) | b;
}
CBZ.npcwar.onBoot(function () {
  /* AT THE FRONT A UNIFORM IS A NATION'S, in the ground's colours: its own
     cloth worked toward the camouflage of the place (white over-smocks in the
     snow, tan on the sand), and the helmet cover in the nation's bright mark
     so a crane shot still sorts the two lines. */
  if (FRONT) {
    const CAMO = { dunes: 0xb39a72, snow: 0xe8ecef, grass: 0x55603e, city: 0x5c5f63, harbor: 0x4c5560 };
    const mixHex = function (a, b, t) {
      const ch = function (sh) { return Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t) & 255; };
      return (ch(16) << 16) | (ch(8) << 8) | ch(0);
    };
    ["red", "blue"].forEach(function (t) {
      const S = FRONT[t], tone = CAMO[SET.map] != null ? CAMO[SET.map] : 0x6b6b5a;
      const k = SET.map === "snow" ? 0.72 : 0.38;
      const cloth = mixHex(isFinite(S.cloth) ? S.cloth : 0x4d4a3a, tone, k);
      UNIFORM[t] = {
        torso: cloth, arms: shade(cloth, 0.94), legs: shade(mixHex(isFinite(S.cloth) ? S.cloth : 0x4d4a3a, tone, k * 0.8), 0.82),
        cap: TEAMS[t].color, shoes: 0x1e1c19, belt: 0x2a2620,
        shirt: mixHex(TEAMS[t].color, 0x3a3a3a, 0.4), swatT: shade(cloth, 0.62),
      };
    });
  }
});
function uniformFor(teamId, trId, i) {
  const U = UNIFORM[teamId];
  // three fades of the same cloth: quantised so the material cache stays small
  const k = [0.9, 1, 1.09][(i * 7 + 3) % 3];
  if (trId === "civ" || trId === "thug") return { torso: shade(U.shirt, k), collar: shade(U.shirt, k), arms: shade(U.shirt, k * 0.96) };
  if (trId === "swat") return { torso: shade(U.swatT, k), collar: shade(U.swatT, k), arms: shade(U.swatT, k),
    legs: shade(0x22252a, k), cap: U.cap, shoes: U.shoes, belt: U.belt };
  return { torso: shade(U.torso, k), collar: shade(U.torso, k * 0.95), arms: shade(U.arms, k), legs: shade(U.legs, k),
    cap: U.cap, shoes: U.shoes, belt: U.belt };
}
/* A SOLDIER WEARS KIT. What a man fights in is entities/combatkit.js's (the
   one kit every game's soldiers wear, fitted to the body): his nation's issue
   camouflage, a plate carrier with his role's pouches, the nation's helmet,
   eye pro, gloves, knee pads, boots, and ID tape in the side's mark on both
   arms. His role comes from his gun and his place in the squad (a gunner, a
   marksman, the squad's medic, the platoon's officer, riflemen); an untrained
   side are civilians and a street side militia in a chest rig. The kit is
   also armour: kit.armour is what systems/armour.js resolves his hits against
   (damage.js hurtMan). The old cap-box-into-a-dome helmet is gone. */
function nationOf(teamId) {
  const S = SIDES[teamId];
  if (S && S.nation) return S.nation;
  if (FRONT && FRONT[teamId] && FRONT[teamId].id) return FRONT[teamId].id;
  return teamId === "red" ? "kesh" : "republic";
}
function kitUp(man, teamId, trId, wid, i) {
  const ch = man.char, K = CBZ.combatKit;
  if (!ch || !K) return;
  const nation = nationOf(teamId);
  const role = K.roleFor({ tier: trId, wid: wid, i: i, nation: nation });
  const kit = K.wear(ch, { loadout: role, nation: nation, mark: TEAMS[teamId].color,
    grade: trId === "pro" ? "second" : null, seed: i * 7 + (teamId === "red" ? 1 : 2) });
  man.role = role;
  man.armour = kit ? kit.armour : null;
  man.kitSpeed = kit && kit.weight ? kit.weight : 1;
}
function makeMan(teamId, i) {
  const T = TEAMS[teamId];
  const tr = trainingOf(teamId === "red" ? SET.redT : SET.blueT);
  const wid = pickGun(teamId === "red" ? SET.redW : SET.blueW, i);
  const fists = wid === "fists";
  const w = fists ? null : (CBZ.weaponById(wid) || CBZ.weaponById("ak47"));
  const group = CBZ.studio.cast(tr.role, { uniform: uniformFor(teamId, tr.id, i), variant: i * 2 + (teamId === "red" ? 0 : 1) });
  if (!group) return null;
  const at = MAP.spawnAt(teamId, i);
  group.position.set(at.x, MAP.groundAt(at.x, at.z), at.z);
  group.rotation.y = teamId === "red" ? Math.PI / 2 : -Math.PI / 2;
  CBZ.scene.add(group);
  const man = {
    id: teamId + i, team: teamId, i: i,
    group: group, char: group.userData.charRig,
    pos: group.position,                    // combat_iq + actorweapons read .pos
    target: V(),                            // combat_iq's posture() steers this
    yaw: group.rotation.y, speed: 0,
    hp: bench ? 1e9 : tr.hp, maxHp: bench ? 1e9 : tr.hp,
    armed: !fists, weapon: fists ? null : GUN_NAME[wid], wid: wid,
    /* AND NOBODY THROWS A HOOK WHILE TREADING WATER. A punch delivers a
       fixed impulse THROUGH THE GROUND — that is what bracing is — and a
       swimmer has no ground to push against. Without this a bare-handed
       crowd in the open sea arithmetics a great white to death exactly the
       way a hundred men used to arithmetic a gorilla, which is the fight
       systems/bodymass.js exists to have stopped. A quarter is a judgement,
       not a measurement, and ?swimpunch=N is the dial. */
    fists: fists, rad: 0.45,
    punch: (PUNCH[tr.id] || 8) * (MAP.water ? SWIM_PUNCH : 1),
    launcher: !!(w && w.explosive),
    mag: w ? (w.magSize || w.mag || 30) : 0, magSize: w ? (w.magSize || w.mag || 30) : 0,
    cool: 0.4 + lcg() * 1.2, reloadT: 0,
    tgt: null, losBadT: 0, slot: "hold", thinkAt: simT + lcg() * 0.3, lastThink: simT,
    dead: false, dieT: 0, dieDir: 1, animF: (i % 4),
    lastShotT: -9, sq: Math.floor(i / 10), sqSlot: i % 10,
    kills: 0, shotsF: 0, hitsF: 0, reloads: 0,
    // THE BODY AS THE FIGHT SEES IT, and the standing originals setStance()
    // restores. eyeLos / fireShot always read these with a man default;
    // stamping them here is what lets a crouch actually change them.
    eyeH: 1.52, losY: 1.35, aimY: 1.28, headY: 1.62,
    eyeH0: 1.52, losY0: 1.35, aimY0: 1.28, headY0: 1.62,
    stance: "stand", coverK: 1, up: true,
    // the hull-down fold he has committed to, its search clock, the pop clock
    hull: null, hullT: 0, popT: 0,
    // MORALE: his training's nerve (seeded jitter so a line does not break
    // as one body), how rattled he is, and the rout bookkeeping
    tier: tr.id, nerve: nerveFor(tr.id, i), supp: 0,
    routed: false, fled: false, routT: 0, routBest: 0, routStall: 0, rallyT: 0,
  };
  kitUp(man, teamId, tr.id, wid, i);
  man.target.set(at.x, 0, at.z);
  // where he formed up: the line a HOLD order keeps him on (ORDERS below)
  man.home = { x: at.x, z: at.z };
  if (FRONT && i === 0) plantFlag(teamId, at.x, at.z);
  (squads[teamId][man.sq] = squads[teamId][man.sq] || []).push(man);
  // when there is an air war, every man is a thing a bomb can find — through
  // ordnance's OWN cover rules, so a roof or a wall between the bang and the
  // body genuinely spares him
  if (AIR.on && CBZ.ordnance && CBZ.ordnance.addTarget) {
    man.ordTgt = CBZ.ordnance.addTarget({
      pos: man.pos, team: teamId, unit: man,
      onDamage: function (dmg, info) {
        hurtMan(man, dmg, { byTeam: info && info.team, cause: "bomb" });
      },
    });
  }
  // training tier fields combat_iq's roleTier() already reads off city actors
  if (tr.id === "swat") man.swat = true;
  else if (tr.id === "elite") man.kind = "soldier";
  else if (tr.id === "pro") man.kind = "guard";
  else if (tr.id === "thug") man.aggr = 0.92;
  if (!fists && CBZ.syncActorWeapon) CBZ.syncActorWeapon(man);
  if (MAP.water) { man.swimD = cruiseDepth(man); man.pos.y = MAP.bodyY(man, at.x, at.z); }
  // CREW: a man the roster put in a vehicle's seat rides inside it, off the
  // field, until he gets out (src/battle/vehicles.js)
  const seat = vehicleSeatFor(teamId, i);
  if (seat) { vehBoardAtSpawn(man, seat); return null; }
  return man;
}
