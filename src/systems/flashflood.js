/* ============================================================
   systems/flashflood.js — THE FRONT YOU CAN SEE (2026-08-23)

   The 2026-08-03 rebuild made the flash flood honest — rain-fed, a level and
   a FRONT in the shared depth field, no private water mesh — and then left
   the front almost invisible. CBZ.groundWaterFrontSet is a term in
   city/waterfield.js's depth function: the swimmer meets the wall, the
   knockdown physics meet the wall, and the PLAYER'S EYES meet a 3.5 m strip
   of slightly whiter asphalt. The one shot the whole event exists for — dry
   ground twenty metres ahead of a moving wall of water — read as "the street
   gets shinier".

   This file gives the front a face without breaking the law that made the
   rebuild good (NO WATER PLANES — CBZ.groundWaterAudit().privateWaterPlanes
   stays 0). Three instruments, none of them a surface:

     · CHURN — one THREE.Points buffer (ONE draw call) of spray thrown off
       the crest: seeded along the live front line, launched forward and up
       with the front's own speed, pulled down by gravity, respawned at the
       crest when they land. The boiling white-brown face of the wall.
     · DEBRIS — one InstancedMesh (ONE draw call) of entrained flotsam
       tumbling in the first metres behind the crest, riding the SAME depth
       field everything else reads. When the front stands down they drift on
       the flow; when the drain drops the water under ~15 cm they GROUND —
       the stranded-junk aftermath a real flash flood leaves in the street.
     · THE LOOK — systems/weather.js's surface coat grew a flood term
       (CBZ.weatherFloodLook): opaque MUD instead of clear blue (you cannot
       see the ground under real floodwater), a crest-lifted waterline in the
       band behind the front, a ripple that visibly STREAMS downstream, and a
       churned foam band as wide as the crest instead of 3.5 m. Every term is
       gated on uniforms that stay 0 unless this file asserts them.

   Plus the ROAR: a positional water loop AT the front, so you hear which way
   the wall is coming before you can see it — the only warning a real flash
   flood gives after the rain.

   Driven by the flashflood def in systems/disasters.js every active tick;
   fully inert unless driven. Degrade-safe both ways: the def plays its old
   flood if this file is missing, and this file does nothing if never called.

   Flag: CBZ.CONFIG.FLASHFLOOD_V2 (default on; ?cfg_FLASHFLOOD_V2=0 is the
   one-line revert to the invisible front). Declared HERE, the owning file.
   Ratchet: CBZ.flashflood.audit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  if (CBZ.CONFIG.FLASHFLOOD_V2 == null) CBZ.CONFIG.FLASHFLOOD_V2 = true;

  const N_CHURN = 640;          // spray points in the ONE buffer
  const N_DEBRIS = 26;          // flotsam instances in the ONE mesh
  const GROUND_D = 0.15;        // below this depth a piece of debris strands

  // ---- the shared-field reads (never a private water model) --------------
  function floorAt(x, z) { return CBZ.floorAt ? +CBZ.floorAt(x, z) : 0; }
  function depthAt(x, z) {
    // the SAME water everything else is standing in: ground water (front-
    // gated) or the surged sea, whichever is deeper here
    const gw = CBZ.groundWaterAt ? CBZ.groundWaterAt(x, z) : 0;
    const sf = CBZ.survFloodDepthAt ? +CBZ.survFloodDepthAt(x, z) : -9;
    return Math.max(gw, sf > 0 ? sf : 0);
  }

  // ---- state --------------------------------------------------------------
  let churn = null, churnGeo = null, churnP = null;   // Points + live particles
  let debris = null, debrisSeeds = null;              // InstancedMesh + seeds
  const dummy = new THREE.Object3D();
  let live = false, mudNow = 0, roarCd = 0;
  let sprayLaunched = 0;                              // audit evidence
  const _flow = { x: 0, z: 0, speed: 0 };
  /* a PRIVATE lcg, deliberately: this is runtime FX (nothing here moves a
     body, decides damage or places a hazard — disasters.js's line), but
     drawing it from Math.random still perturbs every unseeded consumer
     downstream, which made the A/B's two sides diverge in ways that had
     nothing to do with the flag. Own stream, zero side effects. */
  let rngS = 0x9e3779b9;
  function rnd() { rngS = (rngS * 1664525 + 1013904223) >>> 0; return rngS / 4294967296; }

  function parent() { return CBZ.scene; }

  function buildChurn() {
    if (churn) return;
    const pos = new Float32Array(N_CHURN * 3);
    const col = new Float32Array(N_CHURN * 3);
    churnP = [];
    for (let i = 0; i < N_CHURN; i++) {
      // half dirty foam, half thrown mud — the churned two-tone face
      const foam = i % 2 === 0;
      col[i * 3] = foam ? 0.82 : 0.42;
      col[i * 3 + 1] = foam ? 0.80 : 0.33;
      col[i * 3 + 2] = foam ? 0.74 : 0.22;
      pos[i * 3 + 1] = -1e4;                           // parked below the world
      churnP.push({ x: 0, y: -1e4, z: 0, vx: 0, vy: 0, vz: 0, kill: 0, dead: true });
    }
    churnGeo = new THREE.BufferGeometry();
    const a = new THREE.BufferAttribute(pos, 3);
    a.setUsage(THREE.DynamicDrawUsage);
    churnGeo.setAttribute("position", a);
    churnGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.45, vertexColors: true, transparent: true, opacity: 0.9,
      depthWrite: false, sizeAttenuation: true,
    });
    churn = new THREE.Points(churnGeo, mat);
    churn.frustumCulled = false;                       // the bounds travel
    churn.renderOrder = 3;
    parent().add(churn);
  }

  function buildDebris() {
    if (debris) return;
    const geo = new THREE.BoxGeometry(1.5, 0.5, 0.8);
    const mat = new THREE.MeshLambertMaterial({ color: 0x5a4630 });
    debris = new THREE.InstancedMesh(geo, mat, N_DEBRIS);
    debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    debris.frustumCulled = false;
    debrisSeeds = [];
    for (let i = 0; i < N_DEBRIS; i++) {
      debrisSeeds.push({
        lat: (i / N_DEBRIS - 0.5) * 2,                 // -1..1 across the channel
        back: 4 + (i * 7.13) % 26,                     // metres behind the crest
        s: 0.55 + ((i * 3.77) % 1) * 1.1,              // size
        ph: (i * 2.399) % 6.28, rv: 0.6 + (i % 5) * 0.5,
        x: 0, z: 0, placed: false, grounded: false,
        rx: (i * 1.7) % 6.28, rz: (i * 0.9) % 6.28,
      });
      dummy.position.set(0, -1e4, 0);
      dummy.updateMatrix();
      debris.setMatrixAt(i, dummy.matrix);
    }
    parent().add(debris);
  }

  function respawnSpray(p, F, halfW) {
    /* seed ON the crest line — origin + dir*s + lateral*u — but ONLY where
       the crest actually has water on it. The front line crosses the whole
       island, hills included; sampling blindly threw spray off dry hillsides
       (measured on the first pass of the storyboard: confetti on the refuge
       cone). Up to four lateral tries per respawn; a dry front stays dry. */
    const lx = -F.dz, lz = F.dx;
    for (let t = 0; t < 4; t++) {
      const u = (rnd() * 2 - 1) * halfW;
      const x = F.x + F.dx * (F.s - 1 - rnd() * 2) + lx * u;
      const z = F.z + F.dz * (F.s - 1 - rnd() * 2) + lz * u;
      const d = depthAt(x, z);
      if (d < 0.12) continue;
      const g = floorAt(x, z);
      p.x = x; p.z = z; p.y = g + d * 0.8 + rnd() * 0.4;
      // the kill plane is CACHED at spawn so the flight costs no field reads
      p.kill = g + d * 0.55;
      const kick = F.speed * (0.7 + rnd() * 0.5);
      p.vx = F.dx * kick + lx * (rnd() - 0.5) * 2.5;
      p.vz = F.dz * kick + lz * (rnd() - 0.5) * 2.5;
      p.vy = 1.2 + rnd() * 3.0;
      p.dead = false;
      sprayLaunched++;
      return;
    }
  }

  /* ---- driven every active tick by the def -------------------------------
     front: the live {x,z,dx,dz,s,width,speed} handed to groundWaterFrontSet,
     or null once the wall has done its work. opts: {dt, pool, mud}. */
  function drive(front, opts) {
    if (CBZ.CONFIG.FLASHFLOOD_V2 === false) return;
    const dt = opts && opts.dt ? Math.min(0.1, opts.dt) : 0.016;
    live = true;
    buildChurn(); buildDebris();

    // THE LOOK, asserted every frame while the event runs (hold-decayed by
    // weather.js so a dropped def cannot leave the world muddy forever)
    const pool = opts && opts.pool ? opts.pool : 0;
    mudNow = opts && opts.mud != null ? opts.mud : Math.min(1, 0.45 + pool * 0.5);
    if (CBZ.weatherFloodLook) CBZ.weatherFloodLook({
      mud: mudNow,
      crest: front ? Math.min(1.2, 0.35 + pool * 0.45) : 0,
      band: front ? front.width * 2.4 : 0,
      flow: front ? front.speed : (pool > 0.05 ? 2.5 : 0),
    });

    // THE ROAR — positional, AT the wall, before you can see it
    roarCd -= dt;
    if (front && roarCd <= 0 && CBZ.sfxAt && CBZ.camera) {
      roarCd = 0.55;
      const cp = CBZ.camera.position;
      // closest point of the front line to the listener
      const lx = -front.dz, lz = front.dx;
      const fx = front.x + front.dx * front.s, fz = front.z + front.dz * front.s;
      let t = (cp.x - fx) * lx + (cp.z - fz) * lz;
      t = Math.max(-60, Math.min(60, t));
      CBZ.sfxAt("water", fx + lx * t, fz + lz * t, { volume: 0.9 });
    }

    // ---- churn spray ----
    const posA = churnGeo.attributes.position;
    const arr = posA.array;
    const halfW = front ? Math.min(90, (CBZ.surv && CBZ.surv.arena ? CBZ.surv.arena.radius : 90) * 0.7) : 0;
    let spawned = 0;
    for (let i = 0; i < N_CHURN; i++) {
      const p = churnP[i];
      if (p.dead) {
        if (front && spawned < 48) { respawnSpray(p, front, halfW); spawned++; }
      } else {
        p.vy -= 9.8 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        // the kill plane was cached at spawn: a flight costs zero field reads
        if (p.y < p.kill) { p.dead = true; p.y = -1e4; }
      }
      arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
    }
    posA.needsUpdate = true;
    churn.visible = true;
    churn.material.opacity = front ? 0.9 : Math.max(0, churn.material.opacity - dt * 1.2);

    // ---- entrained debris ----
    for (let i = 0; i < N_DEBRIS; i++) {
      const sd = debrisSeeds[i];
      if (front) {
        // ride the band behind the crest, carried at the front's own pace
        const lx = -front.dz, lz = front.dx;
        sd.x = front.x + front.dx * (front.s - sd.back) + lx * sd.lat * halfW;
        sd.z = front.z + front.dz * (front.s - sd.back) + lz * sd.lat * halfW;
        sd.grounded = false;
      } else if (sd.placed && !sd.grounded) {
        // the wall has passed: drift on the SAME flow field the bodies feel
        const f = CBZ.groundWaterFlowAt ? CBZ.groundWaterFlowAt(sd.x, sd.z, _flow) : _flow;
        sd.x += f.x * 0.5 * dt; sd.z += f.z * 0.5 * dt;
      }
      const g = floorAt(sd.x, sd.z);
      const d = depthAt(sd.x, sd.z);
      // a piece is only IN the event where the water actually carries it:
      // the front line crosses dry hills too, and flotsam sitting on a dry
      // slope is a lie the first pass of the storyboard photographed. While
      // the front is live placement is re-judged every frame (the band slides
      // over dry ground and wet channel alike); once the wall stands down the
      // placed pieces are the event's cargo and stay with the water.
      if (front) {
        sd.placed = d >= 0.22;
        if (!sd.placed) { dummy.position.set(0, -1e4, 0); dummy.updateMatrix(); debris.setMatrixAt(i, dummy.matrix); continue; }
      }
      if (!sd.placed) continue;
      if (d < GROUND_D) sd.grounded = true;
      else sd.grounded = false;
      const t = CBZ.now ? CBZ.now * 0.001 : 0;
      dummy.position.set(sd.x, sd.grounded ? g + 0.18 * sd.s : g + Math.max(0.15, d) - 0.1 + Math.sin(t * 2.1 + sd.ph) * 0.08, sd.z);
      if (!sd.grounded) {
        sd.rx += sd.rv * dt * (front ? 1.6 : 0.3);
        sd.rz += sd.rv * 0.6 * dt;
      }
      dummy.rotation.set(sd.rx, sd.ph, sd.rz * 0.4);
      dummy.scale.setScalar(sd.s);
      dummy.updateMatrix();
      debris.setMatrixAt(i, dummy.matrix);
    }
    debris.instanceMatrix.needsUpdate = true;
    debris.visible = true;
  }

  function clear() {
    live = false; mudNow = 0;
    if (churn) {
      churn.parent && churn.parent.remove(churn);
      churnGeo.dispose(); churn.material.dispose();
      churn = null; churnGeo = null; churnP = null;
    }
    if (debris) {
      debris.parent && debris.parent.remove(debris);
      debris.geometry.dispose(); debris.material.dispose();
      debris = null; debrisSeeds = null;
    }
  }

  CBZ.flashflood = {
    drive: drive,
    clear: clear,
    audit: function () {
      let alive = 0, afloat = 0, stranded = 0;
      if (churnP) for (let i = 0; i < churnP.length; i++) if (!churnP[i].dead) alive++;
      if (debrisSeeds) for (let i = 0; i < debrisSeeds.length; i++) {
        const sd = debrisSeeds[i];
        if (!sd.placed) continue;
        if (sd.grounded) stranded++; else afloat++;
      }
      return {
        on: CBZ.CONFIG.FLASHFLOOD_V2 !== false,
        live: live,
        mud: +mudNow.toFixed(2),
        churnAlive: alive,
        sprayLaunched: sprayLaunched,
        debrisAfloat: afloat,          // pieces the water is carrying NOW
        debrisStranded: stranded,      // pieces the drain has grounded NOW
        drawCallsOwned: (churn ? 1 : 0) + (debris ? 1 : 0),
      };
    },
  };
})();
