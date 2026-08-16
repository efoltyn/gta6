/*
  interaction-disaster.mjs — the survival grab/punch/shove verbs as a SCREEN.

  The owner's reference point: on PHONE these options are the best-looking
  interaction surface in the repo (#survVerbs — thumb-docked 48px pill
  buttons, cyan glass, press states), while DESKTOP gets the prison's plain
  #interact key-row list with none of that. Two beats — free (Grab/Punch/
  Shove) and carrying (Throw/Set down) — across the device matrix, so the
  phone dock and the desktop card sit side by side in one report.

  HUD stays visible — the HUD is the subject. Camera is the player's own.

  Staging facts (static read 2026-08-15):
  - bots: CBZ.bots, pos on b.pos; grapple REACH 3.1 / CONE 0.25
  - facing: CBZ.cam.yaw, look = (-sin(yaw), -cos(yaw))
  - free/held branch: CBZ.grapple.holding(); grab via CBZ.grapple.grab()
  - touch dock: #survVerbs .svbtn (touch only); desktop: #interact .iopt
*/

const FRAMES = [
  "iphone-16:portrait",
  "iphone-16:landscape",
  "ipad-mini:portrait",
  "ipad-mini:landscape",
  "laptop",
];

export default {
  id: "interaction-disaster",
  title: "Disaster Survival — grab/punch/shove, across devices",
  description:
    "The survival close-quarters verbs in both states (free and carrying) on five device frames. " +
    "Touch renders the bespoke #survVerbs pill dock; desktop renders the generic #interact card.",
  frameList: FRAMES,
  urlParams: { seed: 90210 },
  stageTimeoutMs: 420000,
  readyExpression:
    "document.getElementById('playBtn') && document.querySelector('.mode-btn[data-mode=\"survival\"]')",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  pairNote: "Same seed, same bot, same state — the verb surface is the variable",
  defaultFocus:
    "Why the phone dock reads as controls (shape, size, placement, press state) and the desktop card reads as a caption list.",
  subjects: [
    {
      id: "free-verbs",
      label: "In reach — Grab / Punch / Shove",
      focus:
        "A survivor in reach. Phone: three thumb pills by the fire cluster. Desktop: three flat text rows bottom-right.",
    },
    {
      id: "held-verbs",
      label: "Carrying — Throw / Set down",
      focus:
        "Mid-carry the verb set swaps. The context change is the system's best trick — does each surface make it legible?",
    },
  ],
  metrics: {
    panelVisible: { label: "Options surface actually visible", unit: "1=yes", better: "higher" },
    verbCount: { label: "Options on screen", unit: "rows", better: "higher" },
    minTapPx: { label: "Smallest option target height", unit: "px", better: "higher" },
    optionChars: { label: "Text the player must read in the options", unit: "chars", better: "lower" },
  },
  metricsNote:
    "Counts whichever surface this frame renders: #survVerbs .svbtn pills on touch, #interact .iopt rows on desktop.",

  stage: async function stageDisasterInteraction(input) {
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

    let S = window.__disasterInteractionSeq;
    if (!S) {
      const booted = await until(
        () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
          document.querySelector('.mode-btn[data-mode="survival"]'),
        300000
      );
      if (!booted) return { ok: false, err: "never booted" };
      document.querySelector('.mode-btn[data-mode="survival"]').click();
      await wait(250);
      const playing = await until(() => {
        if (CBZ.game.state === "playing") return true;
        const b = document.getElementById("playBtn");
        if (b) b.click();
        return CBZ.game.state === "playing";
      }, 180000, 300);
      if (!playing) return { ok: false, err: "never reached playing" };
      try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
      window.requestAnimationFrame = function () { return 0; };
      await wait(600);
      for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
      S = window.__disasterInteractionSeq = {};
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

    const P = CBZ.player;
    if (!P || !P.pos) return { ok: false, err: "no player" };
    // nearest live, free bot
    let best = null, bd = 1e9;
    for (const b of (CBZ.bots || [])) {
      if (!b || b.dead || !b.pos) continue;
      const d = Math.hypot(b.pos.x - P.pos.x, b.pos.z - P.pos.z);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) return { ok: false, err: "no bot found" };
    const place = () => {
      // inside grapple's REACH (3.1) and menu reach, facing the bot dead-on
      P.pos.set(best.pos.x + 2.0, best.pos.y, best.pos.z);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
      const vx = best.pos.x - P.pos.x, vz = best.pos.z - P.pos.z;
      if (CBZ.cam) CBZ.cam.yaw = Math.atan2(-vx, -vz);
    };
    place();
    step(0.5);
    place();

    if (input.subject.id === "held-verbs") {
      if (CBZ.grapple && !CBZ.grapple.holding()) { try { CBZ.grapple.grab(); } catch (_) {} }
      step(0.4);
    } else {
      // make sure a previous subject's carry is over (subjects share the page)
      if (CBZ.grapple && CBZ.grapple.holding()) { try { CBZ.grapple.release(false); } catch (_) {} }
      step(0.4);
      place();
      step(0.2);
    }

    // ---- measure whichever surface this frame renders ----------------------
    const vis = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight;
    };
    const dockRows = Array.from(document.querySelectorAll("#survVerbs .svbtn")).filter(vis);
    const cardRows = Array.from(document.querySelectorAll("#interact .iopt")).filter(vis);
    const rows = dockRows.length ? dockRows : cardRows;
    const panel = dockRows.length ? document.getElementById("survVerbs") : document.getElementById("interact");
    const minTapPx = rows.length
      ? Math.min.apply(null, rows.map((r) => r.getBoundingClientRect().height)) : 0;
    const optionChars = rows.reduce((s, r) => s + (r.innerText || "").replace(/\s+/g, "").length, 0);

    return {
      ok: true,
      frame: input.frame ? input.frame.id : null,
      touch: document.body.classList.contains("touch"),
      holding: !!(CBZ.grapple && CBZ.grapple.holding()),
      surface: dockRows.length ? "#survVerbs" : "#interact",
      rowsText: rows.map((r) => (r.innerText || "").trim()),
      metrics: {
        panelVisible: vis(panel) ? 1 : 0,
        verbCount: rows.length,
        minTapPx,
        optionChars,
      },
    };
  },
};
