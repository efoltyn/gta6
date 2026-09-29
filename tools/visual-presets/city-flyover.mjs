/* Gang Life flyover: does the whole world read as a real place from the air
   and from the street?

   Owner (2026-09-29): "do a flyover of Gang City and see how some colors look
   weird from a distance around cities ... make the city colors more
   realistic, and make the terrain realer. Make the whole world layout a
   little realer. And are facades on the massive cities? Show me."

   Sixteen plates along one route at noon: the whole region from high up,
   downtown Gang City (high, low, street), Kingsport (whole metro, core,
   CBD street, rowhouse street, suburbs fading to farms, industry and the
   river), the grown towns, farmland, forest, the Mercy range, the
   presidential estate and the west coast. Each plate is placed relative to
   the live ground (CBZ.cityGroundHeightAt) and, for the Kingsport streets,
   on a real planned street (M.plan.streets), so it never lands inside a
   building. The BEFORE camera is reused by AFTER.

   Aerial plates park the PLAYER at the lens, ungrounded, so the game runs
   its own airborne fog and far plane (city/mode.js: "what matters is height
   above ground") and every streamer keyed to the camera (metro tiles, far
   HLOD, far ground atlas, farcull cells, grass) settles for that spot. The
   stage waits for the metro streamer to go quiet (CBZ.metroAudit build
   counters stop moving), not a number of seconds.

   Run:
     git worktree add --detach <tmp> origin/main && (cd <tmp> && PORT=8747 python3 tools/devserver.py &)
     ba --preset city-flyover --before http://127.0.0.1:8747/
*/

