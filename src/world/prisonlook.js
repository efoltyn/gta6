/* ============================================================
   world/prisonlook.js — THE CELL HOUSE IS LIT BY ITS LAMPS, AND IT IS
   MADE OF SOMETHING.

   WHAT WAS WRONG (2026-09-27, owner: "shitty images, some shitty scenes,
   make it more realistic"). Every surface in the prison was one flat
   colour per box, and the inside of the cell house was lit by exactly the
   same sky as the yard: hemisphere + sun, uniform from wall to wall. The
   cage lamps hanging off the trusses were emissive boxes that lit nothing.
   So the hall read as a white hangar at noon and a cell read the same as
   the corridor outside it — no pools, no dark corners, no ceiling gloom.

   WHAT THIS FILE DOES, in one shader patch applied to the prison's own
   materials (no new meshes, no new draw calls, no new shader lights, so
   the light-count pin in core/lightpin.js never moves):

     1. SURFACE. World-space, analytic (no texture, no UVs, so it works on
        every addBox and on core/batch.js's merged output alike):
          · a low-frequency mottle on everything (paint and concrete are
            never one colour),
          · scuffing / grime in the bottom 40 cm of every wall,
          · 400 x 200 mm running-bond concrete block on the big grey
            slabs (walls, partitions) with a fading mortar joint, and the
            institutional two-tone: a darker painted dado to 1.15 m with a
            thin stripe at its top, inside the cell house.
     2. LIGHT, INSIDE THE WING ONLY (x[-16,16] z[-44,-8]):
          · the sky's share (hemisphere + sun + bounce) is cut to what the
            barred windows admit,
          · the eleven hall pendants and the six night fittings are real
            per-pixel point sources (a loop over a uniform array),
          · every cell has its own ceiling fitting, and a cell is NOT lit by
            the hall pendants (its roof slab is in the way) — decided by a
            0.25 m top-down mask of the wing built from the cell records,
            which also darkens the floor under the gallery decks.
        The levels follow the wing's own circuit: CBZ.ceilingLamp's
        emissive (the breaker sabotage and the lights-out schedule both
        write it) turns the pendants and the cell fittings off, and the
        night fittings come up — lights-out is now actually dark.

   The patch is a chained onBeforeCompile with its own program cache key,
   so core/gfx.js's promoted-material shader keeps working underneath it.
   A 1 Hz sweep of the prison root picks up materials born later (actors,
   doors) and re-wraps any material a tier change re-installed.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const WING = { x0: -16, x1: 16, z0: -44, z1: -8 };
  const MASK_RES = 0.25;
  const MW = Math.round((WING.x1 - WING.x0) / MASK_RES);   // 128
  const MH = Math.round((WING.z1 - WING.z0) / MASK_RES);   // 144
  const FY = 3.9, CH = 3.6;
  const MAX_LAMPS = 18;

  // ---- shared uniforms: every patched program points at these objects ----
  const U = {
    prOn: { value: 0 },
    prLamp: { value: [] },          // vec4: xyz, intensity
    prLampCol: { value: [] },       // vec3
    prLampN: { value: 0 },
    prCellLamp: { value: 1 },
    prIndoorAmb: { value: 0.42 },
    prIndoorSun: { value: 0.16 },
    prMask: { value: null },
    prFall: { value: 0.10 },
    prCone: { value: 1.5 },
  };
  for (let i = 0; i < MAX_LAMPS; i++) {
    U.prLamp.value.push(new THREE.Vector4(0, -100, 0, 0));
    U.prLampCol.value.push(new THREE.Color(0, 0, 0));
  }

  /* ---- the mask. R = hall-pendant visibility at ground level, G = inside
     a cell, B/A = offset to that cell's centre (+-3 m packed into 0..1). */
  function buildMask() {
    const cb = CBZ.cellblock;
    const cells = (cb && cb.cells) || [];
    const data = new Uint8Array(MW * MH * 4);
    for (let i = 0; i < MW * MH; i++) { data[i * 4] = 255; data[i * 4 + 1] = 0; data[i * 4 + 2] = 128; data[i * 4 + 3] = 128; }
    const stamp = (x0, z0, x1, z1, fn) => {
      const i0 = Math.max(0, Math.floor((x0 - WING.x0) / MASK_RES)), i1 = Math.min(MW - 1, Math.ceil((x1 - WING.x0) / MASK_RES) - 1);
      const j0 = Math.max(0, Math.floor((z0 - WING.z0) / MASK_RES)), j1 = Math.min(MH - 1, Math.ceil((z1 - WING.z0) / MASK_RES) - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn((j * MW + i) * 4, WING.x0 + (i + 0.5) * MASK_RES, WING.z0 + (j + 0.5) * MASK_RES);
    };
    // the gallery decks: 1.35 m out from every upper cell front shade the
    // floor under them from the pendants (not fully: light comes in sideways)
    for (const c of cells) {
      if (!c.tier) continue;
      const gx0 = c.dx === 1 ? c.x + c.hx : c.dx === -1 ? c.x - c.hx - 1.35 : c.x - c.hx;
      const gx1 = c.dx === 1 ? c.x + c.hx + 1.35 : c.dx === -1 ? c.x - c.hx : c.x + c.hx;
      const gz0 = c.dz === 1 ? c.z + c.hz : c.z - c.hz;
      const gz1 = c.dz === 1 ? c.z + c.hz + 1.35 : c.z + c.hz;
      stamp(gx0, gz0, gx1, gz1, (p) => { data[p] = Math.min(data[p], 110); });
    }
    for (const c of cells) {
      stamp(c.x - c.hx, c.z - c.hz, c.x + c.hx, c.z + c.hz, (p, x, z) => {
        data[p] = 0; data[p + 1] = 255;
        data[p + 2] = Math.max(0, Math.min(255, Math.round(((c.x - x) / 6 + 0.5) * 255)));
        data[p + 3] = Math.max(0, Math.min(255, Math.round(((c.z - z) / 6 + 0.5) * 255)));
      });
    }
    const tex = new THREE.DataTexture(data, MW, MH, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    U.prMask.value = tex;
    return cells.length;
  }

  /* ---- GLSL ---------------------------------------------------------- */
  const VERT_PARS = "varying vec3 prWPos;\nvarying vec3 prWNrm;\n";
  const VERT_MAIN =
    "{\n" +
    "  vec4 prW = vec4( transformed, 1.0 );\n" +
    "  #ifdef USE_INSTANCING\n  prW = instanceMatrix * prW;\n  #endif\n" +
    "  prWPos = ( modelMatrix * prW ).xyz;\n" +
    // transformedNormal is view space; n * V is V^T n, i.e. back to world
    "  prWNrm = normalize( ( vec4( transformedNormal, 0.0 ) * viewMatrix ).xyz );\n" +
    "}\n";
  const FRAG_PARS =
    "varying vec3 prWPos;\nvarying vec3 prWNrm;\n" +
    "uniform float prOn;\nuniform vec4 prLamp[" + MAX_LAMPS + "];\nuniform vec3 prLampCol[" + MAX_LAMPS + "];\n" +
    "uniform int prLampN;\nuniform float prCellLamp;\nuniform float prIndoorAmb;\nuniform float prIndoorSun;\n" +
    "uniform sampler2D prMask;\nuniform float prFall;\nuniform float prCone;\n" +
    "float prHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }\n" +
    "float prNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );\n" +
    "  return mix( mix( prHash( i ), prHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( prHash( i + vec2( 0.0, 1.0 ) ), prHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }\n" +
    "float prInWing( vec3 p ) { return step( -15.6, p.x ) * step( p.x, 15.6 ) * step( -43.6, p.z ) * step( p.z, -8.4 ) * step( p.y, 9.6 ); }\n";

  // PR_KIND: 0 plain, 1 masonry slab, 2 floor, 3 actor (lighting only)
  const FRAG_SURFACE =
    "#if PR_KIND != 3\n" +
    "if ( prOn > 0.5 ) {\n" +
    "  vec3 prN = normalize( prWNrm ); vec3 prA = abs( prN );\n" +
    "  float prUp = step( prA.x, prA.y ) * step( prA.z, prA.y );\n" +
    "  vec2 prUV = prUp > 0.5 ? prWPos.xz : ( prA.x > prA.z ? prWPos.zy : prWPos.xy );\n" +
    "  float prDist = length( prWPos - cameraPosition );\n" +
    "  float prM = prNoise( prUV * 0.55 ) * 0.6 + prNoise( prUV * 2.3 + 7.0 ) * 0.4;\n" +
    "  float prShade = 1.0 + ( prM - 0.5 ) * 0.16;\n" +
    "  float prYy = prWPos.y >= " + (FY - 0.05).toFixed(2) + " && prWPos.y < 8.0 ? prWPos.y - " + FY.toFixed(2) + " : prWPos.y;\n" +
    // scuffs and grime at the foot of every wall
    "  float prFoot = ( 1.0 - prUp ) * ( 1.0 - smoothstep( 0.0, 0.42, prYy ) );\n" +
    "  prShade *= 1.0 - prFoot * ( 0.16 + 0.10 * prNoise( prUV * vec2( 6.0, 1.5 ) ) );\n" +
    "  #if PR_KIND == 1\n" +
    "  if ( prUp < 0.5 ) {\n" +
    "    float prRow = floor( prUV.y / 0.2 );\n" +
    "    float prX = prUV.x / 0.4 + 0.5 * mod( prRow, 2.0 );\n" +
    "    vec2 prF = vec2( fract( prX ) * 0.4, fract( prUV.y / 0.2 ) * 0.2 );\n" +
    "    float prE = min( min( prF.x, 0.4 - prF.x ), min( prF.y, 0.2 - prF.y ) );\n" +
    "    float prJoint = ( 1.0 - smoothstep( 0.005, 0.013, prE ) ) * ( 1.0 - smoothstep( 7.0, 20.0, prDist ) );\n" +
    "    float prFace = smoothstep( 0.012, 0.05, prE );\n" +
    "    prShade *= ( 1.0 + ( prHash( vec2( floor( prX ), prRow ) ) - 0.5 ) * 0.07 ) * ( 1.0 - prJoint * 0.22 ) * ( 0.97 + 0.03 * prFace );\n" +
    "    if ( prInWing( prWPos ) > 0.5 ) {\n" +
    "      float prDado = 1.0 - step( 1.15, prYy );\n" +
    "      float prStripe = step( 1.15, prYy ) * ( 1.0 - step( 1.21, prYy ) );\n" +
    "      diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.62, 0.70, 0.74 ), prDado );\n" +
    "      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.20, 0.27, 0.34 ), prStripe * 0.85 );\n" +
    "    }\n" +
    "  }\n" +
    "  #endif\n" +
    "  #if PR_KIND == 2\n" +
    // a sealed floor: broad trowel clouding, darker along the walked lines
    "  prShade *= 0.94 + 0.12 * prNoise( prUV * 0.18 ) ;\n" +
    "  #endif\n" +
    "  diffuseColor.rgb *= prShade;\n" +
    "}\n" +
    "#endif\n";

  const FRAG_LIGHT =
    "if ( prOn > 0.5 && prInWing( prWPos ) > 0.5 ) {\n" +
    "  vec3 prN2 = normalize( prWNrm );\n" +
    "  #ifdef DOUBLE_SIDED\n  prN2 *= gl_FrontFacing ? 1.0 : -1.0;\n  #endif\n" +
    "  vec2 prMuv = vec2( ( prWPos.x + 16.0 ) / 32.0, ( prWPos.z + 44.0 ) / 36.0 );\n" +
    "  vec4 prMk = texture2D( prMask, prMuv );\n" +
    "  bool prUpper = prWPos.y > " + (FY - 0.1).toFixed(2) + ";\n" +
    // the hall pendants reach the tier everywhere outside a cell, and the ground
    // floor through the mask (under a deck: partly)
    "  float prVis = prMk.g > 0.5 ? 0.0 : ( prUpper ? 1.0 : prMk.r );\n" +
    "  reflectedLight.indirectDiffuse *= prIndoorAmb * ( prMk.g > 0.5 ? 0.8 : 1.0 );\n" +
    "  reflectedLight.directDiffuse *= prIndoorSun;\n  reflectedLight.directSpecular *= prIndoorSun;\n" +
    "  vec3 prSum = vec3( 0.0 );\n" +
    "  for ( int i = 0; i < " + MAX_LAMPS + "; i ++ ) {\n" +
    "    if ( i >= prLampN ) break;\n" +
    "    vec3 prD = prLamp[ i ].xyz - prWPos; float prD2 = dot( prD, prD );\n" +
    "    vec3 prDir = prD * inversesqrt( prD2 );\n" +
    "    float prNl = max( dot( prN2, prDir ), 0.0 ) * 0.8 + 0.2;\n" +
    // a pendant has a reflector: it throws DOWN, the lid over it stays dim
    "    float prThrow = 0.18 + 0.82 * pow( max( prDir.y, 0.0 ), prCone );\n" +
    "    prSum += prLampCol[ i ] * ( prLamp[ i ].w * prNl * prThrow / ( 1.0 + prD2 * prFall ) );\n" +
    "  }\n" +
    "  prSum *= prVis;\n" +
    "  if ( prMk.g > 0.5 ) {\n" +
        // the offset was baked at the TEXEL centre: measure from there, or the
    // fitting jumps a texel at a time and the ceiling shows 25 cm squares
    "    vec2 prTc = ( floor( vec2( prWPos.x + 16.0, prWPos.z + 44.0 ) / " + MASK_RES.toFixed(2) + " ) + 0.5 ) * " + MASK_RES.toFixed(2) + " - vec2( 16.0, 44.0 );\n" +
    "    vec3 prC = vec3( prTc.x + ( prMk.b - 0.5 ) * 6.0, ( prUpper ? " + FY.toFixed(2) + " : 0.0 ) + " + (CH - 0.2).toFixed(2) + ", prTc.y + ( prMk.a - 0.5 ) * 6.0 );\n" +
    "    vec3 prD = prC - prWPos; float prD2 = dot( prD, prD );\n" +
    "    float prNl = max( dot( prN2, prD * inversesqrt( prD2 + 1e-4 ) ), 0.0 ) * 0.75 + 0.25;\n" +
    "    prSum += vec3( 1.0, 0.86, 0.66 ) * ( prCellLamp * 1.25 * prNl / ( 1.0 + prD2 * 0.16 ) );\n" +
    "  }\n" +
    "  reflectedLight.directDiffuse += diffuseColor.rgb * prSum;\n" +
    "}\n";

  const KEY = "prisonlook-v1";
  function patch(mat, kind) {
    if (!mat || mat._prKind === kind && mat.onBeforeCompile === mat._prWrap) return false;
    if (!(mat.isMeshLambertMaterial || mat.isMeshStandardMaterial || mat.isMeshPhongMaterial)) return false;
    const prev = mat.onBeforeCompile && mat.onBeforeCompile !== mat._prWrap ? mat.onBeforeCompile : (mat._prPrev || null);
    const prevKey = mat._prPrevKey != null && prev === mat._prPrev ? mat._prPrevKey
      : (prev ? (mat.customProgramCacheKey && mat.customProgramCacheKey !== mat._prKeyFn ? mat.customProgramCacheKey() : prev.toString()) : "");
    const wrap = function (sh, renderer) {
      if (prev) prev.call(this, sh, renderer);
      const v = sh.vertexShader, f = sh.fragmentShader;
      if (v.indexOf("#include <common>") < 0 || v.indexOf("#include <project_vertex>") < 0 ||
          f.indexOf("#include <common>") < 0 || f.indexOf("#include <aomap_fragment>") < 0 ||
          f.indexOf("#include <color_fragment>") < 0 || v.indexOf("#include <defaultnormal_vertex>") < 0) return;
      for (const k in U) sh.uniforms[k] = U[k];
      sh.vertexShader = v.replace("#include <common>", "#include <common>\n" + VERT_PARS)
        .replace("#include <project_vertex>", "#include <project_vertex>\n" + VERT_MAIN);
      sh.fragmentShader = f.replace("#include <common>", "#include <common>\n#define PR_KIND " + kind + "\n" + FRAG_PARS)
        .replace("#include <color_fragment>", "#include <color_fragment>\n" + FRAG_SURFACE)
        .replace("#include <aomap_fragment>", "#include <aomap_fragment>\n" + FRAG_LIGHT);
    };
    const keyFn = function () { return prevKey + "|" + KEY + "|" + kind; };
    mat._prPrev = prev; mat._prPrevKey = prevKey;
    mat._prWrap = wrap; mat._prKeyFn = keyFn; mat._prKind = kind;
    mat.onBeforeCompile = wrap;
    mat.customProgramCacheKey = keyFn;
    mat.needsUpdate = true;
    return true;
  }

  /* ---- classification ---------------------------------------------------
     A masonry slab is a big, thin, unsaturated box: a wall or a partition.
     Everything else static is "plain" (mottle + foot grime + the light). */
  const _hsl = { h: 0, s: 0, l: 0 };
  function kindOf(o, m) {
    if (o.userData && o.userData.prKind != null) return o.userData.prKind;
    const g = o.geometry, p = g && g.parameters;
    if (p && p.width != null && p.height != null && p.depth != null && m.color && !m.vertexColors) {
      const sx = Math.abs(o.scale.x), sy = Math.abs(o.scale.y), sz = Math.abs(o.scale.z);
      const d = [p.width * sx, p.height * sy, p.depth * sz].sort((a, b) => a - b);
      m.color.getHSL(_hsl);
      if (d[0] <= 1.05 && d[1] >= 1.6 && d[2] >= 1.6 && _hsl.s < 0.22 && _hsl.l > 0.3) {
        // a slab lying flat is a floor/roof, standing up is a wall
        // (a textured wall already carries its own pattern: no block over it)
        return p.height * sy === d[0] ? 2 : (m.map ? 0 : 1);
      }
    }
    return 0;
  }

  // actors: every body carries its rig on a group the npc/guard/player records
  // own; their materials get the light (so a man in a cell is lit by the cell),
  // never the wall texture.
  function actorGroups() {
    const s = new Set();
    for (const list of [CBZ.npcs, CBZ.guards]) for (const a of (list || [])) if (a && a.group) s.add(a.group);
    if (CBZ.playerChar && CBZ.playerChar.group) s.add(CBZ.playerChar.group);
    return s;
  }

  let swept = 0;
  function sweep() {
    const root = CBZ.prisonRoot;
    if (!root) return 0;
    const actors = actorGroups();
    let n = 0;
    const visit = (o, actor) => {
      if (actors.has(o)) actor = true;
      if (o.isMesh && o.material && !o.isSkinnedMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m || m.transparent || m.isShaderMaterial || m.isMeshBasicMaterial) continue;
          if (m._prSkip) continue;
          const k = actor ? 3 : kindOf(o, m);
          // a shared material meets its strongest classification first; never
          // downgrade a slab's masonry because a small box shares its colour
          const want = m._prKind != null && m._prKind !== 0 && k === 0 ? m._prKind : k;
          if (patch(m, want)) n++;
        }
      }
      const ch = o.children;
      for (let i = 0; i < ch.length; i++) visit(ch[i], actor);
    };
    visit(root, false);
    if (CBZ.playerChar && CBZ.playerChar.group && CBZ.playerChar.group.parent !== root) visit(CBZ.playerChar.group, true);
    swept += n;
    return n;
  }

  /* ---- the lamps ------------------------------------------------------ */
  let lampsBuilt = false;
  const hall = [], night = [];
  function collectLamps() {
    const cages = CBZ.cellblockCages || [];
    for (const c of cages) hall.push({ x: c.x, y: 7.3, z: c.z });
    for (const s of [[0, -12], [0, -20], [0, -28], [0, -36], [-9.5, -30], [9.5, -30]]) night.push({ x: s[0], y: 8.2, z: s[1] });
    lampsBuilt = hall.length > 0;
  }
  const HALL_COL = new THREE.Color(1.0, 0.9, 0.74), NIGHT_COL = new THREE.Color(0.55, 0.68, 0.95);
  const TUNE = { hall: 2.2, night: 0.55, amb: 0.30, ambDay: 0.16, sun: 0.14 };
  let level = 1, nightLevel = 0;
  function drive(dt) {
    const g = CBZ.game;
    const on = !!(g && g.mode === "escape" && CBZ.prisonRoot && CBZ.prisonRoot.visible);
    U.prOn.value = on ? 1 : 0;
    if (!on) return;
    if (!lampsBuilt) collectLamps();
    const lamp = CBZ.ceilingLamp;
    const lit = !lamp || lamp.material.emissive.getHex() !== 0;
    const cut = !!(CBZ.breaker && CBZ.breaker.sabotaged);
    const k = Math.min(1, dt * 4);
    level += ((lit ? 1 : 0) - level) * k;
    nightLevel += ((!lit && !cut ? 1 : 0) - nightLevel) * k;
    let n = 0;
    for (const h of hall) {
      if (n >= MAX_LAMPS) break;
      U.prLamp.value[n].set(h.x, h.y, h.z, TUNE.hall * level);
      U.prLampCol.value[n].copy(HALL_COL);
      n++;
    }
    for (const h of night) {
      if (n >= MAX_LAMPS) break;
      U.prLamp.value[n].set(h.x, h.y, h.z, TUNE.night * nightLevel);
      U.prLampCol.value[n].copy(NIGHT_COL);
      n++;
    }
    U.prLampN.value = n;
    U.prCellLamp.value = level;
    // the sky's share through the barred windows: less still at night
    const day = CBZ.dayness == null ? 1 : Math.max(0, Math.min(1, CBZ.dayness * 2));
    U.prIndoorAmb.value = TUNE.amb + TUNE.ambDay * day;
    U.prIndoorSun.value = TUNE.sun;
  }

  let sweepT = 0, maskDone = false;
  CBZ.onAlways(95.5, function (dt) {
    drive(dt || 0.016);
    if (!U.prOn.value) return;
    if (!maskDone && CBZ.cellblock && CBZ.cellblock.cells && CBZ.cellblock.cells.length) { buildMask(); maskDone = true; }
    sweepT -= dt || 0.016;
    if (sweepT <= 0) { sweepT = 1.0; sweep(); }
  });

  CBZ.prisonLook = {
    uniforms: U,
    tune: TUNE,
    sweep: sweep,
    patch: patch,
    audit: function () {
      return { on: U.prOn.value, lamps: U.prLampN.value, hall: hall.length, patched: swept, mask: !!U.prMask.value,
        level: +level.toFixed(2), night: +nightLevel.toFixed(2) };
    },
  };
})();
