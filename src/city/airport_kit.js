/* ============================================================
   city/airport_kit.js — BUILD AN AIRFIELD ANYWHERE, FROM ONE SPEC.

   OWNER (2026-08-09): "package the airport so you can just duplicate and put
   it somewhere else easily without rewriting that code."

   systems/airports.js turned an airport into a RECORD with a frame. This file
   turns that record into GROUND: one call, `CBZ.buildAirfield(city, spec)`,
   and a field exists at any origin, on any bearing, with a runway you can
   land on, a taxiway that reaches it, stands with real parked airliners, a
   terminal with a kerb, a tower, a windsock and a fence.

   WHY IT IS NOT A COPY OF island_airport.js. Halloran Field is 3,977 lines
   because it is a HAND-DRESSED PLACE: a concourse you walk through, escalator
   links, a taxi rank, a jet bridge, an airliner mid-pushback, 12 seated
   travellers, a control-tower console with a controller behind it. None of
   that is what makes it an AIRPORT — it is what makes it Halloran. This kit
   authors only the airport: the surfaces, the markings, the lights, the
   stands, the shells. A second field built from it reads as a regional
   airport rather than as a photocopy of the international one, which is
   also the honest outcome.

   WHAT IT REUSES RATHER THAN RE-AUTHORS — the whole point:
     • THE AEROPLANES. `CBZ.airportKit.airliner/jet/boardable`, published by
       island_airport.js's own build. The parked fleet here is therefore the
       SAME airframe: same cabin, same seats, same pilots cast by npclife,
       same doors, same damage model, same hand-off to the player's flight
       physics. Not one vertex of aircraft geometry is authored in this file.
     • THE MATERIAL POOL (`CBZ.cmat`), the collider array (`CBZ.colliders`),
       the region/no-spawn/road registries, `CBZ.hash01` for anything random.
     • THE FRAME (`ap.toWorld`) — every number below is a LOCAL metre.

   DRAW-CALL DISCIPLINE: the pad is one plane; every painted marking on the
   whole field merges into ONE mesh; the runway/taxiway edge lights are ONE
   InstancedMesh; the fence posts are ONE. A complete second airport costs
   roughly a dozen draw calls plus its parked aircraft.

   Flag: `AIRPORT_KIT_V1=false` → `CBZ.buildAirfield` returns null and any
   field that would have been built simply is not.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.AIRPORT_KIT_V1 == null) CFG.AIRPORT_KIT_V1 = true;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
  const mat = CBZ.mat || cmat;

  // The palette is island_airport.js's, read off its own constants so the two
  // fields are the same asphalt and the same paint.
  const C_GRASS = 0x54683f, C_TARMAC = 0x3c3f44, C_RUNWAY = 0x2c2f33;
  const C_WHITE = 0xdfe3e8, C_YELLOW = 0xd8b53a, C_TERM = 0xb9bfc6, C_GLASS = 0x2b3a4a;

  function hash01(x, z, s) {
    if (CBZ.hash01) return CBZ.hash01(x, z, s);
    const n = Math.sin(x * 127.1 + z * 311.7 + (s || 0) * 0.017) * 43758.5453;
    return n - Math.floor(n);
  }

  /* ==============================================================
     BUILD. `spec` is the airports.js registration spec plus the few
     numbers that only matter to geometry (how many stands, whether
     the field gets a tower). The airport RECORD is registered here
     so a caller never has to make two calls that can disagree.
     ============================================================== */
  CBZ.buildAirfield = function (city, spec) {
    if (!city || !spec || CFG.AIRPORT_KIT_V1 === false) return null;
    const root = city.root;
    if (!root || !CBZ.registerAirport) return null;

    const ap = CBZ.registerAirport(spec);
    if (!ap) return null;
    ap.builtBy = "airport_kit";

    const B = ap.bounds;
    const H = ap.runway.len / 2, RW = ap.runway.w;
    const TAXI_W = 23, APRON_D = 74;

    // ---- (1) THE PAD. Axis-aligned and exactly the registered bounds, so the
    //      walkable region, the no-spawn rect and the ground you can stand on
    //      are the SAME rectangle. A rotated pad would leave the region's
    //      corners hanging over open water.
    {
      const g = new THREE.PlaneGeometry(B.maxX - B.minX, B.maxZ - B.minZ);
      g.rotateX(-Math.PI / 2);
      g.translate((B.minX + B.maxX) / 2, 0.02, (B.minZ + B.maxZ) / 2);
      const m = new THREE.Mesh(g, cmat(C_GRASS));
      m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
      m.userData.terrain = true; m.userData.worldSurface = true;
      m.name = "airfield-surface:" + ap.id;
      root.add(m);
    }

    // ---- (2) THE FIELD GROUP. Everything from here down is authored in LOCAL
    //      metres; the group carries the origin and the bearing. This is the
    //      packaging: move the spec, and every surface below moves with it.
    const F = new THREE.Group();
    F.position.set(ap.x, 0, ap.z);
    F.rotation.y = ap.yaw;
    F.name = "airfield:" + ap.id;
    root.add(F);
    ap.group = F;

    const BGU = THREE.BufferGeometryUtils;
    const paint = [];            // every white marking, merged once
    const paintY = [];           // every yellow marking, merged once

    function slab(lx, lz, w, d, y, color) {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(lx, y, lz);
      const m = new THREE.Mesh(g, cmat(color));
      m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
      F.add(m);
      return m;
    }
    function markGeo(list, lx, lz, w, d, rot) {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      if (rot) g.rotateY(rot);
      g.translate(lx, 0.075, lz);
      list.push(g);
    }
    function mergeMarks(list, color) {
      if (!list.length) return;
      const pm = cmat(color).clone();
      pm.polygonOffset = true; pm.polygonOffsetFactor = -2; pm.polygonOffsetUnits = -6;
      if (BGU && BGU.mergeBufferGeometries) {
        const m = new THREE.Mesh(BGU.mergeBufferGeometries(list), pm);
        m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false; m.updateMatrix();
        F.add(m);
      } else {
        for (const g of list) F.add(new THREE.Mesh(g, pm));
      }
    }
    // A box authored in local metres that ALSO leaves a world collider. The
    // collider is axis-aligned (the engine's are), so a rotated shell gets the
    // extent of its rotated footprint — never smaller than the thing itself.
    function shell(lx, ly, lz, w, h, d, color, opts) {
      opts = opts || {};
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts.emissive
        ? mat(color, { emissive: opts.emissive, ei: opts.ei || 0.5 }) : cmat(color));
      m.position.set(lx, ly, lz);
      m.castShadow = !!opts.cast; m.receiveShadow = true;
      F.add(m);
      if (opts.solid !== false) {
        const c = Math.abs(ap._c), s = Math.abs(ap._s);
        const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
        const wp = ap.toWorld(lx, lz);
        const col = {
          minX: wp.x - hw, maxX: wp.x + hw, minZ: wp.z - hd, maxZ: wp.z + hd,
          y0: ly - h / 2, y1: ly + h / 2, ref: m,
        };
        if (opts.noBreach) col.noBreach = true;
        CBZ.colliders.push(col);
      }
      return m;
    }

    // ---- (3) SURFACES -----------------------------------------------------
    slab(0, 0, ap.runway.len + 60, RW + 16, 0.03, 0x3a4636);          // graded strip
    slab(0, 0, ap.runway.len, RW, 0.05, C_RUNWAY);                    // the runway
    slab(0, ap.taxiZ, ap.runway.len - 90, TAXI_W, 0.045, C_TARMAC);   // parallel taxiway
    // connectors: one at each end plus the mid-field stub onto the apron.
    // Published on the record, because a taxiing aeroplane may only cross
    // between taxiway and runway where there IS pavement.
    const CONN = ap.connectors && ap.connectors.length ? ap.connectors : [-H + 45, 0, H - 45];
    ap.connectors = CONN;
    for (const cx of CONN) {
      const dz = ap.taxiZ / 2;
      slab(cx, dz, TAXI_W, ap.taxiZ, 0.045, C_TARMAC);
    }
    // apron: the ramp the stands sit on, reaching from the taxiway to the
    // terminal frontage so an aeroplane never crosses grass.
    const apronCZ = (ap.taxiZ + ap.termZ) / 2;
    const apronW = Math.max(160, ap.gates.length * 62 + 60);
    slab(ap.gates.length ? (ap.gates[0].lx + ap.gates[ap.gates.length - 1].lx) / 2 : 0,
      apronCZ, apronW, APRON_D, 0.045, C_TARMAC);
    // apron stub connecting the ramp back to the parallel taxiway
    slab(0, ap.taxiZ + 6, apronW * 0.6, 16, 0.046, C_TARMAC);

    // ---- (4) MARKINGS -----------------------------------------------------
    // runway centreline: 30 m stripe / 20 m gap, the real ICAO cadence.
    for (let x = -H + 30; x < H - 30; x += 50) markGeo(paint, x + 15, 0, 30, 0.9);
    // threshold bars (8 per end) + a touchdown-zone pair at each aiming point.
    for (const e of ap.ends) {
      const sx = e.sign * (H - 8);
      for (let i = 0; i < 8; i++) {
        const off = (i - 3.5) * 2.2;
        markGeo(paint, sx, off, 14, 1.4);
      }
      const tx = e.sign * (H - ap.runway.tdz);
      for (const s of [-1, 1]) markGeo(paint, tx, s * 5.5, 22, 2.4);
    }
    // runway edge stripes
    for (const s of [-1, 1]) markGeo(paint, 0, s * (RW / 2 - 1), ap.runway.len - 20, 1.0);
    // taxiway centreline + the hold-short bars that make the runway a runway
    markGeo(paintY, 0, ap.taxiZ, ap.runway.len - 100, 0.7);
    for (const cx of CONN) {
      markGeo(paintY, cx, ap.taxiZ / 2, 0.7, ap.taxiZ);
      for (let i = 0; i < 4; i++) markGeo(paintY, cx + (i - 1.5) * 1.6, RW / 2 + 12, 0.5, 8);
    }
    // stand lead-in lines: one yellow line per gate, from the apron edge to
    // the stand, so a taxiing aeroplane visibly follows something.
    for (const g of ap.gates) {
      markGeo(paintY, g.lx, (ap.taxiZ + g.lz) / 2, 0.6, Math.abs(g.lz - ap.taxiZ));
      markGeo(paintY, g.lx, g.lz - 2, 12, 0.6);
    }
    mergeMarks(paint, C_WHITE);
    mergeMarks(paintY, C_YELLOW);

    // ---- (5) EDGE LIGHTS — ONE InstancedMesh for the whole field ----------
    {
      const pts = [];
      for (let x = -H; x <= H; x += 60) {
        pts.push([x, -RW / 2 - 2], [x, RW / 2 + 2]);
      }
      for (let x = -H + 60; x <= H - 60; x += 90) {
        pts.push([x, ap.taxiZ - TAXI_W / 2 - 2], [x, ap.taxiZ + TAXI_W / 2 + 2]);
      }
      const geo = new THREE.BoxGeometry(0.28, 0.34, 0.28);
      const lm = mat(0xfff0c0, { emissive: 0xffe08a, ei: 0.85 });
      const inst = new THREE.InstancedMesh(geo, lm, pts.length);
      const d = new THREE.Object3D();
      for (let i = 0; i < pts.length; i++) {
        d.position.set(pts[i][0], 0.17, pts[i][1]);
        d.updateMatrix(); inst.setMatrixAt(i, d.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.name = "airfield-lights:" + ap.id;
      F.add(inst);
    }

    // ---- (6) THE TERMINAL, THE KERB AND THE TOWER -------------------------
    const termW = Math.max(90, apronW * 0.72), termD = 22;
    const termCX = ap.gates.length ? (ap.gates[0].lx + ap.gates[ap.gates.length - 1].lx) / 2 : 0;
    shell(termCX, 5.0, ap.termZ, termW, 10, termD, C_TERM, { cast: true });
    // airside glass band (so the concourse reads as a terminal from the ramp)
    shell(termCX, 6.4, ap.termZ - termD / 2 - 0.15, termW - 8, 3.2, 0.3, C_GLASS, { solid: false });
    // landside canopy over the kerb — the check-in desk stands under it.
    shell(termCX, 4.6, ap.kerbZ - 3, termW * 0.7, 0.4, 9, 0xa8aeb6, { cast: true, solid: false });
    for (let i = -2; i <= 2; i++) {
      shell(termCX + i * (termW * 0.7 / 5), 2.3, ap.kerbZ - 6.6, 0.5, 4.6, 0.5, 0x8d939b, { solid: false });
    }
    /* THE CHECK-IN COUNTER. The kit draws it because the kit owns geometry;
       city/ticketing.js owns only the verb that happens at it. A counter with
       nobody behind it is the dead prop this repo keeps deleting, so the desk
       gets a real posted body through the shared staff system — data until
       you are within 170 m of it, exactly like every other worker. */
    if (ap.desk) {
      shell(ap.desk.lx, 0.55, ap.desk.lz + 1.3, 8, 1.1, 2.2, 0xc9cfd6, { cast: true });
      shell(ap.desk.lx, 1.15, ap.desk.lz + 1.3, 8, 0.1, 2.4, 0x2b2f34, { solid: false });
      shell(ap.desk.lx, 3.1, ap.desk.lz + 2.6, 6, 0.9, 0.16, 0x1d5f8a, { solid: false, emissive: 0x1d5f8a, ei: 0.35 });
      if (CBZ.cityStaffPost) {
        const w = ap.toWorld(ap.desk.lx, ap.desk.lz + 2.6);
        try {
          CBZ.cityStaffPost({
            venue: "airport-desk", id: ap.id + ":desk",
            job: "ticket agent", archetype: "laborer",
            x: w.x, z: w.z, face: ap.dirWorld(Math.PI),
          });
        } catch (e) {}
      }
    }

    // the tower: shaft + cab, on the apron's edge with a view down the field.
    if (spec.tower !== false) {
      const tx = termCX - termW / 2 - 26, tz = ap.apronZ - 6;
      shell(tx, 9, tz, 7, 18, 7, 0xb3b8bf, { cast: true });
      shell(tx, 19.4, tz, 11, 3.4, 11, C_GLASS, { cast: true });
      shell(tx, 21.4, tz, 12, 0.6, 12, 0x6d737b, { cast: true, solid: false });
    }
    // windsock — the one prop that tells you this is an active field.
    {
      const wx = termCX + termW / 2 + 30, wz = ap.taxiZ + 14;
      shell(wx, 3, wz, 0.3, 6, 0.3, 0xd8d8d8, { solid: false });
      const sock = new THREE.Mesh(new THREE.ConeGeometry(0.85, 3.4, 8, 1, true), cmat(0xe2662a));
      sock.rotation.z = -Math.PI / 2; sock.position.set(wx + 1.9, 5.6, wz);
      F.add(sock);
    }

    // ---- (7) THE FENCE — ONE instanced post run around the field ----------
    if (spec.fence !== false) {
      const pts = [];
      const fx0 = -H - 40, fx1 = H + 40, fz0 = -RW / 2 - 40, fz1 = ap.kerbZ + 16;
      for (let x = fx0; x <= fx1; x += 12) pts.push([x, fz0], [x, fz1]);
      for (let z = fz0; z <= fz1; z += 12) pts.push([fx0, z], [fx1, z]);
      const geo = new THREE.BoxGeometry(0.16, 2.4, 0.16);
      const inst = new THREE.InstancedMesh(geo, cmat(0x8b9099), pts.length);
      const d = new THREE.Object3D();
      for (let i = 0; i < pts.length; i++) {
        d.position.set(pts[i][0], 1.2, pts[i][1]);
        d.updateMatrix(); inst.setMatrixAt(i, d.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      F.add(inst);
    }

    // ---- (8) THE PARKED FLEET — island_airport.js's own airframes ---------
    // Nothing here knows what an airliner looks like. If the kit is not
    // published (a build without island_airport.js) the field is simply an
    // empty aerodrome rather than a broken one.
    const K = CBZ.airportKit;
    const liveries = [0x2d5fb0, 0xb33636, 0x1f7a4d, 0xc78a1f, 0x7a4ea8];
    ap.parked = [];
    if (K && K.airliner && K.boardable) {
      const nPark = Math.max(0, spec.parked == null ? Math.min(2, ap.gates.length) : spec.parked | 0);
      for (let i = 0; i < nPark && i < ap.gates.length; i++) {
        const g = ap.gates[i];
        try {
          const grp = K.airliner(g.x, g.z, g.worldHeading, liveries[(i + ap.gates.length) % liveries.length]);
          K.boardable(grp, g.x, g.z, g.worldHeading, 30, 22, "Airliner");
          g.occupant = "parked";
          ap.parked.push(grp);
        } catch (e) { try { console.error("[airfield] parked airliner", ap.id, e); } catch (e2) {} }
      }
      if (K.jet && spec.jets !== false) {
        const jz = ap.apronZ - 4;
        for (let i = 0; i < 2; i++) {
          const lx = termCX + termW / 2 + 34 + i * 22;
          const w = ap.toWorld(lx, jz + (i ? 8 : 0));
          const hd = ap.dirWorld(-Math.PI / 2 + (hash01(lx, jz, 7) - 0.5) * 0.4);
          try {
            const grp = K.jet(w.x, w.z, hd, i ? 0x6a3a6a : 0x355c8a);
            K.boardable(grp, w.x, w.z, hd, 14, 12, "Private Jet");
            ap.parked.push(grp);
          } catch (e) {}
        }
      }
    }

    // ---- (9) THE WORLD CONTRACTS -----------------------------------------
    CBZ.registerCityRegion(city, {
      name: ap.name, subtitle: spec.subtitle || "Airport", biome: spec.biome || "airport", kind: "rect",
      minX: B.minX, maxX: B.maxX, minZ: B.minZ, maxZ: B.maxZ, pad: 6,
    });
    // NOBODY WALKS ON THE MOVEMENT AREA — the same law Halloran keeps, and the
    // reason it is a rect in LOCAL space projected to world: on a rotated field
    // an axis-aligned "everything south of the terminal" would either leak onto
    // the runway or bar the kerb. Landside (z > termZ - 14) stays open.
    if (CBZ.registerNoSpawnZone) {
      const c0 = ap.toWorld(-H - 30, -RW / 2 - 30), c1 = ap.toWorld(H + 30, -RW / 2 - 30);
      const c2 = ap.toWorld(-H - 30, ap.termZ - 14), c3 = ap.toWorld(H + 30, ap.termZ - 14);
      const xs = [c0.x, c1.x, c2.x, c3.x], zs = [c0.z, c1.z, c2.z, c3.z];
      try {
        CBZ.registerNoSpawnZone(city, {
          minX: Math.min.apply(null, xs), maxX: Math.max.apply(null, xs),
          minZ: Math.min.apply(null, zs), maxZ: Math.max.apply(null, zs),
          label: ap.id + "-airside",
        });
      } catch (e) {}
    }
    // A kerb road so the field is a place traffic can reach, and a link out
    // toward whatever the spec names as its road plug (usually the town it
    // serves). Both ride ap.toWorld, so they follow the field.
    /* THE KERB ROAD, and the one thing this kit will not fake. A `city.roads`
       record is AXIS-ALIGNED by construction (`vertical` is a boolean), so a
       kerb on a crooked field cannot be expressed as one: a 217 m frontage at
       16 degrees drifts 60 m off its own canopy, which is a road painted
       through the terminal. So the kerb road exists when the field is
       near-axis (within ~6 degrees, i.e. every field whose runway follows the
       world grid) and is simply absent when it is not — the access link still
       docks at the kerb, the ramp is still walkable, and nothing draws a lane
       where there is no lane. A rotated field that wants kerb traffic needs a
       road record that can carry a bearing; that is a change to the road
       format, not something to approximate here. */
    const axisAligned = Math.min(Math.abs(ap._s), Math.abs(ap._c)) < 0.105;
    if (city.roads && axisAligned) {
      const k0 = ap.toWorld(termCX - termW / 2 - 20, ap.kerbZ), k1 = ap.toWorld(termCX + termW / 2 + 20, ap.kerbZ);
      const horiz = Math.abs(k1.x - k0.x) >= Math.abs(k1.z - k0.z);
      city.roads.push({
        x: (k0.x + k1.x) / 2, z: (k0.z + k1.z) / 2, vertical: !horiz,
        len: Math.hypot(k1.x - k0.x, k1.z - k0.z), district: "highway",
        w: 18, lanesPerDir: 2, laneW: 3.6,
        // OWNERSHIP, not an exception: roadrules.js lets a road run inside the
        // place that OWNS it, and the kerb belongs to the airport it serves.
        owner: spec.biome || "airport",
      });
    }
    /* THE LINK. A field on its own ground needs a way in, and the honest shape
       is almost never one straight deck: the kerb faces whichever way the
       runway does, and the town it serves is somewhere else entirely. So the
       link is an L — down the kerb's axis first, then across — laid as two
       ordinary causeway legs. Both carry "Link" in their name, which is what
       tells the region audit these are meant to touch two shores. */
    if (spec.road && city.roads) {
      const kerb = ap.toWorld(termCX, ap.kerbZ + 8);
      const HW = 12;
      const legs = [];
      if (Math.abs(spec.road.z - kerb.z) > 24) legs.push({ vertical: true, x: kerb.x, z0: kerb.z, z1: spec.road.z });
      if (Math.abs(spec.road.x - kerb.x) > 24) legs.push({ vertical: false, z: spec.road.z, x0: kerb.x, x1: spec.road.x });
      for (let i = 0; i < legs.length; i++) {
        const L = legs[i];
        const midX = L.vertical ? L.x : (L.x0 + L.x1) / 2;
        const midZ = L.vertical ? (L.z0 + L.z1) / 2 : L.z;
        const len = L.vertical ? Math.abs(L.z1 - L.z0) : Math.abs(L.x1 - L.x0);
        const w = L.vertical ? HW * 2 : len, d = L.vertical ? len : HW * 2;
        const g = new THREE.PlaneGeometry(w, d);
        g.rotateX(-Math.PI / 2); g.translate(midX, 0.04, midZ);
        const m = new THREE.Mesh(g, cmat(0x3c3f46));
        m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
        m.userData.terrain = true; m.userData.worldSurface = true;
        root.add(m);
        CBZ.registerCityRegion(city, {
          name: ap.name + " Link " + (i + 1), subtitle: spec.subtitle || "Airport",
          biome: spec.biome || "airport", kind: "rect",
          minX: midX - w / 2, maxX: midX + w / 2, minZ: midZ - d / 2, maxZ: midZ + d / 2, pad: 1,
        });
        const link = {
          x: midX, z: midZ, vertical: L.vertical, len: len, district: "highway",
          w: 20, lanesPerDir: 2, laneW: 3.6, owner: spec.biome || "airport",
        };
        if (CBZ.roadClamp) { try { CBZ.roadClamp(link, { owner: link.owner }); } catch (e) {} }
        city.roads.push(link);
      }
    }

    return ap;
  };
})();
