/* ============================================================
   systems/input.js — keyboard state map, and THE ONE ANSWER to
   "is there a physical keyboard?"

   HAS A KEYBOARD: <html class="kbd">. CSS keys every keyboard-only hint off
   that class (the hotbar's slot digits, css/inventory.css), JS reads
   CBZ.hasKeyboard(). It is on when:
     · the primary pointer is a mouse/trackpad that hovers
       (hover:hover and pointer:fine) — a desktop, a laptop;
     · or the first REAL key arrives: a trusted keydown that did not come
       from typing into a field (an iPad's on-screen keyboard only opens
       over a field; Android's soft keys report "Unidentified"/229).
       That is how an iPad with a keyboard case gets its hints.
   A phone or tablet with only a finger never sees it.

   DIGITS: CBZ.digitKey(e) -> 1..9 for the top row or the numpad, else 0.
   It reads e.code (Digit1..Digit9 / Numpad1..Numpad9), the physical key, so
   Shift+1 ("!") on a Mac, AZERTY ("&") and every other layout still mean 1.
   Cmd/Ctrl+digit belongs to the browser (tab switching) and reads as 0.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const keys = {};

  /* ---------------- physical keyboard ---------------- */
  const root = document.documentElement;
  let hasKbd = false, keySeen = false;
  function setKbd(on) {
    if (on === hasKbd) return;
    hasKbd = on;
    if (root && root.classList) root.classList.toggle("kbd", on);
  }
  let mq = null;
  try { mq = window.matchMedia ? window.matchMedia("(hover: hover) and (pointer: fine)") : null; } catch (e) { mq = null; }
  if (mq && mq.matches) setKbd(true);
  if (mq) {
    const onChange = function () { setKbd(keySeen || mq.matches); };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
  function editable(t) {
    return !!(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable));
  }
  function realKey(e) {
    if (!e.isTrusted || editable(e.target)) return false;
    if (e.keyCode === 229 || e.key === "Unidentified" || e.key === "Process") return false;
    return true;
  }
  CBZ.hasKeyboard = function () { return hasKbd; };

  /* ---------------- digits ---------------- */
  const DIGIT_RE = /^(?:Digit|Numpad)([1-9])$/;
  CBZ.digitKey = function (e) {
    if (!e || e.metaKey || e.ctrlKey) return 0;
    const m = DIGIT_RE.exec(e.code || "");
    if (m) return +m[1];
    // no code (synthetic events, very old engines): fall back to the character
    const k = e.key;
    return typeof k === "string" && k.length === 1 && k >= "1" && k <= "9" ? +k : 0;
  };

  /* ---------------- key state map ---------------- */
  addEventListener("keydown", (e) => {
    if (!keySeen && realKey(e)) { keySeen = true; setKbd(true); }
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (k === " ") e.preventDefault();
  });
  addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  CBZ.keys = keys;
})();
