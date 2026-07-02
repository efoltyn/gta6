/* ============================================================
   systems/building.js — CBZ.building: the WOOD-TIER PIECE CATALOG +
   CBZ.building.place() (B1, MASTER-PLAN Part IV.2). ADDITIVE / NEW
   INFRASTRUCTURE built entirely on top of F4 (systems/pieces.js,
   systems/chunks.js), F5 (city/placement.js's Y-ranged rects) and F7's
   proof that spawnPiece works for real compound-box geometry. NO UI
   this step — B2 lands the ghost preview + hotbar that calls place().

   ------------------------------------------------------------------
   THE GRID/EDGE MODEL (Rust-like, deliberately simple):
     • CELL = 3m square cells on an XZ grid. gridPos {gx,gy,gz} is
       AUTHORITATIVE: world x = gx*CELL, z = gz*CELL, y = gy*WALL_H.
       (Per-tier storey heights arrive with material tiers in B5 — wood
       is the only tier this wave, so WALL_H is a flat constant.)
     • rot is 0-3 quarter turns (NOT radians — matches the Piece schema).
     • FILL pieces (foundation/floor/roof/stairs) occupy the whole cell:
       their world pos is the cell CENTER (cx,cz,baseY) regardless of rot.
     • EDGE pieces (wall/doorframe) occupy one of the cell's 4 edges;
       rot SELECTS the edge (0=north/-z, 1=east/+x, 2=south/+z, 3=west/-x)
       and offsets the piece's world pos by CELL/2 off the cell center in
       that direction. Their footprint pre-rotation is defined in the
       CANONICAL rot-0 orientation (long axis local-x); rotateFP() below
       swaps hx/hz for the placement-time world AABB while the MESH's own
       rotation.y (applied by spawnPiece, not by this file) does the
       actual 90/180/270 visual turn — the same split city/assets.js's
       rotatedFootprint() already uses for scatter props.
     • Standing-surface continuity: a FILL piece's world pos.y is always
       gy*WALL_H (the grid formula), but its slab geometry/collider sits
       BELOW that (y0=-thickness, y1=0) so the slab's TOP is flush with
       gy*WALL_H — which is exactly where a wall placed at the same gy
       starts (wall's y0=0, y1=WALL_H). So "foundation at gy=0" and
       "floor at gy=1" both read as "the walking surface AT level gy",
       and a wall at gy always spans up from that surface to the next.
       roof reuses the exact same slab shape as floor (kind differs only
       for label/color + a trivial cosmetic lip).

   OCCUPANCY: one Map "gx,gy,gz,slot" -> pieceId. slot = "fill" for
   foundation/floor/roof/stairs (they compete for the same cell), or
   "e0".."e3" for wall/doorframe (they compete for the same edge). This
   is a SEPARATE bookkeeping layer from CBZ.placement (the real-geometry
   anti-overlap reservation, still used for the world-collision gate) —
   occupancy is building.js's own "is this logical slot already spoken
   for" index and doesn't exist anywhere else.

   STAIRS' RAMP AXIS (B3): CBZ.platforms' `ramp` record grew an optional
   x-axis sibling this step (systems/physics.js:~241, core/interfaces.js
   #4 — additive to the DATA SHAPE, not CBZ.collide's frozen signature):
   {axis:"x", x0,x1,y0,y1} alongside the original z-axis {z0,z1,y0,y1}
   (no axis field = z, unchanged). So all 4 rots now ship: rot 0/2 climb
   along z (unchanged math), rot 1/3 climb along x (NEW, place() below).

   CATALOG REGISTRATION CHOICE: BUILD-PLAN's one-line description says
   "as assets.define entries" — but CBZ.assets.define() (city/assets.js:
   79-101) NORMALIZES its input into a fixed field whitelist (footprint,
   clearance, stackable, y0, y1, noCollide, zone, instanceable, geom,
   material, build) and silently DROPS anything else, including this
   catalog's colliders() (doorframe), hp/cost/solid/walkTop/blockLOS.
   Routing through assets.define would strip exactly the fields this
   system needs. CBZ.building.CATALOG below is therefore the raw,
   full-featured def registry, consumed directly by CBZ.spawnPiece's
   inline-def path (systems/pieces.js's resolveDef already accepts a def
   object OR an assets.js key) — no functionality lost, nothing stripped.
   ------------------------------------------------------------------ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.building) return; // idempotent (same guard idiom as the rest of this family)
  const THREE = window.THREE;

  // ---- grid constants (wood tier; B5 parameterizes per material tier) --
  const CELL = 3;        // metres per cell edge, XZ
  const WALL_H = 2.5;     // metres per storey (wood tier)
  const FLOOR_T = 0.25;   // floor/roof slab thickness
  const WALL_T = 0.2;     // wall/doorframe thickness
  const FOUND_T = 0.3;    // foundation slab thickness
  const DOOR_GAP_W = 1.2; // doorframe walk-through gap, width
  const DOOR_GAP_H = 2.0; // doorframe walk-through gap, height

  const HP = 250; // wood tier — flat for all 6 pieces this wave (B5 wires the material x damage-type table)

  /* ---- STRUCTURAL INTEGRITY (B4) ------------------------------------
     piece.stability = BFS hop count from the nearest foundation/ground
     ROOT (root = 0: a foundation, or any fill piece resting straight on
     the ground). Computed CHEAPLY at place() time — no full-graph BFS
     needed, since a piece's supporter(s) are already placed (and thus
     already carry their own settled stability) by the time this piece
     goes down: stability = min(live supporters' stability) + 1.

     MAX_SPAN bounds how many hops a kind may sit from that root before
     computeValidity rejects it ("too far from foundation") — a flat
     wood-tier table this wave; B5's material tiers replace this one
     table with one per tier (stone/metal spanning further than wood).
     ------------------------------------------------------------------ */
  const MAX_SPAN = {
    foundation: Infinity, // always the root itself — never rejected on distance
    wall: 6,
    floor: 5,
    roof: 5,
    stairs: 5,
    doorframe: 6,
  };
  function maxSpanFor(kind) { return MAX_SPAN[kind] != null ? MAX_SPAN[kind] : Infinity; }

  // Quarter-turn footprint swap — same math as pieces.js's local
  // rotateFootprint / city/assets.js's rotatedFootprint, reimplemented
  // here (integer 0-3 rot, this file's native unit) so building.js has
  // no load-order dependency on either.
  function rotateFP(fp, rot) {
    const q = ((rot % 4) + 4) % 4;
    return (q === 1 || q === 3) ? { hx: fp.hz, hz: fp.hx } : { hx: fp.hx, hz: fp.hz };
  }

  /* ============================================================
     THE CATALOG — 6 wood pieces. Every build(ctx) is DETERMINISTIC
     (shared CBZ.boxGeom/CBZ.cmat caches from world/materials.js, no
     Math.random) and built in LOCAL/CANONICAL (rot-0) space — the
     piece's own rotation.y (applied by spawnPiece) does the turning.
     ============================================================ */
  const CATALOG = {};

  // ---- foundation: CELL x FOUND_T x CELL slab, top flush w/ pos.y ----
  CATALOG.foundation = {
    kind: "foundation", label: "Wood Foundation",
    footprint: { hx: CELL / 2, hz: CELL / 2 },
    y0: -FOUND_T, y1: 0,
    hp: HP, cost: { Wood: 40 }, // data only this wave — B7 wires crafting/inventory deduction
    solid: true, walkTop: true, blockLOS: false,
    build: function (ctx) {
      const m = new THREE.Mesh(CBZ.boxGeom(CELL, FOUND_T, CELL), CBZ.cmat(0x6b4a2b));
      m.position.y = -FOUND_T / 2;
      m.castShadow = true; m.receiveShadow = true;
      ctx.group.add(m);
    },
  };

  // ---- wall: CELL wide x WALL_H x WALL_T, canonical long-axis = local x --
  CATALOG.wall = {
    kind: "wall", label: "Wood Wall",
    footprint: { hx: CELL / 2, hz: WALL_T / 2 },
    y0: 0, y1: WALL_H,
    hp: HP, cost: { Wood: 60 },
    solid: true, walkTop: false, blockLOS: true,
    build: function (ctx) {
      // Returned DIRECTLY (not added to ctx.group) so spawnPiece's
      // blockLOS path registers a real hit-testable Mesh, not an empty
      // Group (THREE.Group.raycast is a no-op — see pieces.js's own
      // blockLOS caveat comment). Same convention as world/crates.js.
      const m = new THREE.Mesh(CBZ.boxGeom(CELL, WALL_H, WALL_T), CBZ.cmat(0x8a6642));
      m.position.y = WALL_H / 2;
      m.castShadow = true; m.receiveShadow = true;
      return m;
    },
  };

  // ---- floor: same slab shape as foundation, requires wall support ----
  CATALOG.floor = {
    kind: "floor", label: "Wood Floor",
    footprint: { hx: CELL / 2, hz: CELL / 2 },
    y0: -FLOOR_T, y1: 0,
    hp: HP, cost: { Wood: 50 },
    solid: true, walkTop: true, blockLOS: false,
    build: function (ctx) {
      const m = new THREE.Mesh(CBZ.boxGeom(CELL, FLOOR_T, CELL), CBZ.cmat(0x9c7a4e));
      m.position.y = -FLOOR_T / 2;
      m.castShadow = true; m.receiveShadow = true;
      ctx.group.add(m);
    },
  };

  // ---- roof: identical geometry model to floor, different kind/colour
  // + a trivial cosmetic overhang lip (per task: "slight overhang okay
  // if trivial") — structurally it's the SAME slab, same support rule.
  CATALOG.roof = {
    kind: "roof", label: "Wood Roof",
    footprint: { hx: CELL / 2, hz: CELL / 2 },
    y0: -FLOOR_T, y1: 0,
    hp: HP, cost: { Wood: 50 },
    solid: true, walkTop: true, blockLOS: false,
    build: function (ctx) {
      const m = new THREE.Mesh(CBZ.boxGeom(CELL, FLOOR_T, CELL), CBZ.cmat(0x5a3c22));
      m.position.y = -FLOOR_T / 2;
      m.castShadow = true; m.receiveShadow = true;
      ctx.group.add(m);
      const lip = new THREE.Mesh(CBZ.boxGeom(CELL + 0.3, 0.08, CELL + 0.3), CBZ.cmat(0x46301a));
      lip.position.y = 0.04;
      ctx.group.add(lip);
    },
  };

  // ---- stairs: CELL-square ramp, gy*WALL_H -> (gy+1)*WALL_H along rot.
  // NOT solid (no box collider — you'd never be able to walk up a solid
  // stair box) and NOT walkTop (the generic flat-top platform is wrong
  // for a slope); place() below pushes a CUSTOM ramp platform record
  // directly, matching city/buildings.js's switchback-stair convention
  // (systems/physics.js:236-241 ramp handling). Visual here is a single
  // tilted deco box — cheap, and collision-irrelevant (the ramp record
  // IS the only walk surface, exactly like buildings.js's stairs).
  CATALOG.stairs = {
    kind: "stairs", label: "Wood Stairs",
    footprint: { hx: CELL / 2, hz: CELL / 2 },
    y0: 0, y1: WALL_H,
    hp: HP, cost: { Wood: 70 },
    solid: false, walkTop: false, blockLOS: false,
    build: function (ctx) {
      const slopeLen = Math.sqrt(CELL * CELL + WALL_H * WALL_H);
      const m = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.92, 0.18, slopeLen), CBZ.cmat(0x8a6642));
      m.position.set(0, WALL_H / 2, 0);
      // Cosmetic tilt only (sign/exact angle not load-bearing — the real
      // walk surface is the ramp platform place() registers separately).
      m.rotation.x = -Math.atan2(WALL_H, CELL);
      m.castShadow = true; m.receiveShadow = true;
      ctx.group.add(m);
    },
  };

  // ---- doorframe: a wall with a DOOR_GAP_W x DOOR_GAP_H walk-through
  // gap. Built as 2 side posts + 1 header (3 boxes). Solid via the NEW
  // def.colliders(ctx) multi-AABB path (systems/pieces.js) instead of
  // the single-footprint default: two full-height side colliders plus a
  // HEIGHT-GATED header collider (y0=DOOR_GAP_H) so the gap between them
  // stays walkable, matching how world/door.js's own door collider is a
  // single box that's added/removed whole (this piece ships STATIC —
  // B-stage open/close swap is future work, noted in the task).
  // blockLOS is intentionally false: build() returns ctx.group (a Group
  // holding 3 sibling meshes, since none of the 3 boxes is a parent of
  // the others) and a Group never registers as an LOS hit (see wall's
  // comment above) — setting blockLOS true here would be a silent no-op,
  // so we don't claim a behaviour we can't deliver this wave.
  CATALOG.doorframe = {
    kind: "doorframe", label: "Wood Doorframe",
    footprint: { hx: CELL / 2, hz: WALL_T / 2 },
    y0: 0, y1: WALL_H,
    hp: HP, cost: { Wood: 70 },
    solid: true, walkTop: false, blockLOS: false,
    colliders: function (ctx) {
      const longIsX = ctx.hx >= ctx.hz;                 // rot0/2: wide along world-x; rot1/3: wide along world-z
      const longHalf = longIsX ? ctx.hx : ctx.hz;       // == CELL/2
      const thinHalf = longIsX ? ctx.hz : ctx.hx;       // == WALL_T/2
      const sideHalf = (longHalf * 2 - DOOR_GAP_W) / 4; // half-width of EACH side post along the long axis
      const off = DOOR_GAP_W / 2 + sideHalf;
      const y1 = ctx.y1 != null ? ctx.y1 : WALL_H;
      function post(sign) {
        return longIsX
          ? { dx: sign * off, dz: 0, hx: sideHalf, hz: thinHalf, y0: 0, y1: y1 }
          : { dx: 0, dz: sign * off, hx: thinHalf, hz: sideHalf, y0: 0, y1: y1 };
      }
      const header = longIsX
        ? { dx: 0, dz: 0, hx: DOOR_GAP_W / 2, hz: thinHalf, y0: DOOR_GAP_H, y1: y1 }
        : { dx: 0, dz: 0, hx: thinHalf, hz: DOOR_GAP_W / 2, y0: DOOR_GAP_H, y1: y1 };
      return [post(-1), post(1), header];
    },
    build: function (ctx) {
      const sideW = (CELL - DOOR_GAP_W) / 2;
      const c = CBZ.cmat(0x74542f);
      const L = new THREE.Mesh(new THREE.BoxGeometry(sideW, WALL_H, WALL_T), c);
      L.position.set(-(DOOR_GAP_W / 2 + sideW / 2), WALL_H / 2, 0);
      L.castShadow = true; L.receiveShadow = true;
      ctx.group.add(L);
      const R = new THREE.Mesh(new THREE.BoxGeometry(sideW, WALL_H, WALL_T), c);
      R.position.set(DOOR_GAP_W / 2 + sideW / 2, WALL_H / 2, 0);
      R.castShadow = true; R.receiveShadow = true;
      ctx.group.add(R);
      const headerH = WALL_H - DOOR_GAP_H;
      const H = new THREE.Mesh(new THREE.BoxGeometry(DOOR_GAP_W, headerH, WALL_T), c);
      H.position.set(0, DOOR_GAP_H + headerH / 2, 0);
      H.castShadow = true; H.receiveShadow = true;
      ctx.group.add(H);
    },
  };

  /* ============================================================
     OCCUPANCY — "gx,gy,gz,slot" -> pieceId, + the reverse map remove()
     needs to clean it back up (pieceId -> occKey). ONLY pieces spawned
     through CBZ.building.place() ever get an entry here — a piece
     despawned via a direct CBZ.despawnPiece() call bypassing
     CBZ.building.remove() will leave its occupancy slot stuck occupied
     (documented limitation, per the task's "keep minimal" steer; no
     onDespawn hook was added to pieces.js for this — every OTHER
     caller of despawnPiece today is world/proptypes-owned debris that
     never touches building occupancy in the first place).
     ============================================================ */
  const occupancy = new Map();
  const pieceIdToOccKey = new Map();

  function occKey(gx, gy, gz, slot) { return gx + "," + gy + "," + gz + "," + slot; }
  function slotFor(kind, rot) { return (kind === "wall" || kind === "doorframe") ? ("e" + rot) : "fill"; }

  // ---- support rules (documented per-kind; see file header for the model) --
  // Every branch now ALSO returns `stability` (B4): 0 for a ground/root
  // rest, else min(live supporter stability) + 1. floor/roof additionally
  // return `pieceIds` (ALL supporting walls on the cell below, not just
  // the first) alongside `pieceId` (kept = pieceIds[0] for backward
  // compatibility with any caller still reading the single-id field).
  function stabilityOf(pieceId) {
    const p = pieceId != null && CBZ.pieces ? CBZ.pieces.get(pieceId) : null;
    return (p && p.stability != null) ? p.stability : 0;
  }
  function checkSupport(kind, gx, gy, gz, cx, cz) {
    if (kind === "foundation") {
      // ground-only, ground floor only: findSupport must land within
      // 0.5m of y=0 at the cell centre (terrain-flatness assumption —
      // deliberately simple, per the task).
      if (gy !== 0) return { ok: false };
      const s = CBZ.findSupport ? CBZ.findSupport(cx, cz, -0.5, 0.5) : null;
      if (!s) return { ok: false };
      return { ok: true, pieceId: s.pieceId || null, stability: 0 };
    }
    if (kind === "wall" || kind === "doorframe") {
      // simplest correct rule (task's own resolution of the ambiguity):
      // a wall/doorframe needs a FILL piece (foundation/floor/roof) at
      // its own cell + level, full stop. Single supporter — stability
      // rides straight off that one fill piece.
      const fillId = occupancy.get(occKey(gx, gy, gz, "fill"));
      if (!fillId) return { ok: false };
      return { ok: true, pieceId: fillId, stability: stabilityOf(fillId) + 1 };
    }
    if (kind === "floor" || kind === "roof") {
      // ground floor (gy===0): same ground rule as foundation (a floor
      // CAN be laid straight on the ground instead of a foundation).
      // Ground-supported fill pieces are ALSO roots (stability 0) — same
      // simplification as foundation, regardless of which candidate
      // findSupport actually picked (ground vs. a piece's platform at
      // the same level).
      if (gy === 0) {
        const s = CBZ.findSupport ? CBZ.findSupport(cx, cz, -0.5, 0.5) : null;
        if (!s) return { ok: false };
        return { ok: true, pieceId: s.pieceId || null, stability: 0 };
      }
      // gy>0: Rust-LENIENT rule — ONE wall on ANY edge of the cell below
      // is enough (not all 4, "for rigor" — explicitly not required).
      // B4 MULTI-SUPPORT: collect EVERY wall on the cell's 4 edges (not
      // just the first) into pieceIds, so losing one still leaves the
      // others wired into supportedBy — pieces.js's recompute then finds
      // the survivor(s) instead of the floor going straight through the
      // old "supportedBy emptied" cascade. stability = min of all of
      // them + 1 (the SHORTEST path to a root wins, same BFS-hop meaning
      // as a single supporter). NOTE: every edge of one cell shares the
      // SAME underlying fill piece, so in THIS wave's grid all sibling
      // supporters of one floor are always stability-EQUAL by
      // construction (min() is still the generally-correct operation —
      // it just never actually has to pick a smaller of two DIFFERENT
      // values until a future wave adds cross-cell/diagonal bracing).
      const pieceIds = [];
      let minStability = Infinity;
      for (let r = 0; r < 4; r++) {
        const wid = occupancy.get(occKey(gx, gy - 1, gz, "e" + r));
        if (!wid) continue;
        pieceIds.push(wid);
        const ws = stabilityOf(wid);
        if (ws < minStability) minStability = ws;
      }
      if (!pieceIds.length) return { ok: false };
      return { ok: true, pieceId: pieceIds[0], pieceIds: pieceIds, stability: minStability + 1 };
    }
    if (kind === "stairs") {
      // INTERPRETATION NOTE: stairs occupy the "fill" slot at their OWN
      // (gx,gy,gz) — they can't also require a fill piece to already be
      // sitting there (that's the very slot they're about to claim), so
      // "stairs need fill at gy" is read here as "stairs need something
      // to rest their base on", mirroring floor/roof's rule one level
      // down: a fill piece at gy-1, or bare ground if gy===0.
      if (gy === 0) {
        const s = CBZ.findSupport ? CBZ.findSupport(cx, cz, -0.5, 0.5) : null;
        if (!s) return { ok: false };
        return { ok: true, pieceId: s.pieceId || null, stability: 0 };
      }
      const fillId = occupancy.get(occKey(gx, gy - 1, gz, "fill"));
      if (!fillId) return { ok: false };
      return { ok: true, pieceId: fillId, stability: stabilityOf(fillId) + 1 };
    }
    return { ok: false };
  }

  /* ============================================================
     computeValidity(kind, gx, gy, gz, rot) — B2 MINIMAL REFACTOR: the
     exact validity block place() always ran, factored out so B2's ghost
     preview can ask "would this placement succeed, and why not" WITHOUT
     actually spawning anything. Byte-identical math to the old inline
     block (this function is a pure extraction, not a rewrite) — it
     always computes the geometry (slot/pos/footprint/rect) even for the
     hard-fail paths (stairs rot 1/3, duplicate slot) so B2 can still
     render a red ghost at the right transform for those cases.

     Returns { ok, reason, slot, key, pos, fp, rect, sup } — sup is only
     present once support was actually checked (i.e. past the hard-fail
     gates). `reason` is null when ok, else a short human string; two
     EXACT reason strings ("slot already occupied" and a "stairs: ..."
     prefix) are HARD fails place() enforces even under opts.skipValidity
     (replay trusts the save for support/world-collision only, never a
     double claim on one logical slot or a structurally-impossible ramp)
     — see place() below.
     ============================================================ */
  function computeValidity(kind, gx, gy, gz, rot) {
    const def = CATALOG[kind];
    if (!def) return { ok: false, reason: "unknown kind: " + kind };
    gx |= 0; gy |= 0; gz |= 0;
    rot = ((rot | 0) % 4 + 4) % 4;

    const slot = slotFor(kind, rot);
    const key = occKey(gx, gy, gz, slot);
    const cx = gx * CELL, cz = gz * CELL, baseY = gy * WALL_H;
    const isEdge = slot !== "fill";
    let pos;
    if (isEdge) {
      switch (rot) {
        case 0: pos = { x: cx, y: baseY, z: cz - CELL / 2 }; break;           // north edge
        case 1: pos = { x: cx + CELL / 2, y: baseY, z: cz }; break;           // east edge
        case 2: pos = { x: cx, y: baseY, z: cz + CELL / 2 }; break;           // south edge
        default: pos = { x: cx - CELL / 2, y: baseY, z: cz }; break;          // west edge (rot 3)
      }
    } else {
      pos = { x: cx, y: baseY, z: cz };
    }

    const fp = rotateFP(def.footprint, rot);
    // stackable:true — piece-vs-piece contact is GOVERNED BY THE GRID
    // (occupancy slots + support rules above), not by AABB overlap: a
    // floor slab genuinely touches the tops of the walls that hold it
    // up, and a wall's base band touches the floor it stands on. The
    // placement hash's stackable escape hatch (placement.js, F5) skips
    // conflicts only when BOTH rects are stackable — so pieces ignore
    // each other here while still hard-colliding with every non-
    // stackable WORLD rect (city lots, prison geometry, scatter).
    const rect = {
      minX: pos.x - fp.hx, maxX: pos.x + fp.hx,
      minZ: pos.z - fp.hz, maxZ: pos.z + fp.hz,
      minY: pos.y + def.y0, maxY: pos.y + def.y1,
      stackable: true,
    };

    if (occupancy.has(key)) return { ok: false, reason: "slot already occupied", slot: slot, key: key, pos: pos, fp: fp, rect: rect };

    const sup = checkSupport(kind, gx, gy, gz, cx, cz);
    if (!sup.ok) return { ok: false, reason: "no support at this position", slot: slot, key: key, pos: pos, fp: fp, rect: rect, sup: sup };
    // B4: structural integrity — reject a placement whose candidate
    // stability (hops from the nearest root) exceeds this kind's
    // MAX_SPAN, so cantilevers/towers can't stack forever off one
    // foundation. Checked AFTER support (a candidate needs a stability
    // number to compare) but BEFORE the world-collision gate (cheaper,
    // and gives B2's ghost the more specific reason first).
    if (sup.stability > maxSpanFor(kind)) return { ok: false, reason: "too far from foundation", slot: slot, key: key, pos: pos, fp: fp, rect: rect, sup: sup };
    if (!CBZ.placement || !CBZ.placement.isFree(rect)) return { ok: false, reason: "blocked by existing geometry", slot: slot, key: key, pos: pos, fp: fp, rect: rect, sup: sup };

    return { ok: true, reason: null, slot: slot, key: key, pos: pos, fp: fp, rect: rect, sup: sup };
  }

  /* ============================================================
     CBZ.building.place(kind, gx, gy, gz, rot, opts) -> Piece | null
       opts: { skipValidity=false, ownerId=null, hp } — skipValidity is
       ONLY for serialize()/apply() replay (trust the save); ownerId/hp
       let a replayed piece carry its saved owner + damage state.
     ============================================================ */
  const B = (CBZ.building = {});
  B.CELL = CELL; B.WALL_H = WALL_H; B.FLOOR_T = FLOOR_T; B.WALL_T = WALL_T;
  B.CATALOG = CATALOG;
  B.MAX_SPAN = MAX_SPAN; // exposed read-only for tooling/harness/B5 (per-tier scaling)

  // Convenience for B2's ghost preview: grid coords -> world origin
  // (the SAME formula as the file-header contract; exposed so callers
  // never hand-roll it).
  B.gridToWorld = function (gx, gy, gz) { return { x: gx * CELL, y: gy * WALL_H, z: gz * CELL }; };

  // B2: CBZ.building.validate(kind, gx, gy, gz, rot) -> {ok, reason} —
  // the read-only preview building.place() itself now runs internally.
  // Also carries `pos` (world transform, edge-offset included) so B2's
  // ghost mesh never has to re-derive the wall/doorframe edge offset by
  // hand; that's additive beyond the documented {ok,reason} contract, not
  // a replacement for it.
  B.validate = function (kind, gx, gy, gz, rot) {
    const v = computeValidity(kind, gx, gy, gz, rot);
    return { ok: v.ok, reason: v.reason, pos: v.pos || null, fp: v.fp || null };
  };

  B.place = function (kind, gx, gy, gz, rot, opts) {
    opts = opts || {};
    const def = CATALOG[kind];
    if (!def) { console.warn("[building] place: unknown kind", kind); return null; }
    gx |= 0; gy |= 0; gz |= 0;
    rot = ((rot | 0) % 4 + 4) % 4;

    const v = computeValidity(kind, gx, gy, gz, rot);

    // HARD fail — enforced even under opts.skipValidity (a replayed save
    // still can't double-claim a slot); support/world-collision are the
    // only trust-the-save skip. (B3: the old "stairs rot 1/3 unsupported"
    // hard fail is gone now that the x-axis ramp exists — see below.)
    if (v.reason === "slot already occupied") return null;
    if (!opts.skipValidity && !v.ok) return null;

    const pos = v.pos, fp = v.fp, rect = v.rect, sup = v.sup, key = v.key;

    const piece = CBZ.spawnPiece(def, {
      pos: pos, rot: rot, kind: kind,
      hp: opts.hp != null ? opts.hp : def.hp,
      maxHp: def.hp,
      ownerId: opts.ownerId != null ? opts.ownerId : null,
      solid: def.solid !== false,
      walkTop: !!def.walkTop,
      blockLOS: !!def.blockLOS,
      gridPos: { gx: gx, gy: gy, gz: gz },
      // B4: stability/maxSpan live ON the piece (pieces.js stays generic —
      // it only ever compares these two numbers, never re-derives them).
      stability: sup.stability != null ? sup.stability : 0,
      maxSpan: maxSpanFor(kind),
    });
    if (!piece) return null;

    // reserve() ALWAYS runs (even under skipValidity/replay) — a loaded
    // world's footprints must still block future real-time placements.
    if (CBZ.placement && CBZ.placement.reserve) CBZ.placement.reserve(rect);
    occupancy.set(key, piece.id);
    pieceIdToOccKey.set(piece.id, key);

    // B4 MULTI-SUPPORT: wire EVERY supporter into supportedBy/supports —
    // sup.pieceIds (floor/roof, may hold >1 wall) when present, else the
    // single sup.pieceId (wall/doorframe/stairs/foundation, or null on
    // bare ground — nothing to wire).
    if (sup.ok) {
      const supporterIds = (sup.pieceIds && sup.pieceIds.length) ? sup.pieceIds : (sup.pieceId ? [sup.pieceId] : []);
      for (let i = 0; i < supporterIds.length; i++) {
        const sid = supporterIds[i];
        piece.supportedBy.push(sid);
        const sp = CBZ.pieces.get(sid);
        if (sp) sp.supports.push(piece.id);
      }
    }

    if (kind === "stairs") {
      // Custom RAMP platform (systems/physics.js's groundAt ramp handling,
      // core/interfaces.js #4) — NOT the generic walkTop flat-top path.
      // rot0/rot2 climb along z (unchanged); rot1/rot3 climb along x (B3 —
      // physics.js's ramp parsing grew an optional axis:"x" sibling for
      // exactly this). dir is "which way is uphill" along the climb axis:
      // rot0 → +z, rot2 → -z, rot1 → +x, rot3 → -x.
      const onXAxis = (rot === 1 || rot === 3);
      const dir = (rot === 0 || rot === 1) ? 1 : -1;
      const rampShape = onXAxis
        ? { axis: "x", x0: dir > 0 ? pos.x - CELL / 2 : pos.x + CELL / 2, x1: dir > 0 ? pos.x + CELL / 2 : pos.x - CELL / 2, y0: pos.y, y1: pos.y + WALL_H }
        : { z0: dir > 0 ? pos.z - CELL / 2 : pos.z + CELL / 2, z1: dir > 0 ? pos.z + CELL / 2 : pos.z - CELL / 2, y0: pos.y, y1: pos.y + WALL_H };
      const ramp = {
        minX: pos.x - fp.hx, maxX: pos.x + fp.hx,
        minZ: pos.z - fp.hz, maxZ: pos.z + fp.hz,
        top: pos.y + WALL_H,
        ramp: rampShape,
        pieceId: piece.id,
      };
      CBZ.platforms.push(ramp);
      piece.platforms.push(ramp); // keep the piece's own bookkeeping array in sync (reapDrain filters CBZ.platforms globally by pieceId, so cleanup works either way — this just keeps piece.platforms truthful)
    }

    return piece;
  };

  // ---- collectCascade: READ-ONLY mirror of pieces.js's despawnPiece
  // cascade BFS (systems/pieces.js:274-299), duplicated here so
  // CBZ.building.remove() can clean occupancy for every piece a cascade
  // is ABOUT to kill BEFORE calling despawnPiece (which only marks
  // !alive + queues the actual array/mesh teardown for the next reap
  // drain — occupancy cleanup can't wait for that deferred pass without
  // a lookup miss on this same collectCascade). Kept in exact lockstep
  // with pieces.js's algorithm on purpose; if that BFS ever changes,
  // this one must change with it (no shared helper was factored out,
  // per the task's "keep minimal" steer).
  function collectCascade(rootId) {
    const toKill = new Set([rootId]);
    const queue = [rootId];
    while (queue.length) {
      const cur = queue.shift();
      const curPiece = CBZ.pieces.get(cur);
      if (!curPiece || !curPiece.supports) continue;
      for (let i = 0; i < curPiece.supports.length; i++) {
        const depId = curPiece.supports[i];
        if (toKill.has(depId)) continue;
        const dep = CBZ.pieces.get(depId);
        if (!dep || !dep.alive) continue;
        let stillSupported = false;
        const sb = dep.supportedBy || [];
        for (let j = 0; j < sb.length; j++) {
          const sid = sb[j];
          if (toKill.has(sid)) continue;
          const sp = CBZ.pieces.get(sid);
          if (sp && sp.alive) { stillSupported = true; break; }
        }
        if (!stillSupported) { toKill.add(depId); queue.push(depId); }
      }
    }
    return toKill;
  }

  // CBZ.building.remove(pieceId) -> bool — despawnPiece(cascade:true) +
  // occupancy cleanup for every piece the cascade kills.
  B.remove = function (pieceId) {
    const p = CBZ.pieces.get(pieceId);
    if (!p || !p.alive) return false;
    const toKill = collectCascade(pieceId);
    toKill.forEach(function (id) {
      const key = pieceIdToOccKey.get(id);
      if (key != null) { occupancy.delete(key); pieceIdToOccKey.delete(id); }
    });
    return CBZ.despawnPiece(pieceId, { cascade: true });
  };

  /* ============================================================
     serialize()/apply() — the world-blob rider (netpersist.js's
     blob.bld, wired beside blob.fam's established pattern). apply()
     replays through place() with validity SKIPPED entirely (trust the
     save) but STILL reserves real geometry footprints (see place()'s
     comment on `opts.skipValidity`).
     ============================================================ */
  B.serialize = function () {
    const pieces = [];
    CBZ.pieces.forEach(function (p) {
      if (!p.alive || !p.gridPos || pieceIdToOccKey.get(p.id) == null) return; // only building-placed pieces
      pieces.push({ kind: p.kind, gx: p.gridPos.gx, gy: p.gridPos.gy, gz: p.gridPos.gz, rot: p.rot, hp: p.hp, ownerId: p.ownerId });
    });
    return { v: 1, pieces: pieces };
  };

  B.apply = function (blob) {
    if (!blob || blob.v !== 1 || !Array.isArray(blob.pieces)) { if (blob) console.warn("[building] apply: blob v" + (blob && blob.v) + " — skipped"); return; }
    for (let i = 0; i < blob.pieces.length; i++) {
      const rec = blob.pieces[i];
      B.place(rec.kind, rec.gx, rec.gy, rec.gz, rec.rot, { skipValidity: true, ownerId: rec.ownerId, hp: rec.hp });
    }
  };

  /* ============================================================
     CBZ.buildingSelfTest() — dev console sanity check (NOT auto-run).
     Places a foundation -> wall -> floor chain at a far-out test cell
     (away from any real city geometry, same convention as pieces.js's
     own selfTest), checks occupancy rejects a duplicate foundation and
     rejects an unsupported floor elsewhere, then cascade-removes the
     foundation and checks all 3 pieces died AND occupancy is empty.
     ============================================================ */
  CBZ.buildingSelfTest = function () {
    const result = { ok: true, steps: [], errors: [] };
    function log(msg) { result.steps.push(msg); }

    const GX = 33334, GZ = 33334; // far out (world ~100,000m), empty space — mirrors pieces.js's testX/testZ=100000 convention

    const f = B.place("foundation", GX, 0, GZ, 0);
    if (!f) { result.ok = false; result.errors.push("foundation placement failed"); log("FAIL: " + result.errors.join("; ")); return result; }
    log("placed foundation " + f.id + " @ " + JSON.stringify(f.pos));

    const dup = B.place("foundation", GX, 0, GZ, 0);
    if (dup) { result.ok = false; result.errors.push("duplicate foundation should have been rejected, got " + dup.id); }
    else log("duplicate foundation correctly rejected (occupancy)");

    const w = B.place("wall", GX, 0, GZ, 0);
    if (!w) { result.ok = false; result.errors.push("wall placement (on foundation) failed"); }
    else log("placed wall " + w.id + " supportedBy=" + JSON.stringify(w.supportedBy));

    const flBad = B.place("floor", GX + 50, 1, GZ, 0);
    if (flBad) { result.ok = false; result.errors.push("floor with no wall support (unrelated cell) should have been rejected"); }
    else log("unsupported floor correctly rejected");

    const fl = B.place("floor", GX, 1, GZ, 0);
    if (!fl) { result.ok = false; result.errors.push("floor placement (on wall at gy-1) failed"); }
    else log("placed floor " + fl.id + " supportedBy=" + JSON.stringify(fl.supportedBy));

    B.remove(f.id);
    if (CBZ._piecesReapDrain) CBZ._piecesReapDrain(); // synchronous drain for an immediate result (normally the next onUpdate(89) tick)

    if (CBZ.pieces.has(f.id) || (w && CBZ.pieces.has(w.id)) || (fl && CBZ.pieces.has(fl.id))) {
      result.ok = false; result.errors.push("cascade remove did not kill all 3 pieces");
    } else log("cascade remove killed foundation+wall+floor");

    const keys = [occKey(GX, 0, GZ, "fill"), occKey(GX, 0, GZ, "e0"), occKey(GX, 1, GZ, "fill")];
    const stuck = keys.filter(function (k) { return occupancy.has(k); });
    if (stuck.length) { result.ok = false; result.errors.push("occupancy not cleaned: " + stuck.join(", ")); }
    else log("occupancy cleaned for all 3 keys");

    result.ok ? log("PASS") : log("FAIL: " + result.errors.join("; "));
    if (window.console) console.log("[buildingSelfTest]", result.ok ? "PASS" : "FAIL", result);
    return result;
  };
})();
