/* ============================================================
   city/stuntjumps.js — deterministic world stunt ramps.

   A ramp is visible road furniture plus a narrow crossing trigger. Vehicles
   owns the ballistic integration; this module only lays out ramps and reports
   a clean one-way launch impulse, so the same jump physics works for stock,
   boosted and weaponised cars without parallel controllers.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE, g = CBZ.game;
  const ramps = [];
  CBZ.cityStuntJumps = ramps;
  let builtRoot = null;

  function hash(i) {
    let x = (i + 1) * 0x45d9f3b;
    x = ((x >>> 16) ^ x) * 0x45d9f3b;
    x = ((x >>> 16) ^ x) * 0x45d9f3b;
    return ((x >>> 16) ^ x) >>> 0;
  }
  function makeRamp(root, road, index) {
    const h = hash(index), sign = (h & 1) ? 1 : -1;
    const len = 9.5 + ((h >>> 4) % 30) / 10;
    const width = Math.max(4.2, Math.min(6.4, ((road.w || 14) / Math.max(1, (road.lanesPerDir || 1) * 2)) * 0.92));
    const along = ((((h >>> 9) % 420) / 1000) - 0.21) * Math.max(35, road.len - 28);
    const lane = (((h >>> 18) & 1) ? 1 : -1) * Math.min((road.w || 12) * 0.19, 3.4);
    let x, z, fx, fz, heading;
    if (road.vertical) {
      x = road.x + lane; z = road.z + along; fx = 0; fz = sign; heading = sign > 0 ? 0 : Math.PI;
    } else {
      x = road.x + along; z = road.z + lane; fx = sign; fz = 0; heading = sign > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    const angle = THREE.MathUtils.degToRad(11.5 + ((h >>> 22) % 4));
    const mat = new THREE.MeshLambertMaterial({ color: (h & 2) ? 0x72523a : 0x626a70, roughness: 0.95 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.32, len), mat);
    deck.rotation.order = "YXZ"; deck.rotation.y = heading; deck.rotation.x = -angle;
    const rise = Math.sin(angle) * len;
    deck.position.set(x, Math.max(0.20, rise * 0.5 - 0.04), z);
    deck.castShadow = true; deck.receiveShadow = true; deck.name = "stunt-ramp";
    root.add(deck);
    // Dark underside/supports make it a constructed ramp rather than a road
    // plane accidentally clipping upward.
    const supportMat = new THREE.MeshLambertMaterial({ color: 0x282b2d });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, Math.max(0.5, rise * 0.62), 0.18), supportMat);
      const backX = x + fx * len * 0.38 + (road.vertical ? side * width * 0.38 : 0);
      const backZ = z + fz * len * 0.38 + (!road.vertical ? side * width * 0.38 : 0);
      post.position.set(backX, Math.max(0.25, rise * 0.31), backZ); root.add(post);
    }
    ramps.push({ x, z, fx, fz, width, len, rise, id: index, deck });
  }

  function build() {
    const city = CBZ.city, arena = city && city.arena;
    const root = arena && arena.root;
    if (!root || root === builtRoot) return;
    builtRoot = root; ramps.length = 0;
    const roads = city.roads || arena.roads || [];
    let made = 0;
    for (let i = 0; i < roads.length && made < 18; i++) {
      const r = roads[i];
      if (!r || r.len < 72 || r.district === "bridge" || r.district === "airport") continue;
      const h = hash(i + 73);
      if ((h % 5) !== 0 && made < 8) continue;
      makeRamp(root, r, i + 1); made++;
    }
  }

  CBZ.cityStuntRampHit = function (car, x0, z0, x1, z1, speed) {
    if (!car || speed < 7.5 || !ramps.length) return null;
    for (let i = 0; i < ramps.length; i++) {
      const r = ramps[i];
      if (car._lastStuntRamp === r.id && (car._lastStuntRampT || 0) > 0) continue;
      const oldLong = (x0 - r.x) * r.fx + (z0 - r.z) * r.fz;
      const newLong = (x1 - r.x) * r.fx + (z1 - r.z) * r.fz;
      if (oldLong > 0 || newLong < 0) continue;
      const sideX = -r.fz, sideZ = r.fx;
      const lateral = (x1 - r.x) * sideX + (z1 - r.z) * sideZ;
      if (Math.abs(lateral) > r.width * 0.52) continue;
      const vx = car.vx || Math.sin(car.heading || 0) * speed;
      const vz = car.vz || Math.cos(car.heading || 0) * speed;
      if ((vx * r.fx + vz * r.fz) / Math.max(0.1, Math.hypot(vx, vz)) < 0.55) continue;
      car._lastStuntRamp = r.id; car._lastStuntRampT = 1.8;
      return { vy: Math.max(6.8, Math.min(15, 4.8 + speed * 0.30 + r.rise * 0.45)), ramp: r };
    }
    return null;
  };

  if (CBZ.onUpdate) CBZ.onUpdate(9.75, function (dt) {
    if (!g || g.mode !== "city") return;
    build();
    const car = CBZ.player && CBZ.player._vehicle;
    if (car && car._lastStuntRampT > 0) car._lastStuntRampT = Math.max(0, car._lastStuntRampT - dt);
  });
})();
