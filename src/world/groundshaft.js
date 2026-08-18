/* ============================================================
   world/groundshaft.js — THE GROUND OPENS, AND IT IS THE SAME HOLE EVERYWHERE.

   OWNER REFERENCE: the 2010 Guatemala City sinkhole. A sheer-walled, near
   perfectly cylindrical shaft that swallowed an intersection whole — the road
   surface sheared clean at the lip, the buildings standing INTACT four metres
   from the edge, stratified earth banding the walls, and a depth that reads far
   deeper than the hole is wide, going black before you can see a bottom. That
   picture is the spec. Everything below is arithmetic aimed at it.

   WHY THIS IS A FILE AND NOT A DISASTER DEF
   -----------------------------------------
   The sinkhole shipped inside systems/disasters.js as an 30-line `openHole()`:
   a cylinder, a disc and a ring, welded to the survival island's arena root,
   its arena's ground function and its actor list. The main city — which owns
   the intersections, the parked cars and the standing buildings that make the
   reference photograph WORK — could not have one, for exactly the reason
   city/tsunami.js's header gives about a private flood mesh: a hazard built
   against one mode's private geometry has to be re-taught to every other mode.

   So the shaft is a PRIMITIVE. `CBZ.groundShaft(x, z, opts)` cuts one anywhere
   in the world, in any mode, and the only three things it needs from its host
   are a scene root, a ground height and an actor list — all resolved here, once
   (`root()` / `rawFloor()` / `eachActor()`). The survival roster and the city
   both call the same function and get the same hole.

   THE FLOOR IS THE WHOLE INTEGRATION, AND IT IS ONE FUNCTION
   ---------------------------------------------------------
   Nothing in this game is told a shaft exists. `CBZ.survHoles` was already the
   published record of "the ground is gone here" (modes/survival.js's floorAt
   subtracts it); this file adopts that array as THE registry rather than
   opening a second one, and in the city it WRAPS `CBZ.floorAt` — copying the
   `_city` marker forward, because city/mode.js's reset() re-captures whatever
   it finds and an unmarked wrapper would make its recursion guard chase its own
   tail. Downstream, everything that already asked where the ground is falls in
   for free: the player's vertical physics, CBZ.body's airborne integrator, the
   bots, city/vehicles.js's suspension (which reads CBZ.floorAt per wheel), and
   fx debris.

   THE ESCAPE, THE STAIR AND THE LAMP LESSON
   -----------------------------------------
   A sheer 30 m shaft has no room inside it for a walkable ramp — the run is the
   radius, so any ramp is a cliff. What a collapse really leaves is a spiral of
   sheared ledges, and that IS the way out: nSteps = depth / 1.3 m, because
   1.53 m is exactly what this game's jump clears (jumpVel 8.2 against gravity
   22). The stair is declared ONCE as (a0, nSteps, rIn, rOut) and BOTH the drawn
   slabs and the floor query are derived from it — the utility-pole lesson from
   CLAUDE.md: two constants describing one object, authored independently, is
   how a wire ends up hanging beside its own insulator.

   THE FOUR KILL MODES ARE THE OWNER'S, PHYSICALLY
   -----------------------------------------------
     the fall     tracked peak descent speed, priced on the SAME quadratic
                  physics.js uses for a city fall (FALL_SAFE 11 m/s, quadratic
                  in the excess) so a 10 ft drop hurts and a 100 ft drop kills.
     crushing     rim chunks and entrained slabs are real falling bodies with
                  their own integrator (systems/fx.js's debris updater is gated
                  to survival mode, so a city sinkhole needed its own), and a
                  chunk landing on somebody at the bottom is a big hit.
     burial       at the floor, against the walls, shifting soil is a DOT —
                  UNLESS you are inside one of the wedged-slab VOID SPACES this
                  file deliberately builds, and crouching (protect your head)
                  cuts what does reach you.
     none         the fourth outcome is surviving: the void, the stair, and the
                  fact that the growth radius is announced by cracks first.
   Every one goes out through the caller's kill bus with its own cause string,
   so they read in the killfeed as four different deaths, which they are.

   YOU CANNOT SEE INTO A HOLE YOU ARE NOT ABOVE
   --------------------------------------------
   OWNER: "sinkhole from far away looks like a ring still." The rim is the
   whole picture at any normal viewing distance — at 9° above the ground the
   near lip occludes everything below it — so a shaft is only as dark as its
   first three metres, and those were its brightest surfaces. `skyOcc()` below
   is the fix and carries the full account: ONE occlusion ladder for the wall,
   the lip section and the stair, plus a collar that wears the colour of the
   ground it sheared from. `shaftAudit().throatShade` is the ratchet.

   PLACEMENT LAW: A SINKHOLE IS NOT A MOUNTAIN FEATURE. OWNER: "sinkholes should
   only happen on the ground not on sides of mountain." `CBZ.groundShaftSlope`
   samples the host's own ground over the footprint and the site is REFUSED
   above SHAFT_SLOPE_MAX (0.14 ≈ 8°). A refusal means no hole, never a hole
   moved somewhere it fits — `shaftAudit().holesOnSlopes` is the invariant and
   it is pinned at 0.

   Flags (declared here, the owning file):
     GROUND_SHAFT      master; false = nothing in this file ever cuts anything
     CITY_SINKHOLES    may the main world open one at all (default FALSE — a
                       city sinkhole is an EVENT the city runs, not ambient
                       chaos; the primitive is ready either way)
     SHAFT_SLOPE_MAX   the placement law's slope ceiling (rise/run)
     (the mask's slot count moved to core/groundmask.js: GROUND_MASK_SLOTS)
     SHAFT_ESCAPE      the spiral of ledges (false = a pure sheer pit)
     SHAFT_BURIAL      the shifting-soil DOT at the bottom

   Ratchet: CBZ.shaftAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};

  if (CBZ.CONFIG.GROUND_SHAFT == null) CBZ.CONFIG.GROUND_SHAFT = true;
  if (CBZ.CONFIG.CITY_SINKHOLES == null) CBZ.CONFIG.CITY_SINKHOLES = false;
  if (CBZ.CONFIG.SHAFT_SLOPE_MAX == null) CBZ.CONFIG.SHAFT_SLOPE_MAX = 0.14;
  if (CBZ.CONFIG.SHAFT_ESCAPE == null) CBZ.CONFIG.SHAFT_ESCAPE = true;
  if (CBZ.CONFIG.SHAFT_BURIAL == null) CBZ.CONFIG.SHAFT_BURIAL = true;

  const TAU = Math.PI * 2;
  const on = () => CBZ.CONFIG.GROUND_SHAFT !== false;

  /* ---- THE ONE REGISTRY ---------------------------------------------------
     modes/survival.js's floorAt already reads CBZ.survHoles and has since the
     hole got a bottom. Adopting that array (rather than publishing a second
     one) is what keeps this a migration: survival needs no edit at all, and
     `CBZ.groundShafts` is the same object under the name the city reads.
     `live` is NOT a mirror — it is how an EXTERNAL clear is detected: the
     director empties CBZ.survHoles on match reset and on mode exit, and that
     is the signal to dispose the meshes those records owned. */
  const pub = CBZ.survHoles = CBZ.groundShafts = (CBZ.survHoles || []);
  const live = [];
  const chunks = [];          // falling rim/entrained debris (our own integrator)
  const seqs = [];            // running collapse sequences
  const stats = { falls: 0, crushed: 0, buried: 0, voidSaves: 0, siteRejects: 0, cut: 0 };

  // ---- host seams: the only three things a shaft needs from its world ----
  function survMode() { return CBZ.game && CBZ.game.mode === "survival" && CBZ.surv && CBZ.surv.arena; }
  function root() {
    if (survMode()) return CBZ.surv.arena.root;
    return CBZ.scene;
  }
  /* The ground WITHOUT any hole subtracted — the terrain a new one is cut in.
     Reading CBZ.floorAt here would let one shaft's floor become another's
     terrain. solidground.js publishes the unsubtracted field directly, so this
     no longer has to reach for a wrapper it captured earlier and hope. */
  function rawFloor(x, z) {
    if (survMode()) return CBZ.surv.arena.groundHeightAt(x, z);
    if (CBZ.groundBaseAt) { const y = +CBZ.groundBaseAt(x, z); return Number.isFinite(y) ? y : 0; }
    if (CBZ.floorAt) { const y = +CBZ.floorAt(x, z); return Number.isFinite(y) ? y : 0; }
    return 0;
  }
  function eachActor(fn) {
    if (survMode()) { CBZ.surv.forEachActor(fn); return; }
    if (CBZ.city && CBZ.city.forEachActor && CBZ.game.mode === "city") { CBZ.city.forEachActor(fn); return; }
  }
  // ONE damage seam. Survival routes through CBZ.surv.hurt (which resolves the
  // cause and calls killfeed via reportDeath); the city routes the player
  // through cityHurtPlayer and a ped through the wrapped cityKillPed, so every
  // death below appears in the ONE feed with its own cause string.
  function hurt(a, dmg, cause, imp) {
    if (!a || a.dead || dmg <= 0) return;
    if (survMode()) { CBZ.surv.hurt(a, dmg, Object.assign({ cause: cause }, imp || {})); return; }
    if (a.isPlayer) {
      if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(dmg, (imp && imp.fromX), (imp && imp.fromZ), cause, false, null, false);
      return;
    }
    if (a.hp == null) return;
    a.hp -= dmg;
    if (a.hp <= 0 && CBZ.cityKillPed) CBZ.cityKillPed(a, Object.assign({ byPlayer: false }, imp || {}), cause);
  }
  function sfx(name, x, z) {
    if (x != null && CBZ.sfxAt) { CBZ.sfxAt(name, x, z); return; }
    if (CBZ.sfx) CBZ.sfx(name);
  }
  // Runtime FX may use Math.random (determinism law); SHAPE is hashed so two
  // clients cutting the same hole cut the same hole.
  function rnd() { return Math.random(); }
  function hs(h, a, b) { return CBZ.hash01 ? CBZ.hash01(h.seed + a * 13.7, b * 7.3, 91) : rnd(); }

  /* ============================================================
     THE GROUND OVER A HOLE IS NOT DRAWN

     This is the difference between a hole and a picture of a hole, and the
     old shaft never solved it: the island is ONE `CircleGeometry(R, 64)` disc
     and the city is a plate, so a shaft cut beneath either was completely
     hidden by the very surface it had removed — which is why the legacy
     version had to paint a dark ring on the grass to suggest an opening it
     could not show. You cannot re-topologise a 64-triangle disc to punch a
     20 m hole in it, and you should not have to: the ground does not need new
     geometry, it needs to STOP BEING DRAWN inside the mouth.

     So every material standing between the sky and the shaft floor (found by
     ONE downward raycast, which is what "standing between" means) gets a
     slotted discard injected into its fragment shader. Consequences that
     fall out for free and would each have been their own bug otherwise: the
     road paint over a city junction goes with the road, and on the island the
     OCEAN PLANE goes too — it sits at y=-0.8 across the whole island, so a
     46 m shaft looked up at blue water and down into it saw the sea, and both
     are fixed by the same one discard.

     Degrade-safe by construction: if a material's shader has no anchor we
     recognise (a custom ShaderMaterial that is not the disaster water), it is
     left alone and the only cost is that one surface still draws over the hole.
     ============================================================ */
  /* THE MASK IS NOT THIS FILE'S JOB ANY MORE — core/groundmask.js OWNS IT.

     What used to live here was ~230 lines of DISCOVERY: a downward raycast and
     a footprint box sweep to find the ground surfaces to patch, a per-material
     shader-string injection, a per-site swept-radius memo, a record of every
     mesh taken so a healer could re-stamp materials that got swapped underneath
     it, and a slot array. FOUR separate shipped bugs came out of that search,
     and not one came out of the discard itself:

       · the raycast threw on the city's Sprites and, sharing a try{} with the
         sweep, silently killed it — every city shaft a ring on intact tarmac;
       · a site was swept once at the first plug's HALF radius, so the annulus
         of road meshes out to the final radius stayed a lid;
       · slots were filled in creation order, so the newest hole — the one just
         opened under the player — was the one that went unmasked;
       · core/gfx.js swaps ground materials on a QUALITY TIER change, which
         un-stamped the discard mid-disaster; invisible on a fixed-tier desktop,
         reproducible on the owner's phone, and it needed a per-frame healer.

     All four are the same bug: a search that can miss. The discard now lives in
     THREE.ShaderChunk's fog chunks, which every fogged material in this game
     includes, so it is in every ground shader by construction and a material
     swapped at runtime arrives already carrying it. There is nothing to find,
     nothing to re-stamp, and nothing to get wrong.

     What stays here is what is genuinely this file's: WHICH holes are open, and
     what a shaft that loses a slot should do about its own geometry. */
  function setDrawn(h, drawn) {
    if (h._drawn === drawn) return;
    h._drawn = drawn;
    if (h.grp) h.grp.visible = drawn;
    if (h.hidden) for (let i = 0; i < h.hidden.length; i++) h.hidden[i].visible = !drawn;
  }
  const slotted = [];
  const maskReq = [];
  /* Publish every live shaft to the mask, take back the ones that won a slot,
     and stop drawing the rest — a ring lying on solid grass is the loud lie;
     untouched ground at 90 m is the quiet one. The DISCARD radius is the wall's
     outer edge (r * 1.06), not the removed floor: between the two lies the
     sliver of ground the wall stands behind, and on the island that sliver is
     where the sea was showing through as a blue crescent at the rim. */
  // core/groundmask.js deals the slots for EVERY owner of holes now, so this
  // file publishes its shafts and reads back which of them won one.
  if (CBZ.groundMaskProvide) {
    CBZ.groundMaskProvide(function () {
      maskReq.length = 0;
      for (let i = 0; i < live.length; i++) {
        const h = live[i];
        maskReq.push({ x: h.x, z: h.z, r: h.r * 1.06, y: h.gy, src: h });
      }
      return maskReq;
    });
  }
  function syncMask() {
    slotted.length = 0;
    if (!CBZ.groundMaskSync) { for (let i = 0; i < live.length; i++) setDrawn(live[i], true); return; }
    const w = CBZ.groundMaskSync();
    for (let i = 0; i < w.length; i++) slotted.push(w[i]);
    for (let i = 0; i < live.length; i++) setDrawn(live[i], slotted.indexOf(live[i]) >= 0);
  }

  /* ============================================================
     PLACEMENT LAW — flat ground only, never a mountainside
     ============================================================ */
  // Max |slope| over the footprint, sampled off the HOST's own ground. Eight
  // bearings at the rim plus eight at half-radius: a cone's flank fails on the
  // first pair, a flat street reads 0.
  CBZ.groundShaftSlope = function (x, z, r) {
    const c = rawFloor(x, z);
    let worst = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const cx = Math.cos(a), cz = Math.sin(a);
      for (let k = 0; k < 2; k++) {
        const d = r * (k ? 1.15 : 0.55);
        const s = Math.abs(rawFloor(x + cx * d, z + cz * d) - c) / d;
        if (s > worst) worst = s;
      }
    }
    return worst;
  };

  // Is this a legal place to open one? Slope is the law; water and the city's
  // own registries are the manners.
  CBZ.groundShaftCanOpen = function (x, z, r) {
    const slope = CBZ.groundShaftSlope(x, z, r);
    if (slope > CBZ.CONFIG.SHAFT_SLOPE_MAX) return { ok: false, why: "slope", slope: slope };
    // a non-finite probe point is a caller bug, not a lake: cityWaterAt(undefined,
    // undefined) answers TRUE, which is how the building rule above hid for so long
    if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, why: "badPoint", slope: slope };
    if (CBZ.cityWaterAt && !survMode() && CBZ.cityWaterAt(x, z)) return { ok: false, why: "water", slope: slope };
    /* THE SURVIVAL ISLAND HAS BUILDINGS TOO, and this law never looked at them.
       Everything below was gated to the city, so on the island only the SLOPE
       rule applied and a hole could open straight through a house. It was
       invisible for the sinkhole because systems/disasters.js does its own
       avoid() pass over arena.fragile before calling here — a private second
       copy of a rule that belongs in one place — and it surfaced the moment
       something ELSE asked for ground: a dig site photographed sitting across a
       row of houses. Same rule, same reason, now in the law itself so every
       caller gets it. */
    if (survMode() && CBZ.surv && CBZ.surv.arena) {
      const B = CBZ.surv.arena.fragile || [];
      for (let i = 0; i < B.length; i++) {
        const b = B[i];
        if (!b || b.fallen) continue;                  // rubble is ground, not a building
        const bx = b.ox != null ? b.ox : b.x, bz = b.oz != null ? b.oz : b.z;
        if (bx == null || bz == null) continue;
        // the record carries w AND d; a circle on the larger one is the
        // conservative read, and conservative is the right side to be wrong on
        const half = Math.max(b.w || 8, b.d || b.w || 8) * 0.5;
        if (Math.hypot(x - bx, z - bz) < r * 0.85 + half) return { ok: false, why: "building", slope: slope };
      }
    }
    if (!survMode() && CBZ.city && CBZ.city.arena) {
      const A = CBZ.city.arena;
      // never under a government complex: those regions are authored places
      // with authored floors, and the city already declares which they are
      const regs = (CBZ.city.regions || A.regions || []);
      for (let i = 0; i < regs.length; i++) {
        const g = regs[i];
        if (!g || !(g._govOwner || /gov|military|bunker|prison/i.test(String(g.name || g.id || "")))) continue;
        const hx = (g.hw != null ? g.hw : (g.w || 0) / 2) + r, hz = (g.hh != null ? g.hh : (g.d || g.h || 0) / 2) + r;
        if (hx > 0 && hz > 0 && Math.abs(x - (g.x || 0)) < hx && Math.abs(z - (g.z || 0)) < hz) return { ok: false, why: "gov", slope: slope };
      }
      /* NEVER STRAIGHT THROUGH A BUILDING FOOTPRINT — the reference photograph
         is a hole in an INTERSECTION with the buildings still standing, and this
         engine's structural ledger has no concept of "undermined".

         THIS RULE HAD NEVER ONCE FIRED. It read L.x / L.z; a city lot record
         carries cx / cz (its building carries ox / oz), so both reads were
         undefined, `Math.abs(x - undefined)` is NaN, and `NaN < hw` is false —
         so every candidate passed the building test no matter where it was.
         Measured: of 300 lots WITH buildings, zero were refused for "building".
         A bomb crater or a city sinkhole could open straight under a tower and
         leave it standing on air. Found by tools/crater-check.mjs failing to
         locate a single lot the law would refuse. */
      const lots = A.lots || [];
      for (let i = 0; i < lots.length; i++) {
        const L = lots[i];
        if (!L || !L.building) continue;
        const B = L.building;
        const lx = L.cx != null ? L.cx : (L.x != null ? L.x : (B.ox != null ? B.ox : null));
        const lz = L.cz != null ? L.cz : (L.z != null ? L.z : (B.oz != null ? B.oz : null));
        if (lx == null || lz == null) continue;
        const bw = (B.w != null ? B.w : L.w) || 0, bd = (B.d != null ? B.d : (L.d || L.h)) || 0;
        const hw = bw / 2 + r * 0.55, hd = bd / 2 + r * 0.55;
        if (Math.abs(x - lx) < hw && Math.abs(z - lz) < hd) return { ok: false, why: "building", slope: slope };
      }
    }
    return { ok: true, slope: slope };
  };

  /* Pick a site. Survival samples its arena; the city prefers a JUNCTION,
     because the reference photograph is an intersection and because
     city/roadrules.js already derives every junction in the world from the
     records the road builders push (never authored, never re-derived here). */
  CBZ.groundShaftSite = function (o) {
    o = o || {};
    const r = o.r || 8;
    const tries = o.tries || 30;
    const rng = o.rng || rnd;
    if (!survMode() && CBZ.roadJunctions) {
      const J = CBZ.roadJunctions() || [];
      if (J.length) {
        const near = o.nearX != null ? { x: o.nearX, z: o.nearZ } : (CBZ.player && CBZ.player.pos);
        const maxD = o.maxDist || 260;
        let best = null, bd = 1e18;
        for (let i = 0; i < J.length; i++) {
          const j = J[i];
          const d = near ? Math.hypot(j.x - near.x, j.z - near.z) : 0;
          if (near && (d < (o.minDist || 40) || d > maxD)) continue;
          if (d >= bd) continue;
          const can = CBZ.groundShaftCanOpen(j.x, j.z, r);
          if (!can.ok) { stats.siteRejects++; continue; }
          best = { x: j.x, z: j.z, slope: can.slope, junction: true }; bd = d;
        }
        if (best) return best;
      }
    }
    const cx = o.cx != null ? o.cx : (survMode() ? CBZ.surv.arena.center.x : 0);
    const cz = o.cz != null ? o.cz : (survMode() ? CBZ.surv.arena.center.z : 0);
    const R = o.R != null ? o.R : (survMode() ? CBZ.surv.arena.radius : 200);
    for (let t = 0; t < tries; t++) {
      const a = rng() * TAU, d = (o.minDist || 0) + rng() * (R * 0.8 - (o.minDist || 0));
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (o.avoid && o.avoid(x, z)) continue;
      const can = CBZ.groundShaftCanOpen(x, z, r);
      if (can.ok) return { x: x, z: z, slope: can.slope, junction: false };
      stats.siteRejects++;
    }
    return null;
  };

  /* ============================================================
     GEOMETRY — the sheer wall, the sheared lip, the strata, the dark
     ============================================================ */
  // ONE material for every shaft wall in the world: the strata, the mottling
  // and the darkening all live in the geometry's vertex colours, so a second
  // hole costs no second material and no second texture.
  let wallMat = null, rockMat = null, lipMat = null;
  function mats() {
    if (!wallMat) {
      wallMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
      rockMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
      lipMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
      /* THE LINER LIVES INSIDE THE BAND ON PURPOSE. The mask discards a thin
         slice about each hole's grade, and the wall's top, the torn lip and the
         stair's top steps are all in it — they ARE the hole's edge. Opting out
         is a #define, so it is exact and in the program cache key; it is the
         inverse of the old search, which had to identify the ground and always
         could be wrong about it. */
      if (CBZ.groundMaskExempt) { CBZ.groundMaskExempt(wallMat); CBZ.groundMaskExempt(rockMat); CBZ.groundMaskExempt(lipMat); }
    }
  }

  /* ============================================================
     ONE SKY-OCCLUSION LADDER FOR THE WHOLE SHAFT — AND IT IS MEASURED IN
     RADII BELOW THE RIM, NOT IN FRACTIONS OF THE DEPTH

     THE FAULT THIS FIXES: "the sinkhole from far away still looks like a ring."
     It did, and the reason is pure geometry — you cannot see into a hole you
     are not above. From a normal third-person camera a shaft 80 m away sits
     about 9° below the horizon, and at 9° the near rim occludes everything
     but the top ~3 m of the FAR wall: the black bottom this file works so hard
     for is not dim at that range, it is not on the screen at all. Whatever
     colour those first three metres are IS the sinkhole, at every distance
     from which a player normally sees one.

     Those three metres were the brightest surfaces in the shaft. Three
     separate brightness ladders, authored independently — the wall's
     `pow(1/(1+7t), 1.15)`, the lip cut face's hand-typed `k: 1, 0.55, 0.7`,
     and the stair's own copy of the wall curve — all agreed that the top of
     the shaft is fully lit, so a grazing viewer got a tan lip section, a tan
     clay band and (worst of all) the top few STAIR TREADS, which are
     horizontal and therefore face the distant camera square-on. Add the lip
     collar, which was painted soil-brown across grass, and the whole thing
     resolves at 80 m into exactly what the owner photographed: a brown ring
     lying on green ground.

     So the three ladders become ONE function — CLAUDE.md's utility-pole
     lesson again: two constants describing one object, authored separately,
     is how a wire ends up hanging beside its own insulator. And it takes its
     argument in METRES BELOW THE RIM over the shaft's own RADIUS, because
     that is what sky occlusion actually depends on. A fraction-of-depth curve
     says the first 3 m of a 42 m shaft are 63% lit and the first 3 m of a
     12 m shaft are 20% lit; the geometry says both are the same narrow slot
     of sky, and it is the geometry that is right.

       open      the sky the throat still sees, a reciprocal in u = d / r
                 (what a narrowing cone of visible sky does), essentially
                 black by two radii down
       lipShade  the CONTACT SHADOW under the overhang. wallRadius() already
                 cuts a real undercut just below the rim and a surface tucked
                 under a cantilevered crust sees almost no sky — so the
                 brightest thing in the shaft is 0.38, not 1.0, and the mouth
                 reads as a void from the first millimetre of wall.
     `shaftAudit().throatShade` is the ratchet: the brightness a distant
     grazing camera actually receives, which is the number that was wrong. */
  function skyOcc(h, d) {
    const u = Math.max(0, d) / Math.max(0.5, h.r);
    const open = Math.pow(1 / (1 + 2.6 * u), 1.35);
    const lipShade = 1 - 0.62 * Math.exp(-u / 0.5);
    return Math.max(0.02, open * lipShade);
  }
  // what a camera 80 m out at a normal depression angle sees of the far wall
  const GRAZE_D = 0.35;      // radii below the rim — the sliver the near lip leaves
  function throatShade(h) { return skyOcc(h, h.r * GRAZE_D); }

  /* THE COLLAR IS GROUND, SO IT IS PAINTED IN THE GROUND'S OWN COLOUR.

     The lip collar is the intact surface still standing at the rim — the
     sliver between the removed floor and the wall, which the ground mask has
     stopped drawing and which somebody therefore has to draw back. It was
     painted `surfaceColor`, and survival passes `surface: "soil"`, so on the
     island a 0x554129 brown annulus was laid across 0x53a84e grass out to
     1.26 mouth radii. Flat on the ground, it is the one part of a sinkhole
     that is fully visible from EVERY angle including the grazing one — which
     made it, literally, a brown ring painted on the grass: the exact lie this
     file's header says the legacy black-disc shaft told.

     Ground is not soil. The collar now samples the colour of the surface it
     was cut from (one raycast, the same one the mask uses) and wears it, so
     it disappears into the ground it is part of and the only thing left to
     see at the rim is the dark throat. `surfaceColor` still dresses the
     things that really are a section — the cut face, the talus, the slabs. */
  function faceTint(o, face, out) {
    const geo = o.geometry, ca = geo && geo.getAttribute && geo.getAttribute("color");
    if (!ca || !face) return false;
    out[0] = (ca.getX(face.a) + ca.getX(face.b) + ca.getX(face.c)) / 3;
    out[1] = (ca.getY(face.a) + ca.getY(face.b) + ca.getY(face.c)) / 3;
    out[2] = (ca.getZ(face.a) + ca.getZ(face.b) + ca.getZ(face.c)) / 3;
    return true;
  }
  function groundColorAt(x, z, gy) {
    const t = [1, 1, 1];
    try {
      const rc = new THREE.Raycaster(new THREE.Vector3(x, gy + 50, z), new THREE.Vector3(0, -1, 0), 0, 100);
      if (CBZ.camera) rc.camera = CBZ.camera;      // r128 Sprite.raycast derefs this
      const hits = rc.intersectObject(root(), true) || [];
      for (let i = 0; i < hits.length; i++) {
        const o = hits[i].object;
        if (!o || !o.isMesh || !o.visible || !o.material) continue;
        let p = o, mine = false;
        // anything this project DREW to replace ground is not the ground it
        // replaced — a shaft's liner, and a dig site's soil, which is the one
        // that made this worth publishing
        while (p) {
          if (p.userData && (p.userData.groundShaft || p.userData.digSite)) { mine = true; break; }
          p = p.parent;
        }
        if (mine) continue;
        // a canopy, a roof or a sign is not the ground; the ground is the
        // surface at the height the shaft's own rim was solved from
        const py = hits[i].point.y;
        if (py > gy + 2.5 || py < gy - 2.5) continue;
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!mat || !mat.color) continue;
        /* A TEXTURED SURFACE DOES NOT KEEP ITS COLOUR IN material.color — that
           field is a TINT of the map, and for the city's road and sidewalk
           plates it is plain white. Reading it produced a WHITE lip collar
           around every city hole: photographed on a bomb crater at a junction,
           the ring of "torn asphalt" was brighter than the concrete beside it.
           A tint is not an answer, so treat a mapped material as no answer and
           let the caller fall back to the section colour, which is what the
           collar always used to be. (The island, whose ground is flat untextured
           colour, still samples exactly as before.) */
        if (mat.map) continue;
        let r = mat.color.r, g = mat.color.g, b = mat.color.b;
        // a vertexColors ground (the island's beach ring is white × per-vertex
        // sand) would answer "white" from the material alone
        if (mat.vertexColors && faceTint(o, hits[i].face, t)) { r *= t[0]; g *= t[1]; b *= t[2]; }
        const q = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
        return (q(r) << 16) | (q(g) << 8) | q(b);
      }
    } catch (e) { /* no answer is not a crash: the caller falls back to soil */ }
    return null;
  }
  /* PUBLISHED, because a second thing needed it. systems/digsite.js was
     painting its undisturbed surface a hardcoded olive, which is a fine guess
     for grass and wrong everywhere else — photographed on the island it was a
     34 m cream disc lying in green grass. It needs the answer this function
     already works out (including the two things it learned the hard way: a
     textured plate's material.color is a white TINT, not a colour, and a
     vertexColors ground needs its face tint applied). One implementation. */
  CBZ.groundColorAt = groundColorAt;

  // The strata ladder: topsoil → clay → silt → weathered rock → bedrock, with
  // the band edges jittered per shaft so no two read as the same wallpaper.
  /* The ladder ALTERNATES IN VALUE, not just in hue: a band only reads as a
     band against a neighbour of different brightness, and at 40 m the hue is
     gone long before the value is. */
  const STRATA = [
    [0.00, 0x3a2a19], [0.06, 0xa8834e], [0.19, 0x4e4436],
    [0.31, 0xb0a077], [0.45, 0x5a5142], [0.60, 0x8b7f63],
    [0.72, 0x39332c], [0.86, 0x211e1b],
  ];
  /* Angular noise must WRAP. Hashing the raw bearing leaves a visible seam
     down the wall at 0 rad (the last column and the first are neighbours in
     space but strangers to the hash), so every angular input below is the
     bearing's cos/sin — a closed curve, and the seam cannot exist. */
  function strataColor(h, t, ang, out) {
    const j = (hs(h, Math.cos(ang) * 3.1 + t * 40, Math.sin(ang) * 3.1) - 0.5) * 0.055;
    const tt = Math.max(0, Math.min(1, t + j));
    let c = STRATA[0][1];
    for (let i = 0; i < STRATA.length; i++) if (tt >= STRATA[i][0]) c = STRATA[i][1];
    // DARK WITH DEPTH: no light reaches down a 30 m shaft. The floor of the
    // reference photograph is black, and that is not a shadow — it is the
    // absence of a bounce. Multiplicative, so the strata still read near the
    // top: at the rim the ladder is 0.38, which is dark enough to read as a
    // void against sunlit ground and bright enough that the bands are still
    // legible when you are standing at the edge looking down.
    const dark = skyOcc(h, h.depth * t);
    const mot = 0.9 + hs(h, Math.cos(ang) * 9.7, Math.sin(ang) * 9.7 + t * 71) * 0.2;
    const k = dark * mot;
    out[0] = (((c >> 16) & 255) / 255) * k;
    out[1] = (((c >> 8) & 255) / 255) * k;
    out[2] = ((c & 255) / 255) * k;
  }

  // radius profile: sheer, with a slight inward taper and a hint of an
  // undercut just below the lip (the overhang the surface layer makes when it
  // is left cantilevered over the void).
  function wallRadius(h, t, ang) {
    const undercut = 1 + 0.055 * Math.exp(-Math.pow(t / 0.10, 2));   // widest just under the rim
    const taper = 1 - 0.10 * t * t;
    const noise = 1 + (hs(h, Math.cos(ang) * 2.3 + t * 17, Math.sin(ang) * 2.3) - 0.5) * 0.05;   // sheer: ±2.5%
    return h.r * undercut * taper * noise;
  }

  function buildWall(h) {
    const seg = 46, rings = 20;
    const pos = new Float32Array((seg + 1) * (rings + 1) * 3);
    const col = new Float32Array((seg + 1) * (rings + 1) * 3);
    const idx = [];
    const c = [0, 0, 0];
    let p = 0;
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const y = h.gy - h.depth * t;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU;
        const rad = wallRadius(h, t, a);
        pos[p] = Math.cos(a) * rad; pos[p + 1] = y; pos[p + 2] = Math.sin(a) * rad;
        strataColor(h, t, a, c);
        col[p] = c[0]; col[p + 1] = c[1]; col[p + 2] = c[2];
        p += 3;
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i, b = a + 1, d = a + (seg + 1), e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, wallMat);
  }

  /* THE DISH FLOOR — a crater's bottom is a SURFACE, not an absence.

     A shaft can get away with a black disc down there: nothing reaches the
     floor of a 46 m hole and "bottomless" is the honest read. A 5 m bomb crater
     is the opposite — you can see every inch of its floor from the street — and
     with the black disc suppressed and nothing in its place, the mask cut the
     ground away and left the sky showing through the middle of the hole.

     So a bowl builds the surface its own floor query already describes: the
     same `dish` curve shaftFloor() answers with, meshed as a radial fan, so the
     thing you see and the thing you stand on are one solve. Strata colour comes
     from the shared ladder at the true depth of each ring, which is why the
     floor meets the wall without a seam in value. */
  function buildDish(h) {
    if (!h.dish) return null;
    const seg = 40, rings = 8;
    const R = h.dish.r;
    const pos = new Float32Array((seg + 1) * (rings + 1) * 3);
    const col = new Float32Array((seg + 1) * (rings + 1) * 3);
    const idx = [];
    const c = [0, 0, 0];
    let p = 0;
    for (let j = 0; j <= rings; j++) {
      const rr = (j / rings) * R;
      const y = h.bottom + h.dish.h * (rr / R);
      const t = Math.max(0, Math.min(1, (h.gy - y) / h.depth));
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU;
        const wob = 1 + (hs(h, Math.cos(a) * 2.7 + j, Math.sin(a) * 2.7) - 0.5) * 0.06;
        pos[p] = h.x + Math.cos(a) * rr * wob; pos[p + 1] = y; pos[p + 2] = h.z + Math.sin(a) * rr * wob;
        strataColor(h, t, a, c);
        col[p] = c[0]; col[p + 1] = c[1]; col[p + 2] = c[2];
        p += 3;
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i, b = a + 1, d = a + (seg + 1), e = d + 1;
        idx.push(a, b, d, b, e, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, wallMat);
  }

  /* THE SHEARED LIP. This is the detail that makes the picture: the road (or
     the turf) does not slope into the hole, it STOPS, cut off square, with the
     bitumen crust standing proud over the soil section under it. Inner radius
     is torn per-vertex, and the SAME torn radius drives the collar and the
     vertical cut face — one solve, two meshes, so the crust can never float
     off its own edge. */
  function buildLip(h) {
    const seg = 46;
    const inner = new Float32Array(seg + 1);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      // torn, never machined — but always at or OUTSIDE the removed floor, so
      // the edge you can see is still an edge you can stand on (the overhang
      // comes from the wall undercutting below, not from the crust lying).
      inner[i] = h.mouth * (1.035 + (hs(h, Math.cos(a) * 4.1, Math.sin(a) * 4.1) - 0.5) * 0.09);
    }
    inner[seg] = inner[0];
    /* The collar reaches just past the ground mask's discard radius (r × 1.06,
       i.e. 1.14 mouth radii) and then STOPS. Every centimetre beyond that is
       collar lying on ground that is still being drawn — invisible now that it
       wears the ground's own colour, but there is no reason to paint it. */
    const COLLAR_OUT = 1.17;
    // cut face (the section under the crust). Its brightness is not typed: it
    // is the SAME sky-occlusion ladder the wall below it uses, keyed on how far
    // under the overhang each row sits, so the crust and the wall it hangs over
    // can never disagree about how much light gets in there.
    const cutRows = [
      { rf: 1.0, dy: 0.0, c: h.surfaceColor },
      { rf: 1.0, dy: -0.32, c: h.surfaceColor },
      { rf: 0.985, dy: -1.05, c: 0x4a3826 },
      { rf: 0.97, dy: -2.1, c: 0x6a5233 },
    ];
    const nR = 2 + cutRows.length;
    const pos = new Float32Array((seg + 1) * nR * 3);
    const col = new Float32Array((seg + 1) * nR * 3);
    const idx = [];
    let p = 0, row = 0;
    /* `mv` is how much the row mottles. A section face wants the full 0.28 —
       it is broken earth. The COLLAR wants almost none: it is undisturbed
       ground wearing the ground's own colour, and a ±14% mottle across an
       annulus 1.2 mouth radii wide is enough to bring the ring back at
       distance in a different hue. The thing that has to be invisible has to
       be invisible in value as well as in colour. */
    function emit(rf, dy, hex, k, mv) {
      const amp = mv != null ? mv : 0.28;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU;
        const rad = inner[i] * rf;
        pos[p] = Math.cos(a) * rad; pos[p + 1] = h.gy + dy; pos[p + 2] = Math.sin(a) * rad;
        const mot = ((1 - amp * 0.5) + hs(h, Math.cos(a) * 5.3, Math.sin(a) * 5.3 + dy * 11) * amp) * k;
        col[p] = (((hex >> 16) & 255) / 255) * mot;
        col[p + 1] = (((hex >> 8) & 255) / 255) * mot;
        col[p + 2] = ((hex & 255) / 255) * mot;
        p += 3;
      }
      row++;
    }
    // outward collar first — the intact ground, in the ground's own colour and
    // at the ground's own brightness — then the cut face dropping into shadow.
    // The whole read of the sheared lip is that 3 cm step: lit surface, then
    // section. It STOPS, it does not slope in.
    emit(COLLAR_OUT, 0.035, h.topColor, 0.97, 0.07);
    emit(1.0, 0.035, h.topColor, 0.92, 0.07);
    for (let i = 0; i < cutRows.length; i++) emit(cutRows[i].rf, cutRows[i].dy, cutRows[i].c, skyOcc(h, -cutRows[i].dy));
    for (let j = 0; j < row - 1; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i, b = a + 1, d = a + (seg + 1), e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, lipMat);
  }

  // ---- a tiny merged-box builder: rubble, wedged slabs and the stair all
  //      land in ONE geometry each, so a whole shaft is ~6 draw calls ----
  function BoxBuf() {
    const P = [], C = [], I = [];
    return {
      add(cx, cy, cz, sx, sy, sz, yaw, hex, k) {
        const co = Math.cos(yaw || 0), si = Math.sin(yaw || 0);
        const base = P.length / 3;
        const hx = sx / 2, hy = sy / 2, hz = sz / 2;
        const V = [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
          [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]];
        for (let i = 0; i < 8; i++) {
          const v = V[i];
          P.push(cx + v[0] * co - v[2] * si, cy + v[1], cz + v[0] * si + v[2] * co);
          const kk = k * (i > 3 ? 1 : 0.82);
          C.push((((hex >> 16) & 255) / 255) * kk, (((hex >> 8) & 255) / 255) * kk, ((hex & 255) / 255) * kk);
        }
        const F = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 1, 5, 6, 1, 6, 2, 0, 3, 7, 0, 7, 4];
        for (let i = 0; i < F.length; i++) I.push(base + F[i]);
      },
      mesh(mat) {
        if (!P.length) return null;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
        geo.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
        geo.setIndex(I);
        geo.computeVertexNormals();
        return new THREE.Mesh(geo, mat);
      },
    };
  }

  /* THE FLOOR OF A SINKHOLE IS NOT A FLOOR — it is the roof of what fell in.
     A talus cone of the street that went down first, slabs of it standing on
     edge, and WEDGED SLABS leaning off the wall. Those wedges are not
     decoration: each one publishes a void pocket, and a void pocket is the
     difference between being buried and being alive down there. */
  function buildFloorFurniture(h) {
    const B = BoxBuf();
    h.voids = [];
    /* The wedged slabs exist to publish VOID POCKETS — the only thing that
       stops the burial DOT at the bottom of a deep shaft. A bomb crater has
       no burial and no wall to shelter against, so slabs the size of a car
       leaning in a 5 m dish were just furniture in the wrong room. */
    const wedges = h.bowl ? 0 : 3;
    // talus cone, as stacked broken plates (a cone primitive reads too clean)
    const cone = h.coneR;
    for (let i = 0; i < 26; i++) {
      const a = hs(h, i, 1) * TAU, d = Math.sqrt(hs(h, i, 2)) * cone;
      const y = h.bottom + h.coneH * Math.max(0, 1 - d / cone) * (0.35 + hs(h, i, 3) * 0.6);
      const s = 1.1 + hs(h, i, 4) * 2.3;
      B.add(h.x + Math.cos(a) * d, y, h.z + Math.sin(a) * d, s, 0.35 + hs(h, i, 5) * 0.7, s * (0.6 + hs(h, i, 6) * 0.8),
        hs(h, i, 7) * TAU, i % 3 === 0 ? h.surfaceColor : 0x4a4036, 0.16 + hs(h, i, 8) * 0.1);
    }
    // wedged slabs → the void spaces
    const nV = wedges;
    for (let i = 0; i < nV; i++) {
      const a = (i / nV) * TAU + hs(h, i, 11) * 0.9;
      const rr = h.r * 0.72;
      const px = h.x + Math.cos(a) * rr, pz = h.z + Math.sin(a) * rr;
      const w = Math.max(3.2, h.r * 0.55);
      B.add(px, h.bottom + 1.15, pz, w * 0.8, 0.45, w, a, h.surfaceColor, 0.2);
      B.add(px + Math.cos(a) * 0.1, h.bottom + 0.45, pz + Math.sin(a) * 0.1, 0.7, 1.0, 0.7, a, 0x3a332c, 0.16);
      h.voids.push({ x: px - Math.cos(a) * 0.7, z: pz - Math.sin(a) * 0.7, r: Math.max(1.6, w * 0.42) });
    }
    return B.mesh(rockMat);
  }

  /* THE STAIR. Declared once as (a0, n, rIn, rOut); drawn from that and
     ANSWERED from that (see shaftFloor). Steps are one jump apart, so the
     bottom of a sinkhole is survivable if you can find the ledge — which, in
     the dark, is the actual game. */
  function buildStair(h) {
    if (!h.stepN) return null;
    const B = BoxBuf();
    const dA = TAU / h.stepN;
    const rOut = h.r * 1.01;                    // out to the wall it sheared off
    const rm = (h.stepIn + rOut) * 0.5;
    const wide = rOut - h.stepIn;
    for (let i = 0; i < h.stepN; i++) {
      const a = h.stepA0 + (i + 0.5) * dA;
      const y = h.bottom + (i + 1) * (h.depth / h.stepN);
      const arc = dA * rm * 1.08;
      const t = 1 - (y - h.bottom) / h.depth;   // t is DEPTH fraction from the top
      /* the ledges take the SAME sky-occlusion ladder as the wall behind them,
         so a step does not float out of a wall it is supposed to be part of —
         and it is now literally the same function rather than a second copy of
         the same curve. This matters most at the TOP: a tread is horizontal,
         so the topmost steps are the surfaces a distant grazing camera sees
         square-on, and a bright slab under the rim is most of what made the
         mouth read as filled-in rather than open. */
      const k = skyOcc(h, h.depth * t) * 0.95;
      // yaw = a puts the box's local +x along the RADIUS, so `wide` is radial
      // and `arc` tangential — swap them and the stair spirals through its wall
      B.add(h.x + Math.cos(a) * rm, y - 0.22, h.z + Math.sin(a) * rm,
        wide, 0.44, arc, a, i % 4 === 3 ? h.surfaceColor : 0x6b6154, k);
    }
    return B.mesh(rockMat);
  }

  /* ============================================================
     CBZ.groundShaft(x, z, opts) — cut one. This is the whole primitive.
     ============================================================ */
  CBZ.groundShaft = function (x, z, opts) {
    if (!on()) return null;
    opts = opts || {};
    mats();
    const gy = opts.gy != null ? opts.gy : rawFloor(x, z);
    const r = Math.max(2.5, opts.r || 8);
    /* DEEPER THAN WIDE, ALWAYS — for a SINKHOLE. The reference reads as a
       shaft, not a crater, and the ratio is the whole reason: 2.1x the
       diameter. A CRATER is the opposite shape and the same primitive: ordnance
       digs a wide shallow bowl, so `bowl` lifts the clamp rather than adding a
       second hole system to sit beside this one. */
    /* The deeper-than-wide clamp is the SINKHOLE's law. A crater is a wide
       shallow bowl and a BREACH is a hole of exactly the thickness it has to get
       through — forcing either to 2.4x its radius made a 3 m roof punch reach
       16 m and drop the room's floor out from under itself. Both say so. */
    const depth = (opts.bowl || opts.through) ? Math.max(1.2, opts.depth || r * 0.55)
                                              : Math.max(r * 2.4, opts.depth || r * 4.2);
    const h = {
      x: x, z: z, r: r,
      mouth: r * 0.93,          // the floor is gone a hair inside the visible rim
      gy: gy, depth: depth, bottom: gy - depth,
      seed: opts.seed != null ? opts.seed : (x * 0.37 + z * 0.11),
      surfaceColor: opts.surface === "asphalt" ? 0x2f2e2c : (opts.surface === "soil" ? 0x554129 : (survMode() ? 0x4c5a34 : 0x2f2e2c)),
      mode: CBZ.game ? CBZ.game.mode : null,
      grp: new THREE.Group(),
      voids: [],
      bowl: !!opts.bowl,
      /* A HOLE THROUGH. A shaft and a crater both END in a floor; a BREACH does
         not — it opens into a room, and the room's floor is the floor. Building
         one anyway put a dome of earth in the ceiling of the bunker it had just
         opened, which is a plug, not a hole. */
      through: !!opts.through,
      /* A CRATER IS A DISH AND A SHAFT IS A PIT, and they are opposite shapes.
         The talus cone is a rubble MOUND — highest in the middle, sloping down
         to the wall — which is right for a collapse and exactly backwards for
         ordnance: it put the deepest point of a bomb hole at its rim. So a bowl
         gets its own floor curve (`dish`, deepest at the centre, rising to meet
         the lip) and keeps only a small cone of loose spoil at the bottom. */
      dish: (opts.bowl && !opts.through) ? { r: Math.max(0.5, r * 0.98), h: depth * 0.95 } : null,
      coneR: opts.bowl ? r * 0.3 : r * 0.66,
      coneH: opts.bowl ? Math.min(0.5, depth * 0.12) : Math.min(4.2, depth * 0.11),
      stepN: 0, stepA0: 0, stepIn: r * 0.78,
      born: CBZ.now || 0,
    };
    /* Sampled BEFORE the group joins the scene, so the raycast cannot find an
       earlier row of our own collar and copy a copy. `opts.top` lets a caller
       state the colour outright; a failed sample falls back to the section
       colour, which is what the collar always used to be. */
    const top = opts.top != null ? opts.top : groundColorAt(x, z, gy);
    h.topColor = top != null ? top : h.surfaceColor;
    /* Carried, not re-derived. Every shaft is re-cut five or six times as it
       grows and each re-cut passes the colour in, so deriving "was this
       sampled" from `opts.top == null` reported false for every hole in the
       game the moment it finished opening — the colour was the sampled one,
       the flag had simply forgotten where it came from. */
    h.topSampled = opts.topSampled != null ? !!opts.topSampled : (top != null && opts.top == null);
    if (CBZ.CONFIG.SHAFT_ESCAPE !== false && !h.bowl) {
      h.stepN = Math.max(6, Math.min(34, Math.round(depth / 1.3)));
      h.stepA0 = (h.seed % 1) * TAU;
      h.stepIn = h.mouth * 0.78;
    }
    const wall = buildWall(h);
    const lip = buildLip(h);
    const rubble = h.through ? null : buildFloorFurniture(h);
    const dish = buildDish(h);
    const stair = buildStair(h);
    /* THE BLACK — a disc at the very bottom under the rubble, so a shaft you
       cannot see the bottom of reads as bottomless rather than as a gap. A
       CRATER is the opposite: you can see its floor, and painting a void under
       it made a 5 m dish read as a hole to nowhere. Bowls get earth instead. */
    const dark = (h.bowl || h.through) ? null : new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 24),
      new THREE.MeshBasicMaterial({ color: 0x05040a }));
    if (dark) { dark.rotation.x = -Math.PI / 2; dark.position.set(x, h.bottom - 0.2, z); }
    wall.position.set(x, 0, z);
    lip.position.set(x, 0, z);
    // the collar is ground, so it takes ground's shadows too: an unshadowed
    // annulus inside a shadowed field is the ring again, drawn in light
    lip.receiveShadow = true;
    h.grp.add(wall, lip);
    if (dark) h.grp.add(dark);
    if (dish) h.grp.add(dish);
    if (rubble) h.grp.add(rubble);
    if (stair) h.grp.add(stair);
    h.grp.userData.groundShaft = true;
    root().add(h.grp);
    h.dispose = function () { disposeShaft(h); };
    live.push(h);
    if (pub.indexOf(h) < 0) pub.push(h);
    stats.cut++;
    clearInside(h);
    syncMask();
    attachCarving(h);
    return h;
  };

  /* NOTHING STANDS ON GROUND THAT IS NOT THERE. A tree, a crate or a lamp
     whose footing is inside the mouth is left hovering over the void by the
     ground mask — the props do not know the ground moved. They go with it.
     Two guards make this safe: an ACTOR's rig is never touched (bots and the
     player fall for real, through CBZ.body), and a mesh whose own footprint is
     bigger than the hole is never touched either — the island disc's origin is
     the island centre, and hiding "the mesh under the hole" without that test
     would delete the island the first time a shaft opened near the middle. */
  function clearInside(h) {
    const skip = [];
    const bots = CBZ.bots || [];
    for (let i = 0; i < bots.length; i++) if (bots[i].group) skip.push(bots[i].group);
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) if (peds[i].group) skip.push(peds[i].group);
    if (CBZ.playerChar && CBZ.playerChar.group) skip.push(CBZ.playerChar.group);
    h.hidden = [];
    const R2 = (h.mouth * 0.97) * (h.mouth * 0.97);
    const box = new THREE.Box3();
    (function walk(o) {
      if (!o || o.userData && o.userData.groundShaft) return;
      for (let i = 0; i < skip.length; i++) if (skip[i] === o) return;
      if (o.isMesh && o.visible && o.geometry) {
        const m = o.matrixWorld.elements;
        const dx = m[12] - h.x, dz = m[14] - h.z;
        if (dx * dx + dz * dz < R2 && m[13] > h.bottom && m[13] < h.gy + 16) {
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
          if ((box.max.x - box.min.x) < h.mouth * 1.6 && (box.max.z - box.min.z) < h.mouth * 1.6) {
            o.visible = false; h.hidden.push(o);
            return;
          }
        }
      }
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) walk(ch[i]);
    })(root());
  }

  function disposeShaft(h) {
    if (h._closed) return;
    h._closed = true;
    if (h.hidden) { for (let i = 0; i < h.hidden.length; i++) h.hidden[i].visible = true; h.hidden = null; }
    if (h.grp) {
      h.grp.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose && !o.material.vertexColors) o.material.dispose(); });
      if (h.grp.parent) h.grp.parent.remove(h.grp);
    }
    detachCarving(h);
    let i = live.indexOf(h); if (i >= 0) live.splice(i, 1);
    i = pub.indexOf(h); if (i >= 0) pub.splice(i, 1);
    syncMask();                 // the ground comes back the moment the record does not
  }
  CBZ.groundShaftClear = function (mode) {
    for (let i = live.length - 1; i >= 0; i--) if (!mode || live[i].mode === mode) disposeShaft(live[i]);
    for (let i = seqs.length - 1; i >= 0; i--) seqs[i].dispose();
    clearChunks();
  };

  /* ============================================================
     THE FLOOR — one function, and it is what everything falls into
     ============================================================ */
  function shaftFloor(h, x, z) {
    const dx = x - h.x, dz = z - h.z;
    const d = Math.hypot(dx, dz);
    if (d >= h.mouth) return null;
    if (h.stepN && d >= h.stepIn) {
      let f = (Math.atan2(dz, dx) - h.stepA0) / TAU;
      f -= Math.floor(f);
      const i = Math.min(h.stepN - 1, Math.floor(f * h.stepN));
      return h.bottom + (i + 1) * (h.depth / h.stepN);
    }
    const cone = d < h.coneR ? h.coneH * (1 - d / h.coneR) : 0;
    if (h.dish) {
      // rises from the centre out to the rim; the spoil cone sits on top of it
      const t = Math.min(1, d / h.dish.r);
      return h.bottom + Math.max(h.dish.h * t, cone);
    }
    return h.bottom + cone;
  }
  // "am I over a hole" — the ONE containment answer (nothing re-derives it)
  function nearestShaft(x, z) {
    for (let i = 0; i < live.length; i++) {
      const h = live[i];
      const dx = x - h.x, dz = z - h.z;
      if (dx * dx + dz * dz < h.mouth * h.mouth) return h;
    }
    return null;
  }
  CBZ.groundShaftAt = nearestShaft;
  // the same answer with a skirt, for the hazard tick (see tickHazards)
  function nearShaft(x, z, pad) {
    for (let i = 0; i < live.length; i++) {
      const h = live[i];
      const dx = x - h.x, dz = z - h.z, R = h.mouth + (pad || 0);
      if (dx * dx + dz * dz < R * R) return h;
    }
    return null;
  }
  // The floor override. `base` is what the ground would be with no hole in it.
  CBZ.groundShaftFloor = function (x, z, base) {
    for (let i = 0; i < live.length; i++) {
      const y = shaftFloor(live[i], x, z);
      if (y != null) return y;
    }
    return base;
  };

  /* THE FLOOR WRAP — in EVERY mode, and the reason is the stair.

     modes/survival.js's floorAt already subtracts CBZ.survHoles, so survival
     was covered for "there is nothing to stand on here". But it answers with
     the shaft's FLAT BOTTOM, and it must: it is fenced code that predates the
     rubble cone and the spiral of ledges, and the file cannot know about
     geometry the primitive invented. Left alone, the escape route would be
     drawn and not walkable — the exact class of fault CLAUDE.md's utility-pole
     lesson is about (two descriptions of one object, only one of them true).
     So the wrapper answers with `shaftFloor` — stair, cone and all — before
     the host's own floor is ever consulted, and the host's subtraction becomes
     a harmless second opinion nothing reaches.

     The `_city` marker is COPIED FORWARD (CLAUDE.md's explosion-wrapper rule,
     and here it is load-bearing: city mode.js's reset() re-captures an
     unmarked wrapper as its own base and the pair then recurse forever).
     Re-installed lazily whenever somebody else wraps after us, so the chain
     heals itself across a mode switch. survivorbot.js calls CBZ.surv.floorAt
     DIRECTLY, so bots keep landing on the flat bottom — which is correct for
     them anyway: they are the one actor in this game that cannot climb. */
  /* A SHAFT IS A CARVING. It used to be a WRAPPER around CBZ.floorAt — one more
     link in a five-deep chain of mode wrappers, each marking itself so the next
     reset would not capture itself and recurse. systems/solidground.js owns the
     floor now, so a hole is a record handed to it: a cylinder of removed
     material whose floor is shaped by this file's own stair-and-cone math,
     which therefore still lives in exactly one place. */
  function attachCarving(h) {
    if (!CBZ.addCarving) return;
    h.carve = CBZ.addCarving({
      kind: "cyl", x: h.x, z: h.z, r: h.mouth,
      y0: h.through ? h.bottom - 0.05 : h.bottom, y1: h.gy + 60,   // open to the sky
      floorFnSkip: !!h.through,
      open: true, dry: true, mode: h.mode, owner: "groundshaft",
      floorFn: h.through ? null : function (x, z) { const y = shaftFloor(h, x, z); return y == null ? h.bottom : y; },
    });
  }
  function detachCarving(h) {
    if (h.carve && CBZ.removeCarving) CBZ.removeCarving(h.carve);
    h.carve = null;
  }

  /* ============================================================
     FALLING DEBRIS — our own integrator, because systems/fx.js's is
     gated to survival mode and a city sinkhole must still crush people
     ============================================================ */
  function dropChunk(o) {
    mats();
    const s = o.size || 1.2;
    const B = BoxBuf();
    B.add(0, 0, 0, s, s * (0.35 + rnd() * 0.5), s * (0.7 + rnd() * 0.6), rnd() * TAU, o.color != null ? o.color : 0x51473b, 0.5);
    const m = B.mesh(rockMat);
    if (!m) return;
    m.position.set(o.x, o.y, o.z);
    root().add(m);
    chunks.push({
      m: m, x: o.x, z: o.z, y: o.y, vy: o.vy || 0, vx: o.vx || 0, vz: o.vz || 0,
      sx: (rnd() - 0.5) * 5, sz: (rnd() - 0.5) * 5, r: s * 0.7,
      dmg: o.dmg != null ? o.dmg : 0, landed: false, keep: !!o.keep, t: 0,
    });
  }
  function clearChunks() {
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      if (c.m.geometry) c.m.geometry.dispose();
      if (c.m.parent) c.m.parent.remove(c.m);
    }
    chunks.length = 0;
  }
  function tickChunks(dt) {
    const G = (CBZ.TUNE && CBZ.TUNE.gravity) || 22;
    for (let i = chunks.length - 1; i >= 0; i--) {
      const c = chunks[i];
      c.t += dt;
      if (!c.landed) {
        c.vy -= G * dt;
        c.x += c.vx * dt; c.z += c.vz * dt; c.y += c.vy * dt;
        c.m.position.set(c.x, c.y, c.z);
        c.m.rotation.x += c.sx * dt; c.m.rotation.z += c.sz * dt;
        const fl = CBZ.groundShaftFloor(c.x, c.z, rawFloor(c.x, c.z));
        if (c.y <= fl + c.r * 0.5) {
          c.y = fl + c.r * 0.5; c.landed = true;
          c.m.position.y = c.y;
          // CRUSHING — a slab of the street arriving on somebody at the bottom
          if (c.dmg > 0) {
            eachActor(function (a) {
              if (!a || !a.pos) return;
              if (Math.hypot(a.pos.x - c.x, a.pos.z - c.z) > c.r + 1.5) return;
              if (a.pos.y > c.y + 2.6) return;
              stats.crushed++;
              hurt(a, c.dmg, "crushed under the collapsing street", { fromX: c.x, fromZ: c.z, force: 6, fling: 1 });
            });
          }
          if (CBZ.shake && CBZ.camera && Math.hypot(CBZ.camera.position.x - c.x, CBZ.camera.position.z - c.z) < 45) CBZ.shake(0.12);
        }
      } else if (!c.keep && c.t > 14) {
        if (c.m.geometry) c.m.geometry.dispose();
        if (c.m.parent) c.m.parent.remove(c.m);
        chunks.splice(i, 1);
      }
    }
  }

  /* ============================================================
     THE COLLAPSE IS A SEQUENCE, NOT A POP
     warn → first drop → growth → aftermath. Self-driving: a caller makes
     ONE call and never has to tick it (the one-line adoption rule).
     ============================================================ */
  const FALL_SAFE = 11.0;   // m/s — mirrors systems/physics.js's city fall law
  const FALL_K = 0.95;      // (a full jump lands ~8.2 m/s and must stay free)

  CBZ.groundShaftCollapse = function (x, z, o) {
    if (!on()) return null;
    o = o || {};
    mats();
    const r = Math.max(3, o.r || 9);
    const seq = {
      x: x, z: z, r: r, rNow: r * 0.5, phase: "warn",
      t: 0, warnSecs: o.warnSecs != null ? o.warnSecs : 3.2,
      dropSecs: o.dropSecs != null ? o.dropSecs : 1.1,
      growSecs: o.growSecs != null ? o.growSecs : 4.0,
      // THE DEPTH IS SOLVED OFF THE FINAL RADIUS, ONCE. The first drop is a
      // narrow plug of the FULL depth (that is what a sinkhole does — it does
      // not deepen, it widens), so deriving depth from the plug's radius would
      // give a shallow crater that never recovers.
      depth: o.depth || Math.max(r * 2.4, r * 4.2),
      opts: o, shaft: null, cracks: [], dust: null,
      gy: rawFloor(x, z), done: false,
    };
    // ---- the warning is CRACKS AT THE REAL SITE ----
    const nC = 12;
    for (let i = 0; i < nC; i++) {
      const a = (i / nC) * TAU + rnd() * 0.2;
      const len = r * (0.5 + rnd() * 0.75);
      const g = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.12 + rnd() * 0.4),
        new THREE.MeshBasicMaterial({ color: 0x14100b, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      g.rotation.x = -Math.PI / 2;
      g.rotation.z = -a;
      const d = r * (0.55 + rnd() * 0.45);
      g.position.set(x + Math.cos(a) * d, seq.gy + 0.05, z + Math.sin(a) * d);
      g.renderOrder = 4;
      root().add(g);
      seq.cracks.push(g);
      // a slab tilting inward beside each crack — the ground is already going
      if (i % 3 === 0) {
        const B = BoxBuf();
        B.add(0, 0, 0, r * 0.34, 0.34, r * 0.3, 0, o.surface === "asphalt" ? 0x2f2e2c : (survMode() ? 0x4c5a34 : 0x2f2e2c), 0.75);
        const m = B.mesh(rockMat);
        m.position.set(x + Math.cos(a) * r * 0.72, seq.gy + 0.1, z + Math.sin(a) * r * 0.72);
        m.userData.tilt = a;
        root().add(m);
        seq.cracks.push(m);
      }
    }
    if (CBZ.fx && CBZ.fx.particleCloud) {
      seq.dust = CBZ.fx.particleCloud({ count: 210, radius: r * 1.25, top: 26, mode: "rise", vMin: 5, vMax: 16, color: 0xa9967c, size: 0.5, opacity: 0.5 });
      seq.dust.setActive(0.12);
    }
    sfx("rumble", x, z);
    seq.tick = function (dt) { tickSeq(seq, dt); };
    seq.dispose = function () {
      for (let i = 0; i < seq.cracks.length; i++) { const m = seq.cracks[i]; if (m.geometry) m.geometry.dispose(); if (m.material && m.material.dispose && !m.material.vertexColors) m.material.dispose(); if (m.parent) m.parent.remove(m); }
      seq.cracks.length = 0;
      if (seq.dust) { seq.dust.dispose(); seq.dust = null; }
      const i = seqs.indexOf(seq); if (i >= 0) seqs.splice(i, 1);
      seq.done = true;
    };
    seqs.push(seq);
    return seq;
  };

  function tickSeq(seq, dt) {
    seq.t += dt;
    const o = seq.opts;
    if (seq.dust) seq.dust.update(dt, seq.x, seq.gy - 1, seq.z);
    if (seq.phase === "warn") {
      const k = Math.min(1, seq.t / seq.warnSecs);
      for (let i = 0; i < seq.cracks.length; i++) {
        const m = seq.cracks[i];
        if (m.material && m.material.transparent) m.material.opacity = Math.min(0.85, k * 0.95);
        else if (m.userData.tilt != null) {
          // the slab tips INWARD and sinks — the ground giving before it goes
          m.rotation.x = -k * 0.42 * Math.cos(m.userData.tilt);
          m.rotation.z = -k * 0.42 * Math.sin(m.userData.tilt);
          m.position.y = seq.gy + 0.1 - k * 0.55;
        }
      }
      if (seq.dust) seq.dust.setActive(0.1 + k * 0.22);
      if (CBZ.shake && nearCam(seq.x, seq.z, 70)) CBZ.shake(0.02 + 0.07 * k);
      if (seq.t >= seq.warnSecs) firstDrop(seq);
      return;
    }
    if (seq.phase === "drop") {
      if (seq.dust) seq.dust.setActive(1);
      if (seq.t >= seq.dropSecs) { seq.phase = "grow"; seq.t = 0; }
      return;
    }
    if (seq.phase === "grow") {
      const k = Math.min(1, seq.t / seq.growSecs);
      if (seq.dust) seq.dust.setActive(0.85 - k * 0.45);
      const want = seq.r * (0.5 + 0.5 * k);
      if (want > seq.rNow + Math.max(0.35, seq.r * 0.06)) growTo(seq, want);
      if (k >= 1) {
        growTo(seq, seq.r);
        seq.phase = "open"; seq.t = 0;
        if (o.onOpen) try { o.onOpen(seq.shaft); } catch (e) {}
      }
      return;
    }
    // ---- aftermath: the standing shaft. The dust settles, the sequence
    //      retires, and the HOLE STAYS. Permanent damage is the point.
    if (seq.dust) {
      const f = Math.max(0, 0.4 - seq.t * 0.12);
      seq.dust.setActive(f);
      if (f <= 0.001) { seq.dust.dispose(); seq.dust = null; }
    }
    if (seq.t > 3.2) {
      for (let i = 0; i < seq.cracks.length; i++) { const m = seq.cracks[i]; if (m.geometry) m.geometry.dispose(); if (m.parent) m.parent.remove(m); }
      seq.cracks.length = 0;
      if (!seq.dust) { const i = seqs.indexOf(seq); if (i >= 0) seqs.splice(i, 1); seq.done = true; }
    }
  }

  function firstDrop(seq) {
    const o = seq.opts;
    seq.phase = "drop"; seq.t = 0;
    // the CORE goes first, at full depth: a sinkhole does not widen from a
    // scratch, it drops a plug and then eats its own edges
    seq.shaft = CBZ.groundShaft(seq.x, seq.z, {
      r: seq.rNow, depth: seq.depth, gy: seq.gy, seed: o.seed, surface: o.surface,
    });
    if (CBZ.shake && nearCam(seq.x, seq.z, 90)) CBZ.shake(0.55);
    sfx("collapse", seq.x, seq.z);
    rimShear(seq, 7);
    entrain(seq, seq.rNow);
  }

  function growTo(seq, want) {
    const o = seq.opts;
    const h = seq.shaft;
    seq.rNow = want;
    if (h) {
      // re-cut the shaft at the new radius. Six or seven rebuilds over four
      // seconds is cheaper than a vertex morph and lets the strata, the torn
      // lip and the stair all stay ONE solve.
      // the collar's colour is carried, not re-sampled: by the second re-cut
      // the props over the mouth are hidden and the ground under it is masked,
      // so a fresh sample could answer differently and the rim would change
      // colour mid-collapse
      const keep = { x: h.x, z: h.z, gy: h.gy, depth: h.depth, seed: h.seed, born: h.born, surface: o.surface, top: h.topColor, topSampled: h.topSampled };
      disposeShaft(h);
      seq.shaft = CBZ.groundShaft(keep.x, keep.z, { r: want, depth: keep.depth, gy: keep.gy, seed: keep.seed, surface: keep.surface, top: keep.top, topSampled: keep.topSampled });
      if (seq.shaft) seq.shaft.born = keep.born;   // the burial clock is the HOLE's age, not this rebuild's
    }
    rimShear(seq, 3);
    entrain(seq, want);
    if (CBZ.shake && nearCam(seq.x, seq.z, 70)) CBZ.shake(0.18);
  }

  // rim chunks shear off the edge and fall in — these are what crush you
  function rimShear(seq, n) {
    const h = seq.shaft; if (!h) return;
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU;
      // INSIDE the mouth, thrown further in — a slab that shears off the rim
      // topples into the void, it does not perch on the edge (and a chunk that
      // lands on the top ledge is a box floating in the picture)
      const d = h.r * (0.15 + rnd() * 0.5);
      const s = 0.7 + rnd() * 1.5;
      dropChunk({
        x: seq.x + Math.cos(a) * d, z: seq.z + Math.sin(a) * d, y: seq.gy + 0.6,
        vy: 0.6 + rnd() * 1.4, vx: -Math.cos(a) * (0.8 + rnd() * 1.8), vz: -Math.sin(a) * (0.8 + rnd() * 1.8),
        size: s, color: i % 3 === 0 ? h.surfaceColor : 0x584d40,
        dmg: 55 + s * 22, keep: i % 2 === 0,
      });
    }
  }

  /* ENTRAINMENT — the expanding radius takes what is standing on it. Actors go
     through CBZ.body (the airborne integrator that already exists), which is
     also what stops the bots TELEPORTING to the bottom: survivorbot.js pins
     pos.y to the floor every frame, but it skips a body CBZ.body.busy() owns,
     and a flung body is busy until it lands. They FALL. */
  function entrain(seq, r) {
    eachActor(function (a) {
      if (!a || !a.pos) return;
      const dx = a.pos.x - seq.x, dz = a.pos.z - seq.z;
      const d = Math.hypot(dx, dz);
      if (d > r * 1.06) return;
      if (a.pos.y > seq.gy + 3) return;
      if (CBZ.body && !(CBZ.body.busy && CBZ.body.busy(a))) {
        const m = d || 1;
        CBZ.body.hit(a, { dir: { x: -dx / m, z: -dz / m }, force: 3 + rnd() * 3, fling: 0.9 + rnd() * 0.8 });
      }
      if (a.isPlayer && CBZ.doSlowmo && !seq._beat) { seq._beat = 1; CBZ.doSlowmo(0.45); }
    });
    // kerbs, props and parked cars: the host knows how to throw its own
    // vehicles (survival has flingCar, the city has its wreck path), so the
    // caller supplies that as a seam rather than this file learning both.
    if (seq.opts.entrain) { try { seq.opts.entrain(seq.x, seq.z, r); } catch (e) {} }
    // city parked cars are seated off CBZ.floorAt but cache their last seat —
    // invalidate the cache so the ground disappearing under them is noticed.
    if (!survMode() && CBZ.cityCars) {
      const cars = CBZ.cityCars;
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (!c || !c.pos) continue;
        if (Math.hypot(c.pos.x - seq.x, c.pos.z - seq.z) > r + 4) continue;
        c._parkX = null; c._parkZ = null;
      }
    }
  }

  function nearCam(x, z, r) {
    if (!CBZ.camera) return false;
    const dx = CBZ.camera.position.x - x, dz = CBZ.camera.position.z - z;
    return dx * dx + dz * dz < r * r;
  }

  /* ============================================================
     WHAT HAPPENS TO A BODY IN THE HOLE
     ============================================================ */
  const BURY_DPS = 13;
  function tickHazards(dt) {
    if (!live.length) return;
    eachActor(function (a) {
      if (!a || !a.pos) return;
      /* TRACKING STARTS OUTSIDE THE RIM, AND THAT IS THE WHOLE FIX FOR THE
         BOTS. survivorbot.js writes `pos.y = floorAt(...)` every frame, so a
         bot that steps over the edge does not fall — it is TELEPORTED to the
         floor in one frame, and a fall measured from the first frame we saw it
         inside would read zero descent and cost it nothing. Watching from a
         few metres OUTSIDE means we hold its last standing height, so the
         teleport registers as exactly the drop it really was. (The ones caught
         by the collapse itself do fall honestly — entrain() hands them to
         CBZ.body, which owns them until they land.) */
      const h = nearShaft(a.pos.x, a.pos.z, 5);
      if (!h) { a._shaftIn = null; a._shaftPeak = 0; return; }
      const y = a.pos.y;
      const fy = shaftFloor(h, a.pos.x, a.pos.z);
      if (fy == null) {
        a._shaftIn = h; a._shaftPY = y; a._shaftPeak = 0; a._shaftLanded = true;
        return;                                   // beside the hole, on real ground
      }
      // ---- descent tracking → THE FALL ----
      // the growth phase REBUILDS the shaft record; a body already falling must
      // keep its descent history or the widening resets everyone's fall to zero
      if (a._shaftIn !== h) {
        const same = a._shaftIn && Math.abs(a._shaftIn.x - h.x) < 0.01 && Math.abs(a._shaftIn.z - h.z) < 0.01;
        a._shaftIn = h;
        if (!same) { a._shaftPeak = 0; a._shaftPY = y; a._shaftLanded = y <= fy + 1.4; }
      }
      const vy = dt > 0 ? (a._shaftPY - y) / dt : 0;
      a._shaftPY = y;
      if (vy > (a._shaftPeak || 0)) a._shaftPeak = vy;
      if (y > fy + 1.4) { a._shaftLanded = false; return; }
      if (!a._shaftLanded) {
        a._shaftLanded = true;
        const v = a._shaftPeak || 0;
        a._shaftPeak = 0;
        // physics.js prices the player's city fall already — don't bill twice
        const already = !survMode() && a.isPlayer;
        if (v > FALL_SAFE && !already) {
          const ex = v - FALL_SAFE;
          stats.falls++;
          hurt(a, FALL_K * ex * ex + ex * 2.0, "killed by the fall into the sinkhole", { fromX: h.x, fromZ: h.z });
          if (a.isPlayer && CBZ.shake) CBZ.shake(Math.min(1.4, 0.3 + ex * 0.05));
          if (CBZ.sfx && a.isPlayer) CBZ.sfx("ko");
        }
      }
      // ---- BURIAL: shifting soil against the walls of a fresh shaft ----
      if (CBZ.CONFIG.SHAFT_BURIAL === false) return;
      if (a.dead) return;
      const age = ((CBZ.now || 0) - h.born) / 1000;
      if (age > 45) return;                       // the spoil finds its angle of repose
      const d = Math.hypot(a.pos.x - h.x, a.pos.z - h.z);
      if (d < h.mouth * 0.46) return;             // out in the middle of the floor
      if (y > h.bottom + 3.0) return;             // up on a ledge, not down in it
      for (let i = 0; i < h.voids.length; i++) {
        const v = h.voids[i];
        if (Math.hypot(a.pos.x - v.x, a.pos.z - v.z) < v.r) { stats.voidSaves++; return; }
      }
      // PROTECT YOUR HEAD: crouching under the slab spall cuts most of it
      const crouched = a.isPlayer ? !!(CBZ.player && CBZ.player.crouch) : false;
      const dps = BURY_DPS * (crouched ? 0.3 : 1) * (1 - Math.min(0.75, age / 60));
      const before = a.isPlayer ? (CBZ.player && CBZ.player.hp) : a.hp;
      hurt(a, dps * dt, "buried alive in the sinkhole", { fromX: h.x, fromZ: h.z });
      const after = a.isPlayer ? (CBZ.player && CBZ.player.hp) : a.hp;
      if (before > 0 && after != null && after <= 0) stats.buried++;
    });
  }

  /* ============================================================
     ONE UPDATER, ANY MODE
     ============================================================ */
  CBZ.onUpdate(28.6, function (dt) {
    if (!on()) return;
    // before the early-out: a readout that only appears once a hole exists
    // cannot tell you whether the flag is even on
    debugHud(dt);
    if (!live.length && !seqs.length && !chunks.length) return;
    /* EXTERNAL CLEAR = RESET. The survival director empties CBZ.survHoles on
       match start and on mode exit; that array IS our registry, so an empty
       published list with live records means the world was reset under us and
       these meshes are orphans. Anything else is re-published. */
    if (!pub.length && live.length) {
      for (let i = live.length - 1; i >= 0; i--) if (live[i].mode === "survival") disposeShaft(live[i]);
      for (let i = seqs.length - 1; i >= 0; i--) seqs[i].dispose();
      clearChunks();
    }
    for (let i = 0; i < live.length; i++) if (pub.indexOf(live[i]) < 0) pub.push(live[i]);
    // re-wrap in ANY mode if somebody re-installed a floor after us (a city
    // reset, a mode switch): the wrapper is what makes the stair walkable
    /* THE SLOTS FOLLOW THE EYE, so they are re-dealt every frame a hole is
       open. core/groundmask.js only sorts when there are more holes than
       slots; below that this is a handful of Vector4 writes. There is no
       longer anything to heal or re-sweep — a material swapped by a quality
       tier change arrives already carrying the discard. */
    if (live.length) syncMask();
    for (let i = seqs.length - 1; i >= 0; i--) { const s = seqs[i]; if (!s.done) s.tick(dt); }
    tickChunks(dt);
    tickHazards(dt);
  });

  /* ============================================================
     ?cfg_SHAFT_DEBUG=1 — THE AUDIT, ON THE DEVICE THAT HAS THE BUG

     The ring fault reproduces on the owner's phone and not on any machine I
     can run a browser on, and the three mechanisms I could name from reading
     the code all measured clean here (a WebGL1 context, an iPhone viewport,
     and core/gfx.js's quality-tier material swap each left lidsOverMouth at
     0). At that point more guessing is worth less than one screenshot of the
     real numbers from the real device, so the audit gets a readout: open the
     game with ?cfg_SHAFT_DEBUG=1, stand near a sinkhole, photograph the
     corner. `lids` is the whole question — non-zero means ground is still
     drawing over the mouth and names how many surfaces, `rings` means a shaft
     is drawn with no mask slot, and `reMask`/`reSweep` say whether the
     self-heal is firing (and therefore what it is fighting). */
  if (CBZ.CONFIG.SHAFT_DEBUG == null) CBZ.CONFIG.SHAFT_DEBUG = false;
  let dbgEl = null, dbgT = 0;
  function debugHud(dt) {
    if (!CBZ.CONFIG.SHAFT_DEBUG) return;
    dbgT += dt;
    if (dbgT < 0.5) return;
    dbgT = 0;
    try {
      if (!dbgEl) {
        dbgEl = document.createElement("div");
        dbgEl.style.cssText = "position:fixed;left:6px;bottom:6px;z-index:2147483647;pointer-events:none;" +
          "font:11px ui-monospace,Menlo,monospace;color:#9fe8c3;background:rgba(0,0,0,.62);" +
          "padding:6px 8px;border-radius:6px;white-space:pre;max-width:62vw";
        document.body.appendChild(dbgEl);
      }
      const a = CBZ.shaftAudit();
      const cap = CBZ.renderer && CBZ.renderer.capabilities;
      dbgEl.style.color = (a.lidsOverMouth || a.ringsOnSolidGround) ? "#ff9c9c" : "#9fe8c3";
      dbgEl.textContent =
        "shafts " + a.shafts + "  LIDS " + a.lidsOverMouth + "  rings " + a.ringsOnSolidGround +
        "\nslots " + a.maskSlots + "/" + a.unslottedShafts + " unslotted  swept " + a.sweptMeshes +
        "\ncollar " + a.collarSampled +
        "\nthroat " + a.throatShade + "  q" + (CBZ.qualityAutoStats ? CBZ.qualityAutoStats.level : "?") +
        "  pbr" + ((CBZ.gfxTier && CBZ.gfxTier.pbr) ? 1 : 0) +
        "\ngl" + (cap && cap.isWebGL2 ? 2 : 1) + " " + (cap ? cap.precision : "?");
    } catch (e) { /* a readout that throws is worse than no readout */ }
  }

  /* ============================================================
     CBZ.shaftAudit() — the ratchet.

     Measured off LIVE state, never counted in the source:
       holesOnSlopes   0  — HARD INVARIANT. A shaft whose own footprint slope
                            exceeds the law is a sinkhole on a mountainside,
                            which the owner ruled out by name.
       holeSlopeMax       the worst slope any live shaft actually sits on
       deepOverWide    ≥2 — the reference reads as a shaft, not a crater
       cityShaftReady     can the main world cut one at all (flag + registries)
       privateHoles    0  — shaft geometry registered nowhere (the old failure
                            mode: a hole drawn but not subtracted from a floor)
       ringsOnSolidGround
                       0  — HARD INVARIANT, and the one this file got wrong for
                            a whole release: a shaft DRAWN over ground that is
                            still being drawn. That is a lip collar lying on
                            unbroken grass with the road running across it —
                            a hole you cannot see and fall into anyway, because
                            the floor query never had the mask's slot limit.
       playerInUnslotted
                       0  — HARD INVARIANT: the player standing inside a shaft
                            that is not being drawn. The slot ranking pins an
                            occupied shaft, so this is 0 by construction and
                            not merely by luck.
       throatShade        the brightness of the only wall a camera at a normal
                          depression angle can see (0.35 radii under the rim).
                          Sunlit ground beside it is ~1.0, so this is the
                          number that decides whether a sinkhole at 80 m reads
                          as a hole or as a ring. It was 0.63.
       rimShade           the ladder at the rim itself — the brightest surface
                          anywhere in the shaft (was 1.0: fully lit)
       collarSampled      shafts whose lip collar wears the colour of the
                          ground it was cut from rather than generic soil
       lidsOverMouth   0  HARD INVARIANT once a hole has finished opening, and
                          the only field that can catch a ground mask which
                          silently did not take: a flat, visible, UNMASKED
                          surface still spanning the mouth. Shafts still being
                          widened are excluded — the sweep chases the growing
                          radius by design and reads ~12 mid-collapse.
       maskSlots          how many holes the ground can be cut for at once
       unslottedShafts    holes past that cap (hidden, not ringed)
       nearestUnslotted   metres from the eye to the closest hole that is NOT
                          being drawn — the headroom on the LOD. Small means
                          the cap is being felt where it can be seen.
     falls / crushed / buried / voidSaves are printed beside them so a build
     that "passes" by never opening a hole cannot look like a working one.
     ============================================================ */
  /* HAS THE GROUND ACTUALLY STOPPED DRAWING? `ringsOnSolidGround` above only
     checks the SLOT BOOKKEEPING — it says a drawn shaft was dealt a uniform,
     never that the surface over the mouth was one the sweep could patch. A
     material with no anchor we recognise is left alone by design, and that
     degrade path is silent: the hole keeps its lid and nothing counts it. So
     count it. Raycasting cannot answer (the discard is a fragment decision;
     the geometry is still there to hit), so the question asked is the one that
     actually decides it — is there a flat, visible, UNMASKED surface across
     the mouth. Cheap enough for a tool, and it is the only number that would
     have caught a mask that never took. */
  /* The definition is tools/sinkhole-check.mjs's, deliberately verbatim in
     spirit: a LID is a surface (under 3 m thick) that REACHES THE GROUND PLANE
     and is at least 1.5 m across. Both clauses matter. The ground-plane test is
     what separates a lid from a thing merely standing over a mouth — a parked
     car above an open hole is not a lid, it is a car about to fall in, which is
     the feature working — and the footprint test keeps a bolt-head off the
     count. An actor's rig is never a lid either; bodies fall for real. */
  // is this shaft still being widened by a running collapse sequence?
  function inCollapse(h) {
    for (let i = 0; i < seqs.length; i++) if (seqs[i].shaft === h && seqs[i].phase !== "open") return true;
    return false;
  }
  function lidsOverMouth(h) {
    let n = 0;
    try {
      const box = new THREE.Box3();
      const rigs = [];
      const bots = CBZ.bots || [];
      for (let i = 0; i < bots.length; i++) if (bots[i] && bots[i].group) rigs.push(bots[i].group);
      const peds = CBZ.cityPeds || [];
      for (let i = 0; i < peds.length; i++) if (peds[i] && peds[i].group) rigs.push(peds[i].group);
      if (CBZ.playerChar && CBZ.playerChar.group) rigs.push(CBZ.playerChar.group);
      root().traverse(function (o) {
        if (!o.isMesh || !o.visible || !o.geometry || !o.material) return;
        for (let p = o; p; p = p.parent) {
          if (p.userData && p.userData.groundShaft) return;
          if (rigs.indexOf(p) >= 0) return;
        }
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        // masked unless it opted out (#define) or has no fog chunks to carry it
        if (!mat) return;
        if (mat.fog !== false && !(mat.defines && mat.defines.CBZ_NOMASK)) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        if (box.max.y - box.min.y > 3) return;
        if (box.max.y < h.gy - 3 || box.min.y > h.gy + 0.35) return;
        if (box.max.x < h.x - h.mouth || box.min.x > h.x + h.mouth) return;
        if (box.max.z < h.z - h.mouth || box.min.z > h.z + h.mouth) return;
        if (Math.max(box.max.x - box.min.x, box.max.z - box.min.z) < 1.5) return;
        n++;
      });
    } catch (e) {}
    return n;
  }
  CBZ.shaftAudit = function () {
    let worst = 0, onSlope = 0, dow = 0, deepest = 0, priv = 0, rings = 0, nearUn = Infinity, inUn = 0;
    let lids = 0, sampled = 0, throat = 0, rim = 0;
    const eye = CBZ.groundMaskEye ? CBZ.groundMaskEye()
      : { x: CBZ.camera ? CBZ.camera.position.x : 0, z: CBZ.camera ? CBZ.camera.position.z : 0 };
    const ex = eye.x, ez = eye.z;
    for (let i = 0; i < live.length; i++) {
      const h = live[i];
      const s = CBZ.groundShaftSlope(h.x, h.z, h.r);
      if (s > worst) worst = s;
      if (s > CBZ.CONFIG.SHAFT_SLOPE_MAX) onSlope++;
      dow += h.depth / (h.r * 2);
      if (h.depth > deepest) deepest = h.depth;
      if (pub.indexOf(h) < 0) priv++;
      if (h.topSampled) sampled++;
      throat += throatShade(h);
      rim += skyOcc(h, 0);
      /* ONLY A SETTLED HOLE IS ASKED. A shaft still growing is re-cut six or
         seven times and the chunk mask covers every radius it passes through, so
         mid-collapse there are legitimately road and kerb meshes over the
         mouth that have not been reached yet — measured at 12 on the first
         drop, 0 by the time the radius stops. Counting those would make this
         a number that is meant to be non-zero sometimes, which is not an
         invariant at all, just a reading. */
      if (i < 4 && !inCollapse(h)) lids += lidsOverMouth(h);
      const hasSlot = slotted.indexOf(h) >= 0;
      if (!hasSlot) {
        const d = Math.hypot(h.x - ex, h.z - ez);
        if (d < nearUn) nearUn = d;
        if (h.grp && h.grp.visible) rings++;      // drawn with the ground still over it
        const pp = CBZ.player && CBZ.player.pos;
        if (pp && Math.hypot(h.x - pp.x, h.z - pp.z) < h.mouth) inUn++;
      }
    }
    return {
      shafts: live.length,
      published: pub.length,
      privateHoles: priv,
      maskSlots: CBZ.groundMaskSlots || 0,
      maskInstalled: !!(CBZ.groundMaskAudit && CBZ.groundMaskAudit().installed),
      unslottedShafts: Math.max(0, live.length - slotted.length),
      ringsOnSolidGround: rings,
      playerInUnslotted: inUn,
      // THE DISTANT READ. throatShade is the brightness of the only wall a
      // camera at a normal depression angle can see — the number that decided
      // whether a sinkhole at 80 m was a hole or a ring. Ground around it sits
      // near 1.0, so this has to stay well under it.
      throatShade: live.length ? +(throat / live.length).toFixed(3) : 0,
      rimShade: live.length ? +(rim / live.length).toFixed(3) : 0,
      collarSampled: sampled,
      lidsOverMouth: lids,
      nearestUnslotted: nearUn === Infinity ? null : +nearUn.toFixed(1),
      holeSlopeMax: +worst.toFixed(3),
      holesOnSlopes: onSlope,
      slopeLaw: CBZ.CONFIG.SHAFT_SLOPE_MAX,
      deepest: +deepest.toFixed(1),
      deepOverWide: live.length ? +(dow / live.length).toFixed(2) : 0,
      voidsPerShaft: live.length ? live[0].voids.length : 0,
      stepsPerShaft: live.length ? live[0].stepN : 0,
      escapeReady: CBZ.CONFIG.SHAFT_ESCAPE !== false,
      cityShaftReady: !!(CBZ.CONFIG.CITY_SINKHOLES && CBZ.roadJunctions && CBZ.city && CBZ.city.arena),
      floorOwned: !!(CBZ.floorAt && CBZ.floorAt._solid),
      carvings: (CBZ.carvings || []).length,
      sequences: seqs.length,
      chunks: chunks.length,
      cut: stats.cut, siteRejects: stats.siteRejects,
      // the self-heal's own record: how often a ground material had to be
      // re-stamped because something swapped it, and how many re-sweeps ran
      // the discovery is gone: nothing is swept, so this is 0 by construction
      sweptMeshes: 0,
      falls: stats.falls, crushed: stats.crushed, buried: stats.buried, voidSaves: stats.voidSaves,
    };
  };

  /* ============================================================
     THE CITY EVENT. Default OFF: a sinkhole that can open under you at
     random is not a feature, it is weather. This is the door the city
     runs an EVENT through — one call, and the placement law picks the
     intersection.
     ============================================================ */
  CBZ.cityOpenSinkhole = function (o) {
    o = o || {};
    if (!on() || CBZ.CONFIG.CITY_SINKHOLES === false) return null;
    const r = o.r || (9 + rnd() * 4);
    const site = o.x != null ? { x: o.x, z: o.z } : CBZ.groundShaftSite({ r: r, minDist: o.minDist || 45, maxDist: o.maxDist || 300 });
    if (!site) return null;
    return CBZ.groundShaftCollapse(site.x, site.z, {
      r: r, depth: o.depth || r * 4.0, surface: "asphalt",
      warnSecs: o.warnSecs != null ? o.warnSecs : 3.4,
      growSecs: o.growSecs != null ? o.growSecs : 4.5,
      seed: o.seed,
    });
  };
})();
