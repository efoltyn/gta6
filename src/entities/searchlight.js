/* ============================================================
   entities/searchlight.js — tower searchlights that sweep the yard.
   Visual cone + moving ground pool of light, and they ALSO catch you:
   detection.js queries CBZ.litBySearchlight(pos, crouch).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.prisonRoot || CBZ.scene;

  // searchlights are real SENSORS when this is on: systems/detection.js
  // consumes CBZ.litBySearchlight (heat + guard pings), and down in update()
  // the beam that is actually holding the player flushes red as feedback.
  if (CBZ.CONFIG && CBZ.CONFIG.JAIL_SEARCHLIGHT_DETECT == null) CBZ.CONFIG.JAIL_SEARCHLIGHT_DETECT = true;

  function makeLight(towerX, towerZ, phase, sweep, sweepZ, sweepZAmp) {
    // the lamp head on the tower
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.7, 0.8, 12),
      CBZ.mat(0xf7f4d8, { emissive: 0xfff1a8, ei: 0.9 })
    );
    head.position.set(towerX, 6.2, towerZ);
    head.rotation.z = Math.PI / 2;
    scene.add(head);

    // a real spotlight for the glow (no shadow — keeps it cheap)
    const spot = new THREE.SpotLight(0xfff3c0, 1.4, 60, 0.5, 0.5, 1.2);
    spot.position.set(towerX, 6.2, towerZ);
    const tgt = new THREE.Object3D();
    tgt.userData.mover = true;
    scene.add(tgt);
    spot.target = tgt;
    scene.add(spot);

    // translucent cone you can actually see sweeping through the air
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 6, 14, 18, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
    );
    cone.userData.mover = true;
    cone.position.set(towerX, 6.2, towerZ);
    scene.add(cone);

    // bright pool on the ground
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(5, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.22, depthWrite: false })
    );
    pool.userData.mover = true;
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.06;
    scene.add(pool);

    const sl = {
      head, spot, tgt, cone, pool, phase, sweep,
      sweepZ: sweepZ != null ? sweepZ : 28, sweepZAmp: sweepZAmp != null ? sweepZAmp : 16,
      gx: towerX, gz: towerZ, poolRadius: 5,
      target: new THREE.Vector3(),
    };
    CBZ.searchlights.push(sl);
    return sl;
  }

  // north exercise yard — two lights sweeping from opposite corners
  makeLight(-30, 52, 0, 18, 28, 16);
  makeLight(30, 52, Math.PI, 18, 28, 16);
  // south block — a wider pair sweeping the lower yard toward the gate
  makeLight(-44, 128, Math.PI / 2, 30, 92, 26);
  makeLight(44, 128, -Math.PI / 2, 30, 92, 26);

  function update(dt) {
    for (const sl of CBZ.searchlights) {
      if (sl.disabled > 0) {
        sl.disabled = Math.max(0, sl.disabled - dt);
        sl.spot.intensity = 0.15;
        sl.cone.material.opacity = 0.02;
        sl.pool.material.opacity = 0.04;
      } else {
        sl.spot.intensity = 1.4;
        sl.cone.material.opacity = 0.1;
        sl.pool.material.opacity = 0.22;
      }
      // ground target tracks a slow sine sweep across the yard width
      const t = CBZ.now * 0.0006 + sl.phase;
      const tx = Math.sin(t) * sl.sweep;
      const tz = sl.sweepZ + Math.cos(t * 0.7) * sl.sweepZAmp;
      sl.target.set(tx, 0, tz);

      sl.tgt.position.copy(sl.target);
      sl.pool.position.x = tx; sl.pool.position.z = tz;

      // aim the visible cone from the head toward the pool
      const dir = sl.target.clone().sub(new THREE.Vector3(sl.gx, 6.2, sl.gz));
      const len = dir.length();
      sl.cone.scale.y = len / 14;
      sl.cone.position.set((sl.gx + tx) / 2, (6.2) / 2, (sl.gz + tz) / 2);
      sl.cone.lookAt(sl.target);
      sl.cone.rotateX(Math.PI / 2);

      // ---- caught-in-the-beam feedback (JAIL_SEARCHLIGHT_DETECT) ----
      // the pool that's actually holding the player flushes red and throbs;
      // systems/detection.js applies the matching heat + guard pings.
      let hot = false;
      if (CBZ.CONFIG && CBZ.CONFIG.JAIL_SEARCHLIGHT_DETECT && !(sl.disabled > 0) &&
          CBZ.game.mode === "escape" && CBZ.game.state === "playing" &&
          CBZ.player && CBZ.player.pos) {
        const pdx = CBZ.player.pos.x - tx, pdz = CBZ.player.pos.z - tz;
        const pr = sl.poolRadius * (CBZ.player.crouch ? 0.6 : 1.0);
        hot = pdx * pdx + pdz * pdz < pr * pr;
      }
      if (hot !== !!sl._hot) {
        sl._hot = hot;
        const col = hot ? 0xff6a55 : 0xfff3c0;   // per-light materials, safe to tint
        sl.cone.material.color.setHex(col);
        sl.pool.material.color.setHex(col);
      }
      if (hot) {
        sl.pool.material.opacity = 0.3 + 0.08 * Math.sin(CBZ.now * 0.02);
        sl.cone.material.opacity = 0.16;
      }
    }
  }

  // detection query: is this position inside any searchlight pool?
  CBZ.litBySearchlight = function (pos, crouch) {
    for (const sl of CBZ.searchlights) {
      if (sl.disabled > 0) continue;
      const dx = pos.x - sl.pool.position.x;
      const dz = pos.z - sl.pool.position.z;
      // crouching effectively shrinks how far into the pool you can be caught
      const r = sl.poolRadius * (crouch ? 0.6 : 1.0);
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  };

  CBZ.onUpdate(21, function (dt) {
    if (CBZ.game.mode === "escape") update(dt);
  });
  // keep them sweeping on the title screen too, for atmosphere
  CBZ.onAlways(7, function (dt) {
    if (CBZ.game.mode === "escape" && CBZ.game.state !== "playing") update(dt);
  });
})();
