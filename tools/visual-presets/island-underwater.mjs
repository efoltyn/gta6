/* ISLAND UNDERWATER — the water column of the shark sim, before and after.

   THE BRIEF (owner, 2026-08-25):
     "looks fake because underwater sucks — light blue refs, it should get
      darker as you get deeper, lighter showing surface"
     "add an ocean floor"

   WHAT IT PHOTOGRAPHS. Not a studio scene: the live ?mode=sharksim match on
   the disaster island, boot to PLAY like a player, frame loop killed, the
   match advanced only through CBZ.stepSim so a beat is a number of GAME
   seconds rather than a number of rasterised frames.

   THE EYE IS PINNED, NOT DRIVEN. Every subject declares a world ring radius
   and an eye depth, and a tiny onAlways(51.2) pass parks the camera exactly
   there each tick — after systems/camera.js (50) and after water_underwater's
   own lens pass (50.5), and long before that file's main grading pass (99.6)
   reads the eye. So both sides grade the SAME eye at the SAME depth over the
   SAME ring, and the only variables left are the ones under test: the colour
   of the medium, the light on the bottom, and whether there is a bottom.

   The ring radius is used instead of a depth search on purpose — a search
   would silently move the two sides to different places precisely because the
   bathymetry is one of the things that changed. Both sides stand at r = 175
   and r = 195 from the island's centre; the water column each side finds there
   is reported as a metric.

   RUN:
     node tools/visual-compare.mjs --preset island-underwater \
       --before http://127.0.0.1:8791/
*/

const subjects = [
  {
    id: "near-surface-level",
    label: "Three Metres Under · Toward The Surface",
    focus: "The near-surface reference is a bright, SUNLIT blue with a shimmering ceiling and visible rays. BEFORE: one flat pale turquoise wash with no ceiling and no direction at all — the same sheet at every depth, because the grade was weighted 2:1 toward how deep the SEABED is and the island shelf is a sandbar.",
    ring: 175, eye: 3.4, look: 0.14, shark: true, sharkDy: 0.6, sharkAt: 13,
    state: "3.4 m EYE · TOWARD THE SURFACE",
  },
  {
    id: "deep-level",
    label: "Twelve Metres Down · Looking Level",
    focus: "The deep reference is a dark, desaturated blue-green in which a great white is a DIM SILHOUETTE and the far water simply closes. BEFORE: at the same twelve metres the frame is the same pale turquoise as the surface shot — diving moved `k` by about 0.16 across the whole descent.",
    ring: 195, eye: 12, look: 0.02, shark: true, sharkDy: -0.6, sharkAt: 8,
    state: "12 m EYE · LEVEL",
  },
  {
    id: "deep-looking-up",
    label: "Twelve Metres Down · Looking Up",
    focus: "The one frame that has to have BOTH: a bright rippling ceiling with the sun through it, over a dark column. BEFORE the ceiling and the column are the same colour, so there is nothing to look up at.",
    ring: 195, eye: 12, look: 2.2, shark: true, sharkDy: 7.4, sharkAt: 4,
    state: "12 m EYE · LOOKING UP",
  },
  {
    id: "floor-read",
    label: "Across The Shelf · The Sea Has A Floor",
    focus: "AFTER: a depth-graded bed — warm shell sand under the shallows going silt, then shelf teal — with scattered rock and kelp on it, lit by a sun that finally dims with depth. BEFORE: one flat MeshLambert 0xcdbb8f under a sun nothing ever dimmed, clipping toward white, and nothing on it at all.",
    ring: 167, eye: 4.6, look: -0.28, toward: "shore", shark: true, sharkDy: -1.4, sharkAt: 13,
    state: "4.6 m EYE · ACROSS THE SHELF",
  },
  {
    id: "surface-toward-shore",
    label: "From The Surface · Toward The Shore",
    focus: "The shipped surface frame shows a pale, near-white floor running out under the sea. AFTER the same bed reads as bathymetry: sand at the beach going teal and then dark as the shelf falls away — and it keeps going past r = 290, where the drawn floor used to simply stop under a 1400 m ocean plane.",
    ring: 205, eye: -2.2, look: -0.20, toward: "shore",
    state: "2.2 m ABOVE · TOWARD SHORE",
  },
];

