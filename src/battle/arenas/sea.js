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

   The SHADING is the world's (world/water_spec.js, see seaSurface): one
   water material for every sea in the game. The HEIGHT is still this page's
   swellAt(), because the battle's sim clock and its determinism own it. */
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
  /* THE SEA IS THE GAME'S WATER (2026-10-11). The two sheets used to wear a
     private Phong shader (a few cosine ripples and a fresnel tint). They are
     now shaded by the one water material every sea in the game uses
     (world/water_spec.js via CBZ.waterAdoptSea, "external" mode: THIS file's
     swell still displaces the live grid on the CPU, so swellAt() stays the
     one height every body here floats on). Sky reflection off the dome,
     depth colour, crest glow, glint, foam round every hull, and Snell's
     window from below. The far plate is clipped where the live grid is, so
     the two sheets never stack their blend into a visible square.

     transparent + depthWrite:false is still the trick that makes this venue
     work: r128 draws opaque first, so every animal UNDER the water is
     already in the buffer when the surface blends over it. */
  const fallback = function () {
    return new THREE.MeshPhongMaterial({ color: 0x14506c, specular: 0xbfd4e0, shininess: 70,
      transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  };
  const g = new THREE.PlaneGeometry(span, span, seg, seg);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, fallback());
  m.position.set(cx, 0, cz);
  m.renderOrder = 4;
  CBZ.scene.add(m);
  SEA.surf = m; SEA.pos = g.attributes.position; SEA.seg = seg; SEA.span = span;
  SEA.cx = cx; SEA.cz = cz;
  const far = new THREE.PlaneGeometry(26000, 26000);
  far.rotateX(-Math.PI / 2);
  const fm = new THREE.Mesh(far, fallback());
  fm.position.set(cx, 0, cz);
  fm.renderOrder = 3;
  fm.matrixAutoUpdate = false; fm.updateMatrix();
  CBZ.scene.add(fm);
  if (CBZ.waterAdoptSea) {
    CBZ.waterAdoptSea(m, { name: "NPC War Sea", seaY: SEA.y0, depthWrite: false, renderOrder: 4, horizonFuse: false });
    CBZ.waterAdoptSea(fm, { name: "NPC War Far Sea", seaY: SEA.y0, depthWrite: false, renderOrder: 3,
      clip: [cx, cz, span / 2 - 6] });
  }
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
  // the swell's own slope lights the swell (the water material reads them)
  SEA.surf.geometry.computeVertexNormals();
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
  // a hull is steel plate with a ship's insides behind it (src/battle/fire.js)
  const collide = function (w, h, d, x, y, z) { CBZ.micro.addBoxCollider(x, y, z, w, h, d, { mat: "steel", hollow: 0.012 }); };
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
    // the sun's caustic web on the pinnacle's shallow shoulders (world/water_spec.js)
    if (CBZ.waterCausticsApply) CBZ.waterCausticsApply(m);
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
