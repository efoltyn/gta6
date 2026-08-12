/* President-mode storyboard for tools/visual-compare.mjs.

   This is deliberately a live-world preset, not a model studio. It selects
   The President on the real title screen, boots the same seeded Gang City on
   both sides, finds the Executive Mansion through CBZ.govComplexes, and then
   photographs the compound from eleven fixed, player-readable viewpoints.

   The exterior, entrance hall, locked Situation Room, and both West Wing
   floors are one sequence because that is the actual mode loop: arrive as a
   head of state, cross a residence that has a clear program, then reach props
   that perform presidential verbs. `referenceStage.camera` carries the exact
   deployed tripod into the local capture; the two repaired Situation Room
   views declare their subject-relative frame translation in report metadata. */

const subjects = [
  {
    id: "ceremonial-approach",
    label: "Arrival at the Executive Mansion",
    focus: "From the motor court, the building must read as the unique seat of national power before a label explains it: hierarchy, guarded threshold, state symbols, and a deliberate arrival axis.",
    cam: { x: 0, y: 5.8, z: 78, ax: 0, ay: 6.8, az: -34 },
    player: { x: 0, y: 0.08, z: 20 },
  },
  {
    id: "compound-aerial",
    label: "The Presidential Compound",
    focus: "The whole residence/workplace from above. Mansion, West Wing, gatehouse, motor court, helipad, gardens, and security should form one legible compound rather than unrelated props on a lawn.",
    cam: { x: 0, y: 188, z: 88, ax: 0, ay: 0, az: -4 },
    player: { x: 0, y: 0.08, z: 18 },
  },
  {
    id: "mansion-three-quarter",
    label: "A Seat of State, Not a Generic Mansion",
    focus: "Three-quarter silhouette check: portico, roofline, wings, state seal, windows, and occupied grounds need to survive without the floating motto doing all the identity work.",
    cam: { x: 62, y: 17, z: 27, ax: 0, ay: 6.2, az: -34 },
    player: { x: 0, y: 0.08, z: 10 },
  },
  {
    id: "entrance-hall",
    label: "The Entrance Hall",
    focus: "The first interior view. It should be a composed state arrival room with a clear route to work, not an office-furniture scatter colliding with the Situation Room shell.",
    cam: { x: -4, y: 1.85, z: -20.5, ax: 6, ay: 1.15, az: -43.5 },
    player: { x: -2, y: 0.08, z: -23 },
    interior: true,
  },
  {
    id: "state-residence",
    label: "State Residence — Dining Room",
    focus: "The private floor begins with a recognizable state dining room and an authored portal onward—not a table, bed, and sofa floating together in one giant plate.",
    cam: { x: -13, y: 4.85, z: -41.5, ax: -3.0, ay: 4.05, az: -34.2 },
    player: { x: -11, y: 3.28, z: -40.5 },
    interior: true,
  },
  {
    id: "private-suite",
    label: "State Residence — Private Suite",
    focus: "The inner residence must change scale and purpose: a family salon, staggered private threshold, and a real bed with a lie interaction instead of one undifferentiated upper floor.",
    cam: { x: -10.8, y: 4.75, z: -29.8, ax: 0, ay: 4.0, az: -21.0 },
    player: { x: -9.6, y: 3.28, z: -29.0 },
    interior: true,
  },
  {
    id: "situation-door",
    label: "The Restricted Threshold",
    focus: "The locked room must advertise a meaningful gradient: presidential seal, access hardware, sightline into a working room, and a door whose physical state agrees with its interaction.",
    beforeCam: { x: -8, y: 1.78, z: -41, ax: -15.3, ay: 1.35, az: -41 },
    cam: { x: 7.5, y: 1.78, z: -41, ax: 14.8, ay: 1.35, az: -41 },
    player: { x: 8.5, y: 0.08, z: -41 },
    interior: true,
    cameraRevision: "command-suite-v2",
  },
  {
    id: "situation-room",
    label: "The Situation Room",
    focus: "THE COMMAND VIEW. Every object needs a job: a readable national-status surface, decision stations, usable seats, real communications, and enough circulation to reach every order without climbing a table.",
    beforeCam: { x: -22.4, y: 2.02, z: -44.2, ax: -17.4, ay: 1.02, az: -40.2 },
    cam: { x: 15.1, y: 2.02, z: -44.2, ax: 20.1, ay: 1.02, az: -40.2 },
    player: { x: 16, y: 0.08, z: -43.8 },
    interior: true,
    cameraRevision: "command-suite-v2",
  },
  {
    id: "west-wing-ground",
    label: "West Wing — Working Floor",
    focus: "A staff-facing work floor should have an intentional reception, secure circulation, and recognizable operational zones. Repeated desk props are not a room program.",
    cam: { x: -43.5, y: 1.85, z: -26, ax: -68, ay: 1.08, az: -30 },
    player: { x: -48, y: 0.08, z: -28 },
    interior: true,
  },
  {
    id: "cabinet-room",
    label: "West Wing — Cabinet Room",
    focus: "Past reception, the working floor needs a real clearance threshold, staffed duty position, cabinet table, live briefing surfaces, and a physical intelligence order—not repeated desks hidden behind a wall.",
    cam: { x: -58.5, y: 1.92, z: -34, ax: -66.0, ay: 1.08, az: -30 },
    player: { x: -58, y: 0.08, z: -34 },
    interior: true,
  },
  {
    id: "oval-office",
    label: "West Wing — The President's Office",
    focus: "The personal office must read instantly as the destination: a presidential desk relationship, visitor seating, flags, secure phone, documents, and clear approach space—not a generic boss-office roll.",
    cam: { x: -57, y: 4.70, z: -30, ax: -46.8, ay: 4.05, az: -30 },
    player: { x: -56, y: 3.28, z: -30 },
    interior: true,
  },
];

