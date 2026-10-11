"use strict";
/* src/battle/arenas/sea.js — NPC War: THE SEA: open water.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ THE SEA
   OPEN WATER, and the reason it is thirty lines and not a water engine.

   Everything on this page asks the MAP for a height: the men, the animals,
   the rockets, the bombers, the camera arm and the director all call
   groundAt(x,z). So the sea does not need to be a shader — it needs to be a
   FUNCTION, because a vertex shader can only tell the GPU where the water is
   and half this file needs the same answer on the CPU in the same frame.
   Three sine trains, seeded off sWorld so the swell is the same swell on
   every reload of the same URL, and one mesh that reads the function.

   WHAT IS DELIBERATELY NOT HERE: world/water_spec.js's real ocean, the
   waterfield, buoyancy, wakes, foam. All of it exists and all of it belongs
   to the mainland; pulling it in would cost this venue its entire reason for
   existing, which is that it boots in a fraction of the city's time. When
   this arena needs a wake it should ask for the world's, not grow one. */
const SEA = {
  on: false, t: 0, y0: 0,
  seabed: -46,                 // where the bottom is. deep enough to READ as depth
  trains: [], surf: null, pos: null, seg: 0, span: 0, cx: 0, cz: 0,
  boats: [], fogSurface: null, under: null,
};
/* THE SWELL. Amplitudes and wavelengths are a real short-period ocean swell
   (0.35-0.8 m at 40-95 m), not "some sines that looked wet": the whole point
   of a test arena is that a shark's body has something honestly sized to
   move through. Deterministic — sWorld, never Math.random. */
function seaBuildSwell() {
  SEA.trains.length = 0;
  for (let i = 0; i < 3; i++) {
    const dir = sWorld() * Math.PI * 2;
    const len = 40 + i * 28 + sWorld() * 22;          // m between crests
    const k = (Math.PI * 2) / len;
    SEA.trains.push({
      a: 0.78 - i * 0.22,
      kx: Math.cos(dir) * k, kz: Math.sin(dir) * k,
      w: Math.sqrt(9.81 * k) * 0.42,                  // deep-water dispersion, slowed to read
      p: sWorld() * Math.PI * 2,
    });
  }
}
function swellAt(x, z) {
  let y = SEA.y0;
  for (let i = 0; i < SEA.trains.length; i++) {
    const s = SEA.trains[i];
    y += s.a * Math.sin(x * s.kx + z * s.kz + SEA.t * s.w + s.p);
  }
  return y;
}
/* THE SURFACE, IN TWO PIECES. A live grid over the fight (the only part
   anybody is close enough to see move) and one flat quad out to the fog so
   the horizon is ocean rather than the inside of the sky dome. Same material,
   so the seam between them is a colour match at 280 m through haze.

   transparent + depthWrite:false is the whole trick that makes this venue
   work: r128 draws opaque first, so every animal UNDER the water is already
   in the buffer when the surface blends over it. That is why you can stand
   above the swell and watch a shark's shape move beneath it. */
