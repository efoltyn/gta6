/* ============================================================
   city/hud.js — the CITY heads-up display, after the 2026-09-27 HUD PURGE.

   OWNER: "Every HUD, the many overlapping tabs, everything should be
   considered for removal ... pills that mean nothing. SHOW DON'T TELL."
   Default is REMOVE; what survives earns its place by being needed at that
   moment, and it leaves again when it is not.

   WHAT IS ON SCREEN, AND WHEN
     • MINIMAP (#cRadar), bottom-left, 132px. Heading-up; streets, turf wash,
       your car, crew, threats, cops, waypoint, mission, chopper. No labels,
       no POI pictograms, no star row. The heat ring on its rim is the only
       wanted read it carries.
     • CASH (#cMoney + floating delta), top-right, INVISIBLE at rest. It
       appears when the number changes, holds ~3 s, fades.
     • WANTED (#cHeat): no stars, no pill. A slow red/blue siren wash on the
       screen edges while wanted > 0, stronger per level. The rest is the
       world: sirens, cruisers, the chopper, the roadblock.
     • HEALTH (#cHurt): no bar, no hearts. A red screen-edge that deepens as
       HP drops and pulses when it is low; the engine's #hitfx flash marks
       each hit.
     • WEAPON (#cWpn): the ammo count shows ONLY while a gun is the thing in
       your hands. The slot bar surfaces for ~2.5 s when the loadout changes
       (you switched, holstered, picked up, ate), then fades. On touch it
       stays up, because there it is the input.
     • NEXT STEP (#cObj): shows when a NEW objective line arrives, ~6 s, fades.
     • RETICLE (#cCross): only with a gun out on foot when fpsmode is not
       already drawing one.

   GONE: the stars pill, crew count, level line, population pill, turf pay,
   kill feed, event feed, gang badge, relationship chip, melee posture bars,
   hearts/food/armor/stamina rows, the carried-loot row, the fallback
   speedometer (carcluster.js owns the car), the job distance pill (the
   waypoint guide already says it), the ROUTE chip and progress sliver.

   PUBLIC API kept for the ~80 callers: CBZ.cityHudDirty, CBZ.cityFeed,
   CBZ.cityFlavor (both route to the phone, never to the screen),
   CBZ.weaponSlotsHTML + CBZ.weaponStripAudit (shared with the prison).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  let root, hudEl, cashEl, deltaEl, wpnEl, slotsEl, ammoLineEl, objEl, radar, crossEl, heatEl, hurtEl;
  let dirty = true;

  function esc(s) { return String(s).replace(/[<>&]/g, function (c) { return c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"; }); }
  function nowMs() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }
  function isTouch() { return !!(CBZ.touchMode || (document.body && document.body.classList.contains("touch"))); }

  function build() {
    if (root) return;
    if (!document.getElementById("cHudCss")) {
      const st = document.createElement("style");
      st.id = "cHudCss";
      st.textContent =
        "#cityHud{--hud-pad:14px;--hud-pad-t:calc(var(--hud-pad) + env(safe-area-inset-top,0px));--hud-pad-r:calc(var(--hud-pad) + env(safe-area-inset-right,0px));--hud-pad-b:calc(var(--hud-pad) + env(safe-area-inset-bottom,0px));--hud-pad-l:calc(var(--hud-pad) + env(safe-area-inset-left,0px));--panel-bg:rgba(8,11,17,.5);--radius:9px;--hud-ink:#e8ecf2;--hud-dim:#9fb0c6;--hud-accent:#7de7ff;--money:#7ed957}" +
        "#cHud{font-variant-numeric:tabular-nums}" +
        // every surviving element rests INVISIBLE and is lifted by .on
        "#cHud .fade{opacity:0;transition:opacity .8s ease;pointer-events:none}" +
        "#cHud .fade.on{opacity:.9;transition:opacity .15s ease}" +
        "#cMoney{font-size:26px;font-weight:700;color:var(--money);text-shadow:0 2px 0 #1f5a2a,0 0 12px rgba(0,0,0,.45)}" +
        "#cDelta{position:absolute;right:0;top:-18px;font-size:16px;font-weight:700;opacity:0;pointer-events:none;white-space:nowrap}" +
        "@keyframes cDeltaUp{0%{opacity:0;transform:translateY(6px)}18%{opacity:1}100%{opacity:0;transform:translateY(-14px)}}" +
        "#cObj{position:absolute;top:var(--hud-pad-t);left:50%;transform:translateX(-50%);max-width:56%;text-align:center;color:var(--hud-ink);font-size:15px;font-weight:600;text-shadow:0 1px 4px rgba(0,0,0,.85)}" +
        // bottom-centre weapon cluster: slots over the ammo count
        "#cWpn{position:absolute;left:50%;bottom:var(--hud-pad-b);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:5px}" +
        "#cHud .cSlots{display:flex;gap:4px;justify-content:center;flex-wrap:wrap;max-width:520px}" +
        "#cHud .cSlots.fade.on{pointer-events:auto}" +
        "body.touch #cHud .cSlots.fade{opacity:.8;pointer-events:auto}" +
        "#cHud .cSlot{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;width:40px;height:40px;box-sizing:border-box;padding:2px;border-radius:6px;background:rgba(8,11,17,.55);border:1px solid rgba(232,236,242,.12);pointer-events:inherit;cursor:pointer}" +
        "#cHud .cSlot.held{border-color:rgba(232,236,242,.85);box-shadow:0 0 0 1px rgba(232,236,242,.4)}" +
        "#cHud .cSlot .key{display:none}" +
        "#cHud .cSlot>.ic{font-size:17px;line-height:1;color:var(--hud-ink)}" +
        "#cHud .cSlot .ic.gun{font-size:18px;transform:scaleX(1.25)}" +
        "#cHud .cSlot .gunModel{display:block;width:36px;height:24px;object-fit:contain;pointer-events:none;filter:drop-shadow(0 2px 2px rgba(0,0,0,.8))}" +
        "#cHud .cSlot .itemIcn{width:26px;height:26px}" +
        "#cHud .cSlot .a{font-size:9px;color:var(--hud-dim);line-height:1}" +
        "#cHud .cSlot .a.dry{color:#ff7a6a;font-weight:700}" +
        "#cHud .cSlot .cnt{position:absolute;right:2px;bottom:1px;font-size:9px;font-weight:700;color:var(--hud-ink);text-shadow:1px 1px 0 #000}" +
        "#cHud .cSlot .led{position:absolute;right:3px;top:3px;width:6px;height:6px;border-radius:50%;background:transparent}" +
        "#cHud .cSlot.unread .led{background:#ff6258;box-shadow:0 0 8px #ff6258}" +
        "#cHud .cSlot.buzz{animation:cPhoneBuzz .82s ease}" +
        "@keyframes cPhoneBuzz{0%,100%{transform:translateY(0) rotate(0)}18%{transform:translateY(-4px) rotate(-5deg)}38%{transform:translateY(-2px) rotate(5deg)}58%{transform:translateY(-1px) rotate(-3deg)}}" +
        "#cAmmo{font-size:13px;color:var(--hud-ink);font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.8);opacity:.9;min-height:1px}" +
        "#cAmmo b{font-size:20px;font-weight:700}" +
        "#cAmmo .res{color:var(--hud-dim)}" +
        "#cAmmo .rl{color:#ffd166}" +
        "#cRadar{position:absolute;left:var(--hud-pad-l);bottom:var(--hud-pad-b);width:132px;height:132px;border-radius:50%;opacity:.9;box-shadow:0 4px 14px rgba(0,0,0,.45)}" +
        "@media (max-width:900px),(max-height:560px){#cRadar{width:108px;height:108px}#cMoney{font-size:21px}#cHud .cSlot{width:34px;height:34px}#cHud .cSlot .gunModel{width:30px;height:20px}#cHud .cSlot .itemIcn{width:22px;height:22px}}" +
        // SCREEN-EDGE SIGNALS. Outside #cHud on purpose: the campaign's
        // declutter (css/campaign.css) hides #cHud's children wholesale, and a
        // wound or a manhunt is not narration.
        "#cHurt,#cHeat{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .5s ease}" +
        "#cHurt{background:radial-gradient(ellipse at center,rgba(150,0,0,0) 60%,rgba(150,0,0,.6) 100%)}" +
        "#cHurt.low{animation:cHurtBeat 1.1s ease-in-out infinite}" +
        "@keyframes cHurtBeat{0%,100%{filter:brightness(1)}45%{filter:brightness(1.6)}}" +
        "#cHeat{box-shadow:inset 0 0 90px 10px rgba(255,40,40,.5)}" +
        "#cHeat.on{animation:cSiren 1.6s linear infinite}" +
        "@keyframes cSiren{0%,100%{box-shadow:inset 0 0 90px 10px rgba(255,40,40,.5)}50%{box-shadow:inset 0 0 90px 10px rgba(40,90,255,.5)}}" +
        "@media (prefers-reduced-motion:reduce){#cHeat.on,#cHurt.low{animation:none}}";
      document.head.appendChild(st);
    }
    // shared item-pictogram sizing (city/itemicons.js), so hotbar item chips
    // are sized whether or not the [I] grid ever opened.
    if (CBZ.itemIconCss) { try { CBZ.itemIconCss(); } catch (e) {} }
    root = document.createElement("div");
    root.id = "cityHud";
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:20;display:none;font-family:Fredoka,system-ui,sans-serif";
    root.innerHTML =
      "<div id='cHurt'></div>" +
      "<div id='cHeat'></div>" +
      "<div id='cHud' style='position:absolute;inset:0'>" +
      // #cTopRight keeps its name: css/mobile.css + css/campaign.css key off it
      "<div id='cTopRight' style='position:absolute;top:var(--hud-pad-t);right:var(--hud-pad-r);text-align:right'>" +
      "  <div class='fade' id='cCash' style='position:relative;display:inline-block'><div id='cMoney'>$0</div><div id='cDelta'></div></div>" +
      "</div>" +
      "<div id='cObj' class='fade'></div>" +
      "<div id='cWpn'><div id='cSlots' class='cSlots fade'></div><div id='cAmmo'></div></div>" +
      "<canvas id='cRadar' width='190' height='190'></canvas>" +
      "<div id='cCross' style='position:absolute;left:50%;top:50%;width:7px;height:7px;margin:-4px 0 0 -4px;border:2px solid rgba(232,236,242,.85);border-radius:50%;display:none'></div>" +
      "</div>";
    document.body.appendChild(root);
    hudEl = root.querySelector("#cHud");
    cashEl = root.querySelector("#cMoney"); deltaEl = root.querySelector("#cDelta");
    wpnEl = root.querySelector("#cWpn");
    slotsEl = root.querySelector("#cSlots"); ammoLineEl = root.querySelector("#cAmmo");
    objEl = root.querySelector("#cObj");
    radar = root.querySelector("#cRadar");
    crossEl = root.querySelector("#cCross");
    heatEl = root.querySelector("#cHeat"); hurtEl = root.querySelector("#cHurt");
    // CLICK/TAP-TO-SELECT on the hotbar. Chips carry data-bi (the bar index); a
    // tap routes to CBZ.cityHotbarSelect (holster / gun-select / item-use / phone).
    slotsEl.addEventListener("click", function (ev) {
      const chip = ev.target && ev.target.closest ? ev.target.closest(".cSlot[data-bi],.cSlot[data-inv]") : null;
      if (!chip) return;
      if (g.mode !== "city" || g.state !== "playing") return;
      if (CBZ.cityMenuOpen || (CBZ.fullMap && CBZ.fullMap.active)) return;
      if (chip.hasAttribute("data-inv")) { if (CBZ.cityCharPanel && CBZ.cityCharPanel.open) CBZ.cityCharPanel.open(); return; }
      const bi = parseInt(chip.getAttribute("data-bi"), 10);
      if (bi >= 0 && CBZ.cityHotbarSelect) { CBZ.cityHotbarSelect(bi); dirty = true; }
    });
  }

  // ---- reveal-then-fade: an element lifts to .on and drops back after holdMs
  function reveal(el, holdMs) {
    if (!el) return;
    el.classList.add("on");
    if (el._fadeT) clearTimeout(el._fadeT);
    el._fadeT = setTimeout(function () { el.classList.remove("on"); el._fadeT = 0; }, holdMs);
  }

  // ---- the event feed is not a screen surface any more. CBZ.cityFeed and
  //      CBZ.cityFlavor stay as the callers' API and deliver to the phone. ----
  function feedBase(msg) { return String(msg).replace(/ \(x\d+\)$/, ""); }
  CBZ.cityFeed = function (msg, color, opts) {
    if (!msg) return;
    if (opts && opts.collapseOnly) return;
    if (typeof CBZ.cityPhoneWorthy === "function" && !CBZ.cityPhoneWorthy(msg, opts, false)) return;
    const payload = {
      app: (opts && opts.app) || "news",
      from: (opts && opts.from) || "City Desk",
      text: feedBase(msg),
    };
    if (typeof CBZ.cityPhoneNotify === "function") CBZ.cityPhoneNotify(payload);
    else if (CBZ.cityCampaignActive && CBZ.cityCampaignActive() && typeof CBZ.phoneNotify === "function") CBZ.phoneNotify(payload);
  };
  // world-FLAVOR lines (lore/ambience): off unless CBZ.CONFIG.CITY_FLAVOR_FEED.
  CBZ.cityFlavor = function (msg, color) {
    if (CBZ.CONFIG && CBZ.CONFIG.CITY_FLAVOR_FEED) CBZ.cityFeed(msg, color);
  };

  // ============================================================
  //  MINIMAP — heading-up round instrument, bottom-left. Icons only, never
  //  text (the N pip excepted). Threats clamp to the rim so danger off-map
  //  still shows a bearing. The strategic detail lives on the [M] map.
  // ============================================================
  let radarAcc = 0;
  // smoothed view radius (world units): tight on foot, wider at driving speed.
  let viewR = 100;
  function hex6n(c) { return "#" + ("000000" + ((c >>> 0) & 0xffffff).toString(16)).slice(-6); }
  // district ground tints — a faint per-quadrant personality wash (desaturated;
  // saturated colour stays reserved for territory + threats)
  const DIST_TINT = { core: "#39404d", commercial: "#383f48", residential: "#3a443d", projects: "#454039", industrial: "#413d43" };
  function drawRadar() {
    if (!radar) return;
    const ctx = radar.getContext("2d"); if (!ctx) return;
    const P = CBZ.player;
    const A = CBZ.city && CBZ.city.arena; if (!A) return;
    // ZOOM FEEL: on foot you care about the block (tight); in a car you care
    // about the next turns, more so the faster you go. Lerped at the radar's own
    // 14Hz so the scale change reads as a gentle breathe, never a snap.
    const car = P.driving && P._vehicle;
    const spd = (car && Math.abs(car.v || 0)) || 0;
    const targetR = car ? Math.min(190, 130 + spd) : 96;
    viewR += (targetR - viewR) * 0.16;
    const R = viewR;
    const W = radar.width, H = radar.height;
    const sc = (W / 2) / R, cx = W / 2, cy = H / 2;
    const px = P.pos.x, pz = P.pos.z;
    const g = CBZ.game, now = CBZ.now || 0;
    // wanted stars through the public accessor when present (guard-called — the
    // wanted system owns it); falls back to game.wanted. MAP_V2 default-on.
    let wanted = (g && g.wanted) || 0;
    try { if (CBZ.cityStars) wanted = CBZ.cityStars() | 0; } catch (e) {}
    const pulse = 0.5 + 0.5 * Math.sin(now * 6);
    // heading-up rotation: rotMap === camera yaw makes the player's forward
    // point to screen-up (derivation in commit msg). Blips rotate as POINTS in
    // JS (not the canvas) so every icon/label stays upright while the map turns;
    // the geometric base below uses a rotated CONTEXT instead (see note there).
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
    const cosR = Math.cos(yaw), sinR = Math.sin(yaw);
    const _p = [0, 0];
    function S(wx, wz, out) {
      const dx = (wx - px) * sc, dy = (wz - pz) * sc;
      out = out || _p; out[0] = cx + dx * cosR - dy * sinR; out[1] = cy + dx * sinR + dy * cosR; return out;
    }
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 1, 0, 6.28); ctx.closePath();
    // SEA base — anything past the seawall reads as water, distinctly cool
    ctx.fillStyle = "#142b38"; ctx.fill();
    ctx.clip();

    // territory ownership (crew wash over the blocks) — the only "colour =
    // meaning" on the base layer, so you sense whose turf you're standing in
    const owner = new Map();
    if (CBZ.cityGangs) for (const gg of CBZ.cityGangs) {
      if (!gg || !gg.turf) continue; const oc = gg.isPlayer ? 0xffd451 : gg.color;
      for (const lot of gg.turf) owner.set(lot, oc);
    }
    // the RACKET wash (city/racket.js, feature-detected): storefronts paying
    // protection carry their crew's colour too, so the radar reads the whole
    // territory war — blocks AND the businesses on them.
    if (CBZ.cityRacketOwnerFill) CBZ.cityRacketOwnerFill(owner);
    const R2 = (R + 26) * (R + 26);
    const DQ = A.districts || [];

    // ---- GEOMETRIC BASE in a ROTATED CONTEXT: land/roads/blocks are axis-
    //      aligned world rects, so spinning the canvas keeps each one a single
    //      crisp fillRect/stroke. restore() before the blip layer so icons and
    //      the N label stay upright (the heading-up contract holds).
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(yaw);
    const u = (wx) => (wx - px) * sc, v = (wz) => (wz - pz) * sc;
    // land mass out to the seawall apron — terrain under the streets
    const SH = A.shore || { EW: A.minX - 26, EE: A.maxX + 26, ES: A.minZ - 26, EN: A.maxZ + 26 };
    ctx.fillStyle = "#272d35";
    ctx.fillRect(u(SH.EW), v(SH.ES), (SH.EE - SH.EW) * sc, (SH.EN - SH.ES) * sc);
    // the south beach gap: a thin sand strip straddling the seawall line
    if (SH.beach) { ctx.fillStyle = "rgba(199,178,124,.45)"; ctx.fillRect(u(SH.beach.x0), v(SH.ES - 10), (SH.beach.x1 - SH.beach.x0) * sc, 13 * sc); }
    // ---- NEIGHBOURING ISLANDS / BIOMES: the radar shouldn't end at the city's
    //      seawall — when you stand near the desert/forest/snow causeway you
    //      should SEE that land coming up. Each registered region paints as land
    //      + a sand coastline (distance-culled to ≤~12 nearby rects at 14Hz).
    const REGIONS = A.regions || [];
    if (REGIONS.length) {
      const palFn = (CBZ.fullMap && CBZ.fullMap.biomePal) || null;
      const FALLBACK = { desert: { fill: "#5a4f37" }, forest: { fill: "#2f4030" }, snow: { fill: "#5a6470" }, farmland: { fill: "#4a4a2e" }, speedway: { fill: "#403a44" }, airport: { fill: "#34373d" }, military: { fill: "#3a3f34" }, commerce: { fill: "#3a4636" }, _default: { fill: "#272d35" } };
      const palOf = (b) => (palFn ? palFn(b) : (FALLBACK[b] || FALLBACK._default));
      const isLinkR = (rg) => /causeway|bridge/i.test(rg.name || "") || (rg.pad != null && rg.pad <= 1);
      const cullR = R + 30;
      const inReg = CBZ.cityBiomeAt ? CBZ.cityBiomeAt(px, pz) : "city";
      const drawReg = (rg) => {
        if (isLinkR(rg)) { ctx.fillStyle = "rgba(170,150,110,.7)"; }
        else { ctx.fillStyle = palOf(rg.biome).fill; }
        if (rg.kind === "circle") {
          ctx.beginPath(); ctx.arc(u(rg.cx), v(rg.cz), rg.r * sc, 0, 6.28); ctx.fill();
          if (!isLinkR(rg)) { ctx.strokeStyle = "rgba(199,178,124,.5)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(u(rg.cx), v(rg.cz), rg.r * sc, 0, 6.28); ctx.stroke(); }
        } else {
          ctx.fillRect(u(rg.minX), v(rg.minZ), (rg.maxX - rg.minX) * sc, (rg.maxZ - rg.minZ) * sc);
          if (!isLinkR(rg)) { ctx.strokeStyle = "rgba(199,178,124,.5)"; ctx.lineWidth = 2; ctx.strokeRect(u(rg.minX), v(rg.minZ), (rg.maxX - rg.minX) * sc, (rg.maxZ - rg.minZ) * sc); }
        }
      };
      let here = null;
      for (let ri = 0; ri < REGIONS.length; ri++) {
        const rg = REGIONS[ri];
        const cxr = rg.kind === "circle" ? rg.cx : (rg.minX + rg.maxX) * 0.5;
        const czr = rg.kind === "circle" ? rg.cz : (rg.minZ + rg.maxZ) * 0.5;
        const half = rg.kind === "circle" ? rg.r : Math.max(rg.maxX - rg.minX, rg.maxZ - rg.minZ) * 0.5;
        const ddx = cxr - px, ddz = czr - pz;
        if (ddx * ddx + ddz * ddz > (cullR + half) * (cullR + half)) continue;
        // the region the player is INSIDE draws LAST so its tint wins at centre
        if (!isLinkR(rg) && rg.biome === inReg && inReg !== "city" && CBZ.cityRegionHit && CBZ.cityRegionHit(rg, px, pz, 0)) { here = rg; continue; }
        drawReg(rg);
      }
      if (here) drawReg(here);
    }
    function paintLots(list) {
      if (!list) return;
      for (const lot of list) {
        if (!lot) continue; const ddx = lot.cx - px, ddz = lot.cz - pz; if (ddx * ddx + ddz * ddz > R2) continue;
        const s = Math.max(3, (lot.w || 20) * sc), x = u(lot.cx), y = v(lot.cz);
        // faint district wash across the whole block pad…
        const dq = DQ[lot.district];
        const dk = dq && DIST_TINT[dq.kind];
        if (dk) { ctx.fillStyle = dk; ctx.globalAlpha = 0.55; ctx.fillRect(x - s / 2, y - s / 2, s, s); }
        // …a soft dark building mass inset on it…
        ctx.fillStyle = "#151a20"; ctx.globalAlpha = 0.8;
        const b = s * 0.74; ctx.fillRect(x - b / 2, y - b / 2, b, b);
        // …then the crew wash on top
        const oc = owner.get(lot);
        if (oc != null) { ctx.fillStyle = hex6n(oc); ctx.globalAlpha = oc === 0xffd451 ? 0.45 : 0.3; ctx.fillRect(x - s / 2, y - s / 2, s, s); }
      }
      ctx.globalAlpha = 1;
    }
    // ROADS read as STREETS: a dark casing pass then a light fill pass (the
    // classic GTA-map treatment); both passes batch every line in one stroke.
    function roadPass(col, w) {
      ctx.strokeStyle = col; ctx.lineWidth = w;
      ctx.beginPath();
      const e = (R + 30) * sc;
      for (const x of A.xLines) { ctx.moveTo(u(x), -e); ctx.lineTo(u(x), e); }
      for (const z of A.zLines) { ctx.moveTo(-e, v(z)); ctx.lineTo(e, v(z)); }
      ctx.stroke();
    }
    const roadW = Math.max(1.5, A.ROAD * sc * 0.85);
    roadPass("rgba(8,11,15,.65)", roadW + 2.5);
    roadPass("rgba(168,178,192,.42)", roadW);
    paintLots(A.lots);
    // island: sand-ringed land disc + its streets + the bridge (the chokepoint)
    if (A.annex) {
      const X = A.annex, xr = X.radius * sc;
      ctx.fillStyle = "#272d35"; ctx.beginPath(); ctx.arc(u(X.cx), v(X.cz), xr, 0, 6.28); ctx.fill();
      ctx.strokeStyle = "rgba(199,178,124,.55)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(u(X.cx), v(X.cz), xr, 0, 6.28); ctx.stroke();
      ctx.strokeStyle = "rgba(168,178,192,.38)"; ctx.lineWidth = Math.max(1, 5 * sc);
      ctx.beginPath();
      for (const r of X.roads) {
        if (r.vertical) { ctx.moveTo(u(r.x), v(r.z - r.len / 2)); ctx.lineTo(u(r.x), v(r.z + r.len / 2)); }
        else { ctx.moveTo(u(r.x - r.len / 2), v(r.z)); ctx.lineTo(u(r.x + r.len / 2), v(r.z)); }
      }
      ctx.stroke();
      paintLots(X.lots);
      if (A.bridge) {
        const bz = (A.bridge.minZ + A.bridge.maxZ) / 2;
        ctx.strokeStyle = wanted >= 3 ? "rgba(255,90,90,.85)" : "rgba(190,198,210,.6)"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(u(A.bridge.minX), v(bz)); ctx.lineTo(u(A.bridge.maxX), v(bz)); ctx.stroke();
      }
    }
    ctx.restore();   // drop rotation — blips/labels draw upright from here

    // soft vignette: the rim darkens so the centre (you) carries the eye — the
    // RDR2 aged-instrument read in our palette. Under the blip layers so threats
    // stay bright at the edge.
    const vg = ctx.createRadialGradient(cx, cy, W * 0.30, cx, cy, W / 2);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.45)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    // a blip helper that clamps off-map targets to the rim (so danger off-screen
    // still shows a bearing). draw(x,y,onRim) does the icon.
    const RIM = W / 2 - 7;
    function blip(wx, wz, draw, edge) {
      S(wx, wz); let x = _p[0] - cx, y = _p[1] - cy; const d = Math.hypot(x, y);
      if (d > RIM) { if (!edge) return; const k = RIM / d; draw(cx + x * k, cy + y * k, true); }
      else draw(cx + x, cy + y, false);
    }
    function dot(x, y, col, r) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1; ctx.stroke(); }
    function tri(x, y, col, r) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.9, y + r * 0.7); ctx.lineTo(x - r * 0.9, y + r * 0.7); ctx.closePath(); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.lineWidth = 1; ctx.stroke(); }
    function diamond(x, y, col, r) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.lineWidth = 1; ctx.stroke(); }

    // (POI pictograms, casinos/banks/hospital/guns/gas, were cut in the
    //  2026-09-27 HUD purge: "what's around me" is the street itself and the
    //  [M] map. The radar keeps only what moves or threatens.)
    const MI = CBZ.mapIcon;
    // ---- YOUR LAND (city/plots.js): every lot you own is a home pin on the
    //      radar, pinned to the rim when it is out of range so you can always
    //      drive back to the compound. ----
    if (CBZ.cityPlots && CBZ.cityPlots.list) {
      let own = []; try { own = CBZ.cityPlots.list(); } catch (e) { own = []; }
      for (const pl of own) {
        blip(pl.center.x, pl.center.z, function (x, y, rim) {
          if (MI) MI.draw(ctx, x, y, "home", { size: rim ? 4.5 : 6, tier: !rim });
          else diamond(x, y, "#39ff88", rim ? 2.6 : 3.6);
        }, true);
      }
    }

    // ---- crew HQ stars (rivals) — quiet anchors, only when near ----
    if (CBZ.cityGangs) for (const gang of CBZ.cityGangs) {
      if (!gang || gang.isPlayer || gang.absorbed) continue;
      const hq = CBZ.cityGangHQ ? CBZ.cityGangHQ(gang.id) : (gang.center && (gang.center.x || gang.center.z) ? gang.center : null);
      if (hq && (hq.x || hq.z)) {
        const dx = hq.x - px, dz = hq.z - pz;
        if (dx * dx + dz * dz <= R * R) {
          S(hq.x, hq.z);
          if (MI) MI.draw(ctx, _p[0], _p[1], "hq", { size: 5, color: hex6n(gang.color) });
          else diamond(_p[0], _p[1], hex6n(gang.color), 3.4);
        }
      }
    }

    // ---- cars: your ride is a bright green chevron (always findable); traffic faint ----
    for (const c of CBZ.cityCars) {
      if (c.dead) continue; const dx = c.pos.x - px, dz = c.pos.z - pz; if (dx * dx + dz * dz > R * R) continue;
      S(c.pos.x, c.pos.z);
      if (c.owned || c.player) dot(_p[0], _p[1], "#7ed957", 3.2);
      else { ctx.fillStyle = "rgba(210,216,226,.55)"; ctx.fillRect(_p[0] - 1.3, _p[1] - 1.3, 2.6, 2.6); }
    }

    // ---- THREAT + ALLY LAYER (bright, drawn on top) ----
    // crew / companions (green) — your posse
    if (CBZ.cityPeds) for (const pd of CBZ.cityPeds) {
      if (pd.dead || !(pd.companion || pd.gang === "player")) continue;
      const dx = pd.pos.x - px, dz = pd.pos.z - pz; if (dx * dx + dz * dz > R * R) continue;
      S(pd.pos.x, pd.pos.z); dot(_p[0], _p[1], "#5ad17a", 2.4);
    }
    // Threats are red only while their LIVE brain targets the player. Merely
    // carrying a gun or wearing gang colours is not the same thing as attacking.
    if (CBZ.cityPeds) for (const pd of CBZ.cityPeds) {
      if (pd.dead || pd.gang === "player" || pd.companion) continue;
      const dx = pd.pos.x - px, dz = pd.pos.z - pz; const d2 = dx * dx + dz * dz; if (d2 > R2) continue;
      if (pd.isBoss || pd.rank === "boss") { blip(pd.pos.x, pd.pos.z, (x, y) => diamond(x, y, "#ffd451", 4 + pulse), true); continue; }
      if (CBZ.cityTargetsPlayer && CBZ.cityTargetsPlayer(pd)) { blip(pd.pos.x, pd.pos.z, (x, y) => tri(x, y, "#ff3b35", 4), true); continue; }
    }
    // Cops turn red only once that specific officer is assigned to you; idle
    // beat cops stay cyan even while another unit owns the chase.
    for (const c of CBZ.cityCops) {
      if (c.dead) continue; const hot = !!(CBZ.cityTargetsPlayer && CBZ.cityTargetsPlayer(c));
      const col = hot ? "#ff3b35" : "#5bd0ff";
      blip(c.pos.x, c.pos.z, (x, y, rim) => { dot(x, y, col, hot ? (rim ? 3.0 : 2.8) : 2.2); }, hot);
    }
    // Predators/charging herd animals use the exact same red threat language.
    for (const a of CBZ.cityWildlife || []) {
      if (!a || a.dead || !(CBZ.cityTargetsPlayer && CBZ.cityTargetsPlayer(a))) continue;
      blip(a.pos.x, a.pos.z, (x, y, rim) => { dot(x, y, "#ff3b35", rim ? 3.0 : 2.7); }, true);
    }

    // ---- objective + waypoint ----
    const wp = CBZ.fullMap && CBZ.fullMap.waypoint && CBZ.fullMap.waypoint();
    // waypoint reads as the loudest mark on the map: pulsing accent ring + dot
    if (wp) { blip(wp.x, wp.z, (x, y) => { ctx.strokeStyle = "#7de7ff"; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(x, y, 4.5 + pulse * 2, 0, 6.28); ctx.stroke(); ctx.fillStyle = "#7de7ff"; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, 6.28); ctx.fill(); }, true); }
    const j = g && g.cityJob;
    // the objective blip is the SAME mission pictogram the [M] map draws, so
    // "the thing on my radar" and "the thing on my map" are one symbol
    if (j && j.dest) blip(j.dest.x, j.dest.z, (x, y) => {
      if (MI) MI.draw(ctx, x, y, "mission", { size: 6 + pulse });
      else diamond(x, y, "#7ed957", 4 + pulse * 2);
    }, true);
    if (g && g.cityPartner && g.cityPartner.kidnapped && g.cityPartner.pos) blip(g.cityPartner.pos.x, g.cityPartner.pos.z, (x, y) => diamond(x, y, "#ff6bd0", 4 + pulse * 2), true);

    // ---- POLICE CHOPPER: at 3★+ it hunts you. Always rim-clamped with a bearing
    //      so you know to get under cover. WHY this is here: it answers "why a
    //      helipad" and visualises the air tier of the wanted ladder. ----
    if (wanted >= 3 && CBZ.cityChopperPos) {
      const hp = CBZ.cityChopperPos();
      if (hp) blip(hp.x, hp.z, (x, y) => { drawChopper(ctx, x, y, now); }, true);
    }

    ctx.restore();   // drop circular clip

    // ---- HEAT RING: the wanted level made visible as a closing red glow on the
    //      rim. Brighter + faster pulse as stars climb; molten at 5★. ----
    if (wanted > 0) {
      const heat = wanted / 5;
      const a = (0.16 + heat * 0.5) * (0.7 + 0.3 * pulse);
      const grad = ctx.createRadialGradient(cx, cy, W * 0.18, cx, cy, W / 2);
      grad.addColorStop(0, "rgba(255,40,30,0)");
      grad.addColorStop(1, "rgba(255," + Math.round(60 - heat * 50) + ",30," + a.toFixed(3) + ")");
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 1, 0, 6.28); ctx.clip();
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H); ctx.restore();
    }

    // round frame — dark instrument bezel + a hairline accent ring (RDR2's aged
    // brass ring, translated into the HUD's cyan-not-sepia design language)
    ctx.strokeStyle = wanted >= 4 ? "rgba(255,70,55,.75)" : "rgba(10,13,18,.85)"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 2, 0, 6.28); ctx.stroke();
    ctx.strokeStyle = wanted >= 4 ? "rgba(255,120,100,.5)" : "rgba(125,231,255,.22)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 4.5, 0, 6.28); ctx.stroke();
    // NORTH pip — rotates with the heading-up map so it always points true north.
    // North is world -Z; through S that direction sits at (sinR, -cosR) from centre.
    const nx = cx + Math.sin(yaw) * (W / 2 - 11), ny = cy - Math.cos(yaw) * (W / 2 - 11);
    ctx.fillStyle = "#ff6b6b"; ctx.font = "bold 10px Fredoka,sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("N", nx, ny);

    // ---- PLAYER: a fixed up-pointing chevron at centre + a translucent VIEW CONE
    //      so "where I am AND what I'm looking at" is unmistakable. Up === forward. ----
    ctx.save();
    const coneR = W * 0.34, coneH = 0.5;     // half-angle ~0.5 rad
    const cg = ctx.createRadialGradient(cx, cy, 2, cx, cy, coneR);
    cg.addColorStop(0, "rgba(126,217,255,.32)"); cg.addColorStop(1, "rgba(126,217,255,0)");
    ctx.fillStyle = cg; ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, coneR, -Math.PI / 2 - coneH, -Math.PI / 2 + coneH); ctx.closePath(); ctx.fill();
    ctx.restore();
    // crisp chevron: a faint accent halo under an ink-white arrow so it never
    // melts into a bright block or a crew wash beneath it
    ctx.save();
    ctx.shadowColor = "rgba(125,231,255,.85)"; ctx.shadowBlur = 5;
    ctx.fillStyle = "#e8ecf2"; ctx.strokeStyle = "rgba(0,0,0,.65)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx + 5.5, cy + 6); ctx.lineTo(cx, cy + 2.5); ctx.lineTo(cx - 5.5, cy + 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  // little top-down helicopter glyph with spinning rotor — reads as "air threat"
  function drawChopper(ctx, x, y, now) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(now * 9);
    ctx.strokeStyle = "rgba(255,80,70,.95)"; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#ff5040"; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 6.28); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1; ctx.stroke();
  }

  CBZ.cityHudDirty = function () { dirty = true; };

  // ---- THE NEXT-STEP LINE: the onboarding chain (origins.js
  //      CBZ.cityOnboardLine) or the prospect task (playergang.js
  //      CBZ.cityProspectTask). Shown when the line CHANGES (a new step
  //      arrived, or a step paid off), faded after a few seconds, never nags
  //      twice. TITLE ONLY: the producers' hints carry key legends ("press H",
  //      "(E)") and walkthrough prose, which breaks the fourth wall. A title
  //      that itself reads as a control legend is dropped too. ----
  const CONTROL_RE = /\[[A-Za-z0-9/\- ]{1,8}\]|\([A-Z]\)|\b(?:press|click|hold|tap)\b|\bLMB\b|\bRMB\b|Shift\+|\bWASD\b/i;
  let objSig = null;
  function pollObjective() {
    if (!objEl) return;
    // a live race owns the top-centre slot (racehud.js's chip)
    const race = document.getElementById("raceHud");
    if (race && race.style.display === "block") { objEl.classList.remove("on"); return; }
    let L = null;
    try { L = CBZ.cityOnboardLine ? CBZ.cityOnboardLine() : null; } catch (e) { L = null; }
    if (!L && CBZ.cityProspectTask) {
      let t = null; try { t = CBZ.cityProspectTask(); } catch (e) { t = null; }
      if (t && t.label) L = { title: t.label };
    }
    const title = L && L.title && !CONTROL_RE.test(String(L.title)) ? String(L.title) : "";
    const sig = title + "|" + (L && L.flash ? 1 : 0);
    if (sig === objSig) return;
    const first = objSig === null;
    objSig = sig;
    if (!title) { objEl.classList.remove("on"); return; }
    objEl.textContent = title;
    objEl.style.color = L.flash ? "var(--money,#7ed957)" : "";
    reveal(objEl, first ? 7000 : 6000);
  }

  // ---- WEAPON HOTBAR — bring the city loadout up to jail's clarity, reading the
  //      engine's AUTHORITATIVE weapon state: CBZ.weaponInventory (owned ids) →
  //      CBZ.FPS_WEAPONS (labels/short/slot), CBZ.currentWeaponId (held), and the
  //      live mag/reserve out of CBZ.fps.rounds/reserves (the SAME source fpsmode's
  //      setAmmoHud() reads). City melee (g.cityMeleeWeapon) is a held slot too; an
  //      empty inventory shows a single "Fists" slot. All guarded — degrades to a
  //      bare Fists slot if the engine weapon tables aren't loaded. -----------------
  function weaponMetaById(id) {
    const T = CBZ.FPS_WEAPONS;
    if (!T) return null;
    for (let i = 0; i < T.length; i++) { const w = T[i]; if (w && (w.id === id || w.key === id)) return { w: w, i: i }; }
    return null;
  }
  // a unified-bar gun entry carries label/short (not the engine weapon index); map
  // it back to its FPS_WEAPONS row so the chip can show live mag/reserve (DRY) and
  // the big ammo line, exactly as before. Matched by label first, then short.
  function weaponMetaByLabel(label, short) {
    const T = CBZ.FPS_WEAPONS;
    if (!T) return null;
    for (let i = 0; i < T.length; i++) { const w = T[i]; if (w && (w.label === label || (short && w.short === short))) return { w: w, i: i }; }
    return null;
  }
  // THE FACE OF A USABLE-ITEM CHIP. This used to read two local glyph tables
  // (LOOT_ITEM_ICON / LOOT_ICON) that the repo-wide emoji strip had emptied to
  // "" — so every food, drug and throwable on the bar drew the bare "▣"
  // fallback below. city/itemicons.js draws the real pictogram from the item's
  // KIND, which also covers everything registered at runtime (species meat,
  // pelts, the fishing catch, C4, produce) that no name table could reach.
  // Degrade-safe: no module / flag off -> the old expression exactly.
  function hotbarItemFace(name, item) {
    if (CBZ.itemIconHtml) { const h = CBZ.itemIconHtml(name, item); if (h) return h; }
    return "<span class='ic'>▣</span>";
  }
  // The model in the player's hands and the full inventory panel carry weapon
  // names.  The moving HUD uses only a compact silhouette family so it never
  // recreates the old FIST / 9MM / 556 / RPG word strip.
  function hotbarGunGlyph(meta) {
    const w = meta && meta.w;
    const id = String((w && (w.id || w.key || w.label || w.short)) || "").toLowerCase();
    if (/rocket|rpg|bazooka|launcher/.test(id)) return "◎";
    if (/shotgun|12/.test(id)) return "═";
    if (/smg|machine|uzi/.test(id)) return "≋";
    if (/rifle|carbine|556|5\.56/.test(id)) return "▰";
    if (/pistol|sidearm|9mm/.test(id)) return "◒";
    return "◆";
  }
  /* ============================================================
     ONE BOXED WEAPON HOTBAR, TWO MODES (CBZ.CONFIG.WEAPON_STRIP_SHARED).

     OWNER: "only one gun at a time shows in inventory unlike gang city."

     He is right, and the cause is that the two modes were drawing from two
     different things over the same array. There is ONE truth — CBZ.weaponInventory
     (weapons/weapon-data.js) — and there were TWO renderers over it:

       · this file's icon hotbar, which walks the whole inventory and gives each
         gun its own boxed chip with a real rendered silhouette. This is the one
         the owner means by "gang city";
       · systems/fpsmode.js's `setWeaponStrip`, a row of bare WORDS
         ("9MM / 12G / 762") that the city explicitly disables — and which is
         all the prison ever had.

     Meanwhile the 9-slot bag the prison DOES show (systems/inventory.js) carries
     the legacy single "Gun" item that weapon-data.js keeps pointed at whatever
     is currently in your hands. So three guns rendered as one chip. Not a bug in
     any one file: two renderers and a proxy item, and nobody owning the answer.

     BLOCK LAW: promote the better renderer, delete the worse one. This is that
     component. One call, no ceremony, no state of its own — it reads the same
     globals both callers already read — and it is degrade-safe by construction:
     a caller that cannot find it keeps whatever it drew before.

       CBZ.weaponSlotsHTML({icons})  ->  the .cSlot chip row for the FULL
                                         inventory, held slot marked.

     Consumers migrated in this same change: this file's legacy path (above) and
     systems/fpsmode.js's strip, which now draws boxes instead of words — so the
     prison gets the city's inventory bar and the text strip is gone.
     Ratchet: CBZ.weaponStripAudit().renderers, pinned at 1.
     ============================================================ */
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.WEAPON_STRIP_SHARED == null) CBZ.CONFIG.WEAPON_STRIP_SHARED = true;
  CBZ.weaponSlotsHTML = function (opts) {
    opts = opts || {};
    const icons = !!opts.icons;
    const fps2 = CBZ.fps;
    const inv = (CBZ.weaponInventory && CBZ.weaponInventory.length) ? CBZ.weaponInventory : [];
    const melee = CBZ.game.cityMeleeWeapon || null;   // Bat/Knife — held melee, not a gun
    const heldGun = !melee && CBZ.currentWeaponId ? CBZ.currentWeaponId : null;
    let html = "";

    // Prison Escape is the one fixed rail: [1] is always fists and [2]..[0]
    // are the player's rearrangeable loadout. Empty cells stay visible so the
    // number is a physical place in the stash, not an acquisition-order label
    // that slides every time a gun is picked up.
    if (opts.prisonLoadout) {
      const keys = CBZ.PRISON_WEAPON_SLOT_KEYS || ["2", "3", "4", "5", "6", "7", "8", "9", "0"];
      const slots = CBZ.prisonWeaponLoadout ? CBZ.prisonWeaponLoadout() : inv.slice(0, keys.length);
      const fistsHeld = !!CBZ.game.prisonHolstered || !heldGun;
      html += "<div class='cSlot fists" + (fistsHeld ? " held" : "") +
        "' data-prison-slot='-1' data-key='1'><span class='key'>1</span><span class='s fist'>FIST</span></div>";
      for (let i = 0; i < keys.length; i++) {
        const id = slots[i] || null;
        const m = id ? weaponMetaById(id) : null;
        const held = !!(id && id === heldGun && !CBZ.game.prisonHolstered);
        let ammoTxt = "";
        if (m && !held && fps2 && fps2.rounds && fps2.reserves) {
          const cur = (fps2.rounds[m.i] != null) ? fps2.rounds[m.i] : (m.w.mag || 0);
          const res = (fps2.reserves[m.i] != null) ? fps2.reserves[m.i] : (m.w.reserve || 0);
          if (cur + res <= 0) ammoTxt = "<span class='a dry'>" + (icons ? "∅" : "DRY") + "</span>";
        }
        const face = m
          ? (icons ? hotbarGunFace(m, id) : "<span class='s'>" + esc(m.w.short || m.w.label || id) + "</span>")
          : "<span class='s empty'>—</span>";
        html += "<div class='cSlot" + (held ? " held" : "") + (id ? "" : " empty") +
          "' data-prison-slot='" + i + "' data-key='" + keys[i] + "'" +
          (id ? " data-weapon-id='" + esc(id) + "' draggable='true'" : "") + ">" +
          "<span class='key'>" + keys[i] + "</span>" + face + ammoTxt + "</div>";
      }
      return html;
    }

    let slot = 1;
    const key = function () { return "<span class='key'>" + (slot++) + "</span>"; };
    // FISTS is the baseline, and it is a real slot: unarmed is a thing you can
    // deliberately be, not the absence of a bar.
    const fistsHeld = !melee && !heldGun;
    if (!inv.length && !melee) {
      html += "<div class='cSlot held'>" + key() + (icons ? "<span class='ic'></span>" : "<span class='s'>Fists</span>") + "</div>";
    } else {
      if (melee) {
        html += "<div class='cSlot melee held'>" + key() +
          (icons ? "<span class='ic'></span>" : "<span class='s'>" + esc(melee) + "</span>") + "</div>";
      } else if (fistsHeld) {
        html += "<div class='cSlot held'>" + key() + (icons ? "<span class='ic'></span>" : "<span class='s'>Fists</span>") + "</div>";
      }
      for (let k = 0; k < inv.length; k++) {
        const id = inv[k];
        const m = weaponMetaById(id);
        if (!m) continue;
        const lbl = m.w.short || m.w.label || id;
        const held = (id === heldGun);
        // ONE source of truth for ammo: the big line under the bar carries the
        // HELD gun's live mag/reserve; slots stay clean. The only count that
        // still matters at a glance is a stone-dry gun.
        let ammoTxt = "";
        if (!held && fps2 && fps2.rounds && fps2.reserves) {
          const cur = (fps2.rounds[m.i] != null) ? fps2.rounds[m.i] : (m.w.mag || 0);
          const res = (fps2.reserves[m.i] != null) ? fps2.reserves[m.i] : (m.w.reserve || 0);
          if (cur + res <= 0) ammoTxt = "<span class='a dry'>" + (icons ? "∅" : "DRY") + "</span>";
        }
        html += "<div class='cSlot" + (held ? " held" : "") + "' data-weapon-id='" + esc(id) + "'>" + key() +
          (icons ? hotbarGunFace(m, id) : "<span class='s'>" + esc(lbl) + "</span>") + ammoTxt + "</div>";
      }
    }
    return html;
  };
  // how many guns the bar can actually SEE. `shown` must equal `held` — that
  // equality IS the owner's complaint, as a number.
  CBZ.weaponStripAudit = function () {
    const inv = (CBZ.weaponInventory && CBZ.weaponInventory.length) ? CBZ.weaponInventory : [];
    let shown = 0;
    for (let k = 0; k < inv.length; k++) if (weaponMetaById(inv[k])) shown++;
    return {
      on: CBZ.CONFIG.WEAPON_STRIP_SHARED !== false,
      renderers: 1,                       // pinned: this function is the only one
      held: inv.length, shown: shown,     // must be equal
      melee: !!CBZ.game.cityMeleeWeapon,
      textStrip: false,                   // fpsmode's word row is gone
    };
  };

  function hotbarGunFace(meta, directId) {
    const w = meta && meta.w;
    // Unified hotbar entries already carry the canonical engine id. Prefer it
    // over a label round-trip so every gun gets the exact same procedural
    // thumbnail used by the full I inventory. That "exact same" is now literal:
    // city/itemicons.js photographs guns through the ONE offscreen camera every
    // other item in the bar goes through, so the pistol chip and the medkit chip
    // beside it are lit and framed identically instead of coming from two
    // renderers with two frames. weaponThumbnail stays as the degrade.
    const id = directId || (w && (w.id || w.key));
    let src = "";
    try { if (id && CBZ.itemIconGun) src = CBZ.itemIconGun(id); } catch (e) {}
    if (!src) { try { if (id && CBZ.weaponThumbnail) src = CBZ.weaponThumbnail(id); } catch (e) {} }
    return src ? "<img class='gunModel' src='" + src + "' alt=''>"
      : "<span class='ic gun'>" + hotbarGunGlyph(meta) + "</span>";
  }
  function ammoReadout(cur, mag, reserve, reloading) {
    // Instrumentation only: reload is a glyph and all remaining characters are
    // numbers. The old RELOADING/RES prose repeated what the animation conveys.
    return (reloading ? "<span class='rl'>↻</span> " : "") +
      "<b>" + cur + "</b><span class='res'> / " + reserve + "</span>";
  }
  function renderHotbar() {
    if (!slotsEl) return;
    const fps = CBZ.fps;                            // engine ammo store (guarded)
    // city-only: drive the UNIFIED bar (holster + guns + usable items) when the
    // API is present. Outside city (jail/survival) fall back to the legacy
    // owned-guns/melee render so those modes are byte-identical.
    const useUnified = g.mode === "city" && typeof CBZ.cityHotbar === "function";
    let line = "";
    if (useUnified) {
      let bar = null;
      try { bar = CBZ.cityHotbar(); } catch (e) { bar = null; }
      if (bar) {
        const ITEMS = (CBZ.cityEcon && CBZ.cityEcon.ITEMS) || {};
        let html = "";
        for (let bi = 0; bi < bar.length; bi++) {
          const e = bar[bi];
          const held = !!e.active;
          if (e.kind === "holster") {
            // Leading empty-hand chip. Slot number + pose glyph, no label.
            html += "<div class='cSlot" + (held ? " held" : "") + "' data-bi='" + bi + "'>" +
              "<span class='key'>" + (bi + 1) + "</span><span class='ic'></span></div>";
          } else if (e.kind === "gun") {
            // Weapon silhouette + slot number. Empty is ∅; live rounds stay in
            // the numeric ammo instrument below.
            const m = weaponMetaById(e.id) || weaponMetaByLabel(e.label, e.short);
            let ammoTxt = "";
            if (!held && m && fps && fps.rounds && fps.reserves) {
              const cur = (fps.rounds[m.i] != null) ? fps.rounds[m.i] : (m.w.mag || 0);
              const res = (fps.reserves[m.i] != null) ? fps.reserves[m.i] : (m.w.reserve || 0);
              if (cur + res <= 0) ammoTxt = "<span class='a dry'>∅</span>";
            }
            html += "<div class='cSlot" + (held ? " held" : "") + "' data-bi='" + bi + "'>" +
              "<span class='key'>" + (bi + 1) + "</span>" + hotbarGunFace(m, e.id) + ammoTxt + "</div>";
          } else if (e.kind === "item") {
            // Usable item: its drawn pictogram + count. A stack whose name the
            // catalog has never heard of still gets a face (the parcel), never
            // a word — words on the moving HUD are the thing this bar removed.
            const iname = e.item || e.label;
            const cnt = (e.count != null && e.count > 1) ? "<span class='cnt'>×" + (e.count | 0) + "</span>" : "";
            const face = hotbarItemFace(iname, ITEMS[iname]);
            html += "<div class='cSlot item" + (held ? " held" : "") + "' data-bi='" + bi + "' title='" +
              String(iname).replace(/'/g, "&#39;") + "'>" +
              "<span class='key'>" + (bi + 1) + "</span>" + face + cnt + "</div>";
          } else if (e.kind === "phone") {
            // The handset as a carried thing: itemicons.js already photographs
            // a "phone" kind, so the slot shows the object — same face the
            // full I inventory would draw — never the word PHONE.
            html += "<div class='cSlot item phone" + (held ? " held" : "") +
              (e.unread ? " unread" : "") + (e.buzz ? " buzz" : "") + "' data-bi='" + bi + "' title='Phone'>" +
              "<span class='key'>" + (bi + 1) + "</span>" + hotbarItemFace("Phone", null) +
              "<i class='led' aria-hidden='true'></i></div>";
          }
        }
        // TOUCH: the bag. The keyboard opens the [I] screen; a thumb had only
        // the character card's pill, which the HUD purge removed, so the bar
        // carries one more chip on touch (never on desktop).
        if (isTouch() && CBZ.cityCharPanel && CBZ.cityCharPanel.open) {
          html += "<div class='cSlot item' data-inv='1' title='Bag'>" + hotbarItemFace("Bag", null) + "</div>";
        }
        wHTML(slotsEl, html);
        // the prominent equipped-weapon ammo line (jail-style big mag / reserve) for
        // whichever gun is the active entry; holster/items show no ammo here.
        for (let bi = 0; bi < bar.length; bi++) {
          const e = bar[bi];
          if (e.kind !== "gun" || !e.active) continue;
          const m = weaponMetaById(e.id) || weaponMetaByLabel(e.label, e.short);
          let cur = 0, mag = 0, res = 0, reloading = false;
          // effective mag capacity respects a fitted extended/drum mag (gunmods.js)
          const magCap = m ? (CBZ.gunModsMag ? CBZ.gunModsMag(m.w.id || m.w.key, m.w.mag || 0) : (m.w.mag || 0)) : 0;
          if (m && fps && fps.rounds && fps.reserves) {
            cur = (fps.rounds[m.i] != null) ? fps.rounds[m.i] : magCap;
            res = (fps.reserves[m.i] != null) ? fps.reserves[m.i] : (m.w.reserve || 0);
            mag = magCap;
            reloading = (m.i === fps.weapon) && (fps.reloading > 0);
          } else if (m) { cur = magCap; mag = magCap; res = m.w.reserve || 0; }
          line = ammoReadout(cur, mag, res, reloading);
          break;
        }
        wHTML(ammoLineEl, line);
        return;
      }
    }
    // ---- LEGACY path (non-city, or the API not yet loaded) — now the SHARED
    //      renderer, which the prison also draws through. See CBZ.weaponSlotsHTML.
    wHTML(slotsEl, CBZ.weaponSlotsHTML({ icons: g.mode === "city" }));
    const inv = (CBZ.weaponInventory && CBZ.weaponInventory.length) ? CBZ.weaponInventory : [];
    const melee = g.cityMeleeWeapon || null;        // Bat/Knife — a held melee, not a gun
    const heldGun = !melee && CBZ.currentWeaponId ? CBZ.currentWeaponId : null;
    // the prominent equipped-weapon ammo line (jail-style big mag / reserve). For a
    // gun we read fps live state for the CURRENT weapon; melee/fists show no ammo.
    if (heldGun) {
      const m = weaponMetaById(heldGun);
      let cur = 0, mag = 0, res = 0, reloading = false;
      if (m && fps && fps.rounds && fps.reserves) {
        cur = (fps.rounds[m.i] != null) ? fps.rounds[m.i] : (m.w.mag || 0);
        res = (fps.reserves[m.i] != null) ? fps.reserves[m.i] : (m.w.reserve || 0);
        mag = m.w.mag || 0;
        reloading = (m.i === fps.weapon) && (fps.reloading > 0);
      } else if (m) { cur = m.w.mag || 0; mag = m.w.mag || 0; res = m.w.reserve || 0; }
      line = ammoReadout(cur, mag, res, reloading);
    }
    // melee / fists show NOTHING here — the lit chip already names them; a
    // "Bat — melee" caption under a lit Bat chip was the HUD reading itself
    // aloud (F6).
    wHTML(ammoLineEl, line);
  }

  function wHTML(el, h) { if (el && el._cbzH !== h) { el._cbzH = h; el.innerHTML = h; } }

  let ammoSig = "";
  // a compact signature of the UNIFIED bar (holster state + each entry's
  // active/label + item counts) plus the held gun's live mag/reserve/reload. The
  // bar re-renders only when one of these actually changes — so number-key/click
  // selection, holstering, picking up a gun, or eating an item all refresh the
  // chips, while plain firing only touches the DOM on a real ammo change.
  function unifiedBarSig() {
    let bar = null;
    try { bar = CBZ.cityHotbar(); } catch (e) { bar = null; }
    if (!bar) return "x";
    let s = (g.cityHolstered ? "H" : "h");
    const fps = CBZ.fps;
    for (let i = 0; i < bar.length; i++) {
      const e = bar[i];
      s += "|" + (e.kind || "") + ":" + (e.short || e.label || "") + (e.active ? "*" : "");
      if (e.kind === "item") s += "#" + (e.count | 0);
      // the phone chip's LED and buzz are state the bar must repaint on
      if (e.kind === "phone") s += (e.unread ? "u" : "") + (e.buzz ? "z" : "");
      if (e.kind === "gun" && e.active && fps && fps.rounds && fps.reserves) {
        const m = weaponMetaById(e.id) || weaponMetaByLabel(e.label, e.short);
        const k = m ? m.i : -1;
        s += "@" + (k >= 0 ? fps.rounds[k] : "") + "/" + (k >= 0 ? fps.reserves[k] : "") + (fps.reloading > 0 ? "r" : "");
      }
    }
    return s;
  }
  function refreshAmmoLive() {
    const fps = CBZ.fps;
    const melee = g.cityMeleeWeapon || null;
    const heldGun = !melee && CBZ.currentWeaponId ? CBZ.currentWeaponId : null;
    let sig;
    if (g.mode === "city" && typeof CBZ.cityHotbar === "function") {
      // city: signature spans the whole unified bar so holster/item/select changes
      // re-render too (legacy ammo-only sig missed those).
      sig = unifiedBarSig();
    } else if (heldGun && fps && fps.rounds && fps.reserves) {
      const m = weaponMetaById(heldGun);
      const i = m ? m.i : -1;
      sig = heldGun + "|" + (i >= 0 ? fps.rounds[i] : "") + "|" + (i >= 0 ? fps.reserves[i] : "") + "|" + (fps.reloading > 0 ? 1 : 0);
    } else {
      sig = (melee || "fists");
    }
    if (sig === ammoSig) return;
    ammoSig = sig;
    renderHotbar();
  }


  // ---- cash: invisible at rest; a change shows the total + a floating delta
  //      for ~3 s, then it fades. ----
  let lastCash = null;
  function showMoney() {
    const c = g.cash || 0;
    if (c === lastCash) return;
    cashEl.textContent = "$" + c.toLocaleString();
    if (lastCash != null && deltaEl) {
      const d = c - lastCash;
      deltaEl.textContent = (d > 0 ? "+$" : "-$") + Math.abs(d).toLocaleString();
      deltaEl.style.color = d > 0 ? "var(--money,#7ed957)" : "#ff6b6b";
      deltaEl.style.animation = "none"; void deltaEl.offsetWidth;
      deltaEl.style.animation = "cDeltaUp 1.4s ease-out forwards";
      reveal(cashEl.parentNode, 3000);
    }
    lastCash = c;
  }

  // ---- the slot bar surfaces when the loadout's SHAPE changes (select,
  //      holster, pick up, use up), not when a round leaves the magazine. ----
  let barShapeSig = null;
  function syncWeapon(P) {
    let shape = "";
    if (typeof CBZ.cityHotbar === "function") shape = unifiedBarSig().replace(/@[^|]*/g, "");
    if (shape !== barShapeSig) {
      // never over the car's instrument cluster: no reveal behind the wheel
      if (barShapeSig !== null && !P.driving) reveal(slotsEl, 2500);
      barShapeSig = shape;
    }
    // the ammo count exists only while a gun is the thing in your hands
    const gunOut = !!ammoLineEl.innerHTML && !P.driving && !P.dead;
    const disp = gunOut ? "" : "none";
    if (ammoLineEl._disp !== disp) { ammoLineEl._disp = disp; ammoLineEl.style.display = disp; }
  }

  // ---- screen edges: wanted siren wash + wound vignette ----
  let hurtOp = -1, heatOp = -1, hurtLow = null;
  function syncEdges(P) {
    const maxHp = P.maxHp || 100;
    const f = Math.max(0, Math.min(1, (P.hp || 0) / maxHp));
    // nothing above half; deepens to full at 10% (a scratch is not a wound)
    let o = P.dead ? 0 : Math.max(0, Math.min(1, (0.5 - f) / 0.4));
    o = Math.round(o * 20) / 20;
    if (o !== hurtOp) { hurtOp = o; hurtEl.style.opacity = String(o); }
    const low = !P.dead && f < 0.3;
    if (low !== hurtLow) { hurtLow = low; hurtEl.classList.toggle("low", low); }
    let w = g.wanted | 0;
    try { if (CBZ.cityStars) w = CBZ.cityStars() | 0; } catch (e) {}
    const ho = w > 0 && !P.dead ? Math.min(0.75, 0.22 + w * 0.11) : 0;
    if (ho !== heatOp) {
      heatOp = ho;
      heatEl.style.opacity = String(ho);
      heatEl.classList.toggle("on", ho > 0);
    }
  }

  CBZ.onAlways(46, function () {
    build();
    const show = g.mode === "city";
    // respect the [Shift+O] hide-HUD toggle (charpanel.js)
    const hudHidden = show && CBZ.cityCharPanel && CBZ.cityCharPanel.hudHidden && CBZ.cityCharPanel.hudHidden();
    const rDisp = (show && !hudHidden) ? "block" : "none";
    if (root._cbzDisp !== rDisp) { root._cbzDisp = rDisp; root.style.display = rDisp; }
    if (document.body._cbzModeCity !== show) { document.body._cbzModeCity = show; document.body.classList.toggle("mode-city", show); }
    if (!show) return;
    const P = CBZ.player;
    showMoney();
    if (dirty) { renderHotbar(); dirty = false; }
    // live ammo while firing/reloading (signature-guarded)
    refreshAmmoLive();
    syncWeapon(P);
    syncEdges(P);
    // radar + objective poll, throttled (quality slider: tier0 7Hz, Best 14Hz)
    radarAcc += 1 / 60;
    if (radarAcc >= 1 / (CBZ.qScale ? CBZ.qScale(7, 14) : 14)) { radarAcc = 0; drawRadar(); pollObjective(); }
    // aiming reticle when holding a firearm on foot, unless fpsmode draws its own
    if (crossEl) {
      const it = CBZ.cityCurrentWeapon && CBZ.cityCurrentWeapon();
      const fpsAiming = (CBZ.weaponThirdPersonActive && CBZ.weaponThirdPersonActive()) || (CBZ.fpsActive && CBZ.fpsActive());
      const cDisp = (it && it.gun && !fpsAiming && !P.driving && !P.dead && !CBZ.cityMenuOpen) ? "block" : "none";
      if (crossEl._cbzDisp !== cDisp) { crossEl._cbzDisp = cDisp; crossEl.style.display = cDisp; }
    }
  });
})();
