/* ============================================================
   systems/fullmap.js - shared full-screen navigation map.

   M opens a north-up map in every mode. Left-click or right-click places a
   mode-local waypoint; after the map closes a compact arrow keeps guiding the
   player without replacing the prison objective compass.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const root = document.getElementById("fullMap");
  const cv = document.getElementById("fullMapCanvas");
  if (!CBZ || !root || !cv) return;

  const ctx = cv.getContext("2d");
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

  function makeProjection(bounds) {
    const sw = bounds.maxX - bounds.minX, sh = bounds.maxZ - bounds.minZ;
    const sc = Math.min((W - PAD * 2) / sw, (H - PAD * 2) / sh);
    const left = (W - sw * sc) * 0.5, top = (H - sh * sc) * 0.5;
    return {
      bounds, sc, left, top,
      x(wx) { return left + (wx - bounds.minX) * sc; },
      z(wz) { return top + (wz - bounds.minZ) * sc; },
      wx(mx) { return bounds.minX + (mx - left) / sc; },
      wz(mz) { return bounds.minZ + (mz - top) / sc; },
    };
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
    ctx.fillStyle = "#ff9b3d"; ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(-6, 5); ctx.lineTo(-4, 0); ctx.lineTo(-6, -5); ctx.closePath(); ctx.fill();
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
  // shared so the corner minimap (city/hud.js) colours shops by the SAME trade
  // palette as the full map — bank=blue, guns=green, hospital=red, HOME=lime…
  map.poi = poiInfo;

  function drawCity(p) {
    const A = CBZ.city && CBZ.city.arena;
    if (!A) { text("CITY DISTRICT", 0, (CBZ.CITY && CBZ.CITY.center.z) || -700, p, "rgba(235,245,255,.5)", 18); return; }
    drawRoads(A, p);
    // the bridge linking the mainland to the island district (so the two halves
    // read as one connected city instead of two blobs floating in a void)
    if (A.bridge) {
      const b = A.bridge, mz = (b.minZ + b.maxZ) / 2;
      line(b.minX, mz, b.maxX, mz, p, "rgba(156,168,182,.5)", Math.max(3, (b.maxZ - b.minZ) * p.sc * 0.8));
      text("BRIDGE", (b.minX + b.maxX) / 2, mz - (b.maxZ - b.minZ) * 0.9, p, "rgba(225,240,255,.42)", 11);
    }
    drawLots(A.lots, p);
    if (A.annex) {
      ctx.fillStyle = "rgba(120,150,110,.20)"; ctx.beginPath(); ctx.arc(p.x(A.annex.cx), p.z(A.annex.cz), A.annex.radius * p.sc, 0, Math.PI * 2); ctx.fill();
      for (const r of A.annex.roads || []) line(r.vertical ? r.x : r.x - r.len / 2, r.vertical ? r.z - r.len / 2 : r.z, r.vertical ? r.x : r.x + r.len / 2, r.vertical ? r.z + r.len / 2 : r.z, p, "rgba(156,168,182,.55)", Math.max(2, 5 * p.sc));
      drawLots(A.annex.lots, p);
      text("ISLAND", A.annex.cx, A.annex.cz - A.annex.radius + 9, p, "rgba(225,240,255,.42)", 13);
    }
    // live actors UNDER the labels
    for (let i = 0; i < (CBZ.cityPeds || []).length; i += Math.max(1, Math.ceil(CBZ.cityPeds.length / 380))) {
      const ped = CBZ.cityPeds[i]; if (!ped.dead) dot(ped.pos.x, ped.pos.z, p, "rgba(232,238,245,.62)", 1.6);
    }
    for (const car of CBZ.cityCars || []) if (!car.dead) dot(car.pos.x, car.pos.z, p, "rgba(245,245,255,.7)", 2);
    for (const cop of CBZ.cityCops || []) if (!cop.dead) dot(cop.pos.x, cop.pos.z, p, "#5bd0ff", 2.7);
    // labelled POIs on top — this is what makes the map actually navigable
    drawPois(A.lots, p);
    if (A.annex) drawPois(A.annex.lots, p);
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
    ctx.fillStyle = "#08111d"; ctx.fillRect(0, 0, W, H);
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
      legend.innerHTML = which === "escape" ? common + "<span><i style='background:#c792ea'></i>Hatch</span><span><i style='background:#ffd451'></i>Guard</span><span><i style='background:#39ff88'></i>Exit</span>" :
        (which === "survival" ? common + "<span><i style='background:#ffe38a'></i>High ground</span><span><i style='background:#e8eef5'></i>Survivor</span>" :
          common + "<span><i style='background:#39ff88'></i>Home</span><span><i style='background:#5bd0ff'></i>Police</span><span><i style='background:#7ed957'></i>Job</span>");
    }
  }
  map.draw = draw;

  function updateGuide() {
    const wp = activeWaypoint();
    if (!guide) return;
    guide.classList.toggle("show", !!wp && !map.active);
    if (!wp || !CBZ.player || !CBZ.player.pos) return;
    const nav = CBZ.navigation && CBZ.navigation.next(activeRoute(), CBZ.player.pos);
    const target = nav ? nav.target : wp;
    const dx = target.x - CBZ.player.pos.x, dz = target.z - CBZ.player.pos.z;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
    const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const forward = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
    if (arrow) arrow.style.transform = "rotate(" + (Math.atan2(right, forward) * 180 / Math.PI).toFixed(1) + "deg)";
    if (distEl) distEl.textContent = (nav ? Math.round(nav.remaining) : Math.round(Math.hypot(dx, dz))) + "m";
    if (labelEl) labelEl.textContent = (nav ? nav.instruction + " - " : "") + (wp.label || "Waypoint");
  }

  function placeFromEvent(e) {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * W / r.width, z = (e.clientY - r.top) * H / r.height;
    const p = map.projection || makeProjection(boundsFor(mode()));
    setWaypoint(p.wx(x), p.wz(z));
  }

  cv.addEventListener("mousedown", placeFromEvent);
  cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  if (closeBtn) closeBtn.addEventListener("click", function () { close(); });

  addEventListener("keydown", function (e) {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === "m") { map.toggle(); e.preventDefault(); }
    else if (map.active && e.key === "Escape") { close(); e.preventDefault(); }
    else if (map.active && (e.key === "Backspace" || e.key === "Delete")) { clearWaypoint(); e.preventDefault(); }
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
    updateGuide();
  });
})();