function seaSurface(cx, cz) {
  const span = 620, seg = 64;
  /* THE SEA IS LIT PER PIXEL. A Lambert sheet lit per vertex at ten metres
     a cell is a blue tarpaulin: no glint, no chop, nothing that says water.
     Phong puts the sun on it; a few travelling ripples in the shader break
     the normal up at the scale a lens actually sees (and fade with range so
     they never shimmer); a fresnel term lets the sky into the grazing view
     and the deep colour into the steep one. The far plate carries the same
     material with a hole cut where the live grid is, so the two sheets no
     longer stack their opacity into a visible square. */
  const seaShader = function (hole) {
    return function (sh) {
      sh.uniforms.uT = SEA.uT;
      sh.uniforms.uHole = { value: new THREE.Vector3(cx, cz, hole ? span / 2 - 6 : -1) };
      sh.vertexShader = "varying vec3 vSeaW;\n" + sh.vertexShader.replace("#include <project_vertex>",
        "#include <project_vertex>\nvSeaW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = "varying vec3 vSeaW;\nuniform float uT;\nuniform vec3 uHole;\n" + sh.fragmentShader
        .replace("void main() {", "void main() {\n if (uHole.z > 0.0 && abs(vSeaW.x - uHole.x) < uHole.z && abs(vSeaW.z - uHole.y) < uHole.z) discard;")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" +
          "{ float dist = length(vSeaW - cameraPosition); float k = 1.0 - smoothstep(40.0, 420.0, dist);\n" +
          "  vec2 p = vSeaW.xz;\n" +
          "  float dx = cos(p.x * 0.42 + uT * 1.3) * 0.5 + cos(dot(p, vec2(0.31, 0.27)) + uT * 1.7) * 0.35 + cos(dot(p, vec2(-1.1, 0.7)) + uT * 2.9) * 0.2;\n" +
          "  float dz = cos(p.y * 0.37 - uT * 1.1) * 0.5 + cos(dot(p, vec2(-0.23, 0.41)) + uT * 1.5) * 0.35 + cos(dot(p, vec2(0.8, 1.3)) - uT * 2.6) * 0.2;\n" +
          "  normal = normalize(normal + (viewMatrix * vec4(dx, 0.0, dz, 0.0)).xyz * 0.16 * k); }")
        // r128 has no output_fragment chunk: the colour is written just
        // before tonemapping, so the fresnel lands there
        .replace("#include <tonemapping_fragment>",
          "{ vec3 vdir = normalize(cameraPosition - vSeaW); float fr = pow(1.0 - max(vdir.y, 0.0), 4.0);\n" +
          "  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.62, 0.74, 0.82), fr * 0.55);\n" +
          "  gl_FragColor.a = mix(gl_FragColor.a, 0.96, fr); }\n#include <tonemapping_fragment>");
    };
  };
  SEA.uT = { value: 0 };
  const mat = new THREE.MeshPhongMaterial({
    color: 0x14506c, specular: 0xbfd4e0, shininess: 70, transparent: true, opacity: 0.8,
    depthWrite: false, side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = seaShader(false);
  const farMat = mat.clone();
  farMat.onBeforeCompile = seaShader(true);
  const g = new THREE.PlaneGeometry(span, span, seg, seg);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(cx, 0, cz);
  m.renderOrder = 4;
  CBZ.scene.add(m);
  SEA.surf = m; SEA.pos = g.attributes.position; SEA.seg = seg; SEA.span = span;
  SEA.cx = cx; SEA.cz = cz;
  const far = new THREE.PlaneGeometry(26000, 26000);
  far.rotateX(-Math.PI / 2);
  const fm = new THREE.Mesh(far, farMat);
  fm.position.set(cx, 0, cz);
  fm.renderOrder = 3;
  fm.matrixAutoUpdate = false; fm.updateMatrix();
  CBZ.scene.add(fm);
}
/* the live grid, once per FRAME (never per sub-step — the swell is scenery,
   and 4 225 vertices x 3 sines is a real number). Only y moves. */
function seaStep(dt) {
  if (!SEA.on) return;
  SEA.t += dt;
  const p = SEA.pos; if (!p) return;
  const a = p.array, n = a.length / 3, cx = SEA.cx, cz = SEA.cz;
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    a[j + 1] = swellAt(a[j] + cx, a[j + 2] + cz);
  }
  p.needsUpdate = true;
  // the swell's own slope lights the swell (Phong reads these per pixel)
  SEA.surf.geometry.computeVertexNormals();
  if (SEA.uT) SEA.uT.value = SEA.t;
  for (let i = 0; i < SEA.boats.length; i++) {
    const b = SEA.boats[i];
    const y = swellAt(b.position.x, b.position.z);
    b.position.y = y + b.userData.freeboard;
    // a hull sits on the water it is on: pitch and roll come from the swell's
    // own gradient across the boat's length and beam, measured, not faked
    const dfx = swellAt(b.position.x + 5, b.position.z) - swellAt(b.position.x - 5, b.position.z);
    const dfz = swellAt(b.position.x, b.position.z + 3) - swellAt(b.position.x, b.position.z - 3);
    b.rotation.z = -dfx * 0.09;
    b.rotation.x = dfz * 0.14;
  }
}
/* THE REEF. "No land, or a single small reef/wreck for scale" — and scale is
   the operative word: an ocean with nothing in it has no size at all, and a
   megalodon looks exactly like a great white until something 40 m tall is
   standing next to it. One pinnacle off the fight axis, rising from the bed
   to just under the surface, with a broken hull across its shoulder. Seven
   meshes, seven colliders, and it is the only thing on this map that can
   block a line of sight. */
function seaReef(cx, cz) {
  /* It was seven boxes: four grey slabs for a pinnacle and three brown
     planks for a wreck. The pinnacle is four welded, encrusted rock masses
     now, and the wreck is a real lofted hull (world/hull_loft.js, the same
     builder as the fleet above it) lying keel-up across the shoulder with
     its bow section torn off below and the mast down. The colliders are
     the same boxes as before: they were always the honest volumes. */
  const rx = cx, rz = cz + 96, bed = SEA.seabed;
  const collide = function (w, h, d, x, y, z) { CBZ.micro.addBoxCollider(x, y, z, w, h, d); };
  const reefPaint = function (salt) {
    return function (x, y, z, ny) {
      let c = [0.2, 0.25, 0.23];
      const a = vn2(x * 3 + salt, z * 3 + y * 2, 31), b = vn2(x * 5 + y * 3, z * 5 + salt, 37), f = vn2(x * 9, y * 9 + z * 4 + salt, 41);
      if (a > 0.58) c = [0.26, 0.36, 0.24];                             // weed and turf algae
      if (b > 0.7) c = [0.46, 0.3, 0.33];                               // coralline pink crust
      if (f > 0.86) c = [0.55, 0.48, 0.26];                             // sponge
      const v = 0.85 + vn2(x * 14, z * 14 + y * 9, 43) * 0.3;
      const silt = Math.max(0, ny - 0.5) * 0.9;                         // silt settles on every ledge
      return [(c[0] + (0.44 - c[0]) * silt) * v, (c[1] + (0.43 - c[1]) * silt) * v, (c[2] + (0.36 - c[2]) * silt) * v];
    };
  };
  const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const masses = [[23, 9, 20, 0, 7, 0, 0.3], [15, 10, 13, 3, 19, -3, -0.2], [9, 8, 8, -2, 31, 2, 0.6], [5.5, 4, 4.8, 1, 40.5, -1, 0.15]];
  masses.forEach(function (r, i) {
    const m = new THREE.Mesh(lumpRock(3, 11 + i * 7, 0.78, reefPaint(i * 3)), rockMat);
    m.scale.set(r[0], r[1], r[2]); m.position.set(rx + r[3], bed + r[4], rz + r[5]); m.rotation.y = r[6];
    m.receiveShadow = true;
    m.matrixAutoUpdate = false; m.updateMatrix();
    CBZ.scene.add(m);
    collide(r[0] * 1.7, r[1] * 1.6, r[2] * 1.7, rx + r[3], bed + r[4], rz + r[5]);
  });
  const wy = bed + 26;
  const HL = CBZ.hullLoft;
  const rust = yardPatch(new THREE.MeshLambertMaterial({ color: 0x564236, side: THREE.DoubleSide }), { mottle: 0.7, grime: 0, scale: 2.2 });
  if (HL && HL.stationsFromLines) {
    const hull = function (o, x, y, z, rotY, rotZ, rotX) {
      const st = HL.stationsFromLines(o);
      const ol = HL.outline(st);
      const hm = HL.mesh(st, rust, { castShadow: false });
      hm.position.z = -(ol.z0 + ol.z1) / 2;
      hm.receiveShadow = true;
      const g = new THREE.Group();
      g.add(hm);
      g.position.set(x, y, z); g.rotation.set(rotX || 0, rotY, rotZ, "YXZ");
      CBZ.scene.add(g);
    };
    // the main hull, keel to the sky, rolled onto the rock's shoulder
    hull({ loa: 30, beam: 7.4, draft: 2.4, freeboard: 2.6, deadrise: 20, roundBilge: true }, rx - 19, wy + 0.4, rz + 10, 0.42 + Math.PI / 2, Math.PI - 0.28);
    // the bow, torn off and lying on its side further down
    hull({ loa: 11, beam: 6.2, draft: 2.1, freeboard: 2.4, deadrise: 22, roundBilge: true }, rx - 33, wy - 3.6, rz + 16, 0.42 + Math.PI / 2 + 0.5, 1.9, 0.25);
  }
  // the mast, down across the hull
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 13, 8), rust);
  mast.position.set(rx - 21, wy + 5.5, rz + 11); mast.rotation.set(0.25, 0.42, 1.05);
  CBZ.scene.add(mast);
  collide(34, 4.6, 8, rx - 19, wy, rz + 10);
  collide(12, 3.2, 6.4, rx - 33, wy - 3.4, rz + 16);
  collide(2, 13, 2, rx - 21, wy + 8, rz + 11);
  SCENERY.push({ kind: "reef", x: rx, y: bed + 30, z: rz }, { kind: "wreck", x: rx - 19, y: wy, z: rz + 10 });
}
/* THE FLEET. Men on this map are SWIMMERS — there is no boat-crew unit and
   inventing one would be a second kind of actor for one matchup. What there
   is instead is the surface they came off: anchored hulls riding the swell
   over the men's own start line, which is what makes "MEG v A FLEET" a
   picture instead of a label. Scenery, not units: nothing shoots from them
   and nothing can sink them. */
