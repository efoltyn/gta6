"use strict";
/* src/battle/beasts.js — NPC War: THE BEASTS: an animal unit in the battle.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ THE BEASTS
   An army out of the bestiary. The body is the species' own build() — the
   same low-poly animal the mainland hunts — walked by the shared gait rig
   and fought by creature_combat's one strike driver. NOTHING here is a new
   animal AI: stats come off the species row (hp, spd, danger, bite), the
   lope comes from wildlife_rig's class table, and the bite comes from
   CBZ.creatureFight with this page's ground and damage funnel plugged into
   its seams. */
const BEAST_TUNE = {};
/* THE SPECIES' OWN FILE WINS. src/units/species/<id>.js carries the numbers
   this page fights the animal with (they were derived below, and are baked
   there now so the animal's agent owns them); the formula is the fallback
   for a species with no file. */
function beastTuning(sp) {
  let b = BEAST_TUNE[sp.id];
  if (b) return b;
  const kit = CBZ.unitKit && CBZ.unitKit.get(sp.id);
  const ks = kit && kit.stats;
  if (ks && ks.chase != null) {
    b = BEAST_TUNE[sp.id] = {
      chase: ks.chase, march: ks.march != null ? ks.march : Math.max(2.6, ks.chase * 0.55),
      dmg: ks.dmg != null ? ks.dmg : Math.max(6, (sp.bite || 10) * 1.35),
      rate: ks.rate != null ? ks.rate : 0.95 + (1 - Math.min(1, sp.danger || 0)) * 0.7,
      brave: ks.brave != null ? !!ks.brave : (sp.danger || 0) >= 0.7,
      prey: ks.prey != null ? !!ks.prey : (sp.danger || 0) < 0.15,
    };
    return b;
  }
  const cls = CBZ.wildlifeRig.classify(sp);
  // charge speed off the species' own wander speed and its class's attack
  // multiplier, lifted into the men's speed register (walkers 4.6–8.0) so
  // a wolf runs a man down and an elephant arrives like weather
  const chase = Math.max(4.2, Math.min(8.6, (sp.spd || 2) * (cls.atkM || 2.2) * 1.15));
  b = BEAST_TUNE[sp.id] = {
    chase: chase,
    march: Math.max(2.6, chase * 0.55),
    dmg: Math.max(6, (sp.bite || 10) * 1.35),   // the men's own +45% band rule, scaled for teeth
    // a dangerous animal strikes FASTER, not just harder — measured on the
    // first arena run: at a flat 1.24 s a gorilla ring-fenced by circling
    // brawlers landed ~7% of its potential strikes and thirty of them lost
    // to thirty thugs, which is not what a silverback is
    rate: 0.95 + (1 - Math.min(1, sp.danger || 0)) * 0.7,
    brave: (sp.danger || 0) >= 0.7,             // bears, cats, the gorilla: no rout in them
    prey: (sp.danger || 0) < 0.15,              // deer and rabbits fight nobody
  };
  return b;
}
function makeBeast(teamId, i, spIdIn) {
  const spId = spIdIn || unitIdAt(teamId, i);
  const sp = (CBZ.WILDLIFE_SPECIES || {})[spId];
  if (!sp || !sp.build) return null;
  const T = TEAMS[teamId];
  let group = null;
  // the body: the species file's build if it has one, else the bestiary's
  const kit = CBZ.unitKit ? CBZ.unitKit.get(spId) : null;
  try {
    group = kit && kit.build ? kit.build({ THREE: THREE, mat: CBZ.cmat, rng: lcg, id: spId, seed: i + (teamId === "red" ? 0 : 7919) })
      : sp.build({ THREE: THREE, mat: CBZ.cmat, rng: lcg });
  } catch (e) { console.warn("[war] species build failed:", spId, e); }
  if (!group) return null;
  /* EVERY ANIMAL IS AN INDIVIDUAL, if a neighbour publishes the draw.
     city/wildlife_traits.js gives each body its own multiplier off a position
     hash — most of a shoal near the species norm, the extremes earned, and
     roughly one in a few hundred off the monster tail. Read GUARDED, so this
     page behaves exactly as it always did when that file is not loaded.

     The hash argument is the spawn INDEX rather than the spawn point, and
     deliberately: the point is not known until after the body is measured,
     and (i, team) is just as order-independent, which is the property the
     traits file actually needs. */
  let sizeMul = 1;
  if (CBZ.wildlifeTraits && CBZ.wildlifeTraits.sampleSize) {
    try {
      // + the battle's seed (settings.js): another round, other individuals
      const v = +CBZ.wildlifeTraits.sampleSize(sp, (teamId === "red" ? -1 : 1) * (i + 1) * 3.7 + BATTLE_SEED * 17.31, (i + 1) * 2.3 + BATTLE_SEED * 5.77);
      /* HALF THE WORLD'S SPREAD. The bestiary's draw is for a whole population
         (calves, runts, the one-in-260 monster): 0.62-1.86 in LENGTH, i.e.
         0.24-6.4x in mass. An army is adults of fighting age, and adult
         body length varies ~10-15% (a male Bengal tiger 2.7-3.1 m). Measured
         by tools/npcwar-arena.mjs: one gorilla drew 0.66 and fought as a
         24 kg, 86 hp animal, and a 1 v 1 was decided by the dice of the size
         draw more than by the species. So the battle keeps the direction
         and half the distance from the norm. */
      if (v > 0.05 && v < 4) sizeMul = 1 + (v - 1) * 0.5;
    } catch (e) {}
  }
  const s = (sp.scale || 1) * sizeMul;
  group.scale.setScalar(s);
  // measure the body once: separation radius, aim heights, the collar seat
  const bb = new THREE.Box3().setFromObject(group);
  const H = Math.max(0.5, bb.max.y - bb.min.y);
  /* THE FOOTPRINT AN ANIMAL ACTUALLY OCCUPIES.

     The first pass took 0.3 of the SMALLER of (length, 1.6 x width) and
     capped it at 1.1 m, which asked a 2.2 m dog to keep 0.84 m from the
     next dog and a lion 1.26 m — so a pack closed up and drew straight
     through itself, exactly as reported. A body's separation circle has to
     account for the length as well as the beam, because an animal is long
     and it turns: half the mean of the two spans is the honest radius for a
     circle standing in for a body that can face any way. */
  const spanX = Math.max(0.3, bb.max.x - bb.min.x);     // nose to tail (+X authored)
  const spanZ = Math.max(0.3, bb.max.z - bb.min.z);     // across the shoulders
  const rad = Math.min(3.4, Math.max(0.45, (spanX + spanZ) * 0.28));
  /* ...AND WHERE ITS TEETH ARE, WHICH IS NOT THE SAME NUMBER AND ON A LONG
     ANIMAL IS NOT EVEN CLOSE.

     `rad` is a circle standing in for a body that can face any way, and it is
     CAPPED at 3.4 m because an uncapped one would have a herd of elephants
     spawning a bus apart. creature_combat's tooth-contact gate does not care
     about that circle at all: it asks whether the attacker's own JAW POINT —
     out at the front of the model — landed inside the victim. For a lion
     those two numbers are within a body's breadth of each other and nobody
     ever noticed. For a MEGALODON the nose is ~10 m in front of the centre
     and the cap holds the centre 3.9 m off the mark, so the jaws close eleven
     metres BEYOND the man being bitten: MEASURED, one megalodon against
     twenty men landed 0 bites in 45 s and missed 12. It was not a balance
     problem; the animal was physically unable to reach anything.

     So the nose gets measured too, and both the strike range and the
     stand-off below are stated in terms of it. Man-sized animals answer
     exactly what they always did — the max() only bites when the body is
     genuinely longer than it is wide. */
  const noseR = Math.max(0.2, bb.max.x);
  noteBodyRadius(rad);
  // the coat stays the animal's own — a thin team collar says whose side,
  // seated on the neck line the box measured rather than a guessed height
  const collar = new THREE.Mesh(CBZ.boxGeom(0.18 / s, 0.12 / s, Math.min(0.9, spanZ * 0.85) / s),
    CBZ.cmat(T.color));
  collar.position.set((bb.max.x * 0.55) / s, (H * 0.7) / s, 0);
  group.add(collar);
  const at = HOST.spawnAt(teamId, i, rad);
  group.position.set(at.x, HOST.groundAt(at.x, at.z), at.z);
  CBZ.scene.add(group);
  const tn = beastTuning(sp);
  const m = {
    id: teamId + i, team: teamId, i: i, beast: true, species: sp, tn: tn, kit: kit,
    group: group, pos: group.position, target: V(),
    heading: teamId === "red" ? 0 : Math.PI, faceH: teamId === "red" ? 0 : Math.PI,
    yaw: 0, speed: 0, state: "wander",           // gait's flee-bound reads .state
    /* SIZE IS LOAD-BEARING, NOT COSMETIC — the traits file's own words. The
       exponent is that file's too (sizeKit: dmg *= k^1.35), used on BOTH the
       bite and the body so a fight between two average individuals of the
       same species is numerically identical and only the MISMATCHES move.
       Exactly 1.0 when no size draw landed, so a page without
       wildlife_traits is byte-for-byte what it always was. */
    hp: bench ? 1e9 : Math.round((sp.hp || 40) * Math.pow(sizeMul, 1.35)),
    maxHp: bench ? 1e9 : Math.round((sp.hp || 40) * Math.pow(sizeMul, 1.35)),
    _sizeMul: sizeMul, _sizeEff: s,
    armed: false, weapon: null, launcher: false, mag: 0, magSize: 0,
    cool: 0, reloadT: 0,
    rad: rad,
    /* REACH IS A DISTANCE BETWEEN CENTRES, so it has to clear whatever the
       separation pass will hold this body away from — the men's melee
       circle (IQ.melee orbits at ~1.8 m; measured as the run where thirty
       gorillas lost to thirty thugs by idling at the edge of their own
       strike gate) AND, now that bodies keep their real footprints, a
       second animal of its own kind. Two lions holding 2.6 m apart with a
       2.47 m reach would have circled each other forever. */
    reach: Math.max(1.2 + s * 1.1, rad * 2 + 0.55, noseR * 0.95),
    noseR: noseR,
    // THE BODY A ROUND GOES THROUGH (src/battle/fire.js): the measured box in
    // the animal's own frame, nose +X, so a bullet finds the heart behind the
    // shoulder and not a circle's centre
    bodyL: spanX, bodyW: spanZ, bodyH: H, bodyX0: bb.min.x, bodyY0: bb.min.y,
    eyeH: Math.max(0.5, H * 0.8), losY: Math.max(0.35, H * 0.55),
    aimY: Math.max(0.3, H * 0.5), headY: Math.max(0.45, H * 0.8),
    tgt: null, losBadT: 0, slot: "hold", thinkAt: simT + lcg() * 0.3, lastThink: simT,
    dead: false, dieT: 0, dieDir: 1, animF: (i % 4),
    lastShotT: -9, sq: Math.floor(i / 10), sqSlot: i % 10,
    kills: 0, shotsF: 0, hitsF: 0, reloads: 0,
  };
  CBZ.faceAnimalHeading(m, m.heading);
  /* THE BODY THAT SWIMS GETS THE RIG THAT SWIMS. buildGait bails on an
     aquatic species by construction (a shark has no leg columns), so before
     the swim rig moved out of the hunting engine into wildlife_rig.js this
     page could put a megalodon on the field and it would slide through the
     sea as one rigid mesh with its jaw welded shut. Same discovery pass, same
     file, same pack — creature_combat's lunge already reaches for CBZ.swimJaw
     and now finds something on the other end of it. */
  if (CBZ.buildSwimRig && !SWIM_OLD) { try { CBZ.buildSwimRig(m); } catch (e) {} }
  // a species file that animates its own body needs no discovered leg rig
  if (!m.swim && CBZ.wildlifeRig && !(kit && kit.animate)) CBZ.wildlifeRig.buildGait(m);
  if (HOST.water) { m.swimD = cruiseDepth(m); m.pos.y = HOST.bodyY(m, at.x, at.z); }
  m.target.set(at.x, 0, at.z);
  (squads[teamId][m.sq] = squads[teamId][m.sq] || []).push(m);
  if (AIR.on && CBZ.ordnance && CBZ.ordnance.addTarget) {
    m.ordTgt = CBZ.ordnance.addTarget({
      pos: m.pos, team: teamId, unit: m,
      onDamage: function (dmg, info) {
        hurtMan(m, dmg, { byTeam: info && info.team, cause: "bomb" });
      },
    });
  }
  return m;
}
/* ONE ANIMAL'S POSE FOR ONE FRAME (frame()'s render pass, LOD-skipped there).
   The species file's own animate if it has one; else the body that swims
   beats its tail and the body with legs walks on the shared discovered rig. */
