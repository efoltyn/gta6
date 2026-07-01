/* ============================================================
   systems/skidmarks.js — pooled per-wheel skid-mark RIBBON TRAILS.

   RESEARCH BASIS (hand-ported, no bundler/ES-module dep): mkkellogg's
   TrailRendererJS. That library follows a moving point by keeping a fixed
   RING BUFFER of "nodes" (world positions sampled over time), building a
   ribbon quad between each consecutive PAIR of nodes, and fading the tail
   via per-vertex alpha rather than ever reallocating geometry. This file is
   that same idea, hand-written in plain vanilla JS/GLSL to match this
   codebase's r128 conventions (array-of-strings shaders, like
   city/interiormap.js's ShaderMaterial) — nothing here depends on the
   original TS/npm package.

   RING-WRAP CORRECTNESS: a naive indexed triangle-strip over a wrapping ring
   buffer breaks the instant the ring wraps — slot NODES-1 and slot 0 stop
   being temporally adjacent the moment slot 0 gets overwritten by a NEWER
   node, so a fixed index buffer would stitch a seam across the wrong pair
   and draw a garbage triangle across the whole trail. Fix: each node PAIR
   is its own self-contained, non-indexed quad (6 verts, own alpha, own age)
   — exactly the segment-quad shape city/vehicles.js's existing laySkidSegment
   already uses for the (non-fading) player rubber. Segments are written into
   fixed ring slots (segment i lives at slots i*18..i*18+17) so overwriting a
   slot never depends on its neighbours still being valid — no seam, no
   reallocation, and the fade is genuinely per-segment.

   WHY A SEPARATE SYSTEM FROM vehicles.js's existing laySkids(): that block
   already lays a flat OPAQUE rubber quad-strip for the PLAYER car only, never
   fading. This module adds the fading, camera-culled, POOLED-ACROSS-ALL-CARS
   trail (player AND traffic AI alike), so a drifting NPC or a PIT-spun cop
   car leaves fading rubber too, without either system fighting the other
   (this one sits a hair above the existing rubber-quad layer; see Y offset).

   POOLING (draw-call discipline): every wheel-trail lives in ONE of a fixed
   TRACK_CAP set of preallocated tracks. Each track owns ONE small
   BufferGeometry sized for SEGS ring-buffer segments (position+alpha written
   in place, never reallocated) and shares ONE ShaderMaterial — so the whole
   game's skid-trail budget is TRACK_CAP draw calls, full stop, no matter how
   many cars are drifting at once.

   OWNERSHIP + EVICTION: a track is claimed by cityBeginSkid(car, wheelIndex)
   and freed either when cityEndSkid() lets it fully fade out, or — if every
   track is busy and a NEW skid needs one — by stealing whichever live track
   belongs to the car FARTHEST from the camera (mirrors city/crashfx.js's
   recycleChunk() permanence idiom: evict what's off-screen first, only fall
   back to the literal oldest if everything is in view).

   API:
     CBZ.cityBeginSkid(car, wheelIndex, x, z)  — start/refresh a trail at
       world (x,z) for this car's wheel slot (wheelIndex is just a small int
       key, e.g. 0=rearL, 1=rearR — callers decide the numbering).
     CBZ.cityUpdateSkid(car, wheelIndex, x, z) — feed the wheel's current
       world position each frame while slip is active; lays a new segment
       once the wheel has moved far enough (cheap: most frames are a no-op).
     CBZ.cityEndSkid(car, wheelIndex)          — stop feeding; the rubber
       already laid keeps fading out on its own, then the track recycles.

   Every jitter here (micro Y-stagger so overlapping trails don't z-fight)
   runs off a local seeded LCG — NEVER Math.random() — for replay/MP sync.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.scene) return;
  const THREE = window.THREE;
  const scene = CBZ.scene;

  // ---- deterministic seeded LCG (NEVER Math.random()) ----
  let _rs = 913741;
  function rng() { _rs = (_rs * 1103515245 + 12345) & 0x7fffffff; return _rs / 0x7fffffff; }

  // ---- tunables ----
  const TRACK_CAP = 16;        // fixed pool of live wheel-trails, ACROSS ALL CARS
  const SEGS = 22;             // ring-buffer segments per track
  const MIN_STEP = 0.35;       // world units the wheel must move before a new segment
  const WIDTH = 0.26;          // half-width of the tire mark
  const FADE_TIME = 5.5;       // seconds a laid segment takes to fully fade
  const MAX_AGE = FADE_TIME + 0.4;
  const CULL_DIST2 = 70 * 70;  // beyond this, nobody reads rubber — don't bother

  // one shared ShaderMaterial: unlit dark rubber, alpha from the per-vertex
  // `aAlpha` attribute (baked from each segment's remaining life) so the tail
  // genuinely fades without ANY per-frame geometry reallocation.
  const mat = new THREE.ShaderMaterial({
    uniforms: {},
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: [
      "attribute float aAlpha;",
      "varying float vAlpha;",
      "void main() {",
      "  vAlpha = aAlpha;",
      "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
      "}",
    ].join("\n"),
    fragmentShader: [
      "precision mediump float;",
      "varying float vAlpha;",
      "void main() {",
      "  gl_FragColor = vec4(0.05, 0.045, 0.05, vAlpha);",
      "}",
    ].join("\n"),
  });
  mat._shared = true;

  // ---- one track = one preallocated ring buffer of SEGS independent quads ----
  function makeTrack() {
    const pos = new Float32Array(SEGS * 6 * 3);   // 6 verts (2 tris) per segment
    const alpha = new Float32Array(SEGS * 6);
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(pos, 3);
    const alphaAttr = new THREE.BufferAttribute(alpha, 1);
    if (posAttr.setUsage) posAttr.setUsage(THREE.DynamicDrawUsage); else posAttr.dynamic = true;
    if (alphaAttr.setUsage) alphaAttr.setUsage(THREE.DynamicDrawUsage); else alphaAttr.dynamic = true;
    geo.setAttribute("position", posAttr);
    geo.setAttribute("aAlpha", alphaAttr);
    geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;   // trail spans blocks; recomputing bounds per segment isn't worth it
    mesh.renderOrder = 2;         // sits with the existing rubber-quad layer (vehicles.js laySkids)
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    scene.add(mesh);
    return {
      mesh, geo, pos, alpha, posAttr, alphaAttr,
      owner: null,          // { car, wheelIndex } while claimed
      ring: 0,              // next segment slot to (re)write
      live: 0,              // how many ring slots currently hold real rubber (caps at SEGS)
      lastX: 0, lastZ: 0,   // last laid point (for MIN_STEP gating + eviction distance)
      ages: new Float32Array(SEGS), // per-segment age (seconds since laid); Infinity = empty slot
      active: false,        // still being fed this frame (vs. fading out after End)
    };
  }

  const tracks = [];
  for (let i = 0; i < TRACK_CAP; i++) tracks.push(null); // lazily built on first use

  function camDist2(x, z) {
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam) return 0;
    const dx = x - cam.x, dz = z - cam.z;
    return dx * dx + dz * dz;
  }

  // find a free (or evictable) track slot. Mirrors crashfx.recycleChunk():
  // prefer stealing whatever's farthest from the lens; only fall back to
  // slot 0 if literally everything currently in the pool is on-screen.
  function acquireTrack() {
    let freeIdx = -1, farIdx = -1, farD = -1;
    for (let i = 0; i < TRACK_CAP; i++) {
      const t = tracks[i];
      if (!t) { freeIdx = i; break; }              // never-built slot: cheapest win
      if (!t.owner) { freeIdx = i; break; }         // fully retired track: reuse instantly
      const d = camDist2(t.lastX, t.lastZ);
      if (d > farD) { farD = d; farIdx = i; }
    }
    const i = freeIdx >= 0 ? freeIdx : (farIdx >= 0 ? farIdx : 0);
    if (!tracks[i]) tracks[i] = makeTrack();
    const t = tracks[i];
    if (t.owner) releaseTrack(t);                   // evict whoever was riding it
    return t;
  }

  function resetTrack(t) {
    t.ring = 0; t.live = 0;
    t.ages.fill(Infinity);
    t.pos.fill(0);
    t.alpha.fill(0);
  }

  function releaseTrack(t) {
    if (t.owner) {
      const map = t.owner.car._skidTrails;
      if (map) delete map[t.owner.wheelIndex];
    }
    t.owner = null; t.active = false;
    t.mesh.visible = false;
    t.geo.setDrawRange(0, 0);
    resetTrack(t);
  }

  // lay one self-contained rubber quad segment from (t.lastX,t.lastZ) to (x,z)
  // into the next ring slot. Independent of neighbouring slots — safe to
  // overwrite any slot at any time, so a wraparound never stitches a seam.
  function writeSegment(t, x, z) {
    const dx = x - t.lastX, dz = z - t.lastZ, len = Math.hypot(dx, dz);
    if (len < 0.02) { t.lastX = x; t.lastZ = z; return; } // degenerate step, just re-anchor
    const px = (-dz / len) * WIDTH, pz = (dx / len) * WIDTH;
    // micro Y-stagger (deterministic) so overlapping trails never z-fight, and
    // sit a hair above vehicles.js's existing rubber-quad layer (y~0.078).
    const y = 0.079 + rng() * 0.0015;
    const slot = t.ring; t.ring = (t.ring + 1) % SEGS;
    if (t.live < SEGS) t.live++;
    const o = slot * 18;
    const p = t.pos;
    const x0 = t.lastX, z0 = t.lastZ;
    p[o] = x0 + px; p[o + 1] = y; p[o + 2] = z0 + pz;
    p[o + 3] = x0 - px; p[o + 4] = y; p[o + 5] = z0 - pz;
    p[o + 6] = x - px; p[o + 7] = y; p[o + 8] = z - pz;
    p[o + 9] = x0 + px; p[o + 10] = y; p[o + 11] = z0 + pz;
    p[o + 12] = x - px; p[o + 13] = y; p[o + 14] = z - pz;
    p[o + 15] = x + px; p[o + 16] = y; p[o + 17] = z + pz;
    t.ages[slot] = 0;
    t.lastX = x; t.lastZ = z;
    t.posAttr.needsUpdate = true;
  }

  // ---- public API ------------------------------------------------------
  // (car, wheelIndex) is just a small key the caller owns — vehicles.js can
  // pass e.g. 0/1 for rear-left/rear-right, or per-corner ids for a 4-wheel rig.
  CBZ.cityBeginSkid = function (car, wheelIndex, x, z) {
    if (!car) return;
    if (!car._skidTrails) car._skidTrails = {};
    let t = car._skidTrails[wheelIndex];
    if (!t) {
      t = acquireTrack();
      t.owner = { car, wheelIndex };
      car._skidTrails[wheelIndex] = t;
      t.lastX = x; t.lastZ = z;   // anchor — first real segment lands next update
    }
    t.active = true;
    t.mesh.visible = camDist2(x, z) < CULL_DIST2;
  };

  CBZ.cityUpdateSkid = function (car, wheelIndex, x, z) {
    if (!car || !car._skidTrails) return;
    const t = car._skidTrails[wheelIndex];
    if (!t || !t.owner) return;
    t.active = true;
    const dx = x - t.lastX, dz = z - t.lastZ;
    if (t.live === 0 || dx * dx + dz * dz >= MIN_STEP * MIN_STEP) writeSegment(t, x, z);
  };

  CBZ.cityEndSkid = function (car, wheelIndex) {
    if (!car || !car._skidTrails) return;
    const t = car._skidTrails[wheelIndex];
    if (t) t.active = false;   // stop feeding; laid rubber keeps fading, then recycles
  };

  // ---- per-frame: age segments, bake fade-alpha, retire fully-faded tracks --
  CBZ.onAlways(9.7, function (dt) {
    if (!dt || dt <= 0) return;
    const g = CBZ.game;
    const inCity = !g || g.mode === "city"; // headless/no-game: still safe to no-op below
    for (let i = 0; i < TRACK_CAP; i++) {
      const t = tracks[i];
      if (!t || !t.owner) continue;
      if (!inCity) { t.mesh.visible = false; continue; }
      // age every live segment; bake alpha = remaining life, per-vertex
      let allDead = true, drawnSegs = 0;
      for (let s = 0; s < t.live; s++) {
        const age = (t.ages[s] += dt);
        if (age >= MAX_AGE) continue; // fully faded slot — skip, don't draw
        drawnSegs++;
        const life = Math.max(0, 1 - age / FADE_TIME) * 0.85;
        const ao = s * 6;
        for (let v = 0; v < 6; v++) t.alpha[ao + v] = life;
        allDead = false;
      }
      t.alphaAttr.needsUpdate = true;
      // draw the whole preallocated buffer range up to the last live slot; fully
      // faded slots are just zero-alpha (invisible) quads, cheaper than resizing
      // the draw range around gaps in the ring.
      t.geo.setDrawRange(0, t.live * 6);
      t.mesh.visible = drawnSegs > 0 && camDist2(t.lastX, t.lastZ) < CULL_DIST2;
      // nothing left to feed AND every segment has fully faded: give the track back.
      if (!t.active && allDead) releaseTrack(t);
    }
  });

  // fresh run → wipe every live/fading trail so a new game starts on clean asphalt.
  CBZ.citySkidReset = function () {
    for (let i = 0; i < TRACK_CAP; i++) { const t = tracks[i]; if (t) releaseTrack(t); }
  };
})();
