/* ============================================================
   world/roombuild.js — the ROOM helper. Two layers:

     CBZ.roomShell(cfg)                    — stamps the SHELL: a tinted
       floor slab and four open-top walls with an optional doorway gap.
       Used by cafeteria / gunroom / lounge. UNCHANGED.

     CBZ.roomPlan(rect, program, opts)     — the LAYOUT PLANNER: turns a
       rectangle into "a room somebody chose the furniture for". Returns
       a plan of CBZ.furnish calls; draws nothing.

     CBZ.roomFurnish(rect, program, opts)  — the same plan, EXECUTED
       through CBZ.furnish (city/furniture.js). Degrade-safe: when the
       shared furniture kit is absent the plan still comes back as data
       and nothing is drawn — the caller keeps whatever it drew before.

   WHY A PLANNER AND NOT ANOTHER FURNITURE KIT: CBZ.furnish owns the
   vocabulary (what a sofa IS). This file owns the GRAMMAR (where a sofa
   goes, which way it faces, and whether you can still walk to it). It
   deliberately contains no box-drawing of its own — a second furniture
   drawer here would be exactly the parallel-capability failure CLAUDE.md's
   BLOCK LAW bans.

   ---- THE CONSTRAINTS (real interior-design numbers, not vibes) --------
   Every constant below is named, commented with the real-world figure it
   encodes, and used in exactly one place. See DESIGN CONSTANTS.

   ---- CIRCULATION IS VALIDATED, NOT ASSUMED ---------------------------
   After placement the planner floods a 0.25 m grid from the DOORWAY over
   the room, marking each piece's footprint (inflated by a body radius)
   blocked. Every piece must still have a reachable propuse ENTRY POINT
   (CBZ.propEntryPoint's standing spot: the walkable square you occupy to
   use the thing). A piece whose entry point the flood can't reach is
   DROPPED — an unusable prop is worse than an empty corner — and counted
   in `blocked`. This is the roomPlan analogue of propuse.js's own
   `blocked` ratchet.

   ---- LOAD-ORDER SHIM (CBZ.roomSeatAnchor) ----------------------------
   The prison rooms are built at PARSE time from index.html's world block,
   which runs LONG before src/city/propuse.js defines CBZ.propRegisterSeat.
   Any seat registered from here would silently vanish. roomSeatAnchor /
   roomBedAnchor forward when propuse is up and QUEUE when it isn't,
   flushing on `load` (this listener registers before core/batch.js's, so
   anchors land before the merge pass). Not a second registry — a one-way
   pipe into the one that exists.

   Revert: CBZ.CONFIG.ROOM_PLAN_V1 = false → roomPlan returns an empty
   plan and roomFurnish draws nothing; roomShell is untouched either way.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const { addBox } = CBZ;
  const T = 0.5; // wall thickness
  const HALF = Math.PI / 2;

  CBZ.CONFIG = CBZ.CONFIG || {};
  // ROOM_PLAN_V1 — owner: "the boss's office on the top floor of a gang
  // building should feel like a place". On → CBZ.roomPlan/roomFurnish turn a
  // bare rect + a program name into a constraint-checked furniture layout
  // (wall slots, real clearances, a flood-filled circulation check that DROPS
  // any piece whose entry point it cannot reach). Flip false (or
  // ?cfg_ROOM_PLAN_V1=0) for a one-line revert: roomPlan returns an empty
  // plan, roomFurnish draws nothing, every caller falls back to its own boxes.
  if (CBZ.CONFIG.ROOM_PLAN_V1 == null) CBZ.CONFIG.ROOM_PLAN_V1 = true;

  // ============================================================
  //  SHELL (unchanged)
  // ============================================================
  // cfg: { x0,x1,z0,z1, h, wall, floor, door:{side:'N|S|E|W', center, width} }
  function roomShell(cfg) {
    const { x0, x1, z0, z1 } = cfg;
    const h = cfg.h || 6;
    const wall = cfg.wall != null ? cfg.wall : CBZ.COL.WALL_D;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const w = x1 - x0, d = z1 - z0;

    // floor slab
    if (cfg.floor != null) {
      addBox(cx, 0.02, cz, w, 0.08, d, cfg.floor, { solid: false, cast: false });
    }

    const door = cfg.door;
    // build one wall, splitting it if the doorway sits on this side
    function wallRun(side, fixed, from, to, horizontal) {
      const hasDoor = door && door.side === side;
      if (!hasDoor) {
        if (horizontal) addBox((from + to) / 2, h / 2, fixed, to - from, h, T, wall, { solid: true, blockLOS: true });
        else addBox(fixed, h / 2, (from + to) / 2, T, h, to - from, wall, { solid: true, blockLOS: true });
        return;
      }
      const gap0 = door.center - door.width / 2, gap1 = door.center + door.width / 2;
      // two segments either side of the gap
      if (horizontal) {
        if (gap0 > from) addBox((from + gap0) / 2, h / 2, fixed, gap0 - from, h, T, wall, { solid: true, blockLOS: true });
        if (to > gap1) addBox((gap1 + to) / 2, h / 2, fixed, to - gap1, h, T, wall, { solid: true, blockLOS: true });
      } else {
        if (gap0 > from) addBox(fixed, h / 2, (from + gap0) / 2, T, h, gap0 - from, wall, { solid: true, blockLOS: true });
        if (to > gap1) addBox(fixed, h / 2, (gap1 + to) / 2, T, h, to - gap1, wall, { solid: true, blockLOS: true });
      }
    }

    wallRun("N", z0, x0, x1, true);   // north (z0)
    wallRun("S", z1, x0, x1, true);   // south (z1)
    wallRun("W", x0, z0, z1, false);  // west  (x0)
    wallRun("E", x1, z0, z1, false);  // east  (x1)

    return { cx, cz };
  }
  CBZ.roomShell = roomShell;

  // ============================================================
  //  ANCHOR SHIM — see the header. One-way pipe into city/propuse.js.
  // ============================================================
  // `geom` = propuse.js's 7th argument, {cushion, floorBelow}: the ONLY way a
  // seat gets entities/character.js's real feet-on-the-floor chair solve. A
  // seat registered without it deliberately keeps the legacy pose and is
  // counted by CBZ.propUseAudit().noGeom — so ALWAYS pass it when the cushion
  // height is actually known (CBZ.furnish reports it as seat.cushion).
  const pendSeat = [], pendBed = [];
  CBZ.roomSeatAnchor = function (x, y, z, face, kind, lot, geom) {
    if (CBZ.propRegisterSeat) return CBZ.propRegisterSeat(x, y || 0, z, face || 0, kind || "chair", lot || null, geom || null);
    pendSeat.push([x, y || 0, z, face || 0, kind || "chair", lot || null, geom || null]);
    return null;
  };
  CBZ.roomBedAnchor = function (x, y, z, hx, hz, len, topY, kind, lot) {
    if (CBZ.propRegisterBed) return CBZ.propRegisterBed(x, y || 0, z, hx, hz, len, topY, kind || "bed", lot || null);
    pendBed.push([x, y || 0, z, hx, hz, len, topY, kind || "bed", lot || null]);
    return null;
  };
  // Idempotent by construction: propuse dedupes anchors on a decimetre
  // coordinate key, so re-flushing after a propPurposeReset is harmless.
  CBZ.roomAnchorsFlush = function () {
    let n = 0;
    if (CBZ.propRegisterSeat) for (let i = 0; i < pendSeat.length; i++) {
      const a = pendSeat[i];
      if (CBZ.propRegisterSeat(a[0], a[1], a[2], a[3], a[4], a[5], a[6])) n++;
    }
    if (CBZ.propRegisterBed) for (let i = 0; i < pendBed.length; i++) {
      const b = pendBed[i];
      if (CBZ.propRegisterBed(b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8])) n++;
    }
    return n;
  };
  try {
    if (document.readyState === "complete") CBZ.roomAnchorsFlush();
    else window.addEventListener("load", function () { CBZ.roomAnchorsFlush(); }, { once: true });
  } catch (e) {}

  // ============================================================
  //  DESIGN CONSTANTS — each cites the real number it encodes.
  // ============================================================
  // 0.90 m — the continuous clear width of a one-person circulation route
  // (ANSI A117.1 / ADA accessible route: 915 mm continuous, 815 mm at a
  // pinch point). Any band narrower than this does not count as a way past.
  const CIRC_W = 0.90;
  // 0.28 m — half-shoulder + slack. propuse.js uses BODY_R = 0.30 for its own
  // entry-point clearance test; the flood fill runs a hair tighter so a band
  // this planner calls walkable is never one propuse then calls blocked.
  const BODY_R = 0.28;
  // 0.25 m flood cell — three cells resolve a 0.90 m band even after both
  // sides are inflated by BODY_R, so CIRC_W is measurable on this grid.
  const GRID = 0.25;
  // 0.90 m — keep-clear in front of a doorway: the swing arc of a standard
  // 900 mm door leaf. Nothing is placed inside it, ever.
  const DOOR_CLEAR = 0.90;
  // 0.60 m — clearance along a bed's entry side; Neufert / Architectural
  // Graphic Standards give 600 mm as the minimum to pass beside and make a
  // bed. That side is the one propuse will use as the bedside.
  const BEDSIDE = 0.60;
  // 0.90 m — the pull-out zone behind a desk chair (AGS: 900-1070 mm to rise
  // from a desk; 1220 mm if somebody must also pass behind you).
  const CHAIR_PULL = 0.90;
  // 2.5-3.5 m — sofa-to-screen viewing distance for a 50-65" panel
  // (SMPTE 30-degree / THX 36-degree seating-distance recommendations).
  const TV_MIN = 2.50, TV_MAX = 3.50;
  // 0.42 m — sofa edge to coffee table: AGS puts the knee/shin gap at
  // 400-450 mm (close enough to reach a mug, far enough to stand up).
  const COFFEE_GAP = 0.42;
  // 0.05 m — a wall-slot piece stands 50 mm off the plaster so it clears the
  // skirting board instead of visibly interpenetrating the wall.
  const WALL_GAP = 0.05;
  // 0.45 m — how far in front of a piece its user stands. Matches
  // propuse.js's ENTRY_R (0.78 from the CUSHION, i.e. ~0.45 clear of the
  // piece's front face) so the planner's proxy agrees with the real solver.
  const ENTRY_GAP = 0.45;
  // 25-40 % floor coverage. The interior-design furniture-to-floor ratio:
  // below 25 % a room reads as deliberately spare (which the owner likes),
  // above 40 % it reads as junk. Only the upper bound is enforced — an
  // under-furnished room is a legitimate outcome, never padded to fill.
  const DENS_MIN = 0.25, DENS_MAX = 0.40;
  // 1.60 m — the width of a boss office's central approach corridor: two
  // people abreast (2 x 0.75 m shoulder lane). Kept permanently empty.
  const APPROACH_W = 1.60;
  // 3.00 m — the minimum door-to-desk approach that makes a power room read
  // as one. Below it, bossoffice degrades to a plain office.
  const BOSS_APPROACH = 3.00;
  // 0.20 m — the boss chair's BACK to the glass. CBZ.furnish.bossDesk already
  // contains the throne inside its own footprint (its depth is D + 1.6: 0.83
  // of throne behind the desk, 0.77 of guest chairs in front), so this is not
  // a chair allowance — it is the only gap left, and it is deliberately too
  // narrow to walk through. There is no route behind a boss's desk; that is
  // the whole read of "back to the window".
  const BOSS_GLASS_GAP = 0.20;

  // ---- FOOTPRINTS ---------------------------------------------------------
  // These MIRROR city/furniture.js's own `p.done(w, d, ...)` returns exactly
  // (furniture.js:292/303/321/339/361/387/417/444/468/484/497/538) including
  // the pieces whose cluster is bigger than the object: F.desk's `d` already
  // contains ITS OWN chair, and F.bossDesk's already contains the throne AND
  // both guest chairs — which is why this planner never adds those seats
  // itself. `bck` is how far the footprint reaches BEHIND the origin (the
  // asymmetry a desk's chair creates); everything else is symmetric.
  // If the kit ever publishes CBZ.furnish.dims it wins, so this can't drift.
  function dimsOf(fn, o) {
    const kit = CBZ.furnish && CBZ.furnish.dims;
    if (kit && kit[fn]) {
      const k = kit[fn];
      return { w: k.w, d: k.d, bck: k.bck != null ? k.bck : k.d / 2 };
    }
    o = o || {};
    const L = o.len != null ? +o.len : null;
    const sym = function (w, d) { return { w: w, d: d, bck: d / 2 }; };
    switch (fn) {
      case "chair": return sym(0.50, 0.50);
      case "stool": return sym(0.42, 0.42);
      case "bench": return sym(L || 1.8, o.back === false ? 0.48 : 0.56);
      case "sofa": return sym(L || 2.4, 0.85);
      case "bed": return sym(o.wide != null ? +o.wide : 1.4, (L || 2.1) + 0.12);
      case "desk": {
        const D = o.deep != null ? +o.deep : 0.75;
        // the whole D+0.94 overhang is the chair BEHIND the desk
        return { w: L || 1.5, d: D + 0.94, bck: D / 2 + 0.94 };
      }
      case "table": return sym(L || 1.6, o.deep != null ? +o.deep : 0.9);
      case "counter": return sym((L || 2.6) + 0.08, (o.deep != null ? +o.deep : 0.75) + 0.10);
      case "shelf": return sym(L || 1.8, o.deep != null ? +o.deep : 0.5);
      case "locker": return sym((o.n != null ? (o.n | 0) : 3) * 0.42, 0.5);
      case "lamp": return sym(0.34, 0.34);
      case "bossDesk": {
        const D = o.deep != null ? +o.deep : 1.1;
        // throne 0.83 behind + guest chairs 0.77 in front = the kit's +1.6
        return { w: L || 2.6, d: D + 1.6, bck: D / 2 + 0.83 };
      }
      default: return sym(0.6, 0.6);
    }
  }

  const OPP = { N: "S", S: "N", W: "E", E: "W" };

  // ============================================================
  //  CBZ.roomPlan
  // ============================================================
  // rect    { x0, x1, z0, z1, y }        HOST rect + floor height (world coords
  //                                      by default; building-LOCAL when the
  //                                      caller passes a buildings.js lbox as
  //                                      opts.box — then opts.ox/oz bridge to
  //                                      world for the propuse anchors)
  // program "bedroom" | "office" | "breakroom" | "lounge" | "mess"
  //         | "bossoffice" | "empty"
  // opts    { seed, door:{x,z,side}, clear(x,z,pad), box, ox, oz, oy, lot,
  //           tone, inset }
  //         `clear` is buildings.js's clearFloorPoint contract: false where the
  //         host owns the floor (stair strip, door aisle, lift chase). Sampled
  //         once into the circulation grid; a piece straddling it is refused.
  // ->      { pieces:[{fn,x,z,yaw,opts,...}], ok, blocked, coverage, program }
  CBZ.roomPlan = function (rect, program, opts) {
    opts = opts || {};
    program = String(program || "empty");
    const out = { pieces: [], ok: false, blocked: 0, coverage: 0, program: program, dropped: [] };
    if (CBZ.CONFIG.ROOM_PLAN_V1 === false || !rect) return out;

    // interior rect: the shell's walls are centred on x0/x1, so inset half a
    // wall thickness by default to get the usable floor.
    const inset = opts.inset != null ? opts.inset : T / 2;
    const R = {
      x0: Math.min(rect.x0, rect.x1) + inset, x1: Math.max(rect.x0, rect.x1) - inset,
      z0: Math.min(rect.z0, rect.z1) + inset, z1: Math.max(rect.z0, rect.z1) - inset,
      y: rect.y || 0,
    };
    const W = R.x1 - R.x0, D = R.z1 - R.z0;
    if (!(W > 1.4 && D > 1.4)) return out;
    const CX = (R.x0 + R.x1) / 2, CZ = (R.z0 + R.z1) / 2, AREA = W * D;

    // ---- determinism: every choice is a position hash, never Math.random.
    // Folding the caller's seed in as an extra integer keeps two identical
    // rects in different buildings from getting the identical layout, while
    // the SAME rect + SAME seed is byte-identical forever.
    const sd = opts.seed | 0;
    const qx = Math.round(R.x0 * 10), qz = Math.round(R.z0 * 10);
    function H(salt) {
      if (CBZ.hashN) return CBZ.hashN(qx, qz, sd, salt | 0) / 4294967296;
      if (CBZ.hash01) return CBZ.hash01(R.x0 + sd * 0.37, R.z0, salt | 0);
      return 0.5;
    }

    // ---- the doorway -------------------------------------------------
    const door = opts.door || null;
    let dside;
    if (door && door.side) dside = String(door.side).toUpperCase();
    else if (door && door.x != null) {
      const c = [["N", Math.abs(door.z - R.z0)], ["S", Math.abs(door.z - R.z1)],
                 ["W", Math.abs(door.x - R.x0)], ["E", Math.abs(door.x - R.x1)]];
      c.sort(function (a, b) { return a[1] - b[1]; });
      dside = c[0][0];
    } else dside = "W";
    const DX = door && door.x != null ? Math.min(R.x1, Math.max(R.x0, door.x))
      : (dside === "W" ? R.x0 : dside === "E" ? R.x1 : CX);
    const DZ = door && door.z != null ? Math.min(R.z1, Math.max(R.z0, door.z))
      : (dside === "N" ? R.z0 : dside === "S" ? R.z1 : CZ);
    const far = OPP[dside] || "E";                 // the wall you face on entry

    // door keep-clear: the leaf's swing arc, as an axis-aligned box.
    const KEEPOUT = [{
      minX: DX - DOOR_CLEAR, maxX: DX + DOOR_CLEAR,
      minZ: DZ - DOOR_CLEAR, maxZ: DZ + DOOR_CLEAR,
    }];

    // ---- HOST KEEP-OUTS ------------------------------------------------
    // `opts.clear(x, z, pad) -> bool`, in the RECT's OWN coordinate space —
    // buildings.js's `clearFloorPoint` contract verbatim, which is also the
    // predicate interior_programs.js takes as `h.clear`. Without it a planner
    // furnishes straight into the stair strip, the door aisle and the lift
    // chase, because none of those is a wall and none of them is a piece.
    //
    // IT GATES PLACEMENT ONLY, NEVER THE FLOOD FILL, and the distinction is the
    // whole point of the predicate: it means "do not put furniture here", not
    // "a body cannot stand here". Marking the door aisle as a circulation
    // obstacle would cut the room in half and drop every piece on the far side
    // as unreachable — the aisle is the most walkable strip on the plate.
    const hostClear = (typeof opts.clear === "function") ? opts.clear : null;
    // Nine samples over the footprint (corners, edge midpoints, centre) resolve
    // the aisle and stair BANDS this predicate actually describes, at nine calls
    // per candidate piece rather than one per grid cell.
    function hostOk(f) {
      if (!hostClear) return true;
      const xs = [f.minX + 0.12, (f.minX + f.maxX) / 2, f.maxX - 0.12];
      const zs = [f.minZ + 0.12, (f.minZ + f.maxZ) / 2, f.maxZ - 0.12];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        try { if (!hostClear(xs[a], zs[b], 0.15)) return false; } catch (e) { return true; }
      }
      return true;
    }

    // ---- THE CIRCULATION GRID, allocated up front and its constant layer (the
    // room's own wall band, a body radius deep on every side) written ONCE
    // instead of being re-swept on every validation pass.
    const cols = Math.max(1, Math.ceil(W / GRID)), rows = Math.max(1, Math.ceil(D / GRID));
    const base = new Uint8Array(cols * rows);     // the walls (constant)
    const cell = new Uint8Array(cols * rows);     // base + the pieces of one pass
    const seen = new Uint8Array(cols * rows);
    const queue = new Int32Array(cols * rows);
    function cellX(i) { return R.x0 + (i + 0.5) * GRID; }
    function cellZ(j) { return R.z0 + (j + 0.5) * GRID; }
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = cellX(i), z = cellZ(j);
      if (x < R.x0 + BODY_R || x > R.x1 - BODY_R || z < R.z0 + BODY_R || z > R.z1 - BODY_R) base[j * cols + i] = 1;
    }

    // ---- placement helpers -------------------------------------------
    // Wall-slot: back to the wall, front facing into the room. `along` is the
    // world coordinate along that wall's free axis; `off` floats the piece
    // off the wall (0 = flush, used to give a desk chair its pull-out zone).
    // `bck` = how far the piece reaches BEHIND its origin (a desk's own chair
    // lives back there), so the WALL sees the footprint's back face, not the
    // origin — otherwise every desk would bury its chair in the plaster.
    function slot(side, along, bck, off) {
      const g = WALL_GAP + (off || 0) + bck;
      if (side === "N") return { x: along, z: R.z0 + g, yaw: 0 };
      if (side === "S") return { x: along, z: R.z1 - g, yaw: Math.PI };
      if (side === "W") return { x: R.x0 + g, z: along, yaw: HALF };
      return { x: R.x1 - g, z: along, yaw: -HALF };
    }
    // one call: size the piece from the kit's own table, then wall-slot it.
    function wallPos(fn, o, side, along, off) {
      const dm = dimsOf(fn, o);
      return slot(side, along, dm.bck, off);
    }
    function wallSpan(side) { return (side === "N" || side === "S") ? W : D; }
    function wallMid(side) { return (side === "N" || side === "S") ? CX : CZ; }
    // free-standing: on the room's focal axis (the line door -> far wall).
    function focal(t, w, d, yaw) {
      // t = 0 at the door, 1 at the far wall
      if (dside === "W") return { x: R.x0 + t * W, z: CZ, yaw: yaw != null ? yaw : -HALF };
      if (dside === "E") return { x: R.x1 - t * W, z: CZ, yaw: yaw != null ? yaw : HALF };
      if (dside === "N") return { x: CX, z: R.z0 + t * D, yaw: yaw != null ? yaw : Math.PI };
      return { x: CX, z: R.z1 - t * D, yaw: yaw != null ? yaw : 0 };
    }

    const pieces = [];
    // prio: higher = more important; the density/circulation passes drop the
    // lowest-prio piece first, so the room's REASON to exist survives.
    function put(fn, pos, o, prio, tag) {
      if (!pos) return null;
      const dm = dimsOf(fn, o);
      const p = {
        fn: fn, x: pos.x, z: pos.z, yaw: pos.yaw || 0,
        opts: o || {}, w: dm.w, d: dm.d, bck: dm.bck, fwd: dm.d - dm.bck,
        // `area` is the piece's OWN floor footprint and is what DENSITY counts.
        // w/d may be inflated afterwards to reserve a clearance zone (a table's
        // chair ring); reserved air is not furniture and must not read as junk.
        area: dm.w * dm.d, prio: prio || 1, tag: tag || fn,
      };
      // sideways entry (a bed is boarded from a long side, not the foot);
      // desks are used from BEHIND (that is where the chair goes).
      p.sideEntry = (fn === "bed");
      p.backEntry = (fn === "desk" || fn === "bossDesk");
      if (!fits(p)) return null;
      pieces.push(p);
      return p;
    }
    // Every planner yaw is an axis-aligned multiple of 90 degrees, so the
    // footprint is a plain AABB — asymmetric along the forward axis (bck
    // behind the origin, fwd in front of it), symmetric across it.
    function foot(p) {
      const s = Math.round(Math.sin(p.yaw)), c = Math.round(Math.cos(p.yaw));
      if (c !== 0) return {
        minX: p.x - p.w / 2, maxX: p.x + p.w / 2,
        minZ: c > 0 ? p.z - p.bck : p.z - p.fwd,
        maxZ: c > 0 ? p.z + p.fwd : p.z + p.bck,
      };
      return {
        minZ: p.z - p.w / 2, maxZ: p.z + p.w / 2,
        minX: s > 0 ? p.x - p.bck : p.x - p.fwd,
        maxX: s > 0 ? p.x + p.fwd : p.x + p.bck,
      };
    }
    function overlap(a, b, pad) {
      pad = pad || 0;
      return a.minX < b.maxX + pad && a.maxX > b.minX - pad
        && a.minZ < b.maxZ + pad && a.maxZ > b.minZ - pad;
    }
    // in-room, clear of the doorway swing / program keep-outs, clear of
    // everything already placed.
    function fits(p) {
      const f = foot(p);
      if (f.minX < R.x0 - 0.02 || f.maxX > R.x1 + 0.02 || f.minZ < R.z0 - 0.02 || f.maxZ > R.z1 + 0.02) return false;
      for (let i = 0; i < KEEPOUT.length; i++) if (overlap(f, KEEPOUT[i])) return false;
      if (!hostOk(f)) return false;
      for (let i = 0; i < pieces.length; i++) if (overlap(f, foot(pieces[i]), 0.06)) return false;
      return true;
    }
    // the walkable square you stand on to use this piece — the planner's
    // proxy for CBZ.propEntryPoint(rec) (which solves it against the live
    // collider set once the anchors exist). The CANDIDATE ORDER mirrors
    // propuse.js's entryOf() exactly, so a spot this planner accepts is a spot
    // propuse will also accept:
    //   bed   → the long side nearer the door, the far long side, the foot
    //   desk  → the working side (BEHIND) first, then the visitor side
    //   seat  → straight out front, then either side, then behind
    function entry(p) {
      const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
      const rx = c, rz = -s;                       // the piece's right-hand unit
      if (p.sideEntry) {
        const off = p.w / 2 + BEDSIDE;
        const a = { x: p.x + rx * off, z: p.z + rz * off };
        const b = { x: p.x - rx * off, z: p.z - rz * off };
        const da = (a.x - DX) * (a.x - DX) + (a.z - DZ) * (a.z - DZ);
        const db = (b.x - DX) * (b.x - DX) + (b.z - DZ) * (b.z - DZ);
        const foot0 = { x: p.x - s * (p.bck + ENTRY_GAP), z: p.z - c * (p.bck + ENTRY_GAP) };
        return da <= db ? [a, b, foot0] : [b, a, foot0];
      }
      const lat = p.w / 2 + ENTRY_GAP;
      const front = { x: p.x + s * (p.fwd + ENTRY_GAP), z: p.z + c * (p.fwd + ENTRY_GAP) };
      const back = { x: p.x - s * (p.bck + ENTRY_GAP), z: p.z - c * (p.bck + ENTRY_GAP) };
      // A desk is USED from behind it — that is where its chair lives. Try the
      // working side first; a desk pushed flush to a wall falls back to the
      // visitor side, which is the shallow-room grammar below.
      if (p.backEntry) return [back, front,
        { x: p.x + rx * lat, z: p.z + rz * lat },
        { x: p.x - rx * lat, z: p.z - rz * lat }];
      return [front,
        { x: p.x + rx * lat, z: p.z + rz * lat },
        { x: p.x - rx * lat, z: p.z - rz * lat },
        back];
    }

    // ============================================================
    //  PROGRAMS — the grammar of each room type.
    // ============================================================
    if (program === "bedroom") {
      // Bed: headboard against a wall, never the doorway wall, foot into the
      // room. Prefer the far wall; a hash picks a side wall when the far wall
      // is too short to take a bed plus its BEDSIDE clearance.
      const bd = dimsOf("bed");
      let bw = far;
      if (wallSpan(far) < bd.w + BEDSIDE + CIRC_W) bw = H(0x1) < 0.5 ? sideA(dside) : sideB(dside);
      // slide the bed AWAY from the door along its wall so the entry side
      // (the one the door is on) keeps its 0.60 m bedside strip.
      const span = wallSpan(bw), mid = wallMid(bw);
      const shove = Math.max(0, Math.min(span / 2 - bd.w / 2 - 0.1, BEDSIDE * 0.5));
      const awayFromDoor = (bw === "N" || bw === "S")
        ? (DX < CX ? 1 : -1) : (DZ < CZ ? 1 : -1);
      const bedAlong = mid + shove * awayFromDoor;
      // HEADBOARD TO THE WALL. CBZ.furnish.bed's yaw points from the mattress
      // centre toward the PILLOW (furniture.js:372), and the headboard is drawn
      // at +L/2 — the FORWARD end. Every other wall-slot faces its piece INTO
      // the room, which for a bed puts the headboard in mid-floor and drives the
      // foot through the plaster. Flipping the slot yaw is the whole fix, and
      // because a bed's footprint is symmetric the wall gap does not move. It
      // also makes entry()'s third candidate ("the foot") land in the room
      // instead of inside the wall, which is what its own comment claimed.
      const bedPos = wallPos("bed", null, bw, bedAlong, 0);
      bedPos.yaw += Math.PI;
      put("bed", bedPos, { tone: opts.tone }, 9, "bed");
      // wardrobe/locker + shelf on the remaining walls, desk under a wall.
      // NO separate chair: CBZ.furnish.desk draws AND registers its own, and
      // its returned depth already reserves the space behind it.
      const rest = ["N", "S", "W", "E"].filter(function (s) { return s !== dside && s !== bw; });
      if (rest[0]) put("locker", wallPos("locker", null, rest[0], wallMid(rest[0]) - 0.9, 0), {}, 5, "wardrobe");
      const dsk = { len: 1.4 };
      if (rest[1]) put("desk", wallPos("desk", dsk, rest[1], wallMid(rest[1]), 0), dsk, 4, "desk");
      if (H(0x2) < 0.65) put("lamp", wallPos("lamp", null, bw, bedAlong + bd.w / 2 + 0.45, 0), {}, 2, "lamp");

    } else if (program === "office") {
      // CBZ.furnish.desk is a CLUSTER: it draws and registers its own chair
      // behind the worktop, and its returned depth already contains it. So the
      // "chair between the desk and the wall behind it" grammar is expressed by
      // WHERE THE CLUSTER SITS, not by adding a second chair (which is what the
      // planner used to do — two chairs, one inside the other).
      // Deep room  → the whole cluster floats CHAIR_PULL off the wall, so the
      //              seated worker has a real 0.90 m band to push back into.
      // Shallow    → the cluster goes flush; the pull-out zone is then the
      //              0.44 m of slack the kit already reserves behind the chair.
      const dsk = { len: null };
      const dd = dimsOf("desk", null);
      const depth = (far === "N" || far === "S") ? D : W;
      const need = WALL_GAP + CHAIR_PULL + dd.d + CIRC_W;
      put("desk", wallPos("desk", null, far, wallMid(far), depth >= need ? CHAIR_PULL : 0), {}, 9, "desk");
      const rest = ["N", "S", "W", "E"].filter(function (s) { return s !== dside && s !== far; });
      if (rest[0]) put("shelf", wallPos("shelf", null, rest[0], wallMid(rest[0]) + 0.6, 0), {}, 5, "shelf");
      if (rest[1] && H(0x3) < 0.7) put("locker", wallPos("locker", null, rest[1], wallMid(rest[1]) - 0.7, 0), {}, 3, "locker");

    } else if (program === "breakroom") {
      // A counter on the far wall you queue at, and ONE free-standing table on
      // the focal axis you actually sit at. Nothing in between.
      const cl = Math.max(1.2, Math.min(wallSpan(far) - 1.2, 3.0)), co = { len: cl };
      put("counter", wallPos("counter", co, far, wallMid(far), 0), co, 9, "counter");
      // the kit's `table` rings its own chairs (seats:N) and reports only the
      // top's own footprint, so we reserve the ring by hand: 0.42 gap + a
      // 0.50 chair each side = 0.92 beyond the top, on every side.
      const to = { seats: D * W > 16 ? 4 : 2, len: 1.4 };
      const tp = focal(0.48);
      const tpl = put("table", tp, to, 8, "table");
      if (tpl) { tpl.w += 1.84; tpl.d += 1.84; tpl.bck += 0.92; tpl.fwd += 0.92; }
      const rest = ["N", "S", "W", "E"].filter(function (s) { return s !== dside && s !== far; });
      if (rest[0]) put("shelf", wallPos("shelf", null, rest[0], wallMid(rest[0]) + 0.8, 0), {}, 4, "shelf");

    } else if (program === "lounge") {
      // Sofa faces the media wall at 2.5-3.5 m; the media wall is always the one
      // the sofa's back is NOT against, so the pair keeps its viewing geometry
      // whichever wall the sofa ends up on.
      //
      // THE BUG THIS CANDIDATE WALK REPLACES: the sofa was pinned to the middle
      // of the DOOR's wall, and the door keep-clear is a 1.8 m box centred on
      // the doorway — so for the overwhelmingly common case of a door centred on
      // its wall, `fits()` refused the sofa, and with it the coffee table, the
      // armchair and the lamp, which all hang off the sofa. The room came out
      // EMPTY and reported ok. Now the sofa steps ALONG its wall until the swing
      // arc is clear, and only if that wall is too short to hold both does it
      // fall through to a side wall.
      const sf = dimsOf("sofa");
      let sofa = null, sofaWall = dside, media = far, sofaLen = 2.4;
      const cands = [dside, sideA(dside), sideB(dside)];
      for (let ci = 0; ci < cands.length && !sofa; ci++) {
        const sw = cands[ci], mw = OPP[sw] || far;
        const depth = (mw === "N" || mw === "S") ? D : W;
        let off = 0;
        if (depth - sf.d > TV_MAX) off = depth - sf.d - TV_MAX;        // pull it forward
        if (depth - sf.d - off < TV_MIN) off = Math.max(0, depth - sf.d - TV_MIN);
        const sl = Math.max(1.4, Math.min(wallSpan(sw) - 1.0, 2.6)), so = { len: sl };
        const dAlong = (sw === "N" || sw === "S") ? DX : DZ;
        const mid = wallMid(sw), lim = Math.max(0, wallSpan(sw) / 2 - sl / 2 - 0.15);
        const need = DOOR_CLEAR + sl / 2 + 0.05;
        const tries = (Math.abs(mid - dAlong) >= need) ? [mid] : [
          Math.max(mid - lim, Math.min(mid + lim, dAlong + need)),
          Math.max(mid - lim, Math.min(mid + lim, dAlong - need)),
        ];
        for (let t = 0; t < tries.length && !sofa; t++)
          sofa = put("sofa", wallPos("sofa", so, sw, tries[t], off), so, 9, "sofa");
        if (sofa) { sofaWall = sw; media = mw; sofaLen = sl; }
      }
      if (sofa) {
        // coffee table on the focal axis, one shin-gap in front of the sofa.
        // seats:0 → the kit rings NO chairs around it (furniture.js F.table).
        const s = Math.sin(sofa.yaw), c = Math.cos(sofa.yaw);
        const gap = sofa.fwd + COFFEE_GAP + 0.45;
        put("table", { x: sofa.x + s * gap, z: sofa.z + c * gap, yaw: sofa.yaw }, { seats: 0, len: 1.1 }, 6, "coffee");
        // an armchair at 90 degrees to the sofa (the conversational L)
        const rx = c, rz = -s, side = H(0x4) < 0.5 ? 1 : -1;
        const ax = sofa.x + rx * side * (sofaLen / 2 + 0.75) + s * 0.9;
        const az = sofa.z + rz * side * (sofaLen / 2 + 0.75) + c * 0.9;
        put("chair", { x: ax, z: az, yaw: sofa.yaw - side * HALF }, {}, 4, "armchair");
      }
      const rest = ["N", "S", "W", "E"].filter(function (s) { return s !== dside && s !== media && s !== sofaWall; });
      if (rest[0] && H(0x5) < 0.6) put("lamp", wallPos("lamp", null, rest[0], wallMid(rest[0]) + 1.0, 0), {}, 2, "lamp");

    } else if (program === "mess") {
      // Refectory grammar: a serving counter on the far wall, then long tables
      // on the focal axis with a bench down each side and a >= CIRC_W aisle.
      const cl = Math.max(1.6, Math.min(wallSpan(far) - 1.2, 8)), co = { len: cl };
      put("counter", wallPos("counter", co, far, wallMid(far), 0), co, 9, "counter");
      const runAxis = (dside === "W" || dside === "E") ? "z" : "x";
      const runLen = runAxis === "z" ? D : W;
      const tl = Math.max(1.8, Math.min(runLen - 2.0, 4.4));
      const across = runAxis === "z" ? W : D;
      // A refectory row is table(0.9 deep) + a bench each side; BENCH_OFF puts
      // the bench 0.82 m off the table centreline (table half 0.45 + bench half
      // 0.25 + a 0.12 shin gap), so one row is 2 x 1.07 m wide. Row PITCH must
      // therefore be >= 2.14 + CIRC_W = 3.05 m or the aisles between rows are
      // not walkable — that is the row count, derived, not guessed.
      const BENCH_OFF = 0.82, ROW_HALF = 1.07, ROW_PITCH = 2 * ROW_HALF + CIRC_W;
      const rows = Math.max(1, Math.min(3, Math.floor(across / ROW_PITCH) - 1));
      for (let i = 0; i < rows; i++) {
        const t = (i + 1) / (rows + 1);
        const cxr = runAxis === "z" ? (R.x0 + t * W) : CX;
        const czr = runAxis === "z" ? CZ : (R.z0 + t * D);
        // the piece's WIDTH must run along the row, so a z-run needs yaw = +-90.
        const yaw = runAxis === "z" ? HALF : 0;
        put("table", { x: cxr, z: czr, yaw: yaw }, { seats: 0, len: tl, deep: 0.9 }, 8 - i, "messtable");
        for (const s of [-1, 1]) {
          const bx = runAxis === "z" ? cxr + s * BENCH_OFF : cxr;
          const bz = runAxis === "z" ? czr : czr + s * BENCH_OFF;
          const byaw = runAxis === "z" ? (s > 0 ? -HALF : HALF) : (s > 0 ? Math.PI : 0);
          // back:false — a refectory bench is a backless plank you slide onto
          // from the end; a backrest would also eat the 0.82 m row offset.
          put("bench", { x: bx, z: bz, yaw: byaw }, { len: tl, back: false }, 7 - i, "messbench");
        }
      }

    } else if (program === "bossoffice") {
      // ---- THE POWER ROOM -------------------------------------------
      // Grammar (real level design, not decoration): the desk sits at the FAR
      // end so there is a long approach; the boss's chair is behind it with
      // its back to the window wall; two LOWER guest chairs face the desk
      // across it; a sideboard runs along one side wall in the far third; and
      // the MIDDLE STAYS EMPTY — the walk is the point. If the room is too
      // shallow for BOSS_APPROACH the whole conceit collapses, so we say so
      // (ok stays true, but the approach keep-out shrinks to what exists).
      const bdz = dimsOf("bossDesk", null);
      const depth = (far === "N" || far === "S") ? D : W;
      // the approach corridor: door -> desk, kept permanently clear.
      const appLen = Math.max(1.0, Math.min(depth - bdz.d - 0.4, Math.max(BOSS_APPROACH, depth * 0.55)));
      const corridor = (dside === "W" || dside === "E")
        ? { minX: Math.min(DX, DX + (dside === "W" ? appLen : -appLen)), maxX: Math.max(DX, DX + (dside === "W" ? appLen : -appLen)), minZ: CZ - APPROACH_W / 2, maxZ: CZ + APPROACH_W / 2 }
        : { minX: CX - APPROACH_W / 2, maxX: CX + APPROACH_W / 2, minZ: Math.min(DZ, DZ + (dside === "N" ? appLen : -appLen)), maxZ: Math.max(DZ, DZ + (dside === "N" ? appLen : -appLen)) };
      KEEPOUT.push(corridor);
      // the desk cluster (furnish.bossDesk owns the desk + the boss chair
      // behind it; back to the far/window wall by construction).
      // wallPos slots the CLUSTER's back face (the throne's back) BOSS_GLASS_GAP
      // off the window wall — the throne is inside the piece, not beside it.
      const bo = { tone: opts.tone };
      put("bossDesk", wallPos("bossDesk", bo, far, wallMid(far), BOSS_GLASS_GAP), bo, 10, "bossdesk");
      // NO guest chairs are placed here on purpose. CBZ.furnish.bossDesk is ONE
      // PIECE — desk + the high-back chair behind it + the two lower supplicant
      // chairs across it — and it reports all three seat anchors. An earlier
      // draft placed a second pair here and the room ended up with four
      // overlapping guest chairs. The kit's declared footprint (depth D + 1.6)
      // already spans the throne behind and the guests in front, so the
      // circulation flood-fill below sees them without us re-drawing them.
      // sideboard / shelf run along ONE side wall, in the FAR third only.
      const sides = [sideA(dside), sideB(dside)];
      const pick = H(0x6) < 0.5 ? sides[0] : sides[1];
      const sgn2 = (pick === "N" || pick === "S")
        ? (far === "W" ? -1 : 1) : (far === "N" ? -1 : 1);
      const sb = { len: 1.6 };
      put("shelf", wallPos("shelf", sb, pick, wallMid(pick) + sgn2 * wallSpan(pick) * 0.28, 0), sb, 5, "sideboard");
      const other = sides[0] === pick ? sides[1] : sides[0];
      if (H(0x7) < 0.5)
        put("locker", wallPos("locker", null, other, wallMid(other) + sgn2 * wallSpan(other) * 0.30, 0), {}, 3, "cabinet");
    }
    // "empty" (and anything unknown) plans nothing on purpose: an empty room
    // is a legitimate authored outcome, not a failure to fill.

    function sideA(s) { return (s === "N" || s === "S") ? "W" : "N"; }
    function sideB(s) { return (s === "N" || s === "S") ? "E" : "S"; }

    // ============================================================
    //  VALIDATION — density, then circulation.
    // ============================================================
    function coverage(list) {
      let a = 0;
      for (let i = 0; i < list.length; i++) a += (list[i].area != null ? list[i].area : list[i].w * list[i].d);
      return a / AREA;
    }
    function dropLowest(list, why) {
      let li = -1;
      for (let i = 0; i < list.length; i++) if (li < 0 || list[i].prio < list[li].prio) li = i;
      if (li < 0) return null;
      const p = list.splice(li, 1)[0];
      p.why = why;
      out.dropped.push(p);
      return p;
    }
    // 1. DENSITY — never fill just to fill; shed the least important piece
    //    until the room is back under the 40 % junk line.
    let guard = 24;
    while (pieces.length && coverage(pieces) > DENS_MAX && guard-- > 0) dropLowest(pieces, "density");

    // 2. CIRCULATION — coarse flood fill from the doorway. The grid, the room's
    //    own wall band and the host's obstacles were sampled once, up top.
    function mark(list) {
      cell.set(base);
      for (let k = 0; k < list.length; k++) {
        const f = foot(list[k]);
        const i0 = Math.max(0, Math.floor((f.minX - BODY_R - R.x0) / GRID));
        const i1 = Math.min(cols - 1, Math.ceil((f.maxX + BODY_R - R.x0) / GRID));
        const j0 = Math.max(0, Math.floor((f.minZ - BODY_R - R.z0) / GRID));
        const j1 = Math.min(rows - 1, Math.ceil((f.maxZ + BODY_R - R.z0) / GRID));
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
          const x = cellX(i), z = cellZ(j);
          if (x > f.minX - BODY_R && x < f.maxX + BODY_R && z > f.minZ - BODY_R && z < f.maxZ + BODY_R) cell[j * cols + i] = 1;
        }
      }
    }
    function idxOf(x, z) {
      const i = Math.max(0, Math.min(cols - 1, Math.floor((x - R.x0) / GRID)));
      const j = Math.max(0, Math.min(rows - 1, Math.floor((z - R.z0) / GRID)));
      return j * cols + i;
    }
    // nearest FREE cell to (x,z) within `r` metres — used for the door seed
    // and for every entry point (an entry point half a cell off a footprint
    // must not read as unreachable).
    function nearestFree(x, z, r) {
      const rad = Math.ceil((r || 0.8) / GRID);
      const i0 = Math.floor((x - R.x0) / GRID), j0 = Math.floor((z - R.z0) / GRID);
      let best = -1, bd = Infinity;
      for (let i = i0 - rad; i <= i0 + rad; i++) for (let j = j0 - rad; j <= j0 + rad; j++) {
        if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
        const k = j * cols + i;
        if (cell[k]) continue;
        const dx = cellX(i) - x, dz = cellZ(j) - z, d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; best = k; }
      }
      return best;
    }
    function flood(startK) {
      seen.fill(0);
      if (startK < 0) return;
      let head = 0, tail = 0;
      queue[tail++] = startK; seen[startK] = 1;
      while (head < tail) {
        const k = queue[head++];
        const i = k % cols, j = (k / cols) | 0;
        if (i > 0 && !cell[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; queue[tail++] = k - 1; }
        if (i < cols - 1 && !cell[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; queue[tail++] = k + 1; }
        if (j > 0 && !cell[k - cols] && !seen[k - cols]) { seen[k - cols] = 1; queue[tail++] = k - cols; }
        if (j < rows - 1 && !cell[k + cols] && !seen[k + cols]) { seen[k + cols] = 1; queue[tail++] = k + cols; }
      }
    }
    function reachable(p) {
      const cands = entry(p);
      for (let i = 0; i < cands.length; i++) {
        // 0.30 m snap = about one grid cell: enough that a candidate landing
        // half a cell off a footprint still resolves, tight enough that it can
        // never claim a spot propuse's point test would call blocked.
        const k = nearestFree(cands[i].x, cands[i].z, 0.30);
        if (k >= 0 && seen[k]) { p.entry = cands[i]; return true; }
      }
      return false;
    }

    let pass = 0;
    for (;;) {
      mark(pieces);
      // the door seed sits one body-radius INSIDE the room from the doorway
      const inx = dside === "W" ? 1 : dside === "E" ? -1 : 0;
      const inz = dside === "N" ? 1 : dside === "S" ? -1 : 0;
      const sk = nearestFree(DX + inx * (BODY_R + GRID), DZ + inz * (BODY_R + GRID), 1.6);
      flood(sk);
      out.ok = sk >= 0;
      if (!pieces.length || !out.ok) break;
      // drop the LOWEST-PRIORITY unreachable piece and try again — dropping one
      // piece frequently frees the band that reaches the next.
      let worst = -1;
      for (let i = 0; i < pieces.length; i++) {
        if (reachable(pieces[i])) continue;
        if (worst < 0 || pieces[i].prio < pieces[worst].prio) worst = i;
      }
      if (worst < 0) break;
      const gone = pieces.splice(worst, 1)[0];
      gone.why = "unreachable";
      out.dropped.push(gone);
      out.blocked++;
      if (++pass > 24) break;
    }

    out.pieces = pieces;
    out.keepout = KEEPOUT;          // [0] = the door swing; bossoffice pushes the approach corridor
    out.coverage = coverage(pieces);
    out.sparse = out.coverage < DENS_MIN;      // intentional, not a failure
    return out;
  };

  // ============================================================
  //  CBZ.roomFurnish — the same plan, executed through CBZ.furnish.
  // ============================================================
  // Degrade-safe by design: with the shared kit absent nothing is drawn and
  // the caller keeps whatever it drew before (plan.executed === 0). This file
  // never draws furniture itself — CBZ.furnish is the ONE vocabulary.
  // ---- the ratchet ledger. A shared block with no consumers is prose
  // (CLAUDE.md BLOCK LAW #3/#5), and this is the number that says whether the
  // planner is running at all. Read by CBZ.interiorAudit() (city/occupy.js).
  const LED = { calls: 0, planned: 0, executed: 0, pieces: 0, blocked: 0, dropped: 0, seatsInKeepout: 0, empty: 0, programs: {} };
  CBZ.roomPlanAudit = function () {
    const pr = {};
    for (const k in LED.programs) pr[k] = LED.programs[k];
    return {
      calls: LED.calls,                 // roomFurnish invocations
      planned: LED.planned,             // ...that produced at least one piece
      empty: LED.empty,                 // ...that planned nothing at all
      executed: LED.executed,           // CBZ.furnish calls actually made
      pieces: LED.pieces,               // pieces surviving both validation passes
      blocked: LED.blocked,             // pieces DROPPED as unreachable (the roomPlan analogue of propUseAudit().blocked)
      dropped: LED.dropped,             // pieces dropped for any reason (density + reach)
      seatsInKeepout: LED.seatsInKeepout,
      programs: pr,
    };
  };
  CBZ.roomPlanAuditReset = function () {
    LED.calls = LED.planned = LED.executed = LED.pieces = LED.blocked = LED.dropped = LED.seatsInKeepout = LED.empty = 0;
    LED.programs = {};
  };

  CBZ.roomFurnish = function (rect, program, opts) {
    opts = opts || {};
    const plan = CBZ.roomPlan(rect, program, opts);
    plan.executed = 0;
    plan.seatsInKeepout = 0;
    LED.calls++;
    LED.programs[plan.program] = (LED.programs[plan.program] | 0) + 1;
    LED.blocked += plan.blocked | 0;
    LED.dropped += (plan.dropped && plan.dropped.length) | 0;
    LED.pieces += plan.pieces.length;
    if (plan.pieces.length) LED.planned++; else LED.empty++;
    const F = CBZ.furnish;
    if (!F || !plan.pieces.length) return plan;
    const y = (rect && rect.y) || 0;
    for (let i = 0; i < plan.pieces.length; i++) {
      const p = plan.pieces[i];
      const fn = F[p.fn];
      if (typeof fn !== "function") continue;
      const o = {};
      for (const k in p.opts) if (Object.prototype.hasOwnProperty.call(p.opts, k)) o[k] = p.opts[k];
      if (opts.box != null && o.box == null) o.box = opts.box;
      // THE HOST ORIGIN. CBZ.furnish draws at (x, z) in the HOST's space but
      // registers every propuse anchor in WORLD space, and it reads ox/oz/oy to
      // bridge the two (furniture.js:48-50). Dropping them here — which this
      // function did for its whole un-called life — draws the room in the right
      // place and files every seat, bed and cushion at BUILDING-LOCAL
      // coordinates, i.e. in a heap around the world origin. Forward them.
      if (opts.ox != null && o.ox == null) o.ox = opts.ox;
      if (opts.oz != null && o.oz == null) o.oz = opts.oz;
      if (opts.oy != null && o.oy == null) o.oy = opts.oy;
      if (opts.lot != null && o.lot == null) o.lot = opts.lot;
      if (opts.solid != null && o.solid == null) o.solid = opts.solid;
      if (opts.tone != null && o.tone == null) o.tone = opts.tone;
      let r = null;
      // F.lamp's signature is (x, y, z, opts) — a lamp has no front, so it
      // takes NO yaw (city/furniture.js:488). Every other verb is
      // (x, y, z, yaw, opts). Called through the namespace so a kit written
      // with `this` still works.
      try {
        r = (p.fn === "lamp") ? F.lamp(p.x, y, p.z, o) : F[p.fn](p.x, y, p.z, p.yaw, o);
      } catch (e) { r = null; }
      p.result = r || null;
      plan.executed++;
      // Belt and braces: re-file the kit's own seat anchors through the
      // load-order shim, CARRYING THE CUSHION GEOMETRY. propuse dedupes on a
      // decimetre key over the exact same x/y/z the kit passed, so when the kit
      // already registered them this is a no-op returning null (harmless — no
      // caller reads it); when the kit ran before city/propuse.js parsed (the
      // whole world/* block does) this is the only reason the seats exist.
      // Dropping `geom` here would land every one of them in
      // CBZ.propUseAudit().noGeom and give the legacy squat pose.
      if (r && r.seats && r.seats.length) {
        for (let s = 0; s < r.seats.length; s++) {
          const st = r.seats[s];
          if (!st) continue;
          const face = st.face != null ? st.face : (st.yaw != null ? st.yaw : p.yaw);
          const geom = st.cushion != null ? { cushion: st.cushion, floorBelow: 0 } : null;
          const sy = st.y != null ? st.y : y;
          CBZ.roomSeatAnchor(st.x != null ? st.x : p.x, sy, st.z != null ? st.z : p.z,
            face, st.kind || p.fn, o.lot || null, geom);
          // the boss office's approach corridor must stay EMPTY: report any
          // seat the kit landed inside a keepout instead of silently allowing it.
          // The anchor is WORLD, the keepout is the RECT's own space — subtract
          // the host origin or this test silently reads true for every seat in
          // any building that is not sitting on the world origin.
          const kx = st.x - (opts.ox || 0), kz = st.z - (opts.oz || 0);
          for (let k = 0; k < plan.keepout.length; k++) {
            const K = plan.keepout[k];
            if (kx > K.minX && kx < K.maxX && kz > K.minZ && kz < K.maxZ) { plan.seatsInKeepout++; break; }
          }
        }
      }
    }
    LED.executed += plan.executed;
    LED.seatsInKeepout += plan.seatsInKeepout;
    return plan;
  };
})();
