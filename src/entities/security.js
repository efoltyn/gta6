/* ============================================================
   entities/security.js — Rotating Security Cameras

   THE LENS IS THE ENTIRE READOUT (owner, verbatim): "cameras must NOT pop
   'CAMERA DETECTING YOU!' text — the camera prop already has a tiny status
   dot; it turns red when it sees you. That's the whole feedback."

   TWO THINGS WERE WRONG AND THEY WERE THE SAME THING. A red 10 m cylinder
   hung off every camera, and the lens was red ALL THE TIME — so the prop
   had no state left to spend on the one fact that matters. A real camera
   projects nothing (it is a lens, not a lamp) and its dot is the only thing
   on it that moves. Both are now true:

     green   sweeping, nothing on it
     amber   you are in frame but off centre — the sweep is closing
     red     it has you; heat is climbing (systems/interactions.js)

   That is world/adminwing.js's door-lamp grammar (red locked / amber working
   / green open) applied to the other machine in the prison that has an
   opinion about you, so the compound speaks ONE light language.

   AND IT STOPS SWEEPING WHEN IT HAS YOU. A panning camera that freezes is
   the tell you can read from behind, at any distance, without looking at the
   dot — and it costs the player nothing, because walking out of the (now
   stationary) field still breaks the lock. One relay CLICK from the camera's
   own position on the frame it latches, through CBZ.worldSfx: it happened
   over there, on the wall, not in your skull.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.scene) return;
  const scene = CBZ.prisonRoot || CBZ.scene;
  const { addBox, mat } = CBZ;

  CBZ.cameras = [];

  /* The four states a lens can be in, in the house colours (world/adminwing.js
     :393-415 and :772-776 use these exact hexes for a lock). `dim` is the
     off half of a beat — a state that BEATS reads as active machinery, a
     state that sits still reads as idle, and that difference is doing real
     work here because red and amber are only ever a few pixels wide. */
  const LAMP = {
    idle: { c: 0x39ff88, e: 0x14c258, dim: 0x14351f },   // green: sweeping
    watch: { c: 0xffb347, e: 0xff7a1a, dim: 0x7a4f18 },  // amber: in frame, off centre
    seen: { c: 0xff3b3b, e: 0xff0000, dim: 0x3a0d06 },   // red: it has you
    dead: { c: 0x1a1a1a, e: 0x000000, dim: 0x1a1a1a },   // smashed
    out: { c: 0x2b2b2b, e: 0x000000, dim: 0x2b2b2b },    // no power
  };
  // rate 0 = solid. Cached on a key so a Lambert material is not rewritten
  // 60 times a second for the same colour.
  function setLamp(cam, key, rate) {
    const lit = !rate || Math.sin((CBZ.now || 0) * rate) > 0;
    const k = key + (lit ? "1" : "0");
    if (cam._lampK === k) return;
    cam._lampK = k;
    const L = LAMP[key];
    cam.lens.material.color.setHex(lit ? L.c : L.dim);
    cam.lens.material.emissive.setHex(lit ? L.e : 0x000000);
  }

  function makeCamera(x, y, z, baseAngle, options) {
    options = options || {};
    const sweepRange = options.range != null ? options.range : 1.2; // sweep angle in radians (~70 deg)
    const sweepSpeed = options.speed != null ? options.speed : 0.0016; // speed multiplier
    const offset = options.offset != null ? options.offset : 0;

    const grp = new THREE.Group();
    grp.userData.dynamic = true;
    grp.position.set(x, y, z);
    scene.add(grp);

    // 1. Mount bracket (connected to wall)
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.36), mat(0x515a66));
    mount.position.set(0, 0.2, -0.18);
    grp.add(mount);

    // 2. Camera body (rotates)
    const bodyGrp = new THREE.Group();
    bodyGrp.position.set(0, 0, 0);
    grp.add(bodyGrp);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.6), mat(0x2d3238));
    body.position.set(0, 0, 0.1);
    body.castShadow = true;
    bodyGrp.add(body);

    // 3. THE STATUS LENS — the whole HUD of this machine. Slightly larger
    //    than the old dot (0.14 -> 0.18) because it is now carrying every
    //    word that used to be printed across the middle of the screen, and
    //    it is read from the floor of a 9 m hall.
    const lens = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.07),
      mat(0x39ff88, { emissive: 0x14c258, ei: 1.35 })
    );
    lens.position.set(0, 0, 0.4);
    bodyGrp.add(lens);

    // (4. THE DETECTION CONE IS DELETED. A camera emits nothing; a 10 m
    //  translucent red cylinder is a searchlight, and the prison already has
    //  four real ones on the towers. What replaced it is the lens above plus
    //  the sweep freeze in the updater — both things a real camera does.)

    const cam = {
      group: grp,
      body: bodyGrp,
      lens: lens,
      pos: new THREE.Vector3(x, y, z),
      baseAngle: baseAngle,
      sweepRange: sweepRange,
      sweepSpeed: sweepSpeed,
      offset: offset,
      active: true,
      destroyed: false,
      hp: 10,
      // written by systems/interactions.js's detection pass (which owns the
      // geometry test), decayed and PAINTED here so one file owns the prop.
      seenT: 0,
      watchT: 0,
      // its own sweep clock, so a locked camera can hold station without
      // stopping the other two (they used to share CBZ.now).
      sweepT: CBZ.now || 0,
    };

    CBZ.cameras.push(cam);
    return cam;
  }

  // Spawn cameras in key locations:
  // 1. Cell Block Hallway: sweeping the aisle from the back wall
  makeCamera(0, 8.0, -42.8, 0, { offset: 0, range: 0.8 });
  
  // 2. Cafeteria entrance: sweeping the entryway on the west wall
  makeCamera(-19.5, 5.2, 14, -Math.PI / 2, { offset: Math.PI / 2, range: 1.1 });

  // 3. Lounge restricted entrance: sweeping the staff door on the east wall
  makeCamera(19.5, 5.2, 37, Math.PI / 2, { offset: -Math.PI / 2, range: 1.1 });

  // Camera animation loop
  CBZ.onUpdate(25, function (dt) {
    if (CBZ.game.mode !== "escape") return;
    const breaker = CBZ.breaker;
    const powerOut = breaker && breaker.sabotaged;

    for (const cam of CBZ.cameras) {
      if (cam.destroyed) {
        setLamp(cam, "dead", 0);
        // A SMASHED CAMERA HANGS. One write on the frame it dies: the body
        // sags off its mount and stays there, so a corridor you have already
        // cleared reads as cleared from the far end of it — which is what the
        // deleted "Security camera destroyed!" popup was standing in for.
        if (!cam._sagged) {
          cam._sagged = true;
          cam.body.rotation.x = 1.15;
          cam.body.rotation.z = 0.42;
          cam.seenT = cam.watchT = 0;
        }
        continue;
      }

      if (powerOut) {
        cam.active = false;
        cam.seenT = cam.watchT = 0;
        cam._wasSeen = false;      // so the relay speaks again when it re-latches
        setLamp(cam, "out", 0);
        continue;
      }

      // Restore camera function if power is back
      if (!cam.active) cam.active = true;

      const seen = cam.seenT > 0;
      const watch = !seen && cam.watchT > 0;
      if (cam.seenT > 0) cam.seenT -= dt;
      if (cam.watchT > 0) cam.watchT -= dt;

      // THE LATCH SPEAKS ONCE, FROM THE WALL. A relay closing is a 50 dB
      // click (systems/audio.js `switch`), which is why it goes through
      // CBZ.worldSfx: past a few metres it is not requested at all, and the
      // shared per-cue gap means three cameras cannot chatter. Voicing it on
      // the TRANSITION, never per frame, is the difference between a machine
      // reacting and an alarm bell.
      if (seen && !cam._wasSeen && CBZ.worldSfx) {
        CBZ.worldSfx("switch", cam.pos.x, cam.pos.z, { y: cam.pos.y, ref: 5, volume: 0.5, gap: 0.5 });
      }
      cam._wasSeen = seen;

      // amber beats slowly (something is happening), red beats fast (it is
      // happening to you). Same escalation the admin-wing lock uses.
      setLamp(cam, seen ? "seen" : watch ? "watch" : "idle", seen ? 0.024 : watch ? 0.009 : 0);

      // Sweep animation back and forth — HELD while it has you, so a camera
      // that stopped moving is the tell you can read without seeing the dot.
      if (!seen) cam.sweepT += dt * 1000;
      const sweep = Math.sin(cam.sweepT * cam.sweepSpeed + cam.offset) * cam.sweepRange;
      cam.body.rotation.y = cam.baseAngle + sweep;
      // slight downward pitch so it points toward the floor
      cam.body.rotation.x = 0.45;
      cam.body.rotation.z = 0;
    }
  });

  CBZ.resetCameras = function () {
    for (const cam of CBZ.cameras) {
      cam.destroyed = false;
      cam.active = true;
      cam.hp = 10;
      cam.seenT = cam.watchT = 0;
      cam._sagged = false; cam._wasSeen = false;
      cam.body.rotation.set(0.45, cam.baseAngle, 0);
      setLamp(cam, "idle", 0);
    }
  };
})();
