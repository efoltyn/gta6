/* ============================================================
   systems/prisonnight.js — WHAT THE DARK IS WORTH.

   A prison night that is only a blue tint is worth nothing: if a guard
   sees you at 2 a.m. exactly as well as at noon, then "night" is a colour
   grade and the whole schedule next door is decoration. This file makes
   darkness a MATERIAL FACT with three consequences, all physical:

     1. IT IS ACTUALLY DARK. Escape mode gets its own night floor on the
        shared light rig (core/lights.js keyframes hold hemisphere 0.34 at
        night — fine for a city with street lighting, far too generous for
        a yard that is supposed to be black between the searchlight sweeps).
     2. THE LIGHTS ARE ON A SCHEDULE. Cell strips die at lights-out (through
        world/cellblock.js's OWN lamp mirror, the same handle the breaker
        sabotage uses), a handful of dim wing night-lights come up, and the
        yard's flood masts strike at dusk and burn until dawn.
     3. EVERY SENSOR IS PRICED IN LIGHT. CBZ.sightScale(sensor, x, z) is the
        single hook entities/guards.js's cone math and systems/interactions.
        js's camera reach both multiply by. In the black a guard sees 40% of
        his range; under a floodlight, a searchlight beam, a lit room or the
        sun he sees all of it — and so does the lens.

   THE TORCH IS THE ANSWER TO ALL THREE, which is why it had to become real
   light rather than a yellow debug fan. A guard with his flashlight on
   RESTORES his own range inside the beam — and the beam is a cone you can
   see coming down a corridor, with a pool on the floor, so the same object
   that lets him see you is the thing that tells you where he is. That trade
   is the whole night stealth loop.

   Every fixture in the prison can join the schedule in one call:
       CBZ.prisonLights.register({ x, z, r: 9, kind: "room", mesh: lamp })
   `kind` decides when it burns; `mesh` (a PRIVATE material — CBZ.addBox
   makes one per box, never a shared cmat) is driven for free.

   Flags PRISON_NIGHT_V1 · PRISON_NIGHT_DARK (the rig floor) ·
   PRISON_NIGHT_REALLIGHTS (the four pooled dynamic lights).
   Ratchet: CBZ.prisonNightAudit().sightAtNoon pinned at 1 — the dark may
   never cost a sensor anything in broad daylight.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || typeof CBZ.onUpdate !== "function") return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.PRISON_NIGHT_V1 == null) CFG.PRISON_NIGHT_V1 = true;
  if (CFG.PRISON_NIGHT_REALLIGHTS == null) CFG.PRISON_NIGHT_REALLIGHTS = true;
  // how much of the shared night rig survives in the prison (1 = stock)
  if (CFG.PRISON_NIGHT_DARK == null) CFG.PRISON_NIGHT_DARK = 0.34;

  const root = CBZ.prisonRoot || CBZ.scene;
  const WORLD = CBZ.WORLD || { cellBlock: { x0: -16, x1: 16, z0: -44, z1: -8 } };
  const CB = WORLD.cellBlock;
  const addBox = CBZ.addBox;

  function on() { return CFG.PRISON_NIGHT_V1 !== false && CBZ.game && CBZ.game.mode === "escape"; }
  function sched() { return CBZ.prisonSchedule || null; }
  function lightsOut() { const s = sched(); return !!(s && s.lightsOut()); }
  const clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };

  /* HOW BRIGHT THE SKY IS, as a usable 0..1 rather than sin(sun). `dayness`
     is the sine of the sun's height, so it reads 0.26 at seven in the
     morning — true as geometry, wrong as light: the eye saturates within an
     hour of sunrise. x2.2 plus a slice of dusk is the honest curve. */
  function dayLevel() {
    const d = CBZ.dayness == null ? 1 : CBZ.dayness;
    const k = CBZ.duskness || 0;
    return clamp01(d * 2.2 + k * 0.25);
  }

  /* ==========================================================
     1. THE ROOMS. There is no room registry in this engine — every prison
        interior is a roomShell(cfg) call in its own world file — so the
        eight shells are listed here as the light REGIONS they are. A body
        inside one is lit by that room's fittings, not by the sky.
     ========================================================== */
  const ROOMS = [
    { id: "mess",      x0: -29, x1: -19, z0: 6,   z1: 22 },   // world/cafeteria.js
    { id: "lounge",    x0: 19,  x1: 29,  z0: 30,  z1: 44 },   // world/lounge.js
    { id: "armory",    x0: 19,  x1: 29,  z0: -6,  z1: 8 },    // world/gunroom.js
    { id: "workshop",  x0: -42, x1: -24, z0: 58,  z1: 80 },   // world/southblock.js
    { id: "chapel",    x0: 24,  x1: 42,  z0: 58,  z1: 80 },
    { id: "infirmary", x0: 26,  x1: 42,  z0: 88,  z1: 104 },
    { id: "laundry",   x0: -42, x1: -26, z0: 88,  z1: 104 },
    { id: "gatehouse", x0: -22, x1: -14, z0: 116, z1: 124 },
  ];
  function roomAt(x, z) {
    for (let i = 0; i < ROOMS.length; i++) {
      const r = ROOMS[i];
      if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return r;
    }
    return null;
  }
  function inWing(x, z) { return x > CB.x0 && x < CB.x1 && z > CB.z0 && z < CB.z1; }

  /* ==========================================================
     2. THE FIXTURE REGISTRY. One record per light, one `kind` per schedule
        behaviour. `level` is written by the driver below and read by
        lightAt(); a registered `mesh` is driven with it so a fixture that
        joins never has to write its own updater.
     ========================================================== */
  const LEVELS = {
    //          lit day   lights-out   (dark = sun is down)
    cell:      { day: 1,    out: 0,    darkOnly: false },
    block:     { day: 1,    out: 0.10, darkOnly: false },
    room:      { day: 1,    out: 0.18, darkOnly: false },
    night:     { day: 0,    out: 0.55, darkOnly: false },  // the wing's night-lights
    flood:     { day: 1,    out: 1,    darkOnly: true },   // strikes at dusk
    perimeter: { day: 1,    out: 1,    darkOnly: true },   // never on the wing's circuit
  };
  const fixtures = [];
  function register(rec) {
    if (!rec) return null;
    rec.kind = LEVELS[rec.kind] ? rec.kind : "room";
    rec.r = rec.r > 0 ? rec.r : 8;
    rec.level = 0;
    rec.color = rec.color != null ? rec.color : 0xffe9a8;
    rec.emissive = rec.emissive != null ? rec.emissive : 0xffcf66;
    rec.off = rec.off != null ? rec.off : 0x2b2b2b;
    fixtures.push(rec);
    return rec;
  }
  function driveFixture(rec, dark) {
    const L = LEVELS[rec.kind];
    let v = lightsOut() ? L.out : L.day;
    if (L.darkOnly) v *= dark;                     // a flood by day is off
    if (rec.on && !rec.on()) v = 0;
    if (rec.powered === false) v = 0;
    rec.level = v;
    const m = rec.mesh && rec.mesh.material;
    if (!m) return;
    const lit = v > 0.02;
    if (m.color) m.color.setHex(lit ? rec.color : rec.off);
    if (m.emissive) m.emissive.setHex(lit ? rec.emissive : 0x000000);
    if (lit && m.emissiveIntensity != null) m.emissiveIntensity = 0.35 + v * 0.75;
    if (rec.pool) rec.pool.material.opacity = v * (rec.poolPeak || 0.3);
    if (rec.beam) rec.beam.material.opacity = v * (rec.beamPeak || 0.09);
  }

  /* ---- how much light is on a point. The one function every sensor and
       every later phase should ask instead of testing the sun itself. ---- */
  const _p = { x: 0, y: 0, z: 0 };
  function lightAt(x, z) {
    const sky = dayLevel();
    let L;
    if (inWing(x, z)) L = Math.max(wingLevel, sky * 0.55);      // barred windows
    else if (roomAt(x, z)) L = Math.max(roomLevel, sky * 0.35); // small windows
    else {
      L = sky;
      if (L < 0.9 && CBZ.litBySearchlight) {
        _p.x = x; _p.z = z;
        if (CBZ.litBySearchlight(_p, false)) L = 0.95;          // caught in a beam
      }
    }
    if (L >= 0.98) return 1;
    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i];
      if (f.level <= 0.02) continue;
      const dx = x - f.x, dz = z - f.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > f.r * f.r) continue;
      const fall = 1 - Math.sqrt(d2) / f.r;
      const v = f.level * (0.35 + fall * 0.65);
      if (v > L) L = v;
      if (L >= 0.98) return 1;
    }
    return L;
  }

  /* ==========================================================
     3. WHAT A SENSOR GETS. MIN is the floor: even in true black a man
        still sees a body at arm's length, and a prison guard is not blind.
        A torch is the exception that restores the whole range — the beam
        is the light, so being IN it is being lit.
     ========================================================== */
  const MIN = 0.40;          // fraction of range that survives total darkness
  const TORCH = 15;          // m — how far a hand torch usefully throws
  const TORCH2 = TORCH * TORCH;
  function sightScale(sensor, x, z) {
    if (!on()) return 1;
    let L = lightAt(x, z);
    if (L < 0.95 && sensor && sensor.flashlightOn && sensor.group) {
      const dx = x - sensor.group.position.x, dz = z - sensor.group.position.z;
      if (dx * dx + dz * dz < TORCH2) L = 0.95;
    }
    if (L >= 0.95) return 1;
    return MIN + (1 - MIN) * clamp01(L * 1.5);
  }
  CBZ.sightScale = sightScale;

  /* ==========================================================
     4. THE FIXTURES THEMSELVES.
     ========================================================== */
  // ---- the cell wing. cellblock.js already MIRRORS every lamp in the wing
  //      off CBZ.ceilingLamp's material (that is how the breaker sabotage
  //      takes the block dark), so the schedule drives the same one handle
  //      and nineteen fixtures follow. Never fight a live sabotage: a power
  //      cut outranks a timetable.
  let wingLevel = 1, roomLevel = 1;
  let wingWant = -1;
  function driveWing() {
    const lamp = CBZ.ceilingLamp;
    const cut = !!(CBZ.breaker && CBZ.breaker.sabotaged);
    wingLevel = cut ? 0 : (lightsOut() ? 0.10 : 1);
    roomLevel = cut ? 0 : (lightsOut() ? 0.18 : 1);
    if (!lamp || cut) { wingWant = -1; return; }
    const want = lightsOut() ? 0 : 1;
    if (want === wingWant) return;
    wingWant = want;
    lamp.material.color.setHex(want ? 0xffe9a8 : 0x2b2b2b);
    lamp.material.emissive.setHex(want ? 0xffcf66 : 0x000000);
  }

  // ---- the wing's NIGHT LIGHTS. A real block is not pitch black at 3 a.m.:
  //      low blue-white fittings burn all night so staff can walk the tier.
  //      They are what keeps lights-out playable instead of a black screen,
  //      and they are dim enough that a body two cells away is a shape.
  (function wingNightLights() {
    const spots = [[0, -12], [0, -20], [0, -28], [0, -36], [-9.5, -30], [9.5, -30]];
    for (let i = 0; i < spots.length; i++) {
      const x = spots[i][0], z = spots[i][1];
      const m = addBox(x, 2.55, z, 0.34, 0.10, 0.16, 0x2b2b2b, { cast: false });
      m.userData.mover = true;                       // keep the static batcher off it
      const pool = new THREE.Mesh(new THREE.CircleGeometry(2.6, 14),
        new THREE.MeshBasicMaterial({ color: 0xbcd8ff, transparent: true, opacity: 0, depthWrite: false }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.05, z);
      root.add(pool);
      register({ x: x, z: z, r: 6.5, kind: "night", mesh: m, pool: pool, poolPeak: 0.16,
        color: 0xdbe9ff, emissive: 0x7fa8d8, off: 0x2b2b2b });
    }
  })();

  // ---- YARD FLOOD MASTS. Eight of them, clear of every room shell and of
  //      the patrol lanes. They strike as the sun goes down and burn until
  //      it comes up: this is the light that makes crossing the open yard
  //      at night a decision rather than a free pass.
  const floods = [];
  function floodMast(x, z) {
    addBox(x, 3.5, z, 0.36, 7, 0.36, 0x6b7480, { solid: true });                   // pole
    addBox(x, 7.02, z, 1.10, 0.18, 0.55, 0x515a66, { cast: false });               // bracket
    const head = addBox(x, 6.86, z, 0.90, 0.16, 0.42, 0x2b2b2b, { cast: false });  // the lamp itself
    head.userData.mover = true;
    const pool = new THREE.Mesh(new THREE.CircleGeometry(9, 22),
      new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, 0.045, z);
    root.add(pool);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 8.4, 6.9, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.set(x, 3.42, z);
    root.add(beam);
    const rec = register({ x: x, z: z, r: 13, kind: "flood", mesh: head, pool: pool, poolPeak: 0.26,
      beam: beam, beamPeak: 0.07, color: 0xfff4d2, emissive: 0xffd88a, off: 0x2b2b2b });
    floods.push(rec);
  }
  floodMast(-28, 44); floodMast(28, 44); floodMast(-15, 1); floodMast(15, 1);
  floodMast(-21, 66); floodMast(21, 66); floodMast(-21, 110); floodMast(21, 110);

  /* ==========================================================
     5. FOUR REAL LIGHTS, POOLED. r128 evaluates Lambert per VERTEX, so a
        light is cheap but not free, and the searchlights already spend four
        SpotLights. Rather than one per fixture we keep two PointLights that
        follow the flood masts NEAREST THE PLAYER and two SpotLights that
        follow the torches nearest the player: what you are standing under
        is the only light whose falloff you can actually judge.
     ========================================================== */
  const dyn = { flood: [], torch: [], built: false };
  function buildDynamic() {
    if (dyn.built || !CFG.PRISON_NIGHT_REALLIGHTS) return;
    dyn.built = true;
    for (let i = 0; i < 2; i++) {
      const p = new THREE.PointLight(0xfff0c8, 0, 26, 1.4);
      p.visible = false;
      root.add(p);
      dyn.flood.push(p);
    }
    for (let i = 0; i < 2; i++) {
      const s = new THREE.SpotLight(0xdff2ff, 0, 22, 0.42, 0.55, 1.1);
      s.visible = false;
      const t = new THREE.Object3D();
      t.userData.mover = true;
      root.add(t); root.add(s);
      s.target = t;
      dyn.torch.push({ light: s, target: t });
    }
  }
  function nearestN(list, n, px, pz, getX, getZ, ok) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (ok && !ok(it)) continue;
      const dx = getX(it) - px, dz = getZ(it) - pz;
      out.push({ it: it, d: dx * dx + dz * dz });
    }
    out.sort(function (a, b) { return a.d - b.d; });
    return out.slice(0, n);
  }
  function driveDynamic() {
    if (!dyn.built) return;
    const p = CBZ.player && CBZ.player.pos;
    if (!p) return;
    const near = nearestN(floods, dyn.flood.length, p.x, p.z,
      function (f) { return f.x; }, function (f) { return f.z; },
      function (f) { return f.level > 0.05; });
    for (let i = 0; i < dyn.flood.length; i++) {
      const L = dyn.flood[i], pick = near[i];
      if (!pick || pick.d > 44 * 44) { L.visible = false; L.intensity = 0; continue; }
      L.visible = true;
      L.position.set(pick.it.x, 6.6, pick.it.z);
      L.intensity = 1.15 * pick.it.level;
    }
  }

  /* ---- THE TORCH BECOMES LIGHT. entities/guards.js builds the prop and
       decides WHEN it is on (its own duty cycle, plus the schedule's night
       blocks); this adds what it always lacked — a visible beam in the air,
       a pool where it lands, and, for the two nearest, a real spotlight. The
       cone is parented to the flashlight group itself, so it points wherever
       the hand does and inherits the prop's own visibility. ---- */
  const TORCH_LEN = 9;
  function torchCone(g) {
    if (g._torchCone || !g.flashlight || !g.flashlight.group) return;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 1.25, TORCH_LEN, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.075, side: THREE.DoubleSide, depthWrite: false }));
    cone.rotation.x = Math.PI / 2;                 // down the prop's own +z
    cone.position.z = TORCH_LEN / 2 + 0.32;
    cone.userData.mover = true;
    g.flashlight.group.add(cone);
    g._torchCone = cone;
    const pool = new THREE.Mesh(new THREE.CircleGeometry(2.9, 16),
      new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.05;
    pool.userData.mover = true;
    root.add(pool);
    g._torchPool = pool;
  }
  // every frame: the beam, the pool and where the assigned lamp is pointing
  function driveTorches(dt) {
    const list = CBZ.guards || [];
    const dark = 1 - dayLevel();
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (!g.flashlightOn) { if (g._torchPool) g._torchPool.material.opacity = 0; continue; }
      torchCone(g);
      const yaw = g.group.rotation.y;
      const ax = g.group.position.x + Math.sin(yaw) * 5.4;
      const az = g.group.position.z + Math.cos(yaw) * 5.4;
      g._torchAim = g._torchAim || { x: 0, z: 0 };
      g._torchAim.x = ax; g._torchAim.z = az;
      if (g._torchPool) {
        g._torchPool.position.set(ax, 0.05, az);
        g._torchPool.material.opacity = 0.10 + dark * 0.20;
      }
      if (g._torchCone) g._torchCone.material.opacity = 0.03 + dark * 0.075;
    }
    if (!dyn.built) return;
    for (let i = 0; i < dyn.torch.length; i++) {
      const slot = dyn.torch[i], g = slot.guard;
      if (!g || !g.flashlightOn || g.dead) { slot.light.visible = false; slot.light.intensity = 0; continue; }
      slot.light.visible = true;
      slot.light.position.set(g.group.position.x, 1.45, g.group.position.z);
      slot.target.position.set(g._torchAim.x, 0, g._torchAim.z);
      slot.light.intensity = 0.6 + dark * 1.5;
    }
  }
  // …and at 5 Hz, WHICH torches get one of the two real lamps. Re-picking
  // every frame would allocate a sort per frame for a decision that changes
  // when somebody walks a few metres.
  function assignTorchLights() {
    if (!dyn.built) return;
    const p = CBZ.player && CBZ.player.pos;
    if (!p) return;
    const near = nearestN(CBZ.guards || [], dyn.torch.length, p.x, p.z,
      function (g) { return g.group.position.x; }, function (g) { return g.group.position.z; },
      function (g) { return g.flashlightOn && !g.dead; });
    for (let i = 0; i < dyn.torch.length; i++) {
      const pick = near[i];
      dyn.torch[i].guard = (pick && pick.d < 46 * 46) ? pick.it : null;
    }
  }

  /* ==========================================================
     6. THE RIG. The shared night keyframes are a CITY's night — a place
        with street lighting. A prison yard between sweeps is darker than
        that on purpose, and this is the only place that opinion is stated.
        Multiplied at 93.6, i.e. after weather's lightning bump (@90) and
        before core/gfx.js's tone-map finalize (@94.5), which then scales
        our result exactly as it scales everyone else's.
     ========================================================== */
  CBZ.onAlways(93.6, function () {
    if (!on()) return;
    const night = 1 - dayLevel();
    if (night <= 0.002) return;
    const floor = CFG.PRISON_NIGHT_DARK;
    const f = 1 - night * (1 - floor);
    if (CBZ.sun) CBZ.sun.intensity *= f;
    if (CBZ.hemi) {
      CBZ.hemi.intensity *= f;
      // ...and take the colour with it: an ambient that stays bright blue
      // while its intensity falls just reads as "everything is teal".
      CBZ.hemi.color.multiplyScalar(0.55 + 0.45 * (1 - night));
      CBZ.hemi.groundColor.multiplyScalar(0.5 + 0.5 * (1 - night));
    }
    if (CBZ.bounce) CBZ.bounce.intensity *= f;
    // fog too, or the horizon glows brighter than the ground under it
    // (core/sky.js @99 repaints its horizon stop off the FINAL fog colour,
    // so darkening here keeps the dome seam closed).
    if (CBZ.scene && CBZ.scene.fog) CBZ.scene.fog.color.multiplyScalar(1 - night * 0.5);
  });

  /* ==========================================================
     7. THE TICK
     ========================================================== */
  let fixT = 0;
  function driveAll(dt) {
    driveWing();
    const dark = clamp01(1 - dayLevel() * 1.7);      // floods strike before full dark
    for (let i = 0; i < fixtures.length; i++) driveFixture(fixtures[i], dark);
    driveDynamic();
    assignTorchLights();
  }
  CBZ.onUpdate(21.5, function (dt) {
    if (!on()) return;
    buildDynamic();
    fixT -= dt;
    if (fixT <= 0) { fixT = 0.2; driveAll(dt); }
    driveTorches(dt);                                 // torches move every frame
  });
  // fixtures still obey the clock on the title screen — the prison behind the
  // menu is the same prison, and a yard whose floods pop on at "Start" is a
  // set being switched on.
  CBZ.onAlways(21.6, function (dt) {
    if (!on() || (CBZ.game && CBZ.game.state === "playing")) return;
    fixT -= dt;
    if (fixT <= 0) { fixT = 0.35; driveWing(); const dark = clamp01(1 - dayLevel() * 1.7);
      for (let i = 0; i < fixtures.length; i++) driveFixture(fixtures[i], dark); }
  });

  /* ==========================================================
     8. THE CONTRACT
     ========================================================== */
  CBZ.prisonLights = {
    register: register,
    fixtures: fixtures,
    rooms: ROOMS,
    kinds: LEVELS,
    level: lightAt,            // 0..1 light on a point — ask this, not the sun
    sky: dayLevel,
    lightsOut: lightsOut,
    inWing: inWing,
    roomAt: roomAt,
    torchThrow: TORCH,
  };

  /* THE RATCHET. `sightAtNoon` is pinned at 1: whatever the night costs a
     sensor, broad daylight must cost it nothing, or this file has quietly
     nerfed the whole detection game. `floors` counts fixtures whose kind has
     no schedule entry (impossible by construction — register() coerces —
     and therefore 0 forever). */
  CBZ.prisonNightAudit = function () {
    // (0,55) is the ONE bare patch the measurement can trust: the throat
    // between the two yards, outside every room shell, more than a flood
    // mast's radius from all eight, and — the trap the first draft fell into
    // — outside the sweep of all four searchlight pools, whose beams roam the
    // whole of both yards and were reading "midnight" as fully lit.
    const SX = 0, SZ = 55;
    const held = CBZ.dayness, heldK = CBZ.duskness;
    CBZ.dayness = 1; CBZ.duskness = 0;
    const noon = sightScale(null, SX, SZ);
    CBZ.dayness = 0; CBZ.duskness = 0;
    const midnight = sightScale(null, SX, SZ);
    const torchLit = sightScale({ flashlightOn: true, group: { position: { x: SX, z: SZ } } }, SX, SZ + 4);
    CBZ.dayness = held; CBZ.duskness = heldK;
    let unknown = 0;
    for (let i = 0; i < fixtures.length; i++) if (!LEVELS[fixtures[i].kind]) unknown++;
    return {
      on: on(), fixtures: fixtures.length, floods: floods.length, rooms: ROOMS.length,
      unknownKinds: unknown,
      sightAtNoon: Math.round(noon * 1000) / 1000,          // pinned at 1
      sightAtMidnight: Math.round(midnight * 1000) / 1000,
      sightUnderTorch: Math.round(torchLit * 1000) / 1000,  // a torch buys it all back
      skyLevel: Math.round(dayLevel() * 1000) / 1000,
      lightsOut: lightsOut(), wingLevel: wingLevel,
      dynamic: dyn.built ? dyn.flood.length + dyn.torch.length : 0,
      torchCones: (CBZ.guards || []).filter(function (g) { return !!g._torchCone; }).length,
    };
  };
})();
