/* ===========================================================================
   city/captain.js — THE CAPTAIN: a boat, a crew, and the sea as a career.

   OWNER ASK: "another mode that spawns you in a boat as a boat captain."
   Read through the WHY constitution, that is not a spawn point — it is the
   LOYALTY + WEAPONS atom afloat (LAW 2: "anytime you have a ton of people
   loyal to you with weapons could be a gang" — an armed crew that answers to
   you IS that atom at sea), plus the gun-room grammar (LAW 1: gradients of
   VISIBLE access — the next boat up sits on the hard stand behind a locked
   fence; the harbourmaster's good contracts sit behind a rank-gated board).

   WHAT THIS FILE AUTHORS, AND WHAT IT ONLY WIRES
   ------------------------------------------------------------
   Authored here: the captain career spine — the origin launch, the crew
   orders, the voyage board (charters / cargo / fishing trips / salvage / the
   black book), the chart table prop, the fenced prize hull, and the audit.

   Wired, never re-invented (the Block Law):
     · the boat        — an EXISTING hull the world already floats (yachts.js
                         AFLOAT), or boatyard's deliver() through the one
                         owned-vehicle pipe. Never a second hull, never a
                         second spawn path. WHICH hull is the player's pick
                         off the title screen (origins.js cityOriginBoatKey),
                         and every fitting below is solved from that hull's
                         own registered dimensions — see section 0.
     · the helm        — CBZ.cityEnterVehicle + world/water_helm.js. The
                         captain drives exactly what a jacked boat drives.
     · the course-hold — piracy.js's CBZ.marineAutopilot: the ONE AI hand on
                         a wheel. The mate holds her steady with it.
     · the crew        — city/citystaff.js posts (data until 170 m), bodies
                         seated through CBZ.npcLife.attach on a scale-
                         cancelled crew node (seacrew.js's idiom, and its
                         node is REUSED when it already made one).
     · the ranks       — seacrew.js's shipco ladder via rankField "seaRank".
                         No parallel org: the player is JOINED to shipco at
                         the captain rung, the mate holds "moor", and every
                         order gate is CBZ.rankKnows-guarded (the documented
                         degrade-safe pattern — never a bare rankCan test).
     · the fishing     — city/fishing.js's fishWorkRod animates the deckhand;
                         catches pay in wildlife.js's OWN items through
                         cityEcon.add (no fish table here, no second economy).
     · the missions    — core/mission.js, stages for multi-leg voyages. The
                         generator picks the verb, the WORLD supplies the
                         specifics: charters bind to peds the sim already
                         runs, salvage binds to hulls already derelict, the
                         black book binds to vessels piracy.js already prices.
     · the hold        — city/vehicle_hold.js. ONE call makes the trawler's
                         working deck a walk-in cargo ROOM (floor, bulwark
                         walls, a stern gate with its own phased arc + verb),
                         and crates latch into it while she is under way.
     · pirates         — piracy.js raids already hunt the fattest crewed hull
                         on the water; a cargo manifest pulls the next raid
                         forward through CBZ.pirateProvoke, and turning
                         pirate yourself is a voyage that binds to the same
                         traffic piracy prices. Heat is the existing wanted
                         system — no new reputation scalar (ratchet 34).
     · deaths          — killfeed.js's bus, untouched. Nothing here toasts.

   FLAGS (declared here — config.js is fenced; every one is a one-line revert)
     CAPTAIN_V1        master. false -> no origin launch, no orders, no board.
     CAPTAIN_ORIGIN    the spawn-at-the-helm launch.
     CAPTAIN_ORDERS    crew orders on real bodies (cast lines / helm / arms).
     CAPTAIN_VOYAGES   the chart table + harbourmaster board missions.
     CAPTAIN_HOLD      adopt vehicle_hold on the flagship.
     CAPTAIN_PIRATES   both directions of piracy wiring.
     CAPTAIN_YARD      the fenced prize hull on the hard stand.

   DETERMINISM: the yard build path draws through CBZ.hash01 only. Voyage
   rolls are runtime (mode-reset side), like every contract generator here.

   Exposes: CBZ.captainStart, CBZ.captainBoat, CBZ.captainAudit,
            CBZ.captainFitAudit.
   =========================================================================== */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});
  const g = CBZ.game || (CBZ.game = {});
  if (C.CAPTAIN_V1 == null) C.CAPTAIN_V1 = true;
  if (C.CAPTAIN_ORIGIN == null) C.CAPTAIN_ORIGIN = true;
  if (C.CAPTAIN_ORDERS == null) C.CAPTAIN_ORDERS = true;
  if (C.CAPTAIN_VOYAGES == null) C.CAPTAIN_VOYAGES = true;
  if (C.CAPTAIN_HOLD == null) C.CAPTAIN_HOLD = true;
  if (C.CAPTAIN_PIRATES == null) C.CAPTAIN_PIRATES = true;
  if (C.CAPTAIN_YARD == null) C.CAPTAIN_YARD = true;

  const ORG = "shipco";                  // seacrew.js's ladder — never a mirror
  const DEFAULT_FLAG = "trawler";        // the hull this story has always named
  const START_SEC = 14;                  // give the fleet this long to exist

  function on() { return C.CAPTAIN_V1 !== false; }
  function note(m, s, o) { if (CBZ.city && CBZ.city.note) { try { CBZ.city.note(m, s, o); } catch (e) {} } }
  function big(m) { if (CBZ.city && CBZ.city.big) { try { CBZ.city.big(m); } catch (e) {} } }
  function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }
  function h01(a, b, s) { return CBZ.hash01 ? CBZ.hash01(a, b, s) : 0.5; }
  function waterAt(x, z) { return !!(CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)); }
  function seaAt(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : (CBZ.waterSeaY ? CBZ.waterSeaY() : -0.48); }
  function money(n) { return "$" + Math.round(n || 0).toLocaleString(); }
  function specOf(car) {
    if (!car) return null;
    if (car._hullSpec) return car._hullSpec;
    if (CBZ.marineHulls && CBZ.marineHulls.specFor) { try { return CBZ.marineHulls.specFor(car); } catch (e) {} }
    return null;
  }
  // THE DEGRADE-SAFE RANK GATE (CLAUDE.md's documented trap): rankCan answers
  // FALSE for an undeclared org, so a bare test would slam every order shut the
  // moment FACTION_V1 flips off. rankKnows first, always.
  function crewCan(actorOrPed, verb) {
    if (!CBZ.rankKnows || !CBZ.rankCan) return true;
    try { if (!CBZ.rankKnows(ORG, verb)) return true; } catch (e) { return true; }
    try { return !!CBZ.rankCan(actorOrPed, ORG, verb); } catch (e) { return true; }
  }
  function playerIsCaptain() {
    const F = CBZ.factions;
    if (!F || !F.rank) return true;                       // no faction layer: open
    try { if (!F.exists || !F.exists(ORG)) return true; } catch (e) { return true; }
    try { return F.rank(ORG) === "captain"; } catch (e) { return false; }
  }

  /* ==========================================================================
     STATE — one flagship at a time. The garage record (boatyard's own shape,
     in g.cityGarage — the EXISTING ownership container, ratchet 15) is the
     persistence; everything below is per-session wiring onto the live hull.
     ========================================================================== */
  let boat = null;               // live cityCars record of the flagship
  let crew = [];                 // live crew bodies aboard her
  let crewPosts = [];            // citystaff post handles
  let helm = null;               // { ped, course:{x,z}, speed } while the mate has her
  let hold = null;               // vehicleHold handle on the flagship
  let chartGrp = null;           // the chart table prop (child of boat.group)
  let pendingStart = null;       // { t } while the origin launch waits on the world
  let armedUp = false;           // all-hands-armed posture
  let venueDeclared = false;
  let firstMission = null;       // the shakedown objective (walk to the table)
  let offers = null, offerT = 0; // cached voyage offers (rolled near the table)
  let offersHM = null, offerHMT = 0; // the harbourmaster's premium cache
  let voyage = null;             // { kind, m, ... } the live voyage
  let fishRods = [];             // fishWorkRod recs for crew we ordered to lines
  let crewCatchT = 0;
  // evidence counters (captainAudit)
  let nCharters = 0, nCargo = 0, nFishTrips = 0, nSalvage = 0, nRaids = 0;
  let nOrders = 0, nCrewCatches = 0, nCratesDelivered = 0, nPirateHits = 0;
  const pirateHitSeen = {};      // crew id -> counted
  let yardGate = null;           // { x, z, hullKey, label, price } the locked fence gate
  let boardPos = null;           // harbourmaster board point

  /* ==========================================================================
     0. THE FLAGSHIP IS A CHOICE, AND EVERY FITTING IS THE HULL'S OWN NUMBERS.

     OWNER (2026-08-12): "captain like pilot should let me select any boat in
     start menu." The pick comes off the title screen through origins.js
     (CBZ.cityOriginBoatKey — world/water_hulls.js's live registry, so the list
     is the real fleet and a hull registered tomorrow is pickable with no edit
     here). That is one line to read. What it COSTS is this block, because
     every fitting in this file was a trawler measurement typed as a literal:
     the fish hold's floor at deck 2.43 between bulwarks at x +-2.64, the chart
     table at (0.95, 2.59, 2.35), three crew stations, the rail a deckhand
     fishes from, the bench a fare sits on, the square a crate lands on, and
     the patch of deck you are set down on when you hand over the wheel. Put a
     man on the 4.5 m tender with those numbers and his crew stand in the air
     two metres above the sea, and his chart table floats astern of the boat.

     So they are DERIVED, from the four dimensions every registered hull
     already carries (deriveSpec: loa, beam, deckY, sternOffset). The trawler's
     authored numbers are the reference — each ratio below reproduces her to
     the centimetre, which is the check that the proportions are real and not
     invented — and every other hull gets the same proportions.

     TWO THINGS ARE CAPPED RATHER THAN SCALED, because proportion is the wrong
     model past a certain size: a hold the length of a 156 m yacht is not a
     hold, it is a deck; and a chart table 20 m forward is in a different room
     from the wheel. Both cap into the aft working space, which on that hull is
     what the tender garage actually is.

     CREW SCALES WITH THE BOAT. Three hands on a 4.5 m RIB is not a crew, it is
     a clown car — the ROSTER is sliced by length, and the mate (the man who
     can take the wheel, i.e. the whole point of having anybody) is first.
     ========================================================================== */
  let flagKey = null;            // the hull actually being sailed this run
  let FIT = null;                // her fittings, solved from her own dimensions

  function hullRec(key) {
    return (CBZ.marineHulls && CBZ.marineHulls.get) ? CBZ.marineHulls.get(key) : null;
  }
  function solveFit(key) {
    const hr = hullRec(key);
    const h = (hr && (hr.hull || hr.spec)) || {};
    const loa = num(h.loa, 18), beam = num(h.beam, 5.6);
    const deck = num(h.deckY, 2.43);                  // the working sole
    const stern = num(h.sternOffset, loa * 0.5);      // group origin -> transom
    const holdW = Math.min(beam * 0.821, 7);          // trawler 4.60
    const holdD = Math.min(stern * 0.910, 14);        // trawler 8.19
    const chartZ = Math.min(loa * 0.130, 6);          // trawler 2.34
    const chartX = Math.min(beam * 0.170, 1.6);       // trawler 0.95
    return {
      key: key, loa: loa, beam: beam, deck: deck, stern: stern,
      label: (hr && (hr.label || hr.model)) || "Boat",
      model: (hr && hr.model) || (hr && hr.label) || null,
      price: Math.round(num(hr && hr.price, 690000)),
      holdW: holdW, holdD: holdD,
      holdZ: -(holdD * 0.5 + 0.1),                    // trawler -4.20
      sillZ: -(holdD + 0.36),                         // trawler -8.55
      wallX: holdW * 0.5 + 0.34,                      // trawler 2.64
      bulwark: deck + 0.95,                           // trawler 3.38
      breakwater: deck + 1.17,                        // trawler 3.60
      rampW: holdW * 0.5,                             // trawler 2.30
      rampLen: Math.min(1.7, holdD * 0.25),
      chartX: chartX, chartY: deck + 0.16, chartZ: chartZ,
      helmY: deck + 0.42, helmZ: chartZ + 0.70,       // trawler 2.85 / 3.04
      railX: Math.min(beam * 0.330, 2.6),             // trawler 1.85
      railZ: -holdD * 0.366,                          // trawler -3.00
      railStep: Math.min(2.2, holdD * 0.27),
      benchX: Math.min(beam * 0.214, 1.8),            // trawler 1.20
      benchY: deck + 0.59,                            // the catch-crate top
      crateX: Math.min(beam * 0.160, 1.2),            // trawler 0.90
      crateStep: Math.min(1.2, holdD * 0.15),
      // a hold needs a floor a man can stand on; below that the boat is an
      // open boat and gets no cargo room rather than a fictional one
      canHold: holdW >= 1.2 && holdD >= 2,
      crewN: loa < 7 ? 1 : loa < 12 ? 2 : 3,
    };
  }
  /* The flagship key, resolved ONCE per run and then remembered. THE ORDER IS
     THE WHOLE RULE, and it is the repo's own (an explicit CBZ.MASS_CROWD beats
     a derived headcount — overruling is a decision, not a drift):

       1. a boat the player actually CLICKED at the title screen, if it still
          resolves against the registry;
       2. else the flagship he already owns — a returning skipper who never
          touched the picker keeps the hull he has, and that record round-trips
          through g.cityGarage where the session-side pick does not;
       3. else the working trawler this story has always described.

     Owned-beats-default and pick-beats-owned are different answers to
     different questions, and getting them the other way round means either
     "I chose the tender and got the trawler" or "I owned a sloop and the game
     took it off me". */
  function flag() {
    if (flagKey) return flagKey;
    const rows = CBZ.cityOriginBoats ? CBZ.cityOriginBoats() : [];
    const want = CBZ.cityOriginBoat ? CBZ.cityOriginBoat() : null;
    let pick = null;
    if (want) for (const r of rows) if (r.id === want) { pick = want; break; }
    if (!pick) { const o = ownedFlagRec(); if (o && o.key) pick = o.key; }
    if (!pick) pick = (CBZ.cityOriginBoatKey ? CBZ.cityOriginBoatKey() : null) || DEFAULT_FLAG;
    flagKey = pick;
    FIT = solveFit(flagKey);
    return flagKey;
  }
  function fit() { if (!FIT) flag(); return FIT; }
  function ownedFlagRec() {
    const gar = g.cityGarage;
    if (!gar) return null;
    for (const r of gar) if (r && r.marine && r.captFlag) return r;
    return null;
  }

  /* ==========================================================================
     1. THE ORIGIN — CBZ.captainStart(), armed by origins.js's `voyage` verb.

     The pilot's own deferral pattern (origins.js pendingAir): the fleet and
     the marina are populated by passes that have not run when a mode reset
     applies an origin, so we arm a pending launch and fire the moment the
     world can answer — normally within a frame or two of control.
     ========================================================================== */
  CBZ.captainStart = function () {
    if (!on() || C.CAPTAIN_ORIGIN === false) return false;
    pendingStart = { t: 0 };
    // A NEW RUN RE-READS THE PICK. This is the only per-run entry point, so it
    // is the only place the cached flagship may be dropped — otherwise picking
    // the sloop, starting, going back to the title and picking the tender puts
    // you on the sloop, because the key was resolved once and remembered.
    // A captain who already OWNS a boat still keeps her: flag() asks the
    // garage before it asks the title screen.
    flagKey = null; FIT = null;
    // The rank is the story: you ARE the captain, so shipco's own gates
    // (accommodation decks, the sail verb, the harbourmaster's board) open on
    // the same ladder every NPC crewman is ranked on. force skips admission —
    // an origin is a biography, not a walk-in.
    if (CBZ.factions && CBZ.factions.join && CBZ.factions.exists) {
      try { if (CBZ.factions.exists(ORG) && !CBZ.factions.isMember(ORG)) CBZ.factions.join(ORG, "master's ticket", { force: true, rank: "captain" }); } catch (e) {}
    }
    return true;
  };
  CBZ.captainBoat = function () { return boat; };

  // The boatyard's own record shape, byte for byte (boatyard.js record()) —
  // worldstate already round-trips g.cityGarage, so ownership persists free.
  function ensureRec() {
    g.cityGarage = g.cityGarage || [];
    const key = flag(), F = fit();
    // Already yours (a reload, or you bought this hull at the yard before the
    // story started)? Adopt it and MARK it — the mark is what makes the choice
    // survive a reload, since the title-screen pick is session state and
    // g.cityGarage is not. Exactly ONE record may carry it, or a captain who
    // changes boats between runs leaves a second flagship behind for flag()
    // step 2 to find.
    let mine = null;
    for (const r of g.cityGarage) {
      if (!r || !r.marine) continue;
      if (r.key === key) { r.captFlag = true; mine = r; }
      else if (r.captFlag) r.captFlag = false;
    }
    if (mine) return mine;
    const rec = {
      name: F.model || F.label,
      marine: true, key: key,
      label: F.label,
      price: F.price,
      loa: F.loa, beam: F.beam,
      berthId: null, boughtAt: 0, arrears: 0, granted: true,
      captFlag: true,
    };
    g.cityGarage.push(rec);
    if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} }
    return rec;
  }

  // Adopt a REAL hull the world already floats (yachts.js AFLOAT — which is
  // also how a 156 m superyacht gets sailed: she is already at her outer
  // roadstead and no berth in the marina could ever have taken her), else
  // deliver the owned record through boatyard's one pipe. Never a spawn of
  // our own.
  function findFlagship(rec) {
    const key = flag();
    // already delivered this session?
    if (CBZ.cityCars) for (const c of CBZ.cityCars) if (c && !c.dead && c._boatKey === key) return c;
    const fleet = CBZ.yachtFleet ? CBZ.yachtFleet() : null;
    if (fleet) {
      let best = null, bd = Infinity;
      const P = CBZ.player;
      for (const f of fleet) {
        const c = f && f.car;
        if (!c || f.key !== key || c.dead || c.player || c.owned || c.stolen) continue;
        /* A BOAT CARRIED BY ANOTHER BOAT IS NOT A BOAT YOU CAN SAIL, and the
           picker is what made this reachable: measured, BOTH afloat Calanque
           tenders are children of a superyacht's davits (yachts.js's "Launch
           the tender"). Adopting one would set car.pos in WORLD coordinates on
           a group whose transform is its PARENT's, so the captain's first
           command would be issued from inside somebody else's tender garage.
           Anything not parented straight to the scene is somebody's cargo. */
        if (c.group && c.group.parent && c.group.parent !== CBZ.scene) continue;
        const d = P && P.pos ? Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z) : 0;
        if (d < bd) { bd = d; best = c; }
      }
      if (best) {
        best.owned = true; best.stolen = false;
        best._boatKey = rec.key; best._boatRec = rec;
        return best;
      }
    }
    if (CBZ.cityBoatyard && CBZ.cityBoatyard.deliver) {
      try { return CBZ.cityBoatyard.deliver(rec); } catch (e) { return null; }
    }
    return null;
  }

  // Point the bow at open water: fan of bearings, take the first whose 60/140/
  // 220 m soundings are all wet (yachts.js's navigator lesson — never descend,
  // never name a coordinate).
  function seawardHeading(x, z) {
    const P = CBZ.CONTINENT_PLATE;
    const cx = P ? (P.minX + P.maxX) * 0.5 : 0, cz = P ? (P.minZ + P.maxZ) * 0.5 : 0;
    const base = Math.atan2(x - cx, z - cz);              // away from the landmass
    for (let i = 0; i < 16; i++) {
      const a = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 8);
      const fx = Math.sin(a), fz = Math.cos(a);
      if (waterAt(x + fx * 60, z + fz * 60) && waterAt(x + fx * 140, z + fz * 140) && waterAt(x + fx * 220, z + fz * 220)) return a;
    }
    return base;
  }

  function tryLaunch() {
    if (!g || g.mode !== "city" || !CBZ.city || !CBZ.city.arena) return false;
    if (!CBZ.cityEnterVehicle || !CBZ.player) return false;
    const rec = ensureRec();
    const car = findFlagship(rec);
    if (!car || !car.group) return false;
    const S = specOf(car);

    // UNDER WAY. If she came out of a berth, walk her clear onto verified open
    // water first (the airborne start's grammar: place the state, then hand
    // over). If she was already loose on the coastal band, she sails from
    // where the world had her.
    const h = seawardHeading(car.pos.x, car.pos.z);
    const nearQuay = CBZ.cityMarina && CBZ.cityMarina.exists && CBZ.cityMarina.exists()
      && (function () { const s = CBZ.cityMarina.site(); return s && Math.hypot(car.pos.x - s.QX, car.pos.z - s.BZ) < 140; })();
    if (nearQuay) {
      // cast off: 120 m out along the seaward bearing, if that water is real
      const ox = car.pos.x + Math.sin(h) * 120, oz = car.pos.z + Math.cos(h) * 120;
      if (waterAt(ox, oz)) { car.pos.x = ox; car.pos.z = oz; }
    }
    car.heading = h;
    car.road = null; car.ai = false;
    if (car.group) {
      car.group.position.x = car.pos.x; car.group.position.z = car.pos.z;
      car.group.position.y = seaAt(car.pos.x, car.pos.z) + num(S && S.rideAbove, 0.05);
      car.group.rotation.set(0, h, 0);
    }
    boat = car;

    // THE HELM HANDOFF IS THE EXISTING ONE. cityEnterVehicle is the one
    // enter path (it zeroes v), water_helm.js owns every driven frame after.
    CBZ.cityEnterVehicle(car);
    const cruise = num(S && S.cruiseMs, 4.5);
    car.v = cruise * 0.6;
    car.vx = Math.sin(h) * car.v; car.vz = Math.cos(h) * car.v;
    if (CBZ.cam) { CBZ.cam.yaw = h + Math.PI; CBZ.cam.pitch = 0.22; }

    rigFlagship(car);
    crewBoat(car);

    big("THE CAPTAIN");
    // the boat is a pick now, so she is NAMED — you should be told which hull
    // the harbour actually gave you rather than a line about a diesel you may
    // not be standing on
    note(fit().label + ". Your crew, your water. The chart table has the work.", 4.2);
    if (C.CAPTAIN_VOYAGES !== false && CBZ.mission && CBZ.mission.start) {
      try {
        firstMission = CBZ.mission.start({
          id: "captain_shakedown", title: "Walk to the chart table",
          goal: "custom", reward: 0, announce: false,
          brief: "Hand her to the mate or drop the hook, walk the deck, and pick a voyage at the chart table.",
        });
      } catch (e) { firstMission = null; }
    }
    return true;
  }

  /* ==========================================================================
     2. THE SHIP'S FITTINGS — hold, chart table, gun locker.
     ========================================================================== */
  function rigFlagship(car) {
    fitHold(car);
    fitChart(car);
  }

  // ONE CALL, ONE ROOM (vehicle_hold's contract, verbatim shape). The working
  // deck between the bulwarks becomes a walk-in cargo room with a stern gate:
  // floor + walls stay solid at any heading, the gate gets its phased arc, its
  // verb and its touch pill from vehicle_hold itself, and crates latched here
  // ride the hull's live matrix while she rolls.
  //
  // AND IT IS ALSO THE DECK YOU STAND ON. That is why the open boats get one
  // too where they can carry it: the floor rect vehicle_hold registers is a
  // real collider, so a skiff whose registration declares no walkable deck is
  // still a boat a man can cross. Below canHold there is genuinely nowhere to
  // put a room, and an open boat with no cargo room is an honest open boat.
  function fitHold(car) {
    if (C.CAPTAIN_HOLD === false || hold || !CBZ.vehicleHold || !car || !car.group || !window.THREE) return;
    const F = fit();
    if (!F.canHold) return;
    const THREE = window.THREE;
    // the stern gate node — a real transom door where the net ramp is
    const gate = new THREE.Group();
    gate.position.set(0, F.deck, F.sillZ);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(F.rampW, 0.1, F.rampLen),
      CBZ.cmat ? CBZ.cmat(0x6f5a3c) : new THREE.MeshLambertMaterial({ color: 0x6f5a3c }));
    leaf.position.set(0, 0.05, -F.rampLen * 0.5);
    gate.add(leaf);
    gate.userData.dynamic = true;
    car.group.add(gate);
    try {
      hold = CBZ.vehicleHold(car, {
        id: "captain-hold", label: F.loa >= 12 ? "Fish Hold" : "Cargo Well",
        floor: { x: 0, z: F.holdZ, w: F.holdW, d: F.holdD, top: F.deck },
        walls: [
          { x: F.wallX, z: F.holdZ, w: 0.16, d: F.holdD, y0: F.deck, y1: F.bulwark },
          { x: -F.wallX, z: F.holdZ, w: 0.16, d: F.holdD, y0: F.deck, y1: F.bulwark },
          { x: 0, z: 0.0, w: F.holdW, d: 0.2, y0: F.deck, y1: F.breakwater },
        ],
        ramp: { node: gate, w: F.rampW, len: F.rampLen, sillZ: F.sillZ, sillTop: F.deck,
          closedRx: 1.35, openRx: -0.30, dir: -1 },
      });
      if (hold && hold.inert) hold = null;
    } catch (e) { hold = null; }
  }

  // THE CHART TABLE — a physical place to pick the next job (doors beat
  // markers). Stands just forward of the working deck, to starboard of the
  // wheel, on a sole the hull's own deckY names; chart face proud of its frame
  // per the SCREEN law (>= 0.025).
  function fitChart(car) {
    if (C.CAPTAIN_VOYAGES === false || chartGrp || !car || !car.group || !window.THREE) return;
    const F = fit();
    const THREE = window.THREE;
    const cm = CBZ.cmat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
    const grp = new THREE.Group();
    grp.position.set(F.chartX, F.chartY, F.chartZ);        // stbd of the wheel
    grp.userData.dynamic = true;                          // live prop — never batched
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.78, 0.56), cm(0x4a3a26));
    legs.position.y = 0.39; grp.add(legs);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.06, 0.66), cm(0x6f5a3c));
    top.position.y = 0.81; grp.add(top);
    // the chart itself — one-shot canvas (ctx.canvasTex's exact shape),
    // deterministic strokes off hash01 so every client draws the same sea.
    try {
      const cv = document.createElement("canvas"); cv.width = 256; cv.height = 176;
      const cc = cv.getContext("2d");
      cc.fillStyle = "#e8dfc8"; cc.fillRect(0, 0, 256, 176);
      cc.strokeStyle = "#7d94a6"; cc.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        cc.beginPath();
        for (let x = 0; x <= 256; x += 16) {
          const y = 30 + i * 28 + h01(x, i, 771) * 18;
          if (x === 0) cc.moveTo(x, y); else cc.lineTo(x, y);
        }
        cc.stroke();
      }
      cc.fillStyle = "#31506b"; cc.font = "bold 13px monospace";
      cc.fillText("CAPE HARBOR APPROACHES", 12, 18);
      cc.fillStyle = "#8a2f2f";
      for (let i = 0; i < 7; i++) cc.fillText(String(3 + ((h01(i, 9, 772) * 40) | 0)), 18 + i * 34, 150);
      const tex = new THREE.CanvasTexture(cv);
      const chart = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.56),
        new THREE.MeshLambertMaterial({ map: tex }));
      chart.rotation.x = -Math.PI / 2;
      chart.position.y = 0.81 + 0.03 + 0.028;            // proud of the tabletop (SCREEN_GAP)
      grp.add(chart);
    } catch (e) {}
    car.group.add(grp);
    chartGrp = grp;
  }

  // hull-local -> world for a boat record (forward = (sin h, cos h); +x port)
  function boatWorld(car, lx, lz) {
    const h = num(car.heading, 0), s = Math.sin(h), c = Math.cos(h);
    return { x: car.pos.x + s * lz + c * lx, z: car.pos.z + c * lz - s * lx };
  }

  /* ==========================================================================
     3. THE CREW — cast through citystaff, seated through npcLife.attach,
        ranked on seacrew's OWN field. If seacrew already crewed this hull,
        those bodies are adopted, never doubled.
     ========================================================================== */
  /* THE SHIP'S COMPANY, SOLVED FOR THIS HULL. The mate is first because he is
     the man who can take the wheel — on a boat too small for three hands the
     one you keep is the one who lets you leave the helm and walk your deck.
     Stations are the hull's own: the mate beside the wheel, the deckhands on
     the working deck astern of the break. */
  function roster(F) {
    F = F || fit();
    const all = [
      { job: "first mate", rank: "mate", sit: true, wealth: 0.5, outfit: 0x24354f,
        st: { x: -F.chartX * 0.95, y: F.helmY, z: F.chartZ + 0.36, face: 0 } },
      { job: F.loa >= 12 ? "net hand" : "deckhand", rank: "deckhand", wealth: 0.22, outfit: 0xd8862c,
        st: { x: F.railX * 0.81, y: F.deck, z: -F.holdD * 0.39, face: Math.PI * 0.5 } },
      { job: F.loa >= 12 ? "trawlerman" : "boat hand", rank: "deckhand", wealth: 0.22, outfit: 0x4a5232,
        st: { x: -F.railX * 0.81, y: F.deck, z: -F.holdD * 0.635, face: -Math.PI * 0.5 } },
    ];
    return all.slice(0, F.crewN);
  }
  let postSeq = 0;
  function crewNode(car) {
    const THREE = window.THREE;
    if (!THREE || !car || !car.group) return null;
    const gp = car.group;
    // reuse seacrew's node if it already hung one on this hull
    if (gp.userData._seaCrewNode && gp.userData._seaCrewNode.parent === gp) return gp.userData._seaCrewNode;
    if (gp.userData._captCrewNode && gp.userData._captCrewNode.parent === gp) return gp.userData._captCrewNode;
    const n = new THREE.Group();
    const s = (gp.scale && gp.scale.x) || 1;
    n.scale.setScalar(s > 0.001 ? 1 / s : 1);
    n.name = "crew"; n.userData.dynamic = true;
    gp.add(n);
    gp.userData._captCrewNode = n;
    return n;
  }
  function liveCrew() {
    for (let i = crew.length - 1; i >= 0; i--) if (!crew[i] || crew[i].dead) crew.splice(i, 1);
    return crew;
  }
  function isMyCrew(p) {
    return !!(p && !p.dead && boat && (p._captCrew === boat || p._seaShip === boat));
  }
  function stationPed(ped, st, sit) {
    if (!CBZ.npcLife || !CBZ.npcLife.attach || !boat) return false;
    const node = crewNode(boat);
    if (!node) return false;
    // A BODY LEAVES A SEAT ONLY BY DETACHING (CLAUDE.md): re-stationing an
    // attached body goes through the one sanctioned exit first, or syncAttached
    // fights the new anchor with the old one.
    if (ped._npcAttached && CBZ.cityUnseat) { try { CBZ.cityUnseat(ped, { state: "idle" }); } catch (e) {} }
    ped._seatHold = true;
    return !!CBZ.npcLife.attach(ped, node, {
      x: st.x, y: st.y, z: st.z, yaw: st.face || 0,
      pose: sit ? "sit" : "stand", state: sit ? "sit" : "idle",
      cushionH: sit ? (st.cushion || 0.40) : null, floorBelow: 0,
    });
  }

  function crewBoat(car) {
    if (car._captCrewed) return;
    car._captCrewed = true;
    // seacrew got here first? adopt its ship's company as yours.
    const ship = (CBZ.seaCrew && CBZ.seaCrew.of) ? CBZ.seaCrew.of(car) : null;
    if (ship && ship.crew && ship.crew.length) {
      for (const c of ship.crew) if (c && !c.dead) { c._captCrew = car; if (crew.indexOf(c) < 0) crew.push(c); }
      return;
    }
    car._seaCrewed = true;                     // seacrew's scan now skips this hull
    if (!CBZ.cityStaffPost) return;
    if (!venueDeclared && CBZ.cityStaffVenue) {
      // ZERO stations declared, honest count raised after posting — seacrew's
      // own pattern, so venueStaffAudit().unstaffed (shared pin 0) cannot be
      // pushed off zero from inside this file.
      try { CBZ.cityStaffVenue("captain", { stations: 0, note: "the captain's own crew" }); venueDeclared = true; } catch (e) {}
    }
    for (const r of roster()) {
      const st = r.st;
      const p = CBZ.cityStaffPost({
        venue: "captain", id: "captain:" + flag() + ":" + (postSeq++),
        job: r.job, archetype: "laborer",
        x: car.pos.x, z: car.pos.z, face: st.face || 0,
        at: function () { return car.pos; },
        alive: function () { return !!(car.group && car.group.parent) && !car.dead; },
        opts: { wealth: r.wealth, outfit: r.outfit, aggr: 0.12, seaRank: r.rank, seaCrew: true },
        attach: function (ped) { return stationPed(ped, st, !!r.sit); },
        release: function (ped, why) {
          const j = crew.indexOf(ped); if (j >= 0) crew.splice(j, 1);
          if (helm && helm.ped === ped) helm = null;
          if (why !== "gone" && why !== "dead") return false;
          if (CBZ.cityUnseat) { try { CBZ.cityUnseat(ped, { state: ped.dead ? "dead" : "walk" }); } catch (e) {} }
          if (!ped.dead) { ped.staffPost = null; ped.state = "walk"; ped.pause = 0.6; }
          return true;
        },
        after: function (ped) {
          ped.seaRank = r.rank; ped.seaCrew = true;
          ped._captCrew = car; ped._captStation = st; ped._captSit = !!r.sit;
          if (crew.indexOf(ped) < 0) crew.push(ped);
        },
      });
      if (p) crewPosts.push(p);
    }
    if (venueDeclared && CBZ.cityStaffStations) { try { CBZ.cityStaffStations("captain", crewPosts.length); } catch (e) {} }
  }

  /* ==========================================================================
     4. ORDERS — interactions on real crew bodies (I.register on the layer
        every street verb lives on; words, never key glyphs, so touch gets its
        pills free). Each order is a rank verb on seacrew's ladder.
     ========================================================================== */
  let ordersWired = false;
  function wireOrders() {
    if (ordersWired || C.CAPTAIN_ORDERS === false || !CBZ.interactions || !CBZ.interactions.register) return;
    ordersWired = true;
    const I = CBZ.interactions;

    // CAST LINES — any deckhand may fish; fishing.js animates the rod and the
    // catch pays in wildlife's own items (crewFishTick below).
    I.register("ped:civ", {
      id: "capt-castlines", slot: "j", prio: 40,
      canShow: function (p) { return on() && isMyCrew(p) && !(helm && helm.ped === p); },
      label: function (p) { return p._captFishing ? "Order: stow the lines" : "Order: cast lines"; },
      onSelect: function (p) { orderLines(p, !p._captFishing); },
    });

    // TAKE THE HELM — the mate's verb ("moor" is the rung that may take her
    // anywhere; holding a course is strictly less). You step onto your own
    // deck while she holds her heading through piracy.js's marineAutopilot.
    I.register("ped:civ", {
      id: "capt-takehelm", slot: "i", prio: 40,
      canShow: function (p) { return on() && isMyCrew(p) && crewCan(p, "moor") && !!specOf(boat); },
      label: function (p) { return (helm && helm.ped === p) ? "Order: I'll take her" : "Order: take the helm"; },
      onSelect: function (p) { (helm && helm.ped === p) ? handBack(p) : takeHelm(p); },
    });

    // ALL HANDS ARM UP — the captain's order (your rung, not theirs), and the
    // loyalty+weapons atom made literal: armed crew fight the boarders.
    I.register("ped:civ", {
      id: "capt-armup", slot: "k", prio: 40,
      canShow: function (p) { return on() && isMyCrew(p) && playerIsCaptain(); },
      label: function () { return armedUp ? "Order: stow the guns" : "Order: all hands, arm up"; },
      onSelect: function () { armAll(!armedUp); },
    });

    // ...and the same handover FROM the wheel (ped layers are driving:false,
    // so without this the one order that needs giving from the helm could
    // never be given there — boatyard's anchor verb is the idiom, on its own
    // slot so the two never collide).
    I.register("vehicle:inside", {
      id: "capt-handover", slot: "j",
      canShow: function (car, ctx) {
        if (!on() || C.CAPTAIN_ORDERS === false) return false;
        if (!(ctx && ctx.driving && ctx.vehicle === car && car === boat)) return false;
        return !!mateAboard();
      },
      label: function () { return "Hand the helm to the mate"; },
      onSelect: function () { const m = mateAboard(); if (m) takeHelm(m); },
    });
  }
  function mateAboard() {
    for (const c of liveCrew()) if (crewCan(c, "moor") && !c._captFishing) return c;
    return null;
  }

  function orderLines(p, castIt) {
    nOrders++;
    if (castIt) {
      // to the rail: a real standing spot at the bulwark, line outboard
      const side = (p._captStation && p._captStation.x < 0) ? -1 : 1;
      const F = fit();
      const st = { x: side * F.railX, y: F.deck,
        z: F.railZ - (crew.indexOf(p) % 2) * F.railStep, face: side * Math.PI * 0.5 };
      stationPed(p, st, false);
      p._captFishing = true;
      let rec = null;
      if (CBZ.fishWorkRod) { try { rec = CBZ.fishWorkRod(p, null); } catch (e) {} }
      if (rec) { rec.mesh.visible = true; if (fishRods.indexOf(rec) < 0) fishRods.push(rec); }
      note((p.name || "The deckhand") + " puts a line in the water.", 1.8);
    } else {
      p._captFishing = false;
      for (const r of fishRods) if (r.ped === p && r.mesh) r.mesh.visible = false;
      const R = roster();
      const st = p._captStation || R[R.length - 1].st;
      stationPed(p, st, !!p._captSit);
      note("Lines stowed.", 1.4);
    }
  }

  function takeHelm(p) {
    if (!boat || !specOf(boat)) return;
    nOrders++;
    const S = specOf(boat);
    const wasDriving = CBZ.player && CBZ.player._vehicle === boat && CBZ.player.driving;
    if (wasDriving && CBZ.cityExitVehicle) CBZ.cityExitVehicle();
    // step out ONTO YOUR OWN DECK, not into the sea: wheelhouse sole, beside
    // the table (the walkable deck rig water_hulls already runs holds you).
    // Only on the from-the-wheel handover — ordered from the deck, you are
    // already standing wherever you chose to stand.
    const P = CBZ.player;
    if (wasDriving && P && P.pos && boat.group) {
      const w = boatWorld(boat, -fit().chartX * 0.21, fit().chartZ * 0.6);
      P.pos.set(w.x, boat.group.position.y + fit().chartY, w.z);
      P.vy = 0; P.grounded = true;
      if (CBZ.playerChar) { CBZ.playerChar.group.position.copy(P.pos); CBZ.playerChar.group.visible = true; }
    }
    // the mate takes the wheel — a body at the helm, not a flag
    stationPed(p, { x: 0, y: fit().helmY, z: fit().helmZ, face: 0 }, true);
    const h = num(boat.heading, 0);
    helm = {
      ped: p,
      course: { x: boat.pos.x + Math.sin(h) * 600, z: boat.pos.z + Math.cos(h) * 600 },
      speed: num(S.cruiseMs, 4.5) * 0.8,
    };
    note((p.name || "The mate") + " has the helm, she'll hold this heading. Walk your deck.", 2.6);
  }
  function handBack(p) {
    helm = null;
    nOrders++;
    const st = p._captStation || roster()[0].st;
    stationPed(p, st, !!p._captSit);
    note("You have the helm back the moment you step to the wheel.", 2.0);
  }

  function armAll(up) {
    nOrders++;
    armedUp = !!up;
    let n = 0;
    for (const c of liveCrew()) {
      if (up) {
        // the NPC arming idiom (peds.js/origins.js — armed/weapon/ammo + sync)
        c.armed = true;
        c.weapon = c.weapon || (crewCan(c, "moor") ? "Shotgun" : "Pistol");
        c.ammo = Math.max(c.ammo || 0, 48);
        c._captAggr0 = c._captAggr0 == null ? (c.aggr || 0.12) : c._captAggr0;
        c.aggr = 0.6;
      } else {
        c.armed = false; c.weapon = null; c.rage = null;
        if (c._captAggr0 != null) c.aggr = c._captAggr0;
      }
      if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(c); } catch (e) {} }
      n++;
    }
    note(up ? ("All hands armed · " + n + " gun" + (n === 1 ? "" : "s") + " on deck.")
            : "Guns back in the locker.", 2.2);
  }

  // Armed crew FIGHT the boarders; unarmed crew are ordinary scared people
  // (cityScare + panic already own that). Rage is peds.js's own combat field.
  let defendT = 0;
  function crewDefend(dt) {
    if (!armedUp || !boat || !CBZ.cityPeds) return;
    defendT -= dt;
    if (defendT > 0) return;
    defendT = 0.5;
    let threat = null, bd = 70 * 70;
    for (const p of CBZ.cityPeds) {
      if (!p || p.dead || !p.pirateCrew) continue;
      const dx = p.pos.x - boat.pos.x, dz = p.pos.z - boat.pos.z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; threat = p; }
    }
    if (!threat) return;
    for (const c of liveCrew()) if (!c.rage || c.rage.dead) c.rage = threat;
  }

  // The catches ACCRUE — fishing.js's own species registry and wildlife's own
  // items, granted through the one economy (exactly what land(  ) does; no
  // fish table, no second price list).
  function crewFishTick(dt) {
    crewCatchT -= dt;
    if (crewCatchT > 0) return;
    crewCatchT = 3;
    if (!boat || !CBZ.cityEcon || !CBZ.cityEcon.add) return;
    const S = CBZ.WILDLIFE_SPECIES || {};
    let pool = null;
    for (const c of liveCrew()) {
      if (!c._captFishing) continue;
      // slow water pays: roughly one fish a minute per hand (this branch runs
      // once per 3 s tick, so the per-tick odds are 3/55)
      if (Math.random() > 3 / 55) continue;
      if (!pool) {
        pool = [];
        for (const id in S) {
          const sp = S[id];
          if (sp && sp.aquatic && sp.fur && !((sp.danger || 0) > 0.2 || (sp.bite || 0) > 0)) pool.push(sp);
        }
      }
      if (!pool.length) return;
      const sp = pool[(Math.random() * pool.length) | 0];
      if (CBZ.wildlifeRegisterItems) { try { CBZ.wildlifeRegisterItems(); } catch (e) {} }
      try { CBZ.cityEcon.add(sp.fur, 1); } catch (e) { continue; }
      nCrewCatches++;
      if (voyage && voyage.kind === "fish") voyage.caught = (voyage.caught || 0) + 1;
      if (nCrewCatches % 3 === 1) note("Thump on the deck · " + sp.name + " in the box.", 1.8);
    }
  }

  /* ==========================================================================
     5. VOYAGES — the chart table picks the verb, the WORLD supplies the
        specifics (contracts.js's binding law). All tracking, waypoints, HUD
        and pay through core/mission.js. One live voyage at a time.
     ========================================================================== */
  // `walk` marks a dock with a real quay beside it — crates can stand there
  // and a fare can be waiting on it. Un-walkable water (the roadstead) is a
  // destination you hold station at, never a place a crate is stacked.
  function docks() {
    const out = [];
    const M = CBZ.cityMarina && CBZ.cityMarina.exists && CBZ.cityMarina.exists() ? CBZ.cityMarina.site() : null;
    if (M) {
      out.push({ name: "the Marina quay", x: M.QX + 6, z: M.BZ, walk: true, quay: { x: M.QX - 2, z: M.BZ } });
      // the fuel dock is a low pontoon — a fine DESTINATION, never a crate yard
      if (M.fuel) out.push({ name: "the Fuel Dock", x: M.fuel.x + 3, z: M.fuel.z });
    }
    if (CBZ.cityBerth && CBZ.cityBerth.list) {
      try {
        for (const b of CBZ.cityBerth.list()) {
          if (b.kind === "anchorage") { out.push({ name: b.label || "the Roadstead", x: b.x, z: b.z }); break; }
        }
        for (const b of CBZ.cityBerth.list()) {
          // the med berth record sits a hull-length off its quay face; the
          // walkable concrete is that far astern of it (marina.js's own layout)
          if (b.kind === "med") { out.push({ name: "the Superyacht Quay", x: b.x, z: b.z + 8, walk: true, quay: { x: b.x, z: b.z + (b.loa || 34) * 0.5 + 3.4 } }); break; }
        }
      } catch (e) {}
    }
    // keep only real water
    return out.filter(function (d) { return waterAt(d.x, d.z); });
  }
  function fishingGrounds() {
    if (!boat) return null;
    const h = seawardHeading(boat.pos.x, boat.pos.z);
    for (const r of [420, 620, 860]) {
      const x = boat.pos.x + Math.sin(h) * r, z = boat.pos.z + Math.cos(h) * r;
      if (waterAt(x, z)) return { name: "the offshore grounds", x: x, z: z };
    }
    return null;
  }
  function findPassenger(dock) {
    if (!CBZ.cityPeds) return null;
    let best = null, bd = 46 * 46;
    for (const p of CBZ.cityPeds) {
      if (!p || p.dead || p.vendor || p.isFamily || p.seaCrew || p.pirateCrew || p._npcAttached) continue;
      if (p._captCrew || p._campaignTarget) continue;
      const dx = p.pos.x - dock.x, dz = p.pos.z - dock.z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function findWreck() {
    if (!CBZ.cityCars || !CBZ.isMarineHull) return null;
    const M = CBZ.cityMarina && CBZ.cityMarina.site ? CBZ.cityMarina.site() : null;
    for (const c of CBZ.cityCars) {
      if (!c || c === boat || c.player || c.owned || c._captSalvaged) continue;
      try { if (!CBZ.isMarineHull(c)) continue; } catch (e) { continue; }
      if (!c.pos || !waterAt(c.pos.x, c.pos.z)) continue;
      const derelict = c.dead || c.abandoned || (c._pirateBoat === false && !c.ai);
      if (!derelict) continue;
      if (M && Math.hypot(c.pos.x - M.QX, c.pos.z - M.BZ) < 220) continue;   // harbour clutter is not salvage
      return c;
    }
    return null;
  }
  function aboard(carRec) {
    let n = 0;
    if (!CBZ.cityPeds || !carRec || !carRec.group) return 0;
    for (const a of CBZ.cityPeds) {
      if (!a || a.dead || !a._npcAttached) continue;
      if (a._npcAttached === carRec.group || a._npcAttached.parent === carRec.group) n++;
    }
    return n;
  }
  function findPrize() {
    if (!CBZ.cityCars || !CBZ.isMarineHull) return null;
    let best = null, bv = 0;
    for (const c of CBZ.cityCars) {
      if (!c || c.dead || c === boat || c.player || c.owned || c._pirateBoat) continue;
      try { if (!CBZ.isMarineHull(c)) continue; } catch (e) { continue; }
      if (!c.pos || !waterAt(c.pos.x, c.pos.z)) continue;
      const bodies = aboard(c);
      if (!bodies) continue;                              // an empty hull is theft, not piracy
      const S = specOf(c);
      const v = bodies * 40 + num(S && S.loa, 8) * 10 + Math.min(300, num(c.model && c.model.value, 10000) / 400);
      if (v > bv) { bv = v; best = c; }
    }
    return best;
  }

  function rollOffers(premium) {
    const ds = docks();
    const walk = ds.filter(function (d) { return d.walk; });
    const o = { charter: null, cargo: null, fish: null, salvage: null, raid: null };
    if (walk.length && ds.length >= 2 && boat) {
      // pick the legs by hash off the boat's position — stable while you
      // stand at the table, fresh next trip. Loading always starts on a quay.
      const k = ((boat.pos.x | 0) + (boat.pos.z | 0)) | 0;
      const a = walk[(h01(k, 3, 811) * walk.length) | 0];
      let b = ds[(h01(k, 7, 812) * ds.length) | 0];
      if (b === a) b = ds[(ds.indexOf(a) + 1) % ds.length];
      const dist = Math.hypot(b.x - a.x, b.z - a.z);
      const pax = findPassenger(a);
      // a fare lands where there is a quay to step onto
      const paxTo = (b.walk ? b : walk[(walk.indexOf(a) + 1) % walk.length]);
      if (pax && paxTo && paxTo !== a) o.charter = { from: a, to: paxTo, ped: pax, fare: Math.round(Math.max(320, Math.min(2400, Math.hypot(paxTo.x - a.x, paxTo.z - a.z) * 2.1)) * (premium ? 1.6 : 1)) };
      const crates = premium ? 5 : 3;
      o.cargo = { from: a, to: b, n: crates, pay: Math.round(Math.max(520, Math.min(3400, crates * 210 + dist * 0.6)) * (premium ? 1.7 : 1)) };
    }
    const fg = fishingGrounds();
    if (fg) o.fish = { at: fg, want: 4 };
    const wk = findWreck();
    if (wk) o.salvage = { car: wk, pay: Math.round(Math.max(240, Math.min(1600, num(wk.model && wk.model.value, 8000) * 0.05))) };
    if (C.CAPTAIN_PIRATES !== false && armedUp) {
      const pz = findPrize();
      if (pz) o.raid = { car: pz };
    }
    return o;
  }

  function endVoyage() { if (voyage) { voyage = null; } }
  function startCharter(off) {
    if (!CBZ.mission || !CBZ.mission.start) return;
    const kind = { kind: "charter", ped: off.ped, from: off.from, to: off.to, aboard: false };
    const m = CBZ.mission.start({
      id: "captain_charter", title: "Charter: " + (off.ped.name || "a fare"), exclusive: true,
      giver: "The chart table", reward: off.fare,
      stages: [
        { id: "pickup", text: "Bring her alongside at " + off.from.name, goal: "reach", at: { x: off.from.x, z: off.from.z }, radius: 22 },
        { id: "board", text: "Take your passenger aboard", goal: "custom" },
        { id: "land", text: "Land them at " + off.to.name, goal: "reach", at: { x: off.to.x, z: off.to.z }, radius: 22 },
      ],
      onComplete: function () {
        nCharters++;
        disembark(kind.ped, off.to);
        note("Fare ashore at " + off.to.name + " — " + money(off.fare) + ".", 2.6);
        endVoyage();
      },
      onFail: function () { if (kind.aboard) disembark(kind.ped, null); endVoyage(); },
    });
    kind.m = m; voyage = kind;
  }
  function disembark(ped, dock) {
    if (!ped || ped.dead) return;
    if (CBZ.cityUnseat) { try { CBZ.cityUnseat(ped, { state: "walk" }); } catch (e) {} }
    const spot = dock && (dock.quay || dock);
    if (spot && ped.pos) { ped.pos.x = spot.x; ped.pos.z = spot.z; ped.pos.y = 0.4; if (ped.group) ped.group.position.set(spot.x, 0.4, spot.z); }
    ped._captPax = false;
  }

  function startCargo(off, premium) {
    if (!CBZ.mission || !CBZ.mission.start) return;
    const kind = { kind: "cargo", from: off.from, to: off.to, n: off.n, loaded: 0, crates: [], provoked: false, premium: !!premium };
    spawnCrates(off.from, off.n, kind);
    const m = CBZ.mission.start({
      id: "captain_cargo", title: (premium ? "Manifest: " : "Cargo: ") + off.n + " crates to " + off.to.name, exclusive: true,
      giver: premium ? "The harbourmaster" : "The chart table", reward: off.pay,
      stages: [
        { id: "load", text: "Load the hold at " + off.from.name, goal: "custom" },
        { id: "run", text: "Run the cargo to " + off.to.name, goal: "reach", at: { x: off.to.x, z: off.to.z }, radius: 24 },
        { id: "unload", text: "Put the crates on the dock", goal: "custom" },
      ],
    });
    kind.m = m; voyage = kind;
    note("The crates are on the quay at " + off.from.name + ". Open the stern gate and get them aboard.", 3.2);
  }
  function spawnCrates(dock, n, kind) {
    const THREE = window.THREE;
    const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    if (!THREE || !root) return;
    const cm = CBZ.cmat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
    const q = dock.quay || dock;                        // crates stand on the quay
    for (let i = 0; i < n; i++) {
      const grp = new THREE.Group();
      const bx = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), cm(i % 2 ? 0x9a6b32 : 0x74572a));
      bx.position.y = 0.35; bx.castShadow = true; grp.add(bx);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.1, 0.94), cm(0x2e3238));
      band.position.y = 0.35; grp.add(band);
      grp.position.set(q.x + (i % 3) * 1.1 - 1.1, 0.4, q.z + Math.floor(i / 3) * 1.1 - 1.5);
      grp.userData.dynamic = true;
      root.add(grp);
      kind.crates.push({ group: grp, in: false });
    }
  }
  function sweepCrates(kind) {
    if (!kind || !kind.crates) return;
    for (const cr of kind.crates) {
      if (hold) { try { hold.release(cr); } catch (e) {} }
      if (cr.group && cr.group.parent) cr.group.parent.remove(cr.group);
    }
    kind.crates.length = 0;
  }
  function loadOneCrate(kind) {
    if (!hold || !boat) return false;
    for (const cr of kind.crates) {
      if (cr.in) continue;
      // the crate goes into the room and LATCHES — it now rides the hull
      const F = fit();
      const w = hold.worldOf(((kind.loaded % 2) ? F.crateX : -F.crateX), F.deck + 0.01,
        F.railZ - Math.floor(kind.loaded / 2) * F.crateStep);
      cr.group.position.set(w.x, w.y != null ? w.y : boat.group.position.y + F.deck + 0.01, w.z);
      cr.in = !!hold.latchCargo(cr);
      if (!cr.in) cr.in = true;                  // hold off: it still sits on the deck rect
      kind.loaded++;
      return true;
    }
    return false;
  }
  function unloadCrates(kind, dock) {
    nCratesDelivered += kind.crates.length;
    const q = dock.walk ? (dock.quay || dock) : null;
    let n = 0;
    for (const cr of kind.crates) {
      if (hold) { try { hold.release(cr); } catch (e) {} }
      if (cr.group && cr.group.parent) {
        if (q) cr.group.position.set(q.x + (n % 3) * 1.1 - 1.1, 0.4, q.z + Math.floor(n / 3) * 1.1 + 1.5);
        else cr.group.parent.remove(cr.group);          // a lighter takes them alongside
      }
      n++;
    }
    // a quay's stack is set dressing now — it clears after a beat
    const list = kind.crates.slice();
    if (q) setTimeout(function () { for (const cr of list) if (cr.group && cr.group.parent) cr.group.parent.remove(cr.group); }, 9000);
    kind.crates.length = 0;
  }

  function startFish(off) {
    if (!CBZ.mission || !CBZ.mission.start) return;
    const kind = { kind: "fish", at: off.at, want: off.want, caught: 0 };
    const m = CBZ.mission.start({
      id: "captain_fish", title: "Fishing trip: " + off.at.name, exclusive: true,
      giver: "The chart table", reward: 0,
      stages: [
        { id: "out", text: "Make " + off.at.name, goal: "reach", at: { x: off.at.x, z: off.at.z }, radius: 40 },
        { id: "box", text: "Fill the box (" + off.want + " fish, order the hands to cast lines)", goal: "custom" },
      ],
      onComplete: function () {
        nFishTrips++;
        const bonus = (kind.caught || 0) * 12;
        if (bonus && CBZ.city && CBZ.city.addCash) CBZ.city.addCash(bonus);
        note("Box full, the fish are yours to sell, and the buyer tips " + money(bonus) + ".", 3);
        endVoyage();
      },
      onFail: endVoyage,
    });
    kind.m = m; voyage = kind;
  }

  function startSalvage(off) {
    if (!CBZ.mission || !CBZ.mission.start) return;
    const kind = { kind: "salvage", car: off.car, pay: off.pay };
    const m = CBZ.mission.start({
      id: "captain_salvage", title: "Salvage: a derelict on the water", exclusive: true,
      giver: "The chart table", reward: off.pay,
      stages: [
        { id: "find", text: "Come alongside the wreck", goal: "reach", vehicle: off.car, radius: 16 },
        { id: "strip", text: "Strip her (hold alongside)", goal: "custom" },
      ],
      onComplete: function () {
        nSalvage++;
        if (off.car) off.car._captSalvaged = true;
        note("Stripped to the waterline · " + money(off.pay) + " in fittings.", 2.6);
        endVoyage();
      },
      onFail: endVoyage,
    });
    kind.m = m; kind.stripT = 0; voyage = kind;
  }

  // THE BLACK BOOK — you raid the same traffic piracy.js prices. The reward
  // is what you TAKE (the hull is yours to drive, the crew are ransom through
  // the existing hostage block) — no minted prize money, no new heat scalar.
  function startRaid(off) {
    if (!CBZ.mission || !CBZ.mission.start) return;
    const kind = { kind: "raid", car: off.car };
    const m = CBZ.mission.start({
      id: "captain_raid", title: "Run up the black: take the " + ((off.car.model && off.car.model.name) || "vessel"), exclusive: true,
      giver: "Nobody. This one is yours.", reward: 0,
      stages: [
        { id: "close", text: "Run her down", goal: "reach", vehicle: off.car, radius: 30 },
        { id: "take", text: "Take her, board, break her crew, or drive her", goal: "custom" },
      ],
      onComplete: function () {
        nRaids++;
        note("She's yours. Her people are your problem now, or your payday.", 3.2);
        endVoyage();
      },
      onFail: endVoyage,
    });
    kind.m = m; voyage = kind;
  }

  /* ---- the chart table zone: the option LIST is the whole board ---------- */
  let zonesWired = false;
  function wireZones() {
    if (zonesWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    zonesWired = true;
    const I = CBZ.interactions;

    I.registerZone({
      id: "captain-chart", kind: "chartTable", radius: 2.6,
      find: function (px, pz) {
        if (!on() || C.CAPTAIN_VOYAGES === false || !boat || !chartGrp) return null;
        if (CBZ.player && CBZ.player.driving) return null;
        const w = boatWorld(boat, fit().chartX, fit().chartZ);
        const dx = w.x - px, dz = w.z - pz;
        if (dx * dx + dz * dz > 2.6 * 2.6) return null;
        // fresh offers when you walk up (cheap; re-rolled at most every 8 s)
        const t = CBZ.now || Date.now();
        if (!offers || t - offerT > 8000) { offers = rollOffers(false); offerT = t; }
        if (firstMission && firstMission.alive && firstMission.alive()) { try { firstMission.complete(); } catch (e) {} firstMission = null; }
        return { x: w.x, z: w.z, name: "Chart table" };
      },
      options: [
        { id: "cv-charter", slot: "e",
          canShow: function () { return !voyage && offers && !!offers.charter; },
          label: function () { const o = offers.charter; return "Charter: " + (o.ped.name || "a fare") + " to " + o.to.name + " — " + money(o.fare); },
          onSelect: function () { if (offers && offers.charter) startCharter(offers.charter); } },
        { id: "cv-cargo", slot: "i",
          canShow: function () { return !voyage && offers && !!offers.cargo; },
          label: function () { const o = offers.cargo; return "Cargo: " + o.n + " crates to " + o.to.name + " — " + money(o.pay); },
          onSelect: function () { if (offers && offers.cargo) startCargo(offers.cargo, false); } },
        { id: "cv-fish", slot: "j",
          canShow: function () { return !voyage && offers && !!offers.fish; },
          label: function () { return "Fishing trip: " + offers.fish.at.name; },
          onSelect: function () { if (offers && offers.fish) startFish(offers.fish); } },
        { id: "cv-salvage", slot: "k",
          canShow: function () { return !voyage && offers && !!offers.salvage; },
          label: function () { return "Salvage a derelict · " + money(offers.salvage.pay); },
          onSelect: function () { if (offers && offers.salvage) startSalvage(offers.salvage); } },
        { id: "cv-raid", slot: "l", bad: true,
          canShow: function () { return !voyage && offers && !!offers.raid; },
          label: function () { const c = offers.raid.car; return "Run up the black: the " + ((c.model && c.model.name) || "vessel"); },
          onSelect: function () { if (offers && offers.raid) startRaid(offers.raid); } },
        { id: "cv-none", slot: "e",
          canShow: function () { return !voyage && offers && !offers.charter && !offers.cargo && !offers.fish && !offers.salvage; },
          label: function () { return "Nothing on the board, quiet water today"; },
          onSelect: function () { note("The sea will have work tomorrow.", 1.8); } },
        { id: "cv-live", slot: "e",
          canShow: function () { return !!voyage; },
          label: function () { return "Voyage under way, see it through"; },
          onSelect: function () {} },
      ],
    });
    if (I.describe) I.describe("chartTable", function () {
      return { label: "Chart table", note: armedUp ? "Charts, dividers, and a loaded locker" : "Charts, dividers, and the day's work" };
    });

    // THE HARBOURMASTER'S BOARD — a locked door with the reward legible: the
    // premium manifests are VISIBLE to anyone and open only to a ticketed
    // captain on shipco's own ladder.
    I.registerZone({
      id: "captain-hmboard", kind: "hmBoard", radius: 4.2,
      find: function (px, pz) {
        if (!on() || C.CAPTAIN_VOYAGES === false || !boardPos) return null;
        const dx = boardPos.x - px, dz = boardPos.z - pz;
        if (dx * dx + dz * dz > 4.2 * 4.2) return null;
        const t = CBZ.now || Date.now();
        if (!offersHM || t - offerHMT > 8000) { offersHM = rollOffers(true); offerHMT = t; }
        return { x: boardPos.x, z: boardPos.z, name: "Harbourmaster's board" };
      },
      options: [
        { id: "hm-locked", slot: "e", bad: true,
          canShow: function () { return !playerIsCaptain(); },
          label: function () {
            // THE REWARD IS LEGIBLE THROUGH THE LOCKED DOOR (gun-room law):
            // anybody may read what the manifest pays; only a master takes it.
            const o = offersHM && offersHM.cargo;
            return "Ticketed masters only, top manifest pays " + money(o ? o.pay : 2400);
          },
          onSelect: function () { note("The harbourmaster doesn't look up: \"Master's ticket, or off my quay.\"", 2.6); } },
        { id: "hm-cargo", slot: "e",
          canShow: function () { return playerIsCaptain() && !voyage; },
          label: function () {
            const o = offersHM && offersHM.cargo;
            return o ? ("Manifest: " + o.n + " crates to " + o.to.name + " — " + money(o.pay)) : "No manifests today";
          },
          onSelect: function () {
            const o = offersHM && offersHM.cargo;
            if (o) startCargo(o, true); else note("Quiet quay. Come back on the tide.", 1.8);
          } },
      ],
    });
    if (I.describe) I.describe("hmBoard", function () {
      return { label: "Harbourmaster's board", note: playerIsCaptain() ? "The good contracts, master" : "The good contracts, behind the counter" };
    });

    // load / unload verbs on the crate stack (a zone at the live dock)
    I.registerZone({
      id: "captain-crates", kind: "crateStack", radius: 3.4,
      find: function (px, pz) {
        if (!voyage || voyage.kind !== "cargo" || !voyage.crates) return null;
        for (const cr of voyage.crates) {
          if (!cr.group || !cr.group.parent) continue;
          if (cr.in) continue;
          const dx = cr.group.position.x - px, dz = cr.group.position.z - pz;
          if (dx * dx + dz * dz < 3.4 * 3.4) return { x: cr.group.position.x, z: cr.group.position.z, name: "Cargo" };
        }
        return null;
      },
      options: [{
        id: "crate-load", slot: "e",
        canShow: function () { return voyage && voyage.kind === "cargo" && voyage.m && voyage.m.stageId && voyage.m.stageId() === "load" && !!boat; },
        label: function () { return "Heave a crate into the hold (" + voyage.loaded + "/" + voyage.n + ")"; },
        onSelect: function () {
          if (!boat || Math.hypot(boat.pos.x - (CBZ.player ? CBZ.player.pos.x : 0), boat.pos.z - (CBZ.player ? CBZ.player.pos.z : 0)) > 40) { note("Bring her alongside first.", 1.8); return; }
          if (hold && hold.closed) { try { hold.openRamp(); } catch (e) {} }
          if (loadOneCrate(voyage) && voyage.loaded >= voyage.n) {
            if (hold) { try { hold.closeRamp(); } catch (e) {} }
            voyage.m.advance();
            note("Hold's full. Gate up, and run it.", 2.2);
            provokePirates();
          }
        },
      }],
    });
    if (I.describe) I.describe("crateStack", function () { return { label: "Cargo crates", note: "Bound for the hold" }; });
  }

  // A MANIFEST IS A REASON TO GO HUNTING (item 4a). The next raid is pulled
  // forward through piracy.js's own scheduler seam — every one of its safety
  // checks (crew cap, open water, over-the-horizon muster) still applies, and
  // most runs still go quiet (the menace law).
  function provokePirates() {
    if (C.CAPTAIN_PIRATES === false || !voyage || voyage.provoked) return;
    voyage.provoked = true;
    if (!CBZ.pirateProvoke || Math.random() > 0.55) return;
    try { CBZ.pirateProvoke(18 + Math.random() * 45, boat); } catch (e) {}
  }

  function voyageTick(dt) {
    if (!voyage) return;
    if (!voyage.m || !voyage.m.alive || !voyage.m.alive()) {
      // mission ended (paid, failed, or swept by mission.js's interrupt) —
      // clean the physical residue this file put in the world.
      if (voyage.kind === "cargo") sweepCrates(voyage);
      if (voyage.kind === "charter" && voyage.aboard && voyage.ped && voyage.ped._captPax) disembark(voyage.ped, null);
      voyage = null;
      return;
    }
    const st = voyage.m.stageId ? voyage.m.stageId() : null;
    const P = CBZ.player;
    if (voyage.kind === "charter") {
      if (st === "board" && (!voyage.ped || voyage.ped.dead)) { voyage.m.fail("your fare is gone"); return; }
      if (st === "board" && voyage.from &&
          Math.hypot(voyage.ped.pos.x - voyage.from.x, voyage.ped.pos.z - voyage.from.z) > 130) {
        voyage.m.fail("your fare walked");                 // the sim took them elsewhere
        return;
      }
      if (st === "board" && voyage.ped && !voyage.ped.dead && boat) {
        const d = Math.hypot(voyage.ped.pos.x - boat.pos.x, voyage.ped.pos.z - boat.pos.z);
        if (d < 26) {
          // they step aboard and take a seat on the catch crates amidships
          // (attach — the same call every seated body in this game rides; the
          // crate top the hull's own deck height puts them on)
          if (stationPed(voyage.ped, { x: -fit().benchX, y: fit().benchY,
            z: fit().railZ * 0.87, face: Math.PI, cushion: 0.55 }, true)) {
            voyage.ped._captPax = true;
            voyage.aboard = true;
            voyage.m.advance();
            note((voyage.ped.name || "Your fare") + " steps aboard and takes the bench.", 2.4);
          }
        }
      }
      if (st === "land" && (!voyage.ped || voyage.ped.dead)) voyage.m.fail("the fare is dead");
    } else if (voyage.kind === "cargo") {
      if (st === "unload") {
        // pressing nothing: the dock crew takes it the moment you hold station
        if (boat && Math.hypot(boat.pos.x - voyage.to.x, boat.pos.z - voyage.to.z) < 30 && Math.abs(boat.v || 0) < 0.8) {
          voyage.unloadT = (voyage.unloadT || 0) + dt;
          if (voyage.unloadT > 2.5) {
            if (hold && hold.closed) { try { hold.openRamp(); } catch (e) {} }
            unloadCrates(voyage, voyage.to);
            nCargo++;
            voyage.m.advance();               // completes the mission -> pay
          }
        } else voyage.unloadT = 0;
      }
      if (st === "run" && !voyage.provoked) provokePirates();
    } else if (voyage.kind === "fish") {
      if (st === "box" && (voyage.caught || 0) >= voyage.want) voyage.m.advance();
    } else if (voyage.kind === "salvage") {
      if (st === "strip" && voyage.car && boat) {
        const d = Math.hypot(voyage.car.pos.x - boat.pos.x, voyage.car.pos.z - boat.pos.z);
        if (d < 18 && Math.abs(boat.v || 0) < 0.8) {
          voyage.stripT = (voyage.stripT || 0) + dt;
          if (voyage.stripT > 6) voyage.m.advance();
        } else voyage.stripT = 0;
      }
      if (st === "strip" && !voyage.car) voyage.m.fail("the wreck went down");
    } else if (voyage.kind === "raid") {
      const c = voyage.car;
      if (!c || c.dead) { voyage.m.fail("she went down"); return; }
      if (st === "take") {
        if (c.player) { voyage.m.advance(); return; }     // you drove her: she's taken
        if (aboard(c) === 0) { voyage.m.advance(); return; } // her people are gone
      }
    }
  }

  /* ==========================================================================
     6. THE MATE HOLDS HER — piracy.js's marineAutopilot, refused while the
        player is at the wheel (its own guard), ticked here while the helm is
        handed over. The course is the heading she had when you handed her off.
     ========================================================================== */
  function helmTick(dt) {
    if (!helm || !boat) return;
    if (helm.ped && helm.ped.dead) { helm = null; note("The helm is untended.", 2.0); return; }
    if (boat.player) { helm = null; return; }             // you took her back
    if (!CBZ.marineAutopilot) return;
    const d = CBZ.marineAutopilot(boat, dt, { x: helm.course.x, z: helm.course.z, speed: helm.speed, arrive: 24 });
    if (d >= 0 && d < 40) {
      // roll the course point forward along the same bearing — a held heading,
      // not a destination
      const h = num(boat.heading, 0);
      helm.course.x = boat.pos.x + Math.sin(h) * 600;
      helm.course.z = boat.pos.z + Math.cos(h) * 600;
    }
  }

  /* ==========================================================================
     7. THE YARD — the next boat up, VISIBLE and LOCKED (gun-room grammar).
        A crewed cradle on the marina hard stand, behind a chain fence with a
        gate that answers to ownership; buying stays boatyard's pipe.
     ========================================================================== */
  let yardBuilt = false;
  function buildYard(city) {
    if (C.CAPTAIN_YARD === false || yardBuilt) return null;
    const M = CBZ.cityMarina && CBZ.cityMarina.exists && CBZ.cityMarina.exists() ? CBZ.cityMarina.site() : null;
    if (!M || !city || !city.root || !window.THREE) return null;
    yardBuilt = true;
    const THREE = window.THREE;
    const cm = CBZ.cmat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
    const root = city.root;
    const QT = 0.40;                                       // marina's quay top
    const cx = M.QX - 14, cz = M.BZ - 30;                  // hard stand, clear of the lift well
    boardPos = { x: M.QX - 11 + 4.2, z: M.BZ + 10 };       // the harbourmaster office door face

    // cradle + the prize hull herself (the registry's own mesh — if the
    // registry cannot build her, a shrink-wrapped hull stands in; we never
    // fence off nothing)
    let prize = null;
    if (CBZ.marineHulls && CBZ.marineHulls.build) { try { prize = CBZ.marineHulls.build("sportfish"); } catch (e) { prize = null; } }
    if (prize) {
      prize.position.set(cx, QT + 1.35, cz);
      prize.rotation.y = 0;
      prize.userData.captPrize = 1;                        // non-empty userData: spared from batch
      root.add(prize);
    } else {
      const wrap = new THREE.Mesh(new THREE.BoxGeometry(4.0, 2.4, 12.0), cm(0xdde2e6));
      wrap.position.set(cx, QT + 1.9, cz);
      wrap.userData.captPrize = 1;
      root.add(wrap);
    }
    for (const dz of [-3.4, 3.4]) {
      const cr = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.8, 0.5), cm(0x6f5a3c));
      cr.position.set(cx, QT + 0.4, cz + dz);
      root.add(cr);
      CBZ.colliders.push({ minX: cx - 1.7, maxX: cx + 1.7, minZ: cz + dz - 0.25, maxZ: cz + dz + 0.25, y0: 0, y1: QT + 0.8, noCam: true });
    }
    // the FENCE — posts + panels, with one gate on the quay side. You can walk
    // the whole perimeter and read the hull through the mesh: locked, visible.
    const FX0 = cx - 3.6, FX1 = cx + 3.6, FZ0 = cz - 7.6, FZ1 = cz + 7.6;
    const GATE_W = 2.2, gateX = FX1, gateZ = cz;           // gate faces the quay walk
    const panels = [], posts = [];
    function seg(x0, z0, x1, z1) {
      const midx = (x0 + x1) / 2, midz = (z0 + z1) / 2;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const gm = new THREE.BoxGeometry(Math.max(0.06, Math.abs(x1 - x0)), 1.9, Math.max(0.06, Math.abs(z1 - z0)));
      gm.translate(midx, QT + 0.95, midz);
      panels.push(gm);
      CBZ.colliders.push({
        minX: Math.min(x0, x1) - 0.05, maxX: Math.max(x0, x1) + 0.05,
        minZ: Math.min(z0, z1) - 0.05, maxZ: Math.max(z0, z1) + 0.05,
        y0: QT, y1: QT + 1.9, noCam: true,
      });
      return len;
    }
    seg(FX0, FZ0, FX1, FZ0);
    seg(FX0, FZ1, FX1, FZ1);
    seg(FX0, FZ0, FX0, FZ1);
    seg(FX1, FZ0, FX1, gateZ - GATE_W / 2);
    seg(FX1, gateZ + GATE_W / 2, FX1, FZ1);
    for (const px of [FX0, FX1]) for (const pz of [FZ0, FZ1]) {
      const gm = new THREE.BoxGeometry(0.14, 2.1, 0.14);
      gm.translate(px, QT + 1.05, pz);
      posts.push(gm);
    }
    const BGU = THREE.BufferGeometryUtils;
    const fenceMat = new THREE.MeshLambertMaterial({ color: 0x9aa3ab, transparent: true, opacity: 0.55 });
    if (BGU && BGU.mergeBufferGeometries) {
      const mesh = new THREE.Mesh(BGU.mergeBufferGeometries(panels.concat(posts)), fenceMat);
      mesh.matrixAutoUpdate = false; root.add(mesh);
    } else {
      for (const gm of panels.concat(posts)) root.add(new THREE.Mesh(gm, fenceMat));
    }
    // the gate leaf — a live mesh (it opens the day you own her)
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.9, GATE_W), cm(0x39424a));
    leaf.position.set(gateX, QT + 0.95, gateZ);
    leaf.userData.captGate = 1;
    root.add(leaf);
    const gateCol = { minX: gateX - 0.08, maxX: gateX + 0.08, minZ: gateZ - GATE_W / 2, maxZ: gateZ + GATE_W / 2, y0: QT, y1: QT + 1.9, noCam: true };
    CBZ.colliders.push(gateCol);
    yardGate = { x: gateX + 0.9, z: gateZ, hullKey: "sportfish", leaf: leaf, col: gateCol, open: false };
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    wireYardZone();
    return null;
  }
  if (CBZ.addLandmass) CBZ.addLandmass(function (city) {
    yardBuilt = false; boardPos = null; yardGate = null;
    // marina stamps its site synchronously; this reads it, so it must run
    // immediately AFTER it. The pair moved together from 66/67 to 97.5/97.6:
    // the marina cannot choose its water until city/continent.js publishes
    // the real shoreline at 97, and a yard placed against a marina that has
    // not been sited yet is a yard on the wrong coast.
    return buildYard(city);
  }, 97.6);

  let yardZoneWired = false;
  function wireYardZone() {
    if (yardZoneWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    yardZoneWired = true;
    const I = CBZ.interactions;
    function prizeEntry() {
      if (!CBZ.cityBoatyard || !CBZ.cityBoatyard.catalog) return null;
      try { for (const e of CBZ.cityBoatyard.catalog()) if (e.key === "sportfish") return e; } catch (err) {}
      return null;
    }
    I.registerZone({
      id: "captain-yardgate", kind: "yardGate", radius: 3.2,
      find: function (px, pz) {
        if (!yardGate) return null;
        const dx = yardGate.x - px, dz = yardGate.z - pz;
        if (dx * dx + dz * dz > 3.2 * 3.2) return null;
        return { x: yardGate.x, z: yardGate.z, name: "The hard stand" };
      },
      options: [
        { id: "yg-locked", slot: "e", bad: true,
          canShow: function () { return !!yardGate && !yardOwned(); },
          label: function () {
            const e = prizeEntry();
            return "Locked, the " + (e ? e.label : "Ravenna 41") + ". " + money(e ? e.price : 1450000) + " at the broker's desk";
          },
          onSelect: function () { note("Chain and padlock. The hull sits there where you can read her name. The broker sells the key.", 3); } },
        { id: "yg-open", slot: "e",
          canShow: function () { return !!yardGate && yardOwned() && !yardGate.open; },
          label: function () { return "Unlock your yard gate"; },
          onSelect: function () {
            yardGate.open = true;
            yardGate.leaf.visible = false;
            yardGate.col.y0 = 99999; yardGate.col.y1 = 99999;   // the door stops stopping you
            if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
            note("Your name is on the cradle now. She goes in the water at the desk.", 2.6);
          } },
      ],
    });
    if (I.describe) I.describe("yardGate", function () {
      return { label: "Cassaline hard stand", note: yardOwned() ? "Your hull on the cradle" : "The next boat up, locked" };
    });
  }
  function yardOwned() {
    return !!(CBZ.cityBoatyard && CBZ.cityBoatyard.owned && CBZ.cityBoatyard.owned("sportfish"));
  }

  /* ==========================================================================
     8. THE TICK — one onUpdate, everything above breathes through it.
        37.35: after origins' scene tick (37), before water_buoyancy (38.5) so
        the mate's autopilot writes land the same frame the swell reads them.
     ========================================================================== */
  function pirateWatch() {
    if (!CBZ.pirateCrews || !boat) return;
    let crews = null;
    try { crews = CBZ.pirateCrews(); } catch (e) { return; }
    if (!crews) return;
    for (const cr of crews) {
      if (!cr || cr.target !== boat || pirateHitSeen[cr.id]) continue;
      pirateHitSeen[cr.id] = 1;
      nPirateHits++;
      note("Skiffs on the quarter, that's not a fishing pattern. Arm the crew.", 3.4, { urgent: true });
    }
  }

  if (CBZ.onUpdate) CBZ.onUpdate(37.35, function (dt) {
    if (!on() || !g || g.mode !== "city") return;
    wireOrders();
    wireZones();
    if (g.state !== "playing") return;          // origins' own tick gates the same way
    if (pendingStart) {
      pendingStart.t += dt;
      if (tryLaunch()) pendingStart = null;
      else if (pendingStart.t > START_SEC) {
        pendingStart = null;
        note("The harbour never sent your boat out. She'll be at the marina when the water clears.", 3.4);
      }
    }
    if (!boat) {
      // a reload / a redelivery through the boatyard: adopt the owned hull the
      // moment it exists again, and re-crew her.
      if (CBZ.cityCars) for (const c of CBZ.cityCars) {
        if (c && !c.dead && c._boatKey === flag() && c.owned) { boat = c; rigFlagship(c); crewBoat(c); break; }
      }
    } else if (boat.dead || !boat.group || !boat.group.parent) {
      // vehicle_hold's own 9.4 housekeeping releases freight from a dead host;
      // disposing the handle here just makes the teardown immediate.
      if (hold) { try { hold.dispose(); } catch (e) {} }
      boat = null; hold = null; chartGrp = null; helm = null; crew.length = 0;
      // the posts died with her (their alive() reads the hull) — zero the
      // venue's declared count NOW, or venueStaffAudit's shared unstaffed pin
      // (0) would read a phantom shortfall until she is redelivered.
      crewPosts.length = 0;
      if (venueDeclared && CBZ.cityStaffStations) { try { CBZ.cityStaffStations("captain", 0); } catch (e) {} }
    }
    if (!boat) return;
    helmTick(dt);
    crewFishTick(dt);
    crewDefend(dt);
    voyageTick(dt);
    if (C.CAPTAIN_PIRATES !== false) pirateWatch();
  });

  /* ==========================================================================
     9. THE AUDIT — CBZ.captainAudit(). The orchestrator runs it.
     ========================================================================== */
  /* THE FITTINGS RATCHET. A picker that offers eleven hulls is eleven chances
     to stand a man in the sea, and the fault is silent — nothing throws when a
     crew station lands four metres off the transom, you just find a deckhand
     treading water. So every station this file places is checked against the
     hull's OWN envelope, for EVERY hull in the registry rather than the one
     being sailed: `offHull` is answerable at boot, with no run and no origin.
     0.62 x the moulded dimension is the bound — a little proud of the hull,
     because a bulwark, a rubbing strake and a boarding platform all legally
     sit outside the moulded beam and none of them is the sea. */
  function fitFaults(key) {
    const F = solveFit(key);
    const halfB = F.beam * 0.62, halfL = F.loa * 0.62;
    const pts = [
      ["chart", F.chartX, F.chartZ], ["helm", 0, F.helmZ],
      ["holdFwd", F.wallX, 0], ["holdAft", F.wallX, F.holdZ - F.holdD * 0.5],
      ["sill", F.rampW * 0.5, F.sillZ],
      ["bench", F.benchX, F.railZ * 0.87],
      ["crate", F.crateX, F.railZ - F.crateStep],
      ["rail", F.railX, F.railZ - F.railStep],
    ];
    const R = roster(F);
    for (let i = 0; i < R.length; i++) pts.push(["crew:" + R[i].rank, R[i].st.x, R[i].st.z]);
    const bad = [];
    for (const p of pts) {
      if (!isFinite(p[1]) || !isFinite(p[2]) || Math.abs(p[1]) > halfB || Math.abs(p[2]) > halfL) bad.push(key + "/" + p[0]);
    }
    return bad;
  }
  CBZ.captainFitAudit = function () {
    const rows = CBZ.cityOriginBoats ? CBZ.cityOriginBoats() : [];
    const keys = rows.length ? rows.map(function (r) { return r.id; }) : [DEFAULT_FLAG];
    let off = [], holds = 0, hands = 0;
    for (const k of keys) {
      off = off.concat(fitFaults(k));
      const F = solveFit(k);
      if (F.canHold) holds++;
      hands += F.crewN;
    }
    return {
      hulls: keys.length,        // how many boats the start menu offers
      offHull: off.length,       // PINNED AT 0 — a fitting placed outside its hull
      where: off.slice(0, 8),
      withHold: holds,           // boats big enough for a real cargo room
      crewSeats: hands,          // total stations across the fleet (> 0 or nobody sails)
      flag: flagKey, flagLabel: FIT ? FIT.label : null,
    };
  };

  CBZ.captainAudit = function () {
    const P = CBZ.player;
    const live = liveCrew();
    let verbs = 0;
    for (const v of ["admit", "launch", "restart", "moor", "sail"]) {
      let held = false;
      for (const c of live) if (crewCan(c, v) && CBZ.rankKnows && CBZ.rankKnows(ORG, v)) { held = true; break; }
      if (held) verbs++;
    }
    let rungs = 0;
    if (CBZ.cityBoatyard && CBZ.cityBoatyard.catalog) {
      try {
        const bands = { dinghy: 0, work: 0, coastal: 0, superyacht: 0 };
        for (const e of CBZ.cityBoatyard.catalog()) {
          if (e.price < 60000) bands.dinghy = 1;
          else if (e.price < 1000000) bands.work = 1;
          else if (e.price < 5000000) bands.coastal = 1;
          else bands.superyacht = 1;
        }
        rungs = bands.dinghy + bands.work + bands.coastal + bands.superyacht;
      } catch (e) {}
    }
    let locked = 0;
    if (yardGate && !yardGate.open) locked++;
    if (boardPos && !playerIsCaptain()) locked++;
    return {
      enabled: on(),
      boat: !!boat,
      flag: flagKey, flagLabel: FIT ? FIT.label : null,
      crewPlanned: FIT ? FIT.crewN : null,
      atHelm: !!(boat && P && P.driving && P._vehicle === boat),
      mateHasHelm: !!helm,
      crew: live.length,
      crewVerbs: verbs,
      ordersLive: ordersWired ? 3 : 0,
      ordersIssued: nOrders,
      armed: armedUp,
      holds: hold ? 1 : 0,
      holdAboard: hold ? hold.occupants() : null,
      chartTable: !!chartGrp,
      voyageLive: voyage ? voyage.kind : null,
      charters: nCharters, cargoRuns: nCargo, cratesDelivered: nCratesDelivered,
      fishTrips: nFishTrips, crewCatches: nCrewCatches, salvages: nSalvage,
      raids: nRaids, pirateHits: nPirateHits,
      boatLadderRungs: rungs,
      lockedDoors: locked,
      yardBuilt: yardBuilt,
      playerRank: (CBZ.factions && CBZ.factions.rank) ? (function () { try { return CBZ.factions.rank(ORG); } catch (e) { return null; } })() : null,
    };
  };
})();
