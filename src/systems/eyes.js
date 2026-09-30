/* ============================================================
   systems/eyes.js — CBZ.eyes: HOW A HURT BODY SEES. One file, every game.

   Owner, 2026-09-30: "I hate when the screen starts turning red. It's not
   realistic ... I don't know if you're about to die. Maybe your eyes can
   close. But the red, what does that even mean?"

   So nothing in this game paints the view red any more. Being close to the
   end is what it is for a body: the eyelids get heavy. They droop from the
   top and the bottom, the blinks come slower and longer, the light dims, the
   breath gets loud, and out cold they are shut. A hit makes you flinch (a
   snap half-blink). There is no tint, no meter, no word.

   Anything can close the eyes a little, by name, every frame it is true:
     CBZ.eyes.hurt(k, "body")   0..1  vitals.js: blood, hp, knocked out
     CBZ.eyes.hurt(k, "air")    0..1  holding your breath too long
   The heaviest one wins. A source that stops calling lets go on its own
   (half a second), so a mode that ends never leaves your eyes shut.
     CBZ.eyes.flinch(p)          a hit landing (0..1)
     CBZ.hitFlash()              the old name for a hit; now a flinch
     CBZ.eyes.level()            the current heaviness (0..1)
     CBZ.eyes.reset()

   The lids are two DOM strips moved by transform only (compositor work, no
   layout, no repaint), under the HUD so a finger can still find its button.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  if (CBZ.eyes && CBZ.eyes._v) return;
  const E = CBZ.eyes = { _v: 1 };

  const SRC = Object.create(null);     // name -> { k, at }
  const HOLD = 0.5;                     // s a source stays without being renewed
  let t = 0, last = 0, raf = 0;
  let flinchK = 0;
  let blinkT = 3, blinkDur = 0, blinkAge = -1;
  let breathT = 0, breathIn = true;
  let shown = -1, dimShown = -1;
  let top = null, bot = null, dim = null;

  function now() { return (typeof performance !== "undefined" && performance.now) ? performance.now() / 1000 : Date.now() / 1000; }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  function build() {
    if (top || typeof document === "undefined" || !document.body) return !!top;
    const lid = function (edge) {
      const d = document.createElement("div");
      d.setAttribute("aria-hidden", "true");
      const s = d.style;
      s.position = "fixed"; s.left = "-2%"; s.right = "-2%"; s.height = "58vh";
      s.pointerEvents = "none"; s.zIndex = "18"; s.willChange = "transform";
      s[edge] = "0";
      // skin-dark lid, a soft lash line rather than a hard edge
      s.background = edge === "top"
        ? "linear-gradient(to bottom,#030202 0%,#070404 82%,rgba(7,4,4,.55) 92%,rgba(7,4,4,0) 100%)"
        : "linear-gradient(to top,#030202 0%,#070404 82%,rgba(7,4,4,.55) 92%,rgba(7,4,4,0) 100%)";
      s.transform = edge === "top" ? "translate3d(0,-100%,0)" : "translate3d(0,100%,0)";
      document.body.appendChild(d);
      return d;
    };
    dim = document.createElement("div");
    dim.setAttribute("aria-hidden", "true");
    const ds = dim.style;
    ds.position = "fixed"; ds.left = ds.top = ds.right = ds.bottom = "0";
    ds.pointerEvents = "none"; ds.zIndex = "18"; ds.opacity = "0"; ds.willChange = "opacity";
    ds.background = "radial-gradient(ellipse at center,rgba(0,0,0,.35) 30%,rgba(0,0,0,.8) 100%)";
    document.body.appendChild(dim);
    top = lid("top"); bot = lid("bottom");
    return true;
  }

  function level() {
    let k = 0;
    for (const n in SRC) {
      const s = SRC[n];
      if (t - s.at > HOLD) { delete SRC[n]; continue; }
      if (s.k > k) k = s.k;
    }
    return k;
  }

  function frame() {
    raf = 0;
    const n = now();
    const dt = Math.min(0.1, Math.max(0, n - (last || n)));
    last = n;
    t += dt;
    const k = level();

    // THE BLINK: slower and longer the worse it is; near the end the lids
    // stay down for a long beat before they drag back up
    let blink = 0;
    if (k > 0.05) {
      blinkT -= dt;
      if (blinkT <= 0 && blinkAge < 0) {
        blinkAge = 0;
        blinkDur = 0.28 + 0.6 * k + (k > 0.8 && Math.random() < 0.4 ? 0.9 : 0);
        blinkT = (7 - 5 * k) * (0.7 + 0.6 * Math.random());
      }
    } else blinkT = Math.max(blinkT, 2);
    if (blinkAge >= 0) {
      blinkAge += dt;
      const u = blinkAge / blinkDur;
      // fast close, a hold at the bottom, a slow heavy open
      blink = u < 0.25 ? u / 0.25 : u < 0.55 ? 1 : Math.max(0, 1 - (u - 0.55) / 0.45);
      if (u >= 1) { blinkAge = -1; blink = 0; }
    }
    flinchK = Math.max(0, flinchK - dt * 5.5);

    // how far each lid comes down: 0 open, 1 shut (they meet in the middle)
    const droop = 0.2 * k + 0.32 * k * k;
    let c = Math.max(droop, blink * (0.55 + 0.45 * k), flinchK);
    if (k >= 0.999) c = 1;
    c = Math.round(clamp01(c) * 200) / 200;
    const dk = Math.round(clamp01(k * 0.85) * 50) / 50;

    if ((c > 0 || shown > 0 || dk > 0 || dimShown > 0) && build()) {
      if (c !== shown) {
        shown = c;
        // the lid is 58vh tall; at c=1 it covers down past the middle
        const off = (1 - c) * 100;
        top.style.transform = "translate3d(0," + (-off).toFixed(1) + "%,0)";
        bot.style.transform = "translate3d(0," + off.toFixed(1) + "%,0)";
      }
      if (dk !== dimShown) { dimShown = dk; dim.style.opacity = String(dk); }
    }

    // HEAVY BREATHING: loud, ragged, faster as it gets worse
    if (k > 0.3 && typeof CBZ.breath === "function") {
      breathT -= dt;
      if (breathT <= 0) {
        try { CBZ.breath(k, breathIn); } catch (e) {}
        breathT = (breathIn ? 0.75 : 1.0) * (1.6 - 0.8 * k);
        breathIn = !breathIn;
      }
    }

    if (k > 0 || c > 0 || flinchK > 0 || blinkAge >= 0 || shown > 0 || dimShown > 0) schedule();
  }
  function schedule() {
    if (raf || typeof requestAnimationFrame !== "function") return;
    raf = requestAnimationFrame(frame);
  }

  E.hurt = function (k, name) {
    k = clamp01(+k || 0);
    name = name || "body";
    const s = SRC[name];
    if (k <= 0.001) { if (s) { delete SRC[name]; schedule(); } return; }   // healthy: costs nothing
    if (s) { s.k = k; s.at = t; } else SRC[name] = { k: k, at: t };
    schedule();
  };
  E.flinch = function (p) {
    p = p == null ? 0.5 : clamp01(+p);
    flinchK = Math.max(flinchK, 0.25 + 0.35 * p);
    schedule();
  };
  E.level = function () { return level(); };
  E.reset = function () {
    for (const n in SRC) delete SRC[n];
    flinchK = 0; blinkAge = -1;
    schedule();
  };
  // A hit used to paint the screen red here. It is a flinch now.
  CBZ.hitFlash = function (p) { E.flinch(p == null ? 0.6 : p); };
})();
