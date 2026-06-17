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
  const HEAVY = { SMG: 1, Carbine: 1, Rifle: 1, Shotgun: 1, "AK-47": 1, LMG: 1, Sniper: 1, Bazooka: 1, "Rocket Launcher": 1 };

  // money is power, but quietly: visible wealth (the watch, the coat) reads in
  // tiers — a plain civilian spans Lv.1-8 on the coat alone.
  function wealthLvl(w) { return w >= 0.985 ? 7 : w >= 0.88 ? 5 : w >= 0.7 ? 3 : w >= 0.5 ? 1 : 0; }

  // ---- the one read: any actor → integer level (1..100) -------------------
  CBZ.cityLevel = function (a) {
    if (!a) return 1;
    if (a.isPlayer) return playerLevel();
    if (a.kind === "cop") return a.swat ? 35 : 20;      // trained, armed, backed by the state
    if (a.kind === "security") return 14;               // uniform + sidearm, no cavalry
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
  // archetype vocabulary that actually exists (peds.js / economy.js casting).
  const ARCH_TITLE = {
    dealer: "Dealer", mobster: "Mobster", made: "Made Man", boss: "Mob Boss",
    tycoon: "Tycoon", billionaire: "Magnate", socialite: "Socialite", heiress: "Heiress",
  };
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

  CBZ.cityTitle = function (a) {
    if (!a) return "Civilian";
    if (a.isPlayer) return ladderTitle(playerLevel());
    if (a.vipTitle) return a.vipTitle;                  // vips.js: Magnate / Don / Senator...
    if (a.kind === "cop") return a.swat ? "SWAT" : "Officer"; // SWAT stays an acronym — "Swat" reads like a typo
    if (a.kind === "security") return "Security";
    if (a.rampage) return "Maniac";                     // mid-snap, nothing else matters
    if (a.bounty > 0) return BOUNTY_TITLE[a.bountyTag] || "Wanted";
    if (a.gang) {
      if (CBZ.cityRankName && a.rank) {
        const pip = CBZ.cityRankName(a.rank);
        if (pip) return titleCase(pip);                 // "Lt." → "Lt.", "boss" → "Boss"
      }
      return RANK_TITLE[a.rank] || "Soldier";
    }
    const t = ARCH_TITLE[a.archetype];
    if (t) return t;
    // plain civilians still read: the eyes, the temper, the coat.
    if ((a.aggr || 0) >= 0.88) return "Psycho";
    if ((a.aggr || 0) >= 0.72) return "Crook";
    if ((a.wealth || 0) >= 0.88) return "Old Money";
    return "Civilian";
  };

  // ---- tag colour: the read keeps its allegiances --------------------------
  // PERF: gang colours are fixed config — resolve the hex string ONCE per gang
  // id instead of a .find() + string build per gang ped per 0.33s sweep.
  const _gangCol = {};
  function colorFor(a) {
    if (a.kind === "cop") return "#8fc1ff";
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
    const lvl = CBZ.cityLevel(a), col = colorFor(a), title = CBZ.cityTitle(a);
    if (a._lvlShown === lvl && a._lvlTitle === title && a._lvlCol === col && a._lvlMat === a.tag.material) return;
    const s = CBZ.makeLabelSprite("Lv." + lvl + " " + title, { color: col });
    a.tag.material = s.material;
    a._lvlShown = lvl; a._lvlTitle = title; a._lvlCol = col; a._lvlMat = s.material;
  }

  // ---- the slow sweep + your own HUD readout -------------------------------
  let sweepT = 0, hudT = 0, lvlEl = null, lvlShown = -1;
  CBZ.onUpdate(35.5, function (dt) {
    if (g.mode !== "city") return;
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
