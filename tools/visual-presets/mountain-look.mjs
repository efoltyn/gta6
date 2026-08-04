/* ============================================================
   tools/visual-presets/mountain-look.mjs

   THE MOUNTAINS, AGAINST THE REFERENCE PHOTOGRAPHS.

   The owner's references are coastal Alaska: fjord walls that rise DENSE
   GREEN straight out of the sea with the green climbing surprisingly high;
   snow that lives in gullies and couloirs as white streaks and irregular
   blobs rather than as a flat cap, broken near the summits by dark rock
   ribs; exposed rock that is grey-brown and lives on the ridgelines and the
   steep faces; and — the loudest cue of all — several overlapping ridgelines
   receding in depth, the far range pale desaturated blue-white against
   darker foreground headlands.

   Each subject frames exactly one of those claims, and every framing is
   FOUND rather than typed: the stage scans the game's own published height
   oracles (CBZ.greaterSnowTerrainHeightAt / CBZ.snowTerrainHeightAt) for the
   real summits of the seed, then poses the camera off those coordinates. A
   preset with hard-coded mountain positions is a preset that photographs the
   sky the first time somebody moves the snow island.

   Staging: one boot per side, seed pinned, rAF frozen, CBZ.stepSim as the
   only clock — so the two sides sample identical simulated seconds and the
   only difference in the frame is the terrain look.

   Run:
     node tools/visual-compare.mjs --preset mountain-look \
       --before https://efoltyn.github.io/gta6/ --no-open
   Iterate one side while building:
     node tools/visual-compare.mjs --preset mountain-look --only after \
       --subjects flank --no-open --keep-going
============================================================ */

