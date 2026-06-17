/* ============================================================
   city/expansion.js - the life-game island district.

   This copies the disaster arena's world language into CITY mode:
   a circular island, beach, street grid, enterable low-rise town,
   trees, parked cars, a service station and an auto showroom. The
   disaster hills are replaced with a central pair of massive towers
   and three additional climbable skyline towers. A bridge continues
   the mainland centre street through the east-wall gate.

   ROOMS WORTH ENTERING (why: the island shells were built BARE — the
   bridge ride over should end somewhere worth walking into):
   every storey of every island building is dressed through the shared
   CBZ.cityFurnishApartment dresser (clearFloorPoint-gated, opaque,
   batch-merged), and the gas station / showroom get real interiors
   (kiosk counter + stocked racks; sales desk + tyre wall + plinth).

   Hooked by city/world.js after the original city buildings exist.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;

  let _s = 60601;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  let annexCarHook = null, _trafWrapped = false;
  // the island's parking refills right after every traffic respawn —
  // spawnCityTraffic clears cityCars at the start of each run, which used to
  // leave the island carless (and is why it had its own prop cars at all)
  function wrapTraffic() {
    if (_trafWrapped || !CBZ.spawnCityTraffic) return;
    _trafWrapped = true;
    const orig = CBZ.spawnCityTraffic;
    CBZ.spawnCityTraffic = function (n) { const r = orig(n); if (annexCarHook) try { annexCarHook(); } catch (e) {} return r; };
  }
  CBZ.cityExpansion = function (city) {
    wrapTraffic();
    if (city.annex) return city.annex;
    const build = CBZ.cityMakeBuilding;
    if (!build) return null;
    _s = 60601;

    const root = city.root;
    const R = 120, ROADW = 7, GRID = 40;
    const cx = city.maxX + 215, cz = city.center.z;
    const lots = [], placed = [], roadSegs = [];

    function plane(x, z, w, d, color, y, basic) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
        basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y == null ? 0.03 : y, z);
      m.receiveShadow = !basic;
      root.add(m);
      return m;
    }

    function box(x, y, z, w, h, d, color, opts) {
      opts = opts || {};
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts.emissive ? { emissive: opts.emissive, ei: opts.ei || 0.4 } : null));
      m.position.set(x, y, z);
      m.castShadow = opts.cast !== false; m.receiveShadow = opts.receive !== false;
      root.add(m);
      if (opts.solid) {
        const col = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, ref: m };
        if (opts.y0 != null) col.y0 = opts.y0;
        if (opts.y1 != null) col.y1 = opts.y1;
        if (opts.noCam) col.noCam = true;
        CBZ.colliders.push(col);
      }
      return m;
    }

    function tag(group, text, y, scale) {
      if (!CBZ.makeLabelSprite) return;
      const s = CBZ.makeLabelSprite(text);
      if (!s) return;
      s.position.set(0, y, 0); s.scale.set(scale || 6, (scale || 6) * 0.24, 1);
      group.add(s);
    }

    function addPlaced(x, z, w, d) {
      const p = { x, z, w, d };
      placed.push(p);
      return p;
    }

    function clashes(x, z, w, d, pad) {
      pad = pad == null ? 4 : pad;
      for (const p of placed) {
        if (Math.abs(p.x - x) < (p.w + w) / 2 + pad && Math.abs(p.z - z) < (p.d + d) / 2 + pad) return true;
      }
      return false;
    }

    function registerBuilding(x, z, w, d, storeys, color, name, kind) {
      const b = build(root, x, z, w, d, storeys, color, 0);
      const door = { x, z: z - d / 2 + 1.6, nx: 0, nz: 1 };
      const lot = { cx: x, cz: z, w, d, kind: kind || "tower", district: "island", building: { ...b, name: name || "Island Building", door } };
      lots.push(lot);
      addPlaced(x, z, w, d);
      // ROOMS WORTH ENTERING: the mainland pass dresses every interior, but
      // these shells were registered bare. EVERY storey gets the shared
      // apartment dresser (stair strip + door aisle stay clear via the
      // building's own clearFloorPoint; opaque boxes → batch-merged), so the
      // landmark towers and low-rises are worth climbing, not just facades.
      if (CBZ.cityFurnishApartment) {
        const fh = b.FH || 4;
        for (let k = 0; k < storeys; k++) CBZ.cityFurnishApartment(b, k * fh, (((x | 0) + (z | 0)) >> 2) + k);
      }
      return { b, lot };
    }

    // ---- island and the bridge from the original city's east-wall gate ----
    const ocean = plane(cx, cz, R * 3.4, R * 3.4, 0x2f6f9e, -0.44);
    ocean.receiveShadow = false;
    // ONE sea: share the mainland's day/night-tinted water material so the
    // island ocean and the new coast-to-horizon plane read as the same water.
    if (CBZ.city && CBZ.city.seaMat) ocean.material = CBZ.city.seaMat;
    const beach = new THREE.Mesh(new THREE.CircleGeometry(R + 14, 64), new THREE.MeshLambertMaterial({ color: 0xe6d49a }));
    beach.rotation.x = -Math.PI / 2; beach.position.set(cx, -0.02, cz); beach.receiveShadow = true; root.add(beach);
    const grassTex = CBZ.checkerTex(CBZ.COL.GRASS_A, CBZ.COL.GRASS_B, 2); grassTex.repeat.set(28, 28);
    const island = new THREE.Mesh(new THREE.CircleGeometry(R, 64), new THREE.MeshLambertMaterial({ map: grassTex }));
    island.rotation.x = -Math.PI / 2; island.position.set(cx, 0, cz); island.receiveShadow = true; root.add(island);

    const bridgeStart = city.xLines[city.xLines.length - 1] - 2;
    const bridgeEnd = cx - R + 12;
    const bridgeLen = bridgeEnd - bridgeStart;
    const bridgeX = (bridgeStart + bridgeEnd) / 2;
    // ---- INTENTIONAL CABLE-STAYED BRIDGE (replaces the old blank gray slab
    //      walls). One coherent style: a structural concrete deck with curbs,
    //      see-through steel railings (posts + twin top rails), two tapered
    //      pylons straddling the deck near the 1/3 / 2/3 spans, and fan cables
    //      sweeping from each pylon top to the deck. The visible railing is
    //      open so you see the water through it; behind it a single thin,
    //      continuous SOLID curb collider per side runs the whole span as the
    //      fall-guard (no gap a car can slip through). All boxes are periodic,
    //      not per-meter, so the draw-call cost stays in the low tens. ----
    const SIDE = 8.7;                 // deck-edge / barrier centre on Z
    // colour buckets reused across all elements (keeps Lambert count low)
    const C_DECK = 0x8d939c, C_CURB = 0x707782, C_RAIL = 0x9aa3ad, C_PYLON = 0xb9c0c8, C_CABLE = 0xd9dde2;
    // deck base (slightly proud, with a structural fascia look) + road surface + centre dashes
    plane(bridgeX, cz, bridgeLen, 18, C_DECK, 0.025);
    plane(bridgeX, cz, bridgeLen, ROADW, 0x33363d, 0.055);
    for (let x = bridgeStart + 3; x < bridgeEnd; x += 7) plane(x, cz, 2.8, 0.28, 0xf2d14a, 0.075, true);

    // continuous SOLID fall-guard curb, one per side (low + thin, part of the
    // railing base). noCam so the chase camera doesn't clip on it. This is the
    // ONLY barrier collider — the posts/rails/cables below are all decorative.
    box(bridgeX, 0.45, cz - SIDE, bridgeLen, 0.9, 0.3, C_CURB, { solid: true, noCam: true });
    box(bridgeX, 0.45, cz + SIDE, bridgeLen, 0.9, 0.3, C_CURB, { solid: true, noCam: true });

    // see-through railings: vertical posts every ~5m + twin horizontal top rails.
    for (const sz of [cz - SIDE, cz + SIDE]) {
      for (let x = bridgeStart + 2.5; x <= bridgeEnd - 2.5; x += 5) {
        box(x, 1.0, sz, 0.16, 1.4, 0.16, C_RAIL, { cast: false });        // post (non-solid; curb holds the line)
      }
      box(bridgeX, 1.55, sz, bridgeLen, 0.1, 0.1, C_RAIL, { cast: false }); // upper rail
      box(bridgeX, 1.1, sz, bridgeLen, 0.08, 0.08, C_RAIL, { cast: false }); // mid rail
    }

    // two cable-stayed pylons + fan cables. Pylons straddle the deck (a leg on
    // each side joined by a cross-beam over the road); cables sweep from the
    // tower top down to deck anchor points fore and aft.
    const PYH = 19;                                   // pylon height above deck
    for (const px of [bridgeStart + bridgeLen * 0.30, bridgeStart + bridgeLen * 0.70]) {
      for (const sz of [cz - SIDE, cz + SIDE]) {
        box(px, PYH / 2, sz, 1.1, PYH, 1.1, C_PYLON, { solid: true, noCam: true }); // tapered leg (also a soft pier collider)
      }
      box(px, PYH + 0.4, cz, 1.0, 1.0, SIDE * 2 + 1.2, C_PYLON, { cast: false });    // cross-beam over the road
      // fan cables: from each tower-top corner to staggered deck anchors fore & aft
      for (const sz of [cz - SIDE, cz + SIDE]) {
        for (const dir of [-1, 1]) {
          for (let k = 1; k <= 3; k++) {
            const ax = px + dir * (4 + k * 5);          // deck anchor along the span
            const dx = ax - px, dy = PYH, midx = (px + ax) / 2;
            const len = Math.hypot(dx, dy);
            const cab = box(midx, PYH / 2 + 0.6, sz, 0.07, len, 0.07, C_CABLE, { cast: false });
            cab.rotation.z = Math.atan2(dx, dy);        // tilt the cable from vertical toward the anchor
          }
        }
      }
    }

    // span end portals — slim gateway frames where the bridge meets land, so
    // the entrance reads as a deliberate threshold rather than an open seam.
    for (const ex of [bridgeStart + 1.5, bridgeEnd - 1.5]) {
      box(ex, 2.6, cz - SIDE, 0.6, 5.2, 0.6, C_PYLON, { cast: false });
      box(ex, 2.6, cz + SIDE, 0.6, 5.2, 0.6, C_PYLON, { cast: false });
      box(ex, 5.0, cz, 0.6, 0.6, SIDE * 2 + 0.6, C_PYLON, { cast: false });
    }

    // the deck barriers run the full span; AABB matches the curb edges (cz±SIDE)
    city.bridge = { minX: bridgeStart - 2, maxX: bridgeEnd + 5, minZ: cz - (SIDE + 0.5), maxZ: cz + (SIDE + 0.5) };
    city.roads.push({ x: bridgeX, z: cz, vertical: false, len: bridgeLen, district: "bridge" });

    // ---- landmark towers: every former mountain position becomes skyline ----
    const towers = [];
    function tower(x, z, w, d, storeys, color, name) {
      const rec = registerBuilding(x, z, w, d, storeys, color, name, "tower");
      towers.push(rec.lot);
      tag(rec.b.group, name, rec.b.h + 2.2, storeys > 10 ? 8 : 6);
      // rooftop beacon makes the tower readable from the mainland.
      rec.b.lbox(0, rec.b.h + 1.0, 0, 0.45, 2.0, 0.45, 0xff5b5b, { emissive: 0xff3b3b, ei: 0.8, cast: false });
      return rec;
    }

    tower(cx - 13, cz, 19, 20, 15, 0x667991, "TWIN TOWER WEST");
    tower(cx + 13, cz, 19, 20, 15, 0x71849d, "TWIN TOWER EAST");
    tower(cx - 52, cz - 30, 14, 15, 8, 0x596b82, "NORTHWEST TOWER");
    tower(cx + 48, cz + 40, 15, 15, 9, 0x7a6f8c, "SOUTHEAST TOWER");
    tower(cx + 40, cz - 48, 14, 14, 7, 0x5e7d86, "NORTHEAST TOWER");

    // ---- service station and showroom, copied from the disaster-town mix ----
    function gasStation(x, z) {
      addPlaced(x, z, 20, 15);
      lots.push({ cx: x, cz: z, w: 20, d: 15, kind: "gas", district: "island", building: { name: "Island Gas" } });
      plane(x, z, 20, 15, 0x41464d, 0.045);
      const CH = 5.2;
      [[-6, -3.5], [6, -3.5], [-6, 3.5], [6, 3.5]].forEach(([px, pz]) => box(x + px, CH / 2, z + pz, 0.55, CH, 0.55, 0xeef1f4, { solid: true }));
      box(x, CH + 0.45, z, 14.5, 0.9, 9.5, 0xfbfcfe, { solid: true, y0: CH, y1: CH + 0.9 });
      for (let i = -1; i <= 1; i++) box(x + i * 4, 0.8, z, 0.8, 1.6, 0.7, 0xff7a1a, { solid: true });
      box(x - 9.5, 2.4, z - 5.5, 0.5, 4.8, 0.5, 0x6a7079, { solid: true });
      box(x - 9.5, 4.6, z - 5.5, 2.2, 1.6, 0.3, 0xffd451);
      // THE KIOSK along the back of the pad: a grab-and-go counter, two
      // stocked snack racks and a lit drinks cooler — the stop is a real
      // business you walk through, not just pumps under a roof.
      box(x - 6.2, 0.55, z + 5.4, 2.6, 1.1, 0.9, 0x55606e, { solid: true });           // counter
      box(x - 6.2, 1.14, z + 5.4, 2.7, 0.08, 1.0, 0xe6e8ee, { cast: false });          // worktop
      for (const off of [-2.4, 0.4]) {
        box(x + off, 0.7, z + 5.6, 1.7, 1.4, 0.6, 0x44505c, { cast: false });          // rack body
        for (let i = 0; i < 4; i++)
          box(x + off - 0.55 + i * 0.38, 1.55, z + 5.6, 0.28, 0.3, 0.28,
            [0xff6b5a, 0x6bbf4a, 0xffc94a, 0x5a8aff][i], { cast: false });             // snack stock
      }
      box(x + 3.4, 1.0, z + 5.6, 1.2, 2.0, 0.8, 0x9fe0ff, { emissive: 0x9fe0ff, ei: 0.45, cast: false });  // drinks cooler
    }

    // ISLAND CARS ARE REAL CARS (user-filmed: the old two-box props read as a
    // different, cheaper world — "why would the island have a different car
    // situation?"). Every spot is recorded and filled with a REAL vehicles.js
    // car — same unified visual as mainland traffic, enterable, stealable,
    // choppable. Spawn is deferred: spawnCityTraffic clears cityCars at the
    // start of every run, so the island re-fills right after it (see the wrap
    // below). No static colliders — a real car is solid through the car system
    // and must be free to drive away.
    const carSpots = [];
    function parkedCar(x, z, vertical, color, rare) {
      carSpots.push({ x, z, vertical, rare: !!rare });
    }
    function spawnAnnexCars() {
      if (!CBZ.cityMakeCar || !CBZ.city || !CBZ.city.arena) return;
      const econ = CBZ.cityEcon;
      for (const s of carSpots) {
        const heading = s.vertical ? (Math.random() < 0.5 ? 0 : Math.PI) : (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
        const model = econ && econ.pickCar ? econ.pickCar(s.rare || Math.random() < 0.12) : null;
        const c = CBZ.cityMakeCar(s.x, s.z, heading, s.vertical, model, 0.2);
        c.ai = false; c.v = 0; c.baseV = 0; c.road = null;   // parked until someone takes it
      }
    }
    annexCarHook = spawnAnnexCars;

    function showroom(x, z) {
      addPlaced(x, z, 18, 13);
      lots.push({ cx: x, cz: z, w: 18, d: 13, kind: "carlot", district: "island", building: { name: "Island Auto Showroom" } });
      plane(x, z, 18, 13, 0xd6dade, 0.055);
      box(x, 3, z + 6.3, 18, 6, 0.35, 0x586a86, { solid: true });
      box(x - 8.8, 3, z, 0.35, 6, 13, 0x586a86, { solid: true });
      box(x + 8.8, 3, z, 0.35, 6, 13, 0x586a86, { solid: true });
      box(x, 6.2, z, 18, 0.4, 13, 0x46566b, { solid: true, y0: 6, y1: 6.4 });
      box(x - 5.1, 3, z - 6.3, 0.5, 6, 0.35, 0x44506b, { solid: true });
      box(x + 5.1, 3, z - 6.3, 0.5, 6, 0.35, 0x44506b, { solid: true });
      box(x, 6.9, z - 6.3, 10, 1.2, 0.3, 0x12c258);
      // SALES FLOOR dressing: a manager's desk with a lit terminal by the
      // glass, tyre stacks + a parts shelf along the back wall, and a pale
      // display plinth under the feature car — a showroom you'd browse (and
      // a reason to believe the cars are FOR SALE, i.e. worth taking).
      box(x - 6.6, 0.5, z - 3.4, 2.0, 1.0, 0.9, 0x44505c, { solid: true });            // sales desk
      box(x - 6.6, 1.06, z - 3.4, 2.1, 0.08, 1.0, 0xe6e8ee, { cast: false });          // desktop
      box(x - 6.2, 1.4, z - 3.4, 0.5, 0.45, 0.08, 0x39d0c0, { emissive: 0x39d0c0, ei: 0.5, cast: false }); // terminal
      for (const off of [5.6, 7.2]) for (let i = 0; i < 3; i++)
        box(x + off, 0.26 + i * 0.45, z + 5.3, 0.9 - i * 0.12, 0.42, 0.9 - i * 0.12, 0x23262b, { cast: false }); // tyre stacks
      box(x - 7.4, 0.8, z + 5.4, 2.2, 1.6, 0.7, 0x3a352e, { cast: false });            // parts shelf
      box(x, 0.1, z + 4.2, 5.2, 0.2, 3.0, 0xc8ccd4, { cast: false });                  // feature-car plinth
      parkedCar(x - 4.6, z + 1.6, true, 0xe24b4b, true);
      parkedCar(x + 4.6, z + 1.6, true, 0x3c6fd6, true);
      parkedCar(x, z + 4.2, false, 0xf2c43d, true);
    }

    gasStation(cx - 78, cz + 74);
    showroom(cx + 72, cz - 76);

    // ---- enterable low-rise town around the former terrain peaks ----
    const PALETTE = [0xff7a6b, 0x6bb6ff, 0xffd166, 0x9ad17a, 0xc792ea, 0xff9e6b, 0x66d9c0, 0xf06b9b];
    function nearRoad(x, z, w, d) {
      for (let k = -2; k <= 2; k++) {
        if (Math.abs(x - (cx + k * GRID)) < w / 2 + ROADW / 2 + 1.2) return true;
        if (Math.abs(z - (cz + k * GRID)) < d / 2 + ROADW / 2 + 1.2) return true;
      }
      return false;
    }
    let made = 0, attempts = 0;
    while (made < 15 && attempts++ < 900) {
      const a = rng() * Math.PI * 2, dist = 46 + rng() * (R - 60);
      const x = cx + Math.cos(a) * dist, z = cz + Math.sin(a) * dist;
      const w = 8 + rng() * 4.5, d = 8 + rng() * 4.5;
      if (clashes(x, z, w, d, 4) || nearRoad(x, z, w, d)) continue;
      const storeys = 1 + ((rng() * 3) | 0);
      const rec = registerBuilding(x, z, w, d, storeys, PALETTE[(rng() * PALETTE.length) | 0], "Island Apartments", "tower");
      if (rng() < 0.22) tag(rec.b.group, "ISLAND BLOCK", rec.b.h + 1.5, 4.5);
      made++;
    }

    // ---- copied island street grid, clipped around the replacement towers ----
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x33363d });
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2d14a });
    function blocked(x, z) {
      for (const p of placed) {
        if (Math.abs(p.x - x) < p.w / 2 + ROADW / 2 + 0.8 && Math.abs(p.z - z) < p.d / 2 + ROADW / 2 + 0.8) return true;
      }
      return false;
    }
    function nearDoor(x, z, radius) {
      const r2 = radius * radius;
      for (const lot of lots) {
        const d = lot.building && lot.building.door;
        if (!d) continue;
        const ex = d.x - d.nx * 4.8, ez = d.z - d.nz * 4.8;
        const vx = ex - d.x, vz = ez - d.z, wx = x - d.x, wz = z - d.z;
        const den = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / den));
        const dx = x - (d.x + vx * t), dz = z - (d.z + vz * t);
        if (dx * dx + dz * dz < r2) return true;
      }
      return false;
    }
    function layRoadLine(fixed, vertical) {
      const step = 4, segs = [];
      let start = null;
      for (let t = -R; t <= R + step; t += step) {
        const x = vertical ? fixed : cx + t, z = vertical ? cz + t : fixed;
        const ok = Math.hypot(x - cx, z - cz) < R - 5 && !blocked(x, z);
        if (ok && start === null) start = t;
        if ((!ok || t > R) && start !== null) {
          const end = ok ? t : t - step;
          if (end - start >= step * 2) segs.push([start, end]);
          start = null;
        }
      }
      for (const [a, b] of segs) {
        const mid = (a + b) / 2, len = b - a;
        const x = vertical ? fixed : cx + mid, z = vertical ? cz + mid : fixed;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(vertical ? ROADW : len, vertical ? len : ROADW), roadMat);
        m.rotation.x = -Math.PI / 2; m.position.set(x, 0.05, z); m.receiveShadow = true; root.add(m);
        const dashes = Math.max(1, Math.floor(len / 6));
        for (let i = 0; i < dashes; i++) {
          const tt = a + (i + 0.5) * (len / dashes);
          const lx = vertical ? fixed : cx + tt, lz = vertical ? cz + tt : fixed;
          const dm = new THREE.Mesh(new THREE.PlaneGeometry(vertical ? 0.3 : 2.4, vertical ? 2.4 : 0.3), lineMat);
          dm.rotation.x = -Math.PI / 2; dm.position.set(lx, 0.07, lz); root.add(dm);
        }
        const seg = { x, z, len, vertical, district: "island" };
        roadSegs.push(seg); city.roads.push(seg);
      }
    }
    const islandXLines = [], islandZLines = [];
    for (let k = -2; k <= 2; k++) {
      islandXLines.push(cx + k * GRID); islandZLines.push(cz + k * GRID);
      layRoadLine(cx + k * GRID, true);
      layRoadLine(cz + k * GRID, false);
    }

    // Traffic lights and the radar use the same intersection records as downtown.
    for (const x of islandXLines) for (const z of islandZLines) {
      if (Math.hypot(x - cx, z - cz) >= R - 8 || blocked(x, z)) continue;
      plane(x, z, ROADW, ROADW, 0x2e3138, 0.06);
      city.intersections.push({ x, z, i: -1, j: -1, phase: 0, t: rng() * 6, ns: true, light: null, district: "island" });
    }
    city.allXLines = city.xLines.concat(islandXLines);
    city.allZLines = city.zLines.concat(islandZLines);

    // ---- trees and parked cars make the new district feel inhabited ----
    for (let i = 0; i < 58; i++) {
      const a = rng() * Math.PI * 2, dist = 20 + rng() * (R - 24);
      const x = cx + Math.cos(a) * dist, z = cz + Math.sin(a) * dist;
      if (blocked(x, z) || nearRoad(x, z, 1, 1) || nearDoor(x, z, 2.7)) continue;
      const th = 2.0 + rng() * 1.5;
      box(x, th / 2, z, 0.5, th, 0.5, 0x6b4a2a, { solid: true, noCam: true });
      box(x, th + 1.2, z, 2.4 + rng(), 2.6, 2.4 + rng(), 0x3f9a4f, { cast: false });
    }
    const CAR_COLORS = [0xe24b4b, 0x3c6fd6, 0xf2c43d, 0x4caf6e, 0xe8e8ee, 0x2a2d33, 0xe88a3c];
    for (let i = 0; i < roadSegs.length; i += 2) {
      const r = roadSegs[i], off = (rng() < 0.5 ? -1 : 1) * ROADW * 0.25, along = (rng() - 0.5) * r.len * 0.65;
      const x = r.x + (r.vertical ? off : along), z = r.z + (r.vertical ? along : off);
      if (!blocked(x, z)) parkedCar(x, z, r.vertical, CAR_COLORS[(rng() * CAR_COLORS.length) | 0], false);
    }

    const annex = {
      cx, cz, radius: R, lots, towers, roads: roadSegs,
      xLines: islandXLines, zLines: islandZLines,
      center: { x: cx, z: cz },
    };
    city.annex = annex;
    return annex;
  };
})();
