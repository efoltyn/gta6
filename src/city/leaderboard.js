/* ============================================================
   city/leaderboard.js — the city's "rich list". A roster of rival
   "players" (AI hustlers) who are also out chasing money, kills,
   respect, property and turf. Their stats GRIND upward over time so
   the board is a live race you can climb or fall down.

   Press Tab to see where you rank. Columns: Net Worth (the composite
   score that ranks the board), Cash (on-hand + bank), Kills, Respect,
   Notoriety (wanted/heat peak), Properties, Crew (gang size).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // each rival is a named hustler with an archetype that biases how
  // they grind: enforcers rack up kills+respect, moguls hoard cash+
  // property, bosses build crews. Drift keeps the board moving.
  const ROSTER = [
    { name: "Big Sosa",  arch: "boss" },
    { name: "Ghost",     arch: "enforcer" },
    { name: "Reina",     arch: "mogul" },
    { name: "Knuckles",  arch: "enforcer" },
    { name: "DJ Vex",    arch: "mogul" },
    { name: "Mr. Cole",  arch: "boss" },
    { name: "Slim",      arch: "hustler" },
    { name: "Vipera",    arch: "enforcer" },
    { name: "Tank",      arch: "boss" },
    { name: "Echo",      arch: "hustler" },
    { name: "Mamba",     arch: "mogul" },
    { name: "Lucky",     arch: "hustler" },
    { name: "Dontae",    arch: "enforcer" },
    { name: "Nyx",       arch: "boss" },
    { name: "Brick",     arch: "mogul" },
  ];

  let rivals = [], board = null, simT = 0, lastPlayerRank = 0;
  let _s = 4242;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  function ri(a, b) { return a + ((rng() * (b - a + 1)) | 0); }

  // a rival's net worth — same formula the player is scored by, so the
  // race is apples to apples.
  function netWorth(r) {
    return Math.round(
      r.cash + r.bank +
      r.respect * 90 +
      r.kills * 240 +
      r.props * 14000 +
      r.crew * 4200 +
      r.notoriety * 350 +
      (r.streetXp || 0) * 42
    );
  }

  CBZ.cityLeaderboardReset = function () {
    _s = 4242;
    rivals = [];
    for (let i = 0; i < 12; i++) {
      const def = ROSTER[i % ROSTER.length];
      const r = {
        name: def.name, arch: def.arch,
        cash: ri(150, 3500), bank: ri(0, 6000),
        kills: ri(0, 7), respect: ri(5, 70),
        props: rng() < 0.45 ? ri(1, 2) : 0,
        crew: rng() < 0.5 ? ri(1, 4) : 0,
        notoriety: ri(0, 3),
        rate: 8 + rng() * 46, aggr: rng(), ambition: 0.6 + rng() * 0.9,
      };
      rivals.push(r);
    }
  };

  // live snapshot of the player's stats from g.* + the world ledger.
  function playerRow() {
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    let props = 0, crew = 0, notoriety = 0;
    if (w && w.assets) props = (w.assets.properties ? w.assets.properties.length : 0) + (w.assets.businesses ? w.assets.businesses.length : 0);
    if (CBZ.cityPlayerGangMembers) crew = CBZ.cityPlayerGangMembers().length;
    else crew = g.cityCrew || 0;
    if (w && w.criminalRecord) notoriety = Math.max(w.criminalRecord.wantedPeak || 0, Math.round((w.criminalRecord.heatPeak || 0) / 20));
    notoriety = Math.max(notoriety, g.wanted || 0);
    const me = {
      name: "YOU", you: true,
      cash: g.cash || 0, bank: g.cityBank || 0,
      kills: g.kills || 0, respect: g.respect || 0,
      props, crew, notoriety, streetXp: g.cityStreetXp || 0,
    };
    me.score = netWorth(me);
    return me;
  }

  // the player's current placement on the board (1 = top). Other systems
  // (story arc) can read this to celebrate climbing the ranks.
  CBZ.cityLeaderboardRank = function () {
    const me = playerRow();
    let rank = 1;
    for (const r of rivals) if (netWorth(r) > me.score) rank++;
    return { rank: rank, total: rivals.length + 1, score: me.score };
  };

  function boardEl() {
    if (board) return board;
    board = document.createElement("div");
    board.id = "cityBoard";
    // ONE-SCREEN, NO-SCROLL: the panel is capped to the viewport (max-height
    // 88vh) and overflow is HIDDEN — render() scales rows/fonts so content
    // always fits inside, and overflow rows collapse into a "+N more" line.
    board.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:47;display:none;width:min(620px,94vw);max-height:88vh;overflow:hidden;background:rgba(12,14,20,.97);border:2px solid #2c3140;border-radius:14px;padding:14px 18px;box-sizing:border-box;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 14px 44px rgba(0,0,0,.6)";
    document.body.appendChild(board);
    return board;
  }

  function hex6(n) { return "#" + ("000000" + ((n >>> 0).toString(16))).slice(-6); }

  function fmt(n) {
    n = Math.round(n || 0);
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1) + "k";
    return "" + n;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&]/g, function (c) { return c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"; }); }

  // ---- GANG STANDINGS (the takeover board): each gang with its colour, zones
  //      held, live crew, and a control bar; sorted by who's winning the city.
  //      Feature-detects CBZ.cityZoneControl/cityZones/cityGangs so it degrades
  //      gracefully if the turf meta isn't loaded. ----
  function gangStandings() {
    const gangs = (CBZ.cityGangs || []).filter(function (x) { return x && !x.absorbed; });
    if (!gangs.length) return null;
    const ctrl = CBZ.cityZoneControl ? CBZ.cityZoneControl() : { byGang: {}, neutral: 0, total: 0 };
    const rows = [];
    for (const gn of gangs) {
      const zones = (ctrl.byGang && ctrl.byGang[gn.id]) || 0;
      let crew = 0;
      if (CBZ.cityGangStrength) crew = CBZ.cityGangStrength(gn);
      else if (gn.members) { for (const m of gn.members) if (m && !m.dead && !m.ko) crew++; }
      rows.push({
        id: gn.id, name: gn.isPlayer ? "Your Gang" : (gn.name || "Crew"),
        color: gn.color != null ? gn.color : 0x8a93a3,
        zones: zones, crew: crew, isPlayer: !!gn.isPlayer,
        // takeover score = zones dominate, crew breaks ties
        score: zones * 1000 + crew,
      });
    }
    rows.sort(function (a, b) { return b.score - a.score; });
    return { rows: rows, total: ctrl.total || 0, neutral: ctrl.neutral || 0 };
  }

  function render() {
    const el = boardEl();

    // -------- TOP BANNER: who's winning the city + your rank + population --------
    const leader = CBZ.cityTakeoverLeader ? CBZ.cityTakeoverLeader() : null;
    const pop = CBZ.cityPopulation ? CBZ.cityPopulation() : null;
    let winLine;
    if (leader) {
      const isYou = leader.id === "player";
      const lc = CBZ.cityGangById ? CBZ.cityGangById(leader.id) : null;
      const lcol = lc ? hex6(lc.color) : "#ffd166";
      winLine = "<b style='color:" + lcol + "'>" + (isYou ? "YOU" : esc(leader.name || "?")) + "</b> leading · " +
        leader.zones + "/" + leader.total + " districts";
    } else winLine = "City up for grabs — no one holds a district";

    let html = "<div style='display:flex;justify-content:space-between;align-items:baseline;margin-bottom:7px'>" +
      "<div style='font-size:18px;font-weight:700'>🏴 City Takeover</div>" +
      "<div style='font-size:12px;color:#aeb6c2'>" + winLine + "</div></div>";

    // -------- GANG STANDINGS (the heart of the board) --------
    const st = gangStandings();
    const GCOLS = "26px 1fr 70px 64px 1.1fr";
    if (st && st.rows.length) {
      // scale row size to the gang count so even a crowded board fits one screen
      const nG = st.rows.length;
      const gFont = nG > 11 ? 11 : nG > 8 ? 12 : 13;
      const gPad = nG > 11 ? "1px 4px" : "2px 5px";
      // cap visible gang rows; collapse the rest into a "+N more" summary line
      const GCAP = 9;
      const shown = st.rows.slice(0, GCAP);
      const hidden = st.rows.slice(GCAP);

      html += "<div style='display:grid;grid-template-columns:" + GCOLS + ";gap:5px;font-size:10px;color:#8a93a3;border-bottom:1px solid #2c3140;padding-bottom:2px;margin-bottom:2px'>" +
        "<span>#</span><span>Gang</span><span style='text-align:right'>Zones</span><span style='text-align:right'>Crew</span><span>Control</span></div>";

      const maxZ = st.total || (st.rows[0] ? Math.max(1, st.rows[0].zones) : 1);
      shown.forEach(function (r, i) {
        const col = hex6(r.color);
        const hl = r.isPlayer ? "background:rgba(126,217,87,.15);border-radius:5px;font-weight:700" : "";
        const medal = i === 0 ? "👑" : (i + 1);
        const barW = Math.round((r.zones / Math.max(1, maxZ)) * 100);
        html += "<div style='display:grid;grid-template-columns:" + GCOLS + ";gap:5px;align-items:center;font-size:" + gFont + "px;padding:" + gPad + "'>" +
          "<span style='" + hl + "'>" + medal + "</span>" +
          "<span style='color:" + (r.isPlayer ? "#7ed957" : "#e3e9f2") + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>" +
          "<span style='display:inline-block;width:9px;height:9px;border-radius:2px;background:" + col + ";margin-right:6px;vertical-align:middle'></span>" + esc(r.name) + "</span>" +
          "<span style='text-align:right;color:#ffd166;font-weight:700'>" + r.zones + "</span>" +
          "<span style='text-align:right;color:#9fe6c8'>" + r.crew + "</span>" +
          "<span style='height:8px;border-radius:4px;background:rgba(255,255,255,.07);overflow:hidden'>" +
          "<span style='display:block;height:100%;width:" + barW + "%;background:" + col + "'></span></span>" +
          "</div>";
      });
      if (hidden.length) {
        let hz = 0, hc = 0;
        for (const r of hidden) { hz += r.zones; hc += r.crew; }
        html += "<div style='font-size:11px;color:#6b7480;padding:2px 5px'>+" + hidden.length + " more crews · " + hz + " zones · " + hc + " crew</div>";
      }
      if (st.total) {
        html += "<div style='font-size:11px;color:#8a93a3;margin-top:3px;display:flex;justify-content:space-between'>" +
          "<span>" + (st.total - st.neutral) + "/" + st.total + " districts held</span>" +
          (st.neutral ? "<span style='color:#6b7480'>" + st.neutral + " neutral — up for grabs</span>" : "<span></span>") + "</div>";
      }
    }

    // -------- YOUR STANDING + the live POPULATION headcount --------
    const rk = CBZ.cityLeaderboardRank ? CBZ.cityLeaderboardRank() : null;
    let foot = "<div style='display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:7px;border-top:1px solid #2c3140;font-size:12px'>";
    if (pop && pop.total) {
      foot += "<span><span style='color:#ff7b6b;font-weight:700'>" + (pop.alive | 0).toLocaleString() + "</span>" +
        "<span style='color:#8a93a3'>/" + (pop.total | 0).toLocaleString() + " alive</span></span>";
    } else foot += "<span></span>";
    if (rk) {
      foot += "<span style='color:#7ed957'>Net worth #" + rk.rank + "/" + rk.total + " · $" + fmt(rk.score) + "</span>";
    }
    foot += "</div>";
    html += foot;

    // -------- compact RICH LIST (secondary; capped + scaled so it never scrolls) --------
    const me = playerRow();
    const all = rivals.map(function (r) {
      return { name: r.name, score: netWorth(r), cash: r.cash, bank: r.bank, kills: r.kills, crew: r.crew };
    });
    all.push(me);
    all.sort(function (a, b) { return b.score - a.score; });
    const myRank = all.indexOf(me) + 1;
    // show the top few + ALWAYS the player's row, summarise the rest
    const RCAP = 5;
    const top = all.slice(0, RCAP);
    if (top.indexOf(me) < 0) top[top.length - 1] = me;     // guarantee YOU appear
    const RCOLS = "20px 1fr 70px 56px 40px";
    html += "<div style='margin-top:8px'>" +
      "<div style='font-size:11px;color:#8a93a3;margin-bottom:2px'>💰 Rich List — you're #" + myRank + "/" + all.length + "</div>" +
      "<div style='display:grid;grid-template-columns:" + RCOLS + ";gap:5px;align-items:center;font-size:11px'>";
    top.forEach(function (r, i) {
      const idx = all.indexOf(r) + 1;
      const isYou = r.you;
      const medal = idx === 1 ? "👑" : idx;
      html += "<span style='" + (isYou ? "color:#7ed957;font-weight:700" : "color:#8a93a3") + "'>" + medal + "</span>" +
        "<span style='color:" + (isYou ? "#7ed957" : "#dfe6f0") + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>" + esc(isYou ? "YOU" : r.name) + "</span>" +
        "<span style='text-align:right;color:#ffd166'>$" + fmt(r.score) + "</span>" +
        "<span style='text-align:right;color:#cfe8b8'>$" + fmt((r.cash || 0) + (r.bank || 0)) + "</span>" +
        "<span style='text-align:right;color:#ff8a8a'>" + (r.kills || 0) + "</span>";
    });
    html += "</div></div>";

    html += "<div style='font-size:11px;color:#6b7480;margin-top:8px;display:flex;justify-content:space-between'>" +
      "<span>Own every district to take the city.</span><span>Tab / Esc to close</span></div>";

    el.innerHTML = html;
    fitToScreen(el);
  }

  // last-ditch guarantee against scroll: if the rendered panel still exceeds the
  // viewport on a tiny screen, shrink its font until it fits (no scrollbars ever).
  function fitToScreen(el) {
    el.style.fontSize = "";
    let guard = 0, fs = 100;
    while (el.scrollHeight > el.clientHeight + 1 && fs > 70 && guard++ < 10) {
      fs -= 6; el.style.fontSize = fs + "%";
    }
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
    if (e.key === "Escape" && open) { e.preventDefault(); toggle(false); return; }  // never trap the board
    if (CBZ.cityMenuOpen && !open) return;   // a property/shop/realtor overlay owns the screen
    if (e.key === "Tab") { e.preventDefault(); toggle(); }
  });

  // rivals keep grinding so the board is a live race; re-render while open.
  CBZ.onUpdate(40, function (dt) {
    if (g.mode !== "city") return;
    simT -= dt;
    if (simT <= 0) {
      simT = 3;
      for (const r of rivals) {
        const amb = r.ambition;
        // everyone earns; archetype biases what they grind toward.
        r.cash += Math.round(r.rate * (0.5 + rng()) * amb);
        if (rng() < 0.35) { const move = Math.round(r.cash * (0.2 + rng() * 0.3)); r.cash -= move; r.bank += move; }
        if (r.arch === "enforcer") {
          if (rng() < r.aggr * 0.4) { r.kills++; r.respect += 3; r.notoriety += rng() < 0.4 ? 1 : 0; }
        } else if (rng() < r.aggr * 0.2) { r.kills++; r.respect += 2; }
        if (rng() < 0.45) r.respect += 1;
        // moguls buy property when flush; bosses recruit crew.
        if (r.arch === "mogul" && r.bank > 16000 && rng() < 0.12) { r.bank -= 14000; r.props++; }
        else if (r.arch === "boss" && r.cash > 3000 && rng() < 0.15) { r.cash -= 2500; r.crew++; r.respect += 2; }
        else if (rng() < 0.03) { if (r.arch === "mogul" && r.bank > 16000) { r.bank -= 14000; r.props++; } }
        if (rng() < 0.04 && r.notoriety > 0 && r.arch !== "enforcer") r.notoriety = Math.max(0, r.notoriety - 1); // heat cools
      }
      if (open) render();
    }
  });
})();