async function stagePresident(input) {
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
  const tick = (n) => {
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0;
      CBZ.slowmo = 0;
      CBZ.stepSim(1 / 60);
      if (CBZ.player) {
        CBZ.player.hp = Math.max(CBZ.player.hp || 100, 90);
        CBZ.player.dead = false;
      }
    }
  };
  const mansion = () => {
    const list = CBZ.govComplexes || [];
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].id === "execmansion" && list[i].rect) return list[i];
    return null;
  };
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__presidentOverlay") continue;
      child.style.visibility = "hidden";
    }
  };
  const syncSky = () => {
    if (typeof CBZ.skySync === "function") { try { CBZ.skySync(); return; } catch (_) {} }
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(CBZ.camera.position.x, 0, CBZ.camera.position.z);
  };

  let seq = window.__presidentVisual;
  if (!seq) {
    const titleReady = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-origin="president"]'),
      300000
    );
    if (!titleReady) return { ok: false, err: "President title card never became ready" };

    const presidentCard = document.querySelector('[data-origin="president"]');
    if (CBZ.game.state !== "playing" && presidentCard) presidentCard.click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "President run never reached playing" };

    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    await wait(700);
    const siteReady = await until(() => !!mansion() && CBZ.presidency, 180000, 250);
    if (!siteReady) return { ok: false, err: "Executive Mansion never built" };
    try { if (CBZ.presidency && CBZ.presidency._buildRoom) CBZ.presidency._buildRoom(); } catch (_) {}

    // After the world has built, rAF is frozen and every later state change is
    // an explicit fixed-step burst. This keeps sun, staff, doors, and room
    // visibility at identical simulated ages on the two source pages. Keep one
    // bound native handle solely for the comparator's compositor barrier: it
    // cannot schedule the game loop because the global hook below stays frozen.
    const compositorFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function () { return 0; };
    // One core-loop callback can already be queued when the hook is replaced.
    // Let that callback run and fail to schedule its successor before any
    // subject camera is staged. Otherwise it can restore the player camera
    // between our explicit render and Page.captureScreenshot, producing a
    // stale-looking frame even though the recorded tripod is correct.
    await new Promise((resolve) => compositorFrame(() => compositorFrame(resolve)));
    tick(300);

    const overlay = document.createElement("div");
    overlay.id = "__presidentOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f7f3e8;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-source></div>";
    document.body.appendChild(overlay);
    seq = window.__presidentVisual = { overlay };
    window.__cbzVisualCompare = {
      render() {
        return new Promise((resolve) => {
          try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
          compositorFrame(() => {
            try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
            compositorFrame(() => resolve(true));
          });
        });
      },
    };
  }

  const subject = input.subject;
  const site = mansion();
  if (!site) return { ok: false, err: "Executive Mansion site disappeared" };

  // The storyboard coordinates are site-local. Convert once, then cache the
  // baseline's exact world tripod in stage metadata for the after side. The
  // `referenceStage.camera` is already expressed in the CURRENT room frame by
  // transformReferenceStage below when a repaired subject moved. Stage itself never
  // silently massages a reference camera: if the comparator carries a tripod,
  // these are the exact world coordinates that get photographed.
  const world = (p) => ({ x: site.cx + p.x, y: p.y, z: site.cz + p.z });
  const playerAt = world(subject.player || { x: 0, y: 0.08, z: 10 });
  if (CBZ.player && CBZ.player.pos) {
    CBZ.player.pos.set(playerAt.x, playerAt.y, playerAt.z);
    CBZ.player.vy = 0;
    CBZ.player.grounded = true;
    if (CBZ.playerChar && CBZ.playerChar.group) {
      CBZ.playerChar.group.position.copy(CBZ.player.pos);
      CBZ.playerChar.group.visible = true;
    }
  }
  tick(subject.interior ? 42 : 24);
  try { if (CBZ.presidency && CBZ.presidency._buildRoom) CBZ.presidency._buildRoom(); } catch (_) {}

  const fallbackCam = input.side === "before" && subject.beforeCam ? subject.beforeCam : subject.cam;
  const fallbackPos = world({ x: fallbackCam.x, y: fallbackCam.y, z: fallbackCam.z });
  const fallbackAim = world({ x: fallbackCam.ax, y: fallbackCam.ay, z: fallbackCam.az });
  const ref = input.referenceStage && input.referenceStage.camera;
  const refPos = ref && ref.position;
  const refAim = ref && ref.target;
  const pos = refPos || fallbackPos;
  const aim = refAim || fallbackAim;
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = subject.id === "compound-aerial" ? 48 : 58;
  camera.near = 0.05;
  camera.far = 5000;
  camera.position.set(pos.x, pos.y, pos.z);
  camera.lookAt(aim.x, aim.y, aim.z);
  camera.updateProjectionMatrix();
  syncSky();
  hideHud();
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;

  const audit = (CBZ.presidencyAudit && CBZ.presidencyAudit()) || {};
  const visual = audit.visual || {};
  const o = seq.overlay;
  const side = o.querySelector("[data-side]");
  const name = o.querySelector("[data-name]");
  const focus = o.querySelector("[data-focus]");
  const state = o.querySelector("[data-state]");
  const source = o.querySelector("[data-source]");
  side.textContent = input.side === "before" ? input.beforeLabel : input.afterLabel;
  side.style.cssText = "position:absolute;left:24px;top:20px;font-weight:900;font-size:13px;letter-spacing:.15em;color:" + (input.side === "before" ? "#ff8b83" : "#72e0ad");
  name.textContent = subject.label;
  name.style.cssText = "position:absolute;left:24px;top:44px;font-weight:850;font-size:25px;max-width:600px";
  focus.textContent = subject.focus;
  focus.style.cssText = "position:absolute;left:24px;top:79px;color:#d9e0e5;font-size:12px;line-height:1.42;max-width:540px";
  state.textContent = (visual.namedRooms || 0) + " NAMED ROOMS  ·  " +
    (visual.usableProps || audit.sitRoomButtons || 0) + " USABLE PROPS  ·  " +
    (visual.stateSymbols || 0) + " STATE SYMBOLS";
  state.style.cssText = "position:absolute;left:24px;bottom:40px;padding:8px 11px;background:rgba(8,12,17,.72);border:1px solid rgba(255,255,255,.2);border-radius:4px;font:800 11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.05em";
  source.textContent = new URL(input.sourceUrl).host;
  source.style.cssText = "position:absolute;right:18px;bottom:14px;color:#9aa8b3;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  CBZ.renderer.render(CBZ.scene, camera);
  const commandRoom = CBZ.presidency && CBZ.presidency._room;
  const worldCamera = new T.Vector3();
  camera.getWorldPosition(worldCamera);
  const seatRec = CBZ.presidency && CBZ.presidency.seat ? CBZ.presidency.seat() : null;
  return {
    ok: true,
    site: { x: site.cx, z: site.cz },
    camera: {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: aim.x, y: aim.y, z: aim.z },
    },
    audit,
    debug: {
      commandRoom: commandRoom && (subject.id === "situation-door" || subject.id === "situation-room") ? {
        rect: commandRoom.rect || null,
        seats: commandRoom.seats || 0,
        pads: (commandRoom.pads || []).map((p) => ({ key: p.key, x: p.x, z: p.z })),
        meshes: commandRoom.group ? commandRoom.group.children.length : 0,
        doorOpen: commandRoom.doorOpen ? 1 : 0,
      } : null,
      cameraWorld: { x: worldCamera.x, y: worldCamera.y, z: worldCamera.z },
      authoredRooms: CBZ.presidentInteriorRooms ? CBZ.presidentInteriorRooms() : [],
      authoredOrderProps: CBZ.presidentInteriorProps ? CBZ.presidentInteriorProps() : [],
      origin: {
        selected: CBZ.game && CBZ.game.cityOrigin,
        world: CBZ.game && CBZ.game.cityWorld && CBZ.game.cityWorld.origin,
        played: !!(CBZ.game && CBZ.game.cityWorld && CBZ.game.cityWorld.originPlayed),
        began: !!(CBZ.presidency && CBZ.presidency._state && CBZ.presidency._state().began),
        seat: seatRec ? { id: seatRec.id, title: seatRec.title, kind: seatRec.kind } : null,
      },
    },
    metrics: {
      namedRooms: Number(visual.namedRooms || 0),
      usableProps: Number(visual.usableProps || audit.sitRoomButtons || 0),
      stateSymbols: Number(visual.stateSymbols || 0),
      emptyDecor: Number(visual.emptyDecor || 0),
    },
  };
}

