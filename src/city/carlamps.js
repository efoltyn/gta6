/* ============================================================
   city/carlamps.js — CARS LIGHT THE ROAD AT NIGHT.

   WHY: at midnight the ambient fleet drove with the same two emissive
   bars it wears at noon and threw no light on anything. A night street
   with unlit cars is a diorama; a real one is defined by headlight pools
   sliding along the asphalt and red tail glow in the queue at the light.

   HOW (no dynamic lights — r128 recompiles every shader when the light
   count changes, and a SpotLight per car is exactly the boot stall
   core/renderer.js already fought): two instanced pools of additive
   ground decals, the same shape as city/blobshadows.js.
     • HEAD pool: one elongated warm cone per near car, from the front
       bumper ~11 m down the road, widening and fading.
     • TAIL pool: a short red glow behind the rear bumper, brighter while
       the brake lamps are on (vehicles.js's setBrake flag).
   Both fade in with CBZ.nightAmount (lamps come on at dusk, not at a
   clock tick) and are hidden outright by day, so the daytime cost is one
   early return. On top of the decals the SHARED lamp materials
   (world/carfx.js 'lightFront'/'lightTail') get their emissive pushed up
   at night in one write each, so the bulbs themselves read lit.

   Slots are refreshed every frame for cars inside LAMP_GATE of the
   camera (one matrix compose per slot, zero allocation); the cap keeps
   the pool bounded no matter how big the fleet gets. City-gated;
   headless builds no meshes and the update no-ops.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;

  const CAP = 48;                 // per pool
  const LAMP_GATE2 = 75 * 75;     // acquire inside 75 m — past that a beam is a few pixels
  const HEAD_LEN = 12, HEAD_W = 6.0, TAIL_LEN = 2.6, TAIL_W = 2.4;
  const GY = 0.08;                // above the cross-street layer (0.065) and its paint; additive + no depth write, so the hover is invisible
  const NIGHT_ON = 0.18;          // nightAmount at which lamps begin to show

  let head = null, tail = null, built = false, dum = null, HIDE = null;
  let lampFront = null, lampTail = null, baseFront = 1.15, baseTail = 1.1;
  let lastNight = -1;

  function coneTexture() {
    const W = 64, H = 128, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d"), img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const t = y / (H - 1);                       // 0 = near end (bumper), 1 = far end
      const halfW = 0.22 + 0.78 * t;               // the cone opens up as it travels
      const fall = Math.pow(1 - t, 1.5) * (0.35 + 0.65 * Math.min(1, t * 6));   // dark right at the bumper lip, peak just ahead
      for (let x = 0; x < W; x++) {
        const u = (x / (W - 1)) * 2 - 1;
        const lat = Math.exp(-Math.pow(u / halfW, 2) * 2.2);
        const a = Math.max(0, Math.min(1, fall * lat));
        const i = (y * W + x) * 4;
        img.data[i] = 255; img.data[i + 1] = 244; img.data[i + 2] = 214; img.data[i + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    return tex;
  }
  function glowTexture() {
    const S = 64, cv = document.createElement("canvas");
    cv.width = S; cv.height = S;
    const g = cv.getContext("2d");
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, "rgba(255,40,40,1)");
    grad.addColorStop(0.45, "rgba(255,30,30,0.45)");
    grad.addColorStop(1, "rgba(255,20,20,0)");
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    return tex;
  }
  function pool(tex, color) {
    const geo = new THREE.PlaneGeometry(1, 1);
    // lie flat with the texture's far end (+v) pointing down local +z, which
    // is the car's forward (heading 0 = +z, fx = sin h, fz = cos h); a UNIT
    // quad with its origin at the near end, so the instance scale is simply
    // (width, 1, length)
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, 0.5);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color: color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    mat._shared = true;
    const m = new THREE.InstancedMesh(geo, mat, CAP);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
    m.renderOrder = 2;                              // after the road paint decals
    m.userData.roadPaint = true;                    // batch-exempt (core/batch.js drops polygonOffset)
    for (let s = 0; s < CAP; s++) m.setMatrixAt(s, HIDE);
    m.instanceMatrix.needsUpdate = true;
    m.visible = false;
    CBZ.scene.add(m);
    return m;
  }
  function build() {
    if (built) return; built = true;
    if (!THREE.InstancedMesh || !THREE.PlaneGeometry || !THREE.Matrix4 || !CBZ.scene || typeof document === "undefined") return;
    dum = new THREE.Object3D();
    HIDE = new THREE.Matrix4();
    HIDE.makeScale(0.0001, 0.0001, 0.0001); HIDE.setPosition(0, -4000, 0);
    head = pool(coneTexture(), 0xfff1c8);
    head.name = "city-car-headlamp-pools";
    tail = pool(glowTexture(), 0xff3a3a);
    tail.name = "city-car-tail-glow";
    try {
      lampFront = CBZ.vehicleMat ? CBZ.vehicleMat("lightFront") : null;
      lampTail = CBZ.vehicleMat ? CBZ.vehicleMat("lightTail") : null;
      if (lampFront && lampFront.emissiveIntensity != null) baseFront = lampFront.emissiveIntensity;
      if (lampTail && lampTail.emissiveIntensity != null) baseTail = lampTail.emissiveIntensity;
    } catch (e) { lampFront = lampTail = null; }
  }

  // a car with its lamps on: something is driving it (ambient AI, an NPC, the
  // player) and it is drawn. Parked fixtures and wrecks sit dark.
  function lit(c) {
    if (!c || !c.pos || !c.group || !c.group.visible || c.dead) return false;
    if (c.player) return true;
    if (c._propParked || c.abandoned || c._husk) return false;
    return !!(c.ai || c.npcDriver);
  }

  CBZ.onUpdate(37.7, function () {
    const g = CBZ.game;
    if (!g || g.mode !== "city") { if (head && head.visible) { head.visible = tail.visible = false; } return; }
    if (!built) build();
    if (!head) return;
    const night = Math.max(0, Math.min(1, CBZ.nightAmount || 0));
    const k = night <= NIGHT_ON ? 0 : Math.min(1, (night - NIGHT_ON) / 0.35);
    if (k !== lastNight) {
      lastNight = k;
      head.material.opacity = 1.0 * k;
      tail.material.opacity = 0.62 * k;
      if (lampFront) lampFront.emissiveIntensity = baseFront + 1.9 * k;
      if (lampTail) lampTail.emissiveIntensity = baseTail + 1.2 * k;
    }
    if (k <= 0) {
      if (head.visible) { head.visible = tail.visible = false; }
      for (const c of CBZ.cityCars || []) c._lampsOn = false;
      return;
    }
    head.visible = tail.visible = true;
    const cam = CBZ.camera.position;
    let n = 0;
    const cars = CBZ.cityCars || [];
    for (let i = 0; i < cars.length && n < CAP; i++) {
      const c = cars[i];
      if (!lit(c)) { if (c) c._lampsOn = false; continue; }
      const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z;
      if (dx * dx + dz * dz > LAMP_GATE2) { c._lampsOn = false; continue; }
      c._lampsOn = k > 0.3;                          // census flag: "lit" means visibly lit, not a 2% dusk fade
      const dims = (c.group.userData && c.group.userData.vehicleDims) || null;
      const half = dims && dims.length ? dims.length * 0.5 : 2.2;
      const w = dims && dims.width ? dims.width : 2.0;
      const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
      const y = c.group.position.y + GY;
      // headlamp cone from the front bumper, HEAD_LEN down the road
      dum.position.set(c.pos.x + fx * (half - 0.2), y, c.pos.z + fz * (half - 0.2));
      dum.rotation.set(0, c.heading, 0);
      dum.scale.set(Math.max(HEAD_W, w * 2.3), 1, HEAD_LEN);
      dum.updateMatrix();
      head.setMatrixAt(n, dum.matrix);
      // tail glow trailing the rear bumper (the quad faces backward), hotter on the brakes
      const brake = c._brakeOn ? 1.6 : 1;
      dum.position.set(c.pos.x - fx * (half - 0.1), y, c.pos.z - fz * (half - 0.1));
      dum.rotation.set(0, c.heading + Math.PI, 0);
      dum.scale.set(Math.max(TAIL_W, w * 1.15) * brake, 1, TAIL_LEN * brake);
      dum.updateMatrix();
      tail.setMatrixAt(n, dum.matrix);
      n++;
    }
    for (let s = n; s < CAP; s++) { head.setMatrixAt(s, HIDE); tail.setMatrixAt(s, HIDE); }
    head.instanceMatrix.needsUpdate = true;
    tail.instanceMatrix.needsUpdate = true;
  });

  CBZ.carLampAudit = function () {
    let on = 0;
    for (const c of CBZ.cityCars || []) if (c && c._lampsOn) on++;
    return { lit: on, cap: CAP, night: CBZ.nightAmount || 0, built: !!head };
  };
})();
