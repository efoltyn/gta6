/* tools/preload/textrack.js — WHO OWNS THE GPU TEXTURES (diagnostic preload).
   node tools/speed.mjs --device phone --preload tools/preload/textrack.js --ask eval 'CBZ_TEX()'
   (several preloads: --preload tools/preload/abtrack.js,tools/preload/textrack.js)
   Every live GL texture with its size as uploaded (level 0 + mips), format,
   and WHO PAINTED IT: a canvas source is named by the game frames that first
   asked it for a 2D context (the painter), a data source by the frames that
   built its typed array, anything else by the frames of the upload. Also the
   three.js Texture behind it (name, whether any object in the scene still
   uses it) and the same canvas uploaded twice. A texture whose owner is
   detached or parked still costs its GPU bytes: "inScene: false" lists them. */
(function () {
  "use strict";
  function site(skip) {
    var st = new Error().stack.split("\n"), out = [];
    for (var i = skip || 3; i < st.length && out.length < 3; i++) {
      var m = /\/(src\/[^?:)]+|games\/[^?:)]+|[^/?:)]+\.html)(?:\?[^:)]*)?:(\d+)/.exec(st[i]);
      if (m && !/vendor\/|textrack|abtrack/.test(m[1])) out.push(m[1].replace(/^src\//, "") + ":" + m[2]);
    }
    return out.join(" < ") || "?";
  }
  var SRC = new WeakMap();           // canvas / typed array -> painter site
  var LIVE = new Map();              // WebGLTexture -> record
  var CVS = [];                      // WeakRefs of every canvas given a 2D context
  var UP = new WeakSet();            // ArrayBuffers some bufferData call uploaded
  /* CBZ_GEO(top): every geometry reachable from CBZ.scene (hidden included),
     its CPU arrays split by: uploaded or not, the mesh drawing or not
     (visible chain), and grouped by the nearest named ancestor. Shared
     arrays are counted once. */
  window.CBZ_GEO = function (top) {
    var seen = new Set(), cat = {}, by = new Map();
    function chainVis(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }
    function nameOf(o) { var path = []; for (var p = o; p && path.length < 3; p = p.parent) if (p.name) path.push(p.name); return path.join("<") || o.type; }
    CBZ.scene.traverse(function (o) {
      var g = o.geometry; if (!g || !g.attributes) return;
      var bytes = 0, upl = 0;
      function one(a) { if (!a) return; var arr = a.isInterleavedBufferAttribute ? a.data.array : a.array; if (!arr || !arr.buffer || seen.has(arr.buffer)) return; seen.add(arr.buffer); bytes += arr.byteLength; if (UP.has(arr.buffer)) upl += arr.byteLength; }
      for (var k in g.attributes) one(g.attributes[k]);
      one(g.index);
      if (o.isInstancedMesh) { one(o.instanceMatrix); one(o.instanceColor); }
      if (!bytes) return;
      var vis = chainVis(o), k2 = (vis ? "drawing" : "hidden") + (upl ? (upl < bytes ? " part-uploaded" : " uploaded") : " never-uploaded");
      cat[k2] = (cat[k2] || 0) + bytes;
      var n = k2 + " | " + nameOf(o), e = by.get(n); if (!e) by.set(n, e = [0, 0]); e[0] += bytes; e[1]++;
    });
    var rows = []; by.forEach(function (e, k) { rows.push([+(e[0] / 1048576).toFixed(2), e[1], k]); });
    rows.sort(function (a, b) { return b[0] - a[0]; });
    for (var c in cat) cat[c] = +(cat[c] / 1048576).toFixed(1);
    return JSON.stringify({ categoriesMB: cat, top: rows.slice(0, top || 50) });
  };
  [window.HTMLCanvasElement, window.OffscreenCanvas].forEach(function (K) {
    if (!K) return; var g = K.prototype.getContext;
    K.prototype.getContext = function (type) { if (!SRC.has(this)) { SRC.set(this, site()); if (type === "2d" && window.WeakRef) CVS.push(new WeakRef(this)); } return g.apply(this, arguments); };
  });
  /* CBZ_CANVAS(top): the live 2D canvases (w*h*4 each, what speed.mjs's
     PHONE TOTAL adds), biggest first, by painter site; "uploaded" = some live
     GL texture was last filled from it (its pixels are on the GPU twice). */
  window.CBZ_CANVAS = function (top) {
    var up = new Set(); LIVE.forEach(function (r) { var s = r.src && r.src.deref ? r.src.deref() : null; if (s) up.add(s); });
    var rows = [], tot = 0, bySite = new Map(), keep = [];
    for (var i = 0; i < CVS.length; i++) { var c = CVS[i].deref(); if (!c) continue; keep.push(CVS[i]);
      var b = (c.width || 0) * (c.height || 0) * 4; if (!b) continue; tot += b;
      var k = SRC.get(c) || "?", e = bySite.get(k); if (!e) bySite.set(k, e = { b: 0, n: 0, up: 0, dims: c.width + "x" + c.height });
      e.b += b; e.n++; if (up.has(c)) e.up++; }
    CVS = keep;
    bySite.forEach(function (e, k) { rows.push([+(e.b / 1048576).toFixed(2), e.n, e.up, e.dims, k]); });
    rows.sort(function (a, b) { return b[0] - a[0]; });
    return JSON.stringify({ liveMB: +(tot / 1048576).toFixed(1), cols: "MB, count, uploaded, first dims, painter site", top: rows.slice(0, top || 40) });
  };
  var BPP = { 6408: 4, 6407: 4, 6410: 2, 6409: 1, 6406: 1, 6403: 1, 33319: 2, 32856: 4, 35907: 4, 33326: 4, 34836: 16, 34842: 8, 33325: 2, 33321: 1, 33323: 2, 36208: 16, 34843: 8 };
  var TYPEB = { 5126: 4, 36193: 2, 5131: 2 };
  [window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach(function (C) {
    if (!C) return; var p = C.prototype;
    var TB = { 3553: 32873, 32879: 32874, 35866: 35869, 34067: 34068 };
    function bound(gl, t) { return gl.getParameter((t >= 34069 && t <= 34074) ? 34068 : TB[t]); }
    var ti = p.texImage2D;
    p.texImage2D = function () {
      var a = arguments, r = ti.apply(this, a);
      try {
        var tex = bound(this, a[0]); if (!tex) return r;
        var w, h, src, fmt = a[2], type;
        if (a.length >= 8 && typeof a[5] === "number") { w = a[3]; h = a[4]; src = a[8]; type = a[7]; }
        else { src = a[5]; type = a[4]; w = src ? (src.naturalWidth || src.videoWidth || src.width || 0) : 0; h = src ? (src.naturalHeight || src.videoHeight || src.height || 0) : 0; }
        var rec = LIVE.get(tex);
        if (!rec) { rec = { lv: {}, mips: 0 }; LIVE.set(tex, rec); }
        var bpp = (BPP[fmt] || 4) * (fmt === 34836 || fmt === 34842 || fmt === 36208 || fmt === 34843 ? 1 : (TYPEB[type] || 1));
        rec.lv[a[0] + ":" + a[1]] = w * h * bpp;
        if (a[1] === 0) {
          rec.w = w; rec.h = h; rec.fmt = fmt; rec.type = type; rec.t = Math.round(performance.now());
          rec.src = src && typeof src === "object" ? (window.WeakRef ? new WeakRef(src) : null) : null;
          rec.kind = src ? (src.tagName || (ArrayBuffer.isView(src) ? src.constructor.name : src.constructor && src.constructor.name)) : "null";
          rec.site = (src && SRC.get(src)) || ("upload " + site());
        }
      } catch (e) {}
      return r;
    };
    // every array a buffer was filled from (CBZ_GEO: is a geometry's CPU copy also on the GPU?)
    var bd = p.bufferData;
    p.bufferData = function (t, d) { if (d && typeof d === "object" && d.buffer) UP.add(d.buffer); return bd.apply(this, arguments); };
    var gm = p.generateMipmap;
    p.generateMipmap = function (t) { var r = gm.apply(this, arguments); try { var rec = LIVE.get(bound(this, t)); if (rec) rec.mips = 1; } catch (e) {} return r; };
    var dt = p.deleteTexture;
    p.deleteTexture = function (t) { LIVE.delete(t); return dt.apply(this, arguments); };
  });
  // typed arrays: who built the data of a DataTexture
  ["Uint8Array", "Float32Array", "Uint16Array"].forEach(function (name) {
    var T = window[name];
    window[name] = new Proxy(T, { construct: function (t, args, nt) { var r = Reflect.construct(t, args, nt === window[name] ? t : nt); if (r.length >= 65536) SRC.set(r, site()); return r; } });
    try { Object.defineProperty(T.prototype, "constructor", { value: window[name], writable: true, configurable: true }); } catch (e) {}
  });
  /* CBZ_TEX(top): live GL textures, biggest first. inScene = a three Texture
     on some object's material in CBZ.scene (hidden included) has this source. */
  window.CBZ_TEX = function (top) {
    var inScene = new Map();
    try {
      CBZ.scene.traverse(function (o) {
        var ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (var i = 0; i < ms.length; i++) { var m = ms[i];
          for (var k in m) { var t = m[k]; if (t && t.isTexture && t.image) { inScene.set(t.image, (t.name || "") + "/" + (o.name || o.type)); if (t.image.data) inScene.set(t.image.data, (t.name || "") + "/" + (o.name || o.type)); } }
          if (m.uniforms) for (var u in m.uniforms) { var v = m.uniforms[u] && m.uniforms[u].value; if (v && v.isTexture && v.image) inScene.set(v.image, (v.name || "") + "/" + (o.name || o.type) + ".u:" + u); }
        }
      });
    } catch (e) {}
    var rows = [], tot = 0, dup = new Map();
    LIVE.forEach(function (r) {
      var b = 0; for (var k in r.lv) b += r.lv[k]; if (r.mips) b = Math.round(b * 4 / 3);
      tot += b;
      var s = r.src && r.src.deref ? r.src.deref() : null;
      var who = s ? (inScene.get(s) || "") : "";
      if (s) dup.set(s, (dup.get(s) || 0) + 1);
      rows.push([+(b / 1048576).toFixed(2), r.w + "x" + r.h, r.fmt, r.type, r.mips ? "mip" : "", r.kind, who ? "in scene: " + who : (s ? "NOT in scene" : "source gone"), r.site, r.t]);
    });
    rows.sort(function (a, b) { return b[0] - a[0]; });
    var twice = 0; dup.forEach(function (n) { if (n > 1) twice++; });
    return JSON.stringify({ liveMB: +(tot / 1048576).toFixed(1), n: LIVE.size, sourcesUploadedTwice: twice,
      cols: "MB, size, internal format, type, mips, source, owner, painter site, uploaded at ms", top: rows.slice(0, top || 40) });
  };
})();
