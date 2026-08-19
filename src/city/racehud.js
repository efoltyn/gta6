/* ============================================================
   city/racehud.js — THE RACING HUD.

   WHY: a race you can't READ isn't a race. This overlay appears only while a
   race is live (speedway weekend, APEX night, pink-slip duel or street
   circuit), plus the two race-day set pieces: the START LIGHTS countdown and
   the FINISH RESULTS board.

   ---------------------------------------------------------------------------
   WHAT THIS FILE USED TO BE, AND WHY THAT WAS THIN (owner, 2026-08-15:
   "really really thin logic and UI, the racer game")

   Five cells in one strip: POS · LAP · TIME · BEST · one line of gap ahead and
   one behind. Everything else the race actually knew was thrown away every
   frame. Measured against `CBZ.raceKit`, which was already computing all of it:

     • `kit.order` is the COMPLETE running order with live intervals, and the
       player could see exactly two rows of it — the car in front and the car
       behind. The full order went to the world jumbotron at 1.5 Hz, i.e. to a
       sign you cannot read while driving.
     • `e.lapTimes[]` and `e.lastLap` were collected on every crossing by every
       entrant and read by NOTHING, anywhere in the repo. The lap you just did
       never appeared on screen.
     • No fastest lap of the field, so the purple that every racing game uses to
       tell you the session changed had no producer.
     • No sector times, so a lap was one number you could not act on.
     • No track map. On a tri-oval where every corner looks like the last one,
       "P4" does not tell you whether the car you are chasing is two seconds or
       two hundred metres away.
     • The gap arrows were COLOURED BACKWARDS: the car ahead of you got `.dn`
       (red) and the car behind got `.up` (green), and the empty states inverted
       both again.
     • The strip did not update at all during the countdown (the producer
       returns before calling update while `phase === "grid"`), so the grid — the
       one moment you want to know where you start — showed em-dashes.
     • The lamp gantry had THREE lamps while the world gantry over the start
       line has FIVE columns, so two different countdowns ran on one screen.

   All eight are fixed below. Nothing here invents a number: every value is
   already computed by raceKit or by the venue, and this file's whole job is to
   put it where a driver can see it.

   ---------------------------------------------------------------------------
   Visual contract — matches hud.js's professional pass exactly: the same tokens
   (one panel rgba, one radius, tabular numerals, three opacity levels),
   semantic colours reused with their meanings intact (money-green = cash ONLY
   on the purse column, gold = rank/position ONLY, cyan = interactive, purple =
   session best ONLY). No emoji in HUD space.

   API (all null-safe, DOM built once):
     CBZ.raceHud.show()                      — mount the live overlay
     CBZ.raceHud.lights(n)                   — 0..5 red lamps lit; "go" flashes
                                               green; -1 hides
     CBZ.raceHud.setTrack(pts, opts)         — course polyline in WORLD coords,
                                               once per race; null tears it down
     CBZ.raceHud.update(state)               — see STATE CONTRACT below
     CBZ.raceHud.results(rows, opts)         — finish board
     CBZ.raceHud.closeResults() / .hide()    — tear down
     CBZ.raceHud.audit()                     — the ratchet

   STATE CONTRACT (every field optional; an absent field hides its panel, so a
   producer adopts one line at a time and an old producer still works):
     pos, count, lap, laps, lapT, best        the original five
     gapA:{name,s} / gapB:{name,s}            neighbours
     tower: [{pos,name,number,color,gap,you,dnf,lapped,fl,out}]
     cars:  [{x,z,color,you,dnf}]             live map dots, WORLD coords
     last                                     your last lap time, seconds
     flap:{s,name}                            fastest lap of the FIELD
     sectors: [{s, delta, purple}]            completed sectors this lap
     damage                                   engine health 0..1
     flag: "green"|"yellow"|"white"|"chequered"|"finished"
     note                                     one short line under the strip
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  let root = null, posEl, lapEl, timeEl, lastEl, bestEl, gapAEl, gapBEl;
  let lightsEl, lamps = [], boardEl, towerEl, mapEl, mapCtx, sectorEl, flapEl, dmgEl, noteEl, flagEl;
  // the track polyline, normalised into map space once per race
  let TRACK = null;   // {pts:[{x,y}], minX,minZ,scale, w,h}
  let mapDpr = 1, mapDrawT = 0;
  const A = { shown: 0, towerRows: 0, mapCars: 0, lapsSeen: 0, sectorsSeen: 0, flapSeen: 0 };

  const LAMP_COUNT = 5;          // matches the world gantry over the start line

  function css() {
    if (document.getElementById("raceHudCss")) return;
    const st = document.createElement("style");
    st.id = "raceHudCss";
    st.textContent =
      "#raceHud{position:fixed;left:0;top:0;width:100%;height:100%;z-index:40;pointer-events:none;font-family:Fredoka,system-ui,sans-serif;font-variant-numeric:tabular-nums;color:#e8ecf2;display:none}" +
      "#raceHud .rPanel{background:rgba(8,11,17,.55);border:1px solid rgba(232,236,242,.12);border-radius:9px;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}" +
      // ---- the top strip -----------------------------------------------------
      "#raceHud .rTop{position:absolute;left:50%;top:calc(14px + env(safe-area-inset-top,0px));transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:5px}" +
      "#raceHud .rStrip{display:flex;align-items:stretch;gap:0;padding:6px 14px}" +
      "#raceHud .rCell{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 13px;border-left:1px solid rgba(232,236,242,.12)}" +
      "#raceHud .rCell:first-child{border-left:none}" +
      "#raceHud .rLab{font-size:9px;letter-spacing:1.1px;color:#9fb0c6;opacity:.55;font-weight:700}" +
      "#raceHud .rVal{font-size:19px;font-weight:700;line-height:1.15;opacity:.85}" +
      "#raceHud .rVal.gold{color:#ffd166}" +
      "#raceHud .rVal.purple{color:#c77dff}" +
      "#raceHud .rVal.good{color:#7ed957}" +
      "#raceHud .rVal.bad{color:#ff5b5b}" +
      "#raceHud .rVal small{font-size:12px;color:#9fb0c6;font-weight:600}" +
      "#raceHud .rGap{font-size:12px;line-height:1.3;opacity:.85;min-width:118px;text-align:left}" +
      "#raceHud .rGap .nm{color:#9fb0c6;max-width:96px;overflow:hidden;text-overflow:ellipsis;display:inline-block;vertical-align:bottom;white-space:nowrap}" +
      "#raceHud .rGap b{color:#e8ecf2}" +
      // SEMANTIC, and the right way round this time: the car AHEAD is the one
      // you are losing to (red), the car BEHIND is the one you are beating
      // (green). The old file had both arrows and both empty states inverted.
      "#raceHud .rGap .ahead{color:#ff5b5b}" +
      "#raceHud .rGap .behind{color:#7ed957}" +
      "#raceHud .rGap .none{color:#6b7480}" +
      // ---- sector bar + last-lap delta --------------------------------------
      "#raceHud .rSectors{display:flex;gap:4px;align-items:center;padding:4px 8px;font-size:11px;font-weight:700}" +
      "#raceHud .rSec{min-width:52px;text-align:center;padding:2px 6px;border-radius:5px;background:rgba(232,236,242,.07);color:#9fb0c6}" +
      "#raceHud .rSec.good{background:rgba(126,217,87,.17);color:#7ed957}" +
      "#raceHud .rSec.bad{background:rgba(255,91,91,.15);color:#ff5b5b}" +
      "#raceHud .rSec.purple{background:rgba(199,125,255,.2);color:#c77dff}" +
      "#raceHud .rFlap{padding:3px 9px;font-size:11px;font-weight:700;color:#c77dff;letter-spacing:.4px}" +
      "#raceHud .rFlap .nm{color:#9fb0c6;font-weight:600}" +
      "#raceHud .rNote{font-size:12px;font-weight:700;letter-spacing:.6px;padding:3px 10px;color:#ffd166}" +
      // ---- the timing tower --------------------------------------------------
      "#raceHud .rTower{position:absolute;left:calc(14px + env(safe-area-inset-left,0px));top:50%;transform:translateY(-50%);padding:6px 8px 7px;min-width:172px;max-width:32vw}" +
      "#raceHud .rTowerHd{font-size:9px;letter-spacing:1.1px;color:#9fb0c6;opacity:.55;font-weight:700;padding:0 2px 4px}" +
      "#raceHud .rRow{display:grid;grid-template-columns:16px 20px 1fr auto;gap:6px;align-items:center;font-size:12px;padding:2px 3px;border-radius:5px;line-height:1.25}" +
      "#raceHud .rRow.you{background:rgba(125,231,255,.10);box-shadow:inset 0 0 0 1px rgba(125,231,255,.28)}" +
      "#raceHud .rRow.out{opacity:.42}" +
      "#raceHud .rRow .p{color:#9fb0c6;font-weight:700;text-align:right}" +
      "#raceHud .rRow.lead .p{color:#ffd166}" +
      "#raceHud .rRow .n{text-align:center;font-weight:800;font-size:11px;border-radius:3px;color:#0b0e14;padding:0 1px}" +
      "#raceHud .rRow .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e8ecf2}" +
      "#raceHud .rRow .gp{text-align:right;color:#9fb0c6;font-variant-numeric:tabular-nums;font-size:11px}" +
      "#raceHud .rRow .gp.fl{color:#c77dff}" +
      // ---- the track map -----------------------------------------------------
      "#raceHud .rMap{position:absolute;right:calc(14px + env(safe-area-inset-right,0px));top:calc(96px + env(safe-area-inset-top,0px));padding:7px;display:none}" +
      "#raceHud .rMap canvas{display:block}" +
      // ---- damage bar --------------------------------------------------------
      // It rides in the TOP COLUMN, not pinned to the left edge: the first
      // draft anchored it at top:50% with a -50% transform, which is exactly
      // where the timing tower already is, and the two drew on top of each
      // other. Everything the driver reads at a glance is in one stack.
      "#raceHud .rDmg{display:none}" +
      "#raceHud .rDmgWrap{display:flex;align-items:center;gap:6px;padding:4px 10px;font-size:9px;letter-spacing:1.1px;color:#9fb0c6;font-weight:700}" +
      "#raceHud .rDmgBar{width:96px;height:5px;border-radius:3px;background:rgba(232,236,242,.14);overflow:hidden}" +
      "#raceHud .rDmgFill{height:100%;width:100%;background:#7ed957;transition:width .25s linear,background .25s linear}" +
      // ---- flag banner -------------------------------------------------------
      // A FLOW CHILD OF THE TOP COLUMN, not an absolute at a typed offset: the
      // first draft pinned it at top:74px, which is where the sector bar had
      // just been added, and the chequered flag drew straight across the sector
      // times (filmed). Everything in this stack sizes itself and pushes the
      // rest down, so a panel appearing can never land on another one.
      "#raceHud .rFlag{display:none;padding:4px 16px;font-size:13px;font-weight:800;letter-spacing:3px;border-radius:7px}" +
      "#raceHud .rFlag.green{color:#7ed957;background:rgba(59,162,74,.16);box-shadow:inset 0 0 0 1px rgba(126,217,87,.4)}" +
      "#raceHud .rFlag.yellow{color:#ffd166;background:rgba(240,196,25,.16);box-shadow:inset 0 0 0 1px rgba(255,209,102,.4)}" +
      "#raceHud .rFlag.white{color:#e8ecf2;background:rgba(232,236,242,.12);box-shadow:inset 0 0 0 1px rgba(232,236,242,.4)}" +
      "#raceHud .rFlag.chequered,#raceHud .rFlag.finished{color:#0b0e14;background:repeating-linear-gradient(45deg,#e8ecf2 0 7px,#20242c 7px 14px);text-shadow:0 1px 0 rgba(232,236,242,.9)}" +
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
      // A narrow screen has no room for a tower AND a map beside the action.
      "@media(max-width:900px){#raceHud .rTower{min-width:132px;font-size:11px}#raceHud .rMap{display:none!important}}" +
      "@media(max-height:520px){#raceHud .rTower{top:auto;bottom:12px;transform:none}#raceHud .rDmg{display:none!important}}";
    document.head.appendChild(st);
  }

  function build() {
    if (root) return;
    css();
    root = document.createElement("div");
    root.id = "raceHud";
    root.innerHTML =
      "<div class='rTop'>" +
      "<div class='rPanel rStrip'>" +
      "<div class='rCell'><span class='rLab'>POS</span><span class='rVal gold' id='rhPos'>—</span></div>" +
      "<div class='rCell'><span class='rLab'>LAP</span><span class='rVal' id='rhLap'>—</span></div>" +
      "<div class='rCell'><span class='rLab'>TIME</span><span class='rVal' id='rhTime'>0:00.0</span></div>" +
      "<div class='rCell'><span class='rLab'>LAST</span><span class='rVal' id='rhLast'>—</span></div>" +
      "<div class='rCell'><span class='rLab'>BEST</span><span class='rVal' id='rhBest'>—</span></div>" +
      "<div class='rCell'><span class='rLab'>AHEAD · BEHIND</span>" +
      "<div class='rGap' id='rhGapA'>—</div><div class='rGap' id='rhGapB'>—</div></div>" +
      "</div>" +
      "<div class='rFlag' id='rhFlag'></div>" +
      "<div class='rPanel rSectors' id='rhSectors' style='display:none'></div>" +
      "<div class='rPanel rFlap' id='rhFlap' style='display:none'></div>" +
      "<div class='rPanel rNote' id='rhNote' style='display:none'></div>" +
      "<div class='rDmg' id='rhDmg'><div class='rPanel rDmgWrap'>ENGINE" +
      "<span class='rDmgBar'><span class='rDmgFill' id='rhDmgFill'></span></span></div></div>" +
      "</div>" +
      "<div class='rPanel rTower' id='rhTower' style='display:none'>" +
      "<div class='rTowerHd'>ORDER</div><div id='rhTowerRows'></div></div>" +
      "<div class='rPanel rMap' id='rhMap'><canvas></canvas></div>";
    document.body.appendChild(root);
    posEl = root.querySelector("#rhPos"); lapEl = root.querySelector("#rhLap");
    timeEl = root.querySelector("#rhTime"); lastEl = root.querySelector("#rhLast");
    bestEl = root.querySelector("#rhBest");
    gapAEl = root.querySelector("#rhGapA"); gapBEl = root.querySelector("#rhGapB");
    towerEl = root.querySelector("#rhTower");
    sectorEl = root.querySelector("#rhSectors");
    flapEl = root.querySelector("#rhFlap");
    noteEl = root.querySelector("#rhNote");
    flagEl = root.querySelector("#rhFlag");
    dmgEl = root.querySelector("#rhDmg");
    mapEl = root.querySelector("#rhMap");
    const cv = mapEl.querySelector("canvas");
    mapCtx = cv.getContext ? cv.getContext("2d") : null;

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
  // a number chip is filled with the team colour, so the text on it has to be
  // whichever of near-black / near-white actually reads (WCAG relative luminance).
  function ink(n) {
    const r = ((n >>> 16) & 255) / 255, g2 = ((n >>> 8) & 255) / 255, b = (n & 255) / 255;
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const L = 0.2126 * lin(r) + 0.7152 * lin(g2) + 0.0722 * lin(b);
    return L > 0.42 ? "#0b0e14" : "#f2f5f9";
  }
  function touchUI() {
    if (CBZ.touchMode) return true;
    try {
      if (document.body && document.body.classList.contains("touch")) return true;
      return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    } catch (e) { return false; }
  }
  function withoutKeyboardClose(s) {
    return String(s == null ? "" : s)
      .replace(/\s*[·•]\s*Esc(?:ape)?\s+closes?\b/gi, "")
      .replace(/\s*\(\s*Esc(?:ape)?\s*\)/gi, "")
      .replace(/\[\s*Esc(?:ape)?\s*\]\s*(?:close|closes)?/gi, "")
      .trim();
  }
  function setText(el, s) { if (el && el._t !== s) { el.textContent = s; el._t = s; } }
  function setHTML(el, s) { if (el && el._h !== s) { el.innerHTML = s; el._h = s; } }
  function setCls(el, s) { if (el && el._c !== s) { el.className = s; el._c = s; } }
  /* SHOWING A PANEL MEANS NAMING A DISPLAY, NOT CLEARING ONE. `.rMap` and
     `.rDmg` carry `display:none` in the stylesheet (they are opt-in panels), so
     setting `style.display = ""` hands them straight back to that rule and they
     stay invisible — while every `style.display !== "none"` test, including
     this file's own audit, cheerfully reports them as shown. Filmed: the track
     map was "mounted" on the grid and was not on the screen. */
  function show(el, on, disp) {
    if (!el) return;
    const d = on ? (disp || "block") : "none";
    if (el.style.display !== d) el.style.display = d;
  }

  // ============================================================
  //  THE TRACK MAP. The HUD is handed the course as a WORLD-COORDINATE
  //  polyline once per race and normalises it into its own little box; per
  //  frame it is handed world positions and re-uses that same transform. So a
  //  street race with a waypoint path and an oval with a parametric centreline
  //  reach this identically, and nothing here knows what a speedway is.
  // ============================================================
  const MAP_PX = 128, MAP_PAD = 9;
  function setTrack(pts, opts) {
    build();
    if (!pts || pts.length < 3 || !mapCtx) { TRACK = null; show(mapEl, false); return; }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    }
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxZ - minZ);
    const box = MAP_PX - MAP_PAD * 2;
    const scale = Math.min(box / w, box / h);
    TRACK = {
      pts: pts, minX: minX, minZ: minZ, scale: scale,
      offX: MAP_PAD + (box - w * scale) / 2,
      offY: MAP_PAD + (box - h * scale) / 2,
      closed: !(opts && opts.open),
      start: opts && opts.start ? opts.start : null,
    };
    const cv = mapEl.querySelector("canvas");
    mapDpr = Math.min(2, (window.devicePixelRatio || 1));
    cv.width = MAP_PX * mapDpr; cv.height = MAP_PX * mapDpr;
    cv.style.width = MAP_PX + "px"; cv.style.height = MAP_PX + "px";
    show(mapEl, true);
    drawMap(null);
  }
  function mapX(x) { return TRACK.offX + (x - TRACK.minX) * TRACK.scale; }
  function mapY(z) { return TRACK.offY + (z - TRACK.minZ) * TRACK.scale; }
  function drawMap(cars) {
    if (!TRACK || !mapCtx) return;
    const c = mapCtx;
    c.setTransform(mapDpr, 0, 0, mapDpr, 0, 0);
    c.clearRect(0, 0, MAP_PX, MAP_PX);
    // the ribbon: a fat dark casing with a lighter surface on top, so a dot
    // sitting ON the track is unambiguous against a dot that has run wide.
    c.lineJoin = c.lineCap = "round";
    for (let pass = 0; pass < 2; pass++) {
      c.beginPath();
      const P = TRACK.pts;
      c.moveTo(mapX(P[0].x), mapY(P[0].z));
      for (let i = 1; i < P.length; i++) c.lineTo(mapX(P[i].x), mapY(P[i].z));
      if (TRACK.closed) c.closePath();
      c.strokeStyle = pass === 0 ? "rgba(8,11,17,.85)" : "rgba(232,236,242,.30)";
      c.lineWidth = pass === 0 ? 7 : 4;
      c.stroke();
    }
    // start/finish tick, drawn across the line
    if (TRACK.start) {
      const s = TRACK.start;
      c.strokeStyle = "#ffd166"; c.lineWidth = 2.4;
      c.beginPath();
      c.moveTo(mapX(s.x) - s.nx * 5, mapY(s.z) - s.nz * 5);
      c.lineTo(mapX(s.x) + s.nx * 5, mapY(s.z) + s.nz * 5);
      c.stroke();
    }
    if (!cars || !cars.length) return;
    A.mapCars = cars.length;
    // rivals first, the player LAST so he is never hidden under a rival's dot
    const ordered = cars.slice().sort((a, b) => (a.you ? 1 : 0) - (b.you ? 1 : 0));
    for (const car of ordered) {
      const x = mapX(car.x), y = mapY(car.z);
      if (!isFinite(x) || !isFinite(y)) continue;
      c.beginPath();
      c.arc(x, y, car.you ? 4.1 : 3.1, 0, Math.PI * 2);
      c.fillStyle = car.dnf ? "#5b6270" : hex6(car.color != null ? car.color : 0x9fb0c6);
      c.fill();
      c.lineWidth = car.you ? 1.8 : 1;
      c.strokeStyle = car.you ? "#eaf6ff" : "rgba(8,11,17,.75)";
      c.stroke();
    }
  }

  // ============================================================
  //  THE TIMING TOWER. Re-rendered only when the ORDER or a gap actually
  //  changes — a per-frame innerHTML of seven rows is a layout thrash nobody
  //  needs at 60 Hz, and the signature makes "changed" exact rather than a
  //  guess. (hud.js's dock-not-rerender pattern.)
  // ============================================================
  function renderTower(rows) {
    if (!rows || !rows.length) { show(towerEl, false); return; }
    show(towerEl, true);
    A.towerRows = rows.length;
    let sig = "";
    for (const r of rows) sig += r.pos + "" + r.name + "" + (r.gap == null ? "" : (+r.gap).toFixed(1)) + "" + (r.fl ? 1 : 0) + (r.dnf ? 2 : 0) + (r.lapped ? 4 : 0) + "";
    const holder = towerEl.querySelector("#rhTowerRows");
    if (holder._sig === sig) return;
    holder._sig = sig;
    let h = "";
    for (const r of rows) {
      const col = r.color != null ? r.color : 0x9fb0c6;
      // INTERVAL, not gap-to-leader: what you can act on is the car you can see.
      // The leader shows the lap he is on instead of an interval to himself.
      let gp = "—", gcls = "gp";
      if (r.dnf || r.out) gp = "OUT";
      else if (r.gapText != null) gp = r.gapText;
      else if (r.lapped) gp = "+" + r.lapped + "L";
      else if (r.gap != null && r.pos > 1) gp = "+" + (+r.gap).toFixed(1);
      else if (r.pos === 1) gp = "LEAD";
      if (r.fl) gcls += " fl";
      h += "<div class='rRow" + (r.you ? " you" : "") + (r.pos === 1 ? " lead" : "") + ((r.dnf || r.out) ? " out" : "") + "'>" +
        "<span class='p'>" + r.pos + "</span>" +
        "<span class='n' style='background:" + hex6(col) + ";color:" + ink(col) + "'>" + (r.number != null ? r.number : "·") + "</span>" +
        "<span class='nm'>" + esc(r.name) + "</span>" +
        "<span class='" + gcls + "'>" + esc(gp) + "</span>" +
        "</div>";
    }
    holder.innerHTML = h;
  }

  const raceHud = {
    show: function () {
      build(); root.style.display = "block"; A.shown++;
      /* AND CLEAR THE DESK. systems/controls.js pops its reference card the
         first time you enter a car — which, on a race day, is the moment you
         sit on the grid, so the card was ALREADY OPEN across the middle of the
         screen when the lights started counting (filmed: tools/shots at the
         top of this wave). Deferring the pop was not enough; the one that is
         already up has to come down, and a race starting is exactly the event
         that says so. `defer()`, not `hide()`: the game taking a card away is
         not the player saying he has read it, so it comes back once the race
         is over and he is still sitting in a car. */
      if (CBZ.controls && CBZ.controls.open && CBZ.controls.open()) {
        if (CBZ.controls.defer) CBZ.controls.defer(); else CBZ.controls.hide();
      }
    },
    hide: function () {
      if (!root) return;
      root.style.display = "none";
      lightsEl.style.display = "none";
      boardEl.style.display = "none";
      TRACK = null;
      show(mapEl, false); show(towerEl, false); show(dmgEl, false);
      show(sectorEl, false); show(flapEl, false); show(noteEl, false);
      if (flagEl) flagEl.style.display = "none";
    },
    setTrack: setTrack,
    /* n = 0..LAMP_COUNT lamps lit red · "go" = all green + GO flash · -1 hides.
       FIVE lamps, because the gantry standing over the start line in the world
       has five columns and the two used to disagree on screen. A producer that
       still speaks in thirds is scaled, so nothing had to be edited to adopt. */
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
      setText(posEl, "P" + (s.pos != null ? s.pos : "—") + (s.count ? "/" + s.count : ""));
      setText(lapEl, s.lap != null ? (Math.min(s.lap, s.laps) + "/" + s.laps) : "—");
      timeEl.textContent = fmtT(s.lapT);

      // LAST vs BEST: the delta is the point, so the last lap is coloured
      // against your own best and turns PURPLE when it is the field's fastest.
      const lastTxt = fmtT(s.last);
      setText(lastEl, lastTxt);
      const flS = s.flap && s.flap.s;
      let lastCls = "rVal";
      if (s.last > 0) {
        if (flS && Math.abs(s.last - flS) < 1e-6) lastCls += " purple";
        else if (s.best > 0 && s.last <= s.best + 1e-6) lastCls += " good";
        else if (s.best > 0) lastCls += " bad";
      }
      setCls(lastEl, lastCls);
      setText(bestEl, fmtT(s.best));
      setCls(bestEl, "rVal" + (flS && s.best > 0 && Math.abs(s.best - flS) < 1e-6 ? " purple" : ""));
      if (s.best > 0) A.lapsSeen++;

      setHTML(gapAEl, s.gapA && s.gapA.name
        ? "<span class='ahead'>▲</span> <span class='nm'>" + esc(s.gapA.name) + "</span> <b>+" + s.gapA.s.toFixed(1) + "s</b>"
        : "<span class='none'>▲, </span>");
      setHTML(gapBEl, s.gapB && s.gapB.name
        ? "<span class='behind'>▼</span> <span class='nm'>" + esc(s.gapB.name) + "</span> <b>−" + s.gapB.s.toFixed(1) + "s</b>"
        : "<span class='none'>▼, </span>");

      if (s.tower) renderTower(s.tower);

      // sectors: a lap is three acts, and each one is judged the moment it ends
      // A sector that has not been driven yet is a null HOLE in the array, not
      // a zero — an unset sector and a sector timed at 0.00 are different facts.
      if (s.sectors && s.sectors.length && s.sectors.some(Boolean)) {
        show(sectorEl, true, "flex");    // .rSectors is a flex row, not a block
        let done = 0, h = "";
        for (let i = 0; i < s.sectors.length; i++) {
          const sc = s.sectors[i];
          if (!sc) { h += "<span class='rSec'>S" + (i + 1) + " · </span>"; continue; }
          done++;
          const cls = sc.purple ? "purple" : sc.delta == null ? "" : sc.delta <= 0 ? "good" : "bad";
          h += "<span class='rSec " + cls + "'>S" + (i + 1) + " " +
            (sc.delta == null ? (sc.s > 0 ? sc.s.toFixed(2) : "—") : fmtD(sc.delta)) + "</span>";
        }
        A.sectorsSeen = Math.max(A.sectorsSeen, done);
        setHTML(sectorEl, h);
      } else show(sectorEl, false);

      if (s.flap && s.flap.s > 0) {
        show(flapEl, true);
        A.flapSeen++;
        setHTML(flapEl, "FASTEST LAP " + fmtT(s.flap.s) +
          (s.flap.name ? " <span class='nm'>" + esc(s.flap.name) + "</span>" : ""));
      } else show(flapEl, false);

      if (s.note) { show(noteEl, true); setText(noteEl, s.note); } else show(noteEl, false);

      if (s.flag) {
        flagEl.style.display = "block";
        setCls(flagEl, "rFlag " + s.flag);
        setText(flagEl, s.flag === "chequered" ? "CHEQUERED FLAG"
          : s.flag === "finished" ? "FINISHED"
          : s.flag === "white" ? "FINAL LAP" : s.flag.toUpperCase());
      } else if (flagEl.style.display !== "none") flagEl.style.display = "none";

      // ENGINE: perf() already makes a beaten-up car slower, and until now the
      // only way to learn that was to notice you had stopped catching anyone.
      if (s.damage != null) {
        show(dmgEl, true);
        const pc = Math.max(0, Math.min(1, s.damage));
        const fill = root.querySelector("#rhDmgFill");
        const w = Math.round(pc * 100) + "%";
        if (fill._w !== w) { fill.style.width = w; fill._w = w; }
        const col = pc > 0.66 ? "#7ed957" : pc > 0.33 ? "#ffd166" : "#ff5b5b";
        if (fill._col !== col) { fill.style.background = col; fill._col = col; }
      } else show(dmgEl, false);

      // the map redraws at ~20 Hz: it is 128 px of canvas and the cars have not
      // moved a pixel in 16 ms at any speed this game reaches.
      if (s.cars && TRACK) {
        const now = (CBZ.nowMs ? CBZ.nowMs() : Date.now());
        if (now - mapDrawT > 48) { mapDrawT = now; drawMap(s.cars); }
      }
    },
    results: function (rows, opts) {
      build();
      opts = opts || {};
      const touch = touchUI();
      const rawFoot = opts.foot || "Drive off to continue · Esc closes";
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
    /* CBZ.raceHud.audit() — THE RATCHET for the HUD half of this wave.
       `towerRows` and `mapCars` were structurally 0 (no producer, no element);
       both must climb, and `blindPanels` — panels the producer never fed — must
       fall. A HUD that renders nothing satisfies no counter here. */
    audit: function () {
      const panels = {
        tower: A.towerRows > 0, map: A.mapCars > 0, sectors: A.sectorsSeen > 0,
        fastestLap: A.flapSeen > 0, lapTimes: A.lapsSeen > 0,
      };
      let blind = 0;
      for (const k in panels) if (!panels[k]) blind++;
      return {
        built: !!root, shows: A.shown, lamps: lamps.length,
        towerRows: A.towerRows, mapCars: A.mapCars,
        sectors: A.sectorsSeen, flapSeen: A.flapSeen, lapsSeen: A.lapsSeen,
        trackSet: !!TRACK, panels: panels, blindPanels: blind,
      };
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
