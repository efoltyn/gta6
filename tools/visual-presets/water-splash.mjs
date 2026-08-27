/* WATER SPLASH — "there is no splashing in any water" (owner, 2026-08-26).

   He was right, and it was one line. src/world/water_wake.js declared
   CFG.WATER_WAKE_SPRITES = false by default; spawn() refused every caller on
   that flag, build() never allocated the buffers, the THREE.Points object was
   never added to a scene, and CBZ.waterEmitFree() answered 0. So the ENTIRE
   water particle system of this game drew nothing, everywhere, in every mode,
   while about thirty live call sites kept emitting into it — city/swim.js's
   entry and exit, shark_sim.js's breach at strength 3.2-4.6, wildlife_tame.js's
   ridden reentry at 1.3-9, wildlife_orca.js's spout and landing, marine_frenzy,
   marine_predation, every bullet through the water_impact bus, every raindrop,
   every boat's bow wave and rooster tail. Every one of them a function call
   that returned false.

   WHY THE FLAG EXISTED, AND WHY IT IS NOT THE FIX. The complaint behind it was
   also real: "anything that renders as camera facing is slop" (owner,
   2026-08-11). A THREE.Points sprite is always screen-aligned and surface foam
   LIES IN THE WATER PLANE, so every foam ring drew as a perfect upright white
   circle standing on the sea — a bubble. The previous pass answered that by
   killing the whole pool, taking the genuinely AIRBORNE spray (which a
   billboard is honest about) down with the foam it was never suited to. So
   turning the flag back on would not fix this page; it would photograph the
   bubbles the owner already rejected. The flag is GONE and `ride` is the
   rendering decision instead: airborne -> billboard, surface -> real flat
   geometry riding the live swell, plus a new crown-sheet MESH for the wall of
   water an impact actually throws.

   BOTH COLUMNS ARE SHARK SIM, the mode the owner plays, on the same island at
   the same seed. BEFORE is pristine HEAD served locally; AFTER is this working
   tree. Every subject stages the SAME public call at the SAME searched patch of
   island water from the SAME camera and steps the SAME simulated seconds with
   CBZ.stepSim as the only clock.

   THE INSTRUMENT IS THE FRAMEBUFFER. `whiteWater` is read with gl.readPixels
   out of the rendered frame inside the same task that rendered it, over a fixed
   screen rectangle that contains only sea: the permille of pixels that are
   bright and unsaturated, i.e. white water. It is the only metric here that
   both builds can be measured by (HEAD has no CBZ.waterFxAudit, no
   CBZ.waterCrown and a pool that was never allocated), and it is the number
   that actually answers the owner's sentence. The other three are the after
   side explaining itself.

   THE TWO RULES OF THIS TOOL, both of which cost somebody a whole run:
     1. stage() is SERIALIZED into the page. It carries NO module scope. Every
        free identifier it names is a ReferenceError in the browser and every
        frame comes back empty. RUN is therefore declared again inside it.
     2. A staged emitter reads the camera the PREVIOUS tick left (git show
        ff27038). camera.js owns the lens at onAlways(50); anything that
        distance-gates on CBZ.camera inside a step sees where the camera was
        before it. The wake's own distance gain and the crown's
        camera-inside-the-sheet guard both do exactly that — so the tripod is
        set, then a step is spent letting it settle, and only then is the
        splash triggered.
*/

const RUN = 1 / 30;

