/* ============================================================
   weapons/weapon-data.js - tuning data + run weapon inventory.

   FALLOFF SHAPES (combat-realism pass): every weapon used to share ONE
   linear damage-vs-distance ramp (full damage to dropStart, then a
   straight line down to minDamage at range) regardless of weapon class —
   a shotgun "fell off" exactly like a sniper. Real guns don't: pellets
   spread into a cone and lose authority FAST past their effective range,
   a sniper round barely sheds energy across realistic engagement
   distances (it just runs out of MAP), an SMG drops off a cliff past
   close quarters, and a rifle sits in between. `falloff` is a curve-SHAPE
   tag consumed by ONE shared evaluator (CBZ.weaponFalloffMul, fpsmode.js's
   gunHit/cityGunHit call it instead of each rolling its own formula) — add
   a shape here, every caller gets it for free, no copy-pasted math per gun.
     "flat"    — pistols/rifles: the original straight ramp (default if
                 `falloff` is omitted, so nothing regresses).
     "pellet"  — shotgun: fast EXPONENTIAL decay past dropStart (the cone
                 has already spread the pattern thin) but a sharper near-
                 dropStart shoulder so close-range blasts still one-shot.
     "sniper"  — minimal falloff across the ENTIRE listed range (a slow
                 sqrt-shaped curve, never below ~0.92x even at max range)
                 — the one-shot potential is in the flat `damage`/headMult,
                 not the falloff; SNIPER_DROP below adds a separate ballistic
                 drop/lead effect on TOP of this (see (b)/(f) in fpsmode.js).
     "smg"     — steep close-range-favoured falloff (quadratic past
                 dropStart) — SMGs/uzis hit hard in a room, fall apart at
                 range, harder than the rifle curve.
     "rifle"   — moderate/balanced (gentle quadratic) — between flat and
                 smg; carbine/AK/LMG land here for a believable mid-curve.
   minDamage still acts as the curve's floor in every shape.

   SNIPER DROP (b): dropStart/range alone don't model a slow bullet falling
   over a long flight — sniperDrop{} below feeds fpsmode's per-shot travel
   estimate (NOT a literal projectile — bullets stay hitscan per the owner's
   call — just a small "where would this round actually have arrived"
   correction at range, the bullet-equivalent of the RPG's true flight time).

   HOW A GUN IS HELD (`bipod` / `hold`) — OWNER, 2026-08-03: "fix how character
   holds guns, especially those like light machine gun that have a bipod."
   Both fields are DATA the body reads; neither is a pose and neither names a
   weapon anywhere else in the codebase:
     bipod:true  — the appearance factory draws real legs (see
                   weapons/appearances/lmg.js, which publishes
                   userData.bipod{hinges,feet}). fpsmode's bipodActive() keys
                   on THIS, not on `key === "lmg"`, so the day a second
                   belt-fed gun or a bipod sniper ships it is one field, not a
                   new branch. Prone counts as deployed: legs on the deck IS
                   the stance the hardware exists for.
     hold.heavy  — 0..1 "carry this with the weight low". entities/character.js
                   blends it into the low-ready and present poses: the support
                   hand moves FORWARD under the handguard, the elbow closes,
                   and the gun hand rides lower. 0 (or absent) is exactly the
                   pose every weapon has always had, so nothing regresses.
     hold.support — extra metres of forward reach for the support hand, on the
                   same 0..1 scale of the arm's travel. A launcher gets very
                   little (it rides the shoulder); a belt-fed gun gets the most.

   REAL DIMENSIONS (`real`) — gun-scale pass, 2026-08-16 (owner: "many feel
   small scale to human in game — make all math sized"). Every row now carries
   the researched overall length (metres, muzzle to butt) of the actual firearm
   its model portrays. weapons/weapon-scale.js consumes this: it measures each
   appearance model's authored length once and derives ONE mathematically
   consistent display scale for every consumer (NPC hands, player third-person,
   stowed mounts, racks, shops, floor drops) instead of the five unrelated
   magic scalars those call sites used to carry. `real.ref` names the reference
   weapon + source so the number can be re-checked, not re-guessed.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};

  CBZ.FPS_WEAPONS = [
    {
      id: "sidearm", key: "sidearm", label: "9MM SIDEARM", short: "9MM", slot: "pistol",
      appearanceFactory: "sidearm", magSize: 17, fireMode: "semi", fireDelay: 0.145, reloadTime: 1.05,
      mag: 17, reserve: 85, reload: 1.05, interval: 0.145, range: 82,
      damage: 36, headMult: 2.6, dropStart: 44, minDamage: 0.58, falloff: "flat",
      spread: 0.0055, bodyRadius: 0.62, headRadius: 0.33,
      recoil: 0.21, maxRecoil: 0.58, climb: 0.023, sideKick: 0.016,
      recenter: 0.12, rampMax: 1.5, yawWeave: 0.45,
      shake: 0.26, heat: 44, knock: 1.35, flash: 0.34,
      sfx: "shoot_pistol", tracer: 0.018, auto: false,
      real: { len: 0.204, ref: "Glock 17 — 204mm OAL (us.glock.com)" },
      hold: { heavy: 0.08, support: 0, stance: "pistol" },
    },
    {
      id: "shotgun", key: "shotgun", label: "12G PUMP", short: "12G", slot: "long",
      appearanceFactory: "shotgun", magSize: 6, fireMode: "pump", fireDelay: 0.78, reloadTime: 0.42,
      mag: 6, reserve: 30, reload: 0.42, interval: 0.78, range: 44,
      damage: 18, headMult: 1.35, dropStart: 14, minDamage: 0.34, falloff: "pellet",
      spread: 0.061, pellets: 9, bodyRadius: 0.78, headRadius: 0.36,
      recoil: 0.60, maxRecoil: 0.98, climb: 0.058, sideKick: 0.034,
      recenter: 0.25, rampMax: 1.0, yawWeave: 0.3,
      shake: 0.74, heat: 64, knock: 2.45, flash: 0.70,
      sfx: "shoot_shotgun", tracer: 0.014, shellReload: true, pump: true,
      auto: false,
      real: { len: 0.978, ref: "Remington 870, 18.5in barrel — 38.5in OAL (thegunzone)" },
      hold: { heavy: 0.38, support: 0.28, stance: "long" },
    },
    {
      id: "carbine", key: "carbine", label: "M4 CARBINE", short: "556", slot: "rifle",
      appearanceFactory: "carbine", magSize: 30, fireMode: "auto", fireDelay: 0.084, reloadTime: 1.45,
      mag: 30, reserve: 120, reload: 1.45, interval: 0.084, range: 118,
      damage: 28, headMult: 2.25, dropStart: 72, minDamage: 0.62, falloff: "rifle",
      spread: 0.0072, bodyRadius: 0.61, headRadius: 0.32,
      recoil: 0.115, maxRecoil: 0.68, climb: 0.013, sideKick: 0.024,
      recenter: 0.18, rampMax: 1.8, yawWeave: 1.0,
      shake: 0.20, heat: 39, knock: 1.08, flash: 0.42,
      sfx: "shoot_carbine", tracer: 0.012, auto: true,
      real: { len: 0.838, ref: "Colt M4, stock extended — 33in/838mm OAL (Wikipedia)" },
      hold: { heavy: 0.26, support: 0.27, stance: "long" },
    },
    {
      id: "smg", key: "smg", label: "COMPACT SMG", short: "SMG", slot: "auto",
      appearanceFactory: "smg", magSize: 32, fireMode: "auto", fireDelay: 0.064, reloadTime: 1.25,
      mag: 32, reserve: 128, reload: 1.25, interval: 0.064, range: 72,
      damage: 21, headMult: 2.05, dropStart: 36, minDamage: 0.50, falloff: "smg",
      spread: 0.0105, bodyRadius: 0.63, headRadius: 0.33,
      recoil: 0.085, maxRecoil: 0.74, climb: 0.010, sideKick: 0.034,
      recenter: 0.15, rampMax: 1.8, yawWeave: 1.4,
      shake: 0.17, heat: 34, knock: 0.90, flash: 0.36,
      sfx: "shoot_smg", tracer: 0.010, auto: true,
      real: { len: 0.680, ref: "H&K MP5A2, fixed stock — 680mm OAL (Wikipedia)" },
      hold: { heavy: 0.20, support: 0.19, stance: "compact" },
    },
    {
      id: "revolver", key: "revolver", label: ".357 MAGNUM", short: "357", slot: "pistol",
      appearanceFactory: "revolver",   // own silhouette: cylinder + hammer + underlug (was sharing the 9mm's) magSize: 6, fireMode: "semi", fireDelay: 0.5, reloadTime: 1.6,
      mag: 6, reserve: 36, reload: 1.6, interval: 0.5, range: 92,
      damage: 64, headMult: 2.8, dropStart: 50, minDamage: 0.66, falloff: "flat",
      spread: 0.004, bodyRadius: 0.62, headRadius: 0.33,
      recoil: 0.42, maxRecoil: 0.8, climb: 0.05, sideKick: 0.02,
      recenter: 0.14, rampMax: 1.5, yawWeave: 0.4,
      shake: 0.5, heat: 52, knock: 2.4, flash: 0.5,
      sfx: "shoot_deagle", tracer: 0.02, auto: false,   // big-bore voice (real .45 recording)
      real: { len: 0.292, ref: "Colt Python, 6in barrel — 11.5in OAL (colt.com/Wikipedia)" },
      hold: { heavy: 0.24, support: 0, stance: "pistol" },
    },
    {
      id: "deagle", key: "deagle", label: ".50 DESERT EAGLE", short: "50AE", slot: "pistol",
      appearanceFactory: "deagle",     // own silhouette: massive slab slide + .50 bore (was sharing the 9mm's) magSize: 7, fireMode: "semi", fireDelay: 0.4, reloadTime: 1.35,
      mag: 7, reserve: 49, reload: 1.35, interval: 0.4, range: 90,
      damage: 75, headMult: 2.7, dropStart: 48, minDamage: 0.64, falloff: "flat",
      spread: 0.0045, bodyRadius: 0.62, headRadius: 0.33,
      recoil: 0.5, maxRecoil: 0.86, climb: 0.058, sideKick: 0.026,
      recenter: 0.15, rampMax: 1.5, yawWeave: 0.4,
      shake: 0.56, heat: 56, knock: 2.7, flash: 0.56,
      sfx: "shoot_deagle", tracer: 0.022, auto: false,  // big-bore voice (real .45 recording)
      real: { len: 0.273, ref: "Desert Eagle Mk XIX, 6in barrel — 10.75in OAL (magnumresearch)" },
      hold: { heavy: 0.34, support: 0, stance: "pistol" },
    },
    {
      // The status rifle: out-damages the carbine per round but handles LAZY —
      // slow to bring up (equip), slow to feed (reload), and run-and-gun throws
      // shots wide (moveSpread). Plant your feet and it earns its price tag.
      id: "ak47", key: "ak47", label: "AK-47", short: "762", slot: "rifle",
      appearanceFactory: "ak47", magSize: 30, fireMode: "auto", fireDelay: 0.097, reloadTime: 1.8,
      mag: 30, reserve: 120, reload: 1.8, interval: 0.097, range: 112,
      damage: 34, headMult: 2.3, dropStart: 64, minDamage: 0.6, falloff: "rifle",
      spread: 0.011, moveSpread: 2.3, bodyRadius: 0.61, headRadius: 0.32,
      recoil: 0.17, maxRecoil: 0.82, climb: 0.02, sideKick: 0.03,
      recenter: 0.2, rampMax: 1.9, yawWeave: 1.1,
      shake: 0.28, heat: 46, knock: 1.4, flash: 0.5, equip: 0.5,
      sfx: "shoot_ak47", tracer: 0.013, auto: true,   // dedicated layered voice (audio.js) owns the pitch/weight
      real: { len: 0.880, ref: "AK-47, fixed stock — 880mm OAL (Wikipedia)" },
      hold: { heavy: 0.54, support: 0.31, stance: "long" },
    },
    {
      id: "uzi", key: "uzi", label: "MICRO UZI", short: "UZI", slot: "auto",
      appearanceFactory: "uzi",        // own silhouette: mag-in-grip stub + wire stock (was sharing the MP5's) magSize: 25, fireMode: "auto", fireDelay: 0.052, reloadTime: 1.15,
      mag: 25, reserve: 125, reload: 1.15, interval: 0.052, range: 56,
      damage: 16, headMult: 1.9, dropStart: 26, minDamage: 0.45, falloff: "smg",
      spread: 0.016, bodyRadius: 0.63, headRadius: 0.33,
      recoil: 0.075, maxRecoil: 0.78, climb: 0.009, sideKick: 0.044,
      recenter: 0.15, rampMax: 1.8, yawWeave: 1.5,
      shake: 0.15, heat: 30, knock: 0.7, flash: 0.3,
      sfx: "shoot_smg", tracer: 0.009, auto: true,
      real: { len: 0.267, ref: "IMI Micro Uzi, stock folded — 267mm OAL (dockeryarmory)" },
      hold: { heavy: 0.12, support: 0.10, stance: "compact" },
    },
    {
      id: "sniper", key: "sniper", label: "BOLT SNIPER", short: "SNIP", slot: "rifle",
      appearanceFactory: "sniper",     // own silhouette: scope + bolt + long barrel (was sharing the M4's) magSize: 5, fireMode: "bolt", fireDelay: 1.25, reloadTime: 2.0,
      mag: 5, reserve: 25, reload: 2.0, interval: 1.25, range: 240,
      damage: 130, headMult: 3.0, dropStart: 180, minDamage: 0.85, falloff: "sniper",
      spread: 0.0015, bodyRadius: 0.6, headRadius: 0.34,
      recoil: 0.6, maxRecoil: 0.95, climb: 0.07, sideKick: 0.01,
      recenter: 0.3, rampMax: 1.0, yawWeave: 0.15,
      shake: 0.66, heat: 70, knock: 3.0, flash: 0.6,
      sfx: "shoot_sniper", tracer: 0.02, auto: false,   // dedicated long-boom voice (Mosin recording)
      // BALLISTIC DROP (b): past `start`, the tracer/impact is nudged DOWN
      // (world units) proportional to (dist-start), capped at `maxDrop` — a
      // slow heavy round sagging over a long flight. `flightPerM` is seconds
      // of perceived travel time per metre past `start` (drives a short hit-
      // resolution DELAY so a far shot doesn't land in the same instant it's
      // fired — the "real flight" feel — without making the round an actual
      // simulated projectile other systems would need to track).
      sniperDrop: { start: 90, perM: 0.0095, maxDrop: 1.6, flightPerM: 0.0011 },
      real: { len: 1.092, ref: "M24 SWS (Rem 700) — 43in/1092mm OAL (Wikipedia)" },
      hold: { heavy: 0.6, support: 0.36, stance: "long" }, // long heavy barrel, support hand well forward
    },
    {
      id: "lmg", key: "lmg", label: "M249 LMG", short: "LMG", slot: "auto",
      appearanceFactory: "lmg",        // own silhouette: ammo box + bipod + feed cover (was sharing the M4's) magSize: 100, fireMode: "auto", fireDelay: 0.075, reloadTime: 3.2,
      mag: 100, reserve: 200, reload: 3.2, interval: 0.075, range: 120,
      damage: 27, headMult: 2.0, dropStart: 60, minDamage: 0.58, falloff: "rifle",
      spread: 0.014, bodyRadius: 0.62, headRadius: 0.32,
      recoil: 0.16, maxRecoil: 0.88, climb: 0.018, sideKick: 0.034,
      recenter: 0.22, rampMax: 2.0, yawWeave: 1.0,
      shake: 0.3, heat: 50, knock: 1.3, flash: 0.55,
      sfx: "shoot_lmg", tracer: 0.014, auto: true,      // dedicated belt-fed voice
      // The legs in the model are hardware, not decoration: prone or braced
      // they carry the gun, and the body rests it on them.
      bipod: true,
      real: { len: 1.035, ref: "FN M249 SAW, std barrel — 40.75in OAL (fnamerica.com)" },
      hold: { heavy: 1.0, support: 0.46, stance: "heavy" }, // 7.5 kg belt-fed — the heaviest carry in the game
    },
    {
      id: "bazooka", key: "bazooka", label: "RPG / ROCKET LAUNCHER", short: "RPG", slot: "long",
      appearanceFactory: "bazooka", magSize: 1, fireMode: "single", fireDelay: 1.4, reloadTime: 1.4,
      mag: 1, reserve: 4, reload: 1.4, interval: 1.4, range: 200,
      damage: 1, headMult: 1.0, dropStart: 200, minDamage: 1.0, falloff: "flat",
      spread: 0.004, bodyRadius: 0.62, headRadius: 0.33,
      recoil: 0.9, maxRecoil: 1.0, climb: 0.08, sideKick: 0.02,
      recenter: 0.4, rampMax: 1.0, yawWeave: 0, noRecoil: true,
      shake: 1.1, heat: 70, knock: 3.0, flash: 0.9,
      // LAUNCH sound is a deep tube THUMP, not the boom: the fire sfx used to
      // be the same "explosion" sample crashfx plays at impact, so the ear got
      // the boom at t=0 and the eye got it ~0.3s later — that gap read as lag
      // (owner: "takes too long from after i shoot"). The boom now happens
      // exactly once, where the rocket lands (crashfx owns it).
      sfx: "shoot_shotgun", sfxPitch: 0.62, sfxVol: 1.25, tracer: 0.03, auto: false,
      explosive: true, blastPower: 1.9, blastRadius: 13,
      // X cycles the loaded guidance package while this weapon is shouldered.
      // Both consume the same physical rocket inventory; only the seeker and
      // flight tuning differ, so inventory code does not need a parallel gun.
      ammoTypes: [
        { id: "standard", label: "HE-GUIDED", homing: true, lockRange: 250, lockConeDeg: 20, turnRate: 2.35, speed: 95 },
        { id: "homing", label: "HOMING", homing: true, lockRange: 260, lockConeDeg: 18, turnRate: 2.6, speed: 82 },
      ],
      // REAL PROJECTILE FLIGHT (b): muzzle velocity (m/s) and gravity (m/s^2)
      // for the visible travel arc fpsmode.js now flies the rocket along
      // instead of resolving impact the instant the trigger is pulled.
      // OWNER RE-TUNE (2026-07-27, "takes too long from after i shoot"):
      // fpsmode's WEAPON_ROCKET_PACE_V2 multiplies every rocket speed here by
      // 1.2 (95 → 114 u/s effective, still far under a real RPG-7's ~295 m/s
      // sustained) and repays the soft-launch ramp with a sustainer burst, so
      // a 30u shot lands in ~0.28s guided / ~0.26s ballistic instead of the
      // old ~0.64s guided. CBZ.weaponLatencyAudit() prints the live budget.
      // projGravity stays a mild arc (real RPGs are near-flat over city
      // ranges, but zero gravity read as "still hitscan" in testing).
      projSpeed: 95, projGravity: 6,
      // real.len is the LOADED length: 950mm launcher (Wikipedia) plus the
      // PG-7 warhead riding ahead of the bell — the model draws the rocket
      // loaded, so the researched length must include it too (~1.35m).
      real: { len: 1.35, ref: "RPG-7 950mm + loaded PG-7 warhead ≈ 1.35m (weaponsystems.net)" },
      // The tube rides the SHOULDER, so the support hand stays close to the
      // body: heavy, but with almost none of the LMG's forward reach.
      hold: { heavy: 0.8, support: 0.10, stance: "shoulder" },
    },
    {
      id: "taser", key: "taser", label: "X26 TASER", short: "TASER", slot: "utility",
      appearanceFactory: "taser", magSize: 2, fireMode: "stun", fireDelay: 0.92, reloadTime: 1.05,
      mag: 2, reserve: 10, reload: 1.05, interval: 0.92, range: 22,
      damage: 10, headMult: 1.0, dropStart: 18, minDamage: 0.85, falloff: "flat",
      spread: 0.010, bodyRadius: 0.80, headRadius: 0.36,
      recoil: 0.05, maxRecoil: 0.22, climb: 0.004, sideKick: 0.006,
      recenter: 0.12, rampMax: 1.0, yawWeave: 0.2,
      shake: 0.12, heat: 14, knock: 0.40, flash: 0.22,
      sfx: "shoot_taser", tracer: 0.006, auto: false, nonlethal: true,
      real: { len: 0.185, ref: "Taser X26 with cartridge — 7.3in OAL (X26E spec sheet)" },
      hold: { heavy: 0.04, support: 0, stance: "pistol" },
    },
    {
      /* SHANK — the first MELEE weapon in this table, and the reason `melee`
         exists as a field.

         Prison Escape is a mode about shivs, and the shiv was a number. It
         lived at systems/combat.js's `11 + (hasItem("Shiv") ? 9 : 0)`: having
         one IN THE BAG made your BARE FIST hit for nine more, and the wound it
         opened was `melee:"blunt"` — a bruise. You could not hold it, draw it,
         see it, drop it or stab with it, and `buildActorWeapon("Shiv")` fell
         through NAME_TO_ID and handed back a 9 mm pistol.

         Registering it HERE — rather than inventing a prison-local blade — is
         what makes it physical for free, because every one of those consumers
         is already keyed off this row: actorweapons builds the hand model,
         holsterprops stows it in the waistband, prisondrops throws it on the
         floor with real mass, itemicons PHOTOGRAPHS it for the bag icon, and
         fpsmode gives it a first-person viewmodel. One row, six systems.

         `melee: true` is the only new behaviour, and it means exactly one
         thing: this weapon does not fire. fpsmode's shoot() diverts to the
         stab before it touches a magazine, so every ammo/reload/recoil/tracer
         field below would be dead weight — the ones that remain are the ones
         a melee weapon genuinely has. `range` is the REACH (fists are 1.9;
         a held blade buys ~20 cm) and `interval` is the time between thrusts:
         fast, because that is a shank's whole character — you do not wind up
         with one, you put it in someone four times before they answer.

         slot "utility" is deliberate reuse, not laziness: it is the taser's
         slot, and it already means "small, one-handed, rides the hip, poses
         like a pistol" in setReadyPose / holsterprops / buildActorWeapon's
         scale. That is a shank's carry exactly. A new slot value would have
         meant auditing every `slot ===` branch in the tree for no gain. */
      id: "shank", key: "shank", label: "PRISON SHANK", short: "SHANK", slot: "utility",
      appearanceFactory: "shank", melee: true,
      mag: 0, reserve: 0, reload: 0, interval: 0.42, range: 2.12,
      damage: 26, headMult: 1.9, dropStart: 2.12, minDamage: 1.0, falloff: "flat",
      spread: 0, bodyRadius: 0.70, headRadius: 0.34,
      recoil: 0, maxRecoil: 0, climb: 0, sideKick: 0,
      recenter: 0, rampMax: 1.0, yawWeave: 0,
      shake: 0.30, heat: 9, knock: 0.55, flash: 0,
      sfx: "punch", tracer: 0, auto: false,
      // What the blade does that a fist cannot: it OPENS people. Consumed by
      // systems/combat.js's stab (wounds.js draws the `blade` kind, gore.js's
      // "stabbed" cause throws the arterial arcs) — both of which have existed
      // in this engine for months with nothing in the prison able to reach them.
      bleed: 0.55, woundKind: "blade",
      // No factory spec sheet for contraband: a ground-stock shiv with a
      // wrapped grip runs 20-30cm end to end; 0.26 sits mid-band.
      real: { len: 0.26, ref: "improvised stock shiv, blade + wrapped grip ≈ 26cm" },
      hold: { heavy: 0, support: 0, stance: "pistol" },
    },
    {
      // GRENADE LAUNCHER (owner ask): the RPG's beautiful explosion, less
      // reloading. It is a pure REUSE weapon: `explosive: true` routes it
      // through fpsmode's existing rocket branch — SAME blastPower/blastRadius
      // as the bazooka, so cityExplosion runs the byte-identical FX chain (no
      // new composer, no new FX). What is authored here is only the launcher's
      // own character: a 6-round drum (reload a fifth as often as the RPG's
      // single tube), a slower lofted round (projSpeed 50 / heavy projGravity
      // arc — a lobbed 40mm, not a flat rocket), and NO guidance: dumbfire
      // gates it out of lockon.js's missile platform, homing:false keeps
      // pull-time acquisition off, and the explicit ammoTypes row stops
      // rocketAmmoSpec's DEFAULT_ROCKET_SPEC (homing:true) from adopting it.
      // projPlain strips the shared projectile mesh's exhaust flame + fins for
      // this weapon's flights — a launched shell, not a burning rocket.
      id: "glauncher", key: "glauncher", label: "GRENADE LAUNCHER", short: "40MM", slot: "long",
      appearanceFactory: "glauncher",
      mag: 6, reserve: 18, reload: 2.3, interval: 0.72, range: 200,
      damage: 1, headMult: 1.0, dropStart: 200, minDamage: 1.0, falloff: "flat",
      spread: 0.006, bodyRadius: 0.62, headRadius: 0.33,
      recoil: 0.5, maxRecoil: 0.9, climb: 0.045, sideKick: 0.02,
      recenter: 0.2, rampMax: 1.0, yawWeave: 0.2,
      shake: 0.6, heat: 70, knock: 2.2, flash: 0.5,
      sfx: "shoot_shotgun", sfxPitch: 0.72, sfxVol: 1.1, tracer: 0.02, auto: false,
      explosive: true, blastPower: 1.9, blastRadius: 13,
      // authored 42 → ~50 u/s effective under fpsmode's PACE_SPEED_MUL (1.2):
      // 30m in ~0.6s with a real visible loft — the hang IS this weapon's
      // identity next to the flat fast rocket.
      dumbfire: true, projPlain: true,
      ammoTypes: [{ id: "standard", label: "40MM HE", homing: false, speed: 42 }],
      projSpeed: 42, projGravity: 24,
      real: { len: 0.778, ref: "Milkor MGL/M32, stock extended — 778mm OAL (Wikipedia)" },
      hold: { heavy: 0.58, support: 0.29, stance: "long" },
    },
  ];

  // ---- SHARED DAMAGE-FALLOFF EVALUATOR (e) ----------------------------------
  // ONE function every shooter (fpsmode.js gunHit/cityGunHit; usable by any
  // future caller, e.g. NPC weapons) calls instead of rolling its own ramp.
  // Returns a 0..1 multiplier on base damage for a hit at `dist`. Curve shape
  // comes from w.falloff (defaults to "flat" = the original linear ramp, so
  // any weapon without an explicit tag is byte-identical to before this pass).
  function falloffMul(w, dist) {
    const start = w.dropStart != null ? w.dropStart : w.range;
    const range = Math.max(1, w.range || start || 1);
    const floor = w.minDamage != null ? w.minDamage : 0.5;
    if (dist <= start) return 1;
    const span = Math.max(1, range - start);
    const t = Math.min(1, (dist - start) / span);   // 0 at dropStart .. 1 at max range
    const shape = w.falloff || "flat";
    let k;
    switch (shape) {
      case "pellet":   // shotgun: the pattern has already spread thin — decays
        // fast (cubic ease, not a straight line) so a pellet blast loses most
        // authority quickly past its short dropStart, while still easing OUT
        // of 1.0 at t=0 (not an instant cliff) so a hair past dropStart isn't
        // a damage discontinuity.
        k = 1 - (1 - Math.pow(1 - t, 3));
        break;
      case "sniper":   // a heavy slow round barely sheds energy across its
        // listed range — high exponent biases the curve to stay near 1.0
        // until late t, only easing toward the (high) floor near max range.
        k = 1 - Math.pow(t, 1.6) * (1 - floor);
        break;
      case "smg":      // steep close-range-favoured drop-off — quadratic-plus,
        // an SMG falls apart fast once past its short effective range.
        k = 1 - Math.pow(t, 0.85) * (1 - floor);
        break;
      case "rifle":    // moderate/balanced — gentle quadratic between flat and smg.
        k = 1 - Math.pow(t, 1.3) * (1 - floor);
        break;
      case "flat":
      default:         // the original straight linear ramp (unchanged feel).
        k = 1 - t * (1 - floor);
        break;
    }
    return Math.max(floor, Math.min(1, k));
  }
  CBZ.weaponFalloffMul = falloffMul;

  // NPC tracer spread — per weapon-SLOT half-angle (radians) of the visual
  // jitter applied to city NPC bullet streaks (city/combat.js tracer wrap,
  // gated by CBZ.CONFIG.NPC_TRACER_SPREAD). Slots match FPS_WEAPONS above:
  // pistols/autos are sloppier, rifles tighter, "long" = shotgun/launcher.
  // Typical miss offset ≈ 0.5 × value × distance (≈0.65m for a pistol at 20m).
  CBZ.NPC_SPREAD = { pistol: 0.065, rifle: 0.040, auto: 0.090, long: 0.075, utility: 0.055, _def: 0.055 };

  CBZ.weaponInventory = CBZ.weaponInventory || [];
  CBZ.currentWeaponId = CBZ.currentWeaponId || null;

  // Prison Escape owns ten physical number slots: 1 is permanently the
  // player's empty hands, while 2..0 are a reorderable firearm loadout. Keep
  // the mapping beside weaponInventory (the ownership truth) so the HUD, stash,
  // keyboard and touch surfaces cannot each invent a different order.
  const PRISON_SLOT_KEYS = Object.freeze(["2", "3", "4", "5", "6", "7", "8", "9", "0"]);
  const prisonSlots = CBZ.prisonWeaponSlots = Array.isArray(CBZ.prisonWeaponSlots)
    ? CBZ.prisonWeaponSlots.slice(0, PRISON_SLOT_KEYS.length)
    : [];
  while (prisonSlots.length < PRISON_SLOT_KEYS.length) prisonSlots.push(null);

  function normalizeId(id) {
    const w = CBZ.FPS_WEAPONS.find((x) => x.id === id || x.key === id);
    return w ? w.id : null;
  }

  function weaponById(id) {
    const nid = normalizeId(id);
    return nid ? CBZ.FPS_WEAPONS.find((w) => w.id === nid) : null;
  }

  function reconcilePrisonSlots() {
    const owned = new Set();
    for (let i = 0; i < CBZ.weaponInventory.length; i++) {
      const id = normalizeId(CBZ.weaponInventory[i]);
      if (id) owned.add(id);
    }
    const seen = new Set();
    for (let i = 0; i < prisonSlots.length; i++) {
      const id = normalizeId(prisonSlots[i]);
      if (!id || !owned.has(id) || seen.has(id)) prisonSlots[i] = null;
      else { prisonSlots[i] = id; seen.add(id); }
    }
    // A new pickup becomes usable immediately, but never disturbs a player's
    // existing arrangement. Once all nine slots are occupied, later pickups
    // wait in the stash's UNASSIGNED row until the player chooses a home.
    for (let i = 0; i < CBZ.weaponInventory.length; i++) {
      const id = normalizeId(CBZ.weaponInventory[i]);
      if (!id || seen.has(id)) continue;
      const free = prisonSlots.indexOf(null);
      if (free < 0) break;
      prisonSlots[free] = id;
      seen.add(id);
    }
    return prisonSlots;
  }

  function assignPrisonWeaponSlot(slot, id) {
    slot = slot | 0;
    if (slot < 0 || slot >= prisonSlots.length) return false;
    const nid = id == null ? null : normalizeId(id);
    if (nid && CBZ.weaponInventory.indexOf(nid) < 0) return false;
    reconcilePrisonSlots();
    const from = nid ? prisonSlots.indexOf(nid) : -1;
    const displaced = prisonSlots[slot] || null;
    if (from === slot) return true;
    prisonSlots[slot] = nid;
    if (from >= 0) prisonSlots[from] = displaced;
    return true;
  }

  function swapPrisonWeaponSlots(a, b) {
    a |= 0; b |= 0;
    if (a < 0 || a >= prisonSlots.length || b < 0 || b >= prisonSlots.length) return false;
    reconcilePrisonSlots();
    const t = prisonSlots[a]; prisonSlots[a] = prisonSlots[b]; prisonSlots[b] = t;
    return true;
  }

  function prisonUnslottedWeapons() {
    reconcilePrisonSlots();
    return CBZ.weaponInventory.filter((id) => prisonSlots.indexOf(normalizeId(id)) < 0);
  }

  function syncLegacyGunItem() {
    // the shared weapon strip already shows every held gun; mirroring a "Gun"
    // proxy into the 9-slot bag would double-report the same fact
    if (CBZ.CONFIG.WEAPON_STRIP_SHARED !== false) return;
    if (CBZ.econ && CBZ.weaponInventory.length && !CBZ.econ.hasItem("Gun")) {
      CBZ.econ.addItem("Gun", 1);
    }
  }

  function unlockWeapon(id, opts) {
    opts = opts || {};
    const nid = normalizeId(id);
    if (!nid) return false;
    const first = CBZ.weaponInventory.indexOf(nid) < 0;
    if (first) CBZ.weaponInventory.push(nid);
    reconcilePrisonSlots();
    if (opts.select !== false || !CBZ.currentWeaponId) CBZ.currentWeaponId = nid;
    syncLegacyGunItem();
    if (CBZ.onWeaponInventoryChanged) CBZ.onWeaponInventoryChanged(nid, first);
    return first;
  }

  function hasWeapon(id) {
    const nid = normalizeId(id);
    return !!nid && CBZ.weaponInventory.indexOf(nid) >= 0;
  }

  /* The inverse of unlockWeapon, and it exists because the SHANK is the first
     weapon in this table that is also a bag ITEM. A gun you own, you own; a
     shiv can be confiscated at reception (systems/prisontiers.js's CONTRA
     sweep), traded, or simply used up. Without a way to hand the row back, the
     weapon rail would keep offering a blade the player no longer has — which is
     the same class of lie as the blade that could not be held. */
  function lockWeapon(id) {
    const nid = normalizeId(id);
    if (!nid) return false;
    const i = CBZ.weaponInventory.indexOf(nid);
    if (i < 0) return false;
    CBZ.weaponInventory.splice(i, 1);
    if (CBZ.currentWeaponId === nid) CBZ.currentWeaponId = CBZ.weaponInventory[0] || null;
    reconcilePrisonSlots();
    if (CBZ.onWeaponInventoryChanged) CBZ.onWeaponInventoryChanged(nid, false);
    return true;
  }

  function hasAnyWeapon() {
    return CBZ.weaponInventory.length > 0;
  }

  function equippedWeapon() {
    return hasWeapon(CBZ.currentWeaponId) ? weaponById(CBZ.currentWeaponId) : null;
  }

  function setCurrentWeapon(id) {
    const nid = normalizeId(id);
    if (!nid || !hasWeapon(nid)) return false;
    CBZ.currentWeaponId = nid;
    if (CBZ.onWeaponInventoryChanged) CBZ.onWeaponInventoryChanged(nid, false);
    return true;
  }

  function resetWeaponInventory(role) {
    CBZ.weaponInventory.length = 0;
    CBZ.currentWeaponId = null;
    prisonSlots.fill(null);
    if (role === "cop") {
      unlockWeapon("sidearm", { select: true });
      unlockWeapon("taser", { select: false });
    }
  }

  CBZ.weaponById = weaponById;
  CBZ.PRISON_WEAPON_SLOT_KEYS = PRISON_SLOT_KEYS;
  CBZ.prisonWeaponLoadout = reconcilePrisonSlots;
  CBZ.assignPrisonWeaponSlot = assignPrisonWeaponSlot;
  CBZ.swapPrisonWeaponSlots = swapPrisonWeaponSlots;
  CBZ.prisonUnslottedWeapons = prisonUnslottedWeapons;
  CBZ.prisonWeaponLoadoutAudit = function () {
    const slots = reconcilePrisonSlots().slice();
    const assigned = slots.filter(Boolean);
    return {
      fistsKey: "1",
      gunKeys: PRISON_SLOT_KEYS.join(""),
      slots,
      assigned: assigned.length,
      unique: new Set(assigned).size,
      unassigned: prisonUnslottedWeapons().length,
    };
  };
  CBZ.unlockWeapon = unlockWeapon;
  CBZ.lockWeapon = lockWeapon;
  CBZ.hasWeapon = hasWeapon;
  CBZ.hasAnyWeapon = hasAnyWeapon;
  CBZ.equippedWeapon = equippedWeapon;
  CBZ.setCurrentWeapon = setCurrentWeapon;
  CBZ.resetWeaponInventory = resetWeaponInventory;
})();
