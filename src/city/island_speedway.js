/* ============================================================
   city/island_speedway.js — THE SPEEDWAY ISLAND.

   WHY: a city this size has nowhere to open a car up. The drag of
   stop-lights and traffic is the whole point of the streets, but a
   gearhead needs a place where speed is the ONLY rule. So the
   northern bay gets a real banked superspeedway — a 2.5-mile-style
   tri-oval (Daytona/Talladega proportions, scaled to ~300m of
   footprint), reachable by its own causeway bridge off the commerce
   annex. You drive across the water, roll onto the apron, and at the
   start/finish stripe a flag-stand offers the only thing the streets
   can't: JOIN THE RACE. Five hand-picked muscle/super cars line up,
   you run the laps, the crowd in the grandstand is there to be raced
   IN FRONT OF, and the purse pays by finishing position.

   The motorsports park around the oval exists for the same reason a
   real speedway has a midway: the AUTO SHOWROOM is the cathedral —
   every car the city sells, on lit pads, floor after floor, so the
   track is also where you go to covet the next ride. A team garage,
   a trophy hall (why you race) and a trackside sports bar (where the
   crowd that can't get a seat watches) round it out.

   PERF: the grandstand seat rows + the packed spectator crowd are
   ONE InstancedMesh each (thousands of fans, two draw calls). The
   SAFER barrier, lane lines, catch-fence posts and floodlight masts
   are merged / instanced. One shared Lambert per colour (CBZ.mat
   pool). The race AI cars are animated procedurally around the oval
   centreline (not injected into the traffic graph), so they read as
   a live field without fighting the street AI. Deterministic LCG so
   the park is identical every run.

   Publishes nothing global except the landmass builder + the zone
   interaction; everything else is self-contained in this IIFE.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const mat = CBZ.cmat || CBZ.mat || function (c, o) {
    return new THREE.MeshLambertMaterial(Object.assign({ color: c }, o && o.emissive ? { emissive: o.emissive, emissiveIntensity: o.ei || 0.5 } : {}));
  };

  // ---- footprint -----------------------------------------------------------
  const CX = 470, CZ = -330, R = 200;            // speedway island
  const ANNEX = { cx: 348.5, cz: -700, r: 120 }; // existing commerce island (DO NOT TOUCH)

  // ---- deterministic LCG (no Math.random per owner rule) -------------------
  // seeded from CBZ.WORLD_SEED via the named-stream registry (core/seed.js)
  // — one world-seed knob instead of a per-file magic literal. rng() is
  // re-armed at build entry so a rebuild replays the identical stream.
  let rng = null;
  function armRng() { rng = CBZ.seedStream ? CBZ.seedStream('speedway') : (function () { let s = 990217; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })(); }
  armRng();

  // ---- track geometry (a tri-oval centreline) ------------------------------
  // A superspeedway is an elongated oval; the tri-oval is the start/finish
  // straight bulged out into a shallow fifth "turn" so the grandstand gets an
  // angled view. We lay the centreline on a parametric ellipse and push the
  // front straight (z on the +CZ / pit side) outward with a gentle bulge.
  const OVAL_RX = 150;          // half-width of the oval (X)
  const OVAL_RZ = 95;           // half-length (Z)
  const TRACK_W = 14;           // racing surface width
  const TRIBULGE = 16;          // tri-oval front-straight bulge (m)
  const SF_T = 0.0;             // start/finish line parameter (t=0 = front straight centre)

  // centreline point + outward normal + heading at param t∈[0,1)
  function ovalPoint(t) {
    const a = t * Math.PI * 2;
    let x = CX + Math.cos(a) * OVAL_RX;
    let z = CZ + Math.sin(a) * OVAL_RZ;
    // tri-oval bulge: the front straight is the +Z (sin>0) arc near a≈PI/2.
    // bulge peaks at the start/finish, fades over the straight.
    const front = Math.max(0, Math.sin(a));     // 0..1, peaks on front straight
    z += front * front * TRIBULGE;
    return { x, z };
  }
  function ovalFrame(t) {
    const p = ovalPoint(t);
    const p2 = ovalPoint(t + 0.0015);
    const dx = p2.x - p.x, dz = p2.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const tx = dx / len, tz = dz / len;        // tangent (heading dir)
    return { x: p.x, z: p.z, tx, tz, nx: -tz, nz: tx, heading: Math.atan2(tx, tz) };
  }

  // ====================================================================== //
  //  LANDMASS BUILDER                                                       //
  // ====================================================================== //
  CBZ.addLandmass(function (city) {
    const root = city.root;
    if (!root) return;
    armRng();

    // ---- shared palette ----
    const C_GRASS = 0x4f7a3a, C_INFIELD = 0x5d8a44, C_ASPHALT = 0x2b2d31,
      C_APRON = 0x3a3d42, C_CONCRETE = 0xb7bcc2, C_LINE = 0xeef2f6,
      C_PIT = 0x35383d, C_SAFER = 0xdadfe4, C_STEEL = 0x8a9099,
      C_STAND = 0x6c7480, C_SEAT = 0x37506e, C_RED = 0xc23a36,
      C_GREEN = 0x3ba24a, C_DECK = 0x6a6d72, C_CURB = 0xcfd3d8;

    function flat(geo, m, y, opts) {
      const mesh = new THREE.Mesh(geo, m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      root.add(mesh);
      return mesh;
    }

    // ---- 1. ground: circular grass island --------------------------------
    flat(new THREE.CircleGeometry(R, 64), mat(C_GRASS), 0.02);

    // ---- 2. the asphalt oval ring (track surface) ------------------------
    // Build a triangle strip ring between inner & outer edges of the centreline.
    {
      const N = 96;
      const pos = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const f = ovalFrame(i / N);
        const ix = f.x + f.nx * (TRACK_W / 2), iz = f.z + f.nz * (TRACK_W / 2); // outer
        const ox = f.x - f.nx * (TRACK_W / 2), oz = f.z - f.nz * (TRACK_W / 2); // inner
        pos.push(ix - CX, 0, iz - CZ, ox - CX, 0, oz - CZ);
      }
      for (let i = 0; i < N; i++) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat(C_ASPHALT));
      m.position.set(CX, 0.05, CZ); m.receiveShadow = true;
      root.add(m);
    }

    // ---- 3. infield grass (inside the oval) ------------------------------
    {
      const N = 64, shape = new THREE.Shape();
      for (let i = 0; i <= N; i++) {
        const f = ovalFrame(i / N);
        const x = f.x - f.nx * (TRACK_W / 2 + 1) - CX, z = f.z - f.nz * (TRACK_W / 2 + 1) - CZ;
        if (i === 0) shape.moveTo(x, z); else shape.lineTo(x, z);
      }
      const geo = new THREE.ShapeGeometry(shape);
      flat(geo, mat(C_INFIELD), 0.04);
    }

    // ---- 4. lane lines + start/finish + pit road -------------------------
    // dashed white lane line down the racing groove (instanced dashes)
    {
      const N = 120;
      const dash = new THREE.BoxGeometry(0.35, 0.02, 2.2);
      const im = new THREE.InstancedMesh(dash, mat(C_LINE), N);
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
      let k = 0;
      for (let i = 0; i < N; i++) {
        const f = ovalFrame(i / N);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.heading);
        M.compose(new THREE.Vector3(f.x, 0.07, f.z), q, s);
        im.setMatrixAt(k++, M);
      }
      im.count = k; im.instanceMatrix.needsUpdate = true;
      root.add(im);
    }
    // start/finish: a bold red stripe across the front straight
    {
      const f = ovalFrame(SF_T);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(TRACK_W, 0.03, 1.6), mat(C_RED, { emissive: 0xc23a36, ei: 0.25 }));
      stripe.position.set(f.x, 0.08, f.z);
      stripe.rotation.y = f.heading;
      root.add(stripe);
      // checker accent bars flanking it
      for (const off of [-1.4, 1.4]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(TRACK_W, 0.03, 0.5), mat(C_LINE));
        b.position.set(f.x + f.tx * off, 0.085, f.z + f.tz * off);
        b.rotation.y = f.heading; root.add(b);
      }
      city._sfLine = f;

      // PAINTED STARTING GRID — the staggered slots the field lines up in behind
      // the line (two columns, offset down-track like a real rolling-start grid).
      // One shared white box geo + one shared material → these all merge into the
      // C_LINE bucket; cheap painted markings, no per-slot draw cost.
      {
        const slotGeo = new THREE.BoxGeometry(0.18, 0.02, 2.0);   // a slot outline tick
        const slotMat = mat(C_LINE);
        const ROWS = 4, COLW = 2.6, ROWGAP = 6.0;
        for (let row = 0; row < ROWS; row++) {
          for (const lane of [-1, 1]) {
            // each successive grid box steps back down-track (behind the line) and
            // the right column is staggered half a row forward (the GP stagger).
            const back = -(row * ROWGAP + (lane > 0 ? 0 : ROWGAP * 0.5) + 3.0);
            const sx = f.x + f.tx * back + f.nx * (lane * COLW);
            const sz = f.z + f.tz * back + f.nz * (lane * COLW);
            // two side ticks bracket the painted box the car sits in (left + right
            // of the slot centre, along the across-track normal).
            for (const e of [-1.4, 1.4]) {
              const tk = new THREE.Mesh(slotGeo, slotMat);
              tk.position.set(sx + f.nx * e, 0.072, sz + f.nz * e);
              tk.rotation.y = f.heading;
              root.add(tk);
            }
          }
        }
      }
      // FLAGMAN STAND — a small post + a checkered-flag plate at the line, the
      // figure who waves the green/checker. Pure flavor anchoring WHY a START line.
      {
        const fx = f.x + f.nx * (TRACK_W / 2 + 2.2), fz = f.z + f.nz * (TRACK_W / 2 + 2.2);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.0, 0.18), mat(C_STEEL));
        post.position.set(fx, 1.5, fz); root.add(post);
        const flag = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.04), mat(C_LINE, { emissive: 0x202020, ei: 0.2 }));
        flag.position.set(fx, 2.7, fz + 0.5); flag.rotation.y = f.heading; root.add(flag);
        const knob = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), mat(C_RED, { emissive: 0xc23a36, ei: 0.3 }));
        knob.position.set(fx, 3.05, fz); root.add(knob);
      }
    }

    // ---- 5. pit road along the front straight with numbered stalls -------
    {
      const f0 = ovalFrame(0.04), f1 = ovalFrame(-0.04 + 1); // ends of front straight-ish band
      // a simple straight pit lane just inside the front straight
      const fc = ovalFrame(SF_T);
      const pitLen = 70, pitW = 8;
      const pit = new THREE.Mesh(new THREE.BoxGeometry(pitLen, 0.04, pitW), mat(C_PIT));
      // place inboard of the front straight
      const px = fc.x - fc.nx * (TRACK_W / 2 + pitW / 2 + 1);
      const pz = fc.z - fc.nz * (TRACK_W / 2 + pitW / 2 + 1);
      pit.position.set(px, 0.06, pz);
      pit.rotation.y = fc.heading;
      root.add(pit);
      // numbered pit stalls (label sprites) + a low pit wall
      const stalls = 8;
      for (let i = 0; i < stalls; i++) {
        const t = (i - (stalls - 1) / 2) * (pitLen / stalls);
        const sx = px + fc.tx * t, sz = pz + fc.tz * t;
        // stall divider line
        const ln = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, pitW), mat(C_LINE));
        ln.position.set(sx, 0.075, sz); ln.rotation.y = fc.heading; root.add(ln);
        if (CBZ.makeLabelSprite) {
          const lab = CBZ.makeLabelSprite(String(i + 1), { color: "#ffd451" });
          lab.scale.set(2, 0.5, 1);
          lab.position.set(sx, 1.3, sz);
          root.add(lab);
        }
      }
      // pit wall (concrete) between pit lane and track
      const wallX = fc.x - fc.nx * (TRACK_W / 2 + 1), wallZ = fc.z - fc.nz * (TRACK_W / 2 + 1);
      const pw = new THREE.Mesh(new THREE.BoxGeometry(pitLen, 0.9, 0.4), mat(C_CONCRETE));
      pw.position.set(wallX, 0.45, wallZ); pw.rotation.y = fc.heading; root.add(pw);
    }

    // ---- 6. SAFER barrier (outer wall) — colliders keep cars on track ----
    {
      const N = 80;
      const seg = new THREE.BoxGeometry(1.0, 1.0, (Math.PI * 2 * OVAL_RX) / N + 2.4);
      const im = new THREE.InstancedMesh(seg, mat(C_SAFER), N);
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < N; i++) {
        const f = ovalFrame(i / N);
        const wx = f.x + f.nx * (TRACK_W / 2 + 1.2);
        const wz = f.z + f.nz * (TRACK_W / 2 + 1.2);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.heading);
        M.compose(new THREE.Vector3(wx, 0.5, wz), q, s);
        im.setMatrixAt(i, M);
        // collider per segment so vehicles bounce off the wall
        const hw = 0.6;
        CBZ.colliders.push({ minX: wx - hw, maxX: wx + hw, minZ: wz - hw, maxZ: wz + hw, y0: 0, y1: 1.0 });
      }
      im.instanceMatrix.needsUpdate = true;
      root.add(im);
      // inner retaining wall (lower) so the infield edge reads
      const im2 = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.5, (Math.PI * 2 * OVAL_RX) / N + 1.6), mat(C_CONCRETE), N);
      for (let i = 0; i < N; i++) {
        const f = ovalFrame(i / N);
        const wx = f.x - f.nx * (TRACK_W / 2 + 0.6);
        const wz = f.z - f.nz * (TRACK_W / 2 + 0.6);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.heading);
        M.compose(new THREE.Vector3(wx, 0.25, wz), q, s);
        im2.setMatrixAt(i, M);
        const hw = 0.3;
        CBZ.colliders.push({ minX: wx - hw, maxX: wx + hw, minZ: wz - hw, maxZ: wz + hw, y0: 0, y1: 0.5 });
      }
      im2.instanceMatrix.needsUpdate = true;
      root.add(im2);
    }

    // ---- 7. GRANDSTANDS + instanced crowd along the front straight -------
    buildGrandstand(root, mat, ovalFrame, { CX, CZ, TRACK_W, C_STAND, C_SEAT, C_STEEL });

    // ---- 8. scoring pylon + floodlight masts -----------------------------
    buildPylonAndLights(root, mat, ovalFrame, rng);

    // ---- 9. CAUSEWAY bridge to the commerce annex ------------------------
    buildCauseway(root, mat, { C_DECK, C_CURB, C_STEEL }, rng);

    // ---- 10. motorsports complex buildings -------------------------------
    buildComplex(root, rng);

    // ---- 11. populate: spectators, pit crew, parked cars -----------------
    populate(root, rng, city);

    // ---- regions: register the island + causeway -------------------------
    CBZ.registerCityRegion(city, { name: "Diamond Speedway", subtitle: "Motorsports Park", biome: "speedway", kind: "circle", cx: CX, cz: CZ, r: R, pad: 6 });
    // L-shaped causeway widened to the 24m highway deck: vertical leg up from
    // the annex, horizontal leg over to the island.
    CBZ.registerCityRegion(city, { name: "Diamond Causeway", subtitle: "Motorsports Park", biome: "speedway", kind: "rect", minX: 336, maxX: 360, minZ: -585, maxZ: -435, pad: 1 });
    CBZ.registerCityRegion(city, { name: "Diamond Causeway", subtitle: "Motorsports Park", biome: "speedway", kind: "rect", minX: 336, maxX: 482, minZ: -459, maxZ: -435, pad: 1 });
    // give traffic a road down each leg so cars actually drive the causeway
    if (city.roads) {
      city.roads.push({ x: 348, z: -516, vertical: true, len: 150, district: "highway" });
      city.roads.push({ x: 409, z: -447, vertical: false, len: 134, district: "highway" });
    }
  }, 20);

  // ====================================================================== //
  //  GRANDSTANDS                                                            //
  // ====================================================================== //
  function buildGrandstand(root, mat, frame, P) {
    // Tiered stand running along the front straight, set back behind the wall.
    const fc = frame(0); // start/finish centre
    const ROWS = 14, SEATS = 60, TIER_RISE = 0.55, TIER_DEPTH = 0.95, SEAT_W = 0.95;
    const standLen = SEATS * SEAT_W;
    // anchor: outboard of the front straight, centred on S/F
    const baseX = fc.x + fc.nx * (P.TRACK_W / 2 + 7);
    const baseZ = fc.z + fc.nz * (P.TRACK_W / 2 + 7);
    const tx = fc.tx, tz = fc.tz;          // along the stand
    const nx = fc.nx, nz = fc.nz;          // back/up direction

    // tier decks (one box per row, merged-ish via shared geom) + seat instances
    const deckGeo = new THREE.BoxGeometry(standLen + 2, 0.25, TIER_DEPTH);
    const deckMat = mat(P.C_STAND);
    const seatGeo = new THREE.BoxGeometry(SEAT_W * 0.8, 0.4, 0.5);
    const seatMat = mat(P.C_SEAT);
    const totalSeats = ROWS * SEATS;
    const seatIM = new THREE.InstancedMesh(seatGeo, seatMat, totalSeats);
    // crowd: one capsule-ish figure per seat, instanced (the packed house)
    const fanGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.95, 5);
    const fanMat = mat(0xd8d2c4);
    const fanIM = new THREE.InstancedMesh(fanGeo, fanMat, totalSeats);
    fanIM.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(totalSeats * 3), 3);
    const FAN_COLORS = [0xc23a36, 0x3a66c2, 0x3ba24a, 0xe0a92e, 0xeef2f6, 0x8a4ec2, 0x2b2d31, 0xd66a2e];

    const M = new THREE.Matrix4(), q = new THREE.Quaternion(),
      one = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
    const standHeading = Math.atan2(tx, tz);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), standHeading);

    let si = 0;
    for (let r = 0; r < ROWS; r++) {
      const up = 1.2 + r * TIER_RISE;
      const back = 2 + r * TIER_DEPTH;
      const dx = baseX + nx * back, dz = baseZ + nz * back;
      // deck
      const deck = new THREE.Mesh(deckGeo, deckMat);
      deck.position.set(dx, up, dz);
      deck.rotation.y = standHeading;
      deck.receiveShadow = true;
      root.add(deck);
      for (let c = 0; c < SEATS; c++) {
        const t = (c - (SEATS - 1) / 2) * SEAT_W;
        const sx = dx + tx * t, sz = dz + tz * t;
        // seat
        M.compose(new THREE.Vector3(sx, up + 0.32, sz), q, one);
        seatIM.setMatrixAt(si, M);
        // fan sitting in it (deterministic-ish gap: ~12% empty seats read as real)
        const occupied = ((r * 31 + c * 17) % 8) !== 0;
        if (occupied) {
          M.compose(new THREE.Vector3(sx, up + 0.85, sz), q, one);
          fanIM.setMatrixAt(si, M);
          col.setHex(FAN_COLORS[(r * 7 + c * 3) % FAN_COLORS.length]);
        } else {
          M.compose(new THREE.Vector3(sx, -50, sz), q, one); // park empties below
          fanIM.setMatrixAt(si, M);
          col.setHex(0x000000);
        }
        fanIM.setColorAt(si, col);
        si++;
      }
    }
    seatIM.instanceMatrix.needsUpdate = true;
    fanIM.instanceMatrix.needsUpdate = true;
    if (fanIM.instanceColor) fanIM.instanceColor.needsUpdate = true;
    root.add(seatIM);
    root.add(fanIM);

    // back wall / grandstand structure with support columns + a roof canopy
    const topUp = 1.2 + ROWS * TIER_RISE;
    const topBack = 2 + ROWS * TIER_DEPTH;
    const bwx = baseX + nx * (topBack + 0.5), bwz = baseZ + nz * (topBack + 0.5);
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(standLen + 4, topUp + 1, 0.6), mat(P.C_STEEL));
    backWall.position.set(bwx, (topUp + 1) / 2, bwz); backWall.rotation.y = standHeading;
    root.add(backWall);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(standLen + 4, 0.3, topBack + 3), mat(0x3c4047));
    canopy.position.set((baseX + bwx) / 2, topUp + 2.5, (baseZ + bwz) / 2);
    canopy.rotation.y = standHeading;
    root.add(canopy);
  }

  // ====================================================================== //
  //  PYLON + FLOODLIGHTS                                                    //
  // ====================================================================== //
  function buildPylonAndLights(root, mat, frame, rng) {
    // scoring pylon in the infield near the front straight
    const fc = frame(0);
    const px = fc.x - fc.nx * 40, pz = fc.z - fc.nz * 40;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(3, 26, 3), mat(0x23262b));
    tower.position.set(px, 13, pz); root.add(tower);
    // leaderboard faces (emissive panels) up the pylon
    for (let i = 0; i < 6; i++) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.4, 0.2), mat(0x101418, { emissive: 0x2e5a8a, ei: 0.6 }));
      panel.position.set(px, 4 + i * 3.4, pz + 1.6); root.add(panel);
    }
    const cap = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2, 4.5), mat(0xc23a36, { emissive: 0xc23a36, ei: 0.4 }));
    cap.position.set(px, 27, pz); root.add(cap);
    if (CBZ.makeLabelSprite) {
      const lab = CBZ.makeLabelSprite("SPEEDWAY", { color: "#ffd451" });
      lab.scale.set(8, 2, 1); lab.position.set(px, 30, pz); root.add(lab);
    }

    // floodlight masts ringing the oval
    const mastGeo = new THREE.CylinderGeometry(0.5, 0.7, 30, 6);
    const headGeo = new THREE.BoxGeometry(6, 2, 1.2);
    const mastMat = mat(0x6a6d72), lampMat = mat(0xeef2f6, { emissive: 0xfff4d0, ei: 0.7 });
    for (let i = 0; i < 8; i++) {
      const f = frame(i / 8);
      const mx = f.x + f.nx * 26, mz = f.z + f.nz * 26;
      const mast = new THREE.Mesh(mastGeo, mastMat); mast.position.set(mx, 15, mz); root.add(mast);
      const head = new THREE.Mesh(headGeo, lampMat);
      head.position.set(mx, 30, mz);
      head.lookAt(f.x, 30, f.z);
      root.add(head);
    }
  }

  // ====================================================================== //
  //  CAUSEWAY                                                               //
  // ====================================================================== //
  function buildCauseway(root, mat, P, rng) {
    // REAL HIGHWAY: an L-shaped wide multi-lane causeway over the water from
    // the commerce annex (south) up + across to the speedway island. Uses the
    // shared CBZ.buildHighway builder (merged deck + baked lanes + instanced
    // guardrails/lights + continuous curb colliders). Falls back to the old
    // bespoke deck if the builder isn't present.
    if (CBZ.buildHighway) {
      CBZ.buildHighway(root, {
        path: [{ x: 348, z: -585 }, { x: 348, z: -447 }, { x: 470, z: -447 }],
        width: 24, lanesPerDir: 2, laneW: 3.6, theme: "asphalt",
        guardrail: true, lights: true, elevated: false, rng: rng,
      });
      return;
    }
    // ---- fallback: bespoke L-shaped deck (only if buildHighway absent) ----
    // L-shaped deck: vertical leg (annex north edge → up), horizontal leg (→ island).
    const deckMat = mat(P.C_DECK), curbMat = mat(P.C_CURB);
    function deck(cx, cz, w, d) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, d), deckMat);
      m.position.set(cx, 0.2, cz); m.receiveShadow = true; root.add(m);
      return m;
    }
    function curbPair(cx, cz, w, d, horizontal) {
      // two low curbs (colliders) flanking the deck so you stay on the bridge
      const t = 0.5, h = 0.7;
      if (horizontal) {
        for (const sgn of [-1, 1]) {
          const z = cz + sgn * (d / 2 - t / 2);
          const c = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), curbMat);
          c.position.set(cx, 0.55, z); root.add(c);
          CBZ.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: z - t / 2, maxZ: z + t / 2, y0: 0.2, y1: 0.2 + h });
        }
      } else {
        for (const sgn of [-1, 1]) {
          const x = cx + sgn * (w / 2 - t / 2);
          const c = new THREE.Mesh(new THREE.BoxGeometry(t, h, d), curbMat);
          c.position.set(x, 0.55, cz); root.add(c);
          CBZ.colliders.push({ minX: x - t / 2, maxX: x + t / 2, minZ: cz - d / 2, maxZ: cz + d / 2, y0: 0.2, y1: 0.2 + h });
        }
      }
    }
    // vertical leg: x≈348, from annex north (z≈-585) up to z≈-447
    deck(348, -516, 14, 142);
    curbPair(348, -516, 14, 142, false);
    // horizontal leg: z≈-447, from x≈348 across to x≈470 (island south)
    deck(409, -447, 136, 14);
    curbPair(409, -447, 136, 14, true);
    // pylons under the deck (visual support over water)
    const pyMat = mat(P.C_STEEL);
    for (let z = -575; z <= -460; z += 24) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 12, 1.2), pyMat); p.position.set(348, -5.5, z); root.add(p);
    }
    for (let x = 360; x <= 460; x += 24) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 12, 1.2), pyMat); p.position.set(x, -5.5, -447); root.add(p);
    }
  }

  // ====================================================================== //
  //  MOTORSPORTS COMPLEX (buildings)                                        //
  // ====================================================================== //
  function buildComplex(root, rng) {
    const MB = CBZ.cityMakeBuilding;
    if (!MB) return;
    const ang = (deg) => (deg * Math.PI / 180);

    // place buildings around the OUTER ring of the island, facing the track.
    function placeAt(deg, dist, w, d, storeys, color, opts) {
      const a = ang(deg);
      const ox = CX + Math.cos(a) * dist, oz = CZ + Math.sin(a) * dist;
      const b = MB(root, ox, oz, w, d, storeys, color, 2, opts || {});
      // face the building's group toward track centre
      if (b && b.group) b.group.rotation.y = Math.atan2(CX - ox, CZ - oz);
      return b;
    }

    // --- THE GRAND AUTO SHOWROOM: every car the city sells, floor by floor ---
    const showroom = placeAt(-90, 178, 38, 26, 4, 0x2a3340, { showroom: true, retail: true, stairs: true });
    fillShowroom(showroom);

    // --- team garage (working bays) ---
    placeAt(-140, 176, 30, 20, 2, 0x394049, { retail: true });
    // --- trophy hall (why you race) ---
    const trophy = placeAt(-40, 178, 24, 18, 2, 0x3a3340, { retail: true });
    fillTrophyHall(trophy);
    // --- trackside sports bar ---
    placeAt(160, 184, 22, 16, 2, 0x40342c, { retail: true });
    // --- registration / ticket office near the causeway entry (south) ---
    placeAt(90, 188, 18, 14, 1, 0x36404a, { retail: true });
  }

  function fillShowroom(b) {
    if (!b || !b.group) return;
    const CARS = (CBZ.cityEcon && CBZ.cityEcon.CARS) || [];
    const buildVis = CBZ.cityBuildPlayerCarVisual, infer = CBZ.cityInferCarStyle;
    if (!buildVis || !CARS.length) return;
    const FH = b.FH || 4.0;
    const w = b.w, d = b.d;
    // interior usable bounds (inset from walls)
    const ixMax = w / 2 - 2.2, izMax = d / 2 - 2.2;
    const padMat = (CBZ.cmat || CBZ.mat)(0x1b1e22, { emissive: 0x2e5a8a, ei: 0.18 });
    // lay out cars on a grid across floors so every floor is FULL of cars
    const perRow = Math.max(2, Math.floor((ixMax * 2) / 6));   // ~6m spacing
    const rowsPerFloor = Math.max(2, Math.floor((izMax * 2) / 5));
    const perFloor = perRow * rowsPerFloor;
    const storeys = Math.max(1, Math.min(b.storeys || 4, Math.ceil(CARS.length / perFloor)));
    let ci = 0;
    for (let fl = 0; fl < storeys && ci < CARS.length; fl++) {
      const fy = fl * FH + 0.15;     // floor slab top is at L*FH-0.1; sit pads just above
      for (let rz = 0; rz < rowsPerFloor && ci < CARS.length; rz++) {
        for (let rx = 0; rx < perRow && ci < CARS.length; rx++) {
          const model = CARS[ci++];
          const x = -ixMax + 2 + rx * ((ixMax * 2 - 4) / Math.max(1, perRow - 1));
          const z = -izMax + 2 + rz * ((izMax * 2 - 4) / Math.max(1, rowsPerFloor - 1));
          // display pad
          const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.12, 16), padMat);
          pad.position.set(x, fy + 0.06, z); b.group.add(pad);
          // the car visual, painted in its catalog colour
          let vis = null;
          try {
            const style = (infer && infer(model)) || model.detailStyle || "muscle";
            vis = buildVis(style, model.color);
          } catch (e) { vis = null; }
          if (vis) {
            vis.position.set(x, fy + 0.12, z);
            vis.rotation.y = (ci * 0.7) % (Math.PI * 2);
            const sc = (0.9 + (model.s || 1) * 0.0); vis.scale.multiplyScalar(sc);
            b.group.add(vis);
          }
          if (CBZ.makeLabelSprite) {
            const lab = CBZ.makeLabelSprite(model.name + " · $" + fmt(model.value), { color: "#eef4ff" });
            lab.scale.set(4.5, 1.1, 1);
            lab.position.set(x, fy + 1.9, z);
            b.group.add(lab);
          }
        }
      }
    }
  }

  function fillTrophyHall(b) {
    if (!b || !b.group) return;
    const FH = b.FH || 4.0;
    const goldMat = (CBZ.cmat || CBZ.mat)(0xe0b53a, { emissive: 0xe0b53a, ei: 0.25 });
    const baseMat = (CBZ.cmat || CBZ.mat)(0x2a2d33);
    const ixMax = b.w / 2 - 2.5;
    for (let fl = 0; fl < (b.storeys || 2); fl++) {
      const fy = fl * FH + 0.15;
      for (let i = 0; i < 5; i++) {
        const x = -ixMax + 1 + i * ((ixMax * 2 - 2) / 4);
        const z = -b.d / 2 + 2;
        const ped = new THREE.Mesh(new THREE.BoxGeometry(1, 1.1, 1), baseMat);
        ped.position.set(x, fy + 0.55, z); b.group.add(ped);
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.2, 0.9, 10), goldMat);
        cup.position.set(x, fy + 1.55, z); b.group.add(cup);
      }
    }
  }

  function fmt(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
    return String(n);
  }

  // ====================================================================== //
  //  POPULATE                                                              //
  // ====================================================================== //
  function populate(root, rng, city) {
    const makePed = CBZ.cityMakePed;
    // a handful of LIVE interactive peds on the concourse (perf: keep it small —
    // the big crowd is the instanced grandstand)
    if (makePed) {
      // concourse fans on the OUTER ring only (radius 165..192) — clear of the
      // oval racing surface (which spans ~150m in X from centre).
      for (let i = 0; i < 14; i++) {
        const a = rng() * Math.PI * 2, rr = 165 + rng() * 27;
        const px = CX + Math.cos(a) * rr, pz = CZ + Math.sin(a) * rr;
        try { makePed(px, pz, rng, { kind: "civilian", job: "race fan" }); } catch (e) { /* headless */ }
      }
      // pit crew near pit road
      const fc = ovalFrame(0);
      const px = fc.x - fc.nx * (TRACK_W / 2 + 5), pz = fc.z - fc.nz * (TRACK_W / 2 + 5);
      for (let i = 0; i < 5; i++) {
        try { makePed(px + (i - 2) * 6 * fc.tx, pz + (i - 2) * 6 * fc.tz, rng, { kind: "worker", job: "pit crew" }); } catch (e) { /* */ }
      }
    }
    // a few parked cars in a lot near the showroom (south-ish exterior)
    if (CBZ.cityMakeCar && CBZ.cityEcon && CBZ.cityEcon.CARS) {
      const CARS = CBZ.cityEcon.CARS;
      for (let i = 0; i < 6; i++) {
        const a = (-90 + (i - 2.5) * 7) * Math.PI / 180;
        const x = CX + Math.cos(a) * 160, z = CZ + Math.sin(a) * 160;
        const model = CARS[(rng() * CARS.length) | 0];
        try { CBZ.cityMakeCar(x, z, a + Math.PI, false, model, 0.1); } catch (e) { /* */ }
      }
    }
  }

  // ====================================================================== //
  //  THE RACE — zone interaction + procedural AI field + lap timer          //
  // ====================================================================== //
  const RACE = {
    active: false, lap: 0, laps: 3, t0: 0,
    playerLastT: 0, playerProg: 0, playerLaps: 0,
    racers: [],         // {group, t, speed, place, laps, lastT, racer}
    checks: 0, lastCross: false, label: null,
  };
  const LAP_PURSE = 7500;       // per finishing-position-scaled payout base
  const FIELD_N = 5;            // AI opponents on the grid

  function ovalFrame(t) { // local alias usable by zone/tick (defined again for closure scope)
    return CBZ_FRAME(t);
  }
  // bind the same parametric frame used by the builder (kept identical)
  function CBZ_FRAME(t) {
    const a = t * Math.PI * 2;
    let x = CX + Math.cos(a) * OVAL_RX;
    let z = CZ + Math.sin(a) * OVAL_RZ;
    const front = Math.max(0, Math.sin(a));
    z += front * front * TRIBULGE;
    const a2 = (t + 0.0015) * Math.PI * 2;
    let x2 = CX + Math.cos(a2) * OVAL_RX, z2 = CZ + Math.sin(a2) * OVAL_RZ;
    z2 += Math.max(0, Math.sin(a2)) * Math.max(0, Math.sin(a2)) * TRIBULGE;
    const dx = x2 - x, dz = z2 - z, len = Math.hypot(dx, dz) || 1;
    const tx = dx / len, tz = dz / len;
    return { x, z, tx, tz, nx: -tz, nz: tx, heading: Math.atan2(tx, tz) };
  }

  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s || 2.2); }

  function startRace() {
    if (RACE.active) { note("You're already racing!", 1.5); return; }
    const P = CBZ.player;
    if (!P || !P.driving) { note("Get in a car to race.", 1.8); return; }
    RACE.active = true; RACE.laps = 3;
    RACE.playerLaps = 0; RACE.playerProg = 0; RACE.t0 = Date.now() / 1000;
    RACE.lastCross = false;
    // place the player at the S/F line param ~0 (param the player rolls through)
    RACE.playerLastT = paramAt(P.pos.x, P.pos.z);

    // === BUILD THE AI FIELD FROM THE CHAMPIONSHIP (racing.js) ===
    // Each opponent is a TOP-N ranked driver, in their TEAM-COLOURED, NUMBERED
    // car — built via cityBuildPlayerCarVisual(homeStyle, teamColor, liveryFor)
    // so the number on track matches the name on the standings board. Falls back
    // to the old fast-CARS field if racing.js isn't loaded (headless / partial).
    RACE.racers.length = 0;
    const RC = CBZ.cityRacing;
    const buildVis = CBZ.cityBuildPlayerCarVisual, infer = CBZ.cityInferCarStyle;
    const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    let field = [];
    if (RC && RC.standings) {
      // top FIELD_N by current standing are the ones you have to beat
      field = RC.standings().slice(0, FIELD_N).map((racer) => ({ racer: racer }));
    }
    if (!field.length) {
      // legacy fallback — fast cars, no roster
      const CARS = (CBZ.cityEcon && CBZ.cityEcon.CARS) || [];
      const fast = CARS.filter((c) => /muscle|coupe/.test(c.body || "") && (c.value || 0) >= 17000);
      for (let i = 0; i < FIELD_N; i++) {
        const model = fast.length ? fast[i % fast.length] : (CARS[CARS.length - 1 - i] || CARS[0]);
        field.push({ model: model });
      }
    }
    for (let i = 0; i < field.length; i++) {
      const ent = field[i];
      const racer = ent.racer || null;
      const model = ent.model || null;
      let vis = null, baseSpeed = 38 + i * 1.2;
      try {
        if (racer) {
          // liveried, numbered opponent. Skill biases its base pace.
          baseSpeed = 36 + (racer.skill || 0.8) * 12;     // 45..48 for the aces
          vis = buildVis ? buildVis(racer.homeStyle || "muscle", racer.teamColor, RC.liveryFor(racer)) : null;
        } else {
          const style = (infer && infer(model)) || (model && model.detailStyle) || "muscle";
          vis = buildVis ? buildVis(style, model && model.color) : null;
        }
      } catch (e) { vis = null; }
      if (!vis) { vis = new THREE.Group(); }
      // stagger the grid behind the S/F line
      const startT = (1 - (i + 1) * 0.012 + 1) % 1;
      const f = CBZ_FRAME(startT);
      const lane = (i % 2 === 0 ? 1 : -1) * 2.2;
      vis.position.set(f.x + f.nx * lane, 0.0, f.z + f.nz * lane);
      vis.rotation.y = f.heading;
      if (root) root.add(vis); else if (CBZ.city && CBZ.city.root) CBZ.city.root.add(vis);
      RACE.racers.push({
        group: vis, t: startT, lane,
        base: baseSpeed,                                   // baseline pace (rubber-band target rides this)
        speed: baseSpeed, cur: 18, laps: 0, lastT: startT,
        racer: racer,
        name: racer ? (racer.name + " #" + racer.number) : ((model && model.name) || "Rival"),
        skill: racer ? (racer.skill || 0.8) : 0.8,
        place: i + 2,
      });
    }
    if (!RACE.label && CBZ.makeLabelSprite) {
      RACE.label = CBZ.makeLabelSprite("LAP 1/3", { color: "#ffd451" });
      RACE.label.scale.set(6, 1.5, 1);
    }
    const rnd = RC ? (RC.round + 1) : 1, seas = RC ? RC.season : 1;
    note("GREEN FLAG! Round " + rnd + " · 3 laps — beat the field!", 2.8);
  }
  // export the join flow so racing.js's "challenge to a race" can drop the flag.
  CBZ.cityStartSpeedwayRace = startRace;

  // approximate centreline parameter nearest to a world point (coarse search)
  function paramAt(x, z) {
    let best = 0, bd = 1e9;
    for (let i = 0; i < 64; i++) {
      const t = i / 64, f = CBZ_FRAME(t);
      const d = (x - f.x) * (x - f.x) + (z - f.z) * (z - f.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  // dispose a liveried AI car visual the same way it was added — it carries
  // _playerCarOwned cloned paint, so detach + drop the cloned material (shared
  // geo/accents are flagged _shared and survive). Mirrors playercars cleanup.
  function disposeFieldCar(grp) {
    if (!grp) return;
    if (grp.parent) grp.parent.remove(grp);
    grp.traverse(function (o) {
      const m = o.material;
      if (m && !Array.isArray(m) && m._playerCarOwned && m.dispose) m.dispose();
    });
  }

  function endRace(playerPlace) {
    RACE.active = false;
    const RC = CBZ.cityRacing;

    // === CHAMPIONSHIP RESULTS ===
    // build the finishing order: every AI by total progress + the player slotted
    // at playerPlace, then award descending points to the ranked racers + bump the
    // round. Player at place 1 means every AI shifts down one — the array order IS
    // the finishing order, and awardRace skips the player (no roster match).
    if (RC && RC.awardRace) {
      const ranked = RACE.racers.slice().filter((r) => r.racer)
        .sort((a, b) => (b.laps + b.t) - (a.laps + a.t));
      // splice the player into the order at (playerPlace-1)
      const order = [];
      let ri2 = 0;
      for (let pos = 1; pos <= ranked.length + 1; pos++) {
        if (pos === playerPlace) order.push({ player: true });
        else if (ri2 < ranked.length) order.push(ranked[ri2++].racer);
      }
      // any AI not yet placed (player was beyond the field) tack on the end
      while (ri2 < ranked.length) order.push(ranked[ri2++].racer);
      RC.awardRace(order);
      RC.bumpRound();
    }

    // remove AI cars (dispose their cloned livery materials)
    for (const r of RACE.racers) { disposeFieldCar(r.group); }
    RACE.racers.length = 0;
    if (RACE.label && RACE.label.parent) RACE.label.parent.remove(RACE.label);

    // purse scales with finishing position AND the round (a championship pays more
    // as the season builds toward the finale).
    const roundMul = RC ? (1 + RC.round * 0.10) : 1;
    const purse = Math.max(500, Math.round(LAP_PURSE * (7 - playerPlace) / 6 * (RACE.laps) * roundMul));
    // E10: the purse used to be printed money — now it's sponsorship spend the
    // two manufacturer treasuries actually fund (sim/motorsport.js's
    // paySponsorship, which also cuts the winning driver's fame bonus off this
    // same purse). Guarded fallback keeps this working headless / pre-E10.
    if (CBZ.motorsport && CBZ.motorsport.paySponsorship) CBZ.motorsport.paySponsorship(purse);
    else if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(purse);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(playerPlace <= 1 ? 12 : playerPlace <= 3 ? 5 : 1);
    const ptsGained = pointsForPlace(playerPlace);
    const ord = playerPlace === 1 ? "1st — CHECKERED FLAG!" : playerPlace === 2 ? "2nd" : playerPlace === 3 ? "3rd" : playerPlace + "th";
    note("FINISH: " + ord + "  +$" + fmt(purse) + (RC ? "  ·  +" + ptsGained + " champ pts" : ""), 4.2);

    // SEASON FINALE: if the round just wrapped back to 0, crown the champion.
    if (RC && RC.round === 0 && RC.standings) {
      const champ = RC.standings()[0];
      if (champ) {
        const banner = "🏆 SEASON " + (RC.season - 1) + " CHAMPION: " + champ.name + " #" + champ.number +
          " (" + champ.points + " pts, " + champ.wins + " wins)";
        if (CBZ.city && CBZ.city.big) CBZ.city.big(banner); else note(banner, 4.5);
      }
    }
  }

  // F1/NASCAR descending points (mirror racing.js so the player's gain reads right
  // even when racing.js is absent).
  const _POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
  function pointsForPlace(place) {
    const i = (place | 0) - 1;
    if (i < 0) return 0;
    return i < _POINTS.length ? _POINTS[i] : 1;
  }

  // ---- the live race tick --------------------------------------------------
  CBZ.onUpdate(34.5, function (dt) {
    if (g.mode !== "city") return;
    if (g.state && g.state !== "playing") return;
    if (!RACE.active) return;
    const P = CBZ.player;
    if (!P || !P.driving) { endRace(6); return; }   // bailed out of the car

    const total = RACE.laps;
    const circ = Math.PI * (OVAL_RX + OVAL_RZ); // ~perimeter estimate

    // player progress FIRST (one paramAt/frame) — lap counting at the S/F crossing
    // AND the rubber-band reference for the AI field below.
    const pt = paramAt(P.pos.x, P.pos.z);
    if (RACE.playerLastT > 0.85 && pt < 0.15) RACE.playerLaps++;
    RACE.playerLastT = pt;
    const playerTotal = RACE.playerLaps + pt;

    // advance AI racers along the centreline (rubber-banded to the player)
    for (const r of RACE.racers) {
      // === RUBBER-BANDING (hybrid speed+skill, GameAIPro Ch.42) ===
      // target = base * skillBias * gapMod, where gapMod eases racers AHEAD of the
      // player slower and racers BEHIND faster (a rubber band that keeps the race
      // close + fair), clamped so the AI can never teleport. Then ease cur→target.
      const rt0 = r.laps + r.t;
      const gap = rt0 - playerTotal;                  // +ahead of player, −behind
      // gapMod: ~1.06 when far behind → ~0.95 when far ahead (smooth, bounded).
      const gapMod = 1.01 - Math.max(-0.11, Math.min(0.10, gap * 0.55));
      const skillBias = 0.92 + (r.skill || 0.8) * 0.16;   // 0.92..1.05 by skill
      let target = (r.base || r.speed) * skillBias * gapMod;
      target = Math.max(22, Math.min(56, target));    // hard clamp: stays fair, no teleport
      r.speed = target;
      r.cur += (target - r.cur) * Math.min(1, dt * 1.5);
      const dtp = (r.cur * dt) / circ;
      const prevT = r.t;
      r.t = (r.t + dtp) % 1;
      if (prevT > 0.85 && r.t < 0.15) r.laps++;     // crossed S/F
      const f = CBZ_FRAME(r.t);
      if (r.group) {
        r.group.position.set(f.x + f.nx * r.lane, 0.0, f.z + f.nz * r.lane);
        r.group.rotation.y = f.heading;
      }
    }

    // compute place: count racers whose total progress beats the player
    let place = 1;
    for (const r of RACE.racers) {
      const rt = r.laps + r.t;
      if (rt > playerTotal + 0.002) place++;
    }

    // HUD label floating ahead of the player
    if (RACE.label) {
      if (!RACE.label.parent) {
        const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || (CBZ.city && CBZ.city.root);
        if (root) root.add(RACE.label);
      }
      RACE.label.position.set(P.pos.x, 6.5, P.pos.z);
      const _rc = CBZ.cityRacing;
      const rndTag = _rc ? "R" + (_rc.round + 1) + " · " : "";
      const txt = rndTag + "LAP " + Math.min(total, RACE.playerLaps + 1) + "/" + total + "  P" + place;
      if (RACE.label._txt !== txt && CBZ.makeLabelSprite) {
        const nl = CBZ.makeLabelSprite(txt, { color: place === 1 ? "#3ba24a" : "#ffd451" });
        RACE.label.material = nl.material; RACE.label._txt = txt;
      }
    }

    // finish: player completed all laps
    if (RACE.playerLaps >= total) { endRace(place); return; }
    // DNF guard: racers all done + player hopelessly behind → still let them finish
  });

  // ====================================================================== //
  //  CHAMPIONSHIP STANDINGS OVERLAY                                         //
  //  A read-only table of CBZ.cityRacing.standings() — rank/name/#/pts/wins //
  //  so "View championship standings" at the line shows the season table.   //
  // ====================================================================== //
  let standEl = null, standOpen = false;
  function standOverlay() {
    if (standEl) return standEl;
    standEl = document.createElement("div");
    standEl.id = "speedwayStandings";
    standEl.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:48;display:none;width:min(560px,92vw);max-height:84vh;overflow:auto;background:rgba(12,14,20,.97);border:2px solid #2c3140;border-radius:12px;padding:14px 18px;box-sizing:border-box;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 14px 44px rgba(0,0,0,.6)";
    document.body.appendChild(standEl);
    return standEl;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[<>&]/g, (c) => c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"); }
  function hex6(n) { return "#" + ("000000" + ((n >>> 0).toString(16))).slice(-6); }
  function renderStandings() {
    const el = standOverlay();
    const RC = CBZ.cityRacing;
    if (!RC || !RC.standings) { el.innerHTML = "<div style='font-size:13px;color:#8a93a3'>Championship not loaded.</div>"; return; }
    const rows = RC.standings();
    const cols = "26px 26px 1.4fr 70px 56px 74px";
    let h = "<div style='display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px'>" +
      "<div style='font-size:18px;font-weight:700'>🏁 Championship</div>" +
      "<div style='font-size:12px;color:#8a93a3'>Season " + RC.season + " · Round " + (RC.round + 1) + "/" + RC.ROUNDS + "</div></div>";
    h += "<div style='display:grid;grid-template-columns:" + cols + ";gap:6px;font-size:10px;color:#8a93a3;border-bottom:1px solid #2c3140;padding-bottom:2px;margin-bottom:2px'>" +
      "<span>#</span><span>No</span><span>Driver</span><span style='text-align:right'>Points</span><span style='text-align:right'>Wins</span><span style='text-align:right'>Worth</span></div>";
    rows.forEach(function (r, i) {
      const worth = RC.netWorthOf ? RC.netWorthOf(r) : 0;
      const wtxt = worth >= 1e6 ? "$" + (worth / 1e6).toFixed(1) + "M" : "$" + Math.round(worth / 1000) + "k";
      h += "<div style='display:grid;grid-template-columns:" + cols + ";gap:6px;align-items:center;font-size:13px;padding:2px 4px'>" +
        "<span style='color:" + (i === 0 ? "#ffd166" : "#8a93a3") + ";font-weight:" + (i === 0 ? "700" : "400") + "'>" + (i + 1) + "</span>" +
        "<span style='display:inline-block;text-align:center;font-weight:700;color:" + hex6(r.teamColor) + "'>" + r.number + "</span>" +
        "<span style='white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>" + esc(r.name) + "</span>" +
        "<span style='text-align:right;color:#7ed957;font-weight:700'>" + r.points + "</span>" +
        "<span style='text-align:right;color:#9fe6c8'>" + r.wins + "</span>" +
        "<span style='text-align:right;color:#aeb6c2'>" + wtxt + "</span>" +
        "</div>";
    });
    h += "<div style='font-size:11px;color:#6b7480;margin-top:8px;border-top:1px solid #2c3140;padding-top:6px'>Win rounds to climb · Esc closes</div>";
    el.innerHTML = h;
  }
  function toggleStandings(force) {
    standOpen = force != null ? force : !standOpen;
    if (standOpen) { renderStandings(); standOverlay().style.display = "block"; }
    else if (standEl) standEl.style.display = "none";
  }
  CBZ.cityShowChampionship = toggleStandings;
  if (typeof addEventListener !== "undefined") {
    addEventListener("keydown", function (e) {
      if (g.mode !== "city") return;
      if (e.key === "Escape" && standOpen) { e.preventDefault(); toggleStandings(false); }
    });
  }

  // ---- the START/FINISH zone: "JOIN THE RACE" (driving) + "View standings" --
  if (CBZ.interactions && CBZ.interactions.registerZone) {
    const I = CBZ.interactions;
    const ZREACH = 16;
    I.registerZone({
      id: "zone-speedway-race", kind: "speedway", prio: 9, driving: true,
      find: function (px, pz) {
        const f = CBZ_FRAME(0);
        if (Math.hypot(px - f.x, pz - f.z) > ZREACH) return null;
        if (!RACE._zt) RACE._zt = { x: f.x, z: f.z };
        return RACE._zt;
      },
      options: [{
        id: "speedway-join", slot: "i",
        label: function () { return RACE.active ? "Racing — finish your laps" : "🏁 JOIN THE RACE"; },
        onSelect: function () { if (!RACE.active) startRace(); },
      }, {
        id: "speedway-standings", slot: "e",
        label: function () { return "🏆 View championship standings"; },
        onSelect: function () { toggleStandings(true); },
      }],
    });
    // a SECOND zone so you can check the board ON FOOT too (the join zone is
    // driving-only). Same line, lower prio so the driving join wins in a car.
    I.registerZone({
      id: "zone-speedway-board", kind: "speedway-board", prio: 6,
      find: function (px, pz) {
        const f = CBZ_FRAME(0);
        if (Math.hypot(px - f.x, pz - f.z) > ZREACH + 4) return null;
        if (!RACE._zb) RACE._zb = { x: f.x, z: f.z };
        return RACE._zb;
      },
      options: [{
        id: "speedway-board-view", slot: "e",
        label: function () { return "🏆 Championship standings"; },
        onSelect: function () { toggleStandings(true); },
      }],
    });
    if (I.describe) {
      I.describe("speedway", function () {
        return { label: "🏁 Start / Finish", note: RACE.active ? "On track · " + RACE.laps + " laps" : "Pull up to the line · 3-lap purse" };
      });
      I.describe("speedway-board", function () {
        const RC = CBZ.cityRacing;
        return { label: "🏆 Championship", note: RC ? "Season " + RC.season + " · Round " + (RC.round + 1) + "/" + RC.ROUNDS : "Race standings" };
      });
    }
  }
})();
