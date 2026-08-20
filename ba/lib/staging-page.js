/* ba/lib/staging-page.js — the in-page staging stdlib.

   NOT A MODULE. This file is Runtime.evaluate'd verbatim into the page, on
   both sides of a comparison, when a preset declares `inject: ["staging"]`.
   So: no imports, no exports, no top-level await, and nothing at definition
   time that can throw — a page that fails to define this leaves every stage
   in the run reporting a confusing `undefined is not an object` instead of
   the real problem.

   WHY IT EXISTS. Four helpers were copy-pasted into preset after preset —
   the poll loop, the caption overlay, the HUD sweep, the sightline audition
   — and the copies drifted. That drift is not cosmetic: `tsunami-stages`
   grew per-block dark plates on its captions after a whitewater frame ate a
   white-on-white label, and `volcano-stages`, which was forked from an older
   copy, kept the shadow-only captions and is still slightly harder to read.
   One of them collects raycast occluders with the sprite/water strata
   filtered out because a blocked tripod once passed its own audition and
   shipped a portrait of an office block; the other never had the audition at
   all. A helper that lives in fifty-seven files is fifty-seven versions of
   itself, and the newest scar only reaches the file that got cut.

   EVERY FUNCTION HERE FAILS SOFT AND SAYS SO. A staging helper that throws
   takes down a beat; a staging helper that silently returns "sure, that
   worked" ships a lying picture, which is worse. So each one returns a
   result object with the truth in it (`ok`, `proven`, `reason`) and the
   preset decides whether that is still worth photographing. Put the reason
   in the caption — a shot that had to fall back should say so on its own
   face. */

