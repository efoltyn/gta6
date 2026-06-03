/* ============================================================
   systems/compass.js — a little arrow that points to your current
   objective (keycard → yard door → exit gate) with distance, so you
   always know where to head without a full minimap.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const arrowEl = document.getElementById("compassArrow");
  const distEl = document.getElementById("compassDist");
  const wrap = document.getElementById("compass");
  if (!wrap) return;

  function objectivePos() {
    const g = CBZ.game;
    if (!CBZ.keycard.collected) return CBZ.keycard.group.position;
    if (!CBZ.door.open) return new THREE.Vector3(0, 0, -8);   // the yard door
    return CBZ.EXIT;
  }

  const _dir = new THREE.Vector3(), _q = new THREE.Quaternion();
  CBZ.onUpdate(46, function () {
    if (CBZ.game.mode !== "escape") return; // survival points the compass at the zone (HUD handles it)
    const tgt = objectivePos();
    _dir.set(tgt.x - CBZ.player.pos.x, 0, tgt.z - CBZ.player.pos.z);
    const dist = _dir.length();
    // transform the world direction into the camera's own space — robust to
    // any yaw/pitch. In view space: -z is forward (up on screen), +x is right.
    _dir.normalize().applyQuaternion(_q.copy(CBZ.camera.quaternion).invert());
    const deg = Math.atan2(_dir.x, -_dir.z) * 180 / Math.PI; // 0 = ahead, +clockwise
    arrowEl.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    distEl.textContent = Math.round(dist) + "m";
  });
})();
