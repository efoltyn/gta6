/* Shark Sim's TOUCH GLASS — where the thumb controls actually sit.

   One subject, captured on phone/tablet device frames (--devices; the frame's
   identity is what makes body.touch exist at all). The interesting run is
   HEAD-vs-worktree: serve a detached HEAD worktree with tools/devserver.py and
   pass it as --before, so the two columns differ by exactly the placement
   change under test.

   Why this exists (owner, 2026-08-29): with FIRE/JUMP/eye off the glass in
   shark sim, the mount rail's DIVE/RISE pills were left floating at the aux
   rail's position — up and left of an empty corner ("THE RISE DIVE BUTTONS
   ARE VERY BADLY PLACED"). The fix parks them in the FIRE/JUMP corner spots
   as round thumb buttons (#tveh.tv-shark, systems/touch_vehicle.js auxCss).
   This preset is the picture of exactly that: the move pad, DIVE, RISE, and
   nothing else on the glass. */

const subjects = [
  {
    id: "the-glass",
    label: "The Whole Glass — Move Pad, DIVE, RISE",
    focus: "Everything a thumb gets in Shark Sim. Left: the move stick. Right: DIVE nearest the thumb in FIRE's old corner spot, RISE above it in JUMP's. No attack, no jump, no eye button — the bite is automatic and the view is a settings choice.",
  },
  {
    id: "dive-held",
    label: "DIVE Held — The Button Under The Thumb",
    focus: "The same corner with DIVE pressed (its .on state), mid-descent — proving the button is live where it stands, not just parked there.",
  },
];

async function stageTouchGlass(input) {
  const CBZ = window.CBZ, sub = input.subject;
  if (!CBZ || !window.THREE || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__sharkGlassBA;
  if (!D) {
    D = window.__sharkGlassBA = {
      booted: false,
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },
      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 60 && !D.armed(); t++) { D.step(15); await sleep(20); }
        if (!D.armed()) return false;
        // Past the opening banner, and enough ticks that touch.js (onAlways 98)
        // and touch_vehicle's context watcher (97) have laid the glass out.
        D.step(120);
        // Freeze the page's own frame loop; the comparator awaits the
        // __cbzVisualCompare.render hook below before every capture.
        D._rafOrig = window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => D._rafOrig.call(window, () => res()));
        // Same present-inside-one-real-frame + SwiftShader settle as the
        // shark-sim preset: with the loop dead, a render outside an animation
        // frame is never PRESENTED and every shot photographs the pre-kill
        // frame.
        window.__cbzVisualCompare = {
          async render() {
            if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
            if (!CBZ.renderer) return;
            await new Promise((res) => D._rafOrig.call(window, () => {
              CBZ.renderer.render(CBZ.scene, CBZ.camera);
              res();
            }));
            await new Promise((r) => setTimeout(r, 1200));
          },
        };
        D.booted = true;
        return true;
      },
    };
  }
  if (!D.booted && !(await D.boot())) return { ok: false, missing: "match" };

  if (sub.id === "dive-held") {
    // Hold DIVE through the same seams its touchstart drives, and step so the
    // .on state, the held key and the descent are all real.
    const b = document.getElementById("tvMDive");
    if (b) b.classList.add("on");
    if (CBZ.keys) CBZ.keys.control = true;
    for (let i = 0; i < 30; i++) {
      if (CBZ.cityAquaticMountVertical) CBZ.cityAquaticMountVertical(-1);
      CBZ.stepSim(1 / 30);
    }
  }

  // (the comparator awaits __cbzVisualCompare.render before capturing)

  // measure the claim: where the pills actually are, relative to the corner
  const m = {};
  const r = (id) => { const el = document.getElementById(id); return el && el.getClientRects().length ? el.getBoundingClientRect() : null; };
  const dive = r("tvMDive"), rise = r("tvMRise"), fire = r("tfire"), jump = r("tjump");
  m.diveRightGapPx = dive ? Math.round(innerWidth - dive.right) : -1;
  m.diveBottomGapPx = dive ? Math.round(innerHeight - dive.bottom) : -1;
  m.riseAboveDivePx = dive && rise ? Math.round(dive.top - rise.bottom) : -1;
  m.fireOnGlass = fire ? 1 : 0;
  m.jumpOnGlass = jump ? 1 : 0;

  if (sub.id === "dive-held") {
    const b = document.getElementById("tvMDive");
    if (b) b.classList.remove("on");
    if (CBZ.keys) CBZ.keys.control = false;
    if (CBZ.cityAquaticMountVertical) CBZ.cityAquaticMountVertical(0);
  }

  return {
    ok: true, side: input.side,
    debug: { state: CBZ.game.state, touch: document.body.classList.contains("touch") ? 1 : 0 },
    metrics: m,
  };
}

export default {
  id: "shark-touch-glass",
  title: "Shark Sim Touch Glass — DIVE/RISE In The Thumb Corner",
  description: "The Shark Sim touch controls on real device frames. BEFORE (HEAD): DIVE/RISE stranded at the vehicle aux rail's position, floating up-left of the empty corner FIRE and JUMP vacated. AFTER (worktree): the same two pills as round thumb buttons in FIRE's and JUMP's own corner spots.",
  beforeLabel: "BEFORE · HEAD (pills at the aux-rail position)",
  afterLabel: "AFTER · worktree (pills in the FIRE/JUMP corner)",
  pairNote: "Same seed · same match beat · the frame's own touch identity builds the glass",
  method: "Each side boots ?mode=sharksim on the device frame (the frame's touch identity is what makes the touch layers build), clicks the tile + PLAY like a player, waits for the mount to arm, steps four sim-seconds past the opening banner with the page's frame loop frozen, and photographs the full glass. Metrics read the pills' live getBoundingClientRect against the viewport corner.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 240000,
  metrics: {
    diveRightGapPx: { label: "DIVE right edge → screen edge", unit: "px", better: "lower" },
    diveBottomGapPx: { label: "DIVE bottom edge → screen edge", unit: "px", better: "lower" },
    riseAboveDivePx: { label: "RISE sits this far above DIVE", unit: "px" },
    fireOnGlass: { label: "FIRE button on the glass", better: "lower" },
    jumpOnGlass: { label: "JUMP button on the glass", better: "lower" },
  },
  viewport: { width: 960, height: 600 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  subjects,
  stage: stageTouchGlass,
};
