/* Prison Escape storyboard for tools/visual-compare.mjs.

   Boots the REAL escape mode (title screen → Prison Escape → Play), freezes
   the rAF loop, then walks a fixed shot list over the live compound with
   CBZ.stepSim(1/60) bursts. Both builds photograph the same seeded prison
   at the same simulated seconds.

   What the storyboard is FOR (owner complaints, 2026-08-02):
   - a city road runs through the jail (the compound shares the city's
     coordinate space near z≈0 and is registered nowhere) — the aerial and
     oblique establishing shots exist to catch it on both sides;
   - fake props (bunks/benches/tables that are pure boxes) and leftover
     loot chests — the interior shots;
   - vents at hard-coded arbitrary coordinates — the vent close-ups;
   - HUD narration ("summaries of events when the events should just
     happen") — the hud:true beats, which keep the HUD visible and measure
     hudTextChars: show-don't-tell is that number going DOWN while a real
     guard tackle / real punches carry the information instead;
   - only one gun showing in the inventory strip — the arsenal beat grants
     three weapons and photographs the strip.

   Staging facts: rAF stub after boot freezes core/loop.js (CBZ.stepSim
   becomes the only clock); the prison lives near the origin (CBZ.WORLD
   northYard x[-30,30] z[-8,52], southBlock x[-44,44] z[52,128], cell block
   just north of the yard around z≈-31); sky rig recenter before manual
   renders; the player is healed each tick so the storyboard cannot end on
   a death screen. */

