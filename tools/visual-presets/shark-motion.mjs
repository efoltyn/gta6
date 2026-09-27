/* Shark Sim — HOW THINGS MOVE. Film strips of the animation, both builds.

   Owner (2026-09-27): "massively improve the shark game ... the animation".
   A still cannot show a tail beat, a glide or a head-shake, so every subject
   here is a STRIP: the staged frame plus N-1 more, each one a fixed slice of
   simulated time later (the runner's __cbzVisualCompare.advance hook), with
   the lens re-aimed at the moving body after every sim step. Both columns
   run this same driver on the same seed with the same keys.

     cruise   great white, W only: the lazy beat
     burst    shift from cruise: the kick-off (amplitude + frequency)
     glide    keys released from a sprint: tail quiet, pectorals flare
     turn     a hard carve from behind: bank into the turn, fins working
     bite     a swimmer ahead, the auto-bite: gape, lunge, head-shake
     swimmers eight people in four metres of water swimming for the beach
     flee     the same eight with the shark coming: frantic crawl, look back
     death    a wild great white killed in front of the lens: limp, roll, sink

   HARNESS TRAPS (learned by shark-swimmers.mjs / shark-breach.mjs):
     1. stage() is SERIALIZED into the page; it has no module scope.
     2. camera.js re-stamps the lens at onAlways(50) inside CBZ.stepSim, so the
        tripod is re-aimed AFTER every step, never before.
     3. requestAnimationFrame is drained and stubbed so only the driver steps.
*/

const subjects = [
  { id: "cruise", kind: "ride", label: "Cruise: the lazy beat", strip: { frames: 8, stepSec: 0.1 },
    focus: "Great white at cruise (W only), lens abeam at body depth. Look at the tail sweep between frames and the head counter-yaw. AFTER: slower, shallower sweeps at cruise, a head that yaws against the tail, and periodic coasts." },
  { id: "burst", kind: "ride", label: "Burst: the kick-off", strip: { frames: 8, stepSec: 0.1 },
    focus: "Shift pressed from cruise on the first frame. AFTER: the tail beats deep and fast from the first frame of acceleration (it used to wait until distance had been covered), pectorals sweep back." },
  { id: "glide", kind: "ride", label: "Glide: keys released from a sprint", strip: { frames: 8, stepSec: 0.15 },
    focus: "Every key released after a sprint. AFTER: the tail goes quiet and straightens while the body coasts, the pectorals drop and flare like brakes." },
  { id: "turn", kind: "ride", label: "Turn: carving from behind", strip: { frames: 8, stepSec: 0.12 },
    focus: "A hard carve, lens behind and above. BEFORE: the ridden body rolled OUT of every turn. AFTER: it banks into the turn and the pectorals work differentially." },
  { id: "bite", kind: "bite", label: "Bite: gape, lunge, head-shake", strip: { frames: 10, stepSec: 0.08 },
    focus: "A swimmer ahead of the shark; the mode's own auto-bite fires. AFTER: once the teeth land, the head shakes side to side (~4 Hz) and rolls with it while the jaw closes." },
  { id: "swimmers", kind: "swim", label: "Swimmers: eight people in four metres of water", strip: { frames: 6, stepSec: 0.25 },
    focus: "Eight survivors given the beach as a target in deep water. BEFORE: upright bodies waving their arms. AFTER: flat on the water, crawl with full arm circles and a breath to the side, or a head-up breaststroke with a frog kick." },
  { id: "flee", kind: "flee", label: "Flee: a fin behind them", strip: { frames: 6, stepSec: 0.3 },
    focus: "The same eight with the player's shark held behind them. BEFORE: the whole group thrashes in place. AFTER: a frantic head-up crawl for the beach with glances back at the fin; only a body the shark is right on goes upright and flails." },
  { id: "death", kind: "death", label: "Death: limp, roll, sink", strip: { frames: 8, stepSec: 0.6 },
    focus: "A wild great white killed in front of the lens. BEFORE: the land tumble (thrown upward, spun, settled on its side in mid-water). AFTER: a few weakening beats, the tail goes slack, the body coasts, rolls belly-up and sinks nose-first." },
];

