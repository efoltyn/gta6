/* ============================================================
   world/clutter.js — Yard clutter & puddles.
   Load-time only: scatters grounded detail props around the yard
   to sell a lived-in prison exercise yard — trash bags, blown
   scraps of paper, a couple of wooden benches against the walls,
   dark semi-transparent puddles, cone markers, and a laundry line
   strung along the east wall with cloth hanging off it.

   NO-DECOY FIX: trashBag / scrap / cone used to be fully pass-through —
   zero collider, so they were pure visual noise a body or a car ghosted
   straight through. They now carry a light `solid` collider (the exact
   pattern the benches below already use: `addBox(..., {solid:true})`),
   sized to each prop's real footprint — a bag or a cone is trivially
   small, so it reads as "something's there" without acting like a wall.
   puddle stays non-solid on purpose: it's a flat ground decal, not a 3D
   obstacle, and giving it a collider would make you bump into a stain.

   Only the benches are BIG solid cover (hide behind / get stopped by
   them); the small clutter above is collidable but easy to shoulder past.
   Everything is placed once at startup — no per-frame work — so it stays
   cheap on phones. Placement uses Math.random() with rejection sampling
   to avoid the central walkway, the spawn/cell area, and the three
   indoor room footprints.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.addBox || !CBZ.scene) return;
  const { addBox, mat } = CBZ;
  const scene = CBZ.prisonRoot || CBZ.scene;

  // --- keep-out zones (axis-aligned rects in x/z) -------------------
  // We reject any candidate prop centre that lands inside these, plus a
  // little padding so props never visually clip into walls/rooms/paths.
  const ZONES = [
    { minX: -3, maxX: 3, minZ: -8, maxZ: 52 },   // central walkway
    { minX: -30, maxX: 30, minZ: -44, maxZ: -6 }, // spawn / cell area (z<-6)
    { minX: 18, maxX: 30, minZ: -7, maxZ: 9 },    // armory  x[19,29] z[-6,8] (+pad)
    { minX: 18, maxX: 30, minZ: 29, maxZ: 45 },   // lounge  x[19,29] z[30,44] (+pad)
    { minX: -30, maxX: -18, minZ: 5, maxZ: 23 },  // cafeteria x[-29,-19] z[6,22] (+pad)
    { minX: -5, maxX: 5, minZ: 49, maxZ: 53 },    // exit gap mouth
  ];
  // existing flavour props (hoop, picnic table, barrels) + crate cover —
  // a coarse blocklist so new clutter doesn't pile on top of them.
  const OBSTACLES = [
    { x: -28, z: 14, r: 2.2 },  // basketball hoop
    { x: 18, z: 30, r: 2.4 },   // picnic table
    { x: -19.6, z: 44, r: 2.4 },// barrel cluster
    { x: -9, z: 22, r: 2.2 }, { x: 8, z: 28, r: 2.2 },
    { x: -12, z: 36, r: 2.2 }, { x: 11, z: 17, r: 2.2 }, { x: 0, z: 11, r: 2.0 },
  ];

  function inZones(x, z, pad) {
    pad = pad || 0;
    for (let i = 0; i < ZONES.length; i++) {
      const Z = ZONES[i];
      if (x > Z.minX - pad && x < Z.maxX + pad && z > Z.minZ - pad && z < Z.maxZ + pad) return true;
    }
    return false;
  }
  function nearObstacle(x, z, extra) {
    for (let i = 0; i < OBSTACLES.length; i++) {
      const o = OBSTACLES[i];
      const dx = x - o.x, dz = z - o.z, rr = o.r + (extra || 0);
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  }

  // placed[] tracks everything we drop so pieces don't overlap each other.
  const placed = [];
  function nearPlaced(x, z, gap) {
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      const dx = x - p.x, dz = z - p.z, rr = gap + p.r;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  }

  // a tiny solid collider for clutter whose visual isn't a box (bag = sphere,
  // cone = cone+bands) — same shape world/props.js pushes directly for its
  // non-box solids, so a body/car depenetrates against it exactly like any
  // other CBZ.colliders entry, with zero extra draw calls (no invisible mesh).
  function smallCollider(x, z, r, ref) {
    if (!CBZ.colliders) return;
    CBZ.colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, ref: ref || null });
  }

  // pick a free spot inside the yard; returns null if it couldn't.
  // yard x in [-30,30], z in [-8,52]; we inset to keep off the walls.
  function pickSpot(selfR, minGap) {
    minGap = minGap == null ? 1.2 : minGap;
    for (let tries = 0; tries < 30; tries++) {
      const x = -27 + Math.random() * 54;   // [-27,27]
      const z = -4 + Math.random() * 53;     // [-4,49]
      if (inZones(x, z, 0.6)) continue;
      if (nearObstacle(x, z, selfR)) continue;
      if (nearPlaced(x, z, minGap + selfR)) continue;
      placed.push({ x, z, r: selfR });
      return { x, z };
    }
    return null;
  }

  // ---- shared materials (reused so we don't churn GPU programs) ----
  const M = {
    bag: mat(0x2b2f36, { emissive: 0x070809, ei: 0.4 }),     // black trash bag
    bag2: mat(0x3a4049, { emissive: 0x0a0c10, ei: 0.3 }),    // grey bag
    tie: mat(0x1c1f24),
    paper: new THREE.MeshLambertMaterial({ color: 0xe7e2d2, side: THREE.DoubleSide }),
    paper2: new THREE.MeshLambertMaterial({ color: 0xcfc8b4, side: THREE.DoubleSide }),
    cone: mat(0xff6a1a, { emissive: 0x5a1e00, ei: 0.35 }),
  };
  // dark, glossy-looking puddle — flat translucent plane, no depth write
  // so it layers cleanly over the ground decals without z-fighting.
  const puddleMat = new THREE.MeshBasicMaterial({
    color: 0x1b2430, transparent: true, opacity: 0.5,
    side: THREE.DoubleSide, depthWrite: false,
  });

  // ---------------- trash bags ----------------
  // a bag = a squished sphere + a small cinch knot on top.
  const bagGeo = new THREE.SphereGeometry(0.45, 7, 6);
  const knotGeo = new THREE.ConeGeometry(0.16, 0.28, 6);
  function trashBag(x, z) {
    const m = Math.random() < 0.55 ? M.bag : M.bag2;
    const sx = 0.9 + Math.random() * 0.5;
    const sz = 0.9 + Math.random() * 0.5;
    const sy = 0.7 + Math.random() * 0.35;
    const body = new THREE.Mesh(bagGeo, m);
    body.position.set(x, 0.45 * sy, z);
    body.scale.set(sx, sy, sz);
    body.rotation.y = Math.random() * Math.PI;
    body.castShadow = true; body.receiveShadow = true;
    scene.add(body);
    const knot = new THREE.Mesh(knotGeo, M.tie);
    knot.position.set(x, 0.45 * sy + 0.42 * sy, z);
    knot.castShadow = false;
    scene.add(knot);
    // light collider sized to the actual squish (sx/sz) — a bag is soft and
    // small, so a foot or bumper barely notices it, but it's no longer a ghost.
    smallCollider(x, z, 0.45 * Math.max(sx, sz), body);
    // a single escaped wrapper next to ~half of them
    if (Math.random() < 0.5) scrap(x + (Math.random() - 0.5) * 1.4, z + (Math.random() - 0.5) * 1.4);
  }

  // ---------------- scattered papers / scraps ----------------
  // thin flat plane lying on the ground, random rotation. depthWrite off
  // + tiny y so it reads as a decal and never z-fights the floor.
  const scrapGeo = new THREE.PlaneGeometry(1, 1);
  function scrap(x, z) {
    const w = 0.35 + Math.random() * 0.45;
    const h = 0.3 + Math.random() * 0.4;
    const p = new THREE.Mesh(scrapGeo, Math.random() < 0.6 ? M.paper : M.paper2);
    p.position.set(x, 0.03 + Math.random() * 0.02, z);
    p.scale.set(w, h, 1);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = Math.random() * Math.PI;     // (becomes spin around up after the x-tilt)
    p.castShadow = false; p.receiveShadow = true;
    scene.add(p);
    // trivial collider — a scrap is paper-thin, but per the same convention
    // as the bag above it should register as "something's there" rather
    // than being a pure ghost like the puddle decal below.
    smallCollider(x, z, Math.max(w, h) * 0.3, p);
  }

  // ---------------- puddles ----------------
  function puddle(x, z) {
    const w = 1.4 + Math.random() * 1.8;
    const d = 1.0 + Math.random() * 1.6;
    const p = new THREE.Mesh(scrapGeo, puddleMat);
    p.position.set(x, 0.02, z);
    p.scale.set(w, d, 1);
    p.rotation.x = -Math.PI / 2;
    p.rotation.z = Math.random() * Math.PI;
    p.castShadow = false; p.receiveShadow = false;
    scene.add(p);
  }

  // ---------------- cone markers ----------------
  const coneGeo = new THREE.ConeGeometry(0.3, 0.75, 10);
  function cone(x, z) {
    const c = new THREE.Mesh(coneGeo, M.cone);
    c.position.set(x, 0.4, z);
    c.castShadow = true; c.receiveShadow = false;
    scene.add(c);
    // reflective band + flat base so it reads as a traffic cone, not a spike.
    // The base doubles as the collider (bench's own trick: opts.solid on a
    // real mesh instead of a separate invisible box) — light and small, same
    // treatment as the bag/scrap above.
    addBox(x, 0.42, z, 0.42, 0.1, 0.42, 0xf2f2f2, { cast: false });
    addBox(x, 0.04, z, 0.62, 0.08, 0.62, 0xe25c12, { cast: false, solid: true });
  }

  // ---------------- wooden benches (solid) ----------------
  // A low slatted bench placed flush to the west (x<0) or east (x>0) wall.
  // The walls run along z, so the bench's long axis is along z too and its
  // backrest sits toward the wall (backSign = +1 pushes the rest toward +x).
  // The seat box is the solid collider, so the bench is real cover.
  function bench(x, z, backSign) {
    const len = 2.6;       // length along z
    const seatH = 0.5;
    const bs = backSign || -1;
    addBox(x, seatH, z, 0.6, 0.16, len, 0xa9742f, { solid: true });                       // seat
    addBox(x + 0.24 * bs, seatH + 0.45, z, 0.1, 0.5, len, 0x8a5e2b, { cast: false });     // backrest (toward wall)
    addBox(x, seatH / 2, z - len / 2 + 0.2, 0.5, seatH, 0.16, 0x6e4a22, { cast: false }); // legs
    addBox(x, seatH / 2, z + len / 2 - 0.2, 0.5, seatH, 0.16, 0x6e4a22, { cast: false });
    addBox(x, seatH + 0.085, z, 0.18, 0.04, len + 0.04, 0x7a531f, { cast: false });       // plank groove
  }

  // ---------------- laundry line along the east wall ----------------
  // two posts + a thin sagging line box between them, with a row of
  // hanging cloth boxes (shirts/sheets) in cheerful inmate colours.
  function laundryLine() {
    const wallX = 26.5;           // just inside the east wall (wall at x=30)
    const z0 = 14, z1 = 26;       // runs the clear stretch between armory & lounge
    const top = 3.2;
    if (inZones(wallX, (z0 + z1) / 2, 0)) return; // safety: skip if it'd clip a room
    // posts
    addBox(wallX, top / 2, z0, 0.22, top, 0.22, 0x6e4a22, { solid: false });
    addBox(wallX, top / 2, z1, 0.22, top, 0.22, 0x6e4a22, { solid: false });
    // crossbeam caps
    addBox(wallX, top, z0, 0.5, 0.14, 0.5, 0x8a5e2b, { cast: false });
    addBox(wallX, top, z1, 0.5, 0.14, 0.5, 0x8a5e2b, { cast: false });
    // the line itself (thin box spanning z), set a touch below the post tops
    const lineLen = z1 - z0;
    addBox(wallX, top - 0.12, (z0 + z1) / 2, 0.05, 0.05, lineLen, 0x2c2c2c, { cast: false });
    // hanging cloth — alternating sizes/colours, gentle vertical jitter
    const clothCols = [0xd94f5c, 0x4f8fd9, 0xe8d44f, 0xe2e2e2, 0x6cc06a, 0xc06ca8];
    for (let z = z0 + 1.2, i = 0; z < z1 - 0.4; z += 1.5 + Math.random() * 0.5, i++) {
      const w = 0.8 + Math.random() * 0.5;
      const h = 1.0 + Math.random() * 0.8;
      const col = clothCols[(i * 2 + (Math.random() * 6 | 0)) % clothCols.length];
      // cloth hangs from the line downward
      addBox(wallX, top - 0.12 - h / 2, z, 0.06, h, w, col, { cast: false });
      // a darker fold line down the middle for a bit of depth
      addBox(wallX - 0.04, top - 0.12 - h / 2, z, 0.02, h, 0.05, 0x000000, { cast: false });
    }
  }

  // ============================================================
  //  Scatter pass — build the whole set (~24-30 pieces).
  // ============================================================

  // trash bags: clustered in a few loose piles near walls/corners.
  let bags = 0;
  for (let i = 0; i < 9 && bags < 7; i++) {
    const s = pickSpot(0.7, 1.0);
    if (!s) continue;
    trashBag(s.x, s.z);
    // ~40% chance of a buddy bag right beside it for a "pile" feel
    if (Math.random() < 0.45) {
      const ax = s.x + (Math.random() - 0.5) * 1.4;
      const az = s.z + (Math.random() - 0.5) * 1.4;
      if (!inZones(ax, az, 0.5) && !nearObstacle(ax, az, 0.6)) {
        trashBag(ax, az);
        placed.push({ x: ax, z: az, r: 0.6 });
      }
    }
    bags++;
  }

  // loose scraps of paper blown around the yard.
  for (let i = 0; i < 12; i++) {
    const s = pickSpot(0.3, 0.6);
    if (s) scrap(s.x, s.z);
  }

  // puddles — favour the asphalt-ish middle band but stay off the walkway.
  for (let i = 0; i < 6; i++) {
    const s = pickSpot(1.6, 1.0);
    if (s) puddle(s.x, s.z);
  }

  // cone markers — a small scatter, plus a deliberate little 3-cone line.
  for (let i = 0; i < 4; i++) {
    const s = pickSpot(0.45, 1.0);
    if (s) cone(s.x, s.z);
  }
  // a tidy row of cones cordoning a spot (only if the stretch is clear)
  (function coneRow() {
    const baseX = -22, baseZ = 32;
    if (inZones(baseX, baseZ, 0.5) || nearObstacle(baseX, baseZ, 1.0)) return;
    for (let k = 0; k < 3; k++) {
      const cx = baseX + k * 1.6, cz = baseZ;
      if (inZones(cx, cz, 0.4)) continue;
      cone(cx, cz);
      placed.push({ x: cx, z: cz, r: 0.5 });
    }
  })();

  // benches against the side walls, facing into the yard. backSign = -1
  // puts the backrest toward the wall on the west side, +1 on the east.
  bench(-28.6, 4, -1);
  placed.push({ x: -28.6, z: 4, r: 1.7 });
  bench(-28.6, 38, -1);
  placed.push({ x: -28.6, z: 38, r: 1.7 });
  bench(28.6, 20, 1);
  placed.push({ x: 28.6, z: 20, r: 1.7 });

  // the laundry line on the east wall.
  laundryLine();
})();
