/* tools/preload/cvtrack.js — WHO HOLDS THE 2D CANVASES (diagnostic preload).
   node tools/speed.mjs --device phone --preload tools/preload/cvtrack.js --ask eval 'CBZ_CV()'
   Every <canvas> the page creates is attributed to the first game-source stack
   frames that made it. CBZ_CV() lists the live canvas pixels (w*h*4) by site,
   split into: drawn by a texture in the scene / uploaded / neither. */
(function () {
  "use strict";
  var list = [];
  var orig = Document.prototype.createElement;
  function site() {
    var st = new Error().stack.split("\n"), out = [];
    for (var i = 2; i < st.length && out.length < 3; i++) {
      var m = /\/(src\/[^?:)]+)(?:\?[^:)]*)?:(\d+)/.exec(st[i]);
      if (m && !/vendor\//.test(m[1])) out.push(m[1].replace(/^src\//, "") + ":" + m[2]);
    }
    return out.join(" < ") || "?";
  }
  Document.prototype.createElement = function (tag) {
    var el = orig.apply(this, arguments);
    if (typeof tag === "string" && tag.toLowerCase() === "canvas") list.push({ w: new WeakRef(el), k: site() });
    return el;
  };
  window.CBZ_CV = function (top) {
    var C = window.CBZ, R = C && C.renderer, inScene = new Map();
    if (C && C.scene) C.scene.traverse(function (o) {
      var ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      ms.forEach(function (m) {
        if (!m) return;
        for (var k in m) { var t = m[k]; if (t && t.isTexture && t.image) inScene.set(t.image, t); }
        if (m.uniforms) for (var u in m.uniforms) { var v = m.uniforms[u] && m.uniforms[u].value; if (v && v.isTexture && v.image) inScene.set(v.image, v); }
      });
    });
    var by = {}, tot = { scene: 0, up: 0, dom: 0, other: 0 };
    list.forEach(function (e) {
      var c = e.w.deref(); if (!c) return;
      var mb = c.width * c.height * 4 / 1048576; if (mb < 0.05) return;
      var t = inScene.get(c), cls;
      if (c.isConnected) cls = "dom";
      else if (t) { var p = R && R.properties.get(t); cls = p && p.__version === t.version ? "up" : "scene"; }
      else cls = "other";
      tot[cls] += mb;
      var key = cls + " " + e.k;
      var r = by[key] || (by[key] = { mb: 0, n: 0, big: 0 });
      r.mb += mb; r.n++; if (c.width * c.height > r.big) r.big = c.width * c.height;
    });
    var rows = Object.keys(by).map(function (k) { return [k, +by[k].mb.toFixed(1), by[k].n, Math.round(Math.sqrt(by[k].big))]; }).sort(function (a, b) { return b[1] - a[1]; });
    Object.keys(tot).forEach(function (k) { tot[k] = +tot[k].toFixed(0); });
    return JSON.stringify({ totMB: tot, top: rows.slice(0, top || 40) });
  };
})();
