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

   THE HOLE IS CUT, NOT SUGGESTED
   ------------------------------
   OWNER, 2026-08-06: "Sinkhole is a fucking ring right now. It's not a hole.
   You can't fall in it." Both halves were true and they had ONE cause. The
   shaft's geometry was always built — sheer walls, strata, stair, rubble — but
   the SURFACE over it was only asked to stop drawing, via a `discard` injected
   into whatever material a downward raycast happened to land on. When that
   injection missed (a stale matrixWorld on a subtree core/matrixskip.js had
   frozen while hidden, a material with no anchor to patch), the island disc
   kept drawing across the mouth and the only thing left above ground was the
   shaft's own lip collar: a ring on the grass, with a 50 m shaft invisible
   underneath it, which is also why nobody ever chose to walk into one.

   The ground is now CUT AS GEOMETRY (see THE CUT below). Every flat ground
   sheet in this world is authored from a THREE primitive, so its outline is
   recoverable exactly, and `ShapeGeometry` re-triangulates it with a real
   `Path` hole per live shaft. There is no raycast to miss and no shader to
   fail to recompile — the triangles are gone. The discard survives as a
   second layer for the one sheet with no recoverable outline: the sea.

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
  const stats = { falls: 0, crushed: 0, buried: 0, voidSaves: 0, siteRejects: 0, cut: 0, groundCuts: 0, swallowed: 0 };

  // ---- host seams: the only three things a shaft needs from its world ----
  function survMode() { return CBZ.game && CBZ.game.mode === "survival" && CBZ.surv && CBZ.surv.arena; }
  function root() {
    if (survMode()) return CBZ.surv.arena.root;
    return CBZ.scene;
  }
  // The ground WITHOUT any shaft subtracted — the terrain a new hole is cut in.
  // Reading CBZ.floorAt here would let one shaft's floor be another's terrain.
  let baseFloor = null;       // the city floorAt we wrapped (see installCityFloor)
  function rawFloor(x, z) {
    if (survMode()) return CBZ.surv.arena.groundHeightAt(x, z);
    if (baseFloor) { const y = +baseFloor(x, z); return Number.isFinite(y) ? y : 0; }
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
     THE GROUND OVER A HOLE IS CUT AWAY — GEOMETRY FIRST, SHADER SECOND

     This is the difference between a hole and a picture of a hole, and it is
     the fault the owner reported in one word: "it's a ring." The island is
     ONE `CircleGeometry(R, 64)` disc and the city is a plate, so a shaft cut
     beneath either is completely hidden by the very surface it removed. All
     that is left above ground is the shaft's own lip collar lying on the
     grass — a RING. Not a hole. Nothing to fall into that you can see.

     The first fix for that was a four-slot `discard` injected into whatever
     material a downward raycast happened to find. That is a real technique
     and it is kept below, but it can NEVER be the primary: it depends on
     finding the right mesh (a raycast against a possibly-stale matrixWorld),
     on the material having a shader anchor we recognise, and on r128 agreeing
     to recompile a program it has already cached. Three ways to silently do
     nothing, and a hole that silently does nothing is a ring.

     So the ground is now CUT, as geometry, and the cut is the thing you can
     stand at the edge of. Every flat ground sheet in this game is authored
     from a THREE primitive with `parameters` — CircleGeometry (the island
     disc, the beach), PlaneGeometry (roads, lane paint, lot pads, the city
     plate), RingGeometry (aprons) — so its OUTLINE is recoverable exactly.
     Rebuild that outline as a `THREE.Shape`, push one `Path` hole per live
     shaft, and `ShapeGeometry` re-triangulates the sheet with a real opening
     in it. No raycast, no shader, no cache key: the triangles are gone.

     The originals are kept (`rec.base`) and every re-cut starts from them, so
     a growing sinkhole re-punches a bigger hole in the ORIGINAL disc instead
     of eating its own cut, and disposing the last shaft restores the ground
     byte-for-byte.

     The shader discard stays as the SECOND layer, for the sheets that have no
     recoverable outline — chiefly the disaster ocean, a custom displaced
     BufferGeometry that sits across the whole island at sea level and would
     otherwise let a 46 m shaft look up at blue water. Degrade-safe by
     construction: a material we can neither cut nor patch simply keeps
     drawing, and it is the only surface that does.
     ============================================================ */
  const SHAFT_SLOTS = 4;
  const shaftV = [];
  for (let i = 0; i < SHAFT_SLOTS; i++) shaftV.push(new THREE.Vector4(0, 0, 0, 0));
  const uShaftV = { value: shaftV };
  const maskedSites = [];
  function syncMask() {
    for (let i = 0; i < SHAFT_SLOTS; i++) {
      const h = live[i];
      // the discard radius is the CUT radius — the same number the geometry
      // cut uses, so a sheet that is masked and a sheet that is cut end at
      // exactly the same circle and the lip collar covers both seams.
      if (h) shaftV[i].set(h.x, h.z, h.cutR, h.bottom);
      else shaftV[i].set(0, 0, 0, 0);
    }
  }
  const FRAG_HEAD = "uniform vec4 uShaftV[4];\n";
  const FRAG_TEST = "\n  for (int si = 0; si < 4; si++) { vec4 sh = uShaftV[si]; if (sh.z > 0.0 && distance(SHAFTWORLD.xz, sh.xy) < sh.z) discard; }\n";
  function maskMaterial(mat) {
    if (!mat || mat._shaftMasked) return;
    mat._shaftMasked = true;
    try {
      if (mat.isShaderMaterial) {
        // the disaster water publishes its own world position; anything else
        // custom is left alone rather than guessed at
        if (!mat.fragmentShader || mat.fragmentShader.indexOf("vDwWorld") < 0) return;
        if (mat.fragmentShader.indexOf("uShaftV") >= 0) return;
        mat.uniforms.uShaftV = uShaftV;
        mat.fragmentShader = FRAG_HEAD + mat.fragmentShader.replace("void main() {", "void main() {" + FRAG_TEST.replace("SHAFTWORLD", "vDwWorld"));
        mat.needsUpdate = true;
        return;
      }
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = function (shader, renderer) {
        if (prev) { try { prev.call(this, shader, renderer); } catch (e) {} }
        if (shader.fragmentShader.indexOf("#include <clipping_planes_fragment>") < 0) return;
        if (shader.vertexShader.indexOf("#include <project_vertex>") < 0) return;
        shader.uniforms.uShaftV = uShaftV;
        shader.vertexShader = "varying vec3 vShaftW;\n" + shader.vertexShader.replace(
          "#include <project_vertex>", "#include <project_vertex>\n  vShaftW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
        shader.fragmentShader = "varying vec3 vShaftW;\n" + FRAG_HEAD + shader.fragmentShader.replace(
          "#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>" + FRAG_TEST.replace("SHAFTWORLD", "vShaftW"));
      };
      mat.needsUpdate = true;
    } catch (e) { /* a material we cannot patch simply keeps drawing */ }
  }
  /* ---- THE CUT ------------------------------------------------------------
     `cutSheets` is every flat ground mesh any live shaft passes through, each
     paired with the geometry it was BUILT with. Every re-cut re-triangulates
     from that original, so growth widens the hole in the disc instead of
     nibbling its own previous cut, and the last dispose puts the ground back
     exactly as the arena authored it. */
  const cutSheets = [];
  const TMPV = new THREE.Vector3();
  const TMPB = new THREE.Box3();

  // The outline of a sheet, in the geometry's own authoring plane. Circles,
  // rings and planes cover every ground surface in this world; anything else
  // returns null and falls through to the shader mask.
  function outlineShape(geo) {
    const p = geo && geo.parameters;
    if (!p) return null;
    if (geo.type === "CircleGeometry" && p.radius > 0) {
      const s = new THREE.Shape(); s.absarc(0, 0, p.radius, 0, TAU, false); return s;
    }
    if (geo.type === "RingGeometry" && p.outerRadius > 0) {
      const s = new THREE.Shape(); s.absarc(0, 0, p.outerRadius, 0, TAU, false);
      if (p.innerRadius > 0.01) { const hp = new THREE.Path(); hp.absarc(0, 0, p.innerRadius, 0, TAU, true); s.holes.push(hp); }
      return s;
    }
    if (geo.type === "PlaneGeometry" && p.width > 0 && p.height > 0) {
      const w = p.width / 2, d = p.height / 2;
      const s = new THREE.Shape();
      s.moveTo(-w, -d); s.lineTo(w, -d); s.lineTo(w, d); s.lineTo(-w, d); s.lineTo(-w, -d);
      return s;
    }
    return null;
  }
  /* A HOLE WIDER THAN THE SHEET IT IS IN.

     `ShapeGeometry` is exact and beautiful and it has one hard requirement:
     the hole path must lie STRICTLY INSIDE the outer contour. Earcut bridges
     each hole to the outline with a seam, and if the hole crosses the outline
     that seam is self-intersecting — the triangulator does not error, it
     returns a plausible-looking mesh with the sheet still spanning the void.
     Which is exactly what a road is: a 6 m strip crossed by a 26 m mouth. The
     island disc satisfies the requirement and gets the exact path; a road
     never can, and got tarmac drawn over the sinkhole.

     So a strip is re-tessellated instead: a grid of cells over its own
     rectangle, and every cell the mouth reaches is simply not emitted. The
     edge that leaves behind is ragged to within one cell, and that is fine by
     construction — the lip collar is opaque from the torn rim `r` out to
     `cutR + 0.15`, a band 13% of the radius wide, so any remnant inside it is
     covered and no remnant survives inside the visible mouth. */
  const CELL = 0.9;
  function gridCutPlane(base, holes) {
    const p = base.parameters;
    const W = p.width, H = p.height;
    const nx = Math.min(220, Math.max(1, Math.ceil(W / CELL)));
    const ny = Math.min(220, Math.max(1, Math.ceil(H / CELL)));
    const cw = W / nx, ch = H / ny;
    const pos = [], uv = [], nor = [], idx = [];
    let kept = 0, dropped = 0;
    for (let j = 0; j < ny; j++) {
      const y0 = -H / 2 + j * ch, y1 = y0 + ch;
      for (let i = 0; i < nx; i++) {
        const x0 = -W / 2 + i * cw, x1 = x0 + cw;
        let gone = false;
        for (let k = 0; k < holes.length; k++) {
          const c = holes[k];
          // nearest point of the cell to the hole centre — a cell the circle
          // so much as clips is gone, so nothing survives inside the mouth
          const qx = Math.max(x0, Math.min(c.x, x1)), qy = Math.max(y0, Math.min(c.y, y1));
          if ((qx - c.x) * (qx - c.x) + (qy - c.y) * (qy - c.y) < c.r * c.r) { gone = true; break; }
        }
        if (gone) { dropped++; continue; }
        kept++;
        const b = pos.length / 3;
        pos.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0);
        uv.push((x0 + W / 2) / W, (y0 + H / 2) / H, (x1 + W / 2) / W, (y0 + H / 2) / H,
          (x1 + W / 2) / W, (y1 + H / 2) / H, (x0 + W / 2) / W, (y1 + H / 2) / H);
        nor.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    }
    if (!dropped) return null;                 // nothing was taken — keep the original
    const g = new THREE.BufferGeometry();
    if (kept) {
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      g.setIndex(idx);
    } else {
      g.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    }
    return g;
  }
  function underShaft(o) {
    let p = o; while (p) { if (p.userData && p.userData.groundShaft) return true; p = p.parent; }
    return false;
  }
  /* A sheet is cuttable when it is FLAT IN ITS OWN GEOMETRY. That test is what
     protects the seabed shelf: it is a RingGeometry whose vertices are pushed
     to a height field, so rebuilding it from its outline would flatten 34 m of
     draped shoreline into a disc. Flat in local Z → the outline IS the mesh. */
  function cuttableSheet(o) {
    if (!o || !o.isMesh || !o.geometry || underShaft(o)) return null;
    /* NOT AN INSTANCED DRAW, AND NOT A MULTI-MATERIAL MESH. An InstancedMesh
       shares ONE geometry across every copy, so cutting it would punch this
       hole through every lot slab in the world; a mesh with a material array
       is drawn from geometry groups a re-triangulation does not carry. Both
       fall through to the shader mask, which is per-material and safe. */
    if (o.isInstancedMesh || Array.isArray(o.material)) return null;
    const g = o.geometry;
    if (!g.parameters) return null;
    if (!g.boundingBox) g.computeBoundingBox();
    if (g.boundingBox.max.z - g.boundingBox.min.z > 0.05) return null;
    /* HORIZONTAL ONLY. A shop window and a lane marking are both a short flat
       PlaneGeometry; only one of them is ground. The geometry's own +Z axis
       (its authoring normal) taken into world space says which — a hole
       punched into a vertical pane would be a hole punched at a point that is
       nowhere inside its outline, and earcut is under no obligation to be
       polite about that. */
    const e = o.matrixWorld.elements;
    const nx = e[8], ny = e[9], nz = e[10];
    const len = Math.hypot(nx, ny, nz) || 1;
    if (Math.abs(ny / len) < 0.9) return null;
    return outlineShape(g);
  }
  // Find every sheet this shaft opens through. `updateWorldMatrix(true,false)`
  // and not the cached matrixWorld: core/matrixskip.js deliberately stops
  // updating hidden subtrees, and the arena spends most of the game hidden, so
  // the cached matrix of a just-shown island is whatever it was at build.
  function findSheets(h) {
    const R = h.cutR + 2;
    try {
      root().traverse(function (o) {
        if (!o || !o.isMesh || !o.geometry || underShaft(o)) return;
        for (let i = 0; i < cutSheets.length; i++) if (cutSheets[i].o === o) return;
        o.updateWorldMatrix(true, false);
        if (!cuttableSheet(o)) return;
        TMPB.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        if (TMPB.max.y - TMPB.min.y > 3) return;
        if (TMPB.max.y < h.bottom || TMPB.min.y > h.gy + 6) return;
        if (TMPB.max.x < h.x - R || TMPB.min.x > h.x + R) return;
        if (TMPB.max.z < h.z - R || TMPB.min.z > h.z + R) return;
        cutSheets.push({ o: o, base: o.geometry, cut: null });
      });
    } catch (e) {}
  }
  // Re-triangulate every known sheet against EVERY live shaft, from base.
  function recutGround() {
    for (let i = cutSheets.length - 1; i >= 0; i--) {
      const rec = cutSheets[i], o = rec.o;
      if (!o.parent && !rec.cut) { cutSheets.splice(i, 1); continue; }
      const shape = outlineShape(rec.base);
      if (!shape) continue;
      o.updateWorldMatrix(true, false);
      const y = o.matrixWorld.elements[13];
      // one world unit in the sheet's own plane (uniform scale in practice,
      // but a scaled road must not get a hole of the wrong size)
      const sx = Math.hypot(o.matrixWorld.elements[0], o.matrixWorld.elements[1], o.matrixWorld.elements[2]) || 1;
      if (!rec.base.boundingBox) rec.base.computeBoundingBox();
      const bb = rec.base.boundingBox;
      const local = [];               // the holes, in this sheet's own plane
      let n = 0, swallowed = false, strict = true;
      for (let k = 0; k < live.length; k++) {
        const h = live[k];
        if (y < h.bottom || y > h.gy + 6) continue;
        TMPV.set(h.x, y, h.z);
        o.worldToLocal(TMPV);
        const hr = h.cutR / sx;
        /* SWALLOWED WHOLE. A lane marking or a wet patch can be smaller than
           the hole it is standing in; a hole path that encloses its own
           outline is not a hole. Those go away entirely — which is what
           happened to them. */
        if (Math.hypot(bb.min.x - TMPV.x, bb.min.y - TMPV.y) < hr && Math.hypot(bb.max.x - TMPV.x, bb.max.y - TMPV.y) < hr &&
            Math.hypot(bb.min.x - TMPV.x, bb.max.y - TMPV.y) < hr && Math.hypot(bb.max.x - TMPV.x, bb.min.y - TMPV.y) < hr) {
          swallowed = true; break;
        }
        // no overlap → no hole. A hole path that lies entirely outside its
        // shape is not a hole, it is a second contour, and the triangulator
        // will happily hand back a sheet with a bite out of the wrong side.
        if (TMPV.x + hr < bb.min.x || TMPV.x - hr > bb.max.x) continue;
        if (TMPV.y + hr < bb.min.y || TMPV.y - hr > bb.max.y) continue;
        // is this hole entirely inside the sheet? only then is an exact path
        // legal input for the triangulator
        if (TMPV.x - hr < bb.min.x || TMPV.x + hr > bb.max.x ||
            TMPV.y - hr < bb.min.y || TMPV.y + hr > bb.max.y) strict = false;
        local.push({ x: TMPV.x, y: TMPV.y, r: hr, h: h });
        const path = new THREE.Path();
        path.absarc(TMPV.x, TMPV.y, hr, 0, TAU, true);
        shape.holes.push(path);
        n++;
      }
      let next = null;
      if (n && !swallowed) {
        try {
          if (strict) next = new THREE.ShapeGeometry(shape, 48);
          else if (rec.base.type === "PlaneGeometry") next = gridCutPlane(rec.base, local);
          // a round sheet the mouth runs off the EDGE of has no safe
          // re-tessellation here; leave it whole rather than hand the
          // triangulator input it will answer wrongly and confidently
          else next = null;
        } catch (e) { next = null; }
        if (next && !rec.cut) shedSurface(rec, local);
      }
      if (next) { next.computeBoundingBox(); next.computeBoundingSphere(); }
      if (rec.cut && rec.cut !== next) rec.cut.dispose();
      rec.cut = next;
      o.geometry = next || rec.base;
      if (swallowed && o.visible) { o.visible = false; rec.hid = true; }
      else if (rec.hid && !swallowed) { o.visible = true; rec.hid = false; }
      stats.groundCuts += (n && !swallowed) ? 1 : 0;
    }
  }
  /* THE SURFACE THAT WAS THERE GOES DOWN THE HOLE.

     Deleting the triangles is only half of it. A road that vanishes at the rim
     is a road that was never there; what a sinkhole does is TEAR it and send
     the pieces down. So the first time a sheet loses area, slabs of that
     sheet's own colour — the tarmac, the lane paint, the turf — are dropped
     into the shaft on the same falling-debris integrator the rim chunks use.
     They land on the shaft floor (dropChunk asks CBZ.groundShaftFloor, not the
     terrain that used to be there) and become part of the pile at the bottom.

     Capped against the live chunk count: a single collapse can re-cut forty
     sheets and forty sheets' worth of slabs is a debris storm, not a road. */
  function shedSurface(rec, local) {
    if (chunks.length > 90) return;
    const o = rec.o;
    const col = (o.material && o.material.color) ? o.material.color.getHex() : 0x4a4036;
    const bb = rec.base.boundingBox;
    for (let k = 0; k < local.length; k++) {
      const c = local[k];
      const n = 4 + Math.min(8, Math.round(c.r * 0.3));
      for (let i = 0; i < n; i++) {
        const a = rnd() * TAU, d = Math.sqrt(rnd()) * c.r * 0.92;
        const lx = c.x + Math.cos(a) * d, ly = c.y + Math.sin(a) * d;
        if (lx < bb.min.x || lx > bb.max.x || ly < bb.min.y || ly > bb.max.y) continue;
        TMPV.set(lx, ly, 0);
        o.localToWorld(TMPV);
        dropChunk({
          x: TMPV.x, z: TMPV.z, y: TMPV.y + 0.35,
          vy: 0.3 + rnd() * 1.3,
          vx: (c.h.x - TMPV.x) * 0.06, vz: (c.h.z - TMPV.z) * 0.06,
          size: 1.1 + rnd() * 2.3, color: col, dmg: 0, keep: rnd() < 0.3,
        });
      }
    }
  }
  // the last shaft is gone → hand every sheet its original geometry back
  function restoreGround() {
    for (let i = 0; i < cutSheets.length; i++) {
      const rec = cutSheets[i];
      rec.o.geometry = rec.base;
      if (rec.hid) { rec.o.visible = true; rec.hid = false; }
      if (rec.cut) { rec.cut.dispose(); rec.cut = null; }
    }
    cutSheets.length = 0;
  }
  function isCut(o) {
    for (let i = 0; i < cutSheets.length; i++) if (cutSheets[i].o === o) return true;
    return false;
  }

  /* ---- THE SECOND LAYER: the sheets that have no outline to cut ----------
     One raycast per site plus a footprint sweep, exactly as before, but it now
     only reaches what the cut could not take — in practice the disaster ocean.
     Repeat sites (the growth phase re-cuts the shaft several times) are
     skipped; the materials are already patched and the uniform is what moves. */
  function maskGroundAt(h) {
    for (let i = 0; i < maskedSites.length; i++) {
      if (Math.hypot(maskedSites[i].x - h.x, maskedSites[i].z - h.z) < 4) return;
    }
    maskedSites.push({ x: h.x, z: h.z });
    function take(o) {
      if (!o || !o.material || underShaft(o) || isCut(o)) return;
      if (Array.isArray(o.material)) { for (let k = 0; k < o.material.length; k++) maskMaterial(o.material[k]); }
      else maskMaterial(o.material);
    }
    try {
      // (a) what the sky sees through — catches the sea and any plate
      const rc = new THREE.Raycaster(new THREE.Vector3(h.x, h.gy + 60, h.z), new THREE.Vector3(0, -1, 0), 0, 60 + h.depth + 40);
      const hits = rc.intersectObject(root(), true) || [];
      for (let i = 0; i < hits.length; i++) take(hits[i].object);
      /* (b) every FLAT surface overlapping the footprint. One ray down the
         middle is not enough: a road, its lane paint, a kerb and a lot slab
         are separate meshes at slightly different heights and a ray that
         misses one by a metre leaves a strip of tarmac hanging over the void.
         Flat-only (under 3 m tall) so this never recompiles a building's
         shader for a hole that, by the placement law, is not under one. */
      root().traverse(function (o) {
        if (!o.isMesh || !o.geometry || underShaft(o)) return;
        if (o.material && o.material._shaftMasked) return;
        if (isCut(o)) return;
        o.updateWorldMatrix(true, false);
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        TMPB.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        if (TMPB.max.y - TMPB.min.y > 3) return;
        if (TMPB.max.y < h.bottom || TMPB.min.y > h.gy + 2.5) return;
        if (TMPB.max.x < h.x - h.cutR - 2 || TMPB.min.x > h.x + h.cutR + 2) return;
        if (TMPB.max.z < h.z - h.cutR - 2 || TMPB.min.z > h.z + h.cutR + 2) return;
        take(o);
      });
    } catch (e) {}
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
    if (CBZ.cityWaterAt && !survMode() && CBZ.cityWaterAt(x, z)) return { ok: false, why: "water", slope: slope };
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
      // never straight through a building footprint — the reference photograph
      // is a hole in an INTERSECTION with the buildings still standing
      const lots = A.lots || [];
      for (let i = 0; i < lots.length; i++) {
        const L = lots[i];
        if (!L || !L.building) continue;
        const hw = (L.w || 0) / 2 + r * 0.55, hd = (L.d || L.h || 0) / 2 + r * 0.55;
        if (Math.abs(x - L.x) < hw && Math.abs(z - L.z) < hd) return { ok: false, why: "building", slope: slope };
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
    }
  }

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
  /* HOW MUCH SKY REACHES DEPTH t. ONE function, because the wall, the spiral
     of ledges and the rubble at the bottom all have to agree — two independent
     falloff curves is how a ledge ends up floating out of the wall it was
     sheared from (CLAUDE.md's utility-pole lesson).

     The curve was too steep. A reciprocal falloff bottoming out at 0.02 is
     physically the right SHAPE — a narrowing cone of visible sky — but it made
     the lower two thirds of the shaft a black tube, which is a different lie
     from the ring: you could not see that there was dirt down there at all,
     let alone the rubble cone you are meant to land on. Real sinkhole
     photographs bottom out at dim BROWN, not black: the walls bounce plenty at
     this width. So the floor of the curve is 0.30 and the bite is gentler. */
  function skyLight(t) {
    return Math.max(0.30, Math.pow(1 / (1 + 3.0 * t), 1.05));
  }
  function strataColor(h, t, ang, out) {
    const j = (hs(h, Math.cos(ang) * 3.1 + t * 40, Math.sin(ang) * 3.1) - 0.5) * 0.055;
    const tt = Math.max(0, Math.min(1, t + j));
    let c = STRATA[0][1];
    for (let i = 0; i < STRATA.length; i++) if (tt >= STRATA[i][0]) c = STRATA[i][1];
    const dark = skyLight(t);
    const mot = 0.9 + hs(h, Math.cos(ang) * 9.7, Math.sin(ang) * 9.7 + t * 71) * 0.2;
    const k = dark * mot;
    out[0] = (((c >> 16) & 255) / 255) * k;
    out[1] = (((c >> 8) & 255) / 255) * k;
    out[2] = ((c & 255) / 255) * k;
  }

  /* Radius profile: sheer, with a slight inward taper and an undercut just
     BELOW the lip (the overhang the surface layer makes when it is left
     cantilevered over the void).

     The undercut starts at zero AT the rim and not before it. It used to peak
     at t=0, which meant the top ring of the wall was 1.055r while the ground
     was removed at r — a 5% band of wall standing OUTSIDE the opening, i.e.
     wall drawn on top of grass. The rim is now exactly `h.r`, which is exactly
     what the floor query, the lip collar and the ground cut all use. */
  function wallRadius(h, t, ang) {
    const undercut = 1 + 0.06 * Math.sin(Math.PI * Math.min(1, t / 0.17));   // 1 at the rim, widest just under it
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

  /* THE SHEARED LIP — AND IT IS NOT A RING ON THE GRASS.

     This is the detail that makes the picture: the road (or the turf) does not
     slope into the hole, it STOPS, cut off square, with the crust standing
     proud over the soil section under it. But the collar used to be drawn from
     the rim OUTWARD across ground that was still there, in the ground's own
     colour, floating 35 mm above it — which, whenever the surface underneath
     failed to stop drawing, was the entire visible sinkhole. A ring.

     Now the collar is the LID OF THE CUT: the ground geometry is removed out
     to `h.cutR`, and the collar spans from just past that radius inward to the
     torn rim at `h.r`. It replaces ground rather than covering it, so if it is
     visible at all it is because there is a hole under it.

     Inner radius is torn per-vertex, and the SAME torn radius drives the
     collar and the vertical cut face — one solve, two meshes, so the crust can
     never float off its own edge. */
  function buildLip(h) {
    const seg = 46;
    const inner = new Float32Array(seg + 1);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      // torn, never machined — but always at or OUTSIDE the removed floor, so
      // the edge you can see is still an edge you can stand on (the overhang
      // comes from the wall undercutting below, not from the crust lying).
      inner[i] = h.r * (1.005 + (hs(h, Math.cos(a) * 4.1, Math.sin(a) * 4.1) - 0.5) * 0.055);
    }
    inner[seg] = inner[0];
    // collar (the intact surface, ragged edge) + cut face (the section)
    const cutRows = [
      { rf: 1.0, dy: 0.0, c: h.surfaceColor, k: 1 },
      { rf: 1.0, dy: -0.32, c: h.surfaceColor, k: 0.55 },
      { rf: 0.985, dy: -1.05, c: 0x4a3826, k: 0.7 },
      { rf: 0.97, dy: -2.1, c: 0x6a5233, k: 0.55 },
    ];
    const nR = 2 + cutRows.length;
    const pos = new Float32Array((seg + 1) * nR * 3);
    const col = new Float32Array((seg + 1) * nR * 3);
    const idx = [];
    let p = 0, row = 0;
    function emit(rad0, dy, hex, k, absolute) {
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU;
        const rad = absolute ? rad0 : inner[i] * rad0;
        pos[p] = Math.cos(a) * rad; pos[p + 1] = h.gy + dy; pos[p + 2] = Math.sin(a) * rad;
        const mot = (0.86 + hs(h, Math.cos(a) * 5.3, Math.sin(a) * 5.3 + dy * 11) * 0.28) * k;
        col[p] = (((hex >> 16) & 255) / 255) * mot;
        col[p + 1] = (((hex >> 8) & 255) / 255) * mot;
        col[p + 2] = ((hex & 255) / 255) * mot;
        p += 3;
      }
      row++;
    }
    // the crust filling the cut annulus (outer edge overlaps the surviving
    // ground by 15 cm so no daylight can show through the seam), then the
    // downward cut face
    emit(h.cutR + 0.15, 0.02, h.surfaceColor, 0.86, true);
    emit(1.0, 0.02, h.surfaceColor, 0.62, false);
    for (let i = 0; i < cutRows.length; i++) emit(cutRows[i].rf, cutRows[i].dy, cutRows[i].c, cutRows[i].k, false);
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
    const kf = skyLight(1);            // everything down here takes the SAME dimming
    // talus cone, as stacked broken plates (a cone primitive reads too clean).
    // Wider and denser than it was: at 26 plates over a 0.66r cone the floor
    // read as scattered litter on a black disc, when what a sinkhole actually
    // has down there is a MOUND of the street that went first.
    const cone = h.coneR;
    for (let i = 0; i < 48; i++) {
      const a = hs(h, i, 1) * TAU, d = Math.sqrt(hs(h, i, 2)) * cone;
      const y = h.bottom + h.coneH * Math.max(0, 1 - d / cone) * (0.35 + hs(h, i, 3) * 0.6);
      const s = 1.2 + hs(h, i, 4) * 2.6;
      B.add(h.x + Math.cos(a) * d, y, h.z + Math.sin(a) * d, s, 0.4 + hs(h, i, 5) * 0.8, s * (0.6 + hs(h, i, 6) * 0.8),
        hs(h, i, 7) * TAU, i % 4 === 0 ? h.surfaceColor : (i % 3 === 0 ? 0x6a5539 : 0x4a4036), kf * (0.86 + hs(h, i, 8) * 0.34));
    }
    // spill against the foot of the wall — soil that ran in and found its
    // angle of repose, which is also what the burial DOT is modelling
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU + hs(h, i, 21) * 0.24;
      const d = h.r * (0.80 + hs(h, i, 22) * 0.16);
      const s = 1.6 + hs(h, i, 23) * 2.4;
      B.add(h.x + Math.cos(a) * d, h.bottom + 0.35 + hs(h, i, 24) * 0.7, h.z + Math.sin(a) * d,
        s, 0.7 + hs(h, i, 25) * 1.1, s * 0.8, a, 0x54432c, kf * (0.8 + hs(h, i, 26) * 0.3));
    }
    // wedged slabs → the void spaces
    const nV = 3;
    for (let i = 0; i < nV; i++) {
      const a = (i / nV) * TAU + hs(h, i, 11) * 0.9;
      const rr = h.r * 0.72;
      const px = h.x + Math.cos(a) * rr, pz = h.z + Math.sin(a) * rr;
      const w = Math.max(3.2, h.r * 0.55);
      B.add(px, h.bottom + 1.15, pz, w * 0.8, 0.45, w, a, h.surfaceColor, kf * 1.1);
      B.add(px + Math.cos(a) * 0.1, h.bottom + 0.45, pz + Math.sin(a) * 0.1, 0.7, 1.0, 0.7, a, 0x3a332c, kf * 0.8);
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
      // the ledges take the SAME sky-occlusion curve as the wall behind them,
      // so a step does not float out of a wall it is supposed to be part of
      const k = skyLight(t) * 0.95;
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
    // DEEPER THAN WIDE, ALWAYS. The reference reads as a shaft, not a crater,
    // and the ratio is the whole reason: default 2.1x the diameter.
    const depth = Math.max(r * 2.4, opts.depth || r * 4.2);
    const h = {
      x: x, z: z, r: r,
      /* THREE RADII, AND THEY ARE DERIVED FROM ONE.
           r      the torn rim: where the wall starts and the lip ends
           mouth  where there is nothing to stand on — THE SAME CIRCLE.
                  It used to be 0.93r, which left a 7% annulus of invisible
                  ground you could stand on inside a hole you could see.
           cutR   where the ground SHEET is removed. Slightly wider than the
                  rim so the lip collar has something to fill and the seam
                  between torn crust and intact grass is never a gap. */
      mouth: r,
      cutR: r * 1.13,
      gy: gy, depth: depth, bottom: gy - depth,
      seed: opts.seed != null ? opts.seed : (x * 0.37 + z * 0.11),
      surfaceColor: opts.surface === "asphalt" ? 0x2f2e2c : (opts.surface === "soil" ? 0x554129 : (survMode() ? 0x4c5a34 : 0x2f2e2c)),
      mode: CBZ.game ? CBZ.game.mode : null,
      grp: new THREE.Group(),
      voids: [],
      coneR: r * 0.82, coneH: Math.min(5.5, depth * 0.13),
      stepN: 0, stepA0: 0, stepIn: r * 0.78,
      born: CBZ.now || 0,
    };
    if (CBZ.CONFIG.SHAFT_ESCAPE !== false) {
      h.stepN = Math.max(6, Math.min(34, Math.round(depth / 1.3)));
      h.stepA0 = (h.seed % 1) * TAU;
      h.stepIn = h.mouth * 0.78;
    }
    const wall = buildWall(h);
    const lip = buildLip(h);
    const rubble = buildFloorFurniture(h);
    const stair = buildStair(h);
    /* THE BOTTOM IS DIRT, NOT A VOID. This was a near-black disc (0x05040a)
       under the rubble, on the theory that a shaft you cannot see the bottom
       of reads as bottomless. It read as a gap in the world instead — the
       owner's note is "it has dirt at the bottom", and it does: packed soil,
       lit by whatever the walls bounce down, which is what skyLight(1) is.
       Basic and not Lambert on purpose: at 50 m down, a Lambert floor gets no
       light from this game's hemisphere at all and would go back to black. */
    const kf = skyLight(1);
    const floorHex = 0x4a3a26;
    const floorDisc = new THREE.Mesh(new THREE.CircleGeometry(r * 1.04, 32),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color((((floorHex >> 16) & 255) / 255) * kf, (((floorHex >> 8) & 255) / 255) * kf, ((floorHex & 255) / 255) * kf),
      }));
    floorDisc.rotation.x = -Math.PI / 2;
    floorDisc.position.set(x, h.bottom - 0.05, z);
    wall.position.set(x, 0, z);
    lip.position.set(x, 0, z);
    h.grp.add(wall, lip, floorDisc);
    if (rubble) h.grp.add(rubble);
    if (stair) h.grp.add(stair);
    h.grp.userData.groundShaft = true;
    root().add(h.grp);
    h.dispose = function () { disposeShaft(h); };
    live.push(h);
    if (pub.indexOf(h) < 0) pub.push(h);
    stats.cut++;
    // GEOMETRY FIRST: take the ground out for real, then let the shader mask
    // pick up whatever had no outline to cut (the sea).
    findSheets(h);
    recutGround();
    maskGroundAt(h);
    clearInside(h);
    syncMask();
    installCityFloor();
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
    let i = live.indexOf(h); if (i >= 0) live.splice(i, 1);
    i = pub.indexOf(h); if (i >= 0) pub.splice(i, 1);
    // the ground comes back the moment the record does not — both layers
    if (live.length) recutGround(); else restoreGround();
    syncMask();
  }
  CBZ.groundShaftClear = function (mode) {
    for (let i = live.length - 1; i >= 0; i--) if (!mode || live[i].mode === mode) disposeShaft(live[i]);
    for (let i = seqs.length - 1; i >= 0; i--) seqs[i].dispose();
    clearChunks();
    unswallowAll();
    if (!live.length) restoreGround();
    maskedSites.length = 0;
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
  let cityFloorFn = null;
  function installCityFloor() {
    if (!CBZ.floorAt || CBZ.floorAt === cityFloorFn) return;
    const prev = CBZ.floorAt;
    // never wrap a wrapper of ours (an older install that survived a mode
    // reset) — that is the recursion the _city marker exists to prevent
    if (prev._shaft) { cityFloorFn = prev; return; }
    baseFloor = prev;
    cityFloorFn = function (x, z) {
      if (live.length) {
        for (let i = 0; i < live.length; i++) {
          const y = shaftFloor(live[i], x, z);
          if (y != null) return y;
        }
      }
      return prev(x, z);
    };
    cityFloorFn._shaft = true;
    if (prev._city) cityFloorFn._city = true;
    CBZ.floorAt = cityFloorFn;
  }

  /* ============================================================
     FALLING DEBRIS — our own integrator, because systems/fx.js's is
     gated to survival mode and a city sinkhole must still crush people
     ============================================================ */
  function dropChunk(o) {
    mats();
    // every chunk is its own mesh, and `keep` ones never expire — so past a
    // ceiling the permanent pile stops growing and new debris is transient.
    // Five shafts' worth of kept rubble was 160 live meshes on its own.
    const keep = !!o.keep && chunks.length < 120;
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
      dmg: o.dmg != null ? o.dmg : 0, landed: false, keep: keep, t: 0,
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
     A BUILDING GOES IN, AND IT GOES IN LIKE A BUILDING

     The reference photograph has the towers STANDING at the lip, and the
     placement law protects that — a hole does not open under a building,
     because a tower whose footing is inside the mouth is a floating tower and
     this game's structural ledger has no concept of "undermined".

     But the mouth GROWS. A structure that was four metres clear of the plug is
     four metres inside the final radius, and at that moment the honest answer
     is not "it stands anyway" and not "it sinks into the ground" (which is the
     roster's generic collapse animation, and reads as a lift going down). It
     TIPS. The ground left from one side, so it hinges over that side, goes
     past vertical, stops being supported at all, and falls fifty metres down a
     shaft, spinning, into the rubble at the bottom.

     So this is a real integrator and not a canned animation:

       tip     angular acceleration about the base edge nearest the void,
               driven by gravity through the body's own height — a tall tower
               goes over slowly and a squat shop snaps over, because the same
               torque law is fed each one's own H.
       slide   the footing walks toward the centre while it leans: the ground
               under it is leaving, not hinged.
       fall    the moment the base centre is inside the mouth, support is gone
               and it is a body in free fall with its angular rate preserved.
       wall    it cannot pass through the shaft it is falling down; contact
               with the wall costs it horizontal speed and adds tumble, which
               is why it arrives at the bottom crooked and not neatly.
       impact  dust, shake, a real rubble field, and anyone standing down there
               is under a building. Then it STAYS — the wreck at the bottom is
               the hole's permanent furniture.

     The host supplies the object and its own teardown (colliders, platforms,
     glass, kill ledger) through the callbacks; this file supplies the physics,
     which is the part that is the same in every mode.
     ============================================================ */
  const swallowed = [];
  const SW_AXIS = new THREE.Vector3();
  const SW_Q = new THREE.Quaternion();

  CBZ.groundShaftSwallow = function (h, o) {
    if (!on() || !h || !o || !o.group || o.group._shaftSwallow) return null;
    const g = o.group;
    const bx = o.x != null ? o.x : g.position.x;
    const bz = o.z != null ? o.z : g.position.z;
    const by = o.gy != null ? o.gy : h.gy;
    /* A PIVOT OF OUR OWN. Rotating the building's own group assumes its origin
       sits at the base centre — true for the arena's towers today, and exactly
       the assumption that turns into a building spinning around a point two
       streets away the first time somebody authors one differently. Wrapping
       it in a group parked AT the base and re-seating the child by the same
       offset preserves the world transform exactly and makes the pivot a fact
       instead of a hope. */
    const home = g.parent || root();
    const homePos = g.position.clone();
    const pivot = new THREE.Group();
    pivot.position.set(bx, by, bz);
    pivot.userData.dynamic = true;            // core/staticfreeze.js: keep my matrix live
    /* AND IT IS SHAFT FURNITURE NOW. The same marker the walls carry, for the
       same three reasons: clearInside() must not hide a building that is
       mid-fall through the mouth, the ground cut must not punch a hole in its
       floor slabs, and the shader mask must not recompile its shaders. */
    pivot.userData.groundShaft = true;
    home.add(pivot);
    g.position.set(g.position.x - bx, g.position.y - by, g.position.z - bz);
    pivot.add(g);
    g._shaftSwallow = true;

    const dx = h.x - bx, dz = h.z - bz;
    const d = Math.hypot(dx, dz) || 1;
    const rec = {
      h: h, pivot: pivot, group: g, o: o, home: home, homePos: homePos,
      dirX: dx / d, dirZ: dz / d,           // downhill: the side the ground left
      x: bx, y: by, z: bz,
      th: 0, om: 0.35 + rnd() * 0.35,       // lean, and the shove that starts it
      spin: (rnd() - 0.5) * 0.7,            // yaw it picks up on the way down
      yaw: 0, vy: 0, vx: 0, vz: 0,
      H: Math.max(4, o.h || 12), W: Math.max(2.5, Math.max(o.w || 8, o.d || 8)),
      phase: "tip", t: 0, hitWall: 0,
    };
    swallowed.push(rec);
    if (CBZ.shake && nearCam(bx, bz, 90)) CBZ.shake(0.5);
    sfx("collapse", bx, bz);
    if (o.onTip) { try { o.onTip(rec); } catch (e) {} }
    return rec;
  };

  function tickSwallowed(dt) {
    if (!swallowed.length) return;
    const G = (CBZ.TUNE && CBZ.TUNE.gravity) || 22;
    for (let i = swallowed.length - 1; i >= 0; i--) {
      const s = swallowed[i], h = s.h;
      s.t += dt;
      if (s.phase !== "rest") {
        const dc = Math.hypot(s.x - h.x, s.z - h.z);
        /* SUPPORT. Half a footprint still over solid ground holds the base up;
           once the base centre itself is inside the mouth there is nothing
           under any of it. `th > 1.15` is the other way out — past ~66° a
           building has committed and no footing is bearing. */
        const supported = s.phase === "tip" && dc > h.mouth && s.th < 1.15;
        // gravity torque about the tipping edge, through the body's own height
        s.om += (G / s.H) * (0.30 + Math.sin(Math.min(s.th, Math.PI * 0.5))) * dt;
        s.th += s.om * dt;
        s.yaw += s.spin * dt;
        if (supported) {
          // the footing walks toward the void as the ground under it leaves
          const slide = 1.1 + s.th * 3.4;
          s.x += s.dirX * slide * dt;
          s.z += s.dirZ * slide * dt;
          s.y = h.gy - (1 - Math.cos(Math.min(s.th, 1.2))) * 0.9;
          s.vx = s.dirX * slide; s.vz = s.dirZ * slide; s.vy = 0;
        } else {
          if (s.phase === "tip") { s.phase = "fall"; s.vy = -1.5; }
          s.vy -= G * dt;
          s.x += s.vx * dt; s.z += s.vz * dt; s.y += s.vy * dt;
          /* THE SHAFT IS SOLID. Without this it drifts out through the wall
             and falls past the world; with it, a wall strike costs it half its
             horizontal speed and pays that into tumble, which is what puts it
             on the rubble at an angle instead of standing on its head. */
          const t = Math.max(0, Math.min(1, (h.gy - s.y) / h.depth));
          const wallR = wallRadius(h, t, Math.atan2(s.z - h.z, s.x - h.x)) - s.W * 0.28;
          const dd = Math.hypot(s.x - h.x, s.z - h.z);
          if (dd > wallR && dd > 0.01) {
            const nx = (s.x - h.x) / dd, nz = (s.z - h.z) / dd;
            s.x = h.x + nx * wallR; s.z = h.z + nz * wallR;
            s.vx = -nx * Math.abs(s.vx) * 0.35; s.vz = -nz * Math.abs(s.vz) * 0.35;
            s.om += 0.5; s.spin += (rnd() - 0.5) * 0.8;
            if (s.hitWall++ < 3 && CBZ.shake && nearCam(s.x, s.z, 70)) CBZ.shake(0.12);
          }
        }
        const floorY = CBZ.groundShaftFloor(s.x, s.z, rawFloor(s.x, s.z));
        if (s.y <= floorY + 0.35 && s.phase === "fall") swallowLand(s, floorY);
      }
      // ---- apply: one axis-angle about the pivot, plus the yaw it picked up
      SW_AXIS.set(s.dirZ, 0, -s.dirX).normalize();
      SW_Q.setFromAxisAngle(SW_AXIS, s.th);
      s.pivot.quaternion.copy(SW_Q);
      s.pivot.rotateY(s.yaw);
      s.pivot.position.set(s.x, s.y, s.z);
      s.pivot.updateMatrix();
      s.pivot.matrixWorldNeedsUpdate = true;
      // a wreck that has been still for a while stops costing anything —
      // it keeps its pivot and its pose, it just stops being integrated
      if (s.phase === "rest" && s.t > 6) { parked.push(s); swallowed.splice(i, 1); }
    }
  }
  /* GIVING THE BUILDING BACK. `arena.reset()` re-seats a fallen structure with
     `b.group.position.set(b.ox, b.gy, b.oz)` — which is only true if the group
     is still a direct child of the arena root. Every swallowed record is
     therefore reversible, and reversing it restores the ORIGINAL local
     position as well as the parent, so it does not matter whether the arena's
     reset ran before this or after it. */
  const parked = [];
  function unswallowAll() {
    const all = swallowed.concat(parked);
    for (let i = 0; i < all.length; i++) {
      const s = all[i];
      if (s.pivot.parent) s.pivot.parent.remove(s.pivot);
      s.pivot.remove(s.group);
      s.group.position.copy(s.homePos);
      s.group.quaternion.set(0, 0, 0, 1);
      s.group.rotation.set(0, 0, 0);
      s.group._shaftSwallow = false;
      s.home.add(s.group);
    }
    swallowed.length = 0; parked.length = 0;
  }

  function swallowLand(s, floorY) {
    const h = s.h;
    s.phase = "rest"; s.t = 0;
    s.y = floorY + 0.2;
    // it comes to rest crumpled, never square
    s.th = Math.max(1.15, Math.min(2.3, s.th)) + (rnd() - 0.5) * 0.25;
    s.om = 0; s.spin = 0;
    stats.swallowed++;
    /* A BUILDING ARRIVING AT THE BOTTOM. The dust and the shake are felt from
       the rim; the rubble is real falling debris on this file's own integrator
       (so it lands on the shaft floor, not on the terrain that used to be
       there); and anything alive down there is under a building. */
    const RUB = [0x70757e, 0x8b9097, 0x5c6168, 0x9aa0a8, 0x6a5539];
    const n = 16 + ((rnd() * 10) | 0);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, dd = rnd() * h.r * 0.8;
      dropChunk({
        x: s.x + Math.cos(a) * dd, z: s.z + Math.sin(a) * dd, y: s.y + 2 + rnd() * 6,
        vy: 1 + rnd() * 4, vx: Math.cos(a) * (1 + rnd() * 3), vz: Math.sin(a) * (1 + rnd() * 3),
        size: 0.9 + rnd() * 2.4, color: RUB[(rnd() * RUB.length) | 0],
        dmg: i < 5 ? 70 : 0, keep: true,
      });
    }
    eachActor(function (a) {
      if (!a || !a.pos || a.dead) return;
      if (a.pos.y > s.y + s.H * 0.6) return;
      if (Math.hypot(a.pos.x - s.x, a.pos.z - s.z) > s.W * 0.9 + 2) return;
      stats.crushed++;
      hurt(a, 1e6, "crushed by a building that fell into the sinkhole", { fromX: s.x, fromZ: s.z, force: 9, fling: 2 });
    });
    if (CBZ.shake && nearCam(s.x, s.z, 120)) CBZ.shake(0.85);
    sfx("collapse", s.x, s.z);
    if (CBZ.fx && CBZ.fx.dropDebris) {
      for (let i = 0; i < 8; i++) {
        CBZ.fx.dropDebris({ x: s.x + (rnd() - 0.5) * h.r, z: s.z + (rnd() - 0.5) * h.r, fromY: s.y + 4, vy: 3 + rnd() * 4, size: 1.2 + rnd(), color: 0x8f8676, linger: 2.2 });
      }
    }
    if (s.o.onRest) { try { s.o.onRest(s); } catch (e) {} }
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
      const keep = { x: h.x, z: h.z, gy: h.gy, depth: h.depth, seed: h.seed, born: h.born, surface: o.surface };
      disposeShaft(h);
      seq.shaft = CBZ.groundShaft(keep.x, keep.z, { r: want, depth: keep.depth, gy: keep.gy, seed: keep.seed, surface: keep.surface });
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
    if (!live.length && !seqs.length && !chunks.length && !swallowed.length) return;
    /* EXTERNAL CLEAR = RESET. The survival director empties CBZ.survHoles on
       match start and on mode exit; that array IS our registry, so an empty
       published list with live records means the world was reset under us and
       these meshes are orphans. Anything else is re-published. */
    if (!pub.length && live.length) {
      for (let i = live.length - 1; i >= 0; i--) if (live[i].mode === "survival") disposeShaft(live[i]);
      for (let i = seqs.length - 1; i >= 0; i--) seqs[i].dispose();
      clearChunks();
      unswallowAll();
    }
    for (let i = 0; i < live.length; i++) if (pub.indexOf(live[i]) < 0) pub.push(live[i]);
    // re-wrap in ANY mode if somebody re-installed a floor after us (a city
    // reset, a mode switch): the wrapper is what makes the stair walkable
    if (live.length && CBZ.floorAt !== cityFloorFn) installCityFloor();
    for (let i = seqs.length - 1; i >= 0; i--) { const s = seqs[i]; if (!s.done) s.tick(dt); }
    tickChunks(dt);
    tickSwallowed(dt);
    tickHazards(dt);
  });

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
     falls / crushed / buried / voidSaves are printed beside them so a build
     that "passes" by never opening a hole cannot look like a working one.
     ============================================================ */
  CBZ.shaftAudit = function () {
    let worst = 0, onSlope = 0, dow = 0, deepest = 0, priv = 0;
    for (let i = 0; i < live.length; i++) {
      const h = live[i];
      const s = CBZ.groundShaftSlope(h.x, h.z, h.r);
      if (s > worst) worst = s;
      if (s > CBZ.CONFIG.SHAFT_SLOPE_MAX) onSlope++;
      dow += h.depth / (h.r * 2);
      if (h.depth > deepest) deepest = h.depth;
      if (pub.indexOf(h) < 0) priv++;
    }
    return {
      shafts: live.length,
      published: pub.length,
      privateHoles: priv,
      holeSlopeMax: +worst.toFixed(3),
      holesOnSlopes: onSlope,
      slopeLaw: CBZ.CONFIG.SHAFT_SLOPE_MAX,
      deepest: +deepest.toFixed(1),
      deepOverWide: live.length ? +(dow / live.length).toFixed(2) : 0,
      voidsPerShaft: live.length ? live[0].voids.length : 0,
      stepsPerShaft: live.length ? live[0].stepN : 0,
      escapeReady: CBZ.CONFIG.SHAFT_ESCAPE !== false,
      /* THE GROUND IS ACTUALLY GONE. `sheetsCut` counts the ground sheets
         currently carrying a real ShapeGeometry hole and `sheetsOpen` counts
         them by live triangulation, so a build where the cut silently did
         nothing reads 0 with shafts > 0 — which is the ring, measured. */
      sheetsCut: cutSheets.length,
      sheetsOpen: cutSheets.reduce(function (n, rec) { return n + ((rec.cut || rec.hid) ? 1 : 0); }, 0),
      groundCuts: stats.groundCuts,
      mouthOverRim: live.length ? +(live[0].mouth / live[0].r).toFixed(2) : 0,
      cityShaftReady: !!(CBZ.CONFIG.CITY_SINKHOLES && CBZ.roadJunctions && CBZ.city && CBZ.city.arena),
      cityFloorWrapped: !!(CBZ.floorAt && CBZ.floorAt._shaft),
      sequences: seqs.length,
      chunks: chunks.length,
      // buildings the growing mouth actually took, and how many are still
      // being integrated (a wreck at the bottom parks after it settles)
      buildingsSwallowed: stats.swallowed,
      swallowing: swallowed.length,
      cut: stats.cut, siteRejects: stats.siteRejects,
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
