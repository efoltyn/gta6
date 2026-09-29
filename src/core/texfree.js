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
        if (v === true && this._cbzFreed) { A.repaintedAfterFree++; if (A.repaintedAfterFree < 8) console.warn("[texfree] a released canvas was repainted:", this.name || "(unnamed)"); }
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
      if (!t || t._cbzFreed) continue;              // gone, or done: drop the ref
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
    t._cbzLazy = true;
    // a reader that copied the pixels out (entities/pedinstance.js's atlas)
    // hands the canvas back; the next read paints it again
    t._cbzRelease = function () { if (cv) { cv = null; A.lazyReleased++; } };
    if (opts.name) t.name = opts.name;
    if (opts.eager) void t.image;             // painted now (an idle-time painter), still given back after use
    if (CFG.TEX_FREE !== false && !opts.keep) {
      t.onUpdate = function () { cv = null; A.lazyReleased++; };
    }
    return t;                                 // (CanvasTexture's constructor flagged it for upload)
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
      c.width = 1; c.height = 1;
      tex._cbzFreed = true; A.freed++; A.freedMB += mb;
      CBZ.freedStaticArrays = true;
    };
    return t;
  };
  CBZ.texFreeAudit = function () { sweep(); return { tracked: tracked.length, created: A.tracked, freed: A.freed, freedMB: +A.freedMB.toFixed(1), lazyPainted: A.lazyPainted, lazyReleased: A.lazyReleased, repaintedAfterFree: A.repaintedAfterFree, sample: A.names.slice() }; };
})();