/* THE WHEELHOUSE SKIN: painted steel with its window band (framed panes,
   sky in the top of the glass, dark below), rust weeping from the frames
   and a salt-and-dirt skirt. It replaces a dark slab that was 2 cm WIDER
   than the cabin it sat on, poking out of both sides. */
function wheelhouseTex() {
  if (TEX.wheelhouse) return TEX.wheelhouse;
  const c = cvs(256, 128), g = c.getContext("2d");
  g.fillStyle = "#e6e2d6"; g.fillRect(0, 0, 256, 128);
  const panes = [[10, 84], [92, 164], [172, 246]];
  panes.forEach(function (pn) {
    for (let i = 0; i < 4; i++) {                    // rust weeping from the frame corners
      const x = pn[0] + trand() * (pn[1] - pn[0]), gr = g.createLinearGradient(0, 64, 0, 64 + 30 + trand() * 30);
      gr.addColorStop(0, "rgba(120,62,30,0.45)"); gr.addColorStop(1, "rgba(120,62,30,0)");
      g.fillStyle = gr; g.fillRect(x, 62, 2 + trand() * 3, 60);
    }
    g.fillStyle = "#34383b"; g.fillRect(pn[0], 14, pn[1] - pn[0], 50);
    const gl = g.createLinearGradient(0, 18, 0, 60);
    gl.addColorStop(0, "#9fb3bf"); gl.addColorStop(0.45, "#4d6170"); gl.addColorStop(1, "#1a232b");
    g.fillStyle = gl; g.fillRect(pn[0] + 4, 18, pn[1] - pn[0] - 8, 42);
    g.fillStyle = "rgba(255,255,255,0.18)";          // a streak of reflection
    g.beginPath(); g.moveTo(pn[0] + 14, 18); g.lineTo(pn[0] + 26, 18); g.lineTo(pn[0] + 12, 60); g.lineTo(pn[0] + 4, 60); g.fill();
  });
  g.fillStyle = "rgba(40,44,48,0.8)"; g.fillRect(0, 70, 256, 3);          // trim
  const dirt = g.createLinearGradient(0, 128, 0, 90);
  dirt.addColorStop(0, "rgba(90,80,62,0.45)"); dirt.addColorStop(1, "rgba(90,80,62,0)");
  g.fillStyle = dirt; g.fillRect(0, 90, 256, 38);
  speckle(g, 256, 500, 0.1, true);
  return (TEX.wheelhouse = wrapTex(c, true));
}
/* antifouling below the waterline, a black boot-top band on it and a weed
   scum just under it, read off the hull's own waterline-relative y */
