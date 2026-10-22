/* ============================================================
   world/island_night.js — THE ISLES AFTER DARK: the light that is left
   when the sun has gone.

   Owner, 2026-10-22: "there needs to be night, that needs to be super dark."
   modes/survival.js grades the isles' night (deep blue-black, the moon by
   its phase, no grey wash) and core/sky.js puts the stars up. What you see
   by after that is only ever a real light, and this file is two of them:

   1. THE ROOMS ARE LIT BY THEIR OWN FIXTURES. Every island interior is
      merged per material by world/disaster_arena.js inKit (oak, tile,
      carpet, plaster, ceiling, furniture, and the "glow" fixtures: domes,
      pendants, troffers, bedside lamps). Their light pools were baked into
      the floors' vertex colours, but the light that reached a room was the
      sky's, so after dark every room went as black as the street and the
      town had no windows. CBZ.islandRoomLight(mat) gives those materials the
      room's own light: a warm term on the surface's own colour (its baked
      pools included), ramped in with the dark (CBZ.lightsOnAmount, so a
      black storm lights them too), never a THREE light, no shadow, one
      uniform for the whole archipelago. Not every room: a room is a 6 m cell
      of one storey of one building, and a hash keeps about six in ten of
      them lit; the one you are standing in is always lit (you put the light
      on). Its fixtures glow only when it is lit. Through the glass that IS
      the town's lit windows, from the street, from the sea, from the air.

   2. THE NIGHT TO THE HORIZON (owner: "night = LOD light dots to horizon").
      core/lodlights.js carries the city's far lamps and windows as one
      additive sprite per real light. Every island here adds its own group
      ("isle:<id>") once its plan exists (which is at boot for all of them):
      a dot per street lamp where world/island_roads.js stands one, and a dot
      per LIT window, lit by the SAME hash the rooms above use, so the dot
      you saw from the sea is the room you walk into. Near, the dots hand
      over to the real lamps and rooms.

   Gang City and the disaster island are untouched: the room term is zero
   outside the isles, and the isles' dots sit thirty kilometres from the
   city, past any haze.

   3. THE LAMPS GLOW (section 3 below): every street lamp and plaza lantern
      head carries an additive glow, and lamps that lay no pool of their own
      get one, handing over to their LOD light where they go under a pixel.

   API:  CBZ.islandRoomLight(material, glow)   hook a material (inKit calls it)
         CBZ.islandLampGlow(root, heads)       glow points (+ pools) for lamp heads
         CBZ.islandNight.roomLit(ox, oz, lx, ly, lz)  the hash, in JS
         CBZ.islandNight.state()                      numbers
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const FH = (CBZ.islandBuilding && CBZ.islandBuilding.FH) || 3.4;   // floor-to-floor (island_building.js)
  const CELL = 6.0;          // a "room" for the switch: 6 m of one storey of one building
  const KEEP = 0.62;         // how many of them are lit after dark
  const WARM = [1.0, 0.80, 0.58];
  const GAIN = 0.62;         // what a lit room's fixtures give the surfaces in it
  const NEAR2 = 9 * 9;       // your own room, always on
  const LAMP_GAIN = 120;     // a lamp's / a lit window's energy as a far LOD light (core/lodlights.js)
  const WIN_GAIN = 24;

  const U = {
    cbzRoomLight: { value: new THREE.Color(0, 0, 0) },
    cbzRoomNight: { value: 0 },
    cbzRoomKeep: { value: KEEP },
    cbzRoomEye: { value: new THREE.Vector3(0, -1e5, 0) },
  };

  /* ---- THE SWITCH, as GLSL and as JS (the same arithmetic) -------------- */
  const GLSL_H = [
    "uniform vec3 cbzRoomLight;",
    "uniform float cbzRoomNight;",
    "uniform float cbzRoomKeep;",
    "uniform vec3 cbzRoomEye;",
    "varying vec3 vCbzRoomL;",
    "varying vec3 vCbzRoomW;",
    "varying vec2 vCbzRoomO;",
    "float cbzRoomH( vec3 p ) {",
    "  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );",
    "  p += dot( p, p.yzx + 33.33 );",
    "  return fract( ( p.x + p.y ) * p.z );",
    "}",
    "float cbzRoomOn() {",
    "  vec2 o = mod( floor( vCbzRoomO * 0.37 ), 251.0 );",
    "  vec3 c = vec3( floor( vCbzRoomL.x / " + CELL.toFixed(1) + " ) + o.x * 37.0, floor( vCbzRoomL.y / " + FH.toFixed(3) + " ) + 13.0, floor( vCbzRoomL.z / " + CELL.toFixed(1) + " ) + o.y * 17.0 );",
    "  float on = step( cbzRoomH( c ), cbzRoomKeep );",
    "  vec3 d = vCbzRoomW - cbzRoomEye;",
    "  if ( abs( d.y ) < 2.2 && dot( d.xz, d.xz ) < " + NEAR2.toFixed(1) + " ) on = 1.0;",
    "  return on;",
    "}",
  ].join("\n");
  function fract(v) { return v - Math.floor(v); }
  function roomH(x, y, z) {
    let px = fract(x * 0.1031), py = fract(y * 0.1030), pz = fract(z * 0.0973);
    const d = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
    px += d; py += d; pz += d;
    return fract((px + py) * pz);
  }
  function mod251(v) { return ((Math.floor(v * 0.37) % 251) + 251) % 251; }
  // (ox, oz) the building's origin; (lx, ly, lz) a point in its own frame
  function roomLit(ox, oz, lx, ly, lz) {
    const c0 = Math.floor(lx / CELL) + mod251(ox) * 37, c1 = Math.floor(ly / FH) + 13, c2 = Math.floor(lz / CELL) + mod251(oz) * 17;
    return roomH(c0, c1, c2) <= KEEP;
  }

  /* ---- THE HOOK (world/disaster_arena.js inMat) ------------------------- */
  CBZ.islandRoomLight = function (mat, glow) {
    if (!mat || mat.userData && mat.userData._cbzRoomLight) return mat;
    mat.userData = mat.userData || {};
    mat.userData._cbzRoomLight = true;
    const prev = mat.onBeforeCompile;
    const prevKey = Object.prototype.hasOwnProperty.call(mat, "customProgramCacheKey") ? mat.customProgramCacheKey : null;
    mat.onBeforeCompile = function (sh, r) {
      if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(this, sh, r);
      const OUT = "gl_FragColor = vec4( outgoingLight, diffuseColor.a );";
      if (sh.fragmentShader.indexOf(OUT) < 0 || sh.vertexShader.indexOf("#include <project_vertex>") < 0) return;
      sh.uniforms.cbzRoomLight = U.cbzRoomLight;
      sh.uniforms.cbzRoomNight = U.cbzRoomNight;
      sh.uniforms.cbzRoomKeep = U.cbzRoomKeep;
      sh.uniforms.cbzRoomEye = U.cbzRoomEye;
      sh.vertexShader = "varying vec3 vCbzRoomL;\nvarying vec3 vCbzRoomW;\nvarying vec2 vCbzRoomO;\n" +
        sh.vertexShader.replace("#include <project_vertex>",
          "#include <project_vertex>\n" +
          "  vCbzRoomL = transformed;\n" +
          "  vCbzRoomW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n" +
          "  vCbzRoomO = vec2( modelMatrix[ 3 ][ 0 ], modelMatrix[ 3 ][ 2 ] );");
      sh.fragmentShader = GLSL_H + "\n" + sh.fragmentShader.replace(OUT, glow
        // a fixture glows when its room is lit (by day it is daylight anyway)
        ? "outgoingLight *= mix( 1.0, mix( 0.12, 1.0, cbzRoomOn() ), cbzRoomNight );\n" + OUT
        : "if ( cbzRoomNight > 0.001 ) outgoingLight += diffuseColor.rgb * cbzRoomLight * cbzRoomOn();\n" + OUT);
    };
    mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : "") + "|cbz-room-" + (glow ? "g" : "s"); };
    mat.needsUpdate = true;
    return mat;
  };

  /* ---- THE DIAL, once a frame ------------------------------------------- */
  let nightK = 0;
  function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  if (CBZ.onAlways) CBZ.onAlways(95.2, function () {
    const g = CBZ.game;
    const isles = !!(g && g.mode === "archipelago");
    const dark = isles ? (CBZ.lightsOnAmount ? CBZ.lightsOnAmount() : (CBZ.nightAmount || 0)) : 0;
    nightK = isles ? smooth(0.15, 0.7, dark) : 0;
    U.cbzRoomNight.value = nightK;
    U.cbzRoomLight.value.setRGB(WARM[0] * GAIN * nightK, WARM[1] * GAIN * nightK, WARM[2] * GAIN * nightK);
    const P = CBZ.player;
    if (P && P.pos) U.cbzRoomEye.value.set(P.pos.x, P.pos.y + 0.9, P.pos.z);
    if (isles) lodTick();
    // the street lamps, on every island mode (the disaster island's too: its
    // lenses already brightened with the same measure)
    const lit = CBZ.islandModeOn && CBZ.islandModeOn(g && g.mode) && CBZ.lightsOnAmount ? CBZ.lightsOnAmount() : 0;
    LAMP_U.uLampOn.value = smooth(0.3, 0.7, lit);
    if (LAMP_U.uLampOn.value > 0 && CBZ.sightPixelRange) LAMP_U.uLampProj.value = CBZ.sightPixelRange(1);
  });

  /* ---- THE DOTS TO THE HORIZON ------------------------------------------ */
  const done = new Set();          // island ids whose group is filed
  let sweep = 0;
  function lampDots(T, out) {
    const P = T.plan, R = P && P.roads;
    if (!R || !R.pieces) return;
    let side = 1;
    for (const p of R.pieces) {
      const len = p.b - p.a, usable = len - 22;
      if (usable < 0) continue;
      const n = 1 + Math.floor(usable / 30);
      for (let k = 0; k < n; k++) {
        const t = n === 1 ? (p.a + p.b) / 2 : p.a + 11 + usable * k / (n - 1);
        // the head, where world/island_roads.js hangs it: 7.5 m up on a 2.2 m
        // arm over the road
        const off = side * (4.25 - 2.2);
        const x = p.ox + p.Ax * t + p.Cx * side * 4.25, z = p.oz + p.Az * t + p.Cz * side * 4.25;
        const hx = p.ox + p.Ax * t + p.Cx * off, hz = p.oz + p.Az * t + p.Cz * off;
        side = -side;
        const y = T.groundAt(x, z);
        if (!(y > (T.oceanY != null ? T.oceanY : 0) - 0.5)) continue;
        // the gain is what a real lamp has at range: an unresolved light keeps
        // (true px / drawn px)^2 of it, so a town's lamps still read as a
        // string of points across the water from the next island
        out.push({ x: hx, y: y + 7.4, z: hz, c: 0xffb469, s: 1.3, g: LAMP_GAIN, f: 140 });
      }
    }
  }
  function windowDots(T, out) {
    const P = T.plan;
    if (!P || !P.lots) return;
    for (const l of P.lots) {
      if (l.kind === "station" || l.kind === "showroom") continue;
      const storeys = Math.max(1, l.storeys | 0);
      const tower = l.kind === "tower" || l.kind === "hotel";
      const ox = l.x, oz = l.z, yaw = tower ? 0 : (l.yaw || 0);
      const w = l.w, d = l.d;
      if (!(w > 2 && d > 2)) continue;
      const gy = tower || l.gy == null ? T.groundAt(ox, oz) : l.gy;
      const co = Math.round(Math.cos(yaw)), si = Math.round(Math.sin(yaw));
      // the four faces in the building's frame: [axis along, fixed coord, outward sign]
      const faces = [["x", -d / 2, -1], ["x", d / 2, 1], ["z", -w / 2, -1], ["z", w / 2, 1]];
      for (const F of faces) {
        const span = F[0] === "x" ? w : d;
        const nb = Math.max(1, Math.floor((span - 1.6) / 3.2));
        for (let k = 0; k < storeys; k++) {
          const ly = k * FH + 1.6;
          for (let i = 0; i < nb; i++) {
            const a = -span / 2 + 0.8 + (i + 0.5) * (span - 1.6) / nb;
            // a point a metre inside the window: the room it lights
            const inX = F[0] === "x" ? a : F[1] - F[2] * 1.0, inZ = F[0] === "x" ? F[1] - F[2] * 1.0 : a;
            if (!roomLit(ox, oz, inX, ly, inZ)) continue;
            const oX = F[0] === "x" ? a : F[1] + F[2] * 0.06, oZ = F[0] === "x" ? F[1] + F[2] * 0.06 : a;
            const x = ox + oX * co + oZ * si, z = oz - oX * si + oZ * co;
            const warm = roomH(i, k, ox * 0.01) < 0.7;
            out.push({ x: x, y: gy + ly, z: z, c: warm ? 0xffc98c : 0xdfe6ff, s: 1.1, g: WIN_GAIN, f: 210 });
          }
        }
      }
    }
  }
  function lodTick() {
    const LL = CBZ.lodLights, AR = CBZ.archipelago;
    if (!LL || !LL.lights || !AR || !AR.isles) return;
    if ((sweep -= 1) > 0) return;
    sweep = 30;                    // twice a second is plenty: islands' plans exist from boot
    const list = AR.isles();
    for (const I of list) {
      if (!I || done.has(I.id) || !I.terrain || !I.terrain.plan) continue;
      const out = [];
      try { lampDots(I.terrain, out); windowDots(I.terrain, out); } catch (e) { console.error("[island night " + I.id + "]", e); }
      LL.lights("isle:" + I.id, out);
      done.add(I.id);
    }
  }
  // the archipelago leaving takes its dots with it (a new world may differ)
  if (CBZ.onAlways) CBZ.onAlways(4.6, function () {
    const g = CBZ.game;
    if (!done.size || (g && g.mode === "archipelago")) return;
    const LL = CBZ.lodLights;
    if (LL && LL.drop) done.forEach(function (id) { LL.drop("isle:" + id); });
    done.clear();
  });

  /* ---- 3. THE STREET LAMPS GLOW ------------------------------------------
     A lamp's lens is a flat quad under its head (world/island_roads.js), a
     plaza lantern a glass box (world/island_dressing.js): from the street,
     edge-on, a lamp at night was a dark head on a pole. Every head now also
     carries a glow: one additive point per lamp in ONE draw per island (a
     hot core in a soft halo, sized in metres, so it shrinks with distance
     like the real thing), handing over to its LOD light (core/lodlights.js,
     the same 140 m band island_night.js files those at) where it goes under
     a few pixels. A lamp with `gy` also gets its pool on the ground here (the
     road lamps lay their own, conformed to kerb and camber). No THREE
     light, no shadow: a phone pays one point and one disc per lamp.
       CBZ.islandLampGlow(root, heads)  heads [{ x, y, z, gy?, r? }] -> { points, pool }
     Driven by the dial below (lightsOnAmount, on any island mode). */
  const LAMP_U = {
    uLampOn: { value: 0 },
    uLampProj: { value: 1000 },
    uLampFade: { value: new THREE.Vector2(140, 308) },
    uLampCol: { value: new THREE.Color(1.0, 0.80, 0.56) },
  };
  const GLOW_VS = [
    "uniform float uLampOn, uLampProj;",
    "uniform vec2 uLampFade;",
    "attribute float aSize;",
    "varying float vE;",
    "varying float vSharp;",
    "void main() {",
    "  vec4 mv = modelViewMatrix * vec4( position, 1.0 );",
    "  float d = length( mv.xyz );",
    "  float px = aSize * uLampProj / max( d, 0.5 );",
    "  float ps = clamp( px, 1.5, 220.0 );",
    "  float k = min( 1.0, px / ps );",
    "  vE = uLampOn * k * k * ( 1.0 - smoothstep( uLampFade.x, uLampFade.y, d ) );",
    "  vSharp = clamp( px / 24.0, 0.0, 1.0 );",
    // in front of its own head (seen from the side or above, the housing
    // would otherwise eat the bulb)
    "  mv.xyz *= max( 0.0, d - 0.7 ) / max( d, 0.001 );",
    "  gl_Position = projectionMatrix * mv;",
    "  gl_PointSize = ps;",
    "  if ( vE < 0.003 || -mv.z < 0.3 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );",
    "}",
  ].join("\n");
  const GLOW_FS = [
    "uniform vec3 uLampCol;",
    "varying float vE;",
    "varying float vSharp;",
    "void main() {",
    "  vec2 q = gl_PointCoord * 2.0 - 1.0;",
    "  float r2 = dot( q, q );",
    "  if ( r2 >= 1.0 ) discard;",
    // close up: a white-hot bulb in a warm halo; small: one soft dot
    "  float core = exp( -r2 * mix( 3.0, 40.0, vSharp ) );",
    "  float halo = exp( -r2 * 4.0 ) * ( 1.0 - r2 ) * 0.42;",
    "  vec3 c = uLampCol * ( core * 1.25 + halo ) + vec3( 0.35, 0.3, 0.22 ) * core * vSharp;",
    "  gl_FragColor = vec4( c * vE, 1.0 );",
    "}",
  ].join("\n");
  const POOL_VS = [
    "attribute float aR;",
    "varying float vR;",
    "varying float vD;",
    "void main() {",
    "  vR = aR;",
    "  vec4 mv = modelViewMatrix * vec4( position, 1.0 );",
    "  vD = length( mv.xyz );",
    "  gl_Position = projectionMatrix * mv;",
    "}",
  ].join("\n");
  const POOL_FS = [
    "uniform float uLampOn;",
    "uniform vec3 uLampCol;",
    "varying float vR;",
    "varying float vD;",
    "void main() {",
    "  float f = clamp( 1.0 - vR, 0.0, 1.0 );",
    "  f = f * f * ( 3.0 - 2.0 * f );",
    "  float e = uLampOn * f * 0.55 * ( 1.0 - smoothstep( 160.0, 320.0, vD ) );",
    "  if ( e < 0.002 ) discard;",
    "  gl_FragColor = vec4( uLampCol * e, 1.0 );",
    "}",
  ].join("\n");
  function glowMat() {
    const m = new THREE.ShaderMaterial({
      uniforms: { uLampOn: LAMP_U.uLampOn, uLampProj: LAMP_U.uLampProj, uLampFade: LAMP_U.uLampFade, uLampCol: LAMP_U.uLampCol },
      vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
      transparent: true, depthWrite: false, depthTest: true, fog: false, blending: THREE.AdditiveBlending,
    });
    m.name = "island-lamp-glow";
    return m;
  }
  function poolMat() {
    const m = new THREE.ShaderMaterial({
      uniforms: { uLampOn: LAMP_U.uLampOn, uLampCol: LAMP_U.uLampCol },
      vertexShader: POOL_VS, fragmentShader: POOL_FS,
      transparent: true, depthWrite: false, depthTest: true, fog: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    m.name = "island-lamp-pool";
    return m;
  }
  CBZ.islandLampGlow = function (root, heads, o) {
    if (!root || !heads || !heads.length) return null;
    o = o || {};
    const n = heads.length, pos = new Float32Array(n * 3), size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const h = heads[i];
      pos[i * 3] = h.x; pos[i * 3 + 1] = h.y; pos[i * 3 + 2] = h.z;
      size[i] = h.s || o.size || 1.7;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.computeBoundingSphere();
    const pts = new THREE.Points(g, glowMat());
    pts.name = "island-lamp-glow";
    pts.renderOrder = 3;
    pts.matrixAutoUpdate = false; pts.updateMatrix();
    pts.userData.dynamic = true; pts.userData.noCoat = true;
    root.add(pts);
    // the pools of the lamps that do not lay their own: flat discs on the ground
    let pool = null;
    const SEG = 14, withPool = heads.filter(function (h) { return h.gy != null; });
    if (withPool.length) {
      const vp = new Float32Array(withPool.length * (SEG + 1) * 3), vr = new Float32Array(withPool.length * (SEG + 1));
      const idx = [];
      withPool.forEach(function (h, k) {
        const b = k * (SEG + 1), r = h.r || 4.5;
        vp[b * 3] = h.x; vp[b * 3 + 1] = h.gy + 0.02; vp[b * 3 + 2] = h.z; vr[b] = 0;
        for (let j = 0; j < SEG; j++) {
          const a = j / SEG * Math.PI * 2, q = b + 1 + j;
          vp[q * 3] = h.x + Math.cos(a) * r; vp[q * 3 + 1] = h.gy + 0.02; vp[q * 3 + 2] = h.z + Math.sin(a) * r; vr[q] = 1;
          idx.push(b, b + 1 + ((j + 1) % SEG), b + 1 + j);
        }
      });
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", new THREE.BufferAttribute(vp, 3));
      pg.setAttribute("aR", new THREE.BufferAttribute(vr, 1));
      pg.setIndex(idx);
      pg.computeBoundingSphere();
      pool = new THREE.Mesh(pg, poolMat());
      pool.name = "island-lamp-pool";
      pool.renderOrder = 2;
      pool.matrixAutoUpdate = false; pool.updateMatrix();
      pool.userData.dynamic = true; pool.userData.roadPaint = true; pool.userData.noCoat = true;
      root.add(pool);
    }
    return { points: pts, pool: pool };
  };

  CBZ.islandNight = {
    roomLit: roomLit,
    uniforms: U,
    lampUniforms: LAMP_U,
    state: function () { return { night: +nightK.toFixed(3), lamps: +LAMP_U.uLampOn.value.toFixed(3), islands: done.size, keep: KEEP }; },
  };
})();
