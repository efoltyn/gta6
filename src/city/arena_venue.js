// ============================================================================
// arena_venue.js — IRONJAW ARENA: THE BUILDING.
//
// WHY THIS EXISTS: the fight venue used to be ten flat slabs per side stacked
// at increasing height — "boxes on a hill" — with ZERO colliders, zero walkable
// deck, one PointLight for a whole stadium and four fake emissive boxes. You
// walked straight through the stands, the ropes and the cage. This file builds
// the actual architecture around the fight surfaces city/arena_fights.js owns:
//
//   • a real raked BOWL — rounded-rectangle plan, 16 rows of deck + riser,
//     radial aisles with stepped treads, a mid-bowl CROSS-AISLE, handrails and
//     seat-colour banding;
//   • VOMITORY tunnels that ramp up from the rear concourse and surface
//     through a notch in the seating at the cross-aisle (the honest way into
//     the stands), plus a grand west ENTRANCE TUNNEL running under the stand
//     onto the arena floor on the causeway axis;
//   • a rear CONCOURSE ring, an outer FACADE with fins/portals/parapet, a
//     cantilevered ROOF canopy on a truss lattice, and a LIGHTING GANTRY over
//     the floor carrying a quality-gated pool of real spotlights;
//   • a JUMBOTRON showing the live card, sponsor HOARDINGS on the bowl front,
//     hanging banners, aisle-number signage, a lit MARQUEE, ticket booths and
//     queue rails outside the west portal;
//   • an INSTANCED seated-crowd proxy filling the seats the live-NPC budget
//     can't reach, plus the seat-slot list those live NPCs actually sit in.
//
// CONTRACTS THIS FILE HONOURS
//   • Determinism: every random-looking choice comes from CBZ.hash01(x,z,salt)
//     — position-hashed, order-independent, byte-identical per seed. No
//     Math.random anywhere in this file.
//   • Colliders: every wall/barrier/booth/column pushes a real AABB onto
//     CBZ.colliders and we call CBZ.markCollidersDirty() once at the end.
//   • Platforms: decks and vomitory ramps push CBZ.platforms records. Risers
//     are 0.42 — UNDER systems/physics.js's 0.45 STEP_UP — so every row is
//     climbable without a single extra ramp record.
//   • Draw calls: the whole bowl is ~16 InstancedMeshes plus five merged
//     canvas-textured quad batches. Only the apron disc, floor disc and
//     jumbotron are per-object meshes; all carry userData so core/batch.js
//     spares them from the city static merge.
//   • r128 only: per-instance tint needs BOTH a white `color` attribute on the
//     geometry AND material.vertexColors — r128's color_fragment chunk
//     multiplies vColor only under USE_COLOR (same trick as crowd.js's
//     tintUnit()). SpotLight is (color, intensity, distance, angle, penumbra,
//     decay) and needs its .target in the graph.
//
// PUBLIC API — CBZ.arenaVenue.build(spec) -> venue handle (see build()).
// ============================================================================
(function () {
"use strict";
var CBZ = window.CBZ, THREE = window.THREE;
if (!CBZ || !THREE) return;

var CFG = CBZ.CONFIG || (CBZ.CONFIG = {});
// ARENA_VENUE_V2 — owner: "fix the buildings like ... the fighting arena".
// ON  → the raked bowl / concourse / roof / light rig / crowd described above.
// OFF → arena_fights.js keeps its bare octagon plaza and skips all of it.
// Flip false (or ?cfg_ARENA_VENUE_V2=0) for a one-line revert.
if (CFG.ARENA_VENUE_V2 == null) CFG.ARENA_VENUE_V2 = true;
// ARENA_CROWD_PROXY — instanced seated bodies filling the seats the live-NPC
// budget can't reach. OFF → only the ~42 real NPCs, every other seat empty.
if (CFG.ARENA_CROWD_PROXY == null) CFG.ARENA_CROWD_PROXY = true;
// ARENA_LIGHT_RIG — real THREE lights on the overhead gantry (count gated by
// CBZ.qualityLevel, and only switched visible while the player is at the
// venue). OFF → emissive housings only; zero extra shader cost anywhere.
if (CFG.ARENA_LIGHT_RIG == null) CFG.ARENA_LIGHT_RIG = true;
// ARENA_JUMBOTRON — the centre-hung screen and its live-card redraw.
if (CFG.ARENA_JUMBOTRON == null) CFG.ARENA_JUMBOTRON = true;
// ---------------------------------------------------------------------------
// ARENA_TIERS — HOW MANY SEATING TIERS THE BOWL STACKS. OWNER, verbatim:
// "STADIUM HAS TWO LEVELS OF ROWS SO IT FEELS SUPER SUPER SHORT — IT SHOULD
// HAVE 20 OF THE CURRENT LEVELS IT HAS 2 OF, AND BE MUCH TALLER."
// He was counting BANDS: the old bowl had exactly one cross-aisle, so it read
// as two blocks of seating. This is now ONE NUMBER and everything follows from
// it — row count, rake, tread, cross-aisle spacing, vomitory height, aisle
// ramps, rail placement, roof and gantry height, and the seat-colour banding
// that makes the tiers COUNTABLE from inside. Set it to 2 and you get the old
// silhouette back; set it to 30 and the building grows correctly.
if (CFG.ARENA_TIERS == null) CFG.ARENA_TIERS = 20;
// rows inside one tier. TIERS × ROWS_PER_TIER = the bowl's total row count.
if (CFG.ARENA_ROWS_PER_TIER == null) CFG.ARENA_ROWS_PER_TIER = 2;
// ARENA_SEAT_POSE — declare each seat's REAL cushion/floor geometry so
// entities/character.js runs its V2 feet-on-the-floor chair solve instead of
// the legacy squat (owner: spectators "SIT WEIRD WITH LEGS AGAINST CHEST LIKE
// THEY ARE BALLED UP"). OFF → the old undeclared anchor and the legacy pose.
if (CFG.ARENA_SEAT_POSE == null) CFG.ARENA_SEAT_POSE = true;
// ARENA_STAND_SOLID — the seat banks and handrails are REAL colliders, so you
// cannot run through the stands; the radial aisles carry ramp platforms and
// become the only way up (which is how a real bowl works). OFF → the old
// ghost seating where every row was walk-through and climbable.
if (CFG.ARENA_STAND_SOLID == null) CFG.ARENA_STAND_SOLID = true;
// ARENA_CROWD_EVENT — occupancy follows whether an event is actually running.
// OFF → the crowd sits at a fixed fill exactly like before.
if (CFG.ARENA_CROWD_EVENT == null) CFG.ARENA_CROWD_EVENT = true;
// ARENA_LOS_FULL — THE PROXY THAT BLOCKS SIGHT IS THE WALL YOU SEE.
// The facade's line-of-sight proxy was twelve hand-sized boxes: four slabs on
// the straights, four 11 x 11 blocks at the corners, all of them 16 m tall.
// Their POSITIONS derive from the plan (q = df2 * cos45) but their EXTENTS were
// typed for the OLD bowl, and when ARENA_TIERS went 2 -> 20 the ring walked
// outward with them frozen. Measured on the shipped venue: the facade is
// 24.98 m tall on a 537 m perimeter; the proxy covered 218 m of it at 16 m —
// so 59% of the wall (the four 95 m corner ARCS, each answered by one 11 m box)
// and the top 9 m everywhere had NO blocker at all. Every LOS consumer in the
// game read straight through it: cop vision, clearLineOfFire, camera occlusion,
// and the owner's screenshot — missile lock squares painted on the concrete,
// tracking craft standing behind it. The corner proxies now WALK THE SAME ARC
// the facade geometry walks (runCorner), and the height comes off ROOF_Y, so
// the two cannot drift apart again. OFF → the twelve frozen boxes.
if (CFG.ARENA_LOS_FULL == null) CFG.ARENA_LOS_FULL = true;

var mat = CBZ.cmat || CBZ.mat;
if (!mat) return;

// ---------------------------------------------------------------- utilities
function h01(x, z, salt) {
  return (typeof CBZ.hash01 === "function") ? CBZ.hash01(x, z, salt) : 0.5;
}
function hpick(list, x, z, salt) {
  return list[Math.min(list.length - 1, (h01(x, z, salt) * list.length) | 0)];
}

// A unit box carrying a white per-vertex colour so InstancedMesh.setColorAt()
// actually tints in r128 (see the header note).
function tintUnitBox() {
  var g = new THREE.BoxGeometry(1, 1, 1);
  var n = g.attributes.position.count, w = new Float32Array(n * 3); w.fill(1);
  g.setAttribute("color", new THREE.BufferAttribute(w, 3));
  return g;
}

function ctex(w, h, draw) {
  if (typeof document === "undefined") return null;
  try {
    var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    var c = cv.getContext("2d"); if (!c) return null;
    draw(c, w, h);
    var t = new THREE.CanvasTexture(cv);
    t._canvas = cv; t._ctx = c;
    return t;
  } catch (e) { return null; }
}

// Merged textured quads: one BufferGeometry, one draw call, per-quad UV cell
// so a single atlas canvas can carry many different signs/hoardings.
function QuadBatch() {
  var pos = [], nor = [], uv = [], idx = [], n = 0;
  this.add = function (x, y, z, w, h, yaw, u0, v0, u1, v1) {
    var c = Math.cos(yaw), s = Math.sin(yaw), hx = w / 2, hy = h / 2;
    var lx = [-hx, hx, hx, -hx], ly = [-hy, -hy, hy, hy];
    var us = [u0, u1, u1, u0], vs = [v0, v0, v1, v1];
    for (var i = 0; i < 4; i++) {
      pos.push(x + lx[i] * c, y + ly[i], z - lx[i] * s);
      nor.push(s, 0, c);
      uv.push(us[i], vs[i]);
    }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4;
  };
  this.geo = function () {
    if (!n) return null;
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  };
}

// ============================================================================
CBZ.arenaVenue = {
  // shared with city/arena_fights.js so the ring/cage/pit props use the same
  // one-draw-call texture + merged-quad machinery as the building does.
  canvasTex: ctex,
  quads: function () { return new QuadBatch(); },

  /* spec:
       root            THREE.Object3D to build into (city.root)
       cx, cz, py      venue centre + arena-floor deck height
       focus           {x,z} the live NPCs should sit nearest (the ring)
       liveSeats       how many seat slots to reserve for real NPCs (42)
       spotTargets     [{x,y,z,angle,intensity}] aim points for the light rig
       floorSeatRings  [{x,z,r0,rings}] loose ringside chairs on the floor
     returns a handle: {root, seatSlots, floorSlots, colliders, platforms,
       metrics, board(a,b,c), tick(distToPlayer, dt)}                        */
  build: function (spec) {
    if (!CFG.ARENA_VENUE_V2) return null;

    var root = spec.root, CX = spec.cx, CZ = spec.cz, PY = spec.py;

    // ---------------------------------------------------------- PLAN GEOMETRY
    // The bowl is the OFFSET of a rectangle: a rounded rectangle whose straight
    // runs are axis-aligned (so every deck row registers as an exact AABB
    // platform, and vomitory ramps can use the frozen x/z ramp record shapes)
    // and whose corners are concentric arcs (so rows never leave a wedge-shaped
    // hole the way four separate straight stands would).
    // THE FLOOR SHRANK AND THE BOWL GREW. The old plan wrapped a 102 x 130 m
    // FLOOR — a football pitch — in a 16-row, 6.3 m stand, which is exactly why
    // the owner read it as "super super short": the height/width proportion was
    // 0.09. A fight venue's floor is small and its bowl is tall and steep. This
    // plan is 52 x 70 on the floor with a 20-tier bowl, proportion 0.40.
    var A = 15, B = 24;             // rectangle core half-extents (x, z)
    var D0 = 11;                    // offset of row 0's front edge -> floor 52 x 70
    // ---- THE ONE PARAMETER -------------------------------------------------
    var TIERS = Math.max(1, CFG.ARENA_TIERS | 0);
    var RPT = Math.max(1, CFG.ARENA_ROWS_PER_TIER | 0);
    var ROWS = TIERS * RPT;
    // RISE IS CAPPED BY THE ENGINE, NOT BY TASTE: systems/physics.js's STEP_UP
    // is 0.45, and the bowl's own contract is that a row is climbable without a
    // ramp record. So the rake is steepened by NARROWING THE TREAD, never by
    // raising the riser — 0.42 / 0.95 = 23.9 deg at the floor ramping to
    // 0.42 / 0.78 = 28.3 deg in the gods, which is the real 25-30 deg band with
    // the upper tiers correctly steeper.
    var RISE = 0.42;
    var TREAD_LO = 0.95, TREAD_HI = 0.78;
    var FRONT_H = 4.2;              // ringside podium: row 0's deck sits this high
    var XW = 1.9;                   // extra tread where a cross-aisle is folded in
    // a real walkable cross-aisle every CROSS_EVERY tiers (lower / club / upper
    // concourse). Derived, so 4 tiers gives one and 40 gives seven.
    var CROSS_EVERY = Math.max(2, Math.round(TIERS / 4));
    var CONC = 7.0;                 // rear concourse width
    var PITCH = 0.60;               // seat pitch along a row (real seat width)
    var AISLE_H = 0.95;             // half-width of a radial aisle
    var DECK_R = 112;               // concrete apron disc radius (island R is 120)

    function tierOf(r) { return Math.min(TIERS - 1, (r / RPT) | 0); }
    function tierFirst(r) { return (r % RPT) === 0; }                 // first row of a tier
    function crossRow(r) { return r > 0 && (r % (RPT * CROSS_EVERY)) === 0; }

    // ---- THE RAKE COMES FROM THE SIGHTLINE FORMULA, NOT FROM TASTE ---------
    // Stadium design solves a rake with the C-VALUE: the vertical distance by
    // which a spectator's eye clears the head of the person one row in front,
    // measured to a FOCAL POINT on the playing surface.
    //
    //     C = D·(R + N)/(D + T) − R
    //
    // D = horizontal eye-to-focus, R = eye height above the focus, N = riser,
    // T = tread. 60 mm is the usual code floor, 90 mm is decent, 120 mm is a
    // good arena. Solved for the tread it becomes a CEILING:
    //
    //     T_max = D·(N − C)/(R + C)
    //
    // The reason real upper tiers rake steeper is that N grows with height —
    // and WE CANNOT GROW N, because physics.js's STEP_UP is 0.45 and this
    // bowl's contract is that every row is climbable with no ramp record. So
    // the riser stays at 0.42 and the TREAD carries the steepening instead:
    // an ergonomic ramp (wide legroom at the front, tight in the gods) capped
    // by T_max, so the geometry can never drift into a row that cannot see.
    // The worst C in the bowl is reported as arenaAudit().minCValue.
    var C_VALUE = 0.12;      // target clearance, above the 0.06 code floor
    var EYE = 1.15;          // seated eye height above the deck
    var TREAD_MIN = 0.76;    // knees and feet — no arena treads tighter
    var FOCUS_Y = PY;        // focal point: the arena floor at the bowl centre

    // Precomputed plan: DECK_F[r] = front edge of row r's walkable deck,
    // DECK_D[r] = its depth (tread, plus the cross-aisle where one is folded in).
    var DECK_F = [], DECK_D = [], ROW_Y = [], TREAD = [], CVAL = [];
    (function () {
      var d = D0;
      for (var r = 0; r < ROWS; r++) {
        // comfort ramp: generous at the front, tight at the top
        var T = TREAD_LO + (TREAD_HI - TREAD_LO) * (ROWS < 2 ? 0 : r / (ROWS - 1));
        if (r > 0) {
          // …capped by what the row BELOW can see over. D is measured on the
          // ±x straights, the shortest run in the plan and therefore the
          // tightest sightline in the bowl — solve for the worst case and the
          // rest of the ring is better by construction.
          var Dh = A + DECK_F[r - 1] + TREAD[r - 1] * 0.5;
          var Rv = (ROW_Y[r - 1] + EYE) - FOCUS_Y;
          var Tmax = Dh * (RISE - C_VALUE) / (Rv + C_VALUE);
          if (Tmax > 0 && Tmax < T) T = Tmax;
          T = Math.max(TREAD_MIN, T);
          // the C this row actually achieves, for the audit
          CVAL[r] = Dh * (Rv + RISE) / (Dh + T) - Rv;
        } else CVAL[r] = 99;
        TREAD[r] = T;
        DECK_F[r] = d;
        DECK_D[r] = T + (crossRow(r) ? XW : 0);
        ROW_Y[r] = PY + FRONT_H + r * RISE;
        d += DECK_D[r];
      }
    })();
    function treadOf(r) { return TREAD[r]; }
    var MIN_C = 99;
    for (var cvi = 1; cvi < ROWS; cvi++) if (CVAL[cvi] < MIN_C) MIN_C = CVAL[cvi];
    function rowD(i) { return DECK_F[i] + (crossRow(i) ? XW : 0); }   // front of the SEATS
    function deckFront(i) { return DECK_F[i]; }
    function deckDepth(i) { return DECK_D[i]; }
    function rowY(i) { return ROW_Y[i]; }

    var D_TOP = DECK_F[ROWS - 1] + DECK_D[ROWS - 1];   // rear edge of the last row
    var D_BACK = D_TOP + 1.4;             // rear skirt wall
    var D_OUT = D_BACK + CONC;            // inner face of the facade
    var D_FACE = D_OUT + 2.0;             // outer face of the facade
    var TOP_Y = rowY(ROWS - 1);
    // The VOMITORY level: the lowest real cross-aisle. Everything the old code
    // keyed off the single hard-coded XROW=6 now keys off this.
    var XROW = Math.min(ROWS - 1, RPT * CROSS_EVERY);
    var CROSS_Y = rowY(XROW);
    // Roof/gantry ride ON the bowl instead of at a frozen 15.5/19.5, so the
    // canopy still covers the stands when TIERS changes.
    var ROOF_Y = TOP_Y + 4.4;
    var GANTRY_Y = ROOF_Y + 3.5;
    var CONC_CEIL = PY + 5.2;
    var CANOPY_IN = D0 - 4, CANOPY_OUT = D_FACE + 0.4;

    // radial aisle anchors: coordinate along each straight, mid-angle on corners
    var AIS_X = [-18, -6, 6, 18];         // z offsets, used by the ±x stands
    var AIS_Z = [-9, 9];                  // x offsets, used by the ±z stands
    // Vomitories (ramped tunnels under the stand) — every one aligned with an
    // aisle so the walk-up continues straight into the rows.
    // DERIVED from the aisle anchors, never re-typed: a vomitory that does not
    // surface INTO an aisle dumps you into the back of a seat bank.
    var VOMS = [
      { side: "xp", k: AIS_X[1] }, { side: "xp", k: AIS_X[2] },
      { side: "xn", k: AIS_X[0] }, { side: "xn", k: AIS_X[3] },
      { side: "zp", k: AIS_Z[0] }, { side: "zp", k: AIS_Z[1] },
      { side: "zn", k: AIS_Z[0] }, { side: "zn", k: AIS_Z[1] }
    ];
    var VOM_HW = 2.2;                      // vomitory half-width
    var GATE_HW = 4.2;                     // west entrance tunnel half-width
    // The ramp surfaces through a NOTCH cut in rows XROW..XROW+2. It has to:
    // a stand only 6.3 units tall cannot hide a 5.5-unit climb AND keep 2.4 of
    // headroom under the decks — the notch is what makes a real vomitory work.
    var NOTCH_LO = XROW, NOTCH_HI = XROW + 2;
    var VOM_D_IN = deckFront(XROW);              // 20.8 — ramp tops out here
    var VOM_D_OUT = D_OUT - 1.0;                 // 43.2 — starts on the concourse
    var VOM_D_COVER = rowD(NOTCH_HI + 1);        // 26.7 — tunnel roof starts here

    // ------------------------------------------------------------------ ROOT
    var V = new THREE.Group();
    V.name = "ironjaw-arena";
    root.add(V);

    var colliders = [], platforms = [], losMeshes = [], lights = [], proxies = [];
    function solid(x0, z0, x1, z1, y0, y1) {
      var c = {
        minX: Math.min(x0, x1), maxX: Math.max(x0, x1),
        minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), ref: V
      };
      if (y0 != null) { c.y0 = y0; c.y1 = y1; }
      (CBZ.colliders = CBZ.colliders || []).push(c);
      colliders.push(c); return c;
    }
    function plat(x0, z0, x1, z1, top, ramp) {
      var p = {
        minX: Math.min(x0, x1), maxX: Math.max(x0, x1),
        minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), top: top, ref: V
      };
      if (ramp) p.ramp = ramp;
      (CBZ.platforms = CBZ.platforms || []).push(p);
      platforms.push(p); return p;
    }
    // Invisible axis-aligned box used purely as a line-of-sight blocker. r128
    // raycasts ignore visibility (core/losgrid.js documents and relies on that)
    // so an invisible proxy costs zero draw calls and still stops AI shots.
    function losBox(x, y, z, w, h, d) {
      if (!CBZ.losBlockers) return null;
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(0x101010));
      m.position.set(x, y, z); m.visible = false;
      m.userData.arenaLOS = true;
      V.add(m); CBZ.losBlockers.push(m); losMeshes.push(m);
      return m;
    }

    // ---------------------------------------------------- instanced box pools
    var UNIT = new THREE.BoxGeometry(1, 1, 1);
    var TINT = tintUnitBox();
    var pools = {};
    function pool(name, color, opts) { pools[name] = { items: [], color: color, opts: opts || {} }; }
    function put(name, it) { pools[name].items.push(it); }
    function flushPools() {
      for (var k in pools) {
        var p = pools[k], items = p.items;
        if (!items.length) continue;
        var tinted = !!p.opts.tint, material;
        if (p.opts.basic) material = new THREE.MeshBasicMaterial({ color: p.color });
        else if (tinted) material = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
        else material = mat(p.color);
        var im = new THREE.InstancedMesh(tinted ? TINT : UNIT, material, items.length);
        im.frustumCulled = false;          // r128 InstancedMesh has no real bounds
        im.castShadow = !!p.opts.cast;
        im.receiveShadow = p.opts.receive !== false;
        var M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(),
            v = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          // r128's default Euler order is XYZ, i.e. R = RX·RY·RZ — so an `rx`
          // alongside a yaw is a rotation about the WORLD x axis and a body
          // facing +x would ROLL instead of tipping forward. `eo:"YXZ"` gives
          // R = RY·RX·RZ, which is yaw first and then pitch about the body's
          // OWN side-to-side axis. Same scoped swap the death roll needs.
          e.set(it.rx || 0, it.ry || 0, it.rz || 0, it.eo || "XYZ"); q.setFromEuler(e);
          v.set(it.x, it.y, it.z); s.set(it.sx, it.sy, it.sz);
          M.compose(v, q, s); im.setMatrixAt(i, M);
          if (tinted) { col.setHex(it.c == null ? 0xffffff : it.c); im.setColorAt(i, col); }
        }
        im.instanceMatrix.needsUpdate = true;
        if (tinted && im.instanceColor) im.instanceColor.needsUpdate = true;
        im.name = "arena-" + k;
        V.add(im);
        p.mesh = im;
      }
    }

    pool("concrete", 0x9aa0aa, { cast: true });
    pool("deck", 0x8b9199);
    pool("riser", 0x6d737c);
    pool("steel", 0x2a2f38, { cast: true });
    pool("dark", 0x171a20);
    pool("rail", 0xc8a132);
    pool("seat", 0xffffff, { tint: true });
    pool("body", 0xffffff, { tint: true });
    pool("head", 0xffffff, { tint: true });
    pool("lap", 0x22252c);
    pool("truss", 0x3b4250);
    pool("lampbox", 0x14161b);
    pool("lamp", 0xfff4cf, { basic: true, receive: false });
    pool("banner", 0xffffff, { tint: true });
    pool("chair", 0x1d2129);

    // ------------------------------------------------ ring-walk primitives
    // Every ring in this venue (decks, risers, walls, roof bands, seats,
    // banners) is walked by these helpers, so nothing can drift out of plan.
    // The callback sample carries an outward normal and a yaw that puts the
    // box's local +Z on that normal and local +X on the tangent — which is
    // exactly how the sx/sz scales below are authored.
    function yawOf(nx, nz) { return Math.atan2(nx, nz); }

    function runStraight(side, d, pitch, cb) {
      var nx = 0, nz = 0, a0 = 0, a1 = 0, fixed = 0;
      if (side === "xp") { nx = 1; fixed = CX + A + d; a0 = CZ - B; a1 = CZ + B; }
      else if (side === "xn") { nx = -1; fixed = CX - A - d; a0 = CZ + B; a1 = CZ - B; }
      else if (side === "zp") { nz = 1; fixed = CZ + B + d; a0 = CX + A; a1 = CX - A; }
      else { nz = -1; fixed = CZ - B - d; a0 = CX - A; a1 = CX + A; }
      var len = Math.abs(a1 - a0), n = Math.max(1, Math.round(len / pitch)), step = (a1 - a0) / n;
      var yaw = yawOf(nx, nz);
      for (var i = 0; i < n; i++) {
        var k = a0 + step * (i + 0.5);
        cb({ x: (nx ? fixed : k), z: (nx ? k : fixed), nx: nx, nz: nz,
             yaw: yaw, side: side, key: k, d: d, len: Math.abs(step) });
      }
    }
    function runCorner(ci, d, pitch, cb) {
      var ox = (ci === 0 || ci === 3) ? CX + A : CX - A;
      var oz = (ci === 0 || ci === 1) ? CZ + B : CZ - B;
      var a0 = ci * Math.PI / 2, span = Math.PI / 2;   // 0:+x+z 1:-x+z 2:-x-z 3:+x-z
      var n = Math.max(2, Math.round(d * span / pitch)), step = span / n;
      for (var i = 0; i < n; i++) {
        var a = a0 + step * (i + 0.5), nx = Math.cos(a), nz = Math.sin(a);
        cb({ x: ox + nx * d, z: oz + nz * d, nx: nx, nz: nz, yaw: yawOf(nx, nz),
             side: "c" + ci, key: a - a0, d: d, len: d * step });
      }
    }
    function walkRing(d, pitch, cb) {
      runStraight("xp", d, pitch, cb); runCorner(0, d, pitch, cb);
      runStraight("zp", d, pitch, cb); runCorner(1, d, pitch, cb);
      runStraight("xn", d, pitch, cb); runCorner(2, d, pitch, cb);
      runStraight("zn", d, pitch, cb); runCorner(3, d, pitch, cb);
    }
    function isStraight(side) { return side.charAt(0) !== "c"; }
    function aisleGap(s) {
      var i, list;
      if (s.side === "xp" || s.side === "xn") {
        list = AIS_X;
        for (i = 0; i < list.length; i++) if (Math.abs(s.key - (CZ + list[i])) < AISLE_H) return true;
      } else if (s.side === "zp" || s.side === "zn") {
        list = AIS_Z;
        for (i = 0; i < list.length; i++) if (Math.abs(s.key - (CX + list[i])) < AISLE_H) return true;
      } else if (Math.abs(s.key - Math.PI / 4) * s.d < AISLE_H) return true;
      return false;
    }
    function vomGap(s, half) {
      half = (half == null) ? VOM_HW : half;
      for (var i = 0; i < VOMS.length; i++) {
        var v = VOMS[i]; if (v.side !== s.side) continue;
        var base = (v.side === "xp" || v.side === "xn") ? CZ : CX;
        if (Math.abs(s.key - (base + v.k)) < half) return true;
      }
      return false;
    }
    function gateGap(s, half) {
      return s.side === "xn" && Math.abs(s.key - CZ) < (half == null ? GATE_HW : half);
    }
    // the world position + tangent basis of a straight-side anchor coordinate
    function straightPoint(side, d, k) {
      if (side === "xp") return { x: CX + A + d, z: k, nx: 1, nz: 0 };
      if (side === "xn") return { x: CX - A - d, z: k, nx: -1, nz: 0 };
      if (side === "zp") return { x: k, z: CZ + B + d, nx: 0, nz: 1 };
      return { x: k, z: CZ - B - d, nx: 0, nz: -1 };
    }

    // A ring of solid AABBs following the plan (arcs approximated by the true
    // AABB of each short oriented chord — kept short so the fatness stays sane).
    function ringSolid(d, thick, y0, y1, opts) {
      opts = opts || {};
      walkRing(d, opts.pitch || 5.0, function (s) {
        if (opts.skip && opts.skip(s)) return;
        var hx = s.len / 2, hz = thick / 2, ax, az;
        if (isStraight(s.side)) {
          ax = Math.abs(s.nx) * hz + Math.abs(s.nz) * hx;
          az = Math.abs(s.nz) * hz + Math.abs(s.nx) * hx;
        } else {
          var c = Math.abs(Math.cos(s.yaw)), sn = Math.abs(Math.sin(s.yaw));
          ax = hx * c + hz * sn; az = hx * sn + hz * c;
        }
        solid(s.x - ax, s.z - az, s.x + ax, s.z + az, y0, y1);
        if (opts.mesh !== false) {
          put(opts.pool || "concrete", {
            x: s.x, y: (y0 + y1) / 2, z: s.z,
            sx: s.len + 0.05, sy: (y1 - y0), sz: thick, ry: s.yaw
          });
        }
      });
    }

    // ================================================================== FLOOR
    // One concrete apron disc for the island top plus a coarse AABB stack that
    // makes it a real walkable surface. (The old plaza registered nothing at
    // all, so the player walked 1.1 units SUNK into the deck.)
    var disc = new THREE.Mesh(new THREE.CylinderGeometry(DECK_R, DECK_R + 3, 1.1, 40), mat(0x8d9199));
    disc.position.set(CX, PY - 0.55, CZ);
    disc.receiveShadow = true;
    disc.userData.arenaDeck = true;      // non-empty userData: core/batch.js spares it
    V.add(disc);
    // BUILT GROUND IS FLAT (city/continent.js). This apron is the venue's own
    // floor and it is a DISC — which is precisely why the arena had never been
    // gated: continent.js collects rectangular `worldSurface` meshes (an AABB
    // around a round pad would carve four square corners out of the country) and
    // the Ironjaw region record carries no `terrainGrade`. So the backcountry
    // kept full relief under a 20-tier bowl authored at PY=1.1 and climbed
    // straight through the stands — the owner's "green ground … overlaps with
    // things like the stadium". One line, degrade-safe, and the flat band is
    // widened one plate cell by the gate itself.
    if (CBZ.terrainFlattenUnder) {
      CBZ.terrainFlattenUnder({ name: "Ironjaw Arena deck", cx: CX, cz: CZ, r: DECK_R + 3, pad: 4 });
    }
    // THE WALKABLE APRON IS A STAIRCASE, AND THE STAIRCASE IS DERIVED.
    // The deck you SEE is a disc of radius DECK_R; the deck you can STAND on is
    // this stack of rectangles. They were five hand-typed bands and the two
    // surfaces disagreed over 4,216 m2 — 11% of the drawn apron had no platform
    // record under it at all, so walking the "flat concrete" dropped you 0.9-1.1
    // units into it at invisible seams. That is the owner's "dumb physics"
    // around this building, and it is arithmetic, not taste: a 5-step staircase
    // is simply a bad inscription of a 112 m circle.
    //
    // Now the z ladder is authored and every half-width is SOLVED — the largest
    // whole metre strictly inside the circle at that band's OUTER z, so no
    // platform can ever reach past the drawn disc no matter what DECK_R becomes.
    // Thirteen bands cut the disagreement to ~1,980 m2 (a max radial error under
    // 1.2 m instead of 22) for 25 platform records instead of 9.
    //
    // The FIRST band is pinned at z=30: arena_fights.js reads apron[0][1] for
    // its gate x, and the causeway ramp hands over to the apron at that exact
    // line. Moving it would put the gatehouse on the ramp.
    //
    // Published on the handle (metrics.apron) so arena_fights.js measures the
    // free ring instead of re-typing it.
    var APRON_Z = [30, 40, 50, 60, 70, 78, 85, 91, 96, 100, 104, 107, 110];
    var APRON_BANDS = (function () {
      var out = [], i, hx;
      for (i = 0; i < APRON_Z.length; i++) {
        // strictly inside the drawn disc: sqrt(R^2 - z^2), minus half a metre
        // of margin, floored to a whole metre.
        hx = Math.floor(Math.sqrt(Math.max(0, DECK_R * DECK_R - APRON_Z[i] * APRON_Z[i])) - 0.5);
        if (hx > 0) out.push([APRON_Z[i], hx]);
      }
      return out;
    })();
    (function () {
      var bands = APRON_BANDS;
      var prev = 0;
      for (var i = 0; i < bands.length; i++) {
        var z1 = bands[i][0], hx = bands[i][1];
        if (i === 0) plat(CX - hx, CZ - z1, CX + hx, CZ + z1, PY);
        else {
          plat(CX - hx, CZ + prev, CX + hx, CZ + z1, PY);
          plat(CX - hx, CZ - z1, CX + hx, CZ - prev, PY);
        }
        prev = z1;
      }
    })();
    var floorDisc = new THREE.Mesh(new THREE.CylinderGeometry(A + D0 - 7, A + D0 - 7, 0.06, 40), mat(0x5c6068));
    floorDisc.position.set(CX, PY + 0.04, CZ);
    floorDisc.userData.arenaFloor = true;
    floorDisc.receiveShadow = true;
    V.add(floorDisc);

    // ============================================================ BOWL FRONT
    // 3-unit ringside barrier. FULL-height collider (no y0/y1) so nothing steps
    // over it; row 0's deck begins immediately behind its outer face.
    ringSolid(D0 - 0.35, 0.7, PY, PY + FRONT_H, {
      pitch: 4.5, pool: "dark",
      skip: function (s) { return gateGap(s, GATE_HW); }
    });

    // sponsor hoardings — ONE canvas atlas of four boards, one merged draw
    var hoardTex = ctex(1024, 256, function (c, w, h) {
      var names = ["IRONJAW", "GRIT ENERGY", "BRAKKA MOTORS", "HALSEY BANK"];
      var bg = ["#12161d", "#7a1220", "#0d2a44", "#1c1a10"];
      var fg = ["#ffd24a", "#ffe8e8", "#8fd0ff", "#e8d79a"];
      for (var i = 0; i < 4; i++) {
        c.fillStyle = bg[i]; c.fillRect(i * 256, 0, 256, h);
        c.strokeStyle = "rgba(255,255,255,.12)"; c.lineWidth = 4;
        c.strokeRect(i * 256 + 6, 6, 244, h - 12);
        c.fillStyle = fg[i]; c.font = "bold 44px Arial";
        c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(names[i], i * 256 + 128, h / 2);
      }
    });
    if (hoardTex) {
      var hq = new QuadBatch();
      walkRing(D0 - 0.74, 5.2, function (s) {
        if (gateGap(s, GATE_HW + 1)) return;
        var cell = Math.min(3, (h01(s.x, s.z, 0xa17) * 4) | 0);
        hq.add(s.x, PY + FRONT_H * 0.55, s.z, s.len * 0.98, FRONT_H * 0.72,
               s.yaw + Math.PI, cell / 4 + 0.002, 0.02, (cell + 1) / 4 - 0.002, 0.98);
      });
      var hg = hq.geo();
      if (hg) {
        var hm = new THREE.Mesh(hg, new THREE.MeshLambertMaterial({ map: hoardTex }));
        hm.userData.arenaHoardings = true;
        V.add(hm);
      }
    }

    // ============================================================ SEATING BOWL
    var seatRecords = [];       // {x,y,z,yaw,row,tier}
    // ---- SEAT GEOMETRY IS DECLARED, NOT GUESSED -----------------------------
    // The old seat was ONE 0.74-tall box whose TOP FACE was the seating surface,
    // and the spectator anchor sat on that top face with NOTHING declared — the
    // exact antipattern city/propuse.js names in propSeatRef ("a single tall
    // block whose top face IS the seating surface"). entities/character.js's V2
    // chair solve therefore never ran, the legacy squat pose did, and the body
    // folded on top of the block with its knees at its chest. That is the
    // owner's screenshot, and the cure is to draw a REAL seat and say so.
    //
    // READ the kit's number, never retype it (propuse.js's own doctrine): one
    // edit to SEAT_H there moves the mesh and the pose together.
    var SEAT_CUSH = (typeof CBZ.propSeatHeight === "function")
      ? +CBZ.propSeatHeight("seat") : 0.45;           // cushion top above the deck
    var SEAT_W = 0.50, SEAT_D = 0.46;                 // a real tip-up seat
    var SEAT_BACK_H = 0.44;                           // backrest above the cushion
    var SEAT_H = SEAT_CUSH;                           // legacy alias: anchor height
    // Seat-colour banding by TIER, so the owner can COUNT the tiers from inside
    // — that is the whole point of the ask. Families walk ember -> stripe ->
    // maroon as you climb, and every tier is one step along the family.
    var LOWER = [0xc8912a, 0xb9821f, 0xd39b33];
    var UPPER = [0x8c1f2c, 0x7a1a26, 0x9a2634];
    var STRIPE = [0x1d3f6e, 0x24508a];
    function seatColour(row, x, z) {
      var t = tierOf(row);
      // every CROSS_EVERY-th tier is the contrast band that marks a concourse
      if (CROSS_EVERY > 1 && (t % CROSS_EVERY) === 0 && t > 0) return hpick(STRIPE, x, z, 0x51);
      return hpick(t * 2 < TIERS ? LOWER : UPPER, x, z, 0x52);
    }
    function notchRow(r) { return r >= NOTCH_LO && r <= NOTCH_HI; }
    // How many AABB wedges a corner arc needs at radial depth d so the wedge's
    // bulge never reaches into the next row. DERIVED from the tread, not tuned:
    // the sagitta of a chord subtending 2t at radius d is d(1-cos t), and we
    // allow at most 45% of a tread. Coarse near the floor, fine in the gods —
    // the old fixed W=6 was correct at d<=36 and wrong for a 20-tier bowl.
    function cornerSegs(d, tread) {
      var tol = tread * 0.45;
      var half = Math.acos(Math.max(-1, Math.min(1, 1 - Math.min(0.9, tol / Math.max(1, d)))));
      if (!(half > 1e-4)) return 12;
      return Math.max(3, Math.min(12, Math.ceil((Math.PI / 2) / (2 * half))));
    }

    // straight-side platform for one row, split around the vomitory notches
    function rowStraightPlats(side, dIn, dOut, top, cut) {
      var lo, hi, cuts = [], i;
      if (side === "xp" || side === "xn") { lo = CZ - B; hi = CZ + B; }
      else { lo = CX - A; hi = CX + A; }
      if (cut) {
        for (i = 0; i < VOMS.length; i++) {
          if (VOMS[i].side !== side) continue;
          var base = (side === "xp" || side === "xn") ? CZ : CX;
          cuts.push(base + VOMS[i].k);
        }
      }
      cuts.sort(function (a, b) { return a - b; });
      var spans = [], at = lo;
      for (i = 0; i < cuts.length; i++) {
        if (cuts[i] - VOM_HW > at) spans.push([at, cuts[i] - VOM_HW]);
        at = Math.max(at, cuts[i] + VOM_HW);
      }
      if (at < hi) spans.push([at, hi]);
      for (i = 0; i < spans.length; i++) {
        var a0 = spans[i][0], a1 = spans[i][1];
        if (side === "xp") plat(CX + A + dIn, a0, CX + A + dOut, a1, top);
        else if (side === "xn") plat(CX - A - dOut, a0, CX - A - dIn, a1, top);
        else if (side === "zp") plat(a0, CZ + B + dIn, a1, CZ + B + dOut, top);
        else plat(a0, CZ - B - dOut, a1, CZ - B - dIn, top);
      }
    }

    var SOLID_STAND = CFG.ARENA_STAND_SOLID !== false;
    var standColliders = 0;
    for (var r = 0; r < ROWS; r++) {
      (function (r) {
        var df = deckFront(r), dd = deckDepth(r), dy = rowY(r), cut = notchRow(r);
        var vp = cut ? 1.8 : 7.0;      // fine sampling only where we must cut
        var tI = tierOf(r), first = tierFirst(r);

        // --- deck slab (visual)
        walkRing(df + dd / 2, vp, function (s) {
          if (cut && isStraight(s.side) && vomGap(s)) return;
          put("deck", { x: s.x, y: dy - 0.09, z: s.z, sx: s.len + 0.06, sy: 0.18, sz: dd, ry: s.yaw });
        });
        // --- deck platforms: straights exact, corners as wedge AABBs
        rowStraightPlats("xp", df, df + dd, dy, cut);
        rowStraightPlats("xn", df, df + dd, dy, cut);
        rowStraightPlats("zp", df, df + dd, dy, cut);
        rowStraightPlats("zn", df, df + dd, dy, cut);
        for (var ci = 0; ci < 4; ci++) {
          var ox = (ci === 0 || ci === 3) ? CX + A : CX - A;
          var oz = (ci === 0 || ci === 1) ? CZ + B : CZ - B;
          var a0 = ci * Math.PI / 2, W = cornerSegs(df + dd, treadOf(r)), st = (Math.PI / 2) / W;
          for (var w = 0; w < W; w++) {
            var mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
            for (var t = 0; t <= 3; t++) {
              var aa = a0 + st * (w + t / 3);
              var cc = Math.cos(aa), ss = Math.sin(aa);
              var xs = [ox + cc * df, ox + cc * (df + dd)], zs = [oz + ss * df, oz + ss * (df + dd)];
              for (var u = 0; u < 2; u++) {
                if (xs[u] < mnx) mnx = xs[u]; if (xs[u] > mxx) mxx = xs[u];
                if (zs[u] < mnz) mnz = zs[u]; if (zs[u] > mxz) mxz = zs[u];
              }
            }
            plat(mnx, mnz, mxx, mxz, dy);
          }
        }
        // --- riser face (row 0's riser IS the bowl-front wall, built above),
        //     plus a bright NOSING on the first row of every tier: that stripe
        //     is what makes 20 tiers countable from across the bowl.
        if (r > 0) {
          walkRing(df + 0.07, cut ? 1.8 : 6.0, function (s) {
            if (cut && isStraight(s.side) && vomGap(s)) return;
            put("riser", { x: s.x, y: dy - RISE / 2, z: s.z, sx: s.len + 0.05, sy: RISE, sz: 0.14, ry: s.yaw });
            if (first) put("rail", { x: s.x, y: dy - 0.03, z: s.z, sx: s.len + 0.05, sy: 0.06, sz: 0.19, ry: s.yaw });
          });
        }
        // --- seats: a real PAN at the declared cushion height plus a BACK.
        //     The pan is drawn only on the tiers you can walk up to and look at
        //     (a deliberate LOD — from tier 3 up all you ever see is seat backs,
        //     and every occupied seat is hidden by the body on it anyway).
        var ds = df + dd - SEAT_D / 2 - 0.12;
        var panTier = tI < 3;
        walkRing(ds, PITCH, function (s) {
          if (aisleGap(s)) return;
          if (cut && isStraight(s.side) && vomGap(s, VOM_HW + 0.4)) return;
          var col = seatColour(r, s.x, s.z);
          // backrest — the seat's silhouette, rear of the pan, leaning back a touch
          put("seat", {
            x: s.x + s.nx * 0.19, y: dy + SEAT_CUSH + SEAT_BACK_H * 0.5, z: s.z + s.nz * 0.19,
            sx: SEAT_W, sy: SEAT_BACK_H, sz: 0.08, ry: s.yaw, c: col
          });
          if (panTier) {
            put("seat", {
              x: s.x, y: dy + SEAT_CUSH - 0.045, z: s.z,
              sx: SEAT_W, sy: 0.09, sz: SEAT_D, ry: s.yaw, c: col
            });
          }
          seatRecords.push({ x: s.x, y: dy, z: s.z, yaw: s.yaw + Math.PI, row: r, tier: tI });
        });
        // WHY THE SEATS THEMSELVES ARE NOT COLLIDERS — this was tried and the
        // MATH REFUSED IT, which is worth recording so nobody tries again.
        // Making each row's seat bank solid (so you cannot cross the rows, as
        // in a real bowl) needs a walkable strip left over on the tread. The
        // tread is 0.78-0.95 m and a bank has to be ~0.6 m thick to stop a
        // body; with a bank at the back of row r AND the back of row r-1 the
        // clear strip is ~0.26 m against a player capsule of RADIUS 0.55. The
        // player would be permanently wedged. A tread wide enough for solid
        // banks (>=1.7 m) is not a stadium rake. So the rows stay climbable
        // (0.42 riser, under physics.js's 0.45 STEP_UP — the bowl's original
        // contract, kept) and what gets colliders is the STRUCTURE you could
        // otherwise run through: the bowl front, every cross-aisle rail, the
        // top rail and the back wall — see the handrail block below, where all
        // three used to be put() decoration with no solid() at all.
      })(r);
    }

    // ---------------- handrails: every cross-aisle + the front and the back ---
    // ALL THREE ARE REAL COLLIDERS. They used to be pure decoration — put()
    // only, no solid() — so you walked straight through the barrier at the top
    // of a 22 m bowl and off the front of the podium. The rail bar sits high
    // enough to vault nothing and is height-gated so it never affects anybody
    // on the deck below it.
    (function () {
      function railRing(d, baseY, h, guard) {
        walkRing(d, 2.6, function (s) {
          if (aisleGap(s)) return;
          if (isStraight(s.side) && (vomGap(s, VOM_HW + 0.4) || gateGap(s, GATE_HW + 0.6))) return;
          put("rail", { x: s.x, y: baseY + h, z: s.z, sx: s.len + 0.05, sy: 0.09, sz: 0.09, ry: s.yaw });
          put("steel", { x: s.x, y: baseY + h / 2, z: s.z, sx: 0.08, sy: h, sz: 0.08, ry: s.yaw });
        });
        if (!guard || !SOLID_STAND) return;
        // one coarse solid ring behind the visual bar (pitch 5, not 2.6): the
        // barrier only has to stop a body, not trace the balusters. Height
        // gated to the rail band, so a body on the deck BELOW it is untouched.
        var before = colliders.length;
        ringSolid(d, 0.24, baseY, baseY + h + 0.5, {
          pitch: 5.0, mesh: false,
          skip: function (s) {
            return aisleGap(s) || (isStraight(s.side) && (vomGap(s, VOM_HW + 0.4) || gateGap(s, GATE_HW + 0.6)));
          }
        });
        standColliders += colliders.length - before;
      }
      // the front of row 0 — a 4.2 m drop onto the arena floor without it
      railRing(deckFront(0) - 0.14, rowY(0), 1.06, true);
      // one at EVERY cross-aisle, not just the single old XROW
      for (var r2 = 1; r2 < ROWS; r2++) {
        if (crossRow(r2)) railRing(deckFront(r2) - 0.12, rowY(r2), 0.98, true);
      }
      railRing(D_TOP + 0.25, TOP_Y, 1.04, false);
      // solid back wall behind the top row — you cannot step off the bowl
      ringSolid(D_TOP + 0.62, 0.6, TOP_Y, TOP_Y + 1.4, { pitch: 5.0, mesh: false });
    })();

    // ---------------- aisle step treads (two half-risers per row) ------------
    // Visual only: the walk surface is the row deck platform, which every row
    // registers. Tread depth comes from treadOf(r), so the steps stay glued to
    // a variable rake instead of a frozen 1.30.
    (function () {
      function aisleSteps(side, key) {
        for (var r2 = 1; r2 < ROWS; r2++) {
          if (notchRow(r2)) {
            // this aisle is interrupted by its vomitory notch
            var skip = false;
            for (var vi = 0; vi < VOMS.length; vi++) {
              var base = (side === "xp" || side === "xn") ? CZ : CX;
              if (VOMS[vi].side === side && Math.abs(key - (base + VOMS[vi].k)) < VOM_HW) { skip = true; break; }
            }
            if (skip) continue;
          }
          var TR = treadOf(r2);
          var df = deckFront(r2), yb = rowY(r2), mid = df - TR / 2;
          for (var h = 0; h < 2; h++) {
            var dstep = mid + (h ? TR * 0.25 : -TR * 0.25);
            var yy = yb - RISE + RISE * (h ? 0.75 : 0.25);
            var p = straightPoint(side, dstep, key);
            put("concrete", {
              x: p.x, y: yy - 0.1, z: p.z, sx: AISLE_H * 2 - 0.1, sy: 0.2,
              sz: TR * 0.5, ry: yawOf(p.nx, p.nz)
            });
          }
        }
      }
      var i;
      for (i = 0; i < AIS_X.length; i++) { aisleSteps("xp", CZ + AIS_X[i]); aisleSteps("xn", CZ + AIS_X[i]); }
      for (i = 0; i < AIS_Z.length; i++) { aisleSteps("zp", CX + AIS_Z[i]); aisleSteps("zn", CX + AIS_Z[i]); }
    })();

    // =========================================================== UNDER-STAND
    // Rear skirt wall closing the under-stand volume, with vomitory + main-gate
    // openings. Everything behind the bowl front is sealed except those tunnels.
    ringSolid(D_BACK, 1.0, PY, TOP_Y + 0.6, {
      pitch: 4.0, pool: "steel",
      skip: function (s) { return (isStraight(s.side) && vomGap(s, VOM_HW + 0.2)) || gateGap(s, GATE_HW + 0.2); }
    });

    // ------------------------------------------------ vomitory ramps + walls
    (function () {
      for (var i = 0; i < VOMS.length; i++) {
        var v = VOMS[i], side = v.side;
        var base = (side === "xp" || side === "xn") ? CZ : CX;
        var k = base + v.k;
        var pIn = straightPoint(side, VOM_D_IN, k), pOut = straightPoint(side, VOM_D_OUT, k);
        var pCov = straightPoint(side, VOM_D_COVER, k);
        var yaw = yawOf(pIn.nx, pIn.nz);

        // Wall heights are split at the notch: inside the cut they guard up to
        // just under row NOTCH_HI+1's deck; under the covered run they stop at
        // 2.9 so nobody walking the intact rows ABOVE the tunnel is blocked by
        // an invisible slab.
        var yNotch = CROSS_Y + 1.2;
        // LANDING: the cross-aisle deck is CUT at the vomitory (that cut is what
        // lets the tunnel surface), so the ramp used to end on a seam with a
        // hole the width of the tunnel beside it. One flat platform over the
        // cut, at the cross-aisle's own height, closes it.
        var pLand = straightPoint(side, deckFront(XROW) + deckDepth(XROW), k);
        if (side === "xp" || side === "xn") {
          plat(Math.min(pIn.x, pLand.x), k - VOM_HW, Math.max(pIn.x, pLand.x), k + VOM_HW, CROSS_Y);
        } else {
          plat(k - VOM_HW, Math.min(pIn.z, pLand.z), k + VOM_HW, Math.max(pIn.z, pLand.z), CROSS_Y);
        }
        if (side === "xp" || side === "xn") {
          plat(pOut.x, k - VOM_HW, pIn.x, k + VOM_HW, CROSS_Y,
               { axis: "x", x0: pOut.x, x1: pIn.x, y0: PY, y1: CROSS_Y });
          solid(pCov.x, k - VOM_HW - 0.55, pIn.x, k - VOM_HW, PY, yNotch);
          solid(pCov.x, k + VOM_HW, pIn.x, k + VOM_HW + 0.55, PY, yNotch);
        } else {
          plat(k - VOM_HW, pOut.z, k + VOM_HW, pIn.z, CROSS_Y,
               { z0: pOut.z, z1: pIn.z, y0: PY, y1: CROSS_Y });
          solid(k - VOM_HW - 0.55, pCov.z, k - VOM_HW, pIn.z, PY, yNotch);
          solid(k + VOM_HW, pCov.z, k + VOM_HW + 0.55, pIn.z, PY, yNotch);
        }
        // notch cheek walls (visible inside the cut)
        var midNotchX = (pIn.x + pCov.x) / 2, midNotchZ = (pIn.z + pCov.z) / 2;
        var notchLen = Math.hypot(pCov.x - pIn.x, pCov.z - pIn.z);
        var tanX = -pIn.nz, tanZ = pIn.nx;
        for (var sg = -1; sg <= 1; sg += 2) {
          put("dark", { x: midNotchX + tanX * sg * (VOM_HW + 0.27), y: CROSS_Y - 0.6,
                        z: midNotchZ + tanZ * sg * (VOM_HW + 0.27),
                        sx: 0.54, sy: 2.4, sz: notchLen, ry: yaw });
        }
        // The COVERED run climbs with the ramp, so its roof and cheeks are
        // STEPPED (four level segments) rather than one slab — a flat roof at a
        // fixed height would slice straight through the rising ramp deck.
        var SEGS = 4, segL = (VOM_D_OUT - VOM_D_COVER) / SEGS;
        for (var q = 0; q < SEGS; q++) {
          var dA = VOM_D_OUT - q * segL, dB = dA - segL, dM = (dA + dB) / 2;
          var yRampB = PY + (CROSS_Y - PY) * (VOM_D_OUT - dB) / (VOM_D_OUT - VOM_D_IN);
          var roofY = yRampB + 2.55;
          var pM = straightPoint(side, dM, k);
          put("steel", { x: pM.x, y: roofY, z: pM.z, sx: VOM_HW * 2 + 1.1, sy: 0.32, sz: segL + 0.1, ry: yaw });
          for (var sg2 = -1; sg2 <= 1; sg2 += 2) {
            put("dark", { x: pM.x + tanX * sg2 * (VOM_HW + 0.27), y: (PY + roofY) / 2,
                          z: pM.z + tanZ * sg2 * (VOM_HW + 0.27),
                          sx: 0.54, sy: roofY - PY, sz: segL + 0.1, ry: yaw });
          }
          if (side === "xp" || side === "xn") {
            var xA = straightPoint(side, dA, k).x, xB = straightPoint(side, dB, k).x;
            solid(xA, k - VOM_HW - 0.55, xB, k - VOM_HW, PY, roofY);
            solid(xA, k + VOM_HW, xB, k + VOM_HW + 0.55, PY, roofY);
          } else {
            var zA = straightPoint(side, dA, k).z, zB = straightPoint(side, dB, k).z;
            solid(k - VOM_HW - 0.55, zA, k - VOM_HW, zB, PY, roofY);
            solid(k + VOM_HW, zA, k + VOM_HW + 0.55, zB, PY, roofY);
          }
        }
        // a lit mouth so the notch reads from across the bowl
        put("lamp", { x: pIn.x - pIn.nx * 0.4, y: CROSS_Y + 0.5, z: pIn.z - pIn.nz * 0.4,
                      sx: VOM_HW * 1.9, sy: 0.12, sz: 0.12, ry: yaw });
      }
    })();

    // ------------------------------------------- grand west entrance tunnel
    // Runs flat at floor level from outside the facade, under the -x stand,
    // through the bowl-front opening and onto the arena floor. The causeway
    // arrives on this axis, so this is the walk-in every player takes.
    (function () {
      var xOuter = CX - A - D_FACE - 6, xInner = CX - A - D0 + 0.5;
      var midX = (xOuter + xInner) / 2, lenX = Math.abs(xInner - xOuter);
      // y1 stops just UNDER row 0's deck (PY + FRONT_H) so a spectator walking
      // the rows above the tunnel never hits an invisible wall.
      solid(xOuter, CZ - GATE_HW - 0.9, xInner, CZ - GATE_HW, PY, PY + FRONT_H - 0.1);
      solid(xOuter, CZ + GATE_HW, xInner, CZ + GATE_HW + 0.9, PY, PY + FRONT_H - 0.1);
      put("dark", { x: midX, y: PY + 1.7, z: CZ - GATE_HW - 0.45, sx: lenX, sy: 3.4, sz: 0.9 });
      put("dark", { x: midX, y: PY + 1.7, z: CZ + GATE_HW + 0.45, sx: lenX, sy: 3.4, sz: 0.9 });
      put("steel", { x: midX, y: PY + 3.6, z: CZ, sx: lenX, sy: 0.4, sz: GATE_HW * 2 + 1.8 });
      // portal arch on the facade + up-lights along the walk
      put("concrete", { x: xOuter, y: PY + 4.4, z: CZ, sx: 1.8, sy: 1.8, sz: GATE_HW * 2 + 3.6 });
      put("concrete", { x: xOuter, y: PY + 2.1, z: CZ - GATE_HW - 1.4, sx: 1.8, sy: 4.2, sz: 1.8 });
      put("concrete", { x: xOuter, y: PY + 2.1, z: CZ + GATE_HW + 1.4, sx: 1.8, sy: 4.2, sz: 1.8 });
      solid(xOuter - 0.9, CZ - GATE_HW - 2.3, xOuter + 0.9, CZ - GATE_HW - 0.5, PY, PY + 4.2);
      solid(xOuter - 0.9, CZ + GATE_HW + 0.5, xOuter + 0.9, CZ + GATE_HW + 2.3, PY, PY + 4.2);
      for (var i = 0; i < 9; i++) {
        var lx = xOuter + (i + 0.5) * (lenX / 9);
        put("lamp", { x: lx, y: PY + 3.32, z: CZ, sx: 1.1, sy: 0.1, sz: 1.1 });
      }
    })();

    // ================================================================ FACADE
    function facadePortal(s) {
      if (gateGap(s, GATE_HW + 1.4)) return true;
      if (s.side === "xp" && Math.abs(s.key - CZ) < 4.2) return true;
      if (s.side === "zp" && Math.abs(s.key - CX) < 4.2) return true;
      if (s.side === "zn" && Math.abs(s.key - CX) < 4.2) return true;
      return false;
    }
    ringSolid(D_OUT + 1.0, 2.0, PY, ROOF_Y, { pitch: 5.0, pool: "concrete", skip: facadePortal });
    // lintels ABOVE each portal so the facade reads continuous over the openings
    walkRing(D_OUT + 1.0, 5.0, function (s) {
      if (!facadePortal(s)) return;
      var y0 = PY + 5.6;
      put("concrete", { x: s.x, y: (y0 + ROOF_Y) / 2, z: s.z, sx: s.len + 0.1, sy: ROOF_Y - y0, sz: 2.0, ry: s.yaw });
    });
    // vertical fins
    walkRing(D_OUT + 2.15, 4.0, function (s) {
      put("steel", { x: s.x, y: (PY + ROOF_Y) / 2, z: s.z, sx: 0.5, sy: ROOF_Y - PY, sz: 0.6, ry: s.yaw });
    });
    // parapet
    walkRing(D_OUT + 1.0, 6.0, function (s) {
      put("dark", { x: s.x, y: ROOF_Y + 0.9, z: s.z, sx: s.len + 0.1, sy: 1.8, sz: 2.3, ry: s.yaw });
    });
    // LOS proxies — the facade, made opaque to every sight query in the game.
    // The straights are one slab each; the CORNERS are walked, because a corner
    // here is a quarter-arc of radius df2 and df2 rides the bowl (60.7 m at 20
    // tiers, so 95 m of arc per corner — see ARENA_LOS_FULL for the measurement
    // and for what the old single 11 x 11 block per corner left open). Both the
    // arc walk and the box height come from the same plan values the facade
    // geometry above is built from, so the proxy cannot drift from the wall.
    // ~36 invisible boxes, still nothing next to the losgrid's 17k meshes.
    (function () {
      var df2 = D_OUT + 1;
      var full = CFG.ARENA_LOS_FULL !== false;
      var LH = full ? (ROOF_Y - PY) : 16;          // facade height, not a typed 16
      var LY = PY + LH / 2;
      losBox(CX + A + df2, LY, CZ, 2.4, LH, 2 * B);
      losBox(CX - A - df2, LY, CZ, 2.4, LH, 2 * B);
      losBox(CX, LY, CZ + B + df2, 2 * A, LH, 2.4);
      losBox(CX, LY, CZ - B - df2, 2 * A, LH, 2.4);
      if (full) {
        // Walk each corner arc with the SAME helper the facade ring uses. Each
        // sample is an oriented chord; losBox is axis-aligned, so take the
        // chord's AABB exactly the way ringSolid does for its colliders.
        for (var ci = 0; ci < 4; ci++) {
          runCorner(ci, df2, 12.0, function (s) {
            var c = Math.abs(Math.cos(s.yaw)), sn = Math.abs(Math.sin(s.yaw));
            var hx = s.len / 2, hz = 1.2;
            losBox(s.x, LY, s.z, 2 * (hx * c + hz * sn), LH, 2 * (hx * sn + hz * c));
          });
        }
      } else {
        var q = df2 * 0.7071;
        losBox(CX + A + q, LY, CZ + B + q, 11, LH, 11);
        losBox(CX - A - q, LY, CZ + B + q, 11, LH, 11);
        losBox(CX + A + q, LY, CZ - B - q, 11, LH, 11);
        losBox(CX - A - q, LY, CZ - B - q, 11, LH, 11);
      }
      // NOTE: deliberately NO blocker over the seating mass itself. A slab
      // there would make every spectator in the bowl unshootable from the
      // floor (losgrid is front-face-only, so it blocks from outside but not
      // from inside), which is worse than letting a stray round cross the bowl.
    })();

    // ---------------------------------------- rear concourse: roof + columns
    walkRing(D_OUT - CONC / 2, 7.0, function (s) {
      put("concrete", { x: s.x, y: CONC_CEIL, z: s.z, sx: s.len + 0.1, sy: 0.35, sz: CONC + 1.0, ry: s.yaw });
    });
    walkRing(D_OUT - 1.7, 9.0, function (s) {
      // never drop a column into a tunnel mouth
      if (isStraight(s.side) && (vomGap(s, VOM_HW + 1.2) || gateGap(s, GATE_HW + 1.2))) return;
      put("steel", { x: s.x, y: (PY + CONC_CEIL) / 2, z: s.z, sx: 0.7, sy: CONC_CEIL - PY, sz: 0.7, ry: s.yaw });
      solid(s.x - 0.45, s.z - 0.45, s.x + 0.45, s.z + 0.45, PY, CONC_CEIL);
    });

    // ==================================================== ROOF + TRUSS + RIG
    // Cantilevered canopy over the STANDS ONLY: the floor stays open to the
    // sky, so the sun/shadow pass still lights the ring and the bowl doesn't
    // turn into an unlit black box.
    (function () {
      var span = CANOPY_OUT - CANOPY_IN;
      var bands = 4, bw = span / bands;
      for (var b = 0; b < bands; b++) {
        (function (dm, w) {
          walkRing(dm, 8.0, function (s) {
            put("steel", { x: s.x, y: ROOF_Y, z: s.z, sx: s.len + 0.12, sy: 0.34, sz: w + 0.2, ry: s.yaw });
          });
        })(CANOPY_IN + bw * (b + 0.5), bw);
      }
      // circumferential truss: bottom chord + alternating diagonals
      walkRing((CANOPY_IN + CANOPY_OUT) / 2, 6.5, function (s) {
        put("truss", { x: s.x, y: ROOF_Y - 2.1, z: s.z, sx: s.len + 0.1, sy: 0.22, sz: 0.22, ry: s.yaw });
        put("truss", { x: s.x, y: ROOF_Y - 1.05, z: s.z, sx: 0.18, sy: 2.5, sz: 0.18, ry: s.yaw, rz: 0.42 });
        put("truss", { x: s.x, y: ROOF_Y - 1.05, z: s.z, sx: 0.18, sy: 2.5, sz: 0.18, ry: s.yaw, rz: -0.42 });
      });
      // radial rafters: one deep beam per sample, spanning the whole canopy
      walkRing((CANOPY_IN + CANOPY_OUT) / 2, 9.0, function (s) {
        put("truss", { x: s.x, y: ROOF_Y - 0.5, z: s.z, sx: 0.34, sy: 0.6, sz: span, ry: s.yaw });
      });
      // inner-edge fascia + hanging banners under it
      walkRing(CANOPY_IN, 6.0, function (s) {
        put("dark", { x: s.x, y: ROOF_Y - 0.75, z: s.z, sx: s.len + 0.1, sy: 1.2, sz: 0.5, ry: s.yaw });
      });
      var BAN = [0xc22333, 0x2246c2, 0xd8a020, 0xe8e4da];
      walkRing(CANOPY_IN + 0.4, 11.0, function (s) {
        put("banner", { x: s.x, y: ROOF_Y - 3.6, z: s.z, sx: 2.4, sy: 4.4, sz: 0.12, ry: s.yaw,
                        c: hpick(BAN, s.x, s.z, 0x71) });
      });
    })();

    // ------- lighting gantry: two straight trusses spanning the arena floor
    (function () {
      var span = A + D0 - 3;
      var lines = [CZ - 22, CZ + 22];
      for (var l = 0; l < lines.length; l++) {
        var zz = lines[l];
        put("truss", { x: CX, y: GANTRY_Y, z: zz - 0.9, sx: span * 2, sy: 0.3, sz: 0.3 });
        put("truss", { x: CX, y: GANTRY_Y, z: zz + 0.9, sx: span * 2, sy: 0.3, sz: 0.3 });
        put("truss", { x: CX, y: GANTRY_Y - 1.5, z: zz - 0.9, sx: span * 2, sy: 0.3, sz: 0.3 });
        put("truss", { x: CX, y: GANTRY_Y - 1.5, z: zz + 0.9, sx: span * 2, sy: 0.3, sz: 0.3 });
        for (var i = -8; i <= 8; i++) {
          var xx = CX + i * (span / 8.5);
          put("truss", { x: xx, y: GANTRY_Y - 0.75, z: zz, sx: 0.16, sy: 1.9, sz: 2.0 });
          if (i % 2 === 0) {
            // housings + bright lenses (the REAL lights are the gated spots below)
            put("lampbox", { x: xx, y: GANTRY_Y - 2.1, z: zz, sx: 1.5, sy: 0.9, sz: 1.5 });
            put("lamp", { x: xx, y: GANTRY_Y - 2.62, z: zz, sx: 1.26, sy: 0.16, sz: 1.26 });
          }
        }
        for (var hgi = -1; hgi <= 1; hgi += 2) {
          put("truss", { x: CX + hgi * span, y: (GANTRY_Y + ROOF_Y) / 2, z: zz,
                         sx: 0.26, sy: Math.abs(ROOF_Y - GANTRY_Y), sz: 0.26 });
        }
      }
    })();

    // ---------------------------------------------------------- real lights
    (function () {
      if (!CFG.ARENA_LIGHT_RIG) return;
      var q = (CBZ.qualityLevel == null ? 3 : CBZ.qualityLevel);
      var ambient = new THREE.PointLight(0xffe9c4, 0.55, 300, 1);
      ambient.position.set(CX, PY + 22, CZ);
      ambient.visible = false;
      V.add(ambient); lights.push(ambient);
      var targets = spec.spotTargets || [];
      var nSpots = q >= 4 ? 4 : (q >= 3 ? 3 : (q >= 2 ? 1 : 0));
      for (var i = 0; i < Math.min(nSpots, targets.length); i++) {
        var t = targets[i];
        var L = new THREE.SpotLight(0xfff3d6, t.intensity == null ? 1.6 : t.intensity,
                                    72, t.angle == null ? 0.5 : t.angle, 0.5, 1.1);
        L.position.set(t.x, GANTRY_Y - 2.7, t.z);
        L.target.position.set(t.x, t.y == null ? PY : t.y, t.z);
        L.visible = false;
        V.add(L); V.add(L.target); lights.push(L);
      }
    })();

    // ============================================================= JUMBOTRON
    var boardTex = null, boardLines = ["IRONJAW ARENA", "FIGHT NIGHT", "BOXING / MMA / BEAST PIT"];
    function drawBoard(c, w, h, lines) {
      c.fillStyle = "#07090d"; c.fillRect(0, 0, w, h);
      var gd = c.createLinearGradient(0, 0, 0, h);
      gd.addColorStop(0, "rgba(40,60,90,.55)"); gd.addColorStop(1, "rgba(8,10,16,.92)");
      c.fillStyle = gd; c.fillRect(0, 0, w, h);
      c.strokeStyle = "#e0a020"; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12);
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = "#ffd24a"; c.font = "bold 42px Arial";
      c.fillText(String(lines[0] || ""), w / 2, 60);
      c.fillStyle = "#e9f0fa"; c.font = "bold 32px Arial";
      c.fillText(String(lines[1] || ""), w / 2, 130);
      c.fillStyle = "#9fb0c6"; c.font = "24px Arial";
      c.fillText(String(lines[2] || ""), w / 2, 192);
    }
    if (CFG.ARENA_JUMBOTRON) {
      boardTex = ctex(512, 256, function (c, w, h) { drawBoard(c, w, h, boardLines); });
      if (boardTex) {
        var frame = new THREE.Mesh(new THREE.BoxGeometry(12.6, 6.4, 12.6), mat(0x14171d));
        frame.position.set(CX, PY + 15.0, CZ);
        frame.userData.arenaBoardFrame = true;
        V.add(frame);
        var boardMesh = new THREE.Mesh(new THREE.BoxGeometry(12.2, 5.5, 12.2),
          new THREE.MeshBasicMaterial({ map: boardTex }));
        boardMesh.position.set(CX, PY + 15.0, CZ);
        boardMesh.userData.arenaBoard = true;
        V.add(boardMesh);
        for (var hb = -1; hb <= 1; hb += 2) {
          put("truss", { x: CX + hb * 4.5, y: (PY + 18.2 + GANTRY_Y) / 2, z: CZ - 22,
                         sx: 0.14, sy: Math.abs(GANTRY_Y - (PY + 18.2)), sz: 0.14 });
          put("truss", { x: CX + hb * 4.5, y: (PY + 18.2 + GANTRY_Y) / 2, z: CZ + 22,
                         sx: 0.14, sy: Math.abs(GANTRY_Y - (PY + 18.2)), sz: 0.14 });
        }
      }
    }

    // ================================================= AISLE-NUMBER SIGNAGE
    var signTex = ctex(512, 512, function (c, w, h) {
      for (var i = 0; i < 16; i++) {
        var gx = (i % 4) * 128, gy = ((i / 4) | 0) * 128;
        c.fillStyle = "#0f1319"; c.fillRect(gx, gy, 128, 128);
        c.strokeStyle = "#ffd24a"; c.lineWidth = 5; c.strokeRect(gx + 5, gy + 5, 118, 118);
        c.fillStyle = "#9fb0c6"; c.font = "bold 20px Arial";
        c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText("AISLE", gx + 64, gy + 38);
        c.fillStyle = "#ffd24a"; c.font = "bold 60px Arial";
        c.fillText(String(i + 1), gx + 64, gy + 88);
      }
      void h;
    });
    if (signTex) {
      var sq = new QuadBatch(), sn = 0;
      var signD = deckFront(XROW) - 0.55;
      var signAt = function (side, key) {
        var p = straightPoint(side, signD, key);
        var cell = sn % 16; sn++;
        var u = (cell % 4) / 4, v = 1 - (((cell / 4) | 0) + 1) / 4;
        // faces inward, across the bowl
        sq.add(p.x, CROSS_Y + 1.9, p.z, 1.7, 1.7, yawOf(-p.nx, -p.nz),
               u + 0.005, v + 0.005, u + 0.25 - 0.005, v + 0.25 - 0.005);
        put("steel", { x: p.x, y: CROSS_Y + 0.6, z: p.z, sx: 0.13, sy: 1.2, sz: 0.13 });
      };
      (function () {
        var i;
        for (i = 0; i < AIS_X.length; i++) { signAt("xp", CZ + AIS_X[i]); signAt("xn", CZ + AIS_X[i]); }
        for (i = 0; i < AIS_Z.length; i++) { signAt("zp", CX + AIS_Z[i]); signAt("zn", CX + AIS_Z[i]); }
      })();
      var sg = sq.geo();
      if (sg) {
        var sm = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: signTex, transparent: true }));
        sm.userData.arenaSigns = true;
        V.add(sm);
      }
    }

    // ============================================ FACADE SIGN + WEST MARQUEE
    var nameTex = ctex(1024, 256, function (c, w, h) {
      c.fillStyle = "#0c0f14"; c.fillRect(0, 0, w, h);
      c.strokeStyle = "#e0a020"; c.lineWidth = 12; c.strokeRect(12, 12, w - 24, h - 24);
      c.fillStyle = "#ffd24a"; c.font = "bold 118px Arial";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("IRONJAW ARENA", w / 2, h / 2 - 8);
      c.fillStyle = "#8f9bb0"; c.font = "bold 28px Arial";
      c.fillText("FIGHT COMPLEX", w / 2, h - 46);
    });
    if (nameTex) {
      var nq = new QuadBatch(), dS = D_FACE + 0.2;
      nq.add(CX - A - dS, PY + 11.6, CZ, 30, 5.6, yawOf(-1, 0), 0, 0, 1, 1);
      nq.add(CX + A + dS, PY + 11.6, CZ, 30, 5.6, yawOf(1, 0), 0, 0, 1, 1);
      nq.add(CX, PY + 11.6, CZ + B + dS, 30, 5.6, yawOf(0, 1), 0, 0, 1, 1);
      nq.add(CX, PY + 11.6, CZ - B - dS, 30, 5.6, yawOf(0, -1), 0, 0, 1, 1);
      var ng = nq.geo();
      if (ng) {
        var nm = new THREE.Mesh(ng, new THREE.MeshBasicMaterial({ map: nameTex }));
        nm.userData.arenaName = true;
        V.add(nm);
      }
    }

    (function () {   // marquee + ticket booths + queue rails on the causeway side
      var mx = CX - A - D_FACE - 9;
      put("concrete", { x: mx, y: PY + 6.5, z: CZ, sx: 1.8, sy: 1.7, sz: 20 });
      put("concrete", { x: mx, y: PY + 3.25, z: CZ - 9.4, sx: 1.8, sy: 6.5, sz: 1.8 });
      put("concrete", { x: mx, y: PY + 3.25, z: CZ + 9.4, sx: 1.8, sy: 6.5, sz: 1.8 });
      solid(mx - 0.9, CZ - 10.3, mx + 0.9, CZ - 8.5, PY, PY + 6.5);
      solid(mx - 0.9, CZ + 8.5, mx + 0.9, CZ + 10.3, PY, PY + 6.5);
      var mtex = ctex(1024, 256, function (c, w, h) {
        c.fillStyle = "#120b06"; c.fillRect(0, 0, w, h);
        for (var i = 0; i < 40; i++) {
          c.fillStyle = (i % 2) ? "#ffe9a8" : "#ffc247";
          c.beginPath(); c.arc(14 + i * 25.6, 20, 8, 0, 6.3); c.fill();
          c.beginPath(); c.arc(14 + i * 25.6, h - 20, 8, 0, 6.3); c.fill();
        }
        c.fillStyle = "#ffd24a"; c.font = "bold 74px Arial";
        c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText("TONIGHT · FIGHT NIGHT", w / 2, h / 2 - 14);
        c.fillStyle = "#e6b25a"; c.font = "bold 32px Arial";
        c.fillText("BOXING · MMA · THE BEAST PIT", w / 2, h / 2 + 46);
      });
      if (mtex) {
        var mq = new QuadBatch();
        mq.add(mx - 0.96, PY + 6.5, CZ, 19, 3.0, yawOf(-1, 0), 0, 0, 1, 1);
        mq.add(mx + 0.96, PY + 6.5, CZ, 19, 3.0, yawOf(1, 0), 0, 0, 1, 1);
        var mg = mq.geo();
        if (mg) {
          var mm = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ map: mtex }));
          mm.userData.arenaMarquee = true;
          V.add(mm);
        }
      }
      for (var b2 = -1; b2 <= 1; b2 += 2) {
        var bz = CZ + b2 * 13.5;
        put("concrete", { x: mx + 2.5, y: PY + 1.6, z: bz, sx: 3.4, sy: 3.2, sz: 3.4 });
        put("dark", { x: mx + 2.5, y: PY + 3.35, z: bz, sx: 4.2, sy: 0.35, sz: 4.2 });
        put("lamp", { x: mx + 0.72, y: PY + 2.1, z: bz, sx: 0.1, sy: 1.0, sz: 2.2 });
        solid(mx + 0.8, bz - 1.7, mx + 4.2, bz + 1.7, PY, PY + 3.4);
      }
      // A QUEUE FORMS OUTSIDE. These rails used to march from the booths
      // EASTWARD — mx + 3.0 + 7·1.6 ends at CX − 71.5, which is 5 units INSIDE
      // the facade wall at CX − (A + D_FACE) — so the last two ran through the
      // building and the queue pointed at the wrong side of the ticket booth.
      // They run outward now, toward the causeway, which is where the people
      // arriving from actually stand.
      for (var qi = 0; qi < 8; qi++) {
        var qx = mx - 2.2 - qi * 1.6;
        put("steel", { x: qx, y: PY + 0.55, z: CZ - 6.2, sx: 0.1, sy: 1.1, sz: 0.1 });
        put("steel", { x: qx, y: PY + 0.55, z: CZ + 6.2, sx: 0.1, sy: 1.1, sz: 0.1 });
        put("rail", { x: qx - 0.8, y: PY + 1.0, z: CZ - 6.2, sx: 1.6, sy: 0.07, sz: 0.07 });
        put("rail", { x: qx - 0.8, y: PY + 1.0, z: CZ + 6.2, sx: 1.6, sy: 0.07, sz: 0.07 });
      }
    })();

    // ====================================================== FLOOR-LEVEL SEATS
    // Loose ringside chairs on the arena floor. No platform records — they're
    // props you walk between, not a deck.
    var floorSlots = [];
    (function () {
      var rings = spec.floorSeatRings || [];
      for (var i = 0; i < rings.length; i++) {
        var g0 = rings[i];
        for (var band = 0; band < (g0.rings || 3); band++) {
          var rad = g0.r0 + band * 1.5;
          var n = Math.max(8, Math.round(2 * Math.PI * rad / 1.35));
          for (var k = 0; k < n; k++) {
            var a = k * Math.PI * 2 / n;
            var px = g0.x + Math.cos(a) * rad, pz = g0.z + Math.sin(a) * rad;
            var yaw = Math.atan2(g0.x - px, g0.z - pz);
            // a REAL folding chair — pan at the declared cushion height, back
            // behind it — not the single 0.84 block that used to make a body
            // squat on top of its own furniture.
            put("chair", { x: px, y: PY + SEAT_CUSH - 0.04, z: pz, sx: 0.52, sy: 0.08, sz: 0.50, ry: yaw });
            put("chair", { x: px - Math.sin(yaw) * 0.22, y: PY + SEAT_CUSH + 0.22, z: pz - Math.cos(yaw) * 0.22,
                           sx: 0.52, sy: 0.44, sz: 0.07, ry: yaw });
            floorSlots.push({ x: px, y: PY, z: pz, yaw: yaw, row: -1, tier: 0 });
          }
        }
      }
    })();

    // ============================================================ SPECTATORS
    // Live NPCs get the best seats (closest to the fight surfaces). Every other
    // seat is a candidate for the instanced proxy crowd — one static seated
    // body, three instanced draws total, deterministic colour and occupancy.
    var seatSlots = [];
    // THE SEAT DECLARES ITS GEOMETRY. `y` stays the CUSHION TOP (npclife's
    // attach() writes the anchor straight onto the rig group), and the two new
    // fields are what attach() forwards into ch.seatRef — cushion height above
    // the deck, and how far the deck is BELOW the anchor. Identical convention
    // to island_airport.js's airliner rows, which is the worked example.
    function seatAnchor(rec) {
      var a = { x: rec.x, y: rec.y + SEAT_CUSH, z: rec.z, yaw: rec.yaw };
      if (CFG.ARENA_SEAT_POSE !== false) { a.cushionH = SEAT_CUSH; a.floorBelow = SEAT_CUSH; }
      return a;
    }
    (function () {
      if (!seatRecords.length) return;
      var want = Math.min(spec.liveSeats == null ? 42 : spec.liveSeats, seatRecords.length);
      var cand = [], i;
      // the tiers a player can actually WALK to and talk to (tier 0-1), not a
      // frozen row index — a 20-tier bowl and a 2-tier bowl both work.
      for (i = 0; i < seatRecords.length; i++) if (seatRecords[i].tier <= 1) cand.push(seatRecords[i]);
      if (!cand.length) cand = seatRecords.slice(0);
      var focus = spec.focus || { x: CX, z: CZ };
      cand.sort(function (a, b) {
        var da = (a.x - focus.x) * (a.x - focus.x) + (a.z - focus.z) * (a.z - focus.z);
        var db = (b.x - focus.x) * (b.x - focus.x) + (b.z - focus.z) * (b.z - focus.z);
        return da - db || (a.x - b.x) || (a.z - b.z);
      });
      var pick = Math.min(cand.length, want * 8);
      var stride = Math.max(1, Math.floor(pick / want));
      for (var j = 0; j < pick && seatSlots.length < want; j += stride) {
        cand[j]._live = true;
        seatSlots.push(seatAnchor(cand[j]));
      }
    })();

    // ---- THE INSTANCED CROWD IS A DIAL, NOT A CONSTANT ----------------------
    // OWNER: "THE STADIUM IS BARELY FILLED AND NOTHING IS EVER ACTUALLY
    // HAPPENING — IT SHOULD BE FULL WHEN ACTIVE AND NEARLY EMPTY WHEN NOT."
    //
    // The old proxy decided occupancy ONCE at world build from a position hash,
    // so the bowl was frozen at one fill forever — never a crowd, never
    // abandoned. It is now built ONCE for EVERY seat and ORDERED by a
    // deterministic KEENNESS rank (best seats first, exactly how a real venue
    // fills), so occupancy is `mesh.count = fill * total`. That is an integer
    // write per frame: no matrices are rebuilt, no geometry is created or
    // destroyed, and an empty bowl costs the renderer three draw calls of zero
    // instances. Draw-call budget for the WHOLE crowd: 3, at any fill.
    var crowdTotal = 0, crowdCap = 0;
    (function () {
      if (!CFG.ARENA_CROWD_PROXY) return;
      // instance budget by quality tier — the ONE knob a weak device turns. The
      // subset is the keenest N, so a low tier is a sparser crowd, never a
      // crowd with a hole in it.
      var q = (CBZ.qualityLevel == null ? 3 : CBZ.qualityLevel);
      crowdCap = [0, 4000, 8000, 14000, 22000][Math.max(0, Math.min(4, q))];
      if (crowdCap <= 0) return;
      var SHIRTS = [0xb23a3a, 0x2f4f8a, 0x2f7a4f, 0xc9a227, 0x8a4fa0, 0xd8d3c8, 0x333a45, 0xa5562a];
      var SKINS = [0xe8c39a, 0xd9a97c, 0xb5794c, 0x8a5a34, 0x5f3a20, 0xf0d4b4];
      var order = [], i, s;
      for (i = 0; i < seatRecords.length; i++) {
        s = seatRecords[i];
        if (s._live) continue;
        // KEENNESS: low tiers and seats near the fight surfaces fill first, with
        // a hash jitter so the boundary is a scatter, not a clean waterline.
        var dx = s.x - CX, dz = s.z - CZ;
        var k = s.tier / Math.max(1, TIERS) * 0.62
              + Math.min(1, Math.hypot(dx, dz) / (D_TOP + A + B)) * 0.20
              + h01(s.x, s.z, 0x5c) * 0.40;
        order.push({ s: s, k: k, y: s.y + SEAT_CUSH,
                     lean: (h01(s.x, s.z, 0x5f) - 0.5) * 0.25,
                     // A WATCHING BODY SITS FORWARD. A bored one sits back.
                     // Elbows-on-knees is what a fight crowd looks like, and a
                     // bowl of bodies all at the same upright angle is the
                     // single clearest "these are boxes" tell. Deterministic
                     // per seat, and biased forward for the good seats — the
                     // people who paid to be close are the ones leaning in.
                     pitch: (h01(s.x, s.z, 0x63) * 0.34 - 0.09) * (1 - s.tier / (TIERS * 1.6)) });
      }
      for (i = 0; i < floorSlots.length; i++) {
        s = floorSlots[i];
        // ringside floor seats are the most-wanted in the house
        order.push({ s: s, k: h01(s.x, s.z, 0x60) * 0.22, y: s.y + SEAT_CUSH, lean: 0,
                     pitch: h01(s.x, s.z, 0x64) * 0.30 - 0.04 });
      }
      order.sort(function (a, b) { return a.k - b.k || a.s.x - b.s.x || a.s.z - b.s.z; });
      if (order.length > crowdCap) order.length = crowdCap;
      for (i = 0; i < order.length; i++) {
        var o = order[i]; s = o.s;
        // a seated body: torso, head, thighs. Solved against the SAME declared
        // cushion the live rigs are posed against, so a proxy and a promoted
        // rig sit at the same height in the same chair.
        // the lean pivots about the HIPS, so the torso tips and the head
        // travels forward with it instead of the box just rotating in place.
        var pt = o.pitch || 0, sp = Math.sin(pt);
        put("body", { x: s.x + Math.sin(s.yaw) * sp * 0.30, y: o.y + 0.40 - (1 - Math.cos(pt)) * 0.24,
                      z: s.z + Math.cos(s.yaw) * sp * 0.30,
                      sx: 0.44, sy: 0.60, sz: 0.30,
                      ry: s.yaw + o.lean, rx: pt, eo: "YXZ", c: hpick(SHIRTS, s.x, s.z, 0x5d) });
        put("head", { x: s.x + Math.sin(s.yaw) * sp * 0.66, y: o.y + 0.84 - (1 - Math.cos(pt)) * 0.62,
                      z: s.z + Math.cos(s.yaw) * sp * 0.66,
                      sx: 0.22, sy: 0.25, sz: 0.22,
                      ry: s.yaw + o.lean, c: hpick(SKINS, s.x, s.z, 0x5e) });
        put("lap", { x: s.x + Math.sin(s.yaw) * 0.24, y: o.y + 0.05, z: s.z + Math.cos(s.yaw) * 0.24,
                     sx: 0.42, sy: 0.18, sz: 0.42, ry: s.yaw });
      }
      crowdTotal = order.length;
    })();

    // ------------------------------------------------------------- finalise
    flushPools();
    var pk;
    for (pk = 0; pk < 3; pk++) {
      var nm2 = ["body", "head", "lap"][pk];
      if (pools[nm2] && pools[nm2].mesh) proxies.push(pools[nm2].mesh);
    }
    if (typeof CBZ.markCollidersDirty === "function") CBZ.markCollidersDirty();
    if (typeof CBZ.losGridDirty === "function") CBZ.losGridDirty();
    V.updateMatrixWorld(true);

    // ================================================================ HANDLE
    var lightsOn = false, proxyOn = true, boardDirty = false, boardCd = 0;
    // occupancy state: `fill` is where the bowl IS, `fillWant` where it is
    // GOING. The ramp is what makes an event read as people ARRIVING rather
    // than a crowd blinking into the seats.
    var fill = 0, fillWant = 0, fillRate = 1 / 45;
    var shownCount = -1;
    function applyFill() {
      var n = Math.round(fill * crowdTotal);
      if (n === shownCount) return;
      shownCount = n;
      for (var i = 0; i < proxies.length; i++) proxies[i].count = n;
    }
    applyFill();                     // an unattended bowl starts EMPTY, not full
    var meshCount = 0;
    for (var mk in pools) if (pools[mk] && pools[mk].mesh) meshCount++;
    return {
      root: V,
      seatSlots: seatSlots,
      floorSlots: floorSlots,
      seatRecords: seatRecords,
      seatAnchor: seatAnchor,
      colliders: colliders,
      platforms: platforms,
      lights: lights,
      metrics: {
        tiers: TIERS, rowsPerTier: RPT, rows: ROWS,
        seats: seatRecords.length + floorSlots.length,
        bowlHeight: +(TOP_Y - PY).toFixed(2),
        rakeDeg: +(Math.atan(RISE / TREAD[0]) * 180 / Math.PI).toFixed(1),
        rakeTopDeg: +(Math.atan(RISE / TREAD[ROWS - 1]) * 180 / Math.PI).toFixed(1),
        // the worst sightline clearance anywhere in the bowl (metres). The
        // code floor is 0.06 and this design targets 0.12 — if it ever reads
        // below 0.06 a row has been built that cannot see the floor.
        minCValue: +MIN_C.toFixed(3), targetC: C_VALUE,
        floorX: +((A + D0) * 2).toFixed(1), floorZ: +((B + D0) * 2).toFixed(1),
        // ---- THE SITE MEASURES THE BUILDING, IT DOES NOT GUESS IT ----------
        // Where the facade actually stands (half-extents from the venue
        // centre) and how far the walkable apron reaches. arena_fights.js's
        // arrival ring is the gap between them, so re-tiering the bowl moves
        // the fence, the car park and the gate with it — nothing to re-sync.
        faceX: +(A + D_FACE).toFixed(2), faceZ: +(B + D_FACE).toFixed(2),
        coreA: A, coreB: B, faceD: +D_FACE.toFixed(2),
        // THE WALL IS NOT THE WIDEST PART OF THE BUILDING. The vertical fins
        // stand at D_OUT + 2.15 with a 0.6 depth and the outermost canopy band
        // reaches CANOPY_OUT + 0.1 — both PAST the facade plane. A site builder
        // that stands things off `faceD` alone stands them off the wrong number,
        // so the true outer envelope is published and is what clearance is
        // measured against.
        faceEnvD: +Math.max(D_FACE + 0.45, CANOPY_OUT + 0.1).toFixed(2),
        deckR: DECK_R, apron: APRON_BANDS, marqueeX: +(A + D_FACE + 9).toFixed(2),
        crowdTotal: crowdTotal, crowdCap: crowdCap,
        colliders: colliders.length, standColliders: standColliders,
        platforms: platforms.length,
        losBlockers: losMeshes.length,
        seatCushion: SEAT_CUSH,
        // every InstancedMesh + the five merged canvas batches + the three
        // per-object meshes. The crowd is 3 of these AT ANY FILL.
        drawCallEst: meshCount + 8
      },
      // ---- OCCUPANCY -------------------------------------------------------
      // `f` 0..1. `snap` skips the arrival ramp (world build / teleport in).
      crowdFill: function (f, snap) {
        fillWant = Math.max(0, Math.min(1, +f || 0));
        if (snap) { fill = fillWant; applyFill(); }
        return fillWant;
      },
      crowdState: function () {
        return { fill: fill, want: fillWant, shown: Math.max(0, shownCount), total: crowdTotal };
      },
      // the live card on the centre-hung screen
      board: function (a, b, c) {
        if (!boardTex) return;
        if (boardLines[0] === a && boardLines[1] === b && boardLines[2] === c) return;
        boardLines = [a || "", b || "", c || ""];
        boardDirty = true;
      },
      // Per-frame: switch the real light rig + crowd proxy by player distance.
      // r128's projectObject skips invisible objects entirely, so an off rig
      // costs the renderer nothing — not even a shader permutation.
      tick: function (dist, dt) {
        var wantLights = dist < 230;
        if (wantLights !== lightsOn) {
          lightsOn = wantLights;
          for (var i = 0; i < lights.length; i++) lights[i].visible = wantLights;
        }
        var wantProxy = dist < 420;
        if (wantProxy !== proxyOn) {
          proxyOn = wantProxy;
          for (var j = 0; j < proxies.length; j++) proxies[j].visible = wantProxy;
        }
        // walk the occupancy toward its target. A bowl fills/empties over ~45 s
        // of game time, so you SEE the house come in before the first bell.
        if (fill !== fillWant) {
          var step = (dt || 0.016) * fillRate;
          if (Math.abs(fillWant - fill) <= step) fill = fillWant;
          else fill += (fillWant > fill ? step : -step);
          applyFill();
        }
        if (boardDirty && boardTex && dist < 220) {
          boardCd -= (dt || 0.016);
          if (boardCd <= 0) {
            boardCd = 0.75; boardDirty = false;
            drawBoard(boardTex._ctx, boardTex._canvas.width, boardTex._canvas.height, boardLines);
            boardTex.needsUpdate = true;
          }
        }
      }
    };
  }
};
})();