function hullPaint(mat) {
  mat.onBeforeCompile = function (sh) {
    sh.vertexShader = "varying float vHy;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvHy = position.y;");
    sh.fragmentShader = "varying float vHy;\n" + sh.fragmentShader.replace("#include <color_fragment>",
      "#include <color_fragment>\n" +
      "{ float below = step(vHy, -0.02);\n" +
      "  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.09, 0.07), below);\n" +
      "  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.24, 0.14), below * smoothstep(-0.3, -0.02, vHy) * 0.6);\n" +
      "  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.08, 0.09), step(-0.02, vHy) * step(vHy, 0.14));\n" +
      "  diffuseColor.rgb *= 1.0 - 0.18 * smoothstep(0.14, 0.5, vHy) * (1.0 - smoothstep(0.5, 1.2, vHy)); }");
  };
  mat.customProgramCacheKey = function () { return "npcwar-hull"; };
  return mat;
}
function seaFleet(cx, cz, side, n) {
  /* A BOAT IS A HULL, NOT THREE BOXES. world/hull_loft.js lofts a real
     shell from lines (sheer, chine, keel rocker, deadrise, flare) — the
     game's own boat builder, always in this page's load — so the fleet is
     fishing boats: a painted hull with its antifouling and boot top riding
     at its waterline, a rubbing strake, a laid plank deck, a wheelhouse
     with framed windows, a mast and a derrick. (The box-stack fallback is
     gone: the loft is always loaded here, and a box boat was never a boat.) */
  const HL = CBZ.hullLoft;
  if (!HL || !HL.stationsFromLines) return;
  const paint = [0xe8e4da, 0x2d4f6b, 0x8a2b22, 0xd8cfb8, 0x3f5b3f];
  const deckTex = pineTex().map.clone(); deckTex.needsUpdate = true;
  deckTex.center.set(0.5, 0.5); deckTex.rotation = Math.PI / 2; deckTex.repeat.set(1 / 1.2, 1 / 1.2);
  const deckM = new THREE.MeshLambertMaterial({ map: deckTex, color: 0xb8a58a }),
    cabM = new THREE.MeshLambertMaterial({ map: wheelhouseTex() }),
    trimM = CBZ.cmat(0x2a2a2c);
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group();
    const L = 9 + sWorld() * 5, W = 3 + sWorld() * 1.4;
    const st = HL.stationsFromLines({ loa: L, beam: W, draft: 0.75, freeboard: 1.15, deadrise: 16, flareBow: 14 });
    const hullM = hullPaint(new THREE.MeshLambertMaterial({ color: paint[i % paint.length], side: THREE.DoubleSide }));
    const hm = HL.mesh(st, hullM);
    const ol = HL.outline(st);
    const z0 = ol.z0, z1 = ol.z1, midY = ol.sheerYAt((z0 + z1) / 2);
    hm.position.z = -(z0 + z1) / 2;          // centred on the group, so it pitches about its middle
    g.add(hm);
    // the deck: the sheer plan, laid flat just under the rail
    const shp = new THREE.Shape();
    const sb = ol.sheerStarboard, pt = ol.sheerPort;
    shp.moveTo(sb[0][0] * 0.94, -sb[0][2]);
    for (let k = 1; k < sb.length; k++) shp.lineTo(sb[k][0] * 0.94, -sb[k][2]);
    for (let k = pt.length - 1; k >= 0; k--) shp.lineTo(pt[k][0] * 0.94, -pt[k][2]);
    const dg = new THREE.ShapeGeometry(shp);
    dg.rotateX(-Math.PI / 2);          // (x, -z) in the plane lands at (x, 0, z) facing UP
    const dm = new THREE.Mesh(dg, deckM);
    dm.position.set(0, midY - 0.12, hm.position.z);
    g.add(dm);
    // rubbing strakes, a hand's width under the sheer on both sides
    [sb, pt].forEach(function (line) {
      const pts = line.map(function (q) { return [q[0] * 1.01, q[1] - 0.16, q[2] + hm.position.z]; });
      const rs = HL.strip && HL.strip(pts, 0.06, trimM, { radial: 5, castShadow: false });
      if (rs) g.add(rs);
    });
    const zc = hm.position.z + z0 + (z1 - z0) * 0.42;
    const cab = new THREE.Mesh(CBZ.boxGeom(W * 0.62, 1.7, L * 0.22), cabM);
    cab.position.set(0, midY + 0.73, zc); cab.castShadow = true; g.add(cab);
    const roof = new THREE.Mesh(CBZ.boxGeom(W * 0.7, 0.12, L * 0.26), trimM);
    roof.position.set(0, midY + 1.64, zc); g.add(roof);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.2, 6), trimM);
    mast.position.set(0, midY + 3.6, zc + L * 0.02); g.add(mast);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, L * 0.34, 5), trimM);
    boom.rotation.x = 1.15; boom.position.set(0, midY + 2.6, zc - L * 0.14); g.add(boom);
    g.userData.freeboard = 0;
    const a = i * 2.399963229728653;
    g.position.set(cx + side * (34 + sWorld() * 26) + Math.cos(a) * 16,
                   0, cz + Math.sin(a) * 26 + (sWorld() - 0.5) * 30);
    g.rotation.y = sWorld() * Math.PI * 2;
    CBZ.scene.add(g);
    SEA.boats.push(g);
    SCENERY.push({ kind: "boat", x: g.position.x, y: 1, z: g.position.z });
  }
}
/* HOW DEEP A BODY SWIMS, and the bestiary already answered it. aquatic.js
   declares `swimDepth` per row — how far the model origin rides below the
   surface — because the alternative was a hard-coded name table in two files
   (its own comment says so). A sardine shoal at 0.55 m, a bull shark at 1.5,
   an orca at 2.6: read the row, never a list in this page. A man is a
   swimmer, submerged to the shoulders. Anything that walked in here wades. */
