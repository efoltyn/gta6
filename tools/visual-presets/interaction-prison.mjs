/*
  interaction-prison.mjs — the prison walk-up card, photographed as a SCREEN.

  Two beats: standing at an inmate (insult/befriend/trade/steal + whatever the
  ledger adds) and standing at a guard (bribe/payoff register). The prison is
  the repo's best interaction engine (approach kinds, every exit writes state)
  and #pinteract dresses it three different ways depending on the screen, which
  is what this matrix is for.

  2026-08-20: the PHONE half of that split is gone. It used to be four 58px
  squares plus a row of overflow pills — the thing this preset was built to
  photograph, and the thing the owner finally called out ("the prison game
  buttons suck on iPhone but the nat disaster buttons are PERFECT"). A phone
  now renders the same .svbtn capsule interaction-disaster.mjs photographs,
  from one shared definition in css/interact_touch.css. What is left to watch
  here is the TABLET rail, which is still its own animal.

  HUD stays visible — the HUD is the subject. Camera is the player's own.

  Staging facts (static read 2026-08-20):
  - actors: CBZ.npcs (inmates + warden, pos on n.group.position), CBZ.guards
  - desktop card: #interact + .iopt rows (systems/interact.js render())
  - touch card: #pinteract with #pverbs / #poptions, built lazily by
    buildTouchUI() — only exists under body.touch. Phone: .svbtn capsules in
    one column (the containers are display:contents). Tablet: .pi-choice rows
    with a .pi-action button, gated on CBZ.touchInteractionDocked() (700x550)
*/

const FRAMES = [
  "iphone-16:portrait",
  "iphone-16:landscape",
  "ipad-mini:portrait",
  "ipad-mini:landscape",
  "laptop",
];