(function () {
  "use strict";

  if (typeof window === "undefined" || !window.document) return;

  /* The marker that makes an overlay immune to the HUD sweep. It lives on the
     DOM rather than in a closure so that re-injecting this file (a second
     navigation, a preset that re-evaluates it) still finds the overlays an
     earlier copy created. */
  var OVERLAY_MARK = "data-ba-overlay";

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function isVec(v) {
    return !!v && isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
  }

  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  /* ---------------------------------------------------------------------
     until(test, budgetMs, stepMs) → Promise<boolean>

     Poll for a condition and say plainly whether it arrived. `test` may be
     sync or async and is allowed to throw — a probe that reads state which
     does not exist yet is the normal case early in a boot, not an error.

     This is a WALL-CLOCK wait and belongs only on wall-clock questions:
     "has the app booted", "did the route render". If you are waiting for
     something the comparison is ABOUT — a phase, a front, a level — wait on
     that physical condition instead and publish the clock as a metric. See
     PRESETS.md, "Pacing changes".
     --------------------------------------------------------------------- */
  async function until(test, budgetMs, stepMs) {
    if (typeof test !== "function") return false;
    var budget = num(budgetMs, 60000);
    if (budget <= 0) budget = 60000;
    var step = num(stepMs, 250);
    if (step <= 0) step = 250;
    var deadline = Date.now() + budget;
    for (;;) {
      try {
        var value = test();
        if (value && typeof value.then === "function") value = await value;
        if (value) return true;
      } catch (_) { /* not ready yet is not an error */ }
      var left = deadline - Date.now();
      if (left <= 0) return false;
      await sleep(Math.min(step, left));
    }
  }

  /* ---------------------------------------------------------------------
     makeOverlay(id) → { ok, id, el, set(field, text, css), remove() }

     The caption kit. Five named blocks over the top of the page:

       side    the BEFORE/AFTER badge — pass the colour, it is the one thing
               that must differ between the two sides
       name    what this shot is
       focus   what to look at, in a sentence. The whole point of the report
       perf    the live numbers at the moment of the shot, monospace, right
       source  which URL this pixel came from. Small, bottom left, and the
               reason nobody has to trust the banner

     EVERY BLOCK GETS ITS OWN DARK PLATE, because a caption has to survive its
     own picture. A text shadow is not enough against a whitewater frame or a
     pale overcast sky; white-on-white is not a caption.

     Unknown field names are allowed and get a bare div with no default
     styling — pass the whole `css` yourself.
     --------------------------------------------------------------------- */
  var PLATE = "background:rgba(6,12,17,.62);border-radius:8px";
  var MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

  var FIELD_CSS = {
    side: "position:absolute;top:20px;left:22px;padding:7px 11px;border-radius:7px;" +
      "background:#218b60;font-size:12px;font-weight:900;letter-spacing:.12em",
    name: "position:absolute;top:56px;left:22px;padding:6px 12px;" + PLATE +
      ";font-size:25px;font-weight:800;letter-spacing:-.02em;max-width:640px",
    focus: "position:absolute;top:100px;left:22px;padding:8px 12px;" + PLATE +
      ";color:#cfdce6;font-size:12.5px;font-weight:550;max-width:640px;line-height:1.45",
    perf: "position:absolute;right:20px;top:20px;padding:7px 11px;" + PLATE +
      ";font:11.5px " + MONO + ";color:#9fe8c3;text-align:right;white-space:pre-line;" +
      "line-height:1.5;max-width:560px",
    source: "position:absolute;bottom:12px;left:22px;padding:4px 9px;border-radius:6px;" +
      "background:rgba(6,12,17,.55);color:#a8bccb;font:10px " + MONO,
  };

  var ROOT_CSS = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;" +
    "text-shadow:0 2px 9px #000;z-index:2147483647;" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

  var DEAD_OVERLAY = {
    ok: false, id: null, el: null, missing: "document.body",
    set: function () { return null; },
    remove: function () {},
  };

  function safeField(field) {
    return String(field == null ? "" : field).toLowerCase().replace(/[^a-z0-9-]/g, "");
  }

  function makeOverlay(id) {
    try {
      var body = document.body;
      if (!body) return DEAD_OVERLAY;
      var overlayId = String(id || "__baOverlay");
      var el = document.getElementById(overlayId);
      if (!el) {
        el = document.createElement("div");
        el.id = overlayId;
        body.appendChild(el);
      }
      el.setAttribute(OVERLAY_MARK, "");
      el.style.cssText = ROOT_CSS;

      var pick = function (field) {
        var key = safeField(field);
        if (!key) return null;
        var child = el.querySelector("[data-" + key + "]");
        if (!child) {
          child = document.createElement("div");
          child.setAttribute("data-" + key, "");
          el.appendChild(child);
        }
        return child;
      };

      return {
        ok: true,
        id: overlayId,
        el: el,
        /* Re-applies the base style on every call, so a caption cannot
           inherit last subject's one-off override. `css` is appended, which
           means a later declaration of the same property wins — that is how
           the BEFORE badge gets its red: set("side", label, "background:#c94c4c"). */
        set: function (field, text, css) {
          try {
            var child = pick(field);
            if (!child) return null;
            if (text != null) child.textContent = String(text);
            child.style.cssText = (FIELD_CSS[safeField(field)] || "") + (css ? ";" + css : "");
            return child;
          } catch (_) { return null; }
        },
        remove: function () {
          try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (_) {}
        },
      };
    } catch (_) { return DEAD_OVERLAY; }
  }

  /* ---------------------------------------------------------------------
     hideHudExcept(keepIds) → { ok, hidden, kept, restore() }

     Hide the app's own chrome so the shot is of the thing under comparison
     and not of a health bar. Sweeps the direct children of <body> and hides
     everything except:

       - anything that is, or contains, a <canvas>  (the render surface)
       - anything carrying the overlay marker        (this kit's captions)
       - anything whose id is in `keepIds`           (your exceptions)

     THE EXCEPTIONS ARE LOAD-BEARING. Sometimes a piece of chrome IS the
     subject — a whiteout sheet, a damage vignette, the very HUD element the
     change is about — and a blanket sweep photographs its absence. Name it.

     `restore()` puts back the exact inline visibility each element had, so a
     storyboard can shoot one beat with the HUD up and the next without it.
     Limit, stated: it only walks body's direct children. Chrome nested
     inside the canvas's own wrapper needs its own id in `keepIds` or its own
     hiding — the sweep will not find it.
     --------------------------------------------------------------------- */
  function hideHudExcept(keepIds) {
    var touched = [];
    var kept = [];
    var restore = function () {
      for (var i = 0; i < touched.length; i++) {
        try { touched[i].el.style.visibility = touched[i].prev; } catch (_) {}
      }
      touched = [];
    };
    try {
      var body = document.body;
      if (!body) return { ok: false, hidden: 0, kept: kept, missing: "document.body", restore: restore };

      var keep = Object.create(null);
      var list = keepIds == null ? []
        : (typeof keepIds === "string" ? [keepIds] : Array.prototype.slice.call(keepIds));
      for (var k = 0; k < list.length; k++) if (list[k]) keep[String(list[k])] = true;

      var children = Array.prototype.slice.call(body.children);
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        var isCanvasHost = false;
        try {
          isCanvasHost = child.tagName === "CANVAS" ||
            !!(child.querySelector && child.querySelector("canvas"));
        } catch (_) {}
        var isOverlay = false;
        try {
          isOverlay = (child.hasAttribute && child.hasAttribute(OVERLAY_MARK)) ||
            !!(child.querySelector && child.querySelector("[" + OVERLAY_MARK + "]"));
        } catch (_) {}
        if (isCanvasHost || isOverlay || (child.id && keep[child.id])) {
          kept.push(child.id || child.tagName);
          continue;
        }
        try {
          touched.push({ el: child, prev: child.style.visibility });
          child.style.visibility = "hidden";
        } catch (_) {}
      }
      return { ok: true, hidden: touched.length, kept: kept, restore: restore };
    } catch (err) {
      return { ok: false, hidden: 0, kept: kept, err: String(err), restore: restore };
    }
  }

  /* ---------------------------------------------------------------------
     auditionStand(opts) → { ok, stand, index, proven, tested, solids, reason }

       opts.THREE       the page's THREE (defaults to window.THREE)
       opts.scene       the scene to raycast against
       opts.lookAt      {x,y,z} — the subject, in world space, already
                        offset to whatever height you want in frame
       opts.candidates  [{x,y,z}] — the ladder of stands, BEST FIRST
       opts.clearance   metres (default 6): a hit within this range of the
                        subject IS the subject, not a wall
       opts.filter      (obj) → truthy to keep this mesh as an occluder
       opts.solids      a pre-collected occluder list, to reuse across beats

     THE TRIPOD PROVES ITS OWN SIGHTLINE. Every blind placement rule ever
     tried was defeated by some seed's geometry: a fixed sign parked the
     camera against a mountain, the flip-away rule parked it inside a tower,
     and a photograph of an obstruction is a failed beat that reports ok:true.
     So the stand is chosen the way a photographer chooses one — walk the
     ladder, cast a real ray at the subject from each rung, take the first
     rung that can actually SEE it.

     If no rung can be proved, the LAST candidate is returned with
     `proven:false`. Order the ladder accordingly: put the stand that is
     highest and furthest back last, because over the rooftops beats behind a
     wall every time. Then say `proven:false` in the caption — a shot that
     could not prove its own sightline is still worth having, as long as
     nobody is told it was clean.

     Two ways this used to lie, both fixed here:
       - a throw anywhere in the walk landed in a try/catch that returned
         "sure, that stand can see". A stand that cannot be PROVED is not
         chosen; the throw counts against it.
       - handing the raycaster the raw scene made sprites, particle motes and
         the water surface into walls. Occluders are collected once, meshes
         only, invisible subtrees skipped, and `filter` is where your scene's
         non-walls get named. A filter that throws keeps the object — an
         unclassifiable thing is treated as a wall, because the honest
         failure here is refusing a good stand, not accepting a blocked one.
     --------------------------------------------------------------------- */
  function isShown(obj) {
    var node = obj, guard = 0;
    while (node && guard++ < 64) {
      if (node.visible === false) return false;
      node = node.parent;
    }
    return true;
  }

  function collectSolids(scene, filter) {
    var out = [];
    try {
      scene.traverse(function (obj) {
        try {
          if (!obj || !obj.isMesh || !obj.geometry) return;
          if (obj.isSprite || obj.isPoints || obj.isLine) return;
          if (!isShown(obj)) return;
          /* Two conventions honoured without asking: `baNotSolid` is this
             tool's marker for "renders, but is not a wall", and
             `waterSurface` is the one every preset already sets. */
          var data = obj.userData;
          if (data && (data.baNotSolid || data.waterSurface)) return;
          if (typeof filter === "function") {
            var keep;
            try { keep = filter(obj); } catch (_) { keep = true; }
            if (!keep) return;
          }
          out.push(obj);
        } catch (_) {}
      });
    } catch (_) {}
    return out;
  }

  function auditionStand(opts) {
    var o = opts || {};
    var candidates = [];
    if (Array.isArray(o.candidates)) {
      for (var i = 0; i < o.candidates.length; i++) {
        if (isVec(o.candidates[i])) candidates.push(o.candidates[i]);
      }
    }
    var lastIndex = candidates.length - 1;
    var last = lastIndex >= 0 ? candidates[lastIndex] : null;
    /* Fail soft with a USABLE stand. Every one of these is "the audition
       could not be held", not "there is nowhere to stand" — so hand back the
       last rung (the ladder's safest) with proven:false and the reason, and
       let the preset decide whether that is still worth photographing. */
    var give = function (tested, solidCount, reason) {
      return {
        ok: false, stand: last, index: lastIndex, proven: false,
        tested: tested, solids: solidCount, reason: reason,
      };
    };
    if (!candidates.length) {
      return { ok: false, stand: null, index: -1, proven: false, tested: 0, solids: 0,
        reason: "no usable candidates" };
    }

    var T = o.THREE || window.THREE;
    if (!T || typeof T.Raycaster !== "function" || typeof T.Vector3 !== "function") {
      return give(0, 0, "no THREE.Raycaster in page");
    }
    var scene = o.scene;
    if (!scene || typeof scene.traverse !== "function") {
      return give(0, 0, "no scene to raycast");
    }
    if (!isVec(o.lookAt)) return give(0, 0, "no lookAt");

    var lookAt = o.lookAt;
    var clearance = num(o.clearance, 6);
    if (clearance < 0) clearance = 6;
    var solids = Array.isArray(o.solids) ? o.solids : collectSolids(scene, o.filter);

    var ray, origin, dir;
    try {
      ray = new T.Raycaster();
      origin = new T.Vector3();
      dir = new T.Vector3();
    } catch (err) {
      return give(0, solids.length, "raycaster unavailable: " + String(err));
    }

    var canSee = function (p) {
      try {
        dir.set(lookAt.x - p.x, lookAt.y - p.y, lookAt.z - p.z);
        var len = dir.length();
        if (!(len > 0)) return false;          // standing inside the subject proves nothing
        dir.multiplyScalar(1 / len);
        origin.set(p.x, p.y, p.z);
        ray.set(origin, dir);
        ray.near = 0.1;
        ray.far = Math.max(0.2, len - clearance);   // the last `clearance` metres ARE the subject
        return ray.intersectObjects(solids, false).length === 0;
      } catch (_) {
        return false;                          // a stand that cannot be proved is not chosen
      }
    };

    var tested = 0, chosen = -1;
    for (var c = 0; c < candidates.length; c++) {
      tested++;
      if (canSee(candidates[c])) { chosen = c; break; }
    }

    if (chosen < 0) {
      return { ok: true, stand: last, index: lastIndex, proven: false, tested: tested,
        solids: solids.length, reason: "no stand could be proved — took the last rung" };
    }
    return {
      ok: true, stand: candidates[chosen], index: chosen, proven: true, tested: tested,
      solids: solids.length,
      /* An empty occluder set makes every stand pass trivially. That is not a
         proof, so it does not get to be reported as one. */
      reason: solids.length ? "sightline proven" : "no occluders collected — sightline assumed",
    };
  }

  try {
    window.__baStaging = {
      until: until,
      makeOverlay: makeOverlay,
      auditionStand: auditionStand,
      hideHudExcept: hideHudExcept,
    };
  } catch (_) {}
})();
