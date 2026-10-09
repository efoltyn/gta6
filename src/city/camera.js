/* ============================================================
   city/camera.js — CINEMATIC EXTERIOR DEATH CAM.

   When the player is killed by an EXPLOSION while INSIDE a building, the
   WASTED sequence first cuts to a dramatic EXTERIOR, street-level camera
   that pulls OUTSIDE to the nearest open street and looks BACK at the
   building + the blast — holds a beat — then hands off to the normal
   death orbit (and the existing fade-to-WASTED). For non-explosion or
   outdoor deaths nothing here fires and the stock camera behaviour stays.

   The stock third-person rig lives in systems/camera.js and runs the
   death ORBIT off CBZ.cityCam.death every frame at onAlways(50). This
   module does NOT touch that file: it registers a POST-camera override at
   onAlways(51) that, only while a cinematic exterior beat is live
   (cc.death.ext), repositions the shared camera to the exterior pose and
   then releases cleanly. death.js owns the trigger + the pose math; this
   file owns honoring/blending it without clipping into walls.

   Cheap by construction: one reused Raycaster + a few scratch vectors, no
   per-frame allocations, only active during the ~1.4s death beat.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;
  const THREE = window.THREE;

  /* ---- CITY THIRD-PERSON FRAMING (RDR2 feel) — taste-tune HERE ----
     Consumed every frame by systems/camera.js (its generic third-person path
     reads CBZ.CITY_TP when mode==="city" and you're on foot). One block so the
     owner tunes the whole on-foot feel in one place.
     NOTE: systems/camera.js carries a guarded fallback copy of this object
     (it loads FIRST). THIS file loads later and is the authoritative tuning
     surface — edit HERE, never the fallback, or your change is overwritten. */
  CBZ.CITY_TP = {
    // FORTNITE reference (owner-supplied screenshots, 2026-07-05): NOT armed
    // = the wide default frame — camera ~4m back, a SUBTLE right offset (the
    // character reads just left of centre, not pinned to the edge), slightly
    // above the head with a mild down-gaze, character ~half the frame tall.
    HEIGHT: 1.7,       // rig pivot above feet — a touch above the head so the street reads ahead
    DIST: 4.35,        // three-pivot follow boom: readable body without crowding the weapon
    SIDE: 0.68,        // explicit right-shoulder offset
    PITCH: 0.10,       // default orbit pitch on city entry — mild down-gaze, horizon high
    LOOK_Y: 1.52,      // look-target height above feet — with the mild pitch this centres the char vertically
    LEAD: 4.6,         // forward look-ahead — breathing room down-street
    DAMP_POS: 0.18,    // position SmoothDamp time — the lazy settle; bigger = floatier follow
    DAMP_YAW: 9.0,     // yaw chase rate (1-exp(-k*dt)) — the camera trails your mouse turn slightly
    DAMP_YAW_AIM: 26,  // yaw chase while PRESENTING (RMB/ADS, firing, or the ~0.9s post-shot settle — CBZ.tpPresenting) — near-rigid so aiming never feels mushy
    FOV: 60,           // base FOV

    // ================= THE ARMED TIERS (CAM_TP_GUN_VISIBLE) =================
    // Owner, 2026-08-20, with a third-person shooter clip: "in our third person
    // when holding gun you can't see the gun — fix the angle so we can see the
    // gun better when shooting." He is right, and it was measurable: with the
    // shipped framing, ZERO percent of the drawn weapon's barrel reached the
    // lens while firing (tools/tp-gun-view-check.mjs, which walks the bore in
    // screen space and ray-tests each point against the player's own body).
    // The gun spent the whole gunfight behind its owner's shoulder.
    //
    // What actually moves that number, in order (all measured, not guessed —
    // `--sweep` walks the grid and prints it):
    //   1. THE AIM LEAD, by a mile. It is spent in systems/camera.js, not here,
    //      but it is why these constants look the way they do: leading the look
    //      target 12 m down-range grows the pure orbit's derived FRAME_TILT to
    //      ~0.17 rad, which drops the character low in frame and silhouettes
    //      the weapon against what it is aimed at. ADS always had it; firing
    //      did not. 0% → 78%.
    //   2. THE SHOULDER OFFSET, which pays MUCH better than it used to, and the
    //      reason is worth writing down. 0.68 m at a 4.35 m boom is 9° of frame:
    //      the sight line to a gun ~0.25 m right of centre and ~0.6 m forward
    //      crosses the body plane 3 cm outside a torso that is 25 cm wide, i.e.
    //      inside the firing arm. It used to stop paying past ~1.1 m, because
    //      the barrel was locked parallel to the LENS while presenting — move
    //      the lens sideways and the gun swings with it, staying pointed into
    //      the screen. Now that the barrel follows the AIM instead (the fix in
    //      systems/holsterprops.js), moving the lens sideways buys real
    //      parallax: measured 62% / 77% / 85% of the barrel at 1.0 / 1.3 / 1.6 m
    //      of offset, monotone, with the on-screen length going 6% → 14% of the
    //      frame. 1.50 is that curve minus a safety margin for the collision
    //      clamp in a tight street.
    //   3. THE BOOM, last and least — worth about a third of what the offset is
    //      worth, and every metre of it costs readability of the street.
    //
    // Three tiers, picked per frame by CBZ.tpArmTier():
    //   CARRY   gun out, walking — and this one is a NEGATIVE result, kept
    //           because it cost four measured runs to learn. Tightening the
    //           carry frame the way the present frame wants makes the carried
    //           weapon LESS visible, not more: a 1.1 m rifle from a hand 0.85 m
    //           off the ground is stood near-vertical by the muzzle-clearance
    //           solver (systems/holsterprops.js), so it hangs flat against the
    //           thigh — and every centimetre the lens moves toward that side
    //           puts more hip in front of it. 0.68 m/4.35 m measures 54% of the
    //           barrel; 1.12 m/2.85 m measures 0%. And it is a knife edge: the
    //           barrel hangs exactly along the leg's silhouette, so the gate
    //           reports 54% and 0% for the SAME constants in the same run,
    //           depending only on where the idle breath has the arm. A tier that
    //           can only make it worse should not move it at all, so CARRY ships
    //           byte-identical to the relaxed frame. Making a CARRIED long gun read
    //           needs the hand at chest height (port arms), which is a pose
    //           change, not a camera change, and is not what was asked for here.
    //   PRESENT trigger down / firing / the ~0.9 s post-shot settle. The ADS
    //           frame at the hip-fire lens: same offset and pivot, a slightly
    //           longer boom, and the same 12 m lead. This is the tier the
    //           owner's reference shot is of, and the one this pass exists for.
    //   ADS     RMB. Unchanged from what shipped — it was already the one armed
    //           frame you could see the gun in, and this pass must not spend
    //           that. Only the lens (FOV_AIM) is still ADS-only.
    // Each is a FIXED target; no wheel zoom, no speed zoom. Holster and you are
    // back on DIST/SIDE above, untouched.
    DIST_CARRY:   4.35, DIST_PRESENT:   2.20, DIST_ADS:   2.65,  // boom (CARRY === DIST above, deliberately)
    SIDE_CARRY:   0.68, SIDE_PRESENT:   1.50, SIDE_ADS:   1.12,  // right-shoulder offset (CARRY === SIDE)
    HEIGHT_CARRY: 1.70, HEIGHT_PRESENT: 1.55, HEIGHT_ADS: 1.58,  // rig pivot above the feet (CARRY === HEIGHT)

    // ---- LEGACY armed tier (CAM_TP_GUN_VISIBLE = false) ----
    // The pre-2026-08-20 framing, kept as the one-line revert: armed-at-rest was
    // byte-identical to the relaxed chase and only ADS moved the camera or led
    // the look target.
    DIST_AIM_BASE: 4.35, DIST_AIM_ADS: 2.65,
    SIDE_AIM_BASE: 0.68, SIDE_AIM_ADS: 1.12,
    FOV_AIM_BASE: 60,    FOV_AIM_ADS: 50,     // armed = default lens; RMB = moderate zoom toward the aim
    HEIGHT_AIM_BASE: 1.7, HEIGHT_AIM_ADS: 1.58,

    // PITCH_LOOK: how strongly the armed 3PS LOOK target follows the player's
    // pitch (systems/camera.js drops/raises the look point by this * camDist).
    // WHY (FIX 1 root cause): the old TP look target was pitch-BLIND (fixed
    // LOOK_Y, flat forward) while the camera's orbit height used sin(pitch)*dist —
    // so pitching up ballooned the camera UP and tilted the view top-down, and you
    // could not aim vertically in 3PS.
    PITCH_LOOK: 1.0,

    // ---- the tier switch. One helper (CBZ.tpArmTier, systems/camera.js) picks
    // 0/1/2; these getters are what systems/camera.js reads every frame. ----
    _gv() { return CBZ.CONFIG.CAM_TP_GUN_VISIBLE !== false; },
    _tier() { return CBZ.tpArmTier ? CBZ.tpArmTier() : ((CBZ.isADS && CBZ.isADS()) ? 2 : 0); },
    get DIST_AIM()   { const t = this._tier(); return this._gv() ? [this.DIST_CARRY, this.DIST_PRESENT, this.DIST_ADS][t]          : (t === 2 ? this.DIST_AIM_ADS   : this.DIST_AIM_BASE); },
    get SIDE_AIM()   { const t = this._tier(); return this._gv() ? [this.SIDE_CARRY, this.SIDE_PRESENT, this.SIDE_ADS][t]          : (t === 2 ? this.SIDE_AIM_ADS   : this.SIDE_AIM_BASE); },
    get HEIGHT_AIM() { const t = this._tier(); return this._gv() ? [this.HEIGHT_CARRY, this.HEIGHT_PRESENT, this.HEIGHT_ADS][t]    : (t === 2 ? this.HEIGHT_AIM_ADS : this.HEIGHT_AIM_BASE); },
    get FOV_AIM()    { return (CBZ.isADS && CBZ.isADS()) ? this.FOV_AIM_ADS : this.FOV_AIM_BASE; },
  };


  CBZ.cityCam = CBZ.cityCam || { fp: false, death: null };
  const camera = CBZ.camera;
  const _eye = new THREE.Vector3(), _look = new THREE.Vector3();
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const lerp = (a, b, t) => a + (b - a) * t;

  // Pull a wanted camera point back toward the pivot until it clears every
  // solid (systems/camera.js's CBZ.camClearDist: the LOS meshes + the swept
  // collider grid the boom uses). The old copy here slab-tested all ~82k city
  // colliders per frame and refused to come closer than 2 m, which parked the
  // lens inside the wall whenever the gap was smaller than that.
  function unclip(ox, oy, oz, px, py, pz) {
    const dx = px - ox, dy = py - oy, dz = pz - oz;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.001) return null;
    const free = CBZ.camClearDist ? CBZ.camClearDist(ox, oy, oz, px, py, pz, 0.34) : d;
    const dd = free < d ? Math.max(0.6, free - 0.3) : d;
    const k = dd / d;
    _eye.set(ox + dx * k, oy + dy * k, oz + dz * k);
    return _eye;
  }

  // Honor a cinematic exterior death pose, blended in then held, then released.
  // The pose object (cc.death.ext) is authored by beginExteriorDeathCam below:
  //   { px,py,pz (cam point), lx,ly,lz (look pivot/blast),
  //     ox,oy,oz (un-clip pivot), t, dur, fov }
  function honorExterior(dt) {
    const cc = CBZ.cityCam;
    if (!cc || !cc.death || !cc.death.ext) return false;
    const ex = cc.death.ext;
    ex.t = (ex.t || 0) + dt;
    if (ex.t >= ex.dur) { cc.death.ext = null; return false; }   // hand back to the orbit
    const clamped = unclip(ex.ox, ex.oy, ex.oz, ex.px, ex.py, ex.pz);
    let cx = ex.px, cy = ex.py, cz = ex.pz;
    if (clamped) { cx = clamped.x; cy = clamped.y; cz = clamped.z; }
    cy = Math.max(cy, 0.9);
    // a gentle settle-in from wherever the camera was, then a slow creep
    const k = easeOut(Math.min(1, ex.t / 0.45));
    const creep = Math.min(1, ex.t / ex.dur) * 0.6;
    _eye.set(lerp(cx, ex.ox, creep * 0.06), cy, lerp(cz, ex.oz, creep * 0.06));
    if (ex._bx == null) { ex._bx = camera.position.x; ex._by = camera.position.y; ex._bz = camera.position.z; }
    camera.position.set(lerp(ex._bx, _eye.x, k), lerp(ex._by, _eye.y, k), lerp(ex._bz, _eye.z, k));
    // the blend passes through space the pose was not checked for: guard it too
    if (CBZ.camPullback) CBZ.camPullback(ex.ox, ex.oy, ex.oz, camera.position);
    _look.set(ex.lx, ex.ly, ex.lz);
    camera.lookAt(_look);
    const wantFov = ex.fov || 46;
    if (Math.abs(camera.fov - wantFov) > 0.02) {
      camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 4.5);
      camera.updateProjectionMatrix();
    }
    return true;
  }

  // PUBLIC: death.js calls this to author + arm the exterior shot. opts:
  //   bx,bz  blast origin (x,z), px,pz body (x,z), by blast height, dur hold s
  CBZ.cityCam.beginExteriorDeathCam = function (opts) {
    const cc = CBZ.cityCam;
    if (!cc || !cc.death) return;
    opts = opts || {};
    const bx = opts.bx != null ? opts.bx : (opts.px || 0);
    const bz = opts.bz != null ? opts.bz : (opts.pz || 0);
    const px = opts.px != null ? opts.px : bx;
    const pz = opts.pz != null ? opts.pz : bz;
    const by = opts.by != null ? opts.by : 1.4;
    // outward = from the building toward the street: the door normal if we can
    // resolve the lot, else away from the city centre
    let nx = 0, nz = 0;
    const lot = resolveLot(px, pz);
    if (lot && lot.building && lot.building.door && lot.building.door.nx != null) {
      nx = lot.building.door.nx; nz = lot.building.door.nz;
    }
    if (nx === 0 && nz === 0) {
      const A = CBZ.city && CBZ.city.arena;
      const ccx = (A && A.cx != null) ? A.cx : 0, ccz = (A && A.cz != null) ? A.cz : 0;
      nx = px - ccx; nz = pz - ccz;
      const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    }
    const out = 13.5, side = 5.5, height = 3.4;
    const sx = -nz, sz = nx;
    const camX = bx + nx * out + sx * side;
    const camZ = bz + nz * out + sz * side;
    cc.death.ext = {
      px: camX, py: height, pz: camZ,
      lx: bx, ly: by + 1.2, lz: bz,
      ox: bx, oy: by + 1.0, oz: bz,
      t: 0, dur: opts.dur != null ? opts.dur : 1.4, fov: 44,
      _bx: null,
    };
    // the orbit after the beat prefers to start from this side
    cc.death.ang0 = Math.atan2(camZ - bz, camX - bx);
  };

  function resolveLot(x, z) {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.lots) return null;
    let best = null, bestD = 1e9;
    for (let i = 0; i < A.lots.length; i++) {
      const l = A.lots[i];
      if (!l || !l.building) continue;
      const hw = (l.w || 8) / 2 + 1.5, hd = (l.d || 8) / 2 + 1.5;
      if (Math.abs(x - l.cx) <= hw && Math.abs(z - l.cz) <= hd) return l;
      const dx = x - l.cx, dz = z - l.cz, d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = l; }
    }
    return bestD < 36 * 36 ? best : null;
  }

  // POST-camera override: systems/camera.js runs the death orbit at onAlways(50);
  // this runs at 51 and takes over only during the exterior beat.
  CBZ.onAlways(51, function (dt) {
    if (g.mode !== "city") return;
    honorExterior(dt);
  });
})();
