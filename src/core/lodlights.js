/* ============================================================
   core/lodlights.js — THE CITY AT NIGHT, OUT TO THE HORIZON.

   GTA V calls them LOD lights ("distant lights"): past the few hundred
   metres where real lamps, lit windows and cars are drawn, the night city
   is carried by one tiny glowing sprite per REAL light source, from one
   batch, out to wherever the haze ends. Before this file the far city at
   night was whatever each system happened to keep drawing: a lamp lens
   (a flat, downward-facing ellipse, edge-on from any distance), the metro
   facades' window emission averaged into a flat lit wall once the windows
   went under a pixel, and no cars at all past the live fleet.

   ONE SYSTEM, THREE DRAWS (THREE.Points, additive, never a PointLight —
   r128 recompiles every lit shader when the light count changes):
     static    lamps (city kerb lamps, town lamps, metro street lamps),
               aviation beacons on towers, airfield edge / centreline /
               approach lights, lit panes of the downtown's shells. Each
               light carries colour, size, gain, an optional blink and its
               own near hand-over.
     windows   the metro fabric's facades (metro_fabric.js): one point per
               window cell of every far tile, and the vertex shader runs the
               SAME hash the facade shader runs (mfH(seed + face*37 +
               mode*5, column, floor) < litP), so the dot is lit exactly when
               that window is lit up close, empties as the night gets late
               and takes the same warm/cool tint.
     traffic   head/tail lamps moving along every drivable road record
               (city.roads: the grid, the highway network, the metro
               arterials), animated on the GPU (pos = mix(a, b, fract(phase
               + t * rate))): white when the car drives at you, red when it
               drives away. Density follows traffic.js's hour of day.

   NEAR / FAR. A light hands over to the real thing near the camera:
   lamps and beacons by distance (a smoothstep from `fade` to 2.2x it),
   windows by their size ON SCREEN (the window cell's pixel width,
   1 - smoothstep(2.5, 6 px)), the same measure metro_fabric.js fades its
   own window emission with, so the two cross-fade exactly where the
   facade's windows go under a few pixels. Far away a light keeps a minimum
   pixel size and loses energy as (true size / drawn size)^2 — an
   unresolved light dims with the square of distance, as a real one does.

   THE AIR. Lights wear the city's haze, not the street fog: the same
   scale the metro fabric and the ground use (fog / 0.10) plus the aerial
   extinction length (terrain_overhaul.js HAZE.L0), so a light lives
   exactly as far as the buildings and land it stands on. A light past the
   camera's far plane is slid in along its ray (same pixel, same size).

   DAY / NIGHT: core/daynight.js's CBZ.nightAmount; nothing is drawn by day.

   API (CBZ.lodLights):
     reset(city)                     a new world: drop everything
     lights(key, list)               replace group `key` of static lights;
                                     list items {x,y,z,c:hex,s,g,b,p,f}
                                     (size m, gain, blink Hz (<0 strobe),
                                     phase 0..1, fade m (>0) or -px (<0))
     kill(key, i)                    one static light goes dark (shot out)
     windows(key, n, pos, a, b)      replace a window group (metro_fabric)
     drop(key)                       remove a group from every layer
     stats()
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const THREE = window.THREE;
  if (!THREE || !THREE.Points || !THREE.ShaderMaterial || !THREE.BufferGeometry) return;

  // the haze every far surface wears (metro_fabric FOG_SCALE, metro_ground,
  // the continent plate) and the aerial extinction length (terrain_overhaul
  // HAZE.L0)
  const FOG_SCALE = 0.10, HAZE_L0 = 7500;

  const U = {
    uNight: { value: 0 }, uTime: { value: 0 }, uLate: { value: 0 },
    uProj: { value: 1000 }, uMinPx: { value: 2 },
    uFogNear: { value: 4000 }, uFogFar: { value: 10000 },
    uCamFar: { value: 1400 }, uNear: { value: 0.2 }, uDensity: { value: 0.8 }, uWinKeep: { value: 1 },
  };

  /* ---- the shared vertex tail: size, energy, hand-over, haze, depth ---- */
  const COMMON = [
    "uniform float uNight, uTime, uLate, uProj, uMinPx, uFogNear, uFogFar, uCamFar, uNear, uDensity, uWinKeep;",
    "varying vec3 vC;",
    "varying float vSharp;",
    "void lodCull() { gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 ); gl_PointSize = 0.0; vC = vec3( 0.0 ); vSharp = 0.0; }",
    // wp world position, wsize metres, col rgb, gain, fade (>0 metres, <0 -pixels)
    "void lodOut( vec3 wp, float wsize, vec3 col, float gain, float fade ) {",
    "  vec4 mv = viewMatrix * vec4( wp, 1.0 );",
    "  float d = length( mv.xyz );",
    "  if ( -mv.z < 1.0 ) { lodCull(); return; }",
    "  float px = wsize * uProj / d;",
    "  float ps = max( px, uMinPx );",
    "  float k = px / ps;",
    "  float e = min( 1.0, gain * k * k );",
    "  if ( fade > 0.0 ) e *= smoothstep( fade, fade * 2.2, d );",
    "  else if ( fade < 0.0 ) e *= 1.0 - smoothstep( -fade, -fade * 2.4, px );",
    "  e *= ( 1.0 - smoothstep( uFogNear, uFogFar, d ) ) * exp( -d * " + (1 / HAZE_L0).toFixed(8) + " ) * uNight;",
    "  if ( e < 0.004 ) { lodCull(); return; }",
    // out of its own fixture / facade by the depth buffer's resolution there
    // (dz ~ d^2 / (near * 2^24)), so a window dot never z-fights its wall
    "  float pull = min( 0.4 + 2.5 * d * d / ( uNear * 16777216.0 ), d * 0.05 );",
    "  mv.xyz -= mv.xyz * ( pull / d );",
    // past the far plane: slide in along the ray (same pixel, same size)
    "  float lim = uCamFar * 0.97;",
    "  if ( -mv.z > lim ) mv.xyz *= lim / -mv.z;",
    "  gl_Position = projectionMatrix * mv;",
    "  gl_PointSize = min( ps, 64.0 );",
    "  vC = col * e;",
    "  vSharp = clamp( px / 10.0, 0.0, 1.0 );",
    "}",
  ].join("\n");

  // a round glow: a small sprite is one soft dot, a big one a hot core in a halo
  const FRAG = [
    "varying vec3 vC;",
    "varying float vSharp;",
    "void main() {",
    "  vec2 q = gl_PointCoord * 2.0 - 1.0;",
    "  float r2 = dot( q, q );",
    "  if ( r2 >= 1.0 ) discard;",
    "  float a = exp( -r2 * mix( 2.6, 14.0, vSharp ) ) + vSharp * 0.3 * ( 1.0 - r2 ) * exp( -r2 * 2.2 );",
    "  gl_FragColor = vec4( vC * a, 1.0 );",
    "}",
  ].join("\n");

  // the metro facade's own hash (metro_fabric.js MF_PARS mfH), verbatim
  const MFH = [
    "float mfH( vec3 p ) {",
    "  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );",
    "  p += dot( p, p.yzx + 33.33 );",
    "  return fract( ( p.x + p.y ) * p.z );",
    "}",
  ].join("\n");

  const VS_STATIC = [
    COMMON,
    "attribute vec4 aCol;",      // rgb, gain / 16
    "attribute vec4 aPar;",      // size m, blink Hz (<0 strobe), phase, fade
    "void main() {",
    "  float on = 1.0;",
    "  if ( aPar.y != 0.0 ) {",
    "    float b = fract( uTime * abs( aPar.y ) + aPar.z );",
    "    float duty = aPar.y > 0.0 ? 0.38 : 0.07;",
    "    on = smoothstep( 0.0, 0.03, b ) * ( 1.0 - smoothstep( duty, duty + 0.05, b ) );",
    "  }",
    "  if ( aPar.x <= 0.0 || on <= 0.0 ) { lodCull(); return; }",
    "  lodOut( position, aPar.x, aCol.rgb, aCol.a * 16.0 * on, aPar.w );",
    "}",
  ].join("\n");

  const VS_WINDOWS = [
    COMMON,
    MFH,
    "attribute vec4 aWinA;",     // building seed, facade mode, column, floor
    "attribute vec4 aWinB;",     // normal x/z (n8 + 128), bay width dm, flags (1 office)
    "void main() {",
    "  vec3 N = normalize( vec3( ( aWinB.x - 128.0 ) / 127.0, 0.0, ( aWinB.y - 128.0 ) / 127.0 ) );",
    "  vec3 toEye = cameraPosition - position;",
    "  if ( dot( N.xz, toEye.xz ) <= 0.0 ) { lodCull(); return; }",
    "  float faceId = floor( mod( atan( N.z, N.x ) * 0.63662 + 4.5, 4.0 ) );",
    "  float seed = aWinA.x, mode = aWinA.y;",
    "  float cellH = mfH( vec3( seed + faceId * 37.0 + mode * 5.0, aWinA.z, aWinA.w ) );",
    "  float litP = mix( 0.52 - 0.2 * uLate, 0.66 - 0.54 * uLate, mod( aWinB.w, 2.0 ) );",
    "  if ( cellH >= litP ) { lodCull(); return; }",
    "  float warm = step( 0.32, mfH( vec3( cellH * 7.0, seed * 0.37, 11.0 ) ) );",
    "  vec3 lc = mix( vec3( 0.62, 0.74, 1.0 ), vec3( 1.0, 0.74, 0.42 ), warm ) * ( 0.55 + 0.6 * mfH( vec3( cellH * 3.3, 1.0, seed ) ) );",
    "  lodOut( position, aWinB.z * 0.1, lc, 2.6 / uWinKeep, -2.5 );",
    "}",
  ].join("\n");

  const VS_TRAFFIC = [
    COMMON,
    "attribute vec3 aB;",        // the lane piece's far end (position = its start)
    "attribute vec4 aT;",        // rate 1/s, phase, keep (density hash), size m
    "void main() {",
    "  if ( aT.z > uDensity ) { lodCull(); return; }",
    "  vec3 wp = mix( position, aB, fract( aT.y + uTime * aT.x ) );",
    "  vec2 dir = normalize( aB.xz - position.xz + vec2( 1e-4, 0.0 ) );",
    "  vec2 eye = cameraPosition.xz - wp.xz;",
    "  float head = smoothstep( -0.2, 0.2, dot( dir, eye / max( length( eye ), 1e-3 ) ) );",
    "  vec3 col = mix( vec3( 0.95, 0.06, 0.03 ), vec3( 1.0, 0.92, 0.76 ), head );",
    "  lodOut( wp, aT.w, col, mix( 4.0, 8.0, head ), 160.0 );",
    "}",
  ].join("\n");

  // ---------------------------------------------------------------------
  //  A LAYER: one growable point buffer, groups appended by key
  // ---------------------------------------------------------------------
  function Layer(name, spec, vs) {
    this.name = name;
    this.spec = spec;             // [attribute, itemSize, ArrayType, normalized]
    this.cap = 0; this.n = 0; this.arr = {};
    this.groups = new Map();      // key -> { s, n }
    this.geo = null; this.pts = null; this.rebuild = false;
    this.lo = Infinity; this.hi = -1;
    this.mat = new THREE.ShaderMaterial({
      uniforms: U, vertexShader: vs, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    });
    this.mat.name = "lod-lights-" + name;
  }
  Layer.prototype.grow = function (need) {
    if (need <= this.cap) return;
    let c = Math.max(1024, this.cap);
    while (c < need) c *= 2;
    for (const s of this.spec) {
      const a = new s[2](c * s[1]);
      const old = this.arr[s[0]];
      if (old) a.set(old.subarray(0, this.n * s[1]));
      this.arr[s[0]] = a;
    }
    this.cap = c; this.rebuild = true;
  };
  Layer.prototype.mark = function (a, b) { if (a < this.lo) this.lo = a; if (b > this.hi) this.hi = b; };
  Layer.prototype.drop = function (key) {
    const g = this.groups.get(key);
    if (!g) return;
    this.groups.delete(key);
    const end = g.s + g.n;
    for (const s of this.spec) this.arr[s[0]].copyWithin(g.s * s[1], end * s[1], this.n * s[1]);
    this.n -= g.n;
    this.groups.forEach(function (o) { if (o.s >= end) o.s -= g.n; });
    this.mark(g.s, this.n);
  };
  // fill(arr, s) writes n items starting at item s
  Layer.prototype.set = function (key, n, fill) {
    this.drop(key);
    if (!(n > 0)) return;
    this.grow(this.n + n);
    const s = this.n;
    fill(this.arr, s);
    this.groups.set(key, { s: s, n: n });
    this.n += n;
    this.mark(s, s + n);
  };
  Layer.prototype.clear = function () { this.groups.clear(); this.n = 0; this.lo = Infinity; this.hi = -1; if (this.geo) this.geo.setDrawRange(0, 0); };
  Layer.prototype.flush = function (root) {
    if (!this.cap) return;
    if (this.rebuild || !this.geo) {
      const g = new THREE.BufferGeometry();
      for (const s of this.spec) {
        const a = new THREE.BufferAttribute(this.arr[s[0]], s[1], !!s[3]);
        if (a.setUsage && THREE.DynamicDrawUsage) a.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute(s[0], a);
      }
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
      const old = this.geo;
      this.geo = g;
      if (!this.pts) {
        this.pts = new THREE.Points(g, this.mat);
        this.pts.name = "lod-lights-" + this.name;
        this.pts.frustumCulled = false;
        this.pts.matrixAutoUpdate = false;
        this.pts.renderOrder = 6;
        this.pts.raycast = function () {};          // never a bullet / LOS target
        this.pts.userData.terrain = true;           // core/farcull + batch.js leave it alone
        this.pts.userData.noBatch = true;
      } else this.pts.geometry = g;
      if (old) old.dispose();
      this.rebuild = false; this.lo = Infinity; this.hi = -1;
    } else if (this.hi > this.lo) {
      const lo = this.lo, hi = Math.min(this.hi, this.cap);
      for (const s of this.spec) {
        const a = this.geo.attributes[s[0]];
        a.updateRange.offset = lo * s[1];
        a.updateRange.count = (hi - lo) * s[1];
        a.needsUpdate = true;
      }
      this.lo = Infinity; this.hi = -1;
    }
    this.geo.setDrawRange(0, this.n);
    if (root && this.pts.parent !== root) root.add(this.pts);
  };

  const STATIC = new Layer("static", [["position", 3, Float32Array], ["aCol", 4, Uint8Array, true], ["aPar", 4, Float32Array]], VS_STATIC);
  const WINDOWS = new Layer("windows", [["position", 3, Float32Array], ["aWinA", 4, Uint8Array], ["aWinB", 4, Uint8Array]], VS_WINDOWS);
  const TRAFFIC = new Layer("traffic", [["position", 3, Float32Array], ["aB", 3, Float32Array], ["aT", 4, Float32Array]], VS_TRAFFIC);
  const LAYERS = [STATIC, WINDOWS, TRAFFIC];

  let CITY = null, ROOT = null;

  // ---------------------------------------------------------------------
  //  STATIC LIGHTS
  // ---------------------------------------------------------------------
  function lights(key, list) {
    const n = list ? list.length : 0;
    STATIC.set(key, n, function (A, s) {
      const P = A.position, C = A.aCol, R = A.aPar;
      for (let i = 0; i < n; i++) {
        const L = list[i], k = s + i, k3 = k * 3, k4 = k * 4, c = L.c == null ? 0xffd8a0 : L.c;
        P[k3] = L.x; P[k3 + 1] = L.y; P[k3 + 2] = L.z;
        C[k4] = (c >> 16) & 255; C[k4 + 1] = (c >> 8) & 255; C[k4 + 2] = c & 255;
        C[k4 + 3] = Math.max(1, Math.min(255, Math.round((L.g == null ? 6 : L.g) / 16 * 255)));
        R[k4] = L.s == null ? 1.2 : L.s; R[k4 + 1] = L.b || 0; R[k4 + 2] = L.p || 0; R[k4 + 3] = L.f == null ? 70 : L.f;
      }
    });
  }
  function kill(key, i) {
    const g = STATIC.groups.get(key);
    if (!g || !(i >= 0) || i >= g.n) return;
    const k = g.s + i;
    STATIC.arr.aPar[k * 4] = 0;
    STATIC.mark(k, k + 1);
  }

  // ---------------------------------------------------------------------
  //  WINDOWS (metro_fabric.js hands every far tile's cells over)
  // ---------------------------------------------------------------------
  /* HOW MANY OF THE WINDOWS. The metro's far tiles hold ~0.9 M window cells
     that can ever be lit (seven cities). A desktop takes every one; the
     phone/tablet tiers (quality <= 2) take a fixed half, chosen by a hash of
     the cell, and those dots carry the missing half's light once they are
     under a pixel (their gain / keep), so the far city is as bright on the
     iPad as on the desktop, from half the vertices and half the memory. */
  function windowKeep() { const q = CBZ.qualityLevel == null ? 2 : CBZ.qualityLevel; return q <= 2 ? 0.5 : 1; }
  function windows(key, n, pos, a, b) {
    WINDOWS.set(key, n, function (A, s) {
      A.position.set(pos.subarray(0, n * 3), s * 3);
      A.aWinA.set(a.subarray(0, n * 4), s * 4);
      A.aWinB.set(b.subarray(0, n * 4), s * 4);
    });
  }

  // ---------------------------------------------------------------------
  //  TRAFFIC — every drivable road record, both directions
  // ---------------------------------------------------------------------
  function h01(x, z, salt) {
    if (CBZ.hash01) return CBZ.hash01(x, z, salt);
    const s = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
    return s - Math.floor(s);
  }
  function laneKind(r) {
    if (r.district === "highway" || r.route) return { gap: 46, v: 27, size: 2.2 };
    if (r.rural) return { gap: 170, v: 20, size: 2.0 };
    if (r.metro) return { gap: 82, v: 14, size: 2.0 };
    return { gap: 66, v: 12, size: 2.0 };
  }
  let _laneSig = "";
  function buildTraffic(city) {
    const roads = (city && city.roads) || [];
    const ground = city && typeof city.groundHeightAt === "function" ? city.groundHeightAt
      : (CBZ.cityGroundHeightAt || function () { return 0; });
    const yAt = function (r, x, z) {
      let y = 0;
      try { y = +ground(x, z) || 0; } catch (e) { y = 0; }
      if (r.elevated && CBZ.roadDeckY) y = Math.max(y, CBZ.roadDeckY(r, x, z));
      return y + 0.8;
    };
    const out = [];
    for (const r of roads) {
      if (!r || !(r.len > 30) || r.access || r.noTraffic || r.closed) continue;
      if (!Number.isFinite(r.x) || !Number.isFinite(r.z)) continue;
      const K = laneKind(r);
      const per = Math.min(2, CBZ.roadLanesPerDir ? CBZ.roadLanesPerDir(r) : Math.max(1, r.lanesPerDir | 0));
      const np = Math.max(1, Math.ceil(r.len / 150)), pl = r.len / np;
      const nc = Math.max(1, Math.round(pl / K.gap)), rate = K.v / pl;
      for (const dir of [1, -1]) {
        for (let li = 0; li < per; li++) {
          let lat = 0;
          try { lat = CBZ.roadLaneCenter ? CBZ.roadLaneCenter(r, dir, li) : dir * 3.4 * (li + 0.5); } catch (e) { lat = dir * 3.4 * (li + 0.5); }
          const phi = h01(r.x + dir * 7, r.z + li * 3, 811);
          let pa = null;
          for (let p = 0; p < np; p++) {
            const a0 = -r.len / 2 + p * pl, a1 = a0 + pl;
            const s0 = dir > 0 ? a0 : a1, s1 = dir > 0 ? a1 : a0;
            const ax = r.vertical ? r.x + lat : r.x + s0, az = r.vertical ? r.z + s0 : r.z + lat;
            const bx = r.vertical ? r.x + lat : r.x + s1, bz = r.vertical ? r.z + s1 : r.z + lat;
            const ay = pa && Math.abs(pa.x - ax) < 0.01 && Math.abs(pa.z - az) < 0.01 ? pa.y : yAt(r, ax, az);
            const by = yAt(r, bx, bz);
            pa = { x: bx, z: bz, y: by };
            for (let j = 0; j < nc; j++) {
              const hj = h01(ax + j * 1.7, az - j * 2.3, 812);
              out.push(ax, ay, az, bx, by, bz, rate, (phi + (j + (hj - 0.5) * 0.35) / nc + 1) % 1, h01(ax - j, az + j * 5.1, 813), K.size);
            }
          }
        }
      }
    }
    const n = out.length / 10;
    TRAFFIC.set("roads", n, function (A, s) {
      const P = A.position, B = A.aB, T = A.aT;
      for (let i = 0; i < n; i++) {
        const o = i * 10, k = s + i;
        P[k * 3] = out[o]; P[k * 3 + 1] = out[o + 1]; P[k * 3 + 2] = out[o + 2];
        B[k * 3] = out[o + 3]; B[k * 3 + 1] = out[o + 4]; B[k * 3 + 2] = out[o + 5];
        T[k * 4] = out[o + 6]; T[k * 4 + 1] = out[o + 7]; T[k * 4 + 2] = out[o + 8]; T[k * 4 + 3] = out[o + 9];
      }
    });
  }

  // ---------------------------------------------------------------------
  //  TOWER BEACONS — every shell buildings.js raised (downtown, towns,
  //  compounds): a red aviation light on anything over 70 m
  // ---------------------------------------------------------------------
  function beacon(list, x, y, z, salt) {
    list.push({ x: x, y: y, z: z, c: 0xff2412, s: 1.3, g: 12, b: 0.6, p: h01(x, z, salt), f: 45 });
  }
  function buildShellBeacons(city) {
    const shells = (city && city.root && city.root.userData && city.root.userData.shells) || [];
    const ground = city && typeof city.groundHeightAt === "function" ? city.groundHeightAt : null;
    const list = [];
    for (const b of shells) {
      if (!b || !(+b.h >= 70)) continue;
      const x = Number.isFinite(b.ox) ? b.ox : null, z = Number.isFinite(b.oz) ? b.oz : null;
      if (x == null || z == null) continue;
      let y0 = Number.isFinite(b.oy) ? b.oy : 0;
      if (!Number.isFinite(b.oy) && ground) { try { y0 = +ground(x, z) || 0; } catch (e) { y0 = 0; } }
      const y = y0 + b.h + (+b.parapetH || 0) + 1.2;
      const hw = Math.max(1, (+b.w || 10) / 2 - 1), hd = Math.max(1, (+b.d || 10) / 2 - 1);
      beacon(list, x - hw, y, z - hd, 901); beacon(list, x + hw, y, z + hd, 901);
    }
    lights("shell-beacons", list);
  }

  // ---------------------------------------------------------------------
  //  THE DRIVER
  // ---------------------------------------------------------------------
  let sweepT = 0, roadsSeen = -1, shellsSeen = -1;
  function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function tick(dt) {
    const g = CBZ.game;
    // THE ISLES carry their night to the horizon the same way: their lamps and
    // lit windows are static groups (world/island_night.js, keys "isle:*"),
    // hung on the scene because the archipelago has no city root. The city's
    // own groups stay in the buffers, thirty kilometres off past the haze.
    const isles = !!(g && g.mode === "archipelago" && CBZ.scene);
    const live = !!(g && ((g.mode === "city" && ROOT && CITY) || isles));
    const n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    const night = live ? smooth(0.1, 0.55, n) : 0;
    U.uNight.value = night;
    const show = night > 0.003;
    for (const L of LAYERS) if (L.pts && L.pts.visible !== show) L.pts.visible = show;
    if (!live) return;
    dt = +dt || 0.016;
    U.uTime.value = (U.uTime.value + dt) % 7200;
    // late passes and new roads/shells (streamed builders add both)
    if (!isles) sweepT -= dt;
    if (!isles && sweepT <= 0) {
      sweepT = 2;
      const nr = (CITY.roads || []).length;
      if (nr !== roadsSeen) { roadsSeen = nr; try { buildTraffic(CITY); } catch (e) { console.error("[lodlights] traffic", e); } }
      const sh = (CITY.root && CITY.root.userData && CITY.root.userData.shells) || [];
      if (sh.length !== shellsSeen) { shellsSeen = sh.length; try { buildShellBeacons(CITY); } catch (e) { console.error("[lodlights] beacons", e); } }
    }
    for (const L of LAYERS) L.flush(isles ? CBZ.scene : ROOT);
    if (!show) return;
    const MF = CBZ.metroFabric && CBZ.metroFabric.uniforms;
    U.uLate.value = MF && MF.uMfLate ? MF.uMfLate.value : 0;
    U.uProj.value = CBZ.sightPixelRange ? CBZ.sightPixelRange(1) : 1000;
    const cv = CBZ.renderer && CBZ.renderer.domElement;
    U.uMinPx.value = cv && cv.height > 0 ? Math.max(1.5, Math.min(3, cv.height / 700)) : 2;
    const cam = CBZ.camera;
    if (cam) { U.uCamFar.value = cam.far || 1400; U.uNear.value = cam.near || 0.2; }
    const fog = CBZ.scene && CBZ.scene.fog;
    if (fog && fog.far > 0) {
      // under water the haze stops scaling (terrain_overhaul.js)
      const HP = CBZ.aerialHazeUniforms && CBZ.aerialHazeUniforms.uCbzHazePar;
      const dry = HP ? Math.max(0, Math.min(1, HP.value.w)) : 1;
      const k = FOG_SCALE + (1 - FOG_SCALE) * (1 - dry);
      U.uFogNear.value = (fog.near || 0) / k;
      U.uFogFar.value = Math.max(U.uFogNear.value + 1, fog.far / k);
    }
    U.uWinKeep.value = windowKeep();
    const dens = CBZ.trafficHourDensity ? CBZ.trafficHourDensity() : 0.8;
    U.uDensity.value = Math.max(0, Math.min(1, dens / 1.25));
  }

  function reset(city) {
    CITY = city || null;
    ROOT = city && city.root ? city.root : null;
    for (const L of LAYERS) L.clear();
    roadsSeen = -1; shellsSeen = -1; sweepT = 0;
  }
  function drop(key) { for (const L of LAYERS) L.drop(key); }

  CBZ.lodLights = {
    reset: reset, lights: lights, kill: kill, windows: windows, windowKeep: windowKeep, drop: drop, uniforms: U,
    stats: function () {
      return { static: STATIC.n, windows: WINDOWS.n, traffic: TRAFFIC.n, groups: STATIC.groups.size + WINDOWS.groups.size + TRAFFIC.groups.size,
        drawCalls: LAYERS.filter(function (L) { return L.pts && L.pts.visible && L.n > 0; }).length };
    },
  };
  if (CBZ.onAlways) CBZ.onAlways(96.5, tick);
})();
