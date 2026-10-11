"use strict";
/* src/battle/arenas/erg.js — NPC War: THE ERG: open dunes / snow / fields.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ THE ERG
   OPEN DUNES USED TO BE A TABLECLOTH. The desert world's terrain is one
   15 km plane at 63 m a cell, and its dune field is a 420 m fbm swell, so
   the whole ±200 m window the war is fought in was four flat facets lit per
   vertex: pale sand with no crest, no slip face, no shadow and no ripple.
   The owner's favourite map looked like the inside of a lampshade.

   Real dunes are a WIND shape: a long gentle windward climb (~8°), a sharp
   crest, and a steep slip face (~30°) falling off it, repeated every hundred
   metres or so with the crest line wandering. That shape is a function, and
   this page already stands everything on a function — so the war window
   gets a transverse dune field ADDED to the desert's own heightAt, faded out
   to nothing at the window's edge so it meets the world's terrain exactly.
   The men, the sight lines (terrainLos), the camera floor and the bombs all
   read MAP.groundAt, so the crests are real cover, not paint.

   And it is drawn at the resolution it deserves: a 1.2 km skin at 4 m a
   cell over the window, with the world's coarse plane discarded underneath
   it (a shader test, so the two can never fight for the depth buffer), a
   low sun that throws the slip faces into shadow, and wind ripples in the
   sand's own shader that fade out before they can shimmer. */
const DUNE = { on: false, cx: 0, cz: 0, R0: 420, R1: 585, half: 600,
  wx: Math.cos(0.42), wz: Math.sin(0.42), lam: 92, skin: null, pal: null };
/* WHAT THE ERG IS WEARING. Sand is the original; snow and grass are the same
   crests under another surface. `amp` softens the folds (fields roll, they
   do not slip-face), `tint` is what the desert world's far terrain is worked
   toward so the horizon matches the window, `tuft` is the low growth. */
