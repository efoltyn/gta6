/* ============================================================
   tools/visual-presets/weatherfx-ground.mjs

   WEATHER LEAVES STATE ON THE GROUND — the storyboard.

   OWNER: "rain makes flash flood which is gang city water slowly filling the
   ground" and "blizzard should fill ground with white slowly just like how the
   top of the mountain tip in nat disaster has white."

   Every beat is staged in the GANG CITY, on one street, from one tripod, with
   the rAF loop frozen and CBZ.stepSim as the only clock — so the difference
   between two frames is only ever how much weather has happened. Nothing here
   pokes a mesh: each beat asserts the engine's own levers

       CBZ.weatherDrive({rain, snow, pool, cover, fog, ...}, hold)
       CBZ.groundWaterFrontSet({x, z, dx, dz, s, width, speed})

   and then lets the world answer. That is the point of the shot: if the water
   in the picture came from a plane somebody drew, the preset would still
   photograph it — so `audit_privateWaterPlanes` is printed on the measurements
   page beside every frame, and it has to be zero.

   Run:
     node tools/visual-compare.mjs --preset weatherfx-ground \
       --before https://efoltyn.github.io/gta6/ --keep-going
   Iterate one side while building:
     node tools/visual-compare.mjs --preset weatherfx-ground \
       --before https://efoltyn.github.io/gta6/ --only after \
       --subjects torrent-front --keep-going --no-open
============================================================ */

