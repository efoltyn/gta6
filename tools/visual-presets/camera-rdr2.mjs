/* RDR2 third-person camera storyboard for tools/visual-compare.mjs.

   Three owner complaints, photographed against the SAME live city on both
   builds, from the game's OWN camera — nothing here poses CBZ.camera, it only
   drives the two inputs a player has (CBZ.cam.yaw / CBZ.cam.pitch) and lets
   systems/camera.js write the frame:

     1. "I can't look all the way to the sky — a helicopter overhead is
        unfindable."  The sky subjects ask for a full up-pitch. The deployed
        build clamps the orbit at -1.0 rad AND, worse, barely tilts the view at
        all: its look target rises with the camera, so a 57 degree mouse-up
        buys about 5 degrees of view — in the wrong direction — while the boom
        swings under the pavement and gets pinned there by the dy floor. What
        that looks like is your own shins, level, with no sky in frame.

     2. "Looking up also changes the angle."  Every plate reports frameTiltDeg
        — the angle the character sits BELOW the view axis. Under a pure orbit
        that number is invariant to pitch; a rig that reframes as you look up
        cannot hold it. Read it down the exterior/45/sky column.

     3. RDR2 interiors: in a small room the boom comes IN over the shoulder and
        it does it as a damp across the doorway, not a collision snap. The two
        interior subjects photograph the settled room frame and a deliberately
        HALF-BLENDED doorway crossing, 0.2 s after stepping out of the same
        room, so a snap and a blend cannot look the same.

   Every measurement is taken from CBZ.camera + CBZ.player geometry, so the
   deployed build reports honestly without needing any new export. CBZ.camAudit
   is folded in when the build has one, never depended on.

   Staging facts: boots the real city (seed pinned), clicks through the title,
   jumps the campaign to free play, freezes the rAF loop so CBZ.stepSim is the
   only clock, then finds a REAL ground-floor room by looking for a first-floor
   slab in CBZ.platforms (a room is a floor with a ceiling over it) instead of
   trusting a hard-coded coordinate. The room is chosen ONCE and cached on the
   page, so every interior plate on both sides is the same room. */

const subjects = [
  {
    id: "exterior-standard",
    label: "Exterior — the standard angle",
    where: "outdoor",
    pitch: null,               // the tier's own resting pitch
    focus: "The at-rest street frame. Both builds should agree here almost exactly: the resting framing is preserved by construction. This plate is the control — if the character has moved in frame, the tilt solve is wrong.",
  },
  {
    id: "look-up-45",
    label: "Looking up — half way",
    where: "outdoor",
    pitch: -0.80,              // 45.8 degrees of mouse
    focus: "46 degrees of mouse-up. Deployed: the view stays nailed to the horizon and the boom sinks toward the pavement. After: the camera swings down and under, the view tilts 1:1, and the character holds its place in frame.",
  },
  {
    id: "sky-full",
    label: "Looking up — all the way (the helicopter shot)",
    where: "outdoor",
    pitch: -1.36,              // clamped to -1.0 on the deployed build
    focus: "THE COMPLAINT. Ask for the whole sky. Deployed: clamped at -1.0 rad and the frame is still the street. After: the arm shortens against the floor, the lens drops to your heels and the frame is sky with the character along the bottom.",
  },
  {
    id: "sky-down-again",
    label: "Back to level after the sky look",
    where: "outdoor",
    pitch: null,
    focus: "The same resting pitch as plate 1, arrived at from the sky look. The boom must come back to full length and the character back to the same place in frame — no hysteresis, no stuck arm.",
  },
  {
    id: "interior-room",
    label: "Inside a room — the RDR2 pull-in",
    where: "indoor",
    pitch: null,
    focus: "Standing in a real ground-floor room. Deployed: a 4.35 m boom fighting the walls, so the frame is whatever the collision clamp happened to leave. After: a damped ~1.5-2.2 m boom derived from the room itself, pivot eased to shoulder height, character offset to the left.",
  },
  {
    id: "doorway-blend",
    label: "Crossing the doorway — mid-blend",
    where: "doorway",
    pitch: null,
    focus: "0.2 s after stepping out of that same room: the enclosure damp is caught HALF way. A snap cannot be photographed half way — this plate is the difference between a blend and a collision pop.",
  },
];

