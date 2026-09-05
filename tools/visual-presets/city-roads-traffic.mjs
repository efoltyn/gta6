/* Gang City roads + traffic: do the streets read as real streets?

   Four plates on one real mainland block: an eye-level sidewalk view down an
   avenue with live traffic, a three-quarter over a signalled junction, an
   aerial of the grid, and the same eye-level view after dark. Traffic is the
   live ambient fleet (stochastic on both sides — the comparison is the LOOK of
   the road and the fleet, not the position of one car).

   Run:
     ba --preset city-roads-traffic --before http://127.0.0.1:8631/
*/

const subjects = [
  {
    id: "avenue-eye-level",
    label: "Noon · eye level down the avenue",
    phase: 0.25,
    view: "eye",
    focus: "What a pedestrian sees: asphalt, kerb face, gutter, paint, traffic. Flat plastic here is the whole complaint.",
  },
  {
    id: "junction-three-quarter",
    label: "Noon · a signalled junction from the corner",
    phase: 0.25,
    view: "junction",
    focus: "Crosswalks, stop bars, the junction box, cars queued at the light and turning through it.",
  },
  {
    id: "grid-aerial",
    label: "Noon · the grid from above",
    phase: 0.25,
    view: "aerial",
    focus: "The road network as a pattern: lane paint, edge lines, wear, how the fleet spreads along the streets.",
  },
  {
    id: "avenue-night",
    label: "Midnight · the same avenue after dark",
    phase: 0.75,
    view: "eye",
    focus: "Headlights, tail lamps, lamp pools on wet-looking asphalt. A night street with unlit cars is a diorama.",
  },
];