const subjects = [
  { id: "compound-aerial", label: "The compound from above", hud: false,
    focus: "Top-down establishing shot. The owner's road-through-the-jail should be visible here on the before side and gone on the after side.",
    act: {},
    cam: { x: 0, y: 300, z: 61, ax: 0, ay: 0, az: 60 } },
  { id: "compound-oblique", label: "The compound and its surroundings", hud: false,
    focus: "Low oblique from outside the west wall: how the prison sits in the world — walls, towers, and whatever the city routed through it.",
    act: {},
    cam: { x: -170, y: 75, z: -70, ax: 0, ay: 6, az: 48 } },
  { id: "yard-life", label: "The north yard", hud: false,
    focus: "The exercise yard from a tower: guards on post, inmates, props. Every prop should be interactable or load-bearing — no garnish.",
    act: { secs: 4 },
    cam: { x: 27, y: 13, z: 47, ax: -6, ay: 1, az: 18 } },
  { id: "cellblock-aisle", label: "Cell block aisle", hud: false,
    focus: "Inside the block: cells, bunks, and the aisle vent. Bunks should read as usable furniture, not painted boxes; any leftover loot chest is a bug.",
    act: {},
    cam: { x: -6, y: 2.1, z: -31, ax: -16, ay: 0.9, az: -31 } },
  { id: "venue-door-closed", label: "STEP 1 · Housing-unit gate · closed", hud: false,
    focus: "Spawn-side view of the checkpoint between housing and the yard. The opening needs one coherent leaf, a structural frame, and wall-mounted access control.",
    act: { yardDoor: "closed", secs: 0.1 },
    cam: { x: 0.0, y: 2.85, z: -17.0, ax: 0, ay: 1.75, az: -8 } },
  { id: "venue-door-open", label: "STEP 1 · Housing-unit gate · open", hud: false,
    focus: "The same checkpoint after opening. Every leaf fitting must travel with the leaf; reader and jamb stay on the wall; the route stays clear.",
    act: { yardDoor: "open", secs: 1.2 },
    cam: { x: 0.0, y: 2.85, z: -17.0, ax: 0, ay: 1.75, az: -8 } },
  { id: "venue-armory-rack", label: "STEP 2 · Armory issue rack", hud: false,
    focus: "All issued weapons should be bare display models, physically supported by their rack, readable through the excellent armory gate.",
    act: {},
    cam: { x: 20.3, y: 2.25, z: 1.0, ax: 27.2, ay: 1.8, az: 1.0 } },
  { id: "venue-armory-rack-detail", label: "STEP 2 · Armory rack · seating detail", hud: false,
    focus: "Close inspection of hands, intersections, shelf contact, muzzle direction, and individual retention hardware.",
    act: {},
    cam: { x: 24.1, y: 2.1, z: 0.8, ax: 27.3, ay: 1.75, az: 0.8 } },
  { id: "venue-bunk-lower", label: "STEP 3 · Lower bunk · inmate asleep", hud: false,
    focus: "A real inmate placed by the shared bed solve. Head belongs on the pillow, body on the mattress, limbs inside the frame, and no standing overlap.",
    act: { poseBed: "lower" },
    cam: { x: -8.95, y: 1.58, z: -41.55, ax: -12.15, ay: 0.90, az: -41.55 } },
  { id: "venue-bunk-upper", label: "STEP 3 · Upper bunk · inmate asleep", hud: false,
    focus: "The same body on the upper rack. Mattress height, rail clearance, pillow alignment, and the lying pose must agree.",
    act: { poseBed: "upper" },
    cam: { x: -8.95, y: 2.72, z: -41.55, ax: -12.15, ay: 2.04, az: -41.55 } },
  { id: "venue-dayroom-seat", label: "STEP 3 · Dayroom table · inmate seated", hud: false,
    focus: "An inmate uses a bolted dayroom table: hips on the stool, feet on the floor, body facing the table, circulation lane still open.",
    act: { poseSeat: true },
    cam: { x: -2.3, y: 1.85, z: -21.9, ax: -6.6, ay: 0.76, az: -26.0 } },
  { id: "venue-housing-overflow", label: "STEP 3 · Housing and dayroom zoning", hud: false,
    focus: "Sleep space must be inside housing, not loose bedding scattered through the dayroom or the route to the yard gate.",
    act: { secs: 0.1 },
    cam: { x: 0, y: 5.4, z: -11.2, ax: 0, ay: 0.65, az: -28.0 } },
  { id: "venue-south-dorm", label: "STEP 3 · Overflow housing unit", hud: false,
    focus: "The exact sixteen-bed shortfall becomes a controlled dorm: observable entrance, clear aisle, real double bunks, sanitation, and usable day furniture.",
    act: {},
    cam: { x: -33, y: 2.45, z: 107.3, ax: -33, ay: 1.25, az: 120.4 } },
  { id: "vent-mess", label: "The mess-hall vent (outside)", hud: false,
    focus: "The old cafeteria grate sat proud of an exterior wall at a hard-coded coordinate. After: nothing arbitrary on this wall.",
    act: {},
    cam: { x: -13.2, y: 1.7, z: 8.5, ax: -19, ay: 0.8, az: 8.5 } },
  { id: "vent-mess-inside", label: "The mess-hall vent (inside)", hud: false,
    focus: "From inside the mess: the rebuilt grate is flush in the masonry, correctly faced, a two-grate junction — a duct network that belongs to the building.",
    act: {},
    cam: { x: -24, y: 1.6, z: 12, ax: -24, ay: 0.9, az: 4 } },
  { id: "vent-armory", label: "The armory duct", hud: false,
    focus: "Three of the four old grates deposited you OUTSIDE the room they named — the armory exit landed at x=17.4 with the armory wall at 19. After: the crawl point is inside the room.",
    act: {},
    cam: { x: 21, y: 1.4, z: -3, ax: 17, ay: 0.9, az: -4.5 } },
  { id: "south-block", label: "South block", hud: false,
    focus: "The wider lower complex — workshops, chapel, infirmary, the freedom gate. Scene quality check.",
    act: {},
    cam: { x: 0, y: 32, z: 158, ax: 0, ay: 3, az: 92 } },
  { id: "venue-south-apron", label: "STEP 4 · Program yard and sally port", hud: false,
    focus: "Ground-level combined scene: rooms have program, circulation has sightlines, service objects live at service rooms, and the sally port reads as transport security.",
    act: {},
    cam: { x: 11, y: 8.2, z: 116, ax: -2, ay: 1.2, az: 80 } },
  { id: "hud-idle", label: "The screen, just playing", hud: true,
    focus: "Six sim-seconds of ordinary play with the HUD up. Before: hints/objective prose narrating the mode at you. After: game state only.",
    act: { secs: 6 },
    cam: { player: true, back: 8, up: 3 } },
  { id: "hud-arsenal", label: "Carrying three weapons", hud: true,
    focus: "Sidearm + shotgun + AK granted. Gang city shows a boxed icon inventory; jail used to show a single text chip. One shared strip should now show all three.",
    act: { arm: ["sidearm", "shotgun", "ak47"], secs: 1 },
    cam: { player: true, back: 8, up: 3 } },
  { id: "inmate-punch", label: "Getting jumped — the punch", hud: true,
    focus: "An inmate hunting the player. Before: a toast SAYS 'x is jumping you'. After: he squares up and a real punch lands — health drops, head snaps, no words. The frame is shot the moment hp first falls.",
    act: { jump: true, untilHpDrop: true, budget: 6 },
    cam: { player: true, back: 6, up: 2.2 } },
  { id: "inmate-grab", label: "Getting jumped — the grab", hud: true,
    focus: "Two seconds later: the third blow is a grab (predator seize, drag style). The beating is the message.",
    act: { secs: 2.1, holdJumper: true },
    cam: { player: true, back: 6, up: 2.2 } },
  { id: "guard-tackle", label: "Getting caught", hud: true,
    focus: "A hunting guard reaches the player. Before: a teleport, a red flash, and a toast SAYING you were caught. After: a physical pin with one timed BREAK FREE press. The frame is shot the moment capture state changes.",
    act: { deliver: true, untilCapture: true, budget: 9 },
    cam: { player: true, back: 7, up: 2.6 } },
];

