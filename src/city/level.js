/* ============================================================
   city/level.js — THE STREET READS YOU: "Lv.3 Crook" floats over every head.

   WHY a title + a level instead of a name
   ---------------------------------------
   In a real city you size people up in a glance — the walk, the watch, the
   bulge under the jacket, who's standing behind them. Names tell you nothing
   (you learn a name by TALKING to someone — interact.js still shows it).
   The tag is that street-read made legible in TWO beats: the TITLE says WHAT
   someone is (Officer, Dealer, Mob Boss, Old Money), the NUMBER says how
   heavy. Both are NEVER stored or ground out — they are DERIVED, live, from
   real state, so "why does he read Lv.57 Enforcer?" always has an answer:
   he's a strapped gang enforcer with bodies on him.

   WHY the scale runs 1→100 (not 1→40): the GAP is the show-off. "Lv.4 vs
   Lv.62" reads like two different universes — a civilian is single digits,
   a strapped crook is teens, a cop is 20, SWAT 35, gang brass 60-90, and
   only a maxed kingpin walks the street at 100. The pairing is the whole
   robbery/respect game at a glance: "Lv.8 Old Money" unarmed = a payday;
   "Lv.35 SWAT" = a wall; dropping a "Lv.85 Mob Boss" = a story.

   What the number feeds (the level is information, not decoration):
     • sizeup.js  — NPCs compare levels before swinging: outclassed peds fold
       (hands up / run), peers fight, crews rally. Team fights read like life.
     • respect    — dropping someone ABOVE you earns real respect; stomping a
       Lv.1 busker impresses nobody (mode.js addKill → cityKillRespect).
     • robbery    — wealth raises a level, so the number doubles as a mark-
       finder: a HIGH level that isn't armed and isn't gang-coloured is a
       walking payday. Reading the street correctly = the robbery skill.

   Perf note: makeLabelSprite caches materials by (text|color), so "Lv.3 Crook"
   is ONE shared texture across every level-3 crook — far cheaper than the old
   one-unique-name-texture-per-ped. Swapping a tag = swapping a material ref.
   Titles come from a small FIXED vocabulary (~25 strings) and each title only
   occupies its own band of the 1-100 range, so the cache stays bounded:
   ~25 titles × the levels actually seen × a handful of allegiance colours.
   ============================================================ */
