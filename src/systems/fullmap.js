/* ============================================================
   systems/fullmap.js - shared full-screen navigation map.

   M opens a north-up map in every mode. Left-click or right-click places a
   mode-local waypoint; after the map closes a compact arrow keeps guiding the
   player without replacing the prison objective compass.

   In the city the map is the PLANNING board: district names lettered across
   their blocks + a busy-ness wash (bright = foot traffic = witnesses, marks
   and cops; dark = deals and body dumps), climb points (▲ lift lobbies, fire
   stairs) for roof routes, and the ad boards YOU rent printed in gold — so
   "where do I rob / dump / climb / flex" is answered before you commit.
   Static city layers render ONCE per open to offscreen plates and composite
   as drawImage calls, so the live redraw cost stays flat.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const root = document.getElementById("fullMap");
  const cv = document.getElementById("fullMapCanvas");
  if (!CBZ || !root || !cv) return;

  let ctx = cv.getContext("2d");   // let: helpers retarget onto the offscreen plates
  const W = cv.width, H = cv.height, PAD = 26;
  const closeBtn = document.getElementById("fullMapClose");
  const titleEl = document.getElementById("fullMapTitle");
  const readout = document.getElementById("fullMapReadout");
  const placeHint = document.getElementById("fullMapPlaceHint");
  const clearBtn = document.getElementById("fullMapClear");
  const legend = document.getElementById("fullMapLegend");
  const zoomWrap = document.getElementById("fullMapZoom");
  const zoomInBtn = document.getElementById("fullMapZoomIn");
  const zoomOutBtn = document.getElementById("fullMapZoomOut");
  const guide = document.getElementById("waypointGuide");
  const mapKeyEl = document.querySelector("#waypointGuide .waypoint-mapkey");
  const arrow = document.getElementById("waypointArrow");
  const distEl = document.getElementById("waypointDist");
  const labelEl = document.getElementById("waypointLabel");
  const MODE_TITLE = { escape: "PRISON MAP", survival: "ISLAND MAP", city: "WORLD MAP" };

  const map = {
    active: false,
    points: { escape: null, survival: null, city: null },
    routes: { escape: null, survival: null, city: null },
    projection: null,
  };
  CBZ.fullMap = map;

  function mode() { return CBZ.game.mode || "escape"; }

  // ---- MAP_V2 (owner's overhaul flag) + the wanted-star read -----------------
  // MAP_V2 on ⇒ icons/marks/labels draw LIVE at the current zoom (never baked
  // into the zoom-magnified plate) and the map draws the REAL road network +
  // registered settlements. Wanted level always comes through CBZ.cityStars()
  // when the wanted system exposes it (guard-called — another module owns it).
  function MAP_V2() { return !CBZ.CONFIG || CBZ.CONFIG.MAP_V2 !== false; }
  function starCount() {
    try { if (CBZ.cityStars) return CBZ.cityStars() | 0; } catch (e) {}
    return (CBZ.game && CBZ.game.wanted) | 0;
  }

  // ---- MAP_ICONS_V2 ---------------------------------------------------------
  // OWNER, verbatim: "AND THE MAP SHOWS WAY WAY TOO MUCH TEXT. IT SHOULD SHOW
  // ICONS, AND TEXT WHEN AN ICON IS HOVERED OVER."
  //
  // Before this flag the map printed a NAME over every point of interest at the
  // zoom M drops you at, so ~90 shop names stacked on top of the geography and
  // the chart was unreadable. With MAP_ICONS_V2 on, a POI draws a PICTOGRAM that
  // says its trade at a glance and its name appears only for the icon under the
  // cursor (desktop) or the icon you tapped (touch). One-line revert to the
  // all-text map: CBZ.CONFIG.MAP_ICONS_V2 = false.
  if (CBZ.CONFIG && CBZ.CONFIG.MAP_ICONS_V2 == null) CBZ.CONFIG.MAP_ICONS_V2 = true;
  function ICONS_V2() { return !CBZ.CONFIG || CBZ.CONFIG.MAP_ICONS_V2 !== false; }

  function boundsFor(which) {
    if (which === "survival") {
      const A = CBZ.surv && CBZ.surv.arena;
      const S = A || (CBZ.SURV && CBZ.SURV.arena) || { cx: 0, cz: 600, radius: 120 };
      const c = A ? A.center : { x: S.cx, z: S.cz };
      const r = (A ? A.radius : S.radius) + 8;
      return { minX: c.x - r, maxX: c.x + r, minZ: c.z - r, maxZ: c.z + r };
    }
    if (which === "city") {
      const A = CBZ.city && CBZ.city.arena;
      if (A) {
        let minX = A.minX, maxX = A.maxX, minZ = A.minZ, maxZ = A.maxZ;
        const mt = A.mapTerrain && A.mapTerrain.bounds;
        if (mt) {
          minX = Math.min(minX, mt.minX); maxX = Math.max(maxX, mt.maxX);
          minZ = Math.min(minZ, mt.minZ); maxZ = Math.max(maxZ, mt.maxZ);
        }
        if (A.annex) {
          minX = Math.min(minX, A.annex.cx - A.annex.radius);
          maxX = Math.max(maxX, A.annex.cx + A.annex.radius);
          minZ = Math.min(minZ, A.annex.cz - A.annex.radius);
          maxZ = Math.max(maxZ, A.annex.cz + A.annex.radius);
        }
        // worldmap.js islands & biomes extend the map to the whole archipelago
        if (A.regions) for (const rg of A.regions) {
          minX = Math.min(minX, rg.minX); maxX = Math.max(maxX, rg.maxX);
          minZ = Math.min(minZ, rg.minZ); maxZ = Math.max(maxZ, rg.maxZ);
        }
        // Leave an honest strip of navigable water around the surveyed coast.
        // Ten metres was effectively no margin at the whole-world scale and
        // made the terrain look like a board filling the map frame.
        const waterMargin = 90;
        return { minX: minX - waterMargin, maxX: maxX + waterMargin, minZ: minZ - waterMargin, maxZ: maxZ + waterMargin };
      }
      const C = CBZ.CITY || { center: { x: 0, z: -700 }, blocks: 6, block: 34, road: 9 };
      const step = (C.block || 34) + (C.road || 9);
      const r = (C.blocks || 6) * step * 0.5 + 18;
      return { minX: C.center.x - r, maxX: C.center.x + r, minZ: C.center.z - r, maxZ: C.center.z + r };
    }
    const B = CBZ.WORLD || { minX: -46, maxX: 46, minZ: -45, maxZ: 131 };
    return { minX: B.minX - 2, maxX: B.maxX + 2, minZ: B.minZ - 2, maxZ: B.maxZ + 2 };
  }

  // pan/zoom view applied on TOP of the fit-to-bounds base. Only used by the
  // city map (other modes ignore it); ox/oz = world point centred on canvas,
  // z = zoom multiplier over the base fit. fitted=false means "re-centre on the
  // player next open" (so M drops you where you stand, GTA-style).
  map.view = { z: 1, ox: 0, oz: 0, fitted: false };
  function makeProjection(bounds) {
    const sw = bounds.maxX - bounds.minX, sh = bounds.maxZ - bounds.minZ;
    const sc0 = Math.min((W - PAD * 2) / sw, (H - PAD * 2) / sh);
    const useView = (mode() === "city");
    const z = useView ? map.view.z : 1;
    const sc = sc0 * z;
    let left, top;
    if (useView) {
      // centre the canvas on the view's world point (ox,oz) at the zoomed scale
      left = W / 2 - (map.view.ox - bounds.minX) * sc;
      top = H / 2 - (map.view.oz - bounds.minZ) * sc;
    } else {
      left = (W - sw * sc) * 0.5; top = (H - sh * sc) * 0.5;
    }
    return {
      bounds, sc, sc0, left, top,
      x(wx) { return left + (wx - bounds.minX) * sc; },
      z(wz) { return top + (wz - bounds.minZ) * sc; },
      wx(mx) { return bounds.minX + (mx - left) / sc; },
      wz(mz) { return bounds.minZ + (mz - top) / sc; },
    };
  }
  // the base (un-panned, un-zoomed) projection used to BAKE the static plates,
  // so the live composite can re-scale them with a single canvas transform.
  function baseProjection(bounds) {
    const sw = bounds.maxX - bounds.minX, sh = bounds.maxZ - bounds.minZ;
    const sc = Math.min((W - PAD * 2) / sw, (H - PAD * 2) / sh);
    const left = (W - sw * sc) * 0.5, top = (H - sh * sc) * 0.5;
    return {
      bounds, sc, sc0: sc, left, top,
      x(wx) { return left + (wx - bounds.minX) * sc; },
      z(wz) { return top + (wz - bounds.minZ) * sc; },
      wx(mx) { return bounds.minX + (mx - left) / sc; },
      wz(mz) { return bounds.minZ + (mz - top) / sc; },
    };
  }
  function clampZoom(z) { return Math.max(0.6, Math.min(12, z)); }
  // keep the panned centre within the bounds (+ a margin) so you can never
  // scroll the land off into the void.
  function clampPan() {
    const b = boundsFor("city"), m = 120;
    map.view.ox = Math.max(b.minX - m, Math.min(b.maxX + m, map.view.ox));
    map.view.oz = Math.max(b.minZ - m, Math.min(b.maxZ + m, map.view.oz));
  }
  // frame the view on the player (default) or fit the whole archipelago (F).
  function setCityView(fitAll) {
    const b = boundsFor("city");
    if (fitAll) {
      map.view.z = 1;
      map.view.ox = (b.minX + b.maxX) * 0.5;
      map.view.oz = (b.minZ + b.maxZ) * 0.5;
      map.view.fitted = true;
      return;
    }
    const pos = CBZ.player && CBZ.player.pos;
    map.view.ox = pos ? pos.x : 0;
    map.view.oz = pos ? pos.z : -700;
    // base scale that fits the whole map → choose z so ~250 world units frame
    // the canvas (zoomed-in on the player, like dropping M on GTA's pause map)
    const sw = b.maxX - b.minX, sh = b.maxZ - b.minZ;
    const sc0 = Math.min((W - PAD * 2) / sw, (H - PAD * 2) / sh);
    const wantSc = (W - PAD * 2) / 250;
    map.view.z = clampZoom(wantSc / sc0);
    map.view.fitted = true;
    clampPan();
  }

  function activeWaypoint(which) { return map.points[which || mode()] || null; }
  function activeRoute(which) { return map.routes[which || mode()] || null; }
  map.waypoint = activeWaypoint;
  map.route = activeRoute;
  map.boundsFor = boundsFor;

  function clearWaypoint(which) {
    const key = which || mode();
    map.points[key] = null;
    map.routes[key] = null;
    updateGuide();
    if (map.active) draw();
  }
  map.clearWaypoint = clearWaypoint;

  /* ---- NO KEYBOARD ⇒ NO KEY LEGEND -----------------------------------------
     OWNER (iPad, prison): the map still shouted keystrokes at a device that has
     none — "Close [M]", "[Space] clear waypoint", "Click or right-click to
     place a waypoint". Two of those named the ONLY documented way to do the
     thing, so on a tablet the instruction was not merely wrong, it was a dead
     end: there was no other clear-waypoint affordance anywhere.

     Same rule the rest of the codebase already keeps (mobile.css's doctrine
     header, controls.js's isTouch card, interact.js's verb pills): a touch
     surface carries WORDS, never a key cap. Decided once, here, off the single
     CBZ.touchMode latch systems/touch.js raises — and re-run on every open()
     so a session that starts on a mouse and gets a finger later still flips.
     `.waypoint-mapkey`'s "[M] map" tail is the third site; it is
     pointer-events:none so mobile.css drops it instead of retitling it. */
  const KEYCAPS = {
    close: { key: "Close [M]", touch: "✕ Close" },
    clear: { key: "[Space] clear waypoint", touch: "Clear waypoint" },
    place: { key: "Click or right-click to place a waypoint", touch: "Tap the map to place a waypoint" },
  };
  function keycaps() {
    if (CBZ.CONFIG && CBZ.CONFIG.MAP_TOUCH_LABELS === false) return;
    const t = !!CBZ.touchMode;
    const set = function (el, spec) {
      if (!el) return;
      const want = t ? spec.touch : spec.key;
      if (el.textContent !== want) el.textContent = want;
    };
    set(closeBtn, KEYCAPS.close);
    set(clearBtn, KEYCAPS.clear);
    set(placeHint, KEYCAPS.place);
    // The arrow's "[M] map" tail. #waypointGuide is pointer-events:none, so
    // there is no touch verb to swap in — a finger opens the map by tapping the
    // minimap (wired below), which the arrow is in no position to advertise.
    // Inline "" rather than a rule, so city.css's own !important hide still wins.
    if (mapKeyEl) mapKeyEl.style.display = t ? "none" : "";
  }
  map.keycaps = keycaps;
  // The footer chip is the clear-waypoint verb itself, not a caption of the
  // Space handler below — that key is what a hand on a keyboard reaches for,
  // and this is what a thumb reaches for. Both land on clearWaypoint().
  if (clearBtn) clearBtn.addEventListener("click", function (e) { e.preventDefault(); clearWaypoint(); });

  function nearLabel(x, z, which) {
    if (which === "city") {
      const A = CBZ.city && CBZ.city.arena;
      let best = null, bd = 17;
      const lots = A ? (A.lots || []).concat(A.annex ? A.annex.lots || [] : []) : [];
      for (const lot of lots) {
        const info = poiInfo(lot);
        const d = Math.hypot(lot.cx - x, lot.cz - z);
        if (info && d < bd) { best = { lot, info }; bd = d; }
      }
      // each non-player gang's HQ is also a snap candidate, so clicking near a
      // rival block auto-labels it "<Gang> HQ" (same snap radius as POIs).
      let bestGang = null, gd = 17;
      for (const gang of CBZ.cityGangs || []) {
        if (!gang || gang.isPlayer || gang.absorbed) continue;
        const c = gang.center; if (!c || (!c.x && !c.z)) continue;
        const d = Math.hypot(c.x - x, c.z - z);
        if (d < gd) { bestGang = gang; gd = d; }
      }
      // climb points snap too (tight radius — a deliberate click): planning a
      // roof run from the map should land the waypoint ON the lift door or
      // the ladder foot, not on the building's front desk.
      let bestUp = null, ud = 9;
      for (const el of (CBZ.cityElevators && CBZ.cityElevators()) || []) {
        const gp = el.groundPad; if (!gp) continue;
        const d = Math.hypot(gp.x - x, gp.z - z);
        if (d < ud) { bestUp = { x: gp.x, z: gp.z, label: "Roof lift" }; ud = d; }
      }
      for (const lot of lots) {
        const fe = lot.building && lot.building.fireEscape;
        if (!fe) continue;
        const d = Math.hypot(fe.x - x, fe.z - z);
        if (d < ud) { bestUp = { x: fe.x, z: fe.z, label: "Fire stairs" }; ud = d; }
      }
      if (bestUp && (!best || ud < bd) && (!bestGang || ud < gd)) return bestUp;
      // whichever (POI vs HQ) is nearer wins
      if (bestGang && (!best || gd < bd)) {
        return { x: bestGang.center.x, z: bestGang.center.z, label: (bestGang.name || "Gang") + " HQ" };
      }
      if (best) {
        const door = best.lot.building && best.lot.building.door;
        return { x: door ? door.x : best.lot.cx, z: door ? door.z : best.lot.cz, label: best.info.label };
      }
    } else if (which === "escape") {
      let best = null, bd = 5.5;
      for (const vent of CBZ.vents || []) {
        const d = Math.hypot(vent.x - x, vent.z - z);
        if (d < bd) { best = vent; bd = d; }
      }
      if (best) return { x: best.x, z: best.z, label: best.name || "Maintenance route" };
      if (CBZ.EXIT && Math.hypot(CBZ.EXIT.x - x, CBZ.EXIT.z - z) < 8) return { x: CBZ.EXIT.x, z: CBZ.EXIT.z, label: "Freedom Gate" };
    } else {
      const A = CBZ.surv && CBZ.surv.arena;
      let best = null, bd = 10;
      for (const hill of (A && A.hills) || []) {
        const d = Math.hypot(hill.x - x, hill.z - z);
        if (d < Math.max(bd, hill.r * 0.6)) { best = hill; bd = d; }
      }
      if (best) return { x: best.x, z: best.z, label: best === A.hills[0] ? "High Ground" : "Hill" };
    }
    return { x, z, label: "Waypoint" };
  }

  function rebuildRoute(wp) {
    if (!wp || !CBZ.player || !CBZ.player.pos || !CBZ.navigation) return null;
    const key = mode();
    const route = CBZ.navigation.plan(key, CBZ.player.pos, wp);
    map.routes[key] = route;
    if (route && route.goal) { wp.x = route.goal.x; wp.z = route.goal.z; }
    return route;
  }

  function setWaypoint(x, z, label) {
    const which = mode(), b = boundsFor(which);
    x = Math.max(b.minX, Math.min(b.maxX, x));
    z = Math.max(b.minZ, Math.min(b.maxZ, z));
    const snapped = nearLabel(x, z, which);
    const wp = map.points[which] = { x: snapped.x, z: snapped.z, label: label || snapped.label };
    rebuildRoute(wp);
    if (CBZ.flashHint) CBZ.flashHint("Waypoint set - " + waypointDistance(wp) + "m", 1.5);
    updateGuide();
    if (map.active) draw();
    return wp;
  }
  map.setWaypoint = setWaypoint;

  // ---- route to a GANG's HQ. Resolve via the gangs cluster's accessor when it's
  //      present (cityGangHQ → live boss / seeded hq / shifting centre), else fall
  //      back to the raw record's center/boss.pos. Null-guarded so escape/survival
  //      (where CBZ.cityGangs is absent) simply no-op. Absorbed/dead crews whose
  //      centre has collapsed to {0,0} are skipped — they have no real HQ. ----
  function setGangWaypoint(gangId) {
    if (gangId == null || !CBZ.cityGangs) return null;
    let hq = null, name = null;
    if (CBZ.cityGangHQ) {
      const h = CBZ.cityGangHQ(gangId);
      if (h) { hq = { x: h.x, z: h.z }; name = h.name; }
    }
    if (!hq && CBZ.cityGangById) {
      const rec = CBZ.cityGangById(gangId);
      if (rec) {
        name = (rec.name || "Gang") + " HQ";
        if (rec.boss && !rec.boss.dead && rec.boss.pos) hq = { x: rec.boss.pos.x, z: rec.boss.pos.z };
        else if (rec.center && (rec.center.x || rec.center.z)) hq = { x: rec.center.x, z: rec.center.z };
        else if (rec.turf && rec.turf.length) hq = { x: rec.turf[0].cx, z: rec.turf[0].cz };
      }
    }
    // skip an absorbed crew pushed to a dead {0,0} centre (no real HQ left)
    if (!hq || (!hq.x && !hq.z)) return null;
    return setWaypoint(hq.x, hq.z, name || "Gang HQ");
  }
  map.setGangWaypoint = setGangWaypoint;

  function clearMoveKeys() {
    const keys = CBZ.keys || {};
    for (const k of ["w", "a", "s", "d", "shift", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"]) keys[k] = false;
  }

  function open() {
    if (map.active) return true;
    if (CBZ.game.state !== "playing" && CBZ.game.state !== "paused") return false;
    if (CBZ.simView && CBZ.simView.active && CBZ.setSimulationView) CBZ.setSimulationView(false);
    map.active = true;
    // MUTUAL EXCLUSION with the phone(s): the map and a raised handset never
    // share the screen. map.active is set first so their close() paths skip
    // the pointer-relock (the map owns the cursor now).
    if (CBZ.campaignPhoneOpen && CBZ.campaignUI && CBZ.campaignUI.close) {
      try { CBZ.campaignUI.close(); } catch (e) {}
    }
    if (CBZ.cityClosePhone) { try { CBZ.cityClosePhone(); } catch (e) {} }
    clearMoveKeys();
    plates.a = null;   // re-render the static city plates fresh each open (ownership/renovations may have moved)
    if (mode() === "city") setCityView(false);   // drop the view on the player, zoomed-in
    map._cursor = null; map._sel = null; map._hoverKey = "";
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("full-map-open");
    keycaps();   // touch: no M key, no Space bar, no right-click — see KEYCAPS
    // touch zoom chips: only the city map runs the pan/zoom view (other modes
    // ignore map.view entirely), so the chips hide with it. Desktop never sees
    // them regardless — CSS only reveals the stack under body.touch.
    if (zoomWrap) zoomWrap.style.display = (mode() === "city" && (!CBZ.CONFIG || CBZ.CONFIG.MAP_ZOOM_BUTTONS !== false)) ? "" : "none";
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    draw();
    updateGuide();
    return true;
  }

  function close(relock) {
    if (!map.active) return;
    map.active = false;
    map._cursor = null; map._sel = null; map._hoverKey = "";
    zoomRepeatStop();   // a held zoom chip must never keep repeating past the map
    root.setAttribute("aria-hidden", "true");
    document.body.classList.remove("full-map-open");
    updateGuide();
    if (relock !== false && CBZ.game.state === "playing" && CBZ.requestLock) CBZ.requestLock();
  }

  map.open = open;
  map.close = close;
  map.toggle = function () { if (map.active) close(); else open(); };

  function waypointDistance(wp) {
    const p = CBZ.player && CBZ.player.pos;
    const route = activeRoute();
    return p ? Math.round(route && CBZ.navigation ? CBZ.navigation.remaining(route, p) : Math.hypot(wp.x - p.x, wp.z - p.z)) : 0;
  }

  function line(x1, z1, x2, z2, p, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width || 1;
    ctx.beginPath(); ctx.moveTo(p.x(x1), p.z(z1)); ctx.lineTo(p.x(x2), p.z(z2)); ctx.stroke();
  }

  function dot(x, z, p, color, r) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x(x), p.z(z), r || 2.5, 0, Math.PI * 2); ctx.fill();
  }

  // world-anchored place text. Routed through mapLabel so EVERY permanent word
  // on the chart is measured by the same funnel the audit reads (see mapLabel).
  function text(s, x, z, p, color, size) {
    mapLabel(s, p.x(x), p.z(z), { size: size || 12, fill: color || "rgba(235,245,255,.62)", halo: false, force: true });
  }

  function traceRoute(g, toX, toZ, route) {
    route = route || activeRoute();
    if (!g || !route || !route.points || route.points.length < 2) return;
    g.save();
    g.strokeStyle = "rgba(125,231,255,.78)"; g.lineWidth = 2.4;
    for (let i = 0; i < route.points.length - 1; i++) {
      const a = route.points[i], b = route.points[i + 1];
      g.setLineDash(a.teleportToNext ? [5, 5] : []);
      g.beginPath(); g.moveTo(toX(a.x), toZ(a.z)); g.lineTo(toX(b.x), toZ(b.z)); g.stroke();
    }
    g.setLineDash([]);
    g.restore();
  }
  map.trace = traceRoute;

  function drawPlayer(p) {
    if (!CBZ.player || !CBZ.player.pos) return;
    const pos = CBZ.player.pos;
    const h = CBZ.playerChar && CBZ.playerChar.group ? CBZ.playerChar.group.rotation.y : 0;
    ctx.save(); ctx.translate(p.x(pos.x), p.z(pos.z)); ctx.rotate(Math.atan2(Math.cos(h), Math.sin(h)));
    // view cone (where you're looking) so "where I am AND what I face" is clear
    const cone = ctx.createRadialGradient(0, 0, 2, 0, 0, 46);
    cone.addColorStop(0, "rgba(255,176,80,.35)"); cone.addColorStop(1, "rgba(255,176,80,0)");
    ctx.fillStyle = cone; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 46, -0.5, 0.5); ctx.closePath(); ctx.fill();
    // bold facing chevron with a dark outline
    ctx.fillStyle = "#ff9b3d"; ctx.strokeStyle = "rgba(0,0,0,.65)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-7, 6.5); ctx.lineTo(-4, 0); ctx.lineTo(-7, -6.5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawWaypoint(p) {
    const wp = activeWaypoint();
    if (!wp) return;
    traceRoute(ctx, p.x, p.z);
    const x = p.x(wp.x), z = p.z(wp.z), pulse = 7 + Math.sin(performance.now() * 0.008) * 2;
    ctx.strokeStyle = "#7de7ff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, z, pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 12, z); ctx.lineTo(x + 12, z); ctx.moveTo(x, z - 12); ctx.lineTo(x, z + 12); ctx.stroke();
    // YOUR OWN DESTINATION KEEPS ITS NAME. It is the one thing on this chart
    // you already chose, so making you hover to re-read it would be a downgrade.
    if (ICONS_V2() && wp.label) {
      mapLabel(wp.label, x, z - 17, { size: 11, fill: "#bff2ff", haloC: "rgba(0,0,0,.8)", force: true });
      pickAdd(x, z, 13, "waypoint", wp.label, waypointDistance(wp) + " m away", wp.x, wp.z);
    }
  }

  function drawEscape(p) {
    ctx.fillStyle = "rgba(82,99,95,.48)"; ctx.fillRect(p.x(-30), p.z(-8), 60 * p.sc, 60 * p.sc);
    ctx.fillStyle = "rgba(58,70,85,.72)"; ctx.fillRect(p.x(-16), p.z(-44), 32 * p.sc, 36 * p.sc);
    ctx.fillStyle = "rgba(70,87,104,.64)"; ctx.fillRect(p.x(-44), p.z(52), 88 * p.sc, 76 * p.sc);
    text("CELL BLOCK", 0, -24, p); text("NORTH YARD", 0, 20, p); text("SOUTH BLOCK", 0, 91, p);

    ctx.fillStyle = "rgba(185,198,210,.30)";
    for (const c of CBZ.colliders || []) {
      if (c.maxX < p.bounds.minX || c.minX > p.bounds.maxX || c.maxZ < p.bounds.minZ || c.minZ > p.bounds.maxZ) continue;
      ctx.fillRect(p.x(c.minX), p.z(c.minZ), Math.max(1, (c.maxX - c.minX) * p.sc), Math.max(1, (c.maxZ - c.minZ) * p.sc));
    }
    for (const n of CBZ.npcs || []) {
      if (!n.escaped) dot(n.group.position.x, n.group.position.z, p, n.dead ? "rgba(145,145,145,.48)" : (n.gang === 0 ? "#ff6b6b" : (n.gang === 1 ? "#6b98ff" : "#d9d2c4")), 2.4);
    }
    const ambient = CBZ.ambient;
    const step = ambient ? Math.max(1, Math.ceil(ambient.total / 420)) : 1;
    for (let i = 0; ambient && i < ambient.total; i += step) {
      ambient.materialize(i, ambient.clock || 0);
      dot(ambient.posX[i], ambient.posZ[i], p, "rgba(217,210,196,.38)", 1.35);
    }
    for (const g of CBZ.guards || []) if (!g.dead) dot(g.group.position.x, g.group.position.z, p, g.hunt > 0 ? "#ff3146" : "#ffd451", 3);
    if (CBZ.keycard && !CBZ.keycard.collected) dot(CBZ.keycard.group.position.x, CBZ.keycard.group.position.z, p, "#39ff88", 4);
    // Vents/hatches are ICONS with the name on hover — the prison map used to
    // stamp "HATCH" over every routed vent, which is the same clutter the world
    // map had, one floor down.
    for (const vent of CBZ.vents || []) {
      drawPoi(vent.x, vent.z, p, "#c792ea", ICONS_V2() ? "" : (vent.route ? "HATCH" : ""), false, "hatchpt");
      if (ICONS_V2()) pickAdd(p.x(vent.x), p.z(vent.z), 8, "hatchpt", vent.name || "Maintenance hatch", vent.route ? "Escape route" : "", vent.x, vent.z);
    }
    if (CBZ.EXIT) {
      if (ICONS_V2()) {
        drawIcon(ctx, p.x(CBZ.EXIT.x), p.z(CBZ.EXIT.z), "exitpt", { size: 9, tier: true }); stats.icons++;
        pickAdd(p.x(CBZ.EXIT.x), p.z(CBZ.EXIT.z), 10, "exitpt", "Freedom Gate", "", CBZ.EXIT.x, CBZ.EXIT.z);
      } else { dot(CBZ.EXIT.x, CBZ.EXIT.z, p, "#39ff88", 5); text("EXIT", CBZ.EXIT.x, CBZ.EXIT.z - 3, p, "#8dffb8", 11); }
    }
  }

  function drawSurvival(p) {
    const A = CBZ.surv && CBZ.surv.arena;
    const S = A || (CBZ.SURV && CBZ.SURV.arena);
    if (!S) return;
    const c = A ? A.center : { x: S.cx, z: S.cz }, r = A ? A.radius : S.radius;
    ctx.fillStyle = "rgba(78,142,86,.48)"; ctx.beginPath(); ctx.arc(p.x(c.x), p.z(c.z), r * p.sc, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(180,231,255,.55)"; ctx.lineWidth = 4; ctx.stroke();
    text("SURVIVAL ISLAND", c.x, c.z, p, "rgba(235,245,255,.45)", 16);
    for (let i = 0; A && i < (A.hills || []).length; i++) {
      const hill = A.hills[i];
      ctx.fillStyle = i === 0 ? "rgba(255,212,81,.18)" : "rgba(195,215,153,.15)";
      ctx.strokeStyle = i === 0 ? "rgba(255,212,81,.52)" : "rgba(195,215,153,.36)";
      ctx.lineWidth = i === 0 ? 3 : 1.5;
      ctx.beginPath(); ctx.arc(p.x(hill.x), p.z(hill.z), hill.r * p.sc, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (i === 0) text("HIGH GROUND", hill.x, hill.z, p, "#ffe38a", 11);
    }
    for (const b of CBZ.bots || []) if (!b.dead) dot(b.pos.x, b.pos.z, p, "rgba(232,238,245,.78)", 2);
  }

  function drawRoads(A, p) {
    ctx.strokeStyle = "rgba(156,168,182,.48)"; ctx.lineWidth = Math.max(2, (A.ROAD || 6) * p.sc * 0.62);
    for (const x of A.xLines || []) line(x, A.minZ, x, A.maxZ, p, ctx.strokeStyle, ctx.lineWidth);
    for (const z of A.zLines || []) line(A.minX, z, A.maxX, z, p, ctx.strokeStyle, ctx.lineWidth);
  }

  // ---- REAL ROAD NETWORK (MAP_V2) ------------------------------------------
  // The rebuilt world stamps every drivable segment onto A.roads with its own
  // width (r.w) + lane data; highways/avenues carry district==="highway" or
  // r.avenue. We draw the ACTUAL segments (not the coarse xLines/zLines grid)
  // as a GTA-style two-pass ribbon: dark casing under a lighter fill, round
  // caps so junctions merge. Highways read gold + wider so arterials dominate.
  // Baked into the base plate, so the 12fps composite pays nothing per frame.
  function roadSpan(r) {
    const half = (r.len || 0) / 2;
    return r.vertical ? [r.x, r.z - half, r.x, r.z + half] : [r.x - half, r.z, r.x + half, r.z];
  }
  function drawArenaRoads(A, p) {
    const roads = A.roads || [];
    if (!roads.length) { drawRoads(A, p); return; }
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    const ROAD = A.ROAD || 18;
    // two global passes (all casings, then all fills) so crossings knit cleanly
    for (const pass of [0, 1]) {
      for (const r of roads) {
        const hwy = r.district === "highway" || r.avenue;
        const wWorld = (r.w != null ? r.w : ROAD) * (hwy ? 1 : 0.82);
        const wpx = Math.max(hwy ? 3 : 1.6, wWorld * p.sc);
        const [x1, z1, x2, z2] = roadSpan(r);
        if (pass === 0) { ctx.strokeStyle = "rgba(11,16,21,.82)"; ctx.lineWidth = wpx + Math.max(2, wpx * 0.28); }
        else { ctx.strokeStyle = hwy ? "rgba(201,164,77,.82)" : "rgba(150,161,177,.72)"; ctx.lineWidth = wpx; }
        ctx.beginPath(); ctx.moveTo(p.x(x1), p.z(z1)); ctx.lineTo(p.x(x2), p.z(z2)); ctx.stroke();
      }
    }
    // dashed centreline on the wider arterials only (skip the tight streets)
    ctx.strokeStyle = "rgba(240,214,110,.4)"; ctx.setLineDash([5, 6]);
    for (const r of roads) {
      const hwy = r.district === "highway" || r.avenue;
      if (!hwy) continue;
      const wpx = Math.max(3, (r.w != null ? r.w : ROAD) * p.sc);
      if (wpx < 8) continue;
      ctx.lineWidth = Math.max(1, wpx * 0.05);
      const [x1, z1, x2, z2] = roadSpan(r);
      ctx.beginPath(); ctx.moveTo(p.x(x1), p.z(z1)); ctx.lineTo(p.x(x2), p.z(z2)); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
  }

  // ---- SETTLEMENTS (MAP_V2) -------------------------------------------------
  // The 17 registered towns (CBZ.settlements) are real places out in the
  // biomes — a named marker + a shop/home tally so "there's a town in the
  // desert" is legible. A casino town gets a gold pip. Drawn LIVE at fixed
  // size so the marker never balloons at zoom.
  function drawSettlementsLive(p) {
    // Larger, more important settlements get first claim on label space.  The
    // source registry is build-order data, not cartographic priority, so using
    // it verbatim made tiny hamlets hide actual cities at the fit view.
    const list = (CBZ.settlements || []).slice().sort(function (a, b) {
      const an = (a && a.counts ? (a.counts.shops || 0) + (a.counts.homes || 0) : 0);
      const bn = (b && b.counts ? (b.counts.shops || 0) + (b.counts.homes || 0) : 0);
      return bn - an;
    });
    if (!list.length) return;
    const A = CBZ.city && CBZ.city.arena;
    // LEGACY ONLY: with MAP_ICONS_V2 off the region names are baked onto the
    // zoom-scaled plate, so their live footprint has to be re-derived here or a
    // town name lands on "Redhollow Woods". With the flag on, region names are
    // live and share the one box list, which is what makes this unnecessary.
    if (!ICONS_V2() && A) {
      const known = settlementNameSet();
      for (const rg of A.regions || []) {
        if (isLink(rg) || rg.underlay) continue;
        const name = rg.name || rg.biome || ""; if (!name) continue;
        if (known.has(String(name).toLowerCase().replace(/[^a-z0-9]+/g, ""))) continue;
        const c = regionCentroid(rg);
        const wpx = (rg.kind === "circle" ? rg.r * 2 : (rg.maxX - rg.minX)) * p.sc;
        const size = Math.max(11, Math.min(20, wpx / Math.max(6, name.length * 0.55)));
        const half = name.length * size * 0.28, nx = p.x(c.x), ny = p.z(c.z);
        labelBoxes.push({ x0: nx - half, y0: ny - size, x1: nx + half, y1: ny + size * (rg.subtitle ? 2 : 1) });
      }
    }
    for (const s of list) {
      if (!s || !Number.isFinite(s.cx)) continue;
      // skip towns that sit inside the mainland footprint (the city itself owns
      // that ink) — settlements are the OUT-OF-CITY places worth naming.
      if (A && s.cx > A.minX && s.cx < A.maxX && s.cz > A.minZ && s.cz < A.maxZ) continue;
      const mx = p.x(s.cx), mz = p.z(s.cz);
      if (mx < -40 || mx > W + 40 || mz < -40 || mz > H + 40) continue;
      const name = s.name || "Town";
      const cnt = s.counts || {};
      if (ICONS_V2()) {
        // the town marker joins the ONE icon vocabulary (it used to hand-roll a
        // house path + a gold pip that meant "casino" to nobody)
        drawIcon(ctx, mx, mz, "town", { size: 8, tier: !!s.casino }); stats.icons++;
        const bits = [];
        if (cnt.shops) bits.push(cnt.shops + " shops");
        if (cnt.homes) bits.push(cnt.homes + " homes");
        if (s.casino) bits.push("casino");
        pickAdd(mx, mz, 9, "town", name, bits.join(" · "), s.cx, s.cz);
      } else {
        ctx.fillStyle = "#e6c069"; ctx.strokeStyle = "rgba(0,0,0,.72)"; ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(mx, mz - 6.5); ctx.lineTo(mx + 5.5, mz - 1.5); ctx.lineTo(mx + 5.5, mz + 5);
        ctx.lineTo(mx - 5.5, mz + 5); ctx.lineTo(mx - 5.5, mz - 1.5); ctx.closePath();
        ctx.fill(); ctx.stroke();
        if (s.casino) { ctx.fillStyle = "#fff2c0"; ctx.beginPath(); ctx.arc(mx, mz + 1.5, 1.6, 0, Math.PI * 2); ctx.fill(); }
        stats.icons++;
      }
      // A TOWN NAME IS GEOGRAPHY, NOT CLUTTER — it stays permanent (you cannot
      // hover what you have not found yet). It still goes through the shared
      // funnel, so it declutters against the region names and is counted.
      mapLabel(name, mx, mz - (ICONS_V2() ? 12 : 9), { size: 11, fill: "#ffe9b0", haloC: "rgba(0,0,0,.78)" });
    }
  }

  // ---- WANTED STARS on the chart (MAP_V2): only ever shown when > 0. --------
  function drawWantedStars(wanted) {
    if (!(wanted > 0)) return;
    const n = 5, gap = 19, x0 = W / 2 - ((n - 1) * gap) / 2, y = 26;
    const pulse = 0.6 + 0.4 * Math.sin(performance.now() * 0.006);
    for (let i = 0; i < n; i++) {
      const lit = i < wanted;
      starGlyph(x0 + i * gap, y, 8, lit ? "#ffd451" : "rgba(120,132,150,.35)", lit);
    }
    if (wanted >= 4) {   // molten label at high heat
      ctx.font = "800 11px Fredoka, sans-serif"; ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,120,90," + pulse.toFixed(2) + ")";
      ctx.fillText("WANTED", W / 2, y + 15); stats.furniture++;
    }
  }
  function starGlyph(cx, cy, r, color, glow) {
    ctx.save();
    if (glow) { ctx.shadowColor = "rgba(255,190,60,.9)"; ctx.shadowBlur = 6; }
    ctx.fillStyle = color; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.44 : r;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawLots(lots, p) {
    for (const lot of lots || []) {
      ctx.fillStyle = lot.kind === "park" ? "rgba(76,153,82,.62)" : (lot.kind === "abandoned" ? "rgba(146,77,67,.75)" : "rgba(112,127,147,.72)");
      const w = Math.max(3, (lot.w || 18) * p.sc * 0.7), d = Math.max(3, (lot.d || lot.w || 18) * p.sc * 0.7);
      ctx.fillRect(p.x(lot.cx) - w * 0.5, p.z(lot.cz) - d * 0.5, w, d);
    }
  }

  // ============================================================
  //  THE MAP ICON VOCABULARY — `CBZ.mapIcon`
  //
  //  ONE table for "what does this place look like on a chart". It used to be
  //  POI_KINDS: a kind→colour map and nothing else, so every marker on both the
  //  full map and the corner radar was the SAME diamond and colour was the only
  //  thing telling a bank from a hospital — which is exactly why the old map had
  //  to print a name on every one of them.
  //
  //  Each row is {c: badge colour, r: RANK, n: human name, g: glyph, poi: it is
  //  a shop kind}. RANK does three jobs at once and is the reason no second
  //  table is needed: it is the zoom tier (>= LANDMARK is drawn at every city
  //  zoom, below it only once you zoom in), it is the declutter arbitration
  //  (when two icons collide the higher rank survives), and it is the label
  //  priority. Adding a trade is a ROW — never a second placer, never a second
  //  palette, and never a special case in a consumer.
  //
  //  Glyphs are authored on a 20×20 box centred on the origin and drawn in one
  //  ink colour over the badge, so they stay legible down to ~10 px (the radar)
  //  and up to ~22 px (a landmark on the full map). No image assets, no fonts —
  //  these are canvas primitives, which is what this map already draws with.
  // ============================================================
  const ICON_INK = "#0d1319";
  function rrect(g, x, y, w, h, r) {          // rounded rect with an arcTo fallback
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    if (g.roundRect) { g.beginPath(); g.roundRect(x, y, w, h, r); return; }
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function poly(g, pts, fill) {            // pts = [x0,y0,x1,y1,…]
    g.beginPath(); g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath(); if (fill !== false) g.fill(); else g.stroke();
  }
  function bars(g, list) {                 // list = [[x,y,w,h],…] filled rects
    for (let i = 0; i < list.length; i++) g.fillRect(list[i][0], list[i][1], list[i][2], list[i][3]);
  }
  function strokes(g, segs) {              // segs = [[x0,y0,x1,y1],…]
    g.beginPath();
    for (let i = 0; i < segs.length; i++) { g.moveTo(segs[i][0], segs[i][1]); g.lineTo(segs[i][2], segs[i][3]); }
    g.stroke();
  }
  function disc(g, x, y, r, fill) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); if (fill === false) g.stroke(); else g.fill(); }

  // GLYPH CRAFT RULES this set is authored to (they are why it reads at 16px):
  //  • SILHOUETTE OVER DETAIL — every glyph must survive being filled solid;
  //    interior detail under ~2 authoring units is sub-pixel on the radar and
  //    is not drawn at all.
  //  • ONE IDEA PER GLYPH — a single referent, no compound scenes.
  //  • NEVER COLOUR ALONE — no two kinds share a silhouette. That rule is what
  //    forced `town` off the plain house (home has it), `crest` off the diamond
  //    (jewelry has it) and `racepark` off the chequered flag (raceway has it).
  //  • CONSISTENT OPTICAL WEIGHT — a glyph is roughly 35-55% ink, so no icon
  //    reads as louder than its neighbour purely by mass.
  //  • OPTICALLY CENTRED on the 20×20 box, not mathematically centred.
  const GLYPH = {
    house: function (g) { poly(g, [-7.5, -0.5, 0, -7.5, 7.5, -0.5]); bars(g, [[-5.2, -0.5, 10.4, 7.6]]); },
    houseOpen: function (g) { poly(g, [-7.5, -0.5, 0, -7.5, 7.5, -0.5], false); g.strokeRect(-5.2, -0.5, 10.4, 7.6); },
    // a SETTLEMENT is more than one roof — that is the whole difference from
    // "home", and it survives at 10px where a colour swap does not
    town: function (g) { poly(g, [-9, 1.4, -4.4, -3.6, 0.2, 1.4]); bars(g, [[-7.6, 1.4, 6.4, 6.6]]); poly(g, [0.6, 0.4, 4.8, -5.4, 9, 0.4]); bars(g, [[2, 0.4, 5.6, 7.6]]); },
    // a PENNANT: territory claimed. Distinct from the chequered flag (a race)
    // and from the diamond (a gem).
    pennant: function (g) { strokes(g, [[-5.6, -8.4, -5.6, 8.4]]); poly(g, [-5.6, -8, 7.6, -3.6, -5.6, 0.8]); },
    wheel: function (g) { g.lineWidth = 2.9; disc(g, 0, 0, 7.2, false); strokes(g, [[-7.2, 0, 7.2, 0], [0, 0, 0, 7.2]]); disc(g, 0, 0, 2.1); },
    gun: function (g) { poly(g, [-8, -4.2, 6.4, -4.2, 6.4, -0.6, 1.2, -0.6, -0.8, 6.4, -4.8, 6.4, -3.6, -0.6, -8, -0.6]); },
    gem: function (g) { poly(g, [0, -6.6, 7.4, -1.4, 0, 7.4, -7.4, -1.4]); g.strokeStyle = "rgba(255,255,255,.5)"; strokes(g, [[-7.4, -1.4, 7.4, -1.4], [-3.5, -1.4, 0, -6.6], [3.5, -1.4, 0, -6.6]]); },
    balls: function (g) { disc(g, 0, -4.4, 2.9); disc(g, -5, 2.6, 2.9); disc(g, 5, 2.6, 2.9); },
    pump: function (g) { bars(g, [[-7.4, -7, 8.6, 14]]); g.fillStyle = "rgba(255,255,255,.62)"; bars(g, [[-5.4, -5, 4.6, 4]]); g.fillStyle = ICON_INK; strokes(g, [[1.6, -2.6, 6.4, -2.6], [6.4, -2.6, 6.4, 3.4]]); },
    shirt: function (g) { poly(g, [-7.4, -4.4, -3, -7, 3, -7, 7.4, -4.4, 5, -0.6, 3.8, -1.6, 3.8, 7, -3.8, 7, -3.8, -1.6, -5, -0.6]); },
    pill: function (g) { g.save(); g.rotate(-0.72); rrect(g, -8, -4, 16, 8, 4); g.fill(); g.strokeStyle = "rgba(255,255,255,.6)"; strokes(g, [[0, -4, 0, 4]]); g.restore(); },
    cutlery: function (g) { g.lineWidth = 2.6; strokes(g, [[-6.8, -7.4, -6.8, -3], [-2.8, -7.4, -2.8, -3], [-4.8, -3, -4.8, 7.4]]); bars(g, [[-7.4, -3.8, 5.2, 2.2]]); poly(g, [6.4, -7.4, 6.4, 7.4, 3.4, 7.4, 3.4, -3.6]); },
    glass: function (g) { poly(g, [-7, -6.4, 7, -6.4, 0, 1.2]); strokes(g, [[0, 1.2, 0, 6], [-4.2, 6.4, 4.2, 6.4]]); },
    bank: function (g) { poly(g, [-8, -2.2, 0, -7.4, 8, -2.2]); bars(g, [[-5.4, -0.6, 2.1, 5.4], [-1.05, -0.6, 2.1, 5.4], [3.3, -0.6, 2.1, 5.4], [-8, 5.6, 16, 2.4]]); },
    hammer: function (g) { g.save(); g.lineWidth = 2.9; strokes(g, [[-6, 7, 1.4, -0.4]]); g.restore(); poly(g, [-1.2, -2.2, 2.8, -6.4, 7.2, -2.2, 3.2, 2]); },
    dumbbell: function (g) { bars(g, [[-8.2, -4.4, 3, 8.8], [5.2, -4.4, 3, 8.8], [-5.6, -1.6, 11.2, 3.2]]); },
    shield: function (g) { poly(g, [0, -7.4, 7, -4.4, 7, 0.6, 3.6, 5.4, 0, 7.6, -3.6, 5.4, -7, 0.6, -7, -4.4]); },
    cross: function (g) { bars(g, [[-2.6, -7.4, 5.2, 14.8], [-7.4, -2.6, 14.8, 5.2]]); },
    pole: function (g) { rrect(g, -3.6, -8, 7.2, 16, 2.6); g.fill(); g.save(); g.clip(); g.strokeStyle = "rgba(255,255,255,.72)"; g.lineWidth = 2.4; strokes(g, [[-8, 2, 8, -6], [-8, 7, 8, -1], [-8, 12, 8, 4]]); g.restore(); },
    bolt: function (g) { poly(g, [1.6, -8, -5.4, 1.2, -0.6, 1.2, -1.6, 8, 5.4, -1.6, 0.6, -1.6]); },
    car: function (g) { poly(g, [-8, 2, -5.6, -1.4, -2.6, -4.4, 2.6, -4.4, 5.6, -1.4, 8, 2, 8, 4, -8, 4]); disc(g, -4.4, 4.6, 2); disc(g, 4.4, 4.6, 2); },
    wrench: function (g) { g.save(); g.rotate(-0.62); g.lineWidth = 3.2; g.beginPath(); g.arc(0, -4.6, 4.2, Math.PI * 0.62, Math.PI * 2.38); g.stroke(); g.restore(); g.save(); g.rotate(-0.62); bars(g, [[-1.7, -3.4, 3.4, 11]]); g.restore(); },
    chip: function (g) { disc(g, 0, 0, 7.4); g.strokeStyle = "rgba(255,255,255,.75)"; g.lineWidth = 2.6; strokes(g, [[0, -7.4, 0, -4.6], [0, 4.6, 0, 7.4], [-7.4, 0, -4.6, 0], [4.6, 0, 7.4, 0]]); g.strokeStyle = ICON_INK; disc(g, 0, 0, 3.2, false); },
    flag: function (g) { strokes(g, [[-5.4, -8.4, -5.4, 8.4]]); bars(g, [[-5.4, -8.4, 4, 3.4], [-1.4, -5, 4, 3.4], [-1.4, -8.4, 4, 3.4]]); g.fillStyle = "rgba(255,255,255,.85)"; bars(g, [[-1.4, -8.4, 4, 3.4], [-5.4, -5, 4, 3.4]]); },
    stadium: function (g) { g.save(); g.scale(1, 0.62); g.lineWidth = 4.4; disc(g, 0, 0, 7.6, false); g.restore(); bars(g, [[-1.2, -2, 2.4, 4]]); },
    splat: function (g) { disc(g, 0, 0, 4.6); disc(g, 5.6, -4, 1.9); disc(g, -5.2, 3.4, 1.7); disc(g, 4.2, 5, 1.5); disc(g, -4.6, -4.6, 1.4); },
    bus: function (g) { rrect(g, -7.4, -7, 14.8, 11.6, 2.4); g.fill(); g.fillStyle = "rgba(255,255,255,.72)"; bars(g, [[-5.2, -4.8, 10.4, 4.6]]); g.fillStyle = ICON_INK; disc(g, -4.2, 5.4, 2.1); disc(g, 4.2, 5.4, 2.1); },
    civic: function (g) { g.beginPath(); g.arc(0, -1.4, 4.4, Math.PI, 0); g.closePath(); g.fill(); strokes(g, [[0, -5.8, 0, -9.4]]); poly(g, [0, -9.4, 4.6, -7.8, 0, -6.2]); bars(g, [[-8, 5.4, 16, 2.6], [-6.4, -1.4, 2, 6.4], [-1, -1.4, 2, 6.4], [4.4, -1.4, 2, 6.4]]); },
    plane: function (g) { poly(g, [0, -9, 1.7, -2.8, 8.4, 1.4, 8.4, 3.4, 1.7, 1.8, 1.7, 5.4, 4.2, 7.6, 4.2, 8.6, 0, 7.4, -4.2, 8.6, -4.2, 7.6, -1.7, 5.4, -1.7, 1.8, -8.4, 3.4, -8.4, 1.4, -1.7, -2.8]); },
    lift: function (g) { poly(g, [0, -6.4, 6, 1.4, -6, 1.4]); bars(g, [[-6, 3.6, 12, 2.6]]); },
    ladder: function (g) { g.lineWidth = 2.8; strokes(g, [[-5, -8, -5, 8], [5, -8, 5, 8], [-5, -4, 5, -4], [-5, 1, 5, 1], [-5, 6, 5, 6]]); },
    coin: function (g) { disc(g, 0, 0, 7); g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 2; g.beginPath(); g.moveTo(3.2, -3.4); g.arc(0, -2.2, 3.2, -0.35, Math.PI * 1.05); g.arc(0, 2.2, 3.2, Math.PI * 1.9, Math.PI * 0.68, true); g.stroke(); strokes(g, [[0, -6.4, 0, 6.4]]); },
    eye: function (g) { g.beginPath(); g.moveTo(-8, 0); g.quadraticCurveTo(0, -7.4, 8, 0); g.quadraticCurveTo(0, 7.4, -8, 0); g.closePath(); g.fill(); g.fillStyle = "rgba(255,255,255,.9)"; disc(g, 0, 0, 3); g.fillStyle = ICON_INK; disc(g, 0, 0, 1.4); },
    barrier: function (g) { bars(g, [[-8.4, -3.2, 16.8, 6.4]]); g.save(); rrect(g, -8.4, -3.2, 16.8, 6.4, 0.6); g.clip(); g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 2.6; strokes(g, [[-10, 4, -3, -4], [-4, 4, 3, -4], [2, 4, 9, -4], [8, 4, 15, -4]]); g.restore(); },
    rotor: function (g) { g.lineWidth = 2.4; strokes(g, [[-8.4, -3, 8.4, 3], [-8.4, 3, 8.4, -3]]); disc(g, 0, 0, 2.6); },
    hatch: function (g) { g.strokeRect(-6.4, -6.4, 12.8, 12.8); strokes(g, [[-6.4, -2.2, 6.4, -2.2], [-6.4, 2.2, 6.4, 2.2]]); },
    exit: function (g) { strokes(g, [[-7.4, -6.6, -7.4, 6.6], [-7.4, -6.6, 0, -6.6], [-7.4, 6.6, 0, 6.6]]); g.lineWidth = 2.6; strokes(g, [[-1.4, 0, 6.6, 0]]); poly(g, [8.4, 0, 3.6, -3.6, 3.6, 3.6]); },
    pin: function (g) { disc(g, 0, -1.4, 4.4, false); strokes(g, [[0, 3, 0, 8]]); },
  };

  // kind → {c colour, r rank, n name, g glyph, poi: is a shop trade}
  const LANDMARK = 60;   // rank at or above this is drawn at every city zoom
  const MAP_ICONS = {
    // --- your own things (never decluttered away) ---
    home:      { c: "#39ff88", r: 100, n: "Home",              g: GLYPH.house },
    waypoint:  { c: "#7de7ff", r: 99,  n: "Waypoint",          g: GLYPH.pin },
    mission:   { c: "#7ed957", r: 97,  n: "Job",               g: GLYPH.flag },
    // --- live world state ---
    chopper:   { c: "#ff5040", r: 95,  n: "Police helicopter", g: GLYPH.rotor },
    sealed:    { c: "#ff5a4c", r: 93,  n: "Bridge",            g: GLYPH.barrier },
    seen:      { c: "#ff6a5a", r: 91,  n: "Last known position", g: GLYPH.eye },
    town:      { c: "#e6c069", r: 88,  n: "Settlement",        g: GLYPH.town },
    hq:        { c: "#d0d6e2", r: 80,  n: "Crew HQ",           g: GLYPH.pennant },
    // --- landmarks (rank >= LANDMARK): the fit-zoom tier ---
    hospital:  { c: "#ff5b6b", r: 82, n: "Hospital",           g: GLYPH.cross,    poi: 1 },
    casino:    { c: "#c9a227", r: 78, n: "Casino",             g: GLYPH.chip,     poi: 1 },
    bank:      { c: "#5b8bff", r: 76, n: "Bank",               g: GLYPH.bank,     poi: 1 },
    guns:      { c: "#8ed24a", r: 74, n: "Gun Store",          g: GLYPH.gun,      poi: 1 },
    cityhall:  { c: "#d8dde8", r: 72, n: "City Hall",          g: GLYPH.civic,    poi: 1 },
    transit:   { c: "#39c0d0", r: 70, n: "Transit",            g: GLYPH.bus,      poi: 1 },
    airfield:  { c: "#8a93a3", r: 68, n: "Airfield",           g: GLYPH.plane,    poi: 1 },
    arena:     { c: "#d94f45", r: 66, n: "Arena",              g: GLYPH.stadium,  poi: 1 },
    raceway:   { c: "#2f6fed", r: 66, n: "Raceway",            g: GLYPH.flag,     poi: 1 },
    racepark:  { c: "#b98a5a", r: 64, n: "Race Park",          g: GLYPH.wheel,    poi: 1 },
    carlot:    { c: "#e88a3c", r: 62, n: "Car Dealer",         g: GLYPH.car,      poi: 1 },
    chop:      { c: "#d0a23c", r: 61, n: "Chop Shop",          g: GLYPH.wrench,   poi: 1 },
    realtor:   { c: "#4fd0a0", r: 60, n: "Realtor",            g: GLYPH.houseOpen, poi: 1 },
    security:  { c: "#9aa6c2", r: 60, n: "Security",           g: GLYPH.shield,   poi: 1 },
    // --- ordinary trades (below LANDMARK): revealed once you zoom in ---
    gas:       { c: "#ff6b6b", r: 50, n: "Gas Station",        g: GLYPH.pump,     poi: 1 },
    food:      { c: "#ff9e6b", r: 48, n: "Food",               g: GLYPH.cutlery,  poi: 1 },
    bar:       { c: "#e85d8a", r: 46, n: "Bar",                g: GLYPH.glass,    poi: 1 },
    drugs:     { c: "#4caf6e", r: 44, n: "Pharmacy",           g: GLYPH.pill,     poi: 1 },
    jewelry:   { c: "#f2c43d", r: 42, n: "Jeweller",           g: GLYPH.gem,      poi: 1 },
    pawn:      { c: "#c08a3c", r: 40, n: "Pawn Shop",          g: GLYPH.balls,    poi: 1 },
    clothing:  { c: "#c792ea", r: 38, n: "Clothing",           g: GLYPH.shirt,    poi: 1 },
    electronics: { c: "#39d0c0", r: 37, n: "Electronics",      g: GLYPH.bolt,     poi: 1 },
    hardware:  { c: "#ffd166", r: 36, n: "Hardware",           g: GLYPH.hammer,   poi: 1 },
    gym:       { c: "#66d9c0", r: 34, n: "Gym",                g: GLYPH.dumbbell, poi: 1 },
    barber:    { c: "#6bb6ff", r: 32, n: "Barber",             g: GLYPH.pole,     poi: 1 },
    paintball: { c: "#7ed957", r: 30, n: "Paintball",          g: GLYPH.splat,    poi: 1 },
    // --- planning marks (zoomed-in detail) ---
    board:     { c: "#ffd451", r: 22, n: "Ad board (leased)",  g: GLYPH.coin },
    lift:      { c: "#9fd8ff", r: 18, n: "Roof lift",          g: GLYPH.lift },
    stairs:    { c: "#ffc46b", r: 16, n: "Fire stairs",        g: GLYPH.ladder },
    // --- prison map ---
    hatchpt:   { c: "#c792ea", r: 55, n: "Maintenance hatch",  g: GLYPH.hatch },
    exitpt:    { c: "#39ff88", r: 96, n: "Freedom Gate",       g: GLYPH.exit },
    _default:  { c: "#b9c4d4", r: 25, n: "Place",              g: GLYPH.pin },
  };
  function iconSpec(kind) { return MAP_ICONS[kind] || MAP_ICONS._default; }

  // Draw one icon at SCREEN pixels (x,y). `size` is the badge half-width, so a
  // 8 gives a 16px chip (the design target) and 5 gives the radar's 10px blip.
  // `tier` true = landmark ring; `count` > 1 stamps the merge badge.
  function drawIcon(g, x, y, kind, opts) {
    opts = opts || {};
    const sp = iconSpec(kind), s = opts.size || 8;
    g.save();
    g.translate(x, y);
    if (opts.shadow !== false) { g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = 3; g.shadowOffsetY = 1; }
    g.fillStyle = opts.color || sp.c;
    g.strokeStyle = "rgba(0,0,0,.78)";
    g.lineWidth = Math.max(1, s * 0.2);
    rrect(g, -s, -s, s * 2, s * 2, s * 0.42);
    g.fill();
    g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.stroke();
    if (opts.tier) {   // landmark: a hairline light rim so the tier reads instantly
      g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = Math.max(0.8, s * 0.11);
      rrect(g, -s * 0.82, -s * 0.82, s * 1.64, s * 1.64, s * 0.3); g.stroke();
    }
    g.beginPath();   // glyph, drawn in ink on a 20×20 authoring box
    g.fillStyle = ICON_INK; g.strokeStyle = ICON_INK;
    g.lineJoin = "round"; g.lineCap = "round";
    g.scale(s / 11.4, s / 11.4);
    g.lineWidth = 2.1;
    try { sp.g(g); } catch (e) {}
    g.restore();
    if (opts.count > 1) {   // MERGE BADGE: "and N more of the same trade here"
      const bs = Math.max(5, s * 0.72);
      g.save();
      g.fillStyle = "rgba(10,14,20,.92)"; g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 1;
      disc(g, x + s * 0.86, y - s * 0.86, bs, true); g.stroke();
      g.fillStyle = "#e8eef6"; g.font = "700 " + Math.round(bs * 1.35) + "px Fredoka, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(opts.count > 9 ? "9+" : String(opts.count), x + s * 0.86, y - s * 0.86 + 0.5);
      g.restore();
    }
  }

  // The block's public face. Degrade-safe by construction: every accessor
  // answers for an unknown kind, so a consumer can adopt in ONE line and can
  // never be broken by a kind this table has not heard of.
  // An icon rendered once to a data URI, so the LEGEND can be the same
  // vocabulary the chart uses instead of a second colour-swatch language.
  const iconUrlCache = {};
  function iconDataURL(kind) {
    if (iconUrlCache[kind]) return iconUrlCache[kind];
    const c = document.createElement("canvas");
    c.width = c.height = 30;
    const g = c.getContext("2d");
    drawIcon(g, 15, 15, kind, { size: 12, shadow: false });
    let u = "";
    try { u = c.toDataURL("image/png"); } catch (e) {}
    iconUrlCache[kind] = u;
    return u;
  }

  CBZ.mapIcon = {
    kinds: MAP_ICONS,
    LANDMARK: LANDMARK,
    draw: drawIcon,
    dataURL: iconDataURL,
    color: function (k) { return iconSpec(k).c; },
    rank: function (k) { return iconSpec(k).r; },
    name: function (k) { return iconSpec(k).n; },
    notable: function (k) { return iconSpec(k).r >= LANDMARK; },
    has: function (k) { return !!MAP_ICONS[k]; },
  };

  // The legacy kind→colour map every older call site reads. DERIVED from the
  // one table above (shop trades only) so a colour can never disagree with its
  // icon and there is no second palette to keep in sync.
  const POI_KINDS = (function () {
    const o = {};
    for (const k in MAP_ICONS) if (MAP_ICONS[k].poi) o[k] = MAP_ICONS[k].c;
    return o;
  })();

  // ============================================================
  //  MEASURED INK + HOVER PICKING
  //
  //  "Way too much text" only stops being an opinion when it is a NUMBER, so
  //  every permanent label on the map surface goes through ONE function
  //  (mapLabel) which measures it, records its box, tests it against every box
  //  already placed and counts it. `CBZ.mapAudit()` reports what that funnel
  //  saw on the last draw. A label that does not go through mapLabel is
  //  invisible to the ratchet — which is the whole reason there is exactly one.
  //
  //  Picking is the other half: an icon that draws also REGISTERS itself, so
  //  hover/tap resolution is a distance test over the same list the frame just
  //  drew and can never point at something that is not on screen.
  // ============================================================
  const stats = { icons: 0, labels: 0, overlaps: 0, hoverable: 0, merged: 0, skipped: 0, furniture: 0, plate: 0, zoom: 1, mode: "" };
  let labelBoxes = [];    // permanent-label AABBs placed this frame (screen px)
  let plateLabels = [];   // AABBs baked onto the static plates (base-projection px)
  let plateOverlapN = 0;  // baked labels that landed on another baked label
  let bakeMode = false;   // true while a plate is being baked
  map._picks = [];        // {x,y,r,kind,label,sub,wx,wz} for hover/tap
  map._sel = null;        // touch: the selected pick (world-anchored, survives pan/zoom)

  function boxHit(boxes, x0, y0, x1, y1) {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0) return true;
    }
    return false;
  }
  // Fold the boxes baked onto the static plates into this frame's census,
  // transformed through the SAME scale/offset compositePlate uses. Only labels
  // whose transformed box actually touches the canvas count — a name baked on a
  // landmass 4 km off the left edge is not text the player is drowning in.
  // The boxes are only PUSHED (i.e. allowed to suppress live text) under
  // MAP_ICONS_V2; the legacy map never collision-tested live text against baked
  // text and must keep measuring as the thing it really is.
  function seedPlateBoxes(p) {
    const p0 = plates.p0;
    if (!p0 || !plateLabels.length) return;
    const k = p.sc / p0.sc, dx = p.left - k * p0.left, dy = p.top - k * p0.top;
    const push = ICONS_V2();
    let n = 0;
    for (let i = 0; i < plateLabels.length; i++) {
      const b = plateLabels[i];
      const q = { x0: b.x0 * k + dx, y0: b.y0 * k + dy, x1: b.x1 * k + dx, y1: b.y1 * k + dy };
      if (q.x1 < 0 || q.x0 > W || q.y1 < 0 || q.y0 > H) continue;
      n++;
      if (push) labelBoxes.push(q);
    }
    stats.labels += n;
    stats.plate = n;
    if (n) stats.overlaps += plateOverlapN;
  }
  // THE ONE PERMANENT-LABEL DRAW. Returns true if the text was actually drawn.
  //   o.size / o.weight / o.fill / o.halo — appearance
  //   o.force  — draw even if it collides (counts an overlap instead of skipping)
  //   o.sub    — a dimmer second line under it (counts as part of the same label)
  function mapLabel(str, x, y, o) {
    str = String(str == null ? "" : str);
    if (!str) return false;
    o = o || {};
    const size = o.size || 12, weight = o.weight || 700;
    ctx.font = weight + " " + size.toFixed(1) + "px Fredoka, sans-serif";
    ctx.textAlign = o.align || "center";
    ctx.textBaseline = "alphabetic";
    const w = ctx.measureText(str).width;
    const half = ctx.textAlign === "center" ? w / 2 : 0;
    const x0 = x - half - 2, x1 = x - half + w + 2;
    const y0 = y - size, y1 = y + size * (o.sub ? 1.2 : 0.28);
    const boxes = o.boxes || (bakeMode ? plateLabels : labelBoxes);
    const hit = boxHit(boxes, x0, y0, x1, y1);
    if (hit && !o.force) { stats.skipped++; return false; }
    if (hit) { if (bakeMode) plateOverlapN++; else stats.overlaps++; }
    if (o.halo !== false) {
      ctx.lineWidth = o.haloW || 3; ctx.strokeStyle = o.haloC || "rgba(0,0,0,.72)";
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = o.fill || "rgba(232,242,255,.92)";
    ctx.fillText(str, x, y);
    if (o.sub) {
      const ss = Math.max(8, size * 0.78);
      ctx.font = "600 " + ss.toFixed(1) + "px Fredoka, sans-serif";
      if (o.halo !== false) { ctx.lineWidth = 2.4; ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.strokeText(o.sub, x, y + size * 0.95); }
      ctx.fillStyle = o.subFill || "rgba(198,212,228,.62)";
      ctx.fillText(o.sub, x, y + size * 0.95);
    }
    boxes.push({ x0: x0, y0: y0, x1: x1, y1: y1 });
    if (!bakeMode) stats.labels++;
    return true;
  }
  // Chart furniture (compass rose N, scale bar, WANTED banner) is NOT a place
  // label. Those four sites bump stats.furniture at the point they draw, so
  // they are counted APART and can never quietly absorb a place name.

  // ---- pick registry: an icon that draws also becomes hoverable -------------
  function pickAdd(x, y, r, kind, label, sub, wx, wz) {
    if (!label || bakeMode) return;   // a baked plate is not screen space — never pickable
    map._picks.push({ x: x, y: y, r: r || 9, kind: kind, label: label, sub: sub || "", wx: wx, wz: wz });
    stats.hoverable++;
  }
  // Reserve the space every icon drawn so far occupies, so the place-name pass
  // that runs after it cannot letter over a symbol. The pick list already
  // carries an on-screen box for every icon in the frame, so this costs no
  // extra bookkeeping — it is the same list hover resolution uses.
  function reserveIconBoxes() {
    const list = map._picks;
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      labelBoxes.push({ x0: q.x - q.r, y0: q.y - q.r, x1: q.x + q.r, y1: q.y + q.r });
    }
  }
  function pickAt(cx, cy) {
    const list = map._picks;
    let best = null, bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      const d = Math.hypot(q.x - cx, q.y - cy), reach = q.r + 5;
      if (d > reach) continue;
      // a tie inside two reaches goes to the higher-ranked kind, so a bank never
      // loses its own tooltip to the pawn shop two doors down
      const score = d - iconSpec(q.kind).r * 0.06;
      if (score < bd) { bd = score; best = q; }
    }
    return best;
  }
  map.pickAt = pickAt;

  // ---- THE TOOLTIP: the name, and only for the ONE thing you are pointing at.
  // Deliberately drawn on the MAP SURFACE, not as a HUD card — the killfeed is
  // this game's only sanctioned popup and a floating panel would be a second one.
  function drawMapTip(pk, ax, ay, anchored) {
    const name = pk.label, sub = pk.sub;
    ctx.save();
    ctx.font = "700 13px Fredoka, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const nw = ctx.measureText(name).width;
    ctx.font = "600 11px Fredoka, sans-serif";
    const sw = sub ? ctx.measureText(sub).width : 0;
    const padX = 9, ic = 9;
    const bw = Math.max(nw, sw) + padX * 2 + ic * 2 + 6;
    const bh = sub ? 36 : 24;
    // Both anchors are the ICON, never the cursor — a card that chases the
    // mouse jitters and can end up covering the very thing it names. Desktop
    // sets it beside the icon; touch centres it above, so a thumb never covers
    // what it just asked about. Both flip when they would leave the canvas.
    let bx = anchored ? ax - bw / 2 : ax + 14;
    let by = anchored ? ay - bh - 16 : ay - bh - 12;
    if (bx + bw > W - 6) bx = anchored ? W - bw - 6 : ax - bw - 14;
    if (bx < 6) bx = 6;
    if (by < 6) by = ay + 18;
    ctx.fillStyle = "rgba(8,14,21,.92)";
    ctx.strokeStyle = "rgba(125,231,255,.5)"; ctx.lineWidth = 1;
    rrect(ctx, bx, by, bw, bh, 7); ctx.fill(); ctx.stroke();
    drawIcon(ctx, bx + padX + ic, by + bh / 2, pk.kind, { size: ic, shadow: false });
    ctx.fillStyle = "#eaf3ff"; ctx.font = "700 13px Fredoka, sans-serif"; ctx.textAlign = "left";
    ctx.fillText(name, bx + padX + ic * 2 + 6, by + (sub ? 16 : 16.5));
    if (sub) {
      ctx.fillStyle = "rgba(178,196,216,.85)"; ctx.font = "600 11px Fredoka, sans-serif";
      ctx.fillText(sub, bx + padX + ic * 2 + 6, by + 29);
    }
    // a hairline leader back to the icon so there is never any doubt what it names
    ctx.strokeStyle = "rgba(125,231,255,.4)";
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx + bw / 2, by + (by > ay ? 0 : bh)); ctx.stroke();
    ctx.restore();
  }
  // Resolve + draw the single label the player asked for. Desktop = hover;
  // touch has no hover, so it is the icon the last tap SELECTED (world-anchored,
  // so it stays glued to its icon while you pan and zoom).
  function drawHoverTip(p) {
    if (!ICONS_V2()) return;
    if (CBZ.touchMode) {
      const s = map._sel; if (!s) return;
      const x = p.x(s.wx), y = p.z(s.wz);
      if (x < -40 || x > W + 40 || y < -40 || y > H + 40) return;
      drawMapTip(s, x, y - (s.r || 9), true);
      return;
    }
    const cur = map._cursor; if (!cur) return;
    const pk = pickAt(cur.x, cur.y); if (!pk) return;
    // ring the icon being named so the pairing is unambiguous
    ctx.save();
    ctx.strokeStyle = "rgba(125,231,255,.85)"; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(pk.x, pk.y, pk.r + 3, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    drawMapTip(pk, pk.x, pk.y, false);
  }

  // ---- THE RATCHET -----------------------------------------------------------
  // `labels` = permanent text runs on the map surface (place names, region
  // names, owner tags). `overlaps` = how many of those were drawn on top of
  // another one. Both may only ever go DOWN. `icons`/`hoverable` are the
  // replacement capability and are reported beside them so a "fix" that simply
  // draws nothing at all cannot pass.
  CBZ.mapAudit = function (opts) {
    if ((!opts || opts.draw !== false) && !map.active) { try { draw(); } catch (e) {} }
    const kinds = {};
    for (let i = 0; i < map._picks.length; i++) kinds[map._picks[i].kind] = (kinds[map._picks[i].kind] || 0) + 1;
    return {
      icons: stats.icons, labels: stats.labels, overlaps: stats.overlaps,
      hoverable: stats.hoverable, merged: stats.merged, skipped: stats.skipped,
      furniture: stats.furniture, plateLabels: stats.plate,
      kinds: Object.keys(kinds).length, mode: stats.mode, zoom: +stats.zoom.toFixed(2),
      iconsV2: ICONS_V2(),
    };
  };
  // ---- BIOME PALETTE: every island/biome region paints with a land fill + a
  // coastline edge so the archipelago reads as REAL ground floating on a sea,
  // not a tiny blob in a black void. WHY: the city is one island among many
  // (desert, forest, snow, speedway, airport, military, farmland) and the map
  // is the only place you see how they connect — so each must be a recognisable
  // shape with its own terrain colour, the way GTA/RDR2 colour their biomes.
  const BIOME_FILL = {
    city: { fill: "#3d4859", edge: "#93a7c4" },
    commerce: { fill: "#3e4c3a", edge: "#a7c186" },
    wilds: { fill: "#526f43", edge: "#89a66d" },
    speedway: { fill: "#4a4150", edge: "#c99a66" },
    airport: { fill: "#3a3f4a", edge: "#98a3b5" },
    military: { fill: "#414833", edge: "#7e8f5a" },
    desert: { fill: "#6e5c39", edge: "#eccf92" },
    forest: { fill: "#2e4a31", edge: "#6f9a58" },
    farmland: { fill: "#57532e", edge: "#c9b264" },
    snow: { fill: "#697585", edge: "#eef4fa" },
    _default: { fill: "#3d4859", edge: "#93a7c4" },
  };
  function biomePal(b) { return BIOME_FILL[b] || BIOME_FILL._default; }
  map.biomePal = biomePal;

  // ============================================================
  //  CARTOGRAPHY KIT — the visual language that makes the map read like a
  //  hand-finished chart instead of flat programmer-art rectangles.
  //  Every landmass gets: a drop shadow on the sea, shallow-water bands, an
  //  ORGANIC coastline (deterministic noise wobbles the rect/circle outline so
  //  islands look surveyed, not stamped), a sunlit gradient fill, an inner
  //  beach ring, a biome texture (dunes / trees / field strips / snow / the
  //  speedway's actual track ring / an airport runway), then surf + edge
  //  strokes. All of it bakes into the static plates once per open, so the
  //  live 12fps composite cost is unchanged.
  // ============================================================
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  // smooth periodic noise around a coast: a few random-phase harmonics, seeded
  // by the region's name so the same island always wobbles the same way.
  function coastNoise(seed) {
    const R = makeRng(seed), h = [];
    for (let i = 0; i < 5; i++) h.push({ f: 2 + i * 2 + ((R() * 2) | 0), a: 1 / (i + 1.5), p: R() * Math.PI * 2 });
    return function (t) {
      let v = 0;
      for (const k of h) v += Math.sin(t * Math.PI * 2 * k.f + k.p) * k.a;
      return v * 0.34;   // ≈ [-1, 1]
    };
  }
  let coastCache = new Map();   // region → Path2D, cleared on every plate bake
  function regionGeo(rg) {
    if (rg.kind === "circle") return { cx: rg.cx, cz: rg.cz, hx: rg.r, hz: rg.r, round: 1 };
    return {
      cx: (rg.minX + rg.maxX) / 2, cz: (rg.minZ + rg.maxZ) / 2,
      hx: (rg.maxX - rg.minX) / 2, hz: (rg.maxZ - rg.minZ) / 2, round: 0.72,
    };
  }
  // ---- THE DRAWN COAST IS THE REAL ONE (BIOME_ORGANIC_EDGES) --------------
  // A natural biome's functional edge is a domain-warped contour, not its
  // rect (city/worldmap.js cityBiomeAt). This outline used to be a
  // superellipse with a 5.5% cosmetic wobble — decorative irregularity over
  // a shape the world no longer uses, so the chart and the ground disagreed
  // about where the desert stops. Where the biome declared an organic
  // footprint we trace the SAME field the world reads, at the SAME 0.42
  // threshold, so a player reading the map is reading the terrain.
  function coastSpecFor(rg) {
    if (CBZ.CONFIG && CBZ.CONFIG.BIOME_ORGANIC_EDGES === false) return null;
    if (!CBZ.biomeBlendWeightAt || !rg || !rg.biome || rg.kind === "circle") return null;
    const A = CBZ.city && CBZ.city.arena;
    const specs = (A && A.biomeBlends) || CBZ._biomeBlendSpecs;
    if (!specs) return null;
    for (let i = 0; i < specs.length; i++) if (specs[i] && specs[i].biome === rg.biome) return specs[i];
    return null;
  }
  // How far out along this bearing does the biome still win? Bisection on the
  // live weight, floored at the rect (worldmap's law: the authored floor mesh
  // is always its own biome, so the drawn coast may bulge OUT of the rect and
  // never bite into it) and capped at 1.55x so a biome whose land-cover spread
  // runs for kilometres still draws as a landmass and not a smear over its
  // neighbours — the FILL layer already carries the full spread.
  const COAST_REACH = 1.55, COAST_STEPS = 9;
  function coastOut(spec, cx, cz, ux, uz, hx, hz) {
    function w(m) { return CBZ.biomeBlendWeightAt(spec, cx + ux * hx * m, cz + uz * hz * m); }
    if (w(COAST_REACH) >= 0.42) return COAST_REACH;
    if (w(1) < 0.42) return 1;
    let lo = 1, hi = COAST_REACH;
    for (let k = 0; k < COAST_STEPS; k++) {
      const mid = (lo + hi) * 0.5;
      if (w(mid) >= 0.42) lo = mid; else hi = mid;
    }
    return lo;
  }
  function coastPath(rg, p) {
    let path = coastCache.get(rg);
    if (path) return path;
    const g = regionGeo(rg);
    const noise = coastNoise(hashStr(rg.name || rg.biome || (g.cx + "," + g.cz)));
    const spec = coastSpecFor(rg);
    const N = 150;
    path = new Path2D();
    for (let i = 0; i <= N; i++) {
      const t = (i % N) / N, a = t * Math.PI * 2;
      const co = Math.cos(a), si = Math.sin(a);
      // superellipse: round=1 → circle, round≈0.72 → rounded rectangle
      const ux = Math.sign(co) * Math.pow(Math.abs(co), g.round);
      const uz = Math.sign(si) * Math.pow(Math.abs(si), g.round);
      // biased outward so edge POIs stay on land; the traced contour supplies
      // its own irregularity, so the cosmetic wobble is only the fallback's.
      const wob = spec ? coastOut(spec, g.cx, g.cz, ux, uz, g.hx, g.hz)
        : 1 + 0.055 * (noise(t) + 0.18);
      const x = p.x(g.cx + ux * g.hx * wob), y = p.z(g.cz + uz * g.hz * wob);
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    }
    path.closePath();
    coastCache.set(rg, path);
    return path;
  }
  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(hex, f, a) {   // f>0 lighten toward white, f<0 darken
    const c = hexRgb(hex).map(function (v) { return Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)); });
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + (a == null ? 1 : a) + ")";
  }

  // ---- REAL TERRAIN BASEMAP -----------------------------------------------
  // Sample the exact coast field exported by continent.js and the same real
  // ground-height oracle used by player physics.  This is a cached plate bake,
  // so a ~3px raster costs nothing while the map is open.  Negative coast
  // distance becomes real shallow/deep water; dry land gets biome colour, a
  // sand edge and 20m elevation bands.  No roads, synthetic coast rectangles
  // or backdrop terrain functions enter this map.
  function drawTerrainBasemap(A, p) {
    const mt = A && A.mapTerrain;
    if (!mt || typeof mt.shoreAt !== "function") return false;
    const regs = A.regions || [];
    const STEP = 3;
    const img = ctx.createImageData(W, H), data = img.data;
    const x0 = Math.max(0, Math.floor(p.x(p.bounds.minX)));
    const x1 = Math.min(W, Math.ceil(p.x(p.bounds.maxX)));
    const y0 = Math.max(0, Math.floor(p.z(p.bounds.minZ)));
    const y1 = Math.min(H, Math.ceil(p.z(p.bounds.maxZ)));
    const sand = [170, 156, 108], high = [224, 230, 232];
    const shallow = [39, 126, 143], shelf = [18, 70, 96], deep = [7, 31, 51];
    const wild = hexRgb(BIOME_FILL.wilds.fill);
    const natural = { desert: 1, forest: 1, farmland: 1, snow: 1 };

    function mix(a, b, t) { return Math.round(a + (b - a) * t); }
    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
    function smooth01(v) { v = clamp01(v); return v * v * (3 - 2 * v); }

    // Position-hash value noise: deterministic, allocation-free and independent
    // of worldgen RNG streams. It shades LAND COVER only; elevation and contour
    // placement continue to come exclusively from A.groundHeightAt below.
    function hash2(ix, iz, salt) {
      let h = Math.imul(ix | 0, 0x1f123bb5) ^ Math.imul(iz | 0, 0x5f356495) ^ (salt | 0);
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
      h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
      return ((h ^ (h >>> 15)) >>> 0) / 4294967295;
    }
    function coverNoise(x, z, cell, salt) {
      const gx = x / cell, gz = z / cell;
      const ix = Math.floor(gx), iz = Math.floor(gz);
      const fx = smooth01(gx - ix), fz = smooth01(gz - iz);
      const a = hash2(ix, iz, salt), b = hash2(ix + 1, iz, salt);
      const c = hash2(ix, iz + 1, salt), d = hash2(ix + 1, iz + 1, salt);
      return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
    }
    function signedRegionDistance(r, x, z) {
      if (r.kind === "circle") return r.r + (r.pad || 0) - Math.hypot(x - r.cx, z - r.cz);
      const pad = r.pad || 0;
      const minX = r.minX - pad, maxX = r.maxX + pad;
      const minZ = r.minZ - pad, maxZ = r.maxZ + pad;
      const ox = Math.max(minX - x, 0, x - maxX);
      const oz = Math.max(minZ - z, 0, z - maxZ);
      if (ox || oz) return -Math.hypot(ox, oz);
      return Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
    }

    // Natural biome records are authored as rectangles for gameplay. Convert
    // each to a soft, warped influence for cartography so no rectangular zoning
    // plate survives on the terrain map. Facilities and settlements stay labels.
    const covers = [];
    const registeredBlends = (A && A.biomeBlends) || [];
    if (registeredBlends.length && CBZ.biomeBlendWeightAt) {
      // Use the exact world land-cover oracle: the map and the rendered earth
      // now share the same enlarged, irregular biome boundaries.
      for (let i = 0; i < registeredBlends.length; i++) {
        const s = registeredBlends[i];
        if (!s || !natural[s.biome]) continue;
        covers.push({ spec: s, biome: s.biome, rgb: hexRgb(biomePal(s.biome).fill) });
      }
    } else for (let i = 0; i < regs.length; i++) {
      const r = regs[i];
      if (!r || r.underlay || isLink(r) || !natural[r.biome]) continue;
      const spanX = r.kind === "circle" ? r.r * 2 : r.maxX - r.minX;
      const spanZ = r.kind === "circle" ? r.r * 2 : r.maxZ - r.minZ;
      covers.push({
        r: r, biome: r.biome, rgb: hexRgb(biomePal(r.biome).fill),
        salt: hashStr((r.name || r.biome) + "#cover"),
        feather: Math.max(52, Math.min(118, Math.min(spanX, spanZ) * 0.14)),
      });
    }

    function landCoverAt(x, z) {
      // Broad temperate variation keeps the continent from becoming a single
      // flat green fill: greener hollows, dry scrub and loam are colour texture,
      // not invented relief.
      const broad = coverNoise(x, z, 330, 0x41a7);
      const mid = coverNoise(x, z, 92, 0x73d1);
      let r = wild[0] + (broad - 0.5) * 25 + (mid - 0.5) * 8;
      let g = wild[1] + (broad - 0.5) * 12 + (mid - 0.5) * 10;
      let b = wild[2] - (broad - 0.5) * 10 + (mid - 0.5) * 5;
      let sum = 0, rr = 0, gg = 0, bb = 0;
      let forest = 0, farm = 0, desert = 0, snow = 0;
      for (let i = 0; i < covers.length; i++) {
        const c = covers[i], f = c.feather || 80;
        let w;
        if (c.spec && CBZ.biomeBlendWeightAt) {
          w = CBZ.biomeBlendWeightAt(c.spec, x, z);
        } else {
          // Legacy fallback for builds that have no world blend registry.
          const wx = (coverNoise(x, z, 230, c.salt) - 0.5) * f * 1.25;
          const wz = (coverNoise(x, z, 230, c.salt ^ 0x6d2b79f5) - 0.5) * f * 1.25;
          const edge = (coverNoise(x, z, 76, c.salt ^ 0x27d4eb2d) - 0.5) * f * 0.7;
          const d = signedRegionDistance(c.r, x + wx, z + wz) + edge;
          w = smooth01((d + f) / (f * 2));
        }
        if (w <= 0.001) continue;
        const ww = w * w; // deep biome owns its hue; feather stays understated
        sum += ww; rr += c.rgb[0] * ww; gg += c.rgb[1] * ww; bb += c.rgb[2] * ww;
        if (c.biome === "forest") forest += ww;
        else if (c.biome === "farmland") farm += ww;
        else if (c.biome === "desert") desert += ww;
        else if (c.biome === "snow") snow += ww;
      }
      if (sum > 0) {
        const t = smooth01(Math.min(1, sum));
        r += (rr / sum - r) * t; g += (gg / sum - g) * t; b += (bb / sum - b) * t;
      }

      // Biome-specific MICRO texture is blended by the same organic influence.
      // It reads as canopy/field/dune/scree grain, never as a symbol or icon.
      const denom = Math.max(1, sum);
      const fw = Math.min(1, forest / denom), aw = Math.min(1, farm / denom);
      const dw = Math.min(1, desert / denom), sw = Math.min(1, snow / denom);
      const canopy = coverNoise(x, z, 34, 0x18b3);
      const fields = 0.5 + 0.5 * Math.sin(x * 0.032 + z * 0.009 + coverNoise(x, z, 150, 0x99e1) * 2.4);
      const dunes = 0.5 + 0.5 * Math.sin(x * 0.022 - z * 0.013 + coverNoise(x, z, 180, 0x5a17) * 3.2);
      let grain = 0.96 + (mid - 0.5) * 0.12;
      grain *= 1 + fw * ((canopy - 0.5) * 0.25 - 0.04);
      grain *= 1 + aw * ((fields - 0.5) * 0.12);
      grain *= 1 + dw * ((dunes - 0.5) * 0.1);
      grain *= 1 + sw * ((canopy - 0.5) * 0.08);
      return { r: r * grain, g: g * grain, b: b * grain };
    }

    for (let py = y0; py < y1; py += STEP) {
      const wz = p.wz(py + STEP * 0.5);
      for (let px = x0; px < x1; px += STEP) {
        const wx = p.wx(px + STEP * 0.5);
        let shore;
        try { shore = +mt.shoreAt(wx, wz); } catch (e) { shore = -1; }
        if (!(shore >= 0)) {
          // shoreAt is a signed distance-like field.  Its negative magnitude
          // is therefore useful bathymetry: turquoise at the beach, blue on
          // the shelf and dark water offshore.  This is the exact playable
          // coast, not an invented island outline.
          const d = Number.isFinite(shore) ? Math.max(0, -shore) : 999;
          const t0 = Math.min(1, d / 90);
          const t1 = Math.min(1, Math.max(0, (d - 90) / 260));
          let r = mix(shallow[0], shelf[0], t0);
          let g = mix(shallow[1], shelf[1], t0);
          let b = mix(shallow[2], shelf[2], t0);
          r = mix(r, deep[0], t1); g = mix(g, deep[1], t1); b = mix(b, deep[2], t1);
          const waterGrain = 0.97 + coverNoise(wx, wz, 135, 0x2ad5) * 0.055;
          r = Math.round(r * waterGrain); g = Math.round(g * waterGrain); b = Math.round(b * waterGrain);
          // Subtle 50m depth contours make the water navigable without wave
          // doodles or fake roads. Keep them narrow so they remain terrain.
          if (d > 18 && d % 50 < 3.5) { r = Math.round(r * 1.12); g = Math.round(g * 1.12); b = Math.round(b * 1.12); }
          for (let oy = 0; oy < STEP && py + oy < H; oy++) {
            for (let ox = 0; ox < STEP && px + ox < W; ox++) {
              const q = ((py + oy) * W + px + ox) * 4;
              data[q] = r; data[q + 1] = g; data[q + 2] = b; data[q + 3] = 255;
            }
          }
          continue;
        }
        const cover = landCoverAt(wx, wz);
        let r = cover.r, g = cover.g, b = cover.b;
        if (shore < 16) {
          const t = smooth01(shore / 16);
          r = mix(sand[0], r, t); g = mix(sand[1], g, t); b = mix(sand[2], b, t);
        }
        const h = A.groundHeightAt ? Math.max(0, +A.groundHeightAt(wx, wz) || 0) : 0;
        if (h > 0.5) {
          const t = Math.min(0.88, h / 180);
          r = mix(r, high[0], t); g = mix(g, high[1], t); b = mix(b, high[2], t);
          // Real-height hillshade (light from NW) gives the massif form between
          // its exact 20m contours. No procedural/backdrop height enters here.
          const eps = 12;
          const hW = Math.max(0, +A.groundHeightAt(wx - eps, wz) || 0);
          const hE = Math.max(0, +A.groundHeightAt(wx + eps, wz) || 0);
          const hN = Math.max(0, +A.groundHeightAt(wx, wz - eps) || 0);
          const hS = Math.max(0, +A.groundHeightAt(wx, wz + eps) || 0);
          let k = Math.max(0.72, Math.min(1.2, 0.98 + (hW - hE + hS - hN) * 0.008));
          const rem = h % 20, contour = Math.min(rem, 20 - rem);
          if (contour < 2.4) k *= 0.72;
          r = Math.max(0, Math.min(255, Math.round(r * k)));
          g = Math.max(0, Math.min(255, Math.round(g * k)));
          b = Math.max(0, Math.min(255, Math.round(b * k)));
        }
        for (let oy = 0; oy < STEP && py + oy < H; oy++) {
          for (let ox = 0; ox < STEP && px + ox < W; ox++) {
            const q = ((py + oy) * W + px + ox) * 4;
            data[q] = r; data[q + 1] = g; data[q + 2] = b; data[q + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return true;
  }
  // pass 1 (UNDER): shadow + shallow-water halo for every landmass FIRST, so
  // no island's glow smears over a neighbour's finished land.
  function paintLandUnder(rg, p) {
    const path = coastPath(rg, p);
    ctx.save();
    ctx.translate(3, 4);
    ctx.fillStyle = "rgba(2,8,14,.42)";
    ctx.fill(path);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = "rgba(110,190,215,.06)"; ctx.lineWidth = 26; ctx.stroke(path);
    ctx.strokeStyle = "rgba(130,205,230,.10)"; ctx.lineWidth = 12; ctx.stroke(path);
    ctx.restore();
  }
  // pass 2 (TOP): the land itself — gradient fill, inner beach ring, biome
  // texture, then coastline + surf strokes.
  function paintLandTop(rg, p, biome) {
    const path = coastPath(rg, p), pal = biomePal(biome), g = regionGeo(rg);
    const grad = ctx.createLinearGradient(p.x(g.cx - g.hx), p.z(g.cz - g.hz), p.x(g.cx + g.hx), p.z(g.cz + g.hz));
    grad.addColorStop(0, shade(pal.fill, 0.14));
    grad.addColorStop(1, shade(pal.fill, -0.16));
    ctx.fillStyle = grad;
    ctx.fill(path);
    ctx.save();
    ctx.clip(path);
    ctx.strokeStyle = "rgba(216,196,140,.42)"; ctx.lineWidth = 8; ctx.stroke(path);   // beach ring just inside the coast
    biomeTexture(rg, p, biome, g);
    ctx.restore();
    ctx.strokeStyle = shade(pal.edge, 0, 0.55); ctx.lineWidth = 2.6; ctx.stroke(path);
    ctx.strokeStyle = "rgba(236,248,255,.5)"; ctx.lineWidth = 1.1; ctx.stroke(path);  // surf line
  }
  // per-biome land detail, drawn clipped inside the coast. Seeded per region,
  // so it never shimmers between bakes.
  function biomeTexture(rg, p, biome, g) {
    const R = makeRng(hashStr((rg.name || biome || "x") + "#tex"));
    const rx = function () { return g.cx + (R() * 2 - 1) * g.hx * 0.92; };
    const rz = function () { return g.cz + (R() * 2 - 1) * g.hz * 0.92; };
    if (biome === "desert") {
      // wind-combed dune crescents in two tones (sun side / shade side)
      for (let i = 0; i < 80; i++) {
        const x = p.x(rx()), y = p.z(rz()), r = 3 + R() * 7;
        ctx.strokeStyle = R() < 0.7 ? "rgba(235,210,150,.13)" : "rgba(70,55,30,.14)";
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
      }
    } else if (biome === "forest") {
      for (let i = 0; i < 150; i++) {
        const x = p.x(rx()), y = p.z(rz());
        ctx.fillStyle = R() < 0.5 ? "rgba(30,64,34,.30)" : "rgba(96,150,84,.20)";
        ctx.beginPath(); ctx.arc(x, y, 1 + R() * 1.8, 0, Math.PI * 2); ctx.fill();
      }
    } else if (biome === "snow") {
      const sg = ctx.createRadialGradient(p.x(g.cx), p.z(g.cz), 4, p.x(g.cx), p.z(g.cz), Math.max(g.hx, g.hz) * p.sc);
      sg.addColorStop(0, "rgba(255,255,255,.34)"); sg.addColorStop(1, "rgba(255,255,255,.04)");
      ctx.fillStyle = sg;
      ctx.fillRect(p.x(g.cx - g.hx), p.z(g.cz - g.hz), g.hx * 2 * p.sc, g.hz * 2 * p.sc);
      for (let i = 0; i < 46; i++) {   // little ridge/peak marks
        const x = p.x(rx()), y = p.z(rz());
        ctx.strokeStyle = "rgba(160,180,205,.35)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x - 3, y + 1.5); ctx.lineTo(x, y - 2); ctx.lineTo(x + 3, y + 1.5); ctx.stroke();
      }
    } else if (biome === "farmland") {
      // patchwork field strips + hedgerows
      const step = 16;
      for (let wz = g.cz - g.hz; wz < g.cz + g.hz; wz += step) {
        ctx.fillStyle = ((wz / step) | 0) % 2 ? "rgba(205,185,95,.10)" : "rgba(120,145,60,.10)";
        ctx.fillRect(p.x(g.cx - g.hx), p.z(wz), g.hx * 2 * p.sc, step * p.sc);
      }
      for (let i = 0; i < 12; i++) {
        const x = p.x(g.cx + (R() * 2 - 1) * g.hx * 0.9);
        ctx.strokeStyle = "rgba(50,70,35,.22)"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x, p.z(g.cz - g.hz * (0.3 + R() * 0.6))); ctx.lineTo(x, p.z(g.cz + g.hz * (0.3 + R() * 0.6))); ctx.stroke();
      }
    } else if (biome === "speedway") {
      // the island IS a racetrack — draw its ring + start/finish gate
      const cx = p.x(g.cx), cy = p.z(g.cz), r = g.hx * 0.62 * p.sc, half = Math.max(2, g.hx * 0.085 * p.sc);
      ctx.strokeStyle = "rgba(26,30,38,.72)"; ctx.lineWidth = half * 2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "rgba(235,240,248,.35)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, r - half, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r + half, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "rgba(240,244,250,.55)";
      ctx.fillRect(cx - 2, cy - r - half, 4, half * 2);
    } else if (biome === "airport") {
      const cx = p.x(g.cx), cy = p.z(g.cz), len = g.hx * 1.35 * p.sc, wid = Math.max(4, g.hz * 0.16 * p.sc);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.12);
      ctx.fillStyle = "rgba(30,34,42,.7)"; ctx.fillRect(-len / 2, -wid / 2, len, wid);
      ctx.strokeStyle = "rgba(240,244,250,.4)"; ctx.lineWidth = 1.4; ctx.setLineDash([7, 7]);
      ctx.beginPath(); ctx.moveTo(-len / 2 + 4, 0); ctx.lineTo(len / 2 - 4, 0); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
    } else if (biome === "military") {
      for (let i = 0; i < 26; i++) {   // camo blotches
        const x = p.x(rx()), y = p.z(rz()), r2 = 2 + R() * 5;
        ctx.fillStyle = R() < 0.5 ? "rgba(60,72,40,.25)" : "rgba(35,42,26,.25)";
        ctx.beginPath(); ctx.arc(x, y, r2, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      // urban (city/commerce/default): quiet tonal blocks so the concrete
      // isn't one dead flat — roads and lots draw the real detail on top.
      for (let i = 0; i < 34; i++) {
        const x = p.x(rx()), y = p.z(rz()), w2 = (4 + R() * 16) * p.sc, d2 = (4 + R() * 16) * p.sc;
        ctx.fillStyle = R() < 0.5 ? "rgba(255,255,255,.025)" : "rgba(0,0,0,.05)";
        ctx.fillRect(x - w2 / 2, y - d2 / 2, w2, d2);
      }
    }
  }
  // the sea: depth gradient + a fixed field of pre-seeded wave glyphs (seeded,
  // not Math.random-per-frame, so the water doesn't shimmer at the 12fps redraw).
  const WAVES = (function () { const R = makeRng(52413), a = []; for (let i = 0; i < 110; i++) a.push({ x: R(), y: R(), r: 3 + R() * 6 }); return a; })();
  function drawOcean() {
    const og = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, Math.max(W, H) * 0.62);
    og.addColorStop(0, "#16374f");
    og.addColorStop(0.7, "#0f2a3e");
    og.addColorStop(1, "#0a1f30");
    ctx.fillStyle = og; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(170,215,235,.055)"; ctx.lineWidth = 1;
    for (const wv of WAVES) {
      const x = wv.x * W, y = wv.y * H;
      ctx.beginPath(); ctx.arc(x, y, wv.r, Math.PI * 0.12, Math.PI * 0.88); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + wv.r * 1.7, y, wv.r * 0.7, Math.PI * 0.12, Math.PI * 0.88); ctx.stroke();
    }
  }
  // chart furniture: vignette, compass rose, scale bar.
  function drawVignette() {
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.30)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }
  function drawCompassRose() {
    const cx = W - 46, cy = 48, r = 24;
    ctx.save();
    ctx.strokeStyle = "rgba(223,240,255,.35)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 8; i++) {   // 8-point star: long cardinals, short diagonals
      const a = i * Math.PI / 4 - Math.PI / 2, len = i % 2 ? r * 0.4 : r * 0.92, wid = i % 2 ? 2.4 : 3.6;
      ctx.fillStyle = i % 2 ? "rgba(160,190,210,.5)" : "rgba(228,242,255,.85)";
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.lineTo(cx + Math.cos(a + Math.PI / 2) * wid, cy + Math.sin(a + Math.PI / 2) * wid);
      ctx.lineTo(cx + Math.cos(a - Math.PI / 2) * wid, cy + Math.sin(a - Math.PI / 2) * wid);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = "#ffd451"; ctx.font = "800 12px Fredoka, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("N", cx, cy - r - 5); stats.furniture++;
    ctx.restore();
  }
  function drawScaleBar(p) {
    let m = 100;
    for (const cand of [25, 50, 100, 200, 400, 800, 1600]) { m = cand; if (cand * p.sc >= 70) break; }
    const px = m * p.sc, x0 = 22, y0 = H - 24, seg = px / 4;
    ctx.save();
    ctx.fillStyle = "rgba(8,16,24,.55)";
    ctx.fillRect(x0 - 8, y0 - 18, px + 50, 30);
    for (let i = 0; i < 4; i++) {   // classic alternating survey bar
      ctx.fillStyle = i % 2 ? "rgba(230,240,250,.85)" : "rgba(40,52,64,.9)";
      ctx.fillRect(x0 + seg * i, y0 - 3, seg, 5);
    }
    ctx.strokeStyle = "rgba(230,240,250,.7)"; ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0 - 3, px, 5);
    ctx.fillStyle = "rgba(230,240,250,.85)"; ctx.font = "700 10px Fredoka, sans-serif"; ctx.textAlign = "left";
    ctx.fillText(m + " m", x0 + px + 7, y0 + 2); stats.furniture++;
    ctx.restore();
  }
  // Only explicitly named links are links. `pad<=1` used to misclassify the
  // continent's five underlay bands as roads, creating the giant grey/yellow
  // bars seen on the map.
  function isLink(rg) { return /causeway|bridge|link/i.test(rg.name || ""); }
  function regionCentroid(rg) {
    if (rg.kind === "circle") return { x: rg.cx, z: rg.cz };
    return { x: (rg.minX + rg.maxX) * 0.5, z: (rg.minZ + rg.maxZ) * 0.5 };
  }
  function fillRegion(rg, p, color) {
    ctx.fillStyle = color;
    if (rg.kind === "circle") { ctx.beginPath(); ctx.arc(p.x(rg.cx), p.z(rg.cz), rg.r * p.sc, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(p.x(rg.minX), p.z(rg.minZ), (rg.maxX - rg.minX) * p.sc, (rg.maxZ - rg.minZ) * p.sc);
  }
  function strokeRegion(rg, p, color, w) {
    ctx.strokeStyle = color; ctx.lineWidth = w || 1.5;
    if (rg.kind === "circle") { ctx.beginPath(); ctx.arc(p.x(rg.cx), p.z(rg.cz), rg.r * p.sc, 0, Math.PI * 2); ctx.stroke(); }
    else ctx.strokeRect(p.x(rg.minX), p.z(rg.minZ), (rg.maxX - rg.minX) * p.sc, (rg.maxZ - rg.minZ) * p.sc);
  }
  // ---- ROUNDED land helpers: soften the hard rectangles so islands read like
  // shaped landmasses, not boxes. Circles are already round, so these only round
  // rects (radius ~ 12% of the shorter on-screen edge, clamped). r128's
  // ctx.roundRect is used when present, with a manual arc fallback.
  function roundRectPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function landRadius(rg, p) {
    const w = (rg.maxX - rg.minX) * p.sc, h = (rg.maxZ - rg.minZ) * p.sc;
    return Math.max(4, Math.min(w, h) * 0.12);
  }
  function fillRegionRounded(rg, p, color) {
    if (rg.kind === "circle") return fillRegion(rg, p, color);
    ctx.fillStyle = color;
    roundRectPath(p.x(rg.minX), p.z(rg.minZ), (rg.maxX - rg.minX) * p.sc, (rg.maxZ - rg.minZ) * p.sc, landRadius(rg, p));
    ctx.fill();
  }
  function strokeRegionRounded(rg, p, color, w) {
    if (rg.kind === "circle") return strokeRegion(rg, p, color, w);
    ctx.strokeStyle = color; ctx.lineWidth = w || 1.5;
    roundRectPath(p.x(rg.minX), p.z(rg.minZ), (rg.maxX - rg.minX) * p.sc, (rg.maxZ - rg.minZ) * p.sc, landRadius(rg, p));
    ctx.stroke();
  }

  // ---- HIGHWAY CASING: draw a link region (causeway/bridge) as a real ROAD —
  // a line down its long axis, stroked twice (dark casing + light asphalt) with
  // round caps so it reads as connected tarmac, plus a dashed yellow centerline.
  // Endpoints are pushed ~extend world-units past the rect toward the land each
  // end touches, so the highway visibly meets both shores instead of floating.
  // (ax,az)-(bx,bz) are WORLD coords; widthWorld = the road's world width.
  function drawHighway(ax, az, bx, bz, widthWorld, p, dashed) {
    const x1 = p.x(ax), y1 = p.z(az), x2 = p.x(bx), y2 = p.z(bz);
    const wide = Math.max(5, widthWorld * p.sc);
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(20,28,36,.85)"; ctx.lineWidth = wide;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = "rgba(150,160,176,.95)"; ctx.lineWidth = wide * 0.65;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    if (dashed !== false && wide > 9) {
      ctx.strokeStyle = "rgba(240,210,90,.5)"; ctx.lineWidth = Math.max(1, wide * 0.06);
      ctx.setLineDash([6, 7]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.restore();
  }
  // a link region's centerline endpoints (midpoints of its two short edges) +
  // its short-axis world width. Returns {ax,az,bx,bz,wWorld,horiz}.
  function linkAxis(rg) {
    if (rg.kind === "circle") {
      return { ax: rg.cx - rg.r, az: rg.cz, bx: rg.cx + rg.r, bz: rg.cz, wWorld: rg.r * 2, horiz: true };
    }
    const w = rg.maxX - rg.minX, h = rg.maxZ - rg.minZ, cx = (rg.minX + rg.maxX) / 2, cz = (rg.minZ + rg.maxZ) / 2;
    if (w >= h) return { ax: rg.minX, az: cz, bx: rg.maxX, bz: cz, wWorld: h, horiz: true };
    return { ax: cx, az: rg.minZ, bx: cx, bz: rg.maxZ, wWorld: w, horiz: false };
  }
  // push a causeway endpoint outward (away from the region centre) until it
  // lands on the nearest non-link land region / the mainland — so the highway
  // visibly TOUCHES the shore it connects. Falls back to a fixed extension.
  function snapEndpointToLand(ex, ez, cx, cz, regions, mainland) {
    let dx = ex - cx, dz = ez - cz; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    let best = null, bestT = Infinity;
    const cands = (regions || []).filter(function (r) { return !isLink(r) && !r.underlay; });
    if (mainland) cands.push(mainland);
    for (const r of cands) {
      // march outward a short way to find where this ray first hits a landmass
      for (let t = 0; t <= 60; t += 2) {
        const px = ex + dx * t, pz = ez + dz * t;
        const hit = r.kind === "circle"
          ? Math.hypot(px - r.cx, pz - r.cz) <= r.r + (r.pad || 2)
          : (px >= r.minX - (r.pad || 2) && px <= r.maxX + (r.pad || 2) && pz >= r.minZ - (r.pad || 2) && pz <= r.maxZ + (r.pad || 2));
        if (hit) { if (t < bestT) { bestT = t; best = { x: px, z: pz }; } break; }
      }
    }
    if (best) return best;
    return { x: ex + dx * 6, z: ez + dz * 6 };   // fallback: small fixed nudge onto the gap
  }

  function poiInfo(lot) {
    const b = lot.building; if (!b) return null;
    const home = CBZ.game.cityHome;
    if ((home && home.lot === lot) || (b.home && b.home.owned)) return { color: "#39ff88", label: "HOME", key: true };
    const k = (b.shop && b.shop.kind) || lot.kind;
    if (POI_KINDS[k]) return { color: POI_KINDS[k], label: b.name || k };
    return null;
  }
  // A point of interest. With MAP_ICONS_V2 it is a PICTOGRAM badge (kind at a
  // glance); with the flag off it falls back to the old colour-only diamond, so
  // the revert really is one line.
  function drawPoi(x, z, p, color, label, key, kind) {
    const mx = p.x(x), mz = p.z(z), s = key ? 7 : 5;
    if (ICONS_V2() && !bakeMode) {   // never bake a fixed-size glyph onto a zoom-scaled plate
      drawIcon(ctx, mx, mz, kind || (key ? "home" : "_default"), { size: key ? 8.5 : 7, tier: !!key, color: kind ? null : color });
      stats.icons++;
      if (label) mapLabel(label, mx, mz - (key ? 12 : 10), { size: key ? 12 : 10, fill: key ? "#bfffd9" : "rgba(244,250,255,.96)", force: true });
      return;
    }
    ctx.fillStyle = color; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(mx, mz - s); ctx.lineTo(mx + s, mz); ctx.lineTo(mx, mz + s); ctx.lineTo(mx - s, mz); ctx.closePath();
    ctx.fill(); ctx.stroke();
    stats.icons++;
    if (label) {
      mapLabel(label, mx, mz - s - 3, { size: key ? 12 : 10, fill: key ? "#bfffd9" : "rgba(244,250,255,.96)", force: true });
    }
  }
  function drawPois(lots, p) {
    for (const lot of lots || []) { const info = poiInfo(lot); if (info) drawPoi(lot.cx, lot.cz, p, info.color, info.label, info.key); }
  }
  // glyph-only POIs for the static plate (labels are drawn dynamically + decluttered)
  function drawPoiGlyphs(lots, p) {
    for (const lot of lots || []) { const info = poiInfo(lot); if (info) drawPoi(lot.cx, lot.cz, p, info.color, "", info.key); }
  }
  // ---- LOD + DECLUTTERED POI GLYPHS (MAP_V2) -------------------------------
  // WHY: drawing all ~180 shops at fit-zoom is a rainbow "measles map". So we
  // TIER by zoom (the design-ref LOD rule): zoomed OUT ⇒ only landmarks
  // (casinos/banks/hospital/civic/venues + your HOME); zoomed IN ⇒ every shop.
  // Then a cheap min-distance dedup drops glyphs that would stack into mush.
  // Landmarks and HOME/casinos never dedup away. Drawn live at fixed size.
  function poiKindOf(lot) {
    const b = lot.building;
    return (b && b.shop && b.shop.kind) || lot.kind || null;
  }
  // Screen-space declutter distances. SAME-KIND icons inside MERGE_PX collapse
  // into ONE with a count badge (three pawn shops on a block are one "pawn"
  // pin that says 3, which is more honest than three identical pins). Icons of
  // DIFFERENT kinds inside DROP_PX cannot merge — a bank fused with a hospital
  // would be a lie — so the lower RANK yields instead. Landmarks and your own
  // places never yield.
  const MERGE_PX = 20, DROP_PX = 15;
  function drawCityPoisLive(p, A) {
    const zoomAll = map.view.z >= 1.8;   // zoomed in ⇒ reveal ordinary shops too
    const cands = [];
    const collect = (lots) => {
      for (const lot of lots || []) {
        const info = poiInfo(lot); if (!info) continue;
        const raw = poiKindOf(lot);
        const k = info.key ? "home" : raw;
        const rank = iconSpec(k).r;
        const anchor = info.key || raw === "casino" || rank >= LANDMARK;   // never hidden/deduped
        if (!zoomAll && !anchor) continue;
        const mx = p.x(lot.cx), my = p.z(lot.cz);
        if (mx < -20 || mx > W + 20 || my < -20 || my > H + 20) continue;
        cands.push({ lot: lot, info: info, k: k, raw: raw, rank: rank, anchor: anchor, mx: mx, my: my, count: 1 });
      }
    };
    collect(A.lots); if (A.annex) collect(A.annex.lots);
    if (!ICONS_V2()) {   // legacy: colour-only diamonds, first-come dedup
      const placed = [];
      const near = (x, y, d) => { for (let i = 0; i < placed.length; i++) { const q = placed[i]; if (Math.abs(q.x - x) < d && Math.abs(q.y - y) < d) return true; } return false; };
      for (const c of cands) {
        if (!c.anchor && near(c.mx, c.my, 9)) continue;
        placed.push({ x: c.mx, y: c.my });
        drawPoi(c.lot.cx, c.lot.cz, p, c.info.color, "", c.info.key || c.raw === "casino");
        if (c.raw === "casino") { ctx.strokeStyle = "rgba(201,162,39,.92)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(c.mx, c.my, 8.5, 0, Math.PI * 2); ctx.stroke(); }
      }
      return;
    }
    // Important first: rank decides who survives a collision, and within a rank
    // the icon nearest the middle of what you are looking at wins.
    const ccx = W / 2, ccy = H / 2;
    cands.sort(function (a, b) {
      if (b.rank !== a.rank) return b.rank - a.rank;
      return (Math.hypot(a.mx - ccx, a.my - ccy) - Math.hypot(b.mx - ccx, b.my - ccy));
    });
    const placed = [];
    for (const c of cands) {
      let merge = null, blocked = false;
      for (let i = 0; i < placed.length; i++) {
        const q = placed[i];
        const d = Math.max(Math.abs(q.mx - c.mx), Math.abs(q.my - c.my));
        if (q.k === c.k) { if (d < MERGE_PX) { merge = q; break; } continue; }
        if (!c.anchor && d < DROP_PX) blocked = true;
      }
      if (merge) { merge.count++; stats.merged++; continue; }
      if (blocked) { stats.merged++; continue; }
      placed.push(c);
    }
    const owns = CBZ.cityOwnsLot;
    for (const c of placed) {
      const tier = c.anchor;
      const s = tier ? 8.5 : 7;
      drawIcon(ctx, c.mx, c.my, c.k, { size: s, tier: tier, count: c.count });
      stats.icons++;
      // the NAME lives here now — registered, not printed
      const bits = [iconSpec(c.k).n];
      if (c.count > 1) bits.push("+" + (c.count - 1) + " more nearby");
      if (owns) { try { if (owns(c.lot)) bits.push("yours"); } catch (e) {} }
      pickAdd(c.mx, c.my, s + 2, c.k, c.info.key ? "Home" : (c.info.label || iconSpec(c.k).n), bits.join(" · "), c.lot.cx, c.lot.cz);
    }
  }
  // shared so the corner minimap (city/hud.js) colours shops by the SAME trade
  // palette as the full map — bank=blue, guns=green, hospital=red, HOME=lime…
  map.poi = poiInfo;

  // colour-tint each crew's held blocks, ring its boundary, label its name + drop
  // a diamond on the HQ — so the full map reads as a turf-control map at a glance.
  // O(gangs · lots-held), range-culled by the projection bounds. hex pulled per
  // the contract: '#'+(gang.color>>>0).toString(16) (padded to 6 digits).
  function hex6(c) { return "#" + ("000000" + ((c >>> 0).toString(16))).slice(-6); }
  // The DISTRICT CONTROL board — the city's 9 zones painted by who holds them,
  // like nations on a Risk map. WHY: the meta-goal is "own the city" (districts
  // held), so the map IS the scoreboard, and the coloured borders are the FRONT
  // LINE where turf flips. Fill intensity = control strength; your turf is gold;
  // weakly-held (flipping) districts get a dashed border. Crew HQs sit on top as
  // ringed crests, and a crown marks the takeover leader.
  function drawGangTurf(p) {
    const A = CBZ.city && CBZ.city.arena;
    const zones = CBZ.cityZones ? CBZ.cityZones() : null;
    const leader = CBZ.cityTakeoverLeader ? CBZ.cityTakeoverLeader() : null;
    if (zones && A && zones.length) {
      const zw = (A.maxX - A.minX) / 3, zd = (A.maxZ - A.minZ) / 3;
      for (const z of zones) {
        const isPlayer = z.owner === "player";
        const g = z.owner && !isPlayer && CBZ.cityGangById ? CBZ.cityGangById(z.owner) : null;
        const col = isPlayer ? 0xffd451 : (g ? g.color : 0x46505e);
        const hx = hex6(col), mx = p.x(z.cx), mz = p.z(z.cz);
        const w = zw * p.sc * 0.97, d = zd * p.sc * 0.97;
        ctx.fillStyle = hx; ctx.globalAlpha = z.owner ? (0.1 + 0.3 * (z.strength || 0.4)) : 0.05;
        ctx.fillRect(mx - w / 2, mz - d / 2, w, d);
        ctx.globalAlpha = z.owner ? 0.72 : 0.22; ctx.strokeStyle = hx; ctx.lineWidth = isPlayer ? 2.6 : 1.6;
        ctx.setLineDash(z.owner && (z.strength || 1) < 0.5 ? [6, 5] : []);
        ctx.strokeRect(mx - w / 2, mz - d / 2, w, d); ctx.setLineDash([]); ctx.globalAlpha = 1;
        // WHO holds it, pinned to the zone's top edge like a flag on the line.
        // Under MAP_ICONS_V2 that is a CREST in the crew's colour (the fill and
        // border already carry the colour; the name is one hover away) — nine
        // district names shouting over the geography was nine labels too many.
        if (z.owner) {
          const who = isPlayer ? "Your turf" : (g ? (g.name || "Crew") : "Contested");
          if (ICONS_V2()) {
            const ty = mz - d / 2 + 11;
            drawIcon(ctx, mx, ty, "hq", { size: 6, color: hx, tier: isPlayer }); stats.icons++;
            pickAdd(mx, ty, 7, "hq", who, (z.name ? z.name + " · " : "") + Math.round((z.strength || 0) * 100) + "% hold",
              p.wx(mx), p.wz(ty));
          } else {
            ctx.textAlign = "center"; ctx.fillStyle = hx; ctx.font = "700 9px Fredoka, sans-serif";
            ctx.fillText(isPlayer ? "★ YOURS" : (g ? (g.name || "").toUpperCase() : "CONTESTED"), mx, mz - d / 2 + 13);
            stats.labels++;
          }
        }
      }
    }
    if (!CBZ.cityGangs) return;
    for (const gang of CBZ.cityGangs) {
      if (!gang || gang.absorbed) continue;
      const col = hex6(gang.isPlayer ? 0xffd451 : gang.color);
      const c = gang.center;
      const hq = (CBZ.cityGangHQ && CBZ.cityGangHQ(gang.id)) || (c && (c.x || c.z) ? { x: c.x, z: c.z } : null);
      if (hq && (hq.x || hq.z)) {
        const mx = p.x(hq.x), mz = p.z(hq.z), s = 8;
        const top = leader && leader.id === gang.id;
        if (ICONS_V2()) {
          drawIcon(ctx, mx, mz, "hq", { size: s, color: col, tier: true }); stats.icons++;
          // the crew holding the most districts (the one to beat) gets the star
          if (top) starGlyph(mx, mz - s - 6, 5.4, "#ffd451", true);
          pickAdd(mx, mz, s + 2, "hq", (gang.name || "Crew") + " HQ",
            (gang.isPlayer ? "Your crew" : "Rival crew") + (top ? " · leading the takeover" : ""), hq.x, hq.z);
        } else {
          ctx.fillStyle = col; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(mx, mz - s); ctx.lineTo(mx + s, mz); ctx.lineTo(mx, mz + s); ctx.lineTo(mx - s, mz); ctx.closePath();
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.beginPath(); ctx.arc(mx, mz, 2, 0, Math.PI * 2); ctx.fill();
          if (top) { ctx.fillStyle = "#ffd451"; ctx.font = "700 12px Fredoka, sans-serif"; ctx.textAlign = "center"; ctx.fillText("♛", mx, mz - s - 6); }
        }
      }
    }
  }

  // ---- DISTRICT FIELD on the map: name + busy-ness at a glance ------------
  // WHY: districts have personalities (config CITY.districts — packed Midtown,
  // dead Dockyard, volatile Southside) and the full map is where a crime gets
  // PLANNED. The wash brightness IS the foot traffic (pop weight): bright =
  // witnesses, marks and beat cops; dark = quiet deals and body dumps. The
  // big lettered names make "meet me in Ironworks" mean something on sight.
  // Same 3×3 carve as the turf zones, so the wash and the control board agree.
  function eachDistrict(p, A, fn) {
    const list = (A.districts && A.districts.length) ? A.districts : ((CBZ.CITY && CBZ.CITY.districts) || []);
    if (!list.length) return;
    let popMax = 0.001;
    for (const d of list) popMax = Math.max(popMax, d.pop || 0);
    const zw = (A.maxX - A.minX) / 3, zd = (A.maxZ - A.minZ) / 3;
    for (let i = 0; i < list.length; i++) {
      const d = list[i], q = d.q != null ? d.q : i;   // q = dj*3 + di (world.js carve)
      fn(d, p.x(A.minX + ((q % 3) + 0.5) * zw), p.z(A.minZ + (((q / 3) | 0) + 0.5) * zd), zw * p.sc, zd * p.sc, (d.pop || 0) / popMax);
    }
  }

  // ---- CLIMB POINTS + AD BOARDS: where to go UP, and whose name is up -----
  // WHY: roofs are getaways, sniper perches and flex real estate. ▲ = a lift
  // lobby (the quiet ride to a roof), the ladder = fire stairs (the loud way
  // up under fire). Every board prints a faint tick; the ones YOU rent flip
  // to a gold $ — your money visible on the planning map like on the skyline.
  function drawLiftMark(x, z, p) {
    const mx = p.x(x), mz = p.z(z);
    if (ICONS_V2()) {
      drawIcon(ctx, mx, mz, "lift", { size: 6 }); stats.icons++;
      pickAdd(mx, mz, 7, "lift", "Roof lift", "Quiet ride to the roof", x, z);
      return;
    }
    ctx.fillStyle = "#9fd8ff"; ctx.strokeStyle = "rgba(0,0,0,.65)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(mx, mz - 5.5); ctx.lineTo(mx + 4.6, mz + 3.4); ctx.lineTo(mx - 4.6, mz + 3.4); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  function drawEscapeMark(x, z, p) {
    const mx = p.x(x), mz = p.z(z);
    if (ICONS_V2()) {
      drawIcon(ctx, mx, mz, "stairs", { size: 6 }); stats.icons++;
      pickAdd(mx, mz, 7, "stairs", "Fire stairs", "The loud way up", x, z);
      return;
    }
    for (const pass of [["rgba(0,0,0,.6)", 3.2], ["#ffc46b", 1.4]]) {   // dark underlay → amber ladder
      ctx.strokeStyle = pass[0]; ctx.lineWidth = pass[1]; ctx.beginPath();
      ctx.moveTo(mx - 2.2, mz - 5); ctx.lineTo(mx - 2.2, mz + 5);
      ctx.moveTo(mx + 2.2, mz - 5); ctx.lineTo(mx + 2.2, mz + 5);
      for (let r = -3; r <= 3; r += 3) { ctx.moveTo(mx - 2.2, mz + r); ctx.lineTo(mx + 2.2, mz + r); }
      ctx.stroke();
    }
  }
  function drawClimbMarks(p, A) {
    for (const el of (CBZ.cityElevators && CBZ.cityElevators()) || []) {
      if (!el.groundPad) continue;
      const mx = p.x(el.groundPad.x); if (mx < -20 || mx > W + 20) continue;
      const my = p.z(el.groundPad.z); if (my < -20 || my > H + 20) continue;
      drawLiftMark(el.groundPad.x, el.groundPad.z, p);
    }
    const lots = (A.lots || []).concat(A.annex ? A.annex.lots || [] : []);
    for (const lot of lots) {
      const fe = lot.building && lot.building.fireEscape; if (!fe) continue;
      const mx = p.x(fe.x); if (mx < -20 || mx > W + 20) continue;
      const my = p.z(fe.z); if (my < -20 || my > H + 20) continue;
      drawEscapeMark(fe.x, fe.z, p);
    }
  }
  function drawBoardTicks(p) {
    ctx.fillStyle = "rgba(216,206,176,.5)";
    for (const b of CBZ.cityAdBoards || []) ctx.fillRect(p.x(b.x) - 1.5, p.z(b.z) - 1.5, 3, 3);
  }
  function drawRentedBoards(p) {   // dynamic: a lease can lapse while the map is open
    for (const b of CBZ.cityAdBoards || []) {
      if (!b.lease) continue;
      const mx = p.x(b.x), mz = p.z(b.z);
      if (mx < -20 || mx > W + 20 || mz < -20 || mz > H + 20) continue;
      if (ICONS_V2()) {
        drawIcon(ctx, mx, mz, "board", { size: 6.5 }); stats.icons++;
        pickAdd(mx, mz, 7.5, "board", (b.name || "Ad board"), "Leased by you", b.x, b.z);
        continue;
      }
      ctx.fillStyle = "#ffd451"; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(mx, mz, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#231a05"; ctx.font = "700 8px Fredoka, sans-serif"; ctx.textAlign = "center"; ctx.fillText("$", mx, mz + 2.8);
    }
  }

  // ---- STATIC CITY PLATES --------------------------------------------------
  // The city map splits into what NEVER changes while it's open (districts,
  // roads, lots, shop labels, climb points, board ticks) and what does (turf,
  // actors, heat). The static layers render ONCE per open onto three offscreen
  // plates that composite as single drawImage calls — the 12fps redraw loop
  // stops re-stroking hundreds of rects/labels, so the cost stays flat no
  // matter how much detail the plates carry. THREE plates (not one) because
  // dynamic ink is sandwiched between them: turf paint goes UNDER the lots,
  // actor dots stay UNDER the labels.
  const plates = { base: document.createElement("canvas"), lots: document.createElement("canvas"), marks: document.createElement("canvas"), a: null, p0: null };
  for (const k of ["base", "lots", "marks"]) { plates[k].width = W; plates[k].height = H; }
  function onPlate(c, fn) {
    const main = ctx; ctx = c.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    bakeMode = true;
    try { fn(); } finally { ctx = main; bakeMode = false; }
  }
  function buildCityPlates(p, A) {
    plates.a = A;
    plates.p0 = p;   // remember the base projection the plates were baked at
    plateLabels = []; plateOverlapN = 0;   // the bake owns its own label boxes (base-projection px)
    coastCache = new Map();   // fresh organic coastlines for this bake
    // the mainland + commerce annex join the same land pipeline as the islands,
    // so every landmass shares one visual language (shadow/beach/texture/surf).
    const mainRg = { kind: "rect", minX: A.minX, maxX: A.maxX, minZ: A.minZ, maxZ: A.maxZ, name: "Port Vance", biome: "city" };
    const annexRg = A.annex ? { kind: "circle", cx: A.annex.cx, cz: A.annex.cz, r: A.annex.radius, name: "Commerce Annex", biome: "commerce" } : null;
    onPlate(plates.base, function () {
      // Primary path: exact coast + real elevation.  The fallback exists only
      // for modes/builds without continent.js; it excludes underlay registry
      // bands because those are bookkeeping rectangles, not geography.
      if (!drawTerrainBasemap(A, p)) {
        const landRegions = (A.regions || []).filter(function (r) { return !isLink(r) && !r.underlay; });
        for (const rg of landRegions) paintLandUnder(rg, p);
        paintLandUnder(mainRg, p);
        if (annexRg) paintLandUnder(annexRg, p);
        for (const rg of landRegions) paintLandTop(rg, p, rg.biome);
        paintLandTop(mainRg, p, "city");
        if (annexRg) paintLandTop(annexRg, p, "commerce");
      }
      // District names used to collapse into an unreadable knot underneath
      // PORT VANCE at the geographic fit. The named city is the correct scale
      // for this terrain map; block-level identity remains in the live world.
      // ---- METROPOLIS TITLE: the mainland city is a named place too, equal to
      //      the islands. A large faint banner sits just above the district grid.
      if (!ICONS_V2()) drawCityTitle(p, A);
    });
    onPlate(plates.lots, function () {
      drawLots(A.lots, p);
      if (A.annex) drawLots(A.annex.lots, p);
    });
    onPlate(plates.marks, function () {
      const settlementNames = settlementNameSet();
      // POI DIAMONDS only (no text) — labels are a dynamic, decluttered pass in
      // drawCity so they don't pile into unreadable mush at the fit zoom.
      // MAP_V2: fixed-size glyphs (POI icons, climb marks, board ticks) are NOT
      // baked here — the plate is composited at up to 12x zoom, which used to
      // balloon roof-lift ▲ to ~66px. They draw LIVE in drawCity instead; only
      // the region NAMES (which size to region width) stay on the plate.
      if (!MAP_V2()) {
        drawPoiGlyphs(A.lots, p);
        if (A.annex) drawPoiGlyphs(A.annex.lots, p);
      }
      if (!ICONS_V2()) drawRegionNames(p, A, settlementNames);
      if (!MAP_V2()) { drawClimbMarks(p, A); drawBoardTicks(p); }
    });
  }

  // A mini-city registers BOTH a terrain region and a settlement; this is the
  // one set that stops it being lettered twice.
  function settlementNameSet() {
    return new Set((CBZ.settlements || []).map(function (s) {
      return String((s && s.name) || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    }));
  }

  // ---- METROPOLIS TITLE: the mainland city is a named place too, equal to the
  //      islands. Live (not baked) under MAP_ICONS_V2 for the same reason the
  //      region names are: baked on the plate it multiplied by the zoom.
  function drawCityTitle(p, A) {
    const title = "PORT VANCE";
    const mw = (A.maxX - A.minX) * p.sc;
    const tsize = Math.max(16, Math.min(34, mw / Math.max(8, title.length * 0.6)));
    const tx = p.x((A.minX + A.maxX) / 2), ty = p.z(A.minZ) - tsize * 0.5;
    if (ICONS_V2()) {
      // hidden once the city fills the view — at that zoom the district and
      // shop layer is what you are reading, not the city's own name. No LOWER
      // bound: at the world fit this is the capital's name and must be there.
      if (mw > W * 2.6) return;
      if (tx < -80 || tx > W + 80 || ty < -20 || ty > H + 40) return;
    }
    if ("letterSpacing" in ctx) ctx.letterSpacing = "6px";   // cartographic tracking (no-op on old canvas)
    mapLabel(title, tx, ty, { size: tsize, weight: 800, fill: "rgba(232,242,255,.4)", haloC: "rgba(0,0,0,.45)", haloW: 4, force: true });
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  }

  // ---- REGION / BIOME NAMES: the map's geography legend ("where is the desert
  //      / the snow / the speedway"). THESE STAY PERMANENT — a place name you
  //      have to hover to discover is not a map, it is a quiz. What changed is
  //      WHERE they are drawn: baked onto the zoom-magnified plate they scaled
  //      with the zoom (a 14px name became 168px at 12x), so with MAP_ICONS_V2
  //      they draw LIVE at a fixed pixel size and tier by zoom — a region too
  //      small on screen to carry its name does not get one. ---------------
  function drawRegionNames(p, A, settlementNames) {
    const cand = [];
    const seen = new Set();
    for (const rg of A.regions || []) {
      if (isLink(rg) || rg.underlay || rg.mapLabel === false) continue;
      const name = rg.name || rg.biome || ""; if (!name) continue;
      const key = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      // Mini-city builders register both a terrain region and a settlement.
      // Let the collision-aware settlement layer draw that city once.
      if (settlementNames && settlementNames.has(key)) continue;
      const c = regionCentroid(rg);
      const wpx = (rg.kind === "circle" ? rg.r * 2 : (rg.maxX - rg.minX)) * p.sc;
      const hpx = (rg.kind === "circle" ? rg.r * 2 : (rg.maxZ - rg.minZ)) * p.sc;
      cand.push({ rg: rg, name: name, nx: p.x(c.x), ny: p.z(c.z), wpx: wpx, area: wpx * hpx });
    }
    // biggest landmass claims its name first — registry order is build order,
    // not cartographic importance, so a hamlet used to hide a continent
    cand.sort(function (a, b) { return b.area - a.area; });
    for (const q of cand) {
      const size = Math.max(11, Math.min(20, q.wpx / Math.max(6, q.name.length * 0.55)));
      if (ICONS_V2()) {
        if (q.wpx < 46) continue;                                        // too small on screen to carry a name
        if (q.nx < -70 || q.nx > W + 70 || q.ny < -40 || q.ny > H + 40) continue;
      }
      if ("letterSpacing" in ctx) ctx.letterSpacing = "1.5px";   // cartographic tracking (no-op on old canvas)
      mapLabel(q.name, q.nx, q.ny, {
        size: size, fill: "rgba(228,238,250,.92)", haloC: "rgba(0,0,0,.55)",
        force: !ICONS_V2(),   // legacy behaviour: baked names never collision-tested
        // Subtitles are useful only after zooming in. At the world fit they
        // duplicated the legend and turned geography into paragraphs.
        sub: (q.rg.subtitle && map.view.z >= 1.65) ? q.rg.subtitle : null,
        subFill: "rgba(205,218,232,.5)",
      });
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    }
  }

  // ---- DECLUTTERED POI LABELS (the fix for "label mush") --------------------
  // WHY: drawing a name on every shop turns the map into noise. So labels are
  // TIERED: key POIs (your HOME) are always named; ordinary shops only when
  // you've zoomed IN (view.z>=1.8) or are hovering near them (~70px of the
  // cursor). Then a greedy collision pass measures each candidate and skips any
  // that would overlap one already placed — so what shows always reads clean.
  // LEGACY ONLY (MAP_ICONS_V2 = false). This is the "way way too much text"
  // pass: at the zoom M drops you at, `zoomShow` is true, so EVERY shop on
  // screen printed its name. Kept intact behind the flag as the one-line
  // revert, and routed through mapLabel so `CBZ.mapAudit()` can measure the
  // before-state honestly instead of the fix being marked by its own homework.
  function drawCityLabels(p, A) {
    const cur = map._cursor;   // {x,y} canvas px, or null
    const zoomShow = map.view.z >= 1.8;
    const cands = [];
    const collect = (lots) => {
      for (const lot of lots || []) {
        const info = poiInfo(lot); if (!info || !info.label) continue;
        const sx = p.x(lot.cx), sy = p.z(lot.cz);
        if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) continue;   // off-canvas
        let cd = 1e9;
        if (cur) cd = Math.hypot(sx - cur.x, sy - cur.y);
        const near = cur && cd <= 70;
        // tier gate: key POIs always; shops only when zoomed-in or hovered
        if (!info.key && !zoomShow && !near) continue;
        cands.push({ info: info, sx: sx, sy: sy, cd: cd });
      }
    };
    collect(A.lots); if (A.annex) collect(A.annex.lots);
    // key POIs first, then nearest-to-cursor — so the important names win the
    // greedy collision arbitration.
    cands.sort(function (a, b) {
      if (!!b.info.key !== !!a.info.key) return b.info.key ? 1 : -1;
      return a.cd - b.cd;
    });
    const priv = [];   // this pass owned a FRESH box list — keep the revert faithful
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i], s = c.info.key ? 7 : 5;
      const fs = c.info.key ? 12 : 10;
      mapLabel(c.info.label, c.sx, c.sy - s - 3, {
        size: fs, fill: c.info.key ? "#bfffd9" : "rgba(244,250,255,.96)",
        haloC: "rgba(0,0,0,.75)", boxes: priv,
        force: !!c.info.key,   // key POIs always drew, shops skipped on overlap
      });
    }
  }

  // composite a static plate (baked at plates.p0) under the CURRENT pan/zoom by
  // rescaling/translating it once — far cheaper than re-baking on every zoom.
  function compositePlate(plate, p) {
    const p0 = plates.p0; if (!p0) { ctx.drawImage(plate, 0, 0); return; }
    const k = p.sc / p0.sc;
    ctx.save();
    ctx.setTransform(k, 0, 0, k, p.left - k * p0.left, p.top - k * p0.top);
    ctx.drawImage(plate, 0, 0);
    ctx.restore();   // setTransform back to identity
  }

  function drawCity(p) {
    const A = CBZ.city && CBZ.city.arena;
    if (!A) { text("CITY DISTRICT", 0, (CBZ.CITY && CBZ.CITY.center.z) || -700, p, "rgba(235,245,255,.5)", 18); return; }
    // bake the static plates ONCE at the base fit (NOT the panned/zoomed view)
    if (plates.a !== A) buildCityPlates(baseProjection(p.bounds), A);
    const wanted = MAP_V2() ? starCount() : ((CBZ.game && CBZ.game.wanted) || 0);
    compositePlate(plates.base, p);   // real terrain + geographic lettering
    const detail = map.view.z >= 2.4;
    // THE BRIDGE — the sole chokepoint between mainland and island. WHY it matters
    // mechanically: at 3★+ the cops seal it (roadblocks), so it turns red + SEALED
    // — the map tells you your island escape is cut off.
    if (A.bridge) {
      const b = A.bridge, mz = (b.minZ + b.maxZ) / 2, sealed = wanted >= 3;
      // A small cartographic crossing marker carries the gameplay fact without
      // drawing another giant road ribbon across the terrain.
      if (sealed || detail) {
        const bx = (b.minX + b.maxX) / 2, by = mz;
        if (ICONS_V2()) {
          const sx = p.x(bx), sy = p.z(by);
          drawIcon(ctx, sx, sy, "sealed", { size: sealed ? 8 : 6, tier: sealed, color: sealed ? null : "rgba(220,232,240,.9)" });
          stats.icons++;
          pickAdd(sx, sy, 9, "sealed", "Bridge", sealed ? "SEALED — roadblocks up" : "Mainland ↔ island crossing", bx, by);
          // SEALED is the one bridge word that survives: it is a live obstruction
          // between you and your escape, not a place name you can go and read.
          if (sealed) mapLabel("SEALED", sx, sy - 14, { size: 10, fill: "#ff8b7a", force: true });
        } else {
          dot(bx, by, p, sealed ? "#ff5a4c" : "rgba(220,232,240,.72)", sealed ? 5 : 3);
          text(sealed ? "BRIDGE — SEALED" : "BRIDGE", bx, by - 12 / p.sc, p,
            sealed ? "#ff8b7a" : "rgba(225,240,255,.58)", 10);
        }
      }
    }
    // Tactical block/actor ink is useful only when zoomed into a city. At the
    // geographic fit it disappears so terrain and named cities own the map.
    if (detail) {
      drawGangTurf(p);
      compositePlate(plates.lots, p);
      for (let i = 0; i < (CBZ.cityPeds || []).length; i += Math.max(1, Math.ceil(CBZ.cityPeds.length / 380))) {
        const ped = CBZ.cityPeds[i]; if (!ped.dead) dot(ped.pos.x, ped.pos.z, p,
          CBZ.cityTargetsPlayer && CBZ.cityTargetsPlayer(ped) ? "#ff3b35" : "rgba(232,238,245,.62)",
          CBZ.cityTargetsPlayer && CBZ.cityTargetsPlayer(ped) ? 3.0 : 1.6);
      }
      for (const car of CBZ.cityCars || []) if (!car.dead) dot(car.pos.x, car.pos.z, p, "rgba(245,245,255,.7)", 2);
      for (const cop of CBZ.cityCops || []) if (!cop.dead) {
        const hot = CBZ.cityTargetsPlayer && CBZ.cityTargetsPlayer(cop);
        dot(cop.pos.x, cop.pos.z, p, hot ? "#ff3b35" : "#5bd0ff", hot ? 3.2 : 2.7);
      }
      for (const a of CBZ.cityWildlife || []) if (a && !a.dead && CBZ.cityTargetsPlayer && CBZ.cityTargetsPlayer(a)) dot(a.pos.x, a.pos.z, p, "#ff3b35", 3.0);
    }
    compositePlate(plates.marks, p);  // baked ink (region names only when MAP_ICONS_V2 is off)
    seedPlateBoxes(p);                // …and its label boxes, so live text avoids them
    // ---- MAP_V2 LIVE GLYPH LAYER: fixed-size at the current zoom so nothing
    //      balloons. POI icons + settlements always; climb marks + board ticks
    //      only once you've zoomed IN (planning detail, not fit-view clutter). ----
    // LABEL PRIORITY, in the cartographic order: the metropolis banner, then
    // TOWNS (point features — a place you navigate to, with a short name that
    // cannot be moved), then REGIONS by size (area features, whose name is the
    // first thing a real chart drops when space runs out). One shared box list,
    // so nothing can ever be drawn on top of anything else.
    // Outside the MAP_V2 gate because these names are BAKED when MAP_ICONS_V2
    // is off — exactly one of the two paths must run, whatever the other says.
    if (ICONS_V2()) drawCityTitle(p, A);
    if (MAP_V2()) {
      if (detail) drawCityPoisLive(p, A); // city services only at city scale
      drawSettlementsLive(p);        // named towns (labels collision-avoided)
    }
    if (ICONS_V2()) { reserveIconBoxes(); drawRegionNames(p, A, settlementNameSet()); }
    if (MAP_V2() && (map.view.z >= 2.6 || (map._cursor && !ICONS_V2()))) { drawClimbMarks(p, A); drawBoardTicks(p); }
    if (detail && !ICONS_V2()) drawCityLabels(p, A);
    if (detail) drawRentedBoards(p);
    // ---- EMPIRE: ring every lot YOU own in gold so the economy is spatial ----
    if (detail && CBZ.cityOwnsLot) {
      ctx.strokeStyle = "#ffd451"; ctx.lineWidth = 2;
      const ring = (lots) => { for (const lot of lots || []) { if (lot.building && CBZ.cityOwnsLot(lot)) { ctx.beginPath(); ctx.arc(p.x(lot.cx), p.z(lot.cz), 9, 0, Math.PI * 2); ctx.stroke(); } } };
      ring(A.lots); if (A.annex) ring(A.annex.lots);
    }
    // ---- NEED-SURFACING: when a need is pressing, pulse the place that fixes it,
    //      so the map answers "why is this lit? because you need it right now". ----
    const G = CBZ.game, npulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.006);
    function pulseKind(kind, on, col) {
      if (!on) return;
      const want = (lots) => { for (const lot of lots || []) { const b = lot.building; if (b && b.shop && b.shop.kind === kind) { ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(p.x(lot.cx), p.z(lot.cz), 10 + npulse * 5, 0, Math.PI * 2); ctx.stroke(); } } };
      want(A.lots); if (A.annex) want(A.annex.lots);
    }
    pulseKind("food", (G.hunger != null && G.hunger < 35), "#ff9e6b");
    pulseKind("hospital", (CBZ.player && CBZ.player.hp != null && CBZ.player.hp < (CBZ.player.maxHp || 200) * 0.4), "#ff5b6b");
    // ---- HEAT LAYER: where the police think you are + the air threat ----
    if (wanted >= 1 && G.cityLastKnown) {
      const lk = G.cityLastKnown, rr2 = (12 + wanted * 10) * p.sc;
      ctx.strokeStyle = "rgba(255,70,55," + (0.35 + 0.25 * npulse).toFixed(2) + ")"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x(lk.x), p.z(lk.z), rr2 * (0.7 + 0.3 * npulse), 0, Math.PI * 2); ctx.stroke();
      if (ICONS_V2()) {
        // The pulsing red ring already says "they think you are here"; the eye
        // names it on hover instead of stamping LAST SEEN over the streets.
        const ex = p.x(lk.x), ey = p.z(lk.z) - Math.min(60, rr2 * 0.7) - 10;
        drawIcon(ctx, ex, ey, "seen", { size: 7 }); stats.icons++;
        pickAdd(ex, ey, 8, "seen", "Last known position", wanted + "★ search area", lk.x, lk.z);
      } else {
        text("LAST SEEN", lk.x, lk.z - (14 + wanted * 10), p, "rgba(255,140,120,.7)", 10);
      }
    }
    if (wanted >= 3 && CBZ.cityChopperPos) {
      const hp = CBZ.cityChopperPos();
      if (hp) {
        const mx = p.x(hp.x), mz = p.z(hp.z);
        ctx.save(); ctx.translate(mx, mz); ctx.rotate(performance.now() * 0.009);
        ctx.strokeStyle = "#ff5040"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.moveTo(0, -10); ctx.lineTo(0, 10); ctx.stroke(); ctx.restore();
        ctx.fillStyle = "#ff5040"; ctx.beginPath(); ctx.arc(mx, mz, 3, 0, Math.PI * 2); ctx.fill();
        if (ICONS_V2()) pickAdd(mx, mz, 10, "chopper", "Police helicopter", "Hunting you", hp.x, hp.z);
      }
    }
    const job = CBZ.game.cityJob;
    if (job && job.dest) {
      // THE OBJECTIVE KEEPS ITS WORD. Everything else on this map went silent;
      // the thing you are being paid to reach did not.
      const jx = p.x(job.dest.x), jy = p.z(job.dest.z);
      const jn = String(job.desc || "Job").slice(0, 34);
      if (ICONS_V2()) {
        drawIcon(ctx, jx, jy, "mission", { size: 9, tier: true }); stats.icons++;
        mapLabel(jn, jx, jy - 14, { size: 11, fill: "#bfffd9", force: true });
        pickAdd(jx, jy, 11, "mission", jn, job.reward ? "Pays $" + Math.round(job.reward).toLocaleString() : "Active objective", job.dest.x, job.dest.z);
      } else drawPoi(job.dest.x, job.dest.z, p, "#7ed957", "JOB", true, "mission");
    }
  }

  function drawGrid(p) {
    const b = p.bounds;
    ctx.strokeStyle = "rgba(125,231,255,.08)"; ctx.lineWidth = 1;
    const gap = Math.max(10, Math.ceil(Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 12 / 10) * 10);
    for (let x = Math.ceil(b.minX / gap) * gap; x <= b.maxX; x += gap) line(x, b.minZ, x, b.maxZ, p, ctx.strokeStyle, 1);
    for (let z = Math.ceil(b.minZ / gap) * gap; z <= b.maxZ; z += gap) line(b.minX, z, b.maxX, z, p, ctx.strokeStyle, 1);
  }

  function draw() {
    if (!ctx) return;
    const which = mode(), p = map.projection = makeProjection(boundsFor(which));
    if (titleEl) titleEl.textContent = MODE_TITLE[which] || "AREA MAP";
    // one frame, one census: every icon, label, overlap and pick below is
    // counted from scratch, which is what makes CBZ.mapAudit() a measurement
    // rather than an opinion.
    stats.icons = stats.labels = stats.overlaps = stats.hoverable = 0;
    stats.merged = stats.skipped = stats.furniture = stats.plate = 0;
    stats.zoom = which === "city" ? map.view.z : 1; stats.mode = which;
    labelBoxes = []; map._picks = [];
    ctx.clearRect(0, 0, W, H);
    if (which === "city" || which === "survival") {
      // OCEAN: the archipelago floats on water, not a black void — depth
      // gradient + pre-seeded wave glyphs so the sea reads as sea.
      drawOcean();
    } else {
      ctx.fillStyle = "#08111d"; ctx.fillRect(0, 0, W, H);
    }
    // The city view is a geographic terrain map, not graph paper. Prison and
    // survival retain their small tactical grid.
    if (which !== "city") drawGrid(p);
    if (which === "survival") drawSurvival(p);
    else if (which === "city") drawCity(p);
    else drawEscape(p);
    drawWaypoint(p); drawPlayer(p);
    drawVignette();   // soft dark edges pull the eye to the chart, not the frame
    // THE ONE LABEL YOU ASKED FOR, last so nothing can paint over it.
    drawHoverTip(p);
    if (which === "city") {
      drawCompassRose();
      drawScaleBar(p);
      if (MAP_V2()) drawWantedStars(starCount());   // only rendered when > 0
    } else {
      ctx.fillStyle = "rgba(223,250,255,.82)"; ctx.font = "700 14px Fredoka, sans-serif"; ctx.textAlign = "center"; ctx.fillText("N", W / 2, 18); stats.furniture++;
    }
    const wp = activeWaypoint();
    const route = activeRoute();
    if (readout) readout.textContent = wp ? "Route: " + waypointDistance(wp) + "m - " + wp.label + (route && route.kind === "fallback" ? " (direct)" : "") : "No waypoint set";
    if (legend) {
      // The legend is rebuilt from scratch on every redraw, which was harmless
      // when it was six colour swatches and is NOT once it carries a dozen
      // data-URI pictograms: writing that innerHTML 12×/s would re-decode every
      // image. setLegend only touches the DOM when the markup actually changed.
      const setLegend = function (html) {
        if (html === map._legendHTML) return;
        map._legendHTML = html;
        legend.innerHTML = html;
      };
      const common = "<span><i style='background:#ff9b3d'></i>You</span><span><i style='background:#7de7ff'></i>Route</span>";
      if (which === "escape") {
        setLegend(common + "<span><i style='background:#c792ea'></i>Hatch</span><span><i style='background:#ffd451'></i>Guard</span><span><i style='background:#39ff88'></i>Exit</span>");
      } else if (which === "survival") {
        setLegend(common + "<span><i style='background:#ffe38a'></i>High ground</span><span><i style='background:#e8eef5'></i>Survivor</span>");
      } else {
        if (map.view.z < 2.4) {
          // at the geographic fit the key is TERRAIN (colour washes), not trades
          setLegend(common +
            "<span><i style='background:#e6c069'></i>City</span>" +
            "<span><i style='background:#6f9a48'></i>Farm</span>" +
            "<span><i style='background:#d4a04c'></i>Desert</span>" +
            "<span><i style='background:#3f7043'></i>Forest</span>" +
            "<span><i style='background:#e7f2fb'></i>Snow</span>" +
            "<span><i style='background:#277e8f'></i>Water</span>" +
            (ICONS_V2() ? "<span style='opacity:.6;font-style:italic;margin-left:6px'>" +
              (CBZ.touchMode ? "tap an icon for its name" : "hover an icon for its name") + "</span>" : ""));
          return;
        }
        // grouped by WHY: Navigation, Threats, Your empire, then the clickable
        // Territory swatches (each routes to that crew's HQ).
        const grp = (t) => "<span style='opacity:.55;font-weight:700;letter-spacing:.5px;margin-left:6px'>" + t + "</span>";
        // THE KEY IS THE VOCABULARY. Under MAP_ICONS_V2 the legend shows the
        // ACTUAL pictogram (rendered once per kind, cached), so the chart and
        // its key are one language instead of two.
        const key = function (kind, label, fallbackColor) {
          if (ICONS_V2()) {
            const u = iconDataURL(kind);
            if (u) return "<span><i style=\"width:14px;height:14px;border-radius:3px;box-shadow:none;background:url(" + u + ") center/contain no-repeat\"></i>" + esc(label) + "</span>";
          }
          return "<span><i style='background:" + (fallbackColor || iconSpec(kind).c) + "'></i>" + esc(label) + "</span>";
        };
        let html = grp("GO") + common + key("home", "Home") + key("mission", "Job");
        html += grp("HEAT") + "<span><i style='background:#ff6a5a'></i>Police</span>" + key("chopper", "Chopper 3★+") + key("seen", "Last seen");
        html += grp("EMPIRE") + "<span><i style='background:#ffd451;border-radius:50%'></i>Your turf / owned</span>" + key("board", "Boards you rent");
        // ways onto a roof — plan the climb before the chase starts
        html += grp("CLIMB") + key("lift", "Lifts") + key("stairs", "Fire stairs");
        if (ICONS_V2()) {
          html += grp("SERVICES") + key("hospital", "Hospital") + key("bank", "Bank") + key("guns", "Guns") +
            key("gas", "Fuel") + key("casino", "Casino") + key("carlot", "Cars") + key("food", "Food");
        }
        // one clickable swatch per rival crew → route to their HQ.
        let hasGang = false; let terr = "";
        for (const gang of CBZ.cityGangs || []) {
          if (!gang || gang.isPlayer || gang.absorbed || !gang.turf || !gang.turf.length) continue;
          hasGang = true;
          terr += "<span class='fmGangChip' data-gang='" + esc(String(gang.id)) + "' style='cursor:pointer'>" +
            "<i style='background:" + hex6(gang.color) + "'></i>" + esc(gang.name || "Gang") + "</span>";
        }
        if (hasGang) html += grp("TERRITORY") + terr + "<span style='opacity:.7;font-style:italic'>" +
          (CBZ.touchMode ? "tap a crew to route to their HQ" : "[click a crew] route to HQ") + "</span>";
        // The discoverability line for the whole change — WORDS on touch, never
        // a key glyph (touch doctrine), and it names the gesture that exists.
        if (ICONS_V2()) html += "<span style='opacity:.6;font-style:italic;margin-left:6px'>" +
          (CBZ.touchMode ? "tap an icon for its name" : "hover an icon for its name") + "</span>";
        setLegend(html);
      }
    }
  }
  map.draw = draw;
  function esc(s) { return String(s).replace(/[<>&"]/g, function (c) { return c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : "&quot;"; }); }
  // delegated click: a gang swatch in the legend routes to that crew's HQ, then
  // closes the map so the on-screen arrow takes over (mirrors clicking the canvas).
  if (legend) legend.addEventListener("click", function (e) {
    const chip = e.target && e.target.closest && e.target.closest(".fmGangChip");
    if (!chip) return;
    const id = chip.getAttribute("data-gang");
    if (id != null && setGangWaypoint(id)) close();
  });

  let _guideT = 0, _guideRot = "", _guideDist = "", _guideLab = "";
  function updateGuide(dt) {
    const wp = activeWaypoint();
    if (!guide) return;
    // ~8Hz is plenty for a HUD compass — this used to run nav pathing + three
    // DOM writes every frame, with the map closed, forever. Event-driven calls
    // (waypoint set/cleared, map open/close) pass no dt and refresh NOW.
    if (dt == null) _guideT = 0; else _guideT -= dt;
    if (_guideT > 0) return;
    _guideT = 0.125;
    // 8 Hz, and every set() is a compare-before-write: touch.js can raise
    // CBZ.touchMode long after the arrow first appeared (first finger on a
    // hybrid), and the arrow shows without the map ever having been opened.
    keycaps();
    guide.classList.toggle("show", !!wp && !map.active);
    if (!wp || !CBZ.player || !CBZ.player.pos) return;
    const nav = CBZ.navigation && CBZ.navigation.next(activeRoute(), CBZ.player.pos);
    const target = nav ? nav.target : wp;
    const dx = target.x - CBZ.player.pos.x, dz = target.z - CBZ.player.pos.z;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
    const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const forward = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
    const rot = "rotate(" + (Math.atan2(right, forward) * 180 / Math.PI).toFixed(1) + "deg)";
    if (arrow && rot !== _guideRot) { arrow.style.transform = rot; _guideRot = rot; }
    const ds = (nav ? Math.round(nav.remaining) : Math.round(Math.hypot(dx, dz))) + "m";
    if (distEl && ds !== _guideDist) { distEl.textContent = ds; _guideDist = ds; }
    const lab = (nav ? nav.instruction + " - " : "") + (wp.label || "Waypoint");
    if (labelEl && lab !== _guideLab) { labelEl.textContent = lab; _guideLab = lab; }
  }

  // canvas-space (W×H) coords from a mouse event
  function evCanvas(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
  // ---- TAP-TO-IDENTIFY (touch) ---------------------------------------------
  // Hover does not exist on a touch screen, so the label has to be asked for.
  // First tap on an icon SELECTS it and shows its name; tapping the SAME icon
  // again commits it as your waypoint (so identifying a place and routing to it
  // is one gesture repeated, not two different ones); tapping empty map
  // dismisses the label and drops a waypoint exactly as it always did.
  // Returns true when the tap was consumed by the icon layer.
  function touchTap(c) {
    if (!CBZ.touchMode || !ICONS_V2()) return false;
    const hit = pickAt(c.x, c.y);
    if (!hit) { if (map._sel) { map._sel = null; draw(); } return false; }
    const same = map._sel && Math.abs(map._sel.wx - hit.wx) < 0.01 && Math.abs(map._sel.wz - hit.wz) < 0.01;
    if (same) {
      map._sel = null;
      if (hit.wx != null) setWaypoint(hit.wx, hit.wz, hit.label);
      return true;
    }
    map._sel = { wx: hit.wx, wz: hit.wz, kind: hit.kind, label: hit.label, sub: hit.sub, r: hit.r };
    draw();
    return true;
  }
  function placeFromEvent(e) {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    const c = evCanvas(e);
    if (touchTap(c)) return;
    const p = map.projection || makeProjection(boundsFor(mode()));
    setWaypoint(p.wx(c.x), p.wz(c.y));
  }

  // CITY map gets pan + zoom; every other mode keeps the plain place-on-click.
  // Drag-vs-click is decided by a 4px threshold so a deliberate click still
  // drops a waypoint while a drag pans the camera (and never sets a waypoint).
  let drag = null;   // { startX, startY, button, ox, oz, moved }
  cv.addEventListener("mousedown", function (e) {
    if (mode() !== "city") { placeFromEvent(e); return; }
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    const c = evCanvas(e);
    drag = { startX: c.x, startY: c.y, button: e.button, ox: map.view.ox, oz: map.view.oz, moved: false };
  });
  cv.addEventListener("mousemove", function (e) {
    const c = evCanvas(e);
    // HOVER IS THE LABEL. Tracked in every mode now (the prison map has icons
    // too), but NEVER on touch: a synthesized mousemove at the tap point would
    // otherwise render a hover affordance on a device that cannot hover.
    if (!CBZ.touchMode) {
      const had = map._cursor;
      map._cursor = { x: c.x, y: c.y };
      if (map.active && !drag && ICONS_V2()) {
        const now = pickAt(c.x, c.y), was = map._hoverKey || "";
        const key = now ? now.label + "@" + now.x.toFixed(0) + "," + now.y.toFixed(0) : "";
        // redraw only when the NAMED thing changes, not on every mouse pixel
        if (key !== was) { map._hoverKey = key; draw(); }
        else if (!had) draw();
      }
    } else if (mode() === "city") map._cursor = { x: c.x, y: c.y };
    if (!drag) return;
    const dx = c.x - drag.startX, dy = c.y - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;   // still a potential click
    drag.moved = true;
    const p = map.projection; if (!p) return;
    // pan: keep the world point under the press fixed by moving the centre
    map.view.ox = drag.ox - dx / p.sc;
    map.view.oz = drag.oz - dy / p.sc;
    clampPan();
    draw();
  });
  function endDrag(e) {
    if (!drag) return;
    const d = drag; drag = null;
    if (mode() !== "city") return;
    if (!d.moved && (e.button === 0 || e.button === 2)) {
      const c = evCanvas(e);
      if (touchTap(c)) return;   // touch: this tap was asking WHAT that icon is
      // a clean click → place the waypoint (left OR right, as before)
      const p = map.projection || makeProjection(boundsFor("city"));
      setWaypoint(p.wx(c.x), p.wz(c.y));
    }
  }
  cv.addEventListener("mouseup", endDrag);
  cv.addEventListener("mouseleave", function () {
    drag = null;
    // the cursor left the chart, so the one hover label goes with it
    if (map._cursor) { map._cursor = null; map._hoverKey = ""; if (map.active) draw(); }
  });
  cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  // ZOOM-TO-CURSOR wheel: keep the world point under the cursor fixed while the
  // zoom changes (the standard map-zoom feel), then re-clamp the pan.
  cv.addEventListener("wheel", function (e) {
    if (mode() !== "city" || !map.active) return;
    e.preventDefault();
    const c = evCanvas(e);
    const p = map.projection; if (!p) return;
    const wx = p.wx(c.x), wz = p.wz(c.y);
    const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
    const nz = clampZoom(map.view.z * factor);
    if (nz === map.view.z) return;
    map.view.z = nz;
    // recompute the projection at the new zoom, then shift ox/oz so (wx,wz)
    // lands back under the cursor.
    const np = makeProjection(boundsFor("city"));
    map.view.ox += wx - np.wx(c.x);
    map.view.oz += wz - np.wz(c.y);
    clampPan();
    draw();
  }, { passive: false });
  // ---- TOUCH ZOOM CHIPS (owner ask: "zoom the map on my iPad") --------------
  // The wheel above and the F fit key were the map's ONLY zoom inputs — neither
  // exists on touch, and open() drops the city view zoomed-IN on the player, so
  // an iPad could never zoom back out. The +/− chips (index.html, revealed only
  // under body.touch) step map.view.z through the SAME clampZoom the wheel
  // uses, with ox/oz untouched — zoom stays centred on the current view centre.
  // Tap = one step; hold = repeat after a beat. ONE global timer, killed on
  // touchend/touchcancel/mouseup/mouseleave AND in close(), so a lifted finger
  // can never leave the map zooming by itself (the touch layer's stale rule).
  const ZOOM_STEP = 1.25, ZOOM_HOLD_MS = 320, ZOOM_REPEAT_MS = 110;
  let zoomHoldT = 0, zoomTickT = 0;
  function zoomStep(dir) {
    if (!map.active || mode() !== "city") return;
    const nz = clampZoom(map.view.z * (dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
    if (nz === map.view.z) return;   // pinned at the clamp — nothing to redraw
    map.view.z = nz;
    clampPan();
    draw();
  }
  function zoomRepeatStop() {
    if (zoomHoldT) { clearTimeout(zoomHoldT); zoomHoldT = 0; }
    if (zoomTickT) { clearInterval(zoomTickT); zoomTickT = 0; }
    if (zoomInBtn) zoomInBtn.classList.remove("on");
    if (zoomOutBtn) zoomOutBtn.classList.remove("on");
  }
  function bindZoomBtn(b, dir) {
    if (!b) return;
    const start = function (e) {
      e.preventDefault();   // no synthesized mouse events → the canvas never sees a phantom waypoint click
      zoomRepeatStop();     // at most one live repeat loop, whichever chip was pressed last
      b.classList.add("on");
      zoomStep(dir);
      zoomHoldT = setTimeout(function () {
        zoomTickT = setInterval(function () {
          if (!map.active) { zoomRepeatStop(); return; }
          zoomStep(dir);
        }, ZOOM_REPEAT_MS);
      }, ZOOM_HOLD_MS);
    };
    const stop = function (e) { if (e.cancelable) e.preventDefault(); zoomRepeatStop(); };
    b.addEventListener("touchstart", start, { passive: false });
    b.addEventListener("touchend", stop, { passive: false });
    b.addEventListener("touchcancel", stop, { passive: false });
    // touch-first, but a touch-laptop's mouse press on the visible chip should
    // behave identically (systems/touch.js holdBtn wires both the same way).
    b.addEventListener("mousedown", start);
    b.addEventListener("mouseup", stop);
    b.addEventListener("mouseleave", stop);
  }
  bindZoomBtn(zoomInBtn, 1);
  bindZoomBtn(zoomOutBtn, -1);
  if (closeBtn) closeBtn.addEventListener("click", function () { close(); });
  // TOUCH (owner ask): tapping the minimap opens the map. Covers the city
  // radar canvas (#cRadar, city/hud.js) and the jail minimap (#minimap) —
  // both opt back into pointer-events under body.touch (css/mobile.css).
  // Same toggle the M key drives; gated so a stray tap never fires it while
  // a menu overlay is up.
  document.addEventListener("click", function (e) {
    if (!CBZ.touchMode) return;
    if (!e.target || !e.target.closest || !e.target.closest("#cRadar, #minimap")) return;
    if (CBZ.game.state !== "playing" || CBZ.cityMenuOpen) return;
    e.preventDefault();
    map.toggle();
  });

  addEventListener("keydown", function (e) {
    // (e.key is read before the repeat bail now — a synthetic tapKey() event
    // from the gamepad carries no code and, in principle, no key either.)
    const k = (e.key || "").toLowerCase();
    /* SPACE CLEARS THE WAYPOINT (CBZ.CONFIG.MAP_SPACE_CLEARS).
       OWNER: "space bar doesnt work to clear waypoint on map." It never has —
       this handler only ever bound Backspace/Delete (kept below as silent
       aliases) and the footer in index.html advertised [Backspace]. Both now
       say Space, which is the key the hand is already on.

       The un-latch is the load-bearing half. systems/input.js keeps CBZ.keys
       from a listener that knows nothing about overlays — it writes
       keys[" "] = true for every press, map open or not — and the frame loop
       keeps running while the map is up, so vehicles.js's handbrake (k[" "]),
       playeraircraft's throttle/collective and swim.js's ascend all read that
       latch underneath the map. open() already scrubs it via clearMoveKeys();
       a press made WHILE the map is up needs the same scrub, which is why this
       sits above the `e.repeat` bail and clears on repeats too (a held Space
       re-latches on every auto-repeat, but only the first one is a real press,
       so only the first one clears the waypoint). */
    if (map.active && (e.code === "Space" || k === " " || k === "spacebar") &&
        (!CBZ.CONFIG || CBZ.CONFIG.MAP_SPACE_CLEARS !== false)) {
      e.preventDefault();
      if (CBZ.keys) CBZ.keys[" "] = false;   // the map owns the key while it is up
      // ...except that a controls card ("Space / Esc to close", controls.js) is
      // the one overlay that can legitimately stand over the map — open a car,
      // its Driving card pops, press M. That card's Space DISMISSES the card,
      // and one press must not also throw the waypoint away. The un-latch above
      // still runs, because the card only preventDefaults; input.js latched the
      // key before it either way.
      const cardUp = !!(CBZ.controls && CBZ.controls.open && CBZ.controls.open());
      if (!e.repeat && !cardUp) clearWaypoint();
      return;
    }
    if (e.repeat) return;
    // M ALWAYS toggles the full map (owner's order: the binding is M, layout-safe
    // via e.code; e.key kept for the gamepad's synthetic tapKey("m") which carries
    // no code). The old campaign branch that hijacked M to open the phone's
    // missions app is gone — map and phone are mutually exclusive instead: opening
    // the map puts the phone away first, so the two overlays never collide.
    if (e.code === "KeyM" || k === "m") {
      if (!map.active && CBZ.campaignUI && CBZ.campaignUI.isOpen && CBZ.campaignUI.isOpen()) {
        try { CBZ.campaignUI.close(); } catch (err) {}
      }
      map.toggle(); e.preventDefault();
    }
    else if (map.active && e.key === "Escape") { close(); e.preventDefault(); }
    else if (map.active && (e.key === "Backspace" || e.key === "Delete")) { clearWaypoint(); e.preventDefault(); }
    else if (map.active && mode() === "city" && k === "f") { setCityView(true); draw(); e.preventDefault(); }   // F = fit the whole archipelago
  });

  let redraw = 0, reroute = 0;
  CBZ.onAlways(73, function (dt) {
    if (map.active && CBZ.game.state !== "playing" && CBZ.game.state !== "paused") close(false);
    if (map.active) {
      redraw += dt;
      if (redraw >= 1 / 12) { redraw %= 1 / 12; draw(); }
    }
    reroute += dt;
    const wp = activeWaypoint(), route = activeRoute();
    if (wp && route && CBZ.navigation && reroute >= 1.5) {
      reroute = 0;
      if (CBZ.navigation.offRoute(route, CBZ.player.pos) > 9) rebuildRoute(wp);
    }
    updateGuide(dt);
  });
})();
