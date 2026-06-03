/* ============================================================
   city/hud.js — the CITY heads-up display: cash, the 5-star wanted
   meter, health / hunger / stamina bars, equipped weapon + ammo, and
   the active-job objective line with distance. Self-contained overlay
   shown only in city mode (prison/survival HUD is hidden via .mode-city).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  let root, cashEl, starsEl, hpBar, hungerBar, stamBar, wpnEl, jobEl, crewEl, worldEl, radar, turfEl, homeLineEl;
  let dirty = true;

  function build() {
    if (root) return;
    root = document.createElement("div");
    root.id = "cityHud";
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:20;display:none;font-family:Fredoka,system-ui,sans-serif";
    root.innerHTML =
      "<div style='position:absolute;top:14px;right:16px;text-align:right'>" +
      "  <div id='cMoney' style='font-size:30px;font-weight:700;color:#7ed957;text-shadow:0 2px 0 #1f5a2a'>$0</div>" +
      "  <div id='cStars' style='font-size:24px;letter-spacing:2px;margin-top:2px'></div>" +
      "  <div id='cCrew' style='font-size:13px;color:#9fb0c6;margin-top:2px'></div>" +
      "  <div id='cWorld' style='font-size:12px;color:#ffd166;margin-top:2px'></div>" +
      "</div>" +
      "<div style='position:absolute;left:16px;bottom:16px;width:230px'>" +
      "  <div style='font-size:11px;color:#ffb3b3'>HEALTH</div><div style='height:12px;background:rgba(0,0,0,.45);border-radius:6px;overflow:hidden;margin-bottom:5px'><div id='cHp' style='height:100%;width:100%;background:linear-gradient(90deg,#ff5b5b,#ff9e6b)'></div></div>" +
      "  <div style='font-size:11px;color:#ffd9a8'>FOOD</div><div style='height:12px;background:rgba(0,0,0,.45);border-radius:6px;overflow:hidden;margin-bottom:5px'><div id='cFood' style='height:100%;width:100%;background:linear-gradient(90deg,#e8a23c,#ffd166)'></div></div>" +
      "  <div style='font-size:11px;color:#a8e0ff'>STAMINA</div><div style='height:8px;background:rgba(0,0,0,.45);border-radius:5px;overflow:hidden'><div id='cStam' style='height:100%;width:100%;background:linear-gradient(90deg,#39c0d0,#7fe0ff)'></div></div>" +
      "</div>" +
      "<div id='cWpn' style='position:absolute;right:16px;bottom:16px;text-align:right;color:#e8eef7;font-size:15px'></div>" +
      "<div id='cJob' style='position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center;color:#ffd166;font-size:14px;max-width:60%'></div>" +
      "<canvas id='cRadar' width='180' height='180' style='position:absolute;left:14px;top:14px;background:rgba(10,12,18,.5);border:2px solid #2c3140;border-radius:10px'></canvas>" +
      "<div id='cTurf' style='position:absolute;left:16px;top:200px;font-size:13px;font-weight:700'></div>" +
      "<div id='cHomeLine' style='position:absolute;left:16px;top:220px;font-size:12px;color:#9fb0c6'></div>" +
      "<div id='cCross' style='position:absolute;left:50%;top:50%;width:7px;height:7px;margin:-4px 0 0 -4px;border:2px solid rgba(255,255,255,.85);border-radius:50%;display:none'></div>";
    document.body.appendChild(root);
    cashEl = root.querySelector("#cMoney"); starsEl = root.querySelector("#cStars"); crewEl = root.querySelector("#cCrew"); worldEl = root.querySelector("#cWorld");
    hpBar = root.querySelector("#cHp"); hungerBar = root.querySelector("#cFood"); stamBar = root.querySelector("#cStam");
    wpnEl = root.querySelector("#cWpn"); jobEl = root.querySelector("#cJob");
    radar = root.querySelector("#cRadar"); turfEl = root.querySelector("#cTurf"); homeLineEl = root.querySelector("#cHomeLine");
  }

  // ---- the city minimap: a north-up radar that clearly marks every building
  //      by what it is, plus cars/cops and your objective. ----
  let radarAcc = 0;
  const LOT_COL = { shop: "#7ed957", tower: "#5b8bff", abandoned: "#e2574b", park: "#3f9a4f" };
  function drawRadar() {
    if (!radar) return;
    const ctx = radar.getContext("2d"); if (!ctx) return;
    const W = radar.width, H = radar.height, R = 120;              // world units shown around you
    const sc = (W / 2) / R;
    const P = CBZ.player, px = P.pos.x, pz = P.pos.z;
    const A = CBZ.city && CBZ.city.arena; if (!A) return;
    ctx.clearRect(0, 0, W, H);
    const toX = (wx) => W / 2 + (wx - px) * sc, toY = (wz) => H / 2 + (wz - pz) * sc;
    // roads (grey grid lines within view)
    ctx.strokeStyle = "rgba(150,160,175,.35)"; ctx.lineWidth = Math.max(1, A.ROAD * sc * 0.7);
    for (const x of A.xLines) { ctx.beginPath(); ctx.moveTo(toX(x), 0); ctx.lineTo(toX(x), H); ctx.stroke(); }
    for (const z of A.zLines) { ctx.beginPath(); ctx.moveTo(0, toY(z)); ctx.lineTo(W, toY(z)); ctx.stroke(); }
    // connected island district: beach outline, copied street grid and bridge
    if (A.annex) {
      const X = A.annex;
      ctx.strokeStyle = "rgba(230,212,154,.75)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(toX(X.cx), toY(X.cz), X.radius * sc, 0, 6.28); ctx.stroke();
      ctx.strokeStyle = "rgba(150,160,175,.48)"; ctx.lineWidth = Math.max(1, 5 * sc);
      for (const r of X.roads) {
        ctx.beginPath();
        if (r.vertical) { ctx.moveTo(toX(r.x), toY(r.z - r.len / 2)); ctx.lineTo(toX(r.x), toY(r.z + r.len / 2)); }
        else { ctx.moveTo(toX(r.x - r.len / 2), toY(r.z)); ctx.lineTo(toX(r.x + r.len / 2), toY(r.z)); }
        ctx.stroke();
      }
      if (A.bridge) {
        ctx.beginPath(); ctx.moveTo(toX(A.bridge.minX), toY((A.bridge.minZ + A.bridge.maxZ) / 2));
        ctx.lineTo(toX(A.bridge.maxX), toY((A.bridge.minZ + A.bridge.maxZ) / 2)); ctx.stroke();
      }
      for (const lot of X.lots) {
        if (Math.abs(lot.cx - px) > R + 20 || Math.abs(lot.cz - pz) > R + 20) continue;
        const s = Math.max(3, Math.min(14, (lot.w || 12) * sc));
        const ipoi = CBZ.fullMap && CBZ.fullMap.poi && CBZ.fullMap.poi(lot);
        ctx.fillStyle = ipoi ? ipoi.color : (LOT_COL[lot.kind] || "#8a939c"); ctx.globalAlpha = 0.88;
        ctx.fillRect(toX(lot.cx) - s / 2, toY(lot.cz) - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    }
    // buildings: a coloured square per lot, brighter dots for special places
    for (const lot of A.lots) {
      if (Math.abs(lot.cx - px) > R + 20 || Math.abs(lot.cz - pz) > R + 20) continue;
      const b = lot.building;
      // colour shops by TRADE (same palette as the full map) so the radar is
      // readable at a glance — bank=blue, guns=green, hospital=red, etc.
      const poi = CBZ.fullMap && CBZ.fullMap.poi && CBZ.fullMap.poi(lot);
      let col = poi ? poi.color : (LOT_COL[lot.kind] || "#8a939c");
      if (!poi && b && b.gangColor) col = "#" + ("000000" + (b.gangColor >>> 0).toString(16)).slice(-6);
      const s = Math.max(3, (lot.w || 20) * sc);
      ctx.fillStyle = col; ctx.globalAlpha = 0.85;
      ctx.fillRect(toX(lot.cx) - s / 2, toY(lot.cz) - s / 2, s, s);
      ctx.globalAlpha = 1;
      // special markers
      if (b && b.shop && (lot.kind === "chop")) ringMark(ctx, toX(lot.cx), toY(lot.cz), "#e88a3c");
      if (b && b.shop && lot.kind === "realtor") ringMark(ctx, toX(lot.cx), toY(lot.cz), "#4fd0a0");
      if (CBZ.game.cityHome && CBZ.game.cityHome.lot === lot) ringMark(ctx, toX(lot.cx), toY(lot.cz), "#ffd451");
    }
    // cars (white), cops (cyan)
    ctx.fillStyle = "rgba(235,238,245,.7)";
    for (const c of CBZ.cityCars) { if (c.dead) continue; const dx = c.pos.x - px, dz = c.pos.z - pz; if (dx * dx + dz * dz > R * R) continue; ctx.fillRect(toX(c.pos.x) - 1.5, toY(c.pos.z) - 1.5, 3, 3); }
    ctx.fillStyle = "#5bd0ff";
    for (const c of CBZ.cityCops) { if (c.dead) continue; const dx = c.pos.x - px, dz = c.pos.z - pz; if (dx * dx + dz * dz > R * R) continue; ctx.beginPath(); ctx.arc(toX(c.pos.x), toY(c.pos.z), 2.4, 0, 6.28); ctx.fill(); }
    // objective beacon
    const j = CBZ.game.cityJob;
    if (j && j.dest) markStar(ctx, toX(j.dest.x), toY(j.dest.z), "#7ed957");
    if (CBZ.game.cityPartner && CBZ.game.cityPartner.kidnapped) markStar(ctx, toX(CBZ.game.cityPartner.pos.x), toY(CBZ.game.cityPartner.pos.z), "#ff6bd0");
    const wp = CBZ.fullMap && CBZ.fullMap.waypoint();
    if (wp && CBZ.fullMap.trace) CBZ.fullMap.trace(ctx, toX, toY);
    if (wp) ringMark(ctx, toX(wp.x), toY(wp.z), "#7de7ff");
    // player arrow (centre), pointing along camera yaw
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, a = yaw + Math.PI;
    ctx.fillStyle = "#ffffff"; ctx.beginPath();
    ctx.moveTo(W / 2 + Math.sin(a) * 6, H / 2 + Math.cos(a) * 6);
    ctx.lineTo(W / 2 + Math.sin(a + 2.4) * 5, H / 2 + Math.cos(a + 2.4) * 5);
    ctx.lineTo(W / 2 + Math.sin(a - 2.4) * 5, H / 2 + Math.cos(a - 2.4) * 5);
    ctx.closePath(); ctx.fill();
  }
  function ringMark(ctx, x, y, col) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.28); ctx.stroke(); }
  function markStar(ctx, x, y, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 4, 0, 6.28); ctx.fill(); }

  CBZ.cityHudDirty = function () { dirty = true; };

  function renderText() {
    build();
    cashEl.textContent = "$" + (g.cash || 0);
    let s = "";
    const w = g.wanted | 0;
    for (let i = 1; i <= 5; i++) s += i <= w ? "<span style='color:#ffd166'>★</span>" : "<span style='color:#4a4f57'>★</span>";
    starsEl.innerHTML = s;
    const crew = g.cityCrew || 0, bank = g.cityBank || 0;
    crewEl.textContent = (crew ? "crew " + crew + "   " : "") + (bank ? "bank $" + bank : "");
    if (worldEl) worldEl.textContent = CBZ.cityWorldSummary ? CBZ.cityWorldSummary() : "";
    // weapon
    // gun name from the ENGINE's current weapon (stays right after a Q/wheel
    // swap); melee items (Bat/Knife) have no engine id, so fall back to g.cityWeapon.
    const ENGINE_NAME = { sidearm: "Pistol", smg: "SMG", shotgun: "Shotgun", carbine: "Rifle", taser: "Taser", revolver: "Revolver", deagle: "Desert Eagle", ak47: "AK-47", uzi: "Uzi", sniper: "Sniper", lmg: "LMG" };
    const wn = (CBZ.currentWeaponId && (CBZ.hasAnyWeapon && CBZ.hasAnyWeapon())) ? ENGINE_NAME[CBZ.currentWeaponId] : g.cityWeapon;
    if (wn) {
      const it = CBZ.cityEcon.ITEMS[wn];
      // guns show their ammo in the engine's own #ammo readout (fpsmode); here
      // we just name the equipped weapon + armor so the two HUDs don't disagree.
      wpnEl.innerHTML = "<b>" + wn + "</b>" + (it && it.gun ? " <span style='color:#8a93a3;font-size:12px'>(ammo ↘)</span>" : "") + ((CBZ.player._armor || 0) > 0 ? "<br><span style='color:#7fd0ff'>🛡 " + Math.round(CBZ.player._armor) + "</span>" : "");
    } else wpnEl.innerHTML = (CBZ.player._armor || 0) > 0 ? "<span style='color:#7fd0ff'>🛡 " + Math.round(CBZ.player._armor) + "</span>" : "Fists";
    // job
    const j = g.cityJob;
    if (j) {
      let dist = "";
      if (j.dest) dist = "  ·  " + Math.round(Math.hypot(CBZ.player.pos.x - j.dest.x, CBZ.player.pos.z - j.dest.z)) + "m";
      else if ((j.type === "hit" || j.type === "hitman") && j.target && !j.target.dead) dist = "  ·  " + Math.round(Math.hypot(CBZ.player.pos.x - j.target.pos.x, CBZ.player.pos.z - j.target.pos.z)) + "m";
      jobEl.textContent = "🎯 " + j.desc + " ($" + j.reward + ")" + dist;
    } else jobEl.textContent = "";
    dirty = false;
  }

  CBZ.onAlways(46, function () {
    build();
    const show = g.mode === "city";
    root.style.display = show ? "block" : "none";
    document.body.classList.toggle("mode-city", show);
    if (!show) return;
    if (dirty) renderText();
    // bars + live job distance update every frame (cheap)
    const P = CBZ.player, maxHp = P.maxHp || 100;
    hpBar.style.width = Math.max(0, Math.min(100, (P.hp / maxHp) * 100)) + "%";
    hungerBar.style.width = Math.max(0, Math.min(100, g.hunger || 0)) + "%";
    stamBar.style.width = Math.max(0, Math.min(100, (P.stamina == null ? 100 : P.stamina))) + "%";
    if (g.cityJob && (g.cityJob.dest || g.cityJob.type === "hit")) renderText();
    // radar (throttled), turf + home/partner status
    radarAcc += 1 / 60;
    if (radarAcc >= 1 / 14) { radarAcc = 0; drawRadar(); }
    if (turfEl) {
      const gang = CBZ.cityGangOf ? CBZ.cityGangOf(P.pos.x, P.pos.z) : null;
      if (gang) { const prov = gang.provoke > 0.4; turfEl.innerHTML = "<span style='color:#" + ("000000" + gang.color.toString(16)).slice(-6) + "'>" + gang.name.toUpperCase() + " TURF</span>" + (prov ? " <span style='color:#ff5b5b'>⚠ HOSTILE</span>" : ""); }
      else turfEl.textContent = "";
    }
    if (homeLineEl) {
      const parts = [];
      if (g.cityHome) parts.push("🏠 " + g.cityHome.name);
      else if (g.cityRentTier != null) parts.push("🏠 renting");
      if (g.cityPartner) parts.push((g.citySpouse ? "💍 " : "💕 ") + g.cityPartner.name + (g.cityPartner.kidnapped ? " (TAKEN!)" : ""));
      homeLineEl.textContent = parts.join("   ");
    }
    // aiming reticle when holding a firearm on foot — but the engine gun system
    // (fpsmode) draws its OWN reticle whenever it's presenting a weapon, so only
    // show the city dot when fpsmode is NOT (avoids two crosshairs).
    const cross = root.querySelector("#cCross");
    if (cross) {
      const it = g.cityWeapon ? CBZ.cityEcon.ITEMS[g.cityWeapon] : null;
      const fpsAiming = (CBZ.weaponThirdPersonActive && CBZ.weaponThirdPersonActive()) || (CBZ.fpsActive && CBZ.fpsActive());
      cross.style.display = (it && it.gun && !fpsAiming && !P.driving && !P.dead && !CBZ.cityMenuOpen) ? "block" : "none";
    }
  });
})();
