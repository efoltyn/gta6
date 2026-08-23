/* ============================================================
   systems/survival_interact.js — jail-style contextual interaction
   menu for SURVIVAL mode.

   Mirrors the prison's interaction panel "good logic": when a living
   survivor is within arm's reach in front of you, the same #interact
   panel pops up listing the physical verbs you can do to them, picked
   with the shared option keys (I J K L) or by clicking the rows. It's
   ADDITIVE — the direct controls (LMB punch / RMB shove / E grab) still
   work; this just gives the discoverable menu the user liked in jail.

   The verbs delegate to systems/grapple.js (which owns the body physics
   and aims at the nearest target itself), so this module is pure UI.
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
  // must match grapple.js's REACH/CONE exactly — a looser menu advertises
  // Grab/Punch/Shove in a shell where aimTarget() is null and the verb no-ops
  const REACH = 3.1, CONE = 0.25;

  // verb sets — labels + the grapple call each one fires
  const HOLD_VERBS = [
    { label: "Throw", sub: "fling", fn: () => CBZ.grapple && CBZ.grapple.release(true) },
    { label: "Set down", sub: "safe", fn: () => CBZ.grapple && CBZ.grapple.release(false) },
  ];
  const FREE_VERBS = [
    { label: "Grab", sub: "hold", fn: () => CBZ.grapple && CBZ.grapple.grab() },
    { label: "Punch", sub: "hit", fn: () => CBZ.grapple && CBZ.grapple.punch() },
    { label: "Shove", sub: "push", fn: () => CBZ.grapple && CBZ.grapple.push() },
  ];
  // THE WATER'S ONE VERB (owner: "I want climb out placed like" these).
  // city/swim.js used to render the haul-out as a .tpill in the centre-screen
  // prompt band, which is where a walk-up verb belongs and not where a verb you
  // need mid-swim does — both thumbs are already on the stick and DIVE. It is a
  // contextual physical verb on a thing in reach, which is exactly what this
  // dock is for, so it comes here in the same .svbtn grammar as Throw and Grab.
  // The label is swim.js's own (a moored hull says "Climb aboard", because that
  // press ends with you at its helm), so this file never re-decides it.
  const SWIM_VERBS = [
    { label: "Climb out", sub: "haul up", fn: () => CBZ.citySwimClimbOut && CBZ.citySwimClimbOut() },
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

  // nearest living survivor within reach + roughly in front (for showing the menu)
  function target() {
    const held = CBZ.grapple && CBZ.grapple.holding && CBZ.grapple.holding();
    if (held) return { held: true };
    const P = CBZ.player.pos, L = lookDir();
    let best = null, bd = REACH;
    const bots = CBZ.bots || [];
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (b.dead || (CBZ.body && CBZ.body.busy(b))) continue;
      const dx = b.pos.x - P.x, dz = b.pos.z - P.z, d = Math.hypot(dx, dz);
      if (d > REACH || d < 0.1) continue;
      if ((dx / d) * L.x + (dz / d) * L.z < CONE) continue;
      if (d < bd) { bd = d; best = b; }
    }
    return best ? { held: false, bot: best } : null;
  }

  function render(held) {
    verbs = held ? HOLD_VERBS : FREE_VERBS;
    el.name.textContent = held ? "CARRYING" : "SURVIVOR";
    // PRISON_TOUCH_PROMPTS: "LMB" and "E" are unactionable on a touchscreen.
    // No pill is needed — renderDock() below already puts BOTH verbs on screen
    // as tappable .svbtn buttons, so touch just gets told what it can see.
    const ptp = !CBZ.CONFIG || CBZ.CONFIG.PRISON_TOUCH_PROMPTS !== false;
    const touch = !!(CBZ.touchMode || (document.body && document.body.classList.contains("touch")));
    el.note.textContent = held
      ? (ptp && touch ? "throw or set down" : "LMB throws · E sets down")
      : "in reach";
    el.opts.innerHTML = verbs.map((v, i) =>
      `<div class="iopt" data-i="${i}"><span class="ikey">${OPT_KEYS[i].toUpperCase()}</span>` +
      `<span class="ilab">${v.label}</span><span class="isub">${v.sub}</span></div>`).join("");
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
    if (!t) { if (shown) { shown = false; el.interact.classList.remove("show"); hideDock(); } return; }
    verbs = t.held ? HOLD_VERBS : FREE_VERBS;
    if (CBZ.touchMode) {
      // touch: tappable verb buttons by the thumb cluster, no reach-across card
      renderDock(verbs, t.held ? "held" : "free");
      el.interact.classList.remove("show");
    } else {
      render(t.held);
      el.interact.classList.add("show");
    }
    shown = true;
  });

  CBZ.onAlways(96, function () {
    if (CBZ.game.mode === "survival" && CBZ.game.state !== "playing" && shown) {
      shown = false; el.interact.classList.remove("show"); hideDock();
    }
  });
})();