export default {
  id: "mountain-look",
  title: "The mountains: green flanks, snow in the gullies, ranges receding",
  description:
    "Four framings of the game's real ranges against the Alaskan-fjord references: a mid-distance " +
    "flank showing the green-to-rock-to-snow gradient, a summit snowfield, a steep couloir face, " +
    "and a coastal panorama of overlapping ridgelines receding into haze.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 900000,
  method:
    "One city boot per side at seed 90210. The rAF loop is frozen after boot and CBZ.stepSim(1/60) " +
    "is the only clock. Summits are LOCATED by scanning the game's own exported height oracles, so " +
    "both sides frame the same real geometry; no vertex, region or layout value is touched by this " +
    "wave, so the two sides differ only in surface colour and atmospheric treatment.",
  metricsNote:
    "snowGullyContrast is the mean difference in snow coverage between CONCAVE (couloir) and CONVEX " +
    "(spine) ground sampled at matched altitude on the Greater Mercy Range, evaluated through the " +
    "game's own CBZ.mtnSnowCover with the range's shipped parameters. A range whose snow is a pure " +
    "altitude band scores ~0 by construction — that number IS the difference between a contour cap " +
    "and streaks in the gullies. snowCoverMean is printed beside it so a build cannot win by simply " +
    "burying the range in more snow.",
  metrics: {
    snowGullyContrast: { label: "Gully-vs-spine snow contrast", unit: "0-1", better: "higher" },
    snowCoverMean: { label: "Mean snow coverage", unit: "0-1", better: "higher" },
    drawCalls: { label: "Draw calls", unit: "", better: "lower" },
  },
  defaultFocus:
    "Look at WHERE the white is (gullies and hollows, not a band), whether the green climbs the " +
    "steep ground, and whether the ranges separate from each other in depth.",

  subjects: [
    {
      id: "flank",
      label: "01 · Mid-distance flank — green, rock, snow",
      focus:
        "One mountain flank read bottom to top. The lower slope should be dense green climbing " +
        "steeply, grey-brown rock should belong to the ridgelines and the steep faces, and the " +
        "snow should arrive as streaks and patches — not as a horizontal white line across the " +
        "whole massif.",
      shot: "flank",
    },
    {
      id: "summit",
      label: "02 · Summit snowfield, broken by rock ribs",
      focus:
        "Close on the highest ground. The field should be broad but BROKEN — dark rock spines and " +
        "ridges cutting it into fingers, irregular blobs at its lower edge. A smooth white dome is " +
        "the failure this subject exists to catch.",
      shot: "summit",
    },
    {
      id: "couloir",
      label: "03 · Steep face from below",
      focus:
        "Looking up a steep face. Snow should hang in the concavities and run downslope in them; " +
        "the convex ribs between should stay bare dark rock.",
      shot: "couloir",
    },
    {
      id: "from-water",
      label: "04 · The range across water",
      focus:
        "The nearest framing this world can give the reference's fjord shot: the massif seen low " +
        "across open water. (The world's one range that actually rose OUT of the sea — " +
        "terrain_overhaul.js's offshore skyline — was deleted by owner order, TERRAIN_DARK_RANGE, " +
        "so nothing here stands in the water. See the report note.)",
      shot: "from-water",
    },
    {
      id: "panorama",
      label: "05 · Coastal panorama — ranges receding",
      focus:
        "Several ridgelines at once from the coast. The near headland should be dark and saturated, " +
        "the range behind it visibly paler, and the far snow range a desaturated blue-white that " +
        "reads almost like sky. If every ridge is the same brightness there is no depth.",
      shot: "panorama",
    },
  ],

  // NOT a shorthand method: visual-compare.mjs serializes this with
  // `(${preset.stage.toString()})(...)`, and `async stage(input){}` is not a
  // valid expression once wrapped in parentheses.
  stage: async function (input) {
    const CBZ = window.CBZ;
    const subject = input.subject || {};
    const shot = subject.shot || "flank";
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, budgetMs, stepMs) => {
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) {
        try { if (test()) return true; } catch (_) {}
        await wait(stepMs || 250);
      }
      return false;
    };
    const tick = (dt) => {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      CBZ.stepSim(dt == null ? 1 / 60 : dt);
      if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
    };
    // The frame sync that normally follows the sky rig to the camera is frozen.
    const syncSky = () => {
      if (typeof CBZ.skySync === "function") { CBZ.skySync(); return; }
      const rig = CBZ.skyDome && CBZ.skyDome.parent;
      if (rig && rig.position) rig.position.set(CBZ.camera.position.x, 0, CBZ.camera.position.z);
    };

    let S = window.__mtnLook;
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
      // Headless settles into the LOW tier and the owner plays high; pin it so
      // the backdrop scatter and shadow receive are actually in the frame.
      try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
      // Midday, clear: the look under test is albedo + aerial perspective, and
      // a random weather roll would be the loudest variable in the picture.
      try { if (CBZ.dayPhase) CBZ.dayPhase(0.42); } catch (_) {}
      try { if (CBZ.weatherRelease) CBZ.weatherRelease(); } catch (_) {}

      window.requestAnimationFrame = function () { return 0; };
      await wait(700);
      for (let i = 0; i < 150; i++) tick();

      // ---- FIND THE MOUNTAINS (never assume where they are) --------------
      const gH = CBZ.greaterSnowTerrainHeightAt;
      const mH = CBZ.snowTerrainHeightAt;
      const scan = (hAt, box, step) => {
        // coarse peak search + a slope/concavity read at each keeper, so every
        // framing below is anchored on real geometry rather than a guess
        let best = null;
        if (typeof hAt !== "function" || !box) return null;
        for (let x = box.minX; x <= box.maxX; x += step) {
          for (let z = box.minZ; z <= box.maxZ; z += step) {
            let h = 0;
            try { h = hAt(x, z); } catch (_) { h = 0; }
            if (!(h > 0)) continue;
            if (!best || h > best.h) best = { x, z, h };
          }
        }
        return best;
      };
      const gBox = CBZ.mtnGreatBounds || { minX: -1450, maxX: 1750, minZ: -4100, maxZ: -1780 };
      const mBox = CBZ.mtnMercyBounds || { minX: -70, maxX: 770, minZ: -1780, maxZ: -1120 };
      const great = scan(gH, gBox, 40);
      const mercy = scan(mH, mBox, 24);
      if (!great && !mercy) return { ok: false, err: "no mountain oracle answered" };
      const hero = great || mercy;
      const heroH = great ? gH : mH;

      // The steepest face on the hero, and the wettest gully on it: walk a ring
      // of bearings around the summit and score each by fall over 260 m.
      let face = { bx: 0, bz: 1, drop: -1 };
      for (let k = 0; k < 36; k++) {
        const th = (k / 36) * Math.PI * 2;
        const bx = Math.sin(th), bz = Math.cos(th);
        let h1 = 0;
        try { h1 = heroH(hero.x + bx * 260, hero.z + bz * 260); } catch (_) { h1 = 0; }
        const drop = hero.h - h1;
        if (drop > face.drop) face = { bx, bz, drop };
      }
      // Prefer a face pointing generally SOUTH (toward the world/city side),
      // so a camera standing off it is not inside another massif.
      if (face.bz < 0) {
        let alt = { bx: 0, bz: 1, drop: -1 };
        for (let k = 0; k < 36; k++) {
          const th = (k / 36) * Math.PI * 2;
          const bx = Math.sin(th), bz = Math.cos(th);
          if (bz < 0.25) continue;
          let h1 = 0;
          try { h1 = heroH(hero.x + bx * 260, hero.z + bz * 260); } catch (_) { h1 = 0; }
          const drop = hero.h - h1;
          if (drop > alt.drop) alt = { bx, bz, drop };
        }
        if (alt.drop > 0) face = alt;
      }

      const overlay = document.createElement("div");
      overlay.id = "__mtnOverlay";
      overlay.style.cssText =
        "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;" +
        "z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      overlay.innerHTML =
        "<div data-side></div><div data-name></div><div data-focus></div><div data-source></div>";
      document.body.appendChild(overlay);
      window.__cbzVisualCompare = {
        render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
      };

      // ---- THE NEAREST WATER, AND FROM WHICH BEARING ----------------------
      // MEASURED (probe, seed 90210): the world's ranges are INLAND. The one
      // range that stood in the sea — world/terrain_overhaul.js's offshore
      // skyline — is switched off by owner order (TERRAIN_DARK_RANGE), so
      // CBZ.terrainHeight is identically 0 everywhere and there is no coastal
      // massif to photograph. The honest substitute is the nearest open water
      // to the hero summit, found by sweeping bearings rather than assumed.
      let water = null;
      if (typeof CBZ.cityWaterAt === "function") {
        for (let k = 0; k < 36; k++) {
          const th = (k / 36) * Math.PI * 2;
          const bx = Math.sin(th), bz = Math.cos(th);
          for (let d = 600; d <= 12000; d += 150) {
            const x = hero.x + bx * d, z = hero.z + bz * d;
            let wet = false;
            try { wet = !!CBZ.cityWaterAt(x, z); } catch (_) { wet = false; }
            if (wet) {
              if (!water || d < water.d) water = { x, z, d, bx, bz };
              break;
            }
          }
        }
      }

      S = window.__mtnLook = { great, mercy, hero, face, overlay, gH, mH, water };
    }

    const camera = CBZ.camera;
    camera.aspect = input.width / input.height;
    const hero = S.hero, face = S.face;
    const seaY = CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48;

    // Put the PLAYER where the camera is looking from, so streaming, LOD and
    // the on-foot fog regime are the ones a player would actually see. (An
    // airborne player yanks fog.far to 4200 and would hide the very
    // atmospheric recession subject 04 exists to photograph.)
    const standAt = (x, z, y) => {
      try {
        if (CBZ.player && CBZ.player.pos && CBZ.player.pos.set) {
          const g = (CBZ.floorAt && CBZ.floorAt(x, z));
          CBZ.player.pos.set(x, Number.isFinite(g) ? g : (y || 0), z);
          CBZ.player.grounded = true;
          if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
        }
      } catch (_) {}
    };

    let camPos = { x: 0, y: 100, z: 0 }, look = { x: hero.x, y: hero.h * 0.5, z: hero.z };
    if (shot === "flank") {
      // 900 m off the chosen face at a third of the summit height: the whole
      // vertical sequence (waterline/foot → forest → rock → snow) in one frame.
      const d = 900;
      camPos = { x: hero.x + face.bx * d, y: hero.h * 0.34, z: hero.z + face.bz * d };
      look = { x: hero.x, y: hero.h * 0.60, z: hero.z };
      camera.fov = 42;
    } else if (shot === "summit") {
      const d = 340;
      camPos = { x: hero.x + face.bx * d, y: hero.h + 90, z: hero.z + face.bz * d };
      look = { x: hero.x, y: hero.h - 30, z: hero.z };
      camera.fov = 46;
    } else if (shot === "couloir") {
      // At the foot of the face, looking up it. The camera sits just outside
      // the mountain (heights are sampled, never assumed) so the face fills
      // the frame from below the way a valley floor sees it.
      const d = 430;
      let footY = 0;
      try { footY = S.hero === S.great ? S.gH(hero.x + face.bx * d, hero.z + face.bz * d)
                                       : S.mH(hero.x + face.bx * d, hero.z + face.bz * d); } catch (_) {}
      camPos = { x: hero.x + face.bx * d, y: (footY || 0) + 26, z: hero.z + face.bz * d };
      look = { x: hero.x, y: hero.h * 0.92, z: hero.z };
      camera.fov = 55;
    } else if (shot === "from-water") {
      const W = S.water;
      if (!W) return { ok: false, err: "no open water within 12 km of the hero summit" };
      // 340 m out over the water on the far side of the shoreline, eye height
      // just above the surface — a boat's view back at the range.
      camPos = { x: W.x + W.bx * 340, y: seaY + 9, z: W.z + W.bz * 340 };
      look = { x: hero.x, y: hero.h * 0.40, z: hero.z };
      camera.fov = 52;
    } else {
      // PANORAMA: stand south of the hero range, low, so Mount Mercy (the
      // mid-ground headland) and the Greater Range behind it are both in
      // frame at different distances — the layering IS the subject.
      const d = 3300;
      camPos = { x: hero.x + 240, y: seaY + 110, z: hero.z + d };
      look = { x: hero.x, y: hero.h * 0.62, z: hero.z };
      camera.fov = 48;
    }

    // The player must not be dropped INTO the sea: world/water_underwater.js
    // eases every terrain material's fog scale to 1.0 while the eye is under,
    // which would wash the whole frame and photograph the water system rather
    // than the mountain. So a camera standing off the coast walks its player
    // inland until the field says land.
    let standX = camPos.x, standZ = camPos.z;
    if (shot === "from-water") {
      const dx = hero.x - camPos.x, dz = hero.z - camPos.z;
      for (let t = 0; t <= 1.0; t += 0.02) {
        const x = camPos.x + dx * t, z = camPos.z + dz * t;
        let wet = true;
        try { wet = !!CBZ.cityWaterAt(x, z); } catch (_) { wet = true; }
        if (!wet) { standX = x; standZ = z; break; }
      }
    }
    standAt(standX, standZ, camPos.y);
    for (let i = 0; i < 60; i++) tick();

    camera.position.set(camPos.x, camPos.y, camPos.z);
    camera.lookAt(look.x, look.y, look.z);
    // Distant-landmark projection room: the on-foot far plane is derived from
    // CBZ.cityDistantLandmarkFar, and a 4.2 km panorama needs all of it.
    camera.far = Math.max(camera.far, 9000);
    camera.updateProjectionMatrix();
    syncSky();

    // ---- METRICS: gully-vs-spine contrast through the game's OWN model ----
    // Concavity is computed HERE (a plain Laplacian) rather than through
    // CBZ.mtnConcavity, so the deployed build — which has no such export —
    // is measured by exactly the same yardstick.
    let contrast = 0, coverMean = 0, samples = 0;
    try {
      const hAt = S.hero === S.great ? S.gH : S.mH;
      const opts = { line: 46, band: 130, aspect: 70, wob: 40, shed0: 0.14, shed1: 0.54, salt: 0x6e47 };
      const conc = (x, z, e) => {
        const h = hAt(x, z);
        const lap = (hAt(x + e, z) + hAt(x - e, z) + hAt(x, z + e) + hAt(x, z - e)) * 0.25 - h;
        const k = lap / (e * 0.05);
        return k / (1 + Math.abs(k));
      };
      const slopeAt = (x, z, e) => {
        const dx = hAt(x + e, z) - hAt(x - e, z), dz = hAt(x, z + e) - hAt(x, z - e);
        const g = Math.hypot(dx, dz) / (2 * e);
        return 1 - 1 / Math.sqrt(1 + g * g);
      };
      const R = 900;
      for (let k = 0; k < 720 && samples < 260; k++) {
        // deterministic lattice around the hero summit — no rng, both sides
        // sample identical coordinates
        const a = (k * 137.508) * Math.PI / 180;
        const r = 40 + (k % 30) * (R / 30);
        const x = hero.x + Math.cos(a) * r, z = hero.z + Math.sin(a) * r;
        const y = hAt(x, z);
        if (!(y > 40)) continue;
        const c = conc(x, z, 30);
        if (Math.abs(c) < 0.12) continue;
        const s = slopeAt(x, z, 30);
        const cov = CBZ.mtnSnowCover
          ? CBZ.mtnSnowCover(x, z, y, s, 0.6, Object.assign({}, opts, {
              concave: c, gully: 74, spine: 0.58, patch: 0.85, patchCell: 190,
            }))
          : 0;
        const covFlat = CBZ.mtnSnowCover
          ? CBZ.mtnSnowCover(x, z, y, s, 0.6, Object.assign({}, opts, {
              concave: -c, gully: 74, spine: 0.58, patch: 0.85, patchCell: 190,
            }))
          : 0;
        contrast += Math.abs(cov - covFlat);
        coverMean += cov;
        samples++;
      }
      if (samples) { contrast /= samples; coverMean /= samples; }
    } catch (_) { /* a metric must never sink the shot */ }

    // ---- HUD off, render ----
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__mtnOverlay") continue;
      child.style.visibility = "hidden";
    }
    if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
    CBZ.renderer.render(CBZ.scene, camera);
    const info = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

    const before = input.side === "before";
    const q = (name) => S.overlay.querySelector("[data-" + name + "]");
    q("side").textContent = before ? input.beforeLabel : input.afterLabel;
    q("side").style.cssText =
      "position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:" +
      (before ? "#c94c4c" : "#218b60") + ";font-size:12px;font-weight:900;letter-spacing:.12em";
    q("name").textContent = subject.label;
    q("name").style.cssText =
      "position:absolute;top:64px;left:26px;font-size:27px;font-weight:800;letter-spacing:-.02em";
    q("focus").textContent = subject.focus;
    q("focus").style.cssText =
      "position:absolute;top:100px;left:28px;color:#c0cfda;font-size:13px;font-weight:550;max-width:760px";
    q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
    q("source").style.cssText =
      "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

    return {
      ok: true,
      summit: { x: Math.round(hero.x), z: Math.round(hero.z), h: Math.round(hero.h) },
      camera: { x: Math.round(camPos.x), y: Math.round(camPos.y), z: Math.round(camPos.z) },
      fogFar: CBZ.scene && CBZ.scene.fog ? Math.round(CBZ.scene.fog.far) : null,
      metricSamples: samples,
      metrics: {
        snowGullyContrast: Number(contrast.toFixed(4)),
        snowCoverMean: Number(coverMean.toFixed(4)),
        drawCalls: Number(info.calls || 0),
      },
    };
  },
};
