/* ============================================================
   city/buildings.js — every lot becomes a REAL, walkable place or an
   ABANDONED gang-run derelict. Hooked by world.js via CBZ.cityBuildings.

   REAL buildings:
     • Shops (16 trades + a Realtor + a Chop Shop) — furnished interior,
       a counter and a vendor who runs the business.
     • Residences (apartments / office towers) — furnished rooms, a few
       residents, and many are FOR SALE / FOR RENT homes (city/realestate.js
       reads lot.building.home). One flagship tower carries a ground-floor
       GARAGE zone + an ELEVATOR to a penthouse.
   ABANDONED buildings:
     • Dark, boarded windows, graffiti, trash, and a lootable STASH. Each is
       assigned to a gang by city/gangs.js (gang members spawn to hold it).

   Buildings stay ENTERABLE & climbable (the proven switchback-stair rig).

   APPEARANCE PASS (why: more buildings + more windows = more places to rob,
   own and show off — and the skyline now TELLS you where the money is):
     • INSTANCED GLASS: every window pane used to be its OWN transparent mesh
       (thousands of draw calls — the single biggest sink). Panes are
       axis-aligned boxes, so they all collapse into a few InstancedMesh pools
       (one per glass tint + one warm "lit at night" pool). The cityGlass
       shatter contract is unchanged — records carry {pool,inst} instead of a
       mesh; bursting zeroes the instance matrix, reset restores it.
     • Panes moved to the STREET side of the wall (they sat a hair inside the
       room before, hidden behind the opaque facade), pane rows densified
       (4..8 per face), 3 cached tints, ~15% of panes glow warm after dusk.
     • MULLION frames + cornices + plinths + pilasters + varied parapets: all
       flat opaque boxes, merged per building via THREE.BufferGeometryUtils
       (src/vendor/) then batch-merged across the city by core/batch.js.
     • DISTRICT HEIGHT FIELD: storey counts read lot.district (core 4-8,
       commercial 3-5, projects/industrial 1-3) — downtown towers over you,
       the projects squat low. Costs no pane draw calls now glass is pooled.
     • VERTEX FACE SHADING (fake AO) on structural walls/roofs — a one-time
       colour attribute, zero runtime cost, de-flattens every box.

   ROOMS WORTH ENTERING + PARKS WORTH CROSSING (why: tours, elevators and
   robberies walk players INSIDE — bare slabs say "nothing here", furnished
   floors say "money lives here"):
     • every storey above ground in residences/shops gets the generic
       apartment dresser (furnishApartmentFloor: ~10 opaque boxes, all
       clearFloorPoint-gated, batch-merged — ≈zero extra draw calls);
     • listed homes dress their TOP floor with the tier furnishing — the
       floor home.floorY tours/elevators land on (the old pass dressed y≈0,
       so arriving "home" meant a bare plate: fixed);
     • parks (makePark) earn the cut-through: fountain + benches + gravel
       paths + hedge ring + two tree silhouettes;
     • derelicts read from a block away: soot-streak decals under the
       boarded windows + broken-parapet chunks on the roofline (gang turf
       at a glance). Island annex shells furnish via CBZ.cityFurnishApartment.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;
  // FEATURE FLAGS owned by this file (default ON; each a one-line revert).
  //   SHOPS_ROBBABLE_V1 — shop shelves/gondolas become SHOPLIFT sources and the
  //     bank vault becomes a heist SURFACE (the runtime blocks near the bottom
  //     of this file + city/heists.js read it). Flag off → the shelves are inert
  //     decor again and the vault is board-only, exactly as before.
  //   FACADES_V2 — per-window lit-room variation at night and roofline/parapet
  //     trim for the plain tops the BUILDING_MASSING_V2 pass leaves on low
  //     blocks. All deterministic (CBZ.hash01), flat-Lambert, batch-mergeable,
  //     zero new colliders.
  //   FACADE_AC_UNITS — the old through-the-wall window AC boxes (owner-cut:
  //     they covered shop signage). Default OFF = no AC boxes; true restores
  //     them. Placement is position-hashed (CBZ.hash01, no shared rng draws),
  //     so toggling emits/skips meshes without shifting any other stream.
  // Self-defaulted here (config.js may also set them); every read uses the
  // `!== false` idiom so an unset value still counts as ON (FACADE_AC_UNITS
  // is the exception: default OFF, read with `=== true`).
  if (CBZ.CONFIG) {
    if (CBZ.CONFIG.SHOPS_ROBBABLE_V1 == null) CBZ.CONFIG.SHOPS_ROBBABLE_V1 = true;
    if (CBZ.CONFIG.FACADES_V2 == null) CBZ.CONFIG.FACADES_V2 = true;
    if (CBZ.CONFIG.FACADE_AC_UNITS == null) CBZ.CONFIG.FACADE_AC_UNITS = false;
  }
  // FACADES_V2 build-time counters (deterministic per seed): how many windows the
  // massing chose LIT at night + how many got an AC unit, accumulated as the world
  // builds. Exposed for the determinism gate (two boots of one seed must agree).
  // `sideBoxes` is a structural zero: the old balconyWindow terminal glued a
  // solid-looking black slab/rail onto arbitrary curtain-wall bays (the boxes
  // filmed on Threads & Drip). The terminal and its emitter are deleted below.
  let _facadeLit = 0, _facadeAC = 0, _facadeTrim = 0;
  CBZ.cityFacadeStats = function () { return { lit: _facadeLit, ac: _facadeAC, trim: _facadeTrim, sideBoxes: 0 }; };

  // FLOOR-TO-FLOOR — world units are metres and the converted character is
  // ~1.82m. 3.2m yields a plausible apartment/office floor with a 0.2m slab,
  // instead of the former 4.6m floors that made every six-storey block read
  // like a twelve-storey tower.
  // Mirrored by city/elevators.js (fire-escape flights); everything in this
  // file derives from FH — never hardcode a multiple of it.
  const FH = 3.2;      // floor-to-floor
  const FH_STD = FH;   // makeBuilding shadows FH per shell (opts.fh); this is the default it falls back to
  // pedestrian DOORWAY/HEADER height — PERSON-scaled on purpose, so it does
  // NOT ride FH. 2.25m clears the 1.82m body and matches common real doors.
  const DOORH = 2.25;
  const WT = 0.4;      // wall thickness
  const DOORW = 1.6;   // generous double-clear pedestrian door; garages use GW
  const GLASS = 0x9fd8ee;
  // Physical air behind display glass. Screen faces used to touch/intersect
  // their dark housings; at oblique angles the depth buffer alternated which
  // surface won. This distance survives the static batcher.
  const SCREEN_GAP = 0.025;

  // ---- SHATTERABLE GLASS (city-wide) ------------------------------------
  // Every window pane registers here so a crash / blast / gunshot can burst
  // it: the pane hides — and SOLID showroom glass also drops its collider so
  // you can drive straight THROUGH the hole — while a few glass shards rain
  // down. One shared translucent material + shard geometry keep it cheap.
  const cityGlass = [];
  // Ground-front glass is a measurable architectural promise, not a camera
  // impression. `role` is stamped only by storefront/showroom/garage frontage
  // recipes that intentionally meet the floor; upper windows and sill windows
  // are outside this invariant.
  CBZ.cityGlassRealityAudit = function () {
    let frontagePanes = 0, groundPanes = 0, upperPanes = 0, colliderMissing = 0;
    const byRole = {}, stacks = new Map();
    for (let i = 0; i < cityGlass.length; i++) {
      const gp = cityGlass[i];
      if (!gp.frontageRole) continue;
      frontagePanes++;
      const bottom = gp.y - gp.hh;
      if (Math.abs(bottom) <= 0.025) groundPanes++;
      else if (bottom > 0.025) upperPanes++;
      if (!gp.col) colliderMissing++;
      byRole[gp.frontageRole] = (byRole[gp.frontageRole] || 0) + 1;
      // A floor-to-header wall is a vertical GRID: only its lowest pane should
      // touch grade. Group equal X/Z/span panes into one mullion column and test
      // the bottom of the whole column, rather than falsely calling every upper
      // pane a floating storefront.
      const key = gp.frontageRole + "|" + gp.x.toFixed(3) + "|" + gp.z.toFixed(3)
        + "|" + gp.hw.toFixed(3) + "|" + gp.hd.toFixed(3);
      const st = stacks.get(key);
      if (!st || bottom < st.bottom) stacks.set(key, {
        role: gp.frontageRole, x: gp.x, z: gp.z, bottom
      });
    }
    let groundColumns = 0, offGradeColumns = 0, maxGroundError = 0;
    const samples = [];
    stacks.forEach(function (st) {
      const err = Math.abs(st.bottom);
      if (err <= 0.025) groundColumns++;
      else {
        offGradeColumns++;
        if (err > maxGroundError) maxGroundError = err;
        if (samples.length < 8) samples.push({
          role: st.role, x: +st.x.toFixed(2), z: +st.z.toFixed(2),
          bottom: +st.bottom.toFixed(3)
        });
      }
    });
    return {
      frontagePanes, frontageColumns: stacks.size, groundPanes, upperPanes,
      groundColumns, offGradeColumns, colliderMissing,
      maxGroundError: +maxGroundError.toFixed(3), byRole, samples
    };
  };
  let shatteredPanes = 0;   // live count of open holes (fast-path for cityShotHole)
  // THE BROKEN ONES, BY NAME. cityShotHole is asked on every line-of-fire test
  // (npcAttack's muzzle gate, the flee exit search, the player's reticle) and
  // walked ALL 37,540 panes looking for the handful that are broken — 3.9% of
  // the frame during a street fight, on a loop that skipped 99.9% of what it
  // read. The three places a pane breaks push it here; the re-glaze empties it.
  const shatteredList = [];
  let _gmat = null, _crackTex = null;
  // THE reference glass — now sourced from CBZ.glass() so the cockpit, the
  // cabin windows and anything else with a pane get THIS material, not a
  // guess at it. Degrade-safe: no CBZ.glass (materials.js stripped) and the
  // exact original inline recipe still runs, so the city cannot regress.
  function glassMat() {
    if (CBZ.glass) return CBZ.glass();
    return _gmat || (_gmat = new THREE.MeshLambertMaterial({ color: 0xbfe9f7, emissive: 0x3f8aa6, emissiveIntensity: 0.5, transparent: true, opacity: 0.6 }));
  }

  // ---- INSTANCED GLASS POOLS ---------------------------------------------
  // Window panes are all axis-aligned boxes, so the whole city's glass folds
  // into ONE InstancedMesh per tint (+ one warm lit-at-night pool): ~4 draw
  // calls instead of thousands. Pool capacity is exact: panes queue in
  // pendingGlass during worldgen and the pools are built on the next city
  // frame (late builders — the expansion island — just get a new generation
  // of pools). Solid showroom panes (collider-bound) and EXTERNAL one-offs
  // (jewelry cases, which watch rec.mesh) stay individual meshes.
  const GLASS_TINTS = 3;
  let _tintMats = null, _litWinMat = null, _unitBox = null;
  function unitBox() { return _unitBox || (_unitBox = new THREE.BoxGeometry(1, 1, 1)); }
  function tintMats() {
    if (_tintMats) return _tintMats;
    _tintMats = [
      glassMat(),   // the classic cool blue
      new THREE.MeshLambertMaterial({ color: 0xc8efdb, emissive: 0x3f9c7d, emissiveIntensity: 0.5, transparent: true, opacity: 0.6 }),  // green
      new THREE.MeshLambertMaterial({ color: 0xf0ddb2, emissive: 0xa6803f, emissiveIntensity: 0.5, transparent: true, opacity: 0.6 }),  // amber
    ];
    return _tintMats;
  }
  // VIEW glass: the pane you stand behind to look at the city. The default
  // pane is a 0.6-opacity sheet with its own blue underlight, which from the
  // inside of a 160 m high office reads as a grey fog wall, not a window.
  // Real low-iron curtain glass barely tints what is behind it: a faint cool
  // tint, near-zero self-light. Shared by the pooled VIEW panes and any
  // interior partition that wants the same glass (CBZ.cityViewGlassMat).
  let _viewGlassMat = null;
  function viewGlassMat() {
    return _viewGlassMat || (_viewGlassMat = new THREE.MeshLambertMaterial({ color: 0xd4e4ea, emissive: 0x0c1418, emissiveIntensity: 1, transparent: true, opacity: 0.13 }));
  }
  CBZ.cityViewGlassMat = viewGlassMat;
  function litWinMat() { return _litWinMat || (_litWinMat = new THREE.MeshLambertMaterial({ color: 0xffe2a8, emissive: 0xffb648, emissiveIntensity: 0.85, transparent: true, opacity: 0.66 })); }
  // REFLECTIVE glass (offices/apartments by default): a mirror-ish, near-opaque
  // tint you can NOT see through — until it shatters into a real see-through
  // hole. r128 has no PMREM/envMap reflection that works under a Lambert world
  // (MeshStandard+envMap renders near-black), so we FAKE it: opaque (0.80) cool
  // Lambert per tint with a brighter cool emissive so the pane reads as a lit
  // sky-reflecting sheet day and night. Pooled per tint = draw-call identical.
  let _reflectMats = null;
  function reflectMats() {
    if (_reflectMats) return _reflectMats;
    _reflectMats = [
      new THREE.MeshLambertMaterial({ color: 0xbfe9f7, emissive: 0x6f9fb8, emissiveIntensity: 0.75, transparent: true, opacity: 0.80 }),
      new THREE.MeshLambertMaterial({ color: 0xc8efdb, emissive: 0x6fb89a, emissiveIntensity: 0.75, transparent: true, opacity: 0.80 }),
      new THREE.MeshLambertMaterial({ color: 0xf0ddb2, emissive: 0xb89a6f, emissiveIntensity: 0.75, transparent: true, opacity: 0.80 }),
    ];
    return _reflectMats;
  }
  const glassPools = [];     // every live pool (all generations)
  const litPools = [];       // the warm night pools only (count-gated by day)
  let pendingGlass = [];     // recs registered this build, awaiting a pool
  let glassNightOn = false;  // the dusk flip state (lit panes swapped in)
  const _pPos = new THREE.Vector3(), _pScl = new THREE.Vector3(), _pQ = new THREE.Quaternion(), _pM = new THREE.Matrix4();
  const _zeroM = new THREE.Matrix4().makeScale(0, 0, 0);   // zero-scale = hidden instance
  function paneMatrix(gp) {
    _pPos.set(gp.x, gp.y, gp.z); _pScl.set(gp.hw * 2, gp.hh * 2, gp.hd * 2);
    return _pM.compose(_pPos, _pQ, _pScl);
  }
  // show/hide one pooled pane, honouring the current night state (a lit pane
  // shows in the warm pool after dusk and in its tint pool by day)
  function paneShow(gp, show) {
    if (!gp.pool) return;
    const night = glassNightOn && gp.lit;
    gp.pool.setMatrixAt(gp.inst, (show && !night) ? paneMatrix(gp) : _zeroM);
    gp.pool.instanceMatrix.needsUpdate = true;
    if (gp.litPool) {
      gp.litPool.setMatrixAt(gp.litId, (show && night) ? paneMatrix(gp) : _zeroM);
      gp.litPool.instanceMatrix.needsUpdate = true;
    }
  }
  // SECTORED pools: with the solid curtain-wall panes now pooled too there
  // are ~60k+ instances — one city-spanning frustumCulled=false pool would
  // dodge the draw-call cost but still push EVERY pane through the vertex
  // shader every frame. So pools are built per (tint, kind, 320u world cell),
  // each with its own cloned unit-box geometry carrying a hand-set bounding
  // sphere over exactly its instances → real frustum culling per sector, and
  // core/farcull.js can drop far cells wholesale at low tiers. Dozens of draw
  // calls city-wide instead of tens of thousands of meshes.
  const GLASS_SECT = 320;
  function sectorKey(r) { return Math.floor(r.x / GLASS_SECT) + "," + Math.floor(r.z / GLASS_SECT); }
  function pooledIM(recs, mat) {
    // per-pool geometry clone so the bounding sphere can be OURS: centred on
    // the recs' true extents (+ the fattest pane half-span as margin).
    const geo = unitBox().clone();
    // Panes are vertical sheets: their ±Y faces are millimetre top/bottom
    // slivers nobody can see, yet they were a third of every pool's triangles
    // (the pools carry ~2/3 of ALL drawn city tris). Keep faces ±X,±Z only.
    // r128 BoxGeometry index layout verified: 6 indices per face in order
    // +X,-X,+Y,-Y,+Z,-Z. Groups are cleared (single material ignores them).
    (function () {
      const idx = geo.index.array;
      const kept = new idx.constructor(24);
      kept.set(idx.subarray(0, 12), 0);      // +X, -X
      kept.set(idx.subarray(24, 36), 12);    // +Z, -Z
      geo.setIndex(new THREE.BufferAttribute(kept, 1));
      geo.clearGroups();
    })();
    let nx = 1e9, xx = -1e9, ny = 1e9, xy = -1e9, nz = 1e9, xz = -1e9, span = 0;
    for (const r of recs) {
      if (r.x < nx) nx = r.x; if (r.x > xx) xx = r.x;
      if (r.y < ny) ny = r.y; if (r.y > xy) xy = r.y;
      if (r.z < nz) nz = r.z; if (r.z > xz) xz = r.z;
      const s = Math.max(r.hw, r.hh, r.hd); if (s > span) span = s;
    }
    const cx = (nx + xx) / 2, cy = (ny + xy) / 2, cz = (nz + xz) / 2;
    const rad = Math.hypot(xx - nx, xy - ny, xz - nz) / 2 + span + 1;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), rad);
    const im = new THREE.InstancedMesh(geo, mat, recs.length);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = false; im.receiveShadow = false; im.renderOrder = 1;
    // Three r128 defaults InstancedMesh.frustumCulled to false. We built the
    // tight sector sphere above specifically so off-screen glass sectors can
    // skip their whole draw and vertex workload.
    im.frustumCulled = true;
    im.userData.glassPool = true;
    return im;
  }
  function buildGlassPools() {
    if (!pendingGlass.length) return;
    const batch = pendingGlass; pendingGlass = [];
    // parent the pools to the city root (the building groups' parent) so they
    // inherit the mode-visibility toggle. Records hold WORLD coords and the
    // root is at identity (the collider math proves it), so no re-basing.
    let root = null;
    for (const r of batch) { if (r._grp && r._grp.parent) { root = r._grp.parent; break; } }
    if (!root) root = CBZ.scene;
    const mats = tintMats(), rmats = reflectMats();
    // partition by (tint, kind, sector) — see the sectored-pools note above.
    const buckets = new Map(), litBuckets = new Map();
    for (const r of batch) {
      // kind index: 0 clear, 1 reflective, 2 VIEW (a floor that exists to be
      // looked OUT of: exec_office.js retags its storey's panes to this).
      const k = (r.tint * 3 + (r.kind === "reflective" ? 1 : r.kind === "view" ? 2 : 0)) + "|" + sectorKey(r);
      let a = buckets.get(k); if (!a) { a = []; buckets.set(k, a); } a.push(r);
      if (r.lit) { const lk = sectorKey(r); let la = litBuckets.get(lk); if (!la) { la = []; litBuckets.set(lk, la); } la.push(r); }
      r._grp = null;
    }
    buckets.forEach(function (recs, k) {
      const bidx = parseInt(k, 10);                 // tint*3+kind prefix of the key
      const t = (bidx / 3) | 0, kn = bidx % 3;
      const im = pooledIM(recs, kn === 2 ? viewGlassMat() : kn ? rmats[t] : mats[t]);
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i]; r.pool = im; r.inst = i;
        im.setMatrixAt(i, r.shattered ? _zeroM : paneMatrix(r));
      }
      im.instanceMatrix.needsUpdate = true;
      root.add(im); glassPools.push(im);
    });
    const litAll = [];
    litBuckets.forEach(function (recs) {
      const lp = pooledIM(recs, litWinMat());
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i]; r.litPool = lp; r.litId = i;
        lp.setMatrixAt(i, _zeroM);    // lit pool stays dark until dusk
        litAll.push(r);
      }
      lp.instanceMatrix.needsUpdate = true;
      // By day every instance is zero-scaled — degenerate but still submitted
      // (~60k instances through the vertex shader for nothing). count=0 skips
      // the draw outright; the dusk flip below restores full capacity.
      lp.userData.litCapacity = recs.length;
      if (!glassNightOn) lp.count = 0;
      litPools.push(lp);
      root.add(lp); glassPools.push(lp);
    });
    // a build landing mid-night flips its lit panes on immediately
    if (glassNightOn) for (const r of litAll) if (!r.shattered) paneShow(r, true);
  }

  // ---- INTERIOR WINDOW DRESSING POOLS -------------------------------------
  // The room-side "daylight" sky slab + mullion strips behind every window
  // band used to be merged into the building-wide deco buckets — unhideable,
  // so a hole carved through the wall left them FLOATING across the opening
  // (USER-FILMED: shoot a window from inside → "gray instead of showing
  // outside"). They now ride two InstancedMeshes exactly like the panes, so a
  // carve can hide the exact slabs across its gap. Cost: 2 draw calls, ever.
  const roomDeco = [];       // {x,y,z,hw,hh,hd,kind,hidden,pool,inst}
  let pendingDeco = [];
  function addRoomDeco(group, lx, ly, lz, bw, bh, bd, kind, ox, oz) {
    const rec = { x: ox + lx, y: ly, z: oz + lz, hw: bw / 2, hh: bh / 2, hd: bd / 2,
      kind, hidden: false, pool: null, inst: -1, _grp: group };
    pendingDeco.push(rec); roomDeco.push(rec);
    return rec;
  }
  function decoMatrix(r) {
    _pPos.set(r.x, r.y, r.z); _pScl.set(r.hw * 2, r.hh * 2, r.hd * 2);
    return _pM.compose(_pPos, _pQ, _pScl);
  }
  function decoShow(r, show) {
    if (!r.pool) { r.hidden = !show; return; }
    r.hidden = !show;
    r.pool.setMatrixAt(r.inst, show ? decoMatrix(r) : _zeroM);
    r.pool.instanceMatrix.needsUpdate = true;
  }
  function buildRoomDecoPools() {
    if (!pendingDeco.length) return;
    const batch = pendingDeco; pendingDeco = [];
    let root = null;
    for (const r of batch) { if (r._grp && r._grp.parent) { root = r._grp.parent; break; } }
    if (!root) root = CBZ.scene;
    // sectored like the pane pools (same 320u cells) so interior dressing
    // frustum-culls per city cell instead of always-drawing city-wide.
    const byKS = new Map();
    for (const r of batch) {
      const kind = (r.kind === "sky") ? "sky" : "mull";
      const k = kind + "|" + sectorKey(r);
      let a = byKS.get(k); if (!a) { a = []; byKS.set(k, a); } a.push(r);
      r._grp = null;
    }
    byKS.forEach(function (recs, k) {
      const col = k.charAt(0) === "s" ? 0xd6e6f2 : 0x262b31;
      const m = CBZ.cmat ? CBZ.cmat(col) : new THREE.MeshLambertMaterial({ color: col });
      const im = pooledIM(recs, m);
      im.renderOrder = 0;             // opaque interior dressing — no glass ordering needed
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i]; r.pool = im; r.inst = i;
        im.setMatrixAt(i, r.hidden ? _zeroM : decoMatrix(r));
      }
      im.instanceMatrix.needsUpdate = true;
      root.add(im); glassPools.push(im);   // rides the same lifecycle as the pane pools
    });
  }
  // ---- MASONRY VENEER POOLS (BLD_MASONRY_TEXTURE) -------------------------
  // THE BATCHING PROBLEM, stated plainly: core/batch.js refuses to merge ANY
  // mesh whose material carries a `map` (batch.js:171/:196). Brick is the most
  // object-dense material in the game, so texturing the STRUCTURAL walls would
  // opt hundreds of collider-bearing wall boxes per building out of the
  // city-wide merge — the single worst draw-call trade available.
  //
  // THE ANSWER: structural masonry stays flat-Lambert + untextured (fully
  // mergeable, unchanged); the brick/stone COURSING rides thin VENEER TILES on
  // InstancedMesh pools, exactly like the window panes above. Pools partition
  // by (colourway, 320u sector) — with world/textures_masonry.js's fixed SIX
  // colourways that is at most 6 draw calls per populated sector, for the whole
  // city's brickwork. Tiles are ~1.6m × 0.8m so ONE tile == ONE texture repeat
  // (r128 BoxGeometry UVs run 0..1 per face), which is why the consumer stamps
  // a grid of tiles instead of one stretched panel per band.
  const masonryPools = [];
  let pendingMasonry = [];
  function addMasonryTile(group, lx, ly, lz, bw, bh, bd, cwid, ox, oz) {
    pendingMasonry.push({ x: ox + lx, y: ly, z: oz + lz, hw: bw / 2, hh: bh / 2, hd: bd / 2, cw: cwid, _grp: group });
  }
  // like pooledIM, but the veneer is a LIT surface that must take the sun's
  // shadow (a brick band that ignores shadows reads as a decal), and it draws
  // in the opaque pass (renderOrder 0) since it is fully opaque.
  function masonryIM(recs, matM) {
    const geo = unitBox().clone();
    // veneer tiles are vertical sheets: drop the ±Y slivers exactly as the
    // pane pools do (a third of the triangles, invisible either way).
    const idx = geo.index.array;
    const kept = new idx.constructor(24);
    kept.set(idx.subarray(0, 12), 0);      // +X, -X
    kept.set(idx.subarray(24, 36), 12);    // +Z, -Z
    geo.setIndex(new THREE.BufferAttribute(kept, 1));
    geo.clearGroups();
    let nx = 1e9, xx = -1e9, ny = 1e9, xy = -1e9, nz = 1e9, xz = -1e9, span = 0;
    for (const r of recs) {
      if (r.x < nx) nx = r.x; if (r.x > xx) xx = r.x;
      if (r.y < ny) ny = r.y; if (r.y > xy) xy = r.y;
      if (r.z < nz) nz = r.z; if (r.z > xz) xz = r.z;
      const s = Math.max(r.hw, r.hh, r.hd); if (s > span) span = s;
    }
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3((nx + xx) / 2, (ny + xy) / 2, (nz + xz) / 2),
      Math.hypot(xx - nx, xy - ny, xz - nz) / 2 + span + 1);
    const im = new THREE.InstancedMesh(geo, matM, recs.length);
    im.castShadow = false; im.receiveShadow = true; im.renderOrder = 0;
    im.frustumCulled = true;
    im.userData.masonryPool = true;    // non-empty userData → core/batch.js skips it
    return im;
  }
  function buildMasonryPools() {
    if (!pendingMasonry.length) return;
    const batch = pendingMasonry; pendingMasonry = [];
    if (!CBZ.masonryMat) return;                       // textures module absent → geometry-only masonry
    let root = null;
    for (const r of batch) { if (r._grp && r._grp.parent) { root = r._grp.parent; break; } }
    if (!root) root = CBZ.scene;
    const byKS = new Map();
    for (const r of batch) {
      const k = r.cw + "|" + sectorKey(r);
      let a = byKS.get(k); if (!a) { a = []; byKS.set(k, a); } a.push(r);
      r._grp = null;
    }
    byKS.forEach(function (recs, k) {
      const id = k.slice(0, k.indexOf("|"));
      let matM = null;
      try { matM = CBZ.masonryMat(id); } catch (e) { matM = null; }
      if (!matM) return;
      const im = masonryIM(recs, matM);
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        _pPos.set(r.x, r.y, r.z); _pScl.set(r.hw * 2, r.hh * 2, r.hd * 2);
        im.setMatrixAt(i, _pM.compose(_pPos, _pQ, _pScl));
      }
      im.instanceMatrix.needsUpdate = true;
      root.add(im); masonryPools.push(im);
    });
    hookMasonryQuality();
    if (CBZ.getQualityLevel && CBZ.getQualityLevel() <= 0) masonryTier(0);
  }
  // ONE writer for the veneer's tier visibility. `cullLocked` tells
  // core/farcull.js that somebody else owns this object's hidden state, so its
  // re-show-on-approach pass leaves it alone — without it, walking up to a
  // sector farcull had culled would resurrect the brickwork at tier 0.
  function masonryTier(lvl) {
    const off = lvl <= 0;
    for (let i = 0; i < masonryPools.length; i++) {
      const p = masonryPools[i];
      p.userData.cullLocked = off;
      if (off) p.visible = false;
      else if (!p.visible) p.visible = true;
    }
  }
  // Tier gate: at the lowest quality tier the veneer is pure decoration on top
  // of an already-correct flat wall, so drop it wholesale rather than paying
  // its vertex cost. (Texture RESOLUTION is tiered separately, inside
  // world/textures_masonry.js, at first-use.)
  // Registered LAZILY on the first pool build — core/quality.js loads AFTER
  // this file (index.html: buildings.js ~470, quality.js ~988), so
  // CBZ.onQualityChange does not exist at parse time.
  let _masonryQHooked = false;
  function hookMasonryQuality() {
    if (_masonryQHooked || !CBZ.onQualityChange) return;
    _masonryQHooked = true;
    CBZ.onQualityChange(function (lvl) { masonryTier(lvl); });
  }

  /* ==================================================================
     A POOL IN WORLD COORDINATES MUST HANG AT IDENTITY
     ------------------------------------------------------------------
     Three pools in this file (panes / room dressing / masonry veneer)
     and one in city/interiorlight.js all compose their instance
     matrices from WORLD coordinates — `addCityGlass`, `addRoomDeco` and
     `addMasonryTile` every one of them store `ox + lx`. A building
     GROUP, by contrast, is TRANSLATED (`bgroup.position.set(ox,0,oz)`,
     ~line 2279) and everything drawn into it is LOCAL. Mixing the two
     is a silent, total displacement: parent a world-coordinate pool to
     a building group and EVERY instance in the city moves by that one
     building's origin — no error, no warning, and (because the Y offset
     is 0) the panels keep plausible heights, so the result reads as a
     second, ghost city standing on open ground a few hundred metres
     away. That shipped, twice, and the owner found it both times.

     The old cure was RELATIVE — "one hop up from the building group".
     It is right only while every builder nests a building group exactly
     one level under identity, which is true today (all ~12
     cityMakeBuilding callers pass `city.root`) and is not a law anybody
     wrote down. So the anchor is now ABSOLUTE and DERIVED:
     poolIdentityHost walks the ancestor chain from the TOP and returns
     the DEEPEST node whose accumulated transform is still identity —
     `city.root` for the shipped world (so the mode-visibility toggle
     still owns these pools and nothing changes), and still the correct
     node under any future nesting.
     ================================================================== */
  function nodeMoved(n) {
    const p = n.position, r = n.rotation, s = n.scale;
    if (p && (p.x || p.y || p.z)) return true;
    if (r && (r.x || r.y || r.z)) return true;
    if (s && (s.x !== 1 || s.y !== 1 || s.z !== 1)) return true;
    return false;
  }
  // The search deliberately starts ABOVE the caller's own group. A shared pool
  // must outlive any one building: if a building happened to sit at ox=oz=0 its
  // group would BE an identity node, and hanging the whole city's panels off it
  // would be coordinate-correct and lifecycle-fatal — demolishing that one
  // building would take every window in the city with it. So the caller's group
  // is never a candidate, only its ancestors.
  CBZ.poolIdentityHost = function (node) {
    if (!node) return null;
    const chain = [];
    for (let n = node.parent; n; n = n.parent) chain.push(n);
    let host = null;
    for (let i = chain.length - 1; i >= 0; i--) {
      if (nodeMoved(chain[i])) break;      // this node and all below it are displaced
      host = chain[i];
    }
    return host;                            // null → caller keeps its own fallback
  };

  /* RATCHET — CBZ.poolParentAudit().
     Measures the law above over the LIVE scene graph, so it can never
     disagree with what actually renders. It reads the stamps the pools
     ALREADY carry (`glassPool`, `masonryPool`, `worldDetail`) plus the
     generic `worldSpacePool` a new pool declares in one line, so nobody
     registers anything and there is no parallel bookkeeping to rot.
       pools               — every InstancedMesh in the scene
       worldPools          — every mesh DECLARING world-space records,
                             instanced or merged. world/detail_kit.js's Sheet
                             is a plain merged Mesh carrying `worldDetail` and
                             is exactly as displaceable as an InstancedMesh, so
                             the test is the CLAIM, never the class.
       atRoot              — world-space pools whose whole ancestor chain
                             (including the mesh itself) is identity: CORRECT
       atTranslatedParent  — world-space pools hanging under a moved node.
                             THE BUG. PIN AT 0.
       localSpace          — instanced meshes with no world-space claim that
                             sit under a moved node (a gatehouse's own
                             fittings, an aircraft's cabin rows). By design;
                             reported so `atTranslatedParent` cannot be
                             "fixed" by quietly reclassifying an offender.
       offenders           — {name, dx, dy, dz} for every atTranslatedParent,
                             so a failure names the file instead of a count. */
  CBZ.poolParentAudit = function () {
    const out = { pools: 0, worldPools: 0, atRoot: 0, atTranslatedParent: 0,
                  localSpace: 0, offenders: [] };
    const scene = CBZ.scene;
    if (!scene || !scene.traverse) return out;
    scene.traverse(function (o) {
      if (!o.isMesh) return;
      const u = o.userData || {};
      const world = !!(u.glassPool || u.masonryPool || u.worldDetail || u.worldSpacePool);
      if (!o.isInstancedMesh && !world) return;      // an ordinary local mesh is not this law's business
      if (o.isInstancedMesh) out.pools++;
      // accumulate the chain INCLUDING the mesh itself — a pool nudged by its
      // own position displaces its instances exactly as a moved parent does.
      let dx = 0, dy = 0, dz = 0, moved = false;
      for (let n = o; n; n = n.parent) {
        if (nodeMoved(n)) {
          moved = true;
          if (n.position) { dx += n.position.x; dy += n.position.y; dz += n.position.z; }
        }
      }
      if (!world) { if (moved) out.localSpace++; return; }
      out.worldPools++;
      if (!moved) { out.atRoot++; return; }
      out.atTranslatedParent++;
      out.offenders.push({ name: o.name || u.worldDetail || u.worldSpacePool || "(unnamed)",
                           dx: +dx.toFixed(3), dy: +dy.toFixed(3), dz: +dz.toFixed(3) });
    });
    return out;
  };

  // PUBLIC: swap the ~15% "someone's home" panes between their day tint and
  // the warm lit pool. Idempotent; self-driven below on view.js's hysteresis
  // thresholds, but exposed so the dusk pass can call it directly too.
  CBZ.cityGlassNight = function (on) {
    on = !!on;
    if (on === glassNightOn) return;
    glassNightOn = on;
    // day → the all-zero lit pools stop being submitted at all (count 0);
    // night → restore capacity BEFORE the matrices flip in.
    for (let i = 0; i < litPools.length; i++) {
      litPools[i].count = on ? (litPools[i].userData.litCapacity || 0) : 0;
    }
    for (let i = 0; i < cityGlass.length; i++) {
      const gp = cityGlass[i];
      if (!gp.lit || !gp.pool || gp.shattered) continue;
      paneShow(gp, true);
    }
  };
  // a radial SPIDER-CRACK texture (white fracture lines on transparent) painted
  // over a pane the instant a bullet hits it — the pane lingers cracked for a
  // beat, reading as "about to shatter", then bursts. One shared texture/material.
  function crackTex() {
    if (_crackTex) return _crackTex;
    const c = document.createElement("canvas"); c.width = 128; c.height = 128;
    const x = c.getContext("2d");
    x.clearRect(0, 0, 128, 128);
    const cxp = 64, cyp = 64;
    x.strokeStyle = "rgba(240,250,255,0.92)"; x.lineCap = "round";
    // radial fracture spokes, each kinked to look like real glass
    const spokes = 11;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2 + (i * 0.37);
      const len = 40 + (i * 13 % 24);
      x.lineWidth = 2.2 - (i % 3) * 0.5;
      x.beginPath(); x.moveTo(cxp, cyp);
      const mx = cxp + Math.cos(a) * len * 0.55 + Math.cos(a + 1.3) * 6;
      const my = cyp + Math.sin(a) * len * 0.55 + Math.sin(a + 1.3) * 6;
      x.lineTo(mx, my);
      x.lineTo(cxp + Math.cos(a) * len, cyp + Math.sin(a) * len);
      x.stroke();
    }
    // concentric web rings linking the spokes
    x.lineWidth = 1.1;
    for (const rr of [12, 24, 38]) {
      x.beginPath();
      for (let i = 0; i <= spokes; i++) {
        const a = (i / spokes) * Math.PI * 2 + (i * 0.37);
        const px = cxp + Math.cos(a) * (rr + (i % 2) * 4), py = cyp + Math.sin(a) * (rr + (i % 2) * 4);
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.stroke();
    }
    // bright impact pit
    x.fillStyle = "rgba(255,255,255,0.95)"; x.beginPath(); x.arc(cxp, cyp, 4, 0, 7); x.fill();
    const t = new THREE.CanvasTexture(c); t.transparent = true;
    _crackTex = t; return t;
  }
  function crackMat() {
    // each crack fades independently, so each gets its own cheap material
    // (shared canvas texture though) — capped at a couple dozen live cracks.
    return new THREE.MeshBasicMaterial({ map: crackTex(), transparent: true, depthWrite: false, opacity: 0.96 });
  }
  const crackQuads = [];   // pooled spider-crack decals fading toward a burst

  // register a pane; group/local coords mirror lbox, (ox,oz) → world. opts.solid
  // makes it a height-gated collider (showroom walls) tracked so a burst frees
  // it. opts.tint picks the pooled glass tint; opts.external (jewelry cases)
  // forces an individual mesh because the owner watches rec.mesh directly.
  function addCityGlass(group, lx, ly, lz, pw, ph, pd, ox, oz, o, list) {
    o = o || {};
    // OWNER RULE: no gray windows. The "reflective" mirror panes read as flat
    // gray slabs next to the see-through tints, so every pane is CLEAR unless
    // CBZ.CONFIG.CITY_REFLECTIVE_GLASS is flipped back on (one-line revert).
    if (CBZ.CONFIG && CBZ.CONFIG.CITY_REFLECTIVE_GLASS == null) CBZ.CONFIG.CITY_REFLECTIVE_GLASS = false;
    const allowMirror = !!(CBZ.CONFIG && CBZ.CONFIG.CITY_REFLECTIVE_GLASS);
    const rec = { mesh: null, pool: null, inst: -1, litPool: null, litId: -1, lit: false,
      tint: (o.tint || 0) % GLASS_TINTS,
      kind: (allowMirror && o.kind === "reflective") ? "reflective" : "clear",   // pooled-pane glass kind (see-through vs mirror-ish)
      frontageRole: o.role || "",
      x: ox + lx, y: ly, z: oz + lz, span: Math.max(pw, pd) * 0.5, hw: pw / 2, hh: ph / 2, hd: pd / 2,
      shattered: false, col: null };
    if (o.external) {
      // EXTERNAL one-offs (jewelry cases) keep a real individual mesh — the
      // owner watches rec.mesh directly. A handful city-wide, never a cost.
      const m = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), glassMat());
      m.position.set(lx, ly, lz); m.castShadow = false; m.receiveShadow = false; m.renderOrder = 1;
      group.add(m); rec.mesh = m;
      if (o.solid) {
        const c = { minX: ox + lx - pw / 2, maxX: ox + lx + pw / 2, minZ: oz + lz - pd / 2, maxZ: oz + lz + pd / 2, ref: m, y0: ly - ph / 2, y1: ly + ph / 2 };
        CBZ.colliders.push(c); rec.col = c;
      }
    } else {
      // POOLED pane — the ONLY rendered form now. Solid (collider-backed)
      // panes used to get an individual Mesh + unique BoxGeometry each; the
      // curtain-wall pane grids made that ~63,000 meshes/geometries — the
      // single biggest draw-call + heap cost in the whole game (measured).
      // A solid pane now keeps its physics via an INVISIBLE proxy mesh
      // (shared unit-box geometry, zero draw calls, kept only because
      // collider consumers identify glass through c.ref.material) while the
      // instanced pools carry its pixels like every other pane. rec.mesh
      // stays null so every show/hide site takes the paneShow() path.
      if (o.solid) {
        const m = new THREE.Mesh(unitBox(), glassMat());
        m.position.set(lx, ly, lz); m.scale.set(pw, ph, pd);
        m.visible = false;                       // pool renders it — proxy never draws
        m.matrixAutoUpdate = false; m.updateMatrix();
        group.add(m); rec.proxy = m;
        const c = { minX: ox + lx - pw / 2, maxX: ox + lx + pw / 2, minZ: oz + lz - pd / 2, maxZ: oz + lz + pd / 2, ref: m, y0: ly - ph / 2, y1: ly + ph / 2 };
        CBZ.colliders.push(c); rec.col = c;
      } else {
        // ~15% of non-solid panes are flagged "lit after dusk" — deterministic
        // per world position so the night skyline doesn't reshuffle every run.
        const hsh = Math.sin(rec.x * 12.9898 + rec.y * 78.233 + rec.z * 37.719) * 43758.5453;
        rec.lit = (hsh - Math.floor(hsh)) < 0.15;
      }
      rec._grp = group;
      pendingGlass.push(rec);
    }
    cityGlass.push(rec); if (list) list.push(rec);
    return rec.mesh;
  }
  // ---- CRACKED PANES -------------------------------------------------------
  // A PUNCH THAT NEVER LANDS TWICE NEVER BREAKS ANYTHING. Melee is deliberately
  // two-stage (first swing spider-cracks, second blows it out), but `cracked`
  // used to be cleared by the DECAL's expiry — and the decal lives 0.45-0.70s.
  // So the second punch had to arrive inside a ~half-second window or the pane
  // silently re-healed and you were back at swing one, forever. Measured: a
  // pooled (non-collider) pane — which is every interior/partition pane in the
  // game — was effectively unbreakable by fist at any human click rate, while
  // collider-backed curtain-wall panes burst on hit one. That is exactly the
  // "the office glass isn't real like the window glass" report.
  //
  // The fade and the STATE are now separate clocks: the decal still fades on its
  // own cosmetic schedule, while the pane stays genuinely cracked for CRACK_HOLD
  // seconds — long enough that a second swing at a normal rhythm always finishes
  // the job, short enough that the world still re-glazes itself if you wander off.
  const crackedPanes = [];   // panes holding "one more hit finishes it"
  const CRACK_HOLD = 6.0;    // seconds a cracked pane stays cracked
  function markCracked(gp) {
    gp.cracked = true;
    gp.crackHold = CRACK_HOLD;
    if (crackedPanes.indexOf(gp) === -1) crackedPanes.push(gp);
  }
  // lay a fading spider-crack decal flat over a pane (just before it bursts).
  // Cheap: a single quad on a shared material, pooled and capped.
  // (bx,bz) points from the pane back toward whoever struck it, so the decal
  // lands on the face being HIT. It used to be placed by the pane's own world
  // sign (`gp.z >= 0`), which put the crack on the far side of the glass for
  // half the map and on the outside of every interior pane — you punched, the
  // only feedback rendered behind the wall, and the swing read as a whiff.
  function crackPane(gp, hx, hy, hz, bx, bz) {
    if (gp.shattered || gp.cracked) return;
    markCracked(gp);                     // state FIRST: a capped decal pool must
                                         // never cost the player a landed hit
    if (crackQuads.length > 24) return;
    const horiz = gp.hd < gp.hw;   // pane wider in X than Z → faces ±Z
    const sz = Math.min(1.5, Math.max(0.7, gp.span));
    const q = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), crackMat());
    const px = hx != null ? hx : gp.x, py = hy != null ? hy : gp.y, pz = hz != null ? hz : gp.z;
    if (horiz) {
      const off = bz != null ? (bz >= 0 ? 0.05 : -0.05) : (gp.z >= 0 ? 0.05 : -0.05);
      q.position.set(px, py, gp.z + off);
    } else {
      const off = bx != null ? (bx >= 0 ? 0.05 : -0.05) : (gp.x >= 0 ? 0.05 : -0.05);
      q.position.set(gp.x + off, py, pz); q.rotation.y = Math.PI / 2;
    }
    q.renderOrder = 3;
    CBZ.scene.add(q);
    crackQuads.push({ mesh: q, gp, life: 0.45 + Math.random() * 0.25, fade: 0 });
  }
  // hit (optional): {x, y, z, dx, dz, power} — where the pane was struck and
  // which way the blow travelled, so the shards radiate from the strike.
  function burstPane(gp, hit) {
    if (gp.shattered) return;
    gp.shattered = true; shatteredPanes++; shatteredList.push(gp);
    if (gp.mesh) gp.mesh.visible = false;
    else paneShow(gp, false);          // pooled pane: zero its instance matrix
    if (gp.col) CBZ.colliderRemove(gp.col);   // incremental: the glass debris below queries the grid
    // clear any lingering crack decal for this pane
    for (let i = crackQuads.length - 1; i >= 0; i--) if (crackQuads[i].gp === gp) { CBZ.scene.remove(crackQuads[i].mesh); crackQuads.splice(i, 1); }
    if (!CBZ.debris) return;
    // THE PANE ITSELF BREAKS: its own box and its own glass, cut into radial
    // shards around the strike (debris.js glass fracture), thrown the way the
    // blow was going, leaving glitter and a fine glass dust.
    const horiz = gp.hd < gp.hw, outN = horiz ? (gp.z >= 0 ? 1 : -1) : (gp.x >= 0 ? 1 : -1);
    let dx = horiz ? 0 : outN, dz = horiz ? outN : 0;
    if (hit && (hit.dx || hit.dz)) { dx = hit.dx; dz = hit.dz; }
    const at = hit ? { x: hit.x, y: hit.y, z: hit.z } : { x: gp.x + (Math.random() - 0.5) * gp.hw, y: gp.y + (Math.random() - 0.5) * gp.hh, z: gp.z + (Math.random() - 0.5) * gp.hd };
    const mat = (gp.mesh && gp.mesh.material) || (gp.proxy && gp.proxy.material) || (gp.pool && gp.pool.material) || glassMat();
    CBZ.debris.shatterBox({
      minX: gp.x - gp.hw, maxX: gp.x + gp.hw, minY: gp.y - gp.hh, maxY: gp.y + gp.hh,
      minZ: gp.z - Math.max(gp.hd, 0.006), maxZ: gp.z + Math.max(gp.hd, 0.006),
    }, mat, {
      kind: "glass", at, dir: { x: dx, y: 0.1, z: dz },
      power: hit && hit.power != null ? hit.power : 0.9,
      maxPieces: Math.max(5, Math.min(16, Math.round(gp.span * 7))),
      speed: 2.2,
    });
  }
  // Glass is audible only when the player personally strikes/shoots a pane.
  // The physical shatter APIs are also called by NPC fire, crashes, tornadoes,
  // aircraft and explosions, so those callers must opt in explicitly instead
  // of making a global pane-state change sound like it happened beside you.
  // A small local rolloff makes a far pane disappear beneath the player's gun
  // report; beyond 55m it is intentionally inaudible.
  const PLAYER_GLASS_HEAR_DIST = 55;
  // gain scales the whole cue: 1 = a pane coming down, ~0.4 = a pane taking a
  // hit and holding (the melee crack stage).
  function playPlayerGlass(gp, gain) {
    if (!gp || !CBZ.sfx) return;
    gain = gain == null ? 1 : gain;
    const p = CBZ.player && CBZ.player.pos;
    let dist = null;
    if (p) dist = Math.hypot(gp.x - p.x, gp.y - (p.y || 0), gp.z - p.z);
    if (dist != null && dist >= PLAYER_GLASS_HEAR_DIST) return;
    const volume = (dist == null ? 1 : Math.max(0, 1 - Math.max(0, dist - 8) / (PLAYER_GLASS_HEAR_DIST - 8))) * gain;
    CBZ.sfx("glass", dist == null ? { volume: volume } : { dist: dist, volume: volume });
  }
  // burst every intact pane within r of (x,z) — called on car crashes etc.
  // SWISS CHEESE: a blast doesn't just clear glass — up to PER_BLAST_OPEN of the
  // nearest WINDOW-SIZED panes carve into real see-through holes/rooms, so a
  // rocket peppers a facade with openings (the wall `_breached` dedup keeps
  // same-face panes from carving twice → bounded cost, no cache/cleanup).
  const PER_BLAST_OPEN = 8;
  // ---- DEFERRED WINDOW-OPENING CARVES (rocket-frame de-spike, part 2) -------
  // tryWindowOpening runs the carveHole MONOLITH (collider scan + remnant
  // geometry builds + a BufferGeometryUtils merge + full cityGlass/roomDeco
  // sweeps) — and cityShatter used to fire up to PER_BLAST_OPEN(8) of them
  // SYNCHRONOUSLY inside the rocket's impact frame, plus one more from
  // cityShatterRay. fracture.js already deferred blastAt's single carve for
  // exactly this cost (see its DEFERRED LOCAL CARVE header — the same monolith
  // ballooned the impact frame ~200→350ms); the window-opening storm was the
  // remaining synchronous copy of that work, ~8x over. Same fix: the panes still BURST on
  // the impact frame (the visible feedback), only the cosmetic room-reveal
  // carve drains at 1/frame afterwards — the boom/dust/shards mask the slip,
  // and the openings appearing one-per-frame reads as progressive collapse.
  // Every drained carve re-resolves from live state (carveHole returns null on
  // a breached/missing wall), so stale entries self-cancel; the queue clears
  // on mode exit and on cityGlassReset so a fresh arena never inherits one.
  const winOpenQ = [];
  const WINOPEN_BUDGET = 1;        // carves drained per city frame
  const WINOPENQ_CAP = 24;         // a multi-blast salvo can't grow it unbounded
  function queueWindowOpening(gp) {
    if (!gp) return;
    if (winOpenQ.length >= WINOPENQ_CAP || winOpenQ.indexOf(gp) !== -1) return;
    winOpenQ.push(gp);
  }
  CBZ.cityShatter = function (x, z, r, opts) {
    opts = opts || {};
    const r2 = r * r; let n = 0, near = null, nearD = 1e9;
    const cand = [];   // window-sized in-radius panes eligible to carve an opening
    for (let i = 0; i < cityGlass.length; i++) {
      const gp = cityGlass[i]; if (gp.shattered) continue;
      const dx = gp.x - x, dz = gp.z - z, dd = dx * dx + dz * dz;
      if (dd <= r2) {
        // gather BEFORE bursting (burstPane marks shattered): pooled (no mesh),
        // above the sill, window-sized — so we open windows, not transoms
        if (!gp.mesh && gp.y > 1.0 && Math.max(gp.hw, gp.hd) * 2 >= 0.7) cand.push({ gp, dd });
        { const d = Math.sqrt(dd) || 1, fall = Math.max(0.35, 1.6 - d / Math.max(1, r));
          burstPane(gp, { x: gp.x, y: gp.y, z: gp.z, dx: (gp.x - x) / d, dz: (gp.z - z) / d, power: Math.min(2.2, fall * (opts.power || 1.2)) }); }
        if (dd < nearD) { nearD = dd; near = gp; } if (++n > 50) break;
      }
    }
    // open the nearest few as real holes/rooms; tryWindowOpening reads the
    // pane's stored x/y/z (it doesn't care that the pane is now "shattered"),
    // and carveHole's wall `_breached` flag makes same-face panes a no-op carve.
    // QUEUED, not inline (see winOpenQ above): eight carveHole monoliths in the
    // impact frame were the filmed rocket stall — they drain 1/frame instead.
    cand.sort(function (a, b) { return a.dd - b.dd; });
    const lim = Math.min(PER_BLAST_OPEN, cand.length);
    for (let i = 0; i < lim; i++) queueWindowOpening(cand[i].gp);
    if (!lim && near) queueWindowOpening(near);   // fallback: nearest pane (sub-window slivers only)
    if (n > 0 && opts.directPlayer && near) playPlayerGlass(near);
    // a hard impact (big radius shatter = a car ploughing a storefront) also
    // knocks a couple of concrete chunks off and leaves no scorch — just rubble.
    if (r >= 7 && near && CBZ.debris) CBZ.debris.chips(near.x, near.y, near.z, { kind: "glass", count: 10, power: 1 });
    return n;
  };
  // SHOOTING a window: ray-test (origin, dir) against every intact pane and burst
  // the NEAREST one the bullet actually passes through, within maxDist. Glass has
  // no collider in the gun's wall raycast, so the shot passes through it invisibly —
  // this is what makes the pane you fired through actually break. Returns the rec.
  let bestHX = 0, bestHY = 0, bestHZ = 0;   // impact point of the last ray-shatter
  // distance along the shot ray at which the last cityShatterRay broke a pane,
  // or -1 if it broke nothing. The shot caller can read this to suppress the
  // wall pock that the SOLID wall behind the glass would otherwise stamp on the
  // very frame the pane bursts (intact pane → wall registers the round, glass
  // breaks: a pock-behind-the-glass double hit). CITY-only consumer.
  CBZ.cityLastShatterDist = -1;
  // force=true (bullets) blows the pane out on the FIRST hit — a fired round
  // through a window should never read as "nothing happened". Default (melee)
  // keeps the two-stage crack-then-burst, so punching a window takes a couple
  // of swings.
  //
  // POINT-BLANK STABILITY: the old slab test used `t = tmin>0 ? tmin : 0`, so any
  // pane whose slab the MUZZLE sat inside collapsed to entry distance 0. With a
  // storefront's many adjacent panes that made every flush pane a 0-distance tie
  // — array order (not the aimed pane) won, so a point-blank shot could burst a
  // pane off to the side, the impact point snapped to the muzzle (outside the
  // pane), and a grazing/parallel muzzle-inside shot could pop a pane it never
  // actually crossed (flicker / wrong-pane break). Now: clip the ray to the
  // pane's slab, require a real FORWARD crossing (positive-length forward segment
  // ahead of the muzzle within range), select by true forward entry distance, and
  // take the impact point at the MIDPOINT of the segment inside the pane so the
  // decal/chip always lands in the glass — stable from touching distance to range.
  // opts.back — THE FIST INSIDE THE PANE. A shot starts at a muzzle held out in
  // front of you; a PUNCH starts at your own centre, and a body standing flush
  // against glass has its centre within a body-radius (0.38m) of the pane plane
  // — or straight past it, whenever the glass carries no collider and you simply
  // walked into it. A pane that is not strictly FORWARD of the origin was never
  // tested, so the swing sailed through and nothing broke: measured, a punch
  // landed at every standoff from 3.0m down to 0.0m and then failed at every
  // negative one. That is the owner's "you have to be a perfect distance away to
  // punch glass — too close and your punch registers thru it". `back` lets a
  // strike reach that far BEHIND its own origin, which is where the glass you
  // are pressed against actually is. Bounded to roughly a body radius so it can
  // never reach a different pane standing behind you, and it defaults to 0, so
  // every gun/blast caller keeps byte-identical behaviour.
  CBZ.cityShatterRay = function (ox, oy, oz, dx, dy, dz, maxDist, force, opts) {
    opts = opts || {};
    const nl = Math.hypot(dx, dy, dz) || 1; dx /= nl; dy /= nl; dz /= nl;
    const lim = maxDist != null ? maxDist : 1e9;
    const back = opts.back > 0 ? Math.min(opts.back, 0.75) : 0;
    CBZ.cityLastShatterDist = -1;
    let best = null, bestT = lim, bestMid = lim, bestExit = lim;
    for (let i = 0; i < cityGlass.length; i++) {
      const gp = cityGlass[i]; if (gp.shattered) continue;
      let tmin = -1e9, tmax = 1e9;                     // ray-vs-AABB slab test
      if (Math.abs(dx) < 1e-8) { if (Math.abs(gp.x - ox) > gp.hw) continue; }
      else { let a = ((gp.x - gp.hw) - ox) / dx, b = ((gp.x + gp.hw) - ox) / dx; if (a > b) { const s = a; a = b; b = s; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; }
      if (Math.abs(dy) < 1e-8) { if (Math.abs(gp.y - oy) > gp.hh) continue; }
      else { let a = ((gp.y - gp.hh) - oy) / dy, b = ((gp.y + gp.hh) - oy) / dy; if (a > b) { const s = a; a = b; b = s; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; }
      if (Math.abs(dz) < 1e-8) { if (Math.abs(gp.z - oz) > gp.hd) continue; }
      else { let a = ((gp.z - gp.hd) - oz) / dz, b = ((gp.z + gp.hd) - oz) / dz; if (a > b) { const s = a; a = b; b = s; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; }
      if (tmax < tmin) continue;                        // ray misses the box entirely
      // forward segment the ray spends INSIDE this pane: [tEnter, tExit].
      const tEnter = tmin > -back ? tmin : -back;       // clamp the origin-inside case to the reach-behind
      const tExit = tmax < lim ? tmax : lim;            // bounded by the round's reach
      if (tExit <= -back + 1e-5 || tExit <= tEnter) continue;   // pane is behind the strike's reach, or no extent → not crossed
      // SELECT the pane whose forward entry is nearest; when several flush panes
      // share entry 0 (muzzle inside, point-blank), break the tie on the SHORTER
      // forward exit — that's the thin pane the round is actually punching out,
      // not a neighbour the muzzle merely overlaps along its in-plane span.
      if (tEnter < bestT - 1e-4 || (tEnter <= bestT + 1e-4 && tExit < bestExit)) {
        bestT = tEnter; bestExit = tExit; best = gp;
        bestMid = (tEnter + tExit) * 0.5;               // impact point sits INSIDE the glass, never on the muzzle
        bestHX = ox + dx * bestMid; bestHY = oy + dy * bestMid; bestHZ = oz + dz * bestMid;
      }
    }
    if (best) {
      // entry distance of the pane we broke, for the wall-pock suppression above
      CBZ.cityLastShatterDist = bestT;
      // a bullet (force) or a second hit — or a solid showroom pane — blows it
      // fully out; otherwise spider-crack it (and chip a shard off the point).
      // The pane bursts NOW (the feedback); the room-reveal carve queues (1-
      // frame slip, same winOpenQ de-spike the blast path uses).
      if (force || best.cracked || best.col) {
        burstPane(best, { x: bestHX, y: bestHY, z: bestHZ, dx: dx, dz: dz, power: force ? 1.1 : 0.7 }); queueWindowOpening(best);
        if (opts.directPlayer) playPlayerGlass(best);
      }
      else {
        // strike direction reversed → the decal lands on the face being hit
        crackPane(best, bestHX, bestHY, bestHZ, -dx, -dz);
        spawnGlassChip(bestHX, bestHY, bestHZ, -dx, -dz);
        // A LANDED HIT MUST BE AUDIBLE. The first swing of the two-stage break
        // used to make no sound at all, so a punch that genuinely connected was
        // indistinguishable from one that missed the pane entirely — the other
        // half of "I can't punch and break it". Quieter than the burst: this is
        // glass surviving a hit, not glass coming down.
        if (opts.directPlayer) playPlayerGlass(best, 0.4);
      }
    }
    return best;
  };
  // one or two tiny glass chips spit off the impact point of a single bullet
  function spawnGlassChip(x, y, z, dx, dz) {
    if (CBZ.debris) CBZ.debris.chips(x, y, z, { kind: "glass", count: 2 + ((Math.random() * 2) | 0), dir: { x: dx || 0, y: 0.2, z: dz || 0 }, power: 0.5, dust: false });
  }
  // ---- OPEN-WINDOW SHOT HOLES --------------------------------------------
  // Walls are SOLID per-storey boxes; window panes are decorative glass hanging
  // ≤0.105 PROUD of either wall face. So "shooting through a window" needs an
  // exception, not new geometry: given a losBlocker ray hit (px,py,pz) on a
  // wall face and that face's horizontal normal (nx,nz — object space == world
  // for these axis-aligned boxes; sign irrelevant), true means a SHATTERED
  // pane's rect covers the point → the "wall" there is really an open window
  // frame and the ray should keep tracing. los.js (NPC line-of-fire) and
  // fpsmode's wall raycast both consult this, so bullets fly through broken
  // windows in BOTH directions while intact glass keeps its wall's protection
  // (panes never register as blockers — the first round breaks the pane via
  // cityShatterRay, the next ones pass through the hole it left).
  // Off-plane tolerance 0.62 = pane offset 0.105 + the full 0.4 wall depth
  // (a hit on the FAR face of the wall still matches the near-side pane) +
  // slack — but never enough to borrow a pane from a wall a room away.
  const HOLE_TOL = 0.12, HOLE_OFF = 0.62;
  CBZ.cityShotHole = function (px, py, pz, nx, nz) {
    if (!shatteredPanes) return false;
    const faceX = Math.abs(nx || 0) >= Math.abs(nz || 0);   // wall faces ±X → panes run along Z
    for (let i = 0; i < shatteredList.length; i++) {
      const gp = shatteredList[i];
      if (!gp.shattered) continue;
      const dy = py - gp.y;
      if (dy > gp.hh + HOLE_TOL || dy < -(gp.hh + HOLE_TOL)) continue;
      const dx = px - gp.x, dz = pz - gp.z;
      const rr = gp.span + 1.0;                              // cheap spatial reject first
      if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
      // the pane's thin axis must match the struck face's normal axis, or this
      // pane dresses a PERPENDICULAR wall (same corner, wrong face)
      if (faceX ? (gp.hw > gp.hd) : (gp.hd > gp.hw)) continue;
      if (faceX) { if (Math.abs(dx) > HOLE_OFF || Math.abs(dz) > gp.hd + HOLE_TOL) continue; }
      else if (Math.abs(dz) > HOLE_OFF || Math.abs(dx) > gp.hw + HOLE_TOL) continue;
      return true;
    }
    return false;
  };
  // re-glaze the whole city for a new game (restore panes + their colliders)
  // internal export for city/demolition.js: per-pane show/hide against the
  // instanced pools (demolition hides a whole building's panes on collapse and
  // re-seats them on rebuild — same primitive burstPane/cityGlassReset use).
  CBZ._paneShow = paneShow;
  CBZ.cityGlassReset = function () {
    shatteredPanes = 0; shatteredList.length = 0;
    winOpenQ.length = 0;   // never carve a fresh arena from a stale pre-reset queue
    /* CBZ.CONFIG.DEMO_FAST_PURGE (declared in city/demolition.js, which loads
       after this file — so it is read here at CALL time, never at parse time,
       and an absent demolition.js simply leaves it undefined => legacy path).
       The re-seat test below was `CBZ.colliders.indexOf(gp.col) === -1`: a full
       scan of the city's 123,332-entry collider array PER PANE, across 37,540
       panes. Normally only a handful of panes are broken so the loop is cheap —
       but after a city-wide nuke EVERY pane is shattered and the reset pays all
       37,540 scans in one frame: measured 553 ms, on the reset that is supposed
       to hand the player a clean city. One membership Set, built once, makes it
       O(colliders + panes). Same cure as the removal direction (city/
       demolition.js's destroy() and city/structural.js's purge()). */
    const have = CBZ.CONFIG.DEMO_FAST_PURGE ? new Set(CBZ.colliders) : null;
    for (const gp of cityGlass) {
      if (gp.shattered) {
        gp.shattered = false;
        if (gp.mesh) gp.mesh.visible = true;
        else paneShow(gp, true);       // pooled pane: restore (honours night state)
        if (gp.col) {
          if (have) { if (!have.has(gp.col)) { CBZ.colliders.push(gp.col); have.add(gp.col); } }
          else if (CBZ.colliders.indexOf(gp.col) === -1) CBZ.colliders.push(gp.col);
        }
      }
      gp.cracked = false; gp.crackHold = 0;
    }
    crackedPanes.length = 0;   // a re-glazed city holds no half-broken panes
    // interior band dressing hidden by wall carves comes back with the glass
    for (let i = 0; i < roomDeco.length; i++) if (roomDeco[i].hidden) decoShow(roomDeco[i], true);
    for (const cq of crackQuads) { CBZ.scene.remove(cq.mesh); if (cq.mesh.material) cq.mesh.material.dispose(); cq.mesh.geometry.dispose(); }
    crackQuads.length = 0;
    CBZ.cityDamageReset && CBZ.cityDamageReset();
    // demolition FIRST (it clears the door demolished flags + re-registers a
    // rebuilt building's colliders), THEN doors reset can re-seat every leaf.
    if (CBZ.cityDemolition && CBZ.cityDemolition.reset) try { CBZ.cityDemolition.reset(); } catch (e) {}
    CBZ.cityDoorsReset && CBZ.cityDoorsReset();
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  };
  // register an EXTERNAL pane (the jewelry display cases — city/jewelry.js) in
  // the shared city-glass list, so bullets (cityShatterRay), blasts/crashes
  // (cityShatter) and the new-run re-glaze (cityGlassReset) all treat it as the
  // SAME real glass as every storefront — zero special-case shatter code
  // downstream. Returns the live pane record (rec.shattered = "is it broken",
  // rec.mesh = the pane) so the owner can watch it break and re-glaze on restock.
  CBZ.cityRegisterGlass = function (group, lx, ly, lz, pw, ph, pd, ox, oz, o) {
    const list = [];
    o = o || {};
    o.external = true;   // owners watch rec.mesh, so external panes stay individual meshes
    addCityGlass(group, lx, ly, lz, pw, ph, pd, ox || 0, oz || 0, o, list);
    return list[0] || null;
  };
  // shard physics + crack-decal lifecycle (cheap; only works while any exist)
  CBZ.onAlways(9, function (dt) {
    // spider cracks: a cracked pane that is left alone re-heals (clears its
    // decal) so the world doesn't accumulate cracks; a fresh decal stays put
    // briefly then fades out. (Bursting clears it via burstPane.)
    if (crackQuads.length) {
      for (let i = crackQuads.length - 1; i >= 0; i--) {
        const cq = crackQuads[i]; cq.life -= dt;
        if (cq.life < 0.2) { cq.fade += dt; cq.mesh.material.opacity = Math.max(0, 0.96 - cq.fade * 4); }
        if (cq.life <= 0) {
          CBZ.scene.remove(cq.mesh);
          if (cq.mesh.material) cq.mesh.material.dispose();
          cq.mesh.geometry.dispose();
          crackQuads.splice(i, 1);        // the DECAL is gone; the pane stays
                                          // cracked on its own clock (below)
        }
      }
    }
    // cracked panes re-heal on CRACK_HOLD, not on the decal's fade
    for (let i = crackedPanes.length - 1; i >= 0; i--) {
      const gp = crackedPanes[i];
      gp.crackHold -= dt;
      if (gp.shattered || gp.crackHold <= 0) { gp.cracked = false; crackedPanes.splice(i, 1); }
    }
  });

  // ---- VERTEX FACE SHADING (fake AO) ---------------------------------------
  // One-time colour attribute on a box: top face full-bright, ±X/±Z faces
  // stepped down, bottom face + the ground ring of wall verts darkest. It
  // multiplies material.color (vertexColors:true), so every flat box
  // de-flattens for ZERO runtime cost. Only applied to meshes the batcher
  // SPARES (collider/LOS refs keep their identity) — core/batch.js drops
  // every attribute but position/normal/uv when it merges, so a shaded mesh
  // that got merged would render black.
  function shadeGeo(geo, groundRing) {
    const pos = geo.attributes.position, nrm = geo.attributes.normal, n = pos.count;
    let minY = 1e9;
    for (let i = 0; i < n; i++) { const y = pos.getY(i); if (y < minY) minY = y; }
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const ny = nrm.getY(i);
      let f;
      if (ny > 0.5) f = 1.0;
      else if (ny < -0.5) f = 0.55;
      else {
        f = Math.abs(nrm.getX(i)) > 0.5 ? 0.86 : 0.78;
        if (groundRing && pos.getY(i) <= minY + 0.01) f = 0.55;   // grounded walls darken at the street line
      }
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = f;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return geo;
  }
  // ---- SHARED lbox RESOURCES (2026-08-03 slow-boot wave) -------------------
  // lbox built a FRESH BoxGeometry + Lambert material for every box, and once
  // interiors started building mid-play that measured ~960 new materials in
  // 20s (heap churn, GC pressure, and a program-cache-key string computed per
  // material on its first rendered frame). Plain boxes now share unit-cube
  // geometry — dimensions live in mesh.scale; batch.js clones/toNonIndexed()s
  // before baking matrixWorld, so merged output is byte-identical — and
  // cmat()-cached materials. shadeGeo's colours depend only on normals plus
  // the ground-ring flag, never on box dimensions, so los boxes share one of
  // two pre-shaded unit cubes. Emissive boxes keep FRESH materials: the sign
  // glow pulse (interior_programs.js) mutates emissiveIntensity per mesh and
  // a shared material would bleed the pulse across every same-colour box.
  let _lboxGeoLos = null, _lboxGeoLosGround = null;
  function unitBoxGeo(los, ground) {
    if (!los) { const g = unitBox(); g._shared = true; return g; }
    const make = (shadeGround) => {
      const g = new THREE.BoxGeometry(1, 1, 1);
      shadeGeo(g, shadeGround);
      g._shared = true;
      return g;
    };
    if (ground) return _lboxGeoLosGround || (_lboxGeoLosGround = make(true));
    return _lboxGeoLos || (_lboxGeoLos = make(false));
  }
  const _vcMats = new Map();
  function vcMat(col) {
    let m = _vcMats.get(col);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: col, vertexColors: true });
      m._shared = true;
      _vcMats.set(col, m);
    }
    return m;
  }

  // a darkened wall-colour variant (plinths/cornices/pilasters) — derived from
  // the shared palettes so trim colours bucket together for the batcher.
  function shadeHex(hex, f) {
    const r = Math.min(255, (((hex >> 16) & 255) * f) | 0);
    const g = Math.min(255, (((hex >> 8) & 255) * f) | 0);
    const b = Math.min(255, ((hex & 255) * f) | 0);
    return (r << 16) | (g << 8) | b;
  }

  /* ---- THE SKIN: what each wall of a building LOOKS like ------------------
     The shell walls (lbox, the colliders, the carve targets, b.losMeshes) are
     painted in the shell's base tint. On a facade-kit building nobody sees
     that tint: the grammar lays its brick piers / ashlar / stucco over every
     face as dbox trim, and core/batch.js then merges that trim away into
     city-wide buckets. So everything that broke a wall used to break the
     SHELL and threw pieces in a colour that was never on screen (the pink
     brick debris). makeBuilding records, while the kit paints, the skin
     colour of each face (area-weighted, the dark glazing/iron left out) and
     what the grammar says it is made of; CBZ.citySkin hands any breaker a
     shared skin material for the face a point is on (CBZ.debris.skinMat: a
     flat colour for a falling shell, a coursed textured sibling for pieces).
     Faces: 0 = -z, 1 = +z, 2 = -x, 3 = +x (the veneerBand convention). */
  function skinLum(c) { return (((c >> 16) & 255) * 0.299 + ((c >> 8) & 255) * 0.587 + (c & 255) * 0.114) / 255; }
  function skinNote(acc, W, D, x, y, z, bw, bh, bd, col) {
    if (!(bh > 0.3) || typeof col !== "number" || !isFinite(col)) return;
    const hw = W / 2, hd = D / 2;
    const x0 = x - bw / 2, x1 = x + bw / 2, z0 = z - bd / 2, z1 = z + bd / 2;
    const add = (f, a) => { const m = acc[f]; m.set(col, (m.get(col) || 0) + a); };
    // on a face = reaches the wall plane from outside, stands no more than a
    // couple of metres proud, and does not run back into the building
    if (bw > 0.3) {
      if (z0 < -hd + 0.05 && z0 > -hd - 2.5 && z1 < -hd + 1.2) add(0, bw * bh);
      if (z1 > hd - 0.05 && z1 < hd + 2.5 && z0 > hd - 1.2) add(1, bw * bh);
    }
    if (bd > 0.3) {
      if (x0 < -hw + 0.05 && x0 > -hw - 2.5 && x1 < -hw + 1.2) add(2, bd * bh);
      if (x1 > hw - 0.05 && x1 < hw + 2.5 && x0 > hw - 1.2) add(3, bd * bh);
    }
  }
  // per face: the dominant opaque skin colour, or null where the kit left the
  // shell showing (under 30% of the face clad) — the shell IS the skin there
  function skinPick(acc, W, D, H) {
    const faces = [null, null, null, null], all = new Map();
    for (let f = 0; f < 4; f++) {
      const area = (f < 2 ? W : D) * H;
      let clad = 0, best = null, bestA = 0;
      acc[f].forEach(function (a, col) {
        if (skinLum(col) < 0.1) return;              // glazing, iron, voids
        clad += a;
        if (a > bestA) { bestA = a; best = col; }
      });
      if (best != null && clad >= area * 0.3) {
        faces[f] = best;
        all.set(best, (all.get(best) || 0) + bestA);
      }
    }
    let hex = null, top = 0;
    all.forEach(function (a, col) { if (a > top) { top = a; hex = col; } });
    return hex == null ? null : { faces, hex };
  }
  const SKIN_OF_STRUCTURE = {
    brick: ["brick", "brick"], masonry: ["brick", "brick"], stone: ["ashlar", "rock"],
    adobe: [null, "dirt"], timber: [null, "wood"],
  };
  /* The skin material of building b at world (wx, wz) — the face nearest the
     point — or its dominant skin with no point. null = no skin recorded (the
     shell is what shows): keep the caller's own material. */
  CBZ.citySkin = function (b, wx, wz) {
    const s = b && b.skin;
    if (!s || !CBZ.debris || !CBZ.debris.skinMat) return null;
    let hex = s.hex;
    if (wx != null && wz != null && isFinite(wx) && isFinite(wz)) {
      const lx = wx - b.ox, lz = wz - b.oz;
      const e = [Math.abs(lz + b.d / 2), Math.abs(lz - b.d / 2), Math.abs(lx + b.w / 2), Math.abs(lx - b.w / 2)];
      let f = 0;
      for (let i = 1; i < 4; i++) if (e[i] < e[f]) f = i;
      hex = s.faces[f];
    }
    if (hex == null) return null;
    const tex = s.masonry && CBZ.masonryMat ? CBZ.masonryMat(s.masonry) : null;
    return CBZ.debris.skinMat(hex, s.pattern, s.kind, tex);
  };
  // Is this the building's shell-wall paint (the tint the skin covers)?
  CBZ.cityIsShellMat = function (b, m) {
    if (Array.isArray(m)) m = m[0];
    return !!(b && m && m.color && !m.map && !m.transparent && b.wallColor != null && m.color.getHex() === b.wallColor);
  };

  // ---- BUILDING DAMAGE: knocked-off chunks + crack marks -----------------
  // (Bullet holes live in ONE place: systems/gunfx.js CBZ.bulletHole — the
  // per-material atlas on one InstancedMesh. This file used to run a second,
  // parallel 110-quad pool with its own grey smudge; cityBulletHole below is
  // now a thin seam onto the real thing.)
  // a shared CRACKED-CONCRETE decal (jagged radiating fracture lines on a faint
  // grey scuff) painted once — the tier-2 wound mark before a wall blows open.
  let _crackMat = null;
  function crackMat() {
    if (_crackMat) return _crackMat;
    const c = document.createElement("canvas"); c.width = 64; c.height = 64;
    const x = c.getContext("2d");
    // faint concrete bruise behind the cracks
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, "rgba(30,30,34,0.5)"); g.addColorStop(0.6, "rgba(40,40,44,0.22)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    // jagged radiating fracture lines (a few branch)
    x.strokeStyle = "rgba(12,12,14,0.85)"; x.lineCap = "round";
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * 6.28 + (i * 1.3);
      let px = 32, py = 32, ang = a, len = 0; x.lineWidth = 1.6;
      x.beginPath(); x.moveTo(px, py);
      const segs = 4 + (i % 3);
      for (let s = 0; s < segs; s++) {
        ang += (((i * 7 + s * 5) % 9) - 4) * 0.16; len = 4 + (s + 1) * 2.6;
        px += Math.cos(ang) * len; py += Math.sin(ang) * len; x.lineTo(px, py);
      }
      x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    _crackMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    return _crackMat;
  }
  // orient a decal quad so its +Z faces along the surface normal (nx,ny,nz)
  const _nrm = new THREE.Vector3(), _q = new THREE.Quaternion(), _zAxis = new THREE.Vector3(0, 0, 1);
  function aimDecal(mesh, nx, ny, nz) {
    _nrm.set(nx, ny, nz); if (_nrm.lengthSq() < 1e-6) _nrm.set(0, 0, 1); _nrm.normalize();
    _q.setFromUnitVectors(_zAxis, _nrm); mesh.quaternion.copy(_q);
  }

  // PUBLIC (legacy seam): a bullet hole on a building face at (x,y,z) facing
  // (nx,ny,nz) — routed to the one hole system (systems/gunfx.js).
  CBZ.cityBulletHole = function (x, y, z, nx, ny, nz) {
    if (!CBZ.bulletHole) return null;
    return CBZ.bulletHole({ x: x, y: y, z: z }, { x: nx || 0, y: ny || 0, z: nz == null ? 1 : nz }, { noProp: true });
  };

  // Compatibility seam for the many explosion/crash callers. The former
  // implementation painted a generated soot texture onto the ground and nearby
  // facades; that entire printed-mark effect is owner-cut. Physical chunks,
  // shattered glass, cracks and carved openings carry building damage instead.
  CBZ.cityScorch = function () { return null; };

  // PUBLIC: knock chips of a surface off it on a big hit (blast / ram).
  // opts {count, force, dirx, dirz, color, material}: the chips + dust take the
  // colour of the surface that was hit (pass its material) — CBZ.debris owns
  // them; the struck wall's actual volume only ever leaves through a carve.
  CBZ.cityChunk = function (x, y, z, opts) {
    opts = opts || {};
    if (!CBZ.debris) return;
    const n = opts.count || (2 + ((Math.random() * 3) | 0));
    const hasDir = opts.dirx != null || opts.dirz != null;
    CBZ.debris.chips(x, y, z, {
      count: Math.round(n * 3), material: opts.material || null, color: opts.color,
      dir: hasDir ? { x: opts.dirx || 0, y: 0.35, z: opts.dirz || 0 } : null,
      power: Math.max(0.5, Math.min(2.2, (opts.force || 3) / 3.5)), spread: 0.6,
    });
  };

  // PUBLIC: CINEMATIC STRUCTURAL DAMAGE at an impact point (missiles, rockets,
  // big blasts). Called by the aircraft + explosion agents. At (x,y,z) it:
  //   1) finds the nearest building WALL face so debris flings OUTWARD,
  //   2) knocks off concrete CHUNKS scaled by `power`,
  //   3) BURSTS every window pane within blast radius (spider-cracks → out),
  //   4) accumulates real structural damage toward a carved opening.
  // Pooled + capped throughout. `power` ~0.5 (light) … 3 (heavy ordnance).
  CBZ.cityDamageBuilding = function (x, y, z, power) {
    power = power || 1;
    if (y == null) y = (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + 1.4;
    // locate the nearest tall wall collider to derive an outward normal + a
    // surface point for debris and structural damage at the actual facade.
    let best = null, bestD = 1e9, bnx = 0, bnz = 1, bsx = x, bsz = z, bsy = y;
    const searchR2 = 36;   // 6m: a wall right at the impact
    for (let i = 0; i < CBZ.colliders.length; i++) {
      const c = CBZ.colliders[i]; if (c.y1 == null || c.y1 < y - 1.2) continue;
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      const sx = Math.max(c.minX, Math.min(c.maxX, x)), sz = Math.max(c.minZ, Math.min(c.maxZ, z));
      const dx = x - sx, dz = z - sz, dd = dx * dx + dz * dz;
      if (dd > searchR2 || dd >= bestD) continue;
      bestD = dd; best = c;
      const wx = c.maxX - c.minX, wz = c.maxZ - c.minZ;
      // outward normal = the broad face nearest the impact
      if (wx >= wz) { bnz = (z - cz) < 0 ? -1 : 1; bnx = 0; bsz = bnz < 0 ? c.minZ - 0.04 : c.maxZ + 0.04; bsx = sx; }
      else { bnx = (x - cx) < 0 ? -1 : 1; bnz = 0; bsx = bnx < 0 ? c.minX - 0.04 : c.maxX + 0.04; bsz = sz; }
      bsy = Math.max(c.y0 + 0.4, Math.min(c.y1 - 0.4, y));
    }
    const onWall = !!best;
    // (2) concrete chunks blown outward from the wall (or all around if open air)
    CBZ.cityChunk(onWall ? bsx : x, onWall ? bsy : y, onWall ? bsz : z, {
      count: Math.round(3 + 3 * power), force: 4 + 2.5 * power,
      dirx: onWall ? bnx : null, dirz: onWall ? bnz : null,
      material: onWall && best.ref ? best.ref.material : null,
    });
    // (3) shatter every pane within the blast radius (cracked → blown out)
    CBZ.cityShatter(x, z, 4.0 + power * 2.2);
    // (4) ACCUMULATE a persistent wound on the struck wall — repeated hits/blasts
    // on the SAME wall escalate cracks → a real blown-open carve. We
    // already located the wall + its surface point + outward normal above, so
    // hand them straight to cityWoundWall (zero extra search).
    if (onWall && best && CBZ._cityWoundWallRec) CBZ._cityWoundWallRec(best, bsx, bsy, bsz, power, bnx, bnz);
    // (5) feedback
    if (CBZ.shake) CBZ.shake(Math.min(1.2, 0.3 + power * 0.3));
    return { x: onWall ? bsx : x, y: onWall ? bsy : y, z: onWall ? bsz : z, nx: bnx, nz: bnz, onWall };
  };

  // ---- ESCALATING WALL WOUNDS ----------------------------------------------
  // WHY: one rocket carves a wall open instantly, but a wall raked by rifle fire
  // or peppered with small blasts used to shrug it ALL off — nothing accumulated.
  // Now every hit on a wall builds a damage record on THAT collider: it cracks,
  // then (once enough damage piles on) the wall genuinely BLOWS OPEN into the
  // room behind it — the satisfying "keep hitting it and it gives" beat.
  // The decals are pooled+capped and the auto-carve routes through the fracture
  // ledger so it counts against the 24-hole budget and boards over like any breach.
  const wallDmg = new Map();   // wall collider -> { dmg, x,y,z (impact centroid), nx,nz }
  const WALLDMG_CAP = 40;
  let _crackGeo = null;
  function crackGeo() { return _crackGeo || (_crackGeo = new THREE.PlaneGeometry(0.3, 0.3)); }
  // a tiny dedicated CRACK-decal pool (kept apart from the bullet holes so cracks don't
  // thrash the bullet-hole LRU). Small cap — only a handful of wounded walls
  // ever show cracks at once before they auto-carve.
  const crackPool = []; let crackIdx = 0; const CRACK_CAP = 24;
  function placeCrack(px, py, pz, nx, nz, scale) {
    if (!CBZ.scene) return;
    let m;
    if (crackPool.length < CRACK_CAP) { m = new THREE.Mesh(crackGeo(), crackMat()); m.renderOrder = 3; CBZ.scene.add(m); crackPool.push(m); }
    else { m = crackPool[crackIdx]; crackIdx = (crackIdx + 1) % CRACK_CAP; m.visible = true; }
    m.position.set(px + nx * 0.025, py, pz + nz * 0.025); aimDecal(m, nx, 0, nz); m.rotateZ(Math.random() * Math.PI);
    const s = scale || 1.3; m.scale.set(s, s, s);
  }
  // INTERNAL: accumulate a wound on an ALREADY-LOCATED wall collider (cityDamage-
  // Building calls this — it found `best` for us). Tiers fire as the total climbs.
  CBZ._cityWoundWallRec = function (col, sx, sy, sz, power, nx, nz) {
    if (!col) return;
    let rec = wallDmg.get(col);
    if (!rec) {
      // cap the map — evict the least-damaged record so a long firefight can't
      // grow it unbounded (the evicted wall just loses its accumulator, not its
      // already-stamped decals).
      if (wallDmg.size >= WALLDMG_CAP) {
        let lo = null, loV = 1e9; for (const [k, v] of wallDmg) { if (v.dmg < loV) { loV = v.dmg; lo = k; } }
        if (lo) wallDmg.delete(lo);
      }
      rec = { dmg: 0, x: sx, y: sy, z: sz, nx: nx, nz: nz, t2: 0, n: 0 };
      wallDmg.set(col, rec);
    }
    // running impact centroid (so the auto-carve opens where the wall took the
    // most fire, not at the first stray round).
    rec.n++; const k = 1 / rec.n;
    rec.x += (sx - rec.x) * k; rec.y += (sy - rec.y) * k; rec.z += (sz - rec.z) * k;
    rec.nx = nx; rec.nz = nz;
    const before = rec.dmg; rec.dmg += power;
    // TIER 2 (>=1.6): 1-2 crack decals + a knock of chunks (each threshold-cross
    // adds one crack, capped at 2, so a pummelled wall visibly spiderwebs).
    if (rec.dmg >= 1.6 && before < rec.dmg && rec.t2 < 2 && Math.floor((rec.dmg - 1.6) / 0.6) >= rec.t2) {
      rec.t2++;
      placeCrack(sx + (Math.random() - 0.5) * 0.5, sy + (Math.random() - 0.5) * 0.5, sz, nx, nz, 1.2 + Math.random() * 0.5);
      CBZ.cityChunk(sx, sy, sz, { count: 2 + ((Math.random() * 2) | 0), force: 3, dirx: nx, dirz: nz, material: col.ref ? col.ref.material : null });
    }
    // TIER 3 (>=2.8): the wall finally GIVES — promote to a real walk-through
    // carve at the accumulated impact centroid, routed through the fracture
    // ledger (so it counts against the hole budget + boards over like a breach).
    if (rec.dmg >= 2.8) {
      wallDmg.delete(col);                                 // spent — it's a hole now
      const fr = CBZ.cityFracture;
      if (fr && fr.recent && fr.recent(rec.x, rec.z)) return;   // already opened here
      const r2 = carveHole(rec.x, rec.y, rec.z, 1.3, { search: 1.2 });
      if (r2) {
        if (fr && fr._adopt) fr._adopt(r2, 1.3);
        const g = r2.gap, gc = (g.u0 + g.u1) / 2;
        const rx = g.horiz ? gc : g.fixed, rz = g.horiz ? g.fixed : gc;
        CBZ.cityChunk(rx, (g.v0 + g.v1) / 2, rz, { count: 4 + ((Math.random() * 3) | 0), force: 5, dirx: -nx, dirz: -nz, material: r2.wall && r2.wall.material });
        if (CBZ.shake) CBZ.shake(0.5);
      }
    }
  };
  // PUBLIC: wound the nearest wall at (x,y,z) — same wall-selection as carveHole,
  // so callers that DON'T already have the collider (sustained gunfire impacts,
  // small grenade splashes) can feed the accumulator. Feature-detected by callers.
  CBZ.cityWoundWall = function (x, y, z, power, nx, nz) {
    if (!CBZ.scene || !CBZ.colliders) return;
    if (y == null) y = (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + 1.4;
    // reuse carveHole's nearest-opaque-wall selection (y-span contains hit,
    // height>=1.6, thin face, opaque material).
    let best = null, bestD = 1e9, sr2 = 6.25;   // 2.5m search
    for (let i = 0; i < CBZ.colliders.length; i++) {
      const c = CBZ.colliders[i];
      if (c.y1 == null || !c.ref) continue;
      if (y < c.y0 - 0.3 || y > c.y1 + 0.3) continue;
      if (c.y1 - c.y0 < 1.6) continue;
      if (Math.min(c.maxX - c.minX, c.maxZ - c.minZ) > 0.9) continue;
      const mt = c.ref.material; if (mt && mt.transparent) continue;
      const px = Math.max(c.minX, Math.min(c.maxX, x)), pz = Math.max(c.minZ, Math.min(c.maxZ, z));
      const dx = x - px, dz = z - pz, dd = dx * dx + dz * dz;
      if (dd > sr2 || dd >= bestD) continue;
      bestD = dd; best = c;
    }
    if (!best) return;
    // derive the outward normal + surface point if the caller didn't pass one
    let onx = nx, onz = nz, ssx = x, ssz = z;
    const c = best, cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    const wx = c.maxX - c.minX, wz = c.maxZ - c.minZ;
    const psx = Math.max(c.minX, Math.min(c.maxX, x)), psz = Math.max(c.minZ, Math.min(c.maxZ, z));
    if (nx == null || nz == null) {
      if (wx >= wz) { onz = (z - cz) < 0 ? -1 : 1; onx = 0; ssz = onz < 0 ? c.minZ - 0.04 : c.maxZ + 0.04; ssx = psx; }
      else { onx = (x - cx) < 0 ? -1 : 1; onz = 0; ssx = onx < 0 ? c.minX - 0.04 : c.maxX + 0.04; ssz = psz; }
    } else {
      if (onx !== 0) ssx = onx < 0 ? c.minX - 0.04 : c.maxX + 0.04; else ssx = psx;
      if (onz !== 0) ssz = onz < 0 ? c.minZ - 0.04 : c.maxZ + 0.04; else ssz = psz;
    }
    const ssy = Math.max(c.y0 + 0.4, Math.min(c.y1 - 0.4, y));
    CBZ._cityWoundWallRec(best, ssx, ssy, ssz, power || 0.4, onx, onz);
  };

  CBZ.cityDamageReset = function () {
    if (CBZ.bulletHolesReset) CBZ.bulletHolesReset();
    if (crackPool) { for (const m of crackPool) m.visible = false; crackIdx = 0; }
    if (wallDmg) wallDmg.clear();   // wipe the accumulated wall-wound records
    resetBreaches();
  };

  // ---- RPG WALL BREACHES -------------------------------------------------
  // A direct rocket / heavy blast against a GROUND-FLOOR wall blasts a real,
  // WALKABLE hole through it — "like a car smashing through". With no CSG / no
  // BufferGeometryUtils in r128 we fake the boolean the same proven way the
  // DOOR system does: hide the solid wall, drop its collider from the broadphase
  // (markCollidersDirty), and rebuild the SURVIVING flanks as two thin remnant
  // boxes (each with its own height-gated collider) so only the GAP is passable.
  // A dark scorched backing quad makes the interior read through the hole, with
  // rubble blown inward + nearby panes burst. Every created mesh/collider is
  // tracked so a new run fully undoes the breach (wall restored, flanks removed).
  const cityBreaches = [];   // [{wall, col, remnCols:[], extras:[], wallWasLos}]
  function resetBreaches() {
    if (!cityBreaches.length) return;
    let dirty = false;
    // REVERSE: a hole carved into another hole's remnant must restore first,
    // so the outer record then owns deleting that remnant — never re-adding a
    // disposed mesh/collider to the live sets.
    for (let bi = cityBreaches.length - 1; bi >= 0; bi--) {
      const b = cityBreaches[bi];
      // remove the dressing meshes (remnant flanks, backing quad, etc.)
      for (const m of b.extras) {
        if (m.parent) m.parent.remove(m); else CBZ.scene.remove(m);
        if (m.geometry) m.geometry.dispose();
        if (CBZ.losBlockers) { const li = CBZ.losBlockers.indexOf(m); if (li >= 0) CBZ.losBlockers.splice(li, 1); }   // drop any remnant LOS ref
      }
      // pull every remnant collider back out of the broadphase
      for (const rc of b.remnCols) { const i = CBZ.colliders.indexOf(rc); if (i >= 0) { CBZ.colliders.splice(i, 1); dirty = true; } }
      // put the OPENING back: colliders lifted out of the hole return, clipped
      // ones get their original extents, hidden neighbours are drawn again.
      // (See "CLEAR THE OPENING" in carveHole — without this a new run would
      // inherit a facade quietly missing its sill run and its mullions.)
      if (b.clearedCols) for (const cc of b.clearedCols) { if (CBZ.colliders.indexOf(cc) === -1) { CBZ.colliders.push(cc); dirty = true; } }
      if (b.clippedCols) for (const q of b.clippedCols) { q.c.minX = q.minX; q.c.maxX = q.maxX; q.c.minZ = q.minZ; q.c.maxZ = q.maxZ; dirty = true; }
      // the hole's own debris (welded rim + what it threw) goes with it
      if (b.debrisKey && CBZ.debris) CBZ.debris.clear(b.debrisKey);
      if (b.hidRefs) for (const hr of b.hidRefs) hr.visible = true;
      // restore the original wall mesh + its collider. A BATCH-V2 merged wall
      // renders through its slice in the merged shell — restore the slice and
      // keep the original invisible (visible=true would double-draw it).
      if (b.wall) {
        if (!(CBZ.batchWallShow && CBZ.batchWallShow(b.wall))) b.wall.visible = true;
        b.wall._breached = false;
        if (CBZ.losBlockers && b.wallWasLos && CBZ.losBlockers.indexOf(b.wall) === -1) CBZ.losBlockers.push(b.wall);
      }
      if (b.col && CBZ.colliders.indexOf(b.col) === -1) { CBZ.colliders.push(b.col); dirty = true; }
    }
    cityBreaches.length = 0;
    winOpenings.length = 0;   // the recs above owned these openings; clear with them
    if (dirty && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (CBZ.cityFracture && CBZ.cityFracture._cleared) CBZ.cityFracture._cleared();   // wipe the hole ledger with the walls
  }

  // ---- GENERALIZED WALL CARVE (any height) -------------------------------
  // The ground-floor breach grown up: walls are one solid box PER STOREY PER
  // FACE, so carving at any height just means picking the wall collider whose
  // y-span CONTAINS the hit instead of gating to the street. The opening gets
  // full-height flanks + partial-height SILL/HEADER remnants — CBZ.collide's
  // y-gating makes a chest-high murder hole shoot-through but not walk-through,
  // while a floor-level hole drops its sill and reads as a blasted doorway.
  // Dressing per hole: see WHAT IS BEHIND THE HOLE inside carveHole.
  // city/fracture.js drives this primitive and owns ledger/caps/persistence.
  let holeDebrisSeq = 0;
  let _insetMat = null, _plyMat = null, _plyBatMat = null, _sootMat = null;
  let _roomFloorMat = null, _rebarMat = null, _warmLightMat = null;
  // Every surface behind a hole is LIT BY THE SCENE (Lambert). A window's
  // empty unit carries a low emissive fill — the building's own interior
  // light — so it reads as a room by day and a dim one at night; a blast
  // pocket carries none, because a charred hole is dark.
  function lit(color, fill, side) {
    const m = new THREE.MeshLambertMaterial({ color: color, side: side || THREE.FrontSide });
    if (fill > 0) m.emissive = new THREE.Color(color).multiplyScalar(fill);
    return m;
  }
  function insetMat() { return _insetMat || (_insetMat = lit(0xbcb4a4, 0.28, THREE.BackSide)); }   // an empty unit's walls/ceiling
  function roomFloorMat() { return _roomFloorMat || (_roomFloorMat = lit(0xbfc3ca, 0.22)); }
  function sootMat() { return _sootMat || (_sootMat = lit(0x2e2a26, 0, THREE.BackSide)); }        // a blast pocket: charred, unlit by itself
  function warmLightMat() { return _warmLightMat || (_warmLightMat = new THREE.MeshBasicMaterial({ color: 0xffe9c2 })); }   // a real ceiling fixture
  function rebarMat() { return _rebarMat || (_rebarMat = lit(0x41434a, 0)); }
  function plyMat() { return _plyMat || (_plyMat = new THREE.MeshLambertMaterial({ color: 0x9a7b4f })); }
  function plyBatMat() { return _plyBatMat || (_plyBatMat = new THREE.MeshLambertMaterial({ color: 0x6f5636 })); }

  /* ---- WHAT COUNTS AS A CARVABLE WALL -------------------------------------
     MEASURED 2026-08-06, escape mode, seed 90210: of 240 live prison
     colliders, 214 carry a mesh, 45 carry a y0/y1 band, 8 of those are >=1.6 m
     tall and **ZERO** survived the thickness test. Not one prison wall was
     carvable — a forced carve on the biggest wall in the block returned
     "REFUSED (no eligible wall collider)". Yet 73 prison colliders are
     wall-SHAPED by geometry (>=1.6 m tall measured off the mesh, <=0.9 m thin,
     opaque), and ZERO of those 73 declare a band.

     The reason is one line in world/materials.js: CBZ.addBox pushes
     {minX,maxX,minZ,maxZ,ref} and only attaches y0/y1 when the caller asks.
     The prison was built before that contract existed, so its walls are real
     walls with real meshes that simply never said how tall they are — and the
     filter's FIRST test is `c.y1 == null`. The mode gate on blastAt was never
     what stopped the prison being breachable; this was.

     So derive the band the same way systems/physics.js:338 already does for
     the vault probe — from the registered mesh's own bounds. Reading a solid's
     visual height is not inventing geometry, it is asking the thing that is
     already there. A collider with no mesh stays non-carvable, as before. */
  const carveBounds = window.THREE && THREE.Box3 ? new THREE.Box3() : null;
  const carveBand = { y0: 0, y1: 0, derived: false };
  /* The LONG horizontal axis a band-less collider must span to count as a WALL
     rather than a post (see the eligibility loop in carveHole). Deliberately
     the plain "how wide is it" test and NOT an aspect ratio: a ratio veto
     rejected the 1.4 m-thick × 2.5 m heavy wall that tools/breach-check.mjs
     opens with the heavy explosive rows (2.5/1.4 = 1.79), which is a real wall
     and must still open. Every band-less thing in the city that is ALSO thin
     enough to reach this test is street furniture spanning ≤ 0.84 m (the
     widest is a barrel), so 1.2 m clears the largest offender by 43% while
     sitting well under the 2.5 m the probe itself uses to recognise a wall.
     City facades never reach this test at all — they declare y0/y1. */
  const POST_SPAN = (CBZ.blastLaw && CBZ.blastLaw.PROP_SPAN) || 1.2;
  // The shell a wall/course belongs to — one hop through the mesh's parent
  // group (makeBuilding stamps userData.bld). Null for scene-level props, the
  // prison's world root, and anything not raised by makeBuilding.
  function shellOf(c) {
    const p = c && c.ref && c.ref.parent;
    return (p && p.userData && p.userData.bld) || null;
  }
  function wallBandOf(c) {
    if (c.y0 != null && c.y1 != null && isFinite(c.y0) && isFinite(c.y1)) return c;   // zero-alloc hot path
    if (!c.ref || c.ref.visible === false || !carveBounds) return null;
    try {
      carveBounds.setFromObject(c.ref);
      if ((carveBounds.isEmpty && carveBounds.isEmpty()) ||
          !isFinite(carveBounds.min.y) || !isFinite(carveBounds.max.y)) return null;
      carveBand.y0 = carveBounds.min.y; carveBand.y1 = carveBounds.max.y;
      carveBand.derived = true;
      return carveBand;
    } catch (e) { return null; }
  }

  // WHAT THE LAST CARVE ACTUALLY DID. The owner's "the response is fake, you
  // can't walk through it" was two separate faults stacked (a surviving sill
  // course, and neighbours left solid inside the opening) and NEITHER was
  // visible from outside the function — every number below was reconstructed
  // by a probe walking a body at the hole. Publishing them turns the next
  // "the hole doesn't work" into one call instead of another probe round.
  const carveDbg = {};
  // `live` = how many carves are on the books right now. tools/prop-blast-check
  // reads it across a detonation to prove a blast against a lamp post opens
  // NOTHING — the count is the only way to tell "refused" from "carved
  // something else nearby" without walking the scene graph.
  CBZ.cityBreachAudit = function () { return Object.assign({ live: cityBreaches.length }, carveDbg); };

  function carveHole(x, y, z, r, opts) {
    opts = opts || {};
    r = r || 1.2;
    if (!CBZ.scene || !CBZ.colliders) return null;
    carveDbg.calls = (carveDbg.calls || 0) + 1;
    carveDbg.at = [Math.round(x), +(+y).toFixed(2), Math.round(z)];
    carveDbg.r = r; carveDbg.result = "searching";
    // A CHARGE lets the law price the wall (systems/breach.js): any thickness
    // is a candidate and the breaching radius decides. Without one (a ram, a
    // structural failure, a window) a single event never opens a pier.
    const charge = opts.charge && opts.charge.W > 0 && CBZ.blastLaw ? opts.charge : null;
    const maxThick = opts.maxThick > 0 ? opts.maxThick : (charge ? 3.0 : 0.9);
    carveDbg.maxThick = maxThick;
    carveDbg.law = null;
    // --- nearest WALL box whose y-span contains the hit ---
    const sr = opts.search != null ? opts.search : 2.6, sr2 = sr * sr;
    let best = null, bestD = 1e9, bestY0 = 0, bestY1 = 0, bestSy0 = 0, bestSy1 = 0;
    for (let i = 0; i < CBZ.colliders.length; i++) {
      const c = CBZ.colliders[i];
      if (!c.ref) continue;                                 // no mesh: nothing to hide or remnant
      // THE PERIMETER HOLDS. A wall the world declares un-breachable is not a
      // candidate at any radius — see world/yard.js. The blast still scars,
      // shakes and throws debris there; it just does not open.
      if (c.noBreach) continue;
      // DISTANCE FIRST. This loop walks every collider in the city (~142k);
      // wallBandOf below runs a Box3.setFromObject mesh traversal for each
      // band-less one (every lamp, hydrant, bollard, tree trunk on the map),
      // which made a single window carve cost tens of ms. Out-of-reach boxes
      // are dropped by the same `dd > sr2` test that ends the loop body, so
      // the chosen wall (and its array-order tie-break) is unchanged.
      { const qx = Math.max(c.minX, Math.min(c.maxX, x)) - x, qz = Math.max(c.minZ, Math.min(c.maxZ, z)) - z;
        if (qx * qx + qz * qz > sr2) continue; }
      const band = wallBandOf(c);
      if (!band) continue;                                  // heightless AND no readable mesh
      const cy0 = band.y0, cy1 = band.y1;
      // A full-height wall box must CONTAIN the hit. A curtain-wall COURSE is
      // height-tested against its STOREY instead, three lines down — a sill
      // never contains a hit aimed at the glass above it.
      if (cy1 - cy0 >= 1.6 && (y < cy0 - 0.3 || y > cy1 + 0.3)) continue;
      /* A CURTAIN WALL IS AN ASSEMBLY, NOT A BOX (owner-filmed 2026-08-27:
         "buildings don't look real when hit by an explosion" — MEASURED, a
         direct MIM-104/missile row hit, power 3.0 radius 16, on an 8-storey
         glass office left the facade WITHOUT A SCRATCH).

         Here is the arithmetic of why. A city office storey's street face is
         built (see the CLEAN CURTAIN-WALL FACADE block) out of exactly four
         solid boxes plus a pane grid:
             sill course   full width x 0.55 m   <- shorter than 1.6, rejected
             header course full width x 0.45 m   <- shorter than 1.6, rejected
             two end jambs 0.55 m x ~3.1 m       <- tall, but at the far CORNERS
             the glazing    transparent          <- rejected two lines down
         So at a hit in the middle of the face there was NOTHING ELIGIBLE, at
         any power. carveHole returned "no eligible wall", cityDamageBuilding's
         tier-3 promotion carved nothing, and the whole ordnance table — RPG,
         missile, airstrike, C4 — could only ever break glass on the most
         common building type in the game.

         The 1.6 m rule is still right about what it was written for (window
         sills, counters, plinths: things that are a LEDGE, not a wall). What it
         got wrong is that a facade course is neither — it is one lamination of
         a wall whose real structural unit is the STOREY. So a short box that is
         a course OF A REAL SHELL is admitted, and the storey band it belongs to
         (from that shell's own floor grid) is carried down to the opening: the
         hole then runs floor-to-ceiling like a blown-open bay instead of being
         clamped into a 0.55 m letterbox. Remnants stay clamped to the struck
         COURSE, so the sill still survives left and right of the hole.
*/
      let cSy0 = 0, cSy1 = 0;                               // storey band, curtain courses only
      if (cy1 - cy0 < 1.6) {
        const shell = shellOf(c);
        if (!shell) continue;                               // not a course of anything
        // a course SPANS (same principle as A POST IS NOT A WALL below)
        if (Math.max(c.maxX - c.minX, c.maxZ - c.minZ) < 2.5) continue;
        const sFH = shell.FH > 0 ? shell.FH : 4.1;
        const k = Math.max(0, Math.min((shell.storeys | 0) - 1, Math.floor(((cy0 + cy1) / 2) / sFH)));
        cSy0 = k * sFH; cSy1 = Math.min(shell.h || (k + 1) * sFH, (k + 1) * sFH);
        if (cSy1 - cSy0 < 1.6) continue;                    // degenerate grid: leave it alone
        if (y < cSy0 - 0.3 || y > cSy1 + 0.3) continue;      // the STOREY must contain the hit
      }
      // THICKNESS IS A PRICE, NOT A VETO. 0.9 m is right for ONE hit — a
      // single rocket should not open a structural pier. But a wall that has
      // absorbed enough explosive should go, which is the owner's "the parts
      // that fake blow up, with enough C4 actually blowing up". systems/
      // breach.js raises this ceiling as its ledger crosses the heavier rows,
      // so a thick wall opens when the POUNDS say it does. Default unchanged.
      if (Math.min(c.maxX - c.minX, c.maxZ - c.minZ) > maxThick) continue;   // thick = counters/plinths, skip
      /* A POST IS NOT A WALL (owner-filmed: an RPG into a STREET LAMP).
         Every street prop in the city — lamp masts, sign poles, hydrants,
         bollards, parking meters, tree trunks — registers through props.js
         solidCollider(x, z, r, ref), which pushes a SQUARE footprint box and
         no y-band. The band therefore comes from `derived` above, off the
         mesh, and a 5.6 m lamp mast on a 0.34 m box clears BOTH gates: taller
         than 1.6, thinner than 0.9. So the rocket picked the lamp as its
         "wall", hid the mast, and — because a lamp's parent group is
         translated to the kerb, which is exactly what `freeStanding` reads as
         "there is a building behind this" — dressed the full interior room
         over the sidewalk: an ~8 m unlit-white pocket liner, a glowing
         ceiling slab, furniture silhouettes, and a ~57-piece rubble heap on
         the grass. None of it existed; it was a lamp.
         A wall is a RUN: it spans. A footprint under POST_SPAN in BOTH
         horizontal axes is a post, and the file already refuses to open piers.
         Gated to DERIVED bands only, so every first-class wall collider (which
         declares y0/y1) keeps its exact old eligibility — including the
         measured 0.6 m facade segments — while the prison's 5.5 m band-less
         wall boxes and the heavy-explosive test wall still pass. The blast
         still scars, shakes, shatters glass and throws its debris at a post;
         it just no longer remodels one into an apartment. */
      if (CBZ.blastLaw ? CBZ.blastLaw.isProp(c, !band.derived) : (band.derived && Math.max(c.maxX - c.minX, c.maxZ - c.minZ) < POST_SPAN)) continue;
      const mt = c.ref.material; if (mt && mt.transparent) continue;    // glass/doors keep their own systems
      const sx = Math.max(c.minX, Math.min(c.maxX, x)), sz = Math.max(c.minZ, Math.min(c.maxZ, z));
      const dx = x - sx, dz = z - sz, dd = dx * dx + dz * dz;
      if (dd > sr2 || dd >= bestD) continue;
      bestD = dd; best = c; bestY0 = cy0; bestY1 = cy1;
      bestSy0 = cSy0; bestSy1 = cSy1;      // 0/0 for an ordinary full-height wall
    }
    const wall = best && best.ref;
    if (!wall) { carveDbg.result = "no eligible wall"; return null; }
    if (wall._breached) { carveDbg.result = "already breached"; return null; }
    /* ---- THE CHARGE LAW DECIDES (systems/breach.js) -----------------------
       The wall is known now: its thickness, what it is made of, and how far
       the charge sat off it. Ask the law. A wall that holds keeps what it
       took (the bank) and sheds a few chips off its face; a wall that breaches
       opens exactly ~2 R_b across — an RPG ~0.7 m, a tank round ~1.5 m, a
       bomb several metres — never a room-sized constant. */
    let lawHole = null;
    if (charge) {
      const L = CBZ.blastLaw;
      const bThick = Math.min(best.maxX - best.minX, best.maxZ - best.minZ);
      const bShell = shellOf(best);
      const hint = bShell ? bShell.facade : null;
      const standoff = charge.contact ? 0 : Math.max(Math.sqrt(bestD), charge.standoff || 0);
      const prior = CBZ.breachBanked ? CBZ.breachBanked(x, y, z) : 0;
      lawHole = L.hole(charge.W, { thick: bThick, hint: hint, standoff: standoff,
        shaped: !!charge.shaped, jetPen: charge.jetPen || 0, banked: prior });
      if (CBZ.breachBank) CBZ.breachBank(x, y, z, lawHole.Weff);
      carveDbg.law = { W: +charge.W.toFixed(3), thick: +bThick.toFixed(2), k: lawHole.k, standoff: +standoff.toFixed(2),
        Rb: +lawHole.Rb.toFixed(3), r: +lawHole.r.toFixed(3), jet: lawHole.jet, banked: +(prior + lawHole.Weff).toFixed(3) };
      if (!lawHole.breach) {
        carveDbg.result = "held";
        // the face still loses its skin: chips of THIS wall, thrown back at the charge
        const bhz = (best.maxX - best.minX) >= (best.maxZ - best.minZ);
        const bfix = bhz ? (best.minZ + best.maxZ) / 2 : (best.minX + best.maxX) / 2;
        const side = ((bhz ? z : x) - bfix) >= 0 ? 1 : -1;
        const fx = bhz ? Math.max(best.minX, Math.min(best.maxX, x)) : bfix + side * bThick / 2;
        const fz = bhz ? bfix + side * bThick / 2 : Math.max(best.minZ, Math.min(best.maxZ, z));
        CBZ.cityChunk(fx, Math.max(bestY0 + 0.2, Math.min(bestY1 - 0.2, y)), fz, {
          count: Math.max(1, Math.round(1 + 4 * lawHole.scarR)), force: 3 + 4 * lawHole.scarR,
          dirx: bhz ? 0 : side, dirz: bhz ? side : 0, material: wall.material,
        });
        return null;
      }
      r = lawHole.r;
    }
    wall._breached = true;
    carveDbg.result = "carved";
    carveDbg.band = [+bestY0.toFixed(2), +bestY1.toFixed(2)];

    const c = best;
    const parent = wall.parent;                             // the building group (its position offsets locals)
    const px = parent ? parent.position.x : 0, pz = parent ? parent.position.z : 0;
    // FREE-STANDING vs FACADE. A city building group is TRANSLATED to its lot
    // (bgroup.position.set(ox,0,oz), ~line 2279) — that offset is what "there
    // is a building volume behind this wall" looks like in the scenegraph. A
    // wall hanging off an identity-positioned parent (the scene itself, the
    // prison-world root, Gun Game's worldRoot, scene-level props) is a lone
    // slab in the open: nothing behind it. Three decisions below change on
    // that fact — the gap width, the outward side, and whether the hole gets
    // an interior dress at all.
    const freeStanding = !parent || parent === CBZ.scene ||
      (Math.abs(parent.position.x) < 1e-6 && Math.abs(parent.position.z) < 1e-6);
    carveDbg.freeStanding = freeStanding;
    const horiz = (c.maxX - c.minX) >= (c.maxZ - c.minZ);   // wall runs along X if wider in X
    const minU = horiz ? c.minX : c.minZ, maxU = horiz ? c.maxX : c.maxZ;   // wall extent (world) along its axis
    const len = maxU - minU;
    const thick = horiz ? (c.maxZ - c.minZ) : (c.maxX - c.minX);
    const fixed = horiz ? (c.minZ + c.maxZ) / 2 : (c.minX + c.maxX) / 2;    // world coord on the off-axis
    // the band the search settled on — DECLARED (city walls) or DERIVED off the
    // mesh (the prison's, which predate the y0/y1 contract). Every remnant below
    // is built against it, so a carved prison wall leaves properly height-gated
    // flanks/sill/header where the original collider was full-height.
    const y0 = bestY0, y1 = bestY1;
    // A curtain-wall COURSE carries the storey band it is one lamination of.
    const sy0 = bestSy0, sy1 = bestSy1, curtain = sy1 > sy0;
    const hit = horiz ? x : z;                              // where the blast struck along the wall axis
    // gap = the opening centred on the hit, clamped within the wall, sized to the blast
    // (opts.gapW overrides for callers that know the exact opening — window frames)
    /* THE HOLE IS THE SIZE OF THE ORDNANCE, NOT OF ONE BOX.
       MEASURED, city lot (-130,-778): an RPG (r = 3.94, which fracture.js
       floors deliberately so the wound reads as "a blown-open apartment") cut
       a gap of **0.50 m**. Both clamps below did it — `len * 0.8` and then
       `Math.max(minU, …)` — because a city facade is not one wall, it is a run
       of SHORT segments, and the one the rocket struck was 0.6 m long. A body
       is 1.1 m across. That is the whole of the owner's "you can't actually
       walk through it": the fireball, the lit room, the fractured rim and the
       debris all fire, and the passage is a half-metre slit.
       (The prison never showed it because its walls are single 5.5 m boxes.)
       So the span comes from the blast, and the neighbouring segments inside
       it are cleared below. This can only ever WIDEN an existing carve — the
       old value is kept as a floor — and a window opening, which passes an
       explicit gapW, is untouched. */
    const ordnanceW = Math.min(opts.gapW != null ? opts.gapW : r * 2, 9);
    /* The ordnance floor below exists because a city facade is a RUN of short
       segments (the measured 0.50 m slit above) — the gap must span the struck
       box's neighbours, which the opening sweep then clears. A free-standing
       wall IS the whole wall: letting ordnanceW bypass the len clamp there
       swallows the entire box — both flanks come out negative-width and are
       skipped — so the wall vanishes and only the dress would remain standing.
       The bypass is facade-only; a lone slab keeps its flanks. */
    const gapW = freeStanding
      ? Math.max(0.5, Math.min(len * 0.8, ordnanceW))
      : Math.max(0.5, Math.min(len * 0.8, opts.gapW != null ? opts.gapW : r * 2), ordnanceW);
    let u0 = hit - gapW / 2, u1 = hit + gapW / 2;
    if (u1 - u0 < 0.4) { u0 = (minU + maxU) / 2 - gapW / 2; u1 = (minU + maxU) / 2 + gapW / 2; }
    // the STRUCK box's own surviving extent (its remnants can never be wider
    // than the box they came from — the neighbours own their own geometry)
    const su0 = Math.max(minU, u0), su1 = Math.min(maxU, u1);
    // vertical opening, clamped to the storey box. A bottom near the floor
    // drops the SILL entirely (a blasted doorway); a top near the slab keeps
    // no header. Anything between leaves real partial-height remnants.
    /* THE OPENING'S CEILING IS THE STOREY, NOT THE COURSE. For a full-height
       wall box these are the same two numbers. For a curtain-wall course they
       are not: clamping the hole to the 0.55 m sill the rocket happened to
       strike is how a blown-open bay becomes a letterbox. The REMNANTS below
       stay clamped to y0/y1 (the course's own extent), so the sill still runs
       left and right of the hole and no phantom full-storey slab is minted. */
    const vy0 = curtain ? sy0 : y0, vy1 = curtain ? sy1 : y1;
    const yc = Math.max(vy0 + 0.3, Math.min(vy1 - 0.3, y));
    let v0 = Math.max(vy0, yc - r), v1 = Math.min(vy1, yc + r);
    // explicit vertical rect (window openings keep their sill + header exactly)
    if (opts.v0 != null) v0 = Math.max(vy0, opts.v0);
    if (opts.v1 != null) v1 = Math.min(vy1, opts.v1);
    // A law-sized hole keeps the size the law gave it (an RPG's 0.7 m wound is
    // not a doorway); only a WALKABLE breach reaches the floor and the slab.
    const walkOpen = !lawHole || lawHole.walkable;
    const minH = lawHole ? Math.max(0.4, 2 * r) : 1.0;
    if (v1 - v0 < minH) { const vm = (v0 + v1) / 2; v0 = Math.max(vy0, vm - minH / 2); v1 = Math.min(vy1, vm + minH / 2); }
    if (walkOpen && v0 - vy0 < 0.55) v0 = vy0;      // no ankle lip — clean walk-through bottom
    if (walkOpen && vy1 - v1 < 0.35) v1 = vy1;
    /* THE ANKLE LIP ACROSS A STACKED FACADE. The line above has always meant
       "a breach near the bottom should reach the floor", but it measures
       against THIS BOX's own y0 — and a city facade is a stack of courses, so
       the box the rocket struck starts 0.55 m up with a separate SILL course
       beneath it. Result, measured on lot (-130,-778): the opening's bottom
       sat at 0.55 m and the sill run survived as a kerb across the doorway —
       and STEP_UP is 0.45, so the player could not step over it. A drawn hole
       you cannot walk through is the owner's "fake response".
       So walk DOWN the courses that sit directly under the opening in this same
       wall plane and take the opening to the real floor. Bounded hard: at most
       four courses and 1.4 m, and only courses whose TOP is the current bottom
       — a breach two storeys up finds nothing under it and is unchanged. */
    const v0Lip = v0;
    if (walkOpen && v0 > 0.02) {
      let openBottom = v0;
      for (let pass = 0; pass < 4; pass++) {
        let stepTo = null;
        for (let i = 0; i < CBZ.colliders.length; i++) {
          const o = CBZ.colliders[i];
          if (o === c || !o || !o.ref || o.y0 == null || o.y1 == null || o.noBreach) continue;
          const oF = horiz ? (o.minZ + o.maxZ) / 2 : (o.minX + o.maxX) / 2;
          if (Math.abs(oF - fixed) > thick / 2 + 0.35) continue;      // in this wall, not behind it
          const oU0 = horiz ? o.minX : o.minZ, oU1 = horiz ? o.maxX : o.maxZ;
          if (oU1 <= u0 + 0.02 || oU0 >= u1 - 0.02) continue;         // not under the opening
          if (Math.abs(o.y1 - openBottom) > 0.06) continue;           // its TOP is our bottom
          if (stepTo == null || o.y0 < stepTo) stepTo = o.y0;
        }
        if (stepTo == null || openBottom - stepTo < 0.02) break;
        openBottom = stepTo;
        if (v0 - openBottom > 1.4) break;                             // that is a storey, not a lip
      }
      if (openBottom < v0 - 0.02 && v0 - openBottom <= 1.4) v0 = openBottom;
      carveDbg.lipFrom = v0Lip; carveDbg.lipTo = v0;
    }
    // OUTWARD side: from the building centre when we have one (stable across
    // replays), else from the side the hit came from (scene-level props).
    // The centre-offset trick only means "outward" when the parent is a
    // building group positioned at its lot. A scene parent sits at (0,0,0),
    // so cOff is just the wall's world coordinate — its sign says which side
    // of the MAP ORIGIN the wall is on, not which way is out — and the dress
    // and rim extruded on the wrong side for most of the prison.
    const cOff = horiz ? fixed - pz : fixed - px;
    let outS;
    if (!freeStanding && Math.abs(cOff) > 0.6) outS = cOff >= 0 ? 1 : -1;
    else { const off = horiz ? (z - fixed) : (x - fixed); outS = off >= 0 ? 1 : -1; }

    const wmat = wall.material;
    const rec = { wall, col: c, remnCols: [], extras: [], wallWasLos: false, curtain: curtain,
      lawR: lawHole ? lawHole.r : 0, rect: !!opts.storey,
      gap: { horiz, fixed, thick, u0, u1, v0, v1, y0, y1, px, pz, outS, parent, minU, maxU } };

    // hide the solid wall mesh + remove it from LOS (cops can see/shoot through).
    // BATCH-V2 merged this wall's verts into the building shell — zero just its
    // slice there too (visible=false only silences the already-hidden original).
    wall.visible = false;
    if (CBZ.batchWallHide) CBZ.batchWallHide(wall);
    if (CBZ.losBlockers) { const li = CBZ.losBlockers.indexOf(wall); if (li >= 0) { CBZ.losBlockers.splice(li, 1); rec.wallWasLos = true; } }

    // --- SURVIVING REMNANTS: full-height flanks either side of the gap plus
    //     partial-height sill/header boxes across it (parented to the building
    //     group — local coords subtract the parent position). Each gets its own
    //     height-gated collider; slivers are skipped. ---
    function addRemnant(a, b, ry0, ry1) {
      const fw = b - a; if (fw < 0.3) return;
      if (ry0 == null) ry0 = y0; if (ry1 == null) ry1 = y1;
      const rh = ry1 - ry0; if (rh < 0.18) return;
      const ucen = (a + b) / 2, ymid = (ry0 + ry1) / 2;
      const wx = horiz ? ucen : fixed, wz = horiz ? fixed : ucen;
      const bw = horiz ? fw : thick, bd = horiz ? thick : fw;
      const g = new THREE.BoxGeometry(bw, rh, bd);
      // the wall material carries vertexColors (fake-AO walls) — the remnant
      // geometry needs the colour attribute too or it samples black
      if (wmat && wmat.vertexColors) shadeGeo(g, ry0 <= 0.2);
      const m = new THREE.Mesh(g, wmat);
      // parent-local position = world minus parent offset (parent has y=0 offset)
      m.position.set(wx - px, ymid, wz - pz);
      m.castShadow = true; m.receiveShadow = true;
      if (parent) parent.add(m); else CBZ.scene.add(m);
      rec.extras.push(m);
      const col = { minX: wx - bw / 2, maxX: wx + bw / 2, minZ: wz - bd / 2, maxZ: wz + bd / 2, ref: m, y0: ry0, y1: ry1 };
      CBZ.colliderAdd(col); rec.remnCols.push(col);
      if (rec.wallWasLos && CBZ.losBlockers) CBZ.losBlockers.push(m);
    }
    /* The neighbour form of addRemnant: hide a course that runs past the
       opening and rebuild the surviving run(s) from its OWN band, material and
       parent. Kept separate from addRemnant because that one is bound to the
       struck box's thickness/plane/material — a neighbour may be a different
       course entirely (a 0.45 m header where the rocket struck the sill). */
    let coursesCut = 0;
    function cutCourseMesh(o, oU0, oU1, keepL, keepR) {
      if (coursesCut >= 8) return;
      const src = o.ref;
      if (!src || src.visible === false || !src.material || !src.parent) return;
      if (o.y0 == null || o.y1 == null || o.y1 - o.y0 < 0.08) return;
      // Never cut a mesh that another live collider still depends on — the
      // same shared-ref test the wholly-inside branch makes before hiding.
      for (let k = 0; k < CBZ.colliders.length; k++) {
        if (CBZ.colliders[k] !== o && CBZ.colliders[k].ref === src) return;
      }
      const par = src.parent, ppx = par.position.x, ppz = par.position.z;
      const oFix = horiz ? (o.minZ + o.maxZ) / 2 : (o.minX + o.maxX) / 2;
      const oThk = Math.max(0.06, horiz ? (o.maxZ - o.minZ) : (o.maxX - o.minX));
      const rh = o.y1 - o.y0, ymid = (o.y0 + o.y1) / 2;
      const piece = function (a, b) {
        const fw = b - a; if (fw < 0.12) return;
        const ucen = (a + b) / 2;
        const wx = horiz ? ucen : oFix, wz = horiz ? oFix : ucen;
        const bw = horiz ? fw : oThk, bd = horiz ? oThk : fw;
        const g = new THREE.BoxGeometry(bw, rh, bd);
        if (src.material.vertexColors) shadeGeo(g, o.y0 <= 0.2);
        const m = new THREE.Mesh(g, src.material);
        m.position.set(wx - ppx, ymid, wz - ppz);
        m.castShadow = true; m.receiveShadow = true;
        par.add(m); rec.extras.push(m);
      };
      if (keepL) piece(oU0, u0);
      if (keepR) piece(u1, oU1);
      src.visible = false; rec.hidRefs.push(src);
      coursesCut++;
    }

    // Remnants belong to the STRUCK box, so they are clamped to its own extent
    // (su0/su1). With an ordnance-sized gap the opening routinely runs past
    // both ends of that box; the flanks then come out negative-width and
    // addRemnant skips them, which is correct — there is nothing of THIS box
    // left on that side. The neighbours the gap now covers are handled by the
    // opening sweep further down, each against its own geometry.
    addRemnant(minU, su0);                        // left flank
    addRemnant(su1, maxU);                        // right flank
    addRemnant(su0 - 0.01, su1 + 0.01, y0, v0);   // sill below the opening
    addRemnant(su0 - 0.01, su1 + 0.01, v1, y1);   // header above it

    // OPEN THE COLLIDER: splice the original wall AABB out + rebuild broadphase
    CBZ.colliderRemove(c);

    /* ---- CLEAR THE OPENING ------------------------------------------------
       OWNER, 2026-08-06: "you can shoot a window and walk through it, but if
       you shoot a building with an RPG the response is fake — you can't
       actually walk through it."  He is right, and this is why.

       Everything above removes exactly ONE collider: the wall box the search
       struck. A city facade is not one box, it is a STACK — measured on lot
       (-130,-778), the rocket struck the storey infill band (y 0.55..2.75,
       0.4 thin) and left standing, inside the hole it had just drawn:
         y 0..0.55   28 m long  <- the SILL run under the whole facade
         y 0.55..2.75 0.55 deep <- a pier stub in the opening
         y 0.55..2.75 0.07 thin <- a mullion across it
       Three of those four had `visible === false` already. So the player got a
       drawn hole, a lit room behind it, a fractured rim — and an INVISIBLE
       FORCE FIELD in the doorway, plus a 0.55 m sill lip that STEP_UP (0.45)
       refuses to climb. A walk from 2.5 m outside to 2.5 m inside stopped 38%
       of the way. That is the whole "fake response".

       So the opening is CLEARED, not just the one box: any collider living in
       THIS wall plane (never a structural pier a metre inside the building)
       whose band overlaps the opening is lifted out if it sits wholly inside,
       and CLIPPED to the surviving side(s) if it runs past — which is exactly
       what addRemnant already does for the struck wall, applied to its
       neighbours. Every edit is recorded on the rec so resetBreaches puts the
       facade back byte-for-byte on a new run. */
    /* WHAT LEAVES THE WORLD IS WHAT LANDS IN THE STREET. Every solid this carve
       takes out is recorded here as {box, mat} and handed to
       CBZ.debris.shatterBox below, which cuts it into real pieces. Nothing
       else mints debris for this event. See CONSERVATION OF MATTER. */
    rec.shed = [];
    const shedBox = (a, b, ry0, ry1, mat) => {
      if (!mat || b - a < 0.04 || ry1 - ry0 < 0.04) return;
      rec.shed.push({
        minX: horiz ? a : fixed - thick / 2, maxX: horiz ? b : fixed + thick / 2,
        minY: ry0, maxY: ry1,
        minZ: horiz ? fixed - thick / 2 : a, maxZ: horiz ? fixed + thick / 2 : b,
        mat: mat,
      });
    };
    // the struck course itself, clipped to the opening
    shedBox(Math.max(minU, u0), Math.min(maxU, u1), Math.max(y0, v0), Math.min(y1, v1), wmat);
    rec.clearedCols = [];      // lifted out whole (restored on reset)
    rec.clippedCols = [];      // {c, minX, maxX, minZ, maxZ} originals to restore
    rec.hidRefs = [];          // meshes hidden because they sat inside the hole
    const planeTol = thick / 2 + 0.35;   // "in this wall", not "behind it"
    for (let oi = CBZ.colliders.length - 1; oi >= 0; oi--) {
      const o = CBZ.colliders[oi];
      if (o === c || !o || rec.remnCols.indexOf(o) >= 0) continue;
      // A WALL THAT REFUSES TO BE BREACHED ALSO REFUSES TO BE DELETED BY ITS
      // NEIGHBOUR'S BREACH. Caught by tools/mode-engine-check.mjs the first run
      // after the opening was widened to ordnance size: the blast could not
      // carve the prison perimeter directly (1 m thick, over the 0.9 m limit)
      // but a carve on a wall NEAR it swept the perimeter collider out of the
      // opening — "PERIMETER BREACHED" through the side door.
      if (o.noBreach) continue;
      /* AND NEITHER DOES A LAMP POST. This sweep exists to clear the WALL
         SEGMENTS that sit inside the new opening — the sill course under it,
         the neighbouring facade boxes it now spans. It clears them by splicing
         the collider and hiding the mesh. A post standing on the pavement in
         front of the facade is within `planeTol` of the wall plane and is
         narrow enough to fall "wholly inside the hole", so a rocket into the
         shopfront behind it deleted the lamp as collateral — measured by
         tools/prop-blast-check.mjs, which caught a 7 m mast vanishing from a
         blast that never carved it. Same rule as the eligibility loop: a
         band-less collider that does not SPAN is street furniture, and street
         furniture is not part of the wall it happens to stand near. */
      if (o.y0 == null && o.y1 == null &&
          (CBZ.blastLaw ? CBZ.blastLaw.isProp(o, false) : Math.max(o.maxX - o.minX, o.maxZ - o.minZ) < POST_SPAN)) continue;
      const oFixed = horiz ? (o.minZ + o.maxZ) / 2 : (o.minX + o.maxX) / 2;
      if (Math.abs(oFixed - fixed) > planeTol) continue;
      // a heightless collider is full-height, so it always overlaps
      const oy0 = o.y0 == null ? -1e3 : o.y0, oy1 = o.y1 == null ? 1e3 : o.y1;
      if (oy1 <= v0 + 0.02 || oy0 >= v1 - 0.02) continue;
      const oU0 = horiz ? o.minX : o.minZ, oU1 = horiz ? o.maxX : o.maxZ;
      if (oU1 <= u0 + 0.02 || oU0 >= u1 - 0.02) continue;      // clear of the gap
      if (oU0 >= u0 - 0.02 && oU1 <= u1 + 0.02) {
        // wholly inside the hole — it goes, and so does its picture if that
        // mesh is not also carrying another live collider somewhere else.
        CBZ.colliderRemove(o, oi);
        rec.clearedCols.push(o);
        if (o.ref && o.ref.material && o.y0 != null && o.y1 != null && !(o.ref.material.transparent)) {
          shedBox(oU0, oU1, o.y0, o.y1, o.ref.material);          // it went; it falls
        }
        if (o.ref && o.ref.visible !== false && o.ref !== wall) {
          let shared = false;
          for (let k = 0; k < CBZ.colliders.length && !shared; k++) if (CBZ.colliders[k].ref === o.ref) shared = true;
          if (!shared) { o.ref.visible = false; rec.hidRefs.push(o.ref); }
        }
        continue;
      }
      // runs past the opening — keep whichever parts survive OUTSIDE it.
      // Both survivors must be real: clipping to a sliver (or, worse, to an
      // INVERTED box when the gap swallows one end) leaves an AABB whose min
      // exceeds its max, and the shared resolver treats that as a phantom wall
      // sitting exactly where the doorway is.
      const leftLen = u0 - oU0, rightLen = oU1 - u1;
      const keepL = leftLen > 0.12, keepR = rightLen > 0.12;
      if (!keepL && !keepR) {                                   // nothing outside worth keeping
        CBZ.colliderRemove(o, oi);
        rec.clearedCols.push(o);
        continue;
      }
      rec.clippedCols.push({ c: o, minX: o.minX, maxX: o.maxX, minZ: o.minZ, maxZ: o.maxZ });
      // A COURSE THAT MERELY GETS CLIPPED STILL DRAWS ACROSS THE HOLE. The
      // sweep above has always cut the physics of a neighbour that runs past
      // the opening and left its PICTURE whole — invisible on a facade of
      // 0.6 m segments (they land "wholly inside" and get hidden), glaring on
      // a curtain wall, where the sill and header are ONE box the full width
      // of the face: the blown-open bay kept a concrete curb across its floor
      // and a lintel across its head, and read as a big window. Cut the mesh
      // the same way the struck wall's is cut. Bounded so a huge opening over
      // a finely-segmented facade cannot mint meshes without limit.
      cutCourseMesh(o, oU0, oU1, keepL, keepR);
      if (o.ref && o.ref.material && !o.ref.material.transparent) {
        shedBox(Math.max(oU0, u0), Math.min(oU1, u1), o.y0, o.y1, o.ref.material);
      }
      if (keepL) {
        if (horiz) o.maxX = u0; else o.maxZ = u0;
        if (keepR) {                                            // both sides survive
          const cp = { minX: o.minX, maxX: o.maxX, minZ: o.minZ, maxZ: o.maxZ, ref: o.ref };
          if (o.y0 != null) cp.y0 = o.y0;
          if (o.y1 != null) cp.y1 = o.y1;
          if (o.noBreach) cp.noBreach = true;
          if (horiz) { cp.minX = u1; cp.maxX = oU1; } else { cp.minZ = u1; cp.maxZ = oU1; }
          CBZ.colliderAdd(cp); rec.remnCols.push(cp);
        }
      } else if (horiz) o.minX = u1; else o.minZ = u1;          // only the far side survives
      { const q = rec.clippedCols[rec.clippedCols.length - 1]; CBZ.colliderShrunk(o, q.minX, q.maxX, q.minZ, q.maxZ); }
    }
    carveDbg.gapU = [+u0.toFixed(2), +u1.toFixed(2)];
    carveDbg.gapV = [+v0.toFixed(2), +v1.toFixed(2)];
    carveDbg.cleared = rec.clearedCols.length;
    carveDbg.clipped = rec.clippedCols.length;
    // (the broadphase was edited in place above: colliderAdd/Remove/Shrunk)

    // window panes hanging on the carved band would float over the hole —
    // clear them silently (the carve's debris/replay-silence owns the moment;
    // cityGlassReset restores them with the wall on a new run)
    for (let i = 0; i < cityGlass.length; i++) {
      const gp = cityGlass[i];
      if (gp.shattered) continue;
      const gu = horiz ? gp.x : gp.z, gf = horiz ? gp.z : gp.x;
      if (Math.abs(gf - fixed) > thick / 2 + 0.5) continue;
      if (gu < u0 - 0.2 || gu > u1 + 0.2 || gp.y < v0 - 0.3 || gp.y > v1 + 0.3) continue;
      gp.shattered = true; shatteredPanes++; shatteredList.push(gp);
      if (gp.mesh) gp.mesh.visible = false; else paneShow(gp, false);
      if (gp.col) CBZ.colliderRemove(gp.col);
      // A PANE IS MATERIAL TOO. It leaves in the same instant the concrete
      // does, so it falls as ITS OWN glass rather than as more grey masonry —
      // which is why a curtain wall now sheds mostly glass and a brick pier
      // sheds mostly brick, with nobody tuning a ratio.
      const gm = (gp.mesh && gp.mesh.material) || (gp.proxy && gp.proxy.material) || (gp.pool && gp.pool.material) || glassMat();
      if (gm) rec.shed.push({
        minX: gp.x - gp.hw, maxX: gp.x + gp.hw,
        minY: gp.y - gp.hh, maxY: gp.y + gp.hh,
        minZ: gp.z - gp.hd, maxZ: gp.z + gp.hd,
        mat: gm, glass: true,
      });
    }
    // interior band dressing (sky slab + mullions) floating across the gap —
    // hide every record overlapping the opening rect on this wall, or the
    // hole reads as a gray panel from inside (USER-FILMED)
    for (let i = 0; i < roomDeco.length; i++) {
      const rd = roomDeco[i];
      if (rd.hidden) continue;
      const du = horiz ? rd.x : rd.z, df = horiz ? rd.z : rd.x, dhu = horiz ? rd.hw : rd.hd;
      if (Math.abs(df - fixed) > thick / 2 + 0.5) continue;
      if (du + dhu < u0 - 0.2 || du - dhu > u1 + 0.2) continue;
      if (rd.y + rd.hh < v0 - 0.3 || rd.y - rd.hh > v1 + 0.3) continue;
      decoShow(rd, false);
      rec.hiddenDeco = rec.hiddenDeco || [];
      rec.hiddenDeco.push(rd);
    }
    // THE FAKE INTERIOR GOES WITH THE GLASS IT WAS BEHIND. city/interiorlight.js
    // parks one painted room-plane 0.18 m inside every opening; with the bay
    // blown out it stands in the hole as a flat tan billboard in front of the
    // real slabs. Box it out in world coords — a little slack on the wall axis
    // so the inset panel is inside the box, generous on the plane axes.
    /* FLUSH THE SHED. One place, after every removal this carve makes is known,
       so the budget can be spent across the real solids in proportion to how
       much of each actually went — a 0.55 m sill course gets a handful of
       cells, a two-storey brick pier gets the lion's share, and the total is
       bounded whatever the ordnance was. Glass dices finer than concrete
       because glass breaks smaller. */
    rec.debrisKey = "hole" + (++holeDebrisSeq);
    let shedBld = null;
    for (let a = parent; a && !shedBld; a = a.parent) shedBld = (a.userData && a.userData.bld) || null;
    const shedFacade = shedBld ? shedBld.facade : null;
    if (CBZ.debris && rec.shed.length) {
      let vol = 0;
      for (const b of rec.shed) vol += (b.maxX - b.minX) * (b.maxY - b.minY) * (b.maxZ - b.minZ);
      const TOTAL = 44;
      const outN = { x: horiz ? 0 : outS, y: 0.15, z: horiz ? outS : 0 };
      const P = lawHole ? Math.min(2.6, Math.max(0.7, 0.9 * CBZ.blastLaw.cbrt(charge.W) + 0.5))
                        : Math.min(2.6, Math.max(0.7, (r || 1.3) * 0.7));
      /* A BLAST HAS TWO FACES. The skin the charge hit craters BACK toward it
         (near-face spall), and the far skin scabs off and is blown THROUGH
         (the jet, the shock, the gas). So a charged hole's solids are cut at
         the wall's mid-plane and each half flies its own way: some chunks land
         in the street at the shooter's feet, more inside the room. */
      const bSide = ((horiz ? z : x) - fixed) >= 0 ? 1 : -1;
      const nearN = { x: horiz ? 0 : bSide, y: 0.3, z: horiz ? bSide : 0 };
      const farN = { x: horiz ? 0 : -bSide, y: 0.12, z: horiz ? -bSide : 0 };
      const shedOne = function (b, budget, dir, skinMat) {
        CBZ.debris.shatterBox(b, skinMat || b.mat, {
          at: { x, y, z }, dir: dir, power: P,
          // what the wall is MADE of: a brick building sheds brick; civic /
          // fortified shells are stone and concrete; glass is glass
          kind: b.glass ? "glass" : skinMat ? undefined : (shedFacade === "brick" ? "brick" : (shedFacade === "civic" ? "rock" : undefined)),
          // the rim of surviving wall stays welded: a broken edge, not a saw cut
          keepEdge: b.glass ? 0 : 0.35,
          maxPieces: b.glass ? Math.min(budget, 14) : budget,
          owner: rec.debrisKey,
          grit: b.glass ? 1 : 0.8,
        });
      };
      for (const b of rec.shed) {
        const v = (b.maxX - b.minX) * (b.maxY - b.minY) * (b.maxZ - b.minZ);
        const share = vol > 0 ? v / vol : 0;
        const budget = Math.max(2, Math.round(TOTAL * share));
        // the face the player SEES: a shell course under a facade skin is
        // painted by that skin, so its pieces wear the skin of THIS face
        // (brick coursing, ashlar, stucco), never the shell's hidden tint
        let skinMat = null;
        if (!b.glass && shedBld && CBZ.cityIsShellMat(shedBld, b.mat)) {
          try { skinMat = CBZ.citySkin(shedBld, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2); } catch (e) { skinMat = null; }
        }
        const lo = horiz ? b.minZ : b.minX, hi = horiz ? b.maxZ : b.maxX;
        if (!lawHole || b.glass || hi - lo < 0.12) { shedOne(b, budget, lawHole ? farN : outN, skinMat); continue; }
        const mid = (lo + hi) / 2;
        const nearB = Object.assign({}, b), farB = Object.assign({}, b);
        if (horiz) { if (bSide > 0) { nearB.minZ = mid; farB.maxZ = mid; } else { nearB.maxZ = mid; farB.minZ = mid; } }
        else { if (bSide > 0) { nearB.minX = mid; farB.maxX = mid; } else { nearB.maxX = mid; farB.minX = mid; } }
        shedOne(nearB, Math.max(1, Math.round(budget * 0.4)), nearN, skinMat);
        shedOne(farB, Math.max(1, Math.round(budget * 0.6)), farN, skinMat);
      }
    }
    /* TELL THE LEDGER WHAT IS PHYSICALLY GONE.

       city/structural.js has carried a `severWidth` input since it was written
       — "METRES of the struck floor's load-bearing cross-section physically
       REMOVED. Geometry, not damage" — and it is the input its whole 9/11 model
       turns on: a sever takes a floor straight past its failure threshold, the
       yield latches how long the structure has left, and collapse.js runs the
       grammar. Nothing in the game had ever set it. MEASURED: eighteen rockets
       through the base of a 52-storey tower, `sever: 0.000`.

       The carve is the only code that knows. It is opening a hole of a known
       width in a known face of a known storey, so it accumulates that width per
       floor per face on the shell and reports the RUNNING TOTAL — which is what
       makes "keep shooting the bottom until it comes down" a real sentence
       rather than a wish. Damage is not double-counted: the ordnance row that
       caused this carve was already priced by the bus, and this call carries
       amount 0 and geometry only. */
    const shell = (parent && parent.userData && parent.userData.bld) || null;
    if (shell && CBZ.structure && CBZ.structure.hit && !opts.quiet && !opts.storey) {
      const sFH = shell.FH > 0 ? shell.FH : 4.1;
      const vMid = (v0 + v1) / 2;
      const k = Math.max(0, Math.floor(vMid / sFH));
      const open = (shell._openW || (shell._openW = {}));
      open[k] = (open[k] || 0) + (u1 - u0);
      /* RESOLVE IT AGAINST THE WHOLE FLOOR, NOT THE FACE WE HIT. Handing over a
         raw severWidth lets structural.js divide by the cross-section
         PERPENDICULAR TO TRAVEL — which is right for an airframe flying through
         a tower and wrong for a man with a rocket launcher standing on one
         pavement. MEASURED against the engine's own constants: one face as the
         denominator condemns a 52-storey tower after TWO full-width carves; the
         floor's real load-bearing run, 2*(w+d), takes EIGHT. Eight is a
         magazine emptied into the base, which is the thing being asked for;
         two is a stray rocket levelling a skyscraper.
         So we pass the fraction pre-resolved (the API takes either), and it
         accumulates across every face of that storey — because it does not
         matter which side you stand on, it matters how much of the floor is
         gone. */
      const perim = 2 * ((shell.w > 0 ? shell.w : 10) + (shell.d > 0 ? shell.d : 10));
      const sev = Math.min(1, open[k] / Math.max(8, perim));
      const wx = horiz ? (u0 + u1) / 2 : fixed, wz = horiz ? fixed : (u0 + u1) / 2;
      try {
        CBZ.structure.hit(wx, vMid, wz, 0, {
          kind: "breach", sever: sev,
          dirx: horiz ? 0 : outS, dirz: horiz ? outS : 0,
          byPlayer: !!opts.byPlayer,
        });
      } catch (e) {}
    }
    if (CBZ.cityInteriorGlowClearBox) {
      const gTol = thick / 2 + 0.85;
      const gMinX = horiz ? u0 - 0.3 : fixed - gTol, gMaxX = horiz ? u1 + 0.3 : fixed + gTol;
      const gMinZ = horiz ? fixed - gTol : u0 - 0.3, gMaxZ = horiz ? fixed + gTol : u1 + 0.3;
      try {
        rec.glowCleared = CBZ.cityInteriorGlowClearBox(gMinX, gMaxX, v0 - 0.4, v1 + 0.4, gMinZ, gMaxZ);
      } catch (e) {}
    }

    /* ---- WHAT IS BEHIND THE HOLE ------------------------------------------
       (1) opts.open (a window carve) and a curtain-wall bay: a real interior is
           already behind it — no dress at all.
       (2) a free-standing slab or anything prop-sized: nothing is behind it —
           no dress (gta6-props-are-not-walls: the lamp-post "glowing room").
       (3) opts.revealRoom (a shot-out upper window): the empty unit behind the
           glass, lit by the SCENE with a low baked fill, plus its ceiling
           fixture — never a self-lit box.
       (4) a BLAST hole: a charred pocket. One soot-lined box you look into,
           Lambert-lit like the wall around it (dark at night, because it is),
           and the reinforcement the blast exposed hanging off the header. The
           old prefab — full-bright cream liner, glowing ceiling slab, box
           furniture, warm spill — is gone: the owner filmed it as a "glowing
           fake wall" and it was never what a blast leaves. */
    const gapU = u1 - u0, gapCen = (u0 + u1) / 2;
    if (opts.open || curtain) {
      cityBreaches.push(rec);
      return rec;
    }
    if (freeStanding || propSized()) {
      cityBreaches.push(rec);
      return rec;
    }
    const revealRoom = !!opts.revealRoom;
    // a blast pocket is as deep as the wound is wide (a 0.7 m rocket hole does
    // not open onto a 2.6 m stage set); a gutted bay or a window shows the room
    const dep = opts.dep != null ? opts.dep
      : (revealRoom || opts.storey ? 2.6 : Math.min(2.6, Math.max(0.9, gapU * 1.3)));
    const floorY = (revealRoom || opts.storey) ? y0 : v0;
    const podV0 = Math.min(v0, floorY), podV1 = v1 + 0.2;
    const podCen = (podV0 + podV1) / 2, podH = podV1 - podV0;
    const inCtr = fixed - outS * (dep - thick) / 2;    // pocket centred inward from the outer plane
    const addPart = function (m) {
      m.castShadow = false; m.receiveShadow = false;
      if (parent) parent.add(m); else CBZ.scene.add(m);
      rec.extras.push(m);
      return m;
    };
    const im = addPart(new THREE.Mesh(
      new THREE.BoxGeometry(horiz ? gapU + 0.2 : dep, podH, horiz ? dep : gapU + 0.2),
      revealRoom ? insetMat() : sootMat()));
    im.position.set((horiz ? gapCen : inCtr) - px, podCen, (horiz ? inCtr : gapCen) - pz);
    if (revealRoom) {
      // the unit's floor and its ceiling fixture — the room reads as a room
      const fl = addPart(new THREE.Mesh(new THREE.BoxGeometry(horiz ? gapU + 0.2 : dep - 0.1, 0.08, horiz ? dep - 0.1 : gapU + 0.2), roomFloorMat()));
      fl.position.set((horiz ? gapCen : inCtr) - px, floorY + 0.05, (horiz ? inCtr : gapCen) - pz);
      const lgW = horiz ? Math.min(1.8, (gapU + 0.2) * 0.6) : 0.5, lgD = horiz ? 0.5 : Math.min(1.8, (gapU + 0.2) * 0.6);
      const lg = addPart(new THREE.Mesh(new THREE.BoxGeometry(lgW, 0.07, lgD), warmLightMat()));
      lg.position.set((horiz ? gapCen : inCtr) - px, v1 - 0.2, (horiz ? inCtr : gapCen) - pz);
    } else {
      // exposed reinforcement: bars torn out of the broken header, sized to the
      // wound (a small hole shows one or two, a gutted bay a row of them) —
      // merged into ONE mesh, so a hole costs two draws (pocket + steel)
      const nBar = Math.max(1, Math.min(5, Math.round(gapU * 1.4)));
      const pos = [], nrm = [];
      const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
      for (let bi = 0; bi < nBar; bi++) {
        const bl = 0.25 + Math.random() * Math.min(0.8, gapU * 0.5);
        const along = (Math.random() - 0.5) * gapU * 0.8;
        const bx = horiz ? gapCen + along : fixed + outS * (thick / 2 - 0.08);
        const bz = horiz ? fixed + outS * (thick / 2 - 0.08) : gapCen + along;
        const g = new THREE.BoxGeometry(0.03, bl, 0.03).toNonIndexed();
        _e.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
        g.applyMatrix4(_m4.compose(_v.set(bx - px, v1 - bl / 2 + 0.04, bz - pz), _q.setFromEuler(_e), _s));
        const pa = g.attributes.position.array, na = g.attributes.normal.array;
        for (let k = 0; k < pa.length; k++) { pos.push(pa[k]); nrm.push(na[k]); }
        g.dispose();
      }
      const bars = new THREE.BufferGeometry();
      bars.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      bars.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
      addPart(new THREE.Mesh(bars, rebarMat()));
    }

    cityBreaches.push(rec);
    return rec;

    // Is the thing we just carved PROP-SIZED rather than a building? A hoisted
    // function so the free-standing early-out above can call it. Returns false
    // fast for any wall long enough to be architecture on its own (the whole
    // city-facade path), so the Box3 traversal only ever runs on the short,
    // suspicious boxes — a lamp mast, a fence post, a sign.
    function propSized() {
      if (len >= 3.0) return false;              // a 3 m run is a wall, whatever it hangs off
      if (!parent || !carveBounds) return false;
      /* CHEAP ANSWER FIRST. A city facade is a RUN of short segments, so
         `len < 3` is the COMMON case here, not the exotic one — and the bounds
         traversal below walks a whole building's mesh tree. A building group
         carries a collider per wall box per storey per face; a prop group
         carries its own post and nothing else. Counting siblings is one pass
         over a flat array with an early-out, so the ordinary facade carve
         answers "yes, a building" almost immediately and never pays for the
         traversal. Only the genuinely ambiguous few reach the Box3. */
      let sib = 0;
      for (let i = 0; i < CBZ.colliders.length; i++) {
        const o = CBZ.colliders[i];
        if (o !== c && o.ref && o.ref.parent === parent && ++sib >= 4) return false;
      }
      try {
        carveBounds.setFromObject(parent);
        if (carveBounds.isEmpty && carveBounds.isEmpty()) return false;
        const bw = carveBounds.max.x - carveBounds.min.x;
        const bd = carveBounds.max.z - carveBounds.min.z;
        if (!isFinite(bw) || !isFinite(bd)) return false;
        carveDbg.parentFootprint = [+bw.toFixed(2), +bd.toFixed(2)];
        return Math.min(bw, bd) < 3.0;           // narrower than a corridor = furniture
      } catch (e) { return false; }
    }

  }
  // PUBLIC primitive for city/fracture.js (ledger/caps/persistence live there)
  CBZ.cityCarveWall = carveHole;
  /* THE FACADE LEDGER, in numbers a report can print. carveDbg already existed
     for one-shot debugging; this is the cumulative read a before/after gate
     needs: how many openings are standing, how much facade area is actually
     gone, how many of those are curtain-wall bays (zero before
     STRUCT_CURTAIN_BREACH_V1 — a glass office could not be opened at all), and
     how many fake-interior panels were pulled out of them. */
  CBZ.cityFacadeBreachAudit = function () {
    let area = 0, curtainN = 0, glow = 0, remn = 0;
    for (let i = 0; i < cityBreaches.length; i++) {
      const b = cityBreaches[i], g = b && b.gap;
      if (!g) continue;
      area += Math.max(0, g.u1 - g.u0) * Math.max(0, g.v1 - g.v0);
      if (b.curtain) curtainN++;
      glow += b.glowCleared || 0;
      remn += (b.extras ? b.extras.length : 0);
    }
    return {
      openings: cityBreaches.length,
      curtainOpenings: curtainN,
      openArea: +area.toFixed(1),
      glowPanelsCleared: glow,
      ruinPieces: remn,
      panesLost: shatteredPanes,
      lastCarve: { result: carveDbg.result, gapU: carveDbg.gapU, gapV: carveDbg.gapV,
                   cleared: carveDbg.cleared, clipped: carveDbg.clipped },
    };
  };

  // PUBLIC: plywood a hole over — the city patches its oldest wounds when the
  // fracture ledger overflows. A board + battens on the street face, a solid
  // collider filling the opening and the board back in the LOS set; everything
  // rides the SAME rec, so the run-reset chain tears it down with the breach.
  CBZ.cityBoardHole = function (rec) {
    if (!rec || rec.boarded || !rec.gap) return;
    rec.boarded = true;
    const g = rec.gap;
    const gapU = g.u1 - g.u0, gapV = g.v1 - g.v0, uc = (g.u0 + g.u1) / 2, vc = (g.v0 + g.v1) / 2;
    const nOff = g.fixed + g.outS * (g.thick / 2 + 0.07);
    const board = new THREE.Mesh(new THREE.BoxGeometry(g.horiz ? gapU + 0.3 : 0.12, gapV + 0.25, g.horiz ? 0.12 : gapU + 0.3), plyMat());
    board.position.set((g.horiz ? uc : nOff) - g.px, vc, (g.horiz ? nOff : uc) - g.pz);
    board.castShadow = false; board.receiveShadow = true;
    if (g.parent) g.parent.add(board); else CBZ.scene.add(board);
    rec.extras.push(board);
    const bOff = g.fixed + g.outS * (g.thick / 2 + 0.16);
    for (const fy of [vc - gapV * 0.28, vc + gapV * 0.28]) {
      const bat = new THREE.Mesh(new THREE.BoxGeometry(g.horiz ? gapU + 0.42 : 0.08, 0.16, g.horiz ? 0.08 : gapU + 0.42), plyBatMat());
      bat.position.set((g.horiz ? uc : bOff) - g.px, fy, (g.horiz ? bOff : uc) - g.pz);
      bat.castShadow = false;
      if (g.parent) g.parent.add(bat); else CBZ.scene.add(bat);
      rec.extras.push(bat);
    }
    // the opening blocks bodies AND sightlines again
    const col = { minX: g.horiz ? g.u0 : g.fixed - g.thick / 2, maxX: g.horiz ? g.u1 : g.fixed + g.thick / 2,
      minZ: g.horiz ? g.fixed - g.thick / 2 : g.u0, maxZ: g.horiz ? g.fixed + g.thick / 2 : g.u1,
      ref: board, y0: g.v0, y1: g.v1 };
    CBZ.colliderAdd(col); rec.remnCols.push(col);
    if (CBZ.losBlockers) CBZ.losBlockers.push(board);
  };

  // ---- SHOT-OUT WINDOWS YOU CAN CLIMB THROUGH -----------------------------
  // WHY: shooting a storefront window used to reveal... MORE WALL (panes are
  // decoration hanging proud of a solid per-storey wall box). Now a burst
  // GROUND-FLOOR street pane opens the wall behind it with the SAME proven
  // carve the RPG breach uses — sill remnant kept (a small hop over it reads
  // as climbing in), header kept (it reads window, not missing wall), jagged
  // glass teeth left in the frame. That makes every shop window a burglary
  // route after hours and an escape hatch mid-chase — quiet entry vs the
  // front door. Player-only shortcut: NPCs/cops never path through them.
  // Pool-capped: past WIN_OPEN_CAP the OLDEST opening boards itself over
  // (cityBoardHole planks = the city visibly healing its wounds).
  // SWISS-CHEESE budget: city facades can be peppered (each hole ≈4 remnant
  // colliders + a few shell meshes; 28 ≈ 112 colliders, fine w/ markCollidersDirty).
  // Other modes keep the conservative 12. Read mode at use-time (module body may
  // run before the mode is chosen) — tryWindowOpening only runs in city anyway.
  function winOpenCap() { return (CBZ.game && CBZ.game.mode === "city") ? 28 : 12; }
  const winOpenings = [];   // oldest-first [{rec, side}] — rec is the carve record
  CBZ.cityWindowOpenings = winOpenings;   // read-only for shops/wanted wiring
  function tryWindowOpening(gp) {
    if (gp.mesh) return;                       // solid showroom / jewelry-case glass keep their own contracts
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    if (gp.y < 1.0) return;                    // sub-sill slivers aren't windows
    const paneW = Math.max(gp.hw, gp.hd) * 2;
    if (paneW < 0.7) return;                   // transoms / slivers aren't a route
    // GROUND FLOOR (sill is a hop, head clears the header): a person-passable
    // route into the furnished room. UPPER STOREYS (user-filmed: "all the
    // other windows have gray building behind them"): the same carve, hugging
    // the pane's own band — not a route, a REVEAL: the wall section behind the
    // glass actually opens and the deep-room dress (floor slab, furniture,
    // back wall) shows a real room where the gray wall used to be.
    const upper = gp.y > 3.0;
    const sill = upper ? Math.max(0.3, gp.y - gp.hh - 0.05)
                       : Math.max(0.55, Math.min(1.3, gp.y - gp.hh));
    const top = upper ? gp.y + gp.hh + 0.05
                      : Math.min(gp.y + gp.hh + 1.4, Math.max(gp.y + gp.hh, sill + 2.5));
    const rec = carveHole(gp.x, gp.y, gp.z, 1.4, {
      search: 0.9,                             // the host wall is 0.105 behind the pane — never borrow a neighbour
      gapW: Math.max(1.3, Math.min(3.2, paneW + 0.2)),
      v0: sill, v1: top,
      // EVERY storey reveals a clean LIT ROOM. The raw hollow interior reads as
      // dim GRAY (the inside faces of the walls ARE the gray exterior box, barely
      // lit), so a true open:true hole just showed "gray building" (filmed).
      // revealRoom lines the opening with the empty unit — light walls and a
      // cool floor, lit by the scene plus the building's own low interior fill,
      // and its ceiling fixture — so you SEE A ROOM through a shot-out window.
      revealRoom: true, dep: 2.6,
    });
    if (!rec) return;                          // open air / wall already breached
    rec.windowOpening = true;
    const g = rec.gap;
    // carveHole hid the ENTIRE storey wall box (wall.visible=false), so EVERY
    // piece of dressing on it now floats with no wall behind it: BOTH bands'
    // full-span interior SKY slabs + mullion strips, the room-side MIRROR panes,
    // and the exterior panes on the OTHER (un-shot) band. The carve / revealRoom
    // only touched the gap rect, so anything else on this wall box reads as a
    // light-gray slab + floating glass from inside (USER-FILMED: a small real
    // hole + a gray panel + a crack of sky from the band the carve didn't cover).
    // Clear ALL panes + ALL interior deco across the wall box's FULL footprint
    // and y-span — not just the gap. The remnant flanks the carve rebuilt stay
    // solid concrete, so the wall is real where it's still wall; only the carved
    // gap (the open route / revealRoom box) is the window.
    const wMinU = g.minU != null ? g.minU : g.u0, wMaxU = g.maxU != null ? g.maxU : g.u1;
    const wY0 = g.y0, wY1 = g.y1, offTol = g.thick / 2 + 0.62;   // 0.62 = pane/slab proud + slack
    for (let i = 0; i < cityGlass.length; i++) {
      const o = cityGlass[i];
      if (o.shattered) continue;
      const gu = g.horiz ? o.x : o.z, gf = g.horiz ? o.z : o.x, hu = g.horiz ? o.hw : o.hd;
      if (Math.abs(gf - g.fixed) > offTol) continue;
      if (gu + hu < wMinU - 0.2 || gu - hu > wMaxU + 0.2) continue;
      if (o.y + o.hh < wY0 - 0.2 || o.y - o.hh > wY1 + 0.2) continue;
      o.shattered = true; shatteredPanes++; shatteredList.push(o);
      if (o.mesh) o.mesh.visible = false; else paneShow(o, false);
      if (o.col) CBZ.colliderRemove(o.col);
    }
    // interior SKY slabs + mullion strips (instanced roomDeco) — these ARE the
    // light-gray panel the user filmed. Hide every one on this wall box footprint
    // (carveHole only hid those overlapping the gap rect, missing the off-band).
    for (let i = 0; i < roomDeco.length; i++) {
      const rd = roomDeco[i];
      if (rd.hidden) continue;
      const du = g.horiz ? rd.x : rd.z, df = g.horiz ? rd.z : rd.x, dhu = g.horiz ? rd.hw : rd.hd;
      if (Math.abs(df - g.fixed) > offTol) continue;
      if (du + dhu < wMinU - 0.2 || du - dhu > wMaxU + 0.2) continue;
      if (rd.y + rd.hh < wY0 - 0.2 || rd.y - rd.hh > wY1 + 0.2) continue;
      decoShow(rd, false);
      (rec.hiddenDeco = rec.hiddenDeco || []).push(rd);
    }
    // jagged glass TEETH left standing in the frame (sill + header) sell the
    // broken window. Unique tiny geometries so resetBreaches can dispose them
    // with the rec's other extras; shared glass material.
    const nT = 4 + ((Math.random() * 3) | 0);
    for (let i = 0; i < nT; i++) {
      const tw = 0.1 + Math.random() * 0.16, th = 0.22 + Math.random() * 0.3;
      const tg = new THREE.BoxGeometry(tw, th, 0.04);
      tg.rotateZ((Math.random() - 0.5) * 0.9);   // tilted shards, not a picket fence
      const tm = new THREE.Mesh(tg, glassMat());
      const fu = g.u0 + 0.15 + Math.random() * Math.max(0.1, (g.u1 - g.u0) - 0.3);
      const fv = (i % 2 === 0) ? g.v0 + th * 0.3 : g.v1 - th * 0.3;
      const fn = g.fixed + g.outS * 0.08;
      if (g.horiz) tm.position.set(fu - g.px, fv, fn - g.pz);
      else { tm.rotation.y = Math.PI / 2; tm.position.set(fn - g.px, fv, fu - g.pz); }
      tm.castShadow = false; tm.receiveShadow = false; tm.renderOrder = 1;
      if (g.parent) g.parent.add(tm); else CBZ.scene.add(tm);
      rec.extras.push(tm);
    }
    winOpenings.push({ rec: rec, side: 0 });
    // cap: the OLDEST opening gets plywooded over (collider + LOS come back)
    if (winOpenings.length > winOpenCap()) {
      const old = winOpenings.shift();
      if (old.rec && !old.rec.boarded) CBZ.cityBoardHole(old.rec);
    }
  }

  // Read-only regression probe for the filmed "glass planes across a missing
  // wall" failure. It checks the actual pooled instance matrices as well as
  // logical flags: an intact record with a zero matrix is still a lifecycle
  // bug, and a shattered record whose matrix remains non-zero is still visible.
  const _openingAuditM = new THREE.Matrix4();
  function pooledRecordDrawn(r, pool, inst) {
    if (!r) return false;
    if (!pool && r.mesh) return r.mesh.visible !== false;
    pool = pool || r.pool; inst = inst == null ? r.inst : inst;
    if (!pool || inst == null || inst < 0) return false;
    pool.getMatrixAt(inst, _openingAuditM);
    const e = _openingAuditM.elements;
    // A hidden instance uses makeScale(0,0,0): all three basis vectors vanish.
    return Math.abs(e[0]) + Math.abs(e[1]) + Math.abs(e[2]) +
      Math.abs(e[4]) + Math.abs(e[5]) + Math.abs(e[6]) +
      Math.abs(e[8]) + Math.abs(e[9]) + Math.abs(e[10]) > 1e-7;
  }
  function openingOwnsRecord(r, g) {
    if (!r || !g) return false;
    const u = g.horiz ? r.x : r.z, f = g.horiz ? r.z : r.x;
    const hu = g.horiz ? r.hw : r.hd;
    const minU = g.minU != null ? g.minU : g.u0, maxU = g.maxU != null ? g.maxU : g.u1;
    const offTol = g.thick / 2 + 0.62;
    return Math.abs(f - g.fixed) <= offTol &&
      u + hu >= minU - 0.2 && u - hu <= maxU + 0.2 &&
      r.y + r.hh >= g.y0 - 0.2 && r.y - r.hh <= g.y1 + 0.2;
  }
  CBZ.cityWindowOpeningAudit = function () {
    const out = { openings: winOpenings.length, hostWallsVisible: 0, intactPanes: 0, renderedPanes: 0, visibleDeco: 0, ok: true };
    for (let wi = 0; wi < winOpenings.length; wi++) {
      const rec = winOpenings[wi] && winOpenings[wi].rec, g = rec && rec.gap;
      if (!rec || !g) continue;
      if (rec.wall && rec.wall.visible !== false) out.hostWallsVisible++;
      for (let i = 0; i < cityGlass.length; i++) {
        const gp = cityGlass[i]; if (!openingOwnsRecord(gp, g)) continue;
        if (!gp.shattered) out.intactPanes++;
        if (pooledRecordDrawn(gp)) out.renderedPanes++;
        if (gp.lit && gp.litPool && gp.litId >= 0) {
          if (pooledRecordDrawn(gp, gp.litPool, gp.litId)) out.renderedPanes++;
        }
      }
      for (let i = 0; i < roomDeco.length; i++) {
        const rd = roomDeco[i]; if (!openingOwnsRecord(rd, g)) continue;
        if (!rd.hidden || pooledRecordDrawn(rd)) out.visibleDeco++;
      }
    }
    out.ok = out.hostWallsVisible === 0 && out.intactPanes === 0 && out.renderedPanes === 0 && out.visibleDeco === 0;
    return out;
  };
  // Dev/test-only mutator: open the nearest eligible real pooled window, then
  // return the same audit a manual gunshot would. Gameplay never calls this.
  CBZ.debugWindowOpeningProbe = function (x, z) {
    const candidates = cityGlass.filter(function (gp) {
      return gp && !gp.mesh && !gp.shattered && gp.pool && gp.y >= 1 && Math.max(gp.hw, gp.hd) * 2 >= 0.7;
    });
    if (Number.isFinite(x) && Number.isFinite(z)) {
      candidates.sort(function (a, b) {
        return ((a.x - x) * (a.x - x) + (a.z - z) * (a.z - z)) - ((b.x - x) * (b.x - x) + (b.z - z) * (b.z - z));
      });
    }
    for (let i = 0; i < candidates.length; i++) {
      const gp = candidates[i], before = winOpenings.length;
      burstPane(gp); tryWindowOpening(gp);
      if (winOpenings.length <= before) continue;
      const audit = CBZ.cityWindowOpeningAudit();
      audit.target = { x: gp.x, y: gp.y, z: gp.z };
      return audit;
    }
    const audit = CBZ.cityWindowOpeningAudit();
    audit.error = "no eligible unbreached pooled window";
    return audit;
  };

  // PUBLIC: open the nearest ground-floor wall to (x,z) with a KNOWN opening
  // radius — a vehicle through a shopfront, a scripted breach. No charge law
  // here (nothing exploded); the size is the caller's. A no-op when a blast
  // at this spot already asked the wall this frame (fracture.recent).
  CBZ.cityBreach = function (x, z, r) {
    const fr = CBZ.cityFracture;
    if (!fr || !fr.blastAt || !CBZ.scene || !CBZ.colliders) return false;
    if (fr.recent && fr.recent(x, z)) return true;
    const gy = CBZ.floorAt ? CBZ.floorAt(x, z) : 0;
    return !!fr.blastAt({ x: x, y: gy + 1.2, z: z }, { r: r || 1.6, search: 5, now: true });
  };

  /* ============================================================
     CBZ.blastBuildings(x, y, z, opts) — WHAT ONE EXPLOSION DOES TO THE BUILT
     WORLD. Called once per detonation by the explosion itself (crashfx.js
     cityExplosion / cityAirstrikeExplosion), in every mode. Everything is
     derived from ONE number, the charge W (kg TNT-equivalent), through
     systems/breach.js's law:
       1. glass     every pane inside Z_GLASS . W^(1/3)
       2. a target  a declared door/vault in reach is paid (and the wall left)
       3. the wall  fracture.blastAt -> carveHole asks the law: breach or hold,
                    and how big (shaped charges perforate on their jet)
       4. the ledger (city/structural.js S.charge) for a blast the ordnance bus
                    did not route — the bus feeds the ledger itself, with the
                    same law, for everything it detonates.
     W comes from opts.charge (the bus and C4 always pass it), else from the
     reference charge of the named ordnance, else from `power` (legacy callers;
     W = 0.1 . power^3, so an RPG-power blast is an RPG-sized charge).
     ============================================================ */
  CBZ.blastBuildings = function (x, y, z, opts) {
    opts = opts || {};
    const L = CBZ.blastLaw;
    if (opts.noDamage || !L) return null;
    const ref = L.CHARGES[opts.ordnance] || L.CHARGES[opts.kind] || null;
    const W = opts.charge > 0 ? +opts.charge : (ref ? ref.W : L.chargeOfPower(opts.power || 1));
    if (!(W > 0)) return null;
    const shaped = opts.shaped != null ? !!opts.shaped : !!(ref && ref.shaped);
    const jetPen = opts.jetPen > 0 ? +opts.jetPen : (ref && ref.jetPen) || 0;
    const out = { W: W, glassR: L.glassR(W), target: null };
    try {
      if (!CBZ.game || CBZ.game.mode === "city") {
        CBZ.cityShatter(x, z, out.glassR, { power: Math.min(2.2, 0.8 + 0.45 * L.cbrt(W)) });
      } else if (CBZ.shatterGlass) CBZ.shatterGlass(x, z, out.glassR);
    } catch (e) {}
    const dup = L.recent(x, y, z);
    if (!dup && (!CBZ.modeHas || CBZ.modeHas("breach"))) {
      let t = null;
      if (!opts.noWallCarve && CBZ.breachTargetStrike) {
        try { t = CBZ.breachTargetStrike(x, y, z, W, !!opts.contact, opts); } catch (e) { t = null; }
      }
      out.target = t;
      if (!t && !opts.noWallCarve && !opts.airburst && CBZ.cityFracture && CBZ.cityFracture.blastAt) {
        try {
          CBZ.cityFracture.blastAt({ x: x, y: y, z: z }, {
            charge: W, contact: !!opts.contact, shaped: shaped, jetPen: jetPen, byPlayer: !!opts.byPlayer,
          });
        } catch (e) {}
      }
    }
    L.stamp(x, y, z);
    const busOwned = opts._impact || (CBZ.impact && CBZ.impact.inBusBlast && CBZ.impact.inBusBlast());
    if (!busOwned && !dup && CBZ.structure && CBZ.structure.charge) {
      try {
        CBZ.structure.charge(x, y, z, W, { kind: opts.ordnance || opts.kind || "explosion",
          byPlayer: !!opts.byPlayer, fire: opts.fire || 0 });
      } catch (e) {}
    }
    return out;
  };

  CBZ.onUpdate(0.01, function () {
    if (CBZ.game.mode !== "city") {
      if (glassNightOn) CBZ.cityGlassNight(false);
      if (winOpenQ.length) winOpenQ.length = 0;   // arena gone — drop queued window carves
      return;
    }
    // fold any freshly-registered panes into instanced pools (first city frame
    // for the main build; later generations for the expansion island).
    if (pendingGlass.length) buildGlassPools();
    if (pendingDeco.length) buildRoomDecoPools();
    if (pendingMasonry.length) buildMasonryPools();
    // drain deferred window-opening carves (see winOpenQ at cityShatter) —
    // WINOPEN_BUDGET carveHole monoliths per frame, off the blast frame's
    // critical path. Each re-resolves against live walls, so stale entries
    // (breached wall, demolished building, new run) are cheap no-ops.
    for (let wq = WINOPEN_BUDGET; wq > 0 && winOpenQ.length; wq--) {
      try { tryWindowOpening(winOpenQ.shift()); } catch (e) {}
    }
    // the dusk/dawn LIT-PANE flip — the same hysteresis thresholds as
    // view.js's emissive night pass so the whole night look lands together.
    const n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    CBZ.cityGlassNight(glassNightOn ? n > 0.45 : n > 0.6);
    // PLAYER CLIMBING THROUGH a shot-out window: crossing the wall plane inside
    // a live opening, street→room, fires the burglary hook. buildings.js only
    // REPORTS the route — shops/wanted own the crime (after-hours register/case
    // entry should ride the same path the front door uses). ≤12 openings, so
    // this is a handful of compares a frame, and zero when none exist.
    if (winOpenings.length && CBZ.player && CBZ.player.pos) {
      const P = CBZ.player.pos;
      for (let i = 0; i < winOpenings.length; i++) {
        const o = winOpenings[i], rec = o.rec;
        if (!rec || rec.boarded) { o.side = 0; continue; }
        const g = rec.gap;
        const u = g.horiz ? P.x : P.z, off = (g.horiz ? P.z : P.x) - g.fixed;
        if (u < g.u0 - 0.4 || u > g.u1 + 0.4 || Math.abs(off) > 1.4 || P.y > g.v1) { o.side = 0; continue; }
        const s = off >= 0 ? 1 : -1;
        if (o.side && s !== o.side) {
          rec.entered = true;                               // the route got used
          if (s !== g.outS && CBZ.cityWindowEntry) CBZ.cityWindowEntry(rec);   // inward = breaking and entering
        }
        o.side = s;
      }
    }
  });

  // ---- OPENABLE STORE DOORS ----------------------------------------------
  // Every real doorway gets a swinging glass-and-frame panel on a hinge pivot.
  // Closed, the panel is a height-gated collider that fills the gap (so you
  // can't just walk through a "closed" shop). When the player (or a ped/car)
  // comes within range the door SWINGS open (and its collider is pulled so the
  // doorway is passable), then closes itself a beat after everyone leaves.
  // One shared frame/glass material, capped, pooled-free (fixed at worldgen).
  const cityDoors = [];
  let _doorLeafMat = null, _doorVisionMat = null, _doorFrameMat = null, _doorBarMat = null;
  let _helipad = null;   // {x,y,z} world centre of the rooftop helipad (one per city)
  // THE DOOR LEAF reads SOLID so a CLOSED door obviously looks shut. The old leaf
  // was a ~0.5-opacity glass panel — you saw straight through it, so a closed
  // door read "open AND closed at once". Now the leaf is a near-opaque slab
  // (opacity 0.97) with only a small clear VISION WINDOW inset, a clear dark
  // FRAME, and a bright push-BAR — the unambiguous closed/open states the door
  // literature (Liz England's "door problem") calls for.
  /* THE LEAF. Owner, looking at a facade sheet: "where's the door tho, it's a
     hole and frame." The door was always there — this leaf, on its pivot, with
     the open/lock logic already written against it — but it did not READ as one:
     a pale blue-grey slab at 97% opacity, flat, with no panelling, which under
     any bright light washes out into the wall behind it. It is now a door
     COLOUR (a painted timber tone, dark enough to hold its own against pale
     stucco and pale stone alike) and fully opaque, because 3% transparency
     bought nothing and cost sorting and raycast correctness. */
  function doorLeafMat() { return _doorLeafMat || (_doorLeafMat = new THREE.MeshLambertMaterial({ color: 0x4a5560, emissive: 0x10161c, emissiveIntensity: 0.16 })); }
  let _doorRailMat = null;
  function doorRailMat() { return _doorRailMat || (_doorRailMat = new THREE.MeshLambertMaterial({ color: 0x6a7683 })); }
  function doorVisionMat() { return _doorVisionMat || (_doorVisionMat = new THREE.MeshLambertMaterial({ color: 0xbfe9f7, emissive: 0x2f6f86, emissiveIntensity: 0.4, transparent: true, opacity: 0.55 })); }
  function doorFrameMat() { return _doorFrameMat || (_doorFrameMat = new THREE.MeshLambertMaterial({ color: 0x21262d })); }
  function doorBarMat() { return _doorBarMat || (_doorBarMat = new THREE.MeshLambertMaterial({ color: 0xc8ccd2, emissive: 0x44484e, emissiveIntensity: 0.3 })); }

  // Build ONE clean hinged door for the DOORW-wide gap at localDoor (group-local
  // coords; door.nx/nz is the inward normal). The build is:
  //   • an OVERSIZED clean FRAME (two jambs + a header) ringing the doorway so the
  //     opening has breathing room and the closed leaf has something to seat into;
  //   • ONE solid LEAF on a hinge pivot at one jamb, with a small glass vision
  //     window + a vertical push-bar handle, that fills the gap FLUSH when closed;
  //   • a full CLEAN ~95° INWARD swing that tucks the leaf flat against the inner
  //     wall (clearly out of the doorway), verified to clear the gap and not clip.
  // Registered globally for the proximity auto-opener. opts.frameH lets a taller
  // shell (the mega-tower lobby) raise the header.
  function makeDoorPanel(bgroup, ox, oz, localDoor, panelW, opts) {
    opts = opts || {};
    const gap = (panelW || DOORW);                 // the doorway opening width
    const dw = gap - 0.16;                          // leaf a hair narrower so it swings free
    // default frame rides the person-scaled DOORH (not FH): leaf = DOORH-0.15,
    // seating just under the wall header that fills DOORH..FH above it.
    const frameH = opts.frameH != null ? opts.frameH : DOORH + 0.7;
    const dh = frameH - 0.85;                        // leaf height (header sits above it)
    const nx = localDoor.nx, nz = localDoor.nz;
    const tx = -nz, tz = nx;                         // tangent along the doorway width
    const along = Math.abs(nx) > 0.5;               // door faces ±X → leaf spans Z
    const hingeSign = (nx !== 0 ? nx : nz) >= 0 ? 1 : -1;   // deterministic jamb side

    // (NO chunky frame jambs/header — they read as "weird props" stuck around the
    // doorway. The wall opening already frames the door; just hang the clean leaf.)

    // ---- the LEAF on its hinge pivot ----
    // pivot group at the hinge jamb (local); the leaf hangs from it, its centre
    // offset back to the doorway centre so the CLOSED leaf sits FLUSH in the gap.
    const pivot = new THREE.Group();
    pivot.userData.mover = true;   // swings every frame — core/staticfreeze.js must not freeze it
    const hx = localDoor.x + tx * (dw / 2) * hingeSign;
    const hz = localDoor.z + tz * (dw / 2) * hingeSign;
    pivot.position.set(hx, dh / 2 + 0.05, hz);
    bgroup.add(pivot);
    const leafOffX = -tx * (dw / 2) * hingeSign, leafOffZ = -tz * (dw / 2) * hingeSign;
    // SOLID leaf slab (near-opaque) — a closed door obviously looks SHUT
    const slabT = 0.1;                               // leaf thickness
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(along ? slabT : dw, dh, along ? dw : slabT), doorLeafMat());
    leaf.position.set(leafOffX, 0, leafOffZ); leaf.castShadow = false; pivot.add(leaf);
    // a small CLEAR VISION WINDOW inset high on the leaf (so it still reads as a
    // glass shop door, but only a small pane — the bulk stays solid/shut-looking)
    const vw = dw * 0.5, vh = dh * 0.32;
    const vision = new THREE.Mesh(new THREE.BoxGeometry(along ? slabT + 0.02 : vw, vh, along ? vw : slabT + 0.02), doorVisionMat());
    vision.position.set(leafOffX, dh * 0.18, leafOffZ); vision.renderOrder = 1; pivot.add(vision);
    let railMesh = null;
    /* STILES AND RAILS on the outward face — the two uprights, the top, middle
       and bottom rails, and a kick plate. This is the whole difference between
       "a slab in a hole" and "a door": at any distance the eye reads the frame
       pattern long before it can see hardware. They are merged into ONE mesh,
       because a door is per-building and the city has hundreds of them — five
       loose boxes each would be five hundred draw calls for panelling.
       Everything hangs off the pivot, so it swings with the leaf. */
    {
      const outSgn = -1;                              // nx/nz is the INWARD normal
      const pt = 0.025;                               // how proud a rail stands
      const zo = slabT / 2 + pt / 2;
      const parts = [];
      const addPart = function (wid, hei, lat, yy) {
        const g = new THREE.BoxGeometry(along ? pt : wid, hei, along ? wid : pt);
        g.translate(leafOffX + tx * lat + nx * outSgn * zo, yy,
          leafOffZ + tz * lat + nz * outSgn * zo);
        parts.push(g);
      };
      const stile = Math.min(0.17, dw * 0.13), rail = Math.min(0.19, dh * 0.10);
      addPart(stile, dh, -(dw / 2 - stile / 2), 0);           // hinge stile
      addPart(stile, dh, (dw / 2 - stile / 2), 0);            // latch stile
      addPart(dw, rail, 0, dh / 2 - rail / 2);                // top rail
      addPart(dw, rail, 0, -(dh / 2 - rail / 2));             // bottom rail
      addPart(dw, rail * 0.85, 0, -dh * 0.06);                // lock rail
      addPart(dw - stile * 2, dh * 0.13, 0, -(dh / 2 - rail - dh * 0.075));  // kick plate
      const BGU = THREE.BufferGeometryUtils;
      if (BGU && BGU.mergeBufferGeometries && parts.length > 1) {
        const merged = BGU.mergeBufferGeometries(parts);
        for (const g of parts) g.dispose();
        if (merged) {
          const m = new THREE.Mesh(merged, doorRailMat());
          m.castShadow = false; m.receiveShadow = true; pivot.add(m);
          railMesh = m;
        }
      } else {
        for (const g of parts) {
          const m = new THREE.Mesh(g, doorRailMat());
          m.castShadow = false; m.receiveShadow = true; pivot.add(m);
          railMesh = m;
        }
      }
    }
    // a vertical PUSH-BAR / pull handle on the free-edge side, proud of the leaf
    const handleLat = -(dw / 2 - 0.18) * hingeSign;  // toward the free (latch) edge
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, dh * 0.55, 0.07), doorBarMat());
    bar.position.set(leafOffX + tx * handleLat + nx * (slabT / 2 + 0.05), -0.05, leafOffZ + tz * handleLat + nz * (slabT / 2 + 0.05));
    bar.castShadow = false; pivot.add(bar);

    // collider that exactly fills the CLOSED doorway gap (height-gated)
    const wx = ox + localDoor.x, wz = oz + localDoor.z;
    const half = dw / 2 + 0.06;
    const col = along
      ? { minX: wx - 0.2, maxX: wx + 0.2, minZ: wz - half, maxZ: wz + half, ref: leaf, y0: 0.0, y1: dh + 0.1 }
      : { minX: wx - half, maxX: wx + half, minZ: wz - 0.2, maxZ: wz + 0.2, ref: leaf, y0: 0.0, y1: dh + 0.1 };
    CBZ.colliders.push(col);
    CBZ.losBlockers.push(leaf);
    // OPEN SWING is INWARD (toward the room) so the leaf tucks flat against the
    // inner wall, clearly out of the doorway. The leaf's free edge sits on the
    // -hingeSign tangent side; working THREE's Y-rotation matrix through, the
    // pivot must turn by -hingeSign·θ to carry that free edge toward +n (into the
    // room). A full ~95° (1.66 rad) lands the leaf flat along the inner wall.
    const openSign = -hingeSign;
    const rec = {
      pivot, col, wx, wz, t: 0, open: false, hold: 0,
      maxAng: openSign * 1.66, colIn: true,
      inx: nx, inz: nz,                            // inward normal (for proximity test)
      leaf: leaf, rails: railMesh,                 // so a facade can paint this door
    };
    cityDoors.push(rec);
    return rec;
  }

  function doorNearActor(dr, x, z, radius) {
    const ax = x - dr.wx, az = z - dr.wz;
    const across = ax * dr.inx + az * dr.inz;            // + = inside the building
    const side = ax * -dr.inz + az * dr.inx;             // along the door width
    const lat = Math.abs(side), r = radius || 1.0;
    // widened the OUTSIDE reach (-3.4 vs -2.8) so a shop door begins easing open
    // a stride earlier as the player walks up to it, instead of popping at the jamb.
    if (lat < 1.65 + r * 0.45 && across > -3.4 - r && across < 4.6 + r) return true;
    return ax * ax + az * az < r * r;
  }
  function carDoorRadius(car) {
    const w = car && car.model && car.model.w ? car.model.w : 1.9;
    const l = car && car.model && car.model.l ? car.model.l : 4.2;
    return Math.max(3.6, Math.min(6.2, (w + l) * 0.58));
  }
  function doorWorldY(dr) {
    if (dr.doorY != null) return dr.doorY;
    const y = CBZ.floorAt ? +CBZ.floorAt(dr.wx, dr.wz) : 0;
    return (isFinite(y) ? y : 0) + 1.5;
  }
  function playerAtDoor(dr) {
    const player = CBZ.player;
    const P = player && player.pos;
    // Horizontal-only proximity made every storefront under a flying B-2 open:
    // a person/car may operate a ground door; an aircraft never may, and the
    // player's body must agree with the door's physical floor in Y.
    return !!(P && !player._aircraft &&
      Math.abs(P.y - doorWorldY(dr)) < (player.driving ? 5.5 : 3.5) &&
      doorNearActor(dr, P.x, P.z, player.driving ? 4.6 : 1.7));
  }
  function playerInsideDoorBuilding(dr, P) {
    const b = dr.building;
    if (!b || !P) return false;
    const by = b.group && b.group.position ? (b.group.position.y || 0) : 0;
    return P.y >= by - 0.8 && P.y <= by + b.h + 3.2 &&
      Math.abs(P.x - b.ox) <= b.w / 2 + 0.35 &&
      Math.abs(P.z - b.oz) <= b.d / 2 + 0.35;
  }
  const DOOR_HEAR_DIST = 34;
  function playPhysicalDoor(dr, open, playerCaused) {
    const player = CBZ.player;
    const P = player && player.pos;
    if (!CBZ.sfx || !P || player._aircraft) return;
    const dy = P.y - doorWorldY(dr);
    const dist = Math.hypot(P.x - dr.wx, dy, P.z - dr.wz);
    // A door is audible only when this player caused its current open/close
    // cycle, or it belongs to the shell the player is physically inside. Even
    // then it has a hard local cutoff: `sfx({dist})` deliberately retains a
    // far-field floor for guns, which is wrong for quiet indoor hardware.
    if ((!playerCaused && !playerInsideDoorBuilding(dr, P)) || dist >= DOOR_HEAR_DIST) return;
    const volume = dist <= 5 ? 1 : Math.max(0.06, 1 - (dist - 5) / (DOOR_HEAR_DIST - 5));
    CBZ.sfx(open ? "door_open" : "door_close", { dist: dist, volume: volume });
  }
  function doorOccupied(dr, includeCars) {
    if (playerAtDoor(dr)) return true;
    if (includeCars && CBZ.cityCars) {
      for (let k = 0; k < CBZ.cityCars.length; k++) {
        const c = CBZ.cityCars[k]; if (!c || c.dead || !c.pos) continue;
        const dx = c.pos.x - dr.wx, dz = c.pos.z - dr.wz;
        if (dx * dx + dz * dz > 48) continue;
        if (doorNearActor(dr, c.pos.x, c.pos.z, carDoorRadius(c))) return true;
      }
    }
    if (CBZ.cityPeds) {
      for (let k = 0; k < CBZ.cityPeds.length; k++) {
        const pd = CBZ.cityPeds[k]; if (!pd || pd.dead || !pd.pos || pd.enterT > 0) continue;
        const dx = pd.pos.x - dr.wx, dz = pd.pos.z - dr.wz;
        if (dx * dx + dz * dz > 22) continue;
        // YOUR DOOR IS LOCKED TO OTHERS (city/plots.js stamps _ownerLock on
        // every door of a building the player owns): it only swings for you
        // and your people.
        if (dr._ownerLock && !(CBZ.cityPlotFriendly && CBZ.cityPlotFriendly(pd, dr))) continue;
        if (doorNearActor(dr, pd.pos.x, pd.pos.z, 1.25)) return true;
      }
    }
    return false;
  }

  /* A HAND ON THE DOOR AS YOU GO THROUGH IT. The leaf swings open ahead of
     you (the proximity opener below); walking through the doorway, a person
     puts a palm on the open leaf beside them and holds it while they pass.
     The palm goes on the leaf's own face (CBZ.verbs.touchSurface on the leaf
     mesh, the side you are on), PINNED to the leaf where it first landed —
     the hand stays on the door while the body walks past it, and lets go
     when the arm can no longer reach (the touch verb's reach gate) or you
     leave the doorway. A sustained CBZ.verbs.touch: the plant solver, in
     first person too. On foot only. */
  const _dpP = new THREE.Vector3(), _dpN = new THREE.Vector3();
  function doorPalm(dr) {
    const V = CBZ.verbs, player = CBZ.player, P = player && player.pos;
    if (!V || !V.touch || !V.touchSurface || !P || player.driving || player._aircraft || !dr.leaf || dr.t < 0.35) return;
    const ax = P.x - dr.wx, az = P.z - dr.wz;
    const across = ax * dr.inx + az * dr.inz;
    if (Math.abs(across) > 1.2) { dr._palmL = null; return; }
    const leaf = dr.leaf;
    if (!dr._palmL) {
      const y = (P.y || 0) + 1.02;
      const s = V.touchSurface(leaf, { x: P.x, y: y, z: P.z }, y, 0.14);
      if (!s) return;
      leaf.updateWorldMatrix(true, false);
      dr._palmL = leaf.worldToLocal(s.point.clone());
      // the face normal, in the leaf's frame (it swings with the leaf)
      const inv = new THREE.Matrix3().getNormalMatrix(leaf.matrixWorld).invert();
      dr._palmN = s.normal.clone().applyMatrix3(inv).normalize();
    }
    leaf.updateWorldMatrix(true, false);
    _dpP.copy(dr._palmL); leaf.localToWorld(_dpP);
    _dpN.copy(dr._palmN).transformDirection(leaf.matrixWorld);
    V.touch(player, { point: _dpP, normal: _dpN, kind: "palm", sustain: true, key: "citydoor" });
  }

  // proximity-driven auto-opener: open when the player, peds or cars approach
  // the doorway; ease the swing; pull/restore the collider only when the passage
  // is clear. Cheap: still culled to doors near the player unless a door is open.
  CBZ.onUpdate(34.3, function (dt) {
    if (CBZ.game.mode !== "city" || !cityDoors.length) return;
    const P = CBZ.player && CBZ.player.pos;
    const px = P ? P.x : 0, pz = P ? P.z : 0;
    for (let i = 0; i < cityDoors.length; i++) {
      const dr = cityDoors[i];
      if (dr.demolished) continue;                 // building is rubble — no door to swing
      const dxp = dr.wx - px, dzp = dr.wz - pz;
      const farFromPlayer = dxp * dxp + dzp * dzp > 1600;   // 40m: skip cold distant doors
      if (farFromPlayer && !dr.open && dr.t <= 0.001) continue;
      const wasOpen = dr.open;
      const playerNear = playerAtDoor(dr);
      const near = doorOccupied(dr, true);
      if (near) { dr.open = true; dr.hold = 1.8; }
      else if (dr.hold > 0) { dr.hold -= dt; if (dr.hold <= 0) dr.open = false; }
      if (dr.open !== wasOpen) {
        if (dr.open) dr.playerSoundCycle = playerNear;
        playPhysicalDoor(dr, dr.open, playerNear || !!dr.playerSoundCycle);
        if (!dr.open) dr.playerSoundCycle = false;
      }

      // ease the swing toward target (open=1 / closed=0)
      const target = dr.open ? 1 : 0;
      if (Math.abs(dr.t - target) > 0.001) {
        dr.t += (target - dr.t) * Math.min(1, dt * 6.5);
        if (Math.abs(dr.t - target) < 0.01) dr.t = target;
        dr.pivot.rotation.y = dr.t * dr.maxAng;
      }

      // Collider sync is evaluated EVERY frame (not only mid-swing) so the
      // doorway is reliably passable while open and reliably solid once shut.
      //  - drop the collider as soon as the leaf has swung clear (t > 0.30) so
      //    you can actually walk through the gap you can see is open;
      //  - restore it once the leaf is MOSTLY shut (t < 0.25) AND nobody is in
      //    the doorway. Re-adding at 0.25 (not the old 0.12) closes the gap
      //    where the leaf looked nearly shut but the wall collider was still
      //    pulled — you could ghost through a door that visually read closed.
      //    The doorOccupied guard below still prevents snapping a wall onto an
      //    actor lingering in the gap, so this is safe to tighten.
      if (playerNear) doorPalm(dr);
      else if (dr._palmL) dr._palmL = null;
      if (dr.colIn && dr.t > 0.30) {
        const idx = CBZ.colliders.indexOf(dr.col); if (idx >= 0) CBZ.colliders.splice(idx, 1);
        dr.colIn = false; if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      } else if (!dr.colIn && dr.t < 0.25) {
        // leaf is shut. If someone is still standing in the gap, hold it open a
        // beat longer rather than trapping them; otherwise re-solidify the wall.
        if (doorOccupied(dr, true)) {
          dr.open = true; dr.hold = Math.max(dr.hold, 0.4);
        } else {
          if (CBZ.colliders.indexOf(dr.col) === -1) CBZ.colliders.push(dr.col);
          dr.colIn = true; if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
        }
      }
    }
  });

  // restore every door to CLOSED for a new game (collider back in place)
  CBZ.cityDoorsReset = function () {
    for (const dr of cityDoors) {
      dr.open = false; dr.hold = 0; dr.t = 0; dr.playerSoundCycle = false; dr.pivot.rotation.y = 0;
      if (dr.demolished) continue;                 // demolition owns this door's collider until rebuilt
      if (!dr.colIn) { if (CBZ.colliders.indexOf(dr.col) === -1) CBZ.colliders.push(dr.col); dr.colIn = true; }
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  };

  // Expose the live door array to the shared nav module (citynav.js): it
  // snapshots door {wx,wz,inx,inz} for the flee-EQS and reads .open/.t per
  // frame to treat an open leaf as a passable gap. Read-only consumer; the
  // door sim above remains the sole writer.
  CBZ.cityDoorsGet = function () { return cityDoors; };

  // Business catalogue. `sign` = awning/sign colour; `name` shown on the
  // door + HUD; `kind` = the shop kind city/shops.js switches on.
  const SHOPS = [
    { kind: "guns",     name: "Lock & Load Firearms", sign: 0x394b2e, storeys: 1, retail: true },
    { kind: "jewelry",  name: "Carat & Karat Jewelers", sign: 0xf2c43d, storeys: 1, retail: true },
    { kind: "pawn",     name: "Last Chance Pawn", sign: 0x8a5a2b, storeys: 1, retail: true },
    { kind: "gas",      name: "Pump & Go Fuel",  sign: 0xe24b4b, storeys: 1, gas: true, retail: true },
    { kind: "clothing", name: "Threads & Drip",  sign: 0xc792ea, storeys: 1, retail: true },
    { kind: "drugs",    name: "The Trap House",  sign: 0x4caf6e, storeys: 1, retail: true },
    { kind: "food",     name: "The Greasy Spoon", sign: 0xff9e6b, storeys: 1, retail: true },
    { kind: "bar",      name: "Velvet Club",     sign: 0xe85d8a, storeys: 2 },
    { kind: "bank",     name: "Meridian Trust",  sign: 0x5b8bff, storeys: 2 },
    { kind: "hardware", name: "Hammer & Nail Hardware", sign: 0xffd166, storeys: 1, retail: true },
    { kind: "gym",      name: "Iron Temple Gym", sign: 0x66d9c0, storeys: 1, retail: true },
    { kind: "security", name: "Sentinel Security", sign: 0x49566b, storeys: 1 },
    { kind: "hospital", name: "City Hospital",   sign: 0xe8e8ee, storeys: 2, hospital: true },
    { kind: "barber",   name: "Fresh Cuts",      sign: 0x6bb6ff, storeys: 1, retail: true },
    // SHADES — the sunglass store. Its whole stock is the glasses slot
    // (economy.js SHOP_STOCK.eyewear), every pair a real frame that goes on
    // your face, standing on the shelves as its own model.
    { kind: "eyewear",  name: "Shades Optical",  sign: 0x2f3a4a, storeys: 1, retail: true },
    { kind: "electronics", name: "Volt Electronics", sign: 0x39d0c0, storeys: 1, retail: true },
    { kind: "carlot",   name: "Premium Autos",   sign: 0xe88a3c, storeys: 1, carlot: true, retail: true },
    { kind: "realtor",  name: "Keystone Realty", sign: 0x4fd0a0, storeys: 1, realtor: true },
    { kind: "chop",     name: "Cut-Rate Chop Shop", sign: 0xd0a23c, storeys: 1, chop: true, retail: true },
    { kind: "casino",   name: "The Golden Ace Casino", sign: 0xc9a227, storeys: 2 },
    { kind: "raceway",  name: "City Speedway",   sign: 0x2f6fed, storeys: 1 },
    { kind: "arena",    name: "The Coliseum Fight Club", sign: 0xd94f45, storeys: 2 },
    { kind: "paintball", name: "Splat Zone Paintball", sign: 0x7ed957, storeys: 1 },
    { kind: "transit",  name: "Central Transit", sign: 0x39c0d0, storeys: 1 },
    { kind: "cityhall", name: "City Hall",       sign: 0xd8dde8, storeys: 2 },
    { kind: "airfield", name: "Skyline Airfield", sign: 0x8a93a3, storeys: 1 },
    { kind: "racepark", name: "Downs Racetrack", sign: 0xb98a5a, storeys: 1 },
  ];
  const TOWER_PALETTE = [0x5b6b82, 0x6f7e96, 0x8a98ac, 0x49566b, 0x7a6f8c, 0x5e7d86];
  const ABANDONED_PALETTE = [0x4a4438, 0x3f4640, 0x534a44, 0x46423c, 0x4c4640];
  const BOARD = 0x6b4a2a;

  // ---- DISTRICT MATERIAL / FACADE KITS (PROCGEN.md roadmap #7) -----------
  // Wall palette + glass-tint bias, keyed by
  // district kind (city/config.js CITY.districts[].kind, read via the city's
  // districtKind(lot) and threaded into makeBuilding as opts.district). Same
  // shell code, different NEIGHBOURHOOD READ per district. Window cells are
  // always intentional glazing: no random grey blank panels and no facade AC
  // boxes or arbitrary projecting "balcony" boxes. Whole windowless service
  // floors are authored at the building level rather than sprinkled randomly
  // across a facade.
  const DISTRICT_KITS = {
    core:        { hueJitter: 4,  satMul: [1.00, 1.05], lightMul: [1.00, 1.05], glassTintBias: 0 },
    commercial:  { hueJitter: 8,  satMul: [0.95, 1.08], lightMul: [0.96, 1.06], glassTintBias: 1 },
    residential: { hueJitter: 14, satMul: [0.90, 1.12], lightMul: [0.92, 1.08], glassTintBias: 0 },
    projects:    { hueJitter: 10, satMul: [0.55, 0.82], lightMul: [0.76, 0.92], glassTintBias: 2 },
    industrial:  { hueJitter: 10, satMul: [0.60, 0.86], lightMul: [0.78, 0.94], glassTintBias: 2 },
  };
  const DEFAULT_KIT = { hueJitter: 10, satMul: [0.92, 1.08], lightMul: [0.94, 1.06], glassTintBias: 0 };

  // hue-locked wall jitter: keep the district's hue family but jitter sat/light
  // a touch per-building so a whole block isn't one flat colour. Position-hashed
  // (CBZ.hash01) off the building's world origin — deterministic, no rng() draw,
  // so this can never desync the city's shared RNG stream.
  function districtWallColor(hex, kit, ox, oz) {
    const c = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    const hj = CBZ.hash01(ox, oz, 0xd15c) - 0.5;         // -0.5..0.5
    const sj = CBZ.hash01(ox, oz, 0xd15d);
    const lj = CBZ.hash01(ox, oz, 0xd15e);
    hsl.h = (hsl.h + hj * (kit.hueJitter / 360) + 1) % 1;
    hsl.s = Math.max(0, Math.min(1, hsl.s * (kit.satMul[0] + sj * (kit.satMul[1] - kit.satMul[0]))));
    hsl.l = Math.max(0, Math.min(1, hsl.l * (kit.lightMul[0] + lj * (kit.lightMul[1] - kit.lightMul[0]))));
    c.setHSL(hsl.h, hsl.s, hsl.l);
    return c.getHex();
  }

  // cached graffiti texture (a coloured tag splat) so abandoned walls vary cheaply
  const grafCache = new Map();
  function graffitiTex(hex) {
    let t = grafCache.get(hex);
    if (t) return t;
    const c = document.createElement("canvas"); c.width = 128; c.height = 64;
    const x = c.getContext("2d");
    x.clearRect(0, 0, 128, 64);
    const col = "#" + ("000000" + hex.toString(16)).slice(-6);
    x.strokeStyle = col; x.lineWidth = 5; x.lineCap = "round";
    // a few deterministic spray strokes
    const pts = [[14, 44, 40, 18], [40, 18, 64, 46], [64, 46, 92, 16], [92, 16, 116, 44], [22, 30, 104, 34]];
    for (const [a, b, cc, d] of pts) { x.beginPath(); x.moveTo(a, b); x.lineTo(cc, d); x.stroke(); }
    x.globalAlpha = 0.5; x.fillStyle = col;
    for (let i = 0; i < 18; i++) x.fillRect((i * 37) % 120, (i * 53) % 56, 3, 3);
    const tex = new THREE.CanvasTexture(c);
    tex.transparent = true;
    grafCache.set(hex, tex);
    return tex;
  }

  /* ---- MERGED BOXES, WITHOUT THE BOXES ---------------------------------
     The deco path used to make a THREE.BoxGeometry per trim box (six
     buildPlane calls pushing into JS arrays, three typed-array copies, a
     translate through Vector3 + a normal-matrix inverse), then hand hundreds
     of them to BufferGeometryUtils.mergeBufferGeometries, which copies them
     all again. That was most of makeBuilding. This writes the merged
     geometry straight into its final typed arrays with the SAME arithmetic:
     BoxGeometry's buildPlane expressions (width/1, width/2, ix*seg - half,
     x*udir), Float32 storage, then Vector3.applyMatrix4's translation
     expression on the stored values, normals/uv/index off a real r128
     BoxGeometry template (the normal only depends on the signs of the dims).
     Same attribute order, same index type rule, same mergedUserData. */
  const _boxNrm = new Map();                 // sign pattern -> 72 normals (a real translated BoxGeometry's)
  let _boxUv = null, _boxIdx = null;
  function boxTemplate(bw, bh, bd) {
    const key = (bw > 0 ? 1 : 0) | (bh > 0 ? 2 : 0) | (bd > 0 ? 4 : 0) | (-bw > 0 ? 8 : 0) | (-bh > 0 ? 16 : 0) | (-bd > 0 ? 32 : 0);
    let n = _boxNrm.get(key);
    if (!n) {
      const g = new THREE.BoxGeometry(bw, bh, bd);
      g.translate(1.5, -2.25, 3.125);
      n = new Float32Array(g.attributes.normal.array);
      if (!_boxUv) { _boxUv = new Float32Array(g.attributes.uv.array); _boxIdx = Array.from(g.index.array); }
      _boxNrm.set(key, n);
      g.dispose();
    }
    return n;
  }
  const _bp = new Float64Array(3);
  // one buildPlane (gridX = gridY = 1), BoxGeometry's own expressions; writes
  // 4 vertices at `o` (float32 via the target array)
  function boxPlane(P, o, u, v, w, udir, vdir, width, height, depth) {
    const segmentWidth = width / 1, segmentHeight = height / 1;
    const widthHalf = width / 2, heightHalf = height / 2, depthHalf = depth / 2;
    for (let iy = 0; iy < 2; iy++) {
      const y = iy * segmentHeight - heightHalf;
      for (let ix = 0; ix < 2; ix++) {
        const x = ix * segmentWidth - widthHalf;
        _bp[u] = x * udir; _bp[v] = y * vdir; _bp[w] = depthHalf;
        P[o] = _bp[0]; P[o + 1] = _bp[1]; P[o + 2] = _bp[2];
        o += 3;
      }
    }
    return o;
  }
  // boxes: flat [lx, ly, lz, bw, bh, bd, ...]; n boxes. Returns the geometry
  // mergeBufferGeometries(boxes.map(BoxGeometry(bw,bh,bd).translate(lx,ly,lz))) returns.
  //
  // THE ARRAYS ARE WRITTEN THE FIRST TIME ANYBODY READS THEM. A building's
  // trim is one of these per colour, and most of them never need their
  // vertices in JS: the batch pass reads them once to merge them (and throws
  // them away), a slice or the streamed city prunes the far ones before that
  // (they were ~100 MB of arrays held by lot records in a far slice, and a
  // 285 MB garbage spike in the whole-city build), and the GPU reads what is
  // drawn. So the geometry keeps its box list (6 numbers a box instead of
  // ~800 bytes of vertices) and each attribute's `array` is an accessor that
  // runs the same arithmetic as before, once, on first read. Bounds are the
  // boxes' own, so pruning and culling never trigger it.
  function lazyAttr(Ctor, itemSize, count, get) {
    const a = new THREE.BufferAttribute(new Ctor(0), itemSize, false);
    a.count = count;
    let arr = null, done = false;
    Object.defineProperty(a, "array", { configurable: true, enumerable: true,
      get: function () { if (!done) { arr = get(); done = true; } return arr; },
      set: function (v) { arr = v; done = true; } });
    return a;
  }
  function mergedBoxGeometry(boxes, n) {
    const BX = Float64Array.from(boxes.length === n * 6 ? boxes : boxes.slice(0, n * 6));
    let built = null;
    function build() {
      if (built) return built;
      const P = new Float32Array(n * 72), N = new Float32Array(n * 72), U = new Float32Array(n * 48);
      const I = n * 24 - 1 > 65535 ? new Uint32Array(n * 36) : new Uint16Array(n * 36);
      boxTemplate(BX[3], BX[4], BX[5]);
      const tu = _boxUv, ti = _boxIdx;
      for (let b = 0; b < n; b++) {
        const k = b * 6, lx = BX[k], ly = BX[k + 1], lz = BX[k + 2];
        const bw = BX[k + 3], bh = BX[k + 4], bd = BX[k + 5];
        const o0 = b * 72;
        let o = o0;
        o = boxPlane(P, o, 2, 1, 0, -1, -1, bd, bh, bw);     // px
        o = boxPlane(P, o, 2, 1, 0, 1, -1, bd, bh, -bw);     // nx
        o = boxPlane(P, o, 0, 2, 1, 1, 1, bw, bd, bh);       // py
        o = boxPlane(P, o, 0, 2, 1, 1, -1, bw, bd, -bh);     // ny
        o = boxPlane(P, o, 0, 1, 2, 1, -1, bw, bh, bd);      // pz
        o = boxPlane(P, o, 0, 1, 2, -1, -1, bw, bh, -bd);    // nz
        // translate: Vector3.applyMatrix4 with makeTranslation(lx, ly, lz),
        // element by element, on the stored float32 values
        for (let i = o0; i < o; i += 3) {
          const x = P[i], y = P[i + 1], z = P[i + 2];
          const w = 1 / (0 * x + 0 * y + 0 * z + 1);
          P[i] = (1 * x + 0 * y + 0 * z + lx) * w;
          P[i + 1] = (0 * x + 1 * y + 0 * z + ly) * w;
          P[i + 2] = (0 * x + 0 * y + 1 * z + lz) * w;
        }
        N.set(boxTemplate(bw, bh, bd), o0);
        U.set(tu, b * 48);
        const io = b * 36, vo = b * 24;
        for (let j = 0; j < 36; j++) I[io + j] = ti[j] + vo;
      }
      built = { P: P, N: N, U: U, I: I };
      return built;
    }
    const g = new THREE.BufferGeometry();
    const nv = n * 24;
    /* THE BATCH PASS READS THE BOXES, NOT THE ARRAYS (core/batch.js): one box
       at a time into a 24-vertex scratch, the same float32 arithmetic as
       build() above, so a trim geometry that is merged away never allocates
       its own arrays at all (they were ~285 MB of build garbage citywide). */
    g._cbzBoxSource = {
      n: n, idx: null,
      built: function () { return built !== null; },
      box: function (b, P, N) {
        if (!_boxUv) boxTemplate(BX[3], BX[4], BX[5]);
        const k = b * 6, lx = BX[k], ly = BX[k + 1], lz = BX[k + 2];
        const bw = BX[k + 3], bh = BX[k + 4], bd = BX[k + 5];
        let o = 0;
        o = boxPlane(P, o, 2, 1, 0, -1, -1, bd, bh, bw);
        o = boxPlane(P, o, 2, 1, 0, 1, -1, bd, bh, -bw);
        o = boxPlane(P, o, 0, 2, 1, 1, 1, bw, bd, bh);
        o = boxPlane(P, o, 0, 2, 1, 1, -1, bw, bd, -bh);
        o = boxPlane(P, o, 0, 1, 2, 1, -1, bw, bh, bd);
        o = boxPlane(P, o, 0, 1, 2, -1, -1, bw, bh, -bd);
        for (let i = 0; i < o; i += 3) {
          const x = P[i], y = P[i + 1], z = P[i + 2];
          const w = 1 / (0 * x + 0 * y + 0 * z + 1);
          P[i] = (1 * x + 0 * y + 0 * z + lx) * w;
          P[i + 1] = (0 * x + 1 * y + 0 * z + ly) * w;
          P[i + 2] = (0 * x + 0 * y + 1 * z + lz) * w;
        }
        N.set(boxTemplate(bw, bh, bd), 0);
        return _boxIdx;
      },
    };
    g.setIndex(lazyAttr(nv - 1 > 65535 ? Uint32Array : Uint16Array, 1, n * 36, function () { return build().I; }));
    g.setAttribute("position", lazyAttr(Float32Array, 3, nv, function () { return build().P; }));
    g.setAttribute("normal", lazyAttr(Float32Array, 3, nv, function () { return build().N; }));
    g.setAttribute("uv", lazyAttr(Float32Array, 2, nv, function () { return build().U; }));
    // bounds from the boxes themselves (what computeBoundingBox would find)
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let b = 0; b < n; b++) {
      const k = b * 6, hx = Math.abs(BX[k + 3]) / 2, hy = Math.abs(BX[k + 4]) / 2, hz = Math.abs(BX[k + 5]) / 2;
      if (BX[k] - hx < x0) x0 = BX[k] - hx; if (BX[k] + hx > x1) x1 = BX[k] + hx;
      if (BX[k + 1] - hy < y0) y0 = BX[k + 1] - hy; if (BX[k + 1] + hy > y1) y1 = BX[k + 1] + hy;
      if (BX[k + 2] - hz < z0) z0 = BX[k + 2] - hz; if (BX[k + 2] + hz > z1) z1 = BX[k + 2] + hz;
    }
    g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    return g;
  }

  // ---- the enterable building (one group; switchback stairs to the roof) ----
  // opts: { boarded:bool (board windows instead of glass), grime:bool }
  function makeBuilding(root, ox, oz, w, d, storeys, color, doorSide, opts) {
    // PER-SHELL STOREY HEIGHT. Every ordinary lot keeps the 3.2 m metre
    // contract; a landmark that is MEANT to be taller per floor (a head of
    // state's residence, whose state rooms stand 4-5 m) passes `opts.fh`.
    // Shadowing FH here moves every derived dimension of this one shell with
    // it, and the record carries it out as `FH`, which occupy.js, the stair
    // core, the fitout, structural.js and the interior programs already read.
    const FH = (opts && opts.fh > 2.4 && opts.fh < 8) ? +opts.fh : FH_STD;
    opts = opts || {};
    const bgroup = new THREE.Group();
    bgroup.position.set(ox, 0, oz);
    root.add(bgroup);
    // losMeshes/doorRecs: per-building mirrors of the global CBZ.losBlockers /
    // cityDoors registrations (cols/plats already mirror CBZ.colliders/platforms).
    // Without these a demolished building would leave ghost LOS blockers
    // (Raycaster hits meshes regardless of scene membership) and a phantom
    // swinging door. demolition reads b.losMeshes / b.doors to splice them.
    const cols = [], plats = [], windows = [], losMeshes = [], doorRecs = [];
    const ixMin = -w / 2 + WT, ixMax = w / 2 - WT;
    const izMin = -d / 2 + WT, izMax = d / 2 - WT;
    const localDoor = doorInfo(0, 0, w, d, doorSide);
    // DISTRICT MATERIAL KIT (opts.district — threaded in by cityBuildings via
    // districtKind(lot)): wall hue-lock, glass-tint bias, facade terminal
    // weights. Falls back to a neutral kit for callers that don't pass one
    // (island/expansion buildings, etc.) so nothing regresses.
    const DKIT = DISTRICT_KITS[opts.district] || DEFAULT_KIT;

    // per-building deterministic VARIETY seed (glass tint, parapet height) —
    // derived from the lot position so the same lot reads the same every run.
    const vhash = Math.abs(Math.sin(ox * 12.9898 + oz * 78.233) * 43758.5453) % 1;
    const tintIdx = (((vhash * 7.13) | 0) + (DKIT.glassTintBias || 0)) % GLASS_TINTS;
    // GLASS KIND: retail/showrooms = CLEAR (see-through storefronts, always);
    // everything else (offices/apartments) = REFLECTIVE (mirror-ish until shot).
    // opts.glassKind overrides. City-only opts, default falsy elsewhere.
    const GKIND = opts.glassKind ? opts.glassKind : ((opts.retail || opts.showroom) ? "clear" : "reflective");

    // ===== FACADE TYPE =======================================================
    // FIVE archetypes now, not two (BLD_MASONRY_V1 — owner: "make new building
    // types like gov buildings and brick buildings"):
    //   office / retail  — the proven glass curtain-wall shells (unchanged)
    //   brick            — punched masonry: brick piers between real punched
    //                      windows, stone sills + lintels, muntins. This is the
    //                      grammar that has sat DEAD in this file behind
    //                      `const punched = false` since the giant brown
    //                      envelopes were pulled; it is revived here in a
    //                      DISCIPLINED form (see the punched branch below: a
    //                      curated masonry colourway, real string courses and a
    //                      corbelled cornice instead of a flat brown box).
    //   civic            — government/monumental: ashlar stone, tall
    //                      symmetrical bays on a pilaster order, entablature.
    //   fortified        — bank/security: heavier wall, narrow security slots.
    // `residential` remains an accepted alias, now routed to brick rather than
    // silently downgraded to office.
    //
    // ONE-LINE REVERT: CBZ.CONFIG.BLD_MASONRY_V1 = false (or
    // ?cfg_BLD_MASONRY_V1=0) collapses every masonry request back to the exact
    // prior office/retail shell — the hard-off guard the old code had, kept as
    // a flag instead of a literal.
    const MASONRY_ON = !(CBZ.CONFIG && CBZ.CONFIG.BLD_MASONRY_V1 === false);
    let FACADE = opts.facade ||
      (opts.retail || opts.showroom ? "retail"
        : "office");
    if (FACADE === "residential") FACADE = MASONRY_ON ? "brick" : "office";
    // A civic owner may opt one landmark back into the monumental grammar
    // without reviving the retired citywide brick/masonry pass. This is the
    // narrow seam used by the Executive Mansion: a declared dome and Doric
    // order must not collapse into a curtain-wall office merely because
    // residential masonry is disabled globally.
    const landmarkCivic = FACADE === "civic" && opts.civic && opts.civic.monumental === true;
    if (!MASONRY_ON && !landmarkCivic &&
        (FACADE === "brick" || FACADE === "civic" || FACADE === "fortified")) FACADE = "office";
    // (A 45% position-hashed "masonry share" for callers with no facade
    // preference used to flip town shells to punched brick one by one. The
    // facade kit's neighbourhood pick — facadeAutoDress, below — now decides
    // what a street is built of, for the whole street at once.)
    const punched = FACADE === "brick";
    const civicF = FACADE === "civic";
    const fortified = FACADE === "fortified";
    const MASONRY = punched || civicF || fortified;
    // MASONRY PALETTE — a SMALL fixed colourway set (world/textures_masonry.js)
    // deliberately shared city-wide so the flat structural walls still bucket
    // together for core/batch.js. Position-hashed pick (never rng), so lot #23's
    // brick colour is decidable without building lots 0..22.
    const civicSpec = opts.civic || null;
    // FACADE KIT: does the requested facade crown the roof? This has to be
    // answered HERE, before the roofline code below, because the shell decides
    // its own setback crown and corner finials long before dressFacade() runs.
    // A dome, a minaret, a mansard or a setback tower must not have the host's
    // own spire growing up through it.
    // THE GRAMMAR THIS SHELL WEARS, decided once, here. An explicit spec (or
    // `false`) from the call site wins; otherwise facade_kit.js's coherent
    // neighbourhood pick. Recorded on the built record as `dress`, so
    // structural.js / collapse.js ask facadePick the same question and get
    // the same answer.
    const DRESS = opts.dress === false ? false
      : (opts.dress || (CBZ.facadeAutoDress ? CBZ.facadeAutoDress(ox, oz, storeys,
          opts.showroom || opts.garageGround ? "showroom" : opts.retail ? "shop" : null) : null));
    const facadeTakesRoof = !!(CBZ.facadeCrownsRoof && CBZ.facadeCrownsRoof(DRESS,
      function (salt) { return CBZ.hash01 ? CBZ.hash01(ox, oz, salt) : 0.42; }, storeys));
    let MPAL = null;
    if (MASONRY && CBZ.masonryPalette) {
      // ashlar STONE for the monumental trades; the humbler civic kinds that
      // declare stone:false (a records office, a fire house) are brick, because
      // that is what the real ones are built of.
      const fam = (civicSpec && civicSpec.stone === false) ? "brick"
        : ((civicF || fortified || (civicSpec && civicSpec.stone)) ? "ashlar" : "brick");
      const cwid = opts.masonry || (CBZ.masonryPick ? CBZ.masonryPick(fam, ox, oz, 0xb21c) : null);
      if (cwid) MPAL = CBZ.masonryPalette(cwid);
    }
    // DISTRICT WALL KIT: hue-locked jitter so buildings in the same district
    // read as a coherent palette family (core cool/clean, projects/industrial
    // grimier/desaturated) while still varying building-to-building. Applied
    // only when a district was actually threaded in, so callers that don't
    // pass one (island buildings, the flagship's raw 0x223040, etc.) render
    // exactly as before. MASONRY buildings skip it: their colourway IS the
    // curated family, and jittering it would break the wall↔veneer colour match
    // the batching split depends on.
    if (MPAL) color = MPAL.wall;
    else if (opts.district) color = districtWallColor(color, DKIT, ox, oz);
    // trim palette: darks derived from the wall colour (shared palettes →
    // shared colour buckets, so the batcher still collapses trim city-wide)
    const MULL = 0x262b31;                 // mullion-frame dark
    const SKY = 0xd6e6f2;                  // interior window "daylight" backing —
    // the wall behind every pane is a SOLID box, so without this bright slab a
    // window reads as blank wall from INSIDE the room. One extra colour bucket
    // in the merged deco pass (≈1 mesh/building pre-batch), it scene-lights
    // down with the sun so night interiors dim naturally.
    // MASONRY swaps the trim family from "a darker shade of the wall" to a
    // genuinely CONTRASTING stone — the single strongest cue that a wall is
    // brick with stone dressings rather than one painted colour. Still a
    // SHARED palette entry (six colourways, six trim buckets), so the batcher
    // collapses trim city-wide exactly as before.
    const TRIM = MPAL ? MPAL.stone : shadeHex(color, 0.72);    // cornice / sill / parapet coping
    const BASE = MPAL ? shadeHex(MPAL.stone, 0.80) : shadeHex(color, 0.55);   // ground-floor plinth
    const PIL = MPAL ? shadeHex(MPAL.stone, 0.92) : shadeHex(color, 0.85);    // corner pilasters
    const REVEAL = shadeHex(color, 1.12);  // bright window-reveal liner (catches light in the recess)

    // FACADE DECO accumulator: every flat opaque dressing box (mullion frames,
    // cornices, plinth, pilasters, coping) is collected as raw geometry and
    // merged into ONE mesh per colour via the vendored BufferGeometryUtils —
    // a whole building's trim lands as 2-4 meshes pre-batch, and core/batch.js
    // then merges those across buildings at load. Falls back to individual
    // meshes (still batch-merged later) if the vendor script is missing.
    // per colour: flat [lx, ly, lz, bw, bh, bd, ...] (see mergedBoxGeometry)
    const decoGeos = new Map();
    function dbox(lx, ly, lz, bw, bh, bd, col) {
      let arr = decoGeos.get(col);
      if (!arr) { arr = []; decoGeos.set(col, arr); }
      arr.push(lx, ly, lz, bw, bh, bd);
    }
    function flushDeco() {
      const BGU = THREE.BufferGeometryUtils;
      decoGeos.forEach(function (boxes, col) {
        const matD = CBZ.cmat ? CBZ.cmat(col) : mat(col);
        const n = boxes.length / 6;
        if (BGU && BGU.mergeBufferGeometries && n > 1) {
          const m = new THREE.Mesh(mergedBoxGeometry(boxes, n), matD);
          m.castShadow = false; m.receiveShadow = true;
          bgroup.add(m);
        } else {
          for (let k = 0; k < boxes.length; k += 6) {
            const g = new THREE.BoxGeometry(boxes[k + 3], boxes[k + 4], boxes[k + 5]);
            g.translate(boxes[k], boxes[k + 1], boxes[k + 2]);
            const m = new THREE.Mesh(g, matD);
            m.castShadow = false; m.receiveShadow = true; bgroup.add(m);
          }
        }
      });
      decoGeos.clear();
    }

    // ---- MASONRY VENEER (BLD_MASONRY_TEXTURE) -------------------------------
    // Stamps a grid of ~1.6×0.8m brick/ashlar tiles across ONE solid face band.
    // Tiles ride the shared InstancedMesh pools (see addMasonryTile at the top
    // of this file) — the ONLY textured surfaces a building emits, precisely
    // because core/batch.js cannot merge a textured material. They sit 0.03
    // proud of the wall's outer plane, so nothing is coplanar (no z-fighting)
    // and the stone string courses / sills stay proud of the brick, as built.
    const VENEER_ON = !!MPAL && !!CBZ.masonryTile && !!CBZ.masonryMat
      && !(CBZ.CONFIG && CBZ.CONFIG.BLD_MASONRY_TEXTURE === false);
    // solid band heights the masonry branches below share with the veneer, so
    // the brick always lands exactly on wall and never across a window.
    const MSILL = civicF ? 1.15 : 1.05;    // solid spandrel, floor → window sill
    const MHDR = fortified ? 0.45 : (civicF ? 0.85 : 0.7);   // solid header, window head → ceiling
    function veneerBand(s, y0, y1, skipHalf) {
      if (!VENEER_ON || y1 - y0 < 0.25) return;
      const TL = CBZ.masonryTile;
      const horiz = (s === 0 || s === 1), outS = (s === 0 || s === 2) ? -1 : 1;
      const span = horiz ? w : d, halfN = (horiz ? d : w) / 2;
      const cols = Math.max(1, Math.round(span / TL.w));
      const rows = Math.max(1, Math.round((y1 - y0) / TL.h));
      const tw = span / cols, th = (y1 - y0) / rows;
      const nOff = outS * (halfN + 0.03);
      for (let i = 0; i < cols; i++) {
        const t = -span / 2 + (i + 0.5) * tw;
        if (skipHalf && Math.abs(t) < skipHalf + tw * 0.5) continue;   // keep the doorway clear
        for (let r = 0; r < rows; r++) {
          const cy = y0 + (r + 0.5) * th;
          if (horiz) addMasonryTile(bgroup, t, cy, nOff, tw, th, 0.06, MPAL.id, ox, oz);
          else addMasonryTile(bgroup, nOff, cy, t, 0.06, th, tw, MPAL.id, ox, oz);
        }
      }
    }

    // Interior decoration is allowed only outside the entrance aisle and the
    // dedicated stairwell. The aisle reaches from just outside the door into
    // the room so furniture never makes an enterable building feel blocked.
    // shaftRects: building-local rects reserved by an elevator shaft (filled in
    // by CBZ.cityCarveShaft); furnishing/props gate off these too. Declared up
    // here so clearFloorPoint closes over the SAME array the return object exposes.
    const shaftRects = [];
    // keepRects: floor you WALK through but nothing may stand on — the landing
    // in front of the stair core's door on every floor (see cityStairPlan).
    // Unlike a shaft it is floored, so fit-out floor planes still cover it.
    const keepRects = [];
    function clearFloorPoint(lx, lz, pad) {
      pad = pad == null ? 0.8 : pad;
      const dx = lx - localDoor.x, dz = lz - localDoor.z;
      const inward = dx * localDoor.nx + dz * localDoor.nz;
      const cross = Math.abs(dx * localDoor.nz - dz * localDoor.nx);
      if (inward > -0.8 && inward < 4.8 && cross < DOORW / 2 + pad) return false;
      // RESERVED footprints (building-local rects): the lift chase stamped by
      // CBZ.cityCarveShaft, and the stair core + its landing, reserved the
      // moment the shell is made (cityStairPlan, bottom of makeBuilding) so
      // every eager furnisher and the lift's lobby pick already stay out of it.
      for (let i = 0; i < shaftRects.length; i++) {
        const r = shaftRects[i];
        if (lx > r.x0 - pad && lx < r.x1 + pad && lz > r.z0 - pad && lz < r.z1 + pad) return false;
      }
      for (let i = 0; i < keepRects.length; i++) {
        const r = keepRects[i];
        if (lx > r.x0 - pad && lx < r.x1 + pad && lz > r.z0 - pad && lz < r.z1 + pad) return false;
      }
      return lx > ixMin + pad && lx < ixMax - pad && lz > izMin + pad && lz < izMax - pad;
    }

    /* NOTHING IS DRAWN IN A STAIRWELL. OWNER: "when you walk through the
       stairs, you have to go through the floor". A reserved hole (a stair
       core, a lift chase, a grand stair's opening: b.shaftRects, optionally
       limited to the slab `levels` it opens) had only the SLAB taken out of
       it; every box a program drew afterwards in that slab's band — the
       floor covering of the storey above, a rug, the coffers, cornice and
       chandeliers of the storey below — still spanned the opening, and the
       climb went through them. So the one box primitive clips: a box lying
       wholly inside a slab's band (1.35 m under the slab .. 0.4 m over it)
       loses the part over the hole (split into up to four rim boxes, the
       way cityCarveShaft splits the slab). The stair itself passes
       o.stair, structure (o.los) is never touched, and a shell with no
       reserved hole never pays for the test. */
    function holeClip(lx, lz, bw, bd, yb, yt) {
      let parts = null;
      for (let i = 0; i < shaftRects.length; i++) {
        const r = shaftRects[i];
        if (lx + bw / 2 <= r.x0 || lx - bw / 2 >= r.x1 || lz + bd / 2 <= r.z0 || lz - bd / 2 >= r.z1) continue;
        let hit = false;
        const lv = r.levels;
        const nL = lv ? lv.length : storeys - 1;
        for (let j = 0; j < nL && !hit; j++) {
          const L = lv ? lv[j] : j + 1;
          const top = L * FH;
          if (yb >= top - 1.35 && yt <= top + 0.4) hit = true;
        }
        if (!hit) continue;
        if (!parts) parts = [{ x0: lx - bw / 2, x1: lx + bw / 2, z0: lz - bd / 2, z1: lz + bd / 2 }];
        const next = [];
        for (const p of parts) {
          if (p.x1 <= r.x0 || p.x0 >= r.x1 || p.z1 <= r.z0 || p.z0 >= r.z1) { next.push(p); continue; }
          const cx0 = Math.max(r.x0, p.x0), cx1 = Math.min(r.x1, p.x1), cz0 = Math.max(r.z0, p.z0), cz1 = Math.min(r.z1, p.z1);
          for (const q of [[p.x0, p.x1, p.z0, cz0], [p.x0, p.x1, cz1, p.z1], [p.x0, cx0, cz0, cz1], [cx1, p.x1, cz0, cz1]])
            if (q[1] - q[0] > 0.02 && q[3] - q[2] > 0.02) next.push({ x0: q[0], x1: q[1], z0: q[2], z1: q[3] });
        }
        parts = next;
      }
      return parts;
    }
    function lbox(lx, ly, lz, bw, bh, bd, col, o) {
      o = o || {};
      if (shaftRects.length && !o.stair && !o.los && !o._clipped) {
        const parts = holeClip(lx, lz, bw, bd, ly - bh / 2, ly + bh / 2);
        if (parts) {
          const o2 = Object.assign({}, o, { _clipped: true });
          let first = null;
          for (const p of parts) {
            const m = lbox((p.x0 + p.x1) / 2, ly, (p.z0 + p.z1) / 2, p.x1 - p.x0, bh, p.z1 - p.z0, col, o2);
            if (!first) first = m;
          }
          // wholly over the hole: a mesh that is in no scene, so a caller that
          // keeps the handle (a light strip, a collider ref) holds nothing drawn
          return first || new THREE.Mesh(unitBoxGeo(false, false), CBZ.cmat(col));
        }
      }
      // fake-AO vertex shading on structural LOS surfaces (walls/roofs/rims) —
      // exactly the meshes batch.js spares, so the colour attribute survives
      let mm;
      if (o.emissive) {
        mm = mat(col, { emissive: o.emissive, ei: o.ei || 0.5 });
        if (o.los) mm.vertexColors = true;
      } else mm = o.mat || (o.los ? vcMat(col) : CBZ.cmat(col));
      const m = new THREE.Mesh(unitBoxGeo(!!o.los, ly - bh / 2 <= 0.2), mm);
      m.position.set(lx, ly, lz);
      m.scale.set(bw, bh, bd);
      m.castShadow = o.cast !== false; m.receiveShadow = true;
      bgroup.add(m);
      if (o.solid) {
        const c = { minX: ox + lx - bw / 2, maxX: ox + lx + bw / 2, minZ: oz + lz - bd / 2, maxZ: oz + lz + bd / 2, ref: m, y0: ly - bh / 2, y1: ly + bh / 2 };
        CBZ.colliders.push(c); cols.push(c);
      }
      if (o.plat) { const p = { minX: ox + lx - bw / 2, maxX: ox + lx + bw / 2, minZ: oz + lz - bd / 2, maxZ: oz + lz + bd / 2, top: ly + bh / 2 }; CBZ.platforms.push(p); plats.push(p); }
      if (o.los) { CBZ.losBlockers.push(m); losMeshes.push(m); }
      return m;
    }

    // foundation floor slab — its TOP must sit ABOVE the lot's grass yard pad
    // (world.js draws a grass plane at y≈0.10 on every lot) or you'd see grass
    // through the ground floor. Top at 0.14 (a tiny doorway step the forgiving
    // auto-climb absorbs) covers the lawn so the interior reads as a real floor.
    lbox(0, -0.21, 0, w - WT, 0.7, d - WT, opts.boarded ? 0x40433f : 0x5c626b, { plat: true });

    // doorSide: 0=-z (front), 1=+z, 2=-x, 3=+x. Door pierces the ground floor.
    const wallOpt = { solid: true, los: true };
    const modern = storeys >= 3;   // tall towers get fuller, near floor-to-ceiling glass

    // DOOR CASING helpers (Sub-idea B: seal the gap around the swinging door).
    // makeDoorPanel hangs a leaf sized dw=DOORW-0.16 wide × dh=DOORH-0.15 tall so
    // it can swing without binding; that leaves a thin see-through slit down each
    // jamb and across the head of the DOORW×DOORH wall opening. These fill those
    // slits with slim solid casing (jambs + lintel) flush to the street face so
    // the surround reads as a framed doorway, not an open gap. The leaf still
    // swings INWARD into the room, clear of this exterior-plane casing.
    const DLEAF_W = DOORW - 0.16;     // must match makeDoorPanel leaf width
    const DLEAF_H = (DOORH + 0.7) - 0.85;   // must match makeDoorPanel leaf height (DOORH-0.15)
    const DJAMB = 0.18;               // casing reveal width (covers the ~0.08 slit + reads as trim)
    function doorFrameHoriz(fz) {
      const jx = (DLEAF_W / 2 + DJAMB / 2);   // jamb centre, just outside the leaf edge
      lbox(-jx, DLEAF_H / 2 + 0.02, fz, DJAMB, DLEAF_H + 0.04, WT, color, { los: true });   // left jamb
      lbox(jx, DLEAF_H / 2 + 0.02, fz, DJAMB, DLEAF_H + 0.04, WT, color, { los: true });    // right jamb
      // lintel: from the leaf top up to the wall header bottom (DOORH), full DOORW
      lbox(0, (DLEAF_H + DOORH) / 2, fz, DOORW, DOORH - DLEAF_H, WT, color, { los: true });
      // a slim casing lip proud of the street face so the doorway reads framed.
      const fzo = fz + ((f0Out(fz)) * (WT / 2 + 0.04));
      dbox(0, DOORH + 0.06, fzo, DOORW + 0.3, 0.14, 0.1, TRIM);   // lintel cap
      dbox(-DOORW / 2 - 0.07, DOORH / 2, fzo, 0.12, DOORH, 0.1, TRIM);   // casing reveals
      dbox(DOORW / 2 + 0.07, DOORH / 2, fzo, 0.12, DOORH, 0.1, TRIM);
    }
    function doorFrameVert(fx) {
      const jz = (DLEAF_W / 2 + DJAMB / 2);
      lbox(fx, DLEAF_H / 2 + 0.02, -jz, WT, DLEAF_H + 0.04, DJAMB, color, { los: true });
      lbox(fx, DLEAF_H / 2 + 0.02, jz, WT, DLEAF_H + 0.04, DJAMB, color, { los: true });
      lbox(fx, (DLEAF_H + DOORH) / 2, 0, WT, DOORH - DLEAF_H, DOORW, color, { los: true });
      const fxo = fx + (f0OutX(fx) * (WT / 2 + 0.04));
      dbox(fxo, DOORH + 0.06, 0, 0.1, 0.14, DOORW + 0.3, TRIM);
      dbox(fxo, DOORH / 2, -DOORW / 2 - 0.07, 0.1, DOORH, 0.12, TRIM);
      dbox(fxo, DOORH / 2, DOORW / 2 + 0.07, 0.1, DOORH, 0.12, TRIM);
    }
    // street-facing sign for a ±z / ±x face (door is on side 0/1 → z, 2/3 → x).
    function f0Out(fz) { return fz < 0 ? -1 : 1; }
    function f0OutX(fx) { return fx < 0 ? -1 : 1; }

    // GRID GLASS (Sub-idea C, for the ground-floor storefronts/showrooms/garage
    // and the glass-loft caller below): split a single wide solid glass span into
    // a mullion grid of individual breakable panes on a ~1.5m module, so one shot
    // takes out one cell, not the whole storefront. `horizFace` true = the pane
    // faces ±z (thin in z, given as pw×ph×t); false = faces ±x (thin in x). cx/cy/
    // cz is the span CENTRE; spanW is the wide dimension (x or z by face), spanH
    // the height, t the pane thickness. opts forwarded to addCityGlass.
    function gridGlass(cx, cy, cz, spanW, spanH, t, horizFace, opts) {
      const MOD = 1.5;
      const nx = Math.max(1, Math.min(10, Math.round(spanW / MOD)));
      const ny = Math.max(1, Math.min(3, Math.round(spanH / MOD)));
      const pw = spanW / nx, ph = spanH / ny;
      for (let gx = 0; gx < nx; gx++) for (let gy = 0; gy < ny; gy++) {
        const o2 = -spanW / 2 + (gx + 0.5) * pw, py = cy + (-spanH / 2 + (gy + 0.5) * ph);
        if (horizFace) addCityGlass(bgroup, cx + o2, py, cz, pw, ph, t, ox, oz, opts, windows);
        else addCityGlass(bgroup, cx, py, cz + o2, t, ph, pw, ox, oz, opts, windows);
      }
    }

    // SHOWROOM GARAGE FRONT (gas / car lot / chop shop): no plain door — a wide
    // roll-up GARAGE BAY you drive a car straight into, framed by big SOLID
    // showroom glass that shatters into a drive-through hole if you smash it.
    function showroomFront(f) {
      const ly = FH / 2;
      const GW = Math.min(3.6, (f.horiz ? w : d) * 0.42);   // garage opening width
      const HDR = FH - 0.9;                                   // header bottom
      const glassY = HDR / 2;                                 // bottom = 0, top = HDR
      if (f.horiz) {
        const zz = f.z, off = (f.s === 0 ? 0.06 : -0.06);
        lbox(-w / 2 + 0.35, ly, zz, 0.7, FH, WT, color, wallOpt);
        lbox(w / 2 - 0.35, ly, zz, 0.7, FH, WT, color, wallOpt);
        // One continuous head beam carries the whole frontage: garage lintel
        // plus both glass bays. The former garage-only header left the panes
        // ending in open air at their top edge.
        lbox(0, HDR + (FH - HDR) / 2, zz, w - 0.7, FH - HDR, WT, color, { solid: true, los: true });
        lbox(0, HDR - 0.5, zz + off, GW - 0.3, 0.9, 0.14, 0x8a93a0, { cast: false });                   // rolled-up door
        for (let s = 0; s < 4; s++) lbox(0, HDR - 0.2 - s * 0.2, zz + off * 1.2, GW - 0.4, 0.05, 0.18, 0x6b7480, { cast: false });
        const a = -w / 2 + 0.7, bb = -GW / 2 - 0.15, cxL = (a + bb) / 2, wL = bb - a;
        gridGlass(cxL, glassY, zz, wL, HDR, 0.07, true, { solid: true, kind: "clear", role: "showroom" });
        gridGlass(-cxL, glassY, zz, wL, HDR, 0.07, true, { solid: true, kind: "clear", role: "showroom" });
      } else {
        const xx = f.x, off = (f.s === 2 ? 0.06 : -0.06);
        lbox(xx, ly, -d / 2 + 0.35, WT, FH, 0.7, color, wallOpt);
        lbox(xx, ly, d / 2 - 0.35, WT, FH, 0.7, color, wallOpt);
        lbox(xx, HDR + (FH - HDR) / 2, 0, WT, FH - HDR, d - 0.7, color, { solid: true, los: true });
        lbox(xx + off, HDR - 0.5, 0, 0.14, 0.9, GW - 0.3, 0x8a93a0, { cast: false });
        for (let s = 0; s < 4; s++) lbox(xx + off * 1.2, HDR - 0.2 - s * 0.2, 0, 0.18, 0.05, GW - 0.4, 0x6b7480, { cast: false });
        const a = -d / 2 + 0.7, bb = -GW / 2 - 0.15, czL = (a + bb) / 2, dL = bb - a;
        gridGlass(xx, glassY, czL, dL, HDR, 0.07, false, { solid: true, kind: "clear", role: "showroom" });
        gridGlass(xx, glassY, -czL, dL, HDR, 0.07, false, { solid: true, kind: "clear", role: "showroom" });
      }
    }

    // RETAIL STOREFRONT (clothing / food / electronics / etc.): the showroom
    // look minus the garage roll-up — corner posts, a slim header, and a WIDE
    // see-through (clear, pooled) glass span flanking the swinging door, plus a
    // floor read so the interior is visibly a ROOM through the glass, ALWAYS
    // (not only after shooting). The hollow shell + furnishShop already supply
    // the room behind it. makeDoorPanel still hangs the openable door.
    function retailFront(f) {
      const ly = FH / 2;
      const HDR = FH - 1.0;                                   // header bottom (~1.0m header)
      const gph = HDR;                                        // glass rises to the header
      const gy = ly - (FH - HDR) / 2;                          // glass band centred under the header
      if (f.horiz) {
        const zz = f.z;
        lbox(-w / 2 + 0.35, ly, zz, 0.7, FH, WT, color, wallOpt);   // corner posts
        lbox(w / 2 - 0.35, ly, zz, 0.7, FH, WT, color, wallOpt);
        lbox(0, HDR + (FH - HDR) / 2, zz, w - 1.0, FH - HDR, WT, color, { solid: true, los: true });   // header over the top
        // DOOR SURROUND: seal the slits around the swinging leaf (jambs + lintel),
        // tight to the leaf — owner-filmed diner door gap. The leaf still swings.
        doorFrameHoriz(zz);
        // the retail header band starts at HDR; the doorFrame lintel tops out at
        // DOORH (<HDR) → fill the strip over the door so it isn't see-through.
        if (HDR > DOORH + 0.02) lbox(0, (DOORH + HDR) / 2, zz, DOORW, HDR - DOORH, WT, color, { solid: true, los: true });
        const osn = (f.s === 0 ? -1 : 1);                     // toward the street
        const goff = osn * (WT / 2 + 0.06);
        // FLANK GLASS spans EDGE-TO-EDGE between the door jamb and the corner post
        // (showroom-clean): the flank runs DOORW/2 → w/2-0.7, exact width `side`.
        // The OLD `side*0.86` shrink left a see-through strip at BOTH the door and
        // the corner (owner-filmed gaps); span the full `side` to seal them.
        const side = (w - DOORW) / 2 - 0.7;                   // glass span each side of the door gap
        if (side > 1.0) {
          const fcx = -(DOORW / 2 + side / 2), fcx2 = DOORW / 2 + side / 2;
          for (const fc of [fcx, fcx2]) {
            gridGlass(fc, gy, zz + goff, side, gph, 0.05, true, { solid: true, tint: tintIdx, kind: "clear", role: "storefront" });
          }
        } else {
          // too narrow to glaze cleanly: seal each flank with a solid wall span so
          // the corner stays closed (no see-through hole at the building edge).
          const flw = (w - DOORW) / 2 - 0.7;
          if (flw > 0.05) for (const fc of [-(DOORW / 2 + flw / 2), DOORW / 2 + flw / 2])
            lbox(fc, ly, zz, flw, FH, WT, color, wallOpt);
        }
      } else {
        const xx = f.x;
        lbox(xx, ly, -d / 2 + 0.35, WT, FH, 0.7, color, wallOpt);
        lbox(xx, ly, d / 2 - 0.35, WT, FH, 0.7, color, wallOpt);
        lbox(xx, HDR + (FH - HDR) / 2, 0, WT, FH - HDR, d - 1.0, color, { solid: true, los: true });
        doorFrameVert(xx);   // seal the door surround (see doorFrameHoriz note)
        if (HDR > DOORH + 0.02) lbox(xx, (DOORH + HDR) / 2, 0, WT, HDR - DOORH, DOORW, color, { solid: true, los: true });
        const osn = (f.s === 2 ? -1 : 1);
        const goff = osn * (WT / 2 + 0.06);
        const side = (d - DOORW) / 2 - 0.7;
        if (side > 1.0) {
          const fcz = -(DOORW / 2 + side / 2), fcz2 = DOORW / 2 + side / 2;
          for (const fc of [fcz, fcz2]) {
            gridGlass(xx + goff, gy, fc, side, gph, 0.05, false, { solid: true, tint: tintIdx, kind: "clear", role: "storefront" });
          }
        } else {
          const flw = (d - DOORW) / 2 - 0.7;
          if (flw > 0.05) for (const fc of [-(DOORW / 2 + flw / 2), DOORW / 2 + flw / 2])
            lbox(xx, ly, fc, WT, FH, flw, color, wallOpt);
        }
      }
      // floor read so the interior reads as a real room through the clear glass
      lbox(0, 0.06, 0, w - 2 * WT, 0.08, d - 2 * WT, 0xc8ccd4, { cast: false });
      // keep the openable swinging door in the gap
      if (!opts.boarded) { const _dr = makeDoorPanel(bgroup, ox, oz, localDoor, DOORW); if (_dr) doorRecs.push(_dr); }
    }

    // WRAPAROUND PARKING DECK (opts.garageGround): the flagship's whole ground
    // floor is an open garage you can drive into from ANY side. Each face gets a
    // wide central drive-in bay (corner posts + a header to duck under) flanked
    // by floor-to-ceiling glass — so it reads as glassed-in parking on all four
    // sides, not a sealed lobby. No swinging door; the bays ARE the entrances.
    function garageBay(f) {
      const ly = FH / 2;
      const span = f.horiz ? w : d;
      const GW = Math.min(5.0, span * 0.52);     // drive-in opening width
      const HDR = FH - 0.85;                       // header bottom (clearance)
      const glassY = HDR / 2;                      // floor-to-head-beam glazing
      const post = 0.85;
      if (f.horiz) {
        const zz = f.z;
        lbox(-w / 2 + post / 2, ly, zz, post, FH, WT, color, wallOpt);
        lbox(w / 2 - post / 2, ly, zz, post, FH, WT, color, wallOpt);
        lbox(0, HDR + (FH - HDR) / 2, zz, w - post, FH - HDR, WT, color, { solid: true, los: true });
        const a = -w / 2 + post, bb = -GW / 2 - 0.2, cxL = (a + bb) / 2, wL = bb - a;
        if (wL > 0.5) {
          gridGlass(cxL, glassY, zz, wL, HDR, 0.06, true, { solid: true, kind: "clear", role: "garage-front" });
          gridGlass(-cxL, glassY, zz, wL, HDR, 0.06, true, { solid: true, kind: "clear", role: "garage-front" });
        }
      } else {
        const xx = f.x;
        lbox(xx, ly, -d / 2 + post / 2, WT, FH, post, color, wallOpt);
        lbox(xx, ly, d / 2 - post / 2, WT, FH, post, color, wallOpt);
        lbox(xx, HDR + (FH - HDR) / 2, 0, WT, FH - HDR, d - post, color, { solid: true, los: true });
        const a = -d / 2 + post, bb = -GW / 2 - 0.2, czL = (a + bb) / 2, dL = bb - a;
        if (dL > 0.5) {
          gridGlass(xx, glassY, czL, dL, HDR, 0.06, false, { solid: true, kind: "clear", role: "garage-front" });
          gridGlass(xx, glassY, -czL, dL, HDR, 0.06, false, { solid: true, kind: "clear", role: "garage-front" });
        }
      }
    }

    for (let k = 0; k < storeys; k++) {
      const ly = k * FH + FH / 2;
      const faces = [
        { s: 0, x: 0, z: -d / 2 + WT / 2, w: w, dd: WT, horiz: true },
        { s: 1, x: 0, z: d / 2 - WT / 2, w: w, dd: WT, horiz: true },
        // For ±x faces `w` is the wall's X thickness and `dd` is its Z span.
        // Do not feed `dd` into lbox's width slot: on a 34 m civic shell that
        // turns each side facade into a 34 m-thick slab across the whole room.
        { s: 2, x: -w / 2 + WT / 2, z: 0, w: WT, dd: d, horiz: false },
        { s: 3, x: w / 2 - WT / 2, z: 0, w: WT, dd: d, horiz: false },
      ];
      for (const f of faces) {
        if (opts.garageGround && k === 0) { garageBay(f); continue; }
        if (k === 0 && f.s === doorSide) {
          if (opts.showroom) {
            showroomFront(f);
          } else if (opts.retail && CBZ.game && CBZ.game.mode === "city") {
            retailFront(f);          // clear see-through storefront (room visible through glass, always)
          } else if (f.horiz) {
            const side = (w - DOORW) / 2;
            const fcx = -(DOORW / 2 + side / 2), fcx2 = DOORW / 2 + side / 2;
            lbox(0, (DOORH + FH) / 2, f.z, DOORW, FH - DOORH, WT, color, { los: true });   // door header
            // DOOR FRAME — seal the surround (owner-filmed: "the area around doors
            // is a gap"). The wall opening is DOORW×DOORH but the swinging leaf is
            // a touch smaller (dw=DOORW-0.16, dh=DOORH-0.15) so it can swing free —
            // leaving a see-through slit on both sides + over the top. Fill those
            // exact slits with slim solid jambs + a lintel (a real door casing),
            // tight to the leaf, so there's NO gap but the leaf still opens. The
            // jamb columns are 0.18m wide framing reveals (a hair wider than the
            // bare 0.08 slit so the casing reads as trim, not a hairline).
            doorFrameHoriz(f.z);
            // FLANKING WINDOWS as REAL framed openings (sill + header + outer
            // jamb around a GAP glazed with clear glass) so the furnished
            // ground-floor room shows through and a break opens into it — the
            // SAME see-through read as the upper storeys. (Was a SOLID full-
            // height wall + a fake SKY interior slab → "gray building behind"
            // when shot, user-filmed.)
            const sillH = 0.5, hdrH = 0.7, jamb = 0.5;
            const winY0 = ly - FH / 2 + sillH, winY1 = ly + FH / 2 - hdrH;
            const winCy = (winY0 + winY1) / 2, winPh = winY1 - winY0;
            const ostreet = (f.s === 0 ? -1 : 1);
            for (const fc of [fcx, fcx2]) {
              if (side <= 1.2) { lbox(fc, ly, f.z, side, FH, WT, color, wallOpt); continue; }   // too narrow to glaze
              const sgn = fc < 0 ? -1 : 1;                    // -1 = left flank
              lbox(fc, winY0 - sillH / 2, f.z, side, sillH, WT, color, wallOpt);   // sill
              lbox(fc, winY1 + hdrH / 2, f.z, side, hdrH, WT, color, wallOpt);     // header
              lbox(sgn * (w / 2 - jamb / 2), winCy, f.z, jamb, winPh, WT, color, wallOpt);   // outer jamb at the corner
              const span = side - jamb, gcx = fc - sgn * jamb / 2;
              gridGlass(gcx, winCy, f.z, span, winPh, 0.07, true, { solid: true, tint: tintIdx, kind: "clear" });
              const faceZ = f.z + ostreet * (WT / 2 + 0.04);
              const nn = Math.max(2, Math.min(5, Math.round(span / 1.6))), step = span / nn;
              for (let i = 1; i < nn; i++) dbox(gcx - span / 2 + i * step, winCy, faceZ, 0.07, winPh, 0.05, MULL);
            }
          } else {
            const side = (d - DOORW) / 2;
            const fcz = -(DOORW / 2 + side / 2), fcz2 = DOORW / 2 + side / 2;
            lbox(f.x, (DOORH + FH) / 2, 0, WT, FH - DOORH, DOORW, color, { los: true });   // door header
            doorFrameVert(f.x);   // seal the door surround (see doorFrameHoriz note)
            const sillH = 0.5, hdrH = 0.7, jamb = 0.5;
            const winY0 = ly - FH / 2 + sillH, winY1 = ly + FH / 2 - hdrH;
            const winCy = (winY0 + winY1) / 2, winPh = winY1 - winY0;
            const ostreet = (f.s === 2 ? -1 : 1);
            for (const fc of [fcz, fcz2]) {
              if (side <= 1.2) { lbox(f.x, ly, fc, WT, FH, side, color, wallOpt); continue; }
              const sgn = fc < 0 ? -1 : 1;
              lbox(f.x, winY0 - sillH / 2, fc, WT, sillH, side, color, wallOpt);
              lbox(f.x, winY1 + hdrH / 2, fc, WT, hdrH, side, color, wallOpt);
              lbox(f.x, winCy, sgn * (d / 2 - jamb / 2), WT, winPh, jamb, color, wallOpt);
              const span = side - jamb, gcz = fc - sgn * jamb / 2;
              gridGlass(f.x, winCy, gcz, span, winPh, 0.07, false, { solid: true, tint: tintIdx, kind: "clear" });
              const faceX = f.x + ostreet * (WT / 2 + 0.04);
              const nn = Math.max(2, Math.min(5, Math.round(span / 1.6))), step = span / nn;
              for (let i = 1; i < nn; i++) dbox(faceX, winCy, gcz - span / 2 + i * step, 0.05, winPh, 0.07, MULL);
            }
          }
          // hang an OPENABLE swinging glass door in the gap (real shops/homes
          // only — derelicts stay gaping). Abandoned (boarded) buildings skip it.
          // retailFront hangs its own door, so skip it here for city retail.
          const cityRetail = opts.retail && CBZ.game && CBZ.game.mode === "city";
          if (!opts.showroom && !opts.boarded && !cityRetail) { const _dr = makeDoorPanel(bgroup, ox, oz, localDoor, DOORW); if (_dr) doorRecs.push(_dr); }
        } else if (opts.boarded) {
          // DERELICT: not a blank wall — a real apartment grid of SMASHED-DARK /
          // boarded-over windows in the same residential rhythm, so an abandoned
          // building reads as a gutted tenement (dark voids, some planked over,
          // soot) instead of a flat box with a few marks. (Owner-filmed: the old
          // solid-plate-+-3-planks read as the "fake black window" blank wall.)
          const fy0b = k * FH, fy1b = k * FH + FH;
          const span = (f.horiz ? w : d), margin = 0.7, usable = span - 2 * margin;
          const nWin = Math.max(1, Math.round(usable / 2.6)), cell = usable / nWin;
          const winW = Math.min(2.0, cell * 0.62), sillH = 1.05, hdrH = 0.7;
          const winY0 = fy0b + sillH, winY1 = fy1b - hdrH;
          const winCy = (winY0 + winY1) / 2, winPh = winY1 - winY0;
          const fBox = (cT, segLen, cy, ch) => {
            if (segLen <= 0.02) return;
            if (f.horiz) lbox(cT, cy, f.z, segLen, ch, f.dd, color, wallOpt);
            else lbox(f.x, cy, cT, f.w, ch, segLen, color, wallOpt);
          };
          fBox(0, span, fy0b + sillH / 2, sillH);                 // spandrel below the sills
          fBox(0, span, fy1b - hdrH / 2, hdrH);                   // header above the heads
          fBox(-span / 2 + margin / 2, margin, winCy, winPh);     // corner piers
          fBox(span / 2 - margin / 2, margin, winCy, winPh);
          const DARKWIN = 0x14171a;                               // smashed-dark window void
          const faceSign = f.horiz ? (f.s === 0 ? -1 : 1) : (f.s === 2 ? -1 : 1);
          for (let i = 0; i < nWin; i++) {
            const t = -usable / 2 + (i + 0.5) * cell;
            const cx = f.horiz ? t : f.x, cz = f.horiz ? f.z : t;
            const pierW = (cell - winW) / 2;
            fBox(t - winW / 2 - pierW / 2, pierW, winCy, winPh);
            fBox(t + winW / 2 + pierW / 2, pierW, winCy, winPh);
            // dark broken-window void SEATED AT THE STREET FACE (not the wall
            // centre): at f.z it sat buried 0.2m inside the WT-thick wall, so the
            // derelict read as a near-blank wall with only the proud planks
            // showing as stray tally-marks (owner-filmed). Recess it just inside
            // the outer face so every opening reads as a dark smashed-out window.
            const vo = faceSign * (WT / 2 - 0.02);
            if (f.horiz) dbox(cx, winCy, f.z + vo, winW, winPh, 0.06, DARKWIN);
            else dbox(f.x + vo, winCy, cz, 0.06, winPh, winW, DARKWIN);
            // ~40% of the openings are boarded over with planks proud of the face
            const h = Math.abs(Math.sin((ox + cx) * 7.1 + (oz + cz) * 3.3 + winCy * 1.7)) % 1;
            if (h < 0.4) {
              const fo = faceSign * (WT / 2 + 0.05);
              for (let p = -1; p <= 1; p++) {
                if (f.horiz) dbox(cx, winCy + p * winPh * 0.3, f.z + fo, winW + 0.1, 0.16, 0.06, BOARD);
                else dbox(f.x + fo, winCy + p * winPh * 0.3, cz, 0.06, 0.16, winW + 0.1, BOARD);
              }
            }
          }
        } else {
          // REAL WINDOW OPENING — built like retailFront/showroomFront, but on
          // every storey: the wall is FRAMED (solid sill + header + jambs) around
          // a genuine GAP, and the gap is glazed with SOLID CLEAR glass. The
          // furnished room behind (cityFurnishApartment dresses every storey) is
          // therefore visible THROUGH the glass ALWAYS — and an INTERIOR GLOW
          // panel (cityInteriorGlow) sits just behind every opening so it reads
          // as a lived-in room (dim by day, ~15% warm-lit at night) and NEVER as
          // a flat black "fake window" — the exact complaint this pass fixes.
          // Breaking the glass (cityShatterRay/cityShatter bursts the solid pane
          // → frees its collider) leaves a clean opening into the real room.
          //
          // THREE FACADE MODES (chosen per building above):
          //   • OFFICE  — one wide curtain-wall BAND per storey (the loved towers)
          //   • RESIDENTIAL — several smaller CLEAR PUNCHED windows in a rhythmic
          //                   row (the NYC brick-apartment read the owner cited)
          //   • FORTIFIED — a couple of small high windows (bank/utility; rare)
          //
          // The solid clear pane doubles as the height-gated collider that used
          // to be the wall box, so nobody falls out an upper-floor window. The
          // frame boxes (sill/header/jambs) carry the wall colour + LOS so the
          // facade still reads structural and cops can't see through the spandrel.
          const outSgn = (f.s === 0 || f.s === 2) ? -1 : 1;   // toward the street
          const fy0 = k * FH, fy1 = k * FH + FH;              // storey floor / ceiling
          // outward wall normal (cityInteriorGlow wants OUTWARD; doorInfo gives
          // inward, but here we derive it directly from the face/outSgn).
          const outN = f.horiz ? { x: 0, z: outSgn } : { x: outSgn, z: 0 };

          // ---- helper: glaze ONE punched opening (clear pane + interior glow +
          //   thin exterior trim). Coordinates are local; spanW/spanH = clear
          //   opening size; (cx,cy,cz) its centre. Deterministic per-window lit.
          function glazeOpening(cx, cy, cz, spanW, spanH) {
            // ===== PANE GRID (Sub-idea C: one shot must not shatter a whole wall)
            // A wide curtain-wall / storefront opening used to be ONE big solid
            // pane = ONE breakable mesh, so a single round removed the entire
            // glass wall (owner-filmed). Real mullioned curtain walls are a GRID
            // of small panes, each its own unit. So we subdivide the opening into
            // a grid of individual panes on a ~1.5m mullion pitch (the typical
            // curtain-wall module is 1.5m / 5ft — research: usglassmag / facades-
            // plus curtain-wall "module" sizing), each a separate addCityGlass
            // record → cityShatterRay/cityShatter break only the pane(s) hit. A
            // small opening (≤ one module each way) stays a single pane.
            const MOD = 1.5;                                  // target pane module (m)
            // cap the grid so a very wide band can't explode the pane/collider
            // count (each pane carries a collider). 10×3 max per opening keeps
            // panes individually breakable while staying bounded on tall towers.
            const nx = Math.max(1, Math.min(10, Math.round(spanW / MOD)));  // columns
            const ny = Math.max(1, Math.min(3, Math.round(spanH / MOD)));   // rows up the opening
            const pw = spanW / nx, ph = spanH / ny;           // per-pane size
            const t = 0.07;                                   // pane thickness
            // WINDOW REVEAL DEPTH (reference SkyscraperGenerator: window modules
            // carry a real reveal). Default the pane 0.01u PROUD of the outer face
            // (the pre-existing anti-"buried window" seat). With WINDOW_REVEALS_V2
            // on, RECESS it REV behind the outer face instead: the full-WT sill/
            // header/jamb boxes already framing the opening become the reveal
            // returns, so the glass now sits in a real pocket that self-shadows.
            // The collider rides the pane, still comfortably inside the WT wall.
            const revealsOn = !(CBZ.CONFIG && CBZ.CONFIG.WINDOW_REVEALS_V2 === false);
            // MASONRY doubles the reveal: a load-bearing brick or ashlar wall is
            // genuinely thick, and the deep shadow pocket around a punched window
            // is the #1 tell that separates real masonry from a painted box.
            // 0.17 of a 0.40 wall still leaves the pane comfortably inside.
            const REV = MASONRY ? 0.17 : 0.09;                // reveal depth (m)
            const paneOff = outSgn * (WT / 2 - (revealsOn ? REV : -0.01));  // face-normal seat of the pane plane
            for (let gx = 0; gx < nx; gx++) {
              for (let gy = 0; gy < ny; gy++) {
                const ox2 = -spanW / 2 + (gx + 0.5) * pw;     // pane offset within the opening
                const oy2 = -spanH / 2 + (gy + 0.5) * ph;
                const py = cy + oy2;
                if (f.horiz) addCityGlass(bgroup, cx + ox2, py, cz + paneOff, pw, ph, t, ox, oz, { solid: true, tint: tintIdx, kind: "clear" }, windows);
                else addCityGlass(bgroup, cx + paneOff, py, cz + ox2, t, ph, pw, ox, oz, { solid: true, tint: tintIdx, kind: "clear" }, windows);
              }
            }
            // REVEAL LINER: four slim bright returns framing the recessed glass
            // (top / bottom / jambs), spanning the pocket from the outer face in to
            // the pane so the reveal reads as depth, not a flat sticker. Pure merged
            // deco (dbox → flushDeco), cast:false, no collider — draw-call cheap.
            if (revealsOn && spanW > 0.4 && spanH > 0.4) {
              const linZc = outSgn * (WT / 2 - REV / 2 - 0.012);   // pocket centre, pulled in so no face is coplanar with the wall (no z-fight)
              const eb = 0.03;                                 // liner bar thickness on the opening face
              if (f.horiz) {
                dbox(cx, cy + spanH / 2 + eb / 2, cz + linZc, spanW + 2 * eb, eb, REV, REVEAL);   // head
                dbox(cx, cy - spanH / 2 - eb / 2, cz + linZc, spanW + 2 * eb, eb, REV, REVEAL);   // sill
                dbox(cx - spanW / 2 - eb / 2, cy, cz + linZc, eb, spanH, REV, REVEAL);            // left jamb
                dbox(cx + spanW / 2 + eb / 2, cy, cz + linZc, eb, spanH, REV, REVEAL);            // right jamb
              } else {
                dbox(cx + linZc, cy + spanH / 2 + eb / 2, cz, REV, eb, spanW + 2 * eb, REVEAL);
                dbox(cx + linZc, cy - spanH / 2 - eb / 2, cz, REV, eb, spanW + 2 * eb, REVEAL);
                dbox(cx + linZc, cy, cz - spanW / 2 - eb / 2, REV, spanH, eb, REVEAL);
                dbox(cx + linZc, cy, cz + spanW / 2 + eb / 2, REV, spanH, eb, REVEAL);
              }
            }
            // INTERIOR READABILITY: the room seen through the glass. Deterministic
            // per-window so the lit set is stable run-to-run. Apartments glow warm
            // (lamps), offices cool (overheads); ~26% of residential windows lit
            // at night so a brick block reads inhabited, ~15% for offices.
            if (CBZ.cityInteriorGlow) {
              const wx = ox + cx, wz = oz + cz;
              // LIT-ROOM selection. Legacy: a flat ~26%/15% of windows lit via a
              // Math.sin hash. FACADES_V2 (default ON): drive it off CBZ.hash01
              // with a per-BUILDING occupancy bias + a per-FLOOR clustering nudge,
              // so the night skyline reads as real lit ROOMS — some towers lit up,
              // some dark, and a busy floor tends to stay lit — instead of uniform
              // noise. Deterministic per seed (position + floor salt). Flag off →
              // the legacy Math.sin set, byte-identical.
              let lit;
              if (!(CBZ.CONFIG && CBZ.CONFIG.FACADES_V2 === false) && CBZ.hash01) {
                const occ = 0.10 + CBZ.hash01(ox, oz, 0x71c) * 0.28;        // building occupancy 0.10..0.38
                const floorLit = CBZ.hash01(ox, oz, 0x33 + k * 101);        // is THIS floor busy?
                const bias = occ * (0.55 + 0.9 * floorLit);                 // busy floors light more
                lit = CBZ.hash01(wx + cy * 0.7, wz, 0x5ad + k * 7) < Math.min(0.62, bias);
              } else {
                const hsh = Math.abs(Math.sin(wx * 12.9898 + cy * 4.137 + wz * 78.233) * 43758.5453) % 1;
                lit = hsh < (punched ? 0.26 : 0.15);
              }
              // PER-WINDOW BULB TEMPERATURE (reference: warm/cool lit-room spread).
              // interiorlight.keyFor buckets warm>=0.5 → "warm" vs "cool", so a
              // hashed per-room draw costs no extra layers. Offices skew cool
              // (overheads) with a warm-lamp minority; residential skews warm with
              // a cool TV/fluorescent minority. Position-hashed (+floor salt) so the
              // night skyline is stable per seed. Off (flag false) = the old fixed
              // single temperature, byte-identical.
              let warm = punched ? 0.9 : 0.35;
              if (!(CBZ.CONFIG && CBZ.CONFIG.WINDOW_REVEALS_V2 === false) && CBZ.hash01) {
                const warmShare = punched ? 0.72 : 0.28;       // fraction of rooms lit warm
                warm = CBZ.hash01(wx, wz, 0x3a7 + k * 17) < warmShare ? 0.8 : 0.22;
              }
              if (lit) _facadeLit++;                            // deterministic tally (gate)
              CBZ.cityInteriorGlow(bgroup, wx, cy, wz, spanW, spanH, outN, { lit: lit, warm: warm });
            }
            // WINDOW AC UNIT (FACADE_AC_UNITS, default OFF — owner-cut: the boxes
            // covered shop signage). When re-enabled, a hashed minority of
            // residential windows wear a chunky through-the-wall AC box on the
            // outer sill. Merged deco (dbox → flushDeco, cast:false, no collider).
            // Placement is a pure position-hash (CBZ.hash01) — no shared rng()
            // stream draws — so skipping emission never reorders anything else.
            if (punched && CBZ.CONFIG && CBZ.CONFIG.FACADE_AC_UNITS === true
                && !(CBZ.CONFIG.FACADES_V2 === false) && CBZ.hash01
                && spanW > 0.7 && CBZ.hash01(ox + cx, oz + cz, 0x2ac1 + k * 13) < 0.22) {
              const acW = Math.min(0.9, spanW * 0.66), acH = 0.42, acD = 0.4;   // chunky box
              const acY = cy - spanH / 2 + acH / 2 + 0.04;                       // seated on the sill
              const bodyOff = outSgn * (WT / 2 + acD / 2 - 0.04);                // proud of the outer face
              const ventOff = outSgn * (WT / 2 + acD - 0.05);                    // the grille, a touch further out
              if (f.horiz) {
                dbox(cx, acY, cz + bodyOff, acW, acH, acD, 0x9aa0a8);            // AC body
                dbox(cx, acY, cz + ventOff, acW - 0.12, acH - 0.12, 0.05, 0x5b626b);   // dark vent grille
              } else {
                dbox(cx + bodyOff, acY, cz, acD, acH, acW, 0x9aa0a8);
                dbox(cx + ventOff, acY, cz, 0.05, acH - 0.12, acW - 0.12, 0x5b626b);
              }
              _facadeAC++;
            }
          }

          if (punched) {
            // ===== RESIDENTIAL: a row of small CLEAR PUNCHED windows =====
            // Regular rhythm: a fixed pier (solid brick) between each window so
            // the wall reads as masonry with windows cut into it, not a glass
            // band. Window count derives from the face width (≈ one per 3.2m).
            const span = (f.horiz ? w : d);
            const margin = 0.7;                       // solid wall at each corner
            const usable = span - 2 * margin;
            // WINDOW DENSITY (the owner-filmed blank-wall bug): the count must
            // TILE the WHOLE face, not stop at a few stranded windows on a wide
            // wall. Real NYC apartment/loft facades run a regular grid of windows
            // every ~2.6m of facade (research: chicagobrickco "punched windows",
            // brownstone/tenement bay spacing ≈ 8-9 ft ≈ 2.5-2.8m). So drop the
            // old min(6) cap entirely and derive purely from width at a ~2.6m
            // bay pitch — a 36m loft now gets ~13 windows per floor (was capped
            // at 6 = the blank-wall read), a 10m brownstone ~3-4. Floor of 1 only
            // so a tiny shed still gets a window.
            const BAY = 2.6;                           // facade metres per window bay
            const nWin = Math.max(1, Math.round(usable / BAY));
            const cell = usable / nWin;               // each window+pier cell
            // opening fills more of the bay so the wall reads COVERED in glass,
            // not dotted with slits; the remaining ~38% of the cell is the brick
            // pier. Cap at 2.0m so a wide cell still reads as a window, not a band.
            const winW = Math.min(2.0, cell * 0.68);  // the punched opening width
            // vertical: a generous sill (apartments aren't floor-to-ceiling) up
            // to a header lip — a tall-ish punched window, head-height view in.
            // MSILL/MHDR are shared with veneerBand so the brick veneer always
            // lands on solid wall and never crosses an opening.
            const sillH = MSILL, hdrH = MHDR;
            const winY0 = fy0 + sillH, winY1 = fy1 - hdrH;
            const winCy = (winY0 + winY1) / 2, winPh = winY1 - winY0;
            // FRAME the masonry around REAL gaps (never a solid plate — that
            // would bury the interior-glow room behind brick). Continuous
            // spandrel below the sill line + header band above, then solid
            // brick PIERS between each opening. The gaps are where light/room
            // shows through. Helper places a wall box on the face axis.
            const faceBox = (centerT, segLen, cy, ch) => {
              if (segLen <= 0.02) return;
              if (f.horiz) lbox(centerT, cy, f.z, segLen, ch, f.dd, color, wallOpt);
              else lbox(f.x, cy, centerT, f.w, ch, segLen, color, wallOpt);
            };
            // spandrel (floor → sill) + header (window top → ceiling), full width
            faceBox(0, span, fy0 + sillH / 2, sillH);
            faceBox(0, span, fy1 - hdrH / 2, hdrH);
            // corner margins are solid brick (piers handle the rest)
            faceBox(-span / 2 + margin / 2, margin, winCy, winPh);
            faceBox(span / 2 - margin / 2, margin, winCy, winPh);
            for (let i = 0; i < nWin; i++) {
              const t = -usable / 2 + (i + 0.5) * cell;   // cell centre on the face axis
              const cx = f.horiz ? t : f.x;
              const cz = f.horiz ? f.z : t;
              // solid brick PIER on each side of this opening (fills the cell
              // minus the glazed slot) — gives the punched-masonry rhythm.
              const pierW = (cell - winW) / 2;
              faceBox(t - winW / 2 - pierW / 2, pierW, winCy, winPh);
              faceBox(t + winW / 2 + pierW / 2, pierW, winCy, winPh);
              glazeOpening(cx, winCy, cz, winW, winPh);
              // ---- PUNCHED-WINDOW DRESSING (the brick-building grammar) ----
              // A real brick opening carries, from bottom up: a projecting STONE
              // SILL with a drip nose; brick JAMB reveals; and a head that is
              // either a flat stone LINTEL or a SEGMENTAL ARCH of header bricks
              // with a keystone. Which head a building uses is one deterministic
              // per-building draw (CBZ.hash01, never rng), so a block reads as
              // one builder's work rather than a random mix window to window.
              // Everything is merged deco (dbox) — zero extra draw calls.
              const arched = CBZ.hash01 ? CBZ.hash01(ox, oz, 0x4a2c) < 0.45 : false;
              const SILLC = TRIM, HEADC = arched ? shadeHex(color, 0.88) : TRIM;
              if (f.horiz) {
                const faceZ = f.z + outSgn * (WT / 2 + 0.05);
                dbox(cx, winY0 - 0.07, faceZ, winW + 0.30, 0.14, 0.16, SILLC);            // stone sill
                dbox(cx, winY0 - 0.17, faceZ + outSgn * 0.03, winW + 0.22, 0.07, 0.10, shadeHex(SILLC, 0.82));   // drip nose
                if (arched) {
                  // five voussoir blocks stepping up to a keystone
                  for (let v = -2; v <= 2; v++) {
                    const rise = 0.10 * (2 - Math.abs(v));
                    dbox(cx + v * (winW / 4.6), winY1 + 0.10 + rise / 2, faceZ,
                      winW / 4.4, 0.22 + rise, 0.11, HEADC);
                  }
                  dbox(cx, winY1 + 0.30, faceZ + outSgn * 0.02, 0.22, 0.34, 0.13, SILLC);  // keystone
                } else {
                  dbox(cx, winY1 + 0.10, faceZ, winW + 0.34, 0.18, 0.13, HEADC);           // flat stone lintel
                  dbox(cx, winY1 + 0.22, faceZ, winW + 0.18, 0.07, 0.09, shadeHex(SILLC, 1.06));
                }
                dbox(cx, winCy, faceZ, winW + 0.12, 0.07, 0.06, MULL);          // muntin (horiz bar)
                dbox(cx, winCy, faceZ, 0.06, winPh, 0.06, MULL);                // muntin (vert bar)
              } else {
                const faceX = f.x + outSgn * (WT / 2 + 0.05);
                dbox(faceX, winY0 - 0.07, cz, 0.16, 0.14, winW + 0.30, SILLC);
                dbox(faceX + outSgn * 0.03, winY0 - 0.17, cz, 0.10, 0.07, winW + 0.22, shadeHex(SILLC, 0.82));
                if (arched) {
                  for (let v = -2; v <= 2; v++) {
                    const rise = 0.10 * (2 - Math.abs(v));
                    dbox(faceX, winY1 + 0.10 + rise / 2, cz + v * (winW / 4.6),
                      0.11, 0.22 + rise, winW / 4.4, HEADC);
                  }
                  dbox(faceX + outSgn * 0.02, winY1 + 0.30, cz, 0.13, 0.34, 0.22, SILLC);
                } else {
                  dbox(faceX, winY1 + 0.10, cz, 0.13, 0.18, winW + 0.34, HEADC);
                  dbox(faceX, winY1 + 0.22, cz, 0.09, 0.07, winW + 0.18, shadeHex(SILLC, 1.06));
                }
                dbox(faceX, winCy, cz, 0.06, 0.07, winW + 0.12, MULL);
                dbox(faceX, winCy, cz, 0.06, winPh, 0.06, MULL);
              }
            }
          } else if (civicF) {
            // ===== CIVIC / GOVERNMENT: ashlar stone, TALL SYMMETRICAL BAYS ====
            // A courthouse or federal building does not glaze like an office and
            // does not punch like a tenement: it runs a small number of tall,
            // evenly-spaced openings separated by full-height engaged PIERS, each
            // opening capped with a stone architrave and set on a bracketed sill.
            // The bay count is derived from the face width at a ~4.0m civic pitch
            // (roughly 13ft, the classic monumental bay), and — crucially — the
            // bays are laid out SYMMETRICALLY about the face centre, because a
            // government facade that isn't symmetrical reads instantly wrong.
            const span = (f.horiz ? w : d);
            const endPier = Math.max(1.0, span * 0.075);      // heavy corner pier
            const usableC = span - 2 * endPier;
            const nBay = Math.max(1, Math.round(usableC / 4.0));
            const cellC = usableC / nBay;
            const winW = Math.min(2.6, cellC * 0.56);          // tall, generous opening
            const sillH = MSILL, hdrH = MHDR;
            const winY0 = fy0 + sillH, winY1 = fy1 - hdrH;
            const winCy = (winY0 + winY1) / 2, winPh = winY1 - winY0;
            const fBoxC = (centerT, segLen, cy, ch) => {
              if (segLen <= 0.02) return;
              if (f.horiz) lbox(centerT, cy, f.z, segLen, ch, f.dd, color, wallOpt);
              else lbox(f.x, cy, centerT, f.w, ch, segLen, color, wallOpt);
            };
            fBoxC(0, span, fy0 + sillH / 2, sillH);            // podium/spandrel course
            fBoxC(0, span, fy1 - hdrH / 2, hdrH);              // frieze course
            fBoxC(-span / 2 + endPier / 2, endPier, winCy, winPh);
            fBoxC(span / 2 - endPier / 2, endPier, winCy, winPh);
            const faceN = f.horiz ? f.z + outSgn * (WT / 2 + 0.05) : f.x + outSgn * (WT / 2 + 0.05);
            for (let i = 0; i < nBay; i++) {
              const t = -usableC / 2 + (i + 0.5) * cellC;
              const cx = f.horiz ? t : f.x, cz = f.horiz ? f.z : t;
              const pierW = (cellC - winW) / 2;
              fBoxC(t - winW / 2 - pierW / 2, pierW, winCy, winPh);
              fBoxC(t + winW / 2 + pierW / 2, pierW, winCy, winPh);
              glazeOpening(cx, winCy, cz, winW, winPh);
              // ENGAGED PILASTER on the pier between bays: a shallow flat pier
              // with a bright reveal, running the full storey, plus a moulded
              // cap where it meets the frieze. Merged deco — no draw cost.
              const pw2 = Math.min(0.85, pierW * 0.72);
              const pT = t + winW / 2 + pierW / 2;
              if (i < nBay - 1 && pw2 > 0.2) {
                if (f.horiz) {
                  dbox(pT, fy0 + FH / 2, faceN, pw2, FH - 0.1, 0.11, PIL);
                  dbox(pT, fy1 - hdrH - 0.10, faceN, pw2 + 0.24, 0.20, 0.17, TRIM);   // capital
                  dbox(pT, fy0 + sillH + 0.10, faceN, pw2 + 0.20, 0.16, 0.15, TRIM);  // base
                } else {
                  dbox(faceN, fy0 + FH / 2, pT, 0.11, FH - 0.1, pw2, PIL);
                  dbox(faceN, fy1 - hdrH - 0.10, pT, 0.17, 0.20, pw2 + 0.24, TRIM);
                  dbox(faceN, fy0 + sillH + 0.10, pT, 0.15, 0.16, pw2 + 0.20, TRIM);
                }
              }
              // ARCHITRAVE + BRACKETED SILL around the opening (stone dressings)
              if (f.horiz) {
                dbox(cx, winY1 + 0.13, faceN, winW + 0.56, 0.24, 0.16, TRIM);         // architrave / cornice
                dbox(cx, winY1 + 0.29, faceN, winW + 0.30, 0.10, 0.20, shadeHex(TRIM, 1.06));
                dbox(cx, winY0 - 0.10, faceN, winW + 0.44, 0.18, 0.18, TRIM);         // sill slab
                for (const sg of [-1, 1])
                  dbox(cx + sg * (winW / 2 - 0.06), winY0 - 0.34, faceN, 0.20, 0.34, 0.16, shadeHex(TRIM, 0.88));  // console brackets
                for (const sg of [-1, 1])
                  dbox(cx + sg * (winW / 2 + 0.14), winCy, faceN, 0.14, winPh, 0.10, shadeHex(TRIM, 0.94));        // jamb architrave
              } else {
                dbox(faceN, winY1 + 0.13, cz, 0.16, 0.24, winW + 0.56, TRIM);
                dbox(faceN, winY1 + 0.29, cz, 0.20, 0.10, winW + 0.30, shadeHex(TRIM, 1.06));
                dbox(faceN, winY0 - 0.10, cz, 0.18, 0.18, winW + 0.44, TRIM);
                for (const sg of [-1, 1])
                  dbox(faceN, winY0 - 0.34, cz + sg * (winW / 2 - 0.06), 0.16, 0.34, 0.20, shadeHex(TRIM, 0.88));
                for (const sg of [-1, 1])
                  dbox(faceN, winCy, cz + sg * (winW / 2 + 0.14), 0.10, winPh, 0.14, shadeHex(TRIM, 0.94));
              }
            }
          } else if (fortified) {
            // ===== FORTIFIED: mostly-solid wall + a couple of small high windows
            // bank/utility read — heavier masonry, but NOT a blank wall: a row
            // of narrow security windows (tall slots) set high on the storey, on
            // a wider pier rhythm than residential. Still REAL (clear + glow). We
            // frame around the gaps so the glow room shows (no buried plate).
            // (Owner note: nothing should read fully windowless — even a bank has
            // teller windows; fortified is now "fewer, taller, barred-looking"
            // rather than "one or two tiny slits on a huge wall".)
            const span = (f.horiz ? w : d);
            const margin2 = 0.9;
            const usable2 = span - 2 * margin2;
            const nWin = Math.max(1, Math.round(usable2 / 4.2));   // sparser bay (~4.2m) than residential
            const cell2 = usable2 / nWin;
            const winW = Math.min(0.95, cell2 * 0.32);  // narrow security slot
            const winPh = Math.min(2.2, FH * 0.5);      // taller slot (was 0.9)
            const winCy = fy0 + FH * 0.5 + 0.3;         // mid-high on the wall
            const slotXs = [];
            for (let i = 0; i < nWin; i++) slotXs.push(-usable2 / 2 + (i + 0.5) * cell2);
            const fBox = (centerT, segLen, cy, ch) => {
              if (segLen <= 0.02) return;
              if (f.horiz) lbox(centerT, cy, f.z, segLen, ch, f.dd, color, wallOpt);
              else lbox(f.x, cy, centerT, f.w, ch, segLen, color, wallOpt);
            };
            // solid wall everywhere EXCEPT the window band height; in the band,
            // solid between/around the slots.
            const bandY0 = winCy - winPh / 2, bandY1 = winCy + winPh / 2;
            fBox(0, span, fy0 + (bandY0 - fy0) / 2, bandY0 - fy0);     // below band
            fBox(0, span, bandY1 + (fy1 - bandY1) / 2, fy1 - bandY1);  // above band
            // brick between/around the slots within the band
            let prev = -span / 2;
            for (const t of slotXs) {
              fBox((prev + (t - winW / 2)) / 2, (t - winW / 2) - prev, winCy, winPh);
              prev = t + winW / 2;
            }
            fBox((prev + span / 2) / 2, span / 2 - prev, winCy, winPh);
            for (let i = 0; i < nWin; i++) {
              const t = slotXs[i];
              const cx = f.horiz ? t : f.x, cz = f.horiz ? f.z : t;
              glazeOpening(cx, winCy, cz, winW, winPh);
              if (f.horiz) { const fz = f.z + outSgn * (WT / 2 + 0.05); dbox(cx, winCy - winPh / 2 - 0.06, fz, winW + 0.2, 0.1, 0.12, TRIM); }
              else { const fx = f.x + outSgn * (WT / 2 + 0.05); dbox(fx, winCy - winPh / 2 - 0.06, cz, 0.12, 0.1, winW + 0.2, TRIM); }
            }
          } else {
            // ===== CLEAN CURTAIN-WALL FACADE (PROCGEN.md #7) ======================
            // One continuous glazed opening per face, subdivided by the existing
            // pane grid and hairline mullions below. The old split-terminal pass
            // position-hashed occasional `balconyWindow` cells, then glued a
            // 0.55m cantilever and a solid 0.85m rail onto the finished glass.
            // From the street those read as the repeated black boxes filmed on
            // Threads & Drip; they had no floor collider, door or usable balcony
            // behind them. The terminal vocabulary and emitter are gone, so all
            // districts keep their clean glazing with no side attachments.
            const sillH = modern ? 0.55 : 0.9;                  // sill top above floor
            const hdrH = modern ? 0.45 : 0.7;                   // header depth below ceiling
            const winY0 = fy0 + sillH, winY1 = fy1 - hdrH;
            const winCy = (winY0 + winY1) / 2, winPh = winY1 - winY0;
            const jamb = 0.55;                                  // end jambs centre the opening
            const span = (f.horiz ? w : d) - 2 * jamb;
            const BAY = 1.5;                                    // facade bay pitch (m) — matches glazeOpening's own pane module
            const nBays = Math.max(1, Math.min(10, Math.round(span / BAY)));
            const bayW = span / nBays;
            if (f.horiz) {
              lbox(f.x, fy0 + sillH / 2, f.z, f.w, sillH, f.dd, color, wallOpt);   // sill
              lbox(f.x, fy1 - hdrH / 2, f.z, f.w, hdrH, f.dd, color, wallOpt);     // header
              lbox(-w / 2 + jamb / 2, winCy, f.z, jamb, winPh, f.dd, color, wallOpt);   // jambs
              lbox(w / 2 - jamb / 2, winCy, f.z, jamb, winPh, f.dd, color, wallOpt);
            } else {
              lbox(f.x, fy0 + sillH / 2, f.z, f.w, sillH, f.dd, color, wallOpt);
              lbox(f.x, fy1 - hdrH / 2, f.z, f.w, hdrH, f.dd, color, wallOpt);
              lbox(f.x, winCy, -d / 2 + jamb / 2, f.w, winPh, jamb, color, wallOpt);
              lbox(f.x, winCy, d / 2 - jamb / 2, f.w, winPh, jamb, color, wallOpt);
            }
            // CLEAN-GLASS mullions: hairline vertical reveals on the curtain-wall
            // module (research: modern all-glass facades minimize framing, mullion
            // ~5-10mm) — the heavy mid-storey horizontal TRANSOM bar stays dropped.
            const faceOut = f.horiz ? f.z + outSgn * (WT / 2 + 0.04) : f.x + outSgn * (WT / 2 + 0.04);
            const gcx = f.horiz ? 0 : f.x, gcz = f.horiz ? f.z : 0;
            glazeOpening(gcx, winCy, gcz, span - 0.04, winPh);
            // hairline module ticks at every bay boundary — pure rhythm, cheap
            // merged deco (dbox), with no geometry projecting off the wall.
            for (let i = 1; i < nBays; i++) {
              const tb = -span / 2 + i * bayW;
              if (f.horiz) dbox(tb, winCy, faceOut, 0.035, winPh, 0.04, MULL);
              else dbox(faceOut, winCy, tb, 0.04, winPh, 0.035, MULL);
            }
            // slim sill/header reveal across the whole face (unchanged)
            if (f.horiz) {
              dbox(0, winY0 - 0.04, f.z + outSgn * (WT / 2 + 0.05), span + 0.2, 0.06, 0.08, TRIM);
              dbox(0, winY1 + 0.04, f.z + outSgn * (WT / 2 + 0.05), span + 0.2, 0.06, 0.08, TRIM);
            } else {
              dbox(f.x + outSgn * (WT / 2 + 0.05), winY0 - 0.04, 0, 0.08, 0.06, span + 0.2, TRIM);
              dbox(f.x + outSgn * (WT / 2 + 0.05), winY1 + 0.04, 0, 0.08, 0.06, span + 0.2, TRIM);
            }
          }
        }
      }
    }

    const slabMinX = ixMin;
    const slabW = ixMax - slabMinX, slabCx = (slabMinX + ixMax) / 2, slabD = izMax - izMin, slabCz = (izMin + izMax) / 2;
    // EVERY slab above the foundation is a CARVABLE record (see
    // CBZ.cityCarveShaft): a lift chase and a stair core each open their own
    // hole, in any order, any number of times. floorSlabs = the intermediate
    // floors L=1..storeys-1; roofSlab = the roof (carved only by a stair core
    // that surfaces in a bulkhead, never by the lift, whose headhouse stands
    // on it). The foundation is ground and is never carved.
    const floorSlabs = [];
    let roofSlab = null;
    // THE ROOF is a granulated bitumen membrane (world/building_dress.js
    // roofDeckMaterial: real-scale rolls, laps, patches, ponding, parapet
    // dirt), not the old flat 0x9fa6ad slab that read near-white from above.
    const roofMat = CBZ.roofDeckMaterial ? CBZ.roofDeckMaterial() : null;
    for (let L = 1; L <= storeys; L++) {
      const isRoof = L === storeys;
      const sm = lbox(slabCx, L * FH - 0.1, slabCz, slabW, 0.2, slabD, isRoof ? 0x6f6c66 : 0xb9bec6,
        { plat: true, los: true, cast: isRoof, mat: isRoof ? roofMat : null });
      const rec = slabRecord(sm, plats[plats.length - 1], L * FH - 0.1, isRoof);
      if (isRoof) roofSlab = rec; else floorSlabs.push(rec);
    }
    const rTop = storeys * FH;
    // FACADE MASSING: parapet height varies per building (0.55..1.05, was a
    // flat 0.7) and a coping lip caps it — rooflines stop reading identical.
    const pp = 0.55 + vhash * 0.5;
    // PARAPET = the facade wall carried up past the roof, in the facade's own
    // colour (it was one fixed grey band on every building in the city), with
    // a metal coping that oversails both faces, and on the roof side the
    // membrane turned up the wall as base flashing with its termination bar.
    // A boarded (opts.boarded) shell's roofline has really given way at one +z
    // corner: the parapet stops short there instead of standing intact.
    const PARC = shadeHex(color, 0.94), FLASHC = 0x4d4a45, TBAR = 0x7c8084;
    const brk = opts.boarded ? ((Math.abs(Math.sin(ox * 17.23 + oz * 91.7) * 43758.5453) % 1) < 0.5 ? 1 : -1) : 0;
    const GAPX = 1.9, GAPZ = 1.3;               // how much of the corner came down
    const pzW = brk ? slabW - GAPX : slabW, pzC = brk ? slabCx - brk * GAPX / 2 : slabCx;
    const pxD = slabD - GAPZ, pxC = slabCz - GAPZ / 2;
    // The +-z runs are FULL building width: they used to span only the slab,
    // which left a WT x WT notch out of the parapet at all four corners.
    const pfW = brk ? w - GAPX : w, pfC = brk ? -brk * GAPX / 2 : 0;
    lbox(pfC, rTop + pp / 2, d / 2 - WT / 2, pfW, pp, WT, PARC, { los: true });
    if (brk === 1) lbox(w / 2 - WT / 2, rTop + pp / 2, pxC, WT, pp, pxD, PARC, { los: true });
    else lbox(w / 2 - WT / 2, rTop + pp / 2, slabCz, WT, pp, slabD, PARC, { los: true });
    lbox(0, rTop + pp / 2, -d / 2 + WT / 2, w, pp, WT, PARC, { los: true });
    if (brk === -1) lbox(-w / 2 + WT / 2, rTop + pp / 2, pxC, WT, pp, pxD, PARC, { los: true });
    else lbox(-w / 2 + WT / 2, rTop + pp / 2, slabCz, WT, pp, slabD, PARC, { los: true });
    dbox(pfC, rTop + pp + 0.05, d / 2 - WT / 2, pfW + 0.16, 0.1, WT + 0.16, TRIM);
    dbox(w / 2 - WT / 2, rTop + pp + 0.05, brk === 1 ? pxC : slabCz, WT + 0.16, 0.1, (brk === 1 ? pxD : slabD) + 0.1, TRIM);
    dbox(0, rTop + pp + 0.05, -d / 2 + WT / 2, w + 0.16, 0.1, WT + 0.16, TRIM);
    dbox(-w / 2 + WT / 2, rTop + pp + 0.05, brk === -1 ? pxC : slabCz, WT + 0.16, 0.1, (brk === -1 ? pxD : slabD) + 0.1, TRIM);
    // base flashing + termination bar on the four inner faces that meet the membrane
    {
      const FH_UP = 0.3, T = 0.025;
      const iz = d / 2 - WT - T / 2, ix = w / 2 - WT - T / 2;
      dbox(pzC, rTop + FH_UP / 2, iz, pzW, FH_UP, T, FLASHC);
      dbox(slabCx, rTop + FH_UP / 2, -iz, slabW, FH_UP, T, FLASHC);
      dbox(pzC, rTop + FH_UP + 0.02, iz - 0.012, pzW, 0.04, 0.02, TBAR);
      dbox(slabCx, rTop + FH_UP + 0.02, -iz + 0.012, slabW, 0.04, 0.02, TBAR);
      const sxD = brk === 1 ? pxD : slabD, sxC = brk === 1 ? pxC : slabCz;
      dbox(ix, rTop + FH_UP / 2, sxC, T, FH_UP, sxD, FLASHC);
      dbox(ix - 0.012, rTop + FH_UP + 0.02, sxC, 0.02, 0.04, sxD, TBAR);
      const nxD = brk === -1 ? pxD : slabD, nxC = brk === -1 ? pxC : slabCz;
      dbox(-ix, rTop + FH_UP / 2, nxC, T, FH_UP, nxD, FLASHC);
      dbox(-ix + 0.012, rTop + FH_UP + 0.02, nxC, 0.02, 0.04, nxD, TBAR);
    }

    // ---- FACADE MASSING (all flat opaque deco boxes; merged by flushDeco) --
    // OWNER (screenshot): a glass curtain-wall TOWER must read as CLEAN GLASS —
    // not a building wrapped in a thick cage. The old per-floor cornice beams
    // (a heavy lip spanning the WHOLE facade at every storey line on all four
    // faces) + the chunky 0.5×0.5 full-height corner PILASTERS formed exactly
    // that cage ("a frame around the building — delete those"). On a modern
    // glass shell the floor slabs are hidden behind spandrel glass and the
    // mullions are minimal (research: clean all-glass facades hide/minimize
    // framing), so the cage is pure wasted geometry. We DROP both on glass/
    // office facades; a genuine masonry (residential/brick) facade — which the
    // city normalizes away today but the code path is kept — still earns its
    // street-reading cornice + pilasters. Window panes (cityGlass) are untouched
    // and collision/LOS (solid()/los boxes) are unaffected (these were deco-only
    // dbox→flushDeco merged meshes), so this is draw-call NEUTRAL or BETTER.
    // MASONRY earns its street-reading trim. When buildings_civic.js is loaded
    // the RICH dressing (string courses, quoins, water table, corbelled cornice,
    // parapet piers, weathering) replaces this legacy per-floor cornice lip
    // wholesale — running both would double every floor line.
    const masonryTrim = MASONRY && !CBZ.bldMasonryDress;
    if (masonryTrim) {
      // cornice lip at every floor line so masonry storeys read from the street
      for (let L = 1; L < storeys; L++) {
        const cy = L * FH;
        dbox(0, cy, -d / 2 - 0.02, w + 0.2, 0.13, 0.12, TRIM);
        dbox(0, cy, d / 2 + 0.02, w + 0.2, 0.13, 0.12, TRIM);
        dbox(-w / 2 - 0.02, cy, 0, 0.12, 0.13, d + 0.2, TRIM);
        dbox(w / 2 + 0.02, cy, 0, 0.12, 0.13, d + 0.2, TRIM);
      }
    }
    // darker ground-floor PLINTH band (skips the door face — the entrance /
    // storefront dressing owns that — and garage-deck buildings, whose whole
    // ground floor is drive-in bays). Sits below the lowest window band. This
    // is a GROUND grounding band only (not part of the per-floor cage), so it
    // stays on every facade so a tower meets the street instead of floating.
    // (MASONRY skips this band: its base is a real grade plinth + water table +
    // the textured veneer, all emitted by bldMasonryDress/veneerBand, and a flat
    // painted plinth on top of them would just z-fight the brick.)
    if (!opts.garageGround && !(MASONRY && CBZ.bldMasonryDress)) {
      if (doorSide !== 0) dbox(0, 0.33, -d / 2 - 0.025, w + 0.1, 0.66, 0.09, BASE);
      if (doorSide !== 1) dbox(0, 0.33, d / 2 + 0.025, w + 0.1, 0.66, 0.09, BASE);
      if (doorSide !== 2) dbox(-w / 2 - 0.025, 0.33, 0, 0.09, 0.66, d + 0.1, BASE);
      if (doorSide !== 3) dbox(w / 2 + 0.025, 0.33, 0, 0.09, 0.66, d + 0.1, BASE);
    }
    if (masonryTrim) {
      // corner PILASTERS tying the floors to the parapet line (masonry only)
      for (const sxp of [-1, 1]) for (const szp of [-1, 1])
        dbox(sxp * (w / 2 - 0.02), (rTop + pp) / 2, szp * (d / 2 - 0.02), 0.5, rTop + pp, 0.5, PIL);
    } else if (MASONRY) {
      // masonry corners are QUOINED (alternating long/short corner stones) by
      // bldMasonryDress — neither a fat pilaster nor a glass-tower hairline.
    } else {
      // glass tower: a HAIRLINE corner reveal (a thin pinstripe, not a cage
      // post) so the curtain-wall edge still catches light without framing the
      // building. 0.1×0.1 vs the old 0.5×0.5 — ~96% less corner geometry volume.
      for (const sxp of [-1, 1]) for (const szp of [-1, 1])
        dbox(sxp * (w / 2 + 0.01), (rTop + pp) / 2, szp * (d / 2 + 0.01), 0.1, rTop + pp, 0.1, MULL);
    }

    // ===== TRIPARTITE MASSING + ROOFLINE GRAMMAR (reference SkyscraperGenerator)
    // Adoption A (CBZ.CONFIG.BUILDING_MASSING_V2, default ON): give city/town
    // towers a base / shaft / crown reading. EVERYTHING here is merged DECO (dbox
    // → flushDeco) or a rotated flat-Lambert mesh that core/batch.js folds at load,
    // and it sits at floor lines or ABOVE the roof — no new ground colliders, so
    // doors / interiors / stairs / the elevator shaft / roofloot / helipad are all
    // untouched. Deterministic per lot via CBZ.hash01(ox,oz,salt) — never rng(),
    // never a shared-stream draw. Skips the bespoke flagship (garageGround).
    let crownRect = null;   // building-local footprint of the setback crown (roof plant keeps off it)
    if ((CBZ.CONFIG ? CBZ.CONFIG.BUILDING_MASSING_V2 !== false : true) && !opts.garageGround) {
      const h01 = (salt) => CBZ.hash01 ? CBZ.hash01(ox, oz, salt) : 0.4;
      // a projecting horizontal belt wrapping a centred rectangle at world height y.
      const beltAt = (cx0, cz0, bw, bd, y, proj, th, c) => {
        const bhw = bw / 2, bhd = bd / 2;
        dbox(cx0, y, cz0 - bhd - proj / 2, bw + 2 * proj, th, proj, c);   // -z
        dbox(cx0, y, cz0 + bhd + proj / 2, bw + 2 * proj, th, proj, c);   // +z
        dbox(cx0 - bhw - proj / 2, y, cz0, proj, th, bd + 2 * proj, c);   // -x
        dbox(cx0 + bhw + proj / 2, y, cz0, proj, th, bd + 2 * proj, c);   // +x
      };
      const belt = (y, proj, th, c) => beltAt(0, 0, w, d, y, proj, th, c);
      // ---- BASE: a two-step belt cornice capping the podium (storeys >= 3) ----
      if (storeys >= 3) {
        const baseFloors = storeys >= 8 ? 2 : 1;
        const by = baseFloors * FH;
        belt(by - 0.03, 0.16, 0.30, BASE);        // deep lower course
        belt(by + 0.15, 0.10, 0.12, TRIM);        // upper lip
      }
      // ---- SHAFT: projecting string courses every N floors (storeys >= 4) ----
      if (storeys >= 4) {
        const every = 3 + ((h01(0x57c) * 3) | 0);           // 3..5 floors apart
        const startF = storeys >= 8 ? 2 : 1;
        for (let L = startF + every; L < storeys; L += every) belt(L * FH - 0.02, 0.09, 0.16, TRIM);
      }
      // ---- MAIN ROOFLINE: a two-step projecting cornice under the parapet ----
      if (storeys >= 2) {
        belt(rTop - 0.06, 0.14, 0.22, TRIM);
        belt(rTop + 0.12, 0.22, 0.14, shadeHex(color, 0.80));
      }
      // (CORNER PINNACLES deleted 2026-09-27: four stubby trim cubes stood on
      // the parapet corners of every 3+ storey office and apartment block. No
      // real curtain-wall or walk-up roofline carries finials; they read as
      // placeholder blocks from every window above them. A facade that really
      // has pinnacles, merlons or cresting draws its own via the facade kit.)
      // ===== SETBACK CROWN (storeys >= 6): an inset capping volume with 45°
      // chamfered corners + a stepped spire — the tripartite silhouette. DECO
      // ONLY (cast shadow, no collider), seated ON the roof slab and inset from
      // it, so a walkable terrace remains around it (roofloot / helipad / snipers
      // keep working) and no interior floor is touched.
      // Skipped outright when a facade crowns the roof — this volume plus its
      // spire is exactly what was growing through the domes and mansards.
      if (storeys >= 6 && !facadeTakesRoof) {
        // CENTRE THE CROWN ON THE ROOF SLAB (slabCx/slabCz/slabW/slabD — the solid
        // walkable roof, which already excludes the -x stairwell strip) and rise
        // from rTop, so the crown base sits ON the roof (never floating above the
        // parapet, never overhanging the open stairwell) and a terrace remains.
        const inset = Math.min(slabW, slabD) * (0.18 + h01(0x9a1) * 0.08);   // 18..26%
        const cw = slabW - 2 * inset, cdp = slabD - 2 * inset;
        if (cw > 3 && cdp > 3) {
          const crownH = FH * (1.4 + h01(0x9a2) * 1.6);              // ~1.4..3 floors
          const cy0 = rTop;                                          // base on the roof surface
          const cx0 = slabCx, cz0 = slabCz;                          // roof-slab centre
          const chw = cw / 2, chd = cdp / 2, cyc = cy0 + crownH / 2;
          const cCol = shadeHex(color, 1.04);                        // crown a touch brighter
          const crownMat = CBZ.cmat ? CBZ.cmat(cCol) : mat(cCol);
          dbox(cx0, cyc, cz0 - chd, cw, crownH, WT, cCol);          // four crown walls
          dbox(cx0, cyc, cz0 + chd, cw, crownH, WT, cCol);
          dbox(cx0 - chw, cyc, cz0, WT, crownH, cdp, cCol);
          dbox(cx0 + chw, cyc, cz0, WT, crownH, cdp, cCol);
          dbox(cx0, cy0 + crownH - 0.12, cz0, cw, 0.24, cdp, cCol);  // solid top (not hollow from distance)
          // 45° CHAMFERED CORNERS aimed outward: a rotated flat panel bridging each
          // corner (dbox is axis-aligned, so build these as rotated meshes; opaque
          // Lambert, no userData → core/batch.js bakes the rotation in at load).
          const chamW = Math.min(cw, cdp) * 0.30;
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const m = new THREE.Mesh(new THREE.BoxGeometry(chamW, crownH, WT), crownMat);
            m.position.set(cx0 + sx * chw, cyc, cz0 + sz * chd);
            m.rotation.y = Math.atan2(sx, sz);                       // face the outward diagonal
            m.castShadow = true; m.receiveShadow = true;
            bgroup.add(m);
          }
          const ctop = cy0 + crownH;
          beltAt(cx0, cz0, cw, cdp, ctop + 0.10, 0.20, 0.16, TRIM);  // crown cornice
          beltAt(cx0, cz0, cw, cdp, ctop + 0.36, 0.05, 0.5, cCol);   // crown parapet
          // THIS IS THE MECHANICAL PENTHOUSE, so it breathes like one: a band
          // of louvred intake/exhaust grilles across each long wall (dark
          // plenum behind, blades proud of it) instead of the old stepped
          // ziggurat of trim cubes on its lid. The lid carries one guyed
          // antenna mast on a base plate, off-centre like a real rooftop mast.
          {
            const LV = 0x3a3f45, BL = shadeHex(cCol, 0.82);
            const lh = Math.min(1.6, crownH * 0.45), ly = cy0 + crownH * 0.55;
            const lw = Math.min(cw, cdp) * 0.5;
            const nb = Math.max(4, Math.round(lh / 0.16));
            for (const s of [-1, 1]) {
              dbox(cx0, ly, cz0 + s * (chd + WT / 2 + 0.01), lw, lh, 0.02, LV);
              dbox(cx0 + s * (chw + WT / 2 + 0.01), ly, cz0, 0.02, lh, lw, LV);
              for (let k = 0; k < nb; k++) {
                const by = ly - lh / 2 + (k + 0.5) * (lh / nb);
                dbox(cx0, by, cz0 + s * (chd + WT / 2 + 0.05), lw, 0.035, 0.07, BL);
                dbox(cx0 + s * (chw + WT / 2 + 0.05), by, cz0, 0.07, 0.035, lw, BL);
              }
            }
            const mx = cx0 + cw * 0.22, mz = cz0 - cdp * 0.18, mH = 3.2 + h01(0x9a3) * 2.4;
            dbox(mx, ctop + 0.03, mz, 0.6, 0.06, 0.6, MULL);          // base plate
            dbox(mx, ctop + mH / 2, mz, 0.09, mH, 0.09, MULL);        // mast
            dbox(mx, ctop + mH * 0.7, mz, 0.9, 0.03, 0.03, MULL);     // dipole arms
            dbox(mx, ctop + mH * 0.85, mz, 0.6, 0.03, 0.03, MULL);
          }
          crownRect = { x0: cx0 - chw, x1: cx0 + chw, z0: cz0 - chd, z1: cz0 + chd };
        }
      }
    }
    // ============================================================
    //  MASONRY / CIVIC / ROOF-CLUTTER DRESSING (buildings_civic.js)
    // ============================================================
    // Everything below is emitted BEFORE flushDeco so it folds into this
    // building's merged trim buckets (and then into core/batch.js's city-wide
    // merge). The helper module owns the vocabulary; this block owns the
    // plumbing — a small ctx of closures + the building's real dimensions, so
    // buildings_civic.js never touches the scene graph, colliders or rng.
    let roofCrowned = false, dressedId = null;
    // the visible wall skin (see THE SKIN). A masonry shell with its textured
    // veneer: every face is that brick/ashlar; the facade kit overrides below.
    let skin = null;
    if (MPAL) {
      const mk = MPAL.kind === "ashlar" ? "ashlar" : "brick";
      skin = { faces: [MPAL.wall, MPAL.wall, MPAL.wall, MPAL.wall], hex: MPAL.wall, pattern: mk,
        kind: mk === "ashlar" ? "rock" : "brick", masonry: VENEER_ON ? MPAL.id : null };
    }
    let civicOrderRec = null;
    {
      const bhash = (salt) => (CBZ.hash01 ? CBZ.hash01(ox, oz, salt) : 0.42);
      const addMesh = (geo, col, lx, ly, lz, emissive) => {
        const mm = emissive ? mat(col, { emissive: col, ei: 0.8 }) : (CBZ.cmat ? CBZ.cmat(col) : mat(col));
        const m = new THREE.Mesh(geo, mm);
        m.position.set(lx, ly, lz);
        m.castShadow = !emissive; m.receiveShadow = true;
        bgroup.add(m);
        return m;
      };
      const ctxC = {
        ox, oz, w, d, storeys, FH, WT, rTop, pp, doorSide,
        // the civic order reports what it actually stood on the front (its
        // column stations, entablature line, deck) so a host that hangs
        // things on that front reads the built numbers instead of re-deriving
        // them in a second file (the drift that floats banners).
        publishOrder: function (rec) { civicOrderRec = rec; },
        slabCx, slabCz, slabW, slabD,
        garageGround: !!opts.garageGround,
        showroom: !!opts.showroom,
        civic: civicSpec,
        // THE FACADE KIT's spec, written at the CALL SITE exactly the way
        // govcomplex.js writes {crown, order, motto} for the Capitol. Absent on
        // every existing caller, so the kit is inert until someone asks for it.
        dress: DRESS || (DRESS === false ? false : null),   // false = explicit opt-out
        // volumes (building-local {x0,x1,y0,y1,z0,z1}) the facade kit must leave
        // open: dressFacade re-emits any grammar box through one as the pieces
        // around it. The mega-tower hands in its executive storey here.
        keepClear: (function () {
          const kc = Array.isArray(opts.keepClear) ? opts.keepClear.slice() : [];
          // THE STOREFRONT BAY. A shop's ground storey on its door face
          // belongs to the shop: the shell's clear glazing, its door, and the
          // fascia + awning signAwning hangs on the header band. No grammar
          // ornament may clad over it — every box a facade lays there is
          // re-emitted around this volume (corner piers survive, 0.7 m each end).
          if (opts.storefront === true || (opts.storefront !== false && (opts.retail || opts.showroom))) {
            const hz = doorSide === 0 || doorSide === 1;
            const span = hz ? w : d, half = (hz ? d : w) / 2;
            const sgn = (doorSide === 0 || doorSide === 2) ? -1 : 1;
            const n0 = sgn > 0 ? half - 0.05 : -half - 40, n1 = sgn > 0 ? half + 40 : -half + 0.05;
            const t0 = -span / 2 + 0.7, t1 = span / 2 - 0.7;
            kc.push(hz ? { x0: t0, x1: t1, y0: -1, y1: FH - 0.02, z0: n0, z1: n1 }
                       : { x0: n0, x1: n1, y0: -1, y1: FH - 0.02, z0: t0, z1: t1 });
          }
          return kc.length ? kc : null;
        })(),
        pal: MPAL || { wall: color, stone: TRIM, dirt: 0x2a2420, kind: "brick", id: null },
        color, TRIM, BASE, PIL, MULL,
        hash: bhash,
        dbox: dbox,
        lbox: lbox,
        /* A BODY FOR A DRESSING. dbox trim is merged into one deco mesh per
           colour, so a facade that draws something you would walk into — a
           column order on the front walk, cheek walls, a fire escape's hanging
           flight — had no mesh to measure and no way to say "this is solid"
           (this ctx is the facade kits' only door to the world). This is that
           door: a building-local box (same args as dbox) registered as a
           y-banded collider and filed on the building's own `cols`, so
           demolition/collapse take it down with the shell. Never a wall to
           the fracture/breach passes (noBreach); ref-less, so nothing is
           spared from the batcher on its account. */
        solid: function (lx, ly, lz, bw, bh, bd, so) {
          if (!(bw > 0) || !(bd > 0) || !(bh > 0)) return null;
          const c = { minX: ox + lx - bw / 2, maxX: ox + lx + bw / 2, minZ: oz + lz - bd / 2, maxZ: oz + lz + bd / 2,
            y0: ly - bh / 2, y1: ly + bh / 2, ref: null, noBreach: true };
          if (so && so.noCam) c.noCam = true;
          CBZ.colliders.push(c); cols.push(c);
          return c;
        },
        /* PAINT THE DOOR. The shell hangs the leaf long before a facade runs,
           and it has no idea what palette that facade is about to put on the
           walls — so the door was left in one fixed tone for every grammar. A
           facade knows its own colours, so it gets to pick one: this hands it
           the leaf and its stiles/rails to tint. The materials are CLONED on
           first use, because the untinted ones are shared singletons and
           writing to them would repaint every door in the city. */
        doorTint: function (leafHex, railHex) {
          for (let i = 0; i < doorRecs.length; i++) {
            const r = doorRecs[i];
            if (r.leaf && leafHex != null) {
              if (!r.leaf.userData.tinted) { r.leaf.material = r.leaf.material.clone(); r.leaf.userData.tinted = true; }
              r.leaf.material.color.setHex(leafHex);
            }
            if (r.rails && railHex != null) {
              if (!r.rails.userData.tinted) { r.rails.material = r.rails.material.clone(); r.rails.userData.tinted = true; }
              r.rails.material.color.setHex(railHex);
            }
          }
        },
        // building-local rect → a real walk PLATFORM (mirrored into b.platforms
        // so demolition can splice it back out). NO collider: a monumental
        // stair must never be able to seal a building's own front door.
        plat: function (lx0, lx1, lz0, lz1, top, ramp) {
          const p = { minX: ox + lx0, maxX: ox + lx1, minZ: oz + lz0, maxZ: oz + lz1, top: top };
          if (ramp) p.ramp = ramp;
          CBZ.platforms.push(p); plats.push(p);
        },
        ball: function (lx, ly, lz, r, col) { addMesh(new THREE.SphereGeometry(r, 10, 7), col, lx, ly, lz); },
        column: function (lx, ly, lz, r, h, col, seg) {
          addMesh(new THREE.CylinderGeometry(r, r, h, seg || 12), col, lx, ly + h / 2, lz);
        },
        cone: function (lx, ly, lz, r, h, col) { addMesh(new THREE.ConeGeometry(r, h, 14), col, lx, ly + h / 2, lz); },
        // r128 SphereGeometry(radius, wSeg, hSeg, phiStart, phiLength, thetaStart, thetaLength)
        // — thetaLength = PI/2 gives the upper hemisphere (a real dome shell).
        dome: function (lx, ly, lz, r, col) {
          addMesh(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), col, lx, ly, lz);
        },
        lamp: function (lx, ly, lz, r, col) { addMesh(new THREE.SphereGeometry(r, 8, 6), col, lx, ly, lz, true); },
        // a clock face on one side of a belfry: disc + bezel + two hands
        disc: function (lx, ly, lz, r, horiz, sg, faceCol, handCol) {
          const bez = addMesh(new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.12, 20), handCol, lx, ly, lz);
          const fc = addMesh(new THREE.CylinderGeometry(r, r, 0.16, 20), faceCol, lx, ly, lz);
          for (const m of [bez, fc]) { if (horiz) m.rotation.x = Math.PI / 2; else m.rotation.z = Math.PI / 2; }
          const hOff = horiz ? [0, 0, sg * 0.11] : [sg * 0.11, 0, 0];
          const hr = addMesh(new THREE.BoxGeometry(horiz ? 0.09 : 0.06, r * 1.15, horiz ? 0.06 : 0.09), handCol,
            lx + hOff[0], ly + r * 0.34, lz + hOff[2]);
          const mn = addMesh(new THREE.BoxGeometry(horiz ? r * 1.2 : 0.06, 0.09, horiz ? 0.06 : r * 1.2), handCol,
            lx + hOff[0], ly - r * 0.12, lz + hOff[2]);
          hr.castShadow = mn.castShadow = false;
        },
        // ---- the ONLY textured (canvas `map`) meshes a building emits, and
        // only on civic anchors: core/batch.js spares anything with a map, so
        // this is 2 extra draw calls on ~4-6 buildings city-wide. Deliberate.
        plaque: function (f, cy, pw, ph, text, stoneHex) {
          if (!CBZ.civicPlaqueTex || pw < 1.2) return;
          const halfN = (f.horiz ? d : w) / 2;
          const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph),
            new THREE.MeshBasicMaterial({ map: CBZ.civicPlaqueTex(text, stoneHex) }));
          if (f.horiz) { m.position.set(0, cy, f.out * (halfN + 0.38)); m.rotation.y = f.out > 0 ? 0 : Math.PI; }
          else { m.position.set(f.out * (halfN + 0.38), cy, 0); m.rotation.y = f.out > 0 ? Math.PI / 2 : -Math.PI / 2; }
          m.renderOrder = 2; bgroup.add(m);
        },
        seal: function (f, cy, r, kind) {
          if (!CBZ.civicSealTex || r < 0.4) return;
          const halfN = (f.horiz ? d : w) / 2;
          const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2),
            new THREE.MeshBasicMaterial({ map: CBZ.civicSealTex(kind), transparent: true }));
          if (f.horiz) { m.position.set(0, cy, f.out * (halfN + 0.62)); m.rotation.y = f.out > 0 ? 0 : Math.PI; }
          else { m.position.set(f.out * (halfN + 0.62), cy, 0); m.rotation.y = f.out > 0 ? Math.PI / 2 : -Math.PI / 2; }
          m.renderOrder = 3; bgroup.add(m);
        },
      };
      /* THE PARCEL LINE. opts.reach = how far past the wall the parcel runs
         before the footway starts (Gang City: the lot's front setback). All
         dressing — masonry trim, the civic order and its steps, the facade
         kit, the door reveal — goes through ctxC, so this one fence keeps
         every piece of it off the pavement: a box that crosses the line is
         cut back to it, one wholly outside is dropped, a round piece (column,
         ball, dome) outside it is dropped, a walk platform is clamped. */
      if (opts.reach != null && opts.reach >= 0) {
        const LX = w / 2 + opts.reach, LZ = d / 2 + opts.reach;
        const clipBox = function (fn) {
          return function (x, y, z, bw, bh, bd) {
            const x0 = Math.max(-LX, x - bw / 2), x1 = Math.min(LX, x + bw / 2);
            const z0 = Math.max(-LZ, z - bd / 2), z1 = Math.min(LZ, z + bd / 2);
            if (x1 - x0 < 0.02 || z1 - z0 < 0.02) return;
            const a = Array.prototype.slice.call(arguments);
            a[0] = (x0 + x1) / 2; a[2] = (z0 + z1) / 2; a[3] = x1 - x0; a[5] = z1 - z0;
            return fn.apply(this, a);
          };
        };
        const inside = function (x, z, r) { return Math.abs(x) + r <= LX + 1e-3 && Math.abs(z) + r <= LZ + 1e-3; };
        ctxC.dbox = clipBox(ctxC.dbox);
        ctxC.lbox = clipBox(ctxC.lbox);
        ctxC.solid = clipBox(ctxC.solid);
        for (const nm of ["ball", "column", "cone", "dome", "lamp"]) {
          const fn0 = ctxC[nm];
          ctxC[nm] = function (x, y, z, r) { if (inside(x, z, r || 0)) return fn0.apply(this, arguments); };
        }
        const plat0 = ctxC.plat;
        ctxC.plat = function (x0, x1, z0, z1, top, ramp) {
          const a0 = Math.max(-LX, x0), a1 = Math.min(LX, x1), b0 = Math.max(-LZ, z0), b1 = Math.min(LZ, z1);
          if (a1 - a0 < 0.05 || b1 - b0 < 0.05) return;
          return plat0.call(this, a0, a1, b0, b1, top, ramp);
        };
      }
      if (MASONRY) {
        // BRICK/STONE VENEER — the spandrel band under every storey's sills plus
        // the header band under each floor line (never the TOP one: the corbelled
        // cornice covers it, so those tiles would be pure waste). Bounded by
        // construction: solid bands only, so brick never crosses a window.
        if (VENEER_ON) {
          for (let k = 0; k < storeys; k++) {
            if (opts.garageGround && k === 0) continue;
            for (let s = 0; s < 4; s++) {
              const isFront = (k === 0 && s === doorSide);
              if (isFront && (opts.showroom || opts.retail)) continue;   // storefront owns that band
              veneerBand(s, k * FH + 0.12, k * FH + MSILL - 0.05, isFront ? (DOORW / 2 + 0.4) : 0);
              if (k < storeys - 1) veneerBand(s, (k + 1) * FH - MHDR + 0.06, (k + 1) * FH - 0.10, 0);
            }
          }
        }
        if (CBZ.bldMasonryDress) CBZ.bldMasonryDress(ctxC);
        if (CBZ.bldGhostSign && punched) CBZ.bldGhostSign(ctxC);
      }
      if (civicF && civicSpec) {
        if (CBZ.bldCivicOrder) CBZ.bldCivicOrder(ctxC);
        if (CBZ.bldCivicCrown) CBZ.bldCivicCrown(ctxC);
      }
      // ---- THE FACADE KIT (city/facade_kit.js + city/facades/*.js) --------
      // The generalisation of what govcomplex.js does to this same building:
      // an object literal at the call site turns the base office shell into a
      // brick loft / an ashlar bank / a mosque / a pagoda, deriving every
      // dimension from w, d, storeys, FH and rTop. Emitted here so it lands in
      // the merged deco buckets below — a dressed building is draw-call equal
      // to a bare one. Returns the def so we can tell whether it took the roof.
      // THE SKIN is recorded as the kit paints (see skinNote): every box a
      // grammar lays on a face, by colour and area.
      const skinAcc = [new Map(), new Map(), new Map(), new Map()];
      const hostDbox = ctxC.dbox, hostLbox = ctxC.lbox;
      ctxC.dbox = function (x, y, z, bw, bh, bd, col) {
        skinNote(skinAcc, w, d, x, y, z, bw, bh, bd, col);
        return hostDbox.apply(this, arguments);
      };
      ctxC.lbox = function (x, y, z, bw, bh, bd, col) {
        skinNote(skinAcc, w, d, x, y, z, bw, bh, bd, col);
        return hostLbox.apply(this, arguments);
      };
      const dressed = CBZ.dressFacade ? CBZ.dressFacade(ctxC) : null;
      if (dressed) dressedId = dressed.id;
      ctxC.dbox = hostDbox; ctxC.lbox = hostLbox;
      if (dressed) {
        const pk = skinPick(skinAcc, w, d, storeys * FH);
        if (pk) {
          const sm = SKIN_OF_STRUCTURE[dressed.structure] || [null, "concrete"];
          skin = { faces: pk.faces, hex: pk.hex, pattern: sm[0], kind: sm[1], masonry: null };
        }
      }
      // ROOF CLUTTER on every real building (not just masonry) — flat empty
      // roofs are the second-biggest "this is a box" tell after flat facades.
      // Skipped on civic anchors: their DOME / CLOCK TOWER already owns the
      // roof centre, and a water tank next to a courthouse dome is comedy.
      // Skipped for the same reason when a facade crowned its own roof.
      // A roof somebody else crowned (a dome, a clock tower, a mansard, a
      // mosque) is not a plant deck: world/building_dress.js reads this flag
      // and leaves it alone. Everything else gets its roof plant there, after
      // the lifts, stashes and helipad have claimed their ground.
      roofCrowned = !!((civicF && civicSpec) || (dressed && dressed.crownsRoof) || opts.garageGround);
    }
    flushDeco();

    // PER-FLOOR ARRIVAL HEIGHTS (ground..roof) for the elevator agent's multi-
    // stop logic (elevators.js consumes b.floorTops). Each entry is the exact
    // slab-TOP a rider stands on at that floor: the foundation floor's walkable
    // top is 0.14 (lbox(0,-0.21,...,0.7,...) → top -0.21+0.35=0.14), and every
    // upper floor L=1..storeys is the slab at lbox(...,L*FH-0.1,...,0.2,...) →
    // top L*FH. floorTops[0]=ground, floorTops[storeys]=roof. Real slab math.
    const floorTops = [0.14];
    for (let L = 1; L <= storeys; L++) floorTops.push(L * FH);

    const built = { group: bgroup, ox, oz, w, d, h: storeys * FH, storeys, facade: FACADE,
      wallColor: color, masonry: MASONRY ? (MPAL ? MPAL.id : true) : null,
      skin,                                          // the visible wall skin per face (CBZ.citySkin)   // the FINAL wall colour/colourway (masonry overrides the caller's), so exterior dressers match the shell
      boarded: !!opts.boarded, office: !!opts.office, parapetH: pp, roofCrown: crownRect, roofCrowned, colliders: cols, platforms: plats, windows, losMeshes, doors: doorRecs, lbox, FH,
      civicOrder: civicOrderRec,                    // bldCivicOrder's built front (building-local), or null
      clearFloorPoint, wt: WT,                      // wt: exact wall thickness, so elevators.js seats rigs flush to the real facade
      localDoor,                                    // building-local doorway + INWARD normal (interior programs orient rooms off the way you arrive)
      floorSlabs,                                   // intermediate floor slabs, each a carvable list of pieces (CBZ.cityCarveShaft)
      roofSlab,                                     // the roof slab, same record (carved only for a stair bulkhead)
      floorTops,                                    // per-floor arrival Y (ground..roof) — elevators.js multi-stop contract
      shaftRects,                                   // reserved shaft footprints (building-local), so clearFloorPoint keeps later furniture/props out of the chase
      keepRects,                                    // reserved walk-through floor (the stair core's landing mouth)
      stairPlan: null,                              // where this shell's stair core goes (cityStairPlan), built lazily by elevators.js
      dress: DRESS || (DRESS === false ? false : null),   // the facade-kit spec this shell was built with (false = opted out); structural.js asks facadePick with it
      dressStyle: dressedId,                         // the grammar actually worn (null = bare shell)
      reach: opts.reach != null ? opts.reach : null, // parcel depth past the wall (the footway starts there)
      roofCx: ox + slabCx, roofCz: oz + slabCz };   // world centre of the solid roof slab (clear of the -x stairwell)
    // A swinging entrance only speaks when this player caused its cycle or is
    // physically inside THIS shell. Keep the ownership link on the mechanism,
    // not on a global "indoors" flag that could bless a different building.
    for (const dr of doorRecs) dr.building = built;
    // THE STAIR CORE IS RESERVED NOW, built later. Every multi-storey shell
    // gets a switchback core (elevators.js CBZ.cityStairCore builds it the
    // first time somebody walks up to the building). Its footprint and the
    // landing in front of its door are reserved HERE, before any furnisher,
    // the lift's lobby pick or the roof dresser runs, so all of them already
    // keep out of it. (The parking-deck flagship has its own lift + exec core.)
    if (storeys >= 2 && opts.stairs !== false && !opts.garageGround) {
      const plan = CBZ.cityStairPlan(built);
      if (plan) {
        built.stairPlan = plan;
        shaftRects.push(plan.rect);
        keepRects.push(plan.mouth);
      }
    }
    // THE SHELL A WALL BELONGS TO, reachable from any collider in one hop
    // (collider.ref.parent.userData.bld). carveHole needs it to answer "what
    // STOREY is this 0.55 m spandrel a course of" — see A CURTAIN WALL IS AN
    // ASSEMBLY, NOT A BOX. Nothing else may treat this as an ownership edge;
    // it is a read-only back-pointer to a record this function already made.
    bgroup.userData.bld = built;
    // ---- THE SHELL REGISTRY (read by core/farcull.js's distance skyline) ----
    // WHAT BUILDINGS EXIST had only ever been answerable through `arena.lots`,
    // and a lot is an ECONOMY record — Zillow, shops, jobs, map POIs. Four
    // builders raise real shells and sell nothing, so they wrote no lot:
    // govcomplex.js's nine complexes, island_military.js, island_airport.js's
    // terminal and biome_forest.js's cabins. They therefore had NO distance
    // LOD box at all, and past the cull radius their walls were culled while
    // their pooled panes, interior mullion strips and brick veneer — which
    // live in sector pools on the CITY ROOT, not inside the shell — kept
    // drawing: the see-through frame city on empty ground.
    // Every shell in the game is minted by this one function, so this is the
    // only place that can answer the question without anybody opting in.
    // It hangs off the ROOT ON PURPOSE: a rebuilt world gets a new root and
    // therefore a fresh list by construction, where a module-level array would
    // hand the next world the previous one's coordinates — which is the actual
    // ghost city this registry exists to prevent.
    if (root && root.userData) (root.userData.shells || (root.userData.shells = [])).push(built);
    return built;
  }
  // The connected island district reuses the exact same enterable shell and
  // stair rig, so every added tower behaves like the original city buildings.
  CBZ.cityMakeBuilding = makeBuilding;
  // The ONE shared translucent glass material (windows/shards/awnings pool).
  // Exported so interior builders outside this file (city/exec_office.js's
  // meeting-room front) share the same cached material instance instead of
  // minting a lookalike — one material, one batch bucket, zero extra state.
  CBZ.cityGlassMat = glassMat;

  // ---- THE SLAB CARVE ----------------------------------------------------
  // A floor slab is a LIST OF PIECES ({mesh, plat}), not one box. Every hole
  // cut through it (a lift chase, a stair core) splits EVERY piece it touches
  // into up to four rim pieces, so any number of holes land in any order.
  //
  // WHY (measured, stairs wave 2026-09-28): the old carve marked a slab
  // `carved` after its first hole and skipped it forever after. Every
  // building whose lift carved first kept its WHOLE slab over the stairwell
  // the stair core carved later: the floor platform stayed across the flight
  // (descending walked out onto it and never went down; climbing put the head
  // through it). The lead measured it in the live city: route(2,0) from 6.4 m
  // ended at 6.4 m. elevators.js called the skip "harmless". It was the bug.
  //
  // A carve that happens AFTER core/batch.js merged the shell (a stair core
  // built the first time you walk up) must also take the slab out of the
  // merged buffer: CBZ.batchWallHide zeroes its vertex slice (the same seam
  // cityFracture punches walls with); unmerged pieces are simply detached.
  function slabRecord(mesh, plat, y, isRoof) {
    return { y: y, roof: !!isRoof, mat: mesh.material, cast: !!mesh.castShadow,
             pieces: [{ mesh: mesh, plat: plat }], holes: [], carved: false };
  }
  let _slabGeo = null;
  function slabPiece(b, fs, x0, x1, z0, z1) {
    if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return null;
    if (!_slabGeo) _slabGeo = unitBoxGeo(true, false);
    const m = new THREE.Mesh(_slabGeo, fs.mat);
    m.position.set((x0 + x1) / 2 - b.ox, fs.y, (z0 + z1) / 2 - b.oz);
    m.scale.set(x1 - x0, 0.2, z1 - z0);
    m.castShadow = fs.cast; m.receiveShadow = true;
    b.group.add(m);
    if (CBZ.losBlockers) CBZ.losBlockers.push(m);
    if (b.losMeshes) b.losMeshes.push(m);
    const pl = { minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: fs.y + 0.1 };
    if (CBZ.platforms) CBZ.platforms.push(pl);
    if (b.platforms) b.platforms.push(pl);
    return { mesh: m, plat: pl };
  }
  function dropPiece(b, pc) {
    const m = pc.mesh;
    if (m) {
      if (CBZ.batchWallHide) CBZ.batchWallHide(m);     // merged into the shell's buffer: zero its slice
      if (m.parent) m.parent.remove(m);
      for (const list of [CBZ.losBlockers, b.losMeshes]) { const i = list ? list.indexOf(m) : -1; if (i >= 0) list.splice(i, 1); }
    }
    for (const list of [CBZ.platforms, b.platforms]) { const i = list ? list.indexOf(pc.plat) : -1; if (i >= 0) list.splice(i, 1); }
  }
  // cut the world rect [hx0,hx1]x[hz0,hz1] out of one slab record; true if it touched
  function carveSlab(b, fs, hx0, hx1, hz0, hz1) {
    if (!fs || !fs.pieces) return false;
    let hit = false;
    const next = [];
    for (const pc of fs.pieces) {
      const p = pc.plat;
      if (!p || hx1 <= p.minX || hx0 >= p.maxX || hz1 <= p.minZ || hz0 >= p.maxZ) { next.push(pc); continue; }
      hit = true;
      dropPiece(b, pc);
      const cx0 = Math.max(hx0, p.minX), cx1 = Math.min(hx1, p.maxX);
      const cz0 = Math.max(hz0, p.minZ), cz1 = Math.min(hz1, p.maxZ);
      for (const r of [[p.minX, p.maxX, p.minZ, cz0], [p.minX, p.maxX, cz1, p.maxZ],
                       [p.minX, cx0, cz0, cz1], [cx1, p.maxX, cz0, cz1]]) {
        const q = slabPiece(b, fs, r[0], r[1], r[2], r[3]);
        if (q) next.push(q);
      }
    }
    fs.pieces = next;
    if (hit) { fs.holes.push({ minX: hx0, maxX: hx1, minZ: hz0, maxZ: hz1 }); fs.carved = true; }
    return hit;
  }
  // PUBLIC. Given a world-space column (centre wx/wz, half-extents hw/hd):
  //   1) reserves it (building-local) in b.shaftRects — unless the same rect is
  //      already reserved (the stair core reserved itself at shell creation) —
  //      so any LATER furniture/prop gates off it via clearFloorPoint;
  //   2) cuts it out of every intermediate floor slab (and, with opts.roof,
  //      the roof slab too — a stair core surfacing in a bulkhead).
  // Returns the number of slabs it opened.
  CBZ.cityCarveShaft = function (b, wx, wz, hw, hd, opts) {
    if (!b || !b.floorSlabs) return 0;
    opts = opts || {};
    if (b.shaftRects && opts.reserve !== false) {
      const r = { x0: wx - b.ox - hw, x1: wx - b.ox + hw, z0: wz - b.oz - hd, z1: wz - b.oz + hd };
      // the slabs it opens (lbox clips its drawing out of exactly those)
      if (Array.isArray(opts.levels)) r.levels = opts.levels.slice();
      const dup = b.shaftRects.some((q) => Math.abs(q.x0 - r.x0) < 1e-3 && Math.abs(q.x1 - r.x1) < 1e-3
        && Math.abs(q.z0 - r.z0) < 1e-3 && Math.abs(q.z1 - r.z1) < 1e-3);
      if (!dup) b.shaftRects.push(r);
    }
    const hx0 = wx - hw, hx1 = wx + hw, hz0 = wz - hd, hz1 = wz + hd;
    let n = 0;
    // opts.levels: carve only the listed storey slabs (1 = the slab you stand
    // on upstairs of the ground floor). A grand stair that rises one storey
    // opens one slab, not a well through the whole house.
    const lv = Array.isArray(opts.levels) ? opts.levels : null;
    for (let i = 0; i < b.floorSlabs.length; i++) {
      if (lv && lv.indexOf(i + 1) < 0) continue;
      if (carveSlab(b, b.floorSlabs[i], hx0, hx1, hz0, hz1)) n++;
    }
    if (opts.roof && b.roofSlab && carveSlab(b, b.roofSlab, hx0, hx1, hz0, hz1)) n++;
    if (n && CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    return n;
  };

  // ---- WHERE THE STAIR CORE GOES -------------------------------------------
  // CBZ.cityStairPlan(b, side?) — pure geometry, no meshes. A switchback core
  // two lanes wide, flush into a back corner (the far wall from the street
  // door + one side wall), its door facing back into the room. makeBuilding
  // reserves plan.rect (the core and its walls) and plan.mouth (the landing
  // outside its door) the moment the shell exists; elevators.js
  // CBZ.cityStairCore builds the flights, walls and carves from the SAME plan.
  //
  // Frame: `dep` = metres from the DOOR wall's inner face toward the far wall,
  // `lat` = metres across, from the centreline (tx,tz = the lateral unit).
  // Sizes: CW 4.4 = two 2.2 m lanes (a 0.38 m body + rails, and two people
  // pass); CD 5.6 = a 1.3 m landing at each end and a 3.0 m run, which for a
  // 1.6 m half-storey rise (FH 3.2) is a 28 degree stair of 9 x 0.178 m risers
  // on 0.33 m goings. A tight plan shrinks to CW 3.0 / CD 4.4 (a 1.8 m run,
  // 42 degrees: steep, still under STEP_UP per 0.29 m substep) and below that
  // there is no core rather than an unwalkable one.
  const CORE_W = 4.4, CORE_WMIN = 3.0, CORE_D = 5.6, CORE_DMIN = 4.4, MOUTH_D = 1.6, MOUTH_HW = 1.2;
  function stairPlanFor(b, side) {
    const wt = b.wt != null ? b.wt : WT;
    const ixMin = -b.w / 2 + wt, ixMax = b.w / 2 - wt, izMin = -b.d / 2 + wt, izMax = b.d / 2 - wt;
    const dn = b.localDoor || { x: 0, z: -b.d / 2, nx: 0, nz: 1 };
    const nx = dn.nx, nz = dn.nz, along = Math.abs(nx) > 0.5;
    const tx = -nz, tz = nx;
    const base = along ? { x: nx > 0 ? ixMin : ixMax, z: (izMin + izMax) / 2 }
                       : { x: (ixMin + ixMax) / 2, z: nz > 0 ? izMin : izMax };
    const depthSpan = along ? ixMax - ixMin : izMax - izMin;
    const latSpan = along ? izMax - izMin : ixMax - ixMin;
    const CW = Math.min(CORE_W, latSpan - 2.2);
    // A taller storey needs a longer run for the same pitch: the core grows
    // with the shell's own FH (x1 at the 3.2 m contract), capped by the plate.
    const fhK = Math.max(1, (b.FH > 0 ? b.FH : FH) / FH);
    const CD = Math.min(CORE_D * fhK, depthSpan - MOUTH_D - 3.0);   // leave the room a floor between door and core
    if (CW < CORE_WMIN || CD < CORE_DMIN) return null;
    const pt = function (dep, lat) { return { x: base.x + nx * dep + tx * lat, z: base.z + nz * dep + tz * lat }; };
    const rect = function (d0, d1, l0, l1) {
      const p = pt(d0, l0), q = pt(d1, l1);
      return { x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), z0: Math.min(p.z, q.z), z1: Math.max(p.z, q.z) };
    };
    const D1 = depthSpan, D0 = D1 - CD;
    const L1 = side * (latSpan / 2), L0 = L1 - side * CW, latMid = (L0 + L1) / 2;
    return {
      side: side, along: along, nx: nx, nz: nz, tx: tx, tz: tz, base: base, pt: pt, rect2: rect,
      D0: D0, D1: D1, L0: L0, L1: L1, latMid: latMid, CW: CW, CD: CD,
      hole: rect(D0, D1, L0, L1),                                     // what the slabs lose
      rect: rect(D0 - 0.12, D1, L0 - side * 0.12, L1),               // + its shaft wall and door stubs
      mouth: rect(D0 - MOUTH_D, D0 - 0.12, latMid - MOUTH_HW, latMid + MOUTH_HW),
    };
  }
  function rectsHit(a, b2, pad) {
    return a.x0 < b2.x1 + pad && a.x1 > b2.x0 - pad && a.z0 < b2.z1 + pad && a.z1 > b2.z0 - pad;
  }
  CBZ.cityStairPlan = function (b, side) {
    if (!b || b.w == null || b.d == null) return null;
    const dn = b.localDoor || { nx: 0, nz: 1 };
    const pref = side === 1 || side === -1 ? side
      : (Math.abs(dn.nx) > 0.5 ? (dn.nx > 0 ? -1 : 1) : (CBZ.hash01(b.ox || 0, b.oz || 0, 0x57a1) < 0.5 ? -1 : 1));
    const wt = b.wt != null ? b.wt : WT;
    const door = b.localDoor ? { x0: b.localDoor.x - 1.3, x1: b.localDoor.x + 1.3, z0: b.localDoor.z - 1.3, z1: b.localDoor.z + 1.3 } : null;
    for (const s2 of [pref, -pref]) {
      const P = stairPlanFor(b, s2);
      if (!P) return null;
      let bad = false;
      // never over a reserved chase that is not this core's own (a lift built
      // before the plan existed), nor over the street door's threshold
      for (const r of (b.shaftRects || [])) if (r !== (b.stairPlan && b.stairPlan.rect) && (rectsHit(P.rect, r, 0.9) || rectsHit(P.mouth, r, 0.3))) bad = true;
      if (door && (rectsHit(P.rect, door, 0) || rectsHit(P.mouth, door, 0))) bad = true;
      if (!bad) return P;
    }
    return null;
  };

  // THE LONGEST CLEAR RUN for a wall-hugging fixture (a shop counter): a
  // segment along x (alongX) or z centred `c` with half-length `half`, whose
  // cross band is [c0, c1], slid and if need be shortened so it misses every
  // reserved rect (stair core + its landing, lift chase) by 0.3 m. Returns
  // {c, half} (unchanged when already clear) or null when nothing fits 1.8 m.
  function freeRun(b, alongX, c0, c1, c, half, lo, hi) {
    const R = (b.shaftRects || []).concat(b.keepRects || []);
    const cuts = [];
    for (const r of R) {
      const b0 = alongX ? r.z0 : r.x0, b1 = alongX ? r.z1 : r.x1;
      if (b1 <= c0 || b0 >= c1) continue;
      cuts.push([(alongX ? r.x0 : r.z0) - 0.3, (alongX ? r.x1 : r.z1) + 0.3]);
    }
    if (!cuts.length) return { c: c, half: half };
    cuts.sort((p, q) => p[0] - q[0]);
    const runs = [];
    let a = lo;
    for (const k of cuts) { if (k[0] > a) runs.push([a, Math.min(k[0], hi)]); a = Math.max(a, k[1]); }
    if (a < hi) runs.push([a, hi]);
    let best = null;
    for (const r of runs) {
      const len = r[1] - r[0];
      if (len < 1.8) continue;
      const hh = Math.min(half, len / 2);
      const cc = Math.max(r[0] + hh, Math.min(r[1] - hh, c));
      const score = hh * 10 - Math.abs(cc - c);
      if (!best || score > best.score) best = { c: cc, half: hh, score: score };
    }
    return best;
  }

  // a back-wall shop counter (centre ccx/ccz, size cw x cd, building-local)
  // slid / narrowed along its wall onto the run clear of the reserved stair
  // core and lift chase. doorNx: the door's inward x normal (0 = door on a
  // ±z wall, so the counter runs along x). Shared by city + town shops.
  function fitCounter(b, doorNx, ccx, ccz, cw, cd) {
    const alongX = !doorNx, wt = b.wt != null ? b.wt : WT;
    const c0 = alongX ? ccz - cd / 2 - 1.4 : ccx - cw / 2 - 1.4;     // its band + the clerk behind it
    const c1 = alongX ? ccz + cd / 2 + 1.4 : ccx + cw / 2 + 1.4;
    const fit = freeRun(b, alongX, c0, c1, alongX ? ccx : ccz, (alongX ? cw : cd) / 2,
      alongX ? -b.w / 2 + wt + 0.3 : -b.d / 2 + wt + 0.3, alongX ? b.w / 2 - wt - 0.3 : b.d / 2 - wt - 0.3);
    if (fit) { if (alongX) { ccx = fit.c; cw = Math.max(0.8, fit.half * 2); } else { ccz = fit.c; cd = Math.max(0.8, fit.half * 2); } }
    return { ccx, ccz, cw, cd };
  }
  CBZ.cityFitCounter = fitCounter;

  // doorway world position + the inward normal, given the door side
  function doorInfo(ox, oz, w, d, side) {
    if (side === 0) return { x: ox, z: oz - d / 2, nx: 0, nz: 1 };
    if (side === 1) return { x: ox, z: oz + d / 2, nx: 0, nz: -1 };
    if (side === 2) return { x: ox - w / 2, z: oz, nx: 1, nz: 0 };
    return { x: ox + w / 2, z: oz, nx: -1, nz: 0 };
  }

  // ---- REUSABLE INTERIOR ROOM-KIT ----------------------------------------
  // WHY: lots are huge (usable ~27-29u square, FH=4.6) but the old furnishers
  // dropped a sparse scatter into ONE undivided box. roomKit() is the shared
  // layer that turns a plate into PROGRAMMED ROOMS: partition walls (with real
  // doorways) + a furniture-set vocabulary.
  //
  // A WALL YOU WALK THROUGH IS A PAINTING OF A WALL (owner: "interiors have
  // tons of fake walls ... i dont like interior walls unless they are
  // intentional"). These partitions used to be NON-collider on purpose, which
  // meant every "room" in the game was a decal. They are SOLID now — and the
  // only callers left are the ones whose rooms are real: a HOME's bedroom
  // wing and the single-flat apartment fallback. The office bullpen's meeting
  // strip, its break corner and the penthouse's master suite were all fake
  // walls around furniture that reads fine on an open plate, and they are
  // deleted rather than made solid: open space is the default now.
  //
  // Still draw-call-cheap: cast:false, no userData, ONE shared wall colour
  // (PCOL) → core/batch.js merges a collider-referenced wall down its WALL
  // path (identity kept, hidden, zero extra draw calls) exactly as it does the
  // building's own facade. Every placement is gated through clearFloorPoint so
  // the door aisle / stair strip / elevator shaftRects stay walkable. baseY
  // lifts the whole kit onto an upper floor (the furnishPenthouse/furnishHome
  // precedent).
  const PWT = 0.16;          // thin partition thickness (one place, shared by pool floor too)
  const PCOL = 0xb9bcc4;     // one shared partition colour bucket
  const KITWALL = { cast: false, solid: true };   // a partition is a WALL, not a decal

  // ---- THE SHELL IS THE LAW ------------------------------------------------
  // OWNER: "INTERIORS SHOULD NOT SPILL ONTO THE STREET AS MANY LIKE MERIDIAN
  // TRUST DO."  The dressers in this file do not agree with each other about
  // where the wall is: roomKit measures from ±(w/2 − wt − 0.4) and
  // furnishInterior measures every `lat`/`inDepth` from ±w/2 — the OUTSIDE of
  // the building — so "hug the side wall" lands inside the plaster and the
  // bank's vault partition ran clean through the facade. Rather than re-typing
  // ~200 coordinates (and having the next dresser re-type the mistake), every
  // furnish pass runs inside city/interior_programs.js's ONE clamp: a box
  // outside the shell is refused, a box straddling a wall is trimmed to the
  // wall face. It covers this file's boxes, the interior programs' boxes,
  // roombuild.js's planner and furniture.js's kit, because all four draw
  // through the SAME `b.lbox`. Degrade-safe: no kit, no clamp, no change.
  /* THE GROUND FLOOR IS THE SLAB TOP, NOT 0. Every shell pours a foundation
     slab whose top is floorTops[0] (0.14). Anything a dresser lays "on the
     ground floor" at y = 0 is INSIDE that slab: floor tints, mats and bay
     stripes vanish and furniture stands sunk in the concrete. One answer for
     every caller, instead of a copy of this ternary per file. */
  function groundTop(b) {
    return (b && Array.isArray(b.floorTops) && b.floorTops[0] != null) ? b.floorTops[0] : 0.14;
  }
  CBZ.cityGroundTop = groundTop;
  function bounded(b, site, fn) {
    return CBZ.interiorBounded ? CBZ.interiorBounded(b, fn, site) : fn();
  }
  function roomKit(b, baseY) {
    const W = b.w, D = b.d, FHl = b.FH || FH, Y = baseY || 0;
    const WALLH = FHl - 0.05;
    // usable band, clear of the facade walls
    const xLo = -W / 2 + (b.wt || WT) + 0.4;
    const xHi = W / 2 - (b.wt || WT) - 0.4;
    const zLo = -D / 2 + (b.wt || WT) + 0.4;
    const zHi = D / 2 - (b.wt || WT) - 0.4;
    // clearFloorPoint-gated opaque box (cast:false, batch-safe, NON-collider)
    function put(x, y, z, w, h, d, c, pad) {
      if (b.clearFloorPoint && !b.clearFloorPoint(x, z, pad == null ? 0.7 : pad)) return false;
      b.lbox(x, Y + y, z, w, h, d, c, { cast: false });
      return true;
    }
    function glow(x, y, z, w, h, d, c, ei, pad) {
      if (b.clearFloorPoint && !b.clearFloorPoint(x, z, pad == null ? 0.7 : pad)) return false;
      b.lbox(x, Y + y, z, w, h, d, c, { emissive: c, ei: ei || 0.5, cast: false });
      return true;
    }
    // a partition never crosses a reserved stair core / lift chase / stair
    // landing: its runs are cut where one lies across its line (the core's own
    // wall closes the end)
    function clipRuns(segs, alongX, at) {
      const R = (b.shaftRects || []).concat(b.keepRects || []);
      let out = segs;
      for (const r of R) {
        const c0 = alongX ? r.z0 : r.x0, c1 = alongX ? r.z1 : r.x1;
        if (at + PWT / 2 <= c0 || at - PWT / 2 >= c1) continue;
        const r0 = alongX ? r.x0 : r.z0, r1 = alongX ? r.x1 : r.z1, nx = [];
        for (const sg of out) {
          if (sg[1] <= r0 || sg[0] >= r1) { nx.push(sg); continue; }
          if (sg[0] < r0) nx.push([sg[0], r0]);
          if (sg[1] > r1) nx.push([r1, sg[1]]);
        }
        out = nx;
      }
      return out;
    }
    // a full-height SOLID partition running along X at fixed z (x0..x1), split
    // into ≤2 spans around a doorway centred at gapX (width gapW) with a lintel
    // over it. Collider-backed: you walk around it or through the doorway.
    function wallX(z, x0, x1, gapX, gapW) {
      gapW = gapW || 1.6;
      const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
      const g0 = gapX != null ? gapX - gapW / 2 : hi + 1, g1 = gapX != null ? gapX + gapW / 2 : hi + 1;
      const segs = clipRuns(gapX != null && gapX > lo && gapX < hi ? [[lo, g0], [g1, hi]] : [[lo, hi]], true, z);
      for (let i = 0; i < segs.length; i++) {
        const s0 = segs[i][0], s1 = segs[i][1]; if (s1 - s0 < 0.2) continue;
        b.lbox((s0 + s1) / 2, Y + WALLH / 2, z, s1 - s0, WALLH, PWT, PCOL, KITWALL);
      }
      if (gapX != null && gapX > lo && gapX < hi)   // lintel over the doorway so it reads as a portal
        b.lbox(gapX, Y + WALLH - 0.18, z, gapW, 0.36, PWT, PCOL, KITWALL);
    }
    // a full-height SOLID partition running along Z at fixed x (z0..z1), doorway at gapZ.
    function wallZ(x, z0, z1, gapZ, gapW) {
      gapW = gapW || 1.6;
      const lo = Math.min(z0, z1), hi = Math.max(z0, z1);
      const g0 = gapZ != null ? gapZ - gapW / 2 : hi + 1, g1 = gapZ != null ? gapZ + gapW / 2 : hi + 1;
      const segs = clipRuns(gapZ != null && gapZ > lo && gapZ < hi ? [[lo, g0], [g1, hi]] : [[lo, hi]], false, x);
      for (let i = 0; i < segs.length; i++) {
        const s0 = segs[i][0], s1 = segs[i][1]; if (s1 - s0 < 0.2) continue;
        b.lbox(x, Y + WALLH / 2, (s0 + s1) / 2, PWT, WALLH, s1 - s0, PCOL, KITWALL);
      }
      if (gapZ != null && gapZ > lo && gapZ < hi)
        b.lbox(x, Y + WALLH - 0.18, gapZ, PWT, 0.36, gapW, PCOL, KITWALL);
    }
    // PROPS_PURPOSE anchors — seats/beds the kit's furniture sets place
    // register sit/sleep spots for city/propuse.js (world = building-local +
    // b.ox/b.oz; y = this floor's Y). Feature-detected no-ops when absent.
    const abx = b.ox != null ? b.ox : 0, abz = b.oz != null ? b.oz : 0;
    // `cushion` is propuse.js's 7th `geom` argument — the cushion top ABOVE
    // this floor, and the ONLY thing that buys a seat the real feet-on-the-
    // floor pose instead of the legacy squat. It is OPTIONAL on purpose: a
    // caller may only declare it when its MESH actually has its sitting
    // surface there (propSeatRef refuses to infer for exactly this reason), so
    // a set that still draws a 0.90 block must keep passing nothing.
    function seatAt(x, z, face, kind, cushion) {
      if (CBZ.propRegisterSeat)
        CBZ.propRegisterSeat(abx + x, Y, abz + z, face, kind, null,
          cushion != null ? { cushion: cushion, floorBelow: 0 } : null);
    }
    function bedAt(x, z, hx, hz, len, topLocalY) { if (CBZ.propRegisterBed) CBZ.propRegisterBed(abx + x, Y, abz + z, hx, hz, len, Y + topLocalY, "bed", null); }
    // `b` rides along so the furniture sets below can reach b.lbox / b.ox /
    // b.oz / b.clearFloorPoint and hand a whole piece to CBZ.furnish (see
    // kitPiece) instead of re-typing it out of raw boxes.
    return { b: b, W: W, D: D, FHl: FHl, Y: Y, xLo: xLo, xHi: xHi, zLo: zLo, zHi: zHi, put: put, glow: glow, wallX: wallX, wallZ: wallZ, seatAt: seatAt, bedAt: bedAt };
  }

  // ---- THE KIT BRIDGE ------------------------------------------------------
  // ONE line replaces the 5-8 raw boxes plus the hand-rolled k.seatAt that
  // every furniture set below used to spell out: gate the piece's footprint on
  // the building's own aisle predicate, then let city/furniture.js draw it
  // THROUGH b.lbox (so it batch-folds into the buckets the shell already
  // merges) and register its own propuse anchor carrying the cushion height it
  // actually drew.
  //
  // Returns null when the kit is absent, the verb is unknown, the piece threw,
  // or the spot is on the door/stair aisle — so `if (!kitPiece(...)) { …old
  // boxes… }` is a complete, always-safe degrade path (BLOCK LAW #2), and
  // FURNISH_KIT=false puts every set back byte-for-byte.
  //
  // `pad` is the clearFloorPoint radius, defaulted to the 0.9 the sets already
  // use for a furniture-sized object: keeping the SAME pad is what stops a
  // migration from growing a footprint into a walkway and pushing
  // propUseAudit().blocked up (that counter may only go down).
  function kitPiece(k, name, x, z, yaw, o, pad) {
    const F = CBZ.furnish;
    if (!F || typeof F[name] !== "function") return null;
    const b = k && k.b;
    if (!b || typeof b.lbox !== "function") return null;
    if (b.clearFloorPoint && !b.clearFloorPoint(x, z, pad == null ? 0.9 : pad)) return null;
    const oo = { box: b.lbox, ox: b.ox != null ? b.ox : 0, oz: b.oz != null ? b.oz : 0 };
    if (o) for (const kk in o) if (oo[kk] === undefined) oo[kk] = o[kk];
    // F.lamp has no yaw (a lamp has no front) — furniture.js's one signature
    // exception, mirrored here and in world/roombuild.js's executor.
    try { return (name === "lamp") ? F.lamp(x, k.Y, z, oo) : F[name](x, k.Y, z, yaw, oo); }
    catch (e) { return null; }
  }

  // ---- FURNITURE-SET VOCABULARY ------------------------------------------
  // Each set takes a roomKit `k` and a room rect {x0,x1,z0,z1} (building-local)
  // and drops a focal-point-oriented cluster of ~4-8 cast:false boxes. Every
  // piece routes through k.put/k.glow so it stays off the aisle. Reused by the
  // apartment / home / office / shop programs below. WHY-first: each set reads as
  // a real, purposeful room, not scattered furniture.
  function rcx(r) { return (r.x0 + r.x1) / 2; }
  function rcz(r) { return (r.z0 + r.z1) / 2; }
  function setBedroom(k, r, linen) {
    linen = linen || 0x6b7da0;
    const cx = rcx(r), z0 = r.z0;
    k.put(cx, 0.02, rcz(r), Math.min(r.x1 - r.x0 - 0.6, 3.2), 0.04, Math.min(r.z1 - r.z0 - 0.6, 3.0), 0x4a3f4a, 1.2);  // rug
    // THE BED IS THE KIT'S. F.bed's yaw runs from the mattress centre toward
    // the PILLOW, so PI (forward = -z) puts the headboard against the r.z0
    // wall — the same wall the hand-rolled version leaned on, at the same
    // centre, at the same 0.55 mattress top, but with side rails, a duvet with
    // a turn-down fold and two pillows instead of nine flat slabs. The linen
    // colour the caller chose rides in as a literal tone so a migration never
    // repaints a room.
    const bedZ = z0 + 1.5;
    const bedW = Math.max(1.2, Math.min(1.9, r.x1 - r.x0 - 1.4));
    if (!kitPiece(k, "bed", cx, bedZ, Math.PI, { len: 2.2, wide: bedW, tone: { linen: linen } }, 1.0)) {
      // PROPS_PURPOSE: bed ENLARGED to fit a ~1.8u character (lie axis 1.7→2.2)
      // and registered as a SLEEP anchor (head at the z0/headboard end).
      k.put(cx, 0.35, z0 + 1.5, 2.0, 0.4, 2.2, 0x4a4036, 1.0);          // bed frame AGAINST wall
      if (k.put(cx, 0.62, z0 + 1.5, 1.9, 0.2, 2.1, linen, 1.0))         // mattress
        k.bedAt(cx, z0 + 1.5, 0, -1, 2.1, 0.72);
      k.put(cx, 0.8, z0 + 0.6, 1.9, 0.22, 0.5, 0xe8e8ee, 1.0);          // pillows
      k.put(cx, 1.15, z0 + 0.2, 2.1, 0.95, 0.16, 0x55606e, 1.0);        // headboard against wall
    }
    for (const s of [-1, 1]) { k.put(cx + s * 1.35, 0.4, z0 + 0.7, 0.5, 0.5, 0.5, 0x55452e, 0.9); }  // 2 nightstands
    k.glow(cx + 1.35, 0.8, z0 + 0.7, 0.36, 0.14, 0.36, 0xffe6b0, 0.5, 0.9);   // lamp
    // the wardrobe on the far wall is a LOCKER run: doors, handles, the same
    // 0.5 depth and the same corner. `n` is derived from the wall it has to
    // fit, so it never grows past the footprint the flat box occupied.
    const wardZ = Math.min(r.z1 - r.z0 - 1.2, 2.4);
    const nDoor = Math.max(2, Math.min(6, Math.floor(wardZ / 0.42)));
    if (!kitPiece(k, "locker", r.x1 - 0.6, rcz(r), -Math.PI / 2, { n: nDoor, h: 2.0 }, 0.9))
      k.put(r.x1 - 0.6, 1.1, rcz(r), 0.6, 2.0, wardZ, 0x2e2620, 0.9);  // wardrobe against far wall
  }
  function setLiving(k, r, sofa) {
    sofa = sofa || 0x8a5a2b;
    const cx = rcx(r), cz = rcz(r);
    k.put(cx, 0.02, cz, Math.min(r.x1 - r.x0 - 0.6, 3.4), 0.04, Math.min(r.z1 - r.z0 - 0.8, 2.8), 0x4a3f55, 1.4);  // rug
    // THE SOFA IS THE KIT'S. It was TWO boxes — a 0.55-tall slab with a second
    // slab behind it — and three seat anchors declaring nothing, which is what
    // put every living room in the game in propUseAudit().noGeom and gave
    // everybody who sat down the legacy squat. F.sofa is a plinth, a frame,
    // three SEPARATE seat cushions with real seams, three back cushions and two
    // padded arms, its cushion is the real 0.40, and it files its own anchors
    // with that number. Back to +z, so the sitters look -z at the media wall.
    if (!kitPiece(k, "sofa", cx, r.z1 - 1.0, Math.PI, { len: 2.6, tone: { cloth: sofa } }, 1.1)) {
      if (k.put(cx, 0.45, r.z1 - 1.0, 2.6, 0.55, 0.9, sofa, 1.1)) {     // sofa FLOATED, back to +z, ≥0.9 walkway behind
        // 3 SEAT anchors along the sofa, facing the TV wall (-z → face π)
        for (const sx of [-0.85, 0, 0.85]) k.seatAt(cx + sx, r.z1 - 1.0, Math.PI, "sofa");
      }
      k.put(cx, 0.88, r.z1 - 0.7, 2.6, 0.5, 0.22, sofa, 1.1);          // sofa back
    }
    // the coffee table was a 0.34-tall block whose top landed at 0.51 — HIGHER
    // than the sofa cushion it serves. F.coffee tops out at 0.40, level with
    // the cushion, on legs, with a magazine shelf under it.
    if (!kitPiece(k, "coffee", cx, cz, 0, { len: 1.4, deep: 0.8 }, 0.9))
      k.put(cx, 0.34, cz, 1.4, 0.34, 0.8, 0x6b4a2a, 0.9);              // coffee table
    k.put(cx, 0.4, r.z0 + 0.3, Math.min(r.x1 - r.x0 - 0.8, 3.2), 0.8, 0.4, 0x2a2f37, 0.9);  // media wall console
    k.put(cx, 1.4, r.z0 + 0.22, Math.min(r.x1 - r.x0 - 1.4, 2.6), 1.2, 0.1, 0x14171c, 0.9);  // TV on the media wall
    k.glow(cx, 1.4, r.z0 + 0.22 + 0.05 + SCREEN_GAP + 0.025,
      Math.min(r.x1 - r.x0 - 1.8, 2.2), 0.9, 0.05, 0x39516a, 0.4, 0.9);  // glass faces the sofa
  }
  function setKitchen(k, r) {
    const cz = rcz(r);
    // L counter on 2 walls: a back-wall run + a side-wall run
    k.put(rcx(r), 0.55, r.z1 - 0.55, r.x1 - r.x0 - 0.8, 1.0, 0.8, 0x55606e, 0.9);  // back-wall counter
    k.put(rcx(r), 1.08, r.z1 - 0.55, r.x1 - r.x0 - 0.7, 0.08, 0.9, 0xe6e8ee, 0.9); // worktop
    k.put(r.x1 - 0.55, 0.55, cz, 0.8, 1.0, r.z1 - r.z0 - 1.6, 0x55606e, 0.9);      // side-wall run (L)
    k.put(r.x1 - 0.55, 1.08, cz, 0.9, 0.08, r.z1 - r.z0 - 1.6, 0xe6e8ee, 0.9);     // worktop
    k.put(rcx(r), 1.95, r.z1 - 0.4, r.x1 - r.x0 - 1.0, 0.7, 0.4, 0x49505b, 0.9);   // upper cabinets
    k.put(rcx(r), 0.55, cz, 1.6, 1.0, 1.0, 0x49505b, 1.0);                          // island
    k.put(rcx(r), 1.08, cz, 1.7, 0.08, 1.1, 0xc8ccd4, 1.0);                         // island top
    // ISLAND STOOLS. The old pair were 0.9-tall blocks — top at 0.90, i.e. the
    // height of the worktop they were parked at — filed as kind "stool" with no
    // geometry, so propuse read them as undeclared and the rig squatted on the
    // worktop line. F.stool is a real pedestal stool with its cushion at the
    // 0.68 that goes with a 0.92 counter, and it declares it.
    for (const s of [-1, 1]) {
      const sx = rcx(r) + s * 0.55, face = Math.atan2(-s * 0.55, 0.9);
      if (kitPiece(k, "stool", sx, cz - 0.9, face, null, 0.9)) continue;
      if (k.put(sx, 0.45, cz - 0.9, 0.38, 0.9, 0.38, 0x3a2b1e, 0.9))  // 2 stools
        k.seatAt(sx, cz - 0.9, face, "stool");   // face the island
    }
    k.put(r.x0 + 0.6, 0.55, r.z1 - 0.55, 0.6, 1.0, 0.6, 0x2a2f37, 0.9);             // range/sink block
  }
  function setBath(k, r) {
    const cx = rcx(r), cz = rcz(r);
    k.put(cx, 0.02, cz, r.x1 - r.x0 - 0.4, 0.04, r.z1 - r.z0 - 0.4, 0x3a4250, 1.0);  // tile floor
    k.put(r.x1 - 0.8, 0.3, r.z1 - 1.0, 1.4, 0.6, 1.6, 0xd8dde6, 0.8);                // tub/shower base
    k.put(r.x1 - 0.8, 1.4, r.z1 - 1.0, 1.4, 1.6, 0.08, GLASS, 0.8);                  // shower glass
    k.put(r.x0 + 0.6, 0.45, cz, 0.7, 0.9, 1.2, 0x55606e, 0.8);                       // vanity
    k.put(r.x0 + 0.6, 0.92, cz, 0.8, 0.08, 1.3, 0xe6e8ee, 0.8);                      // vanity top
    k.put(cx, 0.3, r.z0 + 0.6, 0.5, 0.6, 0.6, 0xe8e8ee, 0.8);                        // toilet
  }
  function setDining(k, r) {
    const cx = rcx(r), cz = rcz(r);
    k.put(cx, 0.02, cz, Math.min(r.x1 - r.x0 - 0.6, 3.4), 0.04, Math.min(r.z1 - r.z0 - 0.6, 3.0), 0x3a2f3a, 1.4);  // rug
    // THE DINING SET IS ONE KIT CALL. F.table rings its own chairs, all facing
    // the centre, all declaring the 0.45 they actually draw — where the old set
    // drew six 0.9-tall blocks (top at 0.90: a chair you sit on at worktop
    // height) and filed six undeclared "chair" anchors. yaw = 90 degrees puts
    // the table's LONG axis along z, exactly the 1.4 by 2.4 footprint it had,
    // and 6 seats reproduces the 3-a-side ring. `deep` is 1.16, not the old
    // block's 1.4, because F.table puts its ring at deep/2 + 0.42: 1.16 lands
    // the six chairs on the ±1.0 the set already used, so not one anchor moves
    // outward into a walkway (propUseAudit().blocked may only go DOWN).
    if (!kitPiece(k, "table", cx, cz, Math.PI / 2, { len: 2.4, deep: 1.16, seats: 6 }, 1.2)) {
      k.put(cx, 0.5, cz, 1.4, 0.5, 2.4, 0x6b4a2a, 1.2);                                // table centred, ≥1.2 clearance
      for (let i = -1; i <= 1; i++) for (const s of [-1, 1]) if (k.put(cx + s * 1.0, 0.45, cz + i * 0.85, 0.45, 0.9, 0.45, 0x49505b, 1.0))  // chairs
        k.seatAt(cx + s * 1.0, cz + i * 0.85, Math.atan2(-s * 1.0, -i * 0.85), "chair");   // face the table
    }
  }
  function setReception(k, r, accent) {
    accent = accent || 0x9fd8ee;
    const cx = rcx(r), cz = rcz(r);
    k.put(cx, 0.5, cz, 2.4, 1.0, 0.9, 0x49505b, 1.0);                                // reception desk
    k.put(cx, 1.08, cz, 2.5, 0.08, 1.0, 0xe6e8ee, 1.0);                              // desk top
    // 2 WAITING CHAIRS (face the desk, -z). Real armchairs now: the pair used
    // to be a 0.4-tall pad at 0.62 plus a separate back slab, filed as kind
    // "waiting" with no geometry — three ways of being wrong at once. F.armchair
    // draws one seat cushion between two padded arms and declares the 0.42
    // propuse already holds for that shape.
    for (const s of [-1, 1]) {
      const wx2 = cx + s * 1.8;
      if (kitPiece(k, "armchair", wx2, r.z1 - 0.9, Math.PI, { len: 0.86 }, 0.9)) continue;
      if (k.put(wx2, 0.42, r.z1 - 0.9, 0.7, 0.4, 0.7, 0x2a2f37, 0.9)) k.seatAt(wx2, r.z1 - 0.9, Math.PI, "waiting");
      k.put(wx2, 0.85, r.z1 - 0.6, 0.7, 0.5, 0.16, 0x2a2f37, 0.9);
    }
    k.glow(cx, 2.2, r.z0 + 0.18, 2.6, 0.9, 0.06, accent, 0.4, 0.9);                  // logo wall
  }
  function setMeeting(k, r) {
    const cx = rcx(r), cz = rcz(r);
    // a glass-wall conference room: table + chairs + a wall screen
    k.put(cx, 0.5, cz, Math.min(r.x1 - r.x0 - 1.6, 2.6), 0.5, Math.min(r.z1 - r.z0 - 1.6, 1.4), 0x3a2b1e, 1.0);  // table
    // the ring stays hand-placed (the table above is a glass-room conference
    // slab this set draws itself), but every chair is now a KIT chair with a
    // real 0.45 cushion, thin legs and a raked back instead of a 0.9 block.
    for (const s of [-1, 1]) for (let i = -1; i <= 1; i++) {
      const chx = cx + i * 0.9, chz = cz + s * 0.95, face = Math.atan2(-i * 0.9, -s * 0.95);
      if (kitPiece(k, "chair", chx, chz, face, null, 0.9)) continue;
      if (k.put(chx, 0.45, chz, 0.42, 0.9, 0.42, 0x2a2f37, 0.9))  // chairs
        k.seatAt(chx, chz, face, "chair");   // face the table
    }
    k.put(cx, 1.5, r.z0 + 0.2, Math.min(r.x1 - r.x0 - 1.4, 2.2), 1.1, 0.1, 0x14171c, 0.9);  // wall screen
    k.glow(cx, 1.5, r.z0 + 0.2 + 0.05 + SCREEN_GAP + 0.025,
      Math.min(r.x1 - r.x0 - 1.8, 1.8), 0.8, 0.05, 0x39516a, 0.4, 0.9);
  }
  function setBreak(k, r) {
    const cx = rcx(r), cz = rcz(r);
    k.put(cx, 0.55, r.z1 - 0.5, Math.min(r.x1 - r.x0 - 1.0, 2.4), 1.0, 0.7, 0x55606e, 0.9);  // counter
    k.put(cx, 1.08, r.z1 - 0.5, Math.min(r.x1 - r.x0 - 0.9, 2.5), 0.08, 0.8, 0xe6e8ee, 0.9); // counter top
    k.put(r.x0 + 0.7, 1.0, r.z1 - 0.5, 0.8, 1.8, 0.8, 0xd8dde6, 0.9);                // fridge
    // the break table + its two chairs, as ONE kit call: F.table's ring is
    // placed at deep/2 + 0.42, so deep 0.96 puts the pair back on the ±0.9 the
    // set already used and nothing moves into the aisle.
    if (!kitPiece(k, "table", cx, cz, Math.PI / 2, { len: 1.1, deep: 0.96, seats: 2 }, 0.9)) {
      k.put(cx, 0.45, cz, 1.1, 0.5, 1.1, 0x6b4a2a, 0.9);                               // small table
      for (const s of [-1, 1]) if (k.put(cx + s * 0.9, 0.42, cz, 0.42, 0.85, 0.42, 0x2a2f37, 0.9))  // chairs
        k.seatAt(cx + s * 0.9, cz, -s * Math.PI / 2, "chair");   // face the little table
    }
  }
  function setBackroom(k, r) {
    // SPACE DOCTRINE (owner): a separate back room is an OFFICE — ONE desk
    // with a lit screen, one chair, ONE shelf run, and SPACE. The old fill
    // (two tall shelving runs + three crate stacks, squatting right on the
    // doorway line) read as a junk cage. Everything hugs a wall or corner
    // now; the centre — the walking line through the partition gap — is OPEN.
    const hor = (r.x1 - r.x0) >= (r.z1 - r.z0);        // long axis of the room
    // ONE tall shelf run against a short-end wall, clear of the centre line
    if (hor) k.put(r.x0 + 0.6, 1.2, rcz(r), 0.6, 2.2, Math.min(r.z1 - r.z0 - 0.8, 3.2), 0x55606e, 0.8);
    else     k.put(rcx(r), 1.2, r.z0 + 0.6, Math.min(r.x1 - r.x0 - 0.8, 3.2), 2.2, 0.6, 0x55606e, 0.8);
    // ONE desk in the far corner (long side along the wall), screen lit
    const dx = hor ? r.x1 - 1.2 : r.x1 - 0.75, dz = hor ? r.z1 - 0.75 : r.z1 - 1.2;
    const dw = hor ? 1.6 : 0.8, dd = hor ? 0.8 : 1.6;
    if (k.put(dx, 0.4, dz, dw, 0.8, dd, 0x6b4a2a, 0.8)) {
      k.glow(dx, 0.95, dz, hor ? 0.5 : 0.08, 0.3, hor ? 0.08 : 0.5, 0x9fd8ee, 0.5, 0.8);   // desk monitor (seated on the 0.8 desktop)
      const cx2 = hor ? dx : dx - 1.05, cz2 = hor ? dz - 1.05 : dz;
      const cface = Math.atan2(dx - cx2, dz - cz2);
      if (!kitPiece(k, "chair", cx2, cz2, cface, null, 0.7) && k.put(cx2, 0.45, cz2, 0.45, 0.9, 0.45, 0x2a2f37, 0.7))
        k.seatAt(cx2, cz2, cface, "chair");   // face the desk
    }
  }

  // ---- INTERIOR_ROOMPLAN — THE LAYOUT PLANNER AS A FURNITURE SET -----------
  // world/roombuild.js (CBZ.roomPlan / CBZ.roomFurnish) is a complete,
  // constraint-checked interior planner — real circulation widths, chair
  // pull-out, sofa-to-screen distance, and a flood fill from the doorway that
  // DROPS any piece whose propuse entry point it cannot reach — and it had ZERO
  // callers anywhere in the repo. It is a drop-in peer of the sets above: same
  // building-local rect, same `b`, same Y. Two things it buys that a set cannot:
  // the pieces come from CBZ.furnish, so every seat is filed with REAL cushion
  // geometry (the sets' own k.seatAt files none, which is what puts them in
  // propUseAudit().noGeom and gives the legacy squat pose), and a bed's
  // headboard is placed against a wall by construction rather than by the
  // author remembering.
  //
  // EVERY CALL SITE KEEPS ITS SHIPPED SET behind the null return, so flag-off
  // (or a build without roombuild.js) is byte-identical to today.
  function planSet(b, Y, rect, prog, door, tone) {
    if (CBZ.CONFIG.INTERIOR_ROOMPLAN === false || !CBZ.roomFurnish) return null;
    if (!(rect.x1 - rect.x0 > 2.2) || !(rect.z1 - rect.z0 > 2.2)) return null;
    let p = null;
    try {
      p = CBZ.roomFurnish({ x0: rect.x0, x1: rect.x1, z0: rect.z0, z1: rect.z1, y: Y }, prog, {
        box: b.lbox, ox: b.ox != null ? b.ox : 0, oz: b.oz != null ? b.oz : 0,
        // the building's own aisle / stair-strip / lift-chase predicate. Without
        // it the planner furnishes the doorway it is supposed to keep clear.
        clear: b.clearFloorPoint || null,
        door: door || null,
        // DETERMINISM, and it carries the monotony doctrine: the seed is the
        // BUILDING's origin and nothing else, so every storey of one tower plans
        // the identical flat (which is the point) and two towers do not.
        seed: (Math.round(b.ox || 0) * 401) ^ (Math.round(b.oz || 0) * 733),
        tone: tone || "warm",
      });
    } catch (e) { p = null; }
    return (p && p.pieces && p.pieces.length) ? p : null;
  }
  // The planner places FURNITURE; a screen on a wall is architecture, and its
  // `lounge` program deliberately draws none. Put one back on the wall the sofa
  // it just placed is actually looking at — the same three boxes setLiving uses,
  // in the same buckets — so a planned living room is never poorer than the set.
  function planMediaWall(b, Y, rect, plan) {
    let s = null;
    for (let i = 0; i < plan.pieces.length; i++) if (plan.pieces[i].tag === "sofa") { s = plan.pieces[i]; break; }
    if (!s) return;
    const fx = Math.round(Math.sin(s.yaw)), fz = Math.round(Math.cos(s.yaw));
    if (!fx && !fz) return;
    const across = Math.min(fx ? (rect.z1 - rect.z0) : (rect.x1 - rect.x0), 3.2) - 0.6;
    if (across < 1.4) return;
    const wx = fx > 0 ? rect.x1 : fx < 0 ? rect.x0 : s.x;
    const wz = fz > 0 ? rect.z1 : fz < 0 ? rect.z0 : s.z;
    const ccx = wx - fx * 0.34, ccz = wz - fz * 0.34;
    if (b.clearFloorPoint && !b.clearFloorPoint(ccx, ccz, 0.5)) return;
    b.lbox(ccx, Y + 0.4, ccz, fx ? 0.5 : across, 0.8, fx ? across : 0.5, 0x2a2f37, { cast: false });
    // A SCREEN NEEDS A WALL. When the sofa is looking at the CURTAIN WALL — the
    // premium layout, and the one this plate produces most often — hanging a
    // panel there would put a television in the window, which is the exact class
    // of "nobody chose this" the whole pass is against. The console stays (a low
    // sideboard under the glass is what is actually there); the screen does not.
    const wt = b.wt != null ? b.wt : 0.4;
    const onFacade = fx ? (Math.abs(wx) > b.w / 2 - wt - 0.9) : (Math.abs(wz) > b.d / 2 - wt - 0.9);
    if (onFacade) return;
    b.lbox(wx - fx * 0.2, Y + 1.4, wz - fz * 0.2, fx ? 0.1 : across - 0.6, 1.1, fx ? across - 0.6 : 0.1,
      0x14171c, { cast: false });
    // The sofa is opposite the wall direction, so move glass farther INTO the
    // room (-facing), beyond the backing's visible face.
    const screenOff = 0.2 + 0.05 + SCREEN_GAP + 0.025;
    b.lbox(wx - fx * screenOff, Y + 1.4, wz - fz * screenOff,
      fx ? 0.05 : across - 0.9, 0.85, fx ? across - 0.9 : 0.05,
      0x39516a, { emissive: 0x39516a, ei: 0.4, cast: false });
  }

  // ---- interior furnishing ------------------------------------------------
  // A real, kind-specific room: a back COUNTER (placed by the caller) gets a
  // register; wall SHELVES/cases are stocked with kind-appropriate props; a
  // floor mat + an emissive ceiling strip give the room a lit feel. Everything
  // is gated by b.clearFloorPoint so the door->stair aisle stays walkable, and
  // only large pieces collide (decor is non-solid so you can brush past it).
  //
  // Local axis convention (matches makeBuilding & the caller's counter math):
  //   IN  = direction from door into the room  =  (door.nx, door.nz)
  //   the BACK wall sits at  IN*roomHalf;  side walls run along the TANGENT.
  function furnishInterior(b, kind, door) {
    return bounded(b, "shop:" + kind, function () { return furnishInteriorBody(b, kind, door); });
  }
  function furnishInteriorBody(b, kind, door) {
    const W = b.w, D = b.d, FHl = b.FH;
    const inx = door.nx, inz = door.nz;            // inward unit (one axis is 0)
    const tx = -inz, tz = inx;                     // tangent (perpendicular) unit
    const along = Math.abs(inx) > 0.5;             // door faces ±X → room spans Z
    const halfIn = (along ? W : D) / 2;            // distance door-wall→centre along IN
    const halfTan = (along ? D : W) / 2;           // half-width along the tangent

    // place a (lx,lz) point: `inDepth` from the door wall along IN, `lat`
    // sideways along the tangent. Returns null if it lands on the aisle/stairs.
    function pt(inDepth, lat, pad) {
      const lx = inx * (-halfIn + inDepth) + tx * lat;
      const lz = inz * (-halfIn + inDepth) + tz * lat;
      if (b.clearFloorPoint && !b.clearFloorPoint(lx, lz, pad == null ? 0.7 : pad)) return null;
      return { x: lx, z: lz };
    }
    // THE FLOOR IS AT GF, NOT AT 0. Every height in this dresser was authored
    // as if the ground floor were y = 0, but the foundation slab's top is 0.14
    // and the fit-out lays the finished floor 6 cm over it (0.20), so every
    // table, bench, bed, stool and booth in every shop stood 20 cm INTO the
    // floor (a booth "cushion at 0.44" sat 24 cm off the tiles). box() and the
    // kit bridge now stand everything on GF; the few direct b.lbox calls below
    // that are floor-relative add it themselves.
    const GF = groundTop(b) + 0.06;
    // a box whose footprint we orient with the tangent (w = across-aisle span)
    function box(p, y, across, h, deep, col, o) {
      const bw = along ? deep : across, bd = along ? across : deep;
      return b.lbox(p.x, y + GF, p.z, bw, h, bd, col, o);
    }
    function decor(p, y, across, h, deep, col) { return box(p, y, across, h, deep, col, { cast: false }); }
    function solidBox(p, y, across, h, deep, col) { return box(p, y, across, h, deep, col, { solid: true, cast: false }); }
    function glow(p, y, across, h, deep, col, ei) { return box(p, y, across, h, deep, col, { emissive: col, ei: ei || 0.5, cast: false }); }
    // PROPS_PURPOSE anchors for the seats/beds this dresser places (ground
    // floor; world = building-local + b.ox/b.oz). Feature-detected no-ops.
    const abx = b.ox != null ? b.ox : 0, abz = b.oz != null ? b.oz : 0;
    // `cushion` (optional) is propuse.js's `geom` — the cushion top above this
    // floor. Pass it ONLY where the mesh drawn just above really does put its
    // sitting surface there; a declared height that disagrees with the box
    // buries the body in the furniture, which is why propSeatRef refuses to
    // infer one from the kind. Every site below that passes one had its boxes
    // rebuilt to the real height in the same edit.
    function seatP(p, face, kind, cushion) {
      if (p && CBZ.propRegisterSeat)
        CBZ.propRegisterSeat(abx + p.x, GF, abz + p.z, face, kind, null,
          cushion != null ? { cushion: cushion, floorBelow: 0 } : null);
    }
    function bedP(p, hx, hz, len, topY) { if (p && CBZ.propRegisterBed) CBZ.propRegisterBed(abx + p.x, GF, abz + p.z, hx, hz, len, topY + GF, "bed", null); }
    // THE KIT BRIDGE for this dresser: hand a piece to city/furniture.js and it
    // draws through the SAME b.lbox every box here uses (so it batch-folds and
    // rides the interior clamp) and files its own anchor WITH geometry. `p` is
    // already aisle-gated by pt(); null p, no kit or an unknown verb returns
    // null, which is the `if (!kitP(...)) { …old boxes… }` degrade path.
    function kitP(name, p, yaw, o) {
      const F = CBZ.furnish;
      if (!p || !F || typeof F[name] !== "function" || typeof b.lbox !== "function") return null;
      const oo = { box: b.lbox, ox: abx, oz: abz };
      if (o) for (const kk in o) if (oo[kk] === undefined) oo[kk] = o[kk];
      try { return (name === "lamp") ? F.lamp(p.x, GF, p.z, oo) : F[name](p.x, GF, p.z, yaw, oo); }
      catch (e) { return null; }
    }
    // a point offset from `p` by `d` metres along the TANGENT (+ = the +t side)
    // and `e` metres along IN — the two axes this whole dresser is written in.
    function off(p, d, e) { return { x: p.x + tx * d + inx * (e || 0), z: p.z + tz * d + inz * (e || 0) }; }

    // ---- CEILING FIXTURES, AS THE STREET SEES THEM ----------------------------
    // The walk-in fit-out (fitout_work.js) hangs the real troffer grid and bakes
    // its light the moment you are near; these are what the storefront glass
    // shows before that. They used to be trade-COLOURED glowing slabs hanging
    // 7 cm under the ceiling line (green in the gun store, teal in the phone
    // shop, cyan over the security desk) plus a third emissive strip across the
    // room: lights nobody installs. Now: flush 600 x 1200 panels in neutral shop
    // white on a real module, 2 mm above the fit-out's ceiling plane so the real
    // grid covers them once it builds. Only the bar and the casino keep a
    // coloured wash, because that is what a bar's lighting is.
    // (Also deleted from here: a per-trade floor-tint slab drawn at y 0..0.04,
    // INSIDE the 0.14-topped foundation slab and so never once visible, and a
    // door mat whose own aisle gate always refused it. fitout_work.js lays the
    // real floor and the real entrance mat.)
    {
      const NIGHT = { bar: [0xe85d8a, 0.6], casino: [0xc9a227, 0.62] };
      const fx = NIGHT[kind] || [0xf4f1e6, 0.55];
      const fyc = FHl - 0.205;
      for (const dIn of [halfIn * 0.55, halfIn, halfIn * 1.45]) {
        for (const lat of [-halfTan * 0.35, halfTan * 0.35]) {
          const p = pt(dIn, lat, 0.3); if (!p) continue;
          b.lbox(p.x, fyc, p.z, along ? 1.2 : 0.6, 0.01, along ? 0.6 : 1.2, fx[0], { emissive: fx[0], ei: fx[1], cast: false });
        }
      }
    }

    // ---- THE TILL on the counter the caller placed ------------------------------
    // A POS terminal built like one: a cash drawer, a stem, a screen turned to the
    // clerk, a receipt printer with its paper curl. It was a 0.7 x 0.28 slab with
    // a glowing strip in the trade's accent colour. It stands on the fit-out's
    // worktop (1.24) or, where a flagship file owns the counter, on the bare
    // counter top (1.20).
    const FLAG_COUNTER = { guns: 1, jewelry: 1, pawn: 1, bank: 1, casino: 1, realtor: 1, carlot: 1, chop: 1, clothing: 1, raceway: 1 };
    const regP = pt(2 * halfIn - 2.8, -0.7, 0.4) || pt(2 * halfIn - 2.8, 0, 0.4);
    if (regP) {
      const TOP = (FLAG_COUNTER[kind] ? 1.2 : 1.24) - GF;                          // decor() adds GF back
      decor(regP, TOP + 0.05, 0.42, 0.1, 0.4, 0x2a2d31);                          // cash drawer
      decor(regP, TOP + 0.103, 0.36, 0.006, 0.3, 0x3a3e44);                      // drawer lid seam
      decor(off(regP, 0, 0.13), TOP + 0.19, 0.05, 0.18, 0.05, 0x3a3e44);         // stem
      decor(off(regP, 0, 0.13), TOP + 0.38, 0.36, 0.25, 0.035, 0x1d1f22);        // screen housing
      glow(off(regP, 0, 0.15), TOP + 0.38, 0.31, 0.2, 0.006, 0x9ec3d4, 0.32);    // the screen, facing the clerk
      decor(off(regP, 0.34, 0.06), TOP + 0.065, 0.15, 0.13, 0.2, 0x34383e);      // receipt printer
      decor(off(regP, 0.34, -0.02), TOP + 0.132, 0.08, 0.004, 0.06, 0xf4f2ea);   // paper curl
    }

    // (DELETED: wallShelves / stockRow / recordStock / baseClutter. The wall
    //  shelves asked for 0.8 m of clearance from the very wall they hugged, so
    //  their gate never once passed and none of the painted 22 cm "goods" cubes
    //  meant to stand on them was ever drawn; the potted plant and the waste bin
    //  had the same gate problem; the one piece of it that did land was a third
    //  glowing ceiling strip. A shop's shelving, goods, cooler and coffee station
    //  are city/storegoods.js; its plant, bin, floor and troffers are
    //  fitout_work.js.)

    // ---- BACK-OF-HOUSE WALL: the bank and the civic halls only ----------------
    // A public counter hall is backed by offices the public never sees; a full-
    // height SOLID wall runs across the room at backDepth with a doorway, and the
    // back band holds a small office (setBackroom).
    //
    // IT USED TO RUN ACROSS EVERY SHOP, and in a shop it stood IN FRONT of the
    // counter: backDepth is 5.5 m off the back wall, the counter 2.8 m off it,
    // so the till, the clerk, the gun store's rack wall and the jeweller's vault
    // case were all shut in a 5.5 m strip you reached through a 1.7 m hole in a
    // grey partition. A shop's stockroom is a room BESIDE the counter, which is
    // what fitout_work.js's buildStockroom stands whenever this wall is absent.
    const BACK_OF_HOUSE = { bank: 1, cityhall: 1, courthouse: 1, federal: 1, cityannex: 1, postoffice: 1, dmv: 1, library: 1 };
    const backWalled = !!BACK_OF_HOUSE[kind] && (2 * halfTan) >= 8 && (2 * halfIn) >= 13;
    if (backWalled) {
      const WALLH = FHl - 0.05;
      const backDepth = 2 * halfIn - 5.5;            // wall sits ~5.5u in front of the back wall
      // doorway centred (lat 0) — keep one gap so the back offices are reachable.
      const gapW = 1.7, segHalf = halfTan;
      const spans = [[-segHalf, -gapW / 2], [gapW / 2, segHalf]];
      for (let s = 0; s < spans.length; s++) {
        const a0 = spans[s][0], a1 = spans[s][1]; if (a1 - a0 < 0.2) continue;
        const latC = (a0 + a1) / 2, len = a1 - a0;
        const lx = inx * (-halfIn + backDepth) + tx * latC;
        const lz = inz * (-halfIn + backDepth) + tz * latC;
        const bw = along ? PWT : len, bd = along ? len : PWT;
        b.lbox(lx, WALLH / 2, lz, bw, WALLH, bd, PCOL, KITWALL);
      }
      // lintel over the doorway
      const llx = inx * (-halfIn + backDepth), llz = inz * (-halfIn + backDepth);
      b.lbox(llx, WALLH - 0.18, llz, along ? PWT : gapW, 0.36, along ? gapW : PWT, PCOL, KITWALL);
      // BACK-OFFICE fill behind the wall (setBackroom: one desk + one shelf). The
      // back band runs from the partition (backDepth) to the back wall, across the
      // tangent — convert those IN-frame corners to a building-local axis rect.
      const k = roomKit(b, groundTop(b));
      const cA = [inx * (-halfIn + backDepth) + tx * (-(halfTan - 0.5)), inz * (-halfIn + backDepth) + tz * (-(halfTan - 0.5))];
      const cB = [inx * (-halfIn + (2 * halfIn - 0.8)) + tx * (halfTan - 0.5), inz * (-halfIn + (2 * halfIn - 0.8)) + tz * (halfTan - 0.5)];
      setBackroom(k, { x0: Math.min(cA[0], cB[0]), x1: Math.max(cA[0], cB[0]), z0: Math.min(cA[1], cB[1]), z1: Math.max(cA[1], cB[1]) });
    }
    // a screen or panel HUNG ON THE BACK WALL behind the clerk (the TV wall,
    // the CCTV bank): no floor gate, 3 cm proud of the inner back face.
    const Bwall = 2 * halfIn - (b.wt != null ? b.wt : WT);
    function backWallBox(lat, yC, wAcross, h, depth, col, o) {
      const dIn = Bwall - 0.03 - depth / 2;
      const lx = inx * (-halfIn + dIn) + tx * lat, lz = inz * (-halfIn + dIn) + tz * lat;
      return b.lbox(lx, yC, lz, along ? depth : wAcross, h, along ? wAcross : depth, col, o || { cast: false });
    }

    // dispatch to the trade-specific dresser
    switch (kind) {
      case "guns": {
        // (Stylised two-box "rifles" on wall cabinets used to be dealt here, onto
        //  shelves whose clearance gate never let one stand: dead code, deleted.
        //  The gun wall is city/gunstore.js, hung with the real weapon models.)
        // (The two freestanding deco pistol-case islands + the deco ammo crates
        //  are CUT — space doctrine: gunstore.js stands the REAL counter case,
        //  rack wall, ammo crates and armor row on this lot, and the deco twins
        //  doubled all of it while pinching the counter approach.)
        break;
      }
      case "jewelry":
      case "pawn": {
        // (DELETED: wall cases of painted "gem" cubes that never placed, and the
        //  pawn shop's "junk pile", a plain 2.4 m grey box. jewelry.js stands
        //  the real vitrines; pawnshop.js stands the real pawned goods.)
        break;
      }
      case "bar":
      case "casino": {
        // CASINO: casino.js builds the whole gaming floor (felt tables with
        // seats, the slot bank, the bar corner, the cashier cage). The glowing
        // felt boxes and the four slot "cabinets" this dresser used to add were
        // a second, fake casino on the same floor: deleted.
        if (kind === "casino") break;
        // THE VELVET CLUB's whole interior (bar and back bar, stools, booths,
        // DJ booth, dance floor, lighting rig) is city/club.js. The eager copy
        // that used to stand here (glowing floor tiles under the slab, a
        // glowing mirror-ball cube, gate-refused booths, a DJ box with two cyan
        // squares) was a second club on the same floor: deleted.
        break;
      }
      case "food": {
        // diner: produce/serving tables down the room + a back kitchen line
        // (the dining floor; the grocery bays, the drinks cooler and the hot food
        //  warmer behind it are city/storegoods.js)
        for (let i = 0; i < 2; i++) {                                          // two booth tables w/ bench seats
          for (const side of [-1, 1]) {
            const p = pt(5.0 + i * 3.2, side * (halfTan - 1.7), 0.8);
            if (p) {
              // A DINER TABLE: chrome pedestal foot, column, a laminate top at
              // 0.74 with its chrome edge band, its long side along the bench.
              // (It was a slab at 0.45, a plank "leg" and a second slab at 0.55,
              // long side sticking out across the aisle.)
              decor(p, 0.015, 0.5, 0.03, 0.5, 0xb9bec4);                    // foot
              decor(p, 0.37, 0.08, 0.68, 0.08, 0x9aa0a6);                   // column
              decor(p, 0.705, 0.72, 0.03, 1.22, 0xb9bec4);                  // edge band
              decor(p, 0.72, 0.7, 0.04, 1.2, 0xe8e4da);                     // top -> 0.74
              // a red vinyl bench on the wall side of each booth
              const bp = pt(5.0 + i * 3.2, side * (halfTan - 0.7), 0.8);
              // the red vinyl bench, rebuilt to REAL heights: the old seat
              // block topped out at 0.70 (you sat level with the tabletop) and
              // declared nothing. Base → cushion at 0.44 → a padded back above.
              // Same rebuild as the club booths: base → 0.44 cushion → padded
              // back behind the sitter, and the bench runs ALONG the wall
              // instead of 1.2 m straight out into the walking line.
              if (bp) {
                decor(bp, 0.19, 0.42, 0.38, 1.20, 0xb23b3b);                    // bench base
                decor(bp, 0.41, 0.46, 0.06, 1.20, 0xc14b4b);                    // cushion → 0.44
                decor(off(bp, side * 0.22), 0.76, 0.14, 0.64, 1.20, 0xb23b3b);  // back → 1.08
                seatP(bp, Math.atan2(-side * tx, -side * tz), "booth", 0.44);   // face the booth table
              }
            }
          }
        }
        // a glowing back-lit MENU BOARD above the counter (diner classic)
        // THREE LIGHTBOX PANELS HUNG ON THE BACK WALL behind the counter, each
        // a dark frame, a warm backlit face, a photo of the food and the price
        // lines as dark bars (no invented words). It was one 0.9 m slab of
        // orange glow standing free 1.4 m in front of the back wall, over the
        // clerk's head, its width flipping with the door side.
        {
          const FOOD = [0xb5572a, 0xd9a441, 0x8e3b24];
          for (let i = -1; i <= 1; i++) {
            const la = i * 1.3;
            backWallBox(la, 2.35, 1.2, 0.78, 0.05, 0x1c1e22);                                               // frame
            backWallBox(la, 2.35, 1.12, 0.7, 0.056, 0xfff0d6, { emissive: 0xfff0d6, ei: 0.55, cast: false });  // lit face
            backWallBox(la - 0.28, 2.43, 0.44, 0.34, 0.06, FOOD[i + 1], { emissive: FOOD[i + 1], ei: 0.35, cast: false });   // the photo
            for (let r = 0; r < 4; r++) backWallBox(la + 0.26, 2.58 - r * 0.13, 0.44, 0.035, 0.06, 0x2a2018);             // price lines
          }
        }
        break;
      }
      case "bank":
      case "cityhall":
      // ---- THE CIVIC COUNTER FAMILY (city/buildings_civic.js trades) --------
      // Every government office in the game is, inside, the same thing: a
      // public hall with a screened counter you queue at. They share the
      // cityhall dressing and then add their ONE distinguishing fixture below,
      // rather than each re-inventing a room.
      case "courthouse":
      case "federal":
      case "cityannex":
      case "postoffice":
      case "dmv": {
        // a row of TELLER/CLERK windows — every civic kind EXCEPT the bank
        // (space doctrine): the real bank branch (bank.js) builds its own teller
        // counter + glass + screens just behind where this deco row stood, so on
        // bank lots the deco row doubled the counter and walled off its approach.
        if (kind !== "bank") {
          const lat0 = -(halfTan - 1.8);
          for (let i = 0; i < 3; i++) {
            const p = pt(2 * halfIn - 3.0, lat0 + i * 1.8, 0.5);
            if (!p) continue;
            decor(p, 0.8, 1.5, 1.6, 0.6, 0x44505c);          // teller desk
            decor(p, 1.9, 1.5, 1.0, 0.06, GLASS);            // teller glass
            glow({ x: p.x, z: p.z }, 1.0, 0.3, 0.1, 0.06, 0x5b8bff, 0.7);  // counter screen
          }
        }
        // a velvet queue rope (two short posts + a sagging rope) by the entrance
        for (const side of [-1, 1]) { const p = pt(4.6, side * 1.4, 0.6); if (p) { decor(p, 0.5, 0.16, 1.0, 0.16, 0xcaa64a); decor(p, 1.02, 0.22, 0.18, 0.22, 0x2a2f37); } }
        { const rp = pt(4.6, 0, 0.6); if (rp) decor(rp, 0.85, along ? 0.04 : 2.6, 0.06, along ? 2.6 : 0.04, 0x8a1f2b); }   // the rope span
        // (The deco steel vault — solid wall + round door + spokes — is CUT on
        //  bank lots: bank.js stands the REAL heist vault (CBZ.cityBankVault is
        //  the drill point) in that same corner, and the partition accents below
        //  wall it into a proper vault room. Three vault reads in one corner
        //  was cram, not security.)
        // ---- the ONE fixture that tells the civic kinds apart --------------
        if (kind === "courthouse") {
          // a raised JUDGE'S BENCH across the back, flanked by counsel tables,
          // with two rows of gallery pews facing it (real seat anchors, so peds
          // can actually sit in the public gallery).
          const jb = pt(2 * halfIn - 2.4, 0, 0.5);
          if (jb) {
            solidBox(jb, 0.55, Math.min(halfTan * 1.4, 5.0), 1.10, 1.0, 0x4a3626);   // bench body
            decor(jb, 1.18, Math.min(halfTan * 1.4, 5.0) + 0.2, 0.14, 1.2, 0x6b4a2a); // bench cap
            decor({ x: jb.x, z: jb.z }, 2.55, 1.0, 1.1, 0.08, 0x2a2f37);              // wall crest panel
            glow({ x: jb.x, z: jb.z }, 2.55, 0.45, 0.5, 0.05, 0xd8c98a, 0.55);        // gilded seal
          }
          for (const sg of [-1, 1]) {
            const ct = pt(2 * halfIn - 5.6, sg * 2.1, 0.7);
            if (ct) { decor(ct, 0.72, 2.0, 0.10, 0.9, 0x5a4433); for (const e of [-1, 1]) { const lx = ct.x + tx * e * 0.85, lz = ct.z + tz * e * 0.85; b.lbox(lx, 0.35 + GF, lz, 0.1, 0.7, 0.1, 0x3a2f24, { cast: false }); } }
          }
          for (let r = 0; r < 2; r++) {
            const pw = pt(6.2 + r * 1.6, 0, 0.8);
            if (!pw) continue;
            // PEWS. The plank now tops out at the 0.45 SEAT_H holds for kind
            // "pew" (it was 0.48 and filed as an undeclared "chair"), stands on
            // real end legs, and the back is set BEHIND the seat rather than
            // sharing its centreline — so a gallery row reads as benches.
            const pewW = Math.min(halfTan * 1.5, 5.4);
            for (const sg of [-1, 1]) decor(off(pw, sg * (pewW / 2 - 0.22)), 0.165, 0.10, 0.33, 0.42, 0x5a3f26);   // end legs
            decor(pw, 0.39, pewW, 0.12, 0.5, 0x6b4a2a);                              // pew plank → 0.45
            decor(off(pw, 0, -0.22), 0.85, pewW, 0.75, 0.10, 0x5a3f26);              // pew back, set aft
            for (const sg of [-1, 1]) seatP(off(pw, sg * 1.3), Math.atan2(inx, inz), "pew", 0.45);
          }
        } else if (kind === "postoffice") {
          // a WALL OF PO BOXES (a real brass grid) + a sorting table
          for (const sg of [-1, 1]) {
            const wall = pt(2 * halfIn - 6.0, sg * (halfTan - 0.45), 0.8);
            if (!wall) continue;
            decor(wall, 1.15, 3.4, 2.30, 0.35, 0x3a3630);
            for (let c2 = 0; c2 < 7; c2++) for (let r2 = 0; r2 < 6; r2++) {
              const lat = -1.5 + c2 * 0.5;
              b.lbox(wall.x + tx * lat, 0.35 + r2 * 0.36 + GF, wall.z + tz * lat,
                along ? 0.06 : 0.42, 0.30, along ? 0.42 : 0.06, (c2 + r2) % 2 ? 0xc0a057 : 0xa88a44, { cast: false });
            }
          }
          const srt = pt(2 * halfIn - 6.4, 0, 0.9);
          if (srt) { decor(srt, 0.86, 2.4, 0.10, 1.1, 0x8a7a5e); for (let i = 0; i < 4; i++) decor({ x: srt.x + tx * (-0.9 + i * 0.6), z: srt.z + tz * (-0.9 + i * 0.6) }, 1.02, 0.45, 0.22, 0.45, 0xc47a3a); }
        } else if (kind === "dmv") {
          // the QUEUE SNAKE (four rope bays) + a numbered NOW-SERVING board and
          // a bench row — the universally recognised civil-service waiting hall.
          for (let i = 0; i < 4; i++) {
            const p = pt(5.0 + i * 1.5, 0, 0.6);
            if (!p) continue;
            for (const sg of [-1, 1]) { const q = { x: p.x + tx * sg * 2.0, z: p.z + tz * sg * 2.0 }; decor(q, 0.5, 0.14, 1.0, 0.14, 0x8a8f97); }
            decor(p, 0.85, along ? 0.04 : 4.0, 0.05, along ? 4.0 : 0.04, 0x39424c);
          }
          const bd2 = pt(2 * halfIn - 3.6, halfTan - 1.2, 0.6);
          if (bd2) glow(bd2, 2.4, 1.6, 0.7, 0.08, 0x66d9c0, 0.75);
          for (const sg of [-1, 1]) {
            const bn = pt(4.2, sg * (halfTan - 1.0), 0.9);
            if (!bn) continue;
            // the waiting bench: a plank at the real 0.45 on two end legs,
            // declared, instead of a 0.50-topped slab floating in mid-air.
            for (const e2 of [-1, 1]) decor(off(bn, e2 * 1.08), 0.165, 0.10, 0.33, 0.42, 0x39424c);
            decor(bn, 0.39, 2.6, 0.12, 0.5, 0x59606a);                    // plank → 0.45
            seatP(bn, Math.atan2(-tx * sg, -tz * sg), "bench", 0.45);
          }
        } else if (kind === "federal" || kind === "cityannex") {
          // a SECURITY SCREENING lane just inside the door (metal detector arch
          // + a bag table) — the thing that says "you are in a government
          // building" the moment you walk in.
          const arch = pt(3.8, 0, 0.5);
          if (arch) {
            for (const sg of [-1, 1]) { const q = { x: arch.x + tx * sg * 0.95, z: arch.z + tz * sg * 0.95 }; decor(q, 1.05, 0.22, 2.10, 0.32, 0xcfd4da); }
            decor(arch, 2.18, 2.3, 0.20, 0.32, 0xcfd4da);
            glow({ x: arch.x, z: arch.z }, 2.05, 0.5, 0.06, 0.06, 0x66d9c0, 0.7);
          }
          const tbl = pt(5.4, halfTan - 1.4, 0.8);
          if (tbl) decor(tbl, 1.6, 0.86, 0.10, 0.7, 0x8f959c);
          // a directory board of departments on the back wall
          const dir = pt(2 * halfIn - 1.2, -(halfTan - 1.6), 0.4);
          if (dir) { decor(dir, 1.9, 2.2, 1.5, 0.08, 0x2a2f37); for (let i = 0; i < 5; i++) glow({ x: dir.x, z: dir.z }, 1.35 + i * 0.26, 1.7, 0.05, 0.04, 0xdfe8ff, 0.4); }
        }
        break;
      }
      case "library": {
        // THE STACKS: parallel runs of tall shelving down the room, reading
        // tables with lamps between them, and a circulation desk at the back.
        const runs = 3;
        for (let r = 0; r < runs; r++) for (const sg of [-1, 1]) {
          const p = pt(5.4 + r * 2.4, sg * (halfTan - 1.5), 0.9);
          if (!p) continue;
          decor(p, 1.10, 1.9, 2.20, 0.70, 0x5a4433);                     // shelf carcass
          for (let s2 = 0; s2 < 5; s2++) {
            const y = 0.40 + s2 * 0.42;
            decor({ x: p.x, z: p.z }, y, 1.8, 0.06, 0.62, 0x7a6047);     // shelf boards
            // a run of book spines per shelf, hashed colours (deterministic)
            for (let i = 0; i < 6; i++) {
              const lat = -0.75 + i * 0.3;
              const hcol = [0x8a3b3b, 0x3b5a8a, 0x3b7a4f, 0xc0a057, 0x6a4a7a][(i + s2 + r) % 5];
              b.lbox(p.x + tx * lat, y + 0.18 + GF, p.z + tz * lat, along ? 0.5 : 0.24, 0.30, along ? 0.24 : 0.5, hcol, { cast: false });
            }
          }
        }
        for (let i = 0; i < 2; i++) {
          const tb = pt(6.0 + i * 3.4, 0, 1.0);
          if (!tb) continue;
          decor(tb, 0.74, 2.6, 0.10, 1.2, 0x6b4a2a);                     // reading table
          glow({ x: tb.x, z: tb.z }, 1.05, 0.24, 0.28, 0.24, 0xffe0a0, 0.8);   // green-shade lamp
          for (const sg of [-1, 1]) {
            const ch = off(tb, sg * 1.0), cface = Math.atan2(-tx * sg, -tz * sg);
            // reading chairs: the kit's, so they have legs and a raked back and
            // declare their own 0.45 (they were a lone 0.10 pad in the air).
            if (kitP("chair", ch, cface)) continue;
            decor(ch, 0.42, 0.5, 0.10, 0.5, 0x4a4033);
            seatP(ch, cface, "chair");
          }
        }
        const circ = pt(2 * halfIn - 3.2, 0, 0.6);
        if (circ) { solidBox(circ, 0.55, Math.min(halfTan * 1.2, 4.2), 1.10, 0.8, 0x5a4433); decor(circ, 1.16, Math.min(halfTan * 1.2, 4.2) + 0.2, 0.10, 1.0, 0x7a6047); }
        break;
      }
      case "firestation": {
        // The APPARATUS BAY: a painted bay floor, a turnout-gear locker row, a
        // hose rack, and the brass SLIDING POLE dropping from the upper floor —
        // the four things every fire house in the world actually has.
        const bay = pt(halfIn * 0.8, 0, 1.6);
        if (bay) {
          // laid on the slab (they used to sit at 0.03 / 0.05, inside it): the
          // bay paint tops out 5 mm under the fit-out's finished floor (GF),
          // which covers it with its own paint once you walk in
          b.lbox(bay.x, GF - 0.03, bay.z, along ? Math.min(2 * halfIn - 2, 12) : 4.2, 0.05,
            along ? 4.2 : Math.min(2 * halfIn - 2, 12), 0x39424c, { cast: false });
          for (let i = -1; i <= 1; i += 2)
            b.lbox(bay.x + tx * i * 2.1, GF - 0.022, bay.z + tz * i * 2.1,
              along ? Math.min(2 * halfIn - 2, 12) : 0.16, 0.05, along ? 0.16 : Math.min(2 * halfIn - 2, 12),
              0xd8c05a, { cast: false });                                  // bay edge stripes
        }
        for (const sg of [-1, 1]) {
          const lk = pt(2 * halfIn - 5.0, sg * (halfTan - 0.6), 0.8);
          if (!lk) continue;
          decor(lk, 1.05, 3.2, 2.10, 0.55, 0x3f4650);                      // locker bank
          for (let i = 0; i < 5; i++) {
            const lat = -1.3 + i * 0.65;
            decor({ x: lk.x + tx * lat, z: lk.z + tz * lat }, 1.05, 0.55, 2.0, 0.06, 0x59606a);
            decor({ x: lk.x + tx * lat, z: lk.z + tz * lat }, 1.45, 0.42, 0.75, 0.22, 0xd8c05a);   // hung turnout coat
            decor({ x: lk.x + tx * lat, z: lk.z + tz * lat }, 0.16, 0.34, 0.32, 0.34, 0x2a2f37);   // boots
          }
        }
        const pole = pt(2 * halfIn - 2.6, -(halfTan - 1.5), 0.6);
        if (pole) b.lbox(pole.x, FHl / 2, pole.z, 0.16, FHl, 0.16, 0xc0a057, { cast: false });
        const hose = pt(2 * halfIn - 2.6, halfTan - 1.2, 0.6);
        if (hose) { decor(hose, 1.3, 1.8, 2.4, 0.30, 0x4a5058); for (let i = 0; i < 3; i++) decor({ x: hose.x, z: hose.z }, 0.6 + i * 0.7, 1.5, 0.42, 0.42, 0xb8412f); }
        break;
      }
      case "gym": {
        // WEIGHT BENCHES, built like them: two A-frame legs, a padded top at
        // 0.43, an upright rack at the head with a loaded barbell on its hooks.
        // They were a floating 16 cm pad with two 34 cm grey cubes beside it.
        const IRON = 0x2a2d31, CHROME = 0xb9bec4;
        for (let i = 0; i < 2; i++) for (const side of [-1, 1]) {
          const p = pt(5.4 + i * 3.0, side * (halfTan - 1.8), 0.9);
          if (!p) continue;
          for (const e of [-0.48, 0.48]) {
            decor(off(p, 0, e), 0.02, 0.4, 0.04, 0.05, IRON);                // foot bar
            decor(off(p, 0, e), 0.2, 0.05, 0.36, 0.05, IRON);                // leg
          }
          decor(p, 0.395, 0.1, 0.03, 1.0, IRON);                             // spine
          decor(p, 0.45, 0.3, 0.08, 1.15, 0x1f2124);                         // pad -> 0.49
          for (const t of [-0.5, 0.5]) {
            decor(off(p, t, 0.62), 0.55, 0.05, 1.1, 0.05, IRON);             // rack post
            decor(off(p, t, 0.58), 1.02, 0.05, 0.03, 0.08, IRON);            // J-hook
          }
          decor(off(p, 0, 0.6), 1.05, 1.9, 0.03, 0.03, CHROME);              // the bar
          for (const t of [-1, 1]) {
            decor(off(p, t * 0.78, 0.6), 1.05, 0.04, 0.45, 0.45, 0x16181b);  // 20 kg plate
            decor(off(p, t * 0.72, 0.6), 1.05, 0.03, 0.3, 0.3, 0x16181b);    // 10 kg plate
            decor(off(p, t * 0.83, 0.6), 1.05, 0.03, 0.07, 0.07, CHROME);    // collar
          }
        }
        // THE DUMBBELL RACK against the side wall: a two-tier steel frame with
        // pairs of hex dumbbells (handle + two heads) in size order. It was a
        // 1 m block with five grey bricks on it, its long side flipping with
        // the door side.
        const dr = pt(2 * halfIn - 3.4, halfTan - 1.6, 0.7);
        if (dr) {
          for (const e of [-1.15, 1.15]) {
            decor(off(dr, 0, e), 0.4, 0.5, 0.8, 0.05, IRON);                 // end frame
          }
          for (let tier = 0; tier < 2; tier++) {
            const y = 0.42 + tier * 0.36, tl = tier ? 0.08 : -0.08;
            decor(off(dr, tl, 0), y, 0.3, 0.025, 2.3, IRON);                 // tray
            for (let k = 0; k < 5; k++) {
              const hd = 0.07 + (tier * 5 + k) * 0.006;                      // heads grow down the rack
              const e = -0.9 + k * 0.45;
              for (const pr of [-0.09, 0.09]) {
                const q = off(dr, tl, e + pr);
                decor(q, y + 0.0125 + hd / 2, 0.16, 0.025, 0.025, CHROME);   // handle
                for (const hh of [-1, 1]) decor(off(q, hh * 0.1, 0), y + 0.0125 + hd / 2, 0.05, hd, hd, 0x1c1d20);
              }
            }
          }
        }
        // (DELETED: a mirror slab and three rubber mats that never showed: the
        //  mirror's wall gate never passed and the mats were drawn under the
        //  slab. fitout_work.js hangs the real mirror and lays the real mats.)
        break;
      }
      case "clothing":
      case "barber": {
        if (kind === "clothing") {
          // (DELETED: two "rounders" whose garments were six coloured slabs
          //  standing on the floor round a post, and wall shelves of painted
          //  "folded stacks" that never placed. clothingstore.js hangs the real
          //  garments on real rails.)
          // (The deco entrance mannequins are CUT — space doctrine: the walk-in
          //  store (clothingstore.js) stands REAL buyable mannequins across the
          //  entrance, and the deco pair just crowded the same floor.)
        } else {
          // barber: two chairs facing wall mirrors
          for (const side of [-1, 1]) {
            const p = pt(6.0, side * (halfTan - 1.6), 0.9);
            if (!p) continue;
            // A BARBER CHAIR, built like one: a floor plate, a hydraulic
            // column, a footrest, a leather cushion at 0.48 and a high back.
            // The old pair was a 0.9-tall pedestal with a 0.5 block on top —
            // a seat at 1.25, half a metre above where anyone can sit.
            // The sitter faces +side along the TANGENT, so "behind" is -side on
            // the tangent and the arms sit either side of them on the IN axis.
            const bface = Math.atan2(side * tx, side * tz);
            decor(p, 0.03, 0.70, 0.06, 0.70, 0x32363d);                            // floor plate
            decor(p, 0.24, 0.20, 0.36, 0.20, 0x8a8f97);                            // chrome column
            decor(p, 0.42, 0.62, 0.10, 0.62, 0x32363d);                            // seat frame
            decor(p, 0.465, 0.58, 0.05, 0.58, 0x6b1f1f);                           // leather cushion → 0.49
            decor(off(p, -side * 0.34), 0.86, 0.12, 0.74, 0.58, 0x6b1f1f);         // high back → 1.23
            for (const a2 of [-1, 1]) decor(off(p, 0, a2 * 0.29), 0.60, 0.56, 0.10, 0.06, 0x8a8f97);  // chrome arms
            seatP(p, bface, "chair", 0.49);                                        // face the mirror
            // (the mirror itself is fitout_work.js's shopBarberMirrors; the one
            //  that used to be typed here never passed its own wall gate)
          }
        }
        break;
      }
      case "drugs": {
        // trap house: a beat couch, a low table with baggies, stash shelves
        const cp = pt(2 * halfIn - 4.0, halfTan - 1.7, 0.9);
        if (cp) {
          // THE BEAT COUCH IS THE KIT'S. It was two stacked slabs — a 0.65-top
          // "seat" with a 0.95-top "back" sharing one centreline — and two
          // undeclared "couch" anchors, so everybody who flopped on it squatted
          // in mid-air. F.sofa's long axis is its LATERAL axis and this couch's
          // runs on IN, so yaw (the way the sitters look) is -tangent: exactly
          // the face the old anchors already used. Same centre, same 2.4 length,
          // real 0.40 cushion, declared.
          const cface = Math.atan2(-tx, -tz);
          if (!kitP("sofa", cp, cface, { len: 2.4, tone: { cloth: 0x4a423a, frame: 0x3a352e } })) {
            decor(cp, 0.4, along ? 0.9 : 2.4, 0.5, along ? 2.4 : 0.9, 0x4a423a); decor(cp, 0.75, along ? 0.9 : 2.4, 0.4, along ? 2.4 : 0.9, 0x3a352e);
            // 2 SEATS along the couch (its long axis runs on the IN axis), both
            // facing the room centre (-tangent side).
            for (const e of [-0.6, 0.6]) seatP({ x: cp.x + inx * e, z: cp.z + inz * e }, cface, "couch");
          }
        }
        // THE TABLE IN FRONT OF THE COUCH, built like one. It was a 0.1 m slab
        // floating 0.35 m up with four painted 14 cm cubes on it ("baggies").
        // Now: a low coffee table on four legs standing on the finished floor
        // (0.20), a digital pocket scale with its lit readout, and clear baggies
        // with the product visible inside, the size baggies are.
        const tp = pt(2 * halfIn - 6.0, halfTan - 2.4, 0.9);
        if (tp) {
          const FL = 0, TT = FL + 0.44;                                                            // decor() stands it on GF
          decor(tp, TT - 0.02, 1.1, 0.04, 0.6, 0x3a2e24);                                         // top
          for (const e1 of [-1, 1]) for (const e2 of [-1, 1]) decor(off(tp, e1 * 0.5, e2 * 0.25), FL + 0.21, 0.045, 0.42, 0.045, 0x2a221b);
          decor(off(tp, -0.3, 0), TT + 0.012, 0.14, 0.024, 0.1, 0x2a2d31);                         // scale body
          decor(off(tp, -0.3, 0.012), TT + 0.026, 0.1, 0.004, 0.07, 0xb9bec4);                       // platter
          glow(off(tp, -0.3, -0.04), TT + 0.025, 0.06, 0.004, 0.016, 0x9fd8a0, 0.35);               // readout
          for (let i = 0; i < 5; i++) {
            const q = off(tp, 0.02 + (i % 3) * 0.11, -0.1 + ((i / 3) | 0) * 0.14);
            decor(q, TT + 0.004, 0.07, 0.008, 0.09, 0xdfe7e1);                                      // the bag
            decor(q, TT + 0.01, 0.035, 0.01, 0.04, 0x5c7a38);                                       // what is in it
          }
        }
        // (the "stash shelves" that used to follow never placed: deleted)
        break;
      }
      case "electronics": {
        // THE TV WALL behind the counter: three 55-inch sets hung on the back
        // wall, each a bezel with its picture a few mm proud. It used to be a
        // 3 m free-standing slab of teal glow at 2hi-1.8, i.e. between the
        // counter and where the clerk stands; plus a plain box "gadget island"
        // in the door-to-till aisle. (The wall shelving and its teal "screens"
        // never placed. The shelves are city/storegoods.js now.)
        const PIC = [0x6f9fc0, 0x8fb57a, 0xc9a06a];
        for (let i = -1; i <= 1; i++) {
          backWallBox(i * 1.45, 1.95, 1.24, 0.72, 0.05, 0x121417);
          backWallBox(i * 1.45, 1.95, 1.16, 0.64, 0.056, PIC[i + 1], { emissive: PIC[i + 1], ei: 0.5, cast: false });
        }
        break;
      }
      case "hardware": {
        // (DELETED: a plain box "island", four planks stacked in mid-aisle as
        //  "lumber" in front of the wall bays, a pegboard that glowed yellow and
        //  never passed its gate, and wall racks of painted cubes that never
        //  placed. The racks and their stock are city/storegoods.js; the tool
        //  pegboard is fitout_work.js's shopPegboard.)
        break;
      }
      case "hospital": {
        // reception + two beds with curtains + a supply shelf
        for (let i = 0; i < 2; i++) {
          const p = pt(5.6 + i * 3.2, -(halfTan - 1.9), 0.9);
          if (!p) continue;
          // WARD BEDS through the kit, in the clinic tone (pale frame + white
          // linen, the palette this room already used). yaw points at the
          // PILLOW, and the bedP fallback below already declares the head at
          // +IN, so the yaw is +IN and a sleeper's head lands where it always
          // did. Mattress top 0.55 against the old block's hand-typed 0.53 —
          // 2 cm, and now it is a number the piece DECLARES off the box it
          // drew rather than one retyped into a call that had drifted off it.
          if (!kitP("bed", p, Math.atan2(inx, inz), { len: 2.0, wide: 1.0, tone: "clinic" })) {
            decor(p, 0.45, 1.0, 0.16, 2.0, 0xe8e8ee);          // bed
            decor(p, 0.75, 1.0, 0.25, 0.5, 0xbfd8e6);          // pillow end
            bedP(p, inx, inz, 2.0, 0.53);                      // SLEEP anchor (lie axis = IN)
          }
        }
        // (a "curtain" slab and a supply shelf of painted cubes used to follow;
        //  neither ever passed its wall gate. The pharmacy bays are storegoods.js.)
        break;
      }
      case "gas": {
        // (DELETED: a 3 m block of pale-blue glow standing at the counter line as
        //  the "cooler", a plain box "snack endcap" in the middle of the
        //  door-to-till aisle, a box with an orange glowing top as the "coffee
        //  machine", and wall shelves that never placed. The gondolas, the
        //  reach-in cooler bank and the coffee station are city/storegoods.js.)
        break;
      }
      case "carlot":
      case "chop":
      case "realtor": {
        if (kind === "realtor") {
          // a couple of agent desks with little house models + a listings wall
          for (const side of [-1, 1]) {
            const p = pt(6.0, side * (halfTan - 1.9), 0.9);
            if (!p) continue;
            decor(p, 0.4, 1.4, 0.1, 0.8, 0x6b4a2a); decor(p, 0.6, 0.5, 0.3, 0.5, 0xeeeeee);  // desk + monitor
          }
          const lp = pt(2 * halfIn - 2.6, 0, 0.6);
          if (lp) glow(lp, 1.6, along ? 0.05 : 3.2, 1.6, along ? 3.2 : 0.05, 0x4fd0a0, 0.4);   // listings board
          // a SCALE-MODEL development on a centre table + a SOLD sign by the door
          const mt = pt(halfIn, 0, 1.0);
          if (mt) {
            decor(mt, 0.42, along ? 1.2 : 2.2, 0.1, along ? 2.2 : 1.2, 0x6b4a2a);    // table
            for (let g = -1; g <= 1; g++) { const lx = mt.x + tx * g * 0.6, lz = mt.z + tz * g * 0.6; b.lbox(lx, 0.72 + GF, lz, 0.4, 0.5, 0.4, [0xc8cdd4, 0xa9b0b8][(g + 1) % 2], { cast: false }); }
          }
          const ss = pt(4.6, halfTan - 1.0, 0.7);
          if (ss) { decor(ss, 0.85, 0.08, 1.7, 0.08, 0x8a939c); glow(ss, 1.5, along ? 0.05 : 1.0, 0.5, along ? 1.0 : 0.05, 0x4fd0a0, 0.5); }
        } else {
          // car lot / chop shop SHOWROOM: a full display floor — a GRID of
          // turntable pads, each holding a DIFFERENT car from the catalog with a
          // name/price placard, so the dealership actually shows its inventory
          // instead of one lonely box. Spread across EVERY storey of the building
          // (showroomFloor is also called per-upper-floor by the city builder) so
          // every floor is full of cars. A parts/tyre wall keeps the trade read.
          // the chop shop is a working garage (city/modshop.js dresses it), not
          // a dealership: no turntables, no price placards
          if (kind === "carlot") showroomFloor(b, kind, door, 0, 0);   // ground floor = catalog start
        }
        break;
      }
      case "security": {
        // THE CCTV BANK on the back wall behind the counter: six monitors in two
        // rows on a wall rail, grey camera feeds (a feed is not neon cyan). It
        // used to stand at 2hi-2.6, which is the counter's own line, so the
        // "monitors" ran through the counter top. (Its shelving never placed.)
        backWallBox(0, 1.72, 3.1, 0.06, 0.04, 0x2a2d31);                                  // wall rail
        for (let r = 0; r < 2; r++) for (let i = -1; i <= 1; i++) {
          const y = 1.5 + r * 0.44;
          backWallBox(i * 0.92, y, 0.84, 0.4, 0.07, 0x16181b);
          backWallBox(i * 0.92, y, 0.76, 0.34, 0.076, 0x7f949e, { emissive: 0x7f949e, ei: 0.38, cast: false });
        }
        break;
      }
      case "raceway": {
        // ===== THE SPEEDWAY TICKET OFFICE / BETTING PARLOR =====
        // "City Speedway" downtown is the island's city-side front door: an
        // odds board over real betting windows, a lit tri-oval TRACK MAP of
        // Diamond Speedway, a champions' trophy case and team-colour poster
        // wall. The live verbs (bet on the next round, read the standings)
        // are the island's zone interactions (island_speedway.js
        // "raceway-book"); this room is the SET they play on.
        const RWB = 0x2f6fed;                            // the lot's sign blue
        const TEAM = [0xc0392b, 0x1b6ec8, 0x2ba24a, 0xd66a2e, 0x6a2bd6, 0xe0a92e];
        // stay in FRONT of the universal back-of-house partition when the room
        // is deep enough to have one (backDepth = 2*halfIn - 5.5)
        const deepRoom = (2 * halfTan) >= 8 && (2 * halfIn) >= 13;
        const winD = deepRoom ? 2 * halfIn - 6.8 : 2 * halfIn - 3.0;
        // --- BETTING WINDOWS: three teller-style counters, screens glowing ---
        const lat0 = -(halfTan - 1.8);
        for (let i = 0; i < 3; i++) {
          const p = pt(winD, lat0 + i * 1.8, 0.5);
          if (!p) continue;
          decor(p, 0.8, 1.5, 1.6, 0.6, 0x2a2f3a);        // counter body
          decor(p, 1.9, 1.5, 1.0, 0.06, GLASS);          // teller glass
          glow({ x: p.x, z: p.z }, 1.0, 0.3, 0.1, 0.06, RWB, 0.7);   // odds screen
        }
        // --- THE ODDS BOARD: a big lit board above the windows, striped with
        //     dark "runner rows" so it reads as tote odds from the door ---
        const ob = pt(winD + 0.6, 0, 0.5) || pt(winD, 0, 0.5);
        if (ob) {
          glow(ob, 2.6, along ? 0.08 : halfTan * 1.3, 1.1, along ? halfTan * 1.3 : 0.08, RWB, 0.5);
          for (let i = -1; i <= 1; i++) { const lat = i * (halfTan * 0.4); const lx = ob.x + tx * lat, lz = ob.z + tz * lat; b.lbox(lx, 2.6 + GF, lz, along ? 0.05 : 0.62, 0.16, along ? 0.62 : 0.05, 0x141a24, { cast: false }); }
        }
        // --- THE TRACK MAP: a wall panel with a glowing tri-oval ring, the
        //     start/finish tick in red — Diamond Speedway, drawn to covet ---
        const tm = pt(halfIn + 0.6, halfTan - 0.6, 0.6) || pt(halfIn, halfTan - 0.6, 0.6);
        if (tm) {
          decor(tm, 1.7, 0.06, 2.2, 3.6, 0x141a22);      // the dark map board
          const SEG = 18;
          for (let s2 = 0; s2 < SEG; s2++) {
            const a = (s2 / SEG) * Math.PI * 2;
            const dIn = Math.cos(a) * 1.35, dy = Math.sin(a) * 0.72;
            const sf = s2 === Math.floor(SEG * 0.25);    // top of the oval = S/F
            b.lbox(tm.x + inx * dIn, 1.7 + dy + GF, tm.z + inz * dIn,
              along ? 0.14 : 0.1, 0.1, along ? 0.1 : 0.14,
              sf ? 0xc23a36 : 0xeef2f6, { emissive: sf ? 0xc23a36 : 0x7da8d8, ei: sf ? 0.7 : 0.45, cast: false });
          }
          // infield tag: a little gold pylon block inside the ring
          b.lbox(tm.x, 1.7 + GF, tm.z, along ? 0.1 : 0.08, 0.34, along ? 0.08 : 0.1, 0xffd451, { emissive: 0xffd451, ei: 0.5, cast: false });
        }
        // --- CHAMPIONS' TROPHY CASE: lit glass island, a gold cup inside ---
        const tc = pt(halfIn - 1.6, -(halfTan - 2.0), 0.8);
        if (tc) {
          decor(tc, 0.55, 1.1, 1.1, 0.8, 0x2a2f37);      // plinth
          decor(tc, 1.45, 1.0, 0.7, 0.7, GLASS);         // glass bonnet
          b.lbox(tc.x, 1.32 + GF, tc.z, 0.3, 0.42, 0.3, 0xe0b53a, { emissive: 0xe0b53a, ei: 0.4, cast: false });   // the cup
          glow({ x: tc.x, z: tc.z }, 1.12, 0.9, 0.04, 0.6, 0xffe08a, 0.5);   // case light
        }
        // --- TEAM POSTER WALL: driver posters in championship team colours ---
        for (let i = 0; i < 3; i++) {
          const pp = pt(4.6 + i * 2.6, -(halfTan - 0.55), 0.6);
          if (!pp) continue;
          decor(pp, 1.6, 0.05, 1.5, 1.0, 0x10141c);      // poster frame
          glow(pp, 1.6, 0.04, 1.3, 0.8, TEAM[i % TEAM.length], 0.35);   // the team wash
          b.lbox(pp.x, 2.05 + GF, pp.z, along ? 0.03 : 0.5, 0.14, along ? 0.5 : 0.03, 0xeef2f6, { emissive: 0xeef2f6, ei: 0.3, cast: false });  // name strip
        }
        break;
      }
      default: {
        // generic store: the whole sales floor (wall bays, gondola aisles, the
        // cooler bank) is city/storegoods.js. What stood here was one solid
        // 2.4 x 1.1 m grey box with four painted cubes on it as the "gondola".
      }
    }

    // ---- THE STRONGROOM, AND NOTHING ELSE --------------------------------
    // A shop floor used to be diced up by six trades' worth of fake sub-rooms:
    // fitting booths, an enclosed kitchen, hospital exam bays, a gym locker
    // room, a realtor's back office, a bank manager's glass cell. Every one of
    // them was a full-height (4.55 m) wall with NO collider — you walked
    // through the changing room to reach the till.
    //
    // OWNER: "i dont like interior walls unless they are intentional, aka ...
    // bank vault, but i like open space and theres a lot of unnecessary walls
    // rn." So they are gone. What survives is the ONE room on a shop floor
    // that has to be a room — the bank's strongroom, whose whole point is that
    // you cannot walk into it — and it is SOLID: a collider-backed wall the
    // heist has to go through, not around.
    function partAlong(inDepth, lat0, lat1, c) {
      const latC = (lat0 + lat1) / 2, len = Math.abs(lat1 - lat0);
      if (len < 0.2) return;
      const lx = inx * (-halfIn + inDepth) + tx * latC, lz = inz * (-halfIn + inDepth) + tz * latC;
      b.lbox(lx, (FHl - 0.05) / 2, lz, along ? PWT : len, FHl - 0.05, along ? len : PWT, c || PCOL, KITWALL);
    }
    // the same wall perpendicular (running INWARD) at a fixed tangent `lat`.
    function partIn(d0, d1, lat, c) {
      const dC = (d0 + d1) / 2, len = Math.abs(d1 - d0);
      if (len < 0.2) return;
      const lx = inx * (-halfIn + dC) + tx * lat, lz = inz * (-halfIn + dC) + tz * lat;
      b.lbox(lx, (FHl - 0.05) / 2, lz, along ? len : PWT, FHl - 0.05, along ? PWT : len, c || PCOL, KITWALL);
    }
    if ((2 * halfTan) >= 8 && (2 * halfIn) >= 13) {
      if (kind === "clothing") {
        // (DELETED: three 2.2 m curtain SLABS standing free on the shop floor as
        //  "fitting booths", no walls, no rail, nothing to stand in. The fitting
        //  room is clothingstore.js's, in a back corner, with its mirror.)
      } else if (kind === "food") {
        // THE PREP TABLE of the open kitchen behind the counter, built like one:
        // a stainless top at 0.9 m on four legs with an undershelf and a
        // splashback, standing against the side wall with its long side on the
        // wall, a cutting board and a hotel pan on it. It was a 1 m grey block
        // whose orientation flipped with the side the door was on.
        const FL = 0.2, Lg = 2.0, Dp = 0.72;
        const kd = 2 * halfIn - 3.0, kl = halfTan - (b.wt != null ? b.wt : WT) - Dp / 2 - 0.03;
        const kp = { x: inx * (-halfIn + kd) + tx * kl, z: inz * (-halfIn + kd) + tz * kl };
        if (!b.clearFloorPoint || b.clearFloorPoint(kp.x, kp.z, Dp / 2 - 0.05)) {
          const STEEL = 0xb9bfc4;
          const kb = function (dl, de, y, sl, h, si, col) {        // (lat off, in off, centre y, lat size, h, in size)
            const q = off(kp, dl, de);
            b.lbox(q.x, y, q.z, along ? si : sl, h, along ? sl : si, col, { cast: false });
          };
          kb(0, 0, FL + 0.885, Dp, 0.03, Lg, STEEL);                                              // top
          kb(Dp / 2 - 0.01, 0, FL + 1.0, 0.02, 0.2, Lg, STEEL);                                  // splashback (wall side)
          kb(0, 0, FL + 0.19, Dp - 0.08, 0.02, Lg - 0.08, 0x9aa0a6);                             // undershelf
          for (const e1 of [-1, 1]) for (const e2 of [-1, 1]) kb(e1 * (Dp / 2 - 0.04), e2 * (Lg / 2 - 0.04), FL + 0.435, 0.04, 0.87, 0.04, 0x9aa0a6);
          kb(-0.05, -0.45, FL + 0.91, 0.3, 0.02, 0.45, 0xd8c3a0);                                // cutting board
          kb(-0.02, 0.35, FL + 0.935, 0.32, 0.065, 0.52, 0xc9cfd4);                              // hotel pan
          kb(-0.02, 0.35, FL + 0.966, 0.29, 0.004, 0.49, 0x8e3b24);                              // what is in it
        }
      } else if (kind === "bank") {
        // the walled STRONGROOM in the back corner — the one shop sub-room that
        // survives the open-plan pass, and the one the owner named out loud.
        // SPACE DOCTRINE: the vault room's read is bank.js's REAL steel vault
        // (the heist drill point) standing inside these walls — the old floating
        // deco door slab that doubled it mid-room is cut.
        // MERIDIAN TRUST, THE ACTUAL SPILL. This frame measures `lat` from
        // ±halfTan — the OUTER face of the shell — so `vlat + 2.2` resolves to
        // `halfTan + 0.2`: a FULL-HEIGHT (FH − 0.05 ≈ 4.55 m) pale partition
        // whose end stood 0.6 m past the inner wall face and 0.2 m out in the
        // open air, on the pavement, on every bank lot in the world. Both ends
        // now stop at the wall's inner face. (interior_programs.js's shell clamp
        // catches this whole CLASS structurally; the coordinates are corrected
        // here too, because a clamped box is a TRIMMED box and a design should
        // not need trimming to fit inside its own building.)
        const wIn = b.wt != null ? b.wt : WT;
        const vd0 = 2 * halfIn - 6.0, vlat = halfTan - 2.0;
        partAlong(vd0, vlat - 2.2, halfTan - wIn);                   // vault front wall (no gap — the steel vault is the read)
        partIn(vd0, 2 * halfIn - wIn, vlat - 2.2);                   // vault -side wall
        // the manager's desk on the opposite side. It used to sit in a
        // "glass-front cell" made of two walk-through partitions; a desk
        // against the side wall of an open banking hall reads the same and is
        // honest about what you can and cannot walk into (the strongroom).
        const od = pt(6.6, -(halfTan - 1.05), 0.8);
        if (od) {
          decor(od, 0.4, 0.8, 0.8, 1.6, 0x6b4a2a);                   // the ONE desk (long side on the wall)
          glow({ x: od.x, z: od.z }, 0.95, 0.08, 0.3, 0.5, 0x5b8bff, 0.5);   // desk screen (seated on the 0.8 desktop)
          const oc = pt(6.6, -(halfTan - 2.05), 0.7);
          // the office chair: a kit chair (real 0.45 cushion, declared) instead
          // of a 0.9-tall block whose "seat" was the top of a waist-high post.
          if (oc && !kitP("chair", oc, Math.atan2(-tx, -tz))) {
            decor(oc, 0.45, 0.45, 0.9, 0.45, 0x2a2f37); seatP(oc, Math.atan2(-tx, -tz), "chair");   // chair faces the desk
          }
        }
      } else if (kind === "hospital") {
        // CURTAINED exam bays along one side wall — a row of beds down an open
        // ward, which is what a curtain is for. The corridor wall and the three
        // bay dividers that used to enclose them were full-height and
        // walk-through: three fake rooms on every hospital lot in the world.
        // Each is the kit's clinic bed (frame, mattress, pillow, a declared
        // sleep anchor), not the 0.5 m white slab it used to be.
        const lat = halfTan - 1.8;
        for (let i = 0; i < 3; i++) {
          const d = 6.0 + i * 3.2; if (d > 2 * halfIn - 5.0) break;
          const bp = pt(d - 1.4, lat, 0.8);
          if (bp) kitP("bed", bp, Math.atan2(inx, inz), { len: 1.9, wide: 0.8, tone: "clinic" });
        }
      } else if (kind === "gym") {
        // a bank of LOCKERS against the back wall. The two partitions that used
        // to wall the corner off were walk-through; the lockers themselves are
        // the read, and now the whole floor is one room you can cross.
        // It was four 2.2 m blocks standing 1.85 m OFF the back wall in a row.
        // Now: the kit's steel lockers (door faces, handles, one collider) with
        // their backs on the back wall, in the + corner (the fit-out's
        // stockroom prefers the - corner for a gym).
        const wIn = b.wt != null ? b.wt : WT;
        for (let i = 0; i < 2; i++) {
          const lat = (halfTan - wIn) - 0.4 - 1.26 / 2 - i * 1.3;
          const dIn = 2 * halfIn - wIn - 0.26;
          const lp2 = { x: inx * (-halfIn + dIn) + tx * lat, z: inz * (-halfIn + dIn) + tz * lat };
          if (b.clearFloorPoint && !b.clearFloorPoint(lp2.x, lp2.z, 0.2)) continue;
          kitP("locker", lp2, Math.atan2(-inx, -inz), { n: 3 });
        }
      } else if (kind === "realtor") {
        // realtor keeps its open display floor, and now that is ALL it is — the
        // two-wall "back office cell" was a pair of paintings of walls.
        const op = pt(2 * halfIn - 2.8, -(halfTan - 1.8), 0.8);
        // the kit's desk (pedestal, drawers, modesty panel, monitor, chair),
        // the worker facing the room; it was a 1 m brown block
        if (op && !kitP("desk", op, Math.atan2(-inx, -inz), { len: 1.6, deep: 0.8 }))
          decor(op, 0.5, along ? 0.9 : 1.6, 1.0, along ? 1.6 : 0.9, 0x6b4a2a);
      }
    }
    return null;        // (no flavour-word shoplift shelves any more: storegoods.js sells the real stock)
  }

  // a small accent colour per trade (register screen / glow tint)
  function kindAccent(kind) {
    const A = { guns: 0x7ed957, jewelry: 0xffe08a, pawn: 0xffe08a, bar: 0xe85d8a, bank: 0x5b8bff,
      food: 0xff9e6b, gym: 0x66d9c0, clothing: 0xc792ea, drugs: 0x4caf6e, electronics: 0x39d0c0,
      hardware: 0xffd166, hospital: 0xff6b6b, gas: 0xe24b4b, security: 0x49a0c0, casino: 0xc9a227,
      barber: 0x6bb6ff, realtor: 0x4fd0a0, carlot: 0xe88a3c, chop: 0xd0a23c, cityhall: 0xd8dde8 };
    if (A[kind] != null) return A[kind];
    // the civic trades (courthouse/federal/library/...) carry their own accents
    if (CBZ.CIVIC_ACCENT && CBZ.CIVIC_ACCENT[kind] != null) return CBZ.CIVIC_ACCENT[kind];
    return 0x9fd8ee;
  }

  // public hook (and back-compat wrapper) — every shop building gets dressed
  function furnishShop(b, lot, door) {
    const kind = (lot.building && lot.building.shop && lot.building.shop.kind) || (lot.kind) || "store";
    const stock = furnishInterior(b, kind, door);
    // SHOPS_ROBBABLE_V1: expose the shelf stock so the shoplift runtime can grab
    // off it. The flagship gun/jewelry lots run their own richer smash/pry/buy
    // (gunstore.js / jewelry.js), so the runtime skips whichever lots carry those
    // tags — here we just record every shop's shelves.
    if (lot.building && stock && stock.length && (!CBZ.CONFIG || CBZ.CONFIG.SHOPS_ROBBABLE_V1 !== false))
      lot.building.shoplift = stock;
  }
  CBZ.cityFurnishInterior = function (b, kind, door) { furnishInterior(b, kind, door); };

  function furnishHome(b, rng, tier, baseY) {
    return bounded(b, "home", function () { return furnishHomeBody(b, rng, tier, baseY); });
  }
  function furnishHomeBody(b, rng, tier, baseY) {
    // a real living space dressed to the home's TIER so each rung of the ladder
    // feels DISTINCT and lived-in — a bare studio at the bottom, a richly
    // appointed aerie near the top. Every piece is gated by clearFloorPoint so the
    // door->stair aisle never gets blocked. Draw-call-cheap: higher tiers add a
    // handful more cached-material boxes, not a denser per-floor furnish.
    //   t1 studio : bed, kitchenette, one chair, a lamp, a rug, basic art.
    //   t2 flat   : + a real couch + coffee table + TV, a bookshelf, a plant.
    //   t3 loft   : + a dining set, a media console, area rugs, more greenery/art.
    //   t4 aerie  : + premium finishes — a sectional, a bar cart, statement art,
    //               accent uplighting, a console table — the "glass perch" look.
    // `baseY` (the furnishPenthouse pattern) lifts the whole dressing onto an
    // upper floor — the listed home lives at home.floorY (the top storey), so
    // the tier furnishing goes WHERE the tour/elevator actually lands.
    const W = b.w, D = b.d, FHl = b.FH || FH;
    const Y = baseY || 0;
    const beds = (tier && tier.beds) || 1;
    const t = (tier && tier.tier) || 1;
    const cz = D / 2 - 2.0;
    function decor(x, y, z, w, h, d, color, pad) {
      if (!b.clearFloorPoint || b.clearFloorPoint(x, z, pad)) { b.lbox(x, Y + y, z, w, h, d, color, { cast: false }); return true; }
      return false;
    }
    function glowAt(x, y, z, w, h, d, color, ei, pad) {
      if (!b.clearFloorPoint || b.clearFloorPoint(x, z, pad)) b.lbox(x, Y + y, z, w, h, d, color, { emissive: color, ei: ei || 0.5, cast: false });
    }
    // PROPS_PURPOSE anchors (world = local + b.ox/b.oz, y = this floor)
    const abx = b.ox != null ? b.ox : 0, abz = b.oz != null ? b.oz : 0;
    function seatH(x, z, face, kind) { if (CBZ.propRegisterSeat) CBZ.propRegisterSeat(abx + x, Y, abz + z, face, kind, null); }
    // the kit bridge for the tiered home: same contract as kitPiece/kitP —
    // aisle-gate, draw through b.lbox, let the piece file its own anchor with
    // real geometry, return null so the caller's old boxes take over.
    function kitH(name, x, z, yaw, o, pad) {
      const F = CBZ.furnish;
      if (!F || typeof F[name] !== "function" || typeof b.lbox !== "function") return null;
      if (b.clearFloorPoint && !b.clearFloorPoint(x, z, pad == null ? 1.0 : pad)) return null;
      const oo = { box: b.lbox, ox: abx, oz: abz };
      if (o) for (const kk in o) if (oo[kk] === undefined) oo[kk] = o[kk];
      try { return (name === "lamp") ? F.lamp(x, Y, z, oo) : F[name](x, Y, z, yaw, oo); }
      catch (e) { return null; }
    }
    function bedH(x, z, hx, hz, len, topLocalY) { if (CBZ.propRegisterBed) CBZ.propRegisterBed(abx + x, Y, abz + z, hx, hz, len, Y + topLocalY, "bed", null); }
    // emissive CEILING FIXTURE (warm) — homes read lit. Higher tiers add a second
    // back-of-room fixture so the bigger spaces aren't dark in the corners.
    b.lbox(0, Y + FHl - 0.3, 0, 2.0, 0.1, 0.5, 0xffd9a0, { emissive: 0xffd9a0, ei: 0.42, cast: false });
    if (t >= 3) glowAt(-W / 2 + 2.6, FHl - 0.3, cz, 1.6, 0.1, 0.5, 0xffe6c0, 0.4, 1.0);

    // a HARDWOOD/tinted FLOOR slab so each tier reads a different finish underfoot.
    // On an upper floor the slab is clamped to the SOLID part of the plate — the
    // -x stair strip is an open shaft up there (only the ground floor has a
    // full foundation slab to cover).
    const FLOORHEX = [0x3a322a, 0x3a322a, 0x33373f, 0x2e2f36, 0x2a2c34][Math.min(4, t)];
    const fx0 = -W / 2 + 0.7;
    const fx1 = W / 2 - 0.7;
    b.lbox((fx0 + fx1) / 2, Y + 0.02, 0, Math.max(1, fx1 - fx0), 0.04, D - 1.4, FLOORHEX, { cast: false });

    // ---- TIER-SCALED PROGRAMMED HOME (large plates, t>=2) ----------------------
    // WHY: a home should read as ROOMS, not one open box. The room COUNT scales
    // off the tier so each rung of the ladder feels distinct:
    //   t2 flat  : enclosed bedroom + bath nook, the rest open living/kitchen.
    //   t3 loft  : two enclosed bedrooms + bath + open living/kitchen/dining.
    //   t4 aerie : a bedroom SUITE (walk-in + ensuite) + a great-room.
    // Partitions batch-fold; every piece is clearFloorPoint-gated. Studios (t<=1)
    // and tiny plates fall through to the open-plan scatter below.
    const kh = roomKit(b, baseY);
    if (t >= 2 && (kh.xHi - kh.xLo) >= 10 && (kh.zHi - kh.zLo) >= 10) {
      const linenH = [0,0, 0x5a6f9a, 0x7a6f8c, 0x8a6f9c][Math.min(4, t)];
      const sofaH = t >= 4 ? 0x5a4f6a : 0x8a5a2b;
      const midX = kh.xLo + (kh.xHi - kh.xLo) * (t >= 3 ? 0.42 : 0.40);   // private wing on the -x side, living on +x
      const wantBeds = Math.max(1, Math.min(2, t >= 3 ? 2 : 1));
      // VERTICAL partition splitting the private bedroom wing from the great-room
      const wingDoorZ = kh.zLo + (kh.zHi - kh.zLo) * 0.5;
      kh.wallZ(midX, kh.zLo, kh.zHi, wingDoorZ, 1.7);
      // INTERIOR_ROOMPLAN: the enclosed rooms are handed to the layout planner,
      // which knows where a bed goes (headboard on a wall, bedside clearance on
      // the side you approach from) and drops anything it cannot walk to. The
      // `|| set…` fallback is the whole degrade path.
      const tone = t >= 4 ? "exec" : t >= 3 ? "cool" : "warm";
      const wingDoor = { x: (kh.xLo + midX) / 2 };
      if (wantBeds >= 2) {
        // split the wing into two bedrooms + a shared bath strip
        const splitZ = kh.zLo + (kh.zHi - kh.zLo) * 0.5;
        kh.wallX(splitZ, kh.xLo, midX, (kh.xLo + midX) / 2, 1.6);
        const bedA = { x0: kh.xLo + 0.3, x1: midX - 0.3, z0: kh.zLo + 0.3, z1: splitZ - 0.3 };
        if (!planSet(b, Y, bedA, "bedroom", { x: wingDoor.x, z: splitZ }, tone)) setBedroom(kh, bedA, linenH);
        // second bedroom OR an ensuite bath for the lower half
        const lowR = { x0: kh.xLo + 0.3, x1: midX - 0.3, z0: splitZ + 0.3, z1: kh.zHi - 0.3 };
        if (t >= 4) setBath(kh, lowR);
        else if (!planSet(b, Y, lowR, "bedroom", { x: wingDoor.x, z: splitZ }, tone)) setBedroom(kh, lowR, 0x7a6f8c);
      } else {
        // t2: one enclosed bedroom in the top of the wing + a bath nook below it
        const splitZ = kh.zLo + (kh.zHi - kh.zLo) * 0.58;
        kh.wallX(splitZ, kh.xLo, midX, (kh.xLo + midX) / 2, 1.6);
        const bedA = { x0: kh.xLo + 0.3, x1: midX - 0.3, z0: kh.zLo + 0.3, z1: splitZ - 0.3 };
        if (!planSet(b, Y, bedA, "bedroom", { x: wingDoor.x, z: splitZ }, tone)) setBedroom(kh, bedA, linenH);
        if (kh.zHi - splitZ >= 2.2) setBath(kh, { x0: kh.xLo + 0.3, x1: midX - 0.3, z0: splitZ + 0.3, z1: kh.zHi - 0.3 });
      }
      // t4: a WALK-IN closet carved off the bedroom suite (a slim run along -x wall)
      if (t >= 4) {
        kh.put(kh.xLo + 0.6, 1.1, kh.zLo + (kh.zHi - kh.zLo) * 0.25, 0.6, 2.0, 2.4, 0x2e2620, 0.8);  // wardrobe carcass
        kh.glow(kh.xLo + 0.9, 2.0, kh.zLo + (kh.zHi - kh.zLo) * 0.25, 0.06, 0.08, 2.2, 0xfff0d0, 0.4, 0.8);  // rail light
      }
      // the GREAT-ROOM (+x side): living + kitchen + (t3+) a dining set
      const greatX0 = midX + 0.3;
      const livG = { x0: greatX0, x1: kh.xHi, z0: kh.zLo + 0.3, z1: kh.zLo + (kh.zHi - kh.zLo) * 0.5 - 0.3 };
      const livPlan = planSet(b, Y, livG, "lounge", { x: greatX0, z: wingDoorZ }, tone);
      if (livPlan) planMediaWall(b, Y, livG, livPlan);
      else setLiving(kh, livG, sofaH);
      setKitchen(kh, { x0: greatX0, x1: kh.xHi, z0: kh.zHi - (kh.zHi - kh.zLo) * 0.36, z1: kh.zHi });
      if (t >= 3) setDining(kh, { x0: greatX0, x1: kh.xHi, z0: kh.zLo + (kh.zHi - kh.zLo) * 0.5, z1: kh.zHi - (kh.zHi - kh.zLo) * 0.36 - 0.4 });
      return;
    }

    // PRIMARY BED in the back corner (base + mattress + pillow). Linen colour +
    // a headboard richen with tier.
    const linen = [0x6b7da0, 0x6b7da0, 0x5a6f9a, 0x7a6f8c, 0x8a6f9c][Math.min(4, t)];
    // PROPS_PURPOSE: bed ENLARGED (lie axis 1.3→2.2 — it was far too short for
    // a 1.8u character) + registered as a SLEEP anchor, head at the -z pillow end.
    // THE PRIMARY BED IS THE KIT'S: yaw PI (forward = -z) points from the
    // mattress centre at the PILLOW end, i.e. the -z wall, which is exactly
    // where the hand-rolled pillow and headboard were. Same centre, same 2.2
    // lie axis, same 0.55 mattress top — plus rails, a duvet with a turn-down
    // and two pillows, and a bed anchor that declares its own mattress.
    if (!kitH("bed", -W / 2 + 2.0, -D / 2 + 2.6, Math.PI, { len: 2.2, wide: 1.9, tone: { linen: linen } }, 1.1)) {
      decor(-W / 2 + 2.0, 0.35, -D / 2 + 2.6, 2.0, 0.4, 2.2, 0x4a4036, 1.1);   // frame
      if (decor(-W / 2 + 2.0, 0.62, -D / 2 + 2.6, 1.9, 0.2, 2.1, linen, 1.1))  // mattress
        bedH(-W / 2 + 2.0, -D / 2 + 2.6, 0, -1, 2.1, 0.72);
      decor(-W / 2 + 2.0, 0.8, -D / 2 + 1.7, 1.9, 0.22, 0.5, 0xe8e8ee, 1.1);   // pillow
      if (t >= 2) decor(-W / 2 + 2.0, 1.1, -D / 2 + 1.4, 2.0, 0.9, 0.16, [0x55606e, 0x6b4a2a, 0x5a1622][Math.min(2, t - 2)], 1.1);  // headboard (head end)
    }
    if (t >= 3) { decor(-W / 2 + 0.9, 0.45, -D / 2 + 2.2, 0.5, 0.5, 0.5, 0x55452e, 1.1); glowAt(-W / 2 + 0.9, 0.85, -D / 2 + 2.2, 0.4, 0.16, 0.4, 0xffe6b0, 0.5, 1.1); }  // nightstand + lamp
    // a SECOND bed for multi-bed tiers (same enlargement, head at the +z wall)
    if (beds >= 2 && !kitH("bed", -W / 2 + 2.0, D / 2 - 2.6, 0, { len: 2.2, wide: 1.7, tone: { linen: 0x7a6f8c } }, 1.1)) {
      decor(-W / 2 + 2.0, 0.35, D / 2 - 2.6, 1.8, 0.4, 2.2, 0x4a4036, 1.1);
      if (decor(-W / 2 + 2.0, 0.62, D / 2 - 2.6, 1.7, 0.2, 2.1, 0x7a6f8c, 1.1))
        bedH(-W / 2 + 2.0, D / 2 - 2.6, 0, 1, 2.1, 0.72);
      decor(-W / 2 + 2.0, 0.8, D / 2 - 1.7, 1.7, 0.22, 0.5, 0xe8e8ee, 1.1);
    }

    // KITCHEN counter along the back wall (every tier gets a real kitchen). Higher
    // tiers upgrade to a stone worktop + an island.
    decor(W / 2 - 1.6, 0.6, cz, 1.0, 1.0, Math.min(D - 3, 4), 0x55606e, 1.0);
    if (t >= 2) decor(W / 2 - 1.6, 1.12, cz, 1.1, 0.08, Math.min(D - 3, 4), 0xe6e8ee, 1.0);   // stone worktop
    if (t >= 3) { decor(W / 2 - 3.4, 0.55, cz, 1.6, 1.0, 2.4, 0x49505b, 1.0); decor(W / 2 - 3.4, 1.08, cz, 1.7, 0.08, 2.5, 0xc8ccd4, 1.0); }  // kitchen island

    // ---- a STUDIO (t1) keeps it sparse: a single chair + a small rug + a lamp ----
    if (t <= 1) {
      // the studio's ONE chair is now a real armchair (cushion 0.42, declared)
      // rather than a 0.7-topped cube with a plank behind it.
      if (!kitH("armchair", W / 2 - 2.4, -D / 2 + 2.6, Math.PI, { len: 0.9, tone: { cloth: 0x6b5a4a } }, 1.0)) {
        if (decor(W / 2 - 2.4, 0.45, -D / 2 + 2.6, 0.9, 0.5, 0.9, 0x6b5a4a, 1.0))      // armchair seat
          seatH(W / 2 - 2.4, -D / 2 + 2.6, Math.PI, "chair");                          // back at +z → faces -z
        decor(W / 2 - 2.4, 0.95, -D / 2 + 3.0, 0.9, 0.6, 0.16, 0x6b5a4a, 1.0);         // chair back
      }
      decor(W / 2 - 2.0, 0.02, -D / 2 + 2.8, 2.2, 0.04, 2.0, 0x5a4a4a, 1.2);         // small rug
      decor(W / 2 - 1.6, 0.7, -D / 2 + 1.4, 0.12, 1.4, 0.12, 0x2a2f37, 0.7);         // lamp pole
      glowAt(W / 2 - 1.6, 1.5, -D / 2 + 1.4, 0.42, 0.32, 0.42, 0xffe6b0, 0.6, 0.7);  // lamp shade
      glowAt(0, 2.4, -D / 2 + 0.18, 1.2, 0.8, 0.05, 0x5b8bff, 0.16, 0.4);            // one piece of art
      return;
    }

    // ---- t2+ : a full LIVING set (couch + coffee table + TV on a stand + rug) ----
    const sofaC = t >= 4 ? 0x5a4f6a : 0x8a5a2b;
    const sofaTone = { cloth: sofaC };
    if (t >= 4) { // aerie gets an L-sectional
      // THE L IS A COMPOSITION, not one box bent round a corner: a full sofa on
      // the main run plus a matching return. Both are kit pieces in the SAME
      // cloth, so the L still reads as one sectional while every seat on it
      // declares the real 0.40 cushion. Yaws are unchanged (main run looks +z,
      // the return looks -x), so nobody's entry point moves.
      if (!kitH("sofa", W / 2 - 2.6, -D / 2 + 2.6, 0, { len: 2.8, tone: sofaTone }, 1.2)
        && decor(W / 2 - 2.6, 0.45, -D / 2 + 2.6, 2.8, 0.6, 1.0, sofaC, 1.2))
        for (const sx of [-0.8, 0.8]) seatH(W / 2 - 2.6 + sx, -D / 2 + 2.6, 0, "sofa");   // main run faces +z (the room)
      if (!kitH("sofa", W / 2 - 1.4, -D / 2 + 4.0, -Math.PI / 2, { len: 2.4, tone: sofaTone }, 1.2)
        && decor(W / 2 - 1.4, 0.45, -D / 2 + 4.0, 1.0, 0.6, 2.4, sofaC, 1.2))
        seatH(W / 2 - 1.4, -D / 2 + 4.0, -Math.PI / 2, "sofa");                          // return faces -x
    } else {
      const cface = Math.atan2((W / 2 - 1.6) - (W / 2 - 2.4), 0 - (-D / 2 + 2.4));
      if (!kitH("sofa", W / 2 - 2.4, -D / 2 + 2.4, cface, { len: 2.4, tone: sofaTone }, 1.2)
        && decor(W / 2 - 2.4, 0.45, -D / 2 + 2.4, 2.4, 0.6, 1.0, sofaC, 1.2)) {           // couch
        // 2 SEATS facing the TV stand at (W/2-1.6, 0)
        for (const sx of [-0.7, 0.7]) seatH(W / 2 - 2.4 + sx, -D / 2 + 2.4, Math.atan2((W / 2 - 1.6) - (W / 2 - 2.4 + sx), 0 - (-D / 2 + 2.4)), "sofa");
      }
    }
    // the coffee table topped out at 0.65 — a foot ABOVE the cushion it serves.
    // F.coffee lands at 0.40, level with it. Gold on the aerie, as before.
    if (!kitH("coffee", 0, 0, 0, { len: 1.4, deep: 0.9, tone: { wood: t >= 4 ? 0xcaa64a : 0x9aa0a8 } }, 1.0))
      decor(0, 0.4, 0, 1.4, 0.5, 0.9, t >= 4 ? 0xcaa64a : 0x9aa0a8, 1.0);             // coffee table (gold on aerie)
    decor(W / 2 - 1.4, 0.02, -D / 2 + 2.6, 3.0, 0.04, 2.6, [0,0,0x5a4a6a,0x4a3f55,0x4a3550][Math.min(4, t)], 1.4);  // rug

    // a TV on a low STAND / console facing the couch (dark screen + under-glow)
    decor(W / 2 - 1.6, 0.35, 0, 1.8, 0.5, 0.5, 0x2a2f37, 1.0);                       // stand
    const tvW = t >= 4 ? 2.2 : 1.4;
    decor(W / 2 - 1.6, 1.1, 0, tvW, 1.0, 0.08, 0x14171c, 1.0);                       // screen
    glowAt(W / 2 - 1.6, 1.1, -0.04 - SCREEN_GAP - 0.025,
      tvW - 0.3, 0.7, 0.05, 0x39516a, 0.4, 1.0);                         // glass faces couch

    // a BOOKSHELF against a wall (body + a couple of coloured book bands)
    if (decor(-W / 2 + 1.4, 0.9, 0.5, 0.6, 1.8, 1.6, 0x6b4a2a, 0.9)) {
      for (let i = 0; i < 3; i++) glowAt(-W / 2 + 1.4, 0.6 + i * 0.5, 0.5, 0.5, 0.18, 1.4, [0x8a5a2b, 0x5b8bff, 0x4caf6e][i % 3], 0.0, 0.9);
    }

    // a POTTED PLANT in a corner + a floor LAMP (emissive shade) by the couch
    decor(W / 2 - 1.2, 0.25, -D / 2 + 1.2, 0.5, 0.5, 0.5, 0x6b4a2a, 0.8);
    decor(W / 2 - 1.2, 0.9, -D / 2 + 1.2, 0.6, 0.7, 0.6, 0x3f9a4f, 0.8);
    decor(W / 2 - 2.6, 0.7, -D / 2 + 1.4, 0.12, 1.4, 0.12, 0x2a2f37, 0.7);           // lamp pole
    glowAt(W / 2 - 2.6, 1.5, -D / 2 + 1.4, 0.45, 0.35, 0.45, 0xffe6b0, 0.7, 0.7);    // lamp shade

    // ---- t3+ : a DINING set + a second plant + extra art for the lived-in feel ----
    if (t >= 3) {
      // dining set as ONE kit call: long axis on z (yaw 90), `deep` 1.06 so the
      // ring lands on the ±0.95 the six blocks already used — no anchor moves.
      if (!kitH("table", 0, cz - 0.4, Math.PI / 2, { len: 2.6, deep: 1.06, seats: 6 }, 1.1)) {
        decor(0, 0.5, cz - 0.4, 1.2, 0.5, 2.6, 0x6b4a2a, 1.1);                          // dining table
        for (let i = -1; i <= 1; i++) for (const s of [-1, 1]) if (decor(0 + s * 0.95, 0.45, cz - 0.4 + i * 0.9, 0.45, 0.9, 0.45, 0x49505b, 1.1))  // chairs
          seatH(s * 0.95, cz - 0.4 + i * 0.9, Math.atan2(-s * 0.95, -i * 0.9), "chair");   // face the table
      }
      decor(-W / 2 + 2.0, 0.4, D / 2 - 2.2, 0.8, 0.8, 0.8, 0x3f9a4f, 0.9);            // second planter
      glowAt(-W / 2 + 0.22, 2.0, 0, 0.05, 1.2, 2.0, 0xc792ea, 0.18, 0.4);            // side-wall art column
    }

    // ---- t4 aerie : a BAR CART + a console table + accent uplighting (the perch) ----
    if (t >= 4) {
      decor(W / 2 - 2.2, 0.5, D / 2 - 2.6, 0.9, 1.0, 1.4, 0x3a2b1e, 0.9);            // bar cart body
      glowAt(W / 2 - 1.5, 1.4, D / 2 - 2.6, 0.06, 0.9, 1.2, 0x39d0ff, 0.4, 0.9);     // backlit bottles
      decor(-W / 2 + 1.4, 0.5, -D / 2 + 4.2, 0.6, 1.0, 1.8, 0x55452e, 0.9);          // console table
      for (const s of [-1, 1]) glowAt(s * (W / 2 - 0.6), 0.5, 0, 0.18, 1.0, 0.18, 0xffe6c0, 0.5, 0.6);  // accent uplights by the glass
      glowAt(0, 2.5, -D / 2 + 0.18, 2.4, 1.1, 0.05, 0xcaa64a, 0.2, 0.4);             // statement art
    }

    // 1-2 WALL-ART planes (framed colour) high on the back/side wall
    glowAt(0, 2.4, -D / 2 + 0.18, 1.4, 0.9, 0.05, [0x5b8bff, 0xc792ea, 0xff9e6b][t % 3], 0.18, 0.4);
    if (t >= 2) glowAt(W / 2 - 0.18, 2.3, 0, 0.05, 0.8, 1.2, [0x4caf6e, 0xe85d8a][t % 2], 0.18, 0.4);
  }

  // ---- THE GENERIC PER-FLOOR APARTMENT --------------------------------------
  // WHY: tours, stair climbs, elevator rides and stash robberies walk players
  // THROUGH upper storeys that used to be bare slabs. Every storey above ground
  // in a residence/shop now reads as someone's flat — somebody LIVES on the
  // money you're climbing past. ONE dresser ≈ 10 opaque boxes (bed + couch +
  // kitchen run + rug + coffee table + lamp), every piece point-gated by
  // clearFloorPoint so the -x stair strip and the door aisle stay walkable on
  // every floor. No emissive, no textures, cast:false → core/batch.js folds
  // every floor city-wide into a handful of colour buckets (≈zero extra draw
  // calls; merged tris only). `idx` rotates the linen/sofa/rug palettes so
  // stacked flats don't read copy-pasted. Exposed below for the island annex.
  function furnishApartmentFloor(b, baseY, idx) {
    // TYPE COHERENCE (INTERIOR_COHERENCE_V1). OWNER: "A FULL FLOOR OF TINY
    // APARTMENTS EACH WITH A BED THATS IT, TINY TINY APARTMENTS." A residential
    // storey is a CORRIDOR WITH DOORS OFF IT, not one dwelling spread over the
    // whole plate — which on a 27 m lot is a penthouse on every floor of a
    // tenement. The `residential` program DECLINES a plate too small to hold two
    // flats (which genuinely IS one flat) and the dresser below still owns that
    // case, so nothing regresses on a small shell.
    const res = coherentFloor(b, baseY, "home");
    if (res) {
      if (res.beds && res.beds.length) declareResidents(b, res.beds);
      return;
    }
    return bounded(b, "apartment", function () { return furnishApartmentFloorBody(b, baseY, idx); });
  }
  function furnishApartmentFloorBody(b, baseY, idx) {
    const W = b.w, D = b.d, Y = baseY || 0;
    idx = idx | 0;
    // INTERIORS INTENTIONALITY: one building is ONE design. The plan/palette
    // key stops rotating per storey — every floor of a tower repeats the SAME
    // flat exactly (the sanctioned monotony); variety lives BETWEEN buildings
    // via a per-building hash. And a slice of towers is simply VACANT: every
    // under-floor an intentionally empty, lit shell — clean floor, windows,
    // light, nothing else — instead of a scatter pretending to be a home.
    // (The listed top-floor HOME and pool floors are dressed elsewhere and
    // keep their tier program.) Seed-stable; flag-off restores idx rotation.
    const doctrine = CBZ.CONFIG.INTERIORS_INTENTIONAL_V1 !== false && CBZ.hash01;
    const vacant = doctrine && CBZ.hash01(b.ox || 0, b.oz || 0, 0x0A97) < 0.34;
    if (doctrine) idx = (CBZ.hash01(b.ox || 0, b.oz || 0, 0x0A98) * 4) | 0;
    function put(x, y, z, w, h, d, color, pad) {
      if (!b.clearFloorPoint || b.clearFloorPoint(x, z, pad)) { b.lbox(x, Y + y, z, w, h, d, color, { cast: false }); return true; }
      return false;
    }
    const LINEN = [0x6b7da0, 0x7a6f8c, 0x5a6f9a, 0x6f8a7a];
    const SOFA = [0x8a5a2b, 0x55606e, 0x6b4a3a, 0x4a5a6b];
    const linen = LINEN[idx & 3], sofa = SOFA[(idx + 1) & 3];

    const k = roomKit(b, baseY);
    // emissive CEILING fixture so the flat reads lit (one rare emissive piece),
    // FLUSH with the slab underside: walked into, the fit-out's plaster
    // ceiling covers it and its own fittings light the rooms (it used to hang
    // 13 cm under that ceiling as a glowing plank).
    b.lbox((k.xLo + k.xHi) / 2, Y + (b.FH || FH) - 0.205, 0, 1.8, 0.01, 0.5, 0xffd9a0, { emissive: 0xffd9a0, ei: 0.4, cast: false });
    // tinted hardwood FLOOR slab over the solid plate (-x stair strip stays open).
    b.lbox((k.xLo + k.xHi) / 2, Y + 0.02, 0, Math.max(1, k.xHi - k.xLo), 0.04, k.zHi - k.zLo, 0x33373f, { cast: false });
    // VACANT building: the shell above (light + finished floor) IS the design.
    if (CBZ.fitoutDeclare) CBZ.fitoutDeclare(b, Y, "flat", CBZ.interiorFloorRoom ? CBZ.interiorFloorRoom(b, Math.round(Y / (b.FH || FH))) : null,
      { vacant: !!vacant, idx: idx, door: b.localDoor });
    if (vacant) return;

    // ---- PROGRAMMED FLAT (only when the plate is big enough to zone) ----------
    // 1 vertical + 1 horizontal partition split the solid half into: entry/hall
    // by the door, a living room facing the facade glass, a kitchen+small dining
    // strip across the back (+z), an enclosed bedroom in the back +x corner, and a
    // small bath nook beside it. Doorways keep every room reachable (≥1.6u gaps).
    if (k.xHi - k.xLo >= 10 && k.zHi - k.zLo >= 10) {
      const midX = k.xLo + (k.xHi - k.xLo) * 0.46;   // vertical split: living (left) | private wing (right)
      const midZ = (idx & 1) ? k.zLo + (k.zHi - k.zLo) * 0.58 : k.zLo + (k.zHi - k.zLo) * 0.42;  // horizontal split rotates by idx
      // bedroom corner rotates by idx so stacked flats don't read cloned
      const bedTop = (idx & 2) === 0;
      const bedZ0 = bedTop ? k.zLo : midZ, bedZ1 = bedTop ? midZ : k.zHi;
      const bathZ0 = bedTop ? midZ : k.zLo, bathZ1 = bedTop ? k.zHi : midZ;
      // VERTICAL partition (along Z) at midX, doorway into the private wing
      k.wallZ(midX, k.zLo, k.zHi, (bedZ0 + bedZ1) / 2, 1.7);
      // split the private wing into bedroom + bath with a horizontal partition
      k.wallX((bedZ0 + bedZ1) / 2 + (bedTop ? 1 : -1) * 0, midX, k.xHi, (midX + k.xHi) / 2, 1.6);
      // LIVING fills the left (facade) band; KITCHEN+DINING share the back strip
      const livR = { x0: k.xLo, x1: midX - 0.3, z0: k.zLo + 0.3, z1: midZ - 0.3 };
      const dinR = { x0: k.xLo, x1: midX - 0.3, z0: midZ + 0.3, z1: k.zHi };
      const bedR = { x0: midX + 0.3, x1: k.xHi, z0: bedZ0 + 0.3, z1: bedZ1 - 0.3 };
      const bathR = { x0: midX + 0.3, x1: k.xHi, z0: bathZ0 + 0.3, z1: bathZ1 - 0.3 };
      // INTERIOR_ROOMPLAN: the two rooms that are ROOMS (as opposed to a
      // counter run and a tiled nook) go through the layout planner, which is
      // also what finally gives a flat's sofa and bed real propuse cushions.
      // Seeded off the building only, so every storey of one tower plans the
      // identical flat — the monotony this function already enforces.
      // `idx` is already the per-BUILDING palette key under the intentionality
      // doctrine, so it picks the plan's tone too: one coherent palette per
      // tower, four towers apart, and not one new colour bucket.
      const ftone = ["warm", "cool", "exec", "clinic"][idx & 3];
      const livPlan = planSet(b, Y, livR, "lounge", { x: midX, z: (livR.z0 + livR.z1) / 2 }, ftone);
      if (livPlan) planMediaWall(b, Y, livR, livPlan);
      else setLiving(k, livR, sofa);
      setKitchen(k, dinR);
      if (!planSet(b, Y, bedR, "bedroom", { x: midX, z: (bedR.z0 + bedR.z1) / 2 }, ftone)) setBedroom(k, bedR, linen);
      if (bathR.z1 - bathR.z0 >= 2.2) setBath(k, bathR);
      if (CBZ.fitoutSiteOf) {
        const fs = CBZ.fitoutSiteOf(b), fk = fs && fs.floors[Math.round(Y / (b.FH || FH))];
        if (fk && fk.info) fk.info.zones = { liv: livR, din: dinR, bed: bedR, bath: bathR, midX: midX, midZ: midZ };
      }
      return;
    }

    // ---- OPEN-PLAN FALLBACK (tiny plates) — the original studio dressing -------
    // PROPS_PURPOSE: bed enlarged (lie axis 1.3→2.2) + registered sleepable.
    const abx = b.ox != null ? b.ox : 0, abz = b.oz != null ? b.oz : 0;
    const bx = W / 2 - 2.0, bz = -D / 2 + 2.6;
    // KIT BED, yaw PI so the pillow end is the -z end the old boxes used.
    if (!kitPiece(k, "bed", bx, bz, Math.PI, { len: 2.2, wide: 1.8, tone: { linen: linen } }, 1.1)) {
      if (put(bx, 0.35, bz, 1.9, 0.4, 2.2, 0x4a4036, 1.1)) {
        if (put(bx, 0.62, bz, 1.8, 0.2, 2.1, linen, 1.1) && CBZ.propRegisterBed)
          CBZ.propRegisterBed(abx + bx, Y, abz + bz, 0, -1, 2.1, Y + 0.72, "bed", null);   // head at the -z pillow end
        put(bx, 0.8, bz - 0.75, 1.8, 0.2, 0.5, 0xe8e8ee, 1.1);
      }
    }
    const kw = Math.min(W * 0.32, 3.6), kz = D / 2 - 1.6;
    if (put(W / 2 - 2.6, 0.5, kz, kw, 1.0, 0.9, 0x55606e, 1.0))
      put(W / 2 - 2.6, 1.06, kz, kw + 0.1, 0.08, 1.0, 0xe6e8ee, 1.0);
    put(1.2, 0.02, 0.2, 3.0, 0.04, 2.4, 0x4a3f55, 1.6);
    // KIT SOFA (back at +z → the sitters look -z, unchanged) and a KIT coffee
    // table at the real 0.40 instead of a 0.46-topped slab.
    if (!kitPiece(k, "sofa", 1.2, 1.0, Math.PI, { len: 2.2, tone: { cloth: sofa } }, 1.2)) {
      if (put(1.2, 0.42, 1.0, 2.2, 0.55, 0.9, sofa, 1.2)) {
        put(1.2, 0.85, 1.35, 2.2, 0.5, 0.22, sofa, 1.2);
        if (CBZ.propRegisterSeat) for (const sx of [-0.65, 0.65])          // couch back at +z → faces -z
          CBZ.propRegisterSeat(abx + 1.2 + sx, Y, abz + 1.0, Math.PI, "sofa", null);
      }
    }
    if (!kitPiece(k, "coffee", 1.2, -0.5, 0, { len: 1.1, deep: 0.7 }, 0.9))
      put(1.2, 0.3, -0.5, 1.1, 0.32, 0.7, 0x6b4a2a, 0.9);
    if (put(W / 2 - 1.2, 0.7, -0.6, 0.12, 1.4, 0.12, 0x2a2f37, 0.7))
      put(W / 2 - 1.2, 1.5, -0.6, 0.42, 0.3, 0.42, 0xffe6b0, 0.7);
  }
  // the island annex (city/expansion.js) builds shells through cityMakeBuilding
  // but has no dresser of its own — this is its furnishing hook.
  CBZ.cityFurnishApartment = function (b, baseY, idx) { furnishApartmentFloor(b, baseY, idx); };

  // ---- INTERIORS INTENTIONALITY (owner doctrine) ----------------------------
  // "It should be empty, or it should be designed, or it should be a dystopian
  // feeling — intentionally monotonous. I don't want things designed because
  // they have to be." Every office interior is now ONE of: an intentionally
  // EMPTY lit shell (most of them), a DESIGNED PROGRAM (the desk-farm / one
  // meeting room / uniform racks — city/interior_programs.js), or that program
  // repeated floor-for-floor with ZERO variation. The archetype is a
  // per-BUILDING, floor-invariant hash (seed-stable, multiplayer-safe): a
  // tower is ONE thing all the way up — never a different scatter per storey,
  // and never the old reception/meeting/break partition mishmash whose walls
  // read as nobody's plan. Flag-off restores the legacy furnisher verbatim.
  function interiorsV2() { return CBZ.CONFIG.INTERIORS_INTENTIONAL_V1 !== false && !!CBZ.interiorProgram; }
  function officeArchetype(b) {
    if (!CBZ.hash01) return "deskfarm";
    const r = CBZ.hash01(b.ox || 0, b.oz || 0, 0x0FF1);
    if (r < 0.46) return "empty";      // MOST interiors: the clean shell
    if (r < 0.82) return "deskfarm";   // the flagship: rows of desks + working AIs
    if (r < 0.93) return "meeting";    // one room, one table, space
    return "storage";                  // uniform archive racks
  }
  // ---- TYPE COHERENCE (INTERIOR_COHERENCE_V1) ------------------------------
  // OWNER: "EVERY SINGLE INTERIOR SHOULD CONNECT TO THE TYPE OF BUILDING."
  // The three lines below are the whole adoption: ask the ONE mix table what
  // stands on this floor of this kind of building, dress it, and fall back to
  // whatever the caller drew before if the program declines the plate.
  // CBZ.interiorMix REFINES officeArchetype rather than replacing it, so the
  // owner-endorsed 46% intentionally-empty share is untouched.
  function floorIdx(b, baseY) { return Math.max(0, Math.round((baseY || 0) / (b.FH || FH))); }
  function floorsOf(b) {
    return CBZ.interiorFloorCount ? Math.max(1, CBZ.interiorFloorCount(b)) : Math.max(1, b.storeys | 0);
  }
  // dress ONE floor with a NAMED program. null → the caller keeps its own dresser.
  function dressFloorWith(b, baseY, prog, opts) {
    if (!interiorsV2() || !prog) return null;
    const k = roomKit(b, baseY);
    if (k.xHi - k.xLo < 2.4 || k.zHi - k.zLo < 2.4) return null;
    const o = { door: b.localDoor || null };
    if (opts) for (const q in opts) o[q] = opts[q];
    return CBZ.interiorProgram(prog, { x0: k.xLo, x1: k.xHi, z0: k.zLo, z1: k.zHi, y: baseY || 0 },
      { b: b, opts: o });
  }
  // ask the mix, then dress. `where:"above"` = the storeys over a storefront.
  function coherentFloor(b, baseY, kind, where, archetype) {
    if (!interiorsV2() || !CBZ.interiorMix || CBZ.CONFIG.INTERIOR_COHERENCE_V1 === false) return null;
    // a VACANT residential tower keeps its vacancy — the empty vocabulary is the
    // design (an unlet floor mid-renovation), not an absence of one.
    let prog;
    if (kind === "home" && CBZ.CONFIG.INTERIORS_INTENTIONAL_V1 !== false && CBZ.hash01
        && CBZ.hash01(b.ox || 0, b.oz || 0, 0x0A97) < 0.34) prog = "empty";
    else prog = CBZ.interiorMix({ kind: kind, where: where || null, archetype: archetype || null,
      floor: floorIdx(b, baseY), floors: floorsOf(b), b: b });
    return prog ? dressFloorWith(b, baseY, prog) : null;
  }
  // ---- WHO IS INSIDE (INTERIOR_LIFE_V1) ------------------------------------
  // peds.js's lazy vendor pass already stands a clerk at every shop counter.
  // What a bank, a jeweller, a casino or an office lobby has that this game did
  // not is somebody WATCHING THE DOOR. One declared job through
  // city/citystaff.js — no spawner, no brain, no budget of its own.
  const GUARD_TRADES = { bank: 1, jewelry: 1, casino: 1, security: 1, cityhall: 1, courthouse: 1,
    federal: 1, cityannex: 1, hospital: 1, pawn: 1, guns: 1, transit: 1 };
  function declareInteriorGuard(b, id, n) {
    if (!CBZ.interiorPeople || !CBZ.interiorDoorPost) return 0;
    // occupy.js's ROLES table is the ONE declaration of what a guard IS — never
    // a second set of numbers here (its `job` is a real aigoals CITY_JOBS row,
    // which is what keeps the Lv.N pill and the shift honest).
    const R = (CBZ.cityOccupyRoles && CBZ.cityOccupyRoles.guard) || null;
    const jobs = [];
    for (let i = 0; i < (n || 1); i++) {
      const p = CBZ.interiorDoorPost(b, 3.6 + i * 0.8, i === 0 ? 2.1 : -2.1)
        || CBZ.interiorDoorPost(b, 3.6 + i * 0.8, i === 0 ? -2.1 : 2.1);
      if (!p) continue;
      const o = { guard: { x: p.x, z: p.z } };
      if (R) { for (const q in R) if (q !== "job" && q !== "archetype" && q !== "pose") o[q] = R[q]; }
      else { o.kind = "security"; o.armed = true; o.weapon = "Pistol"; o.aggr = 0.6; }
      jobs.push({ x: p.x, z: p.z, face: p.face, pose: (R && R.pose) || "foldarms",
        job: (R && R.job) || "security guard", archetype: (R && R.archetype) || "security", opts: o });
    }
    return jobs.length ? CBZ.interiorPeople(id, jobs) : 0;
  }
  // ONE resident per residential building, asleep in a REAL bed the corridor of
  // flats registered — the `alive` gate is the clock, so he exists at night and
  // the row costs nothing by day. He is given NO job string on purpose: peds.js
  // deals him a trade (CLAUDE.md — "resident" is not a role).
  function declareResidents(b, beds) {
    if (!CBZ.interiorPeople || !beds || !beds.length || b._interiorResidents) return 0;
    b._interiorResidents = true;
    // Not every block: a body is ~16 draw calls and citystaff's live budget is
    // shared with the marina, the airside and the casino. About half the
    // residential buildings carry a sleeper, picked on the building hash — so
    // it is the same buildings every run, and a lit window with somebody in it
    // means something because the next one is dark.
    if (CBZ.hash01 && CBZ.hash01(b.ox || 0, b.oz || 0, 0x1E5D) >= 0.5) return 0;
    const pick = beds[(Math.abs(Math.round(b.ox || 0)) + Math.abs(Math.round(b.oz || 0))) % beds.length];
    if (!pick) return 0;
    return CBZ.interiorPeople("home:" + Math.round(b.ox || 0) + ":" + Math.round(b.oz || 0), [{
      x: pick.x, z: pick.z, face: pick.face || 0, bed: pick,
      opts: { floorY: pick.y || 0 },
      alive: function () { return (CBZ.nightAmount == null ? 0 : CBZ.nightAmount) > 0.45; },
      near: 60, far: 110,
    }]);
  }

  function furnishOfficeFloorV2(b, baseY) {
    const arch = officeArchetype(b);
    // the mix decides WHICH program on THIS storey (desks, a meeting floor, one
    // break floor on a cadence); the archetype still decides empty-vs-programmed.
    const res = coherentFloor(b, baseY, "office", null, arch)
      || dressFloorWith(b, baseY, arch);
    return (res && res.anchors) || [];
  }

  // ---- THE GENERIC PER-FLOOR OFFICE -----------------------------------------
  // WHY: an OFFICE tower full of seated workers is a living floor you see through
  // the curtain wall, a payroll to rob, and witnesses who panic + call cops when
  // you barge in armed (city/officejobs.js wires the consequence). The dressing
  // is the apartment dresser's twin: rows of WORK DESKS on the solid half of the
  // plate (the -x stairwell + the door aisle stay walkable via clearFloorPoint),
  // each desk = a top slab + pedestal + a monitor + a chair, all plain opaque
  // cast:false boxes with NO userData so core/batch.js folds every office floor
  // city-wide into a handful of colour buckets (≈zero extra draw calls).
  //
  // For EACH desk it computes the seat as a WORLD-coord anchor {x,y,z,face} — the
  // chair position at floor height, facing the monitor — and RETURNS the floor's
  // anchors. The caller accumulates them across storeys and registers the whole
  // building's seats once via CBZ.cityRegisterOfficeDesks (officejobs.js seats
  // workers there; a seated worker = an AI working a job, not decoration).
  function furnishOfficeFloor(b, baseY, idx) {
    // DOCTRINE PATH: one archetype per building, identical on every floor.
    // (idx — the per-floor palette/scatter rotator — is deliberately unused
    // there: variation between storeys is exactly what the owner killed.)
    if (interiorsV2()) return furnishOfficeFloorV2(b, baseY);
    return bounded(b, "office", function () { return furnishOfficeFloorBody(b, baseY, idx); });
  }
  function furnishOfficeFloorBody(b, baseY, idx) {
    const W = b.w, D = b.d, FHl = b.FH || FH, Y = baseY || 0;
    idx = idx | 0;
    const anchors = [];
    // desk + chair palette rotates per floor so stacked floors don't read cloned.
    const DESKC = [0x6b5a44, 0x55606e, 0x5a5048, 0x4a5560];
    const CHAIRC = [0x2a2f37, 0x36302a, 0x2e333b, 0x332e2a];
    const PANELC = [0x9fb4c8, 0xb0a8c0, 0xa8b8a8, 0x9fb0c4];   // monitor face tint (opaque, batch-safe)
    const desk = DESKC[idx & 3], chair = CHAIRC[(idx + 1) & 3], panel = PANELC[(idx + 2) & 3];
    // emissive ceiling strip so the floor reads LIT through the glass — one box
    // (the only emissive piece; the lit-fixture precedent from furnishApartment).
    b.lbox(1.0, Y + FHl - 0.22, 0, Math.min(W * 0.5, 5.0), 0.1, 0.5, 0xeef2ff, { emissive: 0xeef2ff, ei: 0.35, cast: false });

    // ONE workstation: desk slab + pedestal + monitor + chair, gated on the chair
    // point (pad clears the stair strip / door aisle). `dir` = +1 → the chair sits
    // on the +z side and the worker faces -z (toward the monitor on the desk's -z
    // edge); -1 mirrors it. Records the seat anchor in WORLD coords when it lands.
    function station(cx, cz, dir) {
      const seatZ = cz + dir * 0.85;          // chair sits one side of the desk centre
      const monZ = cz - dir * 0.42;           // monitor on the far (work) edge
      // gate on BOTH the chair AND the desk body so neither pokes the stairs/door
      if (!b.clearFloorPoint || !b.clearFloorPoint(cx, seatZ, 0.6) || !b.clearFloorPoint(cx, cz, 0.7)) return;
      // desk: a 0.7-tall pedestal under a thin worktop
      b.lbox(cx, Y + 0.36, cz, 1.5, 0.66, 0.85, desk, { cast: false });
      b.lbox(cx, Y + 0.72, cz, 1.62, 0.08, 0.95, 0xc9ccd2, { cast: false });   // pale worktop
      // monitor: a thin dark slab + a pale opaque "screen" face (no emissive →
      // stays in the batch; reads as a lit display at office scale)
      b.lbox(cx, Y + 1.02, monZ, 0.7, 0.46, 0.06, 0x14181e, { cast: false });
      b.lbox(cx, Y + 1.04, monZ + dir * (0.03 + SCREEN_GAP + 0.01),
        0.58, 0.36, 0.02, panel, { cast: false });
      b.lbox(cx, Y + 0.74, monZ, 0.12, 0.12, 0.12, 0x14181e, { cast: false });   // stand
      // CHAIR: a task chair, not two slabs. Star base + gas post + a pad that
      // oversails its frame + a raked back (stacked panels stepped aft, the
      // furniture.js rake trick — boxes here are never rotated) + armrests.
      // The pad's TOP stays at exactly 0.48, which is the cushionH declared in
      // the anchor below; move one and you must move the other.
      const FD = CBZ.CONFIG.FURNISH_DETAIL !== false;
      if (FD) {
        b.lbox(cx, Y + 0.03, seatZ, 0.56, 0.06, 0.56, 0x14181e, { cast: false });         // star base
        b.lbox(cx, Y + 0.22, seatZ, 0.09, 0.32, 0.09, 0x14181e, { cast: false });         // gas post
        b.lbox(cx, Y + 0.41, seatZ, 0.50, 0.06, 0.50, 0x14181e, { cast: false });         // seat frame
        b.lbox(cx, Y + 0.455, seatZ, 0.60, 0.05, 0.60, chair, { cast: false });           // pad → 0.48
        b.lbox(cx, Y + 0.60, seatZ + dir * 0.24, 0.58, 0.20, 0.09, chair, { cast: false });  // lumbar
        b.lbox(cx, Y + 0.82, seatZ + dir * 0.30, 0.58, 0.26, 0.09, chair, { cast: false });  // upper back, stepped aft
        b.lbox(cx, Y + 1.00, seatZ + dir * 0.34, 0.60, 0.09, 0.10, chair, { cast: false });  // head rail
        for (const a of [-1, 1])
          b.lbox(cx + a * 0.31, Y + 0.62, seatZ + dir * 0.04, 0.06, 0.05, 0.34, 0x14181e, { cast: false });  // armrests
      } else {
        b.lbox(cx, Y + 0.42, seatZ, 0.6, 0.12, 0.6, chair, { cast: false });        // seat pad
        b.lbox(cx, Y + 0.78, seatZ + dir * 0.26, 0.6, 0.7, 0.12, chair, { cast: false });  // backrest
        b.lbox(cx, Y + 0.2, seatZ, 0.1, 0.4, 0.1, 0x14181e, { cast: false });        // post
      }
      // SEAT ANCHOR (world coords): the chair point at floor height, facing the
      // monitor. The monitor sits straight across the desk in z, so the yaw is
      // atan2(dx,dz) toward it — the SAME facing convention peds use everywhere.
      anchors.push({
        x: b.ox + cx, y: Y, z: b.oz + seatZ,
        face: Math.atan2(0, monZ - seatZ),
        cushionH: 0.48, floorBelow: 0,
      });
    }

    // ---- ZONED (not walled) SHELL around the bullpen (large plates only) -----
    // WHY: a real office has a reception you arrive into, a meeting end and a
    // break corner. It used to have PARTITIONS around them — walls with no
    // collider, i.e. paintings of walls, which is exactly the owner's complaint
    // ("i dont like interior walls unless they are intentional ... i like open
    // space"). The rooms are still ZONES: the desk grid still stops short of the
    // meeting strip and the break corner, so the furniture reads as three
    // distinct areas of one open floor. The walls are gone, not made solid — an
    // office floor is not an apartment and not a vault.
    const k = roomKit(b, baseY);
    let bullZ1 = k.zHi;                          // back limit of the desk grid (shrinks if rooms claim the back)
    let bullX1 = k.xHi;                          // +x limit of the desk grid (shrinks if a break room claims a corner)
    const bigOffice = (k.xHi - k.xLo) >= 12 && (k.zHi - k.zLo) >= 12;
    if (bigOffice) {
      // RECEPTION near the door aisle, against the -z front: a desk + waiting chairs
      const recR = { x0: k.xLo + 0.4, x1: Math.min(k.xLo + 5.5, k.xHi), z0: k.zLo + 0.4, z1: k.zLo + 3.4 };
      setReception(k, recR, 0xeef2ff);
      // 1-2 enclosed MEETING ROOMS along the +z back wall (glass-walled conf rooms)
      const mzDepth = 4.2;
      const mz0 = k.zHi - mzDepth;
      bullZ1 = mz0 - 0.6;                        // desks stop short of the meeting strip
      const mw = (k.xHi - k.xLo);
      const nMeet = mw >= 18 ? 2 : 1;
      for (let m = 0; m < nMeet; m++) {
        const mx0 = k.xLo + m * (mw / nMeet), mx1 = k.xLo + (m + 1) * (mw / nMeet);
        setMeeting(k, { x0: mx0 + 0.3, x1: mx1 - 0.3, z0: mz0 + 0.3, z1: k.zHi - 0.3 });
      }
      // a BREAK corner in the back +x of the plate (the desks yield the space)
      const brW = 4.2, brD = 4.0;
      const brX0 = k.xHi - brW, brZ1 = bullZ1, brZ0 = brZ1 - brD;
      if (brZ0 > k.zLo + 3.5) {
        setBreak(k, { x0: brX0 + 0.3, x1: k.xHi - 0.3, z0: brZ0 + 0.3, z1: brZ1 - 0.3 });
        bullX1 = brX0 - 0.6;                     // desks stop short of the break corner... (only in the back rows)
      }
    }

    // lay desks across the SOLID half of the plate (right of the -x stairwell,
    // out to the +x wall), in columns × depth rows, so a wide core tower seats a
    // whole bullpen and a narrow walk-up a couple of desks. clearFloorPoint
    // silently drops any station landing in the stair strip or entrance aisle, so
    // the spread can run the full width without ever blocking the climb/door.
    const xHi = W / 2 - 2.0;                                  // first column off the +x wall
    const xLo = -W / 2 + 2.0;
    const cols = Math.max(1, Math.min(4, Math.floor((xHi - xLo) / 3.0) + 1));
    const dxc = cols > 1 ? (xHi - xLo) / (cols - 1) : 0;
    // grid runs from the front (just inside the reception/door zone) to bullZ1
    // (short of the back meeting strip when the office is partitioned).
    const z0 = bigOffice ? Math.max(-D / 2 + 2.2, k.zLo + 3.8) : (-D / 2 + 2.2);
    const zEnd = bigOffice ? bullZ1 : (D / 2 - 2.2);
    const rows = Math.max(2, Math.min(6, Math.floor((zEnd - z0) / 2.6) + 1));
    const dz = rows > 1 ? (zEnd - z0) / (rows - 1) : 0;
    for (let c = 0; c < cols; c++) {
      const cx = xHi - c * dxc;
      for (let r = 0; r < rows; r++) {
        const cz = z0 + r * dz;
        // skip desks that would fall inside the break-room corner
        if (bigOffice && cx > bullX1 && cz > bullZ1 - 4.6) continue;
        // alternate which side the chair sits so back-to-back rows share an aisle
        station(cx, cz, (r & 1) ? 1 : -1);
      }
    }
    return anchors;
  }

  // THE PENTHOUSE — the apex home filling the top floor of the mega-tower. This
  // is the loft turned all the way up: a marble plinth bedroom with a four-poster
  // king, a sunken lounge ringed by a wraparound sectional + a wall-spanning TV, a
  // marble kitchen island with a waterfall counter + bar stools, a long dining
  // table, a glowing CHANDELIER, a private home BAR with a backlit bottle wall, a
  // grand piano, gold accent columns by the glass, a luxe rug, and warm cove
  // lighting. Everything dressed at `baseY` (the top interior floor); the glass
  // curtain wall (from the modern shell) rings it on all sides. The elevator +
  // the penthouse door both land the owner right here. Draw-call-cheap (shared
  // cached mats via b.lbox; no per-floor furniture — only the top floor is dressed).
  function furnishPenthouse(b, baseY) {
    return bounded(b, "penthouse", function () { return furnishPenthouseBody(b, baseY); });
  }
  function furnishPenthouseBody(b, baseY) {
    const W = b.w, D = b.d, FHl = b.FH || FH;
    const Y = baseY || 0;
    const lb = (x, y, z, w, h, d, c, o) => b.lbox(x, Y + y, z, w, h, d, c, o || { cast: false });
    const glow = (x, y, z, w, h, d, c, ei) => b.lbox(x, Y + y, z, w, h, d, c, { emissive: c, ei: ei || 0.5, cast: false });
    // PROPS_PURPOSE anchors (world = local + b.ox/b.oz; y = the penthouse floor)
    const abx = b.ox != null ? b.ox : 0, abz = b.oz != null ? b.oz : 0;
    const seatPH = (x, z, face, kind) => { if (CBZ.propRegisterSeat) CBZ.propRegisterSeat(abx + x, Y, abz + z, face, kind, null); };
    // THE KIT BRIDGE, and this room is the one that most deserves it: the
    // penthouse is the apex interior in the game and every seat in it was a
    // 0.90-topped velvet block declaring nothing. `lift` puts a piece on the
    // master-bedroom plinth. Returns null → the caller's own boxes stand.
    const kitPH = (name, x, z, yaw, o, lift) => {
      const F = CBZ.furnish;
      if (!F || typeof F[name] !== "function") return null;
      const oo = { box: b.lbox, ox: abx, oz: abz };
      if (o) for (const kk in o) if (oo[kk] === undefined) oo[kk] = o[kk];
      try { return F[name](x, Y + (lift || 0), z, yaw, oo); } catch (e) { return null; }
    };
    const MARBLE = 0xe6e8ee, GOLD = 0xcaa64a, DARKWOOD = 0x3a2b1e, VELVET = 0x5a1622, STONE = 0x9aa0a8;
    // ---- a polished MARBLE floor slab covering the whole penthouse ----
    lb(0, 0.02, 0, W - 1.4, 0.04, D - 1.4, 0xc8ccd4);
    // ---- warm COVE light running the perimeter + a central CHANDELIER ----
    for (let i = -1; i <= 1; i++) glow(i * (W / 3.0), FHl - 0.22, 0, W / 4.2, 0.08, 0.35, 0xffe6c0, 0.5);
    glow(0, FHl - 0.55, 0, 1.0, 0.5, 1.0, 0xfff0d0, 0.85);                          // chandelier body
    for (let a = 0; a < 8; a++) { const an = a / 8 * 6.283; glow(Math.cos(an) * 0.7, FHl - 0.5, Math.sin(an) * 0.7, 0.16, 0.3, 0.16, 0xffe6a0, 0.7); }  // chandelier drops
    // ---- MASTER BEDROOM on a raised marble plinth in the back corner ----
    lb(-W / 2 + 3.0, 0.08, -D / 2 + 3.2, 6.2, 0.16, 5.4, MARBLE);                   // plinth
    // THE KING, on the plinth (lift 0.16). yaw PI puts the pillows at the -z
    // end, between the four-poster posts and under the velvet headboard wall,
    // exactly where they were. It also drops the mattress from an absurd 1.03
    // (chest height on a 1.8 u character — you would climb it) to 0.71 above
    // the floor: 0.55 above the plinth it stands on, the real number.
    if (!kitPH("bed", -W / 2 + 3.0, -D / 2 + 3.2, Math.PI,
      { len: 2.4, wide: 2.8, tone: { linen: 0x6b7da0, frame: DARKWOOD } }, 0.16)) {
      lb(-W / 2 + 3.0, 0.55, -D / 2 + 3.2, 3.0, 0.5, 2.4, DARKWOOD);                  // king frame
      lb(-W / 2 + 3.0, 0.9, -D / 2 + 3.2, 2.8, 0.26, 2.3, 0x6b7da0);                  // mattress
      // PROPS_PURPOSE: the king is already character-sized — register it
      // sleepable (head at the -z pillow end, mattress top 1.03).
      if (CBZ.propRegisterBed) CBZ.propRegisterBed(abx + (-W / 2 + 3.0), Y, abz + (-D / 2 + 3.2), 0, -1, 2.3, Y + 1.03, "bed", null);
      lb(-W / 2 + 3.0, 1.12, -D / 2 + 2.2, 2.8, 0.3, 0.6, 0xe8e8ee);                  // pillows
    }
    lb(-W / 2 + 3.0, 2.0, -D / 2 + 4.5, 3.2, 1.6, 0.2, VELVET);                     // velvet headboard wall
    for (const s of [-1, 1]) { lb(-W / 2 + 3.0 + s * 1.7, 1.4, -D / 2 + 2.0, 0.12, 2.6, 0.12, GOLD); }  // four-poster posts (front)
    for (const s of [-1, 1]) { lb(-W / 2 + 3.0 + s * 1.7, 0.45, -D / 2 + 4.4, 0.5, 0.7, 0.5, DARKWOOD); glow(-W / 2 + 3.0 + s * 1.7, 0.95, -D / 2 + 4.4, 0.4, 0.16, 0.4, 0xffe6b0, 0.5); }  // nightstands + lamps
    // ---- SUNKEN LOUNGE: wraparound sectional facing a wall-spanning media wall ----
    lb(0, 0.02, D / 2 - 5.0, 8.5, 0.04, 5.0, 0x4a3550);                             // luxe rug
    // THE WRAPAROUND SECTIONAL, composed from three kit sofas in one velvet:
    // a 7 m main run facing the media wall plus a return down each side. Same
    // centres, same yaws, same colour — but arms, seat seams and a real 0.40
    // cushion, and every anchor declares it.
    const phSofa = { tone: { cloth: 0x6b2230, frame: DARKWOOD } };
    if (!kitPH("sofa", 0, D / 2 - 3.2, 0, { len: 7.0, tone: phSofa.tone })) {
      lb(0, 0.5, D / 2 - 3.2, 7.0, 0.65, 1.2, 0x6b2230);                            // sofa back run (velvet)
      for (const sx of [-2.2, 0, 2.2]) seatPH(sx, D / 2 - 3.2, 0, "sofa");          // main run faces the TV (+z)
    }
    for (const s of [-1, 1]) {
      if (kitPH("sofa", s * 3.4, D / 2 - 4.6, -s * Math.PI / 2, { len: 3.0, tone: phSofa.tone })) continue;
      lb(s * 3.4, 0.5, D / 2 - 4.6, 1.2, 0.65, 3.0, 0x6b2230); seatPH(s * 3.4, D / 2 - 4.6, -s * Math.PI / 2, "sofa");   // sectional returns face centre
    }
    if (!kitPH("coffee", 0, D / 2 - 5.6, 0, { len: 2.6, deep: 1.1, tone: { wood: GOLD } }))
      lb(0, 0.42, D / 2 - 5.6, 2.6, 0.42, 1.1, GOLD);                               // gold coffee table
    lb(0, 1.5, D / 2 - 0.3, 5.0, 2.2, 0.12, 0x101319);                             // wall-spanning TV
    glow(0, 1.5, D / 2 - 0.36 - SCREEN_GAP - 0.025,
      4.6, 1.8, 0.05, 0x39516a, 0.45);                                  // glass faces lounge
    // ---- MARBLE KITCHEN: island w/ waterfall counter + stools + back run ----
    lb(W / 2 - 3.4, 0.55, 0.4, 2.2, 1.0, 4.6, STONE);                              // island body
    lb(W / 2 - 3.4, 1.08, 0.4, 2.4, 0.1, 4.9, MARBLE);                             // waterfall worktop
    // bar stools face the island (+x). Kit stools: cushion at the real 0.68 for
    // a 1.08 worktop, not a 0.90 post you would have to vault.
    for (let i = -1; i <= 1; i++) {
      const sz = 0.4 + i * 1.4;
      if (kitPH("stool", W / 2 - 5.0, sz, Math.PI / 2, { tone: { cloth: GOLD } })) continue;
      lb(W / 2 - 5.0, 0.45, sz, 0.5, 0.9, 0.5, DARKWOOD); glow(W / 2 - 5.0, 0.92, sz, 0.42, 0.1, 0.42, GOLD, 0.3); seatPH(W / 2 - 5.0, sz, Math.PI / 2, "stool");
    }
    lb(W / 2 - 1.3, 0.6, -D / 2 + 3.4, 1.0, 1.1, 4.4, 0x49505b);                   // back counter run
    glow(W / 2 - 1.0, 1.7, -D / 2 + 3.4, 0.05, 0.9, 3.2, 0x9fe0ff, 0.3);           // backsplash glow
    // ---- a HOME BAR with a backlit bottle wall in the far corner ----
    lb(W / 2 - 2.4, 0.55, D / 2 - 2.6, 1.0, 1.0, 3.0, DARKWOOD);                   // bar counter
    glow(W / 2 - 1.0, 1.8, D / 2 - 2.6, 0.06, 1.6, 2.6, 0x39d0ff, 0.5);            // backlit bottle shelf
    for (let i = -2; i <= 2; i++) lb(W / 2 - 1.2, 1.4 + (i % 2) * 0.5, D / 2 - 2.6 + i * 0.5, 0.12, 0.4, 0.12, [0x6fbf73, 0xbf6f6f, 0xc7b06f][(i + 2) % 3]);  // bottles
    // ---- a long DINING table with chairs ----
    lb(W / 2 - 7.5, 0.5, D / 2 - 4.5, 1.4, 0.5, 3.8, DARKWOOD);
    glow(W / 2 - 7.5, 0.78, D / 2 - 4.5, 0.9, 0.04, 3.2, 0xffe6c0, 0.18);          // candlelit runner
    // chairs face the table. Kit chairs in the room's velvet: 0.45 cushion,
    // raked back, declared — the old six were 0.9 blocks with a "chair" label.
    for (let i = -1; i <= 1; i++) for (const s of [-1, 1]) {
      const dcx = W / 2 - 7.5 + s * 1.1, dcz = D / 2 - 4.5 + i * 1.2, dface = Math.atan2(-s * 1.1, -i * 1.2);
      if (kitPH("chair", dcx, dcz, dface, { tone: { cloth: VELVET } })) continue;
      lb(dcx, 0.45, dcz, 0.5, 0.9, 0.5, VELVET); seatPH(dcx, dcz, dface, "chair");
    }
    // ---- a GRAND PIANO near the lounge ----
    lb(-W / 2 + 3.0, 0.45, D / 2 - 4.0, 2.4, 0.5, 1.6, 0x14171c);                  // body
    lb(-W / 2 + 3.0, 0.78, D / 2 - 3.2, 2.4, 0.08, 0.4, 0x14171c);                 // open lid hint
    for (let i = -1; i <= 1; i++) lb(-W / 2 + 2.0, 0.2, D / 2 - 4.0 + i * 0.5, 0.1, 0.4, 0.1, 0x14171c);  // legs
    // ---- GOLD accent columns flanking the glass + big planters ----
    for (const s of [-1, 1]) lb(s * (W / 2 - 1.0), FHl / 2, 0, 0.3, FHl, 0.3, GOLD);
    lb(-W / 2 + 2.2, 0.5, D / 2 - 2.4, 1.0, 1.0, 1.0, 0x3f9a4f);                    // planter
    lb(W / 2 - 2.0, 0.5, -D / 2 + 2.2, 1.0, 1.0, 1.0, 0x3f9a4f);
    // ---- statement ART on the solid back stretches ----
    glow(-W / 2 + 0.22, 2.0, 0, 0.05, 1.6, 2.6, 0xc792ea, 0.22);
    glow(0, 2.6, -D / 2 + 0.22, 2.6, 1.2, 0.05, GOLD, 0.2);

    // ====================================================================
    // FILL THE WASTED FLOOR: the bedroom/lounge/kitchen ring the perimeter and
    // leave the deep mid-band empty. A real luxury floor zones it into private
    // amenities. Everything point-gated so the door/stair aisle stays walkable.
    // ====================================================================
    const zone = (x, y, z, w, h, d, c, o) => {
      if (!b.clearFloorPoint || b.clearFloorPoint(x, z, 1.2)) lb(x, y, z, w, h, d, c, o);
    };
    const zoneGlow = (x, y, z, w, h, d, c, ei) => {
      if (!b.clearFloorPoint || b.clearFloorPoint(x, z, 1.2)) glow(x, y, z, w, h, d, c, ei);
    };

    // ---- HOME GYM in the back-CENTRE (rubber floor + rack, bench, treadmill) ----
    const gx = 0, gz = -D / 2 + 3.4;
    zone(gx, 0.02, gz, 5.0, 0.05, 4.0, 0x1c1f24);                                  // rubber gym floor
    zone(gx - 1.6, 1.1, gz - 1.2, 0.16, 2.2, 1.6, 0x2a2f37);                       // squat-rack uprights
    zone(gx - 1.6, 2.0, gz - 1.2, 0.16, 0.16, 1.6, 0x44505c);                      // barbell on rack
    zone(gx + 0.4, 0.45, gz + 0.4, 0.5, 0.45, 1.7, 0x14171c);                      // flat bench pad
    zone(gx + 1.9, 0.18, gz + 0.6, 1.0, 0.3, 1.8, 0x2a2f37);                       // treadmill deck
    zone(gx + 1.9, 0.9, gz - 0.4, 1.0, 0.7, 0.1, 0x14171c);                        // treadmill console
    for (let i = 0; i < 4; i++) zone(gx - 2.2, 0.18 + i * 0.06, gz + 1.5 - i * 0.18, 0.7, 0.16, 0.16, [0x6a7078, 0x55606e][i & 1]);  // dumbbell rack
    zoneGlow(gx, FHl - 0.24, gz, 3.0, 0.06, 0.3, 0xeaf2ff, 0.3);                   // gym strip light

    // ---- HOME OFFICE / STUDY mid-floor (-x of centre): desk, chair, shelves ----
    const ox = -W / 6, oz = -1.0;
    zone(ox, 0.4, oz, 1.8, 0.7, 0.9, DARKWOOD);                                    // executive desk pedestal
    zone(ox, 0.78, oz, 1.95, 0.08, 1.0, MARBLE);                                   // stone desktop
    zoneGlow(ox, 1.0, oz - 0.3, 0.7, 0.4, 0.05, 0x39516a, 0.4);                    // monitor glow
    zone(ox, 0.45, oz + 0.9, 0.6, 0.5, 0.6, 0x14171c);                             // leather chair seat
    zone(ox, 0.95, oz + 1.15, 0.6, 0.7, 0.12, 0x14171c);                           // chair back
    if (!b.clearFloorPoint || b.clearFloorPoint(ox, oz - 1.6, 1.0)) {             // bookshelves behind the desk
      lb(ox, 1.1, oz - 1.6, 2.6, 2.0, 0.5, DARKWOOD);
      for (let s = 0; s < 4; s++) glow(ox - 0.9 + s * 0.6, 0.6 + (s & 1) * 0.8, oz - 1.4, 0.4, 0.4, 0.16, [0x8a5a2b, 0x5b8bff, 0x4caf6e, VELVET][s], 0.0);
    }

    // ---- LIBRARY / READING LOUNGE in the mid-+z band: armchairs + low table ----
    const lx2 = -W / 6, lz2 = D / 2 - 6.0;
    zone(lx2, 0.02, lz2, 4.0, 0.04, 3.4, 0x3a2f3a);                                // reading rug
    for (const s of [-1, 1]) { zone(lx2 + s * 1.1, 0.45, lz2, 1.0, 0.5, 1.0, 0x5a4f6a); zone(lx2 + s * 1.1, 0.9, lz2 - 0.4, 1.0, 0.6, 0.16, 0x5a4f6a); }  // facing armchairs
    zone(lx2, 0.35, lz2, 0.9, 0.35, 0.9, GOLD);                                    // brass side table
    zone(lx2, 0.7, lz2, 0.16, 1.4, 0.16, 0x2a2f37);                               // floor lamp pole
    zoneGlow(lx2, 1.55, lz2, 0.42, 0.3, 0.42, 0xffe6b0, 0.6);                      // lamp shade

    // ---- WINE WALL / CELLAR DISPLAY against the -x wall (backlit bottle racks) ----
    const wz = 1.0;
    zone(-W / 2 + 1.0, 1.3, wz, 0.6, 2.4, 4.0, 0x241a14);                          // wine cabinet body
    zoneGlow(-W / 2 + 1.3, 1.4, wz, 0.05, 1.8, 3.6, 0x8a1622, 0.35);              // backlit cellar glow
    for (let i = -3; i <= 3; i++) zone(-W / 2 + 1.25, 1.4 + (i & 1) * 0.45, wz + i * 0.55, 0.12, 0.34, 0.12, [0x3a1d22, 0x2a1f14, 0x401820][(i + 3) % 3]);  // bottles

    // ---- WALK-IN CLOSET nook beside the bedroom (open wardrobe runs + island) ----
    const cx2 = -W / 2 + 2.4, cz2 = -1.4;
    if (!b.clearFloorPoint || b.clearFloorPoint(cx2, cz2, 1.0)) {
      lb(cx2, 1.1, cz2, 1.0, 2.0, 3.0, 0x2e2620);                                  // wardrobe carcass
      for (let i = -2; i <= 2; i++) lb(cx2 + 0.2, 1.5, cz2 + i * 0.5, 0.12, 0.9, 0.18, [0x55606e, 0x6b4a2a, 0x49505b, VELVET, 0x3a4250][(i + 2) % 5]);  // hung garments
      glow(cx2, 2.0, cz2, 0.06, 0.08, 2.6, 0xfff0d0, 0.4);                         // closet rail light
    }
    zone(cx2 + 1.4, 0.45, cz2, 0.9, 0.5, 1.6, MARBLE);                            // dressing-island top

    // ---- MEDIA / BILLIARDS corner in the +x mid-band (pool table) ----
    const bx2 = W / 2 - 4.6, bz2 = -1.2;
    zone(bx2, 0.4, bz2, 2.0, 0.5, 3.4, 0x14463a);                                  // billiards felt bed
    zone(bx2, 0.66, bz2, 2.2, 0.08, 3.6, DARKWOOD);                               // table rail frame
    for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) zone(bx2 + sx * 0.9, 0.18, bz2 + sz * 1.5, 0.16, 0.36, 0.16, 0x14171c);  // table legs/pockets
    zoneGlow(bx2, FHl - 0.4, bz2, 1.4, 0.1, 0.5, 0xffe6c0, 0.5);                  // low pendant over the table

    // NO SUITE PARTITIONS. Two walls used to close the master bedroom off from
    // the great-room, and both were walk-through — a sealed master you could
    // stroll into sideways. A penthouse's whole read IS the open plate with the
    // city on four sides, so the walls are deleted rather than made solid; the
    // bedroom plinth and walk-in nook in the back -x corner say "suite" on
    // their own, which is what they were doing all along.
  }

  // ---- THE INDOOR POOL FLOOR (mansion natatorium) ---------------------------
  // WHY (owner's explicit ask): a mansion deserves a dedicated POOL FLOOR — you
  // ride/climb to a storey that is one big travertine-decked natatorium with a
  // recessed pool, a corner spa, loungers and a skylit cove. Modeled on
  // furnishPenthouse: all boxes cast:false / no userData → batch-folded (≈0 draw
  // calls), every pad clearFloorPoint-gated (1.2u) so the door aisle / -x stair
  // strip / elevator chase stay walkable. The water is DECORATIVE only — swim.js
  // treats just the OUTDOOR ocean as water, so an upper-floor emissive slab is
  // safe; the deck is a solid walkable floor like every other interior slab.
  function furnishPoolFloor(b, baseY) {
    return bounded(b, "pool", function () { return furnishPoolFloorBody(b, baseY); });
  }
  function furnishPoolFloorBody(b, baseY) {
    const W = b.w, D = b.d, FHl = b.FH || FH, Y = baseY || 0;
    const lb = (x, y, z, w, h, d, c, o) => b.lbox(x, Y + y, z, w, h, d, c, o || { cast: false });
    const glow = (x, y, z, w, h, d, c, ei) => b.lbox(x, Y + y, z, w, h, d, c, { emissive: c, ei: ei || 0.5, cast: false });
    const gate = (x, z) => !b.clearFloorPoint || b.clearFloorPoint(x, z, 1.2);
    const STONE = 0xcfd4dc, GOLD = 0xcaa64a;
    // tinted travertine DECK slab, clamped off the -x stair strip (furnishHome idiom)
    const dx0 = -W / 2 + 0.7;
    const dx1 = W / 2 - 0.7;
    lb((dx0 + dx1) / 2, 0.02, 0, Math.max(1, dx1 - dx0), 0.04, D - 1.4, STONE);
    const deckCx = (dx0 + dx1) / 2;
    // ---- recessed POOL BASIN: a water slab sized off the plate, centred on the deck
    const pw = Math.max(4, Math.min(5, W * 0.42));
    const pd = Math.max(8, Math.min(13, D - 6));
    const px = deckCx, pz = 0;
    if (gate(px, pz)) {
      lb(px, 0.04, pz, pw + 0.5, 0.08, pd + 0.5, 0x16242c);                          // darker basin lip under the water
      b.lbox(px, Y + 0.10, pz, pw, 0.18, pd, 0x3fb6e0, { emissive: 0x1a5d7a, ei: 0.32, cast: false });  // water
      // a coping FRAME (four ~1.2u deck rails ringing the basin) so the edge reads
      lb(px, 0.06, pz - pd / 2 - 0.6, pw + 2.4, 0.12, 1.2, 0xdfe3ea);                // -z coping
      lb(px, 0.06, pz + pd / 2 + 0.6, pw + 2.4, 0.12, 1.2, 0xdfe3ea);                // +z coping
      lb(px - pw / 2 - 0.6, 0.06, pz, 1.2, 0.12, pd + 2.4, 0xdfe3ea);               // -x coping
      lb(px + pw / 2 + 0.6, 0.06, pz, 1.2, 0.12, pd + 2.4, 0xdfe3ea);               // +x coping
      // a SKYLIGHT / cove emissive ceiling strip the length of the basin (sparing)
      glow(px, FHl - 0.22, pz, pw * 0.7, 0.06, pd * 0.8, 0xeaf6ff, 0.4);
    }
    // ---- LOUNGERS on the long deck edge facing the water (slab + raised backrest)
    const loungeX = px + pw / 2 + 1.6;
    for (let i = -1; i <= 1; i++) {
      const lz = i * (pd * 0.32);
      if (!gate(loungeX, lz)) continue;
      lb(loungeX, 0.28, lz, 0.8, 0.18, 1.9, 0xe6e8ee);                                // lounger pad
      lb(loungeX - 0.5, 0.7, lz - 0.7, 0.8, 0.7, 0.5, 0xe6e8ee);                      // raised backrest (head toward -z)
    }
    // ---- a corner SPA hot tub (raised stone box + brighter water inset) --------
    const spaX = dx1 - 1.6, spaZ = D / 2 - 2.4;
    if (gate(spaX, spaZ)) {
      lb(spaX, 0.35, spaZ, 2.4, 0.7, 2.4, 0x9aa0a8);                                 // raised stone tub
      glow(spaX, 0.72, spaZ, 1.7, 0.12, 1.7, 0x5fd0ea, 0.45);                        // brighter spa water
    }
    // ---- two slim glass-wall accent columns (the penthouse GOLD/STONE idiom) ----
    for (const s of [-1, 1]) { if (gate(deckCx + s * (W / 2 - 1.4), 0)) lb(deckCx + s * (W / 2 - 1.4), FHl / 2, 0, 0.3, FHl, 0.3, s < 0 ? GOLD : 0x9aa0a8); }
    // ---- a small wet-bar / towel counter on the back (+z, -x) wall -------------
    const barX = dx0 + 1.4, barZ = D / 2 - 1.4;
    if (gate(barX, barZ)) {
      lb(barX, 0.55, barZ, 2.0, 1.0, 0.8, 0x3a2b1e);                                 // bar / towel counter
      lb(barX, 1.08, barZ, 2.1, 0.08, 0.9, 0xe6e8ee);                               // counter top
      glow(barX, 1.6, barZ, 0.06, 0.8, 1.6, 0x9fe0ff, 0.3);                          // backlit shelf
    }
  }

  // ---- REAL detailed car as static scenery --------------------------------
  // Stand the SAME detailed per-car visual that traffic / parked / driven cars
  // use (CBZ.cityBuildPlayerCarVisual) on a building group: wheels rested on the
  // floor at local y `ly`, nose along `rotY`. Returns true if the real car went
  // in; false → the caller draws its blocky box fallback (headless / no visual
  // system). Pure scenery — no traffic, AI, or physics entanglement.
  function realCarVisual(b, lx, ly, lz, rotY, model, solid) {
    if (!CBZ.cityBuildPlayerCarVisual || !b || !b.group || !b.group.add) return false;
    let v = null;
    try {
      const style = (CBZ.cityInferCarStyle && CBZ.cityInferCarStyle(model)) || "muscle";
      v = CBZ.cityBuildPlayerCarVisual(style, model && model.color);
    } catch (e) { v = null; }
    if (!v) return false;
    v.rotation.y = rotY || 0;
    let minY = 0;
    try { if (THREE.Box3) minY = new THREE.Box3().setFromObject(v).min.y; } catch (e) { minY = 0; }
    if (!isFinite(minY)) minY = 0;
    v.position.set(lx, ly - minY, lz);                 // rest the wheels on the floor
    if (v.traverse) v.traverse(function (o) { if (o) o.castShadow = false; });   // scenery: no shadow cost
    b.group.add(v);
    if (solid && CBZ.colliders) {                      // keep the parked car solid (footprint = length along z)
      const bx = b.ox != null ? b.ox : 0, bz = b.oz != null ? b.oz : 0;
      CBZ.colliders.push({ minX: bx + lx - 1.05, maxX: bx + lx + 1.05, minZ: bz + lz - 2.35, maxZ: bz + lz + 2.35, y0: ly, y1: ly + 1.5 });
    }
    return true;
  }
  function pickCarModel(fallbackColor) {
    let model = null;
    try { if (CBZ.cityEcon && CBZ.cityEcon.pickCar) model = CBZ.cityEcon.pickCar(); } catch (e) { model = null; }
    if (!model || typeof model !== "object") model = { color: fallbackColor };
    return model;
  }

  // ---- THE SHOWROOM FLOOR: lay out a GRID of the car catalog ----------------
  // WHY: a dealership exists to SHOW its inventory. The old interior put ONE car
  // on the floor and left the rest of the (often multi-storey) building empty.
  // Now each floor is a real showroom: turntable display pads in a grid, each on
  // its own pad holding a DIFFERENT catalog car (real per-car visual) angled
  // 25° off the aisle (the dealer convention — you read length + face at once),
  // with a name/price placard sprite. The catalog index continues across floors
  // (`startIdx`) so a tall tower walks you past the whole line-up and repeats
  // only once everything's shown. Every pad is gated by clearFloorPoint so the
  // stairwell + door aisle stay walkable; cars are capped per floor for perf
  // (each real-car visual is detailed). Returns how many cars it placed so the
  // caller can advance the catalog index for the next floor.
  function showroomFloor(b, kind, door, baseY, startIdx) {
    return bounded(b, "showroom", function () { return showroomFloorBody(b, kind, door, baseY, startIdx); });
  }
  function showroomFloorBody(b, kind, door, baseY, startIdx) {
    const cars = (CBZ.cityEcon && Array.isArray(CBZ.cityEcon.CARS) && CBZ.cityEcon.CARS.length) ? CBZ.cityEcon.CARS : null;
    const W = b.w, D = b.d, Y = baseY || 0;
    const inx = door.nx, inz = door.nz;
    const yaw = Math.atan2(-inx, -inz);             // "face the glass front" base yaw
    // grid bounds: keep clear of the -x stairwell strip and the door aisle.
    const xLo = -W / 2 + 2.4;
    const xHi = W / 2 - 2.4;
    const zLo = -D / 2 + 2.6, zHi = D / 2 - 2.6;
    // each display bay ≈ a car footprint + a walk-around aisle (~4u square).
    const BAY = 4.2;
    let cols = Math.max(1, Math.floor((xHi - xLo) / BAY) + 1);
    let rows = Math.max(1, Math.floor((zHi - zLo) / BAY) + 1);
    // cars/floor cap rides the quality tier (build-once read): ≈6 lo → ≈30 hi (perf)
    cols = Math.min(cols, Math.round(CBZ.qScale ? CBZ.qScale(2, 5) : 3));
    rows = Math.min(rows, Math.round(CBZ.qScale ? CBZ.qScale(3, 6) : 4));
    const dxc = cols > 1 ? (xHi - xLo) / (cols - 1) : 0;
    const dzc = rows > 1 ? (zHi - zLo) / (rows - 1) : 0;
    let idx = startIdx | 0, placed = 0, MAXPF = Math.round(CBZ.qScale ? CBZ.qScale(6, 30) : 10);
    const PADC = kind === "chop" ? 0x201f22 : 0x26282e;
    for (let c = 0; c < cols && placed < MAXPF; c++) {
      for (let r = 0; r < rows && placed < MAXPF; r++) {
        const lx = xHi - c * dxc, lz = zLo + r * dzc;
        if (b.clearFloorPoint && !b.clearFloorPoint(lx, lz, 1.4)) continue;   // skip stair/door aisle
        // a low circular-reading turntable pad (square box — cheap) + a thin
        // chrome rim band so it reads as a display dais, not just floor.
        b.lbox(lx, Y + 0.06, lz, 3.4, 0.12, 3.4, PADC, { cast: false });
        b.lbox(lx, Y + 0.14, lz, 3.5, 0.04, 3.5, 0x6a7078, { cast: false });   // rim
        // alternate the angle row-to-row so the grid doesn't read as parked cars.
        const model = cars ? cars[idx % cars.length] : pickCarModel(kind === "chop" ? 0x8a1f24 : 0xe88a3c);
        const ang = yaw + ((r + c) & 1 ? 0.44 : -0.44);   // ~25° off-aisle showroom angle
        realCarVisual(b, lx, Y + 0.16, lz, ang, model || pickCarModel(0xe88a3c), false);
        // a name/price PLACARD on a little stanchion at the front of the pad.
        const nm = (model && model.name) || "VEHICLE";
        const val = (model && model.value) || 0;
        const txt = val ? (nm + "  $" + val.toLocaleString()) : nm;
        b.lbox(lx, Y + 0.55, lz - 1.5, 0.1, 0.9, 0.1, 0x44505c, { cast: false });   // stanchion post
        if (CBZ.makeLabelSprite) {
          try {
            const s = CBZ.makeLabelSprite(txt, { color: kind === "chop" ? "#ff9a6b" : "#ffd166" });
            if (s) {
              const wx = (b.ox != null ? b.ox : 0) + lx;
              const wz = (b.oz != null ? b.oz : 0) + lz - 1.5;
              s.position.set(wx, Y + 1.15, wz);
              if (b.group && b.group.add) b.group.add(s);
            }
          } catch (e) {}
        } else {
          // headless / no sprite system: a coloured plaque plate stands in.
          b.lbox(lx, Y + 1.0, lz - 1.5, 1.4, 0.5, 0.06, 0x14181e, { cast: false });
          b.lbox(lx, Y + 1.0, lz - 1.5, 1.2, 0.36, 0.02, kind === "chop" ? 0xff9a6b : 0xffd166, { cast: false });
        }
        idx++; placed++;
      }
    }
    return placed;
  }
  // city builder hook: dress each UPPER floor of a dealership as more showroom
  // (the catalog index carries across floors via the caller).
  CBZ.cityFurnishShowroomFloor = function (b, kind, door, baseY, startIdx) { return showroomFloor(b, kind, door, baseY, startIdx); };

  // a handful of PARKED CARS on the Spire's ground-floor deck so an empty garage
  // still reads as a garage. They sit in the four corner quadrants, clear of the
  // central drive lanes (the bays line up on each face's middle). Solid props.
  function deckCars(b, w, d) {
    const PAL = [0xc0392b, 0x2e86de, 0xf1c40f, 0x27ae60, 0x8e44ad, 0xecf0f1];
    const spots = [
      { x: -w * 0.27, z: -d * 0.27, c: PAL[0] },
      { x: w * 0.27, z: -d * 0.27, c: PAL[1] },
      { x: -w * 0.27, z: d * 0.27, c: PAL[3] },
      { x: w * 0.27, z: d * 0.27, c: PAL[4] },
    ];
    for (const s of spots) {
      // skip the corner that shares the stairwell strip (-x side) so cars never
      // block the climb to the elevator/roof.
      if (s.x < -w * 0.18) continue;
      // a REAL detailed car (same builder as traffic/parked/driven), rested on the
      // deck — not a blocky box. Falls back to the box stand-in only when headless.
      if (realCarVisual(b, s.x, 0.18, s.z, 0, pickCarModel(s.c), true)) continue;
      b.lbox(s.x, 0.55, s.z, 2.0, 0.7, 3.9, s.c, { solid: true });          // body (fallback)
      b.lbox(s.x, 1.15, s.z + 0.2, 1.7, 0.55, 2.0, 0x1b1f25, { cast: false }); // cabin/glass
      b.lbox(s.x, 0.3, s.z + 1.5, 2.05, 0.18, 0.5, 0x12161b, { cast: false }); // bumper hint
    }
  }

  // ===== THE MEGA-TOWER — the flagship skyscraper, the tallest in the game =====
  // ~30 storeys (DOUBLE the 15-storey island Twin Towers). It reuses makeBuilding's
  // proven enterable shell + switchback stairs scaled tall, so it's fully
  // climbable; makeBuilding's "modern" path already hangs a floor-to-ceiling glass
  // CURTAIN WALL on every storey (perf-safe: shared cached glass mat, capped pane
  // count per face). The ground floor is a wraparound HANGAR/garage deck (drive in
  // from any side). The top floor is a lavish PENTHOUSE (furnishPenthouse) with a
  // clean swing DOOR off the elevator landing. The rooftop HELIPAD is added by the
  // worldgen post-pass via makeHelipad (which also sets lot.building.helipad).
  //
  // Tags set: lot.building.home (penthouse tier), lot.building.hangar {x,z,w,d},
  // lot.building.helipad (by makeHelipad), lot.building.garage, lot.building.elevatorPad.
  // Returns { b, penthouseDoor } for the worldgen caller + CBZ.cityMegaTower().
  let _megaTower = null;   // { lot, penthouseDoor } cached for CBZ.cityMegaTower()
  function makeMegaTower(root, lot, w, d, side, door, doorPt, FLAGSHIP) {
    const STOREYS = 52;                                  // massive skyline anchor (~166m at FH=3.2)
    const color = 0x223040;                              // dark glass-tower mullion tone
    // reuse the proven shell: tall enough that makeBuilding's `modern` (storeys>=3)
    // curtain-wall path lights up on every floor; garageGround makes the ground a
    // drive-in deck. Stairs auto-engage (storeys>1, lot is wide), so it's climbable.
    // the flagship always lands on a core/commercial lot (see the lux-lot pick
    // above) — kit it as "core" explicitly (makeMegaTower has no city/districtKind
    // in scope) so it keeps the glassiest, cleanest split-grammar mix.
    // THE EXECUTIVE FLOOR (CBZ.CONFIG.EXEC_TOP_OFFICE): storey 50 — directly
    // under the penthouse — is the Executive origin's suite, dressed by
    // city/exec_office.js. The natatorium slides one storey down. The curtain
    // wall goes CLEAR glass (the same pooled see-through panes office towers
    // use — identical instanced draw calls) because the whole point of the
    // suite is SEEING the city 160m below; the reflective mirror kit is
    // near-opaque from inside. Flag off → the exact old layout + mirror skin.
    const EXECF = !!(CBZ.CONFIG && CBZ.CONFIG.EXEC_TOP_OFFICE);
    const execY = (STOREYS - 2) * FH;
    // THE SUITE HAS TO SEE OUT. The flagship wears a skyline facade grammar
    // (the city's position-hash pick; megabrace.js's "Braced Tube" on the
    // current map), and those grammars skin the tower in a CONTINUOUS dark
    // window field standing 0.04-0.2 m proud of the glass, with X-brace and
    // megacolumn blocks up to ~1.7 m thick whose inner faces reach a metre
    // INTO the rooms. From storey 50 that read as opaque brown panels in
    // every bay and as floating planks / boxes over the floor by the sills.
    // Two keep-clear volumes for the facade kit's carve: nothing a grammar
    // lays may stand inside the executive storey's footprint, and nothing
    // within 0.35 m of the wall may cross its window band. The spandrel
    // lines at the slab edges and the outer faces of any brace or column
    // stay, so from the street the structure still reads continuous.
    // EVERY STOREY, not only 50: the same brace and megacolumn blocks poke a
    // metre into the flats, the pool floor and the penthouse on every other
    // storey. So the whole footprint, garage deck to roof slab, is keep-clear:
    // anything a grammar lays inside the wall plane is carved away and only
    // the parts standing outside the building survive. The executive storey
    // additionally keeps its window band clear so the suite sees out.
    const bodyClear = { x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2, y0: 0.01, y1: STOREYS * FH - 0.01 };
    const execClear = EXECF ? [
      bodyClear,
      { x0: -w / 2 - 0.35, x1: w / 2 + 0.35, z0: -d / 2 - 0.35, z1: d / 2 + 0.35, y0: execY + 0.5, y1: execY + FH - 0.4 },
    ] : [bodyClear];
    const b = makeBuilding(root, lot.cx, lot.cz, w, d, STOREYS, color, side,
      EXECF ? { garageGround: true, district: "core", glassKind: "clear", keepClear: execClear }
            : { garageGround: true, district: "core", keepClear: execClear });
    const topY = (STOREYS - 1) * FH;                      // the top interior floor (penthouse)
    // PENTHOUSE — the apex home dressed across the whole top floor.
    furnishPenthouse(b, topY);
    deckCars(b, w, d);                                   // a few parked cars so the hangar deck reads as one
    // every floor between the garage deck and the penthouse is a dressed flat —
    // dozens of storeys of stairwell views into OTHER people's homes makes the
    // penthouse on top read as the apex (merged tris; no extra draw calls).
    // the storey just below the penthouse is the EXECUTIVE FLOOR (flag on) or
    // the mansion NATATORIUM (flag off; the pool then rides one lower);
    // every other floor is a dressed flat (merged tris; no extra draw calls).
    for (let k = 1; k < STOREYS - 1; k++) {
      if (EXECF && k === STOREYS - 2) continue;           // the executive suite — dressed below
      if (k === STOREYS - (EXECF ? 3 : 2)) furnishPoolFloor(b, k * FH);
      else furnishApartmentFloor(b, k * FH, k);
    }
    if (EXECF) {
      // exec_office.js (loads after this file; the city builds long after both)
      // owns the suite: one corner office, one meeting room, one reception,
      // acres of floor. It stamps b.execOffice = { floorY, spawn, … } which the
      // Executive origin + the express lift + the rent-unit skips all read.
      // Fallback: the generic office dresser, so the floor is never bare.
      if (CBZ.cityFurnishExecOffice) bounded(b, "exec-office", function () {
        return CBZ.cityFurnishExecOffice(b, execY, lot);
      });
      else { furnishOfficeFloor(b, execY, 0); b.execOffice = { floorY: execY }; }
    }

    // A clean PENTHOUSE DOOR off the elevator landing on the top floor. The shell's
    // ground door slot was consumed by the garage deck, so the penthouse gets its
    // own swing door at floor level `topY`, set into the stairwell-side wall the
    // elevator lands beside — a real shut/open threshold into the living space.
    // It is an interior door (no exterior wall to pierce), so we hand it a short
    // partition wall + the standard hinged leaf, framed and flush like every door.
    const phDoorLocal = { x: -(w / 2) + WT + 5.2, z: 0, nx: 1, nz: 0 };  // faces into the room (+x), 5.2 m off the -x wall
    // a short solid partition flanking the door so the leaf has a wall to seat into
    const partW = 0.4, gap = DOORW;
    for (const s of [-1, 1]) {
      const pz = phDoorLocal.z + s * (gap / 2 + 1.4 + partW / 2);
      b.lbox(phDoorLocal.x, topY + (DOORH - 0.15) / 2 + 0.02, pz, partW, DOORH - 0.15, 2.8, 0x2a323c, { solid: true });   // partition matches the person-scaled leaf height
    }
    // build the standard clean leaf+frame, then lift the whole rig (jambs, header,
    // pivot, collider) up to the penthouse floor via makeDoorPanelAtY.
    makeDoorPanelAtY(b.group, lot.cx, lot.cz, phDoorLocal, DOORW, topY, b);
    const penthouseDoor = { x: lot.cx + phDoorLocal.x + 1.6, z: lot.cz + phDoorLocal.z, nx: 1, nz: 0, y: topY };

    // tag the lot's building + the penthouse HOME record (the apex tier)
    lot.kind = "tower";
    lot.building = { ...b, name: FLAGSHIP.name, sign: color, side, door: doorPt };
    lot.building.home = {
      tier: FLAGSHIP.tier, id: FLAGSHIP.id, name: FLAGSHIP.name, price: FLAGSHIP.price, rent: 0,
      sqft: FLAGSHIP.sqft, beds: 2, garage: FLAGSHIP.garage, elevator: true,
      flagship: true, listed: true, owned: false,
      // OWNING THE MEGA-TOWER = an airbase: a rooftop HELIPAD + a podium HANGAR.
      // These flags are the WHY behind the price — Phase 3 reads g.cityOwnsHeli /
      // g.cityOwnsHangar + the helipad to spawn + fly the missile chopper / F-22.
      helipad: true, hangar: true,
      // the penthouse lives on the TOP interior floor; the elevator lands here.
      floorY: topY, loftY: topY, blurb: FLAGSHIP.blurb, door: penthouseDoor,
    };
    // the parking deck IS the ground floor; retrieved cars appear just outside a bay
    lot.building.garage = { x: door.x + door.nx * 3.0, z: door.z + door.nz * 3.0, spots: [] };
    lot.building.elevatorPad = { x: lot.cx - (w / 2 - 2.0), z: lot.cz, floorY: topY };
    // the HANGAR: the ground/podium drive-in bay (a flagged WORLD-space zone). A
    // ground-level bay the size of the deck footprint, centred on the lot — Phase 3
    // reads this to place + roll out the F-22 once the hangar is bought.
    lot.building.hangar = { x: lot.cx, z: lot.cz, w: w - 2 * WT, d: d - 2 * WT, y: 0 };

    _megaTower = { lot, penthouseDoor };
    return { b, penthouseDoor };
  }

  // build a hinged door whose whole rig sits at interior floor height `baseY`
  // (for the penthouse, which has no ground-floor wall to pierce). Reuses
  // makeDoorPanel, then lifts the pivot + frame/header meshes added during this
  // call up to baseY. Cheap: a handful of meshes, identical clean leaf/frame.
  function makeDoorPanelAtY(bgroup, ox, oz, localDoor, panelW, baseY, building) {
    const before = bgroup.children.length;
    const rec = makeDoorPanel(bgroup, ox, oz, localDoor, panelW);
    // lift every mesh/group makeDoorPanel just appended (jambs, header, pivot) up
    for (let i = before; i < bgroup.children.length; i++) bgroup.children[i].position.y += baseY;
    // lift the height-gated collider too so it blocks at the penthouse floor
    if (rec.col) { rec.col.y0 += baseY; rec.col.y1 += baseY; }
    rec.doorY = baseY;   // only auto-open when an actor is near this floor in Y
    rec.building = building || null;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    return rec;
  }

  // THE GANG'S STASH: a record, not a mesh. It sits at the back-centre of the
  // plate; the walk-in fit-out (city/fitout_gang.js) stands the count table
  // and the real duffel there and moves stash.x/z onto the table. (This used
  // to be a 1 m eager box glowing in the gang's colour: the "pink box".)
  function makeStash(b, lot) {
    lot.building.stash = {
      x: lot.cx, z: lot.cz + (b.d / 2 - 2.6), looted: false,
      // wealth set when the gang takes the building (city/gangs.js may bump it)
      cash: 300 + ((b.storeys || 1) * 150), drugs: 1 + ((b.storeys || 1)), weapon: null,
      mesh: null,
    };
  }

  // ---- OWNERSHIP -----------------------------------------------------------
  // EVERY lot ends up with lot.building.owner = {type, id, name, buyable}. One
  // canonical field name (`owner`) consumed by zillow/gangs. Names come from a
  // deterministic pool so the same lot reads the same proprietor each run.
  const PROPRIETORS = ["Marcus Webb", "Lena Cho", "Tony Russo", "Dev Patel", "Rosa Vega",
    "Grant Okafor", "Mei Lin", "Sal Bianchi", "Nadia Haq", "Cole Brennan", "Yuki Tanaka",
    "Priya Rao", "Omar Said", "Greta Voss", "Hank Doyle", "Ivy Nguyen"];
  const LANDLORDS = ["Crestview Holdings", "B. Falcone", "Sunset Property Co", "M. Delgado",
    "Harborline LLC", "K. Sorensen", "Pinnacle Residential", "T. Okonkwo", "Ridgeway Estates",
    "V. Castellano", "Northgate Rentals", "A. Lindqvist"];
  function nameFor(pool, lot, idx) {
    const seed = ((lot.i | 0) * 31 + (lot.j | 0) * 17 + (idx | 0) * 7) >>> 0;
    return pool[seed % pool.length];
  }
  // stamp a single canonical owner. For homes the `type` is a live getter off
  // home.owned, so the EXISTING realestate home.owned reset flips it back to
  // 'landlord' on a new run — no parallel un-reset state in this file.
  // STARTING-CASH SEED for the wallet ledger (LE6). WHY: a shop must be able to
  // pay a clerk's wage on day one, and a landlord needs a float to be owed rent
  // against — without a believable opening balance the ledger reads $0 and no
  // money ever moves. We scale the seed by what the business plausibly holds:
  // a bank/casino/jeweller sits on a vault, a food cart on pocket change; a
  // landlord's float tracks the rent they collect. This is a PLAIN data property
  // dropped alongside the owner stub — wallet.js (LE1) lazily creates _acct if
  // absent and PREFERS lot._company.cash once companies.js routes a real company
  // here, so this is only the pre-company fallback (and the wage/rent float).
  const ACCT_SEED = { bank: 9000, casino: 8000, jewelry: 6500, security: 5000, realtor: 4200, carlot: 4000, chop: 3000, gym: 2200, clothing: 2000, guns: 2400, pawn: 2600, bar: 2800, gas: 1600, drugs: 1800, hospital: 3500, cityhall: 5000, arena: 4000, raceway: 3600, transit: 2000, food: 900 };
  // the new civic trades bring their own opening float (city/buildings_civic.js
  // owns the table; merged here so stampOwner needs no special case).
  if (CBZ.CIVIC_ACCT_SEED) for (const ck in CBZ.CIVIC_ACCT_SEED)
    if (ACCT_SEED[ck] == null) ACCT_SEED[ck] = CBZ.CIVIC_ACCT_SEED[ck];
  function stampOwner(lot, idx) {
    const b = lot.building; if (!b || b.owner) return;
    const kind = lot.kind;
    if (kind === "abandoned") {
      b.owner = { type: "gang", id: null, name: "(gang turf)", buyable: false };  // gangs.js sets owner.id
    } else if (b.shop) {
      const sk = (b.shop && b.shop.kind) || "store";
      const seed = (ACCT_SEED[sk] != null ? ACCT_SEED[sk] : 1500) + (((b.storeys || 1) - 1) * 250);
      b.owner = { type: "business", id: null, name: nameFor(PROPRIETORS, lot, idx), buyable: true, _acct: { cash: seed } };
    } else if (b.home) {
      const home = b.home, landlord = nameFor(LANDLORDS, lot, idx);
      // a landlord float scaled by what this place rents for (so rent can be
      // owed/paid out of a believable balance). Cheap micro-units → small float.
      const rent = (home.rent || 0);
      const rentSeed = Math.round(400 + rent * 6 + (b.storeys || 1) * 80);
      b.owner = {
        id: null, buyable: home.listed !== false,   // only the curated ladder is for sale
        _acct: { cash: rentSeed },                  // plain data float ALONGSIDE the getters
        get type() { return home.owned ? "player" : "landlord"; },
        get name() { return home.owned ? "You" : landlord; },
      };
    } else {
      // any other real building (towers without a home record, etc.)
      b.owner = { type: "landlord", id: null, name: nameFor(LANDLORDS, lot, idx), buyable: true, _acct: { cash: 600 + (b.storeys || 1) * 90 } };
    }
  }

  // a streamed job's panes / room deco / veneer become pools at the END of
  // the job (core/citystream.js), so the pools are that job's own objects
  CBZ.cityFlushPools = function () {
    if (pendingGlass.length) buildGlassPools();
    if (pendingDeco.length) buildRoomDecoPools();
    if (pendingMasonry.length) buildMasonryPools();
  };
  // the module lists a streamed job writes to (freed with it)
  if (CBZ.streamBus) { CBZ.streamBus(cityGlass, "cityGlass"); CBZ.streamBus(roomDeco, "roomDeco"); CBZ.streamBus(cityDoors, "cityDoors"); }
  CBZ.cityBuildings = function (city) {
    const root = city.root, rng = city.rng;
    const C = CBZ.CITY;
    const placed = [], abandonedLots = [], homeLots = [];
    // PROPS_PURPOSE: fresh world → drop every seat/bed/poster anchor from the
    // old one; the furnishing below re-registers them in placement lockstep.
    if (CBZ.propPurposeReset) CBZ.propPurposeReset();

    // ---- DISTRICT HEIGHT FIELD --------------------------------------------
    // WHY: the skyline should TELL you where the money is — the core towers
    // over you, commercial strips sit mid-rise, the projects and industry
    // squat low. Storey counts read lot.district (config.js CITY.districts).
    // Now that window glass is instanced, the extra storeys cost no pane draw
    // calls — only walls (which the batcher/collider model already absorbs).
    function districtKind(lot) {
      const D = (city.districts && city.districts[lot.district]) || null;
      return D ? D.kind : null;
    }
    // CITY HEIGHT GRADIENT (CH4). WHY: the skyline should fall AWAY from the
    // money — Midtown's core towers over you and every band steps DOWN toward the
    // rim, so distance-from-centre reads as land value at a glance (instead of 3
    // flat district bands with a hard seam). We bias the EXISTING per-kind range
    // by a core bonus that fades to ~0 at the city edge. The bonus is computed
    // PURELY from geometry (no rng() draw) so the deterministic world build / MP
    // stay byte-identical, and the per-kind base stays a FLOOR.
    let _maxR = 0;   // cached half-diagonal of the built area (farthest lot from centre)
    for (const _l of city.lots) { const dd = Math.hypot((_l.cx || 0) - city.center.x, (_l.cz || 0) - city.center.z); if (dd > _maxR) _maxR = dd; }
    if (_maxR < 1) _maxR = 1;   // headless / single-lot guard (no divide-by-zero)
    // normalised core distance: 0 at the dead centre → 1 at the farthest built
    // lot. The ONE distance calc the whole gradient family (height AND, below,
    // what-gets-built) shares — coreBonus reuses it for storeys, and the
    // parkProbFor/abandonedProbFor/extraShopMulFor trio (CH-PLAN, below) reuse
    // the exact same number for shop/park/abandoned odds, so "downtown" means
    // the same thing everywhere instead of two competing ideas of centre.
    function coreT(lot) {
      const dd = Math.hypot((lot.cx || 0) - city.center.x, (lot.cz || 0) - city.center.z);
      return Math.max(0, Math.min(1, dd / _maxR));
    }
    /* ---- STREET IDENTITY: the deterministic district style table ---------
       OWNER: "many facades suck ... they take up street in gang life, and the
       facades feel random. Make it very not random."

       What was here: every lot rolled its own height (rng 4-8 + a land-value
       bonus), its own wall colour (TOWER_PALETTE / the shop's sign colour),
       brick-or-glass off a position hash, and then facade_kit.js dealt it one
       of 31 grammars off another position hash. Four independent dice per
       building, so no two neighbours agreed on anything.

       Now each district (config.js CITY.districts, 2x2 blocks each) is ONE
       street identity: one grammar family, one material pair, one height
       pair, one front setback. Neighbours vary DELIBERATELY: the checkerboard
       parity (i + j) picks the A or B entry of each pair, so a street reads
       A-B-A-B with a shared cornice rhythm instead of noise.

         grammar  facade kit style for homes/towers/hideouts ([A, B] or one)
         shop     style for storefront trades (ground storey kept clear for
                  the shop's glass, door, fascia and awning)
         storeys  [A, B] for towers/homes; shopSt = minimum for a shop
         setback  metres from the wall to the footway's back edge. Everything
                  a building dresses itself with stays inside it (makeBuilding
                  opts.reach); residential gets a front yard for its porches.
         walls    [A, B] wall tones (the grammar derives its trim from these)

       rng() draws are kept where the old code drew them (the value is simply
       no longer used), so the rest of the deterministic build is unchanged. */
    const STREET_STYLE = {
      Midtown:    { grammar: "artdeco",                 shop: "artdeco", storeys: [8, 10], shopSt: 4, setback: 1.5, walls: [0xcfc2a4, 0xbdb096] },
      Eastgate:   { grammar: "brick",                   shop: "brick",   storeys: [5, 4],  shopSt: 3, setback: 1.5, walls: [0x8a3b26, 0x7d3624] },
      Westend:    { grammar: "stone",                   shop: "stone",   storeys: [4, 5],  shopSt: 3, setback: 1.5, walls: [0xcab99a, 0xb9a887] },
      Harborside: { grammar: "brick",                   shop: "brick",   storeys: [4, 3],  shopSt: 3, setback: 1.5, walls: [0x6e4634, 0x62402f] },
      Northpoint: { grammar: "brickhouse",              shop: "brick",   storeys: [3, 3],  shopSt: 2, setback: 3.5, walls: [0x98482e, 0x8c432c] },
      Crownhill:  { grammar: ["queenanne", "victorian"], shop: "stone",  storeys: [3, 3],  shopSt: 2, setback: 3.5, walls: [0x6f8ea4, 0xb09a78] },
      Southside:  { grammar: "brutalist",               shop: "brick",   storeys: [5, 6],  shopSt: 2, setback: 3.0, walls: [0x8c8983, 0x807d77] },
      Ironworks:  { grammar: "brick",                   shop: "brick",   storeys: [3, 3],  shopSt: 2, setback: 2.0, walls: [0x5c3a2c, 0x543428] },
      Dockyard:   { grammar: "brutalist",               shop: "brick",   storeys: [3, 4],  shopSt: 2, setback: 2.0, walls: [0x77746c, 0x6b6861] },
    };
    const KIND_STYLE = { core: "Midtown", commercial: "Eastgate", residential: "Northpoint", projects: "Southside", industrial: "Ironworks" };
    function streetStyle(lot) {
      const D = (city.districts && city.districts[lot.district]) || null;
      return (D && STREET_STYLE[D.name]) || STREET_STYLE[KIND_STYLE[D && D.kind] || "Eastgate"];
    }
    function lotParity(lot) { return ((lot.i | 0) + (lot.j | 0)) & 1; }
    function pick2(v, lot) { return Array.isArray(v) ? v[lotParity(lot) % v.length] : v; }
    function streetDress(lot, storeys, asShop) {
      const id = asShop ? streetStyle(lot).shop : pick2(streetStyle(lot).grammar, lot);
      const def = CBZ.facadeDef ? CBZ.facadeDef(id) : null;
      if (!def || storeys < (def.minStoreys || 0) || storeys > (def.maxStoreys || Infinity)) return null;
      return { style: id };
    }
    function streetWall(lot) { return pick2(streetStyle(lot).walls, lot); }
    function districtStoreys(lot) {
      rng();   // the old per-lot height roll, drawn and discarded (RNG order preserved)
      return pick2(streetStyle(lot).storeys, lot);
    }

    // ---- LOT-KIND GRADIENT (CH-PLAN). WHY: height already falls away from the
    // centre (coreBonus); WHAT gets built on a lot didn't — every lot rolled the
    // same flat park/abandoned/shop odds no matter how close to Midtown it sat,
    // so downtown and the rim were built from the same dice. towngen.js already
    // solved this for the biome towns (buildProbFor: density*0.72^ring, a
    // ring-based falloff); this ports the SAME shape onto the mainland's
    // continuous coreT() distance (no concentric "ring" here, just 0..1) so the
    // gradient is centred on the SAME geometry coreBonus already uses for
    // height — one downtown, read the same way by every system. Multipliers are
    // centred so a lot at t≈0.5 (the city's average lot) lands close to the
    // ORIGINAL flat constants — this reshapes the city, it doesn't reinflate or
    // deflate it (gangs.js already backstops a thin abandoned count regardless).
    // NO new rng() draw: each function only RESCALES the threshold the existing
    // single `r = rng()` per lot is compared against, so the rng() draw order —
    // and therefore the whole deterministic build — is untouched.
    function lerp01(t, lo, hi) { return lo + (hi - lo) * t; }
    // park odds: rarer in the dense core (every plaza-eligible parcel downtown
    // is too valuable to leave empty), commoner toward the rim (breathing room
    // where land is cheap) — t=0 → 0.6x base, t=1 → 1.4x base.
    function parkProbFor(lot) { return (C.parkFrac || 0.08) * lerp01(coreT(lot), 0.6, 1.4); }
    // abandoned/gang odds: a little more common toward the rim (the core is too
    // policed/valuable to sit derelict) — a gentler swing than park's, so the
    // core still gets SOME gang turf (gangs.js needs turf everywhere, not just
    // the edge) — t=0 → 0.8x base, t=1 → 1.2x base.
    function abandonedProbFor(lot) { return (C.abandonedFrac || 0.30) * lerp01(coreT(lot), 0.8, 1.2); }
    // extra-shop odds (the ~40% roll that decides a non-essential lot becomes a
    // SECOND business instead of a generic apartment): denser retail frontage
    // near downtown, falling off toward the rim, where a lot is more likely to
    // just be a home — t=0 → 1.3x, t=1 → 0.7x (essentials still place
    // unconditionally regardless of t — this only weights the EXTRA shops).
    function extraShopMulFor(lot) { return lerp01(coreT(lot), 1.3, 0.7); }
    let chopShop = null, realtor = null, luxury = null, luxBuilding = null, clubLot = null, gunLot = null, jewelryLot = null;

    // shuffle the shop list, then float the gameplay-critical trades to the
    // front so they ALWAYS get placed; the rest fill in only sometimes, leaving
    // plenty of lots free to become residences (the property ladder).
    const ESSENTIAL = new Set(["guns", "drugs", "bank", "hospital", "food", "pawn", "realtor", "chop", "carlot", "jewelry", "clothing", "gym", "casino", "raceway", "arena", "transit", "cityhall", "eyewear"]);
    let shopQueue = SHOPS.slice();
    for (let i = shopQueue.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = shopQueue[i]; shopQueue[i] = shopQueue[j]; shopQueue[j] = t; }
    shopQueue = shopQueue.filter((s) => ESSENTIAL.has(s.kind)).concat(shopQueue.filter((s) => !ESSENTIAL.has(s.kind)));
    // CITY HALL is pulled OUT of the queue (no extra rng() draw — same shuffle,
    // same draw count/order as before, just a post-shuffle splice) because the
    // civic lot below FORCES it onto the most-central lot instead of letting it
    // land wherever the shuffle happened to drop it.
    const CITYHALL_SHOP = (function () {
      const idx = shopQueue.findIndex((s) => s.kind === "cityhall");
      return idx >= 0 ? shopQueue.splice(idx, 1)[0] : null;
    })();
    const nEssential = shopQueue.filter((s) => ESSENTIAL.has(s.kind)).length;
    let shopIdx = 0;
    // ---- DISTRICT AFFINITY (the method behind which trade lands where) ----
    // Districts had personality in name only: the shop queue was dealt to lots
    // in plain iteration order, so a jewelry flagship could land in the
    // projects by shuffle luck. Every deal below now picks the REMAINING trade
    // with the best affinity for the lot's district — banks/jewelry/casinos
    // gravitate downtown, chop shops and gun stores to industrial/projects,
    // groceries and gyms to residential. Pure argmax over the queue (no new
    // rng draws), so the deterministic stream is untouched.
    const AFFINITY = {
      core:        { bank: 4, jewelry: 4, casino: 4, cityhall: 4, transit: 3, clothing: 3, arena: 3, eyewear: 3, realtor: 2, food: 1, gym: 1, hospital: 2, drugs: 0.2, chop: 0.2, guns: 0.4, pawn: 0.4 },
      commercial:  { food: 3, clothing: 3, gym: 3, realtor: 3, carlot: 3, hospital: 3, eyewear: 2.5, bank: 2, transit: 2, casino: 1, pawn: 1, jewelry: 1, arena: 2, drugs: 0.4 },
      industrial:  { chop: 4, guns: 3, carlot: 3, gas: 3, pawn: 2, transit: 2, food: 1, drugs: 1.5, bank: 0.3, jewelry: 0.2, casino: 0.3, clothing: 0.4, eyewear: 0.3 },
      projects:    { drugs: 4, pawn: 3, guns: 3, chop: 2, food: 2, gas: 1.5, gym: 1, bank: 0.3, jewelry: 0.15, casino: 0.5, clothing: 0.5, realtor: 0.4, eyewear: 0.4 },
      residential: { food: 3, gym: 2, realtor: 2, hospital: 2, clothing: 1.5, transit: 1.5, bank: 1, eyewear: 1, drugs: 0.5, chop: 0.3, guns: 0.5, casino: 0.4 },
    };
    function shopAffinity(kind, dk) {
      const row = AFFINITY[dk];
      const v = row && row[kind];
      return v != null ? v : 1;
    }
    // swap the best-affinity entry in queue[from..to) up to `from`
    function dealBestFor(lot, from, to) {
      const dk = districtKind(lot);
      let best = from, bs = -1;
      for (let q = from; q < to; q++) {
        const wq = shopAffinity(shopQueue[q].kind, dk);
        if (wq > bs) { bs = wq; best = q; }
      }
      if (best !== from) { const t = shopQueue[from]; shopQueue[from] = shopQueue[best]; shopQueue[best] = t; }
      return shopQueue[from];
    }

    // pick the flagship LUXURY tower lot up front. CH5 — the flagship Spire/mega-
    // tower should CROWN Midtown, not sulk in a corner: a 30-storey apex landing
    // on the rim contradicts the whole land-value gradient (CH4). So choose the
    // lot CLOSEST to the city centre that sits in a 'core'/'commercial' district
    // (the prime real estate), falling back to the global nearest lot if no such
    // district is tagged (headless / minimal city). All downstream wiring keys
    // off this lot by reference, so moving it is transparent to makeMegaTower /
    // penthouse / helipad / hangar.
    let lux = null, bestD = 1e18, luxAny = null, bestAny = 1e18;
    for (const lot of city.lots) {
      const dd = Math.hypot(lot.cx - city.center.x, lot.cz - city.center.z);
      if (dd < bestAny) { bestAny = dd; luxAny = lot; }          // global-nearest fallback
      const dk = districtKind(lot);
      if ((dk === "core" || dk === "commercial") && dd < bestD) { bestD = dd; lux = lot; }
    }
    if (!lux) lux = luxAny;                                       // no core/commercial tag → nearest lot

    // ---- THE CIVIC LOT (CH-PLAN). WHY: towngen.js's biome towns RESERVE the
    // most-central block as a square/landmark up front (never leaving it to a
    // random park/abandoned/shop roll); the mainland never did — City Hall
    // (already in SHOPS/ESSENTIAL) just landed wherever the shuffled shopQueue
    // happened to drop it, sometimes blocks from the centre. Mirror towngen's
    // guarantee: find the lot CLOSEST to the centre (the same coreT()==0 point
    // height already crowns), excluding the lux lot the mega-tower already
    // owns. On this mainland's even 6x6 grid there are FOUR lots tied for
    // closest (no single dead-centre cell) and `lux` claims one of them above —
    // this scan naturally picks the next-closest tie (first found, since `<` is
    // strict), so the civic anchor sits immediately beside the flagship tower,
    // the two reading as one administered civic core instead of two unrelated
    // picks. Falls back to nearest-overall if every central lot is somehow lux
    // (tiny/headless grids).
    let civicLot = null, bestC = 1e18;
    for (const lot of city.lots) {
      if (lot === lux) continue;
      const dd = Math.hypot(lot.cx - city.center.x, lot.cz - city.center.z);
      if (dd < bestC) { bestC = dd; civicLot = lot; }
    }

    // ---- THE CIVIC QUARTER (BLD_CIVIC_LOTS_V1) ----------------------------
    // OWNER: "make new building types like gov buildings". City Hall alone is
    // not a government; a courthouse, a federal building, a library, a post
    // office, a records office and a fire house are. buildings_civic.js owns
    // the trade DATA; this owns WHERE they land.
    //
    // SELECTION IS PURELY GEOMETRIC — the N lots nearest the city centre, after
    // the flagship tower and City Hall have claimed theirs. That is deliberate
    // and it does three things at once:
    //   • it satisfies "civic clusters downtown, not in the suburbs" by
    //     construction, more strongly than any affinity weight could;
    //   • it adds ZERO rng() draws (the same discipline coreBonus/districtStoreys
    //     already use), so no shared stream is reordered by this feature;
    //   • it is bounded — ~10% of mainland lots, capped at the number of civic
    //     trades — so `A.shopLots` grows by a handful, not a flood (the
    //     math-gate GOLDEN band is 12%; on the stock 6×6 mainland this is 4
    //     extra shops against a world total of ~178, i.e. +2.2%).
    // WHICH trade lands on WHICH of those lots is a pure argmax over
    // CBZ.CIVIC_AFFINITY for the lot's district — again, no rng.
    const civicAssign = new Map();
    if (CBZ.CIVIC_SHOPS && CBZ.CIVIC_SHOPS.length && CBZ.CIVIC_AFFINITY
        && (!CBZ.CONFIG || CBZ.CONFIG.BLD_CIVIC_LOTS_V1 !== false)) {
      const nCivic = Math.max(1, Math.min(CBZ.CIVIC_SHOPS.length, Math.round(city.lots.length * 0.10)));
      const ranked = city.lots.filter((l) => l !== lux && l !== civicLot)
        .map((l, i) => ({ l, i, dd: Math.hypot(l.cx - city.center.x, l.cz - city.center.z) }))
        // explicit index tiebreak: never rely on Array.sort stability for a
        // value the deterministic world build depends on.
        .sort((a, b) => (a.dd - b.dd) || (a.i - b.i));
      const pool = CBZ.CIVIC_SHOPS.slice();
      for (let t = 0; t < nCivic && t < ranked.length && pool.length; t++) {
        const lot = ranked[t].l;
        const dk = districtKind(lot);
        const row = CBZ.CIVIC_AFFINITY[dk] || null;
        let best = 0, bs = -1;
        for (let q = 0; q < pool.length; q++) {
          const wq = (row && row[pool[q].kind] != null) ? row[pool[q].kind] : 1;
          // ties broken by the trade's own rank (courthouse before fire house)
          if (wq > bs || (wq === bs && pool[q].rank < pool[best].rank)) { bs = wq; best = q; }
        }
        civicAssign.set(lot, pool.splice(best, 1)[0]);
      }
    }

    // The property ladder is SHORT and every rung is a real, visitable building:
    // one lot per LISTED level (studio → aerie), plus the flagship Spire on the
    // lux lot. Every OTHER residence is a generic, occupied apartment (ranked for
    // the empire board, but NOT on the market) so Zillow stays a handful of
    // clearly-different LEVELS rather than a hundred near-identical listings.
    const HOME_TIERS = (C.homes || []).filter((h) => h.tier > 0);
    // THE APEX home goes on the lux lot as the MEGA-TOWER's penthouse. It is the
    // highest-tier flagship in the ladder: once RE adds the tier-6 "penthouse"
    // record (id "penthouse", flagship:true) it wins here; before that lands, the
    // existing tier-5 Spire flagship is the fallback so the city always builds.
    const FLAGSHIPS = HOME_TIERS.filter((h) => h.flagship);
    const FLAGSHIP =
      HOME_TIERS.find((h) => h.id === "penthouse") ||
      (FLAGSHIPS.length ? FLAGSHIPS.reduce((a, b) => (b.tier > a.tier ? b : a)) : HOME_TIERS[HOME_TIERS.length - 1]);
    // listed market rungs = everything that ISN'T the apex flagship (studio..aerie,
    // and the old Spire too if the penthouse has superseded it as the apex).
    const LISTED_TIERS = HOME_TIERS.filter((h) => h !== FLAGSHIP && !h.flagship);
    const GENERIC = LISTED_TIERS[0] || FLAGSHIP;                   // furniture template for filler apts

    // RESERVE one lot per listed level UP FRONT (like the lux lot) so the whole
    // ladder ALWAYS exists even when shops/derelicts would otherwise eat every
    // free lot. Spread the picks across the lot list so the levels aren't all
    // clustered in one corner. A reserved lot skips the park/abandoned/shop rolls
    // and is forced to become its assigned listed residence.
    const reserved = new Map();
    {
      const pool = city.lots.filter((l) => l !== lux && l !== civicLot && !civicAssign.has(l));
      const n = LISTED_TIERS.length;
      for (let t = 0; t < n && pool.length; t++) {
        const idx = Math.min(pool.length - 1, Math.floor((t + 0.5) / n * pool.length));
        if (!reserved.has(pool[idx])) reserved.set(pool[idx], LISTED_TIERS[t]);
      }
    }

    // Reserve enough REAL parcels for every gameplay-critical trade before the
    // park/hideout rolls run. The old queue put essentials first but still let
    // those parcels disappear earlier in this loop; on abandonment-heavy seeds
    // the queue simply ran out of buildings before reaching the casino, bank,
    // arena, etc. Spread the slots across the deterministic lot order so the
    // businesses do not collapse into one corner. No random draw is added.
    const essentialSlots = new Set();
    {
      const pool = city.lots.filter((l) => l !== lux && l !== civicLot && !reserved.has(l) && !civicAssign.has(l));
      const n = Math.min(nEssential, pool.length);
      for (let t = 0; t < n; t++) {
        const idx = Math.min(pool.length - 1, Math.floor((t + 0.5) / n * pool.length));
        essentialSlots.add(pool[idx]);
      }
    }

    for (const lot of city.lots) {
      const isLux = lot === lux;
      const isCivic = lot === civicLot;              // the reserved City Hall anchor
      const civicShop = civicAssign.get(lot) || null; // a reserved GOV building anchor
      const forcedTier = reserved.get(lot) || null;   // a reserved listed-level lot
      const essentialSlot = essentialSlots.has(lot);  // cannot be consumed by park/hideout rolls
      const r = rng();
      // CH-PLAN: the SAME r draw, but compared against a per-lot threshold that
      // falls/rises with distance from the centre (parkProbFor/abandonedProbFor)
      // instead of the old flat C.parkFrac/C.abandonedFrac constant. No extra
      // rng() call — only the threshold value moves — so determinism/draw-order
      // is byte-identical to before.
      const parkP = parkProbFor(lot), abandonedP = abandonedProbFor(lot);
      // parks (open plazas) for breathing room — fewer than before. A park is a
      // "dumb unowned corner": no collider/door requirement. We still give it a
      // benign lot.building stub so the city has NO unowned lots — owned by the
      // city. Downstream that touches lot.building.door already null-guards it.
      if (!isLux && !isCivic && !civicShop && !forcedTier && !essentialSlot && r < parkP) {
        lot.kind = "park"; makePark(root, lot, rng);
        // A park needs NO collider/door. But a few downstream lot.building.door
        // consumers (careers' courier drop, lotDoor) read .door unguarded once a
        // building exists — so we hand it a benign door at the park's own
        // centre (the nearest open sidewalk-ish point), never a real entrance.
        // nx/nz are omitted on purpose; readers that need a normal already guard
        // door.nx != null (death/camera) and fall back to a centroid facing.
        lot.building = {
          park: true, name: "City Park",
          door: { x: lot.cx, z: lot.cz },
          owner: { type: "city", id: null, name: "City of Freeland", buyable: false },
        };
        placed.push(lot); continue;
      }

      // THE SETBACK is the street's, not the lot's accident: every building
      // on a district's blocks stands the same distance behind the footway.
      // A civic anchor's portico + steps are 2.5 m deep, so it stands back
      // far enough to keep them on its own parcel. The flagship tower keeps
      // its build-to-line 1 m (its podium deck is drive-in on every side).
      const SS = streetStyle(lot);
      const setback = isLux ? 1 : (isCivic || civicShop) ? Math.max(SS.setback, 3.2) : SS.setback;
      const w = lot.w - 2 * setback, d = lot.d - 2 * setback;
      const toCx = city.center.x - lot.cx, toCz = city.center.z - lot.cz;
      const side = Math.abs(toCx) > Math.abs(toCz) ? (toCx > 0 ? 3 : 2) : (toCz > 0 ? 1 : 0);
      const door = doorInfo(lot.cx, lot.cz, w, d, side);
      const doorPt = { x: door.x + door.nx * 1.6, z: door.z + door.nz * 1.6, nx: door.nx, nz: door.nz };

      // ---- GANG-RUN HIDEOUT ----
      // PROCGEN #3 — land value nudges the odds on top of the CH-PLAN
      // distance-based threshold: a low-value lot (far from the core, no
      // waterfront, an unlucky noise dip) is somewhat MORE likely to end up
      // abandoned; a high-value lot somewhat LESS likely. Reuses the SAME r
      // draw (no new rng() call — draw-count/order untouched); only the
      // threshold shifts with the lot's geometry.
      const lv = city.landValue ? city.landValue(lot.cx || 0, lot.cz || 0) : 0.5;
      const abandonedMul = Math.max(0.5, Math.min(1.5, 1 + (0.5 - lv) * 0.8));
      if (!isLux && !isCivic && !civicShop && !forcedTier && !essentialSlot && r < parkP + Math.min(0.6, abandonedP * abandonedMul)) {
        // Keep the gang turf/stash gameplay, but remove the old boarded derelict
        // visual shell. Those near-windowless boxes were clipping into the read of
        // shops like Cluckin' Diner / The Trap House and made good glass blocks feel
        // cluttered. A hideout is now just another windowed city building that a
        // crew happens to control.
        // A crew's building is a building OF ITS STREET — the same grammar,
        // walls and setback as its neighbours (a hideout that looks different
        // is a hideout the cops can spot). Capped at 4 storeys.
        const storeys = Math.max(1, Math.min(4, districtStoreys(lot)));
        rng(); rng();   // the old palette + facade-variant draws (RNG order preserved)
        const color = streetWall(lot);
        const b = makeBuilding(root, lot.cx, lot.cz, w, d, storeys, color, side,
          { facade: "office", district: districtKind(lot), dress: streetDress(lot, storeys, false) || false, reach: setback });
        lot.kind = "abandoned";
        lot.building = { ...b, name: "Gang Hideout", sign: color, side, door: doorPt, abandoned: true, gang: null };
        makeStash(b, lot);
        // a crew's building, every floor of it: the fit-out (city/fitout_gang.js)
        // stands the count room, the lounge, the cook kitchen and the mattresses.
        if (CBZ.fitoutDeclareBuilding) CBZ.fitoutDeclareBuilding(b, "hideout", { door: b.localDoor });
        abandonedLots.push(lot);
        placed.push(lot);
        continue;
      }

      // ---- REAL: a business or a residence (and never a shop on the luxury lot) ----
      // Essentials are placed unconditionally; extras only ~40% of the time
      // (CH-PLAN: scaled by extraShopMulFor so that 40% itself falls away from
      // the centre — denser shop frontage downtown, more plain homes toward the
      // rim), so the remaining real lots become furnished, sellable HOMES.
      let shop = null;
      if (isCivic && CITYHALL_SHOP) {
        // the reserved civic anchor: City Hall, unconditionally, no rng() draw
        // (CITYHALL_SHOP was already spliced out of shopQueue up front so it's
        // never double-placed by the random draw below).
        shop = CITYHALL_SHOP;
      } else if (civicShop) {
        // a reserved GOVERNMENT anchor (courthouse / federal / library / post
        // office / records / fire house). Unconditional and rng-free, exactly
        // like the City Hall anchor above — these trades never enter shopQueue,
        // so the shuffle draws the same number of values as it always did.
        shop = civicShop;
      } else if (!isLux && !isCivic && !forcedTier) {
        if (essentialSlot && shopIdx < nEssential) { shop = dealBestFor(lot, shopIdx, nEssential); shopIdx++; }
        else if (!essentialSlot && shopIdx >= nEssential && shopIdx < shopQueue.length && rng() < 0.4 * extraShopMulFor(lot)) { shop = dealBestFor(lot, shopIdx, shopQueue.length); shopIdx++; }
      }

      if (shop) {
        // The shell wears its STREET's walls; the trade's colour lives on its
        // fascia and awning, where a shop's colour actually is.
        const color = streetWall(lot);
        // shops rise to their street's storefront height (homes over the
        // shop), so a row of shopfronts shares one cornice line. Drive-in
        // trades (gas, car lot, chop) keep the catalogue height outside the
        // two dense district kinds. Interior stamps gate through
        // clearFloorPoint, which keeps them off the stair core.
        const dk = districtKind(lot);
        if (dk === "core" || dk === "commercial") rng();   // the old height roll (RNG order preserved)
        const driveIn = !!(shop.gas || shop.carlot || shop.chop || shop.showroom);
        const shopStoreys = (driveIn && dk !== "core" && dk !== "commercial") ? shop.storeys
          : Math.max(shop.storeys, SS.shopSt);
        // FACADE POLICY BY TRADE. Still NO deliberately sealed facades — the
        // owner's blank-block complaint stands. What changes: the civic trades
        // (and the bank / security firm, which have always been civic in
        // everything but their skin) render with the MONUMENTAL ashlar facade —
        // tall symmetrical bays on a pilaster order — instead of the same glass
        // curtain wall as a phone shop. The `fortified` archetype stays
        // unreachable from this pass on purpose: it is the narrow-slot look the
        // owner cut, and it is reachable only via an explicit opts.facade.
        const civicSpec = CBZ.civicSpecFor ? CBZ.civicSpecFor(shop.kind) : null;
        const wantCivic = !!(CBZ.CIVIC_FACADE_KINDS && CBZ.CIVIC_FACADE_KINDS.has(shop.kind));
        const specialFacade = wantCivic ? "civic"
          : (shop.kind === "bank" || shop.kind === "security") ? "office" : undefined;
        // A colonnaded courthouse does not wear a diner awning: when the
        // monumental portico is live it already carries carved lettering (the
        // plaque) and the civic seal, so the storefront kit stands down. The
        // trade name still lives on lot.building.name for HUD/map/interactions.
        const porticoLive = !!(civicSpec && civicSpec.civic && CBZ.bldCivicOrder
          && !(CBZ.CONFIG && (CBZ.CONFIG.BLD_CIVIC_PODIUM === false || CBZ.CONFIG.BLD_MASONRY_V1 === false)));
        // WHICH GRAMMAR: a live portico IS the grammar (no kit on top of it);
        // the bank and the security firm wear the ashlar bank front; every
        // other trade wears its street's storefront style. A one-storey
        // drive-in stays a clean glass showroom.
        const shopDress = porticoLive ? false
          : (shop.kind === "bank" || shop.kind === "security") ? ({ style: "stone" })
          : (driveIn && shopStoreys < 2) ? false
          : (streetDress(lot, shopStoreys, true) || false);
        const b = makeBuilding(root, lot.cx, lot.cz, w, d, shopStoreys, color, side, {
          showroom: driveIn,
          retail: !!shop.retail, facade: specialFacade, district: dk,
          civic: civicSpec, dress: shopDress, reach: setback,
          storefront: !porticoLive,
        });
        if (!porticoLive) signAwning(b, side, w, d, shop.sign, shop.name, shop.kind);
        // Counter toward the back, vendor behind it. The back wall is also
        // where the shell reserved its stair core (a back corner), so the
        // counter is slid/narrowed along the wall onto the free run beside it.
        let ccx = door.nx * (w / 2 - 2.8), ccz = door.nz * (d / 2 - 2.8);
        let cw = door.nx ? 0.8 : Math.min(w - 2, 4.5);
        let cd = door.nz ? 0.8 : Math.min(d - 2, 4.5);
        ({ ccx, ccz, cw, cd } = fitCounter(b, door.nx, ccx, ccz, cw, cd));
        b.lbox(ccx, 0.6, ccz, cw, 1.2, cd, 0x6b4a2a, { solid: true });
        const vsx = lot.cx + ccx + door.nx * 1.2, vsz = lot.cz + ccz + door.nz * 1.2;
        lot.kind = shop.kind;
        lot.building = {
          ...b, shop, name: shop.name, sign: shop.sign, side, door: doorPt,
          vendorSpot: { x: vsx, z: vsz, face: Math.atan2(-door.nx, -door.nz) },
          gas: !!shop.gas, hospital: !!shop.hospital, carlot: !!shop.carlot,
          realtor: !!shop.realtor, chop: !!shop.chop,
        };
        furnishShop(b, lot, door);
        // THE FIT-OUT (city/fitout.js) learns what this ground floor is: the
        // trade, the counter it stands behind, the door you came in by.
        if (CBZ.fitoutDeclare) CBZ.fitoutDeclare(b, 0, "shop", CBZ.interiorFloorRoom ? CBZ.interiorFloorRoom(b, 0) : null,
          { kind: shop.kind, name: shop.name, counter: { x: ccx, z: ccz, w: cw, d: cd }, door: b.localDoor,
            flags: { gas: !!shop.gas, hospital: !!shop.hospital, carlot: !!shop.carlot, chop: !!shop.chop, realtor: !!shop.realtor, retail: !!shop.retail } });
        // the district field stacks HOMES over the storefront — stairs (and
        // anyone ducking upstairs mid-robbery) walk through them, so every
        // upper floor is a dressed flat, not a bare slab. EXCEPT dealerships:
        // a car showroom fills EVERY floor with inventory (the catalog index
        // carries across floors so the whole line-up is shown before repeating).
        if (shop.carlot || shop.chop) {
          const dealKind = shop.chop ? "chop" : "carlot";
          // ground floor placed ~ up to 10 cars; continue the catalog upstairs.
          let carIdx = 10;
          for (let k = 1; k < shopStoreys; k++) carIdx += showroomFloor(b, dealKind, door, k * FH, carIdx);
        } else {
          // WHAT STANDS OVER A STOREFRONT IS A PROPERTY OF THE TRADE. Every
          // shop in this game — the bank, City Hall, the hospital — used to get
          // somebody's LIVING ROOM on every storey above its counter, because
          // this line was `furnishApartmentFloor` for all of them. The mix table
          // answers it once: a public counter has its own admin above it, a
          // storefront has tenants. The apartment dresser is still the fallback.
          for (let k = 1; k < shopStoreys; k++) {
            if (!coherentFloor(b, k * FH, shop.kind, "above"))
              furnishApartmentFloor(b, k * FH, (lot.i | 0) * 7 + (lot.j | 0) + k);
          }
        }
        // …and somebody watching the door of the trades that need one. The
        // clerk at the counter already exists (peds.js's lazy vendor pass) —
        // this is the guard the game never had. ONE declared job.
        if (GUARD_TRADES[shop.kind] && CBZ.CONFIG.INTERIOR_LIFE_V1 !== false)
          declareInteriorGuard(b, "shop:" + (lot.i | 0) + ":" + (lot.j | 0),
            (shop.kind === "bank" || shop.kind === "casino" || shop.kind === "jewelry") ? 2 : 1);
        if (shop.chop) {
          chopShop = lot;
          // a drive-in sell bay just outside the door
          lot.building.chopZone = { x: door.x + door.nx * 5, z: door.z + door.nz * 5, r: 5.5 };
          // ===== THE MOD GARAGE / WAR-MACHINE BAY (city/modshop.js) =====
          // The chop shop only DELETES a car for cash. Right alongside it we
          // stamp a second drive-in bay — the customs/weapon workshop — so the
          // player can KEEP a car by turning it into a war machine (respray,
          // armor plating, rocket booster, roof turret, rocket launcher, perf).
          // Offset down the wall-tangent from the chop bay so the two bays read
          // as distinct lanes of the same garage; modshop.js registers the zone
          // and the menu off this descriptor. (Mirror of the chopZone block.)
          lot.building.modZone = {
            x: door.x + door.nx * 5 - door.nz * 7,
            z: door.z + door.nz * 5 + door.nx * 7,
            r: 5.5,
          };
        }
        if (shop.realtor) realtor = lot;
        // ===== THE GUN STORE — the walk-in armory (city/gunstore.js) =====
        // The shell already exists (door, counter, clerk vendor, furnished
        // guns interior); what the walk-in needs is WHERE to hang the REAL
        // purchasable weapon models. Stamp a WORLD-frame descriptor — the
        // back-wall rack line behind the clerk, the actual counter slab for
        // the glass pistol case, and the walkable room bounds for the browse
        // gate — so gunstore.js does zero geometry math. The clubLot pattern,
        // applied to iron.
        if (shop.kind === "guns") {
          gunLot = lot;
          const inx = door.nx, inz = door.nz, tgx = -inz, tgz = inx;   // inward + wall-tangent units
          const halfIn = (inx !== 0 ? w : d) / 2;                       // door wall → room centre
          const halfTan = (inx !== 0 ? d : w) / 2;
          lot.building.gunstore = {
            name: shop.name,
            // the walkable interior footprint ("you're in the store")
            bounds: { minX: lot.cx - w / 2 + WT, maxX: lot.cx + w / 2 - WT, minZ: lot.cz - d / 2 + WT, maxZ: lot.cz + d / 2 - WT },
            // BACK-WALL RACK face behind the clerk: centre + the normal facing
            // back INTO the room (toward the door) + the wall tangent. span is
            // capped so the wall of guns reads dense, not scattered.
            rack: {
              x: lot.cx + inx * (halfIn - WT - 0.18),
              z: lot.cz + inz * (halfIn - WT - 0.18),
              nx: -inx, nz: -inz, tx: tgx, tz: tgz,
              span: Math.min(12, Math.max(5, 2 * halfTan - 4)),
            },
            // the REAL counter slab (top = 1.2: the 0.6-centre, 1.2-tall box
            // above) — gunstore.js sets its glass display case on this top.
            counter: { x: lot.cx + ccx, z: lot.cz + ccz, w: cw, d: cd, top: 1.2, tx: tgx, tz: tgz },
          };
        }
        // ===== THE JEWELRY STORE — glass-case smash-and-grab (city/jewelry.js) =====
        // The shell (door, counter, clerk, lit wall shelves) already exists; what
        // the smash-and-grab needs is WHERE the four GLASS DISPLAY CASES stand.
        // Stamp WORLD-frame anchors — two front cases flanking the entrance
        // aisle, a mid-aisle feature island, and the back VAULT case behind the
        // counter (the clerk's body shields it: front cases live in their gaze,
        // the vault sits at their back) — each pre-clamped onto solid floor
        // (stair strip + walls) exactly like the counter was, so jewelry.js does
        // zero geometry math. The gunstore pattern, applied to ice.
        if (shop.kind === "jewelry") {
          jewelryLot = lot;
          const inx = door.nx, inz = door.nz, tgx = -inz, tgz = inx;   // inward + wall-tangent units
          const halfIn = (inx !== 0 ? w : d) / 2;
          const halfTan = (inx !== 0 ? d : w) / 2;
          // door-relative depth + tangent → a world point clamped onto open floor
          const caseAt = function (depth, lat, extra) {
            let lx = inx * (depth - halfIn) + tgx * lat, lz = inz * (depth - halfIn) + tgz * lat;
            lx = Math.min(w / 2 - WT - 0.9, Math.max(-w / 2 + WT + 0.9, lx));
            lz = Math.min(d / 2 - WT - 0.9, Math.max(-d / 2 + WT + 0.9, lz));
            const c = { x: lot.cx + lx, z: lot.cz + lz };
            if (extra) for (const k in extra) c[k] = extra[k];
            return c;
          };
          const counterDepth = (ccx * inx + ccz * inz) + halfIn;       // counter, door-relative
          // vault slides sideways off the clerk's post (counter tangent seat)
          const vendLat = ccx * tgx + ccz * tgz;
          const vaultLat = vendLat <= 0 ? Math.min(halfTan - 1.7, vendLat + 2.8)
                                        : Math.max(-(halfTan - 1.7), vendLat - 2.8);
          lot.building.jewelry = {
            name: shop.name,
            // the walkable interior footprint ("you're in the store")
            bounds: { minX: lot.cx - w / 2 + WT, maxX: lot.cx + w / 2 - WT, minZ: lot.cz - d / 2 + WT, maxZ: lot.cz + d / 2 - WT },
            tx: tgx, tz: tgz, inx, inz,
            // tier 0 = street ice up front, tier 1 = the iced feature island,
            // tier 2 = the VAULT case behind the counter (the jackpot pieces).
            cases: [
              caseAt(3.2, -1.7, { tier: 0 }),
              caseAt(3.2, 1.7, { tier: 0 }),
              caseAt(Math.max(4.6, Math.min(6.6, counterDepth - 2.6)), 0, { tier: 1 }),
              caseAt(2 * halfIn - 1.4, vaultLat, { tier: 2, vault: true }),
            ],
          };
        }
        // ===== THE VELVET CLUB — the city's one EXCLUSIVE nightclub =====
        // The single "bar" shop IS the marquee club: a velvet rope across the
        // door, a bouncer who stands just inside it, and a queue lane snaking
        // out front. city/club.js reads lot.building.club to run the line +
        // the drip-gated bouncer (money → clothes → drip → past the rope). We
        // expose everything in WORLD coords so club.js needs no geometry math.
        if (shop.kind === "bar") {
          clubLot = lot;
          // doorInfo's nx/nz is the INWARD normal — negate it: the rope, the
          // queue and the bouncer all live on the SIDEWALK (the old +n maths
          // formed the whole line INSIDE the bar and put insideSpot outside).
          const inx = door.nx, inz = door.nz;
          const nx = -inx, nz = -inz, tx = -nz, tz = nx;         // out-normal + sidewalk tangent
          const dx = door.x, dz = door.z;                        // door-wall centre (world)
          // the rope sits right at the threshold; the bouncer holds the inside
          // edge of it (one step toward the door), facing OUT at the line.
          const ropeX = dx + nx * 1.4, ropeZ = dz + nz * 1.4;
          // the QUEUE: a single-file lane offset to one side so the door stays
          // walkable for the player, marching straight out from the rope.
          const laneOff = 1.9;                                   // sideways shift of the lane
          const queue = [];
          for (let i = 0; i < 8; i++) {
            const out = 2.6 + i * 1.55;                          // distance from the door wall
            queue.push({ x: dx + nx * out + tx * laneOff, z: dz + nz * out + tz * laneOff });
          }
          lot.building.club = {
            name: shop.name,
            door: { x: door.x + inx * 1.2, z: door.z + inz * 1.2, nx: inx, nz: inz },   // step INTO the club
            // bouncer stands at the rope, just OUTSIDE the door, facing the line
            bouncerSpot: { x: ropeX, z: ropeZ, face: Math.atan2(nx, nz) },
            // where an ADMITTED VIP lands once the rope opens (just inside)
            insideSpot: { x: dx + inx * 3.2, z: dz + inz * 3.2 },
            // the rope itself (so club.js can flash/open it) + the line anchors
            ropePost: { x: ropeX, z: ropeZ },
            queue,
            tangent: { x: tx, z: tz }, normal: { x: nx, z: nz },
          };
          // ---- the exterior VELVET ROPE: two brass stanchions + a red sash
          //   slung across the threshold, plus a short carpet runner. Cheap decor
          //   (no colliders) gated through clearFloorPoint so it never blocks the
          //   door. Built in WORLD space (this lot's frame) like signAwning.
          clubRope(root, b, lot, door);
        }
      } else if (isLux) {
        // ===== THE MEGA-TOWER — the flagship, the TALLEST building in the city =====
        // Built by makeMegaTower(): 52 storeys — a genuine super-tall city anchor,
        // a glass curtain wall on EVERY floor, a ground/podium HANGAR deck you
        // drive into from any side, a lavish top-floor PENTHOUSE, a clean
        // penthouse door, and a rooftop HELIPAD. It tags lot.building.home (the
        // penthouse tier), lot.building.helipad and lot.building.hangar, and is
        // exposed via CBZ.cityMegaTower().
        const mega = makeMegaTower(root, lot, w, d, side, door, doorPt, FLAGSHIP);
        luxury = lot; luxBuilding = mega.b;
        homeLots.push(lot);
      } else {
        // residence / office tower — enterable, climbable, FURNISHED, a HOME.
        // The first few residence lots BECOME the listed ladder (studio..aerie);
        // the rest are generic, occupied apartments (off the market).
        // Heights ride the district field (core 4-8 … projects low-rise);
        // floor of 2 so every HOME keeps an upstairs to furnish.
        const storeys = Math.max(2, districtStoreys(lot));
        rng();   // the old palette draw (RNG order preserved)
        const color = streetWall(lot);
        const dk = districtKind(lot);
        // OFFICE TOWER? world.js owns the policy (city.officeLot): a downtown/
        // midtown subset of TALL, NON-listed towers become workplaces, not homes.
        // The listed home ladder (forcedTier) is always a HOME. Decided off a
        // deterministic predicate — NO rng() draw — so later placement is stable.
        const wantOffice = !forcedTier && storeys >= 3 &&
          city.officeLot && city.officeLot(lot);
        if (wantOffice) {
          // a glass OFFICE shell — clear curtain wall so the seated workers READ
          // through it from the street (the living-floor "why"). Same enterable/
          // climbable rig; upper floors get desks instead of flats.
          const b = makeBuilding(root, lot.cx, lot.cz, w, d, storeys, color, side, { office: true, glassKind: "clear", district: dk, dress: streetDress(lot, storeys, false) || false, reach: setback });
          // dress EVERY storey above the lobby with a working office floor and
          // collect the seat anchors building-wide, then register them ONCE so
          // city/officejobs.js can seat a payroll of workers (witnesses + cash).
          const deskAnchors = [];
          const v2 = interiorsV2();
          // ground-floor LOBBY (the arrival program: one desk facing the door,
          // a waiting row, planters) for every archetype EXCEPT the empty
          // shell — an intentionally empty tower gets nothing, that's the point.
          let reception = null;
          if (v2 && officeArchetype(b) !== "empty") {
            const kg = roomKit(b, groundTop(b));
            const lr = CBZ.interiorProgram("lobby", { x0: kg.xLo, x1: kg.xHi, z0: kg.zLo, z1: kg.zHi, y: groundTop(b) },
              { b: b, opts: { door: b.localDoor || { x: door.x - b.ox, z: door.z - b.oz, nx: door.nx, nz: door.nz } } });
            if (lr && lr.anchors && lr.anchors.length) reception = lr.anchors[0];
          }
          for (let k = 1; k < storeys; k++) {
            const fa = furnishOfficeFloor(b, k * FH, (lot.i | 0) * 5 + (lot.j | 0) * 3 + k);
            if (fa && fa.length) for (let a = 0; a < fa.length; a++) deskAnchors.push(fa[a]);
          }
          // INTENTIONALITY STAFFING: a SPARSE, deterministic crew of REAL peds
          // seated AT their desks via npclife's population layer (attached rigs
          // at true floor height — they type, they stay put, they die like
          // anyone). Only the low, meaningful floors (1..3), ≤2 a floor, ≤6 a
          // building incl. the receptionist; a citywide cap in interiorStaff
          // keeps the roster honest. One desk, one owner: a staffed desk never
          // enters the walk-in registry below.
          if (v2 && (reception || deskAnchors.length) && CBZ.interiorStaff && CBZ.hash01) {
            const seats = [];
            if (reception) { reception._staffed = true; seats.push(reception); }
            const perFloor = {};
            for (let a = 0; a < deskAnchors.length && seats.length < 6; a++) {
              const an = deskAnchors[a];
              if (an.y > FH * 3 + 0.1) break;                    // anchors arrive in floor order
              const fk = Math.round(an.y / FH);
              if ((perFloor[fk] | 0) >= 2) continue;             // sparse: ≤2 seated workers a floor
              if (CBZ.hash01(an.x, an.z, 0x5EA7) >= 0.3) continue;
              perFloor[fk] = (perFloor[fk] | 0) + 1;
              an._staffed = true; seats.push(an);
            }
            if (seats.length) CBZ.interiorStaff("interior:office:" + (lot.i | 0) + ":" + (lot.j | 0), b.group,
              seats.map(function (s) {
                const sy = s.y || 0;
                // ground seats ride the 0.14-top foundation slab; upper floors
                // ride their own 0.04-top floor covering.
                const floorLift = sy < 0.1 ? 0.15 : 0.05;
                return { x: s.lx != null ? s.lx : s.x - b.ox, y: sy + floorLift,
                         z: s.lz != null ? s.lz : s.z - b.oz, yaw: s.face || 0,
                         cushionH: s.cushionH, floorBelow: (s.floorBelow || 0) + floorLift };
              }));
          }
          // C2: officejobs.js DEFINES CBZ.cityRegisterOfficeDesks and stores the
          // anchors; optional-chained so the office still BUILDS if that file is
          // absent (just no seated workers — never a dead floor either way).
          // Staffed desks are excluded — the street-side walk-in pipeline
          // (schedule → claim → sit) keeps every remaining desk exactly as before.
          const walkIns = [];
          for (let a = 0; a < deskAnchors.length; a++) if (!deskAnchors[a]._staffed) walkIns.push(deskAnchors[a]);
          if (walkIns.length) CBZ.cityRegisterOfficeDesks && CBZ.cityRegisterOfficeDesks(lot, walkIns);
          // A LOBBY WITH A DESK AND NOBODY BEHIND IT IS A STAGE SET. The
          // receptionist is seated above (npclife); this is the security desk —
          // one declared job through citystaff, live only when you are close
          // enough to walk past it. Programmed towers only: an intentionally
          // empty shell has nothing to guard, which is the point of it.
          if (v2 && officeArchetype(b) !== "empty" && CBZ.CONFIG.INTERIOR_LIFE_V1 !== false)
            declareInteriorGuard(b, "office:" + (lot.i | 0) + ":" + (lot.j | 0), 1);
          lot.kind = "office";
          lot.building = { ...b, name: "Office Tower", sign: color, side, door: doorPt, office: true, deskCount: walkIns.length };
          placed.push(lot);
          continue;
        }
        // ---- HOMES: the street's grammar, the street's walls, the street's
        // setback. (A per-lot hash used to flip each home between a punched
        // brick shell and a glass one, and the facade kit then rolled a third
        // die on top; STREET_STYLE owns that decision now.) Explicit "office"
        // shell: it is the base the facade kit's grammars are drawn against.
        const b = makeBuilding(root, lot.cx, lot.cz, w, d, storeys, color, side,
          { district: dk, facade: "office", dress: streetDress(lot, storeys, false) || false, reach: setback });
        const listed = !!forcedTier;                 // only reserved lots are on the market
        const tierDef = forcedTier || GENERIC;
        // THE HOME lives on the TOP floor — home.floorY below — which is where
        // the Zillow tour / safehouse elevator actually lands. The tier
        // furnishing goes THERE (the old pass dressed y≈0, so arriving "home"
        // meant a bare plate). Every storey under it gets the generic
        // apartment dresser so the stair climb passes lived-in rooms.
        const topY = (storeys - 1) * FH;
        furnishHome(b, rng, tierDef, topY);
        // MANSION-tier homes (tier>=4, 3+ storeys) get a dedicated indoor POOL
        // floor just below the top home floor — the owner's explicit ask. Clamped
        // to a real interior storey (never ground or top); every other storey is a
        // dressed flat. poolStorey ∈ [1, storeys-2] by construction.
        const poolStorey = (tierDef.tier >= 4 && storeys >= 3) ? Math.max(1, Math.min(storeys - 2, storeys - 2)) : -1;   // ∈ [1, storeys-2]
        for (let k = 0; k < storeys - 1; k++) {
          if (k === poolStorey) furnishPoolFloor(b, k * FH);
          else furnishApartmentFloor(b, k * FH, (lot.i | 0) * 5 + (lot.j | 0) * 3 + k);
        }
        resFacade(b, side, w, d, b.wallColor != null ? b.wallColor : color, lot);   // residential exterior dressing (b.wallColor = the FINAL shell colour: a brick walk-up's stoop must match its brick, not the discarded tower palette entry)
        lot.kind = "tower";
        lot.building = { ...b, name: "Apartments", sign: color, side, door: doorPt };
        if (poolStorey >= 1) lot.building.poolY = poolStorey * FH;   // additive tag (safe)
        lot.building.home = {
          tier: tierDef.tier, id: tierDef.id, name: tierDef.name,
          price: listed ? tierDef.price : 0,    // 0 → registry values filler by floor area, not the studio price
          rent: tierDef.rent || 0,
          sqft: tierDef.sqft, beds: tierDef.beds || 1, garage: tierDef.garage, elevator: !!tierDef.elevator,
          listed: listed, owned: false, floorY: (storeys - 1) * FH, blurb: tierDef.blurb,
          door: doorPt,
        };
        lot.building.name = listed ? tierDef.name : "Apartments";
        homeLots.push(lot);
      }
      placed.push(lot);
    }

    // OWNERSHIP POST-PASS: give EVERY building an owner (shop→business,
    // home/tower→landlord(→player when owned), abandoned→gang, park→city).
    // Parks already carry their own owner stub above; this fills the rest. The
    // canonical field is lot.building.owner everywhere; gangs.js sets owner.id
    // on abandoned lots at spawn, realestate flips home owners via home.owned.
    for (let i = 0; i < placed.length; i++) stampOwner(placed[i], i);

    // ROOFTOP HELIPAD on the flagship luxury tower (the tallest building) — a
    // marked landing pad the aircraft agent flies to. cityHelipad() returns it.
    if (luxBuilding) makeHelipad(luxBuilding, luxury);

    // ---- VERTICAL-ACCESS REGISTRY (rigs built by city/elevators.js) --------
    // WHY: height is status — the property ladder ends on a roof with a
    // helipad, so getting UP has to feel like arriving. The lot POLICY lives
    // here with the lots: the few TALLEST towers rate a real street-level
    // ELEVATOR to the roof (the flagship mega-tower first), and a handful of
    // mid-rises get exterior FIRE-ESCAPE stairs — the loud chase route up.
    // elevators.js consumes these lists and owns the meshes/colliders/platforms.
    {
      // (this list was filtered on the dead `hasStairs` gate, so it was always
      // empty and not one fire escape was ever built in the city)
      const rigged = placed.filter((l) => l.building && l.building.group && !l.building.park);
      // ===== ELEVATORS — OWNER: "elevator only works on the massive building." =
      // The old policy capped lifts at the few TALLEST towers (and required
      // interior stairs), so the city felt like only the mega-tower had one. The
      // engine is mesh-count bound but generous, so we serve a much LARGER set:
      // ANY enterable multi-floor building (group + storeys>=2 + not park/
      // abandoned) qualifies — the hasStairs requirement is DROPPED so small/
      // narrow towers (which can't fit an interior switchback) still get a lift.
      // Stairs (now fixed/nice) STAY as a working fallback wherever they exist —
      // both coexist like a real building; elevators.js places the cab on a
      // non-stairwell interior wall. Capped (perf), prioritised tallest + most
      // central so the biggest/most-visited towers are always served and the cap
      // (if hit) only drops the shortest fringe walk-ups (which still have stairs
      // where present). elevators.js (VERT) makes the rig robust on ANY building.
      // bounded for mesh-count; rides the quality tier (build-once read,
      // lo 48 → hi 140); at mid tier it still covers ~every real tower.
      const EV_CAP = Math.round(CBZ.qScale ? CBZ.qScale(48, 140) : 80);
      const ctr = city.center || { x: 0, z: 0 };
      const evCand = placed.filter((l) =>
        l.building && l.building.group && l.building.storeys >= 2 &&
        !l.building.park && !l.building.abandoned);
      // priority score: tallest first, central as tiebreak (closer = higher).
      // Normalise distance to a small fraction so height dominates ordering.
      const evPool = evCand.slice().sort((a, b) => {
        const hb = (b.building.h || 0) - (a.building.h || 0);
        if (Math.abs(hb) > 0.01) return hb;
        const da = Math.hypot((a.cx || 0) - ctr.x, (a.cz || 0) - ctr.z);
        const db = Math.hypot((b.cx || 0) - ctr.x, (b.cz || 0) - ctr.z);
        return da - db;   // closer to centre wins the tie
      });
      city.elevatorLots = evPool.slice(0, EV_CAP);
      const served = new Set(city.elevatorLots);

      // ===== FIRE ESCAPES — OWNER: "ladders on the FRONT of tall glass
      // buildings that only go to the second floor — retarded ladder." Two
      // faults to fix in the LOT POLICY here: (1) never on the building FRONT
      // (b.side door / glass display face); (2) only on buildings where a real
      // FULL-HEIGHT escape reads right. The rig (elevators.js / VERT) climbs the
      // full storey count to the roof — the stubby read came from picking the
      // wrong (door) face and from no clean face being stamped.
      //
      // The rig hangs on a ±x face, never the door face:
      //   door side 2 (-x door) → +x face  (m = +1)
      //   door side 3 (+x door) → -x face  (m = -1)
      //   door side 0/1 (±z door) → +x face (m = +1)  [rear/side, off the front]
      // We STAMP lot.building.feSide = m on the chosen lots so elevators.js
      // builds to exactly that face (CONTRACT: buildings.js stamps the host
      // face, elevators.js builds full-height to it). Buildings with no legal
      // face go unserved — a clean doorway beats a ladder across the front.
      function escapeFaceFor(b) {
        const ds = b.side;
        if (ds === 3) return -1;                     // +x door: the -x face
        // door on -x, -z, or +z → the +x face is clear of the front display
        return 1;                                    // m = +1 (+x face)
      }
      // climbable, real-building escapes; full height (no <=4 storey cap — a
      // tall building gets a tall escape, not a 2-storey stub). Derelicts are
      // welcome (gang-roof chase routes). Exclude lots already served by a lift
      // so a tower isn't double-rigged, and any lot with no legal escape face.
      const feCand = rigged.filter((l) => {
        if (served.has(l)) return false;
        if (l.building.storeys < 2) return false;
        return escapeFaceFor(l.building) !== 0;
      });
      // MASONRY FIRST: a zig-zag iron fire escape belongs on a brick walk-up,
      // not bolted to a glass curtain wall — that is exactly where every real
      // one is, and it is the detail that sells a brick block. A stable sort
      // key (masonry, then original index) keeps this deterministic; no rng.
      feCand.forEach((l, i) => { l._feIdx = i; });
      feCand.sort((a, b2) => ((b2.building.masonry ? 1 : 0) - (a.building.masonry ? 1 : 0)) || (a._feIdx - b2._feIdx));
      feCand.forEach((l) => { delete l._feIdx; });   // transient sort key — never leave it on a lot record
      // spread the picks across the lot list so routes aren't clustered, and let
      // a few more exist now that they read right. Stamp the host face on each.
      city.fireEscapeLots = [];
      const nFE = Math.min(8, feCand.length);
      for (let t = 0; t < nFE; t++) {
        const pick = feCand[Math.min(feCand.length - 1, Math.floor((t + 0.5) / nFE * feCand.length))];
        if (city.fireEscapeLots.indexOf(pick) === -1) {
          pick.building.feSide = escapeFaceFor(pick.building);   // CONTRACT stamp for elevators.js
          city.fireEscapeLots.push(pick);
        }
      }
    }

    city.shopLots = placed.filter((l) => l.building && l.building.shop);
    city.abandonedLots = abandonedLots;
    city.homeLots = homeLots;
    city.chopShop = chopShop;
    city.realtor = realtor;
    city.luxuryLot = luxury;
    city.clubLot = clubLot;          // THE Velvet Club lot (city/club.js reads its .building.club)
    city.gunShopLot = gunLot;        // the walk-in armory lot (city/gunstore.js hangs the real stock here)
    city.jewelryLot = jewelryLot;    // the smash-and-grab lot (city/jewelry.js stands the glass cases here)
  };

  // pick black or white text for the best contrast against a sign colour
  function readableText(hex) {
    const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.55 ? "#15181d" : "#ffffff";
  }
  // PAINTED FACADE SIGN: the shop name baked onto a panel texture (bright, with
  // a dark drop-shadow so it reads from across the street), tinted for contrast
  // against the sign colour. Cached per name|color so repeated names are free.
  const signTexCache = new Map();
  function signFaceTex(name, signHex) {
    const key = name + "|" + signHex;
    let t = signTexCache.get(key); if (t) return t;
    // LETTERS ONLY, on a transparent 6:1 ground: the painted fascia behind
    // is the sign board, so the name reads as lettering applied to it (and,
    // drawn unlit, as lit letters after dark) instead of a second panel
    // stuck on the first.
    const c = document.createElement("canvas"); c.width = 768; c.height = 128;
    const x = c.getContext("2d");
    x.clearRect(0, 0, 768, 128);
    let fs = 78; x.textAlign = "center"; x.textBaseline = "middle";
    // a sign-maker's face (a heavy grotesque), not the game's rounded UI font
    do { x.font = "800 " + fs + "px 'Helvetica Neue', Helvetica, Arial, sans-serif"; fs -= 4; } while (x.measureText(name).width > 720 && fs > 22);
    x.fillStyle = "rgba(0,0,0,0.45)"; x.fillText(name, 386, 68);     // shadow
    x.fillStyle = readableText(signHex); x.fillText(name, 384, 64);  // face text
    t = new THREE.CanvasTexture(c); signTexCache.set(key, t); return t;
  }

  // striped awning canvas, cached per colour and run direction: the stripes run
  // down the slope (across the storefront), whichever axis the storefront is on
  const awnMatCache = new Map();
  function awningMat(hex, along) {
    const key = hex + (along ? "a" : "b");
    let m = awnMatCache.get(key); if (m) return m;
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d");
    const base = "#" + ("000000" + shadeHex(hex, 0.85).toString(16)).slice(-6);
    for (let i = 0; i < 8; i++) {
      x.fillStyle = (i & 1) ? "#ece6d8" : base;
      if (along) x.fillRect(0, i * 16, 128, 16); else x.fillRect(i * 16, 0, 16, 128);
    }
    x.fillStyle = "rgba(0,0,0,0.06)";                         // canvas weave
    for (let i = 0; i < 128; i += 2) { x.fillRect(i, 0, 1, 128); x.fillRect(0, i, 128, 1); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.encoding = THREE.sRGBEncoding;
    // 8 stripes per texture across a 4 m awning -> two repeats = 25 cm stripes
    t.repeat.set(along ? 1 : 2, along ? 2 : 1);
    m = new THREE.MeshLambertMaterial({ map: t });
    awnMatCache.set(key, m);
    return m;
  }
  // a real STOREFRONT: a BIG illuminated sign board carrying the shop NAME baked
  // right onto the facade (no freestanding sidewalk sign), plus a canopy awning.
  // `along` = the facade runs perpendicular to the door normal.
  function signAwning(b, side, w, d, color, name, kind) {
    const di = doorInfo(0, 0, w, d, side);
    const along = Math.abs(di.nx) > 0.5;          // door faces ±X → storefront spans Z
    const facade = along ? d : w;                  // width available across the storefront
    const sw = Math.min(facade - 0.6, DOORW + 4.2); // sign board spans most of the facade
    const fx = (lw, h, ld) => (along ? [ld, h, lw] : [lw, h, ld]);   // size helper (swap by facing)
    // NOTE: doorInfo's nx/nz is the INWARD normal — every offset below uses
    // -n (toward the STREET). The old +n offsets hung this whole storefront
    // INSIDE the shop/wall: the sign board sat buried in the facade and the two
    // "display windows" straddled the wall plane exactly coplanar with it — the
    // filmed dithered/moiré panels flanking every shop door.
    const onx = -di.nx, onz = -di.nz;             // outward (street) normal
    // per-kind storefront variety: the awning band picks up the trade accent and
    // the neon trim glows that accent so each storefront reads differently.
    const accent = kindAccent(kind);
    const awnCol = (kind === "bank" || kind === "cityhall" || kind === "hospital") ? color : accent;
    // CANOPY awning over the door (angled colour band, kind-tinted). The pitch
    // rotates about the FACADE-TANGENT axis (x for a ±z door, z for a ±x door —
    // the old axes were swapped, rolling the band sideways instead of pitching
    // its street edge down).
    // THE AWNING IS CANVAS. It was a 32 cm-thick slab glowing in the trade
    // colour with a neon strip under its lip: a lit brick over every door in
    // the city. Now: a striped canvas sheet pitched down to the street from a
    // header rail on the facade, with a solid valance hanging off its front
    // edge. Nothing on it glows; the street lights and the shop window light it.
    // THE SHOPFRONT, as a shopfitter builds one on a 3.2 m ground storey:
    //   glazing + door   0 .. 2.2   (the shell's clear panes and real door)
    //   FASCIA           2.3 .. 3.12, the full width between the corner piers,
    //                    painted in the trade colour, the name centred on it
    //   AWNING           hung from a rail under the fascia over the glazing,
    //                    shallow enough to stay on the shop's own parcel
    // The old board hung at FH + 0.45, straddling the first-floor sill line,
    // so every grammar's upper windows ran behind it. The facade kit keeps
    // this whole ground-storey bay clear on a shop (makeBuilding's
    // opts.storefront), so the fascia sits on the shell's own header band.
    const runW = Math.max(sw, facade - 1.5);                     // corner pier to corner pier
    const reach = b.reach != null ? b.reach : 1.0;
    const driveIn = kind === "gas" || kind === "carlot" || kind === "chop";
    // awning: over the glazing, never deeper than the parcel in front of it
    // rail at 2.5 + shallow pitch + 15 cm valance: valance lip clears ~2.1 m
    // (was 1.8 m at 2.28/0.26/20 cm: a hem at forehead height on every shop)
    const AD = Math.max(0.6, Math.min(1.1, reach - 0.2)), PITCH = 0.2;
    const railY = 2.5, drop = Math.sin(PITCH) * AD;
    if (!driveIn) {                                             // a drive-in bay has no awning over it
      const AW = runW - 0.2;
      const cOff = Math.cos(PITCH) * AD / 2, cY = railY - drop / 2;
      const awn = new THREE.Mesh(new THREE.BoxGeometry(...fx(AW, 0.025, AD)), awningMat(awnCol, along));
      awn.position.set(di.x + onx * cOff, cY, di.z + onz * cOff);
      awn.rotation[along ? "z" : "x"] = along ? PITCH * di.nx : -PITCH * di.nz;   // street edge dips
      b.group.add(awn);
      const vOff = Math.cos(PITCH) * AD, vY = railY - drop - 0.075;
      const val = new THREE.Mesh(new THREE.BoxGeometry(...fx(AW, 0.15, 0.018)), mat(shadeHex(awnCol, 0.78)));
      val.position.set(di.x + onx * vOff, vY, di.z + onz * vOff);
      b.group.add(val);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(...fx(AW + 0.1, 0.07, 0.08)), mat(0x2b2e33));
      rail.position.set(di.x + onx * 0.04, railY, di.z + onz * 0.04);
      b.group.add(rail);
    }
    void accent;
    // FASCIA: one painted board the width of the shopfront, a dark cap and
    // sill rail framing it, the name centred (never stretched across 20 m).
    const fasY0 = 2.56, fasY1 = 3.12, fasH = fasY1 - fasY0, fasC = (fasY0 + fasY1) / 2;
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(...fx(runW, fasH, 0.16)), mat(color));
    fascia.position.set(di.x + onx * 0.1, fasC, di.z + onz * 0.1);
    b.group.add(fascia);
    for (const ry of [fasY0 - 0.03, fasY1 + 0.03]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(...fx(runW + 0.08, 0.06, 0.22)), mat(0x2b2e33));
      cap.position.set(di.x + onx * 0.11, ry, di.z + onz * 0.11);
      b.group.add(cap);
    }
    // the name, painted on the fascia's street face (6:1 canvas, drawn at 6:1)
    const plH = fasH - 0.16, plW = Math.min(runW - 0.4, plH * 6);
    const nameMat = new THREE.MeshBasicMaterial({ map: signFaceTex(name, color), transparent: true });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(plW, plH), nameMat);
    plate.position.set(di.x + onx * 0.185, fasC, di.z + onz * 0.185);
    if (along) plate.rotation.y = di.nx > 0 ? -Math.PI / 2 : Math.PI / 2;
    else if (di.nz > 0) plate.rotation.y = Math.PI;
    plate.renderOrder = 2; b.group.add(plate);
    // (DISPLAY WINDOWS REMOVED: two raw glass boxes used to sit flush in the
    // wall here, their street faces EXACTLY coplanar with the facade — the
    // z-fighting panels the player filmed. makeBuilding already glazes the
    // door flanks with pooled, shatterable storefront panes; these were
    // redundant, un-shatterable, and 4 extra meshes per shop.)
    // (CH1 — FLOATING NAME SPRITE REMOVED: the store name is already painted on
    // the lit board PLATE above the door, so a second hovering camera-facing
    // label was redundant text floating off the
    // facade. Cutting it saves 1 Sprite + 1 SpriteMaterial cache entry per shop
    // and respects "no dumb floating UI". Interactions read lot.building.shop.name,
    // never this sprite, so nothing gameplay-side depends on it.)
  }
  // ---- THE VELVET CLUB ENTRANCE: a real rope line out front ----------------
  // Two brass STANCHIONS straddling the door with a sagging red velvet SASH slung
  // between them (the rope you have to be let past), a short red CARPET runner
  // leading in, and a soft pink ENTRANCE GLOW so the marquee club reads as THE
  // exclusive spot from across the street. All decor (no colliders) hung in the
  // building group at the door face, same local frame as signAwning. club.js
  // animates the line/bouncer; this is just the set dressing.
  function clubRope(root, b, lot, door) {
    const w = b.w, d = b.d, side = lot.building.side;
    const di = doorInfo(0, 0, w, d, side);
    const along = Math.abs(di.nx) > 0.5;          // door faces ±X → entrance spans Z
    const tx = along ? 0 : 1, tz = along ? 1 : 0; // tangent across the doorway
    // doorInfo's nx/nz points INWARD — negate for the outward (street) normal.
    // The old +n offsets set the whole rope line up INSIDE the club.
    const nx = -di.nx, nz = -di.nz;               // outward normal (local)
    const VELVET = 0x8a1f2b, BRASS = 0xcaa64a, RUNNER = 0x7a141f, GLOW = 0xe85d8a;
    const fx = (lw, h, ld) => (along ? new THREE.BoxGeometry(ld, h, lw) : new THREE.BoxGeometry(lw, h, ld));
    const add = (geo, col, x, y, z, opt) => { const m = new THREE.Mesh(geo, mat(col, opt || {})); m.position.set(x, y, z); m.castShadow = false; b.group.add(m); return m; };
    // RED CARPET runner from the door out to the rope
    add(fx(2.0, 0.04, 3.0), RUNNER, di.x + nx * 1.6, 0.03, di.z + nz * 1.6);
    // two brass STANCHION posts straddling the threshold (rope ends)
    const stanOut = 1.7;        // how far out the rope line sits
    for (const s of [-1, 1]) {
      const px = di.x + nx * stanOut + tx * s * 1.5, pz = di.z + nz * stanOut + tz * s * 1.5;
      add(new THREE.CylinderGeometry(0.07, 0.09, 1.0, 8), BRASS, px, 0.5, pz, { emissive: BRASS, ei: 0.25 });   // post
      add(new THREE.SphereGeometry(0.12, 8, 6), BRASS, px, 1.05, pz, { emissive: BRASS, ei: 0.3 });             // brass cap
      add(new THREE.CylinderGeometry(0.15, 0.18, 0.1, 10), 0x2a2f37, px, 0.06, pz);                             // weighted base
    }
    // the VELVET SASH slung (sagging) between the two posts — a low bar dipping
    // in the middle, read as a soft rope across the door. Three short segments.
    for (let i = -1; i <= 1; i++) {
      const sag = i === 0 ? 0.78 : 0.9;     // middle dips lower
      const rx = di.x + nx * stanOut + tx * i * 0.75, rz = di.z + nz * stanOut + tz * i * 0.75;
      add(fx(1.6, 0.07, 0.07), VELVET, rx, sag, rz, { emissive: VELVET, ei: 0.25 });
    }
    // a soft pink ENTRANCE GLOW washing the threshold (the club's signature light)
    add(fx(3.0, 0.06, 0.5), GLOW, di.x + nx * 0.5, DOORH + 0.2, di.z + nz * 0.5, { emissive: GLOW, ei: 0.9 });   // washes the doorway, so it rides DOORH
    // (CH2 — FLOATING "VELVET — VIP ONLY" LABEL REMOVED: the brass stanchions,
    // sagging red sash, carpet runner and pink threshold glow above ALREADY read
    // the venue as the exclusive spot, and signAwning hangs the lit board+plate
    // name sign on the facade. The hovering text was redundant floating UI — cut
    // per the no-dumb-floating-UI rule. The diegetic rope line + glow remain.)
  }

  // a bright, readable sprite tint derived from the sign colour (push it light)
  function spriteTint(hex) {
    let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    r = Math.round(r * 0.5 + 170); g = Math.round(g * 0.5 + 170); b = Math.round(b * 0.5 + 170);
    return "#" + ((1 << 24) + (Math.min(255, r) << 16) + (Math.min(255, g) << 8) + Math.min(255, b)).toString(16).slice(1);
  }

  // a small painted HOUSE-NUMBER plate (brass-on-dark), cached per number.
  const numTexCache = new Map();
  function houseNumTex(num) {
    let t = numTexCache.get(num); if (t) return t;
    const c = document.createElement("canvas"); c.width = 128; c.height = 64;
    const x = c.getContext("2d");
    x.fillStyle = "#1c2026"; x.fillRect(0, 0, 128, 64);
    x.strokeStyle = "#caa64a"; x.lineWidth = 4; x.strokeRect(4, 4, 120, 56);
    x.fillStyle = "#e8d8a8"; x.font = "900 40px Fredoka, Arial Black, sans-serif";
    x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("" + num, 64, 34);
    t = new THREE.CanvasTexture(c); numTexCache.set(num, t); return t;
  }

  // ---- RESIDENTIAL FACADE dressing (homes/towers get NO storefront sign) ----
  // A light residential frontage: an entry STOOP + canopy over the door, a brass
  // HOUSE-NUMBER plate, and an AC window unit. (No front-face ladder — the real
  // climbable fire escapes live on REAR/side faces via elevators.js.) Reuses
  // addCityGlass for any glass so panes stay shatterable. Kept modest (a handful
  // of meshes), all hung in the building group at the door face.
  function resFacade(b, side, w, d, color, lot) {
    // A dressed home already has its entrance: the grammar's porch / stoop /
    // doorcase plus the kit's reveal around the real door. This generic
    // grey stoop + black canopy + posts bolted on top of it was a second,
    // unrelated entrance stuck through the first one.
    if (b.dressStyle) return;
    const di = doorInfo(0, 0, w, d, side);
    const along = Math.abs(di.nx) > 0.5;          // door faces ±X → facade spans Z
    const tx = along ? 0 : 1, tz = along ? 1 : 0; // facade tangent
    const fx = (lw, h, ld) => (along ? [ld, h, lw] : [lw, h, ld]);   // swap by facing
    const g = b.group, ox = b.ox, oz = b.oz;
    const darkTrim = 0x2a2f37;
    // NOTE: doorInfo's nx/nz is the INWARD normal — every offset below uses
    // -n (toward the STREET). The old +n offsets buried this entire frontage:
    // stoop/canopy/posts INSIDE the lobby, the house-number plate and fire
    // escape inside the wall, the transom glass entombed in the door header.
    const onx = -di.nx, onz = -di.nz;             // outward (street) normal
    // ENTRY STOOP: a low step slab just outside the door
    const stoop = new THREE.Mesh(new THREE.BoxGeometry(...fx(DOORW + 1.0, 0.28, 1.4)), mat(0x8a8f97));
    stoop.position.set(di.x + onx * 0.7, 0.14, di.z + onz * 0.7); stoop.castShadow = false; g.add(stoop);
    // CANOPY over the entrance (trim-coloured, slight lip) — door-anchored:
    // it shelters the DOORWAY, so it rides DOORH, not the floor line above.
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(...fx(DOORW + 1.4, 0.18, 1.3)), mat(darkTrim));
    canopy.position.set(di.x + onx * 0.6, DOORH + 0.1, di.z + onz * 0.6); canopy.castShadow = false; g.add(canopy);
    for (const s of [-1, 1]) {                    // two thin support posts
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, DOORH - 0.1, 0.12), mat(darkTrim));
      post.position.set(di.x + onx * 1.15 + tx * s * (DOORW * 0.5 + 0.4), (DOORH - 0.1) / 2, di.z + onz * 1.15 + tz * s * (DOORW * 0.5 + 0.4));
      post.castShadow = false; g.add(post);
    }
    // HOUSE-NUMBER plate beside the door (one street-facing plane, 0.07 proud)
    const num = 100 + ((((lot.i | 0) * 17 + (lot.j | 0) * 7) % 89) * 10);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45),
      new THREE.MeshBasicMaterial({ map: houseNumTex(num), transparent: true }));
    plate.position.set(di.x + onx * 0.07 + tx * (DOORW * 0.5 + 0.5), 2.3, di.z + onz * 0.07 + tz * (DOORW * 0.5 + 0.5));
    if (along) plate.rotation.y = di.nx > 0 ? -Math.PI / 2 : Math.PI / 2;
    else if (di.nz > 0) plate.rotation.y = Math.PI;
    plate.renderOrder = 2; g.add(plate);
    // AC WINDOW UNIT — CUT (owner, second screenshot: "you said they were gone
    // but ac units are still on some buildings").
    //
    // THIS WAS THE SURVIVOR, and it survived because it was the only one of the
    // four producers that was never behind a flag. The other three were all
    // switched off in earlier waves and correctly report zero:
    //   • buildings.js:2959   punched-window AC  — gated FACADE_AC_UNITS (false)
    //   • buildings.js:3261   split-grammar acUnit terminal — deleted outright
    //   • building_dress.js:551 window AC x260   — gated PROPS_PURGE_V1 (true)
    // so every census said "acBoxes: 0" while this one kept drawing, once per
    // residential building, unconditionally. And `resFacade` is NOT just for
    // houses — its caller sets `lot.kind = "tower"` (line ~6936), so every
    // apartment TOWER in the city, glass curtain wall included, wore a
    // 0.8 x 0.5 x 0.5 grey box bolted to its elevation at FH + 0.55. That is
    // the box in the screenshot.
    //
    // It is now behind the SAME flag as its sibling, so FACADE_AC_UNITS is the
    // one switch that governs every facade AC box in the game rather than two
    // of the three. Default false = gone.
    if (CBZ.CONFIG && CBZ.CONFIG.FACADE_AC_UNITS === true) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(...fx(0.8, 0.5, 0.5)), mat(0xb9bec6));
      ac.position.set(di.x + onx * 0.2 + tx * (along ? d : w) * 0.28, FH + 0.55, di.z + onz * 0.2 + tz * (along ? d : w) * 0.28);
      ac.castShadow = false; g.add(ac);
      _facadeAC++;
    }
    // (REMOVED) the old FRONT-FACE cosmetic fire-escape ladder rig — owner-filmed
    // as "a retarded ladder on the front of a glass tower that only reaches the
    // 2nd floor." It was purely decorative (rails/rungs/landing, no collider or
    // platform). The REAL climbable fire escapes are built by elevators.js
    // buildFireEscape on REAR/side faces at FULL height, so nothing is lost here.
    // a small shatterable glass transom over the DOOR opening — PROUD of the
    // facade (0.07..0.13) and above the canopy lip, so it actually shows
    // (the old +n*0.05 buried it inside the solid header wall).
    addCityGlass(g, di.x + onx * 0.1, DOORH + 0.5, di.z + onz * 0.1, along ? 0.06 : DOORW * 0.9, 0.5, along ? DOORW * 0.9 : 0.06, ox, oz, null, b.windows);
  }

  // ---- ROOFTOP HELIPAD -----------------------------------------------------
  // A flat painted landing pad (white H inside a TLOF circle) on the roof of the
  // tallest tower, ringed with blinking marker lights. cityHelipad() hands the
  // aircraft agent the world {x,y,z} of the pad surface. One canvas texture.
  let _helipadTex = null;
  function helipadTex() {
    if (_helipadTex) return _helipadTex;
    const c = document.createElement("canvas"); c.width = 256; c.height = 256;
    const x = c.getContext("2d");
    // dark asphalt pad
    x.fillStyle = "#1c2026"; x.fillRect(0, 0, 256, 256);
    x.fillStyle = "#23282f"; for (let i = 0; i < 256; i += 32) x.fillRect(i, 0, 2, 256);
    // outer TLOF boundary circle (real helipads mark this ring)
    x.strokeStyle = "#e8edf2"; x.lineWidth = 10;
    x.beginPath(); x.arc(128, 128, 100, 0, 6.2832); x.stroke();
    // yellow caution ring just inside
    x.strokeStyle = "#ffd23b"; x.lineWidth = 4;
    x.beginPath(); x.arc(128, 128, 88, 0, 6.2832); x.stroke();
    // the big white H
    x.fillStyle = "#f2f6fa";
    x.fillRect(86, 70, 22, 116);     // left leg
    x.fillRect(148, 70, 22, 116);    // right leg
    x.fillRect(86, 117, 84, 22);     // crossbar
    const t = new THREE.CanvasTexture(c);
    _helipadTex = t; return t;
  }
  function makeHelipad(b, lot) {
    const cx = b.roofCx != null ? b.roofCx : b.ox, cz = b.roofCz != null ? b.roofCz : b.oz;
    const py = b.h + 0.12;                          // a hair above the roof slab
    const pad = Math.min(b.w, b.d) * 0.42;          // pad radius footprint
    // the painted pad (flat quad facing up)
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(pad * 2, pad * 2),
      new THREE.MeshLambertMaterial({ map: helipadTex(), emissive: 0x222a30, emissiveIntensity: 0.25 }));
    plane.rotation.x = -Math.PI / 2; plane.position.set(cx, py, cz);
    plane.receiveShadow = true; CBZ.scene.add(plane);
    // a low raised lip so the pad reads as a real deck
    const lip = new THREE.Mesh(new THREE.BoxGeometry(pad * 2 + 0.4, 0.18, pad * 2 + 0.4), mat(0x2a3138));
    lip.position.set(cx, b.h - 0.02, cz); lip.castShadow = false; CBZ.scene.add(lip);
    // blinking corner/edge marker lights (emissive cubes) + their pulse loop
    const lights = [];
    const lmat = new THREE.MeshLambertMaterial({ color: 0xff5a3b, emissive: 0xff3b1f, emissiveIntensity: 1.0 });
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const lx = cx + Math.cos(a) * (pad + 0.2), lz = cz + Math.sin(a) * (pad + 0.2);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), lmat);
      m.position.set(lx, py + 0.18, lz); CBZ.scene.add(m); lights.push(m);
    }
    // a tall "H" beacon mast with a green winsock-style light so it's findable
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.4, 0.18), mat(0xb9bec6));
    mast.position.set(cx + pad - 0.3, py + 1.2, cz + pad - 0.3); CBZ.scene.add(mast);
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4),
      new THREE.MeshLambertMaterial({ color: 0x39ff88, emissive: 0x14c258, emissiveIntensity: 1.0 }));
    beacon.position.set(cx + pad - 0.3, py + 2.5, cz + pad - 0.3); CBZ.scene.add(beacon);
    _helipad = { x: cx, y: py, z: cz, r: pad };
    _helipadLmat = lmat; _helipadBeacon = beacon;
    if (lot && lot.building) lot.building.helipad = _helipad;
  }
  // a single cheap strobe loop for the (one) helipad's marker lights, registered
  // ONCE at module load so rebuilding the city never stacks hooks.
  let _helipadLmat = null, _helipadBeacon = null, _helipadBlinkT = 0;
  CBZ.onUpdate(34.4, function (dt) {
    if (CBZ.game.mode !== "city" || !_helipadLmat) return;
    _helipadBlinkT += dt;
    _helipadLmat.emissiveIntensity = (_helipadBlinkT % 1.0) < 0.5 ? 1.2 : 0.15;
    if (_helipadBeacon) _helipadBeacon.material.emissiveIntensity = 0.6 + 0.5 * (Math.sin(_helipadBlinkT * 3) * 0.5 + 0.5);
  });
  // PUBLIC: where the rooftop helipad is (the aircraft agent lands here). Returns
  // {x,y,z,r} or null if no city is built yet.
  CBZ.cityHelipad = function () { return _helipad; };

  // PUBLIC: the flagship MEGA-TOWER (the apex penthouse home). Returns
  //   { lot, penthouseDoor, helipad, hangar }
  // or null before a city is built. helipad/hangar are read live off the lot's
  // building so they reflect the post-pass helipad too. Phase 3 (aircraft) reads
  // this to base the missile chopper on the helipad and the F-22 in the hangar.
  CBZ.cityMegaTower = function () {
    if (!_megaTower || !_megaTower.lot) return null;
    const lb = _megaTower.lot.building || {};
    /* THE `|| _helipad` FALLBACK MUST NOT OUTLIVE A COLLAPSE.
       city/demolition.js's suspendAir() nulls b.helipad and b.hangar while the
       tower is rubble and restores them on the rebuild calendar — the entire
       basis of its DEMO_LANDMARKS decision ("flying a plane into your own
       hangar should cost you the hangar, and then give it back"). `hangar`
       below honours that, because it reads the building and stops. `helipad`
       did not: the module-global `_helipad` (stamped by the rooftop-pad
       post-pass) survives the teardown untouched, so the fallback handed
       playeraircraft.js / phone.js a pad on a tower that is a smoking pile,
       and the missile chopper spawned in mid-air over rubble.
       `lb._demoAir` is demolition's own suspension stamp — the record it
       writes on the building the moment it takes the tags away — so it is the
       exact tell for "suspended, do not fall back". The fallback still covers
       the case it was written for: the boot window before the post-pass has
       stamped lot.building.helipad, where no suspension record exists. */
    return {
      lot: _megaTower.lot,
      penthouseDoor: _megaTower.penthouseDoor,
      helipad: lb.helipad || (lb._demoAir ? null : (_helipad || null)),
      hangar: lb.hangar || null,
    };
  };

  // PUBLIC (LE6): break a residential building into its individual RENTAL UNITS —
  // one (or more) per floor, INCLUDING a dirt-cheap "micro" tier on the bottom.
  // WHY: the home-bond system (housing.js) has to give EVERY ped a roof they can
  // afford, so a tower can't be one listing — it's a stack of flats, and the low
  // rungs are sub-basement-cheap studios nobody is priced out of. The TOP home
  // floor (the player-buyable penthouse/listed tier) is EXCLUDED — that one is
  // owned, not rented. Returns [] for anything without a home record (offices,
  // parks, derelicts) so the caller skips them.
  //
  // Shape matches housing.js's own unit record EXACTLY — { id, lot, building,
  // floorY, door, tier, rent, occupant } — because buildings.js loads first, so
  // THIS is the canonical CBZ.cityFloorUnits the contract names (housing.js then
  // defers to it). tier 0 = the affordable MICRO floor; higher tiers read nicer.
  // Allocation-light (one array out, called once at assign time); we never mutate
  // the building (no geometry, no draw calls).
  CBZ.cityFloorUnits = function (lot) {
    const b = lot && lot.building;
    const home = b && b.home;
    if (!b || !home || b.park || b.abandoned || lot.kind === "office") return [];   // no residence → no units
    const storeys = Math.max(1, (b.storeys | 0) || (b.floorTops ? b.floorTops.length - 1 : 1));
    const FHl = b.FH || FH;
    // per-floor arrival Y from the real slab math (elevators.js contract); else a
    // synthetic ladder so headless/oddly-built shells still split.
    let tops = b.floorTops;
    if (!tops || !tops.length) { tops = [0.14]; for (let L = 1; L <= storeys; L++) tops.push(L * FHl); }
    const door = home.door || b.door || null;
    const topFloorY = home.floorY;                          // the listed/penthouse tier — NEVER rented
    // base MICRO rent by district value: pricier address → pricier studio, but the
    // floor stays cheap so the poorest ped is always housed. home.rent (if any) is
    // the headline the upper floors climb toward.
    const headlineRent = home.rent ? home.rent : Math.round(120 + storeys * 18);
    const MICRO_RENT = 45;
    const foot = ((b.w || 12) * (b.d || 12));
    const perFloor = foot > 520 ? 3 : foot > 300 ? 2 : 1;   // bigger footprint → more flats per floor
    const units = [];
    for (let f = 0; f < storeys; f++) {
      const fy = tops[f];
      if (fy == null) continue;
      // skip the top home floor precisely (compare by Y so a flagship penthouse on
      // the very top slab is excluded even when indexing differs).
      if (topFloorY != null && Math.abs(fy - topFloorY) < 0.05) continue;
      // skip the EXECUTIVE FLOOR too (the mega-tower suite) — a corner office
      // is not a rentable flat; without this a tenant would lease the suite.
      if (b.execOffice && b.execOffice.floorY != null && Math.abs(fy - b.execOffice.floorY) < 0.05) continue;
      const lift = storeys > 1 ? f / (storeys - 1) : 0;     // 0 at ground → 1 near top
      for (let u = 0; u < perFloor; u++) {
        // the FIRST unit on the two lowest floors is the dirt-cheap MICRO tier so
        // affordable stock always exists at the bottom of the stack.
        const micro = (f <= 1 && u === 0);
        const tier = micro ? 0 : (f === storeys - 1 ? 3 : f === 0 ? 1 : 2);
        const rent = micro
          ? Math.max(8, MICRO_RENT + f * 8)
          : Math.max(8, Math.round(MICRO_RENT + (headlineRent - MICRO_RENT) * (0.25 + 0.75 * lift) + u * 22));
        units.push({
          id: lot.i + "_" + lot.j + "_f" + f + "_u" + u,
          lot, building: b, floorY: fy, door, tier, rent, occupant: null,
        });
      }
    }
    return units;
  };

  // ---- PARKS WORTH CROSSING -------------------------------------------------
  // A park is the block's meeting spot: a stone FOUNTAIN at the heart,
  // BENCHES facing it from the four path mouths, crossing PATHS, a clipped
  // HEDGE ring framing the lawn (broken at the path mouths so the cut-through
  // stays obvious), a low steel RAILING at the lot edge, and four real trees.
  //
  // DE-SLOP (2026-09-27): it was all flat-colour primitives: a box bench (an
  // iron slab under a plank), box hedges, a cube-stack "broadleaf", a lawn
  // that was whatever lot pad the district happened to lay (downtown parks
  // were grass-free concrete), gravel paths as flat beige quads with no
  // texture, and a fountain whose water GLOWED (emissive 0.4, lit at noon)
  // under a 16 cm BoxGeometry "jet". Now: a textured lawn with a stone edging
  // kerb, gravel paths with steel edging strips, a paved plaza, a coped stone
  // basin with dark (unlit-by-itself) water, a two-tier bowl with a water
  // column and a falling curtain, the kerb kit's cast-iron slatted bench
  // (city/props.js, the one outdoor-furniture vocabulary), clipped hedges
  // with a rounded top in a leafy texture, and trees from the tree grammar +
  // vegetation kit (bark bole with root flare, leaf-card crown).
  // Colliders: fountain basin + tree trunks + the railing ONLY — benches,
  // hedges and paths stay brushable so chases never snag.
  // rng budget: exactly the 12 draws the old pass made (worldgen stream safe).
  let _parkWaterM = null, _parkFallM = null;
  function parkWaterMat() {
    return _parkWaterM || (_parkWaterM = new THREE.MeshLambertMaterial({ color: 0x2f5560, transparent: true, opacity: 0.86, depthWrite: false }));
  }
  function parkFallMat() {
    return _parkFallM || (_parkFallM = new THREE.MeshLambertMaterial({ color: 0xcfe3ea, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
  }
  const _parkMats = new Map();
  // a Lambert keyed by colour + optional surface-library map (repeat 1: the
  // geometry's own UVs are scaled to metres, so nothing stretches)
  function parkMat(c, surf, o) {
    const key = c + "|" + (surf || "") + "|" + ((o && o.off) || 0);
    let m = _parkMats.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: c });
      const maps = surf && CBZ.surfaceMaps ? CBZ.surfaceMaps(surf, { repeat: 1 }) : null;
      if (maps && maps.map) m.map = maps.map;
      // tint colours are authored to multiply the map; with the library off
      // (tier 0) stand in for the map's own luminance instead of glowing pale
      else if (surf) m.color.multiplyScalar(surf === "grass" ? 0.42 : 0.6);
      if (o && o.off) { m.polygonOffset = true; m.polygonOffsetFactor = -o.off; m.polygonOffsetUnits = -o.off * 2; }
      _parkMats.set(key, m);
    }
    return m;
  }
  // scale a geometry's UVs so one texture repeat covers `metres`
  function uvMetres(g, su, sv) {
    const uv = g.attributes.uv; if (!uv) return g;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    return g;
  }
  function makePark(root, lot, rng) {
    const cx = lot.cx, cz = lot.cz, w = lot.w, d = lot.d;
    const Y = 0.125;                                     // the lot pad the park stands on
    function add(g, mat, x, y, z, o) {
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y, z);
      if (o && o.rx != null) m.rotation.x = o.rx;
      if (o && o.ry != null) m.rotation.y = o.ry;
      m.castShadow = !!(o && o.cast); m.receiveShadow = true; root.add(m);
      return m;
    }
    const flat = (W, D, tile) => { const g = new THREE.PlaneGeometry(W, D); uvMetres(g, W / tile, D / tile); return g; };
    const STONE = 0xb9b2a3, EDGE = 0x8f8a80;
    // LAWN inside a stone edging kerb (whatever the district's lot pad is)
    const lw = w - 1.6, ld = d - 1.6;
    // THE GROUND IS PAINTED, NOT STACKED. city/cityground.js lays the lawn,
    // the decomposed-granite paths, the paved plaza and rim, mulch rings at
    // the trunks and bald turf at the benches straight into the lot surface
    // from this same layout (lw/ld, PW, plazaR, the tree list below). The
    // three tinted overlay planes that used to sit here are only drawn when
    // that system is missing.
    const PAINTED = !!(CBZ.cityGround && lot.grid);    // only the grid's pads carry the splat
    lot.groundTrees = [];
    if (!PAINTED) add(flat(lw, ld, 3.2), parkMat(0x9fc07e, "grass", { off: 1 }), cx, Y + 0.012, cz, { rx: -Math.PI / 2 });
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(lw + 0.3, 0.1, 0.15), parkMat(EDGE), cx, Y + 0.05, cz + s * (ld / 2 + 0.075));
      add(new THREE.BoxGeometry(0.15, 0.1, ld), parkMat(EDGE), cx + s * (lw / 2 + 0.075), Y + 0.05, cz);
    }
    // PATHS: gravel with steel edging strips, meeting on a paved plaza
    const PW = 2.2, GRAVEL = 0xdac7a0;          // tan decomposed granite
    if (!PAINTED) {
      add(flat(lw, PW, 2), parkMat(GRAVEL, "concrete", { off: 2 }), cx, Y + 0.018, cz, { rx: -Math.PI / 2 });
      add(flat(PW, ld, 2), parkMat(GRAVEL, "concrete", { off: 2 }), cx, Y + 0.018, cz, { rx: -Math.PI / 2 });
    }
    const edgeM = parkMat(0x3a3834);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(lw, 0.03, 0.035), edgeM, cx, Y + 0.02, cz + s * PW / 2);
      add(new THREE.BoxGeometry(0.035, 0.03, ld), edgeM, cx + s * PW / 2, Y + 0.02, cz);
    }
    const plazaR = Math.min(w, d) * 0.17;
    const plazaG = new THREE.CircleGeometry(plazaR, 28);
    uvMetres(plazaG, plazaR * 2 / 1.2, plazaR * 2 / 1.2);
    if (!PAINTED) add(plazaG, parkMat(0xcfc8b8, "concrete", { off: 3 }), cx, Y + 0.022, cz, { rx: -Math.PI / 2 });
    const ringG = new THREE.RingGeometry(plazaR - 0.02, plazaR + 0.18, 28);
    add(ringG, parkMat(EDGE, null, { off: 4 }), cx, Y + 0.024, cz, { rx: -Math.PI / 2 });

    // the FOUNTAIN: coped stone basin, dark water, two-tier bowl, a column of
    // water from the top and a thin curtain falling off the bowl's lip
    const stoneM = parkMat(STONE, "concrete");
    const BR = 1.9, BH = 0.5;
    const outer = new THREE.CylinderGeometry(BR, BR + 0.05, BH, 32, 1, true); uvMetres(outer, 2 * Math.PI * BR / 1.5, BH / 1.5);
    add(outer, stoneM, cx, Y + BH / 2, cz, { cast: true });
    const inner = new THREE.CylinderGeometry(BR - 0.26, BR - 0.26, BH, 32, 1, true); uvMetres(inner, 2 * Math.PI * BR / 1.5, BH / 1.5);
    add(inner, parkMat(0x9d978a, "concrete"), cx, Y + BH / 2, cz).material.side = THREE.BackSide;
    const cope = new THREE.RingGeometry(BR - 0.3, BR + 0.08, 32); uvMetres(cope, 2, 2);
    add(cope, stoneM, cx, Y + BH + 0.005, cz, { rx: -Math.PI / 2 });
    add(new THREE.CircleGeometry(BR - 0.26, 28), parkMat(0x3b4644), cx, Y + 0.08, cz, { rx: -Math.PI / 2 });   // basin floor
    const water = add(new THREE.CircleGeometry(BR - 0.26, 28), parkWaterMat(), cx, Y + BH - 0.09, cz, { rx: -Math.PI / 2 });
    water.renderOrder = 1;
    add(new THREE.CylinderGeometry(0.2, 0.28, 0.95, 12), stoneM, cx, Y + 0.475, cz, { cast: true });
    const bowlY = Y + 0.95;
    add(new THREE.CylinderGeometry(0.78, 0.26, 0.24, 20), stoneM, cx, bowlY + 0.12, cz, { cast: true });
    add(new THREE.CylinderGeometry(0.12, 0.16, 0.45, 10), stoneM, cx, bowlY + 0.46, cz);
    add(new THREE.CylinderGeometry(0.34, 0.12, 0.12, 14), stoneM, cx, bowlY + 0.72, cz);
    const bowlWater = add(new THREE.CircleGeometry(0.72, 20), parkWaterMat(), cx, bowlY + 0.225, cz, { rx: -Math.PI / 2 });
    bowlWater.renderOrder = 1;
    const col = add(new THREE.CylinderGeometry(0.035, 0.05, 0.42, 8, 1, true), parkFallMat(), cx, bowlY + 0.98, cz);
    col.renderOrder = 2;
    const curtainH = bowlY + 0.2 - (Y + BH - 0.09);
    const curtain = add(new THREE.CylinderGeometry(0.8, 0.86, curtainH, 24, 1, true), parkFallMat(), cx, (Y + BH - 0.09) + curtainH / 2, cz);
    curtain.renderOrder = 2;
    CBZ.colliders.push({ minX: cx - BR, maxX: cx + BR, minZ: cz - BR, maxZ: cz + BR, ref: null, noCam: true, noBreach: true, y0: Y, y1: Y + BH + 0.05 });

    // BENCHES facing the fountain, set just off each path arm (kerb kit bench)
    const KK = CBZ.kerbKit ? (function () { try { return CBZ.kerbKit(); } catch (e) { return null; } })() : null;
    const VCM = CBZ.streetHW && CBZ.streetHW.hardwareMaterial ? CBZ.streetHW.hardwareMaterial(false) : null;
    const bo = Math.min(w, d) * 0.23;
    for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      // beside the path (1.9 m off its centre line), on the lawn, facing the fountain
      const bx = cx + sx * bo + (sx === 0 ? 2.0 : 0);
      const bz = cz + sz * bo + (sz === 0 ? 2.0 : 0);
      const face = Math.atan2(-sx, -sz);                 // +z of the bench toward the fountain
      if (KK && KK.bench && VCM) {
        for (const p of KK.bench.parts) add(p.geo, VCM, bx, Y + 0.012, bz, { ry: face, cast: true });
        const seatReg = CBZ.propRegisterSeat || CBZ.roomSeatAnchor;
        if (seatReg) {
          const tx = Math.cos(face), tz = -Math.sin(face);
          for (const l of [-0.6, 0, 0.6]) seatReg(bx + tx * l, Y + 0.012, bz + tz * l, face, "bench", lot, { cushion: 0.46, floorBelow: 0 });
        }
      }
    }
    // HEDGES: clipped box with a rounded top, leafy texture, broken at the mouths
    const hedgeM = parkMat(0x6f9a5a, "grass");
    const hw = lw / 2 - 0.9, hd = ld / 2 - 0.9, gap = 2.6;
    function hedge(len, x, z, alongX) {
      const body = new THREE.BoxGeometry(alongX ? len : 0.6, 0.55, alongX ? 0.6 : len);
      uvMetres(body, 1.5, 1.5);
      add(body, hedgeM, x, Y + 0.275, z, { cast: true });
      const top = new THREE.CylinderGeometry(0.3, 0.3, len, 10, 1, false, -Math.PI / 2, Math.PI);
      uvMetres(top, 1.5, len / 1.2);
      // the half-cylinder is the +z half about +y; lay it down so its axis
      // runs along the hedge and the round side faces up
      top.rotateX(-Math.PI / 2);                 // axis -> z, round side -> +y
      if (alongX) top.rotateY(Math.PI / 2);      // axis -> x
      add(top, hedgeM, x, Y + 0.55, z, { cast: true });
    }
    for (const s of [-1, 1]) {
      const L = hw - gap / 2, Ld = hd - gap / 2;
      for (const e of [-1, 1]) {
        hedge(L, cx + e * (gap / 2 + L / 2), cz + s * hd, true);
        hedge(Ld, cx + s * hw, cz + e * (gap / 2 + Ld / 2), false);
      }
    }
    // RAILING at the lot edge: 0.75 m steel pickets on two rails, gaps at the
    // path mouths, one merged vertex-coloured mesh per park
    if (CBZ.kerbBake && VCM) {
      try {
        const B = CBZ.kerbBake(), IRON = 0x24272a;
        const fx = w / 2 - 0.35, fz = d / 2 - 0.35, open = 2.6, H = 0.8;
        const runs = [];
        for (const s of [-1, 1]) {
          runs.push([-fx, s * fz, -open / 2, s * fz], [open / 2, s * fz, fx, s * fz]);
          runs.push([s * fx, -fz, s * fx, -open / 2], [s * fx, open / 2, s * fx, fz]);
        }
        for (const r of runs) {
          const x0 = r[0], z0 = r[1], x1 = r[2], z1 = r[3];
          const len = Math.hypot(x1 - x0, z1 - z0), ax = (x1 - x0) / len, az = (z1 - z0) / len;
          const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, ry = Math.atan2(ax, az);
          B.box(0.035, 0.035, len, IRON, mx, 0.16, mz, 0, ry, 0);
          B.box(0.045, 0.035, len, IRON, mx, H - 0.04, mz, 0, ry, 0);
          const n = Math.floor(len / 0.14);
          for (let k = 0; k <= n; k++) {
            const t = k / n, px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
            B.box(0.016, H - 0.02, 0.016, IRON, px, (H - 0.02) / 2, pz);
          }
          for (const t of [0, 1]) B.box(0.06, H + 0.08, 0.06, IRON, x0 + (x1 - x0) * t, (H + 0.08) / 2, z0 + (z1 - z0) * t);
          const cxr = cx + mx, czr = cz + mz, hx = Math.abs(ax) * len / 2 + 0.05, hz = Math.abs(az) * len / 2 + 0.05;
          CBZ.colliders.push({ minX: cxr - hx, maxX: cxr + hx, minZ: czr - hz, maxZ: czr + hz, ref: null, noCam: true, noBreach: true, y0: Y, y1: Y + H });
        }
        const rail = new THREE.Mesh(B.geo(), VCM);
        rail.position.set(cx, Y, cz); rail.castShadow = true; rail.receiveShadow = true; root.add(rail);
      } catch (e) { /* a railing is never worth a failed park */ }
    }

    // TREES in the lawn quadrants (clear of paths/fountain), from the tree
    // grammar + vegetation kit. 3 rng draws per tree, as before.
    const VK = CBZ.vegetationKit;
    const GRAM = !!(CBZ.treeCrownGeo && CBZ.treeTrunkGeo);
    const REG = !!(CBZ.CONFIG && CBZ.CONFIG.TREES_V2 !== false && CBZ.treeRegisterTree);
    if (REG && makePark._regRoot !== root && CBZ.treeAuditResetSite) {
      CBZ.treeAuditResetSite("park"); makePark._regRoot = root;   // reset once per world build
    }
    const trunkM = VK ? VK.material("wood", 0x86674a) : parkMat(0x6b4a2a);
    const leafMs = VK ? [VK.material("foliage", 0x5f9a4c), VK.material("foliage", 0x6fa452)] : [parkMat(0x3f7d3a), parkMat(0x4f9942)];
    let vi = 0;
    for (const [qx, qz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = cx + qx * w * 0.28 + (rng() - 0.5) * 2.0;
      const z = cz + qz * d * 0.28 + (rng() - 0.5) * 2.0;
      lot.groundTrees.push({ x, z });                    // the painted mulch ring (city/cityground.js)
      const th = 2.2 + rng() * 1.0;                     // trunk height to the crown
      const hv = CBZ.hash01 ? CBZ.hash01(x, z, 9103) : 0.5;
      const conifer = (vi++ % 2 === 0);
      const trunkH = th + 1.0;
      const r0 = conifer ? 1.7 + hv * 0.4 : 2.1 + hv * 0.6, h0 = conifer ? 4.4 : 3.6 + hv * 0.8;
      if (GRAM) {
        const tg = CBZ.treeTrunkGeo({ rTop: 0.12, rBase: 0.22, h: trunkH, seg: 7, roots: 5, rise: 0.25, dip: 0.05, spread: 1.8,
          flare: 1.45, uvRepeat: 3, site: "park" });
        const t = add(tg, trunkM, x, Y, z, { cast: true, ry: hv * 6.28 });
        const cg = CBZ.treeCrownGeo({ tiers: conifer ? 3 : 2, r: r0, h: h0, seg: 7, taper: 0.66, site: "park", leaf: !!VK, cards: conifer ? 16 : 18, seed: (hv * 1000) | 0 });
        const c = add(cg, leafMs[vi % 2], x, Y + th - 0.3, z, { cast: true, ry: hv * 6.28 });
        if (VK && cg.userData && cg.userData.leafCards && VK.depthMaterial) c.customDepthMaterial = VK.depthMaterial("foliage");
        CBZ.colliders.push({ minX: x - 0.28, maxX: x + 0.28, minZ: z - 0.28, maxZ: z + 0.28, ref: t, noCam: true, noBreach: true });
      } else {
        const t = add(new THREE.CylinderGeometry(0.16, 0.24, trunkH, 7), trunkM, x, Y + trunkH / 2, z, { cast: true });
        add(new THREE.ConeGeometry(r0, h0, 8), leafMs[vi % 2], x, Y + th + h0 / 2 - 0.3, z, { cast: true });
        CBZ.colliders.push({ minX: x - 0.28, maxX: x + 0.28, minZ: z - 0.28, maxZ: z + 0.28, ref: t, noCam: true, noBreach: true });
      }
      if (REG) CBZ.treeRegisterTree("park", Y, [x - 0.22, Y - 0.05, z - 0.22, x + 0.22, Y + trunkH, z + 0.22,
        x - r0, Y + th - 0.3, z - r0, x + r0, Y + th - 0.3 + h0, z + r0]);
    }
  }

  // ============================================================
  //  SHOPLIFT (CBZ.CONFIG.SHOPS_ROBBABLE_V1, default ON) — the audit's #2 WIRE-IT:
  //  "grab stock off a shelf when the clerk can't see you." Every shop's wall
  //  shelves + gondolas (recorded on lot.building.shoplift during furnishShop)
  //  become petty-theft SOURCES. Face a shelf, [E] to pocket one unit:
  //    • CLEAR (the posted clerk can't see the shelf) → a seeded few dollars
  //      (CBZ.hash01 per shelf) and the shelf DEPLETES for the session. No heat.
  //    • MADE (the clerk's gaze cone covers the shelf, with a real
  //      clearLineOfFire check — jewelry.js's clerkSees) → a real theft charge
  //      (CBZ.cityCrime, reported so the clerk "calls it in") + a clerk/ped panic
  //      (CBZ.cityPanic). Both ride the NORMAL wanted/ped flow — no bespoke code.
  //  Flagship gun/jewelry lots run their own richer smash/pry/buy, so they're
  //  skipped. Reuses: clerk-LOS + look-pick + [E]-capture (jewelry.js),
  //  cityCrime + cityPanic (wanted + peds), CBZ.city.addCash (the econ faucet).
  // ============================================================
  (function shopliftSystem() {
    const REACH = 2.4;          // arm's length at the shelf
    const LOOK_DOT = 0.35;      // you act on the shelf you're facing
    const CLERK_R = 14;         // the clerk's watch radius (matches jewelry)
    // resale value band per trade (min,max $): ice/electronics pay, snacks don't.
    const VAL = { electronics: [40, 190], jewelry: [140, 900], pawn: [30, 240], guns: [60, 300],
      hardware: [6, 34], gas: [3, 16], food: [3, 15], clothing: [16, 110], drugs: [50, 260],
      hospital: [14, 80], security: [24, 140], bar: [8, 44], casino: [8, 44], carlot: [18, 90],
      chop: [18, 90], barber: [5, 24], gym: [7, 30], cityhall: [10, 60] };
    // a flavour word for what you pocketed, per trade.
    const ITEM = { electronics: "a gadget", jewelry: "a piece", pawn: "some swag", guns: "some ammo",
      hardware: "some hardware", gas: "some snacks", food: "some food", clothing: "some threads",
      drugs: "some product", hospital: "some meds", security: "some gear", bar: "a bottle",
      casino: "some chips", carlot: "a part", chop: "a part", barber: "supplies", gym: "supplies",
      cityhall: "some files" };

    function G() { return CBZ.game; }
    function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
    function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s); }
    function isOn() { return !CBZ.CONFIG || CBZ.CONFIG.SHOPS_ROBBABLE_V1 !== false; }
    function remaining(sh) { return Math.max(0, (sh.n0 | 0) - (sh.taken | 0)); }
    function clerkName(lot) { const v = lot.building && lot.building.vendor; return (v && v.name) || "The clerk"; }
    // a lot a flagship module owns runs its own in-world verbs → skip it.
    function flagship(lot) { return !!(lot.building && (lot.building.jewelry || lot.building.gunstore)); }

    // the posted clerk's eyes on a shelf spot — alive, close, spot inside their
    // forward cone, and nothing solid between (jewelry.js clerkSees shape).
    function clerkSees(lot, x, z) {
      const v = lot.building && lot.building.vendor;
      if (!v || v.dead || !v.pos) return false;
      const dx = x - v.pos.x, dz = z - v.pos.z, d = Math.hypot(dx, dz);
      if (d > CLERK_R) return false;
      if (d > 0.4) {
        const ry = v.group ? v.group.rotation.y : 0;
        const fx = Math.sin(ry), fz = Math.cos(ry);                 // ped forward
        if ((dx / d) * fx + (dz / d) * fz < 0.25) return false;     // shelf is behind them
      }
      if (CBZ.clearLineOfFire && !CBZ.clearLineOfFire(v.pos.x, (v.pos.y || 0) + 1.6, v.pos.z, x, 1.2, z)) return false;
      return true;
    }
    function seedVal(sh) {
      const band = VAL[sh.kind] || [5, 30];
      const h = CBZ.hash01 ? CBZ.hash01(sh.x, sh.z, 0x9e11 + (sh.taken | 0) * 7) : 0.5;
      return Math.round(band[0] + h * (band[1] - band[0]));
    }

    // THE SHELVES ARE CANDIDATES (city/interactions.js registerFixtures): the
    // shelves of every robbable shop near the point asked about. E pockets the
    // one you face, a tap on one does the same. No private prompt, no private
    // E listener. Each shelf remembers its lot for the clerk's eyes.
    const _near = [];
    function shelvesNear(px, pz) {
      _near.length = 0;
      const arena = CBZ.city && CBZ.city.arena;
      const lots = arena && arena.lots; if (!lots) return _near;
      for (let i = 0; i < lots.length; i++) {
        const lot = lots[i];
        if (!lot || !lot.building || lot.demolished) continue;
        const shs = lot.building.shoplift; if (!shs || !shs.length || flagship(lot)) continue;
        if (Math.abs(px - lot.cx) > 40 || Math.abs(pz - lot.cz) > 40) continue;   // cheap cull
        for (let s = 0; s < shs.length; s++) { shs[s]._lot = lot; _near.push(shs[s]); }
      }
      return _near;
    }
    let fixturesWired = false;
    function wireFixtures() {
      if (fixturesWired || !CBZ.interactions || !CBZ.interactions.registerFixtures) return;
      fixturesWired = true;
      CBZ.interactions.registerFixtures({
        id: "shop-shelf", kind: "shop-shelf", prio: 7,
        list: function (ctx, px, pz) { return isOn() ? shelvesNear(px, pz) : null; },
        reach: function () { return REACH; },
        dot: function () { return LOOK_DOT; },
        verbs: [
          { id: "shelf-pocket", slot: "e", prio: 5, bad: true, forceYes: true, label: "Pocket",
            canShow: (sh) => remaining(sh) > 0, onSelect: (sh) => { grab(sh, sh._lot); } },
        ],
      });
    }
    function pick() {
      const cur = CBZ.interactions && CBZ.interactions.currentCand ? CBZ.interactions.currentCand() : null;
      return cur && cur.kind === "shop-shelf" ? cur.t : null;
    }

    function grab(sh, lot) {
      if (!sh || !lot) return { took: false };
      if (remaining(sh) <= 0) { note("Shelf's picked clean.", 1.4); return { took: false, empty: true }; }
      // MADE: the clerk is watching this shelf → a real theft charge (reported,
      // so the clerk "calls it in" → wanted) + a clerk/ped panic. No item lifted.
      if (clerkSees(lot, sh.x, sh.z)) {
        note("" + clerkName(lot) + " saw you, put it back!", 2);
        if (CBZ.cityCrime) CBZ.cityCrime(65, { type: "theft", x: sh.x, z: sh.z, instant: true });
        const v = lot.building.vendor;
        if (CBZ.cityPanic && v && v.pos) CBZ.cityPanic(v.pos.x, v.pos.z, 1.4, CBZ.city && CBZ.city.playerActor);
        return { took: false, caught: true };
      }
      // CLEAR: pocket one unit for seeded petty cash; deplete the shelf. The
      // unit is claimed now (the count drops, nobody takes it twice) and the
      // hand goes to the shelf for it (systems/verbs_pickup.js); the cash and
      // the line land when the hand closes on it.
      const val = seedVal(sh);
      sh.taken = (sh.taken | 0) + 1;
      const left = remaining(sh);
      const took = function () {
        if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(val);
        if (CBZ.sfx) CBZ.sfx("coin");
        note("Pocketed " + (ITEM[sh.kind] || "some stock") + ", " + fmt$(val) +
          (left > 0 ? ", " + left + " left on the shelf" : ", shelf cleared"), 2);
      };
      const P = CBZ.player, V = CBZ.verbs;
      if (V && V.pickup && P && P.pos) {
        V.pickup(P, { x: sh.x, y: (sh.y != null ? sh.y : (P.pos.y || 0) + 1.0), z: sh.z, kind: "box" }, { key: sh, pose: "grip", onTaken: took });
      } else took();
      return { took: true, value: val, left: left };
    }

    wireFixtures();
    if (!fixturesWired && CBZ.onUpdate) CBZ.onUpdate(38.5, function () { wireFixtures(); });

    // ---- headless / harness handles (gunstore-style) ----
    CBZ.cityShopliftState = function () {
      const sh = pick();
      return { target: sh ? { x: sh.x, z: sh.z, kind: sh.kind, left: remaining(sh) } : null,
               watched: !!(sh && sh._lot && clerkSees(sh._lot, sh.x, sh.z)) };
    };
    // grab from the shelf currently in reach/aim (same as pressing [E]); returns
    // {took, caught, value, left} so a probe can assert LOS + depletion.
    CBZ.cityShopliftGrab = function () { const sh = pick(); return grab(sh, sh && sh._lot); };
    // enumerate the robbable shelves of the nearest shop (probes / tools).
    CBZ.cityShopliftShelves = function () {
      const arena = CBZ.city && CBZ.city.arena, lots = arena && arena.lots;
      if (!lots || !CBZ.player) return [];
      const px = CBZ.player.pos.x, pz = CBZ.player.pos.z; let bestLot = null, bd = 1e9;
      for (let i = 0; i < lots.length; i++) { const lot = lots[i]; if (!lot || !lot.building || !lot.building.shoplift || flagship(lot)) continue; const d = Math.hypot(px - lot.cx, pz - lot.cz); if (d < bd) { bd = d; bestLot = lot; } }
      if (!bestLot) return [];
      return bestLot.building.shoplift.map(function (sh) { return { x: sh.x, z: sh.z, kind: sh.kind, n0: sh.n0, taken: sh.taken, left: remaining(sh) }; });
    };
    // ---- THE TWO PIECES A REAL-GOODS SHELF NEEDS FROM THIS SYSTEM ----------
    // city/storegoods.js stands the store's actual stock on the same shelves
    // this runtime recorded, so the goods it hands you are real items rather
    // than a flavour word and a few dollars. What it must NOT do is re-type the
    // clerk's eyes or the theft charge — that is the whole reason a lifted item
    // costs anything. Both are published here, from the ONE implementation.
    //   clerkSees(lot,x,z) — is the posted clerk watching this spot right now?
    //   theft(lot,x,z)     — you were MADE: the same reported charge + the same
    //                        clerk/ped panic the flavour-word grab fires.
    // Returns true when it busted you (the caller must then take nothing).
    CBZ.cityShopClerkSees = function (lot, x, z) { return !!(lot && clerkSees(lot, x, z)); };
    CBZ.cityShopTheftSeen = function (lot, x, z) {
      if (!lot || !clerkSees(lot, x, z)) return false;
      note("" + clerkName(lot) + " saw you, put it back!", 2);
      if (CBZ.cityCrime) CBZ.cityCrime(65, { type: "theft", x: x, z: z, instant: true });
      const v = lot.building && lot.building.vendor;
      if (CBZ.cityPanic && v && v.pos) CBZ.cityPanic(v.pos.x, v.pos.z, 1.4, CBZ.city && CBZ.city.playerActor);
      return true;
    };
  })();
})();
