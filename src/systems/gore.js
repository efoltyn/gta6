/* ============================================================
   systems/gore.js — cinematic, visceral death gore for BOTH games.

   One call, CBZ.gore(x, y, z, opts), throws a layered blood event:
     • a forward-biased SPRAY of fast droplets that fling AWAY from the
       impact (exit-wound directionality), each leaving a splat where it lands
     • a fine high-velocity MIST puff (rifle/headshot/explosion feel) that
       hangs, drifts, and fades — the subtle aerosol that reads as "real"
     • chunky flying GIBS (limbs/torso, gravity + tumble + settle as debris)
     • lingering ground POOLS that spread, darken and only slowly fade
     • WALL SPLATTER: if a surface sits just behind the victim along the shot
       line, a vertical blood decal is stamped on it (GTA-style)
   plus a short red jolt + shake (+ optional slow-mo). Headshots and explosions
   get a bigger mist + spray + pool. Self-contained: shared geometry/materials,
   pooled, hard-capped, distance-LOD'd, driven by one always-updater so prison
   shootouts, survival deaths and city murders all end bloody.

   PRESERVED public API: CBZ.gore(x,y,z,opts), CBZ.clearGore().

   opts: { dir:{x,z}, amount:0.5..2, skin, cloth, slowmo:secs,
           player:bool, sfx:bool|string, head:bool, explosion:bool }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const GRAV = 24;
  const BLOOD = 0x8a0b10, BLOOD_D = 0x5e070b, BLOOD_BRT = 0xb01218;
  const bits = [];     // flying gibs + blood droplets + mist
  const splats = [];   // ground blood pools
  const walls = [];    // vertical wall/surface splatter decals
  let flashEl = null, flashV = 0;

  function scene() { return CBZ.scene; }
  function floorAt(x, z) { return CBZ.floorAt ? CBZ.floorAt(x, z) : 0; }
  function rm(m) { if (!m) return; if (m.parent) m.parent.remove(m); if (m.material && !m.material._shared && m.material.dispose) m.material.dispose(); }

  // ---- shared geometry (one allocation, reused by every bit/decal) ----
  const G_DROP = new THREE.SphereGeometry(1, 5, 4);   // blood droplet (scaled per-bit)
  const G_MIST = new THREE.SphereGeometry(1, 4, 3);   // fine mist puff (low poly)
  const G_GIB = new THREE.BoxGeometry(1, 1, 1);       // chunky gib (scaled per-bit)
  const G_DISC = new THREE.CircleGeometry(1, 14);     // ground pool
  const G_PLANE = new THREE.PlaneGeometry(1, 1);      // wall splatter

  // ---- shared materials (cloned only when a unique per-bit color is needed) --
  const matCache = new Map();
  function lambert(color) {
    let m = matCache.get(color);
    if (!m) { m = new THREE.MeshLambertMaterial({ color }); m._shared = true; matCache.set(color, m); }
    return m;
  }

  // a soft radial blood texture, generated once, used by pools + wall splats so
  // edges feather instead of showing a hard polygon rim (much more convincing).
  let bloodTex = null;
  function bloodTexture() {
    if (bloodTex) return bloodTex;
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.55, "rgba(255,255,255,0.95)");
    grd.addColorStop(0.82, "rgba(255,255,255,0.45)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.beginPath(); g.arc(32, 32, 32, 0, 6.2832); g.fill();
    // a few irregular satellite blobs so a pool isn't a perfect circle
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * 6.28, r = 16 + Math.random() * 14;
      const bx = 32 + Math.cos(a) * r, by = 32 + Math.sin(a) * r, br = 3 + Math.random() * 6;
      const bg = g.createRadialGradient(bx, by, 0, bx, by, br);
      bg.addColorStop(0, "rgba(255,255,255,0.7)"); bg.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = bg; g.beginPath(); g.arc(bx, by, br, 0, 6.2832); g.fill();
    }
    bloodTex = new THREE.CanvasTexture(c);
    bloodTex.wrapS = bloodTex.wrapT = THREE.ClampToEdgeWrapping;
    return bloodTex;
  }

  function dist2Cam(x, z) {
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam) return 0;
    const dx = x - cam.x, dz = z - cam.z; return dx * dx + dz * dz;
  }

  function spawnBit(x, y, z, vx, vy, vz, size, color, kind) {
    const cap = kind === "mist" ? 620 : 520;
    if (bits.length > cap) return;     // hard cap so a nuke can't flood the scene
    let geo, mat;
    if (kind === "gib") { geo = G_GIB; mat = lambert(color); }
    else if (kind === "mist") { geo = G_MIST; mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false }); }
    else { geo = G_DROP; mat = lambert(color); }
    const m = new THREE.Mesh(geo, mat);
    // gibs are boxy with random proportions; drops/mist are scaled spheres
    if (kind === "gib") m.scale.set(size, size * (0.5 + Math.random()), size * (0.7 + Math.random() * 0.6));
    else m.scale.setScalar(size);
    m.position.set(x, y, z); m.castShadow = false; m.renderOrder = kind === "mist" ? 5 : 0;
    scene().add(m);
    bits.push({
      m, vx, vy, vz, kind, mat: kind === "mist" ? mat : null, mistFade: 0,
      sx: (Math.random() - 0.5) * 18, sy: (Math.random() - 0.5) * 18, sz: (Math.random() - 0.5) * 18,
      landed: false, bled: false, baseScale: size,
      life: kind === "blood" ? 0.7 + Math.random() * 0.8 : (kind === "mist" ? 0.45 + Math.random() * 0.45 : 7 + Math.random() * 6),
    });
  }

  function spawnSplat(x, z, grow, color, linger) {
    if (splats.length > 170) { rm(splats.shift().m); }
    const m = new THREE.Mesh(G_DISC,
      new THREE.MeshBasicMaterial({ color: color || BLOOD_D, map: bloodTexture(), transparent: true, opacity: 0, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * 6.28;
    m.position.set(x, floorAt(x, z) + 0.04 + Math.random() * 0.02, z);
    m.renderOrder = 3; m.scale.set(0.1, 0.1, 1);
    scene().add(m);
    splats.push({ m, t: 0, grow, max: grow, hold: linger ? 30 : 12, fade: linger ? 14 : 8 });
  }

  // stamp a vertical blood decal on a wall/surface that sits just behind the
  // victim along the impact direction (dir points AWAY from shooter). Cheap:
  // a single AABB scan of CBZ.colliders, no raycaster, capped + distance-gated.
  function spawnWallSplat(x, y, z, dx, dz, amt) {
    const cols = CBZ.colliders;
    if (!cols || !cols.length || walls.length > 48) return;
    const MAXD = 3.4;
    let best = null, bestT = MAXD;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i]; if (!c || c.minX == null) continue;
      if (c.y1 != null && (y < c.y0 - 0.3 || y > c.y1 + 0.3)) continue; // height-gated wall out of band
      // ray (x,z)+t*(dx,dz) vs AABB slab — find nearest forward face hit
      let t0 = 0, t1 = bestT, face = null;
      if (Math.abs(dx) > 1e-4) {
        let ta = (c.minX - x) / dx, tb = (c.maxX - x) / dx, fa = dx > 0 ? "xmin" : "xmax";
        if (ta > tb) { const s = ta; ta = tb; tb = s; fa = fa === "xmin" ? "xmax" : "xmin"; }
        if (ta > t0) { t0 = ta; face = fa; } t1 = Math.min(t1, tb);
      } else if (x < c.minX || x > c.maxX) { continue; }
      if (Math.abs(dz) > 1e-4) {
        let ta = (c.minZ - z) / dz, tb = (c.maxZ - z) / dz, fa = dz > 0 ? "zmin" : "zmax";
        if (ta > tb) { const s = ta; ta = tb; tb = s; fa = fa === "zmin" ? "zmax" : "zmin"; }
        if (ta > t0) { t0 = ta; face = fa; } t1 = Math.min(t1, tb);
      } else if (z < c.minZ || z > c.maxZ) { continue; }
      if (face && t0 >= 0 && t0 <= t1 && t0 < bestT) { bestT = t0; best = { c, t: t0, face }; }
    }
    if (!best) return;
    const hx = x + dx * best.t, hz = z + dz * best.t;
    const m = new THREE.Mesh(G_PLANE,
      new THREE.MeshBasicMaterial({ color: BLOOD_D, map: bloodTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    let nx = 0, nz = 0, off = 0.03;
    if (best.face === "xmin") { nx = -1; } else if (best.face === "xmax") { nx = 1; }
    else if (best.face === "zmin") { nz = -1; } else { nz = 1; }
    m.position.set(hx + nx * off, y + 0.1 + Math.random() * 0.3, hz + nz * off);
    if (nx) m.rotation.y = nx > 0 ? Math.PI / 2 : -Math.PI / 2;
    m.rotation.z = Math.random() * 6.28;
    m.renderOrder = 4;
    const sz = 0.7 + amt * 0.7;
    m.scale.set(0.1, 0.1, 1);
    scene().add(m);
    walls.push({ m, t: 0, grow: sz, hold: 26, fade: 12 });
    // a couple of drip streaks running down from the splat
    const drips = Math.min(3, 1 + Math.round(amt));
    for (let d = 0; d < drips; d++) {
      const dm = new THREE.Mesh(G_PLANE,
        new THREE.MeshBasicMaterial({ color: BLOOD_D, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      dm.position.copy(m.position); dm.rotation.copy(m.rotation);
      dm.position.x += nx ? 0 : (Math.random() - 0.5) * sz * 0.7;
      dm.position.z += nx ? (Math.random() - 0.5) * sz * 0.7 : 0;
      dm.scale.set(0.04, 0.1, 1);
      scene().add(dm);
      walls.push({ m: dm, t: 0, grow: 0, hold: 26, fade: 12, drip: 0.3 + Math.random() * 0.7, dripY: m.position.y });
    }
  }

  function ensureFlash() {
    if (flashEl) return flashEl;
    flashEl = document.createElement("div");
    flashEl.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:26;opacity:0;background:radial-gradient(ellipse at 50% 50%,rgba(150,0,0,0) 42%,rgba(135,0,0,.6) 100%)";
    document.body.appendChild(flashEl);
    return flashEl;
  }

  CBZ.gore = function (x, y, z, opts) {
    opts = opts || {};
    if (!CBZ.scene) return;
    // distance gate: a death far from the camera (e.g. the bird's-eye mass
    // sim, or the far side of the island) skips the gibs/flash/shake entirely
    // so hundreds of off-screen kills can't flood the scene or strobe the view.
    const d2 = dist2Cam(x, z);
    if (CBZ.camera && CBZ.camera.position && d2 > 70 * 70) return;
    const far = d2 > 40 * 40;          // mid-distance → spawn fewer particles (LOD)
    const lod = far ? 0.5 : 1;

    const amt = opts.amount != null ? opts.amount : 1;
    // headshot / explosion get a heavier, mistier, gorier treatment. Callers
    // signal a headshot either explicitly (opts.head) or with a fat amount(>=1.3).
    const head = !!opts.head || amt >= 1.3;
    const boom = !!opts.explosion;
    const big = head || boom;

    let dx = 0, dz = 0, hasDir = false;
    if (opts.dir) { dx = opts.dir.x || 0; dz = opts.dir.z || 0; hasDir = (dx || dz); }
    const dm = Math.hypot(dx, dz) || 1; dx /= dm; dz /= dm;
    // perpendicular axis (for fanning the spray to either side of the shot line)
    const px = -dz, pz = dx;
    const skin = opts.skin != null ? opts.skin : 0xc98a5e;
    const cloth = opts.cloth != null ? opts.cloth : 0xd24a32;

    // --- LAYER 1: directional SPRAY — fast droplets flung AWAY from impact ---
    // forward-biased fan; tighter cone for a clean headshot, wide burst for boom.
    const spread = boom ? 1.0 : (head ? 0.5 : 0.7);
    const fwd = boom ? 1.5 : (head ? 7 : 5);   // forward push along dir (exit wound)
    const nb = Math.round(16 * amt * lod);
    for (let i = 0; i < nb; i++) {
      const side = (Math.random() - 0.5) * 2;          // -1..1 across the fan
      const fanX = dx * (fwd + Math.random() * 5) + px * side * spread * (4 + Math.random() * 5);
      const fanZ = dz * (fwd + Math.random() * 5) + pz * side * spread * (4 + Math.random() * 5);
      // boom has no preferred direction → omnidirectional ring
      const omni = boom || !hasDir;
      const a = Math.random() * 6.28, sp = 2 + Math.random() * 8;
      spawnBit(x, y + 0.3 + Math.random() * 1.2, z,
        omni ? Math.cos(a) * sp * 0.7 : fanX,
        3 + Math.random() * 7 + (boom ? 4 : 0),
        omni ? Math.sin(a) * sp * 0.7 : fanZ,
        0.07 + Math.random() * 0.11, Math.random() < 0.5 ? BLOOD : BLOOD_D, "blood");
    }

    // --- LAYER 2: fine MIST — high-velocity aerosol (headshot/rifle/explosion) -
    // subtle hanging puff that drifts on the shot line and fades fast; this is
    // the touch that reads as "real" for high-velocity wounds.
    const nm = Math.round((big ? 18 : 8) * amt * lod);
    for (let i = 0; i < nm; i++) {
      const a = Math.random() * 6.28, sp = 1 + Math.random() * 4;
      spawnBit(x + (Math.random() - 0.5) * 0.3, y + 0.6 + Math.random() * 1.0, z + (Math.random() - 0.5) * 0.3,
        dx * (big ? 5 : 2.5) + Math.cos(a) * sp,
        2 + Math.random() * 3,
        dz * (big ? 5 : 2.5) + Math.sin(a) * sp,
        0.05 + Math.random() * 0.07, Math.random() < 0.4 ? BLOOD_BRT : BLOOD, "mist");
    }

    // --- LAYER 3: chunky GIBS — limbs/torso, heavier, tumble then settle ------
    const ng = Math.round((big ? 7 : 5) * amt * lod);
    const cols = [skin, cloth, BLOOD, cloth, skin, 0xb8443a, BLOOD_D];
    for (let i = 0; i < ng; i++) {
      const side = (Math.random() - 0.5) * 2, a = Math.random() * 6.28, sp = 3 + Math.random() * 5;
      const omni = boom || !hasDir;
      spawnBit(x, y + 0.5 + Math.random(), z,
        omni ? Math.cos(a) * sp : dx * (5 + Math.random() * 3) + px * side * 3,
        4.5 + Math.random() * 5.5 + (boom ? 3 : 0),
        omni ? Math.sin(a) * sp : dz * (5 + Math.random() * 3) + pz * side * 3,
        0.2 + Math.random() * 0.3, cols[i % cols.length], "gib");
    }

    // --- LAYER 4: ground POOL — lingers, spreads, biased forward of the body --
    const pgx = hasDir ? x + dx * 0.4 : x, pgz = hasDir ? z + dz * 0.4 : z;
    spawnSplat(pgx, pgz, 1.1 + amt * 0.9 + (big ? 0.6 : 0), BLOOD_D, true);
    if (big) spawnSplat(x - dx * 0.5, z - dz * 0.5, 0.6 + amt * 0.4, BLOOD, true);

    // --- LAYER 5: WALL SPLATTER — vertical decal on a surface behind the body -
    if (hasDir && !far) spawnWallSplat(x, y + 0.5, z, dx, dz, amt);

    if (CBZ.shake) CBZ.shake(0.26 * amt + (opts.player ? 0.4 : 0) + (boom ? 0.2 : 0));
    flashV = Math.max(flashV, 0.32 * amt + (opts.player ? 0.18 : 0));
    if (opts.slowmo && CBZ.doSlowmo) CBZ.doSlowmo(opts.slowmo);
    if (opts.sfx && CBZ.sfx) CBZ.sfx(typeof opts.sfx === "string" ? opts.sfx : "hit");
  };

  // one always-updater drives gibs + mist + pools + wall splats + the red jolt
  CBZ.onAlways(8, function (dt) {
    if (dt <= 0) return;
    if (flashV > 0.002) { ensureFlash().style.opacity = String(Math.min(0.5, flashV)); flashV *= Math.pow(0.0012, dt); }
    else if (flashEl && flashEl.style.opacity !== "0") { flashEl.style.opacity = "0"; flashV = 0; }

    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i], m = b.m;
      if (b.kind === "mist") {
        // mist floats: light gravity, drag, gentle rise then settle, fades out
        b.vy -= GRAV * 0.12 * dt;
        b.vx *= Math.pow(0.04, dt); b.vz *= Math.pow(0.04, dt);
        m.position.x += b.vx * dt; m.position.y += b.vy * dt; m.position.z += b.vz * dt;
        b.life -= dt;
        const k = Math.max(0, b.life);
        m.scale.setScalar(b.baseScale * (1 + (1 - Math.min(1, b.life)) * 2.2));  // expand as it dissipates
        if (b.mat) b.mat.opacity = 0.5 * Math.min(1, k * 2.2);
        if (b.life <= 0) { rm(m); bits.splice(i, 1); }
        continue;
      }
      b.vy -= GRAV * dt;
      m.position.x += b.vx * dt; m.position.y += b.vy * dt; m.position.z += b.vz * dt;
      m.rotation.x += b.sx * dt; m.rotation.y += b.sy * dt; m.rotation.z += b.sz * dt;
      const fl = floorAt(m.position.x, m.position.z);
      if (m.position.y <= fl + 0.06 && b.vy < 0) {
        if (b.kind === "blood") { spawnSplat(m.position.x, m.position.z, 0.3 + Math.random() * 0.5, BLOOD_D, false); rm(m); bits.splice(i, 1); continue; }
        m.position.y = fl + 0.06; b.vy = 0; b.vx *= 0.22; b.vz *= 0.22; b.sx *= 0.1; b.sy *= 0.1; b.sz *= 0.1; b.landed = true;
        if (!b.bled) { b.bled = true; spawnSplat(m.position.x, m.position.z, 0.4 + Math.random() * 0.4, BLOOD_D, false); }
      }
      if (b.landed || b.kind === "blood") b.life -= dt;
      if (b.life <= 0) { rm(m); bits.splice(i, 1); }
    }

    for (let i = splats.length - 1; i >= 0; i--) {
      const s = splats[i]; s.t += dt;
      const sc = Math.min(s.grow, s.t * 5 * s.grow);
      s.m.scale.set(Math.max(0.1, sc), Math.max(0.1, sc), 1);
      const fadeIn = Math.min(1, s.t * 4);
      const fadeOut = s.t > s.hold ? Math.max(0, 1 - (s.t - s.hold) / s.fade) : 1;
      s.m.material.opacity = 0.66 * fadeIn * fadeOut;
      if (s.t > s.hold + s.fade) { rm(s.m); splats.splice(i, 1); }
    }

    for (let i = walls.length - 1; i >= 0; i--) {
      const w = walls[i]; w.t += dt;
      if (w.drip) {
        // drip streak crawls downward then halts, growing its length
        const len = Math.min(0.9, w.t * w.drip);
        w.m.scale.set(0.04 + w.t * 0.01, len, 1);
        w.m.position.y = w.dripY - len * 0.5;
      } else {
        const sc = Math.min(w.grow, w.t * 6 * w.grow);
        w.m.scale.set(Math.max(0.1, sc), Math.max(0.1, sc), 1);
      }
      const fadeIn = Math.min(1, w.t * 5);
      const fadeOut = w.t > w.hold ? Math.max(0, 1 - (w.t - w.hold) / w.fade) : 1;
      w.m.material.opacity = 0.7 * fadeIn * fadeOut;
      if (w.t > w.hold + w.fade) { rm(w.m); walls.splice(i, 1); }
    }
  });

  // wipe all gore (called on a match reset / scene swap)
  CBZ.clearGore = function () {
    for (const b of bits) rm(b.m); bits.length = 0;
    for (const s of splats) rm(s.m); splats.length = 0;
    for (const w of walls) rm(w.m); walls.length = 0;
    flashV = 0; if (flashEl) flashEl.style.opacity = "0";
  };
})();
