/* ============================================================
   systems/structdamage.js — CBZ.structDamage: the RAID-TOOL DAMAGE
   MATRIX for player-built pieces (B5, BUILD-PLAN Stage B). ADDITIVE:
   this file only ever reads/writes CBZ.pieces entries (systems/pieces.js,
   F4) and calls CBZ.building.remove() (B1) on death — it owns no new
   world state of its own besides the per-piece damage-tint bookkeeping
   below. Loads right after systems/building.js (needs nothing from it at
   parse time, but the load-order comment there documents this family).

   ------------------------------------------------------------------
   THE MATRIX — CBZ.structDamage.hit(pieceId, amount, type), type ∈
   {melee, bullet, explosive, vehicle}. `amount` is the RAW hit amount
   (a weapon's base damage, a blast's falloff-scaled amount, ...) — this
   file applies the material×damage-type multiplier, never the caller.

   TIERS is keyed by piece.tier (systems/pieces.js's Piece schema — null
   for every piece this wave, since B1's catalog is wood-only). A tier
   missing from TIERS (or piece.tier === null) falls back to "wood".
   B-later material waves (stone/metal) add their OWN row here — same
   shape, sturdier numbers — with zero change to hit()'s call sites.
   ------------------------------------------------------------------ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.pieces) return; // needs systems/pieces.js's CBZ.pieces Map
  if (CBZ.structDamage) return;    // idempotent (same guard idiom as the rest of this family)

  const TIERS = {
    // decay: 1.0 (B8, systems/baseclaim.js's upkeep tick) — face-value, no
    // material resistance; explicit row entry even though multFor's own
    // fallback already returns 1.0 for an unlisted type, so the rate reads
    // as a deliberate design choice here, not an accidental default.
    wood: { melee: 1.0, bullet: 0.35, explosive: 4.0, vehicle: 2.0, decay: 1.0 },
    // stone: { melee: 0.6,  bullet: 0.20, explosive: 2.5, vehicle: 1.4 },  // B-later material tier
    // metal: { melee: 0.35, bullet: 0.12, explosive: 1.6, vehicle: 0.9 }, // B-later material tier
  };
  function tierOf(piece) { return (piece.tier != null && TIERS[piece.tier]) ? piece.tier : "wood"; }
  function multFor(piece, type) {
    const row = TIERS[tierOf(piece)];
    const m = row && row[type];
    return m != null ? m : 1.0; // unknown type: no penalty/bonus, hits land at face value
  }

  /* ============================================================
     DAMAGE STATES — tint the piece progressively darker past 66%/33%
     remaining hp, cheap visible raid feedback. The catalog's build()
     functions (systems/building.js CATALOG.*) all pull their materials
     from CBZ.cmat() (world/materials.js), a COLOR-KEYED SHARED CACHE —
     every wood wall in the world points at the SAME MeshLambertMaterial
     instance. Writing to that material's .color would tint EVERY wood
     wall on the map, not just the one that got shot. So: clone the
     material ONCE per piece, the first time it takes damage, and only
     ever mutate the CLONE from then on (dmgState below tracks which
     piece owns which clone(s) + the clone's original hex so we can
     recompute the tint from scratch on every hit/repair instead of
     compounding a multiply chain).

     dmgState: Map<pieceId, { stage: 0|1|2, entries: [{mesh,mat,baseHex}] }>
     — entries covers every child Mesh under the piece's meshRef (a
     doorframe is 3 boxes; a roof is a slab + a lip; a wall is one Mesh
     returned directly — traverse() handles all three shapes uniformly).
     ============================================================ */
  const dmgState = new Map();

  function ensureCloned(piece) {
    let st = dmgState.get(piece.id);
    if (st) return st;
    st = { stage: 0, entries: [] };
    const mesh = piece.meshRef;
    if (mesh && mesh.traverse) {
      mesh.traverse(function (o) {
        if (!o.isMesh || !o.material) return;
        // an array material (multi-material mesh) isn't used anywhere in
        // the wood catalog today, but handle it defensively rather than
        // silently skipping a piece that grows one later.
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const clones = mats.map(function (m) {
          const c = m.clone();
          c._shared = false; // OURS to mutate/dispose — not the cmat() cache (pieces.js's
                              // teardownBatch only disposes non-_shared materials, so this
                              // clone is correctly freed when the piece is finally removed)
          return c;
        });
        o.material = Array.isArray(o.material) ? clones : clones[0];
        for (let i = 0; i < clones.length; i++) {
          st.entries.push({ mesh: o, mat: clones[i], baseHex: clones[i].color ? clones[i].color.getHex() : 0xffffff });
        }
      });
    }
    dmgState.set(piece.id, st);
    return st;
  }

  // Recompute the tint from the piece's CURRENT hp fraction — idempotent,
  // so calling this after damage OR repair always lands on the right
  // stage (no cumulative multiply drift). No-ops (no clone, no write) if
  // the piece is still fully healthy and was never damaged before.
  function retint(piece) {
    const frac = piece.maxHp > 0 ? piece.hp / piece.maxHp : 1;
    const stage = frac < 0.33 ? 2 : frac < 0.66 ? 1 : 0;
    if (stage === 0 && !dmgState.has(piece.id)) return; // never damaged — don't clone just to no-op
    const st = ensureCloned(piece);
    if (st.stage === stage) return;
    st.stage = stage;
    const factor = stage === 2 ? 0.42 : stage === 1 ? 0.68 : 1.0; // progressively darker ("cracked")
    for (let i = 0; i < st.entries.length; i++) {
      const e = st.entries[i];
      if (e.mat.color) e.mat.color.setHex(e.baseHex).multiplyScalar(factor);
    }
  }

  function forget(pieceId) { dmgState.delete(pieceId); } // piece is gone — drop the bookkeeping (its clones die with the mesh in pieces.js's teardownBatch dispose pass)

  /* ============================================================
     CBZ.structDamage.hit(pieceId, amount, type) -> bool
       Applies TIERS[tier][type] * amount to the piece's hp; hp<=0 routes
       through CBZ.building.remove() (cascade + B4 stability recompute —
       the raid payoff already built in B4). Also posts a "noise" city
       event (crowd panic bus, city/cityevents.js) so a raid in progress
       reads as loud as any other gunfight — guarded, since cityevents.js
       may not be loaded (survival mode) or city mode may be off.
     ============================================================ */
  const SD = (CBZ.structDamage = {});
  SD.TIERS = TIERS;

  SD.hit = function (pieceId, amount, type) {
    const p = CBZ.pieces.get(pieceId);
    if (!p || !p.alive || !(amount > 0)) return false;
    const mult = multFor(p, type);
    p.hp -= amount * mult;

    if (CBZ.cityPostEvent) {
      const intensity = type === "explosive" ? 1.6 : type === "vehicle" ? 1.0 : 0.5;
      CBZ.cityPostEvent({ type: "noise", pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, radius: 20, intensity: intensity });
    }

    if (p.hp <= 0) {
      forget(pieceId);
      // B6 BREACH STAMP: any piece destroyed inside a base's radius marks
      // this instant as a breach — systems/baseclaim.js's lockable doors/
      // containers stay open to non-owners for a short window afterward
      // (the W9-style "raiders exploit the hole they just made" rule).
      // Guarded — baseclaim.js loads after this file.
      if (CBZ.baseAt) { const rec = CBZ.baseAt(p.pos.x, p.pos.z); if (rec) rec.lastBreach = (CBZ.game && CBZ.game.elapsed) || 0; }
      if (CBZ.building && CBZ.building.remove) CBZ.building.remove(pieceId);
      else CBZ.despawnPiece(pieceId, { cascade: true }); // building.js not loaded — still tear the piece down
      return true;
    }
    retint(p);
    return true;
  };

  // CBZ.structDamage.repair(pieceId, amount) -> bool — no cost/UI this
  // wave (B7 wires resources); restores hp and re-runs retint so the
  // tint stage steps back down (and clears once hp is fully restored).
  SD.repair = function (pieceId, amount) {
    const p = CBZ.pieces.get(pieceId);
    if (!p || !p.alive || !(amount > 0)) return false;
    p.hp = Math.min(p.maxHp, p.hp + amount);
    retint(p);
    return true;
  };

  // dev/harness accessor: current tint stage (0/1/2), or null if the
  // piece has never been damaged.
  SD.tintStage = function (pieceId) {
    const st = dmgState.get(pieceId);
    return st ? st.stage : null;
  };
})();
