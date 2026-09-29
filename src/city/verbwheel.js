/* ============================================================
   city/verbwheel.js — THE WHEEL: everything you can do to one thing.

   OWNER (2026-09-29): "E does too many things ... it's very stupid" and
   "stupidly simple, make the logic clear, but then have tremendous variety of
   interaction." So the keys stay dumb and the variety lives on the thing:

     E   the one obvious verb on what you look at     (city/interactions.js)
     F   get in / get out                             (city/interactions.js,
                                                        systems/seat_exit.js)
     Q   THIS: the wheel. Every verb the registry has for the thing you are
         looking at (a person, a car, a counter, your own car while you drive)
         laid round it, the obvious one first and biggest.

   The wheel is not a menu that names systems. It is the thing's own verbs
   (Talk, Hire, Mug, Follow me, Attack...), pinned round the thing.

   ORDERS ABOUT SOMEONE ELSE (the delegation thesis). An option registered
   with `pick: "person"` is an order whose object is a third person ("Go
   after", "Guard", "Fire"). Choosing it does not fire yet: the wheel closes,
   and whoever you now look at wears that verb, pinned over his head. E (or a
   tap on him) gives the order: onSelect(agent, ctx, target). Q or Esc drops
   it. The agent is the thing the wheel was opened on.

   INPUT
     keyboard  tap Q: the wheel stays up; move the mouse toward a verb, click
               (or E, or its number) to do it. Hold Q: GTA's weapon-wheel
               grammar, release on a verb to do it. Q / Esc / right-click /
               walking off closes it. The camera does not turn while it is up
               (its mousemove is taken here, in the capture phase).
     touch     systems/touch.js: tap a person, car or counter and this opens
               on it (one verb only: it just happens). Tap a verb. Tap
               anywhere else to close.
     pad       D-pad left opens (a Q tap), D-pad right fires (an E).

   PUBLIC: CBZ.verbWheel = { open(cand), openFor(obj), close(), isOpen(),
            ordering(), pickTarget(ped), audit() }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.verbWheel) return;
  const g = CBZ.game;

  const MAX = 8;               // verbs on the wheel; the rest were never the point
  const HOLD_PICK = 0.28;      // s: a Q held this long is hold-and-release
  const RING = 100;            // px from the thing to a verb's centre
  const STEER = 26;            // px of mouse travel before a verb is highlighted
  const ORDER_TTL = 12;        // s to pick who an order is about
  const ORDER_REACH = 45;      // m: you can point at someone across the street

  const W = {
    open: false, cand: null, items: [], sel: -1,
    held: false, t0: 0, mx: 0, my: 0,
    order: null,               // { cand, item, t } while picking a target
  };
  let root = null, ring = null, btns = [];

  function now() { return (performance && performance.now ? performance.now() : Date.now()) / 1000; }
  function I() { return CBZ.interactions || null; }
  function live() {
    const P = CBZ.player;
    return !!(g && g.mode === "city" && g.state === "playing" && !CBZ.cityMenuOpen && P && !P.dead && !P._aircraft);
  }
  function typing(e) {
    const t = e && e.target;
    if (!t || !t.tagName) return false;
    const tag = t.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || !!t.isContentEditable;
  }
  // a verb is a verb: cut an authored "Verb - clause" to its head
  function short(label) {
    if (CBZ.cityVerbWord) { try { const v = CBZ.cityVerbWord(label); if (v) return v; } catch (e) {} }
    let s = String(label || "").split(/\s+[—–-]\s+/)[0].replace(/[?.!]+$/, "").trim();
    if (s.length > 22) { const sp = s.slice(0, 22).lastIndexOf(" "); s = sp > 6 ? s.slice(0, sp) : s.slice(0, 21) + "…"; }
    return s || "…";
  }

  // ---- DOM -------------------------------------------------------------------
  function css() {
    if (document.getElementById("verbWheelCss")) return;
    const st = document.createElement("style");
    st.id = "verbWheelCss";
    st.textContent =
      "#verbWheel{position:fixed;left:0;top:0;width:0;height:0;z-index:60;pointer-events:none;display:none}" +
      "#verbWheel.on{display:block}" +
      "#verbWheel .vw-slice{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;white-space:nowrap;" +
      "font:600 14px/1 system-ui,-apple-system,sans-serif;color:#f4efe4;background:rgba(14,16,20,.82);" +
      "border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:9px 14px;min-height:34px;cursor:pointer}" +
      "#verbWheel .vw-slice.vw-main{font-size:16px;padding:11px 18px}" +
      "#verbWheel .vw-slice.vw-bad{color:#ffb4a8}" +
      "#verbWheel .vw-slice.on,#verbWheel .vw-slice:hover{background:rgba(236,226,200,.95);color:#15171b}" +
      // the steered verb (mouse / scroll / pad) needs one visible state
      "#verbWheel .vpill.on{border-color:var(--verb-rim-lead,#7fe7ff);box-shadow:0 0 0 2px var(--verb-rim-lead,#7fe7ff),0 2px 12px rgba(0,0,0,.38)}" +
      "#verbWheel .vw-n{display:inline-block;margin-right:7px;opacity:.55;font-size:11px}" +
      "body.touch #verbWheel .vw-n{display:none}" +
      "body.touch #verbWheel .vw-slice{min-height:48px;padding:14px 18px;font-size:15px}";
    document.head.appendChild(st);
  }
  function dom() {
    if (root || typeof document === "undefined" || !document.body) return root;
    css();
    root = document.createElement("div");
    root.id = "verbWheel";
    ring = document.createElement("div");
    root.appendChild(ring);
    document.body.appendChild(root);
    return root;
  }
  // THE LOOK is css/city.css's (CBZ.cityVerbCluster: .vcluster.ring of .vpill,
  // the likely verb as .lead). This file only fills it, places it and routes
  // the input. The .vw-slice fallback is for a page without that renderer.
  let box = null;                 // the element placed on the thing (.vcluster, or the root)
  function wire(b, i, n) {
    b._ang = -Math.PI / 2 + (i / n) * Math.PI * 2;
    let touchAt = -1e9;
    b.addEventListener("touchend", function (e) { e.preventDefault(); e.stopPropagation(); touchAt = Date.now(); fire(i); }, { passive: false });
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (Date.now() - touchAt < 700) return; fire(i); });
  }
  function build() {
    if (!dom()) return;
    ring.innerHTML = "";
    btns = []; box = null;
    const n = W.items.length;
    if (CBZ.cityVerbCluster) {
      const touch = !!CBZ.touchMode;
      const rows = W.items.map(function (it, i) { return { key: touch ? "" : String(i + 1), proposal: it.label, label: it.label, bad: it.bad }; });
      ring.innerHTML = CBZ.cityVerbCluster(rows, { ring: n > 1 });
      box = ring.firstElementChild || null;
      if (box) box.id = "verbWheelRing";
      const list = box ? box.querySelectorAll(".vpill") : [];
      for (let i = 0; i < list.length; i++) { wire(list[i], i, n); btns.push(list[i]); }
    } else {
      for (let i = 0; i < n; i++) {
        const it = W.items[i];
        const b = document.createElement("button");
        b.type = "button";
        b.className = "vw-slice" + (i === 0 ? " vw-main" : "") + (it.bad ? " vw-bad" : "");
        const num = document.createElement("span");
        num.className = "vw-n";
        num.textContent = String(i + 1);
        b.appendChild(num);
        b.appendChild(document.createTextNode(short(it.label)));
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2, r = n === 1 ? 0 : RING;
        b.style.left = Math.round(Math.cos(a) * r) + "px";
        b.style.top = Math.round(Math.sin(a) * r) + "px";
        wire(b, i, n);
        ring.appendChild(b);
        btns.push(b);
      }
    }
    highlight(-1);
  }
  function highlight(i) {
    W.sel = i;
    for (let k = 0; k < btns.length; k++) btns[k].classList.toggle("on", k === i);
  }

  // ---- open / close / fire ---------------------------------------------------
  function open(cand) {
    const ii = I();
    if (!cand || !ii || !ii.wheelOf || !live()) return false;
    const items = ii.wheelOf(cand).slice(0, MAX);
    if (!items.length) return false;
    W.cand = cand; W.items = items; W.open = true; W.mx = 0; W.my = 0;
    build();
    place();
    if (root) root.classList.add("on");
    if (ii.refresh) ii.refresh();          // the card steps back while the wheel is up
    return true;
  }
  // touch: the world object that was tapped -> its candidate -> its verbs.
  // One verb only: no wheel, it just happens (a chair, your own car).
  function openFor(obj) {
    const ii = I();
    if (!ii || !ii.candidateFor) return false;
    // a candidate itself (touch.js's screen pick) or the world object it is on
    const cand = obj && obj.layers && obj.t ? obj : ii.candidateFor(obj);
    if (!cand) return false;
    const items = ii.wheelOf(cand);
    if (!items.length) return false;
    if (items.length === 1 && !items[0].pick) { ii.fireOn(cand, items[0].opt); return true; }
    return open(cand);
  }
  function close() {
    W.open = false; W.cand = null; W.items = []; W.sel = -1; W.held = false;
    if (root) root.classList.remove("on");
    const ii = I(); if (ii && ii.refresh) ii.refresh();
  }
  function fire(i) {
    if (!W.open) return;
    const it = W.items[i], cand = W.cand;
    close();
    if (!it || !cand) return;
    if (it.pick === "person") { beginOrder(cand, it); return; }
    const ii = I();
    if (ii && ii.fireOn) ii.fireOn(cand, it.opt);
  }

  // ---- ORDERS: "tell him to do it to HIM" -----------------------------------
  function agentOf(cand) { return cand && cand.t && cand.t.group ? cand.t : null; }
  function beginOrder(cand, item) {
    W.order = { cand: cand, item: item, t: 0 };
    const a = agentOf(cand);
    if (a && CBZ.citySay) { try { CBZ.citySay(a, "Who?", null, 1.6); } catch (e) {} }
  }
  function endOrder() {
    W.order = null;
    if (CBZ.prisonPromptClear) CBZ.prisonPromptClear("wheel-order");
  }
  // the person you are LOOKING at, near or far (an order can point across a street)
  function lookedPerson() {
    const P = CBZ.player;
    if (!P || !P.pos) return null;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const agent = W.order ? agentOf(W.order.cand) : null;
    let best = null, bs = 0.965;
    const scan = function (list) {
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (!p || p.dead || p === agent || p.player || !p.pos || !p.group) continue;
        const dx = p.pos.x - P.pos.x, dz = p.pos.z - P.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.5 || d > ORDER_REACH) continue;
        const s = (dx / d) * fx + (dz / d) * fz - d * 0.0006;
        if (s > bs) { bs = s; best = p; }
      }
    };
    scan(CBZ.cityPeds); scan(CBZ.cityCops);
    return best;
  }
  function pickTarget(ped) {
    const o = W.order;
    if (!o || !ped || ped.dead) return false;
    const ii = I();
    endOrder();
    if (ii && ii.fireOn) ii.fireOn(o.cand, o.item.opt, ped);
    return true;
  }
  // the pinned verb's act (systems/interactions.js @fn): E on him, or a tap on the pill
  CBZ.verbWheelPickTarget = function () { const p = lookedPerson(); if (p) pickTarget(p); };
  function tickOrder(dt) {
    const o = W.order;
    if (!o) return;
    o.t += dt;
    const a = agentOf(o.cand);
    if (!live() || o.t > ORDER_TTL || (a && a.dead)) { endOrder(); return; }
    const p = lookedPerson();
    if (!p || !CBZ.prisonPrompt) return;
    CBZ.prisonPrompt("wheel-order", "@verbWheelPickTarget", short(o.item.label),
      { at: { x: p.pos.x, y: (p.pos.y || 0) + 2.15, z: p.pos.z }, key: "E", bind: true, d2: 0, city: true });
  }

  // ---- placement + upkeep ---------------------------------------------------------
  const _v = window.THREE ? new THREE.Vector3() : null;
  function place() {
    if (!root || !W.cand) return;
    const w = window.innerWidth || 800, h = window.innerHeight || 600;
    let sx = w / 2, sy = h / 2;
    const ii = I(), a = ii && ii.anchorOf ? ii.anchorOf(W.cand) : null;
    const cam = CBZ.camera;
    if (a && cam && _v) {
      cam.updateMatrixWorld();
      _v.set(a.x, a.y, a.z).project(cam);
      if (_v.z <= 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1) {
        sx = (_v.x * 0.5 + 0.5) * w; sy = (-_v.y * 0.5 + 0.5) * h;
      }
    }
    // keep the whole ring on the screen
    const m = RING + 70;
    sx = Math.max(m, Math.min(w - m, sx)); sy = Math.max(RING + 30, Math.min(h - RING - 30, sy));
    const el = box || root;
    el.style.left = Math.round(sx) + "px";
    el.style.top = Math.round(sy) + "px";
  }
  function stale() {
    const c = W.cand, t = c && c.t, P = CBZ.player;
    if (!t || t.dead) return true;
    const p = t.pos || (t.group && t.group.position) || (t.x != null ? t : null);
    if (!p || !P || !P.pos) return false;
    const reach = (I() && I().REACH) || 5.2;
    return Math.hypot(p.x - P.pos.x, p.z - P.pos.z) > reach * 1.8;
  }
  let lastT = 0;
  if (CBZ.onAlways) CBZ.onAlways(97, function () {
    const t = now(), dt = lastT ? Math.min(0.1, t - lastT) : 0;
    lastT = t;
    tickOrder(dt);
    if (!W.open) return;
    if (!live() || stale()) { close(); return; }
    place();
  });

  // ---- KEYBOARD ---------------------------------------------------------------
  addEventListener("keydown", function (e) {
    if (!live() || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = String(e.key || "").toLowerCase();
    if (k === "q") {
      e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      if (e.repeat) return;
      if (W.order) { endOrder(); return; }
      if (W.open) { close(); return; }
      const ii = I(), cand = ii && ii.wheelCand ? ii.wheelCand() : null;
      if (open(cand)) { W.held = true; W.t0 = now(); }
      return;
    }
    if (W.order && k === "escape") { e.preventDefault(); endOrder(); return; }
    if (!W.open) return;
    if (k === "escape") { e.preventDefault(); close(); return; }
    if (k === "e") { e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); fire(W.sel >= 0 ? W.sel : 0); return; }
    if (/^[1-8]$/.test(k)) {
      const i = +k - 1;
      if (i < W.items.length) { e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); fire(i); }
    }
  }, true);
  addEventListener("keyup", function (e) {
    if (String(e.key || "").toLowerCase() !== "q" || !W.open || !W.held) return;
    W.held = false;
    if (now() - W.t0 < HOLD_PICK) return;          // a tap: the wheel stays up
    if (W.sel >= 0) fire(W.sel); else close();      // hold-and-release
  }, true);

  // the mouse steers the highlight while the wheel is up; the camera holds still
  function steer(dx, dy) {
    W.mx += dx; W.my += dy;
    const m = Math.hypot(W.mx, W.my);
    if (m > 120) { W.mx *= 120 / m; W.my *= 120 / m; }
    if (m < STEER || !btns.length) return;
    const a = Math.atan2(W.my, W.mx);
    let best = -1, bd = 1e9;
    for (let i = 0; i < btns.length; i++) {
      let d = Math.abs(a - btns[i]._ang) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < bd) { bd = d; best = i; }
    }
    if (best !== W.sel) highlight(best);
  }
  addEventListener("mousemove", function (e) {
    if (!W.open || !document.pointerLockElement) return;
    steer(e.movementX || 0, e.movementY || 0);
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }, true);
  addEventListener("mousedown", function (e) {
    if (!W.open) return;
    if (!document.pointerLockElement) return;      // a free cursor clicks the verb itself
    e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    if (e.button === 2) { close(); return; }
    if (e.button === 0) { if (W.sel >= 0) fire(W.sel); else close(); }
  }, true);
  addEventListener("wheel", function (e) {
    if (!W.open || !btns.length) return;
    e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    const n = btns.length;
    highlight(((W.sel < 0 ? -1 : W.sel) + (e.deltaY > 0 ? 1 : -1) + n) % n);
  }, { capture: true, passive: false });

  // ---- TOUCH: a tap off the wheel closes it ------------------------------------
  if (typeof document !== "undefined") {
    document.addEventListener("touchstart", function (e) {
      if (!W.open) return;
      const t = e.target;
      if (t && t.closest && t.closest("#verbWheel")) return;
      close();
    }, { capture: true, passive: true });
  }

  CBZ.verbWheel = {
    open: open, openFor: openFor, close: close,
    isOpen: function () { return W.open; },
    ordering: function () { return !!W.order; },
    pickTarget: pickTarget,
    audit: function () {
      return { open: W.open, verbs: W.items.map(function (it) { return short(it.label); }), sel: W.sel,
        ordering: W.order ? short(W.order.item.label) : null };
    },
  };
})();