async function stageCameraRdr2(input) {
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
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__camOverlay") continue;
      child.style.visibility = "hidden";
    }
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

  let S = window.__camRdr2;
  if (!S) {
    // ---- one-time: boot the real city into free play --------------------
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
    // the campaign boots into a scripted prologue; free play is where the
    // ordinary third-person camera actually runs.
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    // burn off the spawn intro (3.55 s of wall clock) and let streaming settle
    tick(420);
    if (typeof CBZ.setFPS === "function") { try { CBZ.setFPS(false); } catch (_) {} }
    if (CBZ.cityCam) CBZ.cityCam.fp = false;
    tick(60);

    // ---- FIND A REAL ROOM, BY STANDING IN IT ----------------------------
    // A slab footprint is NOT a room: the first attempt at this preset picked a
    // first-floor slab, dropped the player at its centroid, and photographed the
    // inside of a wall. So the test is the one that matters — can a BODY stand
    // here, is there a ceiling over it, and is there floor on every side. All of
    // it off CBZ.queryCollidersNear + CBZ.floorAt, which both builds have, so
    // the before side lands in exactly the same room.
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
    // march until something solid — the honest "how much floor is that way"
    const runTo = (x, y, z, dx, dz, far) => {
      for (let t = 0.25; t <= far; t += 0.25) if (solidAt(x + dx * t, y, z + dz * t)) return t;
      return far;
    };
    // A ROOM IS A SPAN, not a clearance — the first version of this finder
    // accepted the open ground floor of a tower (low ceiling, plenty of floor)
    // and photographed an arcade while calling it a small room. Wall-to-wall on
    // both axes, and the narrow one has to be small.
    const standable = (x, z) => {
      const y = (typeof CBZ.floorAt === "function") ? CBZ.floorAt(x, z) : 0;
      if (solidAt(x, y + 1.0, z) || solidAt(x, y + 1.7, z)) return null;
      const ceil = rayFree(x, y + 1.7, z, 0, 1, 0, 8);
      if (ceil > 3.0 || ceil < 0.6) return null;              // no roof, or no headroom
      const px = runTo(x, y + 1.2, z, 1, 0, 9), mx = runTo(x, y + 1.2, z, -1, 0, 9);
      const pz = runTo(x, y + 1.2, z, 0, 1, 9), mz = runTo(x, y + 1.2, z, 0, -1, 9);
      const span = Math.min(px + mx, pz + mz);
      if (Math.min(px, mx, pz, mz) < 1.3) return null;        // standing in a wall
      if (span > 7.5) return null;                            // that is a hall, not a room
      return { x, z, y, ceil, span, free: Math.min(px, mx, pz, mz) };
    };
    // Candidate centres come from the first-floor slabs (cheap, and it is where
    // rooms are), but every one of them has to pass `standable` on a small
    // offset grid before it is allowed to be the plate's room.
    let room = null;
    const plats = (CBZ.platforms || []).slice();
    plats.sort((a, b) => {
      const ax = (a.minX + a.maxX) / 2, az = (a.minZ + a.maxZ) / 2;
      const bx = (b.minX + b.maxX) / 2, bz = (b.minZ + b.maxZ) / 2;
      return Math.hypot(ax - home.x, az - home.z) - Math.hypot(bx - home.x, bz - home.z);
    });
    let tried = 0;
    for (let i = 0; i < plats.length && !room && tried < 90; i++) {
      const p = plats[i];
      if (p.top == null || p.top < 2.2 || p.top > 4.8) continue;
      const w = p.maxX - p.minX, d = p.maxZ - p.minZ;
      if (w < 3.5 || d < 3.5 || w > 40 || d > 40) continue;
      const cx = (p.minX + p.maxX) / 2, cz = (p.minZ + p.maxZ) / 2;
      tried++;
      let best = null;
      for (let gx = -2; gx <= 2; gx++) {
        for (let gz = -2; gz <= 2; gz++) {
          const s = standable(cx + gx * Math.min(2.2, w / 7), cz + gz * Math.min(2.2, d / 7));
          if (s && (!best || s.span < best.span)) best = s;
        }
      }
      if (best) room = { x: best.x, z: best.z, w, d, top: p.top, ceil: best.ceil, span: best.span };
    }

    // ---- FIND AN OPEN OUTDOOR SPOT, AND A DIRECTION TO FACE --------------
    // The exterior plates must be genuinely outdoors AND have room for a 4.35 m
    // boom, or they photograph a wall and call it the standard angle. Score
    // candidates on sky overhead and on the free run of a STREET — the best
    // axis is the one open in BOTH directions, because the camera lives behind
    // the character and needs its half of it.
    // The run is measured against COLLIDERS, not just LOS meshes: the first
    // attempt scored on LOS alone, picked a kerb beside a traffic-light mast,
    // and the boom the plate actually got was 2.2 m — the spring arm hit a pole
    // no LOS mesh knew about. The camera lives BEHIND the character, so what
    // matters is the run in both directions along one axis: a street.
    const openAt = (x, z) => {
      const y = (typeof CBZ.floorAt === "function") ? CBZ.floorAt(x, z) : 0;
      if (solidAt(x, y + 1.0, z)) return null;
      const ceiling = rayFree(x, y + 1.7, z, 0, 1, 0, 30);
      if (ceiling < 22) return null;                       // must be real sky, for the sky plates
      let bestDir = 0, bestRun = -1;
      for (let k = 0; k < 12; k++) {
        const th = (k / 12) * Math.PI;                     // an axis, not a direction
        const dx = Math.sin(th), dz = Math.cos(th);
        const run = Math.min(runTo(x, y + 1.7, z, dx, dz, 9), runTo(x, y + 1.7, z, -dx, -dz, 9));
        if (run > bestRun) { bestRun = run; bestDir = th; }
      }
      // facing `th` means forward = (sin th, cos th); the rig's forward is
      // (-sin yaw, -cos yaw), so yaw = th + π.
      return { x, z, y, ceiling, run: bestRun, yaw: bestDir + Math.PI, score: bestRun };
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
    let outdoor = cands[0] || { x: home.x, z: home.z, y: P.pos.y, yaw: 0, run: 0, ceiling: 30 };
    // VERIFY BY PHOTOGRAPHING IT: place, settle, and read the boom the rig
    // actually chose. A candidate that cannot hold the full follow distance is
    // not the standard angle, whatever its probes said.
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
      if (c.boom >= wantBoom) { outdoor = c; break; }
      if (!outdoor.boom || c.boom > outdoor.boom) outdoor = c;
    }

    const overlay = document.createElement("div");
    overlay.id = "__camOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-num></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__camRdr2 = { overlay, room, outdoor, yaw: outdoor.yaw };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const P = CBZ.player;
  const subject = input.subject;
  const restPitch = (CBZ.CITY_TP && CBZ.CITY_TP.PITCH != null) ? CBZ.CITY_TP.PITCH : 0.10;

  // ---- put the player where this plate wants him, then let the rig settle ---
  const put = (x, y, z) => {
    P.pos.x = x; P.pos.y = y; P.pos.z = z;
    P.driving = false; P.crouch = false; P.prone = false;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.set(x, y, z);
  };
  const floorY = (x, z) => (typeof CBZ.floorAt === "function" ? CBZ.floorAt(x, z) : 0);

  let placed = "outdoor";
  if (subject.where === "indoor" || subject.where === "doorway") {
    if (!S.room) return { ok: false, err: "no ground-floor room found in this seed" };
    put(S.room.x, floorY(S.room.x, S.room.z), S.room.z);
    placed = "indoor";
  } else {
    put(S.outdoor.x, floorY(S.outdoor.x, S.outdoor.z), S.outdoor.z);
  }
  CBZ.cam.yaw = S.yaw;
  CBZ.cam.pitch = subject.pitch != null ? subject.pitch : restPitch;

  if (subject.id === "sky-down-again") {
    // arrive at the resting pitch FROM the sky look, so the plate proves the
    // arm and the framing come back rather than sticking where they were left.
    CBZ.cam.pitch = -1.36; tick(90);
    CBZ.cam.pitch = restPitch;
  }

  if (subject.where === "doorway") {
    // settle fully inside so the enclosure damp is saturated…
    tick(150);
    // …then step OUT of the room and hold the shutter open for exactly 0.2 s.
    // With a 0.30 s time constant that lands the blend near half, which is the
    // frame a collision snap can never produce.
    const ox = S.outdoor.x, oz = S.outdoor.z;
    put(ox, floorY(ox, oz), oz);
    tick(12);
    placed = "doorway (0.2s out)";
  } else {
    tick(150);
  }

  // ---- honest geometry, measured the same way in BOTH builds ---------------
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.updateProjectionMatrix();
  tick(4);
  syncSky();

  camera.updateMatrixWorld(true);
  const dir = camera.getWorldDirection(new T.Vector3());
  const viewPitch = -Math.atan2(dir.y, Math.hypot(dir.x, dir.z));    // down positive, like cam.pitch
  // Where the character sits IN THE FRAME, measured in the camera's own basis.
  // The first version of this metric took the angle in the world vertical plane
  // through the player, which folds the 0.68 m shoulder offset into the answer —
  // harmless at a 4.35 m boom, 20 degrees of nonsense at 1.4 m. Screen framing
  // is a screen question: project onto the camera's up and right.
  const camUp = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const camRight = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const pivotY = P.pos.y + ((CBZ.CITY_TP && CBZ.CITY_TP.HEIGHT) || 1.7);
  const toChar = new T.Vector3(P.pos.x, pivotY, P.pos.z).sub(camera.position);
  const boom = toChar.length();
  const fwdComp = Math.max(0.05, toChar.dot(dir));
  const charBelow = -Math.atan2(toChar.dot(camUp), fwdComp);          // + = below the axis
  const charRight = Math.atan2(toChar.dot(camRight), fwdComp);        // + = right of the axis
  const deg = (r) => Math.round(r * (180 / Math.PI) * 100) / 100;

  let audit = null;
  try { if (typeof CBZ.camAudit === "function") audit = CBZ.camAudit(); } catch (_) { audit = null; }

  const metrics = {
    boomM: Math.round(boom * 100) / 100,
    camPitchDeg: deg(CBZ.cam.pitch),
    viewPitchDeg: deg(viewPitch),
    frameTiltDeg: deg(charBelow),
    frameSideDeg: deg(charRight),
    camClearM: Math.round((camera.position.y - P.pos.y) * 100) / 100,
    skyFrac: 0,
  };
  if (audit && Number.isFinite(audit.enclosure)) metrics.enclosure = Math.round(audit.enclosure * 100) / 100;

  // How much of the frame is actually pointed above the horizon? A vertical
  // half-FOV either side of the view axis, clipped to [0,1]. It is the one
  // number that answers "can I see the sky" without looking at the picture.
  {
    const half = (camera.fov * Math.PI / 180) / 2;
    const top = -viewPitch + half;                 // radians above horizontal at frame top
    const bot = -viewPitch - half;
    const f = (top <= 0) ? 0 : (bot >= 0 ? 1 : top / (top - bot));
    metrics.skyFrac = Math.round(f * 100) / 100;
  }

  hideHud();
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = subject.label;
  query("name").style.cssText = "position:absolute;top:62px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:520px";
  query("focus").textContent = `${placed} · mouse pitch ${metrics.camPitchDeg}° asked`;
  query("focus").style.cssText = "position:absolute;top:96px;left:27px;color:#c0cfda;font-size:12px;font-weight:550";
  query("num").textContent =
    `view ${metrics.viewPitchDeg}° · char ${metrics.frameTiltDeg}°↓ ${metrics.frameSideDeg}°→ · boom ${metrics.boomM}m · clear ${metrics.camClearM}m · sky ${Math.round(metrics.skyFrac * 100)}%` +
    (metrics.enclosure != null ? ` · room ${metrics.enclosure}` : " · room n/a");
  query("num").style.cssText = "position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3;text-align:right";
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  query("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    subject: subject.id,
    placed,
    room: S.room,
    hasAudit: !!audit,
    audit: audit,
    metrics,
  };
}

