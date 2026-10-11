"use strict";
/* src/battle/massdraw.js — NPC War: THE MASS, DRAWN. Every man who is not a
   FULL rig (src/battle/mass.js) is the real CBZ.human drawn by
   entities/crowdgpu.js: GPU-instanced, posed from the baked bone texture,
   impostors only past the distance where a man is a few pixels tall. Never a
   stand-in body (the owner's no-fake-crowds rule).

   THE SAME MAN AT EVERY DISTANCE
     look     his skin and hair are the heritage roll studio.cast gives the
              rig (role + variant), his uniform is men.js uniformFor(): the
              colours the rig is built with when he is promoted
     gear     the rig's own kit, baked into the crowd once: the helmet men.js
              puts on a trained man (pro / elite / swat), in his side's
              cover colour, and the rifle actorweapons.js puts in his hand
              (one baked rifle: the side's first issue; the exact gun shows
              on the rig)
     pose     the soldier clips (rifleIdle / rifleWalk / rifleRun) by his
              speed, the gait phase carried per man and handed to the rig's
              own phase at promotion (and back at demotion), so the stride
              does not jump
   THREE LAYERS
     near     everyone inside the FULL ring's outer edge plus a margin: re-cut
              every frame, so a promotion or demotion swaps body and instance
              on the same frame
     far      everyone else alive: re-cut on a slower clock (the GPU carries
              each man along his velocity in between, from his own clock)
     dead     the fallen, laid in the "down" pose, re-cut when somebody falls
   Every number that decides what is drawn (LOD bands, caps, draw distance,
   the far re-cut rate) is the settings panel's (src/battle/settingspanel.js).
   Every src/battle file shares ONE script scope (see ARCHITECTURE.md). */

