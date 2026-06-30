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
  const legend = document.getElementById("fullMapLegend");
  const guide = document.getElementById("waypointGuide");
  const arrow = document.getElementById("waypointArrow");
  const distEl = document.getElementById("waypointDist");
  const labelEl = document.getElementById("waypointLabel");
  const MODE_TITLE = { escape: "PRISON MAP", survival: "ISLAND MAP", city: "GANG LIFE MAP" };

  const map = {
    active: false,
    points: { escape: null, survival: null, city: null },
    routes: { escape: null, survival: null, city: null },
    projection: null,
  };
  CBZ.fullMap = map;

  function mode() { return CBZ.game.mode || "escape"; }

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
        return { minX: minX - 10, maxX: maxX + 10, minZ: minZ - 10, maxZ: maxZ + 10 };
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
    clearMoveKeys();
    plates.a = null;   // re-render the static city plates fresh each open (ownership/renovations may have moved)
    if (mode() === "city") setCityView(false);   // drop the view on the player, zoomed-in
    map._cursor = null;
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("full-map-open");
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    draw();
    updateGuide();
    return true;
  }

  function close(relock) {
    if (!map.active) return;
    map.active = false;
    map._cursor = null;
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

  function text(s, x, z, p, color, size) {
    ctx.fillStyle = color || "rgba(235,245,255,.62)";
    ctx.font = "700 " + (size || 12) + "px Fredoka, sans-serif";
    ctx.textAlign = "center"; ctx.fillText(s, p.x(x), p.z(z));
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
    for (const vent of CBZ.vents || []) drawPoi(vent.x, vent.z, p, "#c792ea", vent.route ? "HATCH" : "", false);
    if (CBZ.EXIT) { dot(CBZ.EXIT.x, CBZ.EXIT.z, p, "#39ff88", 5); text("EXIT", CBZ.EXIT.x, CBZ.EXIT.z - 3, p, "#8dffb8", 11); }
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

  function drawLots(lots, p) {
    for (const lot of lots || []) {
      ctx.fillStyle = lot.kind === "park" ? "rgba(76,153,82,.62)" : (lot.kind === "abandoned" ? "rgba(146,77,67,.75)" : "rgba(112,127,147,.72)");
      const w = Math.max(3, (lot.w || 18) * p.sc * 0.7), d = Math.max(3, (lot.d || lot.w || 18) * p.sc * 0.7);
      ctx.fillRect(p.x(lot.cx) - w * 0.5, p.z(lot.cz) - d * 0.5, w, d);
    }
  }

  // a labelled point of interest you can navigate to. Colour is icon-like per
  // trade so the map reads at a glance (bank=blue, hospital=red, guns=green…).
  const POI_KINDS = {
    guns: "#8ed24a", jewelry: "#f2c43d", pawn: "#c08a3c", gas: "#ff6b6b", clothing: "#c792ea",
    drugs: "#4caf6e", food: "#ff9e6b", bar: "#e85d8a", bank: "#5b8bff", hardware: "#ffd166",
    gym: "#66d9c0", security: "#9aa6c2", hospital: "#ff5b6b", barber: "#6bb6ff", electronics: "#39d0c0",
    carlot: "#e88a3c", realtor: "#4fd0a0", chop: "#d0a23c", casino: "#c9a227", raceway: "#2f6fed",
    arena: "#d94f45", paintball: "#7ed957", transit: "#39c0d0", cityhall: "#d8dde8", airfield: "#8a93a3",
    racepark: "#b98a5a",
  };
  // ---- BIOME PALETTE: every island/biome region paints with a land fill + a
  // coastline edge so the archipelago reads as REAL ground floating on a sea,
  // not a tiny blob in a black void. WHY: the city is one island among many
  // (desert, forest, snow, speedway, airport, military, farmland) and the map
  // is the only place you see how they connect — so each must be a recognisable
  // shape with its own terrain colour, the way GTA/RDR2 colour their biomes.
  const BIOME_FILL = {
    city: { fill: "#39424e", edge: "#7d8aa0" },
    commerce: { fill: "#3a4636", edge: "#9bb07a" },
    speedway: { fill: "#403a44", edge: "#b98a5a" },
    airport: { fill: "#34373d", edge: "#8a93a3" },
    military: { fill: "#3a3f34", edge: "#6e7a52" },
    desert: { fill: "#5a4f37", edge: "#d9bd86" },
    forest: { fill: "#2f4030", edge: "#5e7e4a" },
    farmland: { fill: "#4a4a2e", edge: "#b9a25a" },
    snow: { fill: "#5a6470", edge: "#dfe8f0" },
    _default: { fill: "#39424e", edge: "#7d8aa0" },
  };
  function biomePal(b) { return BIOME_FILL[b] || BIOME_FILL._default; }
  map.biomePal = biomePal;
  // links (causeways/bridges between islands) draw as thin tan connectors, NOT
  // filled land + named — so they don't clutter the map with "desert-causeway".
  function isLink(rg) { return /causeway|bridge/i.test(rg.name || "") || (rg.pad != null && rg.pad <= 1); }
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
    const cands = (regions || []).filter(function (r) { return !isLink(r); });
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
  function drawPoi(x, z, p, color, label, key) {
    const mx = p.x(x), mz = p.z(z), s = key ? 7 : 5;
    ctx.fillStyle = color; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(mx, mz - s); ctx.lineTo(mx + s, mz); ctx.lineTo(mx, mz + s); ctx.lineTo(mx - s, mz); ctx.closePath();
    ctx.fill(); ctx.stroke();
    if (label) {
      ctx.font = "700 " + (key ? 12 : 10) + "px Fredoka, sans-serif"; ctx.textAlign = "center";
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.strokeText(label, mx, mz - s - 3);
      ctx.fillStyle = key ? "#bfffd9" : "rgba(244,250,255,.96)"; ctx.fillText(label, mx, mz - s - 3);
    }
  }
  function drawPois(lots, p) {
    for (const lot of lots || []) { const info = poiInfo(lot); if (info) drawPoi(lot.cx, lot.cz, p, info.color, info.label, info.key); }
  }
  // glyph-only POIs for the static plate (labels are drawn dynamically + decluttered)
  function drawPoiGlyphs(lots, p) {
    for (const lot of lots || []) { const info = poiInfo(lot); if (info) drawPoi(lot.cx, lot.cz, p, info.color, "", info.key); }
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
        // the district NAME lives on the static lettered layer now — here only
        // WHO holds it, pinned to the zone's top edge like a flag on the line
        if (z.owner) { ctx.textAlign = "center"; ctx.fillStyle = hx; ctx.font = "700 9px Fredoka, sans-serif"; ctx.fillText(isPlayer ? "★ YOURS" : (g ? (g.name || "").toUpperCase() : "CONTESTED"), mx, mz - d / 2 + 13); }
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
        ctx.fillStyle = col; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(mx, mz - s); ctx.lineTo(mx + s, mz); ctx.lineTo(mx, mz + s); ctx.lineTo(mx - s, mz); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.beginPath(); ctx.arc(mx, mz, 2, 0, Math.PI * 2); ctx.fill();
        // crown the gang that holds the most districts (the one to beat)
        if (leader && leader.id === gang.id) { ctx.fillStyle = "#ffd451"; ctx.font = "700 12px Fredoka, sans-serif"; ctx.textAlign = "center"; ctx.fillText("♛", mx, mz - s - 6); }
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
    ctx.fillStyle = "#9fd8ff"; ctx.strokeStyle = "rgba(0,0,0,.65)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(mx, mz - 5.5); ctx.lineTo(mx + 4.6, mz + 3.4); ctx.lineTo(mx - 4.6, mz + 3.4); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  function drawEscapeMark(x, z, p) {
    const mx = p.x(x), mz = p.z(z);
    for (const pass of [["rgba(0,0,0,.6)", 3.2], ["#ffc46b", 1.4]]) {   // dark underlay → amber ladder
      ctx.strokeStyle = pass[0]; ctx.lineWidth = pass[1]; ctx.beginPath();
      ctx.moveTo(mx - 2.2, mz - 5); ctx.lineTo(mx - 2.2, mz + 5);
      ctx.moveTo(mx + 2.2, mz - 5); ctx.lineTo(mx + 2.2, mz + 5);
      for (let r = -3; r <= 3; r += 3) { ctx.moveTo(mx - 2.2, mz + r); ctx.lineTo(mx + 2.2, mz + r); }
      ctx.stroke();
    }
  }
  function drawClimbMarks(p, A) {
    for (const el of (CBZ.cityElevators && CBZ.cityElevators()) || []) { if (el.groundPad) drawLiftMark(el.groundPad.x, el.groundPad.z, p); }
    const lots = (A.lots || []).concat(A.annex ? A.annex.lots || [] : []);
    for (const lot of lots) { const fe = lot.building && lot.building.fireEscape; if (fe) drawEscapeMark(fe.x, fe.z, p); }
  }
  function drawBoardTicks(p) {
    ctx.fillStyle = "rgba(216,206,176,.5)";
    for (const b of CBZ.cityAdBoards || []) ctx.fillRect(p.x(b.x) - 1.5, p.z(b.z) - 1.5, 3, 3);
  }
  function drawRentedBoards(p) {   // dynamic: a lease can lapse while the map is open
    for (const b of CBZ.cityAdBoards || []) {
      if (!b.lease) continue;
      const mx = p.x(b.x), mz = p.z(b.z);
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
    try { fn(); } finally { ctx = main; }
  }
  function buildCityPlates(p, A) {
    plates.a = A;
    plates.p0 = p;   // remember the base projection the plates were baked at
    const sand = "rgba(199,178,124,.35)";
    onPlate(plates.base, function () {
      // ---- ISLANDS / BIOMES FIRST: every registered region is real ground on
      //      the sea, painted with its terrain colour + a sand coastline so the
      //      archipelago reads as a map, not a void with a city blob in it.
      const sandHalo = "rgba(199,178,124,.18)";   // soft blurred beach ring
      for (const rg of A.regions || []) {
        if (isLink(rg)) continue;
        const pal = biomePal(rg.biome);
        strokeRegionRounded(rg, p, sandHalo, 11); // wide diffuse sand halo (the beach ring)
        fillRegionRounded(rg, p, pal.fill);       // rounded land
        strokeRegionRounded(rg, p, sand, 4);      // translucent sand apron
        strokeRegionRounded(rg, p, pal.edge, 1.6);// crisp biome coastline
      }
      // ---- HIGHWAYS: causeways/bridges drawn as connected ROADS (casing +
      //      asphalt + dashed centerline), endpoints snapped onto each shore so
      //      the tarmac visibly touches both landmasses instead of floating.
      const mainRect = { kind: "rect", minX: A.minX, maxX: A.maxX, minZ: A.minZ, maxZ: A.maxZ, pad: 4 };
      for (const rg of A.regions || []) {
        if (!isLink(rg)) continue;
        const ax = linkAxis(rg);
        const others = (A.regions || []).filter(function (r) { return r !== rg; });
        const a = snapEndpointToLand(ax.ax, ax.az, (ax.ax + ax.bx) / 2, (ax.az + ax.bz) / 2, others, mainRect);
        const b = snapEndpointToLand(ax.bx, ax.bz, (ax.ax + ax.bx) / 2, (ax.az + ax.bz) / 2, others, mainRect);
        drawHighway(a.x, a.z, b.x, b.z, ax.wWorld, p, true);
      }
      // ---- MAINLAND: the city island itself, painted as land + coastline ----
      const cp = biomePal("city");
      const mw = (A.maxX - A.minX) * p.sc, mh = (A.maxZ - A.minZ) * p.sc, mr = Math.max(4, Math.min(mw, mh) * 0.08);
      ctx.strokeStyle = sandHalo; ctx.lineWidth = 11; roundRectPath(p.x(A.minX), p.z(A.minZ), mw, mh, mr); ctx.stroke();
      ctx.fillStyle = cp.fill; roundRectPath(p.x(A.minX), p.z(A.minZ), mw, mh, mr); ctx.fill();
      ctx.strokeStyle = sand; ctx.lineWidth = 4; roundRectPath(p.x(A.minX), p.z(A.minZ), mw, mh, mr); ctx.stroke();
      ctx.strokeStyle = cp.edge; ctx.lineWidth = 1.6; roundRectPath(p.x(A.minX), p.z(A.minZ), mw, mh, mr); ctx.stroke();
      // busy-ness wash under the roads (brightness = pop weight)
      eachDistrict(p, A, function (d, mx, mz, w, h, busy) {
        ctx.fillStyle = "rgba(190,216,255," + (0.03 + 0.10 * busy).toFixed(3) + ")";
        ctx.fillRect(mx - w / 2, mz - h / 2, w, h);
      });
      drawRoads(A, p);
      if (A.annex) {
        const ap = biomePal("commerce");
        ctx.fillStyle = ap.fill; ctx.beginPath(); ctx.arc(p.x(A.annex.cx), p.z(A.annex.cz), A.annex.radius * p.sc, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = sand; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x(A.annex.cx), p.z(A.annex.cz), A.annex.radius * p.sc, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = ap.edge; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p.x(A.annex.cx), p.z(A.annex.cz), A.annex.radius * p.sc, 0, Math.PI * 2); ctx.stroke();
        for (const r of A.annex.roads || []) line(r.vertical ? r.x : r.x - r.len / 2, r.vertical ? r.z - r.len / 2 : r.z, r.vertical ? r.x : r.x + r.len / 2, r.vertical ? r.z + r.len / 2 : r.z, p, "rgba(156,168,182,.55)", Math.max(2, 5 * p.sc));
      }
      // big lettered district names over the roads (faint, lots sit on top).
      // No letter-spacing smear — multi-word names stay legible.
      eachDistrict(p, A, function (d, mx, mz, w) {
        const name = (d.name || "").toUpperCase();
        if (!name) return;
        const size = Math.max(10, Math.min(16, (w * 0.9) / Math.max(6, name.length * 0.55)));
        ctx.font = "700 " + size.toFixed(1) + "px Fredoka, sans-serif"; ctx.textAlign = "center";
        ctx.fillStyle = "rgba(222,236,255,.22)";
        ctx.fillText(name, mx, mz + size * 0.35);
      });
      // ---- METROPOLIS TITLE: the mainland city is a named place too, equal to
      //      the islands. A large faint banner sits just above the district grid.
      {
        const title = "PORT VANCE";
        const tsize = Math.max(16, Math.min(34, mw / Math.max(8, title.length * 0.6)));
        ctx.font = "800 " + tsize.toFixed(1) + "px Fredoka, sans-serif"; ctx.textAlign = "center";
        const tx = p.x((A.minX + A.maxX) / 2), ty = p.z(A.minZ) - tsize * 0.5;
        ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.strokeText(title, tx, ty);
        ctx.fillStyle = "rgba(232,242,255,.34)"; ctx.fillText(title, tx, ty);
      }
    });
    onPlate(plates.lots, function () {
      drawLots(A.lots, p);
      if (A.annex) drawLots(A.annex.lots, p);
    });
    onPlate(plates.marks, function () {
      // POI DIAMONDS only (no text) — labels are a dynamic, decluttered pass in
      // drawCity so they don't pile into unreadable mush at the fit zoom.
      drawPoiGlyphs(A.lots, p);
      if (A.annex) drawPoiGlyphs(A.annex.lots, p);
      // REGION / BIOME NAMES at each island's centroid (the map's geography
      // legend — "where is the desert / the snow / the speedway"). Sized to the
      // region's on-screen width so a small island gets a small name.
      // REGION names: the real place name (no letter-spacing smear so multi-word
      // names like "Redhollow Woods" stay readable), with a smaller, fainter
      // subtitle below (e.g. "International Airport"). Sized to the region width.
      for (const rg of A.regions || []) {
        if (isLink(rg)) continue;
        const c = regionCentroid(rg);
        const wpx = (rg.kind === "circle" ? rg.r * 2 : (rg.maxX - rg.minX)) * p.sc;
        const name = rg.name || rg.biome || "";
        if (!name) continue;
        const size = Math.max(11, Math.min(20, wpx / Math.max(6, name.length * 0.55)));
        const nx = p.x(c.x), ny = p.z(c.z);
        ctx.textAlign = "center";
        ctx.font = "700 " + size.toFixed(1) + "px Fredoka, sans-serif";
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.strokeText(name, nx, ny);
        ctx.fillStyle = "rgba(228,238,250,.92)"; ctx.fillText(name, nx, ny);
        if (rg.subtitle) {
          const ssize = Math.max(8, size * 0.8);
          ctx.font = "600 " + ssize.toFixed(1) + "px Fredoka, sans-serif";
          ctx.lineWidth = 2.4; ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.strokeText(rg.subtitle, nx, ny + size * 0.95);
          ctx.fillStyle = "rgba(205,218,232,.5)"; ctx.fillText(rg.subtitle, nx, ny + size * 0.95);
        }
      }
      drawClimbMarks(p, A);
      drawBoardTicks(p);
    });
  }

  // ---- DECLUTTERED POI LABELS (the fix for "label mush") --------------------
  // WHY: drawing a name on every shop turns the map into noise. So labels are
  // TIERED: key POIs (your HOME) are always named; ordinary shops only when
  // you've zoomed IN (view.z>=1.8) or are hovering near them (~70px of the
  // cursor). Then a greedy collision pass measures each candidate and skips any
  // that would overlap one already placed — so what shows always reads clean.
  function labelHit(boxes, x0, y0, x1, y1) {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0) return true;
    }
    return false;
  }
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
    const boxes = [];
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i], s = c.info.key ? 7 : 5, lbl = c.info.label;
      const fs = c.info.key ? 12 : 10;
      ctx.font = "700 " + fs + "px Fredoka, sans-serif"; ctx.textAlign = "center";
      const w = ctx.measureText(lbl).width, ty = c.sy - s - 3;
      const x0 = c.sx - w / 2 - 1, x1 = c.sx + w / 2 + 1, y0 = ty - fs, y1 = ty + 2;
      if (!c.info.key && labelHit(boxes, x0, y0, x1, y1)) continue;   // greedy skip overlaps
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.strokeText(lbl, c.sx, ty);
      ctx.fillStyle = c.info.key ? "#bfffd9" : "rgba(244,250,255,.96)"; ctx.fillText(lbl, c.sx, ty);
      boxes.push({ x0: x0, y0: y0, x1: x1, y1: y1 });
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
    const wanted = (CBZ.game && CBZ.game.wanted) || 0;
    compositePlate(plates.base, p);   // districts + roads + lettering (rescaled)
    // THE BRIDGE — the sole chokepoint between mainland and island. WHY it matters
    // mechanically: at 3★+ the cops seal it (roadblocks), so it turns red + SEALED
    // — the map tells you your island escape is cut off.
    if (A.bridge) {
      const b = A.bridge, mz = (b.minZ + b.maxZ) / 2, sealed = wanted >= 3;
      // proper road casing for the bridge too; turns red overlay when sealed
      drawHighway(b.minX, mz, b.maxX, mz, (b.maxZ - b.minZ), p, true);
      if (sealed) {
        ctx.save(); ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(255,80,70,.7)"; ctx.lineWidth = Math.max(5, (b.maxZ - b.minZ) * p.sc);
        ctx.beginPath(); ctx.moveTo(p.x(b.minX), p.z(mz)); ctx.lineTo(p.x(b.maxX), p.z(mz)); ctx.stroke();
        ctx.restore();
      }
      text(sealed ? "BRIDGE — SEALED" : "BRIDGE", (b.minX + b.maxX) / 2, mz - (b.maxZ - b.minZ) * 0.9, p, sealed ? "#ff8b7a" : "rgba(225,240,255,.42)", 11);
    }
    drawGangTurf(p);   // district control board + HQ crests UNDER the lot/POI layer
    compositePlate(plates.lots, p);   // lot blocks over the turf paint
    // live actors UNDER the labels
    for (let i = 0; i < (CBZ.cityPeds || []).length; i += Math.max(1, Math.ceil(CBZ.cityPeds.length / 380))) {
      const ped = CBZ.cityPeds[i]; if (!ped.dead) dot(ped.pos.x, ped.pos.z, p, "rgba(232,238,245,.62)", 1.6);
    }
    for (const car of CBZ.cityCars || []) if (!car.dead) dot(car.pos.x, car.pos.z, p, "rgba(245,245,255,.7)", 2);
    for (const cop of CBZ.cityCops || []) if (!cop.dead) dot(cop.pos.x, cop.pos.z, p, "#5bd0ff", 2.7);
    compositePlate(plates.marks, p);  // POI diamonds + region names + climb points + board ticks
    drawCityLabels(p, A);             // DECLUTTERED dynamic POI labels (tiered, collision-avoided)
    drawRentedBoards(p);                // the gold $ over the boards that are YOURS
    // ---- EMPIRE: ring every lot YOU own in gold so the economy is spatial ----
    if (CBZ.cityOwnsLot) {
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
      const lk = G.cityLastKnown, rr = (12 + wanted * 10) * p.sc;
      ctx.strokeStyle = "rgba(255,70,55," + (0.35 + 0.25 * npulse).toFixed(2) + ")"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x(lk.x), p.z(lk.z), rr * (0.7 + 0.3 * npulse), 0, Math.PI * 2); ctx.stroke();
      text("LAST SEEN", lk.x, lk.z - (14 + wanted * 10), p, "rgba(255,140,120,.7)", 10);
    }
    if (wanted >= 3 && CBZ.cityChopperPos) {
      const hp = CBZ.cityChopperPos();
      if (hp) {
        const mx = p.x(hp.x), mz = p.z(hp.z);
        ctx.save(); ctx.translate(mx, mz); ctx.rotate(performance.now() * 0.009);
        ctx.strokeStyle = "#ff5040"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.moveTo(0, -10); ctx.lineTo(0, 10); ctx.stroke(); ctx.restore();
        ctx.fillStyle = "#ff5040"; ctx.beginPath(); ctx.arc(mx, mz, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    const job = CBZ.game.cityJob;
    if (job && job.dest) drawPoi(job.dest.x, job.dest.z, p, "#7ed957", "JOB", true);
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
    ctx.clearRect(0, 0, W, H);
    if (which === "city") {
      // OCEAN: the archipelago floats on water, not a black void. A faint depth
      // gradient gives the sea body so the islands read as land at a glance.
      const og = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, Math.max(W, H) * 0.62);
      og.addColorStop(0, "#13334a"); og.addColorStop(1, "#0c2433");
      ctx.fillStyle = og; ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = "#08111d"; ctx.fillRect(0, 0, W, H);
    }
    drawGrid(p);
    if (which === "survival") drawSurvival(p);
    else if (which === "city") drawCity(p);
    else drawEscape(p);
    drawWaypoint(p); drawPlayer(p);
    ctx.fillStyle = "rgba(223,250,255,.82)"; ctx.font = "700 14px Fredoka, sans-serif"; ctx.textAlign = "center"; ctx.fillText("N", W / 2, 18);
    const wp = activeWaypoint();
    const route = activeRoute();
    if (readout) readout.textContent = wp ? "Route: " + waypointDistance(wp) + "m - " + wp.label + (route && route.kind === "fallback" ? " (direct)" : "") : "No waypoint set";
    if (legend) {
      const common = "<span><i style='background:#ff9b3d'></i>You</span><span><i style='background:#7de7ff'></i>Route</span>";
      if (which === "escape") {
        legend.innerHTML = common + "<span><i style='background:#c792ea'></i>Hatch</span><span><i style='background:#ffd451'></i>Guard</span><span><i style='background:#39ff88'></i>Exit</span>";
      } else if (which === "survival") {
        legend.innerHTML = common + "<span><i style='background:#ffe38a'></i>High ground</span><span><i style='background:#e8eef5'></i>Survivor</span>";
      } else {
        // grouped by WHY: Navigation, Threats, Your empire, then the clickable
        // Territory swatches (each routes to that crew's HQ).
        const grp = (t) => "<span style='opacity:.55;font-weight:700;letter-spacing:.5px;margin-left:6px'>" + t + "</span>";
        let html = grp("GO") + common + "<span><i style='background:#39ff88'></i>Home</span><span><i style='background:#7ed957'></i>Job</span>";
        html += grp("HEAT") + "<span><i style='background:#ff6a5a'></i>Police</span><span><i style='background:#ff5040'></i>Chopper 3★+</span><span><i style='background:#ff463a'></i>Last seen</span>";
        html += grp("EMPIRE") + "<span><i style='background:#ffd451;border-radius:50%'></i>Your turf / owned</span><span><i style='background:#ffd451'></i>Boards you rent</span>";
        // ways onto a roof — plan the climb before the chase starts
        html += grp("CLIMB") + "<span><i style='background:#9fd8ff'></i>Lifts</span><span><i style='background:#ffc46b'></i>Fire stairs</span>";
        // one clickable swatch per rival crew → route to their HQ.
        let hasGang = false; let terr = "";
        for (const gang of CBZ.cityGangs || []) {
          if (!gang || gang.isPlayer || gang.absorbed || !gang.turf || !gang.turf.length) continue;
          hasGang = true;
          terr += "<span class='fmGangChip' data-gang='" + esc(String(gang.id)) + "' style='cursor:pointer'>" +
            "<i style='background:" + hex6(gang.color) + "'></i>" + esc(gang.name || "Gang") + "</span>";
        }
        if (hasGang) html += grp("TERRITORY") + terr + "<span style='opacity:.7;font-style:italic'>[click a crew] route to HQ</span>";
        legend.innerHTML = html;
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
  function placeFromEvent(e) {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    const c = evCanvas(e);
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
    if (mode() === "city") map._cursor = { x: c.x, y: c.y };
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
      // a clean click → place the waypoint (left OR right, as before)
      const p = map.projection || makeProjection(boundsFor("city"));
      const c = evCanvas(e);
      setWaypoint(p.wx(c.x), p.wz(c.y));
    }
  }
  cv.addEventListener("mouseup", endDrag);
  cv.addEventListener("mouseleave", function () { drag = null; });
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
  if (closeBtn) closeBtn.addEventListener("click", function () { close(); });

  addEventListener("keydown", function (e) {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === "m") { map.toggle(); e.preventDefault(); }
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
