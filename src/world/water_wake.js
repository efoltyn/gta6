/* ============================================================
   src/world/water_wake.js — SPLASHES, WAKES AND RAIN RIPPLES.

   The engine had NO water VFX of any kind. Grepping "splash" across the repo
   turned up explosion splash-damage and one audio cue in city/swim.js — no
   particle, no decal, no foam trail. A boat crossed the harbour leaving the
   surface as undisturbed as a photograph, and a body hitting the water made a
   noise and nothing else.

   WHY THE SPRITES ARE OFF (owner, 2026-08-11: "anything that renders as
   camera facing is slop")
   -------------------------------------------------------------------------
   THE BILLBOARD POOL DESCRIBED BELOW NO LONGER DRAWS. WATER_WAKE_SPRITES
   defaults to false and every path into it is dead. Read the rest of this
   header as the record of what was built and why it was wrong, not as a
   description of what you see in the game.

   The fault is one sentence: a THREE.Points sprite is ALWAYS screen-aligned,
   and surface foam is a thing that LIES IN THE WATER PLANE. Everything this
   pool spawned with ride:true — the Kelvin bow rings, the transom boil, the
   prop wash, the splash collapse rings, the rain dimples — was correctly
   re-seated onto the live swell every frame and then drawn as a flat disc
   facing the camera. You play with your eye 1.5-3 m over the sea, so a ring
   15 m out is seen at about a 6 degree grazing angle: its minor axis should
   project to roughly a tenth of its major axis, a sliver lying on the water.
   The billboard drew it at full height. A perfect upright white circle
   standing on the sea IS a bubble, and that is exactly what the owner saw.
   Close range made it worse — gl_PointSize clamps at 220 px, so a swimmer's
   own collapse ring filled a fifth of the screen with one soft white disc
   (world/water_underwater.js's preset author hit this too and wrote it down:
   "photographed his own splash sprites from 20 cm away — the frame was foam,
   not water"). Nothing broke up the shape either: one flat tint, no noise, no
   rotation (point sprites cannot rotate), depthWrite off, so they stacked as
   identical translucent discs.

   THE PROOF THE ANSWER WAS ALREADY HERE: the RIBBON below is real geometry
   whose every vertex re-reads CBZ.citySeaHeightAt, so it lies IN the surface,
   foreshortens correctly and takes UVs. It is the one part of this file that
   never read as a bubble, and it still runs. If surface foam is ever rebuilt,
   it is rebuilt the ribbon's way — flat quads in the water plane, not sprites.
   The only thing here a billboard was ever honest about is genuinely AIRBORNE
   spray (chine sheet, rooster tail, ballistic droplets), and that is the one
   thing worth reviving if the sea ever looks empty.

   -------------------------------------------------------------------------
   This is one pooled THREE.Points system — ONE draw call, one texture, one
   custom shader — serving four emitters:

     • SPLASHES   — droplets thrown up when something enters the water
                    (city/swim.js's entry, the camera going under, and any
                    caller of CBZ.waterSplashAt).
     • BOAT WAKE  — an expanding foam ring pair off the stern that traces the
                    classic V, plus bow spray once the hull is up on speed.
     • SWIM WASH  — small rings shed by a swimming player, rate tied to stroke.
     • RAIN       — dimples on the surface wherever systems/weather.js reports
                    rain (that system is opt-in, so this is free when dry).

   Rings and droplets share one texture: a 256x128 atlas whose left half is a
   soft droplet and right half a ring, selected per particle by an attribute,
   so both live in the same buffer and the same draw.

   THE POOL IS NOW A PUBLIC PRIMITIVE. world/water_impact.js (the water impact
   bus) composes its own impact vocabularies — the bullet spurt, the body crown
   + rebound jet, the depth-charge dome/column/spray — out of THIS pool via
   CBZ.waterEmit(). There is exactly ONE water particle system in the game and
   this is it; nothing downstream may allocate a second one.

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

   THE RIBBON (world/water_wake.js's only mesh)
   -------------------------------------------
   The persistent trail is a trail-mesh strip, not particles. It is not a
   second particle system: it delivers what the pool structurally CANNOT — a
   10-second wake at zero pool cost — and by taking the trail off the pool it
   leaves the whole tier-scaled particle budget for the four spray components.
     • Vertex PAIRS are emitted at the transom, gated by a MINIMUM DISTANCE
       MOVED (so a slow or stopped boat never spams overlapping points).
     • They live in a PREALLOCATED Float32Array ring buffer with a wrapping
       write index — never a growing JS array, never a per-frame allocation.
     • All slots share ONE geometry, ONE material and ONE draw call; the index
       buffer is built once and never rebuilt. Unused points collapse onto the
       newest vertex, so they cost zero fragments.
     • Every vertex re-reads CBZ.citySeaHeightAt each frame, exactly as the
       foam rings do, so the trail RIDES the swell instead of cutting crests.
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

   Every ring re-reads CBZ.citySeaHeightAt each frame, so foam RIDES the swell
   instead of sitting on a flat plane through the crests — the same oracle the
   hull and the shader use.

   Determinism: this is runtime-only presentation, never world generation, so
   Math.random is explicitly permitted here (see CLAUDE.md). Nothing in this
   file touches gameplay state.

   Budget: the pool is sized by CBZ.qScale, so tier 0 gets a fifth of the
   particles tier 4 does, and the whole system self-disables when its budget
   would be zero. Every component checks how full the pool already is before
   it emits, in priority order (bow wave and prop wash first, rooster tail
   last), so three RIBs and a superyacht degrade gracefully instead of
   starving the rain and the splashes. Ribbons cost the pool NOTHING, so the
   persistent trail survives budget pressure intact.

   FLAGS
     CBZ.CONFIG.WATER_WAKE_SPRITES (default OFF, here) the billboard pool. OFF
                                   -> no buffers, no texture, no Points object,
                                   and spawn() refuses every caller including
                                   world/water_impact.js. The ribbon is NOT
                                   affected. Revert: ?cfg_WATER_WAKE_SPRITES=1
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

  // WATER_WAKE_SPRITES — THE BILLBOARD POOL, DEFAULT OFF (owner, 2026-08-11).
  // See "WHY THE SPRITES ARE OFF" in the header. A THREE.Points sprite is
  // always screen-aligned, and surface foam is a thing that LIES IN THE WATER
  // PLANE, so every ring this pool drew was a perfect upright white circle
  // where the geometry demands a foreshortened ellipse — bubbles standing on
  // the sea. OFF: nothing is built, nothing is spawned, nothing is drawn; the
  // emitters still run because they also drive the RIBBON, which is real flat
  // geometry and is untouched.
  // One-line revert: ?cfg_WATER_WAKE_SPRITES=1
  if (CFG.WATER_WAKE_SPRITES == null) CFG.WATER_WAKE_SPRITES = false;

  // The one gate every billboard path asks. Kept separate from WATER_WAKE_FX
  // so turning the sprites off cannot take the ribbon down with them.
  function spritesOn() {
    return CFG.WATER_WAKE_SPRITES !== false &&
      CFG.WATER_WAKE_FX !== false && CFG.WATER_V2 !== false;
  }

  const MAX = 640;                 // buffer size (tier-4 cap), allocated once
  function budget() { return Math.max(0, (CBZ.qScale ? CBZ.qScale(120, MAX) : 360) | 0); }

  const KIND_DROP = 0, KIND_RING = 1;

  let points = null, geo = null, mat = null;
  let pos = null, aSize = null, aAlpha = null, aKind = null;
  let vel = null, life = null, maxLife = null, grow = null, size0 = null, ride = null, alpha0 = null;
  let drag = null;                 // per-particle horizontal damping for riding foam
  let count = 0;
  let built = false;

  // Default per-second retention for foam riding the surface (the historical
  // value). 1 = no damping at all, used by the Kelvin wake rings so their
  // lateral offset grows linearly with age and the V holds its angle.
  const RIDE_DRAG = 0.22;
  // tan(19.47deg) — the Kelvin half-angle, a constant of deep-water gravity
  // waves and independent of hull speed.
  const TAN_KELVIN = 0.353553;

  // ---- the atlas: soft droplet | ring -------------------------------------
  // Deterministic canvas drawing (gradients, no noise) — same technique
  // world/materials.js uses for its procedural textures.
  function buildTexture() {
    const W = 256, H = 128;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, W, H);

    // left half: a soft droplet / foam blob
    let grd = g.createRadialGradient(64, 64, 0, 64, 64, 62);
    grd.addColorStop(0.00, "rgba(255,255,255,1.00)");
    grd.addColorStop(0.42, "rgba(240,252,255,0.72)");
    grd.addColorStop(1.00, "rgba(225,246,250,0.00)");
    g.fillStyle = grd;
    g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();

    // right half: a ring (surface ripple / wake crest)
    grd = g.createRadialGradient(192, 64, 0, 192, 64, 62);
    grd.addColorStop(0.00, "rgba(255,255,255,0.00)");
    grd.addColorStop(0.58, "rgba(255,255,255,0.00)");
    grd.addColorStop(0.78, "rgba(248,255,255,0.85)");
    grd.addColorStop(0.93, "rgba(230,248,252,0.30)");
    grd.addColorStop(1.00, "rgba(230,248,252,0.00)");
    g.fillStyle = grd;
    g.beginPath(); g.arc(192, 64, 62, 0, Math.PI * 2); g.fill();

    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.name = "cbz-water-particles";
    return t;
  }

  function build() {
    if (built) return;
    // WATER_WAKE_SPRITES off: never allocate the buffers, never build the
    // texture, never add a Points object to the scene. NOT latched, so the
    // flag can be flipped back on live and the pool builds on the next call.
    if (!spritesOn()) return;
    built = true;
    if (typeof document === "undefined") return;

    pos = new Float32Array(MAX * 3);
    aSize = new Float32Array(MAX);
    aAlpha = new Float32Array(MAX);
    aKind = new Float32Array(MAX);
    vel = new Float32Array(MAX * 3);
    life = new Float32Array(MAX);
    maxLife = new Float32Array(MAX);
    grow = new Float32Array(MAX);
    size0 = new Float32Array(MAX);
    ride = new Float32Array(MAX);        // 1 = re-seat onto the live surface
    alpha0 = new Float32Array(MAX);      // spawn opacity, faded by age
    drag = new Float32Array(MAX);        // per-second velocity retention (ride only)

    geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aKind", new THREE.BufferAttribute(aKind, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);

    mat = new THREE.ShaderMaterial({
      name: "CBZ Water Particles",
      uniforms: {
        uMap: { value: buildTexture() },
        uColor: { value: new THREE.Color(0xe6f4f6) },
        uPix: { value: 600 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      vertexShader: [
        "attribute float aSize;",
        "attribute float aAlpha;",
        "attribute float aKind;",
        "uniform float uPix;",
        "varying float vAlpha;",
        "varying float vKind;",
        "void main() {",
        "  vAlpha = aAlpha;",
        "  vKind = aKind;",
        "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
        "  gl_Position = projectionMatrix * mv;",
        // perspective point size, clamped so a ring right under the camera
        // cannot blow past the driver's max point size
        "  gl_PointSize = clamp(aSize * uPix / max(1.0, -mv.z), 1.0, 220.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform sampler2D uMap;",
        "uniform vec3 uColor;",
        "varying float vAlpha;",
        "varying float vKind;",
        "void main() {",
        "  vec2 uv = vec2(gl_PointCoord.x * 0.5 + vKind * 0.5, gl_PointCoord.y);",
        "  vec4 t = texture2D(uMap, uv);",
        "  float a = t.a * vAlpha;",
        "  if (a < 0.012) discard;",
        "  gl_FragColor = vec4(uColor * t.rgb, a);",
        "  #include <tonemapping_fragment>",
        "  #include <encodings_fragment>",
        "}",
      ].join("\n"),
    });

    points = new THREE.Points(geo, mat);
    points.name = "world-water-particles";
    points.frustumCulled = false;
    points.renderOrder = 4;             // over the sea, under the rain cloud (5)
    points.userData.dynamic = true;     // batch + farcull exempt
    points.userData.waterFx = true;
    points.visible = false;
    if (CBZ.scene) CBZ.scene.add(points);
  }

  // ---- spawning -----------------------------------------------------------
  function spawn(x, y, z, vx, vy, vz, size, growPerSec, ttl, kind, rideSurface, alpha, dragV) {
    // THE ONE CHOKE POINT. Every emitter in this file and every impact
    // vocabulary in world/water_impact.js reaches the billboards through here,
    // so one gate kills all of them and no caller needs to know.
    if (!spritesOn()) return false;
    if (!pos || count >= budget()) return false;
    const i = count++;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    size0[i] = size; aSize[i] = size; grow[i] = growPerSec;
    life[i] = 0; maxLife[i] = ttl > 0 ? ttl : 0.5;
    aKind[i] = kind;
    alpha0[i] = alpha == null ? 1 : alpha;
    aAlpha[i] = alpha0[i];
    ride[i] = rideSurface ? 1 : 0;
    drag[i] = dragV == null ? RIDE_DRAG : dragV;
    return true;
  }

  function kill(i) {
    const last = --count;
    if (i !== last) {
      pos[i * 3] = pos[last * 3]; pos[i * 3 + 1] = pos[last * 3 + 1]; pos[i * 3 + 2] = pos[last * 3 + 2];
      vel[i * 3] = vel[last * 3]; vel[i * 3 + 1] = vel[last * 3 + 1]; vel[i * 3 + 2] = vel[last * 3 + 2];
      aSize[i] = aSize[last]; aAlpha[i] = aAlpha[last]; aKind[i] = aKind[last];
      life[i] = life[last]; maxLife[i] = maxLife[last]; grow[i] = grow[last];
      size0[i] = size0[last]; ride[i] = ride[last]; alpha0[i] = alpha0[last];
      drag[i] = drag[last];
    }
  }

  function surfY(x, z) {
    return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z)
      : (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48);
  }

  // ============================================================
  //  THE PUBLIC POOL PRIMITIVE — one particle, fully specified.
  // ============================================================
  // world/water_impact.js builds every impact vocabulary (bullet spurt, body
  // crown + rebound jet, depth-charge dome / column / falling spray) out of
  // THIS call, so the whole game still draws its water in one THREE.Points
  // pass. Fields (all optional except x/y/z):
  //   x,y,z      spawn point (world)
  //   vx,vy,vz   initial velocity; droplets are ballistic, rings drift
  //   size       start size (world metres at the point-size reference)
  //   grow       size change per second (rings expand, droplets shrink)
  //   ttl        lifetime in seconds
  //   ring       true -> the ring half of the atlas, false -> a droplet
  //   ride       true -> re-seat on the LIVE swell every frame (surface foam)
  //   alpha      spawn opacity
  //   drag       per-second velocity retention for riding foam (1 = none)
  // Returns true if a slot was available. Never throws, never allocates.
  CBZ.waterEmit = function (o) {
    if (!o) return false;
    if (CFG.WATER_WAKE_FX === false || CFG.WATER_V2 === false) return false;
    build();
    if (!pos) return false;
    return spawn(+o.x || 0, +o.y || 0, +o.z || 0,
      +o.vx || 0, +o.vy || 0, +o.vz || 0,
      o.size > 0 ? +o.size : 0.14,
      Number.isFinite(o.grow) ? +o.grow : 0,
      o.ttl > 0 ? +o.ttl : 0.6,
      o.ring ? KIND_RING : KIND_DROP,
      !!o.ride,
      o.alpha == null ? 1 : +o.alpha,
      Number.isFinite(o.drag) ? +o.drag : RIDE_DRAG);
  };

  // Slots still free this frame. Impact vocabularies size their bursts against
  // this so a depth charge borrows from the SAME tier-scaled budget the wakes
  // and rain live in instead of starving them.
  CBZ.waterEmitFree = function () {
    // Zero with the sprites off, so an impact vocabulary sizes its burst at
    // nothing and never runs the loop at all, instead of computing a hundred
    // ballistic beads for a spawn() that will refuse every one.
    if (!spritesOn()) return 0;
    return Math.max(0, budget() - count);
  };

  // PUBLIC (legacy, signature FROZEN — city/swim.js and world/water_underwater.js
  // are the existing callers): a body hitting (or leaving) the water.
  // `strength` 0..1+ scales the droplet count and how high they are thrown.
  //
  // This now DELEGATES to the impact bus (CBZ.waterHit, world/water_impact.js)
  // so those two callers get the calibrated crown + rebound-jet + settling-ring
  // vocabulary and the momentum-scaled audio for free, with no edit to their
  // files. The inline burst below stays as the fallback for when the bus is
  // absent (flag off, file not loaded) or the point is not over water.
  CBZ.waterSplashAt = function (x, y, z, strength) {
    if (CFG.WATER_WAKE_FX === false || CFG.WATER_V2 === false) return;
    const s = Math.max(0.15, Math.min(2.5, +strength || 1));
    if (CBZ.waterHit) {
      // A body-class entry: mass fixed at a human, speed recovered from the
      // caller's strength dial so momentum (and therefore splash size AND
      // loudness) still track what the caller asked for.
      try {
        if (CBZ.waterHit(x, y, z, { kind: "body", mass: 78, speed: 2.6 + s * 5.6 })) return;
      } catch (e) {}
    }
    build();
    if (!pos) return;
    const sy = surfY(x, z);
    const n = Math.round(6 + s * 12);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.25 + Math.random() * 0.7 * s;
      spawn(x + Math.cos(a) * r * 0.4, sy + 0.05, z + Math.sin(a) * r * 0.4,
        Math.cos(a) * r * 1.7, 1.6 + Math.random() * 2.6 * s, Math.sin(a) * r * 1.7,
        0.16 + Math.random() * 0.20 * s, -0.02, 0.45 + Math.random() * 0.5, KIND_DROP, false, 0.95);
    }
    // the collapse ring left behind
    spawn(x, sy + 0.03, z, 0, 0, 0, 0.5 * s, 3.2 * s, 1.15, KIND_RING, true, 0.85);
    spawn(x, sy + 0.03, z, 0, 0, 0, 0.25 * s, 1.7 * s, 0.8, KIND_RING, true, 0.7);
  };

  // PUBLIC: a persistent ripple/foam ring, e.g. a swimmer's stroke wash.
  CBZ.waterRippleAt = function (x, z, size, ttl) {
    if (CFG.WATER_WAKE_FX === false || CFG.WATER_V2 === false) return;
    build();
    if (!pos) return;
    spawn(x, surfY(x, z) + 0.03, z, 0, 0, 0,
      size > 0 ? size : 0.35, (size > 0 ? size : 0.35) * 1.6,
      ttl > 0 ? ttl : 1.1, KIND_RING, true, 0.7);
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
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
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
  function room(frac) { return count < budget() * frac; }

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
        spawn(bx + st.rx * off * s, by, bz + st.rz * off * s,
          st.rx * vLat * s, 0, st.rz * vLat * s,
          0.30 + amp * 0.55 + st.beam * 0.10,
          (0.9 + amp * 1.6) * (0.6 + st.beam * 0.18),
          1.5 + amp * 1.4,
          KIND_RING, true, (0.18 + amp * 0.44) * st.dg, 1.0);
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
    if (st.churn > 0.55 && room(0.80) && Math.random() < st.churn * 0.55 * st.dg) {
      const a = Math.random() * Math.PI * 2;
      spawn(px, py + 0.06, pz,
        wx * jet * 0.5 + Math.cos(a) * 0.7,
        0.9 + Math.random() * 1.3 * st.churn,
        wz * jet * 0.5 + Math.sin(a) * 0.7,
        0.09 + Math.random() * 0.09, -0.03, 0.34, KIND_DROP, false, 0.72);
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
        const j = (Math.random() - 0.5) * st.loa * 0.30;
        // A planing powerboat heels INTO its turn, so the INSIDE chine is the
        // loaded one and throws the harder sheet. `s === sign(steer)` is that
        // side, and it costs one multiply.
        const bias = 1 + 0.45 * st.steer * s;
        spawn(cx + st.fx * j + st.rx * off * s, cy, cz + st.fz * j + st.rz * off * s,
          st.rx * lat * bias * s + st.fx * st.spd * 0.30,
          0.45 + pl * 1.15 + Math.random() * 0.5,
          st.rz * lat * bias * s + st.fz * st.spd * 0.30,
          0.08 + Math.random() * 0.10, -0.04, 0.28 + pl * 0.24,
          KIND_DROP, false, (0.46 + pl * 0.40) * st.dg);
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
        const j = (Math.random() - 0.5) * st.beam * 0.9;
        spawn(st.sx + st.rx * j, ty, st.sz + st.rz * j,
          -st.fx * (0.8 + st.spd * 0.10) + st.rx * (Math.random() - 0.5) * 1.5,
          up * (0.75 + Math.random() * 0.5),
          -st.fz * (0.8 + st.spd * 0.10) + st.rz * (Math.random() - 0.5) * 1.5,
          0.10 + Math.random() * 0.13, -0.03, 0.5 + pl * 0.5,
          KIND_DROP, false, (0.45 + pl * 0.35) * st.dg);
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
        0.07 + Math.random() * 0.07, -0.03, 0.22 + vN * 0.14,
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
      const a = Math.random() * Math.PI * 2, r = 0.35 + Math.random() * 0.4;
      CBZ.waterRippleAt(P.pos.x + Math.cos(a) * r, P.pos.z + Math.sin(a) * r,
        0.30 + Math.random() * 0.2, 1.0);
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
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.sqrt(Math.random()) * 34;
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
  CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.PRESENTATION : 60, function (dt) {
    frameSeq++;
    if (CFG.WATER_WAKE_FX === false || CFG.WATER_V2 === false) {
      if (points) points.visible = false;
      if (ribMesh) ribMesh.visible = false;
      return;
    }
    const g = CBZ.game;
    // The swim wash, the splash rings and the rain dimples are water effects,
    // not city effects. On the island this pass hid the whole buffer, so
    // city/swim.js's waterSplashAt() on every entry and exit emitted into a
    // points cloud that was never drawn — a silent, invisible plunge.
    if (!g || !(CBZ.waterModeOn ? CBZ.waterModeOn() : g.mode === "city")) {
      if (points) points.visible = false;
      count = 0;
      ribClearAll();
      return;
    }
    build();
    // SPRITES OFF: the emitters below STILL RUN, because CBZ.waterWakeFor also
    // feeds the ribbon — real geometry whose vertices sit in the water surface,
    // which is the one part of this system that was never a billboard. Only
    // spawn() is dead. Skipping the emitters here would have taken every boat's
    // trail with the bubbles.
    if (!spritesOn()) {
      if (points) points.visible = false;
      count = 0;
      dt = Math.min(0.1, dt || 0);
      emitBoatWakes(dt);
      emitSwim(dt);
      emitDriftWakes(dt);
      emitRain(dt);
      ribTick(dt);
      return;
    }
    if (!points || !pos) return;
    if (budget() <= 0) { points.visible = false; ribClearAll(); return; }

    dt = Math.min(0.1, dt || 0);

    emitBoatWakes(dt);
    emitSwim(dt);
    emitDriftWakes(dt);
    emitRain(dt);
    ribTick(dt);

    // ---- integrate ----
    for (let i = count - 1; i >= 0; i--) {
      life[i] += dt;
      const t = life[i] / maxLife[i];
      if (t >= 1) { kill(i); continue; }
      if (ride[i]) {
        // foam sits ON the water: re-seat it on the live swell every frame,
        // and let the ocean current drift it, so a wake does not sit still in
        // a moving sea.
        const x = pos[i * 3] + vel[i * 3] * dt, z = pos[i * 3 + 2] + vel[i * 3 + 2] * dt;
        pos[i * 3] = x; pos[i * 3 + 2] = z;
        pos[i * 3 + 1] = surfY(x, z) + 0.035;
        // drag[i] === 1 -> undamped: the Kelvin wake rings keep their lateral
        // rate forever so the V they trace holds a true 19.47deg half-angle.
        const dr = drag[i];
        if (dr < 0.999) {
          const k = Math.pow(dr, dt);
          vel[i * 3] *= k;
          vel[i * 3 + 2] *= k;
        }
      } else {
        vel[i * 3 + 1] -= 9.2 * dt;                 // droplets are ballistic
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        const sy = surfY(pos[i * 3], pos[i * 3 + 2]);
        if (pos[i * 3 + 1] < sy && vel[i * 3 + 1] < 0) { kill(i); continue; }
      }
      aSize[i] = Math.max(0.02, size0[i] + grow[i] * life[i]);
      // rings thin out smoothly across their whole life (an expanding ring
      // that stayed opaque would read as a hard disc); droplets hold their
      // opacity and only fade as they land.
      const fade = aKind[i] > 0.5 ? (1 - t) * (1 - t) : Math.min(1, (1 - t) * 2.4);
      aAlpha[i] = alpha0[i] * fade;
    }

    // ---- publish ----
    points.visible = count > 0;
    geo.setDrawRange(0, count);
    if (count > 0) {
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
      geo.attributes.aKind.needsUpdate = true;
    }

    // Perspective point-size scale in DEVICE pixels: half the drawing-buffer
    // height over tan(halfFov). Re-read every frame because the quality slider
    // moves the device pixel ratio live.
    const cam = CBZ.camera, r = CBZ.renderer;
    if (cam && r && r.domElement) {
      const h = r.domElement.height || 600;
      mat.uniforms.uPix.value = (h * 0.5) / Math.tan((cam.fov || 62) * 0.5 * Math.PI / 180);
    }
  });

  CBZ.waterParticleCount = function () { return count; };
})();
