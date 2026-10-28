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
    const on = !!CBZ.touchMode && g.mode === "city" && g.state === "playing";
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

  CBZ.presDock = {
    audit: function () { return { on: !!(el && el.classList.contains("on")), reading: !!(el && el.classList.contains("reading")), buttons: acts.map(function (a) { return a.label + (a.dim ? " (dim)" : ""); }) }; },
    _press: function (label) { for (const a of acts) if (a.label === label && !a.dim) { a.run(); fp = ""; return true; } return false; },
    _list: list,
  };
})();
