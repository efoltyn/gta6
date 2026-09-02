/* ============================================================
   tools/visual-presets/city-load-weight.mjs

   WHAT THE CITY WEIGHS, PHOTOGRAPHED.

   2026-09-01: the city died at "99%" on the boot meter — the browser killed
   the tab and reloaded the page. No script reloads during boot; the tab was
   simply too heavy at the moment the first frame uploads the world. The
   per-geometry probe put the visible scene at 358 MB of vertex data (one
   merged deco tile: 1.3 M vertices, 55 MB) plus 12.9 k unique materials and
   a 506 MB JS heap. This preset is the A/B for any change that claims to cut
   that weight WITHOUT changing the picture: four framings that between them
   cover what the batch pass merges (downtown shells and street deco, the
   backcountry woods, a wood interior at eye height where a quantized normal
   or an 8-bit tint would show if it showed anywhere), and beside each frame
   the numbers that kill a phone.

   Staging is forest-look's: one boot per side at seed 90210, rAF frozen
   after PLAY, CBZ.stepSim the only clock, player parked at the subject so
   every distance LOD is the one a player would see.

   Run (HEAD as the before, served from a detached worktree):
     git worktree add --detach /tmp/before HEAD && (cd /tmp/before && python3 -m http.server 8811 &)
     ba --preset city-load-weight --before http://127.0.0.1:8811/ --no-open
============================================================ */

const subjects = [
  {
    id: "station-street",
    label: "Eye height outside city hall",
    focus: "Street level at the law's front door (CBZ.cityPoliceStation): shells, sidewalk, poles, signs — the batch pass's merged output at the distance it is looked at most. (The player spawn is a rooftop; a camera at ground level there is inside a wall.)",
    cam: { atStation: true, eye: 1.7, pitch: 0.04 },
  },
  {
    id: "downtown-aerial",
    label: "Downtown from 220 m",
    focus: "The dense tiles from the air. Every merged shell and deco bucket is in this frame at once; this is the frame that uploads the most bytes to the GPU.",
    cam: { atPlayer: true, alt: 220, dist: 260, pitch: -0.55, yaw: 0.9 },
  },
  {
    id: "woods-aerial",
    label: "Valley canopy from the air",
    focus: "The backcountry woods north-west of the city — the highest-vertex merged tiles in the world are vegetation.",
    cam: { x: -2500, z: -2500, alt: 260, dist: 620, pitch: -0.52, yaw: 0.9 },
  },
  {
    id: "wood-interior",
    label: "Inside the wood, eye height",
    focus: "Crowns at arm's length. If an Int8 normal or a Uint8 vertex tint changed the look, it changes it here first — banding on the shading, a stepped tint on a trunk.",
    cam: { x: -1420, z: -2260, eye: 1.7, pitch: 0.12, yaw: 0.6 },
  },
];

