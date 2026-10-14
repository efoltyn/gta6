/* ============================================================
   systems/pushables.js — FURNITURE MOVES WHEN YOU WALK INTO IT.

   OWNER: "All assets should be movable... I'm talking physics, not another
   f***ing button."

   `systems/physics.js` keeps the world as static AABBs in a rebuilt
   broadphase grid, and the only solids that had ever MOVED were doors —
   `world/door.js` splices its collider in and out of `CBZ.colliders` and calls
   `CBZ.markCollidersDirty()`; every sliding leaf in the engine does the same.
   That is the whole precedent, and it is enough: a collider is a plain record,
   the grid is rebuilt on a dirty flag, and nothing anywhere caches a box's
   coordinates. So a pushable prop is not a new physics engine. It is the door
   trick, run every frame, driven by CONTACT instead of by a lock.

   THE RULES, and every one of them is a number a body can feel:

     CONTACT ONLY. There is no prompt, no key, no [E], no HUD. A prop moves
     when a moving body is touching it and moving INTO it, and by exactly the
     component of that body's velocity that points at the prop. Stand still
     against a stool and it stays where it is, because you are not pushing it.

     MASS IS THE WHOLE DESIGN. `PUSH_REF` is the mass a walk shoves at full
     speed. Everything else is that ratio: a 4 kg bucket skitters, a 9 kg stool
     slides, a 45 kg bench grudges along at a third of your pace, a 110 kg
     loaded trolley scrapes. Below MIN_V the shove does not overcome the prop
     at all and NOTHING HAPPENS — which is why a bunk, a locker, a cage and
     every bolted table stay planted. The realism is the DIFFERENCE; a world
     where everything slides equally is as fake as one where nothing does.

     THE COLLIDER GOES WITH IT. The record in `CBZ.colliders` is translated by
     the same delta as the mesh and the grid is dirtied once per frame, so the
     moved prop is instantly real to everything that reads the world through
     collision: the player's own depenetration, every actor steering around it,
     `CBZ.characterTraversal`'s vault/mantle probe, the vent and wall probes,
     `CBZ.queryCollidersNear`. Nothing has to be told.

     ITS PURPOSE GOES WITH IT TOO. A stool that carries a sit anchor drags the
     anchor along, so where you leave the furniture is where a body sits down.
     Furniture that keeps its meaning after it moves is the whole difference
     between a physics toy and a place.

     IT CANNOT LEAVE ITS ROOM. Walls stop it because walls are colliders and
     the prop is resolved against them exactly like a body is; `leash` and the
     optional `room` rect are the belt-and-braces so a stool cannot be herded
     down a corridor and out of the world by a determined player.

   WHOSE PROP IS IT. A registration may name the `mode` it belongs to, and a
   prop is inert in every other mode — which is how one engine can hold two
   games' furniture in the same array, at OVERLAPPING COORDINATES, without
   either knowing about the other. No `mode` means "always live", which is the
   right answer for a one-shot page that has only one.

   WHO CAN PUSH. The player always; beyond that `CBZ.pushables.pushers` names
   the actor rosters to sweep (`CBZ.npcs`, `CBZ.guards` by default) and a game
   with its own roster passes a function instead. Anything that aims a body at
   a stool pushes the stool — that is why nothing else has to know this file
   exists.

   COST. Distance-gated to `ACTIVE_R` of the player, plus whatever is still
   sliding. A quiet frame is one squared-distance test per registered prop (a
   few dozen) and nothing else. Zero allocation on the hot path, no rng — the
   motion is a pure function of contact, so two clients on one seed that see
   the same shove get the same slide.

   LOOSE PIECES (OWNER: "You run over chairs, chairs don't fall over, they
   have no colliders"). piece(spec) is the same record with two additions,
   so a chair is not a second physics system either:
     - ONE DRAW CALL PER KIND PER ROOM. The piece's boxes are recorded once
       into a cached geometry (spec.key + spec.build) and every copy is an
       instance of one InstancedMesh parented to the host group. A pushed
       chair rewrites one instance matrix; nothing is re-merged.
     - IT FALLS OVER. A light piece (spec.tip) hit at a run or by a car tips
       about the bottom edge it is driven toward, lies on its back with a low
       collider where it lies, and its seat stops being a seat until a fresh
       run stands it back up.
   Cars push too: a car inside ACTIVE_R of you that overlaps a loose piece
   flings it along its own travel (and tips it). The collider a piece mints
   is tagged `pushProp`, which vehicles.js skips: a chair is never a wall to
   a bumper. Records sit in a 16 m grid, so a quiet frame touches the 3x3
   cells round you and nothing else, however many offices the city has.
   Lifetime is the host's: the collider is filed on the host's own ledger
   (spec.ledger) so the host's teardown takes it, and removeOwner(owner)
   drops the records (fit-out floors call it when a floor is freed).

   Flag PUSH_PROPS_V1. Ratchet CBZ.pushPropAudit().escaped — props that ended
   up outside their own leash/room, i.e. furniture that got away — pinned at 0,
   and .standLost — a standable top that drifted off its own prop, i.e. thin
   air where the stool used to be — pinned at 0.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.PUSH_PROPS_V1 == null) CFG.PUSH_PROPS_V1 = true;
  if (CBZ.pushables) return;                  // idempotent (family guard idiom)

  const props = [];
  CBZ.pushProps = props;

  /* ---- the physical constants, each answering for itself -----------------
     A shove is `drive · efficiency · (PUSH_REF / mass)`, capped at the pusher's
     own speed. Walk speed on foot is ~2.0 m/s and a sprint 3.4, which makes
     the table concrete:

       cone     2.5 kg   1.60 m/s walked   — skitters off your shin
       bucket   4   kg   1.60             — same, it is under the cap
       stool    9   kg   1.60             — slides a clear half metre a step
       bench   45   kg   0.50             — a scrape you lean into
       trolley 110 kg    0.20             — grudging; RUN at it for 0.35
       >150 kg          under MIN_V       — planted. A bunk is not furniture
                                            you rearrange, it is part of the room.

     That last row is the point of the whole table: the realism is the
     DIFFERENCE. Everything sliding equally is exactly as fake as nothing
     sliding at all, and the mass column is the only thing anyone has to tune. */
  const PUSH_REF = 14;        // kg: the mass a body on foot moves at full drive
  const PUSH_EFF = 0.80;      // what survives the awkwardness of shoving with a shin
  const MIN_V = 0.18;         // m/s: below this the shove never breaks stiction
  const MIN_DRIVE = 0.35;     // m/s: a body barely moving is not shoving anything
  const DAMP = 7.0;           // s^-1: steel/plastic on a concrete floor stops fast
  const STOP_V = 0.06;        // m/s: park it
  const SKIN = 0.12;          // m: contact band outside the body's own radius
  const ACTIVE_R = 8.0;       // m from the player: outside this nothing is tested
  const ACTIVE_R2 = ACTIVE_R * ACTIVE_R;
  const MAX_STEP = 0.22;      // m per frame: a shove can never tunnel a prop through a wall
  const BODY_LOW = 0.10, BODY_HIGH = 1.75;   // the band a standing body pushes with
  const SHOE = 0.10;          // m the standable top is inset from the collider face
  // FALLING OVER. A body only knocks a chair flat when it arrives faster than
  // a walk (a sprint drives ~3.4 m/s, a walk ~2.0), and only a piece light
  // enough to be bowled (TIP_MASS). A car at any real speed does it.
  const TIP_DRIVE = 2.8;      // m/s of drive INTO the piece that tips it
  const TIP_MASS = 16;        // kg: heavier than this slides, it never tips
  const TIP_DUR = 0.42;       // s from upright to lying (accelerating, a fall)
  const CAR_MIN_V = 1.2;      // m/s: a car slower than this nudges, it does not fling
  const CAR_HW = 1.0, CAR_HL = 2.3;   // a car's half width / half length (m)
  const CELL = 16;            // m: grid cell (> ACTIVE_R so 3x3 cells cover it)

  const qnear = [];
  let dirty = false, platDirty = false, movingCount = 0, escaped = 0;

  function meshCollider(m) {
    return (m && m.userData && m.userData.collider) || null;
  }
  // a prop belongs to a mode, or to all of them
  function live(r) {
    return !r.mode || !CBZ.game || CBZ.game.mode === r.mode;
  }
  /* A COLLIDER MAY BELONG TO A WORLD THE RUNNING MODE HAS NOT BUILT — its
     record is still in the array, and resolving furniture against it would
     wall off a room that is not there. `systems/physics.js` already skips
     those by the same flag; this table is the mapping from flag to the mode
     that owns it, so a future world adds a row rather than editing the loop. */
  const DORMANT = [["_city", "city"]];
  function dormant(c) {
    const mode = CBZ.game && CBZ.game.mode;
    if (!mode) return 0;
    for (let i = 0; i < DORMANT.length; i++) if (c[DORMANT[i][0]] && mode !== DORMANT[i][1]) return 1;
    return 0;
  }

  /* ---- REGISTER ---------------------------------------------------------
     spec.parts   meshes that move as one body (required)
     spec.x/z     authored centre (defaults to parts[0])
     spec.hx/hz   half-extents of the pushed footprint
     spec.y0/y1   the collider's vertical band (a low prop you brush past keeps
                  its top under physics.js's feet sample and is never a wall)
     spec.mass    kg — the only tuning knob that matters
     spec.mode    the mode this prop is furniture in (omit = every mode)
     spec.solid   create a collider when the art was drawn non-solid
     spec.col     adopt this collider instead of looking one up on the parts
     spec.leash   metres it may stray from where it was built (default 4)
     spec.room    hard rect it may never leave
     spec.seat    {x,z} of a sit anchor that rides along
     spec.stand   this prop's top holds a man — see STANDABLE below
     Returns the record, or null when the flag is off / the spec is empty. */
  function add(spec) {
    if (!CFG.PUSH_PROPS_V1 || !spec) return null;
    const parts = spec.parts && spec.parts.length ? spec.parts.filter(Boolean) : null;
    if (!parts || !parts.length) return null;
    const p0 = parts[0];
    const x = spec.x != null ? spec.x : p0.position.x;
    const z = spec.z != null ? spec.z : p0.position.z;
    return enrol(spec, parts, x, z);
  }
  function enrol(spec, parts, x, z) {
    const p0 = parts ? parts[0] : null;
    const hx = spec.hx != null ? spec.hx : 0.25, hz = spec.hz != null ? spec.hz : 0.25;
    const y0 = spec.y0 != null ? spec.y0 : 0, y1 = spec.y1 != null ? spec.y1 : 0.5;

    // the collider: adopt one the art already registered, else mint one here.
    // A minted box carries y0/y1 so it is an OBSTACLE at shin height and not a
    // full-height pillar — the same height-gating a mess stool already uses.
    let col = spec.col || (p0 ? meshCollider(p0) : null) || null;
    for (let i = 1; !col && parts && i < parts.length; i++) col = meshCollider(parts[i]);
    let ledgered = false;
    if (!col && spec.solid !== false) {
      col = { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, y0: y0, y1: y1, ref: p0 || spec.ref || null };
      // a loose piece's collider is a body to push, never a wall: vehicles.js
      // skips `pushProp` (the car pushes it here instead) and the breach /
      // carve passes skip `noBreach`
      if (!parts) { col.pushProp = true; col.noBreach = true; }
      (CBZ.colliders || (CBZ.colliders = [])).push(col);
      if (p0) p0.userData.collider = col;
      // the HOST's ledger: its teardown splices it out of CBZ.colliders with
      // its own walls (fitout.js freeFloor, a building's `colliders`)
      if (spec.ledger && spec.ledger.push) { spec.ledger.push(col); ledgered = true; }
      dirty = true;
    }
    // a collider drawn without a band would be a full-height wall the moment it
    // moved into a doorway; give it the band its own art implies.
    if (col && col.y0 == null) { col.y0 = y0; col.y1 = Math.max(y1, col.y1 || y1); }

    // THE BATCHER AND THE FREEZER BOTH HAVE TO BE TOLD. core/batch.js bakes any
    // untagged mesh into a merged static buffer and core/staticfreeze.js clears
    // matrixAutoUpdate on it — either one silently welds a "pushable" to the
    // floor. `mover` is losgrid.js's own tag for a solid whose AABB is
    // re-derived per cast. This is the same declaration every sliding leaf in
    // the engine makes, for the same reason.
    for (let i = 0; parts && i < parts.length; i++) {
      const m = parts[i];
      m.userData.dynamic = true;
      m.userData.mover = true;
      m.matrixAutoUpdate = true;
    }

    /* ---- STANDABLE ------------------------------------------------------
       OWNER's dream case, in his words: shove a stool to a wall, climb it,
       reach the vent. That needs the prop's TOP to be ground — and the engine
       has had exactly one contract for that since systems/pieces.js shipped
       `walkTop:true`: a record in `CBZ.platforms`, which physics.js's
       groundAt() raises the floor to when it is within STEP_UP of your feet.
       So a standable pushable is not a new mechanic either; it is that record,
       translated by the same delta as the mesh, the collider and the seat.

       WHY IT IS DECLARED AND NOT SNIFFED. "Anything with a flat top" would
       enrol traffic cones (tapered), a bucket (0.36 m square — a foot, not a
       stance) and a coat post. The rule is the one a carpenter would use and
       the call site is the only place that knows it: a bench, a stool, a
       barrel end. Everything else stays furniture you kick, and the difference
       is the point — same argument as the mass table.

       The platform is inset by SHOE from the collider footprint so the man
       standing on a stool is standing INSIDE it, never balanced on the lip
       where his own capsule is being depenetrated sideways off the box. */
    let plat = null;
    if (spec.stand && CBZ.platforms) {
      const ix = Math.max(0.06, hx - SHOE), iz = Math.max(0.06, hz - SHOE);
      plat = { minX: x - ix, maxX: x + ix, minZ: z - iz, maxZ: z + iz, top: y1, pushProp: true };
      CBZ.platforms.push(plat);
    }

    const rec = {
      parts: parts, col: col, kind: spec.kind || "prop", mode: spec.mode || null,
      mass: Math.max(1, spec.mass || 12),
      x: x, z: z, hx: hx, hz: hz, y0: y0, y1: y1,
      vx: 0, vz: 0, plat: plat,
      homeX: x, homeZ: z, leash: spec.leash != null ? spec.leash : 4.0,
      room: spec.room || null,
      seatAt: spec.seat || null, seat: spec.seatRec || null, seatSolved: !!spec.seatRec,
      moved: 0,                       // total metres this prop has been shoved
      owner: spec.owner || null, ledgered: ledgered,
      // FALLING OVER (pooled pieces): tipOK, and the state of a fall
      tipOK: !!spec.tip && (spec.mass || 12) <= TIP_MASS, tipS: 0, tipT: 0, tipA: 0, tax: 0, taz: 0,
      tdx: 0, tdz: 0, pdx: 0, pdz: 0, ext: 0,
      h: spec.h != null ? spec.h : (y1 - y0), h0: y1 - y0, ext0x: hx, ext0z: hz,
      // the upright centre (a fall moves the collider, not this)
      ux: x, uz: z, fy: spec.y != null ? spec.y : y0, yaw: spec.yaw || 0,
      pool: null, slot: -1, offX: spec.ox || 0, offZ: spec.oz || 0, offY: spec.oy || 0,
      cell: null, _carT: 0, _near: 0,
    };
    props.push(rec);
    gridAdd(rec);
    return rec;
  }

  /* ---- THE GRID ---------------------------------------------------------
     16 m cells keyed by integer pair. A quiet frame reads the 3x3 cells round
     the player and nothing else; a prop that slides into another cell is
     re-filed by translate(). */
  const GRID = new Map();
  function cellOf(v) { return Math.floor(v / CELL); }
  function cellKey(cx, cz) { return cx * 100003 + cz; }
  function gridAdd(r) {
    const k = cellKey(cellOf(r.x), cellOf(r.z));
    let a = GRID.get(k);
    if (!a) { a = []; GRID.set(k, a); }
    a.push(r); r.cell = k;
  }
  function gridDel(r) {
    const a = GRID.get(r.cell);
    if (a) { const i = a.indexOf(r); if (i >= 0) { a[i] = a[a.length - 1]; a.pop(); } if (!a.length) GRID.delete(r.cell); }
    r.cell = null;
  }
  function gridMove(r) {
    const k = cellKey(cellOf(r.x), cellOf(r.z));
    if (k !== r.cell) { gridDel(r); gridAdd(r); }
  }

  /* ---- POOLED PIECES ----------------------------------------------------
     spec.key      geometry cache key (one geometry per kind + palette)
     spec.build    function (box) called ONCE per key: box(x, y, z, w, h, d, hex)
                   in the piece's own frame (floor at y=0, front +z, yaw 0,
                   x,y,z the box CENTRE)
     spec.parent   the host group the pool hangs in (host-local coords)
     spec.ox/oz/oy the host group's world origin (colliders are world)
     spec.lx/lz    the piece's centre in host-local coords; spec.y its floor
     spec.yaw      facing (forward = sin yaw, cos yaw)
     spec.material optional: a host's own surface (fitout's night self-light)
     plus add()'s fields: mass, tip, seatRec, owner, ledger, leash, mode.
     The footprint and the band come off the recorded geometry, by yaw. */
  const GEO = new Map();
  const POOLS = new Map();
  let _poolMat = null;
  function poolMaterial() {
    if (_poolMat) return _poolMat;
    _poolMat = CBZ.cmat ? CBZ.cmat(0xffffff, { vc: true }) : new window.THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    return _poolMat;
  }
  // the six faces of a box: normal, then the two in-plane axes (u x v = n)
  const FACE6 = [
    [0, 1, 2, 1], [0, 2, 1, -1], [1, 2, 0, 1], [1, 0, 2, -1], [2, 0, 1, 1], [2, 1, 0, -1],
  ];
  function recordGeo(key, build) {
    if (GEO.has(key)) return GEO.get(key);
    const THREE = window.THREE;
    const pos = [], nor = [], col = [], idx = [];
    let x0 = 1e9, x1 = -1e9, y1 = 0, z0 = 1e9, z1 = -1e9;
    const C = new THREE.Color();
    const box = function (x, y, z, w, h, d, hex) {
      if (!(w > 0 && h > 0 && d > 0)) return;
      C.setHex(hex >>> 0);
      const c = [x, y, z], half = [w / 2, h / 2, d / 2];
      for (let f = 0; f < 6; f++) {
        // [axis, u, v, sign]: the face at sign*half on `axis`; corners walk
        // u then v so (u x v) points along +axis, flipped for the - face
        const a = FACE6[f][0], sg = FACE6[f][3];
        let u = FACE6[f][1], v = FACE6[f][2];
        if (sg < 0) { const t = u; u = v; v = t; }
        const b = pos.length / 3;
        const Q = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (let q = 0; q < 4; q++) {
          const p = [c[0], c[1], c[2]];
          p[a] += sg * half[a];
          p[u] += Q[q][0] * half[u];
          p[v] += Q[q][1] * half[v];
          pos.push(p[0], p[1], p[2]);
          nor.push(a === 0 ? sg : 0, a === 1 ? sg : 0, a === 2 ? sg : 0);
          col.push(C.r, C.g, C.b);
        }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      x0 = Math.min(x0, x - w / 2); x1 = Math.max(x1, x + w / 2);
      z0 = Math.min(z0, z - d / 2); z1 = Math.max(z1, z + d / 2);
      y1 = Math.max(y1, y + h / 2);
    };
    try { build(box); } catch (e) { if (window.console) console.warn("[pushables] piece " + key + " build failed", e); }
    if (!pos.length) { GEO.set(key, null); return null; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g._shared = true;                   // survives any host teardown traversal
    const G = { geo: g, x0: x0, x1: x1, z0: z0, z1: z1, h: y1, boxes: pos.length / 24 };
    GEO.set(key, G);
    return G;
  }
  function poolGrow(P, cap) {
    const THREE = window.THREE;
    const m = new THREE.InstancedMesh(P.geo, P.mat, cap);
    if (m.instanceMatrix.setUsage) m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (P.mesh) {
      m.instanceMatrix.array.set(P.mesh.instanceMatrix.array.subarray(0, P.n * 16));
      if (P.mesh.parent) P.mesh.parent.remove(P.mesh);
      if (P.mesh.dispose) { try { P.mesh.dispose(); } catch (e) {} }
    }
    m.count = P.n;
    // r128 culls an InstancedMesh by its GEOMETRY's sphere, so each pool owns
    // a geometry of its own (the same attribute buffers, shared on the GPU)
    // whose sphere is fitted round the pool's pieces (poolBounds): a room of
    // chairs behind you, or across the city, costs no draw.
    m.castShadow = false; m.receiveShadow = true;
    m.userData.dynamic = true; m.userData.mover = true; m.userData.loosePool = true;
    m.name = "loose:" + P.gkey;
    P.parent.add(m);
    P.mesh = m; P.cap = cap;
    for (let i = 0; i < P.recs.length; i++) if (P.recs[i].col) P.recs[i].col.ref = m;
  }
  function poolGeo(G) {
    const THREE = window.THREE, src = G.geo;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", src.attributes.position);
    g.setAttribute("normal", src.attributes.normal);
    g.setAttribute("color", src.attributes.color);
    g.setIndex(src.index);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    g._shared = true;
    return g;
  }
  // the sphere round every piece in the pool (pool-local): centre of their
  // footprint box, radius to its corner plus the piece's own reach
  function poolBounds(P) {
    P.bounds = false;
    const S = P.geo.boundingSphere;
    if (!P.n) { S.radius = 0; return; }
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y0 = 1e9;
    for (let i = 0; i < P.n; i++) {
      const r = P.recs[i];
      const lx = r.ux - r.offX, lz = r.uz - r.offZ;
      if (lx < x0) x0 = lx; if (lx > x1) x1 = lx;
      if (lz < z0) z0 = lz; if (lz > z1) z1 = lz;
      if (r.fy - r.offY < y0) y0 = r.fy - r.offY;
    }
    S.center.set((x0 + x1) / 2, y0 + P.reach / 2, (z0 + z1) / 2);
    S.radius = Math.hypot((x1 - x0) / 2, (z1 - z0) / 2) + P.reach + 0.5;
  }
  function poolFor(parent, gkey, G, mat) {
    const k = parent.uuid + "|" + gkey + "|" + (mat ? mat.uuid : "");
    let P = POOLS.get(k);
    if (!P) {
      P = { key: k, gkey: gkey, parent: parent, geo: poolGeo(G), mat: mat || poolMaterial(), mesh: null, cap: 0, n: 0, recs: [],
        dirty: false, attached: true, gone: 0, bounds: true,
        reach: Math.max(G.h, Math.abs(G.x0), Math.abs(G.x1), Math.abs(G.z0), Math.abs(G.z1)) * 1.5 };
      POOLS.set(k, P);
      poolGrow(P, 8);
    } else if (P.n >= P.cap) poolGrow(P, P.cap * 2);
    return P;
  }
  // scratch, made on first use (a page may load this file before THREE)
  let _m4 = null, _mt, _q4, _q5, _p4, _s4, _ay, _ax4;
  function scratch() {
    if (_m4) return;
    const T = window.THREE;
    _m4 = new T.Matrix4(); _mt = new T.Matrix4(); _q4 = new T.Quaternion(); _q5 = new T.Quaternion();
    _p4 = new T.Vector3(); _s4 = new T.Vector3(1, 1, 1); _ay = new T.Vector3(0, 1, 0); _ax4 = new T.Vector3();
  }
  function poolWrite(r) {
    const P = r.pool;
    if (!P || r.slot < 0) return;
    scratch();
    const lx = r.ux - r.offX, lz = r.uz - r.offZ, ly = r.fy - r.offY;
    _q4.setFromAxisAngle(_ay, r.yaw);
    _m4.compose(_p4.set(lx, ly, lz), _q4, _s4);
    if (r.tipA) {
      const px = lx + r.pdx, pz = lz + r.pdz;
      _mt.makeTranslation(-px, -ly, -pz); _m4.premultiply(_mt);
      _q5.setFromAxisAngle(_ax4.set(r.tax, 0, r.taz), r.tipA);
      _mt.makeRotationFromQuaternion(_q5); _m4.premultiply(_mt);
      _mt.makeTranslation(px, ly, pz); _m4.premultiply(_mt);
    }
    P.mesh.setMatrixAt(r.slot, _m4);
    P.dirty = true; P.bounds = true;
  }
  function piece(spec) {
    if (!CFG.PUSH_PROPS_V1 || !spec || !spec.parent || !spec.key || typeof spec.build !== "function" || !window.THREE) return null;
    const G = recordGeo(spec.key, spec.build);
    if (!G) return null;
    const yaw = +spec.yaw || 0, sn = Math.sin(yaw), cs = Math.cos(yaw);
    // the recorded footprint (piece frame) as a world AABB about the centre
    const ax = Math.max(Math.abs(G.x0), Math.abs(G.x1)), az = Math.max(Math.abs(G.z0), Math.abs(G.z1));
    const hx = Math.abs(cs) * ax + Math.abs(sn) * az, hz = Math.abs(sn) * ax + Math.abs(cs) * az;
    const ox = spec.ox || 0, oz = spec.oz || 0, oy = spec.oy || 0;
    const fy = spec.y || 0;                                   // host-local floor
    const P = poolFor(spec.parent, spec.key, G, spec.material || null);
    const s2 = Object.assign({}, spec, {
      hx: hx, hz: hz, y0: fy + oy, y1: fy + oy + (spec.colH != null ? Math.min(G.h, spec.colH) : G.h),
      h: G.h, y: fy + oy, yaw: yaw, ox: ox, oz: oz, oy: oy, ref: P.mesh, parts: null,
    });
    const rec = enrol(s2, null, ox + (spec.lx || 0), oz + (spec.lz || 0));
    if (!rec) return null;
    rec.pool = P; rec.slot = P.n++;
    P.recs.push(rec);
    P.mesh.count = P.n;
    poolWrite(rec);
    poolBounds(P);
    return rec;
  }
  function poolRemove(r) {
    const P = r.pool;
    if (!P) return;
    const last = P.recs[P.n - 1];
    if (last && last !== r) {
      scratch();
      P.mesh.getMatrixAt(last.slot, _m4); P.mesh.setMatrixAt(r.slot, _m4);
      P.recs[r.slot] = last; last.slot = r.slot;
    }
    P.recs.pop(); P.n--;
    P.mesh.count = P.n; P.dirty = true;
    poolBounds(P);
    r.pool = null; r.slot = -1;
    if (!P.n) { if (P.mesh && P.mesh.parent) P.mesh.parent.remove(P.mesh); POOLS.delete(P.key); }
  }
  // drop records (a host that ledgered the collider already took it out of
  // CBZ.colliders with its own teardown; anything else is spliced out here)
  function removeRecs(test) {
    let w = 0, cut = null;
    for (let i = 0; i < props.length; i++) {
      const r = props[i];
      if (!test(r)) { props[w++] = r; continue; }
      gridDel(r); poolRemove(r); MOVING.delete(r);
      if (r.plat && CBZ.platforms) { const j = CBZ.platforms.indexOf(r.plat); if (j >= 0) { CBZ.platforms.splice(j, 1); platDirty = true; } }
      if (r.col && !r.ledgered) (cut || (cut = new Set())).add(r.col);
    }
    const n = props.length - w;
    props.length = w;
    if (cut && CBZ.colliders) {
      const C = CBZ.colliders; let k = 0;
      for (let i = 0; i < C.length; i++) if (!cut.has(C[i])) C[k++] = C[i];
      C.length = k; dirty = true;
    }
    flushDirty();
    return n;
  }
  function removeOwner(owner) { if (owner == null) return 0; return removeRecs(function (r) { return r.owner === owner; }); }
  function remove(rec) { return removeRecs(function (r) { return r === rec; }); }
  const MOVING = new Set();           // sliding or falling: driven even out of range

  /* ---- FALLING OVER -------------------------------------------------------
     About the bottom edge the piece is driven toward: the pivot is that edge
     on the floor, the axis is horizontal and square to the drive, and the top
     goes over toward (dx, dz). Lying, the collider is where the piece now is
     (pivot .. pivot + h along the drive) and as tall as the piece was deep. */
  function tip(r, dx, dz) {
    if (!r.tipOK || r.tipS || !r.pool) return false;
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) return false;
    dx /= l; dz /= l;
    r.tipS = 1; r.tipT = 0; r.tipA = 0;
    r.tdx = dx; r.tdz = dz;
    r.tax = dz; r.taz = -dx;                 // (dz,0,-dx) x up = (dx,0,dz): the top goes toward +dir
    const ext = Math.abs(dx) * r.ext0x + Math.abs(dz) * r.ext0z;
    r.pdx = dx * ext; r.pdz = dz * ext;
    r.ext = ext;
    const s = r.seat;
    if (s) {
      s.tipped = true;
      if (s.occupant && CBZ.propStand) { try { CBZ.propStand(s.occupant, { instant: true }); } catch (e) {} }
    }
    MOVING.add(r);
    return true;
  }
  function landTip(r) {
    r.tipS = 2; r.tipA = Math.PI / 2;
    const dx = r.tdx, dz = r.tdz, h = Math.max(0.3, r.h);
    // the lying footprint: from the pivot edge out to where the top landed
    const cx = r.ux + r.pdx + dx * h / 2, cz = r.uz + r.pdz + dz * h / 2;
    const xMajor = Math.abs(dx) >= Math.abs(dz);
    const nhx = xMajor ? h / 2 : r.ext0x, nhz = xMajor ? r.ext0z : h / 2;
    r.x = cx; r.z = cz; r.hx = nhx; r.hz = nhz;
    r.y1 = r.y0 + Math.max(0.5, Math.min(0.75, 2 * r.ext));
    const c = r.col;
    if (c) { c.minX = cx - nhx; c.maxX = cx + nhx; c.minZ = cz - nhz; c.maxZ = cz + nhz; c.y1 = r.y1; dirty = true; }
    gridMove(r);
    poolWrite(r);
  }
  function untip(r) {
    if (!r.tipS) return;
    r.tipS = 0; r.tipA = 0; r.tipT = 0;
    r.x = r.ux; r.z = r.uz; r.hx = r.ext0x; r.hz = r.ext0z; r.y1 = r.y0 + r.h0;
    const c = r.col;
    if (c) { c.minX = r.x - r.hx; c.maxX = r.x + r.hx; c.minZ = r.z - r.hz; c.maxZ = r.z + r.hz; c.y1 = r.y1; dirty = true; }
    if (r.seat) r.seat.tipped = false;
    gridMove(r);
    poolWrite(r);
  }

  /* ---- the pushers ------------------------------------------------------
     THE ONE THING THIS FILE HAD TO GET RIGHT. A body's realized frame delta
     is USELESS here: the prop is solid, so `CBZ.collide` depenetrates the
     pusher back out on the same frame and a man leaning on a stool at full
     walking pace measures a delta of ~0 mm. Nothing would ever move, and the
     failure would look exactly like "the feature does not work".

     So a push reads DRIVE — what the body is trying to do before a wall has an
     opinion. physics.js has always published `player.speed` (the DESIRED speed)
     and publishes `player.moveX/moveZ` beside it. An actor's drive is its own
     steering: the vector to `target`, at whatever speed the brain last
     returned. A paused body drives nothing. */
  const pushers = [];
  function drive(q, a) {
    if (a === CBZ.player) {
      q.dx = a.moveX || 0; q.dz = a.moveZ || 0;
      return;
    }
    if ((a.pause || 0) > 0 || (a.ko || 0) > 0 || !a.target) { q.dx = 0; q.dz = 0; return; }
    const tx = a.target.x - q.x, tz = a.target.z - q.z;
    const l = Math.hypot(tx, tz);
    if (l < 0.25) { q.dx = 0; q.dz = 0; return; }
    const s = a._spd != null ? a._spd : (a.speed || 0);
    q.dx = (tx / l) * s; q.dz = (tz / l) * s;
  }
  // the rosters swept for bodies that can shove. Names, resolved every frame,
  // so a list published later still counts; a game with its own roster assigns
  // a function to CBZ.pushables.pushers instead.
  let rosters = ["npcs", "guards"];
  function collectPushers(px, pz) {
    pushers.length = 0;
    const P = CBZ.player;
    if (P && P.pos) {
      const q = { a: P, x: P.pos.x, y: P.pos.y, z: P.pos.z, r: P.radius || 0.55, dx: 0, dz: 0 };
      drive(q, P); pushers.push(q);
    }
    const lists = typeof rosters === "function" ? (rosters() || []) : rosters;
    for (let L = 0; L < lists.length; L++) {
      const list = typeof lists[L] === "string" ? CBZ[lists[L]] : lists[L];
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a || a.dead || !a.group) continue;
        const g = a.group.position;
        const dx = g.x - px, dz = g.z - pz;
        if (dx * dx + dz * dz > ACTIVE_R2) continue;
        const q = { a: a, x: g.x, y: g.y, z: g.z, r: 0.5, dx: 0, dz: 0 };
        drive(q, a); pushers.push(q);
      }
    }
    return pushers;
  }

  // resolve a candidate footprint against the static world; returns 1 if it hit
  function blocked(rec, nx, nz) {
    if (!CBZ.queryCollidersNear) return 0;
    const reach = Math.max(rec.hx, rec.hz) + 0.6;
    const list = CBZ.queryCollidersNear(nx, nz, reach, qnear);
    let hit = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c === rec.col || dormant(c)) continue;
      // bands that cannot touch this prop's own band are not in its way
      if (c.y0 != null && (c.y1 <= rec.y0 + 0.02 || c.y0 >= rec.y1 - 0.02)) continue;
      const ox = Math.min(nx + rec.hx, c.maxX) - Math.max(nx - rec.hx, c.minX);
      if (ox <= 0) continue;
      const oz = Math.min(nz + rec.hz, c.maxZ) - Math.max(nz - rec.hz, c.minZ);
      if (oz <= 0) continue;
      hit = 1;
      break;
    }
    return hit;
  }

  // commit a delta: meshes, collider, sit anchor, broadphase
  function translate(rec, dx, dz) {
    rec.x += dx; rec.z += dz;
    rec.ux += dx; rec.uz += dz;
    for (let i = 0; rec.parts && i < rec.parts.length; i++) {
      const m = rec.parts[i];
      m.position.x += dx; m.position.z += dz;
    }
    if (rec.pool) poolWrite(rec);
    gridMove(rec);
    const c = rec.col;
    if (c) { c.minX += dx; c.maxX += dx; c.minZ += dz; c.maxZ += dz; dirty = true; }
    // THE GROUND GOES WITH IT TOO. Without this the stool you just pushed under
    // the vent is solid where it stands and standable where it used to be.
    const pl = rec.plat;
    if (pl) { pl.minX += dx; pl.maxX += dx; pl.minZ += dz; pl.maxZ += dz; platDirty = true; }
    // THE ANCHOR MOVES WITH THE FURNITURE. `_ex/_ez` is the cached standing
    // spot, solved against the colliders — clearing it makes the next body that
    // sits re-solve which side of the stool is now walkable.
    const s = rec.seat;
    if (s) { s.x += dx; s.z += dz; s._ex = null; s._ez = null; s._eok = 0; }
    rec.moved += Math.abs(dx) + Math.abs(dz);
  }

  /* ---- THE DRIVER -------------------------------------------------------
     onUpdate(23): after physics.js integrates the player (10) and after the
     crowd is moved (22) — so the drives above are this frame's real intent —
     and before any leash at 22.6 reads anything back. The grid is dirtied at
     most once per frame no matter how many props moved. */
  let lastElapsed = 0;
  // A one-shot page may load this file without the shared scheduler; the
  // registration verb still works, nothing drives, and nothing throws.
  const onUpdate = typeof CBZ.onUpdate === "function" ? CBZ.onUpdate : function () {};
  onUpdate(23, function (dt) {
    const g = CBZ.game;
    if (!CFG.PUSH_PROPS_V1 || !g || !props.length) return;
    if (dt <= 0 || dt > 0.2) dt = Math.min(Math.max(dt, 0.0001), 0.2);

    // a fresh run puts every stick of furniture back where it was built: world
    // geometry is parse-time and a mode reset rebuilds none of it, so without
    // this a restart inherits the last player's barricades.
    const el = +g.elapsed || 0;
    if (el < lastElapsed - 0.5) resetProps();
    lastElapsed = el;

    const P = CBZ.player;
    if (!P || !P.pos) return;
    const px = P.pos.x, pz = P.pos.z, py = P.pos.y || 0;
    if ((attachAcc += dt) > 1) { attachAcc = 0; checkPools(); }
    // THE CANDIDATES: the 3x3 grid cells round the player, plus anything
    // still sliding or falling. A quiet city costs nine Map lookups.
    const cand = CAND; cand.length = 0;
    const gcx = cellOf(px), gcz = cellOf(pz);
    let near = 0;
    for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
      const a = GRID.get(cellKey(gcx + ix, gcz + iz));
      if (!a) continue;
      for (let i = 0; i < a.length; i++) {
        const r = a[i];
        if (!live(r) || (r.pool && !r.pool.attached)) { r._near = 0; continue; }
        const dx = r.x - px, dz = r.z - pz;
        // this storey only: a tower holds forty floors of chairs in one column
        r._near = dx * dx + dz * dz < ACTIVE_R2 && r.y0 < py + 4.5 && r.y1 > py - 4.5 ? 1 : 0;
        if (r._near) { near++; cand.push(r); }
      }
    }
    MOVING.forEach(function (r) { if (!r._near) cand.push(r); });
    if (!near && !MOVING.size) return;

    const list = collectPushers(px, pz);
    const cars = near ? collectCars(px, pz) : CARS0;
    movingCount = 0;
    let pushing = null, pushNx = 0, pushNz = 0;

    for (let i = 0; i < cand.length; i++) {
      const r = cand[i];
      // ---- 0. a fall in progress: accelerate over, then lie there ----------
      if (r.tipS === 1) {
        r.tipT += dt;
        const k = Math.min(1, r.tipT / TIP_DUR);
        r.tipA = (Math.PI / 2) * k * k;
        if (k >= 1) landTip(r); else poolWrite(r);
      }
      // ---- 0b. a car: flung along its travel, over if it can go over ------
      if (r._near && cars.length && r.tipS !== 1) carHit(r, cars);

      // ---- 1. contact ---------------------------------------------------
      if (r._near) {
        const gain = Math.min(1, PUSH_REF / r.mass) * PUSH_EFF;
        for (let k = 0; k < list.length; k++) {
          const q = list[k];
          if (q.dx === 0 && q.dz === 0) continue;
          // the body has to actually overlap the prop's own height band
          if (q.y + BODY_HIGH <= r.y0 || q.y + BODY_LOW >= r.y1) continue;
          const cx = Math.max(r.x - r.hx, Math.min(q.x, r.x + r.hx));
          const cz = Math.max(r.z - r.hz, Math.min(q.z, r.z + r.hz));
          let nx = q.x - cx, nz = q.z - cz;
          const d2 = nx * nx + nz * nz, reach = q.r + SKIN;
          if (d2 >= reach * reach) continue;
          const d = Math.sqrt(d2);
          if (d < 1e-4) {                       // dead centre: shove along travel
            const vl = Math.hypot(q.dx, q.dz);
            nx = -q.dx / vl; nz = -q.dz / vl;
          } else { nx /= d; nz /= d; }
          // the component of this body's DRIVE that points INTO the prop —
          // walk past a stool and this is ~0, so brushing furniture never
          // bulldozes it; only walking AT it moves it.
          const into = -(q.dx * nx + q.dz * nz);
          if (into < MIN_DRIVE) continue;
          const want = into * gain;
          if (want < MIN_V) continue;           // too heavy for a body on foot
          const wx = -nx * want, wz = -nz * want;
          if (wx * wx + wz * wz > r.vx * r.vx + r.vz * r.vz) { r.vx = wx; r.vz = wz; }
          // arriving at a run bowls a light piece over, away from the body
          if (into >= TIP_DRIVE && r.tipOK && !r.tipS) tip(r, -nx, -nz);
          if (q.a === P) { pushing = r; pushNx = nx; pushNz = nz; }
        }
      }

      if (r.vx === 0 && r.vz === 0) { if (r.tipS !== 1) MOVING.delete(r); continue; }
      MOVING.add(r);

      // ---- 2. integrate, clamped so nothing tunnels ----------------------
      let sx = r.vx * dt, sz = r.vz * dt;
      const sl = Math.hypot(sx, sz);
      if (sl > MAX_STEP) { sx *= MAX_STEP / sl; sz *= MAX_STEP / sl; }
      // axis-separated so a prop sliding along a wall keeps sliding instead of
      // stopping dead on the first corner it clips
      let mx = 0, mz = 0;
      if (sx && !blocked(r, r.x + sx, r.z)) mx = sx; else r.vx = 0;
      if (sz && !blocked(r, r.x + mx, r.z + sz)) mz = sz; else r.vz = 0;

      // ---- 3. the leash and the room -------------------------------------
      if (mx || mz) {
        let nx2 = r.x + mx, nz2 = r.z + mz;
        const rm = r.room;
        if (rm) {
          if (nx2 < rm.x0) { nx2 = rm.x0; r.vx = 0; } else if (nx2 > rm.x1) { nx2 = rm.x1; r.vx = 0; }
          if (nz2 < rm.z0) { nz2 = rm.z0; r.vz = 0; } else if (nz2 > rm.z1) { nz2 = rm.z1; r.vz = 0; }
        }
        const lx = nx2 - r.homeX, lz = nz2 - r.homeZ, ll = Math.hypot(lx, lz);
        if (ll > r.leash) {
          const k = r.leash / ll;
          nx2 = r.homeX + lx * k; nz2 = r.homeZ + lz * k;
          r.vx = 0; r.vz = 0;
        }
        mx = nx2 - r.x; mz = nz2 - r.z;
        if (mx || mz) translate(r, mx, mz);
      }

      // ---- 4. friction ----------------------------------------------------
      const k = Math.exp(-DAMP * dt);
      r.vx *= k; r.vz *= k;
      if (r.vx * r.vx + r.vz * r.vz < STOP_V * STOP_V) { r.vx = 0; r.vz = 0; }
      else movingCount++;
    }

    flushDirty();
    POOLS.forEach(function (Pl) {
      if (!Pl.dirty) return;
      Pl.dirty = false; Pl.mesh.instanceMatrix.needsUpdate = true;
      if (Pl.bounds) poolBounds(Pl);
    });
    if (pushing) pushHands(P, pushing, pushNx, pushNz);
  });
  const CAND = [], CARS = [], CARS0 = [];
  let attachAcc = 0;

  /* ---- CARS ---------------------------------------------------------------
     The cars within reach of the player, as boxes: centre, forward f, right u,
     signed speed. A loose piece inside one is flung along the car's travel
     (plus a little off its centre line, the way a bumper glances a chair) and
     tipped if it can go over; the car loses a breath of speed. */
  function collectCars(px, pz) {
    CARS.length = 0;
    const L = CBZ.cityCars;
    if (!L || !L.length) return CARS;
    const R2 = (ACTIVE_R + 4) * (ACTIVE_R + 4);
    for (let i = 0; i < L.length; i++) {
      const c = L[i];
      if (!c || c.dead || !c.pos || !isFinite(c.pos.x) || !isFinite(c.pos.z)) continue;
      const v = +c.v || 0;
      if (Math.abs(v) < CAR_MIN_V) continue;
      const dx = c.pos.x - px, dz = c.pos.z - pz;
      if (dx * dx + dz * dz > R2) continue;
      CARS.push(c);
    }
    return CARS;
  }
  function carHit(r, cars) {
    if (r._carT > CLOCK) return;
    const rad = Math.max(r.hx, r.hz);
    for (let j = 0; j < cars.length; j++) {
      const c = cars[j];
      if (r.y1 < (c.pos.y || 0) - 0.3 || r.y0 > (c.pos.y || 0) + 1.6) continue;     // another storey
      const h = c.heading || 0, fx = Math.sin(h), fz = Math.cos(h), ux = Math.cos(h), uz = -Math.sin(h);
      const dx = r.x - c.pos.x, dz = r.z - c.pos.z;
      const along = dx * fx + dz * fz, lat = dx * ux + dz * uz;
      if (Math.abs(along) > CAR_HL + rad || Math.abs(lat) > CAR_HW + rad) continue;
      const v = +c.v || 0, sg = v < 0 ? -1 : 1, sp = Math.min(9, Math.abs(v) * 0.9);
      let ddx = fx * sg + ux * Math.sign(lat || 1) * 0.45, ddz = fz * sg + uz * Math.sign(lat || 1) * 0.45;
      const l = Math.hypot(ddx, ddz); ddx /= l; ddz /= l;
      const k = Math.min(1, PUSH_REF / r.mass);
      r.vx = ddx * sp * Math.max(0.35, k); r.vz = ddz * sp * Math.max(0.35, k);
      if (r.tipOK && !r.tipS) tip(r, ddx, ddz);
      c.v = v * 0.97;
      r._carT = CLOCK + 0.35;
      MOVING.add(r);
      return;
    }
  }
  let CLOCK = 0;
  onUpdate(22.95, function (dt) { CLOCK += Math.min(0.2, Math.max(0, dt || 0)); });

  /* ---- POOLS THAT LEFT THE SCENE ------------------------------------------
     A host that parks its building takes the pool with it; its pieces go
     dormant (no contact, no driving) until it comes back. A pool gone for two
     minutes belonged to a host that freed without telling us: its records are
     dropped (its colliders went with the host's ledger). Once a second. */
  function attachedToScene(o) {
    for (let i = 0; i < 64 && o; i++) { if (o.isScene) return true; o = o.parent; }
    return false;
  }
  function checkPools() {
    let drop = null;
    POOLS.forEach(function (Pl) {
      Pl.attached = attachedToScene(Pl.mesh);
      if (Pl.attached) Pl.gone = 0;
      else if ((Pl.gone += 1) > 120) (drop || (drop = new Set())).add(Pl);
    });
    if (drop) removeRecs(function (r) { return r.pool && drop.has(r.pool); });
  }

  /* THE HANDS DO THE PUSHING. A body walking a crate across a room leans on
     it with both palms flat on the face it is driving (CBZ.verbs.touch, the
     plant solver): the face the player's drive is pressing (the contact
     normal above), a shoulder's width apart along it, at the crate's top edge
     or chest height, whichever is lower. Held while the push lasts (sustained
     touches let go ~0.15 s after the last push frame). Anything below the
     knee is pushed with the shins, not the hands. */
  function pushHands(P, r, nx, nz) {
    const V = CBZ.verbs;
    if (!V || !V.touch || P.driving) return;
    const py = P.pos.y || 0;
    if (r.y1 < py + 0.55) return;
    // the face: the prop's own box side the player stands off, after this frame's move
    const ax = Math.abs(nx) >= Math.abs(nz);
    const fx = ax ? r.x + Math.sign(nx) * r.hx : Math.max(r.x - r.hx, Math.min(P.pos.x, r.x + r.hx));
    const fz = ax ? Math.max(r.z - r.hz, Math.min(P.pos.z, r.z + r.hz)) : r.z + Math.sign(nz) * r.hz;
    const Nx = ax ? Math.sign(nx) : 0, Nz = ax ? 0 : Math.sign(nz);
    const tx = -Nz, tz = Nx, half = ax ? r.hz : r.hx;
    const y = Math.min(r.y1 - 0.07, py + 1.08);
    for (let s = -1; s <= 1; s += 2) {
      // facing the crate (-N), the body's left is +tangent: that palm is the left hand's
      const lat = Math.max(-half + 0.06, Math.min(half - 0.06, s * 0.19));
      V.touch(P, { point: { x: fx + tx * lat, y: y, z: fz + tz * lat }, normal: { x: Nx, y: 0, z: Nz }, kind: "palm",
        arm: s > 0 ? "l" : "r", sustain: true, key: s > 0 ? "push-l" : "push-r" });
    }
  }

  // both broadphases, at most once per frame no matter how many props moved
  function flushDirty() {
    if (dirty) { dirty = false; if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
    if (platDirty) { platDirty = false; if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty(); }
  }

  /* ---- the sit anchors, resolved once ------------------------------------
     Furniture registries are drained on a first tick (a world builder queues
     its fittings because whatever owns the registry may parse AFTER it), so a
     prop registered at PARSE time cannot hold its anchor yet. One lazy lookup
     by coordinate, once. */
  onUpdate(23.05, function () {
    if (!CBZ.propNearestSeat || !props.length) return;
    for (let i = 0; i < props.length; i++) {
      const r = props[i];
      if (r.seatSolved || !r.seatAt || !live(r)) continue;
      r.seatSolved = true;
      try { r.seat = CBZ.propNearestSeat(r.seatAt.x, r.seatAt.z, 0.35, 0) || null; } catch (e) { r.seat = null; }
    }
  });

  function resetProps() {
    MOVING.clear();
    for (let i = 0; i < props.length; i++) {
      const r = props[i];
      r.vx = 0; r.vz = 0;
      if (r.tipS) untip(r);
      const dx = r.homeX - r.ux, dz = r.homeZ - r.uz;
      if (dx || dz) translate(r, dx, dz);
      r.moved = 0;
    }
    flushDirty();
  }

  /* ---- THE RATCHET -------------------------------------------------------
     `escaped` is the invariant that makes a pushable safe to ship: furniture
     may be moved anywhere its room allows and NOWHERE ELSE. A prop outside its
     own leash or room rect is a stool somebody walked out of the world, and
     there is no legitimate way for that number to be anything but zero.
     `unbatched` is the OTHER silent failure — a part core/batch.js would have
     welded into a static buffer — checked here rather than trusted. */
  function audit() {
    escaped = 0;
    let pooled = 0, tipped = 0, tippable = 0;
    let unbatched = 0, movedNow = 0, totalMoved = 0, minted = 0, stands = 0, standLost = 0, active = 0;
    const byKind = {};
    for (let i = 0; i < props.length; i++) {
      const r = props[i];
      if (live(r)) active++;
      // A STANDABLE TOP THAT DRIFTED OFF ITS OWN PROP is the silent failure this
      // feature can have: you walk onto thin air where the stool used to be.
      // The record is translated by the same delta, so the two centres must
      // agree to the millimetre — and if they ever do not, this says so.
      if (r.plat) {
        stands++;
        if (Math.abs((r.plat.minX + r.plat.maxX) / 2 - r.x) > 0.01
          || Math.abs((r.plat.minZ + r.plat.maxZ) / 2 - r.z) > 0.01) standLost++;
      }
      const d = Math.hypot(r.x - r.homeX, r.z - r.homeZ);
      if (d > r.leash + 0.05) escaped++;
      if (r.room && (r.x < r.room.x0 - 0.05 || r.x > r.room.x1 + 0.05
        || r.z < r.room.z0 - 0.05 || r.z > r.room.z1 + 0.05)) escaped++;
      for (let k = 0; r.parts && k < r.parts.length; k++)
        if (!(r.parts[k].userData && r.parts[k].userData.dynamic)) unbatched++;
      if (r.pool) pooled++;
      if (r.tipS) tipped++;
      if (r.tipOK) tippable++;
      if (r.vx || r.vz) movedNow++;
      if (r.moved > 0.02) totalMoved++;
      if (r.col) minted++;
      byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    }
    return {
      on: !!CFG.PUSH_PROPS_V1, props: props.length, active: active, kinds: byKind,
      withCollider: minted, seats: props.filter(function (r) { return !!r.seat; }).length,
      standable: stands, standLost: standLost,
      escaped: escaped, unbatched: unbatched,
      pooled: pooled, pools: POOLS.size, tippable: tippable, tipped: tipped, moving: MOVING.size, cells: GRID.size,
      sliding: movedNow, shoved: totalMoved,
      refMass: PUSH_REF, damp: DAMP, minSpeed: MIN_V, activeR: ACTIVE_R,
    };
  }

  /* ---- THE CONTRACT ------------------------------------------------------ */
  CBZ.pushables = {
    add: add,
    piece: piece,
    tip: tip,
    remove: remove,
    removeOwner: removeOwner,
    props: props,
    reset: resetProps,
    audit: audit,
    // the actor rosters swept for pushers: CBZ key names, live arrays, or a
    // function returning either. The player is always a pusher.
    get pushers() { return rosters; },
    set pushers(v) { rosters = v || []; },
    constants: { PUSH_REF: PUSH_REF, MIN_V: MIN_V, DAMP: DAMP, ACTIVE_R: ACTIVE_R },
  };
  // the names the shipped call sites already use
  CBZ.pushProp = add;
  CBZ.pushPropsReset = resetProps;
  CBZ.pushPropAudit = audit;
})();
