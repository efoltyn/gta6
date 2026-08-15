/* ============================================================
   city/approach.js — THE APPROACH BLOCK (how you get IN and OUT of a property)

   OWNER WANT (2026-08-15)
   -----------------------
   "ingress and egress of a lot of properties needs to be improved."

   WHAT WAS ACTUALLY WRONG, measured, not guessed
   ----------------------------------------------
   Every buildable parcel in this city has a DOOR and nothing else. There is
   no way in and no way out that the world draws, and the code that has to put
   a vehicle on a property proves it three separate times:

   1. THE KERB IS UNBROKEN. city/world.js's roadDetail() rings EVERY block with
      a continuous kerb — `curb(cx, cz - e, span)` x4, a 0.22 m lip with no gap
      anywhere. Not one property in the city has a dropped kerb. You can mount
      it (it carries no collider), but nothing in the world says "the way in is
      here", so every parcel reads as a wall of stone with a pedestrian door in
      the middle of it.

   2. YOUR CAR COMES BACK AT THE FRONT DOOR, SIDEWAYS. realestate.js's
      retrieveCar() spawns at `lot.building.garage || lot.building.door` — and
      `garage` is set on exactly ONE building in the game (buildings.js:6728,
      the Spire). So for every other home the retrieval point is the PEDESTRIAN
      door: a point 1.6 m off the building's face, which for a 28 m building on
      a 30 m lot is 1.4 m from the carriageway. And citySpawnOwnedCar hands
      makeCar a HARD-CODED heading of 0 — so on a north-south street your car
      is delivered lying across both lanes. "Your Sedan is out front" was true
      about the position and a lie about everything else.

   3. NOTHING KNOWS WHERE A CAR BELONGS ON A PARCEL. shops.js's buyCar,
      storage.js's retrieveVehicle and realestate.js's retrieveCar each pick
      their own coordinate and none of them can do better, because no such
      coordinate exists to ask for.

   THIS FILE SHIPS ONE THING: THE APPROACH
   ---------------------------------------
   For every parcel in the grid, an APPROACH is solved ONCE and consumed by
   everything:

       CBZ.cityLotApproach(lot)  ->  { x, z, nx, nz, kerbX, kerbZ,
                                       standX, standZ, heading, half }

   ...where the STAND is where a car actually belongs (a parallel bay on the
   apron, clear of the carriageway) and HEADING points it down the near lane in
   the direction that lane travels, so you drive off instead of three-pointing
   out of a hedge.

   IT ADOPTS BY REPLACEMENT, never by parallel bookkeeping (THE BLOCK LAW):

     · world.js's kerb ring asks this file where the crossings are and leaves a
       GAP in the stone. One author (the approach), two consumers (the kerb and
       the apron), so a dropped kerb can never end up somewhere the driveway
       is not. Feature-detected: no approach.js -> the old unbroken ring.
     · `lot.building.garage` is FILLED IN for every parcel that hasn't got one,
       which is the field realestate.js ALREADY reads. That call site does not
       change by one character.
     · citySpawnOwnedCar is WRAPPED — the same wrapper marina.js uses to make
       every retrieval path berth-aware for boats — so a car that spawns on a
       stand is turned to face the road. Marine hulls are passed straight
       through untouched: marina.js owns the water and this file owns the kerb.

   WHY THE HEADING FORMULA IS WHAT IT IS. In this engine a heading h has
   forward = (sin h, cos h) and the vehicle's own right = (cos h, -sin h)
   (rotation.y turns local +x toward -z). Right-hand traffic means a car drives
   on the side its RIGHT points to. A parcel's outward door normal n points at
   the road, so the parcel lies on the -n side of it, so the near lane is the
   one whose right is -n:  cos h = -nx, sin h = nz  ->  h = atan2(nz, -nx).
   Two lines of algebra beats four hand-typed cases that disagree on one axis.

   DETERMINISM: pure geometry. No random draw of any kind, in any path.

   FLAGS (one-line revert each):
     CBZ.CONFIG.LOT_APPROACH        (true)  — solve approaches at all
     CBZ.CONFIG.LOT_APPROACH_PAVING (true)  — draw the aprons and dropped kerbs
     CBZ.CONFIG.LOT_APPROACH_SPAWN  (true)  — the citySpawnOwnedCar wrapper

   Exposes: CBZ.cityLotApproach, CBZ.cityApproach, CBZ.cityApproachAudit.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (C.LOT_APPROACH == null) C.LOT_APPROACH = true;
  if (C.LOT_APPROACH_PAVING == null) C.LOT_APPROACH_PAVING = true;
  if (C.LOT_APPROACH_SPAWN == null) C.LOT_APPROACH_SPAWN = true;

  // The crossing's width. 5.4 m is a two-car driveway (2 x 2.4 m plus the
  // margin a door needs), which is what a parcel of this size fronting a
  // four-lane street would actually have. The kerb gap is the SAME number
  // plus a flare, because a dropped kerb wider than its driveway is what a
  // real one looks like and it is also what stops a car clipping the stone.
  const DRIVE_W = 5.4;
  const FLARE = 1.1;
  // How far in from the kerb a parked car's CENTRELINE sits. A car is ~1.9 m
  // across the beam; half of that plus 0.35 m of daylight keeps the body
  // entirely off the carriageway.
  const STAND_IN = 1.30;

  /* ============================================================
     PART 1 — THE SOLVE. Pure geometry, no world state, no side effects.
     ------------------------------------------------------------
     `side` is derived exactly the way city/buildings.js derives it (the face
     turned toward the city centre), because that is the face the door is put
     on. This is deliberately the SAME two lines rather than a lookup of the
     built door: the kerb ring in world.js runs BEFORE any building exists, and
     a kerb gap that disagrees with its own driveway is worse than no gap.
     ============================================================ */
  function centreOf(lot) {
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.center) return A.center;
    const CT = CBZ.CITY && CBZ.CITY.center;
    return CT || { x: 0, z: 0 };
  }

  const _cache = new WeakMap();

  function solve(lot, center) {
    if (!lot || !isFinite(lot.cx) || !isFinite(lot.cz)) return null;
    const cached = _cache.get(lot);
    if (cached) return cached;
    const ctr = center || centreOf(lot);
    const toCx = ctr.x - lot.cx, toCz = ctr.z - lot.cz;
    // the face turned toward the centre — buildings.js:doorInfo's `side`
    let nx = 0, nz = 0;
    if (Math.abs(toCx) > Math.abs(toCz)) nx = toCx > 0 ? 1 : -1;
    else nz = toCz > 0 ? 1 : -1;
    // The lot pad is inset 2 m inside its block, so the kerb line is
    // (lot.w/2 + 2) out along the normal — the same arithmetic world.js's
    // sidewalkHalf uses, expressed against the lot rather than against BLK so
    // an off-grid parcel (the annex, a town) solves correctly too.
    const halfAlong = (nx ? (lot.w || 30) : (lot.d || 30)) / 2 + 2;
    const kerbX = lot.cx + nx * (halfAlong - 0.2);
    const kerbZ = lot.cz + nz * (halfAlong - 0.2);
    const a = {
      lot: lot,
      x: lot.cx + nx * halfAlong, z: lot.cz + nz * halfAlong,   // the crossing point
      nx: nx, nz: nz,
      kerbX: kerbX, kerbZ: kerbZ,
      standX: kerbX - nx * STAND_IN, standZ: kerbZ - nz * STAND_IN,
      // see the header: right = (cos h, -sin h), and the near lane's right is -n
      heading: Math.atan2(nz, -nx),
      half: DRIVE_W / 2,
    };
    _cache.set(lot, a);
    return a;
  }

  /* THE ORACLE world.js's kerb ring calls, and the ONLY consumer of the
     derivation above. It has to answer for a lot whose building does not exist
     yet — the ring is drawn hundreds of lines before cityBuildings() runs —
     which is why this is a function of the LOT and never of the door. The
     build pass below reads the real door instead and only falls back here,
     and the two agree on the mainland grid because buildings.js picks its
     `side` from these same two lines. */
  CBZ.cityLotApproach = function (lot, center) {
    if (C.LOT_APPROACH === false) return null;
    return solve(lot, center);
  };

  /* ============================================================
     PART 2 — THE REGISTRY. Stands, so a spawn can find the one it is on.
     ============================================================ */
  const stands = [];
  let _wired = 0;        // parcels whose lot.building.garage this file filled in
  let _snapped = 0;      // owned cars this run that were turned onto a stand
  let _roadless = 0;     // parcels whose crossing found no road to reach

  function clearStands() { stands.length = 0; _wired = 0; _roadless = 0; }

  function nearestStand(x, z, r) {
    let best = null, bd = (r || 6) * (r || 6);
    for (let i = 0; i < stands.length; i++) {
      const s = stands[i];
      const dx = s.x - x, dz = s.z - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /* WHERE THE CARRIAGEWAY ACTUALLY IS, along this parcel's own door normal.

     THE FIRST VERSION ASKED THE GRID AND GOT 153 PARCELS WRONG. It derived the
     kerb from `lot.w / 2 + 2` — which is the mainland grid's own inset and is
     true only there. `city.lots` is not the mainland grid: biome_farmland.js,
     towngen.js and the settlement kit all push their parcels into the same
     array, and a farmhouse on a lane 30 m away has neither a 52 m block pitch
     nor a door facing the city centre. Nearly half the properties in the world
     got a driveway measured against a block that does not exist around them.

     So the kerb is now READ OFF THE ROAD LIST — the same records traffic.js
     drives and world.js publishes — by walking out along the door's own
     outward normal to the near edge of the first carriageway that crosses it.
     A parcel with no road out there gets NO driveway and is COUNTED, which is
     the honest answer for a barn in a field and is also the number that tells
     you if the grid itself has stopped being served.

     Returns the distance from the lot centre to the kerb line, or 0.  */
  function kerbAlong(lot, nx, nz, roads, maxReach) {
    if (!roads || !roads.length) return 0;
    let best = 0;
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i];
      const half = (r.w || 18) / 2;
      let d, lateral;
      if (r.vertical) {
        if (!nx) continue;                                  // a normal along z cannot meet it
        d = (r.x - lot.cx) * nx - half;
        lateral = Math.abs(lot.cz - r.z) - (r.len || 0) / 2;
      } else {
        if (!nz) continue;
        d = (r.z - lot.cz) * nz - half;
        lateral = Math.abs(lot.cx - r.x) - (r.len || 0) / 2;
      }
      if (d <= 1 || d > maxReach) continue;                 // behind us, or too far to serve
      if (lateral > 2) continue;                            // the segment does not reach this parcel
      if (!best || d < best) best = d;
    }
    return best;
  }

  /* ============================================================
     PART 3 — THE BUILD. Aprons, dropped kerbs, and the garage wiring.
     ------------------------------------------------------------
     Runs as a landmass builder, which world.js calls from cityWorldGeo AFTER
     cityBuildings — so `lot.building` exists and can be wired here. Order 67:
     immediately after the marina (66), well before the late passes.
     ============================================================ */
  CBZ.addLandmass && CBZ.addLandmass(function (city) {
    if (C.LOT_APPROACH === false) return null;
    if (!city || !city.root || !window.THREE) return null;
    clearStands();
    const THREE = window.THREE;
    const root = city.root;
    const center = city.center || centreOf(null);
    const roads = city.roads || [];
    const lots = (city.lots || []).concat(city.shopLots || []);
    if (!lots.length) return null;

    const apron = [], dropped = [], edges = [];
    const BGU = THREE.BufferGeometryUtils;
    function quad(x, z, w, d, y) {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(x, y, z);
      return g;
    }
    function mergeAdd(geoms, hex, y) {
      if (!geoms.length) return null;
      const mat = CBZ.cmat ? CBZ.cmat(hex) : new THREE.MeshLambertMaterial({ color: hex });
      if (BGU && BGU.mergeBufferGeometries) {
        const mesh = new THREE.Mesh(BGU.mergeBufferGeometries(geoms), mat);
        mesh.receiveShadow = true; mesh.castShadow = false;
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        root.add(mesh);
        return mesh;
      }
      for (const g of geoms) {
        const mesh = new THREE.Mesh(g, mat);
        mesh.receiveShadow = true; mesh.castShadow = false; root.add(mesh);
      }
      return null;
    }

    const seen = new Set();
    for (const lot of lots) {
      if (!lot || seen.has(lot)) continue;
      seen.add(lot);
      const b = lot.building;
      // A PARK IS NOT A PROPERTY. buildings.js hands parks a benign door at the
      // lot's own centre and no `side`; a park does not get a driveway, it gets
      // a gate, and giving it one would put a stand in the middle of a lawn.
      if (b && b.park) continue;
      const geo = solve(lot, center);
      if (!geo) continue;

      /* THE DOOR IS THE TRUTH WHEN THERE IS ONE. `solve` derives the face from
         the lot and the city centre because world.js's kerb ring has to run
         before any building exists — but by the time we get here the building
         DOES exist, and an off-grid parcel (a farmhouse, a town lot) has a door
         its own builder chose. Read it, and only fall back to the derivation
         when there is nothing to read. Axis-aligned normals only: a diagonal
         door is somebody else's frontage and this file will not guess at it. */
      let nx = geo.nx, nz = geo.nz, doorAlong = null;
      const door = b && b.door;
      if (door && isFinite(door.nx) && isFinite(door.nz) && (Math.abs(door.nx) > 0.9 || Math.abs(door.nz) > 0.9)) {
        nx = Math.abs(door.nx) > 0.9 ? (door.nx > 0 ? 1 : -1) : 0;
        nz = nx ? 0 : (door.nz > 0 ? 1 : -1);
        doorAlong = (door.x - lot.cx) * nx + (door.z - lot.cz) * nz;
      }

      /* WHERE THE ROAD IS. 34 m of reach: a grid parcel's kerb is 16.8 m out
         and a town or farm parcel's lane can be twice that, but past ~34 m
         what you are drawing is not a driveway, it is a track, and this file
         does not author tracks.

         AND IF THE DOOR FACES THE WRONG WAY, TRY THE OTHER THREE SIDES. A
         farmhouse's front door faces the view; the drive comes off the lane,
         whichever side of the plot the lane happens to run. Insisting the two
         be the same face lost 76 properties that had a road 20 m away round
         the corner. The DOOR does not move — only the crossing does, which is
         exactly the relationship a real property has between the two. Grid
         parcels never reach this: their door face always fronts a street, so
         the fallback cannot pull a driveway off the face world.js already cut
         its kerb for. */
      let kAlong = kerbAlong(lot, nx, nz, roads, 34);
      if (!kAlong) {
        let bestD = 0, bnx = 0, bnz = 0;
        for (const c of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (c[0] === nx && c[1] === nz) continue;
          const d = kerbAlong(lot, c[0], c[1], roads, 34);
          if (d && (!bestD || d < bestD)) { bestD = d; bnx = c[0]; bnz = c[1]; }
        }
        if (!bestD) { _roadless++; continue; }
        kAlong = bestD; nx = bnx; nz = bnz;
        doorAlong = null;                    // the door is on a different face now
      }

      const kerbX = lot.cx + nx * (kAlong - 0.2), kerbZ = lot.cz + nz * (kAlong - 0.2);
      // the building's own face: the door point stands 1.6 m off it
      // (buildings.js's doorPt), so back that off; else the pad's inner edge.
      const frontage = doorAlong != null
        ? Math.max(1, doorAlong - 1.6)
        : (nx ? (lot.w || 30) : (lot.d || 30)) / 2 - 1;
      const run = (kAlong - 0.2) - frontage + 0.6;
      if (run < 1.0) { _roadless++; continue; }             // the door already IS the kerb
      const a = {
        nx: nx, nz: nz,
        x: lot.cx + nx * kAlong, z: lot.cz + nz * kAlong,
        kerbX: kerbX, kerbZ: kerbZ,
        standX: kerbX - nx * STAND_IN, standZ: kerbZ - nz * STAND_IN,
        heading: Math.atan2(nz, -nx),                       // see the header
        half: DRIVE_W / 2,
      };

      // ---- THE APRON. A paved run from the building's frontage out to the
      // kerb, at the door's own centreline. Laid at y = 0.12: above the block
      // pad (0.10) and the sidewalk (0.08), below nothing — so it reads as
      // surfacing on top of the parcel rather than fighting it.
      const along = Math.max(2.4, run);
      const mx = lot.cx + nx * (frontage + along / 2 - 0.3);
      const mz = lot.cz + nz * (frontage + along / 2 - 0.3);
      const aw = a.nx ? along : DRIVE_W, ad = a.nx ? DRIVE_W : along;
      apron.push(quad(mx, mz, aw, ad, 0.12));
      // ---- THE DROPPED KERB. The flared mouth that sits in the gap world.js
      // leaves in the stone ring, running from the kerb line out to the
      // carriageway edge so the transition is surfaced, not a step into air.
      const dw = a.nx ? 1.6 : DRIVE_W + FLARE * 2, dd = a.nx ? DRIVE_W + FLARE * 2 : 1.6;
      dropped.push(quad(a.kerbX + a.nx * 0.55, a.kerbZ + a.nz * 0.55, dw, dd, 0.13));
      // ---- the two painted edge lines that make the crossing read from a car
      for (const s of [-1, 1]) {
        const ox = a.nz ? s * (DRIVE_W / 2) : 0, oz = a.nx ? s * (DRIVE_W / 2) : 0;
        const ew = a.nx ? along : 0.16, ed = a.nx ? 0.16 : along;
        edges.push(quad(mx + ox, mz + oz, ew, ed, 0.135));
      }

      const stand = {
        x: a.standX, z: a.standZ, heading: a.heading,
        lot: lot, kind: (b && b.home) ? "home" : (b && b.shop) ? "shop" : "lot",
      };
      stands.push(stand);

      /* ---- THE WIRING, and this is the whole adoption. `lot.building.garage`
         is the field realestate.js ALREADY reads to decide where a retrieved
         car appears; it existed on ONE building in the game. Filling it in for
         every parcel makes every existing retrieval path put the car on a
         driveway instead of on the doorstep, with zero edits at the call site.
         An authored garage (the Spire's wraparound deck) is never overwritten:
         a building that has already said where its cars go outranks a generic
         solve, which is why this is `if (!b.garage)` and not an assignment. */
      if (b && !b.garage) {
        b.garage = { x: a.standX, z: a.standZ, heading: a.heading, spots: [], approach: true };
        _wired++;
      }
      // ...and the approach itself, for anything that wants the geometry
      // rather than the point (a courier drop, a future valet). A FLAT COPY,
      // deliberately: `a` holds a back-reference to the lot, and lot.building
      // -> approach -> lot -> building is a cycle that would throw the moment
      // anything JSON-serialised a building (worldstate.js commits descriptors
      // built out of these objects).
      if (b) {
        b.approach = { x: a.x, z: a.z, nx: a.nx, nz: a.nz, half: a.half,
                       standX: a.standX, standZ: a.standZ, heading: a.heading };
      }
    }

    if (C.LOT_APPROACH_PAVING !== false) {
      mergeAdd(apron, 0x8f9298);        // asphalt-grey driveway surfacing
      mergeAdd(dropped, 0xa9aeb3);      // the dropped kerb: lighter poured concrete
      mergeAdd(edges, 0xd6dade);        // the painted edge lines
    }
    return null;
  }, 67);

  /* ============================================================
     PART 4 — THE SPAWN WRAPPER.
     ------------------------------------------------------------
     Exactly the pattern city/marina.js uses on the same function, for exactly
     the same reason: three call sites we are forbidden to edit (realestate.js
     retrieveCar, shops.js buyCar, storage.js retrieveVehicle) all funnel here,
     and wrapping is how they become approach-aware without one of them
     changing a character.

     A MARINE HULL IS NOT OURS. marina.js's wrapper redirects boats to a berth
     and stamps `_berthId`; snapping one of those onto a kerbside stand would
     put a yacht in a driveway. Both the name test and the stamp are checked,
     because the two wrappers can be installed in either order.
     ============================================================ */
  function wrapSpawn() {
    const cur = CBZ.citySpawnOwnedCar;
    if (!cur || cur._approachWrapped) return !!(cur && cur._approachWrapped);
    const orig = cur;
    const wrapped = function (x, z, modelName) {
      const car = orig(x, z, modelName);
      if (!car || C.LOT_APPROACH_SPAWN === false) return car;
      if (car._berthId) return car;                                  // marina.js took it
      if (CBZ.cityBerth && CBZ.cityBerth.isMarine && CBZ.cityBerth.isMarine(modelName)) return car;
      // 2.5 m: tight enough that this only ever fires for a caller that ASKED
      // for a stand (they pass lot.building.garage, which IS the stand), never
      // for a showroom forecourt or a lock-up that happens to be down the road.
      const s = nearestStand(car.pos ? car.pos.x : x, car.pos ? car.pos.z : z, 2.5);
      if (!s) return car;
      car.heading = s.heading;
      car.v = 0; car.vx = 0; car.vz = 0; car.baseV = 0; car.road = null; car.ai = false;
      if (car.pos) { car.pos.x = s.x; car.pos.z = s.z; }
      if (car.group) { car.group.position.x = s.x; car.group.position.z = s.z; car.group.rotation.y = s.heading; }
      car._onApproach = true;
      _snapped++;
      return car;
    };
    // carry EVERY existing wrap marker forward (the repo's wrapper doctrine —
    // marina.js's _berthWrapped/_berthOrig must survive this wrap or its own
    // retry loop will re-wrap an already-wrapped function)
    for (const k in orig) { try { wrapped[k] = orig[k]; } catch (e) {} }
    wrapped._approachWrapped = true;
    wrapped._approachOrig = orig;
    CBZ.citySpawnOwnedCar = wrapped;
    return true;
  }
  if (!wrapSpawn() && CBZ.onUpdate) {
    // vehicles.js parses after us in some orders — retry cheaply until it exists
    CBZ.onUpdate(9.31, function () {
      if (!CBZ.citySpawnOwnedCar || CBZ.citySpawnOwnedCar._approachWrapped) return;
      wrapSpawn();
    });
  }

  /* ============================================================
     PUBLIC SURFACE + THE AUDIT
     ------------------------------------------------------------
     `roadless` is the number to watch and it is a MEASUREMENT: parcels whose
     crossing looked for a carriageway within 6 m of the kerb and found none.
     It is deliberately NOT pinned yet — CLAUDE.md's own lesson is that a
     pinned guess trains the next reader to ignore the number. Measure first.
     `wired` prints beside it so a "fix" that stops solving approaches
     altogether cannot pass as a clean run.
     ============================================================ */
  CBZ.cityApproach = {
    of: function (lot) { return solve(lot, null); },
    nearest: nearestStand,
    list: function () { return stands.slice(); },
    count: function () { return stands.length; },
  };
  CBZ.cityApproachAudit = function () {
    let homes = 0, shops = 0;
    for (const s of stands) { if (s.kind === "home") homes++; else if (s.kind === "shop") shops++; }
    return {
      stands: stands.length, homes: homes, shops: shops,
      wired: _wired, roadless: _roadless, snapped: _snapped,
      wrapped: !!(CBZ.citySpawnOwnedCar && CBZ.citySpawnOwnedCar._approachWrapped),
    };
  };
})();
