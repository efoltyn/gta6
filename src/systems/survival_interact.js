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
  const REACH = 3.4, CONE = 0.2;

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

  let verbs = [], shown = false, cd = 0;

  // ---- TOUCH: the same verbs as tappable BUTTONS docked by the right-thumb
  //      cluster (left of #tbtns), instead of a floating card you'd have to
  //      reach across the screen for. Fixed spot + fixed order = muscle
  //      memory. Desktop keeps the #interact card unchanged. ----
  let dock = null, dockMode = "";        // "" hidden · "free" · "held"
  function ensureDock() {
    if (dock) return;
    const style = document.createElement("style");
    style.textContent =
      "#survVerbs{position:fixed;right:calc(112px + env(safe-area-inset-right,0px));" +
      "bottom:calc(34px + env(safe-area-inset-bottom,0px));z-index:23;display:none;" +
      "flex-direction:column-reverse;gap:10px;pointer-events:none;}" +
      "#survVerbs.show{display:flex;}" +
      ".svbtn{pointer-events:auto;min-width:104px;height:48px;border-radius:24px;padding:0 18px;" +
      "border:1.5px solid rgba(127,231,255,.5);background:rgba(10,20,32,.68);color:#eaf4ff;" +
      "font-family:Fredoka,system-ui,sans-serif;font-weight:600;font-size:16px;letter-spacing:.6px;" +
      "text-align:center;-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);}" +
      ".svbtn:active{background:rgba(127,231,255,.28);}";
    document.head.appendChild(style);
    dock = document.createElement("div");
    dock.id = "survVerbs";
    document.body.appendChild(dock);
  }
  function renderDock(held) {
    ensureDock();
    const mode = held ? "held" : "free";
    if (dockMode !== mode) {
      dockMode = mode;
      dock.innerHTML = (held ? HOLD_VERBS : FREE_VERBS).map((v, i) =>
        '<button class="svbtn" type="button" data-i="' + i + '">' + v.label + "</button>").join("");
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
    el.note.textContent = held ? "LMB throws · E sets down" : "in reach";
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
    const t = (CBZ.game.state === "playing" && !CBZ.player.dead) ? target() : null;
    if (!t) { if (shown) { shown = false; el.interact.classList.remove("show"); hideDock(); } return; }
    verbs = t.held ? HOLD_VERBS : FREE_VERBS;
    if (CBZ.touchMode) {
      // touch: tappable verb buttons by the thumb cluster, no reach-across card
      renderDock(t.held);
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
