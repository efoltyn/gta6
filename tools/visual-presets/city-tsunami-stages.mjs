/* THE CITY TSUNAMI, STAGE BY STAGE — the storyboard the city event never had.

   tsunami-stages.mjs photographs the ISLAND event. The city event is the
   other half of the same design — same face, same debris field, same
   undertow, same flags (city/tsunami.js declares them for both) — and until
   now it had no storyboard at all, so every change to it was argued from a
   probe that could say "it did not throw" and nothing else. TSU_PACE_V2 was
   landed on this event with exactly that much evidence. This is the picture.

   WHAT THE CITY EVENT IS. One number — the sea level — plus a FRONT walked by
   the same easing, so the wall can never be somewhere the water is not. It
   fires on the waterfront the player is standing on, its bearing is the
   direction the sea actually lies in from them, and its arc is five named
   beats: the sea goes out, holds there, comes back, stands, and leaves.

   STAGED like tsunami-stages.mjs: boot the real game into Gang City, freeze
   the rAF loop so CBZ.stepSim is the only clock, stand the player on the
   beach, trigger CBZ.cityTsunami() and photograph named beats of ONE seeded
   run per side.

   EVERY BEAT IS PHYSICAL. Not one of them waits a number of seconds, because
   the number of seconds is the thing under comparison: they wait on the
   phase, on where the front is, on how far the surge has fallen. That is what
   lets the clock in the corner be read as the answer instead of as the
   question — both sides reach the SAME picture, and `Clock at beat` says how
   long each of them took to get there.

   FLAG A/B by default: both sides are this checkout and the before side boots
   with ?cfg_TSU_PACE_V2=0, which is the 77-second arc this event used to run.

   Staging facts:
   - The city arena is CBZ.city.arena {shore:{beach:{x0,x1}, ES}, root}; the
     mode's own reset() must run after setMode or the world stands built and
     invisible (beach-shores.mjs learned this with a raycast probe).
   - CBZ.cityTsunamiState() publishes the origin (cx,cz), the bearing (dx,dz),
     the front, the clock and the crash — every tripod below is expressed
     RELATIVE to those, because the bearing is different on every run.
   - The player is healed every tick and parked inland of every tripod; the
     storyboard must not end in WASTED, and the drowning is real. */

