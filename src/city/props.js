/* ============================================================
   city/props.js — street furniture + traffic-light poles + a shared
   billboard-label helper. Hooked by world.js via CBZ.cityProps(city).

   Traffic lights are built here (one signal head per intersection
   approach) and attached to the intersection record; city/traffic.js
   drives their colour each frame and reads them for red-light tickets.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;

  // ---- shared cached label sprite (storefront signs, ped names, markers) ----
  const labelCache = new Map();
  CBZ.makeLabelSprite = function (text, opts) {
    opts = opts || {};
    const key = text + "|" + (opts.color || "#eef4ff");
    let m = labelCache.get(key);
    if (!m) {
      const c = document.createElement("canvas");
      c.width = 256; c.height = 64;
      const x = c.getContext("2d");
      x.font = "bold 30px Fredoka, sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle";
      x.lineWidth = 6; x.strokeStyle = "rgba(0,0,0,.75)";
      x.strokeText(text, 128, 34);
      x.fillStyle = opts.color || "#eef4ff";
      x.fillText(text, 128, 34);
      const tex = new THREE.CanvasTexture(c);
      m = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
      m._shared = true;
      labelCache.set(key, m);
    }
    const s = new THREE.Sprite(m);
    s.scale.set(4, 1, 1);
    return s;
  };

  // lamp emissive material factory
  function lampMat(color) { return new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.2 }); }

  CBZ.cityProps = function (city) {
    const root = city.root, rng = city.rng;
    city.streetProps = city.streetProps || [];

    function doorLots() {
      const out = (city.lots || []).slice();
      if (city.annex && city.annex.lots) out.push.apply(out, city.annex.lots);
      return out;
    }
    function pointSegmentD2(px, pz, ax, az, bx, bz) {
      const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
      const den = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / den));
      const dx = px - (ax + vx * t), dz = pz - (az + vz * t);
      return dx * dx + dz * dz;
    }
    // Door points sit just inside the room. Reserve the complete threshold and
    // exterior approach so a pole, bin or bench cannot visually block entry.
    function nearDoor(x, z, radius) {
      const r2 = radius * radius;
      for (const lot of doorLots()) {
        const d = lot.building && lot.building.door;
        if (!d) continue;
        const ex = d.x - d.nx * 4.8, ez = d.z - d.nz * 4.8;
        if (pointSegmentD2(x, z, d.x, d.z, ex, ez) < r2) return true;
      }
      return false;
    }

    // ---- traffic-light heads at every intersection ----
    // Each intersection gets one signal head on a pole; ns=true means the
    // head currently governs the north–south flow when green. We build a 3-lamp
    // head and stash the lamp meshes so traffic.js can recolour them.
    // A proper 4-way: each intersection gets a signal head for EACH axis,
    // placed on opposite corners and turned to face oncoming traffic, so the
    // cross street correctly shows RED while the main runs GREEN.
    function makeHead(px, pz, rotY) {
      const head = new THREE.Group();
      head.position.set(px, 0, pz); head.rotation.y = rotY;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 5.2, 8), mat(0x2c2f35));
      pole.position.y = 2.6; pole.castShadow = true; head.add(pole);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.5), mat(0x1c1f24));
      box.position.set(0, 4.6, 0); head.add(box);
      const red = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), lampMat(0xff3b3b));
      const yel = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), lampMat(0xffcf3b));
      const grn = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), lampMat(0x39ff66));
      red.position.set(0, 5.1, 0.28); yel.position.set(0, 4.6, 0.28); grn.position.set(0, 4.1, 0.28);
      head.add(red, yel, grn);
      root.add(head);
      return { red, yel, grn };
    }
    const off = city.ROAD / 2 + 0.6;
    for (const it of city.intersections) {
      // head governing N–S travel (faces along z), on the +x/+z corner
      const ns = makeHead(it.x + off, it.z + off, 0);
      // head governing E–W travel (faces along x), on the -x/-z corner
      const ew = makeHead(it.x - off, it.z - off, Math.PI / 2);
      it.light = { ns, ew, head: ns, red: ns.red, yel: ns.yel, grn: ns.grn };
    }

    // ---- street lamps along the avenues ----
    // Roads span the whole map, so a lamp marched down a road's length will,
    // wherever it crosses a perpendicular street, land in the MIDDLE of that
    // cross-road. Skip any position that falls inside an intersection box
    // (within ROAD/2 + margin of a perpendicular road centre-line) so lamps
    // only ever stand on real sidewalk, never out in the traffic.
    const crossClear = city.ROAD / 2 + 1.6;
    const crossLines = (vertical) => (vertical ? (city.allZLines || city.zLines) : (city.allXLines || city.xLines));
    function inCrossRoad(t, vertical, road) {
      const lines = crossLines(vertical);
      const center = vertical ? road.z : road.x;
      const coord = center + t;            // t is measured from road centre
      for (const c of lines) if (Math.abs(coord - c) < crossClear) return true;
      return false;
    }
    for (const r of city.roads) {
      const n = Math.max(2, Math.floor(r.len / 26));
      for (let i = 0; i <= n; i++) {
        const t = -r.len / 2 + i * (r.len / n);
        if (inCrossRoad(t, r.vertical, r)) continue;     // would sit in a cross-street
        const side = (i % 2 === 0 ? 1 : -1) * (city.ROAD / 2 + 1.0);
        const x = r.vertical ? r.x + side : r.x + t;
        const z = r.vertical ? r.z + t : r.z + side;
        if (Math.abs(x) > 9999) continue;
        if (nearDoor(x, z, 1.8)) continue;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4.4, 6), mat(0x3a3e45));
        pole.position.set(x, 2.2, z); root.add(pole);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), lampMat(0xffe9a8));
        lamp.position.set(x, 4.4, z); root.add(lamp);
        // solid pole: cars CRASH into it (a fast hit crumples the car), people
        // can't walk through it. noCam so the camera never pulls in on a thin post.
        if (CBZ.colliders) CBZ.colliders.push({ minX: x - 0.32, maxX: x + 0.32, minZ: z - 0.32, maxZ: z + 0.32, ref: pole, noCam: true });
      }
    }

    // ---- scattered props on sidewalks: hydrants, bins, benches ----
    for (const lot of city.lots) {
      const c = 2 + ((rng() * 3) | 0);
      for (let i = 0; i < c; i++) {
        let x = lot.cx, z = lot.cz, tries = 0;
        do {
          const ang = rng() * 6.28, off = lot.w / 2 + 1.4;
          x = lot.cx + Math.cos(ang) * off; z = lot.cz + Math.sin(ang) * off;
          tries++;
        } while (tries < 8 && nearDoor(x, z, 2.6));
        if (nearDoor(x, z, 2.6)) continue;
        const t = rng();
        if (t < 0.34) {
          const h = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.8, 8), mat(0xe24b4b));
          h.position.set(x, 0.5, z); h.castShadow = true; root.add(h);
        } else if (t < 0.7) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.7), mat(0x3e6b4a));
          b.position.set(x, 0.6, z); b.castShadow = true; root.add(b);
        } else {
          const bench = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.6), mat(0x8a5a2b));
          bench.position.set(x, 0.5, z); bench.castShadow = true; root.add(bench);
        }
        city.streetProps.push({ x, z, type: t < 0.34 ? "hydrant" : t < 0.7 ? "bin" : "bench" });
      }
    }
  };
})();
