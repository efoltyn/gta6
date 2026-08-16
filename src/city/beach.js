/* ============================================================
   city/beach.js — THE WATERFRONT WITH A PURPOSE.

   WHY: the band between the street grid and the seawall was a dead
   gray apron — 26 metres of nothing on every coast. A city's edge
   is where it SHOWS OFF. Now the south shore is a real beach:
   warm sand running straight into the water (the seawall opens
   here), palms, umbrellas, towels, a lifeguard chair, a raised
   boardwalk with a snack shack + vendor stalls, and ONE pier reaching
   over the harbor to a jump-off-the-end dive (swim.js owns the water).

   THE PEOPLE WHO WORK IT ARE REAL TOO (2026-07-27). This beach built a
   lifeguard chair nobody sat in, two market stalls with no vendor and two
   fishing rods with no angler — three pieces of geometry whose whole meaning
   is the person missing from them. There is now a Lifeguard in the chair (a
   propuse seat with a DECLARED cushion, so he sits properly rather than
   squatting), a vendor behind each stall counter and an angler at each rod,
   all declared through city/citystaff.js and manned only inside 170 m. The
   chair's collider is also height-capped at its deck now, which is what makes
   the platform record beside it — a promise since the day it shipped — true.

   THE FURNITURE IS REAL. Loungers and deck chairs are CBZ.furnish pieces, so
   they arrive already registered with city/propuse.js: lying on a lounger runs
   the same walk → perch on the edge → swing the legs up arc as getting into a
   bed, and a deck chair runs the office-chair arc. Sunbathers are ordinary
   peds posted by CBZ.cityPostNpc and handed to propSit/propSleep — this file
   owns no body, no pose and no brain, only where the furniture goes.

   THE MONEY: sunbathers leave their lives on their towels. A few
   coolers and beach bags hold cash you can rifle ([E], a beat,
   gone) — petty theft if anyone's watching (cityCrime "theft"),
   but the beach sits past the NPC clamp line, so like the roof
   stashes it's a quiet earner you have to KNOW about. Restocks
   after long minutes.

   THE REST OF THE APRON stays open: a striped parking lot along the
   west quay, with no container stacks or filler geometry occupying
   the south-east corner.

   THE WATERLINE MOVES. The wet-sand strip and the drowned slope used to be
   two static meshes in one fixed colour, so the sea's foam edge could run up
   the beach while the sand under it never changed — the waterline was
   literally painted on. They are now ONE small vertex-coloured grid (the
   "swash apron") driven by CBZ.waterSwashAt(x, z, t) from
   world/water_spec.js: the exact expression the ocean shader's own cbzSwash()
   evaluates. Sand soaks instantly and dries over ~3s, so you can see where the
   last big wave reached long after it drained. Gated by CBZ.CONFIG.WATER_SWASH
   (off → the old static SAND_WET, no per-frame work).

   THE DOCK MOVES. Off the pier head there is now a FLOATING DOCK — a
   moored raft with a raised sun deck — reached by a hinged GANGWAY. Both
   are systems/platforms_moving.js rigs: their walk surfaces live in the
   parent group's LOCAL frame, so they stay correct while the raft heaves,
   pitches, rolls and swings on its lines (CBZ.waterRideAt — the same swell
   the ocean shader draws). They are the first things in this game you can
   stand on WHILE THEY MOVE. Driven at onUpdate(9.4), one step ahead of the
   rigs (9.5) and two ahead of updatePlayer (10) — a platform that moves
   after the player has resolved against it is the one-frame sink/pop.

   Draw-call discipline: sand/boardwalk/pier planks/rails/stripes
   are MERGED (BufferGeometryUtils, guarded), palms/umbrellas/
   towels/posts are InstancedMesh, materials via the shared CBZ.cmat
   pool. Solid things (shack, stalls, trunks and pier rails) register CBZ.colliders the same
   way props.js does; walkable decks register CBZ.platforms (the
   buildings.js pattern) so the pier is REALLY above the water.
   Deterministic LCG → same beach every run. Headless-guarded DOM.

   Publishes:
     CBZ.cityBuildBeach(city)   — world.js calls this once at build
     CBZ.cityBeachLoot()        — live loot records (map follow-up)
     CBZ.cityBeachLootReset()   — restock everything for a fresh run
     CBZ.cityBeachPalms()       — the takeable-palm kit: the tsunami buys a
                                  REAL palm out of the instanced pool
                                  (city/tsunami.js's no-fake-debris doctrine)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const cmat = CBZ.cmat || CBZ.mat;

  const REACH = 2.2;          // [E] rifle reach
  const RIFLE_T = 0.7;        // the crouch-and-rifle beat
  const RESPAWN = 280;        // s — the beach crowd "comes back" with new valuables

  // deterministic LCG — same sand, same towels, every run
  // seeded from CBZ.WORLD_SEED via the named-stream registry (core/seed.js)
  // — one world-seed knob instead of a per-file magic literal. rng() is
  // re-armed at build entry so a rebuild replays the identical stream.
  let rng = null;
  function armRng() { rng = CBZ.seedStream ? CBZ.seedStream('beach') : (function () { let s = 51420; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })(); }
  armRng();

  // ---- shared looks (cmat pool: zero new materials per repeated color) ----
  const SAND = 0xe6d49a, SAND_WET = 0xc4ad79;
  const WOOD_A = 0x9a7b52, WOOD_B = 0x8a6d47, WOOD_DK = 0x5e4a30;
  const LOOT_FULL  = () => cmat(0x2e4a5e, { emissive: 0x4caf6e, ei: 0.22 });
  const LOOT_EMPTY = () => cmat(0x24323c, { emissive: 0x000000, ei: 0 });
  const BAG_FULL   = () => cmat(0x7a4a8a, { emissive: 0xffb347, ei: 0.2 });
  const BAG_EMPTY  = () => cmat(0x4a3354, { emissive: 0x000000, ei: 0 });

  const loot = [];           // { x, z, body, bag, looted, t }
  // the usable furniture, in build order: { rec, lie } where rec is the
  // city/propuse.js anchor (a bed rec for a lounger, a seat rec for a deck
  // chair). Module scope because the sunbathers arrive on a later tick.
  const chairs = [];
  // THE PEOPLE WHO WORK THIS BEACH. Declared during the build, manned by
  // city/citystaff.js when you are within 170 m of them (a full rig is ~16
  // draw calls; five of them standing on an empty beach is pure waste).
  let lifeguardSeat = null, lifeguardPost = null;
  const stallSpots = [];     // { x, z, face } behind each vendor stall counter
  const anglerSpots = [];    // { x, z, face } at each rod on the pier head
  let built = false;
  // the takeable-palm kit (built with the palms; see the palm section) — the
  // tsunami buys real palms out of the instanced pool through this
  let palmField = null;

  // ---- the swash apron (built in section 1, animated at the bottom) --------
  // Drying sand vs. sand the water is on right now. Kept as THREE.Colors so
  // the components land in exactly the space a cmat(hex) material would.
  const SWASH_DRY = new THREE.Color(0xd8c391);   // between SAND and SAND_WET
  const SWASH_WET = new THREE.Color(0x8c7a50);   // dark, saturated, just-soaked
  let swash = null;
  // the floating dock + its gangway (world/systems/platforms_moving.js rigs) —
  // built in section 5b, driven by the 9.4 tick at the bottom of this file
  let dock = null;
  function paintSwash(k, w) {
    const c = swash.col, q = k * 3;
    c[q] = SWASH_DRY.r + (SWASH_WET.r - SWASH_DRY.r) * w;
    c[q + 1] = SWASH_DRY.g + (SWASH_WET.g - SWASH_DRY.g) * w;
    c[q + 2] = SWASH_DRY.b + (SWASH_WET.b - SWASH_DRY.b) * w;
  }
  function ss01(e0, e1, x) {
    let t = (x - e0) / (e1 - e0);
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return t * t * (3 - 2 * t);
  }

  CBZ.cityBuildBeach = function (city) {
    if (built || !city || !city.shore) return;
    built = true;
    armRng();
    const root = city.root;
    const S = city.shore, B = S.beach;
    const cx = city.center.x, cz = city.center.z;
    const ES = S.ES, EW = S.EW, EE = S.EE;
    const minX = city.minX, maxX = city.maxX, minZ = city.minZ;
    const BX0 = B.x0, BX1 = B.x1, BW = BX1 - BX0;
    const innerZ = minZ - 1.0;                 // sand starts at the last road's edge

    const BGU = THREE.BufferGeometryUtils;
    function mergeAdd(geoms, material, opts) {
      // many transformed geometries → ONE mesh (fallback: individual meshes)
      opts = opts || {};
      if (BGU && BGU.mergeBufferGeometries && geoms.length) {
        const m = new THREE.Mesh(BGU.mergeBufferGeometries(geoms), material);
        m.castShadow = !!opts.cast; m.receiveShadow = opts.receive !== false;
        m.matrixAutoUpdate = false; root.add(m);
        return m;
      }
      for (const gm of geoms) {
        const m = new THREE.Mesh(gm, material);
        m.castShadow = !!opts.cast; m.receiveShadow = opts.receive !== false;
        m.matrixAutoUpdate = false; root.add(m);
      }
      return null;
    }
    function boxGeoAt(x, y, z, w, h, d, ry, rz) {
      const gm = new THREE.BoxGeometry(w, h, d);
      if (rz) gm.rotateZ(rz);
      if (ry) gm.rotateY(ry);
      gm.translate(x, y, z);
      return gm;
    }
    function solid(x, z, w, d, ref, y1) {
      const c = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, ref, noCam: true };
      if (y1 != null) { c.y0 = 0; c.y1 = y1; }
      CBZ.colliders.push(c);
    }

    // =====================================================================
    //  1) THE SAND — one merged mesh: the main band + a run of half-buried
    //  lobes along the inner edge so the street→beach line reads windblown,
    //  not ruled. Lobes sit a hair LOWER than the band (no z-fight where
    //  they tuck under it; the part bulging onto the gray shows).
    //
    //  BEACH_V2 (2026-08-16): the band stops being one flat quad in one flat
    //  colour. It is a subdivided grid with MICRO-RELIEF (three incommensurate
    //  sine fields — smooth low dunes, deterministic, ZERO rng draws so the
    //  build stream is byte-identical either way) and VERTEX COLOUR doing the
    //  work a texture would: per-vertex grain mottle (position hash), a broad
    //  warm/cool drift, crests bleaching and hollows shading with the relief,
    //  a damp gradient into the swash, and the high-tide WRACK LINE as a
    //  colour band — the one mark every real beach carries, drawn with zero
    //  props. The relief is clamped flat where authored things live: the
    //  activity band (towels 0.085, furniture 0.06, loot), the pier approach,
    //  and ≤0.20 everywhere (under the boardwalk deck's underside at 0.22).
    //  ?cfg_BEACH_V2=0 → the old flat quad, byte for byte.
    // =====================================================================
    const V2 = !!(CBZ.CONFIG && CBZ.CONFIG.BEACH_V2 !== false);
    const sandGeoms = [];
    const dryFar = ES - 1.5;                              // dry sand's water-side edge
    const gx0 = BX0 - 2, gx1 = BX1 + 2;
    const pjx = BX1 - 26;                                 // pier x (section 5 derives the same)
    function sandY(x, z) {
      let b = 0.055 * Math.sin(x * 0.111 + z * 0.234)
            + 0.042 * Math.sin(x * 0.293 - z * 0.147 + 1.7)
            + 0.028 * Math.sin(x * 0.512 + z * 0.409 + 4.2);
      b *= 0.18 + 0.82 * ss01(ES + 11, ES + 15.5, z);     // activity band stays near-flat
      b *= 0.25 + 0.75 * ss01(4.5, 9, Math.abs(x - pjx)); // dead flat on the pier approach
      b *= Math.min(1, ss01(0, 7, x - gx0), ss01(0, 7, gx1 - x));  // no cliff at the span's ends
      const y = 0.06 + b + 0.07 * ss01(innerZ - 9, innerZ - 1.5, z);  // backshore rise
      return Math.min(0.20, Math.max(0.052, y));
    }
    const SAND_C = new THREE.Color(SAND), DAMP_C = new THREE.Color(0xcbb283);
    function sandCol(x, z, y, out, q) {
      const grain = 1 + ((CBZ.hash01 ? CBZ.hash01(x * 1.7, z * 1.7, 0x5a7d) : 0.5) - 0.5) * 0.10;
      const drift = 1 + 0.05 * Math.sin(x * 0.071 + z * 0.113 + 0.9);
      const lift = 1 + (y - 0.06) * 0.9;                  // crests bleach, hollows shade
      const wk = (z - (ES + 1.1)) / 0.95;                 // the wrack line — colour, not props
      const tone = grain * drift * lift * (1 - 0.15 * Math.exp(-wk * wk));
      const damp = 1 - ss01(ES - 0.4, ES + 3.6, z);       // last metres shade toward damp
      out[q] = (SAND_C.r + (DAMP_C.r - SAND_C.r) * damp) * tone;
      out[q + 1] = (SAND_C.g + (DAMP_C.g - SAND_C.g) * damp) * tone;
      out[q + 2] = (SAND_C.b + (DAMP_C.b - SAND_C.b) * damp) * tone;
    }
    if (!V2) {
      const band = new THREE.PlaneGeometry(BW + 4, innerZ - dryFar);
      band.rotateX(-Math.PI / 2);
      band.translate((BX0 + BX1) / 2, 0.06, (innerZ + dryFar) / 2);
      sandGeoms.push(band);
    } else (function sandField() {
      const NXs = Math.max(28, Math.round((gx1 - gx0) / 2.8)), NZs = 12;
      const n = (NXs + 1) * (NZs + 1);
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      for (let iz = 0, k = 0; iz <= NZs; iz++) {
        const z = dryFar + (innerZ - dryFar) * iz / NZs;
        for (let ix = 0; ix <= NXs; ix++, k++) {
          const x = gx0 + (gx1 - gx0) * ix / NXs;
          const y = sandY(x, z);
          pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
          sandCol(x, z, y, col, k * 3);
        }
      }
      const idx = new Uint32Array(NXs * NZs * 6);
      let w = 0;
      for (let iz = 0; iz < NZs; iz++) for (let ix = 0; ix < NXs; ix++) {
        const a = iz * (NXs + 1) + ix, b2 = a + 1, c2 = a + NXs + 1, d2 = c2 + 1;
        // rows run landward (z INCREASES with iz), so (a,d,b)/(a,c,d) is the
        // winding whose face normal is +Y — cross((d-a),(b-a)) = (0,1,0)
        idx[w++] = a; idx[w++] = d2; idx[w++] = b2;
        idx[w++] = a; idx[w++] = c2; idx[w++] = d2;
      }
      const gm = new THREE.BufferGeometry();
      gm.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      gm.setAttribute("color", new THREE.BufferAttribute(col, 3));
      gm.setIndex(new THREE.BufferAttribute(idx, 1));
      gm.computeVertexNormals();
      sandGeoms.push(gm);
    })();
    for (let i = 0; i < 9; i++) {                         // the irregular inner edge
      const lx = BX0 + 4 + (i + rng() * 0.6) * (BW - 8) / 9;
      const r = 3.2 + rng() * 3.4;
      const lobe = new THREE.CircleGeometry(r, 10);
      lobe.rotateX(-Math.PI / 2);
      // mostly tucked under the band; the top arc bulges ≤1m onto the gray,
      // never onto the road (the last cross-street's asphalt starts at minZ)
      lobe.translate(lx, 0.052, innerZ - r + 1.0);
      if (V2) {
        // the lobes ride the relief a hair below the band, and past innerZ
        // (on the gray) they lie at the old flat 0.052 — the bulge that shows
        lobe.deleteAttribute("uv");
        const lp = lobe.attributes.position, la = lp.array, ln = lp.count;
        const lc = new Float32Array(ln * 3);
        for (let k = 0; k < ln; k++) {
          const x = la[k * 3], z = la[k * 3 + 2];
          const y = z >= innerZ - 0.01 ? 0.052 : Math.max(0.052, sandY(x, z) - 0.006);
          la[k * 3 + 1] = y;
          sandCol(x, z, y, lc, k * 3);
        }
        lp.needsUpdate = true;
        lobe.setAttribute("color", new THREE.BufferAttribute(lc, 3));
        lobe.computeVertexNormals();
      }
      sandGeoms.push(lobe);
    }
    if (!V2) mergeAdd(sandGeoms, cmat(SAND));
    else {
      // its OWN material (the shared cmat pool must never learn vertexColors)
      const sandMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      sandMat.name = "beach-dry-sand";
      mergeAdd(sandGeoms, sandMat);
    }

    // =====================================================================
    //  THE SWASH APRON — the wet-sand strip and the drowned slope, replaced
    //  by ONE small grid whose vertex colours track the water.
    //
    //  This was a static PlaneGeometry plus a two-triangle quad in a fixed
    //  SAND_WET, which meant the "waterline" was painted on: the sea's foam
    //  edge ran up the beach and the sand under it never changed. Now both
    //  read the SAME function — CBZ.waterSwashAt(x, z, t) from
    //  world/water_spec.js, which is literally the expression the sea shader's
    //  cbzSwash() evaluates — so the dark line and the white line are one
    //  thing by construction, not by two authors agreeing.
    //
    //  Sand wets INSTANTLY and dries SLOWLY (that asymmetry is the whole
    //  read: you can see where the last big wave reached long after it has
    //  drained). Cost: 7x13 = 91 vertices, one colour attribute rewrite per
    //  frame, no geometry rebuild, no new draw call beyond the one this mesh
    //  already was. Below mean sea level the sand is permanently submerged, so
    //  the run-up is clamped at 0 there — a drain-back cannot expose seabed.
    //
    //  Same footprint and heights as the two meshes it replaces (flat 0.048
    //  down to ES-5.5, then a straight ramp to -0.80 at ES-16), so nothing
    //  around it moved. Flagged by CBZ.CONFIG.WATER_SWASH: off → static
    //  SAND_WET colours and no per-frame work, i.e. the old look exactly.
    // =====================================================================
    (function swashApron() {
      const AX0 = BX0 - 2, AX1 = BX1 + 2;
      const AZ_LAND = ES + 0.5, AZ_SEA = ES - 16;
      const RAMP_Z = ES - 5.5, FLAT_Y = 0.048, SEA_FLOOR_Y = -0.80;
      // BEACH_V2: one swash column per ~11 m of shore instead of 7 across the
      // whole span — the run-up's alongshore phase gets room to read as SURF
      // (arcs and tongues) instead of one line tilting. Same heights, same
      // footprint, same single draw call; everything below is sized off NX/NZ.
      const NX = V2 ? Math.max(9, 1 + Math.round((AX1 - AX0) / 11)) : 7;
      const NZ = V2 ? 17 : 13;
      function apronY(z) {
        if (z >= RAMP_Z) return FLAT_Y;
        const t = Math.min(1, (RAMP_Z - z) / (RAMP_Z - AZ_SEA));
        return FLAT_Y + (SEA_FLOOR_Y - FLAT_Y) * t;
      }
      // the geometric waterline: where this ramp crosses mean sea level
      const seaY = CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48;
      const zW = RAMP_Z - (RAMP_Z - AZ_SEA) * (FLAT_Y - seaY) / (FLAT_Y - SEA_FLOOR_Y);

      const n = NX * NZ;
      const pos = new Float32Array(n * 3);
      const nrm = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const vx = new Float32Array(n);          // world x (the swash phase varies along shore)
      const dLand = new Float32Array(n);       // metres inland of the mean waterline
      for (let iz = 0; iz < NZ; iz++) {
        const z = AZ_LAND + (AZ_SEA - AZ_LAND) * iz / (NZ - 1);
        for (let ix = 0; ix < NX; ix++) {
          const x = AX0 + (AX1 - AX0) * ix / (NX - 1);
          const k = iz * NX + ix;
          pos[k * 3] = x; pos[k * 3 + 1] = apronY(z); pos[k * 3 + 2] = z;
          nrm[k * 3 + 1] = 1;                  // flat-lit like the quad it replaces
          vx[k] = x; dLand[k] = z - zW;
        }
      }
      const idx = new Uint16Array((NX - 1) * (NZ - 1) * 6);
      let w = 0;
      // rows run seaward (z DECREASES with iz), so (a,b,c)/(b,d,c) is the
      // winding whose face normal is +Y — same as the quad this replaces.
      for (let iz = 0; iz < NZ - 1; iz++) for (let ix = 0; ix < NX - 1; ix++) {
        const a = iz * NX + ix, b = a + 1, c = a + NX, d = c + 1;
        idx[w++] = a; idx[w++] = b; idx[w++] = c;
        idx[w++] = b; idx[w++] = d; idx[w++] = c;
      }
      const gm = new THREE.BufferGeometry();
      gm.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      gm.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
      gm.setAttribute("color", new THREE.BufferAttribute(col, 3));
      gm.setIndex(new THREE.BufferAttribute(idx, 1));
      // Its OWN material: the cmat pool is shared and must never be mutated,
      // and vertexColors has to be on for any of this to show. The name is
      // deliberately free of "water"/"ocean"/"sea" — tools/test-terrain-water-
      // browser.mjs asserts exactly ONE water-surface mesh and matches on it.
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      mat.name = "beach-swash-sand";
      const m = new THREE.Mesh(gm, mat);
      m.receiveShadow = true; m.castShadow = false; m.matrixAutoUpdate = false;
      // non-empty userData spares it from core/batch.js's merge (we rewrite its
      // buffer every frame); `dynamic` additionally keeps core/farcull.js off it.
      m.userData.beachSwash = true;
      m.userData.dynamic = true;
      root.add(m);

      // WATER_V2 is world/water_spec.js's MASTER off-switch and stands its
      // swash down too, so honour it here or the apron would keep ticking (at
      // a permanent run-up of 0) instead of falling back to the static sand
      // this whole block replaced.
      const CF = CBZ.CONFIG || {};
      const live = CF.WATER_SWASH !== false && CF.WATER_V2 !== false &&
        typeof CBZ.waterSwashAt === "function";
      swash = {
        mesh: m, attr: gm.getAttribute("color"), col: col,
        vx: vx, dLand: dLand, n: n, nx: NX, zW: zW,
        wet: new Float32Array(n), runs: new Float32Array(NX), live: live,
        cx: (AX0 + AX1) / 2, cz: (AZ_LAND + AZ_SEA) / 2,
      };
      if (live) {
        // Start fully soaked; the first frames dry the upper beach back out.
        for (let k = 0; k < n; k++) { swash.wet[k] = 1; paintSwash(k, 1); }
      } else {
        // Flag off (or water_spec.js absent): the exact flat SAND_WET the two
        // static meshes used to be, written once, and never ticked again.
        const s = new THREE.Color(SAND_WET);
        for (let k = 0; k < n; k++) { col[k * 3] = s.r; col[k * 3 + 1] = s.g; col[k * 3 + 2] = s.b; }
      }
      swash.attr.needsUpdate = true;
    })();

    // =====================================================================
    //  2) PALMS — instanced trunks (leaning, like real shoreline palms) +
    //  one InstancedMesh of fronds. Trunks are solid (thin collider).
    // =====================================================================
    const pierX = BX1 - 26;                               // fixed here; pier built below
    const dummy = new THREE.Object3D();
    const palms = [];
    for (let i = 0; i < 9; i++) {
      const x = BX0 + 6 + rng() * (BW - 12);
      const z = ES + 7 + rng() * 10;
      if (Math.abs(x - pierX) < 4.5) continue;            // keep the pier approach clear
      palms.push({ x, z, h: 4.2 + rng() * 1.4, lean: (rng() - 0.5) * 0.24, yaw: rng() * Math.PI * 2 });
    }
    // TREES_V2 (config.js): the old crown hub was computed with the WRONG
    // lean sign and NO yaw term (tx = p.x + sin(lean)·h/2 while the true
    // leaned top is p.x − sin(lean)·cos(yaw)·h/2, z-shifted too), so for many
    // yaw/lean combos the whole frond ring hovered BESIDE the trunk top —
    // floating shit, the exact defect class this law exists for. V2 reads
    // the true top straight from the trunk's own instance matrix (local
    // (0, 0.5, 0) through the matrix — no hand-rolled trig to get wrong
    // again), parks a fibrous CROWN HUB there (an extra instance in the SAME
    // trunk InstancedMesh — zero new draw calls), sinks every frond's inner
    // end through the hub, seats the trunk 0.18 under the sand, and
    // registers each palm with world/treeaudit.js. rng draw order untouched.
    const TREES2 = !!(CBZ.CONFIG && CBZ.CONFIG.TREES_V2 !== false && CBZ.treeRegisterTree);
    if (TREES2 && CBZ.treeAuditResetSite) CBZ.treeAuditResetSite("beach");
    const palmTrunkGeo = new THREE.BoxGeometry(0.42, 1, 0.42);
    const palmFrondGeo = new THREE.BoxGeometry(2.7, 0.1, 0.62);
    const trunkIM = new THREE.InstancedMesh(palmTrunkGeo, cmat(0x7a5a33), TREES2 ? palms.length * 2 : palms.length);
    const frondIM = new THREE.InstancedMesh(palmFrondGeo, cmat(0x3f9a4f), palms.length * 6);
    const ptbb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(palmTrunkGeo) : null;
    const pfbb = TREES2 && CBZ.treeGeoBounds ? CBZ.treeGeoBounds(palmFrondGeo) : null;
    let fi = 0;
    palms.forEach((p, i) => {
      dummy.position.set(p.x, TREES2 ? p.h / 2 - 0.18 : p.h / 2, p.z);   // V2: base seated under the sand
      dummy.rotation.set(0, p.yaw, p.lean);
      dummy.scale.set(1, p.h, 1);
      dummy.updateMatrix(); trunkIM.setMatrixAt(i, dummy.matrix);
      let parts = null;
      let tx = p.x + Math.sin(p.lean) * p.h * 0.5, ty = p.h + 0.15, tz = p.z;   // legacy "crown rides the lean"
      if (TREES2) {
        // TRUE trunk-top centre = instance matrix * local (0, 0.5, 0)
        const e = dummy.matrix.elements;
        tx = e[4] * 0.5 + e[12]; ty = e[5] * 0.5 + e[13]; tz = e[6] * 0.5 + e[14];
        if (ptbb) {
          parts = [];
          CBZ.treeAabbPush(parts, dummy.matrix, ptbb.min.x, ptbb.min.y, ptbb.min.z, ptbb.max.x, ptbb.max.y, ptbb.max.z);
        }
        // crown hub: the fibrous boss real palm fronds grow from — an extra
        // instance of the trunk geo (same IM/draw call), wrapping the top.
        dummy.position.set(tx, ty - 0.05, tz);
        dummy.rotation.set(0, p.yaw, p.lean);
        dummy.scale.set(2.0, 0.55, 2.0);
        dummy.updateMatrix(); trunkIM.setMatrixAt(palms.length + i, dummy.matrix);
        if (parts) CBZ.treeAabbPush(parts, dummy.matrix, ptbb.min.x, ptbb.min.y, ptbb.min.z, ptbb.max.x, ptbb.max.y, ptbb.max.z);
      }
      for (let k = 0; k < 6; k++) {
        const a = p.yaw + k * (Math.PI / 3) + rng() * 0.3;
        if (TREES2) {
          // frond centre pulled in so its inner end runs THROUGH the hub
          dummy.position.set(tx + Math.cos(a) * 1.05, ty + 0.02, tz + Math.sin(a) * 1.05);
        } else {
          dummy.position.set(tx + Math.cos(a) * 1.1, ty - 0.18, tz + Math.sin(a) * 1.1);
        }
        dummy.rotation.set(0, -a, 0.34);                  // droop outward
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix(); frondIM.setMatrixAt(fi++, dummy.matrix);
        if (parts && pfbb) CBZ.treeAabbPush(parts, dummy.matrix, pfbb.min.x, pfbb.min.y, pfbb.min.z, pfbb.max.x, pfbb.max.y, pfbb.max.z);
      }
      if (parts) CBZ.treeRegisterTree("beach", 0, parts);   // flat sand band above y=0
      solid(p.x, p.z, 0.7, 0.7, trunkIM, null);
    });
    trunkIM.count = TREES2 ? palms.length * 2 : palms.length; frondIM.count = fi;
    trunkIM.instanceMatrix.needsUpdate = frondIM.instanceMatrix.needsUpdate = true;
    trunkIM.castShadow = frondIM.castShadow = false;
    trunkIM.receiveShadow = frondIM.receiveShadow = true;
    root.add(trunkIM); root.add(frondIM);

    /* ---- THE PALMS CAN BE TAKEN (2026-08-15, TSU_DEBRIS) -----------------
       The tsunami's debris doctrine is REAL OBJECTS ONLY, and the palms are
       the first thing a wave over this beach would rip out — but they live
       in two InstancedMeshes, and an instance cannot leave its pool. So the
       pool sells the palm: take(i) zero-scales the palm's instances (trunk,
       crown hub, six fronds), drops its trunk collider, and hands back a
       REAL group built from the SAME geometry and the SAME pooled material,
       pivoted at the trunk's middle so it tumbles like a tree and not like
       a flag. Nothing is invented: it is the identical palm, re-plumbed
       from one draw call into its own. Runtime-only (Math.random jitter,
       never rng) so the build stream stays deterministic. */
    palmField = {
      list: palms,
      take(i) {
        const p = palms[i];
        if (!p || p._taken) return null;
        p._taken = 1;
        const zero = new THREE.Matrix4().makeScale(0, 0, 0);
        trunkIM.setMatrixAt(i, zero);
        if (TREES2) trunkIM.setMatrixAt(palms.length + i, zero);
        for (let k = 0; k < 6; k++) frondIM.setMatrixAt(i * 6 + k, zero);
        trunkIM.instanceMatrix.needsUpdate = frondIM.instanceMatrix.needsUpdate = true;
        // the trunk stops being a wall the moment it is wreckage
        if (CBZ.colliders) for (let c = CBZ.colliders.length - 1; c >= 0; c--) {
          const col = CBZ.colliders[c];
          if (col.ref !== trunkIM) continue;
          if (p.x < col.minX || p.x > col.maxX || p.z < col.minZ || p.z > col.maxZ) continue;
          CBZ.colliders.splice(c, 1);
          if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
          break;
        }
        // the real palm, rebuilt in local space around the trunk's middle
        const grp = new THREE.Group();
        const d2 = new THREE.Object3D();
        d2.rotation.set(0, p.yaw, p.lean); d2.scale.set(1, p.h, 1); d2.updateMatrix();
        const trunk = new THREE.Mesh(palmTrunkGeo, trunkIM.material);
        trunk.rotation.set(0, p.yaw, p.lean); trunk.scale.set(1, p.h, 1);
        grp.add(trunk);
        const e = d2.matrix.elements;
        const tx = e[4] * 0.5, ty = e[5] * 0.5, tz = e[6] * 0.5;   // trunk top, group-local
        const hub = new THREE.Mesh(palmTrunkGeo, trunkIM.material);
        hub.position.set(tx, ty - 0.05, tz);
        hub.rotation.set(0, p.yaw, p.lean); hub.scale.set(2.0, 0.55, 2.0);
        grp.add(hub);
        for (let k = 0; k < 6; k++) {
          const a = p.yaw + k * (Math.PI / 3) + Math.random() * 0.3;
          const fr = new THREE.Mesh(palmFrondGeo, frondIM.material);
          fr.position.set(tx + Math.cos(a) * 1.05, ty + 0.02, tz + Math.sin(a) * 1.05);
          fr.rotation.set(0, -a, 0.34);
          grp.add(fr);
        }
        grp.position.set(p.x, p.h / 2 - 0.18, p.z);
        root.add(grp);
        return { group: grp, x: p.x, z: p.z };
      },
    };

    // =====================================================================
    //  3) SUNBATHER CLUSTERS — umbrella + towels per spot, instanced with
    //  per-instance colors (guarded setColorAt). The LOOT lives here.
    // =====================================================================
    const spots = [];
    for (let i = 0; i < 7; i++) {
      const x = BX0 + 8 + (i + 0.2 + rng() * 0.5) * (BW - 16) / 7;
      const z = ES + 1.5 + rng() * 9;
      if (Math.abs(x - pierX) < 4.5) continue;
      spots.push({ x, z });
    }
    const UMB_COLS = [0xe24b4b, 0xf2c43d, 0x3c6fd6, 0x4caf6e, 0xe8e8ee];
    const TOWEL_COLS = [0xe88a3c, 0x3c6fd6, 0xe24b4b, 0xf2eee0, 0x4caf6e, 0x8a4ae2];
    const poleIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 2.3, 0.09), cmat(0xd9d2bd), spots.length);
    const umbMat = new THREE.MeshLambertMaterial({ color: 0xffffff }); umbMat._shared = true;
    const umbIM = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 0.62, 8), umbMat, spots.length);
    const towMat = new THREE.MeshLambertMaterial({ color: 0xffffff }); towMat._shared = true;
    const towIM = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 0.05, 0.95), towMat, spots.length * 2);
    let ti = 0;
    spots.forEach((sp, i) => {
      const tilt = (rng() - 0.5) * 0.2;
      dummy.position.set(sp.x, 1.15, sp.z); dummy.rotation.set(tilt, 0, tilt); dummy.scale.set(1, 1, 1);
      dummy.updateMatrix(); poleIM.setMatrixAt(i, dummy.matrix);
      dummy.position.set(sp.x + tilt * 2.2, 2.18, sp.z + tilt * 2.2);
      dummy.updateMatrix(); umbIM.setMatrixAt(i, dummy.matrix);
      if (umbIM.setColorAt) umbIM.setColorAt(i, new THREE.Color(UMB_COLS[(rng() * UMB_COLS.length) | 0]));
      const nt = 1 + (rng() < 0.6 ? 1 : 0);
      for (let k = 0; k < nt; k++) {
        const a = rng() * Math.PI * 2, d = 1.6 + rng() * 1.3;
        dummy.position.set(sp.x + Math.cos(a) * d, 0.085, sp.z + Math.sin(a) * d);
        dummy.rotation.set(0, rng() * Math.PI, 0);
        dummy.updateMatrix(); towIM.setMatrixAt(ti, dummy.matrix);
        if (towIM.setColorAt) towIM.setColorAt(ti, new THREE.Color(TOWEL_COLS[(rng() * TOWEL_COLS.length) | 0]));
        ti++;
      }
    });
    towIM.count = ti;
    poleIM.instanceMatrix.needsUpdate = umbIM.instanceMatrix.needsUpdate = towIM.instanceMatrix.needsUpdate = true;
    if (umbIM.instanceColor) umbIM.instanceColor.needsUpdate = true;
    if (towIM.instanceColor) towIM.instanceColor.needsUpdate = true;
    poleIM.castShadow = umbIM.castShadow = towIM.castShadow = false;
    root.add(poleIM); root.add(umbIM); root.add(towIM);

    // =====================================================================
    //  3b) THE FURNITURE YOU CAN ACTUALLY LIE ON.
    //
    //  A towel is a decal. These are city/furniture.js pieces, which means
    //  they arrive already registered with city/propuse.js — so lying on a
    //  lounger runs the SAME phased arc as getting into a bed (walk → perch
    //  on the edge → swing the legs up), and dropping into a deck chair runs
    //  the same arc as an office chair. Nothing here animates a body: the
    //  beach only says WHERE the furniture is, and the shared arcs own how
    //  anyone gets onto it. That is the whole point — a deck chair on a beach
    //  and a chair behind a desk are the same verb.
    //
    //  Drawn through a local `box` so the pieces land in the city root (and
    //  batch with everything else) instead of CBZ.addBox's bare scene add.
    //  Degrade-safe: no CBZ.furnish (FURNISH_KIT=false) → no beach furniture
    //  and no anchors, exactly as before this section existed.
    // =====================================================================
    const CANVAS = [0xe24b4b, 0xf2c43d, 0x3c6fd6, 0x4caf6e, 0xe88a3c, 0xe8e8ee];
    const SEAWARD = Math.PI;        // forward = (sin yaw, cos yaw); the water is at low z
    function furnBox(bx, by, bz, w, h, d, color, o) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cmat(color));
      m.position.set(bx, by, bz);
      m.castShadow = !!(o && o.cast); m.receiveShadow = true;
      root.add(m);
      if (o && o.solid) {
        const c = { minX: bx - w / 2, maxX: bx + w / 2, minZ: bz - d / 2, maxZ: bz + d / 2, ref: m, noCam: true };
        if (o.y0 != null) c.y0 = o.y0;
        if (o.y1 != null) c.y1 = o.y1;
        CBZ.colliders.push(c);
      }
      return m;
    }
    if (CBZ.furnish) {
      const SAND_TOP = 0.06;                 // the sand band's own surface height
      spots.forEach(function (sp) {
        const n = 1 + (rng() < 0.55 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const fx = sp.x + (k ? 1.7 : -1.7) + (rng() - 0.5) * 0.6;
          const fz = sp.z - 2.5 - rng() * 1.4;              // seaward of the umbrella
          const yaw = SEAWARD + (rng() - 0.5) * 0.55;       // nobody lines them up
          const tone = { cloth: CANVAS[(rng() * CANVAS.length) | 0], frame: 0xd9d2bd };
          const o = { box: furnBox, solid: true, tone: tone };
          // Loungers outnumber deck chairs the way they do on a real beach —
          // and the mix is what makes both arcs visible from one spot.
          if (rng() < 0.62) {
            const r = CBZ.furnish.lounger(fx, SAND_TOP, fz, yaw, o);
            if (r && r.beds && r.beds[0]) chairs.push({ rec: r.beds[0], lie: 1 });
          } else {
            const r = CBZ.furnish.deckchair(fx, SAND_TOP, fz, yaw, o);
            if (r && r.seats && r.seats[0] && r.seats[0].rec) chairs.push({ rec: r.seats[0].rec, lie: 0 });
          }
        }
      });
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }

    // THE VALUABLES: a cooler or beach bag beside 5 of the clusters. Material
    // swap full↔empty (the roofloot pattern) — a full one glints.
    spots.slice(0, 5).forEach((sp, i) => {
      const bag = i >= 3;                                  // 3 coolers + 2 bags
      const lx = sp.x + (rng() < 0.5 ? -2.3 : 2.3), lz = sp.z + (rng() - 0.5) * 1.6;
      let body;
      if (bag) {
        body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.5, 0.45), BAG_FULL());
        body.position.set(lx, 0.3, lz);
      } else {
        body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.5), LOOT_FULL());
        body.position.set(lx, 0.33, lz);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.08, 0.56), cmat(0xe8ebee));
        lid.position.set(lx, 0.62, lz); lid.castShadow = false; root.add(lid);
      }
      body.rotation.y = rng() * Math.PI;
      body.castShadow = false; body.receiveShadow = true; root.add(body);
      loot.push({ x: lx, z: lz, body, bag, looted: false, t: 0 });
    });

    // lifeguard chair — the beach's landmark; tall white frame + red roof.
    // AND SOMEBODY SITS IN IT. A lifeguard tower with nobody watching the water
    // is the clearest "stage set" tell on this whole beach, so the seat deck
    // now carries a real propuse anchor with a DECLARED cushion (0.34 above the
    // deck, the height of the pad drawn below) and city/citystaff.js puts a
    // Lifeguard on it. Declared, so the rig gets character.js's real
    // feet-on-the-deck chair solve instead of the legacy squat.
    (function lifeguard() {
      const lgx = BX1 - 10, lgz = ES + 6;
      const white = [];
      white.push(boxGeoAt(lgx - 0.7, 1.2, lgz - 0.6, 0.16, 2.4, 0.16));
      white.push(boxGeoAt(lgx + 0.7, 1.2, lgz - 0.6, 0.16, 2.4, 0.16));
      white.push(boxGeoAt(lgx - 0.7, 1.2, lgz + 0.6, 0.16, 2.4, 0.16));
      white.push(boxGeoAt(lgx + 0.7, 1.2, lgz + 0.6, 0.16, 2.4, 0.16));
      white.push(boxGeoAt(lgx, 2.35, lgz, 1.7, 0.12, 1.5));            // seat deck
      white.push(boxGeoAt(lgx, 2.95, lgz + 0.65, 1.7, 1.1, 0.12));     // backrest (faces the water)
      white.push(boxGeoAt(lgx, 1.5, lgz - 0.78, 1.5, 0.1, 0.12));      // ladder rung reads
      white.push(boxGeoAt(lgx, 0.9, lgz - 0.78, 1.5, 0.1, 0.12));
      mergeAdd(white, cmat(0xe8ebee), { cast: true });
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.1, 1.9), cmat(0xc23434));
      roof.position.set(lgx, 3.8, lgz); roof.castShadow = false; root.add(roof);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 0.1), cmat(0xe8ebee));
      post.position.set(lgx, 3.15, lgz - 0.6); root.add(post);
      // Height-capped at the deck (was full-height): the platform record right
      // below has always PROMISED you can stand up there, and an uncapped
      // collider is what stopped you. It is also what lets the seat anchor
      // below resolve a clear entry — propuse's clearAt skips any collider
      // whose y1 is under the anchor, so this keeps propUseAudit().blocked
      // exactly where it was instead of adding one more unreachable seat.
      solid(lgx, lgz, 1.8, 1.6, roof, 2.4);
      CBZ.platforms.push({ minX: lgx - 0.85, maxX: lgx + 0.85, minZ: lgz - 0.75, maxZ: lgz + 0.75, top: 2.4 });
      // the seat pad itself (there was none — the "seat deck" was a bare
      // plank), then the anchor that makes it usable furniture.
      const pad = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, 1.1), cmat(0xc23434));
      pad.position.set(lgx, 2.55, lgz + 0.05); pad.castShadow = false; root.add(pad);
      // faces the WATER (-z): a lifeguard who watches the car park is a joke.
      lifeguardSeat = CBZ.propRegisterSeat
        ? CBZ.propRegisterSeat(lgx, 2.41, lgz + 0.05, Math.PI, "chair", null, { cushion: 0.28, floorBelow: 0 })
        : null;
      lifeguardPost = { x: lgx, z: lgz - 1.6, face: Math.PI };
    })();

    // =====================================================================
    //  4) BOARDWALK — a raised plank promenade along the top of the sand.
    //  Planks merge into TWO meshes (alternating tones). It's a real
    //  platform (CBZ.platforms) so you walk ON it, 0.3 up.
    // =====================================================================
    const bwZ = innerZ - 3.4, bwW = 4.4, bwTop = 0.3;
    const planksA = [], planksB = [];
    for (let x = BX0 + 2.5; x <= BX1 - 2.5; x += 1.08) {
      (((x / 1.08) | 0) % 2 ? planksA : planksB).push(boxGeoAt(x, bwTop - 0.04, bwZ, 1.0, 0.08, bwW));
    }
    // skirt boards along both long edges (hides the gap under the deck)
    planksA.push(boxGeoAt((BX0 + BX1) / 2, 0.13, bwZ - bwW / 2, BW - 4, 0.26, 0.1));
    planksA.push(boxGeoAt((BX0 + BX1) / 2, 0.13, bwZ + bwW / 2, BW - 4, 0.26, 0.1));
    mergeAdd(planksA, cmat(WOOD_A));
    mergeAdd(planksB, cmat(WOOD_B));
    CBZ.platforms.push({ minX: BX0 + 2, maxX: BX1 - 2, minZ: bwZ - bwW / 2, maxZ: bwZ + bwW / 2, top: bwTop });

    // SNACK SHACK — a hut with a service counter + striped awning facing the
    // sand (props.js shop-stall read, self-contained). Solid.
    (function shack() {
      const sx = BX0 + 14, sz = bwZ;
      const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.5, 2.8), cmat(0xd9b96a));
      body.position.set(sx, bwTop + 1.25, sz); body.castShadow = true; body.receiveShadow = true; root.add(body);
      const roofM = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.16, 3.3), cmat(0x8a4a2e));
      roofM.position.set(sx, bwTop + 2.62, sz); roofM.castShadow = false; root.add(roofM);
      const counter = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.14, 0.6), cmat(WOOD_DK));
      counter.position.set(sx, bwTop + 1.1, sz - 1.65); root.add(counter);    // serving shelf, sand side
      const awn = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.08, 1.5), cmat(0xe24b4b));
      awn.position.set(sx, bwTop + 2.25, sz - 2.0); awn.rotation.x = 0.3; awn.castShadow = false; root.add(awn);
      solid(sx, sz, 4.4, 3.0, body, null);
    })();

    // two VENDOR STALLS — 4 posts + canopy + counter each (the market-stall
    // construction pattern), canopies in different colors. Counters solid.
    function stall(sx, canopyC) {
      const sz = bwZ;
      const woods = [];
      for (let ix = -1; ix <= 1; ix += 2) for (let iz = -1; iz <= 1; iz += 2)
        woods.push(boxGeoAt(sx + ix * 1.1, bwTop + 1.05, sz + iz * 0.9, 0.12, 2.1, 0.12));
      woods.push(boxGeoAt(sx, bwTop + 0.55, sz, 2.3, 0.5, 1.7));      // goods table
      mergeAdd(woods, cmat(WOOD_DK), { cast: true });
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.1, 2.3), cmat(canopyC));
      canopy.position.set(sx, bwTop + 2.18, sz); canopy.rotation.z = 0.06; canopy.castShadow = false; root.add(canopy);
      solid(sx, sz, 2.4, 1.8, canopy, 1.4);
      // AND SOMEBODY TO SELL YOU SOMETHING. A stall with no vendor is a table.
      // He stands on the landward side of his own goods table, facing the sand
      // (the side the customers walk past on) — the same read props.js's shop
      // stalls have. "street vendor" is already a real trade in aigoals.js's
      // CITY_JOBS, so he arrives with a shift and a wage, not just a label.
      stallSpots.push({ x: sx, z: sz + 1.5, face: Math.PI });
    }
    stall(BX0 + 34, 0xf2c43d);
    stall(BX0 + 46, 0x3c6fd6);

    // =====================================================================
    //  5) THE PIER — planks out over the water on instanced posts, side
    //  rails (height-gated colliders: lean on them, JUMP them to dive),
    //  and the end payoff: a wider head with a bench + telescope. The deck
    //  is a platform at 0.85 — under STEP_UP, so you stroll straight on
    //  from the sand and stand DRY over the harbor (swim.js only takes
    //  you below y 0.6).
    // =====================================================================
    (function pier() {
      const pw = 5.2, top = 0.85;
      const z0 = ES + 5, z1 = ES - 36;                     // sand → open water
      const headW = 9.4, headZ1 = z1 - 8;
      const pA = [], pB = [];
      let n = 0;
      for (let z = z0 - 0.5; z >= z1; z -= 1.06) (n++ % 2 ? pA : pB).push(boxGeoAt(pierX, top - 0.04, z, pw, 0.08, 0.98));
      for (let z = z1 - 0.6; z >= headZ1; z -= 1.06) (n++ % 2 ? pA : pB).push(boxGeoAt(pierX, top - 0.04, z, headW, 0.08, 0.98));
      // entry steps off the sand (the read; STEP_UP does the real work)
      pA.push(boxGeoAt(pierX, 0.14, z0 + 0.8, pw - 0.6, 0.28, 0.9));
      pA.push(boxGeoAt(pierX, 0.42, z0 + 0.1, pw - 0.6, 0.28, 0.9));
      mergeAdd(pA, cmat(WOOD_A));
      mergeAdd(pB, cmat(WOOD_B));
      CBZ.platforms.push({ minX: pierX - pw / 2, maxX: pierX + pw / 2, minZ: z1, maxZ: z0, top });
      CBZ.platforms.push({ minX: pierX - headW / 2, maxX: pierX + headW / 2, minZ: headZ1, maxZ: z1, top });

      // posts: one InstancedMesh, pairs down the walkway + head corners
      const posts = [];
      for (let z = z0 - 2; z >= z1; z -= 5.5) { posts.push([pierX - pw / 2 + 0.25, z]); posts.push([pierX + pw / 2 - 0.25, z]); }
      posts.push([pierX - headW / 2 + 0.3, headZ1 + 0.4]); posts.push([pierX + headW / 2 - 0.3, headZ1 + 0.4]);
      posts.push([pierX - headW / 2 + 0.3, z1 - 0.4]); posts.push([pierX + headW / 2 - 0.3, z1 - 0.4]);
      const postIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 3.4, 0.3), cmat(WOOD_DK), posts.length);
      posts.forEach((p, i) => {
        dummy.position.set(p[0], top - 1.85, p[1]); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
        dummy.updateMatrix(); postIM.setMatrixAt(i, dummy.matrix);
      });
      postIM.instanceMatrix.needsUpdate = true; postIM.castShadow = false; root.add(postIM);

      // side rails down the walkway (top + mid), merged; gated colliders so
      // you can't drift off mid-stroll but a jump clears them — the dive
      const rails = [];
      const rlen = z0 - z1;
      for (const sx of [pierX - pw / 2 + 0.1, pierX + pw / 2 - 0.1]) {
        rails.push(boxGeoAt(sx, top + 0.95, (z0 + z1) / 2, 0.1, 0.09, rlen));
        rails.push(boxGeoAt(sx, top + 0.5, (z0 + z1) / 2, 0.08, 0.07, rlen));
        for (let z = z0 - 1; z >= z1; z -= 5.5) rails.push(boxGeoAt(sx, top + 0.5, z, 0.09, 1.0, 0.09));
        CBZ.colliders.push({ minX: sx - 0.12, maxX: sx + 0.12, minZ: z1, maxZ: z0, ref: postIM, y0: top, y1: top + 1.0, noCam: true });
      }
      mergeAdd(rails, cmat(0xe8ebee));

      // A couple of rods leaning on the head rail mark real fishing stations.
      // THEY ARE NO LONGER PROPS OF AN ABSENT PERSON: each rod gets an angler
      // standing behind it (city/citystaff.js) and registers a FISHING STATION
      // (city/fishing.js) so the same spot the NPC works is the spot the player
      // can work. The rod mesh stays exactly where it was — the fisherman's own
      // rod is his, drawn by fishing.js, and these are the spares on the rail.
      for (const rx of [pierX - headW / 2 + 1.2, pierX + headW / 2 - 2.0]) {
        const rod = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.6, 0.05), cmat(WOOD_DK));
        rod.position.set(rx, top + 1.2, headZ1 + 0.7); rod.rotation.x = -0.5; rod.castShadow = false; root.add(rod);
        anglerSpots.push({ x: rx, z: headZ1 + 1.5, face: Math.PI, y: top });
        if (CBZ.fishSpotRegister) {
          // rod:false — the rod on the rail above IS this station's rod; letting
          // fishing.js draw a second one would be two rods for one line.
          CBZ.fishSpotRegister(rx, headZ1 + 1.5, {
            name: "Pier Head", face: Math.PI, y: top, rod: false,
            water: { x: rx, z: headZ1 - 6 },
          });
        }
      }
    })();

    // =====================================================================
    //  5b) THE FLOATING DOCK + ITS GANGWAY — the pier's payoff, and the
    //  first thing in this game you can stand on WHILE IT MOVES.
    //
    //  Both are systems/platforms_moving.js rigs, which is the whole point:
    //  their walk surfaces live in the parent group's LOCAL frame, so they
    //  stay correct at any heave/pitch/roll/heading instead of being a
    //  world-space CBZ.platforms AABB that is a lie the moment the thing
    //  turns. The dock rides the LIVE swell through CBZ.waterRideAt — the
    //  same 4-probe hull-attitude query every floating body in this game
    //  uses — and ranges on its mooring lines the way a real dock does, so
    //  standing at its seaward corner genuinely lifts and drops you and
    //  standing off-centre while it swings genuinely carries you through
    //  the arc.
    //
    //  The GANGWAY is the access route and the second rig: hinged on the
    //  pier head, resting on the dock's inboard edge, its slope recomputed
    //  every frame from the dock's live deck height. Its deck is longer
    //  than the nominal gap so the dock's surge can never open a hole to
    //  fall through — which is what the rollers on a real brow are for.
    //
    //  FREEBOARD IS LOAD-BEARING, not styling: city/swim.js takes you into
    //  the water whenever your feet are within WADE_ABOVE (1.08m) of the
    //  live surface, so a deck you can stand on out here has to clear it.
    //  The deck sits 1.50m above the dock's own ride surface, and because
    //  the whole rig heaves WITH that surface, the clearance is constant by
    //  construction — a swell can never close it. (The pier next door plays
    //  the same trick with a static 1.33m.)
    //
    //  Degrade-safe: no CBZ.movingPlatform → no dock at all, rather than a
    //  raft you fall through. Nothing else in the beach changes, and the
    //  build draws NO rng() (the beach's deterministic stream is untouched).
    // =====================================================================
    (function floatingDock() {
      if (!CBZ.movingPlatform) return;
      // mirrors the pier block's own constants (that block is an IIFE)
      const PIER_TOP = 0.85, headW = 9.4, headZ1 = (ES - 36) - 8;
      const GW_Z = headZ1 + 3.0;                  // out on the pier head, clear of the bench
      const HINGE_X = pierX + headW / 2 - 0.25;   // gangway's fixed end, on the pier deck
      const DOCK_X = pierX + headW / 2 + 8.3;     // dock centre, nominal (it ranges ±0.5 on its lines)
      const DOCK_Z = GW_Z;
      const DECK_TOP = 1.50;                      // LOCAL deck height above the ride surface
      const DW = 7.0, DD = 5.0;                   // deck size
      const LAND_IN = 2.9;                        // how far inboard the gangway lands on the deck
      const GW_W = 1.7;                           // gangway width
      const GW_L = (DOCK_X - LAND_IN - HINGE_X) + 1.4;   // + 0.7 of overlap at each end

      // ---- the dock body (all LOCAL to dockGrp; +y is up from the waterline)
      const dockGrp = new THREE.Group();
      dockGrp.position.set(DOCK_X, CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48, DOCK_Z);
      dockGrp.userData.dynamic = true;            // core/batch.js must not merge a moving group away
      root.add(dockGrp);
      function part(parent, x, y, z, w, h, d, col, cast) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cmat(col));
        m.position.set(x, y, z); m.castShadow = !!cast; m.receiveShadow = true;
        parent.add(m); return m;
      }
      part(dockGrp, 0, 0.05, 0, DW + 0.2, 1.30, DD + 0.2, 0x6f6a60);          // pontoon raft, half-drowned
      part(dockGrp, 0, 0.72, 0, DW + 0.3, 0.10, DD + 0.3, 0x2e3238);          // rub strake
      for (let ix = -1; ix <= 1; ix += 2) for (let iz = -1; iz <= 1; iz += 2)
        part(dockGrp, ix * 2.9, 1.05, iz * 2.1, 0.26, 0.72, 0.26, WOOD_DK);   // stub columns
      part(dockGrp, 0, 1.42, 0, DW, 0.16, DD, WOOD_A, true);                  // the sun deck (top = 1.50)
      // kick rails along the two long edges — LOCAL walls, so they stay put
      // relative to the deck at every heading. The inboard (gangway) and
      // seaward faces are deliberately OPEN: this is a dive stage.
      for (const sz of [-1, 1]) part(dockGrp, 0, 1.95, sz * 2.56, DW, 0.90, 0.12, 0xd9d2bd);

      // ---- the gangway (LOCAL to gwGrp; its deck top is local y = 0) ----
      const gwGrp = new THREE.Group();
      gwGrp.userData.dynamic = true;
      root.add(gwGrp);
      part(gwGrp, 0, -0.05, 0, GW_L, 0.10, GW_W, WOOD_B);                     // the brow itself
      for (const sz of [-1, 1]) {
        part(gwGrp, 0, 0.52, sz * 0.85, GW_L, 0.08, 0.08, 0xe8ebee);          // handrail
        for (let i = 0; i < 5; i++)
          part(gwGrp, -GW_L / 2 + (i + 0.5) * (GW_L / 5), 0.26, sz * 0.85, 0.07, 0.55, 0.07, 0xe8ebee);
      }

      // ---- ONE LINE EACH: the decks and walls, in the parents' LOCAL frames.
      // camYaw stays FALSE (the default): the dock's mooring swing must never
      // grab the player's view. Their BODY turns with it, which is invisible.
      const dockRig = CBZ.movingPlatform(dockGrp, {
        id: "beach-floating-dock",
        decks: [{ x: 0, z: 0, w: DW, d: DD, top: DECK_TOP }],
        walls: [
          { x: 0, z: -2.56, w: DW, d: 0.12, y0: DECK_TOP, y1: DECK_TOP + 0.9 },
          { x: 0, z: 2.56, w: DW, d: 0.12, y0: DECK_TOP, y1: DECK_TOP + 0.9 },
        ],
      });
      const gwRig = CBZ.movingPlatform(gwGrp, {
        id: "beach-dock-gangway",
        decks: [{ x: 0, z: 0, w: GW_L, d: GW_W, top: 0 }],
        walls: [
          { x: 0, z: -0.9, w: GW_L, d: 0.10, y0: 0, y1: 1.0 },
          { x: 0, z: 0.9, w: GW_L, d: 0.10, y0: 0, y1: 1.0 },
        ],
      });

      dock = {
        grp: dockGrp, gw: gwGrp, rig: dockRig, gwRig: gwRig,
        x: DOCK_X, z: DOCK_Z, deckTop: DECK_TOP, len: DW + 0.2, beam: DD + 0.2,
        hingeX: HINGE_X, hingeY: PIER_TOP, gwZ: GW_Z, landIn: LAND_IN,
        ride: { y: 0, pitch: 0, roll: 0 },
      };
    })();

    /* =====================================================================
       6) THE REST OF THE APRON — the west quay PARKING LOT.

       WHAT WAS THERE, and it was wrong three ways at once (2026-08-15):

       · 15 STALLS. A city beach with a car park for fifteen cars is a car
         park drawn to fill a gap in the apron, not one sized to the place it
         serves. The west quay is 26 m of made ground running the whole
         seaboard and the lot used 81 m of it.
       · THE STALLS WERE NOT STALLS. 5.4 m of z per bay across an 11 m depth
         is one 5.4 x 11 box per car — twice the width and twice the depth of
         a standard 2.74 x 5.49 stall — with no aisle inside it at all, and
         one long "aisle line" painted down the middle of the boxes. Nothing
         about it corresponded to how a car occupies ground.
       · IT WAS PAINTED ACROSS A HIGHWAY. world.js opens a 26 m gap in the
         WEST seawall at wgz +/- 13 for island_military.js's causeway (see
         its WGATE note), and this lot ran z = cz-38 .. cz+43 — straight over
         the causeway mouth. Painted bays across a live carriageway is the
         same class of mistake as a berth registered on dry land: the paint
         said park here and the road said do not.

       It is now two real double-loaded modules (ULI: 2.74 x 5.49 stall,
       7.32 m two-way aisle, 18.30 m module) laid NORTH and SOUTH of the
       causeway mouth, solved off the gap rather than around it — so the
       beach traffic has somewhere to leave a car, and the causeway keeps its
       mouth. The south-east corner of the apron stays deliberately open.
       ===================================================================== */
    const beachBays = [];
    (function parking() {
      const STALL_W = 2.74, STALL_D = 5.49, AISLE = 7.32;
      const MODULE = STALL_D * 2 + AISLE;                  // 18.30
      // the quay strip: the seawall stands at minX-26 (world.js EW), so the
      // lot's west edge keeps 3 m off it and its east edge keeps the old 4.5 m
      // shoulder against the city's own kerb line.
      const x1 = minX - 4.5, x0 = x1 - MODULE;
      const rowCx = [x0 + STALL_D / 2, x1 - STALL_D / 2];   // the two stall rows
      // THE CAUSEWAY MOUTH, read from the same dial world.js reads. A lot that
      // hard-codes cz here would drift off the gap the day the military island
      // moves, which is exactly what the seawall gate's own comment warns of.
      const _MILW = (CBZ.worldOff && CBZ.worldOff("military")) || { dx: 0, dz: 0 };
      const wgz = cz + _MILW.dz, GAP = 16;                 // 13 m of deck + a 3 m shoulder
      const stripes = [], kerbs = [];
      function block(z0, z1) {
        const n = Math.floor((z1 - z0) / STALL_W);
        if (n < 4) return;
        const zBase = z0 + ((z1 - z0) - n * STALL_W) / 2;
        for (let r = 0; r < 2; r++) {
          for (let i = 0; i <= n; i++) {
            stripes.push(boxGeoAt(rowCx[r], 0.03, zBase + i * STALL_W, STALL_D, 0.012, 0.2));
          }
          // the kerb the row backs onto — the thing that makes a bay a bay
          // rather than a rectangle of paint you can drive straight over.
          const kx = r === 0 ? x0 + 0.07 : x1 - 0.07;
          kerbs.push(boxGeoAt(kx, 0.07, (zBase + zBase + n * STALL_W) / 2, 0.14, 0.14, n * STALL_W));
          for (let i = 0; i < n; i++) {
            beachBays.push({ x: rowCx[r], z: zBase + (i + 0.5) * STALL_W });
          }
        }
        // the aisle's own centre line
        stripes.push(boxGeoAt((x0 + x1) / 2, 0.03, (zBase + zBase + n * STALL_W) / 2, 0.18, 0.012, n * STALL_W));
      }
      block(cz - 88, wgz - GAP);                            // south of the causeway
      block(wgz + GAP, cz + 88);                            // north of it
      mergeAdd(stripes, cmat(0xd8dce0), { receive: false });
      mergeAdd(kerbs, cmat(0xb4b8bc), { receive: false });
    })();

    /* ---- AND CARS IN IT. A 100-bay lot with nothing in it reads abandoned,
       which is the failure city/island_speedway.js's own audit note describes:
       "a painted bay with no metal in it". Deferred exactly like
       govcomplex.js's §8 car park, for exactly the same reason — cityMakeCar
       reaches into CBZ.city.arena, which mode.js only assigns after buildCity()
       returns. Fill rate + hard ceiling, because metal is the expensive part
       and a beach lot is meant to look USED, not full. */
    if (CBZ.onUpdate && beachBays.length) {
      let beachParked = false;
      CBZ.onUpdate(55.3, function () {
        if (beachParked) return;
        if (!CBZ.cityMakeCar || !CBZ.cityEcon || !CBZ.cityEcon.CARS || !CBZ.city || !CBZ.city.arena) return;
        beachParked = true;
        const CARS = CBZ.cityEcon.CARS;
        if (!CARS.length) return;
        const n = Math.min(16, Math.max(1, Math.round(beachBays.length * 0.22)));
        const stride = Math.max(1, Math.floor(beachBays.length / n));
        // deterministic: the beach's own seeded stream, never Math.random
        for (let k = 0, i = (rng() * stride) | 0; k < n && i < beachBays.length; k++, i += stride) {
          const s = beachBays[i];
          try {
            // heading PI/2 = nose along +x, which is the axis these stalls
            // run on (5.49 m of depth in X, 2.74 m of width in Z) — so
            // `vertical` is FALSE here, unlike the gov lots whose bays run
            // the other way. A car flagged vertical while pointing across the
            // axis is the kind of quiet disagreement that only shows up when
            // something else asks the record which way it is facing.
            const c = CBZ.cityMakeCar(s.x, s.z, Math.PI / 2, false, CARS[(rng() * CARS.length) | 0], 0);
            if (c) { c.ai = false; c.v = 0; c.baseV = 0; c.road = null; }
          } catch (e) { /* no vehicle path in this build — the stalls stay empty */ }
        }
      });
    }

    // =====================================================================
    //  7) THE PEOPLE WHO WORK THE BEACH.
    //
    //  OWNER: "every place should have the people who work there." This beach
    //  built a lifeguard chair nobody sat in, two market stalls with no vendor
    //  and two fishing rods with no angler — three pieces of geometry whose
    //  entire meaning is the person who is missing from them.
    //
    //  No beach body, no beach brain and no beach update loop, exactly like
    //  the sunbathers below: CBZ.cityStaffPost declares the job, occupy.js's
    //  cityPostNpc mints an ORDINARY ped when you are near enough to see it,
    //  propuse.js seats the lifeguard, and peds.js's own posted-staff brain
    //  holds each of them at their station. They are killable through the feed,
    //  aimable, and interactions.js offers the normal ped verbs on them.
    // =====================================================================
    if (CBZ.cityStaffPost && CBZ.cityStaffVenue) {
      CBZ.cityStaffVenue("beach", { stations: 5, note: "lifeguard chair, 2 stalls, 2 rods" });
      if (lifeguardPost) {
        CBZ.cityStaffPost({
          venue: "beach", id: "beach:lifeguard", job: "lifeguard", archetype: "worker",
          x: lifeguardPost.x, z: lifeguardPost.z, face: lifeguardPost.face,
          seat: function () { return lifeguardSeat; },
          // red trunks + a whistle is the whole uniform; the tan is the wealth
          // read, and he is the one person on this beach who is on duty.
          opts: { outfit: 0xc23434, wealth: 0.35, aggr: 0.1 },
        });
      }
      stallSpots.forEach(function (s, i) {
        CBZ.cityStaffPost({
          venue: "beach", id: "beach:vendor:" + i, job: "street vendor", archetype: "merchant",
          x: s.x, z: s.z, face: s.face, pose: "table",
          opts: { wealth: 0.4, floorY: bwTop },      // he stands ON the boardwalk deck
        });
      });
      anglerSpots.forEach(function (s, i) {
        CBZ.cityStaffPost({
          venue: "beach", id: "beach:angler:" + i, job: "fisherman", archetype: "laborer",
          x: s.x, z: s.z, face: s.face, pose: "table",
          opts: { wealth: 0.28, floorY: s.y },
          after: function (ped) { if (CBZ.fishWorkRod) CBZ.fishWorkRod(ped, s); },
        });
      });
    }

    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  };

  // =====================================================================
  //  THE LOOT LOOP — [E] rifles a full cooler/bag for cash. Petty theft if
  //  witnessed (the existing chokepoint decides), restocks after minutes.
  //  Same chip + document-keydown pattern as roofloot.js.
  // =====================================================================
  function setLook(L, full) {
    L.body.material = full ? (L.bag ? BAG_FULL() : LOOT_FULL()) : (L.bag ? BAG_EMPTY() : LOOT_EMPTY());
  }
  function rifle(L) {
    L.looted = true;
    L.t = RESPAWN * (0.8 + Math.random() * 0.6);
    setLook(L, false);
    const cash = 40 + ((Math.random() * 120) | 0) + (L.bag ? 30 : 0);
    CBZ.city.addCash(cash);
    if (CBZ.sfx) CBZ.sfx("coin");
    CBZ.city.note("Rifled the " + (L.bag ? "beach bag" : "cooler") + " — $" + cash + ". Nobody locks up at the beach.", 2.2);
    // petty theft: charged only if someone actually sees it (witness chokepoint)
    if (CBZ.cityCrime) CBZ.cityCrime(20, { type: "theft", x: L.x, z: L.z });
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  let chip = null, _chipLast;
  function chipText(t) {
    if (t === _chipLast) return;
    if (!chip && typeof document !== "undefined" && document.body) {
      try {
        chip = document.createElement("div");
        chip.id = "beachLootChip";
        chip.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:278px;z-index:24;display:none;" +
          "padding:6px 12px;border-radius:9px;background:rgba(8,14,22,.78);border:1px solid rgba(255,209,102,.30);" +
          "color:#ffe9bd;font:600 13px/1.2 'Fredoka',system-ui,sans-serif;pointer-events:none;text-shadow:0 1px 2px #000";
        document.body.appendChild(chip);
      } catch (e) { chip = null; }
    }
    if (!chip) return;
    _chipLast = t;
    if (!t) { chip.style.display = "none"; return; }
    chip.style.display = "block"; chip.textContent = t;
  }

  function lootNear() {
    const P = CBZ.player; if (!P || P.pos.y > 1.6) return null;
    for (const L of loot) {
      if (L.looted) continue;
      if (Math.hypot(P.pos.x - L.x, P.pos.z - L.z) <= REACH) return L;
    }
    return null;
  }

  // =====================================================================
  //  THE SUNBATHERS — the beach furniture, in use.
  //
  //  Empty loungers read as a shop display. These are ordinary peds, posted
  //  by city/occupy.js's CBZ.cityPostNpc and then handed to propSleep /
  //  propSit — no beach-specific body, no beach-specific brain, no beach
  //  update loop. Whatever those two arcs do for a bedroom, they do here.
  //
  //  Committed INSTANT, deliberately: these bodies were never standing up,
  //  so playing the lie-down arc at them would be a body materialising and
  //  then climbing onto furniture it is already on.
  //
  //  Runs once, on the first tick after the world is up (cityMakePed and the
  //  ped array are not guaranteed to exist while the beach is being built).
  //  WHO is sunbathing is a position hash, not a draw on the build stream —
  //  the beach's rng is long spent by now, and reopening it here would make
  //  the sand depend on when this file happened to run.
  // =====================================================================
  let peopled = false;
  const SUNBATHERS_MAX = 5;             // leave the rest of the furniture free
  function populate() {
    if (peopled) return;
    if (!chairs.length || !CBZ.cityPostNpc || !CBZ.cityPeds || !CBZ.propSit) return;
    peopled = true;
    let n = 0;
    for (let i = 0; i < chairs.length && n < SUNBATHERS_MAX; i++) {
      const c = chairs[i], rec = c.rec;
      if (!rec || rec.occupant) continue;
      if (CBZ.hash01 && CBZ.hash01(rec.x, rec.z, 0xb3ac) > 0.62) continue;   // some are simply empty
      const ped = CBZ.cityPostNpc(rec.x, rec.z, {
        archetype: "tourist", job: "tourist", src: "beach:sunbather",
      });
      if (!ped) continue;
      const took = c.lie
        ? (CBZ.propSleep && CBZ.propSleep(ped, rec, { instant: true }))
        : CBZ.propSit(ped, rec, { instant: true });
      if (!took) { if (CBZ.cityUnpostNpc) CBZ.cityUnpostNpc(ped); continue; }
      n++;
    }
  }

  let rifling = null;          // { L, t }
  let _promptT = 0;
  CBZ.onUpdate(36.9, function (dt) {
    if (g.mode !== "city" || !built) { rifling = null; chipText(null); return; }
    populate();
    for (const L of loot) {
      if (!L.looted) continue;
      L.t -= dt;
      if (L.t <= 0) { L.looted = false; setLook(L, true); }
    }
    const P = CBZ.player;
    if (rifling) {
      const L = rifling.L;
      if (!P || P.dead || L.looted || Math.hypot(P.pos.x - L.x, P.pos.z - L.z) > REACH + 1) { rifling = null; chipText(null); return; }
      rifling.t += dt;
      chipText("Going through it…");
      if (rifling.t >= RIFLE_T) { rifle(L); rifling = null; chipText(null); }
      return;
    }
    _promptT += dt;
    if (g.state === "playing" && P && !P.dead && !P.driving && !CBZ.cityMenuOpen) {
      if (_promptT >= 1 / 12) {
        _promptT = 0;
        const L = lootNear();
        chipText(L ? (L.bag ? "[E] Go through the beach bag" : "[E] Go through the cooler") : null);
      }
    } else chipText(null);
  });

  function onKey(e) {
    if (!built || g.mode !== "city" || g.state !== "playing" || rifling) return;
    if (CBZ.cityMenuOpen) return;
    const P = CBZ.player;
    if (!P || P.dead || P.driving) return;
    if ((e.key || "").toLowerCase() !== "e") return;
    const L = lootNear();
    if (!L) return;
    e.preventDefault();
    e.stopPropagation();
    rifling = { L, t: 0 };
  }
  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("keydown", onKey);

  // =====================================================================
  //  THE DOCK TICK — priority 9.4.
  //
  //  ORDER IS THE FEATURE: 9.4 drives the raft, 9.5 is where
  //  systems/platforms_moving.js carries its riders, 10 is updatePlayer.
  //  The platform moves, THEN the rider is carried, THEN physics resolves
  //  them — all inside one frame. Driving a platform AFTER the player has
  //  already resolved against it is precisely the one-frame sink/pop that
  //  made every previous attempt at a moving surface in this engine feel
  //  broken, and it is why this tick is not down with the other water
  //  presentation work at 36.9/93.7.
  //
  //  Runtime-only motion (CBZ.waterClock + the shared swell), so nothing
  //  here is on a build path and nothing here draws on the beach's
  //  deterministic rng stream.
  // =====================================================================
  const DOCK_SWAY = 0.085;     // rad — how far it weathervanes inside its lines
  const DOCK_SURGE = 0.45;     // m — how far it ranges fore/aft on them
  CBZ.onUpdate(9.4, function () {
    const D = dock;
    if (!D || g.mode !== "city") return;
    const t = CBZ.waterClock ? CBZ.waterClock() : 0;
    const yaw = Math.sin(t * 0.13) * DOCK_SWAY;
    const px = D.x + Math.sin(t * 0.09) * DOCK_SURGE;
    const pz = D.z + Math.cos(t * 0.071) * (DOCK_SURGE * 0.6);
    let y, pitch = 0, roll = 0;
    if (CBZ.waterRideAt) {
      // the shared 4-probe hull-attitude query — the dock heaves and tips on
      // exactly the swell the ocean shader draws, because it is the same table
      const r = CBZ.waterRideAt(px, pz, { heading: yaw, len: D.len, beam: D.beam, t: t }, D.ride) || D.ride;
      y = r.y; pitch = r.pitch || 0; roll = r.roll || 0;
    } else {
      y = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(px, pz) : (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48);
    }
    if (!(y === y)) return;                       // never hand a NaN pose to a rig
    D.grp.position.set(px, y, pz);
    D.grp.rotation.set(pitch, yaw, roll);

    // THE GANGWAY: hinged on the pier head, resting on the dock's inboard
    // edge, its slope recomputed from the dock's LIVE deck height. Its own
    // deck is 1.4m longer than the nominal gap, so the dock ranging on its
    // lines can never open a hole to fall through — the job the rollers on a
    // real brow do. With yaw 0, a Z rotation (roll) is what slopes a deck
    // running along local +X: worldY = poseY + sin(roll)·lx.
    const landX = px - D.landIn;
    const landY = y + D.deckTop;
    const run = Math.max(0.5, landX - D.hingeX);
    D.gw.position.set((D.hingeX + landX) / 2, (D.hingeY + landY) / 2, D.gwZ);
    D.gw.rotation.set(0, 0, Math.atan((landY - D.hingeY) / run));
  });

  // =====================================================================
  //  THE SWASH TICK — the sand follows the water.
  //
  //  onALWAYS, not onUpdate, and at 93.7: the sea's own clock and uniforms are
  //  driven on the always chain too (world.js at 93, world/waterfx.js at 93.5)
  //  precisely so the ocean keeps moving while the game is paused. A beach
  //  that froze while the surf kept rolling would be worse than one that never
  //  moved at all, so this rides immediately behind them and reads the same
  //  CBZ.waterClock().
  //
  //  The run-up is sampled ONCE PER COLUMN: cbzSwash's phase drifts along the
  //  shore (so a coastline never surges in lockstep) but not across it, so a
  //  per-column sample is exact, not an approximation. 91 vertex colours and
  //  7 sine triplets per frame, gated on the player being anywhere near.
  // =====================================================================
  const SWASH_DRY_RATE = 0.35;      // 1/s — ~3s to dry; wetting is instant
  const SWASH_RANGE_M = 260;        // beyond this the sand is not on screen
  CBZ.onAlways(93.7, function (dt) {
    const S = swash;
    if (!S || !S.live || g.mode !== "city" || !S.mesh.parent) return;
    const P = CBZ.player;
    if (P && Math.hypot(P.pos.x - S.cx, P.pos.z - S.cz) > SWASH_RANGE_M) return;
    const t = CBZ.waterClock ? CBZ.waterClock() : 0;
    const NX = S.nx, runs = S.runs;
    for (let ix = 0; ix < NX; ix++) {
      // A drain-back cannot expose sand that is BELOW mean sea level, so the
      // run-up is clamped at the waterline; only the beach above it dries.
      const r = +CBZ.waterSwashAt(S.vx[ix], S.zW, t);
      runs[ix] = Number.isFinite(r) && r > 0 ? r : 0;
    }
    const dry = Math.min(1, Math.max(0, dt) * SWASH_DRY_RATE);
    for (let k = 0; k < S.n; k++) {
      const run = runs[k % NX];
      // wet everywhere the water currently reaches, with a soft 2m edge
      const target = 1 - ss01(run - 0.6, run + 1.4, S.dLand[k]);
      let w = S.wet[k];
      if (target > w) w = target;               // soaks instantly
      else w += (target - w) * dry;             // and dries slowly behind it
      S.wet[k] = w;
      paintSwash(k, w);
    }
    S.attr.needsUpdate = true;
  });

  // ---- PUBLIC --------------------------------------------------------------
  CBZ.cityBeachLoot = function () { return loot; };
  // the palms as world objects a disaster can claim: {list, take(i)} or null
  CBZ.cityBeachPalms = function () { return palmField; };
  // usable beach furniture — {loungers, deckchairs, occupied}. A lounger with
  // no propuse anchor behind it would be a prop pretending to be furniture, so
  // this counts ANCHORS, never meshes.
  CBZ.cityBeachSeats = function () {
    let lie = 0, sit = 0, taken = 0;
    for (let i = 0; i < chairs.length; i++) {
      const c = chairs[i];
      if (c.lie) lie++; else sit++;
      if (c.rec && c.rec.occupant) taken++;
    }
    return { loungers: lie, deckchairs: sit, occupied: taken };
  };
  CBZ.cityBeachLootReset = function () {
    rifling = null;
    for (const L of loot) { L.looted = false; L.t = 0; setLook(L, true); }
  };
})();
