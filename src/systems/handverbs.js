/* ============================================================
   systems/handverbs.js — THE HANDS' VERBS, ONE COPY FOR EVERY GAME.

   OWNER (2026-09-30): the jail's Grab must work EXACTLY like the disaster
   game's: press Grab and a new set of buttons swaps in while you hold him.

   These sets used to live inside systems/survival_interact.js, so only the
   disaster dock could show them. They live here now and both games read the
   same table: survival_interact.js docks them by the thumb (touch) or lists
   them on #interact (desktop); systems/interact.js pins them on the person in
   the prison. The bodies are CBZ.verbs' (systems/verbs.js: the collar grip,
   the fireman carry, the drag, the throw the world decides) through
   CBZ.grapple's player wrappers (systems/grapple.js). Nothing here moves a
   body; this file only says which verbs the hands have right now.

     CBZ.handVerbs.held()      -> { t, set, kind } while YOU hold somebody
                                  (kind "hold" | "carry" | "drag"), else null
     CBZ.handVerbs.near()      -> { t, set, kind } for the man in reach of
                                  your hands (kind "free" | "down"), else null
     CBZ.handVerbs.throwWord() -> what a throw is here ("Throw in", "Slam"...)
     CBZ.handVerbs.dock        -> THE THUMB DOCK (#survVerbs): show(set, o) /
                                  hide() — one element, one tap handler, for
                                  every game that docks the hands on touch
     CBZ.handVerbs.games[mode] -> what a game adds to the hands (optional):
                                  cands(out)   who the hands may take there
                                  grabOpts(t, opts, up) -> verbs.js start opts
                                  onHands(t, kind)  a transition happened
                                  thrown(t)    -> onOutcome for the throw
                                  can()        the hands are free right now

   THE TRANSITIONS (once each, never per frame): the player's hold on somebody
   becoming "held" / "carried", ending as "dropped", or turning into "thrown",
   go to CBZ.voice.react(target, kind, { by: player actor }) when that exists,
   and to the game's onHands hook. One watcher here covers every game.

   Each set entry is { id, label, fn }. The labels are verbs, never nouns.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const VB = () => CBZ.verbs || null;
  const me = () => (VB() && VB().playerActor ? VB().playerActor() : null);
  const G = () => CBZ.grapple || null;
  let tgt = null;
  // a game's own say over the hands (Gang City: city/restrain.js)
  const GAMES = {};
  function game() { const m = CBZ.game && CBZ.game.mode; return (m && GAMES[m]) || null; }
  // who the hands may take here (undefined = verbs.js's own roster)
  function cands() { const h = game(); return h && h.cands ? h.cands : undefined; }
  // a hand landed on somebody that is not a hold (a shove, a tackle)
  function touched(t, kind) { const h = game(); if (h && h.onHands && t) { try { h.onHands(t, kind); } catch (e) {} } }

  // what the world in front of you makes of a throw
  const THROW_WORD = { water: "Throw in", ledge: "Throw over", rail: "Throw over", wall: "Slam", bed: "Throw", table: "Throw", open: "Throw" };
  function lookDir() { const y = CBZ.cam ? CBZ.cam.yaw : 0; return { x: -Math.sin(y), z: -Math.cos(y) }; }
  function throwWord() {
    const v = VB();
    if (!v || !v.context || !CBZ.player) return "Throw";
    try { const c = v.context(CBZ.player.pos, lookDir(), 2.6); return THROW_WORD[c.kind] || "Throw"; } catch (e) { return "Throw"; }
  }

  const THROW = { id: "throw", label: "Throw", fn: () => G() && G().release(true) };
  // owner (2026-10-19, iPad): "Set down should be Drop." One word, never cut.
  const SET_DOWN = { id: "setDown", label: "Drop", fn: () => G() && G().release(false) };
  const CARRY = { id: "carry", label: "Carry", fn: () => { const v = VB(); if (v && tgt) v.carry(me(), tgt); } };
  const LET_GO = { id: "letGo", label: "Let go", fn: () => G() && G().release(false) };
  const HOLD_VERBS = [THROW, CARRY, SET_DOWN];
  const CARRY_VERBS = [THROW, SET_DOWN];
  const DRAG_VERBS = [LET_GO];
  const FREE_VERBS = [
    { id: "grab", label: "Grab", fn: (t) => G() && G().grab(t || tgt, farOpts(t || tgt)) },
    { id: "punch", label: "Punch", fn: () => G() && G().punch() },
    { id: "shove", label: "Shove", fn: () => G() && G().push() },
    { id: "tackle", label: "Tackle", fn: () => { const v = VB(); if (v && tgt && v.tackle(me(), tgt, farOpts(tgt))) touched(tgt, "tackled"); } },
  ];
  const DOWN_VERBS = [
    { id: "pickUp", label: "Pick up", fn: (t) => G() && G().grab(t || tgt, farOpts(t || tgt)) },
    { id: "drag", label: "Drag", fn: () => { const v = VB(); if (v && tgt) v.drag(me(), tgt, farOpts(tgt)); } },
  ];

  const _R = { t: null, set: null, kind: "", off: {}, far: 0 };
  function held() {
    const v = VB(), pa = me();
    if (!v || !pa) return null;
    const S = v.sessionOf(pa);
    if (!(S && S.a === pa && v.holding(pa))) return null;
    tgt = S.t;
    _R.t = S.t; _R.off = OFF_NONE; _R.far = 0;
    if (S.verb === "drag") { _R.set = DRAG_VERBS; _R.kind = "drag"; }
    else if (S.verb === "carry") { _R.set = CARRY_VERBS; _R.kind = "carry"; }
    else { _R.set = HOLD_VERBS; _R.kind = "hold"; }
    if (_R.set !== DRAG_VERBS) THROW.label = throwWord();
    return _R;
  }
  /* WHO YOUR HANDS ARE ABOUT (owner: "interaction options don't pop up until
     you're right in front of the person"). The grab's own reach is ~1.6 m, so
     the card used to appear only at arm's length. Now the man you LOOK at
     within LOOK_R (line of sight, view-weighted: verbs.pick opts.look) gets
     his verbs from a normal talking distance. The verbs that walk you in
     (Grab, Pick up, Drag, Tackle: verbs.js opts.far) work from there; the
     ones that need him at your fist (Punch, Shove) wait, greyed, until he
     is in reach (_R.off). */
  const LOOK_R = 5.5, LOOK_DOWN_R = 4.5, LOOK_CONE = 0.8;
  const OFF_FAR = { punch: true, shove: true };
  const OFF_NONE = {};
  function distTo(t) {
    const pa = me(), v = VB();
    const A = pa && v && v.body ? v.body(pa) : null, T = t && v && v.body ? v.body(t) : null;
    if (!A || !A.pos || !T || !T.pos) return 0;
    return Math.hypot(T.pos.x - A.pos.x, T.pos.z - A.pos.z);
  }
  function near() {
    const v = VB(), pa = me();
    if (!v || !pa) return null;
    _R.off = OFF_NONE; _R.far = 0;
    const C = cands();
    const up = v.pick(pa, "grab", { look: true, candidates: C });
    if (up) { tgt = up; _R.t = up; _R.set = FREE_VERBS; _R.kind = "free"; return _R; }
    const dn = v.pick(pa, "carry", { down: true, look: true, candidates: C });
    if (dn) { tgt = dn; _R.t = dn; _R.set = DOWN_VERBS; _R.kind = "down"; return _R; }
    const fu = v.pick(pa, "grab", { look: true, reach: LOOK_R, cone: LOOK_CONE, candidates: C });
    if (fu) { tgt = fu; _R.t = fu; _R.set = FREE_VERBS; _R.kind = "free"; _R.far = distTo(fu); _R.off = OFF_FAR; return _R; }
    const fd = v.pick(pa, "carry", { down: true, look: true, reach: LOOK_DOWN_R, cone: LOOK_CONE, candidates: C });
    if (fd) { tgt = fd; _R.t = fd; _R.set = DOWN_VERBS; _R.kind = "down"; _R.far = distTo(fd); return _R; }
    tgt = null;
    return null;
  }
  // the walk-in a menu verb needs to reach the man the card is about
  // (undefined = he is in reach, the verb starts where you stand). A man
  // some other surface chose (the city's hold E, its wheel) is measured.
  function farOpts(t) {
    if (!t) return undefined;
    if (t === _R.t) return _R.far > 0 ? { far: _R.far + 0.5 } : undefined;
    const d = distTo(t);
    return d > 1.5 ? { far: d + 0.5 } : undefined;
  }
  // the one verb a game borrows by id (the prison's Grab on its own cluster)
  function verb(id) {
    const all = FREE_VERBS.concat(DOWN_VERBS, HOLD_VERBS, DRAG_VERBS);
    for (let i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  /* WHAT A BODY IN YOUR HANDS DOES TO YOUR LEGS (systems/physics.js reads it
     into the walk speed). A man dragged by the collar is a slow walk and no
     run; a man over your shoulder is a heavy walk. Nothing in hand: 1. */
  function loadScale() {
    const v = VB(), pa = me();
    if (!v || !pa || !v.holding(pa)) return 1;
    const S = v.sessionOf(pa);
    if (!S || S.a !== pa) return 1;
    return S.verb === "drag" ? 0.45 : S.verb === "carry" ? 0.75 : 1;
  }

  /* ---- THE THUMB DOCK (#survVerbs) ---------------------------------------
     The disaster game's touch surface for the hands: the verbs as tappable
     capsules docked left of the right-thumb cluster, the man's name on top.
     Fixed spot + fixed order = muscle memory. It used to be built inside
     survival_interact.js, so only the disaster game could show it; every game
     that docks the hands on touch now calls this one copy. The LOOK is
     css/interact_touch.css (#survVerbs / .svbtn); this builds the element.
       dock.show(set, { name, off, swim })   set = [{ id, label, fn }]
       dock.hide()
     `off[id]` greys a verb that needs him at your fist (a tap does nothing).
     The rebuild key carries the LABELS, so a verb that renames itself in
     place ("Climb out" / "Climb aboard", "Throw" / "Throw in") is redrawn. */
  const D = { el: null, key: "", set: null, off: OFF_NONE, at: 0 };
  function dockEl() {
    if (!D.el) {
      D.el = document.createElement("div");
      D.el.id = "survVerbs";
      document.body.appendChild(D.el);
    }
    return D.el;
  }
  function dockShow(set, o) {
    o = o || {};
    const off = o.off || OFF_NONE, nm = o.name || "", swim = !!o.swim;
    let key = (swim ? "swim:" : "") + nm + "#";
    for (let i = 0; i < set.length; i++) key += set[i].label + (off[set[i].id] ? "~" : "") + "|";
    const el = dockEl();
    D.set = set; D.off = off;
    if (D.key !== key) {
      D.key = key;
      // column-reverse: the last child sits on top, so the name rides above
      // the buttons (none in the water: the swim verb has no person)
      el.innerHTML = set.map((v, i) =>
        '<button class="svbtn' + (off[v.id] ? " off" : "") + '" type="button" data-i="' + i + '">' + v.label + "</button>").join("") +
        (nm ? '<div class="sv-who"></div>' : "");
      if (nm) el.querySelector(".sv-who").textContent = nm;
      el.classList.toggle("swim", swim);
    }
    el.classList.add("show");
  }
  function dockHide() { if (D.el) { D.el.classList.remove("show"); D.key = ""; D.set = null; } }
  function wall() { return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(); }
  function dockTap(i) {
    const set = D.set;
    if (!set || !D.el || !D.el.classList.contains("show") || i >= set.length) return;
    if (D.off[set[i].id]) return;              // he is not at your fist yet
    const t = wall();
    if (t - D.at < 300) return;
    D.at = t;
    try { set[i].fn(); } catch (e) {}
  }
  function onDockPress(e) {
    const b = e.target && e.target.closest && e.target.closest("#survVerbs .svbtn");
    if (!b) return;
    e.preventDefault();
    dockTap(+b.dataset.i);
  }
  document.addEventListener("touchstart", onDockPress, { passive: false });
  document.addEventListener("mousedown", onDockPress);

  /* ---- THE TRANSITIONS: held / carried / dropped / thrown ----------------
     Watched off the player's own verb session, so it does not matter which
     surface started it (the dock, hold E, the prison's cluster, the city's
     wheel): each change is told once. A hold that becomes another verb on the
     same man (the cuffs going on, a march) is not a drop. */
  const HAND = { grab: "held", carry: "carried", drag: "carried" };
  let wT = null, wK = "";
  function tell(t, kind) {
    const h = game();
    if (h && h.onHands) { try { h.onHands(t, kind); } catch (e) {} }
    const Vo = CBZ.voice;
    if (Vo && typeof Vo.react === "function") { try { Vo.react(t, kind, { by: me() }); } catch (e) {} }
  }
  function watch() {
    const v = VB(), pa = v ? me() : null;
    let t = null, k = "", other = null;
    const S = pa ? v.sessionOf(pa) : null;
    if (S && S.a === pa) {
      if (S.verb === "throw") { t = S.t; k = "thrown"; }
      else if (HAND[S.verb] && !S.tFree && S.phase !== "approach") { t = S.t; k = HAND[S.verb]; }
      else other = S.t;
    }
    if (t === wT && k === wK) return;
    if (wT && wK !== "thrown" && t !== wT && other !== wT && !wT.dead) tell(wT, "dropped");
    if (t && (t !== wT || k !== wK)) tell(t, k);
    wT = t; wK = k;
  }
  if (CBZ.onUpdate) CBZ.onUpdate(46.5, watch);

  CBZ.handVerbs = {
    held: held, near: near, verb: verb, loadScale: loadScale, throwWord: throwWord, THROW_WORD: THROW_WORD,
    dock: { show: dockShow, hide: dockHide, shown: function () { return !!(D.el && D.el.classList.contains("show")); } },
    games: GAMES, game: game, cands: cands, touched: touched, farOpts: farOpts,
  };
})();