async function stageCityRoadsTraffic(input) {
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
  const nearest = (values, n) => values.reduce((best, v) =>
    Math.abs(v - n) < Math.abs(best - n) ? v : best, values[0]);

  let S = window.__cityRoadsTraffic;
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
    // The avenue framing Midtown (xLines[2]) and the cross-street nearest the
    // centre: a real signalled junction on a real median avenue.
    const aveX = A.xLines[2];
    const centerZ = A.center && Number.isFinite(A.center.z) ? A.center.z : A.zLines[(A.zLines.length / 2) | 0];
    const crossZ = nearest(A.zLines, centerZ);
    const overlay = document.createElement("div");
    overlay.id = "__cityRoadsTrafficOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 10px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-stat></div><div data-source></div>";
    document.body.appendChild(overlay);
    hideHud(overlay);
    S = window.__cityRoadsTraffic = { A, aveX, crossZ, overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const A = S.A;
  const ROAD = A.ROAD || 18;
  try { if (CBZ.dayPhase) CBZ.dayPhase(subject.phase); } catch (_) {}
  const roadY = A.vehicleSurfaceY ? A.vehicleSurfaceY(S.aveX, S.crossZ) : 0.065;
  const cams = {
    // a driver's eye in the avenue's inner lane south of the junction, looking north up it
    eye: { x: S.aveX + 2.2, y: roadY + 1.5, z: S.crossZ - ROAD / 2 - 14,
           ax: S.aveX + 1.5, ay: roadY + 0.9, az: S.crossZ + 60, fov: 52 },
    // over the avenue, looking down onto the junction box
    junction: { x: S.aveX + 3, y: roadY + 14, z: S.crossZ - 44,
                ax: S.aveX, ay: roadY, az: S.crossZ + 2, fov: 46 },
    // near top-down over the avenue, above the Midtown towers
    aerial: { x: S.aveX + 8, y: roadY + 190, z: S.crossZ - 40,
              ax: S.aveX + 8, ay: roadY, az: S.crossZ + 30, fov: 50 },
  };
  const proposed = cams[subject.view] || cams.eye;
  const cam = (input.referenceStage && input.referenceStage.camera) || proposed;
  // Put the player's budget at the junction so the traffic pool fills the
  // frame, then let the fleet, lights and terrain seats settle for ~6 s.
  if (CBZ.player && CBZ.player.pos) { CBZ.player.driving = false; CBZ.player.pos.set(cam.x, roadY + 0.9, cam.z); }
  const camera = CBZ.camera;
  const aim = () => {
    camera.aspect = input.width / input.height;
    camera.fov = cam.fov;
    camera.near = 0.05;
    camera.far = Math.max(1400, camera.far || 1400);
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(cam.ax, cam.ay, cam.az);
    camera.updateProjectionMatrix();
    if (typeof CBZ.skySync === "function") CBZ.skySync();
  };
  aim();
  tick(360);
  // The eye-level plates are about the cars: wait on the PHYSICAL condition
  // (a driven car inside 45 m in the cone, not a number of seconds) so both
  // sides photograph traffic actually passing the tripod, up to a budget.
  if (subject.view === "eye") {
    const fx = cam.ax - cam.x, fz = cam.az - cam.z, fl = Math.hypot(fx, fz) || 1;
    const nearDriven = () => (CBZ.cityCars || []).some((c) => {
      if (!c || !c.pos || c.dead || !(c.ai || c.npcDriver) || c._propParked || Math.abs(c.v || 0) < 2) return false;
      const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z, d = Math.hypot(dx, dz);
      return d > 6 && d < 45 && (dx * fx + dz * fz) / (fl * d) > 0.6;
    });
    for (let i = 0; i < 40 && !nearDriven(); i++) tick(30);
  }
  // The night plate is about the LAMPS, so it needs a driven car in front
  // of the tripod on both sides regardless of where the pool happens to be:
  // two real ambient cars are moved onto the avenue's own lanes (the same
  // road/lane/heading fields traffic.js's recycler writes), one oncoming
  // and one ahead in our lane, then the sim runs on so they drive, brake
  // and queue at the signal like any other car. Both sides stage it alike.
  if (subject.phase > 0.5 && subject.view === "eye") {
    const road = A.roads.find((r) => r.vertical && Math.abs(r.x - S.aveX) < 0.01 && !r.district);
    const pool = (CBZ.cityCars || []).filter((c) => c && c.ai && c.road && !c.dead && !c.player && !c.owned && !c._propParked && !c.npcDriver && !c.turning);
    pool.sort((a, b) => Math.hypot(b.pos.x - cam.x, b.pos.z - cam.z) - Math.hypot(a.pos.x - cam.x, a.pos.z - cam.z));
    const laneOf = (dir, idx) => CBZ.roadLaneCenter ? CBZ.roadLaneCenter(road, dir, idx) : dir * 3.6 * (idx + 0.5);
    const place = (c, dir, idx, z) => {
      if (!c || !road) return;
      const lane = laneOf(dir, idx);
      c.road = road; c.vertical = true; c.dirSign = dir; c.lane = lane; c.laneIdx = idx;
      c.pos.x = road.x + lane; c.pos.z = z;
      c.heading = dir > 0 ? 0 : Math.PI;
      c.v = Math.max(3, (c.baseV || 8) * 0.6);
      c.turning = null; c.destX = null; c.destZ = null; c._intActive = false;
      c.group.position.set(c.pos.x, 0, c.pos.z);
      c.group.rotation.y = c.heading;
    };
    place(pool[0], -1, 0, cam.z + 34);   // oncoming, inner lane, past the junction
    place(pool[1], 1, 0, cam.z + 12);    // ahead of us in our lane, rolling up to the line
    tick(45);
  }
  hidePlayerPresentation();
  hideHud(S.overlay);
  aim();
  // a passer-by walking through the tripod covers a quarter of the plate with
  // a shoulder: hide anyone inside 7 m of the lens (visual only, both sides)
  for (const pool of [CBZ.cityPeds, CBZ.cityCops]) {
    for (const p of pool || []) {
      if (!p || !p.pos) continue;
      const g2 = p.group || (p.char && p.char.group);
      if (g2 && Math.hypot(p.pos.x - cam.x, p.pos.z - cam.z) < 7) g2.visible = false;
    }
  }

  // ---- census of the fleet in frame range ----
  const cars = CBZ.cityCars || [];
  let carsNear = 0, moving = 0, speedSum = 0, lit = 0, shadowed = 0, spinning = 0, parked = 0;
  const fwd = new T.Vector3(cam.ax - cam.x, 0, cam.az - cam.z).normalize();
  for (const c of cars) {
    if (!c || !c.pos || c.dead || !c.group || !c.group.visible) continue;
    const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z;
    const d = Math.hypot(dx, dz);
    if (d > 120) continue;
    if ((dx * fwd.x + dz * fwd.z) / Math.max(1e-3, d) < 0.5) continue;   // roughly in the cone
    carsNear++;
    const v = Math.abs(c.v || 0);
    if (v > 1) { moving++; speedSum += v; }
    if (c._lampsOn) lit++;
    if (c._blobSlot != null) shadowed++;
    if (c._wheelRolled) spinning++;
    if (c._kerbParked) parked++;
  }
  CBZ.renderer.render(CBZ.scene, camera);
  let meanLum = 0, roadLum = 0;
  try {
    const gl = CBZ.renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const pixels = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] * 0.30 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11;
    meanLum = sum / (W * H);
    // the SAME patch of road in every plate: the avenue's two outer travel
    // lanes 26 m past the junction, projected to the screen, a 40 px square
    // around each; the median of the two patches so a passing car cannot
    // stand in for the asphalt
    const lums = [];
    for (const lat of [5.4, -5.4]) {
      const p = new T.Vector3(S.aveX + lat, roadY, S.crossZ + 26).project(camera);
      if (p.z > 1 || Math.abs(p.x) > 0.95 || Math.abs(p.y) > 0.95) continue;
      const sx = Math.round((p.x + 1) * 0.5 * W), sy = Math.round((p.y + 1) * 0.5 * H);   // readPixels rows run bottom-up, as does NDC y
      for (let y = sy - 20; y < sy + 20; y++) for (let x = sx - 20; x < sx + 20; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = (y * W + x) * 4;
        lums.push(pixels[i] * 0.30 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11);
      }
    }
    lums.sort((a, b) => a - b);
    roadLum = lums.length ? lums[lums.length >> 1] : 0;
  } catch (_) {}
  const round = (v, d) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  const look = A.roadLook || {};
  const metrics = {
    roadLuminance: round(roadLum, 1),
    meanLuminance: round(meanLum, 1),
    roadFieldVertices: look.fieldVertices || 12,
    wornDashes: look.wornDashes || 0,
    carsInFrame: carsNear,
    carsMoving: moving,
    meanSpeedMs: round(moving ? speedSum / moving : 0, 1),
    carsKerbParked: parked,
    carsWheelsRolling: spinning,
    carsLampsOn: lit,
    carsGrounded: shadowed,
  };
  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#bb4040" : "#17825a"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:66px;left:26px;font-size:25px;font-weight:800;letter-spacing:-.02em";
  q("focus").textContent = subject.focus;
  q("focus").style.cssText = "position:absolute;top:102px;left:27px;color:#d0dbe3;font-size:12px;font-weight:600;max-width:790px;line-height:1.4";
  q("stat").textContent = `road ${metrics.roadLuminance.toFixed(0)}/255 · frame ${metrics.meanLuminance.toFixed(0)}/255 · cars in cone ${metrics.carsInFrame} · moving ${metrics.carsMoving} · parked ${metrics.carsKerbParked} · wheels rolling ${metrics.carsWheelsRolling} · lamps ${metrics.carsLampsOn}`;
  q("stat").style.cssText = "position:absolute;bottom:37px;left:26px;color:#eef4f8;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname + new URL(input.sourceUrl).search;
  q("source").style.cssText = "position:absolute;bottom:15px;left:26px;color:#a9bac7;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";
  return { ok: true, camera: cam, metrics };
}

