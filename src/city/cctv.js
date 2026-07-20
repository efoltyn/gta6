/* ============================================================
   city/cctv.js — THE CCTV LAYER (flag CCTV_V1, default true).

   OWNER (verbatim intent): "Computers on desks — one of the purposes of
   them is cameras. Add cameras to the game, and there's a purpose for
   computers. Put footage from the cameras."

   So this file is two halves that meet in the middle:

     1) CAMERAS IN THE WORLD — small voxel-simple security-camera props
        (chunky box body + lens barrel + a mount arm) placed DETERMINISTICALLY
        where a city actually watches itself: the bank / gun-store / jewelry
        fronts, the precinct, the military gate, the airport terminal, the
        executive tower lobby, and a hashed handful of street poles. Every
        camera is ONE instance in a shared InstancedMesh (2 draw calls for the
        whole layer — one head pool + one pole pool), and each registers
        { id, pos, aimYaw, aimPitch, kind } in CBZ.cctvCameras.

     2) FOOTAGE ON COMPUTERS — the desk terminals (interior_programs.js
        desk-farms) and the exec office cluster register their monitor faces
        as feed screens (CBZ.cctvAddScreen, build-path). At runtime, when the
        player is INSIDE/near an interior with monitors AND the quality tier is
        high enough, ONE shared low-res WebGLRenderTarget (256x144) is rendered
        from ONE cctv camera (round-robin every ~2s), and a small pool of
        unlit overlay quads maps that texture onto the nearest monitor faces.
        The footage is desaturated/cooled by a plain material colour multiply
        (no shaders). It is a RUNTIME-VISUAL layer only.

   BUDGET / GATING (the "zero cost otherwise" mandate):
     • OFF entirely below quality tier 2 (like the backdrop), outside CITY
       mode, or while not playing.
     • The extra scene render happens AT MOST once every OTHER frame, and only
       while at least one feed screen is within range of the player — otherwise
       no render target is touched at all.
     • It never renders off the real animation frame (a heartbeat guard keeps
       headless CBZ.stepSim bursts — the math gate — from paying any render
       cost; stepSim must "tick the whole updater chain with NO rendering").
     • The camera props themselves are 2 static draw calls, always fine.

   DETERMINISM: placement is a pure function of the built world (lot doors,
   published anchors) + CBZ.hash01 for the street-pole subset — never
   Math.random, never a shared rng() stream. The feed (render target, overlay
   pool) is runtime visual and touches no build state.

   REVERT: CBZ.CONFIG.CCTV_V1 = false (config.js) removes the whole layer.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  if (CBZ.CONFIG.CCTV_V1 == null) CBZ.CONFIG.CCTV_V1 = true;

  // ---- tunables (one-line knobs; owner judges the look by playing) --------
  const RT_W = 256, RT_H = 144;        // shared feed resolution (low, CCTV-grade)
  const SCREEN_RANGE = 24;             // player must be within this of a monitor to wake the feed
  const SCREEN_RANGE2 = SCREEN_RANGE * SCREEN_RANGE;
  const OVERLAY_POOL = 8;              // max live feed screens shown at once (draw-call cap)
  const CYCLE_SEC = 2.2;              // round-robin dwell per camera
  const MOUNT_H = 3.15;               // wall-camera mount height (above a door)
  const POLE_H = 4.4;                 // street/gate camera pole height
  const CAM_PITCH = -0.40;            // wall cams look slightly down at the approach
  const POLE_PITCH = -0.52;           // pole cams look further down
  const FEED_FOV = 64;                // cctv lens field of view
  const FEED_TINT = 0xbcc8d4;         // cool, slightly desaturated monitor multiply (no shader)
  const STREET_POLE_MAX = 8;          // cap on hashed street-pole cameras
  const STREET_POLE_THRESH = 0.14;    // hash01 gate for a lot to earn a street pole

  // ---- public buses -------------------------------------------------------
  CBZ.cctvCameras = CBZ.cctvCameras || [];   // { id, pos:{x,y,z}, aimYaw, aimPitch, kind }
  const screens = [];                         // feed-screen anchors { x,y,z, nx,nz } (world + OUTWARD normal)

  // Build-path registration from the interior builders (deskfarm / exec
  // office). World coords + the OUTWARD screen normal (the way a viewer faces
  // it). Deduped within 0.15m so a same-seed rebuild (the determinism re-run)
  // can re-register without the list growing, and capped hard.
  CBZ.cctvAddScreen = function (x, y, z, nx, nz) {
    if (!CBZ.CONFIG.CCTV_V1) return;
    const L = Math.hypot(nx || 0, nz || 0) || 1;
    const ux = (nx || 0) / L, uz = (nz != null ? nz : 1) / L;
    for (let i = 0; i < screens.length; i++) {
      const s = screens[i];
      if (Math.abs(s.x - x) < 0.15 && Math.abs(s.y - y) < 0.15 && Math.abs(s.z - z) < 0.15) return;
    }
    if (screens.length >= 3000) return;      // pathological guard; per-source caps keep this far below
    screens.push({ x: x, y: y, z: z, nx: ux, nz: uz });
  };

  // ========================================================================
  //  GEOMETRY — voxel-simple, vertex-coloured, merged so a whole camera is
  //  one instance. Head canonical FORWARD is +z (Object3D.lookAt aligns a
  //  mesh's +z with its target), lens at the +z front, mount arm at the -z back.
  // ========================================================================
  function col(hex) { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }
  function T(x, y, z) { return new THREE.Matrix4().makeTranslation(x, y, z); }
  function Trot(rx, x, y, z) { const m = new THREE.Matrix4().makeRotationX(rx); m.setPosition(x, y, z); return m; }

  // bake ONE part (box/cyl) into world-local space with a solid vertex colour
  function bakePart(geo, mat4, rgb) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(mat4);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = rgb[0]; c[i * 3 + 1] = rgb[1]; c[i * 3 + 2] = rgb[2]; }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    return g;
  }
  function mergeParts(parts) {
    let nPos = 0;
    for (const g of parts) nPos += g.attributes.position.count;
    const pos = new Float32Array(nPos * 3), nrm = new Float32Array(nPos * 3), c = new Float32Array(nPos * 3);
    let op = 0;
    for (const g of parts) {
      const p = g.attributes.position.array; pos.set(p, op);
      const nn = g.attributes.normal ? g.attributes.normal.array : null; if (nn) nrm.set(nn, op);
      c.set(g.attributes.color.array, op);
      op += p.length;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    out.setAttribute("color", new THREE.BufferAttribute(c, 3));
    out.computeBoundingSphere();
    for (const g of parts) g.dispose && g.dispose();
    return out;
  }
  function headGeo() {
    const HOUSING = col(0x3a3f47), METAL = col(0x565f6b), MOUNT = col(0x2a2f37),
      LENS = col(0x0c0e12), GLASS = col(0x2f6377);
    return mergeParts([
      bakePart(new THREE.BoxGeometry(0.34, 0.32, 0.52), T(0, 0, 0.03), HOUSING),   // chunky body
      bakePart(new THREE.BoxGeometry(0.17, 0.17, 0.44), T(0, 0.0, -0.36), METAL),  // mount arm (to wall/pole)
      bakePart(new THREE.BoxGeometry(0.18, 0.13, 0.24), T(0, 0.21, -0.06), MOUNT), // saddle
      bakePart(new THREE.CylinderGeometry(0.12, 0.12, 0.26, 12), Trot(Math.PI / 2, 0, 0, 0.33), LENS), // lens barrel (+z)
      bakePart(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 12), Trot(Math.PI / 2, 0, 0, 0.47), GLASS), // glass ring
    ]);
  }
  function poleGeo() {
    const POLE = col(0x4a525c);
    return mergeParts([
      bakePart(new THREE.CylinderGeometry(0.11, 0.14, POLE_H, 10), T(0, POLE_H / 2, 0), POLE),   // upright
      bakePart(new THREE.BoxGeometry(0.16, 0.16, 0.7), T(0, POLE_H - 0.1, 0.28), POLE),          // top cross-arm
    ]);
  }

  // ========================================================================
  //  FEED RESOURCES — created ONCE, reused across city rebuilds.
  // ========================================================================
  let rt = null, feedCam = null, feedMat = null, overlays = null, feedRoot = null, resReady = false;
  function buildFeedResources() {
    if (resReady) return;
    resReady = true;
    rt = new THREE.WebGLRenderTarget(RT_W, RT_H, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat,
    });
    rt.texture.generateMipmaps = false;
    // match the main renderer's outputEncoding (core/renderer.js: sRGBEncoding)
    // so the scene renders into the RT the same way it renders to screen, and
    // the unlit monitor reads back with correct (non-washed) colour.
    if (THREE.sRGBEncoding) rt.texture.encoding = THREE.sRGBEncoding;
    feedCam = new THREE.PerspectiveCamera(FEED_FOV, RT_W / RT_H, 0.3, 520);
    // unlit screen: the RT texture reads as self-lit; the colour multiply gives
    // the desaturated, cool CCTV cast with no custom shader.
    feedMat = new THREE.MeshBasicMaterial({ map: rt.texture, color: FEED_TINT });
    if ("toneMapped" in feedMat) feedMat.toneMapped = false;
    feedRoot = new THREE.Group();
    feedRoot.name = "cctv-feeds";
    const quad = new THREE.PlaneGeometry(0.5, 0.3);
    overlays = [];
    for (let i = 0; i < OVERLAY_POOL; i++) {
      const m = new THREE.Mesh(quad, feedMat);
      m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
      m.visible = false;
      m.userData.cctv = true;                 // spare it from the batcher (non-empty userData)
      feedRoot.add(m);
      overlays.push(m);
    }
    CBZ.scene.add(feedRoot);
  }

  // ========================================================================
  //  PLACEMENT — rebuilt per world (arena identity). One head InstancedMesh
  //  for every camera + one pole InstancedMesh for the pole-mounted ones.
  // ========================================================================
  let camRoot = null, headMesh = null, poleMesh = null;
  const _heads = [];   // { pos:{x,y,z}, dir:{x,y,z} }
  const _poles = [];   // { x, z }

  function addCam(kind, x, y, z, yaw, pitch, pole) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dir = { x: Math.sin(yaw) * cp, y: sp, z: Math.cos(yaw) * cp };
    CBZ.cctvCameras.push({ id: "cctv" + CBZ.cctvCameras.length, kind: kind, pos: { x: x, y: y, z: z }, aimYaw: yaw, aimPitch: pitch });
    _heads.push({ pos: { x: x, y: y, z: z }, dir: dir });
    if (pole) _poles.push({ x: x, z: z });
  }
  // lot.building.door is a point 1.6m INSIDE the threshold carrying the INWARD
  // normal (nx,nz) — step back to the facade, mount just outside it, aim out+down.
  function addWallCamDoor(kind, door) {
    if (!door || door.x == null) return false;
    const nx = door.nx || 0, nz = door.nz != null ? door.nz : 1;
    const L = Math.hypot(nx, nz) || 1;
    const inx = nx / L, inz = nz / L;                          // inward unit
    const fx = door.x - inx * 1.6, fz = door.z - inz * 1.6;    // facade / threshold
    addCam(kind, fx - inx * 0.3, MOUNT_H, fz - inz * 0.3, Math.atan2(-inx, -inz), CAM_PITCH, false);
    return true;
  }
  function addPoleCam(kind, x, z, yaw) { addCam(kind, x, POLE_H, z, yaw, POLE_PITCH, true); }
  // a head mounted on an EXISTING tall prop (a street lamp) — no pole of our own
  function addHeadCam(kind, x, y, z, yaw) { addCam(kind, x, y, z, yaw, POLE_PITCH, false); }

  function placeCameras(arena, city) {
    CBZ.cctvCameras.length = 0; _heads.length = 0; _poles.length = 0;
    const center = arena.center || { x: 0, z: 0 };

    // 1) shop fronts a city actually guards (bank / gun store / jewelry)
    const GUARDED = { bank: 1, guns: 1, jewelry: 1 };
    const shopLots = arena.shopLots || (arena.lots || []).filter(function (l) { return l.building && l.building.shop; });
    for (let i = 0; i < shopLots.length; i++) {
      const b = shopLots[i] && shopLots[i].building, shop = b && b.shop;
      if (shop && GUARDED[shop.kind]) addWallCamDoor(shop.kind, b.door);
    }

    // 2) executive tower lobby (flagship mega-tower street entrance)
    try {
      const mt = CBZ.cityMegaTower && CBZ.cityMegaTower();
      const md = mt && mt.lot && mt.lot.building && mt.lot.building.door;
      addWallCamDoor("exec", md);
    } catch (e) {}

    // 3) the JAIL — its compound gate if the game-package venue is mounted,
    //    else the civic/precinct front (cityPoliceStation → City Hall door).
    try {
      const jail = CBZ.games && CBZ.games.api && CBZ.games.api.jail;
      const o = jail && jail.anchor && jail.anchor();
      if (o && o.x != null) addPoleCam("jail", o.x, o.z + 8, 0);   // front gate on +Z wall, faces out
      else {
        const st = CBZ.cityPoliceStation && CBZ.cityPoliceStation();
        if (st && st.lot && st.lot.building) addWallCamDoor("jail", st.lot.building.door);
      }
    } catch (e) {}

    // 4) military gate — a pole cam at the base's east checkpoint, facing out (+X)
    try {
      const MB = CBZ._militaryBase;
      if (MB && MB.center && MB.maxX != null) addPoleCam("military", MB.maxX + 6, MB.center.z, Math.PI / 2);
    } catch (e) {}

    // 5) airport terminal — a pole cam over the arrivals apron
    try {
      const sp = arena.airportSpawn || (city && city.airportSpawn);
      if (sp && sp.x != null) addPoleCam("terminal", sp.x + 3, sp.z - 4, sp.yaw != null ? sp.yaw : Math.PI);
    } catch (e) {}

    // 6) a few STREET cameras — a deterministic hashed subset of EXISTING
    //    street-lamp poles, head mounted near the top, aimed at the junction.
    const lamps = (arena.streetProps || []).filter(function (p) { return p && p.type === "lamp"; });
    let poles = 0;
    for (let i = 0; i < lamps.length && poles < STREET_POLE_MAX; i++) {
      const p = lamps[i];
      const h = CBZ.hash01 ? CBZ.hash01(p.x, p.z, 0x0cca) : ((i * 0.61803398875) % 1);
      if (h > STREET_POLE_THRESH) continue;
      addHeadCam("street", p.x, 5.0, p.z, Math.atan2(center.x - p.x, center.z - p.z));  // watch inbound
      poles++;
    }

    buildCamMeshes();
  }

  function buildCamMeshes() {
    if (!camRoot) { camRoot = new THREE.Group(); camRoot.name = "cctv-cams"; CBZ.scene.add(camRoot); }
    // dispose any previous world's meshes
    for (let i = camRoot.children.length - 1; i >= 0; i--) {
      const m = camRoot.children[i]; camRoot.remove(m); if (m.geometry) m.geometry.dispose();
    }
    headMesh = poleMesh = null;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const dummy = new THREE.Object3D();
    if (_heads.length) {
      headMesh = new THREE.InstancedMesh(headGeo(), mat, _heads.length);
      headMesh.frustumCulled = false; headMesh.castShadow = false; headMesh.receiveShadow = false;
      for (let i = 0; i < _heads.length; i++) {
        const c = _heads[i];
        dummy.position.set(c.pos.x, c.pos.y, c.pos.z);
        dummy.lookAt(c.pos.x + c.dir.x, c.pos.y + c.dir.y, c.pos.z + c.dir.z);   // mesh +z → aim dir
        dummy.updateMatrix();
        headMesh.setMatrixAt(i, dummy.matrix);
      }
      headMesh.instanceMatrix.needsUpdate = true;
      camRoot.add(headMesh);
    }
    if (_poles.length) {
      poleMesh = new THREE.InstancedMesh(poleGeo(), mat, _poles.length);
      poleMesh.frustumCulled = false; poleMesh.castShadow = false; poleMesh.receiveShadow = false;
      for (let i = 0; i < _poles.length; i++) {
        dummy.position.set(_poles[i].x, 0, _poles[i].z);
        dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
        poleMesh.setMatrixAt(i, dummy.matrix);
      }
      poleMesh.instanceMatrix.needsUpdate = true;
      camRoot.add(poleMesh);
    }
  }

  // ========================================================================
  //  LIFECYCLE — (re)place when a new city arena appears.
  // ========================================================================
  let placedArena = null;
  function ensureInit() {
    const city = CBZ.city, arena = city && city.arena;
    if (!arena || !arena.lots) return false;
    if (placedArena === arena) return true;      // already placed for this world
    placedArena = arena;
    buildFeedResources();
    placeCameras(arena, city);
    return true;
  }

  // ========================================================================
  //  HEARTBEAT — a real animation frame ran recently. Keeps the render cost
  //  out of headless CBZ.stepSim bursts (the math gate), which run a tight
  //  synchronous loop with no rAF between ticks.
  // ========================================================================
  let lastRealFrame = -1e9;
  function perfNow() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }
  if (typeof requestAnimationFrame === "function") {
    const beat = function () { lastRealFrame = perfNow(); requestAnimationFrame(beat); };
    requestAnimationFrame(beat);
  }

  // ========================================================================
  //  THE FEED PUMP — round-robins one camera into the shared RT and maps it
  //  onto the nearest monitor faces. Fully gated; zero cost when idle.
  // ========================================================================
  let cycleT = 0, camIdx = 0, evenFrame = false;
  const _near = [];
  function deactivate() {
    if (overlays) for (let i = 0; i < overlays.length; i++) overlays[i].visible = false;
    if (feedRoot) feedRoot.visible = false;
  }

  function renderFeed() {
    const cam = CBZ.cctvCameras[camIdx % CBZ.cctvCameras.length];
    if (!cam) return;
    const p = cam.pos, cp = Math.cos(cam.aimPitch), sp = Math.sin(cam.aimPitch);
    feedCam.position.set(p.x, p.y, p.z);
    feedCam.lookAt(p.x + Math.sin(cam.aimYaw) * cp, p.y + sp, p.z + Math.cos(cam.aimYaw) * cp);
    const renderer = CBZ.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.shadowMap ? renderer.shadowMap.autoUpdate : true;
    // hide the whole CCTV layer from its own feed (no camera-films-camera, no
    // screen-in-screen feedback) and don't trigger an extra shadow pass.
    const camVis = camRoot ? camRoot.visible : false, feedVis = feedRoot.visible;
    if (camRoot) camRoot.visible = false; feedRoot.visible = false;
    if (renderer.shadowMap) renderer.shadowMap.autoUpdate = false;
    try {
      renderer.setRenderTarget(rt);
      renderer.render(CBZ.scene, feedCam);
    } catch (e) {
      /* headless/context loss — fail soft */
    } finally {
      renderer.setRenderTarget(prevTarget || null);
      if (renderer.shadowMap) renderer.shadowMap.autoUpdate = prevAuto;
      if (camRoot) camRoot.visible = camVis; feedRoot.visible = feedVis;
    }
  }

  function tick(dt) {
    if (!CBZ.CONFIG.CCTV_V1) return;
    const g = CBZ.game;
    if (!g || g.state !== "playing" || g.mode !== "city") { if (camRoot) camRoot.visible = false; deactivate(); return; }
    if (!ensureInit()) { deactivate(); return; }
    if (camRoot) camRoot.visible = true;                     // camera props are cheap — always on in the city

    // ---- everything below is the FEED; gate it hard ----
    if (perfNow() - lastRealFrame > 40) { deactivate(); return; }        // headless stepSim → no render
    const tier = CBZ.getQualityLevel ? CBZ.getQualityLevel() : 4;
    if (tier < 2) { deactivate(); return; }                              // off at tiers 0-1 (like the backdrop)
    if (!CBZ.cctvCameras.length || !screens.length) { deactivate(); return; }
    const P = CBZ.player; if (!P || !P.pos) { deactivate(); return; }

    // nearest monitor faces to the player, within range
    _near.length = 0;
    const px = P.pos.x, py = P.pos.y, pz = P.pos.z;
    for (let i = 0; i < screens.length; i++) {
      const s = screens[i];
      const dx = s.x - px, dy = s.y - py, dz = s.z - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < SCREEN_RANGE2) _near.push({ s: s, d2: d2 });
    }
    if (!_near.length) { deactivate(); return; }                          // no monitors near → truly idle, no RT touch
    _near.sort(function (a, b) { return a.d2 - b.d2; });

    // round-robin the source camera every ~CYCLE_SEC
    cycleT += dt;
    if (cycleT >= CYCLE_SEC) { cycleT = 0; camIdx = (camIdx + 1) % CBZ.cctvCameras.length; }

    // ONE extra scene render, every OTHER frame
    evenFrame = !evenFrame;
    if (evenFrame) renderFeed();

    // map the shared feed onto the nearest monitors
    feedRoot.visible = true;
    const n = Math.min(_near.length, OVERLAY_POOL);
    for (let i = 0; i < overlays.length; i++) {
      const o = overlays[i];
      if (i >= n) { o.visible = false; continue; }
      const s = _near[i].s;
      o.position.set(s.x + s.nx * 0.02, s.y, s.z + s.nz * 0.02);
      o.rotation.set(0, Math.atan2(s.nx, s.nz), 0);          // visible +z face points along the outward normal
      o.visible = true;
    }
  }

  // playing-only updater; runs before the main render (loop.js) so the RT is
  // fresh when the monitor material is drawn. Order is late (LATE band) so the
  // player position is already integrated this frame.
  if (CBZ.onUpdate) CBZ.onUpdate(92, tick);
  else CBZ.updaters.push({ order: 92, fn: tick });

  // small introspection helper (no HUD) — handy for probes / owner console
  CBZ.cctvInfo = function () {
    return { cameras: CBZ.cctvCameras.length, screens: screens.length, poles: _poles.length, active: !!(feedRoot && feedRoot.visible) };
  };
})();
