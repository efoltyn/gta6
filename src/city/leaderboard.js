/* ============================================================
   city/leaderboard.js — the city leaderboard. A roster of rival
   "players" (AI hustlers) who are also out chasing money, kills and
   respect; their stats tick up over time so the board is a live race.
   Press Tab to see where you rank in cash / kills / respect.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  const NAMES = ["Big Sosa", "Ghost", "Reina", "Knuckles", "DJ Vex", "Mr. Cole", "Slim", "Vipera", "Tank", "Echo", "Mamba", "Lucky", "Dontae", "Nyx", "Brick"];
  let rivals = [], board = null, simT = 0;
  let _s = 4242;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  CBZ.cityLeaderboardReset = function () {
    _s = 4242;
    rivals = [];
    const n = 12;
    for (let i = 0; i < n; i++) {
      rivals.push({
        name: NAMES[i % NAMES.length], money: 200 + ((rng() * 4000) | 0),
        kills: (rng() * 8) | 0, respect: (rng() * 60) | 0,
        rate: 8 + rng() * 40, aggr: rng(),
      });
    }
  };

  function boardEl() {
    if (board) return board;
    board = document.createElement("div");
    board.id = "cityBoard";
    board.style.cssText = "position:fixed;left:50%;top:8%;transform:translateX(-50%);z-index:47;display:none;min-width:360px;background:rgba(12,14,20,.95);border:2px solid #2c3140;border-radius:14px;padding:14px 18px;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 14px 44px rgba(0,0,0,.5)";
    document.body.appendChild(board);
    return board;
  }

  function render() {
    const me = { name: "YOU", money: g.cash || 0, kills: g.kills || 0, respect: g.respect || 0, you: true };
    const all = rivals.concat([me]).slice();
    all.sort((a, b) => (b.money + b.respect * 20 + b.kills * 60) - (a.money + a.respect * 20 + a.kills * 60));
    let html = "<div style='font-size:18px;font-weight:700;margin-bottom:8px'>🏆 City Leaderboard</div>";
    html += "<div style='display:grid;grid-template-columns:24px 1fr 80px 50px 60px;gap:4px;font-size:12px;color:#8a93a3;margin-bottom:4px'><span>#</span><span>Name</span><span style='text-align:right'>Cash</span><span style='text-align:right'>Kills</span><span style='text-align:right'>Resp</span></div>";
    all.forEach((r, i) => {
      const hl = r.you ? "background:rgba(126,217,87,.16);border-radius:6px;font-weight:700" : "";
      html += "<div style='display:grid;grid-template-columns:24px 1fr 80px 50px 60px;gap:4px;font-size:13px;padding:2px 4px;" + hl + "'><span>" + (i + 1) + "</span><span style='color:" + (r.you ? "#7ed957" : "#dfe6f0") + "'>" + r.name + "</span><span style='text-align:right;color:#ffd166'>$" + r.money + "</span><span style='text-align:right;color:#ff8a8a'>" + r.kills + "</span><span style='text-align:right;color:#7fd0ff'>" + r.respect + "</span></div>";
    });
    html += "<div style='font-size:11px;color:#6b7480;margin-top:8px'>Tab / Esc to close</div>";
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

  // rivals keep grinding; re-render while open
  CBZ.onUpdate(40, function (dt) {
    if (g.mode !== "city") return;
    simT -= dt;
    if (simT <= 0) {
      simT = 3;
      for (const r of rivals) {
        r.money += Math.round(r.rate * (0.5 + rng()));
        if (rng() < r.aggr * 0.25) { r.kills++; r.respect += 2; }
        if (rng() < 0.4) r.respect += 1;
      }
      if (open) render();
    }
  });
})();