function cruiseDepth(m) {
  if (!m || SWIM_OLD) return 0;          // the revert: everything on the plane
  if (!m.beast) return 1.3;
  const sp = m.species || {};
  if (!sp.aquatic) return 0.55;
  return sp.swimDepth != null ? sp.swimDepth : Math.max(0.6, (sp.scale || 1) * 1.4);
}
/* AND IT CONVERGES ON THE FIGHT. Two animals holding their own cruise depths
   never meet: a great white at 2.5 m and a sardine ball at 0.55 would pass
   each other with two metres of clear water between the teeth and the fish,
   and every strike would be a miss the bite gate correctly refused. Inside
   the closing range a body rises or dives onto its target's line, rate-
   limited, which is also just what a hunt in water looks like. */
const DIVE_RATE = 2.4;         // m/s a body can change depth by
function stepDepth(m, sdt) {
  let want = cruiseDepth(m);
  const t = m.tgt;
  if (t && !t.dead) {
    const d = Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z);
    const k = Math.max(0, Math.min(1, (30 - d) / 20));
    want += ((t.swimD == null ? cruiseDepth(t) : t.swimD) - want) * k;
  }
  // and nothing hovers dead still in the sea
  want += Math.sin(simT * 0.7 + m.i * 1.7) * 0.16;
  if (want < 0.2) want = 0.2;
  if (m.swimD == null) { m.swimD = want; m.swimDepth = want; return; }
  const dd = want - m.swimD, lim = DIVE_RATE * sdt;
  m.swimD += dd > lim ? lim : (dd < -lim ? -lim : dd);
  m.swimDepth = m.swimD;               // creature_combat's restY reads this name
}
/* UNDER. The camera is allowed below the waterline on this map (see camFloor)
   and the moment it goes there the scene has to stop pretending: fog closes
   to a hundred metres of green-blue, the sky dome comes off, and the clear
   colour becomes water. One boolean, flipped on a crossing, so it costs
   nothing on every other map and nothing on the frames either side of it. */
function seaUnderwater() {
  if (!SEA.on || SWIM_OLD || !CBZ.scene.fog) return;
  const c = CBZ.camera.position;
  const under = c.y < swellAt(c.x, c.z) - 0.2;
  if (under === SEA.under) return;
  SEA.under = under;
  const fog = CBZ.scene.fog;
  if (under) {
    if (!SEA.fogSurface) SEA.fogSurface = { hex: fog.color.getHex(), near: fog.near, far: fog.far };
    fog.color.setHex(0x0d3245); fog.near = 3; fog.far = 130;
    CBZ.scene.background = new THREE.Color(0x0b2a3c);
    if (CBZ.micro.skyDome) CBZ.micro.skyDome.visible = false;
  } else if (SEA.fogSurface) {
    fog.color.setHex(SEA.fogSurface.hex); fog.near = SEA.fogSurface.near; fog.far = SEA.fogSurface.far;
    CBZ.scene.background = null;
    if (CBZ.micro.skyDome) CBZ.micro.skyDome.visible = true;
  }
}

/* NOBODY SPAWNS INSIDE A BUILDING. The desert maps could get away without
   this — a dune has nothing in it — but the moment the ground is a real
   downtown, a ranked column drawn on paper puts a third of an army inside
   the Exchange Bank, where nothing can see them and nothing can shoot them.
   A golden-angle spiral, so the search is a spiral and not a ring: the
   first free point is genuinely the nearest one, and it is deterministic. */
const _fs = [];
function blockedAt(x, z) {
  const cols = CBZ.micro.queryColliders(x, z, 0.9, _fs);
  for (let c = 0; c < cols.length; c++) {
    const b = cols[c];
    if (!CBZ.micro.colliderContains(b, x, z, 0.55)) continue;   // exact on a turned box
    if (b.y0 != null && b.y1 != null && (b.y1 < 0.35 || b.y0 > 1.7)) continue;  // a kerb is not a wall
    return true;
  }
  return false;
}
/* AND NOT ON TOP OF EACH OTHER EITHER. The spiral above only ever asked the
   geometry. On an open field that is enough, because the ranked grid never
   puts two men in the same square — but on a DENSE venue (the seat of state
   is walls, planters and steps) many grid points are blocked, several men
   spiral out of their own square and converge on the same first free metre,
   and they start the battle interpenetrating. Measured on `gov`: one
   overlapping pair at t=0, which the sweep counts as a fault and should.
   Claimed points are remembered for the length of one build. */
/* AND THE CLAIM IS THE BODY'S OWN SIZE. A flat 1.15 m is the right answer
   for a man and a fiction for a bull elephant: an army of them spawned
   INSIDE one another and spent the opening seconds of the battle shoving
   itself apart. Each claim carries the radius that took it, so a pair only
   has to clear what the two of them actually occupy. */
/* SPAWN CLAIMS BELONG TO ONE ROSTER. Cleared at buildMap, and again by
   __battle.restage() below — four hundred sardine claims left standing would
   push the next matchup out into open water for no reason anybody could see. */
const _claim = [];
function clearClaims() { _claim.length = 0; }
const CLAIM_R = 0.575;         // a man's half of the old 1.15 m pair
function crowdedAt(x, z, r) {
  for (let i = 0; i < _claim.length; i++) {
    const c = _claim[i];
    const dx = x - c.x, dz = z - c.z, need = r + c.r;
    if (dx * dx + dz * dz < need * need) return true;
  }
  return false;
}
function freeSpot(x, z, r) {
  r = r || CLAIM_R;
  const take = function (px, pz) { _claim.push({ x: px, z: pz, r: r }); return { x: px, z: pz }; };
  if (!blockedAt(x, z) && !crowdedAt(x, z, r)) return take(x, z);
  // the search walks outward in the body's OWN units, so a big animal is
  // not condemned to test forty man-sized rings it can never fit in
  const step = 1.35 * Math.max(1, r / CLAIM_R * 0.72);
  for (let k = 1; k < 40; k++) {
    const a = k * 2.399963229728653, d = k * step;      // golden angle
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (!blockedAt(px, pz) && !crowdedAt(px, pz, r)) return take(px, pz);
  }
  return take(x, z);
}

