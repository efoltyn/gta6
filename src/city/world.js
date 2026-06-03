/* ============================================================
   city/world.js — the GTA-style open CITY map.

   A bright low-poly downtown built FAR from the prison and the
   disaster island (z≈-700) so all three worlds coexist with zero
   refactor: an escape/survival match never sees it, a city match
   teleports here. Everything lives in one group (city.root) so the
   other modes just hide it.

   This file lays the FOUNDATION only — a flat ground, a regular grid
   of streets with lane lines + crosswalks, sidewalks ringing every
   block, and the descriptor (lots / roads / intersections / waypoint
   helpers) that the rest of the city is built on. Buildings, the
   connected island district, shops, props and traffic lights are added
   by sibling modules through the hooks at the end of buildCity().

   CBZ.buildCity() builds once and returns the city descriptor.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;

  let city = null;

  // deterministic RNG so the city is the same each run (learnable streets)
  let _s = 90210;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  CBZ.buildCity = function () {
    if (city) return city;
    _s = 90210;
    const C = CBZ.CITY;
    const cx = C.center.x, cz = C.center.z;
    const N = C.blocks, BLK = C.block, ROAD = C.road;
    const step = BLK + ROAD;
    const half = (N * step) / 2;

    const root = new THREE.Group();
    CBZ.scene.add(root);

    // grid road centre-lines (N+1 lines bounding N blocks, both axes)
    const xLines = [], zLines = [];
    for (let k = 0; k <= N; k++) { xLines.push(cx - half + k * step); zLines.push(cz - half + k * step); }
    const minX = xLines[0] - ROAD / 2, maxX = xLines[N] + ROAD / 2;
    const minZ = zLines[0] - ROAD / 2, maxZ = zLines[N] + ROAD / 2;
    const spanX = maxX - minX, spanZ = maxZ - minZ;

    // ---- ground: asphalt base, then sidewalk + lot slabs on top ----
    const baseTex = CBZ.checkerTex ? CBZ.checkerTex("#2b2e33", "#26292e", 2) : null;   // dark asphalt base
    if (baseTex) baseTex.repeat.set(spanX / 8, spanZ / 8);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(spanX + 80, spanZ + 80),
      baseTex ? new THREE.MeshLambertMaterial({ map: baseTex }) : mat(0x3a3e45));
    ground.rotation.x = -Math.PI / 2; ground.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    ground.receiveShadow = true; root.add(ground);

    // flat plane helper (decor, no collider)
    function plane(x, z, w, d, color, y, basic) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
        basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, y == null ? 0.02 : y, z);
      m.receiveShadow = !basic; root.add(m);
      return m;
    }

    // ---- roads: one strip per grid line, full span ----
    const roadColor = 0x282a30, lineColor = 0xf2c83a;   // black asphalt + yellow lane line
    const roads = [];     // {x,z,vertical,len} drivable centre-line segments
    function laneDashes(x, z, vertical, len) {
      const n = Math.max(1, Math.floor(len / 7));
      for (let i = 0; i < n; i++) {
        const t = -len / 2 + (i + 0.5) * (len / n);
        const lx = vertical ? x : x + t, lz = vertical ? z + t : z;
        plane(lx, lz, vertical ? 0.28 : 2.6, vertical ? 2.6 : 0.28, lineColor, 0.06, true);
      }
    }
    xLines.forEach((x) => {                 // avenues (run along z)
      plane(x, (minZ + maxZ) / 2, ROAD, spanZ, roadColor, 0.04);
      laneDashes(x, (minZ + maxZ) / 2, true, spanZ);
      roads.push({ x, z: (minZ + maxZ) / 2, vertical: true, len: spanZ });
    });
    zLines.forEach((z) => {                 // cross-streets (run along x)
      plane((minX + maxX) / 2, z, spanX, ROAD, roadColor, 0.045);
      laneDashes((minX + maxX) / 2, z, false, spanX);
      roads.push({ x: (minX + maxX) / 2, z, vertical: false, len: spanX });
    });

    // ---- intersections + crosswalk stripes ----
    const intersections = [];
    xLines.forEach((x, i) => zLines.forEach((z, j) => {
      plane(x, z, ROAD, ROAD, 0x202227, 0.05);   // darker box at the crossing
      // zebra stripes on all four approaches
      for (let s = -1; s <= 1; s += 2) {
        for (let k = -2; k <= 2; k++) {
          plane(x + k * 1.1, z + s * (ROAD / 2 + 1.2), 0.7, 2.0, 0xeef1f5, 0.07, true);
          plane(x + s * (ROAD / 2 + 1.2), z + k * 1.1, 2.0, 0.7, 0xeef1f5, 0.07, true);
        }
      }
      intersections.push({ x, z, i, j, phase: (i + j) % 2 === 0 ? 0 : 1, t: rng() * 6, ns: true, light: null });
    }));

    // ---- blocks: a sidewalk slab + a slightly higher lot pad ----
    const lots = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const bx = (xLines[i] + xLines[i + 1]) / 2;
      const bz = (zLines[j] + zLines[j + 1]) / 2;
      // sidewalk ring (BEIGE concrete) frames the block but must NOT pave over
      // the road gap — BLK+ROAD covered the streets, so the dark asphalt read as
      // beige/white. Keep it to the block + a ~2m walk so the roads show.
      plane(bx, bz, BLK + 4, BLK + 4, 0xc2b896, 0.08);
      // GRASS lot/yard pad in the centre (buildings sit on it)
      const lotW = BLK - 1.5, lotD = BLK - 1.5;
      plane(bx, bz, lotW, lotD, 0x55903f, 0.10);
      lots.push({ cx: bx, cz: bz, w: lotW, d: lotD, i, j, kind: null, building: null });
    }

    // ---- perimeter wall colliders so you can't wander into the void ----
    function wall(x, z, w, d) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 6, d), mat(0x4a4f57));
      m.position.set(x, 3, z); m.castShadow = false; m.receiveShadow = true; root.add(m);
      const pad = 22;
      CBZ.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, ref: m });
      return pad;
    }
    const EW = minX - 26, EE = maxX + 26, ES = minZ - 26, EN = maxZ + 26, T = 4;
    wall((EW + EE) / 2, ES, EE - EW, T); wall((EW + EE) / 2, EN, EE - EW, T);
    wall(EW, (ES + EN) / 2, T, EN - ES);
    // The east wall has a real road gate. city/expansion.js continues this
    // centre cross-street across a bridge into the island district.
    const GATE = 22;
    wall(EE, (ES + (cz - GATE / 2)) / 2, T, cz - GATE / 2 - ES);
    wall(EE, ((cz + GATE / 2) + EN) / 2, T, EN - (cz + GATE / 2));

    // ---- waypoint helpers ----
    function lotAt(i, j) { return lots.find((l) => l.i === i && l.j === j); }
    function randomSidewalkPoint() {
      // a point on the sidewalk ring around a random block
      const l = lots[(rng() * lots.length) | 0];
      const edge = (rng() * 4) | 0, t = (rng() - 0.5) * l.w;
      const off = l.w / 2 + 1.6;
      if (edge === 0) return { x: l.cx + t, z: l.cz - off };
      if (edge === 1) return { x: l.cx + t, z: l.cz + off };
      if (edge === 2) return { x: l.cx - off, z: l.cz + t };
      return { x: l.cx + off, z: l.cz + t };
    }
    function randomRoadPoint() {
      const r = roads[(rng() * roads.length) | 0];
      const along = (rng() - 0.5) * r.len * 0.9;
      const lane = (rng() < 0.5 ? -1 : 1) * (ROAD * 0.22);
      return r.vertical ? { x: r.x + lane, z: r.z + along, vertical: true }
                        : { x: r.x + along, z: r.z + lane, vertical: false };
    }
    function nearestIntersection(x, z) {
      let best = intersections[0], bd = 1e9;
      for (const it of intersections) { const d = Math.hypot(it.x - x, it.z - z); if (d < bd) { bd = d; best = it; } }
      return best;
    }
    function clampRect(p, x0, x1, z0, z1) {
      return { x: Math.max(x0, Math.min(x1, p.x)), z: Math.max(z0, Math.min(z1, p.z)) };
    }
    function clampCircle(p, x, z, radius) {
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz) || 1;
      const s = radius / d;
      return { x: x + dx * s, z: z + dz * s };
    }
    function clampToCity(p, r) {
      r = r || 0.6;
      const x0 = minX - 22 + r, x1 = maxX + 22 - r;
      const z0 = minZ - 22 + r, z1 = maxZ + 22 - r;
      if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) return;

      // city/expansion.js installs these after the base descriptor exists.
      // Treat the mainland, bridge and island as one connected walkable union.
      const A = city && city.annex, B = city && city.bridge;
      if (B && p.x >= B.minX + r && p.x <= B.maxX - r && p.z >= B.minZ + r && p.z <= B.maxZ - r) return;
      if (A && Math.hypot(p.x - A.cx, p.z - A.cz) <= A.radius - r) return;

      const spots = [clampRect(p, x0, x1, z0, z1)];
      if (B) spots.push(clampRect(p, B.minX + r, B.maxX - r, B.minZ + r, B.maxZ - r));
      if (A) spots.push(clampCircle(p, A.cx, A.cz, A.radius - r));
      let best = spots[0], bd = Infinity;
      for (const q of spots) {
        const d = (q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z);
        if (d < bd) { bd = d; best = q; }
      }
      p.x = best.x; p.z = best.z;
    }

    city = {
      root, center: { x: cx, z: cz },
      N, step, BLK, ROAD, xLines, zLines, minX, maxX, minZ, maxZ,
      lots, roads, intersections, rng,
      groundHeightAt() { return 0; },
      lotAt, randomSidewalkPoint, randomRoadPoint, nearestIntersection, clampToCity,
      // a clear spawn: the central intersection sidewalk corner
      spawn: { x: cx + ROAD / 2 + 2, z: cz + ROAD / 2 + 2 },
      transients: [],
      reset() {
        // remove any per-run transient meshes (crashed cars, drops, fx) so a
        // replay starts clean; permanent geometry (roads/buildings) stays.
        for (let i = root.children.length - 1; i >= 0; i--) {
          const ch = root.children[i];
          if (ch.userData && ch.userData.transient) {
            root.remove(ch);
            if (ch.geometry && ch.geometry.dispose) ch.geometry.dispose();
            if (ch.material && ch.material.dispose) ch.material.dispose();
          }
        }
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      },
    };

    // ---- let sibling modules furnish the city (buildings, props, lights) ----
    if (CBZ.cityBuildings) try { CBZ.cityBuildings(city); } catch (e) { console.error("[city buildings]", e); }
    if (CBZ.cityExpansion) try { CBZ.cityExpansion(city); } catch (e) { console.error("[city expansion]", e); }
    if (CBZ.cityProps) try { CBZ.cityProps(city); } catch (e) { console.error("[city props]", e); }

    root.visible = false;     // hidden until city mode activates
    return city;
  };
})();
