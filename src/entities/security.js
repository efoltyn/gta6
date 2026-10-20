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
  // Built when the prison is first needed, as if at this script's parse
  // point (core/prisonlazy.js). Body left at its old indent.
  CBZ.definePrison("entities/security.js", function () {
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

  // one merged vertex-colour mesh per part (housing, bracket)
  let VCM = null;
  function Paint() { this.g = []; }
  Paint.prototype.add = function (g, color) {
    if (g.index) { const t = g.toNonIndexed(); g.dispose(); g = t; }
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    const n = g.attributes.position.count, c = new THREE.Color(color), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    this.g.push(g); return this;
  };
  Paint.prototype.box = function (x, y, z, w, h, d, col) { return this.add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), col); };
  Paint.prototype.cyl = function (x, y, z, r0, r1, h, col, seg, rx) {
    const g = new THREE.CylinderGeometry(r0, r1, h, seg || 12);
    if (rx) g.rotateX(rx);
    return this.add(g.translate(x, y, z), col);
  };
  Paint.prototype.mesh = function () {
    if (!VCM) VCM = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const BGU = THREE.BufferGeometryUtils;
    const geo = this.g.length === 1 ? this.g[0] : BGU.mergeBufferGeometries(this.g, false);
    if (this.g.length > 1) for (const q of this.g) q.dispose();
    this.g = [];
    return new THREE.Mesh(geo, VCM);
  };

  /* THE MOUNT, fitted to what the camera actually hangs off. Run once on the
     first tick, when every room's colliders exist (security.js builds before
     the rooms). Marches back from the camera, away from where it looks; the
     first solid it meets is the wall the arm goes to. A camera standing over
     a solid (a mast) gets a short post down to the cap instead. */
  function inSolid(px, py, pz) {
    const L = CBZ.colliders || [];
    for (let i = 0; i < L.length; i++) {
      const c = L[i];
      if (px < c.minX || px > c.maxX || pz < c.minZ || pz > c.maxZ) continue;
      if (c.y0 != null && py < c.y0) continue;
      if (c.y1 != null && py > c.y1) continue;
      return c;
    }
    return null;
  }
  function fitMount(cam) {
    cam._mounted = true;
    const p = cam.pos, a = cam.baseAngle, bx = -Math.sin(a), bz = -Math.cos(a);
    const P = new Paint(), STEEL = 0xd2d5d8, PLATE = 0xc4c8cb;
    const holder = new THREE.Group();
    holder.rotation.y = a;                                    // local -z = toward the wall
    cam.group.add(holder);
    P.add(new THREE.SphereGeometry(0.022, 12, 8), STEEL);     // the ball joint under the body
    const under = inSolid(p.x, p.y - 0.4, p.z);
    if (under) {
      // on a mast: a 48 mm post down to the cap, a clamp ring
      P.cyl(0, -0.18, 0, 0.024, 0.024, 0.36, STEEL, 12);
      P.cyl(0, -0.345, 0, 0.04, 0.04, 0.03, PLATE, 14);
    } else {
      let d = 0.25;
      for (let t = 0.06; t <= 2.0; t += 0.03) {
        if (inSolid(p.x + bx * t, p.y, p.z + bz * t)) { d = t; break; }
      }
      // the arm: from the ball joint, back and slightly up, to a round wall plate
      const len = Math.max(0.08, d - 0.012);
      const arm = new THREE.CylinderGeometry(0.016, 0.018, len, 10);
      arm.rotateX(Math.PI / 2);
      arm.translate(0, 0, -len / 2);
      P.add(arm, STEEL);
      P.cyl(0, 0, -d + 0.006, 0.055, 0.055, 0.012, PLATE, 18, Math.PI / 2);   // wall plate
      for (const s of [-1, 1]) P.cyl(s * 0.034, 0, -d + 0.014, 0.006, 0.006, 0.006, 0x8b9096, 6, Math.PI / 2);   // its screws
    }
    const m = P.mesh();
    m.position.y = -0.03;
    holder.add(m);
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

    /* THE CAMERA, REMADE (2026-10-20). It was three boxes: a 24 cm grey
       "mount" always behind it on -z whatever wall it was on, a 30 x 30 x
       60 cm body, and an 18 cm square "lens". Now it is a bullet camera at
       real size (reference: the Milesight mini bullet, 76 x 214 mm; UniFi G6
       bullet, 86 x 210 mm with its mount): a round housing with a sunshield
       hood over it, a black glass front with the lens in it and the IR ring
       around it, a cable gland at the back, on a ball joint at the end of a
       wall arm. The arm is fitted to whatever it hangs off on the first tick
       (fitMount below): it reaches back to the wall behind the camera, or,
       on a mast, drops to the mast's cap.
       The status readout is the lit front face (glass + IR ring, 8 cm): the
       one part of a camera that changes, and the one this file paints. */
    const bodyGrp = new THREE.Group();
    grp.add(bodyGrp);
    const hb = new Paint();
    const HOUS = 0xd8dbdd, SHADE = 0xc9ccce, DARKG = 0x111316, GL = 0x2a2d31;
    hb.cyl(0, 0.045, 0.085, 0.043, 0.043, 0.22, HOUS, 18, Math.PI / 2);        // the housing
    hb.cyl(0, 0.045, -0.03, 0.036, 0.043, 0.012, SHADE, 18, Math.PI / 2);       // rear cap
    hb.cyl(0, 0.045, -0.045, 0.009, 0.009, 0.02, GL, 8, Math.PI / 2);           // cable gland
    hb.cyl(0, 0.045, 0.198, 0.046, 0.046, 0.012, GL, 18, Math.PI / 2);          // front bezel
    {
      // the sunshield: a half shell over the housing, overhanging the glass
      const g = new THREE.CylinderGeometry(0.052, 0.052, 0.27, 18, 1, true, -Math.PI / 2 - 0.3, Math.PI + 0.6);
      g.rotateX(Math.PI / 2); g.rotateZ(Math.PI / 2);
      g.translate(0, 0.045, 0.1);
      hb.add(g, SHADE);
    }
    hb.box(0, 0.0, 0.03, 0.03, 0.02, 0.05, HOUS);                               // the mount boss under it
    const housing = hb.mesh();
    housing.castShadow = true;
    bodyGrp.add(housing);

    // 3. THE STATUS LENS — the whole HUD of this machine: the camera's front
    //    face, its glass and IR ring, lit in the state colour.
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(0.04, 20),
      mat(0x39ff88, { emissive: 0x14c258, ei: 1.35 })
    );
    lens.position.set(0, 0.045, 0.2045);
    bodyGrp.add(lens);
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.014, 16), mat(DARKG));   // the lens itself, in the lit ring
    eye.position.set(0, 0.045, 0.2055);
    bodyGrp.add(eye);

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
      if (!cam._mounted) fitMount(cam);
      if (cam.destroyed) {
        setLamp(cam, "dead", 0);
        // A SMASHED CAMERA HANGS. One write on the frame it dies: the body
        // sags off its mount and stays there, so a corridor you have already
        // cleared reads as cleared from the far end of it — which is what the
        // deleted "Security camera destroyed!" popup was standing in for.
        if (!cam._sagged) {
          cam._sagged = true;
          cam.body.rotation.x = 1.15;
          cam.body.rotation.z = 0.42;   // hanging off the ball joint by its cable
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

      // NOT ON THIS CLASSIFICATION'S CIRCUIT (systems/prisontiers.js). Nine
      // bodies are bolted up; how many are WIRED is what a security level
      // means here. The prop stays exactly where it is and its lens goes
      // dark — so counting live dots in a corridor is how you read the tier
      // off the world instead of off a HUD line. Same paint state as a
      // breaker cut, because it is the same fact: no power at this lens.
      if (cam.offline) {
        cam.active = false;
        cam.seenT = cam.watchT = 0;
        cam._wasSeen = false;
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

  // THE FACTORY, not just the list. systems/prisontiers.js bolts six more
  // bodies up (yard door, gun-room door, admin corridor, office door, sally
  // port, yard throat) so a higher classification has lenses to wire — and
  // building them through THIS function is what keeps every pixel of every
  // lens painted by the state machine above. A second camera builder would
  // be a second opinion about what a dot means.
  CBZ.makeCamera = makeCamera;

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
  });
})();
