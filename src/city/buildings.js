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

  // FLOOR-TO-FLOOR — sized off the CHARACTER, not habit. The rig in
  // entities/character.js crowns at ~2.5 (head top 2.48, hair/cap ~2.6), so a
  // storey needs ~1.7-1.9x that in CLEAR air to read as a real floor: 4.6
  // minus the 0.2 interior slab = 4.4 clear ≈ 1.76x. (The old 4.0 left ~1.5x —
  // ceilings grazed heads and towers read as stacked shoeboxes next to people.)
  // Mirrored by city/elevators.js (fire-escape flights); everything in this
  // file derives from FH — never hardcode a multiple of it.
  const FH = 4.6;      // floor-to-floor
  // pedestrian DOORWAY/HEADER height — PERSON-scaled on purpose, so it does
  // NOT ride FH: a door ~1.3x the 2.5 person reads right whatever the ceiling
  // does. 3.3 equals the old FH-0.7 opening, so door leafs, colliders and the
  // entrance dressing all sit exactly where they always did.
  const DOORH = 3.3;
  const WT = 0.4;      // wall thickness
  const SW = 5.6;      // two generous stair lanes; narrow stairs snag characters at speed
  const DOORW = 2.2;   // doorway width
  const GLASS = 0x9fd8ee;

  // ---- SHATTERABLE GLASS (city-wide) ------------------------------------
  // Every window pane registers here so a crash / blast / gunshot can burst
  // it: the pane hides — and SOLID showroom glass also drops its collider so
  // you can drive straight THROUGH the hole — while a few glass shards rain
  // down. One shared translucent material + shard geometry keep it cheap.
  const cityGlass = [], cityShards = [];
  let shatteredPanes = 0;   // live count of open holes (fast-path for cityShotHole)
  let _gmat = null, _shardGeo = null, _shardGeoBig = null, _crackTex = null;
  function glassMat() { return _gmat || (_gmat = new THREE.MeshLambertMaterial({ color: 0xbfe9f7, emissive: 0x3f8aa6, emissiveIntensity: 0.5, transparent: true, opacity: 0.6 })); }
  function shardGeo() { return _shardGeo || (_shardGeo = new THREE.BoxGeometry(0.22, 0.3, 0.05)); }
  function shardGeoBig() { return _shardGeoBig || (_shardGeoBig = new THREE.BoxGeometry(0.4, 0.52, 0.05)); }

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
    // partition by tint THEN kind (0=clear, 1=reflective) — one InstancedMesh
    // per (tint, kind) bucket so reflective offices and see-through retail both
    // stay pooled. At most GLASS_TINTS*2 (+lit) = 7 city-wide draw calls.
    const byBucket = [[], [], [], [], [], []], litRecs = [];   // [tint*2 + kind]
    for (const r of batch) { byBucket[r.tint * 2 + (r.kind === "reflective" ? 1 : 0)].push(r); if (r.lit) litRecs.push(r); r._grp = null; }
    for (let t = 0; t < GLASS_TINTS; t++) {
      for (let kn = 0; kn < 2; kn++) {
        const recs = byBucket[t * 2 + kn]; if (!recs.length) continue;
        const im = new THREE.InstancedMesh(unitBox(), kn ? rmats[t] : mats[t], recs.length);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.castShadow = false; im.receiveShadow = false; im.renderOrder = 1;
        im.frustumCulled = false;       // instances span the city; the unit-box bound would cull them all
        im.userData.glassPool = true;
        for (let i = 0; i < recs.length; i++) {
          const r = recs[i]; r.pool = im; r.inst = i;
          im.setMatrixAt(i, r.shattered ? _zeroM : paneMatrix(r));
        }
        im.instanceMatrix.needsUpdate = true;
        root.add(im); glassPools.push(im);
      }
    }
    if (litRecs.length) {
      const lp = new THREE.InstancedMesh(unitBox(), litWinMat(), litRecs.length);
      lp.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      lp.castShadow = false; lp.receiveShadow = false; lp.renderOrder = 1;
      lp.frustumCulled = false; lp.userData.glassPool = true;
      for (let i = 0; i < litRecs.length; i++) {
        const r = litRecs[i]; r.litPool = lp; r.litId = i;
        lp.setMatrixAt(i, _zeroM);    // lit pool stays dark until dusk
      }
      lp.instanceMatrix.needsUpdate = true;
      root.add(lp); glassPools.push(lp);
    }
    // a build landing mid-night flips its lit panes on immediately
    if (glassNightOn) for (const r of litRecs) if (!r.shattered) paneShow(r, true);
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
    const byKind = { sky: [], mull: [] };
    for (const r of batch) { (byKind[r.kind] || byKind.mull).push(r); r._grp = null; }
    [["sky", 0xd6e6f2], ["mull", 0x262b31]].forEach(function (kc) {
      const recs = byKind[kc[0]]; if (!recs.length) return;
      const m = CBZ.cmat ? CBZ.cmat(kc[1]) : new THREE.MeshLambertMaterial({ color: kc[1] });
      const im = new THREE.InstancedMesh(unitBox(), m, recs.length);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = false; im.receiveShadow = false;
      im.frustumCulled = false;       // instances span the city
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i]; r.pool = im; r.inst = i;
        im.setMatrixAt(i, r.hidden ? _zeroM : decoMatrix(r));
      }
      im.instanceMatrix.needsUpdate = true;
      root.add(im); glassPools.push(im);   // rides the same lifecycle as the pane pools
    });
  }
  // PUBLIC: swap the ~15% "someone's home" panes between their day tint and
  // the warm lit pool. Idempotent; self-driven below on view.js's hysteresis
  // thresholds, but exposed so the dusk pass can call it directly too.
  CBZ.cityGlassNight = function (on) {
    on = !!on;
    if (on === glassNightOn) return;
    glassNightOn = on;
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
    const rec = { mesh: null, pool: null, inst: -1, litPool: null, litId: -1, lit: false,
      tint: (o.tint || 0) % GLASS_TINTS,
      kind: o.kind === "reflective" ? "reflective" : "clear",   // pooled-pane glass kind (see-through vs mirror-ish)
      x: ox + lx, y: ly, z: oz + lz, span: Math.max(pw, pd) * 0.5, hw: pw / 2, hh: ph / 2, hd: pd / 2,
      shattered: false, col: null };
    if (o.solid || o.external) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), glassMat());
      m.position.set(lx, ly, lz); m.castShadow = false; m.receiveShadow = false; m.renderOrder = 1;
      group.add(m); rec.mesh = m;
      if (o.solid) {
        const c = { minX: ox + lx - pw / 2, maxX: ox + lx + pw / 2, minZ: oz + lz - pd / 2, maxZ: oz + lz + pd / 2, ref: m, y0: ly - ph / 2, y1: ly + ph / 2 };
        CBZ.colliders.push(c); rec.col = c;
      }
    } else {
      // pooled pane. ~15% are flagged "lit after dusk" — deterministic per
      // world position so the night skyline doesn't reshuffle every run.
      const hsh = Math.sin(rec.x * 12.9898 + rec.y * 78.233 + rec.z * 37.719) * 43758.5453;
      rec.lit = (hsh - Math.floor(hsh)) < 0.15;
      rec._grp = group;
      pendingGlass.push(rec);
    }
    cityGlass.push(rec); if (list) list.push(rec);
    return rec.mesh;
  }
  // lay a fading spider-crack decal flat over a pane (just before it bursts).
  // Cheap: a single quad on a shared material, pooled and capped.
  function crackPane(gp, hx, hy, hz) {
    if (gp.shattered || gp.cracked || crackQuads.length > 24) return;
    gp.cracked = true;
    const horiz = gp.hd < gp.hw;   // pane wider in X than Z → faces ±Z
    const sz = Math.min(1.5, Math.max(0.7, gp.span));
    const q = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), crackMat());
    const px = hx != null ? hx : gp.x, py = hy != null ? hy : gp.y, pz = hz != null ? hz : gp.z;
    if (horiz) { q.position.set(px, py, gp.z + (gp.z >= 0 ? 0.05 : -0.05)); }
    else { q.position.set(gp.x + (gp.x >= 0 ? 0.05 : -0.05), py, pz); q.rotation.y = Math.PI / 2; }
    q.renderOrder = 3;
    CBZ.scene.add(q);
    crackQuads.push({ mesh: q, gp, life: 0.45 + Math.random() * 0.25, fade: 0 });
  }
  function burstPane(gp) {
    if (gp.shattered) return;
    gp.shattered = true; shatteredPanes++;
    if (gp.mesh) gp.mesh.visible = false;
    else paneShow(gp, false);          // pooled pane: zero its instance matrix
    if (gp.col) { const i = CBZ.colliders.indexOf(gp.col); if (i >= 0) CBZ.colliders.splice(i, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
    // clear any lingering crack decal for this pane
    for (let i = crackQuads.length - 1; i >= 0; i--) if (crackQuads[i].gp === gp) { CBZ.scene.remove(crackQuads[i].mesh); crackQuads.splice(i, 1); }
    if (cityShards.length > 360) return;
    // raining shards: a mix of big jagged plates and small chips, span-scaled,
    // biased to fall outward from the pane plane for a real "blown out" look.
    const big = Math.max(2, Math.min(7, Math.round(gp.span * 1.6)));
    const small = 3 + ((Math.random() * 4) | 0);
    const horiz = gp.hd < gp.hw, outN = horiz ? (gp.z >= 0 ? 1 : -1) : (gp.x >= 0 ? 1 : -1);
    for (let i = 0; i < big + small; i++) {
      const isBig = i < big;
      const sh = new THREE.Mesh(isBig ? shardGeoBig() : shardGeo(), glassMat());
      const sc = isBig ? 0.8 + Math.random() * 0.7 : 0.6 + Math.random() * 0.5;
      sh.scale.set(sc, sc * (0.7 + Math.random() * 0.8), 1);
      sh.position.set(gp.x + (Math.random() - 0.5) * gp.span * 2, gp.y + (Math.random() - 0.5) * Math.max(0.7, gp.span), gp.z + (Math.random() - 0.5) * 0.4);
      sh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      CBZ.scene.add(sh);
      const lateral = horiz ? 0 : (Math.random() - 0.5) * 3, lateralZ = horiz ? (Math.random() - 0.5) * 3 : 0;
      cityShards.push({
        mesh: sh,
        vx: lateral + (horiz ? (Math.random() - 0.5) * 3 : outN * (0.8 + Math.random() * 2.2)),
        vy: 0.8 + Math.random() * 3.0,
        vz: lateralZ + (horiz ? outN * (0.8 + Math.random() * 2.2) : (Math.random() - 0.5) * 3),
        spin: (Math.random() - 0.5) * 11, life: 1.2 + Math.random() * 0.8,
      });
    }
  }
  // burst every intact pane within r of (x,z) — called on car crashes etc.
  // SWISS CHEESE: a blast doesn't just clear glass — up to PER_BLAST_OPEN of the
  // nearest WINDOW-SIZED panes carve into real see-through holes/rooms, so a
  // rocket peppers a facade with openings (the wall `_breached` dedup keeps
  // same-face panes from carving twice → bounded cost, no cache/cleanup).
  const PER_BLAST_OPEN = 8;
  CBZ.cityShatter = function (x, z, r) {
    const r2 = r * r; let n = 0, near = null, nearD = 1e9;
    const cand = [];   // window-sized in-radius panes eligible to carve an opening
    for (let i = 0; i < cityGlass.length; i++) {
      const gp = cityGlass[i]; if (gp.shattered) continue;
      const dx = gp.x - x, dz = gp.z - z, dd = dx * dx + dz * dz;
      if (dd <= r2) {
        // gather BEFORE bursting (burstPane marks shattered): pooled (no mesh),
        // above the sill, window-sized — so we open windows, not transoms
        if (!gp.mesh && gp.y > 1.0 && Math.max(gp.hw, gp.hd) * 2 >= 0.7) cand.push({ gp, dd });
        burstPane(gp); if (dd < nearD) { nearD = dd; near = gp; } if (++n > 50) break;
      }
    }
    // open the nearest few as real holes/rooms; tryWindowOpening reads the
    // pane's stored x/y/z (it doesn't care that the pane is now "shattered"),
    // and carveHole's wall `_breached` flag makes same-face panes a no-op carve
    cand.sort(function (a, b) { return a.dd - b.dd; });
    const lim = Math.min(PER_BLAST_OPEN, cand.length);
    for (let i = 0; i < lim; i++) tryWindowOpening(cand[i].gp);
    if (!lim && near) tryWindowOpening(near);   // fallback: nearest pane (sub-window slivers only)
    if (n > 0 && CBZ.sfx) CBZ.sfx("glass");
    // a hard impact (big radius shatter = a car ploughing a storefront) also
    // knocks a couple of concrete chunks off and leaves no scorch — just rubble.
    if (r >= 7 && CBZ.cityChunk) CBZ.cityChunk(x, (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + 0.8, z, { count: 2 + ((Math.random() * 2) | 0), force: 3 });
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
  CBZ.cityShatterRay = function (ox, oy, oz, dx, dy, dz, maxDist, force) {
    const nl = Math.hypot(dx, dy, dz) || 1; dx /= nl; dy /= nl; dz /= nl;
    const lim = maxDist != null ? maxDist : 1e9;
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
      const tEnter = tmin > 0 ? tmin : 0;               // clamp the muzzle-inside case forward
      const tExit = tmax < lim ? tmax : lim;            // bounded by the round's reach
      if (tExit <= 1e-5 || tExit <= tEnter) continue;   // pane is at/behind the muzzle, or no forward extent → not crossed
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
      if (force || best.cracked || best.col) { burstPane(best); tryWindowOpening(best); if (CBZ.sfx) CBZ.sfx("glass"); }
      else { crackPane(best, bestHX, bestHY, bestHZ); if (CBZ.sfx) CBZ.sfx("glass"); spawnGlassChip(bestHX, bestHY, bestHZ); }
    }
    return best;
  };
  // one or two tiny shards spit off the impact point of a single bullet
  function spawnGlassChip(x, y, z) {
    if (cityShards.length > 360) return;
    const n = 1 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const sh = new THREE.Mesh(shardGeo(), glassMat());
      sh.scale.setScalar(0.5 + Math.random() * 0.4);
      sh.position.set(x, y, z); sh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      CBZ.scene.add(sh);
      cityShards.push({ mesh: sh, vx: (Math.random() - 0.5) * 2, vy: 0.6 + Math.random() * 1.4, vz: (Math.random() - 0.5) * 2, spin: (Math.random() - 0.5) * 10, life: 0.9 });
    }
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
    for (let i = 0; i < cityGlass.length; i++) {
      const gp = cityGlass[i];
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
  CBZ.cityGlassReset = function () {
    shatteredPanes = 0;
    for (const gp of cityGlass) {
      if (gp.shattered) {
        gp.shattered = false;
        if (gp.mesh) gp.mesh.visible = true;
        else paneShow(gp, true);       // pooled pane: restore (honours night state)
        if (gp.col && CBZ.colliders.indexOf(gp.col) === -1) CBZ.colliders.push(gp.col);
      }
      gp.cracked = false;
    }
    // interior band dressing hidden by wall carves comes back with the glass
    for (let i = 0; i < roomDeco.length; i++) if (roomDeco[i].hidden) decoShow(roomDeco[i], true);
    for (const s of cityShards) CBZ.scene.remove(s.mesh);
    cityShards.length = 0;
    for (const cq of crackQuads) { CBZ.scene.remove(cq.mesh); if (cq.mesh.material) cq.mesh.material.dispose(); cq.mesh.geometry.dispose(); }
    crackQuads.length = 0;
    CBZ.cityDamageReset && CBZ.cityDamageReset();
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
          if (cq.gp) cq.gp.cracked = false;   // pane re-heals (decal gone)
          crackQuads.splice(i, 1);
        }
      }
    }
    if (!cityShards.length) return;
    const G = (CBZ.TUNE && CBZ.TUNE.gravity) || 22;
    for (let i = cityShards.length - 1; i >= 0; i--) {
      const s = cityShards[i]; s.life -= dt; s.vy -= G * dt;
      const p = s.mesh.position;
      p.x += s.vx * dt; p.y += s.vy * dt; p.z += s.vz * dt;
      s.mesh.rotation.x += s.spin * dt; s.mesh.rotation.z += s.spin * 0.6 * dt;
      const fl = (CBZ.floorAt ? CBZ.floorAt(p.x, p.z) : 0) + 0.04;
      if (p.y <= fl) { p.y = fl; s.vy = 0; s.vx *= 0.3; s.vz *= 0.3; s.spin *= 0.3; }
      if (s.life <= 0) { CBZ.scene.remove(s.mesh); cityShards.splice(i, 1); }
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
  // a darkened wall-colour variant (plinths/cornices/pilasters) — derived from
  // the shared palettes so trim colours bucket together for the batcher.
  function shadeHex(hex, f) {
    const r = Math.min(255, (((hex >> 16) & 255) * f) | 0);
    const g = Math.min(255, (((hex >> 8) & 255) * f) | 0);
    const b = Math.min(255, ((hex & 255) * f) | 0);
    return (r << 16) | (g << 8) | b;
  }

  // ---- BUILDING DAMAGE: bullet holes, scorch marks, knocked-off chunks ----
  // A fixed POOL of dark decal quads. Each impact reuses the oldest slot once
  // the cap is hit (FPS-style decal budget) so memory/draw cost stays flat. One
  // shared dark material + one shared scorch material; chunks share box geo.
  const BULLET_CAP = 110, SCORCH_CAP = 40;
  const bulletPool = [], scorchPool = [];
  let bulletIdx = 0, scorchIdx = 0;
  let _holeGeo = null, _holeMat = null, _scorchTex = null, _scorchMat = null, _chunkGeo = null, _chunkMat = null;
  const cityChunks = [];
  function holeGeo() { return _holeGeo || (_holeGeo = new THREE.PlaneGeometry(0.3, 0.3)); }
  // a soft dark bullet-pit texture (dark core + cracked ring) painted once
  function holeMat() {
    if (_holeMat) return _holeMat;
    const c = document.createElement("canvas"); c.width = 64; c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 1, 32, 32, 30);
    g.addColorStop(0, "rgba(8,8,10,0.95)"); g.addColorStop(0.45, "rgba(20,20,24,0.8)");
    g.addColorStop(0.7, "rgba(40,40,46,0.35)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    x.strokeStyle = "rgba(15,15,18,0.5)"; x.lineWidth = 1.4; x.lineCap = "round";
    for (let i = 0; i < 7; i++) { const a = i / 7 * 6.28 + i; x.beginPath(); x.moveTo(32, 32); x.lineTo(32 + Math.cos(a) * (16 + i * 2), 32 + Math.sin(a) * (16 + i * 2)); x.stroke(); }
    const t = new THREE.CanvasTexture(c);
    _holeMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    return _holeMat;
  }
  function scorchMat() {
    if (_scorchMat) return _scorchMat;
    const c = document.createElement("canvas"); c.width = 64; c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, "rgba(6,6,7,0.92)"); g.addColorStop(0.5, "rgba(18,16,15,0.7)");
    g.addColorStop(0.8, "rgba(35,28,24,0.3)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    // a few soot licks
    x.fillStyle = "rgba(10,9,8,0.55)";
    for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28 + i * 0.7, r = 18 + (i * 7 % 12); x.beginPath(); x.ellipse(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 5, 9, a, 0, 6.3); x.fill(); }
    const t = new THREE.CanvasTexture(c);
    _scorchMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    return _scorchMat;
  }
  function chunkGeo() { return _chunkGeo || (_chunkGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4)); }
  function chunkMat() { return _chunkMat || (_chunkMat = new THREE.MeshLambertMaterial({ color: 0x7c828b })); }
  // orient a decal quad so its +Z faces along the surface normal (nx,ny,nz)
  const _nrm = new THREE.Vector3(), _q = new THREE.Quaternion(), _zAxis = new THREE.Vector3(0, 0, 1);
  function aimDecal(mesh, nx, ny, nz) {
    _nrm.set(nx, ny, nz); if (_nrm.lengthSq() < 1e-6) _nrm.set(0, 0, 1); _nrm.normalize();
    _q.setFromUnitVectors(_zAxis, _nrm); mesh.quaternion.copy(_q);
  }

  // PUBLIC: pool a small dark bullet-hole decal on a wall at (x,y,z) facing the
  // surface normal (nx,ny,nz). Called by the shooting/impact code when a shot
  // hits a building surface (not glass). Reuses the oldest decal past the cap.
  CBZ.cityBulletHole = function (x, y, z, nx, ny, nz) {
    if (!CBZ.scene) return null;
    let m;
    if (bulletPool.length < BULLET_CAP) {
      m = new THREE.Mesh(holeGeo(), holeMat());
      m.renderOrder = 4; CBZ.scene.add(m); bulletPool.push(m);
    } else {
      m = bulletPool[bulletIdx]; bulletIdx = (bulletIdx + 1) % BULLET_CAP; m.visible = true;
    }
    // nudge a hair off the wall along the normal so it never z-fights
    const off = 0.02;
    m.position.set(x + (nx || 0) * off, y + (ny || 0) * off, z + (nz || 0) * off);
    aimDecal(m, nx || 0, ny || 0, nz || 1);
    const s = 0.7 + Math.random() * 0.7; m.scale.set(s, s, s);
    m.rotateZ(Math.random() * Math.PI);
    return m;
  };

  // PUBLIC: lay scorch marks from an explosion at (x,z) within radius r — a big
  // soot disc on the ground + soot on any building walls the blast can reach.
  CBZ.cityScorch = function (x, z, r) {
    if (!CBZ.scene) return;
    const place = (px, py, pz, nx, ny, nz, scale) => {
      let m;
      if (scorchPool.length < SCORCH_CAP) { m = new THREE.Mesh(holeGeo(), scorchMat()); m.renderOrder = 2; CBZ.scene.add(m); scorchPool.push(m); }
      else { m = scorchPool[scorchIdx]; scorchIdx = (scorchIdx + 1) % SCORCH_CAP; m.visible = true; }
      m.position.set(px, py, pz); aimDecal(m, nx, ny, nz); m.rotateZ(Math.random() * Math.PI);
      m.scale.set(scale, scale, scale);
    };
    // ground scorch (faces up)
    const fy = (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + 0.03;
    place(x, fy, z, 0, 1, 0, (r || 3) * 1.6 + 2);
    // soot a few of the nearest wall colliders that face the blast
    const r2 = (r || 3) * (r || 3) * 2.2; let n = 0;
    for (let i = 0; i < CBZ.colliders.length && n < 4; i++) {
      const c = CBZ.colliders[i]; if (c.y1 == null) continue;
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      const dx = cx - x, dz = cz - z, dd = dx * dx + dz * dz;
      if (dd > r2 || dd < 0.5) continue;
      const wx = c.maxX - c.minX, wz = c.maxZ - c.minZ;
      // pick the broad face nearest the blast as the scorch plane
      let nx = 0, nz = 0, sx = cx, sz = cz;
      if (wx >= wz) { nz = dz < 0 ? -1 : 1; sz = nz < 0 ? c.minZ - 0.05 : c.maxZ + 0.05; sx = Math.max(c.minX, Math.min(c.maxX, x)); }
      else { nx = dx < 0 ? -1 : 1; sx = nx < 0 ? c.minX - 0.05 : c.maxX + 0.05; sz = Math.max(c.minZ, Math.min(c.maxZ, z)); }
      const sy = Math.max(c.y0 + 0.4, Math.min(c.y1 - 0.4, fy + 1.0));
      place(sx, sy, sz, nx, 0, nz, (r || 3) * 0.7 + 1.4); n++;
    }
  };

  // PUBLIC: knock physical concrete CHUNKS off a surface on a big hit (blast /
  // ram). Cheap pooled debris boxes that tumble and settle, capped.
  CBZ.cityChunk = function (x, y, z, opts) {
    opts = opts || {};
    if (cityChunks.length > 60) return;
    const n = opts.count || (2 + ((Math.random() * 3) | 0));
    const col = opts.color != null ? opts.color : 0x7c828b;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(chunkGeo(), col === 0x7c828b ? chunkMat() : new THREE.MeshLambertMaterial({ color: col }));
      const s = 0.25 + Math.random() * 0.55; m.scale.set(s, s * (0.6 + Math.random()), s);
      m.position.set(x + (Math.random() - 0.5) * 0.5, y + (Math.random() - 0.5) * 0.5, z + (Math.random() - 0.5) * 0.5);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      m.castShadow = true; CBZ.scene.add(m);
      const dirx = opts.dirx != null ? opts.dirx : (Math.random() - 0.5) * 2;
      const dirz = opts.dirz != null ? opts.dirz : (Math.random() - 0.5) * 2;
      const sp = opts.force || 3;
      cityChunks.push({ mesh: m, vx: dirx * sp * (0.5 + Math.random()), vy: 2 + Math.random() * 3, vz: dirz * sp * (0.5 + Math.random()), spin: (Math.random() - 0.5) * 12, life: 2.2 + Math.random() * 1.5, dispose: col !== 0x7c828b });
    }
  };

  // PUBLIC: CINEMATIC STRUCTURAL DAMAGE at an impact point (missiles, rockets,
  // big blasts). Called by the aircraft + explosion agents. At (x,y,z) it:
  //   1) finds the nearest building WALL face so debris/scorch fling OUTWARD,
  //   2) knocks off concrete CHUNKS scaled by `power`,
  //   3) stamps a scorch/impact decal on that wall face (or the ground),
  //   4) BURSTS every window pane within blast radius (spider-cracks → out),
  //   5) on a big hit, a couple of bullet-pit gouges around the impact.
  // Pooled + capped throughout. `power` ~0.5 (light) … 3 (heavy ordnance).
  CBZ.cityDamageBuilding = function (x, y, z, power) {
    power = power || 1;
    if (y == null) y = (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + 1.4;
    // locate the nearest tall wall collider to derive an outward normal + a
    // surface point to scorch (so the decal sits ON the facade, not floating).
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
    });
    // (3) scorch/impact decal on the wall face (or a ground scorch if open air)
    if (onWall && scorchPool != null) {
      let m;
      if (scorchPool.length < SCORCH_CAP) { m = new THREE.Mesh(holeGeo(), scorchMat()); m.renderOrder = 2; CBZ.scene.add(m); scorchPool.push(m); }
      else { m = scorchPool[scorchIdx]; scorchIdx = (scorchIdx + 1) % SCORCH_CAP; m.visible = true; }
      m.position.set(bsx + bnx * 0.03, bsy, bsz + bnz * 0.03); aimDecal(m, bnx, 0, bnz); m.rotateZ(Math.random() * Math.PI);
      const sc = 1.6 + power * 1.4; m.scale.set(sc, sc, sc);
      // a few smaller bullet-pit gouges ringing the blast crater
      const ng = Math.min(4, 1 + (power | 0));
      for (let g = 0; g < ng; g++) {
        const a = Math.random() * 6.28, rr = 0.5 + Math.random() * (0.8 + power * 0.5);
        const gx = bsx + (bnx !== 0 ? 0 : Math.cos(a) * rr), gz = bsz + (bnz !== 0 ? 0 : Math.cos(a) * rr);
        CBZ.cityBulletHole(gx, bsy + Math.sin(a) * rr, gz, bnx, 0, bnz);
      }
    } else {
      CBZ.cityScorch(x, z, 1.4 + power);
    }
    // (4) shatter every pane within the blast radius (cracked → blown out)
    CBZ.cityShatter(x, z, 4.0 + power * 2.2);
    // (5) feedback
    if (CBZ.shake) CBZ.shake(Math.min(1.2, 0.3 + power * 0.3));
    return { x: onWall ? bsx : x, y: onWall ? bsy : y, z: onWall ? bsz : z, nx: bnx, nz: bnz, onWall };
  };

  CBZ.cityDamageReset = function () {
    for (const m of bulletPool) m.visible = false;
    for (const m of scorchPool) m.visible = false;
    bulletIdx = scorchIdx = 0;
    for (const c of cityChunks) { CBZ.scene.remove(c.mesh); if (c.dispose && c.mesh.material) c.mesh.material.dispose(); }
    cityChunks.length = 0;
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
      // restore the original wall mesh + its collider
      if (b.wall) { b.wall.visible = true; b.wall._breached = false; if (CBZ.losBlockers && b.wallWasLos && CBZ.losBlockers.indexOf(b.wall) === -1) CBZ.losBlockers.push(b.wall); }
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
  // Dressing per hole: a room-dark inset pocket (hides the merged SKY/trim
  // slabs that would float across the gap, warm spill after dusk) + a fractured
  // concrete rim of jittered prism chunks (merged to ONE mesh, fake-AO shaded).
  // city/fracture.js drives this primitive and owns ledger/caps/persistence.
  let _rimMat = null, _insetMat = null, _spillMat = null, _plyMat = null, _plyBatMat = null;
  let _roomBackMat = null, _roomFloorMat = null, _roomFurnMat = null, _rebarMat = null, _roomCeilMat = null, _warmLightMat = null;
  function rimMat() { return _rimMat || (_rimMat = new THREE.MeshLambertMaterial({ color: 0x8d8576, vertexColors: true })); }
  // INTERIOR REVEAL palette — light, showroom-grade tones so a shot-open window
  // OR a blast hole reads as a real LIT ROOM, never a dark gray crater. (MeshBasic
  // = self-lit, so these show full-bright wherever the sun is; distinct warm-wall /
  // cool-floor / white-ceiling tones + a warm ceiling light give the pocket real
  // depth and a "lived-in" read — the same thing that makes the showroom pop.)
  function insetMat() { return _insetMat || (_insetMat = new THREE.MeshBasicMaterial({ color: 0xbcb4a4, side: THREE.BackSide })); }   // pocket liner (warm light)
  function roomBackMat() { return _roomBackMat || (_roomBackMat = new THREE.MeshBasicMaterial({ color: 0xc9c0ad })); }   // back + side walls (warm drywall)
  function roomFloorMat() { return _roomFloorMat || (_roomFloorMat = new THREE.MeshBasicMaterial({ color: 0xbfc3ca })); }   // floor (light cool)
  function roomCeilMat() { return _roomCeilMat || (_roomCeilMat = new THREE.MeshBasicMaterial({ color: 0xe0e2e6 })); }   // ceiling (bright)
  function roomFurnMat() { return _roomFurnMat || (_roomFurnMat = new THREE.MeshBasicMaterial({ color: 0x5b554c })); }   // furniture (mid, reads vs light walls)
  function warmLightMat() { return _warmLightMat || (_warmLightMat = new THREE.MeshBasicMaterial({ color: 0xffe9c2 })); }   // glowing ceiling light = the room reads LIT
  function rebarMat() { return _rebarMat || (_rebarMat = new THREE.MeshBasicMaterial({ color: 0x41434a })); }
  function spillMat() { return _spillMat || (_spillMat = new THREE.MeshBasicMaterial({ color: 0xffb45e, transparent: true, opacity: 0.08, depthWrite: false })); }
  function plyMat() { return _plyMat || (_plyMat = new THREE.MeshLambertMaterial({ color: 0x9a7b4f })); }
  function plyBatMat() { return _plyBatMat || (_plyBatMat = new THREE.MeshLambertMaterial({ color: 0x6f5636 })); }

  function carveHole(x, y, z, r, opts) {
    opts = opts || {};
    r = r || 1.2;
    if (!CBZ.scene || !CBZ.colliders) return null;
    // --- nearest WALL box whose y-span contains the hit ---
    const sr = opts.search != null ? opts.search : 2.6, sr2 = sr * sr;
    let best = null, bestD = 1e9;
    for (let i = 0; i < CBZ.colliders.length; i++) {
      const c = CBZ.colliders[i];
      if (c.y1 == null || !c.ref) continue;                 // not a wall-style AABB w/ a mesh
      if (y < c.y0 - 0.3 || y > c.y1 + 0.3) continue;       // the box must CONTAIN the hit height
      if (c.y1 - c.y0 < 1.6) continue;                      // sills / furniture slabs aren't walls
      if (Math.min(c.maxX - c.minX, c.maxZ - c.minZ) > 0.9) continue;   // thick = counters/plinths, skip
      const mt = c.ref.material; if (mt && mt.transparent) continue;    // glass/doors keep their own systems
      const sx = Math.max(c.minX, Math.min(c.maxX, x)), sz = Math.max(c.minZ, Math.min(c.maxZ, z));
      const dx = x - sx, dz = z - sz, dd = dx * dx + dz * dz;
      if (dd > sr2 || dd >= bestD) continue;
      bestD = dd; best = c;
    }
    const wall = best && best.ref;
    if (!wall || wall._breached) return null;
    wall._breached = true;

    const c = best;
    const parent = wall.parent;                             // the building group (its position offsets locals)
    const px = parent ? parent.position.x : 0, pz = parent ? parent.position.z : 0;
    const horiz = (c.maxX - c.minX) >= (c.maxZ - c.minZ);   // wall runs along X if wider in X
    const minU = horiz ? c.minX : c.minZ, maxU = horiz ? c.maxX : c.maxZ;   // wall extent (world) along its axis
    const len = maxU - minU;
    const thick = horiz ? (c.maxZ - c.minZ) : (c.maxX - c.minX);
    const fixed = horiz ? (c.minZ + c.maxZ) / 2 : (c.minX + c.maxX) / 2;    // world coord on the off-axis
    const y0 = c.y0, y1 = c.y1;
    const hit = horiz ? x : z;                              // where the blast struck along the wall axis
    // gap = the opening centred on the hit, clamped within the wall, sized to the blast
    // (opts.gapW overrides for callers that know the exact opening — window frames)
    const gapW = Math.max(0.5, Math.min(len * 0.8, opts.gapW != null ? opts.gapW : r * 2));
    let u0 = Math.max(minU, hit - gapW / 2), u1 = Math.min(maxU, hit + gapW / 2);
    if (u1 - u0 < 0.4) { u0 = Math.max(minU, (minU + maxU) / 2 - gapW / 2); u1 = Math.min(maxU, (minU + maxU) / 2 + gapW / 2); }
    // vertical opening, clamped to the storey box. A bottom near the floor
    // drops the SILL entirely (a blasted doorway); a top near the slab keeps
    // no header. Anything between leaves real partial-height remnants.
    const yc = Math.max(y0 + 0.3, Math.min(y1 - 0.3, y));
    let v0 = Math.max(y0, yc - r), v1 = Math.min(y1, yc + r);
    // explicit vertical rect (window openings keep their sill + header exactly)
    if (opts.v0 != null) v0 = Math.max(y0, opts.v0);
    if (opts.v1 != null) v1 = Math.min(y1, opts.v1);
    if (v1 - v0 < 1.0) { const vm = (v0 + v1) / 2; v0 = Math.max(y0, vm - 0.5); v1 = Math.min(y1, vm + 0.5); }
    if (v0 - y0 < 0.55) v0 = y0;        // no ankle lip — clean walk-through bottom
    if (y1 - v1 < 0.35) v1 = y1;
    // OUTWARD side: from the building centre when we have one (stable across
    // replays), else from the side the hit came from (scene-level props).
    const cOff = horiz ? fixed - pz : fixed - px;
    let outS;
    if (parent && Math.abs(cOff) > 0.6) outS = cOff >= 0 ? 1 : -1;
    else { const off = horiz ? (z - fixed) : (x - fixed); outS = off >= 0 ? 1 : -1; }

    const wmat = wall.material;
    const rec = { wall, col: c, remnCols: [], extras: [], wallWasLos: false,
      gap: { horiz, fixed, thick, u0, u1, v0, v1, y0, y1, px, pz, outS, parent, minU, maxU } };

    // hide the solid wall mesh + remove it from LOS (cops can see/shoot through)
    wall.visible = false;
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
      CBZ.colliders.push(col); rec.remnCols.push(col);
      if (rec.wallWasLos && CBZ.losBlockers) CBZ.losBlockers.push(m);
    }
    addRemnant(minU, u0);                       // left flank
    addRemnant(u1, maxU);                       // right flank
    addRemnant(u0 - 0.01, u1 + 0.01, y0, v0);   // sill below the opening
    addRemnant(u0 - 0.01, u1 + 0.01, v1, y1);   // header above it

    // OPEN THE COLLIDER: splice the original wall AABB out + rebuild broadphase
    const ci = CBZ.colliders.indexOf(c); if (ci >= 0) CBZ.colliders.splice(ci, 1);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();

    // window panes hanging on the carved band would float over the hole —
    // clear them silently (the carve's debris/replay-silence owns the moment;
    // cityGlassReset restores them with the wall on a new run)
    for (let i = 0; i < cityGlass.length; i++) {
      const gp = cityGlass[i];
      if (gp.shattered) continue;
      const gu = horiz ? gp.x : gp.z, gf = horiz ? gp.z : gp.x;
      if (Math.abs(gf - fixed) > thick / 2 + 0.5) continue;
      if (gu < u0 - 0.2 || gu > u1 + 0.2 || gp.y < v0 - 0.3 || gp.y > v1 + 0.3) continue;
      gp.shattered = true; shatteredPanes++;
      if (gp.mesh) gp.mesh.visible = false; else paneShow(gp, false);
      if (gp.col) { const gi = CBZ.colliders.indexOf(gp.col); if (gi >= 0) CBZ.colliders.splice(gi, 1); }
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

    // --- DRESS: a room-deep dark INSET pocket (BackSide box — you look INTO
    //     it) with a warm spill quad at its back that glows after dusk, so an
    //     upper-storey wound reads as a blown-open room, not a paper cutout. ---
    const gapU = u1 - u0, gapV = v1 - v0, gapCen = (u0 + u1) / 2, vCen = (v0 + v1) / 2;
    // --- THE ROOM BEHIND THE WALL (user-filmed: the old pass was one near-
    //     black box — "a hole in a paper building"). A blast hole now opens
    //     into a real-looking ROOM: mid-tone walls/ceiling you can read in
    //     daylight, a darker back wall for depth, a concrete floor slab at the
    //     storey line (walls are one box per storey, so y0 IS the floor),
    //     blown-about furniture silhouettes, and rebar hanging off the header.
    //     Window vaults (opts.dep≈1) keep the shallow pass — their room is the
    //     real furnished interior you climb into. ---
    const dep = opts.dep != null ? opts.dep : (v0 === y0 ? 1.0 : 2.6);
    // opts.open = a TRUE opening (window carves): both sides of this wall are
    // real — the furnished room inside, the street outside — so ANY pocket
    // dress would block the view (USER-FILMED: shooting a window from inside
    // showed a gray panel instead of the street). Skip the dress entirely.
    if (opts.open) {
      cityBreaches.push(rec);
      return rec;
    }
    // revealRoom (a shot-open upper window) reads as an EMPTY LIT ROOM — same
    // shell as a blast (inset pocket + back wall + floor slab) but NO damage
    // (no furniture, rebar, rubble) plus closing side walls + a ceiling, so a
    // vacant unit shows a clean concrete box, never gray paper.
    const revealRoom = !!opts.revealRoom;
    const deepRoom = dep > 1.6 || revealRoom;
    const floorY = deepRoom ? y0 : v0;                 // show the slab down to the storey floor
    const podV0 = Math.min(v0, floorY), podV1 = v1 + 0.2;
    const podCen = (podV0 + podV1) / 2, podH = podV1 - podV0;
    const inCtr = fixed - outS * (dep - thick) / 2;    // pocket centred inward from the outer plane
    const ig = new THREE.BoxGeometry(horiz ? gapU + 0.2 : dep, podH, horiz ? dep : gapU + 0.2);
    const im = new THREE.Mesh(ig, insetMat());
    im.position.set((horiz ? gapCen : inCtr) - px, podCen, (horiz ? inCtr : gapCen) - pz);
    im.castShadow = false; im.receiveShadow = false;
    if (parent) parent.add(im); else CBZ.scene.add(im);
    rec.extras.push(im);
    const backN = fixed + outS * (thick / 2 - dep + 0.06);
    if (deepRoom) {
      // darker back wall = depth you can read at a glance
      const bw = new THREE.Mesh(new THREE.PlaneGeometry(gapU + 0.2, podH), roomBackMat());
      bw.position.set((horiz ? gapCen : backN + outS * 0.02) - px, podCen, (horiz ? backN + outS * 0.02 : gapCen) - pz);
      aimDecal(bw, horiz ? 0 : outS, 0, horiz ? outS : 0);
      if (parent) parent.add(bw); else CBZ.scene.add(bw);
      rec.extras.push(bw);
      // concrete floor slab — the room has a FLOOR, not a void
      const fl = new THREE.Mesh(new THREE.BoxGeometry(horiz ? gapU + 0.2 : dep - 0.1, 0.08, horiz ? dep - 0.1 : gapU + 0.2), roomFloorMat());
      fl.position.set((horiz ? gapCen : inCtr) - px, floorY + 0.05, (horiz ? inCtr : gapCen) - pz);
      if (parent) parent.add(fl); else CBZ.scene.add(fl);
      rec.extras.push(fl);
      // a warm GLOWING ceiling light near the back — what makes the showroom read
      // "lit room" not "flat box"; a cheap self-lit slab (no real light added).
      const lgW = horiz ? Math.min(1.8, (gapU + 0.2) * 0.6) : 0.5, lgD = horiz ? 0.5 : Math.min(1.8, (gapU + 0.2) * 0.6);
      const lg = new THREE.Mesh(new THREE.BoxGeometry(lgW, 0.07, lgD), warmLightMat());
      lg.position.set((horiz ? gapCen : inCtr) - px, v1 - 0.2, (horiz ? inCtr : gapCen) - pz);
      lg.castShadow = false; lg.receiveShadow = false;
      if (parent) parent.add(lg); else CBZ.scene.add(lg);
      rec.extras.push(lg);
      if (!revealRoom) {
        // blast-shoved furniture: a couple of dark silhouettes, randomly placed
        // and yawed, sitting on that floor (cheap boxes — they read as the room's
        // contents surviving the hit, which is what makes it a ROOM)
        const nFurn = gapU > 1.6 ? 2 : 1;
        for (let fi = 0; fi < nFurn; fi++) {
          const fw = 0.5 + Math.random() * 0.7, fh = 0.5 + Math.random() * 1.1, fd = 0.4 + Math.random() * 0.4;
          const fg = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, fd), roomFurnMat());
          const along = (Math.random() - 0.5) * Math.max(0.2, gapU - fw);
          const inward = thick / 2 + 0.5 + Math.random() * (dep - thick - 1.0);
          const fx = horiz ? gapCen + along : fixed - outS * inward;
          const fz = horiz ? fixed - outS * inward : gapCen + along;
          fg.position.set(fx - px, floorY + 0.08 + fh / 2, fz - pz);
          fg.rotation.y = Math.random() * Math.PI;
          fg.rotation.z = Math.random() < 0.3 ? (Math.random() - 0.5) * 0.5 : 0;   // one knocked over
          if (parent) parent.add(fg); else CBZ.scene.add(fg);
          rec.extras.push(fg);
        }
        // rebar hanging from the header into the gap — broken concrete shows its bones
        const nBar = 2 + ((Math.random() * 2) | 0);
        for (let bi = 0; bi < nBar; bi++) {
          const bl = 0.4 + Math.random() * 0.6;
          const bg = new THREE.Mesh(new THREE.BoxGeometry(0.035, bl, 0.035), rebarMat());
          const along = (Math.random() - 0.5) * gapU * 0.8;
          const bx = horiz ? gapCen + along : fixed + outS * (thick / 2 - 0.1);
          const bz = horiz ? fixed + outS * (thick / 2 - 0.1) : gapCen + along;
          bg.position.set(bx - px, v1 - bl / 2 + 0.05, bz - pz);
          bg.rotation.x = (Math.random() - 0.5) * 0.35;
          bg.rotation.z = (Math.random() - 0.5) * 0.35;
          if (parent) parent.add(bg); else CBZ.scene.add(bg);
          rec.extras.push(bg);
        }
      } else {
        // REVEAL ROOM: close the pocket into a real box. Two side walls (left +
        // right of the gap, ~dep deep) and a ceiling slab at the header line —
        // shared self-lit MeshBasic singletons (no per-hole materials, no light
        // churn) so the empty unit reads as a constant concrete mid-tone room.
        // ceiling at the top of the opening, spanning the gap × pocket depth
        const cg = new THREE.Mesh(new THREE.BoxGeometry(horiz ? gapU + 0.2 : dep - 0.1, 0.06, horiz ? dep - 0.1 : gapU + 0.2), roomCeilMat());
        cg.position.set((horiz ? gapCen : inCtr) - px, v1 - 0.05, (horiz ? inCtr : gapCen) - pz);
        if (parent) parent.add(cg); else CBZ.scene.add(cg);
        rec.extras.push(cg);
        // two side walls closing the pocket left/right (thin BOXES ~dep × podH
        // so they read from any angle — the player can stand inside ground-level
        // holes; a single-sided plane would vanish from the back)
        for (const sgn of [-1, 1]) {
          const sg = new THREE.BoxGeometry(horiz ? 0.05 : dep - 0.1, podH, horiz ? dep - 0.1 : 0.05);
          const sw = new THREE.Mesh(sg, roomBackMat());
          if (horiz) sw.position.set(gapCen + sgn * gapU / 2 - px, podCen, inCtr - pz);
          else sw.position.set(inCtr - px, podCen, gapCen + sgn * gapU / 2 - pz);
          if (parent) parent.add(sw); else CBZ.scene.add(sw);
          rec.extras.push(sw);
        }
      }
    }
    const sq = new THREE.Mesh(new THREE.PlaneGeometry(gapU * 0.9, gapV * 0.9), spillMat());
    sq.position.set((horiz ? gapCen : backN) - px, vCen, (horiz ? backN : gapCen) - pz);
    aimDecal(sq, horiz ? 0 : outS, 0, horiz ? outS : 0);
    sq.renderOrder = 2;
    if (parent) parent.add(sq); else CBZ.scene.add(sq);
    rec.extras.push(sq);

    // --- FRACTURED RIM: 8-13 jittered concrete prisms ringing the opening in
    //     a radial crack pattern, a few HANGING into the gap as cracked
    //     overhang. Built in face space, merged to ONE mesh, fake-AO shaded. ---
    const rim = [];
    const nCh = 8 + ((Math.random() * 6) | 0);
    const per = 2 * (gapU + gapV);
    for (let i = 0; i < nCh; i++) {
      const cw = 0.2 + Math.random() * (0.25 + Math.min(0.5, r * 0.18));
      const chh = cw * (0.7 + Math.random() * 0.9);
      const g = new THREE.BoxGeometry(cw, chh, 0.16 + Math.random() * 0.22);
      g.rotateZ((Math.random() - 0.5) * 1.1);   // radial jitter around the face normal
      g.rotateX((Math.random() - 0.5) * 0.4);
      // walk the perimeter (bottom → right → top → left), jittered
      const t = ((i + Math.random() * 0.6) / nCh) * per;
      let fu, fv;
      if (t < gapU) { fu = u0 + t; fv = v0 + (Math.random() * 0.12 - 0.04); }
      else if (t < gapU + gapV) { fu = u1 + (Math.random() * 0.1 - 0.04); fv = v0 + (t - gapU); }
      else if (t < gapU * 2 + gapV) {
        fu = u1 - (t - gapU - gapV);
        fv = Math.random() < 0.45 ? v1 - chh * 0.45 : v1 + (Math.random() * 0.1 - 0.03);   // overhang chunks HANG into the gap
      } else { fu = u0 - (Math.random() * 0.1 - 0.04); fv = v1 - (t - gapU * 2 - gapV); }
      fu = Math.max(u0 - 0.15, Math.min(u1 + 0.15, fu + (Math.random() - 0.5) * 0.2));
      fv = Math.max(v0 - 0.1, Math.min(v1 + 0.12, fv));
      const fn = fixed + outS * (thick / 2 - 0.05 + Math.random() * 0.16);   // proud of the face
      if (horiz) g.translate(fu - px, fv, fn - pz);
      else { g.rotateY(Math.PI / 2); g.translate(fn - px, fv, fu - pz); }
      rim.push(g);
    }
    const BGU = THREE.BufferGeometryUtils;
    let rgs = null;
    if (BGU && BGU.mergeBufferGeometries && rim.length > 1) { const m = BGU.mergeBufferGeometries(rim); for (const g of rim) g.dispose(); rgs = m ? [m] : null; }
    else if (rim.length) rgs = rim;            // no merger: every chunk still lands, one mesh each
    if (rgs) for (let ri = 0; ri < rgs.length; ri++) {
      const rg = rgs[ri];
      shadeGeo(rg, false);
      const rm = new THREE.Mesh(rg, rimMat());
      rm.castShadow = false; rm.receiveShadow = true;
      if (parent) parent.add(rm); else CBZ.scene.add(rm);
      rec.extras.push(rm);
    }

    cityBreaches.push(rec);
    return rec;
  }
  // PUBLIC primitive for city/fracture.js (ledger/caps/persistence live there)
  CBZ.cityCarveWall = carveHole;

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
    CBZ.colliders.push(col); rec.remnCols.push(col);
    if (CBZ.losBlockers) CBZ.losBlockers.push(board);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
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
      // revealRoom lines the opening with a bright showroom-grade pocket — light
      // walls, cool floor, white ceiling, a warm ceiling light — so you SEE A
      // ROOM through a shot-out window, the same way the showroom front reads.
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
      o.shattered = true; shatteredPanes++;
      if (o.mesh) o.mesh.visible = false; else paneShow(o, false);
      if (o.col) { const ci = CBZ.colliders.indexOf(o.col); if (ci >= 0) CBZ.colliders.splice(ci, 1); }
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

  // PUBLIC: blast a passable hole through the nearest ground-floor wall to (x,z).
  // `r` ~ the breach half-reach in metres (an RPG blastRadius 13 → r≈3.6, a
  // satisfying car-sized hole). Returns true if a wall actually opened. Now a
  // thin wrapper over the generalized carve (chest height, legacy 5m search) so
  // every ground breach lands in the fracture ledger (persistence + guests) —
  // and a no-op when this same blast's fracture pass already opened the wall.
  CBZ.cityBreach = function (x, z, r) {
    r = r || 1.6;
    if (!CBZ.scene || !CBZ.colliders) return false;
    const fr = CBZ.cityFracture;
    if (fr && fr.recent && fr.recent(x, z)) return true;    // this rocket already opened the wall
    const rec = carveHole(x, 1.2, z, r, { search: 5 });
    // nothing to breach (open air, or the wall was already opened) → just scorch.
    if (!rec) { CBZ.cityScorch(x, z, r * 0.9 + 1.2); return false; }
    if (fr && fr._adopt) fr._adopt(rec, r);
    // rubble blown INWARD through the hole, scorch, burst nearby panes, feedback
    const g = rec.gap;
    const off = g.horiz ? (z - g.fixed) : (x - g.fixed);
    const inN = off >= 0 ? 1 : -1;                          // push debris away from the side the rocket came from
    const dxr = g.horiz ? 0 : -inN, dzr = g.horiz ? -inN : 0;
    const gapCen = (g.u0 + g.u1) / 2;
    const rubX = g.horiz ? gapCen : g.fixed, rubZ = g.horiz ? g.fixed : gapCen;
    CBZ.cityChunk(rubX, (g.v0 + g.v1) / 2 - (g.v1 - g.v0) * 0.2, rubZ,
      { count: 5 + ((Math.random() * 4) | 0), force: 5, dirx: dxr, dirz: dzr });
    CBZ.cityScorch(x, z, r * 0.9 + 1.4);
    CBZ.cityShatter(x, z, r * 2 + 4);
    if (CBZ.shake) CBZ.shake(0.6);
    if (CBZ.sfx) CBZ.sfx("glass");
    return true;
  };

  // DECORATE the explosion so blasts leave scorch marks on the ground + nearby
  // walls and blow concrete chunks outward — without touching crashfx.js. We
  // wrap once, lazily, the first time the city updates (after all modules load),
  // preserving the original behaviour exactly. Idempotent.
  // The STRUCTURAL pass shared by every blast: ground/facade scorch, outward
  // concrete chunks, the facade-damage sweep, and — for a hard hit against a
  // wall — a real persistent carved HOLE at the impact height that opens onto
  // the LIT interior room (fracture.js owns ledger/caps/debris; carveHole's
  // deepRoom dress + the brightened reveal palette make it read as a room you
  // can see INTO, not a gray crater). Radius maps the ordnance — RPG/airstrike
  // ~2.6-3.4, grenade/car-burst ~1.6, anything weaker just scars.
  function structuralBlast(x, z, opts) {
    try {
      const power = (opts && opts.power) || 1, R = ((opts && opts.radius) || 6) * power;
      CBZ.cityScorch(x, z, R * 0.5);
      CBZ.cityChunk(x, (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + 0.6, z, { count: Math.round(4 + 3 * power), force: 4 + 2 * power });
      CBZ.cityDamageBuilding(x, (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + 1.4, z, Math.min(3, power));
      if (CBZ.cityFracture && CBZ.cityFracture.blastAt && power >= 0.85 && !(opts && opts.noDamage)) {
        const hy = (opts && opts.y) || 1.4;
        const hr = power >= 1.3 ? Math.min(3.4, 2.6 + (power - 1.3) * 0.7) : 1.6;
        CBZ.cityFracture.blastAt({ x: x, y: hy, z: z }, hr, { power: power });
      }
    } catch (e) {}
  }
  // Wrap a blast entry point ONCE (idempotent per-fn) so it also does structural
  // damage. BOTH the ground blast (cityExplosion: RPG/C4/grenade/car) AND the
  // air blast (cityAirstrikeExplosion: planes/helicopters/missiles/airstrikes)
  // get it — so ANYTHING that hits a building opens it to the interior, not just
  // the hand-thrown RPG. (Was: only cityExplosion wrapped, so aircraft hits left
  // a fake crater that didn't show inside — user-filmed.)
  function wrapBlast(name) {
    const orig = CBZ[name];
    if (typeof orig !== "function" || orig._structWrapped) return;
    const wrapped = function (x, z, opts) { const r = orig.call(this, x, z, opts); structuralBlast(x, z, opts); return r; };
    wrapped._structWrapped = true;
    CBZ[name] = wrapped;
  }
  function wrapExplosion() {
    wrapBlast("cityExplosion");
    wrapBlast("cityAirstrikeExplosion");
  }
  CBZ.onUpdate(0.01, function () {
    if (CBZ.game.mode !== "city") { if (glassNightOn) CBZ.cityGlassNight(false); return; }
    wrapExplosion();
    // fold any freshly-registered panes into instanced pools (first city frame
    // for the main build; later generations for the expansion island).
    if (pendingGlass.length) buildGlassPools();
    if (pendingDeco.length) buildRoomDecoPools();
    // the dusk/dawn LIT-PANE flip — the same hysteresis thresholds as
    // view.js's emissive night pass so the whole night look lands together.
    const n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    CBZ.cityGlassNight(glassNightOn ? n > 0.45 : n > 0.6);
    // warm light spilling out of carved wall holes — one shared material, so
    // every hole in the city breathes with the same dusk
    if (_spillMat) _spillMat.opacity = 0.08 + n * 0.5;
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

  // chunk physics (only runs while chunks exist)
  CBZ.onAlways(9, function (dt) {
    if (!cityChunks.length) return;
    const G = (CBZ.TUNE && CBZ.TUNE.gravity) || 22;
    for (let i = cityChunks.length - 1; i >= 0; i--) {
      const c = cityChunks[i]; c.life -= dt; c.vy -= G * dt;
      const p = c.mesh.position;
      p.x += c.vx * dt; p.y += c.vy * dt; p.z += c.vz * dt;
      c.mesh.rotation.x += c.spin * dt; c.mesh.rotation.y += c.spin * 0.7 * dt;
      const fl = (CBZ.floorAt ? CBZ.floorAt(p.x, p.z) : 0) + 0.08;
      if (p.y <= fl) { p.y = fl; c.vy = -c.vy * 0.18; c.vx *= 0.55; c.vz *= 0.55; c.spin *= 0.55; if (Math.abs(c.vy) < 0.6) c.vy = 0; }
      if (c.life <= 0) { CBZ.scene.remove(c.mesh); if (c.dispose && c.mesh.material) c.mesh.material.dispose(); cityChunks.splice(i, 1); }
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
  function doorLeafMat() { return _doorLeafMat || (_doorLeafMat = new THREE.MeshLambertMaterial({ color: 0x9aa6b4, emissive: 0x1a2026, emissiveIntensity: 0.18, transparent: true, opacity: 0.97 })); }
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
  function doorOccupied(dr, includeCars) {
    const P = CBZ.player && CBZ.player.pos;
    // a door pinned to an upper floor (the penthouse) only responds when an actor
    // is near in Y too — otherwise standing on the deck far below would flap it.
    if (dr.doorY != null && P && Math.abs(P.y - dr.doorY) > 3.0) return false;
    if (P && doorNearActor(dr, P.x, P.z, CBZ.player.driving ? 4.6 : 1.7)) return true;
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
        if (doorNearActor(dr, pd.pos.x, pd.pos.z, 1.25)) return true;
      }
    }
    return false;
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
      const dxp = dr.wx - px, dzp = dr.wz - pz;
      const farFromPlayer = dxp * dxp + dzp * dzp > 1600;   // 40m: skip cold distant doors
      if (farFromPlayer && !dr.open && dr.t <= 0.001) continue;
      const near = doorOccupied(dr, true);
      if (near) { dr.open = true; dr.hold = 1.8; }
      else if (dr.hold > 0) { dr.hold -= dt; if (dr.hold <= 0) dr.open = false; }

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
      if (dr.colIn && dr.t > 0.30) {
        const idx = CBZ.colliders.indexOf(dr.col); if (idx >= 0) CBZ.colliders.splice(idx, 1);
        dr.colIn = false; if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
        if (CBZ.sfx) CBZ.sfx("door");
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
      dr.open = false; dr.hold = 0; dr.t = 0; dr.pivot.rotation.y = 0;
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
  // BRICK / MASONRY palette for residential apartment facades — warm reds,
  // tans, browns, a buff limestone and a grey-stone, the real NYC walk-up mix
  // (cooperatornews "common facades = brick, limestone, sandstone, brownstone").
  // Muted so they sit next to the cool glass towers without screaming.
  const BRICK_PALETTE = [
    0x8a4b3a,  // red brick
    0x9c5a44,  // warm terracotta brick
    0x7a4334,  // deep brownstone
    0xa9836a,  // tan / buff brick
    0xb8a487,  // limestone buff
    0x8f6f57,  // sandstone brown
    0x95604a,  // rust brick
    0x837a72,  // grey stone
  ];
  const ABANDONED_PALETTE = [0x4a4438, 0x3f4640, 0x534a44, 0x46423c, 0x4c4640];
  const BOARD = 0x6b4a2a;

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

  // ---- the enterable building (one group; switchback stairs to the roof) ----
  // opts: { boarded:bool (board windows instead of glass), grime:bool }
  function makeBuilding(root, ox, oz, w, d, storeys, color, doorSide, opts) {
    opts = opts || {};
    const bgroup = new THREE.Group();
    bgroup.position.set(ox, 0, oz);
    root.add(bgroup);
    const cols = [], plats = [], windows = [];
    const ixMin = -w / 2 + WT, ixMax = w / 2 - WT;
    const izMin = -d / 2 + WT, izMax = d / 2 - WT;
    const stairW = Math.min(SW, Math.max(0, ixMax - ixMin - 4.2));
    const hasStairs = opts.stairs !== false && storeys > 1 && stairW >= 4.4 && (izMax - izMin) >= 8.5;
    const localDoor = doorInfo(0, 0, w, d, doorSide);

    // per-building deterministic VARIETY seed (glass tint, parapet height) —
    // derived from the lot position so the same lot reads the same every run.
    const vhash = Math.abs(Math.sin(ox * 12.9898 + oz * 78.233) * 43758.5453) % 1;
    const tintIdx = ((vhash * 7.13) | 0) % GLASS_TINTS;
    // GLASS KIND: retail/showrooms = CLEAR (see-through storefronts, always);
    // everything else (offices/apartments) = REFLECTIVE (mirror-ish until shot).
    // opts.glassKind overrides. City-only opts, default falsy elsewhere.
    const GKIND = opts.glassKind ? opts.glassKind : ((opts.retail || opts.showroom) ? "clear" : "reflective");

    // ===== FACADE TYPE =======================================================
    // Keep the city on the style that reads clean in first person: glass office
    // shells and see-through retail. The old residential/fortified archetypes
    // produced solid, wrong-facing brick blocks that visually crowded storefronts
    // like Pawn & Loan from the inside, so city generation normalizes them away.
    let FACADE = opts.facade ||
      (opts.retail || opts.showroom ? "retail"
        : "office");
    if (FACADE === "residential" || FACADE === "fortified") FACADE = "office";
    // RESIDENTIAL gets a warm brick/masonry wall color (overrides the cool
    // tower palette the caller passed) + punched windows; office keeps the
    // caller's cool curtain-wall tint. Fortified keeps the wall, drops glass.
    const wallColor = FACADE === "residential"
      ? BRICK_PALETTE[((vhash * 977) | 0) % BRICK_PALETTE.length]
      : color;
    // shade trims off the ACTUAL wall color we'll render (brick or tower).
    const punched = false;                      // residential brick shell exterminated
    const fortified = false;                    // sealed shell exterminated
    // ADOPT the facade wall color from here on — every wall box + trim/plinth/
    // pilaster derives from `color`, so reassigning it once paints the whole
    // building brick (residential) or keeps the cool curtain tint (office).
    color = wallColor;
    // trim palette: darks derived from the wall colour (shared palettes →
    // shared colour buckets, so the batcher still collapses trim city-wide)
    const MULL = 0x262b31;                 // mullion-frame dark
    const SKY = 0xd6e6f2;                  // interior window "daylight" backing —
    // the wall behind every pane is a SOLID box, so without this bright slab a
    // window reads as blank wall from INSIDE the room. One extra colour bucket
    // in the merged deco pass (≈1 mesh/building pre-batch), it scene-lights
    // down with the sun so night interiors dim naturally.
    const TRIM = shadeHex(color, 0.72);    // cornice / sill / parapet coping
    const BASE = shadeHex(color, 0.55);    // ground-floor plinth
    const PIL = shadeHex(color, 0.85);     // corner pilasters

    // FACADE DECO accumulator: every flat opaque dressing box (mullion frames,
    // cornices, plinth, pilasters, coping) is collected as raw geometry and
    // merged into ONE mesh per colour via the vendored BufferGeometryUtils —
    // a whole building's trim lands as 2-4 meshes pre-batch, and core/batch.js
    // then merges those across buildings at load. Falls back to individual
    // meshes (still batch-merged later) if the vendor script is missing.
    const decoGeos = new Map();
    function dbox(lx, ly, lz, bw, bh, bd, col) {
      const g = new THREE.BoxGeometry(bw, bh, bd);
      g.translate(lx, ly, lz);
      let arr = decoGeos.get(col);
      if (!arr) { arr = []; decoGeos.set(col, arr); }
      arr.push(g);
    }
    function flushDeco() {
      const BGU = THREE.BufferGeometryUtils;
      decoGeos.forEach(function (geos, col) {
        const matD = CBZ.cmat ? CBZ.cmat(col) : mat(col);
        if (BGU && BGU.mergeBufferGeometries && geos.length > 1) {
          const merged = BGU.mergeBufferGeometries(geos);
          for (const g of geos) g.dispose();
          const m = new THREE.Mesh(merged, matD);
          m.castShadow = false; m.receiveShadow = true;
          bgroup.add(m);
        } else {
          for (const g of geos) {
            const m = new THREE.Mesh(g, matD);
            m.castShadow = false; m.receiveShadow = true; bgroup.add(m);
          }
        }
      });
      decoGeos.clear();
    }

    // Interior decoration is allowed only outside the entrance aisle and the
    // dedicated stairwell. The aisle reaches from just outside the door into
    // the room so furniture never makes an enterable building feel blocked.
    // shaftRects: building-local rects reserved by an elevator shaft (filled in
    // by CBZ.cityCarveShaft); furnishing/props gate off these too. Declared up
    // here so clearFloorPoint closes over the SAME array the return object exposes.
    const shaftRects = [];
    function clearFloorPoint(lx, lz, pad) {
      pad = pad == null ? 0.8 : pad;
      const dx = lx - localDoor.x, dz = lz - localDoor.z;
      const inward = dx * localDoor.nx + dz * localDoor.nz;
      const cross = Math.abs(dx * localDoor.nz - dz * localDoor.nx);
      if (inward > -0.8 && inward < 4.8 && cross < DOORW / 2 + pad) return false;
      if (hasStairs && lx < ixMin + stairW + pad && lx > ixMin - pad && lz > izMin - pad && lz < izMax + pad) return false;
      // RESERVED ELEVATOR-SHAFT footprints (building-local rects, stamped by
      // CBZ.cityCarveShaft once the lift picks its lobby column): keep later
      // furniture / props off the vertical chase the cab travels.
      for (let i = 0; i < shaftRects.length; i++) {
        const r = shaftRects[i];
        if (lx > r.x0 - pad && lx < r.x1 + pad && lz > r.z0 - pad && lz < r.z1 + pad) return false;
      }
      return lx > ixMin + pad && lx < ixMax - pad && lz > izMin + pad && lz < izMax - pad;
    }

    function lbox(lx, ly, lz, bw, bh, bd, col, o) {
      o = o || {};
      const g = new THREE.BoxGeometry(bw, bh, bd);
      const mm = mat(col, o.emissive ? { emissive: o.emissive, ei: o.ei || 0.5 } : null);
      // fake-AO vertex shading on structural LOS surfaces (walls/roofs/rims) —
      // exactly the meshes batch.js spares, so the colour attribute survives
      if (o.los) { shadeGeo(g, ly - bh / 2 <= 0.2); mm.vertexColors = true; }
      const m = new THREE.Mesh(g, mm);
      m.position.set(lx, ly, lz);
      m.castShadow = o.cast !== false; m.receiveShadow = true;
      bgroup.add(m);
      if (o.solid) {
        const c = { minX: ox + lx - bw / 2, maxX: ox + lx + bw / 2, minZ: oz + lz - bd / 2, maxZ: oz + lz + bd / 2, ref: m, y0: ly - bh / 2, y1: ly + bh / 2 };
        CBZ.colliders.push(c); cols.push(c);
      }
      if (o.plat) { const p = { minX: ox + lx - bw / 2, maxX: ox + lx + bw / 2, minZ: oz + lz - bd / 2, maxZ: oz + lz + bd / 2, top: ly + bh / 2 }; CBZ.platforms.push(p); plats.push(p); }
      if (o.los) CBZ.losBlockers.push(m);
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
      if (f.horiz) {
        const zz = f.z, off = (f.s === 0 ? 0.06 : -0.06);
        lbox(-w / 2 + 0.35, ly, zz, 0.7, FH, WT, color, wallOpt);
        lbox(w / 2 - 0.35, ly, zz, 0.7, FH, WT, color, wallOpt);
        lbox(0, HDR + (FH - HDR) / 2, zz, GW + 0.5, FH - HDR, WT, color, { solid: true, los: true });   // header (drive under)
        lbox(0, HDR - 0.5, zz + off, GW - 0.3, 0.9, 0.14, 0x8a93a0, { cast: false });                   // rolled-up door
        for (let s = 0; s < 4; s++) lbox(0, HDR - 0.2 - s * 0.2, zz + off * 1.2, GW - 0.4, 0.05, 0.18, 0x6b7480, { cast: false });
        const a = -w / 2 + 0.7, bb = -GW / 2 - 0.15, cxL = (a + bb) / 2, wL = bb - a;
        gridGlass(cxL, ly, zz, wL, FH * 0.86, 0.07, true, { solid: true });
        gridGlass(-cxL, ly, zz, wL, FH * 0.86, 0.07, true, { solid: true });
      } else {
        const xx = f.x, off = (f.s === 2 ? 0.06 : -0.06);
        lbox(xx, ly, -d / 2 + 0.35, WT, FH, 0.7, color, wallOpt);
        lbox(xx, ly, d / 2 - 0.35, WT, FH, 0.7, color, wallOpt);
        lbox(xx, HDR + (FH - HDR) / 2, 0, WT, FH - HDR, GW + 0.5, color, { solid: true, los: true });
        lbox(xx + off, HDR - 0.5, 0, 0.14, 0.9, GW - 0.3, 0x8a93a0, { cast: false });
        for (let s = 0; s < 4; s++) lbox(xx + off * 1.2, HDR - 0.2 - s * 0.2, 0, 0.18, 0.05, GW - 0.4, 0x6b7480, { cast: false });
        const a = -d / 2 + 0.7, bb = -GW / 2 - 0.15, czL = (a + bb) / 2, dL = bb - a;
        gridGlass(xx, ly, czL, dL, FH * 0.86, 0.07, false, { solid: true });
        gridGlass(xx, ly, -czL, dL, FH * 0.86, 0.07, false, { solid: true });
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
            gridGlass(fc, gy, zz + goff, side, gph, 0.05, true, { solid: true, tint: tintIdx, kind: "clear" });
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
            gridGlass(xx + goff, gy, fc, side, gph, 0.05, false, { solid: true, tint: tintIdx, kind: "clear" });
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
      if (!opts.boarded) makeDoorPanel(bgroup, ox, oz, localDoor, DOORW);
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
      const post = 0.85;
      if (f.horiz) {
        const zz = f.z;
        lbox(-w / 2 + post / 2, ly, zz, post, FH, WT, color, wallOpt);
        lbox(w / 2 - post / 2, ly, zz, post, FH, WT, color, wallOpt);
        lbox(0, HDR + (FH - HDR) / 2, zz, GW + 0.6, FH - HDR, WT, color, { solid: true, los: true });
        const a = -w / 2 + post, bb = -GW / 2 - 0.2, cxL = (a + bb) / 2, wL = bb - a;
        if (wL > 0.5) {
          gridGlass(cxL, ly, zz, wL, FH * 0.84, 0.06, true, { solid: true });
          gridGlass(-cxL, ly, zz, wL, FH * 0.84, 0.06, true, { solid: true });
        }
      } else {
        const xx = f.x;
        lbox(xx, ly, -d / 2 + post / 2, WT, FH, post, color, wallOpt);
        lbox(xx, ly, d / 2 - post / 2, WT, FH, post, color, wallOpt);
        lbox(xx, HDR + (FH - HDR) / 2, 0, WT, FH - HDR, GW + 0.6, color, { solid: true, los: true });
        const a = -d / 2 + post, bb = -GW / 2 - 0.2, czL = (a + bb) / 2, dL = bb - a;
        if (dL > 0.5) {
          gridGlass(xx, ly, czL, dL, FH * 0.84, 0.06, false, { solid: true });
          gridGlass(xx, ly, -czL, dL, FH * 0.84, 0.06, false, { solid: true });
        }
      }
    }

    for (let k = 0; k < storeys; k++) {
      const ly = k * FH + FH / 2;
      const faces = [
        { s: 0, x: 0, z: -d / 2 + WT / 2, w: w, dd: WT, horiz: true },
        { s: 1, x: 0, z: d / 2 - WT / 2, w: w, dd: WT, horiz: true },
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
          if (!opts.showroom && !opts.boarded && !cityRetail) makeDoorPanel(bgroup, ox, oz, localDoor, DOORW);
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
            else lbox(f.x, cy, cT, f.dd, ch, segLen, color, wallOpt);
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
            for (let gx = 0; gx < nx; gx++) {
              for (let gy = 0; gy < ny; gy++) {
                const ox2 = -spanW / 2 + (gx + 0.5) * pw;     // pane offset within the opening
                const oy2 = -spanH / 2 + (gy + 0.5) * ph;
                const py = cy + oy2;
                // SEAT THE GLASS AT THE STREET FACE, not the wall centre. The wall
                // is WT (0.4m) thick, centred at f.z; a pane placed at f.z sat
                // BURIED 0.2m inside the opaque wall while only the proud mullion
                // trim (at f.z + outSgn*0.25) showed → the "tally marks on a blank
                // wall" the owner filmed. Push the pane out to the outer wall plane
                // (matches the working retail-storefront offset), so the glass is
                // visible with the mullions just in front of it.
                if (f.horiz) addCityGlass(bgroup, cx + ox2, py, cz + outSgn * (WT / 2 + 0.01), pw, ph, t, ox, oz, { solid: true, tint: tintIdx, kind: "clear" }, windows);
                else addCityGlass(bgroup, cx + outSgn * (WT / 2 + 0.01), py, cz + ox2, t, ph, pw, ox, oz, { solid: true, tint: tintIdx, kind: "clear" }, windows);
              }
            }
            // INTERIOR READABILITY: the room seen through the glass. Deterministic
            // per-window so the lit set is stable run-to-run. Apartments glow warm
            // (lamps), offices cool (overheads); ~26% of residential windows lit
            // at night so a brick block reads inhabited, ~15% for offices.
            if (CBZ.cityInteriorGlow) {
              const wx = ox + cx, wz = oz + cz;
              const hsh = Math.abs(Math.sin(wx * 12.9898 + cy * 4.137 + wz * 78.233) * 43758.5453) % 1;
              const litFrac = punched ? 0.26 : 0.15;
              const warm = punched ? 0.9 : 0.35;
              CBZ.cityInteriorGlow(bgroup, wx, cy, wz, spanW, spanH, outN, { lit: hsh < litFrac, warm: warm });
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
            const sillH = 1.05, hdrH = 0.7;
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
              else lbox(f.x, cy, centerT, f.dd, ch, segLen, color, wallOpt);
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
              // thin punched-window frame proud of the street face: a sill lip, a
              // header lintel, and a single muntin bar (the classic two-over-two).
              if (f.horiz) {
                const faceZ = f.z + outSgn * (WT / 2 + 0.05);
                dbox(cx, winY0 - 0.06, faceZ, winW + 0.22, 0.12, 0.12, TRIM);   // stone sill
                dbox(cx, winY1 + 0.06, faceZ, winW + 0.22, 0.1, 0.1, TRIM);     // lintel
                dbox(cx, winCy, faceZ, winW + 0.12, 0.07, 0.06, MULL);          // muntin (horiz bar)
                dbox(cx, winCy, faceZ, 0.06, winPh, 0.06, MULL);               // muntin (vert bar)
              } else {
                const faceX = f.x + outSgn * (WT / 2 + 0.05);
                dbox(faceX, winY0 - 0.06, cz, 0.12, 0.12, winW + 0.22, TRIM);
                dbox(faceX, winY1 + 0.06, cz, 0.1, 0.1, winW + 0.22, TRIM);
                dbox(faceX, winCy, cz, 0.06, 0.07, winW + 0.12, MULL);
                dbox(faceX, winCy, cz, 0.06, winPh, 0.06, MULL);
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
              else lbox(f.x, cy, centerT, f.dd, ch, segLen, color, wallOpt);
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
            // ===== OFFICE: one wide curtain-wall BAND per storey (loved towers) =
            // window vertical extent: a sill lip off the floor up to a header lip
            // under the ceiling (near floor-to-ceiling on modern towers).
            const sillH = modern ? 0.55 : 0.9;                  // sill top above floor
            const hdrH = modern ? 0.45 : 0.7;                   // header depth below ceiling
            const winY0 = fy0 + sillH, winY1 = fy1 - hdrH;
            const winCy = (winY0 + winY1) / 2, winPh = winY1 - winY0;
            const jamb = 0.55;                                  // end jambs centre the opening
            if (f.horiz) {
              lbox(f.x, fy0 + sillH / 2, f.z, f.w, sillH, f.dd, color, wallOpt);   // sill
              lbox(f.x, fy1 - hdrH / 2, f.z, f.w, hdrH, f.dd, color, wallOpt);     // header
              lbox(-w / 2 + jamb / 2, winCy, f.z, jamb, winPh, f.dd, color, wallOpt);   // jambs
              lbox(w / 2 - jamb / 2, winCy, f.z, jamb, winPh, f.dd, color, wallOpt);
              const span = w - 2 * jamb;
              glazeOpening(0, winCy, f.z, span, winPh);
              const faceZ = f.z + outSgn * (WT / 2 + 0.04);
              // CLEAN-GLASS mullions: hairline vertical reveals on the curtain-
              // wall module (research: modern all-glass facades minimize framing,
              // mullion ~5-10mm) — slimmed 0.07→0.035 and the heavy mid-storey
              // horizontal TRANSOM bar DROPPED, so the glass reads continuous,
              // not gridded into a cage. Pitch widened a touch (1.6→2.0) for
              // fewer, finer lines.
              const nn = Math.max(2, Math.min(6, Math.round(span / 2.0))), step = span / nn;
              for (let i = 1; i < nn; i++) dbox(-span / 2 + i * step, winCy, faceZ, 0.035, winPh, 0.04, MULL);
              dbox(0, winY0 - 0.04, f.z + outSgn * (WT / 2 + 0.05), span + 0.2, 0.06, 0.08, TRIM);   // slim sill reveal
              dbox(0, winY1 + 0.04, f.z + outSgn * (WT / 2 + 0.05), span + 0.2, 0.06, 0.08, TRIM);   // slim header reveal
            } else {
              lbox(f.x, fy0 + sillH / 2, f.z, f.w, sillH, f.dd, color, wallOpt);
              lbox(f.x, fy1 - hdrH / 2, f.z, f.w, hdrH, f.dd, color, wallOpt);
              lbox(f.x, winCy, -d / 2 + jamb / 2, f.w, winPh, jamb, color, wallOpt);
              lbox(f.x, winCy, d / 2 - jamb / 2, f.w, winPh, jamb, color, wallOpt);
              const span = d - 2 * jamb;
              glazeOpening(f.x, winCy, 0, span, winPh);
              const faceX = f.x + outSgn * (WT / 2 + 0.04);
              // CLEAN-GLASS mullions (see horiz face note): hairline reveals, no
              // mid-storey transom bar, slim sill/header.
              const nn = Math.max(2, Math.min(6, Math.round(span / 2.0))), step = span / nn;
              for (let i = 1; i < nn; i++) dbox(faceX, winCy, -span / 2 + i * step, 0.04, winPh, 0.035, MULL);
              dbox(f.x + outSgn * (WT / 2 + 0.05), winY0 - 0.04, 0, 0.08, 0.06, span + 0.2, TRIM);
              dbox(f.x + outSgn * (WT / 2 + 0.05), winY1 + 0.04, 0, 0.08, 0.06, span + 0.2, TRIM);
            }
          }
        }
      }
    }

    // Single-storey shops do not need a giant customer-facing rooftop stair
    // rig. Climbable buildings reserve a dedicated open strip on the -x side.
    const slabMinX = hasStairs ? ixMin + stairW : ixMin;
    const slabW = ixMax - slabMinX, slabCx = (slabMinX + ixMax) / 2, slabD = izMax - izMin, slabCz = (izMin + izMax) / 2;
    // INTERMEDIATE floor slabs are tracked (mesh + plat record + colour) so a
    // later elevator shaft can be carved through them — the lift cab travels a
    // continuous vertical chase, so the floors it passes need a hole at the
    // shaft column. The ROOF slab (top) is never carved (the headhouse sits on
    // it) and the ground plane is terrain, so only L=1..storeys-1 are tracked.
    const floorSlabs = [];
    for (let L = 1; L <= storeys; L++) {
      const isRoof = L === storeys;
      const sm = lbox(slabCx, L * FH - 0.1, slabCz, slabW, 0.2, slabD, isRoof ? 0x9fa6ad : 0xb9bec6, { plat: true, los: true, cast: isRoof });
      if (!isRoof) floorSlabs.push({ mesh: sm, y: L * FH - 0.1, plat: plats[plats.length - 1], col: 0xb9bec6 });
    }
    const rTop = storeys * FH;
    // FACADE MASSING: parapet height varies per building (0.55..1.05, was a
    // flat 0.7) and a coping lip caps it — rooflines stop reading identical.
    const pp = 0.55 + vhash * 0.5;
    lbox(slabCx, rTop + pp / 2, d / 2 - WT / 2, slabW, pp, WT, 0x8b9097, { los: true });
    lbox(w / 2 - WT / 2, rTop + pp / 2, slabCz, WT, pp, slabD, 0x8b9097, { los: true });
    lbox(slabCx, rTop + pp / 2, -d / 2 + WT / 2, slabW, pp, WT, 0x8b9097, { los: true });
    lbox(-w / 2 + WT / 2, rTop + pp / 2, slabCz, WT, pp, slabD, 0x8b9097, { los: true });
    dbox(slabCx, rTop + pp + 0.05, d / 2 - WT / 2, slabW + 0.1, 0.1, WT + 0.16, TRIM);
    dbox(w / 2 - WT / 2, rTop + pp + 0.05, slabCz, WT + 0.16, 0.1, slabD + 0.1, TRIM);
    dbox(slabCx, rTop + pp + 0.05, -d / 2 + WT / 2, slabW + 0.1, 0.1, WT + 0.16, TRIM);
    dbox(-w / 2 + WT / 2, rTop + pp + 0.05, slabCz, WT + 0.16, 0.1, slabD + 0.1, TRIM);

    // switchback stairs (two lanes alternating; ported from disaster_arena).
    // Step COUNT derives from FH at the proven ~0.44 rise (the old 4.0/9): a
    // taller floor gets MORE steps, never taller ones — the climb is really the
    // ramp platform, but the treads must keep reading like legal stairs.
    //
    // OWNER ("stairs suck — you fall through them down many floors"). The walk
    // surface is CBZ.platforms ramp records (physics.js resolves them). Root
    // cause of the fall-through was GAPS in that coverage: (1) the ramp AABB was
    // inset 0.04 on BOTH X edges and only one lane wide, so a player stepping to
    // the lane edge stood OFF the support → dropped to floorAt; (2) the two
    // lanes left a hairline seam at their shared edge; (3) the ramp AABB and the
    // flat landing overlapped by only 0.1m, so at speed you could clear both in
    // one frame and the switchback turn (lane A→landing→lane B) had a bare strip
    // where neither AABB covered you. CONTRACT (unchanged): each flight pushes
    // one ramp record + a plat landing. We just close the gaps — the ramp AABB
    // now covers the FULL lane footprint with a small overhang so adjacent lanes
    // (and the stair walls) overlap with no seam, the AABB extends in Z past the
    // slope ends so it OVERLAPS both this flight's landing and the previous one
    // (the clamp keeps the extension flat at the correct floor top), and the
    // landing is widened/deepened to bridge the turn. Coverage is now CONTINUOUS:
    // every XZ point on the climb sits inside some ramp AABB or plat box.
    const nSteps = Math.round(FH / 0.45), LD = 1.1, zA = izMin + 0.3, zB = izMax - 0.3, laneW = stairW / 2;
    const OUT_OVL = 0.22;    // X overhang OUTWARD only (toward the stair walls)
    const Z_OVL = 0.9;       // Z extension so each ramp AABB overlaps its landings
    for (let k = 0; hasStairs && k < storeys; k++) {
      const dir = (k % 2 === 0) ? 1 : -1;
      const startZ = dir > 0 ? zA : zB, endZ = dir > 0 ? zB : zA;
      const rampEndZ = endZ - dir * LD;
      const leftLane = (k % 2 === 0);
      const lx0 = leftLane ? ixMin : ixMin + laneW, lxc = lx0 + laneW / 2;
      // FULL-LANE X footprint. The two lanes are at DIFFERENT heights over the
      // same z-band (a switchback), so they must NOT overlap in X or the
      // resolver (keeps the higher top) would snap a climber up a whole floor at
      // the seam. So we ABUT exactly at the shared centre edge (ixMin+laneW) —
      // no inset there closes the seam gap — and overhang only OUTWARD, toward
      // the stair WALL, so the wall-side gap is covered too. Result: continuous
      // X coverage across the full stair width with no levitation strip.
      const ax0 = ox + lx0 - (leftLane ? OUT_OVL : 0);
      const ax1 = ox + lx0 + laneW + (leftLane ? 0 : OUT_OVL);
      // Z AABB runs the slope plus an overlap margin into BOTH landings (this
      // flight's top landing and the previous flight's). The slope itself
      // (z0..z1) is unchanged; physics.js clamps t to [0,1], so the extended
      // band is FLAT at the correct floor height and overlaps the landings.
      // Clamped to the interior z-range so the flat extension never pokes a
      // phantom shelf out through the front/back wall.
      const az0 = Math.max(oz + izMin, oz + Math.min(startZ, rampEndZ) - Z_OVL);
      const az1 = Math.min(oz + izMax, oz + Math.max(startZ, rampEndZ) + Z_OVL);
      const ramp = {
        minX: ax0, maxX: ax1,
        minZ: az0, maxZ: az1,
        top: (k + 1) * FH,
        ramp: { z0: oz + startZ, z1: oz + rampEndZ, y0: k * FH, y1: (k + 1) * FH },
      };
      CBZ.platforms.push(ramp); plats.push(ramp);
      const runLen = Math.abs(rampEndZ - startZ), runDepth = runLen / nSteps, rise = FH / nSteps;
      for (let i = 1; i <= nSteps; i++) {
        const vtop = k * FH + (i - 0.5) * rise, cz2 = startZ + dir * (i - 0.5) * runDepth;
        lbox(lxc, vtop - 0.13, cz2, laneW - 0.16, 0.26, runDepth + 0.04, 0xa7adb5, { cast: false });
      }
      // LANDING: full stair width, deepened so it bridges the switchback turn —
      // it overlaps the END of this flight's ramp AND the START of the next
      // flight's ramp (which begins at endZ on the opposite lane). The Z span is
      // clamped to the interior so it sits flush with the turn wall, then the
      // box is rebuilt from the clamped bounds so depth and centre stay matched.
      const lz0 = Math.max(izMin, Math.min(rampEndZ, endZ) - 0.55);
      const lz1 = Math.min(izMax, Math.max(rampEndZ, endZ) + 0.55);
      const lzc = (lz0 + lz1) / 2, landD = lz1 - lz0;
      lbox(ixMin + stairW / 2, (k + 1) * FH - 0.08, lzc, stairW + 2 * OUT_OVL, 0.2, landD, 0xb4b9c1, { plat: true, los: true, cast: false });
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
    const masonryTrim = (FACADE === "residential" || FACADE === "fortified");
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
    if (!opts.garageGround) {
      if (doorSide !== 0) dbox(0, 0.33, -d / 2 - 0.025, w + 0.1, 0.66, 0.09, BASE);
      if (doorSide !== 1) dbox(0, 0.33, d / 2 + 0.025, w + 0.1, 0.66, 0.09, BASE);
      if (doorSide !== 2) dbox(-w / 2 - 0.025, 0.33, 0, 0.09, 0.66, d + 0.1, BASE);
      if (doorSide !== 3) dbox(w / 2 + 0.025, 0.33, 0, 0.09, 0.66, d + 0.1, BASE);
    }
    if (masonryTrim) {
      // corner PILASTERS tying the floors to the parapet line (masonry only)
      for (const sxp of [-1, 1]) for (const szp of [-1, 1])
        dbox(sxp * (w / 2 - 0.02), (rTop + pp) / 2, szp * (d / 2 - 0.02), 0.5, rTop + pp, 0.5, PIL);
    } else {
      // glass tower: a HAIRLINE corner reveal (a thin pinstripe, not a cage
      // post) so the curtain-wall edge still catches light without framing the
      // building. 0.1×0.1 vs the old 0.5×0.5 — ~96% less corner geometry volume.
      for (const sxp of [-1, 1]) for (const szp of [-1, 1])
        dbox(sxp * (w / 2 + 0.01), (rTop + pp) / 2, szp * (d / 2 + 0.01), 0.1, rTop + pp, 0.1, MULL);
    }
    flushDeco();

    return { group: bgroup, ox, oz, w, d, h: storeys * FH, storeys, facade: FACADE, boarded: !!opts.boarded, office: !!opts.office, colliders: cols, platforms: plats, windows, lbox, FH,
      hasStairs, stairW, clearFloorPoint, wt: WT,   // wt: exact wall thickness, so elevators.js seats rigs flush to the real facade
      floorSlabs,                                   // intermediate floor slabs (carvable for an elevator shaft — see CBZ.cityCarveShaft)
      shaftRects,                                   // reserved shaft footprints (building-local), so clearFloorPoint keeps later furniture/props out of the chase
      roofCx: ox + slabCx, roofCz: oz + slabCz };   // world centre of the solid roof slab (clear of the -x stairwell)
  }
  // The connected island district reuses the exact same enterable shell and
  // stair rig, so every added tower behaves like the original city buildings.
  CBZ.cityMakeBuilding = makeBuilding;

  // ---- ELEVATOR-SHAFT CARVE ----------------------------------------------
  // city/elevators.js owns the lift cab + the visible enclosed shaft column,
  // but the per-floor SLABS belong to the building, so the building carves the
  // chase. Given a world-space column (centre wx/wz, half-extents hw/hd), this:
  //   1) reserves the column (building-local) in b.shaftRects so any LATER
  //      furniture/prop gates off it via clearFloorPoint (the chase stays empty);
  //   2) CARVES a clean rectangular hole through every INTERMEDIATE floor slab
  //      it crosses — the original slab mesh + its walk platform are replaced by
  //      up to four rim pieces (a picture-frame) around the hole, so the floor is
  //      visually + walkably intact everywhere EXCEPT the column the cab travels.
  // The roof slab (the headhouse stands on it) and the ground plane are never
  // touched. Idempotent enough for one call per shaft; cheap (a few thin boxes
  // per crossed floor, all on the shared cached material via mat()).
  CBZ.cityCarveShaft = function (b, wx, wz, hw, hd) {
    if (!b || !b.floorSlabs) return;
    // reserve the footprint (building-local) so furnishing/props avoid the chase
    if (b.shaftRects) b.shaftRects.push({ x0: wx - b.ox - hw, x1: wx - b.ox + hw, z0: wz - b.oz - hd, z1: wz - b.oz + hd });
    const hx0 = wx - hw, hx1 = wx + hw, hz0 = wz - hd, hz1 = wz + hd;
    const slabCol = 0xb9bec6;
    for (const fs of b.floorSlabs) {
      if (fs.carved) continue;
      const p = fs.plat;
      // slab world bounds come straight off its walk-platform record
      if (!p || hx1 <= p.minX || hx0 >= p.maxX || hz1 <= p.minZ || hz0 >= p.maxZ) continue; // column misses this slab
      fs.carved = true;
      // drop the solid slab: its mesh + its walk platform (both lists)
      if (fs.mesh && fs.mesh.parent) fs.mesh.parent.remove(fs.mesh);
      if (fs.mesh && CBZ.losBlockers) { const li = CBZ.losBlockers.indexOf(fs.mesh); if (li >= 0) CBZ.losBlockers.splice(li, 1); }
      for (const list of [CBZ.platforms, b.platforms]) { const i = list ? list.indexOf(p) : -1; if (i >= 0) list.splice(i, 1); }
      // clamp the hole to the slab and rebuild the four rim pieces (skip empties)
      const cx0 = Math.max(hx0, p.minX), cx1 = Math.min(hx1, p.maxX);
      const cz0 = Math.max(hz0, p.minZ), cz1 = Math.min(hz1, p.maxZ);
      const top = p.top, y = fs.y, th = 0.2;
      const piece = (x0, x1, z0, z1) => {
        if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return;
        const bw = x1 - x0, bd = z1 - z0;
        const g = new THREE.BoxGeometry(bw, th, bd);
        const mm = mat(slabCol); shadeGeo(g, false); mm.vertexColors = true;
        const m = new THREE.Mesh(g, mm);
        m.position.set((x0 + x1) / 2 - b.ox, y, (z0 + z1) / 2 - b.oz);
        m.castShadow = false; m.receiveShadow = true;
        b.group.add(m);
        if (CBZ.losBlockers) CBZ.losBlockers.push(m);
        const pl = { minX: x0, maxX: x1, minZ: z0, maxZ: z1, top };
        if (CBZ.platforms) CBZ.platforms.push(pl);
        if (b.platforms) b.platforms.push(pl);
      };
      piece(p.minX, p.maxX, p.minZ, cz0);          // -z band (full width)
      piece(p.minX, p.maxX, cz1, p.maxZ);          // +z band (full width)
      piece(p.minX, cx0, cz0, cz1);                // -x band (between the z bands)
      piece(cx1, p.maxX, cz0, cz1);                // +x band (between the z bands)
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  };

  // doorway world position + the inward normal, given the door side
  function doorInfo(ox, oz, w, d, side) {
    if (side === 0) return { x: ox, z: oz - d / 2, nx: 0, nz: 1 };
    if (side === 1) return { x: ox, z: oz + d / 2, nx: 0, nz: -1 };
    if (side === 2) return { x: ox - w / 2, z: oz, nx: 1, nz: 0 };
    return { x: ox + w / 2, z: oz, nx: -1, nz: 0 };
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
    // a box whose footprint we orient with the tangent (w = across-aisle span)
    function box(p, y, across, h, deep, col, o) {
      const bw = along ? deep : across, bd = along ? across : deep;
      return b.lbox(p.x, y, p.z, bw, h, bd, col, o);
    }
    function decor(p, y, across, h, deep, col) { return box(p, y, across, h, deep, col, { cast: false }); }
    function solidBox(p, y, across, h, deep, col) { return box(p, y, across, h, deep, col, { solid: true, cast: false }); }
    function glow(p, y, across, h, deep, col, ei) { return box(p, y, across, h, deep, col, { emissive: col, ei: ei || 0.5, cast: false }); }

    // ---- always-on dressing: floor mat + lit ceiling fixture ----
    const matP = pt(2.4, 0, 0.5);                  // just inside the doorway
    if (matP) b.lbox(matP.x, 0.005, matP.z, along ? 0.05 + 1.8 : 2.0, 0.05, along ? 2.0 : 0.05 + 1.8, 0x33373f, { cast: false });
    // a thin interior FLOOR-COVERING plane tinted per trade (just one cheap slab
    // covering the room centre at y~0.02) for material variety underfoot.
    const FLOOR_TINT = { bar: 0x2a1f2a, casino: 0x2a2418, drugs: 0x2e2c24, bank: 0x3a4250,
      cityhall: 0x3a4250, hospital: 0x3f4a52, gym: 0x24282e, guns: 0x303529, jewelry: 0x342c1c,
      pawn: 0x342c1c, electronics: 0x232a2c, security: 0x282e34, food: 0x3a322a, clothing: 0x352e38,
      barber: 0x2c3036, hardware: 0x342e26, gas: 0x2c3138 };
    const ftint = FLOOR_TINT[kind] || 0x2e3238;
    b.lbox(0, 0.02, 0, W - 1.2, 0.04, D - 1.2, ftint, { cast: false });
    // mood-tinted ceiling fixture per trade — bars/casinos run a moody saturated
    // glow, clinical trades (bank/hospital) cold-white, the rest warm shop light.
    const MOOD = { bar: [0xe85d8a, 0.6], casino: [0xc9a227, 0.62], drugs: [0x4caf6e, 0.4], bank: [0xdfe8ff, 0.5],
      cityhall: [0xdfe8ff, 0.5], hospital: [0xf2faff, 0.55], gym: [0x66d9c0, 0.45], guns: [0xbfd0a8, 0.4],
      jewelry: [0xffe08a, 0.55], pawn: [0xffe08a, 0.5], electronics: [0x39d0c0, 0.45], security: [0x49a0c0, 0.45] };
    const mood = MOOD[kind] || [0xffcf66, 0.42];
    b.lbox(0, FHl - 0.32, 0, along ? 0.5 : 3.2, 0.08, along ? 3.2 : 0.5, mood[0], { emissive: mood[0], ei: mood[1], cast: false });
    // a second, dimmer back-of-room fixture so deep rooms aren't black
    const bf = pt(2 * halfIn - 3.2, 0, 1.2);
    if (bf) b.lbox(bf.x, FHl - 0.32, bf.z, along ? 0.5 : 2.6, 0.07, along ? 2.6 : 0.5, mood[0], { emissive: mood[0], ei: mood[1] * 0.6, cast: false });

    // ---- the register on the back counter the caller already placed ----
    // (counter centre ≈ inDepth = 2*halfIn-2.8 in this frame; nudge a register
    //  block + a small glowing screen onto its top so it reads as a sales desk.)
    const regP = pt(2 * halfIn - 2.8, -0.7, 0.4) || pt(2 * halfIn - 2.8, 0, 0.4);
    if (regP) { decor(regP, 1.32, 0.7, 0.28, 0.5, 0x2a2f37); glow({ x: regP.x, z: regP.z }, 1.46, 0.4, 0.12, 0.06, kindAccent(kind), 0.7); }

    // ---- wall SHELVES / cases along BOTH side walls (off the aisle) ----
    // returns the list of placed shelf tops so the stocker can fill them.
    const shelfTops = [];
    function wallShelves(opt) {
      opt = opt || {};
      const lat = halfTan - (opt.deep || 0.7) - 0.05;   // hug the wall
      const colBody = opt.body || 0x6a7078, colTop = opt.top || 0x8a939c;
      const sh = opt.h || 1.4, deep = opt.deep || 0.7, span = opt.span || 2.0;
      for (const side of [-1, 1]) for (let i = 0; i < (opt.count || 3); i++) {
        const inDepth = (opt.start || 5.6) + i * (opt.step || 2.6);
        if (inDepth > 2 * halfIn - 1.4) break;          // don't punch the back wall
        const p = pt(inDepth, side * lat, 0.8);
        if (!p) continue;
        decor(p, sh / 2, span, sh, deep, colBody);
        decor(p, sh + 0.05, span, 0.1, deep, colTop);
        if (opt.glassFront) decor(p, sh * 0.62, span, sh * 0.7, 0.05, GLASS);
        shelfTops.push({ p, top: sh + 0.1, side, across: span, deep });
      }
    }
    // a free-standing floor RACK/island (e.g. clothing rounders, produce tables)
    function island(inDepth, lat, w2, h2, d2, col, o) {
      const p = pt(inDepth, lat, 0.8); if (!p) return null;
      box(p, h2 / 2, w2, h2, d2, col, o || { cast: false }); return p;
    }
    // stock props sitting on a shelf top: a tidy row of little coloured blocks
    function stockRow(st, col, n, size, h) {
      n = n || 4; size = size || 0.22; h = h || 0.3;
      const gap = (st.across - 0.3) / n;
      for (let i = 0; i < n; i++) {
        const lat = -st.across / 2 + 0.25 + i * gap;
        const lx = st.p.x + tx * lat, lz = st.p.z + tz * lat;
        const c = Array.isArray(col) ? col[i % col.length] : col;
        b.lbox(lx, st.top + h / 2, lz, size, h, size, c, { cast: false });
      }
    }

    // ---- shared BASE CLUTTER every shop gets (stools/chair, waste bin, a wall
    // clock plane, a potted plant, an emissive ceiling-tile strip). Cheap, and
    // every piece is gated by pt()'s clearFloorPoint so the aisle stays open.
    function baseClutter(accent) {
      // an emissive ceiling-tile STRIP running the room (extra light line)
      const cs = pt(halfIn, 0, 1.4);
      if (cs) b.lbox(cs.x, FHl - 0.18, cs.z, along ? 0.22 : halfTan * 1.2, 0.05, along ? halfTan * 1.2 : 0.22, 0xf2f4f8, { emissive: 0xf2f4f8, ei: 0.3, cast: false });
      // a potted PLANT in a front corner (planter box + green foliage cube)
      const pl = pt(4.4, halfTan - 1.1, 0.7);
      if (pl) { decor(pl, 0.25, 0.5, 0.5, 0.5, 0x6b4a2a); decor(pl, 0.85, 0.6, 0.7, 0.6, 0x3f9a4f); }
      // a WASTE BIN by the far front corner
      const wb = pt(4.0, -(halfTan - 0.9), 0.6);
      if (wb) decor(wb, 0.32, 0.42, 0.64, 0.42, 0x3a4048);
      // a WALL-CLOCK plane high on a side wall (white face, accent ring)
      const wc = pt(halfIn + 1.2, -(halfTan - 0.18), 0.6);
      if (wc) { decor(wc, 2.6, along ? 0.03 : 0.7, 0.7, along ? 0.7 : 0.03, 0xeef2f6); glow(wc, 2.6, along ? 0.02 : 0.78, 0.78, along ? 0.78 : 0.02, accent || 0x9fd8ee, 0.25); }
      // a couple of customer STOOLS / a waiting CHAIR near the entrance
      for (const side of [-1, 1]) {
        const s = pt(3.4, side * (halfTan - 1.0), 0.6);
        if (s) { decor(s, 0.45, 0.5, 0.9, 0.5, 0x2a2f37); decor(s, 0.92, 0.55, 0.1, 0.55, accent || 0x55606e); }
      }
    }
    baseClutter(kindAccent(kind));

    // dispatch to the trade-specific dresser
    switch (kind) {
      case "guns": {
        // gun racks: tall pegboard cabinets with stylised rifles hung in rows
        wallShelves({ body: 0x32363d, top: 0x44505c, h: 2.2, count: 3, glassFront: true });
        for (const st of shelfTops) {
          for (let r = 0; r < 2; r++) {
            const y = 0.85 + r * 0.7, n = 3, gap = (st.across - 0.4) / n;
            for (let i = 0; i < n; i++) {
              const lat = -st.across / 2 + 0.3 + i * gap;
              const lx = st.p.x + tx * lat, lz = st.p.z + tz * lat;
              b.lbox(lx, y, lz - 0, along ? 0.06 : 0.9, 0.1, along ? 0.9 : 0.06, 0x2b2f33, { cast: false });   // rifle body
              b.lbox(lx, y - 0.12, lz, 0.1, 0.18, 0.1, 0x6b4a2a, { cast: false });                              // grip
            }
          }
        }
        // TWO lit glass pistol display cases as freestanding islands, pistols inside
        for (const sideLat of [halfTan - 2.2, -(halfTan - 2.2)]) {
          const inD = 2 * halfIn - 5.2;
          island(inD, sideLat, along ? 1.0 : 2.6, 1.0, along ? 2.6 : 1.0, 0x2a2f37, { cast: false });
          const isl = pt(inD, sideLat, 0.8);
          if (isl) {
            decor(isl, 0.92, along ? 0.9 : 2.4, 0.55, along ? 2.4 : 0.9, GLASS);
            glow({ x: isl.x, z: isl.z }, 1.02, along ? 0.8 : 2.2, 0.04, along ? 2.2 : 0.8, 0x7ed957, 0.3);   // case under-light
            for (let g = -1; g <= 1; g++) { const lat = g * (along ? 0 : 0.6); const lx = isl.x + tx * (along ? g * 0.6 : 0), lz = isl.z + tz * (along ? 0 : g * 0.6); b.lbox(lx, 0.95, lz, along ? 0.5 : 0.07, 0.06, along ? 0.07 : 0.5, 0x1c1f22, { cast: false }); }  // pistols
          }
        }
        // stacked ammo CRATES against the back wall
        const ac = pt(2 * halfIn - 2.2, -(halfTan - 1.4), 0.7);
        if (ac) { decor(ac, 0.3, 1.2, 0.6, 0.8, 0x4a5232); decor(ac, 0.85, 0.9, 0.5, 0.6, 0x5a6240); }
        break;
      }
      case "jewelry":
      case "pawn": {
        // lit GLASS display cases along the walls, sparkling stock on top
        wallShelves({ body: 0x3a2f1c, top: 0xcaa64a, h: 1.1, count: 3, glassFront: true, span: 2.2 });
        for (const st of shelfTops) { glow(st.p, st.top + 0.05, st.across, 0.06, st.deep, 0xffe08a, 0.6); stockRow(st, [0xfff2b0, 0x9fe0ff, 0xff9ad0, 0xb9ffb0], 5, 0.16, 0.18); }
        if (kind === "pawn") island(2 * halfIn - 5.4, -(halfTan - 2.0), along ? 1.0 : 2.4, 1.3, along ? 2.4 : 1.0, 0x55606e, { cast: false }); // pawned junk pile
        break;
      }
      case "bar":
      case "casino": {
        // back bar with a lit BOTTLE WALL; bar stools; neon accent strip
        wallShelves({ body: 0x2a1f16, top: 0x3a2a1c, h: 1.8, count: 3, span: 2.4 });
        for (const st of shelfTops) for (let r = 0; r < 2; r++) stockRow({ p: st.p, top: 0.95 + r * 0.55, across: st.across }, [0x6fbf73, 0xbf6f6f, 0xc7b06f, 0x6f9fbf, 0xbf6fb0], 6, 0.14, 0.42);
        // NEON back-bar strip glowing behind the bottles (the trade accent colour)
        const neon = kind === "casino" ? 0xc9a227 : 0xe85d8a;
        const np = pt(2 * halfIn - 2.0, 0, 0.6);
        if (np) glow(np, 2.3, along ? 0.06 : halfTan * 1.4, 0.14, along ? halfTan * 1.4 : 0.06, neon, 0.95);
        // a row of bar stools facing the back counter
        for (let i = -1; i <= 1; i++) { const p = pt(2 * halfIn - 4.4, i * 1.6, 0.6); if (p) { decor(p, 0.5, 0.5, 1.0, 0.5, 0x2a2f37); decor(p, 1.02, 0.55, 0.12, 0.55, 0x6b4a2a); } }
        if (kind === "bar") {
          // ===== THE VELVET CLUB — a real VIP nightclub interior =====
          // a glowing multi-colour DANCE FLOOR mid-room, VIP velvet BOOTHS down
          // the walls, a DJ booth lit with neon, a mirror-ball ceiling glow and a
          // little interior velvet cordon so inside reads as the status apex. (The
          // exclusive ENTRANCE / rope / bouncer line is set up by clubRope + run
          // by city/club.js; this is the payoff you get once you're past it.)
          const FLOORCOLS = [0xe85d8a, 0x8a4fff, 0x39d0ff, 0xffd400];
          const dfP = pt(halfIn + 0.4, 0, 1.2) || pt(halfIn, 0, 1.2);
          if (dfP) {
            // a 3×3 checker of softly glowing floor panels = the dance floor
            for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
              const lat = gx * 0.95, dep = gz * 0.95;
              const lx = dfP.x + tx * lat + inx * dep, lz = dfP.z + tz * lat + inz * dep;
              const c = FLOORCOLS[(gx + gz + 2) % FLOORCOLS.length];
              b.lbox(lx, 0.04, lz, 0.9, 0.06, 0.9, c, { emissive: c, ei: 0.85, cast: false });
            }
            // a glinting MIRROR-BALL: a bright cube high over the floor + a wash glow
            b.lbox(dfP.x, FHl - 0.55, dfP.z, 0.4, 0.4, 0.4, 0xcfd6e0, { emissive: 0xbcd0ff, ei: 0.7, cast: false });
            b.lbox(dfP.x, FHl - 0.3, dfP.z, along ? 0.5 : 3.0, 0.05, along ? 3.0 : 0.5, 0x8a4fff, { emissive: 0x8a4fff, ei: 0.55, cast: false });
          }
          // VIP BOOTHS hugging the side walls: a velvet bench + a low cocktail
          // table glowing with bottle-service light. Two per side, off the aisle.
          for (let i = 0; i < 2; i++) for (const side of [-1, 1]) {
            const bp = pt(5.4 + i * 3.2, side * (halfTan - 1.1), 0.8);
            if (!bp) continue;
            decor(bp, 0.5, 2.0, 0.9, 0.7, 0x6a1622);                          // velvet booth back+seat
            decor(bp, 0.95, 2.0, 0.16, 0.7, 0x8a1f2b);                        // padded top trim
            const tp = pt(5.4 + i * 3.2, side * (halfTan - 2.3), 0.6);
            if (tp) { decor(tp, 0.55, 0.7, 0.1, 0.7, 0x1c1f24); glow({ x: tp.x, z: tp.z }, 0.62, 0.5, 0.05, 0.5, 0xffd166, 0.6); }   // lit cocktail table
          }
          // the DJ BOOTH at the back beside the bar: a raised console, two glowing
          // decks, and a tall neon backdrop strip (the club's signature pink).
          const djP = pt(2 * halfIn - 3.6, -(halfTan - 1.6), 0.8);
          if (djP) {
            decor(djP, 0.6, along ? 1.0 : 2.0, 1.2, along ? 2.0 : 1.0, 0x20242b);   // console body
            for (const e of [-0.45, 0.45]) { const lx = djP.x + tx * e, lz = djP.z + tz * e; b.lbox(lx, 1.24, lz, 0.36, 0.06, 0.36, 0x39d0ff, { emissive: 0x39d0ff, ei: 0.8, cast: false }); }  // decks
            b.lbox(djP.x + inx * 0.4, 1.8, djP.z + inz * 0.4, along ? 0.06 : 1.8, 1.4, along ? 1.8 : 0.06, 0xe85d8a, { emissive: 0xe85d8a, ei: 0.8, cast: false });   // neon backdrop
          }
          // an interior VELVET CORDON marking the elite back lounge (just a couple
          // of brass posts + a red span) so the VIP area reads as roped-off too.
          for (const side of [-1, 1]) { const cp = pt(2 * halfIn - 5.6, side * 1.3, 0.6); if (cp) decor(cp, 0.5, 0.14, 1.0, 0.14, 0xcaa64a); }
          { const cp = pt(2 * halfIn - 5.6, 0, 0.6); if (cp) glow(cp, 0.82, along ? 0.05 : 2.4, 0.06, along ? 2.4 : 0.05, 0x8a1f2b, 0.5); }
        } else {
          // CASINO: a couple of glowing felt TABLES + a row of SLOT MACHINES
          for (const lat of [-(halfTan - 2.4), halfTan - 2.4]) {
            const p = island(halfIn, lat, along ? 1.6 : 2.6, 0.95, along ? 2.6 : 1.6, 0x1f4d33, { cast: false });
            if (p) glow(p, 0.99, along ? 1.4 : 2.4, 0.04, along ? 2.4 : 1.4, 0x39d07a, 0.55);   // felt glow
          }
          // slot machine bank along one side wall, screens glowing gold/red
          const slotLat = halfTan - 0.85, scols = [0xffd400, 0xff3b3b, 0x39d0ff, 0xffd400];
          for (let i = 0; i < 4; i++) {
            const p = pt(5.0 + i * 1.6, slotLat, 0.6);
            if (!p) continue;
            decor(p, 0.7, along ? 0.5 : 1.0, 1.4, along ? 1.0 : 0.5, 0x2a2f37);                 // cabinet
            b.lbox(p.x, 1.15, p.z, along ? 0.06 : 0.6, 0.5, along ? 0.6 : 0.06, scols[i % scols.length], { emissive: scols[i % scols.length], ei: 0.7, cast: false });  // lit screen
          }
        }
        break;
      }
      case "food": {
        // diner: produce/serving tables down the room + a back kitchen line
        wallShelves({ body: 0x6b7078, top: 0xe8e8ee, h: 1.0, count: 3, span: 2.2 });
        for (const st of shelfTops) stockRow(st, [0xff6b5a, 0x6bbf4a, 0xffc94a, 0xff9a5a], 5, 0.2, 0.22);   // produce
        for (let i = 0; i < 2; i++) {                                          // two booth tables w/ bench seats
          for (const side of [-1, 1]) {
            const p = pt(5.0 + i * 3.2, side * (halfTan - 1.7), 0.8);
            if (p) {
              decor(p, 0.45, 1.0, 0.1, 0.7, 0x9aa0a8); decor(p, 0.22, 0.6, 0.44, 0.06, 0x6b4a2a); decor(p, 0.55, 1.0, 0.08, 0.7, 0xe8e8ee);  // top
              // a red vinyl bench on the wall side of each booth
              const bp = pt(5.0 + i * 3.2, side * (halfTan - 0.7), 0.8);
              if (bp) { decor(bp, 0.45, 1.2, 0.5, 0.4, 0xb23b3b); decor(bp, 0.95, 1.2, 0.5, 0.16, 0xc14b4b); }
            }
          }
        }
        // a glowing back-lit MENU BOARD above the counter (diner classic)
        const mb = pt(2 * halfIn - 1.8, 0, 0.6);
        if (mb) {
          glow(mb, 2.5, along ? 0.08 : halfTan * 1.3, 0.9, along ? halfTan * 1.3 : 0.08, 0xffae5a, 0.55);
          for (let i = -1; i <= 1; i++) { const lat = i * (halfTan * 0.4); const lx = mb.x + tx * lat, lz = mb.z + tz * lat; b.lbox(lx, 2.5, lz + (along ? 0 : 0), along ? 0.05 : 0.5, 0.18, along ? 0.5 : 0.05, 0x2a2018, { cast: false }); }  // menu lines
        }
        break;
      }
      case "bank":
      case "cityhall": {
        // a row of TELLER windows: a long counter the player faces, glass above
        const lat0 = -(halfTan - 1.8);
        for (let i = 0; i < 3; i++) {
          const p = pt(2 * halfIn - 3.0, lat0 + i * 1.8, 0.5);
          if (!p) continue;
          decor(p, 0.8, 1.5, 1.6, 0.6, 0x44505c);          // teller desk
          decor(p, 1.9, 1.5, 1.0, 0.06, GLASS);            // teller glass
          glow({ x: p.x, z: p.z }, 1.0, 0.3, 0.1, 0.06, 0x5b8bff, 0.7);  // counter screen
        }
        // a velvet queue rope (two short posts + a sagging rope) by the entrance
        for (const side of [-1, 1]) { const p = pt(4.6, side * 1.4, 0.6); if (p) { decor(p, 0.5, 0.16, 1.0, 0.16, 0xcaa64a); decor(p, 1.02, 0.22, 0.18, 0.22, 0x2a2f37); } }
        { const rp = pt(4.6, 0, 0.6); if (rp) decor(rp, 0.85, along ? 0.04 : 2.6, 0.06, along ? 2.6 : 0.04, 0x8a1f2b); }   // the rope span
        if (kind === "bank") {
          // a steel VAULT recessed into the back corner: thick frame + round door
          const vp = pt(2 * halfIn - 1.6, halfTan - 1.9, 0.7);
          if (vp) {
            solidBox(vp, 1.4, along ? 0.4 : 2.6, 2.8, along ? 2.6 : 0.4, 0x39414d);      // vault wall
            decor(vp, 1.4, along ? 0.12 : 2.0, 2.0, along ? 2.0 : 0.12, 0x6a7480);        // door face
            b.lbox(vp.x, 1.4, vp.z + (along ? 0 : 0.0), 0.34, 0.34, 0.34, 0xb9c0c8, { cast: false });  // wheel handle hub
            for (let s = 0; s < 4; s++) { const a = s / 4 * 6.28; b.lbox(vp.x + Math.cos(a) * 0.45, 1.4 + Math.sin(a) * 0.45, vp.z, 0.1, 0.4, 0.1, 0xb9c0c8, { cast: false }); }  // spokes
            glow({ x: vp.x, z: vp.z }, 1.4, 0.12, 0.12, 0.12, 0x5b8bff, 0.6);            // lock light
          }
        }
        break;
      }
      case "gym": {
        // weight benches + a rack of dumbbells + a couple of machines
        for (let i = 0; i < 2; i++) for (const side of [-1, 1]) {
          const p = pt(5.4 + i * 3.0, side * (halfTan - 1.8), 0.9);
          if (!p) continue;
          decor(p, 0.45, 0.5, 0.16, 1.7, 0x2a2f37);                 // bench pad
          for (const e of [-1, 1]) { const lx = p.x + tx * 0, lz = p.z + tz * 0; b.lbox(lx + (along ? e * 0.85 : 0), 0.7, lz + (along ? 0 : e * 0.85), 0.34, 0.34, 0.34, 0x44505c, { cast: false }); } // plates
        }
        // a back dumbbell rack
        const dr = pt(2 * halfIn - 3.4, halfTan - 1.6, 0.7);
        if (dr) { decor(dr, 0.5, along ? 0.6 : 2.4, 1.0, along ? 2.4 : 0.6, 0x32363d); for (let i = -2; i <= 2; i++) { const lx = dr.x + tx * i * 0.45, lz = dr.z + tz * i * 0.45; b.lbox(lx, 0.85, lz, 0.18, 0.18, 0.5, 0x6a7078, { cast: false }); } }
        // a full wall MIRROR strip (gyms are wall-to-wall mirrors)
        const mp = pt(8.0, -(halfTan - 0.55), 0.9); if (mp) decor(mp, 1.5, along ? 0.04 : 3.6, 2.6, along ? 3.6 : 0.04, 0xc6ecf7);
        // rubber FLOOR MATS down the centre of the gym floor
        for (let i = 0; i < 3; i++) {
          const fp = pt(5.5 + i * 2.6, 0, 0.9);
          if (fp) b.lbox(fp.x, 0.02, fp.z, along ? 1.6 : 1.8, 0.04, along ? 1.8 : 1.6, [0x222931, 0x2a323a][i % 2], { cast: false });
        }
        break;
      }
      case "clothing":
      case "barber": {
        if (kind === "clothing") {
          // round clothing racks (rounders) down the room, stocked with garments
          for (let i = 0; i < 2; i++) for (const side of [-1, 1]) {
            const p = pt(5.2 + i * 3.0, side * (halfTan - 1.9), 0.9);
            if (!p) continue;
            decor(p, 0.75, 0.1, 1.5, 0.1, 0x8a939c);                    // post
            decor(p, 1.5, 1.4, 0.08, 1.4, 0x6a7078);                    // ring bar
            const cols = [0xc792ea, 0x5b8bff, 0xff9e6b, 0x4caf6e, 0xe85d8a];
            for (let g = 0; g < 6; g++) { const a = g / 6 * Math.PI * 2, lx = p.x + Math.cos(a) * 0.6, lz = p.z + Math.sin(a) * 0.6; b.lbox(lx, 1.0, lz, 0.22, 0.9, 0.1, cols[g % cols.length], { cast: false }); }
          }
          wallShelves({ body: 0x55606e, top: 0x8a939c, h: 1.6, count: 3, span: 2.0 });
          for (const st of shelfTops) stockRow(st, [0xc792ea, 0x5b8bff, 0xff9e6b, 0x4caf6e], 4, 0.3, 0.16);  // folded stacks
          // a pair of dressed MANNEQUINS flanking the entrance display
          for (const side of [-1, 1]) {
            const p = pt(4.4, side * (halfTan - 1.4), 0.7);
            if (!p) continue;
            decor(p, 0.1, 0.5, 0.2, 0.5, 0x2a2f37);                 // base
            decor(p, 0.95, 0.34, 1.5, 0.22, side > 0 ? 0xc792ea : 0x5b8bff);  // torso/outfit
            decor(p, 1.85, 0.2, 0.26, 0.2, 0xd8c2a8);               // head
          }
        } else {
          // barber: two chairs facing wall mirrors
          for (const side of [-1, 1]) {
            const p = pt(6.0, side * (halfTan - 1.6), 0.9);
            if (!p) continue;
            decor(p, 0.45, 0.7, 0.9, 0.7, 0x32363d);            // chair base
            decor(p, 1.0, 0.6, 0.5, 0.6, 0x6b1f1f);            // seat
            const mp = pt(6.0, side * (halfTan - 0.5), 0.9); if (mp) decor(mp, 1.4, along ? 0.04 : 1.4, 1.8, along ? 1.4 : 0.04, 0xb9e6f7);
          }
        }
        break;
      }
      case "drugs": {
        // trap house: a beat couch, a low table with baggies, stash shelves
        const cp = pt(2 * halfIn - 4.0, halfTan - 1.7, 0.9);
        if (cp) { decor(cp, 0.4, along ? 0.9 : 2.4, 0.5, along ? 2.4 : 0.9, 0x4a423a); decor(cp, 0.75, along ? 0.9 : 2.4, 0.4, along ? 2.4 : 0.9, 0x3a352e); }
        const tp = pt(2 * halfIn - 6.0, halfTan - 2.4, 0.9);
        if (tp) { decor(tp, 0.4, 1.2, 0.1, 0.8, 0x2a2f37); stockRow({ p: tp, top: 0.45, across: 1.0 }, [0x4caf6e, 0xffffff, 0x4caf6e], 4, 0.14, 0.1); }
        wallShelves({ body: 0x3a352e, top: 0x4a423a, h: 1.6, count: 2 });
        for (const st of shelfTops) stockRow(st, [0x4caf6e, 0xe0e0e0, 0x6b4a2a], 4, 0.2, 0.2);
        break;
      }
      case "electronics": {
        wallShelves({ body: 0x2b2f33, top: 0x44505c, h: 1.7, count: 3, glassFront: true });
        for (const st of shelfTops) for (let r = 0; r < 2; r++) {           // glowing screens on two levels
          const lat0 = -st.across / 2 + 0.3, gap = (st.across - 0.6) / 3;
          for (let i = 0; i < 3; i++) { const lat = lat0 + i * gap, lx = st.p.x + tx * lat, lz = st.p.z + tz * lat, y = 0.8 + r * 0.55; b.lbox(lx, y, lz, along ? 0.05 : 0.34, 0.26, along ? 0.34 : 0.05, 0x39d0c0, { emissive: 0x39d0c0, ei: 0.6, cast: false }); }
        }
        // a big BIG-SCREEN TV demo wall + a glass gadget island in the middle
        const bs = pt(2 * halfIn - 1.8, 0, 0.6);
        if (bs) { decor(bs, 1.6, along ? 0.08 : 3.0, 1.8, along ? 3.0 : 0.08, 0x14171c); glow(bs, 1.6, along ? 0.05 : 2.7, 1.5, along ? 2.7 : 0.05, 0x39d0c0, 0.7); }
        const gi = pt(halfIn, 0, 1.0);
        if (gi) { decor(gi, 0.5, along ? 1.0 : 2.0, 1.0, along ? 2.0 : 1.0, 0x2a2f37); decor(gi, 1.04, along ? 0.95 : 1.9, 0.06, along ? 1.9 : 0.95, GLASS); }
        break;
      }
      case "hardware": {
        // tall industrial racks with crates/cans
        wallShelves({ body: 0x4a4034, top: 0x6b5a3a, h: 2.0, count: 3, span: 2.4 });
        for (const st of shelfTops) for (let r = 0; r < 2; r++) stockRow({ p: st.p, top: 0.7 + r * 0.65, across: st.across }, [0xffd166, 0x8a5a2b, 0xb9bec6, 0x66d9c0], 5, 0.26, 0.34);
        island(2 * halfIn - 5.0, -(halfTan - 2.0), along ? 1.0 : 2.4, 1.1, along ? 2.4 : 1.0, 0x6b5a3a, { cast: false });
        // a leaning STACK OF LUMBER + a hung tool pegboard on a side wall
        const lb = pt(6.6, halfTan - 1.2, 0.7);
        if (lb) for (let i = 0; i < 4; i++) decor({ x: lb.x, z: lb.z }, 0.18 + i * 0.16, along ? 0.34 : 2.6, 0.14, along ? 2.6 : 0.34, [0x8a5a2b, 0xa9743a][i % 2]);
        const pb = pt(halfIn, -(halfTan - 0.2), 0.6);
        if (pb) { decor(pb, 1.5, along ? 0.03 : 2.4, 1.4, along ? 2.4 : 0.03, 0x55452e); glow(pb, 1.5, along ? 0.02 : 2.5, 1.5, along ? 2.5 : 0.02, 0xffd166, 0.2); }
        break;
      }
      case "hospital": {
        // reception + two beds with curtains + a supply shelf
        for (let i = 0; i < 2; i++) {
          const p = pt(5.6 + i * 3.2, -(halfTan - 1.9), 0.9);
          if (!p) continue;
          decor(p, 0.45, 1.0, 0.16, 2.0, 0xe8e8ee);          // bed
          decor(p, 0.75, 1.0, 0.25, 0.5, 0xbfd8e6);          // pillow end
          const cp = pt(5.6 + i * 3.2, -(halfTan - 0.6), 0.9); if (cp) decor(cp, 1.4, along ? 0.05 : 2.2, 2.0, along ? 2.2 : 0.05, 0xbfe6d8);  // curtain
        }
        wallShelves({ body: 0xd8dde2, top: 0xffffff, h: 1.6, count: 2 });
        for (const st of shelfTops) stockRow(st, [0xff5a5a, 0x5aff8a, 0xffffff, 0x5a8aff], 4, 0.2, 0.2);
        break;
      }
      case "gas": {
        // convenience aisles inside + a cooler wall (showroom front handled outside)
        wallShelves({ body: 0x44505c, top: 0x6a7078, h: 1.5, count: 3, span: 2.2 });
        for (const st of shelfTops) for (let r = 0; r < 2; r++) stockRow({ p: st.p, top: 0.7 + r * 0.55, across: st.across }, [0xff6b5a, 0x6bbf4a, 0xffc94a, 0x5a8aff], 5, 0.18, 0.34);
        // a glowing cooler against the back wall
        const cp = pt(2 * halfIn - 2.6, 0, 0.6);
        if (cp) glow(cp, 1.1, along ? 0.4 : 3.0, 2.0, along ? 3.0 : 0.4, 0x9fe0ff, 0.4);
        // a SNACK ENDCAP island + a coffee/slushie machine on a side counter
        island(halfIn, 0, along ? 1.0 : 2.0, 1.2, along ? 2.0 : 1.0, 0x44505c, { cast: false });
        const cm = pt(2 * halfIn - 4.4, halfTan - 1.2, 0.7);
        if (cm) { decor(cm, 0.55, 0.6, 1.1, 0.6, 0x2a2f37); glow(cm, 1.05, 0.5, 0.18, 0.5, 0xff7a3b, 0.4); }
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
            for (let g = -1; g <= 1; g++) { const lx = mt.x + tx * g * 0.6, lz = mt.z + tz * g * 0.6; b.lbox(lx, 0.72, lz, 0.4, 0.5, 0.4, [0xc8cdd4, 0xa9b0b8][(g + 1) % 2], { cast: false }); }
          }
          const ss = pt(4.6, halfTan - 1.0, 0.7);
          if (ss) { decor(ss, 0.85, 0.08, 1.7, 0.08, 0x8a939c); glow(ss, 1.5, along ? 0.05 : 1.0, 0.5, along ? 1.0 : 0.05, 0x4fd0a0, 0.5); }
        } else {
          // car lot / chop shop showroom: a REAL detailed car on a display pad in
          // the centre (the spot the layout keeps clear), facing the glass front —
          // so the dealership/garage actually SHOWS the car, not an empty box.
          wallShelves({ body: 0x3a352e, top: 0x55606e, h: 1.4, count: 2, span: 2.0 });
          for (const st of shelfTops) stockRow(st, [0x2a2f37, 0x44505c], 4, 0.3, 0.3);   // tyre/part stacks
          const cp = pt(halfIn, 0, 1.2);
          if (cp) {
            b.lbox(cp.x, 0.06, cp.z, 3.2, 0.12, 3.2, 0x26282e, { cast: false });   // low display turntable pad
            realCarVisual(b, cp.x, 0.12, cp.z, Math.atan2(-inx, -inz), pickCarModel(kind === "chop" ? 0x8a1f24 : 0xe88a3c), false);
          }
        }
        break;
      }
      case "security": {
        // a wall of glowing CCTV monitors + an equipment shelf
        const mp = pt(2 * halfIn - 2.6, 0, 0.6);
        if (mp) for (let r = 0; r < 2; r++) for (let i = -1; i <= 1; i++) { const lat = i * 0.9; const lx = mp.x + tx * lat, lz = mp.z + tz * lat, y = 1.3 + r * 0.7; b.lbox(lx, y, lz, along ? 0.05 : 0.7, 0.5, along ? 0.7 : 0.05, 0x49a0c0, { emissive: 0x49a0c0, ei: 0.55, cast: false }); }
        wallShelves({ body: 0x32363d, top: 0x49566b, h: 1.6, count: 2 });
        for (const st of shelfTops) stockRow(st, [0x49566b, 0x2a2f37, 0x6a7078], 4, 0.22, 0.24);
        break;
      }
      default: {
        // generic store: tidy stocked shelving on both walls + display island
        wallShelves({ count: 3 });
        for (const st of shelfTops) stockRow(st, [0xff9e6b, 0x6bb6ff, 0x4caf6e, 0xc792ea], 4, 0.24, 0.24);
      }
    }
  }

  // a small accent colour per trade (register screen / glow tint)
  function kindAccent(kind) {
    const A = { guns: 0x7ed957, jewelry: 0xffe08a, pawn: 0xffe08a, bar: 0xe85d8a, bank: 0x5b8bff,
      food: 0xff9e6b, gym: 0x66d9c0, clothing: 0xc792ea, drugs: 0x4caf6e, electronics: 0x39d0c0,
      hardware: 0xffd166, hospital: 0xff6b6b, gas: 0xe24b4b, security: 0x49a0c0, casino: 0xc9a227,
      barber: 0x6bb6ff, realtor: 0x4fd0a0, carlot: 0xe88a3c, chop: 0xd0a23c, cityhall: 0xd8dde8 };
    return A[kind] || 0x9fd8ee;
  }

  // public hook (and back-compat wrapper) — every shop building gets dressed
  function furnishShop(b, lot, door) {
    const kind = (lot.building && lot.building.shop && lot.building.shop.kind) || (lot.kind) || "store";
    furnishInterior(b, kind, door);
  }
  CBZ.cityFurnishInterior = function (b, kind, door) { furnishInterior(b, kind, door); };

  function furnishHome(b, rng, tier, baseY) {
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
    // emissive CEILING FIXTURE (warm) — homes read lit. Higher tiers add a second
    // back-of-room fixture so the bigger spaces aren't dark in the corners.
    b.lbox(0, Y + FHl - 0.3, 0, 2.0, 0.1, 0.5, 0xffd9a0, { emissive: 0xffd9a0, ei: 0.42, cast: false });
    if (t >= 3) glowAt(-W / 2 + 2.6, FHl - 0.3, cz, 1.6, 0.1, 0.5, 0xffe6c0, 0.4, 1.0);

    // a HARDWOOD/tinted FLOOR slab so each tier reads a different finish underfoot.
    // On an upper floor the slab is clamped to the SOLID part of the plate — the
    // -x stair strip is an open shaft up there (only the ground floor has a
    // full foundation slab to cover).
    const FLOORHEX = [0x3a322a, 0x3a322a, 0x33373f, 0x2e2f36, 0x2a2c34][Math.min(4, t)];
    const fx0 = (Y > 0 && b.hasStairs) ? (-W / 2 + (b.wt || WT) + b.stairW + 0.1) : (-W / 2 + 0.7);
    const fx1 = W / 2 - 0.7;
    b.lbox((fx0 + fx1) / 2, Y + 0.02, 0, Math.max(1, fx1 - fx0), 0.04, D - 1.4, FLOORHEX, { cast: false });

    // PRIMARY BED in the back corner (base + mattress + pillow). Linen colour +
    // a headboard richen with tier.
    const linen = [0x6b7da0, 0x6b7da0, 0x5a6f9a, 0x7a6f8c, 0x8a6f9c][Math.min(4, t)];
    decor(-W / 2 + 2.0, 0.35, -D / 2 + 2.2, 2.0, 0.4, 1.3, 0x4a4036, 1.1);   // frame
    decor(-W / 2 + 2.0, 0.62, -D / 2 + 2.2, 1.9, 0.2, 1.25, linen, 1.1);     // mattress
    decor(-W / 2 + 2.0, 0.8, -D / 2 + 1.7, 1.9, 0.22, 0.5, 0xe8e8ee, 1.1);   // pillow
    if (t >= 2) decor(-W / 2 + 2.0, 1.1, -D / 2 + 2.8, 2.0, 0.9, 0.16, [0x55606e, 0x6b4a2a, 0x5a1622][Math.min(2, t - 2)], 1.1);  // headboard
    if (t >= 3) { decor(-W / 2 + 0.9, 0.45, -D / 2 + 2.2, 0.5, 0.5, 0.5, 0x55452e, 1.1); glowAt(-W / 2 + 0.9, 0.85, -D / 2 + 2.2, 0.4, 0.16, 0.4, 0xffe6b0, 0.5, 1.1); }  // nightstand + lamp
    // a SECOND bed for multi-bed tiers
    if (beds >= 2) {
      decor(-W / 2 + 2.0, 0.35, D / 2 - 2.4, 1.8, 0.4, 1.2, 0x4a4036, 1.1);
      decor(-W / 2 + 2.0, 0.62, D / 2 - 2.4, 1.7, 0.2, 1.15, 0x7a6f8c, 1.1);
      decor(-W / 2 + 2.0, 0.8, D / 2 - 1.95, 1.7, 0.22, 0.5, 0xe8e8ee, 1.1);
    }

    // KITCHEN counter along the back wall (every tier gets a real kitchen). Higher
    // tiers upgrade to a stone worktop + an island.
    decor(W / 2 - 1.6, 0.6, cz, 1.0, 1.0, Math.min(D - 3, 4), 0x55606e, 1.0);
    if (t >= 2) decor(W / 2 - 1.6, 1.12, cz, 1.1, 0.08, Math.min(D - 3, 4), 0xe6e8ee, 1.0);   // stone worktop
    if (t >= 3) { decor(W / 2 - 3.4, 0.55, cz, 1.6, 1.0, 2.4, 0x49505b, 1.0); decor(W / 2 - 3.4, 1.08, cz, 1.7, 0.08, 2.5, 0xc8ccd4, 1.0); }  // kitchen island

    // ---- a STUDIO (t1) keeps it sparse: a single chair + a small rug + a lamp ----
    if (t <= 1) {
      decor(W / 2 - 2.4, 0.45, -D / 2 + 2.6, 0.9, 0.5, 0.9, 0x6b5a4a, 1.0);          // armchair seat
      decor(W / 2 - 2.4, 0.95, -D / 2 + 3.0, 0.9, 0.6, 0.16, 0x6b5a4a, 1.0);         // chair back
      decor(W / 2 - 2.0, 0.02, -D / 2 + 2.8, 2.2, 0.04, 2.0, 0x5a4a4a, 1.2);         // small rug
      decor(W / 2 - 1.6, 0.7, -D / 2 + 1.4, 0.12, 1.4, 0.12, 0x2a2f37, 0.7);         // lamp pole
      glowAt(W / 2 - 1.6, 1.5, -D / 2 + 1.4, 0.42, 0.32, 0.42, 0xffe6b0, 0.6, 0.7);  // lamp shade
      glowAt(0, 2.4, -D / 2 + 0.18, 1.2, 0.8, 0.05, 0x5b8bff, 0.16, 0.4);            // one piece of art
      return;
    }

    // ---- t2+ : a full LIVING set (couch + coffee table + TV on a stand + rug) ----
    const sofaC = t >= 4 ? 0x5a4f6a : 0x8a5a2b;
    if (t >= 4) { // aerie gets an L-sectional
      decor(W / 2 - 2.6, 0.45, -D / 2 + 2.6, 2.8, 0.6, 1.0, sofaC, 1.2);
      decor(W / 2 - 1.4, 0.45, -D / 2 + 4.0, 1.0, 0.6, 2.4, sofaC, 1.2);
    } else {
      decor(W / 2 - 2.4, 0.45, -D / 2 + 2.4, 2.4, 0.6, 1.0, sofaC, 1.2);             // couch
    }
    decor(0, 0.4, 0, 1.4, 0.5, 0.9, t >= 4 ? 0xcaa64a : 0x9aa0a8, 1.0);             // coffee table (gold on aerie)
    decor(W / 2 - 1.4, 0.02, -D / 2 + 2.6, 3.0, 0.04, 2.6, [0,0,0x5a4a6a,0x4a3f55,0x4a3550][Math.min(4, t)], 1.4);  // rug

    // a TV on a low STAND / console facing the couch (dark screen + under-glow)
    decor(W / 2 - 1.6, 0.35, 0, 1.8, 0.5, 0.5, 0x2a2f37, 1.0);                       // stand
    const tvW = t >= 4 ? 2.2 : 1.4;
    decor(W / 2 - 1.6, 1.1, 0, tvW, 1.0, 0.08, 0x14171c, 1.0);                       // screen
    glowAt(W / 2 - 1.6, 1.1, 0, tvW - 0.3, 0.7, 0.05, 0x39516a, 0.4, 1.0);           // screen glow

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
      decor(0, 0.5, cz - 0.4, 1.2, 0.5, 2.6, 0x6b4a2a, 1.1);                          // dining table
      for (let i = -1; i <= 1; i++) for (const s of [-1, 1]) decor(0 + s * 0.95, 0.45, cz - 0.4 + i * 0.9, 0.45, 0.9, 0.45, 0x49505b, 1.1);  // chairs
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
    const W = b.w, D = b.d, Y = baseY || 0;
    idx = idx | 0;
    function put(x, y, z, w, h, d, color, pad) {
      if (!b.clearFloorPoint || b.clearFloorPoint(x, z, pad)) { b.lbox(x, Y + y, z, w, h, d, color, { cast: false }); return true; }
      return false;
    }
    const LINEN = [0x6b7da0, 0x7a6f8c, 0x5a6f9a, 0x6f8a7a];
    const SOFA = [0x8a5a2b, 0x55606e, 0x6b4a3a, 0x4a5a6b];
    const RUGC = [0x5a4a4a, 0x4a3f55, 0x3f4a55, 0x554a3f];
    const linen = LINEN[idx & 3], sofa = SOFA[(idx + 1) & 3], rug = RUGC[(idx + 2) & 3];
    // BED in the +x front corner (frame + mattress + pillow) — the -x side is
    // the stair strip, so the whole flat keeps to the solid half of the plate.
    const bx = W / 2 - 2.0, bz = -D / 2 + 2.2;
    if (put(bx, 0.35, bz, 1.9, 0.4, 1.3, 0x4a4036, 1.1)) {
      put(bx, 0.62, bz, 1.8, 0.2, 1.25, linen, 1.1);
      put(bx, 0.8, bz - 0.45, 1.8, 0.2, 0.5, 0xe8e8ee, 1.1);
    }
    // KITCHEN RUN along the back (+z) wall: counter body + a pale worktop
    // (pad 1.0, the furnishHome-kitchen precedent — wall-hugging pieces gate on
    // their centre point; a bigger pad can never clear the wall it hugs)
    const kw = Math.min(W * 0.32, 3.6), kz = D / 2 - 1.6;
    if (put(W / 2 - 2.6, 0.5, kz, kw, 1.0, 0.9, 0x55606e, 1.0))
      put(W / 2 - 2.6, 1.06, kz, kw + 0.1, 0.08, 1.0, 0xe6e8ee, 1.0);
    // LIVING SET right of centre: rug + couch (seat + back) + coffee table
    put(1.2, 0.02, 0.2, 3.0, 0.04, 2.4, rug, 1.6);
    if (put(1.2, 0.42, 1.0, 2.2, 0.55, 0.9, sofa, 1.2)) put(1.2, 0.85, 1.35, 2.2, 0.5, 0.22, sofa, 1.2);
    put(1.2, 0.3, -0.5, 1.1, 0.32, 0.7, 0x6b4a2a, 0.9);
    // a FLOOR LAMP by the couch — a warm-bright shade box reads lit while
    // staying opaque/non-emissive so the whole flat keeps batch-merging
    if (put(W / 2 - 1.2, 0.7, -0.6, 0.12, 1.4, 0.12, 0x2a2f37, 0.7))
      put(W / 2 - 1.2, 1.5, -0.6, 0.42, 0.3, 0.42, 0xffe6b0, 0.7);
  }
  // the island annex (city/expansion.js) builds shells through cityMakeBuilding
  // but has no dresser of its own — this is its furnishing hook.
  CBZ.cityFurnishApartment = function (b, baseY, idx) { furnishApartmentFloor(b, baseY, idx); };

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
      b.lbox(cx, Y + 1.04, monZ + dir * 0.04, 0.58, 0.36, 0.02, panel, { cast: false });
      b.lbox(cx, Y + 0.74, monZ, 0.12, 0.12, 0.12, 0x14181e, { cast: false });   // stand
      // chair: a swivel seat + a back, behind the desk on the seat side
      b.lbox(cx, Y + 0.42, seatZ, 0.6, 0.12, 0.6, chair, { cast: false });        // seat pad
      b.lbox(cx, Y + 0.78, seatZ + dir * 0.26, 0.6, 0.7, 0.12, chair, { cast: false });  // backrest
      b.lbox(cx, Y + 0.2, seatZ, 0.1, 0.4, 0.1, 0x14181e, { cast: false });        // post
      // SEAT ANCHOR (world coords): the chair point at floor height, facing the
      // monitor. The monitor sits straight across the desk in z, so the yaw is
      // atan2(dx,dz) toward it — the SAME facing convention peds use everywhere.
      anchors.push({
        x: b.ox + cx, y: Y, z: b.oz + seatZ,
        face: Math.atan2(0, monZ - seatZ),
      });
    }

    // lay desks across the SOLID half of the plate (right of the -x stairwell,
    // out to the +x wall), in columns × depth rows, so a wide core tower seats a
    // whole bullpen and a narrow walk-up a couple of desks. clearFloorPoint
    // silently drops any station landing in the stair strip or entrance aisle, so
    // the spread can run the full width without ever blocking the climb/door.
    const xHi = W / 2 - 2.0;                                  // first column off the +x wall
    const xLo = (b.hasStairs ? (-W / 2 + (b.wt || WT) + b.stairW + 1.6) : (-W / 2 + 2.0));  // stop clear of the stairwell
    const cols = Math.max(1, Math.min(4, Math.floor((xHi - xLo) / 3.0) + 1));
    const dxc = cols > 1 ? (xHi - xLo) / (cols - 1) : 0;
    const rows = Math.max(2, Math.min(6, Math.floor((D - 3.0) / 2.6)));
    const z0 = -D / 2 + 2.2, dz = rows > 1 ? (D - 4.4) / (rows - 1) : 0;
    for (let c = 0; c < cols; c++) {
      const cx = xHi - c * dxc;
      for (let r = 0; r < rows; r++) {
        const cz = z0 + r * dz;
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
    const W = b.w, D = b.d, FHl = b.FH || FH;
    const Y = baseY || 0;
    const lb = (x, y, z, w, h, d, c, o) => b.lbox(x, Y + y, z, w, h, d, c, o || { cast: false });
    const glow = (x, y, z, w, h, d, c, ei) => b.lbox(x, Y + y, z, w, h, d, c, { emissive: c, ei: ei || 0.5, cast: false });
    const MARBLE = 0xe6e8ee, GOLD = 0xcaa64a, DARKWOOD = 0x3a2b1e, VELVET = 0x5a1622, STONE = 0x9aa0a8;
    // ---- a polished MARBLE floor slab covering the whole penthouse ----
    lb(0, 0.02, 0, W - 1.4, 0.04, D - 1.4, 0xc8ccd4);
    // ---- warm COVE light running the perimeter + a central CHANDELIER ----
    for (let i = -1; i <= 1; i++) glow(i * (W / 3.0), FHl - 0.22, 0, W / 4.2, 0.08, 0.35, 0xffe6c0, 0.5);
    glow(0, FHl - 0.55, 0, 1.0, 0.5, 1.0, 0xfff0d0, 0.85);                          // chandelier body
    for (let a = 0; a < 8; a++) { const an = a / 8 * 6.283; glow(Math.cos(an) * 0.7, FHl - 0.5, Math.sin(an) * 0.7, 0.16, 0.3, 0.16, 0xffe6a0, 0.7); }  // chandelier drops
    // ---- MASTER BEDROOM on a raised marble plinth in the back corner ----
    lb(-W / 2 + 3.0, 0.08, -D / 2 + 3.2, 6.2, 0.16, 5.4, MARBLE);                   // plinth
    lb(-W / 2 + 3.0, 0.55, -D / 2 + 3.2, 3.0, 0.5, 2.4, DARKWOOD);                  // king frame
    lb(-W / 2 + 3.0, 0.9, -D / 2 + 3.2, 2.8, 0.26, 2.3, 0x6b7da0);                  // mattress
    lb(-W / 2 + 3.0, 1.12, -D / 2 + 2.2, 2.8, 0.3, 0.6, 0xe8e8ee);                  // pillows
    lb(-W / 2 + 3.0, 2.0, -D / 2 + 4.5, 3.2, 1.6, 0.2, VELVET);                     // velvet headboard wall
    for (const s of [-1, 1]) { lb(-W / 2 + 3.0 + s * 1.7, 1.4, -D / 2 + 2.0, 0.12, 2.6, 0.12, GOLD); }  // four-poster posts (front)
    for (const s of [-1, 1]) { lb(-W / 2 + 3.0 + s * 1.7, 0.45, -D / 2 + 4.4, 0.5, 0.7, 0.5, DARKWOOD); glow(-W / 2 + 3.0 + s * 1.7, 0.95, -D / 2 + 4.4, 0.4, 0.16, 0.4, 0xffe6b0, 0.5); }  // nightstands + lamps
    // ---- SUNKEN LOUNGE: wraparound sectional facing a wall-spanning media wall ----
    lb(0, 0.02, D / 2 - 5.0, 8.5, 0.04, 5.0, 0x4a3550);                             // luxe rug
    lb(0, 0.5, D / 2 - 3.2, 7.0, 0.65, 1.2, 0x6b2230);                              // sofa back run (velvet)
    for (const s of [-1, 1]) lb(s * 3.4, 0.5, D / 2 - 4.6, 1.2, 0.65, 3.0, 0x6b2230);  // sectional returns
    lb(0, 0.42, D / 2 - 5.6, 2.6, 0.42, 1.1, GOLD);                                 // gold coffee table
    lb(0, 1.5, D / 2 - 0.3, 5.0, 2.2, 0.12, 0x101319);                             // wall-spanning TV
    glow(0, 1.5, D / 2 - 0.38, 4.6, 1.8, 0.05, 0x39516a, 0.45);                    // screen glow
    // ---- MARBLE KITCHEN: island w/ waterfall counter + stools + back run ----
    lb(W / 2 - 3.4, 0.55, 0.4, 2.2, 1.0, 4.6, STONE);                              // island body
    lb(W / 2 - 3.4, 1.08, 0.4, 2.4, 0.1, 4.9, MARBLE);                             // waterfall worktop
    for (let i = -1; i <= 1; i++) { const sz = 0.4 + i * 1.4; lb(W / 2 - 5.0, 0.45, sz, 0.5, 0.9, 0.5, DARKWOOD); glow(W / 2 - 5.0, 0.92, sz, 0.42, 0.1, 0.42, GOLD, 0.3); }  // bar stools
    lb(W / 2 - 1.3, 0.6, -D / 2 + 3.4, 1.0, 1.1, 4.4, 0x49505b);                   // back counter run
    glow(W / 2 - 1.0, 1.7, -D / 2 + 3.4, 0.05, 0.9, 3.2, 0x9fe0ff, 0.3);           // backsplash glow
    // ---- a HOME BAR with a backlit bottle wall in the far corner ----
    lb(W / 2 - 2.4, 0.55, D / 2 - 2.6, 1.0, 1.0, 3.0, DARKWOOD);                   // bar counter
    glow(W / 2 - 1.0, 1.8, D / 2 - 2.6, 0.06, 1.6, 2.6, 0x39d0ff, 0.5);            // backlit bottle shelf
    for (let i = -2; i <= 2; i++) lb(W / 2 - 1.2, 1.4 + (i % 2) * 0.5, D / 2 - 2.6 + i * 0.5, 0.12, 0.4, 0.12, [0x6fbf73, 0xbf6f6f, 0xc7b06f][(i + 2) % 3]);  // bottles
    // ---- a long DINING table with chairs ----
    lb(W / 2 - 7.5, 0.5, D / 2 - 4.5, 1.4, 0.5, 3.8, DARKWOOD);
    glow(W / 2 - 7.5, 0.78, D / 2 - 4.5, 0.9, 0.04, 3.2, 0xffe6c0, 0.18);          // candlelit runner
    for (let i = -1; i <= 1; i++) for (const s of [-1, 1]) lb(W / 2 - 7.5 + s * 1.1, 0.45, D / 2 - 4.5 + i * 1.2, 0.5, 0.9, 0.5, VELVET);  // chairs
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
    const STOREYS = 30;                                  // double the 15-storey Twin Towers
    const color = 0x223040;                              // dark glass-tower mullion tone
    // reuse the proven shell: tall enough that makeBuilding's `modern` (storeys>=3)
    // curtain-wall path lights up on every floor; garageGround makes the ground a
    // drive-in deck. Stairs auto-engage (storeys>1, lot is wide), so it's climbable.
    const b = makeBuilding(root, lot.cx, lot.cz, w, d, STOREYS, color, side, { garageGround: true });
    const topY = (STOREYS - 1) * FH;                      // the top interior floor (penthouse)
    // PENTHOUSE — the apex home dressed across the whole top floor.
    furnishPenthouse(b, topY);
    deckCars(b, w, d);                                   // a few parked cars so the hangar deck reads as one
    // every floor between the garage deck and the penthouse is a dressed flat —
    // 28 storeys of stairwell views into OTHER people's homes is what makes the
    // penthouse on top read as the apex (merged tris; no extra draw calls).
    for (let k = 1; k < STOREYS - 1; k++) furnishApartmentFloor(b, k * FH, k);

    // A clean PENTHOUSE DOOR off the elevator landing on the top floor. The shell's
    // ground door slot was consumed by the garage deck, so the penthouse gets its
    // own swing door at floor level `topY`, set into the stairwell-side wall the
    // elevator lands beside — a real shut/open threshold into the living space.
    // It is an interior door (no exterior wall to pierce), so we hand it a short
    // partition wall + the standard hinged leaf, framed and flush like every door.
    const phDoorLocal = { x: -(w / 2) + WT + b.stairW + 1.0, z: 0, nx: 1, nz: 0 };  // faces into the room (+x)
    // a short solid partition flanking the door so the leaf has a wall to seat into
    const partW = 0.4, gap = DOORW;
    for (const s of [-1, 1]) {
      const pz = phDoorLocal.z + s * (gap / 2 + 1.4 + partW / 2);
      b.lbox(phDoorLocal.x, topY + (DOORH - 0.15) / 2 + 0.02, pz, partW, DOORH - 0.15, 2.8, 0x2a323c, { solid: true });   // partition matches the person-scaled leaf height
    }
    // build the standard clean leaf+frame, then lift the whole rig (jambs, header,
    // pivot, collider) up to the penthouse floor via makeDoorPanelAtY.
    makeDoorPanelAtY(b.group, lot.cx, lot.cz, phDoorLocal, DOORW, topY);
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
  function makeDoorPanelAtY(bgroup, ox, oz, localDoor, panelW, baseY) {
    const before = bgroup.children.length;
    const rec = makeDoorPanel(bgroup, ox, oz, localDoor, panelW);
    // lift every mesh/group makeDoorPanel just appended (jambs, header, pivot) up
    for (let i = before; i < bgroup.children.length; i++) bgroup.children[i].position.y += baseY;
    // lift the height-gated collider too so it blocks at the penthouse floor
    if (rec.col) { rec.col.y0 += baseY; rec.col.y1 += baseY; }
    rec.doorY = baseY;   // only auto-open when an actor is near this floor in Y
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    return rec;
  }

  function abandonDecor(b, rng, gangColor) {
    // graffiti on a couple of interior + exterior walls
    const gtex = graffitiTex(gangColor || 0xb079ea);
    for (let i = 0; i < 3; i++) {
      const gp = new THREE.Mesh(new THREE.PlaneGeometry(2.6 + rng() * 1.5, 1.4 + rng()),
        new THREE.MeshBasicMaterial({ map: gtex, transparent: true, depthWrite: false }));
      const face = (rng() * 4) | 0;
      const inset = 0.25;
      if (face === 0) { gp.position.set((rng() - 0.5) * (b.w - 3), 1.6, -b.d / 2 + inset); }
      else if (face === 1) { gp.position.set((rng() - 0.5) * (b.w - 3), 1.6, b.d / 2 - inset); gp.rotation.y = Math.PI; }
      else if (face === 2) { gp.position.set(-b.w / 2 + inset, 1.6, (rng() - 0.5) * (b.d - 3)); gp.rotation.y = Math.PI / 2; }
      else { gp.position.set(b.w / 2 - inset, 1.6, (rng() - 0.5) * (b.d - 3)); gp.rotation.y = -Math.PI / 2; }
      b.group.add(gp);
    }
    // trash / debris on the floor
    for (let i = 0; i < 6; i++) {
      let x = 0, z = 0, tries = 0;
      do { x = (rng() - 0.5) * (b.w - 3); z = (rng() - 0.5) * (b.d - 3); tries++; }
      while (tries < 8 && b.clearFloorPoint && !b.clearFloorPoint(x, z, 0.7));
      if (b.clearFloorPoint && !b.clearFloorPoint(x, z, 0.7)) continue;
      const s = 0.3 + rng() * 0.6;
      b.lbox(x, s / 2, z, s, s * (0.4 + rng()), s, [0x2f2c28, 0x3a352e, 0x444038][(rng() * 3) | 0], { cast: false });
    }
    // a busted-out couch
    if (!b.clearFloorPoint || b.clearFloorPoint(-b.w / 2 + 2.2, b.d / 2 - 2.4, 1.2)) {
      b.lbox(-b.w / 2 + 2.2, 0.4, b.d / 2 - 2.4, 2.0, 0.5, 0.9, 0x4a423a, { cast: false });
    }
    const clear = (x, z, pad) => (!b.clearFloorPoint || b.clearFloorPoint(x, z, pad == null ? 1.0 : pad));
    // a filthy MATTRESS PILE in a corner (a squatter's bed)
    {
      const mx = b.w / 2 - 2.2, mz = -b.d / 2 + 2.4;
      if (clear(mx, mz, 1.1)) {
        b.lbox(mx, 0.18, mz, 1.9, 0.3, 1.1, 0x6a5f50, { cast: false });           // mattress
        b.lbox(mx + 0.3, 0.42, mz - 0.2, 1.2, 0.2, 0.8, 0x5a5246, { cast: false }); // crumpled blanket
      }
    }
    // an OIL-DRUM FIRE: a rusty drum with an emissive ember glow + flame cube
    {
      const dx = (rng() - 0.5) * (b.w - 5), dz = (rng() - 0.5) * (b.d - 5);
      if (clear(dx, dz, 1.0)) {
        b.lbox(dx, 0.5, dz, 0.7, 1.0, 0.7, 0x3a2f24, { cast: false });            // drum
        b.lbox(dx, 1.12, dz, 0.5, 0.45, 0.5, 0xff7a1f, { emissive: 0xff5a14, ei: 0.95, cast: false }); // flame
        b.lbox(dx, 1.05, dz, 0.62, 0.12, 0.62, 0xffc24a, { emissive: 0xffb030, ei: 0.7, cast: false }); // ember rim
      }
    }
    // BROKEN FURNITURE: a toppled chair + a smashed table on its side
    {
      const cx2 = -b.w / 2 + 2.6, cz2 = 0.4;
      if (clear(cx2, cz2, 0.9)) { b.lbox(cx2, 0.25, cz2, 0.5, 0.5, 0.5, 0x4a4036, { cast: false }); b.lbox(cx2, 0.6, cz2 + 0.3, 0.5, 0.7, 0.08, 0x4a4036, { cast: false }); }
      const tx2 = b.w / 2 - 3.0, tz2 = b.d / 2 - 3.2;
      if (clear(tx2, tz2, 1.0)) { b.lbox(tx2, 0.35, tz2, 1.3, 0.08, 0.9, 0x55452e, { cast: false }); b.lbox(tx2 - 0.5, 0.18, tz2, 0.08, 0.36, 0.08, 0x55452e, { cast: false }); }
    }
    // extra GANG-TAG cluster (3 small tags) on one interior wall, tinted by the
    // gang colour so a faction's turf reads its own colour up close.
    {
      const gtex2 = graffitiTex(gangColor || 0xb079ea);
      const face = (rng() * 4) | 0, inset = 0.26;
      for (let i = 0; i < 3; i++) {
        const tg = new THREE.Mesh(new THREE.PlaneGeometry(1.2 + rng() * 0.6, 0.7 + rng() * 0.4),
          new THREE.MeshBasicMaterial({ map: gtex2, transparent: true, depthWrite: false }));
        const off = (i - 1) * 1.6;
        if (face === 0) { tg.position.set(off, 2.4, -b.d / 2 + inset); }
        else if (face === 1) { tg.position.set(off, 2.4, b.d / 2 - inset); tg.rotation.y = Math.PI; }
        else if (face === 2) { tg.position.set(-b.w / 2 + inset, 2.4, off); tg.rotation.y = Math.PI / 2; }
        else { tg.position.set(b.w / 2 - inset, 2.4, off); tg.rotation.y = -Math.PI / 2; }
        b.group.add(tg);
      }
    }
  }

  // ---- DERELICTS AT DISTANCE ----------------------------------------------
  // WHY: gang turf should read from a block away, not only once you're close
  // enough to see the boards. Two cheap silhouette tells on every abandoned
  // shell:
  //  • SOOT-STREAK decals bleeding down from the boarded upper windows (ONE
  //    cached canvas texture + ONE shared material; ≤4 planes per derelict —
  //    the same budget as the existing graffiti pass);
  //  • a BROKEN PARAPET: crumbled chunk boxes tipped on the roof corner and
  //    teetering on the lip, plus one fallen at the base (opaque, no
  //    colliders → batch-merged), so the ruined roofline reads in silhouette.
  // Deterministic per lot (position hash) — zero draws on the worldgen rng.
  let _sootMat = null;
  function sootStreakMat() {
    if (_sootMat) return _sootMat;
    const c = document.createElement("canvas"); c.width = 96; c.height = 64;
    const x = c.getContext("2d");
    for (let i = 0; i < 8; i++) {
      const sx = 3 + i * 11.5 + (i % 3) * 2, sw = 4 + (i % 3) * 3;
      const grd = x.createLinearGradient(0, 0, 0, 64);
      grd.addColorStop(0, "rgba(14,12,10,0.9)");
      grd.addColorStop(0.55, "rgba(14,12,10,0.38)");
      grd.addColorStop(1, "rgba(14,12,10,0)");
      x.fillStyle = grd; x.fillRect(sx, 0, sw, 64);
    }
    const tex = new THREE.CanvasTexture(c);
    _sootMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    return _sootMat;
  }
  function derelictExterior(b) {
    const vh = Math.abs(Math.sin(b.ox * 17.23 + b.oz * 91.7) * 43758.5453) % 1;
    // soot bleeding down from the boarded upper window bands (band bottom sits
    // ~k*FH + FH/2 - 0.31, so the streak hangs just under it — tracked off FH,
    // not a frozen offset, so it stays glued to the boards), patchy per face/floor.
    const sm = sootStreakMat();
    let made = 0;
    for (let k = 1; k < b.storeys && made < 4; k++) {
      for (let f = 0; f < 4 && made < 4; f++) {
        if ((((vh * 977) | 0) + k * 13 + f * 29) % 3 === 0) continue;   // skip ~1/3, varies per lot
        const span = Math.min((f < 2 ? b.w : b.d) * 0.55, 4.6);
        const p = new THREE.Mesh(new THREE.PlaneGeometry(span, 1.6), sm);
        const y = k * FH + FH / 2 - 0.95;
        if (f === 0) { p.position.set(0, y, -b.d / 2 - 0.03); p.rotation.y = Math.PI; }
        else if (f === 1) { p.position.set(0, y, b.d / 2 + 0.03); }
        else if (f === 2) { p.position.set(-b.w / 2 - 0.03, y, 0); p.rotation.y = -Math.PI / 2; }
        else { p.position.set(b.w / 2 + 0.03, y, 0); p.rotation.y = Math.PI / 2; }
        p.castShadow = false; b.group.add(p);
        made++;
      }
    }
    // the broken parapet: one corner of the roofline crumbled
    const sgn = vh < 0.5 ? 1 : -1;            // which corner gave way
    const ccol = 0x7a7f86, dcol = 0x63686f;
    function chunk(x, y, z, s, ry, rz, col) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.6, s * 1.15), mat(col));
      m.position.set(x, y, z); m.rotation.y = ry; m.rotation.z = rz;
      m.castShadow = false; m.receiveShadow = true; b.group.add(m);
    }
    const rx = sgn * (b.w / 2 - 1.1), rz = b.d / 2 - 0.9;
    chunk(rx, b.h + 0.32, rz - 0.4, 0.95, 0.7 * sgn, 0.3, ccol);                          // big slab tipped on the roof
    chunk(rx - sgn * 0.9, b.h + 0.18, rz - 1.2, 0.6, 1.9, -0.25, dcol);                   // smaller spall beside it
    chunk(sgn * (b.w / 2 - 0.2), b.h + 0.65, rz + 0.45, 0.55, 0.25, 0.55 * sgn, ccol);    // teetering on the lip
    chunk(rx, 0.28, b.d / 2 + 0.75, 0.8, 0.9, 0.1, dcol);                                 // fallen at the base
  }

  function makeStash(b, lot, gangColor) {
    // a duffel + crate near the back wall — the gang's cash/drugs/gun cache
    const sx = lot.cx, sz = lot.cz;
    const duffel = b.lbox(0, 0.35, b.d / 2 - 2.6, 1.0, 0.5, 0.5, 0x2a2f26, { emissive: gangColor || 0x4caf6e, ei: 0.18, cast: false });
    duffel.userData.transient = false;
    lot.building.stash = {
      x: sx, z: sz + (b.d / 2 - 2.6) * 0, looted: false,
      // wealth set when the gang takes the building (city/gangs.js may bump it)
      cash: 300 + ((b.storeys || 1) * 150), drugs: 1 + ((b.storeys || 1)), weapon: null,
      mesh: duffel,
    };
    // place the stash world point near the back-centre of the building
    lot.building.stash.x = lot.cx;
    lot.building.stash.z = lot.cz + (b.d / 2 - 2.6);
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
  function stampOwner(lot, idx) {
    const b = lot.building; if (!b || b.owner) return;
    const kind = lot.kind;
    if (kind === "abandoned") {
      b.owner = { type: "gang", id: null, name: "(gang turf)", buyable: false };  // gangs.js sets owner.id
    } else if (b.shop) {
      b.owner = { type: "business", id: null, name: nameFor(PROPRIETORS, lot, idx), buyable: true };
    } else if (b.home) {
      const home = b.home, landlord = nameFor(LANDLORDS, lot, idx);
      b.owner = {
        id: null, buyable: home.listed !== false,   // only the curated ladder is for sale
        get type() { return home.owned ? "player" : "landlord"; },
        get name() { return home.owned ? "You" : landlord; },
      };
    } else {
      // any other real building (towers without a home record, etc.)
      b.owner = { type: "landlord", id: null, name: nameFor(LANDLORDS, lot, idx), buyable: true };
    }
  }

  CBZ.cityBuildings = function (city) {
    const root = city.root, rng = city.rng;
    const C = CBZ.CITY;
    const placed = [], abandonedLots = [], homeLots = [];

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
    function districtStoreys(lot) {
      const kind = districtKind(lot);
      if (kind === "core") return 4 + ((rng() * 5) | 0);          // 4-8
      if (kind === "commercial") return 3 + ((rng() * 3) | 0);    // 3-5
      if (kind === "projects" || kind === "industrial") return 1 + ((rng() * 3) | 0);  // 1-3
      if (kind === "residential") return 2 + ((rng() * 4) | 0);   // 2-5
      return 2 + ((rng() * 3) | 0);
    }
    let chopShop = null, realtor = null, luxury = null, luxBuilding = null, clubLot = null, gunLot = null, jewelryLot = null;

    // shuffle the shop list, then float the gameplay-critical trades to the
    // front so they ALWAYS get placed; the rest fill in only sometimes, leaving
    // plenty of lots free to become residences (the property ladder).
    const ESSENTIAL = new Set(["guns", "drugs", "bank", "hospital", "food", "pawn", "realtor", "chop", "carlot", "jewelry", "clothing", "gym", "casino", "raceway", "arena", "transit", "cityhall"]);
    let shopQueue = SHOPS.slice();
    for (let i = shopQueue.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = shopQueue[i]; shopQueue[i] = shopQueue[j]; shopQueue[j] = t; }
    shopQueue = shopQueue.filter((s) => ESSENTIAL.has(s.kind)).concat(shopQueue.filter((s) => !ESSENTIAL.has(s.kind)));
    const nEssential = shopQueue.filter((s) => ESSENTIAL.has(s.kind)).length;
    let shopIdx = 0;

    // pick the flagship LUXURY tower lot (a corner, far from centre) up front
    let lux = null, bestD = -1;
    for (const lot of city.lots) {
      const dd = Math.hypot(lot.cx - city.center.x, lot.cz - city.center.z);
      if (dd > bestD) { bestD = dd; lux = lot; }
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
      const pool = city.lots.filter((l) => l !== lux);
      const n = LISTED_TIERS.length;
      for (let t = 0; t < n && pool.length; t++) {
        const idx = Math.min(pool.length - 1, Math.floor((t + 0.5) / n * pool.length));
        if (!reserved.has(pool[idx])) reserved.set(pool[idx], LISTED_TIERS[t]);
      }
    }

    for (const lot of city.lots) {
      const isLux = lot === lux;
      const forcedTier = reserved.get(lot) || null;   // a reserved listed-level lot
      const r = rng();
      // parks (open plazas) for breathing room — fewer than before. A park is a
      // "dumb unowned corner": no collider/door requirement. We still give it a
      // benign lot.building stub so the city has NO unowned lots — owned by the
      // city. Downstream that touches lot.building.door already null-guards it.
      if (!isLux && !forcedTier && r < (C.parkFrac || 0.08)) {
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

      const w = lot.w - 2, d = lot.d - 2;
      const toCx = city.center.x - lot.cx, toCz = city.center.z - lot.cz;
      const side = Math.abs(toCx) > Math.abs(toCz) ? (toCx > 0 ? 3 : 2) : (toCz > 0 ? 1 : 0);
      const door = doorInfo(lot.cx, lot.cz, w, d, side);
      const doorPt = { x: door.x + door.nx * 1.6, z: door.z + door.nz * 1.6, nx: door.nx, nz: door.nz };

      // ---- GANG-RUN HIDEOUT ----
      if (!isLux && !forcedTier && r < (C.parkFrac || 0.08) + (C.abandonedFrac || 0.30)) {
        // Keep the gang turf/stash gameplay, but remove the old boarded derelict
        // visual shell. Those near-windowless boxes were clipping into the read of
        // shops like Cluckin' Diner / The Trap House and made good glass blocks feel
        // cluttered. A hideout is now just another windowed city building that a
        // crew happens to control.
        const storeys = Math.max(1, Math.min(4, districtStoreys(lot)));
        const color = TOWER_PALETTE[(rng() * TOWER_PALETTE.length) | 0];
        rng(); // preserve the old facade-variant draw so later shop placement stays stable
        const b = makeBuilding(root, lot.cx, lot.cz, w, d, storeys, color, side, { facade: "office" });
        lot.kind = "abandoned";
        lot.building = { ...b, name: "Gang Hideout", sign: color, side, door: doorPt, abandoned: true, gang: null };
        makeStash(b, lot, 0x4caf6e);
        abandonedLots.push(lot);
        placed.push(lot);
        continue;
      }

      // ---- REAL: a business or a residence (and never a shop on the luxury lot) ----
      // Essentials are placed unconditionally; extras only ~40% of the time, so
      // the remaining real lots become furnished, sellable HOMES.
      let shop = null;
      if (!isLux && !forcedTier) {
        if (shopIdx < nEssential) shop = shopQueue[shopIdx++];
        else if (shopIdx < shopQueue.length && rng() < 0.4) shop = shopQueue[shopIdx++];
      }

      if (shop) {
        const color = lightenWall(shop.sign);
        // shops rise with their district: core trades get storeys of homes
        // over the storefront (city blocks read dense downtown), commercial a
        // floor or two; everywhere else keeps the catalogue height. Interior
        // stamps (counter/rack/cases) are hasStairs-aware, so taller is safe.
        const dk = districtKind(lot);
        const shopStoreys = dk === "core" ? Math.max(shop.storeys, 3 + ((rng() * 3) | 0))
          : dk === "commercial" ? Math.max(shop.storeys, 2 + ((rng() * 2) | 0))
          : shop.storeys;
        // No deliberately sealed facades in the city pass. Banks/security still
        // get normal office-style windows so they cannot become the blank blocks
        // that visually crowd or clip into neighboring shops.
        const specialFacade = (shop.kind === "bank" || shop.kind === "security") ? "office" : undefined;
        const b = makeBuilding(root, lot.cx, lot.cz, w, d, shopStoreys, color, side, { showroom: !!(shop.gas || shop.carlot || shop.chop), retail: !!shop.retail, facade: specialFacade });
        signAwning(b, side, w, d, shop.sign, shop.name, shop.kind);
        // Counter toward the back, vendor behind it. On climbable buildings the
        // counter is shifted onto the solid side of the room so it never crosses
        // the dedicated stair strip.
        let ccx = door.nx * (w / 2 - 2.8), ccz = door.nz * (d / 2 - 2.8);
        let cw = door.nx ? 0.8 : Math.min(w - 2, 4.5);
        const cd = door.nz ? 0.8 : Math.min(d - 2, 4.5);
        if (b.hasStairs) {
          const stairRight = -w / 2 + WT + b.stairW;
          if (cw > 1) {
            const roomRight = w / 2 - WT;
            cw = Math.min(cw, Math.max(1.8, roomRight - stairRight - 1.0));
            ccx = (stairRight + roomRight) / 2;
          } else if (ccx - cw / 2 < stairRight + 0.5) {
            ccx = stairRight + 0.5 + cw / 2;
          }
          // Side-door layouts can point the behind-counter spot back toward the
          // stair strip. Keep the clerk on the solid floor too.
          ccx = Math.max(ccx, stairRight + 0.4 - door.nx * 1.2);
        }
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
        // the district field stacks HOMES over the storefront — stairs (and
        // anyone ducking upstairs mid-robbery) walk through them, so every
        // upper floor is a dressed flat, not a bare slab.
        for (let k = 1; k < shopStoreys; k++) furnishApartmentFloor(b, k * FH, (lot.i | 0) * 7 + (lot.j | 0) + k);
        if (shop.chop) {
          chopShop = lot;
          // a drive-in sell bay just outside the door
          lot.building.chopZone = { x: door.x + door.nx * 5, z: door.z + door.nz * 5, r: 5.5 };
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
          const stairRight = b.hasStairs ? (-w / 2 + WT + b.stairW) : -1e9;
          // door-relative depth + tangent → a world point clamped onto open floor
          const caseAt = function (depth, lat, extra) {
            let lx = inx * (depth - halfIn) + tgx * lat, lz = inz * (depth - halfIn) + tgz * lat;
            lx = Math.min(w / 2 - WT - 0.9, Math.max(Math.max(-w / 2 + WT + 0.9, stairRight + 0.9), lx));
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
        // Built by makeMegaTower(): ~30 storeys (double the island Twin Towers),
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
        const color = TOWER_PALETTE[(rng() * TOWER_PALETTE.length) | 0];   // drawn for BOTH paths so RNG stays stable
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
          const b = makeBuilding(root, lot.cx, lot.cz, w, d, storeys, color, side, { office: true, glassKind: "clear" });
          // dress EVERY storey above the lobby with a working office floor and
          // collect the seat anchors building-wide, then register them ONCE so
          // city/officejobs.js can seat a payroll of workers (witnesses + cash).
          const deskAnchors = [];
          for (let k = 1; k < storeys; k++) {
            const fa = furnishOfficeFloor(b, k * FH, (lot.i | 0) * 5 + (lot.j | 0) * 3 + k);
            if (fa && fa.length) for (let a = 0; a < fa.length; a++) deskAnchors.push(fa[a]);
          }
          // C2: officejobs.js DEFINES CBZ.cityRegisterOfficeDesks and stores the
          // anchors; optional-chained so the office still BUILDS if that file is
          // absent (just no seated workers — never a dead floor either way).
          if (deskAnchors.length) CBZ.cityRegisterOfficeDesks && CBZ.cityRegisterOfficeDesks(lot, deskAnchors);
          lot.kind = "office";
          lot.building = { ...b, name: "Office Tower", sign: color, side, door: doorPt, office: true, deskCount: deskAnchors.length };
          placed.push(lot);
          continue;
        }
        const b = makeBuilding(root, lot.cx, lot.cz, w, d, storeys, color, side);
        const listed = !!forcedTier;                 // only reserved lots are on the market
        const tierDef = forcedTier || GENERIC;
        // THE HOME lives on the TOP floor — home.floorY below — which is where
        // the Zillow tour / safehouse elevator actually lands. The tier
        // furnishing goes THERE (the old pass dressed y≈0, so arriving "home"
        // meant a bare plate). Every storey under it gets the generic
        // apartment dresser so the stair climb passes lived-in rooms.
        const topY = (storeys - 1) * FH;
        furnishHome(b, rng, tierDef, topY);
        for (let k = 0; k < storeys - 1; k++) furnishApartmentFloor(b, k * FH, (lot.i | 0) * 5 + (lot.j | 0) * 3 + k);
        resFacade(b, side, w, d, color, lot);                                   // residential exterior dressing
        lot.kind = "tower";
        lot.building = { ...b, name: "Apartments", sign: color, side, door: doorPt };
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
      const rigged = placed.filter((l) => l.building && l.building.group && l.building.hasStairs && !l.building.park);
      // ===== ELEVATORS — OWNER: "elevator only works on the massive building." =
      // The old policy capped lifts at the 5 TALLEST towers, so the city felt
      // like only the mega-tower had one. The engine is mesh-count bound, not
      // unbounded, so we serve a much LARGER but still bounded set: EVERY real
      // (non-derelict) climbable tower of 3+ storeys gets a working lift, up to
      // a generous cap, tallest FIRST so the biggest towers are always served
      // and the cap (if hit) only drops the shortest 3-storey walk-ups (which
      // still have their interior stairs). elevators.js (VERT) makes the rig
      // robust on ANY qualifying building, not just the flagship.
      const EV_CAP = 24;     // bounded for mesh-count; covers ~all mid/high-rises
      const evPool = rigged.filter((l) => !l.building.abandoned && l.building.storeys >= 3)
        .sort((a, b) => (b.building.h || 0) - (a.building.h || 0));
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
      // The rig can only hang on a ±x face (its ramps interpolate along z), and
      // never the -x face of a building WITH interior stairs (that face is the
      // open stair shaft — a bridge there drops you down it). So the eligible
      // escape face is:
      //   door side 2 (-x door) → +x face  (m = +1)
      //   door side 3 (+x door) → -x face, only if NO interior stairs (m = -1)
      //   door side 0/1 (±z door) → +x face (m = +1)  [rear/side, off the front]
      // We STAMP lot.building.feSide = m on the chosen lots so elevators.js
      // builds to exactly that face (CONTRACT: buildings.js stamps the host
      // face, elevators.js builds full-height to it). Buildings with no legal
      // face go unserved — a clean doorway beats a ladder across the front.
      function escapeFaceFor(b) {
        const ds = b.side;
        if (ds === 3) return b.hasStairs ? 0 : -1;   // +x door: only -x face, and only if no stair shaft there
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
    const c = document.createElement("canvas"); c.width = 512; c.height = 128;
    const x = c.getContext("2d");
    // sign panel ground = the trade colour, with a subtle vignette
    const base = "#" + ("000000" + signHex.toString(16)).slice(-6);
    x.fillStyle = base; x.fillRect(0, 0, 512, 128);
    const grad = x.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, "rgba(255,255,255,0.18)"); grad.addColorStop(0.5, "rgba(0,0,0,0)"); grad.addColorStop(1, "rgba(0,0,0,0.28)");
    x.fillStyle = grad; x.fillRect(0, 0, 512, 128);
    // a thin bright border so the board pops
    x.strokeStyle = readableText(signHex) === "#ffffff" ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)";
    x.lineWidth = 6; x.strokeRect(6, 6, 500, 116);
    // the NAME, auto-shrunk to fit, with a hard drop shadow for legibility
    let fs = 62; x.textAlign = "center"; x.textBaseline = "middle";
    do { x.font = "900 " + fs + "px Fredoka, Arial Black, sans-serif"; fs -= 4; } while (x.measureText(name).width > 470 && fs > 22);
    x.fillStyle = "rgba(0,0,0,0.55)"; x.fillText(name, 258, 68);     // shadow
    x.fillStyle = readableText(signHex); x.fillText(name, 256, 64);  // face text
    t = new THREE.CanvasTexture(c); signTexCache.set(key, t); return t;
  }

  // a real STOREFRONT: a BIG illuminated sign board carrying the shop NAME baked
  // right onto the facade (no freestanding sidewalk sign), a canopy awning, a
  // perpendicular BLADE sign readable down the street, and display windows.
  // `along` = the facade runs perpendicular to the door normal.
  function signAwning(b, side, w, d, color, name, kind) {
    const di = doorInfo(0, 0, w, d, side);
    const along = Math.abs(di.nx) > 0.5;          // door faces ±X → storefront spans Z
    const tx = along ? 0 : 1, tz = along ? 1 : 0; // facade tangent
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
    const awn = new THREE.Mesh(new THREE.BoxGeometry(...fx(DOORW + 2.4, 0.32, 1.1)), mat(awnCol, { emissive: awnCol, ei: 0.4 }));
    awn.position.set(di.x + onx * 0.75, DOORH, di.z + onz * 0.75);   // hugs the DOOR opening, not the floor line
    awn.rotation[along ? "z" : "x"] = along ? 0.22 * di.nx : -0.22 * di.nz;   // street edge dips
    b.group.add(awn);
    // EMISSIVE NEON TRIM strip under the awning lip (cheap glowing accent line)
    const trim = new THREE.Mesh(new THREE.BoxGeometry(...fx(DOORW + 2.4, 0.06, 0.1)), mat(accent, { emissive: accent, ei: 0.95 }));
    trim.position.set(di.x + onx * 1.3, DOORH - 0.18, di.z + onz * 1.3); trim.castShadow = false;
    b.group.add(trim);
    // LIT SIGN BOARD across the facade above the awning — a glowing backing panel
    // (the trade colour) with the NAME painted on its street face. Board back
    // face rides 0.03 PROUD of the facade (real separation, no depth aliasing).
    const signH = 1.2, signY = FH + 0.45;
    const sign = new THREE.Mesh(new THREE.BoxGeometry(...fx(sw, signH, 0.22)), mat(color, { emissive: color, ei: 0.9 }));
    sign.position.set(di.x + onx * 0.14, signY, di.z + onz * 0.14);
    b.group.add(sign);
    // the painted name plate just proud of the board's street face. ONE plate:
    // with the board out on the facade there is no walkable side behind it.
    const nameMat = new THREE.MeshBasicMaterial({ map: signFaceTex(name, color), transparent: true });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(sw - 0.2, signH - 0.18), nameMat);
    plate.position.set(di.x + onx * 0.27, signY, di.z + onz * 0.27);
    if (along) plate.rotation.y = di.nx > 0 ? -Math.PI / 2 : Math.PI / 2;
    else if (di.nz > 0) plate.rotation.y = Math.PI;
    plate.renderOrder = 2; b.group.add(plate);
    // PERPENDICULAR BLADE SIGN — a small projecting sign so the store is readable
    // looking down the sidewalk (classic GTA storefront). Bracket + lit panel.
    // The blade glows the kind accent so trades read apart down the street.
    const bladeOut = 0.9;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(...fx(0.12, 0.9, 0.9)), mat(accent, { emissive: accent, ei: 0.85 }));
    blade.position.set(di.x + tx * (sw / 2 - 0.4) + onx * bladeOut, FH - 0.2, di.z + tz * (sw / 2 - 0.4) + onz * bladeOut);
    b.group.add(blade);
    // (DISPLAY WINDOWS REMOVED: two raw glass boxes used to sit flush in the
    // wall here, their street faces EXACTLY coplanar with the facade — the
    // z-fighting panels the player filmed. makeBuilding already glazes the
    // door flanks with pooled, shatterable storefront panes; these were
    // redundant, un-shatterable, and 4 extra meshes per shop.)
    // a floating crisp name sprite above the board too (always faces the camera),
    // tinted bright for a from-a-distance read.
    if (CBZ.makeLabelSprite) {
      const s = CBZ.makeLabelSprite(name, { color: spriteTint(color) });
      if (s) { s.position.set(di.x + onx * 0.6, FH + 1.7, di.z + onz * 0.6); s.scale.set(9, 2.25, 1); b.group.add(s); }
    }
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
    // a small floating VELVET CLUB rope-line label so the spot is unmistakable
    if (CBZ.makeLabelSprite) {
      const s = CBZ.makeLabelSprite("🍷 VELVET — VIP ONLY");
      if (s) { s.position.set(di.x + nx * 1.6, 2.9, di.z + nz * 1.6); s.scale.set(7, 1.6, 1); b.group.add(s); }
    }
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
    // AC WINDOW UNIT jutting from a first-floor window (boxy grey unit),
    // offset along the facade tangent away from the door.
    const ac = new THREE.Mesh(new THREE.BoxGeometry(...fx(0.8, 0.5, 0.5)), mat(0xb9bec6));
    ac.position.set(di.x + onx * 0.2 + tx * (along ? d : w) * 0.28, FH + 0.55, di.z + onz * 0.2 + tz * (along ? d : w) * 0.28);
    ac.castShadow = false; g.add(ac);
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
    return {
      lot: _megaTower.lot,
      penthouseDoor: _megaTower.penthouseDoor,
      helipad: lb.helipad || _helipad || null,
      hangar: lb.hangar || null,
    };
  };

  // ---- PARKS WORTH CROSSING -------------------------------------------------
  // WHY: a park was four cube trees on an empty rectangle — nothing answered
  // why you'd cut through one. Now the park is the block's meeting spot: a
  // stone FOUNTAIN at the heart (a landmark you can see down the street),
  // BENCHES facing it from the four path mouths, crossing GRAVEL PATH decals
  // (flat quads, the road-detail dm() pattern), a low HEDGE ring framing the
  // lawn (broken at the path mouths so the cut-through stays obvious), and TWO
  // tree silhouettes so the canopy reads varied. Everything is opaque
  // shared-material geometry the batcher collapses; only the water keeps its
  // one shared translucent material. Colliders: fountain basin + tree trunks
  // ONLY — benches/hedges/paths stay brushable so chases never snag.
  // rng budget: exactly the 12 draws the old pass made (worldgen stream safe).
  let _parkWaterM = null;
  function parkWaterMat() { return _parkWaterM || (_parkWaterM = new THREE.MeshLambertMaterial({ color: 0x7fd4ee, emissive: 0x2f7f9e, emissiveIntensity: 0.4, transparent: true, opacity: 0.78 })); }
  const _parkMats = new Map();
  function parkMat(c) { let m = _parkMats.get(c); if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); _parkMats.set(c, m); } return m; }
  function makePark(root, lot, rng) {
    const cx = lot.cx, cz = lot.cz, w = lot.w, d = lot.d;
    function add(geo, c, x, y, z) {
      const m = new THREE.Mesh(geo, parkMat(c));
      m.position.set(x, y, z);
      m.castShadow = false; m.receiveShadow = true; root.add(m);
      return m;
    }
    // GRAVEL PATHS: a cross of flat decals over the lawn (the lot grass plane
    // sits at y≈0.10) meeting on a plaza disc under the fountain.
    const GRAVEL = 0xb3a98a;
    const pa = add(new THREE.PlaneGeometry(w - 2.5, 1.8), GRAVEL, cx, 0.125, cz); pa.rotation.x = -Math.PI / 2;
    const pb = add(new THREE.PlaneGeometry(1.8, d - 2.5), GRAVEL, cx, 0.125, cz); pb.rotation.x = -Math.PI / 2;
    const plaza = add(new THREE.CircleGeometry(Math.min(w, d) * 0.17, 20), 0xa9a082, cx, 0.13, cz); plaza.rotation.x = -Math.PI / 2;
    // the FOUNTAIN: stone basin + a translucent water disc + a two-tier spout
    const STONE = 0x9aa0a8;
    const basin = add(new THREE.CylinderGeometry(1.7, 1.9, 0.6, 12), STONE, cx, 0.4, cz);
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.45, 16), parkWaterMat());
    water.rotation.x = -Math.PI / 2; water.position.set(cx, 0.62, cz);
    water.renderOrder = 1; root.add(water);
    add(new THREE.CylinderGeometry(0.22, 0.3, 0.9, 8), STONE, cx, 1.0, cz);
    add(new THREE.CylinderGeometry(0.55, 0.62, 0.16, 10), STONE, cx, 1.5, cz);
    const jet = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), parkWaterMat());
    jet.position.set(cx, 1.8, cz); jet.castShadow = false; root.add(jet);
    CBZ.colliders.push({ minX: cx - 1.9, maxX: cx + 1.9, minZ: cz - 1.9, maxZ: cz + 1.9, ref: basin, noCam: true });
    // BENCHES facing the fountain, set just OFF each path arm (frame + seat +
    // back; decor only — no colliders, so nobody snags on park furniture)
    const WOOD = 0x6b4a2a, IRON = 0x2a2f37;
    const bo = Math.min(w, d) * 0.21;
    for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const bx = cx + sx * bo + (sx === 0 ? 1.7 : 0);
      const bz = cz + sz * bo + (sz === 0 ? 1.7 : 0);
      const lwX = sx !== 0 ? 0.55 : 1.8, ldZ = sx !== 0 ? 1.8 : 0.55;
      add(new THREE.BoxGeometry(lwX * 0.9, 0.42, ldZ * 0.9), IRON, bx, 0.22, bz);
      add(new THREE.BoxGeometry(lwX, 0.12, ldZ), WOOD, bx, 0.5, bz);
      add(new THREE.BoxGeometry(sx !== 0 ? 0.12 : 1.8, 0.55, sx !== 0 ? 1.8 : 0.12), WOOD,
        bx + sx * 0.3, 0.82, bz + sz * 0.3);
    }
    // LOW HEDGE RING framing the lawn, broken at the four path mouths
    const HEDGE = 0x2f7a3f, hw = w / 2 - 1.2, hd = d / 2 - 1.2, gap = 2.4;
    for (const s of [-1, 1]) {
      const L = hw - gap / 2, Ld = hd - gap / 2;
      for (const e of [-1, 1]) {
        add(new THREE.BoxGeometry(L, 0.6, 0.5), HEDGE, cx + e * (gap / 2 + L / 2), 0.42, cz + s * hd);
        add(new THREE.BoxGeometry(0.5, 0.6, Ld), HEDGE, cx + s * hw, 0.42, cz + e * (gap / 2 + Ld / 2));
      }
    }
    // TWO TREE VARIANTS in the lawn quadrants (clear of paths/fountain):
    // a conifer (cone canopy) and a broadleaf (double-cube canopy), alternating
    let vi = 0;
    for (const [qx, qz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = cx + qx * w * 0.28 + (rng() - 0.5) * 2.0;
      const z = cz + qz * d * 0.28 + (rng() - 0.5) * 2.0;
      const th = 2.2 + rng() * 1.0;
      const trunk = add(new THREE.BoxGeometry(0.45, th, 0.45), 0x6b4a2a, x, th / 2 + 0.1, z);
      trunk.castShadow = true;
      CBZ.colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, ref: trunk, noCam: true });
      if (vi++ % 2 === 0) {
        add(new THREE.ConeGeometry(1.6, 3.4, 7), 0x35854a, x, th + 1.6, z).castShadow = true;
      } else {
        add(new THREE.BoxGeometry(2.6, 2.2, 2.6), 0x3f9a4f, x, th + 0.9, z).castShadow = true;
        add(new THREE.BoxGeometry(1.7, 1.4, 1.7), 0x4cab5c, x, th + 2.3, z).castShadow = true;
      }
    }
  }

  function lightenWall(hex) {
    const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    const lr = Math.round(r * 0.4 + 170 * 0.6), lg = Math.round(g * 0.4 + 174 * 0.6), lb = Math.round(b * 0.4 + 180 * 0.6);
    return (lr << 16) | (lg << 8) | lb;
  }
})();
