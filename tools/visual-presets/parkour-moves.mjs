/* "I want parkour animation added to gang city and jail game and natural
   disaster, ability for players to jump thru things — like if I go up to a
   building like the airport where there's one floor and I break a window, I
   can't jump through after, because I can jump OVER but I can't go THROUGH a
   space… and then real parkour jumping, catching self, landing, catching edge,
   what I look like in air, etc etc, and improving the current vault that looks
   glitchy." — the owner, 2026-08-17.

   Six frames, one per claim, and every one of them is a pose the shipped build
   cannot draw:

     the aperture      a wall with a hole in it. BEFORE the probe refuses every
                       opening in the game (measured: sill 0.90 m / aperture
                       1.40 m -> REFUSED) because the only trajectory this
                       engine had went OVER the top, straight into the header,
                       and its own clearance sweep then threw the move away.
                       So the before frame is a man standing at a hole he
                       cannot use — which is exactly the report.
     the vault         BEFORE, root motion eased with smooth01: zero derivative
                       at both ends, so a body running at 8 m/s dropped to
                       0.2 m/s AT the obstacle and left the far side at 1.0.
                       That is the "glitchy" — it is a velocity discontinuity,
                       not a bad pose. The metric below is the measurement.
     the air           animChar had no airborne branch at all. BEFORE, a body
                       at the top of a jump is running on nothing.
     the landing       there was no landing beat: the pose cleared on the frame
                       the root arrived and the walk cycle resumed from a full
                       tuck.
     the edge          nothing in the engine ever looked UP from a falling
                       body, so a jump that came up short simply kept falling.

   STAGING. The obstacles are BUILT BY THIS PRESET, at a fixed coordinate well
   outside the city, on seeded terrain — a sill-plus-header window, a waist
   wall, and a roof block. Nothing here photographs city dressing, so the two
   sides are pixel-comparable even though the deployed build's lots differ:
   both sides get the same three boxes, the same camera and the same simulated
   frame. rAF is stubbed so CBZ.stepSim is the only clock (jail-scene.mjs's
   rule), and every capability is feature-detected so the older deployed build
   degrades to "the body just stands there" instead of throwing.

   The claim is also a number. `crossSpeedPct` is the slowest horizontal root
   speed reached during the vault as a percentage of the speed the body arrived
   with: 100 % is a run carried straight through the obstacle, and the shipped
   build scores single digits. */

const subjects = [
  { id: "aperture-dive", label: "Through the broken window", hud: false,
    focus: "Mid-aperture, side on. The body has to be BETWEEN the sill and the header — hips over the sill, head under the lintel, arms leading. BEFORE: the probe refuses the opening outright, so he is stood at a hole he cannot pass.",
    act: { move: "through", phase: 0.50 },
    cam: { x: -7.0, y: 1.30, z: 0.4, aimX: 0, aimY: 1.15, aimZ: 0.4 } },
  { id: "aperture-emerge", label: "Coming out of the dive", hud: false,
    focus: "The far side, three-quarter view. The legs whip through last and the chin comes up to find the floor — a dive ends in a roll, because a body does not land a dive on its feet.",
    act: { move: "through", phase: 0.86 },
    cam: { x: -4.4, y: 1.05, z: 4.6, aimX: 0.2, aimY: 0.75, aimZ: 1.8 } },
  { id: "vault-mid", label: "Mid speed-vault", hud: false,
    focus: "Hand planted, hips skimming the top, legs split through. Watch the SPEED readout, not the pose: this is the frame where the shipped build had already dropped the run to a standstill.",
    act: { move: "vault", phase: 0.46 },
    cam: { x: -6.2, y: 1.45, z: -0.2, aimX: 0, aimY: 1.20, aimZ: 0.9 } },
  { id: "air-apex", label: "At the top of a jump", hud: false,
    focus: "The shape people recognise from a photograph: legs split with one knee high, arms wide, chest tall. BEFORE: the walk cycle is still running, so he strides through the air on nothing.",
    act: { move: "air", target: "apex" },
    cam: { x: -5.4, y: 2.05, z: -1.4, aimX: 0, aimY: 1.85, aimZ: 0 } },
  { id: "air-fall", label: "On the way down", hud: false,
    focus: "Both legs reach down and a little forward to find the ground, knees soft, arms out and back, eyes down. A falling body should already be preparing to land.",
    act: { move: "air", target: "fall" },
    cam: { x: -5.4, y: 2.35, z: -1.4, aimX: 0, aimY: 2.05, aimZ: 0 } },
  { id: "land-roll", label: "Rolling out of a drop", hud: false,
    focus: "A tucked ball mid-revolution, rotating about the body's centre rather than its feet. The roll is why a parkour landing is a technique and not a sound effect — and it now pays for itself in fall damage.",
    act: { move: "roll", phase: 0.45 },
    cam: { x: -4.6, y: 1.05, z: -1.4, aimX: 0, aimY: 0.70, aimZ: 0 } },
  { id: "edge-catch", label: "Catching the edge", hud: false,
    focus: "A jump that came up short, saved. BEFORE: nothing in the engine looks up from a falling body, so he is simply on his way to the ground past a ledge that was within reach.",
    act: { move: "catch", phase: 0.34 },
    cam: { x: -5.6, y: 2.60, z: -8.6, aimX: -0.4, aimY: 2.35, aimZ: -6.4 } },
];

