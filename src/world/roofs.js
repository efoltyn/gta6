/* ============================================================
   world/roofs.js — THE PRISON GETS A LID.

   OWNER: you could stand in the middle of the mess hall, look up, and
   watch the crows. Every interior in this compound was open-topped —
   CBZ.roomShell (world/roombuild.js:77) builds a floor and four walls and
   has never built a ceiling, and the "roof" you could see was PD.beam:
   decorative joists spanning open air, with its own comment admitting it
   ("NO LID: the rooms are open-topped so the follow camera can see in").
   The only real ceiling in the game was the per-cell slab.

   SKY IS A YARD THING. A roofed room is the whole difference between a
   building and a stage set, and it is the difference the towers, the
   searchlights (and, until 2026-09-27, four box crows at y 18-25) make
   visible from inside every room in the prison.

   ---- WHY THE CAMERA IS NO LONGER AN ARGUMENT --------------------------
   The open tops were a 2024-era camera workaround. systems/camera.js has
   since grown both halves of the answer and MEASURED them against this
   very building: CAM_ROOM_BOOM (:617) probes ceiling AND span 12x/s and
   damps the boom in through a doorway, and CAM_TIGHT_FP (:706) hands the
   view to first person in a space too small for a boom — which is why you
   can already stand in a cell, under the one lid that existed, and see.
   A 10 m room with a 6 m ceiling probes wide open: at the shipped 6.5 m
   boom and 0.46 rad rest pitch the lens sits ~4.7 m up, comfortably under
   every lid this file lays.

   ---- WHY A LID IS NOT A COLLIDER --------------------------------------
   Every ceiling here is `solid:false, blockLOS:true` — the exact contract
   world/cellblock.js:368's cell slab and world/southblock.js's guard-hut
   roof already use, and it is not laziness:
     · systems/actorcollide.js clamps every guard and inmate with
       CBZ.collide(pos, r) — no feet/head — and physics.js treats a
       collider with no vertical span as FULL HEIGHT for such a caller. A
       solid lid would therefore wall every NPC out of the room under it.
     · CBZ.platforms is skipped outright in escape mode (physics.js
       groundAt), so nothing could stand on a prison roof anyway.
     · The camera's ceiling probe falls through to CBZ.losBlockers when the
       collider sweep finds nothing (camera.js:675), so a blockLOS lid is
       seen as a ceiling by the boom, by city/death.js's isIndoors and by
       systems/weather.js's testIndoors, for free.
   `cast:false` too: core/lights.js's shadow frustum is a 70 m half-box
   around (0,0,18), so a south-block roof could not cast into it anyway,
   and half-shadowed interiors would be worse than none.

   ---- A ROOFED ROOM WITHOUT LIGHT IS A CAVE ----------------------------
   So the second half of this file is the fittings, and they are not new
   geometry: CBZ.prisonDress.strip / .lamp draw the prison's own
   fluorescent and caged fittings, and (this wave) QUEUE every emissive
   mesh they draw. This file flushes that queue into
   CBZ.prisonLights.register (systems/prisonnight.js), so the thirty-odd
   fittings already standing in the cafeteria, the dayroom and the south
   block join the timetable at the same moment the new ceiling fittings do
   — lit through the working day, dead at lights-out, dark under a breaker
   sabotage. Nobody had to edit those files, and nothing prints.

   Flags PRISON_ROOFS_V1 (the lids) · PRISON_ROOF_LIGHTS (the fittings).
   Ratchet: CBZ.prisonRoofAudit().uncovered — indoor rooms with no ceiling
   — pinned at 0, and .unlit — roofed rooms with no scheduled fitting —
   pinned at 0 with it.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // This file's CONFIG defaults are published at parse: other files read
  // them before (or without) the prison ever being built.
  if (CBZ.CONFIG.PRISON_ROOFS_V1 == null) CBZ.CONFIG.PRISON_ROOFS_V1 = true;
  if (CBZ.CONFIG.PRISON_ROOF_LIGHTS == null) CBZ.CONFIG.PRISON_ROOF_LIGHTS = true;
  // Built when the prison is first needed, as if at this script's parse
  // point (core/prisonlazy.js). Body left at its old indent.
  CBZ.definePrison("world/roofs.js", function () {
  if (!CBZ || !CBZ.addBox) return;
  const { addBox } = CBZ;
  const WORLD = CBZ.WORLD || {};
  const PD = CBZ.prisonDress || null;
  const KIT = CBZ.prisonKit || null;

  CBZ.CONFIG = CBZ.CONFIG || {};
  const ON = CBZ.CONFIG.PRISON_ROOFS_V1 !== false;
  const LIT = CBZ.CONFIG.PRISON_ROOF_LIGHTS !== false;

  const T = 0.30;               // slab thickness (the cell roof's own RT)
  const C_SOFFIT = 0x6a727d;    // cellblock.js C_ROOF — the ceiling colour the
                                // prison already has, so a lid never reads new
  const C_DECK = 0x59616b;      // weathered felt/asphalt seen from a tower
  const C_KERB = 0x4a525c;

  const laid = [];              // every lid, for the audit

  /* ==========================================================
     1. CBZ.prisonRoof(cfg) — ONE LID.
        cfg { x0,x1,z0,z1, top, over, id, deck, soffit, plant }
          top    the wall top this slab sits ON (slab spans top..top+T)
          over   how far the slab oversails the declared rect each side
                 (roomShell centres 0.5 m walls on x0/x1, so 0.25 closes it;
                  the cell wing's walls are 1.0 thick, so 0.5)
          plant  false = a bare deck (a hut), else a rooftop unit + stack
     ========================================================== */
  function prisonRoof(cfg) {
    if (!ON || !cfg) return null;
    const over = cfg.over != null ? cfg.over : 0.25;
    const x0 = Math.min(cfg.x0, cfg.x1) - over, x1 = Math.max(cfg.x0, cfg.x1) + over;
    const z0 = Math.min(cfg.z0, cfg.z1) - over, z1 = Math.max(cfg.z0, cfg.z1) + over;
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const top = cfg.top != null ? cfg.top : 6;
    // THE SLAB. Not solid, blocks LOS — see the header for why that is the
    // whole contract and not a shortcut.
    /* `cast` is opt-in per room, and the wing opts in (2026-09-04, owner:
       "there's weird things on the floor rn I don't understand"). What he
       was looking at was the SUN — through this slab — painting the shadows
       of the compound's towers, plant and wall tops onto the floor of a
       building that has a roof: rings and bands of shadow walking across
       the tier from nothing anyone could see. A cell already sits in the
       shade of its own casting slab, so a casting deck simply extends that
       to the hall, which is what a roof does. The header's frustum worry
       is real for the south block only: the sun's ortho box is 110-190 m
       (core/quality.js) around (0,0,18) and the wing sits wholly inside it. */
    const slab = addBox(cx, top + T / 2, cz, w, T, d,
      cfg.deck != null ? cfg.deck : C_DECK, { solid: false, cast: !!cfg.cast, blockLOS: true });
    if (KIT) KIT.skinBox(slab, "concrete", cfg.deck != null ? cfg.deck : C_DECK);
    // The underside is what you are standing under, and a roof deck colour
    // read from below is the wrong colour. One thin plate, 4 cm proud.
    // (skipped when the room below has its own finished ceiling: nobody sees it)
    if (cfg.soffit !== false) {
      const sof = addBox(cx, top - 0.02, cz, w - 0.1, 0.06, d - 0.1,
        cfg.soffit != null ? cfg.soffit : C_SOFFIT, { cast: false, receive: false });
      if (KIT) KIT.skinBox(sof, "concrete", cfg.soffit != null ? cfg.soffit : C_SOFFIT);
    }
    // parapet kerb with a pressed-steel coping: the silhouette a tower guard
    // sees, and the thing that stops a flat slab reading as a lid on a box
    const K = 0.34, ky = top + T + K / 2;
    if (KIT) {
      const kerb = KIT.skin("concrete", C_KERB), cope = KIT.skin("galv", 0x9aa1a8);
      KIT.stat(new THREE.BoxGeometry(w, K, 0.32), kerb, cx, ky, z0 + 0.16, { cast: false, uv: 2 });
      KIT.stat(new THREE.BoxGeometry(w, K, 0.32), kerb, cx, ky, z1 - 0.16, { cast: false, uv: 2 });
      KIT.stat(new THREE.BoxGeometry(0.32, K, d - 0.64), kerb, x0 + 0.16, ky, cz, { cast: false, uv: 2 });
      KIT.stat(new THREE.BoxGeometry(0.32, K, d - 0.64), kerb, x1 - 0.16, ky, cz, { cast: false, uv: 2 });
      KIT.stat(new THREE.BoxGeometry(w + 0.04, 0.03, 0.38), cope, cx, ky + K / 2 + 0.015, z0 + 0.16, { cast: false });
      KIT.stat(new THREE.BoxGeometry(w + 0.04, 0.03, 0.38), cope, cx, ky + K / 2 + 0.015, z1 - 0.16, { cast: false });
      KIT.stat(new THREE.BoxGeometry(0.38, 0.03, d - 0.7), cope, x0 + 0.16, ky + K / 2 + 0.015, cz, { cast: false });
      KIT.stat(new THREE.BoxGeometry(0.38, 0.03, d - 0.7), cope, x1 - 0.16, ky + K / 2 + 0.015, cz, { cast: false });
    } else {
      addBox(cx, ky, z0 + 0.16, w, K, 0.32, C_KERB, { cast: false });
      addBox(cx, ky, z1 - 0.16, w, K, 0.32, C_KERB, { cast: false });
      addBox(x0 + 0.16, ky, cz, 0.32, K, d, C_KERB, { cast: false });
      addBox(x1 - 0.16, ky, cz, 0.32, K, d, C_KERB, { cast: false });
    }
    if (cfg.plant !== false && KIT) plant(cx + w * 0.22, cz - d * 0.18, cx - w * 0.26, cz + d * 0.24, top + T);
    const rec = { id: cfg.id || "room", x0: x0, x1: x1, z0: z0, z1: z1, top: top, mesh: slab, lights: 0 };
    laid.push(rec);
    return rec;
  }
  CBZ.prisonRoof = prisonRoof;
  CBZ.prisonRoofs = laid;       // read-only: where a searchlight pool lands on a roof (entities/searchlight.js)
  CBZ.prisonRoofT = T;

  /* ROOFTOP PLANT. It was a 2.2 x 1.1 x 1.6 grey box with a lid, and a 55 cm
     square post with a cap: two boxes, seen from every tower. Now a packaged
     air handler on its roof curb (a louvred intake face, an access door with
     two handles, twin condenser fans in guarded shrouds on the top) and a
     round galvanised extract stack with a conical rain cap on three stays. */
  function plant(px, pz, sx, sz, deck) {
    const casing = KIT.skin("steel", 0xb9bec2), dark = KIT.skin("steel", 0x2b2f34, 0.6);
    const galv = KIT.skin("galv", 0xb4bcc4), curb = KIT.skin("galv", 0x8e959c);
    const louvre = KIT.skin("roller", 0x9aa0a6), guard = KIT.skin("grating", 0x3a3f45);
    KIT.stat(new THREE.BoxGeometry(2.3, 0.2, 1.7), curb, px, deck + 0.1, pz, { cast: false });
    KIT.stat(new THREE.BoxGeometry(2.2, 1.0, 1.6), casing, px, deck + 0.7, pz, {});
    KIT.stat(new THREE.BoxGeometry(2.24, 0.05, 1.64), dark, px, deck + 1.215, pz, { cast: false });        // drip edge
    KIT.stat(new THREE.BoxGeometry(0.9, 0.7, 0.01), louvre, px - 0.5, deck + 0.7, pz + 0.805, { cast: false });   // intake
    KIT.stat(new THREE.BoxGeometry(0.7, 0.8, 0.01), casing, px + 0.55, deck + 0.7, pz + 0.806, { cast: false });  // access door
    for (const hy of [0.45, 0.95]) KIT.stat(new THREE.BoxGeometry(0.03, 0.1, 0.03), dark, px + 0.82, deck + hy, pz + 0.82, { cast: false });
    for (const s of [-1, 1]) {
      KIT.stat(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 20, 1, true), dark, px + s * 0.52, deck + 1.31, pz, { cast: false });
      KIT.stat(new THREE.CircleGeometry(0.42, 20), guard, px + s * 0.52, deck + 1.37, pz, { rx: -Math.PI / 2, cast: false });
      KIT.stat(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), dark, px + s * 0.52, deck + 1.38, pz, { cast: false });   // fan hub
    }
    // extract stack
    KIT.stat(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 16), curb, sx, deck + 0.06, sz, { cast: false });
    KIT.stat(new THREE.CylinderGeometry(0.16, 0.16, 1.3, 14), galv, sx, deck + 0.77, sz, {});
    KIT.stat(new THREE.ConeGeometry(0.3, 0.18, 16), galv, sx, deck + 1.66, sz, { cast: false });
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      KIT.tube(sx + Math.cos(a) * 0.15, deck + 1.36, sz + Math.sin(a) * 0.15, sx + Math.cos(a) * 0.2, deck + 1.6, sz + Math.sin(a) * 0.2, 0.008, galv, { cast: false });
    }
  }

  /* ==========================================================
     2. THE ROOMS. Rect comes from the room's OWN shell record when it
        registered one (CBZ.prisonShells, world/cafeteria.js:143) so a room
        that moves takes its ceiling with it; the typed rect is the fallback
        for the two interiors that never registered — the cell wing (its
        bounds have always lived in CBZ.WORLD) and the gun room.
     ========================================================== */
  function shell(id) {
    const list = CBZ.prisonShells || [];
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }
  function rect(id, x0, x1, z0, z1, h) {
    const s = shell(id);
    if (s && isFinite(+s.x0)) return { x0: +s.x0, x1: +s.x1, z0: +s.z0, z1: +s.z1, h: +s.h || h };
    return { x0: x0, x1: x1, z0: z0, z1: z1, h: h };
  }
  const CB = WORLD.cellBlock || { x0: -16, x1: 16, z0: -44, z1: -8 };
  const WH = (CBZ.DIM && CBZ.DIM.WH) || 9;

  const ROOMS = [
    // the cell wing: 1.0 m walls, so the slab oversails 0.5 to close the top
    { id: "wing", r: { x0: CB.x0, x1: CB.x1, z0: CB.z0, z1: CB.z1, h: WH }, over: 0.5, lights: 0,
      deck: 0x515a66, cast: true },
    { id: "cafeteria", r: rect("cafeteria", -29, -19, 6, 22, 6), lights: 4 },
    { id: "lounge",    r: rect("lounge", 19, 29, 30, 44, 6), lights: 3 },
    // the gun room never registered a shell (world/gunroom.js draws its own
    // facade), so this is the one typed rect that has to match by hand.
    { id: "armory",    r: { x0: 19, x1: 29, z0: -6, z1: 8, h: 6 }, lights: 3 },
    { id: "workshop",  r: rect("workshop", -42, -24, 58, 80, 6), lights: 5 },
    { id: "chapel",    r: rect("chapel", 24, 42, 58, 80, 6.5), lights: 4, deck: 0x8a7f6a },
    { id: "infirmary", r: rect("infirmary", 26, 42, 88, 104, 6), lights: 4 },
    { id: "laundry",   r: rect("laundry", -42, -26, 88, 104, 6), lights: 4 },
    { id: "south-dorm", r: rect("south-dorm", -42, -24, 106, 124, 6), lights: 4 },
    // the sally-port booth ALREADY had a roof (world/southblock.js draws its
    // own slab at y 3.4). It gets a fitting and a light region, never a
    // second lid — two roofs on one hut is z-fighting, not architecture.
    { id: "gatehouse", r: { x0: -22, x1: -14, z0: 116, z1: 124, h: 3.2 }, lights: 1, roofed: true },
  ];

  /* ---- the fittings. PD.strip IS the prison's fluorescent; calling it is
       also how the fitting joins the schedule (world/cafeteria.js queues
       every emissive mesh the kit draws and §4 below flushes the queue). ---- */
  function fitOut(room, top) {
    if (!LIT || !PD || typeof PD.strip !== "function") return 0;
    const n = room.lights | 0;
    if (n <= 0) return 0;
    const R = room.r;
    const w = R.x1 - R.x0, d = R.z1 - R.z0;
    const along = w >= d ? "x" : "z";           // a fitting runs the long way
    const y = top - 0.42;                        // hung just under the slab
    const len = Math.max(1.6, Math.min(4.2, (along === "x" ? w : d) * 0.42));
    // Two rows when the room is wide enough to need them, one down the middle
    // when it is not. Positions are derived from the rect, never typed, so a
    // room that moves relights itself.
    const rows = (along === "x" ? d : w) > 11 ? 2 : 1;
    const per = Math.max(1, Math.ceil(n / rows));
    let made = 0;
    for (let rI = 0; rI < rows; rI++) {
      const t = rows === 1 ? 0.5 : (rI + 1) / (rows + 1);
      for (let i = 0; i < per && made < n; i++) {
        const u = (i + 1) / (per + 1);
        const x = along === "x" ? R.x0 + u * w : R.x0 + t * w;
        const z = along === "x" ? R.z0 + t * d : R.z0 + u * d;
        PD.strip(x, y, z, len, along);
        made++;
      }
    }
    return made;
  }

  // A room that laid its own finished ceiling (CBZ.prisonDress.ceiling: a
  // real height, real fittings) is not re-lit from up here — fluorescent
  // sticks hung under the roof slab would be ABOVE its ceiling, in the void.
  function ownCeiling(id) {
    const list = (PD && PD.ceilings) || [];
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  for (let i = 0; i < ROOMS.length; i++) {
    const room = ROOMS[i], R = room.r;
    const top = R.h;
    const own = ownCeiling(room.id);
    if (!room.roofed) prisonRoof({
      id: room.id, x0: R.x0, x1: R.x1, z0: R.z0, z1: R.z1, top: top,
      over: room.over, deck: room.deck, cast: room.cast, soffit: own ? false : undefined,
      // a 8x8 hut wants no rooftop plant; everything else does
      plant: (R.x1 - R.x0) * (R.z1 - R.z0) > 90,
    });
    room.made = own ? own.n : fitOut(room, top);
    const rec = laid[laid.length - 1];
    if (rec && rec.id === room.id) rec.lights = room.made;
  }

  /* ==========================================================
     3. THE ONE THING A LID REALLY DOES TAKE AWAY.
        The cell wing is 33 x 37 m of ceiling and its only fittings are the
        six caged lamps world/cellblock.js hangs at y 8.2 — right for an
        open-topped hall lit by the sky, thin for a covered one. Six more
        strip lights go down the tier, on the wing's own circuit, so the
        walk from your cell to the officer's post is lit by something.
        (`kind:"block"` keeps 10% burning at lights-out — a real tier is
        never pitch black, and prisonnight.js's LEVELS table already says
        so; the pitch-black answer is the breaker, which kills these too.)
     ========================================================== */
  if (ON && LIT && PD && typeof PD.strip === "function") {
    let n = 0;
    // 7.88, not 8.05: the wing's lid carries four lattice trusses now
    // (world/cellblock.js, bottom chord 7.95-8.15) and a fitting hangs UNDER
    // its structure. At 8.05 these sat inside the chords; at their old
    // height against a bare lid they hung 0.85 m below it in mid-air.
    for (const z of [-40.5, -34, -27.5, -21, -14.5]) { PD.strip(0, 7.88, z, 4.0, "z", { kind: "block", r: 8 }); n++; }
    for (const x of [-13.2, 13.2]) { PD.strip(x, 7.88, -26, 3.4, "z", { kind: "block", r: 7 }); n++; }
    // …and they are the WING's fittings, so the audit counts them as the
    // wing's. Without this the hall reads `unlit` while seven strips burn
    // in it, which is the ratchet lying about the one room it cares most about.
    ROOMS[0].made = (ROOMS[0].made | 0) + n;
  }

  /* ==========================================================
     4. THE FLUSH. CBZ.prisonLights is published by systems/prisonnight.js
        at index.html:562 — after every file that draws a lamp — so a
        fitting cannot register at draw time. The kit queued them instead
        (CBZ.prisonDress.fixtures); this hands the queue over on the first
        tick, which is before any of them is drawn a second time.

        Idempotent by the `_reg` stamp, because a queue flushed twice would
        double every fitting in prisonnight's own O(n) lightAt loop.
     ========================================================== */
  let flushed = 0, seenQueue = -1;
  function flush() {
    if (!LIT || !PD || !PD.fixtures || !CBZ.prisonLights || !CBZ.prisonLights.register) return 0;
    let n = 0;
    for (let i = 0; i < PD.fixtures.length; i++) {
      const f = PD.fixtures[i];
      if (!f || f._reg) continue;
      f._reg = 1;
      CBZ.prisonLights.register(f);
      n++;
    }
    flushed += n;
    return n;
  }
  CBZ.prisonRoofFlush = flush;
  CBZ.onUpdate(21.4, function () {          // just ahead of prisonnight's own driver
    // O(1) in the steady state: the queue only ever grows, so comparing its
    // LENGTH is enough to know whether a later builder added a fitting. (A
    // one-shot `if (flushed) return` would have silently dropped every
    // fixture drawn by a file that loads after this one.)
    if (!CBZ.prisonLights || !PD || !PD.fixtures) return;
    if (PD.fixtures.length === seenQueue) return;
    seenQueue = PD.fixtures.length;
    flush();
  });

  /* ==========================================================
     5. THE RATCHET.
        `uncovered` — a room this file knows about that has no ceiling over
        it. `unlit` — a covered room with no scheduled fitting inside it,
        i.e. a cave. Both pinned at 0. `sealedRoutes` re-asks the question
        the owner's rule raises: no escape route may be closed by a lid.
        Every route in world/escape_routes.js and world/ventilation.js is a
        FLOOR hatch or a wall grate, so the answer is structurally 0 — but
        it is measured, not asserted, so a future roof-level route says so.
     ========================================================== */
  CBZ.prisonRoofAudit = function () {
    let uncovered = 0, unlit = 0, lights = 0;
    for (let i = 0; i < ROOMS.length; i++) {
      const room = ROOMS[i];
      if (!room.roofed && !laid.some(function (l) { return l.id === room.id; })) uncovered++;
      if (!(room.made > 0)) unlit++;
      lights += room.made | 0;
    }
    let sealed = 0;
    const vents = CBZ.vents || [];
    for (let i = 0; i < vents.length; i++) {
      const v = vents[i];
      if (!v || v.y == null) continue;
      for (let j = 0; j < laid.length; j++) {
        const l = laid[j];
        if (v.x > l.x0 && v.x < l.x1 && v.z > l.z0 && v.z < l.z1 && v.y >= l.top) sealed++;
      }
    }
    return {
      on: ON, lit: LIT,
      rooms: ROOMS.length, roofs: laid.length,
      uncovered: uncovered,                 // MUST be 0
      unlit: unlit,                         // MUST be 0
      sealedRoutes: sealed,                 // MUST be 0
      ceilingLights: lights,
      kitFixtures: (PD && PD.fixtures && PD.fixtures.length) | 0,
      scheduled: flushed,
      losBlockers: laid.length,
    };
  };
  });
})();
