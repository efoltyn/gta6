/* ============================================================
   city/mode.js — the CITY (GTA-style) game mode.

   Owns the shared CBZ.city namespace (money / respect / kills / the
   player-as-actor), chains CBZ.floorAt onto the flat city ground, runs
   stamina, and registers the mode descriptor (build / reset /
   objective). Sibling city/* modules augment CBZ.city with the wanted
   system, careers, shops, peds, cops, vehicles, death and HUD.

   It reuses the entire engine: the character rig, procedural animation,
   movement, vertical physics (enterable buildings), and the third-person
   camera — exactly like survival mode does.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;

  // the player presented as a uniform "actor" so combat/peds treat it like an NPC
  const playerActor = {
    isPlayer: true,
    get pos() { return CBZ.player.pos; },
    get group() { return CBZ.playerChar.group; },
    get hp() { return CBZ.player.hp; },
    set hp(v) { CBZ.player.hp = v; },
    get dead() { return CBZ.player.dead; },
  };

  let baseFloor = null;     // the floorAt that existed before the city wrapped it

  const city = {
    built: false,
    arena: null,
    playerActor,
    stats: { topMoney: 0, topKills: 0 },

    floorAt(x, z) { return (g.mode === "city" && city.arena) ? city.arena.groundHeightAt(x, z) : 0; },

    // ---- money ----
    addCash(n) { g.cash = Math.max(0, (g.cash || 0) + n); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); if (CBZ.cityWorldCommit) CBZ.cityWorldCommit(); return g.cash; },
    canAfford(n) { return (g.cash || 0) >= n; },
    spend(n) { if ((g.cash || 0) < n) return false; g.cash -= n; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); if (CBZ.cityWorldCommit) CBZ.cityWorldCommit(); return true; },

    // ---- respect (street cred) ----
    addRespect(n) { g.respect = Math.max(0, (g.respect || 0) + n); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); if (CBZ.cityWorldCommit) CBZ.cityWorldCommit(); },

    // ---- kills (leaderboard) ----
    addKill() { g.kills = (g.kills || 0) + 1; city.addRespect(2); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); },

    // a short toast (reuses the engine's hint flasher)
    note(msg, sec) { if (CBZ.flashHint) CBZ.flashHint(msg, sec || 2.2); },
    big(msg) { if (CBZ.flashToast) CBZ.flashToast(msg); },

    forEachActor(fn) {
      if (!CBZ.player.dead) fn(playerActor);
      const p = CBZ.cityPeds; for (let i = 0; i < p.length; i++) if (!p[i].dead) fn(p[i]);
      const c = CBZ.cityCops; for (let i = 0; i < c.length; i++) if (!c[i].dead) fn(c[i]);
    },
  };
  CBZ.city = city;

  function build() {
    if (city.built) return;
    city.arena = CBZ.buildCity();
    baseFloor = CBZ.floorAt || null;
    CBZ.floorAt = function (x, z) { return g.mode === "city" ? city.arena.groundHeightAt(x, z) : (baseFloor ? baseFloor(x, z) : 0); };
    city.built = true;
  }
  city.build = build;

  // ---- lighting override: re-aim the sun + shadow box onto the far-off city
  //      (daynight.js @2 and survival's override @93 both run first; we sit
  //      after them at @94 and take over whenever city mode is active). ----
  let cityShadow = false;
  CBZ.onAlways(94, function () {
    if (g.mode !== "city") { cityShadow = false; return; }
    const A = city.arena; if (!A) return;
    // The life-game map now extends across a bridge onto a second island.
    // Follow the player so shadows stay useful in either district.
    const focus = CBZ.player && CBZ.player.pos ? CBZ.player.pos : A.center;
    if (CBZ.sun) { CBZ.sun.position.set(focus.x + 70, 150, focus.z - 50); CBZ.sun.color.setHex(0xfff4e0); CBZ.sun.intensity = 1.05; }
    if (CBZ.sunTarget) CBZ.sunTarget.position.set(focus.x, 4, focus.z);
    if (CBZ.hemi) { CBZ.hemi.intensity = 0.95; }
    if (CBZ.scene.fog) { CBZ.scene.fog.near = 60; CBZ.scene.fog.far = 620; }
    if (!cityShadow && CBZ.sun && CBZ.sun.shadow) {
      cityShadow = true;
      const sc = 190, cam = CBZ.sun.shadow.camera;
      cam.left = -sc; cam.right = sc; cam.top = sc; cam.bottom = -sc; cam.far = 500;
      if (cam.updateProjectionMatrix) cam.updateProjectionMatrix();
    }
  });

  // ---- stamina (SHIFT sprint, same as survival) ----
  CBZ.onUpdate(31, function (dt) {
    if (g.mode !== "city") return;
    const P = CBZ.player, S = CBZ.CITY;
    if (P.stamina === undefined) P.stamina = S.staminaMax;
    if (P.sprint) P.stamina = Math.max(0, P.stamina - S.staminaDrain * dt);
    else P.stamina = Math.min(S.staminaMax, P.stamina + S.staminaRegen * dt);
  });

  // ---- ROOFTOP SPAWN: you wake on a building roof, never the street. Broke
  //      (a fresh start) drops you on a low climbable roof; the more money
  //      you've got, the taller the tower you wake up on. Roofs are standable
  //      platforms (city/buildings.js), so we just place you on the slab. ----
  function pickSpawnRoof(cash) {
    // lots live on the ARENA (city.arena), not on this mode object — the old
    // `city.lots` was always undefined, so this returned null every run and the
    // rooftop spawn never happened (you always fell back to the street corner).
    const lots = city.arena && city.arena.lots;
    if (!lots) return null;
    const roofs = [];
    for (const lot of lots) {
      const b = lot.building;
      if (!b || !b.storeys || !b.hasStairs || lot.kind === "park") continue;
      // spawn on the CENTRE of the solid roof slab (b.roofCx/Cz), not the lot
      // centre — the lot centre sits over the open -x stairwell strip.
      roofs.push({ x: b.roofCx != null ? b.roofCx : lot.cx, z: b.roofCz != null ? b.roofCz : lot.cz, storeys: b.storeys, y: (b.h || b.storeys * 4) + 0.05, w: lot.w || 8 });
    }
    if (!roofs.length) return null;
    roofs.sort((a, b) => a.storeys - b.storeys);
    const motels = roofs.filter((r) => r.storeys <= 2);
    const wealth = Math.max(0, Math.min(1, (cash || 0) / 40000));   // ~$40k = top of the skyline
    const pick = (wealth < 0.06 && motels.length)
      ? motels[(Math.random() * motels.length) | 0]
      : roofs[Math.min(roofs.length - 1, Math.round(wealth * (roofs.length - 1)))];
    // pick.x/z is already the centre of the solid roof slab (clear of the -x
    // stairwell), so spawn dead-centre on the roof — no edge/corner offset
    return { x: pick.x, y: pick.y, z: pick.z };
  }

  CBZ.registerMode("city", {
    id: "city",
    label: "City",
    objective: "Make money any way you can — hustle, steal, deal, or go legit. Obey the lights or run them. Cops escalate to 5 stars; get cuffed and you're off to jail.",
    build,
    reset(game) {
      build();
      const A = city.arena;
      A.root.visible = true;
      if (A.reset) A.reset();
      if (CBZ.fx) CBZ.fx.clear();
      if (CBZ.clearGore) CBZ.clearGore();
      // re-install the floor wrapper in case survival rebuilt CBZ.floorAt after us
      if (!CBZ.floorAt || !CBZ.floorAt._city) {
        baseFloor = (CBZ.floorAt && CBZ.floorAt._city) ? baseFloor : CBZ.floorAt;
        const f = function (x, z) { return g.mode === "city" ? A.groundHeightAt(x, z) : (baseFloor ? baseFloor(x, z) : 0); };
        f._city = true; CBZ.floorAt = f;
      }

      // fresh stats for this life
      game.cash = (CBZ.CITY.econ && CBZ.CITY.econ.startCash) || 0;
      game.wanted = 0; game.heat = 0; game.hunger = 100; game.tired = 0;
      game.respect = 0; game.kills = 0; game.busted = false; game.career = null;
      game.elapsed = 0; game.invuln = 0;
      game.cityInv = {}; game.cityWeapon = null; game.cityAmmo = 0; game.cityBank = 0;
      game.cityActivity = null;
      // start unarmed in the ONE engine gun system; fresh mags. Buying/looting a
      // gun unlocks it in fpsmode (systems/fpsmode.js), which drives city gunplay.
      if (CBZ.resetWeaponInventory) CBZ.resetWeaponInventory();
      if (CBZ.fpsResetWeapons) CBZ.fpsResetWeapons();
      if (CBZ.cityWorldBeginRun) CBZ.cityWorldBeginRun(game);

      // THIRD-PERSON by default (the jail follow camera); [V] toggles FP. The
      // death replay flips to a 3rd-person orbit.
      CBZ.cityCam = CBZ.cityCam || { fp: false, death: null };
      CBZ.cityCam.fp = false; CBZ.cityCam.death = null;

      // reset the new sub-systems BEFORE repopulating
      if (CBZ.cityGangsReset) CBZ.cityGangsReset();
      if (CBZ.citySocialReset) CBZ.citySocialReset();
      if (CBZ.cityRealEstateReset) CBZ.cityRealEstateReset();
      if (CBZ.cityZillowReset) CBZ.cityZillowReset();
      if (CBZ.cityVehiclesReset) CBZ.cityVehiclesReset();
      if (CBZ.cityGlassReset) CBZ.cityGlassReset();   // re-glaze every shattered window

      // spawn population (spawnCityPeds also spawns gangs + seeds families)
      if (CBZ.spawnCityPeds) CBZ.spawnCityPeds(CBZ.CITY.peds);
      if (CBZ.spawnCityCrowd) CBZ.spawnCityCrowd((CBZ.CITY.crowd != null ? CBZ.CITY.crowd : 280));   // instanced ambient mass crowd
      if (CBZ.clearCityCops) CBZ.clearCityCops();
      if (CBZ.spawnCityTraffic) CBZ.spawnCityTraffic(CBZ.CITY.traffic);
      if (CBZ.cityWantedReset) CBZ.cityWantedReset();
      if (CBZ.cityCareersReset) CBZ.cityCareersReset();
      if (CBZ.cityEmpireReset) CBZ.cityEmpireReset();
      if (CBZ.cityLeaderboardReset) CBZ.cityLeaderboardReset();
      if (CBZ.cityPromotionReset) CBZ.cityPromotionReset();

      // place the player — on a rooftop (wealth-scaled), falling back to the
      // street spawn only if no buildings exist yet.
      const P = CBZ.player;
      const roof = pickSpawnRoof(game.cash || 0);
      if (roof) P.pos.set(roof.x, roof.y, roof.z);
      else { const sp = A.spawn; P.pos.set(sp.x, 0, sp.z); }
      P.vy = 0; P.grounded = true; P.maxHp = 200; P.hp = 200; P._hurtT = 0; P.dead = false; P.ko = 0; P.stun = 0;
      P.driving = false; P._vehicle = null; P._death = null;
      P.captureState = "normal"; P.captureT = 0;
      P.stamina = CBZ.CITY.staminaMax; P.sprint = false; P.crouch = false;
      if (P._phys) { P._phys.air = false; P._phys.down = 0; P._phys.kx = P._phys.kz = 0; }
      if (CBZ.playerChar.cuffed) CBZ.playerChar.cuffed = false;
      CBZ.playerChar.group.visible = true;
      CBZ.playerChar.group.position.copy(P.pos);
      CBZ.playerChar.group.rotation.set(0, Math.random() * 6.28, 0);
      CBZ.playerChar.group.scale.y = 1;
      if (CBZ.cam) { CBZ.cam.yaw = CBZ.playerChar.group.rotation.y + Math.PI; CBZ.cam.pitch = 0.4; }
      if (CBZ.resetZoom) CBZ.resetZoom();
      if (CBZ.cityDeathReset) CBZ.cityDeathReset();
      // CITY defaults to FIRST-PERSON (the jail's fpsmode); [V] toggles to 3rd-person.
      if (CBZ.setFPS) CBZ.setFPS(true);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    },
    winStats(game) {
      return [
        { label: "Cash", value: "$" + (game.cash || 0) },
        { label: "Kills", value: game.kills || 0 },
        { label: "Respect", value: game.respect || 0 },
      ];
    },
  });
})();
