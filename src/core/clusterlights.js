/* ============================================================
   core/clusterlights.js — CBZ.clusterLights: HUNDREDS OF LIGHTS, NO
   RECOMPILES (Forward+ clustered shading, three r187).

   THE PROBLEM IT ENDS. Every lit shader in three bakes the number of point
   and spot lights into its program, so a fire starting, a bomb landing or a
   lamp switching on recompiled EVERY lit material — a multi-second stall on
   a phone. core/lightpin.js answered that by pinning the count: only the
   nearest LIGHT_BUDGET_POINT (16) lights reach the shader, the rest go dark.
   So distant lava and fire stopped lighting the ground, which is exactly
   the wrong way round for a volcano at night.

   THE ANSWER, under the WebGPU renderer: examples/jsm/lighting/
   ClusteredLighting.js. The view frustum is cut into a 3D grid of clusters
   (32 px screen tiles x 24 exponential depth slices); a compute pass bins
   every point/spot light's bounding sphere into the clusters it touches, and
   each fragment loops over only its own cluster's lights. The lights live
   in a data texture, NOT in the program: adding, removing, moving or
   recolouring one never changes a shader (LightsNode's cache key hashes
   only the lights that are not clustered: the sun, the sky, shadow casters).
   So the pin stands down (lightpin.js checks CBZ.clusterLights.on) and
   every fire, lava pool, burning car and explosion lights its surroundings,
   phones included.

   Under the classic WebGLRenderer nothing here runs (`on === false`), the
   pin keeps doing its job and the look is today's exactly. add() still
   returns a handle there (a no-op), so callers do not branch.

   API
     CBZ.clusterLights.on                       true under WebGPU with clustering installed
     const L = CBZ.clusterLights.add({ x, y, z, color, intensity, distance,
                 flicker, parent })             -> { light, set(x,y,z), color(hex),
                                                     power(v), remove() }
         intensity is in the GAME's light units (the r128 legacy model every
         light here is tuned on); toNode() converts it for the node
         renderer's physical falloff in ONE place (see LIGHT UNITS).
         flicker 0..1: a fire's breathing, done here, no caller ticks it.
     CBZ.clusterLights.stats()                  { on, max, lights, handles }
   Flags: CLUSTER_LIGHTS (default on; ?cfg_CLUSTER_LIGHTS=0 = stock lighting
   + the pin, under WebGPU too), CLUSTER_LIGHTS_MAX (default 512).
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.clusterLights) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.CLUSTER_LIGHTS == null) CBZ.CONFIG.CLUSTER_LIGHTS = true;
  if (CBZ.CONFIG.CLUSTER_LIGHTS_MAX == null) CBZ.CONFIG.CLUSTER_LIGHTS_MAX = 512;

  const R = CBZ.renderer;
  const CL = { on: false, max: 0, handles: new Set() };
  CBZ.clusterLights = CL;

  if (R && R.isWebGPURenderer && THREE.ClusteredLighting && CBZ.CONFIG.CLUSTER_LIGHTS !== false) {
    try {
      CL.max = Math.max(32, CBZ.CONFIG.CLUSTER_LIGHTS_MAX | 0);
      // (max lights, 32 px tiles, 24 depth slices, 64 lights a cluster)
      R.lighting = new THREE.ClusteredLighting(CL.max, 32, 24, 64);
      CL.on = true;
    } catch (e) { console.error("[clusterlights] install", e); CL.on = false; }
  }

  /* LIGHT UNITS. Every light in the game is tuned on the r128 model:
     colour x intensity x PI, falling off as pow(1 - d/distance, decay). The
     node renderer's point light is physical: intensity / d^2, windowed to
     zero at `distance`. Until the node port of the legacy model lands
     (docs/plan/three-r187.md, phase B (1)), a game-unit light is matched at
     a third of its reach, where most of what it lights stands:
         I_node = I_game x PI x (d_ref^2) / (1 - d_ref/distance)^decay.
     If the core light port sets THREE.LEGACY_LIGHTS_NODE (the legacy curve
     under WebGPU too), the game units pass straight through. */
  function toNode(intensity, distance, decay) {
    if (THREE.LEGACY_LIGHTS_NODE) return intensity;
    const d = Math.max(0.5, (distance > 0 ? distance : 20) / 3);
    const fall = Math.pow(Math.max(0.05, 1 - d / Math.max(distance, d + 0.01)), decay > 0 ? decay : 1);
    return intensity * Math.PI * d * d * fall;
  }
  CL.toNode = toNode;

  const NOOP = { light: null, set() { return this; }, color() { return this; }, power() { return this; }, remove() {} };
  CL.add = function (o) {
    o = o || {};
    if (!CL.on || !CBZ.scene) return NOOP;
    const dist = o.distance > 0 ? +o.distance : 18;
    const decay = 2;
    const l = new THREE.PointLight(o.color != null ? o.color : 0xff8a3a, 0, dist, decay);
    l.castShadow = false;
    l.userData.cluster = true;
    l.position.set(+o.x || 0, +o.y || 0, +o.z || 0);
    (o.parent || CBZ.scene).add(l);
    const h = {
      light: l, base: +o.intensity || 1, dist: dist, flicker: clamp01(o.flicker || 0), ph: Math.random() * 100,
      set(x, y, z) { l.position.set(x, y, z); return h; },
      color(hex) { l.color.setHex(hex); return h; },
      power(v) { h.base = +v || 0; return h; },
      reach(d) { h.dist = Math.max(0.5, +d || h.dist); l.distance = h.dist; return h; },
      remove() { if (l.parent) l.parent.remove(l); if (l.dispose) l.dispose(); CL.handles.delete(h); },
    };
    CL.handles.add(h);
    apply(h, 0);
    return h;
  };
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : +v); }
  let t = 0;
  function apply(h, dt) {
    let k = 1;
    if (h.flicker > 0) {
      h.ph += dt;
      // a fire breathes: two slow beats and a fast shiver
      const f = 0.62 * Math.sin(h.ph * 7.3) * Math.sin(h.ph * 2.9 + 1.1) + 0.38 * Math.sin(h.ph * 17.0 + h.base);
      k = 1 + h.flicker * 0.35 * f;
    }
    h.light.intensity = toNode(h.base * k, h.dist, 2);
  }
  CL.stats = function () {
    let n = 0;
    if (CBZ.scene) CBZ.scene.traverseVisible(function (o) { if (o.isPointLight || o.isSpotLight) n++; });
    return { on: CL.on, max: CL.max, lights: n, handles: CL.handles.size };
  };
  if (CL.on && CBZ.onAlways) {
    CBZ.onAlways(96.4, function (dt) {
      t += dt || 0;
      for (const h of CL.handles) {
        if (!h.light.parent) { CL.handles.delete(h); continue; }
        apply(h, dt || 0);
      }
    });
  }
})();
