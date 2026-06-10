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
  let _gmat = null, _shardGeo = null, _shardGeoBig = null, _crackTex = null;
  function glassMat() { return _gmat || (_gmat = new THREE.MeshLambertMaterial({ color: 0xbfe9f7, emissive: 0x3f8aa6, emissiveIntensity: 0.5, transparent: true, opacity: 0.46 })); }
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
      new THREE.MeshLambertMaterial({ color: 0xc8efdb, emissive: 0x3f9c7d, emissiveIntensity: 0.5, transparent: true, opacity: 0.46 }),  // green
      new THREE.MeshLambertMaterial({ color: 0xf0ddb2, emissive: 0xa6803f, emissiveIntensity: 0.5, transparent: true, opacity: 0.46 }),  // amber
    ];
    return _tintMats;
  }
  function litWinMat() { return _litWinMat || (_litWinMat = new THREE.MeshLambertMaterial({ color: 0xffe2a8, emissive: 0xffb648, emissiveIntensity: 0.85, transparent: true, opacity: 0.66 })); }
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
    const mats = tintMats();
    const byTint = [[], [], []], litRecs = [];
    for (const r of batch) { byTint[r.tint].push(r); if (r.lit) litRecs.push(r); r._grp = null; }
    for (let t = 0; t < GLASS_TINTS; t++) {
      const recs = byTint[t]; if (!recs.length) continue;
      const im = new THREE.InstancedMesh(unitBox(), mats[t], recs.length);
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
    gp.shattered = true;
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
  CBZ.cityShatter = function (x, z, r) {
    const r2 = r * r; let n = 0;
    for (let i = 0; i < cityGlass.length; i++) {
      const gp = cityGlass[i]; if (gp.shattered) continue;
      const dx = gp.x - x, dz = gp.z - z;
      if (dx * dx + dz * dz <= r2) { burstPane(gp); if (++n > 50) break; }
    }
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
  // force=true (bullets) blows the pane out on the FIRST hit — a fired round
  // through a window should never read as "nothing happened". Default (melee)
  // keeps the two-stage crack-then-burst, so punching a window takes a couple
  // of swings.
  CBZ.cityShatterRay = function (ox, oy, oz, dx, dy, dz, maxDist, force) {
    const nl = Math.hypot(dx, dy, dz) || 1; dx /= nl; dy /= nl; dz /= nl;
    const lim = maxDist != null ? maxDist : 1e9;
    let best = null, bestT = lim;
    for (let i = 0; i < cityGlass.length; i++) {
      const gp = cityGlass[i]; if (gp.shattered) continue;
      let tmin = -1e9, tmax = 1e9;                     // ray-vs-AABB slab test
      if (Math.abs(dx) < 1e-8) { if (Math.abs(gp.x - ox) > gp.hw) continue; }
      else { let a = ((gp.x - gp.hw) - ox) / dx, b = ((gp.x + gp.hw) - ox) / dx; if (a > b) { const s = a; a = b; b = s; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; }
      if (Math.abs(dy) < 1e-8) { if (Math.abs(gp.y - oy) > gp.hh) continue; }
      else { let a = ((gp.y - gp.hh) - oy) / dy, b = ((gp.y + gp.hh) - oy) / dy; if (a > b) { const s = a; a = b; b = s; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; }
      if (Math.abs(dz) < 1e-8) { if (Math.abs(gp.z - oz) > gp.hd) continue; }
      else { let a = ((gp.z - gp.hd) - oz) / dz, b = ((gp.z + gp.hd) - oz) / dz; if (a > b) { const s = a; a = b; b = s; } if (a > tmin) tmin = a; if (b < tmax) tmax = b; }
      if (tmax < tmin || tmax < 0) continue;            // miss / entirely behind the muzzle
      const t = tmin > 0 ? tmin : 0;                    // entry distance (0 if muzzle inside the pane)
      if (t < bestT) { bestT = t; best = gp; bestHX = ox + dx * t; bestHY = oy + dy * t; bestHZ = oz + dz * t; }
    }
    if (best) {
      // a bullet (force) or a second hit — or a solid showroom pane — blows it
      // fully out; otherwise spider-crack it (and chip a shard off the point).
      if (force || best.cracked || best.col) { burstPane(best); if (CBZ.sfx) CBZ.sfx("glass"); }
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
  // re-glaze the whole city for a new game (restore panes + their colliders)
  CBZ.cityGlassReset = function () {
    for (const gp of cityGlass) {
      if (gp.shattered) {
        gp.shattered = false;
        if (gp.mesh) gp.mesh.visible = true;
        else paneShow(gp, true);       // pooled pane: restore (honours night state)
        if (gp.col && CBZ.colliders.indexOf(gp.col) === -1) CBZ.colliders.push(gp.col);
      }
      gp.cracked = false;
    }
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
    for (const b of cityBreaches) {
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
    if (dirty && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }

  // PUBLIC: blast a passable hole through the nearest ground-floor wall to (x,z).
  // `r` ~ the breach half-reach in metres (an RPG blastRadius 13 → r≈3.6, a
  // satisfying car-sized hole). Returns true if a wall actually opened.
  CBZ.cityBreach = function (x, z, r) {
    r = r || 1.6;
    if (!CBZ.scene || !CBZ.colliders) return false;
    // --- find the nearest GROUND-FLOOR tall wall (reuses cityDamageBuilding's
    //     nearest-wall search, but restricted to ground-floor solid walls that
    //     back-point to a real mesh we can hide/split). ---
    let best = null, bestD = 1e9;
    const searchR2 = 25;   // 5m: a wall right at the impact
    for (let i = 0; i < CBZ.colliders.length; i++) {
      const c = CBZ.colliders[i];
      if (c.y1 == null || !c.ref) continue;                 // not a wall-style AABB w/ a mesh
      if (!(c.y0 <= 0.2 && c.y1 >= 2.0)) continue;          // ground-floor full-height wall only
      const sx = Math.max(c.minX, Math.min(c.maxX, x)), sz = Math.max(c.minZ, Math.min(c.maxZ, z));
      const dx = x - sx, dz = z - sz, dd = dx * dx + dz * dz;
      if (dd > searchR2 || dd >= bestD) continue;
      bestD = dd; best = c;
    }
    const wall = best && best.ref;
    // nothing to breach (open air, or the wall was already opened) → just scorch.
    if (!wall || wall._breached) { CBZ.cityScorch(x, z, (r || 1.6) * 0.9 + 1.2); return false; }
    wall._breached = true;

    const c = best;
    const parent = wall.parent;                             // the building group (its position offsets locals)
    const px = parent ? parent.position.x : 0, pz = parent ? parent.position.z : 0;
    const horiz = (c.maxX - c.minX) >= (c.maxZ - c.minZ);   // wall runs along X if wider in X
    const minU = horiz ? c.minX : c.minZ, maxU = horiz ? c.maxX : c.maxZ;   // wall extent (world) along its axis
    const len = maxU - minU;
    const thick = horiz ? (c.maxZ - c.minZ) : (c.maxX - c.minX);
    const fixed = horiz ? (c.minZ + c.maxZ) / 2 : (c.minX + c.maxX) / 2;    // world coord on the off-axis
    const y0 = c.y0, y1 = c.y1, ymid = (y0 + y1) / 2, hgt = y1 - y0;
    const hit = horiz ? x : z;                              // where the blast struck along the wall axis
    // gap = the opening centred on the hit, clamped within the wall, sized to the blast
    const gapW = Math.min(len * 0.8, r * 2);
    let u0 = Math.max(minU, hit - gapW / 2), u1 = Math.min(maxU, hit + gapW / 2);
    if (u1 - u0 < 0.4) { u0 = Math.max(minU, (minU + maxU) / 2 - gapW / 2); u1 = Math.min(maxU, (minU + maxU) / 2 + gapW / 2); }

    const wmat = wall.material;
    const rec = { wall, col: c, remnCols: [], extras: [], wallWasLos: false };

    // hide the solid wall mesh + remove it from LOS (cops can see/shoot through)
    wall.visible = false;
    if (CBZ.losBlockers) { const li = CBZ.losBlockers.indexOf(wall); if (li >= 0) { CBZ.losBlockers.splice(li, 1); rec.wallWasLos = true; } }

    // --- SURVIVING FLANKS: rebuild the wall either side of the gap as thin
    //     remnant boxes (parented to the building group so they inherit its
    //     transform — local coords subtract the parent position). Each gets its
    //     own height-gated collider; a flank thinner than ~0.3m is skipped. ---
    function addRemnant(a, b) {
      const fw = b - a; if (fw < 0.3) return;
      const ucen = (a + b) / 2;
      const wx = horiz ? ucen : fixed, wz = horiz ? fixed : ucen;
      const bw = horiz ? fw : thick, bd = horiz ? thick : fw;
      const g = new THREE.BoxGeometry(bw, hgt, bd);
      // the wall material carries vertexColors (fake-AO walls) — the remnant
      // geometry needs the colour attribute too or it samples black
      if (wmat && wmat.vertexColors) shadeGeo(g, true);
      const m = new THREE.Mesh(g, wmat);
      // parent-local position = world minus parent offset (parent has y=0 offset)
      m.position.set(wx - px, ymid, wz - pz);
      m.castShadow = true; m.receiveShadow = true;
      if (parent) parent.add(m); else CBZ.scene.add(m);
      rec.extras.push(m);
      const col = { minX: wx - bw / 2, maxX: wx + bw / 2, minZ: wz - bd / 2, maxZ: wz + bd / 2, ref: m, y0: y0, y1: y1 };
      CBZ.colliders.push(col); rec.remnCols.push(col);
      if (rec.wallWasLos && CBZ.losBlockers) CBZ.losBlockers.push(m);
    }
    addRemnant(minU, u0);   // left flank
    addRemnant(u1, maxU);   // right flank

    // OPEN THE COLLIDER: splice the original wall AABB out + rebuild broadphase
    const ci = CBZ.colliders.indexOf(c); if (ci >= 0) CBZ.colliders.splice(ci, 1);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();

    // --- DRESS the hole: a dark scorched backing quad spanning the gap so the
    //     interior reads dark, set a hair INSIDE the wall plane on both sides. ---
    const gapU = u1 - u0, gapCen = (u0 + u1) / 2;
    const inN = (() => {
      // inward normal ≈ toward the blast origin's opposite? use side the blast hit
      const off = horiz ? (z - fixed) : (x - fixed);
      return off >= 0 ? 1 : -1;   // +1 if blast on +side of the wall, push backing to the other side
    })();
    for (const sgn of [-1, 1]) {                            // a quad facing each way so the hole reads from in + out
      const q = new THREE.Mesh(new THREE.PlaneGeometry(gapU * 0.96, hgt * 0.96), scorchMat());
      const qx = horiz ? gapCen : fixed, qz = horiz ? fixed : gapCen;
      q.position.set(qx - px + (horiz ? 0 : sgn * 0.04), ymid, qz - pz + (horiz ? sgn * 0.04 : 0));
      aimDecal(q, horiz ? 0 : sgn, 0, horiz ? sgn : 0);
      q.renderOrder = 2;
      if (parent) parent.add(q); else CBZ.scene.add(q);
      rec.extras.push(q);
    }

    cityBreaches.push(rec);

    // rubble blown INWARD through the hole, scorch, burst nearby panes, feedback
    const blastDir = inN;   // push debris away from the side the rocket came from
    const dxr = horiz ? 0 : -blastDir, dzr = horiz ? -blastDir : 0;
    const rubX = horiz ? gapCen : fixed, rubZ = horiz ? fixed : gapCen;
    CBZ.cityChunk(rubX, ymid - hgt * 0.2, rubZ,
      { count: 5 + ((Math.random() * 4) | 0), force: 5, dirx: dxr, dirz: dzr });
    CBZ.cityScorch(x, z, (r || 1.6) * 0.9 + 1.4);
    CBZ.cityShatter(x, z, (r || 1.6) * 2 + 4);
    if (CBZ.shake) CBZ.shake(0.6);
    if (CBZ.sfx) CBZ.sfx("glass");
    return true;
  };

  // DECORATE the explosion so blasts leave scorch marks on the ground + nearby
  // walls and blow concrete chunks outward — without touching crashfx.js. We
  // wrap once, lazily, the first time the city updates (after all modules load),
  // preserving the original behaviour exactly. Idempotent.
  let _explosionWrapped = false;
  function wrapExplosion() {
    if (_explosionWrapped || typeof CBZ.cityExplosion !== "function") return;
    _explosionWrapped = true;
    const orig = CBZ.cityExplosion;
    CBZ.cityExplosion = function (x, z, opts) {
      const r = orig.call(this, x, z, opts);
      try {
        const power = (opts && opts.power) || 1, R = ((opts && opts.radius) || 6) * power;
        CBZ.cityScorch(x, z, R * 0.5);
        CBZ.cityChunk(x, (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + 0.6, z, { count: Math.round(4 + 3 * power), force: 4 + 2 * power });
        // if the blast is hard against a wall, add the full structural-damage
        // pass (facade scorch + outward chunks + gouges + nearby panes burst).
        CBZ.cityDamageBuilding(x, (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + 1.4, z, Math.min(3, power));
      } catch (e) {}
      return r;
    };
  }
  CBZ.onUpdate(0.01, function () {
    if (CBZ.game.mode !== "city") { if (glassNightOn) CBZ.cityGlassNight(false); return; }
    wrapExplosion();
    // fold any freshly-registered panes into instanced pools (first city frame
    // for the main build; later generations for the expansion island).
    if (pendingGlass.length) buildGlassPools();
    // the dusk/dawn LIT-PANE flip — the same hysteresis thresholds as
    // view.js's emissive night pass so the whole night look lands together.
    const n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    CBZ.cityGlassNight(glassNightOn ? n > 0.45 : n > 0.6);
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

  // Business catalogue. `sign` = awning/sign colour; `name` shown on the
  // door + HUD; `kind` = the shop kind city/shops.js switches on.
  const SHOPS = [
    { kind: "guns",     name: "Ammu-Nation",     sign: 0x394b2e, storeys: 1 },
    { kind: "jewelry",  name: "Bling Jewelers",  sign: 0xf2c43d, storeys: 1 },
    { kind: "pawn",     name: "Pawn & Loan",     sign: 0x8a5a2b, storeys: 1 },
    { kind: "gas",      name: "Gas Station",     sign: 0xe24b4b, storeys: 1, gas: true },
    { kind: "clothing", name: "Threads & Drip",  sign: 0xc792ea, storeys: 1 },
    { kind: "drugs",    name: "The Trap House",  sign: 0x4caf6e, storeys: 1 },
    { kind: "food",     name: "Cluckin' Diner",  sign: 0xff9e6b, storeys: 1 },
    { kind: "bar",      name: "Velvet Club",     sign: 0xe85d8a, storeys: 2 },
    { kind: "bank",     name: "City Bank",       sign: 0x5b8bff, storeys: 2 },
    { kind: "hardware", name: "Hardware Depot",  sign: 0xffd166, storeys: 1 },
    { kind: "gym",      name: "Iron Gym",        sign: 0x66d9c0, storeys: 1 },
    { kind: "security", name: "Sentinel Security", sign: 0x49566b, storeys: 1 },
    { kind: "hospital", name: "City Hospital",   sign: 0xe8e8ee, storeys: 2, hospital: true },
    { kind: "barber",   name: "Fresh Cuts",      sign: 0x6bb6ff, storeys: 1 },
    { kind: "electronics", name: "Volt Electronics", sign: 0x39d0c0, storeys: 1 },
    { kind: "carlot",   name: "Premium Autos",   sign: 0xe88a3c, storeys: 1, carlot: true },
    { kind: "realtor",  name: "Keystone Realty", sign: 0x4fd0a0, storeys: 1, realtor: true },
    { kind: "chop",     name: "Benny's Chop Shop", sign: 0xd0a23c, storeys: 1, chop: true },
    { kind: "casino",   name: "Grand Casino",    sign: 0xc9a227, storeys: 2 },
    { kind: "raceway",  name: "City Speedway",   sign: 0x2f6fed, storeys: 1 },
    { kind: "arena",    name: "Civic Fight Arena", sign: 0xd94f45, storeys: 2 },
    { kind: "paintball", name: "Paintball Yard", sign: 0x7ed957, storeys: 1 },
    { kind: "transit",  name: "Central Transit", sign: 0x39c0d0, storeys: 1 },
    { kind: "cityhall", name: "City Hall",       sign: 0xd8dde8, storeys: 2 },
    { kind: "airfield", name: "Airfield Office", sign: 0x8a93a3, storeys: 1 },
    { kind: "racepark", name: "Race Park",       sign: 0xb98a5a, storeys: 1 },
  ];
  const TOWER_PALETTE = [0x5b6b82, 0x6f7e96, 0x8a98ac, 0x49566b, 0x7a6f8c, 0x5e7d86];
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
    function clearFloorPoint(lx, lz, pad) {
      pad = pad == null ? 0.8 : pad;
      const dx = lx - localDoor.x, dz = lz - localDoor.z;
      const inward = dx * localDoor.nx + dz * localDoor.nz;
      const cross = Math.abs(dx * localDoor.nz - dz * localDoor.nx);
      if (inward > -0.8 && inward < 4.8 && cross < DOORW / 2 + pad) return false;
      if (hasStairs && lx < ixMin + stairW + pad && lx > ixMin - pad && lz > izMin - pad && lz < izMax + pad) return false;
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
        addCityGlass(bgroup, cxL, ly, zz, wL, FH * 0.86, 0.07, ox, oz, { solid: true }, windows);
        addCityGlass(bgroup, -cxL, ly, zz, wL, FH * 0.86, 0.07, ox, oz, { solid: true }, windows);
      } else {
        const xx = f.x, off = (f.s === 2 ? 0.06 : -0.06);
        lbox(xx, ly, -d / 2 + 0.35, WT, FH, 0.7, color, wallOpt);
        lbox(xx, ly, d / 2 - 0.35, WT, FH, 0.7, color, wallOpt);
        lbox(xx, HDR + (FH - HDR) / 2, 0, WT, FH - HDR, GW + 0.5, color, { solid: true, los: true });
        lbox(xx + off, HDR - 0.5, 0, 0.14, 0.9, GW - 0.3, 0x8a93a0, { cast: false });
        for (let s = 0; s < 4; s++) lbox(xx + off * 1.2, HDR - 0.2 - s * 0.2, 0, 0.18, 0.05, GW - 0.4, 0x6b7480, { cast: false });
        const a = -d / 2 + 0.7, bb = -GW / 2 - 0.15, czL = (a + bb) / 2, dL = bb - a;
        addCityGlass(bgroup, xx, ly, czL, 0.07, FH * 0.86, dL, ox, oz, { solid: true }, windows);
        addCityGlass(bgroup, xx, ly, -czL, 0.07, FH * 0.86, dL, ox, oz, { solid: true }, windows);
      }
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
          addCityGlass(bgroup, cxL, ly, zz, wL, FH * 0.84, 0.06, ox, oz, { solid: true }, windows);
          addCityGlass(bgroup, -cxL, ly, zz, wL, FH * 0.84, 0.06, ox, oz, { solid: true }, windows);
        }
      } else {
        const xx = f.x;
        lbox(xx, ly, -d / 2 + post / 2, WT, FH, post, color, wallOpt);
        lbox(xx, ly, d / 2 - post / 2, WT, FH, post, color, wallOpt);
        lbox(xx, HDR + (FH - HDR) / 2, 0, WT, FH - HDR, GW + 0.6, color, { solid: true, los: true });
        const a = -d / 2 + post, bb = -GW / 2 - 0.2, czL = (a + bb) / 2, dL = bb - a;
        if (dL > 0.5) {
          addCityGlass(bgroup, xx, ly, czL, 0.06, FH * 0.84, dL, ox, oz, { solid: true }, windows);
          addCityGlass(bgroup, xx, ly, -czL, 0.06, FH * 0.84, dL, ox, oz, { solid: true }, windows);
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
          } else if (f.horiz) {
            const side = (w - DOORW) / 2;
            const fcx = -(DOORW / 2 + side / 2), fcx2 = DOORW / 2 + side / 2;
            lbox(fcx, ly, f.z, side, FH, WT, color, wallOpt);
            lbox(fcx2, ly, f.z, side, FH, WT, color, wallOpt);
            lbox(0, (DOORH + FH) / 2, f.z, DOORW, FH - DOORH, WT, color, { los: true });   // header fills DOORH..FH (door opening stays person-scale)
            // STOREFRONT GLASS flanking the entrance — on the STREET side of the
            // wall (the old +0.22 offset put it just inside the room, hidden
            // behind the opaque facade) so shops read as glassed storefronts.
            // Pane back face sits 0.06 PROUD of the facade (was 0.035 — close
            // enough to depth-alias into a moiré shimmer at distance).
            const osn = (f.s === 0 ? -1 : 1);                 // toward the street
            const goff = osn * (WT / 2 + 0.085), gph = FH * 0.5, gy = ly + 0.1;
            if (side > 1.2) {
              for (const fc of [fcx, fcx2]) {
                addCityGlass(bgroup, fc, gy, f.z + goff, side * 0.7, gph, 0.05, ox, oz, { tint: tintIdx }, windows);
                // INTERIOR read: the wall is a solid box, so from inside the
                // shop these windows were blank wall. A bright SKY slab just
                // proud of the room face + a room-side pane = the storefront
                // reads (and shatters) from both sides.
                dbox(fc, gy, f.z - osn * (WT / 2 + 0.025), side * 0.74, gph + 0.12, 0.03, SKY);
                addCityGlass(bgroup, fc, gy, f.z - osn * (WT / 2 + 0.105), side * 0.7, gph, 0.05, ox, oz, { tint: tintIdx }, windows);
              }
            }
          } else {
            const side = (d - DOORW) / 2;
            const fcz = -(DOORW / 2 + side / 2), fcz2 = DOORW / 2 + side / 2;
            lbox(f.x, ly, fcz, WT, FH, side, color, wallOpt);
            lbox(f.x, ly, fcz2, WT, FH, side, color, wallOpt);
            lbox(f.x, (DOORH + FH) / 2, 0, WT, FH - DOORH, DOORW, color, { los: true });   // header fills DOORH..FH
            const osn = (f.s === 2 ? -1 : 1);                 // toward the street
            const goff = osn * (WT / 2 + 0.085), gph = FH * 0.5, gy = ly + 0.1;
            if (side > 1.2) {
              for (const fc of [fcz, fcz2]) {
                addCityGlass(bgroup, f.x + goff, gy, fc, 0.05, gph, side * 0.7, ox, oz, { tint: tintIdx }, windows);
                // interior counterpart (see the horiz branch for WHY)
                dbox(f.x - osn * (WT / 2 + 0.025), gy, fc, 0.03, gph + 0.12, side * 0.74, SKY);
                addCityGlass(bgroup, f.x - osn * (WT / 2 + 0.105), gy, fc, 0.05, gph, side * 0.7, ox, oz, { tint: tintIdx }, windows);
              }
            }
          }
          // hang an OPENABLE swinging glass door in the gap (real shops/homes
          // only — derelicts stay gaping). Abandoned (boarded) buildings skip it.
          if (!opts.showroom && !opts.boarded) makeDoorPanel(bgroup, ox, oz, localDoor, DOORW);
        } else {
          lbox(f.x, ly, f.z, f.w, FH, f.dd, color, wallOpt);
          // window band — glass glow on real buildings, boarded planks on derelicts
          const wy = ly + 0.3;
          if (opts.boarded) {
            const bw2 = f.horiz ? Math.min(w * 0.55, 4.4) : 0.06;
            const bd2 = f.horiz ? 0.06 : Math.min(d * 0.55, 4.4);
            const off = f.horiz ? (f.s === 0 ? 0.21 : -0.21) : (f.s === 2 ? 0.21 : -0.21);
            for (let p = -1; p <= 1; p++) {
              lbox(f.x + (f.horiz ? 0 : off), wy + p * 0.5, f.z + (f.horiz ? off : 0),
                f.horiz ? bw2 : 0.06, 0.22, f.horiz ? 0.06 : bd2, BOARD, { cast: false });
            }
          } else {
            // big shatterable glass — rows of panes (a real modern window band;
            // even taller/wider on tall "modern" towers → a glass curtain wall).
            //
            // INSTANCED + STREET-SIDE: panes go through the pooled glass (a few
            // draw calls city-wide), and they now hang on the OUTSIDE of the
            // wall — the old +0.22 offset put them a hair inside the room,
            // invisible from the street. With panes near-free we also:
            //  - pack MORE panes per row: clamp 4..8 (was 3..6);
            //  - tint per building (blue/green/amber pools);
            //  - back each band with a dark MULLION slab (the gaps between
            //    panes read as real mullions against it) + a sill lip, so the
            //    grid reads as windows, not floating panels;
            //  - NORMAL storeys keep TWO stacked bands, modern towers their
            //    single floor-to-ceiling curtain band.
            // Depth stays thin (0.05) and panes are NEVER solid → no colliders.
            const outSgn = (f.s === 0 || f.s === 2) ? -1 : 1;   // toward the street
            // pane height + the y-centres of each band we draw on this storey
            let bands, ph;
            if (modern) {
              ph = FH * 0.74;
              bands = [ly + 0.2];                       // one tall curtain-wall band
            } else {
              ph = FH * 0.30;                            // shorter so two fit cleanly
              // lower band sits low, upper band high; both clear of the floor belts
              bands = [ly - FH * 0.16, ly + FH * 0.22];
            }
            // DEPTH STACK (street side, per-face epsilon so nothing is ever
            // coplanar with the wall plane or each other — coplanar/near-
            // coplanar layers were depth-aliasing into shimmer at distance):
            //   wall face 0 → MULL slab 0.01..0.07 → sill 0.01..0.14 (below the
            //   band) → pane 0.08..0.13. Visible parallel faces stay ≥0.06 apart.
            // INTERIOR (room side): the wall is a SOLID box, so these windows
            // read as blank wall from inside. Mirror the band into the room —
            // bright SKY slab (daylight) + dark mullion strips in the exterior
            // panes' gaps + ONE full-span room-side pane (1 extra instance per
            // band, same pools) — so every room says "this wall has windows",
            // glows warm if the band is lit at night, and shatters from inside.
            const gtint = { tint: tintIdx };
            if (f.horiz) {
              const faceZ = f.z + outSgn * (WT / 2);     // the street-side wall plane
              const inZ = f.z - outSgn * (WT / 2);       // the room-side wall plane
              const zz = faceZ + outSgn * 0.105, span = w - 1.1;
              const nn = Math.max(4, Math.min(8, Math.round(w / 1.6))), step = span / nn;
              for (let b = 0; b < bands.length; b++) {
                dbox(0, bands[b], faceZ + outSgn * 0.04, span + 0.18, ph + 0.16, 0.06, MULL);
                dbox(0, bands[b] - ph / 2 - 0.1, faceZ + outSgn * 0.075, span + 0.3, 0.1, 0.13, TRIM);
                for (let i = 0; i < nn; i++) addCityGlass(bgroup, -span / 2 + (i + 0.5) * step, bands[b], zz, step * 0.84, ph, 0.05, ox, oz, gtint, windows);
                dbox(0, bands[b], inZ - outSgn * 0.025, span + 0.18, ph + 0.16, 0.03, SKY);
                for (let i = 1; i < nn; i++) dbox(-span / 2 + i * step, bands[b], inZ - outSgn * 0.06, step * 0.18, ph + 0.1, 0.02, MULL);
                addCityGlass(bgroup, 0, bands[b], inZ - outSgn * 0.105, span, ph, 0.05, ox, oz, gtint, windows);
              }
            } else {
              const faceX = f.x + outSgn * (WT / 2);
              const inX = f.x - outSgn * (WT / 2);
              const xx = faceX + outSgn * 0.105, span = d - 1.1;
              const nn = Math.max(4, Math.min(8, Math.round(d / 1.6))), step = span / nn;
              for (let b = 0; b < bands.length; b++) {
                dbox(faceX + outSgn * 0.04, bands[b], 0, 0.06, ph + 0.16, span + 0.18, MULL);
                dbox(faceX + outSgn * 0.075, bands[b] - ph / 2 - 0.1, 0, 0.13, 0.1, span + 0.3, TRIM);
                for (let i = 0; i < nn; i++) addCityGlass(bgroup, xx, bands[b], -span / 2 + (i + 0.5) * step, 0.05, ph, step * 0.84, ox, oz, gtint, windows);
                dbox(inX - outSgn * 0.025, bands[b], 0, 0.03, ph + 0.16, span + 0.18, SKY);
                for (let i = 1; i < nn; i++) dbox(inX - outSgn * 0.06, bands[b], -span / 2 + i * step, 0.02, ph + 0.1, step * 0.18, MULL);
                addCityGlass(bgroup, inX - outSgn * 0.105, bands[b], 0, 0.05, ph, span, ox, oz, gtint, windows);
              }
            }
          }
        }
      }
    }

    // Single-storey shops do not need a giant customer-facing rooftop stair
    // rig. Climbable buildings reserve a dedicated open strip on the -x side.
    const slabMinX = hasStairs ? ixMin + stairW : ixMin;
    const slabW = ixMax - slabMinX, slabCx = (slabMinX + ixMax) / 2, slabD = izMax - izMin, slabCz = (izMin + izMax) / 2;
    for (let L = 1; L <= storeys; L++) {
      const isRoof = L === storeys;
      lbox(slabCx, L * FH - 0.1, slabCz, slabW, 0.2, slabD, isRoof ? 0x9fa6ad : 0xb9bec6, { plat: true, los: true, cast: isRoof });
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
    const nSteps = Math.round(FH / 0.45), LD = 1.1, zA = izMin + 0.3, zB = izMax - 0.3, laneW = stairW / 2;
    for (let k = 0; hasStairs && k < storeys; k++) {
      const dir = (k % 2 === 0) ? 1 : -1;
      const startZ = dir > 0 ? zA : zB, endZ = dir > 0 ? zB : zA;
      const rampEndZ = endZ - dir * LD;
      const lx0 = (k % 2 === 0) ? ixMin : ixMin + laneW, lxc = lx0 + laneW / 2;
      const ramp = {
        minX: ox + lx0 + 0.04, maxX: ox + lx0 + laneW - 0.04,
        minZ: oz + Math.min(startZ, rampEndZ), maxZ: oz + Math.max(startZ, rampEndZ),
        top: (k + 1) * FH,
        ramp: { z0: oz + startZ, z1: oz + rampEndZ, y0: k * FH, y1: (k + 1) * FH },
      };
      CBZ.platforms.push(ramp); plats.push(ramp);
      const runLen = Math.abs(rampEndZ - startZ), runDepth = runLen / nSteps, rise = FH / nSteps;
      for (let i = 1; i <= nSteps; i++) {
        const vtop = k * FH + (i - 0.5) * rise, cz2 = startZ + dir * (i - 0.5) * runDepth;
        lbox(lxc, vtop - 0.13, cz2, laneW - 0.16, 0.26, runDepth + 0.04, 0xa7adb5, { cast: false });
      }
      const lzc = (rampEndZ + endZ) / 2;
      lbox(ixMin + stairW / 2, (k + 1) * FH - 0.1, lzc, stairW, 0.2, LD + 0.2, 0xb4b9c1, { plat: true, los: true, cast: false });
    }

    // ---- FACADE MASSING (all flat opaque deco boxes; merged by flushDeco) --
    // cornice lip at every floor line so storeys read from the street
    for (let L = 1; L < storeys; L++) {
      const cy = L * FH;
      dbox(0, cy, -d / 2 - 0.02, w + 0.2, 0.13, 0.12, TRIM);
      dbox(0, cy, d / 2 + 0.02, w + 0.2, 0.13, 0.12, TRIM);
      dbox(-w / 2 - 0.02, cy, 0, 0.12, 0.13, d + 0.2, TRIM);
      dbox(w / 2 + 0.02, cy, 0, 0.12, 0.13, d + 0.2, TRIM);
    }
    // darker ground-floor PLINTH band (skips the door face — the entrance /
    // storefront dressing owns that — and garage-deck buildings, whose whole
    // ground floor is drive-in bays). Sits below the lowest window band.
    if (!opts.garageGround) {
      if (doorSide !== 0) dbox(0, 0.33, -d / 2 - 0.025, w + 0.1, 0.66, 0.09, BASE);
      if (doorSide !== 1) dbox(0, 0.33, d / 2 + 0.025, w + 0.1, 0.66, 0.09, BASE);
      if (doorSide !== 2) dbox(-w / 2 - 0.025, 0.33, 0, 0.09, 0.66, d + 0.1, BASE);
      if (doorSide !== 3) dbox(w / 2 + 0.025, 0.33, 0, 0.09, 0.66, d + 0.1, BASE);
    }
    // corner PILASTERS tying the floors to the parapet line
    for (const sxp of [-1, 1]) for (const szp of [-1, 1])
      dbox(sxp * (w / 2 - 0.02), (rTop + pp) / 2, szp * (d / 2 - 0.02), 0.5, rTop + pp, 0.5, PIL);
    flushDeco();

    return { group: bgroup, ox, oz, w, d, h: storeys * FH, storeys, colliders: cols, platforms: plats, windows, lbox, FH,
      hasStairs, stairW, clearFloorPoint, wt: WT,   // wt: exact wall thickness, so elevators.js seats rigs flush to the real facade
      roofCx: ox + slabCx, roofCz: oz + slabCz };   // world centre of the solid roof slab (clear of the -x stairwell)
  }
  // The connected island district reuses the exact same enterable shell and
  // stair rig, so every added tower behaves like the original city buildings.
  CBZ.cityMakeBuilding = makeBuilding;

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
          // car lot / chop shop showroom: keep the centre clear for a vehicle,
          // line the walls with tyres/tool benches only.
          wallShelves({ body: 0x3a352e, top: 0x55606e, h: 1.4, count: 2, span: 2.0 });
          for (const st of shelfTops) stockRow(st, [0x2a2f37, 0x44505c], 4, 0.3, 0.3);   // tyre/part stacks
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
      b.lbox(s.x, 0.55, s.z, 2.0, 0.7, 3.9, s.c, { solid: true });          // body
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

      // ---- ABANDONED / gang-run derelict ----
      if (!isLux && !forcedTier && r < (C.parkFrac || 0.08) + (C.abandonedFrac || 0.30)) {
        // derelicts follow the district field too (a condemned core mid-rise
        // holds a richer stash than a projects shack — risk pays), capped at 4
        const storeys = Math.max(1, Math.min(4, districtStoreys(lot)));
        const color = ABANDONED_PALETTE[(rng() * ABANDONED_PALETTE.length) | 0];
        const b = makeBuilding(root, lot.cx, lot.cz, w, d, storeys, color, side, { boarded: true });
        lot.kind = "abandoned";
        lot.building = { ...b, name: "Abandoned Building", sign: color, side, door: doorPt, abandoned: true, gang: null };
        abandonDecor(b, rng, 0xb079ea);
        derelictExterior(b);                       // soot + broken parapet: turf reads from afar
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
        const b = makeBuilding(root, lot.cx, lot.cz, w, d, shopStoreys, color, side, { showroom: !!(shop.gas || shop.carlot || shop.chop) });
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
        const color = TOWER_PALETTE[(rng() * TOWER_PALETTE.length) | 0];
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
      // elevators: real (non-derelict) towers only, tallest first, capped at 5
      const evPool = rigged.filter((l) => !l.building.abandoned && l.building.storeys >= 3)
        .sort((a, b) => (b.building.h || 0) - (a.building.h || 0));
      city.elevatorLots = evPool.slice(0, 5);
      const served = new Set(city.elevatorLots);
      // fire escapes climb the +x face (the -x strip is the open interior stair
      // shaft — a bridge there would dump you DOWN it), so +x-door lots are out.
      // Derelicts are welcome: gang roofs make the best escape routes. Picks are
      // spread across the lot list so the routes aren't clustered in one corner.
      const fePool = rigged.filter((l) => !served.has(l) &&
        l.building.storeys >= 2 && l.building.storeys <= 4 && l.building.side !== 3);
      city.fireEscapeLots = [];
      const nFE = Math.min(4, fePool.length);
      for (let t = 0; t < nFE; t++) {
        const pick = fePool[Math.min(fePool.length - 1, Math.floor((t + 0.5) / nFE * fePool.length))];
        if (city.fireEscapeLots.indexOf(pick) === -1) city.fireEscapeLots.push(pick);
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
  // HOUSE-NUMBER plate, an AC window unit, and a fire-escape ladder rig. Reuses
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
    // FIRE-ESCAPE LADDER rig up one side of the door face (rails + rungs + a
    // small landing) — purely cosmetic, hung on the building group. 0.24 proud:
    // clear of the window panes (≤0.13) so the rails cross IN FRONT of glass.
    const fox = di.x + onx * 0.24 - tx * (along ? d : w) * 0.30;
    const foz = di.z + onz * 0.24 - tz * (along ? d : w) * 0.30;
    const ladTop = Math.min(b.h - 0.5, FH * 2.2);
    for (const s of [-0.25, 0.25]) {              // two vertical rails
      const rail = new THREE.Mesh(new THREE.BoxGeometry(...fx(0.08, ladTop, 0.08)), mat(0x3a3f46));
      rail.position.set(fox + tx * s, ladTop / 2 + 0.6, foz + tz * s); rail.castShadow = false; g.add(rail);
    }
    const nRungs = 1 + Math.round((FH - 0.4) / 0.9);   // same 0.9 rung pitch, count rides FH (5 at the old 4.0)
    for (let r = 0; r < nRungs; r++) {             // rungs
      const rung = new THREE.Mesh(new THREE.BoxGeometry(...fx(0.6, 0.06, 0.06)), mat(0x3a3f46));
      rung.position.set(fox, 1.0 + r * 0.9, foz); rung.castShadow = false; g.add(rung);
    }
    // a small landing platform at first floor
    const land = new THREE.Mesh(new THREE.BoxGeometry(...fx(0.9, 0.08, 0.7)), mat(0x44505c));
    land.position.set(fox + onx * 0.25, FH - 0.2, foz + onz * 0.25); land.castShadow = false; g.add(land);
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