const beats = [
  {
    id: "seafront",
    label: "The seafront, before",
    focus: "The waterfront a few seconds before the sea reads wrong. Palms, parked cars, street furniture — every object in this frame is a real world object, and the ones the water can lift are the ones that come back through the town inside the wave.",
    wait: { phase: "draw", untilDrawFrac: 0.06 },
    shot: { mode: "origin", back: -150, side: 40, alt: 30, aimAhead: -40, aimY: 2 },
  },
  {
    id: "drawdown",
    label: "The drawdown — the only warning",
    focus: "The sea has emptied off the shelf and the harbour floor is showing. There is no siren text and no banner: this IS the warning, and the whole question the pacing change asks is how long you should have to stand here looking at it before the answer arrives.",
    wait: { phase: "draw", untilDrawFrac: 0.97 },
    shot: { mode: "origin", back: -150, side: 40, alt: 30, aimAhead: -40, aimY: 2 },
  },
  {
    id: "lull",
    label: "The lull — it holds there, low and wrong",
    focus: "The sea stops going out and simply stays out. Nothing moves. This beat exists to be short: it is the pause before the turn, and a pause you can get bored inside is not tension, it is dead air.",
    wait: { phase: "lull" },
    shot: { mode: "origin", back: -120, side: 96, alt: 34, aimAhead: -30, aimY: 4 },
  },
  {
    id: "inbound",
    label: "It's coming back",
    focus: "The front is released and still well offshore, with all its speed and not yet all its height. The level under it is climbing on the same easing that walks it, so the water and the wall can never disagree about where the event is.",
    wait: { untilFrontAt: -110 },
    shot: { mode: "front", back: -95, side: 128, alt: 48, aimAhead: 0, aimY: 12 },
  },
  {
    id: "stand",
    label: "THE STAND — the wall over the seawall",
    focus: "The last metres of shoaling: the front has traded its speed for height and TOWERS over the waterfront, at its tallest, steepest and most overhung. The world has gone quiet (audioHush) waiting for the lip. This is the beat that must survive the retiming — it is a held breath, not a parked wave.",
    wait: { untilFrontAt: -13 },
    shot: { mode: "front", back: -105, side: 86, alt: 26, aimAhead: -6, aimY: 22 },
  },
  {
    id: "crash",
    label: "THE CRASH — the lip comes down",
    focus: "The stand ends all at once: white water erupts along the whole front and the released bore goes into the streets. crash+ in the corner is how long ago it broke — the picture is the same on both sides, the clock is not.",
    wait: { untilCrashed: true },
    shot: { mode: "front", back: -88, side: 104, alt: 34, aimAhead: 4, aimY: 12 },
  },
  {
    id: "streets",
    label: "In the streets — the debris soup",
    focus: "The bore inside the town, gray-black with sediment and carrying what it took off the seafront: cars, palms, bins. THE THING TO CHECK HERE is that a shorter event still fills the water — entrainment is rate-limited, and halving the arc must not halve the wave's load.",
    wait: { untilFrontAt: 34 },
    shot: { mode: "front", back: 150, side: 62, alt: 74, aimAhead: 44, aimY: 0 },
  },
  {
    id: "hold",
    label: "The hold — the flood standing over the town",
    focus: "The front has run out and what is left is depth: the streets are under, the water is filthy, and the debris drifts through it. The sea sags a little as it spreads.",
    wait: { phase: "hold", untilHoldFrac: 0.5 },
    shot: { mode: "front", back: 170, side: 74, alt: 88, aimAhead: 60, aimY: 0 },
  },
  {
    id: "undertow",
    label: "The drain — the undertow",
    focus: "Half the flood already gone. Everything the wave carried in leaves through the same gap and faster than it arrived; swimming straight at it does not work, which is the whole point of the current.",
    wait: { untilDrainFrac: 0.5 },
    shot: { mode: "front", back: 150, side: 62, alt: 72, aimAhead: 44, aimY: 0 },
  },
  {
    id: "aftermath",
    label: "Aftermath — what it left",
    focus: "The sea is back where it started and the evidence is not: cars on their roofs in the street, palms across the road, the swept seafront. The debris does not disappear with the water.",
    wait: { untilOver: true },
    shot: { mode: "origin", back: -80, side: 46, alt: 26, aimAhead: 26, aimY: 1 },
  },
];

const subjects = beats.map((b) => ({
  id: b.id, label: b.label, focus: b.focus, wait: b.wait, shot: b.shot,
}));

