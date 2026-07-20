/* ============================================================
   city/snowboard.js — Mount Mercy snowboard controller.

   This is slope physics, not a downhill cutscene: gravity is projected onto
   the sampled terrain tangent, edges redirect momentum, curved snow lips
   release ground snap, and airborne motion/landings use vertical velocity.
   The terrain, renderer and this controller all read the same floor oracle.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.player || !CBZ.playerChar) return;

  const P = CBZ.player, ch = CBZ.playerChar, keys = CBZ.keys || {};
  const state = {
    mounted: false, grounded: true,
    vx: 0, vz: 0, vy: 0, dirX: 0, dirZ: 1,
    steer: 0, airT: 0, airSpin: 0, points: 0, bestAir: 0,
    spaceWas: false, lastGround: 0, justLanded: 0,
  };
  const RIDE_Y = 0.16;
  const up = new THREE.Vector3(), forward = new THREE.Vector3(), right = new THREE.Vector3();
  const basis = new THREE.Matrix4(), airEuler = new THREE.Euler(0, 0, 0, "YXZ");

  function floorAt(x, z) { return CBZ.floorAt ? (+CBZ.floorAt(x, z) || 0) : 0; }
  function normalAt(x, z, out) {
    if (CBZ.snowTerrainNormalAt && x >= -80 && x <= 780 && z >= -1790 && z <= -1110) {
      return CBZ.snowTerrainNormalAt(x, z, out);
    }
    const e = 1.5;
    const dx = floorAt(x + e, z) - floorAt(x - e, z);
    const dz = floorAt(x, z + e) - floorAt(x, z - e);
    return out.set(-dx / (2 * e), 1, -dz / (2 * e)).normalize();
  }
  function speed() { return Math.hypot(state.vx, state.vz); }
  function inSnow() {
    if (CBZ.cityBiomeAt) {
      const b = CBZ.cityBiomeAt(P.pos.x, P.pos.z);
      if (b === "snow" || (b && b.biome === "snow")) return true;
    }
    return P.pos.x >= -80 && P.pos.x <= 780 && P.pos.z >= -1790 && P.pos.z <= -1110;
  }

  // Visible board: low-poly enough to match the game, curved at both ends so
  // it reads as a snowboard rather than a rectangle attached to the shoes.
  const board = new THREE.Group();
  board.name = "player-snowboard";
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x176ca8 });
  const edgeMat = new THREE.MeshLambertMaterial({ color: 0xe8eef2 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 2.15), deckMat);
  deck.position.y = 0.03; deck.castShadow = true; board.add(deck);
  for (const z of [-1.08, 1.08]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.07, 0.34), edgeMat);
    tip.position.set(0, 0.11, z); tip.rotation.x = z > 0 ? -0.30 : 0.30;
    tip.castShadow = true; board.add(tip);
  }
  for (const z of [-0.38, 0.38]) {
    const binding = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.10, 0.18), edgeMat);
    binding.position.set(0, 0.14, z); board.add(binding);
  }
  board.position.y = 0.04;
  board.visible = false;
  ch.group.add(board);

  let hud = null, hudText = null;
  function ensureHud() {
    if (hud || !document.body) return;
    hud = document.createElement("div");
    hud.id = "snowboard-hud";
    hud.style.cssText = "position:fixed;left:50%;bottom:132px;transform:translateX(-50%);z-index:70;display:none;pointer-events:none;background:rgba(12,22,31,.76);border:1px solid rgba(190,230,255,.45);border-radius:9px;padding:8px 13px;color:#eff9ff;font:700 13px/1.35 system-ui,sans-serif;text-align:center;text-shadow:0 1px 2px #000;box-shadow:0 5px 20px rgba(0,0,0,.28)";
    hudText = document.createElement("div");
    hud.appendChild(hudText); document.body.appendChild(hud);
  }
  function note(msg, seconds) {
    if (CBZ.city && CBZ.city.note) CBZ.city.note(msg, seconds || 2.2);
    else if (CBZ.flashHint) CBZ.flashHint(msg, seconds || 2.2);
  }
  function showHud() {
    ensureHud(); if (!hud) return;
    hud.style.display = state.mounted ? "block" : "none";
    if (!state.mounted) return;
    const kph = Math.round(speed() * 3.6);
    const mode = state.grounded ? (Math.abs(state.steer) > 0.15 ? "CARVING" : "RIDING") : ("AIR " + state.airT.toFixed(1) + "s");
    hudText.innerHTML = "" + mode + " &nbsp;·&nbsp; " + kph + " km/h &nbsp;·&nbsp; " + state.points + " pts<br><span style=\"font-weight:600;color:#bfe8ff\">A/D carve · W tuck · S brake · Space ollie · X dismount</span>";
  }

  function setFacing(dx, dz) {
    const l = Math.hypot(dx, dz) || 1;
    state.dirX = dx / l; state.dirZ = dz / l;
  }
  function mount(opts) {
    opts = opts || {};
    if (P.dead || P.driving || (CBZ.game && CBZ.game.mode !== "city")) return false;
    if (opts.summit) {
      P.pos.x = CBZ.snowRunXAt ? CBZ.snowRunXAt(-1670) : 470;
      P.pos.z = -1670;
    }
    const gy = floorAt(P.pos.x, P.pos.z);
    P.pos.y = gy + RIDE_Y; P.vy = 0; P.grounded = true;
    state.mounted = true; state.grounded = true; state.vy = 0;
    state.airT = 0; state.airSpin = 0; state.spaceWas = !!keys[" "];
    setFacing(opts.dirX == null ? 0 : opts.dirX, opts.dirZ == null ? 1 : opts.dirZ);
    const launch = opts.speed == null ? 3.2 : opts.speed;
    state.vx = state.dirX * launch; state.vz = state.dirZ * launch;
    state.lastGround = gy; state.justLanded = 0;
    P._snowboard = state; P._rideScale = 0;
    board.visible = true;
    ensureHud(); showHud();
    note(opts.summit ? "Lift drop: Mount Mercy summit. Point downhill and send it." : "Snowboard strapped in.", 2.7);
    return true;
  }
  function dismount(silent) {
    if (!state.mounted) return false;
    state.mounted = false; P._snowboard = null; board.visible = false;
    P.pos.y = floorAt(P.pos.x, P.pos.z); P.vy = 0; P.grounded = true;
    ch.group.rotation.x = 0; ch.group.rotation.z = 0;
    if (hud) hud.style.display = "none";
    if (!silent) note("Snowboard off.", 1.4);
    return true;
  }
  function bail(reason) {
    const vx = state.vx, vz = state.vz, vy = state.vy;
    dismount(true);
    const ph = P._phys || (P._phys = {});
    ph.fl = Math.max(ph.fl || 0, 0.35); ph.air = true;
    ph.vx = vx * 0.72; ph.vz = vz * 0.72; ph.vy = Math.max(3.8, vy + 2.2);
    ph.spin = (state.steer || 0.6) * 4.2; ph.spinZ = -ph.spin * 0.55;
    ph.down = Math.max(ph.down || 0, 1.4); ph.kx = ph.kz = 0;
    if (CBZ.shake) CBZ.shake(0.7);
    note("" + (reason || "Wipeout") + " — you lost the edge.", 2.4);
  }

  function pose() {
    const sp = speed();
    if (sp > 0.25) setFacing(state.vx, state.vz);
    if (state.grounded) {
      normalAt(P.pos.x, P.pos.z, up);
      forward.set(state.dirX, 0, state.dirZ);
      forward.addScaledVector(up, -forward.dot(up)).normalize();
      right.crossVectors(up, forward).normalize();
      forward.crossVectors(right, up).normalize();
      basis.makeBasis(right, up, forward);
      ch.group.quaternion.setFromRotationMatrix(basis);
      board.rotation.z += ((-state.steer * 0.18) - board.rotation.z) * 0.18;
      board.rotation.x *= 0.82;
    } else {
      airEuler.set(-0.08 - Math.min(0.28, state.airT * 0.07), Math.atan2(state.vx, state.vz) + state.airSpin, -state.steer * 0.12);
      ch.group.quaternion.setFromEuler(airEuler);
      board.rotation.x = Math.sin(state.airT * 5.5) * 0.08;
      board.rotation.z *= 0.9;
    }
    if (ch.parts) {
      if (ch.parts.ll) ch.parts.ll.rotation.x = 0.38;
      if (ch.parts.rl) ch.parts.rl.rotation.x = 0.42;
      if (ch.parts.la) { ch.parts.la.rotation.x = -0.18; ch.parts.la.rotation.z = 0.72; }
      if (ch.parts.ra) { ch.parts.ra.rotation.x = -0.18; ch.parts.ra.rotation.z = -0.72; }
    }
    if (ch.body) ch.body.rotation.z = -state.steer * 0.13;
    ch.group.position.copy(P.pos);
    P.speed = sp; P.crouch = false; P.sprint = false; P.vy = state.vy;
  }

  function step(dt) {
    if (!state.mounted) return false;
    if (!CBZ.game || CBZ.game.mode !== "city" || P.dead || P.driving) { dismount(true); return false; }

    const fdt = Math.min(0.10, Math.max(0.001, CBZ.feelDt != null ? CBZ.feelDt : dt));
    const jumpPressed = !!keys[" "] && !state.spaceWas;
    state.spaceWas = !!keys[" "];
    state.steer = (keys["d"] ? 1 : 0) - (keys["a"] ? 1 : 0);
    const slices = Math.min(7, Math.max(1, Math.ceil(Math.max(speed(), Math.abs(state.vy)) * fdt / 0.72)));
    const sdt = fdt / slices;

    for (let si = 0; si < slices && state.mounted; si++) {
      let sp = speed();
      if (sp > 0.2) setFacing(state.vx, state.vz);
      const gy0 = floorAt(P.pos.x, P.pos.z);
      normalAt(P.pos.x, P.pos.z, up);

      if (state.grounded) {
        const gravity = Math.min(22, ((CBZ.TUNE && CBZ.TUNE.gravity) || 22) * 0.82);
        state.vx += up.x * up.y * gravity * sdt;
        state.vz += up.z * up.y * gravity * sdt;

        sp = speed();
        if (sp < 1.1 && keys["w"]) { state.vx += state.dirX * 2.4 * sdt; state.vz += state.dirZ * 2.4 * sdt; }
        if (sp > 0.1 && state.steer) {
          const turn = state.steer * (1.55 / (1 + sp * 0.025)) * sdt;
          const cs = Math.cos(turn), sn = Math.sin(turn), vx = state.vx, vz = state.vz;
          state.vx = vx * cs + vz * sn; state.vz = -vx * sn + vz * cs;
        }
        const drag = (keys["w"] ? 0.018 : 0.045) + (keys["s"] ? 0.88 : 0) + Math.abs(state.steer) * 0.075;
        const damp = Math.exp(-drag * sdt);
        state.vx *= damp; state.vz *= damp;
        sp = speed();
        if (sp > 34) { const k = 34 / sp; state.vx *= k; state.vz *= k; }

        const surfaceVy = -(up.x * state.vx + up.z * state.vz) / Math.max(0.25, up.y);
        if (jumpPressed && si === 0) {
          state.grounded = false; state.vy = Math.max(5.4, surfaceVy + 5.0);
          state.airT = 0; state.airSpin = 0; P.pos.y += 0.20;
          if (CBZ.sfx) CBZ.sfx("jump");
          continue;
        }

        const predictedY = gy0 + RIDE_Y + surfaceVy * sdt;
        const ox = P.pos.x, oz = P.pos.z;
        P.pos.x += state.vx * sdt; P.pos.z += state.vz * sdt;
        if (CBZ.collideSlide) CBZ.collideSlide(P.pos, P.radius || 0.55, P.pos.y, P.pos.y + 1.7, 3);
        const hitWall = Math.hypot(P.pos.x - (ox + state.vx * sdt), P.pos.z - (oz + state.vz * sdt));
        if (hitWall > 0.18 && speed() > 9) { bail("You hit an obstacle"); break; }
        const gy1 = floorAt(P.pos.x, P.pos.z);
        const releaseGap = predictedY - (gy1 + RIDE_Y);
        if (speed() > 6.5 && releaseGap > 0.085) {
          state.grounded = false; state.vy = surfaceVy;
          state.airT = 0; state.airSpin = 0; P.pos.y = predictedY;
        } else {
          P.pos.y = gy1 + RIDE_Y; state.vy = surfaceVy;
        }
        state.lastGround = gy1;
      } else {
        state.airT += sdt;
        state.airSpin += state.steer * 2.1 * sdt;
        state.vy -= ((CBZ.TUNE && CBZ.TUNE.gravity) || 22) * sdt;
        state.vx *= Math.exp(-0.018 * sdt); state.vz *= Math.exp(-0.018 * sdt);
        P.pos.x += state.vx * sdt; P.pos.z += state.vz * sdt; P.pos.y += state.vy * sdt;
        const gy = floorAt(P.pos.x, P.pos.z);
        if (P.pos.y <= gy + RIDE_Y && state.vy <= 0) {
          normalAt(P.pos.x, P.pos.z, up);
          const surfaceVy = -(up.x * state.vx + up.z * state.vz) / Math.max(0.25, up.y);
          const impact = Math.max(0, surfaceVy - state.vy);
          const spinError = Math.abs(Math.sin(state.airSpin));
          if (impact > 15.5 || (spinError > 0.72 && speed() > 11)) {
            P.pos.y = gy + RIDE_Y; bail(impact > 15.5 ? "Hard landing" : "Sideways landing"); break;
          }
          P.pos.y = gy + RIDE_Y; state.grounded = true; state.vy = surfaceVy;
          const earned = Math.round(state.airT * 120 + Math.abs(state.airSpin) * 90 + speed() * 2);
          state.points += earned; state.bestAir = Math.max(state.bestAir, state.airT);
          state.justLanded = 0.55;
          if (state.airT > 0.28) note("Landed · +" + earned + " · " + state.airT.toFixed(1) + "s air", 1.5);
          if (CBZ.shake && impact > 7) CBZ.shake(Math.min(0.42, impact * 0.022));
          state.airT = 0; state.airSpin = 0;
        }
      }
    }

    if (!state.mounted) return true;
    state.justLanded = Math.max(0, state.justLanded - fdt);
    pose(); showHud();
    return true;
  }

  CBZ.citySnowboardStep = step;
  CBZ.mountSnowboard = mount;
  CBZ.dismountSnowboard = dismount;
  CBZ.startSnowboardRun = function () { return mount({ summit: true, dirX: 0, dirZ: 1, speed: 4.2 }); };
  CBZ.snowboardState = state;

  // X is intentionally used instead of B (B already detonates explosives).
  addEventListener("keydown", function (e) {
    if ((e.key || "").toLowerCase() !== "x" || e.repeat) return;
    if (!CBZ.game || CBZ.game.mode !== "city" || CBZ.cityMenuOpen) return;
    if (state.mounted) { e.preventDefault(); dismount(false); return; }
    if (!inSnow()) return;
    e.preventDefault(); mount({ speed: 0.5 });
  });

  if (CBZ.addLandmass) CBZ.addLandmass(function (city) {
    const root = city && city.root; if (!root) return;
    const rack = new THREE.Group(); rack.name = "mount-mercy-board-rental";
    const metal = new THREE.MeshLambertMaterial({ color: 0x43505b });
    const blue = new THREE.MeshLambertMaterial({ color: 0x176ca8 });
    for (const x of [-1.25, 1.25]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.2, 0.14), metal);
      post.position.set(x, 1.1, 0); rack.add(post);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.14, 0.14), metal);
    bar.position.y = 1.65; rack.add(bar);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.75, 0.08), blue);
      b.position.set(-0.72 + i * 0.72, 0.92, 0.12); b.rotation.z = (i - 1) * 0.07; rack.add(b);
    }
    rack.position.set(325, floorAt(325, -1272), -1272); root.add(rack);
    if (CBZ.makeLabelSprite) {
      const label = CBZ.makeLabelSprite("SNOWBOARD + LIFT");
      if (label) { label.position.set(325, rack.position.y + 3.4, -1272); label.scale.set(10, 2.2, 1); root.add(label); }
    }
    if (CBZ.interactions && CBZ.interactions.registerZone) {
      const target = { x: 325, z: -1272, kind: "snowboard-rental" };
      CBZ.interactions.registerZone({
        id: "mount-mercy-snowboard-rental", kind: "snowboard-rental", radius: 4.2, prio: 24, driving: false,
        find: function (x, z) { return Math.hypot(x - target.x, z - target.z) <= 4.2 ? target : null; },
        options: [{
          id: "snowboard-lift-run", slot: "e",
          label: function () { return state.mounted ? "Return snowboard" : "Take lift + snowboard from summit"; },
          onSelect: function () { if (state.mounted) dismount(false); else CBZ.startSnowboardRun(); },
        }],
      });
    }
  }, 32);
})();
