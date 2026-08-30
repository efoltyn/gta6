#!/usr/bin/env node
/* tools/shark-sight-check.mjs — HOW FAR CAN THE SHARK ACTUALLY SEE?

   The owner's complaint (2026-08-29): "when my shark dives and goes underwater,
   it's seeing other sharks and fish distance is small af ... a shark is at sea
   level and then I dive and I can't see the shark any more when it's decently
   close."

   So this tool measures exactly that, two ways, and asserts the physics rather
   than merely printing it:

     THE MODEL — world/water_underwater.js publishes CBZ.waterSight, which
       solves Duntley's contrast-transmittance law for this water:
         R(u) = ln(C0/eps) / (c - Kd*u),  u = the upward component of the line
       of sight. We read R at u = +1 / 0 / -1 at a ladder of eye depths.

     THE PIXELS — a real rival shark is placed at a real bearing and a real
       range in the live sea, the frame is rendered, and the framebuffer is
       READ BACK. The metric is how much of the animal survives to the screen:
       the peak |delta| against the water immediately around it, and the count
       of pixels that clear a visible step. A model that says "visible" while
       the framebuffer says "flat medium" is a model that is lying, and this
       is the only way to catch that.

   ASSERTS, NOT COMPARES (the seed.js minimiser lesson). Six invariants, each
   of which was false before this wave:
     1  no GLSL link/compile errors anywhere (diagnostics forced ON — this
        engine renders a broken shader SILENTLY)
     2  kappa is exactly 0 above water: a dry frame must be bit-identical
     3  looking UP sees further than level, which sees further than DOWN
     4  the water does not thicken as you descend: in clear sea the level
        range at 30 m is within 25% of the range at 2 m
     5  a shark near the surface, seen from a deep eye at a range the old
        build fogged out (22 m), reaches the screen with real contrast
     6  the shark-sim arrival ring still stands outside the longest sight line

     node tools/shark-sight-check.mjs
     node tools/shark-sight-check.mjs --json
     node tools/shark-sight-check.mjs --seed 90210 --deep 40
*/
import { launch, sleep, ROOT } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEED = arg("--seed", "90210");
const DEEP = +arg("--deep", "40");        // the water column to stage the dive in
const JSON_OUT = has("--json");
const say = (m) => { if (!JSON_OUT) console.log(m); };

const rig = await launch({ rafBudget: 0 });
const out = { seed: SEED, ladder: [], shots: [], fails: [], notes: [] };

