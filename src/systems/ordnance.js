/* ============================================================
   systems/ordnance.js — THINGS THAT FALL, AND WHAT THEY DO WHEN THEY LAND.

   WHY. Explosions existed in this engine in five places and agreed on
   nothing: `city/strategic.js` drops the B-2's stick, `city/nukefx.js`
   owns the big one, `weapons/*` grenades and the launcher each roll
   their own splash, `systems/fx.js` has the particles. Every one of
   them re-derived the same three hard parts — the BALLISTIC path, the
   FALLOFF, and the question of whether the target was actually EXPOSED
   — and only one of them got the third right.

   This file is the shared answer. It owns four things and nothing else:

   1. THE FALL. A released store keeps the aircraft's velocity, gains
      gravity and loses energy to drag. That is why you cannot aim a
      bomb at what is under you: it goes where the AEROPLANE was going.
      Nothing about that is simulated as a special case — it falls out
      of releasing with the parent's velocity, which is also the real
      reason bombers fly straight and level on the run-in.

   2. THE PREDICTION. `predict()` integrates the same equation forward
      to the ground and returns the impact point and time-to-impact.
      One function, and it is the SAME integrator the bomb itself uses,
      so the aiming reticle cannot disagree with the bomb — the class of
      bug where the pipper lies to you is structurally impossible here.

   3. THE BLAST, AND COVER. Damage is `power × (1 − d/R)²`, and then it
      asks the world whether the target could SEE the detonation
      (`CBZ.micro.segmentBlocked`, the same ray the movement floor
      uses). A wall between you and the bang is worth 75%. THIS IS THE
      WHOLE GAME OF BEING BOMBED: without it, cover is decoration and
      the only counterplay is running; with it, a roof is a decision.

   4. THE TELEGRAPH. Ordnance in the air paints a THREAT RING on the
      ground at its predicted impact point, sized to its blast radius
      and tightening as it falls. An explosion that arrives unannounced
      is not difficulty, it is a coin flip — the ring is what converts
      "you died" into "you should have moved". Callers can read the
      same data (`activeThreats()`) for HUD, audio and AI.

   POOLED, ALWAYS. Fireballs, shockwave rings, smoke and craters all
   come from fixed pools sized at init. A hundred bombs in ten minutes
   must not allocate a hundred meshes, and a crater field must not grow
   without bound — the oldest crater is recycled, which is also why the
   city never accumulates a million-triangle scar.

   USE:
     CBZ.ordnance.init({groundAt, scene});
     const t = CBZ.ordnance.addTarget({pos, team, onDamage});
     CBZ.ordnance.release({pos, vel, team:"red", radius:52, power:190});
     // stepped automatically off CBZ.micro.onFrame when present.

   Flags: ORDNANCE_V1 (master), ORDNANCE_THREAT_RINGS, ORDNANCE_CRATERS,
   ORDNANCE_COVER_FACTOR. Audit: CBZ.ordnanceAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const THREE = window.THREE;
  if (!THREE) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  const C = CBZ.CONFIG;
  if (C.ORDNANCE_V1 == null) C.ORDNANCE_V1 = true;
  if (C.ORDNANCE_THREAT_RINGS == null) C.ORDNANCE_THREAT_RINGS = true;
  if (C.ORDNANCE_CRATERS == null) C.ORDNANCE_CRATERS = 90;
  if (C.ORDNANCE_COVER_FACTOR == null) C.ORDNANCE_COVER_FACTOR = 0.25;
  if (C.ORDNANCE_V1 === false) return;

  const ord = (CBZ.ordnance = CBZ.ordnance || {});
  const G = 9.81;

  let scene = null, groundAt = null, blocked = null, ready = false;
  const bombs = [], targets = [], fx = [], rings = [], craters = [];
  let craterAt = 0;
  const stats = { released: 0, detonated: 0, hits: 0, kills: 0 };

  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

  // ---- KINDS. A kind is a claim about weight and lethality, and the two
  //      are linked on purpose: the heavy store falls straighter (less drag
  //      per unit mass) AND hurts more, so choosing it is a real trade
  //      against the number you can carry.
  const KINDS = {
    iron: { radius: 46, power: 190, drag: 0.00022, size: 1.25, len: 4.2, color: 0x59616b, fuse: 0, name: "500 lb IRON" },
    heavy: { radius: 78, power: 320, drag: 0.00014, size: 1.9, len: 6.2, color: 0x4b5058, fuse: 0, name: "2000 lb HEAVY" },
    cluster: { radius: 30, power: 110, drag: 0.00030, size: 0.9, len: 2.8, color: 0x6b6250, fuse: 0, name: "CLUSTER" },
    rocket: { radius: 26, power: 130, drag: 0.00010, size: 0.6, len: 2.4, color: 0xa9a294, fuse: 0, name: "ROCKET" },
  };
  ord.kinds = KINDS;

  // ---------------------------------------------------------------- INIT
  ord.init = function (opts) {
    opts = opts || {};
    scene = opts.scene || CBZ.scene;
    groundAt = opts.groundAt || function () { return 0; };
    blocked = opts.blocked || (CBZ.micro && CBZ.micro.segmentBlocked) || function () { return false; };
    if (ready) return ord;
    ready = true;

    // ---- pools
    const FXN = opts.fxPool || 22;
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xffb352, transparent: true, opacity: 1, depthWrite: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 1, depthWrite: false });
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0x3a3630, transparent: true, opacity: 0.9, depthWrite: false });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    const sphere = new THREE.SphereGeometry(1, 10, 8);
    const ringGeo = new THREE.RingGeometry(0.85, 1, 32, 1);
    ringGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < FXN; i++) {
      const g = new THREE.Group();
      g.visible = false;
      const core = new THREE.Mesh(sphere, coreMat.clone());
      const fire = new THREE.Mesh(sphere, fireMat.clone());
      const wave = new THREE.Mesh(ringGeo, ringMat.clone());
      g.add(core); g.add(fire); g.add(wave);
      const puffs = [];
      for (let p = 0; p < 5; p++) {
        const s = new THREE.Mesh(sphere, smokeMat.clone());
        s.userData.dir = new THREE.Vector3();
        g.add(s); puffs.push(s);
      }
      scene.add(g);
      fx.push({ group: g, core: core, fire: fire, wave: wave, puffs: puffs, t: -1, dur: 1, R: 1 });
    }

    // ---- threat rings (see THE TELEGRAPH)
    if (C.ORDNANCE_THREAT_RINGS) {
      const trGeo = new THREE.RingGeometry(0.9, 1, 40, 1);
      trGeo.rotateX(-Math.PI / 2);
      for (let i = 0; i < 40; i++) {
        const m = new THREE.Mesh(trGeo, new THREE.MeshBasicMaterial({
          color: 0xff4436, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false,
        }));
        m.visible = false;
        m.renderOrder = 5;
        scene.add(m);
        rings.push(m);
      }
    }

    // ---- crater pool
    if (C.ORDNANCE_CRATERS > 0) {
      const cg = new THREE.CircleGeometry(1, 18);
      cg.rotateX(-Math.PI / 2);
      const cmat = new THREE.MeshLambertMaterial({ color: 0x2a2622, transparent: true, opacity: 0.9 });
      for (let i = 0; i < (C.ORDNANCE_CRATERS | 0); i++) {
        const m = new THREE.Mesh(cg, cmat);
        m.visible = false;
        m.renderOrder = 2;
        scene.add(m);
        craters.push(m);
      }
    }

    if (CBZ.micro && CBZ.micro.onFrame) CBZ.micro.onFrame(ord.step, { id: "ordnance", order: 20 });
    return ord;
  };

  // ------------------------------------------------------------- TARGETS
  // A target is anything a blast should be able to hurt. The contract is
  // deliberately tiny — a position and a callback — so an NPC, a player, a
  // vehicle and a building can all be one without sharing a base class.
  ord.addTarget = function (t) {
    if (!t) return null;
    t.alive = t.alive !== false;
    targets.push(t);
    return t;
  };
  ord.removeTarget = function (t) {
    const i = targets.indexOf(t);
    if (i >= 0) targets.splice(i, 1);
  };
  ord.targets = targets;

  // ----------------------------------------------------------- BALLISTICS
  // ONE integrator, used by the bomb AND by the prediction (see header).
  function integrate(px, py, pz, vx, vy, vz, drag, dt) {
    const sp = Math.hypot(vx, vy, vz);
    const d = drag * sp;
    vx -= vx * d * dt;
    vz -= vz * d * dt;
    vy -= (vy * d + G) * dt;
    return [px + vx * dt, py + vy * dt, pz + vz * dt, vx, vy, vz];
  }

  // Where does it land, and when? Steps the same equation to the ground.
  ord.predict = function (pos, vel, kind, maxT) {
    const K = KINDS[kind] || KINDS.iron;
    let px = pos.x, py = pos.y, pz = pos.z;
    let vx = vel.x, vy = vel.y, vz = vel.z;
    const dt = 0.08;
    const T = maxT || 40;
    for (let t = 0; t < T; t += dt) {
      const r = integrate(px, py, pz, vx, vy, vz, K.drag, dt);
      px = r[0]; py = r[1]; pz = r[2]; vx = r[3]; vy = r[4]; vz = r[5];
      const g = groundAt ? groundAt(px, pz) : 0;
      if (py <= g) return { x: px, y: g, z: pz, t: t, hit: true };
    }
    return { x: px, y: py, z: pz, t: T, hit: false };
  };

  // ------------------------------------------------------------- RELEASE
  let bombGeo = null, bombMats = null;
  function bombMesh(K) {
    if (!bombGeo) {
      bombGeo = new THREE.CylinderGeometry(0.5, 0.34, 1, 8);
      bombMats = {};
    }
    if (!bombMats[K.color]) bombMats[K.color] = new THREE.MeshLambertMaterial({ color: K.color });
    const g = new THREE.Group();
    const body = new THREE.Mesh(bombGeo, bombMats[K.color]);
    body.scale.set(K.size, K.len, K.size);
    body.rotation.x = Math.PI / 2;          // long axis down −Z, like the airframes
    g.add(body);
    const fin = new THREE.Mesh(
      CBZ.boxGeom ? CBZ.boxGeom(0.12, K.size * 2.0, K.len * 0.28) : new THREE.BoxGeometry(0.12, K.size * 2.0, K.len * 0.28),
      bombMats[K.color]);
    fin.position.z = K.len * 0.36;
    g.add(fin);
    const fin2 = fin.clone();
    fin2.rotation.z = Math.PI / 2;
    g.add(fin2);
    return g;
  }

  // A store as a bare THREE.Group, detached from any flight. An asset
  // viewer, a loadout screen and a bomb-bay prop all want to SEE one
  // without dropping it.
  ord.makeMesh = function (kind) { return bombMesh(KINDS[kind] || KINDS.iron); };

  // release({pos, vel, team, kind, owner, radius?, power?, onDetonate?})
  ord.release = function (o) {
    if (!ready) ord.init({});
    o = o || {};
    const K = KINDS[o.kind] || KINDS.iron;
    const mesh = bombMesh(K);
    scene.add(mesh);
    const b = {
      kind: o.kind || "iron", K: K,
      pos: new THREE.Vector3().copy(o.pos || new THREE.Vector3()),
      vel: new THREE.Vector3().copy(o.vel || new THREE.Vector3()),
      team: o.team || null,
      owner: o.owner || null,
      radius: o.radius != null ? o.radius : K.radius,
      power: o.power != null ? o.power : K.power,
      onDetonate: o.onDetonate || null,
      mesh: mesh,
      age: 0,
      impact: null,
      live: true,
    };
    bombs.push(b);
    stats.released++;
    return b;
  };

  // A STICK is what a bomber actually drops: N stores spaced in TIME, so
  // they walk along the ground track. Spacing them in space instead would
  // be wrong — the aeroplane is what does the spacing.
  ord.stick = function (o) {
    o = o || {};
    const n = Math.max(1, o.count || 6);
    const gap = o.interval != null ? o.interval : 0.16;
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(setTimeout(function () {
        if (o.getState) {
          const s = o.getState();
          if (!s) return;
          o.pos = s.pos; o.vel = s.vel;
        }
        ord.release(o);
      }, i * gap * 1000));
    }
    return out;
  };

  // ------------------------------------------------------------- THE BLAST
  ord.blast = function (x, y, z, radius, power, info) {
    info = info || {};
    stats.detonated++;
    spawnFx(x, y, z, radius);

    // sound, attenuated by the listener's distance (the listener is the
    // camera — the only ear the engine has)
    if (CBZ.micro && CBZ.micro.sfx) {
      const cam = CBZ.camera;
      const d = cam ? cam.position.distanceTo(_v.set(x, y, z)) : 0;
      const gain = CBZ.micro.sfx.gainAt(d, radius * 9);
      if (gain > 0.02) {
        const delay = Math.min(2.2, d / 340);          // sound is slower than sight
        setTimeout(function () {
          CBZ.micro.sfx.boom({ gain: gain * 0.85, dur: 1.1 + radius / 90, sub: 60 + radius * 0.35 });
        }, delay * 1000);
      }
      if (ord.onShake) ord.onShake(Math.max(0, 1 - d / (radius * 7)));
    }

    // crater
    if (craters.length) {
      const m = craters[craterAt = (craterAt + 1) % craters.length];
      m.position.set(x, (groundAt ? groundAt(x, z) : 0) + 0.09, z);
      const s = radius * 0.42;
      m.scale.set(s, 1, s);
      m.visible = true;
    }

    // ---- damage, with the cover question (see THE BLAST, AND COVER)
    let hits = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t || t.alive === false) continue;
      const p = t.pos;
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (d > radius) continue;
      let f = 1 - d / radius;
      f = f * f;
      let covered = false;
      if (blocked && blocked(x, y + 0.4, z, p.x, p.y + 0.9, p.z)) {
        f *= C.ORDNANCE_COVER_FACTOR;
        covered = true;
      }
      const dmg = power * f;
      if (dmg < 1) continue;
      hits++;
      stats.hits++;
      if (t.onDamage) {
        try { t.onDamage(dmg, { x: x, y: y, z: z, radius: radius, covered: covered, by: info.owner, team: info.team, cause: "ordnance" }); }
        catch (e) { console.error("[ordnance damage]", e); }
      } else if (t.hp != null) {
        t.hp -= dmg;
        if (t.hp <= 0) t.alive = false;
      }
    }
    if (ord.onBlast) { try { ord.onBlast(x, y, z, radius, info, hits); } catch (e) { console.error("[ordnance onBlast]", e); } }
    return hits;
  };

  // ---------------------------------------------------------------- FX
  function spawnFx(x, y, z, R) {
    let e = null;
    for (let i = 0; i < fx.length; i++) if (fx[i].t < 0) { e = fx[i]; break; }
    if (!e) { e = fx[0]; for (let i = 1; i < fx.length; i++) if (fx[i].t > e.t) e = fx[i]; }
    e.t = 0;
    e.dur = 1.1 + R / 110;
    e.R = R;
    e.group.position.set(x, y + R * 0.06, z);
    e.group.visible = true;
    for (let p = 0; p < e.puffs.length; p++) {
      const a = (p / e.puffs.length) * Math.PI * 2 + (p * 0.7);
      e.puffs[p].userData.dir.set(Math.cos(a) * 0.7, 0.55 + (p % 3) * 0.22, Math.sin(a) * 0.7);
      e.puffs[p].position.set(0, 0, 0);
    }
  }

  function stepFx(dt) {
    for (let i = 0; i < fx.length; i++) {
      const e = fx[i];
      if (e.t < 0) continue;
      e.t += dt;
      const u = e.t / e.dur;
      if (u >= 1) { e.t = -1; e.group.visible = false; continue; }
      const R = e.R;
      // core: a hard bright flash that dies fast
      const cu = Math.min(1, u * 5);
      e.core.scale.setScalar(R * 0.16 * (0.4 + cu * 1.5));
      e.core.material.opacity = Math.max(0, 1 - cu);
      // fireball: expands and fades over the first third
      const fu = Math.min(1, u * 2.4);
      e.fire.scale.setScalar(R * (0.12 + fu * 0.52));
      e.fire.material.opacity = Math.max(0, 0.95 - fu);
      e.fire.material.color.setHex(fu < 0.4 ? 0xffc463 : 0xd8642a);
      // shockwave: a ground ring racing outward — the readable one
      const wu = Math.min(1, u * 1.5);
      e.wave.scale.set(R * (0.15 + wu * 1.35), 1, R * (0.15 + wu * 1.35));
      e.wave.position.y = -R * 0.05;
      e.wave.material.opacity = Math.max(0, 0.75 * (1 - wu));
      // smoke: rises and swells for the whole life
      for (let p = 0; p < e.puffs.length; p++) {
        const s = e.puffs[p];
        s.position.copy(s.userData.dir).multiplyScalar(R * 0.30 * u);
        s.position.y += R * 0.36 * u;
        s.scale.setScalar(R * (0.10 + u * 0.30));
        s.material.opacity = Math.max(0, 0.72 * (1 - u * u));
      }
    }
  }

  // ------------------------------------------------------------- THE STEP
  ord.step = function (dt) {
    if (!ready) return;
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      b.age += dt;
      const r = integrate(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.K.drag, dt);
      b.pos.set(r[0], r[1], r[2]);
      b.vel.set(r[3], r[4], r[5]);
      b.mesh.position.copy(b.pos);
      // a falling store weathercocks into its own airflow — this is why it
      // looks like a bomb and not a brick, and it costs one lookAt
      _v.copy(b.pos).add(b.vel);
      b.mesh.lookAt(_v);

      const g = groundAt(b.pos.x, b.pos.z);
      // a tower it clips on the way down counts as the ground it hit
      let struckY = null;
      if (CBZ.desertCity && CBZ.desertCity.world) {
        const bl = CBZ.desertCity.world.buildingAt(b.pos.x, b.pos.z, 0);
        if (bl && b.pos.y <= bl.h) struckY = bl.h;
      }
      if (b.pos.y <= g || struckY != null || b.age > 45) {
        const hy = struckY != null ? struckY : g;
        b.pos.y = hy;
        scene.remove(b.mesh);
        bombs.splice(i, 1);
        b.live = false;
        ord.blast(b.pos.x, hy, b.pos.z, b.radius, b.power, { owner: b.owner, team: b.team, kind: b.kind });
        if (b.onDetonate) { try { b.onDetonate(b); } catch (e) { console.error("[ordnance onDetonate]", e); } }
        continue;
      }
      // keep the prediction fresh — HUD, AI and the threat ring all read it
      if ((b.age * 60 | 0) % 4 === 0 || !b.impact) b.impact = ord.predict(b.pos, b.vel, b.kind);
    }

    // ---- threat rings
    if (rings.length) {
      let ri = 0;
      for (let i = 0; i < bombs.length && ri < rings.length; i++) {
        const b = bombs[i];
        if (!b.impact || !b.impact.hit) continue;
        const m = rings[ri++];
        m.visible = true;
        m.position.set(b.impact.x, b.impact.y + 0.14, b.impact.z);
        // the ring TIGHTENS as time-to-impact falls: wide and faint when you
        // still have time, hard and bright when you do not
        const ttl = Math.max(0, b.impact.t);
        const tight = Math.max(0.55, Math.min(2.2, ttl * 0.5));
        const s = b.radius * tight;
        m.scale.set(s, 1, s);
        m.material.opacity = 0.30 + 0.55 * Math.max(0, 1 - ttl / 5);
      }
      for (; ri < rings.length; ri++) rings[ri].visible = false;
    }

    stepFx(dt);
  };

  // Everything in the air right now, for HUD / AI / audio. Read-only intent.
  ord.activeThreats = function () {
    const out = [];
    for (let i = 0; i < bombs.length; i++) {
      const b = bombs[i];
      if (!b.impact || !b.impact.hit) continue;
      out.push({ x: b.impact.x, y: b.impact.y, z: b.impact.z, t: b.impact.t, radius: b.radius, team: b.team, power: b.power });
    }
    return out;
  };
  // How dangerous is this spot in the next `horizon` seconds? The one call an
  // AI needs to decide whether to run, and the HUD needs to scream.
  ord.dangerAt = function (x, z, horizon) {
    const H = horizon || 6;
    let worst = 0;
    for (let i = 0; i < bombs.length; i++) {
      const b = bombs[i];
      if (!b.impact || !b.impact.hit || b.impact.t > H) continue;
      const d = Math.hypot(x - b.impact.x, z - b.impact.z);
      if (d > b.radius * 1.3) continue;
      const f = 1 - d / (b.radius * 1.3);
      if (f > worst) worst = f;
    }
    return worst;
  };
  ord.liveCount = function () { return bombs.length; };
  ord.clear = function () {
    for (let i = 0; i < bombs.length; i++) scene.remove(bombs[i].mesh);
    bombs.length = 0;
    for (let i = 0; i < rings.length; i++) rings[i].visible = false;
  };

  CBZ.ordnanceAudit = function () {
    return {
      ready: ready, inAir: bombs.length, targets: targets.length,
      fxPool: fx.length, ringPool: rings.length, craterPool: craters.length,
      released: stats.released, detonated: stats.detonated, hits: stats.hits,
      coverFactor: C.ORDNANCE_COVER_FACTOR,
    };
  };
})();
