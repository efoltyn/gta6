/* Gang City road contact + street-lighting proof.

   This is a same-checkout flag A/B. Both sides boot the registered Gang Life
   mode, build the same seeded city, park the same real enterable car on the
   same cross-street, and use the same camera supplied back by the BEFORE
   stage. The sole difference is cfg_CITY_STREET_REALISM_V1.

   Run:
     ba --preset city-road-lighting --no-open
*/

const subjects = [
  {
    id: "noon-tire-contact",
    label: "Noon · tires meet the rendered asphalt",
    phase: 0.25,
    view: "contact",
    focus: "The low three-quarter is deliberately unforgiving: all four tire bottoms must meet the cross-street's visible asphalt instead of disappearing into its raised render slab.",
  },
  {
    id: "dusk-lamp-handoff",
    label: "Dusk · fixtures take over from the sky",
    phase: 0.49,
    view: "street",
    focus: "Same car and block as noon. Street fixtures should become readable before the ambient sky falls away, without turning daylight into an orange floodlit set.",
  },
  {
    id: "midnight-light-pool",
    label: "Midnight · dark city, localized road light",
    phase: 0.75,
    view: "street",
    focus: "Gang City should be genuinely dark between fixtures while the nearest cobra heads cast a localized warm pool onto asphalt, paint, curb, and car.",
  },
];

