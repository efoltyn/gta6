/* Shark Sim, before/after — THE FIRST MINUTE, as a stranger sees it.

   The "make it real" wave (2026-09-27): the owner's test is a screenshot of
   the first sixty seconds. So this preset photographs exactly those: the
   front door, the spawn, the first dive, the swim at the beach, and the body
   you are wearing, all through the GAME'S OWN chase camera except the two
   studio frames (body close-up, surface from above) that need a tripod.

   Both columns run the same driver on the same seed with the same keys held
   for the same fixed 1/30 steps. BEFORE = wave-start HEAD on its own port,
   AFTER = the working tree.

   HARNESS TRAP: stage() is serialized into the page. Nothing from module
   scope is reachable inside it. */

const subjects = [
  { id: "title", label: "The front door",
    focus: "The title card over the attract lens: the first frame anyone sees." },
  { id: "spawn", label: "Spawn, three seconds in",
    focus: "PLAY pressed, no input for three seconds: the chase camera over a bull shark off the beach." },
  { id: "dive", label: "The first dive",
    focus: "Swim forward two seconds, then hold dive: the underwater grade, the seabed, the light from above." },
  { id: "beach", label: "Hunting the beach",
    focus: "Parked in the wade band facing the sand: the surf, the crowd, the island behind them." },
  { id: "body", label: "The body you wear",
    focus: "Tripod a body-length off the flank, underwater: skin, countershading, fins, the medium around it." },
  /* HARNESS TRAP: an "above the swell" tripod subject was cut. A tripod 2.4 m
     over the live surface still rendered the underwater grade (the tint is
     driven from something other than CBZ.camera at order 99.5), so it
     photographed the sea from below. The spawn frame covers the surface. */
  { id: "hunt", label: "Ninety seconds of play, by an autopilot",
    focus: "A dumb bot plays the real game: steer at the nearest thing in the water, sprint when close, the bite is automatic. The numbers are the core loop: how soon the first meal, how many, how much health is left, whether hunger or the pod mattered. The frame is the last one." },
];

