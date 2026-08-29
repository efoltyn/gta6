/* ============================================================
   city/view.js — the CITY view controller. First-person by DEFAULT
   (camera.js reads CBZ.cityCam), a [V] toggle to third-person, and the
   rig-visibility rule that fixes "seeing inside your own face": in
   first-person the whole player rig is hidden, so the camera never sits
   inside the head mesh. On death the camera flips to a third-person
   cinematic orbit (CBZ.cityCam.death, set by city/death.js).

   NEW: the [V] this file has refused mid-drive since it was written now
   does something when the thing you are driving is a CAR or a BOAT — see
   THE DRIVER'S SEAT below (a hull's eye comes off its registered helm
   station instead of a cabin frame). Aircraft keep their own owner
   (city/cockpit_view.js claims the key whenever P._aircraft is set, and
   returns immediately when it is not), so the two listeners can never both
   fire.

   Also owns THE CITY AT NIGHT pass: at dusk every storefront sign, neon
   trim, window band and lit interior gets ONE emissive lift (and ONE
   restore at dawn) — a flip on a threshold, never per-frame material
   churn. WHY: night is when money shows off — lit glass and neon are the
   skyline's scoreboard, so the rich blocks must visibly switch ON.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  // This file has never needed THREE and must not START needing it: the night
  // pass below runs in headless gallery builds. The seated-driver camera is
  // the only part that does, so it is the only part that checks.
  const THREE = window.THREE;

  // DEFAULT to third-person — the jail's SmoothDamp follow camera is the good
  // one, and camera.js runs that exact rig for the city when fp is off. [V]
  // toggles first-person.
  CBZ.cityCam = CBZ.cityCam || { fp: false, death: null };

  /* ONE PRESS IS ONE PRESS.
     A keydown dispatched on `document` BUBBLES to `window`, so a single [V]
     that reaches this window-level listener twice used to toggle the view on
     and straight back off — a toggle that looks, from outside, exactly like a
     feature that does not exist. (Measured: the vehicle-views probe fires the
     same press at both targets and reported key:V=0 while the very same view
     mounted fine through its API.) Real input has a keyup between presses and
     sets e.repeat when held, so latching on keyup — with a short wall-clock
     backstop for a keyup swallowed by a blur — costs a player nothing and
     makes the key honest for anything that synthesises input: a probe, a
     macro, an accessibility layer, a remapper. */
  let vLatch = 0;
  function vFreshPress() {
    const t = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    if (vLatch && t - vLatch < 250) return false;     // the same press, re-delivered
    vLatch = t;
    return true;
  }
  addEventListener("keyup", function (e) {
    if (e && e.key && e.key.toLowerCase() === "v") vLatch = 0;
  });

  addEventListener("keydown", function (e) {
    // read the live game record rather than the one captured at load: a boot
    // that REPLACES CBZ.game would otherwise leave this key wired to a corpse
    const G = CBZ.game || g;
    if (!G || G.mode !== "city" || G.state !== "playing") return;
    if (CBZ.cityMenuOpen) return;
    if (e.key && e.key.toLowerCase() === "v" && !e.repeat && vFreshPress()) {
      if (CBZ.player.driving) {
        // A CAR — AND NOW A BOAT — ANSWERS [V]. Aircraft do not reach here:
        // cockpit_view.js owns the key while P._aircraft is set. carFpToggle
        // still refuses anything without an eye to sit at (bikes, an
        // unregistered hull), so the old early return stays the outcome for
        // those.
        if (CBZ.player._aircraft) return;
        if (carFpToggle()) e.preventDefault();
        return;
      }
      e.preventDefault();
      // Use the JAIL's real first-person system (systems/fpsmode.js) — the good
      // one: eye height 2.05, head-bob, full-range pitch, weapon viewmodel. The
      // old custom city FP camera (cam.pitch, eye 1.66) felt broken.
      if (CBZ.toggleFPS) CBZ.toggleFPS();
      CBZ.city && CBZ.city.note((CBZ.fps && CBZ.fps.active) ? "First-person" : "Third-person", 1.0);
    }
  });

  /* ============================================================
     THE DRIVER'S SEAT — CAR_FP_VIEW

     OWNER: "in first person like person driving the car first person" — a POV
     driving video: two hands on the wheel, the cluster behind it, the centre
     screen, the dash, and the A-pillars framing the road.

     WHY THERE IS NO SECOND RENDER PASS. city/cockpit_view.js needs one because
     an aircraft's near plane is pushed out to 0.75 m at altitude and a real
     instrument panel sits at 0.71 m — INSIDE it. A car never leaves the
     ground, so city/mode.js leaves the near plane at 0.1 m, and everything in
     a cabin is 0.3 m or further from the eye. So this view is exactly what it
     looks like: the ordinary camera, moved into the driver's head, inside the
     real cabin city/playercars.js already builds. That means what you see IS
     the car — the same wheel other players see you holding, the same outfit on
     the same arms, lit by the same sun, deforming with the same crash — rather
     than a second cockpit authored to match and destined to drift out of sync.

     WHO WRITES THE CAMERA. systems/camera.js, and nothing else. It CALLS
     carFpPose() inside the branch it already owns for driving, so there is no
     second writer to race and no ordering to get wrong. This file does the
     maths and hands back numbers.

     HEAD PHYSICS. The car body already carries the eye through its terrain
     pitch, its weight-transfer roll and its jumps, because the pose composes
     onto the car's own world quaternion. What is added here is only what a
     BODY does that a bolted camera does not: you go back into the seat under
     power and forward against the belt on the brakes, your head leans into a
     corner, and the road comes up through the floor as a small rumble that
     scales with speed. Millimetres and centimetres — the same scale the
     cockpit's g-sink works at, and for the same reason.
  ============================================================ */
  // CAR_FP_VIEW — the seat itself. OFF → [V] mid-drive does nothing, exactly
  // as before this wave, and the chase camera is the only car view.
  if (CFG.CAR_FP_VIEW == null) CFG.CAR_FP_VIEW = true;
  // CAR_FP_DEFAULT — whether getting in a car drops you straight into the
  // seat. OFF, deliberately: the chase camera is the owner's tuned driving
  // view and must stay what you get unless you ask for the other one.
  if (CFG.CAR_FP_DEFAULT == null) CFG.CAR_FP_DEFAULT = false;
  // CAR_FP_HEAD — the accel push / corner lean / road rumble. OFF → the eye is
  // rigidly bolted to the cabin.
  if (CFG.CAR_FP_HEAD == null) CFG.CAR_FP_HEAD = true;
  // The seated FP lens. Wider than the 66° chase because an A-pillar and a
  // door mirror have to be in frame for the shot to read as "inside a car".
  if (CFG.CAR_FP_FOV == null) CFG.CAR_FP_FOV = 70;

  let fpWant = false, fpOn = false, fpCar = null, fpTold = false;
  const head = { z: 0, x: 0, roll: 0, buzz: 0, t: 0, lastV: 0, lastH: null };
  const _v = THREE ? new THREE.Vector3() : null;
  const _q = THREE ? new THREE.Quaternion() : null;
  const _q2 = THREE ? new THREE.Quaternion() : null;
  const _e = THREE ? new THREE.Euler() : null;
  const pose = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, fov: 74 };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fpOff() { return CFG.CAR_FP_VIEW === false; }

  /* THE HELM EYE — a boat's seat solve. A hull has no cabinFrame (cabinFrame
     refuses carStyle "boat" by design), but every registered hull carries a
     helm station on its own spec (water_hulls.js deriveSpec: authored
     flybridge / upper-deck bridge / aft-cockpit points where the ratios can't
     know, derived trawler proportions everywhere else). Null = a hull the
     registry doesn't know — those run road physics and get no seat. */
  function helmEye(car) {
    const S = car._hullSpec
      || (CBZ.marineHulls && CBZ.marineHulls.specFor ? CBZ.marineHulls.specFor(car) : null);
    return (S && S.helm) ? S.helm : null;
  }
  function isHull(car) { return !!(CBZ.isMarineHull && CBZ.isMarineHull(car)); }

  /* The vehicle you could sit in right now, or null. A bike has no cabin and
     an aircraft belongs to cockpit_view — both answer null. A CAR answers
     through the ONE cabin query in city/vehicles.js; a BOAT answers through
     its hull spec's helm station (the owner ask: first person at the wheel of
     the boat, not just the car). */
  function fpCarNow() {
    if (fpOff() || !THREE) return null;
    const P = CBZ.player;
    if (!P || !P.driving || P.dead || P._aircraft) return null;
    if (g.mode !== "city" || g.state !== "playing") return null;
    if (CBZ.cityCam && CBZ.cityCam.death) return null;
    const car = P._vehicle;
    if (!car || car.dead) return null;
    const feel = car._playerCarFeel;
    if (feel && (feel.air || feel.twoWheel)) return null;
    if ((feel && feel.marine) || isHull(car)) return helmEye(car) ? car : null;
    const ci = CBZ.carCabinInfo ? CBZ.carCabinInfo(car) : null;
    return (ci && ci.eye) ? car : null;
  }

  function resetHead() {
    head.z = head.x = head.roll = head.buzz = 0;
    head.t = 0; head.lastV = 0; head.lastH = null;
  }

  /* YOU SIT DOWN LOOKING AT THE ROAD.
     The head angle below is the DIFFERENCE between the free-look yaw and the
     nose, and city/vehicles.js only walks that yaw back behind the car once
     you are doing more than 3 units — so dropping into the seat from a
     standstill inherited whatever direction the mouse was last pointed and
     seated you staring at the door card. (First measured plate of this view:
     the camera was provably inside the cabin and the frame was a wall.)
     Taking the seat therefore re-aims the shared look state at the nose, once,
     which is the same thing playeraircraft.js's recenter does for a cockpit —
     after that every degree of free-look is the player's own. */
  function faceForward(car) {
    if (!CBZ.cam || !car) return;
    CBZ.cam.yaw = (car.heading || 0) + Math.PI;
    CBZ.cam.pitch = 0;
  }

  function carFpToggle() {
    const car = fpCarNow();
    if (!car) return false;
    fpWant = !fpOn;
    fpOn = fpWant;
    fpCar = fpOn ? car : null;
    resetHead();
    if (fpOn) faceForward(car);
    if (CBZ.city && CBZ.city.note) {
      CBZ.city.note(fpOn ? (isHull(car) ? "At the wheel" : "Driver's seat") : "Chase view", 1.0);
    }
    return true;
  }
  CBZ.carFpToggle = carFpToggle;
  CBZ.carFpActive = function () { return fpOn; };
  CBZ.carFpSetView = function (v) { fpWant = !!v; if (!v) { fpOn = false; fpCar = null; } return fpOn; };
  CBZ.carFpAudit = function () {
    return {
      fpFlag: CFG.CAR_FP_VIEW !== false,
      fpMounted: fpOn ? 1 : 0,
      fpWanted: fpWant ? 1 : 0,
      fpFov: fpOn ? +pose.fov.toFixed(1) : null,
    };
  };

  /* ---- the per-frame solve, called BY systems/camera.js -------------------
     Returns a plain record of numbers (never a live THREE object, so the
     caller cannot accidentally hold a reference into this file's scratch) or
     null, which means "you own the camera, draw the chase". */
  CBZ.carFpPose = function (fdt) {
    const car = fpCarNow();
    if (!car) { if (fpOn) { fpOn = false; fpCar = null; resetHead(); } return null; }
    const marine = isHull(car);
    if (!fpOn) {
      if (!fpWant && CFG.CAR_FP_DEFAULT !== true) {
        if (!fpTold && CBZ.city && CBZ.city.note) {
          fpTold = true;
          CBZ.city.note(marine ? "[V] the wheel view" : "[V] driver's seat", 1.6);
        }
        return null;
      }
      fpOn = true; resetHead(); faceForward(car);
    }
    if (fpCar !== car) { fpCar = car; resetHead(); faceForward(car); }
    const ci = marine ? null : (CBZ.carCabinInfo ? CBZ.carCabinInfo(car) : null);
    const eye = marine ? helmEye(car) : (ci && ci.eye);
    const grp = car.group;
    if (!eye || !grp || !grp.parent) { fpOn = false; return null; }
    // A hull's live attitude — heading, trim, heel, the wave seat water_
    // buoyancy composes — is all on the GROUP; carVisual carries the crash
    // deformation only cars have. So a boat's eye rides the group itself.
    const vis = marine ? grp : ((grp.userData && grp.userData.carVisual) || grp);
    const dt = clamp(fdt == null ? 0.016 : fdt, 0.0001, 0.1);

    // ---- head physics, in cabin-local metres ----------------------------
    if (CFG.CAR_FP_HEAD === false) {
      head.z = head.x = head.roll = head.buzz = 0;
    } else {
      head.t += dt;
      const v = car.v || 0, spd = Math.abs(v);
      // longitudinal: back into the seat on the throttle, forward on the brakes
      const accel = (spd - head.lastV) / dt;
      head.lastV = spd;
      head.z += (clamp(-accel * 0.0022, -0.045, 0.045) - head.z) * Math.min(1, dt * 6);
      // lateral: heading rate x speed IS the cornering acceleration, and a
      // head goes to the OUTSIDE of the corner while the eyes lead into it.
      let dh = car.heading - (head.lastH == null ? car.heading : head.lastH);
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      head.lastH = car.heading;
      const lat = clamp((dh / dt) * spd * 0.010, -0.05, 0.05);
      head.x += (lat - head.x) * Math.min(1, dt * 5);
      head.roll += (clamp(-lat * 1.6, -0.09, 0.09) - head.roll) * Math.min(1, dt * 5);
      // the road, coming up through the floor. Gone when you are stopped and
      // gone when you are airborne — a rumble mid-jump is a bug you can feel.
      const rum = car._airborne ? 0 : clamp((spd - 1.5) / 30, 0, 1);
      const amp = 0.0016 * rum + 0.0007;
      head.buzz = Math.sin(head.t * 41) * amp + Math.sin(head.t * 97) * amp * 0.4;
    }

    // ---- where the eye is, in the vehicle's own frame --------------------
    vis.updateWorldMatrix(true, false);
    _v.set(eye.x + head.x, eye.y + head.buzz, eye.z + head.z);
    _v.applyMatrix4(vis.matrixWorld);

    // ---- where it looks --------------------------------------------------
    // Free-look costs nothing new: city/vehicles.js already eases CBZ.cam.yaw
    // to (heading + PI) whenever you are moving and the recenter is not
    // suspended, so the head angle is simply the difference — look around the
    // cabin with the mouse and the existing recenter walks you forward again.
    let hy = 0, hp = 0;
    if (CBZ.cam) {
      const nose = (car.heading || 0) + Math.PI;
      let d = (CBZ.cam.yaw == null ? nose : CBZ.cam.yaw) - nose;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      hy = clamp(d, -2.30, 2.30);        // ~132° each way: you can check your blind spot
      // tighter than the cockpit's ±0.95: a seated driver cannot put his chin
      // on his chest, and a pitch that steep just aims the lens at the footwell
      // SIGN: hp is a three.js Euler X — UP-positive — but cam.pitch is
      // DOWN-positive (see the convention note in systems/camera.js beside
      // `const cam = {...}`). Reading it raw made the driver's head pitch the
      // wrong way against the mouse. The clamp stays in the UP-positive sense
      // it was authored in: -0.62 chin-down, 0.72 up.
      hp = clamp(-(CBZ.cam.pitch || 0), -0.62, 0.72);
    }
    // THE HALF TURN. A three.js camera looks down its own local -Z; the car's
    // +Z is the nose. Without the PI you are seated facing the back seats.
    _e.set(hp, hy + Math.PI, head.roll, "YXZ");
    _q2.setFromEuler(_e);
    grp.getWorldQuaternion(_q).multiply(_q2);

    // ---- FOV: a fitted optic always wins (the lock-on doctrine) ----------
    const scoped = CBZ.cityScopeFov ? CBZ.cityScopeFov() : (CBZ.fpsScopeFov ? CBZ.fpsScopeFov() : null);
    const wantFov = scoped != null ? scoped : (+CFG.CAR_FP_FOV || 74);
    pose.fov += (wantFov - pose.fov) * Math.min(1, dt * 8);
    if (Math.abs(pose.fov - wantFov) < 0.05) pose.fov = wantFov;

    pose.px = _v.x; pose.py = _v.y; pose.pz = _v.z;
    pose.qx = _q.x; pose.qy = _q.y; pose.qz = _q.z; pose.qw = _q.w;
    return pose;
  };

  // own the player rig's visibility every frame (after movement @10, before the
  // camera @50). Hidden in first-person (fpsmode shows a viewmodel instead);
  // shown for 3rd-person + the death replay. FP is force-dropped when you get in
  // a car or die so fpsmode never fights the driving / death cameras.
  CBZ.onAlways(49, function () {
    if (g.mode !== "city") return;
    // a scripted cinematic (city/cinematics.js) owns rig visibility for its
    // first-person shots — re-showing the body here put the player's own head
    // in front of the scene camera.
    if (CBZ.cineActive && CBZ.cineActive()) return;
    const cc = CBZ.cityCam, P = CBZ.player, ch = CBZ.playerChar;
    if (!ch || !ch.group) return;
    const fpsOn = !!(CBZ.fps && CBZ.fps.active);
    if (P.driving) { if (fpsOn && CBZ.setFPS) CBZ.setFPS(false); return; }       // car owns visibility
    // NOT DRIVING, so nothing may still be holding the rig in a seat. The
    // drive loop and cityExitVehicle both release, but a death, a teleport, a
    // mode change or a mid-session flag flip can all end a drive without going
    // through either — and a rig left folded at 0.6 scale with no head is the
    // worst possible failure mode. One idempotent call, on the frame that
    // already owns this rig's visibility.
    if (CBZ.carDriverSeated && CBZ.carDriverSeated()) CBZ.carDriverRelease();
    if ((cc && cc.death) || P.dead) { if (fpsOn && CBZ.setFPS) CBZ.setFPS(false); ch.group.visible = true; return; }
    ch.group.visible = !fpsOn;             // FP → hidden body (no face-clip)
  });

  // ===================================================================
  //  THE CITY AT NIGHT — dusk/dawn EMISSIVE FLIP for the built city.
  //  core/daynight.js publishes CBZ.nightAmount (0 day → 1 deep night);
  //  when it crosses dusk we lift the emissive intensity of every lit
  //  building material ONCE (shop signs, neon trim, awning bands, the
  //  shared window glass, interior light fixtures) and restore the day
  //  values at dawn. Billboards/ad panels are NOT touched here — they
  //  already ride props.js's _nightAds ramp (m._ad guard below); shared
  //  cross-mode cmat() materials (m._shared) are skipped so the jail
  //  never inherits the city's night look. Collection is one traversal
  //  of the building groups, done lazily on the FIRST dusk.
  // ===================================================================
  let nightMats = null, nightOn = false, lastArena = null;
  function collectNightMats(A) {
    const set = new Set();
    const lots = (A.lots || []).slice();
    if (A.annex && A.annex.lots) lots.push.apply(lots, A.annex.lots);
    for (const lot of lots) {
      const b = lot.building;
      if (!b || !b.group) continue;
      b.group.traverse(function (o) {
        const m = o.material;
        if (!m || !m.emissive || m._ad || m._shared) return;
        if (m.emissiveIntensity > 0.05 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.02) {
          if (m._dayEi == null) m._dayEi = m.emissiveIntensity;   // remember the day look once
          set.add(m);
        }
      });
    }
    return set;
  }
  CBZ.onAlways(48, function () {
    const A = CBZ.city && CBZ.city.arena;
    if (g.mode !== "city" || !A) {
      // leaving the city un-flips, so no material carries night elsewhere
      if (nightOn && nightMats) { for (const m of nightMats) m.emissiveIntensity = m._dayEi; nightOn = false; }
      return;
    }
    if (A !== lastArena) { lastArena = A; nightMats = null; nightOn = false; }   // fresh build → recollect
    const n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    const want = nightOn ? n > 0.45 : n > 0.6;     // hysteresis — no thrash at the threshold
    if (want === nightOn) return;
    if (!nightMats) nightMats = collectNightMats(A);
    // windows go from "tinted" to LIT, neon goes hot; capped so nothing blows out
    for (const m of nightMats) m.emissiveIntensity = want ? Math.min(1.45, m._dayEi + 0.5) : m._dayEi;
    nightOn = want;
  });
})();
