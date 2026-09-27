/* ============================================================
   world/tsunami_debris.js - THE DEBRIS FIELD, SHARED BY BOTH TSUNAMIS.

   Moved out of city/tsunami.js (2026-09-27) so the island tsunami in
   systems/disasters.js gets the real entrained-object debris on every page
   that runs it: disaster.html never loaded the city file and quietly fell
   back to the legacy plank path. Pure kit: no per-frame hook of its own.
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
      };
      items.push(it); entrained++;
      return it;
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

          // ---- THE BATTERING RAM ----
          if (checkPhase !== (i % 3) || it.hitCd > 0) continue;
          const speed = Math.abs(v);
          if (speed < 1.3 || !cfg.forEachActor || !cfg.strike) continue;
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
                kind: it.kind, speed: speed, dirX: dx * Math.sign(v || 1), dirZ: dz * Math.sign(v || 1),
                force: c.force * (0.6 + Math.min(1.4, speed / 3.4)) * mul,
                damage: c.dmg * (0.5 + Math.min(1.3, speed / 3.2)) * mul,
                cause: cause, wall: wall,
              });
            } catch (e) {}
            kills++;
          });
        }
      },

      strandAll() {
        for (let i = 0; i < items.length; i++) {
          const it = items[i]; if (!it.obj) continue;
          const gnd = groundY(it.x, it.z);
          it.obj.position.set(it.x, gnd + 0.22, it.z);
          it.obj.rotation.set(it.pitch, it.yaw, it.roll);
          it.stranded = true;
        }
      },
      count() { return items.length; },
      stats() { return { entrained: entrained, strikes: strikes, kills: kills, live: items.length }; },
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
        items.length = 0;
      },
    };
  };

})();
