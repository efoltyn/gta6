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

   API:  CBZ.islandRoomLight(material, glow)   hook a material (inKit calls it)
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
        const x = p.ox + p.Ax * t + p.Cx * side * 4.25, z = p.oz + p.Az * t + p.Cz * side * 4.25;
        side = -side;
        const y = T.groundAt(x, z);
        if (!(y > (T.oceanY != null ? T.oceanY : 0) - 0.5)) continue;
        out.push({ x: x, y: y + 6.0, z: z, c: 0xffb469, s: 1.3, g: 7, f: 140 });
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
            out.push({ x: x, y: gy + ly, z: z, c: warm ? 0xffc98c : 0xdfe6ff, s: 1.1, g: 3.2, f: 210 });
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

  CBZ.islandNight = {
    roomLit: roomLit,
    uniforms: U,
    state: function () { return { night: +nightK.toFixed(3), islands: done.size, keep: KEEP }; },
  };
})();
