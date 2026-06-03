/* ============================================================
   systems/input.js — keyboard state map
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const keys = {};

  addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (k === " ") e.preventDefault();
  });
  addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  CBZ.keys = keys;
})();
