/* ============================================================
   CELL BLOCK Z — config.js
   Global namespace + all tunable constants in one place.
   Every other module hangs off window.CBZ.
============================================================ */
(function () {
  "use strict";

  const CBZ = (window.CBZ = window.CBZ || {});

  // ---- shared mutable buses (filled in by other modules) ----
  CBZ.colliders = [];      // {minX,maxX,minZ,maxZ, ref, [y0,y1]} — y0/y1 = a
                           // height-gated wall (window/doorway/floor), checked
                           // against an actor's vertical span; absent = full-height.
  CBZ.platforms = [];      // {minX,maxX,minZ,maxZ, top} — walkable horizontal
                           // surfaces (building floors, stairs, roofs). Only the
                           // player's vertical physics reads these (survival mode).
  CBZ.losBlockers = [];    // Mesh[] blocking guard vision + camera
  CBZ.guards = [];
  CBZ.npcs = [];           // inmates + warden (non-patrol interactable actors)
  CBZ.crowdAgents = [];     // deprecated compatibility bus; ambient rows live in CBZ.ambient typed arrays
  CBZ.coins = [];          // cigarette-pack pickups
  CBZ.searchlights = [];
  CBZ.bots = [];           // SURVIVAL mode: survivor bots (separate from npcs/guards)
  CBZ.cityPeds = [];       // CITY mode: pedestrians (money/loot/jobs, separate brain)
  CBZ.cityCops = [];       // CITY mode: police actors (wanted-driven, escalate)
  CBZ.cityCars = [];       // CITY mode: vehicles (traffic + stealable + the one you drive)
  CBZ.updaters = [];       // [{order, fn}] run every frame while playing
  CBZ.always = [];         // [{order, fn}] run every frame regardless of state

  // ---- game-mode registry (owned by the mode modules) ----
  // Two modes share this engine: the original prison "escape" and a new
  // natural-disaster "survival" battle-royale, and an open-world GTA-style
  // "city" (traffic laws, a 5-star wanted system, careers, shops, vehicles,
  // and a bust → jail handoff). A mode is a descriptor with
  // build()/reset()/objective hooks; state.js delegates to the active one.
  CBZ.modes = {};
  CBZ.registerMode = function (id, def) { CBZ.modes[id] = def; };

  // ---- timing (owned by core/loop.js) ----
  CBZ.now = 0;

  // ---- live game state (owned by systems/state.js) ----
  CBZ.game = {
    state: "title",        // title | playing | paused | won | lost
    mode: "city",          // city (main hub) | escape (prison) | survival (disasters)
    // ---- CITY mode live state (owned by city/*; reset in city.reset) ----
    cash: 0,               // $ — the city's currency (separate from prison cigs)
    wanted: 0,             // 0..5 stars (float; cops escalate as it climbs)
    heat: 0,               // 0..100 crime pressure that fills the next star
    hunger: 100,           // 0..100; starves like Minecraft, drains over time
    respect: 0,            // street cred — drives the leaderboard + gang doors
    kills: 0,              // confirmed kills this life (leaderboard)
    busted: false,         // true the instant cops cuff you → routes to jail
    escapedConvict: false, // true after breaking OUT of jail back to the city: holds
                           //   a 3★ floor + harder cops until CBZ.cityClearConvict()
    career: null,          // active money-making path (hitman/dealer/…)
    cityWorld: null,       // persistent city truth ledger (city/worldstate.js)
    cityActivity: null,    // timed hub activity currently resolving
    detection: 0,
    invuln: 0,
    elapsed: 0,
    cigs: 0,               // cigarettes — the prison's main currency
    caughtCount: 0,
    trades: 0,             // successful deals made (shown on win screen)
    hasKey: false,
    inventory: {},         // { itemName: count }
    role: "inmate",        // inmate | cop
    complaints: 0,         // cop-mode witness complaints
    gangStanding: [0, 0],   // player reputation with red/blue gangs
    gangDebt: [0, 0],       // unpaid gang tax/protection debt
    gangJob: null,          // active gang work offer accepted by player
    racketStanding: 0,      // corrupt-cop ledger: positive = payer, negative = marked problem
    lastKnown: null,        // latest reported player position for guard searches
    caseSearchCD: 0,        // cooldown between evidence-driven follow-up searches
    caseFile: { heat: 0, reports: [], lastSource: "", lastType: "", corrupt: 0 },
    socialProfile: { paid: 0, threatened: 0, refused: 0, helped: 0, listened: 0, bargained: 0, exploited: 0, last: "" },
    watcherDirectorT: 0,     // cooldown for NPCs deciding to tail/watch the player
  };

  /* ---- WHICH GAME THIS PAGE IS -------------------------------------------
     index.html is the whole release and opens on the city. disaster.html is
     ONE game — Natural Disaster Survival, the build that goes to the App
     Store — and it opens on the island, because a page that boots into the
     city has already paid for a world nobody asked for.

     Two doors, and nothing downstream needs to know there are two entry
     points: a page declares it before this file loads

         <script>window.CBZ = { START_MODE: "survival" };</script>

     or a URL asks for it (?mode=survival). systems/state.js already starts
     with `setMode(g.mode || "escape")`, so this is the whole mechanism. An
     unknown value is ignored rather than guessed at. */
  const MODES = { city: 1, escape: 1, survival: 1, gungame: 1 };
  let startMode = CBZ.START_MODE;
  try {
    const q = typeof location !== "undefined" && location.search
      && new URLSearchParams(location.search).get("mode");
    if (q) startMode = q;
  } catch (e) {}
  if (startMode && MODES[startMode]) CBZ.game.mode = startMode;

  // ---- colour palette (Roblox-bright, beveled feel) ----
  CBZ.COL = {
    WALL: 0x9aa3ad,
    WALL_D: 0x7d8794,
    TRIM: 0xc94d3a,
    CONCRETE: 0x6e7682,
    CRATE: 0xb07a3c,
    CRATE_D: 0x8a5e2b,
    GRASS_A: "#57b257",
    GRASS_B: "#4aa14a",
    ASPHALT_A: "#5b626c",
    ASPHALT_B: "#535a64",
    METAL: 0x8b95a1,
    METAL_D: 0x5b6470,
    GLOW: 0x39ff88,
    GLOW_E: 0x14c258,
    KEY: 0x39ffd0,
    KEY_E: 0x12b89a,
    COIN: 0xffd451,
    COIN_E: 0x6b4d00,
  };

  // ---- world dimensions ----
  CBZ.DIM = {
    WH: 9,    // cell-block wall height
    YH: 11,   // yard wall height
  };

  // ---- world extents -------------------------------------------------
  // The compound is now MUCH larger: the original north exercise yard is
  // untouched, but the prison extends far south into a wider "South Block"
  // (workshops, chapel, infirmary, lower yard, sally port) and the freedom
  // gate sits at the far south end. Every coordinate-coupled module
  // (perimeter walls, towers, searchlights, razorwire, the actor clamp,
  // the minimap, the AI escape target) reads these so the size stays
  // consistent in one place.
  CBZ.WORLD = {
    cellBlock:  { x0: -16, x1: 16, z0: -44, z1: -8 },
    // ADMINISTRATION — north of the wing, the other side of the staff door at
    // the head of the tier (world/cellblock.js's CBZ.cellblockStaffGap).
    // The warden works here; the compound's own perimeter wraps it, so
    // getting in is a break-in and getting OUT of it is still the long walk
    // south to the gate. world/adminwing.js builds it.
    adminWing:  { x0: -20, x1: 20, z0: -64, z1: -44 },
    northYard:  { x0: -30, x1: 30, z0: -8,  z1: 52 },   // original yard (kept intact)
    southBlock: { x0: -44, x1: 44, z0: 52,  z1: 128 },  // new, wider lower complex
    exit: { x: 0, z: 128, gap: 4 },                     // freedom gate at the far south
    // THE OUTER COMPOUND (world/prisonwings.js). Owner 2026-08-11: "the prison
    // should be bigger — think of scale of human vs prison size." Measured, the
    // rects above enclose 92 x 195 m (1.79 ha): fifty body-lengths across, when
    // a real medium-security perimeter runs 300-400 m a side. This rect is the
    // new wire, and NOTHING above it moved to make room — the wings grow AROUND
    // the authored compound (the held-corner discipline world/layout.js's
    // stage-5 desert states), so every spawn, route, waypoint and anchor in the
    // old prison is byte-identical and what was the yard's boundary wall is now
    // an internal division fence with four gates cut in it.
    //   92 x 195 (1.79 ha)  ->  248 x 244 (6.05 ha)
    // PRISON_WINGS_V1 = false -> prisonwings.js draws nothing, yard.js closes
    // its gaps, and the clamp below falls back to the inner extents.
    wings: { x0: -124, x1: 124, z0: -116, z1: 128 },
    // overall extents used by the actor clamp + minimap (a touch of margin).
    // They frame the OUTER wire now: the minimap, the full map, the strategic
    // overview, systems/navigation.js and entities/ambientstate.js's density
    // grid all read these, so a compound that is three times the size has to
    // say so here or half of it is off every map in the game.
    minX: -126, maxX: 126, minZ: -118, maxZ: 131,
  };

  // ---- NPC ratings (CAPABILITY) — what an inmate is *good at*, 0..100.
  CBZ.RATING_KEYS = ["fighting", "toughness", "speed", "stealth", "marksman", "cunning"];
  CBZ.RATING_LABELS = {
    fighting: "Fighting", toughness: "Toughness", speed: "Speed",
    stealth: "Stealth", marksman: "Marksman", cunning: "Cunning",
  };

  // ---- NPC behaviours (TEMPERAMENT) — how they *choose to act*, which is
  // deliberately DECOUPLED from capability. A 95-rated fighter can be a
  // "Defensive" who never starts anything (but flattens whoever does),
  // while a 30-rated nobody can be a "Hothead" who swings at everyone.
  //   init      base chance to start a fight when a foe is in reach
  //   retaliate chance to stand and fight (vs flee) when attacked
  //   fleeHurt  willingness to bolt once badly hurt
  //   picksWeak preference for only fighting weaker targets (0..1)
  //   guts      general boldness, used for flavour/sorting
  CBZ.BEHAVIORS = {
    pacifist:     { label: "Pacifist",    emoji: "", init: 0.00, retaliate: 0.05, fleeHurt: 0.92, picksWeak: 0.0, guts: 0.08, desc: "Won't throw a punch, runs from any trouble." },
    defensive:    { label: "Defensive",   emoji: "", init: 0.02, retaliate: 0.97, fleeHurt: 0.20, picksWeak: 0.0, guts: 0.70, desc: "Never starts it, but finishes whoever does." },
    protector:    { label: "Protector",   emoji: "", init: 0.07, retaliate: 0.95, fleeHurt: 0.12, picksWeak: 0.0, guts: 0.85, desc: "Wades in to defend friends and underdogs." },
    opportunist:  { label: "Opportunist", emoji: "", init: 0.12, retaliate: 0.62, fleeHurt: 0.55, picksWeak: 0.95, guts: 0.40, desc: "Only swings when the fight's already won." },
    hothead:      { label: "Hothead",     emoji: "", init: 0.30, retaliate: 0.92, fleeHurt: 0.18, picksWeak: 0.15, guts: 0.78, desc: "Quick to rage, slow to think it through." },
    bully:        { label: "Bully",       emoji: "", init: 0.24, retaliate: 0.55, fleeHurt: 0.60, picksWeak: 1.0, guts: 0.45, desc: "Hunts the weak, folds against the strong." },
    predator:     { label: "Predator",    emoji: "", init: 0.42, retaliate: 0.97, fleeHurt: 0.05, picksWeak: 0.55, guts: 0.96, desc: "Looks for a fight and rarely backs down." },
    unpredictable:{ label: "Wildcard",    emoji: "", init: 0.18, retaliate: 0.60, fleeHurt: 0.40, picksWeak: 0.30, guts: 0.50, desc: "Nobody, including them, knows what's next." },
  };
  CBZ.BEHAVIOR_KEYS = Object.keys(CBZ.BEHAVIORS);

  // ---- UI buses (owned by their systems) ----
  CBZ.ui = { dashboard: false };

  // ---- key positions ----
  CBZ.SPAWN = null;  // THREE.Vector3, set once THREE is up (entities/player.js)
  CBZ.EXIT = null;   // THREE.Vector3 (world/exit.js)

  // ---- physical scale contract ------------------------------------------
  // World units are metres. The authored voxel rig was ~2.60 units tall;
  // render it at 70% so an average adult is ~1.82m and size every dependent
  // interaction from that same fact instead of compensating with giant doors.
  CBZ.HUMAN_SCALE = 0.70;

  // ---- player tuning ----
  CBZ.TUNE = {
    walkSpeed: 2.0,     // brisk adult walk; SHIFT multiplies this to a 6.4m/s sprint
    crouchSpeed: 1.2,
    jumpVel: 6.5,       // ~0.96m ballistic apex at gravity=22
    gravity: 22,
    playerRadius: 0.38,
    camDist: 6.5,
    sens: 0.0024,
  };

  // ---- SURVIVAL mode tuning -----------------------------------------
  // Total lobby = SURV_BOTS bots + you. 99 → "100 alive" like Fortnite.
  // Lower it (e.g. 49) if the framerate suffers on weaker hardware.
  CBZ.SURV_BOTS = 99;
  // Prison population tiers. Named inmates always use the full social/combat
  // brain. JAIL_CROWD adds extra rich rigs; MASS_CROWD adds cheap instanced
  // ambient agents that still move, separate, and react locally.
  // MASS_CROWD was 900, which read as a wall-to-wall mosh pit across the yard
  // zones (the owner's "way too crowded" report). 140 is a packed-but-navigable
  // yard: roughly 1 body per ~30m² across the ~4600m² of yard zones, layered
  // on top of the ~54 named/procedural rigs + 11 guards. Raise it live via the
  // Settings panel "Total Population" slider, or set CBZ_POP_OVERRIDE_V1 in
  // localStorage (applied by index.html's pre-config shim before this file runs).
  // 140 IS NO LONGER THE ANSWER — IT IS THE FALLBACK. The prison's population
  // is now derived from what the building can sleep (world/cellblock.js's
  // prisonBeds -> entities/ambientstate.js), because a typed headcount could
  // never see that the wing has twenty-five cells. This number is only reached
  // when there is no wing at all. MASS_CROWD_EXPLICIT records that a HUMAN set
  // the count before us — the Settings "Total Population" slider or the
  // localStorage override index.html applies above — and that always wins over
  // the derivation, because an owner overruling it is a decision, not a drift.
  CBZ.JAIL_CROWD_EXPLICIT = typeof CBZ.JAIL_CROWD === "number";
  CBZ.JAIL_CROWD = CBZ.JAIL_CROWD_EXPLICIT ? CBZ.JAIL_CROWD : 14;
  CBZ.MASS_CROWD_EXPLICIT = typeof CBZ.MASS_CROWD === "number";
  CBZ.MASS_CROWD = CBZ.MASS_CROWD_EXPLICIT ? CBZ.MASS_CROWD : 140;
  // Production uses compact GPU points. Set window.CBZ.AB_TEST="A" before
  // load, or press P in overview, only when benchmarking legacy box markers.
  CBZ.AB_TEST = CBZ.AB_TEST === "A" ? "A" : "B";
  CBZ.CROWD_RIG_CAP = typeof CBZ.CROWD_RIG_CAP === "number" ? CBZ.CROWD_RIG_CAP : 1600;
  // Face-rig promotion: how many nearby agents wear a full generated face and
  // from how far they start "generating" (the closest N within range get a rig
  // each frame). No numeric default is stamped here any more — the default
  // budget/range now ride the LIVE quality tier (CBZ.qScale) inside
  // entities/crowd.js. A pre-load window.CBZ.CROWD_FACE_RIGS / _DIST
  // override still wins over the tier-scaled default.
  if (typeof CBZ.CROWD_FACE_RIGS !== "number") CBZ.CROWD_FACE_RIGS = undefined;
  if (typeof CBZ.CROWD_FACE_DIST !== "number") CBZ.CROWD_FACE_DIST = undefined;
  CBZ.SIM_OVERVIEW_BUDGET = typeof CBZ.SIM_OVERVIEW_BUDGET === "number" ? CBZ.SIM_OVERVIEW_BUDGET : 12000;
  CBZ.SURV = {
    arena: { cx: 0, cz: 600, radius: 120 }, // far from the prison; own ground+sun
    playerHpRegen: 0,        // no passive regen — disasters are deadly
    sprintMul: 3.2,
    staminaMax: 100,
    staminaDrain: 24,        // per second while sprinting
    staminaRegen: 14,        // per second while not
  };
  // Environment modifier written by active disasters, applied by the
  // survival lighting override (so eruptions/blizzards/nukes recolour the
  // whole world). Reset to these neutral values each frame before disasters.
  CBZ.survEnv = {
    fog: 0xbfe0ff, fogNear: 70, fogFar: 360,
    sunInt: 1.08, sunColor: 0xfff4e0,
    hemiInt: 0.95, hemiColor: 0xeaf4ff,
    flash: 0, flashColor: 0xffffff,   // 0..1 additive white-out (nuke/lightning)
  };

  // ---- CITY mode tuning --------------------------------------------
  // An open-world block built FAR from the prison/island so all three
  // worlds coexist (escape z≈0, survival z≈600, city z≈-700). Population
  // and difficulty knobs live here; lower CITY_PEDS/CITY_COPS on weak HW.
  CBZ.CITY = {
    center: { x: 0, z: -700 },
    // Player start/return location. The airport builder publishes the exact
    // safe apron anchor; city/mode.js resolves this symbolic choice after the
    // whole archipelago exists, so these coordinates never drift apart.
    //
    // "story" (default) — the chosen ORIGIN owns the opening. city/origins.js
    //   places you: the exec on his floor, the pilot already airborne, the
    //   debtor outside the motel. This is the front door of the game and it
    //   should be what a new player meets.
    // "airport" — OVERRIDE. Ignores the origin's placement entirely and puts
    //   every character on the Halloran Field apron instead. It was useful for
    //   working on the airfield, and it is exactly what was hiding the nine
    //   stories: mode.js gates on `playerSpawn !== "airport"`, so any other
    //   value turns the override off and the origin runs.
    // The switch is kept, not deleted — flip this back to "airport" whenever
    // the airport itself needs iterating on.
    playerSpawn: "story",
    blocks: 6,             // 6×6 grid of city blocks (room for shops + homes + turf)
    block: 34,             // block size (building lot)
    road: 18,              // four 3.6m lanes + 1.8m curb/clear zone per side
    // Full per-rig peds are ~16 draw calls EACH — the single biggest GPU cost in
    // the city. The instanced ambient crowd (city/crowd.js, ~6 draw calls for
    // hundreds of bodies) carries street DENSITY, and walking up promotes nearby
    // ambient agents into real rigs on demand. So we keep the expensive rig pool
    // lean and let the cheap crowd fill the streets. Adaptive quality (core/
    // quality.js) trims this further on weak GPUs via CBZ.cityRigBudget.
    peds: typeof CBZ.CITY_PEDS === "number" ? CBZ.CITY_PEDS : 100,
    // the instanced ambient mass (city/crowd.js) — where the population head-
    // room lives: ~6 extra draw calls total no matter how big this gets. The
    // crowd tick is tiered by camera distance (near every frame, far every
    // 16th with dead-reckoning between), so 700 costs about what 300 used to.
    crowd: typeof CBZ.CITY_CROWD === "number" ? CBZ.CITY_CROWD : 700,
    cops: typeof CBZ.CITY_COPS === "number" ? CBZ.CITY_COPS : 0, // spawn on wanted
    ambientCops: typeof CBZ.CITY_AMBIENT_COPS === "number" ? CBZ.CITY_AMBIENT_COPS : 3, // patrols policing NPCs/traffic at 0 stars
    traffic: typeof CBZ.CITY_TRAFFIC === "number" ? CBZ.CITY_TRAFFIC : 66,
    hungerDrain: 0.22,     // hunger lost per second (slow — the real pressure is night/sleep, not starving)
    starveDmg: 2.2,        // hp/s once hunger hits 0
    tireNight: 1.15,       // tiredness/s gained while up & about at deep night
    tireRest: 5.0,         // tiredness/s recovered while resting (sleeping)
    tireExhaustDmg: 1.4,   // hp/s once you're fully exhausted and still awake
    sprintMul: 3.2,
    staminaMax: 100, staminaDrain: 22, staminaRegen: 14,
    // wanted: heat needed to reach each star, and the cop response per star.
    // The top is a CLIFF: 4★ already costs a sustained rampage, and 4→5 is an
    // enormous wall (3200 → 12000) so a real 5★ is rare and brutally earned.
    // Low tiers stay lively (petty crime still reaches 1-2★ promptly).
    starHeat: [0, 300, 650, 1100, 3200, 12000],
    heatDecay: 3.5,        // heat bled off per second when unseen

    // ---- world composition: every lot is one of these (buildings.js) -------
    // Bumped 0.06→0.36 for the 13-gang roster: turf is round-robin in gangs.js
    // (aband.forEach((lot,i)=>gangs[i%gangs.length].turf.push(lot))), so EVERY
    // crew needs ≥1 abandoned lot to be VISIBLE. The grid is only 6×6 = 36 lots
    // (one building per block, not subdivided), so 13 gangs need ~13 derelicts;
    // park (0.08) eats a few first, hence ~0.36. gangs.js also now backstops this
    // (ensureEveryGangHasTurf) so even a low roll never strands a crew off-map.
    abandonedFrac: 0.36,   // share of buildable lots that are derelict + gang-run (~13 of 36 lots → one per crew on the 13-gang roster).
    parkFrac: 0.08,        // share kept as open plazas (breathing room / hangouts)

    // ---- DISTRICTS: the city's population FIELD (world.js stamps lots) -----
    // WHY: pacing. Busy streets mean witnesses, marks, foot traffic and cops —
    // loud money. Quiet streets mean deals, body dumps and ambushes — dark
    // money. "Where should I do this crime" only becomes a DECISION if places
    // differ, so each 2×2-lot quadrant of the 6×6 grid gets a personality.
    // Same 3×3 carve + NAMES as turf.js zones (q = dj*3 + di) so the takeover
    // map and the population field describe the same neighbourhoods.
    //   kind    core (packed strip) | commercial | residential | industrial | projects
    //   pop     ped + ambient-crowd density weight — REDISTRIBUTES a fixed
    //           total (perf: never adds bodies). Downtown is still the
    //           busiest, but only ~2× the docks: with ~1000 alive the WHOLE
    //           city has to read inhabited — the old 4× spread packed three
    //           sidewalks and left the rest of the map dead.
    //   cops    beat-patrol weight: police presence follows the money
    //   wealth  mean street wealth (casting: who walks here, what they carry)
    districts: [
      { q: 0, name: "Northpoint", kind: "residential", pop: 1.3, cops: 0.9,  wealth: 0.45 },
      { q: 1, name: "Crownhill",  kind: "residential", pop: 1.3, cops: 1.2,  wealth: 0.68 },
      { q: 2, name: "Eastgate",   kind: "commercial",  pop: 1.6, cops: 1.3,  wealth: 0.55 },
      { q: 3, name: "Westend",    kind: "commercial",  pop: 1.7, cops: 1.3,  wealth: 0.52 },
      { q: 4, name: "Midtown",    kind: "core",        pop: 2.2, cops: 2.6,  wealth: 0.78 },
      { q: 5, name: "Harborside", kind: "commercial",  pop: 1.5, cops: 1.1,  wealth: 0.58 },
      { q: 6, name: "Southside",  kind: "projects",    pop: 1.1, cops: 0.5,  wealth: 0.16 },
      { q: 7, name: "Ironworks",  kind: "industrial",  pop: 1.0, cops: 0.5,  wealth: 0.34 },
      { q: 8, name: "Dockyard",   kind: "industrial",  pop: 1.05, cops: 0.45, wealth: 0.30 },
    ],
    // homeless population cast into the projects pocket + industrial fringe
    // (carved OUT of the ped total, never added on top — perf stays flat)
    vagrants: 8,

    // ---- gangs: factions that own the abandoned blocks (city/gangs.js) -----
    gangs: [
      // Real gangs only, real colors, and the authentic People/Folk NATION split
      // (Bloods, Latin Kings, Black P. Stones ride PEOPLE; Crips + Gangster
      // Disciples ride FOLK) — turf.js seeds alliances off `nation`. ids kept
      // stable where they were; names/colors/nation are what the game uses.
      //
      // `type` is the faction ARCHETYPE (gangs.js GANG_TYPES drives how each one
      // spawns + fights so they play DIFFERENTLY — armed fraction, weapon tier,
      // crew size, HP/aggression, melee-vs-guns, and how hard it defends turf):
      //   street   — balanced corner crew, pistols/SMGs, turf-focused (the default)
      //   cartel   — rich + heavily armed, rifles, drug-economy heavy, expansionist
      //   syndicate— few but heavily-armed high-value earners, protection rackets,
      //              defends/retaliates hardest
      //   set      — scrappy big bench, lighter weapons, more bodies than guns
      //   brawlers — a melee mob: machetes/bats over guns, tanky, roams + brawls
      { id: "saints",    name: "Bloods",             color: 0xc0392b, accent: 0x6e1c1c, nation: "people",  ethnicity: "black",  type: "street"    }, // red
      { id: "reapers",   name: "Crips",              color: 0x2f6bd6, accent: 0x1a3a6e, nation: "folk",    ethnicity: "black",  type: "street"    }, // blue
      { id: "kings",     name: "Latin Kings",        color: 0xe0b020, accent: 0x6e5210, nation: "people",  ethnicity: "latino", type: "cartel"    }, // gold
      { id: "stones",    name: "Black P. Stones",    color: 0x2f9e4f, accent: 0x123d22, nation: "people",  ethnicity: "black",  type: "set"       }, // green
      { id: "disciples", name: "Gangster Disciples", color: 0x3a4150, accent: 0x141820, nation: "folk",    ethnicity: "black",  type: "syndicate" }, // charcoal
      { id: "vipers",    name: "Trinitarios",        color: 0x16a8a0, accent: 0x0c3b39, nation: "neutral", ethnicity: "latino", type: "brawlers"  }, // teal (Dominican, machete crew)
      // ---- 2nd wave: the underworld's four tiers filled out (street / cartel /
      //      mafia / biker+prison). NATION drives turf.js alliances:
      //        people  → Bloods, Latin Kings, Black P. Stones, + Vice Lords (PEOPLE bloc)
      //        folk    → Crips, Gangster Disciples, + Sureños (FOLK bloc)
      //        nortenos→ Norteños ride their OWN Norte bloc, sworn enemies of the Sur/Folk
      //        neutral → Sinaloa Cartel, La Cosa Nostra, Iron Saints MC, Trinitarios
      //                  (organized crime — they deal with everyone, ally no bloc)
      //        brand   → Aryan Brotherhood rides its OWN bloc → allies with NOBODY
      //      ORGANIZED-crime crews lean SMALL-BENCH (cartel/syndicate crewMul<1.1) for perf.
      { id: "lords",     name: "Vice Lords",         color: 0xdaa520, accent: 0x141414, nation: "people",   ethnicity: "black",  type: "set"       }, // gold/black (People — distinct deeper goldenrod vs Kings' brighter gold)
      { id: "surenos",   name: "Sureños 13",         color: 0x1d3f8f, accent: 0x0c1d44, nation: "folk",     ethnicity: "latino", type: "street"    }, // navy (Sur/Folk)
      { id: "nortenos",  name: "Norteños 14",        color: 0xa62128, accent: 0x4d1013, nation: "nortenos", ethnicity: "latino", type: "street"    }, // deep red (own Norte bloc — arch-rival of Sureños; darker than Bloods' brighter red)
      { id: "cartel",    name: "Sinaloa Cartel",     color: 0xc8a060, accent: 0x6b5026, nation: "neutral",  ethnicity: "latino", type: "cartel",    supplier: true }, // desert tan — the wholesale product SUPPLIER
      { id: "cosa",      name: "La Cosa Nostra",     color: 0x7a2233, accent: 0x2a1016, nation: "neutral",  ethnicity: "mixed",  type: "syndicate", extortsBiz: true }, // wine/charcoal — protection + laundering, business district
      { id: "angels",    name: "Iron Saints MC",     color: 0x5a6068, accent: 0xd2691e, nation: "neutral",  ethnicity: "mixed",  type: "brawlers"  }, // gunmetal w/ orange accent — bikers, highways/industrial
      { id: "brand",     name: "Aryan Brotherhood",  color: 0xcfc6b0, accent: 0x4a463c, nation: "brand",    ethnicity: "white",  type: "syndicate" }, // bone/ash — prison-power, OWN nation → hostile to all
    ],
    gangPerTurf: [2, 4],   // members spawned to hold each controlled building
    gangArmedFrac: 0.55,   // share of gang members packing a firearm

    // ---- personality: ONE spectrum drives every NPC (0 meek .. 1 violent) --
    // The ped brain (city/peds.js) reads a single `aggr` scalar and switches
    // behaviour at these band edges. A maxed-out NPC has full agency: it mugs,
    // brawls, carjacks, fights cops, snatches a downed cop's gun, and racks up
    // its OWN wanted level (police.js hunts NPC offenders, not just you).
    aggro: {
      flee: 0.30,          // below: flees crime, never throws a punch
      bold: 0.50,          // stands its ground / films, fights only if attacked
      crook: 0.72,         // starts petty crime (mug/shove), grabs dropped guns
      violent: 0.88,       // attacks cops, carjacks, steals cop guns, rampages
      meanCivilian: 0.24,  // average civilian on the spectrum
      spreadCivilian: 0.20,// civilian spread around the mean
      meanGang: 0.80,      // gang members ride high on the spectrum
      spreadGang: 0.14,
    },

    // ---- traffic realism (city/vehicles.js + city/traffic.js) -------------
    traf: {
      lane: 3.6,           // lane-centre offset from a road's centre line (metric US lane width)
      lanesPerDir: 2,      // lanes per direction (road system derives lane centers from this + laneW)
      laneW: 3.6,          // metric lane width (m)
      follow: 8.0,         // car-following gap (m) kept behind the car ahead
      cruise: [11, 17],    // calm cruising speed window (city pace, not a crawl)
      aggrSpeedMul: 1.45,  // how much faster aggressive drivers push it
      stopGap: 6.5,        // how far out a calm driver brakes for a red
      recklessFrac: 0.18,  // share of ambient drivers who drive aggressively
      pulloverHeat: 18,    // NPC-offense heat a moving violation earns the driver
    },

    // ---- economy realism (city/economy.js + city/careers.js) --------------
    econ: {
      startCash: 30,       // you start nearly broke
      bankRate: 0.0025,    // interest per second on banked cash (compounds slow)
      payTick: 6,          // seconds between wage / passive-income payouts
      securityWage: 14,    // legit security-guard pay per tick (stay clean)
      workerCut: 7,        // passive income per recruited worker per tick
      drugDrift: 0.05,     // street drug price mean-reversion toward fair / sec
      drugFlood: 0.14,     // price haircut per unit you dump in one district
      bribeBase: 150,      // base cost to bribe down a single wanted star
      chopStolen: 0.42,    // fraction of a STOLEN car's value a chop shop pays
      chopOwned: 0.85,     // fraction an OWNED car fetches (legit resale)
      chopHeat: 14,        // NPC/your heat for chopping a hot car if seen
    },

    // ---- real estate: the property LADDER, by SQUARE FOOTAGE (realestate.js) -
    // It's ONE guy — nobody needs five bedrooms, they need SPACE. So the ladder
    // isn't "more rooms," it's "more sqft / a bigger, more open place," and it's
    // deliberately SHORT: a handful of clearly-DIFFERENT levels, not a hundred
    // near-identical listings. Each level is a real, VISITABLE building in the
    // world (see buildings.js: one lot per level, tagged home.listed) — you can
    // tour it from Zillow, buy it, and spawn there. The top level, The Spire, is
    // the TALLEST building in the city: a full ground-floor wraparound parking
    // garage, glass on every wall, and one impossible loft filling the tower.
    // Owned homes are safehouses: heal, save, a money-safe stash, and a garage
    // that stores cars. Rent (room) + property tax (owned) are the money sinks.
    homes: [
      { id: "room",      name: "Rented Room",        rent: 30, price: 0,      sqft: 180,   garage: 0, tier: 0, blurb: "A bed and a door that locks. Somewhere to respawn." },
      { id: "studio",    name: "The Studio",         rent: 0,  price: 2500,   sqft: 450,   garage: 0, tier: 1, blurb: "One room, one window, everything in reach. A real start." },
      { id: "flat",      name: "Open-Plan Flat",     rent: 0,  price: 12000,  sqft: 950,   garage: 1, tier: 2, blurb: "Room to breathe and a single bay for the car." },
      { id: "loft",      name: "Warehouse Loft",     rent: 0,  price: 32000,  sqft: 2200,  garage: 2, tier: 3, blurb: "High ceilings, raw concrete, your whole life in one big open space." },
      { id: "sky",       name: "Skyline Aerie",      rent: 0,  price: 80000,  sqft: 4200,  garage: 3, tier: 4, blurb: "A glass perch over downtown, the city laid out below you." },
      { id: "spire",     name: "The Spire",          rent: 0,  price: 180000, sqft: 11000, garage: 6, tier: 5, elevator: true, blurb: "A tower yours top to bottom: a wraparound parking deck on the ground, glass on every wall, and one colossal loft filling the sky." },
      // ---- TASK 1: the apex home. The mega-tower PENTHOUSE — the most expensive,
      // flagship address in the city. It isn't just a place to sleep: a missile
      // HELICOPTER comes parked on its rooftop HELIPAD (free with the home), and a
      // deck HANGAR can be bought to base an F-22 Raptor (Phase 3). buildings.js
      // builds the mega-tower and tags this exact tier (id "penthouse", the one
      // flagship) onto lot.building.home; realestate.js + zillow.js sell it and
      // set g.cityOwnsPenthouse / g.cityOwnsHeli on the buy. The hangar is a
      // separate big-ticket add-on (priced below; charged in realestate.js).
      { id: "penthouse", name: "The Apex Penthouse", rent: 0,  price: 750000, sqft: 24000, garage: 8, tier: 6, elevator: true, flagship: true, helipad: true, hangarPrice: 1200000, blurb: "The crown of the skyline: the city's tallest mega-tower, yours alone. A wraparound sky-deck garage, a glass loft that floats above downtown, and your own rooftop HELIPAD, a missile helicopter parked and ready. Buy the deck HANGAR to base a fighter jet." },
    ],
    rentTick: 90,          // seconds between rent / property-tax charges
    taxRate: 0.0008,       // owned-home tax per tick as a fraction of its price

    // ---- DRIP & the exclusive CLUB (city/economy.js + city/club.js) -------
    // The wealth→clothes→DRIP→club chain. DRIP is your visible STATUS, summed
    // from the EQUIPPED outfit (CBZ.cityPlayerDrip). The club's bouncer reads it:
    //   < CLUB_DRIP  → turned away at the rope (most NPCs in the line, and a
    //                  broke player in street rags, fall here — that's the point)
    //   >= CLUB_DRIP → you're let in
    //   >= VIP_DRIP  → VIP tier (perks)
    // Tuned against economy.js's wearable drip values so:
    //   • a broke player (no fit / a few cheap streetwear pieces, total drip ~0-12)
    //     is well UNDER CLUB_DRIP and gets rejected;
    //   • a full MID-DESIGNER fit (bomber 6 + silk 6 + designer jeans 5 + loafers 6
    //     + shades 5 + gold chain 7 ≈ 35) CLEARS CLUB_DRIP;
    //   • only a LUXURY fit (tailored suit 18 + iced chain 22 + iced watch 24 +
    //     diamond pinky 20 … ≈ 70+) reaches VIP_DRIP.
    BASE_DRIP: 4,          // everyone has a sliver of baseline presence (added in cityPlayerDrip)
    CLUB_DRIP: 30,         // bouncer's minimum drip to clear the rope
    VIP_DRIP: 70,          // elite tier — perks inside

    // ---- relationships & family (city/social.js) --------------------------
    social: {
      dateCost: 50,        // a date / gift to build affection
      affectionPerDate: 22,// affection gained per successful date
      partnerAt: 60,       // affection needed before someone is your partner
      marryRing: "Diamond Ring", // the wearable that proposes
      kidnapChance: 0.0,   // set live by social.js when you're hot near a gang
    },
  };

  // ---- CBZ.roadLanes(r): the ONE lane-geometry contract -----------------------
  // Every consumer (traffic lane-keeping, prop placement, world-audit) reads a
  // road's REAL cross-section through this helper instead of assuming the city-
  // grid default. Per-road fields (stamped at registration: r.w / r.lanesPerDir
  // / r.laneW / r.median / r.medianW) win; missing fields fall back to the
  // global traffic contract. Lane centres match vehicles.js's historical
  // laneOffset() exactly when a road carries no per-road data (safe superset):
  //   with a median: dir * (medianHalf + (idx+0.5)*laneW)
  //   without:       dir * ((idx+0.5)*laneW)
  CBZ.roadLanes = function (r) {
    const traf = (CBZ.CITY && CBZ.CITY.traf) || {};
    r = r || {};
    const lanesPerDir = (r.lanesPerDir != null ? r.lanesPerDir : (traf.lanesPerDir != null ? traf.lanesPerDir : 2)) | 0;
    const laneW = r.laneW != null ? r.laneW : (traf.laneW != null ? traf.laneW : 3.6);
    const median = !!r.median;
    const medianHalf = median ? (r.medianW != null ? r.medianW : 1.2) / 2 : 0;
    const width = r.w != null ? r.w : (CBZ.CITY && CBZ.CITY.road != null ? CBZ.CITY.road : 18);
    // signed lane-centre offsets from the road centreline, inner→outer per side
    const offsets = [];
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < lanesPerDir; i++) offsets.push(s * (medianHalf + (i + 0.5) * laneW));
    }
    return { lanesPerDir, laneW, width, median, medianHalf, offsets };
  };

  // ---- CBZ.roadLaneCenter(r, dir, idx) / CBZ.roadLanesPerDir(r) ----------------
  // Convenience wrappers over roadLanes() for the NPC-car lane-keepers. Every
  // driver system (vehicles/traffic/police/armored/gigfleet) historically owned
  // an identical `laneOffset(dir,idx)=dir*laneW*(idx+0.5)` closure that read only
  // the GLOBAL 2-lane traffic contract — so cars hugged the centreline on 3+3
  // highways and kissed the median. These read the road's REAL cross-section:
  //   center = dir * (medianHalf + (idx+0.5)*laneW)   [idx 0 = innermost lane]
  // and fall back to the global contract for roads with no per-road data (that
  // fallback lives inside roadLanes()). Lane-TARGET geometry only — physics and
  // collision are untouched.
  CBZ.roadLaneCenter = function (r, dir, idx) {
    const L = CBZ.roadLanes(r);
    const per = Math.max(1, L.lanesPerDir | 0);
    const i = Math.min(Math.max((idx | 0), 0), per - 1);
    return (dir < 0 ? -1 : 1) * (L.medianHalf + (i + 0.5) * L.laneW);
  };
  CBZ.roadLanesPerDir = function (r) { return Math.max(1, CBZ.roadLanes(r).lanesPerDir | 0); };

  // ---- CBZ.charHeadY(ch): overhead-marker height above a character ------------
  // After HUMAN_SCALE=0.70 an adult rig stands ~1.82m (metric.height), so any
  // sprite/tag/marker parented to the UNSCALED character group belongs at
  // ~head + a small margin (~1.97), NOT the legacy 3.0–3.85 that suited the old
  // 2.60u rig. Reads the per-character metric stamped by character.js when
  // present so fem/scaled bodies get the right height; falls back to the global
  // HUMAN_SCALE. Matches the peds.js/police.js nametags (already 1.97).
  CBZ.charHeadY = function (ch) {
    const g = ch && (ch.group || ch);
    const m = g && g.userData && g.userData.characterMetric;
    const hs = (CBZ.HUMAN_SCALE > 0) ? CBZ.HUMAN_SCALE : 0.70;
    const h = (m && m.height > 0) ? m.height : (2.60 * hs);
    return h + 0.15;
  };

  // ---- feature switches (CBZ.CONFIG) ------------------------------------------
  // Reversible behaviour flags read across the city build. Kept distinct from
  // CBZ.CITY's tuning numbers: these flip whole rendering/identity behaviours on
  // or off, so a single line here reverts a system to its old look.
  CBZ.CONFIG = CBZ.CONFIG || {};
  // URL override for any CONFIG flag — ?cfg_BATCH_V2=0 / ?cfg_LOS_GRID=1 —
  // applied FIRST so it wins over every `== null` default below and in the
  // module files. Headless A/B harnesses depend on this (a same-page reset
  // can't re-run one-shot build passes, so flags must be set before boot).
  try {
    if (typeof location !== "undefined" && location.search) {
      const sp = new URLSearchParams(location.search);
      sp.forEach(function (v, k) {
        if (k.slice(0, 4) !== "cfg_") return;
        CBZ.CONFIG[k.slice(4)] = v === "0" || v === "false" ? false : v === "1" || v === "true" ? true : v;
      });
    }
  } catch (e) {}
  // ---- PERF LEVERS (owner-facing, feel-testable via URL) ----------------------
  // Round-3 teardown (tools/perf-ab/LOG.md) named the three biggest costs and
  // gave each its own reversible switch so the owner can flip it and PLAY the
  // A/B. All default to today's behaviour (byte-identical off).
  //
  // CITY_SHADOW_MODE: "auto" (tier decides, = today) | "off" (no sun shadow at
  // any tier) | "low" (cap the sun map at 1024) | "high" (force 2048). Applied in
  // core/quality.js:applyQuality so it composes with the tier without dropping it.
  // Shadows are the #2 GPU cost; this isolates them. URL: ?cfg_CITY_SHADOW_MODE=off
  if (CBZ.CONFIG.CITY_SHADOW_MODE == null) CBZ.CONFIG.CITY_SHADOW_MODE = "auto";
  /* RENDER_FRAMES — the TOOL switch, not a player one. false (?cfg_RENDER_FRAMES=0)
     runs the whole game with no draw call at all: core/loop.js skips its single
     renderer.render, and core/fxwarm.js skips the play-start program prewarm
     that only exists to pay for drawing.

     WHY IT IS HERE. Measured with tools/boot-trace.mjs, which beacons every
     boot checkpoint from inside the frozen main thread: Gang City's CPU build
     is ~32 s and finishes cleanly. What makes the mode untestable headless is
     everything AFTER the build — the first frames, where three.js compiles a
     program per material the first time it is drawn, on a software rasterizer,
     across a 25 km scene. Prison Escape builds in ~1 s and draws at ~3 fps on
     the same box, which is why every gate that targets those modes works and
     the Gang City ones time out. This flag deletes that asymmetry for any
     tool that asserts on world STATE rather than pixels; drive time with
     CBZ.stepSim(dt) and take a picture, if you need one, with
     CBZ.renderFrame(). Never ship it on: with no frames there is no game. */
  if (CBZ.CONFIG.RENDER_FRAMES == null) CBZ.CONFIG.RENDER_FRAMES = true;
  // LOCAL_INSTANCING: per-chunk InstancedMesh pooling of repeated static props in
  // the block around the player (the ~99%-of-draw-calls bottleneck). This is the
  // biggest lever but also the one prior rounds REGRESSED on (batch.js already
  // merges statics — a naive second pass double-processed them). Gated off and
  // built census-first so it targets only geometry batch.js leaves individual.
  // URL: ?cfg_LOCAL_INSTANCING=0 to revert. Default ON 2026-08-03 after the
  // pixel-parity pass (artifacts/visual-comparisons/localinst-parity2 + the
  // OFF-vs-OFF noise control) on top of ROUND 3b's measured −30% draw calls.
  if (CBZ.CONFIG.LOCAL_INSTANCING == null) CBZ.CONFIG.LOCAL_INSTANCING = true;
  // WORLD ENLARGE V2 (map-enlargement stage 2): non-zero world-layout offsets
  // spread every biome/island/nation radially outward from the mainland and
  // grow the FLAT terrain contract + continent margin to match. The flag is
  // READ (and self-defaulted, plus URL-sniffed) in world/layout.js because
  // that file parses before this one; the line below only documents the
  // default for the one-line revert: false = the stage-1 compact world.
  if (CBZ.CONFIG.WORLD_ENLARGE_V2 == null) CBZ.CONFIG.WORLD_ENLARGE_V2 = true;
  // ROADS OVERHAUL V2: real lane proportions (highways 3+3 with a hard median,
  // island/side streets widened to fit two cars), markings gapped at every
  // intersection (no centreline running through junction boxes), per-road
  // width stamped on road records + CBZ.roadLanes() lane-centre data.
  if (CBZ.CONFIG.ROADS_V2 == null) CBZ.CONFIG.ROADS_V2 = true;
  // ROAD MARKINGS V1: biome TOWN streets (city/towngen.js) get a yellow
  // centreline (dashed on ordinary 2-way lanes, solid on multi-lane), white
  // dashed lane dividers + curb edge lines, and continental (zebra) crosswalks
  // at every intersection — reference technique #1 (per-segment decal quads),
  // ALL folded into ONE vertex-coloured mesh per town (+1 draw call, batch-exempt
  // like world.js / highways.js road paint). Deterministic: positional math +
  // CBZ.hash01 paint wear, never rng() (the mainland downtown grid in world.js
  // is already marked under ROADS_V2; this brings the same read to the towns).
  // Flip false to restore today's bare town asphalt (byte-identical).
  if (CBZ.CONFIG.ROAD_MARKINGS_V1 == null) CBZ.CONFIG.ROAD_MARKINGS_V1 = true;
  // BUILDING MASSING V2 (reference adoption: SkyscraperGenerator tripartite
  // grammar). On → taller city/town towers get a base belt cornice, projecting
  // string courses up the shaft, a two-step roofline cornice, corner pinnacles,
  // and (storeys >= 6) an inset SETBACK CROWN with chamfered corners + a spire.
  // All additive DECO or above-roof geometry — no new ground colliders, so
  // doors/interiors/stairs/roof gameplay are untouched. Deterministic per lot
  // (CBZ.hash01, never rng()). Flip false to restore the flat-top box massing.
  if (CBZ.CONFIG.BUILDING_MASSING_V2 == null) CBZ.CONFIG.BUILDING_MASSING_V2 = true;
  // WINDOW REVEALS V2 (reference adoption: window modules with reveal depth +
  // warm/cool lit spread). On → upper-floor clear panes recess ~0.09u behind the
  // outer wall face (real reveal shadow line) with a slim reveal-edge liner, and
  // each window/room gets a hashed warm-or-cool interior temperature. Pane stays
  // clear + breakable; collider shifts <=0.1u inside the same wall. Flip false to
  // restore flush panes + single-temperature glow.
  if (CBZ.CONFIG.WINDOW_REVEALS_V2 == null) CBZ.CONFIG.WINDOW_REVEALS_V2 = true;
  // MAP OVERHAUL V2 (owner's ask: "make the map way cooler — not just how it
  // looks but WHAT is mapped"). On → the full map [M] and the bottom-left
  // minimap draw from the REAL rebuilt world: the actual road network
  // (CBZ.city.arena.roads with per-road widths), the 180 shops / 6 casinos as
  // categorised POI icons, the 17 registered settlements (CBZ.settlements) by
  // name, land vs water/harbor, wanted stars via CBZ.cityStars(), and the
  // police search-radius/heat. Fixed-size icons/marks/labels are drawn LIVE at
  // the current zoom (never baked into the zoom-magnified static plate, which
  // used to blow roof-lift glyphs up to ~12x). Flip false to restore the prior
  // plate-baked glyph map + the game.wanted read.
  if (CBZ.CONFIG.MAP_V2 == null) CBZ.CONFIG.MAP_V2 = true;
  // TOUCH MAP ZOOM CHIPS: the full map's only zoom inputs were the mouse wheel
  // and the F fit key — neither exists on an iPad, and the map opens zoomed-in
  // on the player, so touch could never zoom back out. body.touch shows big
  // +/− chips on the map (fullmap.js) stepping the SAME clampZoom path the
  // wheel drives (tap = one step, hold = repeat). Flip false to hide them.
  if (CBZ.CONFIG.MAP_ZOOM_BUTTONS == null) CBZ.CONFIG.MAP_ZOOM_BUTTONS = true;
  // MAP OWNS SPACE. Owner: "space bar doesnt work to clear waypoint on map."
  // It never did — fullmap.js only ever bound Backspace/Delete and the footer
  // advertised [Backspace]. Space is the key the hand is already on, so it
  // clears the waypoint while the map is up; Backspace/Delete stay as silent
  // aliases. The map also UN-LATCHES CBZ.keys[" "] for that press, because
  // systems/input.js writes the key state from a listener that knows nothing
  // about overlays and vehicles.js's handbrake / playeraircraft's throttle read
  // that latch every frame. Flip false to give Space back to the world.
  if (CBZ.CONFIG.MAP_SPACE_CLEARS == null) CBZ.CONFIG.MAP_SPACE_CLEARS = true;
  // NO KEYBOARD ⇒ NO KEY LEGEND (owner, iPad/prison: the map "says keystrokes…
  // like what the fuck you're doing"). The map overlay named three keys a
  // tablet does not have — "Close [M]", "[Space] clear waypoint" and "Click or
  // right-click to place a waypoint" — and Space was the ONLY documented way
  // to drop a waypoint, so on touch that instruction was a dead end rather
  // than merely wrong. On → fullmap.js retitles all three off CBZ.touchMode at
  // every open(), the footer legend becomes a real 44px tap target wired to
  // the same clearWaypoint(), and mobile.css drops the waypoint arrow's
  // "[M] map" tail (pointer-events:none, so there is nothing to retitle it to).
  // Flip false to restore the key legends everywhere.
  if (CBZ.CONFIG.MAP_TOUCH_LABELS == null) CBZ.CONFIG.MAP_TOUCH_LABELS = true;
  // BRIDGE WALL RULES: causeway guardrails + curb fall-guard colliders are
  // GAPPED wherever the deck crosses a registered road, so bridge walls only
  // exist over real water/gap spans — never across intersections/mouths.
  if (CBZ.CONFIG.BRIDGE_WALL_RULES == null) CBZ.CONFIG.BRIDGE_WALL_RULES = true;
  // Highway deck streetlights (the owner called them dumb): default OFF —
  // real highways here run unlit; flip true to restore the old 40m poles.
  if (CBZ.CONFIG.HWY_LAMPS == null) CBZ.CONFIG.HWY_LAMPS = false;
  // HIGHWAY NETWORK V2 (owner: "completely redo the highway and road system
  // to make it significantly significantly bigger, and extendable and
  // natural"). On → city/highwaynet.js builds the 7-route, ~19km continental
  // highway system as DATA (a named-route table, dial-derived coordinates):
  // filleted sweeping bends, one merged deck + 2 paint meshes per route,
  // per-leg drivable city.roads records + "Link" map regions, and country
  // relief flattened under every corridor (continent.js reads the gate).
  // The hand-placed causeways keep their decks — routes dock flush into
  // them. Flip false for today's causeway-only network, byte-identical.
  if (CBZ.CONFIG.HIGHWAY_NET_V2 == null) CBZ.CONFIG.HIGHWAY_NET_V2 = true;
  // MAP RESERVE V1 (owner's #1 map gripe: "tons of terrain overlaps each other").
  // Each hand-authored landmass (biome floor + feather skirt + mountain massif +
  // island POI) registers its true footprint into a map-level AABB ledger
  // (CBZ.worldLayout.mapReserve). A post-build pass (mapAudit) flags any two
  // PEER landmasses that interpenetrate — the class of bug the pixel world-audit
  // misses when the offending geometry (e.g. the Mount Mercy massif) isn't a
  // tagged worldSurface. Also clamps the Mercy massif's forest/arena-facing
  // ridges so tall peaks stop standing inside Redhollow Woods and on the Ironjaw
  // island. Flip false for a one-line revert to the prior massif + no ledger.
  if (CBZ.CONFIG.MAP_RESERVE_V1 == null) CBZ.CONFIG.MAP_RESERVE_V1 = true;
  // CONTINENT EXPANSION V2: the old coast stopped just 40 m beyond whichever
  // authored biome happened to be outermost. That made a multi-kilometre world
  // read like a tightly packed board: every destination sat on the map frame and
  // there was no country beyond it. Keep every existing placement unchanged,
  // but extend the REAL rendered/walkable continent around their union. The
  // margin is total coast-plate padding (legacy = 40); continent.js also builds
  // a mapped rural loop and four dry-land navigation beacons in this new belt.
  // URL A/B: ?cfg_CONTINENT_EXPANSION_V2=0 or
  // ?cfg_CONTINENT_COUNTRY_MARGIN=360.  The production default deliberately
  // leaves about 1.2 km of real, driveable country beyond the authored POI
  // union; the old 360 m belt still made an aerial world read like a diorama.
  if (CBZ.CONFIG.CONTINENT_EXPANSION_V2 == null) CBZ.CONFIG.CONTINENT_EXPANSION_V2 = true;
  // The enlarged (WORLD_ENLARGE_V2) world needs the wider 2200 belt: the
  // backdrop-relief band rises ≈2050u past the FLAT edge, and FLAT now hugs
  // the spread region union — a 1200 belt would leave the ring's far side on
  // unlabeled open-sea cells (reads as "city on mountain" in the terrain
  // audit). Compact world keeps the authored 1200.
  if (CBZ.CONFIG.CONTINENT_COUNTRY_MARGIN == null)
    CBZ.CONFIG.CONTINENT_COUNTRY_MARGIN = (CBZ.CONFIG.WORLD_ENLARGE_V2 !== false) ? 2200 : 1200;
  // PROCEDURAL BACKDROP TERRAIN. Default OFF: decorative horizon mountains are
  // not geography. Real elevation belongs to registered, reachable landmasses
  // (Mount Mercy publishes an actual ground-height field); no fake skyline ring.
  CBZ.PROC_TERRAIN = false;
  // The old wild-nature belt depended on that decorative terrain mesh.  With
  // the fake backdrop gone it would otherwise plant trees over open water.
  CBZ.WILD_NATURE = false;
  // TERRAIN EROSION V3 (world/terrain_overhaul.js) — the owner's reference
  // terrain algorithm (fbm + pingpong-folded erosion + river channels +
  // biome-scale altitude + smoothLowerPlanes shaping) as OFFSHORE skyline
  // ranges rising out of the real sea beyond the continent's coast. The
  // physics floor never reads this field and CBZ.terrainHeight stays EXACTLY
  // 0 over the whole live world + margin, so "decorative mountains are not
  // geography" still holds: you can see them, never stand on them. When ON it
  // re-enables the decorative pipeline (and its wildnature forest) that the
  // two flags above park. One-line revert: set TERRAIN_EROSION_V3 = false
  // (or ?cfg_TERRAIN_EROSION_V3=0) → exactly the shipped no-backdrop world.
  if (CBZ.CONFIG.TERRAIN_EROSION_V3 == null) CBZ.CONFIG.TERRAIN_EROSION_V3 = true;
  if (CBZ.CONFIG.TERRAIN_EROSION_V3) { CBZ.PROC_TERRAIN = true; CBZ.WILD_NATURE = true; }
  // DYNAMIC WEATHER (systems/weather.js). The two bugs that got this turned
  // off are FIXED (2026-08-03): drops seed on an annulus with a look-direction
  // lead, so nothing sticks to the lens; escape mode reads as indoors, so the
  // jail stays dry. The DRIVEN layer (WEATHER_DRIVE) powers disasters
  // regardless of this flag. Ambient storms stay OFF until the owner approves
  // the look in play — flip true or ?cfg_DYNAMIC_WEATHER=1 to audition.
  if (CBZ.CONFIG.DYNAMIC_WEATHER == null) CBZ.CONFIG.DYNAMIC_WEATHER = false;
  // THE CONTRACT (city/campaign.js). Master enable only — the campaign is
  // RUN-SCOPED now: it activates when the player picks "The Contract" on the
  // title screen (an origins.js registry character like any other), and never
  // touches sandbox origins or standalone Prison Escape. false is the one-line
  // kill switch for the whole authored story. The old flag-true-hijacks-the-
  // title embed behavior moved behind CAMPAIGN_CANONICAL_TITLE (campaign_ui.js).
  if (CBZ.CONFIG.CITY_HITMAN_CAMPAIGN == null) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = true;
  // GTA convention: dying closes the manhunt. On player death the wanted
  // stars, the heat AND the escaped-convict floor (g.escapedConvict) all
  // clear — a corpse is as caught as it gets. city/wanted.js reads this at
  // the death moment; arrest (busted) keeps its own jail funnel untouched.
  // Flip false → the old behavior (the convict floor survived respawn).
  if (CBZ.CONFIG.CITY_WANTED_CLEARS_ON_DEATH == null) CBZ.CONFIG.CITY_WANTED_CLEARS_ON_DEATH = true;
  // THE EXECUTIVE — REAL MARKET CRASH. His opening stops being a fake "the
  // numbers say zero" line: he STARTS with a real brokerage portfolio (real
  // share positions on sim/stocks.js, counted by every net-worth readout) and
  // the story beat executes a REAL market-wide price collapse + margin-call
  // liquidation through the stocks/bank APIs, so the laptop, the phone,
  // charpanel and the bank all agree on the actual number lost. Flip false to
  // restore the old scripted cash/bank zero-out.
  if (CBZ.CONFIG.EXEC_REAL_CRASH == null) CBZ.CONFIG.EXEC_REAL_CRASH = true;
  // THE EXECUTIVE — TOP OF THE TALLEST TOWER. His opening moves to a dedicated
  // EXECUTIVE FLOOR at the crown of the 52-storey flagship mega-tower (storey
  // 50, directly under the penthouse), dressed by city/exec_office.js (one
  // corner office / one meeting room / one reception — space first), with a
  // private express lift back to street level, and the flagship's curtain
  // wall goes CLEAR glass so the city reads far below from inside. Flip false
  // to restore the old spawn (tallest office lot) and the mega-tower's mirror
  // glass + natatorium-under-penthouse layout.
  if (CBZ.CONFIG.EXEC_TOP_OFFICE == null) CBZ.CONFIG.EXEC_TOP_OFFICE = true;
  // CCTV V1 (owner: "Computers on desks — one of the purposes of them is
  // cameras. Add cameras to the game… Put footage from the cameras."). On →
  // city/cctv.js places voxel security cameras deterministically at the bank/
  // gun/jewelry fronts, the jail gate, military gate, airport terminal, exec
  // lobby and a hashed handful of street lamps (2 static draw calls total,
  // registered in CBZ.cctvCameras), and the interior desk terminals + exec
  // office monitors show a LIVE feed: ONE shared 256x144 render target rendered
  // from ONE camera at a time (round-robin), mapped onto the nearest monitor
  // faces — but ONLY while the player is near an interior with monitors, on the
  // real animation frame, at quality tier >= 2 (off at tiers 0-1, like the
  // backdrop). Zero render cost otherwise. Placement is build-path hash01 only;
  // the feed is runtime-visual. Flip false for a one-line revert (no cameras,
  // no feed). URL A/B: ?cfg_CCTV_V1=0.
  if (CBZ.CONFIG.CCTV_V1 == null) CBZ.CONFIG.CCTV_V1 = true;
  // SIT PHYS V1 (owner: prison — "guys can sit on air, close to a chair, but
  // not on the chair"). ONE LAW, closed in three files: A SEATED BODY IS AT
  // ITS SEAT. Measured faults it deletes, all in mode "escape":
  //   · systems/actorcollide.js's wall clamp (order 25) depenetrated every
  //     bunk sitter the cell leash (22.6) had just pinned to the mattress edge
  //     — ejected latOut + body radius = 1.06 m into the room, seated on air
  //     at floor level, ten men at once. Furniture-held bodies now skip the
  //     separation/clamp roster, the rule peds.js's own sit branch states.
  //   · nothing re-pinned a seated PLAIN actor (peds pin their own via state
  //     "sit"; prison actors have no such owner), so the muster dragged a
  //     yard sitter 2.13 m off his claimed stool in the full seated pose.
  //     city/propuse.js's NPC hold (order 42) now pins seated occupants
  //     exactly as it always pinned lying ones.
  //   · propuse's sit ARC latched char.sitting through its walk-in leg, so a
  //     body GLIDED to the bench in the seated pose; the walk phase writes
  //     absolute rig state now, like every other phase.
  //   · the player pin force-stood the player anywhere outside mode "city",
  //     so a prison bench sat you down and instantly stood you back up; the
  //     pin now honours the mode the sit began in.
  // Ratchets: CBZ.propUseAudit().airSitters 0, CBZ.cellblockAudit().seatDrift
  // 0 — both measured by tools/prison-sit-check.mjs (--revert proves the
  // fault returns). Flip false (?cfg_SIT_PHYS_V1=0) for a one-line revert.
  if (CBZ.CONFIG.SIT_PHYS_V1 == null) CBZ.CONFIG.SIT_PHYS_V1 = true;
  // CELL_POST_V2 — A POST A MAN CAN ACTUALLY STAND ON. world/cellblock.js
  // confines a cell resident to a box (the cell inset by a body radius, minus
  // the bunk footprint) and separately sends him to a pose spot off the door
  // centreline. Nothing made the two agree: measured on the shipped wing,
  // TWELVE of twenty residents were posted to a spot their own leash forbids,
  // so entities/npc.js walked them at it (order 22) and the clamp shoved them
  // back off it (order 22.6) every frame — the owner's "flickering like moving
  // super fast front back while trying to run while in cell", 1.4 m/s of
  // travel going nowhere. The post is clamped into the box now, and the leash
  // runs once BEFORE the mover so the step it takes is a step it keeps.
  // Ratchet: CBZ.cellblockAudit().postDrift 0 and no actor above 0.35 m/s of
  // back-and-forth, both measured by tools/prison-jitter-check.mjs (--revert
  // proves the fault returns). Flip false (?cfg_CELL_POST_V2=0) to revert.
  if (CBZ.CONFIG.CELL_POST_V2 == null) CBZ.CONFIG.CELL_POST_V2 = true;
  // PRISON_NAV_V1 — the prison cast walks to doors instead of into walls.
  // entities/npc.js's mover is a straight line at `target` and nothing ever
  // asked what happens when a wall is in the way. Measured on the shipped
  // tree: 7% of attempted movement stalled in the morning yard, 24% at
  // curfew, with twelve bodies grinding geometry at once and three of them
  // walking at a wing door 80 m away through the whole cell block.
  // systems/prisonnav.js plans on the wing's own colliders (an OPEN door is
  // not a collider, so "find the door" is just the shortest path) and feeds
  // the mover one waypoint at a time; when there is no route at all it falls
  // back to city/citynav.js's context-steer so a sealed-in body searches the
  // wall instead of pressing into it. Ratchet: tools/prison-nav-check.mjs
  // (stalled share of attempted movement). Flip false (?cfg_PRISON_NAV_V1=0)
  // for the straight line back.
  if (CBZ.CONFIG.PRISON_NAV_V1 == null) CBZ.CONFIG.PRISON_NAV_V1 = true;
  // CITY_NAV_V1 — Gang City walks around buildings. Same root cause as the
  // prison and the same grid (systems/navgrid.js), windowed 320 m around the
  // player because the city is 8 km wide with 123k colliders. Measured before:
  // 56% of the crowd's attempted movement was pressed into geometry, 37 bodies
  // grinding at once, because city/peds.js answers "blocked" with a 0.45 s
  // timer that sidesteps at random or throws the errand away. Ratchet:
  // tools/city-nav-check.mjs. Flip false (?cfg_CITY_NAV_V1=0) to revert.
  if (CBZ.CONFIG.CITY_NAV_V1 == null) CBZ.CONFIG.CITY_NAV_V1 = true;
  // STEER_COMMIT_V1 — a body offered two equally good ways past an obstacle
  // PICKS ONE. city/citynav.js's context-steer kernel damps a wobble by
  // blending 0.3 of last frame's heading, which does nothing about a REVERSAL:
  // blend (+1,0) with (-1,0) and you get (-1,0) back. Traced on a shipped
  // street, a walking body flipped (-1,0)/(+1,0) on alternate frames and
  // stepped 0.027 m sideways each time for a whole twenty-second sample, and
  // 41% of the city's routed body-windows measured the same way: full speed,
  // zero displacement. A reversal now loses to the heading already committed
  // to, as long as that heading is still one of the safe ones. Shared by
  // city/peds.js and city/crowd.js. Flip false (?cfg_STEER_COMMIT_V1=0).
  if (CBZ.CONFIG.STEER_COMMIT_V1 == null) CBZ.CONFIG.STEER_COMMIT_V1 = true;
  // STREET TALK V2: every civilian is YES / NO / PUNCH. Offer math uses level
  // gap + max cash they can spare. Flip false to restore the crowded verb menu.
  if (CBZ.CONFIG.STREET_TALK_V2 == null) CBZ.CONFIG.STREET_TALK_V2 = true;
  // CUSTOM DIALOGUE: {{TOKEN}} placeholders resolved from custom.env.
  // Default ON for the full uncensored street voice. Flip false (or
  // ?cfg_BADWORDS_UNCENSORED=0) to force the censored FILL_* masks.
  if (CBZ.CONFIG.BADWORDS_UNCENSORED == null) CBZ.CONFIG.BADWORDS_UNCENSORED = true;
  // REAL-PHONE NOTIFICATIONS V2 (owner rule: no 4th-wall notification copy).
  // Every phone notice is a diegetic push from someone/something in-world — a
  // contact texting, the Bank app ("$500 received"), News, the Bounty board, a
  // missed call. A banner drops from the top of the raised phone screen; when
  // the handset is stowed it buzzes and a compact banner rises by the phone
  // glyph. Also restores the full map [M] + minimap alongside the phone with
  // strict mutual exclusion (opening one closes the other). Flip false to
  // restore the plain list + LED-shake behavior and the phone-owns-[M] routing.
  if (CBZ.CONFIG.PHONE_NOTIS_V2 == null) CBZ.CONFIG.PHONE_NOTIS_V2 = true;
  // PLAIN CIVILIANS (owner's rule): when on, ordinary civilians — anyone with no
  // role uniform, no gang, and no business/tycoon identity — render PLAIN (a
  // solid shirt color over blue-jean legs + shoes, NO painted canvas atlas).
  // Role peds (cops/medics/trades/soldiers) keep their painted templates, gang
  // peds get a solid shirt + a bandana MESH, and business NPCs get a composed
  // blazer/shirt/tie. Flip false to bring back the old painted street-basics
  // seams (collar/placket/waistband) on every nobody. clothes.js, outfits.js and
  // crowd.js all read this; undefined is treated as ON.
  if (CBZ.CONFIG.CITY_PLAIN_CIVVIES == null) CBZ.CONFIG.CITY_PLAIN_CIVVIES = true;
  // PROMOTED BODIES GET REAL SLEEVES (the "nil outfit" fix, wave 1). The
  // instanced crowd imposter renders its whole arm in SKIN (one mesh, cheap),
  // and crowd.js's promotion setLook used to copy that literally onto the real
  // rig — so every body that stepped out of the crowd walked up with naked
  // shoulder-to-wrist arms, which at close range reads as a person with no
  // outfit (owner screenshot, 2026-08-16; same look the 2026-07 spawn fix
  // already retired for makePed bodies). On: a promoted body wears the shirt
  // on its upper arms and keeps skin forearms — the exact short-sleeve grammar
  // spawned peds use — and outfits.js's plain re-dress refuses to preserve a
  // skin-colored upper arm it samples off a stale body. Flip false to restore
  // the old bare-arm copy.
  if (CBZ.CONFIG.CITY_CROWD_SLEEVES == null) CBZ.CONFIG.CITY_CROWD_SLEEVES = true;
  // VIPS DRESS THROUGH THE ONE WARDROBE (the "nil outfit" fix, wave 2).
  // vips.js used to paint drafted principals/guards with its own flat tint
  // (torso/collar/legs only): arms kept the civilian's old shirt or bare skin
  // (a black-suit bodyguard with cream arms), a body wearing a PAINTED garment
  // couldn't be tinted at all (a don in a cocktail dress, a magnate in a kid's
  // hoodie), children could be drafted as magnates and armed guards, and the
  // release path restored colors sampled off painted materials (white). On:
  // drafting refuses non-adult bodies and every cast/release re-dresses through
  // outfits.js's canonical redressPed — the same painted uniforms, suits and
  // gowns every other role wears. Flip false for the old flat paintFit.
  if (CBZ.CONFIG.CITY_VIP_WARDROBE == null) CBZ.CONFIG.CITY_VIP_WARDROBE = true;
  // FLAVOR FEED (owner's rule: the HUD is not a tutorial/lore space). Pure
  // world-narration lines — "the big houses are lived in now", "line out the
  // door at X's store", corporate market chatter, eulogy prose for strangers —
  // route through CBZ.cityFlavor and are DROPPED unless this is flipped on.
  // Actionable alerts (your family attacked, ransom demands, robbery nearby,
  // the city uniting against you) stay on CBZ.cityFeed and are unaffected.
  if (CBZ.CONFIG.CITY_FLAVOR_FEED == null) CBZ.CONFIG.CITY_FLAVOR_FEED = false;

  // INVENTORY V2 (city/inventory.js + city/charpanel.js): the Minecraft-like
  // city inventory — [I] opens a real 27-slot grid over g.cityInv +
  // CBZ.weaponInventory (guns are items), stacks/drag/split, drop-to-ground
  // pickups, placeable storage CHESTS, and the player's guns DROP on death
  // (go back for them). Flip false: charpanel reverts to its read-only grid,
  // chests/death-drops/ground-pickups inert, death keeps your guns again.
  if (CBZ.CONFIG.INVENTORY_V2 == null) CBZ.CONFIG.INVENTORY_V2 = true;
  // CRAFTING IS DELETED (2026-08-03), not just dark: systems/craft.js is gone
  // per the standing owner mandate "kill crafting" — acquisition is
  // buy/steal/loot in the world, never a recipe UI. The mode-aware item store
  // it carried lives on as CBZ.econ.itemStore (systems/economy.js), which
  // buildmode/baseclaim placement costs read. No CRAFTING_ENABLED flag
  // remains because there is nothing left for it to gate.

  // SMART TEAM COMBAT (city/squadai.js + city/loyalty.js): armed NPCs that were
  // engaged would all sprint to ~9m and trade shots in a scrum. With this ON, a
  // coordinator LAYERS over the existing per-ped brain (it only writes the
  // transient fields the brain already honors) to hold a standoff band, strafe,
  // seek cover, focus-fire a shared target, fan shooters onto firing arcs, and
  // post a shield on a protectee. Purely additive — flip false to restore the
  // raw vanilla brain (every steer is gated on this flag).
  if (CBZ.CONFIG.CITY_SMART_COMBAT == null) CBZ.CONFIG.CITY_SMART_COMBAT = true;

  // FLIGHT MODEL V2 (city/playeraircraft.js): per-class fixed-wing model with
  // a real ground roll → rotate → climb takeoff, coordinated bank-to-turn,
  // stall/gravity sag, flare/touchdown + crash conditions, and a velocity-
  // tilting helicopter hover model. Flip false to restore the previous
  // flyHeli/flyJet feel — every V2 branch is gated on this flag.
  if (CBZ.CONFIG.AIRCRAFT_FLIGHT_V2 == null) CBZ.CONFIG.AIRCRAFT_FLIGHT_V2 = true;
  // FLIGHT FEEL PASS (owner: "the plane can't go very fast — the altimeter only
  // goes up to 110, and all the plane controls are stupid"). Three one-line
  // reverts, all consumed by city/playeraircraft.js (+ touch_vehicle.js dial,
  // camera.js chase follow):
  //   FLIGHT_SPEED_V2      — real per-class top speeds + a higher altitude
  //                          ceiling (was 220m absolute → ~110m AGL over the
  //                          elevated city, which IS the "110" the owner saw).
  //   FLIGHT_GAUGES_DERIVED— the touch airspeed dial range derives from the
  //                          craft's actual top speed (published as perfVmax)
  //                          instead of a hard-coded 90/40 that pinned early;
  //                          ALT reads height-above-ground like the desktop HUD.
  //   FLIGHT_CONTROLS_V2   — standard flight grammar: WS pitch, AD roll (yaw for
  //                          helis), QE rudder/strafe, held throttle on
  //                          Space/Ctrl, and the mouse is pure FREE-LOOK (it no
  //                          longer secretly steers the nose — that camera-yaw→
  //                          heading coupling was the "stupid controls").
  //   FLIGHT_KEYS_OWNED    — THE PILOT OWNS THE KEYBOARD. Owner, verbatim: "e
  //                          doesnt work to turn planes because it jumps out."
  //                          FLIGHT_CONTROLS_V2 gave Q/E to the rudder (and to
  //                          the heli's lateral cyclic) and systems/controls.js
  //                          prints exactly that on the Aeroplane card — but
  //                          city/interactions.js's keydown routes EVERY E
  //                          through CBZ.cityTryNearestRide(), whose first
  //                          branch is "if (P._aircraft) exit the aircraft".
  //                          So a right-rudder input bailed you out mid-flight.
  //                          With this on, the whole interact fabric stands
  //                          down while you are at the controls of an aircraft:
  //                          no E router, no panel, no verb pills, nothing to
  //                          shadow Q/E. [F] (playeraircraft.js / bailout.js)
  //                          stays the one and only way out, which is what the
  //                          controls card already told the player. Ground
  //                          vehicles are untouched — E still steps you out of
  //                          a car. Flip false for the exact old behaviour.
  if (CBZ.CONFIG.FLIGHT_SPEED_V2 == null) CBZ.CONFIG.FLIGHT_SPEED_V2 = true;
  if (CBZ.CONFIG.FLIGHT_GAUGES_DERIVED == null) CBZ.CONFIG.FLIGHT_GAUGES_DERIVED = true;
  if (CBZ.CONFIG.FLIGHT_CONTROLS_V2 == null) CBZ.CONFIG.FLIGHT_CONTROLS_V2 = true;
  if (CBZ.CONFIG.FLIGHT_KEYS_OWNED == null) CBZ.CONFIG.FLIGHT_KEYS_OWNED = true;
  // AMBIENT AIR TRAFFIC (city/airtraffic.js): a handful of deterministic
  // civilian aircraft (GA prop planes + a light heli) orbiting the city on
  // stacked altitude bands, banking into their turns. Pure atmosphere — no
  // colliders, no weapons, no wanted interaction. Flip false to clear the sky.
  // ======================================================================
  //  BLD_EXTRAS — THE ONE SWITCH FOR EVERY NON-GLASS BUILDING LAYER.
  //
  //  OWNER, twice, and the second time with feeling: "you added a second
  //  building type beyond our normal glass building — purge that second
  //  building type, our glass is perfect and it's THE GAME, why mix it up",
  //  then "the building purge of all the non-glass buildings you added, all
  //  the fucking overlapping things — it's ONE flag."
  //
  //  He is right on both counts. A wave of "make the world realer" work piled
  //  four separate dressing passes onto a building silhouette that was already
  //  finished: masonry/civic facades, brick veneer bands, monumental podiums,
  //  and vertical clutter glued onto the finished lots. Each was individually
  //  defensible and collectively they buried the one thing that gives this
  //  city its identity — a skyline of clean glass. They also overlapped each
  //  other, which is why it read as noise rather than as detail.
  //
  //  So this is the single revert, and it is OFF. Everything downstream reads
  //  it and stands down. Set ?cfg_BLD_EXTRAS=1 to bring the whole lot back at
  //  once if it is ever wanted again — nothing was deleted, it is all one
  //  boolean away.
  // ======================================================================
  //  CORRECTION after a second look in play: "keep government building — it
  //  was the RESIDENTIAL, an old type of building that overlaps over buildings
  //  and got re-added." So this is no longer a blanket purge. The courthouse,
  //  federal building, library, post office and city hall annex STAY: they are
  //  landmarks with function behind them, and they were never the complaint.
  //  What goes is the MASONRY/BRICK residential facade — the old archetype
  //  that came back in on the "realer world" wave — and the vertical clutter
  //  pass, which is the thing that literally geometrically overlaps the
  //  finished building shells.
  if (CBZ.CONFIG.BLD_EXTRAS == null) CBZ.CONFIG.BLD_EXTRAS = false;
  if (!CBZ.CONFIG.BLD_EXTRAS) {
    // GONE: the brick/masonry residential facade archetype + its veneer bands
    CBZ.CONFIG.BLD_MASONRY_V1 = false;
    CBZ.CONFIG.BLD_MASONRY_TEXTURE = false;
    // GONE: the passes that glue geometry ONTO finished buildings (the overlap)
    CBZ.CONFIG.DETAIL_BUILDING_DRESS = false;
    CBZ.CONFIG.BLD_ROOF_CLUTTER_V1 = false;
    CBZ.CONFIG.BLD_WEATHERING_V1 = false;
    CBZ.CONFIG.DETAIL_GROUND_GRIME = false;
    // KEPT: the government/civic buildings. They are placed by
    // city/govcomplex.js, which owns its own stone and its own monumental
    // entrance (§1 perron), so none of the lines above can reach them.
    //
    // NOT KEPT, AND THIS COMMENT USED TO CLAIM OTHERWISE (corrected
    // 2026-08-04). It read "the government/civic buildings and their
    // monumental entries … explicitly left alone so a future blanket edit
    // cannot quietly take them", and a blanket edit had already quietly taken
    // half of it — this very block. `BLD_MASONRY_V1 = false` two lines up is
    // ALSO the gate on buildings_civic.js's civic kit:
    //     bldCivicOrder  (buildings_civic.js:367) — podium, columns,
    //                    entablature, PEDIMENT
    //     bldCivicCrown  (buildings_civic.js:568) — DOME / CLOCK TOWER /
    //                    lantern
    // both of which open `if (!flag("BLD_MASONRY_V1") || !flag(
    // "BLD_CIVIC_PODIUM")) return;` and are called from buildings.js:3827-3828.
    // So every civic anchor in the world is authored WITH a crown and an order
    // and draws NEITHER: govcomplex.js asks for `crown:"dome"` on the
    // Executive Mansion, `crown:"clock"` on City Hall, `crown:"pediment"` +
    // `order:"ionic"` on the Capitol, and the flag drops all of it on the
    // floor. That is a geometry stat fiction — a registry declaring domes the
    // renderer cannot draw — and it is the most likely reason the owner's read
    // of the seat of power is "kinda stupid": he is looking at a box.
    //
    // DELIBERATELY NOT FIXED HERE. The fix is to gate the civic kit on
    // BLD_CIVIC_PODIUM alone (the masonry FACADE is the residential brick the
    // owner actually cut; the colonnade is not), but that puts columns and
    // domes on every civic anchor in the world, and it lands next to
    // govcomplex's new perron on the same facades — two monumental entries
    // stacked is the "stairway that makes no sense" bug again, in reverse.
    // How it LOOKS is the owner's call, judged by playing. This comment now
    // states what is true so the next author is not misled by it.
  }

  if (CBZ.CONFIG.AIR_TRAFFIC_AMBIENT == null) CBZ.CONFIG.AIR_TRAFFIC_AMBIENT = true;
  // HEAVY-WEAPON AIR DAMAGE (city/police.js + city/airtraffic.js): the lock-on
  // work made Air-1 and the ambient GA fleet ACQUIRABLE, so a homing missile
  // would proximity-detonate on them — but neither had a damage model, so the
  // hit did nothing. These gate the new splash seams + shoot-down arcs
  // (health, damage-tier smoke, spin-in, crash fireball + scorch, kill-bus
  // occupant deaths). Flip false to restore the invulnerable set-dressing birds.
  if (CBZ.CONFIG.POLICE_AIR_DAMAGE == null) CBZ.CONFIG.POLICE_AIR_DAMAGE = true;
  if (CBZ.CONFIG.AIRTRAFFIC_DAMAGE == null) CBZ.CONFIG.AIRTRAFFIC_DAMAGE = true;
  // NO SINGLE BLAST DOWNS A HELICOPTER (owner: "helicopters need two rpg hits
  // to come down"). Rotorcraft (records that already carry kind:"heli" — Air-1
  // in city/police.js, the ambient fleet in city/airtraffic.js) cap any ONE
  // explosive splash at 62% of max hp, so a direct rocket wounds them into
  // their existing tier-smoke state and the SECOND kills. Applied only at the
  // blast seams (cityPoliceAirSplash / cityAirTrafficSplash); bullets and
  // planes are byte-identical. The military gunship (140hp vs 90/rocket) was
  // already a two-hit bird and is untouched. Flip false → one-shot helis.
  if (CBZ.CONFIG.AIR_HELI_TWO_BLAST == null) CBZ.CONFIG.AIR_HELI_TWO_BLAST = true;
  // REAL COCKPIT DOOR (city/island_airport.js): the airliner cockpit becomes
  // a room you physically enter — the bulkhead gets a genuine doorway with a
  // sliding pocket-door leaf that eases open as you approach (elevator
  // grammar), the boarding doorway becomes a true hull aperture you can see
  // through from both sides, the walkable cabin deck extends into the
  // cockpit, and the captain's chair seats a live uniformed pilot NPC.
  // Flip false to restore the painted bulkhead door + solid hull.
  if (CBZ.CONFIG.COCKPIT_REAL_DOOR == null) CBZ.CONFIG.COCKPIT_REAL_DOOR = true;
  // COCKPIT GLASS V2 (city/island_airport.js): the airliner cockpit gets the
  // SAME building-grade see-through glass the cabin strips use — real
  // windscreen panes + side quarter windows over OPEN hull/liner apertures
  // (no opaque windscreen band, no opaque cockpit-room side walls), so the
  // uniformed pilot is visible from the apron exactly like the seated
  // passengers and the runway is visible from the pilot seats. Flip false to
  // restore the opaque dark windscreen band + solid cockpit shell.
  if (CBZ.CONFIG.AIRLINER_COCKPIT_GLASS_V2 == null) CBZ.CONFIG.AIRLINER_COCKPIT_GLASS_V2 = true;
  // COCKPIT DOOR SOLID (city/island_airport.js): the (owner-approved) sliding
  // cockpit-bulkhead leaf gets a real physical collider that tracks its
  // open/close easing — a closed cockpit door now physically stops you and
  // opening it is a real passage beat (elevator-grammar y-gated door collider;
  // the door-easing arc owns the collider's solid state). Flip false to restore
  // the pass-through leaf (soft-clamp only). Door look/feel/timing are unchanged.
  if (CBZ.CONFIG.AIRLINER_COCKPIT_DOOR_SOLID == null) CBZ.CONFIG.AIRLINER_COCKPIT_DOOR_SOLID = true;
  // AIRLINER CABIN CREW (city/island_airport.js): one standing uniformed crew
  // member in the forward cabin aisle of each parked airliner, facing aft over
  // the seats — reuses the npclife cabin fill + lifecycle (spawned fresh via the
  // flight-crew profile, attached → frozen). Flip false to remove.
  if (CBZ.CONFIG.AIRLINER_CABIN_CREW == null) CBZ.CONFIG.AIRLINER_CABIN_CREW = true;
  // AIRLINER SCALE (city/island_airport.js): a single up-scale for the walk-in
  // airliner (fuselage, window bands, door aperture, cabin rows, cockpit — every
  // derived interior coordinate follows this one number, and the parked planes
  // shift south so the longer tails stay clear of the terminal). 1.0 reverts to
  // the original size; the shipped default makes it a genuinely large airliner.
  if (CBZ.CONFIG.AIRLINER_SCALE == null) CBZ.CONFIG.AIRLINER_SCALE = 1.45;

  // NPC SCHEDULES (owner's rule: "at night they should almost all be in bed
  // except maybe gangsters and homeless… simple math and schedules… to give
  // npcs purpose"). Master flag for the bucketed day-schedule layer over the
  // instanced crowds: hash-derived archetypes on the city ambient crowd (who
  // sleeps when, where they hang, pause-and-linger stops), the jail's daily
  // regime (yard laps → chow line → circles/wall-sits → night lockdown to the
  // cells) and the citystaff front-desk clerks. Same total headcount —
  // redistribution only. city/crowd.js, entities/crowd.js, entities/
  // ambientstate.js, entities/npc.js and city/citystaff.js read this.
  if (CBZ.CONFIG.NPC_SCHEDULES == null) CBZ.CONFIG.NPC_SCHEDULES = true;
  // sub-knob: the 4h-bucket on-street density curve (deep night ≈ 22% of the
  // day crowd, dawn ramp, evening taper). Off → the old flat 60% night dial.
  if (CBZ.CONFIG.NPC_NIGHT_DENSITY == null) CBZ.CONFIG.NPC_NIGHT_DENSITY = true;
  // sub-knob: spawn-visibility guard — relocation/un-suppress placements are
  // rejected when they'd land close AND inside the camera's forward cone, so
  // the player never watches a body materialize. Off → old placement.
  if (CBZ.CONFIG.NPC_SPAWN_HIDE == null) CBZ.CONFIG.NPC_SPAWN_HIDE = true;

  // One spawn/despawn visibility contract for every population system. Older
  // callers each carried a slightly different forward-cone check, which left
  // gaps in the main city slice, regional streaming and jail rig promotion.
  // This test is deliberately conservative: it rejects a padded screen area
  // (not just the exact frustum) and every very-close transition, even behind
  // the player. Farther than maxDistance the actor is outside the full-rig LOD
  // contract, so it is safe to stage without spending a projection.
  const _npcTransitionProbe = window.THREE ? new window.THREE.Vector3() : null;
  CBZ.npcSpawnGuardStats = CBZ.npcSpawnGuardStats || { checked: 0, blocked: 0, allowed: 0 };
  CBZ.npcTransitionSafe = function (x, z, opts) {
    opts = opts || {};
    if (!CBZ.CONFIG || CBZ.CONFIG.NPC_SPAWN_HIDE === false) return true;
    const P = CBZ.player;
    if (!P || !P.pos) return true;
    const dx = x - P.pos.x, dz = z - P.pos.z, d2 = dx * dx + dz * dz;
    const minDistance = opts.minDistance == null ? 16 : Math.max(0, +opts.minDistance || 0);
    const maxDistance = opts.maxDistance == null ? 150 : Math.max(minDistance, +opts.maxDistance || 0);
    const stats = CBZ.npcSpawnGuardStats;
    stats.checked++;
    if (d2 < minDistance * minDistance) { stats.blocked++; return false; }
    if (d2 > maxDistance * maxDistance) { stats.allowed++; return true; }

    const camera = CBZ.camera;
    if (camera && _npcTransitionProbe && camera.projectionMatrix && camera.matrixWorldInverse) {
      // One metre above the actor root is a better body-centre probe than the
      // floor point, especially for the prison's pitched third-person camera.
      let y = opts.y == null ? null : +opts.y;
      if (y == null || !Number.isFinite(y)) {
        const floor = CBZ.floorAt ? +CBZ.floorAt(x, z)
          : (CBZ.cityGroundHeightAt ? +CBZ.cityGroundHeightAt(x, z) : NaN);
        y = (Number.isFinite(floor) ? floor : (Number.isFinite(P.pos.y) ? P.pos.y : 0)) + 1.05;
      }
      _npcTransitionProbe.set(x, y, z).project(camera);
      const onPaddedScreen = _npcTransitionProbe.z >= -1.05 && _npcTransitionProbe.z <= 1.05 &&
        Math.abs(_npcTransitionProbe.x) <= 1.28 && Math.abs(_npcTransitionProbe.y) <= 1.38;
      if (onPaddedScreen) { stats.blocked++; return false; }
      stats.allowed++;
      return true;
    }

    // Camera matrices are not guaranteed during the earliest boot frames.
    // Fall back to a deliberately wider-than-FOV forward test until they are.
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, d = Math.sqrt(d2) || 1;
    const forwardDot = (dx / d) * -Math.sin(yaw) + (dz / d) * -Math.cos(yaw);
    const safe = forwardDot < -0.12;
    if (safe) stats.allowed++; else stats.blocked++;
    return safe;
  };

  // INTERIORS INTENTIONALITY (owner: "it should be empty, or designed, or a
  // dystopian feeling — intentionally monotonous. Not designed because it has
  // to be."). Every generated office interior is ONE thing, per building,
  // identical on every floor: an intentionally EMPTY lit shell (most), the
  // DESK-FARM (ordered rows of identical desks/terminals with real seated
  // peds typing at them), ONE meeting room behind one aligned divider, or
  // uniform archive racks — the archetype kit in city/interior_programs.js
  // (reusable by any structure builder via CBZ.interiorProgram). Apartment
  // towers stop rotating their flat plan per storey (one plan per building)
  // and a slice go intentionally VACANT. Kills the old reception/meeting/
  // break partition scatter. Off → the legacy furnishers, verbatim.
  if (CBZ.CONFIG.INTERIORS_INTENTIONAL_V1 == null) CBZ.CONFIG.INTERIORS_INTENTIONAL_V1 = true;
  // citywide cap on npclife-seated interior staff (REAL ped rigs, so budgeted:
  // ≤6 a building — receptionist + ≤2 a floor on floors 1-3 — and this many
  // total across all interiors).
  if (CBZ.CONFIG.INTERIOR_STAFF_MAX == null) CBZ.CONFIG.INTERIOR_STAFF_MAX = 48;

  // ---- INTERIORS, SECOND PASS (owner: "interiors of buildings feel very
  // unintentional") -----------------------------------------------------------
  // INTERIOR_ROOMPLAN — wake world/roombuild.js. CBZ.roomPlan/roomFurnish is a
  // complete, constraint-checked interior LAYOUT planner (real circulation
  // widths, chair pull-out, sofa-to-screen distance, a flood-filled reach test
  // that DROPS any piece you could not walk to) that draws exclusively through
  // CBZ.furnish — and it had ZERO callers in the whole repo. On → the home,
  // apartment and government-residence dressers route their bedrooms, lounges
  // and offices through it instead of hand-placing boxes. Off → every caller's
  // `CBZ.roomFurnish ? … : <the old boxes>` guard falls back verbatim.
  if (CBZ.CONFIG.INTERIOR_ROOMPLAN == null) CBZ.CONFIG.INTERIOR_ROOMPLAN = true;
  // INTERIOR_EMPTY_VARIETY — the "empty" archetype is owner-endorsed doctrine
  // ("it should be empty, OR it should be designed"), but every empty floor in
  // the world was the IDENTICAL shell: one slab, one ceiling strip, the same hex,
  // fifty times over — which reads as nobody made this rather than as a choice.
  // On → empty picks one of five deterministic reads per building (bare · under
  // renovation · moved out · after-hours skeleton) plus the occasional DARK
  // storey, all from existing colour buckets. The empty RATIO is untouched.
  if (CBZ.CONFIG.INTERIOR_EMPTY_VARIETY == null) CBZ.CONFIG.INTERIOR_EMPTY_VARIETY = true;
  // INTERIOR_LIGHT_DAY — one shared ceiling-strip material per interior palette,
  // ramped warmer/brighter as night falls (the interiorlight.js window-glow
  // shape, applied to the strips you see from INSIDE). One material write per
  // frame, zero new draw calls, no new material buckets.
  if (CBZ.CONFIG.INTERIOR_LIGHT_DAY == null) CBZ.CONFIG.INTERIOR_LIGHT_DAY = true;
  // GOV_INTERIORS — city/govcomplex.js builds nine seats of power as SHELLS: the
  // Capitol's two chambers, the Executive Mansion's West Wing, the Agency's
  // annex, the finca's wings and the compound's shed had no interior at all, and
  // the main halls were only dressed when city/power.js seated their principal
  // (inside 260 m). On → every gov building is dressed AT WORLD BUILD from the
  // shared kit, and the ledger occupy.js already keeps means the people cast by
  // power.js land in THESE rooms rather than re-dressing the floor.
  if (CBZ.CONFIG.GOV_INTERIORS == null) CBZ.CONFIG.GOV_INTERIORS = true;

  // ---- DRIVING WAVE (city/vehicles.js + police.js + props.js) --------------
  // DRIVE_FEEL_V2: recovers the "out of control" handling — raises the lateral
  // grip floor (0.42 → 1.6) so a broken-loose slide recovers in a beat instead
  // of carrying with a ~1.7s half-life, trims the steer-at-speed grip penalty
  // (−2.25 → −1.3) and scales it by ACTUAL steering input (the old code keyed
  // off `car._steerInput &&` — a decaying float that never re-reaches exactly
  // 0, so after your first turn the penalty applied FOREVER). Handbrake drift
  // untouched.
  if (CBZ.CONFIG.DRIVE_FEEL_V2 == null) CBZ.CONFIG.DRIVE_FEEL_V2 = true;
  // VEH_COLLIDE_FIX: anti-tunnel sweep — a fast car's per-frame displacement
  // can exceed its collision radius, jumping clean over thin colliders (signal
  // poles, lampposts) with both endpoints outside them. Sweep the segment.
  // Also: traffic-signal poles register a solid collider like lampposts do.
  if (CBZ.CONFIG.VEH_COLLIDE_FIX == null) CBZ.CONFIG.VEH_COLLIDE_FIX = true;
  // EMERGENCY_STEALABLE: police cruisers/ambulances etc. can be entered/jacked
  // like any other car (stealing one guard-calls cityAddStars).
  if (CBZ.CONFIG.EMERGENCY_STEALABLE == null) CBZ.CONFIG.EMERGENCY_STEALABLE = true;
  // CARS_NO_WATER: a road car that noses past wheel depth into open water cuts
  // its engine, sinks, and dumps the driver into a swim — no driving on the sea.
  if (CBZ.CONFIG.CARS_NO_WATER == null) CBZ.CONFIG.CARS_NO_WATER = true;
  // FARM_EQUIPMENT_REAL: the farm tractor/combine register as real parked,
  // enterable, drivable vehicles (solid to traffic) instead of decoration.
  if (CBZ.CONFIG.FARM_EQUIPMENT_REAL == null) CBZ.CONFIG.FARM_EQUIPMENT_REAL = true;

  // ---- SETTLEMENTS + CASINOS (city/settlements.js + city/casino.js) --------
  // SETTLEMENTS_V2: every biome/country/minicity settlement is COMPOSED — a
  // per-site flavored anchor plan guarantees purposeful, furnished shops (food,
  // general store, then rolled bar/bank/clinic/gunsmith/pawn/clothing/casino)
  // on its central lots, town shops/homes/roads reach the arena (vendors,
  // Zillow, minimap, traffic), and every settlement is registered in
  // CBZ.settlements. OFF → legacy: towns build geometry only, world byte-
  // identical to the pre-V2 baseline (arena.lots/roads == mainland only).
  if (CBZ.CONFIG.SETTLEMENTS_V2 == null) CBZ.CONFIG.SETTLEMENTS_V2 = true;
  // CASINOS_V1: an order-90 pass turns every casino LOT (mainland Golden Ace +
  // composed town casinos) into a real gaming house — marquee + mast sign
  // exterior, felt tables with sittable seats + an "[E] Sit at the table" that
  // opens the casino floor, slot bank, bar and cashier cage. OFF → the plain
  // casino retail shell (no dress pass, no table interaction).
  if (CBZ.CONFIG.CASINOS_V1 == null) CBZ.CONFIG.CASINOS_V1 = true;
  // WATER_REFLECT: the ONE ocean surface (CBZ.citySea) becomes a real
  // planar-reflection water plane (src/vendor/WaterReflect.js, wired by
  // src/world/waterfx.js) — the mirror re-renders the scene into a 256px
  // target and the shader distorts it with a scrolling normal map + sun
  // specular + fresnel. Half-rate mirror + auto-off below the Balanced
  // quality tier keep the cost bounded. OFF → world.js's flat animated sea
  // renders exactly as before (waterfx never touches CBZ.citySea).
  if (CBZ.CONFIG.WATER_REFLECT == null) CBZ.CONFIG.WATER_REFLECT = true;
  // ---- console movement tech (systems/physics.js stance machine) ----------
  // PLAYER_SLIDE: sprint + a crouch press = a COD-style momentum slide (burst
  // above sprint speed decaying over ~0.8s, crouch-height hitbox/camera,
  // heavily damped steering; ends crouched, or pops straight back up into the
  // sprint if you keep direction+sprint held; ~1s cooldown stops chaining).
  // PLAYER_PRONE: a second crouch press within the tap window drops you PRONE
  // (flat rig, ~0.45 hitbox, slow crawl; crouch press back to crouch, jump
  // stands; steadies LMG recoil — CBZ.playerProneSteady in fpsmode's kick).
  // Both are city+survival on-foot verbs (jail keeps its hold-to-sneak, and
  // they never run while driving/flying/swimming). Desktop: Ctrl/C taps.
  // Touch: the L3 stick-press grammar (touch.js routes presses to physics).
  // Either flag false = that verb gone; both false = stance machine entirely
  // dormant and desktop/touch behave exactly as before.
  if (CBZ.CONFIG.PLAYER_SLIDE == null) CBZ.CONFIG.PLAYER_SLIDE = true;
  if (CBZ.CONFIG.PLAYER_PRONE == null) CBZ.CONFIG.PLAYER_PRONE = true;
  // ---- strategic-weapons layer (city/bunkers.js + city/strategic.js) ------
  // STRAT_BUNKERS: hardened shelters — the Fort Brandt command bunker
  // (armory crate, seated officers, the nuclear vault) + two deterministic
  // wilderness finds (mountain early-warning post, desert fallout shelter).
  // An INTACT bunker shelters anyone inside from the nuke; a blast door is
  // the only way in. OFF → none of it builds.
  // STRAT_B2: the B-2 flying wing on the military apron — boardable/lockable
  // like all base hardware, flies the heavy/stable class, carries the bay.
  // STRAT_BUNKER_BUSTER: the penetrator payload — the ONLY weapon that
  // kills through a bunker roof (and one-shots a building through its roof).
  // OFF → a buster impact resolves as a plain heavy bomb.
  // STRAT_NUKE: every B-2 carries three flight-only nuclear weapons; the
  // military vault separately holds one portable device (drawn as three
  // warheads on a rack, taken and used as ONE) for a planted armed
  // countdown. Staged city-flattening blast, kill-bus deaths
  // ("nuclear blast" in the corner feed), 5★, lingering radiation zone.
  // OFF → a nuke impact resolves as a plain heavy blast.
  if (CBZ.CONFIG.STRAT_BUNKERS == null) CBZ.CONFIG.STRAT_BUNKERS = true;
  if (CBZ.CONFIG.STRAT_B2 == null) CBZ.CONFIG.STRAT_B2 = true;
  if (CBZ.CONFIG.STRAT_BUNKER_BUSTER == null) CBZ.CONFIG.STRAT_BUNKER_BUSTER = true;
  if (CBZ.CONFIG.STRAT_NUKE == null) CBZ.CONFIG.STRAT_NUKE = true;
  // ---- THE NUCLEAR REDRAW (2026-07-28) -----------------------------------
  // Three one-line reverts. Each is also null-checked in its OWNING file, so
  // any of these modules still degrades correctly when loaded standalone.
  //
  // NUKE_FX_V2 (city/nukefx.js + city/strategic.js) — the weapon as it is
  //   SEEN. In the air: a real gravity-bomb body (ogive nose, boat-tail,
  //   cruciform fins, an arming band) that tumbles on release, settles
  //   nose-down, and streams a ribbon parachute when the delivery profile
  //   calls for a retarded fall. On the ground: the Trinity beat order —
  //   a pure-white hemispherical DOME growing off the deck on the
  //   Taylor-Sedov R ∝ t^0.4 law, the double flash, the dome detaching and
  //   cooling as it lifts, an incandescent cap that OVERHANGS its stem with
  //   a collar and a dark cauliflower crown boiling over the top, a
  //   red-brown base surge rolling out along the ground, and the fireball
  //   LIGHTING the world (sun/hemisphere/fog) instead of only tinting sky.
  //   false → the pre-2026-07-28 sequence, byte-for-byte.
  // NUKE_STASH_TRIPLE (city/bunkers.js) — the vault cradle holds THREE
  //   physical warheads on a handling rack instead of one bare casing. It is
  //   still ONE inventory item and one usable weapon: the stash is taken as a
  //   unit and every existing gate (one per world, the theft crime, the
  //   "already carry" refusal) is untouched. false → the single casing.
  // NUKE_GROUND_COUNTDOWN (city/strategic.js) — the planted device becomes a
  //   real ARMED COUNTDOWN: a three-beat arming sequence, a clock long enough
  //   that the escape IS the mission (see NK.TIMER's derivation), escalating
  //   audible/visual cues, and the same abort the arc always had.
  //   false → the flat 45 s timer with no arming beat.
  // NUKE_REAL_SCALE (city/nukefx.js + systems/impactbus.js) — DIMENSIONAL
  //   AND CASUALTY HONESTY. The yield is INVERTED out of the bus's nuke row
  //   (W = (radius*power/50)^3 = 16 kt, Hiroshima-class), and then nothing
  //   is typed: the cloud takes the dimensions Glasstone's stabilised-cloud
  //   figures give (5,106 m cap, 3,992 m thick, 8,004 m up, on a 1,702 m
  //   stem over a 2,016 m dust base, topping out at 10 km), the blast rings
  //   take the 1 kt reference overpressure radii cube-root scaled
  //   (504/756/1,109/2,016/3,276 m for 20/10/5/2/1 psi), and the death toll
  //   takes the USSBS Hiroshima killed-by-distance survey. Because a 10 km
  //   cloud is ten times the camera's own 1 km far plane, the flag also
  //   switches on the far-tier impostor that draws it at true ANGULAR size.
  //   false → the pre-2026-07-28 framing-scale cloud and the flat blast.
  if (CBZ.CONFIG.NUKE_REAL_SCALE == null) CBZ.CONFIG.NUKE_REAL_SCALE = true;
  if (CBZ.CONFIG.NUKE_FX_V2 == null) CBZ.CONFIG.NUKE_FX_V2 = true;
  if (CBZ.CONFIG.NUKE_STASH_TRIPLE == null) CBZ.CONFIG.NUKE_STASH_TRIPLE = true;
  if (CBZ.CONFIG.NUKE_GROUND_COUNTDOWN == null) CBZ.CONFIG.NUKE_GROUND_COUNTDOWN = true;

  // ---- character/combat reads (owner reports, one flag each) --------------
  // CHAR_SEAT_POSE_V2 (entities/character.js): REAL chair sit for seats that
  // declare their geometry (aircraft seat records carry cushion/floor data;
  // benches/desks/cars don't and keep the legacy fake). The old office pose
  // kept the feet at the rig's root plane, and aircraft anchors sit ON the
  // cushion — so passengers read as squatting on top of the seat ("their
  // feet are on the seat"). V2 sinks the whole model and solves hip/knee so
  // the butt lands ON the cushion and the soles land ON the cabin FLOOR.
  if (CBZ.CONFIG.CHAR_SEAT_POSE_V2 == null) CBZ.CONFIG.CHAR_SEAT_POSE_V2 = true;
  // CHAR_SEATED_HITTABLE (systems/fpsmode.js + peds/npclife): seated cabin
  // passengers/crew join the bullet's hit-candidate set (their rigs are
  // parented plane-local, so the world-space sphere stack never saw them —
  // "you can't shoot them"), and a killed sitter slumps dead IN the seat
  // instead of ragdolling a plane-local group through world space.
  if (CBZ.CONFIG.CHAR_SEATED_HITTABLE == null) CBZ.CONFIG.CHAR_SEATED_HITTABLE = true;
  // GORE_HIT_FEEDBACK_V2 (systems/reactions.js + systems/grapple.js) — RETIRED.
  // Owner doctrine: "Shot players shouldn't change colors — they should just
  // have a HOLE from getting shot... It's just physics." A hit now changes
  // NOTHING about material color, EVER: both the legacy emissive white/orange
  // pop AND the V2 blood-dark diffuse tint are gone. PHYSICS-ONLY is the only
  // mode — the impact reads purely through gore.spray droplets + the wounds.js
  // entry hole. This flag is kept for config-compat and is now INERT (no code
  // branches on it to write color); the surviving skinTone-ground-truth safety
  // keeps a head from ever being left off-tone. Default false = "no color."
  if (CBZ.CONFIG.GORE_HIT_FEEDBACK_V2 == null) CBZ.CONFIG.GORE_HIT_FEEDBACK_V2 = false;
  // GORE_LOCATIONAL (systems/fpsmode.js cityGunHit): hit LOCATION drives
  // lethality — a headshot is a one-shot kill (already enforced via lethalHead),
  // a torso hit does the weapon's baseline damage, and an arm/leg hit carries
  // LESS lethality (reduced damage). Flip false → flat body damage everywhere
  // (pre-flag behaviour), a one-line revert.
  if (CBZ.CONFIG.GORE_LOCATIONAL == null) CBZ.CONFIG.GORE_LOCATIONAL = true;
  // GORE_DECAP_SHOTGUN (systems/gore.js): a muzzle-close SHOTGUN headshot kill
  // (<=5.5u) takes the head clean off via the existing dismemberment tech (the
  // neck group hides, a flying head tumbles, the neck stump geysers) — the
  // corpse still flows through the normal kill bus/killfeed. Flip false → a
  // close shotgun headshot keeps the head on (intact ragdoll + wound), revert.
  if (CBZ.CONFIG.GORE_DECAP_SHOTGUN == null) CBZ.CONFIG.GORE_DECAP_SHOTGUN = true;
  // GORE_REALISM_V2 (systems/gore.js) — OWNER, on the PRISON shootout: "remove
  // the cubes of blood, it looks so unrealistic." The city already had this
  // pass (its own filmed complaint: "a shootout buried the floor in permanent
  // clothing-colored boxes"); escape/survival never got it, and the geometry
  // underneath was wrong in EVERY mode. Three separate things were cubes:
  //   1. GIBS — 5-7 BoxGeometry(1,1,1) chunks per kill, scaled 0.2-0.5, tinted
  //      with the victim's skin/shirt colours. Literal 20-50 cm coloured dice.
  //   2. DROPLETS — SphereGeometry(1,5,4) is radius ONE, so `size` 0.07-0.18
  //      put 14-36 cm faceted balls in the air and called them blood.
  //   3. MIST — SphereGeometry(1,4,3) is barely a polyhedron; at 50% opaque and
  //      growing 3.2x it was a swarm of 20-70 cm lit lumps, not an aerosol.
  // ON (default), in every mode: a gunshot throws NO generic chunks (an
  // explosion or a real sever still does, and those now use torn irregular
  // silhouettes instead of boxes); droplets are 4-10 cm and STRETCH along their
  // own flight vector so they read as moving blood; aerosol is a soft
  // camera-facing puff on the existing feathered blood texture; a landing
  // droplet stamps a hand-sized splash instead of a 1.6 m blot; and whatever
  // does fly settles, fades and clears the floor instead of lying there.
  // OFF → the exact pre-pass behaviour in all three layers, one line.
  if (CBZ.CONFIG.GORE_REALISM_V2 == null) CBZ.CONFIG.GORE_REALISM_V2 = true;
  // CHAR_BELT_V2 (entities/character.js): the 3D belt band was a fixed
  // boxGeom(0.96,0.16,0.54) that ignored the `fem` build gate — on a fem torso
  // (0.78 wide) the 0.96 band flared 0.09/side into a clown ring, and even on
  // male builds it sat WIDER than the torso (0.92) and far wider than the hips
  // (pelvis 0.84), reading as a protruding shelf from every angle the front-
  // facing charpanel portrait happened to hide. V2 sizes the band per build to
  // tuck ~0.01/side inside the shirt and sit proud of the hips (all offsets
  // 0.01–0.03 → nothing coplanar with the torso/pelvis faces it overlaps, so no
  // TBDR z-fight), slims it to the collar/stripe band grammar (H 0.14), and
  // seats the buckle half-in/half-proud of the band's front face so it can't
  // float. Build-path only, deterministic. OFF → the legacy fixed band.
  if (CBZ.CONFIG.CHAR_BELT_V2 == null) CBZ.CONFIG.CHAR_BELT_V2 = true;
  // CHAR_BELT_PAINTED (entities/character.js) — OWNER: "Belts are painted on
  // shirts. Why are we trying to geometrically make belts?" A belt is a texture
  // band, not a box. When ON (default) the geometric c.belt band+buckle are NOT
  // built at all (no hidden meshes — the block is skipped), so the belt read
  // comes entirely from the PAINTED garment textures in city/clothes.js, where
  // the flagship belt-bearing outfits already paint their own band+buckle
  // (suit, police, swat, sheriff, ems, security). This also RETIRES the old
  // player double-belt (a geometric ring sitting on top of the painted police/
  // suit belt whenever the protagonist wore a painted fit). Flat prison rigs
  // (player jumpsuit, guards/warden) simply go beltless — acceptable, and far
  // cheaper than re-texturing a recolor-driven flat rig. Takes PRECEDENCE over
  // CHAR_BELT_V2. Flag matrix: PAINTED=true → no geometry (painted only);
  // PAINTED=false + V2=true → the current build-aware geometric band; PAINTED=
  // false + V2=false → the legacy fixed band. Purely visual, no rng, headless-
  // identical (build path adds/removes no meshes the math gate counts on the
  // painted side). Flip false to bring geometric belts back in one line.
  if (CBZ.CONFIG.CHAR_BELT_PAINTED == null) CBZ.CONFIG.CHAR_BELT_PAINTED = true;
  // CHAR_YOKE_CLEAR (entities/character.js + city/clothes.js) — OWNER: "security
  // guards and my player sometimes have what looks like a WHITE NECK ROLL — it
  // disrupts outfits and FLICKERS, meaning it must be overlapping." The flicker
  // was arithmetic: the shoulder-yoke box (skinSlots.collar) and the jacket
  // shell were sized from profile fields authored against nothing, and three
  // pairs came out EXACTLY coplanar on shipped bodies — ADULT_F's yoke depth ==
  // her chest depth (a stipple across the whole upper chest, drawn in the yoke's
  // flat colour), ADULT_F's shell top == her yoke top, ADULT_M's yoke half-width
  // == his arm socket's inner plane, and ADULT_M's shell depth == his head's.
  // ON (default) clamps every one of those to a minimum 0.01 per face — proud or
  // buried, never ON the plane — so a z-fight there is impossible by
  // construction. Adult-male geometry is unchanged except the yoke's width
  // (+0.02, entirely inside the arm socket) and the shell's depth (+0.02). Build
  // path only, no rng, headless-identical. OFF → the exact old boxes.
  if (CBZ.CONFIG.CHAR_YOKE_CLEAR == null) CBZ.CONFIG.CHAR_YOKE_CLEAR = true;
  // CITY_YOKE_GARMENT (city/outfits.js) — the other half of the same bug. That
  // yoke box is the top of the TORSO COLUMN and no painted garment ever reaches
  // it (clothes.js dresses torso/arms/legs/jacket), yet recolorRig stamped the
  // outfit's `collar` ACCENT on it unconditionally — the one slot that ignored
  // the painted-parts guard. So a painted uniform wore a contrasting flat band
  // around its neck on top of the collar its own canvas had already drawn:
  // `security` is 0xe8e8e8 on a 0x1c1f26 shirt, which is the "white neck roll",
  // and the tuxedo comment in that file already named this fault "the priest
  // look". ON (default): under a PAINTED torso the yoke wears the garment's own
  // cloth colour and disappears into it; a flat (unpainted) fit is untouched and
  // keeps its accent band. charpanel.js already hid this box on the portrait for
  // the same reason, so this makes the portrait and the street agree. OFF →
  // every fit stamps its accent again.
  if (CBZ.CONFIG.CITY_YOKE_GARMENT == null) CBZ.CONFIG.CITY_YOKE_GARMENT = true;
  // CHAR_WRIST_LANDMARK (entities/character.js) — OWNER: "watches are on HANDS
  // now — move them up to WRISTS." Three files hang hardware in the ELBOW frame
  // (bling.js's watch/bracelet, charpanel.js's portrait watch, restrain.js's zip
  // ties) and each had typed its own constant against the adult male, measured
  // against the wrist SOCKET rather than the hand that is actually DRAWN — so
  // two of them sat inside the hand box. CBZ.charArmLandmarks() answers it once,
  // off the rig's own armLo/handH, so a woman's and a child's shorter forearm
  // place their own watch with no table and no call-site edit. OFF → the export
  // returns null and every consumer falls back to its old literal.
  if (CBZ.CONFIG.CHAR_WRIST_LANDMARK == null) CBZ.CONFIG.CHAR_WRIST_LANDMARK = true;
  // TP_GUN_GROUND_CLEAR (systems/holsterprops.js) — OWNER: "when player is
  // laying down and crouched make gun look right especially in third person —
  // rn gun can go under ground." The third-person low-ready barrel vector is
  // authored in BODY space against an UPRIGHT torso, and prone pitches that
  // frame 1.42 rad: (0.34,-0.82,0.36) comes out of it pointing 30° BELOW
  // horizontal and BACKWARD, from a hand prone has put ~0.1 m off the deck, so
  // the whole rifle is under the terrain. ON (default) does two things: past
  // 0.8 rad of torso pitch the body stops aiming the gun (yaw only, presented
  // down-range +3.4°, which is how a prone shooter holds it), and in EVERY
  // stance the barrel is rotated up to the grazing angle if the muzzle — the
  // gun's own measured length along its own direction — would otherwise sit
  // below CBZ.floorAt + 0.05. The second half needs no pose test, so it also
  // covers crouch, slopes, kerbs and the longest gun in the game. First person
  // is unaffected: the whole hand-prop block is gated on third person and the
  // FP viewmodel is camera-relative. OFF → the old body-space vector.
  if (CBZ.CONFIG.TP_GUN_GROUND_CLEAR == null) CBZ.CONFIG.TP_GUN_GROUND_CLEAR = true;
  // WEAPON_GROUND_PHYSICS (systems/actorweapons.js) — every firearm uses one
  // measured ground law. Held guns sample the full hand→muzzle segment against
  // terrain/platforms; released guns carry velocity and angular momentum,
  // substep walls/ground, bounce, then place their actual lowest model vertex
  // on the support beneath them. Inventory/NPC/death pickups follow the moving
  // model instead of remaining at their spawn marker. OFF → the prior held-gun
  // guard plus static inventory pickups / fpsmode's private cosmetic tumble.
  if (CBZ.CONFIG.WEAPON_GROUND_PHYSICS == null) CBZ.CONFIG.WEAPON_GROUND_PHYSICS = true;
  // GORE_HIT_FEEDBACK_V2 (systems/reactions.js + systems/grapple.js): a shot
  // person must never BRIGHTEN ("they turn super white, which is dumb") —
  // the hit read becomes a brief blood-dark tint on the struck head while
  // the existing gore.spray/bodyWound blood carries the impact. Flip false
  // to restore the legacy emissive white/orange pop.
  if (CBZ.CONFIG.GORE_HIT_FEEDBACK_V2 == null) CBZ.CONFIG.GORE_HIT_FEEDBACK_V2 = true;
  // ---- AIM FEEL (owner: make aiming + shooting EASIER, especially on iPad) --
  // Five independent, reversible knobs. Four default to the improved behaviour;
  // the fifth (LOCKON_SQUARE_SPIN) defaults OFF because the owner asked to kill
  // that animation. Flip any one to revert its feel in a single line.
  //
  // FPS_ADS_SIGHTS (systems/fpsmode.js): holding aim in FIRST person eases the
  // weapon viewmodel from its corner carry to a CENTERED, down-the-sights pose,
  // paired with the existing ADS FOV drop. Bullets still fly the camera ray
  // (unchanged) and the depth-clear viewmodel can't wall-clip; forward travel is
  // capped (Z held at the carry depth) so the gun never crosses the near plane.
  // Skipped while a real optic (sniper scope / fitted gunsmith optic) owns the
  // view, AND for explosive launchers (w.explosive — the RPG): the fat
  // bore-axis tube centered on the eye filled the zoomed frame with its own
  // dark silhouette (owner-filmed), so launchers hold the corner carry and
  // keep only the ADS FOV punch-in.
  // Flip false → every gun stays corner-pinned while aiming (prior look).
  if (CBZ.CONFIG.FPS_ADS_SIGHTS == null) CBZ.CONFIG.FPS_ADS_SIGHTS = true;
  // CAM_ADS_PITCH_WIDE (systems/camera.js): while AIMING on TOUCH, open the
  // third-person touch pitch clamp from [-0.85,0.75] toward desktop's [-1.0,0.9]
  // so an iPad can actually put the reticle on high/low targets. Touch-only (the
  // clamp is consumed only by touch.js). Flip false → the standard touch pitch
  // range even while aiming.
  if (CBZ.CONFIG.CAM_ADS_PITCH_WIDE == null) CBZ.CONFIG.CAM_ADS_PITCH_WIDE = true;
  // ADS_RECOIL_SETTLE (systems/fpsmode.js): while aiming, the view-return spring
  // recenters faster so the reticle SETTLES back onto the target between shots
  // instead of wandering up-screen. Tunes the existing recenter (gated on the
  // same aimHeld predicate as adsRecoilMul); the recoil KICK itself is
  // unchanged. Flip false → the hip recentering rate while aiming.
  if (CBZ.CONFIG.ADS_RECOIL_SETTLE == null) CBZ.CONFIG.ADS_RECOIL_SETTLE = true;
  // TOUCH_AIM_ASSIST (systems/touch.js, reads systems/lockon.js candidates):
  // mild, TOUCH-ONLY aim help. Reticle FRICTION (look sensitivity eases down as
  // the crosshair nears a lock-on candidate) plus a small, rate-capped MAGNETISM
  // nudge toward the nearest on-screen candidate while aiming. Reads the live
  // lock-on candidate pool (missile / vehicle targets); a no-op whenever that
  // pool is empty. Never runs for a desktop mouse, and stands down whenever the
  // actor soft-lock (AIM_LOCK_ASSIST) already owns the aim. Flip false → no
  // touch friction/magnetism.
  if (CBZ.CONFIG.TOUCH_AIM_ASSIST == null) CBZ.CONFIG.TOUCH_AIM_ASSIST = true;
  // LOCKON_SQUARE_SPIN (systems/lockon.js): owner asked to kill the acquire
  // square's rotation ("when the homing thing goes yellow→red it spins the
  // square — really stupid"). Default FALSE = the yellow acquiring square
  // tightens onto the target with NO rotation (the color flip, corner ticks and
  // lock tone are untouched). Flip true to restore the old 135°→0° acquisition
  // SPIN.
  if (CBZ.CONFIG.LOCKON_SQUARE_SPIN == null) CBZ.CONFIG.LOCKON_SQUARE_SPIN = false;
  // TREES_V2 (every tree/vegetation builder + world/treeaudit.js): the tree
  // CONNECTION LAW — trees may be voxel-simple but never physically
  // impossible. ON (default): every canopy piece OVERLAPS its trunk by a real
  // embed margin (no air gap, verified at per-instance jitter extremes), every
  // trunk is SEATED below the LOWEST terrain sample under its footprint (so a
  // vertical trunk on a relief slope sinks to the DOWNHILL side), multi-part
  // trees are support-connected to the ground as an AABB chain (the
  // demolition-check invariant), and builders register their planted parts so
  // CBZ.treeAudit() can prove { floatingCanopies:0, unseatedTrunks:0,
  // brokenChains:0 } forever. Also gates the cheap canopy upgrades (tiered
  // pine crowns, palm frond hubs at the TRUE leaned trunk top, saguaro arm
  // ring). OFF = the old builders byte-for-byte, and nothing registers (the
  // audit reports zeros trivially) — the one-line revert.
  if (CBZ.CONFIG.TREES_V2 == null) CBZ.CONFIG.TREES_V2 = true;

  // BIOME_SOLID_TRUNKS (city/biome_forest.js, biome_snow.js, biome_farmland.js,
  // world/rockscliffs.js, city/biome_desert.js) — OWNER: "find things in the
  // game that you can run through." TREES_V2 above made every tree physically
  // possible; it never made one physically PRESENT. The whole of Redhollow
  // (~2,600 conifers + ~250 birches, of which exactly 24 collided), all 130
  // snow pines, all 40 alpine outcrops, every field fence in the farmland
  // (~110 runs), and every mountain boulder rockscliffs.js has ever scattered
  // were pure silhouette — you sprinted and drove clean through the lot.
  // ON: the TRUNK collides (never the canopy: foliage is brushed through,
  // timber is not), sized from the geometry's OWN base radius times the
  // instance's OWN scale, and height-gated to its real top so anything above
  // the treeline passes. The old "not thousands of them (perf)" reasoning does
  // not survive contact with systems/physics.js: the broadphase is a SPATIAL
  // GRID, so the per-frame cost is colliders-per-8m-bucket, and at an 11 m
  // grid pitch with a hard 2.4 m separation a bucket holds one or two trunks.
  // OFF = every one of those builders byte-for-byte as it shipped.
  if (CBZ.CONFIG.BIOME_SOLID_TRUNKS == null) CBZ.CONFIG.BIOME_SOLID_TRUNKS = true;

  // SOLID_BACKCOUNTRY (city/continent.js) — the same law for the open country
  // between the places. That dressing stands on ground continent.js ITSELF
  // registers as a walkable region ("The Backcountry"), so unlike the offshore
  // backdrop range it is not scenery, and every trunk and every 1.3-2.4 m
  // boulder in it was pass-through. Placement is a 46 m grid, so no two of
  // these can ever share a broadphase bucket. OFF = draw-only, as before.
  if (CBZ.CONFIG.SOLID_BACKCOUNTRY == null) CBZ.CONFIG.SOLID_BACKCOUNTRY = true;

  // Small helper used everywhere for registering frame work. In profiling
  // sessions only, retain the callsite so the benchmark can name anonymous
  // updater functions without adding any normal-game stack-capture overhead.
  const profileFrameWork = typeof location !== "undefined" && /(?:\?|&)profile=1(?:&|$)/.test(location.search || "");
  // Files that only ever FORWARD a registration are never the answer to "who
  // registered this work". config.js is this file; core/prio.js wraps
  // CBZ.onUpdate/onAlways in place (its collision-warning dev aid), so its
  // wrapper frame sits between every caller and this function. Skipping only
  // config.js meant prio.js became the first match and ALL 653 updaters
  // reported "src/core/prio.js:182" — the profiler could name the cost of
  // every system in the game and not one of their names. Any future in-place
  // wrapper of these registrars belongs in this list.
  const FRAME_SOURCE_SKIP = ["src/config.js", "src/core/prio.js"];
  function frameSource() {
    if (!profileFrameWork) return "";
    const stack = (new Error()).stack || "";
    const lines = stack.split("\n");
    for (let i = 2; i < lines.length; i++) {
      // Script cachebusters appear in stacks as file.js?v=tag:line:col.
      const m = lines[i].match(/(src\/[^:?)]+\.js)(?:\?[^:)\s]+)?:(\d+)/);
      if (m && FRAME_SOURCE_SKIP.indexOf(m[1]) === -1) return m[1] + ":" + m[2];
    }
    return "";
  }
  CBZ.onUpdate = function (order, fn) { CBZ.updaters.push({ order, fn, source: frameSource() }); };
  CBZ.onAlways = function (order, fn) { CBZ.always.push({ order, fn, source: frameSource() }); };

  // ---- THE ONE QUALITY KNOB (owner rule: NO hardcoded content budgets). ----
  // Every content system (decal pools, gore counts, rain density, LOD draw
  // ranges, scenery scatter…) sizes itself through this instead of a magic
  // constant. lo = the emergency tier-0 value, hi = the full-fat tier-4 value,
  // linear in between. Reads the LIVE tier (core/quality.js keeps
  // CBZ.qualityLevel in sync with the pause-menu perf/quality slider and the
  // adaptive governor), so the slider is the single authority on how much the
  // GPU is asked to draw — never a hardcoded number in some file.
  CBZ.qScale = function (lo, hi) {
    const q = CBZ.qualityLevel == null ? 4 : CBZ.qualityLevel;
    return lo + (hi - lo) * (Math.max(0, Math.min(4, q)) / 4);
  };

  // ---- FLAG INDEX for the REALISM PASS ----------------------------------
  // These families are self-defaulted at the top of their OWN module with the
  // usual `if (CBZ.CONFIG.X == null) CBZ.CONFIG.X = <default>;` idiom, so they
  // are all `?cfg_X=0`-overridable. Listed here for discoverability only —
  // setting one here still wins, because the modules only fill in null.
  //
  //   WATER_*    src/world/water_spec.js — WATER_V2 (master), _RADIAL_MESH,
  //              _SHORE_FX, _LAKE_TINT, _UNDERWATER, _BUOYANCY, _WAKE_FX
  //   MOUNT_*    src/world/mountain_detail.js — _EROSION_V4, _STRATA_V1,
  //              _SNOW_ASPECT_V1, _ROCKS_V1, _MESH_DENSITY, _ADAPTIVE_GRID,
  //              _HEIGHT_CACHE
  //   TERRAIN_*  src/world/terrain_overhaul.js — _RIVER_BANKS, _STRATA,
  //              _SMOOTH_SHADE, _TILE_SEG, _RING_AMP
  //   SPEEDWAY_* src/city/island_speedway.js — _BANK, _BANK_WALKABLE,
  //              _CAR_CONFORM, _CATCH_FENCE, _STRUCTURES, _SITE (the arrival:
  //              gate, perimeter, monument, car park, staff, track keep-out)
  //   ARENA_*    src/city/arena_fights.js + arena_venue.js — ARENA_FIGHTS,
  //              _SOLID_PROPS, _VENUE_V2, _CROWD_PROXY, _LIGHT_RIG, _JUMBOTRON,
  //              _SITE (the arrival: drivable causeway + its road record,
  //              perimeter, gate, monument, car park, service yard, staff)
  //   BLD_*      src/city/buildings_civic.js — _MASONRY_V1, _MASONRY_TEXTURE,
  //              _CIVIC_LOTS_V1, _CIVIC_PODIUM, _ROOF_CLUTTER_V1, _WEATHERING_V1
  //   RENDER_*   src/core/renderer.js — _TONEMAP_V1, _GRADE_V1, _HEIGHT_FOG_V1,
  //              _FOG_GRADE_V1, _EXPOSURE, _FOG_HEIGHT, _FOG_FLOOR
  //   GFX_*      src/core/gfx.js, lights.js, materials.js, textures_surface.js,
  //              sky.js — _BOUNCE_LIGHT, _SKY_AMBIENT, _SURFACE_TEX(_RES/_ANISO),
  //              _PBR_MATERIALS, _ROAD_DETAIL, _WORLD_PBR, _WORLD_DETAIL,
  //              _CONTACT_AO, _ENV_WORLD, _AUTO_EXPOSURE, _TIGHT_SHADOWS,
  //              _DETAIL_SCALE, _DETAIL_STRENGTH, _SUN_GLARE
  //   DETAIL_*   src/world/detail_kit.js — _WORLD_V1 (master), _DENSITY (the
  //              single knob if the dressing pass ever feels heavy),
  //              _UTILITY_LINES, _STREET_FURNITURE, _GROUND_GRIME,
  //              _BUILDING_DRESS
  //   PARKOUR_V2 src/systems/physics.js — the traversal pass that added going
  //              THROUGH an opening (a shot-out window, a C4 mousehole) instead
  //              of only over the top, velocity-matched vault root motion, the
  //              edge catch, the airborne pose and the landing/roll beat.
  //              ?cfg_PARKOUR_V2=0 restores the shipped vault exactly and is
  //              the "before" side of tools/visual-presets/parkour-moves.mjs
})();
