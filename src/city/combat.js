/* ============================================================
   city/combat.js — the city's MELEE + the weapon-acquisition bridge.

   Guns are NOT a separate system here: buying/looting a firearm unlocks
   it in the engine's ONE gun system (systems/fpsmode.js + weapons/), and
   that exact hitscan — sphere hitboxes, headshots, recoil, tracers,
   reload, weapon models, third-person shoulder-aim — drives city gunplay
   (fpsmode.findActorHit/gunHit are city-aware). This file only:
     • maps city weapon names → engine weapon ids and unlocks them,
     • tops up reserve ammo,
     • handles UNARMED punches + melee weapons (Bat/Knife) on left-click
       (only while you're NOT holding a firearm — fpsmode owns that click).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;

  // city weapon name → engine (fpsmode) weapon id
  const GUN_MAP = { Pistol: "sidearm", SMG: "smg", Shotgun: "shotgun", Rifle: "carbine", Revolver: "revolver", "Desert Eagle": "deagle", "AK-47": "ak47", Uzi: "uzi", Sniper: "sniper", LMG: "lmg" };

  let fireCD = 0;

  function lookDir() { const y = CBZ.cam ? CBZ.cam.yaw : 0; return { x: -Math.sin(y), z: -Math.cos(y) }; }

  // best target in a forward cone within range (melee only — guns use fpsmode)
  function aimTarget(range, cone) {
    const P = CBZ.player.pos, L = lookDir();
    let best = null, bd = range;
    const consider = (a) => {
      if (!a || a.dead) return;
      const dx = a.pos.x - P.x, dz = a.pos.z - P.z, d = Math.hypot(dx, dz);
      if (d > range || d < 0.2) return;
      const dot = (dx / d) * L.x + (dz / d) * L.z;
      if (dot < cone) return;
      const score = d - dot * 6;
      if (score < bd) { bd = score; best = a; }
    };
    for (const c of CBZ.cityCops) consider(c);
    for (const p of CBZ.cityPeds) if (!p.vendor) consider(p);
    return best;
  }

  // ---- weapon-acquisition bridge to the engine gun system ----
  function giveWeapon(name) {
    const it = CBZ.cityEcon && CBZ.cityEcon.ITEMS[name];
    if (!it) return;
    g.cityWeapon = name;                       // for the city HUD + interact (hostage/aim) display
    const id = GUN_MAP[name];
    if (id && CBZ.unlockWeapon) CBZ.unlockWeapon(id, { select: true });   // the EXACT jail gun, now yours
    if (CBZ.city) CBZ.city.note("Equipped " + name, 1.4);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  CBZ.cityGiveWeapon = giveWeapon;
  CBZ.cityAddAmmo = function (n) {
    if (CBZ.fpsAddAmmo) CBZ.fpsAddAmmo(n);
    else { g.cityAmmo = (g.cityAmmo || 0) + n; }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  };
  CBZ.cityCurrentWeapon = function () { return g.cityWeapon ? CBZ.cityEcon.ITEMS[g.cityWeapon] : null; };
  CBZ.cityHasGun = function () { return !!(CBZ.hasAnyWeapon && CBZ.hasAnyWeapon()); };

  function markFighting() { CBZ.player._fighting = 1.5; }

  function punch() {
    markFighting();
    if (CBZ.fpsPunchAnim) CBZ.fpsPunchAnim();
    const t = aimTarget(2.7, 0.3);
    if (CBZ.sfx) CBZ.sfx("whoosh");
    if (!t) return;
    const fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
    if (t.kind === "cop") { CBZ.cityHurtCop(t, 18, { fromX: fx, fromZ: fz }); if (CBZ.body) CBZ.body.hit(t, { fromX: fx, fromZ: fz, force: 6, knockdown: Math.random() < 0.4 ? 1.1 : 0 }); }
    else { CBZ.cityKOPed(t, fx, fz); }
    if (CBZ.sfx) CBZ.sfx("punch");
    if (CBZ.shake) CBZ.shake(0.16);
  }

  function meleeSwing(it) {
    markFighting();
    const t = aimTarget(2.9, 0.3);
    if (CBZ.sfx) CBZ.sfx("whoosh");
    if (t) {
      const fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
      if (t.kind === "cop") CBZ.cityHurtCop(t, it.dmg, { fromX: fx, fromZ: fz });
      else { t.hp -= it.dmg; if (t.hp <= 0) CBZ.cityKillPed(t, { fromX: fx, fromZ: fz }, "beaten"); else CBZ.cityKOPed(t, fx, fz); }
      if (CBZ.sfx) CBZ.sfx("punch");
      if (CBZ.shake) CBZ.shake(0.18);
    }
    fireCD = 0.4;
  }

  // cooldown + fighting flag tick
  CBZ.onUpdate(12, function (dt) {
    if (g.mode !== "city") return;
    if (fireCD > 0) fireCD -= dt;
    if (CBZ.player._fighting > 0) CBZ.player._fighting -= dt;
  });

  // ---- input: left-click = melee, but ONLY when unarmed / holding a melee
  //      weapon. With a firearm equipped, fpsmode.js owns the click. ----
  function active() { return g.mode === "city" && g.state === "playing" && document.pointerLockElement && !CBZ.player.driving; }
  document.addEventListener("mousedown", function (e) {
    if (!active() || e.button !== 0) return;
    if (CBZ.cityMenuOpen) return;
    if (CBZ.cityHasGun()) return;            // a gun is out → the engine gun system fires this click
    if (fireCD > 0) return;
    e.preventDefault();
    const it = g.cityWeapon ? CBZ.cityEcon.ITEMS[g.cityWeapon] : null;
    if (it && it.melee) meleeSwing(it);
    else punch();
  });
})();
