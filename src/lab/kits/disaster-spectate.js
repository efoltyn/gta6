/* lab kit "disaster-spectate": the disaster game's death and ghost camera.

   The real island (world/disaster_arena.js), the real round engine
   (systems/disasters.js) with a small crowd, the real player on physics.js,
   the HUD (systems/survivalhud.js) and the spectator camera
   (systems/spectator.js). A disaster is forced at once; at `die` seconds
   the player is killed through the mode's own damage door (CBZ.surv.hurt).
   Then the kit flies the ghost camera with scripted input, the way a person
   would: keys in CBZ.keys, a mouse drag and a wheel on the canvas, and real
   TouchEvents on the spectator's touch pad (one finger, a pinch, a
   two-finger pan, the up button). A second disaster is forced while you
   are dead, and at the end PLAY AGAIN starts a new round.

   What it measures (every frame: phase, camera and body positions):
     beat      the body's ragdoll flight and the camera's distance from it
               while the death plays; the panel lands after it, not on it
     pull      death -> pull -> free in order, the camera ends high and wide,
               no frame-to-frame jump (smooth)
     fly       metres moved per input (W, Space, Shift, wheel, drag, pinch,
               pan, the up button), and the floor clamp under a long dive
     world     the director's phases and rounds after the death: it must keep
               warning and striking; the corpse leaves the actor list
     hud       the card's name and size, the clock, the ghost panel
   params: first (disaster forced at boot, default quake), second (forced
   while dead, default tornado), die (s, default 2), bots (default 12)
   probe:  ok when every check above holds. */
