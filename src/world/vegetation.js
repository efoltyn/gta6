/* ============================================================
   world/vegetation.js — shared scenery-scale vegetation geometry.

   A tree is not a green marker standing on the ground. Playable biomes use
   this file for the reusable visual grammar — mature wood, irregular crowns,
   detached canopy roof and opaque thicket mass — while each biome keeps its
   own ecology, trails, clearings and deterministic placement.

   The archetypes are authored in METRES, not one-unit toy shapes. That makes
   their intended scale inspectable and prevents every consumer inventing a
   different "tree-sized" multiplier. They remain low-poly closed meshes so
   instanceColor, Lambert light and the existing static batching path work in
   Three r128 without alpha sorting or a new texture dependency.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.SCENERY_VEGETATION == null) CFG.SCENERY_VEGETATION = true;
  // VEG_VARIANTS — see "NO TWO TREES ARE THE SAME MESH" below. Off → every
  // archetype has exactly one variant and every consumer gets the geometry it
  // always got, byte for byte.
  if (CFG.VEG_VARIANTS == null) CFG.VEG_VARIANTS = true;
  // VEG_VARIANT_MAX — the ceiling on variants per archetype at full quality.
  // The live count is quality-scaled through CBZ.qScale (1 at tier 0), because
  // a variant costs one InstancedMesh per consumer that splits per instance.
  if (CFG.VEG_VARIANT_MAX == null) CFG.VEG_VARIANT_MAX = 3;

  const cache = Object.create(null);
  const mats = Object.create(null);
  const UP = new THREE.Vector3(0, 1, 0);

  function merged(parts, fallback) {
    const fn = THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeBufferGeometries;
    let out = null;
    if (fn) out = fn(parts, false);
    if (!out) out = fallback || parts[0];
    for (let i = 0; i < parts.length; i++) if (parts[i] !== out && parts[i].dispose) parts[i].dispose();
    return out;
  }

  function cylinderBetween(a, b, r0, r1, sides) {
    const av = new THREE.Vector3(a[0], a[1], a[2]);
    const bv = new THREE.Vector3(b[0], b[1], b[2]);
    const dir = bv.clone().sub(av), len = dir.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, sides || 5);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
    g.translate((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5);
    return g;
  }

  function lobe(x, y, z, sx, sy, sz) {
    const g = new THREE.IcosahedronGeometry(1, 0);
    g.scale(sx, sy, sz); g.translate(x, y, z);
    return g;
  }

  // A baked underside-to-crown ramp gives a mass depth even when thousands of
  // instances share one material. r128 multiplies vertex color by instanceColor.
  function shadeByHeight(g, floor, power) {
    g.computeBoundingBox();
    const p = g.attributes.position, y0 = g.boundingBox.min.y, dy = Math.max(0.001, g.boundingBox.max.y - y0);
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const t = Math.max(0, Math.min(1, (p.getY(i) - y0) / dy));
      const v = floor + (1 - floor) * Math.pow(t, power || 0.72);
      c[i * 3] = v; c[i * 3 + 1] = v; c[i * 3 + 2] = v;
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }

  function matureWood() {
    const parts = [];
    // 20m fluted bole. The clear lower two thirds is deliberate: at player
    // height this reads as architecture and depth, not a person-shaped icon.
    const bole = new THREE.CylinderGeometry(0.34, 0.82, 20, 7);
    bole.translate(0, 10, 0); parts.push(bole);
    // Four grounded buttress roots. These are real-metre geometry so the roots
    // stay broad and low when the whole archetype is uniformly scaled.
    const roots = [[2.7, 0.22, 0], [-2.7, 0.22, 0], [0, 0.22, 2.7], [0, 0.22, -2.7]];
    for (let i = 0; i < roots.length; i++) parts.push(cylinderBetween([0, 0.34, 0], roots[i], 0.48, 0.10, 5));
    // Crown-bearing limbs start high and fork asymmetrically. They are visual;
    // collision remains the central timber proxy in biome owners.
    const limbs = [
      [[0, 11.8, 0], [3.9, 16.2, 1.2], 0.34, 0.15],
      [[0, 12.7, 0], [-3.2, 17.1, -1.8], 0.32, 0.14],
      [[0, 14.0, 0], [1.0, 18.8, -3.5], 0.28, 0.12],
      [[0, 14.8, 0], [-1.5, 19.4, 3.0], 0.27, 0.11],
    ];
    for (let i = 0; i < limbs.length; i++) {
      const b = limbs[i]; parts.push(cylinderBetween(b[0], b[1], b[2], b[3], 5));
    }
    const g = shadeByHeight(merged(parts, bole), 0.52, 0.8);
    g.name = "cbz-mature-tree-wood";
    g.userData.vegetationArchetype = "mature-wood";
    return g;
  }

  function matureCrown() {
    const parts = [
      lobe(0.0, 5.2, 0.0, 6.4, 5.2, 6.1),
      lobe(-4.5, 5.4, 0.8, 4.6, 4.2, 4.7),
      lobe(4.4, 5.9, -0.9, 4.9, 4.5, 4.2),
      lobe(-0.8, 8.5, 3.7, 4.8, 4.2, 4.5),
      lobe(1.2, 9.0, -3.6, 4.2, 3.8, 4.6),
    ];
    const g = shadeByHeight(merged(parts, parts[0]), 0.40, 0.62);
    // Seat the lowest lobe on y=0; every caller can place the crown by its base.
    g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0);
    shadeByHeight(g, 0.40, 0.62);
    g.name = "cbz-mature-tree-crown";
    g.userData.vegetationArchetype = "mature-crown";
    return g;
  }

  function landscapeWood() {
    // The continent carries roughly ten thousand trees across the whole
    // country. Its far/mid storey keeps the same 20m authored scale, but uses
    // a single fluted bole: matureWood's buttresses and fork limbs are close
    // detail that would multiply millions of invisible vertices outside the
    // player's current district.
    //
    // OPEN-ENDED, and it is not a detail at this count: the top disc lives
    // inside the crown and the bottom disc is buried below the seat line
    // (every consumer seats a trunk under the LOWEST sample beneath its
    // footprint), so both caps are hidden BY CONSTRUCTION. Dropping them
    // halves the bole from 24 triangles to 12 — across a country-scale
    // canopy that is worth more than any shading trick on the same mesh.
    const g = new THREE.CylinderGeometry(0.34, 0.76, 20, 6, 1, true);
    g.translate(0, 10, 0);
    shadeByHeight(g, 0.50, 0.82);
    g.name = "cbz-landscape-tree-wood";
    g.userData.vegetationArchetype = "landscape-wood";
    return g;
  }

  function landscapeCrown() {
    // Three offset masses keep the silhouette asymmetric without paying the
    // five-lobe mature-tree budget at every 46m backcountry cell.
    const parts = [
      lobe(0.0, 5.0, 0.0, 6.3, 5.0, 5.9),
      lobe(-3.9, 6.3, 1.1, 4.2, 4.0, 4.4),
      lobe(3.7, 7.2, -1.2, 4.4, 4.2, 4.0),
    ];
    const g = shadeByHeight(merged(parts, parts[0]), 0.39, 0.64);
    g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0); shadeByHeight(g, 0.39, 0.64);
    g.name = "cbz-landscape-tree-crown";
    g.userData.vegetationArchetype = "landscape-crown";
    return g;
  }

  function subcanopy() {
    const parts = [
      lobe(0, 2.7, 0, 3.5, 2.7, 3.3),
      lobe(-2.0, 3.6, 0.4, 2.5, 2.4, 2.6),
      lobe(2.1, 3.5, -0.6, 2.7, 2.3, 2.4),
    ];
    const g = shadeByHeight(merged(parts, parts[0]), 0.36, 0.68);
    g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0); shadeByHeight(g, 0.36, 0.68);
    g.name = "cbz-subcanopy-crown";
    g.userData.vegetationArchetype = "subcanopy";
    return g;
  }

  function canopyPatch() {
    // Detached roof mass: no trunk is implied. Broad, shallow, overlapping
    // shapes close the sky between real trees without manufacturing colliders.
    const parts = [
      lobe(0, 2.2, 0, 5.2, 2.2, 5.0),
      lobe(-3.8, 2.7, 1.5, 3.8, 2.3, 3.7),
      lobe(3.7, 2.8, -1.2, 4.0, 2.4, 3.5),
      lobe(0.7, 3.4, 3.6, 3.7, 2.2, 3.5),
    ];
    const g = shadeByHeight(merged(parts, parts[0]), 0.31, 0.58);
    g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0); shadeByHeight(g, 0.31, 0.58);
    g.name = "cbz-canopy-roof-patch";
    g.userData.vegetationArchetype = "canopy-patch";
    return g;
  }

  function thicket() {
    // Coarse opaque middle-distance mass. Fewer large faceted lobes survive
    // minification better than hundreds of sub-pixel fern cards.
    const parts = [
      lobe(0, 1.6, 0, 2.5, 1.6, 2.1),
      lobe(-2.0, 1.8, 0.6, 1.8, 1.8, 1.6),
      lobe(2.0, 1.5, -0.5, 1.9, 1.5, 1.8),
      lobe(0.5, 2.5, 1.0, 1.6, 1.8, 1.5),
    ];
    const g = shadeByHeight(merged(parts, parts[0]), 0.28, 0.75);
    g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0); shadeByHeight(g, 0.28, 0.75);
    g.name = "cbz-forest-thicket";
    g.userData.vegetationArchetype = "thicket";
    return g;
  }

  // ---- THE SECOND SILHOUETTE -------------------------------------------
  // OWNER REFERENCE (coastal Alaska): the rounded crowns above are only half
  // a forest. The other half is the spruce SPIRE that stands through the
  // broadleaf roof, and a wood with one silhouette reads as a crop. Built
  // through the ONE TREE GRAMMAR (world/treeaudit.js §2) rather than as a
  // fourth private cone stack, so it lands in CBZ.treeGrammarAudit() and
  // inherits the whorl/bite solve that keeps a crown support-connected.
  function coniferSpire() {
    const H = 23, R = 3.15;
    let g = null;
    if (CBZ.treeCrownGeo) {
      // 4 whorls, slow taper, deep bite: a narrow column of foliage rather
      // than the 2-whorl broadleaf cone. seg 5 keeps a 23 m tree at 40 tris,
      // which is what makes a country-wide conifer storey affordable.
      g = CBZ.treeCrownGeo({
        tiers: 4, r: R, h: H, seg: 5, taper: 0.80, hRatio: 0.92, bite: 0.30,
        ao: true, aoLow: 0.42, site: "vegetation-kit",
      });
    }
    if (!g) { g = new THREE.ConeGeometry(R, H, 5); g.translate(0, H / 2, 0); shadeByHeight(g, 0.42, 0.7); }
    g.name = "cbz-conifer-spire";
    g.userData.vegetationArchetype = "conifer-spire";
    return g;
  }

  // ---- THE CARPET FILLER — REMOVED 2026-08-04 ---------------------------
  // `canopyDome()` lived here: one 20-triangle squashed lobe used as a crown
  // with no tree under it, so a wood could close its canopy without paying a
  // trunk + collider + audit chain per square metre. city/continent.js flew
  // 57,694 of them at ground + 7..14 m and the owner photographed the result
  // from a beach: green boulders hanging in the sky over open ground.
  //
  // The archetype is deleted rather than left unused because an unused
  // geometry is an invitation. A canopy filler is only honest where the
  // ground under it is already full of real stems — biome_forest.js's flat
  // y=0 plate qualifies and keeps its roof; RELIEF does not. Close a wood on
  // relief with stems or with wider crowns on the stems it has.

  // ---- KRUMMHOLZ --------------------------------------------------------
  // The scrub band between the last tree and the open meadow. Deliberately
  // the thicket mass at a third of the size: a wind-flagged alpine shrub is
  // exactly a low, dense, sprawling version of the same thing, and authoring
  // a fifth blob family for it would be the parallel-system trap.
  function krummholz() {
    const parts = [
      lobe(0, 0.62, 0, 1.5, 0.62, 1.3),
      lobe(-1.1, 0.52, 0.35, 1.0, 0.50, 0.95),
      lobe(1.0, 0.46, -0.30, 1.05, 0.44, 1.0),
    ];
    const g = shadeByHeight(merged(parts, parts[0]), 0.30, 0.80);
    g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0); shadeByHeight(g, 0.30, 0.80);
    g.name = "cbz-krummholz";
    g.userData.vegetationArchetype = "krummholz";
    return g;
  }

  const builders = {
    "mature-wood": matureWood,
    "mature-crown": matureCrown,
    "landscape-wood": landscapeWood,
    "landscape-crown": landscapeCrown,
    subcanopy: subcanopy,
    "canopy-patch": canopyPatch,
    "conifer-spire": coniferSpire,
    krummholz: krummholz,
    thicket: thicket,
  };

  /* ======================================================================
     NO TWO TREES ARE THE SAME MESH — the variant set.

     Until now this file published exactly ONE geometry per archetype, so
     every mature crown in Redhollow, every canopy across the whole
     Backcountry and every conifer on the massif was the SAME five lobes,
     varied only by rotation and scale. That is the oldest tell of a
     generated world and the reason a wood reads as a crop: the eye finds
     the repeat long before it can name it.

     THE SHAPE OF THE FIX IS NOT "GROW A UNIQUE TREE PER INSTANCE". This
     renderer draws vegetation as InstancedMesh — one geometry, thousands of
     matrices — so per-instance meshes would cost thousands of draw calls.
     The affordable form is a small VARIANT SET: K structurally different
     crowns per archetype, dealt out by a POSITION hash, so a stand is a mix
     and a consumer pays K draw calls instead of one. K is quality-scaled and
     is 1 at tier 0, where the whole question is invisible anyway.

     THE GRAMMAR. A crown is a core lobe over the trunk axis plus arms placed
     on a golden-angle spiral, their length set by a CROWN ENVELOPE (the
     radius profile of the species read as a function of height) and skewed
     by a per-variant LIGHT-COMPETITION bias, so one flank carries the long
     arms exactly as a real tree that grew beside a gap does. Same idea the
     branching grammar in treeaudit.js uses one level down.

     TWO INVARIANTS, both load-bearing, both enforced by normalise():
       1. EVERY VARIANT SHARES VARIANT 0's BOUNDING BOX. Consumers scale a
          crown by (folR, folH, folR) and seat it at folY; the tree CONNECTION
          LAW (TREES_V2, world/treeaudit.js) then proves the canopy AABB
          overlaps the trunk's. A variant that were taller or wider would
          silently break both. So each variant is scaled to the archetype's
          nominal height and radius after growth.
       2. EVERY VARIANT COVERS ITS OWN AXIS. The core lobe is centred on
          (0, ·, 0) with a radius of at least ~0.2 R, which is far wider than
          any trunk this kit publishes — a crown can never end up hovering
          beside its own bole.
     Variant 0 is the hand-authored arrangement each archetype already
     shipped, untouched, so flag-off and tier-0 are the old world exactly.

     TRUNKS ARE DELIBERATELY NOT VARIED. `mature-wood` / `landscape-wood`
     size the BIOME_SOLID_TRUNKS collider from the geometry's own base radius
     (CBZ.treeGeoBounds), so a per-variant bole would need a per-variant
     collider radius threaded through four biome owners. A crown is where the
     silhouette lives; the bole is a cylinder at every distance that matters.
  ====================================================================== */

  // Which archetypes can be grown, and the nominal box every variant of them
  // must land in. `shape` picks the envelope; `n` is the base arm count.
  const VARIABLE = {
    "mature-crown":    { r: 9.3,  h: 12.8, n: 5, shape: "dome",      floor: 0.40, pow: 0.62, salt: 0x1a3 },
    "landscape-crown": { r: 8.1,  h: 11.4, n: 3, shape: "dome",      floor: 0.39, pow: 0.64, salt: 0x1a7 },
    subcanopy:         { r: 4.8,  h: 5.9,  n: 3, shape: "ellipsoid", floor: 0.36, pow: 0.68, salt: 0x1ab },
    "canopy-patch":    { r: 7.8,  h: 5.6,  n: 4, shape: "flat",      floor: 0.31, pow: 0.58, salt: 0x1af },
    thicket:           { r: 4.0,  h: 4.3,  n: 4, shape: "irregular", floor: 0.28, pow: 0.75, salt: 0x1b3 },
    krummholz:         { r: 2.15, h: 1.24, n: 3, shape: "flat",      floor: 0.30, pow: 0.80, salt: 0x1b7 },
    // the spire is grown through the ONE TREE GRAMMAR instead of lobes — see
    // spireVariant() — but it is variable all the same.
    "conifer-spire":   { spire: true, r: 3.15, h: 23, salt: 0x1bb },
  };

  // Deterministic per-variant stream. Never Math.random: a variant set that
  // differed between two clients would desync nothing but would make every
  // screenshot comparison a lie.
  function vrng(seed) {
    let s = (seed | 0) >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // CROWN ENVELOPE — radius as a fraction of the crown's widest, at height
  // fraction t (0 = crown base, 1 = crown top). The floor on each keeps the
  // profile from pinching to nothing at the top, where a lobe still has to be
  // wide enough to read.
  function envelope(shape, t) {
    if (t < 0) t = 0; else if (t > 1) t = 1;
    switch (shape) {
      case "cone":      return 0.20 + 0.80 * Math.pow(1 - t, 0.9);
      case "ellipsoid": return Math.max(0.30, Math.sin(Math.PI * (0.10 + 0.86 * t)));
      case "column":    return 0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, t * 1.15));
      case "flat":      return Math.max(0.34, Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.6))));
      case "irregular": return 0.34 + 0.66 * Math.abs(Math.sin(t * 9.7 + 1.3)) * (1 - t * 0.4);
      default:          return Math.max(0.32, Math.sqrt(Math.max(0, 1 - t * t * 0.92)));  // dome
    }
  }

  const GOLDEN = 2.39996323;

  function growCrown(spec, seed) {
    const rnd = vrng(seed);
    const R = spec.r, H = spec.h;
    // arm count wobbles ±1 so variants differ in MASS, not only in placement
    let n = spec.n + (rnd() < 0.42 ? 1 : 0) - (rnd() < 0.28 ? 1 : 0);
    if (n < 2) n = 2;
    // light competition: the flank facing `bias` grew into the gap
    const bias = rnd() * Math.PI * 2;
    const asym = 0.16 + rnd() * 0.30;
    const parts = [];
    // INVARIANT 2 — the core lobe stands on the axis.
    const coreT = 0.28 + rnd() * 0.14;
    const coreR = R * envelope(spec.shape, coreT) * (0.64 + rnd() * 0.12);
    parts.push(lobe(0, H * coreT, 0, coreR, H * (0.32 + rnd() * 0.12), coreR * (0.90 + rnd() * 0.18)));
    let az = rnd() * Math.PI * 2;
    for (let i = 1; i < n; i++) {
      az += GOLDEN + (rnd() - 0.5) * 0.9;                       // phyllotaxis
      const t = Math.min(0.94, Math.max(0.10, 0.20 + (i / n) * 0.66 + (rnd() - 0.5) * 0.14));
      const env = envelope(spec.shape, t);
      const k = 1 + asym * Math.cos(az - bias);                 // the long flank
      const lr = R * env * (0.40 + rnd() * 0.18) * k;
      const off = Math.max(0, R * env * k - lr * 0.60);
      parts.push(lobe(
        Math.cos(az) * off, H * t + (rnd() - 0.5) * H * 0.07, Math.sin(az) * off,
        lr, H * (0.24 + rnd() * 0.14), lr * (0.84 + rnd() * 0.30),
      ));
    }
    return normalise(merged(parts, parts[0]), spec);
  }

  // INVARIANT 1 — seat the crown on y=0 and squeeze it into the archetype's
  // nominal box. Uniform in x/z (an anisotropic squeeze would print an
  // ellipse from above); y independently, because height and spread are
  // separate silhouette facts.
  function normalise(g, spec) {
    g.computeBoundingBox();
    let bb = g.boundingBox;
    const rx = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x));
    const rz = Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z));
    const rad = Math.max(1e-4, Math.max(rx, rz));
    const hgt = Math.max(1e-4, bb.max.y - bb.min.y);
    g.scale(spec.r / rad, spec.h / hgt, spec.r / rad);
    g.computeBoundingBox(); bb = g.boundingBox;
    g.translate(0, -bb.min.y, 0);
    return shadeByHeight(g, spec.floor, spec.pow);
  }

  // The spire keeps its ONE TREE GRAMMAR provenance (treeCrownGeo lands the
  // tip exactly at h with the widest radius exactly r, so INVARIANT 1 holds
  // for free) and varies in the three numbers that actually change a
  // conifer's outline: how many whorls, how fast it tapers, how deep each
  // whorl bites into the one below.
  function spireVariant(spec, seed) {
    const rnd = vrng(seed);
    const g = CBZ.treeCrownGeo && CBZ.treeCrownGeo({
      tiers: 3 + Math.floor(rnd() * 3), r: spec.r, h: spec.h, seg: 5,
      taper: 0.74 + rnd() * 0.13, hRatio: 0.88 + rnd() * 0.08, bite: 0.24 + rnd() * 0.14,
      ao: true, aoLow: 0.42, site: "vegetation-kit",
    });
    if (!g) return null;
    g.name = "cbz-conifer-spire";
    g.userData.vegetationArchetype = "conifer-spire";
    return g;
  }

  // ---- the public variant surface ---------------------------------------
  const counts = Object.create(null);
  function variantCount(kind) {
    if (counts[kind] != null) return counts[kind];
    let k = 1;
    if (CFG.VEG_VARIANTS !== false && VARIABLE[kind]) {
      const hi = Math.max(1, CFG.VEG_VARIANT_MAX | 0);
      k = CBZ.qScale ? Math.round(CBZ.qScale(1, hi)) : hi;
      if (k < 1) k = 1; else if (k > hi) k = hi;
    }
    counts[kind] = k;
    return k;
  }

  // WHICH variant stands here. A pure position hash, so it consumes nothing
  // from any caller's sequential rng stream (adding this call to a builder
  // cannot re-deal a single cabin, trail or animal downstream of it) and two
  // biomes meeting at a border agree about the tree on the seam.
  function variantAt(x, z, kind) {
    const k = variantCount(kind);
    if (k <= 1) return 0;
    const spec = VARIABLE[kind];
    const h = CBZ.hash01 ? CBZ.hash01(x, z, (spec && spec.salt) || 0x1c1) : 0.5;
    const v = Math.floor(h * k);
    return v < 0 ? 0 : (v >= k ? k - 1 : v);
  }

  const usage = Object.create(null);   // site → kind → Set(variant) + count
  function noteUse(site, kind, variant, count) {
    if (!site) return;
    const bySite = usage[site] || (usage[site] = Object.create(null));
    const rec = bySite[kind] || (bySite[kind] = { used: Object.create(null), n: 0 });
    rec.used[variant | 0] = true;
    rec.n += count == null ? 1 : count;
  }

  function geometry(kind, variant) {
    const v = variant == null ? 0 : (variant | 0);
    if (v <= 0 || variantCount(kind) <= 1) {
      if (!cache[kind]) {
        const fn = builders[kind];
        if (!fn) throw new Error("unknown vegetation archetype: " + kind);
        cache[kind] = fn();
      }
      return cache[kind];
    }
    const key = kind + "#" + v;
    if (!cache[key]) {
      const spec = VARIABLE[kind];
      let g = null;
      // salt by BOTH archetype and index: two archetypes must never grow the
      // same variant geometry under a different name.
      const seed = (spec.salt * 2654435761 + v * 0x9e3779b1) | 0;
      if (spec.spire) g = spireVariant(spec, seed);
      else {
        g = growCrown(spec, seed);
        g.name = "cbz-" + kind + "-v" + v;
        g.userData.vegetationArchetype = kind;
      }
      // A generator that could not build (no BufferGeometryUtils, no
      // treeCrownGeo) degrades to variant 0 rather than to a hole in the wood.
      cache[key] = g || geometry(kind, 0);
      cache[key].userData.vegetationVariant = v;
    }
    return cache[key];
  }

  /* THE RATCHET. `cloned` counts SITES that drew a real stand out of a single
     variant while the kit was offering more than one — the exact failure this
     block exists to end, named rather than assumed. It may only go down. */
  const CLONE_MIN = 40;
  function variantAudit() {
    const out = {
      // enabled/tier are reported so a gate can tell "nobody cloned anything"
      // apart from "the variant set was switched off" — a ratchet that cannot
      // see the difference is satisfied by deleting the feature.
      enabled: CFG.VEG_VARIANTS !== false,
      tier: CBZ.qualityLevel == null ? 4 : CBZ.qualityLevel,
      archetypes: 0, variants: 0, sites: 0, instances: 0, cloned: 0, clonedSites: [], byKind: {},
    };
    for (const kind in VARIABLE) {
      out.archetypes++;
      out.byKind[kind] = variantCount(kind);
      out.variants += variantCount(kind);
    }
    for (const site in usage) {
      out.sites++;
      for (const kind in usage[site]) {
        const rec = usage[site][kind];
        out.instances += rec.n;
        let used = 0;
        for (const k in rec.used) if (rec.used[k]) used++;
        if (rec.n >= CLONE_MIN && variantCount(kind) > 1 && used < 2) {
          out.cloned++;
          out.clonedSites.push(site + ":" + kind + " (" + rec.n + " from 1 of " + variantCount(kind) + ")");
        }
      }
    }
    return out;
  }

  function material(kind) {
    const key = /wood$/.test(kind) ? "wood" : (kind === "thicket" ? "thicket" : "foliage");
    if (mats[key]) return mats[key];
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, flatShading: true });
    m.name = "CBZ vegetation " + key; m._shared = true;
    mats[key] = m;
    return m;
  }

  // Small shared assembly seam. Ecology owners provide placement and colour;
  // this owns the repetitive InstancedMesh wiring and publishes the layer so
  // browser QA can inspect scale/count without scraping anonymous scene nodes.
  const layers = (CBZ.vegetationLayers = CBZ.vegetationLayers || []);
  function instanceLayer(root, spec, items) {
    spec = spec || {}; items = items || [];
    if (!root || !items.length) return null;
    const kind = spec.kind || "canopy-patch";
    const mesh = new THREE.InstancedMesh(spec.geometry || geometry(kind), spec.material || material(kind), items.length);
    mesh.name = spec.name || ("vegetation-" + kind);
    mesh.castShadow = !!spec.castShadow;
    mesh.receiveShadow = spec.receiveShadow !== false;
    mesh.frustumCulled = spec.frustumCulled === true;
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    const colors = new Float32Array(items.length * 3);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (spec.transform) spec.transform(dummy, it, i);
      else {
        dummy.position.set(it.x || 0, it.y || 0, it.z || 0);
        dummy.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
        dummy.scale.set(it.sx == null ? (it.s == null ? 1 : it.s) : it.sx,
          it.sy == null ? (it.s == null ? 1 : it.s) : it.sy,
          it.sz == null ? (it.s == null ? 1 : it.s) : it.sz);
      }
      dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      if (spec.color) spec.color(color, it, i);
      else if (it.color != null) color.set(it.color);
      else color.set(0xffffff);
      colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
    }
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.vegetationLayer = kind;
    mesh.userData.sceneryScale = true;
    mesh.userData.instanceCount = items.length;
    if (spec.owner) mesh.userData.vegetationOwner = spec.owner;
    root.add(mesh);
    layers.push(mesh);
    return mesh;
  }

  CBZ.vegetationKit = {
    geometry: geometry,
    material: material,
    instanceLayer: instanceLayer,
    variantCount: variantCount,
    variantAt: variantAt,
    noteUse: noteUse,
    nominal: {
      matureWoodHeight: 20,
      matureCrownBase: 13,
      matureCrownHeight: 14,
      matureCrownRadius: 8.9,
      subcanopyHeight: 7,
      canopyPatchRadius: 7.8,
      thicketHeight: 4.3,
      spireHeight: 23,
      spireRadius: 3.15,
      krummholzHeight: 1.2,
    },
  };
  CBZ.vegetationInstanceLayer = instanceLayer;
  CBZ.vegetationVariantAudit = variantAudit;
})();
