/* ============================================================
   city/roadrules.js — WHAT ROAD AM I ON, AND WHAT IS IT POSTED AT.

   THE SEAM THIS FILLS
   -------------------
   city/carcluster.js draws a speed-limit roundel and openly declared its own
   query a stopgap: it defined CBZ.roadSpeedLimit ONLY IF nobody else had, and
   derived a limit from highway footprints plus the district of the nearest
   LOT — i.e. from the buildings beside you, not from the road under you. That
   was honest about being wrong: a lot's district is a decent guess in a dense
   grid and a bad one on a causeway, and it could not tell a 3+3 freeway from
   the two-lane dirt track crossing it.

   The real answer was already in the world. Every road builder in this game
   pushes the SAME record onto city.roads — {x, z, vertical, len, w, district,
   lanesPerDir, laneW, median} — the continent's frontier loop, the biome
   causeways, the arterial grid, the highway network. Nobody had ever asked
   that list a question. This file asks it.

   WHAT IT PUBLISHES
   -----------------
     CBZ.roadSegmentAt(x, z)    the road record under a point, or null
     CBZ.roadSpeedLimit(x, z)   mph, real, per segment; 0 = unposted
     CBZ.roadRulesAudit()       {segments, fallback, ticketed}

   Because this file loads BEFORE carcluster.js, carcluster's `if
   (!CBZ.roadSpeedLimit)` guard never fires and its fallback simply never
   exists — no migration, no edit there, and CBZ.clusterAudit().limitIsFallback
   reads false, which is exactly what that audit was put there to detect.

   AND THE LIMIT NOW MEANS SOMETHING
   ---------------------------------
   `"speed": { stars: 1, label: "Reckless Driving" }` has sat in wanted.js's
   crime table with ZERO callers — a textbook stat fiction of the kind
   CLAUDE.md bans by name: a complete enforcement path behind a door nothing
   opens. A posted limit with no consequence would have been a SECOND one
   painted on top of it. So the roundel is now a real number: hold well over
   the posted limit where a cop can see you and you get pulled up for it,
   through the ordinary crime bus (no new heat channel, no new star ladder).

   The tolerance is deliberately generous and the trigger is SUSTAINED, not
   instantaneous. Real enforcement does not ticket a two-second overtake, and
   a game that did would make every road feel like a trap.

   Flags: ROAD_RULES (the whole file) · ROAD_SPEED_ENFORCE (the ticket only,
   so you can keep the honest roundel and turn the consequence off).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.CONFIG = CBZ.CONFIG || {};

  if (CBZ.CONFIG.ROAD_RULES == null) CBZ.CONFIG.ROAD_RULES = true;
  if (CBZ.CONFIG.ROAD_SPEED_ENFORCE == null) CBZ.CONFIG.ROAD_SPEED_ENFORCE = true;
  // mph over the posted limit before anyone cares, and how long you must hold
  // it. 14 over for 3 s is "you are obviously speeding", not "you overtook".
  if (CBZ.CONFIG.ROAD_SPEED_TOL == null) CBZ.CONFIG.ROAD_SPEED_TOL = 14;
  if (CBZ.CONFIG.ROAD_SPEED_HOLD == null) CBZ.CONFIG.ROAD_SPEED_HOLD = 3.0;

  const MPH_PER_UNIT = 2.4;          // vehicles.js:68 — the repo's own figure
  function on() { return CBZ.CONFIG.ROAD_RULES !== false; }

  /* ---- POSTED LIMITS ----------------------------------------------------
     Keyed on the district tag the road builders already stamp. These are
     ordinary US posted speeds, and the only derived number is the freeway
     one: a divided 3+3 is posted higher than an undivided two-lane, which is
     why lanesPerDir is read rather than assumed. */
  const LIMIT = {
    highway: 55,          // raised to 65 below when it is a real divided 3+3
    freeway: 65,
    bridge: 45,
    causeway: 45,
    arterial: 45,
    industrial: 35,
    commercial: 30,
    core: 30,
    downtown: 30,
    residential: 25,
    suburb: 25,
    projects: 25,
    park: 20,
  };
  const LIMIT_DEFAULT = 30;

  function limitOf(r) {
    if (!r) return 0;
    if (r.speedLimit != null) return r.speedLimit | 0;      // a builder may post its own
    const d = String(r.district || "").toLowerCase();
    let mph = LIMIT[d] != null ? LIMIT[d] : LIMIT_DEFAULT;
    if (d === "highway" || d === "freeway") {
      const L = CBZ.roadLanes ? CBZ.roadLanes(r) : { lanesPerDir: r.lanesPerDir || 2, median: !!r.median };
      // divided, three lanes each way = the real freeway cross-section
      mph = (L.lanesPerDir >= 3 && L.median) ? 65 : (L.lanesPerDir >= 3 ? 60 : 55);
    }
    // An unpaved surface is posted low no matter what district it crosses —
    // the frontier loop is a long open road, but it is not a freeway.
    if (r.theme === "dirt" || r.dirt) mph = Math.min(mph, 35);
    else if (r.frontier) mph = Math.min(mph, 55);
    return mph;
  }

  /* ---- WHICH SEGMENT ----------------------------------------------------
     city.roads is a flat list of axis-aligned segments and can run to a few
     hundred entries once the continent's outer loop and every biome causeway
     are in it, so a linear scan per frame per car is not free. One lazy
     uniform bucket grid, rebuilt only when the list length changes (which is
     exactly when the world was rebuilt), makes the query O(few). */
  const CELL = 64;
  let grid = null, gridN = -1, gMinX = 0, gMinZ = 0, gW = 0, gH = 0;

  function roadsList() {
    const c = CBZ.city;
    if (!c) return null;
    const A = c.arena && c.arena.roads ? c.arena : c;
    return A.roads || null;
  }
  function halfSpan(r) {
    const w = (r.w != null ? r.w : (r.width != null ? r.width : (CBZ.CITY && CBZ.CITY.road) || 18)) / 2;
    const l = (r.len != null ? r.len : 0) / 2;
    return r.vertical ? { hx: w, hz: l } : { hx: l, hz: w };
  }
  function rebuild(R) {
    let minX = 1e18, minZ = 1e18, maxX = -1e18, maxZ = -1e18;
    for (let i = 0; i < R.length; i++) {
      const r = R[i]; if (!r) continue;
      const h = halfSpan(r);
      if (r.x - h.hx < minX) minX = r.x - h.hx;
      if (r.x + h.hx > maxX) maxX = r.x + h.hx;
      if (r.z - h.hz < minZ) minZ = r.z - h.hz;
      if (r.z + h.hz > maxZ) maxZ = r.z + h.hz;
    }
    if (!(minX < maxX)) { grid = null; gridN = R.length; return; }
    gMinX = minX; gMinZ = minZ;
    gW = Math.max(1, Math.ceil((maxX - minX) / CELL));
    gH = Math.max(1, Math.ceil((maxZ - minZ) / CELL));
    // A world-spanning frontier loop would smear across every cell of a grid
    // sized to it, so cap the bucket count and let the rare giant segment sit
    // in many cells rather than let the grid itself explode.
    if (gW * gH > 40000) { grid = null; gridN = R.length; return; }
    grid = new Array(gW * gH);
    for (let i = 0; i < R.length; i++) {
      const r = R[i]; if (!r) continue;
      const h = halfSpan(r);
      const x0 = Math.max(0, Math.floor((r.x - h.hx - gMinX) / CELL));
      const x1 = Math.min(gW - 1, Math.floor((r.x + h.hx - gMinX) / CELL));
      const z0 = Math.max(0, Math.floor((r.z - h.hz - gMinZ) / CELL));
      const z1 = Math.min(gH - 1, Math.floor((r.z + h.hz - gMinZ) / CELL));
      for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
        const k = cz * gW + cx;
        (grid[k] || (grid[k] = [])).push(r);
      }
    }
    gridN = R.length;
  }

  // The road under a point. `pad` (default 0) widens the test — pass a couple
  // of metres to count the shoulder as "on the road".
  CBZ.roadSegmentAt = function (x, z, pad) {
    if (!on()) return null;
    const R = roadsList();
    if (!R || !R.length) return null;
    if (gridN !== R.length) rebuild(R);
    const p = pad || 0;
    let list = R;
    if (grid) {
      const cx = Math.floor((x - gMinX) / CELL), cz = Math.floor((z - gMinZ) / CELL);
      if (cx < 0 || cz < 0 || cx >= gW || cz >= gH) return null;
      list = grid[cz * gW + cx];
      if (!list) return null;
    }
    // Overlapping segments are normal here (the causeway connectors exist
    // precisely to overlap), so pick the one whose centreline you are nearest
    // — that is the road you are actually driving on.
    let best = null, bd = 1e18;
    for (let i = 0; i < list.length; i++) {
      const r = list[i]; if (!r) continue;
      const h = halfSpan(r);
      const dx = Math.abs(x - r.x), dz = Math.abs(z - r.z);
      if (dx > h.hx + p || dz > h.hz + p) continue;
      const off = r.vertical ? dx : dz;       // distance from the centreline
      if (off < bd) { bd = off; best = r; }
    }
    return best;
  };

  CBZ.roadSpeedLimit = function (x, z) {
    if (!on()) return 0;
    // 3m of pad: you are still "on" the road while straddling the shoulder,
    // and a limit that blinked out every time you clipped a kerb would read
    // as a bug rather than as open country.
    return limitOf(CBZ.roadSegmentAt(x, z, 3));
  };
  // Not a fallback. carcluster.js's audit reads this exact marker.
  CBZ.roadSpeedLimit._fallback = false;

  /* ---- ENFORCEMENT -------------------------------------------------------
     The red-light ticket in city/traffic.js is the precedent and this
     deliberately copies its shape: a cooldown, a "was it actually seen"
     test, one CBZ.cityCrime call, one line of narration. No new heat
     channel — speeding is a 1-star Reckless Driving charge on the same
     ladder as everything else, which is what wanted.js already said it was
     going to be before anything called it. */
  let over = 0, ticketCD = 0, ticketed = 0;

  function copSees(x, z, r) {
    const cops = CBZ.cityCops;
    if (!cops || !cops.length) return false;
    const r2 = r * r;
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i];
      if (!c || c.dead || !c.pos) continue;
      const dx = c.pos.x - x, dz = c.pos.z - z;
      if (dx * dx + dz * dz < r2) return true;
    }
    // A manned checkpoint is a radar trap: it sees you whether or not an
    // officer happens to be standing in the road. Feature-detected so this
    // file does not depend on the checkpoints existing.
    return !!(CBZ.cityCheckpointWatching && CBZ.cityCheckpointWatching(x, z));
  }

  CBZ.onUpdate(37.2, function (dt) {
    if (ticketCD > 0) ticketCD -= dt;
    if (!on() || CBZ.CONFIG.ROAD_SPEED_ENFORCE === false) { over = 0; return; }
    const g = CBZ.game;
    if (!g || g.mode !== "city" || g.state !== "playing") { over = 0; return; }
    const P = CBZ.player;
    if (!P || P.dead || !P.driving || !P._vehicle || P._aircraft) { over = 0; return; }
    const car = P._vehicle;
    const feel = car._playerCarFeel;
    if (feel && feel.class === "marine") { over = 0; return; }
    // Already wanted? Then you are not being ticketed for speeding, you are
    // being chased — piling a traffic charge on top of a pursuit is noise.
    if ((g.wanted | 0) >= 1) { over = 0; return; }

    const p = car.group ? car.group.position : car.pos;
    if (!p) { over = 0; return; }
    const limit = CBZ.roadSpeedLimit(p.x, p.z);
    if (limit <= 0) { over = 0; return; }                 // unposted: open country
    const mph = Math.abs(car.v || 0) * MPH_PER_UNIT;
    if (mph <= limit + CBZ.CONFIG.ROAD_SPEED_TOL) { over = 0; return; }

    over += dt;
    if (over < CBZ.CONFIG.ROAD_SPEED_HOLD || ticketCD > 0) return;
    over = 0;
    if (!copSees(p.x, p.z, 46)) return;                   // unseen is unpunished
    ticketCD = 22;                                        // don't stack tickets
    ticketed++;
    if (CBZ.cityCrime) CBZ.cityCrime(18, { type: "speed", x: p.x, z: p.z });
    if (CBZ.city && CBZ.city.note) {
      CBZ.city.note("Clocked at " + Math.round(mph) + " in a " + limit + ".", 2.2);
    }
  });

  /* ---- THE RATCHET ------------------------------------------------------
     `fallback` must read FALSE: it is true only if carcluster.js's stopgap is
     still the thing answering, which would mean this file failed to load or
     loaded too late. `segments` is evidence, not a pin. */
  CBZ.roadRulesAudit = function () {
    const R = roadsList();
    return {
      segments: R ? R.length : 0,
      fallback: !!(CBZ.roadSpeedLimit && CBZ.roadSpeedLimit._fallback),
      ticketed: ticketed,
    };
  };
})();
