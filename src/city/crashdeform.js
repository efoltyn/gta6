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

   ============================================================
   AIRCRAFT (CBZ.cityAircraftImpactDeform) — the SAME system, not a second one.

   OWNER BRIEF: a plane hitting a tower must read as a catastrophe. Half of
   that is what happens to the BUILDING (city/aircraftimpact.js + the ordnance
   bus + city/structural.js); the other half is what happens to the AIRFRAME,
   and this file already owns "a vehicle that hit something looks like it hit
   something". So the airframe path REUSES every primitive above rather than
   authoring a parallel one:

     • the same LRU registry / rest snapshot / shared-geometry clone-and-swap
       contract / eviction fade,
     • the same clamped radial vertex displacement (carveMeshes, extracted
       verbatim out of the car path so both callers run identical maths) —
       just with an airframe-scale budget, because 0.34u of crumple on a 38 m
       fuselage is invisible,
     • the same absolute-set transform skew as bendChassis, extended with a
       Z-axis pinch so a nose crumple SHORTENS the airframe,
     • the same debris hand-off (crashfx's pool via cityDebrisAdopt) for small
       pieces, and city/aircraftimpact.js's wreck field for whole sheared
       sections that the pool refuses (its 3 m donation limit).

   Airframe-only consequences: a wing or tail SHEARING OFF and flying away
   under its residual velocity, and a wound that trails fuel smoke for a few
   seconds. Both ride existing systems. Behind CBZ.CONFIG.AIR_IMPACT_DEFORM.
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

  // AIRCRAFT entries share the registry but are addressed through their own
  // group (a craft record carries .group, an airtraffic record carries .grp,
  // and neither is shaped like a car record). One accessor pair keeps every
  // existing LRU/eviction/fade path working for both without branching.
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.AIR_IMPACT_DEFORM == null) CBZ.CONFIG.AIR_IMPACT_DEFORM = true;
  function entGroup(e) { return e.air ? e.airGroup : (e.car && e.car.group); }
  function entPos(e) {
    if (e.air) return e.airGroup && e.airGroup.position;
    return e.car && e.car.pos;
  }
  function entGone(e) {
    const grp = entGroup(e);
    if (e.air) return !grp || !grp.parent;
    // `_husk` — a BURNT-OUT HULK (city/vehicles.js) is `dead` but has not left
    // the world, and the whole point of it is the damage on it. Without this
    // clause the very next entryFor() sweep would release the entry, and
    // release() strips the flaps, un-pops the wheel and UN-BENDS the chassis
    // before its dropOnly early-out — so the wreck would straighten up.
    if (e.car._husk) return !grp || !grp.parent;
    return e.car.dead || !grp || !grp.parent;
  }

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
    const p = entPos(e);
    if (!cam || !p) return Infinity;
    const dx = p.x - cam.x, dz = p.z - cam.z;
    return dx * dx + dz * dz;
  }
  // is this car's position behind/outside the camera frustum, roughly? cheap
  // dot-product test against camera forward (no full frustum math needed —
  // we only need "definitely off-screen" to prefer it for eviction).
  function offScreen(e) {
    const cam = CBZ.camera;
    const ep = entPos(e);
    if (!cam || !cam.position || !ep || !_fwd) return false;
    const dx = ep.x - cam.position.x, dz = ep.z - cam.position.z;
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
      // among equals, farther wins. A deformed AIRFRAME outranks nothing — a
      // crashed plane is a permanent landmark of what the player did, so cars
      // are always evicted first and an air entry only goes when it is the
      // only thing left to give. A BURNT-OUT CAR HULK is the same kind of
      // landmark and is protected the same way: a wreck that quietly
      // straightens itself out because a fender-bender happened elsewhere is
      // the world forgetting what you did to it.
      const permanent = e.air || (e.car && e.car._husk);
      const score = (permanent ? 0 : 1e18) + (off ? 1e12 : 0) + d2;
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
    // sweep entries whose car/airframe already left the world (exploded / cleared)
    for (let i = damaged.length - 1; i >= 0; i--) {
      const e = damaged[i];
      if (entGone(e)) release(e, true);
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
      // ---- aircraft-only state (unset for cars; costs one hidden-class slot) ----
      air: false, airGroup: null, airDims: null, airShear: 0, airWound: null, airBurn: 0,
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
    if (!f) return;
    if (f.real) { try { CBZ.carDoorPose(f.root, f.id, 0); } catch (e) {} return; }
    if (f.pivot && f.pivot.parent) f.pivot.parent.remove(f.pivot);
  }
  // the hung door's angle (rad off shut): the real door through its own verb,
  // the legacy flap through its pivot (which spans +z, hence the PI)
  function setDoorSag(f, ang) {
    if (f.real) { try { CBZ.carDoorPose(f.root, f.id, ang / 1.15); } catch (e) {} return; }
    f.pivot.rotation.y = Math.PI - f.side * ang;
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
  function snapshot(e, root, budget) {
    if (budget == null) budget = OUTER_BUDGET;
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
      if (geo.boundingSphere && geo.boundingSphere.radius != null) { bsr = geo.boundingSphere.radius; geo.boundingSphere.radius += budget; }
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
      const fm = swappedMat(gl.mat, frostMats, { color: 0xaebdc6, emissive: 0x47525a, ei: 0.45 });
      // REAL-GLASS aware: the frost clone inherits the clear pane's transparency
      // — crazed safety glass reads nearly OPAQUE, so push the clone's opacity
      // back up (once; the clone is cached/shared for the whole city).
      if (fm !== gl.mat && fm.transparent && fm.opacity < 0.8) { fm.opacity = 0.85; fm.depthWrite = true; }
      gl.mesh.material = fm;
    }
  }

  /* ============================================================
     THE BURNT-OUT LOOK — two public verbs, both composed entirely from what
     this file already does. Nothing new is drawn.

     WHY THEY LIVE HERE: `city/vehicles.js` needed a wreck to STAY in the world
     after a cook-off (a car used to delete itself one frame after exploding,
     while aircraft leave hulks), and everything that makes a hulk read as a
     hulk was already written in this file and simply never reachable from
     outside it — the crazed glass, the dead lamps, the sprung hood, the
     splayed wheel, the buckled chassis. Exporting them is a migration, not a
     feature: `cityCarBurnOut` is ~15 lines of orchestration over five existing
     private functions plus one material cache, and the alternative was
     vehicles.js re-authoring all of it against geometry it does not own.

     `CBZ.cityCarFrost(car)` — just the glass. An overpressure takes the
     windows out long before it caves a panel, and the crater ladder only
     crazes glass once a panel is DEEPLY caved (right for a kerb scrape, wrong
     for a blast), so systems/impactbus.js's vehicle coupling calls this
     directly.
     ============================================================ */
  const charMats = new Map();       // source material -> its scorched counterpart
  // A char is a MULTIPLY, never a fixed tint: a red taxi and a white van must
  // burn to different blacks or the whole street ends up the same charcoal
  // prop. Matches city/playeraircraft.js's charAircraftWreck, which already
  // does exactly this to a downed airframe (0.22 colour / 0.08 emissive).
  function charMat(src) {
    let out = charMats.get(src);
    if (out) return out;
    out = src && src.clone ? src.clone() : src;
    if (out && out !== src) {
      if (out.color && out.color.multiplyScalar) out.color.multiplyScalar(0.2);
      if (out.emissive && out.emissive.multiplyScalar) out.emissive.multiplyScalar(0.06);
      if (out.map) out.map = null;             // soot covers the livery
      out.transparent = false; out.opacity = 1;
      out.needsUpdate = true;
      // one per SOURCE material for the whole city, and never disposed — the
      // `_shared` flag is also what stops vehicles.js's teardown traverse from
      // freeing a material another wreck is still wearing.
      out._shared = true;
    }
    charMats.set(src, out);
    return out;
  }

  CBZ.cityCarFrost = function (car) {
    if (dead || !car || !car.group) return;
    const e = entryFor(car, true);
    if (!e) return;
    const root = (car.group.userData && car.group.userData.carVisual) || car.group;
    if (!e.meshes) { if (!ensureScratch()) return; snapshot(e, root); findMats(e, root); }
    frostGlass(e);
  };

  CBZ.cityCarBurnOut = function (car, opts) {
    if (dead || !car || !car.group) return false;
    if (!ensureScratch()) return false;
    opts = opts || {};
    const grp = car.group;
    const root = (grp.userData && grp.userData.carVisual) || grp;
    const e = entryFor(car, true);
    if (!e) return false;
    if (!e.meshes) { snapshot(e, root); findMats(e, root); }
    const d = dimsOf(grp);
    // (1) the paint is gone
    root.traverse(function (o) {
      const m = o.material;
      if (!m || Array.isArray(m) || m._carCharred) return;
      const cm = charMat(m);
      if (cm && cm !== m) { cm._carCharred = true; o.material = cm; }
    });
    // (2) crazed glass + dead lamps (their swaps run BEFORE the char above
    //     would have caught them; both caches are keyed on the source mat, so
    //     a car that had already frosted keeps its frost rather than going
    //     black-glass — which is the honest read: soot on cracked safety glass)
    frostGlass(e);
    killHeadlights(e);
    // (3) the hood is somewhere else now. spawnHood is idempotent per entry
    //     and detachHood hands it to crashfx's debris pool, so it tumbles off
    //     the way any other piece of wreckage does.
    if (!e.hoodGone) {
      spawnHood(e, root, d);
      const a = (car.heading || 0);
      detachHood(e, car, Math.sin(a) * 0.6, Math.cos(a) * 0.6, 22);
    }
    // (4) one corner is on the ground, and the frame is no longer straight.
    //     The tallies are forced past the file's own BEND_THRESHOLD rather
    //     than a new number being invented for wrecks.
    if (!e.wheelPop) popWheel(e, root, opts.rearWheel ? false : true);
    e.front = Math.max(e.front, 1.1); e.rear = Math.max(e.rear, 0.9);
    e.sideL = Math.max(e.sideL, 0.7); e.sideR = Math.max(e.sideR, 0.8);
    e.total = Math.max(e.total, BEND_THRESHOLD + 1.4);
    bendChassis(e, root, d);
    return true;
  };

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
    /* A CAR WITH REAL DOORS SAGS ITS REAL DOOR. playercars.js builds hinged
       doors into every road car and SUV now, so a side impact swings the
       struck flank's front door open on its own hinge — skin, card, window
       and all — instead of bolting a painted slab beside a shut one. The
       flap below stays for the bodies that have no door to sag. */
    const specs = CBZ.carDoors ? CBZ.carDoors(root) : null;
    if (specs) {
      let spec = null;
      for (let i = 0; i < specs.length; i++) if (specs[i].side === side && (!spec || specs[i].row < spec.row)) spec = specs[i];
      if (spec) {
        e.door = { real: true, root: root, id: spec.id, side: side, ph: rng() * 6.28 };
        setDoorSag(e.door, 0.55);
        return;
      }
    }
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
    const grp = entGroup(e);
    if (!e.bendApplied || !grp) { e.bendApplied = false; return; }
    const root = (grp.userData && grp.userData.carVisual) || grp;
    if (e.air) {
      // an AIRFRAME's rotation IS its flight attitude and belongs to the craft
      // controller (playeraircraft's setCraftRotation / the fall handlers) — we
      // only ever wrote its SCALE. Put the authored scale back, touch nothing else.
      const b = e.airBaseScale;
      if (b) root.scale.set(b.x, b.y, b.z);
      e.bendApplied = false;
      return;
    }
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
    // OPEN FRAMES / ROTORS / RIDER — caving reads wrong on those, which is
    // why boats were excluded here. `opts.hull` is the ONE declared exception:
    // a caller saying "this is a structural bite through the hull, not a
    // fender-bender" — city/marine_predation.js's megalodon closing its jaws
    // across a speedboat's beam, where a crushed trough at the bite line IS
    // the read the exclusion was protecting against elsewhere. Nothing that
    // does not ask for it changes.
    if (style && /motorcycle|helicopter/.test(style)) return;
    if (style && /boat/.test(style) && !(opts && opts.hull)) return;
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

  // ---- THE CRATER (extracted verbatim from impact(), unchanged maths) -------
  // Clamped radial vertex displacement in each panel's own local space, with
  // the anisotropic (stretch/squash) footprint. Extracted so the CAR path and
  // the AIRCRAFT path below run the IDENTICAL loop instead of a second copy
  // that drifts — the whole point of extending this file rather than writing
  // a parallel one. The only things the two callers differ on are the crater
  // radius/amplitude and the per-vertex displacement BUDGETS (0.34u of crumple
  // is a caved fender on a car and invisible on a 38 m fuselage).
  function carveMeshes(e, point, wdx, wdy, wdz, tanX, tanY, tanZ, stretch, squash,
                       R, amp, cabinZ, cabinY, outerBudget, cabinBudget) {
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
        const lim = (Math.abs(base[o + 2]) < cabinZ && base[o + 1] > cabinY) ? cabinBudget : outerBudget;
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

    carveMeshes(e, point, wdx, wdy, wdz, tanX, tanY, tanZ, stretch, squash,
      R, amp, cabinZ, cabinY, OUTER_BUDGET, CABIN_BUDGET);

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

  /* ============================================================
     AIRCRAFT IMPACT — the airframe half of the plane-into-tower catastrophe.

     city/aircraftimpact.js owns what happens to the WORLD (penetration into
     the structural ledger, ejecta, fire, collapse, falling debris). This owns
     what happens to the AIRCRAFT, and it does it with the primitives already
     above rather than a second deformation system:

       1. NOSE CRUMPLE      carveMeshes() — the identical clamped radial
                            displacement the car path runs, with an
                            airframe-scale budget derived from the fuselage.
       2. AIRFRAME SHORTEN  a non-uniform scale pinch on the root (the same
                            absolute-set discipline as bendChassis, extended
                            with Z so the hull reads SHORTER, and restricted
                            to scale because a craft's ROTATION is its flight
                            attitude and belongs to its controller).
       3. WING / TAIL SHEAR the struck-side wing (and, on a heavy strike, the
                            tail) detaches at its world pose and flies away on
                            its residual velocity via city/aircraftimpact.js's
                            wreck field — crashfx's debris pool refuses
                            donations over 3 m, which is every wing in the game.
       4. WRECK FIELD       5..15 fragments: the big recognisable ones on the
                            wreck field's closed-form arcs, the rest into
                            CBZ.cityChunk's existing pooled debris.
       5. FUEL / FIRE TRAIL the wound keeps smoking from its LOCAL point on the
                            hull, so the trail follows the wreck as it tumbles.

     Behind CBZ.CONFIG.AIR_IMPACT_DEFORM (one-line revert).
     ============================================================ */
  function airDims(grp, given) {
    const d = given || (grp.userData && grp.userData.aircraftDims);
    if (d) return {
      length: Math.max(4, d.length || 8), span: Math.max(3, d.span || 7),
      height: Math.max(2, d.height || 3),
      fuselage: Math.max(1.1, d.fuselage || Math.min(4.2, (d.span || 8) * 0.16)),
    };
    return { length: 10, span: 9, height: 3, fuselage: 1.6 };
  }

  // ONE shared box + ONE shared material for every airframe fragment in the
  // city (mesh.scale sizes them), so a wreck field costs one geometry total.
  let airDebrisGeo = null, airDebrisMat = null;
  function ensureAirDebris() {
    if (airDebrisGeo) return true;
    try {
      airDebrisGeo = new THREE.BoxGeometry(1, 1, 1); airDebrisGeo._shared = true;
      airDebrisMat = new THREE.MeshLambertMaterial({ color: 0x9aa1a8 }); airDebrisMat._shared = true;
    } catch (err) { return false; }
    return true;
  }
  function arenaRoot() {
    const A = CBZ.city && (CBZ.city.arena || CBZ.city);
    return (A && A.root) || CBZ.scene || null;
  }

  // Furthest-out mesh on the struck wing side / furthest-aft mesh, measured in
  // the ROOT's local space so nested builders (island_airport, militaryvehicles
  // and our own buildJet all nest differently) are handled the same way.
  function findSection(root, d, kind, side) {
    let best = null, bestScore = -1;
    root.updateWorldMatrix(true, true);
    _gInv.copy(root.matrixWorld).invert();
    root.traverse(function (o) {
      if (o === root || !o.isMesh || !o.geometry) return;
      // rotors/props spin on their own transform every frame — shearing one off
      // reads as a bug, not as damage. Leave them to the craft controller.
      if (o.userData && (o.userData.rotor || o.userData.tailRotor || o.userData.playerWheel)) return;
      o.getWorldPosition(_gp); _gp.applyMatrix4(_gInv);
      const score = kind === "wing" ? side * _gp.x : -_gp.z;
      if (score > bestScore) { bestScore = score; best = o; }
    });
    if (kind === "wing" && bestScore < d.span * 0.16) return null;
    if (kind !== "wing" && bestScore < d.length * 0.22) return null;
    return best;
  }

  function shearOff(root, mesh, baseScale, vx, vy, vz, burning) {
    if (!mesh) return false;
    try {
      mesh.updateWorldMatrix(true, true);
      mesh.getWorldPosition(_wp);
      mesh.getWorldQuaternion(_wq);
      if (mesh.parent) mesh.parent.remove(mesh);
      mesh.position.copy(_wp);
      mesh.quaternion.copy(_wq);
      // the root may carry a non-unit authored scale; the detached piece has to
      // keep the size it had while it was still bolted on
      mesh.scale.set(mesh.scale.x * baseScale.x, mesh.scale.y * baseScale.y, mesh.scale.z * baseScale.z);
      const dest = arenaRoot();
      if (!dest) return false;
      dest.add(mesh);
      // Whole SECTIONS go to the wreck field (closed-form arcs, no size limit);
      // if that module is absent we fall back to crashfx's debris pool exactly
      // as this file already does for a torn-off hood.
      if (CBZ.cityWreckDebris) {
        CBZ.cityWreckDebris(mesh, vx, vy, vz, { burning: burning, spin: (rng() - 0.5) * 6 });
      } else if (CBZ.cityDebrisAdopt) {
        CBZ.cityDebrisAdopt(mesh, vx, vy, vz);
      }
      return true;
    } catch (err) { return false; }
  }

  // Absolute-set (never incremental) non-uniform pinch: the hull reads SHORTER
  // and narrower the harder it hit. Rotation is deliberately untouched.
  function bendAirframe(e, root, k) {
    const bs = e.airBaseScale || { x: 1, y: 1, z: 1 };
    const t = Math.max(0, Math.min(1, k));
    if (t <= 0.02) return;
    const sx = bs.x * (1 - 0.05 * t);
    const sy = bs.y * (1 - 0.07 * t);
    const sz = bs.z * (1 - 0.16 * t);            // the nose crumple, as a length loss
    root.scale.set(sx, sy, sz);
    e.bendApplied = true; e.bendRotZ = 0; e.bendRotX = 0;
    e.bendScale = { x: sx, y: sy, z: sz };
  }

  // the wound trails fuel smoke from its LOCAL seat on the hull, so the plume
  // follows the wreck while it tumbles instead of hanging in mid-air
  function stepAirBurn(e, dt, cam) {
    if (!e.airWound || !(e.airBurn > 0) || !e.airGroup) return;
    e.airBurn -= dt;
    e.airBurnT = (e.airBurnT || 0) - dt;
    if (e.airBurnT > 0 || !CBZ.cityCrashSmoke) return;
    e.airBurnT = 0.22;
    try {
      _wp.set(e.airWound.x, e.airWound.y, e.airWound.z);
      e.airGroup.localToWorld(_wp);
      if (cam) {
        const dx = _wp.x - cam.x, dz = _wp.z - cam.z;
        const cull = CBZ.cityCullRadius || 320;
        if (dx * dx + dz * dz > cull * cull) return;
      }
      CBZ.cityCrashSmoke(_wp.x, _wp.y, _wp.z);
    } catch (err) {}
  }

  function airImpact(craft, grp, point, dir, energy, opts) {
    _dir.set(dir.x || 0, dir.y || 0, dir.z || 0);
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1);
    _dir.normalize();
    const wdx = _dir.x, wdy = _dir.y, wdz = _dir.z;

    const e = entryFor(craft, true);
    const d = airDims(grp, opts.dims);
    const scale = Math.max(0.4, Math.min(2.6, opts.scale || 1));
    // an airframe's crumple budget is a fraction of its fuselage diameter, not
    // a car's fixed 0.34u — that constant is invisible on an A320 and would
    // turn a Cessna inside out.
    const budget = Math.max(0.25, Math.min(1.8, d.fuselage * 0.55));
    const cabinBudget = budget * 0.35;

    if (!e.air) {
      e.air = true; e.airGroup = grp; e.airDims = d;
      e.airBaseScale = { x: grp.scale.x, y: grp.scale.y, z: grp.scale.z };
    }
    // NOTE: no findMats() — the headlight/glasshouse consequence ladder is a
    // CAR ladder. An airframe's ladder is shear + shorten + burn.
    if (!e.meshes) snapshot(e, grp, budget);

    grp.updateWorldMatrix(true, true);

    // 1) THE CRATER — identical maths to the car path (carveMeshes), airframe
    //    radius/budget. Symmetric (no glance skew): a plane arrives nose-first
    //    at its own velocity, so there is no tangential drag axis to rake along.
    const R = Math.max(2.5, Math.min(9, d.length * 0.30));
    const amp = Math.min(budget, 0.12 + energy * 0.016);
    carveMeshes(e, point, wdx, wdy, wdz, 0, 0, 0, 1, 1,
      R, amp, d.length * 0.18, d.height * 0.55, budget, cabinBudget);
    e.total += amp / budget;
    e.front = Math.min(3, e.front + amp / budget);

    // 2) SHEAR — before the pinch, so the detached piece keeps its true size.
    //    Which WING went is decided in the hull's OWN local frame (a world-X
    //    test would pick the wrong side for any heading but north).
    _gp.set(point.x, point.y, point.z);
    grp.worldToLocal(_gp);
    const struckSide = _gp.x >= 0 ? 1 : -1;
    const shearVX = wdx * (5 + energy * 0.22), shearVZ = wdz * (5 + energy * 0.22);
    if (energy >= 22 && e.airShear < 1) {
      e.airShear = 1;
      shearOff(grp, findSection(grp, d, "wing", struckSide), e.airBaseScale,
        shearVX + struckSide * (4 + rng() * 7), 3 + rng() * 6, shearVZ + (rng() - 0.5) * 8, true);
    }
    if (energy >= 34 && scale >= 1 && e.airShear < 2) {
      e.airShear = 2;
      shearOff(grp, findSection(grp, d, "tail", 0), e.airBaseScale,
        -wdx * (3 + rng() * 6), 2 + rng() * 5, -wdz * (3 + rng() * 6), false);
    }

    // 3) THE PINCH.
    bendAirframe(e, grp, Math.min(1, energy / 45) * Math.min(1.4, scale));

    // 4) THE WRECK FIELD — 5..15 fragments. The few big recognisable ones ride
    //    the closed-form arcs of city/aircraftimpact.js's wreck field; the rest
    //    go into CBZ.cityChunk's existing pooled debris (cap 60), so the count
    //    reads big without either pool being flooded.
    const total = Math.max(5, Math.min(15, Math.round((CBZ.qScale ? CBZ.qScale(5, 15) : 9) * Math.min(1.4, scale))));
    const big = Math.min(total, Math.max(1, Math.round(CBZ.qScale ? CBZ.qScale(1, 5) : 3)));
    if (CBZ.cityWreckDebris && ensureAirDebris()) {
      const dest = arenaRoot();
      for (let i = 0; dest && i < big; i++) {
        let m;
        try { m = new THREE.Mesh(airDebrisGeo, airDebrisMat); } catch (err) { break; }
        const s = d.fuselage * (0.25 + rng() * 0.5);
        m.scale.set(s, s * (0.35 + rng() * 0.5), s * (0.8 + rng()));
        m.position.set(point.x + (rng() - 0.5) * 3, point.y + rng() * 2.5, point.z + (rng() - 0.5) * 3);
        m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        dest.add(m);
        const a = rng() * 6.2832, sp = 3 + rng() * 9;
        CBZ.cityWreckDebris(m,
          wdx * (3 + energy * 0.12) + Math.cos(a) * sp,
          2.5 + rng() * 6,
          wdz * (3 + energy * 0.12) + Math.sin(a) * sp,
          { burning: i === 0, own: true, hazard: point.y > 14, dmg: 45,
            byPlayer: !!opts.byPlayer, by: opts.byPlayer ? CBZ.player : null });
      }
    }
    if (CBZ.cityChunk) {
      try {
        CBZ.cityChunk(point.x, point.y, point.z, {
          count: Math.max(1, total - big), force: Math.min(15, 6 + energy * 0.12),
          dirx: wdx, dirz: wdz, color: 0x9aa1a8,
        });
      } catch (err) {}
    }

    // 5) THE WOUND KEEPS BURNING — stored in HULL-LOCAL space so the plume
    //    follows the wreck as it tumbles/settles.
    try {
      _wp.set(point.x, point.y, point.z);
      grp.worldToLocal(_wp);
      e.airWound = { x: _wp.x, y: _wp.y, z: _wp.z };
      e.airBurn = 5 + scale * 5;
      e.airBurnT = 0;
    } catch (err) {}
  }

  /* PUBLIC: deform an AIRFRAME at an impact.
       craft   any record with a group (playeraircraft craft / aircraft.js heli
               or jet / airtraffic record) — used only as the registry key
       point   world impact point
       dir     unit-ish travel direction (the way the metal is moving)
       energy  impact speed, m/s-ish
       opts    { dims, cls, scale, building, byPlayer, group }
     Degrade-safe: returns false and touches nothing if the flag is off, the
     group is gone, or the renderer is a headless stub. */
  CBZ.cityAircraftImpactDeform = function (craft, point, dir, energy, opts) {
    if (dead || !craft || !point || !dir) return false;
    if (!CBZ.CONFIG.AIR_IMPACT_DEFORM) return false;
    opts = opts || {};
    const grp = opts.group || craft.group || craft.grp;
    if (!grp || !grp.parent) return false;
    if (!ensureScratch()) return false;
    energy = Math.max(0, Math.min(120, energy || 0));
    if (energy < 4) return false;                    // a taxi nudge deforms nothing
    try { airImpact(craft, grp, point, dir, energy, opts); }
    catch (err) { dead = true; return false; }       // stub renderer — the whole module no-ops
    return true;
  };
  // restore ONE airframe to pristine (same contract as cityCarImpactReset)
  CBZ.cityAircraftImpactReset = function (craft) {
    if (!craft) return;
    const e = entryFor(craft, false);
    if (e) release(e, false);
  };

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
    if (e.door) setDoorSag(e.door, 0.55 * keep);
    if (e.bump) e.bump.pivot.rotation.z *= keep;
    if (e.wheelPop && e.wheelPop.w) {
      const wp = e.wheelPop, w = wp.w;
      w.rotation.z = wp.baseRotZ + (wp.lean) * keep;
      w.position.y = wp.baseY - wp.drop * keep;
    }
    if (e.bendApplied && e.bendScale && entGroup(e)) {
      const grp = entGroup(e), root = (grp.userData && grp.userData.carVisual) || grp;
      if (e.air) {
        // AIRFRAME: scale only — its rotation is the craft controller's.
        const b = e.airBaseScale || { x: 1, y: 1, z: 1 };
        root.scale.x = b.x - (b.x - e.bendScale.x) * keep;
        root.scale.y = b.y - (b.y - e.bendScale.y) * keep;
        if (e.bendScale.z != null) root.scale.z = b.z - (b.z - e.bendScale.z) * keep;
      } else {
        root.rotation.z = e.bendRotZ * keep; root.rotation.x = e.bendRotX * keep;
        root.scale.x = 1 - (1 - e.bendScale.x) * keep;
        root.scale.y = 1 - (1 - e.bendScale.y) * keep;
      }
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
      if (entGone(e)) { release(e, true); continue; }
      if (e.air) { stepAirBurn(e, dt, cam); continue; }   // airframes have no flaps/bumper
      if (!e.hood && !e.door && !e.bump) continue;
      const sp = Math.abs(car.v || 0);
      if (e.hood) e.hood.pivot.rotation.x = e.hood.base + Math.sin(wob * 21 + e.hood.ph) * Math.min(0.13, sp * 0.012);
      if (e.door) setDoorSag(e.door, 0.55 + Math.sin(wob * 5.5 + e.door.ph) * Math.min(0.2, 0.04 + sp * 0.014));
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
