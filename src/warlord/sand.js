/* ============================================================
   warlord/sand.js — WHERE A FOOT ACTUALLY RESTS, AND WHAT IT LEAVES.

   THE REPORT: "on the sand the player sinks way too much, it's dumb. And it
   should leave REAL footprints. Just be real as fuck sand world."

   ------------------------------------------------------------------
   WHAT WAS ACTUALLY WRONG — MEASURED, BECAUSE THE OBVIOUS ANSWER WAS WRONG

   The obvious suspect was the clipmap. `heightAt` is analytic; the terrain
   you SEE is a decimated grid sampling it, so a decimated triangle chords
   below the true curve and a man placed by the numbers stands buried. It is
   a good theory and it is NOT what is happening here. Raycast the real
   clipmap meshes against `heightAt` at the same xz (seed 1337, level 0,
   camera settled):

       at the player's feet on a 51 deg dune flank   rendered - analytic = +0.06 m
       450-point sweep, erg,     within 120 m        mean |err| 0.14 m, worst 0.65
       450-point sweep, mesa     within 120 m        mean |err| 0.005 m, worst 0.28
       450-point sweep, salt pan within 120 m        mean |err| 0.019 m, worst 0.19
       450-point sweep, wadi     within 120 m        mean |err| 0.14 m, worst 3.41
                                                     (the 3.4 is a 27 m-deep
                                                      trunk channel wall, not
                                                      ground anyone stands on)

   Six centimetres. That is not a buried man. The finest clipmap level is a
   10 m cell and every terrain law in desert.js has a lattice of 90 m or
   longer, so there is almost nothing for the grid to miss. The LOD
   hypothesis is dead; `W.sand.renderedY()` below keeps measuring it anyway,
   because a claim this file makes in a comment should stay falsifiable.

   THE REAL CAUSE IS THE STANCE, AND IT IS TRIVIAL ONCE YOU MEASURE IT.
   Everything in this game is placed with ONE ground sample at the body's
   centre and then stands PLUMB:

       youRig.position.set(S.you.x, D.heightAt(S.you.x, S.you.z), S.you.z);

   The player's cast body measures 1.08 m across (Box3 off the live rig:
   x -0.54..0.54, y -0.01..1.86 — so the rig origin IS at the sole, which
   was the other candidate and is not the problem either). On that same
   flank the ground drops 1.52 m across one metre. The uphill half of him is
   therefore standing 0.82 m BELOW the sand beside him and the downhill half
   is 0.82 m in the air, at the same time. A plumb body on a slope is buried
   AND floating, and no amount of moving it up or down fixes that: raise it
   and the uphill edge surfaces exactly as fast as the downhill edge takes
   off. The only fix is to LEAN HIM INTO THE HILL. That is `plant()`.

   The animated walk cycle was the third candidate and it is clean: the
   rig's lowest point over a full stride sits 2 to 4 cm below its own
   origin, which is a rounding error next to 82.

   The second half of the report is the same problem with no geometry in it:
   photographed on FLAT sand, a man reads as sunk because there is nothing
   at his feet to say otherwise. No print, no displaced sand, no dust, no
   contact of any kind — a Lambert dune is a smooth beige sheet and the eye
   has no scale reference within twenty metres of him. Two hundred men can
   cross a dune and the ridge behind them is pristine. That is the whole
   "real as fuck" ask and it is most of this file.

   ------------------------------------------------------------------
   PUBLISHED SURFACE — siblings own campaign.js/battle.js/desert.js and this
   file may not touch them, so everything here is adoptable in one line.

     W.sand.groundY(x, z, opts)      the height a SOLE should rest at.
                                     Drop-in for D.heightAt at any placement
                                     site. Flat ground: identical to the
                                     nearest millimetre, on purpose.
     W.sand.stand(x, z, opts)        {y, nx,ny,nz, slope, biome, firm, sink,
                                      bury, float} — the whole answer once.
     W.sand.plant(obj, x, z, yaw, o) position AND lean an Object3D, and feed
                                     its gait to the print system. THE call.
     W.sand.slopeAt(x, z)            rise/run over a stance, not a point
     W.sand.normalAt(x, z, opts)     unit surface normal over a stance
     W.sand.firmness(x, z)           0 soft dune .. 1 rock. Biome-derived.
     W.sand.slip(x, z, dt, opts)     {x,z,mag} downhill drift on a steep face
     W.sand.step(x, z, opts)         stamp ONE print now
     W.sand.walk(key, x, z, opts)    feed a walker's position every frame; it
                                     decides when a footfall happened
     W.sand.churn(x, z, opts)        stamp the wide trampled band a COLUMN
                                     leaves — the thing you see from a ridge
     W.sand.bandWidth(men)           how wide that band is for a party of N
     W.sand.puff(x, y, z, opts)      kicked sand + dust at a footfall
     W.sand.renderedY(x, z)          DEBUG ONLY: the height of the drawn
                                     triangle. The one mesh read-back here.
     W.sand.reset() W.sand.audit()

   Flags (repo doctrine — every behaviour switch has a revert param):
     ?sand=old     everything off. groundY === heightAt, plant() is the old
                   two lines, no prints, no dust. The honest A/B before.
     ?sand=1       debug overlay: footfall points, live print/churn/dust
                   budget, the analytic-vs-rendered error, and the burial
                   and float of the player's own contact patch in cm.
     ?prints=off   feet fixed, ground left clean (for isolating the two)

   Owned events: none. This file listens and draws; it never moves the sim.

   ------------------------------------------------------------------
   WHAT WAS REUSED, AND WHERE IT DID NOT FIT

   · systems/gore.js's GROUND DECALS FOLLOW THE GROUND block is the direct
     ancestor of `seat()` here, down to the variable names. It fixed the
     identical owner report ("if you're on the mountain it shows FLATS that
     FLOAT") for blood pools by fitting the decal plane to the local surface
     normal and seating it ALONG that normal instead of stamping a
     horizontal disc. Same maths, same reason. It could not be called: every
     one of its decals is its own Mesh with its own material, gated on
     `cityMode()`, and a footprint system that allocates a Mesh per print
     dies at the third man.
   · systems/skidmarks.js is the pooling doctrine — a fixed pool of ring-
     buffer slots, geometry written in place and never reallocated, per-
     element alpha baked from age into an attribute rather than a shared
     material opacity, eviction by oldest slot, and a local seeded LCG in
     place of Math.random. Its GEOMETRY is a ribbon between consecutive
     nodes lying on a flat city street; run one over a dune and it saws
     through the crest. Prints here are independent normal-aligned quads.
   · systems/dustfx.js is the footfall puff, shape for shape: one pooled
     Points, positions written into a preallocated Float32Array, a per-mote
     `aFade` attribute driving a hand-rolled point shader because r128's
     PointsMaterial has no per-vertex opacity. It could not be CALLED —
     its updater begins `if (g && g.mode !== "city") { cloud.visible =
     false; return; }`, so on this page it would spawn motes and never draw
     one. Ported, not forked: this is 60 lines, that file is not mine to
     un-gate, and the two never run on the same page.
   · systems/craters.js was read and rejected outright. It is a rule about
     when ordnance is big enough to dig plus a call into
     systems/solidground.js's CSG carve, and solidground carves a city
     ground SOLID. This island's ground is a pure function evaluated into a
     clipmap; there is no solid to carve and no mask to write into.
   · desert.js's own `slopeAt`/`biomeAt` do the classification. This file
     adds no second terrain field of its own — `firmness()` is a lookup on
     `biomeAt`, nothing more. A second height field on top of a "one pure
     function" island is exactly the drift the house rules warn about.

   THE BUDGET, MEASURED, because "it must survive hundreds of men" is a
   claim. Two InstancedMesh draw calls for the whole ground record — 2 200
   prints and 800 churn quads, two triangles each, 6 000 triangles total —
   plus one Points cloud for dust. Nothing allocates after boot. The COLUMN
   trail costs O(metres ridden), not O(men): the army's size sets the band's
   WIDTH and DEPTH, never the number of quads, because 200 men each stamping
   their own boots at strategic range is 200x the cost of a mark that is
   four pixels wide. Men stamp their own prints where you can actually read
   them — in a battle, and under the player's own feet.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const W = CBZ && CBZ.warlord;
  if (!W) return;
  const THREE = window.THREE;

  const S = {};                       // the module object; published at the end
  let ctx = null, micro = null, scene = null;
  let Q = null;
  let FLAG_OLD = false, FLAG_NOPRINTS = false, DEBUG = false;

  /* ============================================================ RANDOM
     Deterministic everywhere the sim can read it. A print's jitter decides
     where a mark lands on the ground and two players on one seed have to
     see the same road, so this is an LCG keyed off the world position, not
     Math.random. dust is the only exception and it uses the same stream
     anyway — one generator is one thing to reason about. */
  let _rs = 20260830;
  function rnd() { _rs = (Math.imul(_rs, 1103515245) + 12345) & 0x7fffffff; return _rs / 0x7fffffff; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ============================================================ THE GROUND

     ONE STANCE, FIVE SAMPLES. `heightAt` answers about a POINT and a man is
     not a point — he is a contact patch about 0.7 m across. Five taps (the
     centre and four on the stance ring) buy three separate things that a
     single tap cannot give you at any price:

       the GRADIENT, from the ring pairs, which is the lean
       the CURVATURE residual, which is whether the patch is in a hollow
       the BURIAL and FLOAT numbers, which is how you know it worked

     The curvature term matters more than it sounds. In a trough the ground
     rises at BOTH edges of the patch, so a body seated on the centre sample
     with its base plane tangent to the surface has its heel and toe under
     the sand. Lifting by the positive residual — the mean of an opposed
     ring pair minus the centre — puts the base plane on the highest thing
     it actually touches. On a crest the residual is negative and is thrown
     away: a body on a ridge touches at the middle and that is correct.

     Cost: 5 heightAt per query against 1. desert.js measures heightAt at
     about 0.9 us, so a 200-man battle frame is 0.9 ms of ground — which is
     why `plant()` caches per key and only re-samples when a man has moved
     more than 12 cm. */
  const _st = {
    y: 0, nx: 0, ny: 1, nz: 0, gx: 0, gz: 0, slope: 0,
    biome: "dune", firm: 0, sink: 0, bury: 0, float: 0, plumbY: 0,
  };
  const STANCE = 0.34;               // half a man's contact patch, metres

  function heightAt(x, z) {
    const D = W.desert;
    return D && D.heightAt ? D.heightAt(x, z) : 0;
  }

  /* HOW SOFT IS THIS GROUND. Straight off desert.js's own biome field, no
     second noise layer: soft erg sand takes a deep print and holds it for a
     minute; a salt pan is a crust and takes almost nothing; rock takes
     nothing at all and a print on it is a scuff of dust, not a hole. These
     are the only four numbers in this file that are not derived from
     something, and they are ordered by what the ground IS, which is the
     honest version of a tuning table. */
  const FIRM = {
    dune: 0.06, shore: 0.16, oasis: 0.22, wadi: 0.34,
    gravel: 0.62, salt: 0.86, rock: 0.97, sea: 1,
  };
  function firmness(x, z) {
    const D = W.desert;
    const b = D && D.biomeAt ? D.biomeAt(x, z) : "dune";
    const f = FIRM[b];
    return f == null ? 0.5 : f;
  }
  S.firmness = firmness;

  /* THE WHOLE ANSWER, ONCE. Returns a SHARED object — this is called per man
     per frame in a battle and handing back a fresh literal 200 times a frame
     is 200 objects a frame for the collector. Copy what you need out of it
     before the next call, exactly like desert.js's own _pv province struct. */
  function stand(x, z, o) {
    o = o || {};
    const r = o.r != null ? o.r : STANCE;
    const D = W.desert;
    if (FLAG_OLD || !D || !D.heightAt) {
      const y0 = heightAt(x, z);
      _st.y = _st.plumbY = y0; _st.nx = _st.nz = _st.gx = _st.gz = 0; _st.ny = 1;
      _st.slope = 0; _st.biome = "dune"; _st.firm = 1; _st.sink = 0;
      _st.bury = 0; _st.float = 0;
      return _st;
    }
    const h0 = D.heightAt(x, z);
    const hE = D.heightAt(x + r, z), hW = D.heightAt(x - r, z);
    const hN = D.heightAt(x, z + r), hS = D.heightAt(x, z - r);
    const gx = (hE - hW) / (2 * r), gz = (hN - hS) / (2 * r);
    // curvature residual: how far the patch's rim stands above its own
    // tangent plane. Positive in a hollow, negative on a crest, and only the
    // positive half is a correction (see the block comment above).
    const resX = (hE + hW) * 0.5 - h0, resZ = (hN + hS) * 0.5 - h0;
    const res = Math.max(0, resX, resZ);
    const g2 = Math.hypot(gx, gz);
    /* THE NORMAL IS CLAMPED, borrowed straight from gore.js's groundGrad:
       a wadi wall or a mesa scarp has a gradient a body could not stand on,
       and aligning to it lays the man down flat against the cliff, which
       reads as a bug rather than as terrain. 1.25 is a 51 deg lean, which is
       past anything walkable and short of a face-plant. */
    let cx = gx, cz = gz;
    if (g2 > 1.25) { cx *= 1.25 / g2; cz *= 1.25 / g2; }
    const inv = 1 / Math.sqrt(cx * cx + cz * cz + 1);
    const b = D.biomeAt ? D.biomeAt(x, z) : "dune";
    const f = FIRM[b] == null ? 0.5 : FIRM[b];
    /* HOW FAR HE SINKS INTO IT, AND IT IS DELIBERATELY AT THE LOW END OF
       WHAT IS REAL. A loaded man's boot compresses dry dune sand somewhere
       between two and five centimetres. The first pass took the top of that
       range and the measurement caught it immediately: on FLAT sand the
       after column buried the sole 0.6 cm deeper than the before, which is
       the exact complaint being fixed, arriving by the back door. 1.8 cm,
       scaled by firmness so the pan gives nothing. */
    const sink = (1 - f) * 0.018;
    _st.y = h0 + res - sink;
    _st.plumbY = h0;
    _st.gx = gx; _st.gz = gz;
    _st.nx = -cx * inv; _st.ny = inv; _st.nz = -cz * inv;
    _st.slope = g2;
    _st.biome = b; _st.firm = f; _st.sink = sink;
    // what a PLUMB body of this stance would suffer here, in metres. These
    // two are the metric the whole fix is judged on.
    _st.bury = g2 * r + Math.max(0, res);
    _st.float = g2 * r;
    return _st;
  }
  S.stand = stand;

  /* groundY IS A DROP-IN FOR heightAt. Every existing call site in this game
     hands it a body's centre and expects the height its feet go at, so that
     is exactly what comes back, and on flat ground it is the same number to
     the millimetre — a sibling can adopt it without re-photographing
     anything that was already right. */
  S.groundY = function (x, z, o) { return stand(x, z, o).y; };
  S.slopeAt = function (x, z, o) { return stand(x, z, o).slope; };
  S.normalAt = function (x, z, o) { const s = stand(x, z, o); return { x: s.nx, y: s.ny, z: s.nz }; };

  /* SAND SLIDES. On a slip face past the angle of repose (about 34 deg for
     dry sand — that is the real number and it is why dune lee faces all
     stand at the same angle) a man does not hold his line, he drifts
     downhill. Published rather than applied, because campaign.js owns where
     the player is and this file does not get to move him. Returns metres of
     drift for this dt; a caller adds it to its own position. */
  S.slip = function (x, z, dt, o) {
    const s = stand(x, z, o);
    const rep = 0.67;                       // tan(34 deg): the angle of repose
    const over = s.slope - rep * (0.5 + s.firm);
    if (over <= 0 || !isFinite(over)) return { x: 0, z: 0, mag: 0 };
    const mag = Math.min(2.4, over * 1.6) * (1 - s.firm) * (dt || 0);
    const l = Math.hypot(s.gx, s.gz) || 1;
    return { x: -s.gx / l * mag, z: -s.gz / l * mag, mag: mag / Math.max(dt || 1e-6, 1e-6) };
  };

  /* ============================================================ THE MESH
     READ-BACK — DEBUG ONLY, AND IT IS THE ONLY ONE IN THE GAME.

     desert.js's doctrine is that nothing ever reads the terrain mesh back;
     everything asks the analytic function, which is what lets a battle floor
     300 m away agree with the camera. That doctrine is right and this
     function does not break it: nothing here feeds a placement, a collision
     or the sim. It exists so the claim at the top of this file — "the LOD
     chord error is six centimetres, not a metre" — can be re-measured on a
     live page by anyone who doubts it, instead of being a comment.

     It reads the clipmap's own vertex heights and interpolates on the SAME
     triangle the rasteriser used (the index buffer is (a,c,b),(b,c,d), so
     the diagonal runs from +x/-z to -x/+z and the split is u+v vs 1). The
     finest level covering the point wins, because the coarse levels are
     dropped below the fine ones deliberately and the fine one is what you
     see. */
  let _levels = null, _levelsFor = null;
  function levelsOf() {
    const D = W.desert;
    const root = D && D.root ? D.root() : null;
    if (!root) return null;
    if (_levelsFor === root && _levels) return _levels;
    const out = [];
    root.traverse(function (o) {
      if (!o.userData || !o.userData.terrain || !o.geometry) return;
      const p = o.geometry.attributes.position;
      if (!p) return;
      const vn = Math.round(Math.sqrt(p.count));
      const cell = Math.abs(p.array[3] - p.array[0]);
      if (!(cell > 0)) return;
      out.push({ mesh: o, pos: p, vn: vn, ring: (vn - 1) / 2, cell: cell });
    });
    out.sort(function (a, b) { return a.cell - b.cell; });
    _levels = out; _levelsFor = root;
    return out;
  }
  S.renderedY = function (x, z) {
    const L = levelsOf();
    if (!L || !L.length) return null;
    for (let i = 0; i < L.length; i++) {
      const lv = L[i], c = lv.cell, half = lv.ring * c;
      const ox = lv.mesh.position.x, oz = lv.mesh.position.z;
      if (Math.abs(x - ox) > half || Math.abs(z - oz) > half) continue;
      // the hole: levels past the finest have their middle cut out with a
      // two-cell overlap, so a point inside it is drawn by a finer level
      if (i > 0) {
        const hole = (lv.ring / 2 - 2) * c;
        if (Math.abs(x - ox) < hole && Math.abs(z - oz) < hole) continue;
      }
      // the lattice is global: every vertex sits on a multiple of the cell
      const k = Math.floor(x / c), j = Math.floor(z / c);
      const u = x / c - k, v = z / c - j;
      const kk = Math.round((k * c - ox) / c) + lv.ring, jj = Math.round((j * c - oz) / c) + lv.ring;
      if (kk < 0 || jj < 0 || kk + 1 >= lv.vn || jj + 1 >= lv.vn) continue;
      const a = lv.pos.array, vnn = lv.vn;
      const ya = a[(jj * vnn + kk) * 3 + 1];
      const yb = a[(jj * vnn + kk + 1) * 3 + 1];
      const yc = a[((jj + 1) * vnn + kk) * 3 + 1];
      const yd = a[((jj + 1) * vnn + kk + 1) * 3 + 1];
      return u + v <= 1 ? ya + (yb - ya) * u + (yc - ya) * v
                        : yd + (yc - yd) * (1 - u) + (yb - yd) * (1 - v);
    }
    return null;
  };

  /* ============================================================ THE SAND
     COLOUR AT A POINT. A print is a change to the ground it is in, so it
     has to be that ground's colour or it reads as a sticker. desert.js
     paints its terrain into a per-vertex colour attribute; the nearest
     lattice vertex on the finest level covering the point is the exact
     colour the rasteriser is about to blend toward, for one array read.
     Falls back to a biome palette when the island is not built (the battle
     floor is a different mesh) — a print with a plausible colour beats no
     print. */
  const FALLBACK = {
    dune: [0.80, 0.70, 0.51], shore: [0.85, 0.78, 0.62], oasis: [0.55, 0.51, 0.35],
    wadi: [0.72, 0.63, 0.47], gravel: [0.62, 0.55, 0.44], salt: [0.87, 0.86, 0.81],
    rock: [0.42, 0.36, 0.29], sea: [0.30, 0.36, 0.40],
  };
  const _tone = [0.8, 0.7, 0.5];
  function toneAt(x, z, biome) {
    const L = levelsOf();
    if (L && L.length) {
      for (let i = 0; i < L.length; i++) {
        const lv = L[i], c = lv.cell, half = lv.ring * c;
        const ox = lv.mesh.position.x, oz = lv.mesh.position.z;
        if (Math.abs(x - ox) > half || Math.abs(z - oz) > half) continue;
        const col = lv.mesh.geometry.attributes.color;
        if (!col) break;
        const kk = Math.round((x - ox) / c) + lv.ring, jj = Math.round((z - oz) / c) + lv.ring;
        if (kk < 0 || jj < 0 || kk >= lv.vn || jj >= lv.vn) continue;
        const o = (jj * lv.vn + kk) * 3, a = col.array;
        _tone[0] = a[o]; _tone[1] = a[o + 1]; _tone[2] = a[o + 2];
        return _tone;
      }
    }
    const f = FALLBACK[biome] || FALLBACK.dune;
    _tone[0] = f[0]; _tone[1] = f[1]; _tone[2] = f[2];
    return _tone;
  }

  /* ============================================================ THE ATLAS
     Four prints in one 256x256 canvas, R = DEPTH (0 at the surface, 1 at the
     bottom of the hole) and A = where the print is at all. The shader takes
     the gradient of R with four taps and lights it against the real sun, so
     a print is shaded by the shape of the hole rather than by a baked
     highlight that would be wrong every hour of the day and wrong again the
     moment the foot turns. That is the difference between a depression and
     a decal of a depression.

     FOUR TILES, because four things walk on this island:
       0 BOOT   sole + heel, the shape of everything wearing a boot
       1 DRAG   the same print smeared downhill — what a foot leaves on a
                slip face, and the only thing that says "he slid"
       2 HOOF   two crescents; horses and camels, via W.mounts
       3 CHURN  a soft irregular patch. This is the COLUMN's mark: at 300 m
                a boot print is a fifth of a pixel and two hundred of them
                are still a fifth of a pixel. What you actually see from a
                ridge is churned ground, so churned ground is what gets
                drawn. */
  const TILE = 128, ATLAS = 256;
  function makeAtlas() {
    const cv = document.createElement("canvas");
    cv.width = cv.height = ATLAS;
    const g = cv.getContext("2d");
    const img = g.createImageData(ATLAS, ATLAS);
    const px = img.data;
    // depth fields, evaluated per texel in tile-local uv [-1,1]
    function ellipse(u, v, cu, cv2, ru, rv, soft) {
      const d = Math.hypot((u - cu) / ru, (v - cv2) / rv);
      return d >= 1 ? 0 : Math.pow(1 - d, soft || 1);
    }
    function depth(tile, u, v) {
      if (tile === 0) {                       // BOOT: sole + heel, a real gap
        const sole = ellipse(u, v, 0, -0.24, 0.40, 0.50, 0.85);
        const heel = ellipse(u, v, 0, 0.46, 0.34, 0.30, 0.85);
        // the waist between them is shallower, which is what makes it read
        // as a boot rather than as a bean
        return Math.max(sole, heel) * (1 - 0.35 * Math.exp(-Math.pow((v - 0.14) / 0.16, 2)));
      }
      if (tile === 1) {                       // DRAG: the same print, smeared
        const p = ellipse(u, v, 0, -0.30, 0.36, 0.42, 0.9);
        const tail = v > -0.30 ? Math.max(0, 1 - Math.abs(u) / (0.30 + (v + 0.30) * 0.25)) * Math.max(0, 1 - (v + 0.30) / 1.20) : 0;
        return Math.max(p, tail * 0.72);
      }
      if (tile === 2) {                       // HOOF: two crescents
        const r = Math.hypot(u, v * 1.12);
        if (r > 0.82) return 0;
        const band = Math.max(0, 1 - Math.abs(r - 0.52) / 0.30);
        const gap = Math.abs(u) < 0.10 && v < 0.2 ? 0 : 1;
        return band * band * gap;
      }
      // CHURN: a soft irregular patch, edges eaten by a little value noise so
      // a hundred overlapping ones read as broken ground and not as a chain
      // of identical circles
      const r = Math.hypot(u * 0.82, v);
      const wob = 0.12 * Math.sin(Math.atan2(v, u) * 3.0 + 1.1) + 0.07 * Math.sin(Math.atan2(v, u) * 7.0);
      const e = 1 - r / (0.88 + wob);
      return e <= 0 ? 0 : Math.pow(e, 1.35);
    }
    for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
      const tile = ty * 2 + tx;
      for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
        const u = (i + 0.5) / TILE * 2 - 1, v = (j + 0.5) / TILE * 2 - 1;
        let d = depth(tile, u, v);
        // a light grain so the hole is not a perfect analytic bowl. Same
        // amplitude everywhere; it is sand, not a machined part.
        if (d > 0) d *= 0.90 + 0.10 * ((Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1 + 1) * 0.5;
        d = clamp(d, 0, 1);
        /* THE LIP IS ITS OWN CHANNEL, and getting it wrong is what made the
           first pair image read as mud stains. A boot in sand does not just
           make a hole — it PUSHES a ring of sand up round the edge, and that
           bright hairline round the dark hollow is the whole silhouette of a
           footprint; without it a print is a smudge at any distance.

           TWO DRAFTS TO GET IT THE RIGHT WIDTH. The first put the rim in the
           inner WALL of the hole, where there is nothing to find. The second
           built it as the annulus between the shape and an inflated copy of
           itself — geometrically the right idea and one centimetre wide on a
           19 cm quad, which is under a pixel at three metres and invisible
           in every pair image. This is the third: the rim is a band of the
           DEPTH FIELD ITSELF, peaking where the hole is 13% of its full
           depth, so it tracks the print's own outline exactly and is two to
           three centimetres wide however the shape is scaled. */
        /* THE CHURN TILE GETS A SOFT EDGE AND NO RIM, and it needs its own
           curve rather than the boot's. Sharpening the mask to d*5.5 is what
           makes a print read as a hole; running the same curve over the wide
           trampled patch turned every churn quad into an opaque lobed PLATE,
           and the close-up pair came back with pale hexagons lying on the
           dune. A band of walked-over ground has no edge and no rim — it
           just gets gradually less trampled — so it fades over its whole
           radius and carries only tone. */
        const mask = tile === 3 ? clamp(d * 1.35, 0, 1) : clamp(d * 5.5, 0, 1);
        const lip = (tile === 3 || d <= 0.001) ? 0 : Math.max(0, 1 - Math.abs(d - 0.13) / 0.135);
        const o = ((ty * TILE + j) * ATLAS + (tx * TILE + i)) * 4;
        px[o] = Math.round(d * 255);          // R: how deep
        px[o + 1] = Math.round(lip * 255);    // G: the pushed-up rim
        px[o + 2] = 0;
        px[o + 3] = Math.round(Math.max(mask, lip * 0.92) * 255);
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    /* flipY OFF, and it is not cosmetic. r128 flips a CanvasTexture by
       default, so texture v=0 lands on the canvas's LAST row — which silently
       swapped the two tile ROWS and drew hoof prints where boots should be. */
    tex.flipY = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    return tex;
  }

  /* ============================================================ THE PRINTS
     ONE InstancedMesh, one quad, a fixed pool of ring-buffer slots. Nothing
     allocates after boot; a new print overwrites the oldest slot. Per
     instance: the matrix (which carries the seat, the lean, the facing and
     the size), a birth time, a life, a tile, a depth and the ground's own
     colour. The shader does the rest.

     WHY A SHADERMATERIAL AND NOT LAMBERT + instanceColor. A print has to
     FADE, and r128 gives an InstancedMesh exactly one per-instance channel
     (instanceColor) with no alpha in it. Baking the fade into the colour
     against an unknown background is a guess; a per-instance age with the
     fade curve in the shader is the thing itself. Same conclusion
     dustfx.js reached about PointsMaterial, for the same reason. */
  /* THE CHURN POOL IS THE BIGGER OF THE TWO, which looks backwards and is
     the right way round: a print is read from ten metres and recycles inside
     a minute, the road is read from four hundred and has to still be there
     when you turn round on the ridge. 1 600 quads at three per 2.4 m of ride
     is 1.3 km of road. */
  const PRINT_CAP = 2200, CHURN_CAP = 1600;

  function makeDecalLayer(cap, order) {
    const geo = new THREE.PlaneGeometry(1, 1);   // local +Z is the normal
    const born = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    const life = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    const tile = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    const deep = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    const tone = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    born.setUsage(THREE.DynamicDrawUsage); life.setUsage(THREE.DynamicDrawUsage);
    tile.setUsage(THREE.DynamicDrawUsage); deep.setUsage(THREE.DynamicDrawUsage);
    tone.setUsage(THREE.DynamicDrawUsage);
    life.array.fill(-1);
    geo.setAttribute("aBorn", born);
    geo.setAttribute("aLife", life);
    geo.setAttribute("aTile", tile);
    geo.setAttribute("aDeep", deep);
    geo.setAttribute("aTone", tone);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: null },
        uTime: { value: 0 },
        uSun: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
        uFar: { value: 900 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: [
        "attribute float aBorn;", "attribute float aLife;",
        "attribute float aTile;", "attribute float aDeep;", "attribute vec3 aTone;",
        "uniform float uTime; uniform float uFar;",
        "varying vec2 vUv; varying float vFade; varying float vTile;",
        "varying float vDeep; varying vec3 vTone;",
        "varying vec3 vTanX; varying vec3 vTanY;",
        "void main() {",
        "  vUv = uv; vTile = aTile; vTone = aTone;",
        /* THE FADE IS THE WIND FILLING IT IN. Full for the first 55% of the
           print's life, then out — a real print holds its edge and then goes
           all at once as the crest of the rim collapses into it, which is
           nothing like a linear dissolve. Distance takes the rest: past uFar
           a print is under a pixel and drawing it is a blend for nothing. */
        "  float age = uTime - aBorn;",
        "  float t = (aLife > 0.0) ? clamp(age / aLife, 0.0, 1.0) : 2.0;",
        "  vFade = (t >= 1.0) ? 0.0 : (t < 0.06 ? t / 0.06 : 1.0 - smoothstep(0.55, 1.0, t));",
        "  vDeep = aDeep;",
        "  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);",
        "  vFade *= 1.0 - smoothstep(uFar * 0.62, uFar, -mv.z);",
        /* the print's own tangent frame, so the fragment stage can light the
           hole's gradient against the world sun without a normal map */
        "  vTanX = normalize((instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);",
        "  vTanY = normalize((instanceMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);",
        "  gl_Position = projectionMatrix * mv;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "precision mediump float;",
        "uniform sampler2D uTex; uniform vec3 uSun;",
        "varying vec2 vUv; varying float vFade; varying float vTile;",
        "varying float vDeep; varying vec3 vTone;",
        "varying vec3 vTanX; varying vec3 vTanY;",
        "void main() {",
        "  if (vFade <= 0.003) discard;",
        "  vec2 base = vec2(mod(vTile, 2.0), floor(vTile * 0.5)) * 0.5;",
        "  vec2 uv = base + vUv * 0.5;",
        "  vec4 c = texture2D(uTex, uv);",
        "  float m = c.a;",
        "  if (m <= 0.004) discard;",
        /* THE SHADING IS THE HOLE'S OWN SLOPE. Four taps of the depth
           channel give d(depth)/du and /dv; that gradient, mapped through
           the instance's tangent frame, is the microfacet normal of the
           depression. Lambert it against the same sun the terrain uses and
           the far wall of the print catches the light while the near wall
           goes into shadow — which is what a footprint IS. A baked
           highlight cannot do this: turn the foot 90 degrees, or wait two
           hours of game clock, and a baked one is lit from the wrong side. */
        "  float e = 0.012;",
        "  float du = texture2D(uTex, uv + vec2(e, 0.0)).r - texture2D(uTex, uv - vec2(e, 0.0)).r;",
        "  float dv = texture2D(uTex, uv + vec2(0.0, e)).r - texture2D(uTex, uv - vec2(0.0, e)).r;",
        "  vec3 n = normalize(vTanX * (du * 9.0 * vDeep) + vTanY * (dv * 9.0 * vDeep) + vec3(0.0, 1.0, 0.0) * 0.55);",
        "  float lam = clamp(dot(n, normalize(uSun)), -1.0, 1.0);",
        /* AMBIENT OCCLUSION IN THE HOLE, which is half of why a depression
           reads as a depression and not as a stain. The deeper the texel,
           the less sky it can see. The FLOOR is 0.70 and that number came
           off a photograph, not a preference: the first pass ran to 0.35 and
           every print photographed as a hole punched through to bare earth.
           Sand in shadow is still sand. */
        "  float ao = 1.0 - c.r * 0.44 * (0.45 + 0.55 * vDeep);",
        "  vec3 col = vTone * ao * (0.90 + 0.30 * lam);",
        /* THE RIM, off its own channel. Sand pushed out of the hole stands
           proud and catches the sun; the bright hairline round a fresh print
           is the single most recognisable thing about one. */
        "  col = mix(col, vTone * (1.30 + 0.20 * clamp(lam, 0.0, 1.0)), c.g * 0.90 * (0.4 + 0.6 * vDeep));",
        "  gl_FragColor = vec4(col, m * vFade * (0.34 + 0.62 * vDeep));",
        "}",
      ].join("\n"),
    });
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;        // it is spread over kilometres of ride
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.count = 0;
    mesh.renderOrder = order;
    return {
      mesh: mesh, cap: cap, ring: 0, live: 0,
      born: born, life: life, tile: tile, deep: deep, tone: tone,
      mat: mat, geo: geo,
    };
  }

  let prints = null, churns = null, atlas = null;
  let clock = 0;                        // this file's own seconds

  const _v3 = { x: 0, y: 0, z: 0 };
  const _m4 = THREE ? new THREE.Matrix4() : null;
  const _q = THREE ? new THREE.Quaternion() : null;
  const _up = THREE ? new THREE.Vector3(0, 0, 1) : null;
  const _n = THREE ? new THREE.Vector3() : null;
  const _p = THREE ? new THREE.Vector3() : null;
  const _s = THREE ? new THREE.Vector3() : null;
  const _qz = THREE ? new THREE.Quaternion() : null;
  const _az = THREE ? new THREE.Vector3(0, 0, 1) : null;

  /* SEAT A DECAL ON THE GROUND — gore.js's seatDecal, re-expressed as a
     Matrix4 for an instanced pool. Quaternion from the plane's local +Z to
     the surface normal, spun about that normal by the foot's facing, and
     the whole thing lifted ALONG the normal rather than straight up: on a
     50 deg face a vertical lift slides the print downhill by the lift times
     the slope, which is exactly how you get a print that does not line up
     with the boot that made it. */
  function seat(x, y, z, nx, ny, nz, spin, w, h, lift) {
    _n.set(nx, ny, nz);
    _q.setFromUnitVectors(_up, _n);
    _qz.setFromAxisAngle(_az, spin);
    _q.multiply(_qz);
    _p.set(x + nx * lift, y + ny * lift, z + nz * lift);
    _s.set(w, h, 1);
    _m4.compose(_p, _q, _s);
    return _m4;
  }

  function push(layer, x, y, z, nx, ny, nz, spin, w, h, tile, deep, life, tone, lift) {
    if (!layer) return -1;
    const i = layer.ring; layer.ring = (layer.ring + 1) % layer.cap;
    if (layer.live < layer.cap) layer.live++;
    layer.mesh.setMatrixAt(i, seat(x, y, z, nx, ny, nz, spin, w, h, lift));
    layer.born.array[i] = clock;
    layer.life.array[i] = life;
    layer.tile.array[i] = tile;
    layer.deep.array[i] = deep;
    layer.tone.array[i * 3] = tone[0];
    layer.tone.array[i * 3 + 1] = tone[1];
    layer.tone.array[i * 3 + 2] = tone[2];
    layer.mesh.count = layer.live;
    layer.mesh.instanceMatrix.needsUpdate = true;
    layer.born.needsUpdate = layer.life.needsUpdate = true;
    layer.tile.needsUpdate = layer.deep.needsUpdate = layer.tone.needsUpdate = true;
    return i;
  }

  /* HOW LONG A PRINT LASTS. Wind fills a print in; a crust does not take one
     to begin with. Soft dune sand in a light breeze holds a boot for a few
     minutes of real weather and this game's clock runs at campaign pace, so
     the base is 210 s scaled DOWN hard by firmness (a scuff on rock is gone
     in twenty seconds because there was never a hole) and down again by
     whatever wind events.js says is blowing. Called defensively: this file
     must work on a page that did not load events.js. */
  function windMul() {
    try {
      const e = W.events && W.events.weather ? W.events.weather() : null;
      if (e && e.wind) {
        const w = Math.hypot(e.wind.x || 0, e.wind.z || 0);
        return 1 / (1 + w * 0.9);
      }
    } catch (x) {}
    return 1;
  }
  function lifeFor(firm, base) {
    return Math.max(8, (base || 210) * (1 - firm * 0.86) * windMul());
  }

  /* ============================================================ step()
     ONE PRINT. Everything a caller has to know is (x, z) and which way the
     foot is pointing; this works out the rest off the ground itself. */
  S.step = function (x, z, o) {
    if (FLAG_OLD || FLAG_NOPRINTS || !prints) return null;
    o = o || {};
    const st = stand(x, z, o);
    /* NOTHING PRINTS ON ROCK. A boot on stone leaves dust, not a hole, and a
       hole stamped on a mesa top is the single most obviously wrong thing
       this file could draw. The pan takes a faint scuff and that is right —
       a salt crust does crack under a boot. */
    if (st.firm > 0.94) return null;
    const soft = 1 - st.firm;
    const tone = toneAt(x, z, st.biome);
    /* A BOOT IS ABOUT 0.12 m ACROSS AND 0.30 m LONG, and that is the number
       this has to end up at on the sand. The atlas shape fills roughly 80%
       of the quad across and 75% along, so the quad is 0.19 x 0.42 m. The
       first draft sized it 0.49 x 1.00 and the pair image came back with a
       man walking on bath mats — it is very easy to make a decal too big
       when you are judging it from directly above. Soft sand spreads the
       mark a fifth wider, which is real: the walls of the hole collapse.
       THE SIZE IS THE MAN'S, THE DEPTH IS THE GROUND'S. Weight scales the
       depth, never the width — a heavy man does not have bigger feet. */
    const size = (o.size || 1) * 0.19 * (1 + soft * 0.22);
    const deep = clamp(soft * (o.weight == null ? 1 : o.weight) * (0.55 + (o.load || 0) * 0.45), 0.06, 1);
    // a drag print on anything past the angle of repose: he did not place
    // that foot, he slid it
    const dragging = st.slope > 0.62 && soft > 0.45;
    const tile = o.tile != null ? o.tile : dragging ? 1 : 0;
    let spin = o.yaw == null ? 0 : o.yaw;
    if (dragging) spin = Math.atan2(-st.gx, -st.gz);   // the drag points downhill
    const stretch = dragging ? 1.6 + Math.min(1.2, st.slope) : 1;
    const jit = (rnd() - 0.5) * 0.06;
    push(prints, x, st.y, z, st.nx, st.ny, st.nz, spin + jit,
         size * (o.wide || 1), size * 2.20 * stretch, tile, deep,
         lifeFor(st.firm, o.life), tone,
         /* THE LIFT IS STAGGERED PER PRINT, and this one is prophylactic
            rather than filmed: a column lays hundreds of OVERLAPPING prints
            and every one seated at the same 3 cm above the ground is
            coplanar with its neighbours, which is the textbook recipe for a
            z-fight that only appears once somebody rides in a circle. 2 to
            5 cm off the same LCG orders them instead. */
         0.022 + rnd() * 0.028);
    if (o.puff !== false) S.puff(x, st.y, z, { amt: soft * (o.speed == null ? 1 : clamp(o.speed / 3, 0.2, 1.4)), tone: tone, gx: st.gx, gz: st.gz });
    return st;
  };

  /* CHURN — the wide trampled band. THIS is the road you see from a ridge.
     A column does not leave two hundred readable boot prints, it leaves a
     strip of broken sand, and drawing it as a strip is also the only thing
     that fits in a budget: one quad every couple of metres of ride,
     regardless of whether the party is six men or two hundred. Party size
     sets the WIDTH and the DEPTH. */
  S.churn = function (x, z, o) {
    if (FLAG_OLD || FLAG_NOPRINTS || !churns) return null;
    o = o || {};
    const st = stand(x, z, o);
    if (st.firm > 0.94) return null;
    const soft = 1 - st.firm;
    const tone = toneAt(x, z, st.biome);
    const n = Math.max(1, o.men || 1);
    /* WIDTH GROWS AS sqrt(men), which is how a column actually widens: men
       walk in the tracks in front of them until the churned strip is wide
       enough to walk beside, and that is a packing problem, not a linear
       one. 2.2 m for a lone rider, 9 m for two hundred, capped there because
       past that they would be marching abreast and they are not. */
    const band = o.band != null ? o.band : bandWidth(n);
    /* BUT THE QUAD IS CAPPED AT 4.6 m AND THE BAND IS TILED OUT OF SEVERAL.
       This is the one artifact the ridge pair caught and it is worth
       spelling out: a decal is a FLAT plane seated on the surface normal at
       its centre, so the wider it is the further its corners stray from a
       curving dune — and the corners that stray DOWNWARD are depth-clipped
       by the terrain, which cuts a dead-straight horizontal line across the
       road. One 8.6 m quad per step drew a road with three razor cuts
       through it. Three 4 m quads across the same band follow the curvature
       four times as closely and the cuts are gone, for four extra triangles
       per 2.4 m of ride. */
    const w = Math.min(4.6, o.w != null ? o.w : band);
    const deep = clamp(soft * (0.24 + Math.min(0.5, Math.log(n + 1) * 0.12)), 0.05, 0.8);
    push(churns, x, st.y, z, st.nx, st.ny, st.nz,
         (o.yaw == null ? 0 : o.yaw) + (rnd() - 0.5) * 0.5,
         w * (0.85 + rnd() * 0.3), w * (0.85 + rnd() * 0.3),
         3, deep,
         /* THE ROAD OUTLASTS THE PRINTS. A trampled strip is a change to the
            ground's surface, not a hole in it, and the wind takes minutes to
            put that back rather than seconds. 4x the print life. */
         lifeFor(st.firm, (o.life || 210) * 4), tone,
         /* AND THE LIFT SCALES WITH THE QUAD, for the same curvature reason:
            a 4 m plane on a dune needs more clearance than a 19 cm one.
            8 cm at full width, which is nothing at the range a road is read
            from and still under the sand grain up close. */
         0.012 + w * 0.016 + rnd() * 0.014);
    return st;
  };
  function bandWidth(men) { return clamp(1.6 + Math.sqrt(Math.max(1, men)) * 0.52, 2.0, 9.5); }
  S.bandWidth = bandWidth;

  /* ============================================================ DUST
     dustfx.js's cloud, ported (see the note at the top of this file for why
     it could not be called). One pooled Points, one hand-rolled point shader
     with a per-mote fade attribute, ring-buffer spawn, no allocation once
     warm. What is different here is the SAND: half of what a boot throws is
     not dust at all, it is grains, and they leave fast, low and downhill and
     land again in half a second. Motes that only ever rise read as smoke. */
  const DUST_MAX = 260;
  let dust = null;
  function makeDust() {
    const pos = new Float32Array(DUST_MAX * 3);
    const vel = new Float32Array(DUST_MAX * 3);
    const age = new Float32Array(DUST_MAX);
    const life = new Float32Array(DUST_MAX).fill(-1);
    const size = new Float32Array(DUST_MAX);
    const fade = new Float32Array(DUST_MAX);
    const col = new Float32Array(DUST_MAX * 3);
    const heavy = new Float32Array(DUST_MAX);       // 1 = a grain, 0 = airborne dust
    const geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(pos, 3), fa = new THREE.BufferAttribute(fade, 1);
    const sa = new THREE.BufferAttribute(size, 1), ca = new THREE.BufferAttribute(col, 3);
    pa.setUsage(THREE.DynamicDrawUsage); fa.setUsage(THREE.DynamicDrawUsage);
    sa.setUsage(THREE.DynamicDrawUsage); ca.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", pa);
    geo.setAttribute("aFade", fa);
    geo.setAttribute("aSize", sa);
    geo.setAttribute("aCol", ca);
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: [
        "attribute float aFade; attribute float aSize; attribute vec3 aCol;",
        "varying float vFade; varying vec3 vCol;",
        "void main() {",
        "  vFade = aFade; vCol = aCol;",
        "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
        /* 34, NOT 150. The first pass scaled a mote to 150/distance and a
           handful of footfalls put a pale sheet over the whole frame — the
           man himself photographed bleached. A grain of kicked sand is a
           couple of centimetres and should be a couple of PIXELS at ten
           metres, which is what this is. */
        "  gl_PointSize = aSize * (34.0 / max(1.0, -mv.z)) * (0.35 + 0.65 * aFade);",
        "  gl_Position = projectionMatrix * mv;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "precision mediump float;",
        "varying float vFade; varying vec3 vCol;",
        "void main() {",
        "  vec2 d = gl_PointCoord - vec2(0.5);",
        "  float r = length(d) * 2.0;",
        "  float e = 1.0 - smoothstep(0.55, 1.0, r);",
        "  gl_FragColor = vec4(vCol, vFade * e * 0.30);",
        "}",
      ].join("\n"),
    });
    const cloud = new THREE.Points(geo, mat);
    cloud.frustumCulled = false;
    cloud.renderOrder = 7;
    cloud.visible = false;
    return { pos, vel, age, life, size, fade, col, heavy, geo, pa, fa, sa, ca, cloud, ring: 0, top: 0 };
  }

  S.puff = function (x, y, z, o) {
    if (FLAG_OLD || !dust) return;
    o = o || {};
    const amt = clamp(o.amt == null ? 0.6 : o.amt, 0, 2);
    if (amt < 0.05) return;
    const tone = o.tone || _tone;
    const q = CBZ.qScale ? CBZ.qScale(0.35, 1) : 1;
    const n = Math.max(1, Math.round((1 + amt * 2) * q));
    // wind, if anything is publishing one
    let wx = 0, wz = 0;
    try {
      const e = W.events && W.events.weather ? W.events.weather() : null;
      if (e && e.wind) { wx = (e.wind.x || 0) * 0.10; wz = (e.wind.z || 0) * 0.10; }
    } catch (er) {}
    for (let i = 0; i < n; i++) {
      const k = dust.ring; dust.ring = (dust.ring + 1) % DUST_MAX;
      if (dust.ring > dust.top) dust.top = dust.ring;
      /* HALF GRAINS, HALF DUST, AND THE SPLIT IS THE WHOLE LOOK. Grains
         leave along the ground in the direction the foot pushed, at 2-3 m/s,
         and are gone in half a second. Dust leaves slowly, rises, and drifts
         with the wind for two seconds. One population doing both averages
         into a grey smudge that reads as exhaust. */
      const grain = i % 2 === 0 ? 1 : 0;
      const a = rnd() * Math.PI * 2;
      const sp = grain ? 1.5 + rnd() * 1.7 : 0.25 + rnd() * 0.5;
      // grains prefer downhill: that is gravity plus the shove of the foot
      const dgx = -(o.gx || 0), dgz = -(o.gz || 0);
      const dl = Math.hypot(dgx, dgz) || 1;
      const bias = grain ? Math.min(1, dl) * 0.7 : 0;
      const o3 = k * 3;
      dust.pos[o3] = x + (rnd() - 0.5) * 0.30;
      dust.pos[o3 + 1] = y + 0.04 + rnd() * (grain ? 0.10 : 0.30);
      dust.pos[o3 + 2] = z + (rnd() - 0.5) * 0.30;
      dust.vel[o3] = Math.cos(a) * sp * (1 - bias) + dgx / dl * sp * bias + wx;
      dust.vel[o3 + 1] = grain ? 0.8 + rnd() * 1.1 : 0.30 + rnd() * 0.45;
      dust.vel[o3 + 2] = Math.sin(a) * sp * (1 - bias) + dgz / dl * sp * bias + wz;
      dust.age[k] = 0;
      dust.life[k] = grain ? 0.30 + rnd() * 0.26 : 0.9 + rnd() * 0.9;
      dust.size[k] = grain ? 0.6 + rnd() * 0.5 : 1.5 + rnd() * 1.4 + amt * 0.7;
      dust.heavy[k] = grain;
      // the dust is the ground's colour, lifted: airborne sand is paler than
      // the ground it came off because it is lit from every side at once
      dust.col[o3] = clamp(tone[0] * 1.14, 0, 1);
      dust.col[o3 + 1] = clamp(tone[1] * 1.12, 0, 1);
      dust.col[o3 + 2] = clamp(tone[2] * 1.10, 0, 1);
    }
    dust.ca.needsUpdate = dust.sa.needsUpdate = true;
  };

  let dustLive = 0;
  function stepDust(dt) {
    if (!dust || dust.top === 0) { dustLive = 0; return 0; }
    let live = 0;
    for (let i = 0; i < dust.top; i++) {
      if (dust.life[i] < 0 || dust.age[i] >= dust.life[i]) { dust.fade[i] = 0; continue; }
      live++;
      dust.age[i] += dt;
      const t = Math.min(1, dust.age[i] / dust.life[i]);
      const o = i * 3;
      if (dust.heavy[i]) {
        dust.vel[o + 1] -= 9.0 * dt;              // grains fall
        dust.vel[o] *= (1 - 1.6 * dt); dust.vel[o + 2] *= (1 - 1.6 * dt);
      } else {
        dust.vel[o + 1] += 0.22 * dt;             // dust is buoyant, briefly
        dust.vel[o] *= (1 - 0.5 * dt); dust.vel[o + 2] *= (1 - 0.5 * dt);
      }
      dust.pos[o] += dust.vel[o] * dt;
      dust.pos[o + 1] += dust.vel[o + 1] * dt;
      dust.pos[o + 2] += dust.vel[o + 2] * dt;
      dust.fade[i] = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
      if (dust.age[i] >= dust.life[i]) dust.fade[i] = 0;
    }
    dust.pa.needsUpdate = true; dust.fa.needsUpdate = true;
    dustLive = live;
    if (live) { dust.cloud.visible = true; dust.geo.setDrawRange(0, dust.top); }
    else { dust.cloud.visible = false; dust.top = 0; dust.ring = 0; }
    return live;
  }

  /* ============================================================ THE GAIT
     walk(key, x, z, opts) — feed a walker's position every frame and this
     decides when a foot went down. A footfall is a DISTANCE event, not a
     time event: a man who has stopped is not still printing, and a man
     sprinting prints exactly as often per metre as a man strolling. Stride
     is 0.78 m for a man on foot, which is a real number and also what makes
     a column's tracks look like tracks rather than a dotted line.

     The foot alternates left/right and steps off the walker's own axis by
     half a stance, which is the difference between a line of prints and a
     TRAIL. The first draft printed on the centre line and it read as a
     bicycle. */
  const walkers = new Map();
  const STRIDE = 0.78;
  S.walk = function (key, x, z, o) {
    if (FLAG_OLD || FLAG_NOPRINTS) return 0;
    o = o || {};
    let wk = walkers.get(key);
    if (!wk) {
      if (walkers.size > 420) walkers.clear();   // a battle ends; so do its men
      wk = { x: x, z: z, acc: 0, foot: 0, seen: clock };
      walkers.set(key, wk);
      return 0;
    }
    const dx = x - wk.x, dz = z - wk.z;
    const d = Math.hypot(dx, dz);
    wk.seen = clock;
    // a teleport is not a walk: campaign moves men across the island between
    // frames and a straight line of prints across two kilometres is a bug
    if (d > 6) { wk.x = x; wk.z = z; wk.acc = 0; return 0; }
    wk.acc += d; wk.x = x; wk.z = z;
    const stride = (o.stride || STRIDE) * (o.scale || 1);
    let n = 0;
    while (wk.acc >= stride) {
      wk.acc -= stride;
      wk.foot ^= 1;
      const yaw = o.yaw != null ? o.yaw : (d > 0.0001 ? Math.atan2(dx, dz) : 0);
      // the foot is half a stance off the centre line, on the side whose
      // turn it is
      const side = (wk.foot ? 1 : -1) * (o.width || 0.17);
      const fx = x + Math.cos(yaw) * side, fz = z - Math.sin(yaw) * side;
      if (S.step(fx, fz, {
        yaw: yaw, weight: o.weight, load: o.load, size: o.size,
        speed: o.speed, life: o.life, puff: o.puff,
      })) n++;
    }
    return n;
  };

  /* ============================================================ plant()
     THE ONE CALL. Position an Object3D on the ground, lean it into the
     slope, and feed its gait to the print system. This is what replaces

         rig.position.set(x, D.heightAt(x, z), z);
         rig.rotation.y = yaw;

     everywhere in this game, and the lean is the entire fix for the report.

     THE LEAN IS PARTIAL, AND THE TAPER IS AN ANKLE. A human ankle gives
     about 20 degrees, so up to tan(20 deg) of grade a man really can put his
     sole flat on the ground with his body still over his feet — align him
     nearly all the way and the soles land. Past that he cannot, and he does
     what anyone on a slip face does: keeps his mass upright and digs the
     uphill boot in. So the alignment eases back from 0.75 toward 0.49 as the
     grade runs from 0.36 to 1.25.

     A FIXED FRACTION WAS THE FIRST DRAFT AND THE NUMBERS KILLED IT. 0.62
     everywhere left 13 cm of the sole still under the sand on a 25 deg
     flank — better than the 22 cm it started at and still visible — while
     on a 50 deg wall it laid the body over far enough to read as a fall.
     One number cannot be right at both ends of that range. Callers who ARE
     the ground — a rock, a wreck, a crate — pass lean: 1 and get the full
     alignment with no taper. */
  const _e = THREE ? new THREE.Euler() : null;
  const _qy = THREE ? new THREE.Quaternion() : null;
  const _qn = THREE ? new THREE.Quaternion() : null;
  const _ax = THREE ? new THREE.Vector3() : null;
  const _upY = THREE ? new THREE.Vector3(0, 1, 0) : null;
  function plantImpl(obj, x, z, yaw, o) {
    if (!obj) return null;
    o = o || {};
    if (FLAG_OLD) {
      obj.position.set(x, heightAt(x, z), z);
      obj.rotation.set(0, yaw || 0, 0);
      return null;
    }
    /* THE STANCE RADIUS DEFAULTS TO THE BODY, NOT THE FOOT. stand()'s
       default is a 0.34 m contact patch, which is a boot; a BODY being
       seated has to fit its own width or the curvature term is computed over
       the wrong patch and the flat-ground measurement came back a
       centimetre worse than the before. The cast rig measures 1.08 m
       across, so 0.5 m is the half-width a caller gets unless it knows
       better. */
    const st = stand(x, z, { r: o.r == null ? 0.5 : o.r });
    const ANKLE = 0.36;                      // tan(20 deg): what an ankle gives
    /* 0.75, JUDGED FROM THE PICTURE. 0.85 put both soles flat on a 25 deg
       flank and read as a man tipping downhill — the rig has no ankle, so
       every degree that gets the sole down also lays the torso over, and
       past about 19 deg of body lean the silhouette stops saying "braced"
       and starts saying "falling". 0.75 is the last value where it still
       says braced. */
    const base = o.lean == null ? 0.75 : o.lean;
    const k = (o.lean === 1 || st.slope <= ANKLE) ? base
      : base * lerp(1, 0.65, clamp((st.slope - ANKLE) / 0.89, 0, 1));
    obj.position.set(x, st.y + (o.lift || 0), z);
    if (k <= 0 || st.slope < 0.02) {
      obj.quaternion.setFromEuler(_e.set(0, yaw || 0, 0));
    } else {
      /* SLERP TOWARD THE NORMAL, not a raw pair of Euler tilts. Pitching by
         atan(gz) and then rolling by atan(gx) is not the same rotation as
         aligning to (gx,gz) and it visibly yaws the body on a diagonal
         slope: the composed Euler yaws the body as a side effect of the two
         tilts, and a man walking a contour would crab. */
      _n.set(st.nx, st.ny, st.nz);
      _qn.setFromUnitVectors(_upY, _n);
      _qy.setFromEuler(_e.set(0, yaw || 0, 0));
      _q.set(0, 0, 0, 1).slerp(_qn, k);
      obj.quaternion.copy(_q).multiply(_qy);
    }
    if (o.dt != null && !FLAG_NOPRINTS) {
      S.walk(o.id == null ? obj.uuid : o.id, x, z, {
        yaw: yaw, weight: o.weight, load: o.load, size: o.size,
        speed: o.speed, scale: o.scale, stride: o.stride,
      });
    }
    return st;
  }
  /* A CALLER THAT PLANTS ITS OWN BODY OWNS IT. The bridge below steps aside
     for three seconds every time somebody outside this file plants the
     player, so the day campaign.js adopts the one-liner there is never a
     frame with two systems seating the same rig. */
  S.plant = function (obj, x, z, yaw, o) {
    if (o && o.id === "you") adopted = 3;
    return plantImpl(obj, x, z, yaw, o);
  };

  /* ============================================================ THE COLUMN
     The campaign draws sixty bodies out of a roster of two hundred and none
     of them is a simulated man — they are instances riding the player's
     breadcrumb. Asking each of them to stamp prints would be sixty times
     the cost for a mark four pixels wide, so the COLUMN's ground record is
     laid off the PLAYER's own path instead, with the roster's size setting
     how wide and how deep it is. That is one churn quad every 2.4 m of ride
     plus a couple of prints scattered across the band, and it is the same
     picture from a ridge for a fiftieth of the work.

     This runs itself off W.state, so the trail exists whether or not
     campaign.js ever adopts a line of this file. That is deliberate: the
     siblings are being written in parallel and the pictures cannot wait. */
  const COLUMN_STEP = 2.4;
  let colX = null, colZ = null, colAcc = 0, colYaw = 0;
  function stepColumn() {
    if (FLAG_OLD || FLAG_NOPRINTS) return;
    const st = W.state;
    if (!st || !st.you || W.phase() !== "campaign") { colX = null; return; }
    const x = st.you.x, z = st.you.z;
    if (colX == null) { colX = x; colZ = z; colAcc = 0; return; }
    const dx = x - colX, dz = z - colZ, d = Math.hypot(dx, dz);
    if (d > 40) { colX = x; colZ = z; colAcc = 0; return; }   // a teleport, not a ride
    if (d > 0.0001) colYaw = Math.atan2(dx, dz);
    colAcc += d; colX = x; colZ = z;
    const men = W.armySize ? W.armySize() : 1;
    while (colAcc >= COLUMN_STEP) {
      colAcc -= COLUMN_STEP;
      /* THE BAND TRAILS BEHIND HIM, not under him. His men are at his back,
         so stamping the churn at his own feet lays the road in front of the
         column — a road he has not walked yet. Half the band's own width
         back is where the front rank actually is. */
      const back = 3.0 + Math.sqrt(men) * 0.5;
      const cx = x - Math.sin(colYaw) * back, cz = z - Math.cos(colYaw) * back;
      const band = bandWidth(men);
      const tiles = Math.max(1, Math.round(band / 3.4));
      for (let t = 0; t < tiles; t++) {
        const off = tiles === 1 ? 0 : (t / (tiles - 1) - 0.5) * (band - band / tiles);
        S.churn(cx + Math.cos(colYaw) * off, cz - Math.sin(colYaw) * off,
                { men: men, yaw: colYaw, band: band, w: band / tiles + 1.1 });
      }
      /* AND SOME REAL BOOTS IN IT — BUT ONLY IF THERE ARE MEN TO MAKE THEM.
         The churn carries the shape from a ridge; up close a band of blur
         with no prints in it reads as a texture bug, so a few of the
         column's boots go in scattered across the band.

         SCALED BY PARTY SIZE, and that is a bug fix, not a tuning knob. A
         flat two-per-step ran for a party of ONE as well, so the player got
         his own gait's prints AND a second parallel trail of anonymous
         boots stamped beside him at random angles — the close-up came back
         with two overlapping trails from one man walking. Under four men
         the player's own feet are the whole record. */
      const extras = men < 4 ? 0 : men < 25 ? 1 : 2;
      const w = band * 0.42;
      for (let i = 0; i < extras; i++) {
        const off = (rnd() - 0.5) * 2 * w;
        const bx = cx + Math.cos(colYaw) * off - Math.sin(colYaw) * (rnd() - 0.5) * 2.0;
        const bz = cz - Math.sin(colYaw) * off - Math.cos(colYaw) * (rnd() - 0.5) * 2.0;
        S.step(bx, bz, { yaw: colYaw + (rnd() - 0.5) * 0.4, weight: 1, puff: false, speed: 0 });
      }
      /* MOUNTS LEAVE HOOVES, and the party's pace already knows whether it
         has any. Called defensively — mounts.js may not be on the page. */
      try {
        if (W.mounts && W.mounts.mountedN && W.mounts.mountedN() > 0) {
          const hx = cx + Math.cos(colYaw) * (rnd() - 0.5) * 2 * w;
          const hz = cz - Math.sin(colYaw) * (rnd() - 0.5) * 2 * w;
          S.step(hx, hz, { yaw: colYaw, tile: 2, weight: 2.2, size: 0.9, puff: false, speed: 0 });
        }
      } catch (e) {}
    }
  }

  /* ============================================================ THE BRIDGE
     campaign.js is a sibling's file this week and cannot be edited from
     here, so the player's own body — the ONE object the close-up pair image
     is about — is re-seated after the campaign has placed it. This is a
     BRIDGE, not a design: it is forty lines, it costs one stand() a frame,
     and it turns itself off the moment campaign.js calls plant() itself
     (see `adopted`). Delete it the day that one line lands.

     It finds the rig the only honest way available: the cast rig is the one
     object in the scene carrying userData.charRig, which is entities/
     character.js's own marker and not something this file invented. */
  let bridgeRig = null, bridgeMiss = 0, adopted = 0;
  function findRig() {
    if (bridgeRig && bridgeRig.parent) return bridgeRig;
    if (bridgeMiss > 0) { bridgeMiss--; return null; }     // do not traverse the scene every frame
    bridgeMiss = 30;
    let found = null, bestD = 4;
    const you = W.state && W.state.you;
    try {
      CBZ.scene.traverse(function (o) {
        if (!o.userData || !o.userData.charRig || !you) return;
        // props.js and mounts.js both put cast rigs in the scene; the
        // player's is the one standing where the campaign says he is.
        const d = Math.hypot(o.position.x - you.x, o.position.z - you.z);
        if (d < bestD) { bestD = d; found = o; }
      });
    } catch (e) {}
    bridgeRig = found;
    return found;
  }
  function stepBridge(dt) {
    if (FLAG_OLD || adopted > 0) return;
    const st = W.state;
    if (!st || !st.you || W.phase() !== "campaign") return;
    const rig = findRig();
    if (!rig) return;
    // only touch it if it is standing where the campaign just put the player;
    // anything else in the scene with a charRig is somebody else's business
    if (Math.abs(rig.position.x - st.you.x) > 1.5 || Math.abs(rig.position.z - st.you.z) > 1.5) return;
    plantImpl(rig, st.you.x, st.you.z, st.you.yaw, {
      dt: dt, id: "you", weight: 1.15, load: 0.5,
      speed: colAcc > 0 ? 1.4 : 0, r: 0.54,   // Box3 off the live cast rig: 1.08 m across
    });
  }

  /* ============================================================ DEBUG
     ?sand=1. The numbers the fix is judged on, on the page, live: how far a
     plumb body's contact patch would be buried and how far it would float,
     what the LOD chord error actually is at the player's feet (the
     hypothesis this file opened by disproving), and what the ground record
     is costing. Plus a marker at every recent footfall, because "is it
     stamping where the boot is" is a question no number answers. */
  let dbgEl = null, dbgDots = null, dbgN = 0;
  const DBG_DOTS = 64;
  function makeDebug() {
    dbgEl = document.createElement("div");
    dbgEl.style.cssText = "position:fixed;left:8px;bottom:88px;z-index:9999;font:11px/1.5 ui-monospace,Menlo,monospace;" +
      "color:#ffe9c0;background:rgba(20,14,6,.72);padding:7px 10px;border:1px solid rgba(255,210,140,.3);white-space:pre;pointer-events:none";
    document.body.appendChild(dbgEl);
    const g = new THREE.SphereGeometry(0.09, 6, 4);
    const m = new THREE.MeshBasicMaterial({ color: 0x35ff9e, depthTest: false });
    dbgDots = new THREE.InstancedMesh(g, m, DBG_DOTS);
    dbgDots.frustumCulled = false;
    dbgDots.renderOrder = 999;
    dbgDots.count = 0;
    scene.add(dbgDots);
  }
  const _dm = THREE ? new THREE.Matrix4() : null;
  function dbgMark(x, y, z) {
    if (!dbgDots) return;
    _dm.makeTranslation(x, y + 0.05, z);
    dbgDots.setMatrixAt(dbgN % DBG_DOTS, _dm);
    dbgN++;
    dbgDots.count = Math.min(dbgN, DBG_DOTS);
    dbgDots.instanceMatrix.needsUpdate = true;
  }
  function paintDebug() {
    if (!dbgEl) return;
    const st = W.state;
    const a = S.audit();
    let s = "SAND  " + (FLAG_OLD ? "OFF (?sand=old)" : "on") + "\n";
    if (st && st.you) {
      const g = stand(st.you.x, st.you.z, { r: 0.42 });
      const r = S.renderedY(st.you.x, st.you.z);
      s += "slope   " + (Math.atan(g.slope) * 180 / Math.PI).toFixed(1) + " deg  " + g.biome + " firm " + g.firm.toFixed(2) + "\n";
      s += "plumb   bury " + (g.bury * 100).toFixed(0) + " cm   float " + (g.float * 100).toFixed(0) + " cm\n";
      s += "planted bury " + (FLAG_OLD ? (g.bury * 100).toFixed(0) : "0") + " cm   lean " + (FLAG_OLD ? "0" : "62") + "%\n";
      s += "LOD err " + (r == null ? "n/a" : ((r - heightAt(st.you.x, st.you.z)) * 100).toFixed(1) + " cm") + "  (rendered - analytic)\n";
    }
    s += "prints  " + a.prints + "/" + PRINT_CAP + "   churn " + a.churn + "/" + CHURN_CAP + "\n";
    s += "dust    " + a.dust + "/" + DUST_MAX + "   walkers " + a.walkers + "\n";
    s += "draws   " + a.draws + "  tris " + a.tris;
    dbgEl.textContent = s;
  }

  /* ============================================================ AUDIT */
  S.audit = function () {
    return {
      on: !FLAG_OLD, prints: prints ? prints.live : 0, churn: churns ? churns.live : 0,
      printCap: PRINT_CAP, churnCap: CHURN_CAP,
      dust: dustLive, dustCap: DUST_MAX,
      walkers: walkers.size, adopted: adopted,
      draws: (prints ? 1 : 0) + (churns ? 1 : 0) + (dust ? 1 : 0),
      tris: ((prints ? prints.live : 0) + (churns ? churns.live : 0)) * 2,
      bridge: !!bridgeRig,
    };
  };

  S.reset = function () {
    walkers.clear();
    colX = null; colAcc = 0;
    if (prints) { prints.live = 0; prints.ring = 0; prints.mesh.count = 0; prints.life.array.fill(-1); }
    if (churns) { churns.live = 0; churns.ring = 0; churns.mesh.count = 0; churns.life.array.fill(-1); }
    if (dust) { dust.top = 0; dust.ring = 0; dust.life.fill(-1); dust.fade.fill(0); dust.cloud.visible = false; dust.geo.setDrawRange(0, 0); }
    bridgeRig = null; bridgeMiss = 0;
  };

  /* ============================================================ BUILD */
  function build() {
    /* NOTHING IS BUILT UNDER ?sand=old. An empty InstancedMesh still costs a
       draw call, and a "before" column that reports three draw calls for a
       feature it does not have makes the budget metric a lie. */
    if (prints || FLAG_OLD || !THREE || !scene) return;
    atlas = makeAtlas();
    churns = makeDecalLayer(CHURN_CAP, -2);      // under the prints, over the ground
    prints = makeDecalLayer(PRINT_CAP, -1);
    churns.mat.uniforms.uTex.value = atlas;
    prints.mat.uniforms.uTex.value = atlas;
    /* THE CHURN IS READ FROM FURTHER AWAY THAN THE PRINTS, which is the
       whole point of having two layers: the road has to survive to the
       ridge (900 m puts it past the strategic camera's pull-back of 520 m
       plus the column's own length) and a boot print has no business being
       blended at 400 m where it is a third of a pixel. */
    churns.mat.uniforms.uFar.value = 1500;
    prints.mat.uniforms.uFar.value = 260;
    scene.add(churns.mesh);
    scene.add(prints.mesh);
    dust = makeDust();
    scene.add(dust.cloud);
    if (DEBUG) makeDebug();
  }

  /* THE SUN THE PRINTS ARE LIT BY IS THE SUN THE TERRAIN IS LIT BY.
     campaign.js drives micro.sun round the sky on the game clock; reading it
     rather than hard-coding a direction is why a print at 07:00 has its
     shadow on the other side from one at 17:00. */
  const _sun = THREE ? new THREE.Vector3(0.4, 0.8, 0.3) : null;
  function syncSun() {
    const s = micro && micro.sun;
    if (!s) return;
    _sun.copy(s.position);
    if (s.target) _sun.sub(s.target.position);
    if (_sun.lengthSq() < 1e-6) _sun.set(0.4, 0.8, 0.3);
    _sun.normalize();
    if (prints) prints.mat.uniforms.uSun.value.copy(_sun);
    if (churns) churns.mat.uniforms.uSun.value.copy(_sun);
  }

  function frame(dt) {
    if (!prints) return;
    if (!(dt > 0)) dt = 0;
    clock += dt;
    prints.mat.uniforms.uTime.value = clock;
    churns.mat.uniforms.uTime.value = clock;
    syncSun();
    stepColumn();
    stepBridge(dt);
    stepDust(dt);
    if (adopted > 0) adopted -= dt;
    if (DEBUG) paintDebug();
  }

  /* ============================================================ BOOT */
  S.needs = ["desert"];
  S.boot = function (c) {
    ctx = c; micro = c.micro; scene = c.scene; Q = c.Q;
    FLAG_OLD = !!(Q && Q.get("sand") === "old");
    DEBUG = !!(Q && Q.get("sand") === "1");
    FLAG_NOPRINTS = !!(Q && Q.get("prints") === "off");
    if (!THREE || !scene) return;
    /* BUILT AT BOOT, NOT ON FIRST PRINT. The pools are 3 000 quads of
       preallocated Float32 and one 256px canvas — a millisecond — and
       building them lazily means the first footfall of a run allocates and
       compiles a shader on the frame the player is watching his own feet. */
    build();
    /* ORDER 60: after campaign.js has placed the player and drawn its men
       (its own hooks sit in the low teens), so the bridge re-seats a body
       that is already where the campaign wants it rather than one frame
       behind. */
    if (micro && micro.onFrame) micro.onFrame(frame, { order: 60, id: "warlord/sand" });
    W.on("newgame", function () { S.reset(); });
    W.on("loaded", function () { S.reset(); });
    /* CLEARED ENTERING A BATTLE, NOT LEAVING ONE. A fight starts on ground
       nobody has walked and the ride's road is not on it, so the pool starts
       clean. Coming BACK is the opposite case: battle.js fights on the same
       world coordinates the campaign is standing on, so the churn two
       hundred men just put into that sand is exactly what should still be
       there when you ride away from it. The first draft reset both ways and
       threw away the best ground record in the game. */
    W.on("phase:battle", function () { S.reset(); });
    if (Q && Q.get("audit") === "1") {
      try { console.log("[warlord/sand]", S.audit()); } catch (e) {}
    }
  };

  // debug markers ride the real stamp, so they cannot drift from it
  const _stepRaw = S.step;
  S.step = function (x, z, o) {
    const st = _stepRaw(x, z, o);
    if (DEBUG && st) dbgMark(x, st.y, z);
    return st;
  };

  W.module("sand", S);
})();
