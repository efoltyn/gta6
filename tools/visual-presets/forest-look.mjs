/* THE FOREST LOOK — tools/visual-compare.mjs preset.

   OWNER REFERENCE (coastal Alaska photographs, 2026-08-03): forests read as a
   dense CONTINUOUS CANOPY CARPET on valley floors and lower slopes — the
   terrain shows through as bumps in the canopy, not as gaps between trees.
   Rounded broadleaf crowns (bright, almost chartreuse where the light lands)
   are interleaved in PATCHES with darker conifer SPIRES that poke above them.
   With altitude the wood thins gradually: closed canopy -> broken clumps and
   fingers running up the gullies -> scattered krummholz -> open meadow.

   Each subject frames one of those claims in the REAL game world on both
   sides — the same seed, the same coordinates, the same camera. Nothing is
   staged in a studio scene: the trees photographed here are the ones the
   world builder planted.

   MEASUREMENTS ride along so "denser" is a number, not an adjective:
     canopyFrac  — fraction of the frame that is foliage (readPixels on the
                   real framebuffer, classified by hue). On the aerial plate
                   this IS canopy closure.
     greenSpread — std-dev of foliage luminance across those pixels: the
                   reference's whole point is that a forest is many greens.
     spireFrac   — share of foliage pixels in the upper half of the canopy
                   band, i.e. how much silhouette pokes above the roof.
     drawCalls / triangles / renderMs — the honest cost of all of it.

   Staging facts this preset depends on (verified 2026-08-03):
   - core/loop.js re-arms itself with requestAnimationFrame, so stubbing rAF
     after boot freezes rendering; CBZ.stepSim then runs the identical
     updater chain with no render.
   - biome LOD (biome_forest.js's lodUpdate) hides ground clutter when the
     PLAYER is far from the biome, so the player is teleported to the subject
     before the camera is posed — otherwise the local build photographs an
     LOD-stripped wood and calls it a regression.
   - renderer.info is per-render() in r128 and the game renders more than one
     pass per frame, so every measurement here resets it and renders once. */

const subjects = [
  {
    id: "valley-canopy",
    label: "Valley canopy from the air",
    focus: "260 m over the backcountry woods north-west of the city. The reference is a continuous carpet: terrain read as bumps in the crowns, not as gaps between them.",
    cam: { x: -2500, z: -2500, alt: 260, dist: 620, pitch: -0.52, yaw: 0.9 },
  },
  {
    id: "canopy-mix",
    label: "Species mix over the woods",
    focus: "Low pass at 90 m. Conifer spires must break the broadleaf roof in PATCHES — clusters and sweeps, never an even alternation — and the greens must run from fresh chartreuse to dark blue-green.",
    cam: { x: -2350, z: -2750, alt: 90, dist: 300, pitch: -0.30, yaw: 2.1 },
  },
  {
    id: "treeline-gradient",
    label: "Thinning with altitude",
    focus: "Across the high backcountry ridges. Closed wood below, broken clumps and fingers up the gullies, scattered scrub on the tops, open ground above — a gradient, not a cut line.",
    cam: { x: 80, z: 3200, alt: 80, dist: 520, pitch: -0.10, yaw: 0 },
  },
  {
    id: "forest-interior",
    label: "Inside the wood",
    focus: "Eye height inside Redhollow. Foreground crowns must have volume and internal shadow, and the roof must close the sky overhead.",
    cam: { x: -1420, z: -2260, eye: 1.7, pitch: 0.12, yaw: 0.6 },
  },
  {
    id: "forest-edge",
    label: "Standing at the wood's edge",
    focus: "Eye height in open backcountry looking into a stand. This is the shot that catches forest painted as scattered lollipops: the wall of the wood must be opaque.",
    cam: { x: -2760, z: -2280, eye: 1.7, pitch: 0.04, yaw: -0.7 },
  },
];

