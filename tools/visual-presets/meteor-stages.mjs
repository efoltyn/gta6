/* THE METEOR SHOWER storyboard for tools/visual-compare.mjs.

   Skeleton lifted from quake-stages.mjs (same boot, same rAF freeze, same
   CBZ.stepSim clock), narrowed to the meteor event and staged along the REAL
   timeline of one — because a meteor event has a shape, and every beat of
   that shape is a thing the old shower simply did not have:

     radiant (a/b)   the warning: streaks crossing the sky. Shot as a PAIR
                     0.5 s apart from one camera. In the new build every
                     streak shares ONE heading (a shower is one debris
                     stream); the old build's streaks come from everywhere.
     inbound         a rock on its way DOWN: glowing head, incandescent tail,
                     smoke train, aimed at a marked point. The old build's
                     "rock" was a brown box teleport-dropped from y=40.
     bolide          the Chelyabinsk moment, mid-flight: the big one crossing
                     low with the world visibly lit by it.
     flash           the terminal airburst. Light arrives NOW; the world has
                     heard NOTHING yet.
     the-wait        seconds later: the smoke ball hangs where the rock was,
                     the crowd is still standing, and the bang is still in
                     flight. The single most characteristic beat of the whole
                     event — flash, then silence.
     bang            the pressure front arrives: a ring sweeping the ground
                     at the speed of sound, knocking the crowd flat, with the
                     audio scheduled onto the same wavefront.
     crater          what a ground strike leaves: a REAL carved bowl (the
                     same crater a bomb digs), incandescent ejecta thrown out
                     on ballistic arcs and glowing in the grass. The old
                     build painted a flat transient decal.
     sky-wide        the whole event: streaks from one radiant, smoke trains
                     drifting on the wind, the island under it.

   CAMERAS ARE SOLVED, NOT TYPED (quake-stages' law): every beat asks the
   LIVE world — CBZ.disasterAudit().meteor publishes the actual bolide
   positions, the burst point, the dug craters — and frames THAT. A beat
   whose subject does not exist on a build says so in the frame instead of
   lying, which is exactly what the before side of `crater` should do.

   FLAG A/B, same checkout: before = cfg_METEOR_V2=0 (the legacy shower,
   verbatim), after = default. The deployed build is not reachable from the
   sandbox and is not needed — the flag-off path IS the old behaviour. */

