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
    northYard:  { x0: -30, x1: 30, z0: -8,  z1: 52 },   // original yard (kept intact)
    southBlock: { x0: -44, x1: 44, z0: 52,  z1: 128 },  // new, wider lower complex
    exit: { x: 0, z: 128, gap: 4 },                     // freedom gate at the far south
    // overall extents used by the actor clamp + minimap (a touch of margin)
    minX: -46, maxX: 46, minZ: -45, maxZ: 131,
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
    pacifist:     { label: "Pacifist",    emoji: "🕊️", init: 0.00, retaliate: 0.05, fleeHurt: 0.92, picksWeak: 0.0, guts: 0.08, desc: "Won't throw a punch — runs from any trouble." },
    defensive:    { label: "Defensive",   emoji: "🛡️", init: 0.02, retaliate: 0.97, fleeHurt: 0.20, picksWeak: 0.0, guts: 0.70, desc: "Never starts it — but finishes whoever does." },
    protector:    { label: "Protector",   emoji: "🤝", init: 0.07, retaliate: 0.95, fleeHurt: 0.12, picksWeak: 0.0, guts: 0.85, desc: "Wades in to defend friends and underdogs." },
    opportunist:  { label: "Opportunist", emoji: "🎲", init: 0.12, retaliate: 0.62, fleeHurt: 0.55, picksWeak: 0.95, guts: 0.40, desc: "Only swings when the fight's already won." },
    hothead:      { label: "Hothead",     emoji: "🔥", init: 0.30, retaliate: 0.92, fleeHurt: 0.18, picksWeak: 0.15, guts: 0.78, desc: "Quick to rage, slow to think it through." },
    bully:        { label: "Bully",       emoji: "😈", init: 0.24, retaliate: 0.55, fleeHurt: 0.60, picksWeak: 1.0, guts: 0.45, desc: "Hunts the weak, folds against the strong." },
    predator:     { label: "Predator",    emoji: "🦈", init: 0.42, retaliate: 0.97, fleeHurt: 0.05, picksWeak: 0.55, guts: 0.96, desc: "Looks for a fight and rarely backs down." },
    unpredictable:{ label: "Wildcard",    emoji: "🌀", init: 0.18, retaliate: 0.60, fleeHurt: 0.40, picksWeak: 0.30, guts: 0.50, desc: "Nobody — including them — knows what's next." },
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
  CBZ.JAIL_CROWD = typeof CBZ.JAIL_CROWD === "number" ? CBZ.JAIL_CROWD : 14;
  CBZ.MASS_CROWD = typeof CBZ.MASS_CROWD === "number" ? CBZ.MASS_CROWD : 140;
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
    playerSpawn: "airport",
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
      { id: "sky",       name: "Skyline Aerie",      rent: 0,  price: 80000,  sqft: 4200,  garage: 3, tier: 4, blurb: "A glass perch over downtown — the city laid out below you." },
      { id: "spire",     name: "The Spire",          rent: 0,  price: 180000, sqft: 11000, garage: 6, tier: 5, elevator: true, blurb: "A tower yours top to bottom: a wraparound parking deck on the ground, glass on every wall, and one colossal loft filling the sky." },
      // ---- TASK 1: the apex home. The mega-tower PENTHOUSE — the most expensive,
      // flagship address in the city. It isn't just a place to sleep: a missile
      // HELICOPTER comes parked on its rooftop HELIPAD (free with the home), and a
      // deck HANGAR can be bought to base an F-22 Raptor (Phase 3). buildings.js
      // builds the mega-tower and tags this exact tier (id "penthouse", the one
      // flagship) onto lot.building.home; realestate.js + zillow.js sell it and
      // set g.cityOwnsPenthouse / g.cityOwnsHeli on the buy. The hangar is a
      // separate big-ticket add-on (priced below; charged in realestate.js).
      { id: "penthouse", name: "The Apex Penthouse", rent: 0,  price: 750000, sqft: 24000, garage: 8, tier: 6, elevator: true, flagship: true, helipad: true, hangarPrice: 1200000, blurb: "The crown of the skyline: the city's tallest mega-tower, yours alone. A wraparound sky-deck garage, a glass loft that floats above downtown, and your own rooftop HELIPAD — a missile helicopter parked and ready. Buy the deck HANGAR to base a fighter jet." },
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
  // BRIDGE WALL RULES: causeway guardrails + curb fall-guard colliders are
  // GAPPED wherever the deck crosses a registered road, so bridge walls only
  // exist over real water/gap spans — never across intersections/mouths.
  if (CBZ.CONFIG.BRIDGE_WALL_RULES == null) CBZ.CONFIG.BRIDGE_WALL_RULES = true;
  // Highway deck streetlights (the owner called them dumb): default OFF —
  // real highways here run unlit; flip true to restore the old 40m poles.
  if (CBZ.CONFIG.HWY_LAMPS == null) CBZ.CONFIG.HWY_LAMPS = false;
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
  if (CBZ.CONFIG.CONTINENT_COUNTRY_MARGIN == null) CBZ.CONFIG.CONTINENT_COUNTRY_MARGIN = 1200;
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
  // DYNAMIC WEATHER (systems/weather.js). Default OFF: the pooled rain Points
  // cloud read as bright white dots stuck to the HUD, and because weather ticks
  // globally it also appeared inside jail. Flip true (or ?cfg_DYNAMIC_WEATHER=1)
  // to restore rain, storm fog, lightning and wet-road grip as one coherent set.
  if (CBZ.CONFIG.DYNAMIC_WEATHER == null) CBZ.CONFIG.DYNAMIC_WEATHER = false;
  // Sandbox/testing is the default: start directly at the configured city
  // spawn (Halloran Airport) instead of forcing the helicopter arrest and a
  // jail chapter on every fresh run. The complete authored campaign remains
  // available by setting this flag true before Play.
  if (CBZ.CONFIG.CITY_HITMAN_CAMPAIGN == null) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
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
  // STREET TALK V2: every civilian is YES / NO / PUNCH. Offer math uses level
  // gap + max cash they can spare. Flip false to restore the crowded verb menu.
  if (CBZ.CONFIG.STREET_TALK_V2 == null) CBZ.CONFIG.STREET_TALK_V2 = true;
  // BADWORDS: dialogue uses {{TOKEN}} placeholders resolved from badwords.env.
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
  // CRAFTING (systems/craft.js) — owner's call: crafting is dead. Default OFF;
  // the [C] panel won't open and craft()/canCraft() refuse. CBZ.craft.itemStore
  // stays live (buildmode/baseclaim placement costs read it). Flip true to
  // re-enable the whole system in one line.
  if (CBZ.CONFIG.CRAFTING_ENABLED == null) CBZ.CONFIG.CRAFTING_ENABLED = false;

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
  // AMBIENT AIR TRAFFIC (city/airtraffic.js): a handful of deterministic
  // civilian aircraft (GA prop planes + a light heli) orbiting the city on
  // stacked altitude bands, banking into their turns. Pure atmosphere — no
  // colliders, no weapons, no wanted interaction. Flip false to clear the sky.
  if (CBZ.CONFIG.AIR_TRAFFIC_AMBIENT == null) CBZ.CONFIG.AIR_TRAFFIC_AMBIENT = true;
  // REAL COCKPIT DOOR (city/island_airport.js): the airliner cockpit becomes
  // a room you physically enter — the bulkhead gets a genuine doorway with a
  // sliding pocket-door leaf that eases open as you approach (elevator
  // grammar), the boarding doorway becomes a true hull aperture you can see
  // through from both sides, the walkable cabin deck extends into the
  // cockpit, and the captain's chair seats a live uniformed pilot NPC.
  // Flip false to restore the painted bulkhead door + solid hull.
  if (CBZ.CONFIG.COCKPIT_REAL_DOOR == null) CBZ.CONFIG.COCKPIT_REAL_DOOR = true;

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

  // Small helper used everywhere for registering frame work. In profiling
  // sessions only, retain the callsite so the benchmark can name anonymous
  // updater functions without adding any normal-game stack-capture overhead.
  const profileFrameWork = typeof location !== "undefined" && /(?:\?|&)profile=1(?:&|$)/.test(location.search || "");
  function frameSource() {
    if (!profileFrameWork) return "";
    const stack = (new Error()).stack || "";
    const lines = stack.split("\n");
    for (let i = 2; i < lines.length; i++) {
      // Script cachebusters appear in stacks as file.js?v=tag:line:col.
      const m = lines[i].match(/(src\/[^:?)]+\.js)(?:\?[^:)\s]+)?:(\d+)/);
      if (m && m[1] !== "src/config.js") return m[1] + ":" + m[2];
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
})();