async function stageForest(input) {
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
      if (child.id === "__forestOverlay") continue;
      child.style.visibility = "hidden";
    }
  };

  let S = window.__forestLook;
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
    // Midday, clear: the reference photographs are sunlit, and a fix judged
    // through dusk fog is a fix judged through dusk fog.
    try { CBZ.dayPhase(0.42); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(600);
    for (let i = 0; i < 90; i++) tick();

    const overlay = document.createElement("div");
    overlay.id = "__forestOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-stat></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__forestLook = { overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const cam = input.subject.cam;
  const groundY = (x, z) => {
    let y = 0;
    try { if (CBZ.floorAt) y = CBZ.floorAt(x, z) || 0; } catch (_) {}
    if (!Number.isFinite(y)) y = 0;
    return y;
  };

  // Park the PLAYER at the subject so every distance-LOD in the world shows
  // the same tier it would during play, then pose the camera off that point.
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
  let eyeY;
  if (cam.alt != null) {
    // Aerial plate: stand off `dist` behind the anchor and `alt` above the
    // ground UNDER THE CAMERA, so a taller world does not put the lens in it.
    const cx = cam.x - fx * (cam.dist || 400), cz = cam.z - fz * (cam.dist || 400);
    eyeY = groundY(cx, cz) + cam.alt;
    camera.position.set(cx, eyeY, cz);
  } else {
    eyeY = gy + (cam.eye == null ? 1.7 : cam.eye);
    camera.position.set(cam.x, eyeY, cam.z);
  }
  const look = 900;
  camera.lookAt(
    camera.position.x + fx * look,
    camera.position.y + Math.tan(cam.pitch || 0) * look,
    camera.position.z + fz * look
  );
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
  // Average a few more renders for a stable cost number (same frozen frame,
  // so this measures the frame's cost and nothing else).
  let ms = performance.now() - t0;
  for (let i = 0; i < 4; i++) {
    const a = performance.now();
    renderer.render(CBZ.scene, camera);
    ms += performance.now() - a;
  }
  const renderMs = ms / 5;

  // Foliage classification straight off the framebuffer. A pixel is foliage
  // when green leads both other channels by a real margin and it is not sky.
  const gl = renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4);
  let canopyFrac = 0, greenSpread = 0, spireFrac = 0;
  try {
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let n = 0, sum = 0, sum2 = 0, upper = 0;
    // readPixels is bottom-up: row 0 is the BOTTOM of the frame.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        // FOLIAGE, NOT "GREENISH". The country's own ground plate is a pale
        // desaturated sage (~143,172,149) whose green does lead the other
        // channels — an absolute margin therefore scores an empty meadow at
        // 73% canopy and the metric says nothing. The test is SATURATION:
        // green must be the top channel by 30% of its own value over the
        // weakest one. Measured on the shipped build, that separates every
        // crown (chartreuse through dark blue-green conifer) from every
        // square metre of grass.
        const lo = r < b ? r : b;
        if (g > r && g > b && g > 16 && g < 250 && (g - lo) / g >= 0.30) {
          n++;
          const lum = (r * 0.30 + g * 0.59 + b * 0.11);
          sum += lum; sum2 += lum * lum;
          if (y > H * 0.5) upper++;          // upper half of the frame
        }
      }
    }
    const total = W * H;
    canopyFrac = total ? n / total : 0;
    if (n) {
      const mean = sum / n;
      greenSpread = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
      spireFrac = upper / n;
    }
  } catch (_) {}

  const round = (v, d) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  const metrics = {
    canopyFrac: round(canopyFrac, 4),
    greenSpread: round(greenSpread, 2),
    spireFrac: round(spireFrac, 3),
    drawCalls,
    triangles,
    renderMs: round(renderMs, 1),
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
    `canopy ${Math.round(canopyFrac * 100)}% · greens ±${round(greenSpread, 1)} · upper ${Math.round(spireFrac * 100)}% · ` +
    `${drawCalls} calls · ${Math.round(triangles / 1000)}k tris · ${round(renderMs, 1)} ms`;
  q("stat").style.cssText = "position:absolute;bottom:44px;left:26px;color:#dfe9f1;font:12px ui-monospace,SFMono-Regular,Menlo,monospace";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  let treeInstances = 0;
  try {
    CBZ.scene.traverse(function (o) {
      if (o.isInstancedMesh && /tree|crown|canopy|foli|wood|trunk|spire|krummholz|thicket/i.test(o.name || "")) {
        treeInstances += o.count || 0;
      }
    });
  } catch (_) {}
  metrics.treeInstances = treeInstances;

  return { ok: true, camY: round(camera.position.y, 1), groundY: round(gy, 1), metrics };
}

export default {
  id: "forest-look",
  title: "The Forest Look: canopy carpet, species mix, treeline gradient",
  description: "Five frames of the shipped world's woods against the owner's coastal-Alaska reference: an aerial canopy plate, a low species-mix pass, the altitude gradient across the high backcountry, the inside of Redhollow and the wall of a stand seen from open ground. Measured in the frame — canopy coverage, the spread of greens, and what it costs to draw.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metricsNote: "canopyFrac is the share of the frame classified as foliage off the real framebuffer (green leading both other channels) — on the aerial plates that is canopy closure. greenSpread is the standard deviation of foliage luminance: one flat green scores near zero however much of it there is. spireFrac is the share of foliage in the upper half of the frame, i.e. silhouette standing above the roof. drawCalls/triangles/renderMs come from renderer.info reset around a single render of the same frozen frame on both sides.",
  metrics: {
    canopyFrac: { label: "Canopy coverage", better: "higher" },
    greenSpread: { label: "Spread of greens", better: "higher" },
    spireFrac: { label: "Foliage above the roof", better: "higher" },
    treeInstances: { label: "Vegetation instances", better: "higher" },
    drawCalls: { label: "Draw calls", better: "lower" },
    triangles: { label: "Triangles", better: "lower" },
    renderMs: { label: "Render (headless)", unit: "ms", better: "lower" },
  },
  subjects,
  stage: stageForest,
};
