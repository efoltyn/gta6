/* ============================================================
   systems/fx.js — shared disaster VFX toolkit (SURVIVAL mode).

   A small kit the disaster defs compose from, so each disaster is
   mostly data:
     CBZ.fx.particleCloud(opts) — pooled THREE.Points (rain/ash/snow/
                                  smoke/embers/dust); fall | rise | swirl.
     CBZ.fx.groundMarker(x,z,r) — pulsing telegraph disc on the floor.
     CBZ.fx.blast(x,z,opts)     — expanding shock ring + flash + shake.
     CBZ.fx.dropDebris(opts)    — a rock (shape:"rock") or a piece of a
                                  material that falls / is thrown, lands and
                                  optionally crushes. Material pieces are
                                  real fractured chunks sim'd by CBZ.debris.
     CBZ.fx.flash(s,color)      — additive full-screen white-out (0..1).

   Fire-and-forget effects (markers/blasts/debris) are animated by one
   mode-gated updater here; particle clouds are driven by their owner
   (a disaster calls cloud.update(dt) each frame while active).

   Everything uses depthWrite:false + capped counts (phones), reuses one
   geometry/material per cloud, and never allocates in the hot loop.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.scene) return;
  const THREE = window.THREE;
  const scene = CBZ.scene;

  const fx = {};
  const debris = [];   // active falling debris
  const rings = [];    // active expanding shock rings
  const markers = [];  // active telegraph markers (also self-registered)

  function rng() { return Math.random(); }

  // ---------------------------------------------------------------
  // particleCloud: one pooled Points cloud. The owner calls update()
  // each frame with a world center (camera for global weather, or a
  // fixed hazard point for a localized column).
  // ---------------------------------------------------------------
  fx.particleCloud = function (o) {
    o = o || {};
    // A staged effect may supply a local stream so adding/removing that purely
    // visual cloud does not reroll gameplay decisions elsewhere in the frame.
    // Every existing caller omits it and keeps the shared Math.random path.
    const random = typeof o.random === "function" ? o.random : rng;
    // cloud budget rides the perf/quality slider — tier0 sheds ~60% of motes
    // (default AND explicit counts), Best (tier 4) is byte-identical. Scaled
    // here only, never at call sites, so every disaster def inherits it.
    const fxq = CBZ.qScale ? CBZ.qScale(0.4, 1) : 1;
    const MAX = Math.max(1, Math.round((o.count || 300) * fxq));
    const radius = o.radius || 16;
    const top = o.top != null ? o.top : 18;
    const bottom = o.bottom != null ? o.bottom : -1.5;
    const mode = o.mode || "fall";        // fall | rise | swirl
    const vMin = o.vMin != null ? o.vMin : 20;
    const vMax = o.vMax != null ? o.vMax : 32;
    const drift = o.drift || 0;
    const driftZ = o.driftZ || 0;

    const pos = new Float32Array(MAX * 3);
    const vel = new Float32Array(MAX);
    const ang = new Float32Array(MAX);     // swirl phase
    const rad = new Float32Array(MAX);     // swirl radius
    for (let i = 0; i < MAX; i++) seed(i, 0, 0, 0, true);

    function seed(i, cx, cy, cz, anywhere) {
      const a = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * radius;
      const off = i * 3;
      pos[off] = cx + Math.cos(a) * r;
      pos[off + 2] = cz + Math.sin(a) * r;
      if (mode === "rise") pos[off + 1] = cy + (anywhere ? random() * (top) : random() * 1.5);
      else pos[off + 1] = cy + (anywhere ? random() * top : top + random() * 4);
      vel[i] = vMin + random() * (vMax - vMin);
      ang[i] = a; rad[i] = r;
    }

    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(pos, 3);
    if (attr.setUsage) attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", attr);
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      color: o.color != null ? o.color : 0xbcd2e8,
      size: o.size || 0.18,
      transparent: true, opacity: 0, depthWrite: false, fog: true,
      sizeAttenuation: o.sizeAttenuation !== false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 6;
    points.visible = false;
    scene.add(points);

    let live = 0, opacity = 0;
    const maxOpacity = o.opacity != null ? o.opacity : 0.55;

    return {
      points,
      setActive(n01) { live = Math.round(Math.max(0, Math.min(1, n01)) * MAX); opacity = Math.max(0, Math.min(1, n01)); },
      update(dt, cx, cy, cz) {
        if (cy == null) cy = 0;
        points.visible = live > 0;
        if (live <= 0) { geo.setDrawRange(0, 0); return; }
        mat.opacity = Math.min(maxOpacity, 0.1 + opacity * maxOpacity);
        const r2 = (radius + 4) * (radius + 4);
        for (let i = 0; i < live; i++) {
          const off = i * 3;
          if (mode === "swirl") {
            ang[i] += dt * (1.4 + vel[i] * 0.05);
            rad[i] += (radius * 0.5 - rad[i]) * dt * 0.4;
            pos[off] = cx + Math.cos(ang[i]) * rad[i];
            pos[off + 2] = cz + Math.sin(ang[i]) * rad[i];
            pos[off + 1] += vel[i] * 0.12 * dt;
            if (pos[off + 1] > cy + top) { pos[off + 1] = cy; }
          } else if (mode === "rise") {
            pos[off + 1] += vel[i] * 0.5 * dt;
            pos[off] += drift * dt; pos[off + 2] += driftZ * dt;
            if (pos[off + 1] > cy + top) seed(i, cx, cy, cz, false);
          } else { // fall
            pos[off + 1] -= vel[i] * dt;
            pos[off] += drift * dt; pos[off + 2] += driftZ * dt;
            let recycle = pos[off + 1] < cy + bottom;
            if (!recycle) {
              const dx = pos[off] - cx, dz = pos[off + 2] - cz;
              if (dx * dx + dz * dz > r2) recycle = true;
            }
            if (recycle) { seed(i, cx, cy, cz, false); pos[i * 3 + 1] = cy + top + random() * 4; }
          }
        }
        geo.setDrawRange(0, live);
        attr.needsUpdate = true;
      },
      dispose() {
        scene.remove(points);
        geo.dispose(); mat.dispose();
      },
    };
  };

  // ---------------------------------------------------------------
  // groundMarker: a flat pulsing disc that telegraphs an incoming
  // strike/impact. .set(progress 0..1) ramps urgency; .hit() flashes.
  // ---------------------------------------------------------------
  fx.groundMarker = function (x, z, r, color) {
    const geo = new THREE.CircleGeometry(r, 24);
    const mat = new THREE.MeshBasicMaterial({
      color: color != null ? color : 0xff3020,
      transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + 0.06, z);
    m.renderOrder = 4;
    scene.add(m);
    const handle = {
      mesh: m, _prog: 0,
      set(p) { this._prog = Math.max(0, Math.min(1, p)); },
      move(nx, nz) { m.position.x = nx; m.position.z = nz; m.position.y = (CBZ.floorAt ? CBZ.floorAt(nx, nz) : 0) + 0.06; },
      dispose() { scene.remove(m); geo.dispose(); mat.dispose(); const i = markers.indexOf(handle); if (i >= 0) markers.splice(i, 1); },
    };
    markers.push(handle);
    return handle;
  };

  // ---------------------------------------------------------------
  // blast: a self-animating expanding shock ring + camera shake + a
  // brief flash. Pure visual; the disaster applies the damage.
  // ---------------------------------------------------------------
  fx.blast = function (x, z, o) {
    o = o || {};
    const maxR = o.maxR || 24;
    const color = o.color != null ? o.color : 0xfff0c0;
    const geo = new THREE.RingGeometry(0.6, 1.4, 40);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + 0.12, z);
    m.renderOrder = 7;
    scene.add(m);
    rings.push({ mesh: m, mat, geo, r: 1, maxR, speed: o.speed || maxR / 0.7, t: 0, life: o.life || 0.9 });
    if (o.shake && CBZ.shake) CBZ.shake(o.shake);
    if (o.flash) fx.flash(o.flash, color);
    if (o.sfx && CBZ.sfx) CBZ.sfx(o.sfx);
    // blow out any window glass caught in the blast (meteors, lava bombs, the nuke)
    if (CBZ.shatterGlass) CBZ.shatterGlass(x, z, maxR * 0.85);
  };

  // ---------------------------------------------------------------
  // dropDebris: something heavy that falls (or is THROWN) onto the arena
  // floor, optionally crushing actors where it lands.
  //
  // Two kinds of thing fall, and they are drawn two different ways:
  //
  //  · A ROCK (`shape:"rock"`): a lava bomb, a meteor, a boulder off a
  //    rockfall. It IS a whole rock: a lumpy, flat-faced stone of its own
  //    (never a cube), driven here because its landing is gameplay (it
  //    crushes, it fires onLand, a kept bomb sits there for the match).
  //  · ANYTHING ELSE is a piece of MATERIAL coming off something that broke:
  //    `material` (the source's own material, pass it!) or `color` + `kind`.
  //    That is handed to CBZ.debris: a block of that material is fractured
  //    into real irregular pieces with raw cut faces, which tumble under the
  //    one rigid-body sim, pile on each other and freeze into the shared
  //    rubble. There is no box here any more (owner, 2026-09-27: "I hate big
  //    cubes of fake debris"). The gameplay half (the crush damage and
  //    onLand) rides an invisible tracker on the same arc, so a caller gets
  //    exactly the landing it always got.
  //
  // IT CAN ALSO BE THROWN. Give it `fromX`/`fromZ` (with `fromY`) and it
  // launches from there on a real ballistic arc that LANDS on (x, z): the
  // flight time is picked off the range, and vx/vy/vz are then solved for
  // that time against the gravity that body actually falls under.
  //
  //   o: {x, z, fromX?, fromZ?, fromY?, vy?, size?, dims?:{w,h,d},
  //       shape?:"rock", glow?, color?, material?, kind?, pieces?, whole?,
  //       dmg?, onLand?(x,z), linger?, keep?, owner?}
  // ---------------------------------------------------------------
  const _dropVel = new THREE.Vector3(), _dropSpin = new THREE.Vector3();
  function lumpyRock(s) {
    // a flat-faced stone: an icosphere pushed in and out per vertex (the SAME
    // push for every copy of a vertex, so it stays closed), then squashed a
    // little on each axis, so no two rocks share a silhouette
    let g = new THREE.IcosahedronGeometry(1, 1);
    if (g.index) g = g.toNonIndexed();
    const p = g.attributes.position.array;
    const kx = 0.8 + rng() * 0.45, ky = 0.6 + rng() * 0.35, kz = 0.8 + rng() * 0.45;
    const seed = rng() * 1000;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      const hh = Math.sin(Math.round(x * 100) * 12.9898 + Math.round(y * 100) * 78.233 + Math.round(z * 100) * 37.719 + seed) * 43758.5453;
      const f = 0.78 + (hh - Math.floor(hh)) * 0.36;
      p[i] = x * f * kx * s; p[i + 1] = y * f * ky * s; p[i + 2] = z * f * kz * s;
    }
    g.computeVertexNormals();
    return { geo: g, h: 2 * ky * s * 0.95 };
  }
  function pieceMaterial(o) {
    if (o.material) return o.material;
    const c = o.color != null ? o.color : 0x8b9097;
    return CBZ.cmat ? CBZ.cmat(c) : new THREE.MeshLambertMaterial({ color: c });
  }
  fx.dropDebris = function (o) {
    o = o || {};
    const rock = o.shape === "rock";
    const D = CBZ.debris;
    const s = o.size || (0.6 + rng() * 1.4);
    const x = o.x, z = o.z;
    const sy = o.fromY != null ? o.fromY : 26;
    // a rock falls under the game's gravity; a piece falls under debris.js's
    // (9.81) because that is the sim that actually carries it
    const gg = rock ? ((CBZ.TUNE && CBZ.TUNE.gravity) || 20) : 9.81;
    let geo = null, mat = null, m = null, h;
    if (rock) {
      const r = lumpyRock(s * 0.62);
      geo = r.geo; h = r.h;
      /* `glow: true` — incandescent rock. An unlit material IS incandescence
         (the volcano's own doctrine: it ignores the sun, so it is exactly as
         bright at night as at noon). Opaque, never additive. */
      mat = o.glow
        ? new THREE.MeshBasicMaterial({ color: o.color != null ? o.color : 0xff8a2e })
        : (CBZ.mat ? CBZ.mat(o.color != null ? o.color : 0x6b7079) : new THREE.MeshLambertMaterial({ color: 0x6b7079 }));
      m = new THREE.Mesh(geo, mat);
    } else {
      h = o.dims ? o.dims.h : s * (0.6 + rng() * 0.8);
    }
    let vx = 0, vz = 0, vy = o.vy || 0, px = x, pz = z;
    if (o.fromX != null && o.fromZ != null) {
      px = o.fromX; pz = o.fromZ;
      const dx = x - px, dz = z - pz;
      const range = Math.hypot(dx, dz);
      // long throws hang longer, and nothing arrives before you can look up
      const T = Math.max(0.9, 0.75 + range / 26);
      const ty = (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + h / 2;
      vx = dx / T; vz = dz / T;
      vy = ((ty - sy) + 0.5 * gg * T * T) / T;
    }
    if (m) {
      m.position.set(px, sy, pz);
      m.castShadow = true;
      m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      scene.add(m);
    } else if (D) {
      const w = o.dims ? o.dims.w : s, d = o.dims ? o.dims.d : s;
      _dropVel.set(vx, vy, vz);
      _dropSpin.set((rng() - 0.5) * 6, (rng() - 0.5) * 6, (rng() - 0.5) * 6);
      D.shatter({ box: { minX: px - w / 2, maxX: px + w / 2, minY: sy - h / 2, maxY: sy + h / 2, minZ: pz - d / 2, maxZ: pz + d / 2 },
        material: pieceMaterial(o) }, {
        kind: o.kind, launch: false, velocity: _dropVel, angular: _dropSpin,
        maxPieces: o.pieces || (o.whole ? 1 : (s > 1.2 ? 4 : s > 0.6 ? 3 : 2)),
        // pieces a little over half the block: it always breaks (never one
        // whole cube); snap off, a thing in flight is not a pole with a stump
        size: Math.max(0.12, Math.max(w, h, d) / 1.9), snap: false,
        whole: o.whole || false, owner: o.owner || "fx", grit: false, dust: false, solid: !!o.keep && s > 1.1,
      });
    }
    // the tracker: the rock's own body, or (for a piece) the invisible point
    // that carries the landing damage along the pieces' arc
    if (!m && !(o.dmg > 0) && !o.onLand) return;
    debris.push({
      mesh: m, geo, mat, x: px, z: pz, y: sy, vy: vy, vx: vx, vz: vz, h, g: gg,
      spin: { x: (rng() - 0.5) * 4, z: (rng() - 0.5) * 4 },
      landed: false, lingerT: o.linger != null ? o.linger : 6,
      radius: Math.max(s, o.dims ? Math.max(o.dims.w, o.dims.d) : s) * 0.6, dmg: o.dmg || 0, onLand: o.onLand || null,
      keep: !!o.keep,
    });
  };

  // ---------------------------------------------------------------
  // flash: additive white-out written into survEnv (driven to the DOM
  // by the lighting/HUD layer). s is 0..1; max wins this frame.
  // ---------------------------------------------------------------
  fx.flash = function (s, color) {
    const e = CBZ.survEnv;
    e.flash = Math.max(e.flash, Math.max(0, Math.min(1, s)));
    if (color != null) e.flashColor = color;
  };

  // ---- one mode-gated updater drives all fire-and-forget effects ----
  CBZ.onUpdate(27, function (dt) {
    if (!CBZ.islandModeOn(CBZ.game.mode)) return;
    const g = CBZ.TUNE.gravity;

    // flash decays toward 0
    CBZ.survEnv.flash *= Math.pow(0.0025, dt);
    if (CBZ.survEnv.flash < 0.01) CBZ.survEnv.flash = 0;

    // expanding shock rings
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t += dt;
      r.r = Math.min(r.maxR, r.r + r.speed * dt);
      r.mesh.scale.set(r.r, r.r, r.r);
      r.mat.opacity = Math.max(0, 0.9 * (1 - r.t / r.life));
      if (r.t >= r.life) { scene.remove(r.mesh); r.geo.dispose(); r.mat.dispose(); rings.splice(i, 1); }
    }

    // telegraph markers pulse with urgency
    for (const mk of markers) {
      const pulse = 0.25 + 0.55 * mk._prog * (0.6 + 0.4 * Math.sin(CBZ.now * 0.012 * (1 + mk._prog * 2)));
      mk.mesh.material.opacity = pulse;
      const sc = 1 + 0.06 * Math.sin(CBZ.now * 0.012);
      mk.mesh.scale.set(sc, sc, 1);
    }

    // falling debris: rocks (with a mesh) and the invisible landing
    // trackers of material pieces (CBZ.debris draws and settles those)
    for (let i = debris.length - 1; i >= 0; i--) {
      const b = debris[i];
      if (!b.landed) {
        b.vy -= (b.g || g) * dt;
        b.y += b.vy * dt;
        // a thrown piece carries its horizontal velocity, and b.x/b.z follow
        // it so the floor probe and the landing damage stay under the rock
        b.x += b.vx * dt; b.z += b.vz * dt;
        if (b.mesh) {
          b.mesh.position.set(b.x, b.y, b.z);
          b.mesh.rotation.x += b.spin.x * dt;
          b.mesh.rotation.z += b.spin.z * dt;
        }
        const floor = (CBZ.floorAt ? CBZ.floorAt(b.x, b.z) : 0) + b.h / 2;
        if (b.y <= floor) {
          b.y = floor; b.landed = true;
          if (b.mesh) b.mesh.position.y = floor;
          if (CBZ.shake) CBZ.shake(b.mesh ? 0.18 : 0.1);
          if (b.dmg > 0 && CBZ.surv) CBZ.surv.hurtRadius(b.x, b.z, b.radius + 0.6, b.dmg, { instakill: b.dmg >= 999 });
          if (b.onLand) try { b.onLand(b.x, b.z); } catch (e) {}
          if (!b.mesh) { debris.splice(i, 1); continue; }
          // a rock lands in its own dust
          if (CBZ.debris && b.h > 0.5) CBZ.debris.dust(b.x, floor - b.h / 2 + 0.2, b.z, { kind: "dirt", power: Math.min(1.5, b.h * 0.5), radius: Math.min(2, b.h * 0.6) });
        }
      } else if (!b.keep) {
        b.lingerT -= dt;
        if (b.lingerT <= 0) { scene.remove(b.mesh); b.geo.dispose(); if (b.mat.dispose) b.mat.dispose(); debris.splice(i, 1); }
      }
    }
  });

  // clear all transient fx (called on match reset)
  fx.clear = function () {
    for (const r of rings) { scene.remove(r.mesh); r.geo.dispose(); r.mat.dispose(); }
    rings.length = 0;
    for (const b of debris) if (b.mesh) { scene.remove(b.mesh); b.geo.dispose(); if (b.mat.dispose) b.mat.dispose(); }
    debris.length = 0;
    if (CBZ.debris) CBZ.debris.clear("fx");
    for (let i = markers.length - 1; i >= 0; i--) markers[i].dispose();
    CBZ.survEnv.flash = 0;
  };

  CBZ.fx = fx;
})();
