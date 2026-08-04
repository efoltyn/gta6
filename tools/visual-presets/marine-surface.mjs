/* Marine life at the waterline — tools/visual-compare.mjs preset.

   OWNER (2026-08-03, with a screenshot): "sharks occasionally glitch — you see
   their fin poking out of the water correctly, but then you see the full shark
   and another fin above the fin, floating. It's an issue with all marine life
   and a water issue in general."

   This stages the REAL game on both sides — no studio scene, no replicated
   arithmetic. Each page boots its own world at seed 90210, freezes the rAF
   loop, teleports a REGISTERED animal to a deterministic point of real water,
   and then drives THAT PAGE'S OWN production code:

     • sharks      → CBZ.sharkBrain (city/wildlife_shark.js's hunt + depth())
     • everything  → CBZ.stepSim, i.e. wildlife.js's aquatic tick verbatim
     • carcasses   → CBZ.wildlifeDeathTumble + CBZ.wildlifeDeathStep

   So the deployed page reproduces the bug with its own code and the local page
   answers it with its own; the runner then copies the deployed camera and
   anchors into the local capture, leaving the animal's Y as the only variable.

   THE MEASUREMENT IS IN THE FRAME. Every shot puts the camera at a swimmer's
   eye height just above the live swell, looking straight at the waterline, so
   "is the body under the water" is a thing you read rather than a thing you
   are told. `aboveWaterM` (metres of daylight under the model origin) and
   `surfaceFins` (how many separate dorsals cut the surface) ride along as
   report metrics.

   Staging facts this preset depends on (verified 2026-08-03):
   - core/loop.js re-arms itself with requestAnimationFrame, so stubbing rAF
     after boot freezes rendering; CBZ.stepSim then runs the identical
     updater+always chain with no render.
   - wildlife.js's aquatic branch skips any actor whose group is LOD-hidden,
     so the player has to be parked beside the subject for it to think.
   - predator.js's hunt FSM rolls dice; Math.random is replaced with a seeded
     LCG for the whole staging pass so both sides walk the same state path.
   - Anchors and camera come from the BEFORE side via input.referenceStage —
     the two builds must not be allowed to pick different water. */

