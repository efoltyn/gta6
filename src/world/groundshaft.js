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
     SHAFT_MASK_SLOTS  how many holes the ground can be cut for at once (the
                       GLSL array length; nearest the eye win, the rest are not
                       drawn — see THE SLOTS ARE A LENS below)
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
  if (CBZ.CONFIG.SHAFT_MASK_SLOTS == null) CBZ.CONFIG.SHAFT_MASK_SLOTS = 8;
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
  const stats = { falls: 0, crushed: 0, buried: 0, voidSaves: 0, siteRejects: 0, cut: 0, reMasked: 0, reSweeps: 0 };

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
  /* THE SLOTS ARE A LENS, NOT A LIMIT — AND THE NEAREST HOLE ALWAYS WINS ONE.

     `uniform vec4 uShaftV[N]` is a GLSL array, so N is fixed at compile time
     and the number of holes the ground can stop drawing for is CAPPED. That is
     inherent to masking-instead-of-cutting and it is fine; what was NOT fine
     was which N. The slots were filled with `live[0..3]` — creation order — so
     once the island held four shafts the FIFTH one, the one that had just
     opened under the player, was the one that got no slot. Its lip collar drew
     on unbroken grass with the road running straight over it, while floorAt
     (which has no cap and never had one) went on answering with the shaft
     floor. You saw a ring, and then you fell through it. Sinkholes are
     permanent by design and the arc repeats, so this was reached in any long
     match, and it always struck the newest hole — the one being looked at.

     Two changes make the cap a level of detail instead of a cliff:
       1. the slots are filled NEAREST-EYE-FIRST, so the hole you can walk into
          is by definition the hole that is drawn (and a shaft mid-collapse,
          which growTo() re-cuts to the back of `live` six times, keeps its slot
          instead of losing it on the first widening);
       2. a shaft that misses out is NOT DRAWN AT ALL — group hidden, and the
          props its mouth swallowed put back. Untouched ground is a quiet lie
          at 90 m; a ring lying on solid grass is a loud one at 2 m.
     `ringsOnSolidGround` in shaftAudit() is the invariant, pinned at 0. */
  const SHAFT_SLOTS = Math.max(1, Math.min(16, CBZ.CONFIG.SHAFT_MASK_SLOTS || 8));
  const shaftV = [];
  for (let i = 0; i < SHAFT_SLOTS; i++) shaftV.push(new THREE.Vector4(0, 0, 0, 0));
  const uShaftV = { value: shaftV };
  const maskedSites = [];
  const slotted = [];        // this frame's winners, nearest eye first
  const rank = [];           // scratch for the ranking — syncMask runs per frame
  function eyeX() { return CBZ.camera ? CBZ.camera.position.x : (CBZ.player && CBZ.player.pos ? CBZ.player.pos.x : 0); }
  function eyeZ() { return CBZ.camera ? CBZ.camera.position.z : (CBZ.player && CBZ.player.pos ? CBZ.player.pos.z : 0); }
  /* WHAT A SLOT IS RANKED ON. Distance to the EYE is the visual answer, and it
     is the camera that renders, so the camera leads. But the camera and the
     player come apart — a death cam, a cinematic, a chase cam left behind a
     car — and it is the PLAYER who falls, through a floor query that has no
     slot limit. So the score is the nearer of the two, and a shaft with the
     player actually inside it is pinned to a slot outright: "you are standing
     in a hole that is not being drawn" is the one state this cap must never be
     allowed to produce, rather than merely be unlikely to. */
  function slotScore(h, ex, ez, px, pz) {
    const de = (h.x - ex) * (h.x - ex) + (h.z - ez) * (h.z - ez);
    if (px == null) return de;
    const dp = (h.x - px) * (h.x - px) + (h.z - pz) * (h.z - pz);
    // inside the mouth: rank ahead of everything, closest-first among them
    if (dp < h.mouth * h.mouth) return -1e9 + dp;
    return de < dp ? de : dp;
  }
  function syncMask() {
    slotted.length = 0;
    if (live.length <= SHAFT_SLOTS) {
      for (let i = 0; i < live.length; i++) slotted.push(live[i]);
    } else {
      const ex = eyeX(), ez = eyeZ();
      const pp = CBZ.player && CBZ.player.pos;
      const px = pp ? pp.x : null, pz = pp ? pp.z : null;
      rank.length = 0;
      for (let i = 0; i < live.length; i++) rank.push(live[i]);
      rank.sort(function (a, b) { return slotScore(a, ex, ez, px, pz) - slotScore(b, ex, ez, px, pz); });
      for (let i = 0; i < SHAFT_SLOTS; i++) slotted.push(rank[i]);
    }
    for (let i = 0; i < SHAFT_SLOTS; i++) {
      const h = slotted[i];
      // the discard radius is the WALL's outer radius, not the removed-floor
      // radius: between the two lies the sliver of ground the wall stands
      // behind, and on the island that sliver is where the SEA was showing
      // through as a blue crescent at the rim.
      if (h) shaftV[i].set(h.x, h.z, h.r * 1.06, h.bottom);
      else shaftV[i].set(0, 0, 0, 0);
    }
    for (let i = 0; i < live.length; i++) setDrawn(live[i], slotted.indexOf(live[i]) >= 0);
  }
  /* A shaft is drawn only while the ground above it is being discarded. The
     props clearInside() swallowed come back with it, so an unslotted site
     reads as ground nothing has happened to rather than as a hole with a lid. */
  function setDrawn(h, drawn) {
    if (h._drawn === drawn) return;
    h._drawn = drawn;
    if (h.grp) h.grp.visible = drawn;
    if (h.hidden) for (let i = 0; i < h.hidden.length; i++) h.hidden[i].visible = !drawn;
  }
  const FRAG_HEAD = "uniform vec4 uShaftV[" + SHAFT_SLOTS + "];\n";
  const FRAG_TEST = "\n  for (int si = 0; si < " + SHAFT_SLOTS + "; si++) { vec4 sh = uShaftV[si]; if (sh.z <= 0.0) break; if (distance(SHAFTWORLD.xz, sh.xy) < sh.z) discard; }\n";
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
  /* ============================================================
     THE MASK FOLLOWS THE MESH, NOT THE MATERIAL OBJECT

     THE FAULT: "on my phone it is a ring with the ground drawn over the hole,
     but not in your screenshots." Both were true, and neither was the shader's
     fault. `maskMaterial` stamps a discard onto the material OBJECT that a
     ground mesh is wearing at the moment a shaft is cut. It is not the mesh's
     property and nothing re-checks it — so anything that hands that mesh a
     DIFFERENT material afterwards silently removes the hole's lid-remover and
     the ground draws straight back over the mouth. The floor query has no such
     dependency, so you still fall in: a ring you fall through, the exact
     artefact this file has now produced three separate ways.

     Two systems in this game replace ground materials at runtime, both in
     core/gfx.js, and both are driven by the QUALITY TIER:

       swapTree()      walks the whole scene and flips every cmat material to
                       its `_cbzTwin` (Lambert ⇄ Standard) when tier().pbr
                       changes — `o.material = m._cbzTwin`
       promoteMerged() swaps the batcher's merged output between its source
                       Lambert and a promoted Standard

     Which is why this was invisible here and obvious on the owner's phone: a
     desktop holds one tier for a whole session, while core/quality.js's auto
     sampler drops tiers when the frame rate dips — and the frame rate dips
     precisely during a disaster, which is the only time a sinkhole exists to
     be covered up. Nothing about iOS, Safari, WebGL1 or GLSL precision: the
     phone simply gets to the code path a fixed-tier desktop never reaches.

     So the sweep now REMEMBERS THE MESHES it masked, and `healMask()` re-stamps
     any whose material has been swapped since. It is an array scan with a
     boolean early-out, cheap enough to run every frame a shaft is open, and it
     is indifferent to WHY the material changed — a tier flip, a batch pass, a
     mod, or the next system nobody has written yet. `shaftAudit().reMasked`
     counts the saves. */
  const maskedMeshes = [];
  const REHEAL_SECS = 1.5;      // one shaft re-swept per this many seconds, round-robin
  let healT = 0, healIdx = 0;
  function takeMesh(o) {
    if (!o || !o.material) return;
    for (let p = o; p; p = p.parent) if (p.userData && p.userData.groundShaft) return;
    if (Array.isArray(o.material)) { for (let k = 0; k < o.material.length; k++) maskMaterial(o.material[k]); }
    else maskMaterial(o.material);
    // recorded ONCE per mesh; the healer re-reads o.material every pass, so a
    // mesh recorded while wearing its Lambert covers its Standard twin too
    if (!o.userData._shaftSwept) { o.userData._shaftSwept = true; maskedMeshes.push(o); }
  }
  function healMask() {
    for (let i = 0; i < maskedMeshes.length; i++) {
      const o = maskedMeshes[i], m = o.material;
      if (!m) continue;
      if (Array.isArray(m)) {
        for (let k = 0; k < m.length; k++) if (m[k] && !m[k]._shaftMasked) { maskMaterial(m[k]); stats.reMasked++; }
      } else if (!m._shaftMasked) {
        maskMaterial(m); stats.reMasked++;
      }
    }
  }

  /* ONE SWEEP PER SITE PER RADIUS — and the second half of that is the point.

     A repeat visit used to be skipped outright, on the reasoning that the
     materials are already masked and only the uniform moves. That holds on the
     island, where ONE disc material is the entire ground, and fails in the city,
     where a junction is dozens of separate meshes: road, lane paint, kerb, lot
     slab. The growth phase cuts the first plug at HALF the final radius, so a
     site swept once was swept at r/2 — and every road mesh sitting in the
     annulus between r/2 and r kept drawing, leaving a partial lid of tarmac
     over the void. Measured on a city junction: 124 flat surfaces over the
     mouth, 48 masked.

     So a site remembers the radius it was swept at and is swept AGAIN when the
     hole outgrows it. Still bounded — six or seven re-cuts, each only touching
     materials that are not masked yet, and `_shaftMasked` makes every repeat a
     cheap early-out. */
  function maskGroundAt(h, force) {
    const R = h.mouth + 2;
    let site = null;
    for (let i = 0; i < maskedSites.length; i++) {
      if (Math.hypot(maskedSites[i].x - h.x, maskedSites[i].z - h.z) < 4) { site = maskedSites[i]; break; }
    }
    if (site) {
      if (R <= site.r && !force) return; // already swept this wide or wider
      if (R > site.r) site.r = R;        // it has grown: sweep the new annulus
    } else {
      maskedSites.push({ x: h.x, z: h.z, r: R });
    }
    if (force) stats.reSweeps++;
    const take = takeMesh;
    /* TWO PHASES, TWO try/catches, AND THAT SEPARATION IS THE WHOLE CITY FIX.

       These used to share one `try`, which quietly made the city sinkhole a
       hole nothing was ever masked for. `root()` is the arena group in
       survival but THE WHOLE SCENE in the city, and the scene contains
       Sprites; r128's Sprite.raycast dereferences `raycaster.camera`, which a
       bare `new THREE.Raycaster()` leaves null, so phase (a) threw on the
       first sprite it reached — and took phase (b), the sweep that actually
       finds the road, the kerb, the lot slab and the ground plate, down with
       it. Every city shaft was therefore the exact fault this file exists to
       have fixed: a lip ring on intact tarmac with a 40 m drop under it.

       So: the raycaster is handed a camera (sprites answer instead of
       throwing), and each phase now fails alone. Phase (b) is the
       load-bearing one — it is a box test over the footprint and cannot
       throw on somebody else's mesh — so the mask survives anything (a) hits. */
    try {
      // (a) what the sky sees through — catches the ground plate and the sea
      const rc = new THREE.Raycaster(new THREE.Vector3(h.x, h.gy + 60, h.z), new THREE.Vector3(0, -1, 0), 0, 60 + h.depth + 40);
      if (CBZ.camera) rc.camera = CBZ.camera;
      const hits = rc.intersectObject(root(), true) || [];
      for (let i = 0; i < hits.length; i++) take(hits[i].object);
    } catch (e) { /* a scene we cannot ray is still swept by (b) below */ }
    try {
      /* (b) every FLAT surface overlapping the footprint. One ray down the
         middle is not enough: a road, its lane paint, a kerb and a lot slab
         are separate meshes at slightly different heights and a ray that
         misses one by a metre leaves a strip of tarmac hanging over the void
         — which is exactly what the first pass photographed. Flat-only
         (under 3 m tall) so this never recompiles a building's shader for a
         hole that, by the placement law, is not under a building anyway. */
      const box = new THREE.Box3();
      root().traverse(function (o) {
        if (!o.isMesh || !o.geometry) return;
        let p = o; while (p) { if (p.userData && p.userData.groundShaft) return; p = p.parent; }
        if (o.material && o.material._shaftMasked) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        if (box.max.y - box.min.y > 3) return;
        if (box.max.y < h.bottom || box.min.y > h.gy + 2.5) return;
        if (box.max.x < h.x - R || box.min.x > h.x + R) return;
        if (box.max.z < h.z - R || box.min.z > h.z + R) return;
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
        while (p) { if (p.userData && p.userData.groundShaft) { mine = true; break; } p = p.parent; }
        if (mine) continue;
        // a canopy, a roof or a sign is not the ground; the ground is the
        // surface at the height the shaft's own rim was solved from
        const py = hits[i].point.y;
        if (py > gy + 2.5 || py < gy - 2.5) continue;
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!mat || !mat.color) continue;
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
    const nV = 3;
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
    // DEEPER THAN WIDE, ALWAYS. The reference reads as a shaft, not a crater,
    // and the ratio is the whole reason: default 2.1x the diameter.
    const depth = Math.max(r * 2.4, opts.depth || r * 4.2);
    const h = {
      x: x, z: z, r: r,
      mouth: r * 0.93,          // the floor is gone a hair inside the visible rim
      gy: gy, depth: depth, bottom: gy - depth,
      seed: opts.seed != null ? opts.seed : (x * 0.37 + z * 0.11),
      surfaceColor: opts.surface === "asphalt" ? 0x2f2e2c : (opts.surface === "soil" ? 0x554129 : (survMode() ? 0x4c5a34 : 0x2f2e2c)),
      mode: CBZ.game ? CBZ.game.mode : null,
      grp: new THREE.Group(),
      voids: [],
      coneR: r * 0.66, coneH: Math.min(4.2, depth * 0.11),
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
    if (CBZ.CONFIG.SHAFT_ESCAPE !== false) {
      h.stepN = Math.max(6, Math.min(34, Math.round(depth / 1.3)));
      h.stepA0 = (h.seed % 1) * TAU;
      h.stepIn = h.mouth * 0.78;
    }
    const wall = buildWall(h);
    const lip = buildLip(h);
    const rubble = buildFloorFurniture(h);
    const stair = buildStair(h);
    // the black — a disc at the very bottom under the rubble, so a shaft you
    // cannot see the bottom of still reads as bottomless rather than as a gap
    const dark = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 24),
      new THREE.MeshBasicMaterial({ color: 0x05040a }));
    dark.rotation.x = -Math.PI / 2;
    dark.position.set(x, h.bottom - 0.2, z);
    wall.position.set(x, 0, z);
    lip.position.set(x, 0, z);
    // the collar is ground, so it takes ground's shadows too: an unshadowed
    // annulus inside a shadowed field is the ring again, drawn in light
    lip.receiveShadow = true;
    h.grp.add(wall, lip, dark);
    if (rubble) h.grp.add(rubble);
    if (stair) h.grp.add(stair);
    h.grp.userData.groundShaft = true;
    root().add(h.grp);
    h.dispose = function () { disposeShaft(h); };
    live.push(h);
    if (pub.indexOf(h) < 0) pub.push(h);
    stats.cut++;
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
    syncMask();                 // the ground comes back the moment the record does not
  }
  CBZ.groundShaftClear = function (mode) {
    for (let i = live.length - 1; i >= 0; i--) if (!mode || live[i].mode === mode) disposeShaft(live[i]);
    for (let i = seqs.length - 1; i >= 0; i--) seqs[i].dispose();
    clearChunks();
    maskedSites.length = 0;
    for (let i = 0; i < maskedMeshes.length; i++) if (maskedMeshes[i].userData) maskedMeshes[i].userData._shaftSwept = false;
    maskedMeshes.length = 0;
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
    if (live.length && CBZ.floorAt !== cityFloorFn) installCityFloor();
    /* THE MASK IS MAINTAINED, NOT INSTALLED ONCE. Two passes, both bounded:
       healMask() re-stamps meshes whose material was swapped out from under us
       (an array scan with a boolean early-out — every frame is fine), and a
       round-robin RE-SWEEP catches ground that did not exist at cut time at
       all: a mesh built later, a batch merge, an LOD swap, a mod. One shaft
       per REHEAL_SECS, so the traverse cost is the same whatever the hole
       count, and `_shaftMasked` makes every already-correct mesh a boolean
       test. This is deliberately blind to the CAUSE — the reported failure
       reproduces on a phone and not on a desktop, and a fix that only knows
       about the mechanisms I could name here would fix exactly the ones I
       already checked. */
    if (live.length) {
      healMask();
      healT += dt;
      if (healT >= REHEAL_SECS) {
        healT = 0;
        healIdx = (healIdx + 1) % live.length;
        const h = live[healIdx];
        if (h && !h._closed) maskGroundAt(h, true);
      }
    }
    // the slots follow the eye, so they have to be re-dealt as the eye moves.
    // Only once there are more holes than slots — below that every shaft owns
    // one permanently and the sort would be a per-frame no-op.
    if (live.length > SHAFT_SLOTS) syncMask();
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
        "\nreMask " + a.reMasked + "  reSweep " + a.reSweeps + "  collar " + a.collarSampled +
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
        if (!mat || mat._shaftMasked) return;
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
    const ex = eyeX(), ez = eyeZ();
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
         seven times and maskGroundAt sweeps the new annulus on each pass, so
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
      maskSlots: SHAFT_SLOTS,
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
      cityFloorWrapped: !!(CBZ.floorAt && CBZ.floorAt._shaft),
      sequences: seqs.length,
      chunks: chunks.length,
      cut: stats.cut, siteRejects: stats.siteRejects,
      // the self-heal's own record: how often a ground material had to be
      // re-stamped because something swapped it, and how many re-sweeps ran
      reMasked: stats.reMasked, reSweeps: stats.reSweeps,
      sweptMeshes: maskedMeshes.length,
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
