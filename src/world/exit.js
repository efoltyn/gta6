/* ============================================================
   world/exit.js — the glowing freedom gate, now at the FAR south end
   of the enlarged compound (CBZ.WORLD.exit).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.prisonRoot || CBZ.scene;
  const { addBox, COL, WORLD } = CBZ;
  const { GLOW, GLOW_E } = COL;
  const EX = WORLD.exit.x, EZ = WORLD.exit.z;

  // glowing pillars + lintel framing the gap
  addBox(EX - 4.2, 4, EZ, 0.9, 8, 1.4, GLOW, { emissive: GLOW_E, ei: 1.2 });
  addBox(EX + 4.2, 4, EZ, 0.9, 8, 1.4, GLOW, { emissive: GLOW_E, ei: 1.2 });
  addBox(EX, 8.4, EZ, 9.5, 1.2, 1.4, GLOW, { emissive: GLOW_E, ei: 1.2 });

  // glowing floor pad
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(7.5, 4),
    new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.55 })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(EX, 0.05, EZ - 1);
  scene.add(pad);

  // soft light shaft
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.6, 18, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
  );
  beam.position.set(EX, 9, EZ);
  scene.add(beam);

  // ---- THE DOOR TELLS YOU WHETHER YOU ARE FAST -------------------------
  // OWNER: "escape fast is cool". A record you can only read after the run is
  // a scoreboard; a record you can see WHILE you sprint for the gate is a
  // gradient, and CLAUDE.md's why-constitution says the gradient is the game.
  // So the pad and the light shaft go GOLD for as long as the run clock is
  // still under your best escape (systems/runstats.js -> CBZ.runStatsPace),
  // and drop back to the ordinary green the moment you go over it.
  //
  // This authors no clock, no record and no state: it reads one function and
  // flips two colours it already owns (both materials are built right here —
  // the framing pillars use addBox's POOLED materials and are deliberately
  // left alone, because tinting one of those would tint every glow box in the
  // prison). Flag-off is byte-identical to the original one-line pulse.
  if (CBZ.CONFIG.PRISON_GATE_PACE == null) CBZ.CONFIG.PRISON_GATE_PACE = true;
  const PACE_HEX = 0xffd166;                       // css --gold, the record colour
  let paceOn = null;                               // tri-state: null = never set
  CBZ.onAlways(6, function () {
    let ahead = false;
    if (CBZ.CONFIG.PRISON_GATE_PACE && CBZ.runStatsPace) {
      const p = CBZ.runStatsPace();
      ahead = !!(p && p.ahead);
    }
    // colour is written only on the FLIP, not every frame
    if (ahead !== paceOn) {
      paceOn = ahead;
      const hex = ahead ? PACE_HEX : GLOW;
      pad.material.color.setHex(hex);
      beam.material.color.setHex(hex);
    }
    // on pace the pulse also runs a touch hotter and quicker — the same cue
    // read twice, so it still lands for a colour-blind player.
    pad.material.opacity = (ahead ? 0.5 : 0.4) + 0.2 * Math.sin(CBZ.now * (ahead ? 0.0062 : 0.004));
  });

  CBZ.EXIT = new THREE.Vector3(EX, 0, EZ);
})();
