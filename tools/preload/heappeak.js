/* tools/preload/heappeak.js — THE HEAP PEAK INSIDE THE BUILD (diagnostic preload).
   node tools/speed.mjs --device phone --preload tools/preload/heappeak.js --ask eval 'CBZ_PEAK()'
   The city build is one long task, so an in-page timer never samples it: a
   heap that climbs to 1.3 GB of garbage and is collected before the task ends
   reads as "peak = steady". This samples performance.memory (precise with
   speed.mjs's --enable-precise-memory-info) from INSIDE the task: on every
   256th typed-array construction and at every loading-meter step
   (CBZ.bootStep), and names the step each maximum happened in. */
(function () {
  "use strict";
  var P = { max: 0, maxStep: "", maxAt: 0, step: "(scripts)", steps: [], samples: 0 };
  var cur = { k: "(scripts)", t0: performance.now(), hi: 0, lo: Infinity };
  // the frames after the reveal: the heap every sample, and who was
  // allocating when a new maximum was reached (stack, from the typed-array hook)
  P.trail = []; P.stacks = [];
  function sample(withStack) {
    var m = performance.memory; if (!m) return;
    var u = m.usedJSHeapSize; P.samples++;
    if (u > cur.hi) cur.hi = u;
    if (u < cur.lo) cur.lo = u;
    if (cur.k === "(frames)" && P.trail.length < 400) P.trail.push([Math.round(performance.now() - cur.t0), Math.round(u / 1048576)]);
    if (u > P.max) {
      P.max = u; P.maxStep = cur.k; P.maxAt = performance.now();
      if (withStack && cur.k === "(frames)" && P.stacks.length < 40) {
        var st = (new Error().stack || "").split("\n").slice(3, 9).map(function (l) { var m2 = /\/(src\/[^?:)]+)(?:\?[^:)]*)?:(\d+)/.exec(l); return m2 ? m2[1].replace(/^src\//, "") + ":" + m2[2] : ""; }).filter(Boolean).join(" < ");
        P.stacks.push([Math.round(u / 1048576), Math.round(performance.now() - cur.t0), st]);
      }
    }
  }
  function stepTo(k) {
    sample();
    P.steps.push([cur.k, Math.round(performance.now() - cur.t0), +(cur.hi / 1048576).toFixed(0)]);
    cur = { k: k, t0: performance.now(), hi: 0, lo: Infinity };
    sample();
  }
  var C = window.CBZ = window.CBZ || {};
  // the FIRST function set is the game's own (systems/bootprogress.js): it is
  // wrapped once; later setters (speed.mjs wraps it too) are stored as given
  var held;
  Object.defineProperty(C, "bootStep", {
    configurable: true, enumerable: true,
    get: function () { return held; },
    set: function (f) {
      if (held === undefined && typeof f === "function") { var g = f; held = function (k) { stepTo(String(k)); return g.apply(this, arguments); }; }
      else held = f;
    },
  });
  var n = 0;
  ["Float32Array", "Uint32Array", "Uint16Array", "Int8Array", "Uint8Array", "Float64Array"].forEach(function (name) {
    var T = window[name];
    window[name] = new Proxy(T, { construct: function (t, args, nt) { if ((++n & 63) === 0) sample(true); return Reflect.construct(t, args, nt === window[name] ? t : nt); } });
  });
  setInterval(function () { if (cur.k !== "(frames)" && window.CBZ && CBZ.city && CBZ.city.arena && CBZ.city.arena.root && CBZ.city.arena.root.visible) stepTo("(frames)"); sample(); }, 50);
  window.CBZ_PEAK = function () {
    stepTo(cur.k);
    var top = P.steps.slice().sort(function (a, b) { return b[2] - a[2]; }).slice(0, 12);
    var m = performance.memory;
    return JSON.stringify({ peakMB: +(P.max / 1048576).toFixed(0), inStep: P.maxStep, nowMB: m ? +(m.usedJSHeapSize / 1048576).toFixed(0) : null, samples: P.samples, topSteps: top, trail: P.trail.filter(function (x, i) { return i % 4 === 0; }), stacks: P.stacks });
  };
})();
