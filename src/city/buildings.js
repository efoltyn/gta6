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
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;

  const FH = 4.0;      // floor-to-floor
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
  // makes it a height-gated collider (showroom walls) tracked so a burst frees it.
  function addCityGlass(group, lx, ly, lz, pw, ph, pd, ox, oz, o, list) {
    o = o || {};
    const m = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), glassMat());
    m.position.set(lx, ly, lz); m.castShadow = false; m.receiveShadow = false; m.renderOrder = 1;
    group.add(m);
    const rec = { mesh: m, x: ox + lx, y: ly, z: oz + lz, span: Math.max(pw, pd) * 0.5, hw: pw / 2, hh: ph / 2, hd: pd / 2, shattered: false, col: null };
    if (o.solid) {
      const c = { minX: ox + lx - pw / 2, maxX: ox + lx + pw / 2, minZ: oz + lz - pd / 2, maxZ: oz + lz + pd / 2, ref: m, y0: ly - ph / 2, y1: ly + ph / 2 };
      CBZ.colliders.push(c); rec.col = c;
    }
    cityGlass.push(rec); if (list) list.push(rec);
    return m;
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
    gp.shattered = true; gp.mesh.visible = false;
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
  CBZ.cityShatterRay = function (ox, oy, oz, dx, dy, dz, maxDist) {
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
      // first bullet spider-cracks the pane (and chips a glass shard); a second
      // hit — or a solid showroom pane — blows it fully out.
      if (best.cracked || best.col) { burstPane(best); if (CBZ.sfx) CBZ.sfx("glass"); }
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
        gp.shattered = false; gp.mesh.visible = true;
        if (gp.col && CBZ.colliders.indexOf(gp.col) === -1) CBZ.colliders.push(gp.col);
      }
      gp.cracked = false;
    }
    for (const s of cityShards) CBZ.scene.remove(s.mesh);
    cityShards.length = 0;
    for (const cq of crackQuads) { CBZ.scene.remove(cq.mesh); if (cq.mesh.material) cq.mesh.material.dispose(); cq.mesh.geometry.dispose(); }
    crackQuads.length = 0;
    CBZ.cityDamageReset && CBZ.cityDamageReset();
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
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

  CBZ.cityDamageReset = function () {
    for (const m of bulletPool) m.visible = false;
    for (const m of scorchPool) m.visible = false;
    bulletIdx = scorchIdx = 0;
    for (const c of cityChunks) { CBZ.scene.remove(c.mesh); if (c.dispose && c.mesh.material) c.mesh.material.dispose(); }
    cityChunks.length = 0;
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
      } catch (e) {}
      return r;
    };
  }
  CBZ.onUpdate(0.01, function () { if (CBZ.game.mode !== "city") return; wrapExplosion(); });

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
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat(col, o.emissive ? { emissive: o.emissive, ei: o.ei || 0.5 } : null));
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

    for (let k = 0; k < storeys; k++) {
      const ly = k * FH + FH / 2;
      const faces = [
        { s: 0, x: 0, z: -d / 2 + WT / 2, w: w, dd: WT, horiz: true },
        { s: 1, x: 0, z: d / 2 - WT / 2, w: w, dd: WT, horiz: true },
        { s: 2, x: -w / 2 + WT / 2, z: 0, w: WT, dd: d, horiz: false },
        { s: 3, x: w / 2 - WT / 2, z: 0, w: WT, dd: d, horiz: false },
      ];
      for (const f of faces) {
        if (k === 0 && f.s === doorSide) {
          if (opts.showroom) {
            showroomFront(f);
          } else if (f.horiz) {
            const side = (w - DOORW) / 2;
            lbox(-(DOORW / 2 + side / 2), ly, f.z, side, FH, WT, color, wallOpt);
            lbox(DOORW / 2 + side / 2, ly, f.z, side, FH, WT, color, wallOpt);
            lbox(0, FH - 0.35, f.z, DOORW, 0.7, WT, color, { los: true });
          } else {
            const side = (d - DOORW) / 2;
            lbox(f.x, ly, -(DOORW / 2 + side / 2), WT, FH, side, color, wallOpt);
            lbox(f.x, ly, DOORW / 2 + side / 2, WT, FH, side, color, wallOpt);
            lbox(f.x, FH - 0.35, 0, WT, 0.7, DOORW, color, { los: true });
          }
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
            // big shatterable glass — a row of tall panes (a real modern window
            // band; even taller/wider on tall "modern" towers → a glass curtain wall)
            const wy2 = ly + 0.2, ph = FH * (modern ? 0.74 : 0.56), off = 0.22;
            if (f.horiz) {
              const zz = f.z + (f.s === 0 ? off : -off), span = w - 1.1;
              const nn = Math.max(2, Math.min(4, Math.round(w / 2.6))), step = span / nn;
              for (let i = 0; i < nn; i++) addCityGlass(bgroup, -span / 2 + (i + 0.5) * step, wy2, zz, step * 0.84, ph, 0.05, ox, oz, null, windows);
            } else {
              const xx = f.x + (f.s === 2 ? off : -off), span = d - 1.1;
              const nn = Math.max(2, Math.min(4, Math.round(d / 2.6))), step = span / nn;
              for (let i = 0; i < nn; i++) addCityGlass(bgroup, xx, wy2, -span / 2 + (i + 0.5) * step, 0.05, ph, step * 0.84, ox, oz, null, windows);
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
    lbox(slabCx, rTop + 0.35, d / 2 - WT / 2, slabW, 0.7, WT, 0x8b9097, { los: true });
    lbox(w / 2 - WT / 2, rTop + 0.35, slabCz, WT, 0.7, slabD, 0x8b9097, { los: true });
    lbox(slabCx, rTop + 0.35, -d / 2 + WT / 2, slabW, 0.7, WT, 0x8b9097, { los: true });
    lbox(-w / 2 + WT / 2, rTop + 0.35, slabCz, WT, 0.7, slabD, 0x8b9097, { los: true });

    // switchback stairs (two lanes alternating; ported from disaster_arena)
    const nSteps = 9, LD = 1.1, zA = izMin + 0.3, zB = izMax - 0.3, laneW = stairW / 2;
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

    return { group: bgroup, ox, oz, w, d, h: storeys * FH, storeys, colliders: cols, platforms: plats, windows, lbox, FH,
      hasStairs, stairW, clearFloorPoint,
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
          // a POOL TABLE mid-room: felt top, dark rails, six pocket dots, racked balls
          const pp = pt(halfIn - 0.6, -(halfTan - 2.6), 1.0) || pt(halfIn, 0, 1.0);
          if (pp) {
            decor(pp, 0.42, along ? 1.5 : 2.8, 0.1, along ? 2.8 : 1.5, 0x6b4a2a);   // table body
            decor(pp, 0.78, along ? 1.6 : 2.9, 0.16, along ? 2.9 : 1.6, 0x274a30);   // rail frame
            glow(pp, 0.8, along ? 1.4 : 2.6, 0.04, along ? 2.6 : 1.4, 0x1f8a4d, 0.4); // felt
            const balls = [0xffd400, 0x0050c8, 0xd40000, 0x6a0dad, 0xff7000, 0x0a7d3a];
            for (let g = 0; g < 6; g++) { const a = g / 6 * 6.28, lx = pp.x + Math.cos(a) * 0.4, lz = pp.z + Math.sin(a) * 0.4; b.lbox(lx, 0.86, lz, 0.12, 0.12, 0.12, balls[g], { cast: false }); }
            // overhead pool lamp
            b.lbox(pp.x, FHl - 0.7, pp.z, along ? 0.4 : 1.6, 0.2, along ? 1.6 : 0.4, 0xfff0c0, { emissive: 0xffe39a, ei: 0.7, cast: false });
          }
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
        break;
      }
      case "hardware": {
        // tall industrial racks with crates/cans
        wallShelves({ body: 0x4a4034, top: 0x6b5a3a, h: 2.0, count: 3, span: 2.4 });
        for (const st of shelfTops) for (let r = 0; r < 2; r++) stockRow({ p: st.p, top: 0.7 + r * 0.65, across: st.across }, [0xffd166, 0x8a5a2b, 0xb9bec6, 0x66d9c0], 5, 0.26, 0.34);
        island(2 * halfIn - 5.0, -(halfTan - 2.0), along ? 1.0 : 2.4, 1.1, along ? 2.4 : 1.0, 0x6b5a3a, { cast: false });
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

  function furnishHome(b, rng) {
    // ground-floor living space: a bed, a couch, a table, a kitchen counter
    const W = b.w, D = b.d;
    const cz = D / 2 - 2.0;
    function decor(x, y, z, w, h, d, color, pad) {
      if (!b.clearFloorPoint || b.clearFloorPoint(x, z, pad)) b.lbox(x, y, z, w, h, d, color, { cast: false });
    }
    decor(-W / 2 + 2.0, 0.4, -D / 2 + 2.2, 2.0, 0.5, 1.2, 0x6b7da0, 1.1);   // bed base
    decor(-W / 2 + 2.0, 0.85, -D / 2 + 1.7, 2.0, 0.25, 0.5, 0xe8e8ee, 1.1); // pillow
    decor(W / 2 - 2.4, 0.45, -D / 2 + 2.4, 2.4, 0.6, 1.0, 0x8a5a2b, 1.2);    // couch
    decor(0, 0.4, 0, 1.4, 0.5, 0.9, 0x9aa0a8, 1.0);                          // coffee table
    decor(W / 2 - 1.6, 0.6, cz, 1.0, 1.0, Math.min(D - 3, 4), 0x55606e, 1.0); // kitchen counter
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

  CBZ.cityBuildings = function (city) {
    const root = city.root, rng = city.rng;
    const C = CBZ.CITY;
    const placed = [], abandonedLots = [], homeLots = [];
    let chopShop = null, realtor = null, luxury = null;

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

    const HOME_TIERS = (C.homes || []).filter((h) => h.tier > 0);
    const NONLUX_TIERS = HOME_TIERS.filter((h) => !h.elevator);   // studio / apt / condo
    const PENTHOUSE = HOME_TIERS.find((h) => h.elevator) || HOME_TIERS[HOME_TIERS.length - 1];
    let homeTierIdx = 0;

    for (const lot of city.lots) {
      const isLux = lot === lux;
      const r = rng();
      // parks (open plazas) for breathing room — fewer than before
      if (!isLux && r < (C.parkFrac || 0.08)) { lot.kind = "park"; makePark(root, lot, rng); placed.push(lot); continue; }

      const w = lot.w - 2, d = lot.d - 2;
      const toCx = city.center.x - lot.cx, toCz = city.center.z - lot.cz;
      const side = Math.abs(toCx) > Math.abs(toCz) ? (toCx > 0 ? 3 : 2) : (toCz > 0 ? 1 : 0);
      const door = doorInfo(lot.cx, lot.cz, w, d, side);
      const doorPt = { x: door.x + door.nx * 1.6, z: door.z + door.nz * 1.6, nx: door.nx, nz: door.nz };

      // ---- ABANDONED / gang-run derelict ----
      if (!isLux && r < (C.parkFrac || 0.08) + (C.abandonedFrac || 0.30)) {
        const storeys = 1 + ((rng() * 3) | 0);
        const color = ABANDONED_PALETTE[(rng() * ABANDONED_PALETTE.length) | 0];
        const b = makeBuilding(root, lot.cx, lot.cz, w, d, storeys, color, side, { boarded: true });
        lot.kind = "abandoned";
        lot.building = { ...b, name: "Abandoned Building", sign: color, side, door: doorPt, abandoned: true, gang: null };
        abandonDecor(b, rng, 0xb079ea);
        makeStash(b, lot, 0x4caf6e);
        abandonedLots.push(lot);
        placed.push(lot);
        continue;
      }

      // ---- REAL: a business or a residence (and never a shop on the luxury lot) ----
      // Essentials are placed unconditionally; extras only ~40% of the time, so
      // the remaining real lots become furnished, sellable HOMES.
      let shop = null;
      if (!isLux) {
        if (shopIdx < nEssential) shop = shopQueue[shopIdx++];
        else if (shopIdx < shopQueue.length && rng() < 0.4) shop = shopQueue[shopIdx++];
      }

      if (shop) {
        const color = lightenWall(shop.sign);
        const b = makeBuilding(root, lot.cx, lot.cz, w, d, shop.storeys, color, side, { showroom: !!(shop.gas || shop.carlot || shop.chop) });
        signAwning(b, side, w, d, shop.sign, shop.name);
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
        if (shop.chop) {
          chopShop = lot;
          // a drive-in sell bay just outside the door
          lot.building.chopZone = { x: door.x + door.nx * 5, z: door.z + door.nz * 5, r: 5.5 };
        }
        if (shop.realtor) realtor = lot;
      } else {
        // residence / office tower — enterable, climbable, FURNISHED, a HOME
        const storeys = isLux ? 5 : 2 + ((rng() * 3) | 0);
        const color = TOWER_PALETTE[(rng() * TOWER_PALETTE.length) | 0];
        const b = makeBuilding(root, lot.cx, lot.cz, w, d, storeys, color, side);
        furnishHome(b, rng);
        lot.kind = "tower";
        lot.building = { ...b, name: "Apartments", sign: color, side, door: doorPt };
        // assign a home tier so the realtor can sell/rent it
        let tierDef;
        if (isLux) tierDef = PENTHOUSE;                                         // flagship penthouse
        else { tierDef = NONLUX_TIERS[homeTierIdx % NONLUX_TIERS.length]; homeTierIdx++; }
        lot.building.home = {
          tier: tierDef.tier, id: tierDef.id, name: tierDef.name, price: tierDef.price, rent: tierDef.rent || 0,
          beds: tierDef.beds, garage: tierDef.garage, elevator: !!tierDef.elevator, owned: false,
          floorY: (storeys - 1) * FH,          // penthouse floor height (for the elevator)
          door: doorPt,
        };
        lot.building.name = tierDef.name;
        homeLots.push(lot);
        if (isLux) {
          luxury = lot;
          // ground-floor garage zone beside the door
          lot.building.garage = { x: door.x + door.nx * 4.5, z: door.z + door.nz * 4.5, spots: [] };
          lot.building.elevatorPad = { x: lot.cx - (w / 2 - 2.0), z: lot.cz, floorY: (storeys - 1) * FH };
        }
      }
      placed.push(lot);
    }

    city.shopLots = placed.filter((l) => l.building && l.building.shop);
    city.abandonedLots = abandonedLots;
    city.homeLots = homeLots;
    city.chopShop = chopShop;
    city.realtor = realtor;
    city.luxuryLot = luxury;
  };

  // a real STOREFRONT: lit sign board + canopy awning + display windows flanking
  // the door + a door frame. `along` = the facade runs perpendicular to the door
  // normal, so detail is laid out left/right of the entrance.
  function signAwning(b, side, w, d, color, name) {
    const di = doorInfo(0, 0, w, d, side);
    const along = Math.abs(di.nx) > 0.5;          // door faces ±X → storefront spans Z
    const tx = along ? 0 : 1, tz = along ? 1 : 0; // facade tangent
    const sw = DOORW + 2.4;
    const fx = (lw, h, ld) => (along ? [ld, h, lw] : [lw, h, ld]);   // size helper (swap by facing)
    // CANOPY awning over the door (angled colour band)
    const awn = new THREE.Mesh(new THREE.BoxGeometry(...fx(sw, 0.32, 1.1)), mat(color, { emissive: color, ei: 0.4 }));
    awn.position.set(di.x + di.nx * 0.75, FH - 0.7, di.z + di.nz * 0.75); awn.rotation[along ? "x" : "z"] = -0.22 * (along ? -di.nx || 1 : 1);
    b.group.add(awn);
    // LIT SIGN BOARD across the facade above the awning
    const sign = new THREE.Mesh(new THREE.BoxGeometry(...fx(sw + 0.8, 1.0, 0.18)), mat(color, { emissive: color, ei: 0.85 }));
    sign.position.set(di.x + di.nx * 0.18, FH + 0.35, di.z + di.nz * 0.18);
    b.group.add(sign);
    // DISPLAY WINDOWS flanking the entrance + a dark DOOR FRAME
    const frame = new THREE.Mesh(new THREE.BoxGeometry(...fx(DOORW + 0.5, 3.0, 0.22)), mat(0x20242b));
    frame.position.set(di.x + di.nx * 0.06, 1.5, di.z + di.nz * 0.06); b.group.add(frame);
    for (const s of [-1, 1]) {
      const ox2 = tx * s * (DOORW * 0.5 + 1.5), oz2 = tz * s * (DOORW * 0.5 + 1.5);
      const win = new THREE.Mesh(new THREE.BoxGeometry(...fx(2.2, 2.4, 0.1)), glassMat());
      win.position.set(di.x + ox2 + di.nx * 0.05, 1.7, di.z + oz2 + di.nz * 0.05); b.group.add(win);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(...fx(2.5, 0.18, 0.26)), mat(0x2a2f37));
      sill.position.set(di.x + ox2 + di.nx * 0.04, 0.45, di.z + oz2 + di.nz * 0.04); b.group.add(sill);
    }
    if (CBZ.makeLabelSprite) {
      const s = CBZ.makeLabelSprite(name);
      if (s) { s.position.set(di.x + di.nx * 0.6, FH + 1.5, di.z + di.nz * 0.6); s.scale.set(8, 2.0, 1); b.group.add(s); }
    }
  }

  function makePark(root, lot, rng) {
    for (let i = 0; i < 4; i++) {
      const x = lot.cx + (rng() - 0.5) * lot.w * 0.7, z = lot.cz + (rng() - 0.5) * lot.d * 0.7;
      const th = 2.2 + rng() * 1.2;
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.5, th, 0.5), mat(0x6b4a2a));
      trunk.position.set(x, th / 2, z); trunk.castShadow = true; root.add(trunk);
      CBZ.colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, ref: trunk, noCam: true });
      const fol = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 2.6), mat(0x3f9a4f));
      fol.position.set(x, th + 1.0, z); fol.castShadow = true; root.add(fol);
    }
  }

  function lightenWall(hex) {
    const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    const lr = Math.round(r * 0.4 + 170 * 0.6), lg = Math.round(g * 0.4 + 174 * 0.6), lb = Math.round(b * 0.4 + 180 * 0.6);
    return (lr << 16) | (lg << 8) | lb;
  }
})();
