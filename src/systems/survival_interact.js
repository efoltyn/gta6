/* ============================================================
   systems/survival_interact.js — jail-style contextual interaction
   menu for SURVIVAL mode.

   Mirrors the prison's interaction panel "good logic": when a living
   survivor is within arm's reach in front of you, the same #interact
   panel pops up listing the physical verbs you can do to them, picked
   with the shared option keys (I J K L) or by clicking the rows. It's
   ADDITIVE — the direct controls (LMB punch / RMB shove / E grab) still
   work; this just gives the discoverable menu the user liked in jail.

   The verbs are CBZ.verbs' (systems/verbs.js): who is in reach is asked of
   CBZ.verbs.pick with the verb's OWN reach, so the menu can never offer a
   verb the hands cannot do, and what is offered follows the world in front
   of you (a man over water is thrown IN, over a drop he is thrown OVER,
   against a wall he is slammed). This module is pure UI.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const el = {
    interact: document.getElementById("interact"),
    name: document.getElementById("interactName"),
    note: document.getElementById("interactNote"),
    opts: document.getElementById("interactOpts"),
  };
  if (!el.interact) return;

  const OPT_KEYS = ["i", "j", "k", "l"];   // same 4 interaction slots as every mode

  // verb sets — labels + the call each one fires (the keys map through
  // systems/grapple.js; the rest go to CBZ.verbs directly)
  const VB = () => CBZ.verbs || null;
  const me = () => (VB() ? VB().playerActor() : null);
  let tgt = null;                              // the man the card is about
  const THROW = { label: "Throw", fn: () => CBZ.grapple && CBZ.grapple.release(true) };
  const SET_DOWN = { label: "Set down", fn: () => CBZ.grapple && CBZ.grapple.release(false) };
  const CARRY = { label: "Carry", fn: () => { const v = VB(); if (v && tgt) v.carry(me(), tgt); } };
  const HOLD_VERBS = [THROW, CARRY, SET_DOWN];
  const CARRY_VERBS = [THROW, SET_DOWN];
  const DRAG_VERBS = [{ label: "Let go", fn: () => CBZ.grapple && CBZ.grapple.release(false) }];
  const FREE_VERBS = [
    { label: "Grab", fn: () => CBZ.grapple && CBZ.grapple.grab() },
    { label: "Punch", fn: () => CBZ.grapple && CBZ.grapple.punch() },
    { label: "Shove", fn: () => CBZ.grapple && CBZ.grapple.push() },
    { label: "Tackle", fn: () => { const v = VB(); if (v && tgt) v.tackle(me(), tgt); } },
  ];
  const DOWN_VERBS = [
    { label: "Pick up", fn: () => CBZ.grapple && CBZ.grapple.grab() },
    { label: "Drag", fn: () => { const v = VB(); if (v && tgt) v.drag(me(), tgt); } },
  ];
  // what the world in front of you makes of a throw
  const THROW_WORD = { water: "Throw in", ledge: "Throw over", rail: "Throw over", wall: "Slam", bed: "Throw", table: "Throw", open: "Throw" };
  // THE WATER'S ONE VERB (owner: "I want climb out placed like" these).
  // city/swim.js used to render the haul-out as a .tpill in the centre-screen
  // prompt band, which is where a walk-up verb belongs and not where a verb you
  // need mid-swim does — both thumbs are already on the stick and DIVE. It is a
  // contextual physical verb on a thing in reach, which is exactly what this
  // dock is for, so it comes here in the same .svbtn grammar as Throw and Grab.
  // The label is swim.js's own (a moored hull says "Climb aboard", because that
  // press ends with you at its helm), so this file never re-decides it.
  const SWIM_VERBS = [
    { label: "Climb out", fn: () => CBZ.citySwimClimbOut && CBZ.citySwimClimbOut() },
  ];
  function swimOffer() {
    const sw = CBZ.citySwimState ? CBZ.citySwimState() : null;
    if (!sw || !sw.swimming || !sw.climb) return null;
    SWIM_VERBS[0].label = sw.climbVerb || "Climb out";
    return SWIM_VERBS;
  }

  let verbs = [], shown = false, cd = 0;

  // ---- ratchet declaration (see CBZ.prisonPromptAudit in interactions.js).
  // act:null = the key glyph is gone but the ACTION already had a touch
  // surface (#survVerbs), so a second pill would be duplicate chrome.
  (CBZ._prisonPromptSites || (CBZ._prisonPromptSites = [])).push(
    { id: "carry", act: null, was: "LMB throws · E sets down", surface: "#survVerbs" }
  );

  // ---- TOUCH: the same verbs as tappable BUTTONS docked by the right-thumb
  //      cluster (left of #tbtns), instead of a floating card you'd have to
  //      reach across the screen for. Fixed spot + fixed order = muscle
  //      memory. Desktop keeps the #interact card unchanged. ----
  let dock = null, dockMode = "";        // "" hidden · "free" · "held"
  // The dock's LOOK is css/interact_touch.css (#survVerbs / .svbtn). It used
  // to be a <style> string injected from right here, which meant the best
  // button in the repo was invisible to every stylesheet and the prison could
  // only imitate it by hand. Now both wear the same class. This file builds
  // the element and nothing else.
  function ensureDock() {
    if (dock) return;
    dock = document.createElement("div");
    dock.id = "survVerbs";
    document.body.appendChild(dock);
  }
  // `set` is the live verb list; `key` is what decides a rebuild. The key
  // carries the LABELS, not just the set name, because the water's verb renames
  // itself between "Climb out" and "Climb aboard" without the set changing —
  // keying on the name alone would leave the old word on the button.
  function renderDock(set, key) {
    ensureDock();
    if (dockMode !== key) {
      dockMode = key;
      dock.innerHTML = set.map((v, i) =>
        '<button class="svbtn" type="button" data-i="' + i + '">' + v.label + "</button>").join("");
      dock.classList.toggle("swim", key.indexOf("swim:") === 0);
    }
    dock.classList.add("show");
  }
  function hideDock() { if (dock) { dock.classList.remove("show"); dockMode = ""; } }
  document.addEventListener("touchstart", (e) => {
    const b = e.target && e.target.closest && e.target.closest("#survVerbs .svbtn");
    if (!b) return;
    e.preventDefault();
    doAction(+b.dataset.i);
  }, { passive: false });
  document.addEventListener("mousedown", (e) => {
    const b = e.target && e.target.closest && e.target.closest("#survVerbs .svbtn");
    if (!b) return;
    e.preventDefault();
    doAction(+b.dataset.i);
  });

  function lookDir() { const y = CBZ.cam ? CBZ.cam.yaw : 0; return { x: -Math.sin(y), z: -Math.cos(y) }; }

  // who the hands can reach right now: the man you hold, the nearest man on
  // his feet in front (the grab's own reach and cone), or a man already down
  const _T = { set: null };
  function target() {
    const v = VB(); if (!v) return null;
    const pa = me(); if (!pa) return null;
    const S = v.sessionOf(pa);
    if (S && S.a === pa && v.holding(pa)) {
      tgt = S.t;
      if (S.verb === "drag") _T.set = DRAG_VERBS;
      else if (S.verb === "carry") _T.set = CARRY_VERBS;
      else _T.set = HOLD_VERBS;
      if (_T.set !== DRAG_VERBS) {
        const L = lookDir(), c = v.context(CBZ.player.pos, L, 2.6);
        THROW.label = THROW_WORD[c.kind] || "Throw";
      }
      return _T;
    }
    const up = v.pick(pa, "grab");
    if (up) { tgt = up; _T.set = FREE_VERBS; return _T; }
    const dn = v.pick(pa, "carry", { down: true });
    if (dn) { tgt = dn; _T.set = DOWN_VERBS; return _T; }
    tgt = null;
    return null;
  }

  // The desktop card is the verbs and their keys, nothing else: the old
  // "SURVIVOR / in reach" header and the one-word subtitles under each verb
  // ("fling", "hold", "hit") labelled what the verb already says.
  let cardKey = "";
  function keyOf(set) { let k = ""; for (let i = 0; i < set.length; i++) k += set[i].label + "|"; return k; }
  function render(set) {
    verbs = set;
    const key = keyOf(set);
    if (key === cardKey) return;              // same card: leave the DOM alone
    cardKey = key;
    if (el.name.textContent) el.name.textContent = "";
    if (el.note.textContent) el.note.textContent = "";
    el.opts.innerHTML = verbs.map((v, i) =>
      `<div class="iopt" data-i="${i}"><span class="ikey">${OPT_KEYS[i].toUpperCase()}</span>` +
      `<span class="ilab">${v.label}</span></div>`).join("");
  }

  function doAction(i) {
    if (cd > 0 || !shown || i >= verbs.length) return;
    cd = 0.3;
    try { verbs[i].fn(); } catch (e) {}
  }

  el.opts.addEventListener("click", (e) => {
    if (CBZ.game.mode !== "survival") return;          // jail's interact.js owns clicks otherwise
    const row = e.target.closest && e.target.closest(".iopt");
    if (row && row.dataset.i != null) doAction(+row.dataset.i);
  });

  addEventListener("keydown", (e) => {
    if (e.repeat || CBZ.game.mode !== "survival" || !shown) return;
    const i = OPT_KEYS.indexOf(e.key.toLowerCase());
    if (i >= 0) { e.preventDefault(); doAction(i); }
  });

  CBZ.onUpdate(46, function (dt) {
    if (cd > 0) cd -= dt;
    if (CBZ.game.mode !== "survival") return;
    // A MOUNT OWNS THE BODY. grapple.js aims these verbs from a standing
    // human; a player riding an animal (the shark sim's whole game) has no
    // hands free and no ground cone — the panel popping "SURVIVOR · Grab"
    // over a shark closing on a swimmer was pure HUD noise.
    const live = CBZ.game.state === "playing" && !CBZ.player.dead && !CBZ.player._mountedAnimal;
    // THE WATER TAKES PRECEDENCE, and it costs nothing to give it: you cannot
    // grab, punch or shove while you are swimming (grapple.js aims along the
    // ground cone from a body the water owns), so the dock is free, and the one
    // verb the swimmer does have is the one that gets them out. Touch only —
    // swim.js keeps printing "[Space] climb out" for the keyboard, which is
    // where that verb has always lived.
    const swim = (live && CBZ.touchMode) ? swimOffer() : null;
    if (swim) {
      verbs = swim;
      renderDock(swim, "swim:" + swim[0].label);
      el.interact.classList.remove("show");
      shown = true;
      return;
    }
    const t = live ? target() : null;
    if (!t) { if (shown) { shown = false; cardKey = ""; el.interact.classList.remove("show"); hideDock(); } return; }
    verbs = t.set;
    if (CBZ.touchMode) {
      // touch: tappable verb buttons by the thumb cluster, no reach-across card
      renderDock(verbs, keyOf(verbs));
      el.interact.classList.remove("show");
    } else {
      render(verbs);
      el.interact.classList.add("show");
    }
    shown = true;
  });

  CBZ.onAlways(96, function () {
    if (CBZ.game.mode === "survival" && CBZ.game.state !== "playing" && shown) {
      shown = false; cardKey = ""; el.interact.classList.remove("show"); hideDock();
    }
  });
})();
