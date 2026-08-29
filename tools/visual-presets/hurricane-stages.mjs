/* THE HURRICANE storyboard for tools/visual-compare.mjs.

   Skeleton lifted from quake-stages.mjs (same boot, same rAF freeze, same
   CBZ.stepSim clock), narrowed to ONE disaster and staged along its real
   timeline. A hurricane is the only disaster in the roster that lasts long
   enough to have STRUCTURE, so the beats are the structure:

     outer bands      warn phase. The first squalls, the first lean, debris
                      beginning to stream. Shot as a PAIR 0.12 s apart from
                      one fixed camera — a still cannot carry motion.
     front eyewall    the same DETERMINISTIC tripod in town, at full scream:
                      whiteout rain, debris flat on the wind, the fog wall
                      closed in. Also a pair, so the streaming direction is
                      visible. Compare the tripod against the back-wall pair.
     the surge        the water is the killer: the sea driven metres up, the
                      low streets a rescue-map, cars afloat, bots swimming.
                      Camera solved to the deepest flooded ground THIS run.
     THE EYE          the trap. Camera at the live eye center: rain stopped,
                      sky open, sun out — ringed by the rotating cloud wall.
                      On the before build there is no eye to stand in and the
                      frame says so.
     back eyewall     the same tripod as the front pair, after the eye has
                      passed: the wind has REVERSED. Two pairs, one tripod,
                      opposite streaming directions — that is the whole
                      before/after in four frames.
     the tail         the wall moving off, the sea draining, the town
                      glass-out and leaning where the eyewall walked.

   CAMERAS ARE SOLVED, NOT TYPED (quake-stages' law): the eye beats ask
   CBZ.hurricane.state() where the eye actually is, the surge beat samples
   the live flood-depth field for the deepest street, the tail beat frames
   the worst-damaged standing building. The one deliberate exception is the
   TRIPOD: front and back eyewall shots must be the SAME camera or the
   reversal is not evidence, so that camera derives from arena constants
   (deterministic across builds and --subjects subsets), not from a stored
   first-pass solve that a subset run would not have.

   BUILD A/B, not flag A/B (the HURRICANE_V2 flag is purged — git is the
   undo): before is the served --before build (HEAD's cyclone with its
   cylinder-mesh eyewall and one-size storm), after is this checkout.
   Same seed, same island.

   FILM STRIPS + FEEL METRICS (the wind-room pass): a still cannot carry
   "you feel it, you don't see it", so the eyewall and eye beats each grow a
   `strip` — the same simulated seconds photographed as a row — and the
   stage exposes __cbzVisualCompare.advance()/metrics() so the strip is also
   MEASURED: wind at the player, gust variance, how far the wind physically
   shoved the player, knockdowns during the photographed seconds. The
   pictures show the force; the numbers count it.

   BEATS ARE FRACTIONS, NOT SECONDS: the storm's duration now scales with
   its rolled Saffir-Simpson category, so `atFrac` pins each beat to a
   fraction of THIS storm's active phase (t0 = timeLeft at activation),
   which lands on the same structural moment at any category. */