const ERG_PAL = {
  sand:  { sand: 0xc4935a, crest: 0xd8aa6c, trough: 0xa77a48, slip: 0xb07c46, pan: 0xb49a78, amp: 1, tint: null, tuft: 0x9a8a5a, tufts: 900 },
  snow:  { sand: 0xe6ebef, crest: 0xf5f7f9, trough: 0xcdd6de, slip: 0xb9c6d3, pan: 0xd3d8dc, amp: 1, tint: [0.88, 0.91, 0.94], tuft: 0x857e6c, tufts: 260 },
  grass: { sand: 0x6c8744, crest: 0x84a053, trough: 0x58713a, slip: 0x627a3e, pan: 0x8b8758, amp: 0.62, tint: [0.36, 0.45, 0.25], tuft: 0x5b7832, tufts: 1600 },
};
function hash2(ix, iz, salt) {
  let h = (ix * 374761393 + iz * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vn2(x, z, salt) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, salt), b = hash2(ix + 1, iz, salt);
  const c = hash2(ix, iz + 1, salt), d = hash2(ix + 1, iz + 1, salt);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
function duneWeight(x, z) {
  const r = Math.max(Math.abs(x - DUNE.cx), Math.abs(z - DUNE.cz));
  if (r <= DUNE.R0) return 1;
  if (r >= DUNE.R1) return 0;
  const t = (r - DUNE.R0) / (DUNE.R1 - DUNE.R0);
  return 1 - t * t * (3 - 2 * t);
}
function duneDetail(x, z) {
  if (!DUNE.on) return 0;
  const w = duneWeight(x, z);
  if (w <= 0) return 0;
  const u = x * DUNE.wx + z * DUNE.wz;           // along the wind
  const v = -x * DUNE.wz + z * DUNE.wx;          // along the crest
  // the crest line wanders: long bends plus a short sinuosity
  const warp = (vn2(v * 0.009, u * 0.003, 17) - 0.5) * 70 + (vn2(v * 0.034, u * 0.011, 29) - 0.5) * 16;
  const p = (u + warp) / DUNE.lam;
  const f = p - Math.floor(p);
  // windward climb over 0..0.74 (eased into the crest), slip face 0.74..1 (~33°, sand at rest)
  let s;
  if (f < 0.74) { const t = f / 0.74; s = t * t * (1.7 - 0.7 * t); }
  else { const t = (f - 0.74) / 0.26; s = 1 - t * t * (3 - 2 * t); }
  // crests are not all one height, and some die out into flat pan
  const amp = (2 + 6.4 * vn2(u * 0.0065, v * 0.0045, 41)) * (DUNE.pal ? DUNE.pal.amp : 1);
  // a small cross-ripple so no slope is a perfect plane
  const lump = (vn2(x * 0.045, z * 0.045, 53) - 0.5) * 1.1;
  return ((s - 0.45) * amp + lump) * w;
}
function duneSkin(world) {
  const N = 300, S = DUNE.half * 2, cell = S / N;
  const g = new THREE.PlaneGeometry(S, S, N, N);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, n = pos.count;
  const col = new Float32Array(n * 3);
  const PAL = DUNE.pal || ERG_PAL.sand;
  const sand = new THREE.Color(PAL.sand), crest = new THREE.Color(PAL.crest),
    trough = new THREE.Color(PAL.trough), slip = new THREE.Color(PAL.slip), pan = new THREE.Color(PAL.pan);
  const tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i) + DUNE.cx, z = pos.getZ(i) + DUNE.cz;
    const y = MAP_GROUND(x, z);
    pos.setY(i, y);
    // what kind of sand this is: height in the local dune, and which face
    const d = duneDetail(x, z);
    const gx = MAP_GROUND(x + 1.5, z) - MAP_GROUND(x - 1.5, z);
    const gz = MAP_GROUND(x, z + 1.5) - MAP_GROUND(x, z - 1.5);
    const lee = -(gx * DUNE.wx + gz * DUNE.wz) / 3;          // >0 on the slip face
    tmp.copy(sand);
    tmp.lerp(d > 0 ? crest : trough, Math.min(1, Math.abs(d) / 5) * 0.55);
    if (lee > 0.18) tmp.lerp(slip, Math.min(1, (lee - 0.18) * 2.2) * 0.5);
    // hard pan between the dunes: grey-tan flats where the crest died out
    const flat = vn2(x * 0.012, z * 0.012, 61);
    if (flat > 0.62 && d < 0.5) tmp.lerp(pan, Math.min(1, (flat - 0.62) * 4) * 0.45);
    tmp.multiplyScalar(0.95 + vn2(x * 0.21, z * 0.21, 71) * 0.08);
    // and blend to the world's own vertex colour at the rim so the seam is gone
    const w = duneWeight(x, z);
    if (w < 1) tmp.lerp(sand, 1 - w);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = function (sh) {
    sh.uniforms.uWind = { value: new THREE.Vector2(DUNE.wx, DUNE.wz) };
    sh.vertexShader = "varying vec3 vSandW;\n" + sh.vertexShader.replace("#include <project_vertex>",
      "#include <project_vertex>\nvSandW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = "varying vec3 vSandW;\nuniform vec2 uWind;\n" + sh.fragmentShader.replace("#include <color_fragment>",
      "#include <color_fragment>\n" +
      "{ float dist = length(vSandW - cameraPosition);\n" +
      "  float fade = 1.0 - smoothstep(18.0, 95.0, dist);\n" +
      "  vec2 q = vec2(dot(vSandW.xz, uWind), dot(vSandW.xz, vec2(-uWind.y, uWind.x)));\n" +
      "  float rip = sin(q.x * 6.3 + sin(q.y * 0.41) * 2.2 + sin(q.y * 1.3 + q.x * 0.35) * 0.7);\n" +
      "  rip = rip * 0.5 + 0.5; rip = rip * rip;\n" +
      "  float grain = fract(sin(dot(floor(vSandW.xz * 3.0), vec2(12.9898, 78.233))) * 43758.5453);\n" +
      "  diffuseColor.rgb *= 1.0 + ((rip - 0.35) * 0.09 + (grain - 0.5) * 0.035) * fade;\n" +
      "  float far = smoothstep(120.0, 700.0, dist);\n" +
      "  diffuseColor.rgb *= 1.0 - far * 0.05; }");
  };
  const m = new THREE.Mesh(g, mat);
  m.position.set(DUNE.cx, 0, DUNE.cz);
  m.receiveShadow = true; m.castShadow = true;
  m.userData.terrain = true; m.userData.dynamic = true;
  m.name = "duneSkin";
  CBZ.scene.add(m);
  DUNE.skin = m;
  // the world's own plane gives up the window, per fragment
  const T = world && world.terrain;
  if (T && T.material) {
    T.userData.dynamic = true;
    T.material.onBeforeCompile = function (sh) {
      sh.uniforms.uHole = { value: new THREE.Vector3(DUNE.cx, DUNE.cz, DUNE.half - 4) };
      sh.vertexShader = "varying vec3 vHoleW;\n" + sh.vertexShader.replace("#include <project_vertex>",
        "#include <project_vertex>\nvHoleW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = "varying vec3 vHoleW;\nuniform vec3 uHole;\n" + sh.fragmentShader.replace("void main() {",
        "void main() {\n if (abs(vHoleW.x - uHole.x) < uHole.z && abs(vHoleW.z - uHole.y) < uHole.z) discard;")
        // the erg beyond the skin wears the skin's sand, so the rim has no seam
        // (the salt pan and the mountains past the dune ring keep their own)
        .replace("#include <color_fragment>", "#include <color_fragment>\n" +
          "diffuseColor.rgb *= mix(vec3(0.9, 0.78, 0.65), vec3(1.0), smoothstep(2650.0, 2900.0, length(vHoleW.xz)));" +
          // snow and fields: the basin wears the window's ground out to the ring
          (PAL.tint ? "\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(" + PAL.tint.map(function (v) { return v.toFixed(3); }).join(",") +
            "), 0.82 * (1.0 - smoothstep(2650.0, 2900.0, length(vHoleW.xz))));" : ""));
    };
    T.material.needsUpdate = true;
  }
  // THE CITY LEAVES THE HORIZON. The desert world is a basin with a 200-tower
  // downtown in the middle of it, and from the erg every low shot framed a
  // grey block skyline behind the war — a war in open dunes, fought in front
  // of an office park. Everything of the downtown is taken off the scene
  // (its far colliders are two kilometres from any man and stay harmless);
  // the terrain, the inland sea and the desert's own rocks, scrub and mesas
  // stay, and the mountains close the view the way a basin should.
  if (world && world.root) {
    const drop = [];
    world.root.children.forEach(function (o) {
      if (o.name === "terrain" || o.name === "sea") return;
      if (o.isInstancedMesh && o.count > 0) {
        const mm = new THREE.Matrix4(), pp = new THREE.Vector3();
        o.getMatrixAt(0, mm); pp.setFromMatrixPosition(mm);
        if (Math.hypot(pp.x, pp.z) > 1100) return;     // desert dress, out on the erg
      }
      drop.push(o);
    });
    drop.forEach(function (o) { world.root.remove(o); });
  }
  reseatDesertDress(world);
}
/* THE DRESS ON THE NEW SAND. The desert's rocks and scrub were seated on the
   coarse heightAt; inside the window the ground moved under them by up to
   four metres, so each one is re-seated on the ground it actually stands on.
   And the scrub was a single five-sided cone per bush — the green triangles
   in every shot. Inside the window those are retired and replaced by dry
   grass tufts (a spray of thin blades, instanced) that read as a desert
   plant from the lens height this page shoots from. The rocks get a real
   rock shape: a lumpy, flattened, half-buried stone instead of a d12. */
/* A ROCK IS NOT A D12, AND NOT A FACETED BALL EITHER. r128's icosahedron
   is non-indexed, so displacing it and asking for normals gave every face
   its own flat normal: a lumpy disco ball in one flat colour. The shell is
   welded first (smooth normals across the lumps), pushed out by noise at
   three scales plus bedding ledges, and PAINTED per vertex by a caller
   (sandstone strata and desert varnish in the erg, encrusting growth and
   silt on the reef). */
function weldGeo(g) {
  const p = g.attributes.position, seen = new Map(), idx = [], pos = [];
  for (let i = 0; i < p.count; i++) {
    const k = Math.round(p.getX(i) * 1e4) + "," + Math.round(p.getY(i) * 1e4) + "," + Math.round(p.getZ(i) * 1e4);
    let j = seen.get(k);
    if (j === undefined) { j = pos.length / 3; pos.push(p.getX(i), p.getY(i), p.getZ(i)); seen.set(k, j); }
    idx.push(j);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}
function lumpRock(detail, salt, flat, paint) {
  const g = weldGeo(new THREE.IcosahedronGeometry(1, detail));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let k = 0.74 + vn2(x * 1.9 + salt, z * 1.9 + y * 1.6, 83) * 0.38 + vn2(x * 4.7 + y, y * 4.7 + z + salt, 89) * 0.13 +
      vn2(x * 11 + salt, z * 11 + y * 7, 97) * 0.045;
    k *= 1 + 0.035 * Math.sin(y * 10 + vn2(x * 2 + salt, z * 2, 7) * 3);      // bedding ledges
    p.setXYZ(i, x * k, y * k * (y > 0 ? flat : 1), z * k);
  }
  g.computeVertexNormals();
  const n = g.attributes.normal, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = paint(p.getX(i), p.getY(i), p.getZ(i), n.getY(i));
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}
function rockGeometry() {
  return lumpRock(2, 0, 0.72, function (x, y, z, ny) {        // 260 instances: 320 tris each
    const band = Math.sin(y * 7.5 + vn2(x * 1.3, z * 1.3, 5) * 2.4);
    let r = 0.6 + band * 0.045, g = 0.47 + band * 0.03, b = 0.36 + band * 0.02;
    if (band > 0.55) { r += 0.05; g -= 0.01; }                        // an iron-red bed
    const v = 0.9 + vn2(x * 6, z * 6 + y * 3, 13) * 0.2;
    r *= v; g *= v; b *= v;
    if (ny > 0.55) { const k = (ny - 0.55) * 0.5; r -= r * k; g -= g * k; b -= b * k * 0.8; }   // desert varnish
    const dust = Math.max(0, Math.min(1, (-y - 0.05) * 2.2));         // sand banked at the foot
    r += (0.77 - r) * dust; g += (0.58 - g) * dust; b += (0.36 - b) * dust;
    return [r, g, b];
  });
}
function tuftGeometry() {
  const parts = [];
  for (let b = 0; b < 9; b++) {
    const c = new THREE.ConeGeometry(0.035, 0.55 + hash2(b, 1, 7) * 0.5, 3, 1);
    c.translate(0, (0.55 + hash2(b, 1, 7) * 0.5) / 2, 0);
    const a = b * 2.39996, lean = 0.25 + hash2(b, 2, 7) * 0.5;
    c.rotateX(Math.cos(a) * lean); c.rotateZ(Math.sin(a) * lean);
    c.translate(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08);
    parts.push(c);
  }
  // merge by hand (r128 BufferGeometryUtils is not on this page)
  const flat = parts.map(function (c) { return c.index ? c.toNonIndexed() : c; });
  let total = 0; flat.forEach(function (c) { total += c.attributes.position.count; });
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  let o = 0;
  flat.forEach(function (ci) {
    pos.set(ci.attributes.position.array, o * 3); nor.set(ci.attributes.normal.array, o * 3);
    o += ci.attributes.position.count;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos.slice(0, o * 3), 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor.slice(0, o * 3), 3));
  return out;
}
function reseatDesertDress(world) {
  if (!world || !world.root) return;
  const mtx = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  world.root.traverse(function (o) {
    if (!o.isInstancedMesh) return;
    const geoT = o.geometry && o.geometry.type;
    const isRock = geoT === "DodecahedronGeometry" || geoT === "DodecahedronBufferGeometry";
    const isScrub = geoT === "ConeGeometry" || geoT === "ConeBufferGeometry";
    if (!isRock && !isScrub) return;
    if (isRock) {
      o.geometry = rockGeometry();
      o.material = new THREE.MeshLambertMaterial({ vertexColors: true });
      o.receiveShadow = true;
    }
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, mtx); mtx.decompose(p, q, s);
      const w = duneWeight(p.x, p.z);
      if (isScrub) {
        if (w > 0) o.setMatrixAt(i, zero);      // the cones leave the window
        continue;
      }
      // every rock: sunk a third into its sand, which is how stone sits in an erg
      p.y = MAP_GROUND(p.x, p.z) + s.y * 0.12;
      mtx.compose(p, q, s); o.setMatrixAt(i, mtx);
    }
    o.instanceMatrix.needsUpdate = true;
  });
  // dry grass, only where a lens can see it
  const TP = DUNE.pal || ERG_PAL.sand;
  const N = TP.tufts || 900, tuft = new THREE.InstancedMesh(tuftGeometry(),
    new THREE.MeshLambertMaterial({ color: TP.tuft }), N);
  let k = 0;
  for (let i = 0; i < N * 3 && k < N; i++) {
    const x = DUNE.cx + (hash2(i, 3, 101) - 0.5) * (DUNE.R0 * 1.8), z = DUNE.cz + (hash2(i, 4, 101) - 0.5) * (DUNE.R0 * 1.8);
    // tufts grow in the troughs and on the pan, never on a live slip face
    const d = duneDetail(x, z);
    if (d > 1.5 || vn2(x * 0.02, z * 0.02, 131) < 0.42) continue;
    const sc = 0.7 + hash2(i, 5, 101) * 1.1;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(i, 6, 101) * 6.28);
    mtx.compose(p.set(x, MAP_GROUND(x, z) - 0.05, z), q, s.set(sc, sc * (0.8 + hash2(i, 7, 101) * 0.5), sc));
    tuft.setMatrixAt(k++, mtx);
  }
  tuft.count = k;
  tuft.instanceMatrix.needsUpdate = true;
  tuft.castShadow = true; tuft.frustumCulled = false; tuft.userData.dynamic = true;
  CBZ.scene.add(tuft);
}
let MAP_GROUND = function () { return 0; };