const subjects = [
  {
    id: "body-entry", ch: 0,
    label: "A Body Goes In",
    state: "waterSplashAt · strength 1.6",
    focus:
      "The most common splash in the game: CBZ.waterSplashAt at the strength city/swim.js uses when you drop off a quay and wildlife_orca.js uses for a spout. BEFORE: the call runs, the bus accepts it, the audio plays, the listener bus fires — and not one pixel changes, because every particle it composed was refused by a flag. AFTER: a torn cone of water erupts, ballistic droplets smear along their own travel and catch the light, and a foam ring lies down IN the surface and rides the swell out.",
  },
  {
    id: "megalodon-reentry", ch: 1,
    label: "Twenty Tonnes Comes Down",
    state: "waterSplashAt · strength 9",
    focus:
      "The exact legacy call city/wildlife_tame.js makes when a ridden shark's breach lands (1.3-9). BEFORE: nothing — and even with the pool alive the old code CLAMPED this dial at 2.5, so a megalodon reentry was served the same splash a swimmer makes. AFTER: the clamp is 9, mass scales with the square of the dial, and the momentum curve that was already there does the rest — a house-sized sheet, a rebound spike out of the cavity and a ring that keeps going.",
  },
  {
    id: "car-into-the-bay", ch: 2,
    label: "A Car Off The Quay",
    state: "waterHit · kind vehicle · 18 m/s",
    focus:
      "The vehicle-mass entry. Two separate bugs kept this silent: the passive detector in water_impact.js read car.pos.y, which city/vehicles.js never writes (the ride height lives on car.group.position), and the driven car has no height to cross anyway because over water vehicles.js seats the hull at a flat 0 until it starts sinking a second later. Both fixed; this is the call the new seam makes.",
  },
  {
    id: "bullet-strafe", ch: 3,
    label: "Rounds Into The Bay",
    state: "waterHit · kind bullet · x7",
    focus:
      "Seven rounds walked across the water, the way an automatic burst arrives. The shape here is deliberately NOT the big one — no crown, no column, just a tight vertical spurt and a pin-prick of white — because a bullet wearing the big-splash silhouette is the classic mistake that makes gunfire into water read as toylike. It is also the most frequent water impact in the game, so it has to be cheap.",
  },
  {
    id: "depth-charge", ch: 4,
    label: "Something Detonates Under The Surface",
    state: "waterBlastAt · power 2.2 · 3 m down",
    focus:
      "The three-stage beat water_impact.js already staged and nobody could see: a bubble dome at the charge, a foam COLUMN erupting at the surface above it, then spray raining back down. AFTER, the column is real geometry — the same crown primitive as an entry sheet, tall and narrow instead of low and wide, so there is no second column implementation to keep in step.",
  },
  {
    id: "hull-at-speed", ch: 5,
    label: "A Hull On The Plane",
    state: "waterWakeFor · 16 m/s · 6.2 m runabout",
    focus:
      "CBZ.waterWakeFor driven at planing speed — the one wake hook every boat in the game already calls. BEFORE the four components were computed in full and thrown away every frame; only the ribbon survived, because it was the one part of this file that was already real geometry. AFTER the Kelvin bow rings lie IN the water plane where they belong, the prop wash is a churned patch instead of a floating disc, and the chine sheet is beam-sized rather than raindrop-sized.",
  },
];

const readyExpression =
  "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && " +
  "CBZ.citySeaHeightAt && CBZ.waterSplashAt && CBZ.waterHit && document.getElementById('playBtn')";