const subjects = [
  { id: "region-high", label: "The region from 1.5 km up", view: { cam: [1400, 1500, 5000], at: [-1800, 0, 1200], fov: 60 },
    focus: "Kingsport, the grown towns and Gang City in one frame: land use, colour at distance, the air." },
  { id: "downtown-high", label: "Gang City downtown from 650 m", view: { cam: [760, 650, 180], at: [-60, 0, -760], fov: 55 },
    focus: "The downtown and Gang City West around it: ground colour, the borough, the edges of the city." },
  { id: "downtown-low", label: "Downtown from 160 m", view: { cam: [260, 160, -380], at: [-20, 30, -720], fov: 58 },
    focus: "Towers, roofs, streets and the ground between them." },
  { id: "downtown-street", label: "Downtown street level", view: { cam: [57.4, 1.7, -790], at: [46, 12, -650], fov: 62, street: true },
    focus: "The downtown facade kit: shopfronts, window reveals, trim, awnings." },
  { id: "kingsport-high", label: "Kingsport metro from 1 km", view: { cam: [-900, 1000, 800], at: [-2900, 0, 3200], fov: 58 },
    focus: "The whole metro: CBD, midtown, rows, suburbs, industry, the river and the country round it." },
  { id: "kingsport-core", label: "Kingsport core from 260 m", view: { cam: [-2300, 260, 2500], at: [-2950, 60, 3100], fov: 56 },
    focus: "CBD towers and midtown blocks: materials, roofs, colour." },
  { id: "kingsport-street-cbd", label: "Kingsport CBD street level", view: { street: true, near: [-2860, 3060], nearAfter: [-3900, 3000], kinds: ["art", "col", "loc"] },
    focus: "Are there facades on the massive city? Storefronts, windows, trim, compared to downtown." },
  { id: "kingsport-street-rows", label: "Kingsport rowhouse street level", view: { street: true, near: [-1980, 3050], kinds: ["loc", "col", "art"] },
    focus: "Rowhouses: stoops, windows, cornices, brick." },
  { id: "kingsport-rows-mid", label: "Kingsport rows and walk-ups from 90 m", view: { cam: [-1700, 90, 2800], at: [-1980, 10, 3150], fov: 56 },
    focus: "Variety within a district: brick tones, rooflines, bays, shopfronts; neighbours are not clones." },
  { id: "kingsport-suburbs", label: "Kingsport suburbs into farmland, 220 m", view: { cam: [-1650, 220, 650], at: [-2250, 0, 1850], fov: 58 },
    focus: "Does the city thin into suburbs, exurbs and fields, or stop at an edge?" },
  { id: "kingsport-industry-river", label: "Industry, the river and Kings Lake, 320 m", view: { cam: [-2450, 320, 3650], at: [-3450, 0, 4650], fov: 58 },
    focus: "The Yards, Portside, the Kings River to the lake: water, banks, rail, land use." },
  { id: "kingsport-skyline", label: "Kingsport downtown skyline across the river, 60 m", view: { cam: [-2950, 60, 3650], at: [-3750, 40, 3050], fov: 58 },
    focus: "The riverfront downtown: pre-war stone towers, the glass cluster, the river." },
  { id: "kingsport-radial", label: "Kingsport radial avenue, street level", view: { cam: [-4203, 1.7, 2247], at: [-3830, 10, 2810], fov: 62, street: true },
    focus: "A wide diagonal avenue fanning out from downtown, lined with main-street blocks." },
  { id: "kingsport-neighbourhood", label: "Kingsport neighbourhood street", view: { cam: [-2865, 1.7, 1700], at: [-2865, 5, 1990], fov: 62, street: true },
    focus: "Brick and frame houses, a few vacant lots and boarded houses." },
  { id: "kingsport-factories", label: "Kingsport factory district, 110 m", view: { cam: [-4250, 110, 4250], at: [-4505, 0, 3880], fov: 58 },
    focus: "Auto-plant-scale brick factories, sawtooth sheds, stacks, rail." },
  { id: "karvel-aerial", label: "Karvel, the planned capital, 420 m", view: { cam: [5750, 420, -650], at: [5000, 0, -1550], fov: 58 },
    focus: "The uniform city on purpose: identical panel blocks, the square and its monument." },
  { id: "karvel-street", label: "Karvel square, street level", view: { cam: [5000, 1.7, -1300], at: [5000, 30, -1500], fov: 64, street: true },
    focus: "The ceremonial square and the monument." },
  { id: "towns", label: "Goldspire and Cape Harbor from 450 m", view: { cam: [1550, 450, 2500], at: [300, 0, 1200], fov: 58 },
    focus: "The grown towns: walk-in downtowns, their rings, and the land round them." },
  { id: "farmland", label: "Coyle Valley farmland, 200 m", view: { cam: [1700, 200, -1000], at: [2600, 0, -1950], fov: 58 },
    focus: "Fields, farmsteads, roads: real crop colours and parcel shapes." },
  { id: "forest", label: "Redhollow Woods, 220 m", view: { cam: [-650, 220, -1450], at: [-1460, 0, -2250], fov: 58 },
    focus: "Forest stands, clearings and the forest floor." },
  { id: "mountains", label: "The Mercy range from the south", view: { cam: [300, 350, -2600], at: [200, 250, -5800], fov: 58 },
    focus: "Relief: ridges, valleys, erosion, the mountain foot; no plates or steps." },
  { id: "estate", label: "The presidential estate, 180 m", view: { cam: [-1880, 180, -4120], at: [-2175, 10, -4416], fov: 56 },
    focus: "The Executive Mansion and its grounds in the land round it." },
  { id: "coast", label: "The west coast, 150 m", view: { cam: [-6700, 150, 1900], at: [-7700, 0, 1300], fov: 60 },
    focus: "Where land meets sea: beach, cliffs, shallows." },
];