const subjects = [
  { id: "bands-a", label: "Outer bands — frame 1 of 2", pair: "bands",
    focus: "Warn phase. The storm's far edge is already here: squall bands with slots between them, the first debris off the ground, everything leaning one way. Frame 1 of a 0.12 s pair.",
    act: { force: "hurricane", untilState: "warn", extraSecs: 2.4 },
    cam: { aim: "tripod", up: 2.3 } },
  { id: "bands-b", label: "Outer bands — frame 2 of 2", pair: "bands",
    focus: "The same camera 0.12 s later. The debris and rain have moved WITH the wind; the buildings have not. Compare against frame 1 for the streaming direction.",
    act: { extraSecs: 0.12 },
    cam: { aim: "tripod", up: 2.3 } },

  /* From here every beat is pinned to a FRACTION of the active phase
     (`atFrac`, of t0 = timeLeft at activation), so a --subjects subset lands
     on the same moment as the full storyboard AND the same structural moment
     at any rolled category (duration now scales with category). Shape of the
     track at any size: front eyewall over town ~0.19, eye over the island
     center ~0.33-0.45, surge peak ~0.4, back eyewall ~0.49, tail ~0.68. */
  { id: "frontwall-a", requireHurricane: true, label: "Front eyewall — frame 1 of 2", pair: "frontwall",
    strip: { frames: 6, stepSec: 0.35 },
    focus: "The deterministic town tripod at the height of the FRONT wall: near-whiteout, debris flat on the wind, gusts knocking people down. Note the streaming direction — the back-wall pair from this same tripod shows it reversed. The film strip is the wind room: 2.1 s of the player being shoved, debris crossing the frame, gusts arriving as impulses.",
    act: { atFrac: 0.19 },
    cam: { aim: "tripod", up: 2.3 } },
  { id: "frontwall-b", requireHurricane: true, label: "Front eyewall — frame 2 of 2", pair: "frontwall",
    focus: "0.12 s later from the same tripod. Debris displacement between the two frames IS the wind vector, drawn by the world itself.",
    act: { extraSecs: 0.12 },
    cam: { aim: "tripod", up: 2.3 } },

  { id: "eye-inside", requireHurricane: true, label: "THE EYE — inside the calm",
    strip: { frames: 5, stepSec: 0.9 },
    focus: "Camera at the LIVE eye center. The rain has stopped, the sky has opened, the sun is back — and the world DISSOLVES into the murk of the wall at the eye's radius: no cloud cylinder, no mesh, just the distance the rain lets you see. On the before build the wall is a textured cylinder — a building. The strip holds the calm long enough to trust it, which is the trap.",
    act: { atFrac: 0.335 },
    cam: { aim: "eye", up: 2.0 } },
  { id: "eye-sky", requireHurricane: true, label: "THE EYE — the wall from within",
    focus: "Still inside the eye, tilted up at the wall's rim: clear sky overhead, the eyewall's cloud cylinder all round. The back half of the storm is that wall, coming this way.",
    act: { atFrac: 0.36 },
    cam: { aim: "eyeup" } },

  { id: "surge", requireHurricane: true, label: "Storm surge — the water is the killer",
    focus: "The sea driven metres above its resting level through the ONE shared surge lever. Camera solved to the deepest flooded ground this run: streets underwater, cars afloat and carried, bots swimming or drowned. The before build's hurricane never touches the sea.",
    act: { atFrac: 0.40 },
    cam: { aim: "flood", back: 28, up: 9 } },

  { id: "backwall-a", requireHurricane: true, label: "Back eyewall — frame 1 of 2", pair: "backwall",
    strip: { frames: 6, stepSec: 0.35 },
    focus: "The SAME tripod as the front-wall pair, after the eye has passed. The far wall has arrived and the wind is blowing the OPPOSITE way — compare the streaming direction against the front-wall frames, and this strip against the front-wall strip: the same room, the wind reversed.",
    act: { atFrac: 0.49 },
    cam: { aim: "tripod", up: 2.3 } },
  { id: "backwall-b", requireHurricane: true, label: "Back eyewall — frame 2 of 2", pair: "backwall",
    focus: "0.12 s later. Same tripod, reversed displacement. Four frames, one camera: band → front wall → back wall, and the reversal is in the pixels.",
    act: { extraSecs: 0.12 },
    cam: { aim: "tripod", up: 2.3 } },

  { id: "tail", requireHurricane: true, label: "The tail — draining and damage",
    focus: "The storm moving off: wind falling, the surge draining back out, and the town wearing the eyewall's track — glass out, facades spalling, the worst building framed. The ledger this damage sits in is shared with the quake and the wave.",
    act: { atFrac: 0.68 },
    cam: { aim: "worst", back: 38, up: 18, look: 6 } },
];

