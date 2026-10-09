/* ============================================================
   systems/eyes.js — CBZ.eyes: HOW A HURT BODY SEES. One file, every game.

   Owner, 2026-10-09 (iPad): "I don't like the eyes-closing effect on the
   screen. You should always see. The eyes can close after you fully die."

   So while you are ALIVE the view never closes and never goes black, however
   bad it is: hurt, knocked down, out cold, choked, out of air, nearly dead.
   What a hurt body gets instead is quiet and at the edge of the frame:
     - a light, dark-red rim that creeps in from the corners (centre stays clear)
     - the colour drains out of the world (canvas saturate)
     - a heartbeat you can hear, faster the worse it is, and loud breath near the end
     - a hit is a short pulse of that rim, never a blink
   The lids exist for ONE thing: the final fade AFTER you are dead
   (CBZ.eyes.close, called by a game's death beat), and they open again when
   the next life starts (CBZ.eyes.open / reset).

   API (unchanged names, so every feeder keeps working):
     CBZ.eyes.hurt(k, "body")   0..1  vitals.js: blood, hp, knocked out
     CBZ.eyes.hurt(k, "air")    0..1  holding your breath too long
       The heaviest one wins; a source that stops calling lets go on its own.
     CBZ.eyes.flinch(p)          a hit landing (0..1)
     CBZ.hitFlash()              the old name for a hit; now a flinch
     CBZ.eyes.level()            the current heaviness (0..1)
     CBZ.eyes.close(sec)         DEAD ONLY: the lids come down over sec
     CBZ.eyes.open(sec)          the lids come back up (a new life)
     CBZ.eyes.reset()            everything off, lids open, now

   CBZ.canvasFilter(name, css) is the one writer of the game canvas's CSS
   filter: drinking.js's blur and this file's desaturation used to fight over
   canvas.style.filter; now each names its part and they compose.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  if (CBZ.eyes && CBZ.eyes._v >= 2) return;
  const E = CBZ.eyes = { _v: 2 };

  /* ---- the canvas filter, composed from named parts ---------------------- */
  const FPARTS = Object.create(null);
  let fShown = null;
  CBZ.canvasFilter = function (name, css) {
    css = css || "";
    if ((FPARTS[name] || "") === css) return;
    if (css) FPARTS[name] = css; else delete FPARTS[name];
    let s = "";
    for (const n in FPARTS) s += (s ? " " : "") + FPARTS[n];
    const cv = CBZ.canvas || (CBZ.renderer && CBZ.renderer.domElement);
    if (!cv || s === fShown) return;
    fShown = s;
    cv.style.filter = s;
  };

  const SRC = Object.create(null);     // name -> { k, at }
  const HOLD = 0.5;                     // s a source stays without being renewed
  let t = 0, last = 0, raf = 0;
  let flinchK = 0;
  let beatT = 0, breathT = 0, breathIn = true;
  let vigShown = -1, satShown = -1, lidShown = -1;
  // the death lids: lidK eases toward lidWant at lidRate (per second)
  let lidK = 0, lidWant = 0, lidRate = 1;
  let vig = null, top = null, bot = null;

  function now() { return (typeof performance !== "undefined" && performance.now) ? performance.now() / 1000 : Date.now() / 1000; }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  function playerDead() { const P = CBZ.player; return !!(P && P.dead); }

  function buildVig() {
    if (vig || typeof document === "undefined" || !document.body) return !!vig;
    vig = document.createElement("div");
    vig.setAttribute("aria-hidden", "true");
    const s = vig.style;
    s.position = "fixed"; s.left = s.top = s.right = s.bottom = "0";
    s.pointerEvents = "none"; s.zIndex = "18"; s.opacity = "0"; s.willChange = "opacity";
    // the centre is fully clear at every strength; only the rim tints
    s.background = "radial-gradient(ellipse at center,rgba(0,0,0,0) 52%,rgba(70,6,8,.32) 78%,rgba(48,2,4,.62) 100%)";
    document.body.appendChild(vig);
    return true;
  }
  function buildLids() {
    if (top || typeof document === "undefined" || !document.body) return !!top;
    const lid = function (edge) {
      const d = document.createElement("div");
      d.setAttribute("aria-hidden", "true");
      const s = d.style;
      s.position = "fixed"; s.left = "-2%"; s.right = "-2%"; s.height = "58vh";
      s.pointerEvents = "none"; s.zIndex = "18"; s.willChange = "transform";
      s[edge] = "0";
      s.background = edge === "top"
        ? "linear-gradient(to bottom,#030202 0%,#070404 82%,rgba(7,4,4,.55) 92%,rgba(7,4,4,0) 100%)"
        : "linear-gradient(to top,#030202 0%,#070404 82%,rgba(7,4,4,.55) 92%,rgba(7,4,4,0) 100%)";
      s.transform = edge === "top" ? "translate3d(0,-100%,0)" : "translate3d(0,100%,0)";
      document.body.appendChild(d);
      return d;
    };
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
    const dead = playerDead();
    // a dead man's hurt cues stop; the death beat owns the screen now
    const k = dead ? 0 : level();
    flinchK = Math.max(0, flinchK - dt * 4.0);

    // THE RIM: light, at the edge only, a beat that pulses with the heart
    const vk = Math.round(clamp01(0.62 * k + 0.5 * flinchK) * 50) / 50;
    // THE COLOUR: drains toward grey, never all the way
    const sat = Math.round((1 - 0.5 * clamp01((k - 0.1) / 0.9)) * 20) / 20;
    // THE LIDS: only ever moved by close()/open()
    if (lidK !== lidWant) {
      const step = lidRate * dt;
      lidK = lidK < lidWant ? Math.min(lidWant, lidK + step) : Math.max(lidWant, lidK - step);
    }
    // ...and never shut on a living man, whoever asked
    if (!dead && lidWant > 0) { lidWant = 0; lidRate = 3; }
    const lk = Math.round(clamp01(lidK * lidK * (3 - 2 * lidK)) * 200) / 200;

    if ((vk > 0 || vigShown > 0) && buildVig() && vk !== vigShown) {
      vigShown = vk; vig.style.opacity = String(vk);
    }
    if (sat !== satShown) {
      satShown = sat;
      CBZ.canvasFilter("hurt", sat < 0.999 ? "saturate(" + sat.toFixed(2) + ")" : "");
    }
    if ((lk > 0 || lidShown > 0) && buildLids() && lk !== lidShown) {
      lidShown = lk;
      const off = (1 - lk) * 100;
      top.style.transform = "translate3d(0," + (-off).toFixed(1) + "%,0)";
      bot.style.transform = "translate3d(0," + off.toFixed(1) + "%,0)";
    }

    // THE HEART: you hear it once it matters, faster as it gets worse
    if (k > 0.2 && typeof CBZ.heartbeat === "function") {
      beatT -= dt;
      if (beatT <= 0) {
        try { CBZ.heartbeat(k); } catch (e) {}
        beatT = 1.05 - 0.5 * k;
      }
    } else beatT = 0;
    // HEAVY BREATHING near the end
    if (k > 0.5 && typeof CBZ.breath === "function") {
      breathT -= dt;
      if (breathT <= 0) {
        try { CBZ.breath(k, breathIn); } catch (e) {}
        breathT = (breathIn ? 0.75 : 1.0) * (1.6 - 0.8 * k);
        breathIn = !breathIn;
      }
    }

    if (k > 0 || flinchK > 0 || vigShown > 0 || satShown < 1 || lidK !== lidWant || lidShown > 0) schedule();
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
    flinchK = Math.max(flinchK, 0.25 + 0.45 * p);
    schedule();
  };
  E.level = function () { return level(); };
  // the final fade. Refused for a living player: the view never closes on you.
  E.close = function (sec) {
    if (!playerDead()) return false;
    lidWant = 1; lidRate = 1 / Math.max(0.05, +sec || 1);
    schedule();
    return true;
  };
  E.open = function (sec) {
    lidWant = 0; lidRate = 1 / Math.max(0.05, +sec || 0.6);
    schedule();
  };
  E.reset = function () {
    for (const n in SRC) delete SRC[n];
    flinchK = 0; lidWant = 0; lidK = 0;
    schedule();
  };
  // A hit used to paint the screen red, then to blink. It is a rim pulse now.
  CBZ.hitFlash = function (p) { E.flinch(p == null ? 0.6 : p); };
})();
