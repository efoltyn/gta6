/* ============================================================
   modes/shark_sim.js — SHARK SIM (a game riding inside survival).

   THE PITCH (owner): "you upgrade types of shark as you eat fish and npcs
   and orcas can kill you till megladon … put it on full nat disaster island
   water and put humans in random places around beach". And the control
   contract: "there's no control other than move that's needed … shark bites
   eats when there's something to bite in front already, all we need is
   pilot, it works all devices like nat disaster and prison game."

   So this file is deliberately thin. It BUILDS NOTHING physical:
     • the world is the disaster island (modes/survival.js), disasters on;
     • the sea is already stocked (CBZ.cityWildlifeStock — fish, sharks,
       orca pods all live around this island since the wildlife seam);
     • the body is a native wildlife actor, ridden through the existing
       aquatic mount (wildlife_tame.js) — WASD/shift or the touch stick,
       exactly the piloting every device already has;
     • the bite is the mount's own attack, pulled automatically whenever
       the mount's own target selection says something is in front
       (CBZ.cityAquaticBiteProbe);
     • deaths go through the same buses as everything else: eaten
       survivors through CBZ.surv.hurt → the killfeed, the player's own
       death through killPlayer → spectate → the survival lose card.

   What it ADDS is the game: the evolution ladder (bull shark →
   hammerhead → great white → MEGALODON), mass from kills, the pod as the
   threat curve (the player's shark is marked `huntable`, the one flag
   marine_predation.js honours for exactly this file), the beach crowd as
   the larder (survivorbot.js wanders the shore ring while
   CBZ.sharkSimShoreRing is set, and respawns keep the buffet stocked so
   survival's last-one-standing check stays dormant), and the win: as the
   megalodon, eat the thing that eats sharks.

   DOOR: index.html?mode=survival&shark=1 (the MORE GAMES tile), or a page
   that sets window.CBZ.START_SHARK_SIM before this file loads. Without the
   flag this module installs NOTHING — plain survival is byte-identical.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;

  let WANT = !!CBZ.START_SHARK_SIM;
  try {
    const q = typeof location !== "undefined" && location.search &&
      new URLSearchParams(location.search).get("shark");
    if (q != null) WANT = q !== "0" && q !== "false";
  } catch (e) {}
  if (!WANT) return;

  /* ---- THE LADDER. `need` is total mass eaten; mass comes off the meal's
     own hit points (massOf), so a mackerel is a snack and a human is a
     meal. The megalodon is the end of the ladder and the start of the win
     condition, not another rung. ---- */
  const LADDER = [
    { id: "bull_shark",        name: "BULL SHARK",       need: 0 },
    { id: "hammerhead_shark",  name: "GREAT HAMMERHEAD", need: 14 },
    { id: "great_white_shark", name: "GREAT WHITE",      need: 34 },
    { id: "megalodon",         name: "MEGALODON",        need: 75 },
  ];

  const sim = {
    on: false,          // a match is live and the player has a shark
    ended: false,       // this match resolved (died or won) — stop driving
    apex: false,        // won as the megalodon
    match: 0,
    shark: null,
    tier: 0, mass: 0, eaten: 0,
    biteT: 0, hudT: 0, podT: 0, stockT: 0, strandT: 0, hintT: 0,
    waterline: 0,       // mean radius where the sea meets this island's sand
  };
  CBZ.sharkSim = sim;
  CBZ.sharkSimShoreRing = null;   // read by entities/survivorbot.js's wander

  function depthMean(x, z) {
    return CBZ.survFloodDepthMeanAt ? Math.max(0, CBZ.survFloodDepthMeanAt(x, z)) : 0;
  }
  function seaYAt(x, z) {
    return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -0.8;
  }
  function arena() { return CBZ.surv && CBZ.surv.arena; }
  function h01(a, b) { return CBZ.hash01 ? CBZ.hash01(a, b, 0x5aac01) : Math.random(); }

  /* Where the sea meets the sand, averaged around the island. Everything
     placed "on the beach" or "wading" hangs off this one number, and it is
     re-measured per match because a surge can move it. */
  function measureWaterline() {
    const A = arena(); if (!A) return 0;
    let sum = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 6.283;
      let lo = A.radius * 0.9, hi = A.radius + 44;
      for (let it = 0; it < 20; it++) {
        const mid = (lo + hi) / 2;
        if (depthMean(A.center.x + Math.cos(a) * mid, A.center.z + Math.sin(a) * mid) > 0.02) hi = mid;
        else lo = mid;
      }
      sum += (lo + hi) / 2;
    }
    return sum / 16;
  }

  // ---- the crowd: humans in random places around the beach --------------
  function relocateBots() {
    const A = arena(); if (!A || !CBZ.bots) return;
    const WL = sim.waterline;
    CBZ.sharkSimShoreRing = { cx: A.center.x, cz: A.center.z, r0: A.radius * 1.02, r1: WL + 4 };
    for (let i = 0; i < CBZ.bots.length; i++) {
      const b = CBZ.bots[i];
      if (!b || b.dead) continue;
      const roll = h01(i * 1.71 + 3, sim.match);
      if (roll > 0.86) continue;                       // a few stay inland for the disasters
      const a = h01(i * 2.13 + 9, sim.match) * 6.283;
      const wade = roll > 0.62;                        // ~a quarter of the crowd is IN the water
      const r = wade ? (WL - 1 + h01(i, sim.match + 7) * 5)
                     : (A.radius * 1.03 + h01(i, sim.match + 11) * Math.max(4, WL - 3 - A.radius * 1.03));
      b.pos.x = A.center.x + Math.cos(a) * r;
      b.pos.z = A.center.z + Math.sin(a) * r;
      b.pos.y = CBZ.surv.floorAt(b.pos.x, b.pos.z);
      b.target.set(b.pos.x, 0, b.pos.z);
      b.pause = 0.5 + h01(i, sim.match + 13) * 3;
    }
  }

  function liveBots() {
    let n = 0; const b = CBZ.bots || [];
    for (let i = 0; i < b.length; i++) if (!b[i].dead) n++;
    return n;
  }
  function restock(dt) {
    sim.stockT -= dt;
    if (sim.stockT > 0) return;
    sim.stockT = 1.0;
    if (!CBZ.spawnSurvivorBotAt) return;
    const A = arena(); if (!A) return;
    // keep the buffet stocked — this is also what keeps survival's
    // last-one-standing win check permanently dormant while the sim runs
    let want = 40 - liveBots();
    want = Math.min(3, want);
    for (let i = 0; i < want; i++) {
      const a = Math.random() * 6.283;
      const r = A.radius * 1.03 + Math.random() * Math.max(4, sim.waterline - 2 - A.radius * 1.03);
      CBZ.spawnSurvivorBotAt(A.center.x + Math.cos(a) * r, A.center.z + Math.sin(a) * r);
    }
  }

  // ---- the shark ---------------------------------------------------------
  function claim(a) {
    a.tamed = true;         // the mount system's key
    a.huntable = true;      // ..and marine_predation's exception: the pod may still eat you
    a.petName = "You";
    a.alarm = 0; a.state = "wander"; a.stateT = 0;
  }
  function despawn(a) {
    if (!a) return;
    a.dead = true; a.huntable = false; a.tamed = false;
    if (a.group && a.group.parent) a.group.parent.remove(a.group);
    const list = CBZ.cityWildlife || [];
    const i = list.indexOf(a);
    if (i >= 0) list.splice(i, 1);
  }
  function findWild(id) {
    const list = CBZ.cityWildlife || [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a && !a.dead && !a.external && !a.tamed && !a.ridden && a.species && a.species.id === id && a.grow == null) return a;
    }
    return null;
  }
  function placeShark(a) {
    const A = arena(), P = CBZ.player;
    // just offshore of wherever the match dropped the player, so the swap
    // from castaway to shark reads instantly
    const ang = Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
    const r = sim.waterline + 26;
    const x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
    a.pos.x = x; a.pos.z = z;
    a.pos.y = seaYAt(x, z) - (a.swimDepth || 1.2);
    a.home = { x: x, z: z };
    a.heading = ang + Math.PI / 2; a.faceH = a.heading;
    if (a._waterMove) { a._waterMove.x = x; a._waterMove.z = z; a._waterMove.heading = a.heading; a._waterMove.blocked = false; }
  }
  function mountShark() {
    const S = sim.shark;
    if (!S || S.dead || !CBZ.cityMountAnimal) return;
    const cur = CBZ.cityMountedAnimal && CBZ.cityMountedAnimal();
    if (cur === S) return;                 // cityMountAnimal TOGGLES — never call it on the current mount
    if (cur && CBZ.cityDismount) CBZ.cityDismount();
    CBZ.cityMountAnimal(S);
  }

  function orcas(fn) {
    const list = CBZ.cityWildlife || [];
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a && !a.dead && !a.external && a.species && a.species.id === "orca") { n++; if (fn) fn(a); }
    }
    return n;
  }
  /* The threat curve. The pod already exists (stocked with the island's
     sea); this keeps it real: a match that starts with the orcas hunted out
     gets a fresh pod in deep water, and orcas that catch the scent stay
     motivated (hunger is what marine_predation hunts on). */
  function podPressure(dt) {
    sim.podT -= dt;
    if (sim.podT > 0) return;
    sim.podT = 8;
    const A = arena(), P = CBZ.player;
    let alive = orcas(function (a) {
      const d = Math.hypot(a.pos.x - P.pos.x, a.pos.z - P.pos.z);
      if (d < 160 && sim.tier < 3) a.hunger = Math.max(a.hunger || 0, 0.9);
    });
    const wantPod = sim.tier < 3 ? 3 : 1;   // the megalodon still needs ONE orca to exist — it's the win
    if (alive < wantPod && CBZ.cityWildlifeSpawnAt) {
      const ang = Math.random() * 6.283;
      for (let i = alive; i < wantPod; i++) {
        const r = sim.waterline + 90 + i * 14;
        const a2 = CBZ.cityWildlifeSpawnAt("orca",
          A.center.x + Math.cos(ang + i * 0.3) * r, A.center.z + Math.sin(ang + i * 0.3) * r);
        if (a2) a2.hunger = 0.8;
      }
    }
  }

  // ---- meals -------------------------------------------------------------
  function massOf(kind, target) {
    if (kind === "survivor" || kind === "ped" || kind === "cop") return 5;
    const hp = (target && (target.maxHp || (target.species && target.species.hp))) || 20;
    return Math.max(1, Math.round(hp / 25));
  }
  CBZ.sharkSimBite = function (kind, target, eater) {
    if (!sim.on || sim.ended || !eater || eater !== sim.shark) return;
    if (!target || !(target.dead || target.hp <= 0)) return;   // a chomp is not a meal until it kills
    const gain = massOf(kind, target);
    sim.mass += gain; sim.eaten++;
    const S = sim.shark;
    if (S && S.maxHp) S.hp = Math.min(S.maxHp, S.hp + S.maxHp * (0.05 + Math.min(0.25, gain * 0.012)));
    if (kind === "animal" && target.species && target.species.id === "orca" && sim.tier >= 3) { apexWin(); return; }
    const next = LADDER[sim.tier + 1];
    if (next && sim.mass >= next.need) evolve();
    else hudNow();
  };

  function evolve() {
    const S0 = sim.shark, next = LADDER[sim.tier + 1];
    if (!S0 || !next || !CBZ.cityWildlifeSpawnAt) return;
    const x = S0.pos.x, z = S0.pos.z, y = S0.pos.y, hd = S0.heading || 0;
    const S1 = CBZ.cityWildlifeSpawnAt(next.id, x, z);
    if (!S1) return;                        // spawn failed: stay this species, try again next meal
    sim.tier++;
    S1.pos.y = y; S1.heading = hd; S1.faceH = hd;
    if (S1._waterMove) { S1._waterMove.x = x; S1._waterMove.z = z; S1._waterMove.heading = hd; }
    claim(S1);
    if (CBZ.cityDismount) CBZ.cityDismount();
    despawn(S0);
    sim.shark = S1;
    mountShark();
    if (CBZ.waterSplashAt) CBZ.waterSplashAt(x, seaYAt(x, z), z, 3.6);
    if (CBZ.shake) CBZ.shake(0.55);
    if (CBZ.sfx) { try { CBZ.sfx("win", { volume: 0.5 }); } catch (e) {} }
    flash("YOU ARE THE " + next.name,
      sim.tier >= 3 ? "Now eat an orca." : "Next: " + LADDER[sim.tier + 1].name);
    hudNow();
  }

  function apexWin() {
    if (sim.ended) return;
    sim.ended = true; sim.apex = true;
    restoreRider();
    hideHud();                           // the win card owns the screen now
    if (CBZ.surv && CBZ.surv.stats) CBZ.surv.stats.placement = 1;
    if (CBZ.winGame) CBZ.winGame("survival");
    const sub = document.querySelector("#survwin .sub");
    if (sub) sub.textContent = "APEX PREDATOR — you ate the thing that eats sharks";
  }

  function onSharkDead() {
    if (sim.ended) return;
    sim.ended = true;
    restoreRider();
    hideHud();                           // ELIMINATED + spectate own the screen now
    g.invuln = 0;                        // drop the rider shield so the kill lands
    const S = sim.shark;
    if (CBZ.surv && CBZ.surv.hurt) {
      CBZ.surv.hurt(CBZ.surv.playerActor, 1e6, {
        cause: "eaten by the pod",
        fromX: S ? S.pos.x : CBZ.player.pos.x + 1, fromZ: S ? S.pos.z : CBZ.player.pos.z, fling: 4,
      });
    }
  }

  // ---- the rider is a passenger, not a picture ---------------------------
  function hideRider() {
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
  }
  function restoreRider() {
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = true;
  }

  /* A receding tsunami can leave the mount in ankle-deep water the nav
     field now calls land. Rather than freezing there, thrash back to sea:
     slide the shared root seaward (deeper is always radially outward on
     this island) until there is water under the body again. */
  function strandedFix(dt) {
    const A = arena(), P = CBZ.player;
    if (!A) return;
    if (depthMean(P.pos.x, P.pos.z) < 0.3) sim.strandT += dt;
    else sim.strandT = 0;
    if (sim.strandT > 1.2) {
      const dx = P.pos.x - A.center.x, dz = P.pos.z - A.center.z;
      const rr = Math.hypot(dx, dz) || 1;
      P.pos.x += (dx / rr) * 4.5 * dt;
      P.pos.z += (dz / rr) * 4.5 * dt;
    }
  }

  // ---- HUD ---------------------------------------------------------------
  let hud = null, hudLine1 = null, hudBar = null, hudLine2 = null, flashEl = null, flashSub = null;
  function buildHud() {
    if (hud) { hud.style.display = "block"; return; }
    hud = document.createElement("div");
    hud.id = "sharkhud";
    hud.style.cssText = "position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:45;" +
      "pointer-events:none;font-family:Fredoka,system-ui,sans-serif;text-align:center;" +
      "background:rgba(8,12,20,.62);border-radius:14px;padding:7px 16px 9px;min-width:230px;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.35)";
    hudLine1 = document.createElement("div");
    hudLine1.style.cssText = "color:#eaf4ff;font-size:17px;font-weight:700;letter-spacing:1px";
    const barWrap = document.createElement("div");
    barWrap.style.cssText = "height:6px;border-radius:3px;background:rgba(255,255,255,.14);margin:5px 0 4px;overflow:hidden";
    hudBar = document.createElement("div");
    hudBar.style.cssText = "height:100%;width:0%;border-radius:3px;background:linear-gradient(90deg,#39c06a,#9fe870);transition:width .25s ease";
    barWrap.appendChild(hudBar);
    hudLine2 = document.createElement("div");
    hudLine2.style.cssText = "color:#bcd0e2;font-size:12.5px";
    hud.appendChild(hudLine1); hud.appendChild(barWrap); hud.appendChild(hudLine2);
    document.body.appendChild(hud);
    flashEl = document.createElement("div");
    flashEl.style.cssText = "position:fixed;left:0;right:0;top:26vh;z-index:46;pointer-events:none;text-align:center;" +
      "font-family:Fredoka,system-ui,sans-serif;font-weight:700;font-size:clamp(30px,6vw,54px);color:#9fe870;" +
      "letter-spacing:2px;text-shadow:0 4px 0 #14532d,0 8px 18px rgba(0,0,0,.55);opacity:0;transition:opacity .5s ease";
    flashSub = document.createElement("div");
    flashSub.style.cssText = "font-size:clamp(14px,2.4vw,20px);color:#eaf4ff;letter-spacing:1px;text-shadow:0 2px 6px rgba(0,0,0,.6);margin-top:6px";
    flashEl.appendChild(flashSub);
    document.body.appendChild(flashEl);
  }
  let flashTimer = 0;
  function flash(big, small) {
    if (!flashEl) return;
    if (flashEl.firstChild && flashEl.firstChild !== flashSub) flashEl.removeChild(flashEl.firstChild);
    flashEl.insertBefore(document.createTextNode(big), flashSub);
    flashSub.textContent = small || "";
    flashEl.style.opacity = "1";
    flashTimer = 2.8;
  }
  function hudNow() { sim.hudT = 0; }
  function hudTick(dt) {
    if (!hud) return;
    if (flashTimer > 0) { flashTimer -= dt; if (flashTimer <= 0) flashEl.style.opacity = "0"; }
    sim.hudT -= dt;
    if (sim.hudT > 0) return;
    sim.hudT = 0.25;
    const S = sim.shark; if (!S) return;
    const hpPct = Math.max(0, Math.round(100 * S.hp / (S.maxHp || 1)));
    hudLine1.textContent = "🦈 " + LADDER[sim.tier].name + " · ❤ " + hpPct + "%";
    const next = LADDER[sim.tier + 1];
    if (next) {
      const prev = LADDER[sim.tier].need;
      hudBar.style.width = Math.min(100, Math.round(100 * (sim.mass - prev) / (next.need - prev))) + "%";
      hudLine2.textContent = "eat " + Math.max(0, next.need - sim.mass) + " more → " + next.name;
    } else {
      hudBar.style.width = "100%";
      hudLine2.textContent = "EAT AN ORCA.";
    }
    // the pod warning owns the line whenever death is actually nearby
    if (sim.tier < 3) {
      const P = CBZ.player;
      let near = 1e9;
      orcas(function (a) { const d = Math.hypot(a.pos.x - P.pos.x, a.pos.z - P.pos.z); if (d < near) near = d; });
      if (near < 70) hudLine2.textContent = "⚠ THE POD IS HUNTING YOU";
    }
    if (sim.hintT > 0) hudLine2.textContent = "point your mouth at food — the bite is automatic";
  }
  function hideHud() {
    if (hud) hud.style.display = "none";
    if (flashEl) flashEl.style.opacity = "0";
  }

  // ---- match lifecycle ---------------------------------------------------
  function setup() {
    const A = arena(); if (!A) { sim.lastSetup = "no-arena"; return; }
    sim.match++;
    despawn(sim.shark);                     // last match's body never lingers
    sim.shark = null;
    sim.tier = 0; sim.mass = 0; sim.eaten = 0;
    sim.ended = false; sim.apex = false;
    sim.biteT = 0; sim.podT = 2; sim.stockT = 3; sim.strandT = 0; sim.hudT = 0; sim.hintT = 7;
    sim.waterline = measureWaterline();
    relocateBots();
    // heal a boot race: PLAY clicked before wildlife.js parsed leaves the
    // island unstocked (survival.reset now heals this too; belt and braces
    // because this mode is UNPLAYABLE without a sea)
    if (!(CBZ.cityWildlife && CBZ.cityWildlife.length) && CBZ.cityWildlifeStock) {
      try { CBZ.cityWildlifeStock(A); } catch (e) {}
    }
    let S = findWild("bull_shark");
    sim.lastSetup = S ? "wild" : "spawn";
    if (!S && CBZ.cityWildlifeSpawnAt) S = CBZ.cityWildlifeSpawnAt("bull_shark", A.center.x + sim.waterline + 26, A.center.z);
    if (!S) { sim.lastSetup = "no-shark"; return; }   // wildlife absent (flag off?) — stay plain survival
    placeShark(S);
    claim(S);
    sim.shark = S;
    mountShark();
    buildHud();
    hudNow();
    flash("YOU ARE THE SHARK", "eat fish and swimmers · avoid the pod · become the MEGALODON");
    sim.on = true;
  }

  function teardown() {
    restoreRider();
    hideHud();
    g.invuln = 0;                        // never leak the rider shield into another mode
    CBZ.sharkSimShoreRing = null;
    if (sim.shark) { sim.shark.huntable = false; }   // whatever survives goes back to being a pet
    sim.on = false;
  }

  function step(dt) {
    const P = CBZ.player, S = sim.shark;
    sim.stepN = (sim.stepN || 0) + 1;          // heartbeat for tools/shark-sim-check.mjs
    if (!S) return;
    if (sim.ended) { hudTick(dt); return; }
    if (S.dead) { onSharkDead(); return; }
    if (sim.hintT > 0) sim.hintT -= dt;
    // the HUD health bar IS the shark — the rider has no separate body here.
    // Floor at 1 so nothing else mistakes the mirror for a death; the only
    // way to die is the shark dying, and that path is explicit above.
    P.hp = Math.max(1, Math.round(100 * S.hp / (S.maxHp || 1)));
    // ..and the rider is not separately killable: a lightning bolt or meteor
    // splash at sea was killing the HUMAN off the shark's back mid-game.
    // Disasters still rule the island (they kill the beach crowd, they move
    // the sea); the shark's own death is the one mortality, via onSharkDead,
    // which drops this shield first.
    if ((g.invuln || 0) < 2) g.invuln = 2;
    if (!P.dead) {
      mountShark();                          // E/dismount is not a control in this game
      hideRider();
      strandedFix(dt);
      sim.biteT -= dt;
      if (sim.biteT <= 0) {
        sim.biteT = 0.12;
        const pick = CBZ.cityAquaticBiteProbe && CBZ.cityAquaticBiteProbe();
        if (pick && CBZ.cityMountedAnimalAttack) {
          sim.fireN = (sim.fireN || 0) + 1;    // heartbeat: trigger pulls
          CBZ.cityMountedAnimalAttack(true);
        }
      }
    }
    podPressure(dt);
    restock(dt);
    hudTick(dt);
  }

  CBZ.onAlways(94, function (dt) {
    if (!dt || dt > 0.5) dt = 0.05;
    if (g.mode !== "survival") { if (sim.on) teardown(); return; }
    const st = g.state;
    if (st !== "playing") {
      if (sim.on && st === "title") teardown();
      else if (sim.on && (st === "won" || st === "lost")) { restoreRider(); hideHud(); sim.on = false; }
      return;
    }
    if (!sim.on) setup();
    else step(dt);
  });

  // ---- the mode's face: same island, different game ----------------------
  const desc = CBZ.modes && CBZ.modes.survival;
  if (desc) {
    desc.objective = "YOU ARE THE SHARK. Swim with your move keys (sprint to lunge) — the bite is automatic when prey is in front of your mouth. Eat fish and the people off the beach, grow through HAMMERHEAD and GREAT WHITE, and stay away from the orca pod until you are the MEGALODON. Then eat an orca.";
    const baseStats = desc.winStats;
    desc.winStats = function (game) {
      if (sim.apex) return [
        { label: "Final Form", value: "MEGALODON" },
        { label: "Things Eaten", value: sim.eaten },
        { label: "Time", value: CBZ.fmtTime ? CBZ.fmtTime(game.elapsed) : "-" },
      ];
      return baseStats ? baseStats(game) : [];
    };
  }
})();
