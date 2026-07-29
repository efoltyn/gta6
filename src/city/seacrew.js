/* ===========================================================================
   city/seacrew.js — THE SHIP'S COMPANY

   OWNER: "npcs with roles like captain and bosun and steward".

   A yacht with nobody on it is a stage set — the exact failure city/airside.js
   shipped and then fixed (1,471 lines of driverless machines on a live apron).
   So every vessel this file knows about carries a crew, and the crew is not
   decoration: A RANK IS A VERB, OR IT IS NOTHING (CLAUDE.md).

   WHAT EACH RUNG ACTUALLY OPENS, all enforced, none aspirational:

     Deckhand        —                     (the rung you are hired at)
     Steward         admit    — decides whether you are a guest or a trespasser
                                on the accommodation decks
     Bosun           launch   — the tender and the davit crane
     Chief Engineer  restart  — a killed engine
     First Mate      moor     — takes the ship to a berth
     Captain         sail     — gets her under way and orders a heading

   KILL THE CAPTAIN AND SHE LOSES WAY. That is the consequence that makes them
   people instead of silhouettes, and it is the same law aircraft.js applies to
   a dead pilot. It is NOT a new damage path: "is there anybody aboard who may
   sail" is asked once a second and the answer IS the whole mechanic.

   THE MIGRATIONS, not additions
   ------------------------------------------------------------
   · Bodies come from CBZ.cityStaffPost — data at build time, a rig only inside
     170 m. That number is arithmetic, not taste (peds.js hides rigs past 95 m
     and npcTransitionSafe auto-allows past 150 m, so nobody ever SEES a crewman
     appear). This file mints no ped.
   · A station on a MOVING vessel uses the post's own `at` seam — the same one
     airside.js uses for a pushback tug. No second tracking loop.
   · A seated crewman goes in through CBZ.npcLife.attach against a scale-cancelled
     `crew` node, so syncAttached holds him against the hull's own motion. No
     bespoke occupant system, and CBZ.cityUnseat is the only way out of a seat.
   · The ladder is ONE CBZ.factions.declare with `rankField: "seaRank"`, so the
     rank lives in the field the world already writes and factions.js stores
     nothing. That is what keeps this a migration and not parallel bookkeeping.
   · Every gate reads CBZ.rankKnows FIRST. rankCan() answers FALSE for an
     undeclared org, so a bare `if (!rankCan(...)) return` would slam every gate
     shut the moment FACTION_V1 was flipped off. That trap is documented in
     CLAUDE.md and this file does not walk into it.
   · A crewman can bolt or put his hands up like anyone else: CBZ.cityScare is
     the ONE freeze-or-run decision and nothing here re-implements it.
   · The trades register into CBZ.cityJobs / CBZ.cityJobKinds on the first tick,
     copying citystaff.js's own wireTrades() pattern — a crewman with no shift,
     no wage and no workplace is label #121 the job table never heard of, which
     is the census failure CLAUDE.md names.

   AN ACTIVITY IS NOT AN IDENTITY. A yacht GUEST is not a role — it is a rich
   person who is aboard tonight. Guests therefore get CBZ.citySetAttending, and
   only the working crew get a job.

   FLAGS
     CBZ.CONFIG.SEA_CREW        (true)  crew the fleet at all
     CBZ.CONFIG.SEA_CREW_RANKS  (true)  declare the ladder / gate the verbs
     CBZ.CONFIG.SEA_CREW_GUESTS (true)  guests on the big hulls

   Exposes: CBZ.seaCrew, CBZ.seaCan, CBZ.seaCrewAudit.
   =========================================================================== */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (C.SEA_CREW == null) C.SEA_CREW = true;
  if (C.SEA_CREW_RANKS == null) C.SEA_CREW_RANKS = true;
  if (C.SEA_CREW_GUESTS == null) C.SEA_CREW_GUESTS = true;

  const ORG = "shipco";

  /* ==========================================================================
     1. THE LADDER — six rungs, five verbs, and not one vanity multiplier.
     ========================================================================== */
  const LADDER = [
    { key: "deckhand", pip: "Deckhand", lvl: 8 },
    { key: "steward", pip: "Steward", lvl: 12, grants: ["admit"] },
    { key: "bosun", pip: "Bosun", lvl: 17, grants: ["launch"] },
    { key: "engineer", pip: "Chief Engineer", lvl: 23, grants: ["restart"] },
    { key: "mate", pip: "First Mate", lvl: 30, grants: ["moor"] },
    { key: "captain", pip: "Captain", lvl: 41, grants: ["sail", "standdown"], locked: true },
  ];

  // Declared LAZILY on the first tick, not at parse: index.html loads
  // seacrew.js at :970 and factions.js later, so CBZ.factions does not exist
  // while this IIFE runs.
  let declared = false;
  function declareOrg() {
    if (declared || C.SEA_CREW_RANKS === false) return declared;
    if (!CBZ.factions || !CBZ.factions.declare || !CBZ.factions.exists) return false;
    if (CBZ.factions.exists(ORG)) { declared = true; return true; }
    try {
      CBZ.factions.declare({
        id: ORG, name: "Ship's Company", short: "Crew",
        kind: "org", color: 0x2f7fa8,
        ranks: LADDER,
        // THE MIGRATION: the rank stays in the field the world writes.
        rankField: "seaRank",
        npcTag: { field: "seaCrew", value: true },
        wage: 190, heat: 0.15,
        friendlyTo: ["police"],
        admission: { test: function () { return "You sign on at the marina, not at sea."; } },
        lore: "Six rungs. Each one is an order the rung below it cannot give.",
      });
      declared = true;
    } catch (e) { declared = false; }
    return declared;
  }

  // THE DEGRADE-SAFE GATE. rankKnows answers "does this outfit have this verb
  // at all" — false when the whole faction layer is off — so a flag flip can
  // never slam a door that was open a frame ago.
  function seaCan(actor, verb) {
    if (C.SEA_CREW_RANKS === false) return true;
    if (!CBZ.rankKnows || !CBZ.rankCan || !CBZ.rankKnows(ORG, verb)) return true;
    return !!CBZ.rankCan(actor, ORG, verb);
  }
  function seaHolder(verb) {
    if (C.SEA_CREW_RANKS === false || !CBZ.rankHolder || !CBZ.rankKnows || !CBZ.rankKnows(ORG, verb)) return null;
    try { return CBZ.rankHolder(ORG, verb, { pool: CBZ.cityPeds }); } catch (e) { return null; }
  }
  CBZ.seaCan = seaCan;

  /* ==========================================================================
     2. THE TRADES — citystaff.js's own wireTrades() pattern, in our file.

     citystaff.js is another territory; the pattern is public
     (CBZ.cityStaffTrades) and copying its SHAPE while owning our own rows is
     exactly what "adding a trade is a ROW" means. Deferred to the first tick
     because aigoals.js derives JOB_KINDS once at parse and CBZ.cityJobs does
     not exist when this file runs.
     ========================================================================== */
  const TRADES = {
    "yacht captain": { class: "service", anchor: "marina", hours: [7, 21], pay: 34 },
    "first mate": { class: "service", anchor: "marina", hours: [7, 21], pay: 26 },
    "bosun": { class: "trade", anchor: "marina", hours: [6, 20], pay: 20 },
    "chief engineer": { class: "trade", anchor: "marina", hours: [6, 20], pay: 24 },
    "chief steward": { class: "service", anchor: "marina", hours: [7, 23], pay: 19 },
    "steward": { class: "service", anchor: "marina", hours: [7, 23], pay: 15 },
    "stewardess": { class: "service", anchor: "marina", hours: [7, 23], pay: 15 },
    "yacht chef": { class: "service", anchor: "marina", hours: [6, 22], pay: 23 },
    "trawlerman": { class: "trade", anchor: "fishing", hours: [4, 16], pay: 13 },
    "skipper": { class: "trade", anchor: "fishing", hours: [4, 18], pay: 18 },
    "net hand": { class: "trade", anchor: "fishing", hours: [4, 16], pay: 11 },
    "divemaster": { class: "service", anchor: "marina", hours: [8, 18], pay: 17 },
  };
  let tradesWired = false;
  function wireTrades() {
    const J = CBZ.cityJobs, K = CBZ.cityJobKinds;
    if (!J || !K) return false;
    for (const k in TRADES) {
      if (J[k]) continue;                       // aigoals/citystaff own it — never overwrite
      J[k] = TRADES[k];
      K[k] = TRADES[k].lots || [];
    }
    return true;
  }

  /* ==========================================================================
     3. THE COMPLEMENT — who is aboard, derived from the hull

     A real yacht's crew scales with GT, which scales roughly with L^2.5, and
     the industry rule of thumb is a crew per ~100 GT. So the complement is
     SOLVED from the length and adding a size does not mean adding a roster:
     34 m -> 3 · 46 m -> 3 · 88 m -> 4 · 156 m -> 8, plus 0/0/2/3 guests.
     ========================================================================== */
  const ROSTER = [
    { job: "yacht captain", rank: "captain", seat: true, arch: "professional", wealth: 0.75, outfit: 0x1b2a44 },
    { job: "first mate", rank: "mate", seat: true, arch: "professional", wealth: 0.55, outfit: 0x24354f },
    { job: "bosun", rank: "bosun", arch: "laborer", wealth: 0.34, outfit: 0xe9ebec },
    { job: "chief engineer", rank: "engineer", arch: "laborer", wealth: 0.42, outfit: 0x3c4247 },
    { job: "chief steward", rank: "steward", arch: "professional", wealth: 0.38, outfit: 0xf1f2f3 },
    { job: "deckhand", rank: "deckhand", arch: "laborer", wealth: 0.24, outfit: 0xe9ebec },
    { job: "stewardess", rank: "steward", arch: "professional", wealth: 0.30, outfit: 0xf1f2f3 },
    { job: "yacht chef", rank: "steward", arch: "professional", wealth: 0.40, outfit: 0xf6f6f4 },
    { job: "deckhand", rank: "deckhand", arch: "laborer", wealth: 0.24, outfit: 0xe9ebec },
    { job: "steward", rank: "steward", arch: "professional", wealth: 0.28, outfit: 0xf1f2f3 },
  ];
  function complement(loa) {
    // GT ~ 0.0018 L^2.5 for a displacement yacht, then a crew per ~110 GT over
    // a floor of three. MEASURED against the shipped ladder:
    //   34 m -> 3 · 46 m -> 3 · 88 m -> 4 · 156 m -> 8 (of a 10-rung roster)
    // The floor is 3, not 2, because two is a captain and a mate SITTING ON THE
    // BRIDGE and nobody on deck — a boat that reads as abandoned from outside,
    // which is the exact failure this file exists to fix. The ceiling is the
    // roster length: a real 156 m yacht carries ~96 crew, and 96 rigs at ~16
    // draw calls each is not a trade this game can make.
    const gt = 0.0018 * Math.pow(loa, 2.5);
    return Math.max(3, Math.min(ROSTER.length, Math.round(gt / 110) + 3));
  }
  // A working boat is not a yacht: a trawler carries a skipper and net hands,
  // and a skiff carries one man.
  const WORK_ROSTER = {
    trawler: [
      { job: "skipper", rank: "captain", seat: true, arch: "laborer", wealth: 0.34, outfit: 0xd8862c },
      { job: "net hand", rank: "deckhand", arch: "laborer", wealth: 0.20, outfit: 0xd8862c },
      { job: "trawlerman", rank: "deckhand", arch: "laborer", wealth: 0.20, outfit: 0x4a5232 },
    ],
    sportfish: [
      { job: "skipper", rank: "captain", seat: true, arch: "laborer", wealth: 0.40, outfit: 0x2f6d8f },
      { job: "deckhand", rank: "deckhand", arch: "laborer", wealth: 0.24, outfit: 0xe9ebec },
    ],
    skiff: [{ job: "fisherman", rank: "deckhand", arch: "laborer", wealth: 0.18, outfit: 0x4a5232 }],
    sloop: [{ job: "skipper", rank: "captain", seat: true, arch: "civilian", wealth: 0.62, outfit: 0xe6e8e6 }],
  };

  /* ==========================================================================
     4. CREWING A VESSEL
     ========================================================================== */
  const SHIPS = [];            // {car, key, posts:[], crew:[], guests:[], node}
  let postSeq = 0;
  let venueDeclared = false;
  let implied = 0;             // crew the live fleet SHOULD carry (see declareVenue)

  // Anchors are authored in metres; a hull group may carry a scale, so the crew
  // node cancels it — aircraft.js's crewNode trick verbatim.
  function crewNode(car) {
    const THREE = window.THREE;
    if (!THREE || !car || !car.group) return null;
    const g = car.group;
    if (g.userData._seaCrewNode && g.userData._seaCrewNode.parent === g) return g.userData._seaCrewNode;
    const n = new THREE.Group();
    const s = (g.scale && g.scale.x) || 1;
    n.scale.setScalar(s > 0.001 ? 1 / s : 1);
    n.name = "crew";
    n.userData.dynamic = true;                 // live rigs live here — never batch
    g.add(n);
    g.userData._seaCrewNode = n;
    return n;
  }

  // The yacht record is stamped on whichever node water_hulls' finish() made
  // and vehicles.js may nest that again, so this traverses rather than guessing
  // a depth. Once per vessel, at crewing time.
  function solveOf(car) {
    if (!car || !car.group || !car.group.traverse) return null;
    let s = null;
    car.group.traverse(function (o) { if (!s && o.userData && o.userData.yacht) s = o.userData.yacht.solve; });
    return s;
  }

  // Where each rung stands, in HULL-LOCAL metres, solved from the vessel's own
  // geometry — never a typed coordinate. The bridge watch SITS; everybody else
  // stands their post on a real deck.
  function stations(S, key, roster) {
    const out = [];
    if (!S) {
      // a working boat: one bridge seat, the rest on the after deck
      const rec = (CBZ.marineHulls && CBZ.marineHulls.get) ? CBZ.marineHulls.get(key) : null;
      const L = (rec && rec.spec && rec.spec.loa) || 12;
      const dk = (rec && rec.spec && rec.spec.deckY) || 1.4;
      roster.forEach(function (r, i) {
        out.push({
          role: r, x: (i % 2 ? 1 : -1) * L * 0.06, y: dk,
          z: r.seat ? L * 0.16 : -L * (0.16 + 0.06 * i),
          face: r.seat ? 0 : Math.PI, sit: !!r.seat, cushionH: 0.40,
        });
      });
      return out;
    }
    const bTier = Math.max(1, S.tiers - 1);
    const bY = S.deckY[bTier], bZ = S.supZ1[bTier];
    roster.forEach(function (r, i) {
      if (r.rank === "captain") {
        out.push({ role: r, x: 0.95, y: bY + 0.20, z: bZ - 0.072 * S.loa, face: 0, sit: true, cushionH: 0.36 });
      } else if (r.rank === "mate") {
        out.push({ role: r, x: -0.95, y: bY + 0.20, z: bZ - 0.072 * S.loa, face: 0, sit: true, cushionH: 0.36 });
      } else if (r.job === "bosun" || r.job === "deckhand") {
        // on the side deck, where deck work happens
        out.push({
          role: r, x: (i % 2 ? 1 : -1) * (S.halfBeam - S.sideW * 0.5 - 0.10),
          y: S.freeboard + 0.16, z: S.loa * (0.12 - 0.06 * i),
          face: (i % 2 ? -1 : 1) * Math.PI / 2, sit: false,
        });
      } else if (r.job === "chief engineer") {
        // at the garage / machinery-space door
        out.push({
          role: r, x: S.halfBeam * 0.45, y: (S.garage ? S.garage.y : S.freeboard) + 0.16,
          z: S.garage ? S.garage.z : -S.loa * 0.10, face: Math.PI / 2, sit: false,
        });
      } else {
        // the interior staff work the aft main deck: the bar, the table, the pool
        out.push({
          role: r, x: (i % 2 ? 1 : -1) * S.halfBeam * 0.42,
          y: S.freeboard + 0.10, z: S.supZ0[0] - S.loa * (0.045 + 0.022 * (i % 3)),
          face: (i % 2 ? -1 : 1) * Math.PI * 0.5, sit: false,
        });
      }
    });
    return out;
  }

  function crewVessel(car, key) {
    if (C.SEA_CREW === false || !car || !car.group) return null;
    if (!CBZ.cityStaffPost) return null;
    const rec = (CBZ.marineHulls && CBZ.marineHulls.get) ? CBZ.marineHulls.get(key) : null;
    if (!rec) return null;
    const S = solveOf(car);
    const roster = S ? ROSTER.slice(0, complement(S.loa)) : (WORK_ROSTER[key] || null);
    if (!roster || !roster.length) return null;

    const ship = { car: car, key: key, posts: [], crew: [], guests: [], node: null, wasCaptained: false };
    const st = stations(S, key, roster);
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      const p = CBZ.cityStaffPost({
        venue: "seacrew", id: "seacrew:" + key + ":" + (postSeq++),
        job: s.role.job, archetype: s.role.arch,
        // The post's ANCHOR follows the hull; `at` is the moving-station seam.
        x: car.pos.x, z: car.pos.z, face: s.face,
        at: function () { return car.pos; },
        alive: function () { return !!(car.group && car.group.parent) && !car.dead; },
        opts: {
          wealth: s.role.wealth, outfit: s.role.outfit, aggr: 0.10,
          // THE RANK LIVES IN THE FIELD THE WORLD WRITES. factions.js reads
          // `seaRank` through rankField and stores nothing of its own.
          seaRank: s.role.rank, seaCrew: true,
        },
        attach: function (ped) {
          if (!CBZ.npcLife || !CBZ.npcLife.attach) return false;
          const node = crewNode(car);
          if (!node) return false;
          ped._seatHold = true;                 // syncAttached defends the pose
          ship.node = node;
          return !!CBZ.npcLife.attach(ped, node, {
            x: s.x, y: s.y, z: s.z, yaw: s.face,
            pose: s.sit ? "sit" : "stand", state: s.sit ? "sit" : "idle",
            cushionH: s.sit ? (s.cushionH || 0.40) : null, floorBelow: 0,
          });
        },
        release: function (ped, why) {
          const j = ship.crew.indexOf(ped);
          if (j >= 0) ship.crew.splice(j, 1);
          // Only a KILL or a hijack leaves a body behind. Out of range, a world
          // rebuild or a mode reset means nobody can see this hull, and the body
          // goes back to the pool rather than leaking into the next arena.
          if (why !== "gone" && why !== "dead") return false;
          if (CBZ.cityUnseat) { try { CBZ.cityUnseat(ped, { state: ped.dead ? "dead" : "walk" }); } catch (e) {} }
          if (!ped.dead) { ped.staffPost = null; ped.state = "walk"; ped.pause = 0.6; }
          return true;                          // the world keeps him
        },
        after: function (ped) {
          ped.seaRank = s.role.rank;
          ped.seaCrew = true;
          ped._seaShip = car;
          if (ship.crew.indexOf(ped) < 0) ship.crew.push(ped);
        },
      });
      if (p) ship.posts.push(p);
    }

    // GUESTS on the big hulls. An activity is not an identity: a guest keeps
    // whatever trade the caster dealt him and gets the ATTENDING line instead.
    if (C.SEA_CREW_GUESTS !== false && S && S.loa >= 70) {
      const n = Math.min(4, Math.round(S.loa / 45));
      const poolL = S.loa * 0.055;
      const poolZ = S.supZ0[0] - poolL * 0.9;
      for (let i = 0; i < n; i++) {
        const ii = i;
        const p = CBZ.cityStaffPost({
          venue: "seacrew", id: "seacrew:guest:" + key + ":" + (postSeq++),
          archetype: "resident",
          x: car.pos.x, z: car.pos.z, face: Math.PI * (ii % 2 ? 0.5 : -0.5),
          at: function () { return car.pos; },
          alive: function () { return !!(car.group && car.group.parent) && !car.dead; },
          opts: { wealth: 0.94, aggr: 0.03 },
          attach: function (ped) {
            if (!CBZ.npcLife || !CBZ.npcLife.attach) return false;
            const node = crewNode(car);
            if (!node) return false;
            ped._seatHold = true;
            return !!CBZ.npcLife.attach(ped, node, {           // by the pool, aft main deck
              x: (ii < 2 ? 1 : -1) * (Math.min(S.halfBeam * 0.9, poolL) * 0.5 + 1.5),
              y: S.freeboard + 0.50, z: poolZ + (ii % 2 ? 1.4 : -1.4),
              yaw: (ii < 2 ? -1 : 1) * Math.PI * 0.5, pose: "sit", state: "sit",
              cushionH: 0.16, floorBelow: 0,
            });
          },
          release: function (ped, why) {
            const j = ship.guests.indexOf(ped);
            if (j >= 0) ship.guests.splice(j, 1);
            if (why !== "gone" && why !== "dead") return false;
            if (CBZ.cityUnseat) { try { CBZ.cityUnseat(ped, { state: ped.dead ? "dead" : "walk" }); } catch (e) {} }
            return true;
          },
          after: function (ped) {
            // NOT a job. citySetAttending is the ONE place an activity lives.
            if (CBZ.citySetAttending) { try { CBZ.citySetAttending(ped, "a party aboard", "seacrew"); } catch (e) {} }
            ped._seaGuest = true;
            if (ship.guests.indexOf(ped) < 0) ship.guests.push(ped);
          },
        });
        if (p) ship.posts.push(p);
      }
    }

    SHIPS.push(ship);
    return ship;
  }

  /* ==========================================================================
     5. THE CONSEQUENCE — kill the captain and she loses way

     Not a new damage contract and not a per-frame scan: once a second we ask
     the ONE question the ladder exists to answer, and the answer IS the
     mechanic. A hull with nobody who may `sail` cannot make way; she carries
     her way off slowly, which is what a real ship does and is the reason the
     captain is worth finding.

     The player is exempt — you drive your own boat.
     ========================================================================== */
  function captainOf(ship) {
    for (let i = 0; i < ship.crew.length; i++) {
      const c = ship.crew[i];
      if (c && !c.dead && seaCan(c, "sail")) return c;
    }
    return null;
  }

  let cmdT = 0;
  function commandTick(dt) {
    cmdT += dt;
    if (cmdT < 1) return;
    cmdT = 0;
    for (let i = SHIPS.length - 1; i >= 0; i--) {
      const ship = SHIPS[i];
      const car = ship.car;
      if (!car || car.dead || !car.group || !car.group.parent) { SHIPS.splice(i, 1); continue; }
      if (car.player) { car._noCaptain = false; continue; }   // you are the captain now
      const cap = captainOf(ship);
      if (cap) { ship.wasCaptained = true; car._noCaptain = false; continue; }
      if (!ship.wasCaptained) continue;                       // she never had one to lose
      car._noCaptain = true;
      // SHE LOSES WAY. Not a stop — a 10,000-tonne hull carries her way for
      // minutes, and that drift is the point. water_helm.js integrates from
      // car.v, so damping it here is the whole change.
      if (car.v) car.v *= 0.985;
      if (Math.abs(car.v) < 0.05) car.v = 0;
      car.ai = false;
    }
  }

  /* ==========================================================================
     6. THE VERBS, WHERE A PLAYER MEETS THEM

     `admit` is the one a player feels: a steward decides whether the
     accommodation decks are yours to walk. It reuses outfits.js's disguise
     trust and the wanted level rather than inventing a second door policy, and
     it costs nothing when nobody senior is aboard.
     ========================================================================== */
  function admitted(ship) {
    if (C.SEA_CREW_RANKS === false) return true;
    let gate = null;
    for (let i = 0; i < ship.crew.length; i++) {
      const c = ship.crew[i];
      if (c && !c.dead && seaCan(c, "admit")) { gate = c; break; }
    }
    if (!gate) return true;                       // nobody aboard who may say no
    // A crew uniform you are wearing is a claim about you, and outfits.js
    // already owns whether the claim holds.
    if (CBZ.cityDisguiseTrust) {
      try { if (CBZ.cityDisguiseTrust(ORG) > 0.5) return true; } catch (e) {}
    }
    if (CBZ.factions && CBZ.factions.tier) {      // somebody they already answer to
      try { if (CBZ.factions.tier(ORG) >= 1) return true; } catch (e) {}
    }
    const g = CBZ.game;
    if (g && (g.wanted | 0) >= 2) return false;   // a manhunt outranks a costume
    return false;
  }

  CBZ.seaCrew = {
    ORG: ORG,
    ladder: function () { return LADDER.slice(); },
    ships: function () { return SHIPS.slice(); },
    of: function (car) { for (const s of SHIPS) if (s.car === car) return s; return null; },
    captain: captainOf,
    holder: seaHolder,
    admitted: function (car) { const s = CBZ.seaCrew.of(car); return s ? admitted(s) : true; },
    can: seaCan,
    crew: crewVessel,
    complement: complement,
    reset: function () { SHIPS.length = 0; venueDeclared = false; postSeq = 0; },
  };

  /* ==========================================================================
     7. WIRING
     ========================================================================== */
  // cityStaffVenue CLEARS every post for its venue, so it must be declared
  // exactly once and BEFORE the post loop — the trap island_airport.js
  // documents. It is declared with ZERO stations and the count is raised
  // afterwards through cityStaffStations (which updates without clearing).
  //
  // WHY, and it matters: venueStaffAudit().unstaffed is a SHARED ratchet pinned
  // at 0 across the whole game, and it is computed as
  // stations - (posts + census). If this file declared the count the fleet
  // THEORETICALLY implies and then failed to post one station — a hull whose
  // solve went missing, a roster that came back empty — it would push a
  // repo-wide invariant off zero from inside a boat. So the shared number is
  // always what we actually posted, and the honest shortfall (implied minus
  // posted) is measured in THIS file's own audit, where it belongs and where I
  // can pin it.
  function declareVenue() {
    if (!CBZ.cityStaffVenue) return;
    try {
      CBZ.cityStaffVenue("seacrew", {
        stations: 0, note: "ship's companies afloat: bridge watch, deck, interior, guests",
      });
      venueDeclared = true;
    } catch (e) { venueDeclared = false; }
  }
  // What the fleet SHOULD carry, from the same complement law the roster uses.
  function impliedComplement(fleet) {
    let want = 0;
    for (const f of fleet) {
      const rec = (CBZ.marineHulls && CBZ.marineHulls.get) ? CBZ.marineHulls.get(f.key) : null;
      const loa = rec && rec.spec ? rec.spec.loa : 0;
      if (loa >= 40) {
        want += complement(loa);
        if (C.SEA_CREW_GUESTS !== false && loa >= 70) want += Math.min(4, Math.round(loa / 45));
      } else if (WORK_ROSTER[f.key]) want += WORK_ROSTER[f.key].length;
    }
    return want;
  }
  // Keep the venue's station count equal to what we really posted.
  function syncStations() {
    if (!CBZ.cityStaffStations) return;
    let n = 0;
    for (const s2 of SHIPS) n += s2.posts.length;
    try { CBZ.cityStaffStations("seacrew", n); } catch (e) {}
  }

  let scanT = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(41.87, function (dt) {
    const g = CBZ.game;
    if (!g || g.mode !== "city") return;
    if (!tradesWired) tradesWired = wireTrades();
    if (!declared) declareOrg();
    commandTick(dt);
    if (C.SEA_CREW === false) return;
    scanT += dt;
    if (scanT < 1.5) return;
    scanT = 0;
    const fleet = CBZ.yachtFleet ? CBZ.yachtFleet() : null;
    if (!fleet || !fleet.length) return;
    if (!venueDeclared) declareVenue();
    implied = impliedComplement(fleet);
    let added = 0;
    for (let i = 0; i < fleet.length; i++) {
      const f = fleet[i];
      if (!f.car || f.car.dead || f.car._seaCrewed) continue;
      f.car._seaCrewed = true;
      try { if (crewVessel(f.car, f.key)) added++; } catch (e) { /* one bad hull must never cost the fleet */ }
    }
    if (added) syncStations();
  });

  // A world rebuild wipes the fleet; drop our bookkeeping with it or the next
  // arena inherits ships that no longer exist.
  if (CBZ.addLandmass) CBZ.addLandmass(function () {
    SHIPS.length = 0; venueDeclared = false; postSeq = 0; implied = 0;
    return null;
  }, 68);

  /* ==========================================================================
     8. THE RATCHET — CBZ.seaCrewAudit()

       ships          crewed vessels the world is running
       posts          declared stations across them (data; a body only at 170 m)
       manned         posts holding a live body right now
       crew / guests  live bodies, split by whether they WORK here
       rungs          declared rungs in the ladder
       verbedRungs    rungs that grant at least one verb
       verblessRungs  MUST stay at exactly 1 — only "Deckhand", the rung you are
                      hired at, may grant nothing. Any other verbless rung is a
                      vanity multiplier and CLAUDE.md bans it.
       emptyRanks     declared rungs with NO holder anywhere in the world. The
                      stat-fiction ban applied to a ladder: a Captain nobody can
                      find is a number, not an officer. MAY ONLY GO DOWN.
                      NOTE it is range-sensitive — posts are data until 170 m —
                      so read it with the player near the anchorage.
       shipsNoCaptain vessels that HAD a captain and have lost him. Evidence the
                      consequence is real rather than a claim.
       rolelessCrew   MUST BE 0 — a crewman whose job the job table never heard
                      of has no shift, no wage and no workplace.
       declared       is the ladder live (false = flag off, every gate open by
                      construction, which is the intended degrade).
     ========================================================================== */
  CBZ.seaCrewAudit = function () {
    let posts = 0, manned = 0, crew = 0, guests = 0, noCap = 0, roleless = 0;
    const held = Object.create(null);
    for (const s of SHIPS) {
      posts += s.posts.length;
      for (const p of s.posts) if (p.ped && !p.ped.dead) manned++;
      for (const c of s.crew) {
        if (!c || c.dead) continue;
        crew++;
        if (c.seaRank) held[c.seaRank] = (held[c.seaRank] | 0) + 1;
        const J = CBZ.cityJobs;
        if (!c.job || (J && !J[c.job])) roleless++;
      }
      for (const gu of s.guests) if (gu && !gu.dead) guests++;
      if (s.car && s.car._noCaptain) noCap++;
    }
    let verbed = 0;
    const verbless = [], empty = [];
    for (const r of LADDER) {
      if (r.grants && r.grants.length) verbed++; else verbless.push(ORG + ":" + r.key);
      if (!held[r.key]) empty.push(ORG + ":" + r.key);
    }
    return {
      ships: SHIPS.length, posts: posts, manned: manned, crew: crew, guests: guests,
      // implied = what the complement law says the live fleet should carry;
      // shortfall = implied - posts, and it is THIS file's own copy of the
      // "a venue with buildings and no people" measure. MUST BE 0.
      implied: implied, shortfall: Math.max(0, implied - posts),
      rungs: LADDER.length, verbedRungs: verbed, verblessRungs: verbless,
      emptyRanks: empty, shipsNoCaptain: noCap, rolelessCrew: roleless,
      declared: declared, tradesWired: tradesWired, venue: venueDeclared,
      trades: Object.keys(TRADES).length,
    };
  };
})();
