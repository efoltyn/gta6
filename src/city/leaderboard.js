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
      r.notoriety * 350
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
      props, crew, notoriety,
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
    board.style.cssText = "position:fixed;left:50%;top:6%;transform:translateX(-50%);z-index:47;display:none;min-width:560px;max-width:94vw;background:rgba(12,14,20,.96);border:2px solid #2c3140;border-radius:14px;padding:14px 18px;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 14px 44px rgba(0,0,0,.55)";
    document.body.appendChild(board);
    return board;
  }

  const COLS = "28px 1fr 92px 78px 44px 50px 50px 56px 46px";
  function fmt(n) {
    n = Math.round(n || 0);
    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1) + "k";
    return "" + n;
  }

  function render() {
    const me = playerRow();
    const all = rivals.map((r) => ({
      name: r.name, cash: r.cash, bank: r.bank, kills: r.kills,
      respect: r.respect, props: r.props, crew: r.crew, notoriety: r.notoriety,
      score: netWorth(r),
    }));
    all.push(me);
    all.sort((a, b) => b.score - a.score);
    const myRank = all.indexOf(me) + 1;

    let html = "<div style='display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px'>" +
      "<div style='font-size:18px;font-weight:700'>🏆 City Rich List</div>" +
      "<div style='font-size:13px;color:#7ed957'>You're #" + myRank + " of " + all.length +
      " · net worth $" + fmt(me.score) + "</div></div>";

    const head = (t) => "<span style='text-align:right'>" + t + "</span>";
    html += "<div style='display:grid;grid-template-columns:" + COLS + ";gap:4px;font-size:11px;color:#8a93a3;margin-bottom:4px;border-bottom:1px solid #2c3140;padding-bottom:3px'>" +
      "<span>#</span><span>Name</span>" + head("Net Worth") + head("Cash") + head("Kills") +
      head("Resp") + head("Notor") + head("Prop") + head("Crew") + "</div>";

    all.forEach((r, i) => {
      const hl = r.you ? "background:rgba(126,217,87,.16);border-radius:6px;font-weight:700" : "";
      const nameCol = r.you ? "#7ed957" : "#dfe6f0";
      const medal = i === 0 ? "👑" : (i === 1 ? "🥈" : (i === 2 ? "🥉" : (i + 1)));
      const cell = (v, c) => "<span style='text-align:right;color:" + c + "'>" + v + "</span>";
      html += "<div style='display:grid;grid-template-columns:" + COLS + ";gap:4px;font-size:13px;padding:2px 4px;align-items:center;" + hl + "'>" +
        "<span>" + medal + "</span>" +
        "<span style='color:" + nameCol + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>" + r.name + "</span>" +
        cell("$" + fmt(r.score), "#ffd166") +
        cell("$" + fmt(r.cash + r.bank), "#cfe8b8") +
        cell(r.kills, "#ff8a8a") +
        cell(r.respect, "#7fd0ff") +
        cell(r.notoriety, "#ff9a5a") +
        cell(r.props, "#c9b6ff") +
        cell(r.crew, "#9fe6c8") +
        "</div>";
    });

    html += "<div style='font-size:11px;color:#6b7480;margin-top:8px;display:flex;justify-content:space-between'>" +
      "<span>Rivals grind in real time — keep your spot.</span><span>Tab / Esc to close</span></div>";
    boardEl().innerHTML = html;
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
