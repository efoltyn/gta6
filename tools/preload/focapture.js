/* tools/preload/focapture.js — record every real facade_openings call of a boot
   (FO.resolveCoplanar and FO.scan inputs, copied before the call mutates them)
   into window.__foCaps, for an old-vs-new equivalence check in the same page:
     node tools/speed.mjs --ask eval --eval-file tools/facade-equiv.js --preload tools/preload/focapture.js
   Wrapped once the page has parsed (the city builds after: CBZ.startRun). */
(function () {
  var caps = window.__foCaps = { resolve: [], scan: [], on: true };
  function wrap() {
    var FO = window.CBZ && window.CBZ.facadeOpenings;
    if (!FO || FO.__cap) return;
    FO.__cap = true;
    var r0 = FO.resolveCoplanar, s0 = FO.scan;
    FO.resolveCoplanar = function (recs, walls, tol) {
      if (caps.on) caps.resolve.push({ recs: recs.map(function (r) { return r.slice(0, 7); }), walls: walls ? walls.map(function (w) { return w.slice(0, 6); }) : null, tol: tol });
      return r0.apply(this, arguments);
    };
    FO.scan = function (recs, o) {
      if (caps.on) caps.scan.push({ recs: recs.map(function (r) { return r.slice(); }), o: Object.assign({}, o) });
      return s0.apply(this, arguments);
    };
  }
  document.addEventListener("DOMContentLoaded", wrap);
  addEventListener("load", wrap);
})();
