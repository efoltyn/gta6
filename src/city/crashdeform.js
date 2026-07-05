/* ============================================================
   city/crashdeform.js — REAL crash deformation: clamped radial vertex
   displacement in car-local space (the cheap GTA-era technique that ships).

   Every unified car's static panels are already baked into PER-CAR merged
   BufferGeometries (vehicles.js mergeStaticCarParts), so caving a fender in
   is a one-off loop over a few thousand floats AT IMPACT TIME — zero steady
   frame cost. WHY: the getaway car is the player's trophy. A nose that stays
   cratered after the wall, headlights that die for the night drive, a hood
   fluttering over the windshield until it tears off — that's the crash
   receipt you show off, same as rubber on the asphalt.

   Contracts honoured:
     • LAZY rest-position snapshot on a car's FIRST damage. SHARED geometry
       (box rigs, [C]-cycle template clones) is cloned+swapped and the
       pristine shared geo put back on reset — never displaced in place.
     • Displacement ACCUMULATES but is clamped per-vertex against a budget
       from rest: ~0.34u on outer panels, ~0.12u in the cabin band, so
       pillars/roof crumple less than fenders and the hull can never turn
       inside out.
     • LRU cap on concurrently-deformed cars (rides the LIVE quality tier,
       ~7..28) — the least-recently-hit one is silently restored to pristine
       when one past the cap takes damage.
     • Consequences past thresholds: headlights smashed dark (material
       pointer swap, pooled like the brake lights), hood hangs + sin-jitters
       while driving then detaches as debris (crashfx chunk pool), struck-side
       door sags open, a dropped bumper drags sparks, glasshouse frosts over,
       and one engine-damage nudge at heavy cumulative deformation.
     • Headless harness: any stub-renderer throw flips a dead flag and the
       whole module no-ops (the skidDead convention).
     • DIRECTIONAL crumple: impact() now reads the car's own closing-velocity
       vector (car.vx/car.vz, falling back to heading*v) off the SAME record
       every call site already passes, blends it with the supplied impact dir,
       and stretches the crater's footprint along that travel axis — a T-bone
       digs a long gouge down the side, a square head-on caves the whole nose,
       not a radially-symmetric dimple either way.
     • Determinism: every random draw in this file (hood/door/bumper spring
       angles+phase, bumper-tilt sign, spark timing) runs off a local seeded
       LCG — NEVER Math.random() — so replay/multiplayer-sync stays bit-exact.
     • Eviction/fade: the LRU cap no longer silently pristine-snaps the oldest
       car the instant a 15th is damaged. evict() now prefers the entry that
       is FARTHEST from the camera (or fully off-screen) over the merely
       oldest, and the chosen car's panel craters/flaps FADE back to pristine
       over ~0.5s (vertex lerp + flap opacity-less swap timed to the same
       window) instead of popping in one frame.
     • Consequence ladder additions: a popped/leaning WHEEL state at high
       front/rear cumulative damage (the wheel tilts + sinks — cheap transform,
       no new geometry), and a non-uniform chassis-bend skew applied to the
       car's own visual root at very high cumulative damage (total>=3.2) so a
       totalled wreck reads as a bent hulk, not just a dented one.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  // ---- deterministic seeded LCG (NEVER Math.random() — replay/MP sync) ------
  let _rs = 24631;
  function rng() { _rs = (_rs * 1103515245 + 12345) & 0x7fffffff; return _rs / 0x7fffffff; }

  // concurrently-deformed cars (LRU) — rides the LIVE quality tier
  // (pause-menu slider): ~7 at tier 0 up to ~28 at tier 4 (mid-tier ≈ the
  // old 14). Read at use time — never snapshot the tier.
  function MAX_CARS() { return CBZ.qScale ? CBZ.qScale(7, 28) : 14; }
  const OUTER_BUDGET = 0.34, CABIN_BUDGET = 0.12;
  const DIMS_FALLBACK = { width: 2, length: 4.4, height: 1.5 };
  const FADE_T = 0.5;           // eviction fade-to-pristine window, seconds
  const damaged = [];          // LRU registry, oldest first; entries move to the tail when re-hit
  let dead = false;            // stub renderer / missing API → permanent no-op

  // scratch (no per-impact allocation beyond the one-time rest snapshots)
  let _inv = null, _pt = null, _dir = null, _gInv = null, _gp = null, _wp = null, _wq = null;
  let _fwd = null, _vel = null;   // eviction off-screen test + directional-crumple scratch
  let flapGeo = null, flapFallbackMat = null, bumperMat = null;
  const deadHeadMats = new Map();   // live headlight material -> smashed-dark counterpart
  const frostMats = new Map();      // glass material -> crazed/frosted counterpart
  function ensureScratch() {
    if (_inv) return true;
    try {
      _inv = new THREE.Matrix4(); _gInv = new THREE.Matrix4();
      _pt = new THREE.Vector3(); _dir = new THREE.Vector3(); _gp = new THREE.Vector3();
      _wp = new THREE.Vector3(); _wq = new THREE.Quaternion();
      _fwd = new THREE.Vector3(); _vel = new THREE.Vector3();
    } catch (e) { dead = true; return false; }
    return true;
  }

  function dimsOf(grp) { return (grp.userData && grp.userData.vehicleDims) || DIMS_FALLBACK; }

  // squared camera distance of an entry's car (Infinity if no camera/pos —
  // treated as "farthest", same as off-screen, so it's evicted first).
  function camDist2(e) {
    const cam = CBZ.camera && CBZ.camera.position;
    const p = e.car && e.car.pos;
    if (!cam || !p) return Infinity;
    const dx = p.x - cam.x, dz = p.z - cam.z;
    return dx * dx + dz * dz;
  }
  // is this car's position behind/outside the camera frustum, roughly? cheap
  // dot-product test against camera forward (no full frustum math needed —
  // we only need "definitely off-screen" to prefer it for eviction).
  function offScreen(e) {
    const cam = CBZ.camera;
    if (!cam || !cam.position || !e.car || !e.car.pos || !_fwd) return false;
    const dx = e.car.pos.x - cam.position.x, dz = e.car.pos.z - cam.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return false;
    // camera forward in the XZ plane (three.js looks down -Z by default)
    _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const dot = (dx / d) * _fwd.x + (dz / d) * _fwd.z;
    return dot < 0.2;   // well outside the forward cone → off-screen-ish
  }
  // pick the eviction victim: prefer farthest-from-camera / off-screen pieces
  // (the same "evict what the player can't see" rule crashfx's recycleChunk
  // already applies to chunks) over the merely oldest LRU entry. Falls back
  // to the literal oldest (damaged[0]) only when every car is in view.
  function evictPick() {
    let bestIdx = -1, bestD2 = -1;
    for (let i = 0; i < damaged.length; i++) {
      const e = damaged[i];
      if (e.fading) continue;          // already on its way out — don't double-pick
      const off = offScreen(e);
      const d2 = camDist2(e);
      // off-screen entries always outrank on-screen ones for eviction;
      // among equals, farther wins.
      const score = (off ? 1e12 : 0) + d2;
      if (score > bestD2) { bestD2 = score; bestIdx = i; }
    }
    if (bestIdx < 0) bestIdx = 0;       // everything mid-fade or no camera — oldest
    return damaged[bestIdx];
  }

  // ---- registry --------------------------------------------------------
  function entryFor(car, create) {
    for (let i = 0; i < damaged.length; i++) {
      const e = damaged[i];
      if (e.car === car) {
        if (i !== damaged.length - 1) { damaged.splice(i, 1); damaged.push(e); }   // LRU touch
        if (e.fading) { e.fading = false; e.fadeT = 0; const fi = fading.indexOf(e); if (fi >= 0) fading.splice(fi, 1); }   // re-hit cancels the fade
        return e;
      }
    }
    if (!create) return null;
    // sweep entries whose car already left the world (exploded / cleared)
    for (let i = damaged.length - 1; i >= 0; i--) {
      const e = damaged[i];
      if (e.car.dead || !e.car.group || !e.car.group.parent) release(e, true);
    }
    // settle any fades that finished while we weren't ticking (e.g. several
    // impacts land in the same frame) before counting toward the cap
    for (let i = fading.length - 1; i >= 0; i--) if (fading[i].fadeT >= FADE_T) { release(fading[i], false); fading.splice(i, 1); }
    if (damaged.length - fading.length >= MAX_CARS()) startFade(evictPick());   // distance-aware eviction, faded not snapped
    const e = {
      car, meshes: null, heads: null, glass: null,
      front: 0, rear: 0, sideL: 0, sideR: 0, total: 0,
      hood: null, door: null, bump: null,
      lightsOut: false, frosted: false, hoodGone: false, nudged: false,
      wheelPop: null, bendApplied: false, bendRotZ: 0, bendRotX: 0, bendScale: null,
      fading: false, fadeT: 0,
    };
    damaged.push(e);
    return e;
  }

  // ---- eviction fade: instead of release()'s instant pristine-snap, the
  // evicted car's craters/flaps lerp back to rest over FADE_T seconds. The
  // entry stays in `damaged` (marked .fading) so a re-hit before the fade
  // completes simply cancels the fade (see entryFor's LRU-touch path below);
  // once it completes, release() does the real cleanup + hand the geometry
  // back. flaps fade their opacity-less swap by easing rotation back toward
  // closed/seated so they don't just vanish mid-swing.
  const fading = [];
  function startFade(e) {
    if (!e || e.fading) return;
    e.fading = true; e.fadeT = 0;
    fading.push(e);
  }

  function removeFlap(f) {
    if (f && f.pivot && f.pivot.parent) f.pivot.parent.remove(f.pivot);
  }
  // dropOnly: the car is being torn down anyway — just forget it, touch nothing
  function release(e, dropOnly) {
    const i = damaged.indexOf(e);
    if (i >= 0) damaged.splice(i, 1);
    const fi = fading.indexOf(e);
    if (fi >= 0) fading.splice(fi, 1);
    e.fading = false;
    removeFlap(e.hood); removeFlap(e.door); removeFlap(e.bump);
    e.hood = e.door = e.bump = null;
    unpopWheel(e);
    unbendChassis(e);
    if (dropOnly) return;
    if (e.meshes) for (let m = 0; m < e.meshes.length; m++) {
      const r = e.meshes[m], mesh = r.mesh;
      try {
        if (r.orig) {
          // we deformed a clone of a SHARED geometry: hand the pristine
          // original back and dispose our per-car copy (the sacred contract)
          if (mesh.geometry && mesh.geometry !== r.orig && mesh.geometry.dispose) mesh.geometry.dispose();
          mesh.geometry = r.orig;
        } else if (r.base && mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position) {
          const attr = mesh.geometry.attributes.position;
          if (attr.array && attr.array.length === r.base.length) {
            attr.array.set(r.base);                       // memcpy back to rest
            attr.needsUpdate = true;
            if (mesh.geometry.computeVertexNormals) mesh.geometry.computeVertexNormals();
          }
          if (r.bsr != null && mesh.geometry.boundingSphere) mesh.geometry.boundingSphere.radius = r.bsr; // un-widen the cull sphere
        }
      } catch (err) {}
    }
    if (e.heads) for (let h = 0; h < e.heads.length; h++) e.heads[h].mesh.material = e.heads[h].mat;
    if (e.glass) for (let gl = 0; gl < e.glass.length; gl++) e.glass[gl].mesh.material = e.glass[gl].mat;
  }

  // collect deformable panel meshes, pruning wheel subtrees (they spin)
  function collect(o, list) {
    if (o.userData && o.userData.playerWheel) return;
    if (o.geometry && o.material && !Array.isArray(o.material) &&
        o.geometry.attributes && o.geometry.attributes.position &&
        o.geometry.attributes.position.itemSize === 3) list.push(o);
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) collect(ch[i], list);
  }
  function snapshot(e, root) {
    const list = [];
    collect(root, list);
    e.meshes = [];
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i];
      let orig = null, geo = mesh.geometry;
      if (geo._shared) {                      // box rig / [C]-cycle template cache
        orig = geo;
        geo = geo.clone();
        geo._shared = false;                  // per-car now: clearCars/explodeCar may dispose it
        mesh.geometry = geo;
      }
      // craters move verts up to the outer budget past the rest hull — widen the
      // cull sphere once so a deformed fender can't flicker out at screen edge
      let bsr = null;
      if (geo.boundingSphere && geo.boundingSphere.radius != null) { bsr = geo.boundingSphere.radius; geo.boundingSphere.radius += OUTER_BUDGET; }
      e.meshes.push({ mesh, orig, bsr, base: new Float32Array(geo.attributes.position.array) });
    }
  }

  // ---- material reads: dead lamps + frosted glass ------------------------
  function isHeadMat(m) {
    // Key off the cool white EMISSIVE (high g+b) — robust to carfx's dark-lens
    // headlights (color 0x222018) and the old Lambert lamps alike; excludes red tails.
    return !!(m && m.emissive && m.emissive.b > 0.6 && m.emissive.g > 0.6);
  }
  function isGlassMat(m) {
    if (!m || !m.color) return false;
    if (m._playerCarOwned || m._bodyPaint) return false; // per-car PAINT clones — dark blue fleet coats read "glassy" by hue alone
    return !!(m.color.b - m.color.r > 0.045 && m.color.b < 0.4 && m.color.r < 0.25);
  }
  function swappedMat(src, cache, tint) {
    let out = cache.get(src);
    if (!out) {
      out = src.clone ? src.clone() : src;
      if (out !== src) {
        if (out.color && out.color.setHex) out.color.setHex(tint.color);
        if (out.emissive && out.emissive.setHex) out.emissive.setHex(tint.emissive);
        out.emissiveIntensity = tint.ei;
        out._shared = true;                   // one per source mat for the whole city, never disposed
      }
      cache.set(src, out);
    }
    return out;
  }
  function findMats(e, root) {
    e.heads = []; e.glass = [];
    root.traverse(function (o) {
      const m = o.material;
      if (!m || Array.isArray(m) || !o.geometry) return;
      if (isHeadMat(m)) e.heads.push({ mesh: o, mat: m });
      else if (isGlassMat(m)) e.glass.push({ mesh: o, mat: m });
    });
  }
  function killHeadlights(e) {
    if (e.lightsOut || !e.heads) return;
    e.lightsOut = true;
    for (let i = 0; i < e.heads.length; i++) {
      const h = e.heads[i];
      h.mesh.material = swappedMat(h.mat, deadHeadMats, { color: 0x23282d, emissive: 0x05070a, ei: 0.15 });
    }
  }
  function frostGlass(e) {
    if (e.frosted || !e.glass) return;
    e.frosted = true;
    for (let i = 0; i < e.glass.length; i++) {
      const gl = e.glass[i];
      gl.mesh.material = swappedMat(gl.mat, frostMats, { color: 0xaebdc6, emissive: 0x47525a, ei: 0.45 });
    }
    if (CBZ.sfx) CBZ.sfx("glass");
  }

  // ---- hung panels: hood / door / bumper ---------------------------------
  // ONE shared unit box (hinge at z=0, panel spanning +z); mesh.scale sizes it
  // per car, so 14 cars' worth of flaps cost one geometry total.
  function ensureFlapGeo() {
    if (flapGeo) return true;
    try {
      flapGeo = new THREE.BoxGeometry(1, 1, 1);
      flapGeo.translate(0, 0, 0.5);
      flapGeo._shared = true;
      flapFallbackMat = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });
      flapFallbackMat._shared = true;
      bumperMat = new THREE.MeshLambertMaterial({ color: 0x16181c });
      bumperMat._shared = true;
    } catch (e) { return false; }
    return true;
  }
  function paintMatOf(root) {
    let found = null;
    root.traverse(function (o) {
      if (found || !o.material || Array.isArray(o.material)) return;
      if (o.material._playerCarOwned) found = o.material;
    });
    return found || flapFallbackMat;
  }
  function spawnFlap(root, mat, px, py, pz, sx, sy, sz) {
    const pivot = new THREE.Group();
    pivot.position.set(px, py, pz);
    const mesh = new THREE.Mesh(flapGeo, mat);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = false;
    pivot.add(mesh);
    root.add(pivot);
    return { pivot, mesh };
  }
  function spawnHood(e, root, d) {
    if (e.hood || e.hoodGone || !ensureFlapGeo()) return;
    const paint = paintMatOf(root);
    const f = spawnFlap(root, paint, 0, d.height * 0.55, d.length * 0.1,
      d.width * 0.66, 0.05, d.length * 0.3);
    f.base = -0.55 - rng() * 0.25;    // sprung open toward the windshield
    f.ph = rng() * 6.28;
    f.pivot.rotation.x = f.base;
    e.hood = f;
  }
  function spawnDoor(e, root, d, side) {
    if (e.door || !ensureFlapGeo()) return;
    const paint = paintMatOf(root);
    const f = spawnFlap(root, paint, side * d.width * 0.5, d.height * 0.36, d.length * 0.12,
      0.055, d.height * 0.38, d.length * 0.24);
    f.side = side;
    f.ph = rng() * 6.28;
    f.pivot.rotation.y = Math.PI - side * 0.55;   // hinged at the front edge, sagging open
    e.door = f;
  }
  function spawnBumper(e, root, d, sgn) {
    if (e.bump || !ensureFlapGeo()) return;
    const tilt = (rng() < 0.5 ? 1 : -1) * (0.38 + rng() * 0.14);
    const f = spawnFlap(root, bumperMat, 0, 0.4, sgn * (d.length * 0.5 + 0.04),
      d.width * 0.85, 0.09, 0.2);
    f.pivot.rotation.z = tilt;
    // the corner that reaches the road — where the sparks live while driving
    f.cx = (tilt > 0 ? -1 : 1) * d.width * 0.43;
    f.cz = sgn * (d.length * 0.5 + 0.1);
    f.sparkT = 0;
    e.bump = f;
  }
  function detachHood(e, car, dx, dz, energy) {
    const f = e.hood; if (!f) return;
    e.hood = null; e.hoodGone = true;
    try {
      f.pivot.updateWorldMatrix(true, true);    // it may have spawned THIS impact
      f.mesh.getWorldPosition(_wp);
      f.mesh.getWorldQuaternion(_wq);
      f.pivot.remove(f.mesh);
      removeFlap(f);
      f.mesh.position.copy(_wp);
      f.mesh.quaternion.copy(_wq);
      if (CBZ.cityDebrisAdopt) {
        // the hood tumbles off like any other piece of wreckage (crashfx pool)
        CBZ.cityDebrisAdopt(f.mesh, (car.vx || 0) * 0.7 + dx * 2.5, 4 + energy * 0.08, (car.vz || 0) * 0.7 + dz * 2.5);
        if (CBZ.sfx) CBZ.sfx("clank");
      }
    } catch (err) { removeFlap(f); }
  }

  // ---- consequence-ladder addition: a POPPED / LEANING WHEEL at high
  // front/rear cumulative damage. Reuses the same playerWheels tagging
  // playercars.js/vehicles.js already hang off the visual root (the flat-tire
  // system reads the identical list) — we don't build new geometry, we just
  // tilt + sink the corner wheel mesh that's already there, same cheap
  // transform-only trick the flat-tire squash uses. front=+z corner pair,
  // rear=-z corner pair (matches the e.front/e.rear classification above).
  function findCornerWheels(root, front) {
    const ud = root.userData || {};
    let list = ud.playerWheels;
    if (!list) { list = []; root.traverse(function (o) { if (o.userData && o.userData.playerWheel) list.push(o); }); }
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      if (front && w.position.z > 0) out.push(w);
      else if (!front && w.position.z <= 0) out.push(w);
    }
    return out;
  }
  function popWheel(e, root, front) {
    if (e.wheelPop) return;                      // one popped corner is plenty of read
    const wheels = findCornerWheels(root, front);
    if (!wheels.length) return;
    // pick the wheel deterministically (no Math.random() — same seeded rng)
    const w = wheels[Math.floor(rng() * wheels.length) % wheels.length];
    if (!w || w._wheelPopped) return;
    w._wheelPopped = true;
    const r = (w.geometry && w.geometry.parameters && w.geometry.parameters.radiusTop) || 0.4;
    const lean = (w.position.x > 0 ? 1 : -1) * (0.55 + rng() * 0.25);   // splays outward
    e.wheelPop = {
      w, baseRotZ: w.rotation.z, baseRotX: w.rotation.x, baseY: w.position.y,
      lean, drop: r * 0.85,
    };
    w.rotation.z = (w.rotation.z || 0) + lean;
    w.position.y -= e.wheelPop.drop;              // sinks toward the road on a snapped strut
  }
  function unpopWheel(e) {
    const wp = e.wheelPop; if (!wp || !wp.w) { e.wheelPop = null; return; }
    wp.w.rotation.z = wp.baseRotZ; wp.w.rotation.x = wp.baseRotX; wp.w.position.y = wp.baseY;
    wp.w._wheelPopped = false;
    e.wheelPop = null;
  }

  // ---- consequence-ladder addition: CHASSIS BEND at very high cumulative
  // damage. Cheap — no new geometry: a small non-uniform scale + skew shear
  // applied to the car's OWN visual root transform (the group every panel
  // already hangs off), biased toward whichever side took the worst beating
  // (front/rear/left/right damage tallies) so a totalled wreck reads as a
  // bent hulk read from across the street, not just "still has craters".
  // Reapplying scale every impact would compound multiplicatively, so this
  // sets an ABSOLUTE skew off the entry's accumulated totals (bendApplied
  // guards a redundant identical re-set) rather than incrementing the
  // transform — release()/unbendChassis restores rotation/scale to identity.
  const BEND_THRESHOLD = 3.2;
  function bendChassis(e, root, d) {
    const worst = Math.max(e.front, e.rear, e.sideL, e.sideR);
    const t = Math.min(1, (e.total - BEND_THRESHOLD) / 2.4);   // 0 at threshold, 1 at total≈5.6
    if (t <= 0) return;
    // skew the longitudinal axis toward whichever side is worst-hit; a small
    // scale pinch on that axis sells "the frame is no longer straight"
    const fb = e.front >= e.rear ? 1 : -1;          // bend toward the worse end
    const lr = e.sideR >= e.sideL ? 1 : -1;
    const skewMag = 0.10 * t * (0.4 + worst * 0.3);
    const rotZ = -lr * skewMag * 0.5;     // body roll toward the crushed side
    const rotX = fb * skewMag * 0.35;     // nose-down/tail-down pitch
    const scX = 1 - 0.06 * t, scY = 1 - 0.05 * t;   // pinched width, squashed (sagging) height
    root.rotation.z = rotZ; root.rotation.x = rotX;
    root.scale.x = scX; root.scale.y = scY;
    // remember the ABSOLUTE targets we just set (not deltas) so a later fade
    // can lerp cleanly back to identity without compounding across re-bends
    e.bendApplied = true; e.bendRotZ = rotZ; e.bendRotX = rotX; e.bendScale = { x: scX, y: scY };
  }
  function unbendChassis(e) {
    if (!e.bendApplied || !e.car || !e.car.group) { e.bendApplied = false; return; }
    const grp = e.car.group;
    const root = (grp.userData && grp.userData.carVisual) || grp;
    root.rotation.z = 0; root.rotation.x = 0;
    root.scale.set(1, 1, 1);
    e.bendApplied = false;
  }

  // ---- the deformation itself --------------------------------------------
  // car: a CBZ.cityCars record (or any {group,...} shaped like one — net cars
  // qualify). point: world {x,y,z}. dir: world unit-ish vector pointing INTO
  // the body (the direction the metal moves). energy: ~0..40 (closing speed /
  // severity). opts.r: override crater radius (ballistic dents pass ~0.25).
  // opts.vel: OPTIONAL explicit world-space closing-velocity {x,z} (m/s-ish) —
  // when omitted we read car.vx/car.vz off the SAME record every call site
  // already passes (vehicles.js carCrash/wreckCar/collisionImpulse all set
  // these before calling us), falling back to heading*v for records that only
  // track a scalar speed. This is what makes the crater DIRECTIONAL: a
  // glancing sideswipe (velocity mostly TANGENT to dir) rakes a long gouge
  // down the panel, a square head-on (velocity mostly PARALLEL to dir) stays
  // a contained, deep crater — same budget, different shape.
  CBZ.cityCarImpact = function (car, point, dir, energy, opts) {
    if (dead || !car || car.dead || !car.group || !point || !dir) return;
    const grp = car.group;
    const style = grp.userData && grp.userData.carStyle;
    if (style && /motorcycle|helicopter|boat/.test(style)) return;   // open frames / rotors / rider — caving reads wrong
    energy = Math.max(0, Math.min(40, energy || 0));
    if (energy < 1.2) return;
    if (!ensureScratch()) return;
    try { impact(car, grp, point, dir, energy, opts); }
    catch (e) { dead = true; }                  // stub renderer (headless) — deformation just skips
  };

  // world-space closing-velocity vector for a car record: explicit opts.vel >
  // car.vx/vz (the live 2D velocity every drivable/AI car maintains) > heading
  // * scalar speed (net/stub records that only carry car.v) > zero (no skew).
  function closingVel(car, opts, out) {
    if (opts && opts.vel) { out.set(opts.vel.x || 0, 0, opts.vel.z || 0); return out; }
    if (car.vx != null || car.vz != null) { out.set(car.vx || 0, 0, car.vz || 0); return out; }
    const v = car.v || 0;
    if (v && car.heading != null) { out.set(Math.sin(car.heading) * v, 0, Math.cos(car.heading) * v); return out; }
    out.set(0, 0, 0); return out;
  }

  function impact(car, grp, point, dir, energy, opts) {
    _dir.set(dir.x || 0, dir.y || 0, dir.z || 0);
    if (_dir.lengthSq() < 1e-6) return;
    _dir.normalize();
    const e = entryFor(car, true);
    const root = (grp.userData && grp.userData.carVisual) || grp;
    if (!e.meshes) { snapshot(e, root); findMats(e, root); }
    const d = dimsOf(grp);
    const R = opts && opts.r ? opts.r : Math.min(2.4, 0.9 + energy * 0.05);
    const amp = Math.min(0.42, energy * 0.019);
    const cabinZ = d.length * 0.21, cabinY = d.height * 0.42;

    grp.updateWorldMatrix(true, true);          // impacts are rare; per-frame cost stays zero
    const wdx = _dir.x, wdy = _dir.y, wdz = _dir.z;

    // ---- DIRECTIONAL CRUMPLE SETUP (world space) ----------------------------
    // Tangent = the closing-velocity component perpendicular to the impact
    // normal (dir) — this is the "drag" axis a sideswipe rakes the crater
    // along. glance ∈ [0,1]: how much of the velocity is tangential vs into
    // the panel (0 = pure head-on, 1 = pure sideswipe). We stretch the
    // crater's reach along the tangent by up to ~2.2x at glance=1 and squash
    // the perpendicular (bite-depth) axis slightly so total displaced volume
    // stays budget-sane — a rake is LONG and SHALLOW, not a bigger crater.
    closingVel(car, opts, _vel);
    let tanX = 0, tanY = 0, tanZ = 0, glance = 0, stretch = 1, squash = 1;
    const vSpeed = _vel.length();
    if (vSpeed > 0.6) {
      _vel.normalize();
      const into = _vel.x * wdx + _vel.y * wdy + _vel.z * wdz;   // velocity component along the normal
      tanX = _vel.x - wdx * into; tanY = _vel.y - wdy * into; tanZ = _vel.z - wdz * into;
      const tanLen = Math.sqrt(tanX * tanX + tanY * tanY + tanZ * tanZ);
      if (tanLen > 1e-4) {
        tanX /= tanLen; tanY /= tanLen; tanZ /= tanLen;
        glance = Math.min(1, tanLen);              // |tangent| of a unit vector = sin(angle off normal)
        stretch = 1 + glance * 1.2;                 // up to 2.2x reach along the drag axis
        squash = 1 - glance * 0.35;                 // shallower bite as it gets more glancing
      }
    }

    for (let m = 0; m < e.meshes.length; m++) {
      const rec = e.meshes[m], mesh = rec.mesh, geo = mesh.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) continue;
      _inv.copy(mesh.matrixWorld).invert();
      _pt.set(point.x, point.y, point.z).applyMatrix4(_inv);
      // widen the broad-phase bounding check by the stretch factor so a long
      // rake isn't culled early against the un-stretched sphere test
      const Rmax = R * stretch;
      const bs = geo.boundingSphere;
      if (bs && bs.center) {
        const bd = _pt.distanceTo(bs.center);
        if (bd > Rmax + bs.radius) continue;       // crater can't reach this bucket
      }
      _dir.set(wdx, wdy, wdz).transformDirection(_inv);
      const lx = _dir.x, ly = _dir.y, lz = _dir.z;
      // tangent axis into the SAME local space as the panel verts (mesh-local,
      // non-uniform-scale-safe enough at this gauge — transformDirection on a
      // near-rigid car hull is exactly what the normal above already uses)
      _vel.set(tanX, tanY, tanZ).transformDirection(_inv);
      const tx = _vel.x, ty = _vel.y, tz = _vel.z;
      const attr = geo.attributes.position, pos = attr.array, base = rec.base, n = attr.count;
      const px = _pt.x, py = _pt.y, pz = _pt.z;
      let moved = false;
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        // distance from the REST shape so repeated hits deepen, not wander
        const dx = base[o] - px, dy = base[o + 1] - py, dz = base[o + 2] - pz;
        // ANISOTROPIC falloff: decompose the offset into along-tangent vs
        // perpendicular components and weight them by stretch/squash so the
        // crater's footprint is an ellipse along the drag axis, not a circle.
        const along = dx * tx + dy * ty + dz * tz;
        const perpX = dx - tx * along, perpY = dy - ty * along, perpZ = dz - tz * along;
        const perp2 = perpX * perpX + perpY * perpY + perpZ * perpZ;
        const ea = along / stretch, ep2 = perp2 / (squash * squash);
        const ed2 = ea * ea + ep2;                  // effective squared distance in the stretched ellipse metric
        if (ed2 >= R * R) continue;
        const f = 1 - Math.sqrt(ed2) / R;
        const push = f * f * amp * squash;          // shallower bite on a long rake
        let ox = pos[o] + lx * push - base[o];
        let oy = pos[o + 1] + ly * push - base[o + 1];
        let oz = pos[o + 2] + lz * push - base[o + 2];
        // budget clamp: cabin band (mid-body, up high) crumples far less than
        // fenders — that's what keeps the roofline a car instead of a sock
        const lim = (Math.abs(base[o + 2]) < cabinZ && base[o + 1] > cabinY) ? CABIN_BUDGET : OUTER_BUDGET;
        const ol = Math.sqrt(ox * ox + oy * oy + oz * oz);
        if (ol > lim) { const s = lim / ol; ox *= s; oy *= s; oz *= s; }
        pos[o] = base[o] + ox; pos[o + 1] = base[o + 1] + oy; pos[o + 2] = base[o + 2] + oz;
        moved = true;
      }
      if (moved) {
        attr.needsUpdate = true;
        if (geo.computeVertexNormals) geo.computeVertexNormals();
      }
    }

    // ---- classify the hit in GROUP space + run the consequence ladder ----
    _gInv.copy(grp.matrixWorld).invert();
    _gp.set(point.x, point.y, point.z).applyMatrix4(_gInv);
    const frac = amp / OUTER_BUDGET;
    let fwdKick = 0;
    if (_gp.z > d.length * 0.18) { e.front = Math.min(2, e.front + frac); fwdKick = 1; }
    else if (_gp.z < -d.length * 0.18) e.rear = Math.min(2, e.rear + frac);
    else if (_gp.x >= 0) e.sideR = Math.min(2, e.sideR + frac);
    else e.sideL = Math.min(2, e.sideL + frac);
    e.total += frac;

    if (e.front > 0.5) {
      killHeadlights(e);                                     // night reads: the stare goes dark
      if (!e.hoodGone) spawnHood(e, root, d);
    }
    if (fwdKick && e.hood && (e.front >= 1.5 || energy >= 26)) detachHood(e, car, dir.x || 0, dir.z || 0, energy);
    if (e.sideR > 0.55) spawnDoor(e, root, d, 1);
    else if (e.sideL > 0.55) spawnDoor(e, root, d, -1);
    if (e.front > 0.65) spawnBumper(e, root, d, 1);
    else if (e.rear > 0.65) spawnBumper(e, root, d, -1);
    if (e.front > 0.45 || e.rear > 0.6 || e.sideL > 0.8 || e.sideR > 0.8) frostGlass(e);
    // a popped/leaning wheel once one end takes a real beating (front strut
    // folds under a hard nose hit, rear axle under a hard rear/T-bone hit)
    if (e.front >= 1.3) popWheel(e, root, true);
    else if (e.rear >= 1.3) popWheel(e, root, false);
    // very high cumulative damage bends the whole chassis (transform-only —
    // see bendChassis), evaluated AFTER this hit's tallies are folded in
    if (e.total >= BEND_THRESHOLD) bendChassis(e, root, d);
    if (!e.nudged && e.total >= 1.8) {
      // heavy cumulative bodywork finally reaches the motor — ONE nudge so the
      // crash sites that already fed damageEngine never double-dip
      e.nudged = true;
      if (CBZ.cityDamageCar) CBZ.cityDamageCar(car, 8, {});
    }
  }

  // restore ONE car to pristine (police cruiser pool reuse, [C] body swap)
  CBZ.cityCarImpactReset = function (car) {
    if (!car) return;
    const e = entryFor(car, false);
    if (e) release(e, false);
  };
  // fresh run: forget the whole ledger (vehicles are being rebuilt anyway)
  CBZ.cityCarDeformReset = function () {
    for (let i = damaged.length - 1; i >= 0; i--) release(damaged[i], true);
    damaged.length = 0;
  };

  // step one car's fade-back-to-pristine over FADE_T: lerps every deformed
  // mesh's live vertex buffer toward its rest `base` (cheap — same arrays the
  // impact loop already writes), eases hung flaps toward closed/seated, and
  // relaxes the wheel-pop/chassis-bend transforms toward identity. Finalizes
  // via the normal release() (geometry handback, flap removal, mat restore)
  // the instant the window completes — so there is exactly one cleanup path,
  // fade or not.
  function stepFade(e, dt) {
    e.fadeT += dt;
    const t = Math.min(1, e.fadeT / FADE_T);
    const keep = 1 - t;                 // remaining fraction of the deformation
    if (e.meshes) for (let m = 0; m < e.meshes.length; m++) {
      const r = e.meshes[m], mesh = r.mesh, geo = mesh.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position || !r.base) continue;
      const attr = geo.attributes.position, pos = attr.array, base = r.base;
      if (pos.length !== base.length) continue;
      for (let i = 0; i < pos.length; i++) pos[i] = base[i] + (pos[i] - base[i]) * keep;
      attr.needsUpdate = true;
    }
    if (e.hood) e.hood.pivot.rotation.x = e.hood.base * keep;
    if (e.door) e.door.pivot.rotation.y = Math.PI - e.door.side * 0.55 * keep;
    if (e.bump) e.bump.pivot.rotation.z *= keep;
    if (e.wheelPop && e.wheelPop.w) {
      const wp = e.wheelPop, w = wp.w;
      w.rotation.z = wp.baseRotZ + (wp.lean) * keep;
      w.position.y = wp.baseY - wp.drop * keep;
    }
    if (e.bendApplied && e.bendScale && e.car && e.car.group) {
      const grp = e.car.group, root = (grp.userData && grp.userData.carVisual) || grp;
      root.rotation.z = e.bendRotZ * keep; root.rotation.x = e.bendRotX * keep;
      root.scale.x = 1 - (1 - e.bendScale.x) * keep;
      root.scale.y = 1 - (1 - e.bendScale.y) * keep;
    }
    if (e.fadeT >= FADE_T) { release(e, false); return true; }
    return false;
  }

  // ---- the only per-frame work: flap sway + bumper-drag sparks + fades -----
  // ≤14 entries, numbers only; sparks throttle per car and gate on camera range.
  let wob = 0;
  const _sparkPos = { x: 0, y: 0.12, z: 0 }, _sparkUp = { x: 0, y: 1, z: 0 };
  CBZ.onUpdate(37.9, function (dt) {
    if (dead || !damaged.length || (g && g.mode !== "city")) return;
    wob += dt;
    // drain any fading entries first (independent of the city-mode gate below
    // so a fade started just before a mode switch still finishes cleanly)
    if (fading.length) for (let i = fading.length - 1; i >= 0; i--) {
      const e = fading[i];
      if (stepFade(e, dt)) fading.splice(i, 1);
    }
    if (g && g.mode !== "city") return;
    const cam = CBZ.camera && CBZ.camera.position;
    for (let i = damaged.length - 1; i >= 0; i--) {
      const e = damaged[i], car = e.car;
      if (e.fading) continue;            // mid-fade entries are driven by stepFade above only
      if (car.dead || !car.group || !car.group.parent) { release(e, true); continue; }
      if (!e.hood && !e.door && !e.bump) continue;
      const sp = Math.abs(car.v || 0);
      if (e.hood) e.hood.pivot.rotation.x = e.hood.base + Math.sin(wob * 21 + e.hood.ph) * Math.min(0.13, sp * 0.012);
      if (e.door) e.door.pivot.rotation.y = Math.PI - e.door.side * (0.55 + Math.sin(wob * 5.5 + e.door.ph) * Math.min(0.2, 0.04 + sp * 0.014));
      if (e.bump && sp > 4 && cam) {
        e.bump.sparkT -= dt;
        if (e.bump.sparkT <= 0) {
          e.bump.sparkT = 0.1 + rng() * 0.08;
          const dxc = car.pos.x - cam.x, dzc = car.pos.z - cam.z;
          if (dxc * dxc + dzc * dzc < 60 * 60 && CBZ.bulletImpact) {
            const h = car.heading || 0, ch = Math.cos(h), sh = Math.sin(h);
            _sparkPos.x = car.pos.x + e.bump.cx * ch + e.bump.cz * sh;
            _sparkPos.z = car.pos.z - e.bump.cx * sh + e.bump.cz * ch;
            CBZ.bulletImpact(_sparkPos, _sparkUp, { kind: "spark", power: 0.7 + Math.min(0.8, sp * 0.03) });
          }
        }
      }
    }
  });
})();
