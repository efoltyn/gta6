/* SHARK SIGHT — HOW FAR CAN YOU SEE, AND IN WHICH DIRECTION?

   Owner, 2026-08-29: "in shark game when shark is above water it can see
   sharks super far away who are also above water, good — but when my shark
   dives and goes underwater, its seeing other sharks and fish distance is
   small af ... i feel like oh wow a shark is at sea level and then i dive and
   i cant see the shark anymore when its decently close."

   Both columns boot the same game on the same island with the same seed and
   stage the SAME GEOMETRY: a real rival great white, placed at a real range
   on a real bearing from the live eye, photographed through the live water.
   The only thing that differs is the sighting model underneath.

   BEFORE  fog.far ramped 40 -> 16 m off the COLOUR grade (which is 72% the
           eye's own depth), times a look-up bonus keyed on camera PITCH that
           faded out as you descended, times a 0.62 quality floor. Isotropic:
           one range for every direction, so the water was a sphere.
   AFTER   fog.far is R0 = ln(C0/eps)/c out of Duntley's contrast
           transmittance law, solved from the medium's own optics; the
           DIRECTION half, R(u) = R0/(1 - (Kd/c)u), is evaluated per fragment
           in core/renderer.js against the actual bearing of what you are
           looking at.

   EVERY NUMBER IS TAKEN OFF THE FRAMEBUFFER OR OFF THE ENGINE, ON BOTH SIDES,
   BY THE SAME CODE. The headline metric is not a config value: it is
   `peakDelta255`, the strongest difference in any channel between the animal
   and the water immediately around it, read back with gl.readPixels from the
   very frame that was photographed. A model that claims a shark is visible
   while the framebuffer says "flat medium" is caught here.
*/
import { baselineBuild } from "../ba-lib/head-build.mjs";

const subjects = [
  {
    id: "the-complaint",
    label: "A Shark At The Surface, Seen From Twenty Metres Down",
    focus: "The owner's sentence, staged exactly: the eye 20 m under, a great white near the waterline 23 m away on a line of sight running 70% upward. BEFORE: the fog range at that depth is 16 m before the quality floor takes it lower, the look-up bonus has already faded itself out with depth, and the animal is 100% medium — it is not dim, it is GONE. AFTER: the same animal is inside R(u) = R0/(1 - kappa u), because the water between you and the surface is shallower than the water at your eye and Duntley's law says a silhouette there gains contrast rather than losing it.",
  },
  {
    id: "level",
    label: "Level: A Shark Beside You",
    focus: "The control. Same depth, same range, u = 0 — the one direction where the new model has no directional term at all and the whole difference is the RANGE. BEFORE: 16 m of water graded off the colour ramp. AFTER: 30 m solved from c = 0.127/m, which is what a diver means by 'about thirty metre viz'.",
  },
  {
    id: "the-ambush",
    label: "From Below: The One You Are Not Supposed To See",
    focus: "A great white 21 m away and 17 m BELOW, rising. This is the beat where the new model is deliberately STINGIER than the old one: looking down, the background is darker than the water your eye is adapted to, the contrast decays at (c + Kd) instead of (c - Kd), and the range is 22 m against 45 m looking up. That asymmetry is the point — it is why the shark from below is the one that gets you, and the old isotropic sphere could not express it in either direction.",
  },
  {
    id: "the-ceiling",
    label: "The Column, Looking Up From The Deep",
    focus: "No target: the water itself, from 26 m down, lens on the surface. Ref 5's whole subject is a bright rippling ceiling seen from below, and with a 16 m isotropic range the surface sat past the fog limit and was never drawn at all — the bonus that was supposed to reach it was multiplied by (1 - depth/26 * 0.85) and had switched itself off by the time you were deep enough to want it. Also the beat where the DOM veil shows: at the deep grade it was 96% opaque, i.e. the rendered frame reached the screen at four percent.",
  },
  {
    id: "the-sea",
    label: "The Whole Sea, From The Deck Of The Dive",
    focus: "Nothing staged and nothing moved — the live match, the live population, one lens. The number under it is a census: of every marine body alive right now, how many are inside their own directional sighting range. That is the closest thing to 'how much ocean can I see' that a single integer can be.",
  },
];

