/* SHARK SIM — THE PLAY CAMERA. What the player actually sees while riding.

   Every frame here is the live chase camera, never a tripod: the page's own
   frame loop is frozen after boot and the real match is advanced with
   CBZ.stepSim, so both sides see identical inputs for identical game seconds.
   The before side is whatever build you point --before at (a git archive of
   the pre-change tree served on its own port is the honest one; the camera
   change is not flag-gated, git is the undo).

     node tools/visual-compare.mjs --preset shark-cam \
       --before http://127.0.0.1:PORT_OLD/ --after http://127.0.0.1:PORT_NEW/

   Five beats: a sprint into a hard turn, a surface cruise in chop (the
   waterline jitter test, as numbers), a bite, a bull shark ramming a boat,
   and a megalodon ramming a boat (the scale-aware boom). */

const subjects = [
  {
    id: "burst-turn",
    strip: { frames: 6, stepSec: 0.3 },
    label: "Sprint Into A Hard Turn",
    focus: "Cruise out to sea, then shift + D held from the first frame. The camera should let the body swing wide in frame and trail it round, stretch back and open the lens with speed, and bank a little with the turn — never snap, never lose the animal.",
  },
  {
    id: "surface-chop",
    strip: { frames: 4, stepSec: 0.5 },
    label: "Cruising The Surface",
    focus: "Four seconds at cruise with the back at the waterline, measured every tick: how many times the eye crossed the sea surface, how close it came to it, and how much the lens jerked. The waterline is the known pain point; this beat is the number for it.",
  },
  {
    id: "bite",
    strip: { frames: 5, stepSec: 0.12 },
    label: "A Bite Lands",
    focus: "A tuna in front of the mouth; the auto-bite fires on its own. Owner's doctrine: your own mouth gets no shake. AFTER: the lens leans in a few percent and narrows two degrees, eased; nothing vibrates.",
  },
  {
    id: "ram-boat",
    strip: { frames: 6, stepSec: 0.12 },
    label: "Bull Shark Rams A Boat",
    focus: "Sprint into a small craft. AFTER: one directional jolt into the impact that settles in about half a second, and a fifth of a second of slow-mo, refractory.",
  },
  {
    id: "megalodon-ram",
    strip: { frames: 5, stepSec: 0.2 },
    label: "Megalodon Rams A Boat",
    focus: "The same ram at the top of the ladder: the boom must hold the whole animal and the boat it is hitting in one frame.",
  },
];

