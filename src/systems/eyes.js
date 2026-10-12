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
     CBZ.eyes.hitFrom(x, z, p)   WHERE it came from: a short red wedge on the
                                 rim, turned toward the world point (x, z)
                                 and kept pointing at it while you turn.
                                 Same on foot, in a car, in a cockpit.
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
  if (CBZ.eyes && CBZ.eyes._v >= 3) return;
  const E = CBZ.eyes = { _v: 3 };

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

  /* ---- WHERE THE HIT CAME FROM --------------------------------------------
     A hit used to say nothing about its direction, so under fire the only
     way to find the shooter was to be shown him. Now each hit drops a wedge
     on the rim that points at the world position the round came from,
     re-aimed every frame against the live camera so it stays true as you
     turn the view or the aircraft. Up to four live at once; a hit from a
     bearing already showing renews that wedge instead of stacking. */
  const DIR_N = 4, DIR_LIFE = 1.3;
  const dirs = [];
  let dirLayer = null;
  function buildDirs() {
    if (dirLayer || typeof document === "undefined" || !document.body) return !!dirLayer;
    dirLayer = document.createElement("div");
    dirLayer.setAttribute("aria-hidden", "true");
    const ls = dirLayer.style;
    ls.position = "fixed"; ls.left = ls.top = ls.right = ls.bottom = "0";
    ls.pointerEvents = "none"; ls.zIndex = "19"; ls.overflow = "hidden";
    for (let i = 0; i < DIR_N; i++) {
      // a centred, rotating arm; the wedge sits at its outer end
      const arm = document.createElement("div");
      const as = arm.style;
      as.position = "absolute"; as.left = "50%"; as.top = "50%"; as.width = "0"; as.height = "0";
      as.willChange = "transform"; as.display = "none";
      const w = document.createElement("div");
      const wsty = w.style;
      wsty.position = "absolute"; wsty.width = "min(34vw,240px)"; wsty.height = "min(7vh,54px)";
      wsty.left = "calc(min(34vw,240px) / -2)";
      wsty.top = "calc(-1 * min(42vh,42vw))";
      wsty.borderRadius = "50% 50% 0 0 / 100% 100% 0 0";
      wsty.background = "radial-gradient(ellipse at 50% 100%,rgba(190,16,12,0) 38%,rgba(205,22,16,.78) 70%,rgba(150,8,6,0) 100%)";
      wsty.opacity = "0";
      arm.appendChild(w);
      dirLayer.appendChild(arm);
      dirs.push({ arm: arm, w: w, x: 0, z: 0, t: 0, p: 0, on: false, shownA: 1e9, shownO: -1 });
    }
    document.body.appendChild(dirLayer);
    return true;
  }
  // screen bearing of world (x, z) from the live camera: 0 = dead ahead (top
  // of the screen), +pi/2 = to your right, pi = behind you (bottom)
  function bearing(x, z) {
    const cam = CBZ.camera;
    if (!cam || !cam.matrixWorld) return null;
    const m = cam.matrixWorld.elements;
    // the camera looks down its local -Z; its world forward is -(column 2)
    let fx = -m[8], fz = -m[10];
    const fl = Math.hypot(fx, fz);
    if (fl < 1e-4) { fx = -m[4]; fz = -m[6]; }          // looking straight down: use screen-up
    const dx = x - m[12], dz = z - m[14];
    if (dx * dx + dz * dz < 1e-4) return null;
    // right = forward x up = (-fz, fx)
    return Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
  }
  function stepDirs(dt) {
    let live = false;
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      if (!d.on) continue;
      d.t -= dt;
      if (d.t <= 0 || playerDead()) {
        d.on = false; d.arm.style.display = "none"; d.w.style.opacity = "0"; d.shownO = -1;
        continue;
      }
      live = true;
      const a = bearing(d.x, d.z);
      const o = Math.round(clamp01(d.p * Math.min(1, d.t / (DIR_LIFE * 0.6))) * 40) / 40;
      if (a != null && Math.abs(a - d.shownA) > 0.004) {
        d.shownA = a;
        d.arm.style.transform = "rotate(" + a.toFixed(3) + "rad)";
      }
      if (o !== d.shownO) { d.shownO = o; d.w.style.opacity = String(o); }
    }
    return live;
  }

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

    const dirLive = dirs.length ? stepDirs(dt) : false;

    if (k > 0 || flinchK > 0 || dirLive || vigShown > 0 || satShown < 1 || lidK !== lidWant || lidShown > 0) schedule();
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
  E.hitFrom = function (x, z, p) {
    if (!Number.isFinite(+x) || !Number.isFinite(+z) || playerDead()) return;
    if (!buildDirs()) return;
    p = p == null ? 0.7 : clamp01(0.45 + 0.55 * clamp01(+p));
    const a = bearing(+x, +z);
    if (a == null) return;                     // point-blank: the rim flinch says it
    // renew a wedge already pointing that way, else take a free one, else the oldest
    let pick = null;
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      if (!d.on) continue;
      const b = bearing(d.x, d.z);
      if (b != null) {
        let df = Math.abs(a - b); if (df > Math.PI) df = Math.PI * 2 - df;
        if (df < 0.35) { pick = d; break; }
      }
    }
    if (!pick) for (let i = 0; i < dirs.length; i++) if (!dirs[i].on) { pick = dirs[i]; break; }
    if (!pick) { pick = dirs[0]; for (let i = 1; i < dirs.length; i++) if (dirs[i].t < pick.t) pick = dirs[i]; }
    pick.x = +x; pick.z = +z; pick.t = DIR_LIFE; pick.p = Math.max(pick.on ? pick.p : 0, p);
    if (!pick.on) { pick.on = true; pick.arm.style.display = "block"; pick.shownA = 1e9; pick.shownO = -1; }
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
    for (let i = 0; i < dirs.length; i++) { dirs[i].on = false; dirs[i].t = 0; dirs[i].arm.style.display = "none"; dirs[i].w.style.opacity = "0"; dirs[i].shownO = -1; }
    schedule();
  };
  // A hit used to paint the screen red, then to blink. It is a rim pulse now.
  CBZ.hitFlash = function (p) { E.flinch(p == null ? 0.6 : p); };
})();
