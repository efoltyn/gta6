/* ============================================================
   world/forestlook.js — WHAT A FOREST LOOKS LIKE, IN ONE PLACE.

   OWNER REFERENCE (coastal Alaska photographs, 2026-08-03). Four claims,
   and every one of them was previously re-typed, badly, per biome:

     1. A wood is a CARPET, not a scatter. On valley floors and lower slopes
        the crowns touch: the terrain reads as bumps in the canopy, never as
        gaps between lollipops.
     2. A wood is TWO SILHOUETTES in PATCHES. Rounded broadleaf puffs sweep
        across the low ground; darker conifer SPIRES stand above them in
        clusters. Never an even alternation — clusters and sweeps.
     3. A wood is MANY GREENS. Almost-chartreuse fresh growth low down and on
        sunlit faces, mid greens, very dark blue-green conifer stands, and
        shadowed canopy. That spread is what separates a forest from green
        paint, and it is the single cheapest thing on this list.
     4. A wood ENDS GRADUALLY. Closed canopy -> broken clumps and fingers
        running up the gullies -> scattered krummholz scrub -> open meadow.
        A hard treeline altitude is the tell of a generated world.

   WHY A BLOCK AND NOT FOUR MORE PRIVATE COPIES (the Block Law). Before this
   file, `city/continent.js` typed one green ramp, `city/biome_forest.js`
   typed three more, `city/biome_snow.js` a fifth — none agreed, none knew
   about slope, aspect, altitude or a stand mask, and a fifth forest builder
   would have typed a sixth. This REPLACES the line each caller already wrote
   (`col.setRGB(...)`, a density constant, a treeline test) rather than adding
   bookkeeping beside it, and every entry point is degrade-safe: with the flag
   off, or this file absent, callers keep their own inline value.

   DETERMINISM. Everything here is a pure function of world position through
   `CBZ.hash01` — never `Math.random`, never a draw on a caller's sequential
   `rng()` stream. A caller may PASS its own draws in (`opts.j0..j2`) when it
   must not change its stream's shape; nothing here consumes one.

   Flags (declared here, not config.js — see the Edit-race note in
   scrolls/claude/verification.md):
     FOREST_LOOK             master; off = every caller's legacy inline value
     FOREST_SPECIES_MIX      conifer spires among the broadleaf
     FOREST_CANOPY_CARPET    stand mask + closure-driven density
     FOREST_ALPINE_GRADIENT  altitude thinning, gully fingers, krummholz

   Ratchet: CBZ.forestLookAudit() -> { sites, tinted, species, closure,
   legacy, legacySites }. `legacy` counts foliage colours still hand-typed by
   a vegetation builder and MAY ONLY GO DOWN.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.FOREST_LOOK == null) CFG.FOREST_LOOK = true;
  if (CFG.FOREST_SPECIES_MIX == null) CFG.FOREST_SPECIES_MIX = true;
  if (CFG.FOREST_CANOPY_CARPET == null) CFG.FOREST_CANOPY_CARPET = true;
  if (CFG.FOREST_ALPINE_GRADIENT == null) CFG.FOREST_ALPINE_GRADIENT = true;

  const stats = { tinted: 0, species: 0, closure: 0, legacy: 0, sites: {}, legacySites: {} };
  function note(bag, site) { if (!site) return; bag[site] = (bag[site] || 0) + 1; }

  const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
  function smooth(v, a, b) {            // smoothstep with an explicit edge pair
    if (b === a) return v >= b ? 1 : 0;
    const t = clamp01((v - a) / (b - a));
    return t * t * (3 - 2 * t);
  }
  function h01(x, z, salt) {
    return CBZ.hash01 ? CBZ.hash01(x, z, salt) : 0.5;
  }
  // Smooth value noise off the position hash. Order-independent by
  // construction, so adding or removing a call anywhere shifts nothing.
  function vnoise(x, z, cell, salt) {
    const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
    const fx = x / cell - ix, fz = z / cell - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = h01(ix * cell, iz * cell, salt);
    const b = h01((ix + 1) * cell, iz * cell, salt);
    const c = h01(ix * cell, (iz + 1) * cell, salt);
    const d = h01((ix + 1) * cell, (iz + 1) * cell, salt);
    const top = a + (b - a) * sx, bot = c + (d - c) * sx;
    return top + (bot - top) * sz;
  }
  // Two octaves where one field has to carry both a sweep and a clump.
  function vnoise2(x, z, cell, salt) {
    return vnoise(x, z, cell, salt) * 0.68 + vnoise(x, z, cell * 0.37, salt + 7) * 0.32;
  }

  const ON = () => CFG.FOREST_LOOK !== false;

  /* ---- SPECIES ---------------------------------------------------------
     The conifer mask is deliberately LOW frequency with a hard-ish edge:
     spruce comes in stands. `patch` is the raw field (0 broadleaf sweep ..
     1 conifer stand) so a caller can bias crown height with it and get the
     ragged skyline a real mixed wood has. A single tree at the seam is
     decided by the same field plus its own hash, so the boundary is broken
     rather than drawn with a ruler.
  --------------------------------------------------------------------- */
  function species(x, z, opts) {
    opts = opts || {};
    if (!ON() || CFG.FOREST_SPECIES_MIX === false) return { conifer: false, patch: 0, spire: 0 };
    stats.species++; note(stats.sites, opts.site);
    // 620 m stands with a 230 m sub-octave: sweeps big enough to fly over,
    // clumps small enough to walk around.
    const patch = vnoise2(x, z, 620, 4411);
    // High ground and steep, poor ground favour conifer — the ecology reason
    // the reference's spires cluster up the slopes and in the cold hollows.
    const alt = clamp01(opts.alt == null ? 0 : opts.alt);
    const bias = patch + alt * 0.26 + (opts.coniferBias || 0);
    const die = h01(x, z, 4412);
    // A soft threshold, and the FLOOR is the point: a broadleaf sweep still
    // carries the odd spruce (0.10) and a conifer stand is still not a
    // plantation (0.82 at most), so neither species ever forms a clean edge.
    // The individual tree's own hash decides inside those bounds, which is
    // what breaks the seam between two stands.
    const p = clamp01(0.10 + 0.62 * smooth(bias, 0.46, 0.78));
    return { conifer: die < p, patch: patch, spire: p };
  }

  /* ---- COLOUR ----------------------------------------------------------
     Writes into a THREE.Color the caller already owns (no allocation, no
     THREE dependency here). The ranges are the reference read as numbers:

       broadleaf  fresh 1 -> (0.50, 0.72, 0.20)  almost chartreuse
                  fresh 0 -> (0.13, 0.33, 0.10)  deep shadowed leaf
       conifer            -> (0.06..0.17, 0.17..0.36, 0.14..0.28) blue-green

     `fresh` is not a dice roll: it is a low-frequency growth field times sun
     exposure times a low-altitude bonus, and only THEN a per-tree jitter. A
     forest whose greens are pure noise looks like static; the reference's
     greens move in sweeps because light and ground move in sweeps.
  --------------------------------------------------------------------- */
  const SUN_AZ = -2.05;                  // fixed bake azimuth (see note below)
  const SUNX = Math.sin(SUN_AZ), SUNZ = Math.cos(SUN_AZ);

  function sunFace(opts) {
    // Aspect term from the caller's own slope gradient, if it has one. The
    // azimuth is a CONSTANT on purpose: this is a baked instance colour, and
    // keying it to the live sun would make the world's greens depend on what
    // o'clock the build ran at (i.e. non-deterministic across clients).
    if (!opts || opts.gx == null || opts.gz == null) return 0.5;
    const gx = opts.gx, gz = opts.gz;
    const m = Math.sqrt(gx * gx + gz * gz);
    if (!(m > 1e-6)) return 0.5;
    // gradient points UPHILL; a face is lit when its downhill normal faces the sun
    const dot = (-gx / m) * SUNX + (-gz / m) * SUNZ;
    const steep = clamp01(m / 0.7);
    return clamp01(0.5 + dot * 0.5 * steep);
  }

  function tint(color, x, z, opts) {
    opts = opts || {};
    if (!color) return color;
    if (!ON()) return color;
    stats.tinted++; note(stats.sites, opts.site);
    const alt = clamp01(opts.alt == null ? 0 : opts.alt);
    const jit = opts.j0 == null ? h01(x, z, 4421) : clamp01(opts.j0);
    const jit2 = opts.j1 == null ? h01(x, z, 4422) : clamp01(opts.j1);
    const sun = opts.sun == null ? sunFace(opts) : clamp01(opts.sun);
    // shade: a tree inside a closed stand is darker than one at the edge
    const closed = clamp01(opts.closure == null ? 0.5 : opts.closure);

    if (opts.conifer) {
      // Dark, cool, and much narrower in range than the broadleaf — a spruce
      // stand reading as one mass IS the reference. It must still be GREEN:
      // a first pass at these numbers rendered the spires as black cutouts,
      // which is a silhouette, not a species.
      const c = jit * 0.62 + vnoise(x, z, 300, 4423) * 0.38;
      const lift = 0.82 + sun * 0.30 - closed * 0.12;
      color.setRGB(
        (0.105 + c * 0.100) * lift,
        (0.255 + c * 0.205 - alt * 0.035) * lift,
        (0.190 + c * 0.130) * lift
      );
      return color;
    }

    // BROADLEAF. growth field (sweeps) x light x low ground, then jitter.
    // The bright chartreuse is deliberately the MINORITY: it is what fresh
    // growth on a sunlit face looks like, and a wood painted entirely in it
    // reads as a lawn seen from above. Most of the canopy sits mid-green and
    // the sweeps are what the eye picks up.
    let fresh = vnoise2(x, z, 480, 4424) * 0.55 + sun * 0.22 + (1 - alt) * 0.10;
    fresh = clamp01(fresh * (0.72 + jit * 0.50) - closed * 0.08);
    const f2 = fresh * fresh;
    const shade = 0.86 + jit2 * 0.24;
    color.setRGB(
      (0.105 + f2 * 0.360) * shade,
      (0.255 + fresh * 0.400) * shade,
      (0.085 + f2 * 0.100) * shade
    );
    return color;
  }

  function bark(color, x, z, opts) {
    opts = opts || {};
    if (!color || !ON()) return color;
    const j = opts.j0 == null ? h01(x, z, 4431) : clamp01(opts.j0);
    // Conifer bark is greyer and darker; broadleaf (alder/birch) runs pale.
    if (opts.conifer) { const b = 0.20 + j * 0.13; color.setRGB(b, b * 0.80, b * 0.66); return color; }
    const b = 0.30 + j * 0.30;
    color.setRGB(b, b * (0.70 + j * 0.10), b * (0.52 + j * 0.14));
    return color;
  }

  /* ---- CANOPY CLOSURE --------------------------------------------------
     0 = open ground, 1 = crowns touching. This is the number a placement
     loop multiplies its per-cell tree count by, so "denser valleys" and
     "fingers up the gullies" are one expression instead of five thresholds.

     opts: relief (height at the sample), top (the tallest relief this
     builder can produce — the caller measures it once), slope (rise/run),
     curv (positive = convex ridge, negative = concave gully; optional),
     cover (biome name) and weight (that biome's blend weight).
  --------------------------------------------------------------------- */
  const COVER = { forest: 1.0, snow: 0.66, wilds: 0.95, farmland: 0.34, desert: 0.0 };

  function closure(x, z, opts) {
    opts = opts || {};
    if (!ON() || CFG.FOREST_CANOPY_CARPET === false) return opts.legacy == null ? 0 : opts.legacy;
    stats.closure++; note(stats.sites, opts.site);
    const w = opts.weight == null ? 1 : clamp01(opts.weight);
    let base = opts.cover && COVER[opts.cover] != null
      ? (COVER.wilds + (COVER[opts.cover] - COVER.wilds) * w)
      : COVER.wilds;
    if (base <= 0) return 0;

    // THE STAND MASK — the difference between a forest and green sprinkles.
    // Two octaves so a stand has both a shape and a ragged edge.
    const stand = vnoise2(x, z, 760, 4441);
    const standK = smooth(stand, 0.30, 0.52);

    // ALTITUDE. Thinning starts at ~45% of the builder's own relief ceiling
    // and is complete near the top — the fraction, never a metre constant,
    // so a taller world thins in the same PLACES rather than at the same
    // height (this is what keeps the law true when terrain work lands).
    let altK = 1;
    const top = opts.top == null ? 0 : opts.top;
    const altN = top > 1 ? clamp01((opts.relief || 0) / top) : 0;
    if (CFG.FOREST_ALPINE_GRADIENT !== false && top > 1) {
      // GULLY FINGERS: a concave draw is wetter, sheltered and holds soil, so
      // the wood runs UP it after the open slope beside it has given out.
      const gully = clamp01(-(opts.curv || 0) * 2.2);
      const hi = 0.86 + gully * 0.26;
      altK = 1 - smooth(altN, 0.44 + gully * 0.22, hi);
    }

    // SLOPE. A ridge face sheds soil; it thins before the top does.
    const slopeK = 1 - smooth(opts.slope == null ? 0 : opts.slope, 0.55, 1.05);

    // The floor (0.10) is the lone tree in a meadow; the ceiling is a closed
    // stand. A wood that never reaches 1 is a wood you can always see the
    // ground through, which is the exact complaint the reference answers.
    const c = base * (0.10 + 1.02 * standK) * altK * slopeK;
    return clamp01(c);
  }

  // What grows here at all: closed canopy, the scrub band above it, or
  // nothing. The scrub band is the reference's krummholz — the thing that
  // makes a treeline a gradient instead of a line.
  function storey(x, z, c, opts) {
    opts = opts || {};
    if (!ON()) return c > 0 ? "canopy" : "none";
    if (c >= 0.20) return "canopy";
    if (CFG.FOREST_ALPINE_GRADIENT === false) return c > 0 ? "canopy" : "none";
    // Scrub survives where a tree just failed — including above the wood,
    // which is why it keys off the same closure the trees used.
    const die = h01(x, z, 4451);
    if (c > 0.015 && die < 0.28 + c * 2.4) return "scrub";
    return "none";
  }

  // Convenience for a placement loop: how many stems a cell of `cell` metres
  // should carry at this closure, given the crown radius the caller draws.
  // Derived, not tasted: closure 1 means crowns touch, i.e. one crown per
  // (1.55 r)^2 of ground, and the caller's own crown radius sets the pitch.
  function stems(x, z, c, cell, crownR, salt) {
    if (!(c > 0)) return 0;
    const pitch = Math.max(3, 1.5 * (crownR || 7));
    const full = (cell * cell) / (pitch * pitch);
    const n = full * c * c;                       // squared: closure closes fast at the end
    const f = Math.floor(n);
    return f + (h01(x, z, salt || 4461) < (n - f) ? 1 : 0);
  }

  function legacy(site) { stats.legacy++; note(stats.legacySites, site); }

  CBZ.forestLook = {
    species: species, tint: tint, bark: bark, closure: closure,
    storey: storey, stems: stems, noise: vnoise2, legacy: legacy,
  };
  // One-word adoption aliases — a caller replacing a `col.setRGB(...)` line
  // should not have to reach through an object literal to do it.
  CBZ.forestTint = tint;
  CBZ.forestSpecies = species;
  CBZ.forestClosure = closure;
  CBZ.forestLookAudit = function () {
    return {
      tinted: stats.tinted,             // foliage colours issued through the block
      species: stats.species,           // species decisions taken through it
      closure: stats.closure,           // closure queries answered
      legacy: stats.legacy,             // hand-typed foliage colours LEFT — may only go DOWN
      sites: stats.sites,
      legacySites: stats.legacySites,
      on: ON(),
      mix: CFG.FOREST_SPECIES_MIX !== false,
      carpet: CFG.FOREST_CANOPY_CARPET !== false,
      alpine: CFG.FOREST_ALPINE_GRADIENT !== false,
    };
  };
})();