async function stageSharkCam(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  Math.random = (function (s) { return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(20260927);

  let D = window.__sharkCam;
  if (!D) {
    D = window.__sharkCam = {
      samp: null,
      step(n) {
        for (let i = 0; i < n; i++) { CBZ.stepSim(1 / 30); if (D.samp) D.samp(); }
      },
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
        D.waterline = CBZ.sharkSim.waterline;
        // camera.js's 3.55 s arrival shot owns the lens first; photograph play, not it
        D.sec(4);
        D._rafOrig = window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => D._rafOrig.call(window, () => res()));
        return true;
      },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },
      playerAngle() {
        const A = CBZ.surv.arena, P = CBZ.player;
        return Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
      },
      offshore(extra, want) {
        const P = CBZ.player, A = CBZ.surv.arena, ang = D.playerAngle();
        let best = null, bestD = -1;
        for (let r = D.waterline + (extra || 20); r < D.waterline + 620; r += 6) {
          const p = { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
          const d = CBZ.survFloodDepthMeanAt ? CBZ.survFloodDepthMeanAt(p.x, p.z) : 0;
          if (d > bestD) { bestD = d; best = p; }
          if (d >= want) { P.pos.x = p.x; P.pos.z = p.z; D.step(4); return d; }
        }
        if (best) { P.pos.x = best.x; P.pos.z = best.z; D.step(4); }
        return bestD;
      },
      camYawAlong(h) { return Math.atan2(-Math.cos(h), -Math.sin(h)); },
      // steer out to sea (keys.w swims along cam.yaw), then let the view settle
      headOut(sec) {
        const A = CBZ.surv.arena, P = CBZ.player;
        const out = Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
        if (CBZ.cam) { CBZ.cam.yaw = D.camYawAlong(out); CBZ.cam.pitch = 0.46; }
        D.keys({ w: true });
        D.sec(sec == null ? 1.5 : sec);
        return out;
      },
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (a.dead || !a.species) continue;
          if (CBZ.sharkSim && a === CBZ.sharkSim.shark) continue;
          if (a.species.id === "orca" || (a.species.aquatic && (a.species.bite || 0) >= 24)) {
            a.hunger = 0;
            if (a._orca) { const s = a._orca; s.committed = false; s.interest = 0; s.quarry = null; s.rolling = 0; s.retreat = 0; s.act = ""; s.cool = 30; }
            if (a._shark) { a._shark.state = "cruise"; a._shark.bail = 6; }
            if (CBZ.predatorDisengage) { try { CBZ.predatorDisengage(a, 120); } catch (e) {} }
          }
        }
        if (CBZ.sharkSim) { const S = CBZ.sharkSim.shark; if (S) S.hp = S.maxHp; CBZ.sharkSim.podT = 120; }
      },
      clearBanner() {
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "0"; }
      },
      ahead(dist) {
        const S = CBZ.sharkSim.shark, P = CBZ.player, h = S.heading || 0;
        return { x: P.pos.x + Math.cos(h) * dist, z: P.pos.z + Math.sin(h) * dist, h };
      },
      audit() { return (CBZ.aquaticMountAudit && CBZ.aquaticMountAudit()) || {}; },
      boom() {
        const c = CBZ.camera.position, S = CBZ.sharkSim.shark, g = S.group.position;
        return Math.hypot(c.x - g.x, c.y - g.y, c.z - g.z);
      },
      // every-tick camera sampler: waterline crossings, closest approach, jerk
      sampler() {
        const st = { n: 0, cross: 0, near: 1e9, jerk: 0, side: 0, p1: null, p2: null };
        D.samp = function () {
          const c = CBZ.camera.position;
          const s = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(c.x, c.z) : 0;
          const d = c.y - s, side = d >= 0 ? 1 : -1;
          if (st.side && side !== st.side) st.cross++;
          st.side = side;
          st.near = Math.min(st.near, Math.abs(d));
          if (st.p1 && st.p2) {
            st.jerk += Math.hypot(c.x - 2 * st.p1.x + st.p2.x, c.y - 2 * st.p1.y + st.p2.y, c.z - 2 * st.p1.z + st.p2.z);
          }
          st.p2 = st.p1; st.p1 = { x: c.x, y: c.y, z: c.z };
          st.n++;
        };
        return st;
      },
      spawnCraftAhead(dist, keys) {
        if (!CBZ.seaCraft) return null;
        for (let k = 0; k < 10; k++) {
          const p = D.ahead(dist + k * 2);
          for (const key of keys) {
            let rec = null;
            try { rec = CBZ.seaCraft.spawn(key, p.x, p.z, p.h + Math.PI / 2, { crew: 1 }); } catch (e) {}
            if (rec) return rec;
          }
        }
        return null;
      },
      toMegalodon() {
        const sim = CBZ.sharkSim;
        for (let i = 0; i < 4 && sim.shark && sim.shark.species.id !== "megalodon"; i++) {
          sim.mass = 999;
          const P = CBZ.player;
          try { CBZ.sharkSimBite("survivor", { dead: true, hp: 0, maxHp: 100, pos: { x: P.pos.x, y: P.pos.y, z: P.pos.z } }, sim.shark); } catch (e) {}
          D.sec(1.6);
        }
        return sim.shark && sim.shark.species.id;
      },
    };
    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        D.clearBanner();
        const raf = D._rafOrig;
        if (raf) await new Promise((res) => raf.call(window, () => { CBZ.renderer.render(CBZ.scene, CBZ.camera); res(); }));
        else CBZ.renderer.render(CBZ.scene, CBZ.camera);
        await new Promise((r) => setTimeout(r, 1200));
      },
      advance(sec) { D.sec(sec); },
      metrics() {
        const o = { boomAtEndM: +D.boom().toFixed(2), fovAtEnd: +CBZ.camera.fov.toFixed(1) };
        if (D.st) {
          o.eyeCrossings = D.st.cross;
          o.eyeClosestToSurfaceM = +D.st.near.toFixed(2);
          o.lensJerkPerTickMM = D.st.n > 2 ? +((D.st.jerk / (D.st.n - 2)) * 1000).toFixed(1) : null;
        }
        return o;
      },
    };
  }

  if (!D.booted) {
    D.booted = await D.boot();
    if (!D.booted) return { ok: false, error: "sharksim never armed" };
  }
  D.keys({});
  D.st = null; D.samp = null;
  const out = {};

  if (sub.id === "burst-turn") {
    D.peace(); D.offshore(30, 14);
    D.headOut(2.0);
    D.st = D.sampler();
    D.keys({ w: true, shift: true, d: true });
    D.sec(0.4);
  } else if (sub.id === "surface-chop") {
    D.peace(); D.offshore(40, 14);
    D.headOut(2.0);
    D.st = D.sampler();
    D.keys({ w: true });
    D.sec(2.0);
  } else if (sub.id === "bite") {
    D.peace(); D.offshore(30, 12);
    D.headOut(2.0);
    D.keys({});
    D.sec(0.6);
    const S = CBZ.sharkSim.shark, p = D.ahead(4.5);
    const f = CBZ.cityWildlifeSpawnAt && CBZ.cityWildlifeSpawnAt("tuna", p.x, p.z);
    if (f) { f.pos.y = S.group.position.y; if (f.group) f.group.position.set(p.x, f.pos.y, p.z); f.hunger = 0; }
    const h0 = D.audit().hits || 0;
    D.st = D.sampler();
    D.keys({ w: true });
    let hit = false;
    for (let i = 0; i < 120 && !hit; i++) { D.step(1); hit = (D.audit().hits || 0) > h0; }
    out.biteLanded = hit ? 1 : 0;
  } else if (sub.id === "ram-boat" || sub.id === "megalodon-ram") {
    D.peace(); D.offshore(40, 14);
    if (sub.id === "megalodon-ram") { out.species = D.toMegalodon(); D.peace(); D.offshore(60, 18); }
    D.headOut(2.0);
    const S = CBZ.sharkSim.shark;
    const len = sub.id === "megalodon-ram" ? 30 : 16;
    const rec = D.spawnCraftAhead(len, sub.id === "megalodon-ram" ? ["cruiser", "boat", "skiff"] : ["skiff", "boat", "dinghy"]);
    out.craft = rec ? (rec.key || "craft") : "none";
    const s0 = D.audit().shipBites || 0;
    D.st = D.sampler();
    D.keys({ w: true, shift: true });
    let hit = false;
    for (let i = 0; i < 240 && !hit; i++) { D.step(1); hit = (D.audit().shipBites || 0) > s0; }
    out.hullHit = hit ? 1 : 0;
    out.species = S.species.id;
  } else return { ok: false, error: "unknown subject " + sub.id };

  out.boomM = +D.boom().toFixed(2);
  out.fov = +CBZ.camera.fov.toFixed(1);
  // who owns the lens at the capture (the after build publishes CBZ.sharkCam)
  out.rigOn = CBZ.sharkCam ? (CBZ.sharkCam.on ? 1 : 0) : null;
  out.firstPerson = CBZ.fps && CBZ.fps.active ? 1 : 0;
  out.introActive = CBZ.camIntroActive ? (CBZ.camIntroActive() ? 1 : 0) : null;
  out.state = CBZ.game.state + (CBZ.surv && CBZ.surv.spectating ? "/spectating" : "");
  await window.__cbzVisualCompare.render();
  return { ok: true, side: input.side, subject: sub.id, metrics: out };
}

