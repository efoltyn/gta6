/* Shark Sim UI CUT — everything on the glass while you swim, and the pause card.

   Owner, 2026-09-27, on his iPad: "the third-person switch doesn't even need an
   option. You're just adding too many buttons." Then: "every HUD, the
   overlapping tabs, everything should be considered for removal, including the
   minimap, the timer, the PB run, pills that mean nothing. SHOW DON'T TELL."

   Two subjects on an iPad (landscape) and a laptop frame:
     swimming  the full screen mid-match, four sim-seconds past the opening
     paused    the pause card over the same frame
   Metrics count what is actually on screen (live getClientRects, computed
   visibility), so "fewer buttons" is a number and not a claim.

   Run HEAD-vs-worktree:
     git worktree add --detach /tmp/sharkui-head HEAD
     (cd /tmp/sharkui-head && PORT=8611 python3 tools/devserver.py &)
     node tools/visual-compare.mjs --preset shark-ui-cut --before http://127.0.0.1:8611/ */

const subjects = [
  { id: "swimming", label: "Swimming: Everything On The Glass", focus: "Every button, pill, bar and counter a player sees mid-match." },
  { id: "paused", label: "The Pause Card", focus: "What pause offers." },
];

async function stageUiCut(input) {
  const CBZ = window.CBZ, sub = input.subject;
  if (!CBZ || !window.THREE || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let D = window.__sharkUiCut;
  if (!D) {
    D = window.__sharkUiCut = {
      booted: false,
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },
      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb && CBZ.game.mode !== "sharksim") mb.click();
          const pb = document.getElementById("playBtn");
          if (pb && CBZ.game.state === "title" && !(CBZ.sharkTitle && CBZ.sharkTitle.launch && CBZ.sharkTitle.launch.started)) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 60 && !D.armed(); t++) { D.step(15); await sleep(20); }
        if (!D.armed()) return false;
        D.step(120);
        // the launch intro overlay leaves on first input; the shot is of play
        const intro = document.getElementById("sharkIntro");
        if (intro) intro.classList.remove("on");
        const boot = document.getElementById("sharkBoot");
        if (boot) boot.remove();
        document.documentElement.classList.remove("boot-sharksim");
        D._rafOrig = window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => D._rafOrig.call(window, () => res()));
        window.__cbzVisualCompare = {
          async render() {
            if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
            if (!CBZ.renderer) return;
            await new Promise((res) => D._rafOrig.call(window, () => { CBZ.renderer.render(CBZ.scene, CBZ.camera); res(); }));
            await new Promise((r) => setTimeout(r, 1200));
          },
        };
        D.booted = true;
        return true;
      },
    };
  }
  if (!D.booted && !(await D.boot())) return { ok: false, missing: "match" };

  if (sub.id === "paused") { if (CBZ.setState) CBZ.setState("paused"); }
  else if (CBZ.game.state === "paused" && CBZ.setState) CBZ.setState("playing");
  await sleep(60);

  // what is on the glass: anything visible, in the viewport, not a full-screen layer
  const seen = (el) => {
    if (!el || !el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || +cs.opacity < 0.05) return false;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.display === "none" || ps.visibility === "hidden" || +ps.opacity < 0.05) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
  };
  const controls = Array.from(document.querySelectorAll("button, .tbtn, .tvbtn, #tstick, canvas#minimap")).filter(seen);
  const hudIds = ["timer", "sharkScore", "survTop", "survBars", "sharkhud", "objective", "cityKillFeed", "minimap", "hint", "toast"];
  const panels = hudIds.map((id) => document.getElementById(id)).filter(seen);
  const m = { controlsOnScreen: controls.length, hudReadouts: panels.length };
  if (sub.id === "paused") {
    const card = document.querySelector("#pause .card-box");
    m.pauseItems = card ? Array.from(card.querySelectorAll("button")).filter(seen).length : -1;
  }
  return {
    ok: true, side: input.side,
    debug: {
      state: CBZ.game.state, touch: document.body.classList.contains("touch") ? 1 : 0,
      controls: controls.map((e) => e.id || e.className || e.tagName).join(" "),
      hud: panels.map((e) => e.id).join(" "),
    },
    metrics: m,
  };
}

export default {
  id: "shark-ui-cut",
  title: "Shark Sim: The UI Cut",
  description: "Everything a Shark Sim player sees while swimming, and the pause card, on an iPad and a laptop. BEFORE: score pill, clock, health/stamina bars with labels, evolve sliver, casualty feed, Settings (with a camera switch) on pause, no touch pause. AFTER: nothing over the water but the red hunger edge; touch glass is the stick, RISE/DIVE and one pause button; pause is Resume, Restart, Main Menu.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · worktree (UI cut)",
  pairNote: "Same seed · same match beat · the frame's own touch identity builds the glass",
  method: "Each side boots ?mode=sharksim on the device frame, waits for the shark mount, steps four sim-seconds with the page's frame loop frozen, and photographs the whole screen; the paused subject sets the pause state over the same frame. Metrics count visible controls and HUD readouts from live getClientRects.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  frameList: ["ipad-mini:landscape", "laptop"],
  stageTimeoutMs: 240000,
  metrics: {
    controlsOnScreen: { label: "Buttons/controls on screen", better: "lower" },
    hudReadouts: { label: "HUD readouts (score, clock, bars, feed...)", better: "lower" },
    pauseItems: { label: "Pause card items", better: "lower" },
  },
  viewport: { width: 1133, height: 744 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  subjects,
  stage: stageUiCut,
};
