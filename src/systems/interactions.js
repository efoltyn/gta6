/* ============================================================
   systems/interactions.js — keycard pickup, the door, breaker box,
   security cameras, ventilation, and win check. (Cigarette-pack
   pickups used to live here too — that block is now the "coin"
   prop type in systems/proptypes.js / entities/coins.js, the F3
   proof that a migrated object type sheds its dedicated block here.)
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { player, el, keycard, door } = CBZ;
  const g = CBZ.game;

  let hintTimer = 0;
  const fadeEl = document.getElementById("fade");

  function updateInteractions(dt) {
    // ---- keycard ----
    if (!keycard.collected) {
      keycard.group.rotation.y += dt * 2;
      keycard.group.position.y = keycard.baseY + Math.sin(CBZ.now * 0.004) * 0.12;
      const d = player.pos.distanceTo(
        new THREE.Vector3(keycard.group.position.x, player.pos.y, keycard.group.position.z)
      );
      if (d < 1.6) {
        keycard.collected = true; g.hasKey = true;
        keycard.group.visible = false; keycard.ring.visible = false;
        el.keycard.classList.add("have");
        CBZ.sfx("key"); CBZ.flashToast("KEYCARD!");
        CBZ.setObjective("Keycard opens staff checkpoints. Cross the yard or scout tunnels for another way out.");
      }
    }

    // ---- cigarette packs ---- migrated to systems/proptypes.js's "coin"
    // prop type (see entities/coins.js) — bob/spin + proximity pickup now
    // live in that def's onUpdate/onInteract, ticked by the registry's own
    // updater instead of here.

    // ---- door ----
    const ddx = player.pos.x, ddz = player.pos.z + 8;
    const nearDoor = ddx * ddx + ddz * ddz < 16;
    if (!door.open) {
      if (nearDoor) {
        if (g.hasKey) {
          CBZ.openDoor();
          CBZ.setObjective("Cross the yard, dodge the searchlights, reach the glowing exit.");
        } else {
          CBZ.showHint("Locked checkpoint - find a keycard or crawl through maintenance.");
          hintTimer = 0.4;
        }
      }
    } else if (door.t < 1) {
      door.t = Math.min(1, door.t + dt * 1.6);
      door.mesh.position.y = door.closedY + door.t * 8; // slide up into the wall
    }

    // ---- breaker box power sabotage ----
    const breaker = CBZ.breaker;
    if (breaker) {
      if (breaker.sabotaged) {
        breaker.timer -= dt;
        if (breaker.timer <= 0) {
          breaker.sabotaged = false;
          breaker.light.material.color.setHex(0x39ff88);
          breaker.light.material.emissive.setHex(0x14c258);
          if (CBZ.ceilingLamp) {
            CBZ.ceilingLamp.material.color.setHex(0xffe9a8);
            CBZ.ceilingLamp.material.emissive.setHex(0xffcf66);
          }
          CBZ.sfx("key");
          CBZ.flashToast("POWER RESTORED");
        }
      } else {
        const bdx = player.pos.x - breaker.x, bdz = player.pos.z - breaker.z;
        if (bdx * bdx + bdz * bdz < 1.8) {
          CBZ.showHint("⚡ Press [E] to Sabotage Power");
          hintTimer = 0.2;
          if (CBZ.keys && CBZ.keys["e"]) {
            breaker.sabotaged = true;
            breaker.timer = 20;
            breaker.light.material.color.setHex(0xff3b3b);
            breaker.light.material.emissive.setHex(0xff0000);
            if (CBZ.ceilingLamp) {
              CBZ.ceilingLamp.material.color.setHex(0x2b2b2b);
              CBZ.ceilingLamp.material.emissive.setHex(0x000000);
            }
            CBZ.sfx("door"); // Clank sound
            CBZ.flashToast("POWER OUT!");
            CBZ.flashHint("⚡ Sabotaged power! All cameras and Cell Block lights are deactivated for 20s.", 3.2);
          }
        }
      }
    }

    // ---- security cameras (detection & destruction) ----
    if (CBZ.cameras && !g.invuln) {
      for (const cam of CBZ.cameras) {
        const cdx = player.pos.x - cam.pos.x, cdz = player.pos.z - cam.pos.z;
        const dist = Math.hypot(cdx, cdz);

        if (cam.destroyed) continue;

        // Player punching/attacking near the camera to smash it
        if (dist < 2.0 && CBZ.playerChar && CBZ.playerChar.punchT > 0) {
          cam.destroyed = true;
          CBZ.sfx("punch");
          CBZ.flashHint("💥 Security camera destroyed!", 2.2);
          continue;
        }

        if (!cam.active) continue;

        if (dist < 9.0) {
          const yaw = cam.body.rotation.y;
          const targetAngle = Math.atan2(cdx, cdz);
          let diff = Math.abs(targetAngle - yaw);
          diff = (diff + Math.PI) % (Math.PI * 2) - Math.PI;
          diff = Math.abs(diff);

          if (diff < 0.32) {
            // inside detection field
            CBZ.addHeat(dt * 38);
            CBZ.showHint("⚠️ CAMERA DETECTING YOU!");
            hintTimer = 0.2;
            // Blink lens rapidly
            cam.lens.material.color.setHex(CBZ.now % 200 < 100 ? 0xffea00 : 0xff3b3b);
            cam.lens.material.emissive.setHex(CBZ.now % 200 < 100 ? 0xccbb00 : 0xff0000);
          } else {
            // Restore default colors
            cam.lens.material.color.setHex(0xff3b3b);
            cam.lens.material.emissive.setHex(0xff0000);
          }
        }
      }
    }

    // ---- ventilation grates (secret crawlspaces) ----
    if (CBZ.vents && !CBZ.crawling) {
      for (const vent of CBZ.vents) {
        const vdx = player.pos.x - vent.x, vdz = player.pos.z - vent.z;
        if (vdx * vdx + vdz * vdz < 1.6) {
          if (player.crouch) {
            CBZ.showHint(`💨 Press [E] to Crawl to ${vent.dest.name}`);
            hintTimer = 0.2;
            if (CBZ.keys && CBZ.keys["e"]) {
              CBZ.crawling = true;
              if (fadeEl) fadeEl.style.opacity = "1";
              setTimeout(() => {
                player.pos.set(vent.dest.x, vent.dest.y, vent.dest.z);
                if (CBZ.playerChar) CBZ.playerChar.group.position.copy(player.pos);
                player.crouch = true;
                CBZ.sfx("door");
                setTimeout(() => {
                  if (fadeEl) fadeEl.style.opacity = "0";
                  CBZ.crawling = false;
                }, 300);
              }, 200);
            }
          } else {
            CBZ.showHint("Crouch [Shift] to enter vent / hatch");
            hintTimer = 0.2;
          }
        }
      }
    }

    // hint fade-out
    if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) CBZ.hideHint(); }

    // ---- win ----
    const ex = player.pos.x - CBZ.EXIT.x, ez = player.pos.z - CBZ.EXIT.z;
    let routeWin = false;
    if (CBZ.altExitZones) {
      for (const zone of CBZ.altExitZones) {
        const ax = player.pos.x - zone.x, az = player.pos.z - zone.z;
        if (ax * ax + az * az < zone.r * zone.r) { routeWin = true; break; }
      }
    }
    if (ex * ex + ez * ez < 9) CBZ.winGame();
    else if (routeWin) CBZ.winGame("route");
  }

  CBZ.updateInteractions = updateInteractions;
  CBZ.onUpdate(40, updateInteractions);
})();
