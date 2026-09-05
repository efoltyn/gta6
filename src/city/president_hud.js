/* ============================================================
   city/president_hud.js — THE PRESIDENT HUD STRIP.

   WHY (PRESIDENT-PLAN.md §1b, "nothing is on your body"): every number the
   President mode is about — approval, treasury, emergency powers, the term
   clock, the cell, the wall, the Bureau — was painted on ONE canvas, on ONE
   wall, inside ONE locked room 4.7 km from the plot. Walk out of the
   Situation Room and you are an unarmed pedestrian on a lawn with no idea
   whether the country is 3 points from impeaching you.

   This file is that canvas, on your body, in city mode, everywhere. It is a
   READOUT ONLY: it owns no state, computes no politics and decides nothing.
   Its single source is `CBZ.presidency.status()` (presidency.js), which is
   the same model `paintBoard()` draws — one model, two surfaces, never a
   second simulation.

   WHERE IT SITS (measured, not guessed — every number below was read out of
   the file that owns it):
     city/turf.js   #cTurfMeta   top:6px,  centred, ~48px tall  (z 21)
     city/hud.js    #cJob        top:pad-t (14px), centred, ~28px tall
     city/hud.js    #cTopRight   top:54px, right column, max-width 248px
     city/charpanel #cpPanel     top:10px, left column, width <=128px
     city/hud.js    #cFeed       left+150 .. left+450 — but renderFeed() is a
                                 NO-OP (it clears and hides); the event feed
                                 is retired, so that band is genuinely empty.
   So the strip takes the empty band UNDER the mission line and BETWEEN the
   two side columns: a container pinned left:pad+150 / right:pad+258 (i.e. it
   physically cannot reach either column at any width), top pad-t+44 (clear of
   both the turf meta bar and the mission line), with the panel centred inside
   it. Narrow screens shrink the type instead of moving the strip, and the
   cells wrap DOWN into empty screen rather than sideways into a neighbour.

   DISCIPLINE (racehud.js / gungamehud.js rules, which are the good ones):
     • DOM built once, lazily, on the first frame status() actually answers.
     • No per-frame innerHTML. Writes go through put(), which compares against
       the last string and returns early when nothing moved.
     • A value that DID move gets a 0.55 s colour tick, so a change is visible
       even if you were looking at the road.
     • Polled at 2 Hz off the update bus; events give the instant flashes.
     • Same tokens as hud.js's professional pass: one panel rgba, one radius,
       tabular numerals, money-green for cash, gold for the clock, red for
       alert, cyan for the Bureau. No emoji in HUD space.

   FEATURE-DETECTED END TO END. presidency.js missing, flag off, contract not
   landed yet — every one of those is "do nothing this frame and try again".

   FLAG: CBZ.CONFIG.PRESIDENT_HUD (self-defaulted true here, the owning file).
   false = the node is never created; nothing to find, nothing to hide.

   AUDIT: CBZ.presidentHudAudit() -> {mounted, visible, fields, lastPaintMs}.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  // declared HERE, in the owning file (config.js is an Edit-race file)
  CBZ.CONFIG = CBZ.CONFIG || {};
  const CFG = CBZ.CONFIG;
  if (CFG.PRESIDENT_HUD == null) CFG.PRESIDENT_HUD = true;

  // the audit must answer even when the strip is switched off, so the
  // orchestrator's ratchet reads "off" instead of "missing".
  let A = { mounted: false, visible: false, fields: 0, lastPaintMs: 0, paints: 0, flag: CFG.PRESIDENT_HUD !== false };
  CBZ.presidentHudAudit = function () {
    return { mounted: A.mounted, visible: A.visible, fields: A.fields, lastPaintMs: A.lastPaintMs, paints: A.paints, flag: A.flag };
  };
  if (CFG.PRESIDENT_HUD === false) return;
  if (!CBZ.onUpdate) return;

  // ---------------------------------------------------------------- tokens
  const INK = "#e8ecf2", DIM = "#9fb0c6", GOLD = "#ffd166", MONEY = "#7ed957",
        RED = "#ff5b5b", CYAN = "#7de7ff", AMBER = "#ffb35c";

  // ---------------------------------------------------------------- state
  let root = null, panel = null, headEl = null, govEl = null, rowEl = null,
      chipsEl = null, noteEl = null, bannerEl = null;
  const cells = {};   // key -> {el, val, lab, _t, _c, _seen}
  const chips = {};   // key -> {el, _t, _c}
  let wired = false;          // presidency.on(...) subscribed
  let last = null;            // the last status() answered, cached between polls
  let lastOk = 0;             // when that answer arrived (grace window, see the tick)
  let acc = 1;                // 2 Hz accumulator (pre-armed: poll on the first city frame)
  let flashUntil = 0, flashOk = true, noteUntil = 0;
  let shakeUntil = 0;
  let arrested = false, impeachSeen = false;

  // ---------------------------------------------------------------- format
  function money(n) {
    n = +n || 0;
    const neg = n < 0, a = Math.abs(n);
    let s;
    if (a >= 1e9) s = (a / 1e9).toFixed(a >= 1e10 ? 0 : 1) + "B";
    else if (a >= 1e6) s = (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
    else if (a >= 1e4) s = Math.round(a / 1e3) + "k";
    else s = Math.round(a).toLocaleString();
    return (neg ? "-$" : "$") + s;
  }
  function pct(n) { return Math.round(+n || 0) + "%"; }
  function clip(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  // ---------------------------------------------------------------- DOM
  // The cell order IS the reading order: how the country feels about you,
  // what you can spend, how much republic is left, how long you have, and
  // who is coming. Everything conditional lives in the chip row below.
  const CELLS = [
    ["approval", "APPROVAL"],
    ["treasury", "TREASURY"],
    ["emergency", "EMERGENCY"],
    ["day", "DAY · TERM"],
    ["threat", "THREAT"],
  ];
  const CHIPS = ["wall", "raid", "impeach"];

  function css() {
    if (document.getElementById("presHudCss")) return;
    const st = document.createElement("style");
    st.id = "presHudCss";
    st.textContent =
      // the BAND: pinned inside the gap between the two side columns, so the
      // strip can never reach charpanel on the left or the money/stars stack
      // on the right no matter how wide the content gets.
      "#presHud{position:fixed;z-index:22;pointer-events:none;display:none;" +
      "left:calc(14px + env(safe-area-inset-left,0px) + 150px);" +
      "right:calc(14px + env(safe-area-inset-right,0px) + 258px);" +
      "top:calc(14px + env(safe-area-inset-top,0px) + 44px);" +
      "font-family:Fredoka,system-ui,sans-serif;font-variant-numeric:tabular-nums;color:" + INK + ";text-align:center}" +
      "#presHud .pWrap{display:inline-block;max-width:100%;text-align:left}" +
      "#presHud .pPanel{background:rgba(8,11,17,.55);border:1px solid rgba(232,236,242,.12);border-radius:9px;" +
      "backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);box-shadow:0 4px 16px rgba(0,0,0,.45);padding:5px 12px 6px}" +
      // order feedback: 2 s of green (it happened) or red (it was refused)
      "#presHud .pPanel.ok{border-color:rgba(126,217,87,.55);box-shadow:0 0 0 1px rgba(126,217,87,.22),0 4px 16px rgba(0,0,0,.45)}" +
      "#presHud .pPanel.no{border-color:rgba(255,91,91,.55);box-shadow:0 0 0 1px rgba(255,91,91,.22),0 4px 16px rgba(0,0,0,.45)}" +
      "#presHud .pPanel.shake{animation:pShake .5s cubic-bezier(.36,.07,.19,.97)}" +
      // header: who you are and what the country still calls itself
      "#presHud .pHead{display:flex;align-items:baseline;gap:7px;padding:0 1px 3px;white-space:nowrap;overflow:hidden}" +
      "#presHud .pHead .nm{font-size:12px;font-weight:800;letter-spacing:1.4px;color:" + GOLD + ";text-overflow:ellipsis;overflow:hidden}" +
      "#presHud .pHead .gv{font-size:9px;font-weight:700;letter-spacing:1.1px;color:" + DIM + ";opacity:.75}" +
      // the numbers
      "#presHud .pRow{display:flex;flex-wrap:wrap;align-items:stretch;row-gap:2px}" +
      "#presHud .pCell{display:flex;flex-direction:column;justify-content:center;padding:1px 11px;border-left:1px solid rgba(232,236,242,.12);min-width:0}" +
      "#presHud .pCell:first-child{border-left:none;padding-left:1px}" +
      "#presHud .pLab{font-size:8.5px;letter-spacing:1.1px;color:" + DIM + ";opacity:.6;font-weight:700;white-space:nowrap}" +
      "#presHud .pVal{font-size:17px;font-weight:700;line-height:1.2;white-space:nowrap;opacity:.9}" +
      "#presHud .pCell.wide .pVal{font-size:12px;font-weight:600;line-height:1.35;padding-top:2px}" +
      // a value that MOVED ticks once — the whole point of a live readout
      "#presHud .pVal.tick{animation:pTick .55s ease-out}" +
      // an armed attack is not a number, it is an alarm
      "#presHud .pCell.armed{animation:pPulse 1.1s ease-in-out infinite;border-radius:6px}" +
      // conditional chips: only on screen while the thing they name exists
      "#presHud .pChips{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}" +
      "#presHud .pChip{display:none;font-size:10.5px;font-weight:700;letter-spacing:.6px;padding:2px 8px;border-radius:6px;" +
      "background:rgba(232,236,242,.07);white-space:nowrap}" +
      "#presHud .pNote{display:none;margin-top:4px;font-size:11px;font-weight:700;letter-spacing:.3px;color:" + GOLD + ";" +
      "max-width:46ch;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      // the deposed banner: the ONE thing that outlives the seat
      "#presHud .pBanner{display:none;font-size:13px;font-weight:800;letter-spacing:2.4px;color:" + RED + ";" +
      "animation:pPulse 1.3s ease-in-out infinite;padding:1px 1px 2px}" +
      "@keyframes pTick{0%{color:" + CYAN + ";text-shadow:0 0 10px rgba(125,231,255,.55)}100%{text-shadow:none}}" +
      "@keyframes pPulse{0%,100%{opacity:1}50%{opacity:.45}}" +
      "@keyframes pShake{10%,90%{transform:translateX(-2px)}30%,70%{transform:translateX(3px)}50%{transform:translateX(-3px)}}" +
      // narrow screens SHRINK the type; the strip never moves into a neighbour
      "@media (max-width:1100px){#presHud .pCell{padding:1px 8px}#presHud .pVal{font-size:15px}#presHud .pCell.wide .pVal{font-size:11px}}" +
      "@media (max-width:860px){#presHud .pVal{font-size:13px}#presHud .pLab{font-size:8px}#presHud .pChip{font-size:9.5px}}" +
      // no room for a strip AND the game under a phone-height landscape
      "@media (max-height:420px){#presHud{display:none!important}}";
    document.head.appendChild(st);
  }

  function build() {
    if (root) return;
    css();
    root = document.createElement("div");
    root.id = "presHud";
    const wrap = document.createElement("div");
    wrap.className = "pWrap";
    panel = document.createElement("div");
    panel.className = "pPanel";

    headEl = document.createElement("div");
    headEl.className = "pHead";
    const nm = document.createElement("span"); nm.className = "nm";
    govEl = document.createElement("span"); govEl.className = "gv";
    headEl.appendChild(nm); headEl.appendChild(govEl);
    headEl._nm = nm;

    bannerEl = document.createElement("div");
    bannerEl.className = "pBanner";

    rowEl = document.createElement("div");
    rowEl.className = "pRow";
    for (let i = 0; i < CELLS.length; i++) {
      const key = CELLS[i][0];
      const el = document.createElement("div");
      el.className = "pCell" + (key === "threat" ? " wide" : "");
      const lab = document.createElement("span"); lab.className = "pLab"; lab.textContent = CELLS[i][1];
      const val = document.createElement("span"); val.className = "pVal"; val.textContent = "—";
      el.appendChild(lab); el.appendChild(val);
      rowEl.appendChild(el);
      cells[key] = { el: el, val: val, lab: lab, _t: null, _c: null, _lab: CELLS[i][1], _seen: false };
    }

    chipsEl = document.createElement("div");
    chipsEl.className = "pChips";
    for (let i = 0; i < CHIPS.length; i++) {
      const c = document.createElement("div");
      c.className = "pChip";
      chipsEl.appendChild(c);
      chips[CHIPS[i]] = { el: c, _t: null, _c: null };
    }

    noteEl = document.createElement("div");
    noteEl.className = "pNote";

    panel.appendChild(headEl);
    panel.appendChild(bannerEl);
    panel.appendChild(rowEl);
    panel.appendChild(chipsEl);
    panel.appendChild(noteEl);
    wrap.appendChild(panel);
    root.appendChild(wrap);
    document.body.appendChild(root);
    A.mounted = true;
  }

  // ---------------------------------------------------------------- writes
  function tickEl(el) {
    // restart the keyframe (the hud.js cPopPulse trick) — class toggling alone
    // will not replay an animation that is already on the node.
    el.classList.remove("tick"); void el.offsetWidth; el.classList.add("tick");
  }
  function put(c, text, color, label) {
    if (label != null && c._lab !== label) { c._lab = label; c.lab.textContent = label; }
    if (c._t === text) {
      if (c._c !== color) { c._c = color; c.val.style.color = color || ""; }
      return false;
    }
    const first = !c._seen;
    c._t = text; c._c = color; c._seen = true;
    c.val.textContent = text;
    c.val.style.color = color || "";
    if (!first) tickEl(c.val);
    return true;
  }
  function chip(k, text, color) {
    const c = chips[k];
    if (!c) return 0;
    if (text == null) {
      if (c._t !== null) { c._t = null; c.el.style.display = "none"; }
      return 0;
    }
    if (c._t !== text) { c._t = text; c.el.textContent = text; c.el.style.display = "block"; }
    if (c._c !== color) { c._c = color; c.el.style.color = color; }
    return 1;
  }
  // NOTE the explicit display: several of these nodes are display:none in the
  // stylesheet, so clearing the inline style would fall straight back to none.
  function show(el, on, disp) {
    const d = on ? (disp || "block") : "none";
    if (el._d !== d) { el._d = d; el.style.display = d; }
  }
  function note(text, color) {
    if (!noteEl) return;
    noteUntil = performance.now() + 2600;
    if (noteEl._t !== text) { noteEl._t = text; noteEl.textContent = text; }
    noteEl.style.color = color || GOLD;
    show(noteEl, true, "block");
  }

  // ---------------------------------------------------------------- events
  // Polling at 2 Hz is right for numbers and far too slow for a verb. The
  // events are the flashes: an order you just pressed, an attack that just
  // armed, a raid that just changed phase, articles that just got filed.
  function wire(P) {
    if (wired || !P || typeof P.on !== "function") return;
    wired = true;
    const on = function (evt, fn) { try { P.on(evt, fn); } catch (e) {} };
    on("sworn", function () {
      arrested = false; impeachSeen = false;
      flashUntil = performance.now() + 2000; flashOk = true;
      note("SWORN IN", MONEY);
      paint();
    });
    on("order", function (e) {
      e = e || {};
      flashOk = e.ok !== false;
      flashUntil = performance.now() + 2000;
      const why = e.why ? String(e.why) : (flashOk ? "ORDER GIVEN" : "REFUSED");
      note(clip(why.toUpperCase(), 64), flashOk ? MONEY : RED);
      paint();
    });
    on("attack-armed", function (e) {
      e = e || {};
      shakeUntil = performance.now() + 620;
      // presidency.js emits this twice: once when the cell arms (eta null) and
      // again ATTACK_WARN_SEC out, with the fuse on it. The second one is the
      // one you can still do something about, so it says how long.
      const eta = (e.eta != null && +e.eta > 0) ? (" IN " + Math.round(+e.eta) + "s") : " ARMED";
      note("ATTACK" + eta + (e.name ? " · " + clip(String(e.name).toUpperCase(), 26) : ""), RED);
      paint();
    });
    on("attack", function (e) {
      e = e || {};
      shakeUntil = performance.now() + 620;
      flashOk = false; flashUntil = performance.now() + 2000;
      note((e.real ? "ATTACK UNDER WAY" : "ATTACK REPORTED") + (e.at ? " · " + clip(String(e.at).toUpperCase(), 28) : ""), RED);
      paint();
    });
    on("raid", function (e) {
      e = e || {};
      // phase null is the CLOSING emit — it carries the verdict, not a phase.
      const t = e.phase ? clip(String(e.phase).toUpperCase(), 28)
        : (e.won ? "RAID SUCCEEDED" : "RAID FAILED");
      note("BUREAU · " + t, e.phase ? CYAN : (e.won ? MONEY : RED));
      paint();
    });
    on("impeach", function () { impeachSeen = true; note("ARTICLES OF IMPEACHMENT FILED", RED); paint(); });
    // sworn/order/attack/raid/impeach/arrest is the whole seven-moment set
    // presidency.js emits; nothing here polls for any of them.
    on("arrest", function (e) {
      arrested = true;
      note(clip(String((e && e.title) || "UNDER ARREST").toUpperCase(), 48), RED);
      paint();
    });
  }

  // ---------------------------------------------------------------- paint
  function status() {
    const P = CBZ.presidency;
    if (!P || typeof P.status !== "function") return null;
    let s = null;
    try { s = P.status(); } catch (e) { return null; }
    return (s && typeof s === "object") ? s : null;
  }

  function paint(pre) {
    const s = pre || status();
    if (!s) return;
    build();
    const now = performance.now();
    let fields = 0;

    // ---- who -------------------------------------------------------------
    const country = clip(s.country || "", 26).toUpperCase();
    const title = clip(s.title || "", 22).toUpperCase();
    const nmTxt = title ? (title + " · " + country) : country;
    if (headEl._nm._t !== nmTxt) { headEl._nm._t = nmTxt; headEl._nm.textContent = nmTxt; }
    const gv = clip(s.govType || "", 20).toUpperCase();
    if (govEl._t !== gv) { govEl._t = gv; govEl.textContent = gv; }
    show(headEl, !!nmTxt, "flex");
    if (nmTxt) fields++;

    // ---- deposed: the ONE readout that outlives the seat ------------------
    const seated = !!s.seat;
    const dep = !seated && (arrested || impeachSeen || s.impeachDay != null);
    if (dep) {
      const t = arrested ? "ARRESTED · THE JUNTA HAS THE COUNTRY" : "THE JUNTA IS COMING";
      if (bannerEl._t !== t) { bannerEl._t = t; bannerEl.textContent = t; }
      show(bannerEl, true, "block"); fields++;
    } else show(bannerEl, false);
    show(rowEl, seated, "flex");

    if (seated) {
      // ---- approval ------------------------------------------------------
      const ap = +s.approval || 0;
      put(cells.approval, pct(ap), ap < 20 ? RED : (ap < 40 ? GOLD : INK));
      fields++;

      // ---- treasury (money-green is reserved for cash; this IS cash) ------
      const tr = +s.treasury || 0;
      put(cells.treasury, money(tr), tr < 0 ? RED : MONEY);
      fields++;

      // ---- emergency powers (100 = the republic ends) ---------------------
      const em = +s.emergency || 0;
      put(cells.emergency, pct(em), em >= 85 ? RED : (em >= 50 ? AMBER : INK));
      fields++;

      // ---- the clock ------------------------------------------------------
      const d = s.day | 0, td = (s.termDay == null ? null : s.termDay | 0);
      const left = td == null ? null : (td - d);
      put(cells.day, td == null ? String(d) : (d + " / " + td),
          (left != null && left <= 1) ? RED : (left != null && left <= 3 ? GOLD : INK),
          td == null ? "DAY" : "DAY · TERM");
      fields++;

      // ---- the cell -------------------------------------------------------
      const th = s.threat || {};
      const armed = !!th.armed;
      const parts = [];
      parts.push((th.members | 0) + (Math.abs(th.members | 0) === 1 ? " member" : " members"));
      if (th.supply != null) parts.push("supply " + (th.supply | 0));
      parts.push(th.intel ? "safehouse marked" : "no intel");
      // the TARGET rides in the label, not the value: a name of unknown length
      // in front of the numbers pushed "safehouse marked" off the end of the
      // cell, and the one string you must not lose is the one that tells you
      // whether the Bureau can find them.
      let lab = "THREAT";
      if (armed) lab = th.target ? ("THREAT · ARMED → " + clip(String(th.target).toUpperCase(), 22)) : "THREAT · ARMED";
      put(cells.threat, clip(parts.join(" · "), 46), armed ? RED : ((th.members | 0) ? INK : DIM), lab);
      if (cells.threat.el.classList.contains("armed") !== armed) cells.threat.el.classList.toggle("armed", armed);
      fields++;
    }

    // ---- conditional chips ------------------------------------------------
    const w = s.wall;
    if (w && w.ordered) {
      const done = !!w.done || ((w.built | 0) >= (w.total | 0) && (w.total | 0) > 0);
      fields += chip("wall", "THE WALL " + (w.built | 0) + "/" + (w.total | 0) +
        (done ? " · SEALED" : (w.manned ? " · manned" : " · gaps open")),
        done ? MONEY : (w.manned ? INK : GOLD));
    } else chip("wall", null);

    if (s.raid) fields += chip("raid", "BUREAU · " + clip(String(s.raid).toUpperCase(), 24), CYAN);
    else chip("raid", null);

    if (s.impeachDay != null) {
      const n = (s.impeachDay | 0) - (s.day | 0);
      fields += chip("impeach", n <= 0 ? "IMPEACHMENT · TRIAL TODAY"
        : ("IMPEACHMENT · TRIAL IN " + n + (n === 1 ? " DAY" : " DAYS")), RED);
    } else chip("impeach", null);

    // ---- transient chrome --------------------------------------------------
    if (now > noteUntil) show(noteEl, false); else fields++;
    const flashing = now < flashUntil;
    const okCls = flashing && flashOk, noCls = flashing && !flashOk;
    if (panel.classList.contains("ok") !== okCls) panel.classList.toggle("ok", okCls);
    if (panel.classList.contains("no") !== noCls) panel.classList.toggle("no", noCls);
    const sh = now < shakeUntil;
    if (sh && !panel.classList.contains("shake")) { panel.classList.remove("shake"); void panel.offsetWidth; panel.classList.add("shake"); }
    else if (!sh && panel.classList.contains("shake")) panel.classList.remove("shake");

    A.fields = fields;
    A.lastPaintMs = now;
    A.paints++;
  }

  // ---------------------------------------------------------------- tick
  // ORDER 49.4 — the HUD-READOUT band. systems/gungamehud.js takes 49.2 and
  // city/phone.js 50.5, so 49.4 lands between them: after every simulation
  // producer has written its numbers for the frame, before the phone/dialogue
  // UI layer. Nothing here reads or writes world state, so the exact slot only
  // matters in that it must be AFTER presidency.js's own day tick.
  CBZ.onUpdate(49.4, function (dt) {
    const g = CBZ.game;
    if (!g || g.mode !== "city") {
      if (root && root._vis !== false) { root._vis = false; root.style.display = "none"; }
      A.visible = false;
      return;
    }
    const P = CBZ.presidency;
    if (P) wire(P);

    // 2 Hz. status() is somebody else's function and may well allocate, so it
    // is called on the poll beat and NOWHERE else in the frame — the visibility
    // decision below reads the cached answer.
    acc += (dt || 0);
    if (acc >= 0.5) {
      acc = 0;
      const fresh = status();
      if (fresh) { last = fresh; lastOk = performance.now(); paint(fresh); }
      // "do nothing this frame and retry later" — one bad call (or a mid-boot
      // window where presidency.js has not published the contract) must not
      // blank a readout that was correct half a second ago. Persistent silence
      // for 2 s does drop it, so a torn-down presidency cannot leave a lie on
      // the screen forever.
      else if (last && performance.now() - lastOk > 2000) last = null;
    }
    const s = last;

    // respect the [H] hide-HUD toggle exactly as city/hud.js does
    let hidden = false;
    try { hidden = !!(CBZ.cityCharPanel && CBZ.cityCharPanel.hudHidden && CBZ.cityCharPanel.hudHidden()); } catch (e) {}

    // A deposed president still gets the readout: the seat is gone but the
    // countdown / the arrest is exactly the news he needs.
    const live = !!s && (!!s.seat || arrested || impeachSeen || s.impeachDay != null);
    const vis = live && !hidden;
    if (root) {
      if (root._vis !== vis) { root._vis = vis; root.style.display = vis ? "block" : "none"; }
    }
    A.visible = vis && !!root;
  });

  // small public handle so a scene/test can force a repaint without waiting
  // half a second for the poll (presidency.js's own _paint has the same shape).
  CBZ.presidentHud = { audit: CBZ.presidentHudAudit, refresh: function () { try { paint(); } catch (e) {} } };
})();