async function stageHurricane(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
      if (child.id === "__hurOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__hurSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="survival"]'), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="survival"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (!CBZ.disasters || typeof CBZ.disasters.force !== "function") return { ok: false, err: "no CBZ.disasters.force" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    // The seam, honestly declared: index.html should carry the tag already;
    // a build that somehow lacks it gets the module injected so the frame
    // photographs a storm instead of a no-op. Both sides serve their OWN
    // build's module — this changes nothing on a build that has the tag.
    if (!CBZ.hurricane) {
      await new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = "src/systems/hurricane.js?visualpreset=1";
        s.onload = resolve; s.onerror = resolve;
        document.head.appendChild(s);
        setTimeout(resolve, 8000);
      });
    }

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__hurOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__hurSeq = { overlay, t0: null, lastCam: null, strip: null };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
      /* FILM-STRIP STEPPER: the runner calls advance(stepSec) between strip
         captures. Step the frozen sim, sample the wind ON THE PLAYER each
         tick (the wind room, measured), then re-park the camera the stage
         solved — the engine's controller re-follows the player every tick,
         and it is the PLAYER who is left free to be shoved (that drift is a
         metric, not an accident). */
      advance(sec) {
        const n = Math.max(1, Math.round((Number(sec) || 0.5) * 60));
        for (let i = 0; i < n; i++) {
          CBZ.hitstop = 0; CBZ.slowmo = 0;
          CBZ.stepSim(1 / 60);
          if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
          const st = S.strip;
          if (st && CBZ.player && CBZ.player.pos) {
            let w = null;
            try {
              w = (CBZ.hurricane && CBZ.hurricane.active && CBZ.hurricane.active())
                ? CBZ.hurricane.windAt(CBZ.player.pos.x, CBZ.player.pos.z)
                : (CBZ.weatherWind ? CBZ.weatherWind() : null);
            } catch (_) {}
            st.samples.push(w ? w.speed : 0);
          }
        }
        const lc = S.lastCam;
        if (lc) {
          CBZ.camera.position.set(lc.eye.x, lc.eye.y, lc.eye.z);
          CBZ.camera.lookAt(lc.look.x, lc.look.y, lc.look.z);
          CBZ.camera.updateProjectionMatrix();
        }
        if (typeof CBZ.skySync === "function") CBZ.skySync();
        try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
      },
      /* Merged into the subject's metrics after the strip: the numbers and
         the pictures describe the same photographed seconds. */
      metrics() {
        const st = S.strip;
        if (!st) return null;
        const a = st.samples, n = a.length || 1;
        let mean = 0; for (let i = 0; i < a.length; i++) mean += a[i];
        mean /= n;
        let v = 0, peak = 0;
        for (let i = 0; i < a.length; i++) { v += (a[i] - mean) * (a[i] - mean); if (a[i] > peak) peak = a[i]; }
        v /= n;
        const p = CBZ.player && CBZ.player.pos;
        const ha2 = (typeof CBZ.hurricaneAudit === "function") ? CBZ.hurricaneAudit() : {};
        return {
          stripWindMean: +mean.toFixed(1),
          stripWindPeak: +peak.toFixed(1),
          stripGustSd: +Math.sqrt(v).toFixed(2),
          stripPlayerDrift: p ? +Math.hypot(p.x - st.p0x, p.z - st.p0z).toFixed(2) : 0,
          stripKnockdowns: Math.max(0, Number(ha2.knockdowns || 0) - st.kd0),
        };
      },
    };
  }

  const subject = input.subject;
  const act = subject.act || {};
  const heal = () => {
    if (!CBZ.player) return;
    CBZ.player.hp = 100; CBZ.player.dead = false;
    if (CBZ.player.stamina != null) CBZ.player.stamina = 100;
  };
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
      heal();
    }
  };
  const stepUntilState = (want, budget) => {
    let guard = Math.round((budget || 30) * 10);
    while (guard-- > 0 && CBZ.disasters.state() !== want) step(0.1);
  };

  /* ORDER-INDEPENDENCE (quake-stages' lesson, kept): any beat that needs the
     hurricane says so and re-forces it, then seeks to its own absolute
     second of the ACTIVE phase off the director's own clock. */
  const armHurricane = () => {
    CBZ.disasters.force("hurricane"); step(0.1);
    stepUntilState("active", 40);
    S.t0 = CBZ.disasters.timeLeft();
  };
  if (subject.requireHurricane && CBZ.disasters.current() !== "HURRICANE" && !act.force) armHurricane();
  if (act.force) {
    CBZ.disasters.force(act.force); step(0.1);
    if (act.force === "hurricane") S.t0 = null;
  }
  if (act.untilState) stepUntilState(act.untilState, 40);
  if (act.atSecs != null || act.atFrac != null) {
    if (CBZ.disasters.state() !== "active") stepUntilState("active", 40);
    if (S.t0 == null) S.t0 = CBZ.disasters.timeLeft();
    // atFrac scales with THIS storm's rolled duration; atSecs kept for callers
    const target = act.atSecs != null ? act.atSecs : act.atFrac * S.t0;
    let guard = 900;
    while (guard-- > 0 && CBZ.disasters.state() === "active" &&
           CBZ.disasters.current() === "HURRICANE" &&
           (S.t0 - CBZ.disasters.timeLeft()) < target) step(0.1);
  }
  if (act.extraSecs) step(act.extraSecs);

  // ---- SOLVE THE CAMERA off live world state -----------------------------
  const A = (CBZ.SURV && CBZ.SURV.arena) || { cx: 0, cz: 600, radius: 120 };
  const arena = CBZ.surv && CBZ.surv.arena;
  const cam = subject.cam || {};
  const floorAt = (x, z) => { try { return CBZ.floorAt ? CBZ.floorAt(x, z) : 0; } catch (_) { return 0; } };
  const floodAt = (x, z) => { try { return CBZ.survFloodDepthAt ? CBZ.survFloodDepthAt(x, z) : -9; } catch (_) { return -9; } };

  /* The solve is a FUNCTION because it runs twice: once to find where the shot
     stands, and again after the weather settle below (the eye MOVES ~14 m/s,
     so a camera solved before the settle would photograph the wall). */
  const solveCam = () => {
    const hs = (CBZ.hurricane && CBZ.hurricane.state) ? CBZ.hurricane.state() : null;
    let eye = null, look = null, note = "";
    if (cam.aim === "tripod") {
      /* THE TRIPOD: deterministic from arena constants so front and back wall
         beats (and both builds, and any --subjects subset) shoot from the SAME
         place. Stands in the town quarter, chest height, looking across the
         island so debris streams THROUGH frame either way. */
      /* The sightline is a CHORD north of the island center — the central
         refuge mountain (r 36 at the center) would otherwise fill the frame. */
      const tx = A.cx + 46, tz = A.cz + 40;
      eye = { x: tx, y: floorAt(tx, tz) + (cam.up != null ? cam.up : 2.3), z: tz };
      look = { x: A.cx - 44, y: floorAt(A.cx - 44, A.cz + 62) + 4, z: A.cz + 62 };
      const w = CBZ.hurricane && CBZ.hurricane.windAt ? CBZ.hurricane.windAt(tx, tz) : null;
      note = w && w.speed > 0.5
        ? `tripod · wind ${w.speed.toFixed(1)} @ (${w.x.toFixed(2)},${w.z.toFixed(2)})`
        : "tripod · one global wind (no field)";
    } else if (cam.aim === "eye" || cam.aim === "eyeup") {
      if (hs) {
        const gy = floorAt(hs.eyeX, hs.eyeZ);
        // crosswind unit vector: keeps the mountain (island center) out of the
        // near foreground and shows the wall side-on
        const px = -hs.fwdZ, pz = hs.fwdX;
        if (cam.aim === "eye") {
          eye = { x: hs.eyeX, y: gy + (cam.up != null ? cam.up : 2.0), z: hs.eyeZ };
          const lx = hs.eyeX + px * hs.rmw, lz = hs.eyeZ + pz * hs.rmw;
          look = { x: lx, y: floorAt(lx, lz) + 11, z: lz };
          note = `inside the eye · r=${hs.eyeR.toFixed(0)} m`;
        } else {
          eye = { x: hs.eyeX - px * hs.eyeR * 0.3, y: gy + 1.8, z: hs.eyeZ - pz * hs.eyeR * 0.3 };
          look = { x: hs.eyeX + px * hs.rmw * 0.9, y: gy + 56, z: hs.eyeZ + pz * hs.rmw * 0.9 };
          note = "the wall's rim from inside the calm";
        }
      } else {
        // the before build HAS no eye. Photograph the storm's middle and say so.
        eye = { x: A.cx + 26, y: floorAt(A.cx + 26, A.cz + 20) + 2.0, z: A.cz + 20 };
        look = { x: A.cx + 62, y: floorAt(A.cx + 26, A.cz + 20) + 10, z: A.cz + 48 };
        note = "NO EYE — this storm has no structure to stand inside";
      }
    } else if (cam.aim === "flood") {
      // the deepest flooded walkable ground THIS run: sample a coarse polar grid
      let best = null, bd = 0.05;
      for (let ri = 0.35; ri <= 1.0; ri += 0.13) {
        for (let ai = 0; ai < 20; ai++) {
          const a = (ai / 20) * Math.PI * 2;
          const x = A.cx + Math.cos(a) * A.radius * ri, z = A.cz + Math.sin(a) * A.radius * ri;
          const d = floodAt(x, z);
          if (d > bd) { bd = d; best = { x, z, d }; }
        }
      }
      if (best) {
        look = { x: best.x, y: floorAt(best.x, best.z) + best.d, z: best.z };
        /* HIGH DIAGONAL, SWUNG OFF THE RADIAL. A chest-height camera pushed
           straight out from the island center parks inside whatever building
           happens to stand on that radial (this preset's own pass 5 shot the
           inside of a wall for exactly that reason). From 20+ m up on a
           rotated bearing there is nothing to be inside of, and a flood
           reads best from above anyway — water against roofs and roads. */
        const ox = (best.x - A.cx), oz = (best.z - A.cz), ol = Math.hypot(ox, oz) || 1;
        const sw = 0.7, rx = (ox / ol) * Math.cos(sw) - (oz / ol) * Math.sin(sw),
          rz = (ox / ol) * Math.sin(sw) + (oz / ol) * Math.cos(sw);
        const back = cam.back != null ? Math.max(cam.back, 40) : 42;
        eye = { x: best.x + rx * back, y: look.y + Math.max(cam.up || 0, 20), z: best.z + rz * back };
        note = `deepest flood ${best.d.toFixed(2)} m · surge ${CBZ.waterSurge ? CBZ.waterSurge().toFixed(2) : "?"}`;
      } else {
        look = { x: A.cx, y: 0, z: A.cz + A.radius * 0.7 };
        eye = { x: A.cx, y: 26, z: A.cz + A.radius * 1.15 };
        note = `NO FLOOD ANYWHERE · surge ${CBZ.waterSurge ? CBZ.waterSurge().toFixed(2) : "?"}`;
      }
    } else if (cam.aim === "worst") {
      const frag = (arena && arena.fragile) || [];
      let b = null, bs = -1;
      for (const f of frag) { if (!f.fallen && (f._dmg || 0) > bs) { bs = f._dmg || 0; b = f; } }
      if (b) {
        look = { x: b.x, y: (b.gy || 0) + Math.min(12, b.h * 0.4), z: b.z };
        const ox = b.x - A.cx, oz = b.z - A.cz, ol = Math.hypot(ox, oz) || 1;
        // stand off the subject's own SIZE (quake-stages' guard): a fixed
        // distance is outside a shopfront and nose-against a tower
        const back = Math.max(cam.back || 30, Math.max(b.w, b.d) * 1.6 + b.h * 0.7 + 12);
        eye = { x: b.x + (ox / ol) * back, y: look.y + Math.max(cam.up || 16, b.h * 0.45), z: b.z + (oz / ol) * back };
        note = `worst standing building · dmg ${bs.toFixed(2)}`;
      } else {
        look = { x: A.cx, y: 4, z: A.cz };
        eye = { x: A.cx + 50, y: 26, z: A.cz + 40 };
        note = "no fragile records";
      }
    }
    if (!eye) { eye = { x: A.cx + 40, y: 20, z: A.cz + 40 }; look = { x: A.cx, y: 3, z: A.cz }; note = note || "fallback"; }
    // never stand inside the ground (quake-stages' guard)
    const g = floorAt(eye.x, eye.z);
    if (eye.y < g + 1.7) eye.y = g + 1.7;
    return { eye, look, note };
  };

  /* THE WEATHER SETTLE. Rain, fog and the sky are GLOBAL and driven each
     frame from the live camera's LOCAL conditions — that is the whole design
     (walk into the eye and the rain stops around you). So the shot camera has
     to BE the live camera for a second or two before the frame is honest:
     park it at the solved position (led by the storm's motion for the moving
     eye), sim ~1.4 s so the drive asserts and the rain cloud thins/thickens,
     then re-solve and shoot. Continuation frames of a pair skip this — their
     camera never moved. */
  let solved = solveCam();
  const isContinuation = act.atSecs == null && act.atFrac == null && act.force == null && act.untilState == null;
  if (!isContinuation) {
    /* The engine's camera controller re-follows the PLAYER every tick, so
       parking CBZ.camera would settle the weather around the wrong point:
       it is the player who has to stand where the shot stands. Lead the
       moving eye by the settle time so it arrives ON the player. */
    const hs0 = (CBZ.hurricane && CBZ.hurricane.state) ? CBZ.hurricane.state() : null;
    const lead = (cam.aim === "eye" || cam.aim === "eyeup") && hs0 ? hs0.fwdV * 2.0 : 0;
    const px = solved.eye.x + (hs0 ? hs0.fwdX * lead : 0);
    const pz = solved.eye.z + (hs0 ? hs0.fwdZ * lead : 0);
    if (CBZ.player && CBZ.player.pos) {
      CBZ.player.pos.x = px; CBZ.player.pos.z = pz;
      CBZ.player.pos.y = floorAt(px, pz) + 1.0;
      if (CBZ.player._phys) { CBZ.player._phys.kx = 0; CBZ.player._phys.kz = 0; }
    }
    step(2.0);
    solved = solveCam();
  }
  const { eye, look, note } = solved;

  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 58; camera.near = 0.4; camera.far = 20000;
  camera.position.set(eye.x, eye.y, eye.z);
  camera.lookAt(look.x, look.y, look.z);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(camera.position.x, 0, camera.position.z);
  }
  setHud(false);
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  const ha = (typeof CBZ.hurricaneAudit === "function") ? CBZ.hurricaneAudit() : {};
  const da = (typeof CBZ.disasterAudit === "function") ? CBZ.disasterAudit() : {};

  // arm the film-strip hooks for THIS subject: the camera to re-park after
  // each advance(), and the baseline the strip's feel metrics measure from
  S.lastCam = { eye, look };
  S.strip = (CBZ.player && CBZ.player.pos)
    ? { samples: [], p0x: CBZ.player.pos.x, p0z: CBZ.player.pos.z, kd0: Number(ha.knockdowns || 0) }
    : null;

  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector(`[data-${n}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:212px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:360px";
  q("focus").textContent =
    `${CBZ.disasters.current() || "—"} · ${CBZ.disasters.state()} · ${note}` +
    (ha.on ? ` · phase ${ha.phase}` : " · LEGACY WINDSTORM");
  q("focus").style.cssText = "position:absolute;top:250px;left:27px;color:#c0cfda;font-size:12px;font-weight:550;max-width:400px";
  q("perf").textContent =
    `wind@cam peak ${ha.camPeakWind || 0} · eye calm ${ha.eyeCalmMin != null && ha.eyeCalmMin >= 0 ? ha.eyeCalmMin : "—"}\n` +
    `reversed ${ha.windReversed ? "YES dot " + ha.reversalDot : "no"} · eye passed cam ${ha.eyePassedCam ? "YES" : "no"}\n` +
    `surge now ${ha.surgeNow || 0} m · peak ${ha.surgePeak || 0} m · drowned ${ha.drownings || 0}\n` +
    `debris strikes ${ha.debrisStrikes || 0} (${ha.debrisKills || 0} kills) · knockdowns ${ha.knockdowns || 0}\n` +
    `sim ${ticks} ticks · avg ${(ticks ? totalMs / ticks : 0).toFixed(1)}ms · worst ${maxMs.toFixed(0)}ms`;
  q("perf").style.cssText = `position:absolute;right:24px;top:24px;text-align:right;white-space:pre;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:${maxMs > 100 ? "#ff9c9c" : "#9fe8c3"}`;
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  // the legacy storm never fills hurricaneAudit, but its one global wind IS
  // the weather's wind — read that so the before column reports the gale it
  // actually blew instead of a zero nobody can compare against
  const v2live = !!(ha.camPeakWind > 0 || ha.surgePeak > 0);
  const legacyWind = Number(da.windSpeed || 0);
  /* Each metric is emitted only on the beats where it MEANS something —
     "wind in the eye" on a bands frame is a number about nothing, and a
     table full of those buries the rows that are evidence. */
  const eyeBeat = cam.aim === "eye" || cam.aim === "eyeup";
  const lateBeat = subject.id.startsWith("backwall") || subject.id === "tail" || eyeBeat;
  const metrics = {
    // the rolled Saffir-Simpson category and its sustained ceiling — the
    // before build predates the roll and honestly reports 0
    category: Number(ha.category || 0),
    stormVmax: Number(ha.vmax || 0),
    camPeakWind: v2live ? Number(ha.camPeakWind || 0) : legacyWind,
    // "wind on you during the eye" — if no eye ever reached the camera this
    // is the storm's own gale, so a structureless storm scores its full wind
    eyeCalm: eyeBeat
      ? (v2live
        ? Number(ha.eyeCalmMin != null && ha.eyeCalmMin >= 0 ? ha.eyeCalmMin : (ha.camPeakWind || 0))
        : legacyWind)
      : null,
    eyePassedCam: eyeBeat ? Number(ha.eyePassedCam || 0) : null,
    windReversed: lateBeat && !eyeBeat ? Number(ha.windReversed || 0) : null,
    reversalDot: lateBeat && !eyeBeat ? Number(ha.reversalDot != null ? ha.reversalDot : 1) : null,
    surgePeak: Number(ha.surgePeak || 0),
    drownings: Number(ha.drownings || 0),
    debrisStrikes: Number(ha.debrisStrikes || 0),
    debrisKills: Number(ha.debrisKills || 0),
    knockdowns: Number(ha.knockdowns || 0),
    structureHits: Number(da.structureHits || 0),
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
    ticksOver33: over33,
    drawCalls: Number(render.calls || 0),
  };

  return { ok: true, disaster: CBZ.disasters.current(), state: CBZ.disasters.state(), note, metrics };
}

export default {
  id: "hurricane-stages",
  title: "The Hurricane Gets Its Structure",
  description: "One seeded survival match per build, the director forced to the hurricane and stepped through the same structural moments. Before (the served --before build): the cyclone wearing a 96 m textured CYLINDER as its eyewall — the eye that looked like a building — every storm the same size, cars ignoring the wind. After: the wall is murk, not a mesh (the eye is a sudden calm with open sky, ringed by the distance the rain lets you see), every storm rolls a Saffir-Simpson category off the run seed (cat-1 is a bad wind you lean through; cat-5 takes roofs, floats streets and throws cars), gusts arrive as impulses the film strips photograph, and the strip metrics count the feel: wind on the player, gust variance, metres the wind physically shoved you.",
  beforeLabel: "BEFORE · MESH EYE, ONE SIZE",
  afterLabel: "AFTER · WIND ROOM",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  defaultBefore: "local",
  beforeParams: {},
  afterParams: {},
  stageTimeoutMs: 480000,
  metricsNote: "Strip metrics are sampled over exactly the photographed film-strip seconds: wind at the player each tick, the player’s net displacement (the wind is the only thing moving them), knockdowns during the strip. The rest come from CBZ.hurricaneAudit() (live evidence, not claims: eyePassedCam only fires if the camera felt real wind BEFORE the calm; windReversed dots two wind bearings sampled at the island center on either side of the eye) plus CBZ.disasterAudit(). eyeCalm is the wind on the camera during the eye — a storm with no eye scores its own peak gale there, which is the point.",
  metrics: {
    category: { label: "Saffir-Simpson category (rolled)", better: "higher" },
    stormVmax: { label: "Sustained wind ceiling", unit: "m/s", better: "higher" },
    stripWindMean: { label: "Strip: wind on player, mean", unit: "m/s", better: "higher" },
    stripWindPeak: { label: "Strip: wind on player, peak gust", unit: "m/s", better: "higher" },
    stripGustSd: { label: "Strip: gust variance (sd)", better: "higher" },
    stripPlayerDrift: { label: "Strip: player shoved", unit: "m", better: "higher" },
    stripKnockdowns: { label: "Strip: knockdowns while filming", better: "higher" },
    camPeakWind: { label: "Peak wind at camera", better: "higher" },
    eyeCalm: { label: "Wind in the eye (calm)", better: "lower" },
    eyePassedCam: { label: "Eye passed the camera", better: "higher" },
    windReversed: { label: "Wind reversed across eye", better: "higher" },
    reversalDot: { label: "Bearing dot front·back", better: "lower" },
    surgePeak: { label: "Storm surge peak", unit: "m", better: "higher" },
    drownings: { label: "Drowned in the surge", better: "higher" },
    debrisStrikes: { label: "Debris strikes on people", better: "higher" },
    debrisKills: { label: "Debris kills", better: "higher" },
    knockdowns: { label: "Bodies knocked flat", better: "higher" },
    structureHits: { label: "Structural ledger hits", better: "higher" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageHurricane,
};
