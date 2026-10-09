/* ============================================================
   entities/crowdgpu.js — THE REAL CROWD. Every person past the nearest few
   full rigs is the SAME human (CBZ.human), GPU-instanced, animated on the GPU
   from a baked bone texture. No stand-in bodies anywhere.

   OWNER (2026-10-08): "Why do you have to make fake bodies? There must be a
   better way. Look online how people make crowds."

   HOW REAL GAMES DO IT, AND WHAT THIS FILE TAKES FROM THEM
     Total War / Planet Coaster / Unity's GPU Animation Instancing / three.js
     crowd demos (three-vat, the bone-texture "SkinnedInstances" pattern,
     NVIDIA GPU Gems 3 ch.2 "Animated Crowd Rendering"): bake the character's
     animation into a TEXTURE once, draw every member as one instance of the
     real mesh, and let the vertex shader look its pose up by (clip, frame).
     Variation is per-instance data (clip, time offset, speed, palette
     indices), never a different model. Far away the same character is drawn
     as a multi-angle IMPOSTOR rendered FROM that mesh at bake time (Assassin's
     Creed Unity's bulk LODs, Total War's sprite tier). So:

   THE BODY. Our rig (entities/character.js) is RIGID-SEGMENTED: ~33 meshes,
   each parented to a joint. That is the cheapest case of GPU skinning —
   every vertex has exactly one "bone", its own mesh. BAKE: build one real rig
   per body (male / female), run the real animChar + the shared pose registry
   (entities/poses.js) through every clip, and record each mesh's matrix
   (relative to the rig root) per frame into a float texture (3 RGBA texels
   per mesh per frame). MERGE: every visible mesh of the rig into ONE
   geometry carrying `aPart` = (bone index, palette slot). The vertex shader
   fetches the two bracketing frames, blends, transforms, then places the
   instance. One draw call per (body, LOD) for any number of people.

   THE LOOK. Palette slots: skin, shirt, trousers, hair, shoes, forearm
   (sleeve or bare skin), fixed (eye line, soles), lips (from the skin). Each
   instance carries six PALETTE INDICES into one 256-colour palette texture,
   so a person keeps their clothes at every distance and when promoted to a
   full rig (dressRig paints the rig with the same colours).

   THE LOD CHAIN (one character at every distance)
     LOD0  full rigs with the brain — owned by the caller (mob.js's near ring)
     LOD1  the rig's own mid tier: limbs/torso/hair/hands at rig lod 1, the
           rig's far face (light skull + eye line) — VAT instanced
     LOD2  the rig's far tier (setHandLod(2): 8-sided limbs, low hands, far
           hair) minus sub-pixel face features — VAT instanced
     LOD3  impostor: the LOD2 mesh rendered at bake time from 8 angles x every
           clip's key frames into a slot+shade atlas, recoloured per instance
           from the same palette; only where a person is a few pixels tall
   Distances and per-LOD instance caps are per device; the nearest people win
   the expensive tiers (counting sort by distance, no per-frame sort).

   iOS / WEBGL LIMITS. Needs vertex texture fetch with float textures
   (capabilities.floatVertexTextures); without it ok() is false and callers
   draw nothing past their rigs (never a box). Bone texture: width = bones*3
   (~105), height = bodies*frames (~430) — RGBA32F, NEAREST, ~0.7 MB. Atlas:
   16 cells x 24 px wide, frames x 48 px tall (< 4096 on every axis, a GPU
   render target, not a canvas, so the iOS canvas cap never sees it).
   Uniforms added: 6. Two shared materials for everything (mesh + impostor).

   PUBLIC  CBZ.crowdGPU = {
     ok(), bake(), clip(id) -> {id, index, n, period, radPerM, phase0},
     look({build, skin, shirt, pants, hair, shoes, sleeve}) -> look id,
     layer({name, cap, parent}) -> L: L.begin(); L.add(x,y,z,yaw,look,clip,
       phase,rate); L.commit(); L.clear(); L.dispose(),
     dressRig(ch, look), rigOpts(look), audit(), layout() }
   Clip phase is in CYCLES (0..1). rate = cycles/second animated on the GPU
   (0 = the caller drives phase every frame).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE || CBZ.crowdGPU) return;

  const TAU = Math.PI * 2;
  const DEVICE = CBZ.deviceClass || "desktop";
  // LOD bands (m) and instance caps per tier. The nearest people get the
  // expensive tiers; overflow falls to the next tier, never to nothing.
  const TIERS = {
    desktop: { d1: 42, d2: 100, cap1: 140, cap2: 520 },
    tablet: { d1: 34, d2: 80, cap1: 72, cap2: 260 },
    phone: { d1: 26, d2: 62, cap1: 36, cap2: 140 },
  };
  const TIER = TIERS[DEVICE] || TIERS.desktop;
  const BIN = 1.0, NBIN = 640;            // distance bins for the counting sort (m)

  // ---------------------------------------------------------------- the clips
  // gait clips: the real walk/run at `speed` m/s (`overlay` holds the arms in
  // a registry pose over the legs). pose clips: standing (or seated) with the
  // registry pose `pose` running through one `period`.
  const CHEER_P = TAU / 8, FIST_P = TAU / 5, SIGN_P = TAU / 1.4, FLAG_P = TAU / 2.2;
  const CLIPS = [
    { id: "idle", gait: false, period: 4.0, n: 12, imp: 2 },
    { id: "walk", gait: true, speed: 1.3, n: 24, imp: 8 },
    { id: "run", gait: true, speed: 3.6, n: 20, imp: 8 },
    { id: "cheer", gait: false, pose: "pubCheer", period: CHEER_P, n: 12, imp: 4 },
    { id: "fist", gait: false, pose: "pubFist", period: FIST_P, n: 12, imp: 4 },
    { id: "sign", gait: false, pose: "pubPlacard", period: SIGN_P, n: 12, imp: 2 },
    { id: "signWalk", gait: true, speed: 1.15, overlay: "pubPlacard", n: 24, imp: 8 },
    { id: "flag", gait: false, pose: "pubFlag", period: FLAG_P, n: 12, imp: 4 },
    { id: "flagWalk", gait: true, speed: 1.15, overlay: "pubFlag", n: 24, imp: 8 },
    { id: "sit", gait: false, sit: true, period: 4.0, n: 8, imp: 2 },
    { id: "sitCheer", gait: false, sit: true, pose: "pubCheer", period: CHEER_P, n: 12, imp: 4 },
    { id: "down", gait: false, down: true, period: 4.0, n: 4, imp: 1 },
  ];
  const CLIP_IX = Object.create(null);
  let ROWS = 0, IMP_ROWS = 0;
  for (let i = 0; i < CLIPS.length; i++) {
    const c = CLIPS[i];
    c.index = i; c.row0 = ROWS; ROWS += c.n; c.imp0 = IMP_ROWS; IMP_ROWS += c.imp;
    c.radPerM = 0; c.phase0 = 0;
    CLIP_IX[c.id] = c;
  }
  const BODIES = [
    { build: "m", hairStyle: "short", longHair: false },
    { build: "f", hairStyle: "long", longHair: true },
  ];
  const SEAT = { cushion: 0.45, floorBelow: 0.45 };   // the seated clips' chair (arena seats read the same kit number)
  // palette slots (aPart.y)
  const S_SKIN = 0, S_SHIRT = 1, S_PANTS = 2, S_HAIR = 3, S_SHOES = 4, S_SLEEVE = 5, S_FIXED = 6, S_LIPS = 7;
  // impostor atlas cells
  const ANG = 8, CW = 24, CH = 48, FRAME_W = 1.3, FRAME_H = 2.6;

  // ---------------------------------------------------------------- palette
  const PAL_N = 256;
  const palHex = [], palIx = new Map();
  let palData = null, palTex = null, palDirty = false;
  function palIndex(hex) {
    hex = (hex | 0) & 0xffffff;
    let i = palIx.get(hex);
    if (i != null) return i;
    if (palHex.length < PAL_N) {
      i = palHex.length; palHex.push(hex); palIx.set(hex, i);
      if (palData) { palData[i * 4] = (hex >> 16) & 255; palData[i * 4 + 1] = (hex >> 8) & 255; palData[i * 4 + 2] = hex & 255; palData[i * 4 + 3] = 255; palDirty = true; }
      return i;
    }
    // full: the nearest colour already in it (never a wrong slot)
    let best = 0, bd = 1e9;
    const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    for (let k = 0; k < palHex.length; k++) {
      const h = palHex[k], dr = ((h >> 16) & 255) - r, dg = ((h >> 8) & 255) - g, db = (h & 255) - b, d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; best = k; }
    }
    palIx.set(hex, best);
    return best;
  }
  // looks: {build, skin, shirt, pants, hair, shoes, sleeve} -> id
  const LOOKS = [], LOOK_IX = new Map();
  function look(o) {
    o = o || {};
    const body = o.build === "f" ? 1 : 0;
    const skin = o.skin != null ? o.skin : 0xc68642;
    const shirt = o.shirt != null ? o.shirt : 0x444a52;
    const rec = {
      body: body, skin: skin, shirt: shirt, pants: o.pants != null ? o.pants : 0x2a3446,
      hair: o.hair != null ? o.hair : 0x2a1d16, shoes: o.shoes != null ? o.shoes : 0x2b2b2b,
      sleeve: o.sleeve != null ? o.sleeve : shirt,
    };
    const key = body + "|" + rec.skin + "|" + rec.shirt + "|" + rec.pants + "|" + rec.hair + "|" + rec.shoes + "|" + rec.sleeve;
    let id = LOOK_IX.get(key);
    if (id != null) return id;
    rec.ix = [palIndex(rec.skin), palIndex(rec.shirt), palIndex(rec.pants), palIndex(rec.hair), palIndex(rec.shoes), palIndex(rec.sleeve)];
    id = LOOKS.length; LOOKS.push(rec); LOOK_IX.set(key, id);
    return id;
  }

  // ---------------------------------------------------------------- the bake (pure: runs headless)
  let BAKE = null;
  function damp(c, t, r, dt) { return c + (t - c) * (1 - Math.exp(-r * dt)); }
  function slotOf(mesh, region) {
    const nm = mesh.name || "";
    if (nm === "lipUpper" || nm === "lipLower") return S_LIPS;
    if (nm === "armBare") return S_SLEEVE;
    switch (region) {
      case "head": case "hands": return S_SKIN;
      case "hair": return S_HAIR;
      case "torso": case "waist": case "armsUpper": return S_SHIRT;
      case "armsLower": return S_SLEEVE;
      case "pelvis": case "legsUpper": case "legsLower": return S_PANTS;
      case "shoes": return S_SHOES;
    }
    return S_FIXED;
  }
  function shown(o, root) { for (let p = o; p && p !== root.parent; p = p.parent) if (p.visible === false) return false; return true; }
  // one LOD state of the rig -> merged geometry arrays
  function mergeRig(ch, bones, regionOf, far) {
    const pos = [], nrm = [], col = [], part = [], idx = [];
    const skip = far ? { lipUpper: 1, lipLower: 1, lashes: 1, mouthCavity: 1, teeth: 1 } : { mouthCavity: 1, teeth: 1 };
    ch.group.updateMatrixWorld(true);
    for (let b = 0; b < bones.length; b++) {
      const m = bones[b];
      if (!shown(m, ch.group) || skip[m.name]) continue;
      const mat = m.material;
      if (!mat || Array.isArray(mat) || mat.transparent && mat.opacity < 0.9) continue;
      const region = regionOf.get(m) || null;
      if (far && region === "face" && !/^farEyes$/.test(m.name)) continue;   // the brow decal: sub-pixel out there
      let geo = m.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) continue;
      if (!geo.attributes.normal) { geo = geo.clone(); geo.computeVertexNormals(); }
      const P = geo.attributes.position, N = geo.attributes.normal, base = pos.length / 3;
      const slot = slotOf(m, region);
      let c = mat.color ? mat.color : new THREE.Color(1, 1, 1);
      // a decal's white base colour means "the texture decides": the eye line is dark
      if (slot === S_FIXED && mat.map && c.r > 0.9 && c.g > 0.9 && c.b > 0.9) c = new THREE.Color(0x2a2220);
      for (let v = 0; v < P.count; v++) {
        pos.push(P.getX(v), P.getY(v), P.getZ(v));
        nrm.push(N.getX(v), N.getY(v), N.getZ(v));
        col.push(c.r, c.g, c.b);
        part.push(b, slot);
      }
      if (geo.index) { const I = geo.index; for (let k = 0; k < I.count; k++) idx.push(base + I.getX(k)); }
      else for (let k = 0; k < P.count; k++) idx.push(base + k);
    }
    return {
      position: new Float32Array(pos), normal: new Float32Array(nrm), color: new Float32Array(col),
      part: new Float32Array(part), index: (pos.length / 3) > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
      verts: pos.length / 3, tris: idx.length / 3,
    };
  }
  function bake() {
    if (BAKE) return BAKE;
    if (!CBZ.human || !CBZ.human.build || !CBZ.animChar) return null;
    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    const POSES = CBZ.charPoses || {};
    const rigs = [];
    let maxBones = 0;
    for (let b = 0; b < BODIES.length; b++) {
      const B = BODIES[b];
      const ch = CBZ.human.build({ build: B.build, hairStyle: B.hairStyle, longHair: B.longHair,
        skin: 0xc68642, torso: 0x8a939c, collar: 0x8a939c, arms: 0x8a939c, legs: 0x2a3446, hair: 0x2a1d16, shoes: 0x2b2b2b });
      // visit both tiers first so every mesh either tier draws exists, then list the bones
      if (ch.setHandLod) { ch.setHandLod(2); ch.setHandLod(1); }
      if (CBZ.human.faceLod) CBZ.human.faceLod(ch, false);
      const bones = [];
      ch.group.traverse(function (o) { if (o.isMesh) bones.push(o); });
      const reg = CBZ.human.regions ? CBZ.human.regions(ch) : {};
      const regionOf = new Map();
      for (const k in reg) { const L = reg[k] || []; for (let i = 0; i < L.length; i++) regionOf.set(L[i], k); }
      ch.group.position.set(0, 0, 0); ch.group.rotation.set(0, 0, 0);
      const lod1 = mergeRig(ch, bones, regionOf, false);
      if (ch.setHandLod) ch.setHandLod(2);
      const lod2 = mergeRig(ch, bones, regionOf, true);
      if (ch.setHandLod) ch.setHandLod(1);
      maxBones = Math.max(maxBones, bones.length);
      rigs.push({ ch: ch, bones: bones, lod: [lod1, lod2] });
    }
    const W = maxBones * 3, H = ROWS * BODIES.length;
    const data = new Float32Array(W * H * 4);
    const DOWN = new THREE.Matrix4().makeTranslation(0, 0.13, 0).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    const M = new THREE.Matrix4();
    function record(R, row, post) {
      R.ch.group.updateMatrixWorld(true);
      for (let k = 0; k < R.bones.length; k++) {
        M.copy(R.bones[k].matrixWorld);
        if (post) M.premultiply(post);
        const e = M.elements, o = (row * W + k * 3) * 4;
        // three rows of the 3x4 (column-major source)
        data[o] = e[0]; data[o + 1] = e[4]; data[o + 2] = e[8]; data[o + 3] = e[12];
        data[o + 4] = e[1]; data[o + 5] = e[5]; data[o + 6] = e[9]; data[o + 7] = e[13];
        data[o + 8] = e[2]; data[o + 9] = e[6]; data[o + 10] = e[10]; data[o + 11] = e[14];
      }
    }
    function snapPose(ch, pose, t) {
      const f = POSES[pose]; if (!f) return;
      ch._pubT = t - 10; ch._pubHype = 0; ch._pubPh = 0; ch._pubProp = null;
      f(ch, 10);                       // a 10 s step: every damp lands exactly on the pose at time t
    }
    for (let b = 0; b < rigs.length; b++) {
      const R = rigs[b], ch = R.ch;
      for (let c = 0; c < CLIPS.length; c++) {
        const C = CLIPS[c], row0 = b * ROWS + C.row0;
        // reset the rig to a clean stand each clip
        ch.sitting = !!C.sit; ch.seatRef = C.sit ? { cushion: SEAT.cushion, floorBelow: SEAT.floorBelow, kind: "seat" } : null;
        ch.pose = (!C.gait && C.pose && !C.sit) ? C.pose : null;
        ch.phase = 0; ch._pubT = 0;
        const speed = C.gait ? C.speed : 0;
        const dt0 = 1 / 60;
        for (let w = 0; w < 60; w++) {         // 1 s: every damp (rate >= 9) settles into the cycle
          CBZ.animChar(ch, speed, dt0);
          if (C.overlay) snapPose(ch, C.overlay, ch._pubT + dt0);
          if (C.sit && C.pose) snapPose(ch, C.pose, ch._pubT + dt0);
        }
        if (C.gait) {
          // one frame = exactly 1/n of a stride cycle
          const p0 = ch.phase;
          CBZ.animChar(ch, speed, dt0);
          const dPh = Math.max(1e-4, ch.phase - p0);
          const dtF = (TAU / C.n) / dPh * dt0;
          C.period = dtF * C.n;
          C.radPerM = TAU / (C.period * speed);
          ch.phase = 0;
          for (let w = 0; w < C.n; w++) CBZ.animChar(ch, speed, dtF);   // re-settle at the bake step
          // start the record where the phase wraps (within half a frame of 0
          // mod 2pi): frame k <-> rig phase phase0 + 2pi*k/n
          const half = (TAU / C.n) * 0.5;
          for (let guard = 0; guard < C.n * 2; guard++) {
            const ph = ((ch.phase % TAU) + TAU) % TAU;
            if (ph < half || ph > TAU - half) break;
            CBZ.animChar(ch, speed, dtF);
          }
          const ph0 = ((ch.phase % TAU) + TAU) % TAU;
          C.phase0 = ph0 > Math.PI ? ph0 - TAU : ph0;
          for (let k = 0; k < C.n; k++) {
            if (C.overlay) snapPose(ch, C.overlay, k * dtF);
            record(R, row0 + k, null);
            CBZ.animChar(ch, speed, dtF);
          }
        } else {
          const dtF = C.period / C.n;
          for (let w = 0; w < C.n; w++) { CBZ.animChar(ch, 0, dtF); if (C.sit && C.pose) snapPose(ch, C.pose, w * dtF); }
          for (let k = 0; k < C.n; k++) {
            if (C.pose) snapPose(ch, C.pose, k * dtF);
            record(R, row0 + k, C.down ? DOWN : null);
            CBZ.animChar(ch, 0, dtF);
          }
        }
      }
      ch.sitting = false; ch.seatRef = null; ch.pose = null;
    }
    const t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    BAKE = {
      width: W, height: H, data: data, bones: maxBones, rowsPerBody: ROWS,
      bodies: rigs.map(function (R, b) { return { build: BODIES[b].build, bones: R.bones.length, lod: R.lod }; }),
      ms: +(t1 - t0).toFixed(1),
    };
    for (let b = 0; b < rigs.length; b++) rigs[b].ch = null;   // the bake rigs are garbage now
    return BAKE;
  }
  function layout() {
    return {
      vat: { width: (BAKE ? BAKE.width : 0), height: ROWS * BODIES.length, rowsPerBody: ROWS, clips: CLIPS.length, format: "RGBA32F" },
      atlas: { width: ANG * BODIES.length * CW, height: IMP_ROWS * CH, cell: [CW, CH], angles: ANG, frames: IMP_ROWS, format: "RGBA8" },
      palette: { width: PAL_N, height: 1 },
    };
  }

  // ---------------------------------------------------------------- GPU side
  const GPU = { tried: false, ok: false, why: "", boneTex: null, mat: null, impMat: null, geos: null, quad: null, atlas: null, atlasTried: false, U: null, maxTex: 0 };
  const GLSL_SKIN = [
    "uniform highp sampler2D uBones;",
    "uniform vec4 uBoneSize;",            // w, h, 1/w, 1/h
    "uniform sampler2D uPalette;",
    "uniform float uTime;",
    "attribute vec4 iPos;",               // x y z yaw
    "attribute vec4 iAnim;",              // row0, frames, phase (cycles), rate (cycles/s)
    "attribute vec4 iLook;",              // palette: skin shirt pants hair
    "attribute vec4 iLook2;",             // palette: shoes sleeve, body, scale
    "vec4 cgT(float c, float r) { return texture2D(uBones, vec2((c + 0.5) * uBoneSize.z, (r + 0.5) * uBoneSize.w)); }",
    "vec3 cgPal(float i) { return texture2D(uPalette, vec2((i + 0.5) / 256.0, 0.5)).rgb; }",
    "float cgFrame(out float r1, out float a) {",
    "  float n = max(iAnim.y, 1.0);",
    "  float f = fract(iAnim.z + uTime * iAnim.w) * n;",
    "  float f0 = floor(f); a = f - f0;",
    "  r1 = iAnim.x + mod(f0 + 1.0, n);",
    "  return iAnim.x + f0;",
    "}",
    "vec3 cgYaw(vec3 p) { float c = cos(iPos.w), s = sin(iPos.w); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }",
  ].join("\n");

  function capsOk() {
    const R = CBZ.renderer;
    if (!R || !R.capabilities) return "no renderer";
    const C = R.capabilities;
    if (!C.vertexTextures) return "no vertex texture fetch";
    if (!C.floatVertexTextures) return "no float vertex textures";
    GPU.maxTex = C.maxTextureSize || 4096;
    return "";
  }
  function initGPU() {
    if (GPU.tried) return GPU.ok;
    GPU.tried = true;
    if (typeof document === "undefined" || !THREE.InstancedBufferGeometry) { GPU.why = "headless"; return false; }
    const why = capsOk();
    if (why) { GPU.why = why; if (why === "no renderer") GPU.tried = false; return false; }   // too early: ask again later
    const B = bake();
    if (!B) { GPU.why = "no human rig"; return false; }
    const lim = Math.min(GPU.maxTex, 4096);
    if (B.width > lim || B.height > lim) { GPU.why = "bone texture " + B.width + "x" + B.height + " over " + lim; return false; }
    const bt = new THREE.DataTexture(B.data, B.width, B.height, THREE.RGBAFormat, THREE.FloatType);
    bt.magFilter = bt.minFilter = THREE.NearestFilter; bt.generateMipmaps = false; bt.flipY = false; bt.needsUpdate = true;
    GPU.boneTex = bt;
    palData = new Uint8Array(PAL_N * 4);
    for (let i = 0; i < palHex.length; i++) { const h = palHex[i]; palData[i * 4] = (h >> 16) & 255; palData[i * 4 + 1] = (h >> 8) & 255; palData[i * 4 + 2] = h & 255; palData[i * 4 + 3] = 255; }
    palTex = new THREE.DataTexture(palData, PAL_N, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    palTex.magFilter = palTex.minFilter = THREE.NearestFilter; palTex.generateMipmaps = false; palTex.needsUpdate = true;
    const U = GPU.U = {
      uBones: { value: bt }, uBoneSize: { value: new THREE.Vector4(B.width, B.height, 1 / B.width, 1 / B.height) },
      uPalette: { value: palTex }, uTime: { value: 0 }, uAtlas: { value: null },
      uAtlasCell: { value: new THREE.Vector4(1 / (ANG * BODIES.length), 1 / IMP_ROWS, FRAME_W, FRAME_H) },
    };
    // ---- the mesh material (LOD1 + LOD2, every body, every layer)
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    mat._shared = true;
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uBones = U.uBones; sh.uniforms.uBoneSize = U.uBoneSize; sh.uniforms.uPalette = U.uPalette; sh.uniforms.uTime = U.uTime;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\n" + GLSL_SKIN + "\nattribute vec2 aPart;\nvec3 cgP; vec3 cgN;\n" +
          "void cgSkin() {\n  float r1, a; float r0 = cgFrame(r1, a); float c = aPart.x * 3.0;\n" +
          "  vec4 m0 = mix(cgT(c, r0), cgT(c, r1), a), m1 = mix(cgT(c + 1.0, r0), cgT(c + 1.0, r1), a), m2 = mix(cgT(c + 2.0, r0), cgT(c + 2.0, r1), a);\n" +
          "  vec4 p = vec4(position, 1.0);\n" +
          "  cgP = cgYaw(vec3(dot(m0, p), dot(m1, p), dot(m2, p))) * iLook2.w + iPos.xyz;\n" +
          "  cgN = normalize(cgYaw(vec3(dot(m0.xyz, normal), dot(m1.xyz, normal), dot(m2.xyz, normal))));\n}\n" +
          "vec3 cgColor() {\n  float s = aPart.y;\n" +
          "  if (s < 0.5) return cgPal(iLook.x);\n  if (s < 1.5) return cgPal(iLook.y);\n  if (s < 2.5) return cgPal(iLook.z);\n" +
          "  if (s < 3.5) return cgPal(iLook.w);\n  if (s < 4.5) return cgPal(iLook2.x);\n  if (s < 5.5) return cgPal(iLook2.y);\n" +
          "  if (s < 6.5) return color;\n  return cgPal(iLook.x) * vec3(0.80, 0.60, 0.58);\n}")
        .replace("#include <color_vertex>", "")
        .replace("#include <beginnormal_vertex>", "cgSkin();\nvColor = cgColor();\nvec3 objectNormal = cgN;")
        .replace("#include <begin_vertex>", "vec3 transformed = cgP;");
    };
    mat.customProgramCacheKey = function () { return "crowdgpu-mesh-1"; };
    GPU.mat = mat;
    // ---- the impostor material (LOD3)
    const imp = new THREE.MeshLambertMaterial({ color: 0xffffff });
    imp._shared = true;
    imp.onBeforeCompile = function (sh) {
      sh.uniforms.uBones = U.uBones; sh.uniforms.uBoneSize = U.uBoneSize; sh.uniforms.uPalette = U.uPalette; sh.uniforms.uTime = U.uTime;
      sh.uniforms.uAtlas = U.uAtlas; sh.uniforms.uAtlasCell = U.uAtlasCell;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\n" + GLSL_SKIN + "\nuniform vec4 uAtlasCell;\nvarying vec2 vImUv; varying vec4 vLookA; varying vec2 vLookB;\nvec3 cgP; vec3 cgN;\n" +
          "void cgBill() {\n" +
          // the camera in this layer's space (modelView is rigid): -R^T t
          "  vec3 t = modelViewMatrix[3].xyz;\n" +
          "  vec3 cam = -vec3(dot(modelViewMatrix[0].xyz, t), dot(modelViewMatrix[1].xyz, t), dot(modelViewMatrix[2].xyz, t));\n" +
          "  vec3 d = cam - iPos.xyz; d.y = 0.0; float L = length(d); d = L > 1e-4 ? d / L : vec3(0.0, 0.0, 1.0);\n" +
          "  vec3 right = vec3(d.z, 0.0, -d.x);\n" +
          "  cgP = iPos.xyz + (right * (position.x * uAtlasCell.z) + vec3(0.0, position.y * uAtlasCell.w, 0.0)) * iLook2.w;\n" +
          "  cgN = normalize(d + vec3(0.0, 0.35, 0.0));\n" +
          "  float rel = atan(d.x, d.z) - iPos.w;\n" +
          "  float col = mod(floor(rel / 6.2831853 * 8.0 + 0.5), 8.0) + iLook2.z * 8.0;\n" +
          "  float n = max(iAnim.y, 1.0); float row = iAnim.x + floor(fract(iAnim.z + uTime * iAnim.w) * n);\n" +
          "  vImUv = vec2((col + position.x + 0.5) * uAtlasCell.x, (row + position.y) * uAtlasCell.y);\n" +
          "  vLookA = iLook; vLookB = iLook2.xy;\n}")
        .replace("#include <beginnormal_vertex>", "cgBill();\nvec3 objectNormal = cgN;")
        .replace("#include <begin_vertex>", "vec3 transformed = cgP;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D uAtlas; uniform sampler2D uPalette;\nvarying vec2 vImUv; varying vec4 vLookA; varying vec2 vLookB;\n" +
          "vec3 cgPalF(float i) { return texture2D(uPalette, vec2((i + 0.5) / 256.0, 0.5)).rgb; }")
        .replace("#include <color_fragment>",
          "vec4 im = texture2D(uAtlas, vImUv);\nif (im.a < 0.5) discard;\n" +
          "float sl = floor(im.r * 7.0 + 0.5);\nvec3 pc = vec3(1.0);\n" +
          "if (sl < 0.5) pc = cgPalF(vLookA.x); else if (sl < 1.5) pc = cgPalF(vLookA.y); else if (sl < 2.5) pc = cgPalF(vLookA.z);\n" +
          "else if (sl < 3.5) pc = cgPalF(vLookA.w); else if (sl < 4.5) pc = cgPalF(vLookB.x); else if (sl < 5.5) pc = cgPalF(vLookB.y);\n" +
          "else if (sl > 6.5) pc = cgPalF(vLookA.x) * vec3(0.80, 0.60, 0.58);\n" +
          "diffuseColor.rgb *= pc * im.g * 1.6;");
    };
    imp.customProgramCacheKey = function () { return "crowdgpu-imp-1"; };
    GPU.impMat = imp;
    // ---- shared base geometry per (body, lod)
    GPU.geos = B.bodies.map(function (bd) {
      return bd.lod.map(function (L) {
        return {
          position: new THREE.BufferAttribute(L.position, 3), normal: new THREE.BufferAttribute(L.normal, 3),
          color: new THREE.BufferAttribute(L.color, 3), aPart: new THREE.BufferAttribute(L.part, 2),
          index: new THREE.BufferAttribute(L.index, 1), verts: L.verts, tris: L.tris,
        };
      });
    });
    // impostor quad: x -0.5..0.5, y 0..1
    GPU.quad = {
      position: new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3),
      normal: new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
      index: new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1),
    };
    GPU.ok = true;
    return true;
  }

  // ---- LOD3: render the impostor atlas FROM the LOD2 mesh (once, lazily)
  function bakeAtlas() {
    if (GPU.atlasTried) return !!GPU.atlas;
    GPU.atlasTried = true;
    const R = CBZ.renderer;
    if (!R || !GPU.ok || !THREE.WebGLRenderTarget || !THREE.OrthographicCamera) return false;
    const AW = ANG * BODIES.length * CW, AH = IMP_ROWS * CH;
    if (AW > Math.min(GPU.maxTex, 4096) || AH > Math.min(GPU.maxTex, 4096)) return false;
    const rt = new THREE.WebGLRenderTarget(AW, AH, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false });
    rt.texture.generateMipmaps = false;
    const U = GPU.U;
    const bm = new THREE.ShaderMaterial({
      uniforms: { uBones: U.uBones, uBoneSize: U.uBoneSize, uPalette: U.uPalette, uTime: { value: 0 } },
      vertexShader: GLSL_SKIN + "\nattribute vec2 aPart;\nvarying float vSlot; varying vec3 vN; varying float vLum;\n" +
        "void main() {\n  float r1, a; float r0 = cgFrame(r1, a); float c = aPart.x * 3.0;\n" +
        "  vec4 m0 = cgT(c, r0), m1 = cgT(c + 1.0, r0), m2 = cgT(c + 2.0, r0);\n  vec4 p = vec4(position, 1.0);\n" +
        "  vec3 wp = vec3(dot(m0, p), dot(m1, p), dot(m2, p));\n" +
        "  vN = normalize(normalMatrix * vec3(dot(m0.xyz, normal), dot(m1.xyz, normal), dot(m2.xyz, normal)));\n" +
        "  vSlot = aPart.y; vLum = dot(color, vec3(0.3, 0.59, 0.11));\n" +
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);\n}",
      fragmentShader: "varying float vSlot; varying vec3 vN; varying float vLum;\n" +
        "void main() {\n  vec3 L = normalize(vec3(0.25, 0.75, 0.6));\n" +
        "  float sh = 0.42 + 0.58 * max(0.0, dot(normalize(vN), L));\n" +
        "  if (vSlot > 5.5 && vSlot < 6.5) sh *= vLum;\n" +
        "  gl_FragColor = vec4(floor(vSlot + 0.5) / 7.0, clamp(sh / 1.6, 0.0, 1.0), 0.0, 1.0);\n}",
      vertexColors: true,
    });
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-FRAME_W / 2, FRAME_W / 2, FRAME_H, 0, 0.1, 20);
    const prevRT = R.getRenderTarget ? R.getRenderTarget() : null;
    const prevClear = new THREE.Color(); R.getClearColor(prevClear);
    const prevAlpha = R.getClearAlpha(), prevAuto = R.autoClear;
    const prevShadow = R.shadowMap ? R.shadowMap.autoUpdate : false;
    try {
      R.setClearColor(0x000000, 0);
      R.autoClear = true;
      if (R.shadowMap) R.shadowMap.autoUpdate = false;
      for (let b = 0; b < BODIES.length; b++) {
        const G = GPU.geos[b][1];
        const geo = new THREE.InstancedBufferGeometry();
        geo.setIndex(G.index); geo.setAttribute("position", G.position); geo.setAttribute("normal", G.normal);
        geo.setAttribute("color", G.color); geo.setAttribute("aPart", G.aPart);
        const iPos = new THREE.InstancedBufferAttribute(new Float32Array(4), 4), iAnim = new THREE.InstancedBufferAttribute(new Float32Array(4), 4);
        geo.setAttribute("iPos", iPos); geo.setAttribute("iAnim", iAnim);
        geo.setAttribute("iLook", new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
        geo.setAttribute("iLook2", new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
        geo.instanceCount = 1;
        const mesh = new THREE.Mesh(geo, bm); mesh.frustumCulled = false;
        scene.add(mesh);
        for (let c = 0; c < CLIPS.length; c++) {
          const C = CLIPS[c];
          for (let f = 0; f < C.imp; f++) {
            const row = C.imp0 + f;
            // the impostor's frame f samples the VAT clip evenly
            iAnim.array[0] = b * ROWS + C.row0 + Math.floor(f * C.n / C.imp); iAnim.array[1] = 1; iAnim.array[2] = 0; iAnim.array[3] = 0;
            iAnim.needsUpdate = true;
            for (let a = 0; a < ANG; a++) {
              const th = a * TAU / ANG;
              cam.position.set(Math.sin(th) * 6, 0, Math.cos(th) * 6); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0);
              cam.updateMatrixWorld(true);
              const x = (b * ANG + a) * CW, y = row * CH;
              rt.viewport.set(x, y, CW, CH); rt.scissor.set(x, y, CW, CH); rt.scissorTest = true;
              R.setRenderTarget(rt);
              R.render(scene, cam);
            }
          }
        }
        scene.remove(mesh); geo.dispose();
      }
    } catch (e) {
      GPU.why = "atlas: " + (e && e.message);
      try { R.setRenderTarget(prevRT); } catch (e2) {}
      rt.dispose(); bm.dispose();
      return false;
    } finally {
      R.setRenderTarget(prevRT);
      R.setClearColor(prevClear, prevAlpha); R.autoClear = prevAuto;
      if (R.shadowMap) R.shadowMap.autoUpdate = prevShadow;
    }
    bm.dispose();
    GPU.atlas = rt;
    U.uAtlas.value = rt.texture;
    return true;
  }

  // ---------------------------------------------------------------- layers
  const LAYERS = [];
  function instGeo(base, cap) {
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(base.index); g.setAttribute("position", base.position); g.setAttribute("normal", base.normal);
    if (base.color) g.setAttribute("color", base.color);
    if (base.aPart) g.setAttribute("aPart", base.aPart);
    const A = {};
    for (const k of ["iPos", "iAnim", "iLook", "iLook2"]) {
      const at = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      at.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(k, at); A[k] = at;
    }
    g.instanceCount = 0;
    return { geo: g, A: A, cap: cap, n: 0 };
  }
  function layer(opts) {
    opts = opts || {};
    const cap = Math.max(1, opts.cap | 0 || 256);
    const sx = new Float32Array(cap), sy = new Float32Array(cap), sz = new Float32Array(cap), syaw = new Float32Array(cap);
    const slook = new Int32Array(cap), sclip = new Uint8Array(cap), sph = new Float32Array(cap), srate = new Float32Array(cap), sscale = new Float32Array(cap);
    const sbin = new Uint16Array(cap), order = new Int32Array(cap), binCount = new Int32Array(NBIN + 1);
    let n = 0, built = false, group = null, meshes = null, dead = false;
    const L = {
      name: opts.name || "crowd", cap: cap, drawn: [0, 0, 0, 0],
      maxDraw: opts.maxDraw || 400,
      begin: function () { n = 0; },
      // scale: optional uniform size (1 = the real body); warlord's map zoom reads it
      add: function (x, y, z, yaw, lk, clip, phase, rate, scale) {
        if (n >= cap) return -1;
        sx[n] = x; sy[n] = y; sz[n] = z; syaw[n] = yaw; slook[n] = lk | 0;
        const C = typeof clip === "number" ? CLIPS[clip] : CLIP_IX[clip];
        sclip[n] = C ? C.index : 0; sph[n] = phase || 0; srate[n] = rate || 0; sscale[n] = scale > 0 ? scale : 1;
        return n++;
      },
      count: function () { return n; },
      commit: commit,
      clear: function () { n = 0; if (meshes) for (let i = 0; i < meshes.length; i++) { meshes[i].P.n = 0; meshes[i].P.geo.instanceCount = 0; meshes[i].mesh.visible = false; } L.drawn = [0, 0, 0, 0]; },
      dispose: function () {
        dead = true;
        if (group && group.parent) group.parent.remove(group);
        if (meshes) for (let i = 0; i < meshes.length; i++) meshes[i].P.geo.dispose();
        const k = LAYERS.indexOf(L); if (k >= 0) LAYERS.splice(k, 1);
      },
      get root() { return group; },
    };
    function build() {
      if (built) return !!group;
      if (!initGPU()) return false;
      built = true;
      const parent = opts.parent || CBZ.scene;
      if (!parent) { built = false; return false; }
      group = new THREE.Group(); group.name = "crowdgpu:" + L.name;
      group.userData.dynamic = true; group.userData.transient = true;
      meshes = [];
      const caps = [Math.min(cap, TIER.cap1), Math.min(cap, TIER.cap2)];
      for (let b = 0; b < BODIES.length; b++) for (let l = 0; l < 2; l++) {
        const P = instGeo(GPU.geos[b][l], caps[l]);
        const m = new THREE.Mesh(P.geo, GPU.mat);
        m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; m.visible = false;
        m.matrixAutoUpdate = false; m.userData.dynamic = true; m.name = "crowd-lod" + (l + 1) + "-" + BODIES[b].build;
        group.add(m); meshes.push({ mesh: m, P: P, body: b, lod: l + 1 });
      }
      const PI = instGeo(GPU.quad, cap);
      const mi = new THREE.Mesh(PI.geo, GPU.impMat);
      mi.frustumCulled = false; mi.castShadow = false; mi.visible = false; mi.matrixAutoUpdate = false; mi.name = "crowd-lod3";
      group.add(mi); meshes.push({ mesh: mi, P: PI, body: -1, lod: 3 });
      parent.add(group);
      LAYERS.push(L);
      return true;
    }
    const _v = new THREE.Vector3();
    function put(P, i, row0, frames, body) {
      const k = P.n++, o = k * 4, A = P.A;
      const lk = LOOKS[slook[i]] || LOOKS[0];
      A.iPos.array[o] = sx[i]; A.iPos.array[o + 1] = sy[i]; A.iPos.array[o + 2] = sz[i]; A.iPos.array[o + 3] = syaw[i];
      A.iAnim.array[o] = row0; A.iAnim.array[o + 1] = frames; A.iAnim.array[o + 2] = sph[i]; A.iAnim.array[o + 3] = srate[i];
      const ix = lk.ix;
      A.iLook.array[o] = ix[0]; A.iLook.array[o + 1] = ix[1]; A.iLook.array[o + 2] = ix[2]; A.iLook.array[o + 3] = ix[3];
      A.iLook2.array[o] = ix[4]; A.iLook2.array[o + 1] = ix[5]; A.iLook2.array[o + 2] = body; A.iLook2.array[o + 3] = sscale[i];
    }
    // cam: optional THREE camera or {x,y,z, fx,fz} in WORLD space; defaults to CBZ.camera
    function commit(cam) {
      if (dead) return 0;
      if (!LOOKS.length) look({});
      if (!build()) return 0;
      if (GPU.U) GPU.U.uTime.value = clockNow();
      if (palDirty && palTex) { palTex.needsUpdate = true; palDirty = false; }
      // the camera in this layer's space
      let cx = 0, cy = 0, cz = 0, fx = 0, fz = 1;
      const C = cam && cam.isCamera ? cam : CBZ.camera;
      if (cam && cam.isCamera) cam = null;
      if (cam) { cx = cam.x; cy = cam.y || 0; cz = cam.z; if (cam.fx != null) { fx = cam.fx; fz = cam.fz; } }
      else if (C && C.position) {
        cx = C.position.x; cy = C.position.y; cz = C.position.z;
        const e = C.matrixWorld && C.matrixWorld.elements;
        if (e) { const ax = -e[8], az = -e[10], l = Math.hypot(ax, az) || 1; fx = ax / l; fz = az / l; }
      }
      const par = group.parent;
      if (par && par !== CBZ.scene) {
        par.updateMatrixWorld();
        _v.set(cx, cy, cz); par.worldToLocal(_v); cx = _v.x; cy = _v.y; cz = _v.z;
        const e = par.matrixWorld.elements, yaw = Math.atan2(e[8], e[10]);
        const c = Math.cos(-yaw), s = Math.sin(-yaw), nfx = c * fx + s * fz, nfz = -s * fx + c * fz; fx = nfx; fz = nfz;
      }
      // counting sort by distance
      binCount.fill(0);
      const maxD = L.maxDraw, maxD2 = maxD * maxD;
      let m = 0;
      for (let i = 0; i < n; i++) {
        const dx = sx[i] - cx, dz = sz[i] - cz, d2 = dx * dx + dz * dz;
        if (d2 > maxD2) { sbin[i] = 65535; continue; }
        const d = Math.sqrt(d2);
        if (d > 10 && dx * fx + dz * fz < -d * 0.3) { sbin[i] = 65535; continue; }   // behind the camera
        const b = Math.min(NBIN, (d / BIN) | 0);
        sbin[i] = b; binCount[b]++; m++;
      }
      let acc = 0;
      for (let b = 0; b <= NBIN; b++) { const c = binCount[b]; binCount[b] = acc; acc += c; }
      for (let i = 0; i < n; i++) { const b = sbin[i]; if (b !== 65535) order[binCount[b]++] = i; }
      for (let k = 0; k < meshes.length; k++) meshes[k].P.n = 0;
      const imp = bakeAtlas() ? meshes[meshes.length - 1].P : null;
      let n1 = 0, n2 = 0, n3 = 0;
      for (let k = 0; k < m; k++) {
        const i = order[k];
        const lk = LOOKS[slook[i]] || LOOKS[0], body = lk.body;
        const Cl = CLIPS[sclip[i]];
        const dx = sx[i] - cx, dz = sz[i] - cz, d = Math.sqrt(dx * dx + dz * dz);
        const P1 = meshes[body * 2].P, P2 = meshes[body * 2 + 1].P;
        const row = body * ROWS + Cl.row0;
        if (d < TIER.d1 && P1.n < P1.cap) { put(P1, i, row, Cl.n, body); n1++; }
        else if ((d < TIER.d2 || !imp) && P2.n < P2.cap) { put(P2, i, row, Cl.n, body); n2++; }
        else if (imp && imp.n < imp.cap) { put(imp, i, Cl.imp0, Cl.imp, body); n3++; }
      }
      for (let k = 0; k < meshes.length; k++) {
        const M = meshes[k], P = M.P;
        P.geo.instanceCount = P.n;
        M.mesh.visible = P.n > 0;
        if (P.n) for (const a in P.A) { const at = P.A[a]; at.needsUpdate = true; if (at.updateRange) { at.updateRange.offset = 0; at.updateRange.count = P.n * 4; } }
      }
      L.drawn = [0, n1, n2, n3];
      return m;
    }
    return L;
  }
  let _clock0 = 0;
  function clockNow() {
    const t = (typeof performance !== "undefined" && performance.now) ? performance.now() / 1000 : Date.now() / 1000;
    if (!_clock0) _clock0 = t;
    return (t - _clock0) % 3600;
  }
  // the GPU clock ticks every frame, whether or not any layer re-cut this
  // frame (a seated bowl re-cuts a few times a second; it animates always)
  if (CBZ.onAlways) CBZ.onAlways(95, function () {
    if (!GPU.U) return;
    GPU.U.uTime.value = clockNow();
    if (palDirty && palTex) { palTex.needsUpdate = true; palDirty = false; }
  });

  // ---------------------------------------------------------------- promotion seam
  // what a crowd member's full rig must be built with, and painted with, so the
  // person who walks up is the person you were watching
  function rigOpts(id) {
    const lk = LOOKS[id]; if (!lk) return {};
    const B = BODIES[lk.body];
    return { gender: B.build, skin: lk.skin, outfit: lk.shirt, hairStyle: B.hairStyle };
  }
  function dressRig(ch, id) {
    const lk = LOOKS[id]; if (!ch || !lk) return false;
    try { if (CBZ.human && CBZ.human.dress) CBZ.human.dress(ch, { torso: lk.shirt, collar: lk.shirt, arms: lk.shirt, legs: lk.pants, shoes: lk.shoes }); } catch (e) {}
    const R = CBZ.human && CBZ.human.regions ? CBZ.human.regions(ch) : null;
    if (R && CBZ.paintMesh) {
      const paint = function (list, hex) { if (list) for (let i = 0; i < list.length; i++) if (list[i]) CBZ.paintMesh(list[i], hex); };
      paint(R.hair, lk.hair);
      paint(R.armsLower, lk.sleeve);
    }
    return true;
  }

  CBZ.crowdGPU = {
    ok: function () { return initGPU(); },
    bake: bake,
    layout: layout,
    clips: function () { return CLIPS.map(function (c) { return c.id; }); },
    clip: function (id) {
      const c = typeof id === "number" ? CLIPS[id] : CLIP_IX[id];
      if (!c) return null;
      if (c.gait && !c.radPerM && !BAKE) bake();
      return { id: c.id, index: c.index, n: c.n, period: c.period, radPerM: c.radPerM, phase0: c.phase0, speed: c.speed || 0 };
    },
    look: look,
    lookOf: function (id) { const l = LOOKS[id]; return l ? { build: BODIES[l.body].build, skin: l.skin, shirt: l.shirt, pants: l.pants, hair: l.hair, shoes: l.shoes, sleeve: l.sleeve } : null; },
    layer: layer,
    rigOpts: rigOpts,
    dressRig: dressRig,
    tier: function () { return Object.assign({ device: DEVICE }, TIER); },
    audit: function () {
      const drawn = [0, 0, 0, 0];
      for (let i = 0; i < LAYERS.length; i++) for (let k = 1; k < 4; k++) drawn[k] += LAYERS[i].drawn[k];
      return {
        ok: GPU.ok, why: GPU.why, layers: LAYERS.length, looks: LOOKS.length, palette: palHex.length,
        bakeMs: BAKE ? BAKE.ms : null, atlas: !!GPU.atlas, layout: layout(),
        verts: BAKE ? BAKE.bodies.map(function (b) { return [b.lod[0].verts, b.lod[1].verts]; }) : null,
        lod1: drawn[1], lod2: drawn[2], lod3: drawn[3],
      };
    },
  };
})();
