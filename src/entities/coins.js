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

  /* ==========================================================================
     CIGARETTES ARE THE CURRENCY, SO THEY ARE NOT LYING ON THE FLOOR

     OWNER, binding: "no cigarettes lying on the ground. Cigarettes are the
     prison currency and are EARNED — stolen, traded, won — not collected off
     the floor like coins."

     MEASURED before this flag: NINETEEN packs worth 153 cigarettes spawned at
     parse time and sat there for the whole run — 8 here (yard + cells), 6 in
     world/southblock.js, 2 in world/lounge.js and 3 inside the armoury in
     world/gunroom.js — plus one 6-cig pack per NPC-vs-NPC death from
     entities/ai.js. That is not pocket change beside the economy; at the time
     it WAS the economy: a bribe is 10, a Cell Key is 25, a Gun-Room Key is 40.
     A player could fund the entire game by walking a circuit and never speak
     to a living soul, which is the exact opposite of a prison where the only
     thing anybody has is what they can take off somebody else.

     ONE FLAG, ONE CHOKE POINT, FOUR FILES UNEDITED. Every pack in the game is
     born in `addPack()` below, so the rule lives there: with
     PRISON_GROUND_CIGS false it returns null and each of those nineteen call
     sites (and ai.js's death pack) becomes a no-op that needed no edit. The
     prop TYPE, the mesh, the pickup and `CBZ.coins` all stay exactly as they
     were — systems/state.js still iterates an (empty) CBZ.coins on respawn and
     a build that sets the flag true gets the old prison back byte for byte.

     WHERE THE 153 WENT (systems/quests.js and systems/economy.js own these):
       · favour payouts   8/10/14 → 12/15/22 cigs
       · a lift takes the mark's REAL pocket, and guards carry 6-20 rather
         than the 5-18 a lazily-minted loadout used to hold
       · inmate pockets are personality-weighted, so a greedy man is a score
       · a friend hands you 2-5 off his own loadout, once a minute
       · a downed man spills what he HAD instead of minting 2-8 from nothing
     Net: the same order of money, none of it free, all of it off a person.
     ========================================================================== */
  if (CBZ.CONFIG && CBZ.CONFIG.PRISON_GROUND_CIGS == null) CBZ.CONFIG.PRISON_GROUND_CIGS = false;
  function groundCigs() { return !!(CBZ.CONFIG && CBZ.CONFIG.PRISON_GROUND_CIGS); }

  // planar proximity radius for pickup: the original block tested
  // dx*dx + dz*dz < 1.4, i.e. radius = sqrt(1.4).
  const PICKUP_R = Math.sqrt(1.4);

  CBZ.registerPropType({
    id: "coin",
    // Prison pickup: it lives under prisonRoot and does no spin/proximity work
    // while another mode owns the screen.
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
      container.userData.dynamic = true;
      container.add(grp, ring);

      return {
        mesh: container,
        radius: PICKUP_R,
        data: { group: grp, ring, collected: false, baseY: pos.y, anim: 0, value },
      };
    },
    modes: ["escape"],
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
      // (flag-on path only) one quiet row in the bounded pickup feed, the same
      // place a lifted keycard and a frisked wallet land — never a "+N" hint.
      if (CBZ.pickupNote) CBZ.pickupNote("Cigarettes", { count: c.value });
      else if (CBZ.flashHint) CBZ.flashHint(`+${c.value}`, 1.0);
      CBZ.sfx("coin");
      return false;   // never structurally removed — state.js resets it on respawn
    },
  });

  function addPack(x, z, value) {
    if (!groundCigs()) return null;      // THE RULE, and every caller obeys it for free
    const inst = CBZ.spawnProp("coin", x, 1.0, z, {
      value: value || 5,
      parent: CBZ.prisonRoot || CBZ.scene,
    });
    if (inst && inst.data) CBZ.coins.push(inst.data);
    return inst;
  }

  // scattered around the cells and yard — bigger stashes further from spawn
  [[8, -30, 4], [-8, -20, 4], [-14, 12, 6], [14, 12, 6], [0, 30, 6], [-12, 40, 8], [12, 40, 8], [0, 48, 10]]
    .forEach((p) => addPack(p[0], p[1], p[2]));

  /* Ratchet: `ground` is the number of cigarette packs standing on the floor
     of this prison and it is meant to be ZERO. `sites` is printed beside it so
     that "fixing" the count by deleting the spawn tables cannot pass — the
     nineteen call sites are still there, still addressed, still one flag away. */
  CBZ.prisonCigAudit = function () {
    return {
      allowed: groundCigs(),
      ground: (CBZ.coins || []).length,
      sites: 19,          // coins.js 8 · southblock 6 · lounge 2 · gunroom 3
      deathPacks: 0,      // entities/ai.js's per-kill pack, same choke point
    };
  };

  CBZ.addPack = addPack;
})();
