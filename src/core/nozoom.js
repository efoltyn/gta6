/* core/nozoom.js — the page NEVER zooms on a phone or tablet.

   Owner, 2026-11-21: "when I double press screen on mobiles it zooms and
   messes whole screen up, prevent this entirely".

   iOS Safari ignores the viewport's user-scalable=no and maximum-scale, and
   touch-action:manipulation only covers elements that declare it, so a fast
   double tap on anything else (a HUD label, a card's padding, a pass-through
   overlay) still zooms. This guard closes every route, document-wide:
     - a second touchend within 350 ms is cancelled (that is the double-tap
       zoom). Cancelling it also cancels that tap's click, so a quick second
       tap on a button is re-fired as a click by hand: double taps on buttons
       still count twice, they just never zoom.
     - pinch (iOS gesture* events, and a two-finger touchmove) is cancelled.
     - dblclick is cancelled (desktop Safari / iPad trackpad smart zoom).
     - ctrl+wheel (trackpad pinch on a laptop) is cancelled.
   Text fields are left alone so typing, caret placement and selection work.
   Loaded first in <head> of every game page; no dependencies. */
(function () {
  "use strict";
  if (window.__noZoom) return;
  window.__noZoom = true;

  const opt = { passive: false, capture: true };
  function editable(t) {
    if (!t || t.nodeType !== 1) return false;
    const n = t.tagName;
    return n === "INPUT" || n === "TEXTAREA" || n === "SELECT" || t.isContentEditable;
  }
  function clickable(t) {
    return t && t.closest ? t.closest("button, a[href], label, [data-tfn], [data-tkey], [role=button], [onclick]") : null;
  }

  let lastEnd = 0;
  document.addEventListener("touchend", function (e) {
    const now = e.timeStamp || performance.now();
    const quick = now - lastEnd < 350;
    lastEnd = now;
    if (!quick || editable(e.target) || !e.cancelable) return;
    e.preventDefault();
    const c = clickable(e.target);
    if (c && !c.disabled) c.click();
  }, opt);

  document.addEventListener("touchmove", function (e) {
    if (e.touches && e.touches.length > 1 && e.cancelable && (e.scale === undefined || e.scale !== 1)) e.preventDefault();
  }, opt);

  ["gesturestart", "gesturechange", "gestureend"].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); }, opt);
  });

  document.addEventListener("dblclick", function (e) {
    if (!editable(e.target)) e.preventDefault();
  }, opt);

  window.addEventListener("wheel", function (e) {
    if (e.ctrlKey) e.preventDefault();
  }, opt);
})();