async function stageSharkSight(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  Math.random = (function (s) { return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(20260829);

  let D = window.__sharkSight;
  if (!D) {
    D = window.__sharkSight = {
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },
      keys(o) {
        const k = CBZ.keys; if (!k) return;
        k.w = k.a = k.s = k.d = k.shift = k.control = k.c = false; k[" "] = false;
        for (const n in o) k[n] = o[n];
      },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },
      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]'); if (mb) mb.click();
          const pb = document.getElementById("playBtn"); if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 90 && !D.armed(); t++) { D.step(15); await sleep(20); }
        if (!D.armed()) return false;
        D._raf = window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => D._raf.call(window, () => res()));
        return true;
      },
      /* ONE READER FOR BOTH BUILDS. HEAD has no CBZ.waterSight and no
         anisotropy, so the honest shim is kappa = 0 and rangeAt(u) = fog.far
         for every u — which is exactly what that build does. Both columns are
         then measured by the same ruler instead of by their own audits. */
      sight() {
        const f = CBZ.scene && CBZ.scene.fog;
        const ws = CBZ.waterSight;
        const far = f ? f.far : 0;
        const aniso = ws ? ws.aniso : 0, sil = ws ? ws.sil : 0;
        return {
          far: far, near: f ? f.near : 0, aniso: aniso, sil: sil,
          c: ws ? ws.c : null, kd: ws ? ws.kd : null, eps: ws ? ws.eps : null,
          rangeAt: function (u) {
            const uu = Math.max(-1, Math.min(1, u || 0));
            return far / Math.max(0.30, (1 - aniso * uu) * (1 + sil * Math.max(0, -uu)));
          },
        };
      },
      /* Stand the ride in a column at least `want` deep, out along the bearing
         it already sits on, so a dive is a dive and not a bed clamp. */
      offshore(want) {
        const A = CBZ.surv.arena, P = CBZ.player;
        const ang = Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
        const wl = (CBZ.sharkSim && CBZ.sharkSim.waterline) || A.radius;
        let best = null, bestD = -1;
        for (let r = wl + 30; r < wl + 900; r += 8) {
          const x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
          const d = CBZ.survFloodDepthMeanAt ? CBZ.survFloodDepthMeanAt(x, z) : 0;
          if (d > bestD) { bestD = d; best = { x: x, z: z }; }
          if (d >= want) { P.pos.x = x; P.pos.z = z; D.step(4); return d; }
        }
        if (best) { P.pos.x = best.x; P.pos.z = best.z; D.step(6); }
        return bestD;
      },
      diveTo(m, maxSec) {
        D.keys({ control: true, w: true });
        const cap = Math.max(1, Math.round((maxSec == null ? 26 : maxSec) * 30));
        for (let i = 0; i < cap; i++) {
          D.step(1);
          if ((CBZ.cityCameraDepth ? CBZ.cityCameraDepth() : 0) >= m) break;
        }
        D.keys({});
        D.step(3);
        return CBZ.cityCameraDepth ? CBZ.cityCameraDepth() : 0;
      },
      /* NOTHING WITH TEETH IS HUNTING RIGHT NOW, and nothing is teleported to
         achieve it — a beat about SIGHT must not become a beat about a pod
         that arrived mid-capture, but a predator thrown into the deep ocean
         poisons every later subject in the run (see shark-dive.mjs). */
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (a.dead || !a.species) continue;
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
      eye() { return new T.Vector3().setFromMatrixPosition(CBZ.camera.matrixWorld); },
      fwdXZ() {
        const e = CBZ.camera.matrixWorld.elements;
        const fx = -e[8], fz = -e[10], fl = Math.hypot(fx, fz) || 1;
        return { x: fx / fl, z: fz / fl };
      },
      /* PUT A REAL RIVAL AT A REAL BEARING AND RANGE FROM THE LIVE EYE and aim
         the lens at it. `up` is the upward component of the unit direction
         from the eye to the animal — the u in Duntley's law — so (23, 0.70) is
         literally "a shark near the surface, from a deep eye, decently
         close". Identical on both columns: the staging never reads the model
         it is testing. */
      place(id, range, up) {
        /* BUILD THE ANIMAL FIRST, THEN READ THE EYE, THEN PLACE IT. Order is
           load-bearing and it cost two runs to see why.

           A freshly cityWildlifeSpawnAt'd animal has NO BODY: wildlife.js
           builds meshes on a per-tick budget, so the group that comes back is
           an empty Object3D for the first few ticks — and an empty Box3
           centres at (Inf, Inf, Inf), which is how the FIRST subject of a run
           measured null while every later subject, reusing the animal built
           for the first, measured fine.

           The obvious fix — spawn, then step until it has geometry — is worse,
           because stepping is what MOVES THE CAMERA. Compute the target point
           from an eye position, then step for three seconds, and the point you
           computed is now three seconds behind the lens and often behind the
           camera entirely. So: get a built body, and only then read the eye. */
        let a = null;
        for (const w of CBZ.cityWildlife || []) {
          if (w && !w.dead && !w.ridden && !w.external && w.species && w.species.id === id && w.grow == null) { a = w; break; }
        }
        if (!a && CBZ.cityWildlifeSpawnAt) {
          const P = CBZ.player.pos;
          a = CBZ.cityWildlifeSpawnAt(id, P.x + 30, P.z + 30);
          for (let t = 0; t < 40 && a && a.group && !a.group.children.length; t++) D.step(2);
        }
        if (!a || !a.group || !a.group.children.length) return null;
        const eye = D.eye(), f = D.fwdXZ();
        const hz = Math.sqrt(Math.max(0, 1 - up * up));
        const p = new T.Vector3(eye.x + f.x * hz * range, eye.y + up * range, eye.z + f.z * hz * range);
        a.pos.x = p.x; a.pos.z = p.z;
        if (a.pos.y != null) a.pos.y = p.y;
        if (a.home) { a.home.x = p.x; a.home.z = p.z; }
        if (a._waterMove) { a._waterMove.x = p.x; a._waterMove.z = p.z; }
        a.hunger = 0;
        a.group.visible = true;
        a.group.matrixAutoUpdate = true;
        a.group.position.set(p.x, p.y, p.z);
        a.group.rotation.y = Math.atan2(f.x, f.z) + Math.PI / 2;   // flank to the lens
        a.group.updateMatrixWorld(true);
        const cam = CBZ.camera;
        cam.up.set(0, 1, 0);
        cam.lookAt(p);
        cam.updateMatrixWorld(true);
        D.subject = a;
        return { a: a, p: p, range: eye.distanceTo(p), up: up };
      },
      /* HOW MUCH OF THE ANIMAL REACHES THE SCREEN. Render, read the
         framebuffer back, and compare the disc the animal subtends against a
         ring of the water immediately outside it — which is exactly what its
         contrast is judged against, by Duntley and by an eye. Returns nulls
         rather than zeros when the animal is off screen, so a staging failure
         can never be read as a visibility result. */
      measure(placed) {
        const cam = CBZ.camera, R = CBZ.renderer;
        if (!placed || !R) return { peak: null };
        R.render(CBZ.scene, cam);
        const gl = R.getContext();
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
        const box = new T.Box3().setFromObject(placed.a.group);
        if (box.isEmpty()) return { peak: null, why: "the animal has no geometry" };
        const c = box.getCenter(new T.Vector3());
        const rad = Math.max(0.6, box.getSize(new T.Vector3()).length() * 0.5);
        if (!Number.isFinite(c.x) || !Number.isFinite(rad)) return { peak: null, why: "non-finite bounds" };
        const ndc = c.clone().project(cam);
        if (!(ndc.z < 1)) return { peak: null, why: "behind the camera or past the far plane" };
        const px = Math.round((ndc.x * 0.5 + 0.5) * W), py = Math.round((ndc.y * 0.5 + 0.5) * H);
        const dist = c.distanceTo(D.eye());
        const rpx = Math.max(6, Math.round(H * (rad / Math.max(0.5, dist)) / (2 * Math.tan(cam.fov * Math.PI / 360))));
        const half = Math.min(Math.floor(Math.min(W, H) / 2) - 2, Math.round(rpx * 1.9));
        const x0 = Math.max(0, px - half), y0 = Math.max(0, py - half);
        const w = Math.min(W - x0, half * 2), h = Math.min(H - y0, half * 2);
        if (w < 8 || h < 8) return { peak: null, why: "subtends " + w + "x" + h + " px" };
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const outR0 = rpx * 1.35, outR1 = rpx * 1.85, ring = [[], [], []];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const dd = Math.hypot((x0 + x) - px, (y0 + y) - py);
          if (dd < outR0 || dd > outR1) continue;
          const i = (y * w + x) * 4;
          ring[0].push(buf[i]); ring[1].push(buf[i + 1]); ring[2].push(buf[i + 2]);
        }
        if (ring[0].length < 24) return { peak: null, why: "no background ring on screen" };
        const med = ring.map((v) => { v.sort((a, b) => a - b); return v[v.length >> 1]; });
        let peak = 0, over = 0, inside = 0, sum = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (Math.hypot((x0 + x) - px, (y0 + y) - py) > rpx) continue;
          const i = (y * w + x) * 4;
          const d = Math.max(Math.abs(buf[i] - med[0]), Math.abs(buf[i + 1] - med[1]), Math.abs(buf[i + 2] - med[2]));
          inside++; sum += d;
          if (d > peak) peak = d;
          if (d >= 3) over++;
        }
        return {
          peak: peak, mean: +(sum / Math.max(1, inside)).toFixed(2),
          lit: +(100 * over / Math.max(1, inside)).toFixed(1), bg: med,
        };
      },
      /* THE CENSUS. Of every marine body alive right now, how many are inside
         their own directional sighting range? One integer for "how much ocean
         can I see", and it is computed the same way on both builds. */
      census() {
        const s = D.sight(), eye = D.eye();
        let seen = 0, sharks = 0, total = 0, sharkTotal = 0;
        for (const a of CBZ.cityWildlife || []) {
          if (!a || a.dead || a.ridden || !a.species || !a.species.aquatic || !a.group) continue;
          const g = a.group.position;
          const dx = g.x - eye.x, dy = g.y - eye.y, dz = g.z - eye.z;
          const d = Math.hypot(dx, dy, dz);
          if (!(d > 0.01)) continue;
          const toothy = (a.species.bite || 0) >= 24;
          total++; if (toothy) sharkTotal++;
          if (d < s.rangeAt(dy / d)) { seen++; if (toothy) sharks++; }
        }
        return { seen: seen, sharks: sharks, total: total, sharkTotal: sharkTotal };
      },
      clearBanner() {
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "0"; }
      },
    };
    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (!CBZ.renderer) return;
        const raf = D._raf;
        if (raf) {
          await new Promise((res) => raf.call(window, () => { CBZ.renderer.render(CBZ.scene, CBZ.camera); res(); }));
        } else CBZ.renderer.render(CBZ.scene, CBZ.camera);
        await new Promise((r) => setTimeout(r, 1200));
      },
      advance(sec) { D.sec(sec); },
    };
  }

  if (!D.booted) {
    D.booted = await D.boot();
    if (!D.booted) return { ok: false, error: "sharksim never armed" };
  }
  D.clearBanner();
  D.keys({});
  D.subject = null;
  const out = {};

  D.peace();
  out.columnDepthM = +D.offshore(40).toFixed(1);

  /* THE STAGING RANGES ARE CHOSEN, NOT ARBITRARY, and they are the same
     metres on both columns. Each sits OUTSIDE the old build's isotropic range
     (~14 m at these depths once the quality floor has had its share) and
     INSIDE the new build's range along that particular bearing — the whole
     claim, laid out as a distance a tape measure could check:

       beat            range   u      old sees   new sees along u
       the-complaint    30 m   +0.72    14 m        48.8 m
       level            24 m    0.00    14 m        36.1 m
       the-ambush       18 m   -0.78    14 m        21.4 m   (deliberately tight)

     Nothing is placed at the vanishing point: an early cut staged the level
     beat at 24 m against a 24.2 m range and photographed a shark that was
     99.8% fogged on the side that was supposed to show it. And the eye depths
     keep every target in water — at u = 0.72 and 30 m the animal sits 21.6 m
     above the lens, so a 20 m eye would have put a great white in the sky. */
  const GEOM = {
    "the-complaint": { eye: 22, range: 30, up: 0.72 },
    "level":         { eye: 22, range: 24, up: 0.00 },
    "the-ambush":    { eye: 14, range: 18, up: -0.78 },
    "the-ceiling":   { eye: 26, range: 0,  up: 1.00 },
    "the-sea":       { eye: 16, range: 0,  up: 0.30 },
  };

  const g = GEOM[sub.id] || GEOM.level;
  out.eyeDepthM = Math.round(D.diveTo(g.eye, 30));
  out.cameraSubmerged = !!(CBZ.cityCameraSubmerged && CBZ.cityCameraSubmerged());

  const s = D.sight();
  out.sightLevelM = +s.rangeAt(0).toFixed(2);
  out.sightUpM = +s.rangeAt(1).toFixed(2);
  out.sightDownM = +s.rangeAt(-1).toFixed(2);
  out.upOverDown = +(s.rangeAt(1) / Math.max(0.01, s.rangeAt(-1))).toFixed(2);
  out.aniso = +s.aniso.toFixed(3);
  out.silhouette = +s.sil.toFixed(3);
  out.fogNearM = +s.near.toFixed(2);
  out.veilOpacityPct = (function () {
    const el = document.getElementById("cbzUnderwater");
    return el ? +(100 * (+el.style.opacity || 0)).toFixed(1) : null;
  })();

  if (g.range > 0) {
    const placed = D.place("great_white_shark", g.range, g.up);
    if (!placed) return { ok: false, error: "no great white to stage" };
    out.targetRangeM = +placed.range.toFixed(2);
    out.targetU = +g.up.toFixed(2);
    out.sightAtTargetM = +s.rangeAt(g.up).toFixed(2);
    const m = D.measure(placed);
    out.peakDelta255 = m.peak;
    out.meanDelta255 = m.mean == null ? null : m.mean;
    out.litPct = m.lit == null ? null : m.lit;
    out.mediumRGB = m.bg ? m.bg.join(",") : (m.why || null);
  } else {
    // no target: aim the lens by hand and photograph the water itself
    const eye = D.eye(), f = D.fwdXZ();
    const hz = Math.sqrt(Math.max(0, 1 - g.up * g.up));
    CBZ.camera.up.set(0, 1, 0);
    CBZ.camera.lookAt(new T.Vector3(eye.x + f.x * hz * 30, eye.y + g.up * 30, eye.z + f.z * hz * 30));
    CBZ.camera.updateMatrixWorld(true);
  }

  const cen = D.census();
  out.seaBodiesInSight = cen.seen;
  out.seaBodiesAlive = cen.total;
  out.sharksInSight = cen.sharks;

  return {
    ok: true,
    debug: {
      mode: CBZ.game.mode, state: CBZ.game.state,
      hasWaterSight: !!CBZ.waterSight,
      c: s.c, kd: s.kd,
      qualityLevel: CBZ.qualityLevel,
      errs: (window.__baErrs || []).slice(0, 8),
    },
    metrics: out,
  };
}