async function stageFirstMinute(input) {
  const C = window.CBZ, T = window.THREE, sub = input.subject;
  if (!C || !T || !C.stepSim) return { ok: false, missing: "engine" };
  const RUN = 1 / 30;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__sharkFirst;
  if (!D) {
    D = window.__sharkFirst = {
      rafOrig: null, booted: false, shot: null,
      tripod(a) {
        const cam = C.camera; if (!cam || !a) return;
        cam.position.set(a[0], a[1], a[2]); cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(a[3], a[4], a[5])); cam.updateMatrixWorld(true);
      },
      step(n) { for (let i = 0; i < n; i++) { C.hitstop = 0; C.slowmo = 0; C.stepSim(RUN); if (D.shot) D.tripod(D.shot); } },
      hook() {
        // HARNESS TRAP: camera.js owns the lens at onAlways(50) and the
        // underwater grade reads it at 99.6, INSIDE the step. A tripod stamped
        // only after the step is graded as wherever the chase camera was.
        if (D._hooked || !C.onAlways) return;
        D._hooked = true;
        C.onAlways(99.5, function () { if (D.shot) D.tripod(D.shot); });
      },
      sec(s) { D.step(Math.max(1, Math.round(s / RUN))); },
      keys(w, shift, rise, dive) {
        const K = C.keys || (C.keys = {});
        K.w = !!w; K.shift = !!shift; K[" "] = !!rise; K.control = !!dive;
      },
      shark() { return C.sharkSim && C.sharkSim.shark; },
      armed() {
        return !!(C.sharkSim && C.sharkSim.on && C.sharkSim.shark &&
          C.cityMountedAnimal && C.cityMountedAnimal() === C.sharkSim.shark);
      },
      async boot() {
        if (D.booted) return true;
        for (let t = 0; t < 600 && !(C.game.state === "playing" && C.game.mode === "sharksim"); t++) {
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (C.game.state !== "playing") return false;
        D.rafOrig = window.requestAnimationFrame;
        const orig = D.rafOrig;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => { orig.call(window, () => res()); setTimeout(res, 1500); });
        try { if (C.setQualityLevel) C.setQualityLevel(3); } catch (e) {}
        try { if (C.dayPhase) C.dayPhase(0.22); } catch (e) {}
        for (let t = 0; t < 90 && !D.armed(); t++) D.step(12);
        if (!D.armed()) return false;
        // no wandering pod in the first minute photographs
        if (C.sharkSim) C.sharkSim.podT = 9000;
        D.hook();
        D.booted = true;
        return true;
      },
      park(x, z, heading) {
        const P = C.player, a = D.shark();
        P.pos.x = x; P.pos.z = z;
        if (a) {
          if (a.pos) { a.pos.x = x; a.pos.z = z; }
          if (a.group) { a.group.position.x = x; a.group.position.z = z; }
          if (a._waterMove) { a._waterMove.x = x; a._waterMove.z = z; }
        }
        if (C.cityMountedHeading) { try { C.cityMountedHeading(heading); } catch (e) {} }
        if (C.cam) { C.cam.yaw = Math.atan2(-Math.cos(heading), -Math.sin(heading)); C.cam.pitch = 0.06; }
        D.step(6);
      },
    };
    window.__cbzVisualCompare = {
      async render() {
        if (C.bootMeter && C.bootMeter.hide) { try { C.bootMeter.hide(); } catch (e) {} }
        if (!C.renderer) return;
        if (!D.rafOrig) { await new Promise((r) => setTimeout(r, 1200)); return; }
        const draw = () => { try { C.renderer.render(C.scene, C.camera); } catch (e) {} };
        let drew = false;
        await new Promise((res) => {
          let done = false; const fin = () => { if (!done) { done = true; res(); } };
          D.rafOrig.call(window, () => { draw(); drew = true; fin(); });
          setTimeout(fin, 1500);
        });
        if (!drew) draw();
        await new Promise((r) => setTimeout(r, 1200));
      },
    };
  }

  const out = { ok: true, subject: sub.id };
  if (sub.id === "title") {
    // the attract lens is built one painted frame after the title: give it real time
    for (let t = 0; t < 300 && !(C.game && C.game.state === "title"); t++) await sleep(100);
    await sleep(6000);
    return out;
  }
  if (!await D.boot()) throw new Error("sharksim never armed");
  const A = C.surv && C.surv.arena;
  const WL = (C.sharkSim && C.sharkSim.waterline) || (A ? A.radius + 20 : 100);
  const seaY = (x, z) => (C.citySeaHeightAt ? C.citySeaHeightAt(x, z) : 0);
  D.shot = null;

  if (sub.id === "spawn") {
    D.keys(false, false, false, false);
    D.sec(3);
  } else if (sub.id === "dive") {
    D.keys(true, false, false, false); D.sec(2);
    D.keys(true, false, false, true); D.sec(1.6);
    D.keys(true, false, false, false); D.sec(0.6);
    D.keys(false, false, false, false);
  } else if (sub.id === "beach") {
    const ang = 0.35;
    const r = WL + 16;
    const x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
    // heading points toward the island centre (wildlife heading: atan2(dz, dx))
    D.park(x, z, Math.atan2(-Math.sin(ang), -Math.cos(ang)));
    D.keys(true, false, false, false); D.sec(0.8);
    D.keys(false, false, false, false); D.sec(1.2);
  } else if (sub.id === "body") {
    const ang = 1.9, r = WL + 70;
    const x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
    D.park(x, z, ang + Math.PI / 2);
    D.keys(true, false, false, true); D.sec(1.5);
    D.keys(true, false, false, false); D.sec(1.0);
    const S = D.shark(); S.group.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(S.group);
    const c = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3());
    const h = S.heading || 0;
    const len = Math.max(size.x, size.z);
    const side = new T.Vector3(-Math.sin(h), 0, Math.cos(h));
    const fwd = new T.Vector3(Math.cos(h), 0, Math.sin(h));
    const p = c.clone().addScaledVector(side, len * 0.95).addScaledVector(fwd, len * 0.35);
    p.y = Math.min(c.y + len * 0.12, seaY(c.x, c.z) - 0.35);
    D.keys(false, false, false, false);
    D.shot = [p.x, p.y, p.z, c.x + fwd.x * len * 0.08, c.y, c.z + fwd.z * len * 0.08];
    D.step(2);
    out.body = { species: S.species && S.species.id, len: +len.toFixed(2), depth: +(seaY(c.x, c.z) - c.y).toFixed(2) };
  } else if (sub.id === "above") {
    // open water, a hundred metres off the sand: the swell, the sky in it,
    // the island on the horizon, the dorsal ahead of the lens
    const ang = 3.6, r = WL + 110;
    const x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
    const tang = ang + Math.PI / 2;
    D.park(x, z, tang);
    D.keys(true, false, false, false); D.sec(1.5);
    D.keys(false, false, false, false);
    const S = D.shark(); const sp = S.group.position;
    const fw = new T.Vector3(Math.cos(tang), 0, Math.sin(tang));
    const cx = sp.x - fw.x * 8, cz = sp.z - fw.z * 8;
    const inx = -Math.cos(ang) * 25, inz = -Math.sin(ang) * 25;
    D.shot = [cx, seaY(cx, cz) + 2.4, cz, sp.x + fw.x * 40 + inx, seaY(sp.x, sp.z) + 0.6, sp.z + fw.z * 40 + inz];
    D.step(2);
  }
  else if (sub.id === "hunt") {
    // THE AUTOPILOT. Real keys, real bite: it only chooses a bearing.
    const P = C.player, S0 = D.shark();
    D.shot = null;
    // every run starts from the same water: 30 m off the sand, nosing along the coast
    { const ang = 0.9, r = WL + 30;
      D.park(A.center.x + Math.cos(ang) * r, A.center.z + Math.sin(ang) * r, ang + Math.PI / 2); }
    const x0 = P.pos.x, z0 = P.pos.z; let travel = 0, px = x0, pz = z0;
    const edible = new Set(["fish", "sardine", "barracuda", "dolphin", "sea_turtle"]);
    const depth = (x, z) => (C.cityWaterDepthAt ? Math.max(0, C.cityWaterDepthAt(x, z)) : 1);
    const t0 = (C.sharkSim && C.sharkSim.eaten) || 0;
    let first = -1, hpMin = 1, frames = 0;
    const secs = 90, n = Math.round(secs / RUN);
    for (let i = 0; i < n; i++) {
      const S = D.shark();
      if (!S || S.dead || !C.sharkSim.on) break;
      if (i % 6 === 0) {
        let best = null, bd = 1e9;
        for (const b of C.bots || []) {
          if (!b || b.dead || depth(b.pos.x, b.pos.z) < 0.5) continue;
          const d = Math.hypot(b.pos.x - P.pos.x, b.pos.z - P.pos.z);
          if (d < bd) { bd = d; best = b; }
        }
        for (const a of C.cityWildlife || []) {
          if (!a || a.dead || a === S || !a.species || !edible.has(a.species.id)) continue;
          const d = Math.hypot(a.pos.x - P.pos.x, a.pos.z - P.pos.z) * 1.15;
          if (d < bd) { bd = d; best = a; }
        }
        if (best && C.cam) {
          const dx = best.pos.x - P.pos.x, dz = best.pos.z - P.pos.z;
          C.cam.yaw = Math.atan2(-dx, -dz);
          D.keys(true, bd < 18, false, false);
        } else D.keys(true, false, false, false);
      }
      D.step(1);
      frames++;
      travel += Math.hypot(P.pos.x - px, P.pos.z - pz); px = P.pos.x; pz = P.pos.z;
      const eaten = (C.sharkSim.eaten || 0) - t0;
      if (first < 0 && eaten > 0) first = +(frames * RUN).toFixed(1);
      if (S.maxHp) hpMin = Math.min(hpMin, S.hp / S.maxHp);
    }
    D.keys(false, false, false, false);
    const sim = C.sharkSim, S = D.shark();
    out.metrics = {
      mealsIn90s: (sim.eaten || 0) - t0,
      firstMealS: first < 0 ? 99 : first,
      tierReached: sim.tier,
      massEaten: +(sim.mass || 0).toFixed(1),
      hpEndPct: S && S.maxHp ? Math.round(100 * Math.max(0, S.hp) / S.maxHp) : 0,
      hpMinPct: Math.round(100 * hpMin),
      score: Math.round(sim.score || 0),
      alive: S && !S.dead && !sim.ended ? 1 : 0,
      simSeconds: +(frames * RUN).toFixed(1),
      travelM: Math.round(travel),
    };
  }
  if (C.cityCameraSubmerged) { try { out.submerged = !!C.cityCameraSubmerged(); } catch (e) {} }
  await window.__cbzVisualCompare.render();
  return out;
}

