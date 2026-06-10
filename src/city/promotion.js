/* ============================================================
   city/promotion.js — underworld rank ladder.

   Kills, gang kills, boss takedowns, takeovers, turf claims and hard crashes
   feed one visible "kill your way to the top" progression track. It wraps the
   existing city.addKill path so old kill routes keep working.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const RANKS = [
    { xp: 0, title: "Nobody", perk: "unknown" },
    { xp: 45, title: "Stickup Kid", perk: "street crews notice you" },
    { xp: 130, title: "Enforcer", perk: "crew gets tougher" },
    { xp: 285, title: "Lieutenant", perk: "gang orders carry more weight" },
    { xp: 520, title: "Shot Caller", perk: "takeovers pay out harder" },
    { xp: 860, title: "Boss", perk: "crew arms up faster" },
    { xp: 1320, title: "Kingpin", perk: "top of the city" },
  ];

  function rankIndex(xp) {
    let idx = 0;
    for (let i = 1; i < RANKS.length; i++) if (xp >= RANKS[i].xp) idx = i;
    return idx;
  }
  function state() {
    const xp = Math.max(0, g.cityStreetXp || 0);
    const idx = rankIndex(xp), cur = RANKS[idx], next = RANKS[idx + 1] || null;
    return {
      xp, index: idx, title: cur.title, perk: cur.perk,
      nextTitle: next ? next.title : null,
      nextXp: next ? next.xp : null,
      progress: next ? Math.max(0, Math.min(1, (xp - cur.xp) / (next.xp - cur.xp))) : 1,
    };
  }
  // The "kill your way to the top" street-rank ladder is RETIRED. Progression
  // now comes from gang membership + completing gang tasks/contracts, not body
  // count. We return null so the HUD rank chip null-guards and self-hides.
  CBZ.cityStreetRank = function () { return null; };
  void state; // kept for shape; no longer surfaced to the HUD

  function applyCrewPerks(idx) {
    if (!CBZ.cityPlayerGangMembers) return;
    const mem = CBZ.cityPlayerGangMembers();
    for (let i = 0; i < mem.length; i++) {
      const m = mem[i]; if (!m || m.dead) continue;
      const hp = 150 + idx * 18 + (m.rank === "lt" ? 36 : 0);
      m.maxHp = Math.max(m.maxHp || 0, hp);
      m.hp = Math.max(m.hp || 1, Math.min(m.maxHp, (m.hp || 1) + idx * 4));
      if (idx >= 4 && (!m.weapon || m.weapon === "Pistol") && Math.random() < 0.35) m.weapon = "SMG";
      if (idx >= 5 && m.rank === "lt" && m.weapon !== "Rifle" && Math.random() < 0.45) m.weapon = "Rifle";
      if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(m);
    }
  }

  // The street-XP ladder is retired: progression comes from gang membership +
  // contracts, not body count. grant() is kept as a harmless no-op shim so any
  // remaining caller / wrap doesn't crash — it banks NOTHING, shows no PROMOTED
  // banner and plays no rank-up jingle.
  function grant(amount, reason, data) {
    void amount; void reason; void data; void applyCrewPerks;
    return state();
  }
  CBZ.cityGrantStreetXp = grant;

  // cityRankEvent STILL FIRES on every kill — playergang.js wraps it to credit
  // gang-membership work (a body put in for the crew you ride with) — but it no
  // longer grants any STREET XP. Random violence (kills, cop kills, gang kills,
  // boss kills, armed marks, crashes, takeovers, turf, promotions) advances
  // NOTHING here; rank now comes from membership + completing gang tasks. We
  // keep the function defined and returning state() so callers/wraps don't crash.
  CBZ.cityRankEvent = function (type, data) {
    data = data || {};
    // still tally boss kills (read elsewhere as a stat), just grant no XP for it.
    if (type === "kill" && data.boss) g.cityBossKills = (g.cityBossKills || 0) + 1;
    return state();
  };

  function wrapAddKill() {
    if (!CBZ.city || !CBZ.city.addKill || CBZ.city._streetRankKillWrapped) return;
    const old = CBZ.city.addKill;
    CBZ.city.addKill = function () {
      const before = g.kills || 0;
      const r = old.apply(this, arguments);
      if ((g.kills || 0) > before) {
        const detail = g._cityKillDetail || {};
        g._cityKillDetail = null;
        if (CBZ.cityRankEvent) CBZ.cityRankEvent("kill", detail);
      }
      return r;
    };
    CBZ.city._streetRankKillWrapped = true;
  }
  wrapAddKill();

  CBZ.cityPromotionReset = function () {
    g.cityStreetXp = 0;
    g.cityStreetRankIdx = 0;
    g.cityBossKills = 0;
    g._cityKillDetail = null;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  };
})();
