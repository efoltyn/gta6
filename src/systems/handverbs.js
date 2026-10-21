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
    { id: "tackle", label: "Tackle", fn: () => { const v = VB(); if (v && tgt) v.tackle(me(), tgt, farOpts(tgt)); } },
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
    const up = v.pick(pa, "grab", { look: true });
    if (up) { tgt = up; _R.t = up; _R.set = FREE_VERBS; _R.kind = "free"; return _R; }
    const dn = v.pick(pa, "carry", { down: true, look: true });
    if (dn) { tgt = dn; _R.t = dn; _R.set = DOWN_VERBS; _R.kind = "down"; return _R; }
    const fu = v.pick(pa, "grab", { look: true, reach: LOOK_R, cone: LOOK_CONE });
    if (fu) { tgt = fu; _R.t = fu; _R.set = FREE_VERBS; _R.kind = "free"; _R.far = distTo(fu); _R.off = OFF_FAR; return _R; }
    const fd = v.pick(pa, "carry", { down: true, look: true, reach: LOOK_DOWN_R, cone: LOOK_CONE });
    if (fd) { tgt = fd; _R.t = fd; _R.set = DOWN_VERBS; _R.kind = "down"; _R.far = distTo(fd); return _R; }
    tgt = null;
    return null;
  }
  // the walk-in a menu verb needs to reach the man the card is about
  // (undefined = he is in reach, the verb starts where you stand)
  function farOpts(t) { return t && t === _R.t && _R.far > 0 ? { far: _R.far + 0.5 } : undefined; }
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
  CBZ.handVerbs = { held: held, near: near, verb: verb, loadScale: loadScale, throwWord: throwWord, THROW_WORD: THROW_WORD };
})();