export default {
  id: "shark-first-minute",
  title: "Shark Sim — the first minute, as a stranger sees it",
  description: "Title, spawn, first dive, the beach, the body and the surface, photographed on the live build with the game's own chase camera and a fixed-step driver so both columns are the same moment.",
  beforeLabel: "BEFORE · wave-start HEAD",
  afterLabel: "AFTER · working tree",
  pairNote: "Same seed · same keys · same fixed steps · same lens",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 600000,
  viewport: { width: 1280, height: 720 },
  subjects,
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.citySeaHeightAt && CBZ.cityMountedAnimal && document.getElementById('playBtn')",
  stage: stageFirstMinute,
  metrics: {
    mealsIn90s: { label: "Meals the autopilot landed in 90 s", better: "higher" },
    firstMealS: { label: "Seconds to the first meal", unit: "s", better: "lower" },
    tierReached: { label: "Form reached (0 bull .. 3 megalodon)", better: "higher" },
    massEaten: { label: "Mass eaten", better: "higher" },
    hpMinPct: { label: "Lowest health during the run (hunger pressure)", unit: "%" },
    hpEndPct: { label: "Health at the end", unit: "%" },
    score: { label: "Score", better: "higher" },
    alive: { label: "Still alive at the end", better: "higher" },
  },
  metricsNote: "The five frames are the contact sheet. The hunt numbers are an autopilot playing the real game: they show whether the loop has a pulse (meals come, hunger bites, the pod arrives), not how good a human is.",
};
