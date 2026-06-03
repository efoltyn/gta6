/* ============================================================
   city/los.js — shared "is there a clear line of fire from A to B?"

   Cops (police.js) and armed NPCs (combat.js / peds.js) call this BEFORE
   they shoot so they stop firing through buildings — and so their gun props
   stop poking out through walls. It reads the same CBZ.losBlockers mesh set
   the camera occlusion and guard vision already use (buildings register their
   walls into it at build time), so it stays consistent with what the player
   can actually see.
   ============================================================ */
(function () {
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;

  const ray = new THREE.Raycaster();
  const o = new THREE.Vector3(), dir = new THREE.Vector3();

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
    ray.set(o, dir);
    ray.far = Math.max(0.1, dist - 0.45); // ignore a wall sitting right on the target
    return ray.intersectObjects(blk, false).length === 0;
  };
})();
