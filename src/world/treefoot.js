/* ============================================================
   world/treefoot.js — WHERE A TREE MEETS THE GROUND.

   OWNER (2026-09-30): "the green ground ... especially that trees are on
   it, makes trees look like floating."

   WHY THEY FLOATED. Measured across every outdoor tree spawner in Gang City
   (street, park, estate, metro, annex, Redhollow, backcountry, snow,
   wildnature, beach, harvest): the trunks are seated (sunk 0.04-0.35 m, root
   flare from CBZ.treeTrunkGeo), so the geometry touches. What none of them
   had was anything ON the ground: the lawn ran bright and unbroken right up
   to the bark. Under a real tree the ground is the darkest thing in view —
   the canopy hides most of the sky from it (ambient occlusion), the trunk
   foot is a crease of shade and leaf litter, and a planted tree stands in a
   ring of soil or mulch. The sun shadow only exists inside the 220 m shadow
   box and only on the sun side, so past it — and at noon right under it —
   a tree had no contact at all. A trunk on an unbroken bright sheet is
   exactly what the eye reads as "pasted on".

   WHAT THIS IS. One shared, instanced contact layer every spawner adds
   beside its own pools:
     AO     a soft dark disc the size of the crown's footprint, with a tight
            dark core at the trunk (the crease) and a broad faint skirt (the
            sky the canopy takes away). Black, alpha-blended: it darkens
            whatever ground is under it, lawn, footway, duff or snow.
     MULCH  optional: a ragged-edged ring of bark mulch / bare soil, for the
            trees people planted (yards, estates, avenues, metro streets).
            Lit (Lambert), so it takes the sun and the night like the ground.
   Both are tilted to the ground's own slope when the spawner hands its
   height function in, so a disc on a hillside lies ON the hillside.

   COST. Two 64² textures (32 KB) and one unit quad, shared by every pool;
   one InstancedMesh per layer per call (core/instcull.js bounds and culls
   it like any other pool). 2 triangles a tree. No per-frame CPU. Fogged
   exactly like the ground under it (see mats()), and faded out between 380
   and 1300 m, where the crown covers its own foot anyway.

   API
     CBZ.treeFoot.add(parent, feet, opts) -> [meshes]
        feet  flat array, stride 5: x, groundY, z, aoRadius, mulchRadius
              (groundY is the SURFACE height at the trunk, not the sunk seat;
               mulchRadius 0 = no mulch for that tree)
        opts  { name, heightAt(x,z) (tilt to the slope), lift (m, default 0.03),
                fogScale: the terrainFogScale of the ground under the trees
                (a number, true = terrain_overhaul's default, omitted =
                plain scene fog) }
     CBZ.treeFoot.stats()  { pools, ao, mulch }
============================================================ */
(function () {
  "use strict";
  const CBZ = (typeof window !== "undefined" ? window : globalThis).CBZ;
  const THREE = (typeof window !== "undefined" ? window : globalThis).THREE;
  if (!CBZ) return;

  const N = 64;
  const stats = { pools: 0, ao: 0, mulch: 0 };
  function sm(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function hash(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, per, s) {
    const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi;
    const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty);
    const a = hash(((xi % per) + per) % per, ((yi % per) + per) % per, s), b = hash((((xi + 1) % per) + per) % per, ((yi % per) + per) % per, s);
    const c = hash(((xi % per) + per) % per, (((yi + 1) % per) + per) % per, s), d = hash((((xi + 1) % per) + per) % per, (((yi + 1) % per) + per) % per, s);
    return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
  }

  /* The AO profile, r = 0 at the trunk .. 1 at the disc edge.
       crease  0.42 * exp(-(r/0.13)^2)        the shaded fold at the bark
       canopy  0.36 * (1 - smoothstep(.12, 1, r))^1.4   sky the crown hides
     Peak alpha 0.78 at the trunk, 0.3 at mid-radius, 0 at the edge. A
     radial wobble keeps it from reading as a printed circle. */
  function aoProfile(r, ang) {
    const w = 1 + 0.08 * Math.sin(ang * 3 + 1.3) + 0.05 * Math.sin(ang * 5 + 0.4);
    const rr = r * w;
    const crease = 0.42 * Math.exp(-(rr / 0.13) * (rr / 0.13));
    const skirt = 0.36 * Math.pow(1 - sm(0.12, 1.0, rr), 1.4);
    return Math.min(0.78, crease + skirt);
  }
  function bakeAO() {
    const d = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1;
      const r = Math.hypot(u, v), a = r >= 1 ? 0 : aoProfile(r, Math.atan2(v, u));
      const i = (y * N + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = Math.round(a * 255);
    }
    return d;
  }
  /* Mulch: bark chips (rgb = chip tone, a multiplier on the material
     colour) inside a ragged edge (alpha). The disc fills r < ~0.9 of the
     quad; the edge wanders with a periodic noise so no two rings align. */
  function bakeMulch() {
    const d = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1;
      const r = Math.hypot(u, v), ang = Math.atan2(v, u);
      const edge = 0.86 + 0.07 * (vnoise((ang / 6.2832 + 0.5) * 9, 0.5, 9, 71) - 0.5) * 2;
      const a = 1 - sm(edge - 0.1, edge, r);
      const chip = vnoise(x / 2.2, y / 2.2, 64, 73) * 0.6 + hash(x, y, 79) * 0.4;
      const tone = 0.62 + 0.38 * chip;
      // soil shows through toward the rim; the crease by the bark is darker
      const k = tone * (0.8 + 0.2 * sm(0.0, 0.25, r));
      const i = (y * N + x) * 4;
      d[i] = Math.round(k * 255); d[i + 1] = Math.round(k * 0.97 * 255); d[i + 2] = Math.round(k * 0.93 * 255);
      d[i + 3] = Math.round(a * 255);
    }
    return d;
  }

  let _res = null;
  function srgbLin(hex) {
    const f = function (c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return new THREE.Color(f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255));
  }
  function fade(mat, key) {
    mat.onBeforeCompile = function (sh) {
      if (sh.vertexShader.indexOf("#include <project_vertex>") < 0 || sh.fragmentShader.indexOf("#include <map_fragment>") < 0) return;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vTfD;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvTfD = length( mvPosition.xyz );");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vTfD;")
        .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.a *= 1.0 - smoothstep( 380.0, 1300.0, vTfD );");
    };
    mat.customProgramCacheKey = function () { return key; };
  }
  function res() {
    if (_res) return _res;
    if (!THREE || !THREE.InstancedMesh || !THREE.DataTexture || !THREE.PlaneGeometry) return (_res = false);
    const tex = function (data) {
      const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    };
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    geo.computeBoundingSphere();
    _res = { geo: geo, aoTex: tex(bakeAO()), mulchTex: tex(bakeMulch()), mats: new Map() };
    return _res;
  }
  /* THE AIR MUST MATCH THE GROUND'S. A black decal blended at alpha a over
     a ground that is then fogged / hazed toward a colour c is EXACT when the
     decal is fogged by the same factor: g'(1-a) + (k c) a == mix(g(1-a), c, k).
     So the decal wears the fog scale of the ground it lies on (the street
     kit, lots and metros 0.10, the backcountry 0.08, the snow 0.12, plain
     fog elsewhere): one material pair per scale, cached. */
  function mats(fogScale) {
    const R = _res, key = fogScale == null ? "fog" : String(fogScale);
    let M = R.mats.get(key);
    if (M) return M;
    const deco = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
    const ao = new THREE.MeshBasicMaterial(Object.assign({ color: 0x000000, map: R.aoTex }, deco));
    ao.name = "tree-foot-ao";
    fade(ao, "cbzTreeFootAO2");
    // bark mulch, decoded from its display colour (r128 hands hexes to the
    // lights unconverted — the pale-mint bug); the chip map averages ~0.8
    const mulch = new THREE.MeshLambertMaterial(Object.assign({ color: srgbLin(0x4f3b2a).multiplyScalar(1.25), map: R.mulchTex }, deco));
    mulch.name = "tree-foot-mulch";
    fade(mulch, "cbzTreeFootMulch2");
    if (fogScale != null && CBZ.terrainFogScale) {
      CBZ.terrainFogScale(ao, fogScale === true ? undefined : fogScale);
      CBZ.terrainFogScale(mulch, fogScale === true ? undefined : fogScale);
    }
    M = { ao: ao, mulch: mulch };
    R.mats.set(key, M);
    return M;
  }

  function add(parent, feet, opts) {
    opts = opts || {};
    const R = res();
    if (!R || !parent || !feet || feet.length < 5) return [];
    const n = (feet.length / 5) | 0;
    const H = typeof opts.heightAt === "function" ? opts.heightAt : null;
    const lift = opts.lift != null ? +opts.lift : 0.03;
    let nm = 0;
    for (let i = 0; i < n; i++) if (feet[i * 5 + 4] > 0) nm++;
    const MM = mats(opts.fogScale);
    const aoM = new THREE.InstancedMesh(R.geo, MM.ao, n);
    const muM = nm ? new THREE.InstancedMesh(R.geo, MM.mulch, nm) : null;
    const UP = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const qT = new THREE.Quaternion(), qY = new THREE.Quaternion(), q = new THREE.Quaternion(), m4 = new THREE.Matrix4();
    let mi = 0;
    for (let i = 0; i < n; i++) {
      const x = feet[i * 5], y = feet[i * 5 + 1], z = feet[i * 5 + 2], r = feet[i * 5 + 3], mr = feet[i * 5 + 4];
      // the ground's own slope under the disc (central differences at 60 %
      // of the radius: the part of the disc that carries the darkness)
      if (H) {
        const d = Math.max(0.5, r * 0.6);
        const hx0 = H(x - d, z), hx1 = H(x + d, z), hz0 = H(x, z - d), hz1 = H(x, z + d);
        if (isFinite(hx0) && isFinite(hx1) && isFinite(hz0) && isFinite(hz1)) nrm.set(-(hx1 - hx0) / (2 * d), 1, -(hz1 - hz0) / (2 * d)).normalize();
        else nrm.copy(UP);
      } else nrm.copy(UP);
      qT.setFromUnitVectors(UP, nrm);
      qY.setFromAxisAngle(UP, hash(Math.round(x * 4), Math.round(z * 4), 91) * 6.2832);
      q.copy(qT).multiply(qY);
      // the disc's rim must not dip under a convex ground: lift with the radius
      pos.set(x, y + lift + Math.min(0.06, r * 0.008), z);
      scl.set(r, 1, r);
      m4.compose(pos, q, scl); aoM.setMatrixAt(i, m4);
      if (muM && mr > 0) { pos.y -= 0.004; scl.set(mr, 1, mr); m4.compose(pos, q, scl); muM.setMatrixAt(mi++, m4); }
    }
    const out = [];
    const finish = function (m, tag, order) {
      m.instanceMatrix.needsUpdate = true;
      m.name = (opts.name || "trees") + "-" + tag;
      m.castShadow = false; m.receiveShadow = false;
      m.renderOrder = order;              // ground decals first among the transparent
      m.userData.treeFoot = true;
      m.matrixAutoUpdate = false; m.updateMatrix();
      parent.add(m); out.push(m);
    };
    if (muM) { finish(muM, "mulch", -3); stats.mulch += nm; }
    finish(aoM, "foot-ao", -2); stats.ao += n;
    stats.pools += out.length;
    return out;
  }

  CBZ.treeFoot = {
    add: add,
    stats: function () { return Object.assign({}, stats); },
    _profile: aoProfile,      // plain-node checks
  };
})();
