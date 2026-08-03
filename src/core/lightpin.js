/* ============================================================
   core/lightpin.js — LIGHT BUDGET + PINNED SHADER LIGHT COUNTS.

   Two coupled r128 facts, both measured 2026-08-03 (M1 Pro, seed 90210):

   1) NUM_POINT_LIGHTS / NUM_SPOT_LIGHTS are baked into every lit program's
      cache key. Any change in the visible light count → EVERY lit material
      variant recompiles, and each r128 program compile is a synchronous
      CPU↔GPU stall. Program cacheKeys recorded 6+ historical point counts;
      programs grew 197→390 in a minute of play; the compile sync was ~22s
      of a 40s city boot and ~5s of every 8s of early play.

   2) The count is also the PRICE: r128 #pragma-unrolls the light loop, so a
      57-light city shader is huge to compile (Metal), huge to run (every
      fragment iterates 57 point lights), and uploads 57-struct uniform
      arrays per program switch. Pinning the count HIGH (64) doubled the
      boot stall to ~34s — count must be pinned LOW, not just pinned.

   THE BUDGET: each frame, rank the game's in-scene point lights by distance
   to the camera and let only the nearest LIGHT_BUDGET_POINT of them reach
   the shader. Suppression uses light.layers (mask 0 → r128 projectObject
   skips the light) so game systems keep full ownership of .visible —
   day/night lamp toggles, interior switches and headlights all still work.
   Distant lamps keep their emissive/sprite glow; they just stop being real
   shader lights, which beyond ~half a block they visually never were.

   THE PIN: zero-intensity dummy lights top the count up to exactly the
   budget every frame, so NUM_*_LIGHTS is a compile-time CONSTANT for the
   whole session: each shader variant compiles once, ever, and the compile
   is cheap because the count is small.

   Registry: PointLight/SpotLight constructors are Proxy-wrapped (prototype
   chain intact) so the frame pass walks dozens of lights, not the 150k-
   object scene graph; a full scene traverse re-syncs every 300 frames to
   catch lights detached and re-added past the constructor hook.

   Flags: LIGHT_COUNT_PIN (master, default on — ?cfg_LIGHT_COUNT_PIN=0
   restores the old thrashing behaviour), LIGHT_BUDGET_POINT (default 16),
   LIGHT_BUDGET_SPOT (default 8).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.CONFIG.LIGHT_COUNT_PIN == null) CBZ.CONFIG.LIGHT_COUNT_PIN = true;
  if (CBZ.CONFIG.LIGHT_BUDGET_POINT == null) CBZ.CONFIG.LIGHT_BUDGET_POINT = 16;
  if (CBZ.CONFIG.LIGHT_BUDGET_SPOT == null) CBZ.CONFIG.LIGHT_BUDGET_SPOT = 8;

  const reg = { point: new Set(), spot: new Set() };
  const OrigPoint = THREE.PointLight, OrigSpot = THREE.SpotLight;
  function wrap(name, kind) {
    THREE[name] = new Proxy(THREE[name], {
      construct(target, args, newTarget) {
        const l = Reflect.construct(target, args, newTarget);
        reg[kind].add(l);
        return l;
      },
    });
  }
  wrap("PointLight", "point");
  wrap("SpotLight", "spot");

  // a light reaches the shader only when its whole parent chain is visible
  // and it hangs off the live scene (r128 projectObject semantics). Our own
  // suppression channel is layers.mask, NOT .visible, so this reads the
  // game's intent even for lights we culled last frame.
  function wantsOn(l) {
    if (!l.visible) return false;
    let o = l;
    while (o.parent) { o = o.parent; if (!o.visible) return false; }
    return o === CBZ.scene;
  }

  let pool = null; const dummies = { point: [], spot: [] };
  const _wp = new THREE.Vector3();
  const candidates = [];
  function budgetPass(kind, Orig, budget) {
    candidates.length = 0;
    const cam = CBZ.camera;
    for (const l of reg[kind]) {
      if (!l.parent && !l._cbzPinDummy) { reg[kind].delete(l); continue; }
      if (l._cbzPinDummy) continue;
      if (!wantsOn(l)) { l.layers.mask = 1; continue; }   // off lights: restore + skip
      l.getWorldPosition(_wp);
      candidates.push([_wp.distanceToSquared(cam.position), l]);
    }
    candidates.sort((a, b) => a[0] - b[0]);
    let on = 0;
    for (let i = 0; i < candidates.length; i++) {
      const l = candidates[i][1];
      if (i < budget) { l.layers.mask = 1; on++; }
      else l.layers.mask = 0;                              // culled: shader never sees it
    }
    const want = budget - on;                              // dummies to top up to the pin
    const list = dummies[kind];
    while (list.length < want) {
      const d = new Orig(0xffffff, 0, 0.001);              // pre-wrap ctor: not registered
      d._cbzPinDummy = true;
      d.name = "lightpin-dummy";
      d.matrixAutoUpdate = false;
      list.push(d); pool.add(d);
    }
    for (let i = 0; i < list.length; i++) list[i].visible = i < want;
    return on;
  }

  let frame = 0;
  CBZ.onAlways(97, function () {
    if (!CBZ.CONFIG.LIGHT_COUNT_PIN || !CBZ.scene || !CBZ.camera) return;
    if (!pool) {
      pool = new THREE.Group();
      pool.name = "lightpin-pool";
      pool.position.y = -4000;          // out of every playfield; intensity 0 anyway
      CBZ.scene.add(pool);
    }
    // slow re-sync: catch lights detached and later re-added, which the
    // constructor hook only sees once.
    if (++frame % 300 === 0) {
      CBZ.scene.traverse(function (o) {
        if (o._cbzPinDummy) return;
        if (o.isPointLight) reg.point.add(o);
        else if (o.isSpotLight) reg.spot.add(o);
      });
    }
    budgetPass("point", OrigPoint, Math.max(1, +CBZ.CONFIG.LIGHT_BUDGET_POINT || 16));
    budgetPass("spot", OrigSpot, Math.max(1, +CBZ.CONFIG.LIGHT_BUDGET_SPOT || 8));
  });

  // probe seam: live/culled/pinned counts for gates and perf probes
  CBZ.lightPinAudit = function () {
    const audit = {};
    for (const kind of ["point", "spot"]) {
      let wants = 0, shaderOn = 0;
      for (const l of reg[kind]) { if (!l._cbzPinDummy && wantsOn(l)) { wants++; if (l.layers.mask) shaderOn++; } }
      audit[kind] = { wants, shaderOn, dummies: dummies[kind].filter((d) => d.visible).length };
    }
    return audit;
  };
})();