// The deployed pixels stay untouched, but these two cameras have to follow a
// room that was physically moved out of the shell's bogus side-wall volume.
// Express that relocation here as an explicit preset revision. This is why the
// comparator has a hook instead of stagePresident quietly rewriting whatever
// reference camera it receives: report metadata now records the honest after
// tripod and every subsequent reuse is stable.
function transformReferenceStage({ subject, stage }) {
  if (!subject || subject.cameraRevision !== "command-suite-v2" || !stage || !stage.camera) return stage;
  const copy = JSON.parse(JSON.stringify(stage));
  const site = copy.site || { x: 0, z: 0 };
  const shift = (point, dx) => point ? { x: point.x + dx, y: point.y, z: point.z } : point;
  if (subject.id === "situation-door") {
    // Old door local x=-11.8 faced east; the repaired door local x=11.3 faces
    // west. Preserve distance to the threshold while mirroring that outward
    // axis, then look through the real vision panel.
    const oldDoorX = site.x - 11.8, newDoorX = site.x + 11.3;
    const mirror = (point) => point ? { x: newDoorX - (point.x - oldDoorX), y: point.y, z: point.z } : point;
    copy.camera.position = mirror(copy.camera.position);
    copy.camera.target = mirror(copy.camera.target);
  } else {
    // Room centre moved from site.x-18.5 to site.x+19.0.
    copy.camera.position = shift(copy.camera.position, 37.5);
    copy.camera.target = shift(copy.camera.target, 37.5);
  }
  return copy;
}

