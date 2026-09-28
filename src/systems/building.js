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

   GRIDS: every placement belongs to one grid {id, ox, oz, oy} (see the
   GRIDS block below). Survival uses the global grid (0,0,0), for which all
   of the following is byte-identical; a city plot supplies its own origin.

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
    // B6 (systems/baseclaim.js registers the actual CATALOG entries for these
    // 3 kinds into CBZ.building.CATALOG directly — this file only needs to
    // know their span/slot/support rules, same as every other kind here):
    cupboard: 6,  // tool cupboard — rides a fill cell, same reach as a wall
    container: 6, // storage container — same
    door: 6,      // fills a doorframe's gap — same span as the doorframe itself
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
     GRIDS (PROPERTY + COMPOUNDS wave). Every placement belongs to ONE grid
     {id, ox, oz, oy}: cell (gx,gz) centre is (ox + gx*CELL, oz + gz*CELL),
     storey gy stands on oy + gy*WALL_H. Survival (and anything that passes
     no grid) uses GLOBAL_GRID {id:"g", 0,0,0}: every key string, position
     and support probe on it is byte-identical to the pre-grid file. A city
     plot supplies its own grid (city lots are 30 m and their edges do NOT
     sit on the global 3 m lattice), so a plot's walls land ON the lot edge.

     Occupancy keys on a plot grid are namespaced "<gridId>|gx,gy,gz,slot",
     and EDGE keys are CANONICAL there: the edge shared by two cells has one
     key (a cell's south edge is its southern neighbour's north edge), so a
     plot can never carry two walls on one line. The global grid keeps the
     legacy per-cell "e"+rot keys untouched.
     ============================================================ */
  const GLOBAL_GRID = Object.freeze({ id: "g", ox: 0, oz: 0, oy: 0 });
  function normGrid(gr) {
    if (!gr || gr.id == null || gr.id === "g") return GLOBAL_GRID;
    return { id: String(gr.id), ox: +gr.ox || 0, oz: +gr.oz || 0, oy: +gr.oy || 0 };
  }
  function isGlobal(gr) { return !gr || gr === GLOBAL_GRID || gr.id === "g"; }

  /* ============================================================
     OCCUPANCY — key -> pieceId, + the reverse map remove() needs to clean it
     back up (pieceId -> [keys]; a multi-cell prefab owns one key per covered
     cell). ONLY pieces spawned through CBZ.building.place() ever get an entry
     here — a piece despawned via a direct CBZ.despawnPiece() call bypassing
     CBZ.building.remove() leaves its keys stuck occupied (documented limit).
     ============================================================ */
  const occupancy = new Map();
  const pieceIdToOccKey = new Map();

  function occKey(gx, gy, gz, slot, gr) {
    const k = gx + "," + gy + "," + gz + "," + slot;
    return isGlobal(gr) ? k : gr.id + "|" + k;
  }
  function edgeKey(prefix, gx, gy, gz, rot, gr) {
    if (isGlobal(gr)) return occKey(gx, gy, gz, prefix + rot);
    if (rot === 2) return occKey(gx, gy, gz + 1, prefix + "0", gr);
    if (rot === 1) return occKey(gx + 1, gy, gz, prefix + "3", gr);
    return occKey(gx, gy, gz, prefix + rot, gr);
  }
  // Slot model. Legacy names keep their B1/B6 slots:
  //   wall/doorframe -> edge "e", door -> edge "dr", cupboard -> "tc",
  //   container -> "box", foundation/floor/roof/stairs -> "fill".
  // Kit defs declare def.slot: "edge" (perimeter walls, fences, gates; may
  // span def.span.w edges), "fill" (towers, garages, helipads; may span
  // def.span {w,d} cells), "dep" (deployables that ride a cell without
  // taking its fill: floodlights, stash, bunks) or "cam" (a mount slot on an
  // edge, sat on top of whatever wall holds that edge).
  const LEGACY_EDGE = { wall: "e", doorframe: "e", door: "dr" };
  const LEGACY_CELL = { cupboard: "tc", container: "box" };
  function slotTypeOf(kind, def) {
    if (LEGACY_EDGE[kind]) return "edge";
    if (LEGACY_CELL[kind]) return "cell";
    return (def && def.slot) || "fill";
  }
  function edgeSpanN(def) { return (def && def.span && def.span.w) || 1; }
  function spanOf(def, rot) {
    const s = def && def.span;
    if (!s) return { W: 1, D: 1 };
    const w = s.w || 1, d = s.d || 1;
    return (rot === 1 || rot === 3) ? { W: d, D: w } : { W: w, D: d };
  }
  function edgeDir(rot) {
    return rot === 0 ? { x: 0, z: -1 } : rot === 1 ? { x: 1, z: 0 } : rot === 2 ? { x: 0, z: 1 } : { x: -1, z: 0 };
  }
  // the cells a placement covers (anchor = min corner in world cells)
  function cellsFor(kind, def, gx, gz, rot) {
    const st = slotTypeOf(kind, def);
    const out = [];
    if (st === "edge" || st === "cam") {
      const n = edgeSpanN(def), alongX = (rot === 0 || rot === 2);
      for (let k = 0; k < n; k++) out.push(alongX ? [gx + k, gz] : [gx, gz + k]);
      return out;
    }
    if (st === "fill") {
      const sp = spanOf(def, rot);
      for (let i = 0; i < sp.W; i++) for (let j = 0; j < sp.D; j++) out.push([gx + i, gz + j]);
      return out;
    }
    out.push([gx, gz]);
    return out;
  }
  function keysFor(kind, def, gx, gy, gz, rot, gr) {
    if (LEGACY_EDGE[kind]) return [edgeKey(LEGACY_EDGE[kind], gx, gy, gz, rot, gr)];
    if (LEGACY_CELL[kind]) return [occKey(gx, gy, gz, LEGACY_CELL[kind], gr)];
    const st = slotTypeOf(kind, def);
    const cells = cellsFor(kind, def, gx, gz, rot);
    const out = [];
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (st === "edge") out.push(edgeKey("e", c[0], gy, c[1], rot, gr));
      else if (st === "cam") out.push(edgeKey("cam", c[0], gy, c[1], rot, gr));
      else if (st === "dep") out.push(occKey(c[0], gy, c[1], "dep", gr));
      else out.push(occKey(c[0], gy, c[1], "fill", gr));
    }
    return out;
  }
  // legacy single-slot name, kept for anything that still asks
  function slotFor(kind, rot) {
    if (kind === "wall" || kind === "doorframe") return "e" + rot;
    if (kind === "door") return "dr" + rot;
    if (kind === "cupboard") return "tc";
    if (kind === "container") return "box";
    return "fill";
  }
  function posFor(kind, def, gx, gy, gz, rot, gr) {
    const baseY = gr.oy + gy * WALL_H;
    const st = slotTypeOf(kind, def);
    if (st === "edge" || st === "cam") {
      const n = LEGACY_EDGE[kind] ? 1 : edgeSpanN(def);
      const alongX = (rot === 0 || rot === 2);
      const half = (n - 1) * CELL / 2;
      const cx = gr.ox + gx * CELL + (alongX ? half : 0);
      const cz = gr.oz + gz * CELL + (alongX ? 0 : half);
      const d = edgeDir(rot);
      return { x: cx + d.x * CELL / 2, y: baseY, z: cz + d.z * CELL / 2 };
    }
    if (st === "dep") {
      let x = gr.ox + gx * CELL, z = gr.oz + gz * CELL;
      if (def && def.edgeInset != null) {
        const d = edgeDir(rot);
        x += d.x * (CELL / 2 - def.edgeInset); z += d.z * (CELL / 2 - def.edgeInset);
      }
      return { x: x, y: baseY, z: z };
    }
    const sp = (st === "fill") ? spanOf(def, rot) : { W: 1, D: 1 };
    return { x: gr.ox + (gx + (sp.W - 1) / 2) * CELL, y: baseY, z: gr.oz + (gz + (sp.D - 1) / 2) * CELL };
  }
  // the union of the covered cells' squares: the LAND a placement uses (the
  // ownership test reads this, not the collider, so an edge wall whose
  // thickness straddles the lot line still counts as on your land)
  function cellsRect(kind, def, gx, gz, rot, gr) {
    const cells = cellsFor(kind, def, gx, gz, rot);
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (let i = 0; i < cells.length; i++) {
      const x = gr.ox + cells[i][0] * CELL, z = gr.oz + cells[i][1] * CELL;
      if (x - CELL / 2 < a) a = x - CELL / 2; if (x + CELL / 2 > b) b = x + CELL / 2;
      if (z - CELL / 2 < c) c = z - CELL / 2; if (z + CELL / 2 > d) d = z + CELL / 2;
    }
    return { minX: a, maxX: b, minZ: c, maxZ: d };
  }
  function defFor(kind, gr) {
    const d = CATALOG[kind];
    if (!d) return null;
    return (!isGlobal(gr) && d.city) ? d.city : d;
  }

  // ---- support rules (documented per-kind; see file header for the model) --
  // Every branch returns `stability` (B4): 0 for a ground/root rest, else
  // min(live supporter stability) + 1. floor/roof additionally return
  // `pieceIds` (ALL supporting walls on the cell below).
  function stabilityOf(pieceId) {
    const p = pieceId != null && CBZ.pieces ? CBZ.pieces.get(pieceId) : null;
    return (p && p.stability != null) ? p.stability : 0;
  }
  function groundSupport(x, z, gr) {
    return CBZ.findSupport ? CBZ.findSupport(x, z, gr.oy - 0.5, gr.oy + 0.5) : null;
  }
  function kindAt(gx, gy, gz, slot, gr) {
    const id = occupancy.get(occKey(gx, gy, gz, slot, gr));
    const p = id != null && CBZ.pieces ? CBZ.pieces.get(id) : null;
    return p && p.alive !== false ? p.kind : null;
  }
  function checkSupport(kind, def, gx, gy, gz, cx, cz, rot, gr, pos) {
    if (kind === "foundation") {
      // ground-only, ground floor only: findSupport must land within 0.5m of
      // the grid's ground level at the cell centre.
      if (gy !== 0) return { ok: false };
      const s = groundSupport(cx, cz, gr);
      if (!s) return { ok: false };
      return { ok: true, pieceId: s.pieceId || null, stability: 0 };
    }
    if (kind === "wall" || kind === "doorframe") {
      // a wall/doorframe needs a FILL piece at its own cell + level.
      const fillId = occupancy.get(occKey(gx, gy, gz, "fill", gr));
      if (!fillId) return { ok: false };
      return { ok: true, pieceId: fillId, stability: stabilityOf(fillId) + 1 };
    }
    if (kind === "floor" || kind === "roof") {
      // not over a stair: the slab would be a platform over the stairwell
      // (you walk on air and can never go down) and its collider a ceiling
      // across the climb (nobody gets up)
      if (gy > 0 && kindAt(gx, gy - 1, gz, "fill", gr) === "stairs") return { ok: false };
      if (gy === 0) {
        const s = groundSupport(cx, cz, gr);
        if (!s) return { ok: false };
        return { ok: true, pieceId: s.pieceId || null, stability: 0 };
      }
      // Rust-LENIENT: ONE wall on ANY edge of the cell below is enough; every
      // such wall is wired in (B4 multi-support), stability = min + 1.
      const pieceIds = [];
      let minStability = Infinity;
      for (let r = 0; r < 4; r++) {
        const wid = occupancy.get(edgeKey("e", gx, gy - 1, gz, r, gr));
        if (!wid) continue;
        pieceIds.push(wid);
        const ws = stabilityOf(wid);
        if (ws < minStability) minStability = ws;
      }
      if (!pieceIds.length) return { ok: false };
      return { ok: true, pieceId: pieceIds[0], pieceIds: pieceIds, stability: minStability + 1 };
    }
    if (kind === "stairs") {
      // stairs occupy their own cell's fill slot, so they rest on a fill piece
      // one level down, or bare ground at gy 0. And never under a floor/roof
      // (the same rule as above, from the other side).
      const over = kindAt(gx, gy + 1, gz, "fill", gr);
      if (over === "floor" || over === "roof") return { ok: false };
      if (gy === 0) {
        const s = groundSupport(cx, cz, gr);
        if (!s) return { ok: false };
        return { ok: true, pieceId: s.pieceId || null, stability: 0 };
      }
      const fillId = occupancy.get(occKey(gx, gy - 1, gz, "fill", gr));
      if (!fillId) return { ok: false };
      return { ok: true, pieceId: fillId, stability: stabilityOf(fillId) + 1 };
    }
    // B6: cupboard/container ride a fill cell (own "tc"/"box" slot).
    if (kind === "cupboard" || kind === "container") {
      const fillId = occupancy.get(occKey(gx, gy, gz, "fill", gr));
      if (!fillId) return { ok: false };
      return { ok: true, pieceId: fillId, stability: stabilityOf(fillId) + 1 };
    }
    // B6: door fills a doorframe's gap on the same cell+edge.
    if (kind === "door") {
      const dfId = occupancy.get(edgeKey("e", gx, gy, gz, rot, gr));
      const dfPiece = dfId != null && CBZ.pieces ? CBZ.pieces.get(dfId) : null;
      if (!dfPiece || dfPiece.kind !== "doorframe") return { ok: false };
      return { ok: true, pieceId: dfId, stability: stabilityOf(dfId) + 1 };
    }
    // ---- KIT kinds (def.support) -------------------------------------------
    const sup = def && def.support;
    const st = slotTypeOf(kind, def);
    if (sup === "mount") {
      // a camera sits on top of whatever holds that edge (wall, fence, gate),
      // or on a tower filling the cell (towers carry def.mountY).
      const eid = occupancy.get(edgeKey("e", gx, gy, gz, rot, gr));
      const ep = eid != null ? CBZ.pieces.get(eid) : null;
      if (ep && ep.alive) {
        const ed = ep.defRef || CATALOG[ep.kind] || {};
        const my = ed.mountY != null ? ed.mountY : (ed.y1 != null ? ed.y1 : WALL_H);
        return { ok: true, pieceId: eid, stability: stabilityOf(eid) + 1, mountY: (ep.pos.y - pos.y) + my };
      }
      const fid = occupancy.get(occKey(gx, gy, gz, "fill", gr));
      const fp = fid != null ? CBZ.pieces.get(fid) : null;
      const fd = fp && (fp.defRef || CATALOG[fp.kind]);
      if (fp && fp.alive && fd && fd.mountY != null) {
        return { ok: true, pieceId: fid, stability: stabilityOf(fid) + 1, mountY: (fp.pos.y - pos.y) + fd.mountY };
      }
      return { ok: false, why: "mount it on a wall or a tower" };
    }
    if (sup === "ground") {
      if (st === "fill") {
        // towers, garages, helipads: bare ground only (the pad), never on a slab
        if (gy !== 0) return { ok: false, why: "needs bare ground" };
        const s = groundSupport(pos.x, pos.z, gr);
        if (!s) return { ok: false, why: "needs bare ground" };
        return { ok: true, pieceId: s.pieceId || null, stability: 0 };
      }
      // edge + dep kinds: a slab at this cell+level if there is one, else ground
      const fillId = occupancy.get(occKey(gx, gy, gz, "fill", gr));
      if (fillId) return { ok: true, pieceId: fillId, stability: stabilityOf(fillId) + 1 };
      if (gy !== 0) return { ok: false, why: "needs a floor under it" };
      const s = groundSupport(pos.x, pos.z, gr);
      if (!s) return { ok: false, why: "needs level ground" };
      return { ok: true, pieceId: s.pieceId || null, stability: 0 };
    }
    return { ok: false };
  }

  /* ---- LIVE world-collision test (plot grids / city mode) -------------------
     The static CBZ.placement hash still holds a demolished building's
     reservation, so a cleared lot would read as blocked forever. Plot grids
     ask the LIVE collider set instead: anything solid in the piece's box that
     is not itself a building piece (piece vs piece is the grid's job). */
  const _liveScratch = [];
  function liveBlocker(rect) {
    if (!CBZ.queryCollidersNear) return null;
    const cx = (rect.minX + rect.maxX) / 2, cz = (rect.minZ + rect.maxZ) / 2;
    const r = Math.max(rect.maxX - rect.minX, rect.maxZ - rect.minZ) / 2 + 0.5;
    const near = CBZ.queryCollidersNear(cx, cz, r, _liveScratch);
    const E = 0.08;
    for (let i = 0; i < near.length; i++) {
      const c = near[i];
      if (c.pieceId != null) continue;
      if (c.maxX <= rect.minX + E || c.minX >= rect.maxX - E || c.maxZ <= rect.minZ + E || c.minZ >= rect.maxZ - E) continue;
      const y0 = c.y0 != null ? c.y0 : -Infinity, y1 = c.y1 != null ? c.y1 : Infinity;
      if (y1 <= rect.minY + 0.15 || y0 >= rect.maxY - 0.05) continue;
      return c;
    }
    return null;
  }

  /* ============================================================
     computeValidity(kind, gx, gy, gz, rot, ownerId, grid) — the read-only
     "would this placement succeed, and why not" pass place() runs itself and
     buildmode's ghost asks. Always computes the geometry (keys/pos/footprint/
     rect) even on the hard-fail paths so a red ghost still lands in the right
     place. `reason` is null when ok, else a short plain string.
     "slot already occupied" is the one HARD fail place() enforces even under
     opts.skipValidity (a replayed save can never double-claim a slot).
     ============================================================ */
  function computeValidity(kind, gx, gy, gz, rot, ownerId, grid) {
    const gr = normGrid(grid);
    const def = defFor(kind, gr);
    if (!def) return { ok: false, reason: "unknown kind: " + kind };
    gx |= 0; gy |= 0; gz |= 0;
    rot = ((rot | 0) % 4 + 4) % 4;

    const keys = keysFor(kind, def, gx, gy, gz, rot, gr);
    const key = keys[0];
    const slot = slotFor(kind, rot);
    const cx = gr.ox + gx * CELL, cz = gr.oz + gz * CELL;
    const pos = posFor(kind, def, gx, gy, gz, rot, gr);
    const fp = rotateFP(def.footprint, rot);
    // stackable:true — piece-vs-piece contact is governed by the GRID, not by
    // AABB overlap (see the placement hash's stackable escape hatch).
    const rect = {
      minX: pos.x - fp.hx, maxX: pos.x + fp.hx,
      minZ: pos.z - fp.hz, maxZ: pos.z + fp.hz,
      minY: pos.y + def.y0, maxY: pos.y + def.y1,
      stackable: true,
    };
    const base = { slot: slot, key: key, keys: keys, pos: pos, fp: fp, rect: rect, def: def, grid: gr };
    function fail(reason, sup) { const o = Object.assign({ ok: false, reason: reason }, base); if (sup) o.sup = sup; return o; }

    if (def.cityOnly && isGlobal(gr)) return fail("city only");
    for (let i = 0; i < keys.length; i++) if (occupancy.has(keys[i])) return fail("slot already occupied");

    const cityRules = !isGlobal(gr) || (CBZ.game && CBZ.game.mode === "city");
    // (c) LAND: in the city you only build on a plot you own.
    if (CBZ.game && CBZ.game.mode === "city") {
      const CP = CBZ.cityPlots;
      const land = CP && CP.canBuild ? CP.canBuild(cellsRect(kind, def, gx, gz, rot, gr)) : null;
      if (!land || !land.ok) return fail("not your land");
    }

    // (d) B6 BASE OWNERSHIP GATE — a tool cupboard's claim: only its
    // authorized pids may build inside the radius (soft; replay skips it).
    if (CBZ.baseAt) {
      const placerId = ownerId != null ? ownerId : (CBZ.netPid ? CBZ.netPid() : "solo");
      const rec = CBZ.baseAt(cx, cz);
      if (rec && rec.authorized.indexOf(placerId) < 0) return fail("building blocked (foreign base)");
    }

    const sup = checkSupport(kind, def, gx, gy, gz, cx, cz, rot, gr, pos);
    if (!sup.ok) return fail(sup.why || "no support at this position", sup);
    if (sup.mountY != null) { pos.y += sup.mountY; rect.minY += sup.mountY; rect.maxY += sup.mountY; }
    // B4: structural integrity — too many hops from the nearest root.
    if (sup.stability > maxSpanFor(kind)) return fail("too far from foundation", sup);
    if (cityRules) {
      if (def.slot !== "cam" && liveBlocker(rect)) return fail("something is in the way", sup);
    } else if (!CBZ.placement || !CBZ.placement.isFree(rect)) {
      return fail("blocked by existing geometry", sup);
    }
    const ok = Object.assign({ ok: true, reason: null }, base);
    ok.sup = sup;
    return ok;
  }

  /* ============================================================
     CBZ.building.place(kind, gx, gy, gz, rot, opts) -> Piece | null
       opts: { skipValidity=false, ownerId=null, hp, grid, y } — skipValidity
       is ONLY for serialize()/apply() replay (trust the save); ownerId/hp/y
       let a replayed piece carry its saved owner, damage and height; grid is
       the plot grid {id, ox, oz, oy} (omitted = the global survival grid).
     ============================================================ */
  const B = (CBZ.building = {});
  B.CELL = CELL; B.WALL_H = WALL_H; B.FLOOR_T = FLOOR_T; B.WALL_T = WALL_T;
  B.DOOR_GAP_W = DOOR_GAP_W; B.DOOR_GAP_H = DOOR_GAP_H; // B6: baseclaim.js's door piece sizes itself off the doorframe's own gap
  B.CATALOG = CATALOG;
  B.MAX_SPAN = MAX_SPAN; // exposed read-only for tooling/harness
  B.GLOBAL_GRID = GLOBAL_GRID;
  B.defFor = function (kind, grid) { return defFor(kind, normGrid(grid)); };
  B.spanOf = spanOf;
  B.edgeDir = edgeDir;
  B.slotTypeOf = function (kind) { return slotTypeOf(kind, CATALOG[kind]); };
  // The yaw a piece's mesh is drawn at. Legacy pieces turn +rot quarter
  // turns (their shapes are symmetric, so the mirrored edge convention never
  // showed). Kit pieces (def.kit) have a FRONT: their local -z must point out
  // of the edge rot names (0 north, 1 east, 2 south, 3 west), which is a
  // -rot turn. Buildmode's ghost reads this too.
  B.meshYaw = function (kind, rot, grid) {
    const d = defFor(kind, normGrid(grid));
    return (d && d.kit ? -rot : rot) * (Math.PI / 2);
  };

  // grid coords -> world origin (edge offsets excluded; that is validate().pos)
  B.gridToWorld = function (gx, gy, gz, grid) {
    const gr = normGrid(grid);
    return { x: gr.ox + gx * CELL, y: gr.oy + gy * WALL_H, z: gr.oz + gz * CELL };
  };
  B.worldToCell = function (x, z, grid) {
    const gr = normGrid(grid);
    return { gx: Math.round((x - gr.ox) / CELL), gz: Math.round((z - gr.oz) / CELL) };
  };

  // CBZ.building.validate(kind, gx, gy, gz, rot, ownerId, grid) -> {ok, reason, pos, fp}
  B.validate = function (kind, gx, gy, gz, rot, ownerId, grid) {
    const v = computeValidity(kind, gx, gy, gz, rot, ownerId, grid);
    return { ok: v.ok, reason: v.reason, pos: v.pos || null, fp: v.fp || null, def: v.def || null };
  };

  B.place = function (kind, gx, gy, gz, rot, opts) {
    opts = opts || {};
    if (!CATALOG[kind]) { console.warn("[building] place: unknown kind", kind); return null; }
    gx |= 0; gy |= 0; gz |= 0;
    rot = ((rot | 0) % 4 + 4) % 4;

    const v = computeValidity(kind, gx, gy, gz, rot, opts.ownerId, opts.grid);
    if (v.reason === "slot already occupied" || !v.def) return null;
    if (!opts.skipValidity && !v.ok) return null;

    const def = v.def, gr = v.grid, fp = v.fp, rect = v.rect, keys = v.keys;
    const sup = v.sup || { ok: false };
    const pos = v.pos;
    if (opts.y != null && isFinite(opts.y)) {
      const dy = opts.y - pos.y;
      pos.y = opts.y; rect.minY += dy; rect.maxY += dy;
    }

    const piece = CBZ.spawnPiece(def, {
      pos: pos, rot: rot, kind: kind,
      hp: opts.hp != null ? opts.hp : def.hp,
      maxHp: def.hp,
      tier: def.tier != null ? def.tier : null,
      ownerId: opts.ownerId != null ? opts.ownerId : null,
      solid: def.solid !== false,
      walkTop: !!def.walkTop,
      blockLOS: !!def.blockLOS,
      gridPos: { gx: gx, gy: gy, gz: gz },
      stability: sup.stability != null ? sup.stability : 0,
      maxSpan: maxSpanFor(kind),
    });
    if (!piece) return null;
    piece.defRef = def;
    if (!isGlobal(gr)) piece.grid = { id: gr.id, ox: gr.ox, oz: gr.oz, oy: gr.oy };
    if (def.kit && piece.meshRef) {
      piece.meshRef.rotation.y = -rot * (Math.PI / 2);
      piece.meshRef.updateMatrix();
    }

    // The static placement hash is the SURVIVAL world gate. Plot grids never
    // read it (they test live colliders), so they never write to it either:
    // a reservation there outlives the piece and would haunt the lot.
    if (isGlobal(gr) && CBZ.placement && CBZ.placement.reserve) CBZ.placement.reserve(rect);
    for (let i = 0; i < keys.length; i++) occupancy.set(keys[i], piece.id);
    pieceIdToOccKey.set(piece.id, keys);

    // B4 MULTI-SUPPORT: wire EVERY supporter into supportedBy/supports.
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
      // THE WALK SURFACE IS A CBZ.stairs FLIGHT (systems/stairs.js), and its
      // direction is read off the MESH, not re-derived from `rot`. It used to
      // be re-derived: rot0/rot2 along z, rot1/rot3 along x with uphill
      // "+ for rot 0/1". That matches the wood stair (spawnPiece turns it by
      // +rot*90deg) but the concrete kit stair is turned by -rot*90deg (see
      // def.kit above), so a concrete stair placed at rot 1 or 3 climbed one
      // way on screen and the other way underfoot — you walked up into the
      // back of the treads. The mesh's +z is uphill for both kinds.
      const ry = piece.meshRef ? piece.meshRef.rotation.y : rot * (Math.PI / 2);
      const ux = Math.sin(ry), uz = Math.cos(ry);
      const f = CBZ.stairs && CBZ.stairs.flight({
        bottom: { x: pos.x - ux * CELL / 2, y: pos.y, z: pos.z - uz * CELL / 2 },
        top: { x: pos.x + ux * CELL / 2, y: pos.y + WALL_H, z: pos.z + uz * CELL / 2 },
        width: CELL * 0.9, overlap: 0.3, kind: "stair", owner: "piece:" + piece.id,
        plats: piece.platforms,
      });
      if (f && f.plat) f.plat.pieceId = piece.id;
    }

    // Extension points: the global B6 hook (baseclaim.js), then the def's own
    // (the compound kit keeps its per-kind behaviour on its defs).
    if (CBZ.onPiecePlace) CBZ.onPiecePlace(piece, opts);
    if (def.onPlace) { try { def.onPlace(piece, opts); } catch (e) { console.error("[building] onPlace", kind, e); } }

    return piece;
  };

  // ---- collectCascade: READ-ONLY mirror of pieces.js's despawnPiece cascade
  // BFS, so remove() can clean occupancy for every piece the cascade is ABOUT
  // to kill before despawnPiece defers the real teardown. Kept in lockstep.
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
  // occupancy cleanup + the remove hooks for every piece the cascade kills.
  B.remove = function (pieceId) {
    const p = CBZ.pieces.get(pieceId);
    if (!p || !p.alive) return false;
    const toKill = collectCascade(pieceId);
    toKill.forEach(function (id) {
      const keys = pieceIdToOccKey.get(id);
      if (keys != null) {
        for (let i = 0; i < keys.length; i++) if (occupancy.get(keys[i]) === id) occupancy.delete(keys[i]);
        pieceIdToOccKey.delete(id);
      }
      const kp = CBZ.pieces.get(id);
      if (!kp) return;
      if (CBZ.onPieceRemove) CBZ.onPieceRemove(kp);
      if (kp.defRef && kp.defRef.onRemove) { try { kp.defRef.onRemove(kp); } catch (e) { console.error("[building] onRemove", kp.kind, e); } }
    });
    return CBZ.despawnPiece(pieceId, { cascade: true });
  };

  // who holds this exact placement's first slot (null = free) — blueprints
  // and the kit's own support lookups ask this instead of guessing keys.
  B.occupantAt = function (kind, gx, gy, gz, rot, grid) {
    const gr = normGrid(grid);
    const def = defFor(kind, gr);
    if (!def) return null;
    const keys = keysFor(kind, def, gx | 0, gy | 0, gz | 0, ((rot | 0) % 4 + 4) % 4, gr);
    for (let i = 0; i < keys.length; i++) { const id = occupancy.get(keys[i]); if (id != null) return id; }
    return null;
  };
  B.isBuilt = function (pieceId) { return pieceIdToOccKey.has(pieceId); };

  /* ============================================================
     serialize()/apply() — the world-blob rider (netpersist.js blob.bld and
     basesave.js's single-player ledger). apply() replays through place()
     with validity SKIPPED (trust the save). Plot-grid pieces carry their
     grid {id,ox,oz,oy} and their exact height, so they restore exactly.
     ============================================================ */
  B.serialize = function () {
    const pieces = [];
    CBZ.pieces.forEach(function (p) {
      if (!p.alive || !p.gridPos || pieceIdToOccKey.get(p.id) == null) return; // only building-placed pieces
      const rec = { kind: p.kind, gx: p.gridPos.gx, gy: p.gridPos.gy, gz: p.gridPos.gz, rot: p.rot, hp: p.hp, ownerId: p.ownerId };
      if (p.grid) { rec.grid = { id: p.grid.id, ox: p.grid.ox, oz: p.grid.oz, oy: p.grid.oy }; rec.y = p.pos.y; }
      // generic optional passthrough (baseclaim doors/containers, kit gates/stash)
      if (p.open !== undefined) rec.open = p.open;
      if (p.locked !== undefined) rec.locked = p.locked;
      if (p.contents !== undefined) rec.contents = p.contents;
      pieces.push(rec);
    });
    return { v: 1, pieces: pieces };
  };

  B.apply = function (blob) {
    if (!blob || blob.v !== 1 || !Array.isArray(blob.pieces)) { if (blob) console.warn("[building] apply: blob v" + (blob && blob.v) + " skipped"); return; }
    for (let i = 0; i < blob.pieces.length; i++) {
      const rec = blob.pieces[i];
      if (!rec || !CATALOG[rec.kind]) continue;
      const piece = B.place(rec.kind, rec.gx, rec.gy, rec.gz, rec.rot, { skipValidity: true, ownerId: rec.ownerId, hp: rec.hp, grid: rec.grid || null, y: rec.grid ? rec.y : null, replay: true });
      if (!piece) continue;
      if (rec.open !== undefined) piece.open = rec.open;
      if (rec.locked !== undefined) piece.locked = rec.locked;
      if (rec.contents !== undefined) piece.contents = rec.contents;
      if (CBZ.onPieceReplay) CBZ.onPieceReplay(piece, rec);
      if (piece.defRef && piece.defRef.onReplay) { try { piece.defRef.onReplay(piece, rec); } catch (e) { console.error("[building] onReplay", rec.kind, e); } }
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
