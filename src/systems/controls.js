/* ============================================================
   systems/controls.js — THE ONE PLACE THE GAME TELLS YOU HOW TO PLAY IT.

   WHY THIS EXISTS (owner, from play): "planes are not moving" — followed by
   "actually planes do move, they just changed the control and I didn't know
   the control."

   That is the whole bug, and it was never a flight bug. FLIGHT_CONTROLS_V2
   moved throttle off W/S onto Space/Ctrl so that W/S could become the pitch
   axis (which is what makes the touch stick a real joystick). It is a better
   control scheme. But nothing in this game has EVER had a controls screen —
   not in settings, not on a pause menu, nowhere — so the only way to learn a
   binding was to already know it. Change the scheme and the aircraft becomes,
   from the player's seat, broken.

   A feature nobody can find is not a feature. The engine had grown a real
   flight model, a parachute, a helm, a collective — and no way to discover any
   of them.

   THE RULE THIS FILE ENFORCES: a system that adds a control DECLARES it here,
   in one line, next to the code that reads the key. Not in a wiki, not in a
   comment, not in a README nobody opens — here, where the player can see it.
   If the binding changes, the card changes in the same edit, because they are
   the same edit.

     CBZ.controls.declare("plane", {
       title: "Aeroplane",
       rows: [["W / S", "Nose down / up"], ["Space", "Throttle up"], ...],
     });

   BEHAVIOUR (owner: "control should pop up until you close them"):
   the card appears the first time you enter a context — on foot, driving,
   flying, under canopy — and STAYS until you close it. Not a timed toast that
   vanishes before you have read it. Once you have dismissed a context's card
   it never opens itself again that session; you have learned it. [?] reopens
   any of them at any time, and on touch there is a pill.

   HUD DOCTRINE: this is not a notification and it is not a floating info card.
   The killfeed remains the only popup. This is a reference sheet that opens on
   request or on a genuinely new context and closes for good once read — the
   same standing the instrument cluster has. It never announces events, never
   reacts to the world, and shows nothing that is not a key you can press.

   NO FICTIONS: every row here was read out of the file that consumes the key
   (playeraircraft.js's k["..."] tests, vehicles.js, bailout.js). If a row is
   not backed by a live key test, it does not go on the card.

   Flags: CONTROLS_CARD (whole file) · CONTROLS_AUTO (the first-time pop).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.CONTROLS_CARD == null) CBZ.CONFIG.CONTROLS_CARD = true;
  if (CBZ.CONFIG.CONTROLS_AUTO == null) CBZ.CONFIG.CONTROLS_AUTO = true;

  const defs = Object.create(null);      // id -> {title, rows, note}
  const seen = Object.create(null);      // id -> dismissed this session
  let el = null, cur = "", openId = "";

  function on() { return CBZ.CONFIG.CONTROLS_CARD !== false; }

  /* ---- THE REGISTRY — one line per system -------------------------------- */
  const C = CBZ.controls = {
    declare: function (id, def) {
      if (!id || !def) return;
      defs[id] = { title: def.title || id, rows: def.rows || [], note: def.note || "" };
    },
    has: function (id) { return !!defs[id]; },
    ids: function () { return Object.keys(defs); },
    show: function (id) { if (defs[id]) { openId = id; render(); } },
    hide: function () { if (openId) { seen[openId] = true; openId = ""; render(); } },
    toggle: function (id) { if (openId) C.hide(); else C.show(id || context()); },
    // "has the player already been shown and dismissed this one"
    dismissed: function (id) { return !!seen[id]; },
    // Which card is up right now ("" for none). The card's own keydown claims
    // Space/Enter/Esc to dismiss itself, so any OTHER overlay that wants Space
    // has to be able to see that this press is already spoken for — that is
    // what systems/fullmap.js's Space-clears-waypoint asks before it acts.
    open: function () { return openId || ""; },
  };

  /* ---- WHAT AM I DOING RIGHT NOW ----------------------------------------
     Read off live state, never a flag anyone has to remember to set. Order
     matters: the parachute outranks the aircraft you just left. */
  function context() {
    const g = CBZ.game, P = CBZ.player;
    if (!g || g.mode !== "city" || !P || P.dead) return "";
    if (CBZ.cityChuteState && CBZ.cityChuteState()) return "chute";
    const craft = P._aircraft;
    if (craft) return craft.kind === "heli" ? "heli" : "plane";
    if (P.driving && P._vehicle) {
      const feel = P._vehicle._playerCarFeel;
      return (feel && feel.class === "marine") ? "boat" : "drive";
    }
    return "foot";
  }

  /* ---- THE CARD ----------------------------------------------------------- */
  function build() {
    if (el) return;
    const css = document.createElement("style");
    css.textContent = [
      "#cCtrl{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;",
      "min-width:290px;max-width:min(440px,92vw);padding:16px 18px 14px;border-radius:14px;",
      "background:rgba(10,14,20,.92);border:1px solid rgba(255,255,255,.14);",
      "box-shadow:0 12px 40px rgba(0,0,0,.55);color:#e8edf5;display:none;",
      "font:14px/1.35 'Fredoka',system-ui,sans-serif}",
      "#cCtrl h3{margin:0 0 10px;font-size:17px;font-weight:700;letter-spacing:.2px}",
      "#cCtrl table{width:100%;border-collapse:collapse}",
      "#cCtrl td{padding:4px 0;vertical-align:top}",
      "#cCtrl td.k{width:40%;padding-right:12px;white-space:nowrap}",
      "#cCtrl kbd{display:inline-block;padding:2px 7px;margin:1px 2px 1px 0;border-radius:5px;",
      "background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.18);",
      "border-bottom-width:2px;font:600 12px ui-monospace,Menlo,monospace;color:#cfe0f5}",
      "#cCtrl td.d{color:#b9c6d6}",
      "#cCtrl .note{margin-top:10px;color:#8fa3b8;font-size:12px;line-height:1.4}",
      "#cCtrl .close{margin-top:13px;width:100%;padding:11px;border-radius:999px;cursor:pointer;",
      "background:rgba(255,255,255,.11);border:1px solid rgba(255,255,255,.18);",
      "color:#e8edf5;font:600 14px 'Fredoka',system-ui,sans-serif}",
      "#cCtrl .close:hover{background:rgba(255,255,255,.18)}",
      // the DESKTOP dismiss: a key, not a button. Same kbd chrome as the rows
      // above, so it reads as one more binding rather than as UI furniture.
      "#cCtrl .dismiss{margin-top:13px;padding-top:11px;text-align:center;color:#8fa3b8;",
      "font-size:12.5px;border-top:1px solid rgba(255,255,255,.10)}",
      "body.touch #cCtrl{font-size:15px}",
    ].join("");
    document.head.appendChild(css);
    el = document.createElement("div");
    el.id = "cCtrl";
    document.body.appendChild(el);
  }

  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
  // "W / S" -> two <kbd>s with the slash between them
  function keys(s) {
    return esc(s).split(/\s*\/\s*/).map((k) => "<kbd>" + k + "</kbd>").join(" / ");
  }

  /* ---- HOW YOU CLOSE IT ---------------------------------------------------
     OWNER (verbatim): "right now it's a 'Got it' button to close, it should be
     a key to close, because 'Got it' isn't a pressable button unless on iPad."

     He is right and he is also only half the problem: on an iPad the button IS
     the only way to close it, so replacing it with a key would break touch
     exactly as badly as the key's absence broke desktop. The answer is the one
     CLAUDE.md's touch doctrine already prescribes — words-and-pills for touch,
     key glyphs for keyboard, and NEVER a keyboard glyph rendered on a touch
     device (`CBZ.touchActionPrompt` re-skins prompts for precisely this
     reason). So the dismiss is whichever the player actually has:

       touch   → the pill stays, and it is a real tap target (touchend, not
                 just click, because a click on iOS lags 300 ms behind).
       desktop → NO button at all. Space / Enter / Esc close it, and the card
                 says so in the same <kbd> chrome as every binding above it —
                 which makes the dismiss one more thing this card TEACHES.

     Detection is `CBZ.touchMode`, the single flag systems/touch.js raises in
     enable() alongside `body.touch` (touch.js:152-153). Read live at render
     time, so a card opened before the first touch and a card opened after it
     are each correct. */
  function isTouch() {
    if (CBZ.touchMode) return true;
    try { return !!(document.body && document.body.classList.contains("touch")); } catch (e) { return false; }
  }

  function render() {
    if (!on()) { if (el) el.style.display = "none"; return; }
    build();
    const d = defs[openId];
    if (!d) { el.style.display = "none"; return; }
    let rows = "";
    for (let i = 0; i < d.rows.length; i++) {
      const r = d.rows[i];
      rows += '<tr><td class="k">' + keys(r[0]) + '</td><td class="d">' + esc(r[1]) + "</td></tr>";
    }
    const touch = isTouch();
    const dismiss = touch
      ? '<button type="button" class="close">Got it</button>'
      : '<div class="dismiss">' + keys("Space") + " / " + keys("Esc") + " to close</div>";
    el.innerHTML =
      "<h3>" + esc(d.title) + "</h3><table>" + rows + "</table>" +
      (d.note ? '<div class="note">' + esc(d.note) + "</div>" : "") +
      dismiss;
    el.style.display = "block";
    const b = el.querySelector(".close");
    if (b) {
      b.addEventListener("click", function (e) { e.preventDefault(); C.hide(); });
      b.addEventListener("touchend", function (e) { e.preventDefault(); C.hide(); }, { passive: false });
    }
  }

  /* ---- THE FIRST-TIME POP ------------------------------------------------- */
  CBZ.onAlways(96, function () {
    if (!on()) return;
    const now = context();
    if (now === cur) return;
    cur = now;
    if (!now || !CBZ.CONFIG.CONTROLS_AUTO) return;
    // Only ever ONCE per context per session, and never over a menu.
    if (seen[now] || openId || CBZ.cityMenuOpen) return;
    if (!defs[now]) return;
    // On foot is the one context nobody needs taught — WASD in a third-person
    // game is not a discovery. It stays reachable on [?] and never pops.
    if (now === "foot") { seen[now] = true; return; }
    C.show(now);
  });

  /* ---- [?] REOPENS ANYTHING ---------------------------------------------- */
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("keydown", function (e) {
      if (!on() || e.repeat) return;
      const k = (e.key || "");
      // A KEY CLOSES IT. Space is the primary because it is the one key every
      // player already has a thumb on and because it is the throttle/collective
      // on the two cards that actually pop — so the same press that dismisses
      // the aeroplane card is the press that starts the takeoff roll. Enter and
      // Esc are the conventional pair; ? and / toggle as before. preventDefault
      // stops that dismissing press from ALSO jumping.
      if (openId && (k === "Escape" || k === " " || k === "Spacebar" || k === "Enter" || k === "?" || k === "/")) {
        e.preventDefault(); C.hide(); return;
      }
      if (k === "?" || (k === "/" && e.shiftKey)) {
        if (CBZ.cityMenuOpen) return;
        e.preventDefault();
        C.show(context() || "foot");
      }
    });
  }

  /* ======================================================================
     THE DECLARATIONS. Every row below was read out of the live key test in
     the file that consumes it — not remembered, not assumed.
     ====================================================================== */
  C.declare("foot", {
    title: "On foot",
    rows: [
      ["W / A / S / D", "Move"],
      ["Shift", "Sprint"],
      ["Space", "Jump"],
      ["E", "Interact — doors, seats, vehicles, loot"],
      ["?", "Show the controls for whatever you are doing"],
      ["Space / Esc", "Close this card"],
    ],
  });

  // playeraircraft.js:2055-2144 — the V2 scheme. THIS is the card that had to
  // exist: power moved to Space/Ctrl so W/S could fly the nose, and there was
  // no way on earth to find that out from inside the game.
  C.declare("plane", {
    title: "Aeroplane",
    rows: [
      ["Space", "Throttle up — hold to build speed"],
      ["Ctrl", "Throttle down / wheel brakes"],
      ["W / S", "Nose down / nose up"],
      ["A / D", "Roll left / right — bank to turn"],
      ["Q / E", "Rudder"],
      ["V", "Cockpit view"],
      ["F", "Get out — in the air, that means jump"],
    ],
    note: "Throttle is Space, not W. W and S fly the nose. You need speed before the wings will lift you — hold Space down the runway first.",
  });

  C.declare("heli", {
    title: "Helicopter",
    rows: [
      ["Space", "Collective up — climb"],
      ["Ctrl", "Collective down — descend"],
      ["W / S", "Cyclic forward / back"],
      ["A / D", "Pedals — yaw"],
      ["Q / E", "Slide left / right"],
      ["V", "Cockpit view"],
      ["F", "Get out"],
    ],
  });

  // bailout.js
  C.declare("chute", {
    title: "Falling",
    rows: [
      ["Space", "Pull the canopy"],
      ["A / D", "Steer"],
      ["S", "Flare — bleed speed before you land"],
    ],
    note: "Pull high enough and you can steer where you land. Pull too late and the ground decides.",
  });

  C.declare("drive", {
    title: "Driving",
    rows: [
      ["W / S", "Accelerate / brake and reverse"],
      ["A / D", "Steer"],
      ["Space", "Handbrake"],
      ["F", "Get out"],
    ],
    note: "Watch the fuel bar on the dash — run dry and the engine quits. Gas stations refuel on E.",
  });

  C.declare("boat", {
    title: "At the helm",
    rows: [
      ["W / S", "Throttle ahead / astern"],
      ["A / D", "Steer"],
      ["F", "Step off"],
    ],
  });

  // Evidence: which contexts have a card, and which the player has read.
  CBZ.controlsAudit = function () {
    const ids = Object.keys(defs);
    let read = 0;
    for (let i = 0; i < ids.length; i++) if (seen[ids[i]]) read++;
    return { declared: ids.length, dismissed: read, open: openId || null };
  };
})();