export default {
  id: "president-compound",
  title: "President Mode — An Intentional Seat of Power",
  description: "Eleven matched player-view inspections of the live Executive Mansion and West Wing: exterior identity, arrival hierarchy, named rooms, restricted access, and physical props that perform the mode's political verbs.",
  viewport: { width: 1280, height: 800 },
  urlParams: { seed: 260811 },
  stageTimeoutMs: 300000,
  readyExpression: "window.CBZ && window.THREE && window.CBZ.stepSim && document.getElementById('playBtn')",
  subjects,
  stage: stagePresident,
  transformReferenceStage,
  pairNote: "Same President origin · seed · simulated age · matched tripod · light · viewport",
  method: "Both sides boot The President through the real title card and locate the live Executive Mansion through CBZ.govComplexes. Unmoved subjects reuse the exact world-space deployed camera. The two Situation Room pairs preserve the exact subject-relative tripod through one explicit, metadata-visible room-frame translation.",
  metrics: {
    namedRooms: { label: "Named, authored rooms", unit: "rooms", better: "higher" },
    usableProps: { label: "Physical usable props", unit: "props", better: "higher" },
    stateSymbols: { label: "Architectural state symbols", unit: "features", better: "higher" },
    emptyDecor: { label: "Decorative-only props", unit: "props", better: "lower" },
  },
  metricsNote: "Counts are read from the President-mode audit in each running build. The pictures remain the acceptance test; the ledger makes regressions visible between visual loops.",
};
