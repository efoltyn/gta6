/* ============================================================
   city/carlamps.js — CARS LIGHT THE ROAD AT NIGHT.

   WHY: at midnight the ambient fleet drove with the same two emissive
   bars it wears at noon and threw no light on anything. A night street
   with unlit cars is a diorama; a real one is defined by headlight pools
   sliding along the asphalt and red tail glow in the queue at the light.

   HOW (no dynamic lights — r128 recompiles every shader when the light
   count changes, and a SpotLight per car is exactly the boot stall
   core/renderer.js already fought): two merged meshes of additive
   ground decals, each car's pool a small grid draped over the drawn
   street (see ON THE REAL GROUND below).
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
   camera (a 25 + 9 vertex write per slot, zero allocation; the ground
   under a pool is re-sampled only when its car moved/turned); the cap keeps
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
  const NIGHT_ON = 0.18;          // nightAmount at which lamps begin to show

  /* ON THE REAL GROUND. The pools used to be flat quads at car y + 0.08, and
     the streetkit footway/kerb top is 0.18 (road 0.05): a 6 m wide cone from
     a car in the kerb lane puts its outer ~1.2 m on the footway, and a turning
     car throws its whole beam across it, and there the light went UNDER the
     pavement. Each pool is now a small grid draped over the DRAWN ground
     (world.js's groundDecalY, the same oracle gore.js and street_hardware.js
     seat their decals on): every grid vertex takes the highest ground in its
     3x3 neighbourhood, so a cell straddling the kerb rides at footway height
     (it hovers <= 0.13 m over the gutter, invisible for a soft additive glow)
     and nothing is ever buried. Slopes are followed, not staircased. */
  const HNW = 5, HNL = 5;         // head grid: 1.5 m across x 3 m along at 6 x 12 m
  const TNW = 3, TNL = 3;         // tail grid
  const HV = HNW * HNL, TV = TNW * TNL;
  const EPS = 0.025;              // seat over the drawn surface (street_hardware seatY: 0.02) + polygonOffset below
  const DECK = 0.35;              // ground under the car this far from its wheels = it is on a deck/ferry: flat pool at the car
  const RESAMPLE_D2 = 0.3 * 0.3, RESAMPLE_DH = 0.03, RESAMPLE_BUDGET = 16;

  let head = null, tail = null, built = false;
  let lampFront = null, lampTail = null, baseFront = 1.15, baseTail = 1.1;
  let lastNight = -1;
  const gH = new Float32Array(HV), gT = new Float32Array(TV);   // raw samples, reused

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
    // canvas row 0 is the bumper end. With the default flipY that row lands
    // at v = 1, and the old quad put v = 1 at the FAR end, so the beam was
    // drawn backwards (narrow hot spot 10 m out, fanning back to nothing at
    // the bumper). No flip: v = t, the grid below writes v = t.
    tex.flipY = false;
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
  // one merged mesh of CAP draped grids (nw across, nl along); positions are
  // rewritten in world space each frame (48 x 25 verts, one small upload),
  // unused slots fall off the end of the draw range.
  function pool(tex, color, nw, nl) {
    const vps = nw * nl, ips = (nw - 1) * (nl - 1) * 6;
    const pos = new Float32Array(CAP * vps * 3), uv = new Float32Array(CAP * vps * 2);
    const idx = new Uint16Array(CAP * ips);
    for (let s = 0, k = 0; s < CAP; s++) {
      const b = s * vps;
      for (let j = 0; j < nl; j++) for (let i = 0; i < nw; i++) {
        const v = b + j * nw + i;
        uv[v * 2] = i / (nw - 1); uv[v * 2 + 1] = j / (nl - 1);
      }
      for (let j = 0; j < nl - 1; j++) for (let i = 0; i < nw - 1; i++) {
        const a = b + j * nw + i, c = a + nw;
        idx[k++] = a; idx[k++] = c; idx[k++] = a + 1;
        idx[k++] = a + 1; idx[k++] = c; idx[k++] = c + 1;
      }
    }
    const geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(pos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", pa);
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, color: color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    mat._shared = true;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
    m.matrixAutoUpdate = false;                     // positions are world space
    m.renderOrder = 2;                              // after the road paint decals
    m.userData.roadPaint = true;                    // batch-exempt (core/batch.js drops polygonOffset)
    m.userData.nw = nw; m.userData.nl = nl; m.userData.ips = ips;
    m.visible = false;
    CBZ.scene.add(m);
    return m;
  }
  function build() {
    if (built) return; built = true;
    if (!THREE.BufferGeometry || !THREE.BufferAttribute || !CBZ.scene || typeof document === "undefined") return;
    head = pool(coneTexture(), 0xfff1c8, HNW, HNL);
    head.name = "city-car-headlamp-pools";
    tail = pool(glowTexture(), 0xff3a3a, TNW, TNL);
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

  // world position of grid vertex (i, j) of a W x L footprint whose near-end
  // centre is (ox, oz), facing heading h (local x = right, local z = forward)
  let wx = 0, wz = 0;
  function at(ox, oz, h, W, L, nw, nl, i, j) {
    const lx = (i / (nw - 1) - 0.5) * W, lz = (j / (nl - 1)) * L;
    const c = Math.cos(h), s = Math.sin(h);
    wx = ox + lx * c + lz * s; wz = oz - lx * s + lz * c;
    return lz;
  }
  // sample the drawn ground under a footprint into out[] (nw x nl), then
  // dilate: each vertex = max of its 3x3 neighbourhood + EPS, floored so a
  // drop-off (seawall, a lower terrain shelf) never pulls the pool down a
  // cliff. dst is the car's cached height block at offset o.
  function drapeHeights(f, gy, ox, oz, h, W, L, nw, nl, raw, dst, o) {
    for (let j = 0; j < nl; j++) for (let i = 0; i < nw; i++) {
      const lz = at(ox, oz, h, W, L, nw, nl, i, j);
      let y = +f(wx, wz);
      const lo = gy - 0.25 - 0.2 * lz;               // 20 % grade under the car's own ground
      if (!(y >= lo)) y = lo;                        // also catches NaN
      raw[j * nw + i] = y;
    }
    for (let j = 0; j < nl; j++) for (let i = 0; i < nw; i++) {
      let m = -Infinity;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj; if (jj < 0 || jj >= nl) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di; if (ii < 0 || ii >= nw) continue;
          const v = raw[jj * nw + ii]; if (v > m) m = v;
        }
      }
      dst[o + j * nw + i] = m + EPS;
    }
  }
  function writeSlot(m, slot, ox, oz, h, W, L, ys, o, flatY) {
    const nw = m.userData.nw, nl = m.userData.nl, arr = m.geometry.attributes.position.array;
    let p = slot * nw * nl * 3;
    for (let j = 0; j < nl; j++) for (let i = 0; i < nw; i++) {
      at(ox, oz, h, W, L, nw, nl, i, j);
      arr[p++] = wx; arr[p++] = ys ? ys[o + j * nw + i] : flatY; arr[p++] = wz;
    }
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
    const A = CBZ.city && CBZ.city.arena;
    const f = A && typeof A.groundDecalY === "function" ? A.groundDecalY : null;
    const cam = CBZ.camera.position;
    let n = 0, budget = RESAMPLE_BUDGET;
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
      const h = c.heading, fx = Math.sin(h), fz = Math.cos(h);
      const carY = c.group.position.y;
      const brake = c._brakeOn ? 1.6 : 1;            // tail glow grows on the brakes
      const hx = c.pos.x + fx * (half - 0.2), hz = c.pos.z + fz * (half - 0.2);
      const tx = c.pos.x - fx * (half - 0.1), tz = c.pos.z - fz * (half - 0.1);
      const HW = Math.max(HEAD_W, w * 2.3), TW = Math.max(TAIL_W, w * 1.15) * brake, TL = TAIL_LEN * brake;
      // re-drape when the car has moved / turned / changed tail size since the
      // last sample; over the per-frame budget a car keeps its last drape
      let ys = c._lampY || null;
      const stale = !ys || c._lampBrake !== brake ||
        (c.pos.x - c._lampX) * (c.pos.x - c._lampX) + (c.pos.z - c._lampZ) * (c.pos.z - c._lampZ) > RESAMPLE_D2 ||
        Math.abs(h - c._lampH) > RESAMPLE_DH;
      if (f && stale && (budget > 0 || !ys)) {
        budget--;
        const gc = +f(c.pos.x, c.pos.z);
        if (Number.isFinite(gc) && Math.abs(gc - carY) <= DECK) {
          if (!ys) ys = c._lampY = new Float32Array(HV + TV);
          drapeHeights(f, gc, hx, hz, h, HW, HEAD_LEN, HNW, HNL, gH, ys, 0);
          drapeHeights(f, gc, tx, tz, h + Math.PI, TW, TL, TNW, TNL, gT, ys, HV);
          c._lampFlat = false;
        } else c._lampFlat = true;                   // on a deck / ferry / off the drawn ground
        c._lampX = c.pos.x; c._lampZ = c.pos.z; c._lampH = h; c._lampBrake = brake;
      }
      const drape = f && ys && !c._lampFlat ? ys : null;
      writeSlot(head, n, hx, hz, h, HW, HEAD_LEN, drape, 0, carY + EPS + 0.03);
      writeSlot(tail, n, tx, tz, h + Math.PI, TW, TL, drape, HV, carY + EPS + 0.03);
      n++;
    }
    head.geometry.setDrawRange(0, n * head.userData.ips);
    tail.geometry.setDrawRange(0, n * tail.userData.ips);
    head.geometry.attributes.position.needsUpdate = true;
    tail.geometry.attributes.position.needsUpdate = true;
  });

  CBZ.carLampAudit = function () {
    let on = 0;
    for (const c of CBZ.cityCars || []) if (c && c._lampsOn) on++;
    return { lit: on, cap: CAP, night: CBZ.nightAmount || 0, built: !!head };
  };
})();
