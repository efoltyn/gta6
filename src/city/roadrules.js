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

   AND — NEWEST — WHERE A ROAD MAY BE BUILT AT ALL
   -----------------------------------------------
   OWNER REPORT: "roads rn and all the props that surround roads overlap with
   places like the airport. roads should connect places but never overlap with
   them. that's so simple."

   He is right on both counts. `city.regions` has been the registry of PLACES
   since worldmap.js shipped, and roughly twenty separate files push segments
   onto `city.roads` — and NOT ONE of them has ever tested its segment against
   that registry. The nearest thing to a check was highwaynet.js's build-time
   `clearanceSweep`, which detects a route crossing a registered footprint and
   `console.warn`s. It has been correctly reporting real collisions and
   changing nothing, which is the exact failure CLAUDE.md names by name: an
   audit nobody enforces is not a measurement.

   So this file now answers the question one layer earlier than roadPick's
   "may a car be here": MAY A ROAD BE HERE.

     CBZ.roadClearance(x0,z0,x1,z1,opts) -> {ok, blockedBy, clampedTo, depth}
     CBZ.roadClamp(seg, opts)            -> metres removed (0 = already legal)
     CBZ.roadPropClear(x, z, road)       -> may road-side scatter stand here
     CBZ.roadClearanceAudit()            -> the ratchet

   THE LAW, in the owner's own sentence: a road may TOUCH a place and it may
   END in one, but it may never CROSS one it is merely passing. Formally, a
   region blocks a segment unless one of these is true — and every one of them
   is derived from data the world already carries, so adoption costs one line
   and no builder declares anything:

     • the region is an UNDERLAY (continent.js's "wilds" ownership bands: they
       cover the whole map and a road that could not cross them could not exist)
     • the region is a CONNECTOR by name — causeway / bridge / link / ramp /
       approach / spur / corridor. Those ARE roads; the established link
       semantics polwar and the shore field already key off.
     • THE DESTINATION RULE. The segment's far endpoint lies inside it. That is
       what "connect" means: a road is allowed to reach where it is going. It
       is the whole difference between the airport causeway (which ends at the
       airfield) and a highway that happens to cut the corner off a town.
     • the segment's ORIGIN lies inside it (the same rule run backwards — a
       town's own street starts and ends at home).
     • ownership: the segment's `owner` / `_govOwner` / `district` matches the
       region's `owner` / `_govOwner` / `biome`. govcomplex.js already stamps
       `_govOwner` on both sides and towngen already stamps its district; this
       costs those files nothing and they were never edited for it.
     • the along-axis penetration is within the DOCK BAND (24 m). 24 is not a
       taste knob: it is one full deck width of the widest road in this game
       (the 3+3 divided highway, half-width 12), which is the deepest a road
       can legitimately be inside a place — a T-junction onto a perimeter road
       running along the boundary must overlap that road's whole width or the
       junction is not continuous. Measured over the shipped world, NO segment
       lands between 24 m and 48 m of penetration: the distribution is bimodal,
       so the threshold is not balanced on a knife-edge.

   WHAT IS DELIBERATELY *NOT* ENFORCED, and why. `arena.noSpawn` keep-outs (the
   airside, the runway, the bunker shells, the gov compounds) are AUDITED and
   warned, never clamped. Refusing a PROP costs nothing, so props are refused
   inside a keep-out outright; but clamping a ROAD out of a keep-out can strand
   the facility it serves — island_airport.js's landside perimeter road runs
   inside the airside rect for its whole length, and cutting it would leave the
   terminal with no road at all. A road-vs-keep-out conflict is a bug in the
   FACILITY'S OWN FOOTPRINT and has to be fixed there; `roadClearanceAudit()`
   names each one so it cannot hide.

   Flags: ROAD_RULES (the whole file) · ROAD_SPEED_ENFORCE (the ticket only,
   so you can keep the honest roundel and turn the consequence off) ·
   ROAD_TRAFFIC_ACCESS (the keep-out/water/weighting law — one-line revert to
   the old flat-list behaviour) · ROAD_CLEARANCE (the whole build-time
   clearance law) · ROAD_CLEARANCE_ENFORCE (the post-build clamp only, so the
   audit can keep measuring with the enforcement off) · ROAD_CLEARANCE_PROPS
   (the road-side scatter gate only).
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
  // The build-time clearance law: where a road may BE, as distinct from who may
  // DRIVE on it. One-line revert to "any builder may put a road anywhere".
  if (CBZ.CONFIG.ROAD_CLEARANCE == null) CBZ.CONFIG.ROAD_CLEARANCE = true;
  // The post-build clamp. Turn this off and roadClearanceAudit() still reports
  // every violation — the measurement survives the enforcement being disabled,
  // which is what lets a regression be seen before it is fixed.
  if (CBZ.CONFIG.ROAD_CLEARANCE_ENFORCE == null) CBZ.CONFIG.ROAD_CLEARANCE_ENFORCE = true;
  // The road-side scatter gate (streetlights, kerb furniture, signs).
  if (CBZ.CONFIG.ROAD_CLEARANCE_PROPS == null) CBZ.CONFIG.ROAD_CLEARANCE_PROPS = true;
  // How deep a road may sit inside a place before it stops "docking" and starts
  // "crossing". One full deck width of the widest road in the game — see the
  // header for why this is derived and not a taste knob.
  if (CBZ.CONFIG.ROAD_CLEARANCE_DOCK == null) CBZ.CONFIG.ROAD_CLEARANCE_DOCK = 24;

  // ADOPTED: vehicles.js publishes the one conversion (CBZ.speedMph). This
  // literal was one of three different answers in the repo and 7.3% high — and
  // it is the one that decides whether you are SPEEDING, so it has to be the
  // same number the speedometer draws. Kept as the no-vehicles.js fallback.
  const MPH_PER_UNIT = 2.4;          // vehicles.js — the repo's historical figure
  const mphOf = (v) => (CBZ.speedMph ? CBZ.speedMph(v) : Math.abs(v || 0) * MPH_PER_UNIT);
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

  /* ======================================================================
     WHERE TWO ROADS MEET — THE JUNCTION, DERIVED, NEVER AUTHORED.
     ======================================================================
     OWNER: "roads meet at intersections right now feeling very unintentional."

     He is describing a hole in the same place every other hole in this file
     was: `city.roads` is the registry EVERY road builder pushes to, and NOT
     ONE consumer had ever asked it where two segments cross. The mainland
     grid keeps a hand-built `city.intersections` array — but that array is
     the GRID's private bookkeeping (`i`/`j` indices into xLines/zLines) and
     it does not know that a town street, a causeway, a govcomplex spur or a
     minicity link exists. Every junction outside the 7x7 mainland grid was
     invisible to the whole game.

     A junction is not a thing to author. It is what you get when a vertical
     segment and a horizontal segment overlap, and both facts are already in
     the record. So this derives them, and carries the ONE number every piece
     of junction detail needs — the KERB RETURN RADIUS.

     THE RADIUS IS SOLVED, NOT TASTED. Three real constraints, in order:

       1. THE DESIGN VEHICLE. AASHTO's minimum simple-curve radius for a 90
          turn is ~7.5 m for a passenger car (P), ~15 m for a single-unit
          truck (SU-30). The road already declares which of those it serves:
          `lanesPerDir`. One lane per direction is a local street (cars);
          each extra lane is a road that carries the heavier vehicle. Hence
          R_design = 7.5 + 3.6*(lanes-1) — and it is keyed off the MINOR of
          the two roads, because the turn is constrained by the road you are
          turning INTO, not the one you are leaving.
       2. THE OFFSET LANE. The swept path does not start at the kerb. Every
          road here declares `w` and `lanesPerDir*laneW`; the difference is
          the parking/clear zone (1.8 m on the 18 m mainland street, per
          config.js's own comment). NACTO calls the sum the EFFECTIVE radius,
          and it is the effective radius the design vehicle needs — so the
          built kerb radius is R_design MINUS that offset.
       3. THE FOOTWAY. A return that swallows the pavement is not a return,
          it is a demolition. The arc's deepest bite into the corner is
          R*(1-cos45) = 0.2929*R, so a footway of width F caps R at
          (F-0.6)/0.2929. The mainland's footway is 2 m (world.js insets the
          lot pad by exactly that), which alone pins the grid at ~4.8 m — a
          tight, correct, NACTO-scale downtown corner.

     Floor 3.0 m (below that the corner reads square anyway), ceiling 15 m
     (the SU-30 number; nothing here is a motorway interchange).

       CBZ.roadJunctions()            every crossing in the world, once
       CBZ.roadCornerRadius(a,b,F)    the solve above, callable on its own
       CBZ.roadJunctionAt(x,z,pad)    the junction under a point, or null

     Cached on the road-list LENGTH, exactly like the segment grid above: the
     list only changes when the world is rebuilt. */

  // AASHTO P / SU ladder off the lane count the road already declares.
  function designRadius(r) {
    const n = Math.max(1, (r && r.lanesPerDir != null ? r.lanesPerDir : 2) | 0);
    return 7.5 + 3.6 * (n - 1);
  }
  // The parking/clear zone between the outermost travel lane and the kerb.
  function kerbOffset(r) {
    const w = (r && r.w != null ? r.w : (CBZ.CITY && CBZ.CITY.road) || 18);
    const n = Math.max(1, (r && r.lanesPerDir != null ? r.lanesPerDir : 2) | 0);
    const lw = (r && r.laneW != null ? r.laneW : 3.6);
    return Math.max(0, w / 2 - n * lw);
  }
  const R_FLOOR = 3.0, R_CEIL = 15.0;
  // 1 - cos(45deg): the fraction of R the arc bites diagonally into the corner.
  const BITE = 1 - Math.SQRT1_2;

  CBZ.roadCornerRadius = function (a, b, footway) {
    const minor = designRadius(a) <= designRadius(b) ? a : b;
    let R = designRadius(minor) - Math.min(kerbOffset(a), kerbOffset(b));
    if (footway != null && footway > 0) R = Math.min(R, (footway - 0.6) / BITE);
    else if (footway != null) R = R_FLOOR;
    return Math.max(R_FLOOR, Math.min(R_CEIL, R));
  };
  CBZ.roadCornerBite = BITE;

  let junc = null, juncN = -1;

  function halfW(r) { return (r.w != null ? r.w : (r.width != null ? r.width : (CBZ.CITY && CBZ.CITY.road) || 18)) / 2; }

  function buildJunctions(R) {
    const V = [], H = [];
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (!r || !Number.isFinite(r.x) || !Number.isFinite(r.z) || !Number.isFinite(r.len)) continue;
      if (r.elevated) continue;                 // a flyover is not a junction
      (r.vertical ? V : H).push(r);
    }
    const out = [];
    for (let i = 0; i < V.length; i++) {
      const a = V[i], ha = halfW(a), la = a.len / 2;
      for (let j = 0; j < H.length; j++) {
        const b = H[j], hb = halfW(b), lb = b.len / 2;
        // OVERLAP, not "near": the vertical road's x must lie within the
        // horizontal road's span and vice versa. This is the containment test
        // roadCross was missing, applied to the other question.
        if (Math.abs(a.x - b.x) > lb + hb) continue;
        if (Math.abs(b.z - a.z) > la + ha) continue;
        // A deck sitting metres above the other road is a crossing, not a
        // junction — only pair segments on (roughly) the same plane.
        if (Math.abs((a.y || 0) - (b.y || 0)) > 1.2) continue;
        out.push({
          x: a.x, z: b.z, a: a, b: b,
          ha: ha, hb: hb,
          y: Math.max(a.y || 0, b.y || 0),
          // LEGS: does the road actually continue past the box on this side?
          // An approach with no oncoming road is not an approach, and a stop
          // line facing a dead end is the kind of detail that reads as noise.
          // N/S run on the VERTICAL road (a), E/W on the HORIZONTAL road (b);
          // each is measured against the OTHER road's half-width, because that
          // is how deep the junction box is on that axis.
          nz: (a.z + la) - b.z > hb + 2, sz: b.z - (a.z - la) > hb + 2,
          px: (b.x + lb) - a.x > ha + 2, mx: a.x - (b.x - lb) > ha + 2,
          r: 0,
        });
      }
    }
    return out;
  }

  // FOOTWAY: how much walkable ground sits between the kerb and the nearest
  // built lot pad at this corner. Measured against city.lots — the record the
  // world already holds — rather than assumed, because the mainland's is 2 m
  // and a town's is zero and a corner radius that ignores the difference paves
  // somebody's yard.
  function footwayAt(J, lots) {
    if (!lots || !lots.length) return 2.0;
    let best = 1e9;
    const hx = J.ha, hz = J.hb;
    for (let i = 0; i < lots.length; i++) {
      const L = lots[i];
      if (!L || !Number.isFinite(L.cx)) continue;
      const lw = (L.w != null ? L.w : 0) / 2, ld = (L.d != null ? L.d : L.w || 0) / 2;
      const dx = Math.abs(L.cx - J.x) - lw, dz = Math.abs(L.cz - J.z) - ld;
      if (dx > 60 || dz > 60) continue;         // only the four corner lots matter
      const gap = Math.max(0, Math.min(dx - hx, dz - hz));
      if (gap < best) best = gap;
    }
    return best < 1e9 ? best : 2.0;
  }

  // `world` is the in-progress descriptor when called from inside buildCity
  // (CBZ.city.arena is not assigned until buildCity RETURNS — the same trap
  // worldRef documents below). Callers outside a build pass nothing.
  let juncRef = null;
  CBZ.roadJunctions = function (world) {
    if (!on()) return [];
    const A = (world && world.roads) ? world : null;
    const R = A ? A.roads : roadsList();
    if (!R || !R.length) return [];
    if (juncN !== R.length || juncRef !== R || !junc) {
      junc = buildJunctions(R);
      let lots = A ? A.lots : null;
      if (!lots) { const c = CBZ.city; const B = (c && c.arena && c.arena.lots) ? c.arena : c; lots = (B && B.lots) || null; }
      for (let i = 0; i < junc.length; i++) {
        const J = junc[i];
        J.footway = footwayAt(J, lots);
        J.r = CBZ.roadCornerRadius(J.a, J.b, J.footway);
      }
      juncN = R.length; juncRef = R;
    }
    return junc;
  };

  CBZ.roadJunctionAt = function (x, z, pad) {
    const list = CBZ.roadJunctions();
    const p = pad || 0;
    let best = null, bd = 1e18;
    for (let i = 0; i < list.length; i++) {
      const J = list[i];
      const dx = Math.abs(x - J.x), dz = Math.abs(z - J.z);
      if (dx > J.ha + J.r + p || dz > J.hb + J.r + p) continue;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = J; }
    }
    return best;
  };

  /* ======================================================================
     ROAD CLEARANCE — MAY A ROAD BE BUILT HERE, AND WHERE MUST IT STOP.
     The full doctrine is in this file's header. Everything below is pure
     geometry over records the world already holds: no rng draw is taken
     anywhere in this section, so it is safe in every generation path.
     ====================================================================== */

  // A region that is a CONNECTOR, not a place. These names are the established
  // link semantics in this repo (highwaynet.js's isLinkName, polwar's causeway
  // front search, the shore field's land-holding all key off the same words);
  // "approach"/"spur"/"corridor" join them because govcomplex.js registers its
  // access corridors under exactly those names.
  const CONNECTOR_RE = /bridge|causeway|link|ramp|approach|spur|connector|corridor/i;
  function lc(s) { return String(s == null ? "" : s).toLowerCase(); }
  function clearanceOn() { return on() && CBZ.CONFIG.ROAD_CLEARANCE !== false; }

  /* WHICH WORLD ARE WE ASKING ABOUT. This is NOT arena() and the difference is
     load-bearing: `CBZ.city.arena` is only assigned AFTER buildCity RETURNS
     (city/mode.js:274-277), so during the landmass builders — which is exactly
     when roads are pushed — arena() answers with an object that has no regions
     at all and every clearance test would silently pass. worldmap.js hands the
     in-progress descriptor to every landmass builder, so we take delivery of it
     through the ordinary CBZ.addLandmass door at the earliest possible order
     rather than inventing a new global or wrapping cityWorldGeo. */
  let boundCity = null;
  if (CBZ.addLandmass) CBZ.addLandmass(function (city) { boundCity = city || null; }, -1e6);
  function worldRef(opts) {
    if (opts && opts.city) return opts.city;
    // boundCity FIRST, and the order matters on a REBUILD: `CBZ.city.arena`
    // still points at the PREVIOUS world until the new buildCity returns, so
    // preferring it would test a rebuilt world's roads against the old world's
    // regions. boundCity is re-bound at the top of every build.
    if (boundCity && boundCity.regions) return boundCity;
    const c = CBZ.city;
    if (c && c.arena && c.arena.regions) return c.arena;
    if (c && c.regions) return c;
    return null;
  }

  // Flattened, cached shape tables. Invalidated on the descriptor identity plus
  // list LENGTH, the same rule the bucket grid above uses — the lists only grow
  // while the world is being built, and a per-candidate rescan of ~100 shapes
  // across the tens of thousands of prop points detail_kit walks is exactly the
  // cost that gets a good rule deleted later for being slow.
  let places = null, placesFor = -1, placesRef = null;
  let keepOuts = null, keepOutsFor = -1, keepOutsRef = null;

  function shapeOf(g, name) {
    let minX, maxX, minZ, maxZ, circle = false;
    if (g.kind === "circle" || (g.r != null && g.cx != null && g.minX == null)) {
      if (!isFinite(g.cx) || !isFinite(g.cz) || !isFinite(g.r)) return null;
      circle = true; minX = g.cx - g.r; maxX = g.cx + g.r; minZ = g.cz - g.r; maxZ = g.cz + g.r;
    } else {
      if (!isFinite(g.minX) || !isFinite(g.maxX) || !isFinite(g.minZ) || !isFinite(g.maxZ)) return null;
      minX = g.minX; maxX = g.maxX; minZ = g.minZ; maxZ = g.maxZ;
    }
    return {
      src: g, name: name, circle: circle, cx: g.cx, cz: g.cz, r: g.r,
      minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ,
      k1: lc(g.owner), k2: lc(g._govOwner), k3: lc(g.biome), civ: !!g.civ,
    };
  }
  function placeTable(opts) {
    const A = worldRef(opts); const regs = (A && A.regions) || null;
    if (!regs) return (places = []);
    if (places && placesRef === regs && placesFor === regs.length) return places;
    const out = [];
    for (let i = 0; i < regs.length; i++) {
      const g = regs[i];
      if (!g || g.underlay) continue;                       // ownership underlay, not a place
      if (CONNECTOR_RE.test(g.name || "")) continue;        // a causeway IS a road
      const s = shapeOf(g, g.name || "?");
      if (s) out.push(s);
    }
    places = out; placesFor = regs.length; placesRef = regs; return out;
  }
  function keepOutTable(opts) {
    const A = worldRef(opts); const zs = (A && A.noSpawn) || null;
    if (!zs) return (keepOuts = []);
    if (keepOuts && keepOutsRef === zs && keepOutsFor === zs.length) return keepOuts;
    const out = [];
    for (let i = 0; i < zs.length; i++) {
      const s = shapeOf(zs[i], zs[i].label || "?");
      if (s) out.push(s);
    }
    keepOuts = out; keepOutsFor = zs.length; keepOutsRef = zs; return out;
  }
  function ptIn(p, x, z) {
    if (!(x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ)) return false;
    if (p.circle) { const dx = x - p.cx, dz = z - p.cz; return dx * dx + dz * dz <= p.r * p.r; }
    return true;
  }
  // Does this road/opts bundle OWN the place? Derived from fields the world
  // already stamps — never a new declaration.
  function ownsPlace(o, p) {
    if (!o) return false;
    const k = lc(o.owner || o._govOwner || o.district);
    if (!k) return false;
    return (k === p.k1 && !!p.k1) || (k === p.k2 && !!p.k2) || (k === p.k3 && !!p.k3);
  }
  // The two ends of a road RECORD.
  function segEnds(r) {
    const h = (r.len || 0) / 2;
    return r.vertical
      ? { x0: r.x, z0: r.z - h, x1: r.x, z1: r.z + h }
      : { x0: r.x - h, z0: r.z, x1: r.x + h, z1: r.z };
  }
  CBZ.roadSegEnds = segEnds;

  let clampedSegs = 0, clampedMetres = 0, propTested = 0, propRefused = 0;

  /* THE QUERY. Returns a pass, or the SHORTENED segment that docks at the
     boundary instead of crossing it — never a half-answer the caller has to
     finish.
       opts.w        deck width (default city.ROAD)
       opts.owner    ownership key; `district`/`_govOwner` are read too
       opts.dest     {x,z} where the road is GOING (default: its far end).
                     A multi-leg route passes its FINAL point here, so an
                     intermediate leg that clips the destination is fine and
                     one that cuts an unrelated town is not.
       opts.origin   {x,z} where it comes FROM (default: its near end)
       opts.dock     penetration allowance (default ROAD_CLEARANCE_DOCK)
       opts.zones    true => also refuse HARD keep-outs (default false; see the
                     header for why a road is never clamped out of one) */
  CBZ.roadClearance = function (x0, z0, x1, z1, opts) {
    const PASS = { ok: true, blockedBy: null, clampedTo: null, depth: 0, kind: null };
    opts = opts || {};
    if (!clearanceOn()) return PASS;
    if (!isFinite(x0) || !isFinite(z0) || !isFinite(x1) || !isFinite(z1)) return PASS;
    const A = worldRef(opts); if (!A) return PASS;
    const dock = opts.dock != null ? opts.dock : (CBZ.CONFIG.ROAD_CLEARANCE_DOCK || 24);
    const hw = (opts.w != null ? opts.w : (A.ROAD || 18)) / 2;
    const vertical = Math.abs(x1 - x0) < Math.abs(z1 - z0);
    const a0 = vertical ? z0 : x0, a1 = vertical ? z1 : x1;
    const cl = vertical ? (x0 + x1) / 2 : (z0 + z1) / 2;   // lateral centreline
    if (Math.abs(a1 - a0) < 1e-6) return PASS;             // degenerate
    const dir = a1 >= a0 ? 1 : -1;
    const dest = opts.dest || { x: x1, z: z1 };
    const origin = opts.origin || { x: x0, z: z0 };
    const segLo = Math.min(a0, a1), segHi = Math.max(a0, a1);

    let stop = a1, blocked = null, depth = 0, kind = null;
    function consider(tab, tag, allowCiv) {
      for (let i = 0; i < tab.length; i++) {
        const p = tab[i];
        if (!allowCiv && p.civ) continue;             // bars civilians, not roads
        // LATERAL: the centreline must actually run INSIDE the footprint. A
        // road whose shoulder grazes an edge is running ALONGSIDE the place —
        // which is exactly where a perimeter road belongs.
        const lLo = vertical ? p.minX : p.minZ, lHi = vertical ? p.maxX : p.maxZ;
        if (cl <= lLo || cl >= lHi) continue;
        const aLo = vertical ? p.minZ : p.minX, aHi = vertical ? p.maxZ : p.maxX;
        const ov = Math.min(segHi, aHi) - Math.max(segLo, aLo);
        if (ov <= 0) continue;
        if (p.circle) {
          const rminX = vertical ? cl - hw : segLo, rmaxX = vertical ? cl + hw : segHi;
          const rminZ = vertical ? segLo : cl - hw, rmaxZ = vertical ? segHi : cl + hw;
          const cdx = Math.max(rminX - p.cx, 0, p.cx - rmaxX);
          const cdz = Math.max(rminZ - p.cz, 0, p.cz - rmaxZ);
          if (cdx * cdx + cdz * cdz >= p.r * p.r) continue;
        }
        if (ptIn(p, dest.x, dest.z)) continue;        // THE DESTINATION RULE
        if (ptIn(p, origin.x, origin.z)) continue;    // ...and its mirror
        if (ownsPlace(opts, p)) continue;
        if (ov <= dock) continue;                     // docking at the edge
        const nearEdge = dir > 0 ? aLo : aHi;
        const cand = nearEdge + dir * dock;
        if (dir > 0 ? cand < stop : cand > stop) { stop = cand; blocked = p.name; depth = ov; kind = tag; }
      }
    }
    consider(placeTable(opts), "region", false);
    if (opts.zones) consider(keepOutTable(opts), "keepout", false);
    if (blocked == null) return PASS;
    // Never invert the segment. A road whose ORIGIN is already inside cannot be
    // salvaged from this end; hand back the degenerate clamp and let the caller
    // decide (roadClamp keeps a short stub rather than deleting a record).
    const keep = dir > 0 ? Math.max(a0, stop) : Math.min(a0, stop);
    return {
      ok: false, blockedBy: blocked, depth: depth, kind: kind,
      len: Math.abs(keep - a0),
      clampedTo: vertical
        ? { x0: x0, z0: z0, x1: x1, z1: keep }
        : { x0: x0, z0: z0, x1: keep, z1: z1 },
    };
  };

  /* THE ONE-LINE ADOPTION. Give it the road RECORD you were about to push and
     it either leaves it alone or shortens it so it docks at the boundary.
     Returns the metres removed (0 = it was already legal), so a builder can
     log or skip on its own terms. Never deletes: a record clamped to nothing
     keeps an 8 m stub at its origin, because deleting would change
     city.roads.length and every downstream count with it. */
  CBZ.roadClamp = function (seg, opts) {
    if (!seg || !clearanceOn()) return 0;
    if (!isFinite(seg.x) || !isFinite(seg.z) || !(seg.len > 0)) return 0;
    const e = segEnds(seg);
    const o = Object.assign({}, opts || {});
    // The RECORD's own fields are the defaults, and an explicit `undefined` in
    // opts must not erase them (Object.assign would). Every caller passes at
    // most a dest/owner it actually knows.
    if (o.w == null) o.w = seg.w;
    if (o.district == null) o.district = seg.district;
    if (o.owner == null) o.owner = seg.owner || seg._govOwner;
    const res = CBZ.roadClearance(e.x0, e.z0, e.x1, e.z1, o);
    if (res.ok) return 0;
    const c = res.clampedTo;
    const nx = (c.x0 + c.x1) / 2, nz = (c.z0 + c.z1) / 2;
    let nlen = seg.vertical ? Math.abs(c.z1 - c.z0) : Math.abs(c.x1 - c.x0);
    const removed = Math.max(0, (seg.len || 0) - nlen);
    if (removed < 0.5) return 0;
    if (nlen < 8) {
      // stub at the origin end, pointing the way it used to run
      const sgn = seg.vertical ? (c.z1 >= c.z0 ? 1 : -1) : (c.x1 >= c.x0 ? 1 : -1);
      nlen = 8;
      if (seg.vertical) { seg.x = c.x0; seg.z = c.z0 + sgn * 4; }
      else { seg.x = c.x0 + sgn * 4; seg.z = c.z0; }
    } else {
      seg.x = nx; seg.z = nz;
    }
    seg.len = nlen;
    seg._clearance = { blockedBy: res.blockedBy, removed: Math.round(removed), depth: Math.round(res.depth) };
    seg._openCache = null;                  // roadOpen's span cache is now stale
    clampedSegs++; clampedMetres += removed;
    return removed;
  };

  /* MAY ROAD-SIDE SCATTER STAND HERE — the props half of the owner's report.
     A streetlight, sign, signal, bin or bollard belongs to the road it was
     walked along. It may stand in that road's own place; it may never stand
     inside a place the road is only passing, and it may NEVER stand inside a
     declared keep-out (that is the airfield). Pass the road record so the
     ownership and destination rules apply; pass nothing and only the keep-out
     half is enforced, which is the safe answer for an unaffiliated prop. */
  CBZ.roadPropClear = function (x, z, road) {
    if (!clearanceOn() || CBZ.CONFIG.ROAD_CLEARANCE_PROPS === false) return true;
    if (!isFinite(x) || !isFinite(z)) return true;
    propTested++;
    const zs = keepOutTable();
    for (let i = 0; i < zs.length; i++) {
      if (ptIn(zs[i], x, z)) { propRefused++; return false; }
    }
    if (!road) return true;
    const tab = placeTable();
    if (!tab.length) return true;
    let e = road._ends;
    if (!e || e._len !== road.len) { e = segEnds(road); e._len = road.len; road._ends = e; }
    for (let i = 0; i < tab.length; i++) {
      const p = tab[i];
      if (!ptIn(p, x, z)) continue;
      if (ownsPlace(road, p)) continue;
      if (ptIn(p, e.x0, e.z0) || ptIn(p, e.x1, e.z1)) continue;   // its own destination
      propRefused++; return false;
    }
    return true;
  };
  // Convenience for a scatter loop that wants to skip a whole road up front:
  // restricted ground (an apron service lane, a compound spur) never carries
  // ordinary city street furniture, whatever the geometry says.
  CBZ.roadPropRoadOk = function (r) {
    if (!r) return false;
    if (!clearanceOn() || CBZ.CONFIG.ROAD_CLEARANCE_PROPS === false) return true;
    return !r.access && !r.noTraffic;
  };

  /* ======================================================================
     A WALL MAY NOT STAND IN A CARRIAGEWAY — CBZ.roadGapRun / roadGapDefer
     ======================================================================
     OWNER, with a screenshot of a car nose-first into a knee-high slab lying
     clean across both lanes: "there are places like this where roads are
     blocked — remove all geometry bullshit in the roads like this."

     THE CLASS, not the instance. Everything in this game that fences, kerbs,
     berms, rails or walls a SITE draws the same shape: a long straight run
     between two world points, one box and one collider. Every one of them is
     authored against its OWN site's numbers and none of them has ever asked
     whether a ROAD passes underneath. Where somebody noticed, the answer was
     hand-typed and became a second constant to keep in sync:

       · city/world.js's seawall opens at three literal gates — a beach span,
         `NGATE`/`WGATE`/`GATE` — one per causeway that happened to exist when
         somebody hit the invisible knee-wall. A fourth causeway gets nothing.
       · city/biome_snow.js splits its east Mercy berm at the literal z range
         [-966, -934] because arena_fights.js T-junctions in at -950. That
         number is a copy of a road position in another file, and arena_fights'
         own header had to carry a KNOWN-NOT-FIXED note asking for it.
       · speedway_structures.js's shared fence takes an explicit `gaps` list,
         so BOTH venues have to remember to declare the hole their own approach
         road needs.

     A gap in a wall is not a thing to author. It is what you get when a run
     crosses a road, and both facts are already in the world: the run's two
     endpoints, and `city.roads` — the registry every road builder in this game
     already pushes to. So this derives it.

       CBZ.roadGapRun(x0,z0,x1,z1,opts)          -> [{x0,z0,x1,z1,len,cx,cz}]
       CBZ.roadGapDefer(x0,z0,x1,z1,opts,draw)   same, but AFTER every road exists
       CBZ.roadGapAt(x,z,pad)                    the carriageway under a point
       CBZ.roadBlockAudit()                      the ratchet

     ADOPTION IS THE LINE THE CALLER ALREADY WROTE. It hands back the run split
     into the pieces that do NOT lie in a carriageway; the caller loops them and
     draws exactly what it was going to draw, mesh and collider together:

         CBZ.roadGapRun(x0, z0, x1, z1).forEach(function (s) {
           wallPiece(s.x0, s.z0, s.x1, s.z1);       // the line it had anyway
         });

     WHY THERE IS A DEFERRED FORM, and it is not a convenience. Wall runs are
     built by landmass builders at orders 20-42; highwaynet pushes its decks at
     91 and continent.js its frontier loop at 97, and city/world.js's seawall is
     laid before cityWorldGeo() has run at all. A run that asked the road list
     at its own build time would be asking an EMPTY list — which is exactly the
     failure mode roadClearance's `worldRef` documents one section up. So a
     builder that runs before its crossing roads exist hands over its draw
     closure instead and the run is split at order 98.6 — after roadrules' own
     clamp (98), before detail_kit's dressing (99). Same one line, correct
     answer, no builder has to know what order it runs at.

     THE GAP WIDTH IS SOLVED, NOT TASTED. It is the widest of
       (a) the TRAVELLED WAY — `CBZ.roadLanes`'s medianHalf + lanes*laneW, the
           tarmac cars actually use, and
       (b) the DECK — the road's own declared `w`/2, because a car straddling a
           kerb is still on the road,
     plus one shoulder (1.5 m) so you are not scraping the cut ends. Run that
     against this repo's own hand-authored gates and it reproduces them:
       mainland street  w 18, 2x3.6         -> max(7.2, 9.0) + 1.5 = 10.5  (21 m
                                               hole; world.js's east GATE: 22)
       highway causeway w 24, 3x3.6 + 1.2m  -> max(11.4, 12) + 1.5 = 13.5  (27 m
                                               hole; world.js's NGATE/WGATE: 26)
     Those two literals were measured by hand years apart, in a different file
     from the roads they open for, and the derivation lands on both. That is the
     evidence the number is the road's and not a taste knob.

     WHAT IS DELIBERATELY NOT GAPPED. A barrier whose whole job is to stand in
     the road — city/checkpoints.js's board, a military gate arm, a demolition
     hoarding — sets `roadBarrier` on its collider (or `opts.exempt` on its run)
     and is skipped and COUNTED. Nothing else is special-cased: a bollard on a
     pavement is outside the carriageway by construction and needs no rule.

     Flags: ROAD_GAP_RUNS (the whole law; off => every caller draws its single
     unbroken run exactly as before) · ROAD_GAP_ENFORCE (the late collider
     sweep only, so the audit can keep measuring with the net switched off) ·
     ROAD_GAP_SHOULDER (the clearance either side of the deck).
     ====================================================================== */

  if (CBZ.CONFIG.ROAD_GAP_RUNS == null) CBZ.CONFIG.ROAD_GAP_RUNS = true;
  if (CBZ.CONFIG.ROAD_GAP_ENFORCE == null) CBZ.CONFIG.ROAD_GAP_ENFORCE = true;
  if (CBZ.CONFIG.ROAD_GAP_SHOULDER == null) CBZ.CONFIG.ROAD_GAP_SHOULDER = 1.5;

  function gapOn() { return on() && CBZ.CONFIG.ROAD_GAP_RUNS !== false; }

  // Half-width of the hole one road punches through a run. See the header for
  // why this is max(travelled way, deck) + shoulder and not a chosen number.
  function lanesOf(r) {
    return CBZ.roadLanes
      ? CBZ.roadLanes(r)
      : { lanesPerDir: Math.max(1, (r.lanesPerDir || 2) | 0), laneW: r.laneW || 3.6, medianHalf: 0, width: r.w || 18 };
  }
  function carriageHalf(r, extra) {
    if (!r) return 0;
    const L = lanesOf(r);
    const travelled = L.medianHalf + Math.max(1, L.lanesPerDir | 0) * L.laneW;
    const deck = (r.w != null ? r.w : (r.width != null ? r.width : (L.width || 18))) / 2;
    const sh = CBZ.CONFIG.ROAD_GAP_SHOULDER;
    return Math.max(travelled, deck) + (sh == null ? 1.5 : sh) + (extra || 0);
  }
  /* THE TARMAC ITSELF — the travelled way, with no deck rounding and no
     shoulder. This is the band a run PARALLEL to the road is judged against:
     alongside a road is where a berm, a kerb, a guardrail and a seawall belong,
     but ON it is a blockage whichever way it points. Two different questions,
     so two different widths, and the difference is exactly the verge. */
  function travelledHalf(r, extra) {
    if (!r) return 0;
    const L = lanesOf(r);
    return L.medianHalf + Math.max(1, L.lanesPerDir | 0) * L.laneW + (extra || 0);
  }
  // The median of a DIVIDED road is a legal place to stand a barrier; an
  // undivided one has no such place, so it returns a band nothing is inside.
  function medianBand(r) { return r && r.median ? lanesOf(r).medianHalf + 0.4 : -1; }
  CBZ.roadCarriageHalf = carriageHalf;
  CBZ.roadTravelledHalf = travelledHalf;
  // Runs within this much of parallel are judged against the tarmac, not the
  // carriageway. ~15 degrees: shallower than that and a "crossing" would be a
  // 100 m cut through a wall that is really running alongside.
  const PARALLEL_DOT = 0.25;

  // The road whose CARRIAGEWAY (not merely whose record) covers this point.
  // A fence-post / lamp / bollard loop uses this to skip one station instead of
  // splitting a run — the same law asked point-wise.
  // NOTE the road list is taken through worldRef, NOT roadsList: during a build
  // `CBZ.city.arena` still points at the PREVIOUS world, so a builder asking
  // roadsList() would be gapped against roads that no longer exist. Same trap
  // roadClearance documents one section up, same door out of it.
  function gapRoads(opts) {
    if (opts && opts.city && opts.city.roads) return opts.city.roads;
    const A = worldRef(opts);
    return (A && A.roads) || roadsList();
  }

  CBZ.roadGapAt = function (x, z, pad) {
    if (!gapOn()) return null;
    const R = gapRoads();
    if (!R || !R.length) return null;
    const p = pad || 0;
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (!r || !(r.len > 0) || r.noGap) continue;
      const gh = carriageHalf(r, p);
      const along = r.vertical ? z - r.z : x - r.x;
      if (Math.abs(along) > r.len / 2 + p) continue;
      const across = r.vertical ? x - r.x : z - r.z;
      if (Math.abs(across) <= gh) return r;
    }
    return null;
  };

  /* Clip a segment against an axis-aligned box; returns the [t0,t1] parameter
     interval that lies INSIDE it, or null. The ordinary slab method — written
     out rather than pulled from THREE because this runs at build time in a
     path that must not allocate a Vector3 per road per run. */
  function clipT(x0, z0, dx, dz, bx0, bz0, bx1, bz1) {
    let t0 = 0, t1 = 1;
    if (Math.abs(dx) < 1e-9) { if (x0 < bx0 || x0 > bx1) return null; }
    else {
      let a = (bx0 - x0) / dx, b = (bx1 - x0) / dx;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 >= t1) return null;
    }
    if (Math.abs(dz) < 1e-9) { if (z0 < bz0 || z0 > bz1) return null; }
    else {
      let a = (bz0 - z0) / dz, b = (bz1 - z0) / dz;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 >= t1) return null;
    }
    return [t0, t1];
  }

  // ---- the ledger. What every run through the block ACTUALLY LEFT DRAWN —
  //      the surviving pieces, never the original span — so roadBlockAudit()
  //      can re-ask the FINAL world whether anything this block passed still
  //      lies in a carriageway. Recording the ORIGINAL run would make
  //      `crossingsRemaining` equal `runsSplit` by construction: a ratchet that
  //      counts the bug it just fixed is the quiet redefinition CLAUDE.md warns
  //      about, and it is worth one sentence to say so.
  const gapLedger = [];
  const LEDGER_CAP = 6000;
  function ledgerPush(id, segs) {
    if (gapLedger.length >= LEDGER_CAP) return;
    for (let i = 0; i < segs.length && gapLedger.length < LEDGER_CAP; i++) {
      const s = segs[i];
      gapLedger.push({ x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1, id: id });
    }
  }
  let gapRuns = 0, gapSplitRuns = 0, gapCuts = 0, gapSwallowed = 0,
    gapDeferred = 0, gapExempt = 0, trimmedColliders = 0, orientedTrimmed = 0;

  function splitRun(x0, z0, x1, z1, opts) {
    opts = opts || {};
    const one = [{ x0: x0, z0: z0, x1: x1, z1: z1, len: Math.hypot(x1 - x0, z1 - z0), cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 }];
    if (!gapOn() || opts.exempt) { if (opts.exempt) gapExempt++; return one; }
    if (!isFinite(x0) || !isFinite(z0) || !isFinite(x1) || !isFinite(z1)) return one;
    const dx = x1 - x0, dz = z1 - z0;
    const runLen = Math.hypot(dx, dz);
    if (!(runLen > 0.01)) return one;
    const R = gapRoads(opts);
    gapRuns++;
    const id = opts.id || "?";
    if (!R || !R.length) { ledgerPush(id, one); return one; }
    // half the run's own body, so a THICK wall clears the tarmac too
    const half = (opts.thick != null ? opts.thick : 0.6) / 2;
    const ux = dx / runLen, uz = dz / runLen;
    const cuts = [];
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (!r || !(r.len > 0) || r.noGap) continue;
      if (opts.skip && opts.skip(r)) continue;
      /* A RUN PARALLEL TO A ROAD IS A VERGE, NOT A BLOCKAGE — and the verge is
         exactly where a berm, a kerb, a guardrail and a seawall BELONG. Without
         this, biome_snow.js's Mercy berm (13.2 m off a deck whose derived
         carriageway reaches 13.5) would be swallowed whole by the very road it
         edges. But "alongside" is a matter of OFFSET, not of bearing: a wall
         lying down the middle of a lane is a blockage however it points. So a
         near-parallel run is judged against the TARMAC and a crossing one
         against the whole carriageway — the difference between the two IS the
         verge, which is the thing being protected. */
      const across = r.vertical ? Math.abs(ux) : Math.abs(uz);
      const par = across < PARALLEL_DOT;
      if (par) {
        // …and the MEDIAN of a divided road is a legal place to stand one.
        const lat = Math.abs((r.vertical ? (x0 + x1) / 2 - r.x : (z0 + z1) / 2 - r.z));
        if (lat <= medianBand(r)) continue;
      }
      const gh = par ? travelledHalf(r, half) : carriageHalf(r, half);
      const al = r.len / 2 + half;
      const bx0 = r.vertical ? r.x - gh : r.x - al;
      const bx1 = r.vertical ? r.x + gh : r.x + al;
      const bz0 = r.vertical ? r.z - al : r.z - gh;
      const bz1 = r.vertical ? r.z + al : r.z + gh;
      const iv = clipT(x0, z0, dx, dz, bx0, bz0, bx1, bz1);
      if (iv) cuts.push(iv);
    }
    if (!cuts.length) { ledgerPush(id, one); return one; }
    // merge the cut intervals, then keep what is left of [0,1]
    cuts.sort(function (a, b) { return a[0] - b[0]; });
    const merged = [];
    for (let i = 0; i < cuts.length; i++) {
      const c = cuts[i], last = merged[merged.length - 1];
      if (last && c[0] <= last[1] + 1e-6) { if (c[1] > last[1]) last[1] = c[1]; }
      else merged.push([c[0], c[1]]);
    }
    const minLen = opts.min != null ? opts.min : 0.5;
    const out = [];
    let t = 0;
    for (let i = 0; i <= merged.length; i++) {
      const nt = i < merged.length ? merged[i][0] : 1;
      if (nt - t > 0) {
        const px0 = x0 + dx * t, pz0 = z0 + dz * t;
        const px1 = x0 + dx * nt, pz1 = z0 + dz * nt;
        const len = Math.hypot(px1 - px0, pz1 - pz0);
        if (len >= minLen) out.push({ x0: px0, z0: pz0, x1: px1, z1: pz1, len: len, cx: (px0 + px1) / 2, cz: (pz0 + pz1) / 2 });
      }
      if (i < merged.length) t = Math.max(t, merged[i][1]);
    }
    gapSplitRuns++;
    gapCuts += merged.length;
    ledgerPush(id, out);
    if (!out.length) gapSwallowed++;
    return out;
  }

  /* THE BLOCK. Synchronous form: for a builder whose crossing roads already
     exist (anything running after the road it must not block). */
  CBZ.roadGapRun = function (x0, z0, x1, z1, opts) { return splitRun(x0, z0, x1, z1, opts); };

  /* THE DEFERRED FORM. For a run built BEFORE the roads that cross it — which
     is most of them (see the header). `draw` is called once per surviving
     piece at order 98.6, with the piece and its index. Flag off => drawn
     immediately, unsplit, exactly as the caller used to. */
  const pendingRuns = [];
  CBZ.roadGapDefer = function (x0, z0, x1, z1, opts, draw) {
    if (typeof draw !== "function") return null;
    if (!gapOn()) {
      draw({ x0: x0, z0: z0, x1: x1, z1: z1, len: Math.hypot(x1 - x0, z1 - z0), cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 }, 0);
      return null;
    }
    gapDeferred++;
    const job = { x0: x0, z0: z0, x1: x1, z1: z1, opts: opts || {}, draw: draw };
    pendingRuns.push(job);
    return job;
  };

  /* THE SAME DEFERRAL, FOR A WHOLE BUILD STEP. Some perimeters are not one run
     but a solve — a post InstancedMesh sized off the path, a merged panel
     geometry and a collider ledger, all of which have to agree about where the
     holes are. Splitting only the colliders would leave posts standing in the
     carriageway you can now drive through, which is a different bug wearing the
     same shape. `fn(city)` runs at order 98.6, once every road in the world
     exists, so a builder registered at order 20-42 can solve against roads that
     are pushed at 91 and 97 without knowing any of those numbers.
     Flag off / roadrules absent => the caller runs it inline, as it always did. */
  const pendingSteps = [];
  // Returns TRUE when it has TAKEN the job — deferred it, or (flag off) run it
  // inline — and false only when it cannot. A caller's guard is
  // `if (!(CBZ.roadGapAfterRoads && CBZ.roadGapAfterRoads(fn))) fn();`, so
  // returning false after already running it would build the step TWICE.
  CBZ.roadGapAfterRoads = function (fn) {
    if (typeof fn !== "function") return false;
    if (!gapOn()) { fn(CBZ.city && CBZ.city.arena ? CBZ.city.arena : CBZ.city); return true; }
    pendingSteps.push(fn);
    return true;
  };

  /* ---- THE LATE PASS -----------------------------------------------------
     Order 98.6: after every landmass builder (≤42), highwaynet (91), the
     continent plate (97) and roadrules' own clearance clamp (98) — so a run is
     split against the roads that SHIPPED, including the ones a clamp shortened
     — and before detail_kit's dressing passes (99).

     It does two things. The first is the deferred draws above. The second is
     the SAFETY NET, and it exists for the same reason the clearance clamp does:
     the law must not depend on a builder cooperating. It walks the world's own
     collider list for LOW LONG RUNS lying across a carriageway and trims them
     out of it — never deleting what is outside the road, never touching
     anything that did not declare a height band (a collider with no y1 is a
     BUILDING, and a building standing in a road is a footprint bug, not a wall
     to cut), never touching a declared `roadBarrier`. The visible mesh of an
     unmigrated run stays drawn; that is scenery, and the audit names it. */
  const RUN_MIN_LEN = 8;        // shorter than this is furniture, not a run
  // Keep the safety net broad enough to catch other authored low wall runs.
  // city/world.js's seawall now collides at its visible 1.4 m thickness, but
  // older builders can still publish runs up to this limit. The aspect gate
  // (>= 3:1) means nothing under 13.5 m long can qualify, so no slab does.
  const RUN_MAX_THICK = 4.5;
  /* TALLER THAN THIS IS NOT TRIMMED, AND THAT IS A DECISION, NOT AN OVERSIGHT.
     The owner's report is knee-to-chest geometry lying in a carriageway, and
     that is what this cuts. A 3-5 m masonry perimeter (city/govcomplex.js's
     nine compounds, the county jail yard at 4.6) is a different object: its
     opening is a GATE somebody authored, its mesh is opaque, and silently
     punching a 21 m collider-shaped hole through a prison wall while the wall
     is still DRAWN would trade a blocked road for a wall you can drive through
     — the same class of bug wearing better clothes. Those are MEASURED instead
     (`tallCrossings` in the audit) so the file that owns them can adopt
     roadGapRun and cut the MESH too, which is the only honest fix at that
     height. */
  const RUN_MAX_TOP = 2.6;
  const TALL_MAX_TOP = 6.0;     // above this it is a building, not a wall at all
  const RUN_MAX_BASE = 0.8;     // a run starting above knee height is a deck, not a kerb
  const RUN_SPAN_FRAC = 0.6;    // it must genuinely cross, not merely touch

  function colliderExempt(c) {
    if (c.roadBarrier || c.gate || c.noGap || c.road) return true;
    const u = c.ref && c.ref.userData;
    return !!(u && (u.roadBarrier || u.noGap));
  }

  // Is this collider a low, long, thin RUN — the shape a wall/kerb/berm/rail
  // makes — as opposed to a building, a plinth or a piece of furniture?
  // A collider with NO declared y1 is full-height, i.e. a BUILDING: a building
  // standing in a road is a footprint bug in the builder that placed it, not a
  // wall to cut, so it is never touched here.
  function isRun(c, top) {
    if (!c || !isFinite(c.minX) || !isFinite(c.minZ)) return false;
    if (c.y1 == null || !isFinite(c.y1)) return false;
    if (c.y1 > (top || RUN_MAX_TOP) || (c.y0 || 0) > RUN_MAX_BASE) return false;
    const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
    const lo = Math.min(w, d), hi = Math.max(w, d);
    return hi >= RUN_MIN_LEN && lo <= RUN_MAX_THICK && hi >= lo * 3;
  }
  // The box one road punches through a run. `par` picks the TARMAC band for a
  // run lying alongside and the whole carriageway for one crossing — the same
  // verge distinction splitRun makes, applied to an AABB.
  function roadBox(r, par, out) {
    const gh = par ? travelledHalf(r, 0) : carriageHalf(r, 0), al = r.len / 2;
    out[0] = r.vertical ? r.x - gh : r.x - al;
    out[1] = r.vertical ? r.x + gh : r.x + al;
    out[2] = r.vertical ? r.z - al : r.z - gh;
    out[3] = r.vertical ? r.z + al : r.z + gh;
    out[4] = gh;
    return out;
  }
  const _rb = [0, 0, 0, 0, 0];
  /* Which road (if any) this run BLOCKS. Two shapes count and nothing else:
       · it CROSSES — perpendicular, and it covers at least 60% of the
         carriageway. Touching a carriageway's edge is a kerb doing its job.
       · it LIES ON THE TARMAC — parallel, standing inside the travelled way
         and long enough to matter. A run parallel to a road on the VERGE is
         the correct place for it and is never touched, and the median of a
         divided road is a legal place to stand a barrier. */
  function crossedBy(c, R) {
    const vertRun = (c.maxZ - c.minZ) > (c.maxX - c.minX);
    for (let j = 0; j < R.length; j++) {
      const r = R[j];
      if (!r || !(r.len > 0) || r.noGap) continue;
      const par = !!r.vertical === vertRun;
      const b = roadBox(r, par, _rb);
      if (c.maxX <= b[0] || c.minX >= b[1] || c.maxZ <= b[2] || c.minZ >= b[3]) continue;
      if (par) {
        const lat = Math.abs(r.vertical ? (c.minX + c.maxX) / 2 - r.x : (c.minZ + c.maxZ) / 2 - r.z);
        if (lat <= medianBand(r)) continue;                    // a median barrier
        const along = vertRun ? Math.min(c.maxZ, b[3]) - Math.max(c.minZ, b[2])
                              : Math.min(c.maxX, b[1]) - Math.max(c.minX, b[0]);
        if (along < RUN_MIN_LEN) continue;
        return r;
      }
      const ovl = vertRun ? Math.min(c.maxZ, b[3]) - Math.max(c.minZ, b[2])
                          : Math.min(c.maxX, b[1]) - Math.max(c.minX, b[0]);
      if (ovl < (b[4] * 2) * RUN_SPAN_FRAC) continue;
      return r;
    }
    return null;
  }

  function sweepColliders(city) {
    const cols = CBZ.colliders;
    const R = (city && city.roads) || gapRoads();
    if (!cols || !cols.length || !R || !R.length) return;
    // A WORK QUEUE, not one pass: cutting a run in two can leave a tail that
    // crosses a SECOND road, and a safety net that only ever cuts once is a net
    // with a hole in it. Every piece produced is re-tested.
    const queue = [];
    for (let i = 0; i < cols.length; i++) if (isRun(cols[i])) queue.push(cols[i]);
    const dead = [];
    let guard = 0;
    while (queue.length && guard++ < 20000) {
      const c = queue.pop();
      if (c._roadGapDead) continue;
      if (colliderExempt(c)) { gapExempt++; continue; }
      const r = crossedBy(c, R);
      if (!r) continue;
      // A CUT THIS SWEEP CANNOT ENFORCE IS NOT A CUT. Every edit below moves
      // minX..maxZ, but physics.js resolves an ORIENTED record (one carrying
      // c.yaw) against its own cx/cz/hw/hd instead — so trimming the bounding
      // box of one would leave the wall standing in the road and report a
      // trim that never happened. Shedding the orientation here degrades that
      // one piece to the bounding box it already carries, which is what the
      // whole world was before oriented colliders existed, and lets the cut
      // land. A shallow-angle run (the only shape that reaches this line — a
      // steep one is too square to pass isRun) barely widens.
      if (c.yaw) { c.yaw = 0; c.cx = c.cz = c.hw = c.hd = undefined; orientedTrimmed++; }
      const vertRun = (c.maxZ - c.minZ) > (c.maxX - c.minX);
      const b = roadBox(r, !!r.vertical === vertRun, _rb);
      const lo0 = vertRun ? c.minZ : c.minX, hi0 = vertRun ? c.maxZ : c.maxX;
      const cut0 = vertRun ? b[2] : b[0], cut1 = vertRun ? b[3] : b[1];
      const keepLo = cut0 - lo0, keepHi = hi0 - cut1;
      trimmedColliders++;
      if (keepLo > 0.5 && keepHi > 0.5) {
        const tail = { minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ, y0: c.y0, y1: c.y1, ref: c.ref, noCam: c.noCam, _roadGapped: true };
        if (vertRun) { tail.minZ = cut1; c.maxZ = cut0; } else { tail.minX = cut1; c.maxX = cut0; }
        cols.push(tail); queue.push(tail); queue.push(c);
      } else if (keepLo > 0.5) {
        if (vertRun) c.maxZ = cut0; else c.maxX = cut0;
        queue.push(c);
      } else if (keepHi > 0.5) {
        if (vertRun) c.minZ = cut1; else c.minX = cut1;
        queue.push(c);
      } else {
        // the whole run lies in the carriageway — nothing of it should exist
        c._roadGapDead = true; dead.push(c);
      }
      c._roadGapped = true;
    }
    if (dead.length) {
      // compact in place: CBZ.colliders is held by reference all over the game
      // (physics.js's broadphase, LOS, demolition), so it is never reassigned.
      let w = 0;
      for (let i = 0; i < cols.length; i++) { const c = cols[i]; if (!c || !c._roadGapDead) cols[w++] = c; }
      cols.length = w;
    }
  }

  if (CBZ.addLandmass) CBZ.addLandmass(function (city) {
    if (!gapOn()) { pendingRuns.length = 0; pendingSteps.length = 0; return; }
    // whole build steps first: they may themselves register runs
    let drew = pendingSteps.length;
    for (let i = 0; i < pendingSteps.length; i++) {
      try { pendingSteps[i](city); } catch (e) { console.error("[roadrules gap step]", e); }
    }
    pendingSteps.length = 0;
    for (let i = 0; i < pendingRuns.length; i++) {
      const j = pendingRuns[i];
      const o = j.opts || {};
      if (o.city == null) o.city = city;
      const pieces = splitRun(j.x0, j.z0, j.x1, j.z1, o);
      for (let k = 0; k < pieces.length; k++) { try { j.draw(pieces[k], k); drew++; } catch (e) { console.error("[roadrules gap]", e); } }
    }
    pendingRuns.length = 0;
    if (CBZ.CONFIG.ROAD_GAP_ENFORCE !== false) { try { sweepColliders(city); } catch (e) { console.error("[roadrules gap sweep]", e); } }
    if (drew || trimmedColliders) { if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
  }, 98.6);

  /* ---- THE BLOCKED-ROAD RATCHET (CLAUDE.md BLOCK LAW #5) -----------------
     `crossingsRemaining` is a LIVE re-ask of the FINAL world: every run this
     block ever saw, re-tested against the roads that shipped. It is the
     structural number and its target is 0 — a run in the ledger that still
     crosses a carriageway means the split ran too early or was refused.

     `worldBlockers` is the honest one, and it is deliberately NOT computed
     from the ledger: it walks CBZ.colliders for a low long run lying across a
     carriageway whether or not anybody adopted anything, so a producer that
     never called this block cannot hide behind a clean ledger. `where` names
     each one. `trimmed` says how many the safety net had to cut, which is the
     number that should fall as producers migrate. */
  CBZ.roadBlockAudit = function () {
    const R = gapRoads() || [];
    let remaining = 0;
    const where = {};
    for (let i = 0; i < gapLedger.length; i++) {
      const g = gapLedger[i];
      const dx = g.x1 - g.x0, dz = g.z1 - g.z0;
      const rl = Math.hypot(dx, dz) || 1;
      const ux = dx / rl, uz = dz / rl;
      for (let j = 0; j < R.length; j++) {
        const r = R[j];
        if (!r || !(r.len > 0) || r.noGap) continue;
        if ((r.vertical ? Math.abs(ux) : Math.abs(uz)) < 0.25) continue;   // a verge, not a crossing
        const gh = carriageHalf(r, 0), al = r.len / 2;
        const bx0 = r.vertical ? r.x - gh : r.x - al, bx1 = r.vertical ? r.x + gh : r.x + al;
        const bz0 = r.vertical ? r.z - al : r.z - gh, bz1 = r.vertical ? r.z + al : r.z + gh;
        if (clipT(g.x0, g.z0, dx, dz, bx0, bz0, bx1, bz1)) {
          remaining++; where[g.id] = (where[g.id] || 0) + 1; break;
        }
      }
    }
    let blockers = 0, exemptNow = 0, runs = 0, tall = 0;
    const cols = CBZ.colliders || [];
    const blockWhere = {}, tallWhere = {};
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const short = isRun(c);
      if (!short && !isRun(c, TALL_MAX_TOP)) continue;
      if (colliderExempt(c)) { exemptNow++; continue; }
      const r = crossedBy(c, R);
      const k = r ? ((r.route || r.district || "road") + "@" + Math.round(r.x) + "," + Math.round(r.z)) : null;
      if (short) {
        runs++;
        if (!r) continue;
        blockers++; blockWhere[k] = (blockWhere[k] || 0) + 1;
      } else {
        // above the trim ceiling: measured, never cut. See RUN_MAX_TOP.
        if (!r) continue;
        tall++; tallWhere[k + " (h" + Math.round(c.y1) + ")"] = (tallWhere[k + " (h" + Math.round(c.y1) + ")"] || 0) + 1;
      }
    }
    return {
      runsChecked: gapRuns, runsSplit: gapSplitRuns, gaps: gapCuts,
      swallowed: gapSwallowed, deferred: gapDeferred, pending: pendingRuns.length,
      crossingsRemaining: remaining, worldBlockers: blockers,
      tallCrossings: tall, exempt: exemptNow, exemptSeen: gapExempt,
      trimmed: trimmedColliders, colliderRuns: runs,
      // of those trims, how many landed on an oriented collider and
      // therefore shed its yaw to take effect (see sweepColliders)
      orientedTrimmed: orientedTrimmed,
      ledger: gapLedger.length, segments: R.length,
      where: where, blockWhere: blockWhere, tallWhere: tallWhere,
    };
  };

  /* ---- THE POST-BUILD ENFORCEMENT PASS -----------------------------------
     Order 98: after every landmass/biome/island/mini-city/gov builder (≤42),
     after highwaynet (91) and the continent plate (97), before detail_kit's
     dressing passes (99) — so the props that follow already see clamped roads.

     This is what makes the law a LAW rather than a guideline: it does not
     depend on any builder cooperating. What it clamps is the RECORD, and the
     record is what traffic, roadPick, roadSegmentAt, roadCross, the navmesh,
     the map and every prop walker read — so a clamped segment is one no car
     and no streetlight will ever occupy again. A deck already drawn past the
     boundary stays drawn; that is scenery, and the warning below names the
     exact leg so its builder can be retuned. */
  if (CBZ.addLandmass) CBZ.addLandmass(function (city) {
    if (!clearanceOn() || CBZ.CONFIG.ROAD_CLEARANCE_ENFORCE === false) return;
    const R = (city && city.roads) || null;
    if (!R || !R.length) return;
    places = null; keepOuts = null;                  // world just changed shape
    clampedSegs = 0; clampedMetres = 0;
    for (let i = 0; i < R.length; i++) {
      const seg = R[i];
      if (!seg || seg._clearance) continue;
      const cut = CBZ.roadClamp(seg, { city: city });
      if (cut > 0) {
        try {
          console.warn("[roadrules] clamped " + (seg.district || "road") + " segment " +
            (seg.route ? seg.route + " " : "") + "at (" + Math.round(seg.x) + "," + Math.round(seg.z) +
            ") — it crossed '" + seg._clearance.blockedBy + "' by " + seg._clearance.depth +
            " m; " + Math.round(cut) + " m removed. Fix the builder so the DECK stops there too.");
        } catch (e) {}
      }
    }
    /* THE HALF WE DELIBERATELY DO NOT CLAMP — say it out loud every build.
       A road running inside a HARD keep-out cannot be shortened from here
       without risking stranding the facility it serves (island_airport.js's
       landside perimeter road lies inside the airside rect for its whole
       length, and cutting it would leave the terminal with no road at all).
       That is a bug in the FACILITY'S OWN FOOTPRINT, so the only honest thing
       this pass can do is refuse to be silent about it. Props are already
       refused there unconditionally by roadPropClear. */
    const zt = keepOutTable({ city: city });
    const dockB = CBZ.CONFIG.ROAD_CLEARANCE_DOCK || 24;
    for (let i = 0; i < R.length; i++) {
      const seg = R[i];
      if (!seg || seg.access || !(seg.len > 0)) continue;
      for (let j = 0; j < zt.length; j++) {
        const p = zt[j];
        if (p.civ) continue;                        // bars civilians, not roads
        const cl = seg.vertical ? seg.x : seg.z;
        const lLo = seg.vertical ? p.minX : p.minZ, lHi = seg.vertical ? p.maxX : p.maxZ;
        if (cl <= lLo || cl >= lHi) continue;
        const aLo = seg.vertical ? p.minZ : p.minX, aHi = seg.vertical ? p.maxZ : p.maxX;
        const a0 = (seg.vertical ? seg.z : seg.x) - seg.len / 2;
        const a1 = a0 + seg.len;
        const ov = Math.min(a1, aHi) - Math.max(a0, aLo);
        if (ov <= dockB) continue;
        // Same test as the audit: an approach that STOPS inside is a gate road;
        // one that goes in one side and out the other is a through-route across
        // a restricted facility. Only the second is worth shouting about.
        const span = seg.vertical ? (p.maxZ - p.minZ) : (p.maxX - p.minX);
        if (ov < span - 2) continue;
        try {
          console.warn("[roadrules] " + (seg.district || "road") + " segment at (" +
            Math.round(seg.x) + "," + Math.round(seg.z) + ") crosses keep-out '" + p.name +
            "' end to end (" + Math.round(ov) + " m) — NOT clamped, because clamping a road " +
            "out of a keep-out can strand the facility it serves. Shrink that zone (or move " +
            "the road) in the builder that owns it.");
        } catch (e2) {}
      }
    }
  }, 98);

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
    const mph = mphOf(car.v);
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

  /* ---- THE CLEARANCE RATCHET (CLAUDE.md BLOCK LAW #5) --------------------
     A LIVE measurement of the built world, not a count of call sites. Every
     number is recomputed from city.roads × city.regions × city.noSpawn on each
     call, so it cannot go stale and it cannot be satisfied by a comment.

       violations      roads CROSSING a place they neither own nor end in.
                       THE RATCHET. Pinned at its measured baseline; may only
                       go DOWN.
       propsInside     kerb-adjacent street furniture standing inside a place
                       its road is only passing, or inside ANY keep-out. THE
                       SECOND RATCHET, and the owner's actual sentence.
       dockedInside    roads that TERMINATE inside a place (the destination
                       rule). EVIDENCE, NOT A PIN — a legal shape, but if this
                       number or `deepestDocked` grows a lot somebody has
                       started calling a 600 m cross-country run a "dock", and
                       that is exactly the quiet redefinition CLAUDE.md warns
                       about. It is reported separately so it can never absorb
                       a real violation, the way govComplexAudit's
                       `urbanAdjacent` does.
       zoneCrossings   roads that enter a HARD keep-out through one side and
                       leave through the other — a through-route across a
                       restricted facility, as distinct from an approach that
                       ends at its gate. Deliberately NOT clamped (see the
                       header): each one is a bug in a FACILITY'S OWN
                       footprint, and `zoneWhere` names it so it cannot hide.
       civZoneRoads    the same, for `civ` zones (govcomplex's residences),
                       which bar civilians rather than roads. */
  CBZ.roadClearanceAudit = function () {
    const A = worldRef();
    const R = (A && A.roads) || [];
    const tab = placeTable(), zs = keepOutTable();
    let violations = 0, links = 0, dockedInside = 0, internal = 0, owned = 0;
    let deepestIntrusion = 0, deepestDocked = 0, zoneCrossings = 0, civZoneRoads = 0;
    const where = {}, zoneWhere = {}, dockWhere = {};
    const dock = CBZ.CONFIG.ROAD_CLEARANCE_DOCK || 24;

    function scan(seg, p, isZone) {
      const vertical = !!seg.vertical;
      const hw = (seg.w != null ? seg.w : (A && A.ROAD) || 18) / 2;
      const h = (seg.len || 0) / 2;
      const cl = vertical ? seg.x : seg.z;
      const a0 = (vertical ? seg.z : seg.x) - h, a1 = (vertical ? seg.z : seg.x) + h;
      const lLo = vertical ? p.minX : p.minZ, lHi = vertical ? p.maxX : p.maxZ;
      const aLo = vertical ? p.minZ : p.minX, aHi = vertical ? p.maxZ : p.maxX;
      const ov = Math.min(a1, aHi) - Math.max(a0, aLo);
      if (ov <= 0) return null;
      if (p.circle) {
        const rminX = vertical ? cl - hw : a0, rmaxX = vertical ? cl + hw : a1;
        const rminZ = vertical ? a0 : cl - hw, rmaxZ = vertical ? a1 : cl + hw;
        const cdx = Math.max(rminX - p.cx, 0, p.cx - rmaxX);
        const cdz = Math.max(rminZ - p.cz, 0, p.cz - rmaxZ);
        if (cdx * cdx + cdz * cdz >= p.r * p.r) return null;
      }
      if (cl <= lLo || cl >= lHi) return { graze: true, ov: ov };
      const e = segEnds(seg);
      const endsIn = ptIn(p, e.x0, e.z0) || ptIn(p, e.x1, e.z1);
      const wholly = ov >= (seg.len || 0) - 1;
      return { ov: ov, endsIn: endsIn, wholly: wholly, owns: !isZone && ownsPlace(seg, p) };
    }

    for (let i = 0; i < R.length; i++) {
      const seg = R[i];
      if (!seg || !isFinite(seg.x) || !(seg.len > 0)) continue;
      for (let j = 0; j < tab.length; j++) {
        const hit = scan(seg, tab[j], false);
        if (!hit) continue;
        if (hit.graze || hit.ov <= dock) { links++; continue; }
        if (hit.wholly || hit.owns) { hit.wholly ? internal++ : owned++; continue; }
        if (hit.endsIn) {
          dockedInside++;
          if (hit.ov > deepestDocked) deepestDocked = hit.ov;
          dockWhere[tab[j].name] = (dockWhere[tab[j].name] || 0) + 1;
          continue;
        }
        violations++;
        if (hit.ov > deepestIntrusion) deepestIntrusion = hit.ov;
        where[tab[j].name] = (where[tab[j].name] || 0) + 1;
      }
      for (let j = 0; j < zs.length; j++) {
        if (seg.access) continue;                    // a service lane belongs on restricted ground
        const p = zs[j];
        const hit = scan(seg, p, true);
        if (!hit || hit.graze || hit.ov <= dock) continue;
        // A `civ` zone bars CIVILIANS, not roads (govcomplex's residences), so
        // it is reported apart from the hard perimeters — a road through the
        // Governor's drive is not the same offence as one across a runway.
        if (p.civ) { civZoneRoads++; continue; }
        // THE TEST THAT SEPARATES A GATE FROM A TRESPASS, and it deliberately
        // does NOT use the destination rule. An approach road ending at a
        // compound's gate is 100+ m inside a hard perimeter and that is what a
        // gate road IS. What is never right is a road that enters a restricted
        // perimeter through one side and leaves through the other: that is a
        // through-route across the facility, and it is exactly what
        // island_airport.js's landside perimeter road does to the airside rect.
        // Using "endsIn" here would have scored the airport 0 — the quiet
        // redefinition this audit exists to prevent.
        const span = seg.vertical ? (p.maxZ - p.minZ) : (p.maxX - p.minX);
        if (hit.ov < span - 2) continue;              // stops inside: a gate road
        zoneCrossings++;
        zoneWhere[p.name] = (zoneWhere[p.name] || 0) + 1;
      }
    }

    /* propsInside — a LIVE geometric read, no bookkeeping added anywhere. A
       piece of street furniture is a SMALL collider standing at a road's kerb;
       colliders, roads and regions are all already in the world, so this asks
       the world rather than trusting a counter a scatter loop kept. */
    let props = 0, propsInside = 0, propsInZone = 0;
    const cols = CBZ.colliders || [];
    const defW = (A && A.ROAD) || 18;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c || !isFinite(c.minX)) continue;
      const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
      if (!(w <= 3.2 && d <= 3.2)) continue;         // street-furniture sized
      const x = (c.minX + c.maxX) / 2, z = (c.minZ + c.maxZ) / 2;
      let road = null;
      for (let k = 0; k < R.length; k++) {
        const r = R[k];
        if (!r || !(r.len > 0)) continue;
        const hw = (r.w != null ? r.w : defW) / 2;
        if (r.vertical) {
          if (Math.abs(z - r.z) > r.len / 2) continue;
          const dx = Math.abs(x - r.x); if (dx >= hw - 1 && dx <= hw + 6) { road = r; break; }
        } else {
          if (Math.abs(x - r.x) > r.len / 2) continue;
          const dz = Math.abs(z - r.z); if (dz >= hw - 1 && dz <= hw + 6) { road = r; break; }
        }
      }
      if (!road) continue;
      props++;
      let bad = false;
      for (let j = 0; j < zs.length && !bad; j++) if (ptIn(zs[j], x, z)) { bad = true; propsInZone++; }
      if (!bad) {
        const e = segEnds(road);
        for (let j = 0; j < tab.length && !bad; j++) {
          const p = tab[j];
          if (!ptIn(p, x, z)) continue;
          if (ownsPlace(road, p)) continue;
          if (ptIn(p, e.x0, e.z0) || ptIn(p, e.x1, e.z1)) continue;
          bad = true;
        }
      }
      if (bad) propsInside++;
    }

    return {
      segments: R.length, places: tab.length, keepOuts: zs.length,
      violations: violations, deepestIntrusion: Math.round(deepestIntrusion), where: where,
      propsInside: propsInside, kerbProps: props, propsInKeepOut: propsInZone,
      links: links, internal: internal, owned: owned,
      dockedInside: dockedInside, deepestDocked: Math.round(deepestDocked), dockWhere: dockWhere,
      zoneCrossings: zoneCrossings, zoneWhere: zoneWhere, civZoneRoads: civZoneRoads,
      clampedSegs: clampedSegs, clampedMetres: Math.round(clampedMetres),
      propTested: propTested, propRefused: propRefused,
    };
  };
})();
