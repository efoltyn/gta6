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
     • LRU cap of 14 concurrently-deformed cars — the least-recently-hit one
       is silently restored to pristine when a 15th takes damage.
     • Consequences past thresholds: headlights smashed dark (material
       pointer swap, pooled like the brake lights), hood hangs + sin-jitters
       while driving then detaches as debris (crashfx chunk pool), struck-side
       door sags open, a dropped bumper drags sparks, glasshouse frosts over,
       and one engine-damage nudge at heavy cumulative deformation.
     • Headless harness: any stub-renderer throw flips a dead flag and the
       whole module no-ops (the skidDead convention).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const MAX_CARS = 14;
  const OUTER_BUDGET = 0.34, CABIN_BUDGET = 0.12;
  const DIMS_FALLBACK = { width: 2, length: 4.4, height: 1.5 };
  const damaged = [];          // LRU registry, oldest first; entries move to the tail when re-hit
  let dead = false;            // stub renderer / missing API → permanent no-op

  // scratch (no per-impact allocation beyond the one-time rest snapshots)
  let _inv = null, _pt = null, _dir = null, _gInv = null, _gp = null, _wp = null, _wq = null;
  let flapGeo = null, flapFallbackMat = null, bumperMat = null;
  const deadHeadMats = new Map();   // live headlight material -> smashed-dark counterpart
  const frostMats = new Map();      // glass material -> crazed/frosted counterpart
  function ensureScratch() {
    if (_inv) return true;
    try {
      _inv = new THREE.Matrix4(); _gInv = new THREE.Matrix4();
      _pt = new THREE.Vector3(); _dir = new THREE.Vector3(); _gp = new THREE.Vector3();
      _wp = new THREE.Vector3(); _wq = new THREE.Quaternion();
    } catch (e) { dead = true; return false; }
    return true;
  }

  function dimsOf(grp) { return (grp.userData && grp.userData.vehicleDims) || DIMS_FALLBACK; }

  // ---- registry --------------------------------------------------------
  function entryFor(car, create) {
    for (let i = 0; i < damaged.length; i++) {
      const e = damaged[i];
      if (e.car === car) {
        if (i !== damaged.length - 1) { damaged.splice(i, 1); damaged.push(e); }   // LRU touch
        return e;
      }
    }
    if (!create) return null;
    // sweep entries whose car already left the world (exploded / cleared)
    for (let i = damaged.length - 1; i >= 0; i--) {
      const e = damaged[i];
      if (e.car.dead || !e.car.group || !e.car.group.parent) release(e, true);
    }
    if (damaged.length >= MAX_CARS) release(damaged[0], false);   // oldest goes back to pristine
    const e = {
      car, meshes: null, heads: null, glass: null,
      front: 0, rear: 0, sideL: 0, sideR: 0, total: 0,
      hood: null, door: null, bump: null,
      lightsOut: false, frosted: false, hoodGone: false, nudged: false,
    };
    damaged.push(e);
    return e;
  }

  function removeFlap(f) {
    if (f && f.pivot && f.pivot.parent) f.pivot.parent.remove(f.pivot);
  }
  // dropOnly: the car is being torn down anyway — just forget it, touch nothing
  function release(e, dropOnly) {
    const i = damaged.indexOf(e);
    if (i >= 0) damaged.splice(i, 1);
    removeFlap(e.hood); removeFlap(e.door); removeFlap(e.bump);
    e.hood = e.door = e.bump = null;
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
    return !!(m && m.color && m.emissive && m.emissive.b > 0.65 && m.emissive.g > 0.6 && m.color.r > 0.75);
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
    f.base = -0.55 - Math.random() * 0.25;    // sprung open toward the windshield
    f.ph = Math.random() * 6.28;
    f.pivot.rotation.x = f.base;
    e.hood = f;
  }
  function spawnDoor(e, root, d, side) {
    if (e.door || !ensureFlapGeo()) return;
    const paint = paintMatOf(root);
    const f = spawnFlap(root, paint, side * d.width * 0.5, d.height * 0.36, d.length * 0.12,
      0.055, d.height * 0.38, d.length * 0.24);
    f.side = side;
    f.ph = Math.random() * 6.28;
    f.pivot.rotation.y = Math.PI - side * 0.55;   // hinged at the front edge, sagging open
    e.door = f;
  }
  function spawnBumper(e, root, d, sgn) {
    if (e.bump || !ensureFlapGeo()) return;
    const tilt = (Math.random() < 0.5 ? 1 : -1) * (0.38 + Math.random() * 0.14);
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

  // ---- the deformation itself --------------------------------------------
  // car: a CBZ.cityCars record (or any {group,...} shaped like one — net cars
  // qualify). point: world {x,y,z}. dir: world unit-ish vector pointing INTO
  // the body (the direction the metal moves). energy: ~0..40 (closing speed /
  // severity). opts.r: override crater radius (ballistic dents pass ~0.25).
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

  function impact(car, grp, point, dir, energy, opts) {
    _dir.set(dir.x || 0, dir.y || 0, dir.z || 0);
    if (_dir.lengthSq() < 1e-6) return;
    _dir.normalize();
    const e = entryFor(car, true);
    const root = (grp.userData && grp.userData.carVisual) || grp;
    if (!e.meshes) { snapshot(e, root); findMats(e, root); }
    const d = dimsOf(grp);
    const R = opts && opts.r ? opts.r : Math.min(2.4, 0.9 + energy * 0.05);
    const R2 = R * R;
    const amp = Math.min(0.42, energy * 0.019);
    const cabinZ = d.length * 0.21, cabinY = d.height * 0.42;

    grp.updateWorldMatrix(true, true);          // impacts are rare; per-frame cost stays zero
    const wdx = _dir.x, wdy = _dir.y, wdz = _dir.z;

    for (let m = 0; m < e.meshes.length; m++) {
      const rec = e.meshes[m], mesh = rec.mesh, geo = mesh.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) continue;
      _inv.copy(mesh.matrixWorld).invert();
      _pt.set(point.x, point.y, point.z).applyMatrix4(_inv);
      const bs = geo.boundingSphere;
      if (bs && bs.center) {
        const bd = _pt.distanceTo(bs.center);
        if (bd > R + bs.radius) continue;       // crater can't reach this bucket
      }
      _dir.set(wdx, wdy, wdz).transformDirection(_inv);
      const lx = _dir.x, ly = _dir.y, lz = _dir.z;
      const attr = geo.attributes.position, pos = attr.array, base = rec.base, n = attr.count;
      const px = _pt.x, py = _pt.y, pz = _pt.z;
      let moved = false;
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        // distance from the REST shape so repeated hits deepen, not wander
        const dx = base[o] - px, dy = base[o + 1] - py, dz = base[o + 2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= R2) continue;
        const f = 1 - Math.sqrt(d2) / R;
        const push = f * f * amp;
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

  // ---- the only per-frame work: flap sway + bumper-drag sparks -----------
  // ≤14 entries, numbers only; sparks throttle per car and gate on camera range.
  let wob = 0;
  const _sparkPos = { x: 0, y: 0.12, z: 0 }, _sparkUp = { x: 0, y: 1, z: 0 };
  CBZ.onUpdate(37.9, function (dt) {
    if (dead || !damaged.length || (g && g.mode !== "city")) return;
    wob += dt;
    const cam = CBZ.camera && CBZ.camera.position;
    for (let i = damaged.length - 1; i >= 0; i--) {
      const e = damaged[i], car = e.car;
      if (car.dead || !car.group || !car.group.parent) { release(e, true); continue; }
      if (!e.hood && !e.door && !e.bump) continue;
      const sp = Math.abs(car.v || 0);
      if (e.hood) e.hood.pivot.rotation.x = e.hood.base + Math.sin(wob * 21 + e.hood.ph) * Math.min(0.13, sp * 0.012);
      if (e.door) e.door.pivot.rotation.y = Math.PI - e.door.side * (0.55 + Math.sin(wob * 5.5 + e.door.ph) * Math.min(0.2, 0.04 + sp * 0.014));
      if (e.bump && sp > 4 && cam) {
        e.bump.sparkT -= dt;
        if (e.bump.sparkT <= 0) {
          e.bump.sparkT = 0.1 + Math.random() * 0.08;
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
