/* ============================================================
   city/death.js — cinematic WASTED deaths + hospital respawn, and the
   BUSTED → jail fade.

   The city is third-person already, so a death plays out in full view:
   a spinning ragdoll fling (physics.js integrates player._death in any
   non-escape mode), a hard shake, slow-mo, a blood burst, and a big
   WASTED title. A few seconds later you respawn at the nearest hospital
   (lighter wallet, lower heat) — the run continues, GTA-style.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;

  let overlay = null, titleEl = null, subEl = null;
  let respawnT = 0, dying = false, wastedT = 0, pendingWasted = null;

  function buildOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "cityWasted";
    overlay.style.cssText = "position:fixed;inset:0;z-index:55;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;pointer-events:none;font-family:Fredoka,system-ui,sans-serif;text-align:center;background:radial-gradient(ellipse at 50% 50%,rgba(40,0,0,0) 30%,rgba(20,0,0,.75) 100%)";
    titleEl = document.createElement("div");
    titleEl.style.cssText = "font-size:clamp(54px,12vw,140px);font-weight:700;letter-spacing:4px;color:#c9202a;text-shadow:0 6px 0 #5e070b,0 10px 26px rgba(0,0,0,.6);opacity:0;transition:opacity 1s ease,transform 1s ease;transform:scale(1.25)";
    subEl = document.createElement("div");
    subEl.style.cssText = "font-size:clamp(22px,3.4vw,34px);font-weight:600;letter-spacing:1px;text-shadow:0 3px 0 rgba(0,0,0,.45),0 4px 14px rgba(0,0,0,.55);opacity:0;transition:opacity 1.1s ease .4s";
    overlay.appendChild(titleEl); overlay.appendChild(subEl);
    document.body.appendChild(overlay);
  }
  function showOverlay(big, sub, color) {
    buildOverlay();
    titleEl.textContent = big; titleEl.style.color = color || "#c9202a";
    subEl.textContent = sub || ""; subEl.style.color = color || "#c9202a";
    overlay.style.display = "flex";
    void overlay.offsetWidth;
    titleEl.style.opacity = "1"; titleEl.style.transform = "scale(1)";
    subEl.style.opacity = "1";
  }
  function hideOverlay() {
    if (!overlay) return;
    overlay.style.display = "none";
    titleEl.style.opacity = "0"; titleEl.style.transform = "scale(1.25)"; subEl.style.opacity = "0";
  }

  CBZ.cityDeathReset = function () { dying = false; respawnT = 0; wastedT = 0; pendingWasted = null; hideOverlay(); if (CBZ.cityCam) CBZ.cityCam.death = null; };

  // a red damage flash (the engine never defined CBZ.hitFlash) — drives the
  // existing #hitfx overlay so getting shot reads dramatically.
  let hitEl = null;
  if (!CBZ.hitFlash) CBZ.hitFlash = function () {
    if (!hitEl) { hitEl = document.getElementById("hitfx") || document.getElementById("vignette"); }
    if (!hitEl) return;
    hitEl.style.transition = "none"; hitEl.style.boxShadow = "inset 0 0 160px 40px rgba(200,20,20,.6)"; hitEl.style.opacity = "1";
    void hitEl.offsetWidth;
    hitEl.style.transition = "opacity .45s ease, box-shadow .45s ease";
    hitEl.style.opacity = "0";
  };

  // ---- central player damage: armoured, survivable, with out-of-combat
  //      regen so a gunfight is a back-and-forth, not an instant death.
  //      The CITY player is tougher than an NPC: incoming damage is scaled
  //      down, and a headshot is brutal but SURVIVABLE from full health
  //      (it one-shots NPCs, not you), so a firefight is winnable. ----
  const CITY_DR = 0.6;           // fraction of incoming damage the player actually takes
  const HEADSHOT_FRAC = 0.6;     // a headshot deals up to 60% of max HP (not an instakill)

  CBZ.cityHurtPlayer = function (dmg, fromX, fromZ, reason, headshot, attacker, nonlethal) {
    const P = CBZ.player;
    if (P.dead || (g.invuln || 0) > 0) return;
    if (attacker) { g._cityKiller = attacker; g._cityKillerT = CBZ.now || 0; }
    if (headshot) dmg = Math.max(dmg, (P.maxHp || 200) * HEADSHOT_FRAC);
    dmg *= CITY_DR;
    // Bumps and medium-speed traffic impacts can hurt badly, but should not
    // turn a scrape into a WASTED screen. Truly catastrophic hits opt out.
    if (nonlethal) dmg = Math.min(dmg, Math.max(0, P.hp - 1));
    if (P._armor > 0) { const a = Math.min(P._armor, dmg * (headshot ? 0.45 : 0.7)); P._armor -= a; dmg -= a; }
    P.hp -= dmg;
    P._hurtT = 3.5;                     // pause regen briefly, then it ramps back
    if (CBZ.hitFlash) CBZ.hitFlash();
    if (CBZ.shake) CBZ.shake(Math.min(0.4, 0.12 + dmg * 0.01));
    if (P.hp <= 0) CBZ.cityKillPlayer(reason || "killed", { fromX, fromZ });
  };

  // ---- WASTED ----
  CBZ.cityKillPlayer = function (reason, imp) {
    const P = CBZ.player;
    if (P.dead) return;
    P.dead = true; P.hp = 0; dying = true;
    // cinematic third-person replay: orbit the body (camera.js reads cityCam)
    if (CBZ.cityCam) CBZ.cityCam.death = { t: 0, ang0: Math.random() * 6.28 };
    if (CBZ.playerChar) CBZ.playerChar.group.visible = true;
    if (P.driving && CBZ.cityExitVehicle) { CBZ.cityExitVehicle(); }
    // spinning ragdoll fling (physics.js handles player._death in non-escape modes)
    const a = Math.random() * 6.28;
    P._death = {
      vx: Math.cos(a) * (3 + Math.random() * 3), vz: Math.sin(a) * (3 + Math.random() * 3),
      vy: 6 + Math.random() * 3, spin: (Math.random() * 2 - 1) * 7, spin2: (Math.random() * 2 - 1) * 5,
      t: 0, landed: false, seed: Math.random() * 6.28,
    };
    if (P._phys) { P._phys.air = false; P._phys.down = 0; P._phys.kx = P._phys.kz = 0; }
    if (CBZ.shake) CBZ.shake(1.2);
    if (CBZ.sfx) CBZ.sfx("ko");
    if (CBZ.doSlowmo) CBZ.doSlowmo(0.5);
    if (CBZ.gore) {
      let dir = imp && imp.fromX != null ? { x: P.pos.x - imp.fromX, z: P.pos.z - imp.fromZ } : null;
      CBZ.gore(P.pos.x, P.pos.y + 1.0, P.pos.z, { dir, amount: 1.4, player: true });
    }
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    const where = g.citySpawnPoint ? "home" : "the hospital";
    const killer = (g._cityKiller && (CBZ.now || 0) - (g._cityKillerT || 0) < 6) ? g._cityKiller : null;
    const line = killer ? ("Killed by " + killer) : (reason ? ("You were " + reason) : "You died");
    // hold the WASTED title back ~1.8s so the ragdoll fling plays out first, THEN
    // it fades in — no jarring instant pop on the exact frame you die.
    pendingWasted = line + "  ·  respawning at " + where + "…";
    wastedT = 1.8;
    g._cityKiller = null;
    respawnT = 4.6 + 1.8;       // keep the title on screen its full duration after the delay
  };

  function respawn() {
    const P = CBZ.player;
    dying = false; hideOverlay();
    if (CBZ.cityCam) CBZ.cityCam.death = null;          // end the cinematic, back to FP
    // own a home? respawn there for free. Otherwise the ER patches you up for a bill.
    const A = CBZ.city.arena;
    let spot = A.spawn, atHome = false;
    if (g.citySpawnPoint) { spot = g.citySpawnPoint; atHome = true; }
    else if (A.lots) { const h = A.lots.find((l) => l.kind === "hospital" && l.building); if (h) spot = h.building.door; }
    let bill = 0;
    if (!atHome) { bill = Math.min(g.cash || 0, 250 + (g.wanted | 0) * 150); if (bill > 0) g.cash -= bill; }
    g._lastBill = bill;
    if (CBZ.cityWantedReset) CBZ.cityWantedReset();
    if (CBZ.clearCityCops) CBZ.clearCityCops();
    P.pos.set(spot.x, 0, spot.z);
    P.vy = 0; P.grounded = true; P.dead = false; P.maxHp = P.maxHp || 200; P.hp = P.maxHp; P.ko = 0; P.stun = 0; P._hurtT = 0;
    P._death = null; P._armor = Math.max(0, (P._armor || 0));
    g.hunger = Math.max(40, g.hunger || 0);
    if (P._phys) { P._phys.air = false; P._phys.down = 0; P._phys.kx = P._phys.kz = 0; }
    CBZ.playerChar.group.visible = true;
    CBZ.playerChar.group.rotation.set(0, Math.random() * 6.28, 0);
    CBZ.playerChar.group.scale.y = 1;
    CBZ.playerChar.group.position.copy(P.pos);
    g.invuln = 2.5;       // brief grace after the ER
    if (CBZ.cam) CBZ.cam.pitch = 0.4;
    if (CBZ.setFPS) CBZ.setFPS(true);     // back to first-person after the death orbit
    if (CBZ.requestLock) CBZ.requestLock();
    if (CBZ.city) CBZ.city.note(atHome ? "🏡 You wake up at home, patched up." : ("🏥 City Hospital. Bill: $" + (g._lastBill || 0)), 2.4);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  CBZ.onUpdate(13, function (dt) {
    if (g.mode !== "city") return;
    if (g.invuln > 0) g.invuln = Math.max(0, g.invuln - dt);
    if (dying) {
      if (pendingWasted && wastedT > 0) { wastedT -= dt; if (wastedT <= 0) { showOverlay("WASTED", pendingWasted, "#c9202a"); pendingWasted = null; } }
      respawnT -= dt; if (respawnT <= 0) respawn(); return;
    }
    // out-of-combat health regen (GTA-style) so a flesh wound isn't a death
    const P = CBZ.player;
    if (!P.dead) {
      if (P._hurtT > 0) P._hurtT -= dt;
      else if (P.hp < (P.maxHp || 200)) { P.hp = Math.min(P.maxHp || 200, P.hp + 16 * dt); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
    }
  });

  // ---- BUSTED fade (called by city/wanted.js before the jail handoff) ----
  CBZ.cityBustOverlay = function (lost, done) {
    showOverlay("BUSTED", "Cuffed and processed" + (lost > 0 ? "  ·  lost $" + lost : "") + "  ·  off to the cells…", "#5b8bff");
    let t = 0;
    const tick = function () {
      t += 0.05;
      if (t >= 2.6) { hideOverlay(); if (done) done(); return; }
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  };
})();
