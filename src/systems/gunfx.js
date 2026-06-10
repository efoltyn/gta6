/* ============================================================
   systems/gunfx.js — lightweight, mode-AGNOSTIC gunfire visuals
   (tracer beams + muzzle flashes) for the prison/escape game,
   where the survival VFX kit (CBZ.fx) is gated off.

   Used by the watch-tower armed response (systems/capture.js) and
   by armed inmates returning fire in a stand-off (systems/
   intimidate.js). Everything is pooled and self-animating on a
   single always-updater; no per-frame allocation.

     CBZ.tracer(from, to, opts)  — a fading line + (by default) a
                                   muzzle flash at `from`.
     CBZ.muzzleFlash(pos, opts)  — a brief additive glow.
     CBZ.bulletImpact(pos,n,o)   — debris burst; o.power scales it by
                                   CALIBER, o.kind "chip" + o.color =
                                   paint flecks in a shot car's coat.
     CBZ.bulletHole(pos, n, o)   — PERSISTENT pocked decal (pooled,
                                   64 cap, oldest recycled, skipped
                                   past 50u). o.parent mounts it on a
                                   car body so the hole RIDES the car.

   WHY the holes: the evidence a firefight leaves is half its drama —
   a wall you magdumped must STAY pocked, and a 7.62 hole must read
   bigger than a 9mm (o.size carries the caliber).

   `from`/`to` are any {x,y,z}. opts: {color, life, muzzle:false,
   muzzleScale, scale}.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.scene) return;
  const THREE = window.THREE;
  const scene = CBZ.scene;

  // ---- pooled fading tracer lines ----
  const linePool = [];
  const liveLines = [];
  function takeLine() {
    let m = linePool.pop();
    if (!m) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.95, depthWrite: false });
      m = new THREE.Line(geo, mat);
      m.frustumCulled = false; m.renderOrder = 8;
      scene.add(m);
    }
    return m;
  }

  // ---- pooled muzzle-flash sprites (a soft additive glow) ----
  let flashTex = null;
  function makeFlashTex() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,244,200,1)");
    g.addColorStop(0.4, "rgba(255,184,80,0.7)");
    g.addColorStop(1, "rgba(255,120,30,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  const flashPool = [];
  const liveFlashes = [];
  function takeFlash() {
    let s = flashPool.pop();
    if (!s) {
      if (!flashTex) flashTex = makeFlashTex();
      s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flashTex, transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      s.renderOrder = 9;
      scene.add(s);
    }
    return s;
  }

  CBZ.muzzleFlash = function (pos, opts) {
    opts = opts || {};
    const s = takeFlash();
    s.position.set(pos.x, pos.y, pos.z);
    const sc = (opts.scale || 1) * (0.7 + Math.random() * 0.5);
    s.scale.set(sc, sc, sc);
    s.material.opacity = 1;
    s.visible = true;
    const life = opts.life || 0.06;
    liveFlashes.push({ spr: s, life: life, max: life });
    return s;
  };

  CBZ.tracer = function (from, to, opts) {
    opts = opts || {};
    const m = takeLine();
    const p = m.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = to.x;   p[4] = to.y;   p[5] = to.z;
    m.geometry.attributes.position.needsUpdate = true;
    m.material.color.setHex(opts.color != null ? opts.color : 0xfff2b0);
    m.material.opacity = 0.95;
    m.visible = true;
    const life = opts.life || 0.07;
    liveLines.push({ mesh: m, life: life, max: life });
    if (opts.muzzle !== false) CBZ.muzzleFlash(from, { scale: opts.muzzleScale || 0.9 });
    return m;
  };

  // ---- JUICY bullet impacts: a short-lived burst of debris streaks that fly
  // out along the surface normal (GTA/Max-Payne style stretched billboards),
  // plus a flat scorch puff. Pooled, additive sparks + soft dust. Drive with
  // CBZ.bulletImpact(pos, normal, {kind, power}). kind: "spark" (metal/stone,
  // bright orange sparks) | "dust" (concrete/dirt, brown puff) | "wood".
  const _v0 = new THREE.Vector3();
  const _v1 = new THREE.Vector3();
  const _vn = new THREE.Vector3();
  const _vt = new THREE.Vector3();
  const _vb = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function makeSparkTex() {
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,235,1)");
    g.addColorStop(0.4, "rgba(255,196,96,0.9)");
    g.addColorStop(1, "rgba(180,60,10,0)");
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  }
  function makePuffTex() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 1, 32, 32, 31);
    g.addColorStop(0, "rgba(220,210,190,0.9)");
    g.addColorStop(0.5, "rgba(150,135,110,0.5)");
    g.addColorStop(1, "rgba(120,105,80,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  let sparkTex = null, puffTex = null;

  // streak particles (thin stretched boxes) for flying sparks/debris
  const streakGeo = new THREE.BoxGeometry(1, 1, 1);
  const streaks = [];
  let streakIdx = 0;
  for (let i = 0; i < 56; i++) {
    const m = new THREE.Mesh(streakGeo, new THREE.MeshBasicMaterial({
      color: 0xffc864, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    m.visible = false; m.frustumCulled = false; m.renderOrder = 9;
    scene.add(m);
    streaks.push({ mesh: m, vel: new THREE.Vector3(), life: 0, max: 0.001, grav: 0, len: 0, w: 0 });
  }
  // flat scorch/dust puffs that bloom and fade at the impact point
  const puffs = [];
  let puffIdx = 0;
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      transparent: true, opacity: 0, depthWrite: false, depthTest: true,
    }));
    s.visible = false; s.renderOrder = 8;
    scene.add(s);
    puffs.push({ spr: s, life: 0, max: 0.001, grow: 1 });
  }

  CBZ.bulletImpact = function (pos, normal, opts) {
    opts = opts || {};
    if (!sparkTex) { sparkTex = makeSparkTex(); puffTex = makePuffTex(); }
    const kind = opts.kind || "spark";
    const power = opts.power != null ? opts.power : 1;
    _vn.set(normal ? normal.x : 0, normal ? normal.y : 1, normal ? normal.z : 0);
    if (_vn.lengthSq() < 1e-6) _vn.set(0, 1, 0); else _vn.normalize();
    // tangent basis on the surface for cone-spread debris
    _vt.crossVectors(_vn, UP);
    if (_vt.lengthSq() < 1e-5) _vt.set(1, 0, 0); else _vt.normalize();
    _vb.crossVectors(_vn, _vt).normalize();

    const dust = kind === "dust" || kind === "wood";
    // "chip": solid (non-glowing) flecks in the SURFACE's own colour — paint
    // off a shot car panel. opts.color carries the coat; heavier rounds throw more.
    const chip = kind === "chip";
    const baseColor = opts.color != null ? opts.color
      : (kind === "wood" ? 0xb98b50 : dust ? 0xc8b48c : 0xffc864);
    // power is the round's CALIBER dial: an AK burst chews visibly harder than 9mm
    const count = Math.min(12, Math.round((dust ? 4 : chip ? 5 : 6) * power) + 2);
    for (let i = 0; i < count; i++) {
      const p = streaks[streakIdx];
      streakIdx = (streakIdx + 1) % streaks.length;
      // ricochet cone hugging the normal, with random tangential scatter
      const a = Math.random() * Math.PI * 2;
      const spread = 0.35 + Math.random() * 0.75;
      const speed = (dust ? 2.2 : chip ? 3.4 : 5.5) + Math.random() * (dust ? 2.5 : chip ? 3 : 7) * power;
      p.vel.copy(_vn).multiplyScalar(0.6 + Math.random() * 0.5)
        .addScaledVector(_vt, Math.cos(a) * spread)
        .addScaledVector(_vb, Math.sin(a) * spread)
        .normalize().multiplyScalar(speed);
      p.mesh.position.copy(pos).addScaledVector(_vn, 0.02);
      p.mesh.material.color.setHex(baseColor);
      p.mesh.material.opacity = dust ? 0.7 : 1;
      p.mesh.material.blending = (dust || chip) ? THREE.NormalBlending : THREE.AdditiveBlending;
      p.len = dust ? 0.05 : chip ? 0.09 : (0.14 + Math.random() * 0.22);
      p.w = dust ? 0.05 : chip ? 0.032 : 0.018;
      p.grav = dust ? 1.5 : chip ? 11 : 16;
      p.life = dust ? (0.16 + Math.random() * 0.12) : chip ? (0.13 + Math.random() * 0.1) : (0.1 + Math.random() * 0.14);
      p.max = p.life;
      p.mesh.visible = true;
    }
    // a flat puff at the surface (chips kick a small grey paint-powder puff)
    const soft = dust || chip;
    const f = puffs[puffIdx];
    puffIdx = (puffIdx + 1) % puffs.length;
    f.spr.material.map = soft ? puffTex : sparkTex;
    f.spr.material.color.setHex(dust ? 0xffffff : chip ? 0xb9b9b9 : 0xffd28c);
    f.spr.material.blending = soft ? THREE.NormalBlending : THREE.AdditiveBlending;
    f.spr.position.copy(pos).addScaledVector(_vn, 0.03);
    const s0 = (dust ? 0.28 : chip ? 0.18 : 0.2) * (0.8 + power * 0.4);
    f.spr.scale.set(s0, s0, s0);
    f.spr.material.opacity = dust ? 0.75 : chip ? 0.6 : 1;
    f.spr.visible = true;
    f.life = soft ? 0.22 : 0.1;
    f.max = f.life;
    f.grow = dust ? 4.5 : chip ? 3.5 : 2;
  };

  // ---- PERSISTENT BULLET HOLES — the world REMEMBERS the firefight ---------
  // A fixed pool of small dark pock decals (cap 64, oldest recycled) stamped at
  // the hit point along the surface normal. opts.size carries CALIBER (an AK
  // pock reads visibly bigger than a 9mm), opts.parent mounts the decal on a
  // moving body (a car group) so the hole rides the panel it punched. LOD: a
  // pock you can't see isn't worth a slot — skipped beyond 50u of the camera.
  // The shared geo/material are flagged _shared so vehicles.js' teardown
  // traversal (explodeCar/clearCars disposes non-shared resources) spares them.
  const HOLE_CAP = 64, HOLE_LOD = 50;
  const holes = [];
  let holeIdx = 0, holeGeo = null, holeMat = null;
  const _zAxis = new THREE.Vector3(0, 0, 1);
  const _hq = new THREE.Quaternion();
  const _hp = new THREE.Vector3();
  const _hn = new THREE.Vector3();
  function makeHoleMat() {
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(16, 16, 1, 16, 16, 15);
    g.addColorStop(0, "rgba(6,6,8,0.96)");
    g.addColorStop(0.42, "rgba(16,16,20,0.85)");
    g.addColorStop(0.72, "rgba(36,36,42,0.3)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    const m = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    m._shared = true;
    return m;
  }
  CBZ.bulletHole = function (pos, normal, opts) {
    opts = opts || {};
    const cam = CBZ.camera;
    const d = opts.dist != null ? opts.dist
      : (cam ? Math.hypot(pos.x - cam.position.x, pos.y - cam.position.y, pos.z - cam.position.z) : 0);
    if (d > HOLE_LOD) return null;
    if (!holeMat) {
      holeMat = makeHoleMat();
      holeGeo = new THREE.PlaneGeometry(1, 1);
      holeGeo._shared = true;
    }
    let m;
    if (holes.length < HOLE_CAP) {
      m = new THREE.Mesh(holeGeo, holeMat);
      m.renderOrder = 4;
      holes.push(m);
    } else {
      m = holes[holeIdx];
      holeIdx = (holeIdx + 1) % HOLE_CAP;
    }
    const parent = opts.parent || scene;
    if (m.parent !== parent) parent.add(m);   // .add() detaches from any old parent
    m.visible = true;
    _hn.set(normal ? normal.x : 0, normal ? normal.y : 0, normal ? normal.z : 1);
    if (_hn.lengthSq() < 1e-6) _hn.set(0, 0, 1); else _hn.normalize();
    _hp.set(pos.x, pos.y, pos.z);
    if (parent !== scene) {
      // mount in the parent's LOCAL frame so the pock moves with the panel
      if (parent.updateWorldMatrix) parent.updateWorldMatrix(true, false);
      parent.worldToLocal(_hp);
      parent.getWorldQuaternion(_hq);
      _hn.applyQuaternion(_hq.invert()).normalize();
    }
    m.position.copy(_hp).addScaledVector(_hn, 0.025);  // nudge off the surface — no z-fight
    m.quaternion.setFromUnitVectors(_zAxis, _hn);
    m.rotateZ(Math.random() * Math.PI);
    const s = (opts.size || 0.24) * (0.85 + Math.random() * 0.3);
    m.scale.set(s, s, 1);
    return m;
  };
  // wipe every pock (new run / world rebuild) — pool survives, marks don't
  CBZ.bulletHolesReset = function () {
    for (let i = 0; i < holes.length; i++) {
      holes[i].visible = false;
      if (holes[i].parent !== scene) scene.add(holes[i]);  // un-mount from dead cars
    }
  };

  // one always-updater fades + recycles every transient (runs in all modes,
  // like the rig/facial layers, so brief bursts never freeze mid-fade).
  CBZ.onAlways(54, function (dt) {
    for (let i = liveLines.length - 1; i >= 0; i--) {
      const t = liveLines[i];
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / t.max) * 0.95;
      if (t.life <= 0) { t.mesh.visible = false; linePool.push(t.mesh); liveLines.splice(i, 1); }
    }
    for (let i = liveFlashes.length - 1; i >= 0; i--) {
      const f = liveFlashes[i];
      f.life -= dt;
      f.spr.material.opacity = Math.max(0, f.life / f.max);
      if (f.life <= 0) { f.spr.visible = false; flashPool.push(f.spr); liveFlashes.splice(i, 1); }
    }
    // bullet-impact streaks: integrate velocity + gravity, stretch along motion
    for (let i = 0; i < streaks.length; i++) {
      const p = streaks[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vel.y -= p.grav * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const sp = p.vel.length();
      if (sp > 0.01) {
        _v0.copy(p.vel).multiplyScalar(1 / sp);
        p.mesh.quaternion.setFromUnitVectors(UP, _v0);
      }
      p.mesh.scale.set(p.w, p.len + Math.min(0.4, sp * 0.012), p.w);
      p.mesh.material.opacity = Math.max(0, p.life / p.max) * (p.grav > 5 ? 1 : 0.7);
    }
    for (let i = 0; i < puffs.length; i++) {
      const f = puffs[i];
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.spr.visible = false; continue; }
      const k = 1 + f.grow * dt;
      f.spr.scale.multiplyScalar(k);
      f.spr.material.opacity = Math.max(0, f.life / f.max) * (f.spr.material.blending === THREE.NormalBlending ? 0.75 : 1);
    }
  });
})();