async function stageCityTsunami(input) {
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__ctsuOverlay") continue;
      child.style.visibility = "hidden";
    }
  };

  let S = window.__ctsuSeq;
  if (!S) {
    // ---- one-time: boot the real game into Gang City ----------------------
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="city"]'),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    // the hitman campaign hijacks the first minutes of city play with its own
    // objectives and camera; a storyboard wants the free-play world
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    document.querySelector('[data-mode="city"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 240000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    const built = await until(() => CBZ.city && CBZ.city.arena && CBZ.city.arena.shore, 240000, 300);
    if (!built) return { ok: false, err: "city never built" };
    // headless SwiftShader settles into the LOW tier and the water's segment
    // count is tier-driven; the owner plays high, so pin it before the event
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    if (CBZ.setFPS) CBZ.setFPS(false);      // the first-person rifle photobombs otherwise

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);

    const overlay = document.createElement("div");
    overlay.id = "__ctsuOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);
    /* THE CLOCK IS OURS, not the event's. cityTsunamiState() disappears the
       frame the arc ends, and the aftermath beat is deliberately AFTER that —
       so the storyboard counts its own simulated seconds from the trigger and
       every beat, including the last one, reports a real time. */
    S = window.__ctsuSeq = { overlay, ticks: 0, simT: 0, maxDebris: { entrained: 0, strikes: 0, kills: 0 } };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };

    /* STAND ON THE BEACH. The event's bearing is read off the player — it
       fires toward the land they are standing on, out of the water nearest
       them — and it refuses to fire at all unless there is sea within 260 m.
       So the seafront is not a nice place to watch it from, it is the only
       place it exists. */
    const SH = CBZ.city.arena.shore;
    if (CBZ.player && CBZ.player.pos && SH && SH.beach) {
      CBZ.player.pos.set((SH.beach.x0 + SH.beach.x1) / 2, 0, SH.ES + 14);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
    }
    for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
    if (!CBZ.cityTsunami) return { ok: false, err: "no CBZ.cityTsunami" };
    /* PINNED SIZE. The event rolls a per-occurrence MAGNITUDE now (city/
       tsunami.js, seedStream("tsunami")); this storyboard's job is the beat-
       by-beat arc, so it pins the canonical 5.4 m event both sides always ran
       — the magnitude RANGE has its own preset (city-tsunami-sizes). On a
       build older than the roll, opts.peak was already honoured. */
    if (!CBZ.cityTsunami({ peak: 5.4 })) return { ok: false, err: "cityTsunami() refused to fire" };
    S.started = true;
  }

  const subject = input.subject;
  const w = subject.wait || {};
  const st = () => { try { return CBZ.cityTsunamiState(); } catch (_) { return null; } };
  const heal = () => {
    if (!CBZ.player) return;
    CBZ.player.hp = 100; CBZ.player.dead = false;
  };
  let ticks = 0, totalMs = 0, maxMs = 0, over33 = 0;
  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      const t0 = performance.now();
      CBZ.stepSim(1 / 60);
      const ms = performance.now() - t0;
      ticks++; totalMs += ms; S.simT += 1 / 60;
      if (ms > maxMs) maxMs = ms;
      if (ms > 33) over33++;
      heal();
    }
  };

  /* ---- poll to this beat's PHYSICAL moment (never a wall clock) ----------
     Every fraction below is a fraction of its OWN phase, read back off the
     live state, so a build that plays the arc at a different speed is still
     photographed at the same point of the same beat. */
  let guard = 0;
  if (w.phase) { guard = 0; while (guard++ < 8000 && (st() || {}).phase !== w.phase) step(1 / 30); }
  if (w.untilDrawFrac != null) {
    guard = 0;
    while (guard++ < 8000) {
      const s = st(); if (!s || s.phase !== "draw") break;
      if (s.draw && s.surge / s.draw >= w.untilDrawFrac) break;
      step(1 / 60);
    }
  }
  if (w.untilFrontAt != null) {
    guard = 0;
    while (guard++ < 8000) {
      const s = st(); if (!s) break;
      if (s.frontS >= w.untilFrontAt) break;
      step(1 / 60);
    }
  }
  if (w.untilCrashed) {
    guard = 0;
    while (guard++ < 8000) { const s = st(); if (!s || s.crashed) break; step(1 / 60); }
    step(0.2);                       // one beat of white water, not the frame it fires on
  }
  if (w.untilHoldFrac != null) {
    /* the hold sags from peak to 90% of peak across its whole length, which
       makes the surge itself the phase's own progress bar */
    guard = 0;
    while (guard++ < 8000) {
      const s = st(); if (!s) break;
      if (s.phase !== "hold") { step(1 / 30); continue; }
      const sag = (s.peak - s.surge) / Math.max(0.01, s.peak * 0.10);
      if (sag >= w.untilHoldFrac) break;
      step(1 / 60);
    }
  }
  if (w.untilDrainFrac != null) {
    guard = 0;
    while (guard++ < 8000) {
      const s = st(); if (!s) break;
      if (s.phase !== "drain") { step(1 / 30); continue; }
      // drainFrom is published by the train-aware build (the drain starts
      // from the LAST wave's hold, not necessarily from peak*0.9)
      const from = s.drainFrom != null ? s.drainFrom : s.peak * 0.9;
      if (s.surge <= from * (1 - w.untilDrainFrac)) break;
      step(1 / 60);
    }
  }
  if (w.untilOver) { guard = 0; while (guard++ < 12000 && st()) step(1 / 30); step(1.5); }

  // ---- frame it, RELATIVE TO THE LIVE FRONT -------------------------------
  const s2 = st();
  const last = S.last || null;
  const E = s2 || last || {};
  if (s2) S.last = { cx: s2.cx, cz: s2.cz, dx: s2.dx, dz: s2.dz, frontS: s2.frontS, t: s2.t, total: s2.total };
  const dx = Number.isFinite(E.dx) ? E.dx : 1;
  const dz = Number.isFinite(E.dz) ? E.dz : 0;
  const px = -dz, pz = dx;
  const ox = Number.isFinite(E.cx) ? E.cx : 0, oz = Number.isFinite(E.cz) ? E.cz : 0;
  const fs = Number.isFinite(E.frontS) ? E.frontS : 0;
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55; camera.near = 0.5; camera.far = 20000;
  const sh = subject.shot || {};
  /* WHICH POINT IS THE TRIPOD HUNG ON. The front is read back OFF THE LEVEL
     — that is the invariant that stops the wall being somewhere the water is
     not — and the level at rest is not zero on this scale, so during the
     drawdown "the front" walks BACKWARD out to sea as the sea empties. It is
     the honest number and it is the wrong anchor for a camera: the beats
     before the wave exists (seafront, drawdown, lull) and the one after it is
     gone (aftermath) hang on the event's ORIGIN, which is the piece of
     waterfront the whole event is about and does not move. */
  const anchor = sh.mode === "origin" ? 0 : fs;
  const fx = ox + dx * anchor, fz = oz + dz * anchor;
  const cx = fx - dx * (sh.back || 80) + px * (sh.side || 90);
  const cz = fz - dz * (sh.back || 80) + pz * (sh.side || 90);
  const ax = fx + dx * (sh.aimAhead || 0);
  const az = fz + dz * (sh.aimAhead || 0);
  camera.position.set(cx, sh.alt || 30, cz);
  camera.lookAt(ax, sh.aimY || 4, az);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) { skyRig.position.set(cx, 0, cz); skyRig.updateMatrixWorld(); }
  }
  hideHud();
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  /* THE LOAD IS A HIGH-WATER MARK. The field is disposed with the event, so
     asking it at the aftermath beat returns nothing — and "the wave carried
     nothing" is the one answer that would be a lie. Latch the peak. */
  const live = (s2 && s2.debris) || {};
  const M = S.maxDebris;
  M.entrained = Math.max(M.entrained, live.entrained || 0);
  M.strikes = Math.max(M.strikes, live.strikes || 0);
  M.kills = Math.max(M.kills, live.kills || 0);
  const deb = M;
  // the face exists only while the wall is up — latch its crest evidence
  if (s2 && s2.crestVar != null) S.crestVar = s2.crestVar;
  if (s2 && s2.endTaper != null) S.endTaper = s2.endTaper;
  if (s2 && s2.waves != null) S.waves = s2.waves;
  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = subject.label;
  /* A CAPTION HAS TO SURVIVE ITS OWN PICTURE. Half these frames are a pale
     overcast sky, and white-on-white is not a caption — every text block gets
     its own dark plate rather than relying on a text shadow. */
  query("name").style.cssText = "position:absolute;top:56px;left:22px;padding:6px 12px;border-radius:8px;background:rgba(6,12,17,.62);font-size:25px;font-weight:800;letter-spacing:-.02em;max-width:660px";
  query("focus").textContent = subject.focus;
  query("focus").style.cssText = "position:absolute;top:100px;left:22px;padding:8px 12px;border-radius:8px;background:rgba(6,12,17,.62);color:#cfdce6;font-size:12.5px;font-weight:550;max-width:640px;line-height:1.45";
  query("perf").textContent =
    `t ${S.simT.toFixed(1)}s / ${E.total != null ? E.total.toFixed(0) + "s" : "—"}`
    + ` · ${s2 ? s2.phase : "over"} · front ${fs.toFixed(0)}m`
    + ` · surge ${s2 ? s2.surge.toFixed(1) + "m" : "0.0m"}`
    + `${s2 && s2.crashed ? " · crash+" + s2.crashT.toFixed(1) + "s" : ""}`
    + ` · turbid ${(s2 ? s2.turbid : 0).toFixed(2)}`
    + ` · faceH ${s2 ? s2.faceH.toFixed(1) + "m" : "—"}`
    + ` · debris ${deb.entrained || 0} (${deb.strikes || 0} strikes, ${deb.kills || 0} kills)`;
  query("perf").style.cssText = "position:absolute;right:20px;top:20px;padding:7px 11px;border-radius:8px;background:rgba(6,12,17,.62);font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3;text-align:right;max-width:520px";
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:12px;left:22px;padding:4px 9px;border-radius:6px;background:rgba(6,12,17,.55);color:#a8bccb;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {
    /* THE CLOCK, which is the whole point of this preset: every beat is
       polled to the same physical moment, so this is how many seconds the
       event took to reach an identical picture. Lower is faster. */
    eventT: Number(S.simT.toFixed(2)),
    arcSecs: Number((E.total || 0).toFixed(1)),
    frontS: Number(fs.toFixed(1)),
    surge: Number(((s2 && s2.surge) || 0).toFixed(2)),
    faceH: Number(((s2 && s2.faceH) || 0).toFixed(1)),
    turbid: Number(((s2 && s2.turbid) || 0).toFixed(3)),
    /* WHAT THE WATER IS CARRYING. Entrainment is rate-limited (three objects
       every 0.25 s while there is depth to take them in), so a shorter arc
       has a shorter window — this is the number that says whether making the
       event faster also made it emptier. */
    debrisEntrained: Number(deb.entrained || 0),
    debrisStrikes: Number(deb.strikes || 0),
    debrisKills: Number(deb.kills || 0),
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
    ticksOver33: over33,
    drawCalls: Number(render.calls || 0),
    /* THE CREST EVIDENCE (2026-08-29). crestVar is the relative std-dev of
       crest height along the front — 0 is a ruler, which was the tell.
       endTaper is the end columns' height over the mean — 1 is the old flat
       end-cap standing full-height in open water. waves is the train. */
    waves: Number(S.waves || 1),
    crestVar: Number(((S.crestVar || 0)).toFixed(3)),
    endTaper: S.endTaper != null ? Number(S.endTaper.toFixed(3)) : 1,
  };

  return { ok: true, phase: s2 ? s2.phase : "over", frontS: metrics.frontS, metrics };
}

