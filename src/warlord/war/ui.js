/* ============================================================
   warlord/war/ui.js — THE WAR'S FACE: menu, clock, HUD, orders, diplomacy,
   the event feed, the battle call and the end.

   Everything on screen is read off the sim (sim.stats, townDefence,
   raisable, G.date) at the moment it is drawn. Nothing here keeps a number
   of its own. House signage law: no em dashes and no middle dots in any
   string that reaches the screen.

   Flow:  menu() -> pick a map -> pick a side -> start({map, faction})
          start() loads the map, makes the sim, mounts the view, runs the
          clock in a micro.onFrame hook, and routes taps into sim orders.
============================================================ */
(function () {
  "use strict";
  const G0 = typeof window !== "undefined" ? window : globalThis;
  const CBZ = (G0.CBZ = G0.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  const WAR = (W.war = W.war || {});
  const UI = (WAR.ui = WAR.ui || {});
  if (typeof document === "undefined") return;

  const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
  const SPEEDS = [0, 1.0, 0.5, 0.25, 0.1];          // seconds per day; 0 = paused
  const SPEED_LABEL = ["II", "1", "2", "3", "5"];

  let M = null, G = null, P = 0;
  let live = false, paused = false, speed = 1, lastSpeed = 1, acc = 0, frac = 0, bridging = false;
  let sel = [];
  let card = null, cardTimer = 0;
  let hoverTile = -1, hudDirty = true;
  let startOpts = null;
  let hooked = false;
  let root = null, menuEl = null, endEl = null;
  const menuCache = {};

  function S() { return WAR.sim; }
  function Vw() { return WAR.view; }
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function fmt(n) { return Math.round(n || 0).toLocaleString("en-US"); }
  function pct(x) { return (x * 100).toFixed(x < 0.1 ? 1 : 0) + "%"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function Q() { try { return new URLSearchParams(location.search); } catch (e) { return { get: function () { return null; } }; } }

  /* ================================================================ STYLE */
  const CSS = `
  #warUi{position:fixed;inset:0;pointer-events:none;z-index:70;font:600 13px/1.3 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#f4ecd8}
  #warUi *{box-sizing:border-box}
  #warUi .wu-p{pointer-events:auto}
  .wu-serif{font-family:"Cinzel","Cormorant SC",Georgia,"Times New Roman",serif}
  /* HUD PURGE: the six-chip stat strip (PEOPLE, MEN IN THE FIELD, GARRISONS,
     TOWNS, LAND) is gone. What is left is ONE thin bar: your colour, and how
     far your land is toward the win. It shows when the war starts and when a
     town changes hands, then fades. The numbers live in the MENU panel. */
  #wuHud{position:absolute;left:calc(env(safe-area-inset-left,0px) + 12px);top:calc(env(safe-area-inset-top,0px) + 14px);
    display:flex;gap:6px;opacity:0;transition:opacity .8s ease}
  #wuHud.show{opacity:1;transition-duration:.2s}
  .wu-goal{display:flex;align-items:center;gap:8px;padding:7px 10px}
  .wu-goal i{width:12px;height:12px;border-radius:3px;box-shadow:0 0 0 1px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.25)}
  .wu-goal .wu-bar{width:120px;height:5px;margin:0}
  .wu-chip{background:rgba(14,11,8,.78);border:1px solid rgba(255,255,255,.13);border-radius:10px;padding:5px 10px 6px;
    backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);box-shadow:0 2px 10px rgba(0,0,0,.35)}
  .wu-chip small{display:block;font-size:9px;letter-spacing:.2em;opacity:.58;font-weight:700}
  .wu-chip b{font-size:15px;font-variant-numeric:tabular-nums;letter-spacing:.02em}
  .wu-chip b em{font-style:normal;font-size:11px;opacity:.55;font-weight:600}
  .wu-fac{display:flex;align-items:center;gap:9px;padding:6px 12px}
  .wu-fac i{width:14px;height:14px;border-radius:4px;box-shadow:0 0 0 1px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.25)}
  .wu-fac span{font:700 15px/1 "Cinzel",Georgia,serif;letter-spacing:.08em}
  .wu-bar{height:3px;border-radius:2px;background:rgba(255,255,255,.12);margin-top:3px;position:relative;overflow:hidden}
  .wu-bar i{position:absolute;left:0;top:0;bottom:0;background:#ff8a3d}
  .wu-bar u{position:absolute;top:-1px;bottom:-1px;width:2px;background:#f4ecd8;opacity:.8}
  /* the clock is a CONTROL (pause, speed, menu), not a date readout; it
     rests dim until a hand is near it or the war is paused */
  #wuClock{position:absolute;right:calc(env(safe-area-inset-right,0px) + 12px);top:calc(env(safe-area-inset-top,0px) + 10px);
    display:flex;align-items:center;gap:8px;padding:5px 6px;opacity:.45;transition:opacity .4s ease}
  #wuClock:hover,#wuClock.paused{opacity:1}
  .wu-seg{display:flex;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,.14)}
  .wu-seg button{appearance:none;border:0;background:rgba(255,255,255,.04);color:#f4ecd8;font:800 12px/1 ui-sans-serif,system-ui,sans-serif;
    min-width:34px;height:32px;cursor:pointer;border-right:1px solid rgba(255,255,255,.1)}
  .wu-seg button:last-child{border-right:0}
  .wu-seg button.on{background:#ff8a3d;color:#1a1008}
  #wuFeed{position:absolute;left:calc(env(safe-area-inset-left,0px) + 12px);top:calc(env(safe-area-inset-top,0px) + 50px);
    display:flex;flex-direction:column;gap:5px;width:min(330px,70vw)}
  .wu-toast{pointer-events:auto;cursor:pointer;background:rgba(14,11,8,.84);border:1px solid rgba(255,255,255,.12);border-left:3px solid #8c8374;
    border-radius:8px;padding:6px 10px;font-size:12px;letter-spacing:.03em;animation:wuIn .22s ease-out;transition:opacity .5s}
  .wu-toast.good{border-left-color:#6fbf73}.wu-toast.bad{border-left-color:#e05a4a}.wu-toast.hot{border-left-color:#ff8a3d}
  .wu-toast b{font-weight:800}
  @keyframes wuIn{from{opacity:0;transform:translateX(-8px)}}
  #wuRail{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 12px);
    width:min(640px,calc(100% - 24px));display:none}
  #wuRail.on{display:block}
  .wu-panel{background:rgba(14,11,8,.86);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:10px 12px;
    backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 6px 24px rgba(0,0,0,.45)}
  .wu-head{display:flex;align-items:baseline;gap:10px;margin-bottom:8px;flex-wrap:wrap}
  .wu-head b{font:700 16px/1.1 "Cinzel",Georgia,serif;letter-spacing:.08em}
  .wu-head span{font-size:11px;letter-spacing:.12em;opacity:.7}
  .wu-head .cut{color:#ff9d8f;opacity:1}
  .wu-verbs{display:flex;gap:7px;flex-wrap:wrap}
  .wu-v{appearance:none;flex:1 1 90px;min-height:42px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:rgba(255,255,255,.05);
    color:#f4ecd8;font:800 12px/1.1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.1em;cursor:pointer;padding:7px 8px;
    display:flex;flex-direction:column;align-items:center;gap:3px}
  .wu-v:hover{background:rgba(255,255,255,.1)}
  .wu-v small{font-size:9px;opacity:.5;letter-spacing:.14em;font-weight:700}
  .wu-v.hot{border-color:#ff8a3d;background:rgba(255,138,61,.2);color:#ffe0c8}
  .wu-v.bad{border-color:#e05a4a;background:rgba(224,90,74,.16)}
  .wu-v[disabled]{opacity:.3;cursor:not-allowed}
  #wuCard{position:absolute;right:calc(env(safe-area-inset-right,0px) + 12px);bottom:calc(env(safe-area-inset-bottom,0px) + 12px);
    width:min(360px,calc(100% - 24px));display:none}
  #wuCard.on{display:block}
  @media (max-width:1100px){#wuCard{bottom:calc(env(safe-area-inset-bottom,0px) + 128px)}}
  .wu-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12px;margin:2px 0 10px}
  .wu-kv dt{opacity:.55;letter-spacing:.14em;font-size:10px;padding-top:2px}
  .wu-kv dd{margin:0;font-weight:800;font-variant-numeric:tabular-nums;text-align:right}
  .wu-vs{display:flex;align-items:center;justify-content:space-between;margin:4px 0 10px;font:800 20px/1 ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums}
  .wu-vs em{font-style:normal;font-size:10px;letter-spacing:.2em;opacity:.55}
  .wu-vs small{display:block;font-size:9px;letter-spacing:.18em;opacity:.6;margin-bottom:3px}
  .wu-sw{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:7px;vertical-align:-1px;box-shadow:0 0 0 1px rgba(0,0,0,.6)}
  .wu-mbtn{appearance:none;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(255,255,255,.05);color:#f4ecd8;
    font:800 11px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.14em;height:32px;padding:0 11px;cursor:pointer}
  .wu-mbtn:hover{background:rgba(255,255,255,.12)}
  #wuPause{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(8,6,4,.5)}
  #wuPause.on{display:flex}
  #wuPause .wu-panel{width:min(320px,calc(100% - 28px))}
  #wuPause .wu-v{flex:0 0 auto;width:100%;min-height:46px;font-size:13px}
  #wuMenu .hub{position:absolute;right:calc(env(safe-area-inset-right,0px) + 16px);top:calc(env(safe-area-inset-top,0px) + 16px)}
  #wuHint{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 14px);
    font-size:11px;letter-spacing:.16em;opacity:.55;text-shadow:0 1px 3px #000;white-space:nowrap;transition:opacity 1.2s ease}
  #wuHint.off{opacity:0}
  @media (max-width:760px){#wuFeed{top:calc(env(safe-area-inset-top,0px) + 56px)}}

  #wuMenu{position:fixed;inset:0;z-index:85;overflow:auto;display:none;color:#f4ecd8;
    background:radial-gradient(120% 90% at 50% 0%,#2b1f12 0%,#140f0a 55%,#0b0907 100%);
    font:600 14px/1.35 ui-sans-serif,system-ui,-apple-system,sans-serif}
  #wuMenu.on{display:block}
  #wuMenu .in{max-width:980px;margin:0 auto;padding:calc(env(safe-area-inset-top,0px) + 34px) 18px calc(env(safe-area-inset-bottom,0px) + 30px)}
  #wuMenu h1{margin:0;font:800 clamp(34px,7vw,64px)/.95 "Cinzel",Georgia,serif;letter-spacing:.06em}
  #wuMenu h1 em{font-style:normal;color:#ff8a3d}
  #wuMenu .sub{margin:10px 0 26px;font:italic 500 clamp(15px,2.4vw,19px)/1.3 "Cormorant Garamond",Georgia,serif;opacity:.78;max-width:640px}
  #wuMenu .lbl{font-size:11px;letter-spacing:.24em;opacity:.55;margin:22px 0 10px}
  .wm-maps{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px}
  .wm-map{appearance:none;text-align:left;color:inherit;font:inherit;cursor:pointer;border:1px solid rgba(255,255,255,.13);border-radius:14px;
    background:rgba(255,255,255,.035);padding:0;overflow:hidden;transition:border-color .15s,background .15s}
  .wm-map:hover{background:rgba(255,255,255,.07)}
  .wm-map.on{border-color:#ff8a3d;box-shadow:0 0 0 1px #ff8a3d}
  .wm-map canvas{display:block;width:100%;aspect-ratio:2/1;background:#1b2c3a;image-rendering:auto}
  .wm-map .t{padding:10px 12px 12px}
  .wm-map b{font:700 17px/1.1 "Cinzel",Georgia,serif;letter-spacing:.06em}
  .wm-map p{margin:5px 0 0;font:500 14px/1.3 "Cormorant Garamond",Georgia,serif;opacity:.8}
  .wm-facs{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:8px}
  .wm-fac{appearance:none;text-align:left;color:inherit;font:inherit;cursor:pointer;display:flex;gap:11px;align-items:center;
    border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(255,255,255,.03);padding:10px 12px}
  .wm-fac:hover{background:rgba(255,255,255,.07)}
  .wm-fac.on{border-color:#ff8a3d;box-shadow:0 0 0 1px #ff8a3d;background:rgba(255,138,61,.08)}
  .wm-fac i{flex:0 0 auto;width:26px;height:26px;border-radius:7px;box-shadow:0 0 0 1px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.2)}
  .wm-fac b{display:block;font:700 15px/1.1 "Cinzel",Georgia,serif;letter-spacing:.05em}
  .wm-fac span{display:block;font-size:11px;letter-spacing:.08em;opacity:.7;margin-top:4px;font-variant-numeric:tabular-nums}
  .wm-go{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px;align-items:center}
  .wm-btn{appearance:none;border:1px solid rgba(255,255,255,.18);border-radius:12px;background:rgba(255,255,255,.05);color:#f4ecd8;
    font:800 14px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.14em;padding:15px 22px;cursor:pointer;min-height:48px}
  .wm-btn.hot{border-color:#ff8a3d;background:#ff8a3d;color:#1a1008}
  .wm-btn.hot[disabled]{background:rgba(255,138,61,.2);color:#ffe0c8;opacity:.5;cursor:not-allowed}
  .wm-btn.small{font-size:11px;padding:11px 14px;min-height:40px;opacity:.75}
  .wm-note{font-size:11px;letter-spacing:.12em;opacity:.5}
  #wuEnd{position:fixed;inset:0;z-index:86;display:none;align-items:center;justify-content:center;background:rgba(8,6,4,.72);
    backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);color:#f4ecd8}
  #wuEnd.on{display:flex}
  #wuEnd .box{width:min(520px,calc(100% - 28px));padding:26px 24px}
  #wuEnd h2{margin:0 0 4px;font:800 clamp(30px,6vw,46px)/1 "Cinzel",Georgia,serif;letter-spacing:.08em}
  #wuEnd h2.win{color:#ffd166}#wuEnd h2.lose{color:#e05a4a}
  #wuEnd p{margin:0 0 16px;font:italic 500 17px/1.3 "Cormorant Garamond",Georgia,serif;opacity:.8}
  `;
  function ensureStyle() {
    if (!document.getElementById("warUiCss")) {
      const st = el("style"); st.id = "warUiCss"; st.textContent = CSS; document.head.appendChild(st);
    }
    if (!document.getElementById("warFonts")) {
      const l = el("link"); l.id = "warFonts"; l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;800&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&display=swap";
      document.head.appendChild(l);
    }
  }

  /* ================================================================ HELPERS */
  function dateStr() {
    const sd = M && M.data && M.data.startDate;
    if (!sd) return "DAY " + (G.day + 1);
    const d = G.date();
    return d.day + " " + MONTHS[d.month - 1] + " " + d.year + (d.era ? " " + d.era : "");
  }
  function fName(f) { if (!f) return "Free town"; const F = G.factions[f]; return F ? F.name : "?"; }
  function fCss(f) { if (!f) return "#d8cfb4"; const F = G.factions[f]; return F ? F.css : "#888"; }
  function armyName(a) {
    if (a.name) return a.name;
    if (a.free) return "Town militia";
    const F = G.factions[a.owner];
    return (F ? (F.adj || F.name) : "Free") + " army";
  }
  function nearestTown(tile) {
    const x = tile % M.w + 0.5, y = ((tile / M.w) | 0) + 0.5;
    let best = -1, bd = 1e18;
    for (let t = 0; t < M.towns.length; t++) {
      const d = (M.towns[t].x - x) * (M.towns[t].x - x) + (M.towns[t].y - y) * (M.towns[t].y - y);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  function relText(f) { const r = S().relation(G, P, f); return r === "war" ? "AT WAR" : r === "ally" ? "ALLIED" : r === "self" ? "YOU" : "AT PEACE"; }
  function hostileArmy(a) { if (!a) return false; if (a.owner === P && !a.free) return false; if (a.free || a.rogue) return true; return S().hostile(G, P, a.owner); }
  function townTakeable(t) { const o = G.townOwner[t]; return o !== P && (!o || S().relation(G, P, o) === "war"); }
  function selArmies() { const out = []; for (const id of sel) { const a = S().army(G, id); if (a && !a.dead) out.push(a); } return out; }
  function mySide(b) { return b.attOwner === P ? "att" : b.defOwner === P ? "def" : null; }

  /* ================================================================ DOM */
  function buildUi() {
    ensureStyle();
    if (root) return;
    root = el("div"); root.id = "warUi";
    root.innerHTML =
      '<div id="wuHud"></div>' +
      '<div id="wuClock" class="wu-chip wu-p"><div class="wu-seg" id="wuSeg"></div>' +
        '<button class="wu-mbtn" id="wuMenuBtn">MENU</button></div>' +
      '<div id="wuPause" class="wu-p"><div class="wu-panel"><div class="wu-head"><b>PAUSED</b><span id="wuPauseSub"></span></div>' +
        '<dl class="wu-kv" id="wuPauseKv"></dl>' +
        '<div class="wu-verbs" style="flex-direction:column">' +
        '<button class="wu-v hot" id="wuResume">RESUME</button>' +
        '<button class="wu-v" id="wuToMaps">CHOOSE ANOTHER MAP</button>' +
        '<button class="wu-v" id="wuToHub">MAIN MENU</button></div></div></div>' +
      '<div id="wuFeed"></div>' +
      '<div id="wuHint">TAP AN ARMY OF YOURS, THEN TAP WHERE IT GOES</div>' +
      '<div id="wuRail" class="wu-p"><div class="wu-panel"><div class="wu-head" id="wuRailHead"></div><div class="wu-verbs" id="wuRailVerbs"></div></div></div>' +
      '<div id="wuCard" class="wu-p"><div class="wu-panel" id="wuCardIn"></div></div>';
    document.body.appendChild(root);
    const seg = root.querySelector("#wuSeg");
    SPEED_LABEL.forEach(function (l, i) {
      const b = el("button", "", l);
      b.onclick = function () { if (i === 0) setPaused(!paused); else { setSpeed(i); setPaused(false); } };
      seg.appendChild(b);
    });
    root.querySelector("#wuMenuBtn").onclick = function () { openPause(); };
    root.querySelector("#wuResume").onclick = function () { closePause(); };
    root.querySelector("#wuToMaps").onclick = function () { closePause(); UI.menu(); };
    root.querySelector("#wuToHub").onclick = function () { toHub(); };
    // nothing in the UI may fall through to the map
    ["pointerdown", "wheel", "contextmenu"].forEach(function (ev) {
      root.addEventListener(ev, function (e) { if (e.target !== root) e.stopPropagation(); });
    });
    endEl = el("div"); endEl.id = "wuEnd"; document.body.appendChild(endEl);
  }
  /* THE WAY OUT. MENU pauses the war and offers RESUME, the map menu, and
     the game hub (../index.html). */
  let pauseOpen = false, pausedBefore = false;
  function openPause() {
    if (!root || pauseOpen) return;
    pauseOpen = true; pausedBefore = paused; setPaused(true);
    root.querySelector("#wuPauseSub").textContent = G ? dateStr() : "";
    const kv = root.querySelector("#wuPauseKv");
    if (kv && G) {
      const st = S().stats(G, P), goal = (M.win && M.win.share) || 0.7;
      kv.innerHTML = '<dt>TOWNS</dt><dd>' + st.towns + ' OF ' + M.towns.length + '</dd>' +
        '<dt>LAND</dt><dd>' + pct(st.share) + ' OF ' + Math.round(goal * 100) + '%</dd>' +
        '<dt>MEN</dt><dd>' + fmt(st.soldiers + st.garrisons) + '</dd>';
    }
    root.querySelector("#wuPause").classList.add("on");
  }
  function closePause() {
    if (!root || !pauseOpen) return;
    pauseOpen = false;
    root.querySelector("#wuPause").classList.remove("on");
    setPaused(pausedBefore);
  }
  function toHub() { try { location.href = "../index.html"; } catch (e) {} }
  UI.toHub = toHub;
  function showUi(on) { if (root) root.style.display = on ? "" : "none"; }

  /* ================================================================ HUD */
  let hudShare = -1, hudTimer = 0;
  function paintHud() {
    if (!root || !G) return;
    const st = S().stats(G, P), F = G.factions[P];
    const share = st.share, goal = (M.win && M.win.share) || 0.7;
    const hud = root.querySelector("#wuHud");
    hud.innerHTML =
      '<div class="wu-chip wu-goal"><i style="background:' + F.css + '"></i>' +
        '<div class="wu-bar"><i style="width:' + Math.min(100, share / goal * 100).toFixed(1) + '%"></i></div></div>';
    // the bar speaks only when the land moved (a town changed hands), then fades
    if (Math.abs(share - hudShare) > 1e-6) {
      hudShare = share;
      hud.classList.add("show");
      clearTimeout(hudTimer);
      hudTimer = setTimeout(function () { hud.classList.remove("show"); }, 4000);
    }
    paintClock();
    hudDirty = false;
  }
  function paintClock() {
    if (!root) return;
    root.querySelector("#wuClock").classList.toggle("paused", paused);
    const bs = root.querySelectorAll("#wuSeg button");
    for (let i = 0; i < bs.length; i++) bs[i].classList.toggle("on", paused ? i === 0 : i === speed);
  }
  function setPaused(on) { paused = !!on; paintClock(); }
  function setSpeed(i) { speed = Math.max(1, Math.min(SPEEDS.length - 1, i)); lastSpeed = speed; paintClock(); }
  UI.setSpeed = setSpeed; UI.pause = setPaused;

  /* ================================================================ FEED */
  function feed(html, kind, tile) {
    if (!root) return;
    const box = root.querySelector("#wuFeed");
    const t = el("div", "wu-toast " + (kind || ""), html);
    if (tile != null && tile >= 0) t.onclick = function () { Vw().focus(tile); };
    box.insertBefore(t, box.firstChild);
    while (box.children.length > 3) box.removeChild(box.lastChild);
    setTimeout(function () { t.style.opacity = "0"; setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 600); }, 5000);
  }
  UI.feed = feed;

  /* ================================================================ CARDS
     One card at a time. A battle outranks an offer outranks a question
     outranks information. */
  const RANK = { battle: 4, offer: 3, confirm: 2, info: 1 };
  function showCard(spec) {
    if (card && RANK[card.kind] > RANK[spec.kind]) return false;
    closeCard(true);
    card = spec; cardTimer = 0;
    const box = root.querySelector("#wuCardIn");
    let h = '<div class="wu-head"><b>' + spec.title + '</b>' + (spec.sub ? '<span>' + spec.sub + '</span>' : '') + '</div>';
    if (spec.body) h += spec.body;
    h += '<div class="wu-verbs">';
    (spec.verbs || []).forEach(function (v, i) {
      h += '<button class="wu-v ' + (v.kind || "") + '" data-i="' + i + '"' + (v.disabled ? " disabled" : "") + '>' + v.label +
           (v.note ? '<small>' + v.note + '</small>' : '') + '</button>';
    });
    h += '</div>';
    box.innerHTML = h;
    Array.prototype.forEach.call(box.querySelectorAll(".wu-v"), function (b) {
      b.onclick = function () { fireCard(parseInt(b.dataset.i, 10)); };
    });
    root.querySelector("#wuCard").classList.add("on");
    if (spec.onOpen) spec.onOpen();
    return true;
  }
  function fireCard(i) {
    if (!card) return;
    const v = card.verbs[i];
    if (!v || v.disabled) return;
    const c = card;
    closeCard(true);
    if (v.on) v.on(c);
  }
  function closeCard(silent) {
    if (!card) return;
    const c = card; card = null;
    if (root) root.querySelector("#wuCard").classList.remove("on");
    if (c.onClose) c.onClose(silent);
  }

  /* ================================================================ SELECTION & THE RAIL */
  function select(ids) {
    sel = (ids || []).filter(function (id) { const a = S().army(G, id); return a && a.owner === P && !a.free && a.home < 0; });
    Vw().select(sel);
    hoverTile = -1;
    paintRail();
  }
  UI.select = select;
  function railVerbs() {
    const L = selArmies();
    if (!L.length) return [];
    const a = L[0];
    const here = M.townAt[a.tile] - 1;
    const canRaise = here >= 0 && G.townOwner[here] === P && !a.battle ? S().raisable(G, here) : 0;
    const near = G.armies.filter(function (b) { return b !== a && b.owner === P && !b.free && b.home < 0 && !b.battle && Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) <= 1.6; });
    return [
      { label: "HOLD", key: "1  H", on: function () { S().order(G, sel, { kind: "hold" }); Vw().select(sel); paintRail(); } },
      { label: canRaise ? "RAISE " + fmt(canRaise) : "RAISE", key: "2  R", disabled: !canRaise, note: canRaise ? "" : (here >= 0 && G.townOwner[here] === P ? "NONE SPARE" : "IN YOUR TOWN"),
        on: function () { const n = S().raise(G, a.id); if (n) feed("<b>" + fmt(n) + "</b> men join from the garrison of " + esc(M.towns[here].name), "good", a.tile); paintRail(); hudDirty = true; } },
      { label: "SPLIT", key: "3", disabled: a.men < 100 || !!a.battle, note: a.men >= 100 ? fmt(Math.floor(a.men / 2)) : "",
        on: function () { const b = S().split(G, a.id, Math.floor(a.men / 2)); if (b) { Vw().dayTick(); select(sel.concat([b.id])); } } },
      { label: "MERGE", key: "4", disabled: !near.length, note: near.length ? "+" + fmt(near.reduce(function (s, b) { return s + b.men; }, 0)) : "NONE NEAR",
        on: function () { S().merge(G, [a.id].concat(near.map(function (b) { return b.id; }))); Vw().dayTick(); select([a.id]); } },
      { label: "CLEAR", key: "5  ESC", on: function () { select([]); } },
    ];
  }
  let hintDone = false;
  function paintRail() {
    if (!root) return;
    const rail = root.querySelector("#wuRail");
    const L = selArmies();
    // the one first-seconds hint: gone for good after the first selection or a week of war
    if (L.length) hintDone = true;
    root.querySelector("#wuHint").classList.toggle("off", hintDone || !!(G && G.day > 6));
    if (!L.length) { rail.classList.remove("on"); sel = []; return; }
    const a = L[0];
    const men = L.reduce(function (s, x) { return s + x.men; }, 0);
    root.querySelector("#wuRailHead").innerHTML =
      '<b>' + esc(L.length > 1 ? L.length + " ARMIES" : armyName(a)).toUpperCase() + '</b>' +
      '<span>' + fmt(men) + ' MEN</span>' +
      (a.supplied ? '' : '<span class="cut">CUT OFF</span>');
    const vb = root.querySelector("#wuRailVerbs");
    const verbs = railVerbs();
    vb.innerHTML = "";
    verbs.forEach(function (v, i) {
      const b = el("button", "wu-v " + (v.kind || ""), v.label + (v.note ? '<small>' + v.note + '</small>' : ''));
      if (v.disabled) b.disabled = true;
      b.onclick = function () { if (!v.disabled) v.on(); };
      vb.appendChild(b);
    });
    rail._verbs = verbs;
    rail.classList.add("on");
  }

  /* ================================================================ ORDERS */
  function orderMove(tile, silent) {
    const L = selArmies();
    if (!L.length) return;
    S().order(G, sel, { kind: "move", to: tile });
    let ok = 0;
    for (const a of L) if (a.order.kind === "move") ok++;
    Vw().select(sel);
    Vw().preview(null);
    if (!silent) {
      if (!ok) feed("<b>NO ROAD THERE</b>", "bad", tile);
    }
    paintRail();
  }
  function orderChase(a) {
    S().order(G, sel, { kind: "chase", target: a.id });
    Vw().select(sel); Vw().preview(null);
    paintRail();
  }
  function marchCard(t) {
    const T = M.towns[t], d = S().townDefence(G, t), o = G.townOwner[t];
    const mine = selArmies().reduce(function (s, a) { return s + a.men; }, 0);
    const path = sel.length ? S().path(G, sel[0], T.tile) : null;
    Vw().preview(path);
    showCard({
      kind: "confirm",
      title: esc(String(T.name).toUpperCase()),
      sub: '<span class="wu-sw" style="background:' + fCss(o) + '"></span>' + esc(fName(o)).toUpperCase(),
      body: '<div class="wu-vs"><div><small>YOU</small>' + fmt(mine) + '</div><em>AGAINST</em><div style="text-align:right"><small>GARRISON</small>' + fmt(d.garrison) + '</div></div>' +
            '',
      verbs: [
        { label: "MARCH", kind: "hot", disabled: !path, note: path ? "" : "NO ROAD", on: function () { orderMove(T.tile); } },
        { label: "CANCEL", on: function () { Vw().preview(null); } },
      ],
      onClose: function () { Vw().preview(null); },
    });
  }
  function townCard(t) {
    const T = M.towns[t], o = G.townOwner[t], d = S().townDefence(G, t);
    if (o === P) {
      const r = S().raisable(G, t);
      showCard({
        kind: "info", title: esc(String(T.name).toUpperCase()), sub: T.capital ? "YOUR CAPITAL" : "YOUR TOWN",
        body: '<dl class="wu-kv"><dt>GARRISON</dt><dd>' + fmt(d.garrison) + '</dd></dl>',
        verbs: [
          { label: r >= 50 ? "LEVY " + fmt(r) : "LEVY", kind: "hot", disabled: r < 50, note: r < 50 ? "NONE SPARE" : "",
            on: function () { const a = S().levy(G, t); if (a) { Vw().dayTick(); select([a.id]); feed("<b>" + fmt(a.men) + "</b> men stand up at " + esc(T.name), "good", T.tile); hudDirty = true; } } },
          { label: "CLOSE", on: function () {} },
        ],
      });
      return;
    }
    const verbs = diploVerbs(o);
    showCard({
      kind: "info", title: esc(String(T.name).toUpperCase()),
      sub: '<span class="wu-sw" style="background:' + fCss(o) + '"></span>' + esc(fName(o)).toUpperCase() + (o ? "  " + relText(o) : ""),
      body: '<dl class="wu-kv"><dt>GARRISON</dt><dd>' + fmt(d.garrison) + (d.out ? " (MARCHED OUT)" : "") + '</dd></dl>',
      verbs: verbs.concat([{ label: "CLOSE", on: function () {} }]),
      onOpen: function () { if (o) Vw().hiFaction(o); },
      onClose: function () { Vw().hiFaction(-1); },
    });
  }
  function diploVerbs(f) {
    if (!f || f === P || f === G.ROGUE) return [];
    const r = S().relation(G, P, f);
    if (r === "war") {
      const ok = S().peaceAcceptable(G, f, P) || S().peaceAcceptable(G, P, f);
      return [{ label: "OFFER PEACE", disabled: !ok, note: ok ? "" : "THEY WILL NOT", on: function () {
        if (S().makePeace(G, P, f)) { feed("<b>PEACE</b> with " + esc(fName(f)), "good"); hudDirty = true; }
      } }];
    }
    if (r === "peace") {
      return [{ label: "DECLARE WAR", kind: "bad", on: function () {
        if (S().declareWar(G, P, f)) { feed("<b>WAR.</b> you declare war on " + esc(fName(f)), "bad"); drainEvents(); }
      } }];
    }
    return [];
  }
  function factionCard(f) {
    const F = G.factions[f];
    if (!F || f === P) return;
    const st = S().stats(G, f);
    showCard({
      kind: "info", title: esc(F.name).toUpperCase(), sub: '<span class="wu-sw" style="background:' + F.css + '"></span>' + relText(f),
      body: '<dl class="wu-kv"><dt>TOWNS</dt><dd>' + st.towns + '</dd><dt>MEN</dt><dd>' + fmt(st.soldiers + st.garrisons) + '</dd></dl>',
      verbs: diploVerbs(f).concat([{ label: "CLOSE", on: function () {} }]),
      onOpen: function () { Vw().hiFaction(f); },
      onClose: function () { Vw().hiFaction(-1); },
    });
  }
  function armyCard(a) {
    const o = a.free ? 0 : a.owner;
    const verbs = !a.rogue && !a.free ? diploVerbs(a.owner) : [];
    showCard({
      kind: "info", title: esc(armyName(a)).toUpperCase(),
      sub: '<span class="wu-sw" style="background:' + (a.rogue ? "#8c8374" : fCss(o)) + '"></span>' + (a.rogue ? "WARBAND" : a.free ? "FREE TOWN" : esc(fName(o)).toUpperCase() + "  " + relText(o)),
      body: '<dl class="wu-kv"><dt>MEN</dt><dd>' + fmt(a.men) + '</dd>' +
            (a.supplied ? '' : '<dt>SUPPLY</dt><dd style="color:#ff9d8f">CUT OFF</dd>') + '</dl>',
      verbs: verbs.concat([{ label: "CLOSE", on: function () {} }]),
    });
  }

  /* ================================================================ TAPS */
  function onTap(ev) {
    if (!live || bridging || G.over) return;
    const p = Vw().pick(ev.x, ev.y);
    const a = p.army;
    if (a && a.owner === P && !a.free && a.home < 0) {
      if (ev.shift) {
        const i = sel.indexOf(a.id);
        select(i >= 0 ? sel.filter(function (x) { return x !== a.id; }) : sel.concat([a.id]));
      } else select([a.id]);
      if (card && card.kind === "info") closeCard();
      return;
    }
    if (sel.length) {
      if (a && hostileArmy(a)) { orderChase(a); return; }
      if (a && !hostileArmy(a) && a.owner !== P) { armyCard(a); return; }
      if (p.town >= 0 && townTakeable(p.town)) { marchCard(p.town); return; }
      if (p.town >= 0 && G.townOwner[p.town] && G.townOwner[p.town] !== P && S().relation(G, P, G.townOwner[p.town]) !== "war") {
        townCard(p.town); return;
      }
      if (p.town >= 0) { orderMove(M.towns[p.town].tile); return; }
      if (p.tile >= 0 && M.land[p.tile]) { orderMove(p.tile); return; }
      select([]);
      return;
    }
    if (p.town >= 0) { townCard(p.town); return; }
    if (a) { armyCard(a); return; }
    if (p.battle) { const b = p.battle; feed("<b>BATTLE</b> at " + esc(M.towns[nearestTown(b.tile)].name), "hot", b.tile); return; }
    if (p.tile >= 0 && G.owner[p.tile] && G.owner[p.tile] !== P) { factionCard(G.owner[p.tile]); return; }
    closeCard();
  }
  function onHover(ev) {
    if (!live || bridging || !sel.length || (card && card.kind === "confirm")) return;
    const p = Vw().pick(ev.x, ev.y);
    let tile = p.tile;
    if (p.army && hostileArmy(p.army)) tile = p.army.tile;
    else if (p.town >= 0) tile = M.towns[p.town].tile;
    if (tile === hoverTile) return;
    hoverTile = tile;
    if (tile < 0 || !M.land[tile]) { Vw().preview(null); return; }
    Vw().preview(S().path(G, sel[0], tile));
  }
  function onBox(ev) {
    if (!live) return;
    const mine = ev.ids.filter(function (id) { const a = S().army(G, id); return a && a.owner === P && !a.free && a.home < 0; });
    select(mine);
  }

  /* ================================================================ EVENTS */
  let pendingBattles = [];
  function drainEvents() {
    const ev = G.events.splice(0);
    Vw().onEvents(ev);
    handleEvents(ev);
  }
  function handleEvents(list) {
    for (const e of list) {
      switch (e.type) {
        case "town": {
          const T = M.towns[e.town];
          if (e.to === P) feed("<b>" + esc(T.name).toUpperCase() + " IS YOURS.</b> " + fmt(G.townPop[e.town]) + " people", "good", T.tile);
          else if (e.from === P) feed("<b>" + esc(T.name).toUpperCase() + " IS LOST</b> to " + esc(fName(e.to)), "bad", T.tile);
          hudDirty = true;
          break;
        }
        case "sally": {
          const tgt = S().army(G, e.against);
          if (tgt && tgt.owner === P) feed("<b>THE GARRISON OF " + esc(M.towns[e.town].name).toUpperCase() + " MARCHES OUT</b> at you, " + fmt(e.men) + " men", "hot", M.towns[e.town].tile);
          break;
        }
        case "surrender": {
          const T = M.towns[e.town];
          if (e.to === P) feed("<b>" + fmt(e.men) + " men of " + esc(T.name) + " lay down their arms.</b> they go home", "good", T.tile);
          else if (e.owner === P) feed("<b>the garrison of " + esc(T.name) + " surrenders</b>, " + fmt(e.men) + " men", "bad", T.tile);
          break;
        }
        case "battle": {
          if (e.phase === "start") {
            if (e.att === P || e.def === P) pendingBattles.push(e);
          } else if (e.phase === "end") {
            if (e.att === P || e.def === P) {
              const won = e.winner === P;
              const mine = e.att === P ? e.attLoss : e.defLoss, theirs = e.att === P ? e.defLoss : e.attLoss;
              const tn = M.towns[nearestTown(e.tile)].name;
              feed("<b>" + (won ? "VICTORY" : e.winner ? "DEFEAT" : "BATTLE BROKEN OFF") + " AT " + esc(tn).toUpperCase() + ".</b> you lost " + fmt(mine) + ", they lost " + fmt(theirs), won ? "good" : "bad", e.tile);
              if (card && card.kind === "battle" && card.battle === e.id) closeCard(true);
              hudDirty = true;
            }
          }
          break;
        }
        case "cut": { const a = S().army(G, e.army); if (e.owner === P) feed("<b>" + esc(a ? armyName(a) : "An army").toUpperCase() + " IS CUT OFF.</b> it will starve", "bad", e.tile); break; }
        case "war":
          if (e.b === P) feed("<b>" + esc(fName(e.a)).toUpperCase() + " DECLARES WAR ON YOU</b>", "bad");
          else if (e.a === P && e.b) feed("<b>AT WAR</b> with " + esc(fName(e.b)), "bad");
          break;
        case "peace": if (e.a === P || e.b === P) feed("<b>PEACE</b> with " + esc(fName(e.a === P ? e.b : e.a)), "good"); break;
        case "ally": if (e.a === P || e.b === P) feed("<b>ALLIANCE</b> with " + esc(fName(e.a === P ? e.b : e.a)), "good"); break;
        case "destroyed": if (e.owner === P) feed("<b>AN ARMY OF " + fmt(e.men) + " IS DESTROYED.</b> hemmed in, it surrendered", "bad", e.tile); break;
        case "sacked": if (G.townOwner[e.town] === P) feed("<b>RAIDERS SACK " + esc(M.towns[e.town].name).toUpperCase() + "</b>", "bad", M.towns[e.town].tile); break;
        case "dead": feed("<b>" + esc(fName(e.faction)).toUpperCase() + " IS NO MORE.</b>", e.faction === P ? "bad" : ""); break;
        case "offer":
          if (e.to === P && S().relation(G, P, e.from) === "war") offerCard(e.from);
          break;
        case "win": case "lose": endGame(); break;
      }
    }
  }
  function offerCard(f) {
    showCard({
      kind: "offer", title: esc(fName(f)).toUpperCase() + " ASKS FOR PEACE",
      sub: '<span class="wu-sw" style="background:' + fCss(f) + '"></span>' + "AT WAR",
      body: '<dl class="wu-kv"><dt>THEIR TOWNS</dt><dd>' + G.factions[f].towns + '</dd><dt>THEIR MEN</dt><dd>' + fmt(G.factions[f].soldiers + G.factions[f].garrisons) + '</dd></dl>',
      verbs: [
        { label: "ACCEPT PEACE", kind: "hot", on: function () { if (S().makePeace(G, P, f)) { drainEvents(); hudDirty = true; } } },
        { label: "REFUSE", kind: "bad", on: function () { feed("you refuse " + esc(fName(f)) + ". the war goes on", "bad"); } },
      ],
      onOpen: function () { Vw().hiFaction(f); },
      onClose: function () { Vw().hiFaction(-1); },
    });
  }
  function battleCard(e) {
    const b = S().battleById(G, e.id);
    if (!b || b.watched) return false;
    const side = mySide(b);
    let am = 0, dm = 0;
    for (const id of b.att) { const a = S().army(G, id); if (a) am += a.men; }
    for (const id of b.def) { const a = S().army(G, id); if (a) dm += a.men; }
    const you = side === "att" ? am : dm, them = side === "att" ? dm : am;
    const foeOwner = side === "att" ? b.defOwner : b.attOwner;
    const foeA = S().army(G, side === "att" ? b.def[0] : b.att[0]);
    const foeName = foeA ? armyName(foeA) : fName(foeOwner);
    const tn = M.towns[nearestTown(b.tile)].name;
    const canWatch = !!(WAR.bridge && WAR.bridge.watch && W.battle && W.battle.start);
    return showCard({
      kind: "battle", battle: b.id, timeout: 4,
      title: "BATTLE AT " + esc(tn).toUpperCase(),
      sub: esc(foeName).toUpperCase(),
      body: '<div class="wu-vs"><div><small>YOU</small><span style="color:' + fCss(P) + '">' + fmt(you) + '</span></div><em>VS</em>' +
            '<div style="text-align:right"><small>THEM</small><span style="color:' + (foeA && foeA.rogue ? "#b0a894" : fCss(foeOwner)) + '">' + fmt(them) + '</span></div></div>',
      verbs: [
        { label: "FIGHT IT", kind: "hot", disabled: !canWatch, on: function () { WAR.bridge.watch(G, b.id); } },
        { label: "LET IT PLAY", on: function () {} },
      ],
      onOpen: function () { Vw().focus(b.tile); },
    });
  }

  /* ================================================================ THE CLOCK */
  function stepDay() {
    S().step(G, 1);
    drainEvents();
    Vw().dayTick();
    hudDirty = true;
    if (sel.length) {
      // armies die, merge and get cut off under you
      const before = sel.length;
      sel = sel.filter(function (id) { const a = S().army(G, id); return a && !a.dead; });
      if (sel.length !== before) Vw().select(sel);
      paintRail();
    }
  }
  function frame() {
    if (!live || !G) return;
    const mc = CBZ.micro;
    if (mc && mc.drawing === false) return;
    if (bridging) return;
    const dt = Math.min(0.1, (mc && mc.frameDt) || 0.016);
    if (!paused && !G.over) {
      const spd = SPEEDS[speed];
      acc += dt;
      let n = 0;
      while (acc >= spd && n < 3 && !G.over && !bridging) { acc -= spd; stepDay(); n++; }
      if (acc > spd) acc = spd * 0.999;
      frac = acc / spd;
    }
    if (bridging) return;
    // a battle of yours asks once
    if (pendingBattles.length && (!card || RANK[card.kind] < RANK.battle)) {
      while (pendingBattles.length) { const e = pendingBattles.shift(); if (battleCard(e)) break; }
    }
    if (card && card.timeout) {
      cardTimer += dt;
      if (cardTimer >= card.timeout) closeCard();
    }
    if (card && card.kind === "battle" && !S().battleById(G, card.battle)) closeCard(true);
    Vw().frame(dt, frac);
    if (hudDirty) paintHud();
  }

  /* ================================================================ KEYS */
  function onKey(e) {
    if (!live || bridging || (W.phase && W.phase() !== "war")) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (pauseOpen && e.code !== "Escape") return;
    if (e.code === "Space") { e.preventDefault(); setPaused(!paused); return; }
    if (e.key === "+" || e.key === "=") { setSpeed(speed + 1); setPaused(false); return; }
    if (e.key === "-" || e.key === "_") { setSpeed(speed - 1); return; }
    if (e.code === "Escape") { if (pauseOpen) closePause(); else if (card) closeCard(); else if (sel.length) select([]); else openPause(); return; }
    if (pauseOpen) return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 5) {
      e.preventDefault();
      if (card) { fireCard(n - 1); return; }
      const rail = root && root.querySelector("#wuRail");
      if (rail && rail._verbs && sel.length) { const v = rail._verbs[n - 1]; if (v && !v.disabled) v.on(); }
      return;
    }
    if (sel.length && rail2(e.code)) return;
  }
  function rail2(code) {
    const rail = root && root.querySelector("#wuRail");
    if (!rail || !rail._verbs) return false;
    if (code === "KeyH") { rail._verbs[0].on(); return true; }
    if (code === "KeyR" && !rail._verbs[1].disabled) { rail._verbs[1].on(); return true; }
    return false;
  }

  /* ================================================================ START / STOP */
  function hook() {
    if (hooked || !CBZ.micro) return;
    hooked = true;
    CBZ.micro.onFrame(frame, { order: 40, id: "war-ui" });
    window.addEventListener("keydown", onKey);
    Vw().on("tap", onTap);
    Vw().on("hover", onHover);
    Vw().on("box", onBox);
    if (W.on) {
      W.on("phase", function (t) {
        if (!t) return;
        if (t.to !== "menu") hideMenu();
        showUi(t.to === "war" && live);
      });
    }
  }
  UI.start = function (opts) {
    opts = opts || {};
    buildUi();
    hook();
    hideMenu();
    endEl.classList.remove("on");
    const K = WAR.mapkit;
    const mapId = opts.map || "mediterranean";
    const cached = menuCache[mapId];
    M = cached && cached.M ? cached.M : K.load(mapId);
    const fi = M.factionIndex(opts.faction) || (M.factions.find(function (f) { return f.playable; }) || M.factions[0]).i;
    const q = Q();
    const seed = opts.seed || parseInt(q.get("seed") || "", 10) || ((Math.random() * 1e9) | 0) || 1;
    G = S().create(M, { player: fi, seed: seed });
    P = fi;
    startOpts = { map: mapId, faction: M.factions[fi - 1].id, seed: seed };
    sel = []; card = null; pendingBattles = []; acc = 0; frac = 0; bridging = false; paused = false;
    speed = parseInt(q.get("warspeed") || "", 10) || 1;
    if (speed < 1 || speed >= SPEEDS.length) speed = 1;
    if (q.get("warpause") === "1") paused = true;
    const ctx = CBZ.warlordCtx;
    if (ctx && ctx.closeScreen) ctx.closeScreen();
    if (ctx && ctx.closeVerbs) ctx.closeVerbs();
    Vw().onFirstFrame = function () { window.__warReady = true; };
    window.__warReady = false;
    Vw().mount(M, G);
    live = true;
    if (W.setPhase) W.setPhase("war");
    showUi(true);
    root.querySelector("#wuFeed").innerHTML = "";
    closeCard(true);
    hintDone = false; hudShare = -1;
    paintHud();
    paintRail();
    UI.expose();
    return G;
  };
  UI.expose = function () { window.__war = { M: M, G: G, view: Vw(), ui: UI, player: P }; };
  UI.stop = function () {
    live = false;
    if (pauseOpen) { pauseOpen = false; if (root) root.querySelector("#wuPause").classList.remove("on"); }
    closeCard(true);
    Vw().unmount();
    showUi(false);
    sel = []; G = null; M = null;
    window.__warReady = false;
  };
  UI.live = function () { return live; };
  UI.state = function () { return { M: M, G: G, player: P, paused: paused, speed: speed, sel: sel.slice(), card: card && card.kind, bridging: bridging }; };
  // the bridge freezes and resumes the clock around a fought battle
  UI.bridgeBegin = function () { bridging = true; closeCard(true); showUi(false); };
  UI.bridgeEnd = function () {
    bridging = false; acc = 0;
    if (W.setPhase) W.setPhase("war");
    showUi(true);
    drainEvents(); Vw().dayTick(); hudDirty = true; paintRail();
  };

  /* ================================================================ END */
  function endGame() {
    if (!G || !G.over || !endEl) return;
    paused = true; paintClock();
    const won = G.over.win === P;
    const st = S().stats(G, P), F = G.factions[P];
    const winner = G.over.win ? G.factions[G.over.win] : null;
    endEl.innerHTML =
      '<div class="box wu-panel">' +
      '<h2 class="' + (won ? "win" : "lose") + '">' + (won ? "VICTORY" : "DEFEAT") + '</h2>' +
      '<p>' + (won ? esc(F.name) + " holds the map after " + (G.day) + " days."
                   : winner && winner.i !== P ? esc(winner.name) + " holds the map. " + esc(F.name) + " did not." : esc(F.name) + " has no towns left.") + '</p>' +
      '<dl class="wu-kv"><dt>TOWNS HELD</dt><dd>' + st.towns + ' OF ' + M.towns.length + '</dd></dl>' +
      '<div class="wu-verbs"><button class="wu-v hot" id="wuAgain">PLAY AGAIN</button><button class="wu-v" id="wuMenuB">MENU</button></div></div>';
    endEl.classList.add("on");
    endEl.querySelector("#wuAgain").onclick = function () { const o = Object.assign({}, startOpts, { seed: 0 }); UI.stop(); UI.start(o); };
    endEl.querySelector("#wuMenuB").onclick = function () { UI.stop(); UI.menu(); };
  }

  /* ================================================================ MENU */
  let pick = { map: null, faction: null };
  function hideMenu() { if (menuEl) menuEl.classList.remove("on"); }
  UI.menu = function () {
    ensureStyle();
    buildUi();
    hook();
    if (live) UI.stop();
    if (endEl) endEl.classList.remove("on");
    const ctx = CBZ.warlordCtx;
    if (ctx && ctx.closeScreen) ctx.closeScreen();
    if (ctx && ctx.closeVerbs) ctx.closeVerbs();
    if (W.setPhase) W.setPhase("menu");
    if (!menuEl) { menuEl = el("div"); menuEl.id = "wuMenu"; document.body.appendChild(menuEl); }
    const maps = WAR.mapkit ? WAR.mapkit.list() : [];
    const resume = W.hasSave && W.hasSave();
    menuEl.innerHTML =
      '<button class="wm-btn small hub" id="wmHub">MAIN MENU</button>' +
      '<div class="in">' +
      '<h1>DESERT <em>WARLORD</em></h1>' +
      '<div style="height:18px"></div>' +
      '<div class="lbl">CHOOSE A MAP</div><div class="wm-maps" id="wmMaps"></div>' +
      '<div class="lbl">CHOOSE A SIDE</div><div class="wm-facs" id="wmFacs"><div class="wm-note">PICK A MAP FIRST</div></div>' +
      '<div class="wm-go"><button class="wm-btn hot" id="wmPlay" disabled data-boot-entry>PLAY</button><span class="wm-note" id="wmPick"></span></div>' +
      '<div class="wm-go"><button class="wm-btn small" id="wmRide">RIDE THE ISLAND</button>' +
      (resume ? '<button class="wm-btn small" id="wmCont">CONTINUE THE RIDE</button>' : '') +
      '<button class="wm-btn small" id="wmNet">MULTIPLAYER</button></div>' +
      '</div>';
    menuEl.classList.add("on");
    const box = menuEl.querySelector("#wmMaps");
    maps.forEach(function (m) {
      const b = el("button", "wm-map");
      b.innerHTML = '<canvas width="440" height="220"></canvas><div class="t"><b>' + esc(m.name).toUpperCase() + '</b><p>' + esc(m.blurb || "") + '</p></div>';
      b.onclick = function () { chooseMap(m.id); };
      b.dataset.id = m.id;
      box.appendChild(b);
    });
    // thumbnails, one map at a time so the menu paints first
    let k = 0;
    (function next() {
      if (k >= maps.length || !menuEl.classList.contains("on")) return;
      const id = maps[k++].id;
      setTimeout(function () { try { thumb(id); } catch (e) { console.warn("[war/ui] thumb", id, e); } next(); }, 30);
    })();
    menuEl.querySelector("#wmHub").onclick = toHub;
    menuEl.querySelector("#wmPlay").onclick = function () { if (pick.map && pick.faction) UI.start({ map: pick.map, faction: pick.faction }); };
    menuEl.querySelector("#wmRide").onclick = function () {
      hideMenu();
      const seed = parseInt(Q().get("seed") || "", 10) || undefined;
      W.newGame({ seed: seed });
      if (W.campaign && W.campaign.enter) W.campaign.enter();
    };
    const c = menuEl.querySelector("#wmCont");
    if (c) c.onclick = function () {
      hideMenu();
      if (W.load() && W.campaign && W.campaign.enter) W.campaign.enter();
      else { menuEl.classList.add("on"); if (W.toast) W.toast("that save is from an older build", "bad"); }
    };
    menuEl.querySelector("#wmNet").onclick = function () {
      if (W.warnet && W.warnet.lobby) { hideMenu(); W.warnet.lobby(); }
      else if (W.toast) W.toast("multiplayer did not load", "bad");
    };
    // a map and a side are always chosen, so PLAY always works: the first map
    // in the list and its first playable side, until the player picks others
    if (pick.map && maps.some(function (m) { return m.id === pick.map; })) chooseMap(pick.map);
    else if (maps.length) chooseMap(maps.some(function (m) { return m.id === "mediterranean"; }) ? "mediterranean" : maps[0].id);
  };
  function loadForMenu(id) {
    let c = menuCache[id];
    if (c && c.G) return c;
    const Mm = WAR.mapkit.load(id);
    const Gm = S().create(Mm, { player: 0, seed: 1 });
    c = menuCache[id] = { M: Mm, G: Gm };
    return c;
  }
  function thumb(id) {
    const c = loadForMenu(id);
    const Mm = c.M, Gm = c.G;
    const btn = menuEl && menuEl.querySelector('.wm-map[data-id="' + id + '"] canvas');
    if (!btn) return;
    const w = Mm.w, h = Mm.h;
    btn.width = w; btn.height = h;
    btn.style.aspectRatio = w + "/" + h;
    const x = btn.getContext("2d");
    const img = x.createImageData(w, h);
    const pal = [];
    for (let k = 0; k < 8; k++) {
      const T = Mm.TERRAIN[k];
      pal.push(T.colour.map(function (v) { return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); }));
    }
    const fc = Gm.factions.map(function (F) { if (!F) return null; const n = parseInt(String(F.css).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
    for (let i = 0; i < w * h; i++) {
      const t = Mm.terrain[i];
      let r, g, b;
      if (t === 0 || t === 7) { const d = Math.min(1, Math.max(0, -Mm.height[i]) / 1500); r = 70 - 45 * d; g = 130 - 80 * d; b = 150 - 65 * d; }
      else {
        const p = pal[t];
        r = p[0]; g = p[1]; b = p[2];
        const o = Gm.owner[i];
        if (o && fc[o]) { r = r * 0.5 + fc[o][0] * 0.5; g = g * 0.5 + fc[o][1] * 0.5; b = b * 0.5 + fc[o][2] * 0.5; }
      }
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
  }
  function chooseMap(id) {
    pick.map = id;
    Array.prototype.forEach.call(menuEl.querySelectorAll(".wm-map"), function (b) { b.classList.toggle("on", b.dataset.id === id); });
    const box = menuEl.querySelector("#wmFacs");
    box.innerHTML = '<div class="wm-note">READING THE MAP</div>';
    setTimeout(function () {
      let c;
      try { c = loadForMenu(id); } catch (e) { box.innerHTML = '<div class="wm-note">THIS MAP DID NOT LOAD</div>'; console.error(e); return; }
      const Gm = c.G, Mm = c.M;
      const rows = [];
      for (let f = 1; f < Gm.ROGUE; f++) {
        const md = Mm.factions[f - 1];
        if (!md || !md.playable) continue;
        const st = S().stats(Gm, f);
        rows.push({ f: f, id: md.id, name: md.name, css: md.css, st: st });
      }
      rows.sort(function (a, b) { return b.st.people - a.st.people; });
      box.innerHTML = "";
      rows.forEach(function (r) {
        const b = el("button", "wm-fac");
        b.dataset.id = r.id;
        b.innerHTML = '<i style="background:' + r.css + '"></i><div><b>' + esc(r.name) + '</b><span>' +
          r.st.towns + ' TOWNS</span></div>';
        b.onclick = function () { chooseFaction(r.id, r.name); };
        box.appendChild(b);
      });
      if (!rows.length) box.innerHTML = '<div class="wm-note">NO PLAYABLE SIDE ON THIS MAP</div>';
      const keep = rows.find(function (r) { return r.id === pick.faction; });
      const first = keep || rows.slice().sort(function (a, b) { return a.f - b.f; })[0];
      if (first) chooseFaction(first.id, first.name); else { pick.faction = null; paintPick(); }
    }, 20);
  }
  function chooseFaction(id, name) {
    pick.faction = id;
    Array.prototype.forEach.call(menuEl.querySelectorAll(".wm-fac"), function (b) { b.classList.toggle("on", b.dataset.id === id); });
    paintPick(name);
  }
  function paintPick(name) {
    const b = menuEl.querySelector("#wmPlay");
    b.disabled = !(pick.map && pick.faction);
    menuEl.querySelector("#wmPick").textContent = "";
  }
})();