/* The test yard's origin: far enough out that no lot, road or biome prop can
   wander into frame, and identical on both sides because the terrain is
   seeded. Every obstacle and camera below is expressed as an offset from it. */
const YARD = { x: 980, z: 980 };

async function stageParkour(input) {
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
      if (child.id === "__parkourOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__parkourSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn"), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 240000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    /* ---- BUILD THE YARD -------------------------------------------------
       Three obstacles, each a real mesh with a real height-banded collider,
       which is the only contract systems/physics.js traversal reads. The
       window is authored the way city/buildings.js's carveHole actually
       leaves one: a SILL course under the opening, a HEADER course above it,
       and full-height FLANKS either side — with nothing at all in between,
       because the wall's own collider is gone. That shape is the whole bug. */
    const gy = CBZ.groundAt ? CBZ.groundAt(YARD.x, YARD.z, 0) : 0;
    const mat = new T.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.88, metalness: 0.02 });
    const built = [];
    const slab = (w, h, d, cx, cy, cz, opts) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
      m.position.set(YARD.x + cx, gy + cy + h / 2, YARD.z + cz);
      m.castShadow = true; m.receiveShadow = true;
      CBZ.scene.add(m);
      const col = Object.assign({
        minX: m.position.x - w / 2, maxX: m.position.x + w / 2,
        minZ: m.position.z - d / 2, maxZ: m.position.z + d / 2,
        y0: gy + cy, y1: gy + cy + h, ref: m,
      }, opts || {});
      CBZ.colliders.push(col);
      built.push({ mesh: m, col });
      return col;
    };
    // THE WINDOW WALL, running along Z at x = 0, 0.40 m thick.
    //   sill   0.00 .. 0.95   (the lip the report's player could not pass)
    //   header 2.35 .. 4.20   (the lintel a vault's head goes straight into)
    //   flanks full height, leaving a 2.4 m wide opening centred on z = 0.4
    const sill = slab(0.40, 0.95, 6.0, 0, 0.00, 0.4);
    const header = slab(0.40, 1.85, 6.0, 0, 2.35, 0.4);
    slab(0.40, 4.20, 1.8, 0, 0.00, 4.30);            // flank, +z side
    slab(0.40, 4.20, 1.8, 0, 0.00, -3.50);           // flank, -z side
    // THE WAIST WALL for the vault, clear sky above it.
    slab(0.90, 0.95, 5.0, 0, 0.00, -9.0);
    // THE ROOF BLOCK for the edge catch: a 3.0 m lip with a real top.
    const roof = slab(4.0, 3.00, 4.0, 2.6, 0.00, -14.0);
    CBZ.markCollidersDirty();
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();

    const overlay = document.createElement("div");
    overlay.id = "__parkourOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__parkourSeq = { overlay, gy, sill, header, roof, built };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const gy = S.gy;
  const P = CBZ.player, rig = CBZ.playerChar;
  const Trav = CBZ.characterTraversal || null;
  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      CBZ.stepSim(1 / 60);
      if (P) { P.hp = Math.max(P.hp || 100, 90); P.dead = false; }
    }
  };
  // Settle a damped pose WITHOUT advancing the move: animChar converges on
  // whatever pose flag is currently set, so holding the phase and running the
  // animator is how a single frame of a move gets photographed cleanly.
  const settle = (n) => { for (let i = 0; i < (n || 36); i++) { try { CBZ.animChar(rig, (P && P.speed) || 0, 1 / 60); } catch (_) {} } };

  // Put the body back in a known state between subjects.
  const reset = (x, y, z) => {
    if (Trav && Trav.cancel) { try { Trav.cancel(P, rig, false, "preset"); } catch (_) {} }
    P._traversal = null; P._traverseSurface = null;
    rig.traversePose = null; rig.landPose = null; rig.airPose = null;
    rig.slidePose = false; rig.pronePose = false; rig.crouch = false;
    P.crouch = false; P.prone = false; P.sprint = false;
    P._noGrabT = 0; P._airT = 0; P._fallPeak = 0;
    if (rig.model) { rig.model.rotation.set(0, 0, 0); rig.model.position.set(0, 0, 0); }
    P.pos.set(x, y, z); P.vy = 0; P.grounded = true; P.speed = 0;
    rig.group.position.set(x, y, z);
    rig.group.rotation.set(0, 0, 0);
    rig.group.scale.set(1, 1, 1);
    settle(6);
  };

  const act = input.subject.act || {};
  const metrics = {
    traverseCap: (CBZ.modeHas ? (CBZ.modeHas("traverse") ? 1 : 0) : 0),
    apertureMove: 0, crossSpeedPct: 0, airPoseLive: 0, landPoseLive: 0, edgeCaught: 0,
    headroomCm: 0, kneeDeg: 0,
  };
  let note = "", movedKind = "—";

  // Drive one authored traversal to a fixed phase and hold it there.
  const runMove = (dirX, dirZ, opts, phase) => {
    if (!Trav || !Trav.start) return null;
    let s = null;
    try { s = Trav.start(P, rig, dirX, dirZ, opts); } catch (_) { s = null; }
    if (!s) return null;
    // Advance in real sub-steps so the trajectory (and its own sampler) owns
    // the root exactly as it does in play, then stop at the requested phase.
    const dt = 1 / 240;
    let slowest = Infinity, guard = 0;
    let px = P.pos.x, pz = P.pos.z;
    while (P._traversal && s.t < phase && guard++ < 4000) {
      CBZ.now = (CBZ.now || 0) + dt * 1000;
      try { Trav.step(P, rig, dt, false); } catch (_) { break; }
      const v = Math.hypot(P.pos.x - px, P.pos.z - pz) / dt;
      if (s.t > 0.06 && s.t < 0.94) slowest = Math.min(slowest, v);
      px = P.pos.x; pz = P.pos.z;
    }
    rig.group.position.set(P.pos.x, P.pos.y, P.pos.z);
    rig.group.rotation.y = s.yaw != null ? s.yaw : rig.group.rotation.y;
    if (isFinite(slowest) && (opts.speed || 0) > 0) {
      metrics.crossSpeedPct = Math.max(0, Math.round((slowest / opts.speed) * 100));
    }
    settle(40);
    return s;
  };

  if (act.move === "through" || act.move === "vault") {
    const isGap = act.move === "through";
    // Stand him in the run line, one and a half metres out from the near face,
    // approaching along +X (the wall runs along Z).
    const z = isGap ? YARD.z + 0.4 : YARD.z - 9.0;
    reset(YARD.x - 1.55, gy, z);
    P.speed = 7.2; P.sprint = false;
    const s = runMove(1, 0, {
      speed: 7.2, radius: P.radius, running: true,
      height: (rig.metric && rig.metric.height) || 1.8,
      allowTop: true, cars: false,
    }, act.phase || 0.5);
    if (s) {
      movedKind = s.kind + (s.gapStyle ? "/" + s.gapStyle : (s.style ? "/" + s.style : ""));
      if (s.kind === "through") metrics.apertureMove = 1;
      if (s.headroom) metrics.headroomCm = Math.round(s.headroom * 100);
    } else {
      // THE REPORTED BUG, drawn: the probe refused, so the jump did nothing and
      // the body is left standing against the opening. Walk him into the face
      // so the frame shows a man stopped at a hole rather than a man in a field.
      note = isGap ? "the opening was REFUSED — no move exists" : "no vault available";
      P.pos.x = YARD.x - (P.radius + 0.22);
      rig.group.position.set(P.pos.x, P.pos.y, P.pos.z);
      rig.group.rotation.y = Math.PI / 2;
      settle(30);
    }
    if (isGap && S.header && S.sill) {
      metrics.headroomCm = metrics.headroomCm ||
        Math.round((S.header.y0 - S.sill.y1) * 100);
    }
  } else if (act.move === "air") {
    reset(YARD.x - 5.0, gy, YARD.z - 1.0);
    // A REAL jump through the real updater, so the before side shows exactly
    // what the shipped build draws in the air rather than a posed guess.
    P.speed = 5.4;
    P.vy = (CBZ.TUNE && CBZ.TUNE.jumpVel) || 8.2;
    P.grounded = false;
    const wantFall = act.target === "fall";
    for (let i = 0; i < 220; i++) {
      step(1 / 60);
      if (!wantFall && P.vy <= 0.9) break;              // apex
      if (wantFall && P.vy <= -5.4) break;              // committed descent
      if (P.grounded) break;
    }
    rig.group.position.set(P.pos.x, P.pos.y, P.pos.z);
    if (rig.airPose) metrics.airPoseLive = 1;
    movedKind = "air vy=" + P.vy.toFixed(1);
    settle(34);
  } else if (act.move === "roll") {
    reset(YARD.x - 5.0, gy, YARD.z - 1.0);
    P.speed = 6.4;
    if (CBZ.charArmLanding) {
      // 14 m/s is a two-storey drop: past FALL_SAFE, which is exactly where the
      // roll is pinned, so this is the landing the technique exists for.
      const lp = CBZ.charArmLanding(rig, 14.0, 6.4, null);
      if (lp) {
        metrics.landPoseLive = 1;
        movedKind = lp.roll ? "roll" : "absorb";
        // Hold the requested phase: the animator advances landPose.t itself, so
        // seek by animating and then freeze the clock at the target.
        const target = (act.phase || 0.45) * (lp.dur || 0.62);
        let guard = 0;
        while (rig.landPose && rig.landPose.t < target && guard++ < 400) {
          try { CBZ.animChar(rig, 6.4, 1 / 240); } catch (_) { break; }
        }
        if (rig.landPose) {
          for (let i = 0; i < 30; i++) {
            rig.landPose.t = target;      // freeze, then let the damps converge
            try { CBZ.animChar(rig, 6.4, 1 / 60); } catch (_) { break; }
          }
        }
      }
    } else {
      note = "no landing beat exists in this build";
      settle(30);
    }
  } else if (act.move === "catch") {
    // A jump at the roof block that comes up short: airborne, falling, chest
    // just under a 3 m lip, holding the direction into it.
    const lipX = S.roof ? S.roof.minX : (YARD.x + 0.6);
    reset(lipX - 1.05, gy + 2.30, YARD.z - 14.0);
    P.grounded = false; P.vy = -3.4; P.speed = 5.0;
    rig.group.rotation.y = Math.PI / 2;
    let s = null;
    if (Trav && Trav.catchLedge) {
      try { s = Trav.catchLedge(P, rig, 1, 0, { radius: P.radius, speed: 5.0 }); } catch (_) { s = null; }
    }
    if (s) {
      metrics.edgeCaught = 1;
      movedKind = "caught " + s.kind;
      const dt = 1 / 240;
      let guard = 0;
      while (P._traversal && s.t < (act.phase || 0.34) && guard++ < 4000) {
        CBZ.now = (CBZ.now || 0) + dt * 1000;
        try { Trav.step(P, rig, dt, false); } catch (_) { break; }
      }
      rig.group.position.set(P.pos.x, P.pos.y, P.pos.z);
      settle(40);
    } else {
      // Nothing looked up: he keeps falling past a ledge he could have held.
      note = "nothing catches — the body falls past the ledge";
      for (let i = 0; i < 14; i++) step(1 / 60);
      rig.group.position.set(P.pos.x, P.pos.y, P.pos.z);
      movedKind = "falling vy=" + P.vy.toFixed(1);
      settle(24);
    }
  }

  // A folded knee is the cheapest single number that says "this body is doing
  // something other than standing" — reported so a flat frame is legible in the
  // report even before the eye reaches the screenshot.
  try {
    const j = rig.low || null;          // character.js keeps the lower joints on `.low`
    const knee = (j && (j.ll || j.rl)) || null;
    if (knee && knee.rotation) metrics.kneeDeg = Math.round(Math.abs(knee.rotation.x) * 180 / Math.PI);
  } catch (_) {}

  setHud(true);
  const camera = CBZ.camera;
  const cam = input.subject.cam || {};
  camera.aspect = input.width / input.height;
  camera.fov = 46;
  camera.near = 0.12;
  camera.far = 20000;
  camera.position.set(YARD.x + (cam.x || -6), gy + (cam.y || 1.4), YARD.z + (cam.z || 0));
  camera.lookAt(YARD.x + (cam.aimX || 0), gy + (cam.aimY || 1.1), YARD.z + (cam.aimZ || 0));
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  if (!input.subject.hud) setHud(false);
  CBZ.renderer.render(CBZ.scene, camera);

  const stats = (Trav && Trav.stats) ? Trav.stats() : {};
  const before = input.side === "before";
  const q = (name) => S.overlay.querySelector(`[data-${name}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = input.subject.label;
  q("name").style.cssText = "position:absolute;top:72px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:420px";
  q("focus").textContent = `move: ${movedKind}${note ? " · " + note : ""}`;
  q("focus").style.cssText = "position:absolute;top:104px;left:27px;color:#c0cfda;font-size:12px;font-weight:550;max-width:520px";
  const good = metrics.apertureMove || metrics.airPoseLive || metrics.landPoseLive ||
    metrics.edgeCaught || metrics.crossSpeedPct >= 70;
  q("perf").innerHTML =
    (metrics.crossSpeedPct ? `run carried through: ${metrics.crossSpeedPct}%<br>` : "") +
    (metrics.headroomCm ? `aperture ${metrics.headroomCm} cm<br>` : "") +
    `traverse cap ${metrics.traverseCap ? "on" : "OFF"}` +
    (stats.throughs != null ? `<br>through ${stats.throughs} · catches ${stats.catches} · rolls ${stats.rolls}` : "<br>no aperture/catch/roll in this build");
  q("perf").style.cssText = `position:absolute;right:24px;top:24px;text-align:right;line-height:1.7;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:${good ? "#9fe8c3" : "#ff9c9c"}`;
  const u = new URL(input.sourceUrl);
  q("source").textContent = u.host + u.pathname + u.search;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    poseDebug: {
      kind: movedKind, note,
      x: Number(P.pos.x.toFixed(3)), y: Number(P.pos.y.toFixed(3)), z: Number(P.pos.z.toFixed(3)),
      vy: Number((P.vy || 0).toFixed(2)),
      traversePose: rig.traversePose ? (rig.traversePose.kind + "/" + (rig.traversePose.gapStyle || rig.traversePose.style)) : null,
      airPose: rig.airPose ? { rise: +(rig.airPose.rise || 0).toFixed(2), fall: +(rig.airPose.fall || 0).toFixed(2) } : null,
      landPose: rig.landPose ? { roll: !!rig.landPose.roll, hard: +(rig.landPose.hard || 0).toFixed(2) } : null,
      stats,
    },
    metrics,
  };
}

export default {
  id: "parkour-moves",
  title: "Parkour: through the hole, the vault, the air, the landing, the edge",
  description:
    "Seven staged frames of the shared character traversal against obstacles this preset builds itself " +
    "(a sill-plus-header window opening, a waist wall, a 3 m roof lip) at a fixed coordinate outside the city, " +
    "so both sides photograph the same geometry from the same camera. Before = this same checkout with " +
    "?cfg_PARKOUR_V2=0, which has no aperture move, no airborne pose, no landing beat and no edge catch, " +
    "and whose vault stalls to a standstill at the obstacle.",
  // FLAG A/B against this same checkout. `?cfg_PARKOUR_V2=0` is the one-line
  // revert systems/physics.js publishes: no aperture move, smooth01 root motion
  // on the old fixed duration windows, no edge catch, no airborne pose, no
  // landing beat. So the two sides differ by this change and by nothing else —
  // no seed drift, no lot-layout drift, no deployed-build skew. (Comparing
  // against the deployed build instead still works: pass
  // `--before https://efoltyn.github.io/gta6/`.)
  defaultBefore: "local",
  beforeParams: { cfg_PARKOUR_V2: 0 },
  beforeLabel: "BEFORE · over it or not at all",
  afterLabel: "AFTER · through it, and it lands",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote:
    "crossSpeedPct is the slowest horizontal root speed reached during the move as a percentage of the speed the " +
    "body arrived with — 100 % is a run carried straight through the obstacle. The shipped build's vault eases " +
    "with a curve whose derivative is zero at both ends, so it scores in single digits: measured 8 m/s in, " +
    "0.2 m/s at the wall, 1.0 m/s out. That discontinuity is the 'glitchy vault', and it is the number to read " +
    "first. apertureMove / airPoseLive / landPoseLive / edgeCaught are each 1 only if that mechanic exists at all.",
  metrics: {
    crossSpeedPct: { label: "Run carried through the move", unit: "%", better: "higher" },
    apertureMove: { label: "The window opening is passable", better: "higher" },
    airPoseLive: { label: "Airborne pose exists", better: "higher" },
    landPoseLive: { label: "Landing beat exists", better: "higher" },
    edgeCaught: { label: "Edge catch exists", better: "higher" },
    headroomCm: { label: "Aperture headroom", unit: "cm" },
    kneeDeg: { label: "Lead knee flexion", unit: "deg" },
    traverseCap: { label: "Mode grants traverse" },
  },
  subjects,
  stage: stageParkour,
};
