/* lab ingredient "player": THE player, on the real on-foot physics.

   entities/player.js builds the body and the CBZ.player record (the same
   orange-suited rig the jail opens on), systems/physics.js updatePlayer runs
   it at update order 10 exactly as in the game (gravity, step-up, the
   deepest-first collide against CBZ.colliders, sprint, the rig's gait), and
   systems/input.js owns CBZ.keys. The lab drives it the way a person does:
   it holds keys. walkTo() points the camera yaw at the goal (physics walks
   "W" along the camera's forward) and holds W, with Shift to sprint.

   opts: at [x, z], yaw (deg)
   handle: walkTo(x, z, {sprint}), stop(), hold(keys[]), state()
   state(): pos, speed, moveX/moveZ (the drive pushables reads), grounded,
            yRange (min/max of pos.y since spawn: a flat floor must keep it 0) */
CBZ.lab.ingredient("player", {
  files: ["src/entities/player.js", "src/systems/physics.js", "src/systems/input.js"],
  make: function (W, o) {
    const P = CBZ.player, ch = CBZ.playerChar;
    if (!P || !P.pos || P.observer) throw new Error("entities/player.js did not load (no real CBZ.player)");
    const at = o.at || [0, 0];
    P.pos.set(at[0], 0, at[1]);
    P.vy = 0; P.grounded = true;
    if (ch && ch.group) { ch.group.position.copy(P.pos); ch.group.rotation.y = (o.yaw || 0) * Math.PI / 180; }
    P.labName = o.name;
    const keys = CBZ.keys || (CBZ.keys = {});
    let goal = null, yMin = 0, yMax = 0, ySum = 0, yN = 0, peak = 0;
    function release() { keys.w = false; keys.shift = false; keys.a = false; keys.s = false; keys.d = false; }
    // runs before physics (order 10): aim the camera at the goal, hold the keys
    (CBZ.onUpdate || function () {})(9.5, function () {
      if (!goal) return;
      const dx = goal.x - P.pos.x, dz = goal.z - P.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < (goal.stop || 0.25)) { release(); W.event(o.name, "arrived (" + d.toFixed(2) + " m off)"); goal = null; return; }
      CBZ.cam.yaw = Math.atan2(-dx, -dz);
      keys.w = true; keys.shift = !!goal.sprint;
    });
    W.every(function () {
      const y = P.pos.y;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
      ySum += y; yN++;
      peak = Math.max(peak, P.speed || 0);
    });
    const R3 = function (v) { return Math.round(v * 1000) / 1000; };
    const h = {
      actor: P, obj: ch && ch.group,
      walkTo: function (x, z, opts) { opts = opts || {}; goal = { x: x, z: z, sprint: !!opts.sprint, stop: opts.stop }; },
      stop: function () { goal = null; release(); },
      hold: function (list) { goal = null; release(); (list || []).forEach(function (k) { keys[k] = true; }); },
      yRange: function () { return R3(yMax - yMin); },
      state: function () {
        return {
          pos: [R3(P.pos.x), R3(P.pos.y), R3(P.pos.z)], speed: R3(P.speed || 0), peakSpeed: R3(peak),
          sprint: !!P.sprint, grounded: !!P.grounded, drive: [R3(P.moveX || 0), R3(P.moveZ || 0)],
          yRange: R3(yMax - yMin), yMean: yN ? R3(ySum / yN) : 0,
        };
      },
      watch: {
        gait: function () { const s = P.speed || 0; return s > 4.2 ? "sprinting" : s > 0.3 ? "walking" : "still"; },
      },
    };
    return h;
  },
});