export default {
  id: "interaction-prison",
  title: "Prison — the walk-up card, across devices",
  description:
    "The prison interaction surface at an inmate and at a guard, on five device frames. " +
    "Desktop renders #interact key-rows; touch renders the worded #pinteract buttons/rail.",
  frameList: FRAMES,
  urlParams: { seed: 90210 },
  stageTimeoutMs: 420000,
  readyExpression:
    "document.getElementById('playBtn') && document.querySelector('.mode-btn[data-mode=\"escape\"]')",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  pairNote: "Same seed, same actor class, same beat — the interaction surface is the variable",
  defaultFocus:
    "How many options are legible, do they read as controls, and how differently is the same engine dressed on touch vs desktop?",
  subjects: [
    {
      id: "inmate-walkup",
      label: "At an inmate",
      focus:
        "The default social verbs on a stranger. Compare the touch rail's worded buttons with the desktop key-letter list.",
    },
    {
      id: "guard-walkup",
      label: "At a guard",
      focus:
        "The guard register (bribe/payoff). Same widget, different verb set — does the desktop row even say what paying buys?",
    },
  ],
  metrics: {
    panelVisible: { label: "Options surface actually visible", unit: "1=yes", better: "higher" },
    verbCount: { label: "Options on screen", unit: "rows", better: "higher" },
    minTapPx: { label: "Smallest option target height", unit: "px", better: "higher" },
    // HEIGHT ALONE LIES ABOUT A PILL. A 58x58 square scores better than a
    // 48x127 capsule on that row and is a third of the thumb target. Report
    // the area too, so a shape change cannot read as a regression it is not.
    minTapArea: { label: "Smallest option target area", unit: "px²", better: "higher" },
    optionChars: { label: "Text the player must read in the options", unit: "chars", better: "lower" },
  },
  metricsNote:
    "Counts whichever surface this frame renders: #interact .iopt rows on desktop, #pinteract buttons (.pi-action, .tpill, [data-pi]) on touch.",

  stage: async function stagePrisonInteraction(input) {
    const CBZ = window.CBZ;
    if (!CBZ) return { ok: false, err: "no CBZ" };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, budgetMs, stepMs) => {
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) {
        try { if (test()) return true; } catch (_) {}
        await wait(stepMs || 250);
      }
      return false;
    };

    let S = window.__prisonInteractionSeq;
    if (!S) {
      const booted = await until(
        () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
          document.querySelector('.mode-btn[data-mode="escape"]'),
        300000
      );
      if (!booted) return { ok: false, err: "never booted" };
      document.querySelector('.mode-btn[data-mode="escape"]').click();
      await wait(250);
      const playing = await until(() => {
        if (CBZ.game.state === "playing") return true;
        const b = document.getElementById("playBtn");
        if (b) b.click();
        return CBZ.game.state === "playing";
      }, 180000, 300);
      if (!playing) return { ok: false, err: "never reached playing" };
      // PUT THE LOADER AWAY. systems/bootprogress.js's card is a full-screen
      // flex panel and it dismisses itself on a timer whose settle loop is
      // rAF-driven — and the very next line freezes rAF. Every shot this
      // preset took came back as "BUILDING THE WORLD 38%" over a live HUD:
      // the measurements were real, the pictures were of the loading screen.
      try { if (CBZ.bootMeter && CBZ.bootMeter.hide) CBZ.bootMeter.hide(); } catch (_) {}
      try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
      window.requestAnimationFrame = function () { return 0; };
      await wait(600);
      for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
      S = window.__prisonInteractionSeq = {};
      window.__cbzVisualCompare = {
        render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
      };
    }

    const step = (secs) => {
      const n = Math.max(1, Math.round(secs * 60));
      for (let i = 0; i < n; i++) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        CBZ.stepSim(1 / 60);
        if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
      }
    };

    const posOf = (a) => (a && a.pos) || (a && a.group && a.group.position) || null;
    const P = CBZ.player;
    if (!P || !P.pos) return { ok: false, err: "no player" };

    const wantGuard = input.subject.id === "guard-walkup";
    const list = wantGuard ? (CBZ.guards || []) : (CBZ.npcs || []);
    let best = null, bd = 1e9;
    for (const a of list) {
      const ap = posOf(a);
      if (!a || a.dead || !ap) continue;
      const d = Math.hypot(ap.x - P.pos.x, ap.z - P.pos.z);
      if (d < bd) { bd = d; best = a; }
    }
    if (!best) return { ok: false, err: "no actor found for " + input.subject.id };
    const ap = posOf(best);
    const place = () => {
      P.pos.set(ap.x + 1.4, ap.y, ap.z);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
      const vx = ap.x - P.pos.x, vz = ap.z - P.pos.z;
      if (CBZ.cam) CBZ.cam.yaw = Math.atan2(-vx, -vz);
    };
    place();
    step(0.6);
    place();
    step(0.3);

    // ---- measure whichever surface this frame renders ----------------------
    const vis = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight;
    };
    const desktopRows = Array.from(document.querySelectorAll("#interact .iopt")).filter(vis);
    const touchRows = Array.from(
      document.querySelectorAll("#pinteract .pi-action, #pinteract .tpill, #pinteract [data-pi]")
    ).filter(vis);
    const rows = touchRows.length ? touchRows : desktopRows;
    const panel = touchRows.length ? document.getElementById("pinteract") : document.getElementById("interact");
    const minTapPx = rows.length
      ? Math.min.apply(null, rows.map((r) => r.getBoundingClientRect().height)) : 0;
    const minTapArea = rows.length
      ? Math.round(Math.min.apply(null, rows.map((r) => {
          const b = r.getBoundingClientRect();
          return b.width * b.height;
        }))) : 0;
    const optionChars = rows.reduce((s, r) => s + (r.innerText || "").replace(/\s+/g, "").length, 0);

    return {
      ok: true,
      frame: input.frame ? input.frame.id : null,
      touch: document.body.classList.contains("touch"),
      actor: best.name || (wantGuard ? "guard" : "inmate"),
      surface: touchRows.length ? "#pinteract" : "#interact",
      rowsText: rows.map((r) => (r.innerText || "").trim()),
      metrics: {
        panelVisible: vis(panel) ? 1 : 0,
        verbCount: rows.length,
        minTapPx,
        minTapArea,
        optionChars,
      },
    };
  },
};
