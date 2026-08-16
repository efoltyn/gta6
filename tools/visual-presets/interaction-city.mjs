/*
  interaction-city.mjs — the Gang City walk-up card, photographed as a SCREEN.

  Three beats of the one flow the owner called slop: the walk-up (a single
  verb — the registry resolves ~40 registered ped options down to ONE row),
  the two-choice dialogue card, and the post-dialogue state where cooldowns
  hand the card to a lone HIRE row. Captured across the device matrix because
  the card's whole visibility is device-gated: css/city.css's declutter block
  hides #interact on desktop and only body.touch restored it (mobile.css:410)
  until the 2026-08-15 fix — on the BEFORE side the laptop frame should show
  the bug itself: a speech bubble with no answers.

  HUD stays visible — the HUD is the subject. The camera is the player's own.

  Staging facts (verified against src 2026-08-15, statically):
  - city peds: CBZ.cityPeds, position on p.pos; interact reach 5.2m
  - card: #interact (+ .iopt rows), shown by interactions.js showPanel()
  - dialogue: press E near a civ → dialogue.js provideRows → 2 rows + note
  - post-dialogue: p._dlgCD / p._streetDone in the future → ped-hire wins
  - facing: CBZ.cam.yaw, look = (-sin(yaw), -cos(yaw))
  - campaign: jump prologue to free play via cityCampaign.phase
*/

const FRAMES = [
  "iphone-16:portrait",
  "iphone-16:landscape",
  "ipad-mini:portrait",
  "ipad-mini:landscape",
  "laptop",
];

