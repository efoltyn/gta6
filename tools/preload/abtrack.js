/* tools/preload/abtrack.js — WHO HOLDS THE ARRAYBUFFERS (diagnostic preload).
   node tools/speed.mjs --device phone --world /tmp/abw.json --preload tools/preload/abtrack.js --ask eval 'CBZ_AB()'
   Every typed array / ArrayBuffer the page constructs with its OWN new buffer
   is attributed to the first two game-source stack frames (file:line) and
   followed to its death (FinalizationRegistry), so CBZ_AB() lists the LIVE
   bytes by allocation site. Arrays made inside the engine (three's clone via
   array.constructor, slice/map, ImageData) are not seen: the total it covers
   is printed beside Chrome's ArrayBuffers figure. */
(function () {
  "use strict";
  var sites = new Map(), live = 0, n = 0;
  var reg = new FinalizationRegistry(function (h) { var e = sites.get(h[0]); if (e) { e.b -= h[1]; e.n--; } live -= h[1]; });
  var MIN = 1024;
  function site() {
    var st = new Error().stack.split("\n"), out = [];
    for (var i = 3; i < st.length && out.length < 3; i++) {
      var m = /\/(src\/[^?:)]+|games\/[^?:)]+|[^/?:)]+\.html)(?:\?[^:)]*)?:(\d+)/.exec(st[i]);
      if (m && !/vendor\/|abtrack/.test(m[1])) out.push(m[1].replace(/^src\//, "") + ":" + m[2]);
      else if (m && /vendor\//.test(m[1]) && !out.length) out.push(m[1].replace(/^src\/vendor\//, "").replace(/\.min\.js|\.js/, ""));
    }
    return out.join(" < ") || "?";
  }
  function track(buf, arr) {
    var b = buf.byteLength; if (b < MIN) return;
    var k = site(), e = sites.get(k); if (!e) sites.set(k, e = { b: 0, n: 0, s: [] });
    if (e.s.length < 64) e.s.push(new WeakRef(arr || buf));
    e.b += b; e.n++; live += b; n++;
    reg.register(buf, [k, b]);
  }
  ["Float32Array", "Float64Array", "Uint32Array", "Int32Array", "Uint16Array", "Int16Array", "Uint8Array", "Int8Array", "Uint8ClampedArray"].forEach(function (name) {
    var T = window[name];
    window[name] = new Proxy(T, { construct: function (t, args, nt) {
      var r = Reflect.construct(t, args, nt === window[name] ? t : nt);
      if (!(args[0] instanceof ArrayBuffer) && !(typeof SharedArrayBuffer !== "undefined" && args[0] instanceof SharedArrayBuffer)) track(r.buffer, r);
      return r; } });
    // three clones with `new array.constructor(...)`, and slice/map go through
    // the species constructor: point both at the tracker
    try { Object.defineProperty(T.prototype, "constructor", { value: window[name], writable: true, configurable: true }); } catch (e) {}
  });
  var AB = ArrayBuffer;
  window.ArrayBuffer = new Proxy(AB, { construct: function (t, args, nt) { var r = Reflect.construct(t, args, nt === window.ArrayBuffer ? t : nt); track(r); return r; } });
  /* CBZ_AB_WHO('<site substring>'): a JS-reachability search from window for
     the live sample arrays of that site; prints the first property paths that
     hold one (closures are invisible to it: "not found" = held by a closure). */
  window.CBZ_AB_WHO = function (sub, maxNodes) {
    var want = new Map();
    sites.forEach(function (e, k) { if (k.indexOf(sub) >= 0) e.s.forEach(function (w) { var a = w.deref(); if (a) want.set(a, k); }); });
    if (!want.size) return "no live samples for " + sub;
    var seen = new Set(), q = [[window, "window"]], qh = 0, found = [], nodes = 0, lim = maxNodes || 4e6;
    seen.add(window);
    while (qh < q.length && nodes < lim && found.length < 12) {
      var it = q[qh]; q[qh++] = null; var o = it[0], p = it[1]; nodes++;
      var keys;
      if (o instanceof Map) { var i = 0; o.forEach(function (v, k) { push(v, p + ".get(" + (typeof k === "object" ? "#" + i : String(k).slice(0, 20)) + ")"); if (k && typeof k === "object") push(k, p + ".key#" + i); i++; }); continue; }
      if (o instanceof Set) { var j = 0; o.forEach(function (v) { push(v, p + ".set#" + (j++)); }); continue; }
      if (ArrayBuffer.isView(o)) continue;
      try { keys = Object.keys(o); } catch (e) { continue; }
      if (Array.isArray(o) && o.length > 0 && keys.length > 5000) { for (var a = 0; a < o.length; a++) push(o[a], p + "[" + a + "]"); continue; }
      for (var n = 0; n < keys.length; n++) { var v; try { v = o[keys[n]]; } catch (e) { continue; } push(v, p + "." + keys[n]); }
    }
    function push(v, path) {
      if (!v || (typeof v !== "object" && typeof v !== "function") || seen.has(v)) return;
      seen.add(v);
      if (want.has(v)) { found.push(path); return; }
      if (v instanceof Node || v instanceof Window) return;
      q.push([v, path]);
    }
    return JSON.stringify({ samples: want.size, nodes: nodes, found: found });
  };
  window.CBZ_AB_SAMPLES = function (sub) { var out = []; sites.forEach(function (e, k) { if (k.indexOf(sub) >= 0) e.s.forEach(function (w) { var a = w.deref(); if (a) out.push(a); }); }); return out; };
  window.CBZ_AB = function (top) {
    var rows = []; sites.forEach(function (e, k) { if (e.b > 0) rows.push([k, +(e.b / 1048576).toFixed(1), e.n]); });
    rows.sort(function (a, b) { return b[1] - a[1]; });
    return JSON.stringify({ liveMB: +(live / 1048576).toFixed(0), allocs: n, top: rows.slice(0, top || 60) });
  };
})();
