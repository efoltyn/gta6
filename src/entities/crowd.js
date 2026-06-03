/* ============================================================
   entities/crowd.js - bounded close rigs + mathematical crowd tier.

   Total population is independent from render capacity. Nearby rows are
   promoted into animated InstancedMesh slots. Hidden rows remain analytical
   route segments in ambientstate.js and are never frame-stepped.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, S = CBZ.ambient;
  if (!CBZ || !S || !S.total || !THREE.InstancedMesh || !THREE.Points) return;

  const TOTAL = S.total, RIG_CAP = S.rigCapacity, FIXED = 1 / 20;
  const ROLE_NAMES = ["drifter", "runner", "lookout", "enforcer", "trader", "mediator"];
  const DOT_COLORS = [0xd8d2c4, 0x8bdeff, 0xffcf70, 0xff756b, 0x9eea96, 0xc9a6ff];
  const root = new THREE.Group();
  root.name = "mass-crowd";
  CBZ.scene.add(root);

  const unit = CBZ.boxGeom(1, 1, 1);
  // r128 quirk: per-instance setColorAt() only tints a Lambert/Phong fragment
  // when the material has vertexColors AND the geometry carries a (white) color
  // attribute. Without it, USE_COLOR multiplies by a missing/zero attribute and
  // the instance renders BLACK (that's the "black faces"). tintUnit carries the
  // white color attribute so instanced heads/hair/valuables take their skin tint.
  const tintUnit = new THREE.BoxGeometry(1, 1, 1);
  {
    const vc = tintUnit.attributes.position.count, white = new Float32Array(vc * 3);
    white.fill(1); tintUnit.setAttribute("color", new THREE.BufferAttribute(white, 3));
  }
  const orange = CBZ.cmat(0xff7a1a);
  const dark = CBZ.cmat(0x141414);          // eyes + mouth (flat dark, no per-instance colour)
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  const hairMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  const valMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, emissive: 0x2a2200, emissiveIntensity: 0.55 });
  skinMat._shared = true; hairMat._shared = true; valMat._shared = true;
  function makePart(material, geom) {
    const m = new THREE.InstancedMesh(geom || unit, material, RIG_CAP);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = false; m.receiveShadow = true; m.frustumCulled = false;
    root.add(m); return m;
  }
  const torso = makePart(orange), head = makePart(skinMat, tintUnit), hair = makePart(hairMat, tintUnit);
  const legL = makePart(orange), legR = makePart(orange), armL = makePart(orange), armR = makePart(orange);
  // FACES (so the crowd reads as people, not faceless boxes) + a worn valuable
  const eyeL = makePart(dark), eyeR = makePart(dark), mouth = makePart(dark), valuable = makePart(valMat, tintUnit);
  const meshes = [torso, head, hair, legL, legR, armL, armR, eyeL, eyeR, mouth, valuable];

  // Aerial tier: compact GPU point buffers, not one matrix per dot.
  const POINT_CAP = Math.min(TOTAL, Math.max(0, (CBZ.SIM_OVERVIEW_BUDGET || 12000) | 0));
  const pointPosition = new Float32Array(POINT_CAP * 3), pointColor = new Float32Array(POINT_CAP * 3);
  const pointGeom = new THREE.BufferGeometry();
  const pointPosAttr = new THREE.BufferAttribute(pointPosition, 3).setUsage(THREE.DynamicDrawUsage);
  const pointColorAttr = new THREE.BufferAttribute(pointColor, 3).setUsage(THREE.DynamicDrawUsage);
  pointGeom.setAttribute("position", pointPosAttr); pointGeom.setAttribute("color", pointColorAttr);
  pointGeom.setDrawRange(0, POINT_CAP);
  const pointMat = new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: true, vertexColors: true });
  const overviewPoints = new THREE.Points(pointGeom, pointMat);
  overviewPoints.frustumCulled = false; overviewPoints.visible = false; overviewPoints.layers.set(1);
  root.add(overviewPoints);

  // High-altitude strategic tier: aggregate rows into a small density field.
  const WORLD = CBZ.WORLD, DENSITY_CELL = S.densityCellSize;
  const DENSITY_W = S.densityWidth, DENSITY_H = S.densityHeight;
  const DENSITY_CAP = DENSITY_W * DENSITY_H;
  const densityPopulation = S.densityPopulation, densityFaction = S.densityFaction;
  const densityPosition = new Float32Array(DENSITY_CAP * 3), densityColor = new Float32Array(DENSITY_CAP * 3);
  const densityGeom = new THREE.BufferGeometry();
  const densityPosAttr = new THREE.BufferAttribute(densityPosition, 3).setUsage(THREE.DynamicDrawUsage);
  const densityColorAttr = new THREE.BufferAttribute(densityColor, 3).setUsage(THREE.DynamicDrawUsage);
  densityGeom.setAttribute("position", densityPosAttr); densityGeom.setAttribute("color", densityColorAttr);
  const densityMat = new THREE.PointsMaterial({ size: 7.4, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.88 });
  const densityPoints = new THREE.Points(densityGeom, densityMat);
  densityPoints.frustumCulled = false; densityPoints.visible = false; densityPoints.layers.set(1);
  root.add(densityPoints);

  // Config A (Standard): Matrix-based instanced box dots
  const boxMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
  boxMat._shared = true;
  const overviewBoxes = new THREE.InstancedMesh(unit, boxMat, POINT_CAP);
  overviewBoxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  overviewBoxes.frustumCulled = false;
  overviewBoxes.visible = false;
  root.add(overviewBoxes);

  const activeId = new Int32Array(RIG_CAP), slotOf = new Int32Array(TOTAL);
  const selected = new Uint8Array(TOTAL), heapId = new Int32Array(RIG_CAP), heapD2 = new Float64Array(RIG_CAP);
  slotOf.fill(-1);
  let activeCount = 0, selectedCount = 0, selectAcc = 1, renderAcc = 0, pointsAcc = 0, frame = 0, simTime = 0, fixedAcc = 0;
  let lastOverview = null, lastDensity = null, densityCount = 0;
  let societyWorker = null, societyAcc = 0, societyRunning = false, societyOverview = false, sharedWrite = 0;
  const tint = new THREE.Color(), rootDummy = new THREE.Object3D(), partDummy = new THREE.Object3D(), worldMatrix = new THREE.Matrix4();
  const tempPoint = { x: 0, z: 0 };
  const flowX = new Float32Array(S.zones.length), flowZ = new Float32Array(S.zones.length);
  const flowStrength = new Float32Array(S.zones.length), flowTTL = new Float32Array(S.zones.length);
  CBZ.setCrowdFlow = function (zone, x, z, strength, ttl) {
    zone |= 0;
    if (zone < 0 || zone >= S.zones.length) return;
    const d = Math.sqrt(x * x + z * z) || 1;
    flowX[zone] = x / d; flowZ[zone] = z / d;
    flowStrength[zone] = Math.max(0, +strength || 0); flowTTL[zone] = Math.max(0, +ttl || 0);
  };

  // Set up performance metrics
  CBZ.crowdPerformance = { simTimeMs: 0, renderTimeMs: 0 };

  // ============================================================
  // INTERACTABLE FACE-RIG TIER — the closest agents become REAL makeCharacter
  // rigs (full faces + skin tones, just like the named cast) registered in
  // CBZ.npcs, so EVERY existing system lets you hold them at gunpoint, beat, KO,
  // KILL and LOOT them. Far agents stay instanced/points (you can't read a face
  // at distance anyway). Looting + death persist into the analytical store, so
  // it sticks and the same named inmate remembers you (worker PLAYER_SEEN).
  // ============================================================
  const FACE_RIGS = Math.max(0, Math.min(RIG_CAP, CBZ.CROWD_FACE_RIGS == null ? 40 : CBZ.CROWD_FACE_RIGS | 0));
  const FD = CBZ.CROWD_FACE_DIST == null ? 30 : +CBZ.CROWD_FACE_DIST;
  const FACE_DIST2 = FD * FD;
  const FAR_AWAY = -1000;
  const rigOf = new Int32Array(TOTAL); rigOf.fill(-1);
  const facePool = [];
  function cloneShared(m) { if (m && m.material && m.material._shared) m.material = m.material.clone(); }
  function makeFaceEntry(pi) {
    const rig = CBZ.makeCharacter({ legs: 0xff7a1a, torso: 0xff7a1a, collar: 0xff9747, arms: 0xff7a1a, skin: 0xd8a177, hair: 0x2a2018, stripes: 0xc85c00, shoes: 0x2b2b2b });
    (rig.skinSlots.hands || []).forEach(cloneShared);   // per-rig skin/hair so recolour can't bleed onto the cache
    (rig.skinSlots.hair || []).forEach(cloneShared);
    rig.group.position.y = FAR_AWAY;
    root.add(rig.group);                                 // under the crowd root → hides with it off-escape
    const chain = new THREE.Mesh(CBZ.boxGeom(0.34, 0.12, 0.07), CBZ.cmat(0xffd451));
    chain.position.set(0, 1.46, 0.26); chain.visible = false; rig.body.add(chain);
    const actor = {
      _crowd: true, _id: -1, _synced: false, _pi: pi, _corpseT: 0, gang: null,
      kind: "inmate", role: "inmate", char: rig, group: rig.group, _chain: chain,
      data: { name: "an inmate", pool: "goods", offer: null, talk: ["What do you want?", "Back off.", "I ain't lookin' for trouble."] },
      personality: { nerve: 0.5, greed: 0.5, loyalty: 0.5, snitch: 0.3 },
      ratings: { fighting: 45, toughness: 45 }, behavior: "defensive",
      hp: 70, maxHp: 70, ko: 0, dead: true, escaped: false, looted: false,
      aiState: "wander", target: new THREE.Vector3(), loadout: null, pause: 0, speed: 2,
    };
    facePool.push({ rig: rig, actor: actor, id: -1, pi: pi });
    CBZ.npcs.push(actor);
  }
  for (let i = 0; i < FACE_RIGS; i++) makeFaceEntry(i);

  function setRigSkin(rig, skin, hair) {
    if (rig.head.material && rig.head.material.color) rig.head.material.color.setHex(skin);
    (rig.skinSlots.hands || []).forEach(function (m) { if (m.material.color) m.material.color.setHex(skin); });
    (rig.skinSlots.hair || []).forEach(function (m) { if (m.material.color) m.material.color.setHex(hair); });
  }
  function assignRig(e, id) {
    const a = e.actor, rig = e.rig;
    e.id = id; rigOf[id] = e.pi;
    a._id = id; a._synced = false; a.looted = false; a._corpseT = 0;
    a.data.name = S.nameOf(id);
    a.dead = false; a.ko = S.downT[id] || 0; a.escaped = false;
    a.maxHp = 55 + (S.nerve[id] || 50) * 0.5; a.hp = a.maxHp;
    a.personality.nerve = (S.nerve[id] || 50) / 100; a.personality.greed = (S.greed[id] || 50) / 100;
    a.reactivity = (S.reactivity[id] || 0) / 255;
    a.playerGrudge = (S.grudge[id] || 0) / 32;
    a.ratings.fighting = 28 + (S.nerve[id] || 50) * 0.45; a.ratings.toughness = 30 + (S.nerve[id] || 50) * 0.4;
    a._intimidInit = false; a.hasGun = undefined; a.intimidMode = null; a.poseHandsUp = false; a.poseAimBack = false;
    a.aiState = "wander";
    a.loadout = { cigs: S.cigs[id], items: S.item[id] ? [S.itemName(id)] : [] };
    if (CBZ.econ && CBZ.econ.pickOffer && !a.data.offer) a.data.offer = CBZ.econ.pickOffer("goods");
    setRigSkin(rig, S.skin[id], S.hair[id]);
    const vcol = S.itemColor(id); a._chain.visible = !!vcol; if (vcol) a._chain.material = CBZ.cmat(vcol);
    rig.group.rotation.set(0, S.heading[id], 0);
    rig.group.position.set(S.posX[id], 0, S.posZ[id]);
    rig.group.visible = true;
  }
  function freeRig(e) {
    const a = e.actor, id = e.id;
    if (id >= 0) {
      if (!S.dead[id]) { S.posX[id] = a.group.position.x; S.posZ[id] = a.group.position.z; }
      S.grudge[id] = Math.max(S.grudge[id], Math.min(255, ((a.playerGrudge || 0) * 32) | 0));
      S.downT[id] = Math.max(S.downT[id], a.ko || 0);
      rigOf[id] = -1;
    }
    e.id = -1; a._id = -1; a.dead = true; a.intimidMode = null; a.poseHandsUp = false; a.poseAimBack = false;
    a._chain.visible = false; a.group.position.y = FAR_AWAY; a.group.visible = true;
  }
  function freeAllRigs() { for (let i = 0; i < facePool.length; i++) if (facePool[i].id >= 0) freeRig(facePool[i]); }

  const faceTmpId = new Int32Array(Math.max(1, FACE_RIGS)), faceTmpD2 = new Float64Array(Math.max(1, FACE_RIGS));
  let faceN = 0, faceMaxAt = 0;
  function faceMax() { faceMaxAt = 0; for (let i = 1; i < faceN; i++) if (faceTmpD2[i] > faceTmpD2[faceMaxAt]) faceMaxAt = i; }
  function faceConsider(id, d2) {
    if (faceN < FACE_RIGS) { faceTmpId[faceN] = id; faceTmpD2[faceN] = d2; faceN++; if (faceN === FACE_RIGS) faceMax(); }
    else if (d2 < faceTmpD2[faceMaxAt]) { faceTmpId[faceMaxAt] = id; faceTmpD2[faceMaxAt] = d2; faceMax(); }
  }
  function faceWanted(id) { for (let i = 0; i < faceN; i++) if (faceTmpId[i] === id) return true; return false; }

  function syncFaceRigs(alpha, dt) {
    if (!FACE_RIGS) return;
    const p = CBZ.player.pos;
    // 1) nearest FACE_RIGS active, alive agents within face range
    faceN = 0;
    for (let slot = 0; slot < activeCount; slot++) {
      const id = activeId[slot]; if (S.dead[id]) continue;
      const dx = S.posX[id] - p.x, dz = S.posZ[id] - p.z, d2 = dx * dx + dz * dz;
      if (d2 <= FACE_DIST2) faceConsider(id, d2);
    }
    // 2) release rigs whose agent dropped out of range
    for (let i = 0; i < facePool.length; i++) { const e = facePool[i]; if (e.id >= 0 && !faceWanted(e.id)) freeRig(e); }
    // 3) hand free rigs to newly-near agents
    for (let i = 0; i < faceN; i++) {
      const id = faceTmpId[i]; if (rigOf[id] >= 0) continue;
      for (let j = 0; j < facePool.length; j++) if (facePool[j].id < 0) { assignRig(facePool[j], id); break; }
    }
    // 4) drive the assigned rigs; persist loot/death back to the analytical store
    for (let i = 0; i < facePool.length; i++) {
      const e = facePool[i]; if (e.id < 0) continue;
      const id = e.id, a = e.actor, rig = e.rig;
      S.grudge[id] = Math.max(S.grudge[id], Math.min(255, ((a.playerGrudge || 0) * 32) | 0));
      if (a.looted && !a._synced) { S.cigs[id] = 0; S.item[id] = 0; a._chain.visible = false; a._synced = true; }
      if (a.dead) {                                   // KILLED — drop loot, remove from the live crowd, ragdoll briefly
        if (!S.dead[id]) {
          if (!a.looted && CBZ.econ && CBZ.econ.lootActor) CBZ.econ.lootActor(a);
          S.cigs[id] = 0; S.item[id] = 0; S.dead[id] = 1; a._chain.visible = false; a._corpseT = 5;
        }
        a._corpseT -= dt; if (CBZ.animChar) CBZ.animChar(rig, 0, dt);
        if (a._corpseT <= 0) { rig.group.visible = false; freeRig(e); }
        continue;
      }
      if (a.ko > 0) {
        a.ko = Math.max(0, a.ko - dt); S.downT[id] = Math.max(S.downT[id], a.ko);
        rig.group.rotation.z = CBZ.damp(rig.group.rotation.z, Math.PI / 2, 11, dt);
      } else if (rig.group.rotation.z !== 0) {
        rig.group.rotation.z = CBZ.damp(rig.group.rotation.z, 0, 9, dt);
        if (Math.abs(rig.group.rotation.z) < 0.02) rig.group.rotation.z = 0;
      }
      const frozen = !!a.intimidMode || a.ko > 0;     // held at gunpoint / knocked out -> crowd sim lets go
      if (!frozen) {
        const bob = Math.abs(Math.sin(S.phase[id])) * 0.035;
        rig.group.position.set(S.prevX[id] + (S.posX[id] - S.prevX[id]) * alpha, bob, S.prevZ[id] + (S.posZ[id] - S.prevZ[id]) * alpha);
        rig.group.rotation.y = S.heading[id];
        if (CBZ.animChar) CBZ.animChar(rig, Math.sqrt(S.velX[id] * S.velX[id] + S.velZ[id] * S.velZ[id]), dt);
      } else {
        if (a.intimidMode) { const w = Math.atan2(p.x - rig.group.position.x, p.z - rig.group.position.z); rig.group.rotation.y = CBZ.lerpAngle(rig.group.rotation.y, w, 1 - Math.pow(0.0006, dt)); }
        if (CBZ.animChar) CBZ.animChar(rig, 0, dt);
      }
    }
  }

  function desiredRigs() {
    return Math.max(0, Math.min(TOTAL, RIG_CAP, CBZ.crowdRenderBudget == null ? RIG_CAP : CBZ.crowdRenderBudget | 0));
  }
  function heapSwap(a, b) {
    let v = heapId[a]; heapId[a] = heapId[b]; heapId[b] = v;
    const d = heapD2[a]; heapD2[a] = heapD2[b]; heapD2[b] = d;
  }
  function heapUp(i) {
    while (i > 0) { const p = (i - 1) >> 1; if (heapD2[p] >= heapD2[i]) break; heapSwap(p, i); i = p; }
  }
  function heapDown(i, size) {
    for (;;) {
      const a = i * 2 + 1; if (a >= size) return;
      const b = a + 1, m = b < size && heapD2[b] > heapD2[a] ? b : a;
      if (heapD2[i] >= heapD2[m]) return;
      heapSwap(i, m); i = m;
    }
  }
  function chooseNearby(force) {
    selectAcc += force ? 99 : 0;
    if (selectAcc < 0.82) return;
    selectAcc = 0;
    const want = desiredRigs(), p = CBZ.player.pos;
    let size = 0;
    for (let id = 0; id < TOTAL; id++) {
      if (S.dead[id]) continue;                         // killed inmates leave the live crowd
      if (!S.explicit[id]) S.materialize(id, simTime);
      const dx = S.posX[id] - p.x, dz = S.posZ[id] - p.z, d2 = dx * dx + dz * dz;
      if (size < want) { heapId[size] = id; heapD2[size] = d2; heapUp(size++); }
      else if (want && d2 < heapD2[0]) { heapId[0] = id; heapD2[0] = d2; heapDown(0, size); }
    }
    selected.fill(0);
    for (let i = 0; i < size; i++) selected[heapId[i]] = 1;
    for (let slot = 0; slot < activeCount; slot++) {
      const id = activeId[slot];
      if (!selected[id]) { S.demote(id, simTime); slotOf[id] = -1; }
    }
    selectedCount = 0;
    for (let id = 0; id < TOTAL; id++) if (selected[id]) {
      if (slotOf[id] < 0) S.promote(id, simTime);
      activeId[selectedCount] = id; slotOf[id] = selectedCount++;
    }
    activeCount = selectedCount;
  }

  const cellHead = new Map(), cellNext = new Int32Array(RIG_CAP);
  function cellKey(x, z) { return (Math.floor(x / 2.2) + 32768) * 65536 + (Math.floor(z / 2.2) + 32768); }
  function rebuildGrid() {
    cellHead.clear(); cellNext.fill(-1);
    for (let slot = 0; slot < activeCount; slot++) {
      const id = activeId[slot], key = cellKey(S.posX[id], S.posZ[id]);
      const head = cellHead.get(key); cellNext[slot] = head == null ? -1 : head; cellHead.set(key, slot);
    }
  }
  function separate() {
    rebuildGrid();
    for (let slot = 0; slot < activeCount; slot++) {
      const id = activeId[slot], x = S.posX[id], z = S.posZ[id];
      const gx = Math.floor(x / 2.2), gz = Math.floor(z / 2.2);
      let seen = 0;
      for (let cx = gx - 1; cx <= gx + 1; cx++) for (let cz = gz - 1; cz <= gz + 1; cz++) {
        let otherSlot = cellHead.get((cx + 32768) * 65536 + (cz + 32768));
        while (otherSlot != null && otherSlot >= 0 && seen++ < 14) {
          const other = activeId[otherSlot];
          if (otherSlot > slot) {
            const dx = x - S.posX[other], dz = z - S.posZ[other], d2 = dx * dx + dz * dz;
            if (d2 > 0.0001 && d2 < 1.55 * 1.55) {
              const d = Math.sqrt(d2), push = (1.55 - d) / d * 0.7;
              S.posX[id] += dx * push; S.posZ[id] += dz * push;
              S.posX[other] -= dx * push; S.posZ[other] -= dz * push;
              if (S.panic[id] > S.panic[other] + 0.18) S.panic[other] = Math.max(S.panic[other], S.panic[id] * 0.82);
              else if (S.panic[other] > S.panic[id] + 0.18) S.panic[id] = Math.max(S.panic[id], S.panic[other] * 0.82);
            }
          }
          otherSlot = cellNext[otherSlot];
        }
      }
    }
  }

  function fixedStep(dt) {
    const player = CBZ.player, armed = CBZ.playerArmed && CBZ.playerArmed();
    for (let z = 0; z < flowTTL.length; z++) if (flowTTL[z] > 0) flowTTL[z] = Math.max(0, flowTTL[z] - dt);
    for (let slot = 0; slot < activeCount; slot++) {
      const id = activeId[slot], zoneId = S.zone[id], zone = S.zones[zoneId];
      if (S.contactCD[id] > 0) S.contactCD[id] = Math.max(0, S.contactCD[id] - dt);
      // a promoted agent that's held at gunpoint / KO'd / dead is owned by the
      // rig + the interaction systems — don't let the crowd sim drag it around.
      const ri = rigOf[id];
      if (ri >= 0) { const fa = facePool[ri].actor; if (fa.dead || fa.ko > 0 || fa.intimidMode) { S.prevX[id] = S.posX[id]; S.prevZ[id] = S.posZ[id]; continue; } }
      S.prevX[id] = S.posX[id]; S.prevZ[id] = S.posZ[id];
      if (S.downT[id] > 0) {
        S.downT[id] = Math.max(0, S.downT[id] - dt);
        S.velX[id] *= Math.pow(0.01, dt); S.velZ[id] *= Math.pow(0.01, dt);
        continue;
      }
      S.brainT[id] -= dt;
      let dx = S.goalX[id] - S.posX[id], dz = S.goalZ[id] - S.posZ[id];
      if (S.brainT[id] <= 0 || dx * dx + dz * dz < 0.8) {
        S.randomPoint(id, S.zone[id], tempPoint);
        S.goalX[id] = tempPoint.x; S.goalZ[id] = tempPoint.z; S.brainT[id] = 2.4 + S.rnd(id) * 5.6;
        dx = S.goalX[id] - S.posX[id]; dz = S.goalZ[id] - S.posZ[id];
      }
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      let wantX = dx / d * S.speed[id], wantZ = dz / d * S.speed[id];
      if (flowTTL[zoneId] > 0) {
        wantX += flowX[zoneId] * flowStrength[zoneId];
        wantZ += flowZ[zoneId] * flowStrength[zoneId];
      }
      const px = S.posX[id] - player.pos.x, pz = S.posZ[id] - player.pos.z, pd2 = px * px + pz * pz;
      if (pd2 < 3.1 * 3.1 && pd2 > 0.0001) {
        const pd = Math.sqrt(pd2), give = (3.1 - pd) / pd * 3.6;
        wantX += px * give; wantZ += pz * give;
        if (armed && pd < 6) S.panic[id] = Math.max(S.panic[id], 0.72);
      }
      const panicMul = 1 + Math.min(1, S.panic[id]) * 1.18;
      wantX = wantX * panicMul + S.avoidX[id]; wantZ = wantZ * panicMul + S.avoidZ[id];
      const follow = 1 - Math.pow(0.001, dt);
      S.velX[id] += (wantX - S.velX[id]) * follow; S.velZ[id] += (wantZ - S.velZ[id]) * follow;
      S.posX[id] += S.velX[id] * dt; S.posZ[id] += S.velZ[id] * dt;
      if (CBZ.humanContact) CBZ.humanContact.resolveAmbientPlayer(S, id, dt);
      if (S.downT[id] > 0 && ri >= 0) facePool[ri].actor.ko = Math.max(facePool[ri].actor.ko || 0, S.downT[id]);
      S.posX[id] = Math.max(zone.x0, Math.min(zone.x1, S.posX[id]));
      S.posZ[id] = Math.max(zone.z0, Math.min(zone.z1, S.posZ[id]));
      S.updateDensityCell(id);
      S.heading[id] = CBZ.lerpAngle(S.heading[id], Math.atan2(S.velX[id], S.velZ[id]), 1 - Math.pow(0.001, dt));
      S.phase[id] += dt * (2.2 + Math.sqrt(S.velX[id] * S.velX[id] + S.velZ[id] * S.velZ[id]) * 1.4);
      S.avoidX[id] *= Math.pow(0.025, dt); S.avoidZ[id] *= Math.pow(0.025, dt); S.panic[id] = Math.max(0, S.panic[id] - dt * 0.22);
    }
    separate();
  }

  function put(mesh, slot, x, y, z, sx, sy, sz, rx) {
    partDummy.position.set(x, y, z); partDummy.rotation.set(rx || 0, 0, 0); partDummy.scale.set(sx, sy, sz); partDummy.updateMatrix();
    worldMatrix.multiplyMatrices(rootDummy.matrix, partDummy.matrix); mesh.setMatrixAt(slot, worldMatrix);
  }
  function renderRigs(alpha) {
    const t0 = performance.now();
    for (let slot = 0; slot < activeCount; slot++) {
      const id = activeId[slot], down = S.downT[id] > 0;
      const bob = down ? 0 : Math.abs(Math.sin(S.phase[id])) * 0.035, swing = down ? 0 : Math.sin(S.phase[id]) * 0.42;
      rootDummy.position.set(S.prevX[id] + (S.posX[id] - S.prevX[id]) * alpha, bob, S.prevZ[id] + (S.posZ[id] - S.prevZ[id]) * alpha);
      rootDummy.rotation.set(0, S.heading[id], down ? Math.PI / 2 : 0); rootDummy.scale.set(1, 1, 1); rootDummy.updateMatrix();
      // promoted to a real face-rig? hide this instanced copy (the rig is drawn instead)
      if (rigOf[id] >= 0) { for (let mi = 0; mi < meshes.length; mi++) put(meshes[mi], slot, 0, 0, 0, 0.0001, 0.0001, 0.0001, 0); continue; }
      put(torso, slot, 0, 1.42, 0, 0.82, 0.88, 0.44, 0); put(head, slot, 0, 2.18, 0, 0.54, 0.54, 0.54, 0);
      put(hair, slot, 0, 2.50, 0, 0.58, 0.14, 0.58, 0); put(legL, slot, -0.20, 0.52, 0, 0.28, 0.92, 0.28, swing);
      put(legR, slot, 0.20, 0.52, 0, 0.28, 0.92, 0.28, -swing); put(armL, slot, -0.55, 1.40, 0, 0.24, 0.78, 0.24, -swing * 0.82);
      put(armR, slot, 0.55, 1.40, 0, 0.24, 0.78, 0.24, swing * 0.82);
      // FACE — two eyes + a mouth on the front of the head (z+ = forward)
      put(eyeL, slot, -0.12, 2.235, 0.235, 0.10, 0.13, 0.06, 0);
      put(eyeR, slot, 0.12, 2.235, 0.235, 0.10, 0.13, 0.06, 0);
      put(mouth, slot, 0, 2.045, 0.235, 0.20, 0.05, 0.05, 0);
      // a worn VALUABLE (chain/watch/tooth/cash) at the chest, only if carried —
      // this is the "see a guy with a chain" hook; non-carriers shrink to nothing.
      const vcol = S.itemColor ? S.itemColor(id) : 0;
      if (vcol) { put(valuable, slot, 0, 1.60, 0.225, 0.36, 0.12, 0.07, 0); valuable.setColorAt(slot, tint.setHex(vcol)); }
      else put(valuable, slot, 0, 1.60, 0.225, 0.0001, 0.0001, 0.0001, 0);
      head.setColorAt(slot, tint.setHex(S.skin[id])); hair.setColorAt(slot, tint.setHex(S.hair[id]));
    }
    for (let i = 0; i < meshes.length; i++) { meshes[i].count = activeCount; meshes[i].instanceMatrix.needsUpdate = true; }
    if (head.instanceColor) head.instanceColor.needsUpdate = true;
    if (hair.instanceColor) hair.instanceColor.needsUpdate = true;
    if (valuable.instanceColor) valuable.instanceColor.needsUpdate = true;
    CBZ.crowdPerformance.renderTimeMs = performance.now() - t0;
  }
  function dotHex(id) {
    if (S.faction[id] === 0) return 0xff8686;
    if (S.faction[id] === 1) return 0x8fb0ff;
    return S.skin[id] || DOT_COLORS[S.role[id]] || DOT_COLORS[0];   // non-gang dots take their SKIN tone so the birds-eye crowd reads as people, not white blobs
  }
  function densityMode() { return !!(CBZ.simView && CBZ.simView.active && CBZ.simView.height >= 220); }
  function renderDensity() {
    densityCount = 0;
    for (let cell = 0; cell < DENSITY_CAP; cell++) {
      const pop = densityPopulation[cell];
      if (!pop) continue;
      const x = cell % DENSITY_W, z = (cell / DENSITY_W) | 0, i = densityCount * 3;
      densityPosition[i] = WORLD.minX + (x + 0.5) * DENSITY_CELL;
      densityPosition[i + 1] = 0.32;
      densityPosition[i + 2] = WORLD.minZ + (z + 0.5) * DENSITY_CELL;
      const hex = densityFaction[cell] < -pop * 0.16 ? 0xff9a86 : (densityFaction[cell] > pop * 0.16 ? 0x91b8ff : 0xf0d77c);
      tint.setHex(hex).multiplyScalar(Math.min(1.55, 0.62 + Math.log2(pop + 1) * 0.14));
      densityColor[i] = tint.r; densityColor[i + 1] = tint.g; densityColor[i + 2] = tint.b;
      densityCount++;
    }
    densityGeom.setDrawRange(0, densityCount);
    densityPosAttr.needsUpdate = true; densityColorAttr.needsUpdate = true;
  }
  function renderPoints(force) {
    const density = densityMode();
    if (!force && pointsAcc < (density ? 0.24 : 0.10)) return;
    pointsAcc = 0;
    const t0 = performance.now();
    if (density) {
      renderDensity();
      CBZ.crowdPerformance.renderTimeMs = performance.now() - t0;
      return;
    }
    const isA = CBZ.AB_TEST === "A";

    if (isA) {
      // Config A: CPU matrix uploads of 3D boxes
      for (let id = 0; id < POINT_CAP; id++) {
        if (!S.explicit[id]) S.materialize(id, simTime);
        rootDummy.position.set(S.posX[id], 0.16, S.posZ[id]);
        rootDummy.rotation.set(0, 0, 0);
        rootDummy.scale.set(0.72, 0.16, 0.72);
        rootDummy.updateMatrix();
        overviewBoxes.setMatrixAt(id, rootDummy.matrix);
        overviewBoxes.setColorAt(id, tint.setHex(dotHex(id)).multiplyScalar(0.62 + S.mood[id] / 132));
      }
      overviewBoxes.count = POINT_CAP;
      overviewBoxes.instanceMatrix.needsUpdate = true;
      if (overviewBoxes.instanceColor) overviewBoxes.instanceColor.needsUpdate = true;
    } else {
      // Config B: GPU Point-cloud buffer attribute uploads
      for (let id = 0; id < POINT_CAP; id++) {
        if (!S.explicit[id]) S.materialize(id, simTime);
        const i = id * 3; pointPosition[i] = S.posX[id]; pointPosition[i + 1] = 0.22; pointPosition[i + 2] = S.posZ[id];
        tint.setHex(dotHex(id)).multiplyScalar(0.62 + S.mood[id] / 132);
        pointColor[i] = tint.r; pointColor[i + 1] = tint.g; pointColor[i + 2] = tint.b;
      }
      pointPosAttr.needsUpdate = true; pointColorAttr.needsUpdate = true;
    }
    CBZ.crowdPerformance.renderTimeMs = performance.now() - t0;
  }
  function refreshRenderMode(force) {
    const overview = !!(CBZ.simView && CBZ.simView.active);
    const isA = CBZ.AB_TEST === "A";
    const density = densityMode();
    if (force || overview !== lastOverview || density !== lastDensity || CBZ.lastABTest !== CBZ.AB_TEST) {
      overviewPoints.visible = overview && !density && !isA;
      overviewBoxes.visible = overview && !density && isA;
      densityPoints.visible = overview && density;
      for (let i = 0; i < meshes.length; i++) meshes[i].visible = !overview;
      if (overview) renderPoints(true);
      lastOverview = overview;
      lastDensity = density;
      CBZ.lastABTest = CBZ.AB_TEST;
    }
    CBZ.crowdStats = { total: TOTAL, rigs: activeCount, rigCapacity: RIG_CAP, visible: overview ? (density ? densityCount : POINT_CAP) : activeCount, active: activeCount, drawCalls: overview ? 1 : 7, mode: overview ? (density ? "density" : "overview") : "close", shared: S.shared, abMode: CBZ.AB_TEST };
  }
  CBZ.refreshCrowdBudget = function () {
    if (!societyOverview) chooseNearby(true);
    refreshRenderMode(true);
  };

  CBZ.alertCrowd = function (x, z, radius, strength) {
    const r2 = (radius || 9) * (radius || 9);
    for (let slot = 0; slot < activeCount; slot++) {
      const id = activeId[slot], dx = S.posX[id] - x, dz = S.posZ[id] - z, d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) || 0.001, k = Math.max(0, 1 - d / (radius || 9));
      S.panic[id] = Math.max(S.panic[id], (strength || 1) * k); S.avoidX[id] += dx / d * k * 3.2; S.avoidZ[id] += dz / d * k * 3.2;
    }
    for (let zone = 0; zone < S.zones.length; zone++) {
      const area = S.zones[zone], cx = (area.x0 + area.x1) * 0.5, cz = (area.z0 + area.z1) * 0.5;
      if (x >= area.x0 - radius && x <= area.x1 + radius && z >= area.z0 - radius && z <= area.z1 + radius) {
        CBZ.setCrowdFlow(zone, cx - x, cz - z, 1.2 + (strength || 1) * 0.8, 3.5);
      }
    }
    if (societyWorker) societyWorker.postMessage({ type: "event", x, z, radius: radius || 9, strength: (strength || 1) * 48, kind: 3 });
  };

  // ---- worker-backed off-screen consequences -------------------------
  const societyStats = { total: TOTAL, hidden: TOTAL, timeScale: 1, simTicks: 0, interactions: 0, rumors: 0, deals: 0, conflicts: 0, calms: 0, witnesses: 0, worker: false, shared: S.shared };
  function snapshotPositions() {
    if (S.sharedPositionBuffers) {
      sharedWrite ^= 1; const out = S.sharedPositionBuffers[sharedWrite];
      S.snapshot(simTime, out); Atomics.store(S.sharedPositionMeta, 0, sharedWrite); Atomics.add(S.sharedPositionMeta, 1, 1);
      return { type: "positions", sharedIndex: sharedWrite, visible: activeCount };
    }
    const positions = S.snapshot(simTime);
    return { type: "positions", positions, visible: activeCount, transfer: [positions.buffer] };
  }
  function syncSociety() {
    if (!societyWorker) return;
    const m = snapshotPositions(), transfer = m.transfer || []; delete m.transfer;
    Object.assign(m, { playerX: CBZ.player.pos.x, playerZ: CBZ.player.pos.z, playerArmed: !!(CBZ.playerArmed && CBZ.playerArmed()), playerHeat: (CBZ.game && CBZ.game.detection) || 0 });
    societyWorker.postMessage(m, transfer);
  }
  function setSocietySpeed(value) { value = Math.max(1, Math.min(64, value | 0)); societyStats.timeScale = value; if (societyWorker) societyWorker.postMessage({ type: "speed", value }); return value; }
  function setSocietyOverview(value) {
    societyOverview = !!value; societyAcc = 0;
    if (societyOverview) {
      for (let slot = 0; slot < activeCount; slot++) { const id = activeId[slot]; S.demote(id, simTime); slotOf[id] = -1; }
      activeCount = 0;
    } else {
      selectAcc = 99; chooseNearby(true);
    }
    refreshRenderMode(true);
    if (societyWorker) societyWorker.postMessage({ type: "overview", value: societyOverview });
  }
  CBZ.crowdSociety = { stats: societyStats, roles: ROLE_NAMES, setSpeed: setSocietySpeed, setOverview: setSocietyOverview, snapshot: syncSociety };
  try {
    if (CBZ.DISABLE_CROWD_WORKER) throw new Error("crowd worker disabled");
    societyWorker = new Worker("src/workers/crowd-worker.js?v=scale9");
    societyWorker.onmessage = function (e) {
      const m = e.data || {};
      if (m.stats) Object.assign(societyStats, m.stats, { worker: true, shared: S.shared });
      if (m.type !== "patch" || !m.ids || !m.summary) return;
      for (let i = 0; i < m.ids.length; i++) {
        const id = m.ids[i];
        S.mood[id] = m.summary[i * 4]; S.role[id] = m.summary[i * 4 + 3];
        if (m.facts) S.facts[id] = m.facts[i];
      }
    };
    societyWorker.onerror = function () { societyStats.worker = false; };
    const first = snapshotPositions(), transfer = first.transfer || []; delete first.transfer;
    societyWorker.postMessage({ type: "init", count: TOTAL, visible: activeCount, positions: first.positions, sharedPositionBuffers: S.sharedPositionBuffers, sharedPositionMeta: S.sharedPositionMeta, sharedIndex: first.sharedIndex, roles: S.role, factions: S.faction, nerve: S.nerve, empathy: S.empathy, greed: S.greed, facts: S.facts }, transfer);
  } catch (_) { societyWorker = null; }

  function step(dt) {
    const escape = CBZ.game.mode === "escape"; root.visible = escape;
    if (!escape) { if (facePool.length) freeAllRigs(); return; }
    const playing = CBZ.game.state === "playing";
    if (societyWorker && societyRunning !== playing) { societyRunning = playing; societyWorker.postMessage({ type: "running", value: playing }); }
    if (playing) {
      const t0 = performance.now();
      simTime += dt * ((CBZ.simView && CBZ.simView.active) ? Math.min(16, societyStats.timeScale || 1) : 1);
      S.clock = simTime;
      if (!societyOverview) {
        selectAcc += dt; chooseNearby(false);
        fixedAcc = Math.min(FIXED * 3, fixedAcc + dt);
        while (fixedAcc >= FIXED) { fixedStep(FIXED); fixedAcc -= FIXED; }
      }
      CBZ.crowdPerformance.simTimeMs = performance.now() - t0;

      societyAcc += dt;
      // Society consequences are event-driven. Position snapshots only refresh
      // neighborhood context; they are not a hidden movement timestep.
      const every = societyOverview ? (densityMode() ? 3.2 : 1.2) : 6;
      if (societyAcc >= every) { societyAcc %= every; syncSociety(); }
    }
    const overview = !!(CBZ.simView && CBZ.simView.active);
    pointsAcc += dt; renderAcc += dt;
    if (overview) { renderPoints(false); if (facePool.length) freeAllRigs(); }
    else {
      const every = CBZ.qualityLevel != null && CBZ.qualityLevel < 2 ? 1 / 30 : 1 / 60;
      if (renderAcc >= every) { renderAcc %= every; renderRigs(fixedAcc / FIXED); }
      // real face-rigs follow the sim every frame (smooth) and own gunpoint/KO/death
      syncFaceRigs(fixedAcc / FIXED, dt);
    }
    frame++; refreshRenderMode(false);
  }

  CBZ.resetCrowd = function () {
    freeAllRigs();                          // hand back all face-rigs
    if (S.respawnAll) S.respawnAll();       // revive the killed + re-roll pockets
    for (let slot = 0; slot < activeCount; slot++) { const id = activeId[slot]; S.demote(id, simTime); slotOf[id] = -1; }
    activeCount = 0; selectAcc = 99; fixedAcc = societyAcc = 0; chooseNearby(true); refreshRenderMode(true);
    if (societyWorker) { societyWorker.postMessage({ type: "reset" }); syncSociety(); }
  };
  chooseNearby(true); refreshRenderMode(true);
  CBZ.onUpdate(23.5, step);
})();