export default {
  id: "weatherfx-ground",
  title: "Weather leaves state on the ground",
  description:
    "Rain that fills the streets, a flash-flood front that races them, and a blizzard that " +
    "buries them — staged on one gang-city street through the engine's own weather levers.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.CBZ && window.CBZ.game",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 900000,
  method:
    "One city boot per side. The rAF loop is frozen after boot and CBZ.stepSim(1/60) is the only " +
    "clock, so every beat is an exact number of simulated seconds from the same dry baseline. " +
    "Weather is asserted through CBZ.weatherDrive and CBZ.groundWaterFrontSet only — no beat " +
    "touches a material, a mesh or a camera-relative fake. Same seed, same street, same tripod.",
  metricsNote:
    "groundWater/snowCover are metres of standing water and 0..1 lying snow, read from " +
    "CBZ.weatherAudit(). privateWaterPlanes counts meshes claiming to be a water surface that " +
    "the shared field does not own: the whole design is that it stays 0 while the streets flood.",
  metrics: {
    groundWater: { label: "Standing water", unit: "m", better: "higher" },
    snowCover: { label: "Snow lying", unit: "0-1", better: "higher" },
    wetness: { label: "Wet look", unit: "0-1", better: "higher" },
    privateWaterPlanes: { label: "Private water planes", unit: "", better: "lower" },
    coatedMaterials: { label: "Coated surfaces", unit: "", better: "higher" },
    shinKnockdowns: { label: "Knocked off feet", unit: "", better: "higher" },
    carsFloated: { label: "Cars taken by water", unit: "", better: "higher" },
    drawCalls: { label: "Draw calls", unit: "", better: "lower" },
    stepMsAvg: { label: "Sim step", unit: "ms", better: "lower" },
  },
  defaultFocus:
    "Look at the GROUND: how much of it is wet, where the waterline sits against the kerb, " +
    "and how much of it has gone white.",

  subjects: [
    {
      id: "dry-street",
      label: "01 · Dry street (baseline)",
      focus: "The reference frame. Dry asphalt, dry kerbs, no coat, no standing water anywhere.",
      act: {},
    },
    {
      id: "rain-onset",
      label: "02 · Forty-five seconds of rain",
      focus: "Wet asphalt only. The rain has started but the ground has had no time to hold any of it.",
      act: { rain: 0.92, secs: 45, dt: 0.1 },
    },
    {
      id: "rain-5min",
      label: "03 · Three sim-minutes of rain",
      focus:
        "The carriageway is standing. Water sits in the road surface and the kerb line is still " +
        "above it — the road floods before the pavement does, which is what a kerb is for.",
      act: { rain: 0.98, secs: 150, dt: 0.1 },
    },
    {
      id: "kerb-deep",
      label: "04 · The streets carry water",
      focus:
        "Kerb-deep. The waterline has climbed the kerb onto the pavement, cars are flooding out " +
        "and anything standing in it is being pushed.",
      act: { rain: 1, pool: 0.42, secs: 26, dt: 0.1 },
    },
    {
      id: "torrent-front",
      label: "05 · The flash-flood front",
      focus:
        "The wall. Water to one side of the line, dry road to the other — the front is a term in " +
        "the depth field, so it is the SAME water the swimmer and the buoyancy solve are reading.",
      act: { rain: 1, pool: 1.5, front: true, frontS: 26, secs: 5 },
    },
    {
      id: "swept",
      label: "06 · Two feet of water",
      focus:
        "Past the front the street is a lake. Cars are off their tyres, the waterline is up the " +
        "building bases, and the depth is past the point where you swim rather than wade — the " +
        "gang city carriageway is dead flat, so this is a level, not a current.",
      act: { rain: 1, pool: 1.75, front: true, frontS: 900, secs: 22, dt: 0.05 },
    },
    {
      id: "drain-back",
      label: "07 · The drain-back",
      focus:
        "The rain has stopped. What is left is a wet, dark, stranded street — the drain takes " +
        "minutes, and it is the part of a flood that strands you.",
      act: { release: true, secs: 70, dt: 0.1 },
    },
    {
      id: "snow-dusting",
      label: "08 · The first snow lies",
      focus: "Green ground going grey-white at the edges. The blizzard has started to leave something.",
      act: { reset: true, snow: 1, cover: 0.22, fog: 0.5, secs: 12, dt: 0.05 },
    },
    {
      id: "snow-half",
      label: "09 · Half-whitened",
      focus:
        "Coverage on every up-facing surface — road, pavement, roofs, the tops of props — and " +
        "nothing on the walls. That asymmetry is why it reads as snow and not a colour filter.",
      act: { snow: 1, cover: 0.62, fog: 0.68, secs: 14, dt: 0.05 },
    },
    {
      id: "whiteout",
      label: "10 · Whiteout, buried props",
      focus:
        "Full coverage plus the fog wall. The street furniture is under it; the same trick as the " +
        "island's snow-capped peak, except it arrived and it will melt.",
      act: { snow: 1, cover: 1, fog: 0.9, secs: 16, dt: 0.05 },
    },
  ],

  // NOT a shorthand method: visual-compare.mjs serializes this with
  // `(${preset.stage.toString()})(...)`, and `async stage(input){}` is not a
  // valid expression once it is wrapped in parentheses.
  stage: async function (input) {
    const CBZ = window.CBZ;
    const subject = input.subject || {};
    const act = subject.act || {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, budgetMs, stepMs) => {
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) {
        try { if (test()) return true; } catch (_) {}
        await wait(stepMs || 250);
      }
      return false;
    };

    let S = window.__weatherSeq;
    if (!S) {
      // ---- ONE-TIME BOOT INTO CITY FREE PLAY ----
      const booted = await until(
        () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
          CBZ.stepSim && document.getElementById("playBtn"),
        300000
      );
      if (!booted) return { ok: false, err: "never booted" };
      if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
      const playing = await until(() => {
        if (CBZ.game.state === "playing") return true;
        const button = document.getElementById("playBtn");
        if (button) button.click();
        return CBZ.game.state === "playing";
      }, 180000, 300);
      if (!playing) return { ok: false, err: "never reached playing" };
      if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
      try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

      // Freeze the rAF loop; CBZ.stepSim is the only clock from here.
      window.requestAnimationFrame = function () { return 0; };
      await wait(700);
      for (let i = 0; i < 150; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

      // ---- pick ONE street and stand on it for every beat ----
      // A long, ordinary, non-highway road near the middle of the grid: the
      // camera looks ALONG it so the kerb line runs away from the lens, which
      // is the only way a waterline climbing that kerb is legible.
      const city = CBZ.city && CBZ.city.arena;
      const roads = (city && city.roads) || [];
      let best = null;
      for (const r of roads) {
        if (!r || r.elevated || r.noTraffic) continue;
        if (r.district === "highway" || r.district === "bridge") continue;
        if (!(r.len > 120) || !(r.w > 0) || r.w > 22) continue;
        const d = Math.hypot(r.x, r.z);
        if (d > 700) continue;
        if (!best || r.len > best.len) best = r;
      }
      let vx = 0, vz = 0, ax = 0, az = 40;
      if (best) {
        // stand a third of the way along it, looking down its length
        if (best.vertical) {
          vx = best.x + best.w * 0.32; vz = best.z - best.len * 0.30;
          ax = best.x; az = best.z + best.len * 0.30;
        } else {
          vx = best.x - best.len * 0.30; vz = best.z + best.w * 0.32;
          ax = best.x + best.len * 0.30; az = best.z;
        }
      } else {
        const lots = (city && city.lots) || [];
        let gx = 0, gz = 0, n = 0;
        for (const lot of lots) {
          const x = Number(lot.x != null ? lot.x : lot.cx);
          const z = Number(lot.z != null ? lot.z : lot.cz);
          if (Number.isFinite(x) && Number.isFinite(z)) { gx += x; gz += z; n++; }
        }
        vx = n ? gx / n : 0; vz = (n ? gz / n : 0) - 45;
        ax = vx; az = vz + 60;
      }
      const gy = (CBZ.floorAt && CBZ.floorAt(vx, vz)) || 0;

      // put the player on that street too, so the peds, the cars and the
      // hazard tick are all live where the camera is pointing
      try {
        if (CBZ.player && CBZ.player.pos && CBZ.player.pos.set) {
          CBZ.player.pos.set(vx + 2.5, gy, vz + 3);
          if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
        }
      } catch (_) {}
      for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

      const overlay = document.createElement("div");
      overlay.id = "__weatherOverlay";
      overlay.style.cssText =
        "position:fixed;left:0;right:0;bottom:0;z-index:99999;pointer-events:none;" +
        "font:600 13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#eaf2ff;" +
        "background:linear-gradient(transparent,rgba(6,10,16,.86));padding:26px 20px 12px";
      document.body.appendChild(overlay);
      window.__cbzVisualCompare = {
        render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
      };

      S = window.__weatherSeq = { vx, vz, gy, ax, az, overlay, t: 0 };
    }

    // ---- the clock ----
    let ticks = 0, totalMs = 0, maxMs = 0, over33 = 0;
    const heal = () => {
      if (!CBZ.player) return;
      CBZ.player.hp = 100; CBZ.player.dead = false;
      if (CBZ.player.breath != null) CBZ.player.breath = CBZ.player.breathMax || 28;
    };
    const drive = () => {
      // Re-asserted every tick with a short hold, exactly the way a disaster
      // def does it — so this preset exercises the same path the flash flood
      // and the blizzard use rather than a private back door.
      if (!CBZ.weatherDrive) return;
      if (act.release) return;   // a release beat asserts nothing, by definition
      const spec = {};
      if (act.rain != null) spec.rain = act.rain;
      if (act.snow != null) spec.snow = act.snow;
      if (act.pool != null) spec.pool = act.pool;
      if (act.cover != null) spec.cover = act.cover;
      if (act.fog != null) { spec.fog = act.fog; spec.fogColor = act.snow != null ? 0xdbe6f0 : 0x59636b; }
      if (act.rain != null && act.fog == null) { spec.fog = 0.35; spec.fogColor = 0x59636b; }
      spec.wind = act.snow != null ? 14 : 7;
      spec.windDir = { x: 1, z: 0.2 };
      CBZ.weatherDrive(spec, 1.5);
    };
    // WORLD_MAX in core/loop.js clamps a sim step at 0.10 s, so 0.1 is the
    // coarsest honest tick — the long accumulation beats use it (five sim
    // minutes is 3000 ticks, not 18000) and the fast ones stay at 1/60.
    const SDT = Math.min(0.1, Math.max(1 / 120, +act.dt || 1 / 60));
    const step = (secs) => {
      const n = Math.max(0, Math.round(secs / SDT));
      for (let i = 0; i < n; i++) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        drive();
        if (act.front && CBZ.groundWaterFrontSet) {
          CBZ.groundWaterFrontSet({
            x: S.vx, z: S.vz, dx: (S.ax - S.vx) || 1, dz: (S.az - S.vz),
            s: act.frontS != null ? act.frontS : 30, width: 15, crest: 0.6, speed: 9.5,
          });
        }
        const t0 = performance.now();
        CBZ.stepSim(SDT);
        const ms = performance.now() - t0;
        ticks++; totalMs += ms;
        if (ms > maxMs) maxMs = ms;
        if (ms > 33) over33++;
        S.t += SDT;
        heal();
      }
    };

    if (act.reset) {
      // hard cut between the water arc and the snow arc: the ground has to be
      // dry and green again before the blizzard is allowed to whiten it
      if (CBZ.weatherRelease) CBZ.weatherRelease();
      if (CBZ.groundWaterFrontSet) CBZ.groundWaterFrontSet(null);
      if (CBZ.weatherGroundReset) CBZ.weatherGroundReset();
      step(1);
    }
    if (act.release) {
      if (CBZ.weatherRelease) CBZ.weatherRelease();
      if (CBZ.groundWaterFrontSet) CBZ.groundWaterFrontSet(null);
    }
    step(act.secs || 0.5);
    // one settle pass so the coat queue has drained and the uniforms are live
    step(0.6);

    // ---- HUD: measure with it up, then hide it for the frame ----
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    const setHud = (visible) => {
      for (const child of Array.from(document.body.children)) {
        if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
        if (child.id === "__weatherOverlay") continue;
        child.style.visibility = visible ? "" : "hidden";
      }
    };
    setHud(true);
    void document.documentElement.offsetHeight;

    const metrics = {};
    let audit = null, gwAudit = null;
    try { if (CBZ.weatherAudit) audit = CBZ.weatherAudit(); } catch (_) {}
    try { if (CBZ.groundWaterAudit) gwAudit = CBZ.groundWaterAudit(); } catch (_) {}
    if (audit) {
      for (const key of Object.keys(audit)) {
        if (Number.isFinite(Number(audit[key]))) metrics[key] = Number(audit[key]);
      }
    }
    if (gwAudit) {
      if (Number.isFinite(Number(gwAudit.privateWaterPlanes))) metrics.privateWaterPlanes = Number(gwAudit.privateWaterPlanes);
      if (Number.isFinite(Number(gwAudit.stage))) metrics.gwStage = Number(gwAudit.stage);
      if (Number.isFinite(Number(gwAudit.cells))) metrics.gwCells = Number(gwAudit.cells);
    }
    metrics.stepMsAvg = ticks ? Number((totalMs / ticks).toFixed(2)) : 0;
    metrics.stepMsMax = Number(maxMs.toFixed(2));
    metrics.stepOver33 = over33;

    S.overlay.textContent =
      (input.side === "before" ? input.beforeLabel : input.afterLabel) + "  ·  " +
      (subject.label || subject.id) +
      "   water " + (audit ? audit.groundWater : "?") + " m" +
      "   snow " + (audit ? audit.snowCover : "?") +
      "   coated " + (audit ? audit.coatedMaterials : "?") +
      "   private planes " + (gwAudit ? gwAudit.privateWaterPlanes : "?");

    // ---- the tripod ----
    const camera = CBZ.camera;
    camera.aspect = input.width / input.height;
    camera.fov = 58;
    camera.near = 0.2;
    camera.far = 20000;
    camera.position.set(S.vx, S.gy + 2.2, S.vz);
    camera.lookAt(S.ax, S.gy + 1.1, S.az);
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
    metrics.drawCalls = Number(render.calls || 0);
    metrics.triangles = Number(render.triangles || 0);

    return {
      ok: true,
      t: Number(S.t.toFixed(2)),
      water: audit ? audit.groundWater : null,
      snow: audit ? audit.snowCover : null,
      privateWaterPlanes: gwAudit ? gwAudit.privateWaterPlanes : null,
      metrics,
    };
  },
};
