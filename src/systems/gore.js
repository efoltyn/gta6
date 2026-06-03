/* ============================================================
   systems/gore.js — cinematic death gore for BOTH games.

   One call, CBZ.gore(x, y, z, opts), throws a burst of blood
   droplets + chunky flying limb gibs (gravity + tumble + settle),
   stamps a spreading blood pool on the ground, and gives a short
   red jolt + shake (+ optional slow-mo). Self-contained: its own
   meshes and an always-updater (runs in every mode AND state), so
   prison shootouts and disaster deaths both end with a dramatic,
   bloody, limbs-flying finish.

   opts: { dir:{x,z}, amount:0.5..2, skin, cloth, slowmo:secs,
           player:bool, sfx:bool|string }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const GRAV = 24;
  const BLOOD = 0x8a0b10, BLOOD_D = 0x5e070b;
  const bits = [];     // flying gibs + blood droplets
  const splats = [];   // ground blood pools
  let flashEl = null, flashV = 0;

  function scene() { return CBZ.scene; }
  function floorAt(x, z) { return CBZ.floorAt ? CBZ.floorAt(x, z) : 0; }
  function rm(m) { if (!m) return; if (m.parent) m.parent.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material && m.material.dispose) m.material.dispose(); }

  function spawnBit(x, y, z, vx, vy, vz, size, color, kind) {
    if (bits.length > 440) return;     // hard cap so a nuke can't flood the scene
    const geo = kind === "blood"
      ? new THREE.SphereGeometry(size, 5, 4)
      : new THREE.BoxGeometry(size, size * (0.5 + Math.random()), size * (0.7 + Math.random() * 0.6));
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z); m.castShadow = false;
    scene().add(m);
    bits.push({
      m, vx, vy, vz, kind,
      sx: (Math.random() - 0.5) * 18, sy: (Math.random() - 0.5) * 18, sz: (Math.random() - 0.5) * 18,
      landed: false, bled: false,
      life: kind === "blood" ? 0.7 + Math.random() * 0.8 : 7 + Math.random() * 6,
    });
  }

  function spawnSplat(x, z, grow, color) {
    if (splats.length > 150) rm(splats.shift().m);
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 12),
      new THREE.MeshBasicMaterial({ color: color || BLOOD_D, transparent: true, opacity: 0, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, floorAt(x, z) + 0.04 + Math.random() * 0.02, z);
    m.renderOrder = 3; m.scale.set(0.1, 0.1, 1);
    scene().add(m);
    splats.push({ m, t: 0, grow });
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
    const cam = CBZ.camera && CBZ.camera.position;
    if (cam) { const dx = x - cam.x, dz = z - cam.z; if (dx * dx + dz * dz > 70 * 70) return; }
    const amt = opts.amount != null ? opts.amount : 1;
    let dx = 0, dz = 0;
    if (opts.dir) { dx = opts.dir.x || 0; dz = opts.dir.z || 0; }
    const dm = Math.hypot(dx, dz) || 1; dx /= dm; dz /= dm;
    const skin = opts.skin != null ? opts.skin : 0xc98a5e;
    const cloth = opts.cloth != null ? opts.cloth : 0xd24a32;
    // blood mist — fast light droplets in a forward-biased fan
    const nb = Math.round(16 * amt);
    for (let i = 0; i < nb; i++) {
      const a = Math.random() * 6.28, sp = 2 + Math.random() * 8;
      spawnBit(x, y + 0.3 + Math.random() * 1.2, z,
        dx * (4 + Math.random() * 4) + Math.cos(a) * sp * 0.4,
        3 + Math.random() * 7,
        dz * (4 + Math.random() * 4) + Math.sin(a) * sp * 0.4,
        0.09 + Math.random() * 0.12, Math.random() < 0.5 ? BLOOD : BLOOD_D, "blood");
    }
    // chunky gibs — limbs/torso, heavier, tumble then settle as debris
    const ng = Math.round(5 * amt);
    const cols = [skin, cloth, BLOOD, cloth, skin, 0xb8443a];
    for (let i = 0; i < ng; i++) {
      const a = Math.random() * 6.28, sp = 3 + Math.random() * 5;
      spawnBit(x, y + 0.5 + Math.random(), z,
        dx * (5 + Math.random() * 3) + Math.cos(a) * sp,
        4.5 + Math.random() * 5.5,
        dz * (5 + Math.random() * 3) + Math.sin(a) * sp,
        0.22 + Math.random() * 0.3, cols[i % cols.length], "gib");
    }
    spawnSplat(x, z, 1.1 + amt * 0.9, BLOOD_D);
    if (CBZ.shake) CBZ.shake(0.26 * amt + (opts.player ? 0.4 : 0));
    flashV = Math.max(flashV, 0.32 * amt + (opts.player ? 0.18 : 0));
    if (opts.slowmo && CBZ.doSlowmo) CBZ.doSlowmo(opts.slowmo);
    if (opts.sfx && CBZ.sfx) CBZ.sfx(typeof opts.sfx === "string" ? opts.sfx : "hit");
  };

  // one always-updater drives gibs + pools + the red jolt, in every mode/state
  CBZ.onAlways(8, function (dt) {
    if (dt <= 0) return;
    if (flashV > 0.002) { ensureFlash().style.opacity = String(Math.min(0.5, flashV)); flashV *= Math.pow(0.0012, dt); }
    else if (flashEl && flashEl.style.opacity !== "0") { flashEl.style.opacity = "0"; flashV = 0; }

    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i], m = b.m;
      b.vy -= GRAV * dt;
      m.position.x += b.vx * dt; m.position.y += b.vy * dt; m.position.z += b.vz * dt;
      m.rotation.x += b.sx * dt; m.rotation.y += b.sy * dt; m.rotation.z += b.sz * dt;
      const fl = floorAt(m.position.x, m.position.z);
      if (m.position.y <= fl + 0.06 && b.vy < 0) {
        if (b.kind === "blood") { spawnSplat(m.position.x, m.position.z, 0.35 + Math.random() * 0.5, BLOOD_D); rm(m); bits.splice(i, 1); continue; }
        m.position.y = fl + 0.06; b.vy = 0; b.vx *= 0.22; b.vz *= 0.22; b.sx *= 0.1; b.sy *= 0.1; b.sz *= 0.1; b.landed = true;
        if (!b.bled) { b.bled = true; spawnSplat(m.position.x, m.position.z, 0.4 + Math.random() * 0.4, BLOOD_D); }
      }
      if (b.landed || b.kind === "blood") b.life -= dt;
      if (b.life <= 0) { rm(m); bits.splice(i, 1); }
    }

    for (let i = splats.length - 1; i >= 0; i--) {
      const s = splats[i]; s.t += dt;
      const sc = Math.min(s.grow, s.t * 5 * s.grow);
      s.m.scale.set(Math.max(0.1, sc), Math.max(0.1, sc), 1);
      const fadeIn = Math.min(1, s.t * 4);
      const fadeOut = s.t > 12 ? Math.max(0, 1 - (s.t - 12) / 8) : 1;
      s.m.material.opacity = 0.62 * fadeIn * fadeOut;
      if (s.t > 20) { rm(s.m); splats.splice(i, 1); }
    }
  });

  // wipe all gore (called on a match reset / scene swap)
  CBZ.clearGore = function () {
    for (const b of bits) rm(b.m); bits.length = 0;
    for (const s of splats) rm(s.m); splats.length = 0;
    flashV = 0; if (flashEl) flashEl.style.opacity = "0";
  };
})();
