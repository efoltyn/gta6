/* ============================================================
   games/warband.js — WAR BAND, a small Bannerlord grammar proof.

   This is deliberately NOT a second character/combat/world engine. The city
   supplies real peds, outfits, weapons, death, drops, squad tactics, money,
   interactions, persistence and the mission surface. This file supplies only
   the game:

     muster a company → meet a rival company on physical ground → survivors
     surrender when surrounded → recruit one of them or ransom them → grow
     strong enough to win three banners.

   That is the reusable Bannerlord loop the owner cares about: money buys
   people, people create categorical power, and defeating everybody is not the
   only resolution. It is modern on purpose (pistols/rifles from the actual
   Gang City catalog); a Roman package can replace outfits and carried models
   later without changing one line of this battle/recruitment arc.

   Revert: CBZ.CONFIG.PKG_WARBAND = false.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.games) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PKG_WARBAND == null) CBZ.CONFIG.PKG_WARBAND = true;

  const MAX_COMPANY = 8;
  const WIN_BANNERS = 3;
  const B = {
    phase: "camp", allies: [], enemies: [], captives: [],
    initialEnemies: 0, shapeT: 0, roundPaid: false,
  };
  let C = null, V = null, S = null, mission = null;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function bag() {
    return S || (S = C.state(function () {
      return { active: false, troops: 2, wins: 0, losses: 0, renown: 0, prisoners: 0, complete: false };
    }));
  }
  function recruitCost(troops) { return 120 + Math.max(0, troops | 0) * 80; }
  function enemyCount(wins, troops) { return clamp(3 + (wins | 0) + Math.floor((troops | 0) / 3), 3, 8); }
  function ransomValue(wins) { return 140 + (wins | 0) * 70; }
  function alive(handles) {
    return (handles || []).filter(function (h) { return !!(h && h.ped && !h.ped.dead && (h.ped.hp == null || h.ped.hp > 0)); });
  }
  function nearest(from, handles) {
    let best = null, bd = Infinity;
    for (let i = 0; i < handles.length; i++) {
      const p = handles[i] && handles[i].ped;
      if (!p || p.dead || !p.pos) continue;
      const d = (p.pos.x - from.pos.x) * (p.pos.x - from.pos.x) + (p.pos.z - from.pos.z) * (p.pos.z - from.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function save() { if (C) C.saveState(); }
  function btn(id, label, color, disabled) {
    return "<span data-act='" + id + "' style='display:inline-block;margin:5px 6px 2px 0;padding:9px 14px;border-radius:9px;" +
      "background:" + (color || "#34523b") + ";font-weight:800;cursor:pointer;" + (disabled ? "opacity:.38;pointer-events:none;" : "") + "'>" + label + "</span>";
  }
  function heading(dx, dz) { return Math.atan2(dx, dz); }

  /* --------------------------- physical cast --------------------------- */
  function arm(p, side, i) {
    if (!p) return;
    p.staffPost = null;
    p.kind = "warband";
    p._warbandSide = side;
    p.faction = side === "ally" ? "player-company" : "rival-company";
    p.gang = side === "ally" ? -710 : -711;
    p.aggr = 0.78; p.snitch = 0; p.fear = 0; p.alarmed = 0;
    p.surrender = false; p.surrenderT = 0; p.controlled = false;
    // A captain carries a rifle, every third rank a sidearm, the rest close
    // to the shared melee exchange. Weapon category changes tactics without
    // changing HP or damage here.
    const rifle = i === 0, sidearm = !rifle && i % 3 === 0;
    p.armed = rifle || sidearm;
    p.weapon = rifle ? "AK-47" : sidearm ? "Pistol" : null;
    p.ammo = rifle ? 18 : sidearm ? 8 : 0;
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(p); } catch (e) {} }
  }
  function spawnFighter(side, i) {
    if (!C || !V) return null;
    const ally = side === "ally";
    const row = i >> 1, lane = (i & 1) ? 1 : -1;
    const x = (ally ? -18 : 18) + row * (ally ? -1.4 : 1.4);
    const z = lane * (2.4 + row * 1.5);
    const h = C.npc({
      role: ally ? "volunteer" : "rival",
      name: (ally ? "Company " : "Rival ") + (i + 1),
      outfit: ally ? "coveralls" : "hoodie",
      at: [x, z], face: heading(ally ? 1 : -1, 0),
      post: "ambient",
    });
    if (h && h.ped) arm(h.ped, side, i);
    return h;
  }
  function placeHandle(h, x, z, face) {
    if (!h) return;
    h.at(x, z, face);
    const p = h.ped;
    if (p) {
      p.path = null; p.finalGoal = null; p.state = "walk";
      if (p.target && p.target.set) p.target.set(p.pos.x, 0, p.pos.z);
    }
  }
  function ensureCompany() {
    const s = bag();
    B.allies = alive(B.allies);
    while (B.allies.length < Math.min(MAX_COMPANY, s.troops)) {
      const h = spawnFighter("ally", B.allies.length);
      if (!h) break;
      B.allies.push(h);
    }
    s.troops = B.allies.length;
    save();
  }
  function clearCombat(h) {
    const p = h && h.ped; if (!p || p.dead) return;
    p.rage = null; p.hunt = 0; p.huntPlayer = 0; p.state = "walk";
    p._sqRole = null; p._sqOwn = 0; p._squadHold = 0;
    p.fear = 0; p.alarmed = 0;
  }
  function removeLiving(h) {
    if (!h || !h.ped || h.ped.dead) return; // corpses belong to the world's morgue
    h.remove();
  }

  /* ----------------------------- campaign ------------------------------ */
  function startMission() {
    if (!C || !CBZ.mission || !CBZ.mission.start || bag().complete) return null;
    if (mission && mission.alive && mission.alive()) return mission;
    mission = C.mission({
      id: "three-banners",
      title: "Raise a War Band",
      giver: "The Muster Captain",
      brief: "Win three company battles. Surrounded survivors can join you or pay ransom.",
      goal: "custom",
      done: function () { return bag().wins >= WIN_BANNERS; },
      reward: { respect: 15 },
      doneText: "THREE BANNERS — the rival companies answer to yours.",
      onComplete: function () { const s = bag(); s.complete = true; save(); },
    });
    return mission;
  }
  function startCampaign() {
    const s = bag();
    s.active = true; save();
    startMission();
    ensureCompany();
  }
  function beginBattle() {
    if (B.phase === "battle") return false;
    startCampaign();
    ensureCompany();
    const allies = alive(B.allies);
    if (!allies.length) { C.hud.toast("No company to field."); return false; }
    for (let i = 0; i < B.enemies.length; i++) removeLiving(B.enemies[i]);
    B.enemies = []; B.captives = []; B.roundPaid = false;
    const count = enemyCount(bag().wins, allies.length);
    for (let i = 0; i < count; i++) {
      const h = spawnFighter("enemy", i);
      if (h) B.enemies.push(h);
    }
    if (!B.enemies.length) { C.hud.toast("No rival company reached the field."); return false; }
    B.initialEnemies = B.enemies.length;
    // Re-form both companies on their standards before giving the brains rage.
    for (let i = 0; i < allies.length; i++) {
      const row = i >> 1, lane = (i & 1) ? 1 : -1;
      placeHandle(allies[i], -18 - row * 1.4, lane * (2.4 + row * 1.5), Math.PI / 2);
      arm(allies[i].ped, "ally", i);
    }
    for (let i = 0; i < B.enemies.length; i++) {
      const row = i >> 1, lane = (i & 1) ? 1 : -1;
      placeHandle(B.enemies[i], 18 + row * 1.4, lane * (2.4 + row * 1.5), -Math.PI / 2);
      arm(B.enemies[i].ped, "enemy", i);
    }
    B.phase = "battle"; B.shapeT = 0;
    C.hud.closePanel();
    C.hud.toast("BANNERS UP — your company fights on the west line.");
    return true;
  }
  function surrenderEnemy(h, i) {
    const p = h && h.ped; if (!p || p.dead) return;
    p.rage = null; p.state = "surrender"; p.speed = 0;
    p.surrender = true; p.surrenderT = 999;
    p.armed = false;
    if (p.char) { p.char.surrender = true; p.char.handsUp = true; }
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(p); } catch (e) {} }
    // Stand on the camp side of the rail instead of putting the actor capsule
    // through its collider. The rail is a readable boundary, not a body rack.
    placeHandle(h, -1.4, -12 + i * 2.2, Math.PI);
  }
  function settleVictory(captives) {
    if (B.roundPaid) return;
    B.roundPaid = true;
    const s = bag(), liveAllies = alive(B.allies);
    s.troops = liveAllies.length;
    s.wins++; s.renown += 10 + B.initialEnemies * 2;
    const purse = 220 + B.initialEnemies * 65 + s.wins * 40;
    C.wallet.give(purse, "Rival banner taken");
    B.captives = captives || [];
    s.prisoners += B.captives.length;
    for (let i = 0; i < liveAllies.length; i++) clearCombat(liveAllies[i]);
    for (let i = 0; i < B.captives.length; i++) surrenderEnemy(B.captives[i], i);
    B.phase = B.captives.length ? "prisoners" : "between";
    save();
    C.hud.toast("VICTORY " + s.wins + "/" + WIN_BANNERS + (B.captives.length ? " — " + B.captives.length + " surrendered." : "."));
    if (B.captives.length) openPrisoners();
    else openCamp();
  }
  function settleDefeat() {
    const s = bag();
    s.losses++; s.troops = 1; s.renown = Math.max(0, s.renown - 5);
    for (let i = 0; i < alive(B.enemies).length; i++) clearCombat(alive(B.enemies)[i]);
    B.phase = "between"; B.allies = [];
    save(); ensureCompany();
    C.hud.toast("COMPANY BROKEN — one volunteer waits at the standard.");
    openCamp();
  }
  function decideCaptive(recruit) {
    const s = bag();
    const h = B.captives.shift();
    if (!h) { finishPrisoners(); return; }
    const ei = B.enemies.indexOf(h);
    if (ei >= 0) B.enemies.splice(ei, 1); // ownership transfers; next round must not despawn a recruit
    s.prisoners = Math.max(0, (s.prisoners || 0) - 1);
    if (recruit && s.troops < MAX_COMPANY && h.ped && !h.ped.dead) {
      const p = h.ped;
      p.surrender = false; p.surrenderT = 0;
      if (p.char) { p.char.surrender = false; p.char.handsUp = false; }
      arm(p, "ally", s.troops);
      B.allies.push(h); s.troops++;
      h.say("I fight under your banner now.");
    } else {
      const pay = ransomValue(s.wins);
      C.wallet.give(pay, "Prisoner ransom");
      removeLiving(h);
    }
    save();
    if (B.captives.length) openPrisoners(); else finishPrisoners();
  }
  function finishPrisoners() {
    const s = bag();
    B.phase = "between";
    if (s.wins >= WIN_BANNERS) s.complete = true;
    save();
    openCamp();
  }

  /* ------------------------------- tick -------------------------------- */
  function battleTick(dt) {
    if (B.phase !== "battle") return;
    const allies = alive(B.allies), enemies = alive(B.enemies);
    if (!allies.length) { settleDefeat(); return; }
    if (!enemies.length) { settleVictory([]); return; }

    // Rebind a dead target to the nearest living opponent. Rage is the SAME
    // field the ordinary ped brain reads; no package combat loop exists.
    for (let i = 0; i < allies.length; i++) {
      const p = allies[i].ped, t = (!p.rage || p.rage.dead) ? nearest(p, enemies) : p.rage;
      if (t) { p.rage = t; p.state = "fight"; }
    }
    for (let i = 0; i < enemies.length; i++) {
      const p = enemies[i].ped, t = (!p.rage || p.rage.dead) ? nearest(p, allies) : p.rage;
      if (t) { p.rage = t; p.state = "fight"; }
    }

    B.shapeT -= dt;
    if (B.shapeT <= 0) {
      B.shapeT = 0.35;
      if (CBZ.cityShapeSquad) {
        CBZ.cityShapeSquad(allies[0].ped, allies.map(function (h) { return h.ped; }), enemies[0].ped);
        CBZ.cityShapeSquad(enemies[0].ped, enemies.map(function (h) { return h.ped; }), allies[0].ped);
      }
    }

    // Bannerlord's important alternative to extermination: a remnant yields
    // when it has taken losses and is physically outnumbered. No morale stat,
    // no dice, no extra HP—the visible situation is the rule.
    const tookLoss = enemies.length < B.initialEnemies;
    const remnant = enemies.length <= Math.max(1, Math.floor(B.initialEnemies / 3));
    if (tookLoss && remnant && allies.length >= enemies.length + 1) settleVictory(enemies.slice());
  }

  /* ------------------------------- UI ---------------------------------- */
  function openCamp() {
    if (!C) return;
    const s = bag(), cost = recruitCost(s.troops);
    const title = s.complete ? "THREE BANNERS TAKEN" : "WAR BAND — THE MUSTER";
    const body =
      "<b style='letter-spacing:2px;color:#e8b64c'>" + title + "</b>" +
      "<div style='margin:7px 0;color:#d9e1d2'>Company <b>" + s.troops + "/" + MAX_COMPANY + "</b> · victories <b>" + s.wins + "/" + WIN_BANNERS +
      "</b> · losses " + s.losses + " · renown " + s.renown + "<br>Cash <b>$" + C.wallet.cash().toLocaleString() + "</b></div>" +
      "<div style='font-size:12px;color:#aebaa9;margin-bottom:5px'>People are the progression. Beat a company, surround its remnant, then decide who joins and who pays.</div>" +
      btn("recruit", "RECRUIT VOLUNTEER $" + cost, "#365b42", s.troops >= MAX_COMPANY || !C.wallet.canAfford(cost)) +
      btn("battle", s.complete ? "DEFEND THE BANNER" : "CHALLENGE RIVAL COMPANY", "#7b3d2c", B.phase === "battle") +
      btn("close", "Leave", "#26343c");
    C.hud.panel(body, {
      recruit: function () {
        const ss = bag(), price = recruitCost(ss.troops);
        if (ss.troops >= MAX_COMPANY || !C.wallet.spend(price, "Volunteer signed")) return;
        ss.troops++; save(); ensureCompany(); openCamp();
      },
      battle: beginBattle,
      close: function () { C.hud.closePanel(); },
    });
  }
  function openPrisoners() {
    if (!C) return;
    const s = bag(), n = B.captives.length, canRecruit = s.troops < MAX_COMPANY;
    C.hud.panel(
      "<b style='letter-spacing:2px;color:#e8b64c'>THE REMNANT YIELDS</b>" +
      "<div style='margin:7px 0'>" + n + " rival" + (n === 1 ? "" : "s") + " at the prisoner rail. Decide one life at a time.</div>" +
      "<div style='font-size:12px;color:#aebaa9'>Recruiting turns an enemy body into your next real company member. Ransom turns the same captive into money for more volunteers.</div>" +
      btn("join", "OFFER A PLACE", "#365b42", !canRecruit) +
      btn("ransom", "RANSOM $" + ransomValue(s.wins), "#7a5a25") +
      btn("close", "Decide later", "#26343c"),
      {
        join: function () { decideCaptive(true); },
        ransom: function () { decideCaptive(false); },
        close: function () { C.hud.closePanel(); },
      }
    );
  }

  /* ------------------------------ venue -------------------------------- */
  function campSite() {
    const F = CBZ.worldFoot && CBZ.worldFoot("desert");
    if (!F) return null;
    const candidates = [
      { x: F.minX + 120, z: F.maxZ - 110 },
      { x: F.maxX - 130, z: F.maxZ - 120 },
      { x: F.minX + 150, z: F.minZ + 120 },
      { x: F.maxX - 150, z: F.minZ + 130 },
    ];
    let best = null, bs = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const p = candidates[i], ys = [];
      for (let x = -28; x <= 28; x += 28) for (let z = -18; z <= 18; z += 18) {
        ys.push(CBZ.floorAt ? CBZ.floorAt(p.x + x, p.z + z) : 0);
      }
      const lo = Math.min.apply(Math, ys), hi = Math.max.apply(Math, ys);
      const score = hi - lo;
      if (score < bs) { bs = score; best = { x: p.x, z: p.z, y: ys[4] || 0, slope: score }; }
    }
    return best;
  }
  function build(ctx, venue) {
    C = ctx; V = venue;
    const baseY = (venue.anchor && venue.anchor.y) || 0;
    venue.group.position.y = baseY;
    const g = venue.group;
    // The packed-earth field is load-bearing: it is the readable boundary and
    // the flat tactical surface. Everything else is either a control or a rule.
    ctx.box(g, 0, 0.08, 0, 64, 0.16, 44, ctx.mat(0x8b7046));
    // Two standards communicate the opposing deployment lines.
    ctx.box(g, -23, 2.5, 0, 0.22, 5, 0.22, ctx.mat(0x413427));
    ctx.box(g, -21.8, 3.7, 0, 2.4, 1.5, 0.12, ctx.mat(0x356f4b));
    ctx.box(g, 23, 2.5, 0, 0.22, 5, 0.22, ctx.mat(0x413427));
    ctx.box(g, 21.8, 3.7, 0, 2.4, 1.5, 0.12, ctx.mat(0x8a3434));
    ctx.solid(-23.25, -0.25, -22.75, 0.25, baseY, baseY + 5);
    ctx.solid(22.75, -0.25, 23.25, 0.25, baseY, baseY + 5);
    // The command table is the one camp control; the rail physically stages
    // surrendering bodies for the recruit/ransom decision.
    ctx.box(g, -5, 0.65, -17, 4.2, 1.3, 1.8, ctx.mat(0x5b3b24));
    ctx.solid(-7.1, -17.9, -2.9, -16.1, baseY, baseY + 1.3);
    ctx.box(g, 0, 0.8, -12, 0.22, 1.6, 18, ctx.mat(0x4b4034));
    ctx.solid(-0.2, -21, 0.2, -3, baseY, baseY + 1.6);

    ctx.npc({
      role: "captain", name: "Muster Captain", outfit: "security",
      at: [-5, -15.4], face: Math.PI, post: "pinned",
      dialogue: ["Coin finds volunteers. Victory makes them loyal.", "A surrounded remnant is worth more alive.", "Three banners make a company a power."],
    });
    ctx.zone({ id: "muster", label: "Muster your company", pos: [-5, -15.5], r: 3.0, onUse: openCamp });
    ctx.zone({
      id: "prisoners", label: "Decide the prisoners", pos: [0, -12], r: 3.2,
      canShow: function () { return B.phase === "prisoners" && B.captives.length > 0; },
      onUse: openPrisoners,
    });
    ensureCompany();
    if (bag().active && !bag().complete) startMission();
  }

  CBZ.games.register({
    id: "warband",
    title: "WAR BAND",
    venue: { site: "warband-camp", resolve: campSite },
    build: build,
    update: function (ctx, dt) { battleTick(Math.min(0.12, dt)); },
    api: {
      rules: { recruitCost: recruitCost, enemyCount: enemyCount, ransomValue: ransomValue, maxCompany: MAX_COMPANY, winBanners: WIN_BANNERS },
      state: function () { return S ? JSON.parse(JSON.stringify(S)) : null; },
      battle: function () { return { phase: B.phase, allies: alive(B.allies).length, enemies: alive(B.enemies).length, captives: B.captives.length, initialEnemies: B.initialEnemies }; },
      open: openCamp,
      start: beginBattle,
      forceSurrender: function () { if (B.phase === "battle") { settleVictory(alive(B.enemies)); return true; } return false; },
      recruitCaptive: function () { if (B.captives.length) { decideCaptive(true); return true; } return false; },
      ransomCaptive: function () { if (B.captives.length) { decideCaptive(false); return true; } return false; },
      site: campSite,
    },
  });
})();
