/* ============================================================
   city/island_speedway.js — THE BULLRING, where it stands in Gang City.

   The racing game is its own page now (games/race.html, src/race/*.js).
   This file is only the PLACE in the city: the island's ground, the
   causeway that reaches it, and the stadium itself, which is built by
   the SAME modules the race page draws (race_core + race_track +
   race_venue), so there is one bowl, one track and one racing codebase.

   From outside it is a closed building: the stands wrap the whole track
   and the exterior is solid. You go in through the main entrance behind
   the front-stretch grandstand, press the verb, and CBZ.cityRaceLaunch()
   opens the race page in a frame over the frozen city (sim stopped, the
   city renderer switched off). "CITY" on the race page sends a message
   back, the frame goes, the purse is paid and the world resumes exactly
   where you left it.

   Wave 0929b gutted the old venue: the 3,700-line island (its own frame
   copy, the showroom campus, the car park, the in-city race weekend,
   the championship, the race book, pink slips, loaners, the city AI
   field and the racing HUD) and speedway_structures.js. Git has them.

   Phone: the stadium is not built with the world. It is built the first
   time you come within BUILD_R of it and hidden past SHOW_R; the island
   ground, the causeway and the exterior colliders are cheap and built
   with the world so traffic and the map are right from the start.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const RC = CBZ.race && CBZ.race.core;

  // ---- footprint (unchanged: the world layout, the desert strait, the
  //      causeway lane and the map are all planned around these numbers) ----
  const _WOFF = (CBZ.worldOff && CBZ.worldOff("speedway")) || { dx: 0, dz: 0 };
  const CX = 490 + _WOFF.dx, CZ = -350 + _WOFF.dz, R = 210;
  const SITE_HX = 214, SITE_HZ = 182, SITE_DZ = -23, SITE_POW = 2.45;
  const ACCESS_Z = CZ - 190;
  const CW_X = 348;                          // the causeway lane (x 336..360)

  /* THE BOWL IN CITY COORDINATES. The race modules author the circuit with
     the front stretch toward +z (south). Here the public arrives from the
     north, so the venue is turned half a turn: city = V - core. */
  const VX = CX, VZ = CZ + 12;
  const toCity = (x, z, o) => { o = o || {}; o.x = VX - x; o.z = VZ - z; return o; };

  const BUILD_R = 1300, SHOW_R = 2600;
  const QUALITY = ("ontouchstart" in window) || navigator.maxTouchPoints > 0 ? "low" : "high";

  // ---- the causeway leaves the annex (expansion.js reads annexPorts) -------
  CBZ.annexPorts = (CBZ.annexPorts || []).filter(function (p) { return p && p.name !== "Diamond Causeway"; });
  CBZ.annexPorts.push({ name: "Diamond Causeway", side: "south", x: CW_X, half: 14.4 });
  let CW_START_Z = -585, CW_REC_Z = -585;
  function annexDock(city) {
    CW_START_Z = CW_REC_Z = -585;
    const S = city && city.annex && city.annex.streets && city.annex.streets.south;
    if (!S || !isFinite(S.z) || !isFinite(S.hw)) return;
    if (S.x0 > CW_X - 12 || S.x1 < CW_X + 12) return;
    CW_START_Z = S.z + S.hw;
    CW_REC_Z = S.z;
  }

  // ---- the site boundary (a superellipse: a campus cut into the country) --
  function siteEdge(a, m) {
    const ca = Math.cos(a), sa = Math.sin(a), p = 2 / SITE_POW;
    return {
      x: CX + Math.sign(ca) * Math.pow(Math.abs(ca), p) * (SITE_HX - m),
      z: CZ + SITE_DZ + Math.sign(sa) * Math.pow(Math.abs(sa), p) * (SITE_HZ - m),
    };
  }

  /* THE ENTRANCE: where the venue says its public gate is, in city space,
     plus the point on the plaza the player stands on to use it. */
  let ENT = null;
  function entrance() {
    if (ENT) return ENT;
    if (!RC) return null;
    const me = VENUE_SPEC.mainEntrance;
    const f = RC.frame(me.s), out = me.u + 7;
    const p = toCity(f.x + f.nx * out, f.z + f.nz * out);
    const door = toCity(f.x + f.nx * me.u, f.z + f.nz * me.u);
    // facing the door from the plaza: the direction city-space -normal
    ENT = { x: p.x, z: p.z, doorX: door.x, doorZ: door.z, heading: Math.atan2(door.x - p.x, door.z - p.z) };
    return ENT;
  }
  CBZ.speedwayGate = function () {
    const e = entrance();
    return e ? { x: e.x, z: e.z, heading: e.heading } : null;
  };

  /* What the city needs to know about the stadium BEFORE it is built: where
     the outside of the stands is (colliders, the plaza) and where the gate
     is. race_venue.js answers both from the frame alone. */
  const VENUE_SPEC = RC && CBZ.race.venue ? CBZ.race.venue.spec(RC) : null;

  // ---- colliders ------------------------------------------------------------
  function solidYaw(cx, cz, hw, hd, yaw, y0, y1) {
    CBZ.colliders.push(CBZ.orientedCollider(cx, cz, hw, hd, yaw, y0 || 0, y1));
  }

  // ====================================================================== //
  //  THE ISLAND (built with the world)                                      //
  // ====================================================================== //
  CBZ.addLandmass(function (city) {
    const root = city.root;
    if (!root || !RC || !VENUE_SPEC) return;
    annexDock(city);
    ENT = null;
    const L = RC.DIMS.L;

    // ---- the ground: country grass, a paved ring round the stadium, the
    //      entrance plaza and the approach apron; one canvas, one mesh ----
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1024;
    const c2 = cv.getContext("2d");
    const SPAN = Math.max(SITE_HX, SITE_HZ + Math.abs(SITE_DZ)) + 4;
    const px = (x) => (x - (CX - SPAN)) / (2 * SPAN) * 1024;
    const pz = (z) => (z - (CZ - SPAN)) / (2 * SPAN) * 1024;
    c2.fillStyle = "#5f7a4a"; c2.fillRect(0, 0, 1024, 1024);
    c2.globalAlpha = 0.08; c2.fillStyle = "#3f5a33";
    for (let y = 0; y < 1024; y += 36) c2.fillRect(0, y, 1024, 16);
    c2.globalAlpha = 1;
    function ring(extra) {
      c2.beginPath();
      for (let i = 0; i <= 240; i++) {
        const s = i / 240 * L, f = RC.frame(s), u = VENUE_SPEC.outerU(s) + extra;
        const p = toCity(f.x + f.nx * u, f.z + f.nz * u);
        if (i === 0) c2.moveTo(px(p.x), pz(p.z)); else c2.lineTo(px(p.x), pz(p.z));
      }
      c2.closePath();
    }
    ring(16); c2.fillStyle = "#44474c"; c2.fill();                 // the concourse apron round the bowl
    ring(15); c2.strokeStyle = "rgba(230,232,236,.35)"; c2.lineWidth = 2; c2.stroke();
    const E = entrance();
    // the plaza: from the approach road up to the main gate
    c2.fillStyle = "#55585d";
    const pzx0 = Math.min(E.doorX - 38, CX - 80), pzx1 = E.doorX + 38;
    c2.fillRect(px(pzx0), pz(ACCESS_Z - 14), px(pzx1) - px(pzx0), pz(E.doorZ + 2) - pz(ACCESS_Z - 14));
    // plaza paving joints
    c2.strokeStyle = "rgba(255,255,255,.08)"; c2.lineWidth = 1;
    for (let x = pzx0; x < pzx1; x += 6) { c2.beginPath(); c2.moveTo(px(x), pz(ACCESS_Z - 14)); c2.lineTo(px(x), pz(E.doorZ)); c2.stroke(); }
    const tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    if (CBZ.freeCanvasAfterUpload) CBZ.freeCanvasAfterUpload(tex);   // painted once: the canvas goes once uploaded
    const shape = new THREE.Shape();
    for (let i = 0; i <= 192; i++) {
      const p = siteEdge(i / 192 * Math.PI * 2, 0);
      if (i === 0) shape.moveTo(p.x - CX, -(p.z - CZ)); else shape.lineTo(p.x - CX, -(p.z - CZ));
    }
    const geo = new THREE.ShapeGeometry(shape, 12);
    const pa = geo.attributes.position, uv = new Float32Array(pa.count * 2);
    for (let i = 0; i < pa.count; i++) {
      uv[i * 2] = (pa.getX(i) + SPAN) / (2 * SPAN);
      uv[i * 2 + 1] = (pa.getY(i) + SPAN) / (2 * SPAN);
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const gm = new THREE.MeshLambertMaterial({ map: tex });
    gm.polygonOffset = true; gm.polygonOffsetFactor = 1; gm.polygonOffsetUnits = 2;
    const ground = new THREE.Mesh(geo, gm);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(CX, 0.015, CZ);
    ground.receiveShadow = true;
    ground.userData.terrain = true; ground.userData.worldSurface = true;
    ground.matrixAutoUpdate = false; ground.updateMatrix();
    root.add(ground);

    // ---- the causeway, through to the plaza -----------------------------------
    const endX = Math.min(E.doorX - 30, CX - 60);
    if (CBZ.buildHighway) {
      CBZ.buildHighway(root, {
        path: [{ x: CW_X, z: CW_START_Z }, { x: CW_X, z: ACCESS_Z }, { x: endX, z: ACCESS_Z }],
        width: 24, lanesPerDir: 3, median: true, medianW: 1.2, laneW: 3.6, theme: "asphalt",
        guardrail: false, elevated: false, rng: CBZ.seedStream ? CBZ.seedStream("speedway") : null,
      });
    }

    // ---- the outside of the stands is a wall: oriented boxes round the bowl --
    for (let s = 0; s < L; s += 7) {
      const s1 = Math.min(L, s + 7), sm = (s + s1) / 2;
      const f = RC.frame(sm), u = VENUE_SPEC.outerU(sm) - 1.2;
      const p = toCity(f.x + f.nx * u, f.z + f.nz * u);
      // city tangent is the core tangent turned half a turn
      solidYaw(p.x, p.z, (s1 - s) * 0.62, 1.4, Math.atan2(f.tz, -f.tx), 0, VENUE_SPEC.height || 30);
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();

    // ---- regions and roads (the map, traffic, the biome) ---------------------
    CBZ.registerCityRegion(city, { name: "Diamond Speedway", subtitle: "The Bullring", biome: "speedway", kind: "circle", cx: CX, cz: CZ, r: R, pad: 6, underlay: true, terrainGrade: true });
    CBZ.registerCityRegion(city, { name: "Diamond Causeway", subtitle: "The Bullring", biome: "speedway", kind: "rect", minX: CW_X - 12, maxX: CW_X + 12, minZ: CW_START_Z, maxZ: ACCESS_Z + 12, pad: 1 });
    CBZ.registerCityRegion(city, { name: "Diamond Causeway", subtitle: "The Bullring", biome: "speedway", kind: "rect", minX: 336, maxX: endX + 12, minZ: ACCESS_Z - 12, maxZ: ACCESS_Z + 12, pad: 1 });
    if (city.roads) {
      city.roads.push({ x: CW_X, z: (CW_REC_Z + ACCESS_Z) / 2, vertical: true, len: ACCESS_Z - CW_REC_Z, district: "highway", w: 24, lanesPerDir: 3, laneW: 3.6, median: true, medianW: 1.2 });
      city.roads.push({ x: (348 + endX) / 2, z: ACCESS_Z, vertical: false, len: endX - 348, district: "highway", w: 24, lanesPerDir: 3, laneW: 3.6, median: true, medianW: 1.2, venueSite: "speedway" });
    }

    STAD.root = root; STAD.built = null;
    // a one-shot page raising this island (CBZ.studio.raise: NPC War's
    // speedway map) has no player walking up to it: build the bowl now
    if (CBZ.addLandmass._studioCollector) buildStadium();
  }, 20);

  // ====================================================================== //
  //  THE STADIUM (built when you come near, hidden when you are far)        //
  // ====================================================================== //
  const STAD = { root: null, built: null, group: null, track: null, venue: null };
  function buildStadium() {
    // a world rebuild made a new root: the old bowl goes with the old world
    if (STAD.group) {
      if (STAD.group.parent) STAD.group.parent.remove(STAD.group);
      STAD.track.dispose(); STAD.venue.dispose();
    }
    const grp = new THREE.Group(); grp.name = "bullring";
    grp.position.set(VX, 0, VZ); grp.rotation.y = Math.PI;
    STAD.track = CBZ.race.track.build(THREE, RC, { quality: QUALITY });
    STAD.venue = CBZ.race.venue.build(THREE, RC, { quality: QUALITY });
    grp.add(STAD.track.group); grp.add(STAD.venue.group);
    // the race page's own parking lot and far skyline band are for a page
    // with nothing around it; Gang City is what is around it here
    const sur = STAD.venue.surroundings;
    if (sur && sur.parent) sur.parent.remove(sur);
    grp.userData.dynamic = true;             // core/batch.js never bakes the bowl (it animates, and it is torn down)
    STAD.root.add(grp);
    STAD.group = grp; STAD.built = STAD.root;
    STAD.venue.setLights(0, false);
  }
  CBZ.onUpdate(55.5, function (dt) {
    if (!g || g.mode !== "city" || !STAD.root || !RC) return;
    const P = CBZ.player; if (!P || !P.pos) return;
    const d = Math.hypot(P.pos.x - VX, P.pos.z - VZ);
    if (STAD.built !== STAD.root) {
      if (d > BUILD_R) return;
      buildStadium();
    }
    const show = d < SHOW_R;
    if (STAD.group.visible !== show) STAD.group.visible = show;
    if (!show) return;
    STAD.venue.update(dt, { excite: 0.05, flag: "green", leaderNumber: 0, camera: CBZ.camera });
    if (STAD.track.update) STAD.track.update(dt, CBZ.camera);
  });

  // ====================================================================== //
  //  THE GATE AND THE LAUNCH                                                //
  // ====================================================================== //
  const PURSE = [5000, 3000, 2000, 1500, 1000, 800, 600, 400, 300, 200];
  let frame = null, renderWas = null;
  function onMessage(ev) {
    if (!frame || ev.source !== frame.contentWindow) return;
    const d = ev.data;
    if (d && d.type === "race-exit") closeRace(d);
  }
  CBZ.cityRaceLaunch = function () {
    if (frame) return false;
    if (CBZ.setState) CBZ.setState("racing");            // not "playing": the sim stops, and no pause card
    try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
    renderWas = CBZ.CONFIG.RENDER_FRAMES;
    CBZ.CONFIG.RENDER_FRAMES = false;                    // the city draws nothing while you race
    frame = document.createElement("iframe");
    frame.src = "games/race.html?from=city&go=1";
    frame.setAttribute("allow", "autoplay; fullscreen; gamepad");
    frame.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483600;background:#07080b";
    frame.addEventListener("load", function () { try { frame.contentWindow.focus(); } catch (e) {} });
    document.body.appendChild(frame);
    window.addEventListener("message", onMessage);
    return true;
  };
  function closeRace(res) {
    window.removeEventListener("message", onMessage);
    if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
    frame = null;
    CBZ.CONFIG.RENDER_FRAMES = renderWas;
    const pay = res && res.place > 0 ? PURSE[res.place - 1] || 0 : 0;
    if (pay && CBZ.city && CBZ.city.addCash) CBZ.city.addCash(pay);
    if (pay && CBZ.city && CBZ.city.note) CBZ.city.note("P" + res.place + "   +$" + pay.toLocaleString("en-US"), 3);
    // paused, not playing: the Resume click is the gesture pointer lock needs
    if (CBZ.setState) CBZ.setState("paused");
  }

  if (CBZ.interactions && CBZ.interactions.registerZone) {
    const I = CBZ.interactions;
    I.registerZone({
      id: "zone-speedway-race", kind: "speedway", prio: 9, driving: true,
      find: function (x, z) {
        const e = entrance();
        if (!e || Math.hypot(x - e.x, z - e.z) > 16) return null;
        return e;
      },
      options: [{
        id: "speedway-race", slot: "i",
        label: function () { return "Race"; },
        onSelect: function () { CBZ.cityRaceLaunch(); },
      }],
    });
    if (I.describe) I.describe("speedway", function () { return { label: "The Bullring", note: "" }; });
  }
})();
