/* ============================================================
   world/treeaudit.js — THE TREE CONNECTION LAW (registry + audit)
                        + THE ONE TREE GRAMMAR (geometry factory, §2).

   §1 is the LAW (a tree may not be physically impossible). §2 is the SHAPE
   (there is exactly one canopy family and one trunk in this game, and the
   trunk has roots). They live together because a builder that plants a tree
   needs both in the same breath, and because §2's geometry is what §1's
   AABBs are measured from — splitting them is how the two drift apart.
   §2 loads THREE lazily and returns null without it, so §1 stays usable in
   any harness that has no renderer.

   OWNER DOCTRINE: trees CAN be retarded simple but they can't be
   PHYSICALLY IMPOSSIBLE — no floating canopies, no trunks hovering off
   the downhill side of a slope, no multi-part tree whose pieces don't
   actually touch. This module is the numeric enforcement of that law:

     • Every vegetation builder (wildnature, biome_forest, biome_snow,
       continent backcountry, desert saguaro, beach palms, park trees,
       island trees, harvest nodes) REGISTERS each planted tree here at
       build time under CBZ.CONFIG.TREES_V2: the seat reference (the
       LOWEST terrain sample under the trunk footprint) plus the world
       AABB of every rigid part (trunk first, then canopy tiers / arms /
       fronds), taken from the SAME instance matrices it renders with.

     • CBZ.treeAudit() walks the registry and applies the AABB-chain
       support invariant copied from tools/demolition-check.mjs's
       FLOATING-GEOMETRY check: part 0 (the trunk) must be GROUNDED
       (AABB bottom at or below the recorded terrain seat), and every
       other part must be transitively connected to it through REAL 3D
       AABB overlaps (positive interpenetration, not knife-edge touch).
       Returns { trees, floatingCanopies, unseatedTrunks, brokenChains }
       (+ per-site breakdown) so the math gate can assert all three
       zeros forever.

   Deterministic (pure walk over build-time data, no RNG), allocation-
   light (flat number arrays per site; the audit allocates only its
   result object). No THREE dependency — matrix math is hand-rolled on
   Matrix4.elements, so this file loads right after core/seed.js.

   SEMANTICS
     unseatedTrunks   — TREES whose trunk AABB bottom is above the seat
                        reference (gy + EPS_SEAT). gy is the builder's
                        min-under-footprint sample, so a trunk that only
                        touches the UPHILL side of a slope still fails.
     floatingCanopies — PARTS (beyond the trunk) not reached from the
                        trunk through the overlap graph: a canopy/frond/
                        arm floating relative to the structure.
     brokenChains     — TREES with >= 1 unreached part (the tree-level
                        rollup of the same fixed point).
     A single-part tree (bare snag) only takes the seat check.

   Runtime-pooled trees (systems/resources.js harvest nodes get chopped
   and respawn) pass an `alive` callback; the audit skips dead ones so
   chopping a tree never trips the gate.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  // site -> { n, gy:[], np:[], parts:[flat 6-number groups], alive:[fn|null] }
  const sites = new Map();

  function siteRec(name) {
    let s = sites.get(name);
    if (!s) { s = { n: 0, gy: [], np: [], parts: [], alive: [] }; sites.set(name, s); }
    return s;
  }

  // A builder that can run more than once per page (mode/world rebuilds)
  // resets its OWN site first so the registry never double-counts.
  CBZ.treeAuditResetSite = function (name) { sites.delete(name); };

  /* ---- registration ---------------------------------------------------- */

  // Register one planted tree. `gy` = seat reference (LOWEST terrain surface
  // sample under the trunk footprint). `parts` = flat number array
  // [minX,minY,minZ,maxX,maxY,maxZ, ...] — part 0 MUST be the trunk/base.
  // `alive` (optional) = () => bool for runtime-pooled trees.
  CBZ.treeRegisterTree = function (site, gy, parts, alive) {
    if (!CBZ.CONFIG || CBZ.CONFIG.TREES_V2 === false) return;   // off = old world, nothing to certify
    const np = (parts.length / 6) | 0;
    if (np < 1) return;
    const s = siteRec(site);
    s.gy.push(gy);
    s.np.push(np);
    for (let i = 0; i < np * 6; i++) s.parts.push(parts[i]);
    s.alive.push(alive || null);
    s.n++;
  };

  // Append the world AABB of the local box [lo..hi] under Matrix4 `m` to the
  // flat `parts` array. Standard abs-matrix affine AABB transform (exact for
  // the composed position/rotation/scale the builder just wrote with
  // dummy.updateMatrix()) — the audit therefore sees the REAL rendered
  // bounds, per instance, including every jitter extreme.
  CBZ.treeAabbPush = function (parts, m, loX, loY, loZ, hiX, hiY, hiZ) {
    const e = m.elements;
    const cx = (loX + hiX) / 2, cy = (loY + hiY) / 2, cz = (loZ + hiZ) / 2;
    const ex = (hiX - loX) / 2, ey = (hiY - loY) / 2, ez = (hiZ - loZ) / 2;
    // world centre = M * local centre (column-major elements)
    const wx = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
    const wy = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
    const wz = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
    // world half-extent = abs(M3x3) * local half-extent
    const rx = Math.abs(e[0]) * ex + Math.abs(e[4]) * ey + Math.abs(e[8]) * ez;
    const ry = Math.abs(e[1]) * ex + Math.abs(e[5]) * ey + Math.abs(e[9]) * ez;
    const rz = Math.abs(e[2]) * ex + Math.abs(e[6]) * ey + Math.abs(e[10]) * ez;
    parts.push(wx - rx, wy - ry, wz - rz, wx + rx, wy + ry, wz + rz);
  };

  // The geometry's local bounding box (computed once, cached on the geo) —
  // builders feed its numbers to treeAabbPush so registered bounds always
  // match the actual vertices, not a hand-transcribed constant.
  CBZ.treeGeoBounds = function (geo) {
    if (!geo.boundingBox && geo.computeBoundingBox) geo.computeBoundingBox();
    return geo.boundingBox || null;
  };

  // Ground under a trunk footprint: min/max of the site's height oracle over
  // the centre + 4 compass samples at radius r. On a slope the MIN is the
  // DOWNHILL surface — the seat law says the trunk base sinks below THAT.
  // Returns a shared scratch object (copy the numbers out, never keep it).
  const _gu = { min: 0, max: 0 };
  CBZ.treeGroundUnder = function (oracle, x, z, r) {
    let g = oracle(x, z), lo = g, hi = g;
    g = oracle(x + r, z); if (g < lo) lo = g; if (g > hi) hi = g;
    g = oracle(x - r, z); if (g < lo) lo = g; if (g > hi) hi = g;
    g = oracle(x, z + r); if (g < lo) lo = g; if (g > hi) hi = g;
    g = oracle(x, z - r); if (g < lo) lo = g; if (g > hi) hi = g;
    _gu.min = lo; _gu.max = hi;
    return _gu;
  };

  /* ---- the audit -------------------------------------------------------- */

  const EPS_SEAT = 0.02;    // trunk bottom must be <= gy + this
  const XZ_SHRINK = 0.02;   // demolition-check's footprint shrink: grazing corners don't count
  const Y_EMBED = 0.02;     // vertical interpenetration must exceed this (no knife-edge touch)

  // parts overlap in 3D (real interpenetration): flat-array AABBs at offsets a, b.
  function overlaps(P, a, b) {
    // xz overlap with shrink
    if (!(P[a] < P[b + 3] - XZ_SHRINK && P[a + 3] > P[b] + XZ_SHRINK &&
          P[a + 2] < P[b + 5] - XZ_SHRINK && P[a + 5] > P[b + 2] + XZ_SHRINK)) return false;
    // y interpenetration
    const top = Math.min(P[a + 4], P[b + 4]);
    const bot = Math.max(P[a + 1], P[b + 1]);
    return top - bot >= Y_EMBED;
  }

  // scratch flags for the per-tree fixed point (max parts per tree is small —
  // a palm is trunk + hub + 6 fronds = 8; grow-once, reuse forever).
  let _reached = new Uint8Array(16);

  CBZ.treeAudit = function () {
    let trees = 0, floatingCanopies = 0, unseatedTrunks = 0, brokenChains = 0;
    const perSite = {};
    sites.forEach(function (S, name) {
      let sTrees = 0, sFloat = 0, sUnseat = 0, sChain = 0;
      const P = S.parts;
      let off = 0;                                    // flat offset of tree's part 0
      for (let t = 0; t < S.n; t++) {
        const np = S.np[t];
        const base = off;
        off += np * 6;
        const alive = S.alive[t];
        if (alive && !alive()) continue;              // chopped/pooled-out — not planted
        sTrees++;

        // SEAT: trunk AABB bottom at or below the downhill terrain sample.
        if (P[base + 1] > S.gy[t] + EPS_SEAT) sUnseat++;

        if (np > 1) {
          // SUPPORT CHAIN: flood from the trunk over real 3D overlaps
          // (the demolition-check fixed point, embed-overlap edition).
          if (_reached.length < np) _reached = new Uint8Array(np);
          for (let i = 0; i < np; i++) _reached[i] = 0;
          _reached[0] = 1;
          let changed = true;
          while (changed) {
            changed = false;
            for (let i = 1; i < np; i++) {
              if (_reached[i]) continue;
              for (let j = 0; j < np; j++) {
                if (j === i || !_reached[j]) continue;
                if (overlaps(P, base + i * 6, base + j * 6)) { _reached[i] = 1; changed = true; break; }
              }
            }
          }
          let unreached = 0;
          for (let i = 1; i < np; i++) if (!_reached[i]) unreached++;
          if (unreached > 0) { sFloat += unreached; sChain++; }
        }
      }
      trees += sTrees; floatingCanopies += sFloat; unseatedTrunks += sUnseat; brokenChains += sChain;
      perSite[name] = { trees: sTrees, floatingCanopies: sFloat, unseatedTrunks: sUnseat, brokenChains: sChain };
    });
    return { trees: trees, floatingCanopies: floatingCanopies, unseatedTrunks: unseatedTrunks, brokenChains: brokenChains, sites: perSite };
  };

  /* ======================================================================
     §2 — THE ONE TREE GRAMMAR  (CBZ.treeCrownGeo / CBZ.treeTrunkGeo)

     OWNER (2026-07-28, verbatim-ish): "In the wilderness there's two types of
     trees. There's a type that's this weird geometric shit with a very thin
     trunk... that type sucks. Then we have the type that has two cones. It's
     made up of two cones. And that type looks nice. But each tree needs to
     have more roots. It needs to be more connected to the ground. And that
     needs to replace the other trees in the game."

     Two separate faults, and neither is taste:

     (a) THE GAME SHIPPED TWO UNRELATED TREE VOCABULARIES. Six builders drew a
         LAYERED CONE (biome_forest's beloved 2-cone stack, biome_snow's
         3-cone pine, wildnature's conifer, the harvest tree) and five drew a
         SQUASHED ICOSAHEDRON on a stick (wildnature broadleaf + birch,
         biome_forest's round canopy, continent's backcountry blob,
         expansion's island crown, props.js's planter tree). Nobody chose the
         second one on purpose — it is just what "a round canopy" was the day
         each of those files was written, and then it was copied. A blob of 20
         flat facets does not read as foliage at ANY distance; a cone stack
         does, because a real crown is a stack of whorls narrowing upward.
         So there is now ONE canopy function and every crown in the game comes
         out of it. VARIETY LIVES IN THE GRAMMAR (tier count, taper, height:
         width, per-instance colour), never in a second silhouette family.

     (b) A TREE THAT MEETS THE GROUND AT A CIRCLE IS A POLE. Every trunk here
         was a bare tapered cylinder ending flush at the soil, so a tree read
         as PLANTED IN a hole rather than GROWN OUT of one. The fix is a real
         root flare baked into the TRUNK GEOMETRY ITSELF — a butt swell plus
         3-5 tapered radial spurs running outward and DOWN past y=0 — merged
         into the same unit geo the instanced mesh already draws. ZERO extra
         draw calls, zero extra instances, zero new parts in the AABB chain:
         the trunk's registered bounds simply get honestly wider and honestly
         deeper, which makes §1's seat law EASIER to satisfy, never harder.

     THE ONE THING THAT MAKES ROOTS HARD, and why the numbers look odd: an
     instanced trunk is scaled NON-UNIFORMLY, (trunkRadius, treeHeight,
     trunkRadius), and treeHeight/trunkRadius runs to 40x. Anything baked into
     unit space is therefore stretched ~40x vertically. `rise`/`dip` default to
     a FRACTION OF THE GEO'S OWN HEIGHT for exactly that reason (a 20 m tree
     gets a ~1.1 m flare, a 6 m sapling ~0.33 m — which is also how real root
     buttresses scale), and a caller that draws a UNIFORMLY scaled mesh (a
     planter tree) passes absolute numbers instead.

     ADOPTION IS ONE LINE and degrade-safe by construction:
       trunk:  CBZ.treeTrunkGeo ? CBZ.treeTrunkGeo({rTop, rBase, h, seg}) : <old cylinder>
       crown:  CBZ.treeCrownGeo ? CBZ.treeCrownGeo({tiers, r, h}) : <old blob>
     With TREES_ROOTS off, treeTrunkGeo returns EXACTLY the cylinder the caller
     used to type — so a trunk migration is byte-identical until the flag says
     otherwise. Both return unit-ish geometry with the ground line at y = y0
     (default 0) and the top at y0 + h, which is the convention every existing
     instanced tree already scales against.

     Flags: TREES_ONE_GRAMMAR (crown family) · TREES_ROOTS (the flare).
     Ratchet: CBZ.treeGrammarAudit() -> {crowns, trunks, rooted, legacy, ...};
     `legacy` counts blob canopies still being built and may only go DOWN.
  ====================================================================== */

  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.TREES_ONE_GRAMMAR == null) CFG.TREES_ONE_GRAMMAR = true;
  if (CFG.TREES_ROOTS == null) CFG.TREES_ROOTS = true;
  // Wilderness boulder scatter (world/wildnature.js + the backcountry in
  // city/continent.js). OWNER: "in the wilderness there are little green and
  // little gray rocks — these little geometric things. Get rid of those...
  // You can have small rocks, but not these, like, boulders." DEFAULT FALSE,
  // which IS the removal; the scatters keep every rng draw (dead-draw, the
  // DESERT_ROCK_SCATTER pattern) so nothing else in the world re-deals.
  if (CFG.WILD_ROCK_SCATTER == null) CFG.WILD_ROCK_SCATTER = false;
  // Small fractured ground stones that replace them (rockscliffs.js geometry
  // at hand/boot scale, no colliders — a thing you step over, not around).
  if (CFG.WILD_SMALL_ROCKS == null) CFG.WILD_SMALL_ROCKS = true;

  const TAU = Math.PI * 2;
  const stats = { crowns: 0, trunks: 0, rooted: 0, legacy: 0, tiers: 0, spurs: 0,
    sites: {}, legacySites: {} };
  function note(bag, site) { if (!site) return; bag[site] = (bag[site] || 0) + 1; }

  function mergeParts(parts) {
    const T = window.THREE;
    const BGU = T && T.BufferGeometryUtils;
    const merge = BGU && BGU.mergeBufferGeometries;
    if (merge) { const g = merge.call(BGU, parts, false); if (g) return g; }
    return parts[0];               // BufferGeometryUtils absent — the base part still reads as a tree
  }

  // Bake a dark-underside -> bright-crown ramp into the `color` attribute.
  // Done AFTER the merge so every part carries identical attributes going in
  // (mergeBufferGeometries refuses a mismatched set — that is the trap).
  function bakeAO(g, y0, h, low) {
    const T = window.THREE;
    const pos = g && g.attributes && g.attributes.position;
    if (!T || !pos || !pos.count) return g;
    const n = pos.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      let t = h > 0 ? (pos.getY(i) - y0) / h : 1;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const v = low + (1 - low) * t;
      c[i * 3] = v; c[i * 3 + 1] = v; c[i * 3 + 2] = v;
    }
    g.setAttribute("color", new T.BufferAttribute(c, 3));
    return g;
  }

  /* ---- THE CANOPY ------------------------------------------------------
     A stack of `tiers` cones, bottom tier widest, each one sinking `bite` of
     itself into the tier below so the stack is support-connected BY
     CONSTRUCTION (§1's chain can never break inside a crown). Base at y0,
     tip lands EXACTLY at y0 + h, widest radius exactly r — so it drops into
     any caller that was scaling a unit cone or a unit blob.

     The defaults are not invented: taper 0.70 / hRatio 0.887 / bite 0.274
     are biome_forest's authored two-cone tree solved back into ratios, so
     treeCrownGeo({tiers:2}) reproduces the tree the owner named as the good
     one to within a rounding step. Ask for 3 tiers and you get wildnature's
     conifer; ask for 2 with a fat taper and you get a broadleaf.
  ---------------------------------------------------------------------- */
  CBZ.treeCrownGeo = function (o) {
    const T = window.THREE;
    if (!T) return null;
    o = o || {};
    // leaf:true — THE REAL CROWN. A cloud of textured leaf cards from the
    // vegetation kit (world/vegetation.js) in this caller's metres: r wide,
    // h tall, seated at y0, spruce whorls for 3+ tiers and a broadleaf lobe
    // set otherwise. The caller must draw it with the kit's foliage
    // material (CBZ.vegetationKit.material("foliage", tint)) — the cards are
    // alpha-tested quads and any other material shows the quads.
    if (o.leaf && CBZ.vegetationKit && CBZ.vegetationKit.customCrown) {
      const tiers = o.tiers == null ? 2 : o.tiers;
      let seed = 0;
      const site = String(o.site || "");
      for (let i = 0; i < site.length; i++) seed = (seed * 31 + site.charCodeAt(i)) | 0;
      const base = CBZ.vegetationKit.customCrown({
        spire: tiers >= 3, r: o.r == null ? 1 : o.r, h: o.h == null ? 1 : o.h,
        n: o.n, cards: o.cards, shape: o.shape, seed: seed ^ ((o.seed | 0) * 0x9e37),
      });
      let g = base;
      if (o.y0) { g = base.clone(); g.translate(0, o.y0, 0); g.computeBoundingBox(); g.computeBoundingSphere(); g.userData = Object.assign({}, base.userData); }
      stats.crowns++; stats.tiers += tiers; note(stats.sites, o.site);
      return g;
    }
    const tiers = Math.max(1, Math.min(5, o.tiers == null ? 2 : o.tiers));
    const R = o.r == null ? 1 : o.r;
    const H = o.h == null ? 1 : o.h;
    const y0 = o.y0 || 0;
    const seg = o.seg == null ? 6 : o.seg;
    const taper = o.taper == null ? 0.70 : o.taper;     // radius, tier -> tier
    const hRatio = o.hRatio == null ? 0.887 : o.hRatio; // height, tier -> tier
    const bite = o.bite == null ? 0.274 : o.bite;       // how deep a tier sinks into the one below

    // solve tier 0's height so the LAST tip lands on y0 + H for any tier count
    let step = 0, hf = 1;
    for (let i = 0; i < tiers - 1; i++) { step += hf * (1 - bite); hf *= hRatio; }
    const hc0 = H / (step + hf);

    const parts = [];
    let b = y0, hc = hc0, r = R;
    for (let i = 0; i < tiers; i++) {
      const c = new T.ConeGeometry(r, hc, seg);
      c.translate(0, b + hc / 2, 0);
      parts.push(c);
      b += hc * (1 - bite);
      hc *= hRatio;
      r *= taper;
    }
    const g = mergeParts(parts);
    if (o.ao) bakeAO(g, y0, H, o.aoLow == null ? 0.55 : o.aoLow);
    if (g.computeBoundingSphere) g.computeBoundingSphere();
    stats.crowns++; stats.tiers += tiers; note(stats.sites, o.site);
    return g;
  };

  /* ---- THE TRUNK, WITH ROOTS -------------------------------------------
     Tapered bole (rBase at the ground line, rTop at the top) + a butt swell
     + `roots` tapered spurs running outward-and-down to (rBase*spread,
     y0-dip). Everything is ONE merged geometry, so a caller's InstancedMesh
     count, draw calls and part chain are all unchanged.

     With TREES_ROOTS off this returns precisely the cylinder the caller used
     to write, which is what makes adopting it free.
  ---------------------------------------------------------------------- */
  CBZ.treeTrunkGeo = function (o) {
    const T = window.THREE;
    if (!T) return null;
    o = o || {};
    const rTop = o.rTop == null ? 0.16 : o.rTop;
    const rBase = o.rBase == null ? 0.34 : o.rBase;
    const H = o.h == null ? 1 : o.h;
    const y0 = o.y0 || 0;
    const seg = o.seg == null ? 5 : o.seg;

    const bole = new T.CylinderGeometry(rTop, rBase, H, seg);
    // bark repeats: the kit's bark map wraps twice round and once per
    // `uvRepeat`-th of the height (callers scale a unit bole ~15x, so the
    // default is one period per ~3 m of a 15 m tree)
    const uv = bole.attributes.uv, vRep = o.uvRepeat == null ? 5 : o.uvRepeat;
    if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * vRep);
    bole.translate(0, y0 + H / 2, 0);
    const n = (CFG.TREES_ROOTS === false) ? 0 : (o.roots == null ? 4 : o.roots);
    if (n <= 0) { stats.trunks++; note(stats.sites, o.site); return bole; }

    // rise/dip default to a FRACTION OF H — see the non-uniform-scale note in
    // the block header. A caller drawing a uniformly scaled mesh passes metres.
    const rise = o.rise == null ? 0.055 * H : o.rise;
    const dip = o.dip == null ? 0.014 * H : o.dip;
    const flare = o.flare == null ? 1.5 : o.flare;
    const spread = o.spread == null ? 2.3 : o.spread;
    const parts = [bole];

    // BUTT SWELL — open-ended on purpose: its top rim meets the bole's own
    // surface radius exactly (tangent circle, not a coplanar face), so there
    // is nothing to z-fight and nothing to cap.
    const rAtRise = rBase + (rTop - rBase) * (H > 0 ? rise / H : 0);
    const swell = new T.CylinderGeometry(rAtRise, rBase * flare, rise + dip, seg, 1, true);
    swell.translate(0, y0 + (rise - dip) / 2, 0);
    parts.push(swell);

    // ROOT SPURS. Axis solve: a cylinder built along +Y, rotated about Z by
    // th, has its +Y end at (-sin th, cos th, 0) — the sign that matters, and
    // getting it wrong points every root at the sky. We want that end at the
    // TIP (outward, below the soil), so th = atan2(-dr, dy) with dy < 0.
    const r0 = rBase * 0.95, y1 = y0 + rise * 0.62;
    const r1 = rBase * spread, y2 = y0 - dip;
    const dr = r1 - r0, dy = y2 - y1;
    const L = Math.hypot(dr, dy) || 0.001;
    const th = Math.atan2(-dr, dy);
    const rootR = rBase * (o.rootR == null ? 0.42 : o.rootR);
    const tipR = rootR * 0.34;
    const rm = (r0 + r1) / 2, ym = (y1 + y2) / 2;
    const rseg = o.rootSeg == null ? 3 : o.rootSeg;
    // OPEN-ENDED, and the reason is the same one that lets the swell be open:
    // BOTH caps are hidden by construction. The inner end is inside the bole;
    // the outer tip sits at y0 - dip, and every caller seats its trunk at or
    // below the LOWEST terrain sample under the footprint, so the tip is
    // buried on the downhill side too. Halving each spur from 12 tris to 6
    // matters here and nowhere else in this file: wildnature draws 7,500 of
    // these in one instanced mesh.
    for (let k = 0; k < n; k++) {
      // deterministic, geometry-only jitter: roots are never a perfect star,
      // but they must not consume a draw on anybody's seeded stream either.
      const a = (o.yaw || 0) + (k / n) * TAU + Math.sin(k * 2.399) * (TAU / n) * 0.17;
      const sp = new T.CylinderGeometry(tipR, rootR, L, rseg, 1, true);
      sp.rotateZ(th);
      sp.rotateY(a);
      sp.translate(Math.cos(a) * rm, ym, -Math.sin(a) * rm);
      parts.push(sp);
      stats.spurs++;
    }
    const g = mergeParts(parts);
    if (g.computeBoundingSphere) g.computeBoundingSphere();
    stats.trunks++; stats.rooted++; note(stats.sites, o.site);
    return g;
  };

  // A site that still hand-rolls a blob canopy declares it here, so the
  // ratchet counts what is LEFT rather than what was migrated. An audit that
  // can only count successes is a press release.
  CBZ.treeGrammarLegacy = function (site) { stats.legacy++; note(stats.legacySites, site); };

  CBZ.treeGrammarAudit = function () {
    return {
      crowns: stats.crowns,             // canopies built through the one grammar
      tiers: stats.tiers,               // total cone whorls across them
      trunks: stats.trunks,             // trunks built through the one grammar
      rooted: stats.rooted,             // ...of which carry a baked root flare
      spurs: stats.spurs,               // total root spurs baked
      legacy: stats.legacy,             // blob canopies still being built — may only go DOWN
      sites: stats.sites,
      legacySites: stats.legacySites,
      grammarOn: CFG.TREES_ONE_GRAMMAR !== false,
      rootsOn: CFG.TREES_ROOTS !== false,
    };
  };
})();
