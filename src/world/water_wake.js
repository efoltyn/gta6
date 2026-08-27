/* ============================================================
   src/world/water_wake.js — SPLASHES, WAKES AND RAIN RIPPLES.

   WHAT WAS WRONG (owner, 2026-08-26: "there is no splashing in any water")
   -------------------------------------------------------------------------
   He was right, and it was one line. CFG.WATER_WAKE_SPRITES defaulted to
   FALSE, spawn() refused every caller on that flag, and CBZ.waterEmitFree()
   answered 0 — so the ENTIRE water particle system of this game drew nothing,
   everywhere, in every mode. Not a starved budget, not a mode gate, not a
   sub-pixel size: the pool was never allocated and the THREE.Points object
   was never added to a scene. ~30 live call sites were emitting into it —
   city/swim.js's entry and exit, shark_sim.js's breach (strength 3.2-4.6),
   wildlife_tame.js's ridden breach (1.3-9), wildlife_orca.js's spout and
   landing, marine_frenzy, marine_predation, every bullet through
   water_impact.js's bus, every rain drop, every boat's bow wave and rooster
   tail — and every one of them was a function call that returned false.

   WHY IT HAD BEEN TURNED OFF, AND WHY THAT WAS THE WRONG FIX
   -------------------------------------------------------------------------
   The complaint behind it was real (owner, 2026-08-11: "anything that renders
   as camera facing is slop"). A THREE.Points sprite is ALWAYS screen-aligned,
   and SURFACE FOAM IS A THING THAT LIES IN THE WATER PLANE. You play with your
   eye 1.5-3 m over the sea, so a foam ring 15 m out is seen at about a 6 degree
   grazing angle: it should project to a sliver. The billboard drew it as a
   perfect upright white circle standing on the water, which IS a bubble, which
   is what he saw. The previous pass answered that by killing the whole pool —
   taking the genuinely AIRBORNE spray, which a billboard is honest about, down
   with the foam it was never suited to.

   THE FIX IS THE SPLIT, NOT THE SWITCH
   -------------------------------------------------------------------------
   `ride` already told us which was which and nobody read it as a RENDERING
   decision. Now it is the only one:

     ride:false  AIRBORNE. Ballistic droplets and torn sheet in the air. A
                 billboard is correct here — a flying drop of water has no
                 orientation to betray — so these are the pooled THREE.Points,
                 rewritten: no texture atlas, a procedural shape in
                 gl_PointCoord, and VELOCITY-ALIGNED. The vertex program
                 projects a step along the particle's own velocity into screen
                 space and hands the fragment the angle, so fast spray SMEARS
                 along its travel into a teardrop and slow spray stays a bead.
                 Lit from the top so it reads as water catching the light
                 against a dark sea rather than as smoke.
     ride:true   SURFACE. Never a billboard again. Real flat geometry IN the
                 water plane, every vertex re-reading CBZ.citySeaHeightAt so
                 the foam lies on the live swell and foreshortens honestly at
                 a grazing angle. Two profiles over one mesh: a RING (a crest
                 with nothing inside it — impact collapse, Kelvin bow wave,
                 rain dimple) and a WASH (a filled patch, brightest in the
                 middle — prop churn, transom boil). The churn texture is
                 sampled in WORLD space, so an expanding ring travels THROUGH
                 the foam instead of looking like a decal being scaled up.

   ...plus one thing the old system had no vocabulary for at all:

     THE CROWN SHEET. A real impact does not throw beads, it throws a WALL of
     water: a hollow cone that erupts from the entry point, flares outward,
     tears into filaments at the rim and falls back. That silhouette is what
     makes a splash read as mass. It is a pooled MESH (a 4-ring cone strip per
     slot, base riding the swell), torn open in the fragment shader by the
     shared ripple noise so it is columns of water and not a lampshade. One
     draw call for every crown alive. CBZ.waterCrown() is its hook, and
     world/water_impact.js's body/vehicle/blast vocabularies drive it.

   So: FOUR drawables, four draw calls, one system.
     points     airborne spray                  (THREE.Points, procedural)
     surfMesh   surface foam rings and washes   (flat geometry, rides swell)
     crownMesh  the erupting sheet              (cone strips, rides swell)
     ribMesh    the persistent stern trail      (unchanged, it was always right)

   THE RIBBON IS THE PROOF THIS IS THE RIGHT SHAPE: it is the one part of this
   file that never read as a bubble, and it is the one part that was already
   real geometry re-seating on the live surface every frame. The surface foam
   and the crown are built its way.

   ============================================================
   CBZ.waterWakeFor(obj, dt, opts?) — THE ONE WAKE HOOK
   ============================================================
   Anything moving through the surface asks for its wake with ONE line. The
   hull sim (world/water_helm.js) calls it feature-detected at the end of every
   helm frame; this file's own sweep calls it for every other marine car; the
   swimmer and every drifting body in CBZ.waterOccupants() call it too. There
   is exactly one wake vocabulary in the game and it is authored here.

   WHAT IT READS OFF THE OBJECT (every field optional, every one has a
   fallback, so it works on a car record that publishes nothing):
     pos|position .x/.z   where it is                  (or opts.x / opts.z)
     heading              radians, fwd = (sin h, cos h)(or opts.heading, or
                                                        atan2(vx, vz))
     v                    SIGNED forward speed m/s     (or opts.speed, or |vx,vz|)
     _planing   0..1      how far onto the plane       (else derived from speed
                                                        vs a hull-speed ladder)
     _trim      radians   bow-up positive              (else 0)
     _steerInput -1..1    drive/rudder angle           (else 0)
     _throttle  0..1      commanded thrust             (else recovered from
                                                        measured acceleration)
     _hullSpec  {loa, beam, wakeScale, planeMs}        (else car.dims, else the
                                                        6.2m runabout's numbers)
   Returns true iff it owned the wake for this object this frame; it stamps
   obj._wakeStamp so the sweep never double-draws a hull the helm already drove.
   Degrade-safe BOTH ways: with no helm the sweep drives every boat from
   measured state; with a helm the published state simply wins.

   THE FOUR COMPONENTS (research: a wake is not one effect)
     1. BOW WAVE     — the divergent Kelvin V, shed from the BOW where it is
                       physically made. Amplitude ~ v^2, present at every
                       speed. Bow-up trim cuts it (the forefoot is out).
     2. TRANSOM WAKE — foam where the flow separates off the transom, plus THE
                       RIBBON below: the persistent trail.
     3. PROP WASH    — a narrow jet off the drive, ANGLED WITH THE STEERING.
                       The helm vectors thrust, so the jet is thrown to the
                       outside of the turn: crank the wheel, the wash swings.
     4. CHINE SPRAY  — ONLY while _planing is high: a wide, low, fast sheet off
                       both hard chines plus a genuinely airborne ballistic
                       rooster tail off the transom. A 34m yacht never planes,
                       so it never makes any of it; a RIB makes it at once.
   Displacement and planing differ IN KIND, not degree: below the hump the
   spray is sparse, slow and lands almost instantly (it merges into foam);
   above it the spray is fast, near-horizontal and airborne. Slow down and the
   rooster tail visibly collapses back to the calm look.

   KELVIN GEOMETRY: the half-angle is a CONSTANT 19.47deg, independent of hull
   speed — so a shed ring gets a lateral velocity of exactly spd*tan(19.47deg)
   and drag = 1 (no damping). Its offset then grows as age*spd*tan(19.47deg),
   i.e. exactly in step with the boat's own forward travel, and the V holds its
   true angle from idle to full throttle with no dispersion maths at all.
   Speed moves the width, the opacity and the emission rate — never the angle.

   THE RIBBON (the persistent stern trail)
   -------------------------------------------
   A trail-mesh strip, not particles. It delivers what a particle pool
   structurally CANNOT — a 10-second wake at zero pool cost.
     • Vertex PAIRS are emitted at the transom, gated by a MINIMUM DISTANCE
       MOVED (so a slow or stopped boat never spams overlapping points).
     • They live in a PREALLOCATED Float32Array ring buffer with a wrapping
       write index — never a growing JS array, never a per-frame allocation.
     • All slots share ONE geometry, ONE material and ONE draw call; the index
       buffer is built once and never rebuilt. Unused points collapse onto the
       newest vertex, so they cost zero fragments.
     • Every vertex re-reads CBZ.citySeaHeightAt each frame, exactly as the
       foam does, so the trail RIDES the swell instead of cutting crests.
     • V scrolls with arc length since emission, U runs across the rails,
       alpha is exp(-age/tau), width grows as sqrt(age) (turbulent spreading —
       the 19.47deg divergence is the RINGS' job, not the trail's).
     • Self-intersection on hard turns is handled the way wakes forgive it:
       the emission heading is low-passed before the perpendicular is taken,
       and both the width and its spread rate shrink with local curvature, so
       a hard turn draws a narrow ribbon that reads as churn, not as folded
       geometry.

   Prop churn scales with THROTTLE, not raw speed — loudest coming off a stop
   and in reverse, quietest at a steady cruise. If the helm publishes
   _throttle it is used directly; otherwise it is recovered from measured
   acceleration plus a reverse term (vehicles.js keeps throttle as a local).

   Determinism: this is runtime-only presentation, never world generation, so
   randomness is permitted here (see CLAUDE.md). It does NOT come from
   Math.random, though — every jitter in this file is drawn from a file-local
   mulberry32 (fxRand, below), so the FX can never move the simulation's shared
   dice. Nothing in this file touches gameplay state.

   Budget: every pool is sized by CBZ.qScale, so tier 0 gets a fraction of what
   tier 4 does. Every wake component checks how full the pools already are
   before it emits, in priority order (bow wave and prop wash first, rooster
   tail last), so three RIBs and a superyacht degrade gracefully instead of
   starving the rain and the splashes. Ribbons cost the pools NOTHING.

   COLOUR: this renderer runs the legacy linear pipeline (outputEncoding =
   sRGBEncoding, ColorManagement off), so an authored hex is treated as LINEAR
   and comes out brighter than the swatch — the trap that once rendered 0x53211f
   as rgb(140,85,70). Foam and spray are authored at the top of the range where
   that transform is nearly the identity, and calibrated against a screenshot of
   the dark sea rather than against the constant.

   FLAGS (no new ones — see CLAUDE.md's no-flag law)
     CBZ.CONFIG.WATER_WAKE_FX      (default ON, declared in world/water_spec.js)
                                   OFF -> nothing is created and nothing ticks.
     CBZ.CONFIG.WATER_WAKE_V2      (default ON, here) OFF -> the four-component
                                   vocabulary stands down to just the Kelvin
                                   bow rings + prop wash (the two components
                                   that existed before), same code path.
     CBZ.CONFIG.WATER_WAKE_RIBBON  (default ON, here) OFF -> no trail mesh is
                                   ever created; the particles are untouched.
     CBZ.CONFIG.WATER_WAKE_DRIFT   (default ON, here) OFF -> drifting bodies /
                                   flooded cars stop making their own wakes.
   WATER_WAKE_SPRITES IS GONE. It was the bug. The reason it existed — surface
   foam drawn as a billboard — cannot happen any more, because surface foam is
   no longer drawn by the billboard path at all; `ride` routes it to geometry.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.WATER_WAKE_FX == null) CFG.WATER_WAKE_FX = true;

  // WATER_WAKE_V2: the four-component wake vocabulary (bow wave / transom /
  // steer-vectored prop wash / planing chine spray + rooster tail) driven off
  // the hull state the marine helm publishes. OFF -> waterWakeFor still runs
  // but emits ONLY the Kelvin bow rings and the prop wash, i.e. the two
  // components that existed before this pass, through the same functions.
  // One-line revert: ?cfg_WATER_WAKE_V2=0
  if (CFG.WATER_WAKE_V2 == null) CFG.WATER_WAKE_V2 = true;

  // WATER_WAKE_RIBBON: the persistent trailing wake mesh. OFF -> the mesh is
  // never created and the particle side is byte-identical.
  // One-line revert: ?cfg_WATER_WAKE_RIBBON=0
  if (CFG.WATER_WAKE_RIBBON == null) CFG.WATER_WAKE_RIBBON = true;

  // WATER_WAKE_DRIFT: anything CBZ.waterOccupants() reports as MOVING that is
  // not a hull and not the swimmer (a body on the swell, a flooded car being
  // carried by the current) gets the same wake vocabulary at a small scale.
  // One-line revert: ?cfg_WATER_WAKE_DRIFT=0
  if (CFG.WATER_WAKE_DRIFT == null) CFG.WATER_WAKE_DRIFT = true;

  // The one gate. WATER_V2 is the whole-stack master switch (water_spec.js).
  function fxOn() { return CFG.WATER_WAKE_FX !== false && CFG.WATER_V2 !== false; }

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  /* ---- THE FX RANDOM STREAM — NOT Math.random ---------------------------
     Every jitter value in this file comes from HERE, and the reason is the
     A/B harness rather than the game. A visual before/after pass seeds ONE
     global Math.random from an LCG so both columns walk the same dice; any
     path that draws a different NUMBER of values between the two builds
     desynchronises everything downstream of it, and presentation is exactly
     the kind of code whose draw count changes when you improve it (a crown
     that now takes a seed, a distance gate that now rolls to thin distant
     spray). FX must never be able to move the simulation's dice.

     So: mulberry32, seeded once, file-local. Same statistical quality, same
     cost, zero coupling — the sim's stream is untouched no matter how much
     water this file decides to throw. (The sibling file uses a different
     seed constant so the two streams cannot march in step.)

     This is still runtime-only presentation and nothing here touches world
     generation, so it is not a determinism requirement — it is an isolation
     one. */
  let _fxSeed = 0x9E3779B9 >>> 0;
  function fxRand() {
    _fxSeed = (_fxSeed + 0x6D2B79F5) >>> 0;
    let t = _fxSeed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function surfY(x, z) {
    return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z)
      : (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48);
  }

  const KIND_DROP = 0, KIND_RING = 1;
  // tan(19.47deg) — the Kelvin half-angle, a constant of deep-water gravity
  // waves and independent of hull speed.
  const TAN_KELVIN = 0.353553;
  // Default per-second retention for foam riding the surface. 1 = no damping
  // at all, used by the Kelvin wake rings so their lateral offset grows
  // linearly with age and the V holds its angle.
  const RIDE_DRAG = 0.22;

  // ============================================================
  //  A. AIRBORNE SPRAY — the pooled THREE.Points, rewritten
  // ============================================================
  // No atlas: the droplet is drawn procedurally in gl_PointCoord, which is what
  // lets it be VELOCITY-ALIGNED (a texture cannot rotate on a point sprite; a
  // shader can). BEWARE: gl_PointCoord is Y-DOWN. A previous wave drew a flame
  // upside down on exactly this, so the very first thing the fragment does is
  // flip into a Y-UP frame and everything after that reads as screen space.
  const MAX = 1024;
  function budget() { return Math.max(0, (CBZ.qScale ? CBZ.qScale(220, MAX) : 620) | 0); }

  // Airborne droplets are authored in METRES and they are small — a bullet
  // spurt bead is 6 cm. At a 40 m gameplay distance that projects to under two
  // pixels, which is the difference between "spray" and "nothing". Real spray
  // at distance reads as a white MASS, so every bead is drawn a little larger
  // than its physical size and the shader enforces a pixel floor. ONE named
  // constant rather than a fudge scattered through thirty call sites.
  const DROP_GAIN = 1.9;
  const DROP_MIN_PX = 2.6;

  let points = null, geo = null, mat = null;
  let pos = null, aSize = null, aAlpha = null, aVel = null;
  let vel = null, life = null, maxLife = null, grow = null, size0 = null, alpha0 = null;
  let count = 0;

  function buildPoints() {
    if (points || typeof document === "undefined" || !CBZ.scene) return;
    pos = new Float32Array(MAX * 3);
    aSize = new Float32Array(MAX);
    aAlpha = new Float32Array(MAX);
    aVel = new Float32Array(MAX * 3);
    vel = new Float32Array(MAX * 3);
    life = new Float32Array(MAX);
    maxLife = new Float32Array(MAX);
    grow = new Float32Array(MAX);
    size0 = new Float32Array(MAX);
    alpha0 = new Float32Array(MAX);

    geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aVel", new THREE.BufferAttribute(aVel, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

    mat = new THREE.ShaderMaterial({
      name: "CBZ Water Spray",
      uniforms: {
        uTint: { value: new THREE.Color(0x9fd0dd) },   // the cool underside
        uPix: { value: 600 },
        uAspect: { value: 1.7 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      vertexShader: [
        "attribute float aSize;",
        "attribute float aAlpha;",
        "attribute vec3 aVel;",
        "uniform float uPix;",
        "uniform float uAspect;",
        "varying float vAlpha;",
        "varying float vAng;",
        "varying float vStretch;",
        "void main() {",
        "  vAlpha = aAlpha;",
        "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
        "  vec4 clip = projectionMatrix * mv;",
        "  gl_Position = clip;",
        // THE SMEAR. Project a short step ALONG this droplet's own velocity and
        // hand the fragment the screen-space angle it makes. A point sprite
        // cannot rotate, but its CONTENTS can, and that is the whole trick:
        // fast spray becomes a teardrop lying along its travel, slow spray
        // stays a bead, and nothing has to be a second particle system.
        "  vec4 c2 = projectionMatrix * (modelViewMatrix * vec4(position + aVel * 0.035, 1.0));",
        "  vec2 s0 = clip.xy / max(1e-4, abs(clip.w));",
        "  vec2 s1 = c2.xy / max(1e-4, abs(c2.w));",
        "  vec2 d = (s1 - s0) * vec2(uAspect, 1.0);",
        "  float dl = length(d);",
        "  vAng = dl > 1e-5 ? atan(d.y, d.x) : 0.0;",
        "  vStretch = clamp(1.0 + dl * 22.0, 1.0, 3.4);",
        // Perspective size, floored so distant spray still reads as white water
        // instead of dissolving into sub-pixel nothing, and capped so a droplet
        // passing the lens cannot fill the frame.
        "  float px = aSize * uPix / max(0.35, -mv.z);",
        "  gl_PointSize = clamp(px * (0.55 + 0.45 * vStretch), " + DROP_MIN_PX.toFixed(1) + ", 190.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 uTint;",
        "varying float vAlpha;",
        "varying float vAng;",
        "varying float vStretch;",
        "void main() {",
        // gl_PointCoord IS Y-DOWN. Flip once, here, and every line below reads
        // as ordinary screen space with +y up.
        "  vec2 pc = vec2(gl_PointCoord.x - 0.5, 0.5 - gl_PointCoord.y);",
        "  float ca = cos(vAng), sa = sin(vAng);",
        "  float rx = (pc.x * ca + pc.y * sa) / vStretch;",   // along travel
        "  float ry = -pc.x * sa + pc.y * ca;",               // across it
        // ...and the TAIL narrows: a thrown drop is a head with a thread behind
        // it, not a symmetric capsule.
        "  ry *= 1.0 + max(0.0, -rx) * (vStretch - 1.0) * 2.4;",
        "  float d = length(vec2(rx, ry)) * 2.0;",
        "  if (d > 1.0) discard;",
        "  float body = 1.0 - smoothstep(0.30, 1.0, d);",
        "  float core = pow(1.0 - d, 3.0);",
        "  float a = vAlpha * (body * 0.80 + core * 0.55);",
        "  if (a < 0.010) discard;",
        // LIT FROM ABOVE. The top of a drop is a specular white, the underside
        // keeps the sea's colour. It costs one mix and it is the whole reason
        // this reads as water catching light rather than as smoke.
        "  float up = clamp(pc.y * 2.2 + 0.5, 0.0, 1.0);",
        "  vec3 col = mix(uTint, vec3(1.0), clamp(0.34 + 0.66 * up * (0.45 + 0.55 * core), 0.0, 1.0));",
        "  gl_FragColor = vec4(col, min(1.0, a));",
        "  #include <tonemapping_fragment>",
        "  #include <encodings_fragment>",
        "}",
      ].join("\n"),
    });

    points = new THREE.Points(geo, mat);
    points.name = "world-water-spray";
    points.frustumCulled = false;
    points.renderOrder = 5;             // over the foam and the crown
    points.userData.dynamic = true;     // batch + farcull exempt
    points.userData.waterFx = true;
    points.visible = false;
    CBZ.scene.add(points);
  }

  // ---- THE VISIBILITY GATE ------------------------------------------------
  // A splash 400 m away is a few pixels and it must not be allowed to spend a
  // slot the splash in FRONT of you is about to need. The wake vocabulary has
  // always done this (resolve()'s `dg`); the impact bus never did, so a shark
  // sim breaching across the bay could fill the whole pool with spray nobody
  // could see and starve the one entry the player was looking at — measured at
  // 977 of 1024 droplets alive from off-screen sources alone.
  // Full rate inside NEAR, thinned out to a quarter at FAR, refused past it.
  // Full rate inside NEAR, thinned to a fifth by FADE, held there out to CUT,
  // nothing beyond. The floor matters: a megalodon breaching 500 m off is a
  // thing you are supposed to SEE and turn the boat toward, so it keeps a
  // fifth of its spray rather than disappearing at a hard edge.
  const FX_NEAR = 90, FX_FADE = 400, FX_CUT = 700, FX_FLOOR = 0.22;
  function visGain(x, z) {
    const cam = CBZ.camera;
    if (!cam || !cam.position) return 1;
    const dx = x - cam.position.x, dz = z - cam.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > FX_CUT * FX_CUT) return 0;
    if (d2 <= FX_NEAR * FX_NEAR) return 1;
    const d = Math.sqrt(d2);
    return Math.max(FX_FLOOR, 1 - (d - FX_NEAR) / (FX_FADE - FX_NEAR) * (1 - FX_FLOOR));
  }
  function visPass(x, z) {
    const g = visGain(x, z);
    return g >= 1 || (g > 0 && fxRand() < g);
  }

  // One AIRBORNE droplet. Ballistic: gravity is integrated in the tick and it
  // dies the moment it goes under the live surface.
  function spawnDrop(x, y, z, vx, vy, vz, size, growPerSec, ttl, alpha) {
    if (!pos || count >= budget()) return false;
    if (!visPass(x, z)) return false;
    const i = count++;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    aVel[i * 3] = vx; aVel[i * 3 + 1] = vy; aVel[i * 3 + 2] = vz;
    size0[i] = size * DROP_GAIN; aSize[i] = size0[i];
    grow[i] = growPerSec * DROP_GAIN;
    life[i] = 0; maxLife[i] = ttl > 0 ? ttl : 0.5;
    alpha0[i] = alpha == null ? 1 : alpha;
    aAlpha[i] = alpha0[i];
    return true;
  }

  function killDrop(i) {
    const last = --count;
    if (i !== last) {
      for (let k = 0; k < 3; k++) {
        pos[i * 3 + k] = pos[last * 3 + k];
        vel[i * 3 + k] = vel[last * 3 + k];
        aVel[i * 3 + k] = aVel[last * 3 + k];
      }
      aSize[i] = aSize[last]; aAlpha[i] = aAlpha[last];
      life[i] = life[last]; maxLife[i] = maxLife[last]; grow[i] = grow[last];
      size0[i] = size0[last]; alpha0[i] = alpha0[last];
    }
  }

  // ============================================================
  //  B. SURFACE FOAM — REAL FLAT GEOMETRY IN THE WATER PLANE
  // ============================================================
  // Everything that used to be a `ride:true` billboard is here instead. Each
  // slot is an annulus strip: SURF_SEG segments, an inner rail and an outer
  // rail, every vertex re-reading CBZ.citySeaHeightAt so the foam lies ON the
  // live swell. Seen at a grazing angle it foreshortens into a sliver, which
  // is what a ring of foam on the sea actually does and what the billboard
  // could never do.
  //
  // TWO PROFILES over ONE mesh, chosen per slot by aProf:
  //   RING (1) a crest with nothing inside it — the impact collapse ring, the
  //            Kelvin bow wave, a rain dimple. Its band is a roughly CONSTANT
  //            width that the radius travels outward through, not a shape
  //            scaled up, because that is the difference between a ripple and
  //            a zooming decal.
  //   WASH (0) a filled patch brightest in the middle — prop churn, transom
  //            boil, the white water left where something went in.
  const SURF_SLOTS = 112;
  const SURF_SEG = 18;
  const SURF_VERTS = (SURF_SEG + 1) * 2;
  function surfBudget() {
    const n = CBZ.qScale ? CBZ.qScale(26, SURF_SLOTS) : 80;
    return Math.max(0, Math.min(SURF_SLOTS, n | 0));
  }

  let surfMesh = null, surfGeo = null, surfMat = null;
  let surfPos = null, surfA = null, surfProf = null;
  const surfSlot = [];
  let surfCount = 0;

  function buildSurf() {
    if (surfMesh || typeof document === "undefined" || !CBZ.scene || !CBZ.waterRippleTexture) return;

    const V = SURF_SLOTS * SURF_VERTS;                 // 4256 — comfortably Uint16
    surfPos = new Float32Array(V * 3);
    surfA = new Float32Array(V);
    surfProf = new Float32Array(V);
    const uv = new Float32Array(V * 2);
    const idx = new Uint16Array(SURF_SLOTS * SURF_SEG * 6);
    let w = 0;
    for (let s = 0; s < SURF_SLOTS; s++) {
      const b = s * SURF_VERTS;
      for (let k = 0; k <= SURF_SEG; k++) {
        const v0 = (b + k * 2) * 2, v1 = v0 + 2;
        uv[v0] = 0; uv[v0 + 1] = k / SURF_SEG;         // inner rail
        uv[v1] = 1; uv[v1 + 1] = k / SURF_SEG;         // outer rail
      }
      for (let k = 0; k < SURF_SEG; k++) {
        const a0 = b + k * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
        idx[w++] = a0; idx[w++] = b0; idx[w++] = a1;
        idx[w++] = a1; idx[w++] = b0; idx[w++] = b1;
      }
      surfSlot.push({ live: false, x: 0, z: 0, r0: 0, gr: 0, age: 0, ttl: 1, a0: 1, prof: 1, vx: 0, vz: 0, drag: RIDE_DRAG, bear: 0, arc: Math.PI, dirty: false });
    }

    surfGeo = new THREE.BufferGeometry();
    surfGeo.setAttribute("position", new THREE.BufferAttribute(surfPos, 3).setUsage(THREE.DynamicDrawUsage));
    surfGeo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    surfGeo.setAttribute("aA", new THREE.BufferAttribute(surfA, 1).setUsage(THREE.DynamicDrawUsage));
    surfGeo.setAttribute("aProf", new THREE.BufferAttribute(surfProf, 1).setUsage(THREE.DynamicDrawUsage));
    surfGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    surfGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

    surfMat = new THREE.ShaderMaterial({
      name: "CBZ Water Foam",
      uniforms: {
        // NO new texture: the sea's own tiling ripple map is already a seamless
        // high-frequency field and water_spec.js's cbzSurf() already uses it as
        // a noise lookup. One water noise source, not two.
        uMap: { value: CBZ.waterRippleTexture() },
        uColor: { value: new THREE.Color(0xf2fbfd) },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      vertexShader: [
        "attribute float aA;",
        "attribute float aProf;",
        "varying float vA;",
        "varying float vProf;",
        "varying vec2 vUv2;",
        "varying vec2 vW;",
        "void main() {",
        "  vA = aA; vProf = aProf; vUv2 = uv; vW = position.xz;",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform sampler2D uMap;",
        "uniform vec3 uColor;",
        "uniform float uTime;",
        "varying float vA;",
        "varying float vProf;",
        "varying vec2 vUv2;",
        "varying vec2 vW;",
        "void main() {",
        "  if (vA < 0.004) discard;",
        "  float u = clamp(vUv2.x, 0.0, 1.0);",
        // WORLD-ANCHORED churn. The foam texture stays put in the world while
        // the ring expands THROUGH it — the single cue that separates a real
        // ripple from a decal being scaled up.
        "  float n1 = texture2D(uMap, vW * 0.090 + vec2(uTime * 0.011, uTime * -0.008)).r;",
        "  float n2 = texture2D(uMap, vW * 0.033 + vec2(-uTime * 0.006, uTime * 0.005)).g;",
        "  float churn = clamp(0.36 + (n1 - 0.5) * 2.4 + (n2 - 0.5) * 1.5, 0.0, 1.0);",
        // (GLSL ES 1.0 leaves a reversed-edge smoothstep formally undefined, so
        // every one below is written edge0 < edge1 and inverted by hand — the
        // same rule water_spec.js's shore functions follow.)
        "  float ring = 1.0 - smoothstep(0.0, 1.0, abs(u - 0.62) * 2.4);",
        // A WASH feathers all the way from its centre. The first cut held it
        // flat to u=0.22 and floored the churn at 0.30, which drew the white
        // water under a big entry as a hard-edged solid ellipse sitting on the
        // sea. Now the noise can punch right through it.
        "  float wash = pow(1.0 - u, 1.6);",
        "  float ringSel = min(vProf, 1.0);",
        "  float prof = mix(wash, ring, ringSel);",
        // vProf 2 == an ARC: a Kelvin crest is a piece of a circle, not a
        // circle, and drawing the whole ring is what made a boat's wake read
        // as a chain of hula hoops. Feather both cut ends so the arc has no
        // visible start or finish.
        "  prof *= mix(1.0, 1.0 - smoothstep(0.60, 1.0, abs(vUv2.y * 2.0 - 1.0)), step(1.5, vProf));",
        "  float a = vA * prof * (mix(0.10, 0.34, ringSel) + 0.90 * churn);",
        // the rim is EATEN by the noise, so the outline is never a clean circle
        "  a *= 1.0 - smoothstep(0.50, 1.0, u) * (1.0 - churn) * 1.15;",
        "  if (a < 0.004) discard;",
        "  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));",
        "  #include <tonemapping_fragment>",
        "  #include <encodings_fragment>",
        "}",
      ].join("\n"),
    });

    surfMesh = new THREE.Mesh(surfGeo, surfMat);
    surfMesh.name = "world-water-foam";
    surfMesh.frustumCulled = false;
    surfMesh.renderOrder = 3.5;         // over the sea and the ribbon, under the spray
    surfMesh.userData.dynamic = true;
    surfMesh.userData.waterFx = true;
    surfMesh.visible = false;
    CBZ.scene.add(surfMesh);
  }

  // Park a slot's whole vertex region on one point: every triangle in it is
  // zero-area and rasterises into exactly nothing.
  function surfCollapse(s) {
    const b = s * SURF_VERTS;
    for (let k = 0; k < SURF_VERTS; k++) {
      const v = b + k;
      surfPos[v * 3] = 0; surfPos[v * 3 + 1] = -9999; surfPos[v * 3 + 2] = 0;
      surfA[v] = 0;
    }
  }

  // prof: 0 = WASH (filled patch), 1 = RING (full circle), 2 = ARC (a crest
  // over `arcHalf` radians either side of `bear`, feathered at both ends).
  function spawnSurf(x, z, dia, growDia, ttl, alpha, prof, vx, vz, dragV, bear, arcHalf) {
    if (!surfPos) return false;
    if (!visPass(x, z)) return false;
    const cap = surfBudget();
    let slot = -1;
    for (let s = 0; s < cap; s++) if (!surfSlot[s].live) { slot = s; break; }
    if (slot < 0) return false;
    const sl = surfSlot[slot];
    sl.live = true; sl.dirty = true;
    sl.x = x; sl.z = z;
    sl.r0 = Math.max(0.05, dia * 0.5);
    sl.gr = growDia * 0.5;
    sl.age = 0; sl.ttl = ttl > 0 ? ttl : 0.8;
    sl.a0 = alpha == null ? 1 : alpha;
    sl.prof = prof;
    sl.vx = vx || 0; sl.vz = vz || 0;
    sl.drag = Number.isFinite(dragV) ? dragV : RIDE_DRAG;
    sl.bear = Number.isFinite(bear) ? bear : 0;
    sl.arc = (prof > 1.5 && arcHalf > 0) ? Math.min(Math.PI, arcHalf) : Math.PI;
    surfCount++;
    return true;
  }

  function surfTick(dt) {
    if (!surfMesh || !surfPos) return;
    const cap = surfBudget();
    let any = false, touched = false;
    for (let s = 0; s < surfSlot.length; s++) {
      const sl = surfSlot[s];
      if (s >= cap || !sl.live) {
        if (sl.live) { sl.live = false; surfCount--; }
        if (sl.dirty) { surfCollapse(s); sl.dirty = false; touched = true; }
        continue;
      }
      sl.age += dt;
      const t = sl.age / sl.ttl;
      if (t >= 1) { sl.live = false; surfCount--; surfCollapse(s); sl.dirty = false; touched = true; continue; }
      // the ocean current carries foam; the Kelvin rings pass drag 1 so their
      // lateral rate never decays and the V they trace holds its true angle.
      if (sl.drag < 0.999) {
        const k = Math.pow(sl.drag, dt);
        sl.vx *= k; sl.vz *= k;
      }
      sl.x += sl.vx * dt; sl.z += sl.vz * dt;

      const r = Math.max(0.06, sl.r0 + sl.gr * sl.age);
      // A RING's band is a roughly constant crest the radius travels outward
      // through; a WASH is filled to its centre.
      // A WIDER, SOFTER CREST. The first cut made the band 0.30 + 0.20r with a
      // crisp profile, and a boat's shed rings then read as a chain of separate
      // hula hoops lying on the sea instead of as one churned wake. Wide enough
      // that consecutive rings overlap is what makes a wake a wake.
      const band = sl.prof > 0.5 ? Math.min(r, 0.45 + r * 0.36) : r;
      const ri = Math.max(0, r - band);
      const fade = sl.prof > 0.5
        ? (1 - t) * (1 - t) * Math.min(1, t * 9)          // rings breathe in, then thin
        : Math.min(1, (1 - t) * 2.3) * Math.min(1, t * 12);
      const a = sl.a0 * fade;
      const b = s * SURF_VERTS;
      /* RIDE THE SWELL WITH A PLANE, NOT WITH 38 ORACLE CALLS.
         CBZ.citySeaHeightAt is not free — it sums the swell table AND asks the
         depth/shore fields for its amplitude — and asking it per VERTEX cost
         over four thousand calls a frame with the pool full, on top of the
         ribbon's own eleven hundred. So each patch samples it three times (its
         centre and two 2 m finite differences) and rides the tangent plane
         those describe. The longest swell row has a ~100 m wavelength, so a
         patch a few metres across is a tenth of a wave and a plane fit is
         accurate to millimetres; the clamp only exists so a 30 m blast ring
         cannot extrapolate itself into the air. Same oracle either way, so the
         island backend is used on the island exactly as before. */
      const cy0 = surfY(sl.x, sl.z);
      const gx = (surfY(sl.x + 2, sl.z) - cy0) * 0.5;
      const gz = (surfY(sl.x, sl.z + 2) - cy0) * 0.5;
      const a0 = sl.bear - sl.arc, span = sl.arc * 2;
      for (let k = 0; k <= SURF_SEG; k++) {
        const ang = a0 + (k / SURF_SEG) * span;
        const cs = Math.cos(ang), sn = Math.sin(ang);
        const idx0 = cs * ri, idz0 = sn * ri, odx = cs * r, odz = sn * r;
        const v0 = b + k * 2, v1 = v0 + 1;
        const iy = Math.max(-1.2, Math.min(1.2, gx * idx0 + gz * idz0));
        const oy = Math.max(-1.2, Math.min(1.2, gx * odx + gz * odz));
        surfPos[v0 * 3] = sl.x + idx0; surfPos[v0 * 3 + 1] = cy0 + iy + 0.06; surfPos[v0 * 3 + 2] = sl.z + idz0;
        surfPos[v1 * 3] = sl.x + odx; surfPos[v1 * 3 + 1] = cy0 + oy + 0.06; surfPos[v1 * 3 + 2] = sl.z + odz;
        surfA[v0] = a; surfA[v1] = a;
        surfProf[v0] = sl.prof; surfProf[v1] = sl.prof;
      }
      sl.dirty = true;
      touched = true;
      any = true;
    }
    surfMesh.visible = any;
    if (touched) {
      surfGeo.attributes.position.needsUpdate = true;
      surfGeo.attributes.aA.needsUpdate = true;
      surfGeo.attributes.aProf.needsUpdate = true;
    }
    if (any) surfMat.uniforms.uTime.value = CBZ.waterClock ? CBZ.waterClock() : 0;
  }

  function surfClearAll() {
    if (!surfPos) return;
    for (let s = 0; s < surfSlot.length; s++) {
      surfSlot[s].live = false; surfSlot[s].dirty = false;
      surfCollapse(s);
    }
    surfCount = 0;
    if (surfMesh) surfMesh.visible = false;
  }

  // ============================================================
  //  C. THE CROWN SHEET — the wall of water an impact throws up
  // ============================================================
  // The thing the old vocabulary had no word for. A real entry does not throw
  // beads, it throws a hollow CONE that erupts, flares outward, tears into
  // filaments at the rim and falls back — and that silhouette is what makes a
  // splash read as mass rather than as confetti. A megalodon coming down is a
  // house-sized sheet; a body off a quay is a metre of it; the same four
  // numbers describe both.
  //
  // Each slot is a 4-ring cone strip whose BASE rides the live swell. The rim
  // is torn open in the fragment shader by the shared ripple noise, so it is
  // columns of water and never a lampshade.
  const CROWN_SLOTS = 8;
  const CROWN_SEG = 26;
  const CROWN_RINGS = 4;
  const CROWN_VERTS = CROWN_RINGS * (CROWN_SEG + 1);
  function crownBudget() {
    const n = CBZ.qScale ? CBZ.qScale(2, CROWN_SLOTS) : 6;
    return Math.max(0, Math.min(CROWN_SLOTS, n | 0));
  }

  let crownMesh = null, crownGeo = null, crownMat = null;
  let crownPos = null, crownA = null, crownSeed = null;
  const crownSlot = [];
  let crownCount = 0;

  function buildCrown() {
    if (crownMesh || typeof document === "undefined" || !CBZ.scene || !CBZ.waterRippleTexture) return;

    const V = CROWN_SLOTS * CROWN_VERTS;
    crownPos = new Float32Array(V * 3);
    crownA = new Float32Array(V);
    crownSeed = new Float32Array(V);
    const uv = new Float32Array(V * 2);
    const idx = new Uint16Array(CROWN_SLOTS * (CROWN_RINGS - 1) * CROWN_SEG * 6);
    let w = 0;
    for (let s = 0; s < CROWN_SLOTS; s++) {
      const b = s * CROWN_VERTS;
      for (let j = 0; j < CROWN_RINGS; j++) {
        for (let k = 0; k <= CROWN_SEG; k++) {
          const v = (b + j * (CROWN_SEG + 1) + k) * 2;
          uv[v] = j / (CROWN_RINGS - 1);          // 0 base .. 1 rim
          uv[v + 1] = k / CROWN_SEG;              // around
        }
      }
      for (let j = 0; j < CROWN_RINGS - 1; j++) {
        for (let k = 0; k < CROWN_SEG; k++) {
          const a0 = b + j * (CROWN_SEG + 1) + k, a1 = a0 + 1;
          const c0 = a0 + (CROWN_SEG + 1), c1 = c0 + 1;
          idx[w++] = a0; idx[w++] = c0; idx[w++] = a1;
          idx[w++] = a1; idx[w++] = c0; idx[w++] = c1;
        }
      }
      crownSlot.push({ live: false, x: 0, z: 0, r0: 1, gr: 1, h: 2, age: 0, ttl: 1, a0: 1, dirty: false });
    }

    crownGeo = new THREE.BufferGeometry();
    crownGeo.setAttribute("position", new THREE.BufferAttribute(crownPos, 3).setUsage(THREE.DynamicDrawUsage));
    crownGeo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    crownGeo.setAttribute("aA", new THREE.BufferAttribute(crownA, 1).setUsage(THREE.DynamicDrawUsage));
    crownGeo.setAttribute("aSeed", new THREE.BufferAttribute(crownSeed, 1).setUsage(THREE.DynamicDrawUsage));
    crownGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    crownGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

    crownMat = new THREE.ShaderMaterial({
      name: "CBZ Water Crown",
      uniforms: {
        uMap: { value: CBZ.waterRippleTexture() },
        uColor: { value: new THREE.Color(0xf6fdff) },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      vertexShader: [
        "attribute float aA;",
        "attribute float aSeed;",
        "varying float vA;",
        "varying float vSeed;",
        "varying vec2 vUvC;",
        "void main() {",
        "  vA = aA; vSeed = aSeed; vUvC = uv;",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform sampler2D uMap;",
        "uniform vec3 uColor;",
        "uniform float uTime;",
        "varying float vA;",
        "varying float vSeed;",
        "varying vec2 vUvC;",
        "void main() {",
        "  if (vA < 0.004) discard;",
        "  float u = clamp(vUvC.x, 0.0, 1.0);",
        // VERTICAL FILAMENTS. A sheet of thrown water is COLUMNS with air
        // between them, not a membrane — and the first cut of this shader only
        // tore the rim, which drew a translucent drinking glass standing on
        // the sea. Three decorrelated lookups, all high-frequency AROUND the
        // cone and low-frequency UP it, so the noise runs in vertical streaks.
        "  float n1 = texture2D(uMap, vec2(vUvC.y * 11.0 + vSeed, u * 0.55 - uTime * 0.45)).r;",
        "  float n2 = texture2D(uMap, vec2(vUvC.y * 4.0 - vSeed * 0.7, u * 0.30 - uTime * 0.24)).g;",
        "  float n3 = texture2D(uMap, vec2(vUvC.y * 23.0 + vSeed * 1.7, u * 0.90)).b;",
        "  float fil = clamp(0.34 + (n1 - 0.5) * 2.9 + (n2 - 0.5) * 1.9 + (n3 - 0.5) * 0.9, 0.0, 1.0);",
        // THE SHEET IS CUT INTO COLUMNS ALL THE WAY DOWN, not just shredded at
        // the top: at the base a bit under half the circumference is open air,
        // and by the rim only the strongest fifth survives. That is the whole
        // difference between a wall of water and a tumbler.
        "  float cut = fil * 1.55 - 0.52 - u * 0.62;",
        "  if (cut < 0.0) discard;",
        "  float a = vA * clamp(cut * 2.4, 0.0, 1.0) * (0.30 + 0.85 * fil);",
        // AND THE BASE DISSOLVES. The cone's lowest ring is a hard geometric
        // boundary lying in the water plane, and drawn at full alpha it cut a
        // crisp white line across the sea at the foot of every splash. Fading
        // the bottom eighth hands the join to the foam wash underneath, which
        // has no edge at all.
        "  a *= smoothstep(0.0, 0.14, u);",
        "  if (a < 0.006) discard;",
        "  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));",
        "  #include <tonemapping_fragment>",
        "  #include <encodings_fragment>",
        "}",
      ].join("\n"),
    });

    crownMesh = new THREE.Mesh(crownGeo, crownMat);
    crownMesh.name = "world-water-crown";
    crownMesh.frustumCulled = false;
    crownMesh.renderOrder = 4;
    crownMesh.userData.dynamic = true;
    crownMesh.userData.waterFx = true;
    crownMesh.visible = false;
    CBZ.scene.add(crownMesh);
  }

  function crownCollapse(s) {
    const b = s * CROWN_VERTS;
    for (let k = 0; k < CROWN_VERTS; k++) {
      const v = b + k;
      crownPos[v * 3] = 0; crownPos[v * 3 + 1] = -9999; crownPos[v * 3 + 2] = 0;
      crownA[v] = 0;
    }
  }

  // PUBLIC: throw a sheet of water up out of the surface at (x,z).
  //   r      base radius of the cone, metres
  //   grow   radial growth per second
  //   h      peak height of the rim, metres
  //   ttl    seconds; the sheet rises through ~a third of it and falls back
  //   alpha  peak opacity
  // Returns true if a slot was free. world/water_impact.js's body / vehicle /
  // blast vocabularies are the callers; nothing else needs to know it exists.
  CBZ.waterCrown = function (o) {
    if (!o || !fxOn()) return false;
    buildCrown();
    if (!crownPos) return false;
    // YOU CANNOT SEE A CROWN YOU ARE STANDING INSIDE, and drawing it anyway
    // fills the whole frame with white — the exact failure world/water_under-
    // water.js's preset author recorded ("photographed his own splash sprites
    // from 20 cm away — the frame was foam, not water"), and its
    // camera-breaks-the-surface call lands the eye at the centre of the entry
    // by construction. The droplets still fly (spray on the lens is real); the
    // SHEET stands down whenever the lens is inside its flared footprint and
    // below its rim.
    const cam = CBZ.camera;
    const r0 = Math.max(0.12, +o.r || 0.5);
    const h = Math.max(0.2, +o.h || 1.5);
    if (cam && cam.position) {
      const dx = cam.position.x - (+o.x || 0), dz = cam.position.z - (+o.z || 0);
      const d2 = dx * dx + dz * dz;
      if (d2 > FX_CUT * FX_CUT) return false;     // over the horizon of interest
      const foot = r0 * 1.62 + 0.6;
      if (d2 < foot * foot &&
          cam.position.y < surfY(+o.x || 0, +o.z || 0) + h) return false;
    }
    const cap = crownBudget();
    let slot = -1;
    for (let s = 0; s < cap; s++) if (!crownSlot[s].live) { slot = s; break; }
    if (slot < 0) {
      // A bigger splash outranks a smaller one that is already fading: the
      // megalodon must never lose its sheet to three raindrops' worth of crown.
      let worst = -1, worstScore = 1e9;
      for (let s = 0; s < cap; s++) {
        const c = crownSlot[s];
        const score = c.h * (1 - c.age / c.ttl);
        if (score < worstScore) { worstScore = score; worst = s; }
      }
      if (worst < 0 || worstScore >= h * 0.6) return false;
      slot = worst;
      crownCount--;
    }
    const sl = crownSlot[slot];
    sl.live = true; sl.dirty = true;
    sl.x = +o.x || 0; sl.z = +o.z || 0;
    sl.r0 = r0;
    sl.gr = Number.isFinite(+o.grow) ? +o.grow : sl.r0 * 0.9;
    sl.h = h;
    sl.age = 0; sl.ttl = (+o.ttl > 0) ? +o.ttl : 0.9;
    sl.a0 = o.alpha == null ? 0.85 : +o.alpha;
    sl.seed = fxRand() * 10;
    crownCount++;
    return true;
  };

  function crownTick(dt) {
    if (!crownMesh || !crownPos) return;
    const cap = crownBudget();
    let any = false, touched = false;
    for (let s = 0; s < crownSlot.length; s++) {
      const sl = crownSlot[s];
      if (s >= cap || !sl.live) {
        if (sl.live) { sl.live = false; crownCount--; }
        if (sl.dirty) { crownCollapse(s); sl.dirty = false; touched = true; }
        continue;
      }
      sl.age += dt;
      const t = sl.age / sl.ttl;
      if (t >= 1) { sl.live = false; crownCount--; crownCollapse(s); sl.dirty = false; touched = true; continue; }
      const r = sl.r0 + sl.gr * sl.age;
      // UP FAST, DOWN SLOW. sin(pi * t^0.62) peaks around a third of the life
      // and returns to zero at the end, which is the beat of a real column:
      // the water is thrown, it hangs, it comes back.
      const hh = sl.h * Math.sin(Math.PI * Math.pow(t, 0.62));
      const fade = Math.min(1, t * 14) * (1 - t * t);
      const b = s * CROWN_VERTS;
      // one plane fit per sheet, for the same reason the foam does it
      const cy0 = surfY(sl.x, sl.z);
      const gx = (surfY(sl.x + 2, sl.z) - cy0) * 0.5;
      const gz = (surfY(sl.x, sl.z + 2) - cy0) * 0.5;
      for (let k = 0; k <= CROWN_SEG; k++) {
        const ang = (k / CROWN_SEG) * Math.PI * 2;
        const cs = Math.cos(ang), sn = Math.sin(ang);
        const by = cy0 + Math.max(-1.2, Math.min(1.2, gx * cs * r + gz * sn * r));
        // A RAGGED RIM. Water does not come up to one height all the way round
        // — the first cut did, and a constant-height cone is exactly what read
        // as a tumbler. Two harmonics of the angle, phased off the slot's own
        // seed, so no two sheets in flight have the same profile and none of
        // them has a flat top. (Cheap: it is the same two sines per vertex ring
        // the swell table already costs.)
        const wob = Math.max(0.34, 0.70 + 0.30 * Math.sin(ang * 3 + sl.seed * 6.1) +
          0.18 * Math.sin(ang * 7 - sl.seed * 3.3));
        const hAng = hh * wob;
        for (let j = 0; j < CROWN_RINGS; j++) {
          const fj = j / (CROWN_RINGS - 1);
          const rr = r * (1 + 1.05 * fj * fj);          // flares HARD outward
          const v = b + j * (CROWN_SEG + 1) + k;
          crownPos[v * 3] = sl.x + cs * rr;
          crownPos[v * 3 + 1] = by + 0.05 + hAng * Math.pow(fj, 0.78);
          crownPos[v * 3 + 2] = sl.z + sn * rr;
          crownA[v] = sl.a0 * fade * (1 - 0.42 * fj);
          crownSeed[v] = sl.seed;
        }
      }
      sl.dirty = true;
      touched = true;
      any = true;
    }
    crownMesh.visible = any;
    if (touched) {
      crownGeo.attributes.position.needsUpdate = true;
      crownGeo.attributes.aA.needsUpdate = true;
      crownGeo.attributes.aSeed.needsUpdate = true;
    }
    if (any) crownMat.uniforms.uTime.value = CBZ.waterClock ? CBZ.waterClock() : 0;
  }

  function crownClearAll() {
    if (!crownPos) return;
    for (let s = 0; s < crownSlot.length; s++) { crownSlot[s].live = false; crownSlot[s].dirty = false; crownCollapse(s); }
    crownCount = 0;
    if (crownMesh) crownMesh.visible = false;
  }

  // ---- the one builder every path calls ------------------------------------
  // NOT LATCHED on failure: a call before CBZ.scene exists must be a no-op that
  // retries, never a permanent self-disable. (The old build() latched `built`
  // even when it bailed, so one early caller could orphan the whole system.)
  function build() {
    if (!fxOn()) return;
    buildPoints();
    buildSurf();
    buildCrown();
  }

  // ---- THE DISPATCHER ------------------------------------------------------
  // `ride` is the RENDERING decision now, and it is the only one. Everything on
  // the surface is geometry in the water plane; everything in the air is a
  // billboard, which is the one thing a billboard is honest about.
  function spawn(x, y, z, vx, vy, vz, size, growPerSec, ttl, kind, rideSurface, alpha, dragV, bear, arcHalf) {
    if (!fxOn()) return false;
    if (rideSurface || kind === KIND_RING) {
      const ring = kind === KIND_RING;
      return spawnSurf(x, z, size, growPerSec, ttl,
        alpha == null ? 1 : alpha,
        ring ? (arcHalf > 0 ? 2 : 1) : 0,
        vx, vz, dragV, bear, arcHalf);
    }
    return spawnDrop(x, y, z, vx, vy, vz, size, growPerSec, ttl, alpha);
  }

  // ============================================================
  //  THE PUBLIC POOL PRIMITIVE — one particle, fully specified.
  // ============================================================
  // world/water_impact.js builds every impact vocabulary (bullet spurt, body
  // crown + rebound jet, depth-charge dome / column / falling spray) out of
  // THIS call. Fields (all optional except x/y/z):
  //   x,y,z      spawn point (world)
  //   vx,vy,vz   initial velocity; airborne drops are ballistic, foam drifts
  //   size       start DIAMETER (world metres)
  //   grow       diameter change per second (rings expand, droplets shrink)
  //   ttl        lifetime in seconds
  //   ring       true -> a surface crest ring; false -> a droplet or a wash
  //   ride       true -> SURFACE geometry riding the live swell
  //              false -> an AIRBORNE billboard droplet
  //   alpha      spawn opacity
  //   drag       per-second velocity retention for surface foam (1 = none)
  //   bear,arc   ring only: draw a CREST over `arc` radians either side of the
  //              bearing `bear` instead of a whole circle, feathered at both
  //              ends. A Kelvin bow wave is an arc; a collapse ring is not.
  // Returns true if a slot was available. Never throws, never allocates.
  CBZ.waterEmit = function (o) {
    if (!o || !fxOn()) return false;
    build();
    return spawn(+o.x || 0, +o.y || 0, +o.z || 0,
      +o.vx || 0, +o.vy || 0, +o.vz || 0,
      o.size > 0 ? +o.size : 0.14,
      Number.isFinite(o.grow) ? +o.grow : 0,
      o.ttl > 0 ? +o.ttl : 0.6,
      o.ring ? KIND_RING : KIND_DROP,
      !!o.ride,
      o.alpha == null ? 1 : +o.alpha,
      Number.isFinite(o.drag) ? +o.drag : RIDE_DRAG,
      +o.bear || 0,
      o.arc > 0 ? +o.arc : 0);
  };

  // Airborne slots still free this frame. Impact vocabularies size their bursts
  // against this so a depth charge borrows from the SAME tier-scaled budget the
  // wakes and rain live in instead of starving them.
  // Free SURFACE slots. The rain gate asks this up to 46 times a second, so it
  // must not be CBZ.waterFxAudit() — that allocates an object per raindrop.
  CBZ.waterFoamFree = function () {
    if (!fxOn()) return 0;
    build();
    if (!surfPos) return 0;
    return Math.max(0, surfBudget() - surfCount);
  };

  CBZ.waterEmitFree = function () {
    if (!fxOn()) return 0;
    build();
    if (!pos) return 0;
    return Math.max(0, budget() - count);
  };

  // PUBLIC (legacy, signature FROZEN — city/swim.js, shark_sim.js,
  // wildlife_tame.js, wildlife_orca.js, marine_frenzy.js, marine_predation.js
  // and world/water_underwater.js are the callers): a body hitting (or leaving)
  // the water. `strength` scales the whole event.
  //
  // THE RANGE IS 0.15..9, NOT 0.15..2.5. The old clamp was authored when the
  // only caller was a swimmer stepping off a quay, and it silently flattened
  // every big caller written since: shark_sim.js asks for 4.6 on a breach,
  // wildlife_tame.js asks for up to 9 on a ridden megalodon's reentry, and both
  // were being served a 2.5 — the same splash a person makes. Mass now scales
  // with the SQUARE of the dial, so the dial is a size and the momentum curve
  // in water_impact.js does the rest: 1 is a person, 4 is a car off a bridge,
  // 9 is twenty tonnes of shark coming down.
  CBZ.waterSplashAt = function (x, y, z, strength) {
    if (!fxOn()) return;
    const s = Math.max(0.15, Math.min(9, +strength || 1));
    if (CBZ.waterHit) {
      try {
        if (CBZ.waterHit(x, y, z, { kind: "body", mass: 78 * s * s, speed: 3 + s * 2.4 })) return;
      } catch (e) {}
    }
    // Fallback for when the bus is absent (file not loaded) or the point is not
    // over water: the same shape, authored inline.
    build();
    if (!pos) return;
    const sy = surfY(x, z);
    const n = Math.min(64, Math.round(7 + s * 7));
    for (let i = 0; i < n; i++) {
      const a = fxRand() * Math.PI * 2;
      const r = 0.25 + fxRand() * 0.7 * s;
      spawnDrop(x + Math.cos(a) * r * 0.4, sy + 0.05, z + Math.sin(a) * r * 0.4,
        Math.cos(a) * r * 1.7, 2.2 + fxRand() * 2.6 * s, Math.sin(a) * r * 1.7,
        0.14 + fxRand() * 0.16 * s, -0.02, 0.5 + fxRand() * 0.5, 0.95);
    }
    CBZ.waterCrown({ x: x, z: z, r: 0.30 + s * 0.42, grow: 0.8 + s * 0.9, h: 0.9 + s * 1.5, ttl: 0.55 + s * 0.13, alpha: 0.8 });
    spawnSurf(x, z, 0.9 * s, 6.4 * s, 1.2, 0.85, 1, 0, 0, RIDE_DRAG);
  };

  // PUBLIC: a persistent ripple/foam ring, e.g. a swimmer's stroke wash.
  CBZ.waterRippleAt = function (x, z, size, ttl) {
    if (!fxOn()) return;
    build();
    const d = size > 0 ? size : 0.35;
    spawnSurf(x, z, d, d * 1.7, ttl > 0 ? ttl : 1.1, 0.7, 1, 0, 0, RIDE_DRAG);
  };


  // ============================================================
  //  THE TRAILING RIBBON — the persistent stern wake, one draw call
  // ============================================================
  // A trail-mesh strip, NOT a second particle system. It exists because the
  // pool structurally cannot hold a 10-second wake (640 slots shared with
  // rain, splashes and every impact vocabulary), and because taking the trail
  // off the pool is what leaves room for the four spray components.
  const RIB_PTS = 96;              // history points per ribbon (~5-15s of wake)
  const RIB_SLOTS = 6;             // hard cap; the live count is qScale'd
  const RIB_STRIDE = 9;            // x, z, dirX, dirZ, age, halfW, spread, a0, arc
  const RIB_TAU = 3.6;             // alpha = exp(-age/TAU)
  const RIB_MAX_AGE = 10.0;        // seconds before a point is retired
  const RIB_UV = 6.0;              // metres of arc per V tile
  const RIB_ARC_WRAP = RIB_UV * 1024;   // an exact tile multiple: wrapping the
                                        // arc accumulator cannot show a seam

  let ribMesh = null, ribGeo = null, ribMat = null;
  let ribPos = null, ribUv = null, ribA = null;
  const ribSlot = [];
  let ribBuilt = false;

  function ribbonsOn() {
    return CFG.WATER_WAKE_FX !== false && CFG.WATER_V2 !== false &&
      CFG.WATER_WAKE_RIBBON !== false && !!CBZ.waterRippleTexture;
  }
  function ribBudget() {
    const n = CBZ.qScale ? CBZ.qScale(0, RIB_SLOTS) : 4;
    return Math.max(0, Math.min(RIB_SLOTS, n | 0));
  }

  function ribReset(sl, obj) {
    sl.ref = obj || null;
    sl.head = 0; sl.n = 0; sl.have = false; sl.arc = 0; sl.seen = 0;
    sl.dirX = 0; sl.dirZ = 1; sl.lx = 0; sl.lz = 0;
    sl.camD = 1e9; sl.dirty = true;
  }

  function ribBuild() {
    if (ribBuilt) return;
    // NOT latched until it actually succeeds: a first call before CBZ.scene
    // exists must be a no-op that retries, never a permanent self-disable.
    if (typeof document === "undefined" || !CBZ.scene || !CBZ.waterRippleTexture) return;
    ribBuilt = true;

    for (let s = 0; s < RIB_SLOTS; s++) {
      const sl = { buf: new Float32Array(RIB_PTS * RIB_STRIDE) };
      ribReset(sl, null);
      ribSlot.push(sl);
    }

    const V = RIB_SLOTS * RIB_PTS * 2;          // 1152 — comfortably Uint16
    ribPos = new Float32Array(V * 3);
    ribUv = new Float32Array(V * 2);
    ribA = new Float32Array(V);

    // The index buffer is authored ONCE and never rebuilt: every slot owns a
    // fixed contiguous vertex region and a fixed strip of triangles over it.
    const segs = RIB_SLOTS * (RIB_PTS - 1);
    const idx = V > 65535 ? new Uint32Array(segs * 6) : new Uint16Array(segs * 6);
    let w = 0;
    for (let s = 0; s < RIB_SLOTS; s++) {
      const b = s * RIB_PTS * 2;
      for (let k = 0; k < RIB_PTS - 1; k++) {
        const a0 = b + k * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
        idx[w++] = a0; idx[w++] = b0; idx[w++] = a1;
        idx[w++] = a1; idx[w++] = b0; idx[w++] = b1;
      }
    }

    ribGeo = new THREE.BufferGeometry();
    ribGeo.setAttribute("position", new THREE.BufferAttribute(ribPos, 3).setUsage(THREE.DynamicDrawUsage));
    ribGeo.setAttribute("uv", new THREE.BufferAttribute(ribUv, 2).setUsage(THREE.DynamicDrawUsage));
    ribGeo.setAttribute("aA", new THREE.BufferAttribute(ribA, 1).setUsage(THREE.DynamicDrawUsage));
    ribGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    ribGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

    ribMat = new THREE.ShaderMaterial({
      name: "CBZ Wake Ribbon",
      uniforms: {
        // NO new texture: the sea's own tiling ripple map is already a
        // seamless high-frequency field, and cbzSurf() in water_spec.js
        // already uses it as a noise lookup to break its foam bands. Reuse it
        // for the churn here so there is one water noise source, not two.
        uMap: { value: CBZ.waterRippleTexture() },
        uColor: { value: new THREE.Color(0xdfeef1) },
        uScroll: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      vertexShader: [
        "attribute float aA;",
        "varying float vA;",
        "varying vec2 vRUv;",
        "void main() {",
        "  vA = aA;",
        "  vRUv = uv;",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform sampler2D uMap;",
        "uniform vec3 uColor;",
        "uniform float uScroll;",
        "varying float vA;",
        "varying vec2 vRUv;",
        "void main() {",
        "  if (vA < 0.004) discard;",
        // two decorrelated lookups at different scales/rates = churn, not a
        // repeating pattern sliding along the trail
        "  float n1 = texture2D(uMap, vec2(vRUv.x * 0.85 + 0.07, vRUv.y + uScroll)).r;",
        "  float n2 = texture2D(uMap, vec2(vRUv.x * 0.45 + 0.50, vRUv.y * 0.37 - uScroll * 0.55)).g;",
        "  float churn = clamp(0.46 + (n1 - 0.5) * 1.9 + (n2 - 0.5) * 1.1, 0.0, 1.0);",
        // cross-wake profile: churned and bright down the middle, feathered at
        // the rails. (GLSL ES 1.0 leaves a reversed-edge smoothstep formally
        // undefined, so it is written edge0 < edge1 and inverted by hand — the
        // same rule water_spec.js's shore functions follow.)
        "  float u = abs(vRUv.x * 2.0 - 1.0);",
        "  float prof = 1.0 - smoothstep(0.12, 1.0, u);",
        "  float a = vA * churn * prof;",
        "  if (a < 0.004) discard;",
        "  gl_FragColor = vec4(uColor, a);",
        "  #include <tonemapping_fragment>",
        "  #include <encodings_fragment>",
        "}",
      ].join("\n"),
    });

    ribMesh = new THREE.Mesh(ribGeo, ribMat);
    ribMesh.name = "world-water-wake-ribbon";
    ribMesh.frustumCulled = false;
    ribMesh.renderOrder = 3;            // under the particles (4), over the sea
    ribMesh.userData.dynamic = true;    // batch + farcull exempt
    ribMesh.userData.waterFx = true;
    ribMesh.visible = false;
    CBZ.scene.add(ribMesh);
  }

  // Park a whole slot's vertex region on a single point: every triangle in it
  // becomes zero-area, so it is rasterised into exactly nothing.
  function ribCollapse(s) {
    const base = s * RIB_PTS * 2;
    for (let k = 0; k < RIB_PTS * 2; k++) {
      const v = base + k;
      ribPos[v * 3] = 0; ribPos[v * 3 + 1] = -9999; ribPos[v * 3 + 2] = 0;
      ribA[v] = 0;
    }
  }

  function ribClearAll() {
    if (!ribPos) return;
    for (let s = 0; s < ribSlot.length; s++) { ribReset(ribSlot[s], null); ribCollapse(s); }
    if (ribMesh) ribMesh.visible = false;
  }

  // A slot for this object: its own if it has one, else an idle slot, else
  // steal from a ribbon whose owner is much farther from the camera.
  function ribClaim(obj, camD) {
    const cap = ribBudget();
    if (cap <= 0) return null;
    for (let s = 0; s < cap; s++) if (ribSlot[s].ref === obj) return ribSlot[s];
    // only reuse a slot that has finished fading — splicing a new boat's trail
    // onto an old one's tail is the one artefact worth an extra check
    for (let s = 0; s < cap; s++) {
      const sl = ribSlot[s];
      if (!sl.ref && sl.n === 0) { ribReset(sl, obj); return sl; }
    }
    let best = -1, bestD = camD * 1.35;
    for (let s = 0; s < cap; s++) {
      const sl = ribSlot[s];
      if (sl.camD > bestD) { bestD = sl.camD; best = s; }
    }
    if (best < 0) return null;
    ribReset(ribSlot[best], obj);
    ribCollapse(best);
    return ribSlot[best];
  }

  function ribPush(sl, st) {
    const b = sl.buf, o = sl.head * RIB_STRIDE;
    b[o] = st.sx; b[o + 1] = st.sz;
    b[o + 2] = sl.dirX; b[o + 3] = sl.dirZ;
    b[o + 4] = 0;
    // curvature shrinks BOTH the birth width and the spread rate, so a hard
    // turn lays down a narrow ribbon that cannot fold over itself visibly
    b[o + 5] = (st.beam * 0.42 + 0.10) * (0.45 + 0.55 * st.curvK);
    b[o + 6] = (0.40 + st.planing * 0.85) * st.curvK;
    b[o + 7] = (0.26 + 0.40 * Math.min(1, st.spd / st.planeMs) + st.planing * 0.18) * st.dg;
    b[o + 8] = sl.arc;
    sl.head = (sl.head + 1) % RIB_PTS;
    if (sl.n < RIB_PTS) sl.n++;
  }

  // Called from waterWakeFor: smooth the emission heading, then push a vertex
  // pair only once the stern has actually moved far enough (Unity's Min Vertex
  // Distance pattern — it is what keeps a slow or stopped boat from spamming
  // coincident points and blowing the ring buffer on nothing).
  function ribTrack(obj, st, dt) {
    if (!ribbonsOn() || st.kind !== "boat") return;
    ribBuild();
    if (!ribPos) return;
    const sl = ribClaim(obj, st.camD);
    if (!sl) return;
    sl.ref = obj; sl.seen = 0; sl.camD = st.camD; sl.dirty = true;

    // LOW-PASS the heading before the perpendicular is taken: the single most
    // effective mitigation for ribbon self-intersection on hard turns.
    const k = 1 - Math.exp(-dt * 5.5);
    let dx = sl.dirX + (st.fx - sl.dirX) * k;
    let dz = sl.dirZ + (st.fz - sl.dirZ) * k;
    const dl = Math.sqrt(dx * dx + dz * dz);
    if (dl > 1e-5) { sl.dirX = dx / dl; sl.dirZ = dz / dl; }
    // how far the smoothed direction lags the true one == local curvature
    const dot = sl.dirX * st.fx + sl.dirZ * st.fz;
    st.curvK = 0.30 + 0.70 * clamp01((dot - 0.86) / 0.14);

    if (!sl.have) {
      sl.have = true; sl.lx = st.sx; sl.lz = st.sz;
      sl.dirX = st.fx; sl.dirZ = st.fz; st.curvK = 1;
      ribPush(sl, st);
      return;
    }
    const mx = st.sx - sl.lx, mz = st.sz - sl.lz;
    const d = Math.sqrt(mx * mx + mz * mz);
    // step grows with speed so a 20 m/s hull still gets ~11s of wake out of 96
    // points while a 4 m/s hull gets ~20s, and neither ever emits twice in a
    // metre.
    const step = Math.min(3.4, 0.45 + st.spd * 0.10) *
      Math.max(0.7, Math.min(2.4, st.loa / 6.2));
    if (d < step) return;
    sl.arc += d;
    if (sl.arc > RIB_ARC_WRAP) sl.arc -= RIB_ARC_WRAP;
    sl.lx = st.sx; sl.lz = st.sz;
    ribPush(sl, st);
  }

  function ribWriteSlot(s, sl, dt) {
    const b = sl.buf;
    let n = sl.n;
    let start = (sl.head - n + RIB_PTS * 4) % RIB_PTS;
    for (let k = 0; k < n; k++) b[((start + k) % RIB_PTS) * RIB_STRIDE + 4] += dt;
    while (n > 0 && b[start * RIB_STRIDE + 4] >= RIB_MAX_AGE) { start = (start + 1) % RIB_PTS; n--; }
    sl.n = n;
    if (n < 2) { ribCollapse(s); sl.dirty = n > 0; return false; }

    const base = s * RIB_PTS * 2;
    let lx = 0, ly = -9999, lz = 0;
    for (let k = 0; k < n; k++) {
      const o = ((start + k) % RIB_PTS) * RIB_STRIDE;
      const px = b[o], pz = b[o + 1], dx = b[o + 2], dz = b[o + 3];
      const age = b[o + 4], hw = b[o + 5];
      // turbulent wakes spread as sqrt(t) and then stop — the 19.47deg
      // divergence belongs to the Kelvin RINGS, not to the churned trail.
      let half = hw + Math.sqrt(age) * b[o + 6];
      const cap = hw * 5.0;
      if (half > cap) half = cap;
      let a = b[o + 7] * Math.exp(-age / RIB_TAU);
      if (age < 0.14) a *= age * 7.0;
      const rx = dz, rz = -dx;
      const ax = px - rx * half, az = pz - rz * half;
      const bx = px + rx * half, bz = pz + rz * half;
      const v0 = base + k * 2, v1 = v0 + 1;
      // RIDE the live swell, exactly as the foam rings do
      ribPos[v0 * 3] = ax; ribPos[v0 * 3 + 1] = surfY(ax, az) + 0.05; ribPos[v0 * 3 + 2] = az;
      ribPos[v1 * 3] = bx; ribPos[v1 * 3 + 1] = surfY(bx, bz) + 0.05; ribPos[v1 * 3 + 2] = bz;
      const vv = b[o + 8] / RIB_UV;
      ribUv[v0 * 2] = 0; ribUv[v0 * 2 + 1] = vv;
      ribUv[v1 * 2] = 1; ribUv[v1 * 2 + 1] = vv;
      ribA[v0] = a; ribA[v1] = a;
      lx = ribPos[v1 * 3]; ly = ribPos[v1 * 3 + 1]; lz = ribPos[v1 * 3 + 2];
    }
    for (let k = n; k < RIB_PTS; k++) {
      const v0 = base + k * 2, v1 = v0 + 1;
      ribPos[v0 * 3] = lx; ribPos[v0 * 3 + 1] = ly; ribPos[v0 * 3 + 2] = lz;
      ribPos[v1 * 3] = lx; ribPos[v1 * 3 + 1] = ly; ribPos[v1 * 3 + 2] = lz;
      ribA[v0] = 0; ribA[v1] = 0;
    }
    sl.dirty = true;
    return true;
  }

  function ribTick(dt) {
    if (!ribbonsOn()) { if (ribMesh) ribMesh.visible = false; return; }
    ribBuild();
    if (!ribMesh || !ribPos) return;
    const cap = ribBudget();
    let any = false, touched = false;
    for (let s = 0; s < ribSlot.length; s++) {
      const sl = ribSlot[s];
      if (s >= cap) {
        if (sl.n || sl.ref || sl.dirty) { ribReset(sl, null); ribCollapse(s); sl.dirty = false; touched = true; }
        continue;
      }
      if (sl.ref) { sl.seen += dt; if (sl.seen > 0.75) sl.ref = null; }
      if (sl.n <= 0) {
        if (sl.dirty) { ribCollapse(s); sl.dirty = false; touched = true; }
        continue;
      }
      touched = true;
      if (ribWriteSlot(s, sl, dt)) any = true;
    }
    ribMesh.visible = any;
    // Only re-upload when something actually moved: a harbour with no boats
    // under way must not push 28KB of unchanged vertices every frame.
    if (touched) {
      ribGeo.attributes.position.needsUpdate = true;
      ribGeo.attributes.uv.needsUpdate = true;
      ribGeo.attributes.aA.needsUpdate = true;
    }
    if (any) ribMat.uniforms.uScroll.value = (CBZ.waterClock ? CBZ.waterClock() : 0) * 0.035;
  }

  // ============================================================
  //  CBZ.waterWakeFor — the one hook, and the four components
  // ============================================================
  function fin(v) { return Number.isFinite(v) ? +v : null; }
  // first finite positive of the arguments, else the last one
  function pickPos(a, b, c, d) {
    if (a > 0 && Number.isFinite(a)) return +a;
    if (b > 0 && Number.isFinite(b)) return +b;
    if (c > 0 && Number.isFinite(c)) return +c;
    return +d;
  }

  // The displacement speed limit, v_hull = sqrt(L*g/2pi). A hull essentially
  // cannot exceed it without climbing onto the plane, so it is the honest
  // scale for "how fast is fast" for ANY length — which is what makes the
  // derived planing fallback below give a 4.5m RIB an instant plane and a 34m
  // yacht (top 16kn) a permanent zero without a table.
  function hullSpeed(loa) { return Math.sqrt(Math.max(1, loa) * 9.81 / 6.2831853); }

  const MIN_WAKE_SPD = 0.35;       // m/s below which nothing is shed
  const NEAR_FULL = 70;            // full emission rate inside this radius
  const FAR_CUT = 320;             // nothing at all beyond it

  const _st = {
    x: 0, z: 0, sx: 0, sz: 0, h: 0, fx: 0, fz: 1, rx: 1, rz: 0,
    spd: 0, vSign: 0, planing: 0, steer: 0, trim: 0, churn: 0,
    loa: 6.2, beam: 2.1, scale: 1, planeMs: 6, kind: "boat",
    camD: 0, dg: 1, curvK: 1,
  };

  function frameStamp() {
    const n = CBZ.now;
    return Number.isFinite(n) ? n : frameSeq;
  }
  let frameSeq = 0;

  // How full the pool already is. Components emit in priority order, so under
  // load a superyacht plus three RIBs lose the rooster tail before they lose
  // the bow wave, and the rain and splash budget is never starved.
  // ...measured across BOTH pools, because a wake component spends whichever
  // one its `ride` flag routes it to and the fuller of the two is the one that
  // is about to refuse. Taking only the droplet count here let a harbour full
  // of boats fill the foam mesh and keep asking for more rings.
  function room(frac) {
    const b = Math.max(1, budget()), sb = Math.max(1, surfBudget());
    return Math.max(count / b, surfCount / sb) < frac;
  }

  function resolve(obj, opts, dt) {
    const st = _st;
    const p = (obj && (obj.pos || obj.position)) || null;
    const ox = opts ? fin(opts.x) : null, oz = opts ? fin(opts.z) : null;
    st.x = ox != null ? ox : (p ? +p.x : NaN);
    st.z = oz != null ? oz : (p ? +p.z : NaN);
    if (!Number.isFinite(st.x) || !Number.isFinite(st.z)) return null;

    const hs = (obj && obj._hullSpec) || null;
    const dims = (obj && obj.dims) || null;
    st.kind = (opts && opts.kind) || "boat";
    st.loa = pickPos(opts && opts.loa, hs && hs.loa, dims && dims.length, 6.2);
    st.beam = pickPos(opts && opts.beam, hs && hs.beam, dims && dims.width, 2.1);
    // wakeScale moves the emission RATE only (particle SIZE already tracks the
    // beam). Clamped, because it arrives from another package's hull table and
    // a stray 8 there must not be able to empty the shared pool.
    st.scale = Math.max(0.15, Math.min(2.2, pickPos(opts && opts.scale, hs && hs.wakeScale, null, 1)));

    // ---- speed and heading ----
    let vs = opts ? fin(opts.speed) : null;
    if (vs == null) vs = fin(obj && obj.v);
    const vx = +(obj && obj.vx) || 0, vz = +(obj && obj.vz) || 0;
    if (vs == null) vs = Math.sqrt(vx * vx + vz * vz);
    st.vSign = vs; st.spd = Math.abs(vs);

    let h = opts ? fin(opts.heading) : null;
    if (h == null) h = fin(obj && obj.heading);
    if (h == null) h = (vx * vx + vz * vz) > 1e-6 ? Math.atan2(vx, vz) : 0;
    st.h = h; st.fx = Math.sin(h); st.fz = Math.cos(h);
    st.rx = st.fz; st.rz = -st.fx;                 // starboard
    st.sx = st.x - st.fx * st.loa * 0.48;          // the transom
    st.sz = st.z - st.fz * st.loa * 0.48;

    // ---- the regime ----
    st.planeMs = pickPos(opts && opts.planeMs, hs && hs.planeMs, null, 1.9 * hullSpeed(st.loa));
    let pl = fin(obj && obj._planing);
    if (pl == null && opts) pl = fin(opts.planing);
    if (pl == null) {
      // Derived fallback for when no helm publishes it. One formula, and the
      // whole ladder falls out of it: RIB 4.5m planes at ~4.0 m/s, the 6.2m
      // runabout at ~4.7, a 14m cruiser at ~7.1, and a 34m yacht would need
      // 11.1 m/s (21.6 kn) — comfortably above the 16 kn such a hull can make,
      // so a yacht NEVER produces chine spray even with nothing published.
      const a = st.planeMs * 0.80, b = st.planeMs * 1.25;
      pl = clamp01((st.spd - a) / Math.max(1e-3, b - a));
      pl = pl * pl * (3 - 2 * pl);
    }
    st.planing = st.vSign < 0 ? 0 : clamp01(pl);   // you cannot plane astern

    let sIn = fin(obj && obj._steerInput);
    if (sIn == null && opts) sIn = fin(opts.steer);
    st.steer = sIn == null ? 0 : Math.max(-1, Math.min(1, sIn));
    const tr = fin(obj && obj._trim);
    st.trim = tr == null ? 0 : tr;

    // ---- throttle: published if the helm has it, recovered if not ----
    let thr = fin(obj && obj._throttle);
    if (thr != null) thr = clamp01(Math.abs(thr));
    else {
      const prev = Number.isFinite(obj._wakePrevV) ? obj._wakePrevV : st.spd;
      const dv = (st.spd - prev) / Math.max(1e-3, dt);
      obj._wakePrevV = st.spd;
      thr = clamp01(dv / 5);
      if (st.vSign < -1.2) thr = Math.max(thr, 0.8);     // astern: full churn
      if (st.spd < 4.5) thr = Math.max(thr, 0.30);       // off the dock
    }
    const sm = Math.min(1, dt * 6);
    obj._wakeThr = (obj._wakeThr == null ? thr : obj._wakeThr + (thr - obj._wakeThr) * sm);
    st.churn = obj._wakeThr;

    // ---- distance gain ----
    const cam = CBZ.camera;
    if (cam) {
      const cx = st.x - cam.position.x, cz = st.z - cam.position.z;
      st.camD = Math.sqrt(cx * cx + cz * cz);
    } else st.camD = 0;
    st.dg = st.camD >= FAR_CUT ? 0
      : (st.camD <= NEAR_FULL ? 1 : 1 - (st.camD - NEAR_FULL) / (FAR_CUT - NEAR_FULL) * 0.82);
    // ...and by the live quality tier, so a low tier THINS the wake instead of
    // emitting a full-fat one and having room() clip it against a fifth of the
    // pool (which would starve the rain and every splash behind it).
    if (st.dg > 0 && CBZ.qScale) st.dg *= CBZ.qScale(0.45, 1);
    st.curvK = 1;
    return st;
  }

  // Per-object fractional emission counters. Allocated once per object, never
  // per frame — the same no-GC-churn rule the pool itself follows.
  function acc(obj) {
    let a = obj._wakeAcc;
    if (!a) a = obj._wakeAcc = { bow: 0, tran: 0, wash: 0, spray: 0, roost: 0 };
    return a;
  }

  // ---- 1. BOW WAVE — the divergent Kelvin V, amplitude ~ v^2 --------------
  function emitBowWave(st, A, dt) {
    if (!room(1.0)) return;
    const vN = Math.min(1.6, st.spd / st.planeMs);
    // bow-up trim lifts the forefoot clear, so the hull makes LESS bow wave
    const trimCut = 1 - Math.min(1, Math.max(0, st.trim) / 0.16) * 0.45;
    const amp = Math.min(1, vN * vN) * trimCut;
    A.bow += (1.1 + 5.2 * vN) * st.scale * st.dg * dt;
    let n = A.bow | 0;
    if (n <= 0) return;
    A.bow -= n;
    if (n > 3) n = 3;
    const bx = st.x + st.fx * st.loa * 0.44, bz = st.z + st.fz * st.loa * 0.44;
    const by = surfY(bx, bz) + 0.045;
    // The whole Kelvin construction: lateral speed = spd*tan(19.47deg), drag 1
    // (undamped), so lateralOffset(age) == age * spd * tan(19.47deg) and the V
    // holds a true 19.47deg half-angle at every speed, for free.
    const vLat = st.spd * TAN_KELVIN;
    const off = st.beam * 0.40 + 0.12;
    for (let k = 0; k < n; k++) {
      for (let s = -1; s <= 1; s += 2) {
        // ...and it is shed as an ARC facing OUTBOARD, not as a full circle.
        // The Kelvin crest is the outboard piece; drawing the inboard half too
        // laid a hoop across the boat's own track and the shed rings then read
        // as a chain of rings on the sea instead of one continuous V.
        spawn(bx + st.rx * off * s, by, bz + st.rz * off * s,
          st.rx * vLat * s, 0, st.rz * vLat * s,
          0.30 + amp * 0.55 + st.beam * 0.10,
          (0.9 + amp * 1.6) * (0.6 + st.beam * 0.18),
          1.5 + amp * 1.4,
          KIND_RING, true, (0.18 + amp * 0.44) * st.dg, 1.0,
          Math.atan2(st.rz * s, st.rx * s), 1.05);
      }
    }
  }

  // ---- 2. TRANSOM WAKE — separated flow off the stern corners -------------
  // (the persistent half of this component is the ribbon; these are the
  // near-field boils the ribbon is too smooth to carry.)
  function emitTransom(st, A, dt) {
    if (!room(0.88)) return;
    const vN = Math.min(1, st.spd / st.planeMs);
    A.tran += (1.6 + 3.4 * vN + st.churn * 2.2) * st.scale * st.dg * dt;
    let n = A.tran | 0;
    if (n <= 0) return;
    A.tran -= n;
    if (n > 2) n = 2;
    const sy = surfY(st.sx, st.sz) + 0.04;
    const off = st.beam * 0.44;
    const al = (0.22 + st.planing * 0.28 + st.churn * 0.16) * st.dg;
    for (let k = 0; k < n; k++) {
      for (let s = -1; s <= 1; s += 2) {
        spawn(st.sx + st.rx * off * s, sy, st.sz + st.rz * off * s,
          st.rx * (0.5 + st.planing * 0.9) * s - st.fx * 0.25, 0,
          st.rz * (0.5 + st.planing * 0.9) * s - st.fz * 0.25,
          0.26 + st.beam * 0.16, 0.70 + st.beam * 0.22, 1.1 + st.planing * 0.7,
          KIND_RING, true, al, 0.30);
      }
    }
  }

  // ---- 3. PROP WASH — a narrow jet, ANGLED WITH THE STEERING --------------
  // The helm vectors thrust, so the reaction that swings the bow is a jet
  // thrown to the OUTSIDE of the turn. Wiring the wash to _steerInput is free
  // coherence: crank the wheel and the churn visibly swings across the
  // transom, because it is reading the same number the physics is.
  function emitPropWash(st, A, dt) {
    if (!room(0.95)) return;
    A.wash += (2.4 + 9.0 * st.churn) * st.scale * st.dg * dt;
    let n = A.wash | 0;
    if (n <= 0) return;
    A.wash -= n;
    if (n > 3) n = 3;
    const wk = st.steer * 0.62;                     // ~32deg at full lock
    let wx = -st.fx + st.rx * wk, wz = -st.fz + st.rz * wk;
    const wl = Math.sqrt(wx * wx + wz * wz) || 1;
    wx /= wl; wz /= wl;
    const px = st.x - st.fx * st.loa * 0.50, pz = st.z - st.fz * st.loa * 0.50;
    const py = surfY(px, pz) + 0.04;
    const jet = 1.4 + st.churn * 5.0 + st.spd * 0.10;
    for (let k = 0; k < n; k++) {
      const j = (k - (n - 1) * 0.5) * 0.22;
      spawn(px + st.rx * j, py, pz + st.rz * j,
        wx * jet, 0, wz * jet,
        0.22 + st.churn * 0.55 + st.beam * 0.07,
        0.55 + st.churn * 0.90, 0.8 + st.churn * 0.90,
        KIND_DROP, true, (0.13 + st.churn * 0.34) * st.dg, 0.30);
    }
    // hard churn throws loose white water — along the SAME jet, so reverse and
    // hard-over both look like the thrust is actually going somewhere
    if (st.churn > 0.55 && room(0.80) && fxRand() < st.churn * 0.55 * st.dg) {
      const a = fxRand() * Math.PI * 2;
      spawn(px, py + 0.06, pz,
        wx * jet * 0.5 + Math.cos(a) * 0.7,
        0.9 + fxRand() * 1.3 * st.churn,
        wz * jet * 0.5 + Math.sin(a) * 0.7,
        0.09 + fxRand() * 0.09, -0.03, 0.34, KIND_DROP, false, 0.72);
    }
  }

  // ---- 4a. CHINE SPRAY + ROOSTER TAIL — PLANING ONLY ----------------------
  // The single best "this hull is on the plane" signal, and it costs nothing
  // now that the sim publishes the flag. Fast, near-horizontal, AIRBORNE
  // (ride = false, so it is ballistic and gravity brings it down): a different
  // KIND of spray from the displacement case below, not a louder one.
  function emitPlaningSpray(st, A, dt) {
    const pl = st.planing;
    if (room(0.80)) {
      A.spray += (4 + 18 * pl) * Math.min(1.4, st.spd / st.planeMs) * st.scale * st.dg * dt;
      let n = A.spray | 0;
      A.spray -= n;
      if (n > 6) n = 6;
      const cx = st.x + st.fx * st.loa * 0.16, cz = st.z + st.fz * st.loa * 0.16;
      const cy = surfY(cx, cz) + 0.06 + Math.max(0, st.trim) * st.loa * 0.30;
      const off = st.beam * 0.50;
      const lat = 2.4 + 5.4 * pl + st.spd * 0.10;
      for (let k = 0; k < n; k++) {
        const s = (k & 1) ? 1 : -1;
        const j = (fxRand() - 0.5) * st.loa * 0.30;
        // A planing powerboat heels INTO its turn, so the INSIDE chine is the
        // loaded one and throws the harder sheet. `s === sign(steer)` is that
        // side, and it costs one multiply.
        const bias = 1 + 0.45 * st.steer * s;
        // The sheet a planing hull throws is BEAM-SIZED, not bead-sized — a
        // 2.1 m runabout at 14 m/s puts up a wall of white a metre high. The
        // old fixed 0.08-0.18 m drew a RIB's chine spray at the same grain as
        // a raindrop and it disappeared past twenty metres.
        spawn(cx + st.fx * j + st.rx * off * s, cy, cz + st.fz * j + st.rz * off * s,
          st.rx * lat * bias * s + st.fx * st.spd * 0.30,
          0.9 + pl * 2.0 + fxRand() * 0.9,
          st.rz * lat * bias * s + st.fz * st.spd * 0.30,
          (0.11 + fxRand() * 0.13) * (0.7 + st.beam * 0.24 + pl * 0.5), -0.04,
          0.34 + pl * 0.34,
          KIND_DROP, false, (0.50 + pl * 0.42) * st.dg);
      }
    }
    // the rooster tail is genuinely ballistic — velocity plus gravity, short
    // lived. Ease off the throttle and it collapses back to the calm look
    // because BOTH the rate and the launch speed are tied to planing/speed.
    if (pl > 0.42 && room(0.72)) {
      A.roost += (2.5 + 12 * pl) * st.scale * st.dg * dt;
      let n = A.roost | 0;
      A.roost -= n;
      if (n > 5) n = 5;
      const ty = surfY(st.sx, st.sz) + 0.05;
      const up = 2.2 + pl * 4.6 + st.spd * 0.12;
      for (let k = 0; k < n; k++) {
        const j = (fxRand() - 0.5) * st.beam * 0.9;
        spawn(st.sx + st.rx * j, ty, st.sz + st.rz * j,
          -st.fx * (0.8 + st.spd * 0.10) + st.rx * (fxRand() - 0.5) * 1.5,
          up * (0.75 + fxRand() * 0.5),
          -st.fz * (0.8 + st.spd * 0.10) + st.rz * (fxRand() - 0.5) * 1.5,
          (0.13 + fxRand() * 0.16) * (0.7 + st.beam * 0.22 + pl * 0.45), -0.03,
          0.6 + pl * 0.6,
          KIND_DROP, false, (0.50 + pl * 0.38) * st.dg);
      }
    }
  }

  // ---- 4b. DISPLACEMENT SPRAY — the other kind ----------------------------
  // Sparse, slow droplets sliding off the bow wave that land almost at once
  // and merge into foam. Never airborne, low counts. A yacht only ever gets
  // this, at any throttle.
  function emitDisplacementSpray(st, A, dt) {
    if (!room(0.80)) return;
    const vN = Math.min(1, st.spd / st.planeMs);
    A.spray += (0.5 + 2.6 * vN) * st.scale * st.dg * dt;
    let n = A.spray | 0;
    A.spray -= n;
    if (n <= 0) return;
    if (n > 2) n = 2;
    const bx = st.x + st.fx * st.loa * 0.40, bz = st.z + st.fz * st.loa * 0.40;
    const by = surfY(bx, bz) + 0.05;
    const off = st.beam * 0.46;
    for (let k = 0; k < n; k++) {
      const s = (k & 1) ? 1 : -1;
      spawn(bx + st.rx * off * s, by, bz + st.rz * off * s,
        st.rx * (0.5 + vN * 1.0) * s + st.fx * st.spd * 0.16,
        0.35 + vN * 0.55,
        st.rz * (0.5 + vN * 1.0) * s + st.fz * st.spd * 0.16,
        0.07 + fxRand() * 0.07, -0.03, 0.22 + vN * 0.14,
        KIND_DROP, false, (0.30 + vN * 0.22) * st.dg);
    }
  }

  // ============================================================
  //  PUBLIC: the hook. One line to adopt, degrade-safe both ways.
  // ============================================================
  //   CBZ.waterWakeFor(car, dt)                 <- the marine helm
  //   CBZ.waterWakeFor(ref, dt, {x, z, speed,   <- anything without a car
  //                              heading, loa, beam, scale, kind})
  // Returns true iff this call owned the object's wake this frame.
  CBZ.waterWakeFor = function (obj, dt, opts) {
    if (!obj) return false;
    if (CFG.WATER_WAKE_FX === false || CFG.WATER_V2 === false) return false;
    dt = Math.min(0.1, +dt || 0);
    if (!(dt > 0)) return false;
    const g = CBZ.game;
    if (!g || !(CBZ.waterModeOn ? CBZ.waterModeOn() : g.mode === "city")) return false;
    build();
    if (!pos) return false;
    const st = resolve(obj, opts, dt);
    if (!st) return false;
    // Claim the frame even when nothing is drawn, so the sweep below never
    // double-draws a hull the helm already handled.
    obj._wakeStamp = frameStamp();
    if (st.dg <= 0 || st.spd < MIN_WAKE_SPD) return true;
    if (!CBZ.cityWaterAt || !CBZ.cityWaterAt(st.x, st.z)) return true;

    const A = acc(obj);
    // WATER_WAKE_V2 off -> the two components that existed before this pass,
    // through the same code. There is no second implementation to maintain.
    if (CFG.WATER_WAKE_V2 === false) {
      emitBowWave(st, A, dt);
      emitPropWash(st, A, dt);
      return true;
    }
    ribTrack(obj, st, dt);
    emitBowWave(st, A, dt);
    emitTransom(st, A, dt);
    emitPropWash(st, A, dt);
    if (st.planing > 0.12) emitPlaningSpray(st, A, dt);
    else emitDisplacementSpray(st, A, dt);
    return true;
  };

  // Remaining bespoke wake renderers that do NOT go through waterWakeFor.
  // 1 — city/wildlife_shark.js:109-149 draws its own V-of-the-wake quad pair
  //     with a private geometry + material. It is a READ-ONLY file for this
  //     work package; a one-line swap to CBZ.waterWakeFor(shark, dt, {...})
  //     retires it and deletes that geometry/material pair. May only go DOWN.
  CBZ.waterWakeAudit = function () { return 1; };

  // ---- consumers that read the world --------------------------------------
  function isMarine(car) {
    if (!car) return false;
    const feel = car._playerCarFeel;
    if (feel) return !!feel.marine;
    return !!(car.model && car.model.body === "boat");
  }

  let rainAcc = 0, swimAcc = 0, occAcc = 0;

  // CONSUMER 1 — every marine car. A hull whose helm already called the hook
  // this frame is skipped; everything else is driven from measured state, so
  // the wake is identical with or without world/water_helm.js present.
  function emitBoatWakes(dt) {
    const cars = CBZ.cityCars;
    if (!cars || !cars.length) return;
    const sp = frameStamp();
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      if (!car || car.dead || !car.pos || !isMarine(car)) continue;
      if (car._wakeStamp === sp) continue;      // a helm already owned it
      CBZ.waterWakeFor(car, dt);
    }
  }

  // CONSUMER 2 — the swimmer. The stroke RIPPLE keeps its own cadence (a
  // stroke is not a hull), but the wash the body drags behind it is a wake
  // like any other, so it goes through the one vocabulary. A 1.9m "hull" has a
  // 1.7 m/s hull speed, so the derived regime puts a swimmer permanently in
  // displacement mode — sparse, slow, never airborne — with no special case.
  let swimPx = 0, swimPz = 0, swimHave = false;
  const _swimOpt = { kind: "swim", loa: 1.9, beam: 0.55, scale: 0.40, x: 0, z: 0, speed: 0, heading: 0 };
  function emitSwim(dt) {
    if (!CBZ.citySwimming || !CBZ.citySwimming()) { swimAcc = 0; swimHave = false; return; }
    const P = CBZ.player;
    if (!P || !P.pos) return;

    swimAcc += dt;
    if (swimAcc >= 0.30) {
      swimAcc = 0;
      const a = fxRand() * Math.PI * 2, r = 0.35 + fxRand() * 0.4;
      CBZ.waterRippleAt(P.pos.x + Math.cos(a) * r, P.pos.z + Math.sin(a) * r,
        0.30 + fxRand() * 0.2, 1.0);
    }

    if (!swimHave) { swimPx = P.pos.x; swimPz = P.pos.z; swimHave = true; return; }
    const dx = P.pos.x - swimPx, dz = P.pos.z - swimPz;
    swimPx = P.pos.x; swimPz = P.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const spd = d / Math.max(1e-3, dt);
    if (!(spd > 0.30) || spd > 12) return;      // >12 m/s == a teleport, not a swim
    _swimOpt.x = P.pos.x; _swimOpt.z = P.pos.z;
    _swimOpt.speed = Math.min(4, spd);
    _swimOpt.heading = Math.atan2(dx, dz);
    CBZ.waterWakeFor(P, dt, _swimOpt);
  }

  // CONSUMER 3 — everything else in the water that is MOVING. water_float.js
  // already walks the float registry, the peds, the cars and the player once
  // per frame and publishes the result; a corpse riding the swell or a flooded
  // car being carried by the current used to leave the surface untouched. Now
  // they get the same vocabulary at a small scale, for one call.
  const _occOpt = { kind: "drift", loa: 2.2, beam: 0.9, scale: 0.35, x: 0, z: 0, speed: 0, heading: 0 };
  const _occOut = [];
  function emitDriftWakes(dt) {
    if (CFG.WATER_WAKE_DRIFT === false || !CBZ.waterOccupants) return;
    occAcc += dt;
    if (occAcc < 0.10) return;                  // 10 Hz is plenty for drift
    const step = occAcc;
    occAcc = 0;
    let list;
    try { list = CBZ.waterOccupants(_occOut); } catch (e) { return; }
    if (!list || !list.length) return;
    const sp = frameStamp();
    let n = 0;
    for (let i = 0; i < list.length && n < 5; i++) {
      const o = list[i];
      if (!o || !o.ref || !o.moving) continue;
      if (o.kind === "boat" || o.kind === "player") continue;   // own routes above
      const ref = o.ref;
      if (ref._wakeStamp === sp) continue;
      const hx = ref._wakeOx, hz = ref._wakeOz;
      ref._wakeOx = o.x; ref._wakeOz = o.z;
      if (!Number.isFinite(hx)) continue;
      const dx = o.x - hx, dz = o.z - hz;
      const spd = Math.sqrt(dx * dx + dz * dz) / step;
      if (!(spd > 0.35) || spd > 30) continue;
      const car = o.kind === "car";
      _occOpt.x = o.x; _occOpt.z = o.z;
      _occOpt.speed = Math.min(8, spd);
      _occOpt.heading = Math.atan2(dx, dz);
      _occOpt.loa = car ? 4.2 : 1.4;
      _occOpt.beam = car ? 1.8 : 0.6;
      _occOpt.scale = car ? 0.55 : 0.30;
      if (CBZ.waterWakeFor(ref, step, _occOpt)) n++;
    }
  }

  function emitRain(dt) {
    const w = CBZ.weather;
    if (!w || !w.raining) { rainAcc = 0; return; }
    const cam = CBZ.camera;
    if (!cam || !CBZ.cityWaterAt) return;
    const inten = Math.max(0, Math.min(1, +w.intensity || 0));
    const rate = inten * (CBZ.qScale ? CBZ.qScale(8, 46) : 30);   // ripples/sec
    rainAcc += dt * rate;
    let n = rainAcc | 0;
    if (n <= 0) return;
    rainAcc -= n;
    if (n > 12) n = 12;
    for (let i = 0; i < n; i++) {
      const a = fxRand() * Math.PI * 2;
      const r = 3 + Math.sqrt(fxRand()) * 34;
      const x = cam.position.x + Math.cos(a) * r, z = cam.position.z + Math.sin(a) * r;
      if (!CBZ.cityWaterAt(x, z)) continue;
      const sy = surfY(x, z);
      // A raindrop IS a water impact — route it through the one bus (silently:
      // the rain has its own ambient bed and a splash per drop would be noise)
      // so the "drop" vocabulary is authored in exactly one place. Falls back to
      // the inline dimple when the bus is absent.
      if (CBZ.waterHit) {
        if (CBZ.waterHit(x, sy, z, { kind: "drop", quiet: true })) continue;
      }
      spawn(x, sy + 0.02, z, 0, 0, 0, 0.06, 0.62, 0.62, KIND_RING, true, 0.55);
    }
  }

  // Order 60 (CBZ.PRIO.PRESENTATION): after vehicles (<=38.5), buoyancy (38.5)
  // and swim (45.8) have settled every position this reads, and before the HUD.
  function hideAll() {
    if (points) points.visible = false;
    if (surfMesh) surfMesh.visible = false;
    if (crownMesh) crownMesh.visible = false;
    if (ribMesh) ribMesh.visible = false;
  }

  CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.PRESENTATION : 60, function (dt) {
    frameSeq++;
    if (!fxOn()) { hideAll(); return; }
    const g = CBZ.game;
    // The wash, the splash rings and the rain dimples are WATER effects, not
    // city effects: CBZ.waterModeOn() is true in the city AND on the survival /
    // shark-sim island, which is the whole reason a plunge on the island draws
    // anything at all.
    if (!g || !(CBZ.waterModeOn ? CBZ.waterModeOn() : g.mode === "city")) {
      hideAll();
      count = 0;
      surfClearAll();
      crownClearAll();
      ribClearAll();
      return;
    }
    build();
    if (!points || !pos) return;
    if (budget() <= 0) { hideAll(); surfClearAll(); crownClearAll(); ribClearAll(); return; }

    dt = Math.min(0.1, dt || 0);

    emitBoatWakes(dt);
    emitSwim(dt);
    emitDriftWakes(dt);
    emitRain(dt);
    ribTick(dt);
    surfTick(dt);
    crownTick(dt);

    // ---- integrate the AIRBORNE spray ----
    // Ballistic, and it dies the instant it goes back under the live surface —
    // which is what makes a burst read as water thrown and caught rather than
    // as a puff that dissolves in mid-air.
    for (let i = count - 1; i >= 0; i--) {
      life[i] += dt;
      const t = life[i] / maxLife[i];
      if (t >= 1) { killDrop(i); continue; }
      vel[i * 3 + 1] -= 9.2 * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      // the shader reads the LIVE velocity to orient the smear, so a droplet
      // arcs over and its streak turns over with it.
      aVel[i * 3] = vel[i * 3]; aVel[i * 3 + 1] = vel[i * 3 + 1]; aVel[i * 3 + 2] = vel[i * 3 + 2];
      // ONLY A FALLING DROPLET CAN CROSS THE SURFACE DOWNWARD, so only a
      // falling droplet has to pay for the oracle. Exactly equivalent, and it
      // halves the sea queries this loop makes with the pool full.
      const sy = vel[i * 3 + 1] < 0 ? surfY(pos[i * 3], pos[i * 3 + 2]) : -1e9;
      if (pos[i * 3 + 1] < sy) {
        // A drop that lands leaves a mark. Only the bigger ones, and only
        // sometimes, or a megalodon's crown would spend the whole foam pool on
        // its own rain.
        if (aSize[i] > 0.30 && surfCount < surfBudget() * 0.7 && fxRand() < 0.18) {
          spawnSurf(pos[i * 3], pos[i * 3 + 2], aSize[i] * 1.6, aSize[i] * 3.4, 0.55, 0.42, 1, 0, 0, RIDE_DRAG);
        }
        killDrop(i); continue;
      }
      aSize[i] = Math.max(0.02, size0[i] + grow[i] * life[i]);
      aAlpha[i] = alpha0[i] * Math.min(1, (1 - t) * 2.6);
    }

    // ---- publish ----
    points.visible = count > 0;
    geo.setDrawRange(0, count);
    if (count > 0) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
      geo.attributes.aVel.needsUpdate = true;
    }

    // Perspective point-size scale in DEVICE pixels: half the drawing-buffer
    // height over tan(halfFov). Re-read every frame because the quality slider
    // moves the device pixel ratio live. uAspect makes the screen-space
    // velocity angle honest on a non-square canvas — without it every streak
    // lies about its direction by the aspect ratio.
    const cam = CBZ.camera, r = CBZ.renderer;
    if (cam && r && r.domElement) {
      const h = r.domElement.height || 600, w = r.domElement.width || 800;
      mat.uniforms.uPix.value = (h * 0.5) / Math.tan((cam.fov || 62) * 0.5 * Math.PI / 180);
      mat.uniforms.uAspect.value = w / Math.max(1, h);
    }
  });

  CBZ.waterParticleCount = function () { return count; };

  // PROBE: what is actually alive on the water right now, by drawable. A
  // headless pass can read this straight after a CBZ.stepSim burst and know
  // whether an impact drew anything at all — the number that was zero,
  // everywhere, in every mode, before this pass.
  CBZ.waterFxAudit = function () {
    return {
      drops: count,
      dropBudget: budget(),
      foam: surfCount,
      foamBudget: surfBudget(),
      crowns: crownCount,
      built: !!points,
      visible: {
        spray: !!(points && points.visible),
        foam: !!(surfMesh && surfMesh.visible),
        crown: !!(crownMesh && crownMesh.visible),
        ribbon: !!(ribMesh && ribMesh.visible),
      },
    };
  };
})();