async function stageWeight(input) {
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
  const tick = (dt) => {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    try { CBZ.stepSim(dt == null ? 1 / 60 : dt); } catch (_) {}
    if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
  };
  const syncSky = () => {
    if (typeof CBZ.skySync === "function") { CBZ.skySync(); return; }
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(CBZ.camera.position.x, 0, CBZ.camera.position.z);
  };
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__weightOverlay") continue;
      child.style.visibility = "hidden";
    }
  };

  let S = window.__cityWeight;
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
    }, 120000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    try { CBZ.dayPhase(0.42); } catch (_) {}
    const spawn = CBZ.player && CBZ.player.pos ? { x: CBZ.player.pos.x, z: CBZ.player.pos.z } : { x: 0, z: 0 };
    window.requestAnimationFrame = function () { return 0; };
    await wait(600);
    for (let i = 0; i < 90; i++) tick();

    const overlay = document.createElement("div");
    overlay.id = "__weightOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-stat></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__cityWeight = { overlay, spawn };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const cam = Object.assign({}, input.subject.cam);
  if (cam.atPlayer) { cam.x = S.spawn.x; cam.z = S.spawn.z; }
  if (cam.atStation) {
    // stand 12 m outside the door, on the door's side of the lot, facing it
    const st = CBZ.cityPoliceStation && CBZ.cityPoliceStation();
    const lot = st && st.lot, lx = lot && lot.x != null ? lot.x : (st ? st.x : 0), lz = lot && lot.z != null ? lot.z : (st ? st.z : 0);
    const dx = st ? st.x - lx : 0, dz = st ? st.z - lz : 1, dl = Math.hypot(dx, dz) || 1;
    const ox = dx / dl, oz = dz / dl;
    cam.x = (st ? st.x : 0) + ox * 12; cam.z = (st ? st.z : 0) + oz * 12;
    cam.yaw = Math.atan2(-ox, -oz);
  }
  const groundY = (x, z) => {
    let y = 0;
    try { if (CBZ.floorAt) y = CBZ.floorAt(x, z) || 0; } catch (_) {}
    if (!Number.isFinite(y)) y = 0;
    return y;
  };
  const gy = groundY(cam.x, cam.z);
  if (CBZ.player && CBZ.player.pos && CBZ.player.pos.set) {
    CBZ.player.pos.set(cam.x, gy + 0.9, cam.z);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
  }
  for (let i = 0; i < 24; i++) tick();

  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55;
  const yaw = cam.yaw || 0;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  if (cam.alt != null) {
    const cx = cam.x - fx * (cam.dist || 400), cz = cam.z - fz * (cam.dist || 400);
    camera.position.set(cx, groundY(cx, cz) + cam.alt, cz);
  } else {
    camera.position.set(cam.x, gy + (cam.eye == null ? 1.7 : cam.eye), cam.z);
  }
  const look = 900;
  camera.lookAt(camera.position.x + fx * look, camera.position.y + Math.tan(cam.pitch || 0) * look, camera.position.z + fz * look);
  camera.updateProjectionMatrix();
  syncSky();
  hideHud();

  // ---- render + measure -------------------------------------------------
  const renderer = CBZ.renderer;
  if (renderer.info && renderer.info.reset) renderer.info.reset();
  const t0 = performance.now();
  renderer.render(CBZ.scene, camera);
  const info = (renderer.info && renderer.info.render) || {};
  const drawCalls = Number(info.calls || 0);
  const triangles = Number(info.triangles || 0);
  let ms = performance.now() - t0;
  for (let i = 0; i < 4; i++) { const a = performance.now(); renderer.render(CBZ.scene, camera); ms += performance.now() - a; }
  const renderMs = ms / 5;

  // THE WEIGHT. Unique geometries, split by whether anything visible uses
  // them: visible bytes are what the GPU will hold once the player has looked
  // around; hidden bytes are the batch pass's kept originals (LOS/colliders).
  let meshes = 0, hidden = 0, visB = 0, hidB = 0;
  const geos = new Map(), mats = new Set();
  const visUp = (o) => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };
  const gb = (g) => { let b = 0; for (const k in g.attributes) b += g.attributes[k].array.byteLength; if (g.index) b += g.index.array.byteLength; return b; };
  CBZ.scene.traverse((o) => {
    if (!(o.isMesh || o.isPoints || o.isLine)) return;
    meshes++;
    const v = visUp(o); if (!v) hidden++;
    if (o.material) { if (Array.isArray(o.material)) o.material.forEach((m) => mats.add(m)); else mats.add(o.material); }
    const g = o.geometry; if (!g) return;
    const r = geos.get(g); if (r) { r.vis = r.vis || v; return; }
    geos.set(g, { vis: v, b: gb(g) });
  });
  for (const r of geos.values()) { if (r.vis) visB += r.b; else hidB += r.b; }
  const heapMB = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0;

  // Frame identity: mean RGB off the framebuffer. Two sides that render the
  // same picture agree here to a fraction of a level; a real look change
  // does not.
  const gl = renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  let meanLum = 0;
  try {
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i] * 0.30 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
    meanLum = sum / (W * H);
  } catch (_) {}

  const round = (v, d) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  const metrics = {
    totalGeoMB: round((visB + hidB) / 1048576, 1),
    visGeoMB: round(visB / 1048576, 1),
    hidGeoMB: round(hidB / 1048576, 1),
    materials: mats.size,
    meshes,
    hiddenMeshes: hidden,
    heapMB: round(heapMB, 0),
    drawCalls,
    triangles,
    renderMs: round(renderMs, 1),
    meanLum: round(meanLum, 2),
  };

  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = input.subject.label;
  q("name").style.cssText = "position:absolute;top:64px;left:26px;font-size:27px;font-weight:800;letter-spacing:-.02em";
  q("focus").textContent = input.subject.focus;
  q("focus").style.cssText = "position:absolute;top:100px;left:28px;color:#c0cfda;font-size:13px;font-weight:550;max-width:760px";
  q("stat").textContent =
    `geometry ${metrics.totalGeoMB} MB (visible ${metrics.visGeoMB}) · ${mats.size.toLocaleString()} materials · ` +
    `${meshes.toLocaleString()} meshes · heap ${metrics.heapMB} MB · ${drawCalls} calls · ${Math.round(triangles / 1000)}k tris · ${round(renderMs, 1)} ms`;
  q("stat").style.cssText = "position:absolute;bottom:44px;left:26px;color:#dfe9f1;font:12px ui-monospace,SFMono-Regular,Menlo,monospace";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return { ok: true, metrics };
}

export default {
  id: "city-load-weight",
  title: "What the city weighs: the same picture, fewer bytes",
  description: "Four framings covering everything the batch pass merges — spawn street, downtown from the air, the backcountry canopy, a wood interior at arm's length — with the bytes, materials and heap the browser must hold beside each. The claim under test: the picture is the same and the weight is not.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · WORKING TREE",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metricsNote: "visGeoMB is the attribute+index bytes of every unique geometry some visible mesh uses — what the GPU ends up holding once the player has turned around, and what sits in the JS process from the first frame. hidGeoMB is the same for geometries only hidden meshes use (the batch pass keeps wall originals for LOS/colliders). materials/meshes are unique counts across the scene. heapMB is performance.memory. meanLum is the mean luminance of the rendered frame: identical pictures agree to a fraction of a level.",
  metrics: {
    // THE claim. Everything below it that has no `better` is informational:
    // visible/hidden is farcull's state at the instant of the shot (a
    // time-budgeted pass, so it lands differently run to run), draw calls and
    // triangles follow that state, and performance.memory in the ba browser
    // reports the whole renderer process (both sides share it) — the honest
    // heap number is load-profile.mjs's CDP metric.
    totalGeoMB: { label: "Geometry, whole scene", unit: "MB", better: "lower" },
    materials: { label: "Unique materials", better: "lower" },
    meshes: { label: "Meshes in scene", better: "lower" },
    visGeoMB: { label: "Geometry on visible meshes (farcull state)", unit: "MB" },
    hidGeoMB: { label: "Geometry on hidden meshes (farcull state)", unit: "MB" },
    hiddenMeshes: { label: "Hidden meshes (farcull state)" },
    heapMB: { label: "performance.memory (process-wide here)", unit: "MB" },
    drawCalls: { label: "Draw calls (farcull state)" },
    triangles: { label: "Triangles (farcull state)" },
    renderMs: { label: "Render (headless)", unit: "ms", better: "lower" },
    meanLum: { label: "Frame mean luminance", unit: "0-255" },
  },
  subjects,
  stage: stageWeight,
};