const subjects = [
  { id: "radiant-a", label: "The radiant — frame 1 of 2", pair: "radiant",
    focus: "Warn phase. Streaks cross the sky before anything lands. NEW: every streak arrives from ONE direction — the radiant — because a shower is one debris stream the planet is driving through. OLD: random headings, i.e. fireworks. Compare against frame 2: the new streaks all travel the same way.",
    act: { force: "meteor", untilState: "warn", extraSecs: 2.2 },
    cam: { aim: "radiant" } },
  { id: "radiant-b", label: "The radiant — frame 2 of 2", pair: "radiant",
    focus: "The same camera 0.5 s later. Every new-build streak has advanced along the SAME heading; the old build's have advanced along many.",
    act: { extraSecs: 0.5 },
    cam: { aim: "radiant", hold: true } },

  /* From here every beat is pinned to an ABSOLUTE sim-second of the meteor's
     active phase (`atSecs`) off the disaster's own clock, so a --subjects
     subset lands on the same moment as the full storyboard. Def timeline
     (V2): first strike launched ~1.0 s (always a ground hit, eta 1.5-2.1 s),
     the big bolide launched at exactly 5.0 s with eta 3.2 s → burst 8.2 s,
     bang crawling in at 65 m/s over the following seconds. */
  { id: "inbound", requireMeteor: true, label: "A rock on its way down",
    focus: "The first ground strike inbound: a glowing head with an incandescent tail and a smoke train, tracking to the marked point (the marker is the shadow it casts). The old build shows the marker and, at best, a thin streak — the 'rock' itself is a brown box that pops into existence at y=40.",
    act: { atSecs: 2.1 },
    cam: { aim: "inbound" } },

  { id: "bolide", requireMeteor: true, label: "The big one, mid-flight",
    focus: "The Chelyabinsk moment: one huge bolide crossing low, brighter than the sun — the def feeds meteor.js's light back into the scene, so the world under it is visibly LIT. The old build has nothing at this second but random streaks.",
    act: { atSecs: 7.3 },
    cam: { aim: "bolide" } },

  { id: "flash", requireMeteor: true, label: "Airburst — light arrives first",
    focus: "The terminal flash, just after detonation ~100 m up. Whiteout, the island lit hard, a smoke ball forming where the rock ceased to exist. NOTHING has made a sound yet — the bang is scheduled at distance over sound-speed and is still in flight.",
    act: { atSecs: 8.45 },
    cam: { aim: "burst" } },

  { id: "the-wait", requireMeteor: true, label: "The wait — flash, then silence",
    focus: "~1.3 s after the flash. The smoke ball hangs, the crowd is still on its feet, and the pressure front (which IS the bang) is still crawling down at the dramatic speed of sound. The old build had zero seconds between light and sound, ever.",
    act: { atSecs: 9.6 },
    cam: { aim: "burst" } },

  { id: "bang", requireMeteor: true, label: "The bang — the front arrives",
    focus: "The pressure ring sweeping the ground outward from under the burst, arriving with the audio it carries: knockdown, glass, structure damage in the annulus, all riding one wavefront. Chelyabinsk's model — it knocks you down and cuts you, it does not vaporise you.",
    act: { atSecs: 10.6 },
    cam: { aim: "front" } },

  { id: "crater", requireMeteor: true, label: "The hole it leaves",
    focus: "A ground strike's aftermath: a REAL carved bowl through CBZ.groundCrater — raised lip, permanent, the same hole a bomb digs — with incandescent ejecta thrown out on ballistic arcs and left glowing. The old build painted a flat dark disc and called it a crater; on the before side this camera photographs unbroken ground.",
    act: { atSecs: 14.2 },
    cam: { aim: "crater" } },

  { id: "sky-wide", requireMeteor: true, label: "The event, whole",
    focus: "Wide: streaks still arriving from the one radiant, smoke trains drifting on THE wind (the same vector every other system reads), the island marked by craters and glowing rock. An astronomical event over a place — not particles over a floor.",
    act: { atSecs: 15.6 },
    cam: { aim: "wide" } },
];

