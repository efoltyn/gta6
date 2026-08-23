/* THE BLIZZARD storyboard for tools/visual-compare.mjs.

   Skeleton lifted from quake-stages.mjs (same boot, same rAF freeze, same
   CBZ.stepSim clock), narrowed to ONE disaster and staged along its real
   timeline so every beat of the rebuilt event gets its own frame:

     closing (pair)   the warn phase. A still cannot carry "the horizon is
                      walking toward you", so this is shot as a PAIR from one
                      fixed camera ~4 sim-seconds apart: same vista, most of
                      the island gone between the two frames.
     whiteout         the storm at a gust peak: a person 8 m from the lens is
                      a shadow, then nothing. This is the danger no other
                      disaster in the roster has — it takes your EYES.
     drift            the world changing shape: the lee-side drift piled
                      against a building, along the same bearing the flakes
                      are streaming.
     windbreak        the survival lesson: the crowd huddled on the lee face
                      of a wall, framed against the open ground where the
                      exposed are still burning down their clock.
     frozen           the clock run out: a rimed corpse in the open, the snow
                      already mounding over it.
     aftermath        the all-clear. The fog opens and what the storm DID is
                      still there: white island, standing drifts, mounds
                      where people fell. Legacy left nothing but a tint.

   THIS IS A FLAG A/B, NOT A DIFF AGAINST THE DEPLOYED BUILD: both sides are
   this same checkout, the before side booted with ?cfg_BLIZZARD_V2=0 — the
   legacy storm exactly (flat 60 m fog, snow particles, a damage tax on
   standing still, no drifts, no windchill clock, no burial).

   CAMERAS ARE SOLVED, NOT TYPED (quake-stages.mjs's law, kept): every beat
   asks the LIVE world for its subject — the bot the fog is swallowing, the
   tallest drift, the wall with the most people in its lee, a corpse that
   actually froze — and the fallbacks are computed from arena geometry plus
   CBZ.weatherWind(), which both builds drive, so before/after photograph the
   same real place even though only one of them has drifts to aim at. */

const subjects = [
  { id: "closing-a", label: "The horizon walks in — frame 1 of 2", pair: "closing",
    focus: "Warn phase, ~1 s in. A fixed vista across the town: the island is still visible to its far shore, the first flakes are crossing the light, a dusting is starting on the grass.",
    act: { force: "blizzard", untilState: "warn", extraSecs: 0.8 },
    cam: { aim: "vista" } },
  { id: "closing-b", label: "The horizon walks in — frame 2 of 2", pair: "closing",
    focus: "The same camera ~4 sim-seconds later, still before the storm proper. Compare against frame 1: the far shore is gone. That shrinking IS the warning — nothing prints it.",
    act: { extraSecs: 3.6 },
    cam: { aim: "vista", hold: true } },

  /* From here every beat is pinned to an ABSOLUTE sim-second of the storm's
     active phase (`atSecs`), against the def's own countdown — a --subjects
     subset lands on the same moment as the full storyboard. Def timeline:
     activeSecs 17. The V2 gust cycle peaks near t ≈ 3.6 and 11.15 and lulls
     near t ≈ 7.4 and 15, so the whiteout beat sits on a gust peak and the
     windbreak beat in the clearer air after it. */
  { id: "whiteout", requireBlizzard: true, label: "Whiteout — a person, 8 metres, gone",
    focus: "A gust peak. The camera stands eight metres from a living person at eye height. In the after build visibility is breathing between ~40 m lulls and ~12 m gusts and this frame is the bottom of a gust: the person is a grey suggestion. Before: a flat 60 m fog that never once takes your eyes.",
    act: { atSecs: 11.1 },
    cam: { aim: "person" } },

  { id: "drift", requireBlizzard: true, label: "The drift — snow on the lee side",
    focus: "The world changing shape, shot in the gust LULL so you can see it: a real drift piled against the downwind face of a building, its long axis on the same bearing the flakes stream. It has been growing since the storm started and it will still be here after. Before: the ground tint whitens and no snow lies ANYWHERE as a shape.",
    act: { atSecs: 15.0 },
    cam: { aim: "drift" } },

  { id: "windbreak", requireBlizzard: true, label: "The windbreak and the open",
    focus: "The survival answer, made visible: the crowd has converged on the lee face of a wall — cut off from the wind, their clocks nearly stopped — while anyone still in the open is freezing on a countdown, moving or not. Before: bots wander, only standing still hurts, and a wall means nothing.",
    act: { atSecs: 15.6 },
    cam: { aim: "huddle" } },

  { id: "frozen", requireBlizzard: true, label: "Frozen solid — and being buried",
    focus: "The windchill clock run out on someone the storm caught in the open: a rimed, whitened corpse, the snow already mounding over the body. Before: cold only ever hurt an actor who stood still, and a body just lay there unmarked.",
    act: { atSecs: 16.2 },
    cam: { aim: "frozen" } },

  { id: "aftermath", requireBlizzard: true, label: "All-clear — the storm's shape stays",
    focus: "The blizzard has ended and the fog has opened. What it DID is still on the ground: the island white, drifts standing on every lee face, mounds where the frozen fell — all of it now melting over minutes, not deleted. Before: the tint fades and the event never happened.",
    act: { untilState: "idle", thenSecs: 5 },
    cam: { aim: "aerial" } },
];