/* SPAWN ON THE STREET, NOT ON A GRID. Given the town's own road records,
   each side forms up in north-south streets on its half and walks in. That
   is one lookup per man and it is the reason an urban fight reads as an
   assault down avenues instead of two blocks of men shuffling through
   masonry.

   AND IT FORMS UP AT THE DECLARED GAP, WHICH IS THE FAULT THIS WAVE FOUND.
   It used to sort the lanes by distance from the centre DESCENDING and take
   the outermost three — so on an eight-block downtown 472 m across, the two
   armies started at opposite edges and `gap` was a number the city map wrote
   down and then ignored. MEASURED, 26 v 26 on `city`: nearest enemy 304 m at
   t=0, first round fired at t=10.9 s, and at t=17 s all 52 men were still in
   slot `march` having managed eleven shots between them. Closure through a
   grid of blocks runs about 5 m/s combined, not the 12 m/s two marching
   columns suggest, so three hundred metres is a full minute of watching
   crowds walk before the war starts. Nobody watches that twice.

   So the lanes are chosen by how near they are to the declared start line
   (cx ± gap/2) instead of by how far out they can possibly be, and the
   number in the table above is finally the number on the ground. */
function streetSpawner(roads, cx, cz, side, gap) {
  const want = cx + side * gap * 0.5;
  const lanes = (roads || []).filter(function (r) {
    return r.vertical && (r.x - cx) * side > 24;
  }).sort(function (a, b) { return Math.abs(a.x - want) - Math.abs(b.x - want); }).slice(0, 3);
  if (!lanes.length) return null;
  return function (i) {
    const L = lanes[i % lanes.length];
    const k = (i / lanes.length) | 0;
    const row = k % 11, rank = (k / 11) | 0;
    const t = (row - 5) * (L.len / 13);
    const off = ((rank % 2) ? 1 : -1) * Math.min(L.w * 0.3, 3.4) + (sWorld() - 0.5) * 1.4;
    const along = ((rank / 2) | 0) * 3.2 * side;         // ranks stack BEHIND
    return { x: L.x + off + along, z: L.z + t + (sWorld() - 0.5) * 1.4 };
  };
}

