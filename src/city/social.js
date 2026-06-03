/* ============================================================
   city/social.js — relationships, family, and hostages. The "real
   NPC shit": people come in couples/families, you can date a civilian
   up to a partner and marry them, your partner walks with you and
   lives in your home — and can be taken hostage by a gang (a rescue
   mission), while you can grab a hostage of your own at gunpoint.

   Drives "controlled" peds (companion / hostage / kidnap victim) by
   setting their target each frame; city/peds.js skips its brain for
   them. Exposes: citySocialInit, cityFlirt, cityPropose, cityTakeHostage,
   cityReleaseHostage, citySocialDeath, cityIsRomance, reset.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const S = () => (CBZ.CITY && CBZ.CITY.social) || {};

  let _s = 271828;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  let beacon = null, kidnapCD = 0;

  // ---- setup: pair some civilians into couples / families ----
  CBZ.citySocialInit = function () {
    g.cityPartner = null; g.citySpouse = false; g.cityHostage = null;
    clearBeacon(); kidnapCD = 12;
    const civ = CBZ.cityPeds.filter((p) => p.kind === "civilian" && !p.vendor && !p.gang);
    // shuffle-ish pairing
    for (let i = 0; i + 1 < civ.length; i += 2) {
      if (rng() < 0.45) {
        const a = civ[i], b = civ[i + 1];
        a.partner = b; b.partner = a;
        a.family = [b]; b.family = [a];
      }
    }
  };

  CBZ.cityIsRomance = function (ped) {
    return ped && !ped.dead && ped.kind === "civilian" && !ped.vendor && !ped.gang && ped !== g.cityPartner && !ped.partner;
  };

  // ---- dating ----
  CBZ.cityFlirt = function (ped) {
    if (!ped || ped.dead) return;
    if (ped === g.cityPartner) { CBZ.city.note("“I love you too 💕”", 1.8); return; }
    if (!CBZ.cityIsRomance(ped)) { CBZ.city.note(ped.name + " isn't interested.", 1.6); return; }
    const cost = S().dateCost || 50;
    if (!CBZ.city.canAfford(cost)) { CBZ.city.note("A date costs $" + cost + " — you're broke.", 1.8); return; }
    CBZ.city.spend(cost);
    ped.affection = (ped.affection || 0) + (S().affectionPerDate || 22) * (0.7 + (1 - Math.abs(ped.aggr - 0.3)) * 0.5);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (ped.affection >= (S().partnerAt || 60)) {
      g.cityPartner = ped; ped.companion = true; ped.controlled = true; ped.romance = true;
      CBZ.city.big("💕 " + ped.name + " is now your partner!");
      CBZ.city.addRespect(2);
    } else {
      CBZ.city.note("You take " + ped.name + " out. (♥ " + Math.round(ped.affection) + "/" + (S().partnerAt || 60) + ")", 2);
    }
  };

  CBZ.cityPropose = function (ped) {
    ped = ped || g.cityPartner;
    if (!ped || ped !== g.cityPartner) { CBZ.city.note("You need a partner first.", 1.6); return; }
    const econ = CBZ.cityEcon, ring = (S().marryRing || "Diamond Ring");
    if (g.citySpouse) { CBZ.city.note("You're already married 💍", 1.6); return; }
    if (!econ.has(ring)) { CBZ.city.note("You need a " + ring + " to propose.", 2); return; }
    econ.take(ring, 1); g.citySpouse = true;
    CBZ.city.big("💍 You married " + ped.name + "!");
    CBZ.city.addRespect(10);
  };

  // ---- hostage: grab a ped at gunpoint as a shield / for ransom ----
  CBZ.cityTakeHostage = function (ped) {
    if (!ped || ped.dead || ped === g.cityPartner) return;
    const armed = g.cityWeapon && CBZ.cityEcon.ITEMS[g.cityWeapon] && CBZ.cityEcon.ITEMS[g.cityWeapon].gun;
    if (!armed) { CBZ.city.note("Need a gun to take a hostage.", 1.6); return; }
    if (g.cityHostage) { CBZ.city.note("You already have a hostage.", 1.4); return; }
    g.cityHostage = ped; ped.controlled = true; ped.hostage = true; ped.fear = 10; ped.rage = null;
    CBZ.city.big("HOSTAGE TAKEN");
    CBZ.cityCrime && CBZ.cityCrime(40, { x: ped.pos.x, z: ped.pos.z, type: "kidnapping" });
  };
  CBZ.cityReleaseHostage = function (ransom) {
    const ped = g.cityHostage; if (!ped) return;
    ped.controlled = false; ped.hostage = false; ped.alarmed = 8; ped.fear = 10;
    g.cityHostage = null;
    if (ransom) {
      const pay = 200 + ((ped.wealth || 0.3) * 800) | 0;
      CBZ.city.addCash(pay); CBZ.city.big("RANSOM PAID + $" + pay);
      CBZ.cityCrime && CBZ.cityCrime(30, { type: "extortion" });
    } else {
      CBZ.city.note("You let " + ped.name + " go.", 1.6);
      if (CBZ.city.addHeat) CBZ.city.addHeat(-30);     // letting them go cools things slightly
    }
    if (ped.pos) CBZ.cityAlarm && CBZ.cityAlarm(ped.pos.x, ped.pos.z, 14, 1);
  };

  // ---- when a controlled/partner ped dies, clean up + react ----
  CBZ.citySocialDeath = function (ped) {
    if (ped === g.cityPartner) { g.cityPartner = null; g.citySpouse = false; clearBeacon(); CBZ.city && CBZ.city.big("💔 Your partner was killed"); }
    if (ped === g.cityHostage) { g.cityHostage = null; }
  };

  CBZ.citySocialReset = function () { g.cityPartner = null; g.citySpouse = false; g.cityHostage = null; clearBeacon(); kidnapCD = 12; };

  function clearBeacon() { if (beacon) { if (beacon.parent) beacon.parent.remove(beacon); if (beacon.geometry) beacon.geometry.dispose(); if (beacon.material) beacon.material.dispose(); beacon = null; } }
  function makeBeacon(x, z, color) {
    clearBeacon();
    if (!CBZ.city || !CBZ.city.arena) return;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 30, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: color || 0xff6bd0, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(x, 15, z); m.userData.transient = true;
    CBZ.city.arena.root.add(m); beacon = m;
  }

  // ---- per-frame: companion/hostage/kidnap movement + the kidnap director ----
  CBZ.onUpdate(34.6, function (dt) {
    if (g.mode !== "city") return;
    const P = CBZ.player;

    // partner / hostage follow the player (a few steps behind)
    const follow = (ped, offset) => {
      if (!ped || ped.dead) return;
      const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
      const bx = P.pos.x + Math.sin(yaw) * offset, bz = P.pos.z + Math.cos(yaw) * offset;
      ped.target.set(bx, 0, bz); ped.state = "walk";
      const d = Math.hypot(ped.pos.x - P.pos.x, ped.pos.z - P.pos.z);
      ped.speed = d > 1.6 ? ped.baseSpeed * 1.6 : 0;
      if (ped.speed > 0) {
        const dx = ped.target.x - ped.pos.x, dz = ped.target.z - ped.pos.z, dd = Math.hypot(dx, dz) || 1;
        ped.pos.x += (dx / dd) * ped.speed * dt; ped.pos.z += (dz / dd) * ped.speed * dt;
        ped.group.rotation.y = CBZ.lerpAngle(ped.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.001, dt));
      }
      if (CBZ.collide) CBZ.collide(ped.pos, 0.5, ped.pos.y, ped.pos.y + 1.7);
      ped.pos.y = 0;
      if (CBZ.animChar) CBZ.animChar(ped.char, ped.speed, dt);
    };
    if (g.cityPartner && g.cityPartner.companion && !g.cityPartner.kidnapped) follow(g.cityPartner, 2.6);
    if (g.cityHostage) follow(g.cityHostage, 1.2);

    // kidnap director: when you're hot near a provoked gang, they may snatch
    // your partner and drag them back to a turf building (rescue mission).
    kidnapCD -= dt;
    if (kidnapCD <= 0) {
      kidnapCD = 5;
      const partner = g.cityPartner;
      if (partner && partner.companion && !partner.kidnapped && (g.wanted | 0) >= 2 && CBZ.cityGangs && CBZ.cityGangs.length) {
        // a provoked gang near you grabs them
        const gang = CBZ.cityGangs.find((x) => x.provoke > 0.5);
        if (gang && rng() < 0.5) kidnap(partner, gang);
      }
      // reaching the captor frees them
      if (partner && partner.kidnapped) {
        const d = Math.hypot(P.pos.x - partner.pos.x, P.pos.z - partner.pos.z);
        if (d < 3.5 && !P.dead) freePartner(partner);
      }
    }
    // a kidnapped partner is parked at the gang building (controlled, not following)
    if (g.cityPartner && g.cityPartner.kidnapped && beacon) {
      beacon.position.set(g.cityPartner.pos.x, 15, g.cityPartner.pos.z);
    }
  });

  function kidnap(ped, gang) {
    const lot = gang.turf[(rng() * gang.turf.length) | 0]; if (!lot) return;
    ped.kidnapped = true; ped.companion = false; ped.controlled = true;
    ped.pos.set(lot.cx, 0, lot.cz);
    ped.target.set(lot.cx, 0, lot.cz); ped.speed = 0;
    CBZ.cityGangProvoke && CBZ.cityGangProvoke(gang.id, 1);
    makeBeacon(lot.cx, lot.cz, 0xff6bd0);
    CBZ.city.big("💔 " + gang.name + " grabbed your partner!");
    CBZ.city.note("Rescue " + ped.name + " from the " + gang.name + " block (pink beacon).", 3);
  }
  function freePartner(ped) {
    ped.kidnapped = false; ped.companion = true; ped.controlled = true;
    clearBeacon();
    CBZ.city.big("💕 Rescued " + ped.name + "!");
    CBZ.city.addRespect(6);
  }
})();