async function stageSharkMotion(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const RUN = 1 / 30;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__sharkMotion;
  if (!D) {
    D = window.__sharkMotion = {
      lens: null, group: [], sharkAt: null, dead: null, waterline: 0, samples: [],
      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz); cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz)); cam.updateMatrixWorld(true);
      },
      reshoot() { if (D.lens) D.lens(); },
      step(n) {
        for (let i = 0; i < n; i++) {
          CBZ.hitstop = 0; CBZ.slowmo = 0;
          if (D.pre) D.pre();
          try { CBZ.stepSim(RUN); } catch (e) { D.err = String(e && e.message || e); }
          D.reshoot();
        }
      },
      sec(s) { D.step(Math.max(1, Math.round(s / RUN))); },
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : 0; },
      col(x, z) { return CBZ.cityWaterDepthAt ? Math.max(0, CBZ.cityWaterDepthAt(x, z)) : 0; },
      depth(x, z) { return CBZ.survFloodDepthMeanAt ? Math.max(0, CBZ.survFloodDepthMeanAt(x, z)) : D.col(x, z); },
      deepSpot(minD, ang) {
        const A = CBZ.surv.arena;
        for (let r = A.radius; r < A.radius + 460; r += 4) {
          const x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
          if (D.col(x, z) > minD) return { x: x, z: z, r: r, ang: ang, d: D.col(x, z) };
        }
        return null;
      },
      findWater(ang, dMin, dMax) {
        const A = CBZ.surv.arena;
        for (let r = Math.max(4, D.waterline - 10); r < D.waterline + 220; r += 2) {
          const x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
          const d = D.depth(x, z);
          if (d >= dMin && d <= dMax) return { x: x, z: z, depth: d, r: r, ang: ang };
        }
        return null;
      },
      mount() { return CBZ.cityMountedAnimal ? CBZ.cityMountedAnimal() : null; },
      keys(w, shift, rise, dive) {
        const K = CBZ.keys || (CBZ.keys = {});
        K.w = !!w; K.shift = !!shift; K[" "] = !!rise; K.control = !!dive;
      },
      steer(h) { if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(-Math.cos(h), -Math.sin(h)); CBZ.cam.pitch = 0.06; } },
      peace() {
        const S = CBZ.sharkSim && CBZ.sharkSim.shark;
        for (const a of CBZ.cityWildlife || []) {
          if (!a || a.dead || !a.species || a === S || a === D.dead) continue;
          a.pos.x += 1400; a.hunger = 0;
          if (a.group) a.group.position.x = a.pos.x;
          if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
        }
        if (CBZ.sharkSim) { CBZ.sharkSim.podT = 9000; CBZ.sharkSim.stockT = 9000; const S2 = CBZ.sharkSim.shark; if (S2) S2.hp = S2.maxHp; }
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "0"; }
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        // state.js rewrites the pill's inline display every frame; a stylesheet rule outranks it
        if (!document.getElementById("sharkMotionNoHint")) { const st = document.createElement("style"); st.id = "sharkMotionNoHint"; st.textContent = "#lockHint{display:none!important}"; document.head.appendChild(st); }
      },
      climbTo(tier) {
        for (let guard = 0; guard < 40 && CBZ.sharkSim.tier < tier; guard++) {
          const meal = { dead: true, hp: 0, maxHp: 900, pos: { x: 0, y: 0, z: 0 } };
          try { CBZ.sharkSimBite("animal", meal, CBZ.sharkSim.shark); } catch (e) {}
          D.step(8);
        }
        CBZ.hitstop = 0; CBZ.slowmo = 0; D.step(30); CBZ.hitstop = 0; CBZ.slowmo = 0;
        return CBZ.sharkSim.tier;
      },
      park(spot, heading) {
        const P = CBZ.player, a = D.mount();
        P.pos.x = spot.x; P.pos.z = spot.z;
        if (a) {
          if (a.pos) { a.pos.x = spot.x; a.pos.z = spot.z; }
          if (a.group) { a.group.position.x = spot.x; a.group.position.z = spot.z; }
          if (a._waterMove) { a._waterMove.x = spot.x; a._waterMove.z = spot.z; }
        }
        if (CBZ.cityMountedHeading) { try { CBZ.cityMountedHeading(heading); } catch (e) {} }
        D.steer(heading);
        D.step(6);
      },
      // THE FOLLOW LENS: abeam / behind the ridden body, re-aimed every step
      side(dist, dy, ahead) {
        D.lens = function () {
          const a = D.mount(); if (!a || !a.group) return;
          const g = a.group.position, h = D.headingOf(a);
          const nx = -Math.sin(h), nz = Math.cos(h);
          const cx = g.x + Math.cos(h) * (ahead || 0), cz = g.z + Math.sin(h) * (ahead || 0);
          D.tripod(cx + nx * dist, g.y + dy, cz + nz * dist, cx, g.y + 0.2, cz);
        };
        D.lens();
      },
      behind(dist, up) {
        D.lens = function () {
          const a = D.mount(); if (!a || !a.group) return;
          const g = a.group.position, h = D.lensH != null ? D.lensH : D.headingOf(a);
          D.tripod(g.x - Math.cos(h) * dist, g.y + up, g.z - Math.sin(h) * dist, g.x + Math.cos(h) * 2, g.y, g.z + Math.sin(h) * 2);
        };
        D.lens();
      },
      headingOf(a) { return CBZ.cityMountedHeading ? CBZ.cityMountedHeading() : (a && a.group ? -a.group.rotation.y : 0); },
      liveBots(n) {
        const out = [], bots = CBZ.bots || [];
        for (let i = 0; i < bots.length && out.length < n; i++) { const b = bots[i]; if (b && !b.dead) out.push(b); }
        return out;
      },
      clearCrowd(keep) {
        const bots = CBZ.bots || [], c = CBZ.surv.arena.center;
        let n = 0;
        for (let i = 0; i < bots.length; i++) {
          const b = bots[i];
          if (!b || (keep && keep.indexOf(b) >= 0)) continue;
          b.pos.x = c.x + ((n % 14) - 7) * 3; b.pos.z = c.z + (((n / 14) | 0) - 4) * 3;
          b.pos.y = CBZ.surv.floorAt ? CBZ.surv.floorAt(b.pos.x, b.pos.z) : 0;
          b.swim = false; b._floatY = null; b.panicT = 0; b.pause = 9999; n++;
          if (b.target && b.target.set) b.target.set(b.pos.x, 0, b.pos.z);
        }
      },
      holdShark() {
        const a = D.sharkAt, S = CBZ.sharkSim && CBZ.sharkSim.shark, P = CBZ.player;
        if (!a || !S) return;
        if (S.hp <= 1) { S.hp = S.maxHp || 100; S.dead = false; }
        S.pos.x = a.x; S.pos.z = a.z;
        if (S.group) S.group.position.set(a.x, S.group.position.y, a.z);
        if (S._waterMove) { S._waterMove.x = a.x; S._waterMove.z = a.z; }
        if (P && P.pos) { P.pos.x = a.x; P.pos.z = a.z; }
        if (a.h != null && CBZ.cityMountedHeading) { try { CBZ.cityMountedHeading(a.h); } catch (e) {} }
      },
      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]'); if (mb) mb.click();
          const pb = document.getElementById("playBtn"); if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        let seed = 0x9e3779b9 >>> 0;
        Math.random = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
        for (let t = 0; t < 90 && !D.armed(); t++) { D.step(12); await sleep(20); }
        if (!D.armed()) return false;
        D.waterline = CBZ.sharkSim.waterline || CBZ.surv.arena.radius;
        const orig = window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
        return true;
      },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark && CBZ.bots && CBZ.bots.length &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },
      // what the strip photographs, sampled every advance (both builds carry these)
      sample() {
        const a = D.mount(), r = a && a.swim;
        if (!r || !r.parts || !r.parts.length) return;
        let tip = r.parts[0];
        for (let i = 0; i < r.parts.length; i++) if (r.parts[i].x0 < tip.x0) tip = r.parts[i];
        D.samples.push({ tip: r.vert ? tip.m.position.y : tip.m.position.z, roll: a.group.rotation.x, yaw: a.group.rotation.y });
      },
    };
    if (!await D.boot()) return { ok: false, err: "sharksim never armed" };
    D.peace();
    D.tier = D.climbTo(2);
    D.peace();
    window.__cbzVisualCompare = window.__cbzVisualCompare || {};
    window.__cbzVisualCompare.render = function () { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {} };
  }
  const H = window.__cbzVisualCompare;
  D.pre = null; D.lens = null; D.lensH = null; D.samples = [];
  D.keys(false, false, false, false);
  const out = { subject: sub.id };

  if (sub.kind === "ride") {
    D.peace();
    const spot = D.deepSpot(26, 0.7 + ["cruise", "burst", "glide", "turn"].indexOf(sub.id) * 0.9);
    if (!spot) throw new Error("no deep water");
    const heading = spot.ang + Math.PI * 0.5;
    D.park(spot, heading);
    // settle at a moderate depth: a short dive, then level out
    D.keys(true, false, false, true); D.sec(0.8);
    D.keys(true, false, false, false); D.sec(1.6);
    if (sub.id === "cruise") { D.keys(true, false, false, false); D.sec(0.6); }
    if (sub.id === "burst") { D.keys(true, false, false, false); D.sec(0.6); D.keys(true, true, false, false); }
    if (sub.id === "glide") { D.keys(true, true, false, false); D.sec(2.0); D.keys(false, false, false, false); }
    if (sub.id === "turn") {
      D.keys(true, true, false, false); D.sec(1.0);
      const a = D.mount(); D.lensH = D.headingOf(a);
      let h = D.lensH;
      D.pre = function () { h += 1.8 * RUN; D.steer(h); };
    }
    const a = D.mount(), len = a && a.swim ? a.swim.len * (a.group.scale.x || 1) : 5;
    if (sub.id === "turn") D.behind(len * 1.5, len * 0.55);
    else D.side(len * 1.25, 0.1, 0);
    D.step(1);
    out.speed = +(CBZ.player.speed || 0).toFixed(2);
    out.bodyLenM = +len.toFixed(2);
  } else if (sub.kind === "bite") {
    D.peace();
    const spot = D.deepSpot(26, 3.9);
    if (!spot) throw new Error("no deep water");
    const heading = spot.ang + Math.PI * 0.5;
    D.park(spot, heading);
    D.keys(false, false, true, false); D.sec(1.0);          // up toward the surface
    const a = D.mount(), g = a.group.position;
    const bot = D.liveBots(1)[0];
    D.clearCrowd([bot]);
    const bx = g.x + Math.cos(heading) * 9, bz = g.z + Math.sin(heading) * 9;
    bot.pos.x = bx; bot.pos.z = bz; bot.pos.y = D.seaY(bx, bz) - 1.3;
    bot.swim = true; bot._floatY = bot.pos.y; bot.pause = 9999;
    if (bot.target && bot.target.set) bot.target.set(bx, 0, bz);
    D.group = [bot];
    D.keys(true, false, false, false);
    // step until the strike starts (the mode's own auto-bite)
    for (let i = 0; i < 150; i++) {
      D.step(1);
      if (a._atkAnim != null && a._atkAnim > 0.2) break;
    }
    const len = a.swim ? a.swim.len * (a.group.scale.x || 1) : 5;
    D.side(len * 1.1, 0.4, len * 0.25);
    out.atk = a._atkAnim;
  } else if (sub.kind === "swim" || sub.kind === "flee") {
    D.peace();
    let spot = D.stage;
    if (!spot) {
      spot = D.findWater(2.4, 3.5, 6) || D.findWater(1.6, 3.5, 6) || D.findWater(0.5, 3, 7);
      if (!spot) throw new Error("no 3.5-6 m water for swimmers");
      D.stage = spot;
    }
    const bots = D.liveBots(8);
    D.clearCrowd(bots);
    const A = CBZ.surv.arena;
    const sx = A.center.x - spot.x, sz = A.center.z - spot.z, sl = Math.hypot(sx, sz) || 1;
    const ux = sx / sl, uz = sz / sl, px = -uz, pz = ux;       // toward shore, and along it
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      const lat = (i % 4 - 1.5) * 3.2, back = ((i / 4) | 0) * 3.4;
      b.pos.x = spot.x + px * lat - ux * back; b.pos.z = spot.z + pz * lat - uz * back;
      b.pos.y = D.seaY(b.pos.x, b.pos.z) - 1.275;
      b.swim = true; b._floatY = b.pos.y; b.panicT = 0; b.state = "wander"; b.pause = 0; b.speed = 0.8;
      if (b.target && b.target.set) b.target.set(A.center.x, 0, A.center.z);
      b.pause = 0;
    }
    D.group = bots;
    if (sub.kind === "flee") {
      const sh = { x: spot.x - ux * 16, z: spot.z - uz * 16, h: Math.atan2(uz, ux) };
      D.sharkAt = sh;
      D.pre = function () { D.sharkAt.x += ux * 1.2 * RUN; D.sharkAt.z += uz * 1.2 * RUN; D.holdShark(); };
      D.holdShark();
    } else {
      const far = { x: spot.x - ux * 90, z: spot.z - uz * 90, h: Math.atan2(uz, ux) };
      D.sharkAt = far;
      // HOLD THE LEG (shark-swimmers.mjs's holdCast): the crowd brain re-picks
      // a wander target within a second, and a swimmer that has "arrived"
      // treads upright, so the strip would photograph treading, not a stroke.
      D.pre = function () {
        D.holdShark();
        for (const b of D.group) { if (b && !b.dead && b.target && b.target.set) { b.target.set(A.center.x, 0, A.center.z); b.pause = 99; } }
      };
      D.pre();
    }
    D.sec(sub.kind === "flee" ? 1.2 : 2.0);
    // the lens: to the side of the group, low over the water, looking along it
    D.lens = function () {
      let cx = 0, cz = 0, n = 0;
      for (const b of D.group) { if (b && !b.dead) { cx += b.pos.x; cz += b.pos.z; n++; } }
      if (!n) return;
      cx /= n; cz /= n;
      const sy = D.seaY(cx, cz);
      D.tripod(cx + px * 11 - ux * 5, sy + 2.6, cz + pz * 11 - uz * 5, cx, sy - 0.3, cz);
    };
    D.lens();
  } else if (sub.kind === "death") {
    D.peace();
    const spot = D.deepSpot(26, 5.2);
    if (!spot) throw new Error("no deep water");
    // the player's shark goes far away; a wild great white comes to the lens
    const heading = spot.ang + Math.PI * 0.5;
    D.park({ x: spot.x + Math.cos(spot.ang) * 120, z: spot.z + Math.sin(spot.ang) * 120 }, heading);
    let w = null;
    for (const a of CBZ.cityWildlife || []) {
      if (a && !a.dead && a.species && /great_white/.test(a.species.id) && a !== CBZ.sharkSim.shark && !a.ridden) { w = a; break; }
    }
    if (!w) for (const a of CBZ.cityWildlife || []) {
      if (a && !a.dead && a.species && /shark/.test(a.species.id) && a !== CBZ.sharkSim.shark && !a.ridden) { w = a; break; }
    }
    if (!w) throw new Error("no wild shark to kill");
    D.dead = w;
    const y = D.seaY(spot.x, spot.z) - 3;
    w.pos.x = spot.x; w.pos.z = spot.z; w.heading = heading;
    w.group.position.set(spot.x, y, spot.z);
    if (w._waterMove) { w._waterMove.x = spot.x; w._waterMove.z = spot.z; }
    w.hunger = 0;
    D.step(12);
    const g = w.group.position;
    const nx = -Math.sin(heading), nz = Math.cos(heading);
    const len = w.swim ? w.swim.len * (w.group.scale.x || 1) : 5;
    const shot = [g.x + nx * len * 1.6 + Math.cos(heading) * len * 0.8, g.y + 0.6, g.z + nz * len * 1.6 + Math.sin(heading) * len * 0.8,
      g.x + Math.cos(heading) * len * 0.8, g.y - 1.2, g.z + Math.sin(heading) * len * 0.8];
    D.lens = function () { D.tripod(shot[0], shot[1], shot[2], shot[3], shot[4], shot[5]); };
    D.lens();
    try { CBZ.cityWildlifeHit(w, { head: false }, { damage: 99999 }); } catch (e) { out.killErr = String(e && e.message || e); }
    D.step(1);
    out.dead = !!w.dead;
    out.y0 = +w.group.position.y.toFixed(2);
  }

  H.advance = async function (s) { D.sec(s); D.sample(); };
  H.metrics = function () {
    const m = {};
    if (D.samples.length) {
      let lo = 1e9, hi = -1e9, rl = 0;
      for (const s of D.samples) { lo = Math.min(lo, s.tip); hi = Math.max(hi, s.tip); rl = Math.max(rl, Math.abs(s.roll)); }
      m.tipSweepM = +(hi - lo).toFixed(3);
      m.maxRollDeg = +(rl * 57.2958).toFixed(1);
    }
    if (D.dead && D.dead.group) {
      m.corpseY = +D.dead.group.position.y.toFixed(2);
      m.corpseRollDeg = +(D.dead.group.rotation.x * 57.2958).toFixed(0);
    }
    return m;
  };
  await H.render();
  D.sample();
  return { ok: true, side: input.side, metrics: out };
}

export default {
  id: "shark-motion",
  title: "Shark Sim — how the shark, the sea life and the swimmers move",
  description: "Film strips of the animation on both builds: cruise, burst, glide, turn, bite, swimmers, flee and death, each a row of frames a fixed slice of simulated time apart, same seed, same keys, lens following the body.",
  beforeLabel: "BEFORE · wave-start HEAD",
  afterLabel: "AFTER · working tree",
  pairNote: "Same island · same seed · same keys · same fixed steps · lens follows the body",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 900000,
  viewport: { width: 1280, height: 720 },
  readyExpression:
    "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.bots && CBZ.citySeaHeightAt && CBZ.cityMountedAnimal && document.getElementById('playBtn')",
  subjects,
  stage: stageSharkMotion,
  metrics: {
    tipSweepM: { label: "Tail-tip lateral sweep across the strip (local units)" },
    maxRollDeg: { label: "Peak body roll across the strip", unit: "deg" },
    corpseY: { label: "Corpse height at the end of the strip", unit: "m" },
    corpseRollDeg: { label: "Corpse roll at the end of the strip", unit: "deg" },
  },
  metricsNote: "Descriptions, not scores: the strips are the test.",
};