async function stageWaterSplash(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim) return { ok: false, missing: "engine" };
  const RUN = 1 / 30;               // see the note above: no module scope in here
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__waterSplash;
  if (!D) {
    D = window.__waterSplash = {
      booted: false, waterline: 0, shot: null, roi: null, white: 0,

      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.fov = 55; cam.near = 0.12; cam.far = 24000;
        cam.aspect = input.width / input.height;
        cam.updateProjectionMatrix();
        cam.lookAt(new T.Vector3(tx, ty, tz));
        cam.updateMatrixWorld(true);
      },
      reshoot() { const s = D.shot; if (s) D.tripod(s[0], s[1], s[2], s[3], s[4], s[5]); },
      shoot(px, py, pz, tx, ty, tz) { D.shot = [px, py, pz, tx, ty, tz]; D.tripod(px, py, pz, tx, ty, tz); },

      /* THE LENS HAS TO BE RIGHT *DURING* THE STEP, NOT AFTER IT. Everything
         in the water FX chain that distance-gates — waterWakeFor's dg, the
         crown's camera-inside-the-sheet guard — reads CBZ.camera, and
         camera.js re-stamps the lens at onAlways(50) inside every step. So
         the tripod is re-applied after each one, which is what makes it right
         for the NEXT one. (git show ff27038.) */
      step(n) { for (let i = 0; i < n; i++) { CBZ.stepSim(RUN); D.reshoot(); } },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },

      async boot() {
        if (D.booted) return true;
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 60 && !(CBZ.sharkSim && CBZ.sharkSim.on); t++) { D.step(10); await sleep(20); }
        if (!(CBZ.sharkSim && CBZ.sharkSim.on)) return false;
        D.waterline = CBZ.sharkSim.waterline;
        /* Both columns draw from ONE seeded stream, so any Math.random in the
           spray jitter walks the same path on both sides and the two frames
           are the same photograph of the same dice. */
        let seed = 0x9e3779b9 >>> 0;
        Math.random = function () {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          return seed / 4294967296;
        };
        // Full quality on BOTH sides: every pool in this system is qScale'd, so
        // a different tier between the columns would be a different budget.
        CBZ.qualityLevel = 4;
        D._rafOrig = window.requestAnimationFrame;
        await D.killFrames();
        D.peace();
        D.hideHud();
        D.booted = true;
        return true;
      },
      /* HIDE THE HUD BEFORE EVERY SHUTTER, not once at boot. shark_sim.js
         creates its own overlay nodes lazily as the match runs, so a one-shot
         sweep at boot let a red species tag appear over one column and not the
         other — two frames that are no longer the same photograph. */
      hideHud() {
        const canvas = CBZ.renderer && CBZ.renderer.domElement;
        for (const child of Array.from(document.body.children)) {
          if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
          if (child.id === "__waterSplashOverlay") continue;
          child.style.visibility = "hidden";
        }
      },
      async killFrames() {
        const orig = D._rafOrig || window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
      },

      /* Everything that is not this experiment goes away. A shark surfacing or
         a pod ramming somewhere in frame would splash on its own timing and
         the two columns would stop being the same photograph. */
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (!a || !a.pos) continue;
          a.pos.x += 1400; a.hunger = 0;
          if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
          if (a.group) a.group.position.x = a.pos.x;
        }
        for (const b of CBZ.bots || []) {
          if (!b || !b.pos) continue;
          b.pos.x += 1200; b.pause = 99;
          if (b.target && b.target.set) b.target.set(b.pos.x, 0, b.pos.z);
        }
        if (CBZ.sharkSim) CBZ.sharkSim.podT = 900;
        if (CBZ.weather) CBZ.weather.raining = false;
      },

      // ---- the island's own oracles, asked rather than assumed --------------
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : 0; },
      depth(x, z) { return CBZ.cityWaterDepthAt ? Math.max(0, CBZ.cityWaterDepthAt(x, z)) : 0; },
      wet(x, z) { return CBZ.cityWaterAt ? !!CBZ.cityWaterAt(x, z) : false; },
      ringPoint(ang, r) {
        const A = CBZ.surv.arena;
        return { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
      },
      /* WHERE THE WATER IS THE DEPTH I ASKED FOR. Stage over the island's
         shelf and half this system's gates answer "not water"; a subject
         refuses to stage rather than photograph a lie. */
      findWater(ang, dMin, dMax) {
        for (let r = Math.max(4, D.waterline - 10); r < D.waterline + 620; r += 3) {
          const p = D.ringPoint(ang, r);
          if (!D.wet(p.x, p.z)) continue;
          const d = D.depth(p.x, p.z);
          if (d >= dMin && d <= dMax) return { x: p.x, z: p.z, depth: d, r: r, ang: ang };
        }
        return null;
      },
      /* Deeper water is DARKER water, and white spray against a dark sea is
         the whole point of the picture — so each subject asks for the depth it
         wants. It also has to be allowed to settle for less: an island that is
         shallower than asked must give a shallower shot, never a dead subject. */
      water(dMin, dMax) {
        for (const floor of [dMin, dMin * 0.6, dMin * 0.3, 1.5]) {
          for (const ang of [0, 0.8, -0.8, 1.6, -1.6, 2.5, -2.5, 3.14]) {
            const f = D.findWater(ang, floor, dMax);
            if (f) return f;
          }
        }
        return null;
      },

      /* Drain every water effect still alive from the previous subject, so a
         count read after this one is this one's. Nothing here forces anything
         to die early — it just runs the clock past the longest lifetime in the
         system (a blast's settling wash is the worst at ~3.5 s). */
      quiet() { D.sec(4.5); },

      // ---- the numbers ------------------------------------------------------
      fx() {
        if (typeof CBZ.waterFxAudit === "function") {
          try { return CBZ.waterFxAudit(); } catch (e) {}
        }
        // HEAD has no audit. It DOES publish the pool count, which is the
        // number that was zero, and that is the honest reading for that build.
        const n = typeof CBZ.waterParticleCount === "function" ? CBZ.waterParticleCount() : 0;
        return { drops: n, foam: 0, crowns: 0, built: n > 0, visible: {} };
      },
      // Every drawable in the scene graph this system owns that is actually
      // being drawn right now. Counted by userData.waterFx, a marker both
      // builds set, so one instrument measures both columns.
      fxDrawn() {
        let n = 0;
        try {
          (CBZ.scene || { traverse() {} }).traverse((o) => {
            if (o && o.userData && o.userData.waterFx && o.visible) n++;
          });
        } catch (e) {}
        return n;
      },
    };

    window.__cbzVisualCompare = {
      /* Awaited before every capture. Under SwiftShader the compositor takes
         over a second to PRESENT a rendered canvas, and a canvas rendered
         outside an animation frame is never presented at all — so render
         inside ONE borrowed real frame (the game's own chain is already dead,
         so lending rAF back for a single callback cannot restart it), READ THE
         PIXELS IN THAT SAME TASK (the drawing buffer is not preserved; a read
         after the compositor wait comes back empty), and only then wait it out. */
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (!CBZ.renderer) return;
        D.hideHud();                 // the sim adds HUD nodes after boot
        const raf = D._rafOrig;
        const draw = () => {
          CBZ.renderer.render(CBZ.scene, CBZ.camera);
          D.white = D.brightened(D.ref, D.readRoi());
        };
        if (raf) await new Promise((res) => raf.call(window, () => { draw(); res(); }));
        else draw();
        await new Promise((r) => setTimeout(r, 1200));
      },
    };

    /* THE INSTRUMENT — AND IT HAS TO BE DIFFERENTIAL.

       The first cut counted pixels that were bright AND unsaturated, absolutely.
       It failed, and the way it failed is worth writing down: this island's sea
       is pale turquoise under a heavy aerial haze, so on the wide shots the
       rectangle was ALREADY 80-100% "white water" before anything splashed, on
       BOTH builds, and the biggest splash in the game moved the number by -6.
       An absolute whiteness threshold measures the weather, not the feature.

       So the reading is BRIGHTENING: snapshot the rectangle immediately before
       the splash is triggered, snapshot it again at the shutter, and count the
       pixels whose luminance rose by more than THRESH. The scene's own
       brightness cancels exactly, it needs no per-subject tuning, and it is
       identical on both builds — on HEAD the splash brightens nothing because
       nothing is drawn, which is the finding.

       Read straight off the default framebuffer inside the task that rendered
       it: the drawing buffer is not preserved, so a read after the compositor
       wait comes back empty. */
    const THRESH = 26;
    D.readRoi = function () {
      try {
        const r = CBZ.renderer, gl = r.getContext();
        const W = r.domElement.width, H = r.domElement.height;
        const x0 = Math.round(W * 0.26), x1 = Math.round(W * 0.74);
        const y0 = Math.round(H * 0.08), y1 = Math.round(H * 0.70);   // GL y is UP
        const w = x1 - x0, h = y1 - y0;
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        D.roi = { x0, y0, w, h };
        return buf;
      } catch (e) { return null; }
    };
    D.lum = function (buf, i) { return buf[i] * 0.30 + buf[i + 1] * 0.59 + buf[i + 2] * 0.11; };
    D.brightened = function (ref, now) {
      if (!ref || !now || ref.length !== now.length) return -1;
      let n = 0, px = 0;
      for (let i = 0; i < now.length; i += 4) {
        px++;
        if (D.lum(now, i) - D.lum(ref, i) > THRESH) n++;
      }
      return px ? Math.round((n / px) * 1000) : -1;
    };
    // Render once, WITHOUT the compositor wait, purely to read the rectangle.
    // This is the "before the splash" half of the differential.
    D.mark = async function () {
      const raf = D._rafOrig;
      const draw = () => { CBZ.renderer.render(CBZ.scene, CBZ.camera); D.ref = D.readRoi(); };
      if (raf) await new Promise((res) => raf.call(window, () => { draw(); res(); }));
      else draw();
      D.refFx = D.fx();
    };
  }

  if (!await D.boot()) return { ok: false, err: "sharksim never armed" };
  // EVERY subject, not just the first: the shark sim keeps playing between
  // them, and a mount that has surfaced twice during the previous subject's
  // 4.5 s drain has put its own splashes in the pool this one is about to
  // measure. peace() then quiet() leaves the water empty and still.
  D.peace();
  D.quiet();

  const out = {};
  const dbg = {};

  /* Frame an entry: the lens off to one side, above the swell, looking at the
     column of air the splash will occupy. The SAME geometry on both sides —
     the camera is derived from the searched water point, not from anything
     that can move between the columns. */
  // THE AIM POINT IS THE WATERLINE, ALWAYS, and that is a measurement
  // decision as much as a framing one. Aiming at the waterline fixes the
  // camera's pitch at ~18 degrees down for every subject, which puts the
  // HORIZON at about 17% from the top of the frame — safely above the sea
  // rectangle readWhite() measures. Aim higher (at the middle of a sheet, say)
  // and the pitch flattens, the horizon slides down into the rectangle, and
  // the metric starts counting SKY as white water on both sides.
  function frameOn(spot, dist, height) {
    const sy = D.seaY(spot.x, spot.z);
    const a = spot.ang + 1.15;
    D.shoot(spot.x + Math.cos(a) * dist, sy + height, spot.z + Math.sin(a) * dist,
      spot.x, sy, spot.z);
    return sy;
  }

  const CH = [
    // 0 — A BODY GOES IN -----------------------------------------------------
    async function bodyEntry() {
      const spot = D.water(2, 400);
      if (!spot) throw new Error("no open water on this island");
      dbg.spot = spot;
      const sy = frameOn(spot, 13, 4.2);
      D.step(1);                                  // let the tripod settle (ff27038)
      await D.mark();                             // the pre-splash reference frame
      CBZ.waterSplashAt(spot.x, sy, spot.z, 1.6);
      D.sec(0.30);
    },
    // 1 — TWENTY TONNES COMES DOWN -------------------------------------------
    async function megReentry() {
      const spot = D.water(11, 400);
      if (!spot) throw new Error("no deep water on this island");
      dbg.spot = spot;
      const sy = frameOn(spot, 34, 11);
      D.step(1);
      await D.mark();
      CBZ.waterSplashAt(spot.x, sy, spot.z, 9);
      D.sec(0.42);
    },
    // 2 — A CAR OFF THE QUAY --------------------------------------------------
    async function carEntry() {
      const spot = D.water(2, 400);
      if (!spot) throw new Error("no open water on this island");
      dbg.spot = spot;
      const sy = frameOn(spot, 17, 5.5);
      D.step(1);
      await D.mark();
      CBZ.waterHit(spot.x, sy, spot.z, { kind: "vehicle", mass: 1400, speed: 18 });
      D.sec(0.34);
    },
    // 3 — ROUNDS INTO THE BAY -------------------------------------------------
    async function bulletStrafe() {
      const spot = D.water(2, 400);
      if (!spot) throw new Error("no open water on this island");
      dbg.spot = spot;
      const sy = frameOn(spot, 11, 2.6);
      D.step(1);
      await D.mark();
      // the burst walks ACROSS the frame, five rounds a frame max (the bus's
      // own per-frame cap), so this is two frames of trigger like a real one
      const tx = Math.cos(spot.ang + 1.15 + Math.PI / 2), tz = Math.sin(spot.ang + 1.15 + Math.PI / 2);
      for (let k = 0; k < 7; k++) {
        const px = spot.x + tx * (k - 3) * 1.5, pz = spot.z + tz * (k - 3) * 1.5;
        CBZ.waterHit(px, D.seaY(px, pz), pz, { kind: "bullet" });
        if (k === 4) D.step(1);
      }
      D.sec(0.16);
    },
    // 4 — SOMETHING DETONATES UNDER THE SURFACE -------------------------------
    async function depthCharge() {
      const spot = D.water(11, 400);
      if (!spot) throw new Error("no deep water on this island");
      dbg.spot = spot;
      const sy = frameOn(spot, 40, 13);
      D.step(1);
      await D.mark();
      CBZ.waterBlastAt(spot.x, sy - 3.0, spot.z, { power: 2.2 });
      D.sec(0.62);                                 // the column at its full height
    },
    // 5 — A HULL ON THE PLANE -------------------------------------------------
    async function hullAtSpeed() {
      const spot = D.water(9, 400);
      if (!spot) throw new Error("no open water on this island");
      dbg.spot = spot;
      const sy = frameOn(spot, 26, 8.5);
      D.step(1);
      await D.mark();
      // A synthetic hull driven through the ONE public wake hook, exactly as
      // world/water_helm.js drives a real one. Nothing here draws anything
      // itself: every component comes out of waterWakeFor's own vocabulary.
      const hx = Math.cos(spot.ang + 1.15 + Math.PI / 2), hz = Math.sin(spot.ang + 1.15 + Math.PI / 2);
      const heading = Math.atan2(hx, hz);
      const ref = { _wake: 1 };
      const opts = {
        kind: "boat", loa: 6.2, beam: 2.1, scale: 1, planeMs: 6,
        speed: 16, heading: heading, planing: 0.9, steer: 0.1, x: 0, z: 0,
      };
      const startX = spot.x - hx * 26, startZ = spot.z - hz * 26;
      const N = 60;                                // two seconds of way at 16 m/s
      for (let i = 0; i < N; i++) {
        opts.x = startX + hx * 16 * RUN * i;
        opts.z = startZ + hz * 16 * RUN * i;
        try { CBZ.waterWakeFor(ref, RUN, opts); } catch (e) { dbg.wakeErr = String(e); }
        D.step(1);
      }
      dbg.hullEnd = { x: opts.x, z: opts.z };
    },
  ];

  try { await CH[sub.ch](); } catch (e) {
    return { ok: false, err: String(e && e.message || e), debug: dbg };
  }

  D.reshoot();
  await window.__cbzVisualCompare.render();

  const fx = D.fx();
  const ref = D.refFx || { drops: 0, foam: 0, crowns: 0 };
  out.whiteWater = D.white;
  // DELTAS AGAINST THE PRE-SPLASH FRAME, for the same reason whiteWater is a
  // delta: the pool is shared, and whatever the sim happened to leave alive is
  // not what this subject drew.
  out.sprayDrops = Math.max(0, (fx.drops || 0) - (ref.drops || 0));
  out.foamPatches = Math.max(0, (fx.foam || 0) - (ref.foam || 0));
  out.crownSheets = Math.max(0, (fx.crowns || 0) - (ref.crowns || 0));
  out.fxDrawn = D.fxDrawn();

  // ---- the overlay ---------------------------------------------------------
  let overlay = document.getElementById("__waterSplashOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "__waterSplashOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f2f8fc;text-shadow:0 2px 9px #001019;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-read></div><div data-source></div>";
    document.body.appendChild(overlay);
  }
  overlay.style.visibility = "visible";
  const before = input.side === "before";
  const label = (name, text, css) => {
    const el = overlay.querySelector("[data-" + name + "]");
    if (!el) return;
    el.textContent = text; el.style.cssText = css;
  };
  label("side", before ? input.beforeLabel : input.afterLabel,
    `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`);
  label("name", sub.label, "position:absolute;top:64px;left:26px;font-size:26px;font-weight:800;letter-spacing:-.02em");
  label("focus", sub.focus, "position:absolute;top:100px;left:28px;color:#c3d4de;font-size:13px;font-weight:550;max-width:760px;line-height:1.35");
  label("state", sub.state, `position:absolute;right:26px;top:25px;color:${before ? "#ffb0b0" : "#7ff0bb"};font-size:11px;font-weight:900;letter-spacing:.1em`);
  label("read",
    `sea brightened ${out.whiteWater}‰ by the splash` +
    `\nspray ${out.sprayDrops} · foam ${out.foamPatches} · sheets ${out.crownSheets}` +
    `\nwater FX drawables visible ${out.fxDrawn}`,
    "position:absolute;right:26px;top:52px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3;white-space:pre;text-align:right");
  label("source", new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname,
    "position:absolute;bottom:20px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace");

  return {
    ok: true, side: input.side, chapter: sub.ch,
    debug: Object.assign(dbg, {
      mode: CBZ.game.mode, state: CBZ.game.state,
      roi: D.roi,
      spritesFlag: CBZ.CONFIG ? CBZ.CONFIG.WATER_WAKE_SPRITES : "absent",
      hasCrown: typeof CBZ.waterCrown === "function",
      hasAudit: typeof CBZ.waterFxAudit === "function",
      audit: fx,
    }),
    metrics: out,
  };
}

