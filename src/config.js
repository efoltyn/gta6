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

  // ---- player tuning ----
  CBZ.TUNE = {
    walkSpeed: 7.0,     // a touch quicker on foot — reinforces the faster feel
    crouchSpeed: 3.0,   // sneak unchanged (stealth pacing)
    jumpVel: 8.2,
    gravity: 22,
    playerRadius: 0.55,
    camDist: 7.6,       // behind-the-back third-person framing (closer, less zoomed out)
    sens: 0.0024,
  };

  // ---- SURVIVAL mode tuning -----------------------------------------
  // Total lobby = SURV_BOTS bots + you. 99 → "100 alive" like Fortnite.
  // Lower it (e.g. 49) if the framerate suffers on weaker hardware.
  CBZ.SURV_BOTS = 99;
  // Prison population tiers. Named inmates always use the full social/combat
  // brain. JAIL_CROWD adds extra rich rigs; MASS_CROWD adds cheap instanced
  // ambient agents that still move, separate, and react locally.
  CBZ.JAIL_CROWD = typeof CBZ.JAIL_CROWD === "number" ? CBZ.JAIL_CROWD : 36;
  CBZ.MASS_CROWD = typeof CBZ.MASS_CROWD === "number" ? CBZ.MASS_CROWD : 900;
  // Production uses compact GPU points. Set window.CBZ.AB_TEST="A" before
  // load, or press P in overview, only when benchmarking legacy box markers.
  CBZ.AB_TEST = CBZ.AB_TEST === "A" ? "A" : "B";
  CBZ.CROWD_RIG_CAP = typeof CBZ.CROWD_RIG_CAP === "number" ? CBZ.CROWD_RIG_CAP : 1600;
  // Face-rig promotion: how many nearby agents wear a full generated face and
  // from how far they start "generating" (the closest N within range get a rig
  // each frame). Bumped so faces appear SOONER as you approach (less pop-in).
  CBZ.CROWD_FACE_RIGS = typeof CBZ.CROWD_FACE_RIGS === "number" ? CBZ.CROWD_FACE_RIGS : 48;
  CBZ.CROWD_FACE_DIST = typeof CBZ.CROWD_FACE_DIST === "number" ? CBZ.CROWD_FACE_DIST : 42;
  CBZ.SIM_OVERVIEW_BUDGET = typeof CBZ.SIM_OVERVIEW_BUDGET === "number" ? CBZ.SIM_OVERVIEW_BUDGET : 12000;
  CBZ.SURV = {
    arena: { cx: 0, cz: 600, radius: 120 }, // far from the prison; own ground+sun
    playerHpRegen: 0,        // no passive regen — disasters are deadly
    sprintMul: 1.7,
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
    blocks: 6,             // 6×6 grid of city blocks (room for shops + homes + turf)
    block: 34,             // block size (building lot)
    road: 9,               // street width between blocks
    peds: typeof CBZ.CITY_PEDS === "number" ? CBZ.CITY_PEDS : 160,  // render-LOD culls far rigs, so the streets can be busy
    cops: typeof CBZ.CITY_COPS === "number" ? CBZ.CITY_COPS : 0, // spawn on wanted
    ambientCops: typeof CBZ.CITY_AMBIENT_COPS === "number" ? CBZ.CITY_AMBIENT_COPS : 3, // patrols policing NPCs/traffic at 0 stars
    traffic: typeof CBZ.CITY_TRAFFIC === "number" ? CBZ.CITY_TRAFFIC : 66,
    hungerDrain: 0.22,     // hunger lost per second (slow — the real pressure is night/sleep, not starving)
    starveDmg: 2.2,        // hp/s once hunger hits 0
    tireNight: 1.15,       // tiredness/s gained while up & about at deep night
    tireRest: 5.0,         // tiredness/s recovered while resting (sleeping)
    tireExhaustDmg: 1.4,   // hp/s once you're fully exhausted and still awake
    sprintMul: 1.7,
    staminaMax: 100, staminaDrain: 22, staminaRegen: 14,
    // wanted: heat needed to reach each star, and the cop response per star
    starHeat: [0, 110, 300, 650, 1500, 4000],
    heatDecay: 2.2,        // heat bled off per second when unseen

    // ---- world composition: every lot is one of these (buildings.js) -------
    abandonedFrac: 0.26,   // share of buildable lots that are derelict + gang-run
    parkFrac: 0.08,        // share kept as open plazas (breathing room / hangouts)

    // ---- gangs: factions that own the abandoned blocks (city/gangs.js) -----
    gangs: [
      // Real gangs only, real colors, and the authentic People/Folk NATION split
      // (Bloods, Latin Kings, Black P. Stones ride PEOPLE; Crips + Gangster
      // Disciples ride FOLK) — turf.js seeds alliances off `nation`. ids kept
      // stable where they were; names/colors/nation are what the game uses.
      { id: "saints",    name: "Bloods",             color: 0xc0392b, accent: 0x6e1c1c, nation: "people"  }, // red
      { id: "reapers",   name: "Crips",              color: 0x2f6bd6, accent: 0x1a3a6e, nation: "folk"    }, // blue
      { id: "kings",     name: "Latin Kings",        color: 0xe0b020, accent: 0x6e5210, nation: "people"  }, // gold
      { id: "stones",    name: "Black P. Stones",    color: 0x2f9e4f, accent: 0x123d22, nation: "people"  }, // green
      { id: "disciples", name: "Gangster Disciples", color: 0x3a4150, accent: 0x141820, nation: "folk"    }, // charcoal
      { id: "vipers",    name: "Trinitarios",        color: 0x16a8a0, accent: 0x0c3b39, nation: "neutral" }, // teal
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
      lane: 2.2,           // lane-centre offset from a road's centre line
      follow: 8.0,         // car-following gap (m) kept behind the car ahead
      cruise: [7, 12],     // calm cruising speed window
      aggrSpeedMul: 1.7,   // how much faster aggressive drivers push it
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

    // ---- real estate: the property ladder (city/realestate.js) ------------
    // From a rented flophouse to a penthouse with a private garage + elevator.
    // Owned homes are safehouses: heal, save, a money-safe stash, and a garage
    // that stores cars. Rent (rented tiers) + tax (owned) are the money sinks.
    homes: [
      { id: "room",      name: "Rented Room",        rent: 30,  price: 0,     beds: 1, garage: 0, tier: 0 },
      { id: "studio",    name: "Studio Apartment",   rent: 0,   price: 4500,  beds: 1, garage: 0, tier: 1 },
      { id: "apartment", name: "2-Bed Apartment",    rent: 0,   price: 16000, beds: 2, garage: 1, tier: 2 },
      { id: "condo",     name: "Riverside Condo",    rent: 0,   price: 48000, beds: 3, garage: 2, tier: 3 },
      { id: "penthouse", name: "Skyline Penthouse",  rent: 0,   price: 150000,beds: 4, garage: 4, tier: 4, elevator: true },
    ],
    rentTick: 90,          // seconds between rent / property-tax charges
    taxRate: 0.0008,       // owned-home tax per tick as a fraction of its price

    // ---- relationships & family (city/social.js) --------------------------
    social: {
      dateCost: 50,        // a date / gift to build affection
      affectionPerDate: 22,// affection gained per successful date
      partnerAt: 60,       // affection needed before someone is your partner
      marryRing: "Diamond Ring", // the wearable that proposes
      kidnapChance: 0.0,   // set live by social.js when you're hot near a gang
    },
  };

  // small helper used everywhere for registering frame work
  CBZ.onUpdate = function (order, fn) { CBZ.updaters.push({ order, fn }); };
  CBZ.onAlways = function (order, fn) { CBZ.always.push({ order, fn }); };
})();