async function stageIslandUnderwater(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  Math.random = (function (s) { return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(20260825);

  let D = window.__islandUw;
  if (!D) {
    D = window.__islandUw = {
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },
      keys(o) {
        const k = CBZ.keys; if (!k) return;
        k.w = k.a = k.s = k.d = k.shift = k.control = k.c = false; k[" "] = false;
        for (const n in o) k[n] = o[n];
      },
      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 80 && !D.armed(); t++) { D.step(15); await sleep(20); }
        if (!D.armed()) return false;
        // Noon on both sides. The whole underwater ramp is multiplied by the
        // live day factor, so a dusk capture on one side would be a colour
        // difference nobody made.
        try { if (CBZ.dayPhase) CBZ.dayPhase(0.25); } catch (e) {}
        // Headless SwiftShader settles on the LOW tier, which halves the
        // water's view distance through CBZ.qScale. Pin it.
        try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (e) {}
        D._rafOrig = window.requestAnimationFrame;
        await D.killFrames();
        D.installPin();
        D.hideChrome();
        return true;
      },
      async killFrames() {
        const orig = D._rafOrig || window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
      },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },
      /* THE PIN. Order 51.2 is deliberate: systems/camera.js's one writer is
         at 50 and water_underwater.js's lens pass is at 50.5, so this is the
         last word on the eye — and world/water_underwater.js's grading pass
         (99.6), the sky seam pass (98.9) and every light writer all run after
         it, which is what makes the frame a real evaluation of the change
         rather than a transform pasted on at the end. */
      installPin() {
        window.__uwPin = { on: false, px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, body: null };
        CBZ.onAlways(51.2, function () {
          const p = window.__uwPin;
          const cam = CBZ.camera;
          if (!p || !p.on || !cam) return;
          /* THE BODY IS PINNED TOO, and it has to be pinned HERE. The ride's
             own depth controller runs in the UPDATERS, which stepSim drains in
             full before it touches the always chain — so a height written at
             51.2 is the last word of the tick and survives to the render. The
             alternative (holding the DIVE key and hoping) settles at a
             different depth on each side, because how deep the animal can get
             is one of the things this report is about. */
          if (p.body != null) {
            const P = CBZ.player, S = CBZ.sharkSim && CBZ.sharkSim.shark;
            if (P && P.pos) P.pos.y = p.body;
            if (S) {
              if (S.pos) S.pos.y = p.body;
              if (S.group) S.group.position.y = p.body;
            }
          }
          cam.position.set(p.px, p.py, p.pz);
          cam.up.set(0, 1, 0);
          cam.lookAt(p.tx, p.ty, p.tz);
          cam.updateMatrixWorld(true);
        });
        CBZ.always.sort(function (a, b) { return a.order - b.order; });
      },
      /* The real HUD is not what is being compared and it eats a third of the
         frame — but the underwater tint and the breath vignette are their OWN
         elements outside #hud and MUST stay, because they are half of what
         this preset photographs. An inline style loses (the HUD rewrites its
         own display every frame); a !important rule is what an inline write
         cannot beat. */
      hideChrome() {
        const st = document.createElement("style");
        st.textContent = "#hud,#crosshair,#sharkflash,#sharkhud,#tvAux,#touchpad,#tvRoot{display:none !important}";
        document.head.appendChild(st);
        const ov = document.createElement("div");
        ov.id = "__islandUwOverlay";
        ov.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f2f9fd;text-shadow:0 2px 10px #00121e;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
        ov.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-metric></div><div data-source></div>";
        document.body.appendChild(ov);
        D.overlay = ov;
      },
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (!a || a.dead || !a.species) continue;
          if (CBZ.sharkSim && a === CBZ.sharkSim.shark) continue;
          if (a.species.id === "orca" || (a.species.aquatic && (a.species.bite || 0) >= 24)) {
            a.hunger = 0;
            if (a._shark) { a._shark.state = "cruise"; a._shark.bail = 6; }
            if (CBZ.predatorDisengage) { try { CBZ.predatorDisengage(a, 120); } catch (e) {} }
          }
        }
        if (CBZ.sharkSim) {
          const S = CBZ.sharkSim.shark;
          if (S) S.hp = S.maxHp;
          CBZ.sharkSim.podT = 120;
        }
      },
    };
    window.__cbzVisualCompare = {
      /* Awaited before every capture. Under SwiftShader the compositor takes
         well over a second to PRESENT a rendered canvas, so a shorter barrier
         photographs the PREVIOUS composite. */
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (!CBZ.renderer) return;
        const raf = D._rafOrig;
        if (raf) {
          await new Promise((res) => raf.call(window, () => {
            CBZ.renderer.render(CBZ.scene, CBZ.camera);
            res();
          }));
        } else CBZ.renderer.render(CBZ.scene, CBZ.camera);
        /* THE SCENE PIXEL, NOT THE COMPOSITED ONE. Everything in this look is
           two layers — the rendered water and a DOM veil over it — and a
           screenshot cannot tell you which one is pale. gl.readPixels
           immediately after the draw reads the framebuffer BEFORE the veil
           composites, so the report can say which half of the treatment
           produced a colour instead of guessing. */
        try {
          const gl = CBZ.renderer.getContext();
          const cv = CBZ.renderer.domElement;
          const b = new Uint8Array(4), out = [];
          for (const f of [[0.5, 0.62], [0.5, 0.30], [0.78, 0.86]]) {
            gl.readPixels(Math.round(cv.width * f[0]), Math.round(cv.height * (1 - f[1])),
              1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
            out.push(b[0] + "," + b[1] + "," + b[2]);
          }
          D.scenePx = out.join(" | ");
        } catch (e) { D.scenePx = "err " + e.message; }
        await new Promise((r) => setTimeout(r, 1200));
      },
    };
  }

  if (!D.booted) {
    D.booted = await D.boot();
    if (!D.booted) return { ok: false, error: "sharksim never armed" };
  }
  D.keys({});
  D.peace();

  const A = CBZ.surv.arena;
  if (!A) return { ok: false, error: "no arena" };

  // A FIXED WORLD BEARING, not the player's current one: the ring point has to
  // be the same coordinate on both sides or the comparison is a lottery.
  const ANG = 0;
  const rr = Number(sub.ring);
  const px = A.center.x + Math.cos(ANG) * rr;
  const pz = A.center.z + Math.sin(ANG) * rr;
  const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(px, pz) : -0.8;
  const column = CBZ.survFloodDepthMeanAt ? CBZ.survFloodDepthMeanAt(px, pz) : 0;
  const bedY = CBZ.survSeaBedYAt ? CBZ.survSeaBedYAt(px, pz) : -1.35;
  const eyeY = surf - Number(sub.eye);

  // Put the ridden body where the camera can see it, at roughly the eye's own
  // depth, and hold DIVE while it settles so its own buoyancy does not float
  // it back to the surface between the placement and the capture.
  const P = CBZ.player;
  const TANG = ANG + Math.PI / 2;        // the alongshore tangent at this ring
  // The bearing the lens looks along: alongshore by default, straight back at
  // the island for a subject that wants the shelf rising in front of it.
  const aimAng = sub.toward === "shore" ? ANG + Math.PI : TANG;
  const shark = CBZ.sharkSim && CBZ.sharkSim.shark;
  const away = sub.sharkAt == null ? 13 : Number(sub.sharkAt);
  if (P && P.pos) {
    // out along the lens's own bearing, so the animal is in frame whichever
    // way the subject is pointed
    P.pos.x = px + Math.cos(aimAng) * away;
    P.pos.z = pz + Math.sin(aimAng) * away;
  }
  // keys.w moves along (-sin, -cos)·yaw, so this is the yaw that looks ALONG
  // that bearing — the ride swims the way the lens is pointed.
  if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(-Math.cos(aimAng), -Math.sin(aimAng)); CBZ.cam.pitch = 0.1; }

  // The pin, aimed. `look` is an ELEVATION (+ up at the surface, - down at the
  // bed), turned into a target 30 m out along that bearing.
  const look = Number(sub.look) || 0;
  const REACH = 30;
  const pin = window.__uwPin;
  pin.on = true;
  pin.px = px; pin.py = eyeY; pin.pz = pz;
  pin.tx = px + Math.cos(aimAng) * REACH;
  pin.tz = pz + Math.sin(aimAng) * REACH;
  pin.ty = eyeY + look * REACH;
  // the ridden body sits a touch below the lens, so it reads against the
  // column rather than against the ceiling — but never below the bed
  pin.body = sub.shark
    ? Math.max(bedY + 1.6, Math.min(surf - 1.2, eyeY + (sub.sharkDy == null ? -1.1 : Number(sub.sharkDy))))
    : null;

  // Let the whole chain converge on the pinned eye: the tint's 0.22 s ease,
  // the fog's foreign-write adoption, the light ramp and the sky repaint all
  // need a few real ticks at the final position.
  D.sec(1.6);

  const cam = CBZ.camera;
  const camSurf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(cam.position.x, cam.position.z) : surf;
  const eyeDepth = camSurf - cam.position.y;
  const fog = CBZ.scene && CBZ.scene.fog;
  const sharkDepth = shark && shark.group
    ? (CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(shark.group.position.x, shark.group.position.z) : surf) - shark.group.position.y
    : null;

  // ---- labels --------------------------------------------------------------
  const after = input.side === "after", ov = D.overlay;
  const q = (s) => ov.querySelector(s);
  const side = q("[data-side]");
  side.textContent = after ? input.afterLabel : input.beforeLabel;
  side.style.cssText = `position:absolute;top:20px;left:24px;padding:7px 11px;border-radius:7px;background:${after ? "#187e5a" : "#bd4848"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  const name = q("[data-name]"); name.textContent = sub.label;
  name.style.cssText = "position:absolute;top:62px;left:25px;font-size:26px;font-weight:850;letter-spacing:-.025em";
  const foc = q("[data-focus]"); foc.textContent = sub.focus;
  foc.style.cssText = "position:absolute;top:99px;left:26px;color:#c3d7e2;font-size:12.5px;font-weight:550;max-width:760px;line-height:1.36";
  const st = q("[data-state]"); st.textContent = sub.state;
  st.style.cssText = `position:absolute;right:24px;top:23px;color:${after ? "#7df0b8" : "#ffaaaa"};font-size:11px;font-weight:900;letter-spacing:.1em`;
  const met = q("[data-metric]");
  met.textContent = "eye " + eyeDepth.toFixed(1) + " m · column " + column.toFixed(1) +
    " m · bed y " + bedY.toFixed(1) + " · fog far " + (fog && fog.far != null ? fog.far.toFixed(1) : "?") +
    " m · " + (fog && fog.color ? "#" + fog.color.getHexString() : "?") +
    " · sun " + (CBZ.sun ? CBZ.sun.intensity.toFixed(2) : "?");
  met.style.cssText = "position:absolute;right:24px;bottom:20px;padding:7px 10px;border-radius:6px;background:rgba(3,18,28,.78);color:#bfeeff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  const src = q("[data-source]");
  src.textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  src.style.cssText = "position:absolute;bottom:20px;left:25px;color:#93acba;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  await window.__cbzVisualCompare.render();

  return {
    ok: true, side: input.side, subject: sub.id,
    debug: {
      mode: CBZ.game.mode, state: CBZ.game.state,
      ring: rr, camPos: cam.position.toArray().map((v) => +v.toFixed(2)),
      sharkDepthM: sharkDepth == null ? null : +sharkDepth.toFixed(2),
      skyBg: CBZ.scene.background && CBZ.scene.background.getHexString
        ? "#" + CBZ.scene.background.getHexString() : String(CBZ.scene.background),
      domeVisible: CBZ.skyDome ? (CBZ.skyDome.visible ? 1 : 0) : -1,
      overlayOpacity: (function () {
        const el = document.getElementById("cbzUnderwater");
        return el ? el.style.opacity : null;
      })(),
      scenePx: D.scenePx || null,
    },
    metrics: {
      eyeDepthM: +eyeDepth.toFixed(2),
      waterColumnM: +column.toFixed(2),
      seabedY: +bedY.toFixed(2),
      fogFarM: fog && fog.far != null ? +fog.far.toFixed(2) : null,
      fogColor: fog && fog.color ? "#" + fog.color.getHexString() : null,
      sunIntensity: CBZ.sun ? +CBZ.sun.intensity.toFixed(3) : null,
      hemiIntensity: CBZ.hemi ? +CBZ.hemi.intensity.toFixed(3) : null,
      submerged: (CBZ.cityCameraSubmerged && CBZ.cityCameraSubmerged()) ? 1 : 0,
    },
  };
}

export default {
  id: "island-underwater",
  title: "Shark Sim — Being Under The Water",
  description: "Five matched frames of the live ?mode=sharksim island: a metre under the surface, twelve metres down looking level and then up, four metres down looking at the floor, and the same shelf seen from the surface. The eye is pinned to the same world coordinate and the same depth on both sides, so the only variables are the colour of the medium, the light falling on the bottom, and whether there is a bottom.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · GRADED COLUMN + REAL SHELF",
  pairNote: "Same seed · same island · same ring radius · same eye depth · same pinned camera · noon · quality tier 3",
  method: "Both pages boot index.html?mode=sharksim, click the tile and PLAY like a player, then kill the frame loop and advance the match only through CBZ.stepSim. A per-page onAlways(51.2) pass parks the camera at the subject's ring radius and eye depth every tick — after systems/camera.js (50) and after water_underwater.js's own lens pass (50.5), and before its grading pass (99.6) — so the water is graded FOR the photographed eye rather than around it. Every number is read off the engine's own seams at the instant of the capture.",
  defaultBefore: "local",
  urlParams: { mode: "sharksim", seed: "90210", bots: "30", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 300000,
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  metrics: {
    eyeDepthM: { label: "Eye below the surface at capture", unit: "m" },
    waterColumnM: { label: "Water column at the photographed ring", unit: "m", better: "higher" },
    seabedY: { label: "World Y of the sea bed there", unit: "m", better: "lower" },
    fogFarM: { label: "How far you can see through the medium", unit: "m" },
    fogColor: { label: "The colour of the water column" },
    sunIntensity: { label: "Sun intensity while submerged", unit: "x", better: "lower" },
    hemiIntensity: { label: "Ambient intensity while submerged", unit: "x", better: "lower" },
    submerged: { label: "cityCameraSubmerged() at capture", better: "higher" },
  },
  metricsNote: "Eye depth proves both sides photographed the same place. The water column is the bathymetry change itself; the sun and ambient intensities are the light change (nothing in the engine had ever dimmed them for a diver, which is why the pale bed clipped toward white).",
  subjects,
  stage: stageIslandUnderwater,
};