async function stageMeteor(input) {
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
      if (child.id === "__meteorOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__meteorSeq;
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
    overlay.id = "__meteorOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__meteorSeq = { overlay, cam: null, t0: null };
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

  /* ORDER-INDEPENDENCE (quake-stages' rule): a --subjects subset must land
     on the same moments as the full storyboard. Any beat that needs the
     meteor re-forces it and seeks to its own absolute second. */
  const armMeteor = () => {
    CBZ.disasters.force("meteor"); step(0.1);
    stepUntilState("active", 40);
    S.t0 = CBZ.disasters.timeLeft();
  };
  if (subject.requireMeteor && CBZ.disasters.current() !== "METEOR SHOWER" && !act.force) armMeteor();
  if (act.force) {
    CBZ.disasters.force(act.force); step(0.1);
    S.t0 = null;
  }
  if (act.untilState) stepUntilState(act.untilState, 40);
  if (act.atSecs != null) {
    if (CBZ.disasters.state() !== "active") stepUntilState("active", 40);
    if (S.t0 == null) S.t0 = CBZ.disasters.timeLeft();
    let guard = 900;
    while (guard-- > 0 && CBZ.disasters.state() === "active" &&
           CBZ.disasters.current() === "METEOR SHOWER" &&
           (S.t0 - CBZ.disasters.timeLeft()) < act.atSecs) step(0.05);
  }
  if (act.extraSecs) step(act.extraSecs);

  // ---- read the live event state the cameras solve off -------------------
  const da = (typeof CBZ.disasterAudit === "function") ? CBZ.disasterAudit() : {};
  const M = da.meteor || null;                       // meteor.js's ratchet (null on a build without the file)
  const A = (CBZ.surv && CBZ.surv.arena) || null;
  const cx = A ? A.center.x : 0, cz = A ? A.center.z : 600, R = A ? A.radius : 120;
  const gy = (x, z) => { try { return CBZ.surv.arena.groundHeightAt(x, z); } catch (_) { return 0; } };

  const cam = subject.cam || {};
  let eye = null, look = null, note = "";
  // the radiant's horizontal heading, for placing cameras SIDE-ON to the
  // stream so streaks cross the frame instead of coming at the lens
  const az = M && M.radiantAz != null ? M.radiantAz : 0.8;
  const perp = { x: -Math.sin(az), z: Math.cos(az) };

  /* NEVER PHOTOGRAPH THE BACK OF A TOWER. The first pass of this preset put
     both the flash and the crater behind a building, because "perpendicular
     to the radiant" says nothing about what stands there. A scene raycast
     turned out to lie (exceptions inside intersectObjects read as "clear"),
     so the test is a CORRIDOR against the arena's own building roster: a
     candidate eye is rejected if the sightline passes through any standing
     fragile building's footprint below its roofline. All azimuths blocked →
     go overhead, which for a crater is the best shot anyway. */
  const fragile = (A && A.fragile) || [];
  const corridorClear = (e, t) => {
    const dx = t.x - e.x, dz = t.z - e.z;
    const L2 = dx * dx + dz * dz; if (!L2) return true;
    for (const b of fragile) {
      if (b.fallen) continue;
      const u = ((b.x - e.x) * dx + (b.z - e.z) * dz) / L2;
      if (u <= 0.02 || u >= 0.92) continue;
      const px = e.x + dx * u, pz = e.z + dz * u;
      const half = Math.max(b.w || 6, b.d || 6) * 0.5 + 2.5;
      if (Math.hypot(b.x - px, b.z - pz) > half) continue;
      const hAt = e.y + (t.y - e.y) * u;
      if (hAt < (b.gy || 0) + (b.h || 10) + 1) return false;
    }
    return true;
  };
  const clearEye = (target, dist, eyeY) => {
    const baseAz = Math.atan2(perp.z, perp.x);
    const offs = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, Math.PI, 2.4, -2.4];
    let fallback = null;
    for (const off of offs) {
      const a = baseAz + off;
      const e = { x: target.x + Math.cos(a) * dist, y: eyeY, z: target.z + Math.sin(a) * dist };
      try { const g = CBZ.floorAt ? CBZ.floorAt(e.x, e.z) : 0; if (e.y < g + 2) e.y = g + 2; } catch (_) {}
      if (!fallback) fallback = e;
      if (corridorClear(e, target)) return e;
    }
    return { x: fallback.x, y: Math.max(eyeY, target.y) + dist * 1.1, z: fallback.z };
  };

  if (cam.hold && S.cam) {
    eye = S.cam.eye; look = S.cam.look; note = S.cam.note + " (held)";
  } else if (cam.aim === "radiant") {
    // high and outside the town, most of the frame SKY, skyline at the foot
    eye = { x: cx + perp.x * R * 1.05, y: 58, z: cz + perp.z * R * 1.05 };
    look = { x: cx, y: 185, z: cz };
    note = M ? "side-on to radiant az " + az.toFixed(2) : "sky (no radiant on this build)";
  } else if (cam.aim === "inbound") {
    const b = M && M.bolides ? M.bolides.find((k) => !k.air) || M.bolides[0] : null;
    if (b) {
      look = { x: (b.x + b.tx) / 2, y: (b.y + gy(b.tx, b.tz)) / 2, z: (b.z + b.tz) / 2 };
      eye = clearEye(look, 48, gy(b.tx, b.tz) + 7);
      note = "bolide at y=" + b.y.toFixed(0) + ", eta " + b.eta + "s";
    } else {
      look = { x: cx, y: 45, z: cz };
      eye = clearEye(look, 55, 9);
      note = "no live bolide on this build";
    }
  } else if (cam.aim === "bolide") {
    const b = M && M.bolides ? M.bolides.find((k) => k.big) || M.bolides[0] : null;
    if (b) {
      look = { x: b.x, y: b.y, z: b.z };
      eye = clearEye(look, 115, Math.max(14, b.y * 0.45));
      note = "big bolide at y=" + b.y.toFixed(0) + ", light " + (M.lightBoost || 0);
    } else {
      look = { x: cx, y: 120, z: cz };
      eye = clearEye(look, 115, 30);
      note = "no big bolide on this build";
    }
  } else if (cam.aim === "burst" || cam.aim === "front") {
    // the BIG burst is the subject even if a routine one popped since
    const bu = M ? (M.lastBigBurst || M.lastBurst || null) : null;
    const bx = bu ? bu.x : cx, bz = bu ? bu.z : cz, by = bu ? bu.y : 100;
    if (cam.aim === "burst") {
      // street level, looking UP at the burst point — the human view of it
      look = { x: bx, y: by, z: bz };
      eye = clearEye(look, 85, gy(bx, bz) + 2.5);
    } else {
      // high and back, so the ground ring reads as a ring
      look = { x: bx, y: gy(bx, bz), z: bz };
      eye = clearEye(look, 150, 95);
    }
    note = bu ? "burst at (" + bx.toFixed(0) + "," + by.toFixed(0) + "," + bz.toFixed(0) + ") t=" + bu.t.toFixed(1) : "no burst on this build";
  } else if (cam.aim === "crater") {
    const c = M && M.craters && M.craters.length ? M.craters[0] : null;
    const ix = c ? c.x : (M && M.lastImpact ? M.lastImpact.x : cx);
    const iz = c ? c.z : (M && M.lastImpact ? M.lastImpact.z : cz);
    const r = c ? c.r : 8;
    look = { x: ix, y: gy(ix, iz) - 1, z: iz };
    eye = clearEye(look, r * 2.4 + 9, gy(ix, iz) + r * 1.2 + 5);
    note = c ? "crater r=" + c.r + " at (" + ix.toFixed(0) + "," + iz.toFixed(0) + ")" : "NO CRATER EXISTS on this build";
  } else { // wide
    eye = { x: cx + perp.x * R * 1.5, y: 90, z: cz + perp.z * R * 1.5 };
    look = { x: cx, y: 60, z: cz };
    note = "wide";
  }
  if (!cam.hold) S.cam = { eye, look, note };

  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55; camera.near = 0.4; camera.far = 20000;
  // never stand inside the ground (quake-stages' guard)
  try { const g = CBZ.floorAt ? CBZ.floorAt(eye.x, eye.z) : 0; if (eye.y < g + 2) eye.y = g + 2; } catch (_) {}
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

  /* ---- the numbers ------------------------------------------------------ */
  // radiant spread: circular dispersion of the live streak headings, in
  // degrees. One shared radiant → a few degrees of scatter; the legacy
  // random-heading streaks → 40-100+. Both builds publish their dirs.
  const dirs = (M && M.streakDirs && M.streakDirs.length ? M.streakDirs : null) ||
    (da.meteorLegacyStreakDirs && da.meteorLegacyStreakDirs.length ? da.meteorLegacyStreakDirs : null);
  let spread = null;
  if (dirs && dirs.length >= 2) {
    let sx = 0, sz = 0;
    for (const d of dirs) { const L = Math.hypot(d.x, d.z) || 1; sx += d.x / L; sz += d.z / L; }
    const Rbar = Math.min(1, Math.hypot(sx, sz) / dirs.length);
    spread = +(Math.sqrt(Math.max(0, -2 * Math.log(Math.max(1e-6, Rbar)))) * 57.2958).toFixed(1);
  }

  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector(`[data-${n}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:212px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:360px";
  q("focus").textContent =
    `${CBZ.disasters.current() || "—"} · ${CBZ.disasters.state()} · ${note}` +
    (da.meteorV2 ? "" : " · LEGACY SHOWER");
  q("focus").style.cssText = "position:absolute;top:250px;left:27px;color:#c0cfda;font-size:12px;font-weight:550;max-width:380px";
  q("perf").textContent =
    `streaks ${M ? M.streaksLive : (dirs ? dirs.length : 0)} live · spread ${spread == null ? "—" : spread + "°"}\n` +
    `airbursts ${M ? M.airbursts : 0} · impacts ${M ? M.groundImpacts : 0} · craters ${M ? M.cratersDug : 0} · ejecta ${M ? M.ejecta : 0}\n` +
    `flash→bang max ${M ? M.flashToBangMax : 0}s · bangs ${M ? M.bangsHeard : 0} heard / ${M ? (M.bangsPending || 0) : 0} in flight\n` +
    `sim ${ticks} ticks · avg ${(ticks ? totalMs / ticks : 0).toFixed(1)}ms · worst ${maxMs.toFixed(0)}ms`;
  q("perf").style.cssText = `position:absolute;right:24px;top:24px;text-align:right;white-space:pre;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:${maxMs > 100 ? "#ff9c9c" : "#9fe8c3"}`;
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {
    radiantSpreadDeg: spread == null ? null : spread,
    airbursts: M ? Number(M.airbursts || 0) : 0,
    cratersDug: M ? Number(M.cratersDug || 0) : 0,
    ejecta: M ? Number(M.ejecta || 0) : 0,
    flashToBangMax: M ? Number(M.flashToBangMax || 0) : 0,
    smokeAloft: M ? Number(M.smokeLive || 0) : 0,
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
    ticksOver33: over33,
    drawCalls: Number(render.calls || 0),
  };

  return { ok: true, disaster: CBZ.disasters.current(), state: CBZ.disasters.state(), note, meteor: M, metrics };
}

export default {
  id: "meteor-stages",
  title: "The Meteor Event",
  description: "One seeded survival match per build, the director forced to the meteor shower and stepped through the same simulated seconds. Before (cfg_METEOR_V2=0): streaks on random headings, a brown box dropped from y=40, an instant bang, a painted decal for a crater. After: one radiant every rock shares, visible bolides with smoke trains, an airburst whose flash arrives seconds before its bang, a pressure front that IS the bang, real dug craters and incandescent ejecta. Cameras are solved off the live audit state, so each frame photographs its real subject.",
  beforeLabel: "BEFORE · METEOR_V2 OFF",
  afterLabel: "AFTER · METEOR_V2 ON",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  defaultBefore: "local",
  beforeParams: { cfg_METEOR_V2: 0 },
  stageTimeoutMs: 480000,
  metricsNote: "All counts from CBZ.disasterAudit().meteor (systems/meteor.js's ratchet), measured off live state at the frame. radiantSpreadDeg is the circular dispersion of the live streak headings — a shower has ONE radiant, so lower is more real; the legacy build publishes its streak headings too, so the number is honest on both sides. flashToBangMax is the seconds between a burst's light and its scheduled bang at the listener — the legacy build's is identically 0.",
  metrics: {
    radiantSpreadDeg: { label: "Radiant spread", unit: "deg", better: "lower" },
    airbursts: { label: "Airbursts", better: "higher" },
    cratersDug: { label: "Real craters dug", better: "higher" },
    ejecta: { label: "Ejecta thrown", better: "higher" },
    flashToBangMax: { label: "Flash→bang, max", unit: "s", better: "higher" },
    smokeAloft: { label: "Smoke-train puffs aloft", better: "higher" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageMeteor,
};