CBZ.massDraw = (function () {
  const D = {
    on: false, near: null, far: null, dead: null,
    look: null, gear: null, ph: null, nearR: 110, farEvery: 6, farN: 0, deadDirty: true, deadT: 0,
    drawDist: 2400, camAt: { x: 0, z: 0 }, ms: 0, counts: { near: 0, far: 0, dead: 0 },
  };
  const TAU = Math.PI * 2;
  let CL = null;        // clip records
  /* THE KIT ON THE BAKE RIG. Registered before the first bake (the crowd
     bakes when the first layer is built, in begin()). */
  function gearOn(ch) {
    if (!CBZ.human || !CBZ.human.regions) return;
    const R = CBZ.human.regions(ch);
    // the helmet: men.js's own dome (helmetGeometry), on the head, sized to it
    const head = R.head && R.head[0];
    if (head && typeof helmetGeometry === "function") {
      if (!head.geometry.boundingBox) head.geometry.computeBoundingBox();
      const b = head.geometry.boundingBox;
      const w = (b.max.x - b.min.x) * 1.12;
      const g = helmetGeometry(w).clone();
      const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x808080 }));
      mesh.position.set((b.min.x + b.max.x) / 2, b.max.y + w * 0.26, (b.min.z + b.max.z) / 2 - w * 0.02);
      mesh.userData.cgGear = 1; mesh.userData.cgSlot = 8;
      head.add(mesh);
    }
    // the rifle: actorweapons' own prop, seated by its own grip solve
    if (CBZ.syncActorWeapon && ch.sockets) {
      const a = { char: ch, group: ch.group, armed: true, weapon: D.rifleName || "AK-47", isPlayer: false, dead: false, pos: ch.group.position };
      let prop = null;
      try { prop = CBZ.syncActorWeapon(a); } catch (e) { prop = null; }
      if (prop) prop.traverse(function (o) { if (o.isMesh) o.userData.cgGear = 2; });
    }
  }
  D.begin = function () {
    D.on = false;
    const G = CBZ.crowdGPU;
    if (!G || typeof document === "undefined") return false;
    // the side's first issued gun is the one the crowd carries
    const w0 = pickGun(SET.redW, 0);
    D.rifleName = GUN_NAME[w0] || "AK-47";
    G.gear(gearOn);
    if (!G.ok()) { D.why = G.audit().why; return false; }
    CL = {
      idle: G.clip("rifleIdle"), walk: G.clip("rifleWalk"), run: G.clip("rifleRun"),
      crouch: G.clip("crouchRun"), down: G.clip("down"),
    };
    const n = STORE.cap;
    D.look = new Int32Array(n); D.gear = new Float32Array(n); D.ph = new Float32Array(n);
    D.clipOf = new Uint8Array(n);
    const C = STORE.cols, cache = new Map();
    for (let r = 0; r < STORE.rows; r++) {
      if (C.kind[r] !== 0) { D.look[r] = -1; continue; }
      const team = C.side[r] ? "blue" : "red", i = C.spawnI[r];
      const tr = trainingOf(team === "red" ? SET.redT : SET.blueT);
      const U = uniformFor(team, tr.id, i);
      let skin = 0xc9a07a, hair = 0x2a1f18;
      const v = i * 2 + (team === "red" ? 0 : 1);
      if (CBZ.heritageRoll) { try { const h = CBZ.heritageRoll(null, "cast|" + tr.role + "|" + v); if (h) { skin = h.skin; hair = h.hair; } } catch (e) {} }
      const key = skin + "|" + hair + "|" + U.torso + "|" + U.legs + "|" + U.arms + "|" + U.shoes;
      let lk = cache.get(key);
      if (lk == null) {
        lk = G.look({ build: "m", skin: skin, hair: hair, shirt: U.torso, sleeve: U.arms != null ? U.arms : U.torso,
          pants: U.legs != null ? U.legs : 0x3a4152, shoes: U.shoes != null ? U.shoes : 0x2a2622 });
        cache.set(key, lk);
      }
      D.look[r] = lk;
      const helm = tr.id === "pro" || tr.id === "elite" || tr.id === "swat";
      const u = MASS.unitOf[C.unit[r]] || {};
      D.gear[r] = G.gearCode({ helmet: helm ? UNIFORM[team].cap : null, rifle: u.wid && u.wid !== "fists" });
      D.ph[r] = (r * 0.618) % 1;
    }
    D.near = G.layer({ name: "npcwar-near", cap: 8192 });
    D.far = G.layer({ name: "npcwar-far", cap: Math.max(1024, STORE.rows) });
    D.dead = G.layer({ name: "npcwar-dead", cap: Math.max(1024, STORE.rows) });
    D.applySettings();
    D.on = true;
    return true;
  };
  D.applySettings = function () {
    const S = (typeof SETTINGS !== "undefined" && SETTINGS.cur) || null;
    if (S) { D.drawDist = S.draw; D.farEvery = S.farEvery || 6; }
    if (D.far) D.far.maxDraw = D.drawDist;
    if (D.dead) D.dead.maxDraw = Math.min(D.drawDist, 1200);
    if (D.near) D.near.maxDraw = D.drawDist;
    const fr = (MASS.opt.fullr || CBZ.battleLod.RULES.FULL_R) * CBZ.battleLod.RULES.HYSTERESIS;
    const T = CBZ.crowdGPU ? CBZ.crowdGPU.tier() : { d2: 78 };
    D.nearR = Math.max(fr, T.d2) + 14;
  };
  // which clip and how fast, from how he is moving
  function clipFor(r, spd, C) {
    if (C.life[r] === 2 || spd > 3.0) return CL.run;
    if (spd > 0.35) return C.crouch[r] && spd > 1.2 ? CL.crouch : CL.walk;
    return CL.idle;
  }
  function addRow(L, r, C, age, dt) {
    const vx = C.vx[r], vz = C.vz[r], spd = Math.sqrt(vx * vx + vz * vz);
    const c = clipFor(r, spd, C);
    const rate = c.speed > 0 ? spd * c.radPerM / TAU : (c.period ? 1 / c.period : 0.25);
    let ph = D.ph[r] + rate * dt;
    ph -= Math.floor(ph);
    D.ph[r] = ph;
    D.clipOf[r] = c.index;
    const a = age > 0.6 ? 0.6 : age;
    L.add(C.x[r] + vx * a, C.y[r], C.z[r] + vz * a, C.heading[r], D.look[r], c.index, ph, rate, 1, vx, vz, D.gear[r]);
  }
  D.frame = function (dt) {
    if (!D.on) return;
    const t0 = performance.now();
    const C = STORE.cols, cp = CBZ.camera.position, n = STORE.rows;
    const nr2 = D.nearR * D.nearR, inner = Math.max(0, D.nearR - 14), in2 = inner * inner;
    const LT = C.lastT;
    // NEAR: every frame
    D.near.begin();
    let cn = 0;
    for (let r = 0; r < n; r++) {
      if (C.tier[r] === 0 || D.look[r] < 0) continue;
      const l = C.life[r];
      if (l !== 1 && l !== 2) continue;
      const dx = C.x[r] - cp.x, dz = C.z[r] - cp.z, d2 = dx * dx + dz * dz;
      if (d2 > nr2) continue;
      addRow(D.near, r, C, simT - LT[r], dt);
      cn++;
    }
    D.near.commit();
    // FAR: on its own clock (and at once when the lens has jumped)
    D.farN++;
    const moved = Math.hypot(cp.x - D.camAt.x, cp.z - D.camAt.z);
    if (D.farN >= D.farEvery || moved > 25) {
      D.farN = 0; D.camAt.x = cp.x; D.camAt.z = cp.z;
      const fdt = dt * D.farEvery;
      D.far.begin();
      let cf = 0;
      for (let r = 0; r < n; r++) {
        if (C.tier[r] === 0 || D.look[r] < 0) continue;
        const l = C.life[r];
        if (l !== 1 && l !== 2) continue;
        const dx = C.x[r] - cp.x, dz = C.z[r] - cp.z, d2 = dx * dx + dz * dz;
        // the band [inner, nearR] is in both: two identical impostors, never a gap
        if (d2 < in2) continue;
        addRow(D.far, r, C, simT - LT[r], fdt);
        cf++;
      }
      D.far.commit();
      D.counts.far = cf;
    }
    // THE DEAD: when somebody fell, at most four times a second
    D.deadT -= dt;
    if (D.deadDirty && D.deadT <= 0) {
      D.deadDirty = false; D.deadT = 0.25;
      D.dead.begin();
      let cd = 0;
      for (let r = 0; r < n; r++) {
        if (C.life[r] !== 4 || C.tier[r] === 0 || D.look[r] < 0) continue;
        D.dead.add(C.x[r], C.y[r], C.z[r], C.heading[r], D.look[r], CL.down.index, 0, 0, 1, 0, 0, D.gear[r] & ~2);
        cd++;
      }
      D.dead.commit();
      D.counts.dead = cd;
    }
    D.counts.near = cn;
    D.ms = performance.now() - t0;
  };
  D.reset = function () {
    ["near", "far", "dead"].forEach(function (k) { if (D[k]) { try { D[k].dispose(); } catch (e) {} D[k] = null; } });
    D.on = false; D.deadDirty = true; D.farN = 0;
  };
  D.died = function () { D.deadDirty = true; };
  D.gone = function () {};
  /* THE HAND-OFF. The rig takes the instance's stride (promotion), or the
     instance takes the rig's (demotion), so the legs do not jump. */
  D.handoff = function (r, m, promote) {
    if (!D.on || !CL || !m || !m.char) return;
    const c = CBZ.crowdGPU.clip(D.clipOf[r] || CL.walk.index) || CL.walk;
    const ch = m.char;
    if (promote) {
      if (c.speed > 0) ch.phase = c.phase0 + D.ph[r] * TAU;
    } else if (ch.phase != null && c.speed > 0) {
      let p = (ch.phase - c.phase0) / TAU;
      D.ph[r] = p - Math.floor(p);
    }
  };
  D.audit = function () {
    return { on: D.on, why: D.why || null, counts: D.counts, ms: Math.round(D.ms * 100) / 100, nearR: D.nearR,
      crowd: CBZ.crowdGPU ? CBZ.crowdGPU.audit() : null };
  };
  return D;
})();
