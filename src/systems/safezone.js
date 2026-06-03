/* ============================================================
   systems/safezone.js — the shrinking battle-royale storm (SURVIVAL).

   A circle that holds, then shrinks, in escalating phases. Anyone
   outside takes storm damage that ramps each phase, so the closing
   ring is itself an eliminator — and it squeezes everyone together
   right as the disasters peak. Visualised as a translucent storm-wall
   cylinder + a ground ring that reddens as it closes.

   Exposes CBZ.surv.zone {cx,cz,radius,...} which the bots flee toward
   and the HUD/minimap draw.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // [radius, holdSecs, shrinkSecs, dpsOutside]
  const PHASES = [
    [118, 16, 0,  1.5],
    [82,  14, 12, 3],
    [56,  12, 11, 6],
    [36,  12, 10, 11],
    [20,  10, 10, 18],
    [9,   12, 9,  28],
    [4,   999, 8, 44],
  ];

  let wall = null, ring = null;
  const zone = { cx: 0, cz: 0, radius: 120, phase: 0, t: 0, shrinking: false, from: 120, to: 120, dps: 1.5 };

  function ensureVisuals() {
    if (wall) return;
    const arena = CBZ.surv.arena;
    const cyl = new THREE.CylinderGeometry(1, 1, 80, 56, 1, true);
    const cmat = new THREE.MeshBasicMaterial({ color: 0x7ad0ff, transparent: true, opacity: 0.14, side: THREE.BackSide, depthWrite: false });
    wall = new THREE.Mesh(cyl, cmat);
    wall.renderOrder = 3;
    arena.root.add(wall);
    const rg = new THREE.RingGeometry(0.985, 1.0, 64);
    const rmat = new THREE.MeshBasicMaterial({ color: 0x7ad0ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
    ring = new THREE.Mesh(rg, rmat);
    ring.rotation.x = -Math.PI / 2; ring.renderOrder = 3;
    arena.root.add(ring);
  }

  CBZ.safezone = {
    start() {
      ensureVisuals();
      const arena = CBZ.surv.arena;
      zone.cx = arena.center.x; zone.cz = arena.center.z;
      zone.phase = 0; zone.shrinking = false;
      zone.radius = PHASES[0][0]; zone.from = zone.radius; zone.to = zone.radius;
      zone.t = PHASES[0][1]; zone.dps = PHASES[0][3];
      CBZ.surv.zone = zone;
    },
  };

  CBZ.onUpdate(29, function (dt) {
    if (CBZ.game.mode !== "survival" || !CBZ.surv.zone) return;
    const ph = PHASES[zone.phase];

    if (zone.shrinking) {
      const dur = PHASES[zone.phase + 1] ? PHASES[zone.phase][2] : 8;
      zone.t -= dt;
      const k = 1 - Math.max(0, zone.t) / Math.max(0.001, dur);
      zone.radius = zone.from + (zone.to - zone.from) * (k * k * (3 - 2 * k)); // smoothstep
      if (zone.t <= 0) {
        zone.shrinking = false;
        zone.phase = Math.min(PHASES.length - 1, zone.phase + 1);
        zone.radius = PHASES[zone.phase][0];
        zone.t = PHASES[zone.phase][1];
        zone.dps = PHASES[zone.phase][3];
      }
    } else {
      zone.t -= dt;
      if (zone.t <= 0 && PHASES[zone.phase + 1]) {
        const next = PHASES[zone.phase + 1];
        zone.shrinking = true;
        zone.from = zone.radius; zone.to = next[0];
        zone.t = PHASES[zone.phase][2];
        zone.dps = next[3];
        CBZ.flashHint && CBZ.flashHint("⚠ The safe zone is closing!", 2.4);
        CBZ.sfx && CBZ.sfx("alarm");
      }
    }

    // out-of-zone storm damage to EVERY actor (player + bots)
    const r2 = zone.radius * zone.radius;
    CBZ.surv.forEachActor(function (a) {
      const dx = a.pos.x - zone.cx, dz = a.pos.z - zone.cz;
      if (dx * dx + dz * dz > r2) CBZ.surv.hurt(a, zone.dps * dt);
    });

    // visuals
    if (wall) {
      const closeK = 1 - Math.min(1, zone.radius / 60);
      wall.position.set(zone.cx, 22, zone.cz);
      wall.scale.set(zone.radius, 1, zone.radius);
      wall.material.color.setRGB(0.3 + closeK * 0.7, 0.55 - closeK * 0.45, 1 - closeK * 0.7);
      wall.material.opacity = 0.12 + closeK * 0.16;
      ring.position.set(zone.cx, (CBZ.floorAt ? CBZ.floorAt(zone.cx, zone.cz) : 0) + 0.08, zone.cz);
      ring.scale.set(zone.radius, zone.radius, 1);
      ring.material.color.copy(wall.material.color);
    }
  });
})();
