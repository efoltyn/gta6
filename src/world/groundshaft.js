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
  const chunks = [];          // crush trackers riding the falling rim slabs (the slabs are CBZ.debris)
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

  /* EVERY HEX IN THIS FILE IS A PAINT CHIP (sRGB), AND A VERTEX COLOUR IS
     LINEAR. The renderer writes sRGB out (outputEncoding = sRGBEncoding) and
     r128 multiplies vertex colours in as they stand, so `((hex >> 16) & 255)
     / 255` laid 0x2f2e2c down as 0.18 linear, three times the island's own
     asphalt (0.055) and grey, and the 0x8e8b83 base course as 0.55: the rim
     of every sinkhole was a pale grey band printed round a dark road, and a
     tan one round the grass. Decode once, here, and the section is the
     albedo it claims to be (asphalt 0.025, gravel 0.27, soil 0.07..0.14). */
  const _lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; _lin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lin(hex, k, out) {
    out[0] = _lin[(hex >> 16) & 255] * k; out[1] = _lin[(hex >> 8) & 255] * k; out[2] = _lin[hex & 255] * k;
    return out;
  }
  /* An exempt CLONE of a material (groundmask.js's #define opt-out), cached
     per source and marked shared so a shaft's dispose never frees it. A clone,
     never the original: CBZ.cmat caches by colour, and the pavement can be the
     same object as a pair of trousers. world/sinkhole.js uses the same one. */
  const exClones = new Map();
  function exemptClone(m) {
    if (!m || (m.defines && m.defines.CBZ_NOMASK)) return m;
    let c = exClones.get(m);
    if (!c) {
      c = m.clone();
      if (m.onBeforeCompile) c.onBeforeCompile = m.onBeforeCompile;
      if (m.customProgramCacheKey) c.customProgramCacheKey = m.customProgramCacheKey;
      if (CBZ.groundMaskExempt) CBZ.groundMaskExempt(c);
      c._shared = true;
      exClones.set(m, c);
    }
    return c;
  }

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
      /* a running sinkhole EVENT may stand its own crust in for the ground
         before any shaft exists (world/sinkhole.js: the sagging cover is real
         slabs, and the ground under them has to stop drawing) */
      for (let i = 0; i < seqs.length; i++) {
        const m = seqs[i].mask;
        if (m && m.r > 0 && !seqs[i].done) maskReq.push({ x: m.x, z: m.z, r: m.r, y: m.y, src: seqs[i] });
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
  /* `o.undermine`: the caller WANTS a building at its lip and will take it
     down properly (world/sinkhole.js tilts it and hands it to the collapse
     engine) — so a footprint the hole only bites into is allowed, and only a
     building whose middle would stand over the mouth is still refused. */
  CBZ.groundShaftCanOpen = function (x, z, r, o) {
    const undermine = !!(o && o.undermine);
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
        const dB = Math.hypot(x - bx, z - bz);
        if (undermine ? dB < r + half * 0.35 : dB < r * 0.85 + half) return { ok: false, why: "building", slope: slope };
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
      const can = CBZ.groundShaftCanOpen(x, z, r, o);
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

  /* THE SURFACE ITSELF, not just its colour. One downward ray finds what the
     hole was cut from: its material, its vertex tint at that point (linear,
     as the ground's own vertices carry it) and the AFFINE map from world xz
     to its UVs (the ground is planar-mapped, so three vertices of the hit
     triangle give the map everywhere). The collar is then drawn IN that
     material with those UVs, so the turf or the tarmac runs on unbroken to the
     torn edge: the old collar was a flat hex (the sample refused every mapped
     ground, i.e. all of them, and fell back to 0x2f2e2c) laid as a smooth
     untextured annulus across textured grass and road, which is the grey band.
     Cached per centre, so a widening sinkhole's five re-cuts ray once. */
  const surfCache = new Map();
  const _tri = new THREE.Triangle(), _bc = new THREE.Vector3(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3();
  function groundSurfaceAt(x, z, gy) {
    const key = Math.round(x * 4) + "," + Math.round(z * 4) + "," + Math.round(gy * 4) + "," + (CBZ.game ? CBZ.game.mode : "");
    if (surfCache.has(key)) return surfCache.get(key);
    let out = null;
    try {
      const rc = new THREE.Raycaster(new THREE.Vector3(x, gy + 50, z), new THREE.Vector3(0, -1, 0), 0, 100);
      if (CBZ.camera) rc.camera = CBZ.camera;      // r128 Sprite.raycast derefs this
      const hits = rc.intersectObject(root(), true) || [];
      for (let i = 0; i < hits.length && !out; i++) {
        const o = hits[i].object;
        if (!o || !o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible || !o.material) continue;
        let p = o, mine = false;
        // anything this project DREW to replace ground is not the ground it
        // replaced — a shaft's liner, a dig site's soil, a falling slab
        while (p) {
          const u = p.userData;
          if (u && (u.groundShaft || u.digSite || u.sinkBody || u.debrisPiece || u.isActor)) { mine = true; break; }
          p = p.parent;
        }
        if (mine) continue;
        // a canopy, a roof or a sign is not the ground; the ground is the
        // surface at the height the shaft's own rim was solved from
        const py = hits[i].point.y;
        if (py > gy + 2.5 || py < gy - 2.5) continue;
        const face = hits[i].face;
        const mat = Array.isArray(o.material) ? (face && o.material[face.materialIndex]) || o.material[0] : o.material;
        // lane paint and decals are see-through layers ON the ground
        if (!mat || !mat.color || mat.transparent || mat.isShaderMaterial) continue;
        const geo = o.geometry, pos = geo.attributes && geo.attributes.position;
        if (!pos || !face) continue;
        _pa.fromBufferAttribute(pos, face.a).applyMatrix4(o.matrixWorld);
        _pb.fromBufferAttribute(pos, face.b).applyMatrix4(o.matrixWorld);
        _pc.fromBufferAttribute(pos, face.c).applyMatrix4(o.matrixWorld);
        const ca = geo.getAttribute("color");
        const col = [1, 1, 1];
        if (mat.vertexColors && ca) {
          _tri.set(_pa, _pb, _pc).getBarycoord(hits[i].point, _bc);
          col[0] = ca.getX(face.a) * _bc.x + ca.getX(face.b) * _bc.y + ca.getX(face.c) * _bc.z;
          col[1] = ca.getY(face.a) * _bc.x + ca.getY(face.b) * _bc.y + ca.getY(face.c) * _bc.z;
          col[2] = ca.getZ(face.a) * _bc.x + ca.getZ(face.b) * _bc.y + ca.getZ(face.c) * _bc.z;
        }
        // the affine world-xz -> uv map, from the hit triangle
        let uvm = null;
        const ua = geo.getAttribute("uv");
        if (mat.map && ua) {
          const ex = _pb.x - _pa.x, ez = _pb.z - _pa.z, fx = _pc.x - _pa.x, fz = _pc.z - _pa.z;
          const det = ex * fz - ez * fx;
          if (Math.abs(det) > 1e-8) {
            const du1 = ua.getX(face.b) - ua.getX(face.a), du2 = ua.getX(face.c) - ua.getX(face.a);
            const dv1 = ua.getY(face.b) - ua.getY(face.a), dv2 = ua.getY(face.c) - ua.getY(face.a);
            const ux = (du1 * fz - du2 * ez) / det, uz = (du2 * ex - du1 * fx) / det;
            const vx = (dv1 * fz - dv2 * ez) / det, vz = (dv2 * ex - dv1 * fx) / det;
            uvm = [ua.getX(face.a) - ux * _pa.x - uz * _pa.z, ux, uz, ua.getY(face.a) - vx * _pa.x - vz * _pa.z, vx, vz];
          }
        }
        // a mapped ground with no usable UVs cannot be continued: next layer
        if (mat.map && !uvm) continue;
        const q = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
        out = {
          mat: mat, col: col, uvm: uvm,
          /* the flat colour, LINEAR-packed. A textured surface does not keep
             its colour in material.color (that is a TINT of the map, white
             for the city's road plates — reading it once produced a WHITE lip
             collar round every city hole), so a mapped surface has no flat
             answer: hex is null and the caller falls back. */
          hex: mat.map ? null : (q(mat.color.r * col[0]) << 16) | (q(mat.color.g * col[1]) << 8) | q(mat.color.b * col[2]),
        };
      }
    } catch (e) { out = null; /* no answer is not a crash: the caller falls back */ }
    if (surfCache.size > 48) surfCache.delete(surfCache.keys().next().value);
    surfCache.set(key, out);
    return out;
  }
  function groundColorAt(x, z, gy) {
    const s = groundSurfaceAt(x, z, gy);
    return s ? s.hex : null;
  }
  /* PUBLISHED, because a second thing needed it. systems/digsite.js was
     painting its undisturbed surface a hardcoded olive, which is a fine guess
     for grass and wrong everywhere else — photographed on the island it was a
     34 m cream disc lying in green grass. It needs the answer this function
     already works out (including the two things it learned the hard way: a
     textured plate's material.color is a white TINT, not a colour, and a
     vertexColors ground needs its face tint applied). One implementation. */
  CBZ.groundColorAt = groundColorAt;

  /* ============================================================
     THE SECTION IS REAL GEOLOGY, IN METRES — NOT A WALLPAPER IN FRACTIONS.

     A cover-collapse sinkhole is a hole through a COVER (the road and the
     earth it was built on) into a CAVITY in soluble rock. Its wall is a
     section through exactly that, top to bottom, and every layer has a real
     thickness that does not scale with the hole:

       asphalt        0.12 m   the wearing course, black, sheared clean
       base course    0.38 m   crushed limerock under it, grey-tan
       (or topsoil    0.35 m   off-road: the dark organic layer)
       soil           ~2 m     brown, loose, ERODED BACK — the water main
                               that broke here washed it out from behind
       clay           to ~30%  red-brown, plastic, holds a vertical face
       limestone      the rest pale bedded rock, standing PROUD of the cover
                               in ledges along its bedding planes

     The old ladder was eight colours placed at FRACTIONS of the depth, so a
     40 m hole had a 2.4 m band of "topsoil" and the road had no section at
     all. The value still alternates down the wall (a band only reads against
     a neighbour of different brightness), and everything still goes dark
     with depth through the ONE sky-occlusion ladder, skyOcc().

     Each layer also has its own RADIUS: the loose soil recesses, the clay
     stands, the limestone juts. Two rows share every layer boundary at the
     same height with different radii and colours, so each boundary is a real
     horizontal step in the wall, not a gradient — the crumbling, stepped
     face of every photographed collapse.
     ============================================================ */
  function layersOf(h) {
    if (h._layers) return h._layers;
    const L = [];
    const D = h.depth;
    if (h.road) {
      L.push({ name: "asphalt", top: 0, bot: 0.12, c: 0x2b2a28, rf: 1.0, n: 0.008 });
      L.push({ name: "base course", top: 0.12, bot: 0.5, c: 0x8a7f6c, rf: 1.006, n: 0.012 });
    } else {
      L.push({ name: "topsoil", top: 0, bot: 0.35, c: 0x3b2a1a, rf: 1.0, n: 0.012 });
    }
    const s0 = L[L.length - 1].bot;
    const soilBot = Math.min(D * 0.25, s0 + 2.1 + hs(h, 3, 3) * 0.8);
    L.push({ name: "soil", top: s0, bot: soilBot, c: 0x6a4d31, rf: 1.045, n: 0.05 });
    const clayBot = Math.min(D * 0.6, Math.max(soilBot + 2.5, D * (0.26 + hs(h, 4, 4) * 0.08)));
    L.push({ name: "clay", top: soilBot, bot: clayBot, c: 0x8f5434, rf: 1.02, n: 0.03 });
    // limestone, bedded: alternating pale and grey beds 1.6-3.2 m thick
    let y = clayBot, k = 0;
    while (y < D - 0.01) {
      const th = 1.6 + hs(h, 9 + k, 2) * 1.6;
      const bot = Math.min(D, y + th);
      L.push({ name: "limestone", top: y, bot: bot, c: k % 2 ? 0x8a826c : 0xb8ae94, rf: 0.965 + hs(h, 11 + k, 5) * 0.03, n: 0.022 });
      y = bot; k++;
    }
    h._layers = L;
    return L;
  }
  /* PUBLISHED: the sinkhole event's crust slabs cut through the same section,
     so they read it here rather than keeping a copy. */
  CBZ.groundShaftLayers = function (h) { return layersOf(h); };
  function layerAt(h, dm) {
    const L = layersOf(h);
    for (let i = 0; i < L.length; i++) if (dm < L[i].bot) return L[i];
    return L[L.length - 1];
  }
  /* Angular noise must WRAP. Hashing the raw bearing leaves a visible seam
     down the wall at 0 rad (the last column and the first are neighbours in
     space but strangers to the hash), so every angular input below is the
     bearing's cos/sin — a closed curve, and the seam cannot exist. */
  function layerColor(h, dm, ang, hex, out) {
    // DARK WITH DEPTH: no light reaches down a deep shaft. Multiplicative, so
    // the beds still read near the top, where you are standing looking down.
    const dark = skyOcc(h, dm);
    const mot = 0.86 + hs(h, Math.cos(ang) * 9.7, Math.sin(ang) * 9.7 + dm * 1.7) * 0.28;
    lin(hex, dark * mot * wetAt(dm), out);
  }
  /* WET LOWER DOWN. Earth darkens as it holds water (a damp loam is ~0.6 of
     its dry albedo) and a collapse face is wettest where the groundwater and
     the broken main reach it: the top half metre is the dry crust, the rest
     of the cover darkens toward the clay. Multiplies the sky ladder, so the
     beds still read where you stand looking down. */
  function wetAt(dm) { return 1 - 0.32 * Math.min(1, Math.max(0, (dm - 0.4) / 3.2)); }
  // the fraction-of-depth entry the dish floor uses
  function strataColor(h, t, ang, out) {
    const dm = h.depth * t;
    layerColor(h, dm, ang, layerAt(h, dm).c, out);
  }

  // radius profile: sheer, slightly tapering, every layer at its own radius
  // (see layersOf), crumbling — the noise is per layer and per row so the
  // face is broken, not machined.
  function wallRadius(h, dm, ang, L, row) {
    const t = dm / h.depth;
    const taper = 1 - 0.08 * t * t;
    const n = L ? L.n : 0.03;
    const noise = 1 + (hs(h, Math.cos(ang) * 2.3 + row * 0.71, Math.sin(ang) * 2.3 + dm * 0.37) - 0.5) * 2 * n;
    const lump = 1 + (hs(h, Math.cos(ang) * 0.9, Math.sin(ang) * 0.9 + (L ? L.top : 0)) - 0.5) * n * 0.8;
    return h.r * (L ? L.rf : 1) * taper * noise * lump;
  }

  function buildWall(h) {
    const seg = 48;
    const L = layersOf(h);
    // rows: the top and bottom of every layer (two rows at each boundary,
    // one per layer, so the step is a real face), plus filler rows every
    // 2.4 m or less inside a thick layer
    const rows = [];
    for (let i = 0; i < L.length; i++) {
      const ly = L[i];
      const th = ly.bot - ly.top;
      const n = Math.max(1, Math.ceil(th / 2.4));
      for (let k = 0; k <= n; k++) rows.push({ dm: ly.top + th * (k / n), L: ly, edge: k === 0 || k === n });
    }
    const nr = rows.length;
    const pos = new Float32Array((seg + 1) * nr * 3);
    const col = new Float32Array((seg + 1) * nr * 3);
    const idx = [];
    const c = [0, 0, 0];
    let p = 0;
    for (let j = 0; j < nr; j++) {
      const R = rows[j];
      const y = h.gy - R.dm;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU;
        // a boundary row keeps one jitter for both its rows, so the step
        // between two layers is a clean ledge and the faces stay closed
        const rad = wallRadius(h, R.dm, a, R.L, R.edge ? 0 : j);
        pos[p] = Math.cos(a) * rad; pos[p + 1] = y; pos[p + 2] = Math.sin(a) * rad;
        layerColor(h, R.dm, a, R.L.c, c);
        col[p] = c[0]; col[p + 1] = c[1]; col[p + 2] = c[2];
        p += 3;
      }
    }
    for (let j = 0; j < nr - 1; j++) {
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

  /* THE FLOOR OF THE SHAFT IS A SURFACE. There used to be a black disc down
     there — a decal standing in for "you cannot see the bottom". The bottom is
     the rubble the cover fell in as: a low mound highest in the middle (the
     same `coneH` curve shaftFloor() answers with, so what you see is what you
     land on), coloured by the same darkness ladder as the wall it meets. At
     three radii down that ladder is near black anyway; it is black because no
     light gets there, not because a disc was painted. */
  function buildTalusFloor(h) {
    if (h.bowl || h.through) return null;
    const seg = 32, rings = 6;
    const R = h.r * 1.02;
    const pos = new Float32Array((seg + 1) * (rings + 1) * 3);
    const col = new Float32Array((seg + 1) * (rings + 1) * 3);
    const idx = [];
    const c = [0, 0, 0];
    let p = 0;
    for (let j = 0; j <= rings; j++) {
      const rr = (j / rings) * R;
      const cone = rr < h.coneR ? h.coneH * (1 - rr / h.coneR) : 0;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU;
        const wob = 1 + (hs(h, Math.cos(a) * 3.1 + j, Math.sin(a) * 3.1) - 0.5) * 0.08;
        const y = h.bottom + cone + (hs(h, Math.cos(a) * 5 + j * 1.3, Math.sin(a) * 5) - 0.5) * 0.35 - 0.05;
        pos[p] = h.x + Math.cos(a) * rr * wob; pos[p + 1] = y; pos[p + 2] = h.z + Math.sin(a) * rr * wob;
        layerColor(h, h.gy - y, a, j % 2 ? 0x6a5a48 : 0x56483a, c);
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

  /* WATER AT THE BOTTOM. Groundwater seeps in through the limestone and a
     broken main pours in from above, so a fresh sinkhole has a pool in it
     that rises. It is a surface at a LEVEL (metres above the bottom) carried
     across re-cuts, darkened by the same ladder as the wall beside it, and
     moved by CBZ.groundShaftWater(h, level) — the sinkhole event drives it. */
  let waterMat = null;
  function buildWater(h) {
    if (h.bowl || h.through || !(h.waterLevel > 0)) return null;
    if (!waterMat) {
      waterMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.86, depthWrite: false });
      if (CBZ.groundMaskExempt) CBZ.groundMaskExempt(waterMat);
    }
    const g = new THREE.CircleGeometry(1, 40);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, waterMat.clone());
    m.userData.groundShaftWater = true;
    m.renderOrder = 2;
    setWater(h, m, h.waterLevel);
    return m;
  }
  function setWater(h, m, level) {
    h.waterLevel = Math.max(0, Math.min(h.depth * 0.8, level));
    const y = h.bottom + h.waterLevel;
    const dm = h.gy - y;
    // the pool fills the shaft at the height it stands: the wall's radius there
    const rad = wallRadius(h, dm, 0, layerAt(h, dm), 0) * 0.995;
    m.position.set(h.x, y, h.z);
    m.scale.set(rad, 1, rad);
    m.visible = h.waterLevel > 0.05;
    // muddy water, lit only as much as the sky reaches it
    const k = Math.max(0.05, skyOcc(h, dm) * 1.6);
    m.material.color.setRGB(0.36 * k, 0.33 * k, 0.24 * k);
  }
  CBZ.groundShaftWater = function (h, level) {
    if (!h || !h.grp) return 0;
    if (!h.water) {
      h.waterLevel = level;
      h.water = buildWater(h);
      if (h.water) h.grp.add(h.water);
      return h.waterLevel || 0;
    }
    setWater(h, h.water, level);
    return h.waterLevel;
  };

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

  /* ============================================================
     THE TORN RIM. Owner: "the rims of sinkholes are this weird gray color
     that's very unrealistic." They were, for three reasons, all fixed here:

       1. THE COLLAR WAS A FLAT HEX. It is the intact ground between the
          removed floor and the mask's discard circle, and it was painted one
          colour: the ground sample refused every TEXTURED surface (correctly
          — a map's material.color is a tint), the island's grass and road and
          the city's plates are all textured, so every collar fell back to
          0x2f2e2c — then laid that hex in as a LINEAR vertex colour (0.18,
          three times real asphalt) — a smooth grey annulus round the hole on
          grass and road alike. The collar now IS the ground: the material the
          hole was cut from (an exempt clone), its UVs continued from the hit
          triangle's planar map, its vertex tint. The turf or tarmac runs on to
          the torn edge and the ring cannot be seen because it is not there.
       2. ONE MESH, AVERAGED NORMALS. Collar and cut face shared a row of
          vertices, so computeVertexNormals tilted the collar's inner edge 45°
          and the per-vertex Lambert lit it as a band of its own. Two meshes
          now: the collar faces straight up like the ground it continues, the
          section faces the hole.
       3. THE SECTION'S PAINT CHIPS WERE READ AS LINEAR (see lin()): the base
          course went in at 0.55 albedo, a pale grey stripe under the road.

     What a real collapse rim is (Guatemala City 2010, Winter Park 1981, the
     Florida road failures, Daisetta): the torn edge of whatever was on top.
     A ROAD breaks as slabs, so its edge is angular and notched, the black
     wearing course over a lighter gravel base, the base washed out back
     under the crust. GROUND tears: the turf mat overhangs the cut on its own
     roots, droops, and the roots hang out of the dark moist topsoil under
     it. Either way the surface round it is cracked radially and in tension
     arcs, and broken pieces lie on the lip. All of that is built once per
     cut, merged per material: ~4 draw calls for the whole rim.
     ============================================================ */
  let crackMat = null;
  function rimCrackMat() {
    if (!crackMat) {
      crackMat = new THREE.MeshBasicMaterial({ color: 0x0b0907, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      crackMat._shared = true;
      if (CBZ.groundMaskExempt) CBZ.groundMaskExempt(crackMat);
    }
    return crackMat;
  }
  function buildLip(h) {
    const seg = 64;
    const road = !!h.road;
    const g = new THREE.Group();
    g.position.set(h.x, 0, h.z);
    /* THE TORN EDGE: always at or OUTSIDE the removed floor, so the edge you
       see is an edge you can stand on. A road breaks into slabs, so its edge
       is NOTCHED (a step every four vertices, flat between); turf tears, so
       its edge is ragged vertex to vertex. */
    const inner = new Float32Array(seg + 1);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU;
      const smooth = (hs(h, Math.cos(a) * 4.1, Math.sin(a) * 4.1) - 0.5) * 0.08;
      const jag = road ? hs(h, (i >> 2) + 40, 21) * 0.05 + hs(h, i, 23) * 0.01
                       : hs(h, i, 22) * 0.035;
      inner[i] = h.mouth * (1.035 + smooth + jag);
    }
    inner[seg] = inner[0];
    /* The turf overhang: the grass mat reaches past the cut on its roots by
       5-35 cm (never past the removed floor) and sags at its tip. */
    const oh = new Float32Array(seg + 1);
    if (!road) {
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * TAU;
        const want = 0.05 + hs(h, Math.cos(a) * 6.3, Math.sin(a) * 6.3 + 3) * 0.3;
        oh[i] = Math.max(0, Math.min(want, inner[i] - h.mouth - 0.02));
      }
      oh[seg] = oh[0];
    }
    // the collar reaches just past the mask's discard circle (r x 1.06) and stops
    const COLLAR_OUT = 1.17;
    const TOP = 0.035;

    /* ---- 1. THE COLLAR: the ground itself, in its own material ---- */
    const S = h.surf;
    const fl = [0, 0, 0];
    if (!S) { if (h.topSampled) { fl[0] = ((h.topColor >> 16) & 255) / 255; fl[1] = ((h.topColor >> 8) & 255) / 255; fl[2] = (h.topColor & 255) / 255; } else lin(h.topColor, 1, fl); }
    const cRows = road ? [[0, 0, 0.9], [0, 1.03, 1], [0, COLLAR_OUT, 1]]
                       : [[1, 0, 0.72], [0, 1.0, 0.9], [0, 1.05, 1], [0, COLLAR_OUT, 1]];
    {
      const nr = cRows.length;
      const P = new Float32Array((seg + 1) * nr * 3), N = new Float32Array((seg + 1) * nr * 3);
      const C = new Float32Array((seg + 1) * nr * 3), U = new Float32Array((seg + 1) * nr * 2);
      const I = [];
      let p = 0, q = 0;
      for (let j = 0; j < nr; j++) {
        const R = cRows[j];
        for (let i = 0; i <= seg; i++) {
          const a = (i / seg) * TAU;
          // R[0] = this is the overhang TIP row (radius inside the cut, sagging)
          const rad = R[0] ? inner[i] - oh[i] : (R[1] === 0 ? inner[i] : inner[i] * R[1]);
          const y = h.gy + TOP - (R[0] ? oh[i] * 0.35 : 0);
          const lx = Math.cos(a) * rad, lz = Math.sin(a) * rad;
          P[p] = lx; P[p + 1] = y; P[p + 2] = lz;
          N[p] = 0; N[p + 1] = 1; N[p + 2] = 0;
          /* the torn edge itself darkens: crumbs of soil over the turf, the
             fracture dust on the tarmac — the one value step that marks the
             lip, done in the ground's own hue */
          const k = R[2] * (0.94 + hs(h, i, 31 + j) * 0.06);
          const base = S ? S.col : fl;
          C[p] = base[0] * k; C[p + 1] = base[1] * k; C[p + 2] = base[2] * k;
          if (S && S.uvm) {
            const wx = h.x + lx, wz = h.z + lz, M = S.uvm;
            U[q] = M[0] + M[1] * wx + M[2] * wz; U[q + 1] = M[3] + M[4] * wx + M[5] * wz;
          }
          p += 3; q += 2;
        }
      }
      for (let j = 0; j < nr - 1; j++) for (let i = 0; i < seg; i++) {
        const a = j * (seg + 1) + i, b = a + 1, d = a + (seg + 1), e = d + 1;
        // wound to face UP: the ground's material is single-sided
        I.push(a, b, d, b, e, d);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(C, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(U, 2));
      geo.setIndex(I);
      const collar = new THREE.Mesh(geo, S ? exemptClone(S.mat) : lipMat);
      // ground takes ground's shadows: an unshadowed annulus in a shadowed
      // field is the ring again, drawn in light
      collar.receiveShadow = true;
      collar.userData.groundShaftCollar = true;
      g.add(collar);
    }

    /* ---- 2. THE SECTION under the edge, facing the hole ----
       Rows are the section's own layers (layersOf) down to 2.1 m, two per
       layer so each boundary is a ledge. The crust stands PROUD and the
       loose layers under it are washed BACK (rf > 1 is further from the
       centre), which is the undercut every photographed collapse has. Light:
       the top few centimetres see the open sky, everything under the crust
       is in its contact shadow (skyOcc), and earth darkens as it gets wetter
       further down (wetAt). */
    const P = [], C = [], I = [];
    const LY = layersOf(h);
    const rows = [];
    const ROOTMAT = 0x2b2117;
    if (!road) {
      rows.push({ tip: true, dy: TOP, c: ROOTMAT, k: 0.55 });            // the turf's underside at the tip
      rows.push({ rf: 1.0, dy: -0.07, c: ROOTMAT, k: 0.5 });             // back under the mat to the cut
    } else {
      rows.push({ rf: 1.0, dy: TOP, c: LY[0].c, k: 0.85 });              // the broken asphalt edge, in the sky
    }
    const skip = road ? 0 : 0.07;
    for (let i = 0; i < LY.length && LY[i].top < 2.1; i++) {
      const ly = LY[i], t0 = Math.max(skip, ly.top), bot = Math.min(2.1, ly.bot);
      if (bot <= t0) continue;
      const back = ly.name === "asphalt" ? 1.0 : ly.name === "base course" ? 1.014 : ly.name === "topsoil" ? 1.006 : 1.028;
      rows.push({ rf: back, dy: -t0, c: ly.c }, { rf: back, dy: -bot, c: ly.c });
    }
    for (let j = 0; j < rows.length; j++) {
      const R = rows[j], dm = Math.max(0, -R.dy);
      // the sky the face sees: open at the very top, the contact shadow below
      const sky = Math.exp(-dm / 0.22);
      const kL = R.k != null ? R.k : (0.8 * sky + skyOcc(h, dm) * (1 - sky)) * wetAt(dm);
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        const crumb = R.tip ? 1 : 1 + (hs(h, ca * 7.7 + j * 1.3, sa * 7.7) - 0.5) * 0.014;
        const rad = R.tip ? inner[i] - oh[i] : inner[i] * R.rf * crumb;
        const y = h.gy + R.dy - (R.tip ? oh[i] * 0.35 + 0.025 : 0);
        P.push(ca * rad, y, sa * rad);
        const mot = 0.82 + hs(h, ca * 5.3, sa * 5.3 + R.dy * 11) * 0.36;
        const c = lin(R.c, kL * mot, [0, 0, 0]);
        C.push(c[0], c[1], c[2]);
      }
    }
    for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + 1, d = a + (seg + 1), e = d + 1;
      I.push(a, d, b, b, d, e);
    }
    /* ROOTS out of the turf's underside: thin hanging strands, each a narrow
       quad turned to face the hole, 15-60 cm, leaning in a little. */
    if (!road) {
      const nRoot = Math.min(140, Math.round(TAU * h.r * 2.2));
      const rc = lin(0x6a5440, 0.42, [0, 0, 0]);
      for (let k = 0; k < nRoot; k++) {
        const f = hs(h, k, 41), a = f * TAU;
        const i0 = Math.min(seg - 1, Math.floor(f * seg));
        const radT = inner[i0] - oh[i0] * hs(h, k, 42);
        const len = 0.15 + hs(h, k, 43) * 0.45, w = 0.012 + hs(h, k, 44) * 0.02;
        const ca = Math.cos(a), sa = Math.sin(a), tx = -sa * w, tz = ca * w;
        const y0 = h.gy - 0.03 - oh[i0] * 0.2, lean = 0.05 + hs(h, k, 45) * 0.12;
        const bx = ca * radT, bz = sa * radT, ex = ca * (radT - lean), ez = sa * (radT - lean);
        const base = P.length / 3;
        P.push(bx - tx, y0, bz - tz, bx + tx, y0, bz + tz, ex + tx * 0.3, y0 - len, ez + tz * 0.3, ex - tx * 0.3, y0 - len, ez - tz * 0.3);
        for (let v = 0; v < 4; v++) C.push(rc[0], rc[1], rc[2]);
        I.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
      geo.setIndex(I);
      geo.computeVertexNormals();
      const face = new THREE.Mesh(geo, lipMat);
      face.receiveShadow = true;
      g.add(face);
    }

    /* ---- 3. WHAT LIES ON THE LIP: the broken pieces of the edge ----
       a road leaves slabs of its wearing course and spilled gravel; ground
       leaves clods of soil and the odd lump of clay thrown up. */
    if (!h.through) {
      const B = BoxBuf();
      const n = Math.min(30, Math.max(8, Math.round(TAU * h.r / 1.3)));
      for (let k = 0; k < n; k++) {
        const a = hs(h, k, 51) * TAU;
        const i0 = Math.min(seg - 1, Math.floor((a / TAU) * seg));
        const d = inner[i0] * (1.03 + hs(h, k, 52) * 0.22);
        const kind = hs(h, k, 53);
        let sx, sy, sz, hex, kk;
        if (road) {
          if (kind < 0.55) { const s = 0.25 + hs(h, k, 54) * 0.55; sx = s; sy = 0.08 + hs(h, k, 55) * 0.06; sz = s * (0.6 + hs(h, k, 56) * 0.5); hex = 0x2b2a28; kk = 0.95; }
          else { const s = 0.1 + hs(h, k, 54) * 0.18; sx = s; sy = s * 0.6; sz = s; hex = 0x8a7f6c; kk = 0.8; }
        } else {
          const s = 0.14 + hs(h, k, 54) * 0.36; sx = s; sy = s * (0.5 + hs(h, k, 55) * 0.4); sz = s * (0.7 + hs(h, k, 56) * 0.4);
          hex = kind < 0.8 ? 0x4a3727 : 0x8f5434; kk = kind < 0.8 ? 0.85 : 0.6;
        }
        B.chunk(Math.cos(a) * d, h.gy + TOP + sy * 0.22, Math.sin(a) * d, sx, sy, sz, hs(h, k, 57) * TAU, hex, kk, k + 7);
      }
      const m = B.mesh(rockMat);
      if (m) { m.receiveShadow = true; m.castShadow = true; g.add(m); }
    }

    /* ---- 4. CRACKS in the surface round it: radial fractures out from the
       edge, and tension arcs concentric with it a little way back. One
       ribbon mesh lying a centimetre over whatever the ground is there. */
    if (h.cracks !== false && !h.through) {
      const lines = [];
      const nR = 9 + Math.floor(hs(h, 61, 1) * 6);
      for (let k = 0; k < nR; k++) {
        let a = (k / nR) * TAU + (hs(h, k, 62) - 0.5) * 0.5;
        const i0 = Math.min(seg - 1, Math.floor((((a % TAU) + TAU) % TAU) / TAU * seg));
        let rr = inner[i0] * 0.995;
        const end = inner[i0] * (1.22 + hs(h, k, 63) * 0.5) + 0.6;
        const pts = [];
        while (rr < end) { pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); const st = 0.35 + hs(h, k, rr * 3.1) * 0.5; rr += st; a += (hs(h, k + 9, rr * 2.3) - 0.5) * 0.22 / Math.max(1, rr * 0.2); }
        lines.push({ pts: pts, w: 0.05 + hs(h, k, 64) * 0.06 });
      }
      for (let k = 0; k < 3; k++) {
        const rr0 = h.r * (1.24 + k * 0.17 + hs(h, k, 65) * 0.08);
        const a0 = hs(h, k, 66) * TAU, span = 0.5 + hs(h, k, 67) * 0.8;
        const pts = [];
        for (let a = a0; a < a0 + span; a += 0.4 / rr0 + 0.03) {
          const r1 = rr0 * (1 + (hs(h, a * 5, k) - 0.5) * 0.03);
          pts.push([Math.cos(a) * r1, Math.sin(a) * r1]);
        }
        lines.push({ pts: pts, w: 0.035 + k * 0.01 });
      }
      const CP = [];
      for (let l = 0; l < lines.length; l++) {
        const L = lines[l], Q = L.pts;
        for (let j = 0; j < Q.length - 1; j++) {
          const A = Q[j], Bq = Q[j + 1];
          const dx = Bq[0] - A[0], dz = Bq[1] - A[1], ln = Math.hypot(dx, dz) || 1;
          const wa = L.w * (1 - 0.8 * j / Q.length), wb = L.w * (1 - 0.8 * (j + 1) / Q.length);
          const ox = -dz / ln, oz = dx / ln;
          // a hair over the collar; outside it, clear of a road that sits a
          // few centimetres proud of the terrain it is laid on
          const ya = Math.max(h.gy + TOP + 0.015, rawFloor(h.x + A[0], h.z + A[1]) + 0.05);
          const yb = Math.max(h.gy + TOP + 0.015, rawFloor(h.x + Bq[0], h.z + Bq[1]) + 0.05);
          CP.push(A[0] + ox * wa, ya, A[1] + oz * wa, Bq[0] + ox * wb, yb, Bq[1] + oz * wb, Bq[0] - ox * wb, yb, Bq[1] - oz * wb);
          CP.push(A[0] + ox * wa, ya, A[1] + oz * wa, Bq[0] - ox * wb, yb, Bq[1] - oz * wb, A[0] - ox * wa, ya, A[1] - oz * wa);
        }
      }
      if (CP.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(CP, 3));
        const cm = new THREE.Mesh(geo, rimCrackMat());
        cm.renderOrder = 3;
        g.add(cm);
      }
    }
    return g;
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
          C.push(_lin[(hex >> 16) & 255] * kk, _lin[(hex >> 8) & 255] * kk, _lin[hex & 255] * kk);
        }
        const F = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 1, 5, 6, 1, 6, 2, 0, 3, 7, 0, 7, 4];
        for (let i = 0; i < F.length; i++) I.push(base + F[i]);
      },
      // an irregular broken chunk (debris.js's shared cut solid, ~1 m across)
      // scaled to (sx, sy, sz); a plain box only when debris.js is absent
      chunk(cx, cy, cz, sx, sy, sz, yaw, hex, k, variant) {
        const g = CBZ.debris && CBZ.debris.chunkGeo ? CBZ.debris.chunkGeo(variant) : null;
        if (!g) { this.add(cx, cy, cz, sx, sy, sz, yaw, hex, k); return; }
        const pa = g.attributes.position;
        const co = Math.cos(yaw || 0), si = Math.sin(yaw || 0);
        const base = P.length / 3;
        const r = _lin[(hex >> 16) & 255] * k, gg = _lin[(hex >> 8) & 255] * k, b = _lin[hex & 255] * k;
        for (let i = 0; i < pa.count; i++) {
          const x = pa.getX(i) * sx, y = pa.getY(i) * sy, z = pa.getZ(i) * sz;
          P.push(cx + x * co - z * si, cy + y, cz + x * si + z * co);
          const kk = y > 0 ? 1 : 0.82;
          C.push(r * kk, gg * kk, b * kk);
          I.push(base + i);
        }
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
    /* the talus cone IS the street that went down first: broken slabs of the
       surface (asphalt / turf-topped soil) and clods of the earth under it,
       each an irregular fractured chunk (CBZ.debris.chunkGeo, the same cut
       solids the debris system breaks things into) stretched to slab or clod
       proportions, stacked into a mound highest in the middle. It was 26
       boxes. Seeded per hole (hs), so a re-cut keeps the same heap, and
       merged into this shaft's own mesh, so it goes when the hole does. */
    const cone = h.coneR;
    const nT = h.bowl ? 14 : 34;
    for (let i = 0; i < nT; i++) {
      const a = hs(h, i, 1) * TAU, d = Math.sqrt(hs(h, i, 2)) * cone;
      const y = h.bottom + h.coneH * Math.max(0, 1 - d / cone) * (0.35 + hs(h, i, 3) * 0.6);
      const slab = i % 3 === 0;
      const s = slab ? 0.9 + hs(h, i, 4) * 1.6 : 0.5 + hs(h, i, 4) * 0.9;
      B.chunk(h.x + Math.cos(a) * d, y, h.z + Math.sin(a) * d,
        s, slab ? 0.22 + hs(h, i, 5) * 0.2 : s * (0.5 + hs(h, i, 5) * 0.4), s * (0.6 + hs(h, i, 6) * 0.6),
        hs(h, i, 7) * TAU, slab ? h.surfaceColor : 0x4a4036, 0.16 + hs(h, i, 8) * 0.1, i);
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

  /* THE STAIR IS A SLUMP, NOT A SPIRAL. It used to run the whole way round
     the shaft, a 2 m ledge under every metre of the rim, so anybody standing
     at the edge when it went landed on a step a few metres down: the hole
     you fell into had a floor under its lip all the way round. A fresh
     collapse has sheer walls; what it does leave is ONE side where the wall
     slumped into a stepped scree you can climb. So the ledges cover a
     150-degree arc from a0 and the rest of the rim is a straight drop. */
  const STAIR_ARC = Math.PI * 150 / 180;
  function stairA0(seed) { return (seed % 1) * TAU; }
  CBZ.groundShaftStairArc = function (seed) { return { a0: stairA0(seed), span: STAIR_ARC }; };
  /* THE STAIR. Declared once as (a0, n, rIn, rOut); drawn from that and
     ANSWERED from that (see shaftFloor). Steps are one jump apart, so the
     bottom of a sinkhole is survivable if you can find the ledge — which, in
     the dark, is the actual game. */
  function buildStair(h) {
    if (!h.stepN) return null;
    const B = BoxBuf();
    const dA = h.stepArc / h.stepN;
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
      stepN: 0, stepA0: 0, stepArc: STAIR_ARC, stepIn: r * 0.78,
      born: CBZ.now || 0,
      /* the section's top layers: a road is asphalt over base course, open
         ground is topsoil (layersOf) */
      road: opts.road != null ? !!opts.road : opts.surface === "asphalt",
      // metres of standing water above the bottom, carried across re-cuts
      waterLevel: opts.water > 0 ? +opts.water : 0,
      /* the sinkhole EVENT (world/sinkhole.js) takes everything standing in
         the mouth as a falling body before each re-cut; clearInside() hiding
         them first would delete the cars it is about to tip in */
      keepInside: !!opts.keepInside,
    };
    /* Sampled BEFORE the group joins the scene, so the raycast cannot find an
       earlier row of our own collar and copy a copy. `opts.top` lets a caller
       state the colour outright; a failed sample falls back to the section
       colour, which is what the collar always used to be. */
    /* the SURFACE the hole is cut from (material, tint, UV map) — the collar
       is drawn in it (buildLip). A caller that names `top` outright (a
       meteor's ejecta blanket) gets a flat collar of that colour instead;
       a re-cut carries `surf` (and the cache would answer it anyway). */
    h.surf = opts.surf !== undefined ? opts.surf : (opts.top != null && !opts.topSampled ? null : groundSurfaceAt(x, z, gy));
    h.cracks = opts.cracks !== false;
    const top = opts.top != null ? opts.top : (h.surf ? h.surf.hex : null);
    h.topColor = top != null ? top : h.surfaceColor;
    /* Carried, not re-derived. Every shaft is re-cut five or six times as it
       grows and each re-cut passes the colour in, so deriving "was this
       sampled" from `opts.top == null` reported false for every hole in the
       game the moment it finished opening — the colour was the sampled one,
       the flag had simply forgotten where it came from. */
    h.topSampled = opts.topSampled != null ? !!opts.topSampled : (top != null && opts.top == null);
    if (CBZ.CONFIG.SHAFT_ESCAPE !== false && !h.bowl) {
      h.stepN = Math.max(6, Math.min(34, Math.round(depth / 1.3)));
      h.stepA0 = stairA0(h.seed);
      h.stepArc = STAIR_ARC;
      h.stepIn = h.mouth * 0.78;
    }
    const wall = buildWall(h);
    const lip = buildLip(h);
    const rubble = h.through ? null : buildFloorFurniture(h);
    const dish = buildDish(h);
    const stair = buildStair(h);
    /* No black disc: the floor is the talus the cover fell in as, dark
       because no light reaches it (buildTalusFloor), and water stands on it. */
    const floorM = buildTalusFloor(h);
    const water = buildWater(h);
    if (water) h.water = water;
    wall.position.set(x, 0, z);
    h.grp.add(wall, lip);
    if (floorM) h.grp.add(floorM);
    if (water) h.grp.add(water);
    if (dish) h.grp.add(dish);
    if (rubble) h.grp.add(rubble);
    if (stair) h.grp.add(stair);
    h.grp.userData.groundShaft = true;
    root().add(h.grp);
    h.dispose = function () { disposeShaft(h); };
    live.push(h);
    if (pub.indexOf(h) < 0) pub.push(h);
    stats.cut++;
    if (!h.keepInside) clearInside(h);
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
      h.grp.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose && !o.material.vertexColors && !o.material._shared) o.material.dispose(); });
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
      const g = f * TAU / h.stepArc;            // 0..1 along the slump, >1 = sheer wall
      if (g < 1) {
        const i = Math.min(h.stepN - 1, Math.floor(g * h.stepN));
        return h.bottom + (i + 1) * (h.depth / h.stepN);
      }
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
     FALLING DEBRIS — the street itself going in. Each rim chunk is a SLAB
     OF THE GROUND that sheared off: a block of the surface's own material
     (asphalt on a road, soil on the island) fractured by CBZ.debris into
     real irregular pieces that tumble into the shaft, pile on each other
     and settle as rubble at the bottom. The CRUSH is gameplay and stays
     here: an invisible tracker rides the same arc (our own integrator,
     because systems/fx.js's updater is gated to survival mode and a city
     sinkhole must still crush people) and hurts whoever it lands on.
     ============================================================ */
  const slabMats = new Map();
  function slabMat(hex) {
    let m = slabMats.get(hex);
    if (!m) { const c = lin(hex, 1, [0, 0, 0]); m = new THREE.MeshLambertMaterial(); m.color.setRGB(c[0], c[1], c[2]); m._shared = true; slabMats.set(hex, m); }
    return m;
  }
  function slabKind(hex) { return hex === 0x2f2e2c ? "asphalt" : "dirt"; }
  const _chunkV = new THREE.Vector3(), _chunkW = new THREE.Vector3();
  function dropChunk(o) {
    const s = o.size || 1.2;
    const hh = s * (0.35 + rnd() * 0.5), dd = s * (0.7 + rnd() * 0.6);
    const col = o.color != null ? o.color : 0x51473b;
    if (CBZ.debris) {
      _chunkV.set(o.vx || 0, o.vy || 0, o.vz || 0);
      _chunkW.set((rnd() - 0.5) * 5, (rnd() - 0.5) * 2, (rnd() - 0.5) * 5);
      CBZ.debris.shatterBox({ minX: o.x - s / 2, maxX: o.x + s / 2, minY: o.y - hh / 2, maxY: o.y + hh / 2, minZ: o.z - dd / 2, maxZ: o.z + dd / 2 },
        slabMat(col), { kind: slabKind(col), launch: false, velocity: _chunkV, angular: _chunkW,
          maxPieces: s > 1.4 ? 4 : 3, size: Math.max(0.25, s * 0.5), owner: "groundshaft", dust: 0.6, grit: 0.5 });
    }
    chunks.push({
      x: o.x, z: o.z, y: o.y, vy: o.vy || 0, vx: o.vx || 0, vz: o.vz || 0, r: s * 0.7,
      dmg: o.dmg != null ? o.dmg : 0, landed: false,
    });
  }
  function clearChunks() {
    chunks.length = 0;
    if (CBZ.debris) CBZ.debris.clear("groundshaft");
  }
  function tickChunks(dt) {
    // the tracker falls under debris.js's gravity, the one the pieces obey
    const G = 9.81;
    for (let i = chunks.length - 1; i >= 0; i--) {
      const c = chunks[i];
      c.vy -= G * dt;
      c.x += c.vx * dt; c.z += c.vz * dt; c.y += c.vy * dt;
      const fl = CBZ.groundShaftFloor(c.x, c.z, rawFloor(c.x, c.z));
      if (c.y > fl + c.r * 0.5) continue;
      // CRUSHING — a slab of the street arriving on somebody at the bottom
      c.y = fl + c.r * 0.5;
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
      chunks.splice(i, 1);
    }
  }

  /* ============================================================
     THE COLLAPSE EVENT LIVES IN world/sinkhole.js NOW.

     This file is the PRIMITIVE: cut a shaft, answer its floor, mask the
     ground, hurt what falls in. The sinkhole EVENT — the cracks and the sag,
     the cover giving way, the edges calving, the cars and poles and the
     building going in, the broken main and the rising water — is a much
     bigger thing than a hole and it was crammed in here as a 250-line
     sequence that could only throw cars and shake the camera. It moved to its
     own file and reads the shaft's internals through this one record instead
     of re-deriving any of them. `seqs` stays HERE because the mask, the clear
     and the audit all have to see running events.
     ============================================================ */
  const FALL_SAFE = 11.0;   // m/s — mirrors systems/physics.js's city fall law
  const FALL_K = 0.95;      // (a full jump lands ~8.2 m/s and must stay free)
  function nearCam(x, z, r) {
    if (!CBZ.camera) return false;
    const dx = CBZ.camera.position.x - x, dz = CBZ.camera.position.z - z;
    return dx * dx + dz * dz < r * r;
  }
  CBZ.groundShaftKit = {
    seqs: seqs, live: live, stats: stats,
    root: root, rawFloor: rawFloor, eachActor: eachActor, hurt: hurt, sfx: sfx,
    survMode: survMode, nearCam: nearCam, skyOcc: skyOcc, layersOf: layersOf, lin: lin, exemptClone: exemptClone,
    mats: function () { mats(); return { wall: wallMat, rock: rockMat, lip: lipMat }; },
    BoxBuf: BoxBuf, dropChunk: dropChunk, disposeShaft: disposeShaft, shaftFloor: shaftFloor,
    syncMask: syncMask,
  };

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
    let lids = 0, sampled = 0, surfaced = 0, throat = 0, rim = 0;
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
      if (h.surf) surfaced++;
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
      // collars drawn IN the ground they were cut from (material + UVs), not a flat hex
      collarInGround: surfaced,
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

})();