async function stageCityFlyover(input) {
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const gy = (x, z) => {
    let h = 0;
    try { h = CBZ.cityGroundHeightAt(x, z); } catch (_) {}
    return isFinite(h) ? h : 0;
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

  let S = window.__cityFlyover;
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
    }, 240000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    await until(() => {
      const card = document.getElementById("bootload");
      return !card || getComputedStyle(card).display === "none";
    }, 30000, 50);
    // the game's top tier this host allows, pinned so the auto sampler
    // cannot drop a side mid-run
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(((CBZ.qualityLabels && CBZ.qualityLabels.length) || 5) - 1); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(500);
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 10px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-source></div>";
    document.body.appendChild(overlay);
    hideHud(overlay);
    S = window.__cityFlyover = { overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const V = subject.view;
  try { if (CBZ.dayPhase) CBZ.dayPhase(0.3); } catch (_) {}

  // A street pose on a real planned street of the metro nearest `near`: on
  // the footway, looking 70 m down the street at the facades on one side.
  function metroStreetPose(near, kinds) {
    let best = null;
    for (const M of CBZ.metroCities || []) {
      const P = M.plan;
      if (!P || !P.streets) continue;
      for (const s of P.streets) {
        if (!s.pts || s.pts.length !== 2 || kinds.indexOf(s.k) < 0) continue;
        const a = s.pts[0], b = s.pts[1];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L < 180) continue;
        const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
        let t = (near[0] - a.x) * ux + (near[1] - a.z) * uz;
        t = Math.max(40, Math.min(L - 110, t));
        const px = a.x + ux * t, pz = a.z + uz * t;
        const d = Math.hypot(px - near[0], pz - near[1]) + kinds.indexOf(s.k) * 60;
        if (!best || d < best.d) best = { d, px, pz, ux, uz, w: s.w || 12 };
      }
    }
    if (!best) return null;
    const nx = -best.uz, nz = best.ux;
    const off = best.w / 2 + 1.6;
    const cx = best.px + nx * off, cz = best.pz + nz * off;
    const ax = best.px + best.ux * 70 + nx * (best.w / 2 + 6), az = best.pz + best.uz * 70 + nz * (best.w / 2 + 6);
    return { x: cx, y: gy(cx, cz) + 1.7, z: cz, ax, ay: gy(ax, az) + 9, az, fov: 64, street: true };
  }

  // a street pose on the planned streets is re-found on each side (a plan
  // change moves the streets; reusing the other side's pose can land in a
  // building); `nearAfter` names where that district moved to
  let cam = !V.near && input.referenceStage && input.referenceStage.camera;
  if (!cam) {
    if (V.near) cam = metroStreetPose(input.side === "after" && V.nearAfter ? V.nearAfter : V.near, V.kinds);
    if (!cam && V.cam) {
      const [x, alt, z] = V.cam;
      const [ax, aoff, az] = V.at;
      cam = V.street
        ? { x, y: gy(x, z) + alt, z, ax, ay: gy(ax, az) + aoff, az, fov: V.fov, street: true }
        : { x, y: Math.max(gy(x, z), gy((x + ax) / 2, (z + az) / 2)) + alt, z, ax, ay: gy(ax, az) + aoff, az, fov: V.fov, street: false };
    }
    if (!cam) return { ok: false, err: "no pose for " + subject.id };
  }

  const P = CBZ.player;
  const camera = CBZ.camera;
  const park = () => {
    if (!P || !P.pos) return;
    P.driving = false;
    P.dead = false; P.hp = 100;
    if (cam.street) {
      P.pos.set(cam.x, cam.y - 1.6, cam.z);
      P.vy = 0; P.grounded = true;
    } else {
      // airborne at the lens: the game's own flight fog and far plane
      P.pos.set(cam.x, cam.y, cam.z);
      P.grounded = false;
      if (P.vel && P.vel.set) P.vel.set(0, 0, 0);
      if (typeof P.vy === "number") P.vy = 0;
    }
  };
  const aim = () => {
    camera.aspect = input.width / input.height;
    camera.fov = cam.fov;
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(cam.ax, cam.ay, cam.az);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    if (typeof CBZ.skySync === "function") CBZ.skySync();
  };
  const tick = (frames) => {
    for (let i = 0; i < frames; i++) {
      CBZ.hitstop = 0;
      CBZ.slowmo = 0;
      park();
      aim();
      try { CBZ.stepSim(1 / 60); } catch (_) {}
    }
    park();
  };
  const sig = () => {
    let a = null;
    try { a = CBZ.metroAudit ? CBZ.metroAudit() : null; } catch (_) {}
    if (!a) return "none";
    return [a.tileBuilds, a.tileDrops, a.farBuilds, a.farMap ? 1 : 0].join("/");
  };

  // settle: the streamers (metro near/far tiles, far ground atlas, cells)
  // sweep on a real-time clock, so tick in bursts with real pauses until the
  // metro build counters stop moving
  const t0 = Date.now();
  let last = "", still = 0, rounds = 0;
  while (rounds < 70 && Date.now() - t0 < 150000) {
    tick(24);
    await wait(430);
    rounds++;
    const s = sig();
    if (s === last) still++; else { still = 0; last = s; }
    if (rounds >= 6 && still >= 3) break;
  }
  tick(30);
  hidePlayerPresentation();
  hideHud(S.overlay);
  aim();
  if (cam.street) {
    for (const pool of [CBZ.cityPeds, CBZ.cityCops]) {
      for (const p of pool || []) {
        if (!p || !p.pos) continue;
        const g2 = p.group || (p.char && p.char.group);
        if (g2 && Math.hypot(p.pos.x - cam.x, p.pos.z - cam.z) < 7) g2.visible = false;
      }
    }
  }
  const r0 = performance.now();
  CBZ.renderer.render(CBZ.scene, camera);
  const renderMs = performance.now() - r0;
  let draws = 0, tris = 0;
  try { draws = CBZ.renderer.info.render.calls; tris = CBZ.renderer.info.render.triangles; } catch (_) {}
  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:18px;left:22px;padding:6px 10px;border-radius:7px;background:${before ? "#bb4040" : "#17825a"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:56px;left:22px;font-size:23px;font-weight:800;letter-spacing:-.02em";
  q("focus").textContent = subject.focus;
  q("focus").style.cssText = "position:absolute;top:90px;left:23px;color:#d0dbe3;font-size:12px;font-weight:600;max-width:760px;line-height:1.4";
  q("source").textContent = new URL(input.sourceUrl).host + " | cam " + [cam.x, cam.y, cam.z].map((v) => Math.round(v)).join(",") + " | settle " + rounds + " rounds";
  q("source").style.cssText = "position:absolute;bottom:12px;left:22px;color:#a9bac7;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";
  return { ok: true, camera: cam, metrics: { drawCalls: draws, triangles: tris, renderMs: Math.round(renderMs * 10) / 10 } };
}

export default {
  id: "city-flyover",
  title: "Gang Life flyover: the whole world, air to street",
  description: "Downtown, Kingsport (metro, core, streets, suburbs, industry and river), the grown towns, farmland, forest, mountains, the presidential estate and the coast at noon.",
  beforeLabel: "BEFORE",
  afterLabel: "AFTER: WORLD REAL",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210, cfg_BOOT_METER: 0 },
  stageTimeoutMs: 900000,
  pairNote: "Same seed, pose, noon clock, quality tier and viewport; the BEFORE camera is reused by AFTER.",
  method: "Boots Gang Life on each side, pins the top quality tier, parks the player at the lens (airborne for aerials so the game's own flight fog and far plane apply), ticks the real simulation until the metro streamer stops building, and renders.",
  metricsNote: "Draw calls and triangles are renderer.info for the photographed frame; renderMs is the CPU side of that one render.",
  metrics: {
    drawCalls: { label: "Draw calls in frame", better: "lower" },
    triangles: { label: "Triangles in frame" },
    renderMs: { label: "Render CPU ms (one frame)", unit: "ms", better: "lower" },
  },
  subjects,
  stage: stageCityFlyover,
};
