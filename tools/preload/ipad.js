/* tools/preload/ipad.js — make a headless Chrome look like an iPad.

   Use with probe.mjs's CBZ_PRELOAD hook, which runs this before any game
   script:

     CBZ_PRELOAD=tools/preload/ipad.js node tools/probe.mjs --isolated '<expr>'

   WHY IT HAS TO BE A PRELOAD. systems/touch.js builds the entire touch control
   layer from ONE line, at load:

       if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) enable();

   Nothing after boot can undo that decision — `enable()` is closed over inside
   the module's IIFE and is not exported. So on a desktop headless boot the
   touch layer never exists, and any probe that asks "is the RECENTER button
   gone?" gets `false` because NO button is there. That is a false negative
   dressed as a pass, and it is exactly the failure the ped-lineup tool was
   built to stop elsewhere: a confident photograph of an empty pavement.

   Chrome's own `--touch-events=enabled` does NOT flip `(pointer: coarse)` in
   headless (measured 2026-08-04), and CDP device emulation has to be installed
   before navigation anyway — which is what this hook is.

   WHAT IT FAKES, and nothing more: the three things this codebase actually
   feature-detects for touch. Media queries are DELEGATED to the real
   implementation for anything unrelated, so a preload cannot quietly change
   the answer to a question it was not meant to touch (dark mode, reduced
   motion, viewport width all still report the truth).

   THIS IS A TEST INSTRUMENT, NOT A DEVICE. It does not emulate iPad viewport
   size, DPR, GPU limits or real touch event dispatch — a layout or a
   performance question needs CDP Emulation, not this. What it buys is that
   touch-only code paths BUILD, so their DOM can be measured at all. */
(() => {
  const nativeMM = window.matchMedia && window.matchMedia.bind(window);

  // (pointer: coarse) / (any-pointer: coarse) → true; (hover: hover) → false,
  // because a tablet reports both together and code that checks hover to rule
  // touch OUT must see a consistent device, not a mouse with fat fingers.
  const FORCED = [
    [/\(\s*(any-)?pointer\s*:\s*coarse\s*\)/i, true],
    [/\(\s*(any-)?pointer\s*:\s*fine\s*\)/i, false],
    [/\(\s*(any-)?hover\s*:\s*hover\s*\)/i, false],
    [/\(\s*(any-)?hover\s*:\s*none\s*\)/i, true],
  ];

  window.matchMedia = function (q) {
    const query = String(q);
    for (const [re, val] of FORCED) {
      if (re.test(query)) {
        // A real MediaQueryList, with the listener surface anything may call.
        return {
          matches: val, media: query, onchange: null,
          addListener() {}, removeListener() {},
          addEventListener() {}, removeEventListener() {},
          dispatchEvent() { return false; },
        };
      }
    }
    return nativeMM ? nativeMM(query) : { matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
  };

  // The other two detections in this tree: a maxTouchPoints count and the
  // presence of ontouchstart on window.
  try { Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5, configurable: true }); } catch (e) {}
  if (!("ontouchstart" in window)) { try { window.ontouchstart = null; } catch (e) {} }

  window.__cbzFakeIpad = true;
})();