export default {
  id: "city-tsunami-stages",
  title: "The Gang City Tsunami: Drawdown, Stand, Crash, Undertow",
  description: "The city half of the tsunami, which had no storyboard until now. One seeded run per build on the Gang City waterfront, polled to the same PHYSICAL beats — the seafront before, the drawdown that is the only warning, the lull, the bore inbound, the wall STANDING over the seawall, the crash, the debris soup in the streets, the standing flood, the undertow and the wreckage it leaves. Flag A/B: both sides are this checkout, and the before side boots with TSU_PACE_V2 off — the 77-second arc the event used to run.",
  defaultBefore: "local",
  beforeParams: { cfg_TSU_PACE_V2: 0 },
  beforeLabel: "BEFORE · SLOW CLOCK (TSU_PACE_V2=0)",
  afterLabel: "AFTER · NORMAL SPEED",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 900000,
  metricsNote: "THE CLOCK IS THE HEADLINE. Every beat waits on a physical condition — the phase, where the front is, how far the surge has fallen — never on a number of seconds, so both sides reach the same picture and `Clock at beat` is how long each took to get there. arcSecs is the whole event's length. debrisEntrained is the invariant to watch: entrainment is rate-limited, so a faster arc has a shorter window to fill the water and must not end up carrying visibly less. frontS, surge, faceH and turbid have no good direction on their own — they exist to prove the two sides are photographing the same wave.",
  metrics: {
    eventT: { label: "Clock at beat", unit: "s", better: "lower" },
    arcSecs: { label: "Whole arc", unit: "s", better: "lower" },
    frontS: { label: "Front position", unit: "m" },
    surge: { label: "Surge", unit: "m" },
    faceH: { label: "Face height", unit: "m" },
    turbid: { label: "Turbidity" },
    debrisEntrained: { label: "Debris entrained", better: "higher" },
    debrisStrikes: { label: "Debris strikes", better: "higher" },
    debrisKills: { label: "Debris kills", better: "higher" },
    waves: { label: "Waves in the train", better: "higher" },
    crestVar: { label: "Crest variance along front", better: "higher" },
    endTaper: { label: "End-cap height / mean", better: "lower" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageCityTsunami,
};
