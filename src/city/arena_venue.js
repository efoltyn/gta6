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
    var A = 38, B = 52;             // rectangle core half-extents (x, z)
    var D0 = 13;                    // offset of row 0's front edge -> floor 51 x 65
    var ROWS = 16, RISE = 0.42, TREAD = 1.30;
    var FRONT_H = 3.0;              // ringside barrier: row 0's deck sits this high
    var XROW = 6, XW = 2.0;         // cross-aisle folded into row 6's tread
    var CONC = 7.0;                 // rear concourse width
    var PITCH = 1.40;               // seat pitch along a row
    var AISLE_H = 0.95;             // half-width of a radial aisle
    var DECK_R = 112;               // concrete apron disc radius (island R is 120)

    function rowD(i) { return D0 + i * TREAD + (i >= XROW ? XW : 0); }
    function deckFront(i) { return rowD(i) - (i === XROW ? XW : 0); }
    function deckDepth(i) { return TREAD + (i === XROW ? XW : 0); }
    function rowY(i) { return PY + FRONT_H + i * RISE; }

    var D_TOP = rowD(ROWS - 1) + TREAD;   // rear edge of the last row  (35.8)
    var D_BACK = D_TOP + 1.4;             // rear skirt wall            (37.2)
    var D_OUT = D_BACK + CONC;            // inner face of the facade   (44.2)
    var D_FACE = D_OUT + 2.0;             // outer face of the facade   (46.2)
    var TOP_Y = rowY(ROWS - 1);
    var CROSS_Y = rowY(XROW);
    var ROOF_Y = PY + 15.5;
    var GANTRY_Y = PY + 19.5;
    var CONC_CEIL = PY + 5.2;
    var CANOPY_IN = D0 - 4, CANOPY_OUT = D_FACE + 0.4;

    // radial aisle anchors: coordinate along each straight, mid-angle on corners
    var AIS_X = [-39, -13, 13, 39];       // z offsets, used by the ±x stands
    var AIS_Z = [-19, 19];                // x offsets, used by the ±z stands
    // Vomitories (ramped tunnels under the stand) — every one aligned with an
    // aisle so the walk-up continues straight into the rows.
    var VOMS = [
      { side: "xp", k: -13 }, { side: "xp", k: 13 },
      { side: "xn", k: -39 }, { side: "xn", k: 39 },
      { side: "zp", k: -19 }, { side: "zp", k: 19 },
      { side: "zn", k: -19 }, { side: "zn", k: 19 }
    ];
    var VOM_HW = 2.2;                      // vomitory half-width
    var GATE_HW = 5.0;                     // west entrance tunnel half-width
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
          e.set(it.rx || 0, it.ry || 0, it.rz || 0); q.setFromEuler(e);
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
    (function () {
      var bands = [[30, 107], [60, 94], [82, 75], [98, 53], [107, 30]];
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
    var seatRecords = [];       // {x,y,z,yaw,row}
    var SEAT_W = 0.98, SEAT_D = 0.86, SEAT_H = 0.74;
    // Seat-colour banding: lower tier ember/gold, upper tier deep maroon, two
    // contrast rows reading as a painted stripe all the way round the bowl.
    var LOWER = [0xc8912a, 0xb9821f, 0xd39b33];
    var UPPER = [0x8c1f2c, 0x7a1a26, 0x9a2634];
    var STRIPE = [0x1d3f6e, 0x24508a];
    function seatColour(row, x, z) {
      if (row === 9 || row === 10) return hpick(STRIPE, x, z, 0x51);
      return hpick(row < XROW ? LOWER : UPPER, x, z, 0x52);
    }
    function notchRow(r) { return r >= NOTCH_LO && r <= NOTCH_HI; }

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

    for (var r = 0; r < ROWS; r++) {
      (function (r) {
        var df = deckFront(r), dd = deckDepth(r), dy = rowY(r), cut = notchRow(r);
        var vp = cut ? 1.8 : 7.0;      // fine sampling only where we must cut

        // --- deck slab (visual)
        walkRing(df + dd / 2, vp, function (s) {
          if (cut && isStraight(s.side) && vomGap(s)) return;
          put("deck", { x: s.x, y: dy - 0.09, z: s.z, sx: s.len + 0.06, sy: 0.18, sz: dd, ry: s.yaw });
        });
        // --- deck platforms: straights exact, corners as 6 wedge AABBs each
        var i;
        rowStraightPlats("xp", df, df + dd, dy, cut);
        rowStraightPlats("xn", df, df + dd, dy, cut);
        rowStraightPlats("zp", df, df + dd, dy, cut);
        rowStraightPlats("zn", df, df + dd, dy, cut);
        for (var ci = 0; ci < 4; ci++) {
          var ox = (ci === 0 || ci === 3) ? CX + A : CX - A;
          var oz = (ci === 0 || ci === 1) ? CZ + B : CZ - B;
          var a0 = ci * Math.PI / 2, W = 6, st = (Math.PI / 2) / W;
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
        // --- riser face (row 0's riser IS the bowl-front wall, built above)
        if (r > 0) {
          walkRing(df + 0.07, cut ? 1.8 : 6.0, function (s) {
            if (cut && isStraight(s.side) && vomGap(s)) return;
            put("riser", { x: s.x, y: dy - RISE / 2, z: s.z, sx: s.len + 0.05, sy: RISE, sz: 0.14, ry: s.yaw });
          });
        }
        // --- seats
        var ds = df + dd - SEAT_D / 2 - 0.12;
        walkRing(ds, PITCH, function (s) {
          if (aisleGap(s)) return;
          if (cut && isStraight(s.side) && vomGap(s, VOM_HW + 0.4)) return;
          put("seat", {
            x: s.x, y: dy + SEAT_H / 2, z: s.z,
            sx: SEAT_W, sy: SEAT_H, sz: SEAT_D, ry: s.yaw,
            c: seatColour(r, s.x, s.z)
          });
          seatRecords.push({ x: s.x, y: dy, z: s.z, yaw: s.yaw + Math.PI, row: r });
        });
        void i;
      })(r);
    }

    // ---------------- handrails: cross-aisle front edge + back of the bowl ---
    (function () {
      walkRing(deckFront(XROW) - 0.12, 2.6, function (s) {
        if (aisleGap(s)) return;
        if (isStraight(s.side) && vomGap(s, VOM_HW + 0.4)) return;
        put("rail", { x: s.x, y: CROSS_Y + 0.58, z: s.z, sx: s.len + 0.05, sy: 0.09, sz: 0.09, ry: s.yaw });
        put("steel", { x: s.x, y: CROSS_Y + 0.29, z: s.z, sx: 0.08, sy: 0.58, sz: 0.08, ry: s.yaw });
      });
      walkRing(D_TOP + 0.25, 2.6, function (s) {
        put("rail", { x: s.x, y: TOP_Y + 1.02, z: s.z, sx: s.len + 0.05, sy: 0.09, sz: 0.09, ry: s.yaw });
        put("steel", { x: s.x, y: TOP_Y + 0.52, z: s.z, sx: 0.08, sy: 1.04, sz: 0.08, ry: s.yaw });
      });
      // solid back wall behind the top row — you cannot step off the bowl
      ringSolid(D_TOP + 0.62, 0.6, TOP_Y, TOP_Y + 1.2, { pitch: 5.0, mesh: false });
    })();

    // ---------------- aisle step treads (two half-risers per row) ------------
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
          var df = deckFront(r2), yb = rowY(r2), mid = df - TREAD / 2;
          for (var h = 0; h < 2; h++) {
            var dstep = mid + (h ? TREAD * 0.25 : -TREAD * 0.25);
            var yy = yb - RISE + RISE * (h ? 0.75 : 0.25);
            var p = straightPoint(side, dstep, key);
            put("concrete", {
              x: p.x, y: yy - 0.1, z: p.z, sx: AISLE_H * 2 - 0.1, sy: 0.2,
              sz: TREAD * 0.5, ry: yawOf(p.nx, p.nz)
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
    // LOS proxies — four facade slabs, four corner blocks, four seating masses.
    // Twelve invisible boxes is enough to make the venue opaque to AI vision
    // without feeding 300 meshes into the losgrid.
    (function () {
      var df2 = D_OUT + 1;
      losBox(CX + A + df2, PY + 8, CZ, 2.4, 16, 2 * B);
      losBox(CX - A - df2, PY + 8, CZ, 2.4, 16, 2 * B);
      losBox(CX, PY + 8, CZ + B + df2, 2 * A, 16, 2.4);
      losBox(CX, PY + 8, CZ - B - df2, 2 * A, 16, 2.4);
      var q = df2 * 0.7071;
      losBox(CX + A + q, PY + 8, CZ + B + q, 11, 16, 11);
      losBox(CX - A - q, PY + 8, CZ + B + q, 11, 16, 11);
      losBox(CX + A + q, PY + 8, CZ - B - q, 11, 16, 11);
      losBox(CX - A - q, PY + 8, CZ - B - q, 11, 16, 11);
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
      for (var qi = 0; qi < 8; qi++) {
        var qx = mx + 3.0 + qi * 1.6;
        put("steel", { x: qx, y: PY + 0.55, z: CZ - 6.2, sx: 0.1, sy: 1.1, sz: 0.1 });
        put("steel", { x: qx, y: PY + 0.55, z: CZ + 6.2, sx: 0.1, sy: 1.1, sz: 0.1 });
        put("rail", { x: qx + 0.8, y: PY + 1.0, z: CZ - 6.2, sx: 1.6, sy: 0.07, sz: 0.07 });
        put("rail", { x: qx + 0.8, y: PY + 1.0, z: CZ + 6.2, sx: 1.6, sy: 0.07, sz: 0.07 });
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
            put("chair", { x: px, y: PY + 0.42, z: pz, sx: 0.6, sy: 0.84, sz: 0.6, ry: yaw });
            floorSlots.push({ x: px, y: PY, z: pz, yaw: yaw, row: -1 });
          }
        }
      }
    })();

    // ============================================================ SPECTATORS
    // Live NPCs get the best seats (closest to the fight surfaces). Every other
    // seat is a candidate for the instanced proxy crowd — one static seated
    // body, three instanced draws total, deterministic colour and occupancy.
    var seatSlots = [];
    (function () {
      if (!seatRecords.length) return;
      var want = Math.min(spec.liveSeats == null ? 42 : spec.liveSeats, seatRecords.length);
      var cand = [], i;
      for (i = 0; i < seatRecords.length; i++) if (seatRecords[i].row <= 3) cand.push(seatRecords[i]);
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
        // npclife's attach() writes the anchor straight onto the rig's group
        // position, and the old grandstand anchored fans at the SEAT CUSHION
        // TOP — keep that convention so the seated pose reads identically.
        seatSlots.push({ x: cand[j].x, y: cand[j].y + SEAT_H, z: cand[j].z, yaw: cand[j].yaw });
      }
    })();

    (function () {
      if (!CFG.ARENA_CROWD_PROXY) return;
      var q = (CBZ.qualityLevel == null ? 3 : CBZ.qualityLevel);
      var base = [0.0, 0.30, 0.46, 0.58, 0.66][Math.max(0, Math.min(4, q))];
      if (base <= 0) return;
      var SHIRTS = [0xb23a3a, 0x2f4f8a, 0x2f7a4f, 0xc9a227, 0x8a4fa0, 0xd8d3c8, 0x333a45, 0xa5562a];
      var SKINS = [0xe8c39a, 0xd9a97c, 0xb5794c, 0x8a5a34, 0x5f3a20, 0xf0d4b4];
      var i, s;
      for (i = 0; i < seatRecords.length; i++) {
        s = seatRecords[i];
        if (s._live) continue;
        var rowFactor = 1.18 - s.row * 0.028;      // a fight crowd packs the floor end
        if (h01(s.x, s.z, 0x5c) > base * rowFactor) continue;
        var lean = (h01(s.x, s.z, 0x5f) - 0.5) * 0.25;
        put("body", { x: s.x, y: s.y + 0.98, z: s.z, sx: 0.52, sy: 0.66, sz: 0.34,
                      ry: s.yaw + lean, c: hpick(SHIRTS, s.x, s.z, 0x5d) });
        put("head", { x: s.x, y: s.y + 1.45, z: s.z, sx: 0.25, sy: 0.28, sz: 0.25,
                      ry: s.yaw + lean, c: hpick(SKINS, s.x, s.z, 0x5e) });
        put("lap", { x: s.x + Math.sin(s.yaw) * 0.34, y: s.y + 0.62, z: s.z + Math.cos(s.yaw) * 0.34,
                     sx: 0.5, sy: 0.22, sz: 0.5, ry: s.yaw });
      }
      for (i = 0; i < floorSlots.length; i++) {
        s = floorSlots[i];
        if (h01(s.x, s.z, 0x60) > base * 0.9) continue;
        put("body", { x: s.x, y: s.y + 1.04, z: s.z, sx: 0.52, sy: 0.66, sz: 0.34,
                      ry: s.yaw, c: hpick(SHIRTS, s.x, s.z, 0x61) });
        put("head", { x: s.x, y: s.y + 1.51, z: s.z, sx: 0.25, sy: 0.28, sz: 0.25,
                      ry: s.yaw, c: hpick(SKINS, s.x, s.z, 0x62) });
        put("lap", { x: s.x + Math.sin(s.yaw) * 0.34, y: s.y + 0.68, z: s.z + Math.cos(s.yaw) * 0.34,
                     sx: 0.5, sy: 0.22, sz: 0.5, ry: s.yaw });
      }
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
    return {
      root: V,
      seatSlots: seatSlots,
      floorSlots: floorSlots,
      colliders: colliders,
      platforms: platforms,
      lights: lights,
      metrics: {
        seats: seatRecords.length, colliders: colliders.length,
        platforms: platforms.length, losBlockers: losMeshes.length
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
        var wantProxy = dist < 340;
        if (wantProxy !== proxyOn) {
          proxyOn = wantProxy;
          for (var j = 0; j < proxies.length; j++) proxies[j].visible = wantProxy;
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
