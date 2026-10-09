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
     • WANTED: no stars, no pill, no screen wash. The minimap's heat ring and
       the world: sirens, cruisers, the chopper, the roadblock.
     • HEALTH: no bar, no hearts, no full red wash (owner, 2026-09-30: "the
       red, what does that even mean?"). Your body tells you: a flinch on
       every hit, and near the end a light red rim, grey colour, a heartbeat, loud
       breath and a stagger (systems/eyes.js fed by systems/vitals.js).
     • AMMO is not this file: the one gauge every game draws (systems/fpsmode.js
       #ammo), only while a gun is in your hands.
     • THE BAR is not this file: systems/inventory.js's #hotbar, the prison's
       inventory, is the one inventory of every game (2026-09-30).
     • NEXT STEP (#cObj): shows when a NEW objective line arrives, ~6 s, fades.
     • RETICLE (#cCross): only with a gun out on foot when fpsmode is not
       already drawing one.

   GONE: the stars pill, crew count, level line, population pill, turf pay,
   kill feed, event feed, gang badge, relationship chip, melee posture bars,
   hearts/food/armor/stamina rows, the carried-loot row, the fallback
   speedometer (carcluster.js owns the car), the job distance pill (the
   waypoint guide already says it), the ROUTE chip and progress sliver.

   PUBLIC API kept for the ~80 callers: CBZ.cityHudDirty, CBZ.cityFeed,
   CBZ.cityFlavor (both route to the phone, never to the screen).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  let root, hudEl, cashEl, deltaEl, objEl, radar, crossEl;
  let dirty = true;


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
        // bottom-centre: the live ammo count, riding just above the one bar
        // (systems/inventory.js #hotbar, css/inventory.css: bottom 16 + cells)
        "#cRadar{position:absolute;left:var(--hud-pad-l);bottom:var(--hud-pad-b);width:132px;height:132px;border-radius:50%;opacity:.9;box-shadow:0 4px 14px rgba(0,0,0,.45)}" +
        "@media (max-width:900px),(max-height:560px){#cRadar{width:108px;height:108px}#cMoney{font-size:21px}}";
      document.head.appendChild(st);
    }
    root = document.createElement("div");
    root.id = "cityHud";
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:20;display:none;font-family:Fredoka,system-ui,sans-serif";
    root.innerHTML =
      "<div id='cHud' style='position:absolute;inset:0'>" +
      // #cTopRight keeps its name: css/mobile.css + css/campaign.css key off it
      "<div id='cTopRight' style='position:absolute;top:var(--hud-pad-t);right:var(--hud-pad-r);text-align:right'>" +
      "  <div class='fade' id='cCash' style='position:relative;display:inline-block'><div id='cMoney'>$0</div><div id='cDelta'></div></div>" +
      "</div>" +
      "<div id='cObj' class='fade'></div>" +
      "<canvas id='cRadar' width='190' height='190'></canvas>" +
      "<div id='cCross' style='position:absolute;left:50%;top:50%;width:7px;height:7px;margin:-4px 0 0 -4px;border:2px solid rgba(232,236,242,.85);border-radius:50%;display:none'></div>" +
      "</div>";
    document.body.appendChild(root);
    hudEl = root.querySelector("#cHud");
    cashEl = root.querySelector("#cMoney"); deltaEl = root.querySelector("#cDelta");
    objEl = root.querySelector("#cObj");
    radar = root.querySelector("#cRadar");
    crossEl = root.querySelector("#cCross");
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
    if (CBZ.hudIsSpoken && CBZ.hudIsSpoken(msg)) return;   // words go over the speaker's head
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
    // ---- THE PLANNED CITIES (CBZ.metroCities): streets, river, parks and
    //      building footprints from the plan, ONLY what is inside the view —
    //      the 200 m plan index (worldmap.js CBZ.metroEach) hands back a few
    //      cells' worth, never the whole metro. Same street language as the
    //      downtown below: a dark casing, then the fill; arterials brighter.
    const MC = CBZ.metroCities;
    if (MC && MC.length && CBZ.metroEach) {
      const e = R + 30, bx0 = px - e, bx1 = px + e, bz0 = pz - e, bz1 = pz + e;
      const okP = (q) => q && Number.isFinite(q.x) && Number.isFinite(q.z);
      const poly = (pts) => { for (let i = 0; i < pts.length; i++) { if (!okP(pts[i])) return; if (i) ctx.lineTo(u(pts[i].x), v(pts[i].z)); else ctx.moveTo(u(pts[i].x), v(pts[i].z)); } };
      for (const mc of MC) {
        const Pm = mc && mc.plan, B = Pm && Pm.bounds;
        if (!B || B.maxX < bx0 || B.minX > bx1 || B.maxZ < bz0 || B.minZ > bz1) continue;
        ctx.fillStyle = "rgba(58,92,56,.8)";
        CBZ.metroEach(mc, "parks", bx0, bx1, bz0, bz1, function (k) {
          ctx.fillRect(u(k.x0), v(k.z0), (k.x1 - k.x0) * sc, (k.z1 - k.z0) * sc);
        });
        const Rv = Pm.river;
        if (Rv && Rv.pts && Rv.pts.length > 1) {
          ctx.strokeStyle = "#1d4a5c";
          ctx.lineCap = "round"; ctx.lineJoin = "round";
          // an island river is its channels (the arms round the island)
          for (const ch of Rv.channels || [{ pts: Rv.pts }]) {
            const hw = ch.half ? Math.max.apply(null, ch.half) : Rv.half;
            ctx.lineWidth = Math.max(3, (hw || 30) * 2 * sc);
            ctx.beginPath(); poly(ch.pts); ctx.stroke();
          }
        }
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        for (let pass = 0; pass < 2; pass++) {
          CBZ.metroEach(mc, "streets", bx0, bx1, bz0, bz1, function (st) {
            if (!st.pts || st.pts.length < 2) return;
            const major = st.k === "art" || st.k === "rural";
            const w = Math.max(major ? 1.8 : 1.1, (st.w || 10) * sc * 0.85);
            ctx.strokeStyle = pass ? (major ? "rgba(178,188,202,.55)" : "rgba(150,160,174,.36)") : "rgba(8,11,15,.65)";
            ctx.lineWidth = pass ? w : w + 2.5;
            ctx.beginPath(); poly(st.pts); ctx.stroke();
          });
        }
        ctx.lineCap = "butt"; ctx.lineJoin = "miter";
        ctx.fillStyle = "#151a20"; ctx.globalAlpha = 0.85;
        CBZ.metroEach(mc, "bldgs", bx0, bx1, bz0, bz1, function (b) {
          const dx = b.x - px, dz = b.z - pz; if (dx * dx + dz * dz > R2) return;
          const w = Math.max(1, b.w * sc), d = Math.max(1, b.d * sc);
          if (!b.rot || w < 2) { ctx.fillRect(u(b.x) - w / 2, v(b.z) - d / 2, w, d); return; }
          // metroplan's footprint convention: a canvas turn of -rot
          ctx.save(); ctx.translate(u(b.x), v(b.z)); ctx.rotate(-b.rot); ctx.fillRect(-w / 2, -d / 2, w, d); ctx.restore();
        });
        ctx.globalAlpha = 1;
      }
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

  // ---- AMMO — the one number the city keeps under the gun. The things you
  //      carry are the ONE bar, systems/inventory.js's #hotbar (the prison's
  //      bar, the same code in every game); this file used to draw a second
  //      bar here (#cSlots) with its own tap handler, digit map and word-strip
  //      fallback (CBZ.weaponSlotsHTML). Deleted 2026-09-30. What is left is
  //      the live mag / reserve of the gun in your hands, read from the same
  //      engine store fpsmode's setAmmoHud() reads. -----------------------------
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
    if (dirty) dirty = false;
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