(function () {
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // gang ladder → how heavy a rank reads on the street (gangs.js rank keys).
  // Brass IS the number: an enforcer outreads any cop, a boss outreads SWAT —
  // because on this block the state isn't the biggest gang.
  // boss caps at 66 so even a decked-out don reads ~90s — Lv.100 is the summit
  // only a maxed PLAYER kingpin walks at.
  const RANK_LVL = { prospect: 13, lookout: 13, runner: 17, soldier: 25, enforcer: 44, lt: 50, boss: 66, kin: 15 };
  // long guns read scarier than a pocket pistol (names from combat.js/gangs.js)
  const HEAVY = { SMG: 1, Carbine: 1, Rifle: 1, Shotgun: 1, "AK-47": 1, LMG: 1, Sniper: 1, Bazooka: 1, "Rocket Launcher": 1, "Grenade Launcher": 1 };

  // money is power, but quietly: visible wealth (the watch, the coat) reads in
  // tiers — a plain civilian spans Lv.1-8 on the coat alone.
  function wealthLvl(w) { return w >= 0.985 ? 7 : w >= 0.88 ? 5 : w >= 0.7 ? 3 : w >= 0.5 ? 1 : 0; }

  // MILITARY rank — the man in fatigues with an AK reads by his STRIPES, same
  // as a cop reads by his shield. WHY: a soldier-costumed ped used to fall all
  // the way through to "Civilian" (he isn't a cop, gang, or archetype) — but a
  // uniform + a rifle is the loudest read on the street. peds.js stamps a rank
  // (a unit is a PYRAMID: a sea of privates, a thin officer corps, a rare
  // general) so the same trooper always reads the same. Distinct from the GANG
  // "Soldier" rank (which hangs off a.gang) and the player's street ladder —
  // those are untouched. Brass reads HEAVY: a sergeant outreads a beat cop, a
  // captain outreads SWAT, a general walks near kingpin air.
  const MIL_NAME = { private: "Private", corporal: "Corporal", sergeant: "Sergeant", lieutenant: "Lieutenant", captain: "Captain", major: "Major", colonel: "Colonel", general: "General" };
  const MIL_LVL  = { private: 15, corporal: 20, sergeant: 27, lieutenant: 36, captain: 45, major: 55, colonel: 67, general: 85 };
  function milRankOf(a) {
    if (a.milRank && MIL_NAME[a.milRank]) return a.milRank;        // the stamped rank (peds.js)
    if (a.job && /soldier|military|marine/i.test(a.job)) return "private"; // costumed but unstamped → green grunt
    return null;
  }

  // POLICE RANK — the READ side only, and deliberately so. OWNER (2026-07-27):
  // "different levels in orgs etc etc — roles can be greatly expanded." A
  // soldier reads by his stripes; a cop was ONE word for the whole force
  // (police.js has exactly one boolean, `swat`, in 3058 lines).
  //
  // THERE IS NO PRODUCER FOR `copRank` YET, ON PURPOSE. police.js is outside
  // this change's territory, and inventing a rank here that only changes a pill
  // would be precisely the vanity ladder CLAUDE.md forbids — "every rung must
  // unlock a VERB, not just a bigger number". So this is the receiving end,
  // waiting for one line in police.js, and `roleAudit().emptyRanks` reports
  // every unheld rung as the outstanding debt rather than letting it hide. An
  // unstamped officer reads "Officer" exactly as before, so nothing regresses.
  const COP_NAME = { patrol: "Officer", corporal: "Corporal", sergeant: "Sergeant", lieutenant: "Lieutenant", captain: "Captain", chief: "Chief" };
  const COP_LVL  = { patrol: 20, corporal: 24, sergeant: 29, lieutenant: 37, captain: 46, chief: 62 };

  // ---- the one read: any actor → integer level (1..100) -------------------
  // THE NUMBER LIES WITH THE TITLE. OWNER: "there can be fake level and role."
  // A Lv.72 operative presenting as a Lv.9 clerk has to READ as 9 — otherwise
  // the number gives away everything the title was hiding, and the cover is
  // decoration. Same viewer default as cityTitle; same no-op for the ~100% of
  // actors carrying no cover. (Defined below this function; JS hoists them.)
  CBZ.cityLevel = function (a, viewer) {
    if (!a) return 1;
    { const cl = CBZ.cityCoverLevel && CBZ.cityCoverLevel(a, viewer); if (cl) return cl; }
    if (a.isPlayer) return playerLevel();
    if (a.kind === "cop") return a.swat ? 35 : (COP_LVL[a.copRank] || 20); // trained, armed, backed by the state
    if (a.kind === "security") return 14;               // uniform + sidearm, no cavalry
    { const mr = milRankOf(a); if (mr) return MIL_LVL[mr] || 15; }   // the stripes ARE the read
    let lvl = 1 + wealthLvl(a.wealth || 0);
    if (a.armed) lvl += a.weapon && HEAVY[a.weapon] ? 12 : 9; // a gun jumps a civilian into the teens
    else if (a.weapon) lvl += 3;                        // bat / blade tucked away
    if (a.gang) lvl += RANK_LVL[a.rank] || 17;
    if (a.gstat) lvl += Math.min(12, (a.gstat.bodies | 0) * 2); // bodies follow a person around
    if (a.bounty > 0) lvl += a.bounty >= 1000000 ? 23 : 12; // a price on your head IS a read
    if ((a.aggr || 0) >= 0.88) lvl += 4;                // the crazy eyes
    if (a.rampage) lvl += 10;
    if (a.companion || a.recruited) lvl += 3;           // runs with somebody
    if (a.vipLvl) lvl = Math.max(lvl, a.vipLvl);        // vips.js: the whale's read IS the read
    return Math.max(1, Math.min(100, Math.round(lvl)));
  };

  // your own read: the same physics applied to YOU — net worth, the gun on
  // your hip, the crew at your back, the bodies, the stars. Show off = walk
  // Lv.100 through a street of single digits. Every term has real headroom
  // because the CLIMB is the game: broke nobody → strapped hustler → kingpin.
  function playerLevel() {
    const econ = CBZ.cityEcon;
    let lvl = 1;
    const nw = econ && econ.netWorth ? econ.netWorth() : (g.cash || 0);
    lvl += nw >= 5e6 ? 25 : nw >= 1e6 ? 18 : nw >= 2e5 ? 12 : nw >= 5e4 ? 8 : nw >= 1e4 ? 5 : nw >= 2e3 ? 2 : 0;
    if (CBZ.cityHasGun && CBZ.cityHasGun()) {
      const n = CBZ.cityCurrentWeaponName ? CBZ.cityCurrentWeaponName() : "";
      lvl += HEAVY[n] ? 12 : 9;
    }
    lvl += Math.min(15, ((g.kills | 0) / 2) | 0);
    lvl += Math.min(15, (g.cityCrew | 0) * 2);
    if (g.playerGang) lvl += 35;                                   // you run your own set
    else if (g.cityMembership) lvl += Math.min(30, RANK_LVL[g.cityMembership.rank] || 13); // borrowed colors never outread your own flag
    lvl += Math.min(10, ((g.respect | 0) / 25) | 0);
    lvl += (g.wanted | 0) * 2;                                     // infamy reads too
    // a PRICE on your head reads heavy on the street — same as it does for an NPC
    // bounty above (wealthLvl/HEAVY). Scales gently to the top of the band; this is
    // an infamy input (PROG owns g.cityBounty in wanted.js) and zeroes on death, so
    // the title visibly drops when you go down. Never lowers the level.
    const bty = g.cityBounty || 0;
    if (bty > 0) lvl += bty >= 50000 ? 8 : bty >= 10000 ? 5 : bty >= 2000 ? 3 : 1;
    return Math.max(1, Math.min(100, Math.round(lvl)));
  }
  CBZ.cityPlayerLevel = playerLevel;

  // ---- the street TITLE: what the number is attached to --------------------
  // Same physics as the level: derived from real state, never stored. Every
  // string is in-world (what a local would mutter, not a stat sheet) and the
  // vocabulary is FIXED so the label-material cache stays small. Title Case —
  // a tag is a read, not a shout.
  function titleCase(s) { return String(s).toLowerCase().replace(/(^|[\s\-'])\S/g, (c) => c.toUpperCase()); }
  // bountyTag strings come from peds.js rollBounty — map them to one-word reads.
  const BOUNTY_TITLE = { "WANTED TERRORIST": "Terrorist", "ARMED & DANGEROUS": "Gunman", FUGITIVE: "Fugitive", WANTED: "Wanted" };
  // gangs.js rank keys → spoken rank, used only if CBZ.cityRankName isn't loaded.
  const RANK_TITLE = { prospect: "Prospect", lookout: "Lookout", runner: "Runner", soldier: "Soldier", enforcer: "Enforcer", lt: "Lieutenant", boss: "Boss" };
  // ============================================================
  //  THE ROLE VOCABULARY — "CIVILIAN ISN'T A ROLE."
  //
  //  OWNER DOCTRINE (2026-07-27, verbatim): "there's roles 'the kid' 'in
  //  between jobs' — deeply look at roles and npc behavior and what's dumb …
  //  civilian isn't a role but tourist can be. homeless person should just be
  //  title bum. hustler is a title."
  //
  //  He is drawing a real distinction and it is the spine of this file:
  //
  //    A ROLE is something a person DOES (a job), BELONGS TO (an org and a
  //    rank in it), or IS in a way the simulation can act on (a condition —
  //    a bum, a tourist, a kid, an addict).
  //
  //    "Civilian", "in between jobs", "the kid" and "looking for work" are
  //    none of those. They are the ABSENCE of a role. An NPC whose title is a
  //    shrug is an NPC with no reason to exist, and the honest response to one
  //    is NOT to print a nicer shrug — it is to treat it as a CASTING BUG and
  //    give the person a job. That is why `retag` below calls
  //    CBZ.cityDealRole(): the pill never apologises, the caster gets fixed.
  //
  //  Three tables, in the order the read resolves:
  //    NO_ROLE   — strings that are a STATE, never a title. Routed to recast.
  //    JOB_TITLE — the free-form `job` strings this codebase actually produces,
  //                normalised to a street noun ("panhandling" -> Bum,
  //                "slinging" -> Dealer). A gerund is not a role.
  //    ARCH_TITLE— the archetype vocabulary, for people whose archetype IS the
  //                most specific true thing about them.
  //  Evidence: CBZ.roleAudit() at the bottom. `roleless` and `shrugs` may only
  //  ever go DOWN.
  // ============================================================

  // (1) NOT ROLES. Every one of these was a live title before this change.
  //     Each maps to WHY it is not a role, for the next person who wants to
  //     re-add one. The value is unused — the KEY is the law.
  const NO_ROLE = {
    "between jobs": 1,           // crowd.js resetToPlain — the owner's example
    "in between jobs": 1,
    "looking for work": 1,       // childhood.js grow-up — a state, not a trade
    "unemployed": 1,
    "the kid": 1,                // births.js — an AGE, handled as a condition
    "out on the town": 1,        // peds.js night recast — an evening, not a job
    "in for the night": 1,       // peds.js night recast — likewise
    "cinematic": 1,              // cinematics.js — a STAGE DIRECTION leaking to the HUD
    "family": 1,                 // occupy.js — a relation
    "staff": 1,                  // occupy.js — "staff" of what?
    "crew": 1,                   // playergang.js — the gang rank is the real read
    "passenger": 1,              // npclife.js — where they are, not who they are
    "civilian": 1, "resident": 1, "villager": 1, "none": 1,
  };

  // (2) THE JOB -> STREET TITLE MAP. Left column is every job string this
  //     codebase can actually produce whose raw text does not already read as
  //     a title; right column is what a local would call them.
  const JOB_TITLE = {
    // --- conditions the world writes as an activity (gerunds are not roles)
    "panhandling": "Bum",                 // OWNER: "homeless person should just be title bum"
    "slinging": "Dealer",
    "working an angle": "Hustler",        // OWNER: "hustler is a title"
    "chasing a fix": "Addict",
    "drifter": "Drifter",
    // --- the trades the owner named, plus the ones his "etc etc" implies
    "cab driver": "Taxi Driver", "taxi driver": "Taxi Driver",
    "cashier": "Cashier", "cage cashier": "Cashier", "retail worker": "Cashier",
    "shopkeeper": "Shopkeeper", "street vendor": "Vendor", "vendor": "Vendor",
    "flight attendant": "Flight Attendant",
    "pilot": "Captain", "co-pilot": "First Officer", "first officer": "First Officer",
    "boxer": "Boxer", "fighter": "Boxer",
    "serial killer": "Serial Killer",
    "terrorist": "Terrorist", "terror attacker": "Terrorist",
    "contract killer": "Hitman", "hitman": "Hitman",
    "intelligence agent": "Agent", "field agent": "Agent", "secret service": "Agent",
    "dictator": "Dictator", "politician": "Politician", "candidate": "Candidate",
    "rebel leader": "Rebel Leader", "central bank governor": "Governor",
    "official": "Official", "commanding officer": "Commanding Officer",
    // --- the wilds and the water (the "who works here" holes)
    "hunter": "Hunter", "trapper": "Trapper", "fisherman": "Fisherman",
    "deckhand": "Deckhand", "yacht captain": "Captain", "harbourmaster": "Harbourmaster",
    "dockhand": "Dockhand", "yard hand": "Yard Hand", "yacht broker": "Broker",
    "park ranger": "Ranger", "ranger": "Ranger", "logger": "Logger",
    "farmer": "Farmer", "farmhand": "Farmhand", "rancher": "Rancher",
    "ski instructor": "Ski Instructor", "ski patrol": "Ski Patrol",
    "hiker": "Hiker", "skier": "Skier", "biker": "Biker", "gambler": "Gambler",
    // --- the household. A mansion with nobody in it but guards is a stage set.
    "servant": "Servant", "housekeeper": "Housekeeper", "butler": "Butler",
    "groundskeeper": "Groundskeeper", "chauffeur": "Chauffeur", "cook": "Cook",
    "estate cook": "Cook", "nanny": "Nanny", "valet": "Valet",
    // --- protection: A GUARD IS POSTED TO A PLACE, A BODYGUARD TO A PERSON.
    //     They are different roles because they are different SYSTEMS —
    //     security.js posts the first, power.js attaches the second.
    "security guard": "Security Guard", "private security": "Security Guard",
    "guard": "Security Guard",
    "close protection": "Bodyguard", "bodyguard": "Bodyguard",
    "doorman": "Doorman", "bouncer": "Bouncer",
    // --- everything else the city already casts, normalised
    "office worker": "Office Worker", "accountant": "Accountant",
    "receptionist": "Receptionist", "executive": "Executive", "boss": "Boss",
    "construction worker": "Builder", "dock worker": "Dock Worker",
    "warehouse worker": "Warehouse Worker", "line cook": "Cook",
    "delivery driver": "Courier", "courier": "Courier",
    "personal trainer": "Trainer", "barber": "Barber", "mechanic": "Mechanic",
    "bartender": "Bartender", "waiter": "Waiter", "croupier": "Croupier",
    "pit boss": "Pit Boss", "high roller": "High Roller", "patron": "Patron",
    "nurse": "Nurse", "doctor": "Doctor", "paramedic": "Paramedic",
    "firefighter": "Firefighter", "sheriff's deputy": "Deputy",
    "soldier": "Soldier", "soldier on leave": "Soldier",
    "ground crew": "Ground Crew", "gate agent": "Gate Agent",
    "pit crew": "Pit Crew", "track marshal": "Marshal", "pro racer": "Racer",
    "student": "Student", "immigrant": "Immigrant", "former cop": "Ex-Cop",
    "club member": "Club Member", "liveaboard": "Liveaboard",
    "venue worker": "Venue Worker", "traveller": "Tourist", "traveler": "Tourist",
    "tourist": "Tourist", "race fan": "Race Fan", "fight fan": "Fight Fan",
    "spectator": "Spectator", "enforcer": "Enforcer", "lieutenant": "Lieutenant",
    "criminal": "Crook", "gang boss": "Boss", "foreign noble": "Noble",
  };

  // (3) archetype vocabulary that actually exists (peds.js / economy.js casting).
  //     EXTENDED: the old table covered 8 of the ~30 archetypes the game casts,
  //     so a hustler, a tweaker, a laborer and a thug all fell through to the
  //     personality guess and read "Civilian". "resident"/"civilian" are
  //     deliberately ABSENT — they are the shrug, and they route to the recast.
  const ARCH_TITLE = {
    dealer: "Dealer", mobster: "Mobster", made: "Made Man", boss: "Mob Boss",
    tycoon: "Tycoon", billionaire: "Magnate", socialite: "Socialite", heiress: "Heiress",
    hustler: "Hustler",                 // OWNER: "hustler is a title"
    vagrant: "Bum",                     // OWNER: "homeless person should just be title bum"
    tweaker: "Addict", thug: "Thug", gangster: "Gangster", hitman: "Hitman",
    official: "Official", exec: "Executive", merchant: "Vendor",
    security: "Security Guard", military: "Soldier", soldier: "Soldier",
    racer: "Racer", fan: "Spectator", nightlife: "Partygoer",
    royal: "Royal", noble: "Noble", laborer: "Laborer", professional: "Professional",
    worker: "Worker", tourist: "Tourist", terrorist: "Terrorist",
  };

  // A real occupation is a NOUN PHRASE. Flavour prose ("owns half the skyline",
  // "famous for being famous", "founder of Vantage Systems") is a CHARACTER
  // NOTE the dossier may print — it is not a thing to float over a head.
  const PROSE_HEAD = /^(the|a|an|in|out|on|at|between|looking|chasing|working|running|runs|owns|holds|famous|makes|keeps)\b/i;
  // "driver for Scuderia" / "founder of Vantage" / "heir to Vantage": the HEAD is
  // the role, the tail is which one. Keep the head, drop the tail.
  const HEAD_OK = { driver: "Driver", founder: "Founder", heir: "Heir", captain: "Captain", head: "Boss", chief: "Chief" };

  function jobTitle(job) {
    if (!job) return null;
    const j = String(job).trim().toLowerCase();
    if (!j || NO_ROLE[j]) return null;
    const mapped = JOB_TITLE[j];
    if (mapped) return mapped;
    // "deputy mayor" / "deputy governor" — officialdom.js composes these.
    if (j.indexOf("deputy ") === 0) return titleCase(j);
    const cut = j.match(/^([a-z' -]+?)\s+(?:of|for|to)\b/);
    if (cut) return HEAD_OK[cut[1]] || null;
    if (PROSE_HEAD.test(j)) return null;
    if (j.split(/\s+/).length > 3) return null;        // a sentence, not a trade
    return titleCase(j);
  }
  CBZ.cityJobTitle = jobTitle;      // peds.js / dossier read the same normaliser

  // ---- CONDITIONS: not a job, not an org, but a real thing to be. ----------
  // Ordered most-specific first. Each one is acted on by a live system, which
  // is what separates a condition from a shrug: vagrant -> the night hunt
  // (peds.js) + cop move-along, child -> childsafe.js's protection, tourist ->
  // the mark economy, addict -> aigoals' needs layer.
  function condTitle(a) {
    if (a.vagrant || a.archetype === "vagrant") return "Bum";
    if (a.child || a.band === "child" || a.band === "infant" || a.band === "teen" ||
        a.job === "the kid" || a._role === "kid" || a.famRole === "the kid") {
      // school age DOES something; a toddler is simply a kid.
      const yrs = a.ageYears;
      return (yrs != null && yrs < 5) ? "Kid" : "Student";
    }
    if (a.drugUser || a.archetype === "tweaker") return "Addict";
    if (a.archetype === "tourist" || a._role === "tourist") return "Tourist";
    return null;
  }
  // YOUR name on the street is earned by the same number everyone else reads —
  // climb the ladder by getting richer, deadlier, better-backed. Bands match
  // the 1-100 world: Crook = strapped-civilian range, Enforcer = gang-brass
  // range, Kingpin = the air only a maxed player breathes.
  const LADDER = [[5, "Nobody"], [12, "Crook"], [20, "Hustler"], [35, "Soldier"], [50, "Enforcer"], [65, "Shot Caller"], [85, "Mob Boss"]];
  function ladderTitle(n) {
    for (let i = 0; i < LADDER.length; i++) if (n <= LADDER[i][0]) return LADDER[i][1];
    return "Kingpin";
  }
  CBZ.cityPlayerTitle = function () { return ladderTitle(playerLevel()); };

  // ---- THE ONE READ: actor -> {title, kind} --------------------------------
  // `kind` is what the title IS, and it is the field roleAudit counts:
  //   "org"       — an allegiance with a rank in it (cop, soldier, gang, faction)
  //   "job"       — a trade the person works
  //   "condition" — bum / tourist / kid / addict: not employment, but real
  //   "status"    — a transient the street reads louder than either (maniac,
  //                 wanted, principal). Still a role; still not a shrug.
  //   null        — NOBODY. A casting bug. Never rendered — see cityTitle.
  const _r = { title: "", kind: null };
  function roleOf(a) {
    _r.title = ""; _r.kind = null;
    if (!a) return _r;
    if (a.isPlayer) { _r.title = ladderTitle(playerLevel()); _r.kind = "status"; return _r; }
    if (a.vipTitle) { _r.title = a.vipTitle; _r.kind = "org"; return _r; }   // vips.js: Magnate / Don / Senator...
    // A PRINCIPAL's role is the most specific true thing about them (city/
    // power.js: "Cartel Head", "Mayor", "CEO"). Guard-called so this file has
    // no dependency on the protection layer being present.
    if (CBZ.powerRoleOf) { const pr = CBZ.powerRoleOf(a); if (pr) { _r.title = pr; _r.kind = "org"; return _r; } }
    if (a.kind === "cop") {
      // POLICE IS AN ORG WITH RUNGS, not one word. copRank is stamped by
      // police.js the same way peds.js stamps milRank; an unstamped officer
      // still reads "Officer", so this can never regress a cop to a shrug.
      _r.kind = "org";
      if (a.swat) { _r.title = "SWAT"; return _r; }     // SWAT stays an acronym — "Swat" reads like a typo
      _r.title = (a.copRank && COP_NAME[a.copRank]) || "Officer";
      return _r;
    }
    if (a.kind === "security") {
      // POSTED TO A PLACE vs ATTACHED TO A PERSON — two systems, two roles.
      _r.kind = "job";
      _r.title = (a.job === "close protection" || a.bodyguard || a._principal) ? "Bodyguard" : "Security Guard";
      return _r;
    }
    { const mr = milRankOf(a); if (mr) { _r.title = MIL_NAME[mr] || "Private"; _r.kind = "org"; return _r; } }
    if (a.rampage) { _r.title = "Maniac"; _r.kind = "status"; return _r; }   // mid-snap, nothing else matters
    if (a.bounty > 0) { _r.title = BOUNTY_TITLE[a.bountyTag] || "Wanted"; _r.kind = "status"; return _r; }
    if (a.gang) {
      _r.kind = "org";
      if (CBZ.cityRankName && a.rank) {
        const pip = CBZ.cityRankName(a.rank);
        if (pip) { _r.title = titleCase(pip); return _r; }  // "Lt." → "Lt.", "boss" → "Boss"
      }
      _r.title = RANK_TITLE[a.rank] || "Soldier";
      return _r;
    }
    // THE JOB IS THE ROLE (see the long note on cityTitle below), normalised
    // through jobTitle so a GERUND or a flavour sentence can never reach a pill.
    { const jt = jobTitle(a.job); if (jt) { _r.title = jt; _r.kind = "job"; return _r; } }
    // A CONDITION outranks an archetype: "Bum" is more true than "Vagrant",
    // and a child is a child before they are a resident.
    { const ct = condTitle(a); if (ct) { _r.title = ct; _r.kind = "condition"; return _r; } }
    { const t = ARCH_TITLE[a.archetype]; if (t) { _r.title = t; _r.kind = "job"; return _r; } }
    // NO ROLE. Deliberately NOT a title. The old code ended here with
    // "Psycho"/"Crook"/"Old Money"/"Civilian" — four filler strings that let a
    // casting bug look like a design choice. Now the caller has to deal with it.
    return _r;
  }
  // public, non-aliasing copy (roleOf reuses one object per frame by design)
  CBZ.cityRole = function (a) { const r = roleOf(a); return { title: r.title, kind: r.kind }; };

  // ============================================================
  //  §COVER. A DISPLAYED ROLE IS A CLAIM, NOT A FACT.
  //
  //  OWNER (2026-07-27, verbatim): "nobody would have role agent, they would
  //  have whatever role the agent puts... they would have role agent if you
  //  joined their agency! we already have logic for stealing others clothes,
  //  that's a huge thing now once there are roles that are actually being done
  //  — there can be fake level and role but actually agents."
  //
  //  He is correcting a real mistake I shipped an hour ago: I made "Agent" a
  //  VISIBLE title. An intelligence officer whose pill says Agent is not an
  //  intelligence officer — his entire job is that he reads as an accountant.
  //  The same is true of an undercover cop, a plant in a crew, and the player
  //  in a stolen uniform.
  //
  //  So every actor has TWO roles and this file had been conflating them:
  //
  //    TRUE role      roleOf() — what the SIMULATION acts on. Never lies.
  //    PRESENTED role what the observer is entitled to see. This is the pill.
  //
  //  For ~everybody they are identical and `_cover` is null, which is exactly
  //  why this is cheap: one null check on a path that already runs.
  //
  //  WHO IS LOOKING DECIDES WHAT IS SHOWN — "they would have role agent IF YOU
  //  JOINED THEIR AGENCY". That is not a new system: factions.js's
  //  `tier(orgId)` is already THE membership query and already answers "am I
  //  inside, and how far". So the reveal is a RANK TEST against the org the
  //  actor truly serves, with partial reveals by tier (a recruit learns only
  //  that this is one of ours; brass gets the name and the posting).
  //
  //  AND THE LEVEL LIES TOO. He said "fake level and role" — both. A Lv.72
  //  operative presenting as a Lv.9 clerk must READ as Lv.9, or the number
  //  gives away everything the title was hiding. cityLevel is cityTitle's
  //  sibling and gets identical treatment.
  //
  //  A cover has exactly three ways to fail, and every one of them is
  //  observable — which is the stat-fiction test applied to secrecy. A cover
  //  nobody could ever see through would be a fiction, and roleAudit() reports
  //  any that exist as `unseeable`.
  //    (1) INSIDE KNOWLEDGE — you joined the org (factions.tier >= seeTier).
  //    (2) IT BURNS — an event blows it (a cop clocks your face; the killer
  //        commits; a witness watches you strip the body). `burnT`.
  //    (3) IT IS DROPPED — the actor stops presenting (takes the uniform off).
  // ============================================================
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.CITY_COVER_ROLES == null) CBZ.CONFIG.CITY_COVER_ROLES = true;
  function coverOn() { return CBZ.CONFIG.CITY_COVER_ROLES !== false; }

  // Declare (or clear) what an actor PRESENTS as.
  //   role   — the title to show outsiders ("Accountant")
  //   lvl    — the level to show outsiders (null = derive a plausible one)
  //   org    — the org whose members can see through it (null = only a burn can)
  //   seeTier— the tier inside that org that gets the FULL truth (default 3)
  // Degrade-safe: with the flag off, or org/factions absent, the cover simply
  // never resolves and everybody reads their true role exactly as today.
  CBZ.citySetCover = function (a, cov) {
    if (!a) return false;
    if (!cov) { a._cover = null; a._lvlTitle = null; return true; }
    a._cover = {
      role: cov.role || null, lvl: cov.lvl != null ? cov.lvl : null,
      org: cov.org || null, seeTier: cov.seeTier != null ? cov.seeTier : 3,
      burnT: 0,
    };
    a._lvlTitle = null;                       // force retag on the next sweep
    return true;
  };
  // BURN a cover. `secs` 0/absent = permanent (the serial killer, once seen).
  CBZ.cityBurnCover = function (a, secs) {
    if (!a || !a._cover) return false;
    const now = (CBZ.now || 0);
    a._cover.burnT = secs > 0 ? (now + secs * 1000) : Infinity;
    a._lvlTitle = null;
    return true;
  };
  function coverLive(a) {
    if (!coverOn()) return null;
    const c = a && a._cover;
    if (!c || !c.role) return null;
    if (c.burnT && (c.burnT === Infinity || (CBZ.now || 0) < c.burnT)) return null;  // blown
    return c;
  }

  // THE ONE PLACE THE REVEAL RULE LIVES. Returns:
  //   2 = full truth (an insider at rank, or the cover is blown/absent)
  //   1 = partial — "one of ours", but not who
  //   0 = the cover holds; you see the claim
  // `viewer` omitted means THE PLAYER, because every existing call site
  // (the overhead pill, the dossier, the subtitle) is asking on the player's
  // behalf. An omniscient default would have made this whole feature inert.
  function seeThrough(a, viewer) {
    const c = coverLive(a);
    if (!c) return 2;
    const isPlayer = (viewer === undefined || viewer === null) ||
      viewer === CBZ.player || viewer === (CBZ.city && CBZ.city.playerActor) || (viewer && viewer.isPlayer);
    if (!isPlayer) {
      // NPC-on-NPC: an actor in the SAME org sees its own. Cheap and rare.
      if (!c.org || !viewer) return 0;
      if (viewer.gang && ("gang:" + viewer.gang) === c.org) return 2;
      if (viewer.kind === "cop" && c.org === "police") return 2;
      return 0;
    }
    if (!c.org) return 0;                     // only a burn opens this one
    // (1) INSIDE KNOWLEDGE. factions.js is THE membership query — never
    // re-derive one (CLAUDE.md: "never re-derive g.playerGang again").
    let tier = -1;
    if (CBZ.factions && CBZ.factions.tier) { try { tier = CBZ.factions.tier(c.org); } catch (e) { tier = -1; } }
    if (tier == null) tier = -1;
    // the concrete-gang form: you fly their colours as a member.
    if (tier < 0 && c.org.indexOf("gang:") === 0 && CBZ.game && CBZ.game.cityMembership) {
      const m = CBZ.game.cityMembership;
      if (m && ("gang:" + m.gang) === c.org) tier = 1;
    }
    if (tier >= c.seeTier) return 2;
    if (tier >= 0) return 1;                  // you are inside, but not brass
    return 0;
  }
  CBZ.citySeesThrough = function (a, viewer) { return seeThrough(a, viewer) >= 2; };
  CBZ.citySeeLevel = seeThrough;              // the graded answer, for partial reveals

  // WHAT THE SIM ACTS ON. Never covered, never viewer-dependent. Anything
  // making a DECISION about an actor (AI, damage, factions, contracts) reads
  // this; anything DISPLAYING one reads cityTitle.
  CBZ.cityTrueRole = function (a) { const r = roleOf(a); return { title: r.title, kind: r.kind }; };
  // the covered LEVEL, or 0 meaning "no cover applies — compute it for real".
  // A cover with no declared lvl derives a PLAUSIBLE one from the presented
  // role rather than inventing a number: a clerk reads like a clerk (single
  // digits), so the cover cannot be spotted by the tag being suspiciously round.
  CBZ.cityCoverLevel = function (a, viewer) {
    const c = coverLive(a);
    if (!c || seeThrough(a, viewer) >= 2) return 0;
    if (c.lvl != null) return Math.max(1, Math.min(100, c.lvl | 0));
    const w = a.wealth || 0.4;
    return Math.max(1, Math.min(12, 2 + Math.round(w * 7)));
  };
  // THE TRUE level, for anything making a decision (sizeup.js, respect, the
  // predator prey-scale). Display reads cityLevel; the sim reads this.
  CBZ.cityTrueLevel = function (a) {
    if (!a || !a._cover) return CBZ.cityLevel(a);
    const c = a._cover; a._cover = null;
    const v = CBZ.cityLevel(a); a._cover = c;
    return v;
  };

  // THE PRESENTED ROLE. `viewer` is optional and defaults to the player, so
  // every existing one-argument call site keeps working byte-for-byte — and for
  // an actor with no cover (which is almost all of them) this is the same two
  // lines it always was.
  CBZ.cityTitle = function (a, viewer) {
    if (!a) return "Person";
    const c = coverLive(a);
    if (c) {
      const see = seeThrough(a, viewer);
      if (see === 0) return c.role;                       // you see the claim
      if (see === 1) {                                    // inside, but not brass
        const t = roleOf(a).title;
        return t ? ("⟨" + t + "⟩" ) : c.role;             // marked as a known plant
      }
    }
    const r = roleOf(a);
    if (r.title) return r.title;
    // ROLELESS. Ask the caster to cast them — peds.js owns the vocabulary and
    // the deterministic draw, and the job it deals routes to a real workplace
    // in aigoals.js's CITY_JOBS, so the repair is a LIFE, not a label. Guarded
    // + degrade-safe: without peds.js loaded we still never print "Civilian",
    // because "Civilian" is the bug, not the fallback.
    if (CBZ.cityDealRole) {
      try { if (CBZ.cityDealRole(a)) { const r2 = roleOf(a); if (r2.title) return r2.title; } } catch (e) {}
    }
    // last resort, and it is still not a shrug: the aggr/wealth read is a real
    // observation about a person, it just is not an occupation.
    if ((a.aggr || 0) >= 0.88) return "Psycho";
    if ((a.aggr || 0) >= 0.72) return "Crook";
    if ((a.wealth || 0) >= 0.88) return "Old Money";
    return "Drifter";                                   // never "Civilian"
  };

  // WHY THE JOB IS THE ROLE (kept from the change that added the `a.job` rung —
  // it is the doctrine this whole file now rests on). OWNER: "above [the] pilot
  // should say 'Lv.X Pilot' — and not because [of] hardcoding, because NPCs
  // should show role and level, role should be what they actually do."
  //
  // That was a disagreement between two readouts of the same person: the
  // DOSSIER (aim_dossier.js) read `a.job` — the field peds.js has always filled
  // with the real occupation — while the overhead PILL never looked at it and
  // fell through to a personality guess off aggr/wealth. So the airline captain
  // sitting in his own cockpit read as "Civilian".
  //
  // Letting the job speak was necessary and not sufficient: `job` is FREE-FORM
  // PROSE in this codebase. Fixing the pill without fixing the vocabulary just
  // moved the shrug — the pill then read "Lv.2 Panhandling", "Lv.3 Between
  // Jobs", "Lv.1 The Kid", "Lv.4 Cinematic" and "Lv.61 Owns Half The Skyline".
  // jobTitle() above is the missing half: a gerund, a stage direction and a
  // flavour sentence are all REJECTED, and the person is recast instead.

  // ---- tag colour: the read keeps its allegiances --------------------------
  // PERF: gang colours are fixed config — resolve the hex string ONCE per gang
  // id instead of a .find() + string build per gang ped per 0.33s sweep.
  const _gangCol = {};
  function colorFor(a) {
    // THE COLOUR LEAKS AS LOUDLY AS THE TITLE. A covered plant whose pill said
    // "Accountant" but whose tag glowed cop-blue or crew-purple would be
    // spotted from across the street — the allegiance colour IS an allegiance
    // readout. If you cannot see through the cover you get the neutral tag a
    // stranger gets. (powerRoleOf/vipTitle sit ABOVE the job rung in the title
    // chain, and this sits outside all of it, so a principal's cover is
    // covered here too rather than only at the job rung.)
    if (CBZ.citySeesThrough && !CBZ.citySeesThrough(a)) return "#eef4ff";
    if (a.kind === "cop") return "#8fc1ff";
    if (milRankOf(a)) return "#b3c489";                 // olive — a uniformed faction reads in its colour, like the cops' blue
    if (a.bounty > 0) return "#ff6a5e";                 // wanted blood-red
    if (a.gang) {
      let c = _gangCol[a.gang];
      if (c === undefined && CBZ.CITY && CBZ.CITY.gangs) {
        c = null;
        const defs = CBZ.CITY.gangs;
        for (let i = 0; i < defs.length; i++) if (defs[i].id === a.gang) { c = "#" + ("000000" + ((defs[i].color >>> 0).toString(16))).slice(-6); break; }
        _gangCol[a.gang] = c;
      }
      if (c) return c;
    }
    if (a.companion || a.recruited) return "#7ed957";   // yours
    return "#eef4ff";
  }

  // swap a tag's material to the cached "Lv.N Title" label. Other systems
  // (gangs.js rank re-tags, bounty prefixes) still create NAME sprites — this
  // loop self-heals them back within a tick because the material ref no
  // longer matches. The sprite OBJECT is never replaced, so every existing
  // reference (peds.js distance gate, playergang, turf) keeps working.
  function retag(a) {
    if (!a || !a.tag || a.dead) return;
    // SELF-HEALING CAST. cityTitle() calls cityDealRole() on anybody who comes
    // back roleless, so this 0.33s sweep is also the thing that repairs the
    // cast — every person the player can see acquires a real job within a third
    // of a second of being looked at, and roleAudit().roleless walks to 0
    // during play instead of needing a spawner audit.
    //
    // The same sweep stamps a COVER on anyone whose true role is one people
    // hide (peds.js owns that vocabulary). It must run BEFORE the reads below,
    // or an agent would flash his real title for one sweep before going dark.
    if (CBZ.cityEnsureCover && !a._coverDone) { try { CBZ.cityEnsureCover(a); } catch (e) {} }
    const lvl = CBZ.cityLevel(a), col = colorFor(a), title = CBZ.cityTitle(a);
    if (a._lvlShown === lvl && a._lvlTitle === title && a._lvlCol === col && a._lvlMat === a.tag.material) return;
    const s = CBZ.makeLabelSprite("Lv." + lvl + " " + title, { color: col });
    a.tag.material = s.material;
    a._lvlShown = lvl; a._lvlTitle = title; a._lvlCol = col; a._lvlMat = s.material;
  }

  // ============================================================
  //  CBZ.roleAudit() — THE RATCHET (BLOCK LAW #5).
  //
  //  "Civilian isn't a role" is aspirational until it is a NUMBER. This walks
  //  every live person in the world and reports:
  //     peds     — how many people were examined
  //     roled    — how many have a job, an allegiance or a real condition
  //     roleless — how many resolve to NOTHING (a casting bug). PIN AT 0.
  //     shrugs   — how many still land on the aggr/wealth last resort. PIN AT 0.
  //     titles   — the full histogram, so a title nobody ever holds shows up as
  //                the stat fiction it is
  //     orgs     — "different levels in orgs" as a measurement: per org, the
  //                member count and the holders of each RUNG. A rank with zero
  //                holders in a built world is a stat fiction and CLAUDE.md
  //                bans it by name — it is reported as `emptyRanks`.
  //
  //  Note the audit deliberately does NOT call cityTitle(), because cityTitle
  //  REPAIRS. Measuring through the repair would report 0 forever and measure
  //  nothing — the same mistake as an audit nobody has run.
  // ============================================================
  function everyone() {
    const out = [];
    const push = (arr) => { if (arr) for (let i = 0; i < arr.length; i++) { const p = arr[i]; if (p && !p.dead && !p.isPlayer && !p._parked) out.push(p); } };
    push(CBZ.cityPeds); push(CBZ.cityCops);
    return out;
  }
  CBZ.roleAudit = function () {
    const all = everyone();
    const titles = Object.create(null), kinds = { org: 0, job: 0, condition: 0, status: 0 };
    const orgs = Object.create(null);
    let roled = 0, roleless = 0, shrugs = 0;
    const SHRUG = { Psycho: 1, Crook: 1, "Old Money": 1, Drifter: 1, Civilian: 1 };
    function org(id, rank) {
      const o = orgs[id] || (orgs[id] = { members: 0, byRank: Object.create(null) });
      o.members++;
      const k = rank || "—";
      o.byRank[k] = (o.byRank[k] | 0) + 1;
    }
    // §COVER census. `covered` = actors presenting a role that is not their
    // true one. `unseeable` is the STAT-FICTION TEST applied to secrecy: a
    // cover with no org to see through it AND no way to burn it would be a
    // secret that can never be discovered, which is a fiction by this repo's
    // own rule. (The serial killer has no org but IS burnable — he commits in
    // front of you — so he is correctly excluded.)
    let covered = 0, unseeable = 0;
    const coverOrgs = Object.create(null);
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      const cv = a._cover;
      if (cv && cv.role) {
        covered++;
        coverOrgs[cv.org || "(burn-only)"] = (coverOrgs[cv.org || "(burn-only)"] | 0) + 1;
        if (!cv.org && !a._burnable && !a._killer) unseeable++;
      }
      const r = roleOf(a);
      if (r.title) {
        roled++; kinds[r.kind] = (kinds[r.kind] | 0) + 1;
        titles[r.title] = (titles[r.title] | 0) + 1;
        if (SHRUG[r.title]) shrugs++;
      } else roleless++;
      // org membership, read off the fields the world already keeps
      if (a.kind === "cop") org("police", a.swat ? "swat" : (a.copRank || "patrol"));
      else if (milRankOf(a)) org("army", milRankOf(a));
      // BOTH the concrete set AND the "gang" archetype factions.js declares —
      // otherwise the declared org reads zero members and every one of its
      // rungs reports empty, which would be the audit lying about itself.
      else if (a.gang) { org("gang:" + a.gang, a.rank || "prospect"); org("gang", a.rank || "prospect"); }
      else if (a.kind === "security") org("security", a.job === "close protection" ? "bodyguard" : "guard");
    }
    // declared-but-unheld rungs: the stat-fiction test, applied to ladders.
    const empty = [];
    const ladders = { police: COP_NAME, army: MIL_NAME };
    for (const id in ladders) {
      const o = orgs[id]; const tbl = ladders[id];
      for (const k in tbl) if (!o || !o.byRank[k]) empty.push(id + ":" + k);
    }
    // factions.js is the ONE place an org is declared — read its roster rather
    // than re-deriving one (CLAUDE.md: never re-derive g.playerGang again).
    if (CBZ.factions && CBZ.factions.ids) {
      try {
        const ids = CBZ.factions.ids() || [];
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          const o = orgs[id] || (orgs[id] = { members: 0, byRank: Object.create(null) });
          const keys = CBZ.factions.ladderKeys ? (CBZ.factions.ladderKeys(id) || []) : [];
          const d = CBZ.factions.def ? CBZ.factions.def(id) : null;
          o.declared = keys.length;
          o.name = (d && d.name) || id;
          o.playerRank = CBZ.factions.rank ? CBZ.factions.rank(id) : null;
          // a DECLARED rung with no holder anywhere is the stat fiction test
          // applied to ladders. NPC-tagged orgs only: a player-only ladder
          // (agency/cell/campaign) legitimately has no street holders.
          if (d && d.npcTag) for (let k = 0; k < keys.length; k++) if (!o.byRank[keys[k]]) empty.push(id + ":" + keys[k]);
        }
      } catch (e) {}
    }
    // ...and the PLAYER's own claim. "whether the player currently reads as
    // something they are not" — the disguise, and whether it is holding.
    let disguise = null;
    if (CBZ.cityDisguise) {
      try {
        const d = CBZ.cityDisguise();
        if (d) disguise = { readsAs: d.role, org: d.org, holding: !!d.trusted };
      } catch (e) {}
    }
    return { peds: all.length, roled: roled, roleless: roleless, shrugs: shrugs,
             kinds: kinds, titles: titles, orgs: orgs, emptyRanks: empty,
             covered: covered, coverOrgs: coverOrgs, unseeable: unseeable,
             disguise: disguise };
  };

  // ---- the slow sweep + your own HUD readout -------------------------------
  let sweepT = 0, hudT = 0, lvlEl = null, lvlShown = -1;
  CBZ.onUpdate(35.5, function (dt) {
    if (g.mode !== "city") return;
    if (CBZ.cityCampaignActive && CBZ.cityCampaignActive()) {
      const peds = CBZ.cityPeds || [], cops = CBZ.cityCops || [];
      for (let i = 0; i < peds.length; i++) if (peds[i] && peds[i].tag) peds[i].tag.visible = false;
      for (let i = 0; i < cops.length; i++) if (cops[i] && cops[i].tag) cops[i].tag.visible = false;
      return;
    }
    sweepT -= dt;
    if (sweepT <= 0) {
      sweepT = 0.33;                                   // levels shift (gun drawn, rank up) — keep the read honest
      const peds = CBZ.cityPeds || [], cops = CBZ.cityCops || [];
      for (let i = 0; i < peds.length; i++) retag(peds[i]);
      for (let i = 0; i < cops.length; i++) retag(cops[i]);
    }
    hudT -= dt;
    if (hudT <= 0) {
      hudT = 0.5;
      if (!lvlEl) lvlEl = document.getElementById("cLvl");
      if (lvlEl) {
        const pl = playerLevel();
        // ladderTitle is a pure function of pl, so the level compare covers both.
        if (pl !== lvlShown) { lvlShown = pl; lvlEl.textContent = "Lv." + pl + " " + ladderTitle(pl); }
      }
    }
  });
})();
