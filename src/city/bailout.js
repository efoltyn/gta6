/* ============================================================
   city/bailout.js — STEPPING OUT OF A FLYING AIRCRAFT.

   THE BUG THIS EXISTS TO KILL
   ---------------------------
   playeraircraft.js's exitAircraft() was written for a parked machine. It
   zeroes attitude and velocity, forces `onGround`, drops the gear and stands
   you on the floor beside the plane. Run that at 500m and the abandoned jet
   silently teleports flat and lands itself while you appear on the tarmac
   underneath. The owner's ask — "the plane should actually lose its pilot and
   fall dramatically unless a pilot takes over" — is really two halves, and
   this file owns both: the falling body, and the pilotless machine.

   HOW A PILOTLESS AIRCRAFT BEHAVES, AND WHY
   -----------------------------------------
   Not a vertical drop. A real departure from controlled flight has a SHAPE,
   and it comes from the aircraft being out of trim with nobody correcting:
   any tiny bank grows because the lift vector tilts, which drops the nose,
   which builds speed, which increases lift on the raised wing — the classic
   graveyard spiral. So the model here is: seed a small roll from whatever
   attitude you left it in, let bank feed pitch-down, let pitch-down feed
   speed, let speed feed bank. It tightens on its own. Nobody scripted the
   curve; it falls out of the feedback loop, which is why it looks different
   every time depending on how you left the aeroplane.

   Helicopters get their own answer, because they have one: no collective
   means no rotor thrust, so they descend fast with a torque-driven yaw spin
   rather than a spiral.

   "UNLESS A PILOT TAKES OVER"
   ---------------------------
   Good world logic, and this repo already flies NPC aircraft (aircraft.js
   carries a `craft.pilot`). A machine with somebody else aboard — an airliner
   with a cockpit crew, anything carrying a `pilot`/`copilot` — recovers,
   levels out and flies on about its business. A single-seat fighter you just
   stepped out of does not. That distinction is read from the aircraft rather
   than hand-assigned per airframe.

   THE PARACHUTE
   -------------
   Genuinely new — grep confirms this repo has never had one. Freefall until
   you pull, then a canopy that actually slows and steers you. Pull too late
   and you meet the ground at freefall speed, where the existing fall-damage
   ladder in systems/physics.js is waiting; this file adds no second damage
   path. Every aircraft carries one, per the ask.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};

  if (CBZ.CONFIG.BAILOUT == null) CBZ.CONFIG.BAILOUT = true;
  if (CBZ.CONFIG.BAILOUT_CHUTE == null) CBZ.CONFIG.BAILOUT_CHUTE = true;
  // A machine with someone else aboard recovers instead of falling.
  if (CBZ.CONFIG.BAILOUT_TAKEOVER == null) CBZ.CONFIG.BAILOUT_TAKEOVER = true;
  // Height above the surface below which stepping out is an ordinary exit
  // rather than a bailout — you are landing/taxiing, not abandoning ship.
  if (CBZ.CONFIG.BAILOUT_MIN_AGL == null) CBZ.CONFIG.BAILOUT_MIN_AGL = 9;
  // BAILOUT_WATER_LANDING — splashing down ends the jump and hands the body to
  // the swimmer. WHY THIS HAS TO EXIST: this file never integrates P.pos.y
  // (systems/physics.js does), and over open water physics lands the body on
  // the phantom flat y=0 floor — while the landing test below asks
  // cityCraftFloorY, which over water correctly answers SEA_Y (-0.48). So the
  // condition `y <= floor + 0.05` could never come true at sea: the canopy
  // stayed open forever over a player standing on invisible water, and the
  // swimmer's own fall-catcher (swim.js order 9.9) never fired because physics
  // kept re-grounding the body. Flip false for the old (stuck) behaviour.
  if (CBZ.CONFIG.BAILOUT_WATER_LANDING == null) CBZ.CONFIG.BAILOUT_WATER_LANDING = true;
  // BAILOUT_CUTAWAY — pressing the deploy key again under canopy cuts it away
  // (back to freefall; you can pull again). The owner's literal ask — "I can't
  // close the parachute" — there was no way to end a canopy ride except
  // touching down. Flip false to remove the verb.
  if (CBZ.CONFIG.BAILOUT_CUTAWAY == null) CBZ.CONFIG.BAILOUT_CUTAWAY = true;

  const on = () => CBZ.CONFIG.BAILOUT !== false;
  const TERMINAL = -58;        // freefall terminal velocity, m/s
  const CANOPY_SINK = -5.4;    // under a good canopy
  const CANOPY_FWD = 9.5;      // canopy forward airspeed
  const OPEN_SHOCK = 0.55;     // seconds of deceleration when it blooms
  const CANOPY_HANG = 6.15;    // player root -> ram-air canopy centre

  function floorAt(x, z) {
    if (CBZ.cityCraftFloorY) { try { return CBZ.cityCraftFloorY(x, z); } catch (e) {} }
    if (CBZ.groundAt) { try { return CBZ.groundAt(x, z); } catch (e) {} }
    if (CBZ.floorAt) { try { return CBZ.floorAt(x, z); } catch (e) {} }
    return 0;
  }

  /* ================= THE FALLING BODY ================= */
  const F = {
    active: false, phase: "", t: 0, yaw: 0, canopy: null, shock: 0,
    opening: 0, flare: 0, harness: null, fpRig: null,
  };

  function cylinderBetween(parent, a, b, radius, material) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (!(len > 0.0001)) return null;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 6), material);
    setCylinderBetween(mesh, a, b);
    parent.add(mesh);
    return mesh;
  }

  function setCylinderBetween(mesh, a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (!mesh || !(len > 0.0001)) return;
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    mesh.scale.set(1, len, 1);
  }

  function makeCanopy() {
    if (!THREE) return null;
    const g = new THREE.Group();
    g.name = "bailout-ram-air-canopy";
    g.userData.bailoutCanopy = true;
    const fabric = new THREE.Group();
    fabric.name = "bailout-canopy-fabric";
    g.add(fabric);
    g._fabric = fabric;

    // A modern sport parachute is a RAM-AIR WING, not a hemispherical umbrella:
    // inflated rectangular cells, a shallow spanwise arch and a front/rear
    // chord. Thirteen overlapping cell boxes fit this game's authored block
    // language while preserving the silhouette in the reference photographs.
    const WIDTH = 7.15, CHORD = 2.45, CELLS = 13;
    const cellW = WIDTH / CELLS;
    const red = new THREE.MeshStandardMaterial({ color: 0xdf3f31, roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
    const cream = new THREE.MeshStandardMaterial({ color: 0xf4efe5, roughness: 0.76, metalness: 0, side: THREE.DoubleSide });
    const edge = new THREE.MeshStandardMaterial({ color: 0x811d24, roughness: 0.82, metalness: 0 });
    const intake = new THREE.MeshBasicMaterial({ color: 0x241d24, side: THREE.DoubleSide });
    const archAt = (x) => 0.24 + 0.92 * (1 - Math.pow((x / (WIDTH * 0.5)), 2));
    const chordAt = (x) => CHORD * (0.84 + 0.16 * (1 - Math.pow((x / (WIDTH * 0.5)), 2)));
    for (let i = 0; i < CELLS; i++) {
      const x = -WIDTH * 0.5 + cellW * (i + 0.5);
      const y = archAt(x);
      const chord = chordAt(x);
      const slope = Math.atan((-1.84 * x) / Math.pow(WIDTH * 0.5, 2));
      const cell = new THREE.Mesh(new THREE.BoxGeometry(cellW * 1.035, 0.34, chord), (i & 1) ? cream : red);
      cell.position.set(x, y, 0);
      cell.rotation.z = slope;
      cell.castShadow = true;
      cell.receiveShadow = true;
      fabric.add(cell);
      // Dark open-cell mouths make the leading edge read as an inflated wing
      // instead of a striped awning or a flat rectangle.
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(cellW * 0.78, 0.17, 0.035), intake);
      mouth.position.set(x, y - 0.025, chord * 0.5 + 0.02);
      mouth.rotation.z = slope;
      fabric.add(mouth);
      // A narrow trailing lip closes the planform when viewed from behind.
      const lip = new THREE.Mesh(new THREE.BoxGeometry(cellW * 1.03, 0.08, 0.09), edge);
      lip.position.set(x, y - 0.13, -chord * 0.5);
      lip.rotation.z = slope;
      fabric.add(lip);
    }

    // REAL LINE CASCADES. Upper lines fan from individual cells into four
    // cascade junctions; only four load-bearing risers continue to two shoulder
    // groups on the harness. No line touches the player's feet and no twelve
    // independent strings converge on one impossible point.
    const upperMat = new THREE.LineBasicMaterial({ color: 0xe8edf2, transparent: true, opacity: 0.72 });
    const riserMat = new THREE.MeshBasicMaterial({ color: 0x20262d });
    const upperPts = [];
    const upperPairs = [];
    const anchors = [];
    const cascadeNodes = [];
    const risers = [];
    for (const side of [-1, 1]) {
      for (const row of [-1, 1]) {
        const node = new THREE.Vector3(side * 0.92, -2.52, row * 0.22);
        const anchor = new THREE.Vector3(side * 0.36, -4.62, row * 0.10);
        const nodeIndex = cascadeNodes.length;
        cascadeNodes.push(node);
        anchors.push(anchor);
        for (let j = 0; j < 5; j++) {
          const x = side * (0.52 + j * 0.62);
          const chord = chordAt(x);
          const top = new THREE.Vector3(x, archAt(x) - 0.19, row * chord * 0.34);
          upperPts.push(top, node.clone());
          upperPairs.push({ top, nodeIndex });
        }
        risers.push(cylinderBetween(g, node, anchor, 0.026, riserMat));
      }
    }
    const upperLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(upperPts), upperMat);
    upperLines.name = "canopy-cascaded-suspension-lines";
    g.add(upperLines);

    g.userData.cells = CELLS;
    g.userData.upperLineCount = upperPts.length / 2;
    g.userData.riserCount = anchors.length;
    g.userData.cascadeNodes = cascadeNodes.map((point) => point.toArray());
    g.userData.harnessAnchors = anchors.map((point) => point.toArray());
    g.userData.hang = CANOPY_HANG;
    g._lineLayout = {
      upperLines, upperPairs, cascadeNodes, anchors, risers,
      openingNodes: cascadeNodes.map((point) => point.clone()),
    };
    g.position.y = CANOPY_HANG;
    setCanopyOpening(g, 1);
    return g;
  }

  function setCanopyOpening(canopy, value) {
    if (!canopy) return;
    const o = Math.max(0, Math.min(1, value == null ? 1 : value));
    const sx = 0.34 + o * 0.66;
    const sy = 0.18 + o * 0.82;
    const sz = 0.58 + o * 0.42;
    const lift = -1.1 * (1 - o);
    if (canopy._fabric) {
      canopy._fabric.scale.set(sx, sy, sz);
      canopy._fabric.position.y = lift;
    }
    const layout = canopy._lineLayout;
    if (layout && layout.upperLines && layout.upperLines.geometry) {
      for (let i = 0; i < layout.cascadeNodes.length; i++) {
        const full = layout.cascadeNodes[i];
        const tucked = layout.openingNodes[i];
        tucked.set(
          (full.x < 0 ? -0.46 : 0.46) + (full.x - (full.x < 0 ? -0.46 : 0.46)) * o,
          -3.08 + (full.y + 3.08) * o,
          (full.z < 0 ? -0.10 : 0.10) + (full.z - (full.z < 0 ? -0.10 : 0.10)) * o
        );
      }
      const positions = layout.upperLines.geometry.attributes.position;
      for (let i = 0; i < layout.upperPairs.length; i++) {
        const pair = layout.upperPairs[i];
        const top = pair.top;
        const node = layout.openingNodes[pair.nodeIndex];
        positions.setXYZ(i * 2, top.x * sx, top.y * sy + lift, top.z * sz);
        positions.setXYZ(i * 2 + 1, node.x, node.y, node.z);
      }
      positions.needsUpdate = true;
      layout.upperLines.geometry.computeBoundingSphere();
      for (let i = 0; i < layout.risers.length; i++) {
        setCylinderBetween(layout.risers[i], layout.openingNodes[i], layout.anchors[i]);
      }
    }
    canopy.userData.opening = o;
  }

  // The harness is part of the PLAYER, not part of the canopy. It moves with
  // the torso in freefall and remains visible after a cutaway; the pack,
  // shoulder webbing, chest strap, hip belt and thigh loops make the load path
  // physically readable before the first suspension line begins.
  function ensureHarness(ch) {
    if (!THREE || !ch || !ch.body || !ch.parts) return null;
    if (ch._bailoutHarness) return ch._bailoutHarness;
    const web = new THREE.MeshStandardMaterial({ color: 0x202832, roughness: 0.92, metalness: 0.02 });
    const packMat = new THREE.MeshStandardMaterial({ color: 0x3c4653, roughness: 0.88, metalness: 0.01 });
    const reserveMat = new THREE.MeshStandardMaterial({ color: 0x9f2e2b, roughness: 0.84, metalness: 0 });
    const root = new THREE.Group();
    root.name = "bailout-harness";
    root.userData.bailoutHarness = true;
    function box(parent, w, h, d, material, x, y, z) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh;
    }
    box(root, 0.72, 0.78, 0.30, packMat, 0, 1.43, -0.40);       // main container
    box(root, 0.54, 0.24, 0.34, reserveMat, 0, 1.77, -0.39);    // reserve flap
    box(root, 0.10, 0.92, 0.07, web, 0.27, 1.43, 0.30);         // shoulder straps
    box(root, 0.10, 0.92, 0.07, web, -0.27, 1.43, 0.30);
    box(root, 0.66, 0.09, 0.07, web, 0, 1.37, 0.32);            // chest strap
    box(root, 0.84, 0.11, 0.08, web, 0, 0.99, 0.28);           // hip belt
    box(root, 0.09, 0.50, 0.09, web, 0.34, 1.83, 0.02);        // riser tabs
    box(root, 0.09, 0.50, 0.09, web, -0.34, 1.83, 0.02);
    ch.body.add(root);
    const extra = [];
    for (const leg of [ch.parts.ll, ch.parts.rl]) {
      if (!leg) continue;
      const loop = box(leg, 0.40, 0.10, 0.42, web, 0, -0.18, 0);
      extra.push(loop);
    }
    ch._bailoutHarness = { root, extra };
    return ch._bailoutHarness;
  }

  function setHarnessVisible(ch, visible) {
    const h = ch && ch._bailoutHarness;
    if (!h) return;
    h.root.visible = !!visible;
    for (const part of h.extra || []) part.visible = !!visible;
  }

  // First person needs its own near-camera read because city/view.js correctly
  // hides the world body to prevent face clipping. These are not second physics
  // arms: a small camera-child viewmodel mirrors the same phase record as the
  // full character pose—simple block hands in the wind, then both hands on two risers.
  function makeFirstPersonRig() {
    if (!THREE) return null;
    const rig = new THREE.Group();
    rig.name = "bailout-first-person-rig";
    rig.userData.bailoutFirstPerson = true;
    rig.position.z = -0.42; // keep the hands readable without filling the lens
    const skin = new THREE.MeshBasicMaterial({ color: 0xe7ae83, depthTest: false, depthWrite: false });
    const sleeve = new THREE.MeshBasicMaterial({ color: 0x2d79ad, depthTest: false, depthWrite: false });
    const web = new THREE.MeshBasicMaterial({ color: 0x1e2731, depthTest: false, depthWrite: false });
    const line = new THREE.LineBasicMaterial({ color: 0xe9edf1, transparent: true, opacity: 0.86, depthTest: false, depthWrite: false });
    const brakeLine = new THREE.LineBasicMaterial({ color: 0xe84b3d, transparent: true, opacity: 0.94, depthTest: false, depthWrite: false });
    const toggleMat = new THREE.MeshBasicMaterial({ color: 0xd94134, depthTest: false, depthWrite: false });
    function box(parent, w, h, d, material, x, y, z) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z); parent.add(mesh); return mesh;
    }
    function hand() {
      const h = new THREE.Group();
      box(h, 0.15, 0.13, 0.38, sleeve, 0, 0, 0.16);       // forearm recedes toward lens
      // Match character.js: hands are one simple cap, never articulated digits.
      box(h, 0.20, 0.10, 0.22, skin, 0, 0, -0.15);
      const toggle = new THREE.Mesh(new THREE.TorusGeometry(0.057, 0.014, 5, 12), toggleMat);
      toggle.position.set(0, 0.03, -0.22);
      toggle.visible = false;
      h.add(toggle);
      h.userData.toggle = toggle;
      rig.add(h);
      return h;
    }
    const left = hand(), right = hand();
    const risers = new THREE.Group();
    const linePts = [];
    for (const side of [-1, 1]) {
      const lower = new THREE.Vector3(side * 0.34, -0.03, -0.82);
      const splitA = new THREE.Vector3(side * 0.52, 0.38, -1.02);
      const splitB = new THREE.Vector3(side * 0.78, 0.92, -1.32);
      cylinderBetween(risers, lower, splitA, 0.022, web);
      linePts.push(splitA.clone(), splitB.clone());
      linePts.push(splitA.clone().add(new THREE.Vector3(side * 0.035, 0, 0.03)), splitB.clone().add(new THREE.Vector3(side * 0.13, 0.02, -0.03)));
    }
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePts), line);
    risers.add(lines);
    risers.visible = false;
    rig.add(risers);
    const brakeLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(), new THREE.Vector3(),
        new THREE.Vector3(), new THREE.Vector3(),
      ]),
      brakeLine
    );
    brakeLines.visible = false;
    rig.add(brakeLines);
    rig._bailoutParts = { left, right, risers, brakeLines };
    rig.traverse(function (o) { o.renderOrder = 1200; o.frustumCulled = false; });
    rig.visible = false;
    return rig;
  }

  function poseFirstPersonRig(rig, state) {
    if (!rig || !rig._bailoutParts) return false;
    state = state || {};
    const canopy = state.phase === "canopy" || state.phase === "opening";
    const flare = canopy ? Math.max(0, Math.min(1, state.flare || 0)) : 0;
    const t = +state.t || 0;
    const w = Math.sin(t * 2.2) * 0.018;
    const p = rig._bailoutParts;
    if (!canopy) {
      p.left.position.set(-0.56, -0.29 + w, -0.82);
      p.right.position.set(0.56, -0.29 - w, -0.82);
      p.left.rotation.set(0.16, 0.20, -0.12);
      p.right.rotation.set(0.16, -0.20, 0.12);
      p.risers.visible = false;
      p.brakeLines.visible = false;
      p.left.userData.toggle.visible = p.right.userData.toggle.visible = false;
    } else {
      const down = flare * 0.34;
      p.left.position.set(-0.46, -0.04 - down + w, -0.86);
      p.right.position.set(0.46, -0.04 - down - w, -0.86);
      p.left.rotation.set(-0.10 + flare * 0.28, 0.08, -0.05);
      p.right.rotation.set(-0.10 + flare * 0.28, -0.08, 0.05);
      p.risers.visible = true;
      p.brakeLines.visible = true;
      p.left.userData.toggle.visible = p.right.userData.toggle.visible = true;
      const brakePositions = p.brakeLines.geometry.attributes.position;
      const togglePoint = new THREE.Vector3(0, 0.03, -0.22);
      const leftToggle = togglePoint.clone().applyEuler(p.left.rotation).add(p.left.position);
      const rightToggle = togglePoint.clone().applyEuler(p.right.rotation).add(p.right.position);
      brakePositions.setXYZ(0, leftToggle.x, leftToggle.y, leftToggle.z);
      brakePositions.setXYZ(1, -0.78, 0.92, -1.32);
      brakePositions.setXYZ(2, rightToggle.x, rightToggle.y, rightToggle.z);
      brakePositions.setXYZ(3, 0.78, 0.92, -1.32);
      brakePositions.needsUpdate = true;
      p.brakeLines.geometry.computeBoundingSphere();
    }
    return true;
  }

  function ensureFirstPersonRig() {
    if (!F.fpRig) {
      F.fpRig = makeFirstPersonRig();
      if (F.fpRig && CBZ.camera) CBZ.camera.add(F.fpRig);
    }
    return F.fpRig;
  }

  // Public builders are the same functions used by runtime. The visual loop
  // and focused contracts therefore inspect the shipped geometry/poses instead
  // of maintaining a lookalike test rig.
  CBZ.cityBuildChuteCanopy = makeCanopy;
  CBZ.citySetChuteOpening = setCanopyOpening;
  CBZ.cityEnsureBailoutHarness = ensureHarness;
  CBZ.cityBuildBailoutFirstPerson = makeFirstPersonRig;
  CBZ.cityPoseBailoutFirstPerson = poseFirstPersonRig;


  function beginFall(fromCraft) {
    const P = CBZ.player; if (!P) return;
    F.active = true; F.phase = "freefall"; F.t = 0; F.shock = 0; F.rearm = false;
    F.opening = 0; F.flare = 0;
    F.yaw = fromCraft ? (fromCraft.heading || 0) : 0;
    P.grounded = false;
    // Inherit the aircraft's momentum — you do not stop dead in the air.
    if (fromCraft) {
      P.vy = Math.min(0, (fromCraft.vy || 0) * 0.5);
      F.driftX = (fromCraft.vx || 0) * 0.55;
      F.driftZ = (fromCraft.vz || 0) * 0.55;
    } else { P.vy = 0; F.driftX = F.driftZ = 0; }
    if (CBZ.playerChar && CBZ.playerChar.group) {
      const ch = CBZ.playerChar;
      ch.group.visible = true;
      ch.group.rotation.x = 0; ch.group.rotation.z = 0;
      ch.skydiving = { phase: "freefall", t: 0, opening: 0, flare: 0, bailout: true };
      F.harness = ensureHarness(ch);
      setHarnessVisible(ch, true);
    }
    ensureFirstPersonRig();
    if (CBZ.city && CBZ.city.note) {
      CBZ.city.note("Freefall. Pull to deploy.", 2.6, { from: "Rig", app: "messages" });
    }
    if (CBZ.sfx) { try { CBZ.sfx("wind"); } catch (e) {} }
  }

  function deploy() {
    if (!F.active || F.phase !== "freefall") return false;
    if (CBZ.CONFIG.BAILOUT_CHUTE === false) return false;
    F.phase = "canopy"; F.shock = OPEN_SHOCK; F.opening = 0.02; F.flare = 0;
    if (!F.canopy && CBZ.scene) { F.canopy = makeCanopy(); if (F.canopy) CBZ.scene.add(F.canopy); }
    if (F.canopy) {
      F.canopy.visible = true;
      F.canopy.scale.set(1, 1, 1);
      setCanopyOpening(F.canopy, F.opening);
    }
    if (CBZ.playerChar) CBZ.playerChar.skydiving = {
      phase: "opening", t: F.t, opening: F.opening, flare: 0, bailout: true,
    };
    if (CBZ.sfx) { try { CBZ.sfx("cloth"); } catch (e) {} }
    return true;
  }
  CBZ.cityChuteDeploy = deploy;

  // CUT AWAY — the canopy releases and you are back in freefall (pull again if
  // you like; the rearm latch below stops one held key from cut-then-redeploying
  // in consecutive frames). The keyboard edge lives on a real keydown, exactly
  // like swim.js's climb press, because the deploy poll below reads LEVELS and
  // a level cannot distinguish "still holding the pull" from "pressed again".
  function cutAway() {
    if (!F.active || F.phase !== "canopy") return false;
    if (CBZ.CONFIG.BAILOUT_CUTAWAY === false) return false;
    F.phase = "freefall"; F.shock = 0; F.opening = 0; F.flare = 0;
    F.rearm = true;                     // deploy key must be RELEASED before it pulls again
    if (F.canopy) F.canopy.visible = false;
    if (CBZ.playerChar) CBZ.playerChar.skydiving = {
      phase: "freefall", t: F.t, opening: 0, flare: 0, bailout: true,
    };
    if (CBZ.sfx) { try { CBZ.sfx("cloth"); } catch (e) {} }
    return true;
  }
  CBZ.cityChuteCut = cutAway;
  if (typeof addEventListener === "function") {
    addEventListener("keydown", function (e) {
      if (!e || (e.key !== " " && e.key !== "f" && e.key !== "F")) return;
      if (F.active && F.phase === "canopy") cutAway();
    });
  }

  CBZ.cityChuteState = function () {
    return F.active ? {
      phase: F.phase, agl: aglNow(), opening: F.opening, flare: F.flare,
    } : null;
  };

  function aglNow() {
    const P = CBZ.player; if (!P) return 0;
    return Math.max(0, P.pos.y - floorAt(P.pos.x, P.pos.z));
  }

  function endFall(landed) {
    F.active = false; F.phase = "";
    F.opening = 0; F.flare = 0;
    if (F.canopy) F.canopy.visible = false;
    if (F.fpRig) F.fpRig.visible = false;
    if (CBZ.playerChar) {
      if (CBZ.playerChar.skydiving && CBZ.playerChar.skydiving.bailout) CBZ.playerChar.skydiving = null;
      setHarnessVisible(CBZ.playerChar, false);
    }
    const P = CBZ.player;
    if (landed && P) { P.grounded = true; P.vy = 0; }
  }

  /* ================= THE PILOTLESS MACHINE ================= */
  const ghosts = [];

  function crewAboard(craft) {
    if (CBZ.CONFIG.BAILOUT_TAKEOVER === false) return false;
    if (!craft) return false;
    if (craft.pilot || craft.copilot) return true;
    const ud = craft.group && craft.group.userData;
    // An airliner has a modelled cabin and flight deck — somebody is up front.
    if (ud && (ud.cabin || ud.cockpit)) return true;
    if (craft.airClass === "airliner") return true;
    return false;
  }

  function abandon(craft) {
    if (!craft) return;
    const recovered = crewAboard(craft);
    ghosts.push({
      craft: craft,
      recovered: recovered,
      t: 0,
      roll: (craft.roll || 0) || 0.05,   // whatever bank you left it in, or a nudge
      pitch: craft.pitch || 0,
      spin: 0,
      heli: craft.kind === "heli" || craft.airClass === "heli",
    });
    if (recovered && CBZ.city && CBZ.city.note) {
      CBZ.city.note("Someone else has the controls.", 3, { from: "Radio", app: "messages" });
    }
  }

  function tickGhost(G, dt) {
    const c = G.craft;
    if (!c || !c.group) return false;
    G.t += dt;
    const gy = floorAt(c.pos.x, c.pos.z);

    if (G.recovered) {
      // Levels out over a couple of seconds and flies on. It is somebody
      // else's aeroplane now; the ordinary traffic systems can keep it.
      G.roll += (0 - G.roll) * Math.min(1, dt * 1.6);
      G.pitch += (0.04 - G.pitch) * Math.min(1, dt * 1.4);
      const sp = Math.max(28, c.speed || 40);
      c.pos.x += Math.sin(c.heading) * sp * dt;
      c.pos.z += Math.cos(c.heading) * sp * dt;
      c.pos.y += Math.sin(G.pitch) * sp * dt;
      applyPose(c, G);
      return G.t < 40;            // hand it back to the world after a while
    }

    if (G.heli) {
      // No collective: it sinks, and engine torque with no tail authority
      // walks the nose round.
      G.spin += dt * 1.5;
      c.heading += G.spin * dt;
      c.vy = (c.vy || 0) - 9.4 * dt * 0.75;
      c.pos.y += c.vy * dt;
      G.roll += (Math.sin(G.t * 2.2) * 0.28 - G.roll) * dt * 2;
      G.pitch = -0.18;
    } else {
      // THE SPIRAL. Bank tilts the lift vector, so the nose drops; the nose
      // dropping builds speed; speed deepens the bank. Each term feeds the
      // next, so it tightens by itself rather than on a script.
      G.roll += Math.sign(G.roll || 1) * dt * (0.34 + Math.abs(G.roll) * 0.55);
      G.roll = Math.max(-1.5, Math.min(1.5, G.roll));
      G.pitch -= Math.abs(G.roll) * dt * 0.55;
      G.pitch = Math.max(-1.15, G.pitch);
      c.speed = Math.min(140, (c.speed || 40) + (-G.pitch) * 26 * dt);
      c.heading += G.roll * dt * 0.85;                       // bank turns it
      const fwd = Math.cos(G.pitch) * c.speed;
      c.pos.x += Math.sin(c.heading) * fwd * dt;
      c.pos.z += Math.cos(c.heading) * fwd * dt;
      c.pos.y += Math.sin(G.pitch) * c.speed * dt;
    }
    applyPose(c, G);

    if (c.pos.y - (c.belly || 1.2) <= gy + 0.4) {
      impact(c, gy);
      return false;
    }
    return G.t < 90;
  }

  function applyPose(c, G) {
    c.roll = G.roll; c.pitch = G.pitch;
    if (CBZ.citySetCraftRotation) {
      try { CBZ.citySetCraftRotation(c, G.pitch, c.heading, G.roll); } catch (e) {}
    }
    if (c.group) c.group.position.set(c.pos.x, c.pos.y, c.pos.z);
  }

  /* The wreck is priced through the shared ordnance bus so it damages
     buildings, starts fires and kills exactly like any other impact of that
     mass and speed. No second blast path — CLAUDE.md forbids hand-rolling
     one, and the bus already models kinetic energy from mass and speed. */
  function impact(c, gy) {
    const speed = Math.max(20, c.speed || 40);
    const mass = (c.mass || (c.airClass === "airliner" ? 72000 : c.kind === "heli" ? 5200 : 12000));
    if (CBZ.detonate) {
      try {
        // "aircraft-impact" was never a bus row — it degraded to the unknown-kind
        // firecracker (power 1, radius 6) for this path's whole life; and
        // `frontal` is METRES of sever, so `true` coerced to a 1 m nick. Route
        // by the craft's real class and let the kinetic law price mass×speed².
        CBZ.detonate(c.pos.x, Math.max(gy, c.pos.y), c.pos.z,
                     c.airClass === "airliner" ? "crashAirliner" : c.kind === "heli" ? "crashSmall" : "crashJet",
                     { mass: mass, speed: speed, byPlayer: true, frontal: 3 });
      } catch (e) {}
    } else if (CBZ.cityAirstrikeExplosion) {
      try { CBZ.cityAirstrikeExplosion(c.pos.x, c.pos.z, { power: 3.0, radius: 16, y: c.pos.y, byPlayer: true }); } catch (e) {}
    }
    if (c.group && c.group.parent) c.group.parent.remove(c.group);
    c.dead = true;
  }

  /* PUBLIC: playeraircraft.js hands the machine over here when you step out of
     it in flight. Returns true when this file has taken ownership. */
  CBZ.cityBailOut = function (craft) {
    if (!on() || !craft || !craft.pos) return false;
    const gy = floorAt(craft.pos.x, craft.pos.z);
    const agl = craft.pos.y - gy;
    if (!(agl > CBZ.CONFIG.BAILOUT_MIN_AGL)) return false;   // parked/landing: normal exit
    if (craft.onGround) return false;
    abandon(craft);
    beginFall(craft);
    return true;
  };

  /* ================= TICK ================= */
  CBZ.onUpdate(CBZ.PRIO && CBZ.PRIO.after ? CBZ.PRIO.after(CBZ.PRIO.VEHICLES, 7) : 17.7, function (dt) {
    if (!dt) return;
    for (let i = ghosts.length - 1; i >= 0; i--) {
      let keep = false;
      try { keep = tickGhost(ghosts[i], dt); } catch (e) { keep = false; }
      if (!keep) ghosts.splice(i, 1);
    }
    const P = CBZ.player;
    const ch = CBZ.playerChar;
    if (!F.active) {
      // A long ordinary fall gets the same stable belly pose and first-person
      // hands, but never a parachute pack. Small jumps remain ordinary jumps.
      const generic = !!(P && !P.dead && !P.driving && !P._swim && !P._mountedAnimal &&
        CBZ.game && CBZ.game.state === "playing" && !P.grounded && (P.vy || 0) < -8 &&
        (P._fallPeak || 0) > 8);
      if (ch) {
        if (generic) ch.skydiving = {
          phase: "freefall", t: (ch.skydiving && ch.skydiving.generic ? ch.skydiving.t : 0) + dt,
          opening: 0, flare: 0, generic: true,
        };
        else if (ch.skydiving && ch.skydiving.generic) ch.skydiving = null;
        setHarnessVisible(ch, false);
      }
      const fp = generic && CBZ.fps && CBZ.fps.active ? ensureFirstPersonRig() : F.fpRig;
      if (fp) {
        fp.visible = !!(generic && CBZ.fps && CBZ.fps.active);
        if (fp.visible) poseFirstPersonRig(fp, ch && ch.skydiving);
      }
      return;
    }

    if (!P || P.dead) { endFall(false); return; }
    F.t += dt;
    const k = CBZ.keys || {};

    if (F.phase === "freefall") {
      // after a cut-away the pull key must come UP once before it pulls again
      if (F.rearm) { if (!k[" "] && !k["f"]) F.rearm = false; }
      else if (k[" "] || k["f"]) deploy();
      F.opening = 0; F.flare = 0;
      P.vy = Math.max(TERMINAL, (P.vy || 0) - 9.81 * dt * 1.55);
      F.driftX *= (1 - dt * 0.55); F.driftZ *= (1 - dt * 0.55);
    } else if (F.phase === "canopy") {
      // Bloom: a hard but brief deceleration, then a steady sink.
      if (F.shock > 0) {
        F.shock = Math.max(0, F.shock - dt);
        P.vy += (CANOPY_SINK - P.vy) * Math.min(1, dt * 9);
      } else {
        P.vy += (CANOPY_SINK - P.vy) * Math.min(1, dt * 3.4);
      }
      const openRaw = Math.max(0, Math.min(1, 1 - F.shock / OPEN_SHOCK));
      F.opening = openRaw * openRaw * (3 - 2 * openRaw);
      // Steer: turn with A/D, and trade forward speed with W/S the way toggles
      // do — pulling both hands down flares and slows you.
      if (k["a"]) F.yaw += dt * 1.25;
      if (k["d"]) F.yaw -= dt * 1.25;
      F.flare += ((k["s"] ? 1 : 0) - F.flare) * Math.min(1, dt * 8);
      const driveMul = k["s"] ? 0.25 : (k["w"] ? 1.15 : 1);
      F.driftX = Math.sin(F.yaw) * CANOPY_FWD * driveMul;
      F.driftZ = Math.cos(F.yaw) * CANOPY_FWD * driveMul;
      if (k["s"]) P.vy += dt * 1.6;      // flaring also arrests the sink briefly

      // THE CANOPY DISCARDS THE FALL. systems/physics.js scores a landing on
      // player._fallPeak — the fastest you fell at ANY point — not on the speed
      // you actually touch down at. Freefall pins that at terminal (58 m/s), so
      // before this line a parachute could not save you: you decelerated to a
      // 5.4 m/s sink and the game still judged the landing at 58 and killed you
      // every single time, however well you flew it.
      //
      // Clamping the peak to the CURRENT sink rate is not a special case, it is
      // the physics: a canopy's entire job is to shed the energy you built up,
      // and once it is open and flying, how fast you were falling a moment ago
      // is no longer stored anywhere in your body. A late pull still hurts —
      // you are still fast when the ground arrives, so the peak is still high.
      // No second damage path; the existing ladder just gets an honest number.
      const sink = -(P.vy || 0);
      if (P._fallPeak == null || P._fallPeak > sink) P._fallPeak = Math.max(0, sink);
    }

    P.pos.x += F.driftX * dt;
    P.pos.z += F.driftZ * dt;
    P.grounded = false;

    if (F.canopy) {
      F.canopy.position.set(P.pos.x, P.pos.y + CANOPY_HANG, P.pos.z);
      F.canopy.rotation.y = F.yaw;
      F.canopy.visible = (F.phase === "canopy");
      setCanopyOpening(F.canopy, F.opening);
    }
    if (ch && ch.group) {
      ch.group.position.set(P.pos.x, P.pos.y, P.pos.z);
      ch.group.rotation.y = F.yaw;
      ch.group.rotation.x = 0; ch.group.rotation.z = 0;
      ch.skydiving = {
        phase: F.phase === "canopy" && F.opening < 0.98 ? "opening" : F.phase,
        t: F.t, opening: F.opening, flare: F.flare, bailout: true,
      };
      F.harness = ensureHarness(ch);
      setHarnessVisible(ch, true);
    }
    const fp = ensureFirstPersonRig();
    if (fp) {
      fp.visible = !!(CBZ.fps && CBZ.fps.active);
      poseFirstPersonRig(fp, ch && ch.skydiving ? ch.skydiving : {
        phase: F.phase, t: F.t, opening: F.opening, flare: F.flare,
      });
    }

    // SPLASHDOWN. Over open water the ground test below is unreachable by
    // construction: physics holds the body on the phantom y=0 floor while
    // cityCraftFloorY says the ground is the sea surface at -0.48 — so before
    // this branch existed the canopy simply never came off at sea. End the
    // jump at the live wave surface, keep the body FALLING and UN-grounded,
    // and get out of the way: swim.js's pre-physics fall-catcher (order 9.9,
    // the same path that owns a bridge dive) then claims the entry next tick —
    // splash, plunge momentum, breath, the lot. No second water-entry path.
    // The 0.12 floor on the threshold matters: in a calm trough the surface
    // sits below the phantom floor, so a body riding y=0 must still count as
    // "at the water" or it hovers there forever, which was the whole bug.
    if (CBZ.CONFIG.BAILOUT_WATER_LANDING !== false &&
        CBZ.cityWaterAt && CBZ.cityWaterAt(P.pos.x, P.pos.z)) {
      const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(P.pos.x, P.pos.z)
        : (CBZ.waterSeaY ? CBZ.waterSeaY() : -0.48);
      if (P.pos.y <= Math.max(surf + 0.45, 0.12)) {
        const sink = Math.min(P.vy || 0, -2.5);   // never arrive rising: the
        endFall(false);                           // catcher requires vy < 0
        P.grounded = false;
        P.vy = sink;
        return;
      }
    }

    // Landing. Under canopy this is a walk-away; in freefall we simply hand the
    // body back with its real vertical speed and let the EXISTING fall-damage
    // ladder in systems/physics.js decide — adding a second damage path here
    // would be exactly the duplication this codebase is trying to stop.
    const gy = floorAt(P.pos.x, P.pos.z);
    if (P.pos.y <= gy + 0.05) {
      P.pos.y = gy;
      const hard = (F.phase !== "canopy");
      endFall(true);
      if (hard && CBZ.cityHurtPlayer) {
        try { CBZ.cityHurtPlayer(9999, { cause: "fell", fatal: true }); } catch (e) {}
      } else if (CBZ.sfx) { try { CBZ.sfx("land"); } catch (e) {} }
    }
  });

  /* Touch: the deploy verb belongs to the shared touch layer, never a parallel
     handler, and never a keyboard glyph (CLAUDE.md). touch.js should call
     CBZ.cityChuteDeploy() from a pill shown while cityChuteState() is
     non-null and its phase is "freefall". */
  CBZ.cityChutePrompt = function () {
    return (F.active && F.phase === "freefall") ? "Deploy chute" : null;
  };

  CBZ.bailoutAudit = function () {
    return { ghosts: ghosts.length, falling: !!F.active, phase: F.phase || null };
  };
})();
