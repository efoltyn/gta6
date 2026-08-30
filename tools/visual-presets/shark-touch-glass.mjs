/* Shark Sim's TOUCH GLASS — where the thumb controls actually sit.

   One subject, captured on phone/tablet device frames (--devices; the frame's
   identity is what makes body.touch exist at all). The interesting run is
   HEAD-vs-worktree: serve a detached HEAD worktree with tools/devserver.py and
   pass it as --before, so the two columns differ by exactly the placement
   change under test.

   Why this exists (owner, 2026-08-29): with FIRE/JUMP/eye off the glass in
   shark sim, the mount rail's DIVE/RISE pills were left floating at the aux
   rail's position — up and left of an empty corner ("THE RISE DIVE BUTTONS
   ARE VERY BADLY PLACED"). The fix parked them in the FIRE/JUMP corner spots
   as round thumb buttons (#tveh.tv-shark, systems/touch_vehicle.js auxCss).

   2026-08-30, the same corner again: "bring back the attack button from nat
   disaster into shark sim, put it UNDER dive and rise, where it is on nat
   disaster already … change dive/rise to <> but vertical … make them bigger,
   better UX on touch." So the corner is now a COLUMN OF THREE — ∧ RISE, ∨
   DIVE, ⊕ ATTACK — and this preset's job changed with it: it has to show
   that the trigger came back to its own spot, that the chevrons stack ABOVE
   it instead of in its lap, and that every target got fatter. The metrics
   below are that claim, stated as numbers a run can fail. */

const subjects = [
  {
    id: "the-glass",
    label: "The Whole Glass — Move Pad + The Three-Button Column",
    focus: "Everything a thumb gets in Shark Sim. Left: the move stick. Right: ATTACK in the corner it holds in nat disaster, ∨ DIVE stacked on it, ∧ RISE on top. BEFORE: no trigger at all, and the two verbs were WORDS sitting in the trigger's empty spot.",
  },
  {
    id: "dive-held",
    label: "DIVE Held — The Button Under The Thumb",
    focus: "The same column with DIVE pressed (its .on state), mid-descent — proving the button is live where it stands, not just parked there, and that the press still reads through the new cold-water tint.",
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

  /* THE HELD STATE HAS TO SURVIVE THE SHUTTER. This used to stage the hold,
     measure, and then RELEASE it — all inside stage() — while the comparator
     awaits __cbzVisualCompare.render() and photographs the page AFTER stage()
     returns. So the "DIVE Held" plate has never once shown a held button: it
     was torn down a few lines before the photo was taken, and both columns
     quietly published a picture of an idle control under a caption promising
     a pressed one.

     The release moves to the TOP of the run instead. Every subject shares one
     booted page (D.booted), so the state that must not leak is the PREVIOUS
     subject's, and clearing on entry kills it without ever touching the frame
     that is about to be captured. Subject order stops mattering too. */
  const diveBtn = document.getElementById("tvMDive");
  if (diveBtn) { diveBtn.classList.remove("on"); diveBtn.style.transition = ""; }
  if (CBZ.keys) CBZ.keys.control = false;
  if (CBZ.cityAquaticMountVertical) CBZ.cityAquaticMountVertical(0);

  if (sub.id === "dive-held") {
    // Hold DIVE through the same seams its touchstart drives, and step so the
    // .on state, the held key and the descent are all real — then LEAVE it
    // held, because that is the whole subject.
    /* .tvbtn carries `transition: transform .06s, background .1s`, and a
       CSS transition only advances when the page produces a FRAME — which
       this one has stopped doing, because the capture needs a frozen loop.
       So the class lands and the transition parks on its FROM value forever:
       identity transform, resting fill. Waiting does not help (measured: 250
       ms of real time, still matrix(1,0,0,1,0,0)); nothing is going to tick
       it. Suppressing the transition for this one element resolves
       `.tvbtn.on` straight to its end state, which is what a STILL of a held
       button should show anyway — a photograph has no 60 ms to spend. The
       forced reflow is what makes that resolution happen before the read
       below. Cleared again on the next subject's entry, above. */
    if (diveBtn) {
      diveBtn.style.transition = "none";
      diveBtn.classList.add("on");
      void diveBtn.offsetWidth;
    }
    if (CBZ.keys) CBZ.keys.control = true;
    for (let i = 0; i < 30; i++) {
      if (CBZ.cityAquaticMountVertical) CBZ.cityAquaticMountVertical(-1);
      CBZ.stepSim(1 / 30);
    }
  }

  // (the comparator awaits __cbzVisualCompare.render before capturing)

  /* MEASURE THE CLAIM. Every number here is one sentence of the owner's ask
     turned into something a run can fail:
       "attack button back"      → attackOnGlass
       "where it is on nat disaster" → attackRight/BottomGapPx (its own corner)
       "put it UNDER dive and rise"  → diveAboveAttackPx > 0, and overlapPx 0
       "bigger, better UX on touch"  → minTargetPx
       one tidy column               → columnDriftPx (centres, worst case)   */
  const m = {};
  const r = (id) => { const el = document.getElementById(id); return el && el.getClientRects().length ? el.getBoundingClientRect() : null; };
  const dive = r("tvMDive"), rise = r("tvMRise"), fire = r("tfire"), jump = r("tjump");
  m.attackOnGlass = fire ? 1 : 0;
  m.attackRightGapPx = fire ? Math.round(innerWidth - fire.right) : -1;
  m.attackBottomGapPx = fire ? Math.round(innerHeight - fire.bottom) : -1;
  // Positive = DIVE clears the trigger. BEFORE this is NEGATIVE-or-absent,
  // because there was no trigger under it to clear.
  m.diveAboveAttackPx = dive && fire ? Math.round(fire.top - dive.bottom) : -1;
  m.riseAboveDivePx = dive && rise ? Math.round(dive.top - rise.bottom) : -1;
  // Overlapping area between DIVE and the trigger, in px². The whole point of
  // lifting the rail: two buttons in one hole is the bug, and 0 is the pass.
  const ov = (a, b) => (a && b)
    ? Math.round(Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
                 Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)))
    : 0;
  m.diveAttackOverlapPx2 = ov(dive, fire);
  // The smallest tap target in the column — "bigger, better UX" as a number.
  // A missing button scores 0, which is the honest reading: you cannot tap it.
  const side = (el) => (el ? Math.min(el.width, el.height) : 0);
  m.minTargetPx = Math.round(Math.min(side(dive), side(rise), side(fire)));
  // Worst horizontal centre offset across the three roundels. Equal sizes in a
  // right-anchored column make this 0; the old mixed 84/72 pair could not.
  const cx = (el) => (el ? (el.left + el.right) / 2 : null);
  const cs = [cx(dive), cx(rise), cx(fire)].filter((v) => v !== null);
  m.columnDriftPx = cs.length > 1 ? Math.round(Math.max(...cs) - Math.min(...cs)) : -1;
  m.jumpOnGlass = jump ? 1 : 0;
  /* IS THE PRESSED STATE ACTUALLY PAINTED AT SHUTTER TIME? The whole reason
     the release moved to the top of this file. `.tvbtn.on` pushes the button
     down 4px, so reading the live transform is a number that can only be
     non-zero if the held style really is on the element the camera sees — and
     it is read HERE, a few lines before the capture, not from a class name
     somebody set two hundred lines earlier. 0 on the-glass, 4 on dive-held. */
  const diveEl = document.getElementById("tvMDive");
  let press = 0;
  if (diveEl) {
    const mtx = getComputedStyle(diveEl).transform;
    const parts = /matrix\(([^)]+)\)/.exec(mtx);
    if (parts) press = Math.round(parseFloat(parts[1].split(",")[5]) || 0);
  }
  m.divePressPx = press;

  // NOTE: no teardown here on purpose — see the release-on-entry block above.
  // Anything undone at this point is undone before the photograph.

  return {
    ok: true, side: input.side,
    debug: {
      state: CBZ.game.state,
      touch: document.body.classList.contains("touch") ? 1 : 0,
      // body.tshark is the class the whole three-button geometry hangs off
      // (mobile.css publishes --shark-btn/--shark-gap on it); 0 in the BEFORE
      // column is the single fact that explains every other number moving.
      tshark: document.body.classList.contains("tshark") ? 1 : 0,
      diveFill: diveEl ? getComputedStyle(diveEl).backgroundColor : "(absent)",
    },
    metrics: m,
  };
}

