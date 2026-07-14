/* ============================================================
   city/racehud.js — THE RACING HUD.

   WHY: a race you can't READ isn't a race. Position, lap, the gap to
   the car ahead/behind, your lap time against your best — that's the
   entire drama of racing compressed into four numbers, and the city
   HUD (hud.js) deliberately owns none of them. This overlay appears
   only while a race is live (speedway weekend or street circuit),
   plus the two race-day set pieces: the START LIGHTS countdown and
   the FINISH RESULTS board.

   Visual contract — matches hud.js's professional pass exactly: the
   same tokens (one panel rgba, one radius, tabular numerals, three
   opacity levels), semantic colors reused with their meanings intact
   (money-green = cash ONLY on the purse column, gold = rank/position
   ONLY, cyan = interactive). No emoji wallpaper.

   API (all null-safe, DOM built once):
     CBZ.raceHud.show({title, sub})          — mount the live strip
     CBZ.raceHud.lights(n)                   — 0..3 red lamps lit; "go" flashes green; -1 hides
     CBZ.raceHud.update(state)               — {pos,count,lap,laps,lapT,best,
                                                gapA:{name,s},gapB:{name,s},flash}
     CBZ.raceHud.results(rows,{title,sub})   — finish board; rows = {pos,name,
                                                number,color,time,pts,purse,you,dnf}
     CBZ.raceHud.closeResults() / .hide()    — tear down
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  let root = null, posEl, lapEl, timeEl, bestEl, gapAEl, gapBEl, lightsEl, lamps = [], boardEl, titleEl;

  function css() {
    if (document.getElementById("raceHudCss")) return;
    const st = document.createElement("style");
    st.id = "raceHudCss";
    st.textContent =
      "#raceHud{position:fixed;left:50%;top:calc(14px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:40;pointer-events:none;font-family:Fredoka,system-ui,sans-serif;font-variant-numeric:tabular-nums;color:#e8ecf2;display:none}" +
      "#raceHud .rPanel{background:rgba(8,11,17,.55);border:1px solid rgba(232,236,242,.12);border-radius:9px;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}" +
      "#raceHud .rStrip{display:flex;align-items:stretch;gap:0;padding:6px 14px}" +
      "#raceHud .rCell{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 13px;border-left:1px solid rgba(232,236,242,.12)}" +
      "#raceHud .rCell:first-child{border-left:none}" +
      "#raceHud .rLab{font-size:9px;letter-spacing:1.1px;color:#9fb0c6;opacity:.55;font-weight:700}" +
      "#raceHud .rVal{font-size:19px;font-weight:700;line-height:1.15;opacity:.85}" +
      "#raceHud .rVal.gold{color:#ffd166}" +
      "#raceHud .rVal small{font-size:12px;color:#9fb0c6;font-weight:600}" +
      "#raceHud .rGap{font-size:12px;line-height:1.3;opacity:.85;min-width:118px;text-align:left}" +
      "#raceHud .rGap .nm{color:#9fb0c6;max-width:96px;overflow:hidden;text-overflow:ellipsis;display:inline-block;vertical-align:bottom;white-space:nowrap}" +
      "#raceHud .rGap b{color:#e8ecf2}" +
      "#raceHud .rGap .up{color:#7ed957}" +
      "#raceHud .rGap .dn{color:#ff5b5b}" +
      // start lights: a hanging gantry of three lamps
      "#raceLights{position:fixed;left:50%;top:22vh;transform:translateX(-50%);z-index:41;display:none;pointer-events:none}" +
      "#raceLights .gantry{display:flex;gap:14px;padding:12px 18px;background:rgba(8,11,17,.72);border:1px solid rgba(232,236,242,.12);border-radius:12px}" +
      "#raceLights .lamp{width:34px;height:34px;border-radius:50%;background:#20242c;border:2px solid rgba(232,236,242,.14);transition:background .08s,box-shadow .08s}" +
      "#raceLights .lamp.red{background:#d0342c;box-shadow:0 0 18px rgba(208,52,44,.8)}" +
      "#raceLights .lamp.green{background:#3ba24a;box-shadow:0 0 22px rgba(59,162,74,.9)}" +
      "#raceLights .go{margin-top:8px;text-align:center;font-family:Fredoka,system-ui,sans-serif;font-size:26px;font-weight:800;letter-spacing:3px;color:#3ba24a;text-shadow:0 0 14px rgba(59,162,74,.7);display:none}" +
      "@keyframes rGoPulse{0%{transform:scale(.7);opacity:0}30%{transform:scale(1.15);opacity:1}100%{transform:scale(1);opacity:1}}" +
      // results board
      "#raceBoard{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:48;display:none;width:min(560px,92vw);max-height:84vh;overflow:auto;background:rgba(12,14,20,.97);border:2px solid #2c3140;border-radius:12px;padding:14px 18px;box-sizing:border-box;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;font-variant-numeric:tabular-nums;box-shadow:0 14px 44px rgba(0,0,0,.6)}" +
      "#raceBoard .hd{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}" +
      "#raceBoard .ttl{font-size:18px;font-weight:700}" +
      "#raceBoard .sub{font-size:12px;color:#8a93a3}" +
      "#raceBoard .row{display:grid;grid-template-columns:26px 26px 1.4fr 84px 52px 74px;gap:6px;align-items:center;font-size:13px;padding:3px 4px;border-radius:6px}" +
      "#raceBoard .row.you{background:rgba(125,231,255,.08);border:1px solid rgba(125,231,255,.25)}" +
      "#raceBoard .row .p1{color:#ffd166;font-weight:700}" +
      "#raceBoard .row .num{text-align:center;font-weight:700}" +
      "#raceBoard .row .tm{text-align:right;color:#aeb6c2}" +
      "#raceBoard .row .pts{text-align:right;color:#9fe6c8}" +
      "#raceBoard .row .cash{text-align:right;color:#7ed957;font-weight:700}" +
      "#raceBoard .ft{font-size:11px;color:#6b7480;margin-top:8px;border-top:1px solid #2c3140;padding-top:6px}";
    document.head.appendChild(st);
  }

  function build() {
    if (root) return;
    css();
    root = document.createElement("div");
    root.id = "raceHud";
    root.innerHTML =
      "<div class='rPanel rStrip'>" +
      "<div class='rCell'><span class='rLab'>POS</span><span class='rVal gold' id='rhPos'>—</span></div>" +
      "<div class='rCell'><span class='rLab'>LAP</span><span class='rVal' id='rhLap'>—</span></div>" +
      "<div class='rCell'><span class='rLab'>TIME</span><span class='rVal' id='rhTime'>0:00.0</span></div>" +
      "<div class='rCell'><span class='rLab'>BEST</span><span class='rVal' id='rhBest'>—</span></div>" +
      "<div class='rCell'><span class='rLab'>AHEAD · BEHIND</span>" +
      "<div class='rGap' id='rhGapA'>—</div><div class='rGap' id='rhGapB'>—</div></div>" +
      "</div>";
    document.body.appendChild(root);
    posEl = root.querySelector("#rhPos"); lapEl = root.querySelector("#rhLap");
    timeEl = root.querySelector("#rhTime"); bestEl = root.querySelector("#rhBest");
    gapAEl = root.querySelector("#rhGapA"); gapBEl = root.querySelector("#rhGapB");

    lightsEl = document.createElement("div");
    lightsEl.id = "raceLights";
    lightsEl.innerHTML = "<div class='gantry'><div class='lamp'></div><div class='lamp'></div><div class='lamp'></div></div><div class='go'>GO</div>";
    document.body.appendChild(lightsEl);
    lamps = Array.prototype.slice.call(lightsEl.querySelectorAll(".lamp"));

    boardEl = document.createElement("div");
    boardEl.id = "raceBoard";
    document.body.appendChild(boardEl);
  }

  function fmtT(s) {
    if (!s || s <= 0 || !isFinite(s)) return "—";
    const m = Math.floor(s / 60), r = s - m * 60;
    return m + ":" + (r < 10 ? "0" : "") + r.toFixed(1);
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&]/g, (c) => c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"); }
  function hex6(n) { return "#" + ("000000" + ((n >>> 0).toString(16))).slice(-6); }

  const raceHud = {
    show: function () { build(); root.style.display = "block"; },
    hide: function () {
      if (!root) return;
      root.style.display = "none";
      lightsEl.style.display = "none";
      boardEl.style.display = "none";
    },
    // n = 1..3 lights lit red · "go" = all green + GO flash · -1/null = hide
    lights: function (n) {
      build();
      const goEl = lightsEl.querySelector(".go");
      if (n == null || n < 0) { lightsEl.style.display = "none"; return; }
      lightsEl.style.display = "block";
      if (n === "go") {
        lamps.forEach((l) => { l.className = "lamp green"; });
        goEl.style.display = "block";
        goEl.style.animation = "rGoPulse .5s ease-out";
      } else {
        goEl.style.display = "none";
        lamps.forEach((l, i) => { l.className = "lamp" + (i < n ? " red" : ""); });
      }
    },
    update: function (s) {
      if (!root || root.style.display === "none" || !s) return;
      const pos = "P" + s.pos + (s.count ? "/" + s.count : "");
      if (posEl._t !== pos) { posEl.textContent = pos; posEl._t = pos; }
      const lap = s.lap != null ? (Math.min(s.lap, s.laps) + "/" + s.laps) : "—";
      if (lapEl._t !== lap) { lapEl.textContent = lap; lapEl._t = lap; }
      timeEl.textContent = fmtT(s.lapT);
      const b = fmtT(s.best);
      if (bestEl._t !== b) { bestEl.textContent = b; bestEl._t = b; }
      gapAEl.innerHTML = s.gapA && s.gapA.name
        ? "<span class='dn'>▲</span> <span class='nm'>" + esc(s.gapA.name) + "</span> <b>+" + s.gapA.s.toFixed(1) + "s</b>"
        : "<span class='up'>▲ —</span>";
      gapBEl.innerHTML = s.gapB && s.gapB.name
        ? "<span class='up'>▼</span> <span class='nm'>" + esc(s.gapB.name) + "</span> <b>−" + s.gapB.s.toFixed(1) + "s</b>"
        : "<span class='dn'>▼ —</span>";
    },
    results: function (rows, opts) {
      build();
      opts = opts || {};
      let h = "<div class='hd'><div class='ttl'>" + esc(opts.title || "RACE RESULTS") + "</div>" +
        "<div class='sub'>" + esc(opts.sub || "") + "</div></div>";
      h += "<div class='row' style='font-size:10px;color:#8a93a3;border-bottom:1px solid #2c3140'>" +
        "<span>#</span><span>No</span><span>Driver</span><span style='text-align:right'>Time / Gap</span><span style='text-align:right'>Pts</span><span style='text-align:right'>Purse</span></div>";
      (rows || []).forEach(function (r) {
        h += "<div class='row" + (r.you ? " you" : "") + "'>" +
          "<span class='" + (r.pos === 1 ? "p1" : "") + "'>" + r.pos + "</span>" +
          "<span class='num' style='color:" + (r.color != null ? hex6(r.color) : "#9fb0c6") + "'>" + (r.number != null ? r.number : "—") + "</span>" +
          "<span style='white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>" + esc(r.name) + (r.you ? " (YOU)" : "") + "</span>" +
          "<span class='tm'>" + (r.dnf ? "DNF" : esc(r.time || "")) + "</span>" +
          "<span class='pts'>" + (r.pts != null ? "+" + r.pts : "") + "</span>" +
          "<span class='cash'>" + (r.purse ? "$" + r.purse : "") + "</span>" +
          "</div>";
      });
      h += "<div class='ft'>" + esc(opts.foot || "Drive off to continue · Esc closes") + "</div>";
      boardEl.innerHTML = h;
      boardEl.style.display = "block";
    },
    closeResults: function () { if (boardEl) boardEl.style.display = "none"; },
    resultsOpen: function () { return !!(boardEl && boardEl.style.display === "block"); },
    fmtT: fmtT,
  };
  CBZ.raceHud = raceHud;

  if (typeof addEventListener !== "undefined") {
    addEventListener("keydown", function (e) {
      if (g && g.mode !== "city") return;
      if (e.key === "Escape" && raceHud.resultsOpen()) { e.preventDefault(); raceHud.closeResults(); }
    });
  }
})();
