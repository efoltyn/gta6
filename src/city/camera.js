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
     owner tunes the whole on-foot feel in one place. */
  CBZ.CITY_TP = {
    HEIGHT: 1.42,      // rig pivot above feet — shoulder height, not overhead (was 1.82): camera rides level with the character, the street reads at eye level
    DIST: 4.3,         // behind-the-back distance (was 7.6) — close enough to feel attached, far enough to read the body; scroll wheel still scales around this
    DIST_AIM: 2.9,     // armed/aiming distance — tighter than unarmed so raising a gun visibly punches IN (keeps the old aim-tightens contract)
    SIDE: 0.7,         // camera lateral offset to the player's RIGHT — character sits left-of-center, you see past their right shoulder down the street
    SIDE_AIM: 1.0,     // harder over-shoulder when armed — clear sightline past the head
    PITCH: 0.04,       // default orbit pitch on city entry — near-level (was 0.46 looking down): horizon sits high in frame, more world, less pavement
    LOOK_Y: 1.45,      // look-target height above feet — chest/shoulder aim point; with the near-level pitch this gives a subtle down-gaze, not a top-down stare
    LEAD: 4.6,         // forward look-ahead (was 3.6) — a touch more breathing room down-street
    DAMP_POS: 0.16,    // position SmoothDamp time (was 0.085) — the lazy settle; bigger = floatier follow
    DAMP_YAW: 9.0,     // yaw chase rate (1-exp(-k*dt)) — the camera trails your mouse turn slightly instead of rigid-locking; bigger = stiffer
    DAMP_YAW_AIM: 26,  // yaw chase while armed — near-rigid so aiming never feels mushy
    FOV: 57,           // base FOV (was 61) — narrower lens = more cinematic compression; speed kick still widens it
    FOV_AIM: 55,       // armed FOV — a hair tighter than the old 58
  };

  CBZ.cityCam = CBZ.cityCam || { fp: false, death: null };
  // claim the exterior-deathcam hook so death.js's fallback stays dormant
  if (CBZ.cityCam._extHookInstalled) return;
  CBZ.cityCam._extHookInstalled = true;

  const camera = CBZ.camera;
  const _ro = new THREE.Vector3(), _rd = new THREE.Vector3();
  const _eye = new THREE.Vector3(), _look = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const lerp = (a, b, t) => a + (b - a) * t;

  // pull a desired camera point back toward the pivot until it clears any solid
  // (LOS meshes + swept collider span) — so the exterior shot never sits inside
  // a wall. ox/oy/oz = pivot (the blast/body), px/py/pz = wanted cam point.
  function unclip(ox, oy, oz, px, py, pz) {
    _ro.set(ox, oy, oz);
    _rd.set(px - ox, py - oy, pz - oz);
    let d = _rd.length();
    if (d < 0.001) return null;
    _rd.multiplyScalar(1 / d);
    let best = d;
    ray.set(_ro, _rd); ray.far = d;
    const blk = CBZ.losBlockers;
    if (blk && blk.length) {
      const hit = ray.intersectObjects(blk, false);
      if (hit.length && hit[0].distance < best) best = hit[0].distance;
    }
    // swept-AABB against solid colliders (walls without an LOS flag)
    const rad = 0.34, cs = CBZ.colliders;
    if (cs) {
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i]; if (c.noCam) continue;
        const minX = c.minX - rad, maxX = c.maxX + rad, minZ = c.minZ - rad, maxZ = c.maxZ + rad;
        const minY = (c.y0 != null ? c.y0 : -1e4) - rad, maxY = (c.y1 != null ? c.y1 : 1e4) + rad;
        let t0 = 0, t1 = best, ta, tb, tmp;
        const dx = _rd.x, dy = _rd.y, dz = _rd.z;
        if (dx > -1e-8 && dx < 1e-8) { if (ox < minX || ox > maxX) continue; }
        else { ta = (minX - ox) / dx; tb = (maxX - ox) / dx; if (ta > tb) { tmp = ta; ta = tb; tb = tmp; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
        if (dy > -1e-8 && dy < 1e-8) { if (oy < minY || oy > maxY) continue; }
        else { ta = (minY - oy) / dy; tb = (maxY - oy) / dy; if (ta > tb) { tmp = ta; ta = tb; tb = tmp; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
        if (dz > -1e-8 && dz < 1e-8) { if (oz < minZ || oz > maxZ) continue; }
        else { ta = (minZ - oz) / dz; tb = (maxZ - oz) / dz; if (ta > tb) { tmp = ta; ta = tb; tb = tmp; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
        if (t0 > 0.001 && t0 < best) best = t0;
      }
    }
    if (best < d) {
      const dd = Math.max(2.0, best - 0.4);   // keep a little standoff off the wall
      _eye.set(ox + _rd.x * dd, oy + _rd.y * dd, oz + _rd.z * dd);
      return _eye;
    }
    _eye.set(px, py, pz);
    return _eye;
  }

  // Honor a cinematic exterior death pose, blended in then held, then released.
  // The pose object (cc.death.ext) is authored by death.js:
  //   { px,py,pz (cam point), lx,ly,lz (look pivot/blast),
  //     ox,oy,oz (un-clip pivot), t, dur, fov }
  function honorExterior(dt) {
    const cc = CBZ.cityCam;
    if (!cc || !cc.death || !cc.death.ext) return false;
    const ex = cc.death.ext;
    ex.t = (ex.t || 0) + dt;
    if (ex.t >= ex.dur) { cc.death.ext = null; return false; }   // hand back to the orbit

    // un-clip the authored cam point against the world so we never sit in a wall
    const clamped = unclip(ex.ox, ex.oy, ex.oz, ex.px, ex.py, ex.pz);
    let cx = ex.px, cy = ex.py, cz = ex.pz;
    if (clamped) { cx = clamped.x; cy = clamped.y; cz = clamped.z; }
    cy = Math.max(cy, 0.9);

    // a gentle settle-in: ease from wherever the camera was toward the pose over
    // the first ~0.45s, then a slow creeping dolly so the shot has life.
    const k = easeOut(Math.min(1, ex.t / 0.45));
    const creep = Math.min(1, ex.t / ex.dur) * 0.6;       // slow push-in over the hold
    _eye.set(
      lerp(cx, ex.ox, creep * 0.06) ,
      cy,
      lerp(cz, ex.oz, creep * 0.06)
    );
    // first frame: snap our blend origin to the live camera so there's no pop
    if (ex._bx == null) { ex._bx = camera.position.x; ex._by = camera.position.y; ex._bz = camera.position.z; }
    camera.position.set(
      lerp(ex._bx, _eye.x, k),
      lerp(ex._by, _eye.y, k),
      lerp(ex._bz, _eye.z, k)
    );
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
  //   bx,bz  blast origin (x,z)          — what we frame & look back at
  //   px,pz  player/body position (x,z)
  //   by     blast height (optional)
  //   dur    hold seconds (default 1.4)
  // Picks an exterior cam point on the open street side away from the building
  // interior, low and street-level, looking back at the blast.
  CBZ.cityCam.beginExteriorDeathCam = function (opts) {
    const cc = CBZ.cityCam;
    if (!cc || !cc.death) return;
    opts = opts || {};
    const bx = opts.bx != null ? opts.bx : (opts.px || 0);
    const bz = opts.bz != null ? opts.bz : (opts.pz || 0);
    const px = opts.px != null ? opts.px : bx;
    const pz = opts.pz != null ? opts.pz : bz;
    const by = opts.by != null ? opts.by : 1.4;

    // outward direction = from the building interior toward the open street.
    // Use the nearest lot's door normal if we can resolve it (points outside);
    // otherwise push away from the city centre.
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

    // stand the camera out on the street, a touch to the side for a 3/4 angle,
    // street-level and slightly low so the building looms over the blast.
    const out = 13.5, side = 5.5, height = 3.4;
    const sx = -nz, sz = nx;                 // perpendicular (the street tangent)
    let camX = bx + nx * out + sx * side;
    let camZ = bz + nz * out + sz * side;

    const ext = {
      px: camX, py: height, pz: camZ,
      lx: bx, ly: by + 1.2, lz: bz,          // look at the blast, a hair above it
      ox: bx, oy: by + 1.0, oz: bz,          // un-clip pivot = the blast core
      t: 0, dur: opts.dur != null ? opts.dur : 1.4, fov: 44,
      _bx: null,
    };
    cc.death.ext = ext;
    // make the underlying orbit start framed from roughly this side so the
    // hand-off after the beat isn't a hard jump.
    cc.death.ang0 = Math.atan2(camZ - bz, camX - bx);
  };

  // best-effort: which lot contains (or is nearest to) a world point.
  function resolveLot(x, z) {
    if (CBZ.cityGangOf) { /* gangs don't carry door normals; fall through to lots */ }
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

  // POST-camera override: systems/camera.js positions the camera at onAlways(50)
  // for the death orbit; we run at 51 and, only during the exterior beat, take
  // it over. Outside the beat we do nothing (the stock orbit shows through).
  let _wasCity = false;
  CBZ.onAlways(51, function (dt) {
    const inCity = g.mode === "city";
    // on city ENTRY, settle the orbit pitch to the RDR2 default (near-level,
    // horizon high) — once, so the player's own pitch input is never fought.
    if (inCity && !_wasCity && CBZ.cam) CBZ.cam.pitch = CBZ.CITY_TP.PITCH;
    _wasCity = inCity;
    if (!inCity) return;
    honorExterior(dt);
  });
})();
