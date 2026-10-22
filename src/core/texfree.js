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
    constructor(a, b, c, d, e, f, g, h, i) { super(a, b, c, d, e, f, g, h, i); tracked.push(new WeakRef(this)); A.tracked++; this._cbzOwner = CBZ._texOwner || null; }
  }
  THREE.CanvasTexture = Watched;

  /* ---- WHO MADE IT: a texture knows the streamed job it was born in ------
     core/citystream.js sets CBZ._texOwner while a job builds. When that job
     is FREED, what it made is its own to give back, even when the picture
     cannot come back (a canvas released above, a data texture whose bytes
     its owner packed away): the job's next run paints new ones. Without
     this the streamer left every such texture on the GPU: a 4096 airfield
     ground (42 MB) and two town splats per round trip past Cape Harbor. */
  const OrigData = THREE.DataTexture;
  if (OrigData) {
    class OwnedData extends OrigData {
      constructor(a, b, c, d, e, f, g, h, i, j, k) { super(a, b, c, d, e, f, g, h, i, j, k); this._cbzOwner = CBZ._texOwner || null; }
    }
    THREE.DataTexture = OwnedData;
  }
  /* CBZ.texDisposable(t, opts): may a teardown dispose t? THE one rule for
     both teardowns (core/citystream.js freeJob, world/disaster_arena.js
     freeObjectsSteps). A texture three can upload again from what it holds
     (a self-painting canvas, an intact canvas, a data texture with its
     bytes, a loaded image) may always go: the next draw brings it back.
     One that cannot come back (a canvas released above, a data texture
     whose bytes were packed away) goes only when the teardown OWNS it:
     opts.owner is the job being freed and the texture was born in it
     (opts.dataGone: an island root owns every data texture under it).
     A render target's texture (the environment map, a feed) has nothing to
     upload: disposing one made every later render throw (8540e9bc).
     opts.shared: a _shared one that can come back may go too (the streamer
     takes a far job's shared canvases off the GPU; they upload again). */
  function reuploadable(t) {
    if (t._cbzLazy) return true;
    const im = t.image;
    if (!im) return false;
    if (t.isCanvasTexture) return typeof im.getContext === "function" && im.width > 1 && !t._cbzFreed;
    if (im.data) return true;
    return (typeof HTMLImageElement !== "undefined" && im instanceof HTMLImageElement && im.complete) ||
           (typeof ImageBitmap !== "undefined" && im instanceof ImageBitmap);
  }
  CBZ.texDisposable = function (t, opts) {
    if (!t || !t.isTexture) return false;
    if (reuploadable(t)) return !t._shared || !!(opts && opts.shared);
    if (t._shared || !opts) return false;
    if (opts.owner && t._cbzOwner === opts.owner) return true;
    return !!(opts.dataGone && t.isDataTexture && t.image && "data" in t.image);
  };
  // ... and the dispose itself (a self-painting canvas also hands its canvas back)
  CBZ.texDispose = function (t) {
    t.dispose();
    if (t._cbzLazy && t._cbzRelease) t._cbzRelease();
  };

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
    t._cbzOwner = CBZ._texOwner || null;
    let cv = null, job = null;
    /* A PAINTER MAY BE A GENERATOR (yield between its passes): read .image
       and it runs to the end, as always; t._cbzPaintSteps() is the same
       painting a pass at a time, for an upload that is sliced (core/fxwarm.js
       uploadSteps paints an arriving island's canvases in its slices instead
       of in one uncut call). Either way the picture is the same one. */
    /* A SMALL ONE PAINTS ON THE CPU (willReadFrequently). Its painter may
       read back what it drew (city/clothes.js shades the shell under a cover
       off its own pixels) and entities/pedinstance.js copies it into a ped
       page: on a canvas the browser draws on the GPU each read is a full GPU
       pipeline flush, measured 0.15-0.6 s for one read while an island
       uploads (4x-throttled). A garment atlas (128 x 256) or smaller paints on
       the CPU in a millisecond or two and uploads from memory; a bigger sheet
       (a 320 x 160 ink chart of thousands of strokes: 0.6 s of CPU raster)
       stays on the GPU, where entities/pedinstance.js copies it GPU to GPU. */
    const cpu = w * h <= 32768;
    const begin = function () {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      let r = null;
      try { r = paint(cpu ? c.getContext("2d", { willReadFrequently: true }) : c.getContext("2d"), c); } catch (e) { console.error("[lazy canvas]", t.name || "", e); }
      job = { c: c, it: r && typeof r.next === "function" ? r : null };
    };
    const end = function () { cv = job.c; job = null; A.lazyPainted++; };
    Object.defineProperty(t, "image", {
      configurable: true, enumerable: true,
      get: function () {
        if (!cv) {
          if (!job) begin();
          if (job.it) { try { while (!job.it.next().done) {} } catch (e) { console.error("[lazy canvas]", t.name || "", e); } }
          end();
        }
        return cv;
      },
      set: function (v) { if (v && typeof v.getContext === "function") cv = v; },
    });
    t._cbzPaintSteps = function* () {
      if (cv) return;
      if (!job) { begin(); yield 0; }
      while (job && job.it) {
        let s;
        try { s = job.it.next(); } catch (e) { console.error("[lazy canvas]", t.name || "", e); break; }
        if (s.done) break;
        yield 0;
      }
      if (job) end();
    };
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
    // (a baker may hand back a generator whose return value is its picture:
    // a sliced upload then bakes it a pass at a time)
    return CBZ.lazyCanvasTexture(w, h, function* (ctx) {
      let r = bake();
      if (r && typeof r.next === "function") { let s = r.next(); while (!s.done) { yield 0; s = r.next(); } r = s.value; }
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
  /* ---- A PERSON'S LOOK IS ON THE GPU WHILE SOMEBODY WEARS IT -------------
     city/clothes.js paints one atlas per outfit key and entities/tattoo.js one
     chart per piece of ink; every wearer of a key shares the one texture. They
     used to stay on the GPU for the whole session once drawn: every island
     round trip, every new street, left 4-5 more behind (the Isles leak check
     counted them). Now each look is a RECORD here: the rigs wearing it (weak
     refs, so a dropped rig is no holder), its textures, and when it was last
     worn. A look nobody in the scene wears is kept while the unworn ones fit
     a budget (MB; a phone's is smaller), least recently worn out first, and
     never longer than IDLE_S. Out = its GPU copy goes (the texture's own
     dispose, so three and the ped pages let go of it); the texture object,
     its material and every number read off it stay, and the next draw
     uploads it again, painted again from its key (both painters are pure).
       CBZ.lookTex.track(key, [tex...])  the textures of a look (replaces)
       CBZ.lookTex.wear(ch, slot, key)   rig ch wears key in slot (null = off)
       CBZ.lookTex.audit()               what is resident, worn, gone */
  CBZ.lookTex = (function () {
    const BUDGET_MB = { phone: 3, tablet: 6, desktop: 16 };
    const IDLE_S = 90, LOOK_SWEEP_S = 4;
    const recs = new Map();
    const L = { evicted: 0, evictedMB: 0, revived: 0 };
    const okWR = typeof WeakRef === "function";
    const clock = function () { return performance.now() / 1000; };
    function rec(key) {
      let r = recs.get(key);
      if (!r) { r = { key: key, texs: [], wear: new Set(), last: clock(), mb: 0, out: false }; recs.set(key, r); }
      return r;
    }
    function bytesOf(t) {
      const w = t._cbzLazyW || (t.image && t.image.width) || 0, h = t._cbzLazyH || (t.image && t.image.height) || 0;
      const mip = t.generateMipmaps !== false && t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter;
      return w * h * 4 * (mip ? 4 / 3 : 1) / 1048576;
    }
    function resident(t) {
      const R = CBZ.renderer, p = R && R.properties ? R.properties.get(t) : null;
      return !!(p && p.__webglInit);
    }
    function track(key, list) {
      if (!key) return;
      const r = rec(key);
      r.texs = [];
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (!t || !t.isTexture) continue;
        r.texs.push(t);
        if (t._cbzLookRec) { t._cbzLookRec = r; continue; }
        t._cbzLookRec = r;
        // an upload after the look was put away: somebody draws it that no
        // wear() named (a preview, a corpse clone); count it as worn now
        const prev = t.onUpdate;
        t.onUpdate = function () {
          const rr = t._cbzLookRec;
          if (rr && rr.out) { rr.out = false; rr.last = clock(); L.revived++; }
          if (prev) return prev.apply(this, arguments);
        };
      }
    }
    function wearing(ch, key) {
      const W = ch._lookWear;
      if (!W) return false;
      for (const s in W) if (W[s] === key) return true;
      return false;
    }
    function wear(ch, slot, key) {
      if (!ch || !okWR) return;
      const W = ch._lookWear || (ch._lookWear = {});
      const old = W[slot];
      if (old === key || (old == null && key == null)) return;
      const wr = ch._lookWR || (ch._lookWR = new WeakRef(ch));
      W[slot] = key || null;
      if (old != null && !wearing(ch, old)) { const r = recs.get(old); if (r) r.wear.delete(wr); }
      if (key != null) { const r = rec(key); r.wear.add(wr); r.last = clock(); }
    }
    // in the scene: a parked or dropped rig wears nothing anyone can see
    function attached(ch) {
      const S = CBZ.scene;
      let o = ch.group;
      for (let i = 0; o && i < 64; i++) { if (o === S) return true; o = o.parent; }
      return false;
    }
    function putAway(r) {
      for (let i = 0; i < r.texs.length; i++) {
        const t = r.texs[i];
        if (!resident(t)) continue;
        L.evictedMB += bytesOf(t);
        // the PROTOTYPE's dispose: the owners' own dispose() marks a texture
        // dead (their caches rebuild a dead look); this one only lets the GPU
        // copy go
        THREE.Texture.prototype.dispose.call(t);
      }
      r.out = true;
      L.evicted++;
    }
    function budget() { return BUDGET_MB[CBZ.deviceClass] || BUDGET_MB.desktop; }
    function sweepLooks() {
      if (!okWR || !CBZ.renderer || !CBZ.scene) return;
      const now = clock(), idle = [];
      let idleMB = 0;
      recs.forEach(function (r) {
        let held = 0;
        r.wear.forEach(function (wr) {
          const ch = wr.deref();
          if (!ch || !wearing(ch, r.key)) { r.wear.delete(wr); return; }
          if (attached(ch)) held++;
        });
        if (held) { r.last = now; return; }
        let mb = 0;
        for (let i = 0; i < r.texs.length; i++) if (resident(r.texs[i])) mb += bytesOf(r.texs[i]);
        r.mb = mb;
        if (mb > 0) { idle.push(r); idleMB += mb; }
        else if (!r.wear.size && !r.texs.length) recs.delete(r.key);
      });
      idle.sort(function (a, b) { return a.last - b.last; });
      const B = budget();
      for (let i = 0; i < idle.length; i++) {
        const r = idle[i];
        if (idleMB <= B && now - r.last < IDLE_S) break;
        putAway(r);
        idleMB -= r.mb;
      }
    }
    setInterval(sweepLooks, LOOK_SWEEP_S * 1000);
    function audit() {
      let n = 0, mb = 0, worn = 0, idleMB = 0, texs = 0;
      recs.forEach(function (r) {
        let rm = 0;
        for (let i = 0; i < r.texs.length; i++) { texs++; if (resident(r.texs[i])) { n++; rm += bytesOf(r.texs[i]); } }
        mb += rm;
        if (r.wear.size) worn++; else idleMB += rm;
      });
      return { looks: recs.size, textures: texs, resident: n, residentMB: +mb.toFixed(2), worn: worn, idleResidentMB: +idleMB.toFixed(2),
        budgetMB: budget(), evicted: L.evicted, evictedMB: +L.evictedMB.toFixed(2), revived: L.revived };
    }
    return { track: track, wear: wear, audit: audit, sweep: sweepLooks };
  })();

  CBZ.texFreeAudit = function () { sweep(); return { tracked: tracked.length, created: A.tracked, freed: A.freed, freedMB: +A.freedMB.toFixed(1), lazyPainted: A.lazyPainted, lazyReleased: A.lazyReleased, repaintedAfterFree: A.repaintedAfterFree, sample: A.names.slice() }; };
})();