const subjects = [
  {
    id: "shark-hunt-offshore",
    label: "Great White — Hunting, Deep Water",
    species: "great_white_shark",
    scenario: "deep", mode: "hunt",
    focus: "1.9 km from any shore, in 62 m of water: the body must be metres UNDER the swell with one dorsal at most cutting it.",
    state: "HUNT · OPEN OCEAN",
    note: "The bed clamp had no bed. CBZ.floorAt reads 0 over the whole sea.",
    camDist: 13, camSide: 0.55, camEye: 4.6, aimUp: -0.7,
  },
  {
    id: "shark-hunt-shallow",
    label: "Great White — Hunting, Shallows Near Shore",
    species: "great_white_shark",
    scenario: "shallow", mode: "hunt",
    focus: "About 2 m of water a few metres off the beach — the owner's screenshot. Back and dorsal may break the surface; the belly may not leave it.",
    state: "HUNT · INSHORE",
    note: "Aground is allowed. Airborne is not.",
    camDist: 10, camSide: 0.8, camEye: 1.4, aimUp: 0.1,
  },
  {
    id: "shark-cruise-offshore",
    label: "Great White — Cruising (No Hunt)",
    species: "great_white_shark",
    scenario: "deep", mode: "wander",
    focus: "The ordinary wander path, which was already correct. This page is the control: both builds should look the same.",
    state: "WANDER · CONTROL",
    note: "Control frame — a fix that changes this changed too much.",
    camDist: 13, camSide: 0.55, camEye: 4.6, aimUp: -0.7,
  },
  {
    id: "dolphin-shallow",
    label: "Dolphin — Shallows Near Shore",
    species: "dolphin",
    scenario: "shallow", mode: "wander",
    focus: "It is not a shark problem. Every marine animal reads the same water, so the dolphin must sit in the column too — on the bed in the shallows, never over it.",
    state: "WANDER · INSHORE",
    note: "Species-agnostic: no name appears in the fix.",
    camDist: 8, camSide: 0.7, camEye: 1.3, aimUp: 0.05,
  },
  {
    id: "orca-carcass",
    label: "Orca — Carcass at Rest",
    species: "orca",
    scenario: "deep", mode: "dead",
    focus: "A killed marine animal settles through the shared death tumble, whose rest height was the WALKABLE floor — flat 0, i.e. above the waterline. A dead orca should be in the sea, not on it.",
    state: "DEAD · SETTLED",
    note: "quadruped_ragdoll refuses aquatic species, so this tumble is the only thing that settles a marine body.",
    camDist: 17, camSide: 0.6, camEye: 6.0, aimUp: -0.9,
  },
  /* ---- THE SURFACE ITSELF (owner's coastal-Alaska reference photos) -------
     The five frames above ask "is the animal in the water". These four ask
     "does the water look like water": deep saturated teal, a dense field of
     fine wind ripple with directional streaky lanes, silvery sheen toward the
     light, a pale silver-blue horizon, and a glassy calm band hugging the
     shore. No animal is staged — the subject IS the sea, photographed from a
     deterministic anchor with the day phase pinned so both builds get the same
     sun. Four numbers ride along, all read off the rendered framebuffer:
     rippleContrast (micro-detail), tealIndex (green-vs-blue in the near
     water), horizonLift (how much paler the far sea is than the near sea) and
     nearSaturation. */
  {
    id: "sea-sheen-lane",
    kind: "seascape", scenario: "deep", look: "sun",
    label: "Open Sea — Into the Light",
    focus: "Two metres over open water, looking down the sun's azimuth: the reference has broad silvery sheen lanes riding a dense ripple field, brightening toward the horizon.",
    state: "OPEN SEA · TOWARD SUN",
    note: "Sheen is the ripple field catching the sky — not one specular dot.",
    camEye: 2.2, aimDist: 900, aimUp: 0.35, phase: 0.20,
  },
  {
    id: "sea-deep-teal",
    kind: "seascape", scenario: "deep", look: "away",
    label: "Open Sea — Away From the Light",
    focus: "The same water with the sun behind the camera, where no glitter can hide the body colour. The reference is a deep, saturated TEAL — never navy, never grey-blue plastic.",
    state: "OPEN SEA · BODY COLOUR",
    note: "Near water reads dark and saturated; far water goes pale silver-blue.",
    camEye: 1.7, aimDist: 700, aimUp: 0.25, phase: 0.20, searchFrom: 3400,
  },
  {
    id: "shore-calm-band",
    kind: "seascape", scenario: "shore", look: "shoreward",
    label: "Shoreline — The Calm Band",
    focus: "Standing 220 m off the beach, 35 m up, looking back at it: the reference has a smooth glassy strip hugging the shore before the ripple field starts, then turquoise shallows grading out into deep teal.",
    state: "SHORE · CALM BAND",
    note: "The shallow-reads-as-sand work (2a87e5a) must survive this frame.",
    camEye: 35, standOff: 220, aimDist: -45, aimUp: 0.0, phase: 0.20, searchFrom: 2600,
  },
  {
    id: "sea-from-height",
    kind: "seascape", scenario: "deep", look: "sun",
    label: "Open Sea — From 85 m",
    focus: "The whole gradient in one frame: dark saturated water under the camera, ripple texture holding at every distance, pale silver toward the horizon. This is the frame a tiling pattern or a dead far field shows up in.",
    state: "OPEN SEA · AERIAL",
    note: "Detail must survive distance without tiling into a visible grid.",
    camEye: 85, aimDist: 1500, aimUp: 0.0, phase: 0.20,
  },
];

