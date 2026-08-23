/* ============================================================
   tools/visual-presets/storm-edge.mjs

   THE EDGE OF THE STORM — the storyboard.

   OWNER (two photographs through a windscreen, 2026-08-23): the real thing is
   not a grey filter. It is a dense dark shelf owning one side of the sky, hard
   against blazing clear air on the other, and the horizon under the shelf's
   lip burning near-white with the daylight leaking in from outside the system.

   Before SKY_STORM_EDGE the painted deck could not draw that day: coverage was
   ONE alpha applied to all 360° of azimuth, so a storm arrived as a uniform
   film fading in everywhere at once and left the same way. This preset is the
   flag A/B for the front: both sides are THIS checkout, the before side runs
   ?cfg_SKY_STORM_EDGE=0 (the uniform deck, byte for byte), and every beat is
   staged through the engine's own weather lever (CBZ.weatherDrive) with the
   rAF loop frozen and CBZ.stepSim as the only clock.

   The camera is solved off the SKY'S OWN ANSWER: CBZ.skyAudit() publishes
   where the front is anchored (stormEdgeU) and the coverage, so each beat
   aims at the mathematical boundary — never at a compass point that happened
   to work once.

   Run:
     node tools/before-after.mjs storm-edge
   Iterate one side:
     node tools/visual-compare.mjs --preset storm-edge --before local \
       --only after --subjects front-arrives --keep-going --no-open
============================================================ */

