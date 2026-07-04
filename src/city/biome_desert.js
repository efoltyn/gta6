/* ============================================================
   city/biome_desert.js — THE DESERT (an open archipelago biome).

   WHY THIS PLACE EXISTS (owner's why-first law):
   A city of glass towers needs an EDGE — somewhere the grid runs out
   and the land takes over. The desert is that edge: a vast, empty
   tan basin you cross to GET somewhere (the lone gas station you
   limp to when your car's dry, the motel you hole up in, the mesas
   that hide a body), not a decorated lobby. Every prop here earns
   its place by being a reason to drive out: FUEL + FOOD (gas/diner),
   SHELTER (motel), a relic worth poking at (mining outpost), and the
   HIGHWAY that strings them together back to the speedway island.

   ARCHIPELAGO CONTRACT (worldmap.js):
     CBZ.addLandmass(builder, order)  — builder gets the live `city`.
     CBZ.registerCityRegion(city, reg) — declare the walkable land.
   Footprint: rect center (1115,150), half-extents (445,470):
     minX 670  maxX 1560  minZ -320  maxZ 620  (a MASSIVE south basin).
   Causeway: a ~14-wide desert highway deck from the desert's west
   edge (~x670, z-300) to the speedway island's east edge (~x670,
   z-330, the circle center 470,-330 r200). Registered as its own
   thin walkable rect so you can drive/walk the land-bridge.

   DRAW-CALL DISCIPLINE (owner rule #4 — this biome is BIG):
   The ground/dunes/riverbed/road decks are each ONE merged
   BufferGeometry mesh (matrixAutoUpdate off). EVERY repeated scatter
   prop — dune mounds, saguaro trunks, saguaro arms, boulders, scrub
   bushes, tumbleweeds, telephone poles, bleached bones — is a single
   InstancedMesh sharing one cmat() material. Mesas + buildings are
   the only individually-placed solids (they need colliders). The
   whole biome adds on the order of ~20 draw calls, not thousands.

   Local seeded RNG → the same desert every run.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const cmat = CBZ.cmat || CBZ.mat;

  // ---- footprint (MASSIVE basin) -------------------------------------------
  // North edge stays anchored at z-320 (the causeway tuck to the speedway
  // island) and the west edge at x670 (speedway's east shore); the desert
  // sprawls EAST to the flat limit and DEEP to the south (flat maxZ was
  // pushed to 760 in terrain.js to hold it). ~1.8x the old footprint — a
  // genuinely vast empty tan basin you drive across, not a lobby.
  const CX = 1115, CZ = 150, HX = 445, HZ = 470;
  const MINX = CX - HX, MAXX = CX + HX;   // 670 .. 1560
  const MINZ = CZ - HZ, MAXZ = CZ + HZ;   // -320 .. 620

  // ---- causeway (land-bridge to the speedway island) -----------------------
  // speedway: circle center (470,-330) r200 → east edge ~ x670, z-330.
  const CW = 14;                          // road width
  const CW_Z = -300;                      // causeway centerline z
  const CW_X0 = 470 + 190;                // start just off the speedway edge (~660)
  const CW_X1 = MINX + 6;                 // tuck into the desert's west edge

  // ---- palette (warm tan basin; one shared material per color) -------------
  const SAND      = 0xd9bd86;             // warm tan ground
  const SAND_DK   = 0xc4a874;             // dune-shadow / riverbed
  const SAND_PALE = 0xe4cf9c;             // sun-bleached dune crest
  const RED_ROCK  = 0xa0522d;             // mesa sandstone
  const RED_DK    = 0x8a4423;             // mesa shadow band
  const ROCK_GREY = 0x8c7d68;             // boulders
  const CACTUS    = 0x4f7a43;             // saguaro green
  const SCRUB     = 0x8a8a4a;             // dry desert brush
  const TUMBLE    = 0x9c8a55;             // tumbleweed
  const ASPHALT   = 0x4a4742;             // faded highway
  const LINE_PALE = 0xc9bf8e;             // sun-faded center line
  const POLE      = 0x6e5436;             // creosote telephone pole
  const BONE      = 0xe9e2cf;             // bleached bone

  // ---- THE TOWN ("Dry Gulch") sub-rect ------------------------------------
  // An Old-West main-street town strung ALONG the desert highway (HWY_Z =
  // CZ-40), east-central so it clears the mesas (west/north) and the played-
  // out mine (far west). The scatter loops below SKIP anything inside this
  // rect so cacti/boulders/bones don't spawn in the streets. If CBZ.buildTown
  // is absent the rect is harmless (scatter just fills it like before) — the
  // town only appears when the foundation generator exists.
  const TOWN_CX = CX + 30, TOWN_CZ = CZ - 40;       // on the highway spine
  const TOWN_HX = 130, TOWN_HZ = 70;                // half-extents
  const TOWN = { minX: TOWN_CX - TOWN_HX, maxX: TOWN_CX + TOWN_HX, minZ: TOWN_CZ - TOWN_HZ, maxZ: TOWN_CZ + TOWN_HZ };
  const HAS_TOWN = typeof CBZ.buildTown === "function";
  function inTown(x, z) {
    return HAS_TOWN && x > TOWN.minX - 6 && x < TOWN.maxX + 6 && z > TOWN.minZ - 6 && z < TOWN.maxZ + 6;
  }

  // ---- deterministic LCG ---------------------------------------------------
  // seeded from CBZ.WORLD_SEED via the named-stream registry (core/seed.js)
  // — one world-seed knob instead of a per-file magic literal. rng() is
  // re-armed at build entry so a rebuild replays the identical stream.
  let rng = null;
  function armRng() { rng = CBZ.seedStream ? CBZ.seedStream('desert') : (function () { let s = 0x5dec7; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })(); }
  armRng();
  function rr(a, b) { return a + rng() * (b - a); }

  const BGU = THREE.BufferGeometryUtils;

  // ===========================================================================
  //  DUNE-RIPPLE SHADER (modeled on keaukraine/webgl-dunes) — applied to the
  //  basin's main sand plane below. WHY a shader instead of another static
  //  tint pass: the basin already reads as "sand-colored," but static ground
  //  never reads as SAND — the wind-carved ripple pattern is what sells grain
  //  underfoot. Ported by hand into plain GLSL strings (no bundler, no new
  //  dependency): the vertex shader dots the (flat-shaded, so effectively
  //  world-up) normal against a fixed wind direction to get a windward/
  //  leeward slope coefficient; the fragment shader scrolls TWO UV sets over
  //  time — a slow coarse ripple crest pattern and a faster fine-grain
  //  texture — blended by that coefficient so windward faces show crisper
  //  ripple crests and leeward faces blur/soften, exactly the read of sand
  //  grains migrating with the wind on a static mesh. Pure GLSL procedural
  //  stripes (sin-based) stand in for a texture map — no image asset needed,
  //  matching this repo's no-texture-dependency convention for procedural
  //  ground (see the vertex-colored apron above).
  //  ONE material, ONE mesh — this replaces the ground plane's flat cmat()
  //  with zero extra draw calls (still exactly the 1 draw call section 1
  //  budgeted for the basin plane).
  // ===========================================================================
  function makeDuneRippleMaterial(baseHex) {
    const base = new THREE.Color(baseHex == null ? SAND : baseHex);
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uWindDir: { value: new THREE.Vector2(0.86, 0.51) },  // fixed prevailing wind (normalized-ish)
        uBaseColor: { value: base },
      },
      vertexShader: [
        "varying vec2 vUv;",
        "varying float vWind;",           // windward(+1)..leeward(-1) slope coefficient
        "uniform vec2 uWindDir;",
        "void main() {",
        "  vUv = uv;",
        // world-space normal (flat ground plane: this is ~straight up, but the
        // dot product still gives a stable per-fragment coefficient so the
        // same material drops onto any dune-shaped mesh unmodified later).
        "  vec3 wn = normalize(mat3(modelMatrix) * normal);",
        "  vWind = dot(wn.xz, normalize(uWindDir));",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "precision mediump float;",
        "varying vec2 vUv;",
        "varying float vWind;",
        "uniform float uTime;",
        "uniform vec2 uWindDir;",
        "uniform vec3 uBaseColor;",
        // cheap 1D ripple stripe: a sharpened sine gives a crest/trough read
        // without a texture sample (no image asset — pure procedural GLSL).
        "float ripple(vec2 p, float freq) {",
        "  float s = sin(p.x * freq) * 0.6 + sin((p.x + p.y) * freq * 0.53) * 0.4;",
        "  return s;",
        "}",
        "void main() {",
        "  vec2 wind = normalize(uWindDir);",
        "  vec2 perp = vec2(-wind.y, wind.x);",
        // two scrolling UV sets: coarse wind-ripple crests drift SLOWLY along
        // the wind axis; a finer detail set drifts a bit faster (grain read).
        "  float alongCoarse = dot(vUv, wind) * 26.0 + uTime * 0.06;",
        "  float alongFine   = dot(vUv, wind) * 140.0 + uTime * 0.22;",
        "  float coarse = ripple(vec2(alongCoarse, dot(vUv, perp) * 26.0), 1.0);",
        "  float fine   = ripple(vec2(alongFine,   dot(vUv, perp) * 140.0), 1.0);",
        // windward/leeward blend: windward faces (vWind>0) show crisp coarse
        // ripple crests; leeward faces blend toward the soft fine grain (sand
        // sheltered from the wind reads smoother/duned-over).
        "  float w = clamp(vWind * 0.5 + 0.5, 0.0, 1.0);",
        "  float pattern = mix(fine, coarse, w);",
        "  float shade = 1.0 + pattern * 0.06;",           // subtle grain relief, not a stripe painting
        "  vec3 col = uBaseColor * shade;",
        "  gl_FragColor = vec4(col, 1.0);",
        "}",
      ].join("\n"),
    });
  }

  CBZ.addLandmass(function (city) {
    const root = (city && city.root) || (CBZ.scene);
    if (!root) return;
    armRng();
    const dummy = new THREE.Object3D();

    // ---- merge helper: many transformed geometries → ONE mesh -------------
    function mergeAdd(geoms, material, opts) {
      opts = opts || {};
      if (!geoms.length) return null;
      if (BGU && BGU.mergeBufferGeometries) {
        const merged = BGU.mergeBufferGeometries(geoms);
        const m = new THREE.Mesh(merged, material);
        m.castShadow = !!opts.cast; m.receiveShadow = opts.receive !== false;
        m.matrixAutoUpdate = false; m.updateMatrix(); root.add(m);
        return m;
      }
      // fallback (no BGU): still ONE mesh per color via individual meshes
      for (const gm of geoms) {
        const m = new THREE.Mesh(gm, material);
        m.castShadow = !!opts.cast; m.receiveShadow = opts.receive !== false;
        m.matrixAutoUpdate = false; m.updateMatrix(); root.add(m);
      }
      return null;
    }
    function plane(x, z, w, d, y) {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(x, y == null ? 0.02 : y, z);
      return g;
    }
    // a solid AABB collider (mesas + buildings you must walk around)
    function solid(x, z, w, d, y1) {
      if (!CBZ.colliders) return;
      CBZ.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y0: 0, y1: y1 == null ? 30 : y1 });
    }

    // =====================================================================
    //  0) REGIONS — declare the walkable land FIRST so peds/swim/clamp see
    //     it the instant we start placing things.
    // =====================================================================
    CBZ.registerCityRegion(city, { name: "The Saltlands", subtitle: "Desert Mesa", biome: "desert", kind: "rect", minX: MINX, maxX: MAXX, minZ: MINZ, maxZ: MAXZ, pad: 8 });
    // causeway widened to the 24m highway deck (z-span ±12 about the centreline)
    CBZ.registerCityRegion(city, { name: "Saltlands Causeway", subtitle: "Desert Mesa", kind: "rect", minX: Math.min(CW_X0, CW_X1), maxX: Math.max(CW_X0, CW_X1), minZ: CW_Z - 12, maxZ: CW_Z + 12, pad: 1 });
    // give traffic a road across the causeway (runs along X → not vertical)
    if (city.roads) {
      city.roads.push({ x: (CW_X0 + CW_X1) / 2, z: CW_Z, vertical: false, len: Math.abs(CW_X1 - CW_X0), district: "highway" });
    }

    // =====================================================================
    //  1) THE BASIN — one big merged sand plane (warm tan) + a scatter of
    //     darker/paler quad patches so it reads weathered, not a flat slab.
    //     World is flat y=0; this sits a hair above so it z-fights nothing.
    // =====================================================================
    // TECHNIQUE 2 (dune-ripple shader): the main sand plane gets the
    // ShaderMaterial above instead of a flat cmat() — still ONE mesh / ONE
    // draw call, just a live material instead of a static color. Built by
    // hand (not via mergeAdd) since it's a single plane; the ripple pattern
    // needs the plane's own UVs, which mergeAdd's BufferGeometryUtils merge
    // preserves anyway, but skipping the merge for a 1-geometry list avoids
    // a no-op dependency on BGU for this specific mesh.
    const groundGeo = plane(CX, CZ, HX * 2, HZ * 2, 0.02);
    const duneMat = makeDuneRippleMaterial(SAND);
    const groundMesh = new THREE.Mesh(groundGeo, duneMat);
    groundMesh.castShadow = false; groundMesh.receiveShadow = true;
    groundMesh.matrixAutoUpdate = false; groundMesh.updateMatrix();
    root.add(groundMesh);
    // tick the ripple's time uniform — a single float write per frame,
    // gated so it never runs (or leaks an updater) outside city mode.
    if (CBZ.onAlways) {
      CBZ.onAlways(8.05, function () {
        if (!CBZ.game || CBZ.game.mode !== "city") return;
        duneMat.uniforms.uTime.value = (typeof CBZ.now === "number") ? CBZ.now : 0;
      });
    }
    // wind-streak patches (two tones, two merged meshes — 2 draw calls)
    const patchDk = [], patchPale = [];
    for (let i = 0; i < 90; i++) {
      const x = rr(MINX + 20, MAXX - 20), z = rr(MINZ + 20, MAXZ - 20);
      const w = rr(10, 34), d = rr(8, 26);
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2); g.rotateY(rng() * Math.PI);
      g.translate(x, 0.03, z);
      (rng() < 0.5 ? patchDk : patchPale).push(g);
    }
    mergeAdd(patchDk, cmat(SAND_DK), { receive: true });
    mergeAdd(patchPale, cmat(SAND_PALE), { receive: true });

    // ---- BIOME-EDGE BLEND APRON: was a hard cut from sand straight to
    // nothing past the rim. A per-vertex-colored ring just outside the basin
    // fades sand -> a neutral scrubby "wild ground" tone via MOISTURE NOISE
    // (window.noise.simplex2, the same field terrain.js uses) so the desert
    // reads as melting into the surrounding land instead of stopping at a
    // ruler-straight rectangle. Purely cosmetic: one extra mesh, no collider/
    // region change — walkable footprint + causeway corridor untouched.
    (function edgeBlendApron() {
      const apronW = HX * 2 + 200, apronD = HZ * 2 + 200;
      const SEG = 16;
      const ag = new THREE.PlaneGeometry(apronW, apronD, SEG, SEG);
      const cSand = new THREE.Color(SAND);
      const cWild = new THREE.Color(0x8a8a5c);   // neutral dry-scrub edge tone
      const _ac = new THREE.Color();
      const apos = ag.attributes.position;
      const acolors = new Float32Array(apos.count * 3);
      const hasNoise = !!(window.noise && window.noise.simplex2);
      for (let i = 0; i < apos.count; i++) {
        // mesh is rotated -PI/2 about X below: local (x,y,0) -> world (x,0,-y)
        const lx = apos.getX(i), lz = apos.getY(i);
        const wx = CX + lx, wz = CZ - lz;
        const edge = Math.min(1, Math.max(Math.abs(lx) / (apronW / 2), Math.abs(lz) / (apronD / 2)));
        const moist = hasNoise ? (window.noise.simplex2(wx * 0.01, wz * 0.01) * 0.5 + 0.5) : 0.5;
        const t = Math.min(1, Math.max(0, (edge - 0.2) / 0.65 + (moist - 0.5) * 0.35));
        _ac.copy(cSand).lerp(cWild, t);
        acolors[i * 3] = _ac.r; acolors[i * 3 + 1] = _ac.g; acolors[i * 3 + 2] = _ac.b;
      }
      ag.setAttribute("color", new THREE.BufferAttribute(acolors, 3));
      const apron = new THREE.Mesh(ag, new THREE.MeshLambertMaterial({ vertexColors: true }));
      apron.rotation.x = -Math.PI / 2;
      apron.position.set(CX, 0.0, CZ);
      apron.receiveShadow = true;
      root.add(apron);
    })();

    // =====================================================================
    //  2) DUNES — low rolling mounds you walk OVER visually (no colliders).
    //     One merged mesh of squashed low-poly spheres (icosa, flat-tan).
    //     A pale crest cap mesh on top for the sun-hit ridge read.
    // =====================================================================
    const duneGeoms = [], crestGeoms = [];
    for (let i = 0; i < 180; i++) {   // scaled up for the ~1.8x larger basin
      const x = rr(MINX + 14, MAXX - 14), z = rr(MINZ + 14, MAXZ - 14);
      const r = rr(7, 22), h = rr(1.0, 3.0);
      const g = new THREE.SphereGeometry(r, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.5);
      g.scale(1, h / r, rr(0.7, 1.3));
      g.rotateY(rng() * Math.PI);
      g.translate(x, 0.0, z);
      duneGeoms.push(g);
      // a thin pale skullcap riding the crest
      const c = new THREE.SphereGeometry(r * 0.6, 7, 3, 0, Math.PI * 2, 0, Math.PI * 0.5);
      c.scale(1, (h * 0.9) / (r * 0.6), 0.9);
      c.translate(x, h * 0.18, z);
      crestGeoms.push(c);
    }
    mergeAdd(duneGeoms, cmat(SAND), { receive: true });
    mergeAdd(crestGeoms, cmat(SAND_PALE), { receive: true });

    // =====================================================================
    //  3) DRY RIVERBED — a meandering darker channel of overlapping flat
    //     lobes (cracked-mud read), ONE merged mesh. Cuts NW→SE so the
    //     highway can later cross it for a "bridge over a dead river" beat.
    // =====================================================================
    const riverGeoms = [];
    let rxz = { x: MINX + 60, z: MINZ + 40 };
    for (let i = 0; i < 30; i++) {
      const g = new THREE.CircleGeometry(rr(5, 9), 8);
      g.rotateX(-Math.PI / 2);
      g.translate(rxz.x, 0.035, rxz.z);
      riverGeoms.push(g);
      rxz.x += rr(14, 22); rxz.z += rr(2, 16);
      if (rxz.x > MAXX - 40) break;
    }
    mergeAdd(riverGeoms, cmat(SAND_DK), { receive: true });

    // =====================================================================
    //  4) SAGUARO CACTI — instanced. Trunks (tall thin cylinders) in ONE
    //     InstancedMesh; arms (short cylinders, elbowed) in another. Shared
    //     cmat green. Trunks get a thin collider (you can't walk through a
    //     saguaro). Kept away from the highway corridor + buildings later.
    // =====================================================================
    const cactusSpots = [];
    for (let i = 0; i < 90; i++) {
      const x = rr(MINX + 18, MAXX - 18), z = rr(MINZ + 18, MAXZ - 18);
      const h = rr(2.6, 5.2), arms = (rng() < 0.7 ? 1 : 0) + (rng() < 0.4 ? 1 : 0);   // draw rng FIRST (determinism)
      if (inTown(x, z)) continue;                                                      // no saguaros in the streets
      cactusSpots.push({ x, z, h, arms });
    }
    const trunkGeo = new THREE.CylinderGeometry(0.32, 0.4, 1, 7);
    const trunkIM = new THREE.InstancedMesh(trunkGeo, cmat(CACTUS), cactusSpots.length);
    trunkIM.castShadow = true; trunkIM.receiveShadow = true;
    let armCount = 0; cactusSpots.forEach(c => armCount += c.arms);
    const armGeo = new THREE.CylinderGeometry(0.22, 0.24, 1, 6);
    const armIM = new THREE.InstancedMesh(armGeo, cmat(CACTUS), Math.max(1, armCount));
    armIM.castShadow = true;
    let ti = 0, ai = 0;
    cactusSpots.forEach(c => {
      dummy.position.set(c.x, c.h / 2, c.z);
      dummy.scale.set(1, c.h, 1); dummy.rotation.set(0, rng() * Math.PI, 0);
      dummy.updateMatrix(); trunkIM.setMatrixAt(ti++, dummy.matrix);
      for (let a = 0; a < c.arms; a++) {
        const side = a === 0 ? 1 : -1;
        const ay = c.h * rr(0.45, 0.62);
        const len = c.h * rr(0.3, 0.45);
        // vertical arm offset to the side (low-poly elbow read)
        dummy.position.set(c.x + side * 0.5, ay + len / 2, c.z);
        dummy.scale.set(1, len, 1); dummy.rotation.set(0, 0, side * 0.15);
        dummy.updateMatrix(); armIM.setMatrixAt(ai++, dummy.matrix);
      }
      solid(c.x, c.z, 0.7, 0.7, c.h);
    });
    trunkIM.instanceMatrix.needsUpdate = true; armIM.instanceMatrix.needsUpdate = true;
    trunkIM.matrixAutoUpdate = false; armIM.matrixAutoUpdate = false;
    root.add(trunkIM); if (armCount) root.add(armIM);

    // =====================================================================
    //  5) BOULDER FIELDS — instanced low-poly rocks (one icosa geo, varied
    //     scale/rot), ONE InstancedMesh, shared grey cmat. The big ones get
    //     a collider; small ones are pure scatter you step over.
    // =====================================================================
    const boulders = [];
    for (let i = 0; i < 140; i++) {
      const x = rr(MINX + 12, MAXX - 12), z = rr(MINZ + 12, MAXZ - 12);
      const s = rr(0.5, 3.4);                       // draw rng FIRST (determinism)
      if (inTown(x, z)) continue;                   // no boulders in the streets
      boulders.push({ x, z, s });
    }
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rockIM = new THREE.InstancedMesh(rockGeo, cmat(ROCK_GREY), boulders.length);
    rockIM.castShadow = true; rockIM.receiveShadow = true;
    boulders.forEach((b, i) => {
      dummy.position.set(b.x, b.s * 0.4, b.z);
      dummy.scale.set(b.s, b.s * rr(0.6, 0.9), b.s * rr(0.8, 1.2));
      dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      dummy.updateMatrix(); rockIM.setMatrixAt(i, dummy.matrix);
      if (b.s > 2.2) solid(b.x, b.z, b.s * 1.4, b.s * 1.4, b.s);
    });
    rockIM.instanceMatrix.needsUpdate = true; rockIM.matrixAutoUpdate = false;
    root.add(rockIM);

    // =====================================================================
    //  5b) FRACTURED ROCK CLUSTERS (world/rockscliffs.js) — a handful of
    //      chipped-boulder clusters ringing Dry Gulch's outskirts. WHY a
    //      second rock system's OUTPUT here instead of the icosa boulders
    //      above: the plain-icosa field (5) is deliberately smooth basin
    //      clutter (cheap, thousands of candidates); these few clusters use
    //      the SAME shared scrape geometry the mountain backdrop uses (one
    //      system, not two), just re-skinned smaller/paler for desert rock
    //      vs mountain granite (a palette+scale call, per the task — no new
    //      rock system). Candidates are drawn in a ring just outside the
    //      TOWN rect so they read as "the rock the town got built next to,"
    //      not scattered randomly across the whole basin. Ground here is
    //      flat (y=0 basin, no terrain relief in this biome) so the slope
    //      test always passes — the exclusion still runs (defensive, keeps
    //      the same code path terrain.js uses) but never rejects on this
    //      flat basin; it exists so a future sloped desert edge inherits the
    //      same angle-of-repose safety for free.
    // =====================================================================
    if (CBZ.scatterRocks) {
      function pickTownOutskirt(r) {
        // ring around the town rect, biased just outside its edge
        const ang = r() * Math.PI * 2;
        const ringR = Math.max(TOWN_HX, TOWN_HZ) + rr(30, 90);
        const x = TOWN_CX + Math.cos(ang) * ringR;
        const z = TOWN_CZ + Math.sin(ang) * ringR;
        return { x, z };
      }
      CBZ.scatterRocks(root, {
        count: 22,
        pick: pickTownOutskirt,
        heightAt: function () { return 0; },        // desert basin is flat (no terrain relief here)
        normalAt: function (x, z, out) { return out.set(0, 1, 0); },
        repeatAngleDeg: 38,
        minSize: 0.6, maxSize: 1.8,                  // desert-scale clusters — smaller than mountain boulders
        baseRadius: 1, detail: 0,                    // cheaper/lower-poly than the mountain rock (desert reads small anyway)
        variants: 2,
        colorHex: ROCK_GREY,                          // desert rock palette, not mountain granite
        seed: 0x5dec7 ^ 0x2222,
      });
    }

    // =====================================================================
    //  6) DEAD SCRUB + TUMBLEWEEDS — instanced. Scrub = a small dome of
    //     thin crossed quads (one icosa, flat-shaded olive). Tumbleweeds =
    //     pale wireframe-ish spheres. Both ONE InstancedMesh each. No
    //     colliders (you brush right through dry brush).
    // =====================================================================
    const scrubGeo = new THREE.IcosahedronGeometry(0.6, 0);
    const scrubIM = new THREE.InstancedMesh(scrubGeo, cmat(SCRUB), 110);
    for (let i = 0; i < 110; i++) {
      const sx = rr(MINX + 8, MAXX - 8), sz = rr(MINZ + 8, MAXZ - 8);
      const s = rr(0.5, 1.3); const rot = rng() * Math.PI;       // draw rng FIRST
      // in-town instances sink below grade (hidden) — keeps the instance count
      // + rng stream identical while clearing the streets of brush.
      dummy.position.set(sx, inTown(sx, sz) ? -50 : 0.3, sz);
      dummy.scale.set(s, s * 0.7, s); dummy.rotation.set(0, rot, 0);
      dummy.updateMatrix(); scrubIM.setMatrixAt(i, dummy.matrix);
    }
    scrubIM.instanceMatrix.needsUpdate = true; scrubIM.matrixAutoUpdate = false;
    scrubIM.castShadow = true; root.add(scrubIM);

    const tumbleGeo = new THREE.IcosahedronGeometry(0.7, 1);
    const tumbleIM = new THREE.InstancedMesh(tumbleGeo, cmat(TUMBLE), 24);
    for (let i = 0; i < 24; i++) {
      const tx = rr(MINX + 10, MAXX - 10), tz = rr(MINZ + 10, MAXZ - 10);
      const s = rr(0.6, 1.1); const rx = rng() * Math.PI, ry = rng() * Math.PI, rz = rng() * Math.PI;   // draw rng FIRST
      dummy.position.set(tx, inTown(tx, tz) ? -50 : 0.6, tz);
      dummy.scale.set(s, s, s); dummy.rotation.set(rx, ry, rz);
      dummy.updateMatrix(); tumbleIM.setMatrixAt(i, dummy.matrix);
    }
    tumbleIM.instanceMatrix.needsUpdate = true; tumbleIM.matrixAutoUpdate = false;
    root.add(tumbleIM);

    // =====================================================================
    //  7) BLEACHED BONES — instanced thin ribs/skull bits, ONE InstancedMesh.
    //     WHY: the desert KILLS. A sun-bleached ribcage half-buried in sand
    //     is the cheapest honest signal that "things die out here" — sets
    //     the stakes before you've even run dry. Clustered into a couple of
    //     "carcass" sites, not sprinkled evenly.
    // =====================================================================
    const boneGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 5);
    const boneIM = new THREE.InstancedMesh(boneGeo, cmat(BONE), 30);
    let bi = 0;
    const carcasses = [{ x: rr(MINX + 60, CX), z: rr(MINZ + 40, CZ) }, { x: rr(CX, MAXX - 60), z: rr(CZ, MAXZ - 40) }];
    carcasses.forEach(c => {
      for (let r = 0; r < 7 && bi < 30; r++) {           // a curved row of ribs
        dummy.position.set(c.x + r * 0.4 - 1.4, 0.1, c.z + Math.sin(r) * 0.2);
        dummy.scale.set(1, rr(0.8, 1.4), 1);
        dummy.rotation.set(0, 0, 1.1 + Math.sin(r) * 0.15);
        dummy.updateMatrix(); boneIM.setMatrixAt(bi++, dummy.matrix);
      }
      if (bi < 30) {                                       // a long spine bone
        dummy.position.set(c.x - 2.2, 0.1, c.z); dummy.scale.set(1.2, 2.4, 1.2);
        dummy.rotation.set(0, 0, Math.PI / 2); dummy.updateMatrix();
        boneIM.setMatrixAt(bi++, dummy.matrix);
      }
    });
    for (; bi < 30; bi++) {                                // a few lone scattered bones
      dummy.position.set(rr(MINX + 20, MAXX - 20), 0.08, rr(MINZ + 20, MAXZ - 20));
      dummy.scale.set(1, rr(0.5, 1.0), 1); dummy.rotation.set(0, rng() * Math.PI, Math.PI / 2);
      dummy.updateMatrix(); boneIM.setMatrixAt(bi, dummy.matrix);
    }
    boneIM.instanceMatrix.needsUpdate = true; boneIM.matrixAutoUpdate = false;
    boneIM.castShadow = true; root.add(boneIM);

    // =====================================================================
    //  8) RED-ROCK MESAS — the only big individually-placed solids. Each =
    //     a stepped stack of two boxes (broad base + narrower cap) in a red
    //     sandstone tone with a darker shadow band, plus a full-height
    //     collider you WALK AROUND. A handful, spaced as landmarks so the
    //     basin has orientation cues from far off.
    // =====================================================================
    const mesas = [
      { x: CX - 220, z: CZ - 150, w: 70, d: 55, h: 24 },
      { x: CX + 180, z: CZ + 120, w: 95, d: 70, h: 30 },
      { x: CX + 120, z: CZ - 200, w: 55, d: 60, h: 20 },
      { x: CX - 140, z: CZ + 180, w: 60, d: 48, h: 22 },
      // three more out in the deep southern expanse — tall buttes that give the
      // enlarged basin far-off orientation cues (you steer BY them).
      { x: CX - 260, z: CZ + 340, w: 84, d: 66, h: 38 },
      { x: CX + 250, z: CZ + 300, w: 62, d: 74, h: 28 },
      { x: CX + 40,  z: CZ + 400, w: 100, d: 80, h: 44 },
    ];
    const mesaBase = [], mesaCap = [], mesaBand = [];
    mesas.forEach(m => {
      const bh = m.h * 0.7, ch = m.h - bh;
      const gb = new THREE.BoxGeometry(m.w, bh, m.d); gb.translate(m.x, bh / 2, m.z); mesaBase.push(gb);
      const gc = new THREE.BoxGeometry(m.w * 0.7, ch, m.d * 0.7); gc.translate(m.x, bh + ch / 2, m.z); mesaCap.push(gc);
      // a thin darker shadow band near the base (stratum read)
      const gd = new THREE.BoxGeometry(m.w + 0.4, bh * 0.18, m.d + 0.4); gd.translate(m.x, bh * 0.32, m.z); mesaBand.push(gd);
      solid(m.x, m.z, m.w, m.d, m.h);
    });
    mergeAdd(mesaBase, cmat(RED_ROCK), { cast: true, receive: true });
    mergeAdd(mesaCap, cmat(RED_ROCK), { cast: true, receive: true });
    mergeAdd(mesaBand, cmat(RED_DK), { cast: true, receive: true });

    // =====================================================================
    //  9) THE DESERT HIGHWAY — a faded asphalt deck cutting W→E across the
    //     basin (z ≈ CZ-40), ONE merged plane, with a center line built as
    //     instanced dashes (ONE InstancedMesh of thin pale quads). This is
    //     the SPINE the gas station / diner / motel hang off, and where the
    //     cars + telephone poles live. WHY a road in the wild: it's the
    //     only reason any of these outposts exist out here.
    // =====================================================================
    const HWY_Z = CZ - 40;
    mergeAdd([plane(CX, HWY_Z, HX * 2 - 8, 9, 0.05)], cmat(ASPHALT), { receive: true });
    // dashed center line — instanced
    const nDash = 60;
    const dashIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.4, 0.3), cmat(LINE_PALE), nDash);
    for (let i = 0; i < nDash; i++) {
      const x = MINX + 12 + i * ((HX * 2 - 24) / nDash);
      dummy.position.set(x, 0.07, HWY_Z); dummy.scale.set(1, 1, 1);
      dummy.rotation.set(-Math.PI / 2, 0, 0); dummy.updateMatrix();
      dashIM.setMatrixAt(i, dummy.matrix);
    }
    dashIM.instanceMatrix.needsUpdate = true; dashIM.matrixAutoUpdate = false;
    root.add(dashIM);

    // ---- CAUSEWAY: a REAL wide highway land-bridge to the speedway -----------
    const cwLen = Math.abs(CW_X1 - CW_X0);
    if (CBZ.buildHighway) {
      // heightAt: grade-follow world/terrain.js relief (0 over this rect's
      // flat playable footprint — a free, safe hook for the backdrop rim).
      CBZ.buildHighway(root, {
        path: [{ x: CW_X0, z: CW_Z }, { x: CW_X1, z: CW_Z }],
        width: 24, lanesPerDir: 2, laneW: 3.6, theme: "asphalt",
        guardrail: true, lights: true, elevated: false, rng: rng,
        heightAt: CBZ.terrainHeight,
      });
    } else {
      // ---- fallback: bespoke narrow deck (only if buildHighway absent) ----
      mergeAdd([plane((CW_X0 + CW_X1) / 2, CW_Z, cwLen, CW, 0.05)], cmat(ASPHALT), { receive: true });
      const nCw = Math.max(6, (cwLen / 6) | 0);
      const cwDashIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.0, 0.28), cmat(LINE_PALE), nCw);
      for (let i = 0; i < nCw; i++) {
        const x = Math.min(CW_X0, CW_X1) + 4 + i * ((cwLen - 8) / nCw);
        dummy.position.set(x, 0.07, CW_Z); dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(1, 1, 1); dummy.updateMatrix(); cwDashIM.setMatrixAt(i, dummy.matrix);
      }
      cwDashIM.instanceMatrix.needsUpdate = true; cwDashIM.matrixAutoUpdate = false;
      root.add(cwDashIM);
    }

    // =====================================================================
    // 10) TELEPHONE POLES — instanced posts + instanced crossarms running
    //     alongside the highway. Poles get thin colliders. WHY: a power line
    //     to nowhere reads as "civilization once reached out here," and
    //     gives the empty road scale + rhythm.
    // =====================================================================
    const nPole = 26;
    const poleGeo = new THREE.CylinderGeometry(0.22, 0.28, 8, 6);
    const poleIM = new THREE.InstancedMesh(poleGeo, cmat(POLE), nPole);
    const armIM2 = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.22, 0.22), cmat(POLE), nPole);
    for (let i = 0; i < nPole; i++) {
      const x = MINX + 18 + i * ((HX * 2 - 36) / nPole);
      const z = HWY_Z + 7;                                 // along the road's south shoulder
      dummy.position.set(x, 4, z); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix(); poleIM.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x, 7.0, z); dummy.updateMatrix(); armIM2.setMatrixAt(i, dummy.matrix);
      solid(x, z, 0.6, 0.6, 8);
    }
    poleIM.instanceMatrix.needsUpdate = true; armIM2.instanceMatrix.needsUpdate = true;
    poleIM.matrixAutoUpdate = false; armIM2.matrixAutoUpdate = false;
    poleIM.castShadow = true; root.add(poleIM); root.add(armIM2);

    // =====================================================================
    // 11) LANDMARKS — the WHY anchors. Built with cityMakeBuilding so the
    //     ones that should be enterable are. Each hangs off the highway.
    // =====================================================================
    const mk = CBZ.cityMakeBuilding;
    if (mk) {
      // -- GAS STATION + DINER (the reason to drive out here: FUEL + FOOD) --
      const gx = CX - 120, gz = HWY_Z + 22;
      mk(root, gx, gz, 14, 11, 1, 0xded6c4, "north", { retail: true });            // station store (enterable)
      mk(root, gx + 26, gz + 2, 16, 12, 1, 0xc94f3a, "north", { retail: true });   // chrome diner (enterable)
      // pump-canopy: a flat roof on 4 posts (merged) + 2 pump blocks (instanced)
      const canY = 4.2, cgx = gx, cgz = gz - 12;
      mergeAdd([(function () { const g = new THREE.BoxGeometry(16, 0.5, 9); g.translate(cgx, canY, cgz); return g; })()], cmat(0xe7e2d4), { cast: true });
      const postIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, canY, 0.5), cmat(0xb8b2a4), 4);
      const pCorners = [[-7, -3.5], [7, -3.5], [-7, 3.5], [7, 3.5]];
      pCorners.forEach((c, i) => { dummy.position.set(cgx + c[0], canY / 2, cgz + c[1]); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); postIM.setMatrixAt(i, dummy.matrix); solid(cgx + c[0], cgz + c[1], 0.6, 0.6, canY); });
      postIM.instanceMatrix.needsUpdate = true; postIM.matrixAutoUpdate = false; postIM.castShadow = true; root.add(postIM);
      const pumpIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1.6, 0.6), cmat(0xc0392b), 2);
      [[-3, 0], [3, 0]].forEach((c, i) => { dummy.position.set(cgx + c[0], 0.8, cgz + c[1]); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); pumpIM.setMatrixAt(i, dummy.matrix); solid(cgx + c[0], cgz + c[1], 1.0, 0.8, 1.6); });
      pumpIM.instanceMatrix.needsUpdate = true; pumpIM.matrixAutoUpdate = false; pumpIM.castShadow = true; root.add(pumpIM);
      if (CBZ.makeLabelSprite) { const s = CBZ.makeLabelSprite("GAS"); if (s) { s.position.set(gx, 5.0, gz); s.scale.set(7, 1.8, 1); root.add(s); } }
      if (CBZ.makeLabelSprite) { const s = CBZ.makeLabelSprite("DINER"); if (s) { s.position.set(gx + 26, 5.2, gz + 2); s.scale.set(8, 2.0, 1); root.add(s); } }

      // -- ROADSIDE MOTEL (SHELTER: a place to hole up / lay low) ----------
      const mxr = CX + 110, mzr = HWY_Z + 26;
      mk(root, mxr, mzr, 40, 12, 1, 0xd8b48a, "north", { retail: true });          // long unit row (enterable office shell)
      if (CBZ.makeLabelSprite) { const s = CBZ.makeLabelSprite("MOTEL"); if (s) { s.position.set(mxr, 5.6, mzr); s.scale.set(10, 2.4, 1); root.add(s); } }
      // a tall neon-ish sign pylon out by the road (merged post + board)
      mergeAdd([
        (function () { const g = new THREE.BoxGeometry(0.6, 9, 0.6); g.translate(mxr - 22, 4.5, mzr - 10); return g; })(),
        (function () { const g = new THREE.BoxGeometry(5, 3, 0.4); g.translate(mxr - 22, 9.5, mzr - 10); return g; })(),
      ], cmat(0x9a7b52), { cast: true });
      if (CBZ.makeLabelSprite) { const s = CBZ.makeLabelSprite("VACANCY"); if (s) { s.position.set(mxr - 22, 9.5, mzr - 10.3); s.scale.set(5, 1.6, 1); root.add(s); } }

      // -- ABANDONED MINING OUTPOST (a relic worth poking at) --------------
      // a weathered headframe (merged A-frame timbers) + an ore shed
      // (enterable) + a derelict water tower. WHY: a played-out mine is why
      // ANYONE first cut a road into this basin — the dead source.
      const ox = CX - 230, oz = CZ + 60;
      mk(root, ox + 14, oz, 10, 9, 1, 0x8a7252, "south", { retail: true });        // ore shed (enterable)
      const hf = 9;                                                                 // headframe height
      mergeAdd([
        (function () { const g = new THREE.BoxGeometry(0.5, hf, 0.5); g.rotateZ(0.18); g.translate(ox - 2.0, hf / 2, oz); return g; })(),
        (function () { const g = new THREE.BoxGeometry(0.5, hf, 0.5); g.rotateZ(-0.18); g.translate(ox + 2.0, hf / 2, oz); return g; })(),
        (function () { const g = new THREE.BoxGeometry(5.0, 0.4, 0.4); g.translate(ox, hf, oz); return g; })(),
      ], cmat(0x6e5436), { cast: true });
      solid(ox, oz, 5, 1.2, hf);
      if (CBZ.makeLabelSprite) { const s = CBZ.makeLabelSprite("MINE"); if (s) { s.position.set(ox, hf + 1.2, oz); s.scale.set(6, 1.6, 1); root.add(s); } }
      // derelict water tower: tank on legs (merged)
      const tx = ox + 26, tz = oz - 12;
      mergeAdd([
        (function () { const g = new THREE.CylinderGeometry(2.6, 2.6, 3.2, 10); g.translate(tx, 8.6, tz); return g; })(),
        (function () { const g = new THREE.ConeGeometry(2.8, 1.4, 10); g.translate(tx, 10.9, tz); return g; })(),
      ], cmat(0x8c7d68), { cast: true });
      const legIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 7, 0.3), cmat(0x6e5436), 4);
      [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]].forEach((c, i) => { dummy.position.set(tx + c[0], 3.5, tz + c[1]); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); legIM.setMatrixAt(i, dummy.matrix); });
      legIM.instanceMatrix.needsUpdate = true; legIM.matrixAutoUpdate = false; legIM.castShadow = true; root.add(legIM);
      solid(tx, tz, 4, 4, 11);
    }

    // =====================================================================
    // 11b) DRY GULCH — a real OLD-WEST main-street TOWN grown from the
    //      reusable CBZ.buildTown generator, strung ALONG the highway spine.
    //      FALLBACK: if the town generator (towngen.js / placement) is absent
    //      this whole block no-ops and the scatter+landmarks above stand as
    //      the desert — zero regression. The scatter loops already skipped the
    //      TOWN rect (inTown), so cacti/boulders/brush don't grow in the
    //      streets only WHEN the generator is present (HAS_TOWN gates inTown).
    // =====================================================================
    if (HAS_TOWN) {
      // reserve the existing landmark/road colliders so the generator's
      // placement (when present) never drops a lot on the gas station etc.
      if (CBZ.placement && CBZ.placement.seedFromColliders) { try { CBZ.placement.seedFromColliders(); } catch (e) {} }
      const town = CBZ.buildTown(root, {
        cx: TOWN_CX, cz: TOWN_CZ, cols: 3, rows: 2,
        blockW: 64, blockD: 50, roadW: 12,
        pattern: "mainstreet",
        density: 0.5,                       // LOW density — big frontier gaps
        name: "Dry Gulch", district: "desert",
        rng: rng,
        region: TOWN,
        minFrontage: 16, minLotArea: 240,
        squarePrefab: "well",
        // sun-bleached wood / dust palette
        palette: { ground: 0xcdb98a, sidewalk: 0xc2ad7e, wood: 0xa07c4c, accent: 0x6e5436, stone: 0x9a8d72, road: 0x4a4742, line: LINE_PALE, sign: "#f4e7c2", plaza: 0xd2bd8c, lamp: 0xf3d68a },
        // per-zone weighted prefabs — Old-West retail shells. civic ring gets
        // the Sheriff + Bank (the law + the money), commercial ring the Saloon
        // + General Store + boarding house, edges thin out to plain shacks.
        prefabs: {
          civic: [
            { name: "SHERIFF", storeys: 1, color: 0x8a6b44, w: 6, opts: { retail: true }, lotKind: "shop" },
            { name: "BANK", storeys: 2, color: 0xb7a279, opts: { retail: true }, lotKind: "shop" },
          ],
          commercial: [
            { name: "SALOON", storeys: 2, color: 0x9c6b3e, opts: { retail: true }, lotKind: "shop", w: 3 },
            { name: "GENERAL STORE", storeys: 1, color: 0xae8a55, opts: { retail: true }, lotKind: "shop", w: 3 },
            { name: "BOARDING HOUSE", storeys: 2, color: 0xb59a6a, opts: { retail: true }, lotKind: "shop", w: 2 },
            { name: "ASSAY OFFICE", storeys: 1, color: 0x977148, opts: { retail: true }, lotKind: "shop", w: 1 },
          ],
          residential: [
            { name: "HOMESTEAD", storeys: 1, color: 0xa9895c, opts: { retail: true }, lotKind: "home", w: 2 },
            { name: "SHACK", storeys: 1, color: 0x8f7146, opts: { retail: true }, lotKind: "home", w: 1 },
          ],
          default: [
            { name: "SHACK", storeys: 1, color: 0x8f7146, opts: { retail: true }, lotKind: "home" },
          ],
        },
      });

      // WORK ANCHORS — give town NPCs a reason to be here. A separate jobs
      // agent reads these; feature-detected so the town builds without it.
      if (town && CBZ.registerWorkAnchor) {
        const gen = (town.lots || []).find((l) => l.building && l.building.name === "GENERAL STORE")
                 || (town.lots || []).find((l) => l.kind === "shop");
        if (gen) {
          try {
            CBZ.registerWorkAnchor({
              biome: "desert", kind: "shop", x: gen.cx, z: gen.cz, role: "shopkeeper",
              spots: [{ x: gen.building.door.x, z: gen.building.door.z }],   // behind the counter at the door
              home: { x: gen.cx, z: gen.cz }, cap: 1, occupants: [],
            });
          } catch (e) {}
        }
        const saloon = (town.lots || []).find((l) => l.building && l.building.name === "SALOON");
        if (saloon) {
          try {
            CBZ.registerWorkAnchor({
              biome: "desert", kind: "saloon", x: saloon.cx, z: saloon.cz, role: "barkeep",
              spots: [{ x: saloon.building.door.x, z: saloon.building.door.z }],
              home: { x: saloon.cx, z: saloon.cz }, cap: 1, occupants: [],
            });
          } catch (e) {}
        }
      }
    }

    // =====================================================================
    // 12) POPULATE — SPARSE. A handful of live peds (drifter/biker/
    //     prospector) clustered at the human anchors (gas/diner/motel/mine)
    //     so the empty basin still has a heartbeat where it makes sense.
    //     Lean on the instanced scenery for the SENSE of scale, not bodies.
    // =====================================================================
    if (CBZ.cityMakePed && CBZ.cityPeds) {
      const ped = function (x, z, opts) {
        try {
          const p = CBZ.cityMakePed(x, z, rng, opts || {});
          if (p) CBZ.cityPeds.push(p);
        } catch (e) { /* one bad ped never kills the biome */ }
      };
      // gas station / diner: a drifter + a mechanic
      ped(CX - 118, HWY_Z + 18, { name: "Drifter", wealth: 0.15 });
      ped(CX - 96, HWY_Z + 20, { name: "Mechanic", job: "construction", wealth: 0.3 });
      // motel: a biker hanging by the sign + a loner
      ped(CX + 90, HWY_Z + 22, { name: "Biker", archetype: "mobster", wealth: 0.4, aggr: 0.6 });
      ped(CX + 120, HWY_Z + 30, { name: "Loner", wealth: 0.2 });
      // mine: an old prospector poking the relic
      ped(CX - 216, CZ + 58, { name: "Prospector", wealth: 0.25 });
      // one wanderer out in the dunes
      ped(CX + 40, CZ + 100, { name: "Wanderer", wealth: 0.1 });
    }

    // a couple of cars out on the highway (one parked at gas, one cruising)
    if (CBZ.cityMakeCar) {
      try { CBZ.cityMakeCar(CX - 120, HWY_Z - 2, 0, false); } catch (e) {}
      try { CBZ.cityMakeCar(CX + 40, HWY_Z, Math.PI, false); } catch (e) {}
    }

  }, 31);
})();
