/* ============================================================
   city/verbwheel.js — THE WHEEL: everything you can do to one thing.

   OWNER (2026-09-29): "E does too many things ... it's very stupid" and
   "stupidly simple, make the logic clear, but then have tremendous variety of
   interaction." So the keys stay dumb and the variety lives on the thing:

     E   the one obvious verb on what you look at     (city/interactions.js)
     F   get in / get out                             (city/interactions.js,
                                                        systems/seat_exit.js)
     Q   THIS: the verbs of the thing you are looking at (a person, a car, a
         counter, your own car while you drive), in one short column beside
         it: the obvious one first and biggest, then the few that fit this
         person right now, then "More" for the rest.

   LAYOUT (owner 2026-09-29: "look how stupid the buttons look when you press
   someone"). It was eight pills on a CSS circle of fixed radius: they
   overlapped one another and sat on the man's face. Now the pills are
   measured, then laid out by systems/touch_layout.js verbColumn: one column
   beside his body (never over his head), on screen, off every other control.
   At most four verbs plus More (tools/verb-cluster-layout-check.mjs).

   The wheel is not a menu that names systems. It is the thing's own verbs
   (Talk, Hire, Mug, Follow me, Attack...), beside the thing.

   ORDERS ABOUT SOMEONE ELSE (the delegation thesis). An option registered
   with `pick: "person"` is an order whose object is a third person ("Go
   after", "Guard", "Tail"). Choosing it does not fire yet: the wheel closes,
   and whoever you now look at wears that verb, pinned over his head. E (or a
   tap on him) gives the order: onSelect(agent, ctx, target). Q or Esc drops
   it. The agent is the thing the wheel was opened on.

   INPUT
     keyboard  tap Q: the verbs stay up; move the mouse down the column, click
               (or E, or its number) to do it. Hold Q: GTA's weapon-wheel
               grammar, release on a verb to do it. Q / Esc / right-click /
               walking off closes it. The camera does not turn while it is up
               (its mousemove is taken here, in the capture phase).
     touch     tap ANYTHING with a verb (a person, a car, a dog, a gun on the
               wall, an ATM, a chest, a door): systems/touch.js asks
               CBZ.interactions.tapPick what is under the finger, walks you
               there if it is out of reach, and this opens on it (one verb
               only: it just happens). Tap a verb. Tap anywhere else, or the
               thing again, to close. Walking away closes it too.
     pad       D-pad left opens (a Q tap), D-pad right fires (an E).

   PUBLIC: CBZ.verbWheel = { open(cand), openFor(obj), close(), isOpen(),
            ordering(), pickTarget(ped), audit() }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.verbWheel) return;
  const g = CBZ.game;

  const MAX = 10;              // everything a thing offers, "More" included
  const FEW = 4;               // verbs shown before "More" (the likely one + three)
  const HOLD_PICK = 0.28;      // s: a Q held this long is hold-and-release
  const STEER = 22;            // px of mouse travel before a verb is highlighted
  const STEP = 34;             // px of mouse travel per verb down the column
  const ORDER_TTL = 12;        // s to pick who an order is about
  const ORDER_REACH = 45;      // m: you can point at someone across the street
  const RETAP_MS = 450;        // a tap that closed the verbs on a person does not reopen them
  const WALK_OFF = 1.4;        // x REACH: past this the verbs close

  const W = {
    open: false, cand: null, all: [], items: [], sel: -1, more: false,
    held: false, t0: 0, my: 0,
    side: "right", sizes: null, avoid: [],
    closedAt: 0, closedT: null,
    order: null,               // { cand, item, t } while picking a target
  };
  let root = null, ring = null, nameEl = null, btns = [];

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

  // ---- WHICH VERBS, IN WHAT ORDER -------------------------------------------
  /* The first item is what E does (city/interactions.js wheelOf puts it
     first), so tapping the big pill and pressing E are the same thing. The
     rest keep the registry's own order (its priority is its guess at the
     likely verb) nudged by who this is right now:
       your man      orders (Guard, Tail, Attack, Stand down) come up
       angry at you  the hostile verbs come up
       your gun out  robbing comes up
     Two verbs that print the same word are one pill. */
  function worksForYou(p) {
    try { return !!(p && CBZ.cityOrders2 && CBZ.cityOrders2.worksForYou && CBZ.cityOrders2.worksForYou(p)); } catch (e) { return false; }
  }
  function rank(items, cand) {
    if (items.length < 2) return items.slice();
    const p = cand && cand.t;
    const P = CBZ.player;
    const crew = worksForYou(p);
    const angry = !!(p && (p.rage === P || (p.rage && p.state === "fight")));
    let armed = false;
    try { armed = !!(CBZ.cityHasGun && CBZ.cityHasGun()); } catch (e) {}
    const scored = [];
    for (let i = 1; i < items.length; i++) {
      const it = items[i], id = String((it.opt && it.opt.id) || ""), word = short(it.label);
      let s = i;
      if (crew) {
        if (it.pick || /^order-/.test(id)) s -= 100;
        else if (it.bad) s += 40;
      }
      if (angry && it.bad) s -= 60;
      if (armed && /^(Rob|Mug|Take)\b/.test(word)) s -= 30;
      if (!crew && !angry && it.bad) s += 3;          // a stranger: the friendly verbs first
      scored.push({ it: it, s: s, word: word });
    }
    scored.sort(function (a, b) { return a.s - b.s; });
    const out = [items[0]], seen = new Set([short(items[0].label)]);
    for (const e of scored) { if (seen.has(e.word)) continue; seen.add(e.word); out.push(e.it); }
    return out;
  }
  function visible() {
    const all = W.all;
    if (W.more || all.length <= FEW + 1) return all.slice(0, MAX);
    return all.slice(0, FEW).concat([{ more: true, label: "More" }]);
  }

  // ---- DOM -------------------------------------------------------------------
  function dom() {
    if (root || typeof document === "undefined" || !document.body) return root;
    root = document.createElement("div");
    root.id = "verbWheel";
    root.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:60;pointer-events:none;display:none";
    ring = document.createElement("div");
    root.appendChild(ring);
    // WHO HE IS (owner 2026-10-09: "it doesn't say people's names when you
    // click on them"): one short line over his head, the interactions
    // registry's own card title (city/roles.js titles a person)
    nameEl = document.createElement("div");
    nameEl.className = "vname";
    root.appendChild(nameEl);
    document.body.appendChild(root);
    return root;
  }
  // THE LOOK is css/city.css's (CBZ.cityVerbCluster: .vcluster.placed of
  // .vpill, the likely verb as .lead, "More" as .more). This file fills it,
  // measures it, places every pill and routes the input.
  function wire(b, i) {
    let touchAt = -1e9;
    b.addEventListener("touchend", function (e) { e.preventDefault(); e.stopPropagation(); touchAt = Date.now(); fire(i); }, { passive: false });
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (Date.now() - touchAt < 700) return; fire(i); });
  }
  function build() {
    if (!dom() || !CBZ.cityVerbCluster) return false;
    const touch = !!CBZ.touchMode;
    W.items = visible();
    const rows = W.items.map(function (it, i) {
      return { key: touch ? "" : String(i + 1), proposal: it.label, label: it.label, bad: it.bad, more: !!it.more };
    });
    ring.innerHTML = CBZ.cityVerbCluster(rows, { placed: true });
    let who = "";
    try { who = (I() && I().titleOf) ? I().titleOf(W.cand) : ""; } catch (e) { who = ""; }
    nameEl.textContent = who || "";
    nameEl.style.display = who ? "" : "none";
    const box = ring.firstElementChild;
    btns = [];
    const list = box ? box.querySelectorAll(".vpill") : [];
    for (let i = 0; i < list.length; i++) { wire(list[i], i); btns.push(list[i]); }
    // measure the real pills once; placement below is pure arithmetic on these
    root.style.display = "block";
    root.style.visibility = "hidden";
    W.sizes = btns.map(function (b) { return { w: Math.ceil(b.offsetWidth) || 90, h: Math.ceil(b.offsetHeight) || 44 }; });
    W.avoid = controls();
    highlight(-1);
    return btns.length > 0;
  }
  function highlight(i) {
    W.sel = i;
    for (let k = 0; k < btns.length; k++) btns[k].classList.toggle("on", k === i);
  }
  // the other things on the glass the pills may not sit on (touch controls,
  // the radar, the pause button, the seat's way out)
  const AVOID = ["#tstick", "#tbtns .tbtn", "#tveh .tvbtn", "#hudPauseBtn", "#cRadar", "#tExit", "#cWpn", "#hotbar", "#cTopRight"];
  function controls() {
    const out = [];
    for (const sel of AVOID) {
      let els = [];
      try { els = document.querySelectorAll(sel); } catch (e) {}
      for (let i = 0; i < els.length; i++) {
        const r = els[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
    }
    return out;
  }

  // ---- open / close / fire ---------------------------------------------------
  function open(cand) {
    const ii = I();
    if (!cand || !ii || !ii.wheelOf || !live()) return false;
    const all = rank(ii.wheelOf(cand).slice(0, 16), cand);
    if (!all.length) return false;
    W.cand = cand; W.all = all; W.more = false; W.open = true; W.my = 0; W.side = "right";
    if (!build()) { W.open = false; W.cand = null; return false; }
    place();
    if (ii.refresh) ii.refresh();          // the card steps back while the verbs are up
    return true;
  }
  // touch: the world object that was tapped -> its candidate -> its verbs.
  // One verb only: no list, it just happens (a chair, your own car).
  function openFor(obj) {
    const ii = I();
    if (!ii || !ii.candidateFor) return false;
    // a candidate itself (touch.js's screen pick) or the world object it is on
    const cand = obj && obj.layers && obj.t ? obj : ii.candidateFor(obj);
    if (!cand) return false;
    // the tap that just closed the verbs on this very person closes, not reopens
    if (W.closedT === cand.t && Date.now() - W.closedAt < RETAP_MS) return true;
    // the tap is an approach: he says his piece first (no Talk verb), and a
    // line that opens a conversation puts its replies on this very wheel
    const spoke = ii.approach ? ii.approach(cand) : false;
    const items = ii.wheelOf(cand);
    if (!items.length) return !!spoke;
    if (items.length === 1 && !items[0].pick) { ii.fireOn(cand, items[0].opt); return true; }
    return open(cand);
  }
  function close() {
    if (W.open) { W.closedAt = Date.now(); W.closedT = W.cand && W.cand.t; }
    W.open = false; W.cand = null; W.all = []; W.items = []; W.sel = -1; W.held = false; W.more = false;
    if (root) { root.style.display = "none"; }
    const ii = I(); if (ii && ii.refresh) ii.refresh();
  }
  function fire(i) {
    if (!W.open) return;
    const it = W.items[i];
    if (it && it.more) { W.more = true; build(); place(); return; }
    const cand = W.cand;
    close();
    W.closedT = null;                      // a verb was chosen: the next tap is a new tap
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
    if (a && a.kind !== "dog" && CBZ.citySay) { try { CBZ.citySay(a, "Who?", null, 1.6); } catch (e) {} }
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
  // The person's rect on the glass: his head top to his hips, from two
  // projected points, so the column stands beside him at any distance.
  const _v = window.THREE ? new THREE.Vector3() : null;
  function project(x, y, z, w, h) {
    _v.set(x, y, z).project(CBZ.camera);
    if (_v.z > 1 || Math.abs(_v.x) > 1.2 || Math.abs(_v.y) > 1.2) return null;
    return { x: (_v.x * 0.5 + 0.5) * w, y: (-_v.y * 0.5 + 0.5) * h };
  }
  function bodyRect(w, h) {
    const ii = I(), a = ii && ii.anchorOf ? ii.anchorOf(W.cand) : null;
    const cam = CBZ.camera;
    if (a && cam && _v) {
      cam.updateMatrixWorld();
      const person = W.cand.layers && W.cand.layers.indexOf("ped") >= 0;
      const foot = a.y - (person ? 1.2 : 0.9);
      const top = project(a.x, foot + (person ? 1.9 : 1.4), a.z, w, h);
      const hip = project(a.x, foot + (person ? 0.85 : 0.2), a.z, w, h);
      if (top && hip) {
        const tall = Math.max(24, hip.y - top.y);
        const half = Math.max(22, tall * (person ? 0.36 : 0.8));
        return { x: top.x - half, y: top.y, w: half * 2, h: tall, ax: top.x, ay: top.y + tall * 0.45 };
      }
    }
    // off the frame: a small box in the middle of the screen
    return { x: w / 2 - 30, y: h / 2 - 60, w: 60, h: 120, ax: w / 2, ay: h / 2 };
  }
  function place() {
    if (!root || !W.cand || !W.sizes || !CBZ.touchLayout) return;
    const w = window.innerWidth || 800, h = window.innerHeight || 600;
    const b = bodyRect(w, h);
    const L = CBZ.touchLayout.verbColumn({
      W: w, H: h, sizes: W.sizes, gap: 8,
      body: { x: b.x, y: b.y, w: b.w, h: b.h }, anchor: { x: b.ax, y: b.ay },
      avoid: W.avoid, prefer: W.side,
      margin: { top: 12, right: 12, bottom: CBZ.touchMode ? 24 : 12, left: 12 },
    });
    if (!L) return;
    if (L.side === "left" || L.side === "right") W.side = L.side;
    for (let i = 0; i < btns.length && i < L.rects.length; i++) {
      const r = L.rects[i];
      btns[i].style.left = Math.round(r.x) + "px";
      btns[i].style.top = Math.round(r.y) + "px";
    }
    if (nameEl && nameEl.textContent) {
      // centred over his head, kept on the glass
      const nw = nameEl.offsetWidth || 120, nh = nameEl.offsetHeight || 22;
      const nx = Math.max(8, Math.min(w - nw - 8, b.ax - nw / 2));
      const ny = Math.max(8, b.y - nh - 6);
      nameEl.style.left = Math.round(nx) + "px";
      nameEl.style.top = Math.round(ny) + "px";
    }
    root.style.visibility = "";
  }
  function stale() {
    const c = W.cand, t = c && c.t, P = CBZ.player;
    if (!t || t.dead) return true;
    const p = t.pos || (t.group && t.group.position) || (t.x != null ? t : null);
    if (!p || !P || !P.pos) return false;
    const reach = (I() && I().REACH) || 5.2;
    return Math.hypot(p.x - P.pos.x, p.z - P.pos.z) > reach * WALK_OFF;
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
    if (/^[1-9]$/.test(k)) {
      const i = +k - 1;
      if (i < W.items.length) { e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); fire(i); }
    }
  }, true);
  addEventListener("keyup", function (e) {
    if (String(e.key || "").toLowerCase() !== "q" || !W.open || !W.held) return;
    W.held = false;
    if (now() - W.t0 < HOLD_PICK) return;          // a tap: the verbs stay up
    if (W.sel >= 0 && !(W.items[W.sel] && W.items[W.sel].more)) fire(W.sel); else close();   // hold-and-release
  }, true);

  // the mouse steers the highlight down the column; the camera holds still
  function steer(dx, dy) {
    if (!btns.length) return;
    W.my = Math.max(-STEP, Math.min(STEP * btns.length, W.my + dy));
    if (W.sel < 0 && Math.abs(W.my) < STEER) return;
    const i = Math.max(0, Math.min(btns.length - 1, Math.floor(Math.max(0, W.my) / STEP)));
    if (i !== W.sel) highlight(i);
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

  // ---- TOUCH: a tap off the verbs closes them (and a tap on the same person
  // does not open them again: openFor above) ----------------------------------
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
      return { open: W.open, verbs: W.items.map(function (it) { return it.more ? "More" : short(it.label); }),
        all: W.all.length, more: W.more, side: W.side, sel: W.sel,
        ordering: W.order ? short(W.order.item.label) : null };
    },
  };
})();