export default {
  id: "city-roads-traffic",
  title: "Gang City: roads and traffic that read as real",
  description: "One real Midtown avenue and its signalled junction at noon and midnight, with the live ambient fleet in frame. Eye level, corner three-quarter, aerial, and night.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · THIS CHECKOUT",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90326, cfg_BOOT_METER: 0 },
  stageTimeoutMs: 600000,
  pairNote: "Same seed · block · junction · phase · quality · viewport · BEFORE camera reused by AFTER. Traffic is the live fleet, so individual cars differ between sides.",
  method: "The runner boots the registered Gang Life mode on each side, pins the clock, parks the camera budget at the Midtown avenue's central junction and steps the real simulation for six seconds so the traffic pool fills the block. Nothing in frame is staged beyond the camera.",
  metricsNote: "Road luminance is the median of the rendered framebuffer over two 40 px patches projected onto the avenue's outer lanes 26 m past the junction (the same asphalt in every plate). Car counts are the live fleet within 120 m inside a 60° cone. Road field vertices and worn dashes come from city.roadLook; a build without it reports the old two flat quads (12 vertices, 0 worn).",
  metrics: {
    roadLuminance: { label: "Asphalt brightness (avenue lane, 26 m past the junction)", unit: "0-255", better: "lower" },
    meanLuminance: { label: "Rendered frame mean", unit: "0-255" },
    roadFieldVertices: { label: "Road surface vertices (wear profile)" },
    wornDashes: { label: "Lane dashes painted worn" },
    carsInFrame: { label: "Cars in the camera cone" },
    carsMoving: { label: "Cars moving" },
    meanSpeedMs: { label: "Mean speed of moving cars", unit: "m/s" },
    carsKerbParked: { label: "Kerbside parked cars in cone" },
    carsWheelsRolling: { label: "Cars with rolling wheels" },
    carsLampsOn: { label: "Cars lighting the road" },
    carsGrounded: { label: "Cars with a contact shadow" },
  },
  subjects,
  stage: stageCityRoadsTraffic,
};
