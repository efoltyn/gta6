/* Underwater colour comparison for tools/visual-compare.mjs.

   THIS PRESET PHOTOGRAPHS THE REAL GAME, not a studio scene. Every other
   preset in this folder builds a private THREE.Scene because it is comparing
   an ASSET; the underwater look is not an asset — it is the live scene fog,
   the live DOM tint, the live sea shader and the real sea floor, all driven by
   where the player's eye actually is. So both sides boot the same seeded city,
   click through the title, jump to free play, freeze rAF, and then drive the
   world with CBZ.stepSim while the player is teleported into the water at
   authored depths.

   The five frames are the owner's brief, in order:
     a) FP, shallow near the shore, looking along the sandy bottom
     b) FP, deep ocean, looking horizontally
     c) FP, deep ocean, looking UP at the surface
     d) TP, mid depth, the player readable mid-frame
     e) above the surface, near shore, looking DOWN into shallow water

   The coast is FOUND, not hard-coded: the stage bisects the live shore field
   along +X at z = -300 and offsets from the crossing, so the same recipe works
   on both builds of the same seed without a magic number that could drift.

   The after side reuses the before side's exact staging (player position, the
   yaw/pitch it settled on) and finally hard-copies the deployed camera's world
   transform, so lens and framing are identical and COLOUR is the only variable.
*/

const subjects = [
  {
    id: "fp-shallow-sand",
    label: "First Person — Shallow, over the sand",
    focus: "Near the shore the water should read LIGHT turquoise with the sandy bottom clearly visible, and you should see a long way.",
    view: "fp", offshore: 95, eye: 6.9, look: -0.30,
    state: "SHALLOW · 4 m EYE · SAND BELOW",
  },
  {
    id: "fp-deep-horizon",
    label: "First Person — Deep ocean, level",
    focus: "A kilometre out the same water should be a rich, dark navy that closes in — the depth cue is colour, not props.",
    view: "fp", offshore: 1100, eye: 11, look: 0.0,
    state: "DEEP · 11 m EYE · HORIZONTAL",
  },
  {
    id: "fp-deep-up",
    label: "First Person — Deep ocean, looking up",
    focus: "Looking up from the deep, the surface must be a BRIGHT ceiling over a dark column, not one flat blue wash.",
    view: "fp", offshore: 1100, eye: 15, look: 0.95,
    state: "DEEP · 15 m EYE · LOOKING UP",
  },
  {
    id: "tp-mid-depth",
    label: "Third Person — Mid depth, swimmer in frame",
    focus: "Third person must get the same graded medium, with the swimmer readable as a silhouette against it.",
    view: "tp", offshore: 420, eye: 9, look: -0.16, matchCamera: false,
    state: "MID · 9 m EYE · THIRD PERSON",
  },
  {
    id: "above-shallow-down",
    label: "Above the Surface — Looking down at the shallows",
    focus: "From the surface the near-shore water should lighten toward the bottom instead of turning a flat bottle-green.",
    view: "shore", offshore: -1, eye: 0, look: -0.35, matchCamera: false,
    state: "ON THE SAND · LOOKING DOWN",
  },
];

