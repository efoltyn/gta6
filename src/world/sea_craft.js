/* ============================================================
   world/sea_craft.js — SMALL CRAFT IN ANY MODE, AND WHAT A SHARK DOES TO ONE.

   WHY THIS FILE EXISTS
   ------------------------------------------------------------
   Every boat in this game is a cityCars record. vehicles.js is city-only, so
   the shark sim — which borrows survival's island and never builds a road
   network — has never had a single boat on its water. The mode whose entire
   pitch is "you are the shark" was missing the one thing a shark is famous
   for being under.

   So this is the boat WITHOUT the car: a record shaped exactly like the one
   every marine seam in this repo already reads (`.pos`, `.group`, `.heading`,
   `.v/.vx/.vz`, `._hullSpec`, `._planing`) so that

     • CBZ.isMarineHull(rec)                is true,
     • CBZ.marineAutopilot(rec, dt, cmd)    drives it (piracy.js — the ONE AI
                                            hand on a wheel in this game; there
                                            is no second mover here),
     • CBZ.marineShoreBlock                 keeps it off the sand,
     • CBZ.waterRideAt / CBZ.waterWakeFor   seat it and wake it,
     • CBZ.waterFloat                       sinks it when it is holed,
     • water_stability.js's heel/capsize    rolls it when a shark hits it,
     • marine_predation.js and the mounted
       shark's own bite scan                can eat it.

   NOTHING HERE IS A SECOND COPY of any of those. The file is a registry, a
   mover that spends the autopilot, a seat for the people aboard, and the
   damage model for "a shark bit a piece out of my boat" — plus the people
   DRIVING (§3b helm jobs: paddle, carve, fish, troll, dive, transit, sail on
   the weather's wind, liner, moor), what they do when they see a fin (§3c:
   stop and point, cut the anchor and run, come back for the man in the
   water), what their arms are doing (§3d), the rods and lines (§3e), and the
   distance tier that lets the sea hold thirty-odd hulls (§10).

   THE RULES OF SHARK VS BOAT (§4) — the numbers decide, never a list of names
   ------------------------------------------------------------
     ENGULF  the whole hull goes in the mouth:  loa <= 0.62 * bodyLen  AND
             gape >= 0.8 * beam. 0.62 is wildlife_tame.js's own ENGULF_MAX for
             a body, used here for a hull so a meal is a meal whatever it is
             made of.
     BITE    a chunk comes off the rail:        CBZ.marineBiteableHull — the
             jaws close ACROSS the beam and the animal outweighs the hull
             (marine_predation.js §6 owns that gate; we do not fork it).
     RAM     everything else it can reach. The heeling moment decides whether
             the hull goes over, and the moment is physics, not a table:

                 moment[kN.m] = tonnes(shark) * closingSpeed[m/s] * (beam/2)

             against the hull's own righting moment, displacement * gm *
             sin(phi) (water_stability.js integrates it; §5 has a small
             self-contained fallback so the TIP is real even if that file is
             absent). Measured against the authored fleet that gives:
             a 1.5 t great white at 8 m/s puts 4.5 kN.m into a kayak whose
             whole righting moment is 0.04 — it goes over — and 12.6 into a
             speedboat that rights itself with 14.1, so it rocks hard and
             needs two or three passes. A 30 t megalodon at 10 m/s puts 630
             into a cruiser that rights with 220. Nobody typed any of that.

   FLAG: none. Git is the undo (CLAUDE.md).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const craft = [];
  const AUDIT = {
    spawned: 0, eaten: 0, tipped: 0, sunk: 0, holed: 0, overboard: 0,
    biggestEatenM: 0, rams: 0, bites: 0,
  };

  function num(v, d) { return Number.isFinite(+v) ? +v : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function MH() { return CBZ.marineHulls || null; }
  function seaY(x, z) {
    if (typeof CBZ.citySeaHeightAt === "function") { try { return CBZ.citySeaHeightAt(x, z); } catch (e) {} }
    return -0.48;
  }
  function splash(x, z, p) {
    if (typeof CBZ.waterSplashAt !== "function") return;
    try { CBZ.waterSplashAt(x, seaY(x, z), z, clamp(p, 0.4, 4)); } catch (e) {}
  }
  // A deterministic 0..1 off a couple of numbers — this file never draws from
  // Math.random, because where a boat is and how it breaks is gameplay state.
  function h01(a, b) {
    if (typeof CBZ.hash01 === "function") { try { return CBZ.hash01(a, b, 0x5eac7a); } catch (e) {} }
    const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

  /* ---- THE PARENT. Island modes hang everything off the disaster arena's
     root (that is what survivorbot.js and the arena's own dressing use); the
     city hangs it off the city arena. Either way it is the group the world is
     reset by, so a craft never outlives its match. */
  function sceneRoot() {
    const A = (CBZ.surv && CBZ.surv.arena) || null;
    if (A && A.root) return A.root;
    if (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) return CBZ.city.arena.root;
    return CBZ.scene || null;
  }

  // ============================================================
  //  §1. THE FLEET ROWS THIS FILE NEEDS AND WHERE THEY COME FROM
  // ============================================================
  /* water_hulls.js registers every row a beach fleet is made of — the sea
     kayak, the PWC and the centre console included — and every spec it
     registers carries a derived `stab` (gm / phiV / freeboard / swampT /
     crew / seats). This file used to keep a second copy of three of those
     rows and a table of stability defaults "in case the real builder had not
     landed"; it has, so the copies are gone. A key the registry does not
     know spawns as a dinghy rather than as a scaled stand-in. */
  function stabOf(spec) {
    if (spec && spec.stab) return spec.stab;
    // derived, so an unknown hull is never a special case: a stiffer boat is a
    // beamier one, and freeboard scales with length.
    const loa = num(spec && spec.loa, 6), beam = num(spec && spec.beam, 2);
    return {
      gm: clamp(beam * 0.22, 0.05, 3),
      phiV: clamp(0.6 + beam * 0.16, 0.7, 2.1),
      freeboard: clamp(loa * 0.09, 0.2, 2.4),
      swampT: clamp(loa * 2.4, 2, 999),
      crew: Math.max(1, Math.round(loa * 0.55)),
    };
  }
  CBZ.hullStabSpec = stabOf;        // read by the rules and by tools

  // ============================================================
  //  §2. SPAWN / DESPAWN
  // ============================================================
  /* ---- THE BERTHS: where each body is, and whether it sits or stands -----
     water_hulls' stab.seats are PELVIS points (deriveSeats says so, and the
     authored rows agree — a speedboat's bucket is 0.70 over a 0.24 sole). A
     survivor bot's `pos` is its FEET (survivorbot.js: pos IS group.position,
     planted on floorAt). Writing a pelvis into the feet hung every crewman
     half a metre over his bench — the hovering people. So a berth carries
     both numbers: the sole under the seat, where the feet go, and the cushion
     height over it, which character.js's chair solve turns into hips ON the
     bench and soles ON the sole.

     STAND OR SIT is the seat's own height over its sole. A thwart or a bucket
     is 0.3-0.5 m up and you sit on it; a leaning post or a casting deck is
     0.6 m+ and nobody sits on those, they stand at them. On a hull with real
     deck space (10 m+) every other derived berth is a deck hand on his feet,
     because six men sat in a row down the centreline of a 14 m cruiser read
     as a bus. */
  const STAND_OVER_SOLE = 0.60;
  function berthsFor(spec) {
    const st = stabOf(spec);
    const loa = num(spec && spec.loa, 6);
    const deckY = num(spec && spec.deckY, loa * 0.09);
    let seats = (st && st.seats && st.seats.length) ? st.seats : null;
    if (!seats) {
      // no authored or derived seats at all: down the centreline on the sole
      const n = Math.max(1, Math.min(14, num(st && st.crew, 2)));
      seats = [];
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        seats.push({ x: 0, y: deckY + 0.44, z: loa * (0.28 - 0.52 * t), yaw: 0 });
      }
    }
    const out = [];
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      const pelvis = num(s.y, deckY + 0.44);
      // the sole under this seat: the deck — or, when the pelvis sits at or
      // below the deck line (a kayak), the cockpit floor his legs are down in
      const floor = num(s.floor, Math.min(deckY, pelvis - 0.30));
      const over = pelvis - floor;
      const stand = over > STAND_OVER_SOLE || (loa >= 10 && i > 0 && (i % 2) === 1);
      out.push({
        x: num(s.x, 0), z: num(s.z, 0), yaw: num(s.yaw, 0),
        floor: floor, stand: stand,
        cushion: Math.max(0.12, over - 0.10),     // the solve puts the hips cushion + 0.10 up
        kind: (i === 0 && spec && spec.engine !== false) ? "helm" : "bench",
        vary: h01(i * 2.3 + 1, loa * 3.1),
      });
    }
    return out;
  }

  function hullMeshOf(group) {
    // Same traverse marine_predation.js:266 uses to find a body's own hull:
    // the named mesh first, then the biggest one in the group.
    let named = null, big = null, bigN = -1;
    group.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      if (!named && /hull$/i.test(o.name || "")) named = o;
      const g = o.geometry;
      if (!g.attributes || !g.attributes.position) return;
      const n = g.attributes.position.count;
      if (n > bigN) { bigN = n; big = o; }
    });
    return named || big;
  }

  /* CBZ.seaCraft.spawn(key, x, z, heading, o)
       o.crew      how many bodies aboard (clamped to the hull's own maximum)
       o.anchored  hold station on a rode instead of steaming
       o.route     [{x,z}, ...] a loop of waypoints for a boat under way
       o.speed     m/s target under way (default the spec's cruise)
       o.job       a helm brain from §3b (paddle carve fish troll dive transit
                   sail liner moor) — the boat then drives itself
       o.band      {cx, cz, r0, r1, shore} the ring of water the job works in
       o.seed      a number that makes this hull's choices its own */
  function spawn(key, x, z, heading, o) {
    o = o || {};
    const R = MH();
    if (!R) return null;
    const builtKey = R.get(key) ? key : "dinghy";
    const spec = R.spec(builtKey);
    if (!spec) return null;
    let group = null;
    try { group = R.build(builtKey); } catch (e) { group = null; }
    if (!group) return null;
    const root = sceneRoot();
    if (!root) return null;
    group.position.set(x, seaY(x, z) + num(spec.rideAbove, 0.06), z);
    group.rotation.set(0, num(heading, 0), 0);
    root.add(group);

    const rec = {
      kind: "craft", key: key, detailStyle: builtKey,
      group: group, pos: group.position, heading: num(heading, 0),
      v: 0, vx: 0, vz: 0, _planing: 0, _yawRate: 0, _pitch: 0, _roll: 0, _trim: 0,
      _hullSpec: spec, _seaCraft: true,
      _playerCarFeel: R.feel ? R.feel(builtKey) : { marine: true, hull: builtKey },
      crew: [], anchored: !!o.anchored,
      anchor: { x: x, z: z },
      route: Array.isArray(o.route) && o.route.length ? o.route.slice() : null,
      routeI: 0, speed: num(o.speed, spec.cruiseMs * 0.55),
      dead: false, engineDead: false,
      hp: 120 + num(spec.massT, 1) * 40,
      maxHp: 120 + num(spec.massT, 1) * 40,
      ai: true, player: false,
      _hullMesh: hullMeshOf(group),
      _heel: 0, _heelV: 0, _capsized: false, _swamp: 0, _holed: false,
      _sinking: false, _sinkT: 0, _engulf: null,
      _seats: berthsFor(spec), _ramCd: 0,
      jobKind: (o.job && JOBS[o.job]) ? o.job : null,
      band: o.band || null,
      _seed: num(o.seed, AUDIT.spawned * 3.7 + 1),
      mood: "calm", moodT: 0, alarm: 0, seen: null,
      wp: null, holdT: 0, lines: false,
      _hadCrew: false, _lost: [], _far: false,
    };
    craft.push(rec);
    AUDIT.spawned++;
    const want = Math.min(num(o.crew, 0), rec._seats.length);
    for (let i = 0; i < want; i++) {
      const b = boardOne(rec, i);
      if (b) rec.crew.push(b);
    }
    rec._hadCrew = rec.crew.length > 0;
    if (rec.jobKind && rec.band) startJob(rec);
    else rec.jobKind = null;
    return rec;
  }

  /* A body aboard. In island modes that is a survivor bot — the same crowd the
     shark already eats off the beach (CBZ.bots), so a shark that reaches over
     the gunwale takes a man off a boat with no new code at all. In the city
     the crew are cityPeds, and only when a spawner exists to make one. */
  function boardOne(rec, i) {
    const seat = rec._seats[i];
    if (!seat) return null;
    rec.group.updateMatrixWorld(true);
    const p = berthWorld(rec, seat, _tmpV);
    let b = null;
    if (CBZ.islandModeOn && CBZ.islandModeOn(CBZ.game && CBZ.game.mode) && CBZ.spawnSurvivorBotAt) {
      try { b = CBZ.spawnSurvivorBotAt(p.x, p.z); } catch (e) { b = null; }
    } else if (typeof CBZ.citySpawnPedAt === "function") {
      try { b = CBZ.citySpawnPedAt(p.x, p.z); } catch (e) { b = null; }
    }
    if (!b || !b.group) return null;
    b._aboard = rec;
    b._aboardSeat = i;
    if (b.pause != null) b.pause = 1e9;
    poseAboard(b, seat);
    placeAboard(rec, b, seat);
    return b;
  }

  const _tmpV = new THREE.Vector3();
  const _tmpV2 = new THREE.Vector3();
  const _e = new THREE.Euler(0, 0, 0, "YXZ");
  const _q = new THREE.Quaternion();
  const _UP = new THREE.Vector3(0, 1, 0);
  const _ride = {};
  const _rideOpts = { heading: 0, len: 1, beam: 1 };

  // the FEET point of a berth, in world space (the hull's matrixWorld must be current)
  function berthWorld(rec, seat, out) {
    out.set(seat.x, seat.floor, seat.z);
    return out.applyMatrix4(rec.group.matrixWorld);
  }
  /* The pose a berth asks for. Seated: character.js's chair solve, fed the
     cushion height so the hips land on the bench and the soles on the sole —
     the same seatRef contract playeraircraft.js's pilot uses. Standing: the
     plain idle, feet on the deck. Cheap to call every frame: the seatRef is
     built once per berth, not per frame. */
  function poseAboard(b, seat) {
    const ch = b.char;
    if (!ch) return;
    ch.swimming = false; ch.airPose = null;
    if (seat.stand) { ch.sitting = false; ch.seatRef = null; return; }
    ch.sitting = true;
    if (!ch.seatRef || ch.seatRef._berth !== seat) {
      ch.seatRef = { cushion: seat.cushion, floorBelow: 0, kind: seat.kind, vary: seat.vary, _berth: seat };
    }
  }
  /* Put the body ON the hull this frame: feet at the berth, and the WHOLE
     attitude of the hull — heading, pitch AND roll — not just its yaw. A body
     that only turned with the boat stayed bolt upright while the deck under
     it heeled thirty degrees, which is the other half of "not on the boat". */
  function placeAboard(rec, b, seat) {
    berthWorld(rec, seat, _tmpV);
    // bodies and hulls hang off the same root in every island mode; a city
    // ped may not, so express the point in the body's own parent frame
    const P = b.group.parent;
    if (P && P !== rec.group.parent) P.worldToLocal(_tmpV);
    b.pos.x = _tmpV.x; b.pos.y = _tmpV.y; b.pos.z = _tmpV.z;
    _q.setFromAxisAngle(_UP, num(seat.yaw, 0) + num(b._lookYaw, 0)).premultiply(rec.group.quaternion);
    b.group.quaternion.copy(_q);
    if (b.target && b.target.set) b.target.set(_tmpV.x, 0, _tmpV.z);
    b.speed = 0; b.swim = false; b.wet = false;
  }
  // the flags a berth set, cleared: a body that is nobody's crew any more
  function unseat(b) {
    b._aboard = null; b._aboardSeat = null; b._overboard = null;
    b._lookYaw = 0; b._actW = 0; b._act = null;
    if (b.group) b.group.visible = true;
    if (b.char) { b.char.sitting = false; b.char.seatRef = null; b.char.airPose = null; }
    if (b.group) b.group.rotation.set(0, b.group.rotation.y, 0);
    if (b.pause != null && b.pause > 1e6) b.pause = 0;
  }

  function despawn(rec) {
    if (!rec) return;
    releaseCrew(rec);
    if (rec._floatH) { try { rec._floatH.release(); } catch (e) {} rec._floatH = null; }
    if (rec.group && rec.group.parent) rec.group.parent.remove(rec.group);
    const i = craft.indexOf(rec);
    if (i >= 0) craft.splice(i, 1);
    rec.dead = true;
  }
  function despawnAll() { dropFalling(); while (craft.length) despawn(craft[craft.length - 1]); }

  // ============================================================
  //  §3. THE MOVER — one autopilot, one ride, one wake
  // ============================================================
  function routePoint(rec) {
    if (!rec.route || !rec.route.length) return null;
    return rec.route[rec.routeI % rec.route.length];
  }

  function moveCruising(rec, dt) {
    const wp = routePoint(rec);
    if (!wp) return;
    let d = -1;
    if (typeof CBZ.marineAutopilot === "function") {
      try { d = CBZ.marineAutopilot(rec, dt, { x: wp.x, z: wp.z, speed: rec.speed, arrive: 8 }); } catch (e) { d = -1; }
    }
    if (d < 0) {
      // The autopilot refused (no water under it, no spec, the file absent):
      // hold way on the current heading rather than freezing mid-ocean.
      const s = rec.v = Math.max(0, rec.v * (1 - dt * 0.6));
      rec.pos.x += Math.sin(rec.heading) * s * dt;
      rec.pos.z += Math.cos(rec.heading) * s * dt;
      d = Math.hypot(wp.x - rec.pos.x, wp.z - rec.pos.z);
    }
    if (d >= 0 && d < 10) rec.routeI = (rec.routeI + 1) % rec.route.length;
  }

  function moveAnchored(rec, dt) {
    /* A REAL ANCHOR RODE: the hull drifts on the current and is restrained by
       the scope, so it swings round the anchor instead of being pinned to a
       coordinate. That swing is what makes a line of anchored skiffs read as
       boats rather than as props. */
    const spec = rec._hullSpec;
    let cx = 0, cz = 0;
    const wf = CBZ.waterField;
    if (wf && typeof wf.currentAt === "function") {
      try { const c = wf.currentAt(rec.pos.x, rec.pos.z); if (c) { cx = num(c.x, 0); cz = num(c.z, 0); } } catch (e) {}
    }
    if (!cx && !cz) {
      // no current field: a slow tidal set derived from the clock, so every
      // anchored hull in the bay swings together the way they really do
      const t = (typeof CBZ.waterClock === "function" ? CBZ.waterClock() : (Date.now() * 0.001)) * 0.06;
      cx = Math.cos(t) * 0.22; cz = Math.sin(t * 0.83) * 0.22;
    }
    rec.pos.x += cx * dt; rec.pos.z += cz * dt;
    const scope = num(spec && spec.loa, 6) * 1.2;
    const dx = rec.pos.x - rec.anchor.x, dz = rec.pos.z - rec.anchor.z;
    const r = Math.hypot(dx, dz);
    if (r > scope) {
      rec.pos.x = rec.anchor.x + dx / r * scope;
      rec.pos.z = rec.anchor.z + dz / r * scope;
    }
    // she lies to her rode: bow into the set
    if (r > 0.4) {
      const want = Math.atan2(dx, dz);
      let err = want - rec.heading;
      while (err > Math.PI) err -= Math.PI * 2;
      while (err < -Math.PI) err += Math.PI * 2;
      rec.heading += err * Math.min(1, dt * 0.45);
    }
    rec.v = 0; rec.vx = 0; rec.vz = 0;
  }

  function moveDrifting(rec, dt) {
    rec.v *= Math.max(0, 1 - dt * 0.8);
    rec.pos.x += rec.vx * dt; rec.pos.z += rec.vz * dt;
    rec.vx *= Math.max(0, 1 - dt * 0.9); rec.vz *= Math.max(0, 1 - dt * 0.9);
    if (typeof CBZ.marineShoreBlock === "function") {
      try { CBZ.marineShoreBlock(rec, rec._hullSpec, dt); } catch (e) {}
    }
  }

  // ============================================================
  //  §3b. THE HELM — somebody is driving every one of these boats
  // ============================================================
  /* A boat on a loop of six waypoints round the island reads as a toy on a
     rail, however good the hull is: it never stops, never speeds up, never
     goes anywhere and never looks at anything. People on the water have a
     REASON to be where they are, and the reason is the shape of the track:

       paddle   kayaks / boards: short legs along the shore band, a rest, on
       carve    jetskis: fast legs with hard turns between them, then a stop
       fish     anchor on a mark with lines over the side, later up-anchor and
                try another mark
       troll    sportfishers: slow lanes back and forth over a ledge, lines
                trailing astern, U-turns at the ends; then a new ledge
       dive     drift over a site on the current, motor back up-current
       transit  cruisers and runabouts: go somewhere, slow down, stop a
                while, go somewhere else
       sail     keelboats: a destination and a WIND. Inside the no-go cone
                she beats on alternate tacks; she heels to leeward
       liner    the far traffic: long straight passages on the horizon
       moor     the big yacht: anchored, swinging, almost never moves

     Every leg is steered by the ONE autopilot (CBZ.marineAutopilot), so a
     brain here only ever chooses WHERE and HOW FAST. Speed-up and slow-down
     are the hull's own thrust and drag; the brake is a stopping-distance
     ramp in front of every mark a boat means to stop at.

     THE BAND. The mode hands each hull a ring (cx, cz, r0..r1): the water it
     works in. Every mark is picked inside it and proved deep enough for her
     draft, so a leg can never be planned onto a sandbar. */
  function depthHere(x, z) {
    if (typeof CBZ.cityWaterDepthAt === "function") { try { return +CBZ.cityWaterDepthAt(x, z) || 0; } catch (e) {} }
    if (typeof CBZ.survFloodDepthMeanAt === "function") { try { return Math.max(0, +CBZ.survFloodDepthMeanAt(x, z) || 0); } catch (e) {} }
    return 6;
  }
  function needOf(rec) { return Math.max(num(rec._hullSpec && rec._hullSpec.draft, 0.5) + 0.7, 1.4); }
  function wrapA(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
  function rnd(rec, k) { rec._rn = (rec._rn || 0) + 1; return h01(rec._seed * 1.37 + rec._rn * 7.91 + k, rec._seed + rec._rn * 0.61); }
  function bandAng(rec, x, z) { const B = rec.band; return Math.atan2(z - B.cz, x - B.cx); }
  function bandRad(rec, x, z) { const B = rec.band; return Math.hypot(x - B.cx, z - B.cz); }
  function bandPt(rec, a, r) { const B = rec.band; return { x: B.cx + Math.cos(a) * r, z: B.cz + Math.sin(a) * r }; }
  // deep enough here AND at the middle of the leg from where she is now
  function legOk(rec, p) {
    const need = needOf(rec);
    if (depthHere(p.x, p.z) < need) return false;
    const mx = (p.x + rec.pos.x) * 0.5, mz = (p.z + rec.pos.z) * 0.5;
    return depthHere(mx, mz) >= need * 0.8;
  }
  /* A mark in the band, near (a, r): tried as asked, then walked outward in
     bearing and radius until the water is deep enough. null = keep the old. */
  function markNear(rec, a, r) {
    const B = rec.band;
    for (let k = 0; k < 10; k++) {
      const s = (k & 1) ? 1 : -1, n = (k + 1) >> 1;
      const rr = clamp(r + n * 9 * ((k & 2) ? 1 : 0.4), B.r0, B.r1 + 20);
      const p = bandPt(rec, a + s * n * (14 / Math.max(40, r)), rr);
      if (legOk(rec, p)) return p;
    }
    return null;
  }
  function setLeg(rec, p, speed, o) {
    o = o || {};
    rec.wp = p; rec.wpSpeed = speed;
    rec.wpBrake = o.brake !== false;
    rec.wpArrive = num(o.arrive, 6);
    rec.legT = 0;
    const d = Math.hypot(p.x - rec.pos.x, p.z - rec.pos.z);
    rec.legMax = 25 + d / Math.max(0.6, speed) * 2.5;
  }
  function hold(rec, sec, mode) {
    rec.holdT = sec; rec.holdMode = mode;
    rec.wp = null;
    if (mode === "anchor") { rec.anchored = true; rec.anchor.x = rec.pos.x; rec.anchor.z = rec.pos.z; }
  }
  function cruiseOf(rec) { return num(rec._hullSpec && rec._hullSpec.cruiseMs, 6); }
  function topOf(rec) { return num(rec._hullSpec && rec._hullSpec.topMs, 8); }

  /* THE JOBS. start(rec) sets her up where she is; leg(rec) plans the next
     leg; arrive(rec) says what she does when she gets there. */
  const JOBS = {
    paddle: {
      start(rec) { rec.jd = { dir: rnd(rec, 1) < 0.5 ? -1 : 1 }; if (rnd(rec, 2) < 0.4) hold(rec, 3 + rnd(rec, 3) * 10, "drift"); },
      leg(rec) {
        const a = bandAng(rec, rec.pos.x, rec.pos.z), r = bandRad(rec, rec.pos.x, rec.pos.z);
        const step = 22 + rnd(rec, 4) * 40;
        const B = rec.band;
        const rr = clamp(r + (rnd(rec, 5) - 0.5) * 18, B.r0, B.r1);
        const p = markNear(rec, a + rec.jd.dir * step / Math.max(30, r), rr);
        if (!p) { rec.jd.dir *= -1; hold(rec, 4, "drift"); return; }
        setLeg(rec, p, cruiseOf(rec) * (0.75 + rnd(rec, 6) * 0.3), { arrive: 3 });
      },
      arrive(rec) {
        if (rnd(rec, 7) < 0.15) rec.jd.dir *= -1;
        if (rnd(rec, 8) < 0.35) hold(rec, 5 + rnd(rec, 9) * 12, "drift");
      },
    },
    carve: {
      start(rec) { rec.jd = { legs: 0, stopAt: 3 + Math.floor(rnd(rec, 1) * 4) }; },
      leg(rec) {
        const J = rec.jd, B = rec.band;
        J.legs++;
        const stop = J.legs >= J.stopAt;
        for (let k = 0; k < 6; k++) {
          const sgn = ((k + (rnd(rec, 2) < 0.5 ? 0 : 1)) & 1) ? 1 : -1;
          const turn = sgn * (0.7 + rnd(rec, 3) * 1.7);
          const h = rec.heading + turn;
          const d = 35 + rnd(rec, 4) * 60;
          let x = rec.pos.x + Math.sin(h) * d, z = rec.pos.z + Math.cos(h) * d;
          // out of the band: fold the point back across it
          const r = bandRad(rec, x, z);
          if (r < B.r0 || r > B.r1) {
            const a = bandAng(rec, x, z), rr = clamp(r < B.r0 ? B.r0 + (B.r0 - r) : B.r1 - (r - B.r1), B.r0, B.r1);
            const p = bandPt(rec, a, rr); x = p.x; z = p.z;
          }
          if (legOk(rec, { x: x, z: z })) {
            if (stop) { J.legs = 0; J.stopAt = 3 + Math.floor(rnd(rec, 5) * 4); }
            setLeg(rec, { x: x, z: z }, topOf(rec) * (0.62 + rnd(rec, 6) * 0.3), { brake: stop, arrive: stop ? 4 : 11 });
            rec.jd.stopping = stop;
            return;
          }
        }
        hold(rec, 3, "drift");
      },
      arrive(rec) { if (rec.jd.stopping) hold(rec, 4 + rnd(rec, 7) * 7, "drift"); },
    },
    fish: {
      start(rec) {
        rec.jd = { big: false };
        hold(rec, (0.25 + rnd(rec, 1) * 0.75) * (100 + rnd(rec, 2) * 160), "anchor");
        rec.lines = true;
      },
      leg(rec) {
        rec.lines = false;
        const a = bandAng(rec, rec.pos.x, rec.pos.z), r = bandRad(rec, rec.pos.x, rec.pos.z);
        const B = rec.band;
        const d = 60 + rnd(rec, 3) * 90;
        const p = markNear(rec, a + (rnd(rec, 4) < 0.5 ? -1 : 1) * d / Math.max(40, r), clamp(r + (rnd(rec, 5) - 0.5) * 40, B.r0, B.r1));
        if (!p) { hold(rec, 60, "anchor"); rec.lines = true; return; }
        setLeg(rec, p, cruiseOf(rec) * 0.6, { arrive: 5 });
      },
      arrive(rec) { hold(rec, 100 + rnd(rec, 6) * 160, "anchor"); rec.lines = true; },
    },
    moor: {
      start(rec) { rec.jd = {}; hold(rec, 400 + rnd(rec, 1) * 500, "anchor"); },
      leg(rec) { JOBS.transit.leg(rec); if (rec.wp) rec.wpSpeed = cruiseOf(rec) * 0.45; },
      arrive(rec) { hold(rec, 500 + rnd(rec, 2) * 500, "anchor"); },
    },
    troll: {
      start(rec) {
        const a = bandAng(rec, rec.pos.x, rec.pos.z);
        // a lane roughly along the bottom contour (tangent to the ring), 110-200 m
        const ax = a + Math.PI / 2 + (rnd(rec, 1) - 0.5) * 0.5;
        const L = 110 + rnd(rec, 2) * 90;
        rec.jd = { cx: rec.pos.x, cz: rec.pos.z, ux: Math.cos(ax), uz: Math.sin(ax), L: L, end: 1, pass: 0,
          passes: 4 + Math.floor(rnd(rec, 3) * 5), relocating: false };
        rec.lines = true;
      },
      leg(rec) {
        const J = rec.jd;
        if (J.pass >= J.passes) {
          // new ledge: run to it at cruise with the lines in
          J.relocating = true; rec.lines = false;
          const a = bandAng(rec, rec.pos.x, rec.pos.z), r = bandRad(rec, rec.pos.x, rec.pos.z);
          const p = markNear(rec, a + (rnd(rec, 4) < 0.5 ? -1 : 1) * (150 + rnd(rec, 5) * 120) / Math.max(60, r),
            clamp(r + (rnd(rec, 6) - 0.5) * 60, rec.band.r0, rec.band.r1));
          if (p) { setLeg(rec, p, cruiseOf(rec) * 0.75, { arrive: 10 }); return; }
          J.pass = 0;
        }
        J.relocating = false; rec.lines = true;
        J.end = -J.end; J.pass++;
        // each pass slides a boat-width over, the way you comb a ledge
        const off = ((J.pass % 3) - 1) * 14;
        const nx = -J.uz, nz = J.ux;
        let p = { x: J.cx + J.ux * J.L * 0.5 * J.end + nx * off, z: J.cz + J.uz * J.L * 0.5 * J.end + nz * off };
        if (!legOk(rec, p)) {
          p = { x: J.cx + J.ux * J.L * 0.25 * J.end, z: J.cz + J.uz * J.L * 0.25 * J.end };
          if (!legOk(rec, p)) { J.pass = J.passes; hold(rec, 3, "drift"); return; }
        }
        // trolling speed is 6-8 knots whatever the boat, never her cruise
        setLeg(rec, p, Math.min(cruiseOf(rec), 3.1 + rnd(rec, 7) * 0.9), { brake: false, arrive: 16 });
      },
      arrive(rec) {
        const J = rec.jd;
        if (J.relocating) {
          J.cx = rec.pos.x; J.cz = rec.pos.z; J.pass = 0; J.passes = 4 + Math.floor(rnd(rec, 8) * 5);
          J.relocating = false;
          hold(rec, 4 + rnd(rec, 9) * 6, "drift");       // set the spread
        }
      },
    },
    dive: {
      start(rec) { rec.jd = { sx: rec.pos.x, sz: rec.pos.z, cycles: 0 }; hold(rec, 25 + rnd(rec, 1) * 60, "set"); },
      leg(rec) {
        const J = rec.jd;
        J.cycles++;
        if (J.cycles > 3) {
          J.cycles = 0;
          const a = bandAng(rec, rec.pos.x, rec.pos.z), r = bandRad(rec, rec.pos.x, rec.pos.z);
          const p = markNear(rec, a + (rnd(rec, 2) < 0.5 ? -1 : 1) * (80 + rnd(rec, 3) * 70) / Math.max(40, r), r);
          if (p) { J.sx = p.x; J.sz = p.z; }
        }
        const p = { x: J.sx, z: J.sz };
        if (!legOk(rec, p)) { hold(rec, 30, "set"); return; }
        setLeg(rec, p, Math.min(cruiseOf(rec) * 0.4, 3.2), { arrive: 5 });
      },
      arrive(rec) { hold(rec, 40 + rnd(rec, 4) * 50, "set"); },
    },
    transit: {
      start(rec) { rec.jd = { out: rnd(rec, 1) < 0.5 }; if (rnd(rec, 2) < 0.3) hold(rec, 5 + rnd(rec, 3) * 25, "drift"); },
      leg(rec) {
        const J = rec.jd, B = rec.band;
        J.out = !J.out;
        const a = bandAng(rec, rec.pos.x, rec.pos.z);
        const r = J.out ? B.r0 + (B.r1 - B.r0) * (0.6 + rnd(rec, 4) * 0.4) : B.r0 + (B.r1 - B.r0) * rnd(rec, 5) * 0.4;
        let p = null;
        for (let k = 0; k < 4 && !p; k++) {
          const da = (rnd(rec, 6) < 0.5 ? -1 : 1) * (0.22 + rnd(rec, 7) * 0.4) / (1 + k * 0.6);
          p = markNear(rec, a + da, r);
        }
        if (!p) { hold(rec, 8, "drift"); return; }
        setLeg(rec, p, cruiseOf(rec) * (0.55 + rnd(rec, 8) * 0.3), { arrive: 8 });
      },
      arrive(rec) { if (rnd(rec, 9) < 0.55) hold(rec, 12 + rnd(rec, 10) * 40, rnd(rec, 11) < 0.5 ? "anchor" : "drift"); },
    },
    sail: {
      start(rec) { rec.jd = { tack: rnd(rec, 1) < 0.5 ? -1 : 1, tackT: 0 }; },
      leg(rec) {
        const B = rec.band;
        const a = bandAng(rec, rec.pos.x, rec.pos.z);
        let p = null;
        for (let k = 0; k < 5 && !p; k++) {
          const da = (rnd(rec, 2) < 0.5 ? -1 : 1) * (0.3 + rnd(rec, 3) * 0.45);
          p = markNear(rec, a + da, B.r0 + (B.r1 - B.r0) * rnd(rec, 4));
        }
        if (!p) { hold(rec, 10, "drift"); return; }
        setLeg(rec, p, 0, { brake: false, arrive: 25 });
      },
      arrive(rec) { if (rnd(rec, 5) < 0.25) hold(rec, 20 + rnd(rec, 6) * 40, "drift"); },
    },
    liner: {
      start(rec) { rec.jd = { dir: rnd(rec, 1) < 0.5 ? -1 : 1 }; },
      leg(rec) {
        const B = rec.band;
        const a = bandAng(rec, rec.pos.x, rec.pos.z);
        const p = markNear(rec, a + rec.jd.dir * (0.45 + rnd(rec, 2) * 0.3), B.r0 + (B.r1 - B.r0) * rnd(rec, 3));
        if (!p) { rec.jd.dir *= -1; hold(rec, 5, "drift"); return; }
        setLeg(rec, p, cruiseOf(rec) * 0.6, { brake: false, arrive: 25 });
      },
      arrive() {},
    },
  };
  function startJob(rec) {
    rec.wp = null; rec.holdT = 0; rec.lines = false;
    const J = JOBS[rec.jobKind];
    if (J) J.start(rec);
  }

  /* THE WIND. The weather owner's one vector (weather.js: "never a private
     bearing"); a still day still has a direction, taken from the match. */
  const _wind = { x: 0.7, z: 0.7, speed: 5 };
  function windNow() {
    let wx = 0, wz = 0, sp = 0;
    if (typeof CBZ.weatherWind === "function") {
      try { const w = CBZ.weatherWind(); wx = num(w.x, 0); wz = num(w.z, 0); sp = num(w.speed, 0); } catch (e) {}
    }
    const m = Math.hypot(wx, wz);
    if (m < 1e-3) {
      const a = h01(CBZ.sharkSim ? num(CBZ.sharkSim.match, 1) : 1, 91.7) * Math.PI * 2;
      wx = Math.cos(a); wz = Math.sin(a);
    } else { wx /= m; wz /= m; }
    _wind.x = wx; _wind.z = wz; _wind.speed = Math.max(4, sp);
    return _wind;
  }
  /* A keelboat's polar, reduced to one curve of the angle off the true wind:
     nothing inside 40 degrees, about 60% close-hauled, best on a beam reach,
     a little less dead downwind. */
  const NOGO = 0.72, CLOSE = 0.8;
  function polar(twa) {
    const t = Math.abs(twa);
    if (t < NOGO) return 0.12;
    if (t < 1.6) return 0.6 + 0.4 * (t - NOGO) / (1.6 - NOGO);
    return 1 - 0.22 * (t - 1.6) / (Math.PI - 1.6);
  }
  const _cmd = { x: 0, z: 0, speed: 0, arrive: 0 };
  function steer(rec, dt, x, z, speed, arrive) {
    _cmd.x = x; _cmd.z = z; _cmd.speed = speed; _cmd.arrive = arrive;
    let d = -1;
    if (typeof CBZ.marineAutopilot === "function") {
      try { d = CBZ.marineAutopilot(rec, dt, _cmd); } catch (e) { d = -1; }
    }
    if (d < 0) {
      const s = rec.v = Math.max(0, rec.v * (1 - dt * 0.6));
      rec.pos.x += Math.sin(rec.heading) * s * dt;
      rec.pos.z += Math.cos(rec.heading) * s * dt;
      d = Math.hypot(x - rec.pos.x, z - rec.pos.z);
    } else rec._apWake = true;           // the autopilot already threw this frame's wake
    return d;
  }
  // sailing: the course a boat can actually hold toward (x, z) with this wind
  function sailCourse(rec, x, z, dt) {
    const W = windNow();
    const up = Math.atan2(-W.x, -W.z);            // the bearing the wind comes FROM
    const want = Math.atan2(x - rec.pos.x, z - rec.pos.z);
    const twa = wrapA(want - up);
    const J = rec.jd;
    if (Math.abs(twa) >= CLOSE) { J.tackT = 0; return want; }
    // beating: close-hauled on the current tack, tack at the lay line, when a
    // leg has gone on too long, or when the water ahead shoals
    J.tackT += dt;
    let course = up + J.tack * CLOSE;
    const ahead = { x: rec.pos.x + Math.sin(course) * 45, z: rec.pos.z + Math.cos(course) * 45 };
    if ((twa * J.tack < -0.05 && Math.abs(twa) > 0.25) || J.tackT > 45 || depthHere(ahead.x, ahead.z) < needOf(rec)) {
      if (J.tackT > 6) { J.tack = -J.tack; J.tackT = 0; course = up + J.tack * CLOSE; }
    }
    return course;
  }
  function sailSpeed(rec, course) {
    const W = windNow();
    const up = Math.atan2(-W.x, -W.z);
    return Math.min(topOf(rec) * 1.1, 1.6 + W.speed * 0.38) * polar(wrapA(course - up));
  }
  // leeward heel from the rig: the wind across the deck, times the sail
  function sailHeel(rec, dt) {
    const W = windNow();
    const h = rec.heading;
    const toStarboard = W.x * (-Math.cos(h)) + W.z * Math.sin(h);
    const up = Math.atan2(-W.x, -W.z);
    const k = Math.sin(Math.min(Math.PI / 2, Math.abs(wrapA(h - up))));
    const want = clamp(toStarboard * k * (0.10 + W.speed * 0.012), -0.24, 0.24);
    // composed in ride(), never folded into _roll: the autopilot damps _roll
    // toward its own turn heel every frame and an added term would snowball
    rec._sailHeel = num(rec._sailHeel, 0) + (want - num(rec._sailHeel, 0)) * Math.min(1, dt * 0.8);
    rec._sailFrame = true;
  }

  function moveSet(rec, dt) {
    // drifting on the set with the engine off: the current, slowly beam-on
    let cx = 0, cz = 0;
    const wf = CBZ.waterField;
    if (wf && typeof wf.currentAt === "function") {
      try { const c = wf.currentAt(rec.pos.x, rec.pos.z); if (c) { cx = num(c.x, 0); cz = num(c.z, 0); } } catch (e) {}
    }
    if (!cx && !cz) { const W = windNow(); cx = W.x * 0.28; cz = W.z * 0.28; }
    rec.v *= Math.max(0, 1 - dt * 0.5);
    rec.pos.x += (cx + Math.sin(rec.heading) * rec.v) * dt;
    rec.pos.z += (cz + Math.cos(rec.heading) * rec.v) * dt;
    const beam = Math.atan2(cx, cz) + Math.PI / 2;
    rec.heading += wrapA(beam - rec.heading) * Math.min(1, dt * 0.05);
    if (typeof CBZ.marineShoreBlock === "function") { try { CBZ.marineShoreBlock(rec, rec._hullSpec, dt); } catch (e) {} }
  }

  function helmTick(rec, dt) {
    rec._apWake = false;
    const S = rec.mood;
    // nobody at the helm: the kill cord is out and she drifts
    if (!rec.crew.length && rec._hadCrew) {
      rec.anchored = false; rec.lines = false;
      moveDrifting(rec, dt);
      return;
    }
    if (S === "flee") { fleeTick(rec, dt); return; }
    if (S === "watch") {
      // a big hull stops to look: throttle off, drifting, everyone at the rail
      if (rec.anchored) moveAnchored(rec, dt); else moveDrifting(rec, dt);
      rec.moodT -= dt;
      if (rec.moodT <= 0) { rec.mood = "calm"; if (rec.wp) rec.legT = 0; }
      return;
    }
    if (rec._rescue && rescueTick(rec, dt)) return;
    if (rec.holdT > 0) {
      rec.holdT -= dt;
      if (rec.holdMode === "anchor") moveAnchored(rec, dt);
      else if (rec.holdMode === "set") moveSet(rec, dt);
      else moveDrifting(rec, dt);
      if (rec.holdT <= 0) { rec.anchored = false; rec.holdT = 0; rec.wp = null; }
      return;
    }
    const J = JOBS[rec.jobKind];
    if (!J) return;
    if (!rec.wp) { J.leg(rec); if (!rec.wp) return; }
    rec.legT += dt;
    const wp = rec.wp;
    let d;
    if (rec.jobKind === "sail") {
      const course = sailCourse(rec, wp.x, wp.z, dt);
      const sp = sailSpeed(rec, course);
      d = steer(rec, dt, rec.pos.x + Math.sin(course) * 60, rec.pos.z + Math.cos(course) * 60, sp, 0);
      d = Math.hypot(wp.x - rec.pos.x, wp.z - rec.pos.z);
      sailHeel(rec, dt);
    } else {
      const d0 = Math.hypot(wp.x - rec.pos.x, wp.z - rec.pos.z);
      let sp = rec.wpSpeed;
      if (rec.wpBrake) {
        // a stopping distance, not a wall: v^2 = 2 a s with a hull-sized a
        const a = clamp(3.2 / Math.sqrt(Math.max(1, num(rec._hullSpec.loa, 6))), 0.35, 1.6);
        sp = Math.min(sp, Math.sqrt(2 * a * Math.max(0, d0 - rec.wpArrive * 0.6)) + 0.25);
      }
      d = steer(rec, dt, wp.x, wp.z, sp, rec.wpBrake ? rec.wpArrive * 0.5 : 0.1);
    }
    if (d < rec.wpArrive || rec.legT > rec.legMax) {
      rec.wp = null;
      J.arrive(rec);
    }
  }

  // ============================================================
  //  §3c. A FIN — who sees the shark, and what they do about it
  // ============================================================
  /* One small list of things that eat people (the ridden shark always, and
     anything aquatic that charges and bites — survivorbot.js draws the same
     line at danger 0.5), rebuilt a few times a second; each hull asks it for
     the nearest one it can SEE. A fin at the surface is seen a long way off
     and further the bigger the animal; a shadow deep under the hull only up
     close. The crew see it before anyone does anything, which is the point:
     the reaction is theirs. */
  const threats = [];
  let threatT = 0;
  function refreshThreats() {
    threats.length = 0;
    const list = CBZ.cityWildlife;
    if (!list) return;
    const ridden = CBZ.sharkSim && CBZ.sharkSim.shark;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || a.dead || !a.pos || !a.species || !a.species.aquatic) continue;
      if (a !== ridden && !(+a.species.danger >= 0.5)) continue;
      threats.push(a);
    }
  }
  function seeRange(a) {
    const L = Math.max(1.5, lenOf(a) || 3);
    const under = seaY(a.pos.x, a.pos.z) - num(a.pos.y, 0);
    const R = 16 + L * 4.5;
    // the dorsal breaks the surface only when she is about a fin's height
    // down; deeper than that it is a shadow, seen from almost on top of it
    return under < 0.35 + L * 0.13 ? R : R * 0.35;
  }
  function spotTick() {
    refreshThreats();
    for (let i = 0; i < craft.length; i++) {
      const rec = craft[i];
      if (rec.dead || rec._capsized || rec._sinking || rec._engulf || !rec.crew.length) continue;
      let best = null, bd = 1e9;
      for (let k = 0; k < threats.length; k++) {
        const a = threats[k];
        const d = Math.hypot(a.pos.x - rec.pos.x, a.pos.z - rec.pos.z);
        if (d < seeRange(a) && d < bd) { bd = d; best = a; }
      }
      if (best) alarm(rec, best.pos.x, best.pos.z, false, best, bd, seeRange(best));
    }
  }
  /* alarm(rec, x, z, attacked): she has seen it. Small and open boats run;
     a big hull that has only SEEN a fin stops to look (everyone to the rail,
     pointing) and runs only once it is attacked or the thing comes close. */
  function alarm(rec, x, z, attacked, who, dist, range) {
    if (rec.dead || rec._capsized || rec._sinking || rec._engulf) return;
    rec.seen = rec.seen || { x: 0, z: 0 };
    rec.seen.x = x; rec.seen.z = z; rec.seenT = 0;
    rec.alarm = 1;
    /* SEEN IS NOT CHASED. A fin at the edge of what they can see stops them:
       throttle off, everyone to the rail, pointing. One that comes on (within
       about half that range, or 14 m of any hull) sends the small boats
       running; a big hull holds her ground until she is actually hit. */
    const big = num(rec._hullSpec && rec._hullSpec.loa, 6) >= 12;
    const close = dist != null && (dist < 14 || (!big && range != null && dist < range * 0.55));
    if (!attacked && !close && rec.mood !== "flee") {
      rec.mood = "watch";
      rec.moodT = 10;
      return;
    }
    if (rec.mood !== "flee") {
      rec.mood = "flee"; rec.fleeT = 0; rec.fleeWp = null;
      if (rec.anchored) {
        // cut the rode and go
        rec.anchored = false; rec.holdT = 0;
        splash(rec.anchor.x, rec.anchor.z, 0.6);
      }
      rec.lines = false; rec.holdT = 0; rec._rescue = null;
      honk(rec);
    }
    rec.moodT = 18;
    rec.fleeFrom = rec.fleeFrom || { x: 0, z: 0 };
    rec.fleeFrom.x = x; rec.fleeFrom.z = z;
    rec.fleeWp = null;
  }
  function honk(rec) {
    if (!(rec._hullSpec && rec._hullSpec.engine !== false)) return;
    if (num(rec._hullSpec.loa, 0) < 5 || !CBZ.sfxAt || !CBZ.camera) return;
    const c = CBZ.camera.position;
    if (Math.hypot(c.x - rec.pos.x, c.z - rec.pos.z) > 120) return;
    try { CBZ.sfxAt("horn", rec.pos.x, rec.pos.z, { volume: 0.5 }); } catch (e) {}
  }
  /* WHERE TO RUN. Away from the thing, but a runabout from the swimming band
     runs for the beach end of its own water, not two kilometres out to sea:
     twelve headings are scored by how squarely they point away and how far
     each would leave the band she works in, and the deep ones compete. A
     paddler cannot outrun anything and makes for the sand. */
  function fleeTarget(rec) {
    const B = rec.band;
    const paddled = rec._hullSpec && rec._hullSpec.engine === false;
    let ax = rec.pos.x - rec.fleeFrom.x, az = rec.pos.z - rec.fleeFrom.z;
    const m = Math.hypot(ax, az) || 1; ax /= m; az /= m;
    if (paddled && B) {
      const a = bandAng(rec, rec.pos.x, rec.pos.z);
      return bandPt(rec, a + (ax * -Math.sin(a) + az * Math.cos(a)) * 0.05, Math.max(0, num(B.shore, B.r0 - 10)));
    }
    const need = needOf(rec);
    const L = 110;
    let best = null, bs = -1e9;
    for (let k = 0; k < 12; k++) {
      const h = k / 12 * Math.PI * 2;
      const dx = Math.sin(h), dz = Math.cos(h);
      const p = { x: rec.pos.x + dx * L, z: rec.pos.z + dz * L };
      let sc = dx * ax + dz * az;
      if (sc < -0.2) continue;
      if (B) {
        const r = bandRad(rec, p.x, p.z);
        sc -= Math.max(0, r - (B.r1 + 50)) / 80 + Math.max(0, (B.r0 - 15) - r) / 40;
      }
      if (sc <= bs) continue;
      if (depthHere(p.x, p.z) < need || depthHere(rec.pos.x + dx * L * 0.5, rec.pos.z + dz * L * 0.5) < need) continue;
      bs = sc; best = p;
    }
    if (best) return best;
    if (B) { const a = bandAng(rec, rec.pos.x, rec.pos.z); return bandPt(rec, a, bandRad(rec, rec.pos.x, rec.pos.z) + 100); }
    return { x: rec.pos.x + ax * L, z: rec.pos.z + az * L };
  }
  function fleeTick(rec, dt) {
    rec.fleeT += dt; rec.moodT -= dt;
    if (!rec.fleeWp || (rec.fleeT % 2) < dt) rec.fleeWp = fleeTarget(rec);
    const top = topOf(rec);
    const d = steer(rec, dt, rec.fleeWp.x, rec.fleeWp.z, top * 0.95, 2);
    if (rec.moodT <= 0 || d < 4) calm(rec);
  }
  function calm(rec) {
    rec.mood = "calm"; rec.moodT = 0; rec.fleeWp = null;
    startJob(rec);
    // she ran fast: coast a moment before whatever the job asks next
    if (!(rec.holdT > 0)) hold(rec, 3 + rnd(rec, 31) * 4, "drift");
    if (rec._lost && rec._lost.length) rec._rescue = true;
  }
  /* AN ALARM IN THE WATER: a boat hit, a man thrown in, a hull going into a
     mouth. Every crewed hull in earshot hears it, and the ones close enough
     to see run. */
  function alarmAt(x, z, r, attacked) {
    for (let i = 0; i < craft.length; i++) {
      const c = craft[i];
      const d = Math.hypot(c.pos.x - x, c.pos.z - z);
      if (d < r && c.crew.length) alarm(c, x, z, attacked && d < r * 0.5, null, d);
    }
  }

  /* ---- MAN OVERBOARD: swim for the boat, and the boat comes back ---------
     A body that went over the side is remembered by the hull it left. Once
     the water is quiet the boat (if anyone is still at the helm) comes back
     for him at a walking pace; whoever is in the water within reach swims
     for her, and a man who reaches the hull climbs back aboard into the
     first free seat. A man whose boat turned over or sank has nothing to
     swim to, and survivorbot's own brain takes him for the beach. */
  function freeSeat(rec) {
    for (let s = 0; s < rec._seats.length; s++) {
      let used = false;
      for (let i = 0; i < rec.crew.length; i++) if (rec.crew[i] && rec.crew[i]._aboardSeat === s) { used = true; break; }
      if (!used) return s;
    }
    return -1;
  }
  function swimmersTick(rec) {
    const L = rec._lost;
    if (!L || !L.length) return;
    const ok = !rec.dead && !rec._capsized && !rec._sinking && !rec._engulf;
    const reach = num(rec._hullSpec.beam, 2) * 0.5 + 1.4;
    for (let i = L.length - 1; i >= 0; i--) {
      const b = L[i];
      if (!b || b.dead || b._aboard || !b.swim) { if (!b || b.dead || b._aboard) L.splice(i, 1); continue; }
      const d = Math.hypot(b.pos.x - rec.pos.x, b.pos.z - rec.pos.z);
      if (!ok || d > 70) { L.splice(i, 1); continue; }
      if (b.panicT > 0 && rec.mood === "flee") continue;           // everyone is running; so is he
      if (d < reach) {
        const s = freeSeat(rec);
        if (s < 0) { L.splice(i, 1); continue; }
        L.splice(i, 1);
        b._aboard = rec; b._aboardSeat = s;
        b.swim = false; b.wet = true; b.panicT = 0;
        if (b.pause != null) b.pause = 1e9;
        rec.crew.push(b);
        poseAboard(b, rec._seats[s]);
        placeAboard(rec, b, rec._seats[s]);
        splash(b.pos.x, b.pos.z, 0.7);
        continue;
      }
      // swim for her: survivorbot follows a target leg until it gets there
      if (b.target && b.target.set) b.target.set(rec.pos.x, 0, rec.pos.z);
      b.pause = 0;
      if (b.state !== "panic") b.state = "move";
    }
    if (!L.length) rec._rescue = null;
  }
  // the boat comes back for him: slow, and stopping beside him
  function rescueTick(rec, dt) {
    const L = rec._lost;
    if (!L || !L.length || !rec.crew.length) { rec._rescue = null; return false; }
    let b = null, bd = 1e9;
    for (let i = 0; i < L.length; i++) {
      const s = L[i]; if (!s || s.dead) continue;
      const d = Math.hypot(s.pos.x - rec.pos.x, s.pos.z - rec.pos.z);
      if (d < bd) { bd = d; b = s; }
    }
    if (!b) { rec._rescue = null; return false; }
    rec.anchored = false; rec.holdT = 0; rec.lines = false;
    if (bd < 5) { moveDrifting(rec, dt); return true; }
    steer(rec, dt, b.pos.x, b.pos.z, Math.min(2.4, Math.sqrt(2 * 0.6 * Math.max(0, bd - 4)) + 0.3), 4);
    return true;
  }

  /* THE RIDE. Seat the hull on the live surface with the wave attitude, then
     compose whatever roll the stability owner has for it. water_buoyancy.js's
     own pass only ever walks cityCars, which is exactly why this exists — and
     it has to make the same three decisions that pass makes, or the shark
     sim's boats sit in the water differently from the city's:

       • PITCH SIGN. The sampler's pitch is positive when the bow's water is
         higher; in this engine bow-UP is NEGATIVE rotation.x (water_helm.js
         writes -trim, water_buoyancy.js says so in as many words). This pass
         had the sign the other way, so every hull nosed INTO each swell it
         rode up — the "boats don't sit right in the water".
       • WAVE GAIN. The spec's own seakeeping number: below 1 the hull only
         partly answers the swell (heave pulled toward mean sea level, the
         gradients damped). A 4 m kayak at 1.25 lives on every ripple; a 14 m
         cruiser at 0.55 rides through them. Ignored here, the cruiser
         pitched like the kayak.
       • LIFT. A body surfacing under a hull throws it UP (water_stability's
         "under" heave). Composed in the city pass, never here — a breach
         under a kayak rolled it without ever lifting it. */
  function ride(rec, dt) {
    const spec = rec._hullSpec;
    _rideOpts.heading = rec.heading;
    _rideOpts.len = num(spec.loa, 6);
    _rideOpts.beam = num(spec.beam, 2);
    let r = null;
    if (typeof CBZ.waterRideAt === "function") {
      try { r = CBZ.waterRideAt(rec.pos.x, rec.pos.z, _rideOpts, _ride); } catch (e) { r = null; }
    }
    let mean = r ? num(r.y, seaY(rec.pos.x, rec.pos.z)) : seaY(rec.pos.x, rec.pos.z);
    let pitchW = r ? num(r.pitch, 0) : 0;
    let rollW = r ? num(r.roll, 0) : 0;
    const wg = num(spec.waveGain, 1);
    if (wg !== 1) {
      const flat = typeof CBZ.waterSeaY === "function" ? num(CBZ.waterSeaY(), mean) : mean;
      mean = flat + (mean - flat) * wg;
      pitchW *= wg; rollW *= wg;
    }
    // a planing hull flattens out: the bow lifts and the ride stops mirroring every ripple
    const planing = clamp(num(rec._planing, 0), 0, 1);
    pitchW *= 1 - planing * 0.55; rollW *= 1 - planing * 0.55;
    const pitch = -pitchW + num(rec._pitch, 0);
    // the rig's leeward heel (§3b sailHeel), eased off when she is not sailing
    if (!rec._sailFrame && rec._sailHeel) rec._sailHeel *= Math.max(0, 1 - dt * 0.8);
    rec._sailFrame = false;
    let roll = rollW + num(rec._roll, 0) + num(rec._sailHeel, 0);
    let y = mean + num(spec.rideAbove, 0.06) * (1 - 0.55 * planing);

    // Extra roll, ride drop and lift from the stability owner (water_stability.js),
    // feature-detected: without it §5's own small heel model is the answer.
    if (typeof CBZ.hullStabTick === "function") {
      try { CBZ.hullStabTick(rec, dt); } catch (e) {}
    }
    if (typeof CBZ.hullStabRoll === "function") {
      try { roll += num(CBZ.hullStabRoll(rec), 0); } catch (e) {}
    } else {
      roll += num(rec._heel, 0);
    }
    if (typeof CBZ.hullStabDrop === "function") {
      try { y -= num(CBZ.hullStabDrop(rec), 0); } catch (e) {}
    } else if (rec._capsized) {
      const st = stabOf(spec);
      y -= num(st.freeboard, 0.4) + num(spec.draft, 0.4) * 0.3;
    }
    if (typeof CBZ.hullStabLift === "function") {
      try { y += num(CBZ.hullStabLift(rec), 0); } catch (e) {}
    }

    rec._pitchNow = pitch; rec._rollNow = roll;     // read by the crew (seatCrew)
    rec.group.position.set(rec.pos.x, y, rec.pos.z);
    _e.set(pitch, rec.heading, roll, "YXZ");
    rec.group.quaternion.setFromEuler(_e);

    // the autopilot already threw this frame's wake for a hull it drove; a
    // far hull's wake is spent on water nobody is looking at
    if (typeof CBZ.waterWakeFor === "function" && !rec._capsized && !rec._apWake && !rec._far && Math.abs(rec.v) > 0.4) {
      try { CBZ.waterWakeFor(rec, dt); } catch (e) {}
    }
  }

  // ---- crew on deck, and crew off it ------------------------------------
  /* WHEN A MAN LOSES HIS FOOTING. The composed roll of the hull this frame
     (swell + the driver's heel + water_stability's phi) against what a body
     can hold on through: a seated man rides out about 30 degrees, a standing
     one about 22, and a violent enough roll RATE — the snap of a ram — throws
     a standing man before the angle is reached. No hysteresis is needed: a
     man who goes over is no longer crew. */
  const TIP_SEATED = 0.55, TIP_STAND = 0.40;      // rad
  const RATE_SEATED = 2.2, RATE_STAND = 1.4;      // rad/s
  function rollOf(rec) {
    const r = num(rec._rollNow, NaN);
    return Number.isFinite(r) ? r : num(rec._roll, 0);
  }
  function seatCrew(rec, dt, calm) {
    if (!rec.crew.length) return;
    // a far hull's people are hidden: keep them on their berths twice a
    // second (the bite scan still reads where they are), skip the rig
    if (rec._far && !calm) {
      rec._farCrewT = num(rec._farCrewT, 0) - dt;
      if (rec._farCrewT > 0) return;
      rec._farCrewT = 0.5;
      rec.group.updateMatrixWorld(true);
      for (let i = 0; i < rec.crew.length; i++) {
        const b = rec.crew[i];
        if (!b || b.dead || b._aboard !== rec || b._overboard) { rec.crew.splice(i--, 1); continue; }
        const seat = rec._seats[num(b._aboardSeat, i)] || rec._seats[0];
        if (seat) placeAboard(rec, b, seat);
        if (b.group && b.group.visible) b.group.visible = false;   // climbed aboard a far hull
      }
      return;
    }
    rec.group.updateMatrixWorld(true);
    const roll = rollOf(rec);
    const rate = rec._stab ? num(rec._stab.phiDot, 0) : num(rec._heelV, 0);
    for (let i = 0; i < rec.crew.length; i++) {
      const b = rec.crew[i];
      if (!b || b.dead || b._aboard !== rec || b._overboard) { rec.crew.splice(i--, 1); continue; }
      const seat = rec._seats[num(b._aboardSeat, i)] || rec._seats[0];
      if (!seat) continue;
      if (!calm) {
        const tip = seat.stand ? TIP_STAND : TIP_SEATED;
        const snap = seat.stand ? RATE_STAND : RATE_SEATED;
        if (Math.abs(roll) > tip || Math.abs(rate) > snap) {
          // over the LOW rail: +roll = heeled to starboard
          const side = (Math.abs(roll) > 0.05 ? roll : rate) >= 0 ? 1 : -1;
          rec.crew.splice(i--, 1);
          launchOverboard(rec, b, { side: side, violent: Math.abs(rate) > snap, cause: "heel" });
          continue;
        }
      }
      placeAboard(rec, b, seat);
      if (b.char) {
        poseAboard(b, seat);
        // the ONE writer of this rig for the frame: survivorbot's mover skips
        // a body that is `_aboard`, so the pose has to be driven from here
        if (typeof CBZ.animChar === "function") { try { CBZ.animChar(b.char, 0, dt); } catch (e) {} }
        crewAct(rec, b, seat, i, dt);
      }
    }
  }
  /* A RAM'S SHOVE, FELT BY THE PEOPLE. `push` is the hull's own velocity
     change (m/s) and `lift` the heave a body coming up underneath gave it.
     A high-sided hull's deck hands stagger and grab a rail; on anything you
     can step over the side of, a hard enough shove puts them in. A kayak
     rammed by anything takes a push of 6 — the paddler always goes. */
  function staggerCrew(rec, push, lift, side) {
    if (!rec.crew.length) return;
    const fb = num(stabOf(rec._hullSpec).freeboard, 0.5);
    const standing = push > 0.9 + fb * 0.6 || lift > 0.35;
    const seated = push > 2.0 + fb * 0.8 || lift > 0.7;
    if (!standing && !seated) return;
    for (let i = rec.crew.length - 1; i >= 0; i--) {
      const b = rec.crew[i];
      if (!b || b.dead) continue;
      const seat = rec._seats[num(b._aboardSeat, i)] || rec._seats[0];
      if (!(seat && seat.stand ? standing : seated)) continue;
      rec.crew.splice(i, 1);
      launchOverboard(rec, b, { side: side, violent: push > 3 || lift > 0.7, kick: push * 0.3, cause: "ram" });
    }
  }
  function releaseCrew(rec) {
    for (let i = 0; i < rec.crew.length; i++) if (rec.crew[i]) unseat(rec.crew[i]);
    rec.crew.length = 0;
  }

  /* ---- OVER THE SIDE ----------------------------------------------------
     Nobody teleports into the sea. A body that leaves a hull is THROWN: a
     short ballistic arc from where it stood, over the low rail, carrying the
     hull's own way, tumbling — and it goes UNDER when it lands and comes back
     up on survivorbot's own float line. The craft still owns the body for the
     length of the arc (`_aboard` stays set, so the bot's mover and the crowd
     separation leave it alone); the sea owns it from the splash. A shark can
     take a man out of the air — he is a live body the whole way. */
  const falling = [];
  const FLOAT_DEPTH = 1.275;        // survivorbot.js / swim.js: feet below the surface on a floating body
  function launchOverboard(rec, b, o) {
    o = o || {};
    const spec = rec._hullSpec;
    const beam = num(spec && spec.beam, 2);
    const h = rec.heading;
    // hull-local +X is PORT (water_stability.js's header derives it); the
    // low rail is the side she is rolled toward: +phi = starboard = local -X
    const side = o.side < 0 ? -1 : 1;
    const ox = -side * Math.cos(h), oz = side * Math.sin(h);   // world outward unit
    const seatI = num(b._aboardSeat, 0);
    const seat = rec._seats[seatI] || rec._seats[0];
    const j = h01(seatI * 3.1 + 1, rec.pos.x + rec.pos.z);
    const surf = seaY(b.pos.x, b.pos.z);
    const h0 = Math.max(0, b.pos.y - surf);
    const vy0 = 0.8 + (o.violent ? 1.6 : 0.6) * j;
    const tFall = (vy0 + Math.sqrt(vy0 * vy0 + 2 * 9.81 * (h0 + 0.35))) / 9.81;
    // he must come down clear of the rail plus a stride, from wherever on
    // the beam he was — solved for the lateral speed rather than typed
    const cur = seat ? -side * seat.x : 0;                // his offset toward the low rail
    const want = beam * 0.5 + 0.9 + j * 1.1 + num(o.kick, 0);
    const vlat = Math.max(0.9, (want - cur) / tFall);
    const fx = Math.sin(h), fz = Math.cos(h);
    const way = num(rec.v, 0) * 0.8;
    const F = {
      b: b, t: 0, yaw: Math.atan2(ox, oz),
      vx: ox * vlat + fx * way + num(rec.vx, 0), vy: vy0, vz: oz * vlat + fz * way + num(rec.vz, 0),
      tumble: (o.violent ? 2.4 : 1.3) * (0.7 + j * 0.6),
      violent: !!o.violent, cause: o.cause || "fall",
    };
    b._aboard = rec; b._aboardSeat = null; b._overboard = F;
    if (b.char) { b.char.sitting = false; b.char.seatRef = null; b.char.airPose = { t: 0, rise: 1, fall: 0 }; }
    falling.push(F);
    AUDIT.overboard++;
    if (rec._lost && rec._lost.indexOf(b) < 0) rec._lost.push(b);
    // a man going in off a boat is heard across the water
    alarmAt(rec.pos.x, rec.pos.z, 70, o.cause !== "fall" && o.cause !== "heel");
    return F;
  }
  function tickFalling(dt) {
    for (let i = falling.length - 1; i >= 0; i--) {
      const F = falling[i], b = F.b;
      if (!b || b.dead || b._overboard !== F || !b.group) {
        if (b && b._overboard === F) b._overboard = null;
        falling.splice(i, 1); continue;
      }
      F.t += dt;
      F.vy -= 9.81 * dt;
      b.pos.x += F.vx * dt; b.pos.y += F.vy * dt; b.pos.z += F.vz * dt;
      // he goes over head-first: a forward tumble about his own hips
      _e.set(Math.min(1.45, F.t * F.tumble), F.yaw, 0, "YXZ");
      b.group.quaternion.setFromEuler(_e);
      if (b.char) {
        const air = b.char.airPose || (b.char.airPose = { t: 0, rise: 0, fall: 0 });
        air.t = F.t; air.rise = clamp(F.vy / 2, 0, 1); air.fall = clamp(-F.vy / 3, 0, 1);
        if (typeof CBZ.animChar === "function") { try { CBZ.animChar(b.char, 0, dt); } catch (e) {} }
      }
      const surf = seaY(b.pos.x, b.pos.z);
      // feet 0.35 under the surface with the body pitched over = he is in
      if (b.pos.y <= surf - 0.35 || F.t > 4) { landInWater(F, surf); falling.splice(i, 1); }
    }
  }
  function landInWater(F, surf) {
    const b = F.b;
    unseat(b);
    b.group.rotation.set(0, F.yaw, 0);
    // UNDER, then up: survivorbot's swim step damps _floatY onto the float
    // line over about half a second, which IS the surfacing
    b.swim = true; b.wet = true;
    b._floatY = surf - FLOAT_DEPTH - 0.5;
    b.pos.y = b._floatY;
    if (b.target && b.target.set) b.target.set(b.pos.x, 0, b.pos.z);
    b.pause = 0; b._arrived = false;
    b.panicT = F.violent ? 3.5 : 2.0;
    // hurt, ALIVE, and bleeding — the men in the water are what brings the
    // rest of the sharks (marine_predation §7 chum). A man who simply went
    // over the side is bruised; one thrown by a bite or a capsize is hurt.
    const j = h01(b.pos.x * 1.3, b.pos.z * 0.7);
    const mx = num(b.maxHp, 100);
    const to = mx * (F.violent ? 0.20 + j * 0.20 : 0.55 + j * 0.25);
    if (b.hp == null || b.hp > to) b.hp = Math.round(to);
    if (typeof CBZ.marineBleed === "function") { try { CBZ.marineBleed(b, F.violent ? 0.5 : 0.2); } catch (e) {} }
    splash(b.pos.x, b.pos.z, F.violent ? 1.4 : 1.0);
  }
  // every arc ended where it is (a reset, a teardown): the bodies are the sea's
  function dropFalling() {
    while (falling.length) {
      const F = falling.pop();
      if (F.b && !F.b.dead) landInWater(F, seaY(F.b.pos.x, F.b.pos.z));
      else if (F.b) F.b._overboard = null;
    }
  }

  /* CBZ.hullOccupantsOverboard(rec, {cause, side}) — everyone aboard goes
     over the low rail, hurt but ALIVE and bleeding (marine_predation.js's own
     philosophy for a bitten boat, throwOccupants:1265). water_stability.js
     calls this from its capsize and flood events; a bite and a sinking call
     it from here. */
  CBZ.hullOccupantsOverboard = function (rec, o) {
    if (!rec) return 0;
    if (!rec._seaCraft) {
      // a cityCars boat — marine_predation owns those bodies
      if (typeof CBZ.marineThrowOccupants === "function") {
        const p = rec.pos || (rec.group && rec.group.position);
        if (p) {
          const h = num(rec.heading, 0);
          try { CBZ.marineThrowOccupants(rec, p.x, p.z, Math.cos(h), Math.sin(h)); } catch (e) {}
        }
      }
      return 0;
    }
    o = o || {};
    const roll = rollOf(rec);
    const side = num(o.side, 0) || (Math.abs(roll) > 0.05 ? (roll >= 0 ? 1 : -1) : (h01(rec.pos.x, rec.pos.z) < 0.5 ? 1 : -1));
    let n = 0;
    while (rec.crew.length) {
      const b = rec.crew.pop();
      if (!b || b.dead || b._overboard) continue;
      launchOverboard(rec, b, { side: side, violent: true, cause: o.cause || "wreck" });
      n++;
    }
    return n;
  };

  // ============================================================
  //  §4. THE RULES — who can do what to which hull
  // ============================================================
  const ENGULF_MAX = 0.62;          // wildlife_tame.js's own number, for a hull
  function specOfRec(rec) {
    if (!rec) return null;
    if (rec._hullSpec) return rec._hullSpec;
    const R = MH();
    if (R && R.specFor) { try { return R.specFor(rec); } catch (e) {} }
    return null;
  }
  function lenOf(a) {
    if (typeof CBZ.marineBodyLen === "function") { try { return +CBZ.marineBodyLen(a) || 0; } catch (e) {} }
    return 0;
  }
  function gapeOf(a) {
    if (typeof CBZ.marineGape === "function") { try { return +CBZ.marineGape(a) || 0; } catch (e) {} }
    return lenOf(a) * 0.19;
  }
  function tonnesOf(a) {
    if (typeof CBZ.marineTonnes === "function") { try { return +CBZ.marineTonnes(a) || 0; } catch (e) {} }
    const L = lenOf(a);
    return 0.014 * Math.pow(Math.max(0.1, L), 2.8);
  }

  /* A THIRD TERM THE FISH RULE NEVER NEEDED: MASS. Length and beam alone said
     a 6 m great white could swallow a 3.3 m jetski whole but not a 4.2 m sea
     kayak — the kayak is longer and weighs 25 kg, the PWC is stubby and weighs
     350. A fish that fits is a fish you can take; a machine that fits is still
     a machine, and you cannot swallow a fifth of your own displacement. 0.12
     of the animal's own tonnage is the line, and it is what puts the jetski
     back where it belongs (bitten, not eaten) without a single boat name. */
  const ENGULF_MASS = 0.12;
  CBZ.sharkCanEngulfHull = function (a, rec) {
    const s = specOfRec(rec);
    if (!a || !s || !rec || rec.dead) return false;
    const L = lenOf(a);
    if (!(L > 0) || !(s.loa > 0)) return false;
    if (s.loa > L * ENGULF_MAX) return false;
    if (gapeOf(a) < num(s.beam, 2) * 0.8) return false;
    return num(s.massT, 1) <= tonnesOf(a) * ENGULF_MASS;
  };
  CBZ.sharkCanBiteHull = function (a, rec) {
    const s = specOfRec(rec);
    if (!a || !s || !rec || rec.dead) return false;
    if (typeof CBZ.marineBiteableHull === "function") {
      try { return !!CBZ.marineBiteableHull(a, rec); } catch (e) {}
    }
    return gapeOf(a) >= num(s.beam, 2) && num(s.massT, 1) <= tonnesOf(a) * 1.4;
  };

  /* THE TIP. One moment, two callers (the mounted player shark and every wild
     one), and the physics decides — see the header for the measured table. */
  /* RAM_K IS THE ONE TUNED NUMBER IN THIS FILE and it was solved against the
     authored fleet, not guessed: at 0.7 a 2.1 t great white at 8 m/s puts 12.4
     kN.m into a speedboat whose righting moment is 13.4 — she rolls to the
     rail and comes back, which is the "two or three passes" a boat that size
     should survive — while the same animal puts 11.2 into a skiff that rights
     with 1.5 and rolls it on the first hit. A 0.16 t bull shark at 6 m/s still
     clears a kayak's 0.03 twelve times over. Nothing else in the model is
     tuned; every other number is a dimension off the hull registry. */
  const RAM_K = 0.7;
  CBZ.sharkRamHull = function (a, rec, o) {
    o = o || {};
    const s = specOfRec(rec);
    if (!a || !rec || !s || rec.dead) return 0;
    if (rec._ramCd > 0) return 0;
    rec._ramCd = 0.35;
    const p = rec.pos || (rec.group && rec.group.position);
    const ap = a.pos || (a.group && a.group.position);
    if (!p || !ap) return 0;
    const beam = num(s.beam, 2);
    // CLOSING SPEED, not the animal's cruise: a shark that drifts into a hull
    // does nothing to it. Read off whatever velocity the caller's animal
    // carries, floored so a lunge that has already landed still counts.
    let closing = num(o.speed, 0);
    if (!(closing > 0)) {
      const sh = a._shark || null;
      closing = num(a.speed, 0) || num(sh && sh.v, 0) || num(a._waterMove && a._waterMove.v, 0) || 4;
    }
    closing = clamp(closing, 1.5, 16);
    const under = o.from === "under";
    const moment = tonnesOf(a) * closing * (beam * 0.5) * RAM_K * (under ? 1.35 : 1);
    // WHICH WAY IT GOES OVER: the side the animal is on. A hull hit from
    // starboard heels to port, and one lifted from below rolls away from the
    // animal's own bearing.
    const dx = p.x - ap.x, dz = p.z - ap.z;
    const c = Math.cos(rec.heading), sn = Math.sin(rec.heading);
    const lateral = dx * c - dz * sn;         // +x is starboard in hull frame
    const sign = lateral >= 0 ? 1 : -1;

    let phi = 0;
    if (typeof CBZ.hullHeelImpulse === "function") {
      try { phi = num(CBZ.hullHeelImpulse(rec, moment * sign, { from: o.from || "ram", x: num(o.x, ap.x), z: num(o.z, ap.z) }), 0); } catch (e) { phi = 0; }
      if (typeof CBZ.hullCapsized === "function") {
        try { if (CBZ.hullCapsized(rec)) onCapsize(rec); } catch (e) {}
      }
    } else {
      phi = heelFallback(rec, moment * sign);
    }
    // the shove, the white water and the beat of lens. The push runs along the
    // contact line, i.e. away from the animal that just hit her.
    const m = Math.hypot(dx, dz) || 1;
    const push = clamp(moment / Math.max(1, num(s.massT, 1) * 9.81), 0, 6);
    rec.vx = num(rec.vx, 0) - (dx / m) * push;
    rec.vz = num(rec.vz, 0) - (dz / m) * push;
    rec.v = num(rec.v, 0) * 0.75;
    // ..and the PEOPLE feel the shove: the hull's own velocity change and the
    // heave under it decide who goes over the rail she is now heeled to
    const lift = under ? (typeof CBZ.hullStabLift === "function" ? num(CBZ.hullStabLift(rec), 0) : clamp(moment * 0.02, 0, 2.2)) : 0;
    staggerCrew(rec, push, lift, phi >= 0 ? 1 : -1);
    alarm(rec, ap.x, ap.z, true, a, 0);
    alarmAt(p.x, p.z, 90, true);
    /* THE WHITE WATER IS THE SIZE OF THE THING THAT MADE IT. Scaled off the
       moment AND the hull, because a 4 m kayak rolling threw the same wall of
       spray as a megalodon hitting a cruiser and it hid the whole event. */
    splash(p.x, p.z, clamp(0.8 + moment * 0.006 + num(s.loa, 6) * 0.05, 0.8, 3.2));
    if (CBZ.shake && CBZ.player) {
      const d = Math.hypot(CBZ.player.pos.x - p.x, CBZ.player.pos.z - p.z);
      if (d < 60) { try { CBZ.shake(clamp(0.18 + moment * 0.004, 0.1, 0.5) * (1 - d / 60)); } catch (e) {} }
    }
    if (CBZ.sfx) { try { CBZ.sfx("hit", { volume: 0.5 }); } catch (e) {} }
    AUDIT.rams++;
    return phi;
  };

  // ---- §5. the fallback heel model (only when water_stability.js is absent)
  /* A hull is a spring: righting = displacement * gm * sin(phi) up to the
     angle of vanishing stability, and past it the sign flips and she goes.
     This is that one line integrated, nothing more, so the TIP is real in a
     build that does not have the stability file yet. When it IS there, none
     of this runs (see ride()). */
  function heelFallback(rec, moment) {
    const s = rec._hullSpec, st = stabOf(s);
    const disp = Math.max(0.02, num(s.massT, 1)) * 9.81;       // kN
    const gm = Math.max(0.02, num(st.gm, 0.5));
    const phiV = Math.max(0.3, num(st.phiV, 1.1));
    const maxRight = disp * gm * Math.sin(phiV);
    // the impulse arrives as angular velocity: I ~ disp*gm/omega^2, and the
    // natural roll period of a small hull is about 2 s, so omega ~ 3 rad/s
    const I = disp * gm / 9;
    rec._heelV = num(rec._heelV, 0) + (moment / Math.max(0.02, I)) * 0.12;
    if (Math.abs(moment) > maxRight) {
      // past the angle of vanishing stability on this one hit: she goes over
      rec._heel = Math.sign(moment) * Math.PI;
      rec._heelV = 0;
      onCapsize(rec);
      return rec._heel;
    }
    return num(rec._heel, 0);
  }
  function heelTick(rec, dt) {
    if (typeof CBZ.hullStabRoll === "function") return;     // B owns the roll
    if (rec._capsized) { rec._heel = Math.sign(rec._heel || 1) * Math.PI; rec._heelV = 0; return; }
    const s = rec._hullSpec, st = stabOf(s);
    const disp = Math.max(0.02, num(s.massT, 1)) * 9.81;
    const gm = Math.max(0.02, num(st.gm, 0.5));
    const phiV = Math.max(0.3, num(st.phiV, 1.1));
    const I = disp * gm / 9;
    const phi = num(rec._heel, 0);
    const right = -disp * gm * Math.sin(phi) * (Math.abs(phi) < phiV ? 1 : -1.2);
    rec._heelV = num(rec._heelV, 0) + (right / I) * dt - num(rec._heelV, 0) * Math.min(1, dt * 1.6);
    rec._heel = phi + rec._heelV * dt;
    if (Math.abs(rec._heel) > phiV * 1.35) { rec._heel = Math.sign(rec._heel) * Math.PI; onCapsize(rec); }
  }

  function onCapsize(rec) {
    if (rec._capsized) return;
    rec._capsized = true;
    rec.engineDead = true;
    rec.v = 0; rec._planing = 0;
    rec.anchored = false; rec.route = null;
    AUDIT.tipped++;
    CBZ.hullOccupantsOverboard(rec, { cause: "capsize" });
    splash(rec.pos.x, rec.pos.z, clamp(0.9 + num(rec._hullSpec && rec._hullSpec.loa, 6) * 0.14, 0.9, 3.2));
  }
  CBZ.seaCraftCapsize = onCapsize;      // the storyboard and the tests stage it

  // ============================================================
  //  §5b. THE HULL IS A SOLID — shark vs boat, and boat vs boat
  // ============================================================
  /* OWNER: "I can kind of phase through boats a little bit in the shark one
     ... there should be a mesh collider for boats and sharks."

     There was no collider. Every contact between an animal and a hull was a
     VERB — the bite scan's reach test, the ram's 0.35 s cooldown, the wild
     tip's centre-to-centre distance — and none of them ever stopped a body.
     So a shark that did not bite simply swam through the boat, and one that
     did bite kept swimming into it for the rest of the swing.

     THE BOAT'S SOLID IS MEASURED OFF ITS OWN SKIN. The first time any body
     comes near a model, every `hullSurface` mesh in its group (the lofted
     shell water_hulls.js hands to hull_loft.js) is walked once in the boat's
     own frame and binned into COL_N stations stern to bow: the half-beam, the
     keel, the sheer and the half-width down at the keel (deadrise / round
     bilge). That table, cached per model, IS the collider: at any station
     the section is full beam above half depth and narrows linearly to the
     keel width, the plan tapers exactly as the drawn hull tapers into its
     stem, and it is closed by the keel below, the sheer on top and the
     transom and stem planes at the ends. A model with no lofted skin gets
     the same table synthesised from loa / beam / draft / freeboard.

     THE ANIMAL IS ITS OWN BODY. A chain of seven spheres down the named
     *Hull mesh's long axis, radius following a fusiform profile off the
     trunk's measured girth (thin at the tail and snout, full at the
     shoulder), posed by the live heading AND pitch. It is a 3D test in the
     boat's live frame (its pitch, its heel, capsized included), so a shark
     well under the keel swims under and one at the surface hits the side.

     ON CONTACT the body is put back on the surface along the contact normal
     (penetration drawn: zero), the part of its velocity going INTO the hull
     is taken off in proportion to the hull's share of the combined mass (a
     yacht stops a great white dead; a megalodon carries on into a kayak and
     SHOVES it), and the hull gets the other side of that: its share of the
     separation next tick, a shove, and a heel impulse off the real contact
     lever. A fast hit (closing >= RAM_MIN) by the player is the existing
     ram, untouched. THE BITE IS SPARED: while the jaws are committed to THIS
     hull the head spheres stand down, so the mouth still reaches the rail —
     the bite's own surface stop (capBiteStep / jawInHull) owns the head. */
  const COL_N = 16;
  const COL_T = [0.05, 0.19, 0.35, 0.51, 0.67, 0.81, 0.95];   // tail -> snout
  const COL_P = [0.28, 0.62, 0.92, 1.00, 0.90, 0.66, 0.52];   // radius / girth
  const COL_HEAD = 5;                                          // 5, 6 = the head
  const RAM_MIN = 3.0;                                         // m/s closing
  const _shapeBySpec = new WeakMap();
  const _colM = new THREE.Matrix4(), _colInv = new THREE.Matrix4();
  const _colV = new THREE.Vector3(), _colL = new THREE.Vector3(), _colN = new THREE.Vector3();
  const _colQ = new THREE.Quaternion(), _colBox = new THREE.Box3();
  const _sd = { nx: 0, ny: 0, nz: 0 };
  const _capOut = { x0: 0, x1: 0, R: 0 };
  const COLA = { contacts: 0, rams: 0, nudges: 0, boatPairs: 0, maxPen: 0 };

  function newShape(z0, z1) {
    const n = COL_N;
    return {
      n: n, z0: z0, z1: z1, dz: Math.max(0.05, (z1 - z0) / (n - 1)),
      hb: new Float32Array(n), wk: new Float32Array(n),
      keel: new Float32Array(n), sheer: new Float32Array(n),
      R: 0, ext: 0, hbMax: 0, src: "",
    };
  }
  function finishShape(S) {
    let hbM = 0, ext = 0;
    for (let j = 0; j < S.n; j++) {
      if (S.hb[j] > hbM) hbM = S.hb[j];
      ext = Math.max(ext, Math.abs(S.keel[j]), Math.abs(S.sheer[j]));
    }
    S.hbMax = hbM; S.ext = ext;
    S.R = Math.hypot(Math.max(Math.abs(S.z0), Math.abs(S.z1)), hbM);
    return S;
  }
  // The fallback: a planing-hull plan off the registry row, stern to stem.
  function shapeFromSpec(spec) {
    const loa = num(spec && spec.loa, 6), beam = num(spec && spec.beam, 2);
    const draft = num(spec && spec.draft, 0.4);
    const fb = num(spec && spec.freeboard, num(spec && spec.stab && spec.stab.freeboard, loa * 0.09));
    const so = clamp(num(spec && spec.sternOffset, loa * 0.5), loa * 0.3, loa * 0.7);
    const S = newShape(-so, loa - so);
    for (let j = 0; j < S.n; j++) {
      const t = j / (S.n - 1);
      const hb = beam * 0.5 * (t < 0.55 ? 0.84 + 0.16 * t / 0.55 : Math.sqrt(Math.max(0, (1 - t) / 0.45)));
      S.hb[j] = hb; S.wk[j] = hb * 0.3;
      S.keel[j] = -draft * (t < 0.7 ? 1 : 0.25 + 0.75 * (1 - t) / 0.3);
      S.sheer[j] = fb * (1 + 0.25 * t);
    }
    S.src = "spec";
    return finishShape(S);
  }
  /* The measured table. P is xyz in the BOAT's frame (+z bow, +x one side,
     y up from the group origin). */
  function shapeFromPoints(P, count, spec) {
    let z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < count; i++) { const z = P[i * 3 + 2]; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    if (!(z1 - z0 > 0.3)) return null;
    const S = newShape(z0, z1), n = S.n;
    const cnt = new Int32Array(n);
    for (let j = 0; j < n; j++) { S.keel[j] = Infinity; S.sheer[j] = -Infinity; }
    for (let i = 0; i < count; i++) {
      const x = Math.abs(P[i * 3]), y = P[i * 3 + 1];
      const j = clamp(Math.round((P[i * 3 + 2] - z0) / S.dz), 0, n - 1);
      if (x > S.hb[j]) S.hb[j] = x;
      if (y < S.keel[j]) S.keel[j] = y;
      if (y > S.sheer[j]) S.sheer[j] = y;
      cnt[j]++;
    }
    // stations the skin did not put a vertex in borrow from their neighbours
    for (let j = 0; j < n; j++) {
      if (cnt[j]) continue;
      let a = j - 1, b = j + 1;
      while (a >= 0 && !cnt[a]) a--;
      while (b < n && !cnt[b]) b++;
      const A = a >= 0 ? a : b, B = b < n ? b : a;
      if (A < 0 || A >= n) return null;
      const u = B === A ? 0 : (j - A) / (B - A);
      S.hb[j] = S.hb[A] + (S.hb[B] - S.hb[A]) * u;
      S.keel[j] = S.keel[A] + (S.keel[B] - S.keel[A]) * u;
      S.sheer[j] = S.sheer[A] + (S.sheer[B] - S.sheer[A]) * u;
    }
    // the half-width down at the keel: the bottom 15% of each section
    for (let i = 0; i < count; i++) {
      const j = clamp(Math.round((P[i * 3 + 2] - z0) / S.dz), 0, n - 1);
      const y = P[i * 3 + 1];
      if (y < S.keel[j] + 0.15 * (S.sheer[j] - S.keel[j])) {
        const x = Math.abs(P[i * 3]);
        if (x > S.wk[j]) S.wk[j] = x;
      }
    }
    for (let j = 0; j < n; j++) if (!cnt[j] || S.wk[j] > S.hb[j]) S.wk[j] = Math.min(S.hb[j], Math.max(S.wk[j], S.hb[j] * 0.3));
    // a RIB's beam is its tubes, which are not the lofted skin: the registry's
    // beam is a floor on what the solid is allowed to be
    let hbM = 0;
    for (let j = 0; j < n; j++) hbM = Math.max(hbM, S.hb[j]);
    const want = num(spec && spec.beam, 0) * 0.5;
    if (want > 0 && hbM > 0.05 && hbM < want * 0.9) {
      const k = want / hbM;
      for (let j = 0; j < n; j++) { S.hb[j] *= k; S.wk[j] *= k; }
    }
    S.src = "mesh";
    return finishShape(S);
  }
  function shapeOf(rec) {
    const spec = rec && rec._hullSpec;
    if (!spec) return null;
    let S = _shapeBySpec.get(spec);
    if (S) return S;
    S = null;
    const g = rec.group;
    if (g) {
      try {
        g.updateMatrixWorld(true);
        _colInv.copy(g.matrixWorld).invert();
        const meshes = [];
        let total = 0;
        g.traverse(function (o) {
          if (o.isMesh && o.userData && o.userData.hullSurface && o.geometry && o.geometry.attributes &&
              o.geometry.attributes.position) { meshes.push(o); total += o.geometry.attributes.position.count; }
        });
        if (total) {
          const P = new Float32Array(total * 3);
          let k = 0;
          for (let m = 0; m < meshes.length; m++) {
            _colM.multiplyMatrices(_colInv, meshes[m].matrixWorld);
            const pos = meshes[m].geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) {
              _colV.fromBufferAttribute(pos, i).applyMatrix4(_colM);
              P[k++] = _colV.x; P[k++] = _colV.y; P[k++] = _colV.z;
            }
          }
          S = shapeFromPoints(P, total, spec);
        }
      } catch (e) { S = null; }
    }
    if (!S) S = shapeFromSpec(spec);
    _shapeBySpec.set(spec, S);
    return S;
  }

  /* Signed distance from a point in the boat's frame to the solid, and the
     outward normal. Inside, the nearest face wins; outside, the positive face
     terms combine the way a box's do, so a corner is a corner. */
  function hullSdf(S, x, y, z, out) {
    const zc = z < S.z0 ? S.z0 : (z > S.z1 ? S.z1 : z);
    const f = (zc - S.z0) / S.dz;
    let i = Math.floor(f);
    if (i > S.n - 2) i = S.n - 2;
    if (i < 0) i = 0;
    const u = f - i, dz = S.dz;
    const hb = S.hb[i] + (S.hb[i + 1] - S.hb[i]) * u, hbz = (S.hb[i + 1] - S.hb[i]) / dz;
    const wk = S.wk[i] + (S.wk[i + 1] - S.wk[i]) * u, wkz = (S.wk[i + 1] - S.wk[i]) / dz;
    const k = S.keel[i] + (S.keel[i + 1] - S.keel[i]) * u, kz = (S.keel[i + 1] - S.keel[i]) / dz;
    const s = S.sheer[i] + (S.sheer[i + 1] - S.sheer[i]) * u, sz = (S.sheer[i + 1] - S.sheer[i]) / dz;
    const yF = k + Math.max(0.05, s - k) * 0.5;
    let w, wy, wz;
    if (y >= yF) { w = hb; wy = 0; wz = hbz; }
    else if (y <= k) { w = wk; wy = 0; wz = wkz; }
    else { const t = (y - k) / (yF - k); w = wk + (hb - wk) * t; wy = (hb - wk) / (yF - k); wz = wkz + (hbz - wkz) * t; }
    const sx = x >= 0 ? 1 : -1;
    /* five faces: side, keel, sheer, transom, stem. THE SIDE PUSHES LEVEL.
       Its true normal leans down along the deadrise, and resolving along it
       walked a shark shouldering the topsides down the V and out under the
       keel — the jaws dragged off the rail and the "hit" became a dive. The
       width still follows the section (w(y)); only the push is horizontal,
       and a body genuinely under the bottom is the keel face's to answer. */
    wy = 0;
    const gS = Math.sqrt(1 + wz * wz), gB = Math.sqrt(1 + kz * kz), gT = Math.sqrt(1 + sz * sz);
    const d0 = (Math.abs(x) - w) / gS, d1 = (k - y) / gB, d2 = (y - s) / gT, d3 = S.z0 - z, d4 = z - S.z1;
    let dm = d0, nx = sx / gS, ny = 0, nz = -wz / gS;
    if (d1 > dm) { dm = d1; nx = 0; ny = -1 / gB; nz = kz / gB; }
    if (d2 > dm) { dm = d2; nx = 0; ny = 1 / gT; nz = -sz / gT; }
    if (d3 > dm) { dm = d3; nx = 0; ny = 0; nz = -1; }
    if (d4 > dm) { dm = d4; nx = 0; ny = 0; nz = 1; }
    if (dm > 0) {
      let ax = 0, ay = 0, az = 0, q = 0;
      if (d0 > 0) { q += d0 * d0; ax += d0 * sx / gS; ay -= d0 * wy / gS; az -= d0 * wz / gS; }
      if (d1 > 0) { q += d1 * d1; ay -= d1 / gB; az += d1 * kz / gB; }
      if (d2 > 0) { q += d2 * d2; ay += d2 / gT; az -= d2 * sz / gT; }
      if (d3 > 0) { q += d3 * d3; az -= d3; }
      if (d4 > 0) { q += d4 * d4; az += d4; }
      const L = Math.hypot(ax, ay, az) || 1;
      out.nx = ax / L; out.ny = ay / L; out.nz = az / L;
      return Math.sqrt(q);
    }
    out.nx = nx; out.ny = ny; out.nz = nz;
    return dm;
  }

  /* THE ANIMAL'S TRUNK, in metres at its live size: where the named *Hull
     mesh starts and ends along the body's +X, and its girth. Measured once in
     the group's own frame, scaled live (length off scale.x, girth off the
     fed/lean scale.y/z). */
  function capsuleOf(a, out) {
    let c = a._hullCap;
    if (c === undefined) {
      c = null;
      const g = a.group;
      if (g) {
        try {
          let hull = null;
          g.traverse(function (o) { if (!hull && o.isMesh && o.geometry && /hull$/i.test(o.name || "")) hull = o; });
          if (hull) {
            if (!hull.geometry.boundingBox) hull.geometry.computeBoundingBox();
            g.updateMatrixWorld(true);
            _colM.multiplyMatrices(_colInv.copy(g.matrixWorld).invert(), hull.matrixWorld);
            _colBox.copy(hull.geometry.boundingBox).applyMatrix4(_colM);
            const bx = _colBox.max.x - _colBox.min.x;
            if (bx > 0.2 && isFinite(bx)) {
              c = { x0: _colBox.min.x, x1: _colBox.max.x, abs: false,
                    R: ((_colBox.max.y - _colBox.min.y) + (_colBox.max.z - _colBox.min.z)) * 0.25 };
            }
          }
        } catch (e) { c = null; }
      }
      if (!c) { const L = lenOf(a) || 3; c = { x0: -0.5 * L, x1: 0.5 * L, R: 0.09 * L, abs: true }; }
      a._hullCap = c;
    }
    const sc = c.abs ? null : (a.group && a.group.scale);
    const sx = sc ? Math.abs(sc.x) : 1, sg = sc ? (Math.abs(sc.y) + Math.abs(sc.z)) * 0.5 : 1;
    out.x0 = c.x0 * sx; out.x1 = c.x1 * sx; out.R = Math.max(0.08, c.R * sg);
    return out;
  }

  /* CBZ.marineHullContact(a, B) -> number of hulls touched.
     B is the body, and is WRITTEN BACK: { x, y, z } origin, { ax, ay, az }
     its unit +X (the way the snout points), { vx, vy, vz } its velocity,
     skipHeadOf: the hull its jaws are committed to (head spheres stand down
     for that one), ramOK: a hard hit may be the ram (the player's). */
  function marineHullContact(a, B) {
    if (!craft.length || !a || !B) return 0;
    const cap = capsuleOf(a, _capOut);
    const reach = Math.max(Math.abs(cap.x0), Math.abs(cap.x1)) + cap.R;
    const mA = Math.max(0.01, tonnesOf(a));
    let hits = 0;
    for (let c = 0; c < craft.length; c++) {
      const rec = craft[c];
      if (!rec || rec.dead || rec._sinking || rec._engulf || rec._hidden || !rec.group) continue;
      const S = shapeOf(rec);
      if (!S) continue;
      const gp = rec.group.position;
      const dx = B.x - gp.x, dz = B.z - gp.z, rr = S.R + reach + 0.3;
      if (dx * dx + dz * dz > rr * rr) continue;
      if (Math.abs(B.y - gp.y) > S.ext + reach + 0.3) continue;
      _colQ.copy(rec.group.quaternion).invert();
      const mB = Math.max(0.01, num(rec._hullSpec.massT, 1));
      const shareA = mB / (mA + mB);
      const skipHead = B.skipHeadOf === rec;
      const vbx = num(rec._cvx, 0), vbz = num(rec._cvz, 0);
      let touched = false, closing = 0, push = 0, cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
      for (let it = 0; it < 4; it++) {
        let best = 0.001, bi = -1, bs = 0, br = 0;
        for (let i = 0; i < COL_T.length; i++) {
          if (skipHead && i >= COL_HEAD) continue;
          const s = cap.x0 + (cap.x1 - cap.x0) * COL_T[i];
          const r = cap.R * COL_P[i];
          _colL.set(B.x + B.ax * s - gp.x, B.y + B.ay * s - gp.y, B.z + B.az * s - gp.z).applyQuaternion(_colQ);
          const d = hullSdf(S, _colL.x, _colL.y, _colL.z, _sd);
          if (r - d > best) { best = r - d; bi = i; bs = s; br = r; _colN.set(_sd.nx, _sd.ny, _sd.nz); }
        }
        if (bi < 0) break;
        touched = true;
        if (best > COLA.maxPen) COLA.maxPen = best;
        _colN.applyQuaternion(rec.group.quaternion);
        nx = _colN.x; ny = _colN.y; nz = _colN.z;
        // THE BODY IS PUT BACK ON THE SURFACE NOW, all of it — nothing is
        // drawn inside a boat. The hull's share of the separation is paid as
        // a shove next tick (the water owns her height, so never vertical).
        B.x += nx * best; B.y += ny * best; B.z += nz * best;
        push += best;
        rec._colDX = num(rec._colDX, 0) - nx * best * (1 - shareA);
        rec._colDZ = num(rec._colDZ, 0) - nz * best * (1 - shareA);
        cx = B.x + B.ax * bs - nx * br; cy = B.y + B.ay * bs - ny * br; cz = B.z + B.az * bs - nz * br;
        // the velocity INTO the hull, taken off in the hull's share of the
        // mass; the vertical all to the animal (the sea holds the boat up)
        const vn = (B.vx - vbx) * nx + B.vy * ny + (B.vz - vbz) * nz;
        if (vn < 0) {
          if (-vn > closing) closing = -vn;
          B.vx -= nx * vn * shareA; B.vz -= nz * vn * shareA; B.vy -= ny * vn;
        }
      }
      if (!touched) continue;
      hits++;
      COLA.contacts++;
      hullContactReact(a, rec, B, closing, mA, mB, cx, cy, cz, nx, ny, nz);
    }
    return hits;
  }
  CBZ.marineHullContact = marineHullContact;

  function hullContactReact(a, rec, B, closing, mA, mB, px, py, pz, nx, ny, nz) {
    if (B.ramOK && closing >= RAM_MIN) {
      if (!(rec._ramCd > 0)) {
        COLA.rams++;
        CBZ.sharkRamHull(a, rec, { from: ny < -0.6 ? "under" : "ram", x: px, z: pz, speed: closing });
      }
      return;
    }
    if (closing < 0.15 || rec._nudgeCd > 0) return;
    rec._nudgeCd = 0.1;
    /* THE NUDGE. The same collision, below ram speed or by an animal that
       is only swimming: the momentum the hull just absorbed, (reduced mass x
       closing speed), turned about her roll axis by the real lever — a push
       on the topsides acts at its height, a push up under the bottom at its
       distance off the centreline — and a shove along the contact normal. */
    const dp = (mA * mB / (mA + mB)) * closing;
    const gp = rec.group.position;
    const h = rec.heading || 0;
    const lat = Math.abs((px - gp.x) * Math.cos(h) - (pz - gp.z) * Math.sin(h));
    const nh = Math.sqrt(Math.max(0, 1 - ny * ny));
    const lever = Math.max(0.1, nh * Math.abs(py - gp.y) + Math.abs(ny) * lat);
    if (typeof CBZ.hullHeelImpulse === "function") {
      try { CBZ.hullHeelImpulse(rec, dp * lever / 0.1, { from: ny < -0.6 ? "under" : "nudge", x: px, z: pz, dur: 0.1 }); } catch (e) {}
    } else {
      heelFallback(rec, dp * lever * 0.5 * ((px - gp.x) * Math.cos(h) - (pz - gp.z) * Math.sin(h) >= 0 ? -1 : 1));
    }
    const sh = clamp(dp / mB, 0, 4);
    rec.vx = num(rec.vx, 0) - nx * sh;
    rec.vz = num(rec.vz, 0) - nz * sh;
    COLA.nudges++;
  }

  /* BOAT VS BOAT. Cheap and honest enough: each hull is a 2D capsule down
     its measured keel line (its own stern-to-stem span, its own widest
     half-beam), and two that overlap are parted by mass along the line
     between their closest points, the heavier one moving less. */
  const _ss = { d2: 0, px: 0, pz: 0, qx: 0, qz: 0 };
  function segSeg2(ax, az, bx, bz, cx, cz, dx, dz, o) {
    const ux = bx - ax, uz = bz - az, vx = dx - cx, vz = dz - cz, wx = ax - cx, wz = az - cz;
    const A = ux * ux + uz * uz, Bv = ux * vx + uz * vz, C = vx * vx + vz * vz;
    const D = ux * wx + uz * wz, E = vx * wx + vz * wz, den = A * C - Bv * Bv;
    let s = den > 1e-9 ? clamp((Bv * E - C * D) / den, 0, 1) : 0;
    let t = C > 1e-9 ? (Bv * s + E) / C : 0;
    if (t < 0) { t = 0; s = A > 1e-9 ? clamp(-D / A, 0, 1) : 0; }
    else if (t > 1) { t = 1; s = A > 1e-9 ? clamp((Bv - D) / A, 0, 1) : 0; }
    o.px = ax + ux * s; o.pz = az + uz * s; o.qx = cx + vx * t; o.qz = cz + vz * t;
    const ex = o.px - o.qx, ez = o.pz - o.qz;
    o.d2 = ex * ex + ez * ez;
    return o;
  }
  function boatSeg(rec, S, o) {
    const h = rec.heading || 0, fx = Math.sin(h), fz = Math.cos(h);
    const r = Math.max(0.2, S.hbMax);
    const a = S.z0 + r, b = Math.max(a, S.z1 - r);
    o.ax = rec.pos.x + fx * a; o.az = rec.pos.z + fz * a;
    o.bx = rec.pos.x + fx * b; o.bz = rec.pos.z + fz * b;
    o.r = r; o.m = Math.max(0.01, num(rec._hullSpec.massT, 1));
    return o;
  }
  const _sa = {}, _sb = {};
  function boatPairs() {
    for (let i = 0; i < craft.length; i++) {
      const A = craft[i];
      if (!A || A.dead || A._sinking || A._engulf || A._hidden || !A.pos) continue;
      const SA = shapeOf(A);
      if (!SA) continue;
      for (let j = i + 1; j < craft.length; j++) {
        const Bc = craft[j];
        if (!Bc || Bc.dead || Bc._sinking || Bc._engulf || Bc._hidden || !Bc.pos) continue;
        const SB = shapeOf(Bc);
        if (!SB) continue;
        const dx = A.pos.x - Bc.pos.x, dz = A.pos.z - Bc.pos.z, rr = SA.R + SB.R;
        if (dx * dx + dz * dz > rr * rr) continue;
        boatSeg(A, SA, _sa); boatSeg(Bc, SB, _sb);
        segSeg2(_sa.ax, _sa.az, _sa.bx, _sa.bz, _sb.ax, _sb.az, _sb.bx, _sb.bz, _ss);
        const want = _sa.r + _sb.r;
        if (_ss.d2 >= want * want) continue;
        const d = Math.sqrt(_ss.d2);
        let nx = 1, nz = 0;
        if (d > 1e-4) { nx = (_ss.px - _ss.qx) / d; nz = (_ss.pz - _ss.qz) / d; }
        else { const l = Math.hypot(dx, dz) || 1; nx = dx / l; nz = dz / l; }
        const pen = want - d, kA = _sb.m / (_sa.m + _sb.m);
        A.pos.x += nx * pen * kA; A.pos.z += nz * pen * kA;
        Bc.pos.x -= nx * pen * (1 - kA); Bc.pos.z -= nz * pen * (1 - kA);
        // the way on is spent against the other hull
        A.v = num(A.v, 0) * 0.96; Bc.v = num(Bc.v, 0) * 0.96;
        COLA.boatPairs++;
      }
    }
  }
  function applyContactShoves(dt) {
    for (let i = 0; i < craft.length; i++) {
      const rec = craft[i];
      if (!rec || !rec.pos) continue;
      if (rec._nudgeCd > 0) rec._nudgeCd -= dt;
      if (rec._colDX || rec._colDZ) {
        if (!rec._sinking && !rec._engulf) {
          rec.pos.x += clamp(num(rec._colDX, 0), -1.5, 1.5);
          rec.pos.z += clamp(num(rec._colDZ, 0), -1.5, 1.5);
        }
        rec._colDX = 0; rec._colDZ = 0;
      }
    }
  }
  // every hull's real ground velocity, whatever mover drove it this frame
  function trackCraftVel(rec, dt) {
    if (rec._lpx !== undefined) {
      rec._cvx = (rec.pos.x - rec._lpx) / dt;
      rec._cvz = (rec.pos.z - rec._lpz) / dt;
    }
    rec._lpx = rec.pos.x; rec._lpz = rec.pos.z;
  }

  /* THE WILD ONES. Every aquatic animal in the sea, after all of their
     movers have run (wildlife 47.1, predation 47.15, orca 47.2, shark 47.22)
     and before anything is drawn. The ridden animal is resolved inside its
     own ride step (wildlife_tame.js), so it is skipped here. A wild body
     never rams through this — marine_predation's tip and bite own the
     deliberate hits — so a shark that only swims into a hull nudges it. */
  const _wb = { x: 0, y: 0, z: 0, ax: 1, ay: 0, az: 0, vx: 0, vy: 0, vz: 0, skipHeadOf: null, ramOK: false };
  CBZ.onUpdate(47.3, function (dt) {
    if (!craft.length) return;
    const list = CBZ.cityWildlife;
    if (!list || !list.length) return;
    dt = clamp(num(dt, 0.016), 0.001, 0.05);
    const mount = CBZ.player && CBZ.player._aquaticMount;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || a.dead || a === mount || !a.species || !a.species.aquatic || !a.group || !a.group.parent) continue;
      const gp = a.group.position;
      if (a._hcX === undefined) { a._hcX = gp.x; a._hcY = gp.y; a._hcZ = gp.z; }
      _colV.set(1, 0, 0).applyQuaternion(a.group.quaternion);
      _wb.x = gp.x; _wb.y = gp.y; _wb.z = gp.z;
      _wb.ax = _colV.x; _wb.ay = _colV.y; _wb.az = _colV.z;
      _wb.vx = (gp.x - a._hcX) / dt; _wb.vy = (gp.y - a._hcY) / dt; _wb.vz = (gp.z - a._hcZ) / dt;
      _wb.skipHeadOf = (a._mp && a._mp.shipTarget) || null;
      if (marineHullContact(a, _wb)) {
        gp.x = _wb.x; gp.y = _wb.y; gp.z = _wb.z;
        if (a._waterMove) { a._waterMove.x = gp.x; a._waterMove.z = gp.z; }
      }
      a._hcX = gp.x; a._hcY = gp.y; a._hcZ = gp.z;
    }
  });

  // ============================================================
  //  §6. DAMAGE — a chunk out of the hull, and going down
  // ============================================================
  const _box3 = new THREE.Box3();
  const _shedBox = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

  /* CBZ.seaCraft.hurt(rec, dmg, {bite, point, normal, by})
     A bite takes MATERIAL: the piece is diced off the hull's own mesh with the
     hull's own material (cityShedSolid — "all debris comes off something"),
     the hole it left is a dark inset panel welded into the hull group so it
     rides with the boat, and the sea starts coming in. */
  function hurt(rec, dmg, o) {
    o = o || {};
    if (!rec || rec.dead) return false;
    rec.hp -= Math.max(0, num(dmg, 0));
    const spec = rec._hullSpec, st = stabOf(spec);
    if (o.bite) {
      AUDIT.bites++;
      alarmAt(rec.pos.x, rec.pos.z, 110, true);
      const p = o.point || rec.pos;
      const nx = num(o.normal && o.normal.x, Math.cos(rec.heading));
      const nz = num(o.normal && o.normal.z, Math.sin(rec.heading));
      const mesh = rec._hullMesh || (rec._hullMesh = hullMeshOf(rec.group));
      const beam = num(spec.beam, 2), fb = num(st.freeboard, 0.5);
      const along = clamp(num(spec.loa, 6) * 0.14, 0.6, 1.2);
      if (mesh && typeof CBZ.cityShedSolid === "function") {
        try {
          rec.group.updateMatrixWorld(true);
          _box3.setFromObject(mesh);
          const half = Math.max(beam * 0.5, along * 0.5);
          _shedBox.minX = Math.max(_box3.min.x, p.x - half);
          _shedBox.maxX = Math.min(_box3.max.x, p.x + half);
          _shedBox.minZ = Math.max(_box3.min.z, p.z - half);
          _shedBox.maxZ = Math.min(_box3.max.z, p.z + half);
          _shedBox.minY = Math.max(_box3.min.y, seaY(p.x, p.z) - num(spec.draft, 0.4) * 0.4);
          _shedBox.maxY = Math.min(_box3.max.y, seaY(p.x, p.z) + fb + 0.15);
          if (_shedBox.maxX > _shedBox.minX && _shedBox.maxY > _shedBox.minY && _shedBox.maxZ > _shedBox.minZ) {
            const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
            CBZ.cityShedSolid(_shedBox, mat, { nx: nx, nz: nz, power: 1.6, budget: 24, rim: 0.4 });
          }
        } catch (e) {}
      }
      addBiteHole(rec, p, along, fb, beam);
      if (typeof CBZ.cityEjectaCone === "function") {
        try { CBZ.cityEjectaCone(p.x, seaY(p.x, p.z) + 0.5, p.z, nx, nz, 1.5, { spread: 0.9 }); } catch (e) {}
      }
      splash(p.x, p.z, 2.0);
      if (!rec._holed) { rec._holed = true; AUDIT.holed++; }
      // the sea comes in. swampT is the seconds of green water this hull can
      // take; a hole spends half of it at once.
      const add = num(st.swampT, 10) * 0.5;
      if (typeof CBZ.hullSwampAdd === "function") { try { CBZ.hullSwampAdd(rec, add); } catch (e) {} }
      rec._swamp = num(rec._swamp, 0) + add;
      if (typeof CBZ.marineFrenzyAt === "function") {
        try { CBZ.marineFrenzyAt(p.x, p.z, { boil: true, seconds: 30, press: 0.8 }); } catch (e) {}
      }
      CBZ.hullOccupantsOverboard(rec, { cause: "bite" });
    }
    if (rec.hp <= 0 || o.flood) sink(rec);
    return true;
  }

  /* THE HOLE. r128 has no CSG, so the honest cheap answer is not to pretend a
     mesh was cut: a jagged dark inset panel, welded into the hull's own group
     at the bite point, reads as the inside of a boat you can now see. It rides
     with the hull because it is a child of it. */
  let _holeMat = null;
  function holeMat() {
    if (!_holeMat) {
      _holeMat = new THREE.MeshLambertMaterial({ color: 0x14181c, emissive: 0x05070a, emissiveIntensity: 0.4, side: THREE.DoubleSide });
      _holeMat._shared = true;
    }
    return _holeMat;
  }
  function addBiteHole(rec, p, along, fb, beam) {
    try {
      rec.group.updateMatrixWorld(true);
      const g = new THREE.BoxGeometry(Math.max(0.25, beam * 0.62), Math.max(0.25, fb * 1.15), Math.max(0.4, along));
      const m = new THREE.Mesh(g, holeMat());
      _tmpV2.set(p.x, seaY(p.x, p.z) + fb * 0.35, p.z);
      rec.group.worldToLocal(_tmpV2);
      m.position.copy(_tmpV2);
      // ragged: a small deterministic tilt so two bites never line up
      const j = h01(p.x, p.z);
      m.rotation.set((j - 0.5) * 0.5, (h01(p.z, p.x) - 0.5) * 0.6, (j - 0.5) * 0.4);
      m.castShadow = false;
      rec.group.add(m);
      rec._holes = (rec._holes || 0) + 1;
    } catch (e) {}
  }

  /* SHE GOES DOWN. Not a delete: the crew go over the side, the engine is
     gutted, and water_float.js's own flooding model takes the hull to the
     seabed with a real arc — the same owner that already sinks a drowned car
     and a corpse. */
  function sink(rec) {
    if (!rec || rec._sinking) return;
    rec._sinking = true;
    rec.engineDead = true;
    rec.v = 0; rec.vx = 0; rec.vz = 0;
    rec.route = null; rec.anchored = false;
    rec.dead = true;                        // the ENGINE is dead; the hull still floats
    AUDIT.sunk++;
    CBZ.hullOccupantsOverboard(rec, { cause: "sink" });
    splash(rec.pos.x, rec.pos.z, 2.4);
    const spec = rec._hullSpec, st = stabOf(spec);
    if (typeof CBZ.waterFloat === "function") {
      const swampT = Math.max(1.5, num(st.swampT, 10) * 0.5);
      rec._floatH = CBZ.waterFloat(rec, {
        len: num(spec.loa, 6), beam: num(spec.beam, 2),
        buoy: 1, waterlog: 1 / swampT, keepDead: true,
        sinkPitch: (h01(rec.pos.x, rec.pos.z) < 0.5 ? -1 : 1) * 0.5,
        heading: function () { return rec.heading; },
        kind: "boat",
        onSettle: function () { despawn(rec); },
      });
    }
    rec._sinkT = 60;
  }

  // ============================================================
  //  §7. THE BOAT GOES IN THE MOUTH
  // ============================================================
  /* engulf(rec, eater) — the whole craft is drawn to the tooth ring over about
     half a second and then it is gone, its people killed through the SAME bus
     the mount's own survivor bite uses (so the killfeed and the mass ledger
     stay honest) and its own tonnage credited as a meal. */
  function engulf(rec, eater) {
    if (!rec || rec.dead || !eater || rec._engulf) return false;
    rec._engulf = { by: eater, t: 0, dur: 0.5 };
    alarmAt(rec.pos.x, rec.pos.z, 130, true);
    rec.engineDead = true; rec.route = null; rec.anchored = false;
    rec.v = 0;
    return true;
  }

  function jawOf(a) {
    if (typeof CBZ.creatureJawWorld === "function") {
      try { return CBZ.creatureJawWorld(a); } catch (e) {}
    }
    const p = a && (a.pos || (a.group && a.group.position));
    if (!p) return null;
    const h = num(a.heading, 0);
    const L = lenOf(a) * 0.45;
    return { x: p.x + Math.cos(h) * L, y: p.y, z: p.z + Math.sin(h) * L };
  }

  function engulfTick(rec, dt) {
    const E = rec._engulf;
    const a = E.by;
    if (!a || a.dead) { rec._engulf = null; return; }
    E.t += dt;
    const J = jawOf(a);
    if (J) {
      const k = 1 - Math.exp(-dt * (6 + 20 * (E.t / E.dur)));
      rec.pos.x += (J.x - rec.pos.x) * k;
      rec.pos.z += (J.z - rec.pos.z) * k;
      rec._pullY = num(rec._pullY, rec.group.position.y);
      rec._pullY += (J.y - rec._pullY) * k;
      rec.group.position.set(rec.pos.x, rec._pullY, rec.pos.z);
      rec.heading = num(a.heading, rec.heading);
      _e.set(0.4 * (E.t / E.dur), rec.heading, num(rec._heel, 0), "YXZ");
      rec.group.quaternion.setFromEuler(_e);
      // the crew ride it into the mouth (calm: nobody falls off a boat in a jaw)
      seatCrew(rec, dt, true);
    }
    if (E.t < E.dur) return;
    swallow(rec, a);
  }

  function swallow(rec, a) {
    const spec = rec._hullSpec;
    const loa = num(spec.loa, 6);
    const crewN = rec.crew.length;
    const name = (a.species && String(a.species.name || a.species.id).toLowerCase()) || "shark";
    // the people aboard, through the mode's own kill bus
    for (let i = 0; i < rec.crew.length; i++) {
      const b = rec.crew[i];
      if (!b || b.dead) continue;
      unseat(b);
      if (CBZ.surv && typeof CBZ.surv.hurt === "function" && CBZ.bots && CBZ.bots.indexOf(b) >= 0) {
        try {
          CBZ.surv.hurt(b, 9999, {
            fromX: a.pos.x, fromZ: a.pos.z, force: 6, fling: 3,
            cause: "eaten by a " + name, by: a, lens: false,
          });
        } catch (e) { b.dead = true; }
      } else if (typeof CBZ.cityKillPed === "function") {
        try { CBZ.cityKillPed(b, { fromX: a.pos.x, fromZ: a.pos.z, force: 6, byPlayer: true, by: a }, "eaten by a " + name); } catch (e) { b.dead = true; }
      } else b.dead = true;
    }
    rec.crew.length = 0;
    splash(rec.pos.x, rec.pos.z, 3.0);
    // the meal is billed BEFORE the record leaves the world, and it is billed
    // dead — the ladder refuses a chomp that did not kill (shark_sim.js).
    rec.dead = true;
    rec._engulf = null;
    AUDIT.eaten++;
    if (loa > AUDIT.biggestEatenM) AUDIT.biggestEatenM = +loa.toFixed(1);
    const isPlayer = !!(CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === a);
    if (typeof CBZ.wildlifeCreditMeal === "function") {
      try { CBZ.wildlifeCreditMeal(a, rec, "craft", { player: isPlayer }); } catch (e) {}
    }
    if (typeof CBZ.sharkSimBite === "function") {
      try { CBZ.sharkSimBite("craft", rec, a); } catch (e) {}
    }
    despawn(rec);
  }

  // ============================================================
  //  §3d. WHAT THE PEOPLE ABOARD ARE DOING WITH THEIR ARMS
  // ============================================================
  /* animChar poses a seated body in the chair solve and RETURNS (the seated
     branch owns the whole rig), so nothing about the job ever reached the
     arms: a kayaker sat with his hands in his lap at three knots and a
     fisherman looked at the horizon with no rod. This is a late layer written
     AFTER animChar, blended by a per-body weight so it eases in and out:

       paddle  both arms forward, alternating strokes, a torso twist into
               each one; faster when he is running from something
       rod     the fishing arm out over the rail (the line itself is drawn
               in §3e from the same hand)
       point   head and chest turned to the fin, one arm straight at it
       wave    both arms up over the head, flailing: the scream
       helm    the man driving hunches over the wheel when she is running

     A STANDING man turns his whole body to look (the berth yaw is blended
     toward the bearing); a seated one turns his chest and head. */
  function damp1(cur, want, rate, dt) { return cur + (want - cur) * Math.min(1, rate * dt); }
  function crewAct(rec, b, seat, idx, dt) {
    const ch = b.char;
    if (!ch || !ch.parts) return;
    const P = ch.parts, J = ch.low || {};
    const alarmed = rec.alarm > 0.02 && rec.seen;
    const helm = idx === 0 && seat.kind === "helm";
    const paddled = rec._hullSpec && rec._hullSpec.engine === false;
    let act = null;
    if (paddled && idx === 0) act = Math.abs(rec.v) > 0.25 ? "paddle" : (alarmed ? "wave" : null);
    else if (alarmed) act = helm ? (rec.mood === "flee" ? "helm" : "point") : ((idx & 1) ? "point" : "wave");
    else if (rec.lines && !helm && !seat.stand) act = "rod";
    else if (rec.lines && seat.stand && idx > 0) act = "rod";
    const w = b._actW = damp1(num(b._actW, 0), act ? 1 : 0, act ? 4 : 2.5, dt);
    if (act) b._act = act;
    // the bearing to the fin, in this body's own frame
    let rel = 0;
    if (rec.seen) {
      const bear = Math.atan2(rec.seen.x - b.pos.x, rec.seen.z - b.pos.z);
      rel = wrapA(bear - rec.heading - num(seat.yaw, 0));
    }
    const look = alarmed && act !== "paddle" && act !== "helm";
    b._lookYaw = damp1(num(b._lookYaw, 0), look && seat.stand ? rel : 0, 3, dt);
    if (w < 0.01) { b._act = null; return; }
    const k = w, mix = function (o, key, v) { o[key] = o[key] + (v - o[key]) * k; };
    const t = (b._actPh = num(b._actPh, h01(idx, b.pos.x) * 6) + dt * (b._act === "paddle" ? (rec.mood === "flee" ? 9 : 5.2) : 8.5));
    switch (b._act) {
      case "paddle": {
        const s = Math.sin(t);
        if (P.la) { mix(P.la.rotation, "x", -1.05 + s * 0.42); mix(P.la.rotation, "z", -0.18); }
        if (P.ra) { mix(P.ra.rotation, "x", -1.05 - s * 0.42); mix(P.ra.rotation, "z", 0.18); }
        if (J.la) mix(J.la.rotation, "x", -0.55 - Math.max(0, s) * 0.35);
        if (J.ra) mix(J.ra.rotation, "x", -0.55 - Math.max(0, -s) * 0.35);
        if (ch.body) { mix(ch.body.rotation, "y", s * 0.3); mix(ch.body.rotation, "x", 0.12); }
        break;
      }
      case "rod": {
        const bob = Math.sin(t * 0.25) * 0.05;
        if (P.ra) { mix(P.ra.rotation, "x", -1.05 + bob); mix(P.ra.rotation, "z", 0.22); }
        if (J.ra) mix(J.ra.rotation, "x", -0.75);
        if (P.la) { mix(P.la.rotation, "x", -0.75 + bob); mix(P.la.rotation, "z", -0.1); }
        if (J.la) mix(J.la.rotation, "x", -0.9);
        break;
      }
      case "point": {
        const by = seat.stand ? 0 : clamp(rel, -0.9, 0.9);
        if (ch.body) mix(ch.body.rotation, "y", by);
        if (ch.neck) mix(ch.neck.rotation, "y", clamp((seat.stand ? rel - b._lookYaw : rel - by), -0.7, 0.7));
        if (P.ra) { mix(P.ra.rotation, "x", -1.5 + Math.sin(t * 0.7) * 0.06); mix(P.ra.rotation, "z", 0.08); mix(P.ra.rotation, "y", 0); }
        if (J.ra) mix(J.ra.rotation, "x", -0.05);
        if (P.la) { mix(P.la.rotation, "x", -0.35); mix(P.la.rotation, "z", -0.25); }
        break;
      }
      case "wave": {
        const f = Math.sin(t) * 0.3;
        if (ch.body && !seat.stand) mix(ch.body.rotation, "y", clamp(rel, -0.6, 0.6));
        if (ch.neck) mix(ch.neck.rotation, "y", clamp(rel * 0.5, -0.6, 0.6));
        if (P.la) { mix(P.la.rotation, "x", -2.55); mix(P.la.rotation, "z", -0.35 - f); }
        if (P.ra) { mix(P.ra.rotation, "x", -2.55); mix(P.ra.rotation, "z", 0.35 - f); }
        if (J.la) mix(J.la.rotation, "x", -0.35 - Math.abs(f));
        if (J.ra) mix(J.ra.rotation, "x", -0.35 - Math.abs(f));
        break;
      }
      case "helm": {
        if (ch.body) mix(ch.body.rotation, "x", 0.22);
        if (ch.neck) mix(ch.neck.rotation, "y", clamp(rel, -0.8, 0.8) * (Math.sin(t * 0.4) > 0.6 ? 1 : 0));
        break;
      }
    }
    // the neck turn is not one animChar resets: take it home ourselves
    if (ch.neck && b._act !== "point" && b._act !== "wave" && b._act !== "helm") ch.neck.rotation.y *= 1 - Math.min(1, dt * 3);
  }

  // ============================================================
  //  §3e. LINES OVER THE SIDE — every rod and line in the sea, ONE draw call
  // ============================================================
  /* A fisherman is a man with a line in the water. Each rod is two segments
     (butt to tip, tip to where the line enters the sea) in one shared
     LineSegments whose buffer is rewritten each frame for the near hulls
     only: a trolling boat trails two lines astern from the transom holders,
     an anchored one has a line over the side per angler. */
  const LINE_CAP = 48;
  let lineSeg = null;
  function lineMesh() {
    const root = sceneRoot();
    if (lineSeg && lineSeg.parent === root) return lineSeg;
    if (!root) return null;
    if (!lineSeg) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(LINE_CAP * 4 * 3), 3));
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(LINE_CAP * 4 * 3), 3));
      g.attributes.position.setUsage(THREE.DynamicDrawUsage);
      g.setDrawRange(0, 0);
      const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
      lineSeg = new THREE.LineSegments(g, m);
      lineSeg.frustumCulled = false;
      lineSeg.name = "sea_craft_lines";
      lineSeg.renderOrder = 2;
    }
    root.add(lineSeg);
    return lineSeg;
  }
  let lineN = 0;
  function pushSeg(ax, ay, az, bx, by, bz, c) {
    if (lineN >= LINE_CAP * 2) return;
    const P = lineSeg.geometry.attributes.position.array, C = lineSeg.geometry.attributes.color.array;
    const o = lineN * 6;
    P[o] = ax; P[o + 1] = ay; P[o + 2] = az; P[o + 3] = bx; P[o + 4] = by; P[o + 5] = bz;
    C[o] = C[o + 3] = c; C[o + 1] = C[o + 4] = c; C[o + 2] = C[o + 5] = c * 1.02;
    lineN++;
  }
  function rodsFor(rec) {
    const spec = rec._hullSpec, h = rec.heading;
    const fx = Math.sin(h), fz = Math.cos(h), sx = -Math.cos(h), sz = Math.sin(h);   // fwd, starboard
    const t = (typeof CBZ.waterClock === "function" ? CBZ.waterClock() : 0);
    if (rec.jobKind === "troll") {
      // two rods in the transom holders, lines streaming astern and out
      const st = num(spec.sternOffset, num(spec.loa, 8) * 0.5) * 0.92;
      const deck = rec.group.position.y + num(spec.deckY, 0.8);
      for (let s = -1; s <= 1; s += 2) {
        const bx = rec.pos.x - fx * st + sx * s * num(spec.beam, 3) * 0.32, bz = rec.pos.z - fz * st + sz * s * num(spec.beam, 3) * 0.32;
        const tx = bx - fx * 1.2 + sx * s * 1.4, tz = bz - fz * 1.2 + sz * s * 1.4, ty = deck + 2.4;
        pushSeg(bx, deck + 0.4, bz, tx, ty, tz, 0.12);
        const L = 26 + s * 4;
        const wx = tx - fx * L + sx * s * 6, wz = tz - fz * L + sz * s * 6;
        pushSeg(tx, ty, tz, wx, seaY(wx, wz) + 0.02, wz, 0.82);
      }
      return;
    }
    for (let i = 0; i < rec.crew.length; i++) {
      const b = rec.crew[i];
      if (!b || b._act !== "rod" || !(b._actW > 0.3)) continue;
      const seat = rec._seats[num(b._aboardSeat, i)]; if (!seat) continue;
      const side = seat.x > 0.05 ? -1 : (seat.x < -0.05 ? 1 : ((i & 1) ? 1 : -1));   // local +X is port
      const hx = b.pos.x + fx * 0.35 + sx * side * 0.3, hz = b.pos.z + fz * 0.35 + sz * side * 0.3;
      const hy = b.pos.y + (seat.stand ? 1.15 : 0.85);
      const bob = Math.sin(t * 0.8 + i * 1.7) * 0.12;
      const tx = hx + sx * side * 1.7 + fx * 0.6, tz = hz + sz * side * 1.7 + fz * 0.6, ty = hy + 1.25 + bob;
      pushSeg(hx, hy, hz, tx, ty, tz, 0.12);
      const wx = tx + sx * side * 4.5 + fx * 1.5, wz = tz + sz * side * 4.5 + fz * 1.5;
      pushSeg(tx, ty, tz, wx, seaY(wx, wz) + 0.02, wz, 0.82);
    }
  }
  function linesTick() {
    if (!lineMesh()) return;
    lineN = 0;
    for (let i = 0; i < craft.length; i++) {
      const rec = craft[i];
      if (rec._far || !rec.lines || rec.dead || rec._capsized || !rec.crew.length) continue;
      rodsFor(rec);
    }
    const g = lineSeg.geometry;
    g.setDrawRange(0, lineN * 2);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    lineSeg.visible = lineN > 0;
  }

  // ============================================================
  //  §10. FAR HULLS — the sea can be busy because distance is cheap
  // ============================================================
  /* MEASURED ON HEAD: one hull is 13-38 meshes (a kayak 14, a skiff 25, a
     console 38) and every crewman is another 21. Eight hulls with seventeen
     people was already ~540 potential draw calls; thirty-odd hulls drawn the
     same way would be two thousand. So only the NEAREST few hulls are the
     real thing (full hull, live crew rigs, lines, wakes). Every other hull is
     ONE INSTANCE of its own class's impostor: the real hull template baked
     once into a single vertex-coloured geometry (the same silhouette to the
     centimetre, because it IS that hull), drawn with its whole class in one
     InstancedMesh — and everyone aboard a far hull is one instance of a
     small figure in another. The real hull and crew stay in the scene with
     visible=false and keep their state; the rules, the bite scan and the
     damage model never know. Anything past the fog is not drawn at all.

     Cost: <= MAX_FULL real hulls + one call per hull CLASS in view + one for
     all the far people + one for all the lines. */
  const MAX_FULL = 6;
  const NEAR_IN = 120, NEAR_OUT = 140;            // m from the camera, with hysteresis
  const IMP_CAP = 20;
  const imp = new Map();                           // key -> { mesh, n }
  let impMat = null, figMesh = null, figN = 0;
  const _m4 = new THREE.Matrix4(), _m4b = new THREE.Matrix4(), _p3 = new THREE.Vector3(), _s3 = new THREE.Vector3(1, 1, 1);
  const _col = new THREE.Color();
  function impostorGeo(key) {
    const R = MH();
    if (!R) return null;
    let g = null;
    try { g = R.build(R.get(key) ? key : "dinghy"); } catch (e) { g = null; }
    if (!g) return null;
    g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.updateMatrixWorld(true);
    const pos = [], nor = [], col = [];
    const _n3 = new THREE.Matrix3(), va = new THREE.Vector3(), na = new THREE.Vector3();
    g.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.visible) return;
      const geo = o.geometry, P = geo.attributes.position;
      if (!P) return;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      if (geo.boundingSphere && geo.boundingSphere.radius < 0.12) return;   // a cleat is not a silhouette
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const N = geo.attributes.normal;
      const idx = geo.index;
      _n3.getNormalMatrix(o.matrixWorld);
      const groups = (Array.isArray(o.material) && geo.groups.length) ? geo.groups : [{ start: 0, count: idx ? idx.count : P.count, materialIndex: 0 }];
      for (let gi = 0; gi < groups.length; gi++) {
        const G = groups[gi], m = mats[G.materialIndex] || mats[0];
        if (!m || m.visible === false) continue;
        if (m.transparent && num(m.opacity, 1) < 0.3) continue;
        _col.setRGB(1, 1, 1);
        if (m.color) _col.copy(m.color);
        if (m.emissive) { const ei = num(m.emissiveIntensity, 1) * 0.5; _col.r += m.emissive.r * ei; _col.g += m.emissive.g * ei; _col.b += m.emissive.b * ei; }
        if (m.transparent) _col.multiplyScalar(0.55);      // glass reads dark from outside
        const end = Math.min(G.start + G.count, idx ? idx.count : P.count);
        for (let k = G.start; k < end; k++) {
          const vi = idx ? idx.getX(k) : k;
          va.fromBufferAttribute(P, vi).applyMatrix4(o.matrixWorld);
          pos.push(va.x, va.y, va.z);
          if (N) { na.fromBufferAttribute(N, vi).applyMatrix3(_n3).normalize(); nor.push(na.x, na.y, na.z); } else nor.push(0, 1, 0);
          col.push(_col.r, _col.g, _col.b);
        }
      }
    });
    if (!pos.length) return null;
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }
  function impFor(key) {
    const root = sceneRoot();
    if (!root) return null;
    let I = imp.get(key);
    if (I === null) return null;                     // could not be baked: keep the real hull
    if (!I) {
      const geo = impostorGeo(key);
      if (!geo) { imp.set(key, null); return null; }
      if (!impMat) impMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      const mesh = new THREE.InstancedMesh(geo, impMat, IMP_CAP);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;                    // r128 culls an InstancedMesh by the template's sphere
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.name = "sea_craft_far_" + key;
      mesh.count = 0;
      I = { mesh: mesh, n: 0 };
      imp.set(key, I);
    }
    if (I.mesh.parent !== root) root.add(I.mesh);
    return I;
  }
  const FIG_CAP = 96;
  const FIG_COLS = [0x2d4b73, 0xc9c3b4, 0x8b2d2a, 0x3b3b3b, 0xd8d2c0, 0x2f6b4f, 0xb5732e];
  function figFor() {
    const root = sceneRoot();
    if (!root) return null;
    if (!figMesh) {
      const g = new THREE.BoxGeometry(0.46, 1.0, 0.3);
      g.translate(0, 0.5, 0);
      const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
      figMesh = new THREE.InstancedMesh(g, m, FIG_CAP);
      figMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      figMesh.frustumCulled = false; figMesh.castShadow = false;
      figMesh.name = "sea_craft_far_people";
      for (let i = 0; i < FIG_CAP; i++) { _col.setHex(FIG_COLS[i % FIG_COLS.length]); figMesh.setColorAt(i, _col); }
      if (figMesh.instanceColor) figMesh.instanceColor.needsUpdate = true;
      figMesh.count = 0;
    }
    if (figMesh.parent !== root) root.add(figMesh);
    return figMesh;
  }
  function mustBeReal(rec) {
    return !!(rec._engulf || rec._sinking || rec._capsized || rec._holes || rec._floatH);
  }
  let tierT = 0;
  const _order = [];
  function tierTick(dt) {
    tierT -= dt;
    if (tierT > 0) return;
    tierT = 0.25;
    const cam = CBZ.camera;
    if (!cam) return;
    const cx = cam.position.x, cz = cam.position.z;
    const fog = CBZ.scene && CBZ.scene.fog;
    const gone = fog && fog.far ? fog.far + 40 : 1e9;
    _order.length = 0;
    for (let i = 0; i < craft.length; i++) {
      const rec = craft[i];
      rec._camD = Math.hypot(rec.pos.x - cx, rec.pos.z - cz);
      _order.push(rec);
    }
    _order.sort(function (a, b) { return a._camD - b._camD; });
    let full = 0;
    for (let i = 0; i < _order.length; i++) {
      const rec = _order[i];
      const lim = rec._far ? NEAR_IN : NEAR_OUT;
      let far = !(rec._camD < lim && full < MAX_FULL);
      if (mustBeReal(rec)) far = false;
      if (far && !impFor(rec.detailStyle || rec.key)) far = false;
      if (!far) full++;
      rec._hidden = far && rec._camD > gone;
      setFar(rec, far);
    }
  }
  function setFar(rec, far) {
    if (!!rec._far === far) return;
    rec._far = far;
    rec.group.visible = !far;
    for (let i = 0; i < rec.crew.length; i++) {
      const b = rec.crew[i];
      if (b && b.group) b.group.visible = !far;
    }
  }
  function farDraw() {
    imp.forEach(function (I) { if (I) I.n = 0; });
    figN = 0;
    const F = figFor();
    for (let i = 0; i < craft.length; i++) {
      const rec = craft[i];
      if (!rec._far || rec._hidden) continue;
      const I = impFor(rec.detailStyle || rec.key);
      if (!I || I.n >= IMP_CAP) continue;
      rec.group.updateMatrix();
      I.mesh.setMatrixAt(I.n++, rec.group.matrix);
      if (!F) continue;
      for (let k = 0; k < rec.crew.length && figN < FIG_CAP; k++) {
        const b = rec.crew[k];
        const seat = b && rec._seats[num(b._aboardSeat, k)];
        if (!seat) continue;
        _p3.set(seat.x, seat.floor, seat.z).applyMatrix4(rec.group.matrix);
        _s3.set(1, seat.stand ? 1.65 : 0.95, 1);
        _m4.compose(_p3, rec.group.quaternion, _s3);
        F.setMatrixAt(figN++, _m4);
      }
    }
    imp.forEach(function (I) {
      if (!I) return;
      I.mesh.count = I.n; I.mesh.visible = I.n > 0;
      I.mesh.instanceMatrix.needsUpdate = true;
    });
    if (F) { F.count = figN; F.visible = figN > 0; F.instanceMatrix.needsUpdate = true; }
  }
  function dropFar() {
    imp.forEach(function (I) { if (I && I.mesh.parent) I.mesh.parent.remove(I.mesh); });
    if (figMesh && figMesh.parent) figMesh.parent.remove(figMesh);
    if (lineSeg && lineSeg.parent) lineSeg.parent.remove(lineSeg);
  }

  // ============================================================
  //  §8. THE TICK. Order 37.9 — before water_buoyancy's own pass (38.5, which
  //  only ever walks cityCars) and before the stability post-pass (38.7).
  // ============================================================
  CBZ.onUpdate(37.9, function (dt) {
    dt = clamp(num(dt, 0.016), 0.001, 0.05);
    if (falling.length) tickFalling(dt);     // men in the air outlive the hull they left
    if (!craft.length) { if (lineSeg && lineSeg.visible) lineSeg.visible = false; return; }
    threatT -= dt;
    const spot = threatT <= 0;
    if (spot) { threatT = 0.3; spotTick(); }
    tierTick(dt);
    // §5b: the hulls' share of last frame's contacts, then hull vs hull
    applyContactShoves(dt);
    boatPairs();
    for (let i = craft.length - 1; i >= 0; i--) {
      const rec = craft[i];
      if (!rec || !rec.group || !rec.group.parent) { craft.splice(i, 1); continue; }
      if (rec._ramCd > 0) rec._ramCd -= dt;
      trackCraftVel(rec, dt);

      if (rec._engulf) { engulfTick(rec, dt); continue; }
      if (rec._sinking) {
        // water_float owns the transform from here; we only time it out so a
        // wreck that drifted onto dry land still leaves.
        rec._sinkT -= dt;
        if (rec._sinkT <= 0) despawn(rec);
        continue;
      }

      rec._apWake = false;
      if (rec.alarm > 0) rec.alarm = Math.max(0, rec.alarm - dt / (rec.mood === "calm" ? 6 : 20));
      if (spot) swimmersTick(rec);
      if (rec._capsized) moveDrifting(rec, dt);
      else if (rec.engineDead) moveDrifting(rec, dt);
      else if (rec.jobKind) helmTick(rec, dt);
      else if (rec.anchored) moveAnchored(rec, dt);
      else if (rec.route) moveCruising(rec, dt);
      else moveDrifting(rec, dt);

      heelTick(rec, dt);
      /* WATER COMES IN THROUGH A HOLE, NOT THROUGH A CAPSIZE. A hull with a
         bite out of it founders on its own class's timetable (swampT is the
         seconds of green water it can take, so a 5.5 m open skiff has minutes
         less of it than a trawler); a hull merely turned over floats INVERTED
         the way a real one does — the air is trapped under it — and is
         abandoned wreckage rather than a boat that sinks because it rolled. */
      if (rec._holed) rec._swamp = num(rec._swamp, 0) + dt * 0.35;
      if (rec._capsized) {
        rec._wreckT = num(rec._wreckT, 0) + dt;
        if (rec._wreckT > 90) { despawn(rec); continue; }   // and the fleet restocks it
      }
      /* SHE MAY GO OVER A BEAT AFTER THE HIT. water_stability.js integrates a
         real roll, so a hull pushed past its angle of vanishing stability
         capsizes on some later frame, not inside the impulse call — this is
         where we notice, and it is the only place `tipped` is counted. */
      if (!rec._capsized && typeof CBZ.hullCapsized === "function" && CBZ.hullCapsized(rec)) onCapsize(rec);
      if (rec._swamp > 0 && rec._swamp >= num(stabOf(rec._hullSpec).swampT, 10)) { sink(rec); continue; }

      if (rec._hidden) continue;          // past the fog: nobody can see where she sits
      ride(rec, dt);
      seatCrew(rec, dt, false);
    }
    farDraw();
    linesTick();
  });

  // ============================================================
  //  §9. THE SEAM
  // ============================================================
  CBZ.seaCraft = {
    spawn: spawn,
    list: function () { return craft; },
    despawn: despawn,
    despawnAll: despawnAll,
    hurt: hurt,
    sink: sink,
    engulf: engulf,
    capsize: onCapsize,
    spec: specOfRec,
    stab: stabOf,
    // a shark was seen / something happened here: every crewed hull within r reacts
    alarm: alarmAt,
    wind: windNow,
    jobs: function () { return Object.keys(JOBS); },
    audit: function () {
      let alive = 0, crewed = 0, far = 0, fleeing = 0, underWay = 0;
      for (let i = 0; i < craft.length; i++) {
        if (craft[i].dead || craft[i]._sinking) continue;
        alive++; crewed += craft[i].crew.length;
        if (craft[i]._far) far++;
        if (craft[i].mood === "flee") fleeing++;
        if (Math.abs(craft[i].v) > 0.6) underWay++;
      }
      return {
        craft: alive, aboard: crewed, falling: falling.length,
        far: far, fleeing: fleeing, underWay: underWay,
        spawned: AUDIT.spawned, eaten: AUDIT.eaten, tipped: AUDIT.tipped,
        sunk: AUDIT.sunk, holed: AUDIT.holed, overboard: AUDIT.overboard,
        rams: AUDIT.rams, bites: AUDIT.bites,
        biggestEatenM: AUDIT.biggestEatenM,
        contacts: COLA.contacts, contactRams: COLA.rams, nudges: COLA.nudges,
        boatPairs: COLA.boatPairs, maxPen: +COLA.maxPen.toFixed(3),
      };
    },
    reset: function () {
      despawnAll();
      dropFar();
      AUDIT.spawned = AUDIT.eaten = AUDIT.tipped = AUDIT.sunk = 0;
      AUDIT.holed = AUDIT.overboard = AUDIT.rams = AUDIT.bites = 0;
      AUDIT.biggestEatenM = 0;
      COLA.contacts = COLA.rams = COLA.nudges = COLA.boatPairs = COLA.maxPen = 0;
    },
    // §5b, for the tests: the measured solid of a hull and the distance to it
    collider: shapeOf,
    colliderFromSpec: shapeFromSpec,
    hullSdf: hullSdf,
  };
})();
