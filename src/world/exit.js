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
  /* ---- AND WHETHER IT IS YOURS AT ALL ------------------------------------
     Only the ESCAPING role wins by crossing this wire; a player on the COP
     side is just on shift, and systems/interactions.js said so in words —
     `flashHint("You're on shift — the gate clocks you right back in.")` on a
     10-second throttle, the last narration line left at the exit.

     It does not need words, because this gate is already a lamp. The pad and
     the shaft have carried live machine state since the pace cue shipped, and
     the prison speaks one colour language everywhere else it has to refuse
     somebody: red locked / amber denied / green open, on the admin door
     plates, on the checkpoint card reader and on every camera lens. So a cop
     who steps on the pad watches the way out go RED under his boots and clear
     again when he walks off — the same sentence world/door.js's reader says,
     said by the gate itself, in the place it applies.

     DENY_R is deliberately wider (6 m) than interactions.js's win radius (3 m):
     the gate has to have said no BEFORE you are standing in it, or the signal
     arrives at the same instant as the non-event it is explaining. */
  const DENY_HEX = 0xff3b3b;
  const DENY_R2 = 6.0 * 6.0;
  let denyOn = null;
  CBZ.onAlways(6, function () {
    const g = CBZ.game;
    let deny = false;
    if (g && g.mode === "escape" && g.role === "cop" && CBZ.player && CBZ.player.pos) {
      const dx = CBZ.player.pos.x - EX, dz = CBZ.player.pos.z - EZ;
      deny = dx * dx + dz * dz < DENY_R2;
    }
    let ahead = false;
    if (!deny && CBZ.CONFIG.PRISON_GATE_PACE && CBZ.runStatsPace) {
      const p = CBZ.runStatsPace();
      ahead = !!(p && p.ahead);
    }
    // colour is written only on the FLIP, not every frame
    if (ahead !== paceOn || deny !== denyOn) {
      paceOn = ahead; denyOn = deny;
      const hex = deny ? DENY_HEX : (ahead ? PACE_HEX : GLOW);
      pad.material.color.setHex(hex);
      beam.material.color.setHex(hex);
    }
    // on pace the pulse also runs a touch hotter and quicker — the same cue
    // read twice, so it still lands for a colour-blind player. A refusal beats
    // faster still and harder, which is what an amber-deny lamp does.
    pad.material.opacity = deny
      ? 0.42 + 0.30 * Math.sin(CBZ.now * 0.011)
      : (ahead ? 0.5 : 0.4) + 0.2 * Math.sin(CBZ.now * (ahead ? 0.0062 : 0.004));
  });

  CBZ.EXIT = new THREE.Vector3(EX, 0, EZ);
})();
