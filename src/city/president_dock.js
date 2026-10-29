/* ============================================================
   city/president_dock.js — THE PRESIDENT'S BUTTONS ON A PHONE.

   OWNER (2026-10-28, on his iPhone): "On my phone, I literally can't
   interact with anything in the president game."

   Why: the desk was built for "tap the thing", and on a phone held upright
   the eye in the chair sees about 40 degrees across. The phone (0.8 m to his
   right), the folder pile (0.8 m to his left) and the briefing book were off
   the screen, so there was nothing to tap, and nothing said there was
   anything to do. A ringing phone could not be answered.

   So on touch, the things he can do right now are a short row of buttons:
     at the desk     Answer phone (it rings: the button pulses), Folders n,
                     Briefing, Call back (someone is waiting)
     a folder open   its own words: Sign / Veto / Put down
     the book open   Back / Close / Next (and a swipe or the curled corner
                     still turn it; the stick and the fire button are hidden
                     while he reads, president_book.js)
     standing by the chair   Sit
     anywhere        Map: the scenario's map full screen, your colour and
                     the fronts; drag, pinch, tap a country for its card and
                     its orders (see THE MAP below)
   The verbs are the office's own (president_office.js deskVerbs: the same
   functions E fires) and the book's (president_book.js). Answers to a person
   or a caller are the cinematic prompt's buttons (campaign_ui.js say: on
   touch nothing is pinned out of sight any more). Touch only: a keyboard
   has E, and the things are on its wide screen.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.presDock) return;
  const g = CBZ.game || (CBZ.game = {});

  let el = null, fp = "", acts = [];
  function css() {
    const st = document.createElement("style");
    st.textContent =
      "#presDock{position:fixed;z-index:60;display:none;flex-direction:column;align-items:flex-end;gap:10px;" +
      " right:calc(12px + env(safe-area-inset-right,0px));top:calc(64px + env(safe-area-inset-top,0px));pointer-events:none}" +
      "#presDock.on{display:flex}" +
      "#presDock button{pointer-events:auto;min-height:50px;min-width:92px;padding:0 20px;border-radius:25px;" +
      " font:600 17px/1 Fredoka,system-ui,sans-serif;letter-spacing:.02em;color:#fff;background:rgba(12,16,24,.78);" +
      " border:1.5px solid rgba(255,255,255,.34);box-shadow:0 3px 10px rgba(0,0,0,.45);-webkit-tap-highlight-color:transparent;" +
      " touch-action:manipulation;-webkit-user-select:none;user-select:none}" +
      "#presDock button:active{transform:translateY(2px);background:rgba(40,48,64,.9)}" +
      "#presDock button.lead{background:#c8a24a;color:#16120a;border-color:#e8cb7a}" +
      "#presDock button.bad{border-color:#e0874a}" +
      "#presDock button.dim{opacity:.35}" +
      "#presDock button.ring{animation:presRing .9s ease-in-out infinite}" +
      "@keyframes presRing{0%,100%{transform:scale(1)}50%{transform:scale(1.08);box-shadow:0 0 0 6px rgba(200,162,74,.35)}}" +
      // a phone on its side: a row along the top, clear of the map and the fire button
      "@media (orientation:landscape){#presDock{flex-direction:row;right:auto;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top,0px))}}" +
      // the reader's buttons: along the bottom, under the page
      "#presDock.reading{flex-direction:row;top:auto;right:auto;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom,0px));gap:14px}" +
      "#presDock.reading button{min-width:96px}" +
      // on its side the spread fills the height and leaves the sides: the buttons stand in the right margin
      "@media (orientation:landscape){#presDock.reading{flex-direction:column;top:50%;bottom:auto;left:auto;right:calc(12px + env(safe-area-inset-right,0px));transform:translateY(-50%)}}" +
      // a question on screen has its own buttons; the phone menu is its own screen
      "body.cine-prompt-open #presDock,body.campaign-phone-open #presDock{display:none!important}";
    (document.head || document.documentElement).appendChild(st);
  }
  function dom() {
    if (el || !document.body) return el;
    css();
    el = document.createElement("div");
    el.id = "presDock";
    el.setAttribute("role", "toolbar");
    document.body.appendChild(el);
    // a finger on a button is not a tap on the world behind it
    const stop = function (e) { e.stopPropagation(); };
    el.addEventListener("pointerdown", stop);
    el.addEventListener("touchstart", stop, { passive: true });
    el.addEventListener("click", function (e) {
      const b = e.target.closest && e.target.closest("button[data-i]");
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const a = acts[+b.getAttribute("data-i")];
      if (a && a.run && !a.dim) { try { a.run(); } catch (er) { console.warn("[presDock]", er); } fp = ""; }
    });
    return el;
  }

  // what he can do right now
  function list() {
    const out = [];
    const P = CBZ.player, O = CBZ.presidentOffice, Bk = CBZ.presBook;
    if (!P || P.dead || P.driving) return { reading: false, out: out };
    if (Bk && Bk.isOpen && Bk.isOpen()) {
      const ps = Bk.pageState ? Bk.pageState() : {};
      out.push({ id: "bk-back", label: "Back", dim: !!ps.first, run: function () { Bk.turn(-1); } });
      out.push({ id: "bk-close", label: "Close", run: function () { Bk.close(); } });
      out.push({ id: "bk-next", label: "Next", lead: true, dim: !!ps.last, run: function () { Bk.turn(1); } });
      return { reading: true, out: out };
    }
    if (CBZ.cineBusy && CBZ.cineBusy() && !(O && O.busy && O.busy())) return { reading: false, out: out };   // a scene holds the lens
    let desk = [];
    if (O && O.deskVerbs) { try { desk = O.deskVerbs() || []; } catch (e) { desk = []; } }
    for (const v of desk) out.push(v);
    const folderOpen = desk.some(function (v) { return /^fold-(yes|no|down)$/.test(v.id); });
    if (!folderOpen && Bk && Bk.canOpen && Bk.canOpen() && nearDesk(P, O)) out.push({ id: "bk-open", label: "Briefing", run: function () { Bk.open(); } });
    const sit = sitSeat(P, O);
    if (sit) out.push({ id: "sit", label: "Sit", run: function () { if (CBZ.propSit) CBZ.propSit(CBZ.player, sit); } });
    if (!folderOpen && game() && game().state()) out.push({ id: "map", label: "Map", run: openMap });
    return { reading: false, out: out };
  }
  function nearDesk(P, O) {
    const dp = O && O.deskPoint ? O.deskPoint() : null;
    return !!(dp && P.pos && Math.abs(P.pos.y - dp.y) < 1.5 && Math.hypot(P.pos.x - dp.x, P.pos.z - dp.z) < 2.6);
  }
  // the chair behind the desk, when he is standing in reach of it
  function sitSeat(P, O) {
    if (P._propSeat || P._propBed || !CBZ.propNearestSeat || !CBZ.propSit || !P.pos) return null;
    const dp = O && O.deskPoint ? O.deskPoint() : null;
    if (!dp || Math.abs(P.pos.y - dp.y) > 1.5 || Math.hypot(P.pos.x - dp.x, P.pos.z - dp.z) > 3.6) return null;
    try { return CBZ.propNearestSeat(dp.x, dp.z, 0.9, dp.y) || null; } catch (e) { return null; }
  }

  function render() {
    const on = !!CBZ.touchMode && g.mode === "city" && g.state === "playing" && !MV.open;
    const r = on ? list() : { reading: false, out: [] };
    const show = r.out.length > 0;
    let f = (show ? "1" : "0") + (r.reading ? "R" : "") + "|";
    for (const a of r.out) f += a.id + ":" + a.label + (a.lead ? "+" : "") + (a.bad ? "!" : "") + (a.dim ? "~" : "") + (a.ring ? "*" : "") + ";";
    if (f === fp) { acts = r.out; return; }
    fp = f;
    if (!dom()) return;
    acts = r.out;
    el.classList.toggle("on", show);
    el.classList.toggle("reading", r.reading);
    el.innerHTML = "";
    r.out.forEach(function (a, i) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("data-i", String(i));
      b.className = (a.lead ? "lead " : "") + (a.bad ? "bad " : "") + (a.dim ? "dim " : "") + (a.ring ? "ring" : "");
      b.textContent = a.label;
      el.appendChild(b);
    });
  }
  // a few times a second is plenty for buttons (and the DOM is only touched
  // when what they say changes, so a finger mid-tap keeps its button)
  let acc = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(39.4, function (dt) {
    acc += Math.min(0.1, dt || 0);
    if (acc < 0.15) return;
    acc = 0;
    render();
  });
  // paused, dead, the title: the update may not run, so the row is put away here
  setInterval(function () { if (g.state !== "playing" && fp && fp[0] === "1") render(); }, 400);


  /* ============================================================ THE MAP
     OWNER (2026-10-28): "it is possible to conquer everyone and map shows
     your country growing" ... on his phone.

     A full-screen map of the scenario (president/mapdraw.js paints it: your
     colour, its gold edge, the fronts in red). One finger drags it, two
     pinch it, a tap picks a country; the card under it says who runs it and
     what it is to you, and its buttons are the briefing book's own orders
     (president/papers.js actions(): Declare war, Attack, Demand surrender,
     Annex them ...), sent through the same door as every other order
     (CBZ.presGame.submit). The pan and pinch are one pointer map, the way
     warlord/territory.js does it: a press that did not move is a tap. */
  const MV = { open: false, el: null, cv: null, s: 1, cx: 0.5, cy: 0.5, sel: null, msg: "", msgT: 0, ver: "" };
  function game() { return CBZ.presGame && CBZ.presGame.on ? CBZ.presGame : null; }
  function mapCss() {
    const st = document.createElement("style");
    st.textContent =
      "#presMap{position:fixed;inset:0;z-index:110;display:none;flex-direction:column;background:#0b121c;color:#f3efe4;font:500 15px/1.3 Fredoka,system-ui,sans-serif;" +
      " touch-action:none;-webkit-user-select:none;user-select:none}" +
      "#presMap.on{display:flex}" +
      "#presMap .bar{display:flex;align-items:center;gap:10px;padding:calc(8px + env(safe-area-inset-top,0px)) calc(12px + env(safe-area-inset-right,0px)) 8px calc(12px + env(safe-area-inset-left,0px));background:rgba(8,12,20,.92);border-bottom:1px solid #22324a}" +
      "#presMap .bar .t{flex:1;min-width:0}" +
      "#presMap .bar b{display:block;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#presMap .bar span{display:block;font-size:13px;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#presMap button{min-height:46px;min-width:46px;padding:0 16px;border-radius:23px;font:600 15px/1 Fredoka,system-ui,sans-serif;color:#fff;background:rgba(20,28,42,.9);" +
      " border:1.5px solid rgba(255,255,255,.3);-webkit-tap-highlight-color:transparent;touch-action:manipulation}" +
      "#presMap button:active{transform:translateY(1px);background:#283247}" +
      "#presMap button.war{border-color:#e0874a}#presMap button.go{border-color:#6fbf73}#presMap button.lead{background:#c8a24a;color:#16120a;border-color:#e8cb7a}" +
      "#presMap button.ring{animation:presRing .9s ease-in-out infinite}" +
      "#presMap canvas{flex:1;width:100%;min-height:0;display:block;touch-action:none}" +
      "#presMap .card{display:none;padding:10px calc(12px + env(safe-area-inset-right,0px)) calc(12px + env(safe-area-inset-bottom,0px)) calc(12px + env(safe-area-inset-left,0px));background:rgba(8,12,20,.95);border-top:1px solid #22324a}" +
      "#presMap .card.on{display:block}" +
      "#presMap .card .h{display:flex;align-items:center;gap:10px;margin-bottom:8px}" +
      "#presMap .card .h i{width:14px;height:34px;border-radius:3px;flex:none}" +
      "#presMap .card .h b{font-size:18px}#presMap .card .h span{display:block;font-size:13px;opacity:.75}" +
      "#presMap .card .acts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}" +
      "#presMap .card .acts button{padding:0 8px;font-size:14px}" +
      "#presMap .msg{position:absolute;left:50%;transform:translateX(-50%);top:calc(70px + env(safe-area-inset-top,0px));padding:8px 14px;border-radius:16px;background:rgba(0,0,0,.75);font-size:15px;pointer-events:none;display:none}" +
      "#presMap .msg.on{display:block}" +
      "@media (orientation:landscape){#presMap .card .acts{grid-template-columns:repeat(6,1fr)}}";
    (document.head || document.documentElement).appendChild(st);
  }
  function mapDom() {
    if (MV.el || !document.body) return MV.el;
    mapCss();
    const e = document.createElement("div");
    e.id = "presMap";
    e.innerHTML = "<div class='bar'><div class='t'><b></b><span></span></div><button type='button' data-k='phone' class='lead ring' hidden>Phone</button><button type='button' data-k='close'>Close</button></div>" +
      "<canvas></canvas><div class='msg'></div><div class='card'><div class='h'><i></i><div><b></b><span></span></div></div><div class='acts'></div></div>";
    document.body.appendChild(e);
    MV.el = e; MV.cv = e.querySelector("canvas");
    // nothing on the map reaches the world behind it
    ["pointerdown", "touchstart", "touchmove", "wheel", "mousedown", "click", "keydown"].forEach(function (k) { e.addEventListener(k, function (ev) { ev.stopPropagation(); }, { passive: k !== "wheel" }); });
    e.addEventListener("click", function (ev) {
      const b = ev.target.closest && ev.target.closest("button");
      if (!b) return;
      ev.preventDefault();
      const k = b.getAttribute("data-k");
      if (k === "close") closeMap();
      else if (k === "phone") { closeMap(); const v = ringVerb(); if (v) v.run(); }
      else if (k === "more") more();
      else if (k && k.indexOf("a:") === 0) act(+k.slice(2));
    });
    bindMap(MV.cv);
    return e;
  }
  // the view: the frame fitted into the canvas, then zoomed (s) about a centre (cx, cy in frame fractions)
  function fit() {
    const cv = MV.cv, G2 = game(), S = G2 && G2.state();
    if (!S) return null;
    const fr = CBZ.presMap.frame(S), r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W2 = Math.max(2, Math.round(r.width * dpr)), H2 = Math.max(2, Math.round(r.height * dpr));
    if (cv.width !== W2 || cv.height !== H2) { cv.width = W2; cv.height = H2; }
    const base = Math.min(W2 / fr.w, H2 / fr.h);         // canvas px per tile at s = 1
    const k = base * MV.s;
    return { fr: fr, k: k, W: W2, H: H2, dpr: dpr, x0: W2 / 2 - MV.cx * fr.w * k, y0: H2 / 2 - MV.cy * fr.h * k };
  }
  function clampView() {
    MV.s = Math.max(1, Math.min(16, MV.s));
    const m = 0.5 / MV.s;
    MV.cx = Math.max(Math.min(m, 0.5), Math.min(1 - Math.min(m, 0.5), MV.cx));
    MV.cy = Math.max(Math.min(m, 0.5), Math.min(1 - Math.min(m, 0.5), MV.cy));
  }
  function bindMap(cv) {
    const pts = new Map();
    let drag = null, pinch = null, downT = 0, moved = 0;
    cv.addEventListener("pointerdown", function (e) {
      try { cv.setPointerCapture(e.pointerId); } catch (er) {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { drag = { x: e.clientX, y: e.clientY, cx: MV.cx, cy: MV.cy }; downT = Date.now(); moved = 0; }
      else if (pts.size === 2) { const a = Array.from(pts.values()); pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), s: MV.s }; drag = null; moved = 99; }
      e.preventDefault();
    });
    cv.addEventListener("pointermove", function (e) {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const V = fit(); if (!V) return;
      if (pts.size === 2 && pinch) {
        const a = Array.from(pts.values());
        MV.s = pinch.s * Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) / Math.max(6, pinch.d);
        clampView(); drawMap(); return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      moved = Math.max(moved, Math.hypot(dx, dy));
      MV.cx = drag.cx - dx * V.dpr / (V.fr.w * V.k); MV.cy = drag.cy - dy * V.dpr / (V.fr.h * V.k);
      clampView(); drawMap();
    });
    function up(e) {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size && drag) {
        // a press that did not move is a tap: pick the country under it
        if (moved <= 9 && Date.now() - downT < 450) {
          const V = fit(), r = cv.getBoundingClientRect();
          if (V) {
            const px = (e.clientX - r.left) * V.dpr, py = (e.clientY - r.top) * V.dpr;
            const fx = (px - V.x0) / (V.fr.w * V.k), fy = (py - V.y0) / (V.fr.h * V.k);
            const G2 = game(), S = G2.state();
            const t = fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1 ? CBZ.presMap.pick(S, fx, fy, V.fr) : null;
            select(t != null && S.c[t] && S.c[t].alive ? t : null);
          }
        }
        drag = null;
      }
    }
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", function (e) {
      e.preventDefault();
      MV.s *= e.deltaY > 0 ? 1 / 1.15 : 1.15;
      clampView(); drawMap();
    }, { passive: false });
  }
  function drawMap() {
    const G2 = game(), S = G2 && G2.state();
    if (!MV.open || !S || !CBZ.presMap) return;
    const me = G2.me(), V = fit();
    if (!V) return;
    const x = MV.cv.getContext("2d");
    x.fillStyle = "#0b121c"; x.fillRect(0, 0, V.W, V.H);
    const img = CBZ.presMap.image(S, me, { sel: MV.sel, theme: "night" });
    x.imageSmoothingEnabled = false;
    x.drawImage(img.cv, V.x0, V.y0, V.fr.w * V.k, V.fr.h * V.k);
    // the names that fit, biggest first; yours in gold
    const fs = Math.round(13 * V.dpr), taken = [];
    x.font = "600 " + fs + "px Fredoka, system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
    x.lineWidth = Math.max(2, fs / 5); x.strokeStyle = "rgba(0,0,0,.8)";
    const L = CBZ.presMap.labels(S, me, V.fr);
    for (let i = 0; i < L.length && taken.length < 60; i++) {
      const l = L[i];
      if (!l.me && l.size * V.k * V.k < 900 * V.dpr * V.dpr && l.cid !== MV.sel) continue;   // too small to name at this zoom
      const X = V.x0 + l.x * V.fr.w * V.k, Y = V.y0 + l.y * V.fr.h * V.k;
      if (X < 0 || Y < 0 || X > V.W || Y > V.H) continue;
      const w = x.measureText(l.name).width + 6 * V.dpr, h = fs + 4 * V.dpr;
      if (taken.some(function (r) { return Math.abs(r.x - X) * 2 < r.w + w && Math.abs(r.y - Y) * 2 < r.h + h; })) continue;
      taken.push({ x: X, y: Y, w: w, h: h });
      x.strokeText(l.name, X, Y);
      x.fillStyle = l.me ? "#ffd75e" : l.cid === MV.sel ? "#ffffff" : "#e8e2d4";
      x.fillText(l.name, X, Y);
    }
    // the bar: where, and how far your colour has spread
    const sc = CBZ.presWorld.scen(S), R = CBZ.presWorld.realm(S, me);
    MV.el.querySelector(".bar b").textContent = (sc.id === "world" ? "The World" : sc.name) + "  " + CBZ.presWorld.date(S.day).text;
    MV.el.querySelector(".bar span").textContent = "Ours: " + R.cities + " of " + R.of + " cities. Conquered " + R.conquered + " of " + R.rivals + ".";
    const ring = !!ringVerb();
    const pb = MV.el.querySelector("[data-k=phone]"); if (pb.hidden === ring) pb.hidden = !ring;
    const msg = MV.el.querySelector(".msg");
    const showMsg = MV.msg && Date.now() < MV.msgT;
    msg.classList.toggle("on", !!showMsg); if (showMsg) msg.textContent = MV.msg;
  }
  // the phone on the desk is ringing: the map says so, and one tap answers it
  function ringVerb() {
    const O = CBZ.presidentOffice;
    let desk = [];
    if (O && O.deskVerbs) { try { desk = O.deskVerbs() || []; } catch (e) { desk = []; } }
    return desk.find(function (v) { return v.ring; }) || null;
  }
  // the card: who runs the country you tapped, and what you can do to it
  function card() {
    const G2 = game(), S = G2 && G2.state(), box = MV.el.querySelector(".card");
    if (!S || MV.sel == null || !S.c[MV.sel] || !S.c[MV.sel].alive) { box.classList.remove("on"); MV.ver = ""; return; }
    const me = G2.me(), c = S.c[MV.sel], mine = S.c[me];
    const acts = MV.sel === me ? [] : (CBZ.presPapers.actions(S, me, MV.sel) || []);
    const v = [S.day, MV.sel, c.lord, mine.war.indexOf(MV.sel), mine.posture[MV.sel], mine.allies.indexOf(MV.sel), acts.map(function (a) { return a.label; }).join("|")].join(":");
    if (v === MV.ver && box.classList.contains("on")) return;
    MV.ver = v;
    box.classList.add("on");
    box.querySelector(".h i").style.background = c.lord >= 0 ? S.c[c.lord].color : c.color;
    box.querySelector(".h b").textContent = c.name;
    const tag = MV.sel === me ? "You." : mine.war.indexOf(MV.sel) >= 0 ? "At war with us." : c.lord === me ? "Our puppet." : c.lord >= 0 ? "Puppet of " + S.c[c.lord].short + "." : mine.allies.indexOf(MV.sel) >= 0 ? "Our ally." : "";
    box.querySelector(".h span").textContent = c.leader.name + ", " + (c.leader.title || "leader").toLowerCase() + ". " + Math.round(c.div) + " divisions. " + tag;
    // the orders that matter most here first; the rest are in the briefing book
    const ORDER = ["annex", "release", "posture", "surrender", "peace", "strike", "war", "ally", "deal", "sanction", "threaten"];
    const pickA = acts.filter(function (a) { return ORDER.indexOf(a.id) >= 0; }).sort(function (a, b) { return ORDER.indexOf(a.id) - ORDER.indexOf(b.id); }).slice(0, 5);
    MV.acts = pickA;
    const row = box.querySelector(".acts"); row.innerHTML = "";
    pickA.forEach(function (a, i) {
      const b = document.createElement("button"); b.type = "button"; b.setAttribute("data-k", "a:" + i);
      b.className = a.style === "war" ? "war" : a.style === "go" ? "go" : ""; b.textContent = a.label; row.appendChild(b);
    });
    const Bk = CBZ.presBook;
    if (MV.sel !== me && Bk && Bk.canOpen && Bk.canOpen()) { const b = document.createElement("button"); b.type = "button"; b.setAttribute("data-k", "more"); b.textContent = "More"; row.appendChild(b); }
  }
  function select(t) {
    MV.sel = t;
    const G2 = game(); if (G2 && G2.ui) G2.ui.sel = t != null && t !== G2.me() ? t : G2.ui.sel;
    MV.ver = "";
    card(); drawMap();
  }
  function say(s) { MV.msg = s; MV.msgT = Date.now() + 2200; drawMap(); setTimeout(drawMap, 2300); }
  const WHY = { refused: "He refused.", no: "They said no.", nowar: "We are not at war.", puppet: "Not ours to decide.", yours: "They are already ours.", notyours: "They are not ours.", out: "You are out." };
  function act(i) {
    const a = MV.acts && MV.acts[i], G2 = game();
    if (!a || !G2) return;
    const r = G2.submit(JSON.parse(JSON.stringify(a.act)));
    say(!r ? "" : r.queued ? "Sent." : r.pending ? "Waiting for their answer." : r.ok ? "Done." : WHY[r.why] || "It did not work.");
    MV.ver = ""; card();
  }
  // the briefing book's page on this country, at the desk
  function more() {
    const Bk = CBZ.presBook, G2 = game();
    if (!Bk || !G2) return;
    if (G2.ui) G2.ui.sel = MV.sel;
    closeMap();
    if (Bk.open && Bk.open()) setTimeout(function () { try { Bk.goTo(CBZ.presPapers.order().indexOf("country")); } catch (e) {} }, 450);
  }
  function openMap() {
    const G2 = game(); if (!G2 || !G2.state() || !mapDom()) return;
    MV.open = true; MV.el.classList.add("on");
    if (MV.sel == null && G2.ui && G2.ui.sel != null) MV.sel = G2.ui.sel;
    MV.ver = ""; fp = "";
    requestAnimationFrame(function () { card(); drawMap(); });
  }
  function closeMap() { MV.open = false; if (MV.el) MV.el.classList.remove("on"); fp = ""; }
  // the world keeps turning under the map: redraw it once a second
  setInterval(function () {
    if (!MV.open) return;
    if (g.state !== "playing" && g.state !== "paused") { closeMap(); return; }
    card(); drawMap();
  }, 1000);
  window.addEventListener("resize", function () { if (MV.open) drawMap(); });

  CBZ.presDock = {
    audit: function () { return { on: !!(el && el.classList.contains("on")), reading: !!(el && el.classList.contains("reading")), buttons: acts.map(function (a) { return a.label + (a.dim ? " (dim)" : ""); }),
      map: { open: MV.open, sel: MV.sel, zoom: +MV.s.toFixed(2), card: MV.acts ? MV.acts.map(function (a) { return a.label; }) : [] } }; },
    openMap: openMap, closeMap: closeMap, _select: select, _act: act,
    _press: function (label) { for (const a of acts) if (a.label === label && !a.dim) { a.run(); fp = ""; return true; } return false; },
    _list: list,
  };
})();
