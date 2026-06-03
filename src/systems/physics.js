/* ============================================================
   systems/physics.js — player movement, gravity, and circle-vs-box
   collision resolution against the world colliders.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { player, playerChar, keys, lerpAngle, animChar } = CBZ;
  const T = CBZ.TUNE;

  // vertical-physics constants (survival's multi-storey buildings)
  const STEP_UP = 0.9;      // forgiving auto-climb: stairs stay easy at a run
  const STEP_DOWN = 0.9;    // small drops you step down; bigger ones you fall off
  const BODY_H = 1.7;       // collision body height for height-gated walls

  // ---- static-world collision broad phase ---------------------------
  // Most colliders are inert walls and props. Index their expanded bounds
  // once, then resolve an actor against only the bucket under its feet.
  // This changes actor-vs-world collision from O(all walls) to O(local walls).
  const COL_CELL = 8;
  const COL_PAD = 1.0;      // larger than any actor radius in this game
  const COL_OFF = 32768;
  const COL_SPAN = 65536;
  const EMPTY_COLS = [];
  const colBuckets = new Map();
  let colCount = -1, colDirty = true;

  function colKey(gx, gz) { return (gx + COL_OFF) * COL_SPAN + (gz + COL_OFF); }

  function rebuildColliderGrid() {
    colBuckets.clear();
    const cols = CBZ.colliders;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const x0 = Math.floor((c.minX - COL_PAD) / COL_CELL);
      const x1 = Math.floor((c.maxX + COL_PAD) / COL_CELL);
      const z0 = Math.floor((c.minZ - COL_PAD) / COL_CELL);
      const z1 = Math.floor((c.maxZ + COL_PAD) / COL_CELL);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const key = colKey(gx, gz);
        let bucket = colBuckets.get(key);
        if (!bucket) { bucket = []; colBuckets.set(key, bucket); }
        bucket.push(c);
      }
    }
    colCount = cols.length;
    colDirty = false;
    CBZ.colliderBroadphaseStats = { colliders: colCount, buckets: colBuckets.size };
  }

  CBZ.markCollidersDirty = function () { colDirty = true; };

  function nearbyColliders(pos) {
    if (colDirty || colCount !== CBZ.colliders.length) rebuildColliderGrid();
    return colBuckets.get(colKey(Math.floor(pos.x / COL_CELL), Math.floor(pos.z / COL_CELL))) || EMPTY_COLS;
  }

  // generic circle-vs-box resolution against the world colliders.
  // mutates pos.{x,z}. Shared by the player AND every NPC/guard.
  // feetY/headY (optional) give the actor's vertical span so height-gated
  // colliders (windows / upper floors) are skipped when the body is clear of
  // them; omit them and every collider acts full-height (prison behaviour).
  function collide(pos, radius, feetY, headY) {
    const cols = nearbyColliders(pos);
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.y0 != null && (headY <= c.y0 || feetY >= c.y1)) continue; // body clears this wall
      const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      let dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        const d = Math.sqrt(d2);
        if (d < 0.0001) {
          const penX = Math.min(pos.x - c.minX, c.maxX - pos.x);
          const penZ = Math.min(pos.z - c.minZ, c.maxZ - pos.z);
          if (penX < penZ) pos.x += (pos.x < (c.minX + c.maxX) / 2 ? -1 : 1) * (penX + radius);
          else pos.z += (pos.z < (c.minZ + c.maxZ) / 2 ? -1 : 1) * (penZ + radius);
        } else {
          const push = (radius - d) / d;
          pos.x += dx * push; pos.z += dz * push;
        }
      }
    }
  }
  CBZ.collide = collide;

  // Highest walkable surface under (x,z): the terrain height field, raised by
  // any building floor/stair/roof platform whose top is within reach. `fromY`
  // is the feet height we're testing from — a platform only counts as support
  // if it's no more than STEP_UP above us (so you can't walk up a sheer wall,
  // only stairs). In the prison there are no platforms, so this is just terrain.
  function groundAt(x, z, fromY) {
    let best = CBZ.floorAt ? CBZ.floorAt(x, z) : 0;
    const plats = CBZ.platforms;
    if (plats.length && CBZ.game.mode !== "escape") {
      const reach = (fromY != null ? fromY : best) + STEP_UP;
      for (let i = 0; i < plats.length; i++) {
        const p = plats[i];
        if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
        // stairs are stored as a sloped ramp so you glide up smoothly instead
        // of hopping tread to tread; flat floors/roofs just use their top.
        let top = p.top;
        if (p.ramp) { const r = p.ramp; let t = (z - r.z0) / (r.z1 - r.z0); if (t < 0) t = 0; else if (t > 1) t = 1; top = r.y0 + t * (r.y1 - r.y0); }
        if (top <= reach && top > best) best = top;
      }
    }
    return best;
  }
  CBZ.groundAt = groundAt;

  function resolveCollisions() { collide(player.pos, player.radius, player.pos.y + 0.25, player.pos.y + BODY_H); }

  function updatePlayer(dt) {
    // ---- driving: a city vehicle owns the player's transform this frame.
    //      The city vehicle controller (city/vehicles.js) moves player.pos and
    //      the (hidden) character rig, so we bail out of on-foot physics. ----
    if (player.driving) return;

    // ---- physical reactions: thrown / knocked down by a disaster, throw,
    //      push or blast. Reads the shared body state (grapple.js / body). ----
    const ph = player._phys;
    if (ph && !player.dead) {
      if (ph.fl > 0) ph.fl = Math.max(0, ph.fl - dt);
      if (ph.air) {
        ph.vy -= T.gravity * dt;
        player.pos.x += ph.vx * dt; player.pos.z += ph.vz * dt; player.pos.y += ph.vy * dt;
        const fl = groundAt(player.pos.x, player.pos.z, player.pos.y);
        if (player.pos.y <= fl && ph.vy <= 0) { player.pos.y = fl; ph.air = false; ph.vx = ph.vz = 0; ph.vy = 0; ph.down = Math.max(ph.down, 1.3); if (CBZ.shake) CBZ.shake(0.5); }
        resolveCollisions();
        playerChar.group.position.copy(player.pos);
        playerChar.group.rotation.x += ph.spin * dt;
        player.speed = 0; player.crouch = false;
        animChar(playerChar, 0, dt);
        return;
      }
      if (ph.down > 0) {
        ph.down -= dt;
        player.speed = 0; player.crouch = false;
        player.vy -= T.gravity * dt; player.pos.y += player.vy * dt;
        const fl = groundAt(player.pos.x, player.pos.z, player.pos.y);
        if (player.pos.y <= fl) { player.pos.y = fl; player.vy = 0; }
        if (Math.abs(ph.kx) > 0.02 || Math.abs(ph.kz) > 0.02) { player.pos.x += ph.kx * dt; player.pos.z += ph.kz * dt; const d = Math.pow(0.0009, dt); ph.kx *= d; ph.kz *= d; }
        resolveCollisions();
        playerChar.group.position.copy(player.pos);
        playerChar.group.rotation.x = CBZ.damp(playerChar.group.rotation.x, -Math.PI / 2, 10, dt); // on your back
        animChar(playerChar, 0, dt);
        return;
      }
    }

    // ---- SURVIVAL death: a dramatic spinning ragdoll launch, then sprawl ----
    const D = player._death;
    if (D && CBZ.game.mode !== "escape") {
      player.speed = 0; player.crouch = false;
      const floorY = groundAt(player.pos.x, player.pos.z, player.pos.y);
      if (!D.landed) {
        D.vy -= T.gravity * dt;
        player.pos.x += D.vx * dt; player.pos.z += D.vz * dt; player.pos.y += D.vy * dt;
        const dec = Math.pow(0.05, dt); D.vx *= dec; D.vz *= dec;
        resolveCollisions();
        const fy = groundAt(player.pos.x, player.pos.z, player.pos.y);
        if (player.pos.y <= fy && D.vy <= 0) { player.pos.y = fy; D.landed = true; if (CBZ.shake) CBZ.shake(0.45); }
        playerChar.group.position.copy(player.pos);
        playerChar.group.rotation.x += D.spin * dt;
        playerChar.group.rotation.z += D.spin2 * dt;
      } else {
        player.pos.y = floorY;
        playerChar.group.position.copy(player.pos);
        playerChar.group.rotation.x = CBZ.damp(playerChar.group.rotation.x, -Math.PI / 2, 7, dt);
        playerChar.group.rotation.z = CBZ.damp(playerChar.group.rotation.z, 0.22 * Math.sin(D.seed * 1.7), 9, dt);
      }
      playerChar.group.scale.y += (1 - playerChar.group.scale.y) * (1 - Math.pow(0.001, dt));
      if (CBZ.deathPose) CBZ.deathPose(playerChar, D.seed);
      return;
    }

    if (player.dead || player.ko > 0) {
      if (!player.dead) player.ko = Math.max(0, (player.ko || 0) - dt);
      player.speed = 0;
      player.crouch = false;
      player.vy -= T.gravity * dt;
      player.pos.y += player.vy * dt;
      const floorD = groundAt(player.pos.x, player.pos.z, player.pos.y);
      if (player.pos.y <= floorD) { player.pos.y = floorD; player.vy = 0; player.grounded = true; }
      playerChar.group.position.set(player.pos.x, player.pos.y, player.pos.z);
      playerChar.group.rotation.z = CBZ.damp(playerChar.group.rotation.z, Math.PI / 2, 11, dt);
      playerChar.group.scale.y += (1 - playerChar.group.scale.y) * (1 - Math.pow(0.001, dt));
      animChar(playerChar, 0, dt);
      return;
    }

    const cam = CBZ.cam;
    const sinY = Math.sin(cam.yaw), cosY = Math.cos(cam.yaw);
    const fx = -sinY, fz = -cosY;   // forward (W)
    const rx = cosY, rz = -sinY;    // right (D)
    let mx = 0, mz = 0;
    if (keys["w"]) { mx += fx; mz += fz; }
    if (keys["s"]) { mx -= fx; mz -= fz; }
    if (keys["d"]) { mx += rx; mz += rz; }
    if (keys["a"]) { mx -= rx; mz -= rz; }
    const overview = !!(CBZ.simView && CBZ.simView.active);
    const mapOpen = !!(CBZ.fullMap && CBZ.fullMap.active);
    if (overview || mapOpen) { mx = 0; mz = 0; } // WASD belongs to the active overlay instead

    // stunned (baton / taser): no input this frame, gravity still applies
    if (player.stun > 0) { player.stun -= dt; mx = mz = 0; }
    const stunned = player.stun > 0;

    const len = Math.hypot(mx, mz);
    // In survival/city SHIFT is sprint (stamina-gated); in prison it's crouch.
    const surv = CBZ.game.mode !== "escape";
    player.crouch = !overview && !mapOpen && !surv && !stunned && !!keys["shift"];
    player.sprint = !mapOpen && surv && !stunned && !!keys["shift"] && len > 0 && (player.stamina === undefined || player.stamina > 0);
    const sprintMul = (CBZ.SURV && CBZ.SURV.sprintMul) || 1.7;
    const moveSpeed = player.crouch ? T.crouchSpeed : (player.sprint ? T.walkSpeed * sprintMul : T.walkSpeed);
    let desX = 0, desZ = 0;
    if (len > 0) { mx /= len; mz /= len; desX = mx * moveSpeed; desZ = mz * moveSpeed; }
    player.pos.x += desX * dt;
    player.pos.z += desZ * dt;
    player.speed = Math.hypot(desX, desZ);

    // jump + gravity + ground following (terrain, stairs, floors, roofs)
    if (!overview && !mapOpen && !stunned && keys[" "] && player.grounded) { player.vy = T.jumpVel; player.grounded = false; CBZ.sfx("jump"); }
    const support = groundAt(player.pos.x, player.pos.z, player.pos.y);
    if (player.grounded) {
      if (support <= player.pos.y + STEP_UP && support >= player.pos.y - STEP_DOWN) {
        // close enough to the surface under us — stick to it. This follows
        // slopes DOWN, climbs a stair tread UP, and steps down a short ledge,
        // all without a hover or a bounce.
        player.pos.y = support; player.vy = 0;
      } else {
        // walked off an edge taller than a stair (a roof rim, a balcony) —
        // hand off to gravity so you actually fall instead of snapping down.
        player.grounded = false;
        player.vy -= T.gravity * dt;
        player.pos.y += player.vy * dt;
        if (player.pos.y <= support) { player.pos.y = support; player.vy = 0; player.grounded = true; }
      }
    } else {
      player.vy -= T.gravity * dt;
      player.pos.y += player.vy * dt;
      if (player.pos.y <= support && player.vy <= 0) { player.pos.y = support; player.vy = 0; player.grounded = true; } // landed
    }

    resolveCollisions();

    // sync model
    playerChar.group.position.set(player.pos.x, player.pos.y, player.pos.z);
    if (len > 0) {
      const tYaw = Math.atan2(mx, mz);
      playerChar.group.rotation.y = lerpAngle(playerChar.group.rotation.y, tYaw, 1 - Math.pow(0.0006, dt));
    }
    // crouch squash
    const cs = player.crouch ? 0.62 : 1.0;
    playerChar.group.scale.y += (cs - playerChar.group.scale.y) * (1 - Math.pow(0.001, dt));
    // get back up after a knockdown (ease the fall-over rotation out)
    if (playerChar.group.rotation.x) playerChar.group.rotation.x = CBZ.damp(playerChar.group.rotation.x, 0, 9, dt);
    animChar(playerChar, player.speed, dt);
  }

  CBZ.updatePlayer = updatePlayer;
  CBZ.onUpdate(10, updatePlayer);
})();