export default {
  id: "shark-sight",
  title: "Shark Sight — How Far You Can See, And In Which Direction",
  description: "The underwater sighting range rebuilt on Duntley's contrast-transmittance law. The old model took the range straight off the COLOUR grade, which is 72% the eye's own depth — so swimming down did not merely darken the water, it thickened it, from 40 m at the surface to 16 m in the deep (9.9 m once the quality floor had its share). It was also a sphere: one range for every direction, plus a look-up bonus keyed on camera pitch that faded itself out with depth, i.e. switched off exactly where the upward advantage is largest. The new range is R0 = ln(C0/eps)/c out of the medium's own optics, and the direction half — R(u) = R0/(1 - (Kd/c)u) — is evaluated per fragment in the fog shader against the real bearing of the thing you are looking at. A shark at the surface seen from twenty metres down is now the most visible animal in the sea, and a shark rising from below is the least, which is the right way round.",
  beforeLabel: "BEFORE · range off the colour grade, isotropic",
  afterLabel: "AFTER · R(u) = R0 / (1 - kappa u)",
  pairNote: "Same island · same seed · same 40 m column · same eye depth · same animal at the same range and bearing",
  method: "Both columns boot index.html?mode=sharksim and click the tile + PLAY like a player, then freeze the frame loop and advance the real match with CBZ.stepSim so a beat is a number of GAME seconds. The ride is stood in a 40 m column offshore and dives on its own DIVE key until the CAMERA reports the wanted depth (world/water_underwater.js's own eyeDepth seam, not a guess), and a real rival great white is then placed at a real range on a real bearing from the live eye — the same range and the same bearing on both sides. The visibility numbers are read off the framebuffer with gl.readPixels from the frame that was photographed: the animal's disc against a ring of the water immediately outside it, which is what its contrast is actually judged against. The range numbers come through one shim that works on both builds — HEAD has no anisotropy, so kappa is 0 and rangeAt(u) is fog.far for every u, which is exactly what that build does — so the two columns are measured by one ruler rather than by their own audits.",
  urlParams: { mode: "sharksim", seed: "90210", bots: "24", cfg_BOOT_METER: "0" },
  beforeParams: {},
  afterParams: {},
  async launchSides(ctx) {
    return baselineBuild(ctx, {
      owned: [
        "src/world/water_underwater.js",
        "src/core/renderer.js",
        "src/modes/shark_sim.js",
        "tools/visual-presets/shark-sight.mjs",
        "tools/shark-sight-check.mjs",
        "tools/ba-lib/head-build.mjs",
      ],
    });
  },
  initScript() {
    window.__baErrs = [];
    const keep = function (t) { try { if (window.__baErrs.length < 24) window.__baErrs.push(String(t).slice(0, 300)); } catch (e) {} };
    window.addEventListener("error", function (e) {
      keep((e && e.message) + " @" + ((e && e.filename) || "?").split("/").pop() + ":" + (e && e.lineno));
    });
    window.addEventListener("unhandledrejection", function (e) {
      keep("rejection: " + ((e && e.reason && e.reason.message) || (e && e.reason)));
    });
  },
  stageTimeoutMs: 300000,
  metrics: {
    peakDelta255: { label: "How much of the animal reaches the screen (peak channel delta vs the water around it)", unit: "/255", better: "higher" },
    meanDelta255: { label: "…averaged over the disc it subtends", unit: "/255", better: "higher" },
    litPct: { label: "Pixels of the animal that clear a visible step", unit: "%", better: "higher" },
    sightAtTargetM: { label: "Sighting range along THIS line of sight", unit: "m", better: "higher" },
    targetRangeM: { label: "How far away the animal actually is (staging)", unit: "m", better: "equal" },
    targetU: { label: "u — the upward component of the line of sight", better: "equal" },
    sightLevelM: { label: "Sighting range, level", unit: "m", better: "higher" },
    sightUpM: { label: "Sighting range, straight up", unit: "m", better: "higher" },
    sightDownM: { label: "Sighting range, straight down", unit: "m" },
    upOverDown: { label: "Up : down — the anisotropy, as one number", better: "higher" },
    aniso: { label: "The medium's own anisotropy coefficient (from Kd/c)", better: "higher" },
    silhouette: { label: "The looking-down contrast penalty (from C0)", better: "higher" },
    fogNearM: { label: "Where the water stops being glass", unit: "m" },
    veilOpacityPct: { label: "DOM veil over the rendered frame", unit: "%", better: "lower" },
    seaBodiesInSight: { label: "Marine bodies inside their own sighting range", better: "higher" },
    sharksInSight: { label: "…of which have teeth", better: "higher" },
    seaBodiesAlive: { label: "Marine bodies alive in the sea (staging)" },
    eyeDepthM: { label: "Camera below the surface at capture (staging)", unit: "m", better: "equal" },
    columnDepthM: { label: "Water column staged in (staging)", unit: "m", better: "equal" },
    cameraSubmerged: { label: "cityCameraSubmerged() at capture", better: "equal" },
    mediumRGB: { label: "The water immediately behind the animal" },
  },
  metricsNote: "peakDelta255 is the whole report: it is measured on the framebuffer, not asserted, and a value under about 5 is an animal that is not there as far as an eye is concerned. Every `equal` row is staging — the two columns put the same animal at the same range on the same bearing at the same eye depth, and a difference in any of them would mean the beats are not comparable, not that the change worked. sightDownM is scored neither way ON PURPOSE: shorter is CORRECT there. Looking down, the background is darker than the water your eye is adapted to, contrast decays at (c + Kd) instead of (c - Kd), and the shark rising from below is supposed to be the one you do not see. An isotropic sphere could not be wrong in that direction because it could not have a direction.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityCameraDepth && document.getElementById('playBtn')",
  subjects,
  stage: stageSharkSight,
};