function animateBeast(m, dt) {
  if (m.kit && m.kit.animate) { try { m.kit.animate(m, dt); } catch (e) {} return; }
  if (m.swim) { if (CBZ.animateSwim) { try { CBZ.animateSwim(m, dt); } catch (e) {} } }
  else if (CBZ.wildlifeRig) { try { CBZ.wildlifeRig.animateGait(m, dt); } catch (e) {} }
}
/* HOW CLOSE TWO BODIES CAN GET, so a fist can always land on what it is
   standing next to. The separation pass holds a pair `radA + radB` apart;
   an arm swung at a fixed 1.9 m connects with a man and whiffs forever at
   a bear, which is not a difficulty setting, it is a bug. Man on man this
   answers 1.85 — the number it always used — and it grows with whatever is
   actually in front of him. */
function meleeReach(a, b) {
  return 0.95 + (a.rad || 0.45) + (b.rad || 0.45);
}
// one mover for the strike bubble: creature_combat decides where, this page
// answers to its own walls and ground — the exact locomotion seam the file
// published for water, used here for a city
function beastMove(a, dx, dz, step) {
  /* AND IT DOES NOT WALK INTO THE BODY IT IS BITING. creature_combat closes
     to 70% of the reach it was handed — right for a driver that cannot know
     how wide either party is, and a guaranteed overlap once both parties are
     lions: 0.7 x 3.13 m is 2.19 m, and two lions owe each other 2.58 m. The
     locomotion seam is the honest place to say so, because the seam exists
     exactly so the caller can own what "moving" means in its own world. */
  const t = a.tgt;
  if (t && !t.dead) {
    const cx = t.pos.x - a.pos.x, cz = t.pos.z - a.pos.z;
    const d = Math.hypot(cx, cz);
    /* AND IT STOPS WHERE ITS MOUTH ARRIVES, not where its middle does — see
       noseR in makeBeast. A body whose nose is well in front of its centre
       has to hold FURTHER OFF, or the jaws close past the thing they are
       biting. Man-sized animals take the first term, exactly as before. */
    const keep = Math.max((a.rad || 0.5) + (t.rad || 0.45), (a.noseR || 0) * 0.86);
    if (d - step < keep) step = Math.max(0, d - keep);
  }
  if (step <= 0) return;
  a.pos.x += dx * step;
  a.pos.z += dz * step;
  HOST.resolveCircle(a.pos, a.rad || 0.6, a.pos.y, 1.8);
  a.pos.y = HOST.bodyY(a, a.pos.x, a.pos.z);
}
function beastFight(m, tgt, sdt) {
  let o = m._bf;
  if (!o) {
    o = m._bf = {
      speed: 0, reach: m.reach, rate: m.tn.rate, dmg: m.tn.dmg, move: beastMove,
      onHit: null,
    };
    o.onHit = function (dmg) {
      const t = m.tgt;
      if (!t || t.dead) return;
      /* THE SAME LAW FROM THE OTHER SIDE — but through meleeAbsorb, NOT
         meleeScale, and the difference is the whole balance of this page.
         `tn.dmg` comes off the species' `bite`, which is already authored as
         what that animal does TO A MAN; running it through the two-body ratio
         would multiply the silverback by its own weight a second time and
         hand it a 70% buff nobody wrote. meleeAbsorb asks only what the
         TARGET soaks, so a beast hitting a man is worth exactly its row (no
         change at all) and a beast hitting another beast finally is not. */
      hurtMan(t, dmg * (CBZ.meleeAbsorb ? CBZ.meleeAbsorb(t, m) : 1), { by: m });
      // a struck beast shudders (creature_combat's own flinch); a struck man
      // already staggers through the damage funnel's suppression
      if (t.beast && !t.dead && CBZ.creatureFlinch) { try { CBZ.creatureFlinch(t); } catch (e) {} }
    };
  }
  o.speed = m.tn.chase * 0.9;
  /* WHAT AN INDIVIDUAL BRINGS TO THE STRIKE, both read GUARDED and both 1.0
     when the neighbour that publishes them is not loaded:
       size    a bigger animal bites harder (^1.6, a linear-dimension bite
               force — city/marine_predation.js's exponent, not a new one);
       hunger  a starving predator commits faster and a fed one dawdles.
               wildlife_traits states that as visible behaviour; this is the
               one line that makes it visible in a battle. */
  const k = m._sizeMul || 1;
  let hgM = 1;
  if (CBZ.wildlifeHunger) { try { hgM = 0.78 + (1 - CBZ.wildlifeHunger(m)) * 0.44; } catch (e) {} }
  o.dmg = m.tn.dmg * (k === 1 ? 1 : Math.pow(k, 1.35));
  o.rate = m.tn.rate * (k === 1 ? 1 : Math.sqrt(k)) * hgM;
  m.speed = 2;                       // close-quarters footwork, for the sprint-target test
  // the species file's own close fight, else the one shared strike driver
  const res = m.kit && m.kit.fight ? m.kit.fight(m, tgt, sdt, o) : CBZ.creatureFight(m, tgt, sdt, o);
  /* THE TEETH, COUNTED. creature_combat now lands a strike on real jaw
     contact rather than on a centre-to-centre range test, and `missed` is
     its verdict when the animal committed and the jaws closed short. A
     spectator can SEE that snap; a checker needs the number, and a bite
     ledger that never records a miss is the tell that the gate is off. */
  if (res && PROBE) {
    if (res.dealt > 0) BITES.landed++;
    else if (res.missed) BITES.missed++;
  }
  m.heading = typeof m.heading === "number" ? m.heading : 0;
  m.faceH = m.heading;
}
