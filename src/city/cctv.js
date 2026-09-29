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
        as feed screens (CBZ.cctvAddScreen, build-path). At runtime, while a
        monitor is ACTUALLY IN VIEW, ONE shared low-res WebGLRenderTarget
        (256x144) is rendered from ONE cctv camera (round-robin every ~2s), and
        a small pool of unlit overlay quads maps that texture onto the nearest
        monitor faces. The footage is desaturated/cooled by a plain material
        colour multiply (no shaders). It is a RUNTIME-VISUAL layer only.

   BUDGET / GATING. Measured 2026-09-28 (tools/speed.mjs, real GPU): the old
   gate was "a monitor within 24 m of the player", which is TRUE at the Gang
   Life spawn with every monitor behind a wall. The feed re-rendered the scene
   every other frame for nobody, and its FIRST render was a 0.9-1.0 s hitch
   compiling 66 programs. Now:
     • OFF below quality tier 2, outside CITY mode, or while not playing.
     • A feed renders only while one of the mapped monitors is IN VIEW: inside
       the main camera frustum, facing the camera, within READ_RANGE, and not
       behind a wall (one CBZ.losRaycast per candidate, re-tested every
       LOS_EVERY seconds). Nothing in view = no render target touched at all.
     • In view it renders at FEED_HZ (security footage is low frame rate; the
       monitor holds the last frame between renders), not every other frame.
     • The pass is SCOPED (see above renderFeed) and must render with the SAME
       light count as the main view, so it reuses the main view's programs.
     • It never renders off a real animation frame (heartbeat guard; headless
       CBZ.stepSim ticks the updater chain with NO rendering).
     • The camera props themselves are 2 static draw calls, always fine.

   DETERMINISM: placement is a pure function of the built world (lot doors,
   published anchors) + CBZ.hash01 for the street-pole subset — never
   Math.random, never a shared rng() stream. The feed (render target, overlay
   pool) is runtime visual and touches no build state.

   OFF: CBZ.CONFIG.CCTV_V1 = false (config.js) removes the whole layer.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  if (CBZ.CONFIG.CCTV_V1 == null) CBZ.CONFIG.CCTV_V1 = true;

  // ---- tunables (one-line knobs; owner judges the look by playing) --------
  const RT_W = 256, RT_H = 144;        // shared feed resolution (low, CCTV-grade)
  const SCREEN_RANGE = 24;             // monitors within this of the player get a feed overlay
  const SCREEN_RANGE2 = SCREEN_RANGE * SCREEN_RANGE;
  const READ_RANGE = 18;               // the CAMERA must be this close to an overlaid monitor to render its feed
  const READ_RANGE2 = READ_RANGE * READ_RANGE;
  const FEED_HZ = 10;                  // feed renders per second while a monitor is in view
  const LOS_EVERY = 0.25;              // seconds between wall tests of one monitor
  const OVERLAY_POOL = 8;              // max live feed screens shown at once (draw-call cap)
  const CYCLE_SEC = 2.2;              // round-robin dwell per camera
  const MOUNT_H = 3.15;               // wall-camera mount height (above a door)
  const POLE_H = 4.4;                 // street/gate camera pole height
  const CAM_PITCH = -0.40;            // wall cams look slightly down at the approach
  const POLE_PITCH = -0.52;           // pole cams look further down
  const FEED_FOV = 64;                // cctv lens field of view
  const FEED_TINT = 0xbcc8d4;         // cool, slightly desaturated monitor multiply (no shader)
  const SCREEN_GAP = 0.025;           // live feed floats over the physical glass
  const STREET_POLE_MAX = 8;          // cap on hashed street-pole cameras
  const STREET_POLE_THRESH = 0.14;    // hash01 gate for a lot to earn a street pole
  // ---- scoped-feed knobs (see the SCOPED FEED block above renderFeed) -----
  const FEED_FAR_FULL = 520;          // the as-shipped feed far plane
  const FEED_FAR_MIN = 260;           // never scope tighter than this, whatever a tier publishes
  const SCOPE_PAD = 18;               // metres of slack added to every measured subtree sphere
  const SCOPE_MEASURES = 24;          // fresh subtree measurements allowed per feed render

  // ---- public buses -------------------------------------------------------
  CBZ.cctvCameras = CBZ.cctvCameras || [];   // { id, pos:{x,y,z}, aimYaw, aimPitch, kind }
  const screens = [];                         // feed-screen anchors { x,y,z, nx,nz } (world + OUTWARD normal)
  CBZ.cctvScreens = screens;                  // read-only view for probes (tools, console)

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
    // losT/losClear: the cached wall test (see screenInView)
    screens.push({ x: x, y: y, z: z, nx: ux, nz: uz, losT: -1e9, losClear: false });
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
    feedCam = new THREE.PerspectiveCamera(FEED_FOV, RT_W / RT_H, 0.3, FEED_FAR_FULL);
    // unlit screen: the RT texture reads as self-lit; the colour multiply gives
    // the desaturated, cool CCTV cast with no custom shader.
    feedMat = new THREE.MeshBasicMaterial({
      map: rt.texture, color: FEED_TINT,
      // Secondary protection for steep viewing angles. The physical gap below
      // is the primary fix; polygon offset keeps the dynamic quad stable on
      // drivers with coarse depth precision without changing static batching.
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
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
  let cycleT = 0, camIdx = 0, feedT = 0, simT = 0, rtFresh = false;
  const _near = [];
  function deactivate() {
    if (overlays) for (let i = 0; i < overlays.length; i++) overlays[i].visible = false;
    if (feedRoot) feedRoot.visible = false;
  }

  /* IS THIS MONITOR ON SCREEN? Cheapest test first: range, then facing (the
     glass faces the viewer), then the main camera frustum, then a wall test.
     The wall test is the one that matters at the Gang Life spawn: the desk
     farms are INSIDE buildings, and a player on the pavement outside is in
     range, in frustum and on the facing side of half of them. It is one
     grid-broadphased ray (core/losgrid.js) from the camera to just short of
     the glass, cached per monitor for LOS_EVERY seconds. */
  const _viewF = new THREE.Frustum(), _viewM = new THREE.Matrix4(), _viewS = new THREE.Sphere();
  const _losRay = new THREE.Raycaster(), _losO = new THREE.Vector3(), _losD = new THREE.Vector3(), _camP = new THREE.Vector3();
  function screenInView(s, cp) {
    const vx = cp.x - s.x, vy = cp.y - s.y, vz = cp.z - s.z;
    const d2 = vx * vx + vy * vy + vz * vz;
    if (d2 > READ_RANGE2) return false;
    if (vx * s.nx + vz * s.nz <= 0) return false;            // looking at the back of the monitor
    _viewS.center.set(s.x, s.y, s.z); _viewS.radius = 0.4;
    if (!_viewF.intersectsSphere(_viewS)) return false;
    if (simT - s.losT >= LOS_EVERY) {
      s.losT = simT;
      const d = Math.sqrt(d2);
      if (d < 0.6 || !CBZ.losRaycast || !CBZ.losBlockers || !CBZ.losBlockers.length) s.losClear = true;
      else {
        _losO.set(cp.x, cp.y, cp.z);
        _losD.set(-vx / d, -vy / d, -vz / d);
        _losRay.set(_losO, _losD);
        _losRay.near = 0; _losRay.far = d - 0.35;           // stop short of the monitor's own body
        const hits = CBZ.losRaycast(_losRay, CBZ.losBlockers);
        s.losClear = !hits || hits.length === 0;
      }
    }
    return s.losClear;
  }

  /* ========================================================================
     SCOPED FEED — the extra render costs a POSTAGE STAMP, not a second frame.

     The target is 256x144, so the feed's PIXEL cost is nothing; what costs is
     the CPU half of `renderer.render(scene, feedCam)`: r128's projectObject
     walk over ~150k objects plus draw submission. Two levers:

       1) FAR PLANE = CBZ.cityCullRadius, the per-tier full-detail radius
          core/farcull.js culls the real city at, clamped to [260, 520].

       2) SUBTREE VISIBILITY. Every top-level child of the city arena root
          gets a measured world sphere (CBZ.subtreeSphere, core/viewscope.js);
          anything whose sphere misses the feed frustum is hidden for this one
          render and restored in a `finally`. r128 already frustum-rejects
          each mesh by its own sphere, so skipping a subtree whose padded
          union sphere misses cannot remove a mesh that would have drawn.

     LIGHTS. A subtree that holds a LIGHT is never hidden (b.lit). A light
     lights what is inside the frustum from outside it, and more to the point
     r128 keys EVERY lit program by the scene's light counts
     (WebGLPrograms.getParameters numPointLights / numSpotLights): hiding one
     point light made the feed a different light setup from the main view, so
     its first render compiled a second copy of every lit material in sight
     and every later render flipped the shared light-state version, forcing
     every material in BOTH views to re-derive its program key.

     A layer mask would not work: r128's projectObject tests layers only for
     what an object DRAWS, never whether its children are walked, and
     world/water_underwater.js relies on the CCTV camera keeping the default
     mask ("the mirror and CCTV cameras keep the default layer mask").
  ======================================================================== */
  const _scopeHidden = [];                    // objects WE hid, in the order we hid them
  const _scopeFrustum = new THREE.Frustum();
  const _scopeM = new THREE.Matrix4();
  const _scopeSph = new THREE.Sphere();
  let auRenders = 0, auHidden = 0, auCandidates = 0, auMeasured = 0, auInView = false, auSeen = null;

  function feedFar() {
    const r = CBZ.cityCullRadius || 0;
    if (!r) return FEED_FAR_FULL;             // no tier published yet → legacy depth
    return Math.max(FEED_FAR_MIN, Math.min(FEED_FAR_FULL, r));
  }

  // Hand back everything WE hid. A restore that can run twice and cannot throw
  // is the only shape allowed: a city left invisible is unrecoverable.
  function scopeRestore() {
    for (let i = _scopeHidden.length - 1; i >= 0; i--) _scopeHidden[i].visible = true;
    _scopeHidden.length = 0;
  }

  function scopeApply(root) {
    scopeRestore();
    feedCam.updateMatrixWorld(true);
    _scopeM.multiplyMatrices(feedCam.projectionMatrix, feedCam.matrixWorldInverse);
    _scopeFrustum.setFromProjectionMatrix(_scopeM);
    const kids = root.children;
    let budget = SCOPE_MEASURES, seen = 0;
    for (let i = 0; i < kids.length; i++) {
      const o = kids[i];
      // only ever hide something CURRENTLY visible (farcull, demolition and the
      // quality tiers own what is hidden), meshes and groups only (never a light)
      if (!o || !o.visible) continue;
      if (!o.isMesh && !o.isGroup) continue;
      if (o === camRoot || o === feedRoot) continue;   // renderFeed owns those two
      if (!CBZ.subtreeSphereMeasured(o)) {
        // a first measurement is a subtree walk; unmeasured stays VISIBLE
        if (budget <= 0) continue;
        budget--; auMeasured++;
      }
      const b = CBZ.subtreeSphere(o);
      if (b.dyn || b.lit) continue;
      if (o.position.x !== b.px || o.position.z !== b.pz) { b.dyn = true; continue; }   // it moved: an actor
      seen++;
      _scopeSph.center.set(b.x, b.y, b.z);
      _scopeSph.radius = b.r + SCOPE_PAD;
      if (_scopeFrustum.intersectsSphere(_scopeSph)) continue;
      o.visible = false;
      _scopeHidden.push(o);                   // recorded AS it is hidden
    }
    auCandidates = seen;
    return _scopeHidden.length;
  }

  function renderFeed() {
    const cam = CBZ.cctvCameras[camIdx % CBZ.cctvCameras.length];
    if (!cam) return;
    const p = cam.pos, cp = Math.cos(cam.aimPitch), sp = Math.sin(cam.aimPitch);
    feedCam.position.set(p.x, p.y, p.z);
    feedCam.lookAt(p.x + Math.sin(cam.aimYaw) * cp, p.y + sp, p.z + Math.cos(cam.aimYaw) * cp);
    const far = feedFar();
    if (feedCam.far !== far) { feedCam.far = far; feedCam.updateProjectionMatrix(); }
    const renderer = CBZ.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.shadowMap ? renderer.shadowMap.autoUpdate : true;
    // hide the whole CCTV layer from its own feed (no camera-films-camera, no
    // screen-in-screen feedback) and don't trigger an extra shadow pass.
    const camVis = camRoot ? camRoot.visible : false, feedVis = feedRoot.visible;
    if (camRoot) camRoot.visible = false; feedRoot.visible = false;
    if (renderer.shadowMap) renderer.shadowMap.autoUpdate = false;
    auHidden = 0;
    try {
      const aroot = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
      if (aroot) auHidden = scopeApply(aroot);
      renderer.setRenderTarget(rt);
      // proxied parked cars are culled against the PLAYER's camera
      // (city/carinstances.js); the monitor may look the other way
      if (CBZ.carInstanceFullDraw) CBZ.carInstanceFullDraw();
      renderer.render(CBZ.scene, feedCam);
      rtFresh = true;
    } catch (e) {
      /* headless/context loss — fail soft */
    } finally {
      scopeRestore();          // FIRST: a city left hidden is the unrecoverable outcome
      renderer.setRenderTarget(prevTarget || null);
      if (renderer.shadowMap) renderer.shadowMap.autoUpdate = prevAuto;
      if (camRoot) camRoot.visible = camVis; feedRoot.visible = feedVis;
    }
    auRenders++;
  }

  function tick(dt) {
    if (!CBZ.CONFIG.CCTV_V1) return;
    const g = CBZ.game;
    if (!g || g.state !== "playing" || g.mode !== "city") { if (camRoot) camRoot.visible = false; deactivate(); return; }
    if (!ensureInit()) { deactivate(); return; }
    if (camRoot) camRoot.visible = true;                     // camera props are cheap — always on in the city

    // ---- everything below is the FEED; gate it hard ----
    // A page that draws nothing (?cfg_RENDER_FRAMES=0, core/loop.js's no-draw
    // lever) must not draw the feed either; the rAF beat alone is not proof
    // (HUD/DOM writes keep the compositor beating on such a page).
    if (CBZ.CONFIG.RENDER_FRAMES === false) { deactivate(); return; }
    if (perfNow() - lastRealFrame > 40) { deactivate(); return; }        // headless stepSim → no render
    const tier = CBZ.getQualityLevel ? CBZ.getQualityLevel() : 4;
    if (tier < 2) { deactivate(); return; }                              // off at tiers 0-1 (like the backdrop)
    if (!CBZ.cctvCameras.length || !screens.length) { deactivate(); return; }
    const P = CBZ.player; if (!P || !P.pos) { deactivate(); return; }
    simT += dt;

    // nearest monitor faces to the player, within range
    _near.length = 0;
    const px = P.pos.x, py = P.pos.y, pz = P.pos.z;
    for (let i = 0; i < screens.length; i++) {
      const s = screens[i];
      const dx = s.x - px, dy = s.y - py, dz = s.z - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < SCREEN_RANGE2) _near.push({ s: s, d2: d2 });
    }
    if (!_near.length) { deactivate(); rtFresh = false; return; }       // no monitors near → truly idle
    _near.sort(function (a, b) { return a.d2 - b.d2; });
    const n = Math.min(_near.length, OVERLAY_POOL);

    // is any overlaid monitor actually on screen?
    let inView = false;
    const camera = CBZ.camera;
    if (camera) {
      camera.updateMatrixWorld();
      _viewM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _viewF.setFromProjectionMatrix(_viewM);
      _camP.setFromMatrixPosition(camera.matrixWorld);
      for (let i = 0; i < n && !inView; i++) { inView = screenInView(_near[i].s, _camP); if (inView) auSeen = _near[i].s; }
    }
    auInView = inView;

    // round-robin the source camera every ~CYCLE_SEC
    cycleT += dt;
    if (cycleT >= CYCLE_SEC) { cycleT = 0; camIdx = (camIdx + 1) % CBZ.cctvCameras.length; }

    if (inView) {
      feedT -= dt;
      if (feedT <= 0 || !rtFresh) { feedT = 1 / FEED_HZ; renderFeed(); }
    }
    // Never show an RT that was never drawn (it would read as black glass).
    if (!rtFresh) { deactivate(); return; }

    // map the shared feed onto the nearest monitors
    feedRoot.visible = true;
    for (let i = 0; i < overlays.length; i++) {
      const o = overlays[i];
      if (i >= n) { o.visible = false; continue; }
      const s = _near[i].s;
      o.position.set(s.x + s.nx * SCREEN_GAP, s.y, s.z + s.nz * SCREEN_GAP);
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
    return { cameras: CBZ.cctvCameras.length, screens: screens.length, poles: _poles.length, active: !!(feedRoot && feedRoot.visible), inView: auInView };
  };

  /* CBZ.cctvFeedAudit() — is the extra render small, and is it happening?
       renders        — feed renders so far (0 while no monitor was in view)
       inView         — a mapped monitor passed the on-screen test last tick
       lastHiddenCount / candidates — subtrees the last feed skipped, out of
                        the measured static ones it considered (`0 of 0` =
                        the scope is still warming, not "found nothing")
       far            — the depth in force */
  CBZ.cctvFeedAudit = function () {
    return {
      renders: auRenders,
      inView: auInView,
      seen: auInView && auSeen ? { x: auSeen.x, y: auSeen.y, z: auSeen.z, nx: auSeen.nx, nz: auSeen.nz } : null,
      lastHiddenCount: auHidden,
      far: feedCam ? feedCam.far : 0,
      candidates: auCandidates,
      measured: auMeasured,
    };
  };
})();