async function stageCityRoadLighting(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const tick = (frames) => {
    for (let i = 0; i < frames; i++) {
      CBZ.hitstop = 0;
      CBZ.slowmo = 0;
      try { CBZ.stepSim(1 / 60); } catch (_) {}
      if (CBZ.player) { CBZ.player.dead = false; CBZ.player.hp = 100; }
    }
  };
  const hideHud = (overlay) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child === overlay) continue;
      child.style.visibility = "hidden";
    }
  };
  const hidePlayerPresentation = () => {
    try { if (CBZ.disarmFPSAfterIntro) CBZ.disarmFPSAfterIntro(); } catch (_) {}
    try { if (CBZ.fpsSetAim) CBZ.fpsSetAim(false); } catch (_) {}
    try { if (CBZ.fpsSetActive) CBZ.fpsSetActive(false); else if (CBZ.setFPS) CBZ.setFPS(false); } catch (_) {}
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
    // Both gunplay implementations parent their viewmodel directly to the
    // camera and give its meshes the 999/1000 render-order depth pass. Hide
    // that presentation root too, so a persisted loadout cannot cover one
    // side of a world-lighting comparison.
    if (CBZ.camera && CBZ.camera.children) {
      for (const child of CBZ.camera.children) {
        let isViewModel = false;
        if (child && child.traverse) child.traverse((o) => { if (o && o.isMesh && o.renderOrder >= 999) isViewModel = true; });
        if (isViewModel) child.visible = false;
      }
    }
  };
  const hideAmbientCast = (hero) => {
    for (const car of CBZ.cityCars || []) {
      if (car !== hero && car && car.group) car.group.visible = false;
    }
    // Gang City owns its population in cityPeds/cityCops; CBZ.npcs is only
    // one compatibility roster. Clear every canonical pool so a stochastic
    // passer-by cannot exist on just one side of the locked comparison.
    const seen = new Set();
    for (const pool of [CBZ.cityPeds, CBZ.cityCops, CBZ.npcs, CBZ.guards]) {
      for (const actor of pool || []) {
        if (!actor || seen.has(actor)) continue;
        seen.add(actor);
        const group = actor.group || (actor.char && actor.char.group);
        if (group) group.visible = false;
      }
    }
  };
  const nearest = (values, n) => values.reduce((best, v) =>
    Math.abs(v - n) < Math.abs(best - n) ? v : best, values[0]);

  let S = window.__cityRoadLighting;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="city"]'),
      360000
    );
    if (!booted) return { ok: false, err: "never booted" };

    if (CBZ.CONFIG) {
      CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
      CBZ.CONFIG.GANG_PERSIST = false;
    }
    document.querySelector('[data-mode="city"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    await until(() => {
      const card = document.getElementById("bootload");
      return !card || getComputedStyle(card).display === "none";
    }, 30000, 50);
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    tick(120);

    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.root || !A.roads || !A.streetProps) return { ok: false, err: "city arena missing" };

    // Choose a real mainland CROSS-STREET so its visible top is the higher
    // 0.065 m road layer. Candidate lamps come from the real placement pass;
    // no fixture is fabricated for the photograph.
    const centerZ = A.center && Number.isFinite(A.center.z) ? A.center.z : A.zLines[(A.zLines.length / 2) | 0];
    const roadZ = nearest(A.zLines, centerZ);
    const road = A.roads.find((r) => !r.vertical && Math.abs(r.z - roadZ) < 0.01 && r.len > A.step * 2);
    if (!road) return { ok: false, err: "mainland cross-street missing" };
    const lamps = A.streetProps.filter((p) => p && p.type === "lamp" &&
      Math.abs(Math.abs(p.z - road.z) - (A.ROAD / 2 + 1)) < 0.8 &&
      p.x > A.minX + A.step && p.x < A.maxX - A.step);
    lamps.sort((a, b) => Math.abs(a.x - A.center.x) - Math.abs(b.x - A.center.x));
    const lamp = lamps[0];
    if (!lamp) return { ok: false, err: "no real lamp on comparison street" };
    const side = Math.sign(lamp.z - road.z) || 1;
    const carX = lamp.x;
    const carZ = road.z + side * Math.min(3.0, A.ROAD * 0.18);
    const hero = CBZ.cityAddParkedCar
      ? CBZ.cityAddParkedCar(carX, carZ, Math.PI / 2, { modelName: "Bison Vista", color: 0x285aa8 })
      : null;
    if (!hero || !hero.group) return { ok: false, err: "comparison car missing" };

    // Keep only the authored subject car. This is still the real city road,
    // lamp placement, car rig, terrain seating and light drivers; clearing the
    // random traffic just prevents a seeded passer-by from masking a tire.
    hideAmbientCast(hero);
    if (CBZ.player && CBZ.player.pos) {
      CBZ.player.driving = false;
      CBZ.player.pos.set(carX, 0.9, carZ + side * 2);
    }
    hidePlayerPresentation();

    const overlay = document.createElement("div");
    overlay.id = "__cityRoadLightingOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 10px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-stat></div><div data-source></div>";
    document.body.appendChild(overlay);
    hideHud(overlay);

    S = window.__cityRoadLighting = { A, road, lamp, side, hero, overlay, carX, carZ };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const A = S.A, hero = S.hero, side = S.side;
  const roadTop = A.vehicleSurfaceY ? A.vehicleSurfaceY(S.carX, S.carZ) : 0.065;
  try { if (CBZ.dayPhase) CBZ.dayPhase(subject.phase); } catch (_) {}

  // Put the player/camera budget at the inspected block, settle the real
  // terrain-seat and night-light drivers, then clear ambient traffic again.
  if (CBZ.player && CBZ.player.pos) CBZ.player.pos.set(S.carX, roadTop + 0.9, S.carZ + side * 2);
  tick(100);
  hideAmbientCast(hero);
  hero.group.visible = true;
  hidePlayerPresentation();

  // Camera coordinates are derived from the selected real lamp once on the
  // BEFORE side. AFTER consumes that returned camera verbatim.
  const contactCam = {
    x: S.carX + 4.4, y: roadTop + 0.52, z: S.road.z + side * 5.1,
    ax: S.carX - 0.15, ay: roadTop + 0.47, az: S.carZ, fov: 34,
  };
  const streetCam = {
    x: S.carX + 17.0, y: roadTop + 2.15, z: S.road.z - side * 1.4,
    ax: S.carX - 22.0, ay: roadTop + 1.05, az: S.road.z + side * 1.0, fov: 48,
  };
  const proposed = subject.view === "contact" ? contactCam : streetCam;
  const cam = (input.referenceStage && input.referenceStage.camera) || proposed;
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = cam.fov;
  camera.near = 0.05;
  camera.far = Math.max(1400, camera.far || 1400);
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();

  // The light pool binds by camera distance on a throttled real updater. Give
  // it one more interval with the locked camera nearby, then restore the exact
  // tripod after game-camera code has had its turn.
  tick(30);
  hideAmbientCast(hero);
  hero.group.visible = true;
  hidePlayerPresentation();
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(cam.ax, cam.ay, cam.az);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();

  hero.group.updateMatrixWorld(true);
  let tireBottom = Infinity, tireCount = 0;
  const box = new T.Box3();
  hero.group.traverse((o) => {
    if (!o.userData || !o.userData.playerWheel) return;
    box.setFromObject(o);
    if (Number.isFinite(box.min.y)) tireBottom = Math.min(tireBottom, box.min.y);
    tireCount++;
  });
  if (!Number.isFinite(tireBottom)) tireBottom = hero.group.position.y;
  const sinkCm = Math.max(0, roadTop - tireBottom) * 100;
  const gapCm = Math.max(0, tireBottom - roadTop) * 100;
  let audit = null;
  try { audit = CBZ.streetAudit ? CBZ.streetAudit() : null; } catch (_) {}
  const pool = A._lightPool || [];
  const activeLampLights = pool.filter((slot) => slot && slot.light && slot.light.visible && slot.boundTo && slot.boundTo.kind === "lamp");
  const roadLightIntensity = activeLampLights.reduce((m, slot) => Math.max(m, Number(slot.light.intensity) || 0), 0);
  const mi = Math.max(0, Math.min(A.xLines.length - 2, (A.xLines.length / 2) | 0));
  const mj = Math.max(0, Math.min(A.zLines.length - 2, (A.zLines.length / 2) | 0));
  const midX = (A.xLines[mi] + A.xLines[mi + 1]) * 0.5;
  const midZ = (A.zLines[mj] + A.zLines[mj + 1]) * 0.5;
  const supportError = (x, z) => {
    const visible = A.vehicleSurfaceY ? A.vehicleSurfaceY(x, z) : 0;
    const physics = CBZ.cityCarGroundY ? CBZ.cityCarGroundY(x, z) : 0;
    return Math.abs(visible - physics) * 100;
  };

  CBZ.renderer.render(CBZ.scene, camera);
  let meanLum = 0;
  try {
    const gl = CBZ.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const pixels = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] * 0.30 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11;
    meanLum = sum / (W * H);
  } catch (_) {}

  const round = (v, d) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  const metrics = {
    tireSinkCm: round(sinkCm, 2),
    tireGapCm: round(gapCm, 2),
    tireCount,
    roadSurfaceCm: round(roadTop * 100, 1),
    carBaseCm: round(hero.group.position.y * 100, 2),
    avenueSupportErrorCm: round(supportError(A.xLines[mi], midZ), 2),
    crossStreetSupportErrorCm: round(supportError(midX, A.zLines[mj]), 2),
    intersectionSupportErrorCm: round(supportError(A.xLines[mi], A.zLines[mj]), 2),
    lotSupportErrorCm: round(supportError(midX, midZ), 2),
    lamps: audit ? audit.lamps : 0,
    lampsOverRoad: audit ? audit.lampsOverRoad : 0,
    polesNoCollider: audit ? audit.polesNoCollider : 0,
    activeLampLights: activeLampLights.length,
    roadLightIntensity: round(roadLightIntensity, 2),
    sunIntensity: round(CBZ.sun ? CBZ.sun.intensity : 0, 3),
    ambientIntensity: round(CBZ.hemi ? CBZ.hemi.intensity : 0, 3),
    exposure: round(CBZ.renderer ? CBZ.renderer.toneMappingExposure : 0, 3),
    meanLuminance: round(meanLum, 2),
  };

  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#bb4040" : "#17825a"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:66px;left:26px;font-size:25px;font-weight:800;letter-spacing:-.02em";
  q("focus").textContent = subject.focus;
  q("focus").style.cssText = "position:absolute;top:102px;left:27px;color:#d0dbe3;font-size:12px;font-weight:600;max-width:790px;line-height:1.4";
  q("stat").textContent = `tire sink ${metrics.tireSinkCm.toFixed(2)} cm · gap ${metrics.tireGapCm.toFixed(2)} cm · lamp ${metrics.roadLightIntensity.toFixed(2)} · ambient ${metrics.ambientIntensity.toFixed(3)} · exposure ${metrics.exposure.toFixed(3)} · frame ${metrics.meanLuminance.toFixed(1)}/255`;
  q("stat").style.cssText = "position:absolute;bottom:37px;left:26px;color:#eef4f8;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname + new URL(input.sourceUrl).search;
  q("source").style.cssText = "position:absolute;bottom:15px;left:26px;color:#a9bac7;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  return { ok: true, camera: cam, metrics };
}

