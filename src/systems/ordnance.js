/* ============================================================
   systems/ordnance.js — THINGS THAT FALL, AND WHAT THEY DO WHEN THEY LAND.

   WHY. Explosions existed in this engine in five places and agreed on
   nothing: `city/strategic.js` drops the B-2's stick, `city/nukefx.js`
   owns the big one, `weapons/*` grenades and the launcher each roll
   their own splash, `systems/fx.js` has the particles. Every one of
   them re-derived the same three hard parts — the BALLISTIC path, the
   FALLOFF, and the question of whether the target was actually EXPOSED
   — and only one of them got the third right.

   This file is the shared answer. It owns four things and nothing else:

   1. THE FALL. A released store keeps the aircraft's velocity, gains
      gravity and loses energy to drag. That is why you cannot aim a
      bomb at what is under you: it goes where the AEROPLANE was going.
      Nothing about that is simulated as a special case — it falls out
      of releasing with the parent's velocity, which is also the real
      reason bombers fly straight and level on the run-in.

   2. THE PREDICTION. `predict()` integrates the same equation forward
      and returns the impact point and time-to-impact.

      SHARING THE INTEGRATOR IS NOT ENOUGH, AND THIS FILE CLAIMED IT WAS
      (fixed 2026-08-07). The old header said a pipper fed by the bomb's
      own integrator "cannot disagree with the bomb". It disagreed by
      HUNDREDS OF METRES. `predict()` stepped to `groundAt`
      and stopped there, while `ord.step()` ALSO burst the store on the
      first roof it clipped — so over a city of 200 towers up to 270 m the
      pipper pointed at a street the bomb never reached. Measured, ten
      releases at 360 m / 175 m/s across the basin: 10 of 10 struck a
      roof, mean XZ error 312 m, worst 484 m, against a 46 m blast
      radius; predicted 8.96 s of fall against 5.5–7.9 s actual. The AI's
      CCIP release test calls the same function, so the bombing side was
      pickling at a solution that did not exist.
      The trap was never the arithmetic — it was that the STOPPING RULE
      lived in one of the two callers. So there is now exactly one
      routine that answers "what did a store flying THIS SEGMENT hit, and
      at what height" (`strikeSeg`), and `predict()` and `step()` both
      ask IT with the piece of flight they just made. A future stopping
      rule (water, a bridge deck, a proximity fuse) goes in there and
      both sides get it in the same commit or neither does. It takes a
      segment rather than a point because the two callers sample at
      different rates and a point test hands them different answers for
      that reason alone. The residual is the integrator's own few metres.

      AND THE PIPPER SHOWS THE ROOF. `predict()` returns the impact at
      the height it happens (`.roof` says which), so the ring draws on
      the rooftop the store is really going to burst on. A burst 200 m up
      is >45 m from the man in the street below and does nothing to him —
      the player should watch himself waste that bomb, not be told he hit.

   3. THE BLAST, AND COVER. Damage is `power × (1 − d/R)²`, and then it
      asks whether the target was SHIELDED, which is two questions and
      for a long time this file asked only one:

        • is something BETWEEN him and the bang (`CBZ.micro.segmentBlocked`,
          the same ray the movement floor uses) — a wall, a tower, a pier;
        • is something OVER HIM — a roof, a canopy, an overhang.

      ONLY THE FIRST WAS ASKED, AND IT INVERTED THE RULE THE GAME TEACHES
      (fixed 2026-08-07). That ray runs from 0.4 m above the burst to
      0.9 m above the target: near-horizontal, so it can never enter a
      shelter roof's `y0:4.8 → y1:6.1` band. Measured: a runner standing
      dead centre under a civil-defence shelter — `inShelter()` true, the
      HUD's COVER lamp lit, the briefing promising him 75% — took
      `blocked:false, damage 70.4`, which is the FULL `190·(1−18/46)²`,
      off a 500-pounder 18 m away. Meanwhile 40 of 40 sampled tower pairs
      returned blocked. So cover was handed out by whatever masonry
      happened to be on the line, and the one place the game tells you to
      stand was the one place worth nothing.
      Ordnance is an OVERHEAD threat; a roof is the whole reason a
      civil-defence shelter exists, and the overhead test is what this
      file was missing rather than an exception bolted onto it. It is
      general — it reads `y0`/`y1` off the collider and never reads a tag,
      so a park tree's canopy and a building overhang shelter you for the
      same reason the concrete slab does. One dial for both answers:
      ORDNANCE_COVER_FACTOR.

   4. THE TELEGRAPH. Ordnance in the air paints a THREAT RING on the
      ground at its predicted impact point, sized to its blast radius
      and tightening as it falls. An explosion that arrives unannounced
      is not difficulty, it is a coin flip — the ring is what converts
      "you died" into "you should have moved". Callers can read the
      same data (`activeThreats()`) for HUD, audio and AI.

   POOLED, ALWAYS. Fireballs, shockwave rings, smoke and craters all
   come from fixed pools sized at init. A hundred bombs in ten minutes
   must not allocate a hundred meshes, and a crater field must not grow
   without bound — the oldest crater is recycled, which is also why the
   city never accumulates a million-triangle scar.

   THE NUKE IS A ROW, NOT A FILE (2026-08-06). A nuclear store differs
   from the 2000-pounder in exactly two places — the BODY and the FLASH —
   and this engine already shipped both. `city/strategic.js` publishes
   `CBZ.nukeWarhead()` (the B61 casing the bunker vault rack and the B-2's
   round both wear: computed tangent ogive, boat-tail, cruciform fins,
   arming bands) and `city/nukefx.js` owns the entire detonation (the DOM
   whiteout, the Taylor-Sedov white dome, the mushroom stages, and the
   researched ring model behind `CBZ.nukeRings` / `nukeLethalAt`). So the
   nuke here is a KIND that POINTS AT THEM, and everything that makes a
   falling thing a falling thing — the integrator, the prediction, the
   cover question, the threat ring — is the same code the iron bomb runs.
   Both reuses degrade: with neither engine file in the page the nuke
   falls as the primitive body and detonates as the pooled fireball.

   USE:
     CBZ.ordnance.init({groundAt, scene});
     const t = CBZ.ordnance.addTarget({pos, team, onDamage});
     CBZ.ordnance.release({pos, vel, team:"red", radius:52, power:190});
     // stepped automatically off CBZ.micro.onFrame when present.

   Flags: ORDNANCE_V1 (master), ORDNANCE_THREAT_RINGS, ORDNANCE_CRATERS,
   ORDNANCE_COVER_FACTOR, ORDNANCE_NUKE. Audit: CBZ.ordnanceAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const THREE = window.THREE;
  if (!THREE) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  const C = CBZ.CONFIG;
  if (C.ORDNANCE_V1 == null) C.ORDNANCE_V1 = true;
  if (C.ORDNANCE_THREAT_RINGS == null) C.ORDNANCE_THREAT_RINGS = true;
  if (C.ORDNANCE_CRATERS == null) C.ORDNANCE_CRATERS = 90;
  if (C.ORDNANCE_COVER_FACTOR == null) C.ORDNANCE_COVER_FACTOR = 0.25;
  // ORDNANCE_NUKE — the nuclear KIND (see the header). false and the row is
  // never declared, so `kind:"nuke"` resolves to the iron bomb through the
  // same `KINDS[k] || KINDS.iron` fallback every other unknown kind takes,
  // and a caller can ask whether the reward exists at all with
  // `!!CBZ.ordnance.kinds.nuke`. One line, whole feature.
  if (C.ORDNANCE_NUKE == null) C.ORDNANCE_NUKE = true;
  if (C.ORDNANCE_V1 === false) return;

  const ord = (CBZ.ordnance = CBZ.ordnance || {});
  const G = 9.81;

  let scene = null, groundAt = null, blocked = null, ready = false;
  const bombs = [], targets = [], fx = [], rings = [], craters = [];
  let craterAt = 0;
  const stats = { released: 0, detonated: 0, hits: 0, kills: 0, nukes: 0 };

  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

  // ---- KINDS. A kind is a claim about weight and lethality, and the two
  //      are linked on purpose: the heavy store falls straighter (less drag
  //      per unit mass) AND hurts more, so choosing it is a real trade
  //      against the number you can carry.
  const KINDS = {
    iron: { radius: 46, power: 190, drag: 0.00022, size: 1.25, len: 4.2, color: 0x59616b, fuse: 0, name: "500 lb IRON" },
    heavy: { radius: 78, power: 320, drag: 0.00014, size: 1.9, len: 6.2, color: 0x4b5058, fuse: 0, name: "2000 lb HEAVY" },
    cluster: { radius: 30, power: 110, drag: 0.00030, size: 0.9, len: 2.8, color: 0x6b6250, fuse: 0, name: "CLUSTER" },
    rocket: { radius: 26, power: 130, drag: 0.00010, size: 0.6, len: 2.4, color: 0xa9a294, fuse: 0, name: "ROCKET" },
  };

  // ---- THE ONE THAT IS NOT A STORE. Everything above is a claim about
  //      weight and lethality; this row also claims a different BODY and a
  //      different FLASH, and names the engine files that own them (`fx` and
  //      `body`, resolved in bombMesh/blast below). It carries four numbers
  //      the shared machinery cannot guess:
  //
  //      radius — 1100 m is NOT a taste. `city/nukefx.js` inverts the
  //        published maximum-fireball relation R = 50·W^(1/3) out of the
  //        shipped bus row and gets 16 kt, Hiroshima-class; its `nukeRings()`
  //        then puts 5 psi — the overpressure that collapses ordinary
  //        buildings — at 440·16^(1/3) = 1109 m. So the kill radius and the
  //        spectacle are the SAME device, and `init()` re-derives this number
  //        from `CBZ.nukeRings()` when that file is in the page so the two
  //        cannot drift.
  //      power — 1800 was MEASURED, not chosen. At 900 a nuke over a dense
  //        city killed ONE man in ten (measured 2026-08-06, ten runners at
  //        301..902 m from ground zero): a 1.1 km ray through two hundred
  //        towers is blocked for very nearly everybody, so the flat 0.25
  //        cover factor — calibrated against a 46 m frag bomb — was quartering
  //        the whole event. At 1800 the same ten lose five. It is still far
  //        GENTLER than the research the same file publishes:
  //        `CBZ.nukeLethalAt()` carries the USSBS Hiroshima survey, which puts
  //        83% dead at one kilometre, where this model kills nobody who is
  //        behind anything. A game has to leave the running side something to
  //        do; the arithmetic is the ceiling, not the target.
  //        The cover rule stays the whole answer: in the open a man dies out
  //        to ~848 m, behind something to ~587 m. A wall is 260 metres.
  //      warn — how many seconds of threat ring this thing is WORTH. Five is
  //        right for a 500-pounder that ruins one street. A weapon that takes
  //        a quarter of the city has to be visible from the moment it leaves
  //        the bay, or the running side is playing a coin flip (see THE
  //        TELEGRAPH). `dangerAt()` and the ring both read it.
  //      craterK — the scorch is sized to the FIREBALL (126 m), not to the
  //        blast reach. A 460 m disc of char is not a crater, it is a paint
  //        bucket over the map.
  //      sound — a nuke is not a louder bomb: the flash arrives at c and the
  //        report walks out at 340 m/s, so the delay cap is nine seconds
  //        rather than two, and the punch is a 34 Hz sub, not a 445 Hz one
  //        (which is what `60 + radius*0.35` would have produced — a whistle).
  if (C.ORDNANCE_NUKE) {
    KINDS.nuke = {
      radius: 1100, power: 1800, drag: 0.00006, size: 1.6, len: 5.2,
      color: 0xb9c0c7,                 // the unpainted grey a stockpile weapon wears
      fuse: 0, name: "TACTICAL NUKE",
      fx: "nuke", body: "nukeWarhead",
      warn: 15, craterK: 0.11,
      sound: { ref: 3, dur: 7.5, sub: 34, delayMax: 9 },
    };
  }
  ord.kinds = KINDS;

  // ---------------------------------------------------------------- INIT
  ord.init = function (opts) {
    opts = opts || {};
    scene = opts.scene || CBZ.scene;
    groundAt = opts.groundAt || function () { return 0; };
    blocked = opts.blocked || (CBZ.micro && CBZ.micro.segmentBlocked) || function () { return false; };
    if (ready) return ord;
    ready = true;

    // ---- pools
    const FXN = opts.fxPool || 22;
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xffb352, transparent: true, opacity: 1, depthWrite: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 1, depthWrite: false });
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0x3a3630, transparent: true, opacity: 0.9, depthWrite: false });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    const sphere = new THREE.SphereGeometry(1, 10, 8);
    const ringGeo = new THREE.RingGeometry(0.85, 1, 32, 1);
    ringGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < FXN; i++) {
      const g = new THREE.Group();
      g.visible = false;
      const core = new THREE.Mesh(sphere, coreMat.clone());
      const fire = new THREE.Mesh(sphere, fireMat.clone());
      const wave = new THREE.Mesh(ringGeo, ringMat.clone());
      g.add(core); g.add(fire); g.add(wave);
      const puffs = [];
      for (let p = 0; p < 5; p++) {
        const s = new THREE.Mesh(sphere, smokeMat.clone());
        s.userData.dir = new THREE.Vector3();
        g.add(s); puffs.push(s);
      }
      scene.add(g);
      fx.push({ group: g, core: core, fire: fire, wave: wave, puffs: puffs, t: -1, dur: 1, R: 1 });
    }

    // ---- threat rings (see THE TELEGRAPH)
    if (C.ORDNANCE_THREAT_RINGS) {
      const trGeo = new THREE.RingGeometry(0.9, 1, 40, 1);
      trGeo.rotateX(-Math.PI / 2);
      for (let i = 0; i < 40; i++) {
        const m = new THREE.Mesh(trGeo, new THREE.MeshBasicMaterial({
          color: 0xff4436, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false,
        }));
        m.visible = false;
        m.renderOrder = 5;
        scene.add(m);
        rings.push(m);
      }
    }

    // ---- crater pool
    if (C.ORDNANCE_CRATERS > 0) {
      const cg = new THREE.CircleGeometry(1, 18);
      cg.rotateX(-Math.PI / 2);
      const cmat = new THREE.MeshLambertMaterial({ color: 0x2a2622, transparent: true, opacity: 0.9 });
      for (let i = 0; i < (C.ORDNANCE_CRATERS | 0); i++) {
        const m = new THREE.Mesh(cg, cmat);
        m.visible = false;
        m.renderOrder = 2;
        scene.add(m);
        craters.push(m);
      }
    }

    // ---- ONE DEVICE, ONE SET OF NUMBERS. city/nukefx.js already solved the
    // whole event out of the bus row it draws; if it is in the page, take its
    // 5 psi contour rather than trusting the literal in the table above. This
    // is the difference between a constant somebody has to remember and a
    // constant that cannot go stale.
    if (KINDS.nuke && CBZ.nukeRings) {
      try {
        const t = CBZ.nukeRings();
        if (t && t.psi5 > 0) { KINDS.nuke.radius = Math.round(t.psi5); KINDS.nuke.kt = t.W; }
      } catch (e) { /* keep the literal; it IS that contour */ }
    }

    if (CBZ.micro && CBZ.micro.onFrame) CBZ.micro.onFrame(ord.step, { id: "ordnance", order: 20 });
    return ord;
  };

  // ------------------------------------------------------------- TARGETS
  // A target is anything a blast should be able to hurt. The contract is
  // deliberately tiny — a position and a callback — so an NPC, a player, a
  // vehicle and a building can all be one without sharing a base class.
  ord.addTarget = function (t) {
    if (!t) return null;
    t.alive = t.alive !== false;
    targets.push(t);
    return t;
  };
  ord.removeTarget = function (t) {
    const i = targets.indexOf(t);
    if (i >= 0) targets.splice(i, 1);
  };
  ord.targets = targets;

  // ----------------------------------------------------------- BALLISTICS
  // ONE integrator, used by the bomb AND by the prediction (see header).
  //
  // IT FILLS A SCRATCH ROW RATHER THAN RETURNING A FRESH ONE. `predict()`
  // steps this ~110 times per call and is now asked once a frame by the
  // player's pipper AND by every AI bomber's CCIP test; a six-element array
  // per step is a thousand throwaway arrays a second for one aeroplane. Every
  // caller reads the row before stepping again, which is the only contract
  // this shortcut needs.
  const _int = [0, 0, 0, 0, 0, 0];
  function integrate(px, py, pz, vx, vy, vz, drag, dt) {
    // sqrt, not Math.hypot: hypot pays for overflow guards on numbers that
    // are a bomb's speed in m/s, and its precision is implementation-defined
    // where sqrt is exactly rounded — cheaper AND more repeatable.
    const d = drag * Math.sqrt(vx * vx + vy * vy + vz * vz);
    vx -= vx * d * dt;
    vz -= vz * d * dt;
    vy -= (vy * d + G) * dt;
    _int[0] = px + vx * dt; _int[1] = py + vy * dt; _int[2] = pz + vz * dt;
    _int[3] = vx; _int[4] = vy; _int[5] = vz;
    return _int;
  }

  // ---- WHAT A STORE HITS, ASKED IN ONE PLACE (see THE PREDICTION).
  // The falling bomb and the aiming reticle must never own separate copies of
  // the stopping rule; when they did, the reticle was wrong by 312 m on
  // average. `strikeSeg` answers for a SEGMENT of flight — the frame the bomb
  // just flew, or the step the prediction just took — and fills the four
  // scratch fields below rather than allocating an answer per integrator step.
  let _hitX = 0, _hitY = 0, _hitZ = 0, _hitRoof = false;

  // A SEGMENT AND NOT A POINT, because the callers sample at wildly different
  // rates and a point test makes the answer depend on that rate. `predict()`
  // steps 0.08 s (14 m at bombing speed) and the bomb steps a real frame,
  // which microboot clamps at 0.1 s (17 m). Measured: shot E3 of the ten-shot
  // table CLIPS THE CORNER of a 250 m tower over about 4 m of ground track —
  // the fine step sees it, a 14 m step walks straight past, and the two
  // answers are 254 m apart. Corner grazes are not a rare curiosity in a city
  // of two hundred boxes; they are the edge of every one of them.
  const FINE = 2.5;                 // m of track per fine sample near a tower

  // The skyline's ceiling, cached. This single compare is what keeps the
  // rooftop test off the hot part of the trajectory: a store released at
  // 360 m spends most of its fall above every roof in the world, and up
  // there the answer is knowable without touching the building list.
  let _ceil = 0, _ceilWorld = null, _ceilN = -1;
  function roofCeiling() {
    const w = CBZ.desertCity && CBZ.desertCity.world;
    const B = w && w.buildings;
    // No skyline in this page (a slice, a test rig, the prison): the ground
    // is the only thing there is to hit, and −Infinity says so in one compare.
    if (!B || !B.length) return -Infinity;
    if (w !== _ceilWorld || B.length !== _ceilN) {
      _ceilWorld = w; _ceilN = B.length;
      let h = 0;
      for (let i = 0; i < B.length; i++) if (B[i].h > h) h = B[i].h;
      _ceil = h;
    }
    return _ceil;
  }

  function strikeSeg(x0, y0, z0, x1, y1, z1) {
    _hitRoof = false;
    const g = groundAt ? groundAt(x1, z1) : 0;
    if (y1 <= g) { _hitX = x1; _hitY = g; _hitZ = z1; return true; }
    if ((y0 < y1 ? y0 : y1) > roofCeiling()) return false;   // the whole segment is above every roof
    const w = CBZ.desertCity && CBZ.desertCity.world;
    if (!w || !w.buildingAt) return false;

    // TWO TIERS, AND THE CHEAP ONE ANSWERS ALMOST EVERY TIME. `buildingAt`'s
    // `pad` turns the point query into "is there a tower within pad of here";
    // pad = HALF the segment, so the two end discs between them cover the
    // whole of it (the ground track is a straight line — drag scales vx and
    // vz together and never turns them, so there is nothing off the line to
    // miss). Null means the segment is clear and costs ONE scan.
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (!w.buildingAt(x1, z1, len * 0.5 + 0.5)) return false;

    // Something is within half a step. Only now is the segment worth walking.
    const n = Math.max(1, Math.ceil(len / FINE));
    const dy = y1 - y0;
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      const px = x0 + dx * u, py = y0 + dy * u, pz = z0 + dz * u;
      const bl = w.buildingAt(px, pz, 0);
      if (bl && py <= bl.h) { _hitX = px; _hitY = bl.h; _hitZ = pz; _hitRoof = true; return true; }
    }
    return false;
  }

  // Where does it land, and when? Steps the same equation, and stops on the
  // same rule, as the bomb.
  ord.predict = function (pos, vel, kind, maxT) {
    const K = KINDS[kind] || KINDS.iron;
    let px = pos.x, py = pos.y, pz = pos.z;
    let vx = vel.x, vy = vel.y, vz = vel.z;
    const dt = 0.08;
    const T = maxT || 40;
    for (let t = 0; t < T; t += dt) {
      const r = integrate(px, py, pz, vx, vy, vz, K.drag, dt);
      if (strikeSeg(px, py, pz, r[0], r[1], r[2]))
        return { x: _hitX, y: _hitY, z: _hitZ, t: t, hit: true, roof: _hitRoof };
      px = r[0]; py = r[1]; pz = r[2]; vx = r[3]; vy = r[4]; vz = r[5];
    }
    return { x: px, y: py, z: pz, t: T, hit: false, roof: false };
  };

  // ------------------------------------------------------------- RELEASE
  // THE REAL CASING WHEN THE REAL CASING IS IN THE PAGE. Same shape
  // world/airbase.js's realModel()/adopt() uses for the B-2: ask the engine,
  // reconcile the ONE convention that differs, fall back to primitives on
  // absence OR on a throw, and never fork the geometry.
  //
  // TWO CONVENTIONS RECONCILED HERE:
  //   • CBZ.nukeWarhead builds NOSE ALONG +X (its own header says so; it is
  //     the axis a laid-down CylinderGeometry naturally takes). A store in
  //     this file is attitude'd by `mesh.lookAt(pos + vel)` in ord.step, and
  //     Object3D.lookAt points LOCAL +Z at the target — so nose must be +Z.
  //     RotY(−90°) maps +X onto +Z, which is the same single yaw
  //     city/strategic.js writes for the same reason.
  //   • The shipped casing is 2.52 m — deliberately, it is a B61 at game
  //     scale. Beside this file's own 4.2 m iron bomb that reads as the
  //     SMALLER weapon, which is a joke at 300 m slant range. `len`/`rad` are
  //     public opts, so it is built at 5.2 m holding the shipped L/D of 6.0:
  //     the proportions stay the engine's, only the scale is the game's.
  //
  // NO CHUTE, on purpose. The casing can build its ribbon parachute and the
  // real B61 delivery streams one — but a chute is a DRAG CHANGE mid-fall,
  // and `predict()` integrates one constant drag per kind. A store whose drag
  // changed after release would make the pipper lie about its own impact
  // point, which is the one bug class this file's design forbids (see THE
  // PREDICTION).
  function nukeBody(K) {
    if (!CBZ.nukeWarhead) return null;
    try {
      // rad is a RADIUS, and the shipped L/D of 6.0 is length over DIAMETER —
      // so it is len/12, not len/6. Getting that wrong builds a 3:1 barrel
      // whose fins span four metres, which is how it was caught.
      const w = CBZ.nukeWarhead({ len: K.len, rad: K.len / 12, chute: false, lugs: false });
      if (!w || !w.isObject3D) return null;
      const g = new THREE.Group();
      w.rotation.y = -Math.PI / 2;
      g.add(w);
      g.userData.real = true;
      return g;
    } catch (e) {
      console.warn("[ordnance] CBZ.nukeWarhead present but failed; using the primitive body", e);
      return null;
    }
  }

  let bombGeo = null, bombMats = null;
  function bombMesh(K) {
    if (K.body === "nukeWarhead") { const w = nukeBody(K); if (w) return w; }
    if (!bombGeo) {
      bombGeo = new THREE.CylinderGeometry(0.5, 0.34, 1, 8);
      bombMats = {};
    }
    if (!bombMats[K.color]) bombMats[K.color] = new THREE.MeshLambertMaterial({ color: K.color });
    const g = new THREE.Group();
    const body = new THREE.Mesh(bombGeo, bombMats[K.color]);
    body.scale.set(K.size, K.len, K.size);
    body.rotation.x = Math.PI / 2;          // long axis down −Z, like the airframes
    g.add(body);
    const fin = new THREE.Mesh(
      CBZ.boxGeom ? CBZ.boxGeom(0.12, K.size * 2.0, K.len * 0.28) : new THREE.BoxGeometry(0.12, K.size * 2.0, K.len * 0.28),
      bombMats[K.color]);
    fin.position.z = K.len * 0.36;
    g.add(fin);
    const fin2 = fin.clone();
    fin2.rotation.z = Math.PI / 2;
    g.add(fin2);
    return g;
  }

  // A store as a bare THREE.Group, detached from any flight. An asset
  // viewer, a loadout screen and a bomb-bay prop all want to SEE one
  // without dropping it.
  ord.makeMesh = function (kind) { return bombMesh(KINDS[kind] || KINDS.iron); };

  // release({pos, vel, team, kind, owner, radius?, power?, onDetonate?})
  ord.release = function (o) {
    if (!ready) ord.init({});
    o = o || {};
    const K = KINDS[o.kind] || KINDS.iron;
    const mesh = bombMesh(K);
    scene.add(mesh);
    const b = {
      kind: o.kind || "iron", K: K,
      pos: new THREE.Vector3().copy(o.pos || new THREE.Vector3()),
      vel: new THREE.Vector3().copy(o.vel || new THREE.Vector3()),
      team: o.team || null,
      owner: o.owner || null,
      radius: o.radius != null ? o.radius : K.radius,
      power: o.power != null ? o.power : K.power,
      onDetonate: o.onDetonate || null,
      mesh: mesh,
      age: 0,
      impact: null,
      live: true,
    };
    bombs.push(b);
    stats.released++;
    return b;
  };

  // A STICK is what a bomber actually drops: N stores spaced in TIME, so
  // they walk along the ground track. Spacing them in space instead would
  // be wrong — the aeroplane is what does the spacing.
  ord.stick = function (o) {
    o = o || {};
    const n = Math.max(1, o.count || 6);
    const gap = o.interval != null ? o.interval : 0.16;
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(setTimeout(function () {
        if (o.getState) {
          const s = o.getState();
          if (!s) return;
          o.pos = s.pos; o.vel = s.vel;
        }
        ord.release(o);
      }, i * gap * 1000));
    }
    return out;
  };

  // ----------------------------------------------------------- THE ROOF
  // THE SECOND HALF OF THE COVER QUESTION (see THE BLAST, AND COVER). The
  // near-horizontal burst→target ray answers "is there a wall in the way";
  // this answers "is there a lid on him", which is the question ordnance
  // actually poses and the only one a civil-defence shelter was ever built
  // to fail.
  //
  // WHAT MAKES A COLLIDER A ROOF, WITH NO TAG ANYWHERE IN IT:
  //   • it is HEIGHT-GATED (`y0` present). A box with no y0 is full height —
  //     a wall, a tower, a rock. Standing inside one is not standing under
  //     something, it is standing in it, and it is the horizontal ray's
  //     business, not this one's.
  //   • its floor clears his head (`y0 ≥ pos.y + HEAD`). A vaultable rail at
  //     y0 = 0.9 is beside him; the shelter slab at 4.8 and a park canopy,
  //     which starts anywhere from 3.2 m up, are over him. Measured: a rail
  //     collider returns overhead:false and is still worth its 75% through
  //     the horizontal ray, which is the right answer by the right route.
  //   • his XZ is inside its footprint. Not "near" — under.
  //
  // GROUND BURST vs AIRBURST, WHICH IS THE ONLY DISTINCTION THAT MATTERS
  // HERE: a lid is worth nothing against a bang that is UNDER IT WITH YOU, so
  // a burst inside the footprint AND below the slab is refused — run into a
  // shelter a store has already gone off inside and it is open ground. Every
  // other geometry — a store on the street outside, a store on the slab, a
  // store bursting in the air above it — is a lid between him and it. That is
  // deliberately more generous than a fragment trace would be for a
  // ground-level burst beside the shelter: this world's shelters are the
  // published answer to "where do I stand when the sky opens" (world.shelters,
  // world.inShelter, the HUD lamp, the briefing), and a 75% roof is the
  // contract those four make with the player.
  const HEAD = 2.0;
  const _over = [];
  function underCover(tx, ty, tz, bx, by, bz) {
    if (!CBZ.micro || !CBZ.micro.queryColliders) return false;
    const head = ty + HEAD;
    // own scratch array: micro's internal one is in use by segmentBlocked,
    // which this function is asked in front of
    const list = CBZ.micro.queryColliders(tx, tz, 0.6, _over);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.noBlock || c.y0 == null) continue;
      if (c.y0 < head) continue;
      if (tx < c.minX || tx > c.maxX || tz < c.minZ || tz > c.maxZ) continue;
      if (by < c.y0 && bx >= c.minX && bx <= c.maxX && bz >= c.minZ && bz <= c.maxZ) continue;
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------- THE BLAST
  ord.blast = function (x, y, z, radius, power, info) {
    info = info || {};
    stats.detonated++;
    // The KIND is what decides which spectacle runs; everything after it —
    // sound, crater, damage, cover — is one path for every warhead there is.
    const K = info.kind ? KINDS[info.kind] : null;
    const nuclear = !!(K && K.fx === "nuke");
    if (nuclear) fireNukeFx(x, y, z, radius, info);
    else spawnFx(x, y, z, radius);

    // sound, attenuated by the listener's distance (the listener is the
    // camera — the only ear the engine has)
    if (CBZ.micro && CBZ.micro.sfx) {
      const S = (K && K.sound) || null;
      const cam = CBZ.camera;
      const d = cam ? cam.position.distanceTo(_v.set(x, y, z)) : 0;
      const gain = CBZ.micro.sfx.gainAt(d, radius * (S ? S.ref : 9));
      if (gain > 0.02) {
        const delay = Math.min(S ? S.delayMax : 2.2, d / 340);   // sound is slower than sight
        setTimeout(function () {
          CBZ.micro.sfx.boom({
            gain: gain * 0.85,
            dur: S ? S.dur : 1.1 + radius / 90,
            sub: S ? S.sub : 60 + radius * 0.35,
          });
        }, delay * 1000);
      }
      if (ord.onShake) ord.onShake(Math.max(0, 1 - d / (radius * 7)));
    }

    // crater — sized to the SCORCH, which for a nuke is the fireball and not
    // the blast reach (see craterK in the table)
    if (craters.length) {
      const m = craters[craterAt = (craterAt + 1) % craters.length];
      m.position.set(x, (groundAt ? groundAt(x, z) : 0) + 0.09, z);
      const s = radius * ((K && K.craterK) || 0.42);
      m.scale.set(s, 1, s);
      m.visible = true;
    }

    // ---- damage, with the cover question (see THE BLAST, AND COVER)
    //
    // WALK A SNAPSHOT, NEVER THE LIVE ARRAY. `onDamage` is allowed to KILL,
    // and every mode that kills unregisters the body it just removed from the
    // world — `ord.removeTarget` splices the very array this loop was walking,
    // so whoever slid into the vacated slot was stepped straight over. With a
    // 46 m bomb that killed one man it was one silently-spared target nobody
    // could see. Measured 2026-08-06 with a 1109 m nuclear blast over a live
    // squad: two removals inside one call, two men inside the radius, in the
    // open, never asked.
    //
    // AND THE SNAPSHOT IS LOCAL, NOT A REUSED MODULE SCRATCH. That was the
    // first fix and it was worse than the bug: a mode's kill handler fires its
    // own small FX blast (bomb-survivor's `boom()` does exactly this), so
    // ord.blast is RE-ENTRANT — the nested call cleared the shared array and
    // the outer loop ended at its first casualty. One array per detonation is
    // the price of a function that can call itself, and detonations are not a
    // per-frame cost.
    let hits = 0;
    const list = targets.slice();
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t || t.alive === false) continue;
      const p = t.pos;
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (d > radius) continue;
      let f = 1 - d / radius;
      f = f * f;
      // COVER IS TWO QUESTIONS AND EITHER ONE IS ENOUGH. The roof is asked
      // FIRST because it is the cheap one — a single grid cell's worth of
      // boxes — where the ray walks every cell between the bang and the man,
      // which for a 1109 m nuke is forty-odd of them per target.
      let covered = false, overhead = false;
      if (underCover(p.x, p.y, p.z, x, y, z)) { covered = true; overhead = true; }
      else if (blocked && blocked(x, y + 0.4, z, p.x, p.y + 0.9, p.z)) covered = true;
      if (covered) f *= C.ORDNANCE_COVER_FACTOR;
      const dmg = power * f;
      if (dmg < 1) continue;
      hits++;
      stats.hits++;
      if (t.onDamage) {
        // `overhead` rides along beside `covered` so a HUD can tell a man he
        // was saved by the thing over his head rather than by luck of the line
        try { t.onDamage(dmg, { x: x, y: y, z: z, radius: radius, covered: covered, overhead: overhead, by: info.owner, team: info.team, cause: "ordnance" }); }
        catch (e) { console.error("[ordnance damage]", e); }
      } else if (t.hp != null) {
        t.hp -= dmg;
        if (t.hp <= 0) t.alive = false;
      }
    }
    if (ord.onBlast) { try { ord.onBlast(x, y, z, radius, info, hits); } catch (e) { console.error("[ordnance onBlast]", e); } }
    return hits;
  };

  // ---------------------------------------------------------------- FX
  // THE NUCLEAR DETONATION IS NOT DRAWN HERE AND MUST NOT BE. city/nukefx.js
  // is 4700 lines of exactly this event — the whiteout, the double flash, the
  // R ∝ t^(2/5) Taylor-Sedov dome, the mushroom's rise/bloom/flatten stages,
  // the base surge — and it fires from one call with no impact bus loaded
  // (its own comment: the defaults MIRROR the bus row verbatim, so a probe
  // gets the same 126 m fireball the real row produces). Two things this
  // caller must get right:
  //   noDamage — the damage already happened, five lines up in ord.blast,
  //     through the cover question. The composer draws; it never bills.
  //   the row — left at its default ON PURPOSE. That default IS the 16 kt
  //     device the nuke kind's radius was derived from in init(); passing a
  //     hand-made row here would be the second table this file spent its
  //     header arguing against.
  // No file present, or a throw inside one: the pooled fireball, which is
  // what every other kind gets and is never worse than nothing.
  function fireNukeFx(x, y, z, R, info) {
    if (CBZ.cityNukeFX) {
      try {
        stats.nukes++;
        CBZ.cityNukeFX(x, y + 1.2, z, { noDamage: true, byPlayer: !!info.byPlayer });
        return;
      } catch (e) { console.error("[ordnance nukefx]", e); }
    }
    spawnFx(x, y, z, R);
  }

  function spawnFx(x, y, z, R) {
    let e = null;
    for (let i = 0; i < fx.length; i++) if (fx[i].t < 0) { e = fx[i]; break; }
    if (!e) { e = fx[0]; for (let i = 1; i < fx.length; i++) if (fx[i].t > e.t) e = fx[i]; }
    e.t = 0;
    e.dur = 1.1 + R / 110;
    e.R = R;
    e.group.position.set(x, y + R * 0.06, z);
    e.group.visible = true;
    for (let p = 0; p < e.puffs.length; p++) {
      const a = (p / e.puffs.length) * Math.PI * 2 + (p * 0.7);
      e.puffs[p].userData.dir.set(Math.cos(a) * 0.7, 0.55 + (p % 3) * 0.22, Math.sin(a) * 0.7);
      e.puffs[p].position.set(0, 0, 0);
    }
  }

  function stepFx(dt) {
    for (let i = 0; i < fx.length; i++) {
      const e = fx[i];
      if (e.t < 0) continue;
      e.t += dt;
      const u = e.t / e.dur;
      if (u >= 1) { e.t = -1; e.group.visible = false; continue; }
      const R = e.R;
      // core: a hard bright flash that dies fast
      const cu = Math.min(1, u * 5);
      e.core.scale.setScalar(R * 0.16 * (0.4 + cu * 1.5));
      e.core.material.opacity = Math.max(0, 1 - cu);
      // fireball: expands and fades over the first third
      const fu = Math.min(1, u * 2.4);
      e.fire.scale.setScalar(R * (0.12 + fu * 0.52));
      e.fire.material.opacity = Math.max(0, 0.95 - fu);
      e.fire.material.color.setHex(fu < 0.4 ? 0xffc463 : 0xd8642a);
      // shockwave: a ground ring racing outward — the readable one
      const wu = Math.min(1, u * 1.5);
      e.wave.scale.set(R * (0.15 + wu * 1.35), 1, R * (0.15 + wu * 1.35));
      e.wave.position.y = -R * 0.05;
      e.wave.material.opacity = Math.max(0, 0.75 * (1 - wu));
      // smoke: rises and swells for the whole life
      for (let p = 0; p < e.puffs.length; p++) {
        const s = e.puffs[p];
        s.position.copy(s.userData.dir).multiplyScalar(R * 0.30 * u);
        s.position.y += R * 0.36 * u;
        s.scale.setScalar(R * (0.10 + u * 0.30));
        s.material.opacity = Math.max(0, 0.72 * (1 - u * u));
      }
    }
  }

  // ------------------------------------------------------------- THE STEP
  ord.step = function (dt) {
    if (!ready) return;
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      b.age += dt;
      const r = integrate(b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.K.drag, dt);
      // ASK BEFORE MOVING: the frame the store just flew is a SEGMENT, and at
      // microboot's 0.1 s dt clamp that segment is seventeen metres long. The
      // tower corner it grazes lives inside it, not at either end — the same
      // reason the pipper missed E3. Both callers hand strikeSeg the flight
      // they just made, which is the whole point of there being one of it.
      const struck = strikeSeg(b.pos.x, b.pos.y, b.pos.z, r[0], r[1], r[2]);
      b.pos.set(r[0], r[1], r[2]);
      b.vel.set(r[3], r[4], r[5]);
      b.mesh.position.copy(b.pos);
      // a falling store weathercocks into its own airflow — this is why it
      // looks like a bomb and not a brick, and it costs one lookAt
      _v.copy(b.pos).add(b.vel);
      b.mesh.lookAt(_v);

      if (struck || b.age > 45) {
        const hx = struck ? _hitX : b.pos.x, hz = struck ? _hitZ : b.pos.z;
        const hy = struck ? _hitY : groundAt(b.pos.x, b.pos.z);
        b.pos.set(hx, hy, hz);
        scene.remove(b.mesh);
        bombs.splice(i, 1);
        b.live = false;
        ord.blast(hx, hy, hz, b.radius, b.power, { owner: b.owner, team: b.team, kind: b.kind });
        if (b.onDetonate) { try { b.onDetonate(b); } catch (e) { console.error("[ordnance onDetonate]", e); } }
        continue;
      }
      // keep the prediction fresh — HUD, AI and the threat ring all read it
      if ((b.age * 60 | 0) % 4 === 0 || !b.impact) b.impact = ord.predict(b.pos, b.vel, b.kind);
    }

    // ---- threat rings
    if (rings.length) {
      let ri = 0;
      for (let i = 0; i < bombs.length && ri < rings.length; i++) {
        const b = bombs[i];
        if (!b.impact || !b.impact.hit) continue;
        const m = rings[ri++];
        m.visible = true;
        m.position.set(b.impact.x, b.impact.y + 0.14, b.impact.z);
        // the ring TIGHTENS as time-to-impact falls: wide and faint when you
        // still have time, hard and bright when you do not
        const ttl = Math.max(0, b.impact.t);
        // A NUCLEAR RING NEVER SHRINKS BELOW ITS OWN REACH. Every other store
        // closes to 0.55 of its radius because the message is "the impact is
        // HERE" and standing at the edge of a 46 m bomb is a survivable
        // mistake. Standing anywhere inside a nuke's ring is not, so its floor
        // is 1.0: what you see is what it takes.
        const nuclear = b.K.fx === "nuke";
        const tight = Math.max(nuclear ? 1.0 : 0.55, Math.min(2.2, ttl * 0.5));
        const s = b.radius * tight;
        m.scale.set(s, 1, s);
        // brightness runs the kind's OWN warning window (see `warn`), so a
        // weapon worth fifteen seconds of dread is bright for fifteen seconds
        m.material.opacity = 0.30 + 0.55 * Math.max(0, 1 - ttl / (b.K.warn || 5));
        m.material.color.setHex(nuclear ? 0xfff0b0 : 0xff4436);
      }
      for (; ri < rings.length; ri++) rings[ri].visible = false;
    }

    stepFx(dt);
  };

  // Everything in the air right now, for HUD / AI / audio. Read-only intent.
  ord.activeThreats = function () {
    const out = [];
    for (let i = 0; i < bombs.length; i++) {
      const b = bombs[i];
      if (!b.impact || !b.impact.hit) continue;
      // `kind` and `warn` ride along because a HUD that shows every inbound
      // store the same way is not a telegraph. The caller decides what a
      // fifteen-second warning looks like; this file only knows it is owed.
      out.push({
        x: b.impact.x, y: b.impact.y, z: b.impact.z, t: b.impact.t,
        radius: b.radius, team: b.team, power: b.power,
        kind: b.kind, warn: b.K.warn || 0,
      });
    }
    return out;
  };
  // How dangerous is this spot in the next `horizon` seconds? The one call an
  // AI needs to decide whether to run, and the HUD needs to scream.
  ord.dangerAt = function (x, z, horizon) {
    const H = horizon || 6;
    let worst = 0;
    for (let i = 0; i < bombs.length; i++) {
      const b = bombs[i];
      // A STORE MAY OWE MORE WARNING THAN THE CALLER ASKED FOR. Six seconds
      // is the right horizon for a bomb you can walk out of; it is the wrong
      // one for something whose ring covers a quarter of the map, because an
      // AI that only starts running with six seconds left cannot reach a roof
      // and a HUD that only screams then has told you nothing. The kind's own
      // `warn` raises the floor and nothing else changes.
      const h = Math.max(H, b.K.warn || 0);
      if (!b.impact || !b.impact.hit || b.impact.t > h) continue;
      // MEASURED IN THREE DIMENSIONS, because the impact point is now allowed
      // to be two hundred metres in the air (a rooftop burst — see THE
      // PREDICTION). A man on the street under that tower is outside the
      // radius and is not in danger; screaming at him would be the same lie
      // the pipper used to tell, only at the other end of the fall.
      const dy = b.impact.y - (groundAt ? groundAt(x, z) : 0);
      const d = Math.hypot(x - b.impact.x, dy, z - b.impact.z);
      if (d > b.radius * 1.3) continue;
      const f = 1 - d / (b.radius * 1.3);
      if (f > worst) worst = f;
    }
    return worst;
  };
  ord.liveCount = function () { return bombs.length; };
  ord.clear = function () {
    for (let i = 0; i < bombs.length; i++) scene.remove(bombs[i].mesh);
    bombs.length = 0;
    for (let i = 0; i < rings.length; i++) rings[i].visible = false;
  };

  CBZ.ordnanceAudit = function () {
    return {
      ready: ready, inAir: bombs.length, targets: targets.length,
      fxPool: fx.length, ringPool: rings.length, craterPool: craters.length,
      released: stats.released, detonated: stats.detonated, hits: stats.hits,
      coverFactor: C.ORDNANCE_COVER_FACTOR,
      // WHICH HALVES OF THE NUKE THIS PAGE ACTUALLY GOT. Both are optional
      // reuses of shipped engine files, so both are worth being able to read
      // from the outside: a page that silently fell back to a grey drum and a
      // pooled fireball looks identical from in here otherwise.
      nuke: !!KINDS.nuke,
      nukeRadius: KINDS.nuke ? KINDS.nuke.radius : 0,
      nukeKt: KINDS.nuke && KINDS.nuke.kt != null ? KINDS.nuke.kt : null,
      nukeBody: !!(KINDS.nuke && CBZ.nukeWarhead),
      nukeFx: !!(KINDS.nuke && CBZ.cityNukeFX),
      nukes: stats.nukes,
    };
  };
})();
