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
  CBZ.cityStreetRank = state;

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

  function grant(amount, reason, data) {
    amount = Math.max(0, Math.round(amount || 0));
    if (!amount) return state();
    const before = state();
    g.cityStreetXp = Math.max(0, (g.cityStreetXp || 0) + amount);
    const after = state();
    g.cityStreetRankIdx = after.index;
    if (after.index > before.index) {
      applyCrewPerks(after.index);
      if (CBZ.city) {
        CBZ.city.big("PROMOTED: " + after.title);
        CBZ.city.note(after.perk + " · +" + amount + " rank XP" + (reason ? " from " + reason : ""), 3);
        CBZ.city.addRespect && CBZ.city.addRespect(5 + after.index * 2);
      }
      if (CBZ.sfx) CBZ.sfx("win");
    } else if (data && data.loud && CBZ.city) {
      CBZ.city.note("+" + amount + " rank XP" + (reason ? " · " + reason : ""), 1.6);
    }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return after;
  }
  CBZ.cityGrantStreetXp = grant;

  CBZ.cityRankEvent = function (type, data) {
    data = data || {};
    if (type === "kill") {
      let xp = 16, reason = "kill";
      if (data.cop) { xp += 44; reason = "cop kill"; }
      if (data.gang) { xp += 22; reason = "gang kill"; }
      if (data.boss) {
        xp += 170; reason = "boss kill";
        g.cityBossKills = (g.cityBossKills || 0) + 1;
      }
      if (data.armed) xp += 8;
      return grant(xp, reason, { loud: !!(data.boss || data.gang) });
    }
    if (type === "takeover") return grant(190 + ((data.defected || 0) * 12), "takeover", { loud: true });
    if (type === "gang-founded") return grant(85, "founding a gang", { loud: true });
    if (type === "turf") return grant(42, "claiming turf", { loud: true });
    if (type === "promote") return grant(28, "promoting crew", { loud: false });
    if (type === "crash") {
      if (!data.hard && !data.catastrophic) return state();
      return grant(data.catastrophic ? 32 : 12, data.wall ? "hard crash" : "car crash", { loud: !!data.catastrophic });
    }
    return grant(data.amount || 0, type || "street work", data);
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
