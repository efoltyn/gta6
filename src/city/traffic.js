/* ============================================================
   city/traffic.js — the ROAD SYSTEM brain: traffic-light cycle +
   traffic-law enforcement, plus the living-city layer on top of the
   ambient car AI that vehicles.js drives (order 37).

   Lights: all intersections share one phase clock (readable: every
   light flips green/red together by axis). Driving through a red, or
   recklessly mowing the sidewalk, earns a little heat if it's seen —
   the gateway crime that can start a chase from nothing.

   THE LIVING-CITY LAYER (new):
     • DENSITY that scales with city area + UPKEEP that respawns culled
       cars far from you so streets never go dead (GTA "population pool").
     • DRIVER PERSONALITIES — cautious / normal / aggressive / reckless —
       tagged onto ambient cars and read here for road behaviour.
     • HONKING + ROAD RAGE — a car stuck behind a dawdler on a green leans
       on the horn; an aggressive driver who's been blocked too long
       SNAPS and rams (hands the target to vehicles.js's road-rage code).
     • QUEUES THAT DISSOLVE — every driver (even a cautious one, just
       later) eventually pulls around a dead obstacle — a wreck, an
       abandoned car, YOUR parked car — but only when the oncoming lane
       is actually clear. WHY: a queue at a red reads as law; a queue
       that flows around your dumped getaway car reads as a LIVING city,
       and blocking a street with it stays a stunt, not a softlock.
     • EMERGENCY RESPONSE — an AMBULANCE rolls to fresh bodies and a FIRE
       TRUCK screams to burning cars, sirens + flashing bars, then leaves.

   We never rewrite vehicles.js's per-car movement (order 37). We tag
   fields it already understands (driver.aggr, reckless, baseV,
   roadRageTarget/roadRageT) and own our own emergency meshes.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const FOOT_PUSH_O = { posture: "stand", cars: false, clearRadius: 0.38 };
  const g = CBZ.game;
  const THREE = window.THREE;

  const CYCLE = 14;          // seconds for a full N–S / E–W cycle
  // clock in SECONDS (CBZ.now is performance.now() in ms) so the signal
  // actually dwells green/red for real seconds instead of flickering.
  function clock() { return ((CBZ.now || 0) / 1000) % CYCLE; }
  // segment boundaries within the cycle
  function phase() {
    const t = clock();
    if (t < 5) return { ns: "green", ew: "red" };
    if (t < 6.5) return { ns: "yellow", ew: "red" };
    if (t < 7) return { ns: "red", ew: "red" };
    if (t < 12) return { ns: "red", ew: "green" };
    if (t < 13.5) return { ns: "red", ew: "yellow" };
    return { ns: "red", ew: "red" };
  }
  CBZ.cityPhase = phase;
  // is travel along this axis facing a red? (vertical road = N–S travel)
  CBZ.cityIsRed = function (vertical) { const p = phase(); return (vertical ? p.ns : p.ew) !== "green"; };

  function lampSet(lamp, on, color) {
    if (!lamp) return;
    // instanced bulb (props.js SIGNAL_INSTANCED): one pooled instanceColor
    // write instead of three material mutations — only on a real state change.
    if (lamp.sigPool) {
      if (lamp.lit !== !!on && CBZ.citySignalSet) CBZ.citySignalSet(lamp, on, color);
      return;
    }
    if (!lamp.material) return;
    lamp.lit = !!on;   // shared lit-state read (props.js glow/light-pool sync)
    lamp.material.emissiveIntensity = on ? 1.0 : 0.04;
    lamp.material.color.setHex(on ? color : 0x20242a);
    if (lamp.material.emissive) lamp.material.emissive.setHex(color);
  }
  // light a whole signal AXIS to one state. `axis` is either an ARRAY of heads
  // (one per real approach — the current props.js, multiple faces per axis) or
  // a single {red,yel,grn} head (legacy single-head path). Either way the three
  // lamps of every head on that axis show the same colour, so the cross street
  // reads RED while the main runs GREEN exactly like a real 4-way.
  function axisSet(axis, state) {
    if (!axis) return;
    const heads = Array.isArray(axis) ? axis : [axis];
    for (let h = 0; h < heads.length; h++) {
      const head = heads[h];
      if (!head) continue;
      lampSet(head.red, state === "red", 0xff3b3b);
      lampSet(head.yel, state === "yellow", 0xffcf3b);
      lampSet(head.grn, state === "green", 0x39ff66);
    }
  }

  let lightT = 0, ticketCD = 0, prevInside = false;

  CBZ.onUpdate(36, function (dt) {
    // Gang City's grid, or an island town's signalled crossings
    // (world/island_town.js: the same phase clock, the same law)
    if (!(CBZ.economyMode ? CBZ.economyMode(g.mode) : g.mode === "city")) return;
    const A = g.mode === "city" ? CBZ.city.arena : (CBZ.econArena ? CBZ.econArena() : null);
    if (!A || !A.intersections) return;

    // drive the lamp colours (throttled — the colour only changes a few times
    // per cycle, but cheap enough to refresh a couple of times a second)
    lightT -= dt;
    if (lightT <= 0) {
      lightT = 0.25;
      const p = phase();
      for (const it of A.intersections) {
        const L = it.light; if (!L) continue;
        // each axis (an array of approach heads, or a single legacy head) shows
        // its own state — the cross street is red while the main runs green,
        // exactly like a real 4-way signal. ns governs N–S travel, ew E–W.
        axisSet(L.ns || L, p.ns);
        axisSet(L.ew, p.ew);
      }
    }

    // ---- red-light / reckless-driving enforcement ----
    if (ticketCD > 0) ticketCD -= dt;
    const P = CBZ.player;
    if (!P.driving || !P._vehicle) { prevInside = false; return; }
    const v = P._vehicle;
    const it = A.nearestIntersection(P.pos.x, P.pos.z);
    // highways / arterials (the new mini-city + island network) have no city-grid
    // intersection, so this can be null while you drive a causeway — you're never
    // "inside" one out there (avoids a null deref + a phantom red-light ticket).
    const inside = it != null && Math.abs(P.pos.x - it.x) < A.ROAD / 2 + 1.5 && Math.abs(P.pos.z - it.z) < A.ROAD / 2 + 1.5;
    // count it once, on entry, while moving with a red against your heading
    if (inside && !prevInside && Math.hypot(v.vx || 0, v.vz || 0) > 6) {
      const vertical = Math.abs(v.vz || 0) > Math.abs(v.vx || 0);
      if (CBZ.cityIsRed(vertical) && ticketCD <= 0) {
        ticketCD = 4;
        // only a problem if a cop is around to see it (unseen = no narration —
        // the red light you blew through tells its own story)
        const seen = anyCopNear(P.pos.x, P.pos.z, 34);
        if (seen) { CBZ.cityCrime && CBZ.cityCrime(22, { type: "red-light" }); CBZ.city && CBZ.city.note("A cop saw you run the light.", 2); }
      }
    }
    prevInside = inside;
  });

  function anyCopNear(x, z, r) {
    const r2 = r * r;
    for (const c of CBZ.cityCops) { if (c.dead) continue; const dx = c.pos.x - x, dz = c.pos.z - z; if (dx * dx + dz * dz < r2) return true; }
    return false;
  }

  /* ============================================================
     LIVING-CITY LAYER  (everything below only runs in city mode and
     never touches the light cycle / enforcement above)
  ============================================================ */
  if (!THREE) return;

  const TR = () => (CBZ.CITY && CBZ.CITY.traf) || {};
  // multi-lane geometry: lane index → signed lateral offset from the centreline.
  // dir is ±1, idx in [0..lanesPerDir-1]. ROAD-AWARE via CBZ.roadLaneCenter(r,..)
  // so lane targets honour a road's real 3+3 + median cross-section; guard-called
  // fallback keeps the old global-2-lane math. laneWidth() stays global — it's a
  // proximity threshold for "car ahead in my lane" gates, not a lane target.
  const lanesPerDir = (r) => (CBZ.roadLanesPerDir ? CBZ.roadLanesPerDir(r) : Math.max(1, (TR().lanesPerDir != null ? TR().lanesPerDir : 2) | 0));
  const laneWidth = () => (TR().laneW != null ? TR().laneW : 3.6);
  const laneOffset = (r, dir, idx) => CBZ.roadLaneCenter(r, dir, idx);   // config.js: keep right on every axis
  // a record of another vehicle world stacked on these coordinates is not
  // traffic here (Gang City's fleet while you are on the islands, and back)
  const here = (c) => (c._world || "city") === g.mode && !(CBZ.islandTownForeign && CBZ.islandTownForeign(c));
  // the street world the pool runs on: Gang City's arena, or the island in
  // force as a town (world/island_town.js)
  function streetArena() {
    if (g.mode === "city") return (CBZ.city && CBZ.city.arena) || null;
    return CBZ.econArena ? CBZ.econArena() : null;
  }

  // ---- driver personalities ---------------------------------------------
  // A car's aggression stat already lives on c.driver.aggr (0..1) and c.reckless.
  // We bucket it into a readable archetype the moment we first see a car, then
  // use that for honking patience, horn-happiness and road-rage temper. The
  // buckets line up with GTA's vehicleaihandling tiers: timid → menace.
  // ragePatience = seconds blocked before pulling around the obstacle — EVERY
  // tier goes eventually (so queues dissolve and the city never gridlocks);
  // the temperament only sets HOW SOON and HOW ANGRILY.
  const ARCH = {
    cautious:   { honkPatience: 3.2, horny: 0.10, ragePatience: 4.8, cruiseMul: 0.86 },
    normal:     { honkPatience: 1.9, horny: 0.34, ragePatience: 2.6, cruiseMul: 1.0 },
    aggressive: { honkPatience: 0.9, horny: 0.72, ragePatience: 1.6, cruiseMul: 1.12 },
    reckless:   { honkPatience: 0.5, horny: 0.92, ragePatience: 0.9, cruiseMul: 1.2 },
  };
  function classify(c) {
    const a = c.driver ? (c.driver.aggr || 0) : 0;
    if (c.reckless || a >= 0.78) return "reckless";
    if (a >= 0.52) return "aggressive";
    if (a <= 0.22) return "cautious";
    return "normal";
  }
  function tagDriver(c) {
    if (c.trafArch) return;
    c.trafArch = classify(c);
    c.honkCD = 0.5 + Math.random() * 2;
    c.blockedT = 0;            // how long we've been stuck behind a dawdler
  }

  // ---- honk: a real two-note horn (distance-attenuated). The floating "HONK!"
  //      WORD over the car broke the fourth wall and was removed — a horn is a
  //      SOUND, not a label. The pool/liveHonks below stay (now always empty) so
  //      the reset/teardown paths keep working without edits elsewhere. ---------
  const honkPool = [];
  const liveHonks = [];
  function honkAt(c) {
    if (c.honkCD > 0) return;
    const arch = ARCH[c.trafArch] || ARCH.normal;
    c.honkCD = arch.honkPatience + 0.4 + Math.random() * 0.8;
    // only spend a sound if you're near enough to hear it
    const cam = CBZ.camera.position;
    const dd = (c.pos.x - cam.x) * (c.pos.x - cam.x) + (c.pos.z - cam.z) * (c.pos.z - cam.z);
    if (dd > 60 * 60) return;
    if (dd < 34 * 34 && CBZ.sfx && Math.random() < 0.6) CBZ.sfx("horn", { dist: Math.sqrt(dd) });   // a real two-note horn, distance-attenuated
  }
  function updateHonks(dt) {
    for (let i = liveHonks.length - 1; i >= 0; i--) {
      const h = liveHonks[i];
      h.t += dt;
      h.s.position.y = 2.9 + h.t * 1.4;
      if (h.s.material) h.s.material.opacity = Math.max(0, 1 - h.t / h.life);
      if (h.t >= h.life) {
        h.s.visible = false;
        if (h.s.parent) h.s.parent.remove(h.s);
        honkPool.push(h.s);
        liveHonks.splice(i, 1);
      }
    }
  }

  /* WHAT IS IN MY LANE. Both of these used to match on `o.road === c.road`,
     the ROAD RECORD a car was spawned or turned onto. The things a queue most
     needs to see never carry the right one: the car you dumped (its record is
     whatever road it was on when you stole it, blocks ago), a burnt-out husk
     (`dead`, so filtered out entirely), a spun-out wreck that slid across the
     box. vehicles.js's IDM brakes for them because it tests GEOMETRY, so the
     queue stopped behind them forever while this layer, which is the one that
     pulls around, could not see them and never built any patience. Both tests
     are geometry now: a body in the lane, whoever it is. */
  function inLaneFrame(c, o) {
    if (o === c || (o.dead && !o._husk) || o._heldBy) return false;
    return true;
  }
  // is `c` stuck right behind something physically in its lane? Counts
  // same-direction dawdlers, a head-on blocker, parked/dumped cars and husks.
  // `gap` is the BUMPER gap. It used to be centre-to-centre, tested `< 5`, and
  // vehicles.js's IDM parks a queue at a 2 m bumper gap, which is ~6.4 m
  // centre-to-centre for two saloons: no car was ever "stuck", so none of the
  // honking, patience or pulling-around below ever ran on a stopped queue.
  function halfLen(o) { const d = o._visualDims || o.dims; return ((d && d.length) || 4.4) * 0.5; }
  const _blk = { car: null, gap: 0 };
  function blockedAhead(c) {
    if (!c.road) return null;
    const vert = c.road.vertical, fx = vert ? 0 : c.dirSign, fz = vert ? c.dirSign : 0;
    const latTol = laneWidth() * 0.7, myHalf = halfLen(c);
    let best = null, bg = 1e9;
    const cars = CBZ.cityCars;
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i];
      if (!inLaneFrame(c, o)) continue;
      const dx = o.pos.x - c.pos.x, dz = o.pos.z - c.pos.z;
      const along = dx * fx + dz * fz;
      if (along < 0.4 || along > 16) continue;
      if (Math.abs(dx * fz - dz * fx) > latTol) continue;
      const gap = along - myHalf - halfLen(o);
      if (gap < bg) { bg = gap; best = o; }
    }
    if (!best) return null;
    _blk.car = best; _blk.gap = bg;       // scratch: read immediately by the one caller
    return _blk;
  }

  // is the lane at lateral offset `targetLat` on `c`'s road clear enough to pull
  // into? Checks a window behind->ahead for anything sitting in (or barrelling
  // down) that lane, on any road record: a husk or a dumped car counts.
  function laneFree(c, targetLat) {
    if (!c.road) return false;
    const vert = c.road.vertical, half = laneWidth() * 0.6;
    const cars = CBZ.cityCars;
    for (let i = 0; i < cars.length; i++) {
      const o = cars[i];
      if (!inLaneFrame(c, o)) continue;
      const oLat = vert ? o.pos.x - c.road.x : o.pos.z - c.road.z;
      if (Math.abs(oLat - targetLat) > half) continue;    // not in the target lane
      const along = vert ? (o.pos.z - c.pos.z) * c.dirSign : (o.pos.x - c.pos.x) * c.dirSign;
      // an ONCOMING car in that lane closes fast: give it more room ahead
      const ahead = o.ai && o.dirSign === -c.dirSign && o.road && !!o.road.vertical === !!vert ? 30 : 14;
      if (along > -8 && along < ahead) return false;
    }
    return true;
  }
  // pick an adjacent SAME-DIRECTION lane to overtake into (idx±1 within
  // [0..lanesPerDir-1]); returns the target lateral offset or null if boxed in.
  function overtakeLane(c) {
    const dir = c.dirSign || 1;
    const idx = c.laneIdx != null ? c.laneIdx : 0;
    const cand = [];
    if (idx + 1 < lanesPerDir(c.road)) cand.push(idx + 1);   // prefer pulling outboard
    if (idx - 1 >= 0) cand.push(idx - 1);
    for (const ni of cand) {
      const lat = laneOffset(c.road, dir, ni);
      if (laneFree(c, lat)) return { idx: ni, lat };
    }
    return null;
  }

  // ---- area-scaled density + population upkeep --------------------------
  // GTA keeps a FIXED-SIZE pool of vehicles around the player and recycles the
  // ones that fall far out of view back into the streets near you — so the
  // density you SEE stays high without ever growing the pool. We do exactly
  // that with the existing ambient cars (zero new spawns, no vehicles.js edit):
  //   • target a "near-density" that scales with the city's road count,
  //   • when too few ambient cars are near the camera, take one that's driven
  //     way off (far from player + camera) and teleport it onto a road just
  //     out of sight ahead of you, ready to drive into frame.
  let targetNear = 0, upkeepT = 0, lastArena = null, _farSeedT = 0;
  // ---- TIME-OF-DAY DENSITY (GTA popcycle pattern, PROCGEN.md roadmap #4) ----
  // WHY: a city that's equally busy at 3am and at rush hour doesn't read as
  // alive — real streets swell for the commute and go quiet overnight. Feature-
  // detects schedule.js's cached sun-hour clock (CBZ.citySunHour(), 0..24,
  // 8Hz-cached off CBZ.sunAngle) so this degrades to a flat 1.0 multiplier if
  // schedule.js hasn't loaded (headless / older build). Runtime-only density —
  // no rng() draw, no effect on the deterministic world build.
  function hourDensityMul() {
    const h = CBZ.citySunHour ? CBZ.citySunHour() : null;
    if (h == null) return 1.0;
    if ((h >= 7 && h < 9) || (h >= 16 && h < 19)) return 1.25;   // rush hour
    if (h >= 2 && h < 5) return 0.35;                            // deep night
    if (h >= 19 || h < 2) return 0.8;                            // evening (19:00-02:00)
    return 1.0;                                                  // day (5:00-7:00, 9:00-16:00)
  }
  // the far traffic's lamps (core/lodlights.js) thin out on the same clock
  CBZ.trafficHourDensity = hourDensityMul;
  function computeTarget(A) {
    // an island town keeps most of its own small pool round you
    if (A.noGrid) return Math.max(2, Math.round(islandTarget() * 0.6));
    // base on number of road segments (≈ block grid) — bigger grid → more cars.
    const roads = (A.roads && A.roads.length) || 16;
    const base = (TR().traffic != null ? TR().traffic : (CBZ.CITY && CBZ.CITY.traffic) || 66);
    // a fraction of the whole fleet should be visibly near you at any time,
    // scaled gently with the road count vs. a 16-segment reference city.
    const scaled = base * Math.min(1.6, Math.max(0.7, roads / 16));
    // quality / perf governor (CBZ.qualityLevel 0..4): weak devices keep fewer
    // cars active near the camera so the recycle never costs frames.
    const q = CBZ.qualityLevel != null ? CBZ.qualityLevel : 2;
    const qmul = q <= 1 ? 0.5 : (q === 2 ? 0.74 : 0.95);
    // 0.42 → 0.6 and the cap 40 → 56: measured on the Midtown avenue at noon,
    // the old pool put nine cars inside a 120 m camera cone and ONE on the
    // whole visible avenue — a street with no traffic on it. The far-car
    // stride and the recycle radius are unchanged, so the extra cars live
    // where you are looking and nowhere else.
    return Math.max(6, Math.min(56, Math.round(scaled * 0.6 * qmul * hourDensityMul())));
  }
  const NEAR2 = 80 * 80;     // "near the camera" radius²
  const FAR2 = 150 * 150;    // "way off" radius² (past the per-car draw; pools draw it beyond)
  // A CAR THE CAMERA CAN SEE IS NEVER MOVED (owner 2026-10-11: nothing may
  // vanish or appear in view). 150 m is not out of sight: the instanced car
  // pools draw traffic out to the fog, so a recycled car used to blink out
  // mid-avenue. core/sight.js answers "could the camera see it" (inside the
  // eye's reach and on a padded screen).
  function seen(c) { return !!(CBZ.sightCanSee && CBZ.sightCanSee(c.pos.x, (c.pos.y || 0) + 1, c.pos.z, 3)); }
  function countNear() {
    const cam = CBZ.camera.position;
    let near = 0;
    for (const c of CBZ.cityCars) {
      if (!c.ai || c.dead || c.owned || c.player || !c.road || c.abandoned || !here(c)) continue;
      const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z;
      if (dx * dx + dz * dz < NEAR2) near++;
    }
    return near;
  }
  // recycle ONE far-away ambient car onto a road segment just out of sight,
  // generally ahead of the player so it drives into frame naturally.
  function recycleOne(A) {
    const P = CBZ.player.pos, cam = CBZ.camera.position;
    // pick the farthest healthy, idle-ish ambient car to relocate
    let pick = null, pd = FAR2;
    for (const c of CBZ.cityCars) {
      if (!c.ai || c.dead || c.owned || c.player || !c.road || c._patrolCar || !here(c)) continue;   // never yank a police patrol cruiser
      if (c.abandoned || c.wreckT > 0 || c.turning || c.npcDriver || c.pullover || c.roadRageTarget || (c._rageT || 0) > 0) continue;
      if ((c.crumple || 0) > 0.05 || c._onFire || c._smoking) continue;   // don't teleport visible wrecks
      // NEVER TELEPORT A CAR WITH PEOPLE IN IT (vehicles.js CAR_OCCUPANCY_REAL).
      // A car near enough to hold real seated rigs is by definition near the
      // player, and a car somebody has already been dragged out of is a scene
      // in progress, not spare rolling stock.
      if (c._occRigged || (c.occ && c.occ.jacked)) continue;
      const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z, d = dx * dx + dz * dz;
      if (d > pd && !seen(c)) { pd = d; pick = c; }
    }
    if (!pick) return false;
    // ADOPTED: roadrules.js's CBZ.roadPick + CBZ.roadPlace. The annulus, the
    // camera distance and the field writes were all hand-rolled here; the
    // block does them, and adds the three tests this loop never had — the
    // keep-out zones (so a recycle can no longer drop a car on the runway),
    // open water, and — the one that actually mattered — WHETHER THE CAMERA IS
    // LOOKING AT IT. `dc < 62*62` only asked how FAR the camera was, so a car
    // could pop into existence dead ahead at 63 m and pass the test.
    if (CBZ.roadPickUsed) CBZ.roadPickUsed("traffic:recycleOne");
    if (CBZ.roadPick && CBZ.roadPlace) {
      const spot = CBZ.roadPick({
        near: P, minDist: 50, maxDist: 120, camMin: 62, unseen: true, tries: 14, spread: 90,
      });
      if (!spot || !CBZ.roadPlace(pick, spot)) return false;
      // A RELOCATED CAR IS A DIFFERENT CAR. Its occupancy is a fact latched at
      // the point it was populated (vehicles.js), so a car teleported across
      // town re-decides its crew there rather than carrying a stale one — the
      // hour and the district it now sits in are what should answer.
      if (CBZ.carOccupancyReseat) CBZ.carOccupancyReseat(pick);
      return true;
    }
    // find a destination road point that's out of sight but reachable soon
    for (let tries = 0; tries < 8; tries++) {
      const r = A.roads[(Math.random() * A.roads.length) | 0];
      const along = (Math.random() - 0.5) * r.len * 0.8;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const laneIdx = (Math.random() * lanesPerDir(r)) | 0;
      const lane = laneOffset(r, dir, laneIdx);
      const x = r.vertical ? r.x + lane : r.x + along;
      const z = r.vertical ? r.z + along : r.z + lane;
      const dpx = x - P.x, dpz = z - P.z, dp = dpx * dpx + dpz * dpz;
      const dcx = x - cam.x, dcz = z - cam.z, dc = dcx * dcx + dcz * dcz;
      // out of the player's near bubble + off camera, but not on the far edge
      if (dp < 50 * 50 || dp > 120 * 120 || dc < 62 * 62) continue;
      // relocate: vehicles.js (order 37) reads road/lane/dirSign/heading each frame
      pick.road = r; pick.vertical = r.vertical; pick.dirSign = dir; pick.lane = lane; pick.laneIdx = laneIdx;
      pick.pos.x = x; pick.pos.z = z;
      pick.heading = r.vertical ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      pick.v = (pick.baseV || 8) * 0.6;
      pick.group.position.set(x, 0, z);
      pick.group.rotation.y = pick.heading;
      pick.turning = null;
      return true;
    }
    return false;
  }

  /* ---- THE POOL NEVER GOT ITS CARS BACK ------------------------------------
     The ambient fleet is a FIXED pool, and every way a car leaves traffic is
     one-way: you steal it and dump it (ai off for good), its driver is shot or
     bails from gunfire, a gang drive-by leaves it at the kerb. recycleOne only
     ever moves HEALTHY ai cars, so after an hour of play the streets were
     measurably emptier and nothing refilled them. This returns one clean
     abandoned ambient car at a time to the road network, only once it is far
     from you and off camera (the same unseen roadPick recycleOne uses), with a
     fresh crew. Damaged, burnt, shot-up, owned, parked-dressing and scripted
     cars are left exactly where they are: those are evidence, not stock. */
  function reclaimable(c, cam) {
    if (c.player || c.dead || c.ai || c.owned || c._persist || c._propParked || c._heldBy || c.hold || !here(c)) return false;
    if (!(c.baseV > 0) || !(c.abandoned || c._playerLeft)) return false;   // was ambient traffic once
    if (c._patrolCar || c._emergency || c._raceCar || c._cineLocked || c.npcDriver) return false;
    if ((c.crumple || 0) > 0.05 || c._onFire || c._smoking || c._flats || (c.engineHp != null && c.engineHp < 70)) return false;
    if (c._occRigged || (c.wreckT || 0) > 0) return false;
    const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z;
    if (dx * dx + dz * dz < FAR2) return false;
    const P = CBZ.player.pos, px = c.pos.x - P.x, pz = c.pos.z - P.z;
    return px * px + pz * pz >= FAR2 && !seen(c);
  }
  let _reclaimScan = 0;
  function reclaimOne() {
    if (!CBZ.roadPick || !CBZ.roadPlace) return false;
    const cars = CBZ.cityCars, n = cars.length;
    if (!n) return false;
    const cam = CBZ.camera.position;
    let pick = null;
    for (let k = 0; k < Math.min(n, 24) && !pick; k++) {    // a slice per beat: flat cost
      _reclaimScan = (_reclaimScan + 1) % n;
      if (reclaimable(cars[_reclaimScan], cam)) pick = cars[_reclaimScan];
    }
    if (!pick) return false;
    const spot = CBZ.roadPick({ near: CBZ.player.pos, minDist: 60, maxDist: 140, camMin: 62, unseen: true, tries: 10, spread: 90 });
    if (!spot) return false;
    pick.abandoned = false; pick._playerLeft = false; pick.stolen = false;
    pick.wreckT = 0; pick.spin = 0; pick._runaway = false; pick.pullover = 0; pick.npcWanted = 0;
    pick.roadRageTarget = null; pick.roadRageT = 0; pick._panicT = 0; pick._panicBailed = false;
    pick.vx = 0; pick.vz = 0; pick.blockedT = 0; pick._rageT = 0;
    if (pick._rageBoost) { pick.baseV = Math.max(2, pick.baseV - pick._rageBoost); pick._rageBoost = 0; }
    if (!CBZ.roadPlace(pick, spot)) return false;
    pick.ai = true;
    if (pick.occ) pick.occ.jacked = false;          // a new crew; the jack happened to somebody else
    if (CBZ.carOccupancyReseat) CBZ.carOccupancyReseat(pick);
    return true;
  }

  // ---- DISTRICT DISTRIBUTION (traffic-district-distribution + TRAF-1) --------
  // The recycle above keeps the bubble AROUND the player full, but it favours
  // wherever the player is (almost always downtown). The far highways, islands
  // and outlying towns rarely get a car — so the moment you arrive they look
  // dead. These seeders pull an IDLE, far-from-camera ambient car and relocate
  // it onto an OUTLYING tagged road (highway/island/town/bridge/desert/snow...)
  // so the whole drivable map carries traffic, not just the core. WHY: a city
  // that's only alive where you stand isn't a city — it's a stage set. We reuse
  // the EXACT relocation field-writes recycleOne uses (road/vertical/dirSign/
  // lane/laneIdx/pos/heading/v/turning) so vehicles.js order-37 stays in sync.

  // a tagged outlying segment is anything NOT a plain core-grid road (grid roads
  // are pushed WITHOUT a district in world.js; everything outlying is tagged).
  function isOutlying(r) {
    const d = r && r.district;
    // ADOPTED: a segment the traffic-access law has CLOSED (its span lies
    // inside the airport airside / military perimeter / a bunker shell) is not
    // an outlying road that deserves seeding — it is a road nobody may use.
    if (CBZ.roadOpen && !CBZ.roadOpen(r)) return false;
    return d === "highway" || d === "island" || d === "town" || d === "bridge" ||
           d === "desert" || d === "snow" || d === "forest" || d === "farmland";
  }
  // pick the farthest-from-camera idle/healthy ambient car (same filter as
  // recycleOne) that's at least minD2 away — a car nobody is watching.
  function farIdleCar(minD2) {
    const cam = CBZ.camera.position;
    let pick = null, pd = minD2;
    for (const c of CBZ.cityCars) {
      if (!c.ai || c.dead || c.owned || c.player || !c.road || c._patrolCar || !here(c)) continue;   // never yank a police patrol cruiser
      if (c.abandoned || c.wreckT > 0 || c.turning || c.npcDriver || c.pullover || c.roadRageTarget || (c._rageT || 0) > 0) continue;
      if ((c.crumple || 0) > 0.05 || c._onFire || c._smoking) continue;
      if (c._occRigged || (c.occ && c.occ.jacked)) continue;   // people in it — see recycleOne
      const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z, d = dx * dx + dz * dz;
      if (d > pd) { pd = d; pick = c; }
    }
    return pick;
  }
  // write the SAME relocation fields recycleOne writes, onto an explicit road r
  // at a clamped along-offset (long highways get spread out, not bunched at one
  // end). Returns true. Keeps vehicles.js order-37 in sync.
  function placeOnRoad(c, r) {
    // ADOPTED: roadrules.js. `filter` pins the pick to the ONE segment this
    // seeder chose (it already decided WHICH road is empty and deserves a
    // car); everything else — the lane draw, the spread clamp, the keep-out
    // and water refusals, and the field writes order-37 reads — is the block's.
    if (CBZ.roadPickUsed) CBZ.roadPickUsed("traffic:placeOnRoad");
    if (CBZ.roadPick && CBZ.roadPlace && CBZ.roadOpen) {
      if (!CBZ.roadOpen(r)) return false;                 // never seed a closed road
      const spot = CBZ.roadPick({ tries: 8, spread: 90, filter: function (s) { return s === r; } });
      if (!spot || !CBZ.roadPlace(c, spot)) return false;
      if (CBZ.carOccupancyReseat) CBZ.carOccupancyReseat(c);   // new place, new crew — see recycleOne
      return true;
    }
    const dir = Math.random() < 0.5 ? 1 : -1;
    const laneIdx = (Math.random() * lanesPerDir(r)) | 0;
    const lane = laneOffset(r, dir, laneIdx);
    // clamp the spread so a 600m highway doesn't drop the car a single fixed
    // distance from its mid — use up to ±45% of length, capped at ±90m.
    const spread = Math.min(r.len * 0.45, 90);
    const along = (Math.random() - 0.5) * 2 * spread;
    const x = r.vertical ? r.x + lane : r.x + along;
    const z = r.vertical ? r.z + along : r.z + lane;
    c.road = r; c.vertical = r.vertical; c.dirSign = dir; c.lane = lane; c.laneIdx = laneIdx;
    c.pos.x = x; c.pos.z = z;
    c.heading = r.vertical ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    c.v = (c.baseV || 8) * 0.6;
    c.group.position.set(x, 0, z);
    c.group.rotation.y = c.heading;
    c.turning = null;
    return true;
  }
  // does an OUTLYING region already have a car near it? (so we only seed EMPTY
  // outlying segments, never pile cars onto one the player's already near).
  function segHasCar(r, rad2) {
    for (const c of CBZ.cityCars) {
      if (!c.ai || c.dead || c.player || c.owned || !c.road || !here(c)) continue;
      const dx = c.pos.x - r.x, dz = c.pos.z - r.z;
      if (dx * dx + dz * dz < rad2) return true;
    }
    return false;
  }
  // ONGOING low-rate far-seeder: at most ONE car per call, onto a random EMPTY
  // outlying segment that's well away from the camera (so the relocation is
  // never seen). Off during a hot pursuit. Respects the quality governor via the
  // caller's cadence. (traffic-district-distribution)
  let _outScan = 0;
  function seedFarRegions(A) {
    if (!A.roads || !A.roads.length) return false;
    const cam = CBZ.camera.position;
    // find an outlying segment that is (a) empty and (b) far from camera.
    let target = null;
    for (let tries = 0; tries < 6 && !target; tries++) {
      _outScan = (_outScan + 1 + ((Math.random() * 7) | 0)) % A.roads.length;
      const r = A.roads[_outScan];
      if (!isOutlying(r)) continue;
      const dcx = r.x - cam.x, dcz = r.z - cam.z;
      if (dcx * dcx + dcz * dcz < 140 * 140) continue;          // near the camera — recycleOne already covers it
      if (segHasCar(r, 70 * 70)) continue;                       // already has traffic
      target = r;
    }
    if (!target) return false;
    const pick = farIdleCar(120 * 120);                          // a car nobody's watching
    if (!pick) return false;
    return placeOnRoad(pick, target);
  }

  // ONE-TIME arena-bind seed (TRAF-1): when a new arena binds, drop a car or two
  // onto ~1-in-3 of the HIGHWAY segments so every highway starts visibly alive
  // when you arrive. Bounded (≤8 seeds), runs ONCE per bind (never per frame),
  // and only while the quality governor allows far cars.
  function seedHighwaysOnBind(A) {
    if (!A.roads || !A.roads.length) return;
    const q = CBZ.qualityLevel != null ? CBZ.qualityLevel : 2;
    if (q <= 1) return;                                          // weak GPU: skip far seeding
    const cap = q >= 3 ? 8 : 5;
    let seeded = 0;
    for (let i = 0; i < A.roads.length && seeded < cap; i++) {
      const r = A.roads[i];
      if (r.district !== "highway") continue;
      if (CBZ.roadOpen && !CBZ.roadOpen(r)) continue;            // closed to ambient traffic
      if (Math.random() > 0.34) continue;                        // ~1 in 3 highways
      if (segHasCar(r, 60 * 60)) continue;
      const pick = farIdleCar(0);                                // any idle car (none are near a fresh arena)
      if (!pick) break;
      if (placeOnRoad(pick, r)) seeded++;
    }
  }

  /* ---- THE ISLAND'S OWN FLEET -------------------------------------------
     An island town (world/island_town.js) starts with no traffic at all: the
     city's pool is built with the city. So the island in force gets a pool of
     its own size (a handful on a phone, a dozen on a desktop, swelling and
     thinning with the hour like the city's), every car put on a road out of
     sight, one at a time, through the same CBZ.roadPick / CBZ.cityMakeCar the
     city uses, and driven by the same lane keeper. When another island takes
     over, the last island's cars and cruisers leave the world where nobody can
     see them go (an island dropped behind you takes the rest with it:
     CBZ.islandTownDrop). The recycle above then keeps the bubble around you
     full, exactly as it does downtown. */
  const ISLE_SMALL = CBZ.deviceClass === "phone" || CBZ.deviceClass === "tablet";
  let _isleT = 0, _isleSweepT = 0;
  function islandTarget() {
    const q = CBZ.qualityLevel != null ? CBZ.qualityLevel : 2;
    const base = ISLE_SMALL ? 6 : 12;
    return Math.max(2, Math.round(base * (q <= 1 ? 0.6 : 1) * hourDensityMul()));
  }
  function islandPool(A, dt) {
    _isleSweepT -= dt;
    if (_isleSweepT <= 0) {
      _isleSweepT = 0.5;
      // the last island's fleet goes where nobody sees it go
      const cars = CBZ.cityCars, P = CBZ.player;
      for (let i = cars.length - 1; i >= 0; i--) {
        const c = cars[i];
        if (!c || c._world !== g.mode || c._islandCar || c._persist || c.player || (P && P._vehicle === c)) continue;
        // only the street's own: the pool, the force's units, a car on the lane AI
        if (!(c._isleTraffic || c._cruiser || c._patrolCar || c._rbBar || c.ai)) continue;
        if (!CBZ.islandTownForeign || !CBZ.islandTownForeign(c)) continue;
        if (seen(c)) continue;
        if (CBZ.cityScrapCar) CBZ.cityScrapCar(c);
      }
    }
    if (g.state !== "playing" || !CBZ.cityMakeCar || !CBZ.roadPick) return;
    _isleT -= dt;
    if (_isleT > 0) return;
    _isleT = 0.6;
    let n = 0;
    for (const c of CBZ.cityCars) if (c && c._isleTraffic === A.root && !c.dead) n++;
    if (n >= islandTarget()) return;
    const P = CBZ.player;
    const spot = CBZ.roadPick({ near: P && P.pos, minDist: 45, maxDist: 360, camMin: 55, unseen: true, tries: 12, spread: 90 });
    if (!spot) return;
    if (CBZ.sightCanSee && CBZ.sightCanSee(spot.x, 1, spot.z, 3)) return;
    const econ = CBZ.cityEcon;
    const reckless = Math.random() < (TR().recklessFrac != null ? TR().recklessFrac : 0.18) * 0.6;
    const aggr = reckless ? 0.65 + Math.random() * 0.35 : 0.15 + Math.random() * 0.35;
    let c = null;
    try { c = CBZ.cityMakeCar(spot.x, spot.z, spot.heading, spot.vertical, econ && econ.pickCar ? econ.pickCar(Math.random() < 0.08) : null, aggr); } catch (e) { c = null; }
    if (!c) return;
    CBZ.roadPlace(c, spot);
    const lim = (A.roads[0] && A.roads[0].speedLimit) || 25;
    const cruise = lim * 0.447;                                  // the posted limit, in m/s
    c.baseV = cruise * (0.82 + Math.random() * 0.3) * (reckless ? 1.35 : 1);
    c.v = c.baseV * 0.6; c.reckless = reckless; c.ai = true;
    c._isleTraffic = A.root;
  }

  // ---- behaviour + density tick (order 36.5: after lights, before AI 37) --
  let beh = 0;
  CBZ.onUpdate(36.5, function (dt) {
    const A = streetArena(); if (!A) return;
    if (A !== lastArena) {
      lastArena = A; targetNear = computeTarget(A);
      if (!A.noGrid) seedHighwaysOnBind(A);     // TRAF-1: every highway starts visibly alive on arrival
      _farSeedT = 2;             // stagger the first ongoing far-seed a beat after bind
    }
    if (A.noGrid) islandPool(A, dt);

    updateHonks(dt);

    // density upkeep — cheap, ~ twice a second, one recycle per tick max. Skip
    // during a hot pursuit (player driving + wanted) so we never yank a car the
    // chase logic might be using or pop traffic into a tense moment.
    upkeepT -= dt;
    if (upkeepT <= 0) {
      upkeepT = 0.5;
      // recompute every upkeep beat (not just once at bind) so the hour
      // curve inside computeTarget actually tracks the sun as the day
      // advances — cheap (a handful of arithmetic ops at ~2Hz).
      targetNear = computeTarget(A);
      if (!(CBZ.player.driving && (g.wanted | 0) >= 2)) {
        const near = countNear();
        // a dumped car goes back into traffic before a healthy one is moved
        if (near < targetNear && !reclaimOne()) recycleOne(A);
      }
    }

    // ONGOING far-region seeder (traffic-district-distribution): a much SLOWER
    // beat than the near-bubble upkeep — every ~2.5s, ONE car onto an empty
    // outlying tagged road far off-camera, so highways/islands/towns you AREN'T
    // standing in still carry life. Off during a hot pursuit, and only on
    // mid/strong GPUs (the governor) so weak devices never seed far cars.
    _farSeedT -= dt;
    if (_farSeedT <= 0) {
      _farSeedT = 2.5;
      const q = CBZ.qualityLevel != null ? CBZ.qualityLevel : 2;
      if (q > 1 && !(CBZ.player.driving && (g.wanted | 0) >= 2)) seedFarRegions(A);
    }

    // per-car behaviour: time-sliced honking + road-rage temper. We only look at
    // a slice of cars each frame so it scales to a big pool.
    const cars = CBZ.cityCars;
    if (!cars.length) return;
    const SLICE = 22;
    for (let k = 0; k < SLICE; k++) {
      beh = (beh + 1) % cars.length;
      const c = cars[beh];
      if (!c || c.player || c.dead || !c.ai || !c.road || c.owned || !here(c)) continue;
      tagDriver(c);
      if (c.honkCD > 0) c.honkCD -= dt * (cars.length / SLICE);   // compensate slicing
      const arch = ARCH[c.trafArch] || ARCH.normal;

      // give cautious/aggressive drivers a slightly different cruise so traffic
      // isn't a uniform train (vehicles.js owns baseV; we only nudge it once).
      if (!c._cruiseTuned && c.baseV) {
        c._cruiseTuned = true;
        c.baseV *= arch.cruiseMul;
      }

      // don't honk/road-rage while crashing, turning, fleeing, pulled over, or
      // while vehicles.js is already driving a carjacker's rage chase.
      // a driver fleeing gunfire (vehicles.js _panicT) leans on the horn the whole way
      if ((c._panicT || 0) > 0 && c.honkCD <= 0 && Math.random() < 0.55) honkAt(c);
      if (c.wreckT > 0 || c.turning || c.pullover || (c.npcDriver && c.roadRageTarget)) { c.blockedT = 0; continue; }

      const slice = cars.length > SLICE ? cars.length / SLICE : 1;
      const blk = blockedAhead(c);
      const stuck = blk && Math.abs(blk.car.v || 0) < 1.5 && blk.gap < 4.5;   // bumper gap; IDM parks at 2
      const onGreen = CBZ.cityIsRed && !CBZ.cityIsRed(c.road.vertical);
      // a DEAD obstacle (wreck, abandoned car, somebody's parked car) is not a
      // queue — waiting behind it is never lawful, so patience runs even on red.
      // (the car the PLAYER is sitting in is a dawdler, not an obstacle: you
      // might just be waiting at the light, so it builds patience on green only)
      const deadAhead = stuck && (blk.car.abandoned || blk.car.dead || (blk.car.wreckT || 0) > 0 || (!blk.car.ai && !blk.car.player));
      if (stuck) {
        // HONK at whoever's dawdling right in front of us, harder if it's a green.
        if (c.honkCD <= 0 && Math.random() < arch.horny * (onGreen || deadAhead ? 1 : 0.5)) honkAt(c);
        // blocking on a GREEN — or by a dead obstacle — builds real
        // "why won't you MOVE" patience-loss; a queue at a red doesn't.
        // Patience only runs against something that is not itself queueing: a
        // car in a line pulling away on green is the IDM start-up wave, and
        // losing patience with it had every car in the queue swerve lanes.
        const dawdler = !blk.car.ai || blk.car.player || !!blk.car.pullover;
        if ((onGreen && dawdler) || deadAhead) c.blockedT += dt * slice; else c.blockedT = Math.max(0, c.blockedT - dt);
        // blocked past this driver's patience → PULL AROUND, but only if the
        // opposing lane is actually clear (no head-on swerves). Everyone goes
        // eventually — that's how a queue behind a wreck dissolves — but an
        // aggressive/reckless driver does it as ROAD RAGE: floors it, stays
        // hot (reckless), while a calm one just eases around and tucks back.
        // We only touch fields vehicles.js's lane-keeper already honors
        // (lane flips, a brief baseV boost), so the order-37 loop stays in sync.
        if (c.blockedT > arch.ragePatience && (c._rageT || 0) <= 0) {
          let ot = overtakeLane(c);
          // RECKLESS-LAYER OVERTAKE (reckless-layer-overtake): a maniac who is
          // BOXED IN on every same-direction lane plays chicken — he swings
          // ACROSS the centreline into the oncoming inner lane to blast past,
          // but ONLY when that lane is actually clear (no suicidal head-on). It
          // is a SHORT, hot deviation ON TOP of the keep-right baseline; the
          // restore at lines below (driven by _prevLane) yanks him back to the
          // right the instant the rage timer expires. WHY: the owner loves the
          // recklessness — a truly stuck lunatic crossing into traffic to
          // overtake reads as the city's worst driver, not a polite queue.
          // AND ANYONE behind a DEAD obstacle (a wreck, a husk, your dumped car)
          // goes round it the same way once the oncoming lane is clear. Before,
          // a calm driver boxed in behind one on a one-lane-each-way street had
          // no move at all and sat honking behind it until the car was recycled.
          if (!ot && (deadAhead || c.trafArch === "reckless" || (c.driver && c.driver.aggr >= 0.82))) {
            const dir = c.dirSign || 1;
            const onLat = laneOffset(c.road, -dir, 0);     // oncoming INNER lane (across the centreline)
            if (laneFree(c, onLat)) ot = { idx: 0, lat: onLat, oncoming: true };
          }
          if (!ot) {
            c.blockedT = arch.ragePatience * 0.6;          // boxed in — keep honking, retry soon
            if (c.honkCD <= 0) honkAt(c);
          } else {
            const angry = c.trafArch === "aggressive" || c.trafArch === "reckless";
            // an ONCOMING-lane pass is a SHORTER deviation — you don't loiter in
            // the wrong lane; you blast past and dive back right immediately.
            c._rageT = ot.oncoming ? (1.5 + Math.random() * 0.8)
                     : angry ? 3 + Math.random() * 2 : 2.2 + Math.random();
            c._prevLane = c.lane; c._prevLaneIdx = c.laneIdx != null ? c.laneIdx : 0;
            c.lane = ot.lat; c.laneIdx = ot.idx;   // pull into an adjacent lane (same-dir, or oncoming for a reckless chicken-pass) to pass
            c._rageBoost = (c.baseV || 8) * (angry ? 0.6 : 0.3);
            c.baseV = (c.baseV || 8) + c._rageBoost;
            c.blockedT = 0;
            if (angry) {
              c.reckless = true;
              honkAt(c);
              // (no toast — the horn + swerve ARE the road rage)
            }
          }
        }
      } else {
        c.blockedT = Math.max(0, c.blockedT - dt * 2 * slice);
      }
      // wind the overtake back down so the car settles into its normal lane/cruise.
      if ((c._rageT || 0) > 0) {
        c._rageT -= dt * slice;
        if (c._rageT <= 0) {
          if (c._rageBoost) { c.baseV = Math.max(2, (c.baseV || 8) - c._rageBoost); c._rageBoost = 0; }
          // pull back into our own lane after passing
          if (c._prevLane != null) { c.lane = c._prevLane; c.laneIdx = c._prevLaneIdx; c._prevLane = null; }
        }
      }
    }
  });

  /* ============================================================
     EMERGENCY VEHICLES — real fleet bodies (city/emergencykit.js) that drive to incidents.
       AMBULANCE  → a body on the ground. WHO DECIDES which body: under
                    EMS_RESPONSE, city/morgue.js. This file keeps everything
                    that makes an ambulance an ambulance — the road router,
                    the kerb park, the siren, the lightbar, the fact that it
                    is a real registered stealable CBZ.cityCars record — and
                    stops being the dispatcher. It had to: its own scan
                    grabbed ONE body at a time with no clustering, no staging
                    against a live firefight, and no idea whether the player
                    had witnessed the death, and its 3.5 s "work" beat expired
                    long before any crew could load anybody.
       FIRE TRUCK → a burning car (extinguishes it if it reaches it in time;
                    otherwise works the smoking scene afterward). Unchanged —
                    this file remains its only dispatcher.
     Bodies through CBZ.cityMakeCar (merged, LOD, instanced), a hard cap, culling.
  ============================================================ */
  // 2 ambulances, not 1: the morgue clusters deaths, so one unit already
  // serves a whole scene — the second exists so a second incident across town
  // is not queued behind a shootout's clean-up. (Owner's cap: 2-3.)
  const EMG_MAX = { ambulance: 2, firetruck: 1 };
  // Gang City and the islands (CBZ.economyMode): the street systems' worlds
  function emgOn() { return !!g && (CBZ.economyMode ? CBZ.economyMode(g.mode) : g.mode === "city"); }
  function morgueOwnsEms() {
    return !!(CBZ.CONFIG && CBZ.CONFIG.EMS_RESPONSE !== false && CBZ.morgueUnitScene);
  }
  const emg = [];
  let emgScanT = 0;

  /* THE BODIES are city/emergencykit.js's — a Type III ambulance (an E-450
     cutaway cab and a 14 ft module) and a custom-cab pumper — built by the
     same CBZ.cityMakeCar pipeline as every car in the city: merged into its
     material buckets, doors baked, far LOD, instanced when parked, a driver
     in the seat. This file used to stack ~60 scaled unit cubes per truck on a
     5.4 m "van" footprint; that is gone. A unit here is that cityCars record
     with the dispatch state written onto it (one identity, as before). */
  function emgModel(kind) {
    const EK = CBZ.emergencyKit;
    return (EK && EK.models && EK.models[kind]) || null;
  }
  // the unit's light rig (police_lightbar / lb_red / lb_blue / lb_mid), found
  // once the body exists; false = a body with no rig (never searched again)
  function emgBar(e) {
    if (e._emgBar == null && !e._deferred && CBZ.emergencyKit) e._emgBar = CBZ.emergencyKit.barOf(e.group) || false;
    return e._emgBar || null;
  }

  // Is (x,z) off the downtown grid (outside its box by more than a road)?
  // The grid router below only knows the downtown's avenue lines.
  function offDowntown(A, x, z) {
    const m = A.ROAD || 18;
    return A.minX != null && (x < A.minX - m || x > A.maxX + m || z < A.minZ - m || z > A.maxZ + m);
  }
  // OUT IN THE WORLD (a metro street, a town, a mini-city): the unit comes up
  // the real road nearest the scene, starting ~150 m back along it, instead of
  // from the end of a random road that could be kilometres away (and then
  // being steered by the downtown's grid lines and clamped to its edge).
  // Returns {road, dir, sx, sz, along} or null.
  const _emgNear = [];
  function roadApproach(A, tx, tz) {
    if (!CBZ.roadsNear) return null;
    const list = CBZ.roadsNear(tx, tz, 140, _emgNear);
    let best = null, bd = 1e9;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r || r.elevated || !Number.isFinite(r.len) || r.len < 60) continue;
      if (CBZ.roadOpen && !CBZ.roadOpen(r)) continue;
      const along = r.vertical ? tz - r.z : tx - r.x, perp = Math.abs(r.vertical ? tx - r.x : tz - r.z);
      if (Math.abs(along) > r.len / 2 - 6) continue;
      if (perp < bd) { bd = perp; best = r; }
    }
    if (!best || bd > 140) return null;
    const r = best, ta = r.vertical ? tz - r.z : tx - r.x, lim = r.len / 2 - 4;
    // start 150 m back on whichever side has the road for it (the longer side)
    let sa = Math.max(-lim, Math.min(lim, ta + (ta > 0 ? -150 : 150)));
    // never materialise in plain view of the player: take the other side
    const cam = CBZ.camera && CBZ.camera.position;
    if (cam && CBZ.roadInView) {
      const px = r.vertical ? r.x : r.x + sa, pz = r.vertical ? r.z + sa : r.z;
      if (Math.hypot(px - cam.x, pz - cam.z) < 140 && CBZ.roadInView(px, pz)) sa = Math.max(-lim, Math.min(lim, ta + (ta > 0 ? 150 : -150)));
    }
    const dir = ta >= sa ? 1 : -1;
    const lane = laneOffset(r, dir, 0);
    return { road: r, dir: dir, along: ta,
             sx: r.vertical ? r.x + lane : r.x + sa, sz: r.vertical ? r.z + sa : r.z + lane };
  }

  /* THE ISLANDS (world/island_town.js: no grid, a town of straight runs).
     A unit rolls out of its own station (world/island_emergency.js: the
     fire station's engine bay, the hospital's ambulance bay), on the road
     in front of its door, and drives the island's streets to the scene:
     a route of road records, turning at each junction (steerEmergency).
     No station on the island, or one in plain view of you: it comes up the
     road nearest the scene from out of sight, as out in the world. */
  function nearestRoad(A, x, z, pad) {
    let best = null, bd = 1e9;
    for (const r of A.roads || []) {
      const along = r.vertical ? z - r.z : x - r.x, perp = Math.abs(r.vertical ? x - r.x : z - r.z);
      if (Math.abs(along) > r.len / 2 - (pad || 0)) continue;
      if (perp < bd) { bd = perp; best = r; }
    }
    return best && bd < 40 ? best : null;
  }
  function crosses(a, b) {
    if (a.vertical === b.vertical) return false;
    const v = a.vertical ? a : b, h = a.vertical ? b : a;
    return Math.abs(v.x - h.x) <= h.len / 2 + 1 && Math.abs(h.z - v.z) <= v.len / 2 + 1;
  }
  function roadRoute(A, from, to) {
    if (from === to) return [from];
    const R = A.roads || [], prev = new Map([[from, null]]), q = [from];
    while (q.length) {
      const r = q.shift();
      if (r === to) break;
      for (const o of R) if (!prev.has(o) && crosses(r, o)) { prev.set(o, r); q.push(o); }
    }
    if (!prev.has(to)) return null;
    const out = [];
    for (let r = to; r; r = prev.get(r)) out.unshift(r);
    return out;
  }
  function alongOf(r, x, z) { return r.vertical ? z - r.z : x - r.x; }
  // the along coordinate this leg of a route runs to: the next junction, or
  // (the last leg) the point abreast of the scene
  function legGoal(e, tx, tz) {
    const rr = e.road, R = e.route;
    if (R && e.routeI < R.length - 1) { const n = R[e.routeI + 1]; return alongOf(rr, n.vertical ? n.x : rr.x, n.vertical ? rr.z : n.z); }
    return alongOf(rr, tx, tz);
  }
  function stationStart(A, kind, tx, tz) {
    const EM = CBZ.islandEmergency;
    const st = EM && EM.station ? EM.station(kind === "firetruck" ? "fire" : "ambulance") : null;
    if (!st) return null;
    const r0 = nearestRoad(A, st.x, st.z, 6), r1 = nearestRoad(A, tx, tz, 3);
    if (!r0 || !r1) return null;
    const route = roadRoute(A, r0, r1);
    if (!route) return null;
    const lim = r0.len / 2 - 4;
    const sa = Math.max(-lim, Math.min(lim, alongOf(r0, st.x, st.z)));
    const probe = { road: r0, route: route, routeI: 0 };
    const ga = legGoal(probe, tx, tz);
    const dir = ga >= sa ? 1 : -1, lane = laneOffset(r0, dir, 0);
    const sx = r0.vertical ? r0.x + lane : r0.x + sa, sz = r0.vertical ? r0.z + sa : r0.z + lane;
    // a truck does not appear out of nothing in front of you
    const cam = CBZ.camera && CBZ.camera.position;
    if (cam && CBZ.roadInView && Math.hypot(sx - cam.x, sz - cam.z) < 140 && CBZ.roadInView(sx, sz)) return null;
    return { road: r0, dir: dir, sx: sx, sz: sz, route: route };
  }

  function spawnEmergency(kind, tx, tz) {
    const A = streetArena(); if (!A || !CBZ.cityMakeCar) return null;
    const model = emgModel(kind); if (!model) return null;
    const isle = !!A.noGrid;
    const ap = isle ? (stationStart(A, kind, tx, tz) || roadApproach(A, tx, tz)) : offDowntown(A, tx, tz) ? roadApproach(A, tx, tz) : null;
    if (isle && !ap) return null;                 // no road reaches it: nobody drives through the houses
    // downtown: enter from the city edge along a road far from the incident
    const r = ap ? ap.road : A.roads[(Math.random() * A.roads.length) | 0];
    const dir = ap ? ap.dir : (Math.random() < 0.5 ? 1 : -1);
    const lane = laneOffset(r, dir, 0);   // emergency runs the inner lane
    let sx, sz;
    if (ap) { sx = ap.sx; sz = ap.sz; }
    else if (r.vertical) { sx = r.x + lane; sz = r.z - dir * (r.len / 2 - 4); }
    else { sx = r.x - dir * (r.len / 2 - 4); sz = r.z + lane; }
    const heading = r.vertical ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    let e = null;
    try { e = CBZ.cityMakeCar(sx, sz, heading, !!r.vertical, model, 0.2); } catch (er) { e = null; }
    if (!e) return null;
    // the dispatch state, on the car record itself
    e.kind = kind; e.grp = e.group;
    e.tx = tx; e.tz = tz; e.heading = heading; e.v = 0;
    e.state = "drive"; e.t = 0; e.beaconT = Math.random() * 2; e.siren = 0; e.target = null;
    e.cx = null; e.cz = null; e.stuckT = 0;
    // road-bound unit (an off-grid scene): it drives THIS record, in lane
    e.road = ap ? ap.road : null; e.roadDir = ap ? ap.dir : 0;
    e.route = ap && ap.route ? ap.route : null; e.routeI = 0;
    // the bespoke dispatch AI below keeps the wheel while it is on duty
    // (ai false: vehicles.js's lane AI never fights it), and a traffic reset
    // never reaps a unit mid-call (despawnEmergency owns its teardown)
    e.ai = false; e._persist = true; e._emergency = kind;
    e._emgBar = null;
    emg.push(e);
    return e;
  }

  function despawnEmergency(e) {
    if (e._proxy && CBZ.cityWakeCar) CBZ.cityWakeCar(e);
    const grp = e.group || e.grp;
    if (grp && grp.parent) grp.parent.remove(grp);
    // dispose what is this car's own (the body's geometries and fleet
    // materials are _shared templates; a respray's paint clone is not)
    if (grp) grp.traverse(function (o) {
      if (o.isSprite) return;
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach(function (x) { if (x && !x._shared && x.dispose) x.dispose(); });
      else if (m && !m._shared && m.dispose) m.dispose();
    });
    // drop the cityCars registration with the truck, or a ghost record keeps
    // colliding/getting offered as enterable
    if (CBZ.cityCars) { const ci = CBZ.cityCars.indexOf(e); if (ci >= 0) CBZ.cityCars.splice(ci, 1); }
  }
  // stolen units: no longer dispatch-driven (vehicles.js owns them as ordinary
  // cars), but their beacons keep flashing — a lit-up stolen ambulance IS the joke.
  const stolenEmg = [];
  CBZ.cityEmergencyReset = function () {
    for (let i = emg.length - 1; i >= 0; i--) despawnEmergency(emg[i]);
    emg.length = 0;
    // stolen units: despawn any the player ISN'T currently driving (they're
    // cityCars records — but persist:true means clearCars won't reap them, so
    // this reset owns their teardown). A player-driven one stays with the
    // player; vehicles.js owns that lifecycle from here.
    for (let i = stolenEmg.length - 1; i >= 0; i--) { const e = stolenEmg[i]; if (!e.player) despawnEmergency(e); }
    stolenEmg.length = 0;
    for (let i = liveHonks.length - 1; i >= 0; i--) { const s = liveHonks[i].s; if (s && s.parent) s.parent.remove(s); }
    liveHonks.length = 0;
  };

  function countKind(kind) { let n = 0; for (const e of emg) if (e.kind === kind) n++; return n; }

  // THE UNITS ON DUTY, read-only. medics.js needs to know a van is parked and
  // working before it can step a crew out of one, and city/morgue.js needs to
  // hold a scene against the unit it dispatched. Handing back the live array
  // (never a copy) keeps the record identity — the ambulance IS a cityCars
  // record — so a consumer can compare against e.player/e.dead/e.state exactly
  // as this file does. Nobody outside owns the lifecycle; despawnEmergency
  // still does.
  CBZ.cityEmergencyUnits = function () { return emg; };

  function incidentTarget(kind, x, z, opts) {
    opts = opts || {};
    return {
      pos: { x: x, y: opts.y || 0, z: z },
      dead: kind === "ambulance",
      collected: false, culled: false,
      _onFire: kind === "firetruck", _smoking: kind === "firetruck",
      _exploded: false, _majorIncident: true, _emgClaimed: true,
    };
  }

  // Public 911-style dispatch for systems whose incident is not represented by
  // an ordinary burning-car/dead-ped record (notably an aircraft into a tower).
  // Re-task the existing unit when the hard cap is occupied; a major impact
  // must not be ignored because one engine was finishing a minor car fire.
  CBZ.cityDispatchEmergencyAt = function (kind, x, z, opts) {
    if (kind !== "firetruck" && kind !== "ambulance") return null;
    if (!emgOn() || !streetArena()) return null;
    // RE-TASK ONLY WHAT IS ACTUALLY FREE. This loop used to grab the first unit
    // of the right kind, full stop — which was harmless while the cap was ONE
    // and this was the only dispatcher, and is not now: a second call would
    // walk an ambulance off a scene where a crew was mid-carry, leaving two
    // paramedics standing over a body next to nothing. A unit committed to a
    // city/morgue.js scene is skipped in favour of spawning a fresh one, and is
    // only ever stolen as the LAST resort (below), so the old "a major impact
    // must not be ignored because one truck was busy" contract still holds.
    let e = null, busy = null;
    for (let i = 0; i < emg.length; i++) {
      const u = emg[i];
      if (!u || u.kind !== kind || u.player || u.dead) continue;
      if (u._morgueScene) { if (!busy) busy = u; continue; }
      e = u; break;
    }
    const target = incidentTarget(kind, x, z, opts);
    if (!e && countKind(kind) < (EMG_MAX[kind] || 1)) e = spawnEmergency(kind, x, z);
    if (!e && busy) {                       // at the cap and every unit is on a scene
      if (CBZ.morgueReleaseUnit) CBZ.morgueReleaseUnit(busy);
      busy._morgueScene = null;
      e = busy;
    }
    if (!e) return null;
    if (e.target) e.target._emgClaimed = false;
    e.target = target; e.tx = x; e.tz = z; e.state = "drive"; e.t = 0; e.stuckT = 0;
    return e;
  };

  CBZ.cityReportMajorIncident = function (x, y, z, opts) {
    opts = opts || {};
    const fire = CBZ.cityDispatchEmergencyAt("firetruck", x, z, { y: y });
    const ambulance = CBZ.cityDispatchEmergencyAt("ambulance", x, z, { y: y });
    CBZ.cityLastMajorIncident = {
      kind: opts.kind || "aircraft-impact", x: x, y: y, z: z,
      severity: opts.severity || 1, fireDispatched: !!fire, ambulanceDispatched: !!ambulance,
      at: g.elapsed || 0,
    };
    if (CBZ.cityEvent) {
      try {
        CBZ.cityEvent("disaster", {
          label: "Major aircraft impact", panic: 12 + 8 * (opts.severity || 1),
          damage: 8 + 8 * (opts.severity || 1), fire: 1, emergency: 18,
          confidence: -4,
        }, { throttle: 4 });
      } catch (e) {}
    }
    return CBZ.cityLastMajorIncident;
  };

  // find a fresh body that has nobody responding yet
  function findBodyIncident() {
    const peds = CBZ.cityPeds; if (!peds) return null;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!(p.dead && !p.collected && !p.culled)) continue;
      if (p._emgClaimed) continue;
      // only roll for ones that have been down a moment (not mid-combat chaos)
      if ((p.deadT || 0) < 2) continue;
      return p;
    }
    return null;
  }
  // find a burning / freshly-wrecked car nobody's responding to
  function findFireIncident() {
    const cars = CBZ.cityCars; if (!cars) return null;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.player) continue;
      if (c._emgClaimed || !here(c)) continue;
      if (c._onFire || (c._smoking && (c.engineHp != null && c.engineHp < 30))) return c;
    }
    return null;
  }

  function dispatchScan() {
    // gate by wanted level a touch: in a hot pursuit the streets are chaos and
    // a slow truck just gets in the way — but still respond to fires.
    if (countKind("firetruck") < EMG_MAX.firetruck) {
      const f = findFireIncident();
      if (f) {
        const e = spawnEmergency("firetruck", f.pos.x, f.pos.z);
        if (e) { e.target = f; f._emgClaimed = true; }   // (no toast — the siren announces it)
      }
    }
    // AMBULANCES: the morgue is the dispatcher when it is live (it clusters,
    // it prioritises what you actually witnessed, and it STAGES against a hot
    // scene). Two dispatchers fighting over one body is how you get a truck
    // that turns around at the kerb, so this scan stands down entirely rather
    // than being merged. Degrade-safe: no morgue.js → the original scan runs.
    if (!morgueOwnsEms() && countKind("ambulance") < EMG_MAX.ambulance) {
      const b = findBodyIncident();
      if (b) {
        const e = spawnEmergency("ambulance", b.pos.x, b.pos.z);
        if (e) { e.target = b; b._emgClaimed = true; }   // (no toast — the siren announces it)
      }
    }
  }

  // nearest road grid line to a coordinate (arena.xLines/zLines are the
  // centre-lines of every avenue / cross-street)
  function nearestLine(lines, v) {
    let best = lines[0];
    for (let i = 1; i < lines.length; i++) if (Math.abs(lines[i] - v) < Math.abs(best - v)) best = lines[i];
    return best;
  }

  // ---- ROAD ROUTER + WALL CONTRACT (root-cause fix, user-filmed) -----------
  // steerEmergency used to beeline at the incident along arbitrary dominant-axis
  // legs with NO collider resolution at all — ambulances/fire trucks drove
  // straight through buildings to mid-block scenes. Now:
  //   • the goal is snapped to the CURB — the nearest point ON the road grid to
  //     the scene (real ambulances park outside),
  //   • the route follows actual road lines (cross-street → avenue → curb)
  //     instead of cutting the block diagonal,
  //   • the hull resolves against CBZ.colliders through the SAME oriented path
  //     every driven car uses (vehicles.js cityCollideVehicle: body circle +
  //     front probe), so a wall is a wall even when the steering is wrong,
  //   • a truck that still gets pinned (wreck in the lane, blocked street)
  //     accrues e.stuckT — the drive state parks it at the curb instead of
  //     letting it grind through geometry.
  function steerEmergency(e, dt, A) {
    const tx = e.tx, tz = e.tz;
    const dx = tx - e.pos.x, dz = tz - e.pos.z;
    const dist = Math.hypot(dx, dz);
    // CURB GOAL: nearest point on the road grid to the scene
    let cx = tx, cz = tz, curbVert = false;
    const onGrid = !e.road && !!(A.xLines && A.xLines.length && A.zLines && A.zLines.length);
    if (onGrid) {
      const xl = nearestLine(A.xLines, tx), zl = nearestLine(A.zLines, tz);
      if (Math.abs(tx - xl) <= Math.abs(tz - zl)) { cx = xl; cz = tz; curbVert = true; }
      else { cx = tx; cz = zl; curbVert = false; }
    }
    e.cx = cx; e.cz = cz;
    // this frame's aim point: a 3-leg Manhattan route along real roads
    let aimX, aimZ;
    if (e.road) {
      // A ROUTE (the islands): at the junction with the next road of it, turn
      // onto that road, heading for the junction after (or the scene)
      if (e.route && e.routeI < e.route.length - 1) {
        const ja = legGoal(e, tx, tz), pa0 = alongOf(e.road, e.pos.x, e.pos.z);
        if (Math.abs(ja - pa0) < 3.5) {
          e.routeI++; e.road = e.route[e.routeI];
          const ga = legGoal(e, tx, tz), pa1 = alongOf(e.road, e.pos.x, e.pos.z);
          e.roadDir = ga >= pa1 ? 1 : -1;
        }
      }
      const via = !!(e.route && e.routeI < e.route.length - 1);
      // ROAD-BOUND: keep the lane of its own record and run to the point on it
      // abreast of the target (the kerb there); past the record's end, stop.
      const rr = e.road, lane = laneOffset(rr, e.roadDir, 0), lim = rr.len / 2 - 3;
      const ta = via ? legGoal(e, tx, tz) : Math.max(-lim, Math.min(lim, rr.vertical ? tz - rr.z : tx - rr.x));
      cx = rr.vertical ? rr.x + lane : rr.x + ta; cz = rr.vertical ? rr.z + ta : rr.z + lane;
      // (a junction on the way is not the kerb it parks at)
      e.cx = via ? null : cx; e.cz = via ? null : cz;
      e._legX = cx; e._legZ = cz;
      // aim a few metres ahead along the lane (steady heading), or at the kerb once close
      const pa = rr.vertical ? e.pos.z - rr.z : e.pos.x - rr.x;
      const ahead = Math.max(-lim, Math.min(lim, pa + e.roadDir * 12));
      const useCurb = (ta - pa) * e.roadDir < 12;
      aimX = useCurb ? cx : (rr.vertical ? rr.x + lane : rr.x + ahead);
      aimZ = useCurb ? cz : (rr.vertical ? rr.z + ahead : rr.z + lane);
    } else if (!onGrid) {
      // no grid (shouldn't happen in city) — old dominant-axis fallback
      if (Math.abs(dx) > Math.abs(dz) + 2) { aimX = tx; aimZ = e.pos.z; }
      else if (Math.abs(dz) > Math.abs(dx) + 2) { aimX = e.pos.x; aimZ = tz; }
      else { aimX = tx; aimZ = tz; }
    } else if (curbVert) {
      // curb sits on the avenue x=cx → run a cross-street over, then the avenue
      if (Math.abs(e.pos.x - cx) > 2.5) {
        const zr = nearestLine(A.zLines, e.pos.z);
        if (Math.abs(e.pos.z - zr) > 2.5) { aimX = e.pos.x; aimZ = zr; }   // get onto a cross-street
        else { aimX = cx; aimZ = zr; }                                     // run it to the avenue
      } else { aimX = cx; aimZ = cz; }                                     // run the avenue to the curb
    } else {
      // curb sits on the cross-street z=cz → run an avenue over, then the street
      if (Math.abs(e.pos.z - cz) > 2.5) {
        const xr = nearestLine(A.xLines, e.pos.x);
        if (Math.abs(e.pos.x - xr) > 2.5) { aimX = xr; aimZ = e.pos.z; }   // get onto an avenue
        else { aimX = xr; aimZ = cz; }                                     // run it to the street
      } else { aimX = cx; aimZ = cz; }                                     // run the street to the curb
    }
    const adx = aimX - e.pos.x, adz = aimZ - e.pos.z;
    const want = Math.atan2(adx, adz);
    e.heading = CBZ.lerpAngle ? CBZ.lerpAngle(e.heading, want, 1 - Math.pow(0.0009, dt)) : want;
    // emergency vehicles roll fast — they have right of way (ignore the lights)
    let topV = Math.max(11, (TR().cruise ? TR().cruise[1] : 12) * 1.3);
    // a road-bound unit rolls up to its kerb point instead of overshooting it
    if (e.road && e.state === "drive") topV = Math.min(topV, (e.cx == null ? 6 : 2) + Math.hypot(e._legX - e.pos.x, e._legZ - e.pos.z) * 0.6);
    // ...but a real unit BRAKES for whoever's in its path instead of plowing
    // through the scene it came to help ("just drive through shit"): scan the
    // lane ahead for peds and cars and ease off. Cheap: ≤2 trucks alive, ever.
    const bfx = Math.sin(e.heading), bfz = Math.cos(e.heading);
    function brakeFor(px, pz, latTol) {
      const bdx = px - e.pos.x, bdz = pz - e.pos.z;
      const ah = bdx * bfx + bdz * bfz;
      if (ah > 0.5 && ah < 15 && Math.abs(bdx * -bfz + bdz * bfx) < latTol) {
        topV = Math.min(topV, Math.max(0, (ah - 3.2) * 1.1));
      }
    }
    // (skipped on final approach — inside ~12u it's crawling in to park at the
    //  scene, and a bystander at the curb must not stall the arrival check)
    if (dist > 12) {
      if (CBZ.cityPeds) for (let i = 0; i < CBZ.cityPeds.length; i++) {
        const p = CBZ.cityPeds[i];
        if (p.dead || p.inCar) continue;
        brakeFor(p.pos.x, p.pos.z, 2.2);
      }
      if (CBZ.cityCars) for (let i = 0; i < CBZ.cityCars.length; i++) {
        const c = CBZ.cityCars[i];
        if (c === e || c.dead) continue;
        brakeFor(c.pos.x, c.pos.z, 2.6);
      }
    }
    e.v += Math.max(-26 * dt, Math.min(14 * dt, topV - e.v));
    const px = e.pos.x, pz = e.pos.z;
    e.pos.x += Math.sin(e.heading) * e.v * dt;
    e.pos.z += Math.cos(e.heading) * e.v * dt;
    // WALLS ARE WALLS: the same oriented resolution every driven car gets
    if (CBZ.cityCollideVehicle) CBZ.cityCollideVehicle(e);
    else if (CBZ.collide) CBZ.collide(e.pos, 1.3);
    if (A.clampToCity && !e.road) A.clampToCity(e.pos, 1.6);   // a road-bound unit is out past the downtown
    // pinned against geometry? (commanded a real step, the body barely moved)
    const stepped = Math.hypot(e.pos.x - px, e.pos.z - pz);
    if (e.v > 2 && stepped < e.v * dt * 0.35) { e.stuckT = (e.stuckT || 0) + dt; e.v *= Math.pow(0.05, dt); }
    else e.stuckT = Math.max(0, (e.stuckT || 0) - dt * 2);
    // out in the world the ground is not the downtown's y = 0 plane
    const gy = e.road && CBZ.cityCarGroundY ? (+CBZ.cityCarGroundY(e.pos.x, e.pos.z, null, e) || 0) : 0;
    e.grp.position.set(e.pos.x, gy, e.pos.z);
    e.grp.rotation.y = e.heading;
    return dist;
  }

  // ---- EMERGENCY VEHICLES ARE SOLID -----------------------------------------
  // They live in their own list (not cityCars), so the normal car↔player pass
  // never saw them: ambulances and fire trucks phased straight through you on
  // foot AND through your car (user-filmed). Same treatment as every other
  // vehicle now: an oriented-box push-out, a real run-down when they're moving,
  // and a shove + bleed-off when they meet your car.
  let emgRunCD = 0;
  function emgCollide(e, dt) {
    emgRunCD -= dt;
    const P = CBZ.player;
    if (!P || P.dead) return;
    const speed = Math.abs(e.v || 0);
    if (!P.driving) {
      emgFootPush(e, speed);
      return;
    }
    // every unit is a real cityCars record: vehicles.js resolveCars owns
    // truck-vs-car separation and crashes (a hand-rolled push here would
    // double-shove the player's car every frame)
  }
  function emgFootPush(e, speed) {
    const P = CBZ.player;
    {
      const dm = e.dims || {};
      const hw = (dm.width || 2.2) / 2 + (P.radius || 0.45), hl = (dm.length || 5.4) / 2 + (P.radius || 0.45);
      const s = Math.sin(e.heading), c = Math.cos(e.heading);
      const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) >= hw || Math.abs(lz) >= hl) return;
      const px = hw - Math.abs(lx), pz = hl - Math.abs(lz);
      // out of the truck's box through the one mover (systems/bodymove.js):
      // never shoved through the wall behind you
      let mx, mz;
      if (px < pz) { const d = lx >= 0 ? px : -px; mx = d * c; mz = -d * s; }
      else { const d = lz >= 0 ? pz : -pz; mx = d * s; mz = d * c; }
      if (CBZ.bodyMove) CBZ.bodyMove(P, mx, 0, mz, FOOT_PUSH_O);
      else { P.pos.x += mx; P.pos.z += mz; }
      if (speed > 6 && emgRunCD <= 0) {
        emgRunCD = 0.9;
        // "firetruck" stays ONE word on purpose: killfeed.js buckets a death by
        // matching the cause string, and its earlier /\bfire\b/ test would
        // mis-file "fire truck" (two words) as an EXPLOSION; "firetruck" dodges
        // that boundary and its `truck` rule files it as a vehicle death.
        if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(Math.min(140, 8 + speed * 4.5), e.pos.x, e.pos.z, "run down by " + (e.kind === "firetruck" ? "a firetruck" : "an ambulance"), false, null, speed < 14);
        if (CBZ.body && CBZ.body.knockdown && CBZ.city && CBZ.city.playerActor && !CBZ.body.busy(CBZ.city.playerActor)) {
          CBZ.body.knockdown(CBZ.city.playerActor, { fromX: e.pos.x, fromZ: e.pos.z, force: Math.min(10, speed * 0.5), t: 1.1 });
        }
      }
      return;
    }
  }

  // the same named-layer flasher every police unit uses (emergencykit.js)
  function flashBeacon(e, dt) {
    e.beaconT = (e.beaconT || 0) + dt;
    const bar = emgBar(e);
    if (bar && CBZ.emergencyKit) CBZ.emergencyKit.flash(bar, e.beaconT);
  }

  function emergencyArrive(e) {
    if (e.kind === "firetruck") {
      const c = e.target;
      if (c && !c.dead && !c._exploded) {
        // douse it: restore engine HP above the fire threshold + clear fire state
        if (c.engineHp != null) c.engineHp = Math.max(c.engineHp, 35);
        c._onFire = false; c._smoking = false; c._fuse = 0;
        if (CBZ.cityShatter) {}  // (no glass needed)
        // (no toast either way — the smoke clearing / the cold wreck tells it)
      }
    } else {
      // AMBULANCE ARRIVED. The truck is at the kerb; from here it is a crew
      // problem, and medics.js owns the crew. Two pools, because the owner's
      // ask names both: "even those cops" — cop corpses live in CBZ.cityCops
      // and were never flagged here at all, which is a second reason an
      // officer's body could only ever be cleared by the 8 s delete.
      const RT2 = 14 * 14, RS2 = 12 * 12;
      const pools = [CBZ.cityPeds, CBZ.cityCops];
      for (let q = 0; q < pools.length; q++) {
        const arr = pools[q]; if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const p = arr[i];
          if (!(p.dead && !p.collected && !p.culled)) continue;
          // near the TRUCK — or near the SCENE it parked at the kerb for (the
          // kerb stop can leave the body a block-interior walk away; the
          // on-foot crew covers that last leg, not the truck)
          const dT = (p.pos.x - e.pos.x) * (p.pos.x - e.pos.x) + (p.pos.z - e.pos.z) * (p.pos.z - e.pos.z);
          const dS = (p.pos.x - e.tx) * (p.pos.x - e.tx) + (p.pos.z - e.tz) * (p.pos.z - e.tz);
          if (dT < RT2 || dS < RS2) {
            p.needsPickup = true;
            // register any body the morgue has not logged yet (one that died
            // before its first tick, or through a path nothing sweeps) so the
            // crew that is already standing here collects it on this stop
            // rather than it costing a second dispatch later.
            if (CBZ.morgueReportDeath) CBZ.morgueReportDeath(p);
          }
        }
      }
      // (no toast — the crew stepping out of the van IS the scene)
    }
  }

  let emgLastElapsed = 0, emgArena = null;
  CBZ.onUpdate(36.7, function (dt) {
    if (!emgOn()) { if (emg.length || liveHonks.length) CBZ.cityEmergencyReset(); return; }
    const A = streetArena(); if (!A) return;
    // a new island in force (or back to Gang City): the units of the last go
    if (emgArena && emgArena !== A && emg.length) CBZ.cityEmergencyReset();
    emgArena = A;
    // new life / replay wipes the arena root out from under us → drop our refs
    if (g.elapsed + 0.001 < emgLastElapsed) CBZ.cityEmergencyReset();
    emgLastElapsed = g.elapsed;

    // dispatch scan (cheap, ~ every 1.5s)
    emgScanT -= dt;
    if (emgScanT <= 0) { emgScanT = 1.5; dispatchScan(); }

    // stolen trucks: dispatch AI is off them — just keep the lightbar alive.
    for (let i = stolenEmg.length - 1; i >= 0; i--) {
      const e = stolenEmg[i];
      if (!e.grp || !e.grp.parent || e.dead || e._reap) { stolenEmg.splice(i, 1); continue; }   // chopped / exploded / cleared
      flashBeacon(e, dt);
    }
    for (let i = emg.length - 1; i >= 0; i--) {
      const e = emg[i];
      // DESTROYED while on duty (splash damage at a car fire → explodeCar sets
      // dead/_reap and the order-38 reaper pulls it from cityCars): stop
      // driving the corpse — release the scene and drop the record.
      if (e.dead || e._reap) {
        if (e.target) { e.target._emgClaimed = false; e.target = null; }
        emg.splice(i, 1);
        continue;
      }
      // STOLEN (player grabbed it, or it got jacked flagged): hand the wheel to
      // vehicles.js for good — release the scene claim so another unit can
      // respond, and stop steering/parking/despawning it from here.
      if (e.player || e.stolen) {
        if (e.target) { e.target._emgClaimed = false; e.target = null; }
        e.road = null;   // the dispatch lane is ours, not the lane keeper's: vehicles.js owns it now
        stolenEmg.push(e);
        emg.splice(i, 1);
        continue;
      }
      flashBeacon(e, dt);
      // wail the siren on a long cooldown while en route (one-shot in the bank)
      e.siren -= dt;
      if (e.state === "drive" && e.siren <= 0) {
        e.siren = 2.6;
        if (CBZ.sfxAt) CBZ.sfxAt("siren", e.pos.x, e.pos.z);
      }

      if (e.state === "drive") {
        // re-aim at a moving / still-valid target
        if (e.target) {
          if (e.kind === "firetruck" && (e.target.dead || e.target._exploded || (!e.target._onFire && !e.target._smoking))) {
            // fire's already out / car blew — bail
            e.state = "leave"; e.t = 0;
          } else if (e.kind === "ambulance" && (e.target.collected || e.target.culled || !e.target.dead) &&
                     !(CBZ.morgueUnitBusy && CBZ.morgueUnitBusy(e))) {
            // ONE body being collected is not the scene being over. The morgue
            // re-points e.target at the next body every half-second; without
            // this guard a truck en route to a five-body scene turned around
            // the instant the FIRST of them was cleared by something else.
            e.state = "leave"; e.t = 0;
          } else {
            e.tx = e.target.pos.x; e.tz = e.target.pos.z;
          }
        }
        if (e.state === "drive") {
          const d = steerEmergency(e, dt, A);
          e.t += dt;
          // ARRIVE at the scene itself — or PARK at the curb nearest it (a
          // mid-block body can't be reached by road; real ambulances park outside)
          const atCurb = e.cx != null && Math.hypot(e.pos.x - e.cx, e.pos.z - e.cz) < 3.5;
          const enRoute = !!(e.route && e.routeI < e.route.length - 1);
          // (a road-bound unit's kerb can be further from a mid-superblock
          // scene: the metro's local streets are not road records, so the
          // arterial kerb IS the nearest a truck gets — the crew walks it)
          if ((d < 6 && !enRoute) || (atCurb && (d < 60 || e.road))) { emergencyArrive(e); e.state = "work"; e.t = 0; e.stuckT = 0; }
          else if (e.stuckT > 2.5) {
            // wedged (wreck/queue in the lane): a real unit stops where it is and
            // works the scene from there — never grinds through geometry.
            if (d < 45) emergencyArrive(e);
            e.state = d < 45 ? "work" : "leave"; e.t = 0; e.stuckT = 0;
          }
          else if (e.t > (e.route ? 75 : 28)) { e.state = "leave"; e.t = 0; }   // gave up / blocked (a station run is a longer drive)
        }
      } else if (e.state === "work") {
        e.t += dt; e.v *= Math.pow(0.1, dt);
        // AN AMBULANCE WAITS FOR ITS CREW. 3.5 s is a fire truck's beat (hose
        // the car, go); a body has to be walked to, worked and carried back,
        // and if the scene is still hot the crew is STAGING and has not got out
        // of the van at all. morgueUnitBusy answers both — bodies left, or a
        // scene not yet declared safe — and is capped its own end (UNIT_TTL) so
        // a truck can never park forever. Degrade-safe: no morgue → old 3.5 s.
        const held = CBZ.morgueUnitBusy ? CBZ.morgueUnitBusy(e) : false;
        if (!held && e.t > 3.5) { e.state = "leave"; e.t = 0; if (e.target) e.target._emgClaimed = false; }
      } else { // leave: roll off ALONG A ROAD toward the nearest edge, then despawn
        e.t += dt;
        e.route = null;
        if (e.road) {
          // road-bound: carry on down its own record, then vanish once out of
          // sight (never pop out in front of the player)
          const rr = e.road;
          e.tx = rr.vertical ? rr.x : rr.x + e.roadDir * rr.len / 2;
          e.tz = rr.vertical ? rr.z + e.roadDir * rr.len / 2 : rr.z;
          steerEmergency(e, dt, A);
          const cam = CBZ.camera.position;
          // gone only where the camera cannot see it (core/sight.js), not at 175 m
          const far = Math.hypot(e.pos.x - cam.x, e.pos.z - cam.z) > 175 && !(CBZ.sightCanSee && CBZ.sightCanSee(e.pos.x, (e.pos.y || 0) + 1.5, e.pos.z, 5));
          const pa = rr.vertical ? e.pos.z - rr.z : e.pos.x - rr.x;
          const atEnd = pa * e.roadDir > rr.len / 2 - 8;
          if (far || ((atEnd || e.stuckT > 3 || e.t > 20) && !(CBZ.roadInView && CBZ.roadInView(e.pos.x, e.pos.z)))) {
            if (e.target) e.target._emgClaimed = false; despawnEmergency(e); emg.splice(i, 1); continue;
          }
          emgCollide(e, dt);
          continue;
        }
        // exit along the dominant axis, but down a real road line (the router
        // snaps the lateral coordinate to the nearest avenue/cross-street, so
        // the exit run never cuts a block diagonal through buildings)
        if (Math.abs(e.pos.x - A.center.x) > Math.abs(e.pos.z - A.center.z)) {
          e.tx = (e.pos.x > A.center.x ? A.maxX + 20 : A.minX - 20);
          e.tz = (A.zLines && A.zLines.length) ? nearestLine(A.zLines, e.pos.z) : e.pos.z;
        } else {
          e.tz = (e.pos.z > A.center.z ? A.maxZ + 20 : A.minZ - 20);
          e.tx = (A.xLines && A.xLines.length) ? nearestLine(A.xLines, e.pos.x) : e.pos.x;
        }
        steerEmergency(e, dt, A);
        const outX = e.pos.x < A.minX - 14 || e.pos.x > A.maxX + 14;
        const outZ = e.pos.z < A.minZ - 14 || e.pos.z > A.maxZ + 14;
        // stuckT: clampToCity pins the truck at the rim, so "wedged at the edge"
        // is the real despawn cue out there (plus the old timeout)
        if (outX || outZ || e.t > 14 || e.stuckT > 3) { if (e.target) e.target._emgClaimed = false; despawnEmergency(e); emg.splice(i, 1); continue; }
      }

      emgCollide(e, dt);   // solid to the player, on foot or behind the wheel

      // drawn out to the eye's fog (core/sight.js), not hidden at 170 m
      e.grp.visible = !CBZ.sightSees || CBZ.sightSees(e.pos.x, e.pos.z, 6);
    }
  });
})();
