/* ============================================================
   world/treelod.js — ONE TREE AT EVERY DISTANCE.

   Owner, 2026-10-12, on the far crowns shipped the night before: trunkless
   half-leaf crowns are not the tree. The distance doctrine (GTA V, RDR2,
   Horizon, UE5 foliage) is: every far version is a faithful simplified copy
   of THAT object, and every switch is a dithered crossfade, never a cut.
   So a tree has three forms, and all three are the same tree:

     NEAR     the kit tree (world/vegetation.js): leaf-card crown, barked
              bole with limbs and roots. The streamed part (colliders, audit).
     MID      the same tree simplified (vegetationKit.midGeometry / midOf):
              every other card of the SAME crown grown to keep the
              silhouette, the same bole with fewer sides. Trunk included.
     IMPOSTOR past a few hundred metres: the NEAR tree rendered at load from
              8 x 8 directions over the upper hemisphere (hemi-octahedral
              layout) into an albedo atlas and a normal atlas. Far trees are
              one instanced camera-facing quad each, ONE DRAW PER VARIANT for
              the whole country; the vertex shader picks the frame for the
              eye's bearing, the fragment shader lights the baked normals
              with the scene's own sun and sky (a Phong material with no
              specular, i.e. per-pixel Lambert) and tints them with the very
              instance colours the near tree wears (crown tint and bark tint).

   DISTANCES are from the EYE (core/sight.js publishes it every frame), in
   3-D, so from a helicopter the ground under you is already far:
       near   0 .. MID              crossfade MID .. MID+FADE
       mid    MID .. IMP            crossfade IMP .. IMP+FADE
       imp    IMP .. the fog's reach
   A "solo" mid covers 0 .. IMP: the backcountry draws it where a chunk's
   near form is not planted yet, so a lagging streamer shows the simplified
   copy of the same trees, never bare ground and never a box.

   THE CROSSFADE. Per instance the vertex shader turns its distance into a
   keep window [lo, hi) of a screen-space dither (interleaved gradient
   noise); the two forms on either side of a seam use complementary windows,
   so across the FADE metres every pixel is drawn by exactly one of them.
   An instance whose window is empty is collapsed before any other vertex
   work (one early return), which is what keeps a 1.6 km near pool cheap
   once the eye has left it. core/sight.js is getting a shared dithered
   crossfade API from another lane; when it lands, LOD_GLSL below is the
   one place to switch over (fade() keeps its signature).

   CPU SIDE: every pool given a band is culled by it, cell by cell (core/
   farcull.js deals scenery pools into ~600 m cells; a cell entirely outside
   its band is not submitted at all), so the GPU never even sees a near cell
   2 km away from a helicopter.

   iOS: atlases are 512 px (256 for the small backdrop species), RGBA8,
   mipmapped; ~1.8 MB per variant. Context loss: the atlases live only on
   the GPU, so they are re-baked on webglcontextrestored.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;

  const R = (CBZ.treeLodRange = { mid: 200, imp: 420, fade: 32 });
  const FRAMES = 8;                       // frames per atlas side (hemi-octahedral)

  const eyeU = CBZ.sightU && CBZ.sightU.cbzSightEye ? CBZ.sightU.cbzSightEye : { value: new THREE.Vector3() };
  const U = {
    cbzSightEye: eyeU,
    // x: near->mid, y: mid->impostor, z: fade width, w: the eye's reach
    cbzLodD: { value: new THREE.Vector4(R.mid, R.imp, R.fade, 1e6) },
  };
  let impostorsOn = true;                 // false: no GL to bake with (node, a failed bake)

  /* ---- the band GLSL: the ONE place the dither lives ------------------- */
  const BANDS = {
    near: "vec2( cbzF1, 1.0 )",
    mid: "vec2( cbzF2, cbzF1 )",
    solo: "vec2( cbzF2, 1.0 )",
    imp: "vec2( 0.0, cbzF2 )",
  };
  const LOD_VS_PARS = "uniform vec3 cbzSightEye;\nuniform vec4 cbzLodD;\nvarying vec2 vCbzKeep;\n";
  function lodVsMain(band) {
    return "void main() {\n" +
      "#ifdef USE_INSTANCING\n" +
      "  vec3 cbzRoot = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;\n" +
      "#else\n" +
      "  vec3 cbzRoot = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;\n" +
      "#endif\n" +
      "  float cbzD = distance( cbzRoot, cbzSightEye );\n" +
      "  float cbzF1 = smoothstep( cbzLodD.x, cbzLodD.x + cbzLodD.z, cbzD );\n" +
      "  float cbzF2 = smoothstep( cbzLodD.y, cbzLodD.y + cbzLodD.z, cbzD );\n" +
      "  vCbzKeep = " + BANDS[band] + ";\n" +
      "  if ( vCbzKeep.y <= vCbzKeep.x || cbzD > cbzLodD.w ) { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); return; }\n";
  }
  const LOD_FS_PARS = "varying vec2 vCbzKeep;\n";
  const LOD_FS_MAIN = "void main() {\n" +
    "  float cbzDn = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );\n" +
    "  if ( cbzDn < vCbzKeep.x || cbzDn >= vCbzKeep.y ) discard;\n";
  function injectBand(sh, band) {
    sh.uniforms.cbzSightEye = U.cbzSightEye;
    sh.uniforms.cbzLodD = U.cbzLodD;
    sh.vertexShader = LOD_VS_PARS + sh.vertexShader.replace("void main() {", lodVsMain(band));
    sh.fragmentShader = LOD_FS_PARS + sh.fragmentShader.replace("void main() {", LOD_FS_MAIN);
  }

  /* ---- fade(material, band): the material a pool wears in a band ------- */
  const fadeCache = new Map();
  const BASE_OBC = THREE.Material.prototype.onBeforeCompile;
  function fade(mat, band) {
    if (!mat || !BANDS[band]) return mat;
    const key = mat.uuid + "|" + band;
    let m = fadeCache.get(key);
    if (m) return m;
    m = mat.clone();
    m.name = (mat.name || "vegetation") + " (" + band + ")";
    m._shared = true;
    m.userData = Object.assign({}, mat.userData, { cbzLodBand: band, cbzInstanceBounded: true });
    const prev = mat.onBeforeCompile !== BASE_OBC ? mat.onBeforeCompile : null;
    const prevKey = mat.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? mat.customProgramCacheKey : null;
    m.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : "") + "|treelod-" + band; };
    m.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      injectBand(sh, band);
    };
    fadeCache.set(key, m);
    return m;
  }

  /* ======================================================================
     THE BAKE — a tree, rendered from FRAMES x FRAMES bearings in ONE draw
     list: each frame's copy is pre-rotated so the frame's bearing looks
     down the orthographic camera's -Z, scaled to the tree's bounding sphere
     and laid into its cell of the grid. Two passes: albedo (map x vertex
     colour x material colour, linear, stored sRGB-encoded with coverage in
     alpha) and normal (the tree's own lighting normals in TREE space,
     octahedral-encoded in rg; b/a = which tint slot the pixel wears).
     Background is (0,0,0,0) and every drawn texel has alpha 1, so the atlas
     is premultiplied by coverage: the mips average colour with coverage and
     the impostor divides it back out, so no halo of clear colour bleeds in.
  ====================================================================== */
  // the frame grid: frame (i, j) -> its bearing (shared with the shader)
  function frameDir(i, j, out) {
    const ex = ((i + 0.5) / FRAMES) * 2 - 1, ey = ((j + 0.5) / FRAMES) * 2 - 1;
    const px = (ex + ey) * 0.5, pz = (ex - ey) * 0.5;
    return out.set(px, 1 - Math.abs(px) - Math.abs(pz), pz).normalize();
  }
  const BAKE_VS = [
    "uniform mat4 uPart;",
    "uniform mat3 uPartN;",
    "varying vec2 vUv;",
    "varying vec3 vCol;",
    "varying vec3 vN;",
    "varying vec3 vL;",
    "void main() {",
    "  vUv = uv;",
    "#ifdef USE_COLOR",
    "  vCol = color;",
    "#else",
    "  vCol = vec3( 1.0 );",
    "#endif",
    "  vN = normalize( uPartN * normal );",
    "  vL = ( uPart * vec4( position, 1.0 ) ).xyz;",
    "  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
    "}",
  ].join("\n");
  const BAKE_FS_HEAD = [
    "uniform sampler2D uMap;",
    "uniform float uUseMap;",
    "uniform float uMapSRGB;",
    "uniform vec3 uColor;",
    "uniform float uCut;",
    "uniform vec2 uSlot;",
    "varying vec2 vUv;",
    "varying vec3 vCol;",
    "varying vec3 vN;",
    "varying vec3 vL;",
    "vec4 cbzTex() {",
    "  if ( uUseMap < 0.5 ) return vec4( 1.0 );",
    "  vec4 t = texture2D( uMap, vUv );",
    "  return uMapSRGB > 0.5 ? sRGBToLinear( t ) : t;",
    "}",
    "vec3 cbzNormal() {",
    "#ifdef BAKE_FLAT",
    "  return normalize( cross( dFdx( vL ), dFdy( vL ) ) );",
    "#else",
    "  return normalize( vN );",
    "#endif",
    "}",
  ].join("\n");
  const BAKE_FS_ALBEDO = BAKE_FS_HEAD + "\n" + [
    "void main() {",
    "  vec4 t = cbzTex();",
    "  if ( t.a < uCut ) discard;",
    "  gl_FragColor = LinearTosRGB( vec4( uColor * vCol * t.rgb, 1.0 ) );",
    "}",
  ].join("\n");
  const BAKE_FS_NORMAL = BAKE_FS_HEAD + "\n" + [
    "void main() {",
    "  vec4 t = cbzTex();",
    "  if ( t.a < uCut ) discard;",
    "  vec3 n = cbzNormal();",
    "  n /= ( abs( n.x ) + abs( n.y ) + abs( n.z ) );",
    "  vec2 p = n.xz;",
    "  if ( n.y < 0.0 ) p = ( 1.0 - abs( p.yx ) ) * vec2( p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0 );",
    "  gl_FragColor = vec4( p * 0.5 + 0.5, uSlot );",
    "}",
  ].join("\n");

  function bakeMaterial(src, part, normalPass) {
    const map = src && src.map && src.map.isTexture ? src.map : null;
    const vc = !!(src && src.vertexColors && part.geometry.attributes.color);
    const flat = !!(src && src.flatShading);
    const cut = map && src.alphaTest > 0 ? src.alphaTest : 0;
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: map },
        uUseMap: { value: map ? 1 : 0 },
        uMapSRGB: { value: map && map.encoding === THREE.sRGBEncoding ? 1 : 0 },
        uColor: { value: src && src.color ? src.color.clone() : new THREE.Color(1, 1, 1) },
        uCut: { value: cut },
        uSlot: { value: new THREE.Vector2(part.slot === 0 ? 1 : 0, part.slot === 1 ? 1 : 0) },
        uPart: { value: part.matrix },
        uPartN: { value: new THREE.Matrix3().getNormalMatrix(part.matrix) },
      },
      vertexShader: BAKE_VS,
      fragmentShader: normalPass ? BAKE_FS_NORMAL : BAKE_FS_ALBEDO,
      vertexColors: vc,
      side: src && src.side != null ? src.side : THREE.FrontSide,
      defines: flat ? { BAKE_FLAT: 1 } : {},
    });
    m.extensions.derivatives = true;
    m.toneMapped = false;
    m.fog = false;
    return m;
  }

  function makeTarget(size) {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
      generateMipmaps: true, depthBuffer: true, stencilBuffer: false,
    });
    rt.texture.generateMipmaps = true;
    rt.texture.name = "cbz-impostor-atlas";
    return rt;
  }

  const bakes = new Map();                // key -> rec
  const _v = new THREE.Vector3(), _rt = new THREE.Vector3(), _up = new THREE.Vector3(), _fd = new THREE.Vector3();
  const _Y = new THREE.Vector3(0, 1, 0);
  const _cc = new THREE.Color();

  function renderBake(rec) {
    const r = CBZ.renderer;
    if (!r || !r.getContext) return false;
    const scene = new THREE.Scene();
    scene.autoUpdate = false;
    const cam = new THREE.OrthographicCamera(0, FRAMES * 2, FRAMES * 2, 0, 0.1, 20);
    cam.position.set(0, 0, 10);
    cam.updateMatrixWorld(true);
    const C = rec.center, Rr = rec.radius;
    const meshes = [];
    const albedoMats = rec.parts.map(function (p) { return bakeMaterial(p.material, p, false); });
    const normalMats = rec.parts.map(function (p) { return bakeMaterial(p.material, p, true); });
    const fm = new THREE.Matrix4();
    for (let i = 0; i < FRAMES; i++) {
      for (let j = 0; j < FRAMES; j++) {
        frameDir(i, j, _fd);
        _rt.crossVectors(_Y, _fd).normalize();
        _up.crossVectors(_fd, _rt);
        fm.set(
          _rt.x / Rr, _rt.y / Rr, _rt.z / Rr, -_rt.dot(C) / Rr + (2 * i + 1),
          _up.x / Rr, _up.y / Rr, _up.z / Rr, -_up.dot(C) / Rr + (2 * j + 1),
          _fd.x / Rr, _fd.y / Rr, _fd.z / Rr, -_fd.dot(C) / Rr,
          0, 0, 0, 1);
        for (let k = 0; k < rec.parts.length; k++) {
          const p = rec.parts[k];
          const mesh = new THREE.Mesh(p.geometry, albedoMats[k]);
          mesh.matrixAutoUpdate = false;
          mesh.matrix.multiplyMatrices(fm, p.matrix);
          mesh.matrixWorld.copy(mesh.matrix);
          mesh.frustumCulled = false;
          mesh.userData.k = k;
          scene.add(mesh);
          meshes.push(mesh);
        }
      }
    }
    const prevRT = r.getRenderTarget();
    const prevAlpha = r.getClearAlpha();
    r.getClearColor(_cc);
    const prevAuto = r.autoClear;
    const prevShadow = r.shadowMap && r.shadowMap.autoUpdate;
    let ok = true;
    try {
      if (r.shadowMap) r.shadowMap.autoUpdate = false;
      r.autoClear = true;
      r.setClearColor(0x000000, 0);
      r.setRenderTarget(rec.albedo);
      r.render(scene, cam);
      for (let m = 0; m < meshes.length; m++) meshes[m].material = normalMats[meshes[m].userData.k];
      r.setRenderTarget(rec.normal);
      r.render(scene, cam);
    } catch (e) {
      ok = false;
      console.error("[treelod] impostor bake failed", rec.key, e);
    } finally {
      r.setRenderTarget(prevRT);
      r.setClearColor(_cc, prevAlpha);
      r.autoClear = prevAuto;
      if (r.shadowMap) r.shadowMap.autoUpdate = prevShadow;
    }
    albedoMats.forEach(function (m) { m.dispose(); });
    normalMats.forEach(function (m) { m.dispose(); });
    return ok;
  }

  /* bake(key, parts, opts) -> rec | null
       parts: [{ geometry, material, matrix (THREE.Matrix4, part -> tree
       space; the tree's ground point is the origin, +Y up), slot }]
       slot 0 = wears the instance's tint A (instanceColor: the crown),
       1 = tint B (the bark), -1 = its own baked colour only. */
  function bake(key, parts, opts) {
    if (!impostorsOn) return null;
    if (bakes.has(key)) return bakes.get(key);
    const r = CBZ.renderer;
    if (!r || !r.getContext || typeof document === "undefined") { impostorsOn = false; publishRange(); return null; }
    opts = opts || {};
    // the tree's bounding sphere, from its real vertices
    const box = new THREE.Box3();
    parts.forEach(function (p) {
      const P = p.geometry.attributes.position;
      if (!p.geometry.attributes.normal) p.geometry.computeVertexNormals();
      for (let i = 0; i < P.count; i++) box.expandByPoint(_v.fromBufferAttribute(P, i).applyMatrix4(p.matrix));
    });
    const center = box.getCenter(new THREE.Vector3());
    let rad = 0;
    parts.forEach(function (p) {
      const P = p.geometry.attributes.position;
      for (let i = 0; i < P.count; i++) {
        const d = _v.fromBufferAttribute(P, i).applyMatrix4(p.matrix).distanceTo(center);
        if (d > rad) rad = d;
      }
    });
    rad *= 1.02;
    const size = opts.size || 512;
    const rec = {
      key: key, parts: parts.map(function (p) { return { geometry: p.geometry, material: p.material, matrix: p.matrix.clone(), slot: p.slot == null ? -1 : p.slot }; }),
      center: center, radius: rad, size: size,
      albedo: makeTarget(size), normal: makeTarget(size),
    };
    if (!renderBake(rec)) { rec.albedo.dispose(); rec.normal.dispose(); impostorsOn = false; publishRange(); return null; }
    bakes.set(key, rec);
    watchContext();
    return rec;
  }

  let watching = false;
  function watchContext() {
    if (watching) return;
    const cv = CBZ.renderer && CBZ.renderer.domElement;
    if (!cv || !cv.addEventListener) return;
    watching = true;
    // the atlases exist only on the GPU: a restored context gets them redrawn
    // (three rebuilds the render targets empty on first use)
    cv.addEventListener("webglcontextrestored", function () {
      setTimeout(function () { bakes.forEach(function (rec) { renderBake(rec); }); }, 0);
    }, false);
  }

  /* ======================================================================
     THE IMPOSTOR MATERIAL — MeshPhong (specular 0: per-pixel Lambert under
     the scene's own lights, fog and haze chunks) whose vertex stage builds
     the frame's quad and whose fragment stage reads the atlases.
  ====================================================================== */
  const IMP_VS_PARS = [
    "#define CBZ_FRAMES " + FRAMES.toFixed(1),
    "uniform vec3 cbzImpC;",
    "uniform float cbzImpR;",
    "attribute vec3 cbzTintB;",
    "varying vec2 vImpUv;",
    "varying vec3 vImpAx;",
    "varying vec3 vImpAy;",
    "varying vec3 vImpAz;",
    "varying vec3 vImpTintB;",
    "",
  ].join("\n");
  const IMP_VS_BEGIN = [
    // the instance's axes in world space (columns; mat3(mat4) is not GLSL ES 1.0)
    "  mat3 cbzM = mat3( ( modelMatrix * vec4( instanceMatrix[ 0 ].xyz, 0.0 ) ).xyz,",
    "                    ( modelMatrix * vec4( instanceMatrix[ 1 ].xyz, 0.0 ) ).xyz,",
    "                    ( modelMatrix * vec4( instanceMatrix[ 2 ].xyz, 0.0 ) ).xyz );",
    "  float cbzSx = max( length( cbzM[ 0 ] ), 1e-5 );",
    "  float cbzSy = max( length( cbzM[ 1 ] ), 1e-5 );",
    "  float cbzSz = max( length( cbzM[ 2 ] ), 1e-5 );",
    "  vec3 cbzWc = ( modelMatrix * instanceMatrix * vec4( cbzImpC, 1.0 ) ).xyz;",
    "  vec3 cbzTo = cameraPosition - cbzWc;",
    // the eye's bearing in TREE space (inverse of rotation x scale)
    "  vec3 cbzDl = vec3( dot( cbzTo, cbzM[ 0 ] ) / ( cbzSx * cbzSx ), dot( cbzTo, cbzM[ 1 ] ) / ( cbzSy * cbzSy ), dot( cbzTo, cbzM[ 2 ] ) / ( cbzSz * cbzSz ) );",
    "  cbzDl.y = max( cbzDl.y, 0.0 );",
    "  cbzDl = normalize( cbzDl + vec3( 0.0, 1e-4, 0.0 ) );",
    "  vec3 cbzA = cbzDl / ( abs( cbzDl.x ) + abs( cbzDl.y ) + abs( cbzDl.z ) );",
    "  vec2 cbzE = vec2( cbzA.x + cbzA.z, cbzA.x - cbzA.z );",
    "  vec2 cbzF = clamp( floor( ( cbzE * 0.5 + 0.5 ) * CBZ_FRAMES ), 0.0, CBZ_FRAMES - 1.0 );",
    "  vec2 cbzFe = ( ( cbzF + 0.5 ) / CBZ_FRAMES ) * 2.0 - 1.0;",
    "  vec2 cbzP = vec2( cbzFe.x + cbzFe.y, cbzFe.x - cbzFe.y ) * 0.5;",
    "  vec3 cbzFd = normalize( vec3( cbzP.x, 1.0 - abs( cbzP.x ) - abs( cbzP.y ), cbzP.y ) );",
    "  vec3 cbzRt = normalize( cross( vec3( 0.0, 1.0, 0.0 ), cbzFd ) );",
    "  vec3 cbzUp = cross( cbzFd, cbzRt );",
    "  vec3 transformed = cbzImpC + ( cbzRt * position.x + cbzUp * position.y ) * cbzImpR;",
    "  vImpUv = ( cbzF + position.xy * 0.5 + 0.5 ) / CBZ_FRAMES;",
    // normal transform: rotation x inverse scale (the inverse-transpose)
    "  vImpAx = cbzM[ 0 ] / ( cbzSx * cbzSx );",
    "  vImpAy = cbzM[ 1 ] / ( cbzSy * cbzSy );",
    "  vImpAz = cbzM[ 2 ] / ( cbzSz * cbzSz );",
    "  vImpTintB = cbzTintB;",
  ].join("\n");
  const IMP_FS_PARS = [
    "uniform sampler2D cbzImpAlb;",
    "uniform sampler2D cbzImpNrm;",
    "varying vec2 vImpUv;",
    "varying vec3 vImpAx;",
    "varying vec3 vImpAy;",
    "varying vec3 vImpAz;",
    "varying vec3 vImpTintB;",
    "",
  ].join("\n");
  const IMP_FS_MAP = [
    "  vec4 cbzAl = texture2D( cbzImpAlb, vImpUv );",
    "  if ( cbzAl.a < 0.5 ) discard;",
    "  vec4 cbzNr = texture2D( cbzImpNrm, vImpUv ) / cbzAl.a;",
    "  vec3 cbzAlb = sRGBToLinear( vec4( cbzAl.rgb / cbzAl.a, 1.0 ) ).rgb;",
    "#ifdef USE_COLOR",
    "  vec3 cbzTa = vColor;",
    "#else",
    "  vec3 cbzTa = vec3( 1.0 );",
    "#endif",
    "  float cbzWa = clamp( cbzNr.b, 0.0, 1.0 ), cbzWb = clamp( cbzNr.a, 0.0, 1.0 );",
    "  vec3 cbzTint = cbzTa * cbzWa + vImpTintB * cbzWb + vec3( max( 0.0, 1.0 - cbzWa - cbzWb ) );",
    "  diffuseColor.rgb *= cbzAlb * cbzTint;",
  ].join("\n");
  const IMP_FS_NORMAL = [
    "  vec2 cbzE2 = cbzNr.rg * 2.0 - 1.0;",
    "  vec3 cbzLn = vec3( cbzE2.x, 1.0 - abs( cbzE2.x ) - abs( cbzE2.y ), cbzE2.y );",
    "  if ( cbzLn.y < 0.0 ) cbzLn.xz = ( 1.0 - abs( cbzLn.zx ) ) * vec2( cbzLn.x >= 0.0 ? 1.0 : -1.0, cbzLn.z >= 0.0 ? 1.0 : -1.0 );",
    "  vec3 cbzWn = normalize( vImpAx * cbzLn.x + vImpAy * cbzLn.y + vImpAz * cbzLn.z );",
    "  vec3 normal = normalize( ( viewMatrix * vec4( cbzWn, 0.0 ) ).xyz );",
    "  vec3 geometryNormal = normal;",
    "  float faceDirection = 1.0;",
  ].join("\n");

  function impostorMaterial(rec) {
    if (rec.material) return rec.material;
    const m = new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0x000000, shininess: 1, side: THREE.FrontSide });
    m.name = "CBZ tree impostor " + rec.key;
    m._shared = true;
    m.userData.cbzLodBand = "imp";
    m.userData.cbzInstanceBounded = true;
    const uni = {
      cbzImpC: { value: rec.center },
      cbzImpR: { value: rec.radius },
      cbzImpAlb: { value: rec.albedo.texture },
      cbzImpNrm: { value: rec.normal.texture },
    };
    m.customProgramCacheKey = function () { return "cbz-tree-impostor"; };
    m.onBeforeCompile = function (sh) {
      for (const k in uni) sh.uniforms[k] = uni[k];
      injectBand(sh, "imp");
      sh.vertexShader = IMP_VS_PARS + sh.vertexShader.replace("#include <begin_vertex>", IMP_VS_BEGIN);
      sh.fragmentShader = IMP_FS_PARS + sh.fragmentShader
        .replace("#include <map_fragment>", IMP_FS_MAP)
        .replace("#include <color_fragment>", "")
        .replace("#include <normal_fragment_begin>", IMP_FS_NORMAL);
    };
    rec.material = m;
    return m;
  }

  /* impostors(rec, n, name) -> { mesh, set(i, matrix, tintA, tintB) }
     matrix: tree space -> world for instance i (its ground point, yaw and
     size); tintA / tintB: THREE.Color (crown tint, bark tint). */
  function impostors(rec, n, name) {
    if (!rec || n < 1) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const tintB = new Float32Array(n * 3);
    g.setAttribute("cbzTintB", new THREE.InstancedBufferAttribute(tintB, 3));
    // every corner the shader can emit lies inside this sphere (a quad of
    // half-size R about the centre, in any orientation)
    g.boundingSphere = new THREE.Sphere(rec.center.clone(), rec.radius * 1.415);
    g.boundingBox = new THREE.Box3().setFromCenterAndSize(rec.center, new THREE.Vector3(1, 1, 1).multiplyScalar(rec.radius * 2.83));
    const mesh = new THREE.InstancedMesh(g, impostorMaterial(rec), n);
    const tintA = new Float32Array(n * 3);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(tintA, 3);
    mesh.name = name || ("tree-impostors-" + rec.key);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;            // core/instcull.js bounds it by its instances
    mesh.matrixAutoUpdate = false;
    // HORIZON, never parked (core/slice.js), and not dealt into cells by
    // core/farcull.js (it carries a per-instance attribute cells don't copy;
    // it is one draw for the whole country by design)
    mesh.userData.farLod = "impostor";
    mesh.userData.treeImpostor = rec.key;
    // the quad a ray would meet is not where the shader draws it, and a tree
    // past the impostor range is nothing a bullet or a camera test should hit
    mesh.raycast = function () {};
    let used = 0;
    return {
      mesh: mesh,
      set: function (i, m4, a, b) {
        mesh.setMatrixAt(i, m4);
        tintA[i * 3] = a.r; tintA[i * 3 + 1] = a.g; tintA[i * 3 + 2] = a.b;
        if (b) { tintB[i * 3] = b.r; tintB[i * 3 + 1] = b.g; tintB[i * 3 + 2] = b.b; }
        if (i + 1 > used) used = i + 1;
      },
      finish: function (root) {
        mesh.count = used;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        g.attributes.cbzTintB.needsUpdate = true;
        if (root && used) root.add(mesh);
        return used ? mesh : null;
      },
    };
  }

  /* ======================================================================
     THE BAND CULL — pools, or the cells core/farcull.js deals them into,
     that lie wholly outside their band are not submitted at all.
  ====================================================================== */
  const tracked = [];
  function track(mesh, band) {
    if (!mesh) return mesh;
    if (band) mesh.userData.cbzLodBand = band;
    if (mesh.userData._cbzLodTracked) return mesh;
    mesh.userData._cbzLodTracked = true;
    tracked.push({ m: mesh, seen: performance.now(), sph: null, sv: -1 });
    return mesh;
  }
  function setBand(mesh, band, baseMat) {
    if (!mesh || mesh.userData.cbzLodBand === band) return;
    mesh.userData.cbzLodBand = band;
    const mat = fade(baseMat || mesh.userData.cbzLodBase || mesh.material, band);
    mesh.material = mat;
    const cells = mesh.userData.cells;
    if (cells) for (let k = 0; k < cells.length; k++) cells[k].material = mat;
  }
  function poolSphere(e) {
    const m = e.m, a = m.instanceMatrix && m.instanceMatrix.array;
    if (!a) return null;
    if (e.sph && e.sv === m.instanceMatrix.version) return e.sph;
    const g = m.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const gr = g.boundingSphere ? g.boundingSphere.radius : 1;
    let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9, smax = 0;
    for (let i = 0; i < m.count; i++) {
      const q = i * 16, x = a[q + 12], y = a[q + 13], z = a[q + 14];
      if (x < mnx) mnx = x; if (x > mxx) mxx = x;
      if (y < mny) mny = y; if (y > mxy) mxy = y;
      if (z < mnz) mnz = z; if (z > mxz) mxz = z;
      const s = Math.max(Math.abs(a[q]) + Math.abs(a[q + 1]) + Math.abs(a[q + 2]), Math.abs(a[q + 4]) + Math.abs(a[q + 5]) + Math.abs(a[q + 6]));
      if (s > smax) smax = s;
    }
    e.sv = m.instanceMatrix.version;
    e.sph = { x: (mnx + mxx) / 2, y: (mny + mxy) / 2, z: (mnz + mxz) / 2,
      r: Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) / 2 + gr * smax };
    return e.sph;
  }
  function bandRange(band, far) {
    const W = R.fade + 24;               // the fade plus a margin for a frame of travel
    const imp = impostorsOn ? R.imp : 1e6;
    switch (band) {
      case "near": return [0, R.mid + W];
      case "mid": return [R.mid - 24, imp + W];
      case "solo": return [0, imp + W];
      case "imp": return [imp - 24, far + 60];
      default: return [0, 1e9];
    }
  }
  function inBand(x, y, z, r, lo, hi, e) {
    const d = Math.hypot(x - e.x, y - e.y, z - e.z);
    return d - r <= hi && d + r >= lo;
  }
  // (no impostors: 1e6, not 1e9 -- 1e9 + fade is 1e9 in a float32 uniform,
  // and smoothstep with equal edges is undefined)
  function publishRange() {
    U.cbzLodD.value.set(R.mid, impostorsOn ? R.imp : 1e6, R.fade, U.cbzLodD.value.w);
  }
  let lastEye = null;
  CBZ.onAlways && CBZ.onAlways(97.3, function () {
    const SG = CBZ.sight ? CBZ.sight() : null;
    if (!SG) return;
    U.cbzLodD.value.w = SG.reach + 60;
    if (!tracked.length) return;
    const e = { x: SG.x, y: SG.y, z: SG.z };
    const now = performance.now();
    if (lastEye && Math.abs(e.x - lastEye.x) + Math.abs(e.y - lastEye.y) + Math.abs(e.z - lastEye.z) < 4 && now - lastEye.t < 250) return;
    lastEye = { x: e.x, y: e.y, z: e.z, t: now };
    for (let i = tracked.length - 1; i >= 0; i--) {
      const t = tracked[i], m = t.m;
      if (!m.parent) {
        // freed or parked by the streamer: let it go after a while (whoever
        // puts it back tracks it again; untracked it is still exact, just
        // submitted whole)
        if (now - t.seen > 30000) { m.userData._cbzLodTracked = false; tracked.splice(i, 1); }
        continue;
      }
      t.seen = now;
      const rg = bandRange(m.userData.cbzLodBand, SG.reach);
      const cells = m.userData.cells;
      if (cells && cells.length) {
        if (!m.visible) m.visible = true;
        for (let k = 0; k < cells.length; k++) {
          const c = cells[k], s = c.userData.sphere;
          if (!s) continue;
          const v = inBand(s.center.x, s.center.y, s.center.z, s.radius, rg[0], rg[1], e);
          if (c.visible !== v) c.visible = v;
        }
      } else {
        const s = poolSphere(t);
        if (!s) continue;
        const v = inBand(s.x, s.y, s.z, s.r, rg[0], rg[1], e);
        if (m.visible !== v) m.visible = v;
      }
    }
  });

  /* ======================================================================
     adopt(spec) — a whole-world scatter of trees (built at boot, never
     streamed: the backdrop forest, the resort pines) gets the three forms.
       spec.parts: [{ im, slot, mid }]  InstancedMeshes that make up ONE tree
         species, instance i of every part = the same tree. slot as in
         bake(); mid: an explicit mid geometry, else vegetationKit.midOf.
       spec.root: where the new pools go. spec.name, spec.size (atlas px).
     The originals keep their matrices, colours, colliders and audit; they
     become the near form. A mid pool is made only for parts that have a
     simplified copy; a species with none goes near -> impostor directly.
  ====================================================================== */
  function yawOf(a, q) { return Math.atan2(-a[q + 2], a[q]); }
  function adopt(spec) {
    const parts = (spec.parts || []).filter(function (p) { return p && p.im && p.im.count > 0; });
    if (!parts.length) return null;
    const n = parts[0].im.count;
    if (parts.some(function (p) { return p.im.count !== n; })) return null;
    const VK = CBZ.vegetationKit;
    // mids
    const mids = parts.map(function (p) {
      const g = p.mid || (VK && VK.midOf ? VK.midOf(p.im.geometry) : null);
      return g && g !== p.im.geometry ? g : null;
    });
    const out = { near: [], mid: [], imp: null };
    parts.forEach(function (p, k) {
      // a part with a simplified copy hands over to it at MID; a part
      // without one (a bole, a cone stack: already cheap) is its own mid
      const band = mids[k] ? "near" : "solo";
      p.im.userData.cbzLodBase = p.im.material;
      p.im.material = fade(p.im.material, band);
      track(p.im, band);
      out.near.push(p.im);
      if (!mids[k]) return;
      const mm = new THREE.InstancedMesh(mids[k], fade(p.im.userData.cbzLodBase, "mid"), n);
      mm.instanceMatrix.array.set(p.im.instanceMatrix.array.subarray(0, n * 16));
      if (p.im.instanceColor) mm.instanceColor = new THREE.InstancedBufferAttribute(p.im.instanceColor.array.slice(0, n * 3), 3);
      mm.count = p.im.count;
      mm.name = (p.im.name || spec.name || "trees") + "-mid";
      mm.receiveShadow = p.im.receiveShadow;
      mm.castShadow = false;
      mm.frustumCulled = false;
      mm.matrixAutoUpdate = false;
      mm.userData.vegetationLayer = (p.im.userData.vegetationLayer || "trees") + "-mid";
      mm.userData.sceneryScale = true;
      mm.userData.cbzLodBase = p.im.userData.cbzLodBase;
      mm.instanceMatrix.needsUpdate = true;
      (spec.root || p.im.parent).add(mm);
      track(mm, "mid");
      out.mid.push(mm);
    });
    // the impostor: bake the median tree, size every instance against it
    const tops = new Float32Array(n), wides = new Float32Array(n);
    const base = parts[0].im, ba = base.instanceMatrix.array;
    parts.forEach(function (p) {
      const g = p.im.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox, a = p.im.instanceMatrix.array;
      const gr = Math.max(Math.abs(bb.min.x), bb.max.x, Math.abs(bb.min.z), bb.max.z);
      for (let i = 0; i < n; i++) {
        const q = i * 16;
        const sy = Math.hypot(a[q + 4], a[q + 5], a[q + 6]);
        const sxz = Math.max(Math.hypot(a[q], a[q + 1], a[q + 2]), Math.hypot(a[q + 8], a[q + 9], a[q + 10]));
        const top = a[q + 13] + sy * bb.max.y - ba[q + 13];
        if (top > tops[i]) tops[i] = top;
        const w = sxz * gr;
        if (w > wides[i]) wides[i] = w;
      }
    });
    const order = Array.from({ length: n }, function (_, i) { return i; }).sort(function (x, y) { return tops[x] - tops[y]; });
    const i0 = order[(n / 2) | 0];
    let h0 = Math.max(0.1, tops[i0]), w0 = Math.max(0.05, wides[i0]);
    const q0 = i0 * 16;
    const F0 = new THREE.Matrix4().makeRotationY(yawOf(ba, q0)).setPosition(ba[q0 + 12], ba[q0 + 13], ba[q0 + 14]);
    const F0i = new THREE.Matrix4().copy(F0).invert();
    const m4 = new THREE.Matrix4();
    const bakeParts = parts.map(function (p) {
      p.im.getMatrixAt(i0, m4);
      return { geometry: p.im.geometry, material: p.im.userData.cbzLodBase, matrix: new THREE.Matrix4().multiplyMatrices(F0i, m4), slot: p.slot };
    });
    const rec = bake(spec.key || spec.name || ("adopt-" + (base.name || base.uuid)), bakeParts, { size: spec.size || 256 });
    if (!rec) {
      // no impostor: the last form carries on to the fog
      return out;
    }
    // a bake shared by several scatters of one species (the snow belts) is
    // sized against the tree it was baked from, not this scatter's median
    if (rec.adoptH0) { h0 = rec.adoptH0; w0 = rec.adoptW0; } else { rec.adoptH0 = h0; rec.adoptW0 = w0; }
    const pool = impostors(rec, n, (spec.name || base.name || "trees") + "-impostors");
    const ca = new THREE.Color(), cb = new THREE.Color();
    const slotA = parts.find(function (p) { return p.slot === 0 && p.im.instanceColor; });
    const slotB = parts.find(function (p) { return p.slot === 1 && p.im.instanceColor; });
    const S = new THREE.Vector3(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), Yax = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const q = i * 16;
      const s = wides[i] / w0, sy = Math.max(0.05, tops[i]) / h0;
      S.set(s, sy, s);
      Q.setFromAxisAngle(Yax, yawOf(ba, q));
      P.set(ba[q + 12], ba[q + 13], ba[q + 14]);
      m4.compose(P, Q, S);
      if (slotA) ca.fromArray(slotA.im.instanceColor.array, i * 3); else ca.setRGB(1, 1, 1);
      if (slotB) cb.fromArray(slotB.im.instanceColor.array, i * 3); else cb.setRGB(1, 1, 1);
      pool.set(i, m4, ca, cb);
    }
    out.imp = pool.finish(spec.root || base.parent);
    if (out.imp) {
      out.imp.count = base.count;
      track(out.imp, "imp");
    }
    return out;
  }

  CBZ.treeLod = {
    range: R,
    uniforms: U,
    fade: fade,
    setBand: setBand,
    track: track,
    bake: bake,
    impostors: impostors,
    adopt: adopt,
    available: function () { return impostorsOn && !!(CBZ.renderer && CBZ.renderer.getContext); },
    stats: function () {
      let pools = 0, cells = 0, cellsOn = 0;
      tracked.forEach(function (t) {
        pools++;
        const c = t.m.userData.cells;
        if (c) { cells += c.length; c.forEach(function (x) { if (x.visible) cellsOn++; }); }
      });
      return { impostors: impostorsOn, bakes: bakes.size, pools: pools, cells: cells, cellsOn: cellsOn };
    },
  };
})();
