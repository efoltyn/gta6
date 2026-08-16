/* FIXED THIRD-PERSON ANGLE storyboard for tools/visual-compare.mjs.

   OWNER (2026-08-15, with a photo of the frame he wants): "this is the perfect
   angle for third person. Right now when I look around it isn't looking around
   only — it's also changing my camera angle. Make it a FIXED angle like the one
   I'm showing." He asked to see five states before and after: holding a gun,
   pointing it, shooting, running, and standing still.

   WHAT THE TWO SIDES ARE. One local server, one seed, one city; the only
   difference is `?cfg_CAM_TP_FIXED_ANGLE=0` on the BEFORE side. So nothing in
   these pairs is a wave that landed since the last deploy — it is the flag.

   HOW EACH PLATE IS DRIVEN. Nothing here poses CBZ.camera. Every plate moves
   only the inputs a player has — CBZ.cam.yaw / CBZ.cam.pitch (the look drag),
   CBZ.keys (WASD + shift), CBZ.fpsSetAim (the aim button), CBZ.fpsFire (the
   trigger) — and lets systems/camera.js and systems/fpsmode.js write the frame.
   The HUD is deliberately LEFT ON: the crosshair is half the claim, because
   under the pin the vertical drag moves the RETICLE instead of the camera.

   THE NUMBERS (all measured from live geometry on both builds, so the flag-off
   side reports honestly with no new export):
     · viewPitchDeg / camClearM — where the LENS points and how high it sits.
       These are the "camera angle" the owner is talking about. Under the pin
       they must be the SAME on every non-aiming plate, whatever the drag did.
     · aimPitchDeg — where the GUN actually points (CBZ.playerAimDir: the very
       ray shoot() fires). It must follow the drag on BOTH sides, or the fix
       traded a moving camera for a gun that can't be raised.
     · reticleYpct — the crosshair's height on screen, from CBZ.fpsReticleState.
       This is the vertical feedback that replaces the tilt.
     · frameTiltDeg — where the character sits below the view axis. */

const LOOK_UP = -0.40;     // 22.9° of drag up — the top of the new aim band
const LOOK_DOWN = 0.34;    // 19.5° of drag down

const subjects = [
  {
    id: "still-rest",
    label: "Standing still — no look input (the control)",
    state: "still", armed: false, pitch: null,
    focus: "THE CONTROL PLATE. Resting frame, nothing dragged. Both builds must agree almost exactly — this is the angle in the owner's photo and the pin's whole job is to make it the only angle. If the character has moved between these two, the pinned rig has re-tasted the framing instead of holding it.",
  },
  {
    id: "still-look-up",
    label: "Standing still — dragged up 23°",
    state: "still", armed: false, pitch: LOOK_UP,
    focus: "The complaint, at its simplest. BEFORE: the boom swings down and under toward the heels and the whole shot re-angles into the sky. AFTER: the lens has not moved a centimetre — read camClearM and viewPitchDeg against the control plate above.",
  },
  {
    id: "hold-gun",
    label: "Holding a gun — dragged up 23°",
    state: "still", armed: true, pitch: LOOK_UP,
    focus: "Armed, not aiming: the state the owner plays the city in, and the state his screenshot is taken in. AFTER, the drag is spent on the crosshair — watch reticleYpct climb up the screen while the camera stays exactly where it was.",
  },
  {
    id: "point-gun",
    label: "Pointing the gun — aim held, dragged up 23°",
    state: "still", armed: true, aim: true, pitch: LOOK_UP,
    focus: "AIM RELEASES THE PIN, on purpose. This is the one plate the two sides are meant to agree on: pressing aim hands the orbit back so a target overhead is still reachable (the older owner complaint — 'a helicopter overhead is unfindable' — is not being un-fixed). Note the tighter ADS boom on both.",
  },
  {
    id: "shooting",
    label: "Shooting — trigger down, dragged up 23°",
    state: "still", armed: true, fire: true, pitch: LOOK_UP,
    focus: "Rounds away with the aim raised. BEFORE the recoil rides a camera that has already swung; AFTER the frame holds and only the reticle and the muzzle move. The barrel is locked to the aim ray, not the lens, so the gun in shot points where the crosshair is.",
  },
  {
    id: "running",
    label: "Running — sprinting forward, dragged up 23°",
    state: "run", armed: true, pitch: LOOK_UP,
    focus: "Sprinting down the street with the same drag. This is where a swinging boom hurts most: BEFORE you sprint while the camera is somewhere near your knees. AFTER it is the same over-the-shoulder shot as standing still, so the street stays readable at speed.",
  },
  {
    id: "look-down",
    label: "Holding a gun — dragged DOWN 20°",
    state: "still", armed: true, pitch: LOOK_DOWN,
    focus: "The other direction, which the pin has to answer too. BEFORE the lens lifts over the head into a top-down stare. AFTER the shot is unchanged and the crosshair drops to the pavement where the shot would land.",
  },
];

