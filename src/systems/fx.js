/* ============================================================
   systems/fx.js — shared disaster VFX toolkit (SURVIVAL mode).

   A small kit the disaster defs compose from, so each disaster is
   mostly data:
     CBZ.fx.particleCloud(opts) — pooled THREE.Points (rain/ash/snow/
                                  smoke/embers/dust); fall | rise | swirl.
     CBZ.fx.groundMarker(x,z,r) — pulsing telegraph disc on the floor.
     CBZ.fx.blast(x,z,opts)     — expanding shock ring + flash + shake.
     CBZ.fx.dropDebris(opts)    — a box that falls under gravity, lands,
                                  optionally crushes, then lingers as rubble.
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
    const MAX = o.count || 300;
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
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * radius;
      const off = i * 3;
      pos[off] = cx + Math.cos(a) * r;
      pos[off + 2] = cz + Math.sin(a) * r;
      if (mode === "rise") pos[off + 1] = cy + (anywhere ? rng() * (top) : rng() * 1.5);
      else pos[off + 1] = cy + (anywhere ? rng() * top : top + rng() * 4);
      vel[i] = vMin + rng() * (vMax - vMin);
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
            if (recycle) { seed(i, cx, cy, cz, false); pos[i * 3 + 1] = cy + top + rng() * 4; }
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
  // dropDebris: a box that falls under gravity onto the arena floor,
  // optionally crushing actors on landing, then lingers as rubble.
  // ---------------------------------------------------------------
  fx.dropDebris = function (o) {
    o = o || {};
    const s = o.size || (0.6 + rng() * 1.4);
    const w = s, h = s * (0.6 + rng() * 0.8), d = s;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = CBZ.mat ? CBZ.mat(o.color != null ? o.color : 0x6b7079) : new THREE.MeshLambertMaterial({ color: 0x6b7079 });
    const m = new THREE.Mesh(geo, mat);
    const x = o.x, z = o.z;
    m.position.set(x, o.fromY != null ? o.fromY : 26, z);
    m.castShadow = true;
    m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    scene.add(m);
    debris.push({
      mesh: m, geo, mat, x, z, vy: o.vy || 0, h,
      spin: { x: (rng() - 0.5) * 4, z: (rng() - 0.5) * 4 },
      landed: false, lingerT: o.linger != null ? o.linger : 6,
      radius: Math.max(w, d) * 0.6, dmg: o.dmg || 0, onLand: o.onLand || null,
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
    if (CBZ.game.mode !== "survival") return;
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

    // falling debris
    for (let i = debris.length - 1; i >= 0; i--) {
      const b = debris[i];
      if (!b.landed) {
        b.vy -= g * dt;
        b.mesh.position.y += b.vy * dt;
        b.mesh.rotation.x += b.spin.x * dt;
        b.mesh.rotation.z += b.spin.z * dt;
        const floor = (CBZ.floorAt ? CBZ.floorAt(b.x, b.z) : 0) + b.h / 2;
        if (b.mesh.position.y <= floor) {
          b.mesh.position.y = floor; b.landed = true;
          if (CBZ.shake) CBZ.shake(0.18);
          if (b.dmg > 0 && CBZ.surv) CBZ.surv.hurtRadius(b.x, b.z, b.radius + 0.6, b.dmg, { instakill: b.dmg >= 999 });
          if (b.onLand) try { b.onLand(b.x, b.z); } catch (e) {}
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
    for (const b of debris) { scene.remove(b.mesh); b.geo.dispose(); if (b.mat.dispose) b.mat.dispose(); }
    debris.length = 0;
    for (let i = markers.length - 1; i >= 0; i--) markers[i].dispose();
    CBZ.survEnv.flash = 0;
  };

  CBZ.fx = fx;
})();
