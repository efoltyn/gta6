/* ============================================================
   world/tsunami_flow.js — THE FLOOD HITS THE BUILDINGS.

   What made the island's inundation read as a lake with towers standing in
   it: the water did not know the towers were there. A real tsunami flood is
   a river with no banks going THROUGH a town, and the thing every aerial of
   Miyako and Banda Aceh shows is what happens at each building: the water
   PILES UP against the upstream wall in a white bank, tears past the corners,
   and leaves a V of foam and a dark eddy behind it, like a bridge pier in a
   spate. That is the whole file.

   ONE InstancedMesh, one draw call: a square of water surface around every
   standing island building, rendered only while the flood is on it. The
   vertex stage runs the SAME swell table the sea sheet displaces by
   (CBZ.waterWaveGLSL with the arena's live amp/chop and the shared clock),
   so the foam rides the waves instead of floating through them, and lifts
   the upstream bank a metre or so where the water is piling against the
   wall. The fragment stage draws the bank, the corner tear, the wake V and
   the eddy in the building's own flow frame, advected with the current.

   The CPU side is a 10 Hz pass over the building list (a few dozen records)
   that asks the ONE water oracle (CBZ.survSeaMeanY / waterFrontDropAt) how
   deep the flood is at each building and writes an instance matrix. No
   geometry is built per event and nothing is allocated per frame.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const WAKE = 18;          // m of wake room past the building on every side
  const SEG = 28;           // plane subdivisions (the bank is displaced)
  let mesh = null, mat = null, rectAttr = null, forArena = null, maxN = 0;
  let acc = 0, live = false;
  const _m = new THREE.Matrix4();
  const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

  function arenaNow() { return CBZ.surv && CBZ.surv.arena ? CBZ.surv.arena : null; }

  function build(arena) {
    const bs = arena.fragile || [];
    maxN = bs.length;
    if (!maxN || !CBZ.waterWaveGLSL || !CBZ.waterCommonUniforms) return false;
    const geo = new THREE.PlaneGeometry(1, 1, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const inst = geo;
    rectAttr = new THREE.InstancedBufferAttribute(new Float32Array(maxN * 4), 4);
    inst.setAttribute("aRect", rectAttr);

    const U = CBZ.waterCommonUniforms();
    U.uAmp = { value: 1 }; U.uChop = { value: 1 };
    U.uFlow = { value: new THREE.Vector2(1, 0) };
    U.uSpd = { value: 2 };
    U.uSed = { value: 1 };
    U.uLight = { value: 1 };
    U.uFoamDirty = { value: new THREE.Color(0x9a8d78) };
    U.uFoamClean = { value: new THREE.Color(0xe9eef0) };
    U.uEddy = { value: new THREE.Color(0x1d1a14) };

    const vs = [
      "uniform float uSeaTime;",
      "uniform float uAmp;",
      "uniform float uChop;",
      "uniform vec2 uFlow;",
      "attribute vec4 aRect;",          // half-w, half-d, depth k (0..1), seed
      "varying vec2 vL;",
      "varying vec4 vR;",
      "varying float vBank;",
      "#include <fog_pars_vertex>",
      "void main() {",
      "  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);",
      "  vec2 org = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;",
      "  vL = wp.xz - org;",
      "  vR = aRect;",
      CBZ.waterWaveGLSL("wp.xz", "uSeaTime", "uAmp", "twH", "twDx", "twDz", "uChop"),
      "  vec2 q = abs(vL) - aRect.xy;",
      "  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);",
      "  float ha = abs(uFlow.x) * aRect.x + abs(uFlow.y) * aRect.y;",
      "  float a = dot(vL, uFlow) / max(1.0, ha);",
      // the water piles against the upstream wall: up to ~1.4 m, falling
      // away over a few metres, scaled by how deep/fast the flood is there
      "  vBank = exp(-max(sd, 0.0) / 3.2) * smoothstep(0.35, -0.9, a) * aRect.z;",
      "  wp.y += twH + 0.07 + vBank * 1.4;",
      "  vec4 mvPosition = viewMatrix * wp;",
      "  gl_Position = projectionMatrix * mvPosition;",
      "  #include <fog_vertex>",
      "}",
    ].join("\n");

    const fs = [
      "uniform float uSeaTime;",
      "uniform vec2 uFlow;",
      "uniform float uSpd;",
      "uniform float uSed;",
      "uniform float uLight;",
      "uniform vec3 uFoamDirty;",
      "uniform vec3 uFoamClean;",
      "uniform vec3 uEddy;",
      "varying vec2 vL;",
      "varying vec4 vR;",
      "varying float vBank;",
      "#include <fog_pars_fragment>",
      "float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }",
      "float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);",
      "  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }",
      "void main() {",
      "  vec2 q = abs(vL) - vR.xy;",
      "  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);",
      "  if (sd < -0.05) discard;",      // inside the building: its walls own that
      "  vec2 fl = uFlow; vec2 cr = vec2(-fl.y, fl.x);",
      "  float a = dot(vL, fl), c = dot(vL, cr);",
      "  float ha = abs(fl.x) * vR.x + abs(fl.y) * vR.y;",   // half extent along the flow
      "  float hc = abs(fl.y) * vR.x + abs(fl.x) * vR.y;",   // and across it
      // the pattern is dragged downstream with the water
      "  vec2 adv = vec2(a - uSeaTime * uSpd * 1.6, c);",
      "  float n = vn(adv * 0.42 + vR.w * 17.0) * 0.6 + vn(adv * 1.3 + vR.w * 5.0) * 0.4;",
      "  float streak = vn(vec2(a * 0.18 - uSeaTime * uSpd * 0.35, c * 1.7 + vR.w * 9.0));",
      // contact froth all the way round, heaviest on the upstream face
      "  float contact = exp(-max(sd, 0.0) / 0.8);",
      "  float bank = exp(-max(sd, 0.0) / 3.0) * smoothstep(0.3 * ha, -ha - 1.0, a);",
      // the wake: two spreading foam lines off the downstream corners, and a
      // dark sheltered eddy between them
      "  float da = a - ha;",
      "  float behind = smoothstep(-0.5 * ha, 1.0, da);",
      "  float spread = hc + max(da, 0.0) * 0.32;",
      "  float edge = abs(abs(c) - spread);",
      "  float fade = exp(-max(da, 0.0) / 16.0);",
      "  float wake = exp(-edge / (1.1 + max(da, 0.0) * 0.06)) * behind * fade;",
      "  float eddy = smoothstep(spread, spread * 0.4, abs(c)) * behind * fade * smoothstep(0.0, 3.0, da);",
      // corner tear: the flow accelerating round the upstream corners
      "  float corner = exp(-length(vec2(max(abs(c) - hc, 0.0), a + ha)) / 2.2) * smoothstep(hc * 0.6, hc + 0.5, abs(c));",
      "  float foam = contact * 0.75 + bank * 1.15 + corner * 0.8 + wake * (0.55 + 0.6 * streak);",
      "  foam *= 0.45 + 0.75 * n;",
      "  foam = clamp(foam * vR.z, 0.0, 1.0);",
      "  float fa = smoothstep(0.18, 0.62, foam);",
      "  float ea = eddy * 0.32 * vR.z * (1.0 - fa);",
      // dirty foam in a soup, cleaner as the water settles
      "  vec3 fc = mix(uFoamClean, uFoamDirty, uSed) * (0.82 + 0.28 * n) * uLight;",
      "  vec3 col = mix(uEddy * uLight, fc, fa / max(0.001, fa + ea));",
      "  float alpha = clamp(fa * 0.92 + ea, 0.0, 0.95);",
      "  if (alpha < 0.01) discard;",
      "  gl_FragColor = vec4(col, alpha);",
      "  #include <fog_fragment>",
      "}",
    ].join("\n");

    mat = new THREE.ShaderMaterial({
      uniforms: U, vertexShader: vs, fragmentShader: fs,
      transparent: true, depthWrite: false, fog: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    mat.name = "tsunami-flow-foam";
    mesh = new THREE.InstancedMesh(inst, mat, maxN);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.name = "tsunami-flow";
    for (let i = 0; i < maxN; i++) mesh.setMatrixAt(i, _zero);
    mesh.instanceMatrix.needsUpdate = true;
    (arena.root || CBZ.scene).add(mesh);
    forArena = arena;
    return true;
  }

  function hide() {
    if (!mesh || !live) return;
    for (let i = 0; i < maxN; i++) mesh.setMatrixAt(i, _zero);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = false;
    live = false;
  }

  function tick(dt) {
    const g = CBZ.game;
    if (!g || !CBZ.islandModeOn || !CBZ.islandModeOn(g.mode)) return;
    const arena = arenaNow();
    const e = CBZ.waterEventGet ? CBZ.waterEventGet() : null;
    const on = !!(arena && e && e.kind === "tsunami" && e.phase && e.phase !== "warn");
    if (!on) { hide(); return; }
    if (forArena !== arena) {
      if (mesh && mesh.parent) mesh.parent.remove(mesh);
      mesh = null; forArena = null;
      if (!build(arena)) return;
    }
    const W = CBZ.survSeaWave ? CBZ.survSeaWave() : null;
    const U = mat.uniforms;
    if (CBZ.waterDriveCommonUniforms) CBZ.waterDriveCommonUniforms(U);
    if (W) { U.uAmp.value = W.amp; U.uChop.value = W.chop; U.uSed.value = Math.min(1, W.sediment || 0); }
    const drain = e.phase === "drain";
    const fx = (drain ? -1 : 1) * (+e.dx || 0), fz = (drain ? -1 : 1) * (+e.dz || 0);
    const fl = Math.hypot(fx, fz) || 1;
    U.uFlow.value.set(fx / fl, fz / fl);
    const flow = Math.abs(+e.flow || 0);
    U.uSpd.value = Math.min(4.5, 0.6 + flow * 0.5);
    // the scene's own light level (the tsunami dims sun+hemi): foam must not glow
    U.uLight.value = CBZ.sun && CBZ.hemi ? Math.min(1.25, 0.45 + 0.45 * (CBZ.sun.intensity || 0) + 0.35 * (CBZ.hemi.intensity || 0)) : 1;

    acc += dt || 0;
    if (acc < 0.1 && live) return;
    acc = 0;
    const mean = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : 0;
    const bs = arena.fragile, arr = rectAttr.array;
    // how hard the water is hitting: the sweep's live bore, the standing
    // flood's slosh, the drain's undertow
    const force = Math.min(1, 0.35 + flow / 5);
    let any = false;
    for (let i = 0; i < maxN; i++) {
      const b = bs[i];
      const lvl = b && !b.fallen ? mean - (CBZ.waterFrontDropAt ? CBZ.waterFrontDropAt(b.x, b.z) : 0) : -1e9;
      const depth = b ? lvl - (b.gy != null ? b.gy : 0) : -1;
      if (!b || b.fallen || depth < 0.25 || lvl > (b.gy || 0) + (b.h || 0) - 0.5) { mesh.setMatrixAt(i, _zero); arr[i * 4 + 2] = 0; continue; }
      const hw = (b.w || 8) * 0.5, hd = (b.d || 8) * 0.5;
      const S = 2 * (Math.max(hw, hd) + WAKE);
      _m.makeScale(S, 1, S); _m.setPosition(b.x, lvl, b.z);
      mesh.setMatrixAt(i, _m);
      arr[i * 4] = hw; arr[i * 4 + 1] = hd;
      // shallow water barely froths; a metre and more is a full bank
      arr[i * 4 + 2] = Math.min(1, depth / 1.2) * force;
      arr[i * 4 + 3] = (i * 0.618) % 1;
      any = true;
    }
    mesh.instanceMatrix.needsUpdate = true;
    rectAttr.needsUpdate = true;
    mesh.visible = any;
    live = true;
  }

  // after the arena's ocean drive (47.9) and wet-line (47.95)
  if (CBZ.onUpdate) CBZ.onUpdate(48.1, tick);

  CBZ.tsunamiFlowAudit = function () {
    return { built: !!mesh, visible: !!(mesh && mesh.visible), buildings: maxN };
  };
})();
