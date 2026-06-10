/* ============================================================
   city/level.js — THE STREET READS YOU: "LEVEL N" floats over every head.

   WHY a level instead of a name
   -----------------------------
   In a real city you size people up in a glance — the walk, the watch, the
   bulge under the jacket, who's standing behind them. Names tell you nothing
   (you learn a name by TALKING to someone — interact.js still shows it).
   The LEVEL is that street-read made legible: ONE number that compresses
   everything the world already tracks about a person. It is NEVER stored or
   ground out — it is DERIVED, live, from real state, so "why is he level 14?"
   always has an answer: he's a strapped gang lieutenant with bodies on him.

   What the number feeds (the level is information, not decoration):
     • sizeup.js  — NPCs compare levels before swinging: outclassed peds fold
       (hands up / run), peers fight, crews rally. Team fights read like life.
     • respect    — dropping someone ABOVE you earns real respect; stomping a
       level-1 busker impresses nobody (mode.js addKill → cityKillRespect).
     • robbery    — wealth raises a level, so the number doubles as a mark-
       finder: a HIGH level that isn't armed and isn't gang-coloured is a
       walking payday. Reading the street correctly = the robbery skill.

   Perf note: makeLabelSprite caches materials by (text|color), so "LEVEL 3"
   is ONE shared texture across every level-3 ped — far cheaper than the old
   one-unique-name-texture-per-ped. Swapping a tag = swapping a material ref.
   ============================================================ */
(function () {
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // gang ladder → how heavy a rank reads on the street (gangs.js rank keys)
  const RANK_LVL = { prospect: 1, lookout: 1, runner: 2, soldier: 3, enforcer: 5, lt: 7, boss: 10, kin: 2 };
  // long guns read scarier than a pocket pistol
  const HEAVY = { SMG: 1, Carbine: 1, Rifle: 1, Shotgun: 1, AK: 1, Bazooka: 1 };

  // money is power, but quietly: visible wealth (the watch, the coat) reads in tiers
  function wealthLvl(w) { return w >= 0.985 ? 6 : w >= 0.88 ? 4 : w >= 0.7 ? 2 : w >= 0.5 ? 1 : 0; }

  // ---- the one read: any actor → integer level ----------------------------
  CBZ.cityLevel = function (a) {
    if (!a) return 1;
    if (a.isPlayer) return playerLevel();
    if (a.kind === "cop") return a.swat ? 14 : 8;       // trained, armed, backed by the state
    if (a.kind === "security") return 6;                // uniform + sidearm, no cavalry
    let lvl = 1 + wealthLvl(a.wealth || 0);
    if (a.armed) lvl += a.weapon && HEAVY[a.weapon] ? 3 : 2;
    else if (a.weapon) lvl += 1;                        // bat / blade tucked away
    if (a.gang) lvl += RANK_LVL[a.rank] || 2;
    if (a.gstat) lvl += Math.min(6, a.gstat.bodies | 0); // bodies follow a person around
    if (a.bounty > 0) lvl += a.bounty >= 1000000 ? 9 : 5; // a price on your head IS a read
    if ((a.aggr || 0) >= 0.88) lvl += 2;                // the crazy eyes
    if (a.rampage) lvl += 4;
    if (a.companion || a.recruited) lvl += 1;           // runs with somebody
    return Math.max(1, Math.min(40, Math.round(lvl)));
  };

  // your own read: the same physics applied to YOU — net worth, the gun on
  // your hip, the crew at your back, the bodies, the stars. Show off = walk
  // a high number through a street of LEVEL 1s.
  function playerLevel() {
    const econ = CBZ.cityEcon;
    let lvl = 1;
    const nw = econ && econ.netWorth ? econ.netWorth() : (g.cash || 0);
    lvl += nw >= 5e6 ? 8 : nw >= 1e6 ? 6 : nw >= 2e5 ? 4 : nw >= 5e4 ? 3 : nw >= 1e4 ? 2 : nw >= 2e3 ? 1 : 0;
    if (CBZ.cityHasGun && CBZ.cityHasGun()) {
      const n = CBZ.cityCurrentWeaponName ? CBZ.cityCurrentWeaponName() : "";
      lvl += HEAVY[n] ? 3 : 2;
    }
    lvl += Math.min(6, ((g.kills | 0) / 4) | 0);
    lvl += Math.min(6, Math.ceil((g.cityCrew | 0) / 2));
    if (g.playerGang) lvl += 4;                                    // you run your own crew
    else if (g.cityMembership) lvl += RANK_LVL[g.cityMembership.rank] || 1;
    lvl += Math.min(5, ((g.respect | 0) / 25) | 0);
    lvl += g.wanted | 0;                                           // infamy reads too
    return Math.max(1, Math.min(40, Math.round(lvl)));
  }
  CBZ.cityPlayerLevel = playerLevel;

  // ---- tag colour: the read keeps its allegiances --------------------------
  function colorFor(a) {
    if (a.kind === "cop") return "#8fc1ff";
    if (a.bounty > 0) return "#ff6a5e";                 // wanted blood-red
    if (a.gang && CBZ.CITY && CBZ.CITY.gangs) {
      const def = CBZ.CITY.gangs.find((x) => x.id === a.gang);
      if (def) return "#" + ("000000" + ((def.color >>> 0).toString(16))).slice(-6);
    }
    if (a.companion || a.recruited) return "#7ed957";   // yours
    return "#eef4ff";
  }

  // swap a tag's material to the cached LEVEL label. Other systems (gangs.js
  // rank re-tags, bounty prefixes) still create NAME sprites — this loop
  // self-heals them back to LEVEL within a tick because the material ref no
  // longer matches. The sprite OBJECT is never replaced, so every existing
  // reference (peds.js distance gate, playergang, turf) keeps working.
  function retag(a) {
    if (!a || !a.tag || a.dead) return;
    const lvl = CBZ.cityLevel(a), col = colorFor(a);
    if (a._lvlShown === lvl && a._lvlCol === col && a._lvlMat === a.tag.material) return;
    const s = CBZ.makeLabelSprite("LEVEL " + lvl, { color: col });
    a.tag.material = s.material;
    a._lvlShown = lvl; a._lvlCol = col; a._lvlMat = s.material;
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
        if (pl !== lvlShown) { lvlShown = pl; lvlEl.textContent = "LEVEL " + pl; }
      }
    }
  });
})();