export default {
  id: "shark-touch-glass",
  title: "Shark Sim Touch Glass — ATTACK Back, ∧/∨ Stacked On Top",
  description: "The Shark Sim touch controls on real device frames. BEFORE (HEAD): no trigger at all, and two WORDED pills — DIVE 84px, RISE 72px — sitting in the corner spot the trigger used to hold. AFTER (worktree): nat disaster's own ATTACK button back in that corner, with ∨ DIVE and ∧ RISE stacked above it as equal 92px roundels — one column, three fat targets, no words.",
  beforeLabel: "BEFORE · HEAD (no trigger; worded DIVE/RISE in its spot)",
  afterLabel: "AFTER · worktree (∧ / ∨ / ATTACK — one column of three)",
  pairNote: "Same seed · same match beat · the frame's own touch identity builds the glass",
  method: "Each side boots ?mode=sharksim on the device frame (the frame's touch identity is what makes the touch layers build), clicks the tile + PLAY like a player, waits for the mount to arm, steps four sim-seconds past the opening banner with the page's frame loop frozen, and photographs the full glass. Metrics read the pills' live getBoundingClientRect against the viewport corner.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 240000,
  metrics: {
    attackOnGlass: { label: "ATTACK button on the glass", better: "higher" },
    attackRightGapPx: { label: "ATTACK right edge → screen edge", unit: "px" },
    attackBottomGapPx: { label: "ATTACK bottom edge → screen edge", unit: "px" },
    diveAboveAttackPx: { label: "DIVE clears ATTACK by", unit: "px", better: "higher" },
    diveAttackOverlapPx2: { label: "DIVE / ATTACK overlap", unit: "px²", better: "lower" },
    riseAboveDivePx: { label: "RISE sits this far above DIVE", unit: "px" },
    minTargetPx: { label: "smallest tap target in the column", unit: "px", better: "higher" },
    columnDriftPx: { label: "worst centre drift across the three", unit: "px", better: "lower" },
    jumpOnGlass: { label: "JUMP button on the glass", better: "lower" },
    divePressPx: { label: "DIVE pressed-state push at shutter (dive-held only)", unit: "px" },
  },
  viewport: { width: 960, height: 600 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  subjects,
  stage: stageTouchGlass,
};