async function stageJail(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__jailOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };
  const hudTextChars = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    let chars = 0;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__jailOverlay") continue;
      if (getComputedStyle(child).display === "none") continue;
      chars += (child.innerText || "").replace(/\s+/g, "").length;
    }
    return chars;
  };

  let S = window.__jailSeq;
  if (!S) {
    // ---- one-time: boot the real game into escape mode ------------------
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="escape"]'),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="escape"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    // Freeze the rAF loop; CBZ.stepSim is the only clock from here.
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__jailOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__jailSeq = { overlay };
    window.__cbzVisualCompare = {
      render() {
        try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
      },
    };
  }

  const subject = input.subject;
  const act = subject.act || {};
  let ticks = 0, totalMs = 0, maxMs = 0, over33 = 0;
  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      const t0 = performance.now();
      CBZ.stepSim(1 / 60);
      const ms = performance.now() - t0;
      ticks++; totalMs += ms;
      if (ms > maxMs) maxMs = ms;
      if (ms > 33) over33++;
      if (CBZ.player) { CBZ.player.hp = Math.max(CBZ.player.hp || 100, 60); CBZ.player.dead = false; }
    }
  };

  if (act.yardDoor === "closed" && typeof CBZ.closeDoor === "function") {
    try { CBZ.closeDoor(); } catch (_) {}
  } else if (act.yardDoor === "open" && typeof CBZ.openDoor === "function") {
    try { CBZ.openDoor(); } catch (_) {}
  }
  // Restore any near-lens actors hidden for the previous doorway frame.
  for (const group of S.doorHiddenActors || []) if (group) group.visible = true;
  S.doorHiddenActors = [];
  // Move the live player off the doorway proof axis. The report camera is a
  // detached inspection view, not the game camera, so its own actor should
  // not masquerade as part of the hardware.
  if (act.yardDoor && CBZ.player && CBZ.player.pos) {
    CBZ.player.pos.set(8.0, 0, -14.5);
    if (CBZ.playerChar && CBZ.playerChar.group) {
      CBZ.playerChar.group.position.copy(CBZ.player.pos);
      // A detached inspection camera should not render the local player's
      // third-person rig through its near plane. The next non-door subject
      // restores it, so this affects the proof frame only.
      CBZ.playerChar.group.visible = false;
    }
  } else if (CBZ.playerChar && CBZ.playerChar.group) {
    CBZ.playerChar.group.visible = true;
  }
  if (act.yardDoor && CBZ.guards) {
    // The indoor patrol starts at the proof camera itself. Stage the same
    // ordinary patrol beat on both builds with him beside, not inside, the lens.
    const sentry = CBZ.guards.find((g) => g && g.group && Math.abs(g.start && g.start.x || 0) < 0.2 &&
      Math.abs((g.start && g.start.z || 0) + 13) < 0.2);
    if (sentry) {
      sentry.group.position.set(5.2, 0, -14.5);
      sentry.target && sentry.target.set && sentry.target.set(5.2, 0, -14.5);
      sentry.pause = Math.max(sentry.pause || 0, 5);
      if (sentry.waypoints && sentry.waypoints[0]) sentry.wi = 0;
    }
  }
  if (act.yardDoor) {
    // The proof camera is detached from gameplay. Keep any unrelated body
    // whose origin is within the camera's near-lens bubble out of this one
    // inspection frame; yard actors farther through the gate remain visible.
    const actors = [
      ...(CBZ.guards || []).map((actor) => actor && actor.group),
      ...(CBZ.npcs || []).map((actor) => actor && actor.group),
    ];
    for (const group of actors) {
      if (!group || !group.position || group === (CBZ.playerChar && CBZ.playerChar.group)) continue;
      if (Math.hypot(group.position.x - subject.cam.x, group.position.z - subject.cam.z) < 8.5) {
        group.visible = false;
        S.doorHiddenActors.push(group);
      }
    }
  }

  if (act.arm && typeof CBZ.unlockWeapon === "function") {
    for (const id of act.arm) { try { CBZ.unlockWeapon(id, { select: true }); } catch (_) {} }
  }
  if (act.deliver) {
    // hand the player to the nearest living guard, hunting: capture commits
    // on contact (<=1.4m while gd.hunt > 0), the third contact is the seize
    const guards = (CBZ.guards || []).filter((g) => g && !g.dead && g.group && g.group.position);
    if (guards.length && CBZ.player && CBZ.player.pos) {
      const p = CBZ.player.pos;
      let best = guards[0], bestD = Infinity;
      for (const g of guards) {
        const d = Math.hypot(g.group.position.x - p.x, g.group.position.z - p.z);
        if (d < bestD) { bestD = d; best = g; }
      }
      const gp = best.group.position;
      p.set(gp.x + 1.0, gp.y, gp.z + 0.4);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(p);
      best.hunt = 12;
      window.__jailSeq.mark = best;
      if (CBZ.game) CBZ.game.detection = 1;
    }
  }
  if (act.jump) {
    // sic the nearest living inmate on the player ("x is jumping you")
    const pool = (CBZ.npcs || []).filter((n) => n && !n.dead && n.group && n.group.position);
    if (pool.length && CBZ.player && CBZ.player.pos) {
      const p = CBZ.player.pos;
      let best = pool[0], bestD = Infinity;
      for (const n of pool) {
        const d = Math.hypot(n.group.position.x - p.x, n.group.position.z - p.z);
        if (d < bestD) { bestD = d; best = n; }
      }
      const np = best.group.position;
      p.set(np.x + 1.5, np.y, np.z);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(p);
      best.huntPlayer = 12;
      window.__jailSeq.jumper = best;
    }
  } else if (window.__jailSeq && window.__jailSeq.jumper) {
    window.__jailSeq.jumper.huntPlayer = 12; // keep the assault alive across beats
  }
  // event-shot beats: hold the two actors in contact range and stop stepping
  // the instant the event lands, so the frame IS the event — a punch mid-hp
  // drop, a pin mid-capture — instead of a timer's guess at it.
  const holdNear = (actor) => {
    if (!actor || !actor.group || !CBZ.player) return;
    const p = CBZ.player.pos, ap = actor.group.position;
    const d = Math.hypot(ap.x - p.x, ap.z - p.z);
    if (d > 1.3) p.set(ap.x + (p.x - ap.x) / d * 1.1, ap.y, ap.z + (p.z - ap.z) / d * 1.1);
  };
  if (act.untilHpDrop || act.untilCapture) {
    const budget = Math.round((act.budget || 6) * 10);
    const hp0 = CBZ.player ? CBZ.player.hp : 100;
    for (let i = 0; i < budget; i++) {
      holdNear(act.untilCapture ? (window.__jailSeq.mark || null) : window.__jailSeq.jumper);
      step(0.1);
      if (act.untilHpDrop && CBZ.player && CBZ.player.hp < hp0 - 1) break;
      if (act.untilCapture && CBZ.player &&
        (CBZ.player.captureState !== "normal" || CBZ.playerChar && CBZ.playerChar.cuffed)) break;
    }
  }
  if (act.secs) step(act.secs);
  // Character LOD can legitimately re-enable a hidden near-lens rig during
  // the open-door simulation beat. Re-apply the inspection mask only after
  // stepping; the yard beyond the gate is untouched.
  if (act.yardDoor) for (const group of S.doorHiddenActors || []) if (group) group.visible = false;
  if (act.holdJumper && window.__jailSeq.jumper) holdNear(window.__jailSeq.jumper);

  // Furniture proof beats use the real registered anchors and the real shared
  // pose solver. They commit instantly only so the screenshot is the settled
  // contact state rather than a timer's guess at the middle of an arc.
  const visualActor = () => {
    if (S.poseActor && S.poseActor.group && !S.poseActor.dead) return S.poseActor;
    const resident = CBZ.cellblock && CBZ.cellblock.cells &&
      CBZ.cellblock.cells.map((c) => c && c.owner).find((n) => n && n !== "player" && n.group && n.char && !n.dead);
    const pool = (CBZ.npcs || []).filter((n) => n && !n._crowd && n.role === "inmate" && n.group && n.char && !n.dead);
    S.poseActor = resident || pool[0] || null;
    return S.poseActor;
  };
  const releaseVisualActor = (actor) => {
    if (!actor) return;
    try { if (CBZ.propWake) CBZ.propWake(actor, { instant: true }); } catch (_) {}
    try { if (CBZ.propStand) CBZ.propStand(actor, { instant: true }); } catch (_) {}
    if (actor._restRate != null) { actor.speed = actor._restRate; actor._restRate = null; }
  };
  const settleRig = (actor, n) => {
    if (!actor || !actor.char || !CBZ.animChar) return;
    for (let i = 0; i < (n || 90); i++) CBZ.animChar(actor.char, 0, 1 / 60);
  };
  if (act.poseBed) {
    try { if (CBZ.rest && CBZ.rest.ready) CBZ.rest.ready(); } catch (_) {}
    const actor = visualActor();
    const cell = CBZ.cellblock && CBZ.cellblock.playerCell;
    const bed = cell && (act.poseBed === "upper" ? cell.bedTop : cell.bed);
    if (actor && bed && CBZ.propSleep) {
      releaseVisualActor(actor);
      if (bed.occupant && bed.occupant !== actor && CBZ.propWake) {
        try { CBZ.propWake(bed.occupant, { instant: true }); } catch (_) {}
      }
      const entry = CBZ.propEntryPoint ? CBZ.propEntryPoint(bed) : null;
      if (entry && entry.ok) actor.group.position.set(entry.x, bed.y || 0, entry.z);
      if (actor.target) actor.target.copy(actor.group.position);
      CBZ.propSleep(actor, bed, { instant: true });
      const lie = CBZ.propLiePlace ? CBZ.propLiePlace(actor, bed, {}) : null;
      if (lie) actor.group.position.set(lie.x, lie.y, lie.z);
      actor.group.rotation.y = bed.face || 0;
      actor.group.rotation.z = Math.PI / 2;
      settleRig(actor, 120);
      S.poseBed = bed;
    }
  }
  if (act.poseSeat) {
    try { if (CBZ.rest && CBZ.rest.ready) CBZ.rest.ready(); } catch (_) {}
    const actor = visualActor();
    let seat = null;
    try { seat = CBZ.propNearestSeat && CBZ.propNearestSeat(-7.45, -25.15, 4, 0); } catch (_) {}
    if (!seat && CBZ.propSeats) seat = CBZ.propSeats.find((s) => s && s.x < -4 && s.z < -22 && s.z > -29) || null;
    if (actor && seat && CBZ.propSit) {
      releaseVisualActor(actor);
      if (seat.occupant && seat.occupant !== actor && CBZ.propStand) {
        try { CBZ.propStand(seat.occupant, { instant: true }); } catch (_) {}
      }
      CBZ.propSit(actor, seat, { instant: true });
      actor.group.position.set(seat.x, seat.y || 0, seat.z);
      actor.group.rotation.y = seat.face || 0;
      settleRig(actor, 120);
      S.poseSeat = seat;
    }
  }

  // ---- measure HUD pressure with the HUD as the game left it ------------
  setHud(true);
  void document.documentElement.offsetHeight;
  const hudChars = hudTextChars();

  // ---- frame and render -------------------------------------------------
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55;
  camera.near = 0.3;
  camera.far = 20000;
  const cam = subject.cam || {};
  // Every fixed venue frame uses a detached inspection camera. Do not let the
  // local avatar's third-person rig intersect that lens; player-follow combat
  // and HUD beats opt back in through cam.player.
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = !!cam.player;
  if (cam.player && CBZ.player && CBZ.player.pos) {
    const p = CBZ.player.pos;
    camera.position.set(p.x, p.y + (cam.up || 3), p.z + (cam.back || 8));
    camera.lookAt(p.x, p.y + 1.1, p.z - 5);
  } else {
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(cam.ax, cam.ay, cam.az);
  }
  camera.updateProjectionMatrix();
  // core/sky.js's own seam (rig + palette + sun placement), with the historic
  // y=0 follow as the degrade path for a build that predates it.
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
  }
  if (!subject.hud) setHud(false);
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = subject.label;
  query("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:340px";
  query("focus").textContent = `mode ${CBZ.game.mode} · weapons ${(CBZ.weaponInventory || []).length}`;
  query("focus").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font-size:12px;font-weight:550";
  query("perf").textContent = ticks
    ? `sim ${ticks} ticks · avg ${(totalMs / ticks).toFixed(1)}ms · HUD ${hudChars} chars`
    : `HUD ${hudChars} chars`;
  query("perf").style.cssText = `position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:${maxMs > 100 ? "#ff9c9c" : "#9fe8c3"}`;
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {
    hudTextChars: hudChars,
    weaponsHeld: (CBZ.weaponInventory || []).length,
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
    drawCalls: Number(render.calls || 0),
  };
  try {
    if (typeof CBZ.prisonRestAudit === "function") {
      const rest = CBZ.prisonRestAudit();
      metrics.beds = Number(rest.beds || 0);
      metrics.floorMats = Number(rest.mats || 0);
      metrics.bunkStanders = Number(rest.bunkStanders || 0);
      metrics.sleepGap = Number(rest.sleepGap || 0);
    }
  } catch (_) {}
  try {
    if (typeof CBZ.jailShowAudit === "function") {
      const audit = CBZ.jailShowAudit();
      for (const key of Object.keys(audit || {})) {
        if (Number.isFinite(Number(audit[key]))) metrics[`audit_${key}`] = Number(audit[key]);
      }
    }
  } catch (_) {}

  // Kept in the report metadata for doorway regressions: a centreline ray is
  // enough to identify any mesh that visually hangs in the clear opening.
  let doorwayProbe = null;
  if (subject.id === "venue-door-open" || subject.id === "venue-door-closed") {
    try {
      const ray = new T.Raycaster();
      ray.setFromCamera(new T.Vector2(0, 0.12), camera);
      doorwayProbe = ray.intersectObjects(CBZ.scene.children, true).slice(0, 12).map((hit) => {
        const o = hit.object, p = new T.Vector3();
        o.getWorldPosition(p);
        const g = o.geometry && o.geometry.parameters || {};
        const chain = [];
        for (let q = o; q && chain.length < 5; q = q.parent) chain.push(q.name || q.type || "Object3D");
        return {
          distance: Number(hit.distance.toFixed(2)),
          x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)), z: Number(p.z.toFixed(2)),
          w: g.width == null ? null : Number(g.width),
          h: g.height == null ? null : Number(g.height),
          d: g.depth == null ? null : Number(g.depth),
          color: o.material && o.material.color ? o.material.color.getHexString() : null,
          chain: chain.join(" > "),
        };
      });
    } catch (_) {}
  }

  return {
    ok: true,
    captureState: CBZ.player ? CBZ.player.captureState || null : null,
    poseDebug: S.poseActor && S.poseActor.group ? {
      actor: S.poseActor.data && S.poseActor.data.name || S.poseActor.role || "inmate",
      x: Number(S.poseActor.group.position.x.toFixed(2)),
      y: Number(S.poseActor.group.position.y.toFixed(2)),
      z: Number(S.poseActor.group.position.z.toFixed(2)),
      roll: Number(S.poseActor.group.rotation.z.toFixed(2)),
      bed: !!S.poseActor._propBed,
      lie: !!S.poseActor._propLie,
      sitting: !!(S.poseActor.char && S.poseActor.char.sitting),
      lying: !!(S.poseActor.char && S.poseActor.char.lying),
      bedTop: S.poseBed ? Number(S.poseBed.top || 0) : null,
    } : null,
    doorwayProbe,
    metrics,
  };
}

export default {
  id: "jail-scene",
  title: "Prison Escape Venue: Improvement Steps",
  description: "The same seeded prison photographed on the deployed and local builds. Numbered pages move from the housing gate to the armory display, furniture contact and housing zoning, then the combined program yard and sally port.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "Furniture pages report authored beds, loose floor mats, sleepers left standing in bunks, and any live inmate-to-bed shortfall. Combat/HUD pages retain the existing HUD and inventory gauges.",
  metrics: {
    hudTextChars: { label: "HUD text", unit: "chars", better: "lower" },
    weaponsHeld: { label: "Weapons held" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
    beds: { label: "Authored beds" },
    floorMats: { label: "Dayroom floor mats", better: "lower" },
    bunkStanders: { label: "Bodies standing in bunks", better: "lower" },
    sleepGap: { label: "Inmates without beds", better: "lower" },
  },
  subjects,
  stage: stageJail,
};