async function stageBlizzard(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__blizzardOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__blizzardSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="survival"]'), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="survival"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (!CBZ.disasters || typeof CBZ.disasters.force !== "function") return { ok: false, err: "no CBZ.disasters.force" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__blizzardOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__blizzardSeq = { overlay, cam: null, t0: null };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const act = subject.act || {};
  const heal = () => {
    if (!CBZ.player) return;
    CBZ.player.hp = 100; CBZ.player.dead = false;
    if (CBZ.player.stamina != null) CBZ.player.stamina = 100;
  };
  let ticks = 0, totalMs = 0, maxMs = 0, over33 = 0;
  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      const t0 = performance.now();
      CBZ.stepSim(1 / 60);
      const ms = performance.now() - t0;
      ticks++; totalMs += ms;
      if (ms > maxMs) maxMs = ms;
      if (ms > 33) over33++;
      heal();
    }
  };
  const stepUntilState = (want, budget) => {
    let guard = Math.round((budget || 30) * 10);
    while (guard-- > 0 && CBZ.disasters.state() !== want) step(0.1);
  };

  /* ORDER-INDEPENDENCE (quake-stages' rule): a --subjects subset must not
     photograph whatever the director happens to be doing. Any beat that
     needs the blizzard re-forces it and seeks its own absolute second. */
  const armBlizzard = () => {
    CBZ.disasters.force("blizzard"); step(0.1);
    stepUntilState("active", 40);
    S.t0 = CBZ.disasters.timeLeft();
  };
  if (subject.requireBlizzard && CBZ.disasters.current() !== "BLIZZARD" && !act.force) armBlizzard();
  if (act.force) {
    CBZ.disasters.force(act.force); step(0.1);
    if (act.force === "blizzard") S.t0 = null;
  }
  if (act.untilState) stepUntilState(act.untilState, 40);
  if (act.atSecs != null) {
    if (CBZ.disasters.state() !== "active") stepUntilState("active", 40);
    if (S.t0 == null) S.t0 = CBZ.disasters.timeLeft();
    let guard = 900;
    while (guard-- > 0 && CBZ.disasters.state() === "active" &&
           CBZ.disasters.current() === "BLIZZARD" &&
           (S.t0 - CBZ.disasters.timeLeft()) < act.atSecs) step(0.1);
  }
  if (act.extraSecs) step(act.extraSecs);
  if (act.thenSecs) step(act.thenSecs);

  // ---- SOLVE THE CAMERA off live world state -----------------------------
  const arena = CBZ.surv && CBZ.surv.arena;
  const A = arena ? { cx: arena.center.x, cz: arena.center.z, r: arena.radius } : { cx: 0, cz: 600, r: 120 };
  const cam = subject.cam || {};
  const W = CBZ.weatherWind ? CBZ.weatherWind() : { x: 1, z: 0, speed: 0 };
  const wl = Math.hypot(W.x, W.z) || 1;
  const wx = W.x / wl, wz = W.z / wl;             // THE wind bearing, both builds
  const px = -wz, pz = wx;                         // crosswind
  const frag = (arena && arena.fragile) || [];
  const standing = frag.filter((b) => !b.fallen && b.h >= 3);
  const bots = (CBZ.bots || []).filter((b) => b && !b.dead);
  const gy = (x, z) => { try { return arena.groundHeightAt(x, z); } catch (_) { return 0; } };
  // the lee point of a building on the CURRENT wind bearing — computable on
  // both builds, drifts or no drifts
  const leeOf = (b) => {
    const along = (Math.abs(wx) * b.w + Math.abs(wz) * b.d) / 2;
    return { x: b.x + wx * (along + 2.2), z: b.z + wz * (along + 2.2), b };
  };
  // NEVER STAND INSIDE A BUILDING (the trap quake-stages documented twice):
  // reject an eye position whose footprint lands inside any standing shell
  const insideBuilding = (x, z) => standing.some((b) =>
    x >= b.x - b.w / 2 - 0.7 && x <= b.x + b.w / 2 + 0.7 &&
    z >= b.z - b.d / 2 - 0.7 && z <= b.z + b.d / 2 + 0.7);
  let eye = null, look = null, note = "";

  if (cam.hold && S.cam) {
    eye = S.cam.eye; look = S.cam.look; note = S.cam.note;
  } else if (cam.aim === "vista") {
    /* stand on the island edge and shoot ACROSS it — the longest sightline
       the map has, which is exactly what the fog is about to eat. The bearing
       is SOLVED: start upwind and walk the circle until the eye is not
       standing in the tall district (the first pass of this preset shot a
       wall from 3 m for want of this). */
    let bear = Math.atan2(-wx, -wz);            // upwind first
    let found = null;
    for (let i = 0; i < 12 && !found; i++) {
      const a2 = bear + (i % 2 ? -1 : 1) * Math.ceil(i / 2) * (Math.PI / 6);
      const ex = A.cx + Math.sin(a2) * A.r * 0.95, ez = A.cz + Math.cos(a2) * A.r * 0.95;
      const nearTower = standing.some((b) => {
        const dx = b.x - ex, dz = b.z - ez;
        return dx * dx + dz * dz < 24 * 24 && b.h > 8;
      });
      if (!nearTower && !insideBuilding(ex, ez)) found = { x: ex, z: ez };
    }
    if (!found) found = { x: A.cx - wx * A.r * 0.95, z: A.cz - wz * A.r * 0.95 };
    eye = { x: found.x, y: gy(found.x, found.z) + 13, z: found.z };
    // look PAST the town centre, offset crosswind, so a tower on the centre
    // line cannot fill the frame and kill the sightline
    look = { x: A.cx + px * 22, y: 5, z: A.cz + pz * 22 };
    note = "fixed vista, island edge";
  } else if (cam.aim === "person") {
    // the most exposed living person (V2 caches exposure on the actor);
    // fallback: whoever is furthest from the town's buildings
    let b = null, bs = -1;
    for (const x of bots) {
      let s = x._blzExp != null ? x._blzExp : 0.5;
      if (s > bs) { bs = s; b = x; }
    }
    if (b) {
      // stand so the TOWN is beyond the person: on the before build the same
      // frame shows the person and the buildings behind them; on V2 the gust
      // has taken both
      let dx = b.pos.x - A.cx, dz = b.pos.z - A.cz;
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      eye = { x: b.pos.x + dx * 8, y: b.pos.y + 1.7, z: b.pos.z + dz * 8 };
      if (insideBuilding(eye.x, eye.z)) eye = { x: b.pos.x + px * 8, y: b.pos.y + 1.7, z: b.pos.z + pz * 8 };
      const g = gy(eye.x, eye.z); if (eye.y < g + 1.6) eye.y = g + 1.6;
      look = { x: b.pos.x, y: b.pos.y + 1.2, z: b.pos.z };
      note = "living bot 8 m away, exposure " + (b._blzExp != null ? b._blzExp.toFixed(2) : "?");
    }
  } else if (cam.aim === "drift") {
    // the tallest LIVE drift; before-build fallback: where the drift WOULD
    // be — the lee point of the widest standing building
    // rank drifts by crest height and take the TALLEST one whose open
    // downwind side actually has room to stand a camera in — the first pass
    // of this preset shot the inside of a neighbouring shell for want of it
    const dl = ((CBZ.blizzard && CBZ.blizzard.drifts && CBZ.blizzard.drifts()) || [])
      .filter((d) => d.mesh.parent && d.mesh.scale.y > 0.05)
      .sort((a, b) => b.mesh.scale.y - a.mesh.scale.y);
    const cands = dl.map((d) => ({ x: d.mesh.position.x, y: d.mesh.position.y, z: d.mesh.position.z,
      note: "tallest clear drift, crest " + d.mesh.scale.y.toFixed(2) + " m" }));
    if (!cands.length && standing.length) {
      // before-build fallback: where the drift WOULD be, widest walls first
      const byGirth = standing.slice().sort((a, b) => Math.max(b.w, b.d) - Math.max(a.w, a.d));
      for (const b of byGirth.slice(0, 6)) {
        const L = leeOf(b);
        cands.push({ x: L.x, y: gy(L.x, L.z), z: L.z, note: "lee point (no drift exists on this build)" });
      }
    }
    for (const target of cands) {
      // shoot from further DOWNWIND, low, looking back up the wind so the
      // building face reads behind its own drift
      const e = { x: target.x + wx * 8 + px * 3.5, y: target.y + 2.4, z: target.z + wz * 8 + pz * 3.5 };
      if (insideBuilding(e.x, e.z)) continue;
      const g = gy(e.x, e.z); if (e.y < g + 1.7) e.y = g + 1.7;
      eye = e;
      look = { x: target.x, y: target.y + 0.6, z: target.z };
      note = target.note;
      break;
    }
  } else if (cam.aim === "huddle") {
    // the wall with the most living people in its lee, and the open ground
    // behind them in frame
    let bestB = null, bestN = -1, bestL = null;
    for (const b of standing) {
      const L = leeOf(b);
      let n = 0;
      for (const x of bots) {
        const dx = x.pos.x - L.x, dz = x.pos.z - L.z;
        if (dx * dx + dz * dz < 8 * 8) n++;
      }
      if (n > bestN) { bestN = n; bestB = b; bestL = L; }
    }
    if (bestL) {
      // crosswind eye; if that stands in a neighbouring shell, mirror it
      let e = { x: bestL.x + px * 13 + wx * 5, y: gy(bestL.x, bestL.z) + 4.5, z: bestL.z + pz * 13 + wz * 5 };
      if (insideBuilding(e.x, e.z)) e = { x: bestL.x - px * 13 + wx * 5, y: e.y, z: bestL.z - pz * 13 + wz * 5 };
      const g = gy(e.x, e.z); if (e.y < g + 2.2) e.y = g + 2.2;
      eye = e;
      look = { x: bestL.x, y: gy(bestL.x, bestL.z) + 1.1, z: bestL.z };
      note = bestN + " in this lee";
    }
  } else if (cam.aim === "frozen") {
    // a body that actually froze (V2 marks them), else any corpse, else the
    // coldest living actor still out in it
    const dead = (CBZ.bots || []).filter((b) => b && b.dead && b.group && b.group.parent);
    let b = dead.find((x) => x._blzFrozen) || dead[0];
    let kind = b ? (b._blzFrozen ? "frozen corpse" : "corpse (not frozen)") : null;
    if (!b && bots.length) {
      b = bots.reduce((m, x) => ((x._blzCold || 0) > (m._blzCold || 0) ? x : m), bots[0]);
      kind = "coldest living, cold " + ((b._blzCold || 0).toFixed(2));
    }
    if (b) {
      eye = { x: b.pos.x + px * 5.5 - wx * 2, y: b.pos.y + 2.2, z: b.pos.z + pz * 5.5 - wz * 2 };
      const g = gy(eye.x, eye.z); if (eye.y < g + 1.5) eye.y = g + 1.5;
      look = { x: b.pos.x, y: b.pos.y + 0.5, z: b.pos.z };
      note = kind;
    }
  } else if (cam.aim === "aerial") {
    /* low enough that the drift lobes and the mounds read as SHAPES. The
       target is the SAME solve on both builds — the lee point of the widest
       standing wall, where the biggest drift forms — so before and after
       photograph the same street corner, drifts or no drifts. */
    let wb2 = standing[0];
    for (const b of standing) if (Math.max(b.w, b.d) > Math.max(wb2.w, wb2.d)) wb2 = b;
    const L2 = wb2 ? leeOf(wb2) : { x: A.cx, z: A.cz };
    const t2 = { x: L2.x, y: gy(L2.x, L2.z), z: L2.z };
    eye = { x: t2.x + wx * 22 + px * 9, y: t2.y + 19, z: t2.z + wz * 22 + pz * 9 };
    look = { x: (t2.x + A.cx) / 2, y: 1, z: (t2.z + A.cz) / 2 };
    note = "aerial over the widest wall's lee";
  }
  if (!eye) {
    eye = { x: A.cx + 40, y: 20, z: A.cz + 40 };
    look = { x: A.cx, y: 2, z: A.cz };
    note = note || "fallback";
  }
  if (!cam.hold) S.cam = { eye, look, note };

  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55; camera.near = 0.4; camera.far = 20000;
  camera.position.set(eye.x, eye.y, eye.z);
  camera.lookAt(look.x, look.y, look.z);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(camera.position.x, 0, camera.position.z);
  }
  setHud(false);
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  const ba = (typeof CBZ.blizzardAudit === "function") ? CBZ.blizzardAudit() : {};
  const wAudit = (CBZ.weather && typeof CBZ.weather.audit === "function") ? CBZ.weather.audit() : {};
  const fog = CBZ.scene && CBZ.scene.fog;

  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector(`[data-${n}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:212px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:360px";
  q("focus").textContent =
    `${CBZ.disasters.current() || "—"} · ${CBZ.disasters.state()} · subject: ${note}` +
    (ba.v2 ? "" : " · LEGACY STORM");
  q("focus").style.cssText = "position:absolute;top:250px;left:27px;color:#c0cfda;font-size:12px;font-weight:550;max-width:380px";
  q("perf").textContent =
    `fog ${fog ? fog.far.toFixed(0) : "?"} m · gust ${ba.gust != null ? ba.gust : "—"} · cover ${(ba.snowCover != null ? ba.snowCover : (wAudit.snowCover || 0))}\n` +
    `drifts ${ba.drifts || 0} (crest ${ba.driftMaxH || 0} m) · mounds ${ba.mounds || 0}\n` +
    `frozen ${ba.frozen || 0} · lee ${ba.inLee || 0} · roofed ${ba.roofed || 0} · open ${ba.exposed || 0}\n` +
    `sim ${ticks} ticks · avg ${(ticks ? totalMs / ticks : 0).toFixed(1)}ms · worst ${maxMs.toFixed(0)}ms`;
  q("perf").style.cssText = `position:absolute;right:24px;top:24px;text-align:right;white-space:pre;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:${maxMs > 100 ? "#ff9c9c" : "#9fe8c3"}`;
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {
    fogFarM: fog ? Number(fog.far.toFixed(1)) : 0,
    snowCover: Number(ba.snowCover != null ? ba.snowCover : (wAudit.snowCover || 0)),
    drifts: Number(ba.drifts || 0),
    driftMaxH: Number(ba.driftMaxH || 0),
    mounds: Number(ba.mounds || 0),
    frozenDeaths: Number(ba.frozen || 0),
    botsInLee: Number(ba.inLee || 0),
    botsExposed: Number(ba.exposed || 0),
    coldMax: Number(ba.coldMax || 0),
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
    ticksOver33: over33,
    drawCalls: Number(render.calls || 0),
  };

  return { ok: true, disaster: CBZ.disasters.current(), state: CBZ.disasters.state(), note, metrics };
}

export default {
  id: "blizzard-stages",
  title: "The Blizzard That Takes Your Eyes",
  description: "One seeded survival match per build, the director forced to the blizzard and stepped through the same simulated seconds. Before (this same checkout, cfg_BLIZZARD_V2=0): a flat 60 m fog, snow particles, and a damage tax on standing still. After: visibility that breathes down to a 12 m whiteout in gusts, a windchill clock on every unsheltered actor — moving buys time, only a roof or a windbreak buys safety — a bot crowd that huddles on the lee faces, real drifts piling downwind of every building, rimed corpses, and mounds the storm buries them under, all of it persisting past the all-clear. Every camera is solved off the live world (the actual wind bearing, the actual tallest drift, an actual frozen body).",
  beforeLabel: "BEFORE · V2 OFF",
  afterLabel: "AFTER · BLIZZARD V2",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  defaultBefore: "local",
  beforeParams: { cfg_BLIZZARD_V2: 0 },
  stageTimeoutMs: 480000,
  metricsNote: "Numbers come from CBZ.blizzardAudit() (live storm state at the moment of the frame) plus the scene's real fog distance. fogFarM is what you can actually see — 60 flat on the legacy build, breathing 12-44 on V2 (lower at these staged gust beats = the whiteout exists). drifts/driftMaxH/mounds are real meshes in the world; frozenDeaths are killfeed deaths whose clock this storm ran out; botsInLee counts the crowd the steering actually got behind a wall.",
  metrics: {
    fogFarM: { label: "Visibility (fog far)", unit: "m", better: "lower" },
    snowCover: { label: "Ground snow cover", better: "higher" },
    drifts: { label: "Lee-side drifts", better: "higher" },
    driftMaxH: { label: "Tallest drift crest", unit: "m", better: "higher" },
    mounds: { label: "Burial mounds", better: "higher" },
    frozenDeaths: { label: "Frozen-clock deaths", better: "higher" },
    botsInLee: { label: "Bots holding a windbreak", better: "higher" },
    coldMax: { label: "Worst core cold", better: "higher" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageBlizzard,
};