export default {
  id: "city-road-lighting",
  title: "Gang City: Roads carry cars, darkness carries streetlights",
  description: "One real enterable sedan and one real mainland block at noon, dusk, and midnight. The contact plate judges the rendered asphalt rather than the zero-height walk floor; the night plates judge localized fixtures against the ambient city, not against a brightened camera exposure.",
  beforeLabel: "BEFORE · WALK FLOOR + FLAT NIGHT",
  afterLabel: "AFTER · ROAD CONTACT + LOCAL LIGHT",
  defaultBefore: "local",
  beforeParams: { cfg_CITY_STREET_REALISM_V1: 0 },
  afterParams: { cfg_CITY_STREET_REALISM_V1: 1 },
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90326, cfg_BOOT_METER: 0 },
  stageTimeoutMs: 600000,
  pairNote: "Same checkout · city seed · block · car · lamp · phase · quality · viewport · BEFORE camera reused by AFTER",
  method: "The runner boots the registered Gang Life mode twice on one local checkout. A deterministic real parked-car record is seated by city/vehicles.js on a real cross-street beside a lamp chosen from city/props.js's placement census. The clock is pinned to noon, dusk, or midnight; the real light and terrain drivers settle for 130 ticks. BEFORE disables only cfg_CITY_STREET_REALISM_V1; AFTER enables it. No geometry, fixture, or light is invented by the stage.",
  metricsNote: "Tire bottom is a world-space Box3 over the four tagged playerWheel meshes; road surface is the canonical rendered-support query (0.065 m fallback for the cross-street). Lamp counts/colliders come from CBZ.streetAudit(). Active road lights inspect the bounded real PointLight pool. Mean luminance is read from the rendered WebGL framebuffer.",
  metrics: {
    tireSinkCm: { label: "Tire buried below asphalt", unit: "cm", better: "lower" },
    tireGapCm: { label: "Tire floating above asphalt", unit: "cm", better: "lower" },
    tireCount: { label: "Tagged tires visible" },
    roadSurfaceCm: { label: "Rendered road top", unit: "cm" },
    carBaseCm: { label: "Car physics base", unit: "cm" },
    avenueSupportErrorCm: { label: "Avenue render/physics mismatch", unit: "cm", better: "lower" },
    crossStreetSupportErrorCm: { label: "Cross-street render/physics mismatch", unit: "cm", better: "lower" },
    intersectionSupportErrorCm: { label: "Intersection render/physics mismatch", unit: "cm", better: "lower" },
    lotSupportErrorCm: { label: "Lot-pad render/physics mismatch", unit: "cm", better: "lower" },
    lamps: { label: "Street lamps built" },
    lampsOverRoad: { label: "Lamp heads over carriageway" },
    polesNoCollider: { label: "Street poles missing colliders", better: "lower" },
    activeLampLights: { label: "Active pooled lamp lights" },
    roadLightIntensity: { label: "Nearest road-light intensity" },
    sunIntensity: { label: "City sun intensity" },
    ambientIntensity: { label: "City hemisphere intensity" },
    exposure: { label: "Tone-map exposure" },
    meanLuminance: { label: "Rendered frame mean", unit: "0-255" },
  },
  subjects,
  stage: stageCityRoadLighting,
};