export default {
  id: "interaction-city",
  title: "Gang City — talking to a stranger, across devices",
  description:
    "The #interact card at its three beats (walk-up, two-choice dialogue, the hire-only aftermath) on five device frames. " +
    "Before is the deployed build, where the card is CSS-hidden on any fine-pointer device.",
  frameList: FRAMES,
  urlParams: { seed: 90210 },
  stageTimeoutMs: 420000,
  readyExpression:
    "document.getElementById('playBtn') && document.querySelector('.mode-btn[data-mode=\"city\"]')",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  pairNote: "Same seed, same ped, same beat — the interaction surface is the variable",
  defaultFocus:
    "Can the player SEE their options at all, how many are offered, and does anything look like a control rather than a caption?",
  subjects: [
    {
      id: "walkup",
      label: "Walk-up — the card before any key",
      focus:
        "Stand in reach of a civilian. Desktop-before should show NOTHING (the css/city.css declutter bug); " +
        "touch frames show the one-verb card. One verb is the whole vocabulary the registry lets through.",
    },
    {
      id: "dialogue",
      label: "Two-choice dialogue open",
      focus:
        "After pressing E: the spoken line plus answers A and B. This is the two-choice law's only surface — " +
        "invisible on desktop-before, so the exchange read as 'a pointless interaction'.",
    },
    {
      id: "hire-after",
      label: "After the talk — the lone HIRE row",
      focus:
        "Dialogue and street-offer on cooldown: the next-ranked option is ped-hire, so the card is a single HIRE. " +
        "The slop exhibit — a relationship system reduced to a vending button.",
    },
  ],
  metrics: {
    panelVisible: { label: "Options surface actually visible", unit: "1=yes", better: "higher" },
    verbCount: { label: "Options on screen", unit: "rows", better: "higher" },
    minTapPx: { label: "Smallest option target height", unit: "px", better: "higher" },
    optionChars: { label: "Text the player must read in the options", unit: "chars", better: "lower" },
  },
  metricsNote:
    "panelVisible checks computed display/opacity and an on-viewport box for #interact. verbCount counts visible .iopt rows. " +
    "minTapPx is the shortest visible row's border-box height — the thing a thumb has to hit.",

  stage: async function stageCityInteraction(input) {
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

    let S = window.__cityInteractionSeq;
    if (!S) {
      const booted = await until(
        () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
          document.querySelector('.mode-btn[data-mode="city"]'),
        300000
      );
      if (!booted) return { ok: false, err: "never booted" };
      document.querySelector('.mode-btn[data-mode="city"]').click();
      await wait(250);
      const playing = await until(() => {
        if (CBZ.game.state === "playing") return true;
        const b = document.getElementById("playBtn");
        if (b) b.click();
        return CBZ.game.state === "playing";
      }, 180000, 300);
      if (!playing) return { ok: false, err: "never reached playing" };
      try { if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts"; } catch (_) {}
      try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
      // Freeze the rAF loop; CBZ.stepSim is the only clock from here.
      window.requestAnimationFrame = function () { return 0; };
      await wait(600);
      for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
      S = window.__cityInteractionSeq = {};
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

    // ---- find (once) a plain civilian and stand facing them ----------------
    const P = CBZ.player;
    if (!P || !P.pos) return { ok: false, err: "no player" };
    if (!S.ped || S.ped.dead) {
      let best = null, bd = 1e9;
      for (const p of (CBZ.cityPeds || [])) {
        if (!p || p.dead || p.vendor || p.cop || p.gang || !p.pos) continue;
        const d = Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z);
        if (d < bd) { bd = d; best = p; }
      }
      if (!best) return { ok: false, err: "no civilian ped found" };
      S.ped = best;
    }
    const ped = S.ped;
    const place = () => {
      const dx = 1.8, dz = 0;
      P.pos.set(ped.pos.x + dx, ped.pos.y, ped.pos.z + dz);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
      // face the ped: look = (-sin(yaw), -cos(yaw)) must equal (ped - player)
      const vx = ped.pos.x - P.pos.x, vz = ped.pos.z - P.pos.z;
      if (CBZ.cam) CBZ.cam.yaw = Math.atan2(-vx, -vz);
    };
    place();
    step(0.5);            // let the 12Hz interaction updater elect the card
    place();

    const key = (type, k, code) => {
      document.body.dispatchEvent(new KeyboardEvent(type, { key: k, code: code, bubbles: true }));
    };

    const id = input.subject.id;
    if (id === "walkup") {
      // make sure no dialogue state lingers from a previous frame's page — this
      // page is fresh per frame, so nothing to clear; just settle.
      step(0.4);
    } else if (id === "dialogue") {
      key("keydown", "e", "KeyE");
      step(0.1);
      key("keyup", "e", "KeyE");
      step(0.8);
      place();
      step(0.3);
    } else if (id === "hire-after") {
      // the state after a talk: both talk providers on cooldown, hire affordable
      try { ped._dlgCD = 1e12; ped._streetDone = 1e12; } catch (_) {}
      try { if (CBZ.addCash) CBZ.addCash(500); else if (CBZ.game) CBZ.game.cash = (CBZ.game.cash || 0) + 500; } catch (_) {}
      step(0.6);
      place();
      step(0.3);
    }

    // ---- measure the options surface --------------------------------------
    const panel = document.getElementById("interact");
    const vis = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight;
    };
    const rows = Array.from(document.querySelectorAll("#interact .iopt")).filter(vis);
    const panelVisible = vis(panel) ? 1 : 0;
    const minTapPx = rows.length
      ? Math.min.apply(null, rows.map((r) => r.getBoundingClientRect().height)) : 0;
    const optionChars = rows.reduce((s, r) => s + (r.innerText || "").replace(/\s+/g, "").length, 0);

    return {
      ok: true,
      frame: input.frame ? input.frame.id : null,
      touch: document.body.classList.contains("touch"),
      pedName: ped.name || null,
      note: (document.getElementById("interactNote") || {}).textContent || "",
      rowsText: rows.map((r) => (r.innerText || "").trim()),
      metrics: { panelVisible, verbCount: rows.length, minTapPx, optionChars },
    };
  },
};