CBZ.lab.kit("disaster-spectate", {
  about: "kill the disaster player: death beat, pull-back to the spectator camera, scripted desktop + touch flying, disasters still running, play again",
  uses: ["player"],
  mode: "survival",
  files: ["src/vendor/BufferGeometryUtils.js", "src/vendor/noise.js", "src/modes/survival.js", "src/world/disaster_arena.js",
    "src/entities/survivorbot.js", "src/systems/disasters.js", "src/systems/survivalhud.js", "src/systems/spectator.js"],
  // the island and the roster read these at run time behind feature tests
  symbols: ["vegetationKit", "treeCrownGeo", "treeTrunkGeo", "islandDressing", "islandRoadKit", "buildFuelStation", "dressFacade",
    "facadeDef", "facadeList", "furnish", "groundSkin", "collapse", "debris", "waterBuildDisasterGeometry", "makeDisasterWaterMaterial",
    "survSeaHeightAt", "survFloodDepthAt", "survSeaMeanY", "waterSurgeSet", "waterEventSample", "quake", "tornado", "groundShaft",
    "groundWaterFrontSet", "flashflood", "weatherDrive", "speech", "body", "trauma", "gore", "detonate", "structure"],
  params: { first: "quake", second: "tornado", die: 2, bots: 12 },
  duration: 42,
  setup: function (W, P) {
    CBZ.SURV_BOTS = +P.bots;
    W.add("player", { name: "you", at: [0, 0] });
    CBZ.modes.survival.reset(CBZ.game);
    const p = CBZ.player.pos, cam = CBZ.camera;
    // the play camera's framing at the moment of death: behind and above
    cam.position.set(p.x + 4.5, p.y + 2.6, p.z + 4.5); cam.lookAt(p.x, p.y + 1.2, p.z);
    CBZ.disasters.force(P.first);
    W.rows = []; W.marks = {}; W.dir = []; W.die = +P.die;
    let lastDir = "";
    W.every(function () {
      const S = CBZ.spectator.state(), c = CBZ.camera.position, b = CBZ.player.pos;
      const D = CBZ.disasters;
      W.rows.push({ t: +W.t().toFixed(2), ph: S.phase, cam: [c.x, c.y, c.z], body: [b.x, b.y, b.z], yaw: S.yaw, agl: S.aboveGround,
        floor: CBZ.surv.floorAt(b.x, b.z) });
      const d = D.state() + ":" + (D.currentId() || "-") + ":" + D.round();
      if (d !== lastDir) {
        lastDir = d;
        W.dir.push({ t: +W.t().toFixed(2), state: D.state(), id: D.currentId(), round: D.round(), dead: !!CBZ.player.dead, scale: D.scale() });
        W.event("director", d);
      }
      const sc = D.scale();
      if (sc && W.dir.length && !W.dir[W.dir.length - 1].scale) W.dir[W.dir.length - 1].scale = sc;
    });
    W.watch("cam", "phase", function () { return CBZ.spectator.phase(); });
  },
  script: function (W, P) {
    const keys = function () { return CBZ.keys || (CBZ.keys = {}); };
    const S = function () { return CBZ.spectator.state(); };
    const mark = function (k) { W.marks[k] = { t: +W.t().toFixed(2), s: S() }; };
    const hold = function (list, on) { list.forEach(function (k) { keys()[k] = on; }); };
    const pad = function () { return document.getElementById("specPad"); };
    let tid = 20;
    function touches(el, type, pts) {
      const list = pts.map(function (p) { return new Touch({ identifier: p.id, target: el, clientX: p.x, clientY: p.y }); });
      const ev = new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : list, targetTouches: type === "touchend" ? [] : list, changedTouches: list });
      el.dispatchEvent(ev);
    }
    const die = +P.die;
    const T = die + 6.5;   // the camera is yours by now (2.4 s orbit + 2.8 s pull)
    return [
      [0.5, function () { W.hudAlive = CBZ.survHud.read(); }, "read the HUD alive"],
      // running for it when it hits: the held W + Shift must not cut the death short
      [die - 0.6, function () { hold(["w", "shift"], true); }, "sprinting"],
      [die + 1.8, function () { hold(["w", "shift"], false); }, "let go of the keys"],
      [die, function () { CBZ.surv.hurt(CBZ.surv.playerActor, 1e6, { cause: "crushed under falling masonry" }); }, "the player dies"],
      [die + 1.0, function () { W.hudEarly = CBZ.survHud.read(); }, "HUD 1 s after"],
      [die + 2.2, function () { W.hudGhost = CBZ.survHud.read(); W.actorsAfter = CBZ.surv.actors().filter(function (a) { return a.isPlayer; }).length; }, "HUD 2.2 s after"],
      // desktop: fly forward, up, down
      [T, function () { mark("w0"); hold(["w"], true); }, "hold W"],
      [T + 1.5, function () { hold(["w"], false); mark("w1"); }, "release W"],
      [T + 2.0, function () { mark("up0"); hold([" "], true); }, "hold Space"],
      [T + 3.0, function () { hold([" "], false); mark("up1"); }, "release Space"],
      [T + 3.4, function () { mark("dn0"); hold(["shift"], true); }, "hold Shift"],
      [T + 4.4, function () { hold(["shift"], false); mark("dn1"); }, "release Shift"],
      // mouse drag look (a headless page has no pointer lock: the drag path)
      [T + 5.0, function () {
        mark("look0");
        CBZ.canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 300, clientY: 200 }));
        for (let i = 0; i < 10; i++) window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, movementX: 20, movementY: 0 }));
        window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      }, "mouse drag 200 px right"],
      [T + 5.2, function () { mark("look1"); }, ""],
      [T + 5.4, function () { mark("wheel0"); CBZ.canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -400 })); }, "wheel forward"],
      [T + 6.4, function () { mark("wheel1"); }, ""],
      // the floor clamp: dive and back up for six seconds
      [T + 6.6, function () { W.dive0 = W.rows.length; hold(["shift", "s"], true); }, "dive (Shift + S) for 6 s"],
      [T + 12.6, function () { hold(["shift", "s"], false); W.dive1 = W.rows.length; }, "stop diving"],
      // touch: one-finger look
      [T + 13.0, function () {
        CBZ.touchMode = true; document.body.classList.add("touch");
        mark("t1a");
        const el = pad(); const id = ++tid;
        touches(el, "touchstart", [{ id: id, x: 200, y: 300 }]);
        for (let i = 1; i <= 8; i++) touches(el, "touchmove", [{ id: id, x: 200 - i * 15, y: 300 }]);
        touches(el, "touchend", [{ id: id, x: 80, y: 300 }]);
      }, "touch: one finger drags 120 px left"],
      [T + 13.6, function () { mark("t1b"); }, ""],
      // touch: pinch out (two fingers apart) = dolly forward
      [T + 14.0, function () {
        mark("pinch0");
        const el = pad(); const a = ++tid, b = ++tid;
        touches(el, "touchstart", [{ id: a, x: 300, y: 300 }, { id: b, x: 340, y: 300 }]);
        for (let i = 1; i <= 8; i++) touches(el, "touchmove", [{ id: a, x: 300 - i * 12, y: 300 }, { id: b, x: 340 + i * 12, y: 300 }]);
        touches(el, "touchend", [{ id: a, x: 204, y: 300 }, { id: b, x: 436, y: 300 }]);
      }, "touch: pinch out 190 px"],
      [T + 15.0, function () { mark("pinch1"); }, ""],
      // touch: two-finger pan
      [T + 15.2, function () {
        mark("pan0");
        const el = pad(); const a = ++tid, b = ++tid;
        touches(el, "touchstart", [{ id: a, x: 300, y: 300 }, { id: b, x: 360, y: 300 }]);
        for (let i = 1; i <= 8; i++) touches(el, "touchmove", [{ id: a, x: 300 + i * 15, y: 300 }, { id: b, x: 360 + i * 15, y: 300 }]);
        touches(el, "touchend", [{ id: a, x: 420, y: 300 }, { id: b, x: 480, y: 300 }]);
      }, "touch: two fingers pan 120 px"],
      [T + 15.4, function () { mark("pan1"); }, ""],
      // touch: the up button
      [T + 15.6, function () { mark("ub0"); const u = document.getElementById("specUp"); W.upId = ++tid; touches(u, "touchstart", [{ id: W.upId, x: 600, y: 200 }]); }, "touch: hold UP"],
      [T + 16.6, function () { const u = document.getElementById("specUp"); touches(u, "touchend", [{ id: W.upId, x: 600, y: 200 }]); mark("ub1"); }, "release UP"],
      // a second disaster while you are dead
      [T + 17, function () { W.forced2 = CBZ.disasters.force(P.second); }, "force the second disaster"],
      [T + 30, function () { W.hudLate = CBZ.survHud.read(); }, "HUD late"],
      [T + 31, function () { CBZ.surv.playAgain(); }, "PLAY AGAIN"],
      [T + 31.5, function () { W.after = { phase: CBZ.spectator.phase(), dead: !!CBZ.player.dead, hp: CBZ.player.hp, spectating: !!CBZ.surv.spectating, round: CBZ.disasters.round() }; }, "after play again"],
    ];
  },
  probe: function (W, P) {
    const R = function (v) { return Math.round(v * 100) / 100; };
    const die = W.die, M = W.marks;
    const d3 = function (a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
    const fails = [];
    // ---- the beat
    const beat = W.rows.filter(function (r) { return r.t > die + 0.05 && r.t <= die + 2.3; });
    let bodyPeak = 0, camNear = 99, camFar = 0;
    beat.forEach(function (r) { bodyPeak = Math.max(bodyPeak, r.body[1] - r.floor); const d = d3(r.cam, r.body); camNear = Math.min(camNear, d); camFar = Math.max(camFar, d); });
    const onBody = beat.filter(function (r) { return r.ph === "death"; }).length / Math.max(1, beat.length);
    if (onBody < 0.95) fails.push("death beat not on the body (" + R(onBody) + ")");
    if (bodyPeak < 0.4) fails.push("no ragdoll flight (peak " + R(bodyPeak) + " m)");
    if (camFar > 14) fails.push("death camera wandered " + R(camFar) + " m off the body");
    if (W.hudEarly && W.hudEarly.ghost) fails.push("ghost panel landed on the death beat");
    // ---- the pull
    const order = [];
    W.rows.forEach(function (r) { if (r.ph && order[order.length - 1] !== r.ph) order.push(r.ph); });
    const firstFree = W.rows.find(function (r) { return r.ph === "free"; });
    let maxJump = 0;
    for (let i = 1; i < W.rows.length; i++) {
      const a = W.rows[i - 1], b = W.rows[i];
      if (!a.ph || !b.ph || b.ph === "free") continue;   // free flight moves on purpose
      maxJump = Math.max(maxJump, d3(a.cam, b.cam));
    }
    const wide = firstFree ? { t: firstFree.t, up: R(firstFree.cam[1] - firstFree.body[1]), away: R(Math.hypot(firstFree.cam[0] - firstFree.body[0], firstFree.cam[2] - firstFree.body[2])) } : null;
    if (order.slice(0, 3).join(">") !== "death>pull>free") fails.push("phases " + order.join(">"));
    if (!wide || wide.up < 10 || wide.away < 12) fails.push("pull did not end high and wide " + JSON.stringify(wide));
    if (maxJump > 1.5) fails.push("camera jumped " + R(maxJump) + " m in a frame");
    // ---- flying
    const mv = function (a, b) { return M[a] && M[b] ? R(d3(M[a].s.pos, M[b].s.pos)) : 0; };
    const dy = function (a, b) { return M[a] && M[b] ? R(M[b].s.pos[1] - M[a].s.pos[1]) : 0; };
    const fly = {
      W: mv("w0", "w1"), spaceUp: dy("up0", "up1"), shiftDown: dy("dn0", "dn1"),
      dragYaw: M.look0 && M.look1 ? R(M.look1.s.yaw - M.look0.s.yaw) : 0, wheel: mv("wheel0", "wheel1"),
      touchYaw: M.t1a && M.t1b ? R(M.t1b.s.yaw - M.t1a.s.yaw) : 0, pinch: mv("pinch0", "pinch1"), pan: mv("pan0", "pan1"),
      upButton: dy("ub0", "ub1"),
    };
    let minAgl = 99;
    for (let i = W.dive0 || 0; i < (W.dive1 || 0); i++) minAgl = Math.min(minAgl, W.rows[i].agl);
    fly.diveMinAboveGround = R(minAgl);
    if (fly.W < 4) fails.push("W moved " + fly.W + " m");
    if (fly.spaceUp < 2) fails.push("Space rose " + fly.spaceUp + " m");
    if (fly.shiftDown > -2) fails.push("Shift fell " + fly.shiftDown + " m");
    if (Math.abs(fly.dragYaw) < 0.2) fails.push("mouse drag turned " + fly.dragYaw);
    if (fly.wheel < 2) fails.push("wheel moved " + fly.wheel + " m");
    if (Math.abs(fly.touchYaw) < 0.2) fails.push("finger turned " + fly.touchYaw);
    if (fly.pinch < 2) fails.push("pinch moved " + fly.pinch + " m");
    if (fly.pan < 1) fails.push("pan moved " + fly.pan + " m");
    if (fly.upButton < 1.5) fails.push("up button rose " + fly.upButton + " m");
    if (minAgl < 1.3) fails.push("dove to " + R(minAgl) + " m above the ground (clamp 1.4)");
    // ---- the world keeps going
    const after = W.dir.filter(function (d) { return d.dead; });
    const warns = after.filter(function (d) { return d.state === "warn"; }).length;
    const actives = after.filter(function (d) { return d.state === "active"; }).length;
    const secondActive = after.some(function (d) { return d.id === P.second && d.state === "active"; });
    const roundAtDeath = after.length ? after[0].round : 0, roundLast = after.length ? after[after.length - 1].round : 0;
    // second=none: nothing is forced, the director must roll the next one itself
    if (P.second === "none" ? !(warns >= 1 && actives >= 1) : !secondActive) fails.push((P.second === "none" ? "the director rolled nothing" : P.second + " never went active") + " after the death");
    if (W.actorsAfter) fails.push("the dead player is still in the actor list");
    // ---- HUD
    if (!W.hudAlive || !W.hudAlive.hp) fails.push("no health bar while alive");
    if (!W.hudGhost || !W.hudGhost.ghost) fails.push("no ghost panel");
    if (!W.hudLate || !W.hudLate.stats) fails.push("clock gone while spectating");
    // ---- play again
    if (!W.after || W.after.dead || W.after.phase || W.after.spectating) fails.push("play again did not start a live round " + JSON.stringify(W.after));
    const uniq = Array.from(new Set(W.dir.filter(function (d) { return d.scale; }).map(function (d) { return d.id + " " + d.scale; })));
    return {
      ok: fails.length === 0,
      summary: (fails.length ? "FAIL: " + fails.join("; ") + " | " : "") +
        "beat: body up " + R(bodyPeak) + " m, cam " + R(camNear) + "-" + R(camFar) + " m off it | pull: " + order.join(">") +
        " ends " + (wide ? wide.up + " m up, " + wide.away + " m out at " + wide.t + " s" : "-") + ", max step " + R(maxJump) + " m | fly: " + JSON.stringify(fly) +
        " | after death: " + warns + " warns, " + actives + " actives, round " + roundAtDeath + "->" + roundLast +
        " | HUD alive: " + (W.hudAlive ? JSON.stringify([W.hudAlive.name, W.hudAlive.scale, W.hudAlive.when, W.hudAlive.time, W.hudAlive.round]) : "-") +
        " ghost: " + (W.hudGhost ? JSON.stringify([W.hudGhost.ghostLine, W.hudGhost.place, W.hudGhost.name]) : "-") +
        " | scales seen: " + uniq.join(", "),
      data: { fly: fly, wide: wide, order: order, dir: W.dir, hud: { alive: W.hudAlive, early: W.hudEarly, ghost: W.hudGhost, late: W.hudLate }, after: W.after, scales: uniq,
        path: W.rows.filter(function (r, i) { return i % 12 === 0; }).map(function (r) { return [r.t, r.ph, r.cam.map(R), r.body.map(R)]; }) },
    };
  },
});