async function stageFixedAngle(input) {
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
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      CBZ.stepSim(1 / 60);
      if (CBZ.player) { CBZ.player.hp = Math.max(CBZ.player.hp || 100, 90); CBZ.player.dead = false; }
    }
  };
  const syncSky = () => {
    if (typeof CBZ.skySync === "function") { CBZ.skySync(); return; }
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(CBZ.camera.position.x, 0, CBZ.camera.position.z);
  };
  const clearKeys = () => { const k = CBZ.keys || {}; for (const key of Object.keys(k)) k[key] = false; };

  let S = window.__camFixed;
  if (!S) {
    // ---- one-time: boot the real city into free play ----------------------
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        CBZ.stepSim && document.getElementById("playBtn"),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    // AIM MAGNETS OFF, on BOTH sides. The soft aim-lock is real gameplay, but
    // it is a second writer of cam.pitch: on the aiming plate it found a
    // pedestrian while the camera was still sweeping and settled the reticle
    // onto him, so the two sides ended up photographing different drags. The
    // subject here is the CAMERA; anything else that moves the aim is a
    // confound, and it is switched off identically on both builds.
    if (CBZ.CONFIG) { CBZ.CONFIG.AIM_LOCK_ASSIST = false; CBZ.CONFIG.TOUCH_AIM_ASSIST = false; }

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    tick(420);                                   // burn the 3.55 s spawn intro + let streaming settle
    if (typeof CBZ.setFPS === "function") { try { CBZ.setFPS(false); } catch (_) {} }
    if (CBZ.cityCam) CBZ.cityCam.fp = false;
    tick(60);

    // ---- find an open street with room for a full boom AND a long run -----
    // (the same probe camera-rdr2.mjs uses; a plate shot beside a lamp post
    // photographs the collision clamp, not the tier). The run matters twice
    // here: the camera lives behind the character, and one plate SPRINTS.
    const P = CBZ.player;
    const home = { x: P.pos.x, z: P.pos.z };
    const near = [];
    const rayFree = (x, y, z, dx, dy, dz, far) => {
      if (!CBZ.losBlockers || !CBZ.losBlockers.length) return far;
      const ray = new T.Raycaster(new T.Vector3(x, y, z), new T.Vector3(dx, dy, dz).normalize());
      ray.far = far;
      const h = CBZ.losRaycast ? CBZ.losRaycast(ray, CBZ.losBlockers) : ray.intersectObjects(CBZ.losBlockers, false);
      return h.length ? h[0].distance : far;
    };
    const solidAt = (x, y, z) => {
      const cs = CBZ.queryCollidersNear ? CBZ.queryCollidersNear(x, z, 1.2, near) : (CBZ.colliders || []);
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
        const y0 = c.y0 != null ? c.y0 : -1e4, y1 = c.y1 != null ? c.y1 : 1e4;
        if (y >= y0 && y <= y1) return true;
      }
      return false;
    };
    const runTo = (x, y, z, dx, dz, far) => {
      for (let t = 0.25; t <= far; t += 0.25) if (solidAt(x + dx * t, y, z + dz * t)) return t;
      return far;
    };
    const openAt = (x, z) => {
      const y = (typeof CBZ.floorAt === "function") ? CBZ.floorAt(x, z) : 0;
      if (solidAt(x, y + 1.0, z)) return null;
      if (rayFree(x, y + 1.7, z, 0, 1, 0, 30) < 22) return null;       // must be real sky
      let bestDir = 0, bestRun = -1;
      for (let k = 0; k < 24; k++) {
        const th = (k / 24) * Math.PI * 2;
        const dx = Math.sin(th), dz = Math.cos(th);
        // forward run for the sprint, backward run for the boom behind you
        const fwd = runTo(x, y + 1.7, z, dx, dz, 26);
        const back = runTo(x, y + 1.7, z, -dx, -dz, 9);
        const score = Math.min(fwd, 26) * 0.6 + Math.min(back, 9) * 2.2;
        if (score > bestRun) { bestRun = score; bestDir = th; }
      }
      // facing `th` means forward = (sin th, cos th); the rig's forward is
      // (-sin yaw, -cos yaw), so yaw = th + π.
      return { x, z, y, run: bestRun, yaw: bestDir + Math.PI, score: bestRun };
    };
    const cands = [];
    for (let ring = 0; ring <= 3; ring++) {
      const n = ring === 0 ? 1 : 16, r = ring * 15;
      for (let k = 0; k < n; k++) {
        const th = (k / n) * Math.PI * 2;
        const c = openAt(home.x + Math.sin(th) * r, home.z + Math.cos(th) * r);
        if (c) cands.push(c);
      }
    }
    cands.sort((a, b) => b.score - a.score);
    let spot = cands[0] || { x: home.x, z: home.z, y: P.pos.y, yaw: 0, run: 0 };
    // VERIFY BY PHOTOGRAPHING IT: place, settle, read the boom the rig chose.
    const wantBoom = ((CBZ.CITY_TP && CBZ.CITY_TP.DIST) || 4.35) * 0.92;
    for (let i = 0; i < Math.min(6, cands.length); i++) {
      const c = cands[i];
      P.pos.x = c.x; P.pos.y = c.y; P.pos.z = c.z;
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.set(c.x, c.y, c.z);
      CBZ.cam.yaw = c.yaw; CBZ.cam.pitch = (CBZ.CITY_TP && CBZ.CITY_TP.PITCH != null) ? CBZ.CITY_TP.PITCH : 0.1;
      tick(60);
      const dx = CBZ.camera.position.x - P.pos.x, dz = CBZ.camera.position.z - P.pos.z;
      const dy = CBZ.camera.position.y - (P.pos.y + 1.7);
      c.boom = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (c.boom >= wantBoom) { spot = c; break; }
      if (!spot.boom || c.boom > spot.boom) spot = c;
    }

    const overlay = document.createElement("div");
    overlay.id = "__fixOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-num></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__camFixed = { overlay, spot, yaw: spot.yaw };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const P = CBZ.player;
  const subject = input.subject;
  const restPitch = (CBZ.CITY_TP && CBZ.CITY_TP.PITCH != null) ? CBZ.CITY_TP.PITCH : 0.10;

  // ---- reset every input this preset can leave behind ----------------------
  clearKeys();
  if (CBZ.fpsFire) { try { CBZ.fpsFire(false); } catch (_) {} }
  if (CBZ.fpsSetAim) { try { CBZ.fpsSetAim(false); } catch (_) {} }
  P.driving = false; P.crouch = false; P.prone = false; P.dead = false;
  P.pos.x = S.spot.x; P.pos.z = S.spot.z;
  P.pos.y = (typeof CBZ.floorAt === "function") ? CBZ.floorAt(S.spot.x, S.spot.z) : S.spot.y;
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.set(P.pos.x, P.pos.y, P.pos.z);
  CBZ.cam.yaw = S.yaw;
  CBZ.cam.pitch = restPitch;

  // ---- weapon state: the REAL acquisition + holster paths ------------------
  if (subject.armed) {
    if (CBZ.unlockWeapon) CBZ.unlockWeapon("sidearm", { select: true });
    if (CBZ.playerHolster) { try { CBZ.playerHolster(false); } catch (_) {} }
    if (CBZ.fpsAddAmmo) { try { CBZ.fpsAddAmmo(120); } catch (_) {} }
  } else if (CBZ.playerHolster) {
    try { CBZ.playerHolster(true); } catch (_) {}
  }
  tick(40);                                   // let the draw/holster ramp finish

  // ---- the look drag, then settle -----------------------------------------
  // Applied AFTER the state is established, exactly like a player's thumb: the
  // camera is already at rest when the drag happens, so what the plate shows is
  // what the DRAG did and not what the spawn did.
  if (subject.pitch != null) {
    const r = CBZ.camPitchRange ? CBZ.camPitchRange() : [-1.0, 0.9];
    CBZ.cam.pitch = Math.max(r[0], Math.min(r[1], subject.pitch));
  }

  if (subject.aim && CBZ.fpsSetAim) {
    CBZ.fpsSetAim(true);
    tick(6);
    // aiming re-opens the envelope (the pin releases), so ask again for the
    // full drag now that the clamp is the orbit clamp.
    if (subject.pitch != null) {
      const r2 = CBZ.camPitchRange ? CBZ.camPitchRange() : [-1.0, 0.9];
      CBZ.cam.pitch = Math.max(r2[0], Math.min(r2[1], subject.pitch));
    }
  }

  let sprintSpeed = 0;
  if (subject.state === "run") {
    const k = CBZ.keys || {};
    k["w"] = true; k["shift"] = true;
    tick(70);                                  // up to speed, mid-stride
    sprintSpeed = Math.round((P.speed || Math.hypot(P.vel ? P.vel.x : 0, P.vel ? P.vel.z : 0)) * 100) / 100;
  } else {
    tick(90);
  }

  // ---- the aspect the plate is actually captured at, BEFORE the reticle is
  // projected — the crosshair is drawn from a projection, so a stale matrix
  // would put it in the wrong place in the picture.
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.updateProjectionMatrix();
  tick(6);

  let shotsFired = 0;
  if (subject.fire && CBZ.fpsFire) {
    const rounds = () => (CBZ.fps && CBZ.fps.rounds && CBZ.fps.rounds[CBZ.fps.weapon]) || 0;
    const start = rounds();
    // A BURST, not one squeeze. The sidearm is semi-auto, so holding the
    // trigger fires once and then the flash is long gone by the time the
    // present-weapon pose has ramped in — which photographed as a man standing
    // still. Three trigger pulls: the first two raise the arms and stack the
    // recoil, and the shutter opens ONE tick after the third, so the plate
    // catches a live discharge on a settled aiming pose.
    for (let s = 0; s < 2; s++) {
      CBZ.fpsFire(true); tick(2); CBZ.fpsFire(false); tick(7);
    }
    CBZ.fpsFire(true);
    tick(1);                                   // shutter opens ON the discharge
    shotsFired = Math.max(0, start - rounds());
  }

  syncSky();
  camera.updateMatrixWorld(true);

  // ---- honest geometry, measured the same way in BOTH builds ---------------
  const dir = camera.getWorldDirection(new T.Vector3());
  const viewPitch = -Math.atan2(dir.y, Math.hypot(dir.x, dir.z));    // down positive, like cam.pitch
  const aimD = new T.Vector3();
  if (CBZ.playerAimDir) CBZ.playerAimDir(aimD).normalize();
  else aimD.copy(dir);
  const aimPitch = -Math.atan2(aimD.y, Math.hypot(aimD.x, aimD.z));
  const camUp = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const camRight = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const pivotY = P.pos.y + ((CBZ.CITY_TP && CBZ.CITY_TP.HEIGHT) || 1.7);
  const toChar = new T.Vector3(P.pos.x, pivotY, P.pos.z).sub(camera.position);
  const boom = toChar.length();
  const fwdComp = Math.max(0.05, toChar.dot(dir));
  const charBelow = -Math.atan2(toChar.dot(camUp), fwdComp);
  const charRight = Math.atan2(toChar.dot(camRight), fwdComp);
  const deg = (r) => Math.round(r * (180 / Math.PI) * 100) / 100;

  let audit = null;
  try { if (typeof CBZ.camAudit === "function") audit = CBZ.camAudit(); } catch (_) { audit = null; }
  let ret = null;
  try { if (typeof CBZ.fpsReticleState === "function") ret = CBZ.fpsReticleState(); } catch (_) { ret = null; }

  const metrics = {
    mousePitchDeg: deg(CBZ.cam.pitch),
    viewPitchDeg: deg(viewPitch),
    aimPitchDeg: deg(aimPitch),
    camClearM: Math.round((camera.position.y - P.pos.y) * 100) / 100,
    boomM: Math.round(boom * 100) / 100,
    frameTiltDeg: deg(charBelow),
    frameSideDeg: deg(charRight),
  };
  // Only when there IS a crosshair. fpsReticleState keeps its last value while
  // the weapon is stowed, and a stale number from the pre-holster spawn frames
  // would read as a difference between the sides that no player could see.
  if (subject.armed && ret && Number.isFinite(ret.y)) metrics.reticleYpct = Math.round(ret.y * 10) / 10;
  if (audit && Number.isFinite(audit.fixed)) metrics.pinned = Math.round(audit.fixed * 100) / 100;
  if (subject.state === "run") metrics.runSpeed = sprintSpeed;
  if (subject.fire) metrics.shotsFired = shotsFired;

  // The HUD STAYS UP: the crosshair is the other half of the claim.
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = subject.label;
  query("name").style.cssText = "position:absolute;top:62px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:520px";
  query("focus").textContent =
    `${subject.armed ? (subject.aim ? "aiming" : subject.fire ? "firing" : "armed") : "unarmed"} · ` +
    `${subject.state === "run" ? "sprinting" : "standing"} · drag ${metrics.mousePitchDeg}° asked`;
  query("focus").style.cssText = "position:absolute;top:96px;left:27px;color:#c0cfda;font-size:12px;font-weight:550";
  query("num").textContent =
    `lens ${metrics.viewPitchDeg}° @ ${metrics.camClearM}m · gun ${metrics.aimPitchDeg}° · ` +
    `char ${metrics.frameTiltDeg}°↓ · boom ${metrics.boomM}m` +
    (metrics.reticleYpct != null ? ` · reticle ${metrics.reticleYpct}%` : "") +
    (metrics.pinned != null ? ` · pin ${metrics.pinned}` : "");
  // dark chip behind the numbers: the sky is the background on half these
  // plates and light-green-on-white is unreadable exactly where it matters.
  query("num").style.cssText = "position:absolute;right:24px;top:22px;padding:6px 10px;border-radius:7px;background:rgba(9,14,20,.72);font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3;text-align:right;text-shadow:none";
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname + new URL(input.sourceUrl).search;
  query("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  // leave nothing held for the next plate
  if (CBZ.fpsFire) { try { CBZ.fpsFire(false); } catch (_) {} }
  clearKeys();

  return { ok: true, subject: subject.id, hasAudit: !!audit, audit, metrics };
}

