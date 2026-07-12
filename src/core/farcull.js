/* ============================================================
   core/farcull.js — distance culling for the static city.

   WHY: at low quality tiers the fog is pulled in hard (quality.js
   publishes CBZ.cityFogFar), so everything beyond fog.far renders as a
   flat fog-coloured silhouette — invisible, yet still fully drawn.
   Frustum culling can't reject what's IN FRONT of the camera, and the
   glass/emissive window meshes can't be batch-merged (they shatter
   individually), so a distant tower still costs hundreds of draw calls
   to paint pure fog. This module hides whole top-level city groups
   (building shells + their windows + towns + islands) once they sit
   entirely past the cull radius. Radius comes from the quality tier
   (CBZ.cityCullRadius — every tier culls now: 235..430 low tiers, 500 at
   tiers 3-4, always a hair past that tier's fog.far so nothing visible
   pops; see core/quality.js's QUALITY table).

   SAFETY RULES (why this can't break gameplay):
     • visible=false does NOT affect r128 raycasts (LOS keeps hitting),
       colliders read rects, so physics/AI are untouched — the exact
       fact the wall-batch pass (core/batch.js) is built on.
     • We only ever RE-SHOW groups WE hid (own WeakSet). A group some
       other system hid (demolition's batchHideGroup companion
       b.group.visible=false, mode roots…) is skipped entirely, so we
       never resurrect a demolished building.
     • Anything dynamic is skipped: userData.dynamic subtrees, the
       named crowd root, and any group whose position moves between
       sweeps gets permanently blacklisted from culling.
     • Bounds are cached once per group (radius from a one-time Box3);
       the 4Hz sweep is a flat distance test per top-level child.
   Flag: CBZ.CONFIG.CITY_FAR_CULL (default ON). Flip false → every
   group this module hid is restored on the next sweep and it goes idle.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.CONFIG && CBZ.CONFIG.CITY_FAR_CULL == null) CBZ.CONFIG.CITY_FAR_CULL = true;

  const hidByUs = new Set();        // groups WE set visible=false on
  const bounds = new WeakMap();     // group -> {x,z,r,px,pz,dynamic}
  const _box = new THREE.Box3();
  const _v = new THREE.Vector3();

  function boundsFor(o) {
    let b = bounds.get(o);
    if (b) return b;
    // one-time measure. Meshes with a bounding sphere are cheap; groups pay
    // one Box3 walk. Anything unmeasurable or world-spanning is marked
    // dynamic=true (== never cull).
    b = { x: 0, z: 0, r: 1e9, px: o.position.x, pz: o.position.z, dynamic: false };
    try {
      if (o.userData && (o.userData.dynamic || o.userData.terrain)) { b.dynamic = true; }
      else if (o.name === "city-crowd") { b.dynamic = true; }
      else if (o.isInstancedMesh) {
        // an InstancedMesh's geometry sphere is ONE prototype at the object's
        // own (usually origin) transform — measuring that hid far-flung pools
        // whenever the player left the origin, or never culled them at all.
        // Aggregate the true spread from the instance matrices once (positions
        // live at elements 12/14 of each 16-float block).
        const a = o.instanceMatrix && o.instanceMatrix.array;
        const n = o.count | 0;
        if (!a || !n) { b.dynamic = true; }
        else {
          let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
          for (let i = 0; i < n; i++) {
            const x = a[i * 16 + 12], z = a[i * 16 + 14];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
          }
          if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
          const proto = (o.geometry.boundingSphere ? o.geometry.boundingSphere.radius : 2) * 3; // generous per-instance slack (instances scale)
          // instance positions are pool-local; nearly every pool sits at the
          // identity, but honour a translated pool object anyway.
          b.x = (minX + maxX) / 2 + o.position.x; b.z = (minZ + maxZ) / 2 + o.position.z;
          b.r = Math.hypot(maxX - minX, maxZ - minZ) / 2 + proto;
        }
      }
      else if (o.isMesh && o.geometry) {
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        const s = o.geometry.boundingSphere;
        _v.copy(s.center).applyMatrix4(o.matrixWorld);
        b.x = _v.x; b.z = _v.z; b.r = s.radius * Math.max(o.scale.x, o.scale.z, 1);
      } else {
        _box.setFromObject(o);
        if (isFinite(_box.min.x) && isFinite(_box.max.x)) {
          b.x = (_box.min.x + _box.max.x) / 2; b.z = (_box.min.z + _box.max.z) / 2;
          b.r = Math.hypot(_box.max.x - _box.min.x, _box.max.z - _box.min.z) / 2;
        } else b.dynamic = true;
      }
      // a footprint wider than a few blocks (terrain tiles, the sea, road
      // webs) never culls anyway — skip it forever instead of re-testing.
      if (b.r > 400) b.dynamic = true;
    } catch (e) { b.dynamic = true; }
    bounds.set(o, b);
    return b;
  }

  let lastSweepAt = 0, cursor = 0;
  CBZ.onAlways(3.6, function () {
    // WALL-CLOCK pacing, not game-dt: dt is clamped to 0.05s/frame, so on a
    // low-fps machine (the exact machines the cull radius exists FOR) a
    // dt-accumulated "4Hz" sweep degraded to once per several wall-seconds
    // and freshly-built worlds sat unculled for minutes.
    const now = performance.now();
    if (now - lastSweepAt < 250) return;   // 4Hz is plenty for walking/driving speeds
    lastSweepAt = now;
    const g = CBZ.game;
    const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    // City player state lives in `.pos`, not `.position`. Falling back to the
    // camera made street culling follow the look rig rather than the actor and
    // masked the true player location whenever the camera was offset.
    const P = CBZ.player && (CBZ.player.pos || CBZ.player.position)
      ? (CBZ.player.pos || CBZ.player.position)
      : (CBZ.camera ? CBZ.camera.position : null);
    const airborne = !!(CBZ.player && CBZ.player._aircraft && CBZ.player.pos && CBZ.player.pos.y > 24);
    // A city block can be fog-invisible from a sidewalk yet fully visible from
    // above. Never apply the street-level static culler to an aircraft view.
    const R = (!airborne && CBZ.CONFIG && CBZ.CONFIG.CITY_FAR_CULL !== false && g && g.mode === "city")
      ? (CBZ.cityCullRadius || 0) : 0;
    if (!root) return;
    if (!R) {                       // OFF (high tiers / flag) — restore and idle
      if (hidByUs.size) { hidByUs.forEach(function (o) { o.visible = true; }); hidByUs.clear(); }
      return;
    }
    if (!P) return;
    const kids = root.children;
    // amortize: at most ~1/4 of the children measured/tested per sweep → the
    // whole city re-evaluates every ~1s, still far faster than you can drive
    // through a fog wall. Hysteresis (show at R-20) stops boundary flicker.
    const slice = Math.max(64, Math.ceil(kids.length / 4));
    // First-time measurements are the expensive part (a group pays a Box3
    // subtree walk) — measured 30-50ms hitch-stacks right after a tier drop
    // when ~1000 unmeasured children landed in one sweep. Cap fresh measures
    // per sweep; already-measured children stay full-rate (they're a Map hit).
    // MESHES with a precomputed bounding sphere are O(1) to measure (batch.js
    // computes spheres for every merged tile/shell) — measuring them free of
    // the budget keeps ~1k merged meshes from sitting unculled for ~30s after
    // a build/tier change while the budget crawls to them.
    let freshMeasures = 32;
    for (let n = 0; n < slice; n++) {
      cursor = (cursor + 1) % kids.length;
      const o = kids[cursor];
      if (!o || (!o.isMesh && !o.isGroup)) continue;
      if (!bounds.has(o)) {
        // plain mesh with a precomputed sphere = O(1); instanced pools pay an
        // O(instances) aggregate scan, so they stay on the budget.
        const cheap = o.isMesh && !o.isInstancedMesh && o.geometry && o.geometry.boundingSphere;
        if (!cheap) {
          if (freshMeasures <= 0) continue;
          freshMeasures--;
        }
      }
      const b = boundsFor(o);
      if (b.dynamic) continue;
      if (o.position.x !== b.px || o.position.z !== b.pz) {
        // it MOVED — an actor/vehicle, not static city. Blacklist forever and
        // hand visibility back if we were the ones who hid it.
        b.dynamic = true;
        if (hidByUs.has(o)) { o.visible = true; hidByUs.delete(o); }
        continue;
      }
      const dx = b.x - P.x, dz = b.z - P.z;
      const d = Math.sqrt(dx * dx + dz * dz) - b.r;   // nearest possible point
      if (d > R) {
        if (o.visible && !hidByUs.has(o)) { o.visible = false; hidByUs.add(o); }
      } else if (d < R - 20) {
        if (hidByUs.has(o)) { o.visible = true; hidByUs.delete(o); }
      }
    }
  });

  // tier changed → new radius applies next sweep; if it WIDENED, groups past
  // the old radius but inside the new one re-show within a second via the
  // rolling cursor. Nothing to do here beyond an immediate restore when OFF.
  if (CBZ.onQualityChange) CBZ.onQualityChange(function () {
    if (!(CBZ.cityCullRadius || 0) && hidByUs.size) {
      hidByUs.forEach(function (o) { o.visible = true; });
      hidByUs.clear();
    }
  });
})();
