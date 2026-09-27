/* Gang Life roads + highways: do the streets and freeways read as real?

   Six plates: a downtown junction at street level, an avenue at golden hour,
   a highway interchange from above, the lower road under the overpass, a ramp
   merge at driver height, and a night street. The highway plates sit at a
   FIXED world pose (the interchange built in the roads wave); the BEFORE side
   photographs the same ground as it was (an at-grade T).

   Run (BEFORE = a static snapshot of the pre-wave commit on its own port):
     PORT=8811 python3 tools/devserver.py   # from the snapshot folder
     ba --preset city-roads-highways --before http://127.0.0.1:8811/
*/


const subjects = [
  { id: "junction-street", label: "Noon: a downtown junction at street level", phase: 0.25, view: "junction",
    focus: "Kerb returns, kerb ramps, gutters, crosswalks, stop bars, signals and signs at a Midtown crossing." },
  { id: "avenue-golden", label: "Golden hour: down the avenue", phase: 0.465, view: "avenue",
    focus: "Asphalt aggregate, cracks and patches, wheel paths, lane paint and the kerb line in low sun." },
  { id: "interchange-aerial", label: "Noon: the highway interchange from above", phase: 0.3, view: "hwAerial",
    focus: "Ramps, gores, flyover bridge, barriers and shoulders read as a real freeway interchange." },
  { id: "under-overpass", label: "Noon: under the overpass", phase: 0.3, view: "hwUnder",
    focus: "Deck thickness, girders, piers, bearings and the road passing beneath." },
  { id: "ramp-merge", label: "Afternoon: a ramp merge at driver height", phase: 0.36, view: "hwMerge",
    focus: "Acceleration lane, gore chevrons, barrier and guardrail, rumble strips." },
  { id: "night-street", label: "Night: a lit street", phase: 0.75, view: "night",
    focus: "Street lights throwing warm pools on the asphalt and footway; signals lit." },
];

async function stageCityRoadsHighways(input) {
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
    if (CBZ.camera && CBZ.camera.children) {
      for (const child of CBZ.camera.children) {
        let isViewModel = false;
        if (child && child.traverse) child.traverse((o) => { if (o && o.isMesh && o.renderOrder >= 999) isViewModel = true; });
        if (isViewModel) child.visible = false;
      }
    }
  };

  let S = window.__cityRoadsHighways;
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
    tick(60);
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.root || !A.roads || !A.xLines || !A.zLines) return { ok: false, err: "city arena missing" };
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 10px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-source></div>";
    document.body.appendChild(overlay);
    hideHud(overlay);
    S = window.__cityRoadsHighways = { A, overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  // Filled from the HIGHWAYS builder's report (world coordinates). `null` keeps
  // the plate on the city grid so the preset never photographs the void.
  const HIGHWAY = {
    // Route 5 meets Route 1's west leg at (-2380,-700); the flyover crosses R1.
    aerial: { x: -2230, y: 170, z: -560, ax: -2375, ay: 0, az: -790, fov: 55 },
    under: { x: -2371, y: 1.6, z: -735, ax: -2384, ay: 6.8, az: -800, fov: 60 },
    merge: { x: -2399.6, y: 1.4, z: -1000, ax: -2392, ay: 1.2, az: -1140, fov: 58 },
  };
  const subject = input.subject;
  const A = S.A;
  const ROAD = A.ROAD || 18;
  try { if (CBZ.dayPhase) CBZ.dayPhase(subject.phase); } catch (_) {}
  // Midtown: the median avenue xLines[2] and the central cross street.
  const aveX = A.xLines[2];
  const midX = A.xLines[3];
  const crossZ = A.zLines[3];
  const surfY = (x, z) => (A.vehicleSurfaceY ? A.vehicleSurfaceY(x, z) : 0.065);
  const H = ROAD / 2;
  const cams = {
    // on block (3,3)'s west footway at the Midtown junction (0,-700)
    junction: { x: 10.2, y: 1.9, z: -686, ax: -4, ay: 0.1, az: -706, fov: 62 },
    // driver's eye on the median avenue x=52, looking north up it
    avenue: { x: 57.4, y: 1.3, z: -780, ax: 52, ay: 0.3, az: -640, fov: 55 },
    // on the east footway of the median avenue x=-52, looking north along it
    night: { x: -41.5, y: 1.9, z: -770, ax: -50, ay: 0.2, az: -680, fov: 60 },
  };
  const hwFallback = { x: midX + 8, y: 190, z: crossZ - 40, ax: midX + 8, ay: 0, az: crossZ + 30, fov: 50 };
  cams.hwAerial = HIGHWAY.aerial || hwFallback;
  cams.hwUnder = HIGHWAY.under || cams.junction;
  cams.hwMerge = HIGHWAY.merge || cams.avenue;
  const proposed = cams[subject.view] || cams.junction;
  const cam = (input.referenceStage && input.referenceStage.camera) || proposed;
  if (CBZ.player && CBZ.player.pos) { CBZ.player.driving = false; CBZ.player.pos.set(cam.x, Math.max(0.2, cam.y - 1.6), cam.z); }
  const camera = CBZ.camera;
  const aim = () => {
    camera.aspect = input.width / input.height;
    camera.fov = cam.fov;
    camera.near = 0.05;
    camera.far = Math.max(2400, camera.far || 2400);
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(cam.ax, cam.ay, cam.az);
    camera.updateProjectionMatrix();
    if (typeof CBZ.skySync === "function") CBZ.skySync();
  };
  aim();
  tick(300);
  hidePlayerPresentation();
  hideHud(S.overlay);
  aim();
  for (const pool of [CBZ.cityPeds, CBZ.cityCops]) {
    for (const p of pool || []) {
      if (!p || !p.pos) continue;
      const g2 = p.group || (p.char && p.char.group);
      if (g2 && Math.hypot(p.pos.x - cam.x, p.pos.z - cam.z) < 7) g2.visible = false;
    }
  }
  CBZ.renderer.render(CBZ.scene, camera);
  let draws = 0, tris = 0;
  try { draws = CBZ.renderer.info.render.calls; tris = CBZ.renderer.info.render.triangles; } catch (_) {}
  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#bb4040" : "#17825a"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:66px;left:26px;font-size:25px;font-weight:800;letter-spacing:-.02em";
  q("focus").textContent = subject.focus;
  q("focus").style.cssText = "position:absolute;top:102px;left:27px;color:#d0dbe3;font-size:12px;font-weight:600;max-width:790px;line-height:1.4";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:15px;left:26px;color:#a9bac7;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";
  return { ok: true, camera: cam, metrics: { drawCalls: draws, triangles: tris } };
}

export default {
  id: "city-roads-highways",
  title: "Gang Life: streets and highways that read as real",
  description: "A downtown junction, an avenue at golden hour, a highway interchange from above, under the overpass, a ramp merge, and a night street.",
  beforeLabel: "BEFORE",
  afterLabel: "AFTER: ROADS WAVE",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90326, cfg_BOOT_METER: 0 },
  stageTimeoutMs: 600000,
  pairNote: "Same seed, pose, phase, quality and viewport; the BEFORE camera is reused by AFTER.",
  method: "Boots Gang Life on each side, pins the clock, parks the player at the pose so streaming and culling settle, steps the real simulation five seconds and renders.",
  metricsNote: "Draw calls and triangles are renderer.info for the photographed frame.",
  metrics: {
    drawCalls: { label: "Draw calls in frame", better: "lower" },
    triangles: { label: "Triangles in frame" },
  },
  subjects,
  stage: stageCityRoadsHighways,
};
