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
    if (!lamp || !lamp.material) return;
    lamp.material.emissiveIntensity = on ? 1.0 : 0.04;
    lamp.material.color.setHex(on ? color : 0x20242a);
    if (lamp.material.emissive) lamp.material.emissive.setHex(color);
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
        // each axis head shows its own state — cross street is red while the
        // main runs green, exactly like a real 4-way signal.
        const ns = L.ns || L, ew = L.ew;
        lampSet(ns.red, p.ns === "red", 0xff3b3b);
        lampSet(ns.yel, p.ns === "yellow", 0xffcf3b);
        lampSet(ns.grn, p.ns === "green", 0x39ff66);
        if (ew) {
          lampSet(ew.red, p.ew === "red", 0xff3b3b);
          lampSet(ew.yel, p.ew === "yellow", 0xffcf3b);
          lampSet(ew.grn, p.ew === "green", 0x39ff66);
        }
      }
    }

    // ---- red-light / reckless-driving enforcement ----
    if (ticketCD > 0) ticketCD -= dt;
    const P = CBZ.player;
    if (!P.driving || !P._vehicle) { prevInside = false; return; }
    const v = P._vehicle;
    const it = A.nearestIntersection(P.pos.x, P.pos.z);
    const inside = Math.abs(P.pos.x - it.x) < A.ROAD / 2 + 1.5 && Math.abs(P.pos.z - it.z) < A.ROAD / 2 + 1.5;
    // count it once, on entry, while moving with a red against your heading
    if (inside && !prevInside && Math.hypot(v.vx || 0, v.vz || 0) > 6) {
      const vertical = Math.abs(v.vz || 0) > Math.abs(v.vx || 0);
      if (CBZ.cityIsRed(vertical) && ticketCD <= 0) {
        ticketCD = 4;
        // only a problem if a cop is around to see it; otherwise just a warning
        const seen = anyCopNear(P.pos.x, P.pos.z, 34);
        if (seen) { CBZ.cityCrime && CBZ.cityCrime(22, { type: "red-light" }); CBZ.city && CBZ.city.note("🚦 Ran a red light — wanted!", 2); }
        else CBZ.city && CBZ.city.note("🚦 You ran a red light", 1.4);
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

  // ---- driver personalities ---------------------------------------------
  // A car's aggression stat already lives on c.driver.aggr (0..1) and c.reckless.
  // We bucket it into a readable archetype the moment we first see a car, then
  // use that for honking patience, horn-happiness and road-rage temper. The
  // buckets line up with GTA's vehicleaihandling tiers: timid → menace.
  const ARCH = {
    cautious:   { honkPatience: 3.2, horny: 0.10, ragePatience: 1e9, cruiseMul: 0.86 },
    normal:     { honkPatience: 1.9, horny: 0.34, ragePatience: 1e9, cruiseMul: 1.0 },
    aggressive: { honkPatience: 0.9, horny: 0.72, ragePatience: 5.5, cruiseMul: 1.12 },
    reckless:   { honkPatience: 0.5, horny: 0.92, ragePatience: 2.8, cruiseMul: 1.2 },
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

  // ---- honk "pop": a brief sprite above a honking car (no horn sample exists
  //      in the bank, so the honk reads visually + a faint metallic stab) -----
  const honkPool = [];
  const liveHonks = [];
  function honkAt(c) {
    if (c.honkCD > 0) return;
    const arch = ARCH[c.trafArch] || ARCH.normal;
    c.honkCD = arch.honkPatience + 0.4 + Math.random() * 0.8;
    // only spend a sprite + sound if you're near enough to notice it
    const cam = CBZ.camera.position;
    const dd = (c.pos.x - cam.x) * (c.pos.x - cam.x) + (c.pos.z - cam.z) * (c.pos.z - cam.z);
    if (dd > 60 * 60) return;
    let s = honkPool.pop();
    if (!s) {
      if (CBZ.makeLabelSprite) s = CBZ.makeLabelSprite("HONK!", { color: "#ffd34d" });
      if (!s) return;
      s.scale.multiplyScalar(0.72);
    }
    s.position.set(c.pos.x, 3.0, c.pos.z);
    if (s.material) s.material.opacity = 1;
    s.visible = true;
    CBZ.city.arena.root.add(s);
    liveHonks.push({ s, t: 0, life: 0.8 });
    // a faint metallic stab stands in for the horn (real recorded foley only)
    if (dd < 34 * 34 && CBZ.sfx && Math.random() < 0.6) CBZ.sfx("clank");
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

  // is `c` stuck right behind a much slower car in the same lane & direction?
  function blockedAhead(c) {
    if (!c.road) return null;
    let best = null, bg = 1e9;
    for (const o of CBZ.cityCars) {
      if (o === c || o.dead || o.road !== c.road || o.dirSign !== c.dirSign) continue;
      const along = c.road.vertical ? (o.pos.z - c.pos.z) * c.dirSign : (o.pos.x - c.pos.x) * c.dirSign;
      const lat = c.road.vertical ? Math.abs(o.pos.x - c.pos.x) : Math.abs(o.pos.z - c.pos.z);
      if (along > 0.4 && along < 7 && lat < 2.4 && along < bg) { bg = along; best = o; }
    }
    return best ? { car: best, gap: bg } : null;
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
  let targetNear = 0, upkeepT = 0, lastArena = null;
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
    return Math.max(6, Math.min(40, Math.round(scaled * 0.42 * qmul)));
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
      if (!c.ai || c.dead || c.owned || c.player || !c.road) continue;
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
      const lane = dir * (TR().lane != null ? TR().lane : 2.2);
      const x = r.vertical ? r.x + lane : r.x + along;
      const z = r.vertical ? r.z + along : r.z + lane;
      const dpx = x - P.x, dpz = z - P.z, dp = dpx * dpx + dpz * dpz;
      const dcx = x - cam.x, dcz = z - cam.z, dc = dcx * dcx + dcz * dcz;
      // out of the player's near bubble + off camera, but not on the far edge
      if (dp < 50 * 50 || dp > 120 * 120 || dc < 62 * 62) continue;
      // relocate: vehicles.js (order 37) reads road/lane/dirSign/heading each frame
      pick.road = r; pick.vertical = r.vertical; pick.dirSign = dir; pick.lane = lane;
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

  // ---- behaviour + density tick (order 36.5: after lights, before AI 37) --
  let beh = 0;
  CBZ.onUpdate(36.5, function (dt) {
    if (g.mode !== "city") { return; }
    const A = CBZ.city.arena; if (!A) return;
    if (A !== lastArena) { lastArena = A; targetNear = computeTarget(A); }

    updateHonks(dt);

    // density upkeep — cheap, ~ twice a second, one recycle per tick max. Skip
    // during a hot pursuit (player driving + wanted) so we never yank a car the
    // chase logic might be using or pop traffic into a tense moment.
    upkeepT -= dt;
    if (upkeepT <= 0) {
      upkeepT = 0.5;
      if (!targetNear) targetNear = computeTarget(A);
      if (!(CBZ.player.driving && (g.wanted | 0) >= 2)) {
        const near = countNear();
        if (near < targetNear) recycleOne(A);
      }
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
      if (stuck) {
        // HONK at whoever's dawdling right in front of us, harder if it's a green.
        if (c.honkCD <= 0 && Math.random() < arch.horny * (onGreen ? 1 : 0.5)) honkAt(c);
        // only blocking on a GREEN builds real "why won't you MOVE" rage.
        if (onGreen) c.blockedT += dt * slice; else c.blockedT = Math.max(0, c.blockedT - dt);
        // an aggressive/reckless driver who's been blocked too long SNAPS and
        // aggressively OVERTAKES — flips to the other lane and floors it past the
        // dawdler. We only touch fields vehicles.js's lane-keeper already honors
        // (lane / dirSign stays, reckless + a brief speed boost), so it stays in
        // sync with the order-37 movement loop.
        if (c.blockedT > arch.ragePatience && (c._rageT || 0) <= 0) {
          c._rageT = 3 + Math.random() * 2;
          c.lane = -c.lane;                 // swerve into the adjacent lane to pass
          c.reckless = true;
          c._rageBoost = (c.baseV || 8) * 0.6;
          c.baseV = (c.baseV || 8) + c._rageBoost;
          c.blockedT = 0;
          honkAt(c);
          if (CBZ.sfx) { const cam = CBZ.camera.position; const dd = (c.pos.x - cam.x) * (c.pos.x - cam.x) + (c.pos.z - cam.z) * (c.pos.z - cam.z); if (dd < 40 * 40) CBZ.sfx("clank"); }
          if (CBZ.city) { const cam = CBZ.camera.position; const dd = (c.pos.x - cam.x) * (c.pos.x - cam.x) + (c.pos.z - cam.z) * (c.pos.z - cam.z); if (dd < 30 * 30) CBZ.city.note("😡 Road rage — aggressive overtake!", 1.0); }
        }
      } else {
        c.blockedT = Math.max(0, c.blockedT - dt * 2 * slice);
      }
      // wind the overtake back down so the car settles into its normal lane/cruise.
      if ((c._rageT || 0) > 0) {
        c._rageT -= dt * slice;
        if (c._rageT <= 0) {
          if (c._rageBoost) { c.baseV = Math.max(2, (c.baseV || 8) - c._rageBoost); c._rageBoost = 0; }
          c.lane = -c.lane;          // pull back into our own lane after passing
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

  // shared meshes (built lazily, tagged _shared so resets never dispose them)
  let G = null;
  function geos() {
    if (G) return G;
    G = {
      body: new THREE.BoxGeometry(2.2, 1.7, 5.4),
      cab: new THREE.BoxGeometry(2.1, 1.1, 1.7),
      wheel: new THREE.CylinderGeometry(0.5, 0.5, 0.46, 10),
      bar: new THREE.BoxGeometry(1.9, 0.22, 0.5),
      beacon: new THREE.BoxGeometry(0.42, 0.24, 0.42),
    };
    for (const k in G) G[k]._shared = true;
    return G;
  }
  const tireMat = (function () { const m = new THREE.MeshLambertMaterial({ color: 0x14161b }); m._shared = true; return m; })();

  function buildEmergency(kind) {
    const gg = geos();
    const grp = new THREE.Group();
    const isFire = kind === "firetruck";
    const bodyCol = isFire ? 0xc4231b : 0xeef3f6;
    const trimCol = isFire ? 0x2a2d33 : 0xd23b3b;
    const bodyMat = new THREE.MeshLambertMaterial({ color: bodyCol });
    const cabMat = new THREE.MeshLambertMaterial({ color: trimCol });
    const body = new THREE.Mesh(gg.body, bodyMat); body.position.y = 1.25; grp.add(body);
    const cab = new THREE.Mesh(gg.cab, cabMat); cab.position.set(0, 1.9, 1.5); grp.add(cab);
    // a red + blue beacon on a roof bar that flashes alternately
    const barMat = new THREE.MeshLambertMaterial({ color: 0x111316 });
    const bar = new THREE.Mesh(gg.bar, barMat);
    bar.position.set(0, 2.35, 0.3); grp.add(bar);
    const redMat = new THREE.MeshLambertMaterial({ color: 0xff2a2a, emissive: 0xff0000, emissiveIntensity: 1 });
    const bluMat = new THREE.MeshLambertMaterial({ color: 0x2a6bff, emissive: 0x1133ff, emissiveIntensity: 0.2 });
    const red = new THREE.Mesh(gg.beacon, redMat); red.position.set(-0.55, 2.5, 0.3); grp.add(red);
    const blu = new THREE.Mesh(gg.beacon, bluMat); blu.position.set(0.55, 2.5, 0.3); grp.add(blu);
    // four wheels
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(gg.wheel, tireMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(i % 2 === 0 ? -1.05 : 1.05, 0.5, i < 2 ? 1.7 : -1.7);
      grp.add(w);
    }
    const tag = CBZ.makeLabelSprite ? CBZ.makeLabelSprite(isFire ? "FIRE" : "AMBULANCE", { color: isFire ? "#ff7a4d" : "#7fffd0" }) : null;
    if (tag) { tag.position.set(0, 3.4, 0); grp.add(tag); }
    return { grp, redMat, bluMat, body: bodyMat, cab: cabMat, bar: barMat };
  }

  function spawnEmergency(kind, tx, tz) {
    const A = CBZ.city.arena; if (!A) return null;
    // enter from the city edge along a road far from the incident
    const r = A.roads[(Math.random() * A.roads.length) | 0];
    const dir = Math.random() < 0.5 ? 1 : -1;
    const lane = dir * (TR().lane != null ? TR().lane : 2.2);
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
    };
    emg.push(e);
    return e;
  }

  function despawnEmergency(e) {
    if (e.grp && e.grp.parent) e.grp.parent.remove(e.grp);
    if (e.mats) {
      // dispose only the per-instance materials we built (geoms are _shared)
      ["body", "cab", "redMat", "bluMat", "bar"].forEach(function (k) { const m = e.mats[k]; if (m && m.dispose && !m._shared) m.dispose(); });
    }
  }
  CBZ.cityEmergencyReset = function () {
    for (let i = emg.length - 1; i >= 0; i--) despawnEmergency(emg[i]);
    emg.length = 0;
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
        if (e) { e.target = f; f._emgClaimed = true; if (CBZ.city) CBZ.city.note("🚒 Fire truck dispatched", 1.2); }
      }
    }
    if (countKind("ambulance") < EMG_MAX.ambulance) {
      const b = findBodyIncident();
      if (b) {
        const e = spawnEmergency("ambulance", b.pos.x, b.pos.z);
        if (e) { e.target = b; b._emgClaimed = true; if (CBZ.city) CBZ.city.note("🚑 Ambulance dispatched", 1.2); }
      }
    }
  }

  // simple Manhattan road-router: drive to the target by snapping to the lane
  // grid — go along the current axis to the target's row/col, turn, then finish.
  function steerEmergency(e, dt, A) {
    const tx = e.tx, tz = e.tz;
    const dx = tx - e.pos.x, dz = tz - e.pos.z;
    const dist = Math.hypot(dx, dz);
    // pick the dominant axis first (drive the long leg), then the other
    let aimX, aimZ;
    if (Math.abs(dx) > Math.abs(dz) + 2) { aimX = tx; aimZ = e.pos.z; }
    else if (Math.abs(dz) > Math.abs(dx) + 2) { aimX = e.pos.x; aimZ = tz; }
    else { aimX = tx; aimZ = tz; }
    const adx = aimX - e.pos.x, adz = aimZ - e.pos.z;
    const want = Math.atan2(adx, adz);
    e.heading = CBZ.lerpAngle ? CBZ.lerpAngle(e.heading, want, 1 - Math.pow(0.0009, dt)) : want;
    // emergency vehicles roll fast — they have right of way (ignore the lights)
    const topV = Math.max(11, (TR().cruise ? TR().cruise[1] : 12) * 1.3);
    e.v += Math.min(14 * dt, topV - e.v);
    e.pos.x += Math.sin(e.heading) * e.v * dt;
    e.pos.z += Math.cos(e.heading) * e.v * dt;
    if (A.clampToCity) A.clampToCity(e.pos, 1.6);
    e.grp.position.set(e.pos.x, 0, e.pos.z);
    e.grp.rotation.y = e.heading;
    return dist;
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
        if (CBZ.city) CBZ.city.note("🧯 Fire extinguished", 1.2);
      } else if (CBZ.city) CBZ.city.note("🚒 Too late — wreck cooled", 0.9);
    } else {
      // ambulance: flag nearby bodies for pickup NOW so medics.js dispatches the
      // stretcher team immediately (the dramatic roll-up + the on-foot lift).
      const peds = CBZ.cityPeds;
      if (peds) {
        for (let i = 0; i < peds.length; i++) {
          const p = peds[i];
          if (!(p.dead && !p.collected && !p.culled)) continue;
          const dd = (p.pos.x - e.pos.x) * (p.pos.x - e.pos.x) + (p.pos.z - e.pos.z) * (p.pos.z - e.pos.z);
          if (dd < 12 * 12) p.needsPickup = true;
        }
      }
      if (CBZ.city) CBZ.city.note("🚑 Paramedics on scene", 1.0);
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

    for (let i = emg.length - 1; i >= 0; i--) {
      const e = emg[i];
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
          if (d < 6) { emergencyArrive(e); e.state = "work"; e.t = 0; }
          else if (e.t > 28) { e.state = "leave"; e.t = 0; }   // gave up / blocked
        }
      } else if (e.state === "work") {
        e.t += dt; e.v *= Math.pow(0.1, dt);
        if (e.t > 3.5) { e.state = "leave"; e.t = 0; if (e.target) e.target._emgClaimed = false; }
      } else { // leave: drive off toward the nearest edge, then despawn
        e.t += dt;
        // aim at the far edge along the longer axis
        const farX = (e.pos.x > A.center.x ? A.maxX + 20 : A.minX - 20);
        const farZ = (e.pos.z > A.center.z ? A.maxZ + 20 : A.minZ - 20);
        e.tx = Math.abs(e.pos.x - A.center.x) > Math.abs(e.pos.z - A.center.z) ? farX : e.pos.x;
        e.tz = e.tx === e.pos.x ? farZ : e.pos.z;
        steerEmergency(e, dt, A);
        const outX = e.pos.x < A.minX - 14 || e.pos.x > A.maxX + 14;
        const outZ = e.pos.z < A.minZ - 14 || e.pos.z > A.maxZ + 14;
        if (outX || outZ || e.t > 14) { if (e.target) e.target._emgClaimed = false; despawnEmergency(e); emg.splice(i, 1); continue; }
      }

      // distance cull (cheap LOD: hide the body when far off camera)
      const cam = CBZ.camera.position;
      const dd = (e.pos.x - cam.x) * (e.pos.x - cam.x) + (e.pos.z - cam.z) * (e.pos.z - cam.z);
      e.grp.visible = dd < 170 * 170;
    }
  });
})();
