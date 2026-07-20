/* ============================================================
   city/beach.js — THE WATERFRONT WITH A PURPOSE.

   WHY: the band between the street grid and the seawall was a dead
   gray apron — 26 metres of nothing on every coast. A city's edge
   is where it SHOWS OFF. Now the south shore is a real beach:
   warm sand running straight into the water (the seawall opens
   here — world.js gaps the wall + skips the rip-rap/bollards over
   the span), palms, umbrellas, towels, a lifeguard chair, beached
   rowboats, a raised boardwalk with a snack shack + vendor stalls,
   and ONE pier reaching over the harbor with a bench + telescope
   at the end — the quiet show-off spot, and the jump-off-the-end
   dive (swim.js owns the water).

   THE MONEY: sunbathers leave their lives on their towels. A few
   coolers and beach bags hold cash you can rifle ([E], a beat,
   gone) — petty theft if anyone's watching (cityCrime "theft"),
   but the beach sits past the NPC clamp line, so like the roof
   stashes it's a quiet earner you have to KNOW about. Restocks
   after long minutes.

   THE REST OF THE APRON stops reading abandoned: a striped
   parking lot along the west quay (cars can reach it — the clamp
   line is 4m inside the seawall) and a stacked container dockyard
   in the south-east corner (climbable: tops are platforms — a
   free vantage you jump up to).

   Draw-call discipline: sand/boardwalk/pier planks/rails/stripes
   are MERGED (BufferGeometryUtils, guarded), palms/umbrellas/
   towels/posts/containers are InstancedMesh, materials via the
   shared CBZ.cmat pool. Solid things (shack, stalls, trunks,
   boats, containers, pier rails) register CBZ.colliders the same
   way props.js does; walkable decks register CBZ.platforms (the
   buildings.js pattern) so the pier is REALLY above the water.
   Deterministic LCG → same beach every run. Headless-guarded DOM.

   Publishes:
     CBZ.cityBuildBeach(city)   — world.js calls this once at build
     CBZ.cityBeachLoot()        — live loot records (map follow-up)
     CBZ.cityBeachLootReset()   — restock everything for a fresh run
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
  let built = false;

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
    // =====================================================================
    const sandGeoms = [];
    const dryFar = ES - 1.5;                              // dry sand's water-side edge
    const band = new THREE.PlaneGeometry(BW + 4, innerZ - dryFar);
    band.rotateX(-Math.PI / 2);
    band.translate((BX0 + BX1) / 2, 0.06, (innerZ + dryFar) / 2);
    sandGeoms.push(band);
    for (let i = 0; i < 9; i++) {                         // the irregular inner edge
      const lx = BX0 + 4 + (i + rng() * 0.6) * (BW - 8) / 9;
      const r = 3.2 + rng() * 3.4;
      const c = new THREE.CircleGeometry(r, 10);
      c.rotateX(-Math.PI / 2);
      // mostly tucked under the band; the top arc bulges ≤1m onto the gray,
      // never onto the road (the last cross-street's asphalt starts at minZ)
      c.translate(lx, 0.052, innerZ - r + 1.0);
      sandGeoms.push(c);
    }
    mergeAdd(sandGeoms, cmat(SAND));

    // wet-sand strip at the waterline + a slope quad dipping under the sea
    // surface — the sand visibly RUNS INTO the water (swim.js takes you at
    // the same line, so the read and the mechanic agree).
    const wet = new THREE.PlaneGeometry(BW + 4, 7);
    wet.rotateX(-Math.PI / 2);
    wet.translate((BX0 + BX1) / 2, 0.048, ES - 3);
    mergeAdd([wet], cmat(SAND_WET));
    (function slope() {                                    // two triangles, near edge dry-high, far edge drowned
      const x0 = BX0 - 2, x1 = BX1 + 2, zN = ES - 5.5, zF = ES - 16, yN = 0.03, yF = -0.8;
      const pos = new Float32Array([x0, yN, zN, x1, yN, zN, x1, yF, zF, x0, yN, zN, x1, yF, zF, x0, yF, zF]);
      const nrm = new Float32Array(18); for (let i = 0; i < 6; i++) nrm[i * 3 + 1] = 1;
      const gm = new THREE.BufferGeometry();
      gm.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      gm.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
      const m = new THREE.Mesh(gm, cmat(SAND_WET));
      m.receiveShadow = true; m.matrixAutoUpdate = false; root.add(m);
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

    // lifeguard chair — the beach's landmark; tall white frame + red roof
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
      solid(lgx, lgz, 1.8, 1.6, roof, null);
      CBZ.platforms.push({ minX: lgx - 0.85, maxX: lgx + 0.85, minZ: lgz - 0.75, maxZ: lgz + 0.75, top: 2.4 });
    })();

    // beached rowboats — hulls hauled up past the wet line, tipped on a chine
    function rowboat(x, z, yaw, hullC) {
      const b = new THREE.Group(); b.position.set(x, 0.32, z); b.rotation.set(0, yaw, 0.09); root.add(b);
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.75, 4.6), cmat(hullC));
      hull.castShadow = false; hull.receiveShadow = true; b.add(hull);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 4.7), cmat(0xd9d2bd));
      rim.position.y = 0.42; b.add(rim);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.45), cmat(WOOD_DK));
      bench.position.y = 0.25; b.add(bench);
      solid(x, z, 2.4, 4.2, hull, 1.1);
    }
    rowboat(BX0 + 7, ES - 0.5, 0.5, 0x9e3434);
    rowboat(BX0 + 12, ES + 1.2, -0.25, 0x2f5d8a);

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

      // END PAYOFF: a bench facing the open sea + a coin-op telescope — the
      // quiet show-off spot (sunset over the water, the city at your back)
      const benchZ = headZ1 + 1.6;
      const bench = [];
      bench.push(boxGeoAt(pierX - 2.2, top + 0.46, benchZ, 2.4, 0.09, 0.55));
      bench.push(boxGeoAt(pierX - 2.2, top + 0.86, benchZ - 0.26, 2.4, 0.55, 0.09));
      bench.push(boxGeoAt(pierX - 3.2, top + 0.23, benchZ, 0.12, 0.46, 0.5));
      bench.push(boxGeoAt(pierX - 1.2, top + 0.23, benchZ, 0.12, 0.46, 0.5));
      mergeAdd(bench, cmat(WOOD_DK), { cast: true });
      solid(pierX - 2.2, benchZ, 2.5, 0.7, null, top + 1.0);
      const tBase = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), cmat(0x2e3238));
      tBase.position.set(pierX + 2.4, top + 0.08, headZ1 + 1.4); root.add(tBase);
      const tPole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.1, 0.14), cmat(0x9aa0a6));
      tPole.position.set(pierX + 2.4, top + 0.65, headZ1 + 1.4); root.add(tPole);
      const tHead = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.7), cmat(0xc23434));
      tHead.position.set(pierX + 2.4, top + 1.3, headZ1 + 1.2); tHead.rotation.x = 0.18; root.add(tHead);
      solid(pierX + 2.4, headZ1 + 1.4, 0.6, 0.6, tPole, top + 1.5);
      // a couple of rods leaning on the head rail — the fishing-scene read
      for (const rx of [pierX - headW / 2 + 1.2, pierX + headW / 2 - 2.0]) {
        const rod = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.6, 0.05), cmat(WOOD_DK));
        rod.position.set(rx, top + 1.2, headZ1 + 0.7); rod.rotation.x = -0.5; rod.castShadow = false; root.add(rod);
      }
      const tackle = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.4), cmat(0x4a5232));
      tackle.position.set(pierX + headW / 2 - 2.0, top + 0.2, headZ1 + 1.6); root.add(tackle);
    })();

    // =====================================================================
    //  6) THE REST OF THE APRON — west quay PARKING LOT (paint only: cars
    //  CAN reach it, the drive clamp is 4m inside the seawall) and a SE
    //  CONTAINER DOCKYARD (instanced, solid, tops are climbable platforms).
    // =====================================================================
    (function parking() {
      const stripes = [];
      const sx1 = minX - 4.5, sx0 = sx1 - 11;              // stalls back onto the quay
      for (let i = 0; i < 15; i++) {
        const z = cz - 38 + i * 5.4;
        stripes.push(boxGeoAt((sx0 + sx1) / 2, 0.03, z, 11, 0.012, 0.22));
      }
      stripes.push(boxGeoAt(sx1, 0.03, cz - 38 + 7 * 5.4, 0.22, 0.012, 14 * 5.4));   // aisle line
      mergeAdd(stripes, cmat(0xd8dce0), { receive: false });
      const stops = [];
      for (let i = 0; i < 14; i++) stops.push(boxGeoAt(sx0 + 1.0, 0.07, cz - 38 + (i + 0.5) * 5.4, 1.8, 0.14, 0.3));
      mergeAdd(stops, cmat(0x9aa0a6));
    })();
    (function dockyard() {
      const CONT_COLS = [0x8a3a2e, 0x2f5d8a, 0x3f7a4a, 0xb8862e];
      const CH = 2.3;                                      // jump-climbable (apex 1.53 + STEP_UP 0.9)
      const rows = [];
      for (let i = 0; i < 3; i++) rows.push({ x: maxX - 32 + i * 7.1, z: ES + 5, y: CH / 2 });
      for (let i = 0; i < 3; i++) rows.push({ x: maxX - 29 + i * 7.1, z: ES + 9.6, y: CH / 2 });
      rows.push({ x: maxX - 28.5, z: ES + 5, y: CH * 1.5 });          // second tier
      rows.push({ x: maxX - 21.4, z: ES + 5, y: CH * 1.5 });
      rows.push({ x: maxX - 25.1, z: ES + 9.6, y: CH * 1.5 });
      const contMat = new THREE.MeshLambertMaterial({ color: 0xffffff }); contMat._shared = true;
      const contIM = new THREE.InstancedMesh(new THREE.BoxGeometry(6.1, CH, 2.44), contMat, rows.length);
      rows.forEach((r, i) => {
        dummy.position.set(r.x, r.y, r.z); dummy.rotation.set(0, (rng() - 0.5) * 0.04, 0); dummy.scale.set(1, 1, 1);
        dummy.updateMatrix(); contIM.setMatrixAt(i, dummy.matrix);
        if (contIM.setColorAt) contIM.setColorAt(i, new THREE.Color(CONT_COLS[(rng() * CONT_COLS.length) | 0]));
        if (r.y < CH) solid(r.x, r.z, 6.1, 2.44, contIM, null);       // ground tier blocks
        CBZ.platforms.push({ minX: r.x - 3.05, maxX: r.x + 3.05, minZ: r.z - 1.22, maxZ: r.z + 1.22, top: r.y + CH / 2 });
      });
      contIM.instanceMatrix.needsUpdate = true;
      if (contIM.instanceColor) contIM.instanceColor.needsUpdate = true;
      contIM.castShadow = true; contIM.receiveShadow = true;
      root.add(contIM);
    })();

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

  let rifling = null;          // { L, t }
  let _promptT = 0;
  CBZ.onUpdate(36.9, function (dt) {
    if (g.mode !== "city" || !built) { rifling = null; chipText(null); return; }
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
    if (CBZ.sfx) CBZ.sfx("clank");
  }
  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("keydown", onKey);

  // ---- PUBLIC --------------------------------------------------------------
  CBZ.cityBeachLoot = function () { return loot; };
  CBZ.cityBeachLootReset = function () {
    rifling = null;
    for (const L of loot) { L.looted = false; L.t = 0; setLook(L, true); }
  };
})();