async function stageMarine(input) {
  const CBZ = window.CBZ, T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const subject = input.subject;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
      if (child.id === "__marineOverlay") continue;
      child.style.visibility = "hidden";
    }
  };

  let S = window.__marineStage;
  if (!S) {
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        CBZ.stepSim && document.getElementById("playBtn"), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    // Freeze the render loop; CBZ.stepSim becomes the only clock.
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);

    // ONE seeded stream for the whole staging pass, so predator.js's hunt FSM
    // rolls the same dice on both builds and the two shots are comparable.
    let seed = 0x9e3779b9 >>> 0;
    Math.random = function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__marineOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f2f8fc;text-shadow:0 2px 9px #001019;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-read></div><div data-note></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__marineStage = { overlay, used: {} };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const wf = CBZ.waterField;
  if (!wf) return { ok: false, missing: "waterField" };

  // ---- deterministic water anchors (fixed scan order, never Math.random) ---
  function findWater(minShore, maxShore, from, oceanOnly) {
    for (let r = Number(from) || 260; r <= 9000; r += 30) {
      for (let i = 0; i < 96; i++) {
        const ang = (i / 96) * Math.PI * 2;
        const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
        const s = wf.shoreAt(x, z);
        if (!(s <= maxShore && s >= minShore)) continue;
        if (!wf.isSurfaceWater(x, z, 0)) continue;
        // A seascape must be photographed on the SEA: the registered inland
        // bodies render deliberately calmer and greener (WATER_LAKE_TINT), so
        // an anchor that lands in Redhollow Lake is a different material law.
        if (oceanOnly && CBZ.waterInlandFactorAt && CBZ.waterInlandFactorAt(x, z) > 0.02) continue;
        return { x: Number(x.toFixed(2)), z: Number(z.toFixed(2)), shore: Number(s.toFixed(2)) };
      }
    }
    return null;
  }
  const ref = input.referenceStage || null;

  // ---- the overlay writer, shared by both kinds of subject ----------------
  const label = (name, text, css) => {
    const el = S.overlay.querySelector("[data-" + name + "]");
    if (!el) return;
    el.textContent = text;
    el.style.cssText = css;
  };
  const sideBadge = (before) => {
    label("side", before ? input.beforeLabel : input.afterLabel,
      `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`);
  };

  /* ==== SEASCAPE: no animal, the water IS the subject ====================
     The camera is placed from the live surface height at a deterministic
     anchor, the day phase is pinned so both builds share a sun, and four
     numbers are read straight off the rendered framebuffer. Screen rows for
     the "near" and "far" samples are PROJECTED from real world points on the
     sea plane through the live camera, so the bands mean the same distance in
     both builds however the framing lands. */
  if (subject.kind === "seascape") {
    const anchor = (ref && ref.anchor) || (subject.scenario === "shore"
      ? findWater(-30, -12, subject.searchFrom, true)
      : findWater(-6000, -2400, subject.searchFrom, true));
    if (!anchor) return { ok: false, err: "no " + subject.scenario + " water found" };

    // Pin the clock: a seascape is a lighting shot, and subject order must not
    // decide the sun. Six ticks let daynight/sky/water uniforms re-derive.
    if (typeof CBZ.dayPhase === "function") CBZ.dayPhase(Number(subject.phase) || 0.20);
    for (let i = 0; i < 6; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const surf = CBZ.citySeaHeightAt(anchor.x, anchor.z);
    // View azimuth: toward or away from the REAL sun, or straight out to sea.
    let vx = 1, vz = 0;
    if (subject.look === "seaward" || subject.look === "shoreward") {
      const g = wf.shoreGradient ? wf.shoreGradient(anchor.x, anchor.z, 10, {}) : { x: 1, z: 0 };
      const m = Math.hypot(g.x || 1, g.z || 0) || 1;
      vx = -(g.x || 1) / m; vz = -(g.z || 0) / m;          // gradient points landward
      if (subject.look === "shoreward") { vx = -vx; vz = -vz; }
    } else {
      const sd = new T.Vector3(1, 1, 0);
      if (CBZ.sun && CBZ.sunTarget) sd.copy(CBZ.sun.position).sub(CBZ.sunTarget.position);
      const m = Math.hypot(sd.x, sd.z) || 1;
      vx = sd.x / m; vz = sd.z / m;
      if (subject.look === "away") { vx = -vx; vz = -vz; }
    }
    const eye = Number(subject.camEye) || 2;
    const aimD = Number(subject.aimDist) || 800;
    let camPos, camAim;
    if (ref && ref.camera) { camPos = ref.camera.position.slice(); camAim = ref.camera.target.slice(); }
    else if (subject.look === "seaward" || subject.look === "shoreward") {
      // stand OFF the anchor along the view axis and look back down it, so the
      // shore, the calm band, the shallow ramp and the open sea are all in one
      // frame in that order
      const off = Number(subject.standOff) || 30;
      camPos = [anchor.x - vx * off, surf + eye, anchor.z - vz * off];
      camAim = [anchor.x + vx * aimD, surf + (Number(subject.aimUp) || 0.4), anchor.z + vz * aimD];
    } else {
      camPos = [anchor.x, surf + eye, anchor.z];
      camAim = [anchor.x + vx * aimD, surf + (Number(subject.aimUp) || 0.3), anchor.z + vz * aimD];
    }

    const camera = CBZ.camera;
    camera.aspect = input.width / input.height;
    camera.fov = 52; camera.near = 0.12; camera.far = 24000;
    camera.position.set(camPos[0], camPos[1], camPos[2]);
    camera.lookAt(camAim[0], camAim[1], camAim[2]);
    camera.updateProjectionMatrix();
    if (CBZ.player && CBZ.player.pos) {
      // park the player under the camera so LOD/mirror passes centre here
      CBZ.player.pos.x = camPos[0]; CBZ.player.pos.z = camPos[2]; CBZ.player.pos.y = surf + 0.4;
    }
    if (typeof CBZ.skySync === "function") CBZ.skySync();
    hideHud();
    CBZ.renderer.render(CBZ.scene, camera);

    // ---- read the frame ---------------------------------------------------
    // Same task as the render, so the WebGL drawing buffer is still live.
    const canvas = CBZ.renderer.domElement;
    const RW = 256, RH = Math.max(8, Math.round(RW * canvas.height / canvas.width));
    const c2 = document.createElement("canvas");
    c2.width = RW; c2.height = RH;
    const ctx = c2.getContext("2d");
    ctx.drawImage(canvas, 0, 0, RW, RH);
    const px = ctx.getImageData(0, 0, RW, RH).data;
    const _p = new T.Vector3();
    const rowOf = (dist) => {
      _p.set(camPos[0] + vx * dist, surf, camPos[2] + vz * dist).project(camera);
      return Math.max(0, Math.min(RH - 1, Math.round((1 - (_p.y * 0.5 + 0.5)) * RH)));
    };
    const lum = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    const bandStats = (r0, r1) => {
      r0 = Math.max(0, Math.min(RH - 1, r0)); r1 = Math.max(0, Math.min(RH - 1, r1));
      if (r1 < r0) { const t2 = r0; r0 = r1; r1 = t2; }
      let n = 0, L = 0, sat = 0, gb = 0, R = 0, G = 0, B = 0;
      for (let y = r0; y <= r1; y++) {
        for (let x = 0; x < RW; x++) {
          const i = (y * RW + x) * 4;
          const r = px[i], g = px[i + 1], b = px[i + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          L += lum(i); sat += mx > 0 ? (mx - mn) / mx : 0; gb += (g - b) / (g + b + 8);
          R += r; G += g; B += b;
          n++;
        }
      }
      return n ? { lum: L / n, sat: (sat / n) * 100, gb: (gb / n) * 100, rows: [r0, r1],
        rgb: Math.round(R / n) + "," + Math.round(G / n) + "," + Math.round(B / n) } : null;
    };
    const nearRow = rowOf(Math.max(12, eye * 3)), farRow = rowOf(2600);
    // The SKY, sampled well above the horizon: the reference's whole point is
    // that the sea is much darker than the sky it reflects, and "how white did
    // the ocean go" is exactly the gap between those two numbers.
    const skyBand = bandStats(Math.max(0, farRow - 60), Math.max(2, farRow - 30)) || { lum: 0 };
    const near = bandStats(nearRow - 3, nearRow + 3) || { lum: 0, sat: 0, gb: 0, rgb: "-" };
    const far = bandStats(farRow - 2, farRow + 2) || { lum: 0, sat: 0, gb: 0 };
    // Micro-detail, measured where micro-detail belongs: the mean absolute
    // luminance step between horizontally adjacent pixels in the NEAR band.
    // Measured over the whole water body it is not a texture reading at all —
    // a marbled sheet of reflected cloud scores higher than a real ripple
    // field — so it is deliberately confined to water the camera can resolve.
    let steps = 0, stepN = 0;
    for (let y = Math.max(0, nearRow - 14); y < Math.min(RH, nearRow + 15); y++) {
      for (let x = 0; x < RW - 1; x++) {
        const i = (y * RW + x) * 4;
        steps += Math.abs(lum(i + 4) - lum(i)); stepN++;
      }
    }

    sideBadge(input.side === "before");
    label("name", subject.label, "position:absolute;top:64px;left:26px;font-size:26px;font-weight:800;letter-spacing:-.02em");
    label("focus", subject.focus, "position:absolute;top:100px;left:28px;color:#c3d4de;font-size:13px;font-weight:550;max-width:730px;line-height:1.35");
    label("state", subject.state, `position:absolute;right:26px;top:25px;color:${input.side === "before" ? "#ffb0b0" : "#7ff0bb"};font-size:11px;font-weight:900;letter-spacing:.1em`);
    const seaMode = (CBZ.citySea && CBZ.citySea.material && CBZ.citySea.material.userData &&
      CBZ.citySea.material.userData.waterMode) || (CBZ.citySea && CBZ.citySea.name) || "?";
    label("read",
      `ripple ${(stepN ? steps / stepN : 0).toFixed(2)} · teal ${near.gb.toFixed(1)} · lift ${(far.lum - near.lum).toFixed(1)} · skyGap ${(skyBand.lum - near.lum).toFixed(1)}` +
      `\nnear rgb ${near.rgb} · ${seaMode}`,
      "position:absolute;right:26px;top:52px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3;white-space:pre;text-align:right");
    label("note", subject.note, "position:absolute;right:26px;bottom:20px;padding:7px 10px;border-radius:6px;background:rgba(3,18,28,.72);color:#bfe9ff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;max-width:520px");
    label("source", new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname,
      "position:absolute;bottom:20px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace");

    return {
      ok: true,
      kind: "seascape",
      anchor,
      shore: anchor.shore,
      camera: { position: camPos.slice(), target: camAim.slice() },
      bands: { nearRow, farRow, height: RH },
      metrics: {
        rippleContrast: Number((stepN ? steps / stepN : 0).toFixed(3)),
        tealIndex: Number(near.gb.toFixed(2)),
        horizonLift: Number((far.lum - near.lum).toFixed(2)),
        skyGap: Number((skyBand.lum - near.lum).toFixed(2)),
      },
    };
  }

  const anchor = (ref && ref.anchor) || (subject.scenario === "shallow"
    ? findWater(-18, -10)
    : findWater(-4000, -600));
  if (!anchor) return { ok: false, err: "no " + subject.scenario + " water found" };

  // ---- the subject: a REGISTERED animal of the requested species -----------
  const list = (CBZ.cityWildlifeList && CBZ.cityWildlifeList()) || [];
  const actor = list.find((a) => a && a.species && a.species.id === subject.species &&
    !a.dead && !a.tamed && !a.ridden && !S.used[a.species.id + ":" + list.indexOf(a)]);
  if (!actor) return { ok: false, missing: subject.species };
  const grp = actor.group;
  const draft = actor.swimDepth || 1;

  const surf0 = CBZ.citySeaHeightAt(anchor.x, anchor.z);
  grp.position.set(anchor.x, surf0 - draft, anchor.z);
  actor.home.x = anchor.x; actor.home.z = anchor.z;
  actor.heading = Math.PI * 0.5;                       // broadside to the camera
  grp.visible = true;
  // wildlife.js's matrix LOD (setLiveMats) stamps matrixAutoUpdate=false on an
  // out-of-range animal, and the settle burst above ran with the player nowhere
  // near this one. Without this the mesh renders at its SPAWN transform however
  // far we move the actor — the body silently vanishes from the shot while the
  // numbers stay right. Re-arm the whole subtree.
  const liveMats = () => {
    grp.matrixAutoUpdate = true;
    grp.traverse((o) => { o.matrixAutoUpdate = true; });
    grp.updateMatrix(); grp.updateMatrixWorld(true);
  };
  liveMats();
  if (actor._waterMove) { actor._waterMove.x = anchor.x; actor._waterMove.z = anchor.z; }

  // Park the player beside it, in the water: the aquatic tick skips LOD-hidden
  // actors, and sharkBrain needs somebody to hunt.
  const P = CBZ.player && CBZ.player.pos;
  if (P) {
    P.x = anchor.x + 22; P.z = anchor.z; P.y = surf0 - 0.2;
    CBZ.player._swim = true; CBZ.player.hp = 100;
  }
  const pin = () => { grp.position.x = anchor.x; grp.position.z = anchor.z; };

  let huntState = null;
  if (subject.mode === "hunt" && typeof CBZ.sharkBrain === "function") {
    // The production hunt, ticked exactly as wildlife.js ticks it. x/z are
    // pinned so the framing is fixed; depth() still solves Y every tick.
    for (let i = 0; i < 260; i++) {
      pin();
      if (P) { P.x = anchor.x + 22; P.z = anchor.z; P.y = CBZ.citySeaHeightAt(P.x, P.z) - 0.2; }
      try { CBZ.sharkBrain(actor, 1 / 60, P); } catch (_) {}
      if (CBZ.player) CBZ.player.hp = 100;
    }
    // ...then hold ONE DECLARED BEAT so both builds photograph the same thing.
    // The two pages cannot share an rng stream (their worlds differ), so the
    // FSM may sit in different phases after the free run. Forcing the state and
    // driving the file's own locomotion seam (opts.move → swim() → depth())
    // pins the beat without bypassing a single line of the production path.
    const s = actor._shark;
    if (s && s.opts && typeof s.opts.move === "function") {
      s.state = "circle";
      s.diveWant = draft * 0.9;                        // wildlife_shark DIVE.circle
      for (let i = 0; i < 220; i++) { pin(); s.opts.move(actor, actor.heading, 0, 1 / 60); }
      pin();
      // one more brain tick so the fin/wake/shadow proxy is drawn against the
      // final body transform, exactly as it would be in play
      try { CBZ.sharkBrain(actor, 1 / 60, P); } catch (_) {}
      pin();
    }
    const st = CBZ.sharkState ? CBZ.sharkState(actor) : null;
    huntState = st && st.state;
  } else if (subject.mode === "dead") {
    actor.dead = true; actor.skinT = 9999;
    if (CBZ.wildlifeDeathTumble) CBZ.wildlifeDeathTumble(actor, { x: 1, y: 0.15, z: 0 }, 5.5, null);
    for (let i = 0; i < 420; i++) { pin(); if (CBZ.wildlifeDeathStep) CBZ.wildlifeDeathStep(actor, 1 / 60); }
    pin();
  } else {
    // The ordinary wildlife tick — the whole updater chain, no rendering.
    for (let i = 0; i < 90; i++) {
      pin();
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      CBZ.stepSim(1 / 60);
      if (CBZ.player) CBZ.player.hp = 100;
    }
    pin();
    CBZ.stepSim(1 / 60);
    pin();
  }
  S.used[subject.species + ":" + list.indexOf(actor)] = true;

  // ---- read the result off the live transforms ----------------------------
  grp.visible = true;
  liveMats();
  const surf = CBZ.citySeaHeightAt(grp.position.x, grp.position.z);
  const box = new T.Box3().setFromObject(grp);
  const aboveWater = grp.position.y - surf;          // <0 means submerged origin
  const bellyAbove = box.min.y - surf;               // <0 means the belly is wet
  // How many separate things stand proud of the surface at this animal's
  // footprint: its own authored dorsal, plus wildlife_shark.js's fin proxy if
  // that is drawn too. Two is the owner's "another fin above the fin".
  let surfaceFins = box.max.y > surf + 0.02 ? 1 : 0;
  const sharkProxy = actor._shark;
  const proxyFinUp = !!(sharkProxy && sharkProxy.root && sharkProxy.root.visible &&
    sharkProxy.fin && sharkProxy.fin.visible && (sharkProxy.finK || 0) > 0.05);
  if (proxyFinUp) surfaceFins += 1;

  // ---- camera: a swimmer's eye just over the swell, on the waterline -------
  const camera = CBZ.camera;
  let camPos, camAim;
  if (ref && ref.camera) { camPos = ref.camera.position.slice(); camAim = ref.camera.target.slice(); }
  else {
    const g = wf.shoreGradient ? wf.shoreGradient(anchor.x, anchor.z, 10, {}) : { x: 1, z: 0 };
    // stand SEAWARD of the subject (away from land) and look back across it
    const sx = -(g.x || 1), sz = -(g.z || 0);
    const m = Math.hypot(sx, sz) || 1;
    const d = Number(subject.camDist) || 11, side = Number(subject.camSide) || 0.5;
    camPos = [
      anchor.x + (sx / m) * d + (-sz / m) * d * side,
      surf + (Number(subject.camEye) || 1.5),
      anchor.z + (sz / m) * d + (sx / m) * d * side,
    ];
    camAim = [anchor.x, surf + (Number(subject.aimUp) || 0.1), anchor.z];
  }
  camera.aspect = input.width / input.height;
  camera.fov = 52; camera.near = 0.12; camera.far = 24000;
  camera.position.set(camPos[0], camPos[1], camPos[2]);
  camera.lookAt(camAim[0], camAim[1], camAim[2]);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(camPos[0], 0, camPos[2]);
  }
  hideHud();
  CBZ.renderer.render(CBZ.scene, camera);

  // ---- overlay ------------------------------------------------------------
  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector(`[data-${n}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:64px;left:26px;font-size:26px;font-weight:800;letter-spacing:-.02em";
  q("focus").textContent = subject.focus;
  q("focus").style.cssText = "position:absolute;top:100px;left:28px;color:#c3d4de;font-size:13px;font-weight:550;max-width:730px;line-height:1.35";
  q("state").textContent = subject.state + (huntState ? "  ·  " + huntState : "");
  q("state").style.cssText = `position:absolute;right:26px;top:25px;color:${before ? "#ffb0b0" : "#7ff0bb"};font-size:11px;font-weight:900;letter-spacing:.1em`;
  q("read").textContent =
    `origin ${aboveWater >= 0 ? "+" : ""}${aboveWater.toFixed(2)}m vs surface · belly ${bellyAbove >= 0 ? "+" : ""}${bellyAbove.toFixed(2)}m · fins at surface ${surfaceFins}`;
  q("read").style.cssText = `position:absolute;right:26px;top:52px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:${aboveWater > 0 ? "#ff9c9c" : "#9fe8c3"}`;
  q("note").textContent = subject.note;
  q("note").style.cssText = "position:absolute;right:26px;bottom:20px;padding:7px 10px;border-radius:6px;background:rgba(3,18,28,.72);color:#bfe9ff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;max-width:520px";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:20px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    species: subject.species,
    anchor,
    shore: anchor.shore,
    waterColumn: Number((CBZ.citySeaBedY
      ? surf - CBZ.citySeaBedY(anchor.x, anchor.z)
      : (CBZ.cityWaterDepthAt ? CBZ.cityWaterDepthAt(anchor.x, anchor.z) : 0)).toFixed(2)),
    floorAtHere: CBZ.floorAt ? Number(CBZ.floorAt(anchor.x, anchor.z).toFixed(3)) : null,
    huntState,
    proxyFinUp,
    camera: { position: camPos.slice(), target: camAim.slice() },
    metrics: {
      aboveWaterM: Number(aboveWater.toFixed(3)),
      bellyAboveWaterM: Number(bellyAbove.toFixed(3)),
      surfaceFins,
    },
  };
}

export default {
  id: "marine-surface",
  title: "Marine Life at the Waterline — The Flying Shark",
  description: "Five matched frames from the real game world (seed 90210) put a hunting great white, a cruising great white, an inshore dolphin and an orca carcass at deterministic points of real water, then photograph each from a swimmer's eye height on the waterline. The deployed build clamps every marine body against CBZ.floorAt — the WALKABLE floor, which reads flat 0 over the whole sea, about half a metre above the waterline — so a hunting shark is lifted into the air while its fin proxy keeps drawing correctly at the surface. The local build asks city/waterfield.js's real bathymetry instead, through one shared marine law, and caps how far any bed may ever lift a body.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  pairNote: "Same seed · same water anchor · same camera · same species · same production tick",
  method: "Each page boots its own city at seed 90210, freezes the rAF loop, seeds Math.random from one LCG, teleports a registered animal to a deterministic water point and drives that page's own CBZ.sharkBrain / CBZ.stepSim / CBZ.wildlifeDeathTumble. The runner copies the deployed anchors and camera into the local capture, so the animal's height in the water column is the only variable.",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metrics: {
    aboveWaterM: { label: "Model origin above the live surface", unit: "m", better: "lower" },
    bellyAboveWaterM: { label: "Lowest point of the body above the surface", unit: "m", better: "lower" },
    surfaceFins: { label: "Separate dorsals cutting the surface", unit: "", better: "lower" },
    rippleContrast: { label: "Micro-detail in the near band — mean luminance step between adjacent pixels", unit: "/255", better: "higher" },
    tealIndex: { label: "Near-water green-vs-blue balance (teal, not navy)", unit: "%", better: "higher" },
    horizonLift: { label: "Far water brighter than near water (aerial silvering)", unit: "/255", better: "higher" },
    skyGap: { label: "Sky brighter than the near sea (the sea must not be a mirror)", unit: "/255", better: "higher" },
  },
  metricsNote: "Negative metres mean the body is under the water, which is the whole point. One dorsal at the surface is correct; two is the owner's \"another fin above the fin\".",
  subjects,
  stage: stageMarine,
};
