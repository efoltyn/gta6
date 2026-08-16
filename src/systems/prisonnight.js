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

   THE REGISTRY ITSELF IS NOT PRISON MACHINERY and no longer lives here:
   systems/fixtures.js owns the records, the per-kind schedule, the material
   driving, the region arithmetic and the sensor curve, and this file is its
   first caller. What stays is the part that is an OPINION about a prison —
   which fittings exist and where, the six kinds and what each is worth after
   lights-out, a wing's barred openings against a room's small panes, a
   searchlight beam counting as light, and how black the yard is allowed to
   get. Any other game gets the same machine by declaring its own.

   Flags PRISON_NIGHT_V1 · PRISON_NIGHT_DARK (the rig floor) ·
   PRISON_NIGHT_REALLIGHTS (the four pooled dynamic lights).
   Ratchet: CBZ.prisonNightAudit().sightAtNoon pinned at 1 — the dark may
   never cost a sensor anything in broad daylight.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // systems/fixtures.js owns the REGISTRY, the region arithmetic and the
  // sensor curve; this file owns which fittings exist, what they answer to and
  // what a torch is worth. Tagged before us in index.html.
  if (!CBZ || typeof CBZ.onUpdate !== "function" || !CBZ.fixtures) return;
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
  // scratch for the searchlight probe below — one record, never allocated in
  // the light loop, which runs per fixture per sample
  const _p = { x: 0, y: 0, z: 0 };

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
  function inWing(x, z) { return x > CB.x0 && x < CB.x1 && z > CB.z0 && z < CB.z1; }

  /* ==========================================================
     2. THE RIG. systems/fixtures.js owns the registry, the per-kind schedule,
        the material driving, the region arithmetic ("a lamp does not shine
        through a wall": light crosses a boundary only as the fraction of sky
        that region's windows admit) and the sensor curve. THIS file owns the
        five things that are the PRISON's opinion and nobody else's:

          · the six kinds and what each is worth at lights-out;
          · the wing (barred openings, 0.55 of the sky) against a room (small
            panes, 0.35) — both driven off §4's own two levels;
          · a searchlight beam counting as light on open ground;
          · a torch throwing 15 m and the 0.40 floor a man keeps in the black;
          · how dark the shared night rig is allowed to leave the yard.

        The WING IS REGISTERED FIRST, because regions are first-hit-wins and
        the wing is the tightest claim on those coordinates. `rooms` IS the
        rig's live region array, which is how world/adminwing.js can push its
        own wing on the first tick and be lit correctly from that instant.
     ========================================================== */
  const RIG = CBZ.fixtures.rig("prison", {
    kinds: {
      //          lit day   lights-out   (dark = sun is down)
      cell:      { day: 1,    out: 0,    darkOnly: false },
      block:     { day: 1,    out: 0.10, darkOnly: false },
      room:      { day: 1,    out: 0.18, darkOnly: false },
      night:     { day: 0,    out: 0.55, darkOnly: false },  // the wing's night-lights
      flood:     { day: 1,    out: 1,    darkOnly: true },   // strikes at dusk
      perimeter: { day: 1,    out: 1,    darkOnly: true },   // never on the wing's circuit
    },
    defaultKind: "room",
    enabled: on,
    lightsOut: lightsOut,
    // an unremarkable interior: small panes, lit by §4's room level
    window: 0.35,
    ambient: function () { return roomLevel; },
    // ON OPEN GROUND A BEAM IS LIGHT. The tower sweeps are the reason crossing
    // the yard at night is a decision rather than a free pass.
    outdoor: function (x, z) {
      if (!CBZ.litBySearchlight) return 0;
      _p.x = x; _p.z = z;
      return CBZ.litBySearchlight(_p, false) ? 0.95 : 0;
    },
    minSight: 0.40,          // what a man keeps in total darkness
    torchThrow: 15,          // m — how far a hand torch usefully throws
    // how much of the shared night rig survives here (read live: a regime may
    // move it). The shared keyframes are a CITY's night — a place with street
    // lighting — and a prison yard between sweeps is darker than that.
    nightFloor: function () { return CFG.PRISON_NIGHT_DARK; },
    nightFloorOrder: 93.6,
    // the ONE bare patch the audit can trust — see the ratchet at the bottom
    probe: { x: 0, z: 55 },
  });
  const fixtures = RIG.fixtures;
  const register = RIG.register;
  const lightAt = RIG.level;

  // the cell wing: barred openings, and §4 drives its own level
  RIG.region({ id: "wing", x0: CB.x0, x1: CB.x1, z0: CB.z0, z1: CB.z1,
    window: 0.55, ambient: function () { return wingLevel; } });
  for (let i = 0; i < ROOMS.length; i++) RIG.region(ROOMS[i]);
  // a ROOM, never the wing — the published answer callers already expect
  function roomAt(x, z) {
    const r = RIG.regionAt(x, z);
    return (r && r.id !== "wing") ? r : null;
  }

  /* WHAT A SENSOR GETS: 1 in daylight, 0.40 in true dark, and all of it back
     inside a torch beam — the beam IS the light, so being in it is being lit.
     That trade is the whole night stealth loop, and it is the rig's curve so
     the camera and the guard cone cannot end up on two different ones. */
  CBZ.sightScale = RIG.scale;

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
  //      These used to be bare 34 cm bars floating at eye height down the
  //      centreline — including one directly inside the yard gate. They are
  //      now small ceiling-bolted cages beside the existing main luminaires;
  //      the light regions/pools stay at the same authored floor coordinates.
  (function wingNightLights() {
    const spots = [[0, -12], [0, -20], [0, -28], [0, -36], [-9.5, -30], [9.5, -30]];
    for (let i = 0; i < spots.length; i++) {
      const x = spots[i][0], z = spots[i][1];
      addBox(x, 8.58, z, 0.44, 0.24, 0.34, 0x3c424d, { cast: false }); // ceiling backbox
      const m = addBox(x, 8.34, z, 0.34, 0.10, 0.20, 0x2b2b2b, { cast: false });
      m.userData.mover = true;                       // keep the static batcher off it
      for (const sx of [-1, 1])
        addBox(x + sx * 0.19, 8.35, z, 0.04, 0.28, 0.25, 0x3c424d, { cast: false });
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
  const dyn = { flood: null, torch: [], built: false };
  function buildDynamic() {
    if (dyn.built || !CFG.PRISON_NIGHT_REALLIGHTS) return;
    dyn.built = true;
    // the flood pair is the rig's own pooled-point-light service: keep N lamps
    // on the lit fixtures nearest the body, because what you are standing
    // under is the only falloff you can judge.
    dyn.flood = RIG.pointPool(2, {
      parent: root, color: 0xfff0c8, distance: 26, decay: 1.4,
      radius: 44, height: 6.6, intensity: 1.15,
      filter: function (f) { return f.kind === "flood" && f.level > 0.05; },
    });
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
  /* ---- THE TORCH BECOMES LIGHT. entities/guards.js builds the prop and
       decides WHEN it is on (its own duty cycle, plus the schedule's night
       blocks); this adds what it always lacked — a visible beam in the air,
       a pool where it lands, and, for the two nearest, a real spotlight. The
       cone is parented to the flashlight group itself, so it points wherever
       the hand does and inherits the prop's own visibility. ---- */
  const TORCH_LEN = 9;
  const torchOrigin = new THREE.Vector3();
  const torchDirection = new THREE.Vector3();
  const torchQuaternion = new THREE.Quaternion();
  function torchCone(g) {
    if (g._torchCone || !g.flashlight || !g.flashlight.group) return;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 1.25, TORCH_LEN, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.075, side: THREE.DoubleSide, depthWrite: false }));
    cone.rotation.x = Math.PI / 2;                 // down the prop's own +z
    const beamZ = g.flashlight.group.userData.beamOrigin ? g.flashlight.group.userData.beamOrigin.z : 0.32;
    cone.position.z = TORCH_LEN / 2 + beamZ;
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
    const dark = 1 - RIG.sky();
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (!g.flashlightOn) { if (g._torchPool) g._torchPool.material.opacity = 0; continue; }
      torchCone(g);
      // The pool and assigned spotlight follow the ACTUAL reflector axis, not a
      // second yaw-only guess. This keeps hand, lens, volumetric cone and ground
      // contact welded together through a search pose or hit reaction.
      const fg = g.flashlight.group;
      fg.updateWorldMatrix(true, false);
      torchOrigin.copy(fg.userData.beamOrigin || { x: 0, y: 0, z: 0.32 });
      fg.localToWorld(torchOrigin);
      fg.getWorldQuaternion(torchQuaternion);
      torchDirection.set(0, 0, 1).applyQuaternion(torchQuaternion).normalize();
      let reach = 5.4;
      if (torchDirection.y < -0.035) {
        reach = Math.max(1.8, Math.min(TORCH_LEN, (0.05 - torchOrigin.y) / torchDirection.y));
      }
      const ax = torchOrigin.x + torchDirection.x * reach;
      const az = torchOrigin.z + torchDirection.z * reach;
      g._torchAim = g._torchAim || { x: 0, z: 0 };
      g._torchOrigin = g._torchOrigin || { x: 0, y: 0, z: 0 };
      g._torchAim.x = ax; g._torchAim.z = az;
      g._torchOrigin.x = torchOrigin.x; g._torchOrigin.y = torchOrigin.y; g._torchOrigin.z = torchOrigin.z;
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
      const origin = g._torchOrigin;
      slot.light.position.set(origin ? origin.x : g.group.position.x, origin ? origin.y : 1.45, origin ? origin.z : g.group.position.z);
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
     6. HOW DARK THE YARD IS ALLOWED TO GET is declared on the rig above
        (`nightFloor`), which multiplies the shared sun/hemi/bounce/fog at
        order 93.6 — after weather's lightning bump (@90) and before
        core/gfx.js's tone-map finalize (@94.5), so our result is scaled
        exactly as everyone else's is.
     ========================================================== */

  /* ==========================================================
     7. THE TICK
     ========================================================== */
  let fixT = 0;
  // driveWing() FIRST, always: it is what the wing and room regions read for
  // their own ambient, so a fixture driven before it would price itself off
  // last frame's power state.
  function driveAll() {
    driveWing();
    RIG.drive(true);                                  // fittings + the pooled floods
    assignTorchLights();
  }
  CBZ.onUpdate(21.5, function (dt) {
    if (!on()) return;
    buildDynamic();
    fixT -= dt;
    if (fixT <= 0) { fixT = 0.2; driveAll(); }
    driveTorches(dt);                                 // torches move every frame
  });
  // fixtures still obey the clock on the title screen — the prison behind the
  // menu is the same prison, and a yard whose floods pop on at "Start" is a
  // set being switched on. No pooled lights there: they follow a body that is
  // not yet playing.
  CBZ.onAlways(21.6, function (dt) {
    if (!on() || (CBZ.game && CBZ.game.state === "playing")) return;
    fixT -= dt;
    if (fixT <= 0) { fixT = 0.35; driveWing(); RIG.drive(false); }
  });

  /* ==========================================================
     8. THE CONTRACT
     ========================================================== */
  /* Every field below is the RIG's own live object, never a copy: a security
     regime that writes `kinds.night.out`, or a room pushed onto `rooms` by
     another builder, changes what the driver reads on its very next pass. */
  CBZ.prisonLights = {
    register: register,
    fixtures: fixtures,
    rooms: RIG.regions,        // the live region list — push a room and it lights
    kinds: RIG.kinds,
    level: lightAt,            // 0..1 light on a point — ask this, not the sun
    sky: RIG.sky,
    lightsOut: lightsOut,
    inWing: inWing,
    roomAt: roomAt,
    torchThrow: RIG.torchThrow,
    rig: RIG,
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
    const noon = RIG.scale(null, SX, SZ);
    CBZ.dayness = 0; CBZ.duskness = 0;
    const midnight = RIG.scale(null, SX, SZ);
    const torchLit = RIG.scale({ flashlightOn: true, group: { position: { x: SX, z: SZ } } }, SX, SZ + 4);
    CBZ.dayness = held; CBZ.duskness = heldK;
    let unknown = 0;
    for (let i = 0; i < fixtures.length; i++) if (!RIG.kinds[fixtures[i].kind]) unknown++;
    return {
      on: on(), fixtures: fixtures.length, floods: floods.length,
      rooms: ROOMS.length, regions: RIG.regions.length,
      unknownKinds: unknown,
      sightAtNoon: Math.round(noon * 1000) / 1000,          // pinned at 1
      sightAtMidnight: Math.round(midnight * 1000) / 1000,
      sightUnderTorch: Math.round(torchLit * 1000) / 1000,  // a torch buys it all back
      skyLevel: Math.round(RIG.sky() * 1000) / 1000,
      lightsOut: lightsOut(), wingLevel: wingLevel,
      dynamic: dyn.built ? (dyn.flood ? dyn.flood.lamps.length : 0) + dyn.torch.length : 0,
      torchCones: (CBZ.guards || []).filter(function (g) { return !!g._torchCone; }).length,
    };
  };
})();
