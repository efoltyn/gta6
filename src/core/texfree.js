/* ============================================================
   core/texfree.js — A PAINTED CANVAS IS KEPT ONCE, ON THE GPU.

   Every sign, ground skin, poster and label in this game is drawn into a 2D
   canvas and handed to three as a CanvasTexture. three uploads the canvas
   and keeps it (texture.image) for as long as the texture lives, so each
   one costs its pixels twice: the canvas backing store in the page and the
   texture on the GPU. Measured (memscope, phone profile): ~320 MB of texture
   SOURCES held after upload in Gang City, 4096x1024 ground skins among them.

   Once a canvas texture is on the GPU and has not been repainted for STABLE_S
   seconds, its canvas is shrunk to 1x1 (the backing store is released; the
   GPU copy is untouched, so the picture is identical). A canvas that is
   still being drawn into (a clock, a feed, a scoreboard: its texture's
   version keeps moving) is never touched, nor is one on the page (the DOM
   minimap, HUD), nor a small one (under 512x512: those are often re-read as sources).

   The cost is the same as for freed vertex arrays: a lost GL context cannot
   re-upload them, so systems/glcontext.js reloads at the player's position
   (CBZ.freedStaticArrays). A texture that is repainted AFTER its canvas was
   released would upload the 1x1; that is logged loudly (CBZ.texFreeAudit()).
   ?cfg_TEX_FREE=0 turns it off.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE || !THREE.CanvasTexture) return;
  const CFG = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (CFG.TEX_FREE == null) CFG.TEX_FREE = true;

  // only big canvases (1 MB+): small ones are often read again as SOURCES
  // (entities/pedinstance.js paints a ped's skin into its atlas page from them)
  const STABLE_S = 30, MIN_PX = 512 * 512, SWEEP_S = 3;
  const tracked = [];                 // WeakRef<CanvasTexture>
  const A = { tracked: 0, freed: 0, freedMB: 0, repaintedAfterFree: 0, names: [], lazyPainted: 0, lazyReleased: 0 };

  // every CanvasTexture made from here on is watched (a subclass: instanceof
  // THREE.CanvasTexture and the isCanvasTexture flag hold as before)
  const Orig = THREE.CanvasTexture;
  class Watched extends Orig {
    constructor(a, b, c, d, e, f, g, h, i) { super(a, b, c, d, e, f, g, h, i); tracked.push(new WeakRef(this)); A.tracked++; }
  }
  THREE.CanvasTexture = Watched;

  // a repaint after the canvas went: say so (the texture now uploads 1x1)
  const TP = THREE.Texture.prototype, desc = Object.getOwnPropertyDescriptor(TP, "needsUpdate");
  if (desc && desc.set) {
    Object.defineProperty(TP, "needsUpdate", {
      configurable: true,
      get: desc.get,
      set: function (v) {
        if (v === true && this._cbzFreed) {
          /* IT WAS LIVE AFTER ALL. The sweep's "not repainted for 30 s" read
             a canvas painted on EVENTS (the sky dome, which repaints only
             when the light moves: a still mid-morning on the title screen
             is minutes; a TV nobody is near; a board) as settled and shrank
             it, and this repaint just drew onto 1x1. Uploading that is the
             black sky (the whole dome one corner pixel). Instead: give the
             canvas its size back, never sweep it again, and SKIP this upload,
             so the GPU keeps the last good picture until the painter's next
             paint lands on a full-size canvas. */
          A.repaintedAfterFree++;
          const c = this.image;
          if (c && this._cbzW) { c.width = this._cbzW; c.height = this._cbzH; }
          this._cbzFreed = false; this._cbzKeep = true;
          if (typeof this._cbzRepaint === "function") { try { this._cbzRepaint(); } catch (e) {} }
          return;
        }
        desc.set.call(this, v);
      },
    });
  }

  function sweep() {
    if (CFG.TEX_FREE === false) return;
    const R = CBZ.renderer; if (!R || !R.properties) return;
    const now = performance.now() / 1000;
    let w = 0;
    for (let i = 0; i < tracked.length; i++) {
      const t = tracked[i].deref();
      if (!t || t._cbzFreed || t._cbzKeep) continue;   // gone, done, or live: drop the ref
      tracked[w++] = tracked[i];
      const c = t.image;
      if (!c || typeof c.getContext !== "function" || !(c.width * c.height >= MIN_PX)) continue;
      if (c.isConnected) continue;                  // on the page (HUD, minimap)
      const p = R.properties.get(t);
      if (!p || p.__version !== t.version) { t._cbzSeen = null; continue; }   // not uploaded, or stale
      if (t._cbzSeen == null || t._cbzSeenV !== t.version) { t._cbzSeen = now; t._cbzSeenV = t.version; continue; }
      if (now - t._cbzSeen < STABLE_S) continue;
      // shared canvases: every texture on it must be settled (a clone not yet
      // uploaded would upload the 1x1)
      if (c._cbzTexCount && c._cbzTexCount > 1) continue;
      const mb = c.width * c.height * 4 / 1048576;
      t._cbzW = c.width; t._cbzH = c.height;
      c.width = 1; c.height = 1;
      t._cbzFreed = true;
      A.freed++; A.freedMB += mb;
      if (A.names.length < 24) A.names.push((t.name || "canvas") + " " + mb.toFixed(1) + "MB");
      CBZ.freedStaticArrays = true;                 // a lost context comes back by reload
    }
    tracked.length = w;
  }
  // count textures per canvas at upload time (clone() shares the canvas)
  const OT = THREE.Texture.prototype.clone;
  THREE.Texture.prototype.clone = function () {
    // a lazy texture's clone is lazy too (Texture.copy reads .image, which
    // would PAINT the source and hand both the same, never-released canvas)
    if (this._cbzLazy && this._cbzLazyPaint && CBZ.lazyCanvasTexture) {
      const L = this._cbzLazyPaint, t = CBZ.lazyCanvasTexture(L.w, L.h, L.paint, L.opts);
      const src = this, keys = ["name", "mapping", "wrapS", "wrapT", "magFilter", "minFilter", "anisotropy", "format", "internalFormat", "type",
        "rotation", "matrixAutoUpdate", "generateMipmaps", "premultiplyAlpha", "flipY", "unpackAlignment", "encoding"];
      for (let i = 0; i < keys.length; i++) t[keys[i]] = src[keys[i]];
      t.offset.copy(src.offset); t.repeat.copy(src.repeat); t.center.copy(src.center); t.matrix.copy(src.matrix);
      t.needsUpdate = true;
      return t;
    }
    const t = OT.call(this);
    const c = this.image; if (c && typeof c.getContext === "function") c._cbzTexCount = (c._cbzTexCount || 1) + 1;
    return t;
  };
  setInterval(sweep, SWEEP_S * 1000);

  /* ---- PAINTED WHEN FIRST DRAWN, GIVEN BACK ONCE UPLOADED ------------------
     CBZ.lazyCanvasTexture(w, h, paint[, opts]) returns a CanvasTexture whose
     canvas does not exist until three first reads texture.image, which it
     does only to upload it: the first frame the texture is actually drawn.
     paint(ctx, canvas) runs then, synchronously, so the upload carries the
     full picture (nothing pops). After the upload the canvas is dropped
     again; if three ever needs the pixels back (a lost context, a re-upload)
     the same paint runs again. A sign on a shop across the continent, a paper
     on a desk in a closed room: no canvas at all until someone sees it.
     opts.keep: keep the canvas after upload (a texture read as a SOURCE by
     other code). The painter must be pure: same picture every call. */
  // a canvas handed back is shrunk at once: its backing store goes now, not
  // whenever the collector gets to the element (a canvas on the page is left)
  function giveBack(c) { if (c && !c.isConnected && c.width * c.height > 1) { c.width = 1; c.height = 1; } }
  CBZ.lazyCanvasTexture = function (w, h, paint, opts) {
    opts = opts || {};
    const t = new Orig(undefined);          // not Watched: this one frees itself
    let cv = null;
    Object.defineProperty(t, "image", {
      configurable: true, enumerable: true,
      get: function () {
        if (!cv) {
          cv = document.createElement("canvas"); cv.width = w; cv.height = h;
          try { paint(cv.getContext("2d"), cv); } catch (e) { console.error("[lazy canvas]", t.name || "", e); }
          A.lazyPainted++;
        }
        return cv;
      },
      set: function (v) { if (v && typeof v.getContext === "function") cv = v; },
    });
    t._cbzLazy = true; t._cbzLazyW = w; t._cbzLazyH = h;   // (sizes for censuses: reading .image paints)
    t._cbzLazyPaint = { w: w, h: h, paint: paint, opts: opts };   // (clone() makes another lazy one)
    // a reader that copied the pixels out (entities/pedinstance.js's atlas)
    // hands the canvas back; the next read paints it again
    t._cbzRelease = function () { if (cv) { giveBack(cv); cv = null; A.lazyReleased++; } };
    if (opts.name) t.name = opts.name;
    if (opts.eager) void t.image;             // painted now (an idle-time painter), still given back after use
    if (CFG.TEX_FREE !== false && !opts.keep) {
      t.onUpdate = function () { if (cv) giveBack(cv); cv = null; A.lazyReleased++; };
    }
    return t;                                 // (CanvasTexture's constructor flagged it for upload)
  };
  /* CBZ.liveCanvas(w, h): A LIVE BOARD (a tally, a roster, a video wall) whose
     canvas does not exist until somebody draws on it or the board is first
     drawn. The shape every board already used: { canvas, cc, tex, w, h,
     paint() } — canvas and cc are made on first read; paint() is the one
     needsUpdate writer. A board in a building nobody has walked into, never
     painted, costs no backing store at all (the situation room's 2048x512
     wall was 4 MB of blank canvas at the phone boot). A board drawn before it
     was ever painted uploads the same blank picture it always did. */
  /* rec.paintWith(fn): the board's painter instead of its pixels. fn draws
     the WHOLE board from the game's state through rec.cc (and may call
     rec.paint(), which is then a no-op). It runs when three uploads the board
     (the first frame it is drawn after a change), and the canvas goes back
     right after the upload; a later change records the painter again. A board
     whose building nobody is in holds no canvas, however often its facts
     change, and when it is drawn it shows the facts of that moment. */
  CBZ.liveCanvas = function (w, h) {
    let cv = null, cc = null, painter = null, inPaint = false, dirty = false, painted = false;
    const make = function () { if (!cv) { cv = document.createElement("canvas"); cv.width = w; cv.height = h; painted = false; } return cv; };
    const tex = new Orig(undefined);        // not Watched: a live board is never swept
    Object.defineProperty(tex, "image", {
      configurable: true, enumerable: true,
      get: function () {
        // (three reads .image several times per upload: paint once per change,
        // or again if the canvas was given back)
        if (painter && !inPaint && (dirty || !painted)) {
          dirty = false;
          make();
          inPaint = true;
          try { painter(); } catch (e) { console.error("[live canvas]", tex.name || "", e); }
          inPaint = false; painted = true;
          // after the upload the canvas goes; the painter stays for the next one
          if (CFG.TEX_FREE !== false) tex._cbzDropAfter = true;
        }
        return make();
      },
      set: function (v) { if (v && typeof v.getContext === "function") { cv = v; cc = null; } },
    });
    tex.onUpdate = function () { if (tex._cbzDropAfter) { tex._cbzDropAfter = false; if (cv) giveBack(cv); cv = null; cc = null; A.lazyReleased++; } };
    tex._cbzLazyW = w; tex._cbzLazyH = h;
    const rec = { tex: tex, w: w, h: h,
      paint: function () { if (!inPaint) tex.needsUpdate = true; return rec; },
      paintWith: function (fn) { painter = fn; dirty = true; tex.needsUpdate = true; return rec; } };
    Object.defineProperty(rec, "canvas", { enumerable: true, get: make });
    Object.defineProperty(rec, "cc", { enumerable: true, get: function () { return cc || (cc = make().getContext("2d")); } });
    return rec;
  };
  /* CBZ.lazyBaked(w, h, bake[, opts]): the same for a baker that makes its
     OWN canvas (or CanvasTexture) in one go. bake() runs at the first upload
     and its picture is copied into the lazy canvas (drawImage, scaled to w x h
     if the baker picked another size), then the baker's canvas is dropped.
     bake must be pure (seeded). */
  CBZ.lazyBaked = function (w, h, bake, opts) {
    return CBZ.lazyCanvasTexture(w, h, function (ctx) {
      const r = bake();
      const src = r && r.isTexture ? r.image : r;
      if (src && src.width) ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, w, h);
      if (r && r.isTexture) { if (src && src.getContext) { src.width = 1; src.height = 1; } r.dispose(); }
    }, opts);
  };
  /* A canvas texture painted once, in place, at build time (a painter that
     draws in many calls): give its canvas back right after the upload
     instead of 30 s later. It cannot be repainted (a lost context reloads,
     as for freed arrays). */
  CBZ.freeCanvasAfterUpload = function (t) {
    if (!t || CFG.TEX_FREE === false) return t;
    const prev = t.onUpdate;
    t.onUpdate = function (tex) {
      if (prev) prev.call(this, tex);
      const c = tex.image;
      if (!c || typeof c.getContext !== "function" || c.isConnected || tex._cbzFreed) return;
      if (c._cbzTexCount && c._cbzTexCount > 1) return;
      const mb = c.width * c.height * 4 / 1048576;
      tex._cbzW = c.width; tex._cbzH = c.height;
      c.width = 1; c.height = 1;
      tex._cbzFreed = true; A.freed++; A.freedMB += mb;
      CBZ.freedStaticArrays = true;
    };
    return t;
  };
  /* A canvas its owner repaints on events, at any interval (the sky): never
     swept. repaint (optional) is called if it was ever released anyway, so the
     owner can draw it again at once. */
  CBZ.texKeep = function (t, repaint) {
    if (!t) return t;
    t._cbzKeep = true;
    if (typeof repaint === "function") t._cbzRepaint = repaint;
    return t;
  };
  CBZ.texFreeAudit = function () { sweep(); return { tracked: tracked.length, created: A.tracked, freed: A.freed, freedMB: +A.freedMB.toFixed(1), lazyPainted: A.lazyPainted, lazyReleased: A.lazyReleased, repaintedAfterFree: A.repaintedAfterFree, sample: A.names.slice() }; };
})();