export default {
  id: "camera-fixed-angle",
  title: "A Fixed Third-Person Angle: Look Around Without Re-Angling The Shot",
  description: "The city's own third-person camera photographed on both builds from the same seeded street, driving only the inputs a player has — the look drag, WASD, the aim button, the trigger. BEFORE (cfg_CAM_TP_FIXED_ANGLE=0) is the shipped pure orbit: a vertical drag swings the whole boom, so looking up drops the lens toward your heels and looking down lifts it over your head. AFTER, the city on-foot rig is pinned at its resting angle — the frame in the owner's photo — and the vertical drag drives the GUN instead: fpsmode takes its aim from the look input rather than the lens, so rounds, the acquire cone and the crosshair all rise together while the shot holds still. Pressing aim releases the pin, so the sky is still reachable.",
  beforeLabel: "BEFORE · cfg_CAM_TP_FIXED_ANGLE=0",
  afterLabel: "AFTER · fixed angle",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "Measured from CBZ.camera + CBZ.player geometry and CBZ.playerAimDir on each build, so the flag-off side reports honestly. viewPitchDeg/camClearM are the CAMERA — the thing the owner asked to stop moving; on the after side they should read the same on every plate that is not aiming, whatever the drag was. aimPitchDeg is the GUN — the ray shoot() actually fires — and it must follow the drag on both sides. reticleYpct is where the crosshair sits on screen (50 = centre): under the pin it is the vertical feedback that the camera used to give by tilting.",
  metrics: {
    mousePitchDeg: { label: "Look drag (asked)", unit: "°" },
    viewPitchDeg: { label: "Lens pitch (camera)", unit: "°" },
    camClearM: { label: "Lens above ground", unit: "m" },
    aimPitchDeg: { label: "Gun pitch (delivered)", unit: "°" },
    reticleYpct: { label: "Crosshair height", unit: "% down screen" },
    frameTiltDeg: { label: "Character below axis", unit: "°" },
    boomM: { label: "Boom length", unit: "m" },
    pinned: { label: "Pin engaged", unit: "0-1" },
    runSpeed: { label: "Sprint speed", unit: "m/s" },
    shotsFired: { label: "Rounds away", unit: "" },
  },
  subjects,
  stage: stageFixedAngle,
};
