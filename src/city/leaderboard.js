/* ============================================================
   city/leaderboard.js - the city power board.

   Tab is not a spreadsheet of fake rivals anymore. It is the street read for
   Gang Life: who owns turf, who leads each crew, who would inherit the throne,
   and which living people are carrying real money or protection right now.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const RANK_TIER = { prospect: 0, lookout: 1, runner: 2, soldier: 3, enforcer: 4, lt: 5, lieutenant: 5, boss: 6 };
  const WHALE_ARCH = { tycoon: 1, billionaire: 1, socialite: 1, heiress: 1, boss: 1, mobster: 1, made: 1 };

  // Fallback only, used while a fresh city is still spawning and no real targets
  // have resolved yet.
  const ROSTER = [
    { name: "Big Sosa", arch: "boss" },
    { name: "Ghost", arch: "enforcer" },
    { name: "Reina", arch: "mogul" },
    { name: "Mr. Cole", arch: "boss" },
    { name: "Mamba", arch: "mogul" },
    { name: "Dontae", arch: "enforcer" },
  ];

  let rivals = [], board = null, simT = 0;
  let _s = 4242;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  function ri(a, b) { return a + ((rng() * (b - a + 1)) | 0); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function fmt(n) {
    n = Math.round(n || 0);
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1) + "k";
    return "" + n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[<>&]/g, function (c) {
      return c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;";
    });
  }
  function hex6(n) { return "#" + ("000000" + ((n >>> 0).toString(16))).slice(-6); }
  function money(n) { return "$" + fmt(n || 0); }

  function itemValue(name) {
    const e = CBZ.cityEcon;
    const it = e && e.ITEMS && e.ITEMS[name];
    return it && it.value ? it.value : 0;
  }
  function valuablesValue(vals) {
    let s = 0;
    if (!vals) return 0;
    for (const v of vals) s += itemValue(v);
    return s;
  }
  function actorLoot(p) {
    return Math.max(0, (p.cash || 0) + valuablesValue(p.valuables) + (p.bounty || 0));
  }
  function levelOf(p) { return CBZ.cityLevel ? CBZ.cityLevel(p) : 1; }
  function titleOf(p) {
    if (CBZ.cityTitle) return CBZ.cityTitle(p);
    return p.vipTitle || (p.rank ? rankName(p.rank) : (p.archetype || "Civilian"));
  }
  function rankName(k) {
    if (CBZ.cityRankName) return CBZ.cityRankName(k);
    return k === "lt" ? "Lt." : k ? k.charAt(0).toUpperCase() + k.slice(1) : "Crew";
  }
  function gangRec(id) { return id && CBZ.cityGangById ? CBZ.cityGangById(id) : null; }
  function gangName(id) { const r = gangRec(id); return (r && r.name) || id || "crew"; }
  function districtOf(p) {
    const e = CBZ.cityEcon;
    if (e && e.districtAt && e.districtName && p && p.pos) return e.districtName(e.districtAt(p.pos.x, p.pos.z));
    return "city";
  }
  function vipProtection(p) {
    const S = CBZ.cityVips;
    if (!S || !S.slots) return 0;
    for (const slot of S.slots) {
      if (!slot || slot.principal !== p) continue;
      let n = 0;
      for (const q of slot.guards || []) if (q && !q.dead) n++;
      for (const q of slot.cops || []) if (q && !q.dead) n++;
      return n;
    }
    return 0;
  }
  function protectionOf(p) {
    if (p.gang) {
      const r = gangRec(p.gang);
      const n = CBZ.cityGangStrength && r ? CBZ.cityGangStrength(r) : (r && r.members ? r.members.length : 0);
      return n + " crew";
    }
    const vp = vipProtection(p);
    if (vp) return vp + " detail";
    if (p.armed) return "armed";
    if ((p.wealth || 0) >= 0.95) return "quiet money";
    return "alone";
  }
  function whyOf(p, loot) {
    if (p.bounty) return "bounty in " + districtOf(p);
    // a PRO RACER (racing.js) reads by their championship standing, not turf. The
    // _racer branch wins over _milli/whale so a racer is never mislabeled a tycoon.
    if (p._racer && CBZ.cityRacing) {
      const r = p._racer;
      const pos = CBZ.cityRacing.positionOf ? CBZ.cityRacing.positionOf(r) : 0;
      return "P" + pos + " in the championship · " + (r.wins || 0) + " wins";
    }
    if (p.gang) return rankName(p.rank) + " of " + gangName(p.gang) + " - " + protectionOf(p);
    if (p.vipTitle) return p.vipTitle + " - " + protectionOf(p);
    if (WHALE_ARCH[p.archetype]) return titleOf(p) + " in " + districtOf(p);
    if (loot >= 10000) return "carrying valuables";
    return "wealthy mark";
  }

  // ---- HALL OF FAME: permanently-dead notables (city/identity.js) ----------
  // gangState()/heirOf() above already solve this for gangs (a dead boss shows
  // a 'succession' row with a named heir instead of the gang just vanishing).
  // This is the same idea for VIPs/tycoons/racers: a kill that used to make a
  // "Magnate"/"Tycoon"/"Racer #N" vanish from the list with no record now
  // leaves a DECEASED row carrying their name, title, and final stats — read
  // entirely from CBZ.cityIdentities (vips.js/millionaires.js stamp p._identityId
  // + finalLevel/finalLoot at death) and CBZ.cityRacing.deceased() (racing.js's
  // own permanence fix, which already tracks retired/dead drivers). Fully
  // feature-detected: a missing identity.js/racing.js export just yields fewer
  // (or zero) Hall of Fame rows, never a crash.
  const HOF_CAP = 6;          // don't let history crowd out the living rich list
  function hofRowFromIdentity(rec) {
    const title = rec.title || (rec.kind === "tycoon" ? "Tycoon" : "VIP");
    return {
      actor: null, name: rec.name || "Unknown", title: title, level: rec.finalLevel || 0,
      loot: rec.finalLoot || 0,
      // scored well below a same-level LIVING whale (×0.35) so the list reads
      // "who's rich and killable NOW" first, history second — but still high
      // enough that a famous kill (high finalLoot/level) ranks above small fry.
      score: ((rec.finalLoot || 0) + (rec.finalLevel || 0) * 1100) * 0.35,
      why: "DECEASED — " + title + (rec.killedAt ? ", killed" : ""), where: "city",
      protection: "none (dead)", you: false, dead: true,
    };
  }
  function deceasedNotables() {
    const out = [];
    const R = CBZ.cityIdentities;
    if (R && R.byKind) {
      const vips = R.byKind("vip").filter(function (r) { return r.status === "dead"; });
      const tycoons = R.byKind("tycoon").filter(function (r) { return r.status === "dead"; });
      for (const rec of vips) out.push(hofRowFromIdentity(rec));
      for (const rec of tycoons) out.push(hofRowFromIdentity(rec));
    }
    const RC = CBZ.cityRacing;
    if (RC && RC.deceased) {
      const dead = RC.deceased();
      for (const racer of dead) {
        const worth = RC.netWorthOf ? RC.netWorthOf(racer) : 0;
        out.push({
          actor: null, name: racer.name, title: "Racer #" + racer.number, level: 0,
          loot: worth,
          score: worth * 0.35 + (racer.wins || 0) * 900 * 0.35,
          why: "DECEASED — Racer #" + racer.number + " · " + (racer.wins || 0) + " career wins", where: "city",
          protection: "none (dead)", you: false, dead: true,
        });
      }
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, HOF_CAP);
  }

  function livePowerTargets() {
    const out = [];
    const peds = CBZ.cityPeds || [];
    for (const p of peds) {
      if (!p || p.dead || p.collected || p.vendor || p.kind === "cop") continue;
      const loot = actorLoot(p);
      const lv = levelOf(p);
      // a PRO RACER is always a high-value row (a famous, rich, killable mark) even
      // if their carried loot is modest — their fame + purse-winnings are the value.
      const racer = p._racer || null;
      const whale = !!(racer || p.vipTitle || p.vipLvl || p.isBoss || p.rank === "boss" || p.rank === "lt" ||
        p.rank === "enforcer" || p.isCompanyOwner || p._milli || p._bilFounder || p.bounty || loot >= 1200 ||
        (p.wealth || 0) >= 0.88 || WHALE_ARCH[p.archetype]);
      if (!whale) continue;
      const prot = protectionOf(p);
      // ECONOMY_V2: rank by REAL NET WORTH (economy.js's role power-law —
      // founders/CEOs/tycoons on top, a racer at their honest purse, workers
      // at the floor). The old formula summed carried cash + level noise + a
      // player-scaled racer purse, which is exactly how one driver ended up
      // "richer" than every tycoon in town. `loot` stays the ROBBABLE take —
      // net worth is what they're WORTH, take is what's in reach on the street.
      const nw = CBZ.cityNetWorthOf ? CBZ.cityNetWorthOf(p)
        : loot + lv * 1100 + (p.vipLvl || 0) * 900 + (p.gang ? 9000 : 0) + (p.bounty || 0);
      const take = loot + ((p._milli && !p._milliShaken) ? (p._milliBag || 0) : 0);
      out.push({
        actor: p, name: p.name || titleOf(p),
        title: (CBZ.cityOccupationOf ? CBZ.cityOccupationOf(p) : (racer ? ("Racer #" + racer.number) : titleOf(p))),
        level: lv,
        loot: take, netWorth: nw,
        score: nw, why: whyOf(p, take) + (take >= 5000 ? " · take ~" + money(take) : ""),
        where: districtOf(p),
        protection: prot, you: false,
      });
    }
    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return b.loot - a.loot;
    });
    return out;
  }
  CBZ.cityPowerTargets = function () { return livePowerTargets().slice(0, 30); };

  function fallbackTargets() {
    return rivals.map(function (r) {
      const loot = r.cash + r.bank + r.props * 14000 + r.crew * 4200;
      return {
        name: r.name, title: r.arch === "mogul" ? "Mogul" : r.arch === "boss" ? "Boss" : "Enforcer",
        level: r.arch === "mogul" ? 62 : r.arch === "boss" ? 72 : 55,
        loot: loot, score: loot + r.respect * 90 + r.kills * 240,
        why: "off-map rival - spawning fallback", where: "city", protection: r.crew ? r.crew + " crew" : "unknown",
      };
    }).sort(function (a, b) { return b.score - a.score; });
  }
  function targetRows() {
    const rows = livePowerTargets();
    const base = rows.length ? rows : fallbackTargets();
    // append the Hall of Fame (deceased VIPs/tycoons/racers) so a permanent
    // kill leaves a record instead of silently disappearing from the board —
    // appended+re-sorted rather than interleaved so the merge can't accidentally
    // reorder live rows when history is empty (the common case, zero cost).
    const hof = deceasedNotables();
    if (!hof.length) return base;
    return base.concat(hof).sort(function (a, b) { return b.score - a.score; });
  }

  CBZ.cityLeaderboardReset = function () {
    _s = 4242;
    rivals = [];
    for (let i = 0; i < ROSTER.length; i++) {
      const def = ROSTER[i];
      rivals.push({
        name: def.name, arch: def.arch,
        cash: ri(1500, 12000), bank: ri(3000, 30000),
        kills: ri(0, 7), respect: ri(10, 80),
        props: def.arch === "mogul" ? ri(1, 3) : (rng() < 0.4 ? 1 : 0),
        crew: def.arch === "boss" ? ri(2, 6) : ri(0, 3),
        rate: 8 + rng() * 46, aggr: rng(), ambition: 0.6 + rng() * 0.9,
      });
    }
  };

  function playerRow() {
    const e = CBZ.cityEcon;
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    let props = 0, crew = 0, notoriety = 0;
    if (w && w.assets) props = (w.assets.properties ? w.assets.properties.length : 0) + (w.assets.businesses ? w.assets.businesses.length : 0);
    if (CBZ.cityPlayerGangMembers) crew = CBZ.cityPlayerGangMembers().length;
    else crew = g.cityCrew || 0;
    if (w && w.criminalRecord) notoriety = Math.max(w.criminalRecord.wantedPeak || 0, Math.round((w.criminalRecord.heatPeak || 0) / 20));
    notoriety = Math.max(notoriety, g.wanted || 0);
    const score = e && e.netWorth ? e.netWorth() : ((g.cash || 0) + (g.cityBank || 0));
    return {
      name: "YOU", you: true, title: CBZ.cityPlayerTitle ? CBZ.cityPlayerTitle() : "Player",
      level: CBZ.cityPlayerLevel ? CBZ.cityPlayerLevel() : levelOf({ isPlayer: true }),
      loot: score, score: score, cash: g.cash || 0, bank: g.cityBank || 0,
      kills: g.kills || 0, respect: g.respect || 0, props, crew, notoriety,
    };
  }

  CBZ.cityLeaderboardRank = function () {
    const me = playerRow();
    const worth = function (r) { return r.netWorth != null ? r.netWorth : r.loot; };
    const rows = targetRows().concat([me]).sort(function (a, b) { return worth(b) - worth(a); });
    return { rank: rows.indexOf(me) + 1, total: rows.length, score: me.score };
  };

  function heirOf(gang) {
    const live = (gang.members || []).filter(function (m) { return m && !m.dead && m !== gang.boss; });
    if (!live.length) return null;
    live.sort(function (a, b) {
      const ta = RANK_TIER[a.rank] == null ? 2 : RANK_TIER[a.rank];
      const tb = RANK_TIER[b.rank] == null ? 2 : RANK_TIER[b.rank];
      if (tb !== ta) return tb - ta;
      const sa = a.gstat || {}, sb = b.gstat || {};
      if ((sb.bodies || 0) !== (sa.bodies || 0)) return (sb.bodies || 0) - (sa.bodies || 0);
      if ((sb.loyalty || 0) !== (sa.loyalty || 0)) return (sb.loyalty || 0) - (sa.loyalty || 0);
      return (sb.contrib || 0) - (sa.contrib || 0);
    });
    return live[0];
  }
  function gangState(gang) {
    if (gang.bossDead || !gang.boss || gang.boss.dead) return "succession";
    if (gang.warWith) return "war";
    if ((gang.hostility || 0) > 1.2) return "hunting you";
    return gang.archLabel || gang.type || "crew";
  }
  function gangStandings() {
    const gangs = (CBZ.cityGangs || []).filter(function (x) { return x && !x.absorbed; });
    if (!gangs.length) return null;
    const ctrl = CBZ.cityZoneControl ? CBZ.cityZoneControl() : { byGang: {}, neutral: 0, total: 0 };
    const rows = [];
    for (const gn of gangs) {
      const zones = (ctrl.byGang && ctrl.byGang[gn.id]) || 0;
      const crew = CBZ.cityGangStrength ? CBZ.cityGangStrength(gn) : (gn.members ? gn.members.length : 0);
      const heir = heirOf(gn);
      rows.push({
        id: gn.id, name: gn.isPlayer ? "Your Gang" : (gn.name || "Crew"),
        color: gn.color != null ? gn.color : 0x8a93a3,
        zones: zones, crew: crew, isPlayer: !!gn.isPlayer, treasury: gn.treasury || 0,
        boss: gn.boss && !gn.boss.dead ? gn.boss : null, heir: heir, state: gangState(gn),
        score: zones * 1000 + crew * 12 + (gn.treasury || 0) / 35,
      });
    }
    rows.sort(function (a, b) { return b.score - a.score; });
    return { rows: rows, total: ctrl.total || 0, neutral: ctrl.neutral || 0 };
  }

  function boardEl() {
    if (board) return board;
    board = document.createElement("div");
    board.id = "cityBoard";
    board.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:47;display:none;width:min(760px,94vw);max-height:88vh;overflow:hidden;background:rgba(12,14,20,.97);border:2px solid #2c3140;border-radius:12px;padding:14px 18px;box-sizing:border-box;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 14px 44px rgba(0,0,0,.6)";
    document.body.appendChild(board);
    return board;
  }

  function renderGangs(st) {
    if (!st || !st.rows.length) return "";
    const rows = st.rows.slice(0, 7);
    const cols = "24px 1.1fr 1.15fr 1fr 52px 62px 80px";
    let h = "<div style='display:grid;grid-template-columns:" + cols + ";gap:6px;font-size:10px;color:#8a93a3;border-bottom:1px solid #2c3140;padding-bottom:2px;margin-bottom:2px'>" +
      "<span>#</span><span>Crew</span><span>Boss</span><span>Next</span><span style='text-align:right'>Turf</span><span style='text-align:right'>Crew</span><span>Status</span></div>";
    rows.forEach(function (r, i) {
      const col = hex6(r.color), boss = r.boss ? (r.boss.name || "Boss") : "vacant";
      const heir = r.heir ? (r.heir.name || rankName(r.heir.rank)) : "none";
      const hl = r.isPlayer ? "background:rgba(126,217,87,.14);border-radius:5px;font-weight:700" : "";
      h += "<div style='display:grid;grid-template-columns:" + cols + ";gap:6px;align-items:center;font-size:12px;padding:2px 4px'>" +
        "<span style='" + hl + "'>" + (i === 0 ? "1" : i + 1) + "</span>" +
        "<span style='white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:" + (r.isPlayer ? "#7ed957" : "#e3e9f2") + "'><span style='display:inline-block;width:9px;height:9px;border-radius:2px;background:" + col + ";margin-right:6px'></span>" + esc(r.name) + "</span>" +
        "<span style='white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:" + (r.boss ? "#ffd166" : "#ff8a8a") + "'>" + esc(boss) + "</span>" +
        "<span style='white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#9fe6c8'>" + esc(heir) + "</span>" +
        "<span style='text-align:right;color:#ffd166;font-weight:700'>" + r.zones + "</span>" +
        "<span style='text-align:right;color:#9fe6c8'>" + r.crew + "</span>" +
        "<span style='white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#aeb6c2'>" + esc(r.state) + "</span>" +
        "</div>";
    });
    if (st.total) {
      h += "<div style='font-size:11px;color:#8a93a3;margin-top:3px;display:flex;justify-content:space-between'>" +
        "<span>" + (st.total - st.neutral) + "/" + st.total + " districts held</span>" +
        (st.neutral ? "<span style='color:#6b7480'>" + st.neutral + " neutral</span>" : "<span></span>") + "</div>";
    }
    return h;
  }

  function renderTargets(rows, me) {
    // ECONOMY_V2: 12 rows (more ultra-rich faces), ranked/shown by NET WORTH
    // with an occupation read — the board finally looks like a real rich list.
    const all = rows.slice(0, 12);
    const cols = "24px 1.2fr 86px 84px 1.2fr";
    let h = "<div style='margin-top:10px'>" +
      "<div style='font-size:13px;font-weight:700;margin-bottom:3px'>Living Rich List</div>" +
      "<div style='display:grid;grid-template-columns:" + cols + ";gap:6px;font-size:10px;color:#8a93a3;border-bottom:1px solid #2c3140;padding-bottom:2px;margin-bottom:2px'>" +
      "<span>#</span><span>Person</span><span style='text-align:right'>Tier</span><span style='text-align:right'>Worth</span><span>Why</span></div>";
    all.forEach(function (r, i) {
      const nw = r.netWorth != null ? r.netWorth : r.loot;
      const tier = (CBZ.cityEcon && CBZ.cityEcon.wealthTier) ? CBZ.cityEcon.wealthTier(nw) : null;
      const level = tier ? tier.name : (r.level ? "Lv." + r.level : "");
      const tierCol = r.dead ? "#8a93a3" : (tier ? tier.color : "#ffd166");
      // DECEASED rows (Hall of Fame — permanently-dead VIPs/tycoons/racers,
      // see deceasedNotables()) read dim/greyed with a skull tag instead of the
      // usual bright name, same "this entry is gone but on record" language
      // renderGangs uses for a vacant boss (#ff8a8a) — here it's a flat grey
      // since unlike a gang there's no living successor IN this row to flag.
      const nameCol = r.dead ? "#8a93a3" : "#e8eef7";
      h += "<div style='display:grid;grid-template-columns:" + cols + ";gap:6px;align-items:center;font-size:12px;padding:2px 4px;" + (r.dead ? "opacity:.6" : "") + "'>" +
        "<span style='color:#8a93a3'>" + (i + 1) + "</span>" +
        "<span style='white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>" + (r.dead ? "" : "") + "<b style='color:" + nameCol + "'>" + esc(r.name) + "</b> <span style='color:#8a93a3'>" + esc(r.title) + "</span></span>" +
        "<span style='text-align:right;color:" + tierCol + ";font-weight:700;font-size:10px'>" + esc(level) + "</span>" +
        "<span style='text-align:right;color:" + (r.dead ? "#8a93a3" : "#7ed957") + ";font-weight:700'>" + money(nw) + "</span>" +
        "<span style='white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:" + (r.dead ? "#ff8a8a" : "#aeb6c2") + "'>" + esc(r.why) + "</span>" +
        "</div>";
    });
    if (!all.length) h += "<div style='font-size:12px;color:#8a93a3;padding:4px'>No high-value people visible yet.</div>";
    // "ranks against live targets" should mean LIVE — exclude Hall of Fame rows.
    const liveRows = rows.filter(function (r) { return !r.dead; });
    // compare on the NET-WORTH axis (me.loot IS the player's net worth)
    const richer = liveRows.filter(function (r) { return (r.netWorth != null ? r.netWorth : r.loot) > me.loot; }).length + 1;
    h += "<div style='font-size:11px;color:#6b7480;margin-top:5px;display:flex;justify-content:space-between'>" +
      "<span>Your net worth ranks #" + richer + "/" + (liveRows.length + 1) + " against live targets.</span>" +
      "<span>Cash " + money(g.cash || 0) + " · Bank " + money(g.cityBank || 0) + "</span></div></div>";
    return h;
  }

  // ---- compact CHAMPIONSHIP standings block (racing.js). Read-only of
  // CBZ.cityRacing; fully guarded so a headless/partial load just skips it. ----
  function renderChampionship() {
    const RC = CBZ.cityRacing;
    if (!RC || !RC.standings) return "";
    const rows = RC.standings().slice(0, 6);
    if (!rows.length) return "";
    const cols = "24px 28px 1.4fr 56px 46px";
    let h = "<div style='margin-top:10px'>" +
      "<div style='font-size:13px;font-weight:700;margin-bottom:3px'>Racing Championship " +
      "<span style='font-size:11px;color:#8a93a3;font-weight:400'>· S" + RC.season + " R" + (RC.round + 1) + "/" + RC.ROUNDS + "</span></div>" +
      "<div style='display:grid;grid-template-columns:" + cols + ";gap:6px;font-size:10px;color:#8a93a3;border-bottom:1px solid #2c3140;padding-bottom:2px;margin-bottom:2px'>" +
      "<span>#</span><span>No</span><span>Driver</span><span style='text-align:right'>Pts</span><span style='text-align:right'>Wins</span></div>";
    rows.forEach(function (r, i) {
      h += "<div style='display:grid;grid-template-columns:" + cols + ";gap:6px;align-items:center;font-size:12px;padding:2px 4px'>" +
        "<span style='color:" + (i === 0 ? "#ffd166" : "#8a93a3") + "'>" + (i + 1) + "</span>" +
        "<span style='text-align:center;font-weight:700;color:" + hex6(r.teamColor != null ? r.teamColor : 0x8a93a3) + "'>" + r.number + "</span>" +
        "<span style='white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e3e9f2'>" + esc(r.name) + "</span>" +
        "<span style='text-align:right;color:#7ed957;font-weight:700'>" + r.points + "</span>" +
        "<span style='text-align:right;color:#9fe6c8'>" + r.wins + "</span>" +
        "</div>";
    });
    h += "</div>";
    return h;
  }

  function fitToScreen(el) {
    el.style.fontSize = "";
    let guard = 0, fs = 100;
    while (el.scrollHeight > el.clientHeight + 1 && fs > 70 && guard++ < 10) {
      fs -= 6; el.style.fontSize = fs + "%";
    }
  }

  function render() {
    const el = boardEl();
    const me = playerRow();
    const rows = targetRows();
    const leader = CBZ.cityTakeoverLeader ? CBZ.cityTakeoverLeader() : null;
    const pop = CBZ.cityPopulation ? CBZ.cityPopulation() : null;
    let winLine = "no crew controls the city";
    if (leader) {
      const lc = CBZ.cityGangById ? CBZ.cityGangById(leader.id) : null;
      const lcol = lc ? hex6(lc.color) : "#ffd166";
      winLine = "<b style='color:" + lcol + "'>" + esc(leader.id === "player" ? "YOU" : (leader.name || "?")) + "</b> leading " + leader.zones + "/" + leader.total;
    }
    let html = "<div style='display:flex;justify-content:space-between;align-items:baseline;margin-bottom:7px;gap:12px'>" +
      "<div><div style='font-size:19px;font-weight:700'>City Power</div><div style='font-size:11px;color:#8a93a3'>Bosses, heirs, money, protection.</div></div>" +
      "<div style='font-size:12px;color:#aeb6c2;text-align:right'>" + winLine +
      (pop && pop.total ? "<br><span style='color:#8a93a3'>" + (pop.alive | 0).toLocaleString() + "/" + (pop.total | 0).toLocaleString() + " alive</span>" : "") +
      "</div></div>";
    html += renderGangs(gangStandings());
    html += renderTargets(rows, me);
    html += renderChampionship();
    const tier = CBZ.cityEcon && CBZ.cityEcon.wealthTier ? CBZ.cityEcon.wealthTier(me.score) : null;
    html += "<div style='font-size:11px;color:#6b7480;margin-top:8px;border-top:1px solid #2c3140;padding-top:6px;display:flex;justify-content:space-between;gap:10px'>" +
      "<span>You: Lv." + me.level + " " + esc(me.title) + " · " + money(me.score) + (tier ? " · " + esc(tier.name) : "") + "</span>" +
      "<span>Tab / Esc close · Y jobs</span></div>";
    el.innerHTML = html;
    fitToScreen(el);
  }

  let open = false;
  function toggle(force) {
    open = force != null ? force : !open;
    if (open) { render(); boardEl().style.display = "block"; }
    else if (board) board.style.display = "none";
  }
  CBZ.cityShowLeaderboard = toggle;

  addEventListener("keydown", function (e) {
    if (g.mode !== "city") return;
    if (e.key === "Escape" && open) { e.preventDefault(); toggle(false); return; }
    if (open && (e.key || "").toLowerCase() === "y" && CBZ.cityOpenActivities) {
      e.preventDefault(); toggle(false); CBZ.cityOpenActivities(); return;
    }
    if (CBZ.cityMenuOpen && !open) return;
    if (e.key === "Tab") { e.preventDefault(); toggle(); }
  });

  CBZ.onUpdate(40, function (dt) {
    if (g.mode !== "city") return;
    simT -= dt;
    if (simT <= 0) {
      simT = 3;
      for (const r of rivals) {
        const amb = r.ambition;
        r.cash += Math.round(r.rate * (0.5 + rng()) * amb);
        if (rng() < 0.35) { const move = Math.round(r.cash * (0.2 + rng() * 0.3)); r.cash -= move; r.bank += move; }
        if (r.arch === "enforcer") {
          if (rng() < r.aggr * 0.4) { r.kills++; r.respect += 3; }
        } else if (rng() < r.aggr * 0.2) { r.kills++; r.respect += 2; }
        if (r.arch === "mogul" && r.bank > 22000 && rng() < 0.12) { r.bank -= 18000; r.props++; }
        else if (r.arch === "boss" && r.cash > 5000 && rng() < 0.15) { r.cash -= 3500; r.crew++; r.respect += 2; }
      }
      if (open) render();
    }
  });
})();