export default {
  id: "shark-cam",
  title: "Shark Sim — The Play Camera",
  description: "The chase camera the player actually rides with, photographed through five beats: a sprint into a hard turn, a surface cruise (waterline jitter measured every tick), a bite, a bull shark ramming a boat and a megalodon ramming one.",
  beforeLabel: "BEFORE",
  afterLabel: "AFTER",
  pairNote: "Same seed · same inputs for the same simulated seconds · live chase camera, no tripods",
  method: "Both sides boot index.html?mode=sharksim exactly like a player, freeze the frame loop, and advance the real match with CBZ.stepSim at 30 Hz. Every frame is the live play camera. Waterline crossings, closest approach and lens jerk are sampled on every tick of the strip.",
  urlParams: { mode: "sharksim", seed: "90210", bots: "30", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 300000,
  metrics: {
    eyeCrossings: { label: "Times the eye crossed the sea surface during the strip", better: "lower" },
    eyeClosestToSurfaceM: { label: "Closest the eye came to the surface", unit: "m", better: "higher" },
    lensJerkPerTickMM: { label: "Lens jerk (mean 2nd difference per tick)", unit: "mm", better: "lower" },
    boomM: { label: "Eye to body at the first frame", unit: "m" },
    boomAtEndM: { label: "Eye to body at the last frame", unit: "m" },
    fov: { label: "Lens FOV at the first frame", unit: "deg" },
    fovAtEnd: { label: "Lens FOV at the last frame", unit: "deg" },
    biteLanded: { label: "The bite landed" },
    hullHit: { label: "The hull was hit" },
    craft: { label: "Craft rammed" },
    species: { label: "Ridden species" },
  },
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  subjects,
  stage: stageSharkCam,
};
