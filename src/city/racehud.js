/* ============================================================
   city/racehud.js — THE RACING HUD, cut to what a driver reads.

   HUD PURGE (owner, 2026-09-27: "the timer, the PB run etc., pills that mean
   nothing. SHOW DON'T TELL"). The live overlay used to be a six-cell strip
   (POS / LAP / TIME / LAST / BEST / AHEAD-BEHIND), a sector bar, a fastest-lap
   line, a note line, an engine bar, a timing tower down the left and a track
   map top-right. A driver at speed reads two things: where he is in the
   field and how many laps are left. Everything else is the road, the cars
   around him and the world jumbotron. What remains:

     • ONE tiny top-centre chip: "P3/8  LAP 2/3". Nothing else.
     • FINAL LAP / FINISHED flashes in that chip's place for a few seconds when
       the flag changes, then fades.
     • The START LIGHTS gantry (the countdown IS the moment) and the RESULTS
       board at the end (a screen, not a HUD).

   API unchanged (all null-safe): show, hide, setTrack (accepted, no map is
   drawn), lights, update, results, closeResults, resultsOpen, auditResults,
   audit, fmtT, fmtD.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  let root = null, chipEl = null, flagEl = null;
  let lightsEl, lamps = [], boardEl;
  let lastFlag = "", flagT = 0;
  const A = { shown: 0, updates: 0 };

  const LAMP_COUNT = 5;          // matches the world gantry over the start line

  function css() {
    if (document.getElementById("raceHudCss")) return;
    const st = document.createElement("style");
    st.id = "raceHudCss";
    st.textContent =
      "#raceHud{position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:40;pointer-events:none;font-family:Fredoka,system-ui,sans-serif;font-variant-numeric:tabular-nums;color:#e8ecf2;display:none;text-align:center}" +
      "#raceHud .rChip{display:inline-block;padding:3px 12px;border-radius:9px;background:rgba(8,11,17,.45);font-size:15px;font-weight:700;letter-spacing:.5px;text-shadow:0 1px 3px rgba(0,0,0,.7);opacity:.85}" +
      "#raceHud .rChip b{color:#ffd166}" +
      "#raceHud .rFlag{display:block;margin-top:4px;font-size:13px;font-weight:800;letter-spacing:3px;opacity:0;transition:opacity .6s ease;text-shadow:0 1px 3px rgba(0,0,0,.8)}" +
      "#raceHud .rFlag.on{opacity:1}" +
      // ---- start lights: a hanging gantry of five lamps ----------------------
      "#raceLights{position:fixed;left:50%;top:22vh;transform:translateX(-50%);z-index:41;display:none;pointer-events:none}" +
      "#raceLights .gantry{display:flex;gap:12px;padding:12px 18px;background:rgba(8,11,17,.72);border:1px solid rgba(232,236,242,.12);border-radius:12px}" +
      "#raceLights .lamp{width:30px;height:30px;border-radius:50%;background:#20242c;border:2px solid rgba(232,236,242,.14);transition:background .08s,box-shadow .08s}" +
      "#raceLights .lamp.red{background:#d0342c;box-shadow:0 0 18px rgba(208,52,44,.8)}" +
      "#raceLights .lamp.green{background:#3ba24a;box-shadow:0 0 22px rgba(59,162,74,.9)}" +
      "#raceLights .go{margin-top:8px;text-align:center;font-family:Fredoka,system-ui,sans-serif;font-size:26px;font-weight:800;letter-spacing:3px;color:#3ba24a;text-shadow:0 0 14px rgba(59,162,74,.7);display:none}" +
      "@keyframes rGoPulse{0%{transform:scale(.7);opacity:0}30%{transform:scale(1.15);opacity:1}100%{transform:scale(1);opacity:1}}" +
      // ---- results board -----------------------------------------------------
      "#raceBoard{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:48;display:none;width:min(620px,92vw);max-height:84vh;overflow:auto;background:rgba(12,14,20,.97);border:2px solid #2c3140;border-radius:12px;padding:14px 18px;box-sizing:border-box;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;font-variant-numeric:tabular-nums;box-shadow:0 14px 44px rgba(0,0,0,.6)}" +
      "#raceBoard .hd{display:flex;align-items:center;gap:10px;margin-bottom:8px}" +
      "#raceBoard .headcopy{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex:1;min-width:0}" +
      "#raceBoard .ttl{font-size:18px;font-weight:700}" +
      "#raceBoard .sub{font-size:12px;color:#8a93a3}" +
      "#raceBoard .rClose{flex:0 0 auto;min-width:78px;min-height:42px;padding:8px 14px;border-radius:999px;cursor:pointer;touch-action:manipulation;background:#1b3440;border:2px solid rgba(125,231,255,.55);color:#eaf6ff;font:700 13px Fredoka,system-ui,sans-serif;letter-spacing:.5px;box-shadow:0 3px 0 rgba(0,0,0,.35)}" +
      "#raceBoard .rClose:active{transform:translateY(2px);box-shadow:0 1px 0 rgba(0,0,0,.35);background:#28566a}" +
      "#raceBoard .row{display:grid;grid-template-columns:26px 26px 1.4fr 84px 64px 52px 74px;gap:6px;align-items:center;font-size:13px;padding:3px 4px;border-radius:6px}" +
      "#raceBoard .row.you{background:rgba(125,231,255,.08);border:1px solid rgba(125,231,255,.25)}" +
      "#raceBoard .row .p1{color:#ffd166;font-weight:700}" +
      "#raceBoard .row .num{text-align:center;font-weight:700}" +
      "#raceBoard .row .tm{text-align:right;color:#aeb6c2}" +
      "#raceBoard .row .bl{text-align:right;color:#8a93a3;font-size:12px}" +
      "#raceBoard .row .bl.fl{color:#c77dff;font-weight:700}" +
      "#raceBoard .row .pts{text-align:right;color:#9fe6c8}" +
      "#raceBoard .row .cash{text-align:right;color:#7ed957;font-weight:700}" +
      "#raceBoard .ft{font-size:11px;color:#6b7480;margin-top:8px;border-top:1px solid #2c3140;padding-top:6px}" +
      "@media(max-width:620px){#raceBoard .headcopy{display:block}#raceBoard .sub{margin-top:2px}" +
      "#raceBoard .row{grid-template-columns:22px 22px 1.4fr 72px 0 44px 64px;gap:4px}#raceBoard .row .bl{display:none}}" +
      "";
    document.head.appendChild(st);
  }

  function build() {
    if (root) return;
    css();
    root = document.createElement("div");
    root.id = "raceHud";
    root.innerHTML = "<div class='rChip' id='rhChip'></div><div class='rFlag' id='rhFlag'></div>";
    document.body.appendChild(root);
    chipEl = root.querySelector("#rhChip");
    flagEl = root.querySelector("#rhFlag");

    lightsEl = document.createElement("div");
    lightsEl.id = "raceLights";
    let lampHtml = "";
    for (let i = 0; i < LAMP_COUNT; i++) lampHtml += "<div class='lamp'></div>";
    lightsEl.innerHTML = "<div class='gantry'>" + lampHtml + "</div><div class='go'>GO</div>";
    document.body.appendChild(lightsEl);
    lamps = Array.prototype.slice.call(lightsEl.querySelectorAll(".lamp"));

    boardEl = document.createElement("div");
    boardEl.id = "raceBoard";
    boardEl.setAttribute("role", "dialog");
    boardEl.setAttribute("aria-modal", "true");
    document.body.appendChild(boardEl);
  }

  function fmtT(s) {
    if (!s || s <= 0 || !isFinite(s)) return "—";
    const m = Math.floor(s / 60), r = s - m * 60;
    return m + ":" + (r < 10 ? "0" : "") + r.toFixed(1);
  }
  // a DELTA is signed and always shown to three decimals of a second, because
  // that is the resolution at which a driver can act on it.
  function fmtD(s) {
    if (s == null || !isFinite(s)) return "—";
    return (s >= 0 ? "+" : "−") + Math.abs(s).toFixed(2);
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&]/g, (c) => c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"); }
  function hex6(n) { return "#" + ("000000" + ((n >>> 0).toString(16))).slice(-6); }
  function touchUI() {
    if (CBZ.touchMode) return true;
    try {
      if (document.body && document.body.classList.contains("touch")) return true;
      // Fallback for the frame before systems/touch.js has stamped body.touch.
      // CBZ.isTouchDevice (config.js) — not a bare `pointer: coarse`, which an
      // iPad with a trackpad attached answers "fine" to.
      return CBZ.isTouchDevice();
    } catch (e) { return false; }
  }
  function withoutKeyboardClose(s) {
    return String(s == null ? "" : s)
      .replace(/\s*[·•]\s*Esc(?:ape)?\s+closes?\b/gi, "")
      .replace(/\s*\(\s*Esc(?:ape)?\s*\)/gi, "")
      .replace(/\[\s*Esc(?:ape)?\s*\]\s*(?:close|closes)?/gi, "")
      .trim();
  }
  function setHTML(el, s) { if (el && el._h !== s) { el.innerHTML = s; el._h = s; } }
  function nowMs() { return CBZ.nowMs ? CBZ.nowMs() : Date.now(); }

  const raceHud = {
    show: function () {
      build(); root.style.display = "block"; A.shown++;
      lastFlag = ""; flagT = 0;
      if (flagEl) flagEl.classList.remove("on");
      /* A race starting clears any controls reference card the car entry
         popped (it returns after the race via defer()). */
      if (CBZ.controls && CBZ.controls.open && CBZ.controls.open()) {
        if (CBZ.controls.defer) CBZ.controls.defer(); else CBZ.controls.hide();
      }
    },
    hide: function () {
      if (!root) return;
      root.style.display = "none";
      lightsEl.style.display = "none";
      boardEl.style.display = "none";
    },
    // The course polyline used to feed a corner track map. No map is drawn now;
    // the call is accepted so every producer keeps working unchanged.
    setTrack: function () {},
    /* n = 0..LAMP_COUNT lamps lit red, "go" = all green + GO flash, -1 hides. */
    lights: function (n, of) {
      build();
      const goEl = lightsEl.querySelector(".go");
      if (n == null || n < 0) { lightsEl.style.display = "none"; return; }
      lightsEl.style.display = "block";
      if (n === "go") {
        lamps.forEach((l) => { l.className = "lamp green"; });
        goEl.style.display = "block";
        goEl.style.animation = "rGoPulse .5s ease-out";
        return;
      }
      goEl.style.display = "none";
      const lit = of && of > 0 ? Math.round(n * LAMP_COUNT / of) : n;
      lamps.forEach((l, i) => { l.className = "lamp" + (i < lit ? " red" : ""); });
    },
    update: function (s) {
      if (!root || root.style.display === "none" || !s) return;
      A.updates++;
      let h = "";
      if (s.pos != null) h += "<b>P" + s.pos + "</b>" + (s.count ? "/" + s.count : "");
      if (s.lap != null && s.laps) h += (h ? "&nbsp;&nbsp;" : "") + "LAP " + Math.min(s.lap, s.laps) + "/" + s.laps;
      setHTML(chipEl, h);
      if (chipEl) chipEl.style.display = h ? "" : "none";
      // Only the flags a driver must know about, and only as a moment.
      const f = s.flag === "white" ? "FINAL LAP" : (s.flag === "chequered" || s.flag === "finished") ? "FINISHED" : "";
      if (f !== lastFlag) {
        lastFlag = f;
        if (f) { flagEl.textContent = f; flagEl.classList.add("on"); flagT = nowMs(); }
        else flagEl.classList.remove("on");
      } else if (f && flagT && nowMs() - flagT > 3000) { flagEl.classList.remove("on"); flagT = 0; }
    },
    results: function (rows, opts) {
      build();
      opts = opts || {};
      const touch = touchUI();
      const rawFoot = opts.foot || "Drive off to continue";
      const foot = touch
        ? (opts.touchFoot != null ? String(opts.touchFoot) : withoutKeyboardClose(rawFoot))
        : rawFoot;
      let h = "<div class='hd'><div class='headcopy'><div class='ttl'>" + esc(opts.title || "RACE RESULTS") + "</div>" +
        "<div class='sub'>" + esc(opts.sub || "") + "</div></div>" +
        (touch ? "<button type='button' class='rClose' data-testid='race-results-close' aria-label='Close race results'>CLOSE</button>" : "") +
        "</div>";
      h += "<div class='row' style='font-size:10px;color:#8a93a3;border-bottom:1px solid #2c3140'>" +
        "<span>#</span><span>Car</span><span>Driver</span><span style='text-align:right'>Time / Gap</span>" +
        "<span style='text-align:right'>Best lap</span><span style='text-align:right'>Pts</span><span style='text-align:right'>Purse</span></div>";
      (rows || []).forEach(function (r) {
        h += "<div class='row" + (r.you ? " you" : "") + "'>" +
          "<span class='" + (r.pos === 1 ? "p1" : "") + "'>" + r.pos + "</span>" +
          "<span class='num' style='color:" + (r.color != null ? hex6(r.color) : "#9fb0c6") + "'>" + (r.number != null ? r.number : "—") + "</span>" +
          "<span style='white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>" + esc(r.name) + (r.you ? " (YOU)" : "") + "</span>" +
          "<span class='tm'>" + (r.dnf ? "DNF" : esc(r.time || "")) + "</span>" +
          "<span class='bl" + (r.fl ? " fl" : "") + "'>" + (r.best > 0 ? fmtT(r.best) : "") + "</span>" +
          "<span class='pts'>" + (r.pts != null ? "+" + r.pts : "") + "</span>" +
          "<span class='cash'>" + (r.purse ? "$" + r.purse : "") + "</span>" +
          "</div>";
      });
      h += "<div class='ft'>" + esc(foot) + "</div>";
      boardEl.innerHTML = h;
      boardEl.setAttribute("aria-label", opts.title || "Race results");
      boardEl.style.display = "block";
      const close = boardEl.querySelector(".rClose");
      if (close) {
        const dismiss = function (e) { e.preventDefault(); e.stopPropagation(); raceHud.closeResults(); };
        close.addEventListener("click", dismiss);
        close.addEventListener("touchend", dismiss, { passive: false });
      }
    },
    closeResults: function () { if (boardEl) boardEl.style.display = "none"; },
    resultsOpen: function () { return !!(boardEl && boardEl.style.display === "block"); },
    auditResults: function () {
      const close = boardEl && boardEl.querySelector(".rClose");
      const text = boardEl ? boardEl.innerText : "";
      return {
        open: raceHud.resultsOpen(), touch: touchUI(), text: text,
        closeCount: boardEl ? boardEl.querySelectorAll(".rClose").length : 0,
        closeVisible: !!(close && getComputedStyle(close).display !== "none" && close.getBoundingClientRect().width > 0),
        keyboardHint: /\b(?:Esc|Escape|Enter|Space)\b/i.test(text),
      };
    },
    audit: function () {
      return { built: !!root, shows: A.shown, updates: A.updates, lamps: lamps.length };
    },
    fmtT: fmtT,
    fmtD: fmtD,
  };
  CBZ.raceHud = raceHud;

  if (typeof addEventListener !== "undefined") {
    addEventListener("keydown", function (e) {
      if (g && g.mode !== "city") return;
      if (e.key === "Escape" && raceHud.resultsOpen()) { e.preventDefault(); raceHud.closeResults(); }
    });
  }
})();