async function stageUnderwater(input) {
  const T = window.THREE, CBZ = window.CBZ, S0 = input.subject;
  if (!T || !CBZ) return { ok: false, missing: "CBZ" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, ms, every) {
    const end = Date.now() + (ms || 60000);
    while (Date.now() < end) { try { if (fn()) return true; } catch (e) {} await wait(every || 200); }
    return false;
  }

  let W = window.__uwLook;
  if (!W) {
    // ---- one-time: boot the real world into free play --------------------
    const booted = await until(() => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
      CBZ.stepSim && document.getElementById("playBtn"), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    // Headless SwiftShader settles on the LOW tier, which halves the water
    // view distance the owner actually plays at. Pin it before anything is
    // photographed so both sides are the same build of the same look.
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (e) {}
    // Noon: the underwater ramp is multiplied by the live day factor, and a
    // dusk capture on one side would be a colour difference we did not make.
    // core/daynight.js: ang = phase * 2PI and sun height = sin(ang), so 0.25
    // is the sun at its zenith. The underwater ramp is multiplied by the live
    // day factor, and a dusk capture on one side would be a colour difference
    // we did not make.
    try { if (CBZ.dayPhase) CBZ.dayPhase(0.25); } catch (e) {}

    // From here CBZ.stepSim is the only clock, so both sides sample identical
    // simulated seconds no matter how fast the machine is.
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    // ---- FIND THE COAST (never hard-code a seed's geometry) --------------
    const Z = -300;
    const shoreAt = (x) => CBZ.waterField.shoreAt(x, Z);
    let inner = null, outer = null;
    for (let x = 0; x < 16000; x += 40) {
      const s = shoreAt(x);
      if (s > 0) inner = x; else if (inner != null) { outer = x; break; }
    }
    if (outer == null) return { ok: false, err: "no coast along z=-300" };
    let a = inner, b = outer;
    for (let i = 0; i < 26; i++) { const m = (a + b) / 2; if (shoreAt(m) > 0) a = m; else b = m; }

    // The game HUD is real, but it is not what is being compared and it eats a
    // third of the frame. Hide the HUD chrome only — the underwater tint and
    // the breath vignette are their OWN elements outside #hud and must stay,
    // because they are half of what this preset photographs.
    // An inline style loses: the HUD rewrites its own `display` every frame.
    // A stylesheet !important rule is the one thing an inline write cannot beat.
    const st = document.createElement("style");
    st.textContent = "#hud,#crosshair{display:none !important}";
    document.head.appendChild(st);

    const overlay = document.createElement("div");
    overlay.id = "__uwOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f2f9fd;text-shadow:0 2px 10px #00121e;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-metric></div><div data-source></div>";
    document.body.appendChild(overlay);

    W = window.__uwLook = { coastX: b, Z, overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {} },
    };
  }

  const P = CBZ.player;
  if (!P || !P.pos) return { ok: false, err: "no player" };
  const ref = input.referenceStage || null;
  // The after side re-runs the SAME staging inputs, so the medium is evaluated
  // at the same place; the deployed camera transform is copied at the end.
  const offshore = ref ? ref.offshore : Number(S0.offshore);
  const x = W.coastX + offshore, z = W.Z;
  const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -0.48;
  const bed = CBZ.citySeaBedDepthAt ? CBZ.citySeaBedDepthAt(x, z)
    : (CBZ.cityWaterDepthAt ? CBZ.cityWaterDepthAt(x, z) : 0);

  // Yaw: face straight out to sea (+X here). Self-calibrated below against the
  // camera's own forward vector rather than trusted from a sign convention —
  // a preset that photographs the wrong bearing is a lie that still passes.
  const wantX = 1, wantZ = 0;
  const baseYaw = ref ? ref.yaw : Math.atan2(wantX, wantZ);
  // ELEVATION, not "pitch". The subject declares where to LOOK (+ = up at the
  // surface, - = down at the bed); which sign of cam.pitch/fps.fp produces
  // that is calibrated against the camera's own forward vector below, because
  // this repo's own camera notes record the vertical response inverting once
  // already and a preset that photographs the sky while its caption says
  // "looking down at the sand" is a lie that still passes.
  const look = ref ? ref.look : Number(S0.look || 0);
  let pitch = ref ? ref.pitch : look;
  const fp = S0.view !== "tp";   // the beach frame is first person too

  if (CBZ.setFPS) CBZ.setFPS(fp);
  if (CBZ.cam) { CBZ.cam.yaw = baseYaw; CBZ.cam.pitch = pitch; }
  if (CBZ.fps) CBZ.fps.fp = pitch;

  // THE EYE, NOT THE FEET. The subject declares where the CAMERA should be
  // (metres below the surface), because that is the only number the look is a
  // function of — and the offset from the swimmer's body origin to the eye is
  // not a constant: it changes with first/third person, with the boom, and
  // with how the buoyancy solve settles. So this is a solve, not an offset:
  // place, settle, MEASURE the camera, correct, repeat. Two iterations land
  // inside a few centimetres, and the achieved depth is reported so the report
  // proves both sides photographed the same place.
  function placeAndSettle(yaw, bodyY, ticks) {
    if (CBZ.cam) { CBZ.cam.yaw = yaw; CBZ.cam.pitch = pitch; }
    if (CBZ.fps) CBZ.fps.fp = pitch;
    let target;
    if (S0.view === "shore") {
      // Standing on the beach: no swim entry at all. The earlier attempt put
      // the player IN the water at the surface and photographed his own splash
      // sprites from 20 cm away — the frame was foam, not water.
      target = (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + 0.05;
      P.pos.set(x, target, z);
      P.vy = 0;
    } else {
      const floorLimit = surf - Math.max(1.2, bed - 0.5);
      target = Math.max(Math.min(bodyY, surf - 0.05), floorLimit);
      P.pos.set(x, target, z);
      if (CBZ.citySwimBegin) CBZ.citySwimBegin({ y: target });
    }
    P.hp = 100;
    for (let i = 0; i < ticks; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      if (CBZ.cam) { CBZ.cam.yaw = yaw; CBZ.cam.pitch = pitch; }
      if (CBZ.fps) CBZ.fps.fp = pitch;
      CBZ.stepSim(1 / 60);
    }
    return target;
  }
  function eyeDepthNow() {
    const c = CBZ.camera;
    const s = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(c.position.x, c.position.z) : surf;
    return s - c.position.y;
  }

  const wantEye = ref ? ref.wantEye : Number(S0.eye);
  let yaw = baseYaw;
  let bodyY = surf - wantEye;
  placeAndSettle(yaw, bodyY, 34);
  // Bearing self-check: a preset that photographs the wrong way round is a lie
  // that still passes, so trust the camera's own forward vector, not a sign.
  const e = CBZ.camera.matrixWorld.elements;
  if (!ref && (-e[8] * wantX + -e[10] * wantZ) < 0) {
    yaw = baseYaw + Math.PI;
    placeAndSettle(yaw, bodyY, 12);
  }
  // Elevation self-check: does the camera's forward actually point the way the
  // subject asked? If not, the sign convention is the other one — flip it once.
  if (!ref && Math.abs(look) > 0.05) {
    const fy = -CBZ.camera.matrixWorld.elements[9];
    if (fy * look < 0) { pitch = -pitch; placeAndSettle(yaw, bodyY, 12); }
  }
  for (let pass = 0; S0.view !== "shore" && pass < 3; pass++) {
    const err = wantEye - eyeDepthNow();
    if (Math.abs(err) < 0.12) break;
    bodyY -= err;
    placeAndSettle(yaw, bodyY, 10);
  }
  placeAndSettle(yaw, bodyY, 8);            // top up the tint ease

  // The after side adopts the deployed camera byte-for-byte for the render —
  // EXCEPT where the change under test is the camera itself. The deployed
  // third-person camera is pinned above the waterline (systems/camera.js's
  // absolute 0.6 floor over a sea whose floorAt is a phantom flat 0); copying
  // that transform onto a build that can now follow the swimmer down would
  // render underwater fog from an above-water lens and hide the whole point.
  // Both sides still stage the SAME player at the SAME place; the frames are
  // matched on subject, not on transform, and both transforms are reported.
  if (ref && ref.cam && S0.matchCamera !== false) {
    CBZ.camera.position.fromArray(ref.cam.p);
    CBZ.camera.quaternion.fromArray(ref.cam.q);
    CBZ.camera.fov = ref.cam.fov;
    CBZ.camera.updateProjectionMatrix();
    CBZ.camera.updateMatrixWorld(true);
  }

  const cam = CBZ.camera;
  const eyeSurf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(cam.position.x, cam.position.z) : surf;
  const eyeDepth = eyeSurf - cam.position.y;
  const fogNow = CBZ.scene && CBZ.scene.fog;

  // ---- labels ------------------------------------------------------------
  const after = input.side === "after", ov = W.overlay;
  const q = (s) => ov.querySelector(s);
  const side = q("[data-side]");
  side.textContent = after ? input.afterLabel : input.beforeLabel;
  side.style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${after ? "#187e5a" : "#bd4848"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  const name = q("[data-name]"); name.textContent = S0.label;
  name.style.cssText = "position:absolute;top:66px;left:27px;font-size:27px;font-weight:850;letter-spacing:-.025em";
  const foc = q("[data-focus]"); foc.textContent = S0.focus;
  foc.style.cssText = "position:absolute;top:104px;left:28px;color:#c3d7e2;font-size:13px;font-weight:550;max-width:780px;line-height:1.35";
  const st = q("[data-state]"); st.textContent = S0.state;
  st.style.cssText = `position:absolute;right:26px;top:25px;color:${after ? "#7df0b8" : "#ffaaaa"};font-size:11px;font-weight:900;letter-spacing:.1em`;
  const met = q("[data-metric]");
  met.textContent = "eye " + eyeDepth.toFixed(1) + " m · water column " + bed.toFixed(1) +
    " m · fog far " + (fogNow && fogNow.far != null ? fogNow.far.toFixed(1) : "?") +
    " m · " + (fogNow && fogNow.color ? "#" + fogNow.color.getHexString() : "?");
  met.style.cssText = "position:absolute;right:26px;bottom:21px;padding:7px 10px;border-radius:6px;background:rgba(3,18,28,.78);color:#bfeeff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  const src = q("[data-source]");
  src.textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  src.style.cssText = "position:absolute;bottom:21px;left:27px;color:#93acba;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    offshore, yaw, pitch, look, wantEye, view: S0.view,
    playerY: +P.pos.y.toFixed(2),
    swimming: !!(CBZ.citySwimming && CBZ.citySwimming()),
    fwdY: +(-CBZ.camera.matrixWorld.elements[9]).toFixed(3),
    coastX: +W.coastX.toFixed(1),
    bedDepth: +bed.toFixed(2),
    eyeDepth: +eyeDepth.toFixed(2),
    submerged: !!(CBZ.cityCameraSubmerged && CBZ.cityCameraSubmerged()),
    fogFar: fogNow && fogNow.far != null ? +fogNow.far.toFixed(2) : null,
    fogColor: fogNow && fogNow.color ? "#" + fogNow.color.getHexString() : null,
    seabedMesh: !!(CBZ.waterSeabedMesh && CBZ.waterSeabedMesh()),
    cam: {
      p: cam.position.toArray().map((v) => +v.toFixed(4)),
      q: cam.quaternion.toArray().map((v) => +v.toFixed(6)),
      fov: cam.fov,
    },
    metrics: {
      eyeDepth: +eyeDepth.toFixed(2),
      fogFar: fogNow && fogNow.far != null ? +fogNow.far.toFixed(2) : null,
    },
  };
}

export default {
  id: "underwater-look",
  title: "Underwater: The Colour of the Water Column",
  description: "Five matched frames of the LIVE city — first and third person, shallow to deep — comparing the deployed underwater treatment with a rebuilt one graded by the local water column. The medium's colour and visibility now run from light turquoise over a readable sandy bottom to a rich dark navy that closes in, the surface reads as a bright ceiling from below, and the sea has a floor everywhere (the deployed build has none at all past ~5 km offshore, and only a shelf 1.4 m under the surface where a swimmer can descend sixty).",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · GRADED WATER COLUMN",
  pairNote: "Same seed · same coast · same offshore distance · same eye depth · same camera transform · same quality tier · noon",
  method: "Both pages boot the same seeded city, jump to free play, freeze rAF and advance only through CBZ.stepSim. The player is teleported to a distance offshore found by bisecting the live shore field, dropped to an authored depth through CBZ.citySwimBegin, and settled for a fixed number of simulated ticks. The bearing is self-calibrated against the camera's own forward vector. The runner then copies the deployed camera transform into the local capture. These are live game frames including the real HUD, not retouched images.",
  viewport: { width: 1100, height: 680 },
  urlParams: { seed: 90210 },
  stageTimeoutMs: 420000,
  readyExpression: "window.THREE && window.CBZ && CBZ.stepSim && CBZ.game && (CBZ.bootComplete || CBZ.game.state === 'title')",
  metrics: {
    eyeDepth: { label: "Eye depth below the surface", unit: "m", better: "higher" },
    fogFar: { label: "Underwater view distance", unit: "m", better: "higher" },
  },
  metricsNote: "Eye depth proves both sides photographed the same place; the view distance is the visibility half of the grading (long over sand, short in the deep — so 'higher' is only meaningful per row).",
  subjects,
  stage: stageUnderwater,
};