export default {
  id: "camera-rdr2",
  title: "Third Person, RDR2 Rules: Look At The Sky, Orbit Don't Reframe, Come Inside",
  description: "The game's own third-person camera photographed on both builds from the same seeded city, driving only the two inputs a player has. The deployed rig moves its look target the same way it moves the camera, so a full mouse-up buys about five degrees of view in the wrong direction while the boom sinks under the pavement and gets pinned there — which is why the sky is unreachable and why pitching reframes the character. The local build anchors the look target to the pivot the camera orbits (view pitch 1:1, framing invariant), clamps the ARM against the floor instead of the camera's height, and damps the boom in to a room-derived over-the-shoulder length when the probes find a ceiling AND walls.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "All measured from CBZ.camera + CBZ.player geometry in each build, so the deployed side reports honestly with no new export. viewPitchDeg is where the lens actually points for the mouse pitch asked (camPitchDeg) — on the deployed build read the sky plate: 70° of mouse buys a couple of degrees of view, in the wrong direction. frameTiltDeg/frameSideDeg are where the character sits in the FRAME, taken in the camera's own basis so the shoulder offset can't contaminate the vertical answer; under a pure orbit the vertical one holds across the exterior, half-way and sky plates. skyFrac is the fraction of the frame above the horizon.",
  metrics: {
    camPitchDeg: { label: "Mouse pitch (asked)", unit: "°" },
    viewPitchDeg: { label: "View pitch (delivered)", unit: "°" },
    frameTiltDeg: { label: "Character below axis", unit: "°" },
    frameSideDeg: { label: "Character right of axis", unit: "°" },
    boomM: { label: "Boom length", unit: "m" },
    camClearM: { label: "Lens above ground", unit: "m" },
    skyFrac: { label: "Frame above horizon", unit: "0-1", better: "higher" },
    enclosure: { label: "Room enclosure", unit: "0-1" },
  },
  subjects,
  stage: stageCameraRdr2,
};
