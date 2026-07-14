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
      sfx: "explosion", tracer: 0.03, auto: false,
      explosive: true, blastPower: 1.9, blastRadius: 13,
      // X cycles the loaded guidance package while this weapon is shouldered.
      // Both consume the same physical rocket inventory; only the seeker and
      // flight tuning differ, so inventory code does not need a parallel gun.
      ammoTypes: [
        { id: "standard", label: "HE", homing: false },
        { id: "homing", label: "HOMING", homing: true, lockRange: 260, lockConeDeg: 18, turnRate: 2.6, speed: 82 },
      ],
      // REAL PROJECTILE FLIGHT (b): muzzle velocity (m/s) and gravity (m/s^2)
      // for the visible travel arc fpsmode.js now flies the rocket along
      // instead of resolving impact the instant the trigger is pulled.
      // projSpeed tuned so a typical 30-60u shot has a perceptible (~0.3-0.6s)
      // flight time without feeling sluggish; projGravity is a mild arc (real
      // RPGs are near-flat over city engagement ranges, but zero gravity read
      // as "still hitscan" in testing, so a light drop sells the flight).
      projSpeed: 95, projGravity: 6,
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

  function normalizeId(id) {
    const w = CBZ.FPS_WEAPONS.find((x) => x.id === id || x.key === id);
    return w ? w.id : null;
  }

  function weaponById(id) {
    const nid = normalizeId(id);
    return nid ? CBZ.FPS_WEAPONS.find((w) => w.id === nid) : null;
  }

  function syncLegacyGunItem() {
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
    if (opts.select !== false || !CBZ.currentWeaponId) CBZ.currentWeaponId = nid;
    syncLegacyGunItem();
    if (CBZ.onWeaponInventoryChanged) CBZ.onWeaponInventoryChanged(nid, first);
    return first;
  }

  function hasWeapon(id) {
    const nid = normalizeId(id);
    return !!nid && CBZ.weaponInventory.indexOf(nid) >= 0;
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
    if (role === "cop") {
      unlockWeapon("sidearm", { select: true });
      unlockWeapon("taser", { select: false });
    }
  }

  CBZ.weaponById = weaponById;
  CBZ.unlockWeapon = unlockWeapon;
  CBZ.hasWeapon = hasWeapon;
  CBZ.hasAnyWeapon = hasAnyWeapon;
  CBZ.equippedWeapon = equippedWeapon;
  CBZ.setCurrentWeapon = setCurrentWeapon;
  CBZ.resetWeaponInventory = resetWeaponInventory;
})();