try {
  await rig.open("index.html",
    `mode=sharksim&seed=${SEED}&bots=24&cfg_BOOT_METER=0&cfg_GFX_SHADER_DIAGNOSTICS=1`);
  if (!await rig.wait("window.CBZ && CBZ.stepSim && document.getElementById('playBtn')", 120000)) {
    throw new Error("page never became ready");
  }

  /* THE DRIVER lives in the page: one object, so every later eval is a method
     call rather than a fresh closure that has to re-find the world. */
  await rig.evl(`window.__SS = (() => {
    const T = window.THREE, sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const S = {
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      sec(s) { S.step(Math.max(1, Math.round(s * 30))); },
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
        for (let t = 0; t < 500 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]'); if (mb) mb.click();
          const pb = document.getElementById("playBtn"); if (pb) pb.click();
          await sleep(140);
        }
        if (CBZ.game.state !== "playing") return "never played";
        for (let t = 0; t < 90 && !S.armed(); t++) { S.step(15); await sleep(20); }
        if (!S.armed()) return "never armed";
        S._raf = window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => S._raf.call(window, () => res()));
        return "";
      },
      /* Stand the ride in a column at least \`want\` metres deep, out along the
         bearing it already sits on, so the dive is a dive and not a bed clamp. */
      offshore(want) {
        const A = CBZ.surv.arena, P = CBZ.player;
        const ang = Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
        const wl = (CBZ.sharkSim && CBZ.sharkSim.waterline) || A.radius;
        let best = null, bestD = -1;
        for (let r = wl + 30; r < wl + 900; r += 8) {
          const x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
          const d = CBZ.survFloodDepthMeanAt ? CBZ.survFloodDepthMeanAt(x, z) : 0;
          if (d > bestD) { bestD = d; best = { x: x, z: z }; }
          if (d >= want) { P.pos.x = x; P.pos.z = z; S.step(4); return d; }
        }
        if (best) { P.pos.x = best.x; P.pos.z = best.z; S.step(6); }
        return bestD;
      },
      // Hold DIVE until the CAMERA is at least \`m\` metres under, or give up.
      diveTo(m, maxSec) {
        S.keys({ control: true, w: true });
        const cap = Math.max(1, Math.round((maxSec == null ? 26 : maxSec) * 30));
        for (let i = 0; i < cap; i++) {
          S.step(1);
          if ((CBZ.cityCameraDepth ? CBZ.cityCameraDepth() : 0) >= m) break;
        }
        S.keys({});
        S.step(3);
        return CBZ.cityCameraDepth ? CBZ.cityCameraDepth() : 0;
      },
      /* ONE READER FOR BOTH BUILDS. A build without CBZ.waterSight (anything
         before 2026-08-29) has an isotropic fog and no anisotropy at all, so
         the honest shim is kappa = 0 and rangeAt(u) = fog.far for every u —
         which is precisely what that build does. That makes this tool
         runnable against HEAD as well as the working tree. */
      /* IS THE UNIFORM ACTUALLY REACHING THE GPU? This is the one thing in
         the whole wave that could fail SILENTLY and completely. cbzUwAniso
         is a uniform r128 will never upload on its own (it is not in any
         material's uniforms object), so core/renderer.js pushes it by walking
         the program cache and calling gl.uniform1f directly. If that walk
         finds nothing — wrong cache shape, uniform optimised out, a stale
         WebGLState — the uniform stays at its GLSL default of 0, the fog goes
         back to being a sphere, and EVERY OTHER NUMBER IN THIS TOOL STILL
         LOOKS RIGHT, because they are all read off the JS model.

         So: render the same frame twice, once with the anisotropy forced off
         and once with it forced hard on, and diff the pixels. Anything but a
         difference means the shader never got the value. */
      anisoProof() {
        const R = CBZ.renderer, gl = R && R.getContext();
        if (!gl || !CBZ.setFogAniso) return { ok: false, why: "no setFogAniso" };
        const W = Math.min(240, gl.drawingBufferWidth), H = Math.min(160, gl.drawingBufferHeight);
        const x0 = ((gl.drawingBufferWidth - W) >> 1), y0 = ((gl.drawingBufferHeight - H) >> 1);
        const grab = (k, sv) => {
          CBZ.setFogAniso(k, sv);
          R.render(CBZ.scene, CBZ.camera);
          const b = new Uint8Array(W * H * 4);
          gl.readPixels(x0, y0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
          return b;
        };
        const off = grab(0, 0), on = grab(0.6, 0.5);
        let peak = 0, moved = 0;
        for (let i = 0; i < off.length; i += 4) {
          const d = Math.max(Math.abs(off[i] - on[i]), Math.abs(off[i + 1] - on[i + 1]), Math.abs(off[i + 2] - on[i + 2]));
          if (d > peak) peak = d;
          if (d >= 2) moved++;
        }
        CBZ.setFogAniso(0, 0);   // leave it where the live pass will re-drive it
        return { ok: peak >= 3, peak: peak, movedPct: +(100 * moved / (W * H)).toFixed(1) };
      },
      sight() {
        const f = CBZ.scene && CBZ.scene.fog;
        const ws = CBZ.waterSight || {
          c: NaN, kd: NaN, aniso: 0, sil: 0, eps: NaN, lum: NaN,
          rangeAt: function () { return f ? f.far : 0; },
          maxRange: function () { return f ? f.far : 0; },
        };
        if (!f) return null;
        return {
          depthM: +(CBZ.cityCameraDepth ? CBZ.cityCameraDepth() : 0).toFixed(2),
          submerged: !!(CBZ.cityCameraSubmerged && CBZ.cityCameraSubmerged()),
          c: +ws.c.toFixed(4), kd: +ws.kd.toFixed(4),
          aniso: +ws.aniso.toFixed(4), sil: +ws.sil.toFixed(4),
          eps: +ws.eps.toFixed(4), lum: +ws.lum.toFixed(3),
          fogNear: f ? +f.near.toFixed(2) : null, fogFar: f ? +f.far.toFixed(2) : null,
          up: +ws.rangeAt(1).toFixed(2), level: +ws.rangeAt(0).toFixed(2),
          down: +ws.rangeAt(-1).toFixed(2),
        };
      },
      /* PLACE A RIVAL SHARK AT A REAL BEARING AND RANGE FROM THE LIVE EYE, aim
         the lens at it, render, and read the framebuffer back. \`up\` is the
         upward component of the direction from the eye to the animal, so
         (range 22, up 0.75) is literally the owner's sentence: a shark near the
         surface, seen from a deep eye, decently close. */
      shot(id, range, up, label) {
        const cam = CBZ.camera, R = CBZ.renderer;
        const eye = new T.Vector3().setFromMatrixPosition(cam.matrixWorld);
        // a horizontal bearing that is NOT the camera's own, so the animal is
        // found by aiming rather than by already filling the frame
        const e = cam.matrixWorld.elements;
        const fx = -e[8], fz = -e[10], fl = Math.hypot(fx, fz) || 1;
        const hz = Math.sqrt(Math.max(0, 1 - up * up));
        const p = new T.Vector3(
          eye.x + (fx / fl) * hz * range,
          eye.y + up * range,
          eye.z + (fz / fl) * hz * range);
        let a = null;
        for (const w of CBZ.cityWildlife || []) {
          if (w && !w.dead && !w.ridden && w.species && w.species.id === id && w.grow == null) { a = w; break; }
        }
        if (!a && CBZ.cityWildlifeSpawnAt) a = CBZ.cityWildlifeSpawnAt(id, p.x, p.z);
        if (!a || !a.group) return { label: label, error: "no " + id };
        a.pos.x = p.x; a.pos.z = p.z;
        if (a.home) { a.home.x = p.x; a.home.z = p.z; }
        if (a._waterMove) { a._waterMove.x = p.x; a._waterMove.z = p.z; }
        a.hunger = 0;
        a.group.visible = true;
        a.group.position.set(p.x, p.y, p.z);
        if (a.pos && a.pos.y != null) a.pos.y = p.y;
        a.group.matrixAutoUpdate = true;
        a.group.updateMatrixWorld(true);
        // face across the view so the flank is what is photographed
        a.group.rotation.y = Math.atan2(fx, fz) + Math.PI / 2;
        a.group.updateMatrixWorld(true);
        cam.up.set(0, 1, 0);
        cam.lookAt(p);
        cam.updateMatrixWorld(true);
        R.render(CBZ.scene, CBZ.camera);
        const gl = R.getContext();
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
        // where the animal landed on screen, and how big it is
        const box = new T.Box3().setFromObject(a.group);
        const c = box.getCenter(new T.Vector3());
        const rad = Math.max(0.6, box.getSize(new T.Vector3()).length() * 0.5);
        const ndc = c.clone().project(cam);
        const px = Math.round((ndc.x * 0.5 + 0.5) * W), py = Math.round((ndc.y * 0.5 + 0.5) * H);
        // angular radius -> pixel radius, through the vertical FOV
        const dist = c.distanceTo(eye);
        const rpx = Math.max(6, Math.round(H * (rad / Math.max(0.5, dist)) / (2 * Math.tan(cam.fov * Math.PI / 360))));
        const half = Math.min(Math.floor(Math.min(W, H) / 2) - 2, Math.round(rpx * 1.9));
        const x0 = Math.max(0, px - half), y0 = Math.max(0, py - half);
        const w = Math.min(W - x0, half * 2), h = Math.min(H - y0, half * 2);
        if (w < 8 || h < 8 || ndc.z > 1) return { label: label, error: "off screen", ndc: [ndc.x, ndc.y, ndc.z] };
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        /* THE BACKGROUND IS THE RING, not a guess at the medium colour: the
           water immediately around the animal is exactly what its contrast is
           judged against, both by Duntley and by an eye. */
        const inR = rpx, outR0 = rpx * 1.35, outR1 = rpx * 1.85;
        const ring = [[], [], []];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const dx = (x0 + x) - px, dy = (y0 + y) - py, d = Math.hypot(dx, dy);
          if (d < outR0 || d > outR1) continue;
          const i = (y * w + x) * 4;
          ring[0].push(buf[i]); ring[1].push(buf[i + 1]); ring[2].push(buf[i + 2]);
        }
        if (ring[0].length < 24) return { label: label, error: "no background ring" };
        const med = ring.map((v) => { v.sort((a, b) => a - b); return v[v.length >> 1]; });
        let peak = 0, over = 0, inside = 0, sum = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const dx = (x0 + x) - px, dy = (y0 + y) - py;
          if (Math.hypot(dx, dy) > inR) continue;
          const i = (y * w + x) * 4;
          const dR = Math.abs(buf[i] - med[0]), dG = Math.abs(buf[i + 1] - med[1]), dB = Math.abs(buf[i + 2] - med[2]);
          const d = Math.max(dR, dG, dB);
          inside++; sum += d;
          if (d > peak) peak = d;
          if (d >= 3) over++;              // ~1.2% of range: a step an eye resolves
        }
        return {
          label: label, species: id,
          rangeM: +dist.toFixed(2), up: +up.toFixed(3),
          sightRangeM: +CBZ.waterSight.rangeAt(up).toFixed(2),
          peak255: peak, meanDelta255: +(sum / Math.max(1, inside)).toFixed(2),
          litPct: +(100 * over / Math.max(1, inside)).toFixed(1),
          bgRGB: med, pxBox: [w, h], rpx: rpx,
        };
      },
    };
    return S;
  })();`);

  const bootErr = await rig.evl("window.__SS.boot()", true);
  if (bootErr) throw new Error("sharksim: " + bootErr);
  say("[boot] sharksim armed");

  // ---- above water: the anisotropy must be exactly off -------------------
  const dry = await rig.evl("(()=>{ const w = CBZ.waterSight; return { kappa: w.aniso + w.sil, sub: !!(CBZ.cityCameraSubmerged&&CBZ.cityCameraSubmerged()), far: CBZ.scene.fog.far }; })()");
  out.dry = dry;

  const col = await rig.evl(`window.__SS.offshore(${DEEP})`);
  out.columnM = +(+col).toFixed(1);
  say(`[stage] water column ${out.columnM} m`);

  // ---- the ladder: does the water thicken as you go down? ----------------
  for (const want of [2, 8, 16, 26, 36]) {
    const got = await rig.evl(`window.__SS.diveTo(${want}, 30)`);
    const s = await rig.evl("window.__SS.sight()");
    if (!s) throw new Error("no scene fog at all — did the dive land in water?");
    s.wantM = want; s.gotM = +(+got).toFixed(2);
    out.ladder.push(s);
    say(`[ladder] eye ${String(s.depthM).padStart(5)} m   level ${String(s.level).padStart(6)} m` +
        `   up ${String(s.up).padStart(6)} m   down ${String(s.down).padStart(6)} m   eps ${s.eps}  lum ${s.lum}`);
  }

  // ---- the owner's sentence, in pixels -----------------------------------
  const deepEye = await rig.evl("window.__SS.diveTo(20, 30)");
  out.shotEyeM = +(+deepEye).toFixed(2);
  const SHOTS = [
    ["great_white_shark", 22, 0.75, "surface shark, decently close (the complaint)"],
    ["great_white_shark", 30, 0.60, "surface shark, further out"],
    ["great_white_shark", 24, 0.00, "level: a shark beside you"],
    ["great_white_shark", 22, -0.80, "the ambush: a shark below you"],
  ];
  for (const [id, r, u, label] of SHOTS) {
    const s = await rig.evl(`window.__SS.shot(${JSON.stringify(id)}, ${r}, ${u}, ${JSON.stringify(label)})`);
    out.shots.push(s);
    if (s.error) say(`[shot] ${label}: ${s.error}`);
    else say(`[shot] ${label}\n        range ${s.rangeM} m  u ${s.up}  model says ${s.sightRangeM} m` +
             `  ->  peak ${s.peak255}/255  mean ${s.meanDelta255}/255  lit ${s.litPct}%`);
  }

  // aim UP, where the anisotropy has the most to say, before proving it
  await rig.evl(`(()=>{ const c = CBZ.camera, T = window.THREE;
    const e = c.matrixWorld.elements, fx = -e[8], fz = -e[10], fl = Math.hypot(fx, fz) || 1;
    const p = new T.Vector3().setFromMatrixPosition(c.matrixWorld);
    c.up.set(0,1,0);
    c.lookAt(new T.Vector3(p.x + (fx/fl)*14, p.y + 26, p.z + (fz/fl)*14));
    c.updateMatrixWorld(true); })()`);
  out.anisoProof = await rig.evl("window.__SS.anisoProof()");
  say(`[shader] forcing kappa 0 -> 0.6 moves ${out.anisoProof.movedPct}% of the frame, ` +
      `peak ${out.anisoProof.peak}/255`);

  out.arrivalFloorM = await rig.evl("(()=>{ try { return +CBZ.waterSight.maxRange().toFixed(2); } catch(e) { return null; } })()");
  out.shaderErrors = (rig.errors || []).filter((e) => /shader|GLSL|link|compile|program/i.test(String(e)));
  out.errors = (rig.errors || []).slice(0, 12);

  // ---- the assertions ----------------------------------------------------
  const fail = (m) => out.fails.push(m);
  if (out.shaderErrors.length) fail(`GLSL: ${out.shaderErrors[0]}`);
  if (!out.anisoProof || !out.anisoProof.ok) {
    fail("cbzUwAniso never reached the GPU — forcing it off -> on changed " +
      `${(out.anisoProof && out.anisoProof.peak) || 0}/255 of the frame. The fog is still a sphere.`);
  }
  if (dry && dry.sub === false && Math.abs(dry.kappa) > 1e-9) fail(`dry kappa is ${dry.kappa}, must be exactly 0`);
  const deep = out.ladder[out.ladder.length - 1], shallow = out.ladder[0];
  for (const s of out.ladder) {
    if (!s.submerged) continue;
    if (!(s.up > s.level * 1.05)) fail(`at ${s.depthM} m: up ${s.up} is not further than level ${s.level}`);
    if (!(s.down < s.level * 0.95)) fail(`at ${s.depthM} m: down ${s.down} is not shorter than level ${s.level}`);
  }
  if (shallow && deep && deep.submerged && shallow.submerged) {
    const keep = deep.level / Math.max(1e-6, shallow.level);
    out.depthKeepPct = +(100 * keep).toFixed(1);
    if (keep < 0.75) fail(`the water thickened with depth: level range kept only ${out.depthKeepPct}% ` +
      `from ${shallow.depthM} m to ${deep.depthM} m`);
  }
  const hero = out.shots[0];
  if (hero && !hero.error) {
    if (!(hero.peak255 >= 12)) fail(`the complaint shot peaks at ${hero.peak255}/255 — still invisible`);
    if (!(hero.litPct >= 8)) fail(`the complaint shot lights only ${hero.litPct}% of the animal`);
  } else fail("the complaint shot never landed: " + (hero && hero.error));
  /* THE MODE'S OWN ANSWER, not a copy of it. This used to re-type
     shark_sim.js's clamp — max(45, min(72, sight * 1.22)) — and when the water
     got clearer and the clamp moved with it, the tool failed a build that was
     right. modes/shark_sim.js publishes arrivalFloor() now; the literal
     survives only as the reading for a build from before it did. */
  const floor = await rig.evl(`(()=>{ try { return +CBZ.sharkSimArrivalFloor().toFixed(2); } catch(e) { return null; } })()`)
    ?? Math.max(45, Math.min(72, (out.arrivalFloorM || 0) * 1.22));
  out.spawnFloorM = +floor.toFixed(2);
  if (out.ladder.some((s) => s.submerged && s.up > floor + 0.01)) {
    fail(`a sight line (${Math.max(...out.ladder.map((s) => s.up))} m) runs past the arrival ring ` +
      `(${out.spawnFloorM} m) — schools will be watched to appear`);
  }
} catch (err) {
  out.fails.push(String((err && err.message) || err));
} finally {
  await rig.close();
}

if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
else {
  console.log("");
  if (out.depthKeepPct != null) console.log(`  depth keeps ${out.depthKeepPct}% of the level sighting range`);
  if (out.arrivalFloorM != null) console.log(`  longest sight line ${out.arrivalFloorM} m; arrivals stand outside it`);
  console.log(out.fails.length ? "\nFAIL\n  " + out.fails.join("\n  ") : "\nPASS — every invariant held");
}
process.exit(out.fails.length ? 1 : 0);
