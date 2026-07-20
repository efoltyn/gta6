/* ============================================================
   world/treeaudit.js — THE TREE CONNECTION LAW (registry + audit).

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
})();
