/* ============================================================
   weapons/weapon-data.js - tuning data + run weapon inventory.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};

  CBZ.FPS_WEAPONS = [
    {
      id: "sidearm", key: "sidearm", label: "9MM SIDEARM", short: "9MM", slot: "pistol",
      appearanceFactory: "sidearm", magSize: 17, fireMode: "semi", fireDelay: 0.145, reloadTime: 1.05,
      mag: 17, reserve: 85, reload: 1.05, interval: 0.145, range: 82,
      damage: 36, headMult: 2.6, dropStart: 44, minDamage: 0.58,
      spread: 0.0055, bodyRadius: 0.62, headRadius: 0.33,
      recoil: 0.21, maxRecoil: 0.58, climb: 0.023, sideKick: 0.016,
      shake: 0.26, heat: 44, knock: 1.35, flash: 0.34,
      sfx: "shoot_pistol", tracer: 0.018, auto: false,
    },
    {
      id: "shotgun", key: "shotgun", label: "12G PUMP", short: "12G", slot: "long",
      appearanceFactory: "shotgun", magSize: 6, fireMode: "pump", fireDelay: 0.78, reloadTime: 0.42,
      mag: 6, reserve: 30, reload: 0.42, interval: 0.78, range: 44,
      damage: 18, headMult: 1.35, dropStart: 14, minDamage: 0.34,
      spread: 0.061, pellets: 9, bodyRadius: 0.78, headRadius: 0.36,
      recoil: 0.60, maxRecoil: 0.98, climb: 0.058, sideKick: 0.034,
      shake: 0.74, heat: 64, knock: 2.45, flash: 0.70,
      sfx: "shoot_shotgun", tracer: 0.014, shellReload: true, pump: true,
      auto: false,
    },
    {
      id: "carbine", key: "carbine", label: "M4 CARBINE", short: "556", slot: "rifle",
      appearanceFactory: "carbine", magSize: 30, fireMode: "auto", fireDelay: 0.084, reloadTime: 1.45,
      mag: 30, reserve: 120, reload: 1.45, interval: 0.084, range: 118,
      damage: 28, headMult: 2.25, dropStart: 72, minDamage: 0.62,
      spread: 0.0072, bodyRadius: 0.61, headRadius: 0.32,
      recoil: 0.115, maxRecoil: 0.68, climb: 0.013, sideKick: 0.024,
      shake: 0.20, heat: 39, knock: 1.08, flash: 0.42,
      sfx: "shoot_carbine", tracer: 0.012, auto: true,
    },
    {
      id: "smg", key: "smg", label: "COMPACT SMG", short: "SMG", slot: "auto",
      appearanceFactory: "smg", magSize: 32, fireMode: "auto", fireDelay: 0.064, reloadTime: 1.25,
      mag: 32, reserve: 128, reload: 1.25, interval: 0.064, range: 72,
      damage: 21, headMult: 2.05, dropStart: 36, minDamage: 0.50,
      spread: 0.0105, bodyRadius: 0.63, headRadius: 0.33,
      recoil: 0.085, maxRecoil: 0.74, climb: 0.010, sideKick: 0.034,
      shake: 0.17, heat: 34, knock: 0.90, flash: 0.36,
      sfx: "shoot_smg", tracer: 0.010, auto: true,
    },
    {
      id: "revolver", key: "revolver", label: ".357 MAGNUM", short: "357", slot: "pistol",
      appearanceFactory: "sidearm", magSize: 6, fireMode: "semi", fireDelay: 0.5, reloadTime: 1.6,
      mag: 6, reserve: 36, reload: 1.6, interval: 0.5, range: 92,
      damage: 64, headMult: 2.8, dropStart: 50, minDamage: 0.66,
      spread: 0.004, bodyRadius: 0.62, headRadius: 0.33,
      recoil: 0.42, maxRecoil: 0.8, climb: 0.05, sideKick: 0.02,
      shake: 0.5, heat: 52, knock: 2.4, flash: 0.5,
      sfx: "shoot_pistol", tracer: 0.02, auto: false,
    },
    {
      id: "deagle", key: "deagle", label: ".50 DESERT EAGLE", short: "50AE", slot: "pistol",
      appearanceFactory: "sidearm", magSize: 7, fireMode: "semi", fireDelay: 0.4, reloadTime: 1.35,
      mag: 7, reserve: 49, reload: 1.35, interval: 0.4, range: 90,
      damage: 75, headMult: 2.7, dropStart: 48, minDamage: 0.64,
      spread: 0.0045, bodyRadius: 0.62, headRadius: 0.33,
      recoil: 0.5, maxRecoil: 0.86, climb: 0.058, sideKick: 0.026,
      shake: 0.56, heat: 56, knock: 2.7, flash: 0.56,
      sfx: "shoot_pistol", tracer: 0.022, auto: false,
    },
    {
      // The status rifle: out-damages the carbine per round but handles LAZY —
      // slow to bring up (equip), slow to feed (reload), and run-and-gun throws
      // shots wide (moveSpread). Plant your feet and it earns its price tag.
      id: "ak47", key: "ak47", label: "AK-47", short: "762", slot: "rifle",
      appearanceFactory: "ak47", magSize: 30, fireMode: "auto", fireDelay: 0.097, reloadTime: 1.8,
      mag: 30, reserve: 120, reload: 1.8, interval: 0.097, range: 112,
      damage: 34, headMult: 2.3, dropStart: 64, minDamage: 0.6,
      spread: 0.011, moveSpread: 2.3, bodyRadius: 0.61, headRadius: 0.32,
      recoil: 0.17, maxRecoil: 0.82, climb: 0.02, sideKick: 0.03,
      shake: 0.28, heat: 46, knock: 1.4, flash: 0.5, equip: 0.5,
      sfx: "shoot_ak47", tracer: 0.013, auto: true,   // dedicated layered voice (audio.js) owns the pitch/weight
    },
    {
      id: "uzi", key: "uzi", label: "MICRO UZI", short: "UZI", slot: "auto",
      appearanceFactory: "smg", magSize: 25, fireMode: "auto", fireDelay: 0.052, reloadTime: 1.15,
      mag: 25, reserve: 125, reload: 1.15, interval: 0.052, range: 56,
      damage: 16, headMult: 1.9, dropStart: 26, minDamage: 0.45,
      spread: 0.016, bodyRadius: 0.63, headRadius: 0.33,
      recoil: 0.075, maxRecoil: 0.78, climb: 0.009, sideKick: 0.044,
      shake: 0.15, heat: 30, knock: 0.7, flash: 0.3,
      sfx: "shoot_smg", tracer: 0.009, auto: true,
    },
    {
      id: "sniper", key: "sniper", label: "BOLT SNIPER", short: "SNIP", slot: "rifle",
      appearanceFactory: "carbine", magSize: 5, fireMode: "bolt", fireDelay: 1.25, reloadTime: 2.0,
      mag: 5, reserve: 25, reload: 2.0, interval: 1.25, range: 240,
      damage: 130, headMult: 3.0, dropStart: 180, minDamage: 0.85,
      spread: 0.0015, bodyRadius: 0.6, headRadius: 0.34,
      recoil: 0.6, maxRecoil: 0.95, climb: 0.07, sideKick: 0.01,
      shake: 0.66, heat: 70, knock: 3.0, flash: 0.6,
      sfx: "shoot_carbine", tracer: 0.02, auto: false,
    },
    {
      id: "lmg", key: "lmg", label: "M249 LMG", short: "LMG", slot: "auto",
      appearanceFactory: "carbine", magSize: 100, fireMode: "auto", fireDelay: 0.075, reloadTime: 3.2,
      mag: 100, reserve: 200, reload: 3.2, interval: 0.075, range: 120,
      damage: 27, headMult: 2.0, dropStart: 60, minDamage: 0.58,
      spread: 0.014, bodyRadius: 0.62, headRadius: 0.32,
      recoil: 0.16, maxRecoil: 0.88, climb: 0.018, sideKick: 0.034,
      shake: 0.3, heat: 50, knock: 1.3, flash: 0.55,
      sfx: "shoot_carbine", tracer: 0.014, auto: true,
    },
    {
      id: "bazooka", key: "bazooka", label: "RPG / ROCKET LAUNCHER", short: "RPG", slot: "long",
      appearanceFactory: "bazooka", magSize: 1, fireMode: "single", fireDelay: 1.4, reloadTime: 1.4,
      mag: 1, reserve: 4, reload: 1.4, interval: 1.4, range: 200,
      damage: 1, headMult: 1.0, dropStart: 200, minDamage: 1.0,
      spread: 0.004, bodyRadius: 0.62, headRadius: 0.33,
      recoil: 0.9, maxRecoil: 1.0, climb: 0.08, sideKick: 0.02,
      shake: 1.1, heat: 70, knock: 3.0, flash: 0.9,
      sfx: "explosion", tracer: 0.03, auto: false,
      explosive: true, blastPower: 1.9, blastRadius: 13,
    },
    {
      id: "taser", key: "taser", label: "X26 TASER", short: "TASER", slot: "utility",
      appearanceFactory: "taser", magSize: 2, fireMode: "stun", fireDelay: 0.92, reloadTime: 1.05,
      mag: 2, reserve: 10, reload: 1.05, interval: 0.92, range: 22,
      damage: 10, headMult: 1.0, dropStart: 18, minDamage: 0.85,
      spread: 0.010, bodyRadius: 0.80, headRadius: 0.36,
      recoil: 0.05, maxRecoil: 0.22, climb: 0.004, sideKick: 0.006,
      shake: 0.12, heat: 14, knock: 0.40, flash: 0.22,
      sfx: "shoot_taser", tracer: 0.006, auto: false, nonlethal: true,
    },
  ];

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
