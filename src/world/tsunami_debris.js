/* ============================================================
   world/tsunami_debris.js - THE DEBRIS FIELD, SHARED BY BOTH TSUNAMIS.

   Moved out of city/tsunami.js (2026-09-27) so the island tsunami in
   systems/disasters.js gets the real entrained-object debris on every page
   that runs it: disaster.html never loaded the city file and quietly fell
   back to the plank path (deleted 2026-09-28). Pure kit: no per-frame hook
   of its own.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  /* ============================================================
     THE DEBRIS FIELD — WHAT ACTUALLY KILLS PEOPLE IN A TSUNAMI.

     Owner's science, and the whole reason this exists: "tsunami deaths are
     rarely just drowning. The wave is a churning high-speed soup of cars,
     trees, steel, building fragments. Primary death: blunt force trauma —
     battered and crushed by debris acting as battering rams."

     So the water does not kill you here. The things IN it do, and they are
     real things: the car that was parked on the seafront, the tree that was
     growing behind it, the house that went past you thirty seconds ago. They
     are picked up at the front, they TUMBLE inside the flow (a car in a bore
     does not drive, it rolls), they hit people at closing speed, and when the
     water leaves they are simply left where they stopped — which is the image
     everybody who has seen the aftermath footage remembers.

     NOTHING IN THE WATER IS INVENTED (2026-08-15). The kit used to be able to
     manufacture its own flotsam — a pooled cylinder that stood for "a log", a
     flat brown box that stood for "a panel" — and the owner's verdict on that
     was final: no fake debris. Spawned scenery in a soup of real objects reads
     as exactly what it is, and it broke the only promise the field makes, that
     everything battering you WAS STANDING IN THE WORLD A SECOND AGO. So the
     manufacture path (`shed`) is gone. The kit now only ever TAKES: the
     caller hands it a real object it has already pulled out of its own system
     — a car group, the actual trunk-and-canopy meshes of an uprooted tree, a
     wall torn off the swept house's own group with its own material — and the
     field takes over where it is drawn, nothing more.

     ONE EXCEPTION, 2026-09-28: the churn at the foot of the front (below,
     churn()) carries a small pooled load the bore scoured off the coast
     before it came into shot — the arena's own car meshes plus lumber,
     pallets and roof sections — because a front that arrives from open sea
     otherwise has an empty toe, and the toe is where every reference frame
     is thickest with wreckage.

     ONE FIELD, TWO CONSUMERS. This file drives the city's;
     systems/disasters.js drives the island's with the same object and the same
     motion, because a tsunami that looks different in two modes is two
     tsunamis. Neither of them owns a physics bus: the kit reports a STRIKE
     with a cause string and the caller routes it through its own kill bus
     (CBZ.surv.hurt on the island, CBZ.cityKillPed / cityHurtPlayer here).

     cfg: {
       root          Object3D to parent spawned fragments to
       seaY(x,z)     water surface height  (the ONE shared surface, always)
       groundY(x,z)  terrain height
       forEachActor(fn)  fn(actor) — actor.pos{x,y,z}, actor.isPlayer, actor.dead
       strike(actor, info)  info {kind, speed, dirX, dirZ, force, damage, cause}
       againstWall(x,z)     optional; true if a body here has a wall behind it
     }
     ============================================================ */
  const DEB_RAND = () => Math.random();     // runtime FX only — never a build path

  /* ============================================================
     THE CHURN AT THE FOOT (2026-09-28).

     Taking only what the water has already reached left the one place every
     reference frame is thickest with wreckage — the boiling foot of the
     advancing front — empty: the island bore arrives from open sea, so until
     it has chewed through the seafront it carries nothing. A real bore has
     already scoured the harbour and the coast road before it is in shot, and
     it arrives with that load rolling in its toe: cars on their roofs,
     lumber, pallets, a torn roof section. So the field can carry a small
     pooled LOAD in the churn: ~30 pieces, riding the skirt mound just ahead
     of the wall, surging fore and aft and tumbling, battering whatever the
     foot runs over; each one falls out of the churn at its own point of the
     crossing and from then on is an ordinary item of this field (drifts with
     the flood, is stranded where the drain leaves it).

     The cars are the ARENA'S OWN car geometry and material (the caller hands
     over template meshes; nothing is re-modelled). Lumber, pallets and roof
     sections are three shared merged geometries drawn as three InstancedMesh
     batches: 3 draw calls plus one per car, no lights, no per-frame
     allocation.
     ============================================================ */
  const CHURN_FOOT = 4.3;    // m at H=34: where the wall's foot meets the skirt
  const CHURN_SKIRT0 = 4.9, CHURN_SKIRT = 8.1;   // the face's skirt start / span at H=34

  /* THE POSE OF ONE PIECE IN THE TOE — pure, so it can be checked without a
     renderer. front: {x, z, dx, dz, H, seaY, turbid, t}; p: {f, l, ph, fw}.
     f = forward offset in skirt units (0 foot .. 1 end of the skirt), l =
     lateral metres along the front. Returns {x, y, z, depthK}. The height is
     the face's own skirt mound (water_spec.js shape(): seaLocal + 0.28 +
     (0.05 + 0.07 turbid) H (1 - sdn)^1.6), so a piece rides the water the
     face draws instead of floating through it. */
  function churnPose(front, p, out) {
    out = out || {};
    const zs = Math.max(0.1, front.H) / 34;
    const tb = Math.max(0, Math.min(1, front.turbid || 0));
    const skirtSpan = CHURN_SKIRT * (0.75 + 0.45 * tb) * zs;
    // fore and aft on the surge: the toe keeps swallowing and spitting it
    const surge = Math.sin(front.t * (0.9 + 0.5 * p.fw) + p.ph) * 0.14 + Math.sin(front.t * 2.3 + p.ph * 1.7) * 0.05;
    const f = Math.max(-0.08, Math.min(0.92, p.f + surge));
    const fwd = CHURN_FOOT * zs + f * (skirtSpan + (CHURN_SKIRT0 - CHURN_FOOT) * zs);
    const sdn = Math.max(0, Math.min(1, (fwd - CHURN_SKIRT0 * zs) / skirtSpan));
    const mound = 0.28 + (0.05 + 0.07 * tb) * front.H * Math.pow(1 - sdn, 1.6);
    out.x = front.x + front.dx * fwd - front.dz * p.l;
    out.z = front.z + front.dz * fwd + front.dx * p.l;
    out.y = front.seaY + mound;
    out.depthK = 1 - sdn;
    return out;
  }

  // ---- shared churn geometry (built once per page, reused by every event) --
  let churnKit = null;
  function lin(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
  function vcBox(w, h, d, x, y, z, hex, ry) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    const c = lin(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    g.deleteAttribute("uv");
    return g;
  }
  function mergeKit(parts) {
    const U = THREE.BufferGeometryUtils;
    const g = U.mergeBufferGeometries(parts, false);
    parts.forEach(function (p) { p.dispose(); });
    g.computeBoundingSphere();
    return g;
  }
  function buildChurnKit() {
    if (churnKit) return churnKit;
    if (!THREE.BufferGeometryUtils || !THREE.BufferGeometryUtils.mergeBufferGeometries) return null;
    // LUMBER: one sawn board, 3.6 m x 200 x 45 mm; the tint is per instance
    const board = mergeKit([vcBox(0.2, 0.045, 3.6, 0, 0, 0, 0xffffff)]);
    // PALLET: three stringers, seven top slats, three bottom boards
    const pal = [];
    for (let i = -1; i <= 1; i++) pal.push(vcBox(0.09, 0.09, 1.2, i * 0.46, 0, 0, i ? 0xb39a74 : 0xa88f68));
    for (let i = 0; i < 7; i++) pal.push(vcBox(1.0, 0.022, 0.1, 0, 0.056, -0.54 + i * 0.18, (i % 3) ? 0xc4ab82 : 0xb59c74));
    for (let i = -1; i <= 1; i++) pal.push(vcBox(1.0, 0.022, 0.14, 0, -0.056, i * 0.52, 0xa28a64));
    const pallet = mergeKit(pal);
    // ROOF SECTION: sheathing torn off with its shingle courses, a fascia
    // board along the eave and the stubs of three rafters underneath
    const rf = [];
    rf.push(vcBox(3.4, 0.03, 2.5, 0, 0, 0, 0x9c8560));                         // OSB deck
    for (let i = 0; i < 6; i++) {
      const hex = [0x4b403c, 0x453a37, 0x514540][i % 3];
      rf.push(vcBox(3.45, 0.035, 0.46, 0, 0.03 + i * 0.012, -1.03 + i * 0.41, hex));
    }
    rf.push(vcBox(3.5, 0.16, 0.035, 0, -0.03, -1.27, 0xd2cabb));              // fascia
    for (let i = -1; i <= 1; i++) rf.push(vcBox(0.05, 0.14, 2.3, i * 1.3, -0.09, 0.05, 0x8d7652));
    const roof = mergeKit(rf);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.name = "tsunami churn debris";
    churnKit = { board: board, pallet: pallet, roof: roof, mat: mat };
    return churnKit;
  }
  const BOARD_TINTS = [0xc9a877, 0xb8966a, 0x8f8272, 0xd8d2c4, 0x7d9bb0, 0xa06b4a];
  const PALLET_TINTS = [0xffffff, 0xe6e0d6, 0xcfc4b0];
  const ROOF_TINTS = [0xffffff, 0xd9d2cc];

  CBZ.tsuChurnPose = churnPose;     // pure; exported for checks

  CBZ.tsuDebrisField = function (cfg) {
    cfg = cfg || {};
    const root = cfg.root || null;
    const seaY = cfg.seaY || function () { return 0; };
    const groundY = cfg.groundY || function () { return 0; };
    const items = [];
    let entrained = 0, strikes = 0, kills = 0, checkPhase = 0;

    /* MASS IS THE WHOLE POINT. A plank rides on top and stings; a car is two
       tonnes moving at the speed of the water and it kills whatever it meets.
       These numbers are the only difference between the classes — the classes
       are BEHAVIOUR, never geometry: `log` is a real uprooted tree, `panel` a
       wall off a real building, `rubble` a chunk of one. What each looks like
       is whatever the world object the caller handed over looks like.        */
    const CLASS = {
      car:    { drift: 0.78, hitR: 2.5, dmg: 92, force: 17, sink: 0.55, spin: 1.5 },
      log:    { drift: 0.94, hitR: 1.9, dmg: 44, force: 11, sink: 0.18, spin: 3.0 },
      panel:  { drift: 1.00, hitR: 1.5, dmg: 26, force: 8,  sink: 0.10, spin: 3.6 },
      rubble: { drift: 0.70, hitR: 1.1, dmg: 34, force: 9,  sink: 0.35, spin: 4.2 },
    };

    function add(obj, x, z, kind, opts) {
      opts = opts || {};
      const k = CLASS[kind] ? kind : "panel";
      const it = {
        obj: obj, x: x, z: z, kind: k, cls: CLASS[k],
        ph: DEB_RAND() * 6.28,
        sx: (DEB_RAND() - 0.5) * 2, sy: (DEB_RAND() - 0.5) * 2, sz: (DEB_RAND() - 0.5) * 2,
        yaw: DEB_RAND() * 6.28, roll: 0, pitch: 0,
        lat: (DEB_RAND() - 0.5) * 0.9,
        stranded: false, hitCd: 0, onStrand: opts.onStrand || null, dispose: !!opts.dispose,
        inst: opts.inst || null, churn: opts.churn || null,
      };
      items.push(it); entrained++;
      return it;
    }
    // an instanced piece's obj is a detached proxy: copy its pose into the batch
    function sync(it) {
      const I = it.inst; if (!I) return;
      it.obj.updateMatrix();
      I.mesh.setMatrixAt(I.i, it.obj.matrix);
      I.mesh.instanceMatrix.needsUpdate = true;
    }
    const churnMeshes = [];     // the batches + car clones this field made
    const _pose = {};
    let churnLive = 0;

    // ---- THE BATTERING RAM: one piece against the actors in reach ----
    function ram(it, i, speed, dx, dz, sgn) {
      const c = it.cls;
      if (speed < 1.3 || !cfg.forEachActor || !cfg.strike) return;
      const r2 = c.hitR * c.hitR;
      const ix = it.x, iz = it.z, iy = it.obj.position.y;
      cfg.forEachActor(function (a) {
        if (!a || a.dead || !a.pos || it.hitCd > 0) return;
        const ax = a.pos.x - ix, az = a.pos.z - iz;
        if (ax * ax + az * az > r2) return;
        if (Math.abs((a.pos.y || 0) - iy) > 3.2) return;    // a roof is a roof
        it.hitCd = 0.9;
        strikes++;
        const wall = cfg.againstWall ? !!cfg.againstWall(a.pos.x, a.pos.z) : false;
        const cause = it.kind === "car"
          ? (wall ? "crushed against a wall by a drifting car" : "struck by a car inside the tsunami")
          : (wall ? "crushed against a wall by tsunami debris" : "battered by tsunami debris");
        const mul = wall ? 1.85 : 1;      // nowhere to give: the load goes into you
        try {
          cfg.strike(a, {
            kind: it.kind, speed: speed, dirX: dx * sgn, dirZ: dz * sgn,
            force: c.force * (0.6 + Math.min(1.4, speed / 3.4)) * mul,
            damage: c.dmg * (0.5 + Math.min(1.3, speed / 3.2)) * mul,
            cause: cause, wall: wall,
          });
        } catch (e) {}
        kills++;
      });
    }

    return {
      /* ENTRAIN A REAL WORLD OBJECT. The caller has already taken it out of
         whatever system owned it (pulled its collider, marked the record dead)
         — this only takes over where it is drawn. */
      take(obj, x, z, kind, opts) { return obj ? add(obj, x, z, kind, opts) : null; },

      /* ENTRAIN A REAL OBJECT WHERE IT STANDS. Re-parents it to the field's
         root with its world transform preserved (Object3D.attach), starts the
         tumble from the pose it actually had, and drives it from there. This
         is how a wall still bolted to its house or a trunk still planted in
         the ground steps out of its builder's group and into the water. */
      takeWorld(obj, kind, opts) {
        if (!obj || !root) return null;
        const wp = obj.getWorldPosition(new THREE.Vector3());
        if (obj.parent !== root) root.attach(obj);
        const it = add(obj, wp.x, wp.z, kind, opts);
        it.yaw = obj.rotation.y; it.pitch = obj.rotation.x; it.roll = obj.rotation.z;
        return it;
      },

      /* ONE FRAME OF THE FLOW. env: {dx, dz, flow (m/s, signed — negative is
         the undertow), sediment}. Everything reads the SHARED surface, so an
         object stops being carried the instant the water under it is gone. */
      step(dt, env) {
        env = env || {};
        const dx = Number.isFinite(env.dx) ? env.dx : 1, dz = Number.isFinite(env.dz) ? env.dz : 0;
        const flow = Number.isFinite(env.flow) ? env.flow : 0;
        checkPhase = (checkPhase + 1) % 3;
        for (let i = 0; i < items.length; i++) {
          const it = items[i], c = it.cls;
          if (!it.obj) continue;
          if (it.churn) {
            const F = env.front;
            if (F && !(Number.isFinite(F.land) && F.land >= it.churn.rel)) {
              // RIDING THE TOE: pinned to the foot, surging, rolling hard
              churnPose(F, it.churn, _pose);
              it.x = _pose.x; it.z = _pose.z; it.churn.posed = true;
              const heave = Math.sin((CBZ.now || 0) * 0.007 + it.ph) * 0.35 * _pose.depthK;
              it.obj.position.set(it.x, Math.max(groundY(it.x, it.z) + 0.2, _pose.y - c.sink * 0.6 + heave), it.z);
              const roll = (1.2 + 1.6 * _pose.depthK) * c.spin * 0.45 * dt;
              it.yaw += it.sy * roll * 0.6; it.pitch += (0.6 + Math.abs(it.sx)) * roll; it.roll += it.sz * roll * 0.8;
              it.obj.rotation.set(it.pitch, it.yaw, it.roll);
              sync(it);
              it.stranded = false;
              if (it.hitCd > 0) it.hitCd -= dt;
              if (checkPhase === (i % 3) && it.hitCd <= 0) ram(it, i, Math.max(2, Math.abs(F.v || 0)), F.dx, F.dz, 1);
              continue;
            }
            // it falls out of the churn here and becomes flood-borne wreckage
            // (a piece the front never carried has no place in the world: drop it)
            const posed = it.churn.posed;
            it.churn = null; churnLive--;
            if (!posed) { if (!it.inst) it.obj.visible = false; it.obj = null; continue; }
          }
          const surf = seaY(it.x, it.z), gnd = groundY(it.x, it.z);
          const depth = surf - gnd;
          if (it.hitCd > 0) it.hitCd -= dt;
          if (depth < 0.4) {
            // STRANDED. The water that carried it here has gone; it stays
            // exactly where it stopped, which is the aftermath photograph.
            if (!it.stranded) {
              it.stranded = true;
              it.obj.rotation.set(it.pitch, it.yaw, it.roll);
              if (it.onStrand) { try { it.onStrand(it); } catch (e) {} }
            }
            it.obj.position.set(it.x, gnd + 0.22, it.z);
            sync(it);
            continue;
          }
          it.stranded = false;
          const v = flow * c.drift;
          const step2 = v * dt;
          it.x += dx * step2 - dz * it.lat * dt * Math.abs(v) * 0.25;
          it.z += dz * step2 + dx * it.lat * dt * Math.abs(v) * 0.25;
          // ride the surface, sunk by its own mass, heaving on the churn
          const bob = Math.sin((CBZ.now || 0) * 0.005 + it.ph) * 0.22;
          it.obj.position.set(it.x, surf - c.sink + bob, it.z);
          // TUMBLING, not floating: rotation rate follows the water's speed,
          // so a bore rolls a car over and a slack pool merely turns it.
          const tumble = Math.min(2.4, Math.abs(v) * 0.34) * c.spin * dt;
          it.yaw += it.sy * tumble;
          it.pitch += it.sx * tumble * 0.55;
          it.roll += it.sz * tumble * 0.7;
          it.obj.rotation.set(it.pitch, it.yaw, it.roll);
          sync(it);

          // ---- THE BATTERING RAM ----
          if (checkPhase !== (i % 3) || it.hitCd > 0) continue;
          ram(it, i, Math.abs(v), dx, dz, Math.sign(v || 1));
        }
      },
      /* LOAD THE TOE. opts: {cars: [Mesh templates — the world's own car
         meshes, geometry + material shared, never cloned], nCars, nBoards,
         nPallets, nRoofs, halfW (m of front the load spreads over)}. Once per
         field; the pieces ride env.front in step() until env.front.land
         passes each piece's own release point (or env.front is gone). */
      churn(opts) {
        opts = opts || {};
        if (churnMeshes.length || !root) return 0;
        const K = buildChurnKit(); if (!K) return 0;
        const halfW = Math.max(10, opts.halfW || 120);
        const made = [];
        const place = function (obj, kind, inst) {
          const lane = (made.length * 0.618034) % 1;           // spread evenly, not clumped
          const it = add(obj, 0, 0, kind, {
            dispose: !inst, inst: inst,
            churn: {
              f: DEB_RAND() * 0.75, l: (lane * 2 - 1) * halfW + (DEB_RAND() - 0.5) * 6,
              ph: DEB_RAND() * 6.28, fw: DEB_RAND(),
              rel: 0.12 + 0.8 * DEB_RAND(),
            },
          });
          it.pitch = DEB_RAND() * 6.28; it.roll = (DEB_RAND() - 0.5) * 2;
          it.obj.visible = false;                    // until its first pose
          made.push(it); churnLive++;
          return it;
        };
        const batch = function (geo, n, tints) {
          if (n <= 0) return null;
          const m = new THREE.InstancedMesh(geo, K.mat, n);
          m.name = "tsunami churn";
          m.frustumCulled = false;                   // instances roam far past the geometry's bounds
          m.castShadow = false; m.receiveShadow = true;
          const col = new THREE.Color();
          for (let i = 0; i < n; i++) {
            col.copy(lin(tints[(DEB_RAND() * tints.length) | 0]));
            m.setColorAt(i, col);
            const proxy = new THREE.Object3D();
            proxy.position.set(0, -1e4, 0); proxy.updateMatrix();
            m.setMatrixAt(i, proxy.matrix);
          }
          if (m.instanceColor) m.instanceColor.needsUpdate = true;
          root.add(m); churnMeshes.push(m);
          return m;
        };
        const nB = opts.nBoards != null ? opts.nBoards : 14;
        const nP = opts.nPallets != null ? opts.nPallets : 7;
        const nR = opts.nRoofs != null ? opts.nRoofs : 3;
        const mB = batch(K.board, nB, BOARD_TINTS), mP = batch(K.pallet, nP, PALLET_TINTS), mR = batch(K.roof, nR, ROOF_TINTS);
        for (let i = 0; i < nB; i++) place(new THREE.Object3D(), "panel", { mesh: mB, i: i });
        for (let i = 0; i < nP; i++) place(new THREE.Object3D(), "panel", { mesh: mP, i: i });
        for (let i = 0; i < nR; i++) place(new THREE.Object3D(), "panel", { mesh: mR, i: i });
        const tpl = (opts.cars || []).filter(function (t) { return t && t.geometry && t.material; });
        const nC = tpl.length ? (opts.nCars != null ? opts.nCars : 6) : 0;
        for (let i = 0; i < nC; i++) {
          const t = tpl[i % tpl.length];
          const m = new THREE.Mesh(t.geometry, t.material);   // shared, never copied
          m.castShadow = false; m.receiveShadow = true;
          m.rotation.order = "YXZ";
          root.add(m); churnMeshes.push(m);
          place(m, "car", null);
        }
        // the proxies' first pose is written by step(); show the real meshes then
        for (let i = 0; i < made.length; i++) if (!made[i].inst) made[i].obj.visible = true;
        return made.length;
      },

      strandAll() {
        for (let i = 0; i < items.length; i++) {
          const it = items[i]; if (!it.obj) continue;
          if (it.churn) {
            const posed = it.churn.posed;
            it.churn = null; churnLive--;
            if (!posed) { if (!it.inst) it.obj.visible = false; it.obj = null; continue; }
          }
          const gnd = groundY(it.x, it.z);
          it.obj.position.set(it.x, gnd + 0.22, it.z);
          it.obj.rotation.set(it.pitch, it.yaw, it.roll);
          sync(it);
          it.stranded = true;
        }
      },
      count() { return items.length; },
      stats() { return { entrained: entrained, strikes: strikes, kills: kills, live: items.length, churn: churnLive, churnMeshes: churnMeshes.length }; },
      /* Drops the field's TRACKING, not the world. Everything entrained was a
         real object, and a real object stranded by the drain is aftermath —
         it stays exactly where the water left it, owned again by the scene it
         came from. Only items explicitly flagged `dispose` (none, today) are
         removed; there are no pooled fakes left to destroy. */
      dispose() {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.dispose && it.obj && it.obj.parent) it.obj.parent.remove(it.obj);
        }
        // the churn's own batches (geometry + material stay in the page kit)
        for (let i = 0; i < churnMeshes.length; i++) {
          const m = churnMeshes[i];
          if (m.parent) m.parent.remove(m);
          if (m.isInstancedMesh && m.dispose) m.dispose();
        }
        churnMeshes.length = 0; churnLive = 0;
        items.length = 0;
      },
    };
  };

})();
