/* ============================================================
   city/hud.js — the CITY heads-up display: cash, the 5-star wanted
   meter, health / hunger / stamina bars, equipped weapon + ammo, and
   the active-job objective line with distance. Self-contained overlay
   shown only in city mode (prison/survival HUD is hidden via .mode-city).

   GTA-clean pass: money flashes a +/- delta on change, the wanted meter
   only shows when you HAVE a level (and flashes while heat is rising),
   the radar got a circular framed look with a compass tick + your-car +
   crew + cop-direction blips + a speedometer when driving, and a tidy
   city event feed (CBZ.cityFeed) stacks recent street events down the
   left without fighting the engine's global toast.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  let root, cashEl, deltaEl, starsEl, starsWrap, hpBar, hungerBar, stamBar, wpnEl, jobEl, crewEl, worldEl, radar, turfEl, homeLineEl, feedEl, speedEl;
  let dirty = true;

  function build() {
    if (root) return;
    // one-time keyframes for the money pulse + delta float (cheap, GPU-friendly)
    if (!document.getElementById("cHudCss")) {
      const st = document.createElement("style");
      st.id = "cHudCss";
      st.textContent =
        "@keyframes cMoneyPulse{0%{transform:scale(1)}35%{transform:scale(1.14)}100%{transform:scale(1)}}" +
        "@keyframes cDeltaUp{0%{opacity:0;transform:translateY(6px)}18%{opacity:1}100%{opacity:0;transform:translateY(-16px)}}" +
        "@keyframes cStarFlash{0%,100%{opacity:1}50%{opacity:.35}}" +
        "@keyframes cFeedIn{0%{opacity:0;transform:translateX(-14px)}100%{opacity:1;transform:translateX(0)}}" +
        "#cHud .cPanel{background:rgba(10,13,20,.42);border:1px solid rgba(255,255,255,.10);border-radius:10px;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}" +
        "#cHud .cFeedRow{animation:cFeedIn .22s ease-out;background:rgba(8,11,17,.55);border-left:3px solid #7ed957;border-radius:4px;padding:4px 9px;margin-top:5px;color:#e8eef7;font-size:13px;line-height:1.25;max-width:300px;box-shadow:0 2px 6px rgba(0,0,0,.35)}";
      document.head.appendChild(st);
    }
    root = document.createElement("div");
    root.id = "cityHud";
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:20;display:none;font-family:Fredoka,system-ui,sans-serif";
    root.innerHTML =
      "<div id='cHud' style='position:absolute;inset:0'>" +
      "<div style='position:absolute;top:14px;right:16px;text-align:right'>" +
      "  <div style='position:relative;display:inline-block'>" +
      "    <div id='cMoney' style='font-size:32px;font-weight:700;color:#7ed957;text-shadow:0 2px 0 #1f5a2a,0 0 14px rgba(126,217,87,.35)'>$0</div>" +
      "    <div id='cDelta' style='position:absolute;right:0;top:-6px;font-size:18px;font-weight:700;opacity:0;pointer-events:none'></div>" +
      "  </div>" +
      "  <div id='cStarsWrap' style='display:none;margin-top:4px;padding:2px 8px;border-radius:8px;background:rgba(8,11,17,.5)'><span id='cStars' style='font-size:23px;letter-spacing:3px'></span></div>" +
      "  <div id='cCrew' style='font-size:13px;color:#9fb0c6;margin-top:3px'></div>" +
      "  <div id='cWorld' style='font-size:12px;color:#ffd166;margin-top:2px'></div>" +
      "</div>" +
      "<div style='position:absolute;left:16px;bottom:16px;width:230px'>" +
      "  <div style='font-size:11px;color:#ffb3b3;font-weight:600;letter-spacing:.5px'>HEALTH</div><div style='height:12px;background:rgba(0,0,0,.45);border-radius:6px;overflow:hidden;margin-bottom:5px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)'><div id='cHp' style='height:100%;width:100%;background:linear-gradient(90deg,#ff5b5b,#ff9e6b);transition:width .12s linear'></div></div>" +
      "  <div style='font-size:11px;color:#ffd9a8;font-weight:600;letter-spacing:.5px'>FOOD</div><div style='height:12px;background:rgba(0,0,0,.45);border-radius:6px;overflow:hidden;margin-bottom:5px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)'><div id='cFood' style='height:100%;width:100%;background:linear-gradient(90deg,#e8a23c,#ffd166)'></div></div>" +
      "  <div style='font-size:11px;color:#a8e0ff;font-weight:600;letter-spacing:.5px'>STAMINA</div><div style='height:8px;background:rgba(0,0,0,.45);border-radius:5px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)'><div id='cStam' style='height:100%;width:100%;background:linear-gradient(90deg,#39c0d0,#7fe0ff)'></div></div>" +
      "</div>" +
      "<div id='cWpn' class='cPanel' style='position:absolute;right:16px;bottom:16px;text-align:right;color:#e8eef7;font-size:15px;padding:6px 11px;display:none'></div>" +
      "<div id='cSpeed' style='position:absolute;right:16px;bottom:74px;text-align:right;color:#e8eef7;display:none'><span id='cSpeedN' style='font-size:30px;font-weight:700;text-shadow:0 2px 4px rgba(0,0,0,.6)'>0</span><span style='font-size:12px;color:#9fb0c6'> mph</span></div>" +
      "<div id='cJob' class='cPanel' style='position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center;color:#ffd166;font-size:14px;max-width:60%;padding:5px 14px;display:none'></div>" +
      "<canvas id='cRadar' width='190' height='190' style='position:absolute;left:14px;top:14px;border-radius:50%;box-shadow:0 4px 14px rgba(0,0,0,.45)'></canvas>" +
      "<div id='cFeed' style='position:absolute;left:212px;top:14px;width:300px'></div>" +
      "<div id='cTurf' style='position:absolute;left:16px;top:212px;font-size:13px;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,.7)'></div>" +
      "<div id='cHomeLine' style='position:absolute;left:16px;top:232px;font-size:12px;color:#9fb0c6;text-shadow:0 1px 2px rgba(0,0,0,.7)'></div>" +
      "<div id='cCross' style='position:absolute;left:50%;top:50%;width:7px;height:7px;margin:-4px 0 0 -4px;border:2px solid rgba(255,255,255,.85);border-radius:50%;display:none'></div>" +
      "</div>";
    document.body.appendChild(root);
    cashEl = root.querySelector("#cMoney"); deltaEl = root.querySelector("#cDelta");
    starsEl = root.querySelector("#cStars"); starsWrap = root.querySelector("#cStarsWrap");
    crewEl = root.querySelector("#cCrew"); worldEl = root.querySelector("#cWorld");
    hpBar = root.querySelector("#cHp"); hungerBar = root.querySelector("#cFood"); stamBar = root.querySelector("#cStam");
    wpnEl = root.querySelector("#cWpn"); jobEl = root.querySelector("#cJob");
    radar = root.querySelector("#cRadar"); turfEl = root.querySelector("#cTurf"); homeLineEl = root.querySelector("#cHomeLine");
    feedEl = root.querySelector("#cFeed"); speedEl = root.querySelector("#cSpeed");
  }

  // ---- the city event feed: a tidy stack of recent street events down the
  //      left, distinct from the engine's centre toast (flashToast). Other
  //      systems can push to it via CBZ.cityFeed(msg, color). Self-pruning. ----
  const feed = [];
  CBZ.cityFeed = function (msg, color) {
    if (!msg) return;
    feed.push({ msg: msg, color: color || "#7ed957", t: CBZ.now || 0, born: performance.now() });
    if (feed.length > 5) feed.shift();
    renderFeed();
  };
  function renderFeed() {
    if (!feedEl) return;
    let html = "";
    for (let i = 0; i < feed.length; i++) {
      const f = feed[i];
      html += "<div class='cFeedRow' style='border-left-color:" + f.color + "'>" + f.msg + "</div>";
    }
    feedEl.innerHTML = html;
  }
  let feedAcc = 0;
  function pruneFeed(dt) {
    feedAcc += dt;
    if (feedAcc < 0.25) return; feedAcc = 0;
    const nowMs = performance.now();
    let changed = false;
    while (feed.length && nowMs - feed[0].born > 6500) { feed.shift(); changed = true; }
    if (changed) renderFeed();
  }

  // ---- the city minimap: a north-up radar that clearly marks every building
  //      by what it is, plus cars/cops/crew and your objective. ----
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
    // circular dark backing + clip so blips never spill past the round frame
    ctx.save();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 1, 0, 6.28); ctx.closePath();
    ctx.fillStyle = "rgba(10,12,18,.55)"; ctx.fill();
    ctx.clip();
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
    // cars (white). Your OWNED / driven car gets a green house-style blip so you
    // can always find your ride — a core GTA convenience.
    for (const c of CBZ.cityCars) {
      if (c.dead) continue;
      const dx = c.pos.x - px, dz = c.pos.z - pz; if (dx * dx + dz * dz > R * R) continue;
      if (c.owned || c.player) {
        ctx.fillStyle = "#7ed957"; const x = toX(c.pos.x), y = toY(c.pos.z);
        ctx.beginPath(); ctx.arc(x, y, 3.4, 0, 6.28); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 1; ctx.stroke();
      } else { ctx.fillStyle = "rgba(235,238,245,.7)"; ctx.fillRect(toX(c.pos.x) - 1.5, toY(c.pos.z) - 1.5, 3, 3); }
    }
    // your crew / gang members (your colour) so you can read your posse on the map
    if (CBZ.cityPeds) {
      ctx.fillStyle = "#ffd451";
      for (const pd of CBZ.cityPeds) {
        if (pd.dead || !(pd.companion || pd.gang === "player")) continue;
        const dx = pd.pos.x - px, dz = pd.pos.z - pz; if (dx * dx + dz * dz > R * R) continue;
        ctx.beginPath(); ctx.arc(toX(pd.pos.x), toY(pd.pos.z), 2.3, 0, 6.28); ctx.fill();
      }
    }
    // cops (cyan) with a short heading tick so you can read which way they're facing
    ctx.fillStyle = "#5bd0ff"; ctx.strokeStyle = "#5bd0ff"; ctx.lineWidth = 1.4;
    for (const c of CBZ.cityCops) {
      if (c.dead) continue; const dx = c.pos.x - px, dz = c.pos.z - pz; if (dx * dx + dz * dz > R * R) continue;
      const x = toX(c.pos.x), y = toY(c.pos.z);
      ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 6.28); ctx.fill();
      const hd = (c.heading != null) ? c.heading : (c.dir != null ? c.dir : null);
      if (hd != null) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(hd) * 6, y + Math.cos(hd) * 6); ctx.stroke(); }
    }
    // objective beacon (pulsing so it reads as the thing to chase)
    const pulse = 0.5 + 0.5 * Math.sin((CBZ.now || 0) * 6);
    const j = CBZ.game.cityJob;
    if (j && j.dest) markStar(ctx, toX(j.dest.x), toY(j.dest.z), "#7ed957", 3.5 + pulse * 2);
    if (CBZ.game.cityPartner && CBZ.game.cityPartner.kidnapped) markStar(ctx, toX(CBZ.game.cityPartner.pos.x), toY(CBZ.game.cityPartner.pos.z), "#ff6bd0", 3.5 + pulse * 2);
    const wp = CBZ.fullMap && CBZ.fullMap.waypoint();
    if (wp && CBZ.fullMap.trace) CBZ.fullMap.trace(ctx, toX, toY);
    if (wp) ringMark(ctx, toX(wp.x), toY(wp.z), "#7de7ff", 4 + pulse * 2);
    ctx.restore();   // drop the circular clip before frame + compass
    // round frame + a north tick (compass) so the player can orient instantly
    ctx.strokeStyle = "rgba(255,255,255,.22)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 2, 0, 6.28); ctx.stroke();
    // north marker: north is -Z in world; rotate the tick by camera yaw is NOT
    // needed since the radar is north-up, so a fixed 'N' at top reads correctly.
    ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.font = "bold 11px Fredoka,sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#ff6b6b"; ctx.beginPath(); ctx.moveTo(W / 2, 6); ctx.lineTo(W / 2 - 4, 14); ctx.lineTo(W / 2 + 4, 14); ctx.closePath(); ctx.fill();
    // player arrow (centre), pointing along camera yaw
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, a = yaw + Math.PI;
    ctx.fillStyle = "#ffffff"; ctx.beginPath();
    ctx.moveTo(W / 2 + Math.sin(a) * 7, H / 2 + Math.cos(a) * 7);
    ctx.lineTo(W / 2 + Math.sin(a + 2.4) * 5.5, H / 2 + Math.cos(a + 2.4) * 5.5);
    ctx.lineTo(W / 2 + Math.sin(a - 2.4) * 5.5, H / 2 + Math.cos(a - 2.4) * 5.5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.lineWidth = 1; ctx.stroke();
  }
  function ringMark(ctx, x, y, col, r) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r || 5, 0, 6.28); ctx.stroke(); }
  function markStar(ctx, x, y, col, r) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r || 4, 0, 6.28); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1; ctx.stroke(); }

  CBZ.cityHudDirty = function () { dirty = true; };

  // money delta: flash a floating +$/-$ when cash changes, GTA-style
  let lastCash = null;
  function showMoney() {
    const c = g.cash || 0;
    cashEl.textContent = "$" + c.toLocaleString();
    if (lastCash != null && c !== lastCash && deltaEl) {
      const d = c - lastCash;
      deltaEl.textContent = (d > 0 ? "+$" : "-$") + Math.abs(d).toLocaleString();
      deltaEl.style.color = d > 0 ? "#7ed957" : "#ff6b6b";
      deltaEl.style.animation = "none"; void deltaEl.offsetWidth;   // restart
      deltaEl.style.animation = "cDeltaUp 1.1s ease-out forwards";
      cashEl.style.animation = "none"; void cashEl.offsetWidth;
      cashEl.style.animation = "cMoneyPulse .4s ease-out";
    }
    lastCash = c;
  }

  function renderText() {
    build();
    showMoney();
    // wanted meter — GTA convention: it only appears once you HAVE a level, and
    // flashes while heat is actively climbing (a manhunt) so it grabs the eye.
    const w = g.wanted | 0;
    if (w > 0) {
      starsWrap.style.display = "inline-block";
      let s = "";
      for (let i = 1; i <= 5; i++) s += i <= w ? "<span style='color:#ffd166;text-shadow:0 0 8px rgba(255,209,102,.6)'>★</span>" : "<span style='color:#4a4f57'>★</span>";
      starsEl.innerHTML = s;
      const hot = (g.heat || 0) > 0 && w >= (g._wantedPeak || 0);
      starsWrap.style.animation = hot ? "cStarFlash .7s steps(1,end) infinite" : "none";
    } else { starsWrap.style.display = "none"; starsWrap.style.animation = "none"; }
    const crew = g.cityCrew || 0, bank = g.cityBank || 0, resp = g.respect || 0;
    crewEl.innerHTML = (crew ? "<span style='color:#ffd451'>👥 " + crew + "</span>   " : "") +
      (resp ? "<span style='color:#c9a0ff'>★ " + Math.round(resp) + "</span>   " : "") +
      (bank ? "<span style='color:#7ed957'>🏦 $" + bank.toLocaleString() + "</span>" : "");
    if (worldEl) worldEl.textContent = CBZ.cityWorldSummary ? CBZ.cityWorldSummary() : "";
    // weapon
    // gun name from the ENGINE's current weapon (stays right after a Q/wheel
    // swap); melee items (Bat/Knife) have no engine id, so fall back to g.cityWeapon.
    const ENGINE_NAME = { sidearm: "Pistol", smg: "SMG", shotgun: "Shotgun", carbine: "Rifle", taser: "Taser", revolver: "Revolver", deagle: "Desert Eagle", ak47: "AK-47", uzi: "Uzi", sniper: "Sniper", lmg: "LMG" };
    const wn = (CBZ.currentWeaponId && (CBZ.hasAnyWeapon && CBZ.hasAnyWeapon())) ? ENGINE_NAME[CBZ.currentWeaponId] : g.cityWeapon;
    const armor = CBZ.player._armor || 0;
    let wpnHtml;
    if (wn) {
      const it = CBZ.cityEcon.ITEMS[wn];
      // guns show their ammo in the engine's own #ammo readout (fpsmode); here
      // we just name the equipped weapon + armor so the two HUDs don't disagree.
      wpnHtml = "<b>" + wn + "</b>" + (it && it.gun ? " <span style='color:#8a93a3;font-size:12px'>(ammo ↘)</span>" : "");
    } else wpnHtml = "<span style='color:#cdd6e2'>Fists</span>";
    if (armor > 0) wpnHtml += "<br><span style='color:#7fd0ff'>🛡 " + Math.round(armor) + "</span>";
    wpnEl.innerHTML = wpnHtml;
    wpnEl.style.display = "block";
    // job
    const j = g.cityJob;
    if (j) {
      let dist = "";
      if (j.dest) dist = "  ·  " + Math.round(Math.hypot(CBZ.player.pos.x - j.dest.x, CBZ.player.pos.z - j.dest.z)) + "m";
      else if ((j.type === "hit" || j.type === "hitman") && j.target && !j.target.dead) dist = "  ·  " + Math.round(Math.hypot(CBZ.player.pos.x - j.target.pos.x, CBZ.player.pos.z - j.target.pos.z)) + "m";
      jobEl.innerHTML = "🎯 " + j.desc + " <span style='color:#7ed957'>($" + j.reward + ")</span>" + (dist ? "<span style='color:#9fb0c6'>" + dist + "</span>" : "");
      jobEl.style.display = "block";
    } else jobEl.style.display = "none";
    dirty = false;
  }

  CBZ.onAlways(46, function () {
    build();
    const show = g.mode === "city";
    root.style.display = show ? "block" : "none";
    document.body.classList.toggle("mode-city", show);
    if (!show) return;
    // track the wanted peak so the flashing only fires while it's RISING/held
    const w = g.wanted | 0;
    if (w > (g._wantedPeak || 0)) g._wantedPeak = w; else if (w === 0) g._wantedPeak = 0;
    if (dirty) renderText();
    // bars + live job distance update every frame (cheap)
    const P = CBZ.player, maxHp = P.maxHp || 100;
    hpBar.style.width = Math.max(0, Math.min(100, (P.hp / maxHp) * 100)) + "%";
    hungerBar.style.width = Math.max(0, Math.min(100, g.hunger || 0)) + "%";
    stamBar.style.width = Math.max(0, Math.min(100, (P.stamina == null ? 100 : P.stamina))) + "%";
    if (g.cityJob && (g.cityJob.dest || g.cityJob.type === "hit")) renderText();
    pruneFeed(1 / 60);
    // speedometer when driving (the engine ammo readout sits elsewhere)
    if (speedEl) {
      const car = P.driving && P._vehicle;
      if (car && car.pos) {
        const mph = Math.round(Math.abs(car.v || 0) * 3);   // world units/s → rough mph (top coupe ~50u/s ≈ 150)
        speedEl.style.display = "block";
        const sn = speedEl.querySelector("#cSpeedN");
        if (sn) { sn.textContent = mph; sn.style.color = mph > 100 ? "#ff9e6b" : "#e8eef7"; }
      } else speedEl.style.display = "none";
    }
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
