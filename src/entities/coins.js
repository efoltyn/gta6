/* ============================================================
   entities/coins.js — cigarette-pack pickups (the yard's loose cash).
   Mesh + spawn now ride the systems/proptypes.js registry (PROOF that a
   migrated object type sheds its own file's bespoke spawn/animate code
   AND the dedicated if/for block that used to live in
   systems/interactions.js — see the "coin" registerPropType below and
   the registry's onUpdate/onInteract taking over what that block did).

   CBZ.coins stays populated for compatibility: systems/state.js still
   resets packs on respawn by iterating CBZ.coins directly, so each
   pushed entry is the SAME object the registry mutates (inst.data),
   not a copy — state.js's toggling of .collected/.anim/.group.visible
   keeps working unchanged.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const mat = CBZ.mat;

  // planar proximity radius for pickup: the original block tested
  // dx*dx + dz*dz < 1.4, i.e. radius = sqrt(1.4).
  const PICKUP_R = Math.sqrt(1.4);

  CBZ.registerPropType({
    id: "coin",
    // no `modes` filter — the original coin block in interactions.js ran
    // unconditionally (no CBZ.game.mode check), so this keeps ticking
    // regardless of the active mode, same as before.
    build(pos, opts) {
      const value = (opts && opts.value) || 5;

      const grp = new THREE.Group();
      // white pack body with a coloured top band + a little "filter" stripe
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.28), mat(0xf6f3ea, { emissive: 0x554b33, ei: 0.25 }));
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.16, 0.3), mat(0xc94d3a));
      band.position.y = 0.22;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.24), mat(0xffd451));
      lid.position.y = 0.31;
      grp.add(body, band, lid);
      grp.position.set(pos.x, pos.y, pos.z);
      grp.castShadow = true;

      // floor glow ring
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.4, 0.6, 20),
        new THREE.MeshBasicMaterial({ color: 0xffd451, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(pos.x, 0.05, pos.z);

      // grp and ring were independent scene children before; wrap them in
      // an identity-transform container so spawnProp can add ONE mesh —
      // both keep their own absolute-coordinate transforms, so this is
      // visually identical to two top-level scene.add() calls.
      const container = new THREE.Group();
      container.add(grp, ring);

      return {
        mesh: container,
        radius: PICKUP_R,
        data: { group: grp, ring, collected: false, baseY: pos.y, anim: 0, value },
      };
    },
    onUpdate(dt, inst) {
      const c = inst.data;
      if (c.collected) {
        if (c.anim < 1) {
          c.anim += dt * 3.5;
          c.group.position.y = c.baseY + c.anim * 1.6;
          c.group.scale.setScalar(Math.max(0, 1 - c.anim));
          if (c.anim >= 1) c.group.visible = false;
        }
        return;
      }
      c.group.rotation.y += dt * 3;
      c.group.position.y = c.baseY + Math.sin(CBZ.now * 0.005 + c.baseY) * 0.1;
    },
    interactRadius: PICKUP_R,
    onInteract(player, inst) {
      const c = inst.data;
      if (c.collected) return false;    // already picked up, still animating away
      c.collected = true; c.anim = 0;
      if (c.ring) c.ring.visible = false;
      CBZ.econ.addCigs(c.value);
      CBZ.flashHint(`+${c.value} 🚬`, 1.0);
      CBZ.sfx("coin");
      return false;   // never structurally removed — state.js resets it on respawn
    },
  });

  function addPack(x, z, value) {
    const inst = CBZ.spawnProp("coin", x, 1.0, z, { value: value || 5 });
    if (inst && inst.data) CBZ.coins.push(inst.data);
    return inst;
  }

  // scattered around the cells and yard — bigger stashes further from spawn
  [[8, -30, 4], [-8, -20, 4], [-14, 12, 6], [14, 12, 6], [0, 30, 6], [-12, 40, 8], [12, 40, 8], [0, 48, 10]]
    .forEach((p) => addPack(p[0], p[1], p[2]));

  CBZ.addPack = addPack;
})();
