/* ============================================================
   entities/crowd.js - bounded real inmates + mathematical society tier.

   Total population is independent from render capacity. Nearby rows are
   promoted into ordinary registered makeCharacter actors. Hidden rows remain
   analytical route segments in ambientstate.js and are never drawn as people.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, S = CBZ.ambient;
  if (!CBZ || !S || !S.total || !THREE.InstancedMesh || !THREE.Points) return;

  const TOTAL = S.total, RIG_CAP = S.rigCapacity, FIXED = 1 / 20;
  const ACT = S.ACTIVITY || { WALK: 0, STAND: 1, SOCIAL: 2, ACTION: 3, FIGHT: 4, FLEE: 5 };
  const ROLE_NAMES = ["drifter", "runner", "lookout", "enforcer", "trader", "mediator"];
  const DOT_COLORS = [0xd8d2c4, 0x8bdeff, 0xffcf70, 0xff756b, 0x9eea96, 0xc9a6ff];
  const root = new THREE.Group();
  root.name = "mass-crowd";
  root.userData.dynamic = true;
  (CBZ.prisonRoot || CBZ.scene).add(root);

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
  // NO FAKE PEOPLE: these legacy shared meshes remain allocated only because a
  // few old debug helpers reference them. They never receive a visible count;
  // every inmate the player can see is one of the normal registered rigs below.
  for (let i = 0; i < meshes.length; i++) { meshes[i].count = 0; meshes[i].visible = false; }

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
  // HUMAN SCALE (scale-agent handoff): this prison ambient mass shares the SAME
  // ~2.6m voxel part layout as city/crowd.js drawParts (torso 1.42, head 2.18…).
  // The player rig renders at CBZ.HUMAN_SCALE (0.70). Mirror it as one uniform
  // scale on the per-agent root (parts offset up from the ground-level root, so
  // every offset + height shrinks proportionally and feet stay grounded). Kept
  // byte-in-lockstep with crowd.js. One-line revert: CBZ.CONFIG.CHAR_SCALE_REAL=false.
  const HUMAN_S = (!CBZ.CONFIG || CBZ.CONFIG.CHAR_SCALE_REAL !== false) ? (CBZ.HUMAN_SCALE || 0.70) : 1;
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
  // STANDARD ACTOR TIER — every visible agent is a REAL makeCharacter rig
  // registered in CBZ.npcs, so EVERY existing system lets you hold them at
  // gunpoint, beat, KO, kill and loot them. The greater society remains an
  // invisible analytical population; it is never rendered as boxes or points.
  // Looting + death persist into that store, so the same inmate remembers you.
  // ============================================================
  // Pool is allocated ONCE at the biggest count the live budget can ever ask
  // for (tier-4 value, or the explicit CBZ.CROWD_FACE_RIGS override); the
  // per-frame budget below rides the quality tier, so spare rigs just idle.
  const STANDARD_ACTOR_CAP = Math.max(0, Math.min(TOTAL, RIG_CAP,
    CBZ.CROWD_REAL_ACTORS == null ? 48 : CBZ.CROWD_REAL_ACTORS | 0));
  const FACE_POOL = STANDARD_ACTOR_CAP;
  // LIVE face-rig budget + promotion range: defaults ride the quality tier
  // (CBZ.qScale, read at use time each frame — pause-menu perf/quality
  // slider; mid-tier ≈ the old fixed 40 rigs / 30u). Explicit
  // CBZ.CROWD_FACE_RIGS / CBZ.CROWD_FACE_DIST overrides still win.
  function faceBudget() {
    return FACE_POOL;
  }
  function faceDist2() {
    return Infinity;
  }
  const FAR_AWAY = -1000;
  const rigOf = new Int32Array(TOTAL); rigOf.fill(-1);
  const facePool = [];
  function cloneShared(m) { if (m && m.material && m.material._shared) m.material = m.material.clone(); }
  // WOMEN IN THE CROWD (W3): this pool is built ONCE at load (not per-agent,
  // like city/crowd.js's own promotion pool), so there's no ambient id to
  // stream a seeded roll off yet — Math.random() here only decides the
  // pool's fixed build split (~48% female), never a per-frame/per-agent
  // outcome. build/longHair reuse character.js's existing fem geometry path.
  function makeFaceEntry(pi) {
    const fem = Math.random() < 0.48;
    const rig = CBZ.makeCharacter({ legs: 0xff7a1a, torso: 0xff7a1a, collar: 0xff9747, arms: 0xff7a1a, skin: 0xd8a177, hair: 0x2a2018, stripes: 0xc85c00, shoes: 0x2b2b2b, build: fem ? "f" : "m", longHair: fem && Math.random() < 0.6 });
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
    facePool.push({ rig: rig, actor: actor, id: -1, pi: pi, fem: fem });
    CBZ.npcs.push(actor);
  }
  for (let i = 0; i < FACE_POOL; i++) makeFaceEntry(i);

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
    a.aiState = "wander"; a.foe = null;
    a.loadout = { cigs: S.cigs[id], items: S.item[id] ? [S.itemName(id)] : [] };
    if (CBZ.econ && CBZ.econ.pickOffer && !a.data.offer) a.data.offer = CBZ.econ.pickOffer("goods");
    setRigSkin(rig, S.skin[id], S.hair[id]);
    const vcol = S.itemColor(id); a._chain.visible = !!vcol; if (vcol) a._chain.material = CBZ.cmat(vcol);
    rig.group.rotation.set(0, S.heading[id], 0);
    rig.group.position.set(S.posX[id], 0, S.posZ[id]);
    rig.phase = S.phase[id];
    rig.group.visible = true;
  }
  function freeRig(e) {
    const a = e.actor, id = e.id;
    if (id >= 0) {
      if (!S.dead[id]) { S.posX[id] = a.group.position.x; S.posZ[id] = a.group.position.z; }
      S.grudge[id] = Math.max(S.grudge[id], Math.min(255, ((a.playerGrudge || 0) * 32) | 0));
      S.downT[id] = Math.max(S.downT[id], a.ko || 0);
      S.phase[id] = e.rig.phase;
      rigOf[id] = -1;
    }
    e.id = -1; a._id = -1; a.dead = true; a.intimidMode = null; a.poseHandsUp = false; a.poseAimBack = false;
    a.aiState = "wander"; a.foe = null;
    a._chain.visible = false; a.group.position.y = FAR_AWAY; a.group.visible = true;
  }
  function freeAllRigs() { for (let i = 0; i < facePool.length; i++) if (facePool[i].id >= 0) freeRig(facePool[i]); }

  const faceTmpId = new Int32Array(Math.max(1, FACE_POOL)), faceTmpD2 = new Float64Array(Math.max(1, FACE_POOL));
  let faceN = 0, faceMaxAt = 0;
  function faceMax() { faceMaxAt = 0; for (let i = 1; i < faceN; i++) if (faceTmpD2[i] > faceTmpD2[faceMaxAt]) faceMaxAt = i; }
  function faceConsider(id, d2, budget) {   // budget = live per-frame face-rig count
    if (faceN < budget) { faceTmpId[faceN] = id; faceTmpD2[faceN] = d2; faceN++; if (faceN === budget) faceMax(); }
    else if (budget > 0 && d2 < faceTmpD2[faceMaxAt]) { faceTmpId[faceMaxAt] = id; faceTmpD2[faceMaxAt] = d2; faceMax(); }
  }
  function faceWanted(id) { for (let i = 0; i < faceN; i++) if (faceTmpId[i] === id) return true; return false; }

  function syncFaceRigs(alpha, dt) {
    if (!FACE_POOL) return;
    const p = CBZ.player.pos;
    const FR = faceBudget(), FD2 = faceDist2();   // live reads — ride the quality tier this frame
    // 1) nearest FR active, alive agents within face range
    faceN = 0;
    for (let slot = 0; slot < activeCount; slot++) {
      const id = activeId[slot]; if (S.dead[id]) continue;
      const dx = S.posX[id] - p.x, dz = S.posZ[id] - p.z, d2 = dx * dx + dz * dz;
      if (d2 <= FD2) faceConsider(id, d2, FR);
    }
    // 2) release rigs whose agent dropped out of range
    for (let i = 0; i < facePool.length; i++) { const e = facePool[i]; if (e.id >= 0 && !faceWanted(e.id)) freeRig(e); }
    // 3) hand free rigs to newly-near agents. GENDER-MATCHED PICK (W3): a
    //    pooled rig's build is baked into its geometry at load (makeFaceEntry
    //    rolled a fixed ~48/52 split), so it can't be reshaped per-agent —
    //    prefer the free rig whose build already matches S.fem[id] so the
    //    silhouette doesn't flip when the instanced body becomes a real face.
    //    Falls back to any free rig (never blocks a promotion over this).
    for (let i = 0; i < faceN; i++) {
      const id = faceTmpId[i]; if (rigOf[id] >= 0) continue;
      const wantFem = !!S.fem[id];
      let pick = -1;
      for (let j = 0; j < facePool.length; j++) {
        const e = facePool[j]; if (e.id >= 0) continue;
        if (pick < 0) pick = j;
        if (!!e.fem === wantFem) { pick = j; break; }
      }
      if (pick >= 0) assignRig(facePool[pick], id);
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
      const activity = S.activity[id] || ACT.WALK;
      if (!a.intimidMode && a.ko <= 0) {
        a.aiState = activity === ACT.FIGHT ? "fight"
          : activity === ACT.SOCIAL ? "socialize"
            : activity === ACT.ACTION ? "activity"
              : activity === ACT.STAND ? "idle"
                : activity === ACT.FLEE ? "flee" : "wander";
        const partner = S.partner[id];
        const partnerRig = partner >= 0 && partner < TOTAL ? rigOf[partner] : -1;
        a.foe = activity === ACT.FIGHT && partnerRig >= 0 ? facePool[partnerRig].actor : null;
      }
      const frozen = !!a.intimidMode || a.ko > 0;     // held at gunpoint / knocked out -> crowd sim lets go
      if (!frozen) {
        const moveSpeed = Math.sqrt(S.velX[id] * S.velX[id] + S.velZ[id] * S.velZ[id]);
        const moving = moveSpeed > 0.08;
        const bob = moving ? Math.abs(Math.sin(S.phase[id])) * 0.035 : 0;
        rig.group.position.set(S.prevX[id] + (S.posX[id] - S.prevX[id]) * alpha, bob, S.prevZ[id] + (S.posZ[id] - S.prevZ[id]) * alpha);
        rig.group.rotation.y = S.heading[id];
        if (CBZ.animChar) CBZ.animChar(rig, moving ? moveSpeed : 0, dt);
        // The promoted actor uses the same readable in-place vocabulary as
        // its instanced counterpart. These writes happen after animChar so a
        // held inmate cannot silently fall back into the walk-cycle pose.
        if (rig.parts && activity === ACT.ACTION) {
          const sw = Math.sin(S.phase[id]) * 0.32;
          if (rig.parts.la) rig.parts.la.rotation.x = -0.78 + sw;
          if (rig.parts.ra) rig.parts.ra.rotation.x = -0.78 - sw;
        } else if (rig.parts && activity === ACT.FIGHT) {
          const sw = Math.sin(S.phase[id]);
          if (rig.parts.la) rig.parts.la.rotation.x = -0.45 - Math.max(0, -sw) * 1.05;
          if (rig.parts.ra) rig.parts.ra.rotation.x = -0.45 - Math.max(0, sw) * 1.05;
        }
      } else {
        if (a.intimidMode) { const w = Math.atan2(p.x - rig.group.position.x, p.z - rig.group.position.z); rig.group.rotation.y = CBZ.lerpAngle(rig.group.rotation.y, w, 1 - Math.pow(0.0006, dt)); }
        if (CBZ.animChar) CBZ.animChar(rig, 0, dt);
      }
    }
  }

  function desiredRigs() {
    const budget = CBZ.crowdRenderBudget == null ? STANDARD_ACTOR_CAP : CBZ.crowdRenderBudget | 0;
    return Math.max(0, Math.min(TOTAL, STANDARD_ACTOR_CAP, budget));
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
      if (S.parked[id]) continue;                       // locked down in a cell → never selected
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

  // A restrained close-crowd scuffle director. Rich named inmates already run
  // the full ai.js combat brain; this gives the instanced population the same
  // visible vocabulary without promoting hundreds of actors or running pairwise
  // combat scans every frame. At most one new pair is selected every ~14-28s,
  // only from the already-active local set. The loser takes a real persistent
  // crowd knockdown (S.downT), so it is an action with a consequence, not a looped
  // decorative animation.
  let _scuffleCD = 8;
  function clearActivity(id) {
    const p = S.partner[id];
    S.activity[id] = ACT.WALK; S.activityT[id] = 0; S.partner[id] = -1; S.strikeT[id] = 0;
    if (p >= 0 && p < TOTAL && S.partner[p] === id) {
      S.activity[p] = ACT.WALK; S.activityT[p] = 0; S.partner[p] = -1; S.strikeT[p] = 0;
    }
  }
  function resolveScuffle(id, other) {
    if (other < 0 || other >= TOTAL) { clearActivity(id); return; }
    const a = (S.nerve[id] || 50) + S.idHash(id, 0xF17E) * 35;
    const b = (S.nerve[other] || 50) + S.idHash(other, 0xF17E) * 35;
    const loser = a >= b ? other : id;
    S.downT[loser] = Math.max(S.downT[loser], 4.5 + S.idHash(loser, 0xD04A) * 4);
    S.panic[loser] = 0;
    const ri = rigOf[loser];
    if (ri >= 0) facePool[ri].actor.ko = Math.max(facePool[ri].actor.ko || 0, S.downT[loser]);
    clearActivity(id);
  }
  function startScuffle() {
    if (!schedOn() || activeCount < 2 || _jailAct === 0 || _jailAct === 2 || _jailAct === 5) return false;
    for (let s = 0; s < activeCount; s++) {
      const id = activeId[(s + (frame % activeCount)) % activeCount];
      if (S.dead[id] || S.parked[id] || S.downT[id] > 0 || S.panic[id] > 0.2 || S.activity[id] === ACT.FIGHT) continue;
      if ((S.nerve[id] || 0) < 62 || S.idHash(id, (simTime / 16) | 0) > 0.28) continue;
      let best = -1, bd = 6.5 * 6.5;
      for (let t = 0; t < activeCount; t++) {
        const other = activeId[t];
        if (other === id || S.zone[other] !== S.zone[id] || S.dead[other] || S.parked[other] || S.downT[other] > 0 || S.activity[other] === ACT.FIGHT) continue;
        // Rival crews are the usual spark; a very reactive loner can also start it.
        if (S.faction[id] === S.faction[other] && (S.reactivity[id] || 0) < 210) continue;
        const dx = S.posX[other] - S.posX[id], dz = S.posZ[other] - S.posZ[id], d2 = dx * dx + dz * dz;
        if (d2 > 1.8 * 1.8 && d2 < bd) { bd = d2; best = other; }
      }
      if (best < 0) continue;
      const dur = 4.5 + S.idHash(id + best, 0xB4A1) * 3.5;
      S.activity[id] = S.activity[best] = ACT.FIGHT;
      S.activityT[id] = S.activityT[best] = dur;
      S.partner[id] = best; S.partner[best] = id;
      S.strikeT[id] = 0.2; S.strikeT[best] = 0.55;
      return true;
    }
    return false;
  }

  function fixedStep(dt) {
    const player = CBZ.player, armed = CBZ.playerArmed && CBZ.playerArmed();
    _scuffleCD -= dt;
    if (_scuffleCD <= 0) {
      startScuffle();
      _scuffleCD = 14 + Math.random() * 14;
    }
    for (let z = 0; z < flowTTL.length; z++) if (flowTTL[z] > 0) flowTTL[z] = Math.max(0, flowTTL[z] - dt);
    for (let slot = 0; slot < activeCount; slot++) {
      const id = activeId[slot], zoneId = S.zone[id], zone = S.zones[zoneId];
      // locked down mid-selection (parked before chooseNearby's next sweep):
      // frozen at the bunk — the zone clamp below would otherwise drag the
      // cell-block position back into the yard rectangle in plain sight.
      if (S.parked[id]) continue;
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
      let activity = S.activity[id] || ACT.WALK;
      if (S.activityT[id] > 0) S.activityT[id] = Math.max(0, S.activityT[id] - dt);
      if (activity === ACT.FIGHT) {
        const other = S.partner[id];
        if (other < 0 || other >= TOTAL || S.dead[other] || S.parked[other] || S.downT[other] > 0 || S.partner[other] !== id) {
          clearActivity(id); activity = ACT.WALK;
        } else if (S.activityT[id] <= 0) {
          resolveScuffle(id, other); activity = ACT.WALK;
        } else {
          S.goalX[id] = S.posX[other]; S.goalZ[id] = S.posZ[other]; S.brainT[id] = 0.25;
          const fd = Math.hypot(S.goalX[id] - S.posX[id], S.goalZ[id] - S.posZ[id]);
          if (fd < 1.8) {
            S.strikeT[id] -= dt;
            if (S.strikeT[id] <= 0) { S.strikeT[id] = 0.65 + S.idHash(id, (simTime * 4) | 0) * 0.45; S.phase[id] += 0.9; }
          }
        }
      }
      if (S.panic[id] > 0.45 && activity !== ACT.FIGHT) { activity = S.activity[id] = ACT.FLEE; }
      else if (activity === ACT.FLEE && S.panic[id] <= 0.08) { activity = S.activity[id] = ACT.WALK; }

      S.brainT[id] -= dt;
      let dx = S.goalX[id] - S.posX[id], dz = S.goalZ[id] - S.posZ[id];
      if (activity !== ACT.FIGHT && (S.brainT[id] <= 0 || dx * dx + dz * dz < 0.8)) {
        // NPC_SCHEDULES: the daily regime proposes this hour's goal — a lap
        // corner, a chow-line slot, a stand-circle spot, a wall post. A HELD
        // post (jg 2) re-arms the same point on a short brain timer, so the
        // body walks there once and then STANDS (velocity decays at the goal)
        // instead of brownian-pacing. No proposal → the old wander.
        const jg = jailGoal(id, tempPoint);
        if (jg) {
          S.goalX[id] = tempPoint.x; S.goalZ[id] = tempPoint.z;
          S.brainT[id] = jg === 2 ? 2.5 + S.rnd(id) * 2 : 4 + S.rnd(id) * 4;
          S.activity[id] = tempPoint.activity == null ? ACT.WALK : tempPoint.activity;
          S.activityHeading[id] = tempPoint.heading || 0;
          if (S.activity[id] !== ACT.FIGHT) S.partner[id] = -1;
        } else {
          S.randomPoint(id, S.zone[id], tempPoint);
          S.goalX[id] = tempPoint.x; S.goalZ[id] = tempPoint.z; S.brainT[id] = 2.4 + S.rnd(id) * 5.6;
          S.activity[id] = ACT.WALK; S.partner[id] = -1;
        }
        activity = S.activity[id];
        dx = S.goalX[id] - S.posX[id]; dz = S.goalZ[id] - S.posZ[id];
      }
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      const held = (activity === ACT.STAND || activity === ACT.SOCIAL || activity === ACT.ACTION) && dx * dx + dz * dz < 0.9;
      const fightingClose = activity === ACT.FIGHT && dx * dx + dz * dz < 1.75 * 1.75;
      let wantX = (held || fightingClose) ? 0 : dx / d * S.speed[id];
      let wantZ = (held || fightingClose) ? 0 : dz / d * S.speed[id];
      if (activity === ACT.FIGHT && !fightingClose) { wantX *= 1.25; wantZ *= 1.25; }
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
      const face = held ? S.activityHeading[id]
        : fightingClose ? Math.atan2(dx, dz)
          : Math.atan2(S.velX[id], S.velZ[id]);
      S.heading[id] = CBZ.lerpAngle(S.heading[id], face, 1 - Math.pow(0.001, dt));
      const moveSpeed = Math.sqrt(S.velX[id] * S.velX[id] + S.velZ[id] * S.velZ[id]);
      if (activity === ACT.FIGHT || activity === ACT.ACTION) S.phase[id] += dt * (activity === ACT.FIGHT ? 8.5 : 3.2);
      else if (moveSpeed > 0.08) S.phase[id] += CBZ.gaitPhaseDelta ? CBZ.gaitPhaseDelta(moveSpeed, dt) : dt * (2.2 + moveSpeed * 1.4);
      S.avoidX[id] *= Math.pow(0.025, dt); S.avoidZ[id] *= Math.pow(0.025, dt); S.panic[id] = Math.max(0, S.panic[id] - dt * 0.22);
    }
    separate();
  }

  function put(mesh, slot, x, y, z, sx, sy, sz, rx) {
    partDummy.position.set(x, y, z); partDummy.rotation.set(rx || 0, 0, 0); partDummy.scale.set(sx, sy, sz); partDummy.updateMatrix();
    worldMatrix.multiplyMatrices(rootDummy.matrix, partDummy.matrix); mesh.setMatrixAt(slot, worldMatrix);
  }
  function renderRigs(alpha) {
    // The historical part-instance path is intentionally hard-disabled.  Real
    // character rigs are positioned and animated by syncFaceRigs below.
    for (let i = 0; i < meshes.length; i++) { meshes[i].count = 0; meshes[i].visible = false; }
    CBZ.crowdPerformance.renderTimeMs = 0;
    return;
    /* istanbul ignore next -- retained only for old debug-state compatibility */
    const t0 = performance.now();
    for (let slot = 0; slot < activeCount; slot++) {
      const id = activeId[slot], down = S.downT[id] > 0;
      const activity = S.activity[id] || ACT.WALK;
      const moving = Math.hypot(S.velX[id], S.velZ[id]) > 0.2;
      const doing = activity === ACT.ACTION, fighting = activity === ACT.FIGHT;
      const bob = down ? 0 : doing ? -Math.abs(Math.sin(S.phase[id])) * 0.11
        : (!moving ? 0 : Math.abs(Math.sin(S.phase[id])) * 0.035);
      const swing = down || !moving ? 0 : Math.sin(S.phase[id]) * 0.42;
      // In-place activities have a readable silhouette: ACTION alternates a
      // squat/stretch; FIGHT throws short opposing punches. Stationary social
      // and stand states keep relaxed arms instead of the old walk loop.
      const armLX = down ? 0 : fighting ? (-0.45 - Math.max(0, -Math.sin(S.phase[id])) * 1.0)
        : doing ? (-0.75 + Math.sin(S.phase[id]) * 0.38) : -swing * 0.82;
      const armRX = down ? 0 : fighting ? (-0.45 - Math.max(0, Math.sin(S.phase[id])) * 1.0)
        : doing ? (-0.75 - Math.sin(S.phase[id]) * 0.38) : swing * 0.82;
      rootDummy.position.set(S.prevX[id] + (S.posX[id] - S.prevX[id]) * alpha, bob, S.prevZ[id] + (S.posZ[id] - S.prevZ[id]) * alpha);
      rootDummy.rotation.set(0, S.heading[id], down ? Math.PI / 2 : 0); rootDummy.scale.set(HUMAN_S, HUMAN_S, HUMAN_S); rootDummy.updateMatrix();
      // promoted to a real face-rig? hide this instanced copy (the rig is drawn
      // instead). Parked (night lockdown, in a cell) hides the same way until
      // chooseNearby's next sweep deselects it.
      if (rigOf[id] >= 0 || S.parked[id]) { for (let mi = 0; mi < meshes.length; mi++) put(meshes[mi], slot, 0, 0, 0, 0.0001, 0.0001, 0.0001, 0); continue; }
      // WOMEN IN THE CROWD (W3): S.fem[id] (ambientstate.js, rolled ~48% off the
      // same deterministic rnd(id) stream as skin/hair) narrows the torso, trims
      // the head, slims + closes in the arms/legs, and stretches the hair box
      // down behind the head so it reads long. Male (else) path is byte-
      // identical to the original single-path numbers.
      if (S.fem[id]) {
        put(torso, slot, 0, 1.42, 0, 0.82 * 0.85, 0.88, 0.44 * 0.88, 0); put(head, slot, 0, 2.18, 0, 0.54 * 0.92, 0.54 * 0.92, 0.54 * 0.92, 0);
        put(hair, slot, 0, 2.15, 0, 0.58, 0.62, 0.58, 0); put(legL, slot, -0.20, 0.52, 0, 0.28 * 0.9, 0.92, 0.28 * 0.9, swing);
        put(legR, slot, 0.20, 0.52, 0, 0.28 * 0.9, 0.92, 0.28 * 0.9, -swing); put(armL, slot, -0.55 * 0.9, 1.40, 0, 0.24 * 0.83, 0.78, 0.24 * 0.83, armLX);
        put(armR, slot, 0.55 * 0.9, 1.40, 0, 0.24 * 0.83, 0.78, 0.24 * 0.83, armRX);
      } else {
        put(torso, slot, 0, 1.42, 0, 0.82, 0.88, 0.44, 0); put(head, slot, 0, 2.18, 0, 0.54, 0.54, 0.54, 0);
        put(hair, slot, 0, 2.50, 0, 0.58, 0.14, 0.58, 0); put(legL, slot, -0.20, 0.52, 0, 0.28, 0.92, 0.28, swing);
        put(legR, slot, 0.20, 0.52, 0, 0.28, 0.92, 0.28, -swing); put(armL, slot, -0.55, 1.40, 0, 0.24, 0.78, 0.24, armLX);
        put(armR, slot, 0.55, 1.40, 0, 0.24, 0.78, 0.24, armRX);
      }
      // FACE — two eyes + a mouth on the front of the head (z+ = forward)
      put(eyeL, slot, -0.12, 2.235, 0.25, 0.11, 0.14, 0.12, 0);
      put(eyeR, slot, 0.12, 2.235, 0.25, 0.11, 0.14, 0.12, 0);
      put(mouth, slot, 0, 2.045, 0.255, 0.22, 0.055, 0.10, 0);
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
    const density = densityMode();
    if (force || overview !== lastOverview || density !== lastDensity || CBZ.lastABTest !== CBZ.AB_TEST) {
      overviewPoints.visible = false;
      overviewBoxes.visible = false;
      densityPoints.visible = false;
      for (let i = 0; i < meshes.length; i++) { meshes[i].visible = false; meshes[i].count = 0; }
      lastOverview = overview;
      lastDensity = density;
      CBZ.lastABTest = CBZ.AB_TEST;
    }
    let realActors = 0;
    for (let i = 0; i < facePool.length; i++) if (facePool[i].id >= 0 && !facePool[i].actor.dead) realActors++;
    CBZ.crowdStats = {
      total: TOTAL, rigs: realActors, rigCapacity: STANDARD_ACTOR_CAP,
      visible: realActors, active: activeCount, drawCalls: realActors,
      mode: "standard-actors", proxyVisible: false, realActors: realActors,
      shared: S.shared, abMode: CBZ.AB_TEST,
    };
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

  // ============================================================
  // NPC_SCHEDULES — the jail's DAILY REGIME (owner: "mobs of npcs especially
  // in jail doing nothing… at night they should almost all be in bed").
  // Simple math only: the hour comes off the canonical sun (S.jailHour), the
  // regime is a 6-slot table (S.jailAct), and every agent's part in it is a
  // pure hash of its id — no pathfinding. The compact typed activity fields
  // in ambientstate.js let a post mean stand/talk/work instead of "arrive,
  // immediately pick another random destination".
  //   07-09 yard laps   09-12 stand-circles   12-13 chow line
  //   13-18 mixed (circles / wall posts / wander)   18-21 wind-down
  //   21-07 LOCKDOWN — ~85% march to the cells (parked, staggered), the
  //   night-owl slice stays out. Dawn marches them back. Headcount unchanged.
  // ============================================================
  let _jailAct = 3, _schedAcc = 9, _lockOn = false, _lockStart = -1e9;
  const LOCK_FRAC = 0.85;          // share of the crowd that beds down at night
  const MARCH_WIN = 18;            // sim-seconds over which the march staggers
  function schedOn() { return !!(CBZ.CONFIG && CBZ.CONFIG.NPC_SCHEDULES); }
  // may a body (dis)appear at (x,z) right now? Rejects close-and-on-camera
  // and anything inside peripheral range — mirrors city/crowd.js placeSafe.
  function seatSafe(x, z) {
    if (!CBZ.CONFIG || !CBZ.CONFIG.NPC_SPAWN_HIDE) return true;
    const P = CBZ.player; if (!P) return true;
    const rx = x - P.pos.x, rz = z - P.pos.z, d2 = rx * rx + rz * rz;
    if (d2 < 12 * 12) return false;              // too close even off-camera
    if (d2 >= 45 * 45) return true;
    const yaw = (CBZ.cam ? CBZ.cam.yaw : 0), rd = Math.sqrt(d2) || 1;
    return ((rx / rd) * -Math.sin(yaw) + (rz / rd) * -Math.cos(yaw)) < 0.35;
  }
  // this hour's goal for one agent. Returns 0 = no proposal (wander),
  // 1 = far waypoint (lap corner), 2 = HELD post (queue/circle/wall).
  function jailGoal(id, out) {
    if (!schedOn()) return 0;
    const act = _jailAct, zn = S.zones[S.zone[id]];
    out.activity = ACT.WALK;
    out.heading = S.heading[id];
    if (act === 0) {               // morning laps: corner-to-corner circuits
      const k = ((S.idHash(id, 0x2C0) * 4) | 0) + ((simTime / 30) | 0) & 3;
      out.x = (k === 1 || k === 2) ? zn.x1 - 3 : zn.x0 + 3;
      out.z = k >= 2 ? zn.z1 - 3 : zn.z0 + 3;
      return 1;
    }
    if (act === 2 && S.zone[id] === 0 && (id & 3) === 0) {
      // CHOW LINE: two columns along the mess hall's east wall (room is
      // x[-29,-19] z[6,22]; the line forms OUTSIDE it at x≈-18, clear of the
      // walls — the mass sim has no collider pass, so posts stay in the open).
      const k = (id >> 2) % 26;
      out.x = -18.1 + (k >= 13 ? 0.9 : 0);
      out.z = 6.8 + (k % 13) * 1.6;
      out.activity = ACT.ACTION;             // eat / lean over a tray in place
      out.heading = Math.PI / 2;
      return 2;
    }
    if (act === 1 || act === 3 || act === 4) {
      const r = S.idHash(id, 0x2C4);
      const socialCut = act === 4 ? 0.35 : 0.45;
      const postCut = act === 4 ? 0.64 : 0.70;
      const actionCut = act === 4 ? 0.82 : 0.84;
      if (r < socialCut) {          // stand-circles: knots of small talk
        const grp = (id % 10) + S.zone[id] * 16;
        const cx = zn.x0 + 4 + S.idHash(grp, 0x2C1) * (zn.x1 - zn.x0 - 8);
        const cz = zn.z0 + 4 + S.idHash(grp, 0x2C2) * (zn.z1 - zn.z0 - 8);
        const a = S.idHash(id, 0x2C3) * Math.PI * 2;
        out.x = cx + Math.cos(a) * 1.6; out.z = cz + Math.sin(a) * 1.6;
        out.activity = ACT.SOCIAL;
        out.heading = Math.atan2(cx - out.x, cz - out.z); // face the conversation
        return 2;
      }
      if (r < postCut) {            // posted up along the west wall
        const rows = Math.max(4, ((zn.z1 - zn.z0 - 4) / 1.5) | 0);
        out.x = zn.x0 + 0.9;
        out.z = zn.z0 + 2 + (id % rows) * 1.5;
        out.activity = ACT.STAND;
        out.heading = Math.PI / 2;  // look into the yard, not through the wall
        return 2;
      }
      if (r < actionCut) {          // pushups / stretching / tending a work spot
        const col = id % 5, row = ((id / 5) | 0) % 4;
        out.x = zn.x0 + 5 + col * Math.max(2.2, (zn.x1 - zn.x0 - 10) / 5);
        out.z = zn.z0 + 5 + row * Math.max(2.4, (zn.z1 - zn.z0 - 10) / 4);
        out.activity = ACT.ACTION;
        out.heading = (id & 1) ? 0 : Math.PI;
        return 2;
      }
      return 0;                    // the rest wander — yard texture
    }
    return 0;                      // wind-down / lockdown leftovers: wander
  }
  // ~2Hz: advance the regime + run the staggered lockdown march in/out.
  function jailRegimeTick() {
    _jailAct = S.jailAct(S.jailHour());
    const lock = _jailAct === 5;
    if (lock !== _lockOn) { _lockOn = lock; _lockStart = simTime; }
    for (let id = 0; id < TOTAL; id++) {
      if (S.dead[id]) continue;
      const delay = S.idHash(id, 0x1A11) * MARCH_WIN;
      if (lock) {
        if (S.parked[id]) continue;
        if (S.idHash(id, 0x1A12) >= LOCK_FRAC) continue;   // night owls stay out
        if (simTime - _lockStart < delay) continue;        // staggered lights-out
        if (rigOf[id] >= 0) continue;                      // a real face-rig never blinks out
        if (S.downT[id] > 0) continue;                     // KO'd bodies stay where they fell
        if (!seatSafe(S.posX[id], S.posZ[id])) continue;   // never vanish on camera
        S.park(id);
      } else if (S.parked[id]) {
        if (simTime - _lockStart < delay) continue;        // staggered march-out
        S.randomPoint(id, S.zone[id], tempPoint);
        if (!seatSafe(tempPoint.x, tempPoint.z)) continue; // seat in view → retry next tick
        S.unpark(id, simTime, tempPoint.x, tempPoint.z);
      }
    }
  }

  // Browser-test/read-only instrumentation for the exact failure this regime
  // fixes. Consumers can verify that the active jail contains held posts,
  // conversations, activities and bounded fights instead of inferring life
  // from a screenshot or merely counting bodies.
  CBZ.jailCrowdActivityStats = function () {
    const out = { walk: 0, stand: 0, socialize: 0, action: 0, fight: 0, flee: 0, parked: 0, down: 0, active: activeCount, regime: _jailAct };
    for (let id = 0; id < TOTAL; id++) {
      if (S.dead[id]) continue;
      if (S.parked[id]) { out.parked++; continue; }
      if (S.downT[id] > 0) out.down++;
      const a = S.activity[id] || ACT.WALK;
      if (a === ACT.STAND) out.stand++;
      else if (a === ACT.SOCIAL) out.socialize++;
      else if (a === ACT.ACTION) out.action++;
      else if (a === ACT.FIGHT) out.fight++;
      else if (a === ACT.FLEE) out.flee++;
      else out.walk++;
    }
    return out;
  };
  CBZ.jailCrowdStartScuffle = function () { return startScuffle(); };
  CBZ.jailCrowdRenderMode = function () {
    let realActors = 0;
    for (let i = 0; i < facePool.length; i++) if (facePool[i].id >= 0 && !facePool[i].actor.dead) realActors++;
    return { mode: "standard-actors", active: activeCount, realActors: realActors, proxyVisible: false };
  };

  function step(dt) {
    const escape = CBZ.game.mode === "escape"; root.visible = escape;
    if (!escape) { if (facePool.length) freeAllRigs(); return; }
    const playing = CBZ.game.state === "playing";
    if (playing) {
      const t0 = performance.now();
      simTime += dt * ((CBZ.simView && CBZ.simView.active) ? Math.min(16, societyStats.timeScale || 1) : 1);
      S.clock = simTime;
      // the jail's daily regime — cheap (140 hash compares, 2Hz), runs even in
      // overview so the sped-up sim shows the lockdown/march like everything else
      if (schedOn()) { _schedAcc += dt; if (_schedAcc >= 0.5) { _schedAcc = 0; jailRegimeTick(); } }
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
    pointsAcc += dt; renderAcc += dt;
    const every = CBZ.qualityLevel != null && CBZ.qualityLevel < 2 ? 1 / 30 : 1 / 60;
    if (renderAcc >= every) { renderAcc %= every; renderRigs(fixedAcc / FIXED); }
    // Standard actors follow the simulation in every camera mode; overview no
    // longer swaps them for point-cloud or box people.
    syncFaceRigs(fixedAcc / FIXED, dt);
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
  // onUpdate does not run while paused, and the mode branch above returns
  // before touching the worker outside jail. Keep the background society
  // explicitly tied to live jail play so it cannot consume CPU in city/title
  // screens or accumulate a giant wall-clock catch-up across a pause.
  CBZ.onAlways(23.5, function () {
    const shouldRun = CBZ.game.mode === "escape" && CBZ.game.state === "playing";
    if (societyWorker && societyRunning !== shouldRun) {
      societyRunning = shouldRun;
      societyWorker.postMessage({ type: "running", value: shouldRun });
    }
  });
  CBZ.onUpdate(23.5, step);
})();
