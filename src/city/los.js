/* ============================================================
   city/los.js — shared "is there a clear line of fire from A to B?"

   Cops (police.js) and armed NPCs (combat.js / peds.js) call this BEFORE
   they shoot so they stop firing through buildings — and so their gun props
   stop poking out through walls. It reads the same CBZ.losBlockers mesh set
   the camera occlusion and guard vision already use (buildings register their
   walls into it at build time), so it stays consistent with what the player
   can actually see.

   TWO hard-learned rules live here now:
   • DUAL-DIRECTION: walls are FrontSide boxes and Mesh.raycast CULLS back
     faces — a muzzle poked INSIDE a wall box (a shooter pressed against the
     facade) starts its ray past the entry face, sees only culled back faces,
     and the wall simply vanishes from the test. That false "clear" was how
     people outside shot you through solid walls. The reverse pass (target →
     muzzle) sees that same wall's target-side face as a FRONT face and
     catches it.
   • OPEN WINDOWS ARE HOLES: a wall hit whose point sits inside a SHATTERED
     pane's rect (CBZ.cityShotHole, buildings.js) doesn't block — the frame
     is open air, so NPCs naturally fire through windows someone already
     broke. Intact glass never registers (panes aren't blockers; the solid
     wall behind them is), so an unbroken window still protects.
   ============================================================ */
(function () {
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;

  const ray = new THREE.Raycaster();
  const o = new THREE.Vector3(), dir = new THREE.Vector3();

  // does this sorted hit list actually BLOCK, or is every hit an open
  // (shattered) window hole the ray may pass through?
  function blockedBy(hits) {
    if (!hits.length) return false;
    const hole = CBZ.cityShotHole;
    if (!hole || (CBZ.game && CBZ.game.mode !== "city")) return true;
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i], n = h.face && h.face.normal;   // walls are axis-aligned: object-space normal == world
      if (!hole(h.point.x, h.point.y, h.point.z, n ? n.x : 0, n ? n.z : 0)) return true;
    }
    return false;
  }

  // true  = clear shot (nothing solid between the muzzle and the target)
  // false = a wall/building is in the way → don't fire, reposition instead
  CBZ.clearLineOfFire = function (ax, ay, az, bx, by, bz) {
    const blk = CBZ.losBlockers;
    if (!blk || !blk.length) return true;
    o.set(ax, ay, az);
    dir.set(bx - ax, by - ay, bz - az);
    const dist = dir.length();
    if (dist < 0.0001) return true;
    dir.multiplyScalar(1 / dist);
    // forward pass: muzzle → target
    ray.set(o, dir);
    ray.near = 0;
    ray.far = Math.max(0.1, dist - 0.45); // ignore a wall sitting right on the target
    if (blockedBy(ray.intersectObjects(blk, false))) { ray.near = 0; return false; }
    // reverse pass: target → muzzle (catches the buried-muzzle case — see top).
    // near mirrors the forward pass's far margin: the first 0.45 from the
    // target stays exempt so cover hugging the TARGET still doesn't block.
    o.set(bx, by, bz);
    dir.multiplyScalar(-1);
    ray.set(o, dir);
    ray.near = 0.45;
    ray.far = dist;
    const blocked = blockedBy(ray.intersectObjects(blk, false));
    ray.near = 0;   // never leak the near offset into the next caller
    return !blocked;
  };
})();