let MEASURED = null;        // what the heightfield found, for the audit
function buildMap(id) {
  /* THE START LINE, and every one of these is a distance a man has to WALK
     before anything happens. The open maps can be wide because a firing line
     across sand is a sightline: dunes at 150 m resolved in 32 s and the kill
     box at 120 m in 51 s, both measured. A city cannot, because a block is
     not a sightline — `city` used to read 300 here and the two armies spent
     the first forty seconds marching (see streetSpawner), so it is a
     three-block approach now that still has to be fought through. */
  const M = MAPS[id] || MAPS.arena;
  _claim.length = 0;          // spawn claims belong to ONE build
  /* ...and OPEN WATER is the shortest of them, measured the same way the
     others were. Water has no cover, no walls to path around and no crest to
     climb: closure there is a straight line at the animals' own charge speed
     (an orca's works out at 6.7 m/s, so 110 m of no-man's land is ~8 s of
     swimming before contact) and there is nothing to look at on the way. */
  let gap = { city: 170, island: 175, field: 180, dunes: 150, arena: 120, water: 110 }[id] || 150;
  let gapOverride = 0;      // measured venues size their own no-man's land
  let groundAt = function () { return 0; };
  let cx = 0, cz = 0, spawners = null;

  if (id === "arena") {
    // a walled container yard, 210 x 150 m inside the block wall (THE YARD above)
    buildYard(210, 150, gap);
  } else if (id === "water") {
    /* OPEN WATER. No world() call, no raise(), no town(): a swell function,
       a seabed, a reef, and whatever fleet the roster earns. This branch is
       the map's cost, and it is deliberately the shortest one in the file. */
    SEA.on = true; SEA.t = 0; SEA.boats.length = 0; SEA.under = null; SEA.fogSurface = null;
    /* the fourth shim, same pattern as queryCollidersNear/floorAt/collide up
       top: creature_combat's restY() resolves an aquatic body to
       CBZ.citySeaHeightAt(x,z) minus its own swimDepth, so without these two
       names the shared strike driver would rest a shark at CBZ.SEA_Y and
       fight this page's own depth every frame. Route the name, never fork
       the file. (stepDepth keeps actor.swimDepth in step with actor.swimD.) */
    CBZ.citySeaHeightAt = function (x, z) { return swellAt(x, z); };
    cx = 0; cz = 0;
    seaBuildSwell();
    // the bed first, so the surface blends over something and not over sky
    seabed(SEA.seabed);
    seaSurface(cx, cz);
    if (Q.get("reef") !== "0") seaReef(cx, cz);
    groundAt = function (x, z) { return swellAt(x, z); };
    // a side of MEN is a side that came off boats — see seaFleet
    if (Q.get("fleet") !== "0") {
      if (SET.redU === "men") seaFleet(cx, cz, -1, Math.max(1, Math.min(9, Math.ceil(SET.redN / 8))));
      if (SET.blueU === "men") seaFleet(cx, cz, 1, Math.max(1, Math.min(9, Math.ceil(SET.blueN / 8))));
    }
    /* AND A SHOAL IS NOT A COLUMN. The ranked grid below is right for men
       walking up a street and wrong for four hundred sardines: water has no
       ranks, so each side forms a golden-angle disc around its own start
       point, sized by how many of it there are. Deterministic (sWorld), and
       it feeds the same freeSpot() claim pass everything else uses. */
    spawners = (function () {
      const mk = function (side, n) {
        const r = Math.max(9, Math.sqrt(Math.max(1, n)) * 3.4);
        return function (i) {
          const a = i * 2.399963229728653;
          const d = Math.sqrt((i + 0.5) / Math.max(1, n)) * r;
          return { x: cx + side * gap * 0.5 + Math.cos(a) * d + (sWorld() - 0.5) * 2,
                   z: cz + Math.sin(a) * d * 1.35 + (sWorld() - 0.5) * 2 };
        };
      };
      return { red: mk(-1, SET.redN), blue: mk(1, SET.blueN) };
    })();
  } else if (M.erg) {
    DUNE.pal = ERG_PAL[M.erg] || ERG_PAL.sand;
    world = CBZ.studio.world("desert", { seed: "npcwar" });
    groundAt = (world && world.heightAt) || groundAt;
    /* WALK OUT UNTIL THE GROUND MEASURES AS DUNES. The old centre was a
       constant — rings.city + 650 — and nothing ever asked what the ground
       there looked like. Measured: 7.6 m of relief across the whole field,
       because the dune amplitude ramps up with radius and r=1700 is barely a
       third of the way up the ramp. A map called OPEN DUNES was a flat plate
       with the word "dunes" on the menu row.

       So the venue scans the erg and takes the FIRST centre that passes TWO
       measurements: the battlefield window (±160 m) holds at least 16 m of
       relief, and the dunes STAND BETWEEN the armies — at least two of the
       three central spawn lanes are crest-cut at eye height. Relief alone
       is not enough (measured: the best on-axis window put all of its sand
       on the flanks and the two firing lines still saw each other spawn to
       spawn), and the scan is two-dimensional because the erg is a ring,
       not a bearing — on the shipped terrain the qualifying ground lies off
       the old axis entirely. The terrain derives from WORLD_SEED alone, so
       the same URL lands the same war on the same sand. The fallback is the
       old constant, so a retuned noise field can never strand the map with
       no centre at all. High ground is not dealt evenly here; neither are
       the city map's streets. A venue is a place, and a place has a better
       side. */
    const rings = (world && world.rings) || { city: 1050, dune: 2700 };
    cx = rings.city + 650; cz = 0;
    scan:
    for (let x = rings.city + 550; x <= rings.dune - 250; x += 50) {
      for (let z = -450; z <= 450; z += 50) {
        if (Math.hypot(x, z) + 170 > rings.dune - 60) continue;
        let lo = 1e9, hi = -1e9;
        for (let sx = -160; sx <= 160; sx += 16) for (let sz = -160; sz <= 160; sz += 16) {
          const y = groundAt(x + sx, z + sz);
          if (y < lo) lo = y; if (y > hi) hi = y;
        }
        if (hi - lo < 16) continue;
        let cut = 0;
        for (let li = -1; li <= 1; li++) {
          const lz = z + li * 12, ax = x - 83, bx = x + 83;
          if (terrainBlocked(ax, groundAt(ax, lz) + 1.52, lz,
                             bx, groundAt(bx, lz) + 1.35, lz, groundAt)) cut++;
        }
        if (cut >= 2) { cx = x; cz = z; break scan; }
      }
    }
    // THE ERG over the chosen window: crests, slip faces, the skin that shows them
    DUNE.on = true; DUNE.cx = cx; DUNE.cz = cz;
    const worldGround = groundAt;
    groundAt = function (x, z) { return worldGround(x, z) + duneDetail(x, z); };
    MAP_GROUND = groundAt;
    duneSkin(world);
  } else if (id === "city") {
    // THE REAL FABRIC. Eight blocks square is 490 m of street — big enough
    // that an army has to cross ground it does not own, small enough that
    // the two sides find each other without a search party.
    cx = TOWN_AT.x; cz = TOWN_AT.z;
    town = CBZ.studio.town({
      at: TOWN_AT, seed: "npcwar-" + (Q.get("seed") || "talloran"), name: "Talloran",
      cols: 8, rows: 8, blockW: 44, blockD: 44, roadW: 15,
      // the studio's default downtown palette is authored for the mainland's
      // own light. Under this map's sun the sidewalks and the square came
      // out as paper — a white field with a road painted on it — so the
      // stone comes down to something a camera can still see men against.
      palette: {
        ground: 0x5f636a, sidewalk: 0x6d7278, road: 0x2b2e34,
        plaza: 0x6f747b, wood: 0x4c545d, accent: 0x616a75,
      },
    });
    if (town && town.rect) {
      // a WIDE apron and no water: the downtown is inland, and the sea plate
      // this map used to carry was the thing fighting the road for the depth
      // buffer. Ground that runs out to the fog is the honest answer here.
      apron(town.rect.minX - 900, town.rect.maxX + 900, town.rect.minZ - 900, town.rect.maxZ + 900, 0x555a61);
      spawners = {
        red: streetSpawner(town.roads, cx, cz, -1, gap),
        blue: streetSpawner(town.roads, cx, cz, 1, gap),
      };
    }
  } else if (M.raise) {
    /* A REAL GANG CITY VENUE, MEASURED RATHER THAN DECLARED.

       Every raised venue took the same three hand-written constants before
       this: a centre, an apron rectangle and a flat groundAt. All three were
       guesses that nothing checked, and all three are readable from the
       geometry once it exists. Raise into our OWN group so the heightfield
       casts against the venue and not the skybox, then ask it where it is
       and how high it stands. A venue that is flat measures flat; the
       speedway's banking measures as banking, for free. */
    if (M.sea) seaPlate();
    const venue = new THREE.Group();
    CBZ.scene.add(venue);
    for (let i = 0; i < M.raise.length; i++) {
      const got = CBZ.studio.raise(M.raise[i], { parent: venue });
      if (!base) base = got;
      if (!got) console.error("[battle] nothing raised for pack:", M.raise[i]);
    }
    const H = CBZ.studio.heightfield(venue, { step: 6, pad: 30 });
    if (H) {
      groundAt = H.heightAt;
      cx = H.cx; cz = H.cz;
      // ground out to the fog under the venue's own floor, so its edge is a
      // quay and not the inside of the sky dome
      apron(H.box.min.x - 420, H.box.max.x + 420, H.box.min.z - 420, H.box.max.z + 420,
            M.apronColor || 0x7d7a6c, H.minY);
      // the armies start half the venue apart, clamped to a distance two
      // sides can actually cross before the watcher loses interest
      // ...and 320 m is not that distance. MEASURED on `city` at 304 m: the
      // first round went off at t=10.9 s, forty-five of fifty-two men were
      // still in slot `march` at t=13, and the two sides were not inside
      // 100 m of each other until t=41. Closure through real geometry runs
      // about 5 m/s combined, not the 12 m/s two marching columns suggest,
      // so the old ceiling was a full minute of watching crowds walk. 190 is
      // where the fixed maps measure (Halloran 6.5 s to first contact,
      // island 7.1) and it still leaves a venue-length approach to fight.
      gapOverride = Math.max(90, Math.min(190, Math.min(H.spanX, H.spanZ) * 0.5));
      MEASURED = { cols: H.cols, rows: H.rows, step: +H.step.toFixed(1), miss: H.miss,
                   minY: +H.minY.toFixed(2), maxY: +H.maxY.toFixed(2),
                   spanX: Math.round(H.spanX), spanZ: Math.round(H.spanZ) };
    } else {
      console.error("[battle] heightfield measured nothing for", id, "— falling back to flat");
    }
  }

  if (gapOverride) gap = gapOverride;
  /* HOW MUCH GROUND IS THERE IN THIS GROUND? One number, measured off the
     same groundAt the men will stand on, over the same window they will
     fight in — so the audit can state it and the checker can hold the map
     named OPEN DUNES to actually having dunes. */
  let relief = 0;
  (function () {
    const span = gap * 0.5 + 120;
    let lo = 1e9, hi = -1e9;
    for (let sx = -span; sx <= span; sx += 12) for (let sz = -span; sz <= span; sz += 12) {
      const y = groundAt(cx + sx, cz + sz);
      if (y < lo) lo = y; if (y > hi) hi = y;
    }
    relief = Math.round((hi - lo) * 10) / 10;
  })();
  const grid = function (team, i) {
    const side = team === "red" ? -1 : 1;
    const col = (i / 10) | 0, row = i % 10;
    const x = cx + side * (gap / 2 + 8 + col * 3.1) + (sWorld() - 0.5) * 1.8;
    const z = cz + (row - 4.5) * 3.4 + (col % 2) * 1.7 + (sWorld() - 0.5) * 1.8;
    return { x: x, z: z };
  };
  /* WHERE A BODY ACTUALLY SITS, which on every other map is the ground and
     on OPEN WATER is not. groundAt answers "where is the surface" — the
     camera, the rockets, the bombers and the director all still want that —
     and bodyY answers "where is THIS body", which is the surface minus its
     own swim depth. Two questions that used to be one because on land they
     always had the same answer. */
  const water = id === "water";
  const bodyY = water
    ? function (m, x, z) { return swellAt(x, z) - (m && m.swimD != null ? m.swimD : cruiseDepth(m)); }
    : function (m, x, z) { return groundAt(x, z); };
  /* AND HOW LOW THE CAMERA MAY GO. Everywhere else the lens stops 1.6 m over
     the ground because the ground is opaque. Here the whole point is that you
     can put the lens UNDER the swell and watch a shark come at it, so the
     floor is the seabed instead — the sea is not a wall. */
  const camFloor = (water && !SWIM_OLD)
    ? function () { return SEA.seabed + 2.2; }
    : function (x, z) { return groundAt(x, z) + 1.6; };
  return {
    id: id, gap: gap, cx: cx, cz: cz, groundAt: groundAt, relief: relief,
    water: water, bodyY: bodyY, camFloor: camFloor,
    /* TERRAIN JOINS THE SIGHT LINE — but only where groundAt is genuinely
       TERRAIN. The dunes map's height function is the desert's own analytic
       surface, so a sample along the eye line is sand and nothing else. A
       RAISED venue's groundAt is a raycast heightfield, and a raycast from
       above cannot tell a roof from a hill — arming terrain sight there
       would wall off every lane that passes beside a building the grid
       touched. The buildings already block sight the honest way, through
       their own colliders. So: dunes only, until a map's ground is measured
       by something that knows the difference. */
    terrainTrue: !!M.erg,
    terrainLos: !!M.erg && relief > 6 && Q.get("tlos") !== "0",
    // team spawn: down the streets where there are streets, ranked columns
    // where there are not, and in both cases OUT of the geometry
    spawnAt: function (team, i, r) {
      const s = spawners && spawners[team];
      const p = (s && s(i)) || grid(team, i);
      return freeSpot(p.x, p.z, r);
    },
  };
}