export default {
  id: "storm-edge",
  title: "The edge of the storm",
  description:
    "A storm front with a real leading edge: dense shelf one side, clear sky the other, " +
    "daylight burning under the lip — against the uniform full-sky fade it replaces.",
  defaultBefore: "local",
  beforeParams: { cfg_SKY_STORM_EDGE: 0 },
  beforeLabel: "BEFORE · UNIFORM DECK",
  afterLabel: "AFTER · STORM FRONT",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.CBZ && window.CBZ.game",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 900000,
  method:
    "One city boot per side, same seed. rAF frozen, CBZ.stepSim(0.1) the only clock. Each beat " +
    "asserts CBZ.weatherDrive until CBZ.weather.overcast reaches its target, then aims the " +
    "camera at the boundary azimuth CBZ.skyAudit() reports and calls CBZ.skySync(). The only " +
    "difference between the sides is cfg_SKY_STORM_EDGE.",
  metricsNote:
    "stormK is coverage (the shared overcast scalar); sunCovered is the deck's own answer for " +
    "how buried the sun's azimuth is (0 = blazing beside the shelf); sunOpacity is the disc as " +
    "drawn. On the closed-sky beat the two sides must effectively agree — the front is a way of " +
    "ARRIVING, not a different full overcast.",
  metrics: {
    stormK: { label: "Deck coverage", unit: "0-1" },
    stormEdge: { label: "Front active", unit: "", better: "higher" },
    sunCovered: { label: "Sun azimuth covered", unit: "0-1" },
    sunOpacity: { label: "Sun disc opacity", unit: "0-1" },
    deck: { label: "Deck tile built", unit: "", better: "higher" },
    deckPerspective: { label: "Deck perspective", unit: "", better: "higher" },
  },
  defaultFocus:
    "Look at the BOUNDARY: is there one? Dense dark cloud on one side, clear sky on the other, " +
    "and light along the line where they meet.",

  subjects: [
    {
      id: "front-arrives",
      label: "01 · The front arrives",
      focus:
        "Coverage ~0.35, camera on the LEADING edge. BEFORE: the whole sky wears a 35% grey film " +
        "— no edge exists to photograph. AFTER: a dense shelf owns a third of the sky, its edge " +
        "cuts across the frame, and the air beyond it is still clear daylight.",
      act: { overcast: 0.35, aim: "lead" },
    },
    {
      id: "half-sky",
      label: "02 · Half the sky",
      focus:
        "Coverage ~0.6, camera square on the boundary. The reference photograph: deck overhead, " +
        "bright air beyond the lip, and the under-edge daylight along the line.",
      act: { overcast: 0.6, aim: "lead" },
    },
    {
      id: "sun-beside-front",
      label: "03 · The sun beside the shelf",
      focus:
        "Camera at the SUN with the front advancing toward it. BEFORE: the disc is dimmed by raw " +
        "coverage wherever the deck is — a filter. AFTER: the disc burns at full strength until " +
        "the shelf actually reaches its azimuth (sunCovered says how close it is).",
      act: { overcast: 0.45, aim: "sun" },
    },
    {
      id: "closed-sky",
      label: "04 · The sky closes (parity)",
      focus:
        "Coverage driven to ~1. The guard beat: at full overcast the front IS the whole sky, and " +
        "the two sides must photograph the same ceiling — the edge is a way of arriving, not a " +
        "different storm.",
      act: { overcast: 0.99, aim: "lead" },
    },
    {
      id: "clearing",
      label: "05 · The end of the storm",
      focus:
        "The drive released from full overcast and eased back to ~0.45 — the owner's second " +
        "photograph, from under the deck looking at the clear air coming. BEFORE: the film fades " +
        "everywhere at once. AFTER: the back edge sweeps across, clear sky beyond it.",
      act: { overcast: 0.99, then: 0.45, aim: "trail" },
    },
  ],

  // NOT a shorthand method: visual-compare.mjs serializes this with
  // `(${preset.stage.toString()})(...)`.
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

    let S = window.__stormEdgeSeq;
    if (!S) {
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
      // late morning: the storm edge is a DAYLIGHT drama — the clear side has
      // to be bright for the boundary to mean anything.
      try { if (CBZ.dayPhase) CBZ.dayPhase(0.40); } catch (_) {}
      window.requestAnimationFrame = function () { return 0; };
      await wait(700);
      for (let i = 0; i < 150; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

      const overlay = document.createElement("div");
      overlay.id = "__stormEdgeOverlay";
      overlay.style.cssText =
        "position:fixed;left:0;right:0;bottom:0;z-index:99999;pointer-events:none;" +
        "font:600 13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#eaf2ff;" +
        "background:linear-gradient(transparent,rgba(6,10,16,.86));padding:26px 20px 12px";
      document.body.appendChild(overlay);
      window.__cbzVisualCompare = {
        render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
      };
      S = window.__stormEdgeSeq = { overlay: overlay, t: 0 };
    }

    // ---- drive the shared weather until overcast REACHES the target ------
    const driveTo = (target, budgetSecs) => {
      // rollWeather's own map: overcast target = intensity*1.25-0.05, driver
      // lightning declares 0.95. Solve rain for the target, use lightning for
      // a closed sky.
      const spec = { wind: 8, windDir: { x: 1, z: 0.25 }, fog: 0.3, fogColor: 0x59636b };
      if (target > 0.9) { spec.rain = 0.95; spec.lightning = 1; spec.fog = 0.6; }
      else spec.rain = Math.max(0, Math.min(1, (target + 0.05) / 1.25));
      const n = Math.round((budgetSecs || 30) / 0.1);
      for (let i = 0; i < n; i++) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        if (CBZ.weatherDrive) CBZ.weatherDrive(spec, 1.5);
        CBZ.stepSim(0.1);
        S.t += 0.1;
        if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
        const oc = CBZ.weather ? CBZ.weather.overcast : 0;
        if (Math.abs(oc - target) < 0.02) break;
      }
    };
    const releaseTo = (target, budgetSecs) => {
      if (CBZ.weatherRelease) CBZ.weatherRelease();
      const n = Math.round((budgetSecs || 60) / 0.1);
      for (let i = 0; i < n; i++) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        CBZ.stepSim(0.1);
        S.t += 0.1;
        if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
        const oc = CBZ.weather ? CBZ.weather.overcast : 1;
        if (oc <= target) break;
      }
    };

    driveTo(act.overcast != null ? act.overcast : 0.5, 40);
    if (act.then != null) releaseTo(act.then, 90);

    // ---- aim the camera off the sky's own answer -------------------------
    const audit = CBZ.skyAudit ? CBZ.skyAudit() : {};
    const k = Number(audit.stormK || 0);
    const edgeU = Number(audit.stormEdgeU || 0.25);
    // canvas u → world dir: x = -cos(2πu), z = sin(2πu) (sky.js's mapping)
    const uDir = (u) => {
      const t = u * Math.PI * 2;
      return { x: -Math.cos(t), z: Math.sin(t) };
    };
    let aimDir;
    if (act.aim === "sun") {
      const a = CBZ.sunAngle == null ? 1.1 : CBZ.sunAngle;
      const v = { x: Math.cos(a) * 80, y: Math.sin(a) * 95, z: -10 };
      const L = Math.hypot(v.x, v.y, v.z);
      aimDir = { x: v.x / L, z: v.z / L, elev: Math.asin(v.y / L) };
    } else {
      // the boundary sits half the coverage from the anchor; lead = downwind
      // edge (where the shelf is advancing into clear air), trail = the other.
      const bu = act.aim === "trail" ? edgeU - k * 0.5 : edgeU + k * 0.5;
      const d = uDir(bu - Math.floor(bu));
      aimDir = { x: d.x, z: d.z, elev: 0.22 };
    }

    const camera = CBZ.camera;
    const px = (CBZ.player && CBZ.player.pos) ? CBZ.player.pos.x : 0;
    const pz = (CBZ.player && CBZ.player.pos) ? CBZ.player.pos.z : -700;
    camera.aspect = input.width / input.height;
    camera.fov = 62;
    camera.near = 0.2;
    camera.far = 20000;
    // WELL above the skyline: the first cut stood at y=84 and photographed
    // the inside of a tower. The frame is the SKY with the city as a roofline
    // silhouette at the bottom, so height costs nothing.
    camera.position.set(px, 300, pz);
    camera.lookAt(px + aimDir.x * 200, 300 + Math.tan(aimDir.elev) * 200, pz + aimDir.z * 200);
    camera.updateProjectionMatrix();
    if (typeof CBZ.skySync === "function") CBZ.skySync();

    // hide the HUD for the frame
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__stormEdgeOverlay") continue;
      child.style.visibility = "hidden";
    }

    const after = CBZ.skyAudit ? CBZ.skyAudit() : {};
    const metrics = {};
    for (const key of ["stormK", "stormEdge", "stormEdgeU", "sunCovered", "sunOpacity", "deck", "deckPerspective", "photoK"]) {
      if (Number.isFinite(Number(after[key]))) metrics[key] = Number(after[key]);
    }

    S.overlay.textContent =
      (input.side === "before" ? input.beforeLabel : input.afterLabel) + "  ·  " +
      (subject.label || subject.id) +
      "   coverage " + (after.stormK != null ? after.stormK : "?") +
      "   sunCovered " + (after.sunCovered != null ? after.sunCovered : "?") +
      "   edgeU " + (after.stormEdgeU != null ? after.stormEdgeU : "?");

    CBZ.renderer.render(CBZ.scene, camera);
    return { ok: true, t: Number(S.t.toFixed(1)), aim: act.aim || "lead", metrics: metrics };
  },
};