export default {
  id: "water-splash",
  title: "Water — There Is Now Splashing In The Water",
  description:
    "Six water impacts staged in Shark Sim on the same island at the same seed, photographed on both builds " +
    "from the same cameras over the same simulated seconds. BEFORE is pristine HEAD, where the answer to " +
    "\"there is no splashing in any water\" is one line: src/world/water_wake.js defaulted " +
    "WATER_WAKE_SPRITES to false, so spawn() refused every caller, the buffers were never allocated and the " +
    "Points object was never added to a scene — while about thirty live call sites kept emitting into it. " +
    "AFTER, the flag is gone and `ride` is the rendering decision instead: airborne spray is a rewritten " +
    "pooled THREE.Points that is velocity-aligned (the vertex program projects a step along each droplet's " +
    "own velocity into screen space, so fast spray smears into a teardrop) and lit from the top so it reads " +
    "as water catching light; surface foam is no longer a billboard at all but real flat geometry whose " +
    "every vertex re-reads CBZ.citySeaHeightAt, so it lies IN the water plane and foreshortens honestly at " +
    "a grazing angle — which is what the owner rejected the sprites for in the first place; and a new " +
    "pooled crown-sheet MESH throws the hollow, torn cone of water an impact actually makes, from a metre " +
    "for a diver to ten for a megalodon reentry. Two silent seams are wired on the way past: the passive " +
    "vehicle-entry detector was reading car.pos.y, which city/vehicles.js never writes, and the driven car " +
    "now announces its own crossing because over water it has no height to cross.",
  beforeLabel: "BEFORE · pristine HEAD",
  afterLabel: "AFTER · working tree",
  pairNote: "Same island · same seed · same water point · same camera · same simulated seconds",
  method:
    "Both columns boot index.html into ?mode=sharksim at a pinned seed and click the Shark Sim tile + PLAY " +
    "exactly like a player. A per-page driver freezes the frame loop (draining the one already-queued rAF " +
    "callback, or it re-stamps the camera at an arbitrary later tick), seeds Math.random from one LCG, pins " +
    "the quality tier at 4 on both sides (every pool here is qScale'd, so a different tier is a different " +
    "budget), moves the wildlife and the crowd out of frame, and searches the island's own water oracles " +
    "for a patch of the depth each subject needs. Each subject then sets the tripod, spends ONE step " +
    "letting camera.js hand the lens back (every distance-gated emitter in this chain reads the camera the " +
    "previous tick left — git show ff27038), takes the pre-splash reference frame, makes ONE public call — " +
    "CBZ.waterSplashAt, CBZ.waterHit, " +
    "CBZ.waterBlastAt or CBZ.waterWakeFor, the same calls the game makes — and steps a fixed number of " +
    "frames before the shutter. Nothing in the preset draws anything.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 420000,
  viewport: { width: 1280, height: 720 },
  metrics: {
    whiteWater: { label: "Sea rectangle brightened by the splash", unit: "‰ of pixels", better: "higher" },
    sprayDrops: { label: "Airborne droplets the impact added", unit: "particles", better: "higher" },
    foamPatches: { label: "Surface foam patches the impact added", unit: "patches", better: "higher" },
    crownSheets: { label: "Crown sheets the impact threw up", unit: "sheets", better: "higher" },
    fxDrawn: { label: "Water-FX drawables actually being drawn", unit: "objects", better: "higher" },
  },
  metricsNote:
    "whiteWater is the owner's sentence as one number and it is the only one measured the same way on both " +
    "builds: gl.readPixels over a fixed screen rectangle containing nothing but sea, taken TWICE — once " +
    "immediately before the splash is triggered and once at the shutter — reporting the permille of pixels " +
    "whose luminance rose by more than 26. It has to be differential: this island's sea is pale turquoise " +
    "under a heavy haze, and an absolute whiteness threshold read the rectangle as 80-100% white water " +
    "before anything happened, on both builds, so the biggest splash in the game moved it by -6. " +
    "Brightening cancels the weather exactly. The particle counts are deltas against that same pre-splash " +
    "frame, because the pool is shared and whatever the sim left alive is not what this subject drew. " +
    "The other four are " +
    "the after side explaining itself — HEAD has no CBZ.waterFxAudit and no CBZ.waterCrown, and its pool " +
    "count is structurally zero because the pool was never allocated, which is the finding rather than a " +
    "measurement gap. fxDrawn is counted off userData.waterFx, a marker BOTH builds set on every water " +
    "drawable they add to the scene, so one instrument reads both columns. THE PICTURES ARE THE TEST; " +
    "these numbers only say whether the thing in the picture happened at all.",
  subjects,
  readyExpression,
  stage: stageWaterSplash,
};
