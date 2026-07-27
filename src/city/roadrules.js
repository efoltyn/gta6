/* ============================================================
   city/roadrules.js — WHAT ROAD AM I ON, WHAT IS IT POSTED AT,
                       AND — IS AMBIENT TRAFFIC ALLOWED ON IT.

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

   AND — NEW — WHO IS ALLOWED ON IT, AND WHERE ON IT A CAR GOES
   -------------------------------------------------------------
   OWNER REPORT: "there are cars spawning randomly inside airport near runway
   etc, its dumb — shows how dumb traffic and car spawning is."

   He was right, and the reason is structural. FOUR separate places in this
   game pick a road and put a car on it — vehicles.js's spawnCityTraffic,
   traffic.js's recycleOne, its placeOnRoad, and its far-region seeder — and
   every one of them re-typed the same eight lines:

       const r = A.roads[(rnd() * A.roads.length) | 0];      // ANY segment
       const along = (rnd() - 0.5) * r.len * 0.85;           // ANY point on it
       ... lane / x / z / heading ...

   `A.roads` is a FLAT LIST. It does not care that one of its entries is the
   airport causeway, that another is the military perimeter, or that the city
   already declared — in `arena.noSpawn`, honoured by every PED path since the
   day the owner complained about people on the runway — that the airside is a
   keep-out. Peds respected the airport. Cars had never been told it existed.

   So this file now also answers the question the road list was never asked:

     CBZ.roadOpen(r)              may ambient traffic use this segment at all?
     CBZ.roadPointOpen(x, z)      is this POINT drivable (keep-out? water?)
     CBZ.roadWeight(r)            how BUSY should this segment be (district)
     CBZ.roadPick(opts)           -> a full, legal, unseen placement, or null
     CBZ.roadPlace(car, spot)     write the exact field set order-37 reads
     CBZ.roadTrafficAudit()       the ratchet

   roadPick is the block. It REPLACES the eight lines above rather than adding
   bookkeeping beside them (CLAUDE.md's BLOCK LAW #1), every caller keeps its
   old inline body as the `: fallback` arm (#2), and all four sites migrate in
   this same change (#3). What the callers get for free the moment they adopt:

     • KEEP-OUTS ARE REAL TO CARS. A segment whose span lies inside a declared
       no-spawn zone is closed; a point inside one is refused even when the
       segment is open, so a road clipping the corner of the airfield still
       works — you just never materialise on the runway half of it.
     • NEVER IN VIEW. The relocation paths asked "is it 62 m from the camera",
       which says nothing about where the camera is LOOKING; a car could pop in
       dead ahead at 63 m. roadPick tests the actual view cone.
     • NEVER ON WATER, never on a segment flagged `noTraffic` by its builder.
     • DENSITY BY DISTRICT. A uniform draw over a flat list puts as many cars
       on a farm track as on Main Street. Picks are weighted by district AND by
       segment length, which is what actually makes downtown feel downtown.

   THE OTHER HALF OF THE OWNER'S BUG — and it is not a spawn at all. Ambient
   cars TURN by calling vehicles.js's findRoad(), which took the nearest
   perpendicular segment within 9 m of the junction and never checked that the
   junction lies ON it. Any downtown intersection near x≈0 therefore matched
   the airport causeway record (x=0, vertical) hundreds of metres to the south:
   the car turned onto a road it was nowhere near, U-turned at the "end", and
   drove the whole length of the airfield — straight across runway 09/27.
   CBZ.roadCross(A, vertical, x, z) is the corrected query and vehicles.js now
   uses it: same signature, plus the one containment test that was missing.

   Flags: ROAD_RULES (the whole file) · ROAD_SPEED_ENFORCE (the ticket only,
   so you can keep the honest roundel and turn the consequence off) ·
   ROAD_TRAFFIC_ACCESS (the keep-out/water/weighting law — one-line revert to
   the old flat-list behaviour).
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
  // The traffic-access law (keep-outs, water, view cone, district weighting).
  // false => roadPick/roadOpen answer exactly as the old flat-list code did,
  // so every migrated caller reverts to its pre-change behaviour in one line.
  if (CBZ.CONFIG.ROAD_TRAFFIC_ACCESS == null) CBZ.CONFIG.ROAD_TRAFFIC_ACCESS = true;

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

  /* ======================================================================
     TRAFFIC ACCESS — may a car be HERE, and how busy should HERE be.
     ====================================================================== */

  function access() { return on() && CBZ.CONFIG.ROAD_TRAFFIC_ACCESS !== false; }
  function arena() { const c = CBZ.city; return (c && c.arena) || c || null; }
  let placed = 0, crossRejected = 0, spacingRejects = 0;   // evidence for the audit below
  // How far inside a keep-out a car must be before the AUDIT calls it a
  // trespass rather than a vehicle sitting at the gate line. One car length.
  const GATE_SLOP = 5;

  /* How busy a segment should be, relative to a plain city block at 1.0.
     A uniform draw over the flat road list is what put as many cars on a farm
     track as on Main Street; weighting by district is most of what makes a
     downtown read as a downtown. Multiplied by segment LENGTH at pick time, so
     a 600 m freeway naturally carries more than a 60 m side street. */
  const WEIGHT = {
    core: 1.7, downtown: 1.7, commercial: 1.5, arterial: 1.35,
    freeway: 1.15, highway: 1.0,
    residential: 0.85, suburb: 0.8, projects: 0.8,
    industrial: 0.65, bridge: 0.6, causeway: 0.6, town: 0.55,
    island: 0.4, park: 0.25,
    farmland: 0.22, desert: 0.2, forest: 0.2, snow: 0.18,
  };
  const WEIGHT_DEFAULT = 1.0;              // untagged == the core grid (world.js)

  CBZ.roadWeight = function (r) {
    if (!r) return 0;
    if (!access()) return 1;
    if (r.trafficWeight != null) return Math.max(0, +r.trafficWeight || 0);
    let w = WEIGHT[String(r.district || "").toLowerCase()];
    if (w == null) w = WEIGHT_DEFAULT;
    if (r.theme === "dirt" || r.dirt) w *= 0.45;   // an unpaved track is quiet
    return w;
  };

  /* ---- KEEP-OUTS ---------------------------------------------------------
     arena.noSpawn is the list the airport's airside, the military runway and
     every bunker shell already register into (city/worldmap.js). PEDS have
     honoured it since the owner complained about people on the runway. Cars
     never asked. They do now.

     NOTE this is deliberately NOT CBZ.citySpawnBlocked: that helper also
     rejects every MID-ROAD point, because it answers "may a PERSON stand
     here". A car must stand exactly there. Same data, different question —
     so we read the zones directly rather than bend a ped query into a car
     one and get a system that refuses every road in the world. */
  function zoneHit(x, z, pad) {
    const A = arena(); const zs = A && A.noSpawn;
    if (!zs) return null;
    pad = pad || 0;
    for (let i = 0; i < zs.length; i++) {
      const s = zs[i];
      if (s.r != null) {
        const dx = x - s.cx, dz = z - s.cz, rr = s.r + pad;
        if (dx * dx + dz * dz <= rr * rr) return s;
      } else if (x >= s.minX - pad && x <= s.maxX + pad && z >= s.minZ - pad && z <= s.maxZ + pad) return s;
    }
    return null;
  }
  CBZ.roadKeepOutAt = function (x, z, pad) { return access() ? zoneHit(x, z, pad) : null; };

  // Is a POINT drivable by ambient traffic? Refuses keep-outs and open water.
  // Cheap enough for the handful of candidate draws a pick makes.
  CBZ.roadPointOpen = function (x, z, cls) {
    if (!access()) return true;
    if (!CLASS_IGNORES_ZONES[cls || "ambient"] && zoneHit(x, z, 0)) return false;
    // water refuses EVERY class — an ambulance does not drive into the sea.
    if (CBZ.cityWaterAt) { try { if (CBZ.cityWaterAt(x, z)) return false; } catch (e) {} }
    return true;
  };

  /* Is a whole SEGMENT open to ambient traffic? Cached on the record itself
     (`_openCache`), keyed on the keep-out list length, because the answer only
     changes when the world is rebuilt — and a per-frame linear scan over a few
     hundred segments x a dozen zones is exactly the kind of cost that gets a
     good rule deleted later for being slow.

     A segment is CLOSED when it is flagged, or when BOTH of its ends and its
     midpoint sit inside keep-outs. "All three" rather than "any" on purpose:
     the airport causeway's far end legitimately touches the airfield gate, and
     closing the only road to the airport would be a worse bug than the one
     being fixed. A segment that merely CLIPS a zone stays open and the
     per-point test above keeps cars off the bad half of it. */
  function endsOf(r) {
    const h = (r.len || 0) / 2;
    return r.vertical
      ? [[r.x, r.z - h], [r.x, r.z], [r.x, r.z + h]]
      : [[r.x - h, r.z], [r.x, r.z], [r.x + h, r.z]];
  }
  /* VEHICLE CLASSES. The shipped-game pattern for "keep ordinary traffic off
     the runway but let the pushback tug drive on it" is not a second road
     graph — it is ONE graph carrying access tags, plus a per-vehicle-class
     include/exclude filter over them (this is GTA's path-node flag set, and
     structurally it is Recast/Detour's dtQueryFilter). Same idea here, at this
     game's scale:

       "ambient"    ordinary city traffic. Refused by every keep-out.
       "service"    airport/industrial ground vehicles. The keep-out that bars
                    a taxi from the apron is exactly where a baggage tug BELONGS.
       "emergency"  ambulance, fire, police response. Goes where it must.

     A builder may also tag a segment itself: `r.noTraffic` closes it to
     everyone, `r.access = "service"` reserves it for the class that owns it. */
  const CLASS_IGNORES_ZONES = { service: 1, emergency: 1 };

  CBZ.roadOpen = function (r, cls) {
    if (!r) return false;
    if (!access()) return true;
    if (r.noTraffic) return false;                 // a builder's own opt-out
    cls = cls || "ambient";
    // a segment reserved for one class is closed to the others
    if (r.access && r.access !== cls && cls !== "emergency") return false;
    if (CLASS_IGNORES_ZONES[cls]) return true;     // service/emergency ignore keep-outs
    const A = arena(); const n = (A && A.noSpawn && A.noSpawn.length) || 0;
    if (r._openCache && r._openCache.n === n) return r._openCache.v;
    let blocked = 0; const pts = endsOf(r);
    for (let i = 0; i < pts.length; i++) if (zoneHit(pts[i][0], pts[i][1], 0)) blocked++;
    const v = blocked < pts.length;
    r._openCache = { n: n, v: v };
    return v;
  };
  CBZ.roadClosedReason = function (r) {
    if (!r) return "no segment";
    if (r.noTraffic) return "builder flagged noTraffic";
    const pts = endsOf(r); let z = null;
    for (let i = 0; i < pts.length; i++) { const h = zoneHit(pts[i][0], pts[i][1], 0); if (!h) return ""; z = h; }
    return z ? ("inside keep-out " + (z.label || "?")) : "";
  };

  /* ---- IS IT IN VIEW -----------------------------------------------------
     The relocation paths asked only "is it ≥62 m from the camera", which says
     nothing about where the camera is POINTING — a car could pop into
     existence dead ahead at 63 m and the check was satisfied. This is the
     actual test every open-world game runs before it recycles a vehicle: a
     horizontal view CONE from the live camera, widened by a margin so a quick
     flick of the mouse does not reveal the seam. Degrades to "not in view"
     when there is no camera (headless), which is correct: nothing to see. */
  const _fwd = { x: 0, z: 1 };
  CBZ.roadInView = function (x, z, margin) {
    const cam = CBZ.camera;
    if (!cam || !cam.position) return false;
    const dx = x - cam.position.x, dz = z - cam.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 1) return true;
    // camera forward on the ground plane, from its world matrix (-Z is forward)
    const e = cam.matrixWorld && cam.matrixWorld.elements;
    if (!e) return false;
    _fwd.x = -e[8]; _fwd.z = -e[10];
    const fl = Math.hypot(_fwd.x, _fwd.z) || 1;
    const dot = (dx * _fwd.x + dz * _fwd.z) / (d * fl);
    // half horizontal FOV from the vertical fov + aspect, plus the margin
    const vf = ((cam.fov || 70) * Math.PI) / 360;
    const half = Math.atan(Math.tan(vf) * (cam.aspect || 1.7)) + (margin != null ? margin : 0.35);
    return dot > Math.cos(Math.min(3.0, half));
  };

  /* ---- THE PICK ----------------------------------------------------------
     ONE call replaces the eight lines every placement site re-typed. Returns a
     complete, legal placement or null — never a half-answer the caller has to
     finish. opts:
       rng          draw function (PASS YOUR SEEDED STREAM — worldgen must stay
                    deterministic; omit for runtime-only relocation)
       near         {x,z} anchor for the distance band
       minDist/maxDist   annulus around `near` (metres)
       camMin       minimum distance from the camera
       unseen       true => must also be outside the live view cone
       filter       (r) => bool, extra segment predicate
       district     only segments with this district tag
       tries        candidate draws (default 12)
     The returned spot carries `road` plus every field vehicles.js's order-37
     lane keeper reads, so roadPlace can write them without the caller knowing
     which ones they are. */
  function lanesPerDir(r) { return CBZ.roadLanesPerDir ? CBZ.roadLanesPerDir(r) : Math.max(1, (r.lanesPerDir || 2) | 0); }
  function laneCenter(r, dir, idx) { return CBZ.roadLaneCenter ? CBZ.roadLaneCenter(r, dir, idx) : dir * 3.6 * (idx + 0.5); }

  // Weighted segment draw. The cumulative table is rebuilt only when the road
  // list length changes (i.e. when the world was rebuilt) — same invalidation
  // rule as the bucket grid above.
  let cum = null, cumN = -1, cumRoads = null, cumTotal = 0;
  function buildCum(R) {
    cum = new Float64Array(R.length); cumRoads = R; cumTotal = 0;
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      let w = 0;
      if (r && CBZ.roadOpen(r)) w = CBZ.roadWeight(r) * Math.max(20, Math.min(600, r.len || 0));
      cumTotal += w; cum[i] = cumTotal;
    }
    cumN = R.length;
  }
  function drawSeg(R, rnd) {
    if (!access()) return R[(rnd() * R.length) | 0];
    if (cumN !== R.length || cumRoads !== R) buildCum(R);
    if (!(cumTotal > 0)) return R[(rnd() * R.length) | 0];
    const t = rnd() * cumTotal;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < t) lo = mid + 1; else hi = mid; }
    return R[lo];
  }

  CBZ.roadPick = function (opts) {
    opts = opts || {};
    const A = arena(); const R = A && A.roads;
    if (!R || !R.length) return null;
    const rnd = opts.rng || Math.random;
    const tries = opts.tries || 12;
    const min2 = opts.minDist ? opts.minDist * opts.minDist : 0;
    const max2 = opts.maxDist ? opts.maxDist * opts.maxDist : 0;
    const cam2 = opts.camMin ? opts.camMin * opts.camMin : 0;
    // minimum spacing between the new car and anything already parked/driving
    // there. ~1.5 car lengths; pass 0 to disable (a caller placing a deliberate
    // convoy).
    const spacing = opts.spacing != null ? opts.spacing : 7.5;
    const cam = CBZ.camera && CBZ.camera.position;
    for (let t = 0; t < tries; t++) {
      const r = opts.district
        ? R[(rnd() * R.length) | 0]
        : drawSeg(R, rnd);
      if (!r) continue;
      if (opts.district && String(r.district || "") !== opts.district) continue;
      if (!CBZ.roadOpen(r, opts.cls)) continue;
      if (opts.filter && !opts.filter(r)) continue;
      // spread along the segment, but never bunch a long highway at one end
      const spread = Math.min((r.len || 0) * 0.45, opts.spread || 1e9);
      const along = (rnd() - 0.5) * 2 * spread;
      const dirSign = rnd() < 0.5 ? 1 : -1;
      const laneIdx = (rnd() * lanesPerDir(r)) | 0;
      const lane = laneCenter(r, dirSign, laneIdx);
      const x = r.vertical ? r.x + lane : r.x + along;
      const z = r.vertical ? r.z + along : r.z + lane;
      if (!CBZ.roadPointOpen(x, z, opts.cls)) continue;
      if (opts.near) {
        const dx = x - opts.near.x, dz = z - opts.near.z, d2 = dx * dx + dz * dz;
        if (min2 && d2 < min2) continue;
        if (max2 && d2 > max2) continue;
      }
      if (cam2 && cam) { const dx = x - cam.x, dz = z - cam.z; if (dx * dx + dz * dz < cam2) continue; }
      if (opts.unseen && access() && CBZ.roadInView(x, z)) continue;
      // MINIMUM SPACING. The third leg of the standard creation/deletion/
      // spacing trio, and the one this game never had: none of the four
      // placement sites checked whether anything was ALREADY standing where
      // they were about to put a car, so a recycle could drop one straight
      // through a stopped queue. A car length and a half is enough to
      // guarantee the resolver never has to shove two hulls apart on frame
      // one — which is what the interpenetration looked like.
      if (access() && spacing > 0) {
        const cars = CBZ.cityCars;
        if (cars) {
          let clash = false;
          for (let i = 0; i < cars.length; i++) {
            const o = cars[i];
            if (!o || o.dead || !o.pos) continue;
            const dx = o.pos.x - x, dz = o.pos.z - z;
            if (dx * dx + dz * dz < spacing * spacing) { clash = true; break; }
          }
          if (clash) { spacingRejects++; continue; }
        }
      }
      return {
        road: r, x: x, z: z, dirSign: dirSign, lane: lane, laneIdx: laneIdx,
        vertical: !!r.vertical,
        heading: r.vertical ? (dirSign > 0 ? 0 : Math.PI) : (dirSign > 0 ? Math.PI / 2 : -Math.PI / 2),
      };
    }
    return null;
  };

  /* Write a placement onto a live car record. This is the ONE list of fields
     vehicles.js's order-37 lane keeper reads each frame; it was previously
     copied, field for field, into three different functions in traffic.js —
     which is precisely how one of them can silently fall out of sync with the
     driving code. Now there is one copy of the list. */
  CBZ.roadPlace = function (c, spot) {
    if (!c || !spot) return false;
    c.road = spot.road; c.vertical = spot.vertical; c.dirSign = spot.dirSign;
    c.lane = spot.lane; c.laneIdx = spot.laneIdx;
    c.pos.x = spot.x; c.pos.z = spot.z;
    c.heading = spot.heading;
    c.v = (c.baseV || 8) * 0.6;
    c.turning = null;
    if (c.group) { c.group.position.set(spot.x, c.group.position.y || 0, spot.z); c.group.rotation.y = spot.heading; }
    placed++;
    return true;
  };

  /* ---- THE CROSS-STREET QUERY -------------------------------------------
     vehicles.js's findRoad() took the nearest perpendicular segment within 9 m
     of a junction and never checked the junction was ON it. That is the second
     half of the owner's airport bug and it is not a spawn at all: a downtown
     intersection at x≈0 matched the airport causeway record (x=0, vertical)
     hundreds of metres south, so the turning car adopted a road it was nowhere
     near, hit the "end" of it immediately, U-turned, and drove the length of
     the airfield — across runway 09/27 — with every lane-keeping number
     perfectly satisfied. Same signature, plus the containment test. */
  CBZ.roadCross = function (A, vertical, x, z) {
    const R = (A && A.roads) || (arena() && arena().roads);
    if (!R) return null;
    const coord = vertical ? x : z, along = vertical ? z : x;
    let best = null, bd = 9;
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (!r || !!r.vertical !== !!vertical) continue;
      const d = Math.abs((vertical ? r.x : r.z) - coord);
      if (d >= bd) continue;
      // THE MISSING TEST: the junction must actually lie on this segment.
      if (access()) {
        const c = vertical ? r.z : r.x;
        if (Math.abs(along - c) > (r.len || 0) / 2 + 2) { crossRejected++; continue; }
        if (!CBZ.roadOpen(r)) { crossRejected++; continue; }
      }
      bd = d; best = r;
    }
    return best;
  };

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

  /* ---- THE TRAFFIC RATCHET (CLAUDE.md BLOCK LAW #5) ----------------------
     `trespassing` is the number the owner actually reported: ambient cars
     standing inside a declared keep-out — the runway, the airside, the
     military perimeter. It is a LIVE measurement of the world, not a count of
     call sites, and it may only ever go DOWN. Baseline is pinned in
     tools/math-gate.mjs.

     `legacy` is the classic shape: placement sites still doing their own
     road/lane draw instead of calling roadPick. It is reported by the
     consumers themselves (each migrated site bumps `adopted` once), so the
     two numbers together say whether adoption is real or just claimed. */
  const sites = {};
  CBZ.roadPickUsed = function (id) { if (id) sites[id] = 1; };   // one line, at the call
  CBZ.roadTrafficAudit = function () {
    const A = arena();
    const cars = CBZ.cityCars || [];
    let trespassing = 0, atGate = 0, onWater = 0, offSegment = 0, ambient = 0;
    const where = {};
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || !c.ai || c.player || c.owned || c.dead || !c.pos) continue;
      ambient++;
      // A NEGATIVE PAD, and the reason is worth writing down. The airport
      // causeway is the airfield's ACCESS ROAD and its north end terminates
      // exactly ON the airside boundary (CW_MAXZ === A_MINZ, island_airport.js)
      // — which is correct, that is where the gate is. So a car that has
      // legitimately driven the causeway to its end sits a metre or two inside
      // a rect that starts at the same coordinate, and a zero-pad test calls
      // that "on the airfield". It is not; it is at the gate.
      //
      // Shrinking the zone by GATE_SLOP for the AUDIT ONLY keeps the number
      // honest in both directions: the PLACEMENT tests above still use pad 0,
      // so nothing is ever put inside the zone at all, while the ratchet stops
      // failing on a car parked at a barrier. Anything further in than a car
      // length is a real trespass and still counts.
      const zn = zoneHit(c.pos.x, c.pos.z, -GATE_SLOP);
      if (zn) { trespassing++; const k = zn.label || "?"; where[k] = (where[k] || 0) + 1; }
      else if (zoneHit(c.pos.x, c.pos.z, 0)) atGate++;
      if (CBZ.cityWaterAt) { try { if (CBZ.cityWaterAt(c.pos.x, c.pos.z)) onWater++; } catch (e) {} }
      const r = c.road;
      if (r) {
        const lat = r.vertical ? Math.abs(c.pos.x - r.x) : Math.abs(c.pos.z - r.z);
        const al = r.vertical ? Math.abs(c.pos.z - r.z) : Math.abs(c.pos.x - r.x);
        if (lat > (r.w || 18) / 2 + 8 || al > (r.len || 0) / 2 + 10) offSegment++;
      }
    }
    let closed = 0; const roads = (A && A.roads) || [];
    for (let i = 0; i < roads.length; i++) if (!CBZ.roadOpen(roads[i])) closed++;
    return {
      ambient: ambient, trespassing: trespassing, atGate: atGate, onWater: onWater,
      offSegment: offSegment, where: where,
      segments: roads.length, segmentsClosed: closed,
      placedByBlock: placed, crossRejected: crossRejected, spacingRejects: spacingRejects,
      adopted: Object.keys(sites).length, adoptedIds: Object.keys(sites).sort(),
    };
  };
})();
