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
    if (g.mode !== "city") return;
    const A = CBZ.city.arena; if (!A) return;

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
        if (seen) { CBZ.cityCrime && CBZ.cityCrime(22, { type: "red-light" }); CBZ.city && CBZ.city.note("🚦 A cop saw you run the light.", 2); }
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
  const laneOffset = (r, dir, idx) => (CBZ.roadLaneCenter ? CBZ.roadLaneCenter(r, dir, idx) : dir * laneWidth() * (idx + 0.5));

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

  // is `c` stuck right behind a much slower car physically in its lane? Counts
  // same-direction dawdlers AND a head-on blocker (a stopped oncoming car / a
  // U-turner in our lane) — either way the pull-around logic dissolves it.
  function blockedAhead(c) {
    if (!c.road) return null;
    let best = null, bg = 1e9;
    for (const o of CBZ.cityCars) {
      if (o === c || o.dead || o.road !== c.road) continue;
      const along = c.road.vertical ? (o.pos.z - c.pos.z) * c.dirSign : (o.pos.x - c.pos.x) * c.dirSign;
      const lat = c.road.vertical ? Math.abs(o.pos.x - c.pos.x) : Math.abs(o.pos.z - c.pos.z);
      if (along > 0.4 && along < 7 && lat < laneWidth() * 0.7 && along < bg) { bg = along; best = o; }
    }
    return best ? { car: best, gap: bg } : null;
  }

  // is the lane at lateral offset `targetLat` on `c`'s road clear enough to pull
  // into? Checks a window behind→ahead for anything sitting in (or barrelling
  // down) that lane. Multi-lane: overtaking stays in the SAME direction (an
  // adjacent lane index), so no head-on swerves into oncoming.
  function laneFree(c, targetLat) {
    if (!c.road) return false;
    const half = laneWidth() * 0.6;
    for (const o of CBZ.cityCars) {
      if (o === c || o.dead || o.road !== c.road) continue;
      const oLat = c.road.vertical ? o.pos.x - c.road.x : o.pos.z - c.road.z;
      if (Math.abs(oLat - targetLat) > half) continue;    // not in the target lane
      const along = c.road.vertical ? (o.pos.z - c.pos.z) * c.dirSign : (o.pos.x - c.pos.x) * c.dirSign;
      if (along > -8 && along < 14) return false;
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
  function computeTarget(A) {
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
    return Math.max(6, Math.min(40, Math.round(scaled * 0.42 * qmul * hourDensityMul())));
  }
  const NEAR2 = 80 * 80;     // "near the camera" radius²
  const FAR2 = 150 * 150;    // "way off, fair to recycle" radius² (past the cull)
  function countNear() {
    const cam = CBZ.camera.position;
    let near = 0;
    for (const c of CBZ.cityCars) {
      if (!c.ai || c.dead || c.owned || c.player || !c.road || c.abandoned) continue;
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
      if (!c.ai || c.dead || c.owned || c.player || !c.road || c._patrolCar) continue;   // never yank a police patrol cruiser
      if (c.abandoned || c.wreckT > 0 || c.turning || c.npcDriver || c.pullover || c.roadRageTarget || (c._rageT || 0) > 0) continue;
      if ((c.crumple || 0) > 0.05 || c._onFire || c._smoking) continue;   // don't teleport visible wrecks
      const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z, d = dx * dx + dz * dz;
      if (d > pd) { pd = d; pick = c; }
    }
    if (!pick) return false;
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
    return d === "highway" || d === "island" || d === "town" || d === "bridge" ||
           d === "desert" || d === "snow" || d === "forest" || d === "farmland";
  }
  // pick the farthest-from-camera idle/healthy ambient car (same filter as
  // recycleOne) that's at least minD2 away — a car nobody is watching.
  function farIdleCar(minD2) {
    const cam = CBZ.camera.position;
    let pick = null, pd = minD2;
    for (const c of CBZ.cityCars) {
      if (!c.ai || c.dead || c.owned || c.player || !c.road || c._patrolCar) continue;   // never yank a police patrol cruiser
      if (c.abandoned || c.wreckT > 0 || c.turning || c.npcDriver || c.pullover || c.roadRageTarget || (c._rageT || 0) > 0) continue;
      if ((c.crumple || 0) > 0.05 || c._onFire || c._smoking) continue;
      const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z, d = dx * dx + dz * dz;
      if (d > pd) { pd = d; pick = c; }
    }
    return pick;
  }
  // write the SAME relocation fields recycleOne writes, onto an explicit road r
  // at a clamped along-offset (long highways get spread out, not bunched at one
  // end). Returns true. Keeps vehicles.js order-37 in sync.
  function placeOnRoad(c, r) {
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
      if (!c.ai || c.dead || c.player || c.owned || !c.road) continue;
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
      if (Math.random() > 0.34) continue;                        // ~1 in 3 highways
      if (segHasCar(r, 60 * 60)) continue;
      const pick = farIdleCar(0);                                // any idle car (none are near a fresh arena)
      if (!pick) break;
      if (placeOnRoad(pick, r)) seeded++;
    }
  }

  // ---- behaviour + density tick (order 36.5: after lights, before AI 37) --
  let beh = 0;
  CBZ.onUpdate(36.5, function (dt) {
    if (g.mode !== "city") { return; }
    const A = CBZ.city.arena; if (!A) return;
    if (A !== lastArena) {
      lastArena = A; targetNear = computeTarget(A);
      seedHighwaysOnBind(A);     // TRAF-1: every highway starts visibly alive on arrival
      _farSeedT = 2;             // stagger the first ongoing far-seed a beat after bind
    }

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
        if (near < targetNear) recycleOne(A);
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
      if (!c || c.player || c.dead || !c.ai || !c.road || c.owned) continue;
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
      if (c.wreckT > 0 || c.turning || c.pullover || (c.npcDriver && c.roadRageTarget)) { c.blockedT = 0; continue; }

      const slice = cars.length > SLICE ? cars.length / SLICE : 1;
      const blk = blockedAhead(c);
      const stuck = blk && blk.car.v < 1.5 && blk.gap < 5;
      const onGreen = CBZ.cityIsRed && !CBZ.cityIsRed(c.road.vertical);
      // a DEAD obstacle (wreck, abandoned car, somebody's parked car) is not a
      // queue — waiting behind it is never lawful, so patience runs even on red.
      const deadAhead = stuck && (blk.car.abandoned || blk.car.dead || (blk.car.wreckT || 0) > 0 || !blk.car.ai);
      if (stuck) {
        // HONK at whoever's dawdling right in front of us, harder if it's a green.
        if (c.honkCD <= 0 && Math.random() < arch.horny * (onGreen || deadAhead ? 1 : 0.5)) honkAt(c);
        // blocking on a GREEN — or by a dead obstacle — builds real
        // "why won't you MOVE" patience-loss; a queue at a red doesn't.
        if (onGreen || deadAhead) c.blockedT += dt * slice; else c.blockedT = Math.max(0, c.blockedT - dt);
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
          if (!ot && (c.trafArch === "reckless" || (c.driver && c.driver.aggr >= 0.82))) {
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
              if (CBZ.sfx) { const cam = CBZ.camera.position; const dd = (c.pos.x - cam.x) * (c.pos.x - cam.x) + (c.pos.z - cam.z) * (c.pos.z - cam.z); if (dd < 40 * 40) CBZ.sfx("clank"); }
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
     EMERGENCY VEHICLES — self-contained meshes that drive to incidents.
       AMBULANCE  → a fresh dead body (complements medics.js: the truck
                    rolls up, parks, and flags nearby bodies for pickup so
                    the on-foot paramedic dispatches fast).
       FIRE TRUCK → a burning car (extinguishes it if it reaches it in time;
                    otherwise works the smoking scene afterward).
     Shared geometry/materials, a hard cap, distance LOD + culling.
  ============================================================ */
  const EMG_MAX = { ambulance: 1, firetruck: 1 };
  const emg = [];
  let emgScanT = 0;

  // shared meshes (built lazily, tagged _shared so resets never dispose them).
  // ONE unit box, scaled per mesh, builds every hull/trim block — zero per-spawn
  // geometry allocation, and despawnEmergency never has to dispose geometry.
  let G = null;
  function geos() {
    if (G) return G;
    G = {
      unit: new THREE.BoxGeometry(1, 1, 1),
      wheel: new THREE.CylinderGeometry(0.5, 0.5, 0.46, 10),
    };
    for (const k in G) G[k]._shared = true;
    return G;
  }
  const tireMat = (function () { const m = new THREE.MeshLambertMaterial({ color: 0x14161b }); m._shared = true; return m; })();
  // shared accent materials — shiny carfx roles when available (glass/steel are
  // SHARED cache entries there), plain Lambert otherwise. All _shared: the
  // despawn disposer must never free them.
  let EMS = null;
  function emgAccents() {
    if (EMS) return EMS;
    function sh(role, hex) {
      let m = null;
      if (CBZ.vehicleMat) { try { m = CBZ.vehicleMat(role, hex); } catch (e) { m = null; } }
      if (!m || !m.isMaterial) m = new THREE.MeshLambertMaterial({ color: hex });
      m._shared = true;
      return m;
    }
    EMS = { glass: sh("glass", 0x10161c), steel: sh("metal", 0x9aa3ab) };
    return EMS;
  }
  // scaled-unit-box brick: the whole emergency build is this call over and over
  function ebox(grp, mat, sx, sy, sz, px, py, pz) {
    const m = new THREE.Mesh(geos().unit, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(px, py, pz);
    grp.add(m);
    return m;
  }

  function buildEmergency(kind) {
    const gg = geos();
    const acc = emgAccents();
    const grp = new THREE.Group();
    const isFire = kind === "firetruck";
    // Per-instance paints — despawnEmergency disposes EXACTLY the five keys we
    // return (body/cab/bar/redMat/bluMat); every other material here is _shared.
    // ambulance: white box + red livery. firetruck: crimson rig + white cab roof.
    const bodyMat = new THREE.MeshLambertMaterial({ color: isFire ? 0xc4231b : 0xeef3f6 });
    const cabMat = new THREE.MeshLambertMaterial({ color: isFire ? 0xe8ecef : 0xd23b3b });
    const barMat = new THREE.MeshLambertMaterial({ color: 0x111316 });
    // flash mats — flashBeacon() drives emissiveIntensity on these two, KEEP.
    const redMat = new THREE.MeshLambertMaterial({ color: 0xff2a2a, emissive: 0xff0000, emissiveIntensity: 1 });
    const bluMat = new THREE.MeshLambertMaterial({ color: 0x2a6bff, emissive: 0x1133ff, emissiveIntensity: 0.2 });

    if (isFire) {
      // FIRE ENGINE — crimson cab-over rig: pump body, white cab roof, silver
      // diamond-plate skirt, roof ladder on a turntable, rear hose-reel drum.
      ebox(grp, bodyMat, 2.2, 1.5, 3.3, 0, 1.15, -1.0);           // pump body (top 1.9)
      ebox(grp, bodyMat, 2.1, 1.15, 1.7, 0, 1.05, 1.7);           // cab-over nose
      ebox(grp, cabMat, 2.14, 0.16, 1.74, 0, 1.7, 1.7);           // white cab roof
      ebox(grp, acc.glass, 1.88, 0.55, 0.1, 0, 1.3, 2.57);        // windshield
      ebox(grp, acc.glass, 0.08, 0.5, 1.0, -1.07, 1.22, 1.7);     // cab side glass
      ebox(grp, acc.glass, 0.08, 0.5, 1.0, 1.07, 1.22, 1.7);
      ebox(grp, barMat, 1.6, 0.45, 0.12, 0, 0.68, 2.6);           // grille block
      ebox(grp, acc.steel, 2.34, 0.3, 0.3, 0, 0.4, 2.62);         // front bumper
      ebox(grp, acc.steel, 2.3, 0.26, 0.28, 0, 0.4, -2.7);        // rear step
      ebox(grp, acc.steel, 0.08, 0.4, 3.3, -1.12, 0.55, -1.0);    // diamond-plate skirt
      ebox(grp, acc.steel, 0.08, 0.4, 3.3, 1.12, 0.55, -1.0);
      ebox(grp, acc.steel, 2.2, 0.4, 0.08, 0, 0.55, -2.66);
      // ladder assembly: turntable block, two rails, rungs spanning them
      ebox(grp, barMat, 0.9, 0.24, 0.9, 0, 2.0, -0.4);            // turntable
      ebox(grp, acc.steel, 0.1, 0.12, 3.2, -0.3, 2.26, -0.8);     // rails
      ebox(grp, acc.steel, 0.1, 0.12, 3.2, 0.3, 2.26, -0.8);
      for (let rz = -2.2; rz <= 0.65; rz += 0.7) ebox(grp, acc.steel, 0.52, 0.06, 0.1, 0, 2.26, rz);
      const drum = new THREE.Mesh(gg.wheel, barMat);              // rear hose-reel drum
      drum.rotation.x = Math.PI / 2;
      drum.scale.set(0.72, 0.62, 0.72);
      drum.position.set(0, 1.5, -2.52); grp.add(drum);
      // lightbar on the cab roof: red / white / blue segments (flash logic below)
      ebox(grp, barMat, 1.9, 0.14, 0.42, 0, 1.85, 1.7);
      ebox(grp, redMat, 0.55, 0.2, 0.38, -0.6, 2.0, 1.7);
      ebox(grp, cabMat, 0.36, 0.16, 0.36, 0, 1.99, 1.7);
      ebox(grp, bluMat, 0.55, 0.2, 0.38, 0.6, 2.0, 1.7);
      ebox(grp, barMat, 0.14, 0.3, 0.12, -1.18, 1.42, 2.42);      // mirrors
      ebox(grp, barMat, 0.14, 0.3, 0.12, 1.18, 1.42, 2.42);
    } else {
      // AMBULANCE — white patient module towering over a lower cab, red stripe
      // band + red crosses, rear double-door seam, chunky bumpers.
      ebox(grp, bodyMat, 2.2, 1.7, 3.5, 0, 1.3, -0.9);            // patient module (top 2.15)
      ebox(grp, bodyMat, 2.06, 0.95, 1.5, 0, 1.0, 1.6);           // cab shell
      ebox(grp, bodyMat, 2.06, 0.55, 0.5, 0, 0.78, 2.42);         // hood nose
      ebox(grp, acc.glass, 1.82, 0.5, 0.1, 0, 1.26, 2.36);        // windshield
      ebox(grp, acc.glass, 0.08, 0.42, 0.85, -1.05, 1.18, 1.55);  // cab side glass
      ebox(grp, acc.glass, 0.08, 0.42, 0.85, 1.05, 1.18, 1.55);
      // red stripe band: module flanks, cab flanks, tail
      ebox(grp, cabMat, 0.06, 0.34, 3.5, -1.12, 1.26, -0.9);
      ebox(grp, cabMat, 0.06, 0.34, 3.5, 1.12, 1.26, -0.9);
      ebox(grp, cabMat, 0.05, 0.3, 1.5, -1.05, 0.95, 1.6);
      ebox(grp, cabMat, 0.05, 0.3, 1.5, 1.05, 0.95, 1.6);
      ebox(grp, cabMat, 2.2, 0.34, 0.06, 0, 1.26, -2.68);
      // red cross blocks above the stripe: both module sides + the rear doors
      ebox(grp, cabMat, 0.06, 0.6, 0.2, -1.12, 1.82, -0.9);
      ebox(grp, cabMat, 0.06, 0.2, 0.6, -1.12, 1.82, -0.9);
      ebox(grp, cabMat, 0.06, 0.6, 0.2, 1.12, 1.82, -0.9);
      ebox(grp, cabMat, 0.06, 0.2, 0.6, 1.12, 1.82, -0.9);
      ebox(grp, cabMat, 0.2, 0.6, 0.06, 0, 1.85, -2.68);
      ebox(grp, cabMat, 0.6, 0.2, 0.06, 0, 1.85, -2.68);
      // rear double-door seam inset + handles
      ebox(grp, barMat, 0.05, 1.35, 0.05, 0, 1.32, -2.67);
      ebox(grp, barMat, 0.18, 0.06, 0.05, -0.32, 1.5, -2.67);
      ebox(grp, barMat, 0.18, 0.06, 0.05, 0.32, 1.5, -2.67);
      ebox(grp, acc.steel, 2.3, 0.28, 0.3, 0, 0.42, 2.6);         // chunky bumpers
      ebox(grp, acc.steel, 2.3, 0.28, 0.3, 0, 0.42, -2.7);
      // lightbar on the cab roof: red / white / blue segments (flash logic below)
      ebox(grp, barMat, 1.9, 0.14, 0.42, 0, 1.55, 1.5);
      ebox(grp, redMat, 0.55, 0.2, 0.38, -0.6, 1.7, 1.5);
      ebox(grp, bodyMat, 0.36, 0.16, 0.36, 0, 1.69, 1.5);
      ebox(grp, bluMat, 0.55, 0.2, 0.38, 0.6, 1.7, 1.5);
      ebox(grp, barMat, 0.14, 0.28, 0.12, -1.14, 1.32, 2.28);     // mirrors
      ebox(grp, barMat, 0.14, 0.28, 0.12, 1.14, 1.32, 2.28);
    }
    // wheel arches over each axle
    for (const ax of [-1.1, 1.1]) for (const az of [1.7, -1.7]) ebox(grp, tireMat, 0.14, 0.32, 1.15, ax, 0.92, az);
    // four wheels (footprint unchanged — spawnEmergency's dims {2.2, 5.4} still true)
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(gg.wheel, tireMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(i % 2 === 0 ? -1.05 : 1.05, 0.5, i < 2 ? 1.7 : -1.7);
      // EMERGENCY_STEALABLE: tagged so a stolen truck spins its wheels while
      // driven (cityPromotePlayerCar's collectWheels finds playerWheel meshes).
      w.userData.playerWheel = true;
      grp.add(w);
    }
    // No floating "AMBULANCE"/"FIRE" word: the shape, livery (red truck / white
    // box) and flashing red+blue beacons read as an emergency vehicle on sight.
    // A label over the roof broke the fourth wall and was removed.
    return { grp, redMat, bluMat, body: bodyMat, cab: cabMat, bar: barMat };
  }

  function spawnEmergency(kind, tx, tz) {
    const A = CBZ.city.arena; if (!A) return null;
    // enter from the city edge along a road far from the incident
    const r = A.roads[(Math.random() * A.roads.length) | 0];
    const dir = Math.random() < 0.5 ? 1 : -1;
    const lane = laneOffset(r, dir, 0);   // emergency runs the inner lane
    let sx, sz;
    if (r.vertical) { sx = r.x + lane; sz = r.z - dir * (r.len / 2 - 4); }
    else { sx = r.x - dir * (r.len / 2 - 4); sz = r.z + lane; }
    const built = buildEmergency(kind);
    built.grp.position.set(sx, 0, sz);
    A.root.add(built.grp);
    const e = {
      kind, grp: built.grp, pos: built.grp.position, mats: built,
      tx, tz, heading: 0, v: 0, state: "drive", t: 0, beaconT: Math.random() * 2,
      siren: 0, target: null,
      // dims feed vehicles.js's shared wall resolver (cityCollideVehicle) so the
      // truck hull collides exactly like every other driven car in the city.
      dims: { width: 2.2, length: 5.4, height: 2.6, wheelbase: 3.4 },
      cx: null, cz: null, stuckT: 0,
    };
    // EMERGENCY_STEALABLE: the truck is ALSO a first-class CBZ.cityCars record
    // (same object — one identity). That makes it (a) visible to the interact
    // system ("Boost it"/"Get in" via cityNearestCar), (b) SOLID to all other
    // traffic via resolveCars — no more ghosting through cars — and (c) fully
    // drivable by the order-11 player loop once entered. While it's still on
    // duty the bespoke dispatch AI below keeps the wheel (e.ai stays false, so
    // vehicles.js's order-37 lane AI never fights it).
    if ((!CBZ.CONFIG || CBZ.CONFIG.EMERGENCY_STEALABLE !== false) && CBZ.cityRegisterVehicle) {
      CBZ.cityRegisterVehicle(built.grp, {
        record: e, body: "van", style: "van",
        // persist: a mid-life spawnCityTraffic/clearCars sweep must never
        // dispose a truck the dispatch loop is still driving (despawnEmergency
        // owns the real teardown, incl. the cityCars splice).
        persist: true,
        // modest chop value — an ambulance is a joke payday, not a jackpot
        model: { name: kind === "firetruck" ? "Fire Engine" : "Ambulance", value: 3800, rarity: 0.5, body: "van" },
        dims: { width: 2.2, length: 5.4, height: 2.6, wheelbase: 3.4 },
        color: kind === "firetruck" ? 0xc4231b : 0xeef3f6,
      });
      e._emergency = kind;
      // the lightbar's red beacon material matches the brake-light detector —
      // setBrake would swap it to a frozen "brake" clone mid-strobe and fight
      // flashBeacon. The truck has no authored brake lamps: let the beacon own it.
      e._tailMeshes = [];
    }
    emg.push(e);
    return e;
  }

  function despawnEmergency(e) {
    if (e.grp && e.grp.parent) e.grp.parent.remove(e.grp);
    if (e.mats) {
      // dispose only the per-instance materials we built (geoms are _shared)
      ["body", "cab", "redMat", "bluMat", "bar"].forEach(function (k) { const m = e.mats[k]; if (m && m.dispose && !m._shared) m.dispose(); });
    }
    // EMERGENCY_STEALABLE: drop the cityCars registration with the truck, or a
    // ghost record keeps colliding/getting offered as enterable.
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
      if (c._emgClaimed) continue;
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
    if (countKind("ambulance") < EMG_MAX.ambulance) {
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
    const onGrid = !!(A.xLines && A.xLines.length && A.zLines && A.zLines.length);
    if (onGrid) {
      const xl = nearestLine(A.xLines, tx), zl = nearestLine(A.zLines, tz);
      if (Math.abs(tx - xl) <= Math.abs(tz - zl)) { cx = xl; cz = tz; curbVert = true; }
      else { cx = tx; cz = zl; curbVert = false; }
    }
    e.cx = cx; e.cz = cz;
    // this frame's aim point: a 3-leg Manhattan route along real roads
    let aimX, aimZ;
    if (!onGrid) {
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
    if (A.clampToCity) A.clampToCity(e.pos, 1.6);
    // pinned against geometry? (commanded a real step, the body barely moved)
    const stepped = Math.hypot(e.pos.x - px, e.pos.z - pz);
    if (e.v > 2 && stepped < e.v * dt * 0.35) { e.stuckT = (e.stuckT || 0) + dt; e.v *= Math.pow(0.05, dt); }
    else e.stuckT = Math.max(0, (e.stuckT || 0) - dt * 2);
    e.grp.position.set(e.pos.x, 0, e.pos.z);
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
    // registered as a real cityCars record (EMERGENCY_STEALABLE) → vehicles.js
    // resolveCars already owns truck-vs-car separation/crashes; a second
    // hand-rolled push here would double-shove the player's car every frame.
    if (e._emergency) return;
    emgCarPush(e, speed);
  }
  function emgFootPush(e, speed) {
    const P = CBZ.player;
    {
      const hw = 1.1 + (P.radius || 0.45), hl = 2.7 + (P.radius || 0.45);
      const s = Math.sin(e.heading), c = Math.cos(e.heading);
      const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) >= hw || Math.abs(lz) >= hl) return;
      const px = hw - Math.abs(lx), pz = hl - Math.abs(lz);
      if (px < pz) { const d = lx >= 0 ? px : -px; P.pos.x += d * c; P.pos.z += -d * s; }
      else { const d = lz >= 0 ? pz : -pz; P.pos.x += d * s; P.pos.z += d * c; }
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
  function emgCarPush(e, speed) {
    const P = CBZ.player;
    // your car vs the truck: push apart + kill the closing speed (a wall of
    // steel with right of way — you bounce off, it barely notices)
    const car = P._vehicle;
    if (!car) return;
    const dx = car.pos.x - e.pos.x, dz = car.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz), min = 4.3;
    if (d >= min || d < 0.001) return;
    const nx = dx / d, nz = dz / d, push = (min - d);
    car.pos.x += nx * push * 0.85; car.pos.z += nz * push * 0.85;
    e.pos.x -= nx * push * 0.15; e.pos.z -= nz * push * 0.15;
    const closing = Math.abs((car.vx || 0) * nx + (car.vz || 0) * nz) + speed * 0.5;
    car.vx = (car.vx || 0) * 0.45 + nx * 2; car.vz = (car.vz || 0) * 0.45 + nz * 2;
    car.v = (car.v || 0) * 0.5;
    e.v *= 0.55;
    if (closing > 8 && emgRunCD <= 0) {
      emgRunCD = 0.9;
      if (CBZ.cityDamageCar) CBZ.cityDamageCar(car, Math.min(40, closing * 2.2), { fromX: e.pos.x, fromZ: e.pos.z });
      // attribute to the emergency vehicle that hit your car — not a generic
      // "car crash" (the owner was T-boned by an ambulance and the note lied).
      // "firetruck" is one word so killfeed.js's /\bfire\b/ can't mis-file it as
      // an explosion; "car was rammed" carries the `car` keyword so the feed
      // still buckets it as a vehicle death.
      const emgReason = "in a crash with " + (e.kind === "firetruck" ? "a firetruck" : "an ambulance");
      if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(Math.min(35, closing * 1.4), e.pos.x, e.pos.z, emgReason, false, null, true);
      if (CBZ.sfx) { try { CBZ.sfx("crash"); } catch (er) {} }
      if (CBZ.shake) CBZ.shake(0.6);
    }
  }

  function flashBeacon(e, dt) {
    e.beaconT += dt;
    const on = (e.beaconT % 0.6) < 0.3;
    if (e.mats.redMat) e.mats.redMat.emissiveIntensity = on ? 1.4 : 0.06;
    if (e.mats.bluMat) e.mats.bluMat.emissiveIntensity = on ? 0.06 : 1.4;
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
      // ambulance: flag nearby bodies for pickup NOW so medics.js dispatches the
      // stretcher team immediately (the dramatic roll-up + the on-foot lift).
      const peds = CBZ.cityPeds;
      if (peds) {
        for (let i = 0; i < peds.length; i++) {
          const p = peds[i];
          if (!(p.dead && !p.collected && !p.culled)) continue;
          // near the TRUCK — or near the SCENE it parked at the curb for (the
          // curb stop can leave the body a block-interior walk away; the on-foot
          // stretcher team covers that last leg, not the truck)
          const dT = (p.pos.x - e.pos.x) * (p.pos.x - e.pos.x) + (p.pos.z - e.pos.z) * (p.pos.z - e.pos.z);
          const dS = (p.pos.x - e.tx) * (p.pos.x - e.tx) + (p.pos.z - e.tz) * (p.pos.z - e.tz);
          if (dT < 12 * 12 || dS < 10 * 10) p.needsPickup = true;
        }
      }
      // (no toast — the stretcher team rolling up IS the scene)
    }
  }

  let emgLastElapsed = 0;
  CBZ.onUpdate(36.7, function (dt) {
    if (g.mode !== "city") { if (emg.length || liveHonks.length) CBZ.cityEmergencyReset(); return; }
    const A = CBZ.city.arena; if (!A) return;
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
        stolenEmg.push(e);
        emg.splice(i, 1);
        continue;
      }
      flashBeacon(e, dt);
      // wail the siren on a long cooldown while en route (one-shot in the bank)
      e.siren -= dt;
      if (e.state === "drive" && e.siren <= 0) {
        e.siren = 2.6;
        const cam = CBZ.camera.position;
        const dd = (e.pos.x - cam.x) * (e.pos.x - cam.x) + (e.pos.z - cam.z) * (e.pos.z - cam.z);
        if (dd < 70 * 70 && CBZ.sfx) CBZ.sfx("siren");
      }

      if (e.state === "drive") {
        // re-aim at a moving / still-valid target
        if (e.target) {
          if (e.kind === "firetruck" && (e.target.dead || e.target._exploded || (!e.target._onFire && !e.target._smoking))) {
            // fire's already out / car blew — bail
            e.state = "leave"; e.t = 0;
          } else if (e.kind === "ambulance" && (e.target.collected || e.target.culled || !e.target.dead)) {
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
          if (d < 6 || (atCurb && d < 60)) { emergencyArrive(e); e.state = "work"; e.t = 0; e.stuckT = 0; }
          else if (e.stuckT > 2.5) {
            // wedged (wreck/queue in the lane): a real unit stops where it is and
            // works the scene from there — never grinds through geometry.
            if (d < 45) emergencyArrive(e);
            e.state = d < 45 ? "work" : "leave"; e.t = 0; e.stuckT = 0;
          }
          else if (e.t > 28) { e.state = "leave"; e.t = 0; }   // gave up / blocked
        }
      } else if (e.state === "work") {
        e.t += dt; e.v *= Math.pow(0.1, dt);
        if (e.t > 3.5) { e.state = "leave"; e.t = 0; if (e.target) e.target._emgClaimed = false; }
      } else { // leave: roll off ALONG A ROAD toward the nearest edge, then despawn
        e.t += dt;
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

      // distance cull (cheap LOD: hide the body when far off camera)
      const cam = CBZ.camera.position;
      const dd = (e.pos.x - cam.x) * (e.pos.x - cam.x) + (e.pos.z - cam.z) * (e.pos.z - cam.z);
      e.grp.visible = dd < 170 * 170;
    }
  });
})();
