/* ============================================================
   city/airport_kit.js — EVERY AIRFIELD IN THE GAME, FROM ONE SPEC.

   OWNER (2026-09-29): "put an agent on airports ... Make them more real. It's
   all poorly drawn right now, but close. Just redraw it all, like you did with
   cars."

   THIS FILE IS THE ONLY PLACE AN AIRFIELD IS DRAWN. Halloran Field
   (island_airport.js) and Cape Harbor Regional (airport_capeharbor.js) are both
   one call to CBZ.buildAirfield(city, spec). There used to be two airports'
   worth of hand-drawn ground, paint, lights, terminals and towers (Halloran's
   own ~900 lines of world-coordinate geometry plus a second, smaller copy
   here); both are gone. What stays in island_airport.js is what only Halloran
   has: the aircraft and cabin systems, the tower climb, the taxi rank, the
   causeway and the island's roads.

   EVERYTHING IS AUTHORED TO REAL-WORLD NUMBERS, in the field's local frame
   (systems/airports.js: origin = runway midpoint, +X down the runway, +Z the
   apron side). The aeroplane is the A320-class airliner at AIRLINER_SCALE
   (1.45), i.e. a 52 m span, 54.5 m hull: an ICAO code E aeroplane, so the
   field is a code E field:
     runway          45 m wide, 7.5 m paved shoulders, ICAO Annex 14 paint:
                     threshold stripes 30 x 1.8 m (12 of them at 45 m),
                     designator 9 m tall, centreline 30 m on / 20 m off at
                     0.9 m, side stripes 0.9 m, aiming point and touchdown
                     zone pairs by landing distance, blast pad chevrons.
     lights          elevated edge lights every 60 m (white, last 600 m
                     yellow), green threshold / red end bars, inset centreline
                     lights every 15 m (white, then alternating, then red),
                     blue taxiway edge, green taxiway centreline, red stop bars
                     at every holding position, a MALSR-pattern approach
                     lighting system with sequenced flashers, a PAPI.
     taxiways        23 m wide, yellow centreline, runway-holding positions
                     75 m from the runway centreline (pattern A), mandatory
                     and location signs.
     stands          nose-in contact stands with curved lead-in lines, stop
                     bars at the nose gear, stand numbers, red safety lines,
                     head-of-stand service road; remote stands taxi-through.
     buildings       a walkable terminal (curtain walls, long-span roof on
                     tree columns, check-in islands, security, reclaim, gate
                     lounge; at a two-level terminal a gate floor with jet
                     bridges docked to the L1 door of the aircraft on stand);
                     control tower with a raked-glass cab; arched and portal
                     hangars with sliding door leaves; fuel farm; ARFF fire
                     station; cargo shed and ULDs; multi-storey car park and
                     rental lot; ASR radar and radome; ILS localizer and
                     glideslope; apron floodlight masts; perimeter fence.

   COST. The field's ground and every marking are ONE plane on ONE canvas.
   Lights are instanced by colour. Every building is merged per material. The
   airside and landside DRESSING (hangars, fuel farm, fire station, cargo,
   radar, ILS, approach lights, car park, rental) is built through
   CBZ.sliceAt, the city streamer: without streaming it builds with the world;
   with ?stream=1 it is built before it can be seen and parked/freed when the
   player leaves. Nothing here adds a light object.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
  const mat = CBZ.mat || function (c, o) {
    const m = new THREE.MeshLambertMaterial({ color: c });
    if (o && o.emissive != null) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.ei == null ? 1 : o.ei; }
    return m;
  };

  // real reference numbers, published so the node check and any consumer read
  // the same table (ICAO Annex 14 / FAA AC 150/5340-1 / 150/5345-46).
  const REAL = Object.freeze({
    runwayW: 45, shoulder: 7.5, taxiW: 23, taxiShoulder: 10.5,
    thrStripeL: 30, thrStripeW: 1.8, thrGap: 1.8, thrStartIn: 6,
    designatorH: 9, designatorGap: 12,
    clStripeL: 30, clGap: 20, clW: 0.9, sideW: 0.9,
    tdzStripeL: 22.5, tdzStripeW: 1.8, tdzGap: 1.5,
    holdFromCL: 75,                   // runway-holding position, code E, non-precision (m from runway CL)
    edgeLightStep: 60, clLightStep: 15, taxiClLightStep: 30,
    malsrLen: 420, malsrBarStep: 60, flasherStep: 60, flashers: 5,
    papiFromEdge: 15, papiSpacing: 9,
    towerCabRake: 15,                 // degrees the tower glass leans out
    bridgeFloorSlopeMax: 0.083,       // 1:12
  });
  CBZ.AIRFIELD_REAL = REAL;

  function hash01(x, z, s) {
    if (CBZ.hash01) return CBZ.hash01(x, z, s);
    const n = Math.sin(x * 127.1 + z * 311.7 + (s || 0) * 0.017) * 43758.5453;
    return n - Math.floor(n);
  }

  /* ==============================================================
     CBZ.airfieldParts — the hardware library. marina.js also builds
     from its primitives (put / boxM / member / addMerged / mats).
     ============================================================== */
  const P = {};
  CBZ.airfieldParts = P;
  P.REAL = REAL;

  function BGU() { return THREE.BufferGeometryUtils; }
  // attribute-normalising merge: every piece gets position/normal/uv and is
  // non-indexed, so shapes from different generators always merge
  function norm(g) {
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") g.deleteAttribute(k);
    return g;
  }
  function mergeGeos(geos) {
    const U = BGU();
    if (!geos.length || !U || !U.mergeBufferGeometries) return null;
    const list = [];
    for (let i = 0; i < geos.length; i++) if (geos[i]) list.push(norm(geos[i]));
    if (!list.length) return null;
    const m = U.mergeBufferGeometries(list);
    for (const g of list) g.dispose();
    return m;
  }
  function addMerged(parent, geos, material, opts) {
    if (!geos || !geos.length) return null;
    opts = opts || {};
    const g = mergeGeos(geos);
    if (g) {
      const m = new THREE.Mesh(g, material);
      m.castShadow = !!opts.cast; m.receiveShadow = opts.receive !== false;
      m.matrixAutoUpdate = false; m.updateMatrix();
      if (opts.name) m.name = opts.name;
      parent.add(m);
      return m;
    }
    for (const gg of geos) {
      const m = new THREE.Mesh(gg, material);
      m.castShadow = !!opts.cast; m.receiveShadow = opts.receive !== false;
      parent.add(m);
    }
    return null;
  }
  P.addMerged = addMerged;
  P.mergeGeos = mergeGeos;

  // UVs in metres / tile, so a texture reads at its real size on any box.
  function boxM(w, h, d, tile, swap) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv, t = tile || 1;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      const u = uv.getX(i) * dims[f][0] / t, v = uv.getY(i) * dims[f][1] / t;
      if (swap) uv.setXY(i, v, u); else uv.setXY(i, u, v);
    }
    return g;
  }
  function uvScale(g, su, sv) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    return g;
  }
  // rotate (z, x, y order) then translate
  function put(g, x, y, z, ry, rx, rz) {
    if (rz) g.rotateZ(rz);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    g.translate(x || 0, y || 0, z || 0);
    return g;
  }
  P.boxM = boxM; P.uvScale = uvScale; P.put = put;

  // a box from a to b (rail, strut, stringer)
  const _q = new THREE.Quaternion(), _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _m4 = new THREE.Matrix4();
  function member(ax, ay, az, bx, by, bz, t, tt) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz) || 0.001;
    const g = new THREE.BoxGeometry(t, tt == null ? t : tt, L);
    _q.setFromUnitVectors(_va.set(0, 0, 1), _vb.set(dx / L, dy / L, dz / L));
    g.applyMatrix4(_m4.makeRotationFromQuaternion(_q));
    g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    return g;
  }
  function tube(ax, ay, az, bx, by, bz, r, seg) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz) || 0.001;
    const g = new THREE.CylinderGeometry(r, r, L, seg || 6, 1, true);
    _q.setFromUnitVectors(_va.set(0, 1, 0), _vb.set(dx / L, dy / L, dz / L));
    g.applyMatrix4(_m4.makeRotationFromQuaternion(_q));
    g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    return g;
  }
  P.member = member; P.tube = tube;

  // an extruded 2D profile (pts [[x,y]...] in the XY plane) along +Z, depth d
  function prism(pts, d, holes) {
    const sh = new THREE.Shape();
    sh.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
    sh.closePath();
    if (holes) for (const h of holes) {
      const p = new THREE.Path();
      p.moveTo(h[0][0], h[0][1]);
      for (let i = 1; i < h.length; i++) p.lineTo(h[i][0], h[i][1]);
      p.closePath();
      sh.holes.push(p);
    }
    const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false, steps: 1 });
    return g;
  }
  P.prism = prism;

  // ---- shared materials (built once, reused by every field) ----
  const _mats = new Map();
  function once(key, fn) { let m = _mats.get(key); if (!m) { m = fn(); if (m) m._shared = true; _mats.set(key, m); } return m; }
  P.once = once;
  function surfMat(kind, tint, rough, metal) {
    return once("surf|" + kind + "|" + tint, function () {
      if (CBZ.surfaceMaps && CBZ.surfaceApply) {
        const maps = CBZ.surfaceMaps(kind, { repeat: 1 });
        if (maps) {
          const m = new THREE.MeshStandardMaterial({ color: tint, roughness: rough, metalness: metal, envMap: CBZ.ENV || null });
          CBZ.surfaceApply(m, kind, { repeat: 1, roughness: rough, metalness: metal });
          return m;
        }
      }
      return cmat(tint);
    });
  }
  P.concreteMat = function (tint) { return surfMat("concrete", tint == null ? 0xc9c6bf : tint, 0.9, 0.02); };
  P.plasterMat = function (tint) { return surfMat("plaster", tint == null ? 0xe9e6df : tint, 0.86, 0.0); };
  P.woodMat = function (tint) { return surfMat("wood", tint == null ? 0x9a7a55 : tint, 0.7, 0.0); };
  P.steelMat = function (tint) { return surfMat("metal", tint == null ? 0xb8bec4 : tint, 0.55, 0.35); };

  function canvasTex(w, h, paint, srgb) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    paint(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, CBZ.renderer && CBZ.renderer.capabilities ? CBZ.renderer.capabilities.getMaxAnisotropy() : 1);
    if (srgb && THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    return t;
  }
  P.canvasTex = canvasTex;
  P.deckMat = function (tint) {
    return once("deck|" + (tint || 0), function () {
      const tex = canvasTex(256, 256, function (x, W, H) {
        const n = 7, bw = W / n;
        for (let i = 0; i < n; i++) {
          const k = hash01(i * 7.3, 11, 401);
          x.fillStyle = "rgb(" + ((150 + k * 40) | 0) + "," + ((118 + k * 30) | 0) + "," + ((80 + k * 22) | 0) + ")";
          x.fillRect(i * bw, 0, bw, H);
          x.globalAlpha = 0.18;
          for (let s = 0; s < 14; s++) {
            x.fillStyle = hash01(i, s, 403) > 0.5 ? "#4a3522" : "#e8d2ad";
            x.fillRect(i * bw + 2 + hash01(i, s, 402) * (bw - 4), 0, 1, H);
          }
          x.globalAlpha = 1;
          x.fillStyle = "#1c1814";
          x.fillRect(i * bw + bw - 2, 0, 2, H);
        }
      });
      return new THREE.MeshLambertMaterial({ color: tint || 0xffffff, map: tex });
    });
  };
  // trapezoidal profiled steel sheet: ribs along V at 1/7 m pitch
  P.corrugatedMat = function (tint) {
    return once("corr|" + tint, function () {
      const tex = canvasTex(112, 16, function (x, W, H) {
        for (let px = 0; px < W; px++) {
          const ph = (px % 16) / 16;
          const l = ph < 0.3 ? 1.0 : ph < 0.45 ? 0.72 : ph < 0.8 ? 0.86 : 0.62;
          const v = Math.round(200 * l);
          x.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
          x.fillRect(px, 0, 1, H);
        }
      });
      return new THREE.MeshStandardMaterial({ color: tint, map: tex, roughness: 0.55, metalness: 0.35, envMap: CBZ.ENV || null });
    });
  };
  P.glassMat = function (opacity) {
    return once("glass|" + (opacity || 0.45), function () {
      return CBZ.glass ? CBZ.glass({ opacity: opacity || 0.45, side: THREE.DoubleSide })
        : new THREE.MeshLambertMaterial({ color: 0x9fc7df, transparent: true, opacity: opacity || 0.45, side: THREE.DoubleSide });
    });
  };
  // terrazzo: the floor of every terminal hall in the world
  P.terrazzoMat = function () {
    return once("terrazzo", function () {
      const tex = canvasTex(256, 256, function (x, W, H) {
        x.fillStyle = "#cfcac1"; x.fillRect(0, 0, W, H);
        for (let i = 0; i < 2600; i++) {
          const h = hash01(i, 7, 611), r = 0.6 + hash01(i, 3, 612) * 1.8;
          x.fillStyle = h < 0.45 ? "#9d978d" : h < 0.8 ? "#e8e4dc" : h < 0.93 ? "#7c8288" : "#b59a78";
          x.fillRect(hash01(i, 1, 613) * W, hash01(i, 2, 614) * H, r, r);
        }
        // brass divider strips on a 2 m grid (the texture is 2 m)
        x.fillStyle = "#a88f5a"; x.fillRect(0, 0, W, 2); x.fillRect(0, 0, 2, H);
      });
      return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.0, envMap: CBZ.ENV || null });
    });
  };
  // profiled metal cladding panel in a colour (hangars, sheds, gables)
  P.cladMat = function (tint) { return P.corrugatedMat(tint); };
  P.cladMat2 = function (tint) {
    return once("clad2|" + tint, function () { const m = P.corrugatedMat(tint).clone(); m.side = THREE.DoubleSide; return m; });
  };

  /* ---- THE NIGHT. Airfield lamps are LAMPS: dark lenses by day, lit at
     night. One slow updater drives every registered material off
     core/daynight.js's CBZ.nightAmount; `op` materials (floodlight pools on
     the apron) fade their opacity instead. A material whose root has been
     detached after being seen is dropped (world rebuild / streamer park). */
  const glow = [];
  const anims = [];                 // per-frame animated parts (radar, flashers)
  let hooked = false, glowT = 0;
  function hook() {
    if (hooked || !CBZ.onUpdate) return;
    hooked = true;
    CBZ.onUpdate(48.5, function (dt) {
      dt = dt || 0;
      glowT -= dt;
      const n = Math.max(0, Math.min(1, CBZ.nightAmount == null ? 0 : CBZ.nightAmount));
      if (glowT <= 0) {
        glowT = 0.5;
        for (let i = glow.length - 1; i >= 0; i--) {
          const e = glow[i];
          if (e.root) {
            if (e.root.parent) e.seen = true;
            else if (e.seen) { glow.splice(i, 1); continue; }
          }
          if (e.op) e.m.opacity = e.m._afDay + (e.m._afNight - e.m._afDay) * n;
          else e.m.emissiveIntensity = e.m._afDay + (e.m._afNight - e.m._afDay) * n;
        }
      }
      for (let i = anims.length - 1; i >= 0; i--) {
        const a = anims[i];
        if (a.root) {
          if (a.root.parent) a.seen = true;
          else if (a.seen) { anims.splice(i, 1); continue; }
          else continue;
        }
        a.fn(dt, n);
      }
    });
  }
  P.glow = function (m, dayEi, nightEi, root) {
    if (!m) return m;
    m._afDay = dayEi; m._afNight = nightEi;
    m.emissiveIntensity = dayEi;
    glow.push({ m: m, root: root || null, seen: false, op: false });
    hook();
    return m;
  };
  P.glowOpacity = function (m, dayOp, nightOp, root) {
    m._afDay = dayOp; m._afNight = nightOp; m.opacity = dayOp;
    glow.push({ m: m, root: root || null, seen: false, op: true });
    hook();
    return m;
  };
  P.animate = function (root, fn) { anims.push({ root: root, fn: fn, seen: false }); hook(); };
  // a fresh lamp material (glowing colour), day/night driven
  function lamp(color, dayEi, nightEi, root) {
    const m = mat(color, { emissive: color, ei: dayEi });
    return P.glow(m, dayEi, nightEi, root);
  }
  P.lamp = lamp;

  /* ---- THE SURFACE SHADER. The canvas carries layout and paint; this adds
     what the canvas cannot hold at its density, in plane metres: 5 m concrete
     slabs with sealed joints and per-slab tone, asphalt aggregate and repair
     patches, rubber in both touchdown zones, worn paint, patchy mown grass.
     Surface class is read from the canvas colour itself. */
  const AF_FRAG_PARS = [
    "varying vec3 vAfW;",
    "uniform vec2 afSize; uniform vec4 afRwy; uniform float afPanel; uniform vec4 afXf; uniform float afTdz;",
    "float afH( vec2 p ) { p = fract( p * vec2( 0.1031, 0.1030 ) ); p += dot( p, p.yx + 33.33 ); return fract( ( p.x + p.y ) * p.x ); }",
    "float afN( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f ); i = mod( i, 289.0 );",
    "  vec2 i1 = mod( i + 1.0, 289.0 );",
    "  return mix( mix( afH( i ), afH( vec2( i1.x, i.y ) ), f.x ), mix( afH( vec2( i.x, i1.y ) ), afH( i1 ), f.x ), f.y ); }",
  ].join("\n");
  const AF_FRAG = [
    "{",
    "  vec2 afP = vec2( vUv.x * afSize.x, ( 1.0 - vUv.y ) * afSize.y );",
    "  vec2 afQ = afP - afXf.zw;",
    "  vec2 afLo = vec2( afXf.x * afQ.x - afXf.y * afQ.y, afXf.y * afQ.x + afXf.x * afQ.y );",
    "  float afD = length( vAfW + viewMatrix[3].xyz * mat3( viewMatrix ) );",
    "  float afNear = 1.0 - smoothstep( 50.0, 200.0, afD );",
    "  vec3 afC = diffuseColor.rgb;",
    "  vec3 afS = LinearTosRGB( vec4( afC, 1.0 ) ).rgb;",
    "  float afL = dot( afS, vec3( 0.299, 0.587, 0.114 ) );",
    "  float afLl = dot( afC, vec3( 0.299, 0.587, 0.114 ) );",
    "  float afGr = smoothstep( 0.03, 0.09, afS.g - max( afS.r, afS.b ) );",
    "  float afYe = smoothstep( 0.25, 0.45, afS.r - afS.b ) * ( 1.0 - afGr );",
    "  float afWh = smoothstep( 0.70, 0.80, afL ) * ( 1.0 - afYe );",
    "  float afPt = max( afWh, afYe );",
    "  float afCo = smoothstep( 0.40, 0.47, afL ) * ( 1.0 - smoothstep( 0.66, 0.74, afL ) ) * ( 1.0 - afGr ) * ( 1.0 - afYe );",
    "  float afAs = ( 1.0 - smoothstep( 0.30, 0.40, afL ) ) * ( 1.0 - afGr ) * ( 1.0 - afYe );",
    "  float afF = afN( afP * 6.0 ), afM = afN( afP * 0.9 + 5.3 ), afB = afN( afP * 0.09 + 1.7 );",
    "  vec2 afG = afLo / afPanel; vec2 afCell = floor( afG );",
    "  vec2 afFr = abs( fract( afG ) - 0.5 ) * afPanel;",
    "  float afE = afPanel * 0.5 - max( afFr.x, afFr.y );",
    "  float afJw = 0.014 + afD * 0.0011;",
    "  float afJ = ( 1.0 - smoothstep( afJw * 0.5, afJw * 1.6, afE ) ) * min( 1.0, 0.03 / afJw ) * ( 1.0 - smoothstep( 110.0, 220.0, afD ) );",
    "  float afTint = 1.0 + ( afH( mod( afCell, 289.0 ) + 7.0 ) - 0.5 ) * 0.11;",
    "  float afEdge = 1.0 - 0.08 * ( 1.0 - smoothstep( 0.0, 0.5, afE ) );",
    "  float afSt = smoothstep( 0.60, 0.86, afN( afP * 0.19 + 9.1 ) * 0.62 + afM * 0.38 );",
    "  vec2 afDc = floor( afP / 1.4 ); vec2 afDp = fract( afP / 1.4 ) - 0.5;",
    "  float afSp = step( 0.955, afH( mod( afDc, 289.0 ) + 3.7 ) ) * ( 1.0 - smoothstep( 0.10, 0.34, length( afDp ) * ( 0.75 + afH( mod( afDc, 289.0 ) + 1.3 ) * 0.7 ) ) );",
    "  float afCk = afTint * afEdge * ( 1.0 - afJ * 0.5 ) * ( 1.0 - afSt * 0.20 ) * ( 1.0 - afSp * 0.38 )",
    "    * ( 1.0 + ( afF - 0.5 ) * 0.14 * afNear ) * ( 1.0 + ( afB - 0.5 ) * 0.10 );",
    "  float afPc = afH( mod( floor( afLo / vec2( 4.5, 3.2 ) ), 289.0 ) + 11.0 );",
    "  float afAk = ( 1.0 + ( afF - 0.5 ) * 0.24 * afNear ) * ( 1.0 + ( afM - 0.5 ) * 0.10 ) * ( 1.0 + ( afB - 0.5 ) * 0.14 ) * ( afPc > 0.965 ? 0.84 : 1.0 );",
    "  float afGk = ( 0.84 + 0.30 * afN( afP * 0.35 + 2.0 ) ) * ( 1.0 + ( afF - 0.5 ) * 0.26 * afNear );",
    "  float afDry = smoothstep( 0.55, 0.82, afB ) * 0.45 * afGr;",
    "  float afWr = smoothstep( 0.52, 0.88, afN( afP * 1.9 + 4.0 ) * 0.7 + afF * 0.3 );",
    "  float afPk = ( 1.0 - afWr * 0.26 ) * ( 1.0 + ( afF - 0.5 ) * 0.10 * afNear );",
    "  float afK = 1.0 + afCo * ( afCk - 1.0 ) + afAs * ( afAk - 1.0 ) + afGr * ( afGk - 1.0 ) + afPt * ( afPk - 1.0 );",
    "  afC = mix( afC, vec3( afLl * 1.22, afLl * 1.08, afLl * 0.62 ), afDry );",
    "  afC = mix( afC, afC * vec3( 0.90, 0.88, 0.84 ), afSt * afCo * 0.6 );",
    // runway rubber: tyre deposits down the wheel tracks of both touchdown zones
    "  float afIn = step( afRwy.x, afLo.x ) * step( afLo.x, afRwy.y ) * step( abs( afLo.y - afRwy.z ), afRwy.w );",
    "  float afDe = min( afLo.x - afRwy.x, afRwy.y - afLo.x );",
    "  float afTq = ( afDe - afTdz ) / 150.0;",
    "  float afTz = exp( -afTq * afTq );",
    "  float afTr = 1.0 - smoothstep( afRwy.w * 0.12, afRwy.w * 0.55, abs( afLo.y - afRwy.z ) );",
    "  float afSk = afN( vec2( afLo.x * 0.03, afLo.y * 2.3 ) + 50.0 ) * 0.6 + afN( vec2( afLo.x * 0.18, afLo.y * 5.0 ) + 50.0 ) * 0.4;",
    "  float afRb = afIn * afTz * afTr * smoothstep( 0.30, 0.78, afSk );",
    "  afK *= 1.0 - afRb * 0.6;",
    "  diffuseColor.rgb = afC * afK;",
    "}",
  ].join("\n");
  /* surfaceMaterial(tex, W, D, opts): W/D = the plane's size in metres (plane
     metres run from its -x edge and its canvas-top edge). opts.frame = where
     the FIELD's local origin sits in plane metres + its bearing relative to
     the plane; opts.rwy = [x0, x1, zc, halfW] in field-local metres. */
  P.surfaceMaterial = function (tex, W, D, opts) {
    opts = opts || {};
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex });
    const r = opts.rwy || [-1, -1, 0, 0];
    const fr = opts.frame || { ox: 0, oz: 0, yaw: 0 };
    const U = {
      afSize: { value: new THREE.Vector2(W, D) },
      afRwy: { value: new THREE.Vector4(r[0], r[1], r[2], r[3]) },
      afPanel: { value: opts.panel || 5 },
      afTdz: { value: opts.tdz || 300 },
      afXf: { value: new THREE.Vector4(Math.cos(fr.yaw || 0), Math.sin(fr.yaw || 0), fr.ox || 0, fr.oz || 0) },
    };
    m.onBeforeCompile = function (sh) {
      if (sh.fragmentShader.indexOf("#include <map_fragment>") < 0 || sh.vertexShader.indexOf("#include <project_vertex>") < 0) return;
      for (const k in U) sh.uniforms[k] = U[k];
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vAfW;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvAfW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\n" + AF_FRAG_PARS)
        .replace("#include <map_fragment>", "#include <map_fragment>\n" + AF_FRAG);
    };
    m.customProgramCacheKey = function () { return "airfield-surface-v3"; };
    m.userData.afUniforms = U;
    return m;
  };

  /* ---- A PAINTER over one canvas. The canvas maps a W x D metre plane;
     frame(ox, oz, yaw) sets which coordinate system the drawing calls speak
     (the field's local metres). A line is a line at any bearing. */
  P.painter = function (W, D, pxW, pxD) {
    const canvas = document.createElement("canvas");
    canvas.width = pxW; canvas.height = pxD;
    const ctx = canvas.getContext("2d");
    const sx = pxW / W, sz = pxD / D;
    let Fo = { ox: 0, oz: 0, c: 1, s: 0 };
    function css(c) { return "#" + (c >>> 0).toString(16).padStart(6, "0"); }
    function apply() { ctx.setTransform(sx * Fo.c, -sz * Fo.s, sx * Fo.s, sz * Fo.c, sx * Fo.ox, sz * Fo.oz); }
    const api = {
      canvas: canvas, ctx: ctx, sx: sx, sz: sz, css: css, W: W, D: D,
      frame: function (ox, oz, yaw) { Fo = { ox: ox || 0, oz: oz || 0, c: Math.cos(yaw || 0), s: Math.sin(yaw || 0) }; },
      fill: function (color) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = css(color); ctx.fillRect(0, 0, pxW, pxD);
      },
      rect: function (x, z, w, d, color, alpha, rot) {
        apply();
        if (alpha != null) ctx.globalAlpha = alpha;
        ctx.fillStyle = css(color);
        if (rot) { ctx.translate(x, z); ctx.rotate(rot); ctx.fillRect(-w / 2, -d / 2, w, d); }
        else ctx.fillRect(x - w / 2, z - d / 2, w, d);
        ctx.globalAlpha = 1;
      },
      // rect by corners
      box: function (x0, z0, x1, z1, color, alpha) { api.rect((x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(z1 - z0), color, alpha); },
      poly: function (pts, color, alpha) {
        apply();
        if (alpha != null) ctx.globalAlpha = alpha;
        ctx.fillStyle = css(color);
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) { if (i) ctx.lineTo(pts[i][0], pts[i][1]); else ctx.moveTo(pts[i][0], pts[i][1]); }
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      },
      line: function (pts, width, color, dash, alpha) {
        apply();
        if (alpha != null) ctx.globalAlpha = alpha;
        ctx.strokeStyle = css(color); ctx.lineWidth = width;
        ctx.lineCap = "butt"; ctx.lineJoin = "round";
        ctx.setLineDash(dash || []);
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]); else ctx.lineTo(pts[i][0], pts[i][1]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      },
      arc: function (x, z, r, a0, a1, width, color, dash) {
        apply();
        ctx.strokeStyle = css(color); ctx.lineWidth = width; ctx.lineCap = "butt";
        ctx.setLineDash(dash || []);
        ctx.beginPath(); ctx.arc(x, z, r, a0, a1, a1 < a0); ctx.stroke();
        ctx.setLineDash([]);
      },
      // painted letters, cap height in metres; rot turns them to be read from
      // a direction; widthM stretches to a width
      text: function (str, x, z, sizeM, rot, color, widthM) {
        apply();
        ctx.translate(x, z);
        ctx.rotate(rot || 0);
        const K = 32;
        ctx.scale(1 / K, 1 / K);
        ctx.fillStyle = css(color); ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = "700 " + (sizeM * K * 1.35).toFixed(1) + "px Arial Narrow, Arial, sans-serif";
        if (widthM) {
          const mw = ctx.measureText(str).width;
          if (mw > 0) ctx.scale((widthM * K) / mw, 1);
        }
        ctx.fillText(str, 0, 0);
      },
      texture: function () {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const tex = new THREE.CanvasTexture(canvas);
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = Math.min(8, CBZ.renderer && CBZ.renderer.capabilities ? CBZ.renderer.capabilities.getMaxAnisotropy() : 1);
        if (CBZ.groundLinear) CBZ.groundLinear(tex);
        return tex;
      },
    };
    return api;
  };

  /* ==============================================================
     THE PAINT — ICAO Annex 14 chapter 5, at this runway's numbers.
     Every call speaks the field's local metres.
     ============================================================== */
  const C = {
    GRASS: 0x54683f, GRASS_MOW: 0x86a56a, STRIP: 0x5d7444, SHOULDER: 0x3a3d40,
    RUNWAY: 0x2c2f33, TARMAC: 0x3c3f44, CONCRETE: 0x8f8d87, CONCRETE2: 0x9a978f,
    WHITE: 0xe6e9ec, YELLOW: 0xd8b53a, RED: 0xb8322a, BLACK: 0x1c1d1f,
    WALK: 0xa9a7a0, ROAD: 0x45484c, KERB: 0xb3afa6,
  };
  P.COLORS = C;

  // how many threshold stripes a runway of this width carries (ICAO 5.2.4.6)
  function thresholdStripes(w) {
    if (w >= 60) return 16;
    if (w >= 45) return 12;
    if (w >= 30) return 8;
    if (w >= 23) return 6;
    return 4;
  }
  // aiming point: distance from threshold, stripe length, width (ICAO 5.2.5 table)
  function aimingPoint(lda) {
    if (lda < 800) return { at: 150, len: 30, w: 4 };
    if (lda < 1200) return { at: 250, len: 45, w: 6 };
    if (lda < 2400) return { at: 300, len: 45, w: 6 };
    return { at: 400, len: 60, w: 10 };
  }
  // touchdown-zone marking pairs by landing distance (ICAO 5.2.6.3)
  function tdzPairs(lda) {
    if (lda < 900) return 1;
    if (lda < 1200) return 2;
    if (lda < 1500) return 3;
    if (lda < 2400) return 4;
    return 6;
  }
  P.runwayRules = { thresholdStripes: thresholdStripes, aimingPoint: aimingPoint, tdzPairs: tdzPairs };

  // the resolved marking plan for one runway — pure numbers, so the node check
  // can read exactly what gets painted
  P.runwayPlan = function (len, w) {
    const H = len / 2;
    const n = thresholdStripes(w), per = n / 2;
    const stripes = [];
    // stripes 1.8 wide at 1.8 spacing, double spacing across the centreline
    for (let k = 0; k < per; k++) {
      const c = REAL.thrGap + REAL.thrStripeW / 2 + k * (REAL.thrStripeW + REAL.thrGap);
      stripes.push(c, -c);
    }
    const ap = aimingPoint(len);
    const inner = w >= 45 ? 18 : w >= 30 ? 14 : 9;   // lateral spacing between inner edges
    const tdz = [];
    const want = tdzPairs(len);
    const pattern = [3, 3, 2, 2, 1, 1];
    for (let k = 1; k <= 6 && tdz.length < want; k++) {
      const d = 150 * k;
      if (d + REAL.tdzStripeL > H - 20) break;
      if (d > ap.at - 50 && d < ap.at + ap.len + 50) continue;   // within 50 m of the aiming point
      tdz.push({ d: d, n: pattern[k - 1] });
    }
    const desigD = REAL.thrStartIn + REAL.thrStripeL + REAL.designatorGap + REAL.designatorH / 2;
    return {
      H: H, w: w, stripes: stripes, stripeD0: REAL.thrStartIn,
      desigD: desigD, aim: ap, inner: inner, tdz: tdz,
      clFrom: desigD + REAL.designatorH / 2 + 12,
    };
  };

  function fillet(PA, cx, cz, sx, sz, R, color) {
    const ccx = cx + sx * R, ccz = cz + sz * R;
    const pts = [[cx, cz], [cx + sx * R, cz]];
    for (let i = 1; i < 12; i++) {
      const t = (i / 12) * Math.PI / 2;
      pts.push([ccx - sx * R * Math.sin(t), ccz - sz * R * Math.cos(t)]);
    }
    pts.push([cx, cz + sz * R]);
    PA.poly(pts, color);
  }
  P.fillet = fillet;

  // a yellow guidance line that turns off one straight onto another, both
  // ways: from a line along X at z=z0 onto a line along Z at x=x0 heading +dz
  function leadArcs(PA, x0, z0, dz, R, w, color) {
    // centres (x0 +/- R, z0 + dz*R)
    const cz = z0 + dz * R;
    for (const s of [-1, 1]) {
      const cx = x0 + s * R;
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const t = (i / 16) * Math.PI / 2;
        // from (x0, cz) round to (cx, z0)
        pts.push([cx - s * R * Math.cos(t), cz - dz * R * Math.sin(t)]);
      }
      PA.line(pts, w, color);
    }
  }
  P.leadArcs = leadArcs;

  /* paintField(PA, ap, L): the whole movement area. L is the resolved
     layout from buildAirfield (runway, taxiways, connectors, aprons,
     stands). */
  P.paintField = function (PA, ap, L) {
    const H = L.H, RW = L.RW, TW = L.taxiW, tz = L.taxiZ;
    const plan = P.runwayPlan(ap.runway.len, RW);
    L.plan = plan;
    // ---- graded strip + shoulders + blast pads + runway
    PA.rect(0, 0, 2 * H + 2 * L.blast + 40, RW + 70, C.STRIP, 0.7);
    PA.rect(0, 0, 2 * H + 2 * L.blast, RW + 2 * REAL.shoulder, C.SHOULDER);
    PA.rect(0, 0, 2 * H, RW, C.RUNWAY);
    // ---- the parallel taxiway, with its paved shoulders
    PA.rect((L.taxiX0 + L.taxiX1) / 2, tz, L.taxiX1 - L.taxiX0 + 20, TW + 2 * REAL.taxiShoulder, C.SHOULDER);
    PA.rect((L.taxiX0 + L.taxiX1) / 2, tz, L.taxiX1 - L.taxiX0, TW, C.TARMAC);
    // ---- connectors, with 25 m fillets at both pavements
    for (const cx of L.conns) {
      const z0 = RW / 2, z1 = tz - TW / 2;
      PA.rect(cx, (z0 + z1) / 2, TW + 2 * REAL.taxiShoulder, z1 - z0, C.SHOULDER);
      PA.rect(cx, (z0 + z1) / 2, TW, z1 - z0 + 0.5, C.TARMAC);
      for (const s of [-1, 1]) {
        fillet(PA, cx + s * TW / 2, z0, s, 1, 22, C.TARMAC);
        fillet(PA, cx + s * TW / 2, z1, s, -1, 22, C.TARMAC);
      }
    }
    // ---- aprons (concrete) and any extra paved areas
    for (const a of L.aprons) PA.box(a.x0, a.z0, a.x1, a.z1, a.color || C.CONCRETE);
    for (const a of L.paved || []) PA.box(a.x0, a.z0, a.x1, a.z1, a.color || C.TARMAC);
    // apron meets the taxiway: fillet the apron's taxiway-side corners
    for (const a of L.aprons) {
      if (Math.abs(a.z0 - (tz + TW / 2)) < 3) {
        fillet(PA, a.x0, a.z0, -1, 1, 12, a.color || C.CONCRETE);
        fillet(PA, a.x1, a.z0, 1, 1, 12, a.color || C.CONCRETE);
      }
    }

    // ================= RUNWAY PAINT =================
    const W = C.WHITE, Y = C.YELLOW;
    // side stripes, 0.9 m, the full length
    for (const s of [-1, 1]) PA.line([[-H, s * (RW / 2 - REAL.sideW / 2)], [H, s * (RW / 2 - REAL.sideW / 2)]], REAL.sideW, W);
    // centreline 30 on / 20 off, 0.9 wide, between the designators
    {
      const x0 = -H + plan.clFrom, x1 = H - plan.clFrom;
      const n = Math.floor((x1 - x0 + REAL.clGap) / (REAL.clStripeL + REAL.clGap));
      const used = n * (REAL.clStripeL + REAL.clGap) - REAL.clGap;
      let x = (x0 + x1) / 2 - used / 2;
      for (let i = 0; i < n; i++, x += REAL.clStripeL + REAL.clGap) PA.rect(x + REAL.clStripeL / 2, 0, REAL.clStripeL, REAL.clW, W);
    }
    for (const e of ap.ends) {
      const sg = e.sign;                        // threshold at local x = sg * H
      const at = function (d) { return sg * (H - d); };
      // threshold stripes
      for (const c of plan.stripes) PA.rect(at(plan.stripeD0 + REAL.thrStripeL / 2), c, REAL.thrStripeL, REAL.thrStripeW, W);
      // designator, 9 m tall, read from the approach
      PA.text(e.name, at(plan.desigD), 0, REAL.designatorH, -sg * Math.PI / 2, W, 7.5);
      // aiming point
      for (const s of [-1, 1]) {
        PA.rect(at(plan.aim.at + plan.aim.len / 2), s * (plan.inner / 2 + plan.aim.w / 2), plan.aim.len, plan.aim.w, W);
      }
      // touchdown zone pairs
      for (const t of plan.tdz) {
        for (const s of [-1, 1]) for (let k = 0; k < t.n; k++) {
          const lat = plan.inner / 2 + REAL.tdzStripeW / 2 + k * (REAL.tdzStripeW + REAL.tdzGap);
          PA.rect(at(t.d + REAL.tdzStripeL / 2), s * lat, REAL.tdzStripeL, REAL.tdzStripeW, W);
        }
      }
      // blast pad: yellow chevrons pointing at the threshold, 30 m pitch
      for (let d = 15; d < L.blast - 5; d += 30) {
        const x = sg * (H + d);
        for (const s of [-1, 1]) PA.line([[x + sg * 12, s * (RW / 2 - 1.5)], [x, 0]], 0.9, Y);
      }
    }
    // ================= TAXIWAY PAINT =================
    const TL = 0.3;                              // yellow line width (enhanced)
    PA.line([[L.taxiX0 + 10, tz], [L.taxiX1 - 10, tz]], TL, Y);
    for (const cx of L.conns) {
      PA.line([[cx, tz - 30], [cx, 30]], TL, Y);
      leadArcs(PA, cx, tz, -1, 30, TL, Y);      // off the parallel taxiway
      leadArcs(PA, cx, 0, 1, 30, TL, Y);        // onto the runway centreline (lead-on, yellow)
      // runway-holding position, pattern A: two solid (taxiway side) + two dashed
      const hz = L.holdZ;
      const hx0 = cx - TW / 2, hx1 = cx + TW / 2;
      PA.line([[hx0, hz + 1.5], [hx1, hz + 1.5]], TL, Y);
      PA.line([[hx0, hz + 0.9], [hx1, hz + 0.9]], TL, Y);
      PA.line([[hx0, hz + 0.3], [hx1, hz + 0.3]], TL, Y, [0.9, 0.9]);
      PA.line([[hx0, hz - 0.3], [hx1, hz - 0.3]], TL, Y, [0.9, 0.9]);
      // the holding position is repeated in paint: mandatory marking, red
      // box with the runway designation, taxiway side of the bars
      for (const s of [-1, 1]) {
        PA.rect(cx + s * 5.5, hz + 6.5, 7, 3.2, C.RED);
        PA.text(ap.runwayName.replace("/", "-"), cx + s * 5.5, hz + 6.5, 1.6, 0, W, 5.6);
      }
    }
    // ================= STANDS =================
    for (let i = 0; i < L.stands.length; i++) {
      const st = L.stands[i];
      const R = 35;
      // lead-in off the taxiway centreline, both directions, then straight to the stop
      leadArcs(PA, st.lx, tz, 1, R, TL, Y);
      PA.line([[st.lx, tz + R], [st.lx, st.stopZ]], TL, Y);
      // nose-wheel stop bar + a short type bar behind it
      PA.rect(st.lx, st.stopZ, 5, 0.3, Y);
      PA.rect(st.lx, st.stopZ - 1.5, 2.5, 0.3, Y);
      // stand number, read from the taxiway, on its black box
      PA.rect(st.lx + 5, tz + R + 6, 4.2, 4.8, C.BLACK);
      PA.text(st.num, st.lx + 5, tz + R + 6, 3.2, Math.PI, Y);
      // the stand's red safety envelope: wingtip lines each side
      const half = L.span / 2 + 3.75;
      for (const s of [-1, 1]) PA.line([[st.lx + s * half, tz + TW / 2 + 8], [st.lx + s * half, st.headZ]], 0.2, C.RED);
      // equipment restraint line across the head of the stand
      PA.line([[st.lx - half, st.erlZ], [st.lx + half, st.erlZ]], 0.2, C.RED, [2, 1]);
      if (st.bridge && st.bridge.col) {
        // bridge drive-wheel parking box, hatched red
        const b = st.bridge.col;
        PA.line([[b.x - 2.4, b.z - 1.6], [b.x + 2.4, b.z - 1.6], [b.x + 2.4, b.z + 1.6], [b.x - 2.4, b.z + 1.6], [b.x - 2.4, b.z - 1.6]], 0.2, C.RED);
        for (let k = -2; k <= 2; k++) PA.line([[b.x + k * 1.1 - 0.7, b.z - 1.5], [b.x + k * 1.1 + 0.7, b.z + 1.5]], 0.12, C.RED);
      }
    }
    // head-of-stand service road: edge lines + dashed centre
    if (L.hsRoad) {
      const r = L.hsRoad;
      for (const z of [r.z - r.w / 2, r.z + r.w / 2]) PA.line([[r.x0, z], [r.x1, z]], 0.15, W);
      PA.line([[r.x0, r.z], [r.x1, r.z]], 0.12, W, [3, 3]);
    }
  };

  /* ==============================================================
     AIRFIELD SIGNS — one atlas per field, one mesh for every face.
     Mandatory: white on red (a runway). Location: yellow on black
     (the taxiway you are on). Direction: black on yellow with an
     arrow. Real wording only.
     ============================================================== */
  const SIGN_STYLE = {
    mand: { bg: "#b8231e", fg: "#ffffff", border: "#ffffff" },
    loc: { bg: "#111214", fg: "#f2c400", border: "#f2c400" },
    dir: { bg: "#f2c400", fg: "#111214", border: null },
  };
  P.signs = function (parent, list, root) {
    if (!list.length) return null;
    const ROWH = 64, AW = 1024;
    const rows = [];
    let cx = 0, cy = 0;
    const cvs = document.createElement("canvas");
    cvs.width = AW; cvs.height = Math.max(64, Math.ceil(list.length / 4) * ROWH * 2);
    const x = cvs.getContext("2d");
    x.fillStyle = "#000"; x.fillRect(0, 0, cvs.width, cvs.height);
    const faces = [];
    for (const s of list) {
      const panels = s.panels;
      // each panel: [kind, text]
      const pw = panels.map(function (p) { return Math.max(1.0, p[1].length * 0.62 + 0.5); });
      const totalM = pw.reduce(function (a, b) { return a + b; }, 0);
      const px = Math.ceil(totalM * ROWH);
      if (cx + px > AW) { cx = 0; cy += ROWH; }
      if (cy + ROWH > cvs.height) break;
      let ox = cx;
      for (let k = 0; k < panels.length; k++) {
        const st = SIGN_STYLE[panels[k][0]] || SIGN_STYLE.loc;
        const w = Math.round(pw[k] * ROWH);
        x.fillStyle = st.bg; x.fillRect(ox, cy, w, ROWH);
        if (st.border) { x.strokeStyle = st.border; x.lineWidth = 3; x.strokeRect(ox + 5, cy + 5, w - 10, ROWH - 10); }
        x.fillStyle = st.fg; x.font = "700 40px Arial Narrow, Arial, sans-serif";
        x.textAlign = "center"; x.textBaseline = "middle";
        x.fillText(panels[k][1], ox + w / 2, cy + ROWH / 2 + 2);
        ox += w;
      }
      faces.push({ s: s, u0: cx / AW, u1: (cx + px) / AW, v0: 1 - (cy + ROWH) / cvs.height, v1: 1 - cy / cvs.height, wM: totalM });
      cx += px + 2;
    }
    const tex = new THREE.CanvasTexture(cvs);
    tex.anisotropy = 4;
    if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
    const faceGeos = [], frame = [], legs = [];
    const HGT = 1.1;
    for (const f of faces) {
      const s = f.s, wM = f.wM;
      // the housing: a slim box on two frangible legs, face 0.35 m above grade
      const y = 0.35 + HGT / 2;
      frame.push(put(boxM(wM + 0.16, HGT + 0.16, 0.22, 1), s.x, y, s.z, s.rot || 0));
      for (const lx of [-wM / 2 + 0.3, wM / 2 - 0.3]) {
        const c = Math.cos(s.rot || 0), sn = Math.sin(s.rot || 0);
        legs.push(put(new THREE.CylinderGeometry(0.04, 0.04, 0.35, 6), s.x + lx * c, 0.17, s.z - lx * sn));
      }
      for (const side of [1, -1]) {
        const g = new THREE.PlaneGeometry(wM, HGT);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
          const u = uv.getX(i), v = uv.getY(i);
          uv.setXY(i, f.u0 + u * (f.u1 - f.u0), f.v0 + v * (f.v1 - f.v0));
        }
        if (side < 0) g.rotateY(Math.PI);
        g.translate(0, 0, side * 0.115);
        g.rotateY(s.rot || 0);
        g.translate(s.x, y, s.z);
        faceGeos.push(g);
      }
    }
    const grp = new THREE.Group();
    grp.name = "airfield-signs";
    // signs are internally lit: a face that glows faintly by day, bright at night
    const fm = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15 });
    P.glow(fm, 0.15, 0.85, root || parent);
    addMerged(grp, faceGeos, fm, {});
    addMerged(grp, frame, cmat(0x2a2c30), { cast: true });
    addMerged(grp, legs, cmat(0xd9b43c), {});
    parent.add(grp);
    return grp;
  };

  /* ==============================================================
     AIRFIELD LIGHTING. No light objects anywhere: a lamp is a lens
     material that is nearly dark by day and bright at night.
     ============================================================== */
  const LENS = { w: 0xfff1d2, y: 0xffc94a, g: 0x46ff84, r: 0xff3b2e, b: 0x3f7dff };
  const _lensMats = new Map();       // per (root, kind): a lens material lives with its field
  function lensMat(kind, root) {
    let byRoot = _lensMats.get(root);
    if (!byRoot || byRoot.dead) { byRoot = {}; _lensMats.set(root, byRoot); }
    if (!byRoot[kind]) {
      const m = lamp(LENS[kind] || LENS.w, 0.1, 1.4, root);
      m.color.multiplyScalar(0.55);
      byRoot[kind] = m;
    }
    return byRoot[kind];
  }
  function instanceAt(geo, material, list, y) {
    const im = new THREE.InstancedMesh(geo, material, list.length);
    const d = new THREE.Object3D();
    for (let i = 0; i < list.length; i++) {
      d.position.set(list[i][0], y == null ? (list[i][3] || 0) : y, list[i][1]);
      d.rotation.set(0, list[i][4] || 0, 0);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false; im.receiveShadow = false;
    return im;
  }
  P.instanceAt = instanceAt;

  /* ELEVATED edge lights: base plate, frangible stem, housing, lens.
     pts: [x, z, kind]. */
  P.edgeLights = function (parent, pts, root) {
    const grp = new THREE.Group();
    grp.name = "airfield-edge-lights";
    if (!pts.length) return grp;
    const stemG = mergeGeos([
      put(new THREE.CylinderGeometry(0.11, 0.12, 0.035, 10), 0, 0.017, 0),
      put(new THREE.CylinderGeometry(0.028, 0.04, 0.26, 6, 1, true), 0, 0.16, 0),
      put(new THREE.CylinderGeometry(0.075, 0.06, 0.05, 10), 0, 0.30, 0),
    ]);
    const lensG = new THREE.SphereGeometry(0.068, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    lensG.translate(0, 0.325, 0);
    grp.add(instanceAt(stemG, cmat(0xd9b43c), pts, 0.06));
    const byKind = {};
    for (const p of pts) { const k = LENS[p[2]] ? p[2] : "w"; (byKind[k] = byKind[k] || []).push(p); }
    for (const k in byKind) grp.add(instanceAt(lensG, lensMat(k, root || parent), byKind[k], 0.06));
    parent.add(grp);
    return grp;
  };

  /* INSET (flush) lights: a steel ring with a raised lens, 0.3 m across —
     runway centreline, taxiway centreline, stop bars. */
  P.insetLights = function (parent, pts, root) {
    const grp = new THREE.Group();
    grp.name = "airfield-inset-lights";
    if (!pts.length) return grp;
    const ringG = new THREE.CylinderGeometry(0.16, 0.17, 0.03, 12);
    ringG.translate(0, 0.015, 0);
    const lensG = new THREE.BoxGeometry(0.12, 0.035, 0.07);
    lensG.translate(0, 0.03, 0);
    grp.add(instanceAt(ringG, cmat(0x7d8288), pts, 0.035));
    const byKind = {};
    for (const p of pts) { const k = LENS[p[2]] ? p[2] : "w"; (byKind[k] = byKind[k] || []).push(p); }
    for (const k in byKind) grp.add(instanceAt(lensG, lensMat(k, root || parent), byKind[k], 0.035));
    parent.add(grp);
    return grp;
  };

  /* APPROACH LIGHTING (MALSR pattern). stations: [{ d, x, z, dirx, dirz,
     y0, kind:'bar'|'cross'|'flash' }] already solved by the caller (it knows
     the ground, the water and what the lights must not stand in). Every
     steady station is a 5-lamp barrette on a crossarm atop a mast; the
     1000 ft station adds the crossbar; the flashers beyond fire in sequence
     toward the threshold twice a second (night only, as a real RAIL does in
     the dark). */
  P.approachLights = function (parent, stations, root) {
    const grp = new THREE.Group();
    grp.name = "approach-lights";
    const steel = [], dark = [], lamps = [];
    const flashers = [];
    for (const s of stations) {
      const top = 1.2;                               // lamp plane above the ground datum
      const y0 = s.y0 == null ? 0 : s.y0;
      // mast (frangible, low-impact) from its footing to the arm
      steel.push(put(new THREE.CylinderGeometry(0.06, 0.09, top - y0, 8), s.x, (top + y0) / 2, s.z));
      if (y0 < -0.5) {                               // a pier footing in the water
        dark.push(put(new THREE.CylinderGeometry(0.35, 0.4, 1.2, 10), s.x, y0 + 0.6, s.z));
      } else {
        dark.push(put(new THREE.BoxGeometry(0.6, 0.12, 0.6), s.x, 0.06, s.z));
      }
      // lateral direction (across the approach)
      const lx = -s.dirz, lz = s.dirx;
      const lampsAt = [];
      if (s.kind === "flash") {
        lampsAt.push(0);
      } else {
        for (let k = -2; k <= 2; k++) lampsAt.push(k * 0.9);   // 5 lamps over 3.6 m
        if (s.kind === "cross") for (const sg of [-1, 1]) for (let k = 0; k < 5; k++) lampsAt.push(sg * (6 + k * 1.5));
      }
      const span = Math.max(...lampsAt.map(Math.abs));
      if (span > 0) steel.push(member(s.x - lx * span, top, s.z - lz * span, s.x + lx * span, top, s.z + lz * span, 0.08, 0.1));
      for (const o of lampsAt) {
        const px = s.x + lx * o, pz = s.z + lz * o;
        dark.push(put(new THREE.BoxGeometry(0.22, 0.2, 0.22), px, top + 0.14, pz));
        if (s.kind === "flash") flashers.push({ x: px, z: pz, y: top + 0.14, d: s.d, dx: s.dirx, dz: s.dirz });
        else lamps.push([px, pz, "w", top + 0.14, Math.atan2(s.dirx, s.dirz)]);
      }
      // the crossbar lamps' own short masts
      if (s.kind === "cross") for (const sg of [-1, 1]) {
        const e = sg * 12;
        steel.push(put(new THREE.CylinderGeometry(0.05, 0.07, top - Math.max(y0, -0.3), 6), s.x + lx * e, (top + Math.max(y0, -0.3)) / 2, s.z + lz * e));
      }
    }
    addMerged(grp, steel, cmat(0xd8dadc), { cast: true });
    addMerged(grp, dark, cmat(0x2b2e32), { cast: true });
    if (lamps.length) {
      const lensG = new THREE.BoxGeometry(0.16, 0.14, 0.05);
      lensG.translate(0, 0, 0.12);
      grp.add(instanceAt(lensG, lensMat("w", root || parent), lamps, null));
    }
    if (flashers.length) {
      // sequenced flashers: the far one first, the run toward the threshold
      // takes 0.35 s, and it repeats twice a second
      flashers.sort(function (a, b) { return b.d - a.d; });
      const ms = [];
      const g0 = new THREE.SphereGeometry(0.12, 10, 6);
      for (let i = 0; i < flashers.length; i++) {
        const f = flashers[i];
        const m = mat(0xffffff, { emissive: 0xffffff, ei: 0.0 });
        const mesh = new THREE.Mesh(g0, m);
        mesh.position.set(f.x, f.y, f.z);
        grp.add(mesh);
        ms.push(m);
      }
      let t = 0;
      P.animate(root || parent, function (dt, night) {
        t += dt;
        const ph = (t % 0.5) / 0.5;
        for (let i = 0; i < ms.length; i++) {
          const on = Math.abs(ph - i * (0.7 / ms.length)) < 0.05;
          ms[i].emissiveIntensity = on ? 3.0 * night : 0.02;
        }
      });
    }
    parent.add(grp);
    return grp;
  };

  /* PAPI: four units in a line square to the runway, 9 m apart, the
     innermost 15 m off the edge, at the aiming point. On the glidepath a
     pilot sees two white (outer) and two red (inner). o: {x, z, out}
     where out is the lateral unit vector away from the runway. */
  P.papi = function (parent, o, root) {
    const grp = new THREE.Group();
    grp.name = "papi";
    const body = [], legs = [], hood = [], red = [], white = [];
    for (let k = 0; k < 4; k++) {
      const x = o.x + o.outx * (REAL.papiFromEdge + k * REAL.papiSpacing);
      const z = o.z + o.outz * (REAL.papiFromEdge + k * REAL.papiSpacing);
      const yaw = Math.atan2(o.facex, o.facez);
      body.push(put(boxM(1.3, 0.55, 0.9, 1), x, 0.75, z, yaw));
      hood.push(put(new THREE.BoxGeometry(1.4, 0.06, 1.1), x, 1.06, z, yaw));
      for (const lx of [-0.45, 0, 0.45]) legs.push(put(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 6), x + lx * Math.cos(yaw), 0.25, z - lx * Math.sin(yaw)));
      const lens = [];
      for (const lx of [-0.35, 0.35]) {
        const g = new THREE.CylinderGeometry(0.15, 0.15, 0.06, 12);
        g.rotateX(Math.PI / 2);
        g.translate(lx, 0.75, 0.47);
        g.rotateY(yaw);
        g.translate(x, 0, z);
        lens.push(g);
      }
      (k < 2 ? red : white).push.apply(k < 2 ? red : white, lens);
    }
    addMerged(grp, body, P.steelMat(0xe5e6e8), { cast: true });
    addMerged(grp, hood, cmat(0x2b2e32), {});
    addMerged(grp, legs, cmat(0xd9b43c), {});
    addMerged(grp, red, lamp(0xff3b2e, 0.3, 1.8, root || parent), {});
    addMerged(grp, white, lamp(0xfff4e0, 0.3, 1.8, root || parent), {});
    parent.add(grp);
    return grp;
  };

  /* APRON FLOODLIGHT MASTS: a 25 m tapered octagonal pole on a plinth, a
     head frame with six floodlights aimed down and out, a service platform,
     and at night a pool of light on the concrete under it. pts: [x, z, yaw] */
  let _poolTex = null;
  function poolTex() {
    if (_poolTex) return _poolTex;
    _poolTex = canvasTex(128, 128, function (x, W, H) {
      const g = x.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
      g.addColorStop(0, "rgba(255,236,200,1)");
      g.addColorStop(0.45, "rgba(255,226,180,0.55)");
      g.addColorStop(1, "rgba(255,220,170,0)");
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    });
    _poolTex.wrapS = _poolTex.wrapT = THREE.ClampToEdgeWrapping;
    return _poolTex;
  }
  P.apronMasts = function (parent, pts, root, opts) {
    opts = opts || {};
    const H = opts.h || 25;
    const grp = new THREE.Group();
    grp.name = "apron-masts";
    if (!pts.length) return grp;
    const pole = mergeGeos([
      put(new THREE.CylinderGeometry(0.9, 1.0, 0.8, 8), 0, 0.4, 0),                 // plinth
      put(new THREE.CylinderGeometry(0.16, 0.34, H, 8), 0, H / 2 + 0.8, 0),         // tapered shaft
      put(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 12), 0, H + 0.2, 0),           // service platform
    ]);
    const head = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const hx = Math.sin(a) * 1.1, hz = Math.cos(a) * 1.1;
      const g = new THREE.BoxGeometry(0.7, 0.18, 0.55);
      g.rotateX(0.6);
      g.rotateY(a);
      g.translate(hx, H + 1.1, hz);
      head.push(g);
    }
    head.push(put(new THREE.TorusGeometry(1.1, 0.05, 4, 16), 0, H + 1.25, 0, 0, Math.PI / 2));
    head.push(put(new THREE.TorusGeometry(1.5, 0.03, 4, 16), 0, H + 1.2, 0, 0, Math.PI / 2));    // guard rail
    const lensG = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const g = new THREE.BoxGeometry(0.6, 0.02, 0.45);
      g.rotateX(0.6);
      g.translate(0, -0.1, 0);
      g.rotateY(a);
      g.translate(Math.sin(a) * 1.1, H + 1.1, Math.cos(a) * 1.1);
      lensG.push(g);
    }
    const list = pts.map(function (p) { return [p[0], p[1], "w", 0, p[2] || 0]; });
    grp.add(instanceAt(pole, P.steelMat(0xb9bec3), list, 0));
    const hm = mergeGeos(head);
    if (hm) grp.add(instanceAt(hm, cmat(0x3a3f45), list, 0));
    const lm = mergeGeos(lensG);
    if (lm) grp.add(instanceAt(lm, lamp(0xfff0d8, 0.05, 2.2, root || parent), list, 0));
    // the pool of light: additive, only at night
    const R = opts.pool || 34;
    const pg = new THREE.PlaneGeometry(R * 2, R * 2);
    pg.rotateX(-Math.PI / 2);
    const pm = new THREE.MeshBasicMaterial({
      map: poolTex(), color: 0xffe7c4, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    });
    P.glowOpacity(pm, 0, 0.32, root || parent);
    const pool = instanceAt(pg, pm, list, 0.09);
    pool.renderOrder = 2;
    pool.userData.noShadow = true;
    grp.add(pool);
    parent.add(grp);
    return grp;
  };

  /* ==============================================================
     GEOMETRY HELPERS FOR SHELLS
     ============================================================== */
  // outward parallel offset of a convex CCW-or-CW polygon [[x,z]...] by e
  function offsetPoly(pts, e) {
    const n = pts.length, out = [];
    // signed area to know the winding
    let a = 0;
    for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
    const sg = a > 0 ? 1 : -1;
    const nrm = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1;
      // outward normal for this winding
      nrm.push([sg * dz / L, -sg * dx / L]);
    }
    for (let i = 0; i < n; i++) {
      const n1 = nrm[(i - 1 + n) % n], n2 = nrm[i];
      const d = 1 + n1[0] * n2[0] + n1[1] * n2[1];
      out.push([pts[i][0] + e * (n1[0] + n2[0]) / d, pts[i][1] + e * (n1[1] + n2[1]) / d]);
    }
    return out;
  }
  P.offsetPoly = offsetPoly;
  // a ring of quads between two polygon loops (same vertex count) at y0 / y1
  // faces OUTWARD for a CCW (x, z) loop; `inward` turns them in
  function loft(lo, y0, hi, y1, uvTile, inward) {
    const n = lo.length, pos = [], uv = [];
    let run = 0;
    for (let i = 0; i < n; i++) {
      const a = lo[i], b = lo[(i + 1) % n], c = hi[(i + 1) % n], d = hi[i];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), Hh = y1 - y0, t = uvTile || 1;
      if (inward) {
        pos.push(a[0], y0, a[1], b[0], y0, b[1], c[0], y1, c[1], a[0], y0, a[1], c[0], y1, c[1], d[0], y1, d[1]);
        uv.push(run / t, 0, (run + L) / t, 0, (run + L) / t, Hh / t, run / t, 0, (run + L) / t, Hh / t, run / t, Hh / t);
      } else {
        pos.push(a[0], y0, a[1], c[0], y1, c[1], b[0], y0, b[1], a[0], y0, a[1], d[0], y1, d[1], c[0], y1, c[1]);
        uv.push(run / t, 0, (run + L) / t, Hh / t, (run + L) / t, 0, run / t, 0, run / t, Hh / t, (run + L) / t, Hh / t);
      }
      run += L;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }
  P.loft = loft;
  // a flat polygon (cap) at height y, facing up (or down)
  function cap(pts, y, down) {
    // shape XY -> ground XZ. Up: y = -z then rotateX(-90); down: y = +z then
    // rotateX(+90). ShapeGeometry always winds toward +z, so both come out
    // facing the way asked.
    const k = down ? 1 : -1;
    const sh = new THREE.Shape();
    sh.moveTo(pts[0][0], k * pts[0][1]);
    for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], k * pts[i][1]);
    const g = new THREE.ShapeGeometry(sh);
    g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
    g.translate(0, y, 0);
    return g;
  }
  P.cap = cap;
  function chamferSquare(h, c) {
    return [[h, -h + c], [h, h - c], [h - c, h], [-h + c, h], [-h, h - c], [-h, -h + c], [-h + c, -h], [h - c, -h]];
  }

  /* ==============================================================
     CONTROL TOWER. An octagonal concrete shaft with pour-lift reveals
     and four pilaster fins; an equipment drum with louvres under the
     cab; a chamfered-square cab whose glass leans OUT 15 degrees (it
     kills reflections of the consoles, which is why every real cab
     does it), deep mullions, a maintenance catwalk outside the sill,
     a deep sunshade roof, antenna mast, radome, obstruction light.
     o: { H: cab floor, apothem, cabHalf, cabH, drum, plinth, floorHole,
          base: {w, d, h} pavilion at the foot }
     ============================================================== */
  P.tower = function (parent, x, z, o, root) {
    o = o || {};
    const H = o.H || 30, A = o.apothem || 2.2, CH = o.cabH || 3.3;
    const CHF = o.cabHalf || 4.2;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.name = "control-tower";
    const conc = [], dark = [], steel = [], glassG = [], white = [];
    const R8 = A / Math.cos(Math.PI / 8), side = 2 * A * Math.tan(Math.PI / 8);
    const shaft = new THREE.CylinderGeometry(R8 * 0.94, R8, H, 8, 1, true);
    shaft.rotateY(Math.PI / 8);
    uvScale(shaft, side * 8 / 2, H / 2);
    shaft.translate(0, H / 2, 0);
    conc.push(shaft);
    for (let y = 3.5; y < H - 1; y += 3.5) {
      const r = R8 * (1 - 0.06 * y / H) + 0.02;
      const b = new THREE.CylinderGeometry(r, r, 0.06, 8, 1, true);
      b.rotateY(Math.PI / 8); b.translate(0, y, 0);
      dark.push(b);
    }
    // pilaster fins on the diagonals, running up to the drum
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2;
      const fr = R8 * 0.97 + 0.25;
      const fin = boxM(0.35, H - 3.2, 0.5, 1);
      fin.rotateY(-a);
      fin.translate(Math.cos(a) * fr, (H - 3.2) / 2, Math.sin(a) * fr);
      conc.push(fin);
    }
    if (o.plinth !== false) {
      const pl = new THREE.CylinderGeometry(R8 + 0.25, R8 + 0.3, 0.5, 8);
      pl.rotateY(Math.PI / 8); uvScale(pl, 8, 1); pl.translate(0, 0.25, 0);
      conc.push(pl);
    }
    if (o.slot) glassG.push(put(new THREE.BoxGeometry(0.7, H - 8, 0.06), 0, (H - 8) / 2 + 4, -A * 0.99 + 0.02));
    if (o.base) {
      const b = o.base;
      conc.push(put(boxM(b.w, b.h, b.d, 1), 0, b.h / 2, 0));
      for (let k = 0; k < 2; k++) glassG.push(put(new THREE.BoxGeometry(b.w + 0.04, 1.3, b.d + 0.04), 0, 1.6 + k * 3.4, 0));
      dark.push(put(new THREE.BoxGeometry(b.w + 0.3, 0.35, b.d + 0.3), 0, b.h + 0.17, 0));
      dark.push(put(new THREE.BoxGeometry(1.8, 2.4, 0.1), 0, 1.2, b.d / 2 + 0.02));
    }
    // equipment level: a wider drum with a louvre band
    const dr = CHF * 0.86;
    const drumTop = H - 0.45;
    const drum = new THREE.CylinderGeometry(dr, R8 * 0.96, 3.0, 8, 1, true);
    drum.rotateY(Math.PI / 8); uvScale(drum, 22, 3); drum.translate(0, drumTop - 1.5, 0);
    conc.push(drum);
    for (let k = 0; k < 3; k++) {
      const lv = new THREE.CylinderGeometry(dr + 0.02, dr + 0.02, 0.22, 8, 1, true);
      lv.rotateY(Math.PI / 8); lv.translate(0, drumTop - 1.0 - k * 0.45, 0);
      dark.push(lv);
    }
    // cab floor slab (cut round a stair well when one comes up through it)
    {
      const FH = CHF + 0.2, hl = o.floorHole;
      const rects = [];
      if (!hl) rects.push([-FH, FH, -FH, FH]);
      else {
        const hx0 = Math.max(-FH, hl.x0), hx1 = Math.min(FH, hl.x1), hz0 = Math.max(-FH, hl.z0), hz1 = Math.min(FH, hl.z1);
        rects.push([-FH, FH, -FH, hz0], [-FH, FH, hz1, FH], [-FH, hx0, hz0, hz1], [hx1, FH, hz0, hz1]);
      }
      for (const r of rects) {
        if (r[1] - r[0] < 0.02 || r[3] - r[2] < 0.02) continue;
        conc.push(put(boxM(r[1] - r[0], 0.45, r[3] - r[2], 1), (r[0] + r[1]) / 2, H - 0.2, (r[2] + r[3]) / 2));
      }
    }
    // the cab plan: a chamfered square
    const plan = chamferSquare(CHF, 1.3);
    const sillTop = H + 0.9;
    const lean = Math.tan(REAL.towerCabRake * Math.PI / 180) * (CH - 0.9);
    const top = offsetPoly(plan, lean);
    // sill upstand (both faces), then the raked glass
    white.push(loft(plan, H, plan, sillTop, 1));
    white.push(loft(offsetPoly(plan, -0.14), H, offsetPoly(plan, -0.14), sillTop, 1, true));
    white.push(cap(plan, sillTop));
    glassG.push(loft(plan, sillTop, top, H + CH, 1));
    // mullions at every vertex and at the middle of each long face
    for (let i = 0; i < plan.length; i++) {
      const a = plan[i], b = top[i];
      dark.push(member(a[0], sillTop, a[1], b[0], H + CH, b[1], 0.12, 0.12));
      const a2 = plan[(i + 1) % plan.length], b2 = top[(i + 1) % plan.length];
      const L = Math.hypot(a2[0] - a[0], a2[1] - a[1]);
      if (L > 3) {
        for (const f of [1 / 3, 2 / 3]) {
          dark.push(member(a[0] + (a2[0] - a[0]) * f, sillTop, a[1] + (a2[1] - a[1]) * f,
            b[0] + (b2[0] - b[0]) * f, H + CH, b[1] + (b2[1] - b[1]) * f, 0.08, 0.1));
        }
      }
    }
    // catwalk outside the sill: grating ring + railing posts + rail
    const cw0 = offsetPoly(plan, 0.05), cw1 = offsetPoly(plan, 1.0);
    {
      const ringTop = [];
      for (let i = 0; i < cw1.length; i++) ringTop.push(cw1[i]);
      for (let i = 0; i < cw1.length; i++) {
        const a = cw1[i], b = cw1[(i + 1) % cw1.length];
        steel.push(member(a[0], H + 1.0, a[1], b[0], H + 1.0, b[1], 0.05));
        steel.push(member(a[0], H + 0.5, a[1], b[0], H + 0.5, b[1], 0.03));
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 1.5));
        for (let k = 0; k < n; k++) {
          const px = a[0] + (b[0] - a[0]) * k / n, pz = a[1] + (b[1] - a[1]) * k / n;
          steel.push(put(new THREE.BoxGeometry(0.05, 1.1, 0.05), px, H + 0.45, pz));
        }
      }
      // grating deck itself (a flat ring: loft with the same y reads edge-on,
      // so lay it as a thin cap annulus via two caps is not possible; use slabs)
      for (let i = 0; i < cw0.length; i++) {
        const a = cw0[i], b = cw0[(i + 1) % cw0.length], c = cw1[(i + 1) % cw0.length], d = cw1[i];
        const gq = new THREE.BufferGeometry();
        gq.setAttribute("position", new THREE.Float32BufferAttribute([
          a[0], H - 0.08, a[1], c[0], H - 0.08, c[1], b[0], H - 0.08, b[1],
          a[0], H - 0.08, a[1], d[0], H - 0.08, d[1], c[0], H - 0.08, c[1]], 3));
        gq.computeVertexNormals();
        if (gq.attributes.normal.getY(0) < 0) {
          gq.setAttribute("position", new THREE.Float32BufferAttribute([
            a[0], H - 0.08, a[1], b[0], H - 0.08, b[1], c[0], H - 0.08, c[1],
            a[0], H - 0.08, a[1], c[0], H - 0.08, c[1], d[0], H - 0.08, d[1]], 3));
          gq.computeVertexNormals();
        }
        steel.push(gq);
      }
    }
    // roof: a deep sunshade slab following the leaned plan, fascia, plant
    const roofP = offsetPoly(top, 0.9);
    dark.push(loft(roofP, H + CH, roofP, H + CH + 0.6, 1));
    white.push(cap(roofP, H + CH + 0.6));
    dark.push(cap(roofP, H + CH, true));
    steel.push(put(boxM(2.2, 0.9, 1.4, 1), -CHF * 0.35, H + CH + 1.05, CHF * 0.3));
    // antenna mast + yagi arms + radome
    const mx = CHF * 0.4, mz = -CHF * 0.4, yb = H + CH + 0.6;
    steel.push(put(new THREE.CylinderGeometry(0.07, 0.1, 6.0, 6), mx, yb + 3.0, mz));
    for (let k = 0; k < 3; k++) steel.push(put(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 4), mx, yb + 2.2 + k * 1.2, mz, k * 0.7, 0, Math.PI / 2));
    white.push(put(new THREE.SphereGeometry(0.7, 12, 8), -CHF * 0.35, yb + 1.3, -CHF * 0.4));
    white.push(put(new THREE.CylinderGeometry(0.45, 0.5, 0.5, 10), -CHF * 0.35, yb + 0.75, -CHF * 0.4));
    addMerged(g, conc, P.concreteMat(o.tint), { cast: true });
    addMerged(g, dark, cmat(0x2c3238), { cast: true });
    addMerged(g, steel, P.steelMat(0xc3c8cc), { cast: true });
    addMerged(g, white, P.steelMat(0xe9ecee), { cast: true });
    addMerged(g, glassG, P.glassMat(0.34), { cast: false, receive: false });
    const obm = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), lamp(0xff3a2a, 0.25, 1.6, root || parent));
    obm.position.set(mx, yb + 6.15, mz);
    g.add(obm);
    parent.add(g);
    return { group: g, roofY: H + CH + 0.6, glassY0: sillTop, glassY1: H + CH };
  };

  /* ==============================================================
     JET BRIDGE — apron-drive, DOCKED. It is solved from two points:
     the rotunda on the terminal's gate floor and the aeroplane's L1
     door. A fixed link off the facade to the rotunda (on its column),
     two telescoping glazed tunnel sections that slope from the gate
     floor down to the door sill, the drive column on its wheel bogie
     under the outer section, and the cab square to the fuselage with
     its bellows canopy closed round the door. It returns the walkable
     deck and its walls in the caller's frame, so the tunnel you see is
     the tunnel you walk down.
     o: { ax, az, ya (rotunda centre + floor), wnx, wnz (facade outward
          normal), bx, bz, yb (door point on the skin + sill), nx, nz
          (outward normal of the fuselage at the door) }
     ============================================================== */
  P.jetBridge = function (parent, o, root) {
    const g = new THREE.Group();
    g.name = "jet-bridge";
    const skin = [], dark = [], rubber = [], glassG = [], conc = [];
    const RR = 1.7, TH = 2.75;
    // ---- the rotunda and its fixed link to the facade
    const lk0x = o.ax - o.wnx * (RR + 1.5), lk0z = o.az - o.wnz * (RR + 1.5);
    skin.push(put(new THREE.CylinderGeometry(RR, RR, TH + 0.35, 20), o.ax, o.ya + TH / 2, o.az));
    dark.push(put(new THREE.CylinderGeometry(RR + 0.06, RR + 0.06, 0.25, 20), o.ax, o.ya + TH + 0.3, o.az));
    dark.push(put(new THREE.CylinderGeometry(RR * 0.95, RR * 0.95, 0.3, 20), o.ax, o.ya - 0.15, o.az));
    conc.push(put(new THREE.CylinderGeometry(0.45, 0.55, o.ya - 0.3, 12), o.ax, (o.ya - 0.3) / 2, o.az));   // the rotunda column
    {
      const mx = (lk0x + o.ax) / 2, mz = (lk0z + o.az) / 2, L = Math.hypot(o.ax - lk0x, o.az - lk0z);
      const yaw = Math.atan2(o.wnx, o.wnz);
      skin.push(put(boxM(2.9, 0.25, L, 1), mx, o.ya - 0.12, mz, yaw));
      skin.push(put(boxM(3.0, 0.2, L, 1), mx, o.ya + TH - 0.1, mz, yaw));
      for (const sg of [-1, 1]) {
        const ox = Math.cos(yaw) * sg * 1.45, oz = -Math.sin(yaw) * sg * 1.45;
        skin.push(put(boxM(0.1, 1.0, L, 1), mx + ox, o.ya + 0.5, mz + oz, yaw));
        glassG.push(put(new THREE.BoxGeometry(0.04, TH - 1.4, L), mx + ox, o.ya + 1.0 + (TH - 1.4) / 2, mz + oz, yaw));
      }
    }
    // ---- the cab, square to the fuselage
    const cw = 3.8, cd = 2.8, ch = TH + 0.35;
    const cx = o.bx + o.nx * (cd / 2 + 0.45), cz = o.bz + o.nz * (cd / 2 + 0.45);
    const cyaw = Math.atan2(o.nx, o.nz);             // cab local +z = away from the fuselage
    function cabPut(gg, lx, ly, lz) { gg.rotateY(cyaw); gg.translate(cx + lx * Math.cos(cyaw) + lz * Math.sin(cyaw), ly, cz - lx * Math.sin(cyaw) + lz * Math.cos(cyaw)); return gg; }
    skin.push(cabPut(boxM(cw, 0.25, cd, 1), 0, o.yb - 0.13, 0));
    skin.push(cabPut(boxM(cw + 0.1, 0.22, cd, 1), 0, o.yb + ch - 0.1, 0));
    for (const sg of [-1, 1]) {
      skin.push(cabPut(boxM(0.1, 1.0, cd, 1), sg * cw / 2, o.yb + 0.5, 0));
      glassG.push(cabPut(new THREE.BoxGeometry(0.04, ch - 1.35, cd), sg * cw / 2, o.yb + 1.0 + (ch - 1.35) / 2, 0));
    }
    // bellows canopy: concertina hoops from the cab face to the skin
    for (let i = 0; i < 4; i++) {
      const lz = -cd / 2 - 0.1 - i * 0.1, grow = 0.07 * i;
      rubber.push(cabPut(new THREE.BoxGeometry(2.9 + grow, 0.16, 0.12), 0, o.yb + ch + 0.02 + grow / 2, lz));
      for (const sg of [-1, 1]) rubber.push(cabPut(new THREE.BoxGeometry(0.16, ch + grow, 0.12), sg * (2.9 + grow) / 2, o.yb + ch / 2, lz));
    }
    rubber.push(cabPut(new THREE.BoxGeometry(3.0, 0.14, 0.45), 0, o.yb - 0.06, -cd / 2 - 0.25));   // bumper sill
    dark.push(cabPut(new THREE.CylinderGeometry(0.17, 0.17, 0.14, 10), 1.1, o.yb - 0.34, -cd / 2 + 0.3));   // auto-leveller wheel
    // ---- the tunnel: rotunda edge -> cab rear
    const rx = cx + o.nx * cd / 2, rz = cz + o.nz * cd / 2;
    let ux = rx - o.ax, uz = rz - o.az;
    const Lr = Math.hypot(ux, uz) || 1;
    ux /= Lr; uz /= Lr;
    const Ax = o.ax + ux * RR, Az = o.az + uz * RR;
    const L = Math.hypot(rx - Ax, rz - Az);
    const tyaw = Math.atan2(ux, uz);
    const dy = o.yb - o.ya;
    const pitch = -Math.asin(Math.max(-0.2, Math.min(0.2, dy / Math.max(1, L))));
    const lxv = Math.cos(tyaw), lzv = -Math.sin(tyaw);     // lateral unit (tunnel local +x)
    function tun(gg, s, lat, yoff) {
      // gg authored along +z centred at 0; place its centre at arclength s
      gg.rotateX(pitch); gg.rotateY(tyaw);
      const y = o.ya + dy * (s / L) + yoff;
      gg.translate(Ax + ux * s + lxv * lat, y, Az + uz * s + lzv * lat);
      return gg;
    }
    const sects = [[0, L * 0.58, 2.7, TH], [L * 0.5, L, 3.0, TH + 0.25]];
    for (const sc of sects) {
      const s0 = sc[0], s1 = sc[1], w = sc[2], h = sc[3], len = s1 - s0, sm = (s0 + s1) / 2;
      skin.push(tun(boxM(w, 0.22, len, 1), sm, 0, -0.11));
      skin.push(tun(boxM(w + 0.1, 0.18, len, 1), sm, 0, h - 0.09));
      for (const sg of [-1, 1]) {
        skin.push(tun(boxM(0.08, 0.95, len, 1), sm, sg * w / 2, 0.47));
        skin.push(tun(boxM(0.08, 0.5, len, 1), sm, sg * w / 2, h - 0.43));
        glassG.push(tun(new THREE.BoxGeometry(0.04, h - 1.63, len), sm, sg * w / 2, 0.95 + (h - 1.63) / 2));
        for (let s = s0 + 0.6; s < s1 - 0.3; s += 1.2) dark.push(tun(new THREE.BoxGeometry(0.1, h, 0.08), s, sg * (w / 2 + 0.03), h / 2 - 0.05));
      }
      dark.push(tun(new THREE.BoxGeometry(w + 0.22, h + 0.22, 0.16), s1 - 0.08, 0, h / 2 - 0.05));
    }
    // ---- drive column at 70 % along, on its bogie
    const sc = L * 0.72;
    const colx = Ax + ux * sc, colz = Az + uz * sc;
    const fy = o.ya + dy * (sc / L) - 0.25;
    const legH = fy;
    dark.push(put(new THREE.BoxGeometry(2.5, 0.4, 0.7), colx, fy, colz, tyaw));
    for (const sg of [-1, 1]) {
      const px = colx + lxv * sg * 0.95, pz = colz + lzv * sg * 0.95;
      skin.push(put(boxM(0.34, legH - 0.9, 0.34, 1), px, 0.9 + (legH - 0.9) / 2, pz, tyaw));
      dark.push(put(new THREE.CylinderGeometry(0.08, 0.08, legH - 1.1, 8), colx + lxv * sg * 0.6, 1.0 + (legH - 1.1) / 2, colz + lzv * sg * 0.6));
      rubber.push(put(new THREE.CylinderGeometry(0.5, 0.5, 0.38, 16), colx + lxv * sg * 1.15, 0.5, colz + lzv * sg * 1.15, tyaw, 0, Math.PI / 2));
      dark.push(put(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 10), colx + lxv * sg * 1.15, 0.5, colz + lzv * sg * 1.15, tyaw, 0, Math.PI / 2));
    }
    dark.push(put(new THREE.BoxGeometry(2.9, 0.5, 0.8), colx, 0.85, colz, tyaw));
    addMerged(g, skin, P.steelMat(0xd5d9dd), { cast: true });
    addMerged(g, dark, cmat(0x3a4046), { cast: true });
    addMerged(g, rubber, cmat(0x1b1d20), { cast: true });
    addMerged(g, glassG, P.glassMat(0.5), { cast: false, receive: false });
    addMerged(g, conc, P.concreteMat(), { cast: true });
    parent.add(g);

    // ---- the walkable deck, in the caller's frame: [cx, cz, w, d, top]
    const deck = [], walls = [];
    // fixed link + rotunda
    {
      const L2 = Math.hypot(o.ax - lk0x, o.az - lk0z);
      for (let s = 0; s <= L2; s += 0.9) deck.push([lk0x + o.wnx * s, lk0z + o.wnz * s, 2.4, 2.4, o.ya]);
      deck.push([o.ax, o.az, 3.0, 3.0, o.ya]);
    }
    for (let s = 0; s <= L + 0.01; s += 0.8) {
      const y = o.ya + dy * (s / L);
      deck.push([Ax + ux * s, Az + uz * s, 2.2, 2.2, y]);
      for (const sg of [-1, 1]) walls.push([Ax + ux * s + lxv * sg * 1.45, Az + uz * s + lzv * sg * 1.45, 0.3, 0.3, y, y + 2.4]);
    }
    // the cab deck, right up to the door
    for (let a = -1; a <= 1; a++) for (let b = -0.5; b <= 1.01; b += 0.75) {
      deck.push([cx + Math.cos(cyaw) * a * 1.1 + Math.sin(cyaw) * b * 0.9 - o.nx * 0.45, cz - Math.sin(cyaw) * a * 1.1 + Math.cos(cyaw) * b * 0.9 - o.nz * 0.45, 1.6, 1.6, o.yb]);
    }
    for (const sg of [-1, 1]) for (let b = -1.2; b <= 1.21; b += 0.6) {
      walls.push([cx + Math.cos(cyaw) * sg * cw / 2 + Math.sin(cyaw) * b, cz - Math.sin(cyaw) * sg * cw / 2 + Math.cos(cyaw) * b, 0.3, 0.3, o.yb, o.yb + 2.4]);
    }
    return {
      group: g, deck: deck, walls: walls,
      col: { x: colx, z: colz, w: 3.0, d: 1.2, h: legH },
      rotundaCol: { x: o.ax, z: o.az, w: 1.1, d: 1.1, h: o.ya - 0.3 },
      cab: { x: cx - o.nx * (cd / 2), z: cz - o.nz * (cd / 2), y: o.yb },
      length: L, slope: Math.abs(dy) / Math.max(1, L),
    };
  };

  /* ==============================================================
     THE BUILDINGS. Each builder authors in its OWN frame (origin at the
     building's centre on the ground, front = local +z) and returns
       { group, cols: [[cx, cz, w, d, yaw, y0, y1]], plats: [...], ... }
     in that frame. buildAirfield places the group and turns the
     footprints into world colliders (chopped when the field is crooked).
     ============================================================== */

  // sliding door leaves across an opening of width W, height Hd, at local
  // z = zf (front face), `open` = the fraction of the width standing open
  // (the leaves stack at both ends, on parallel tracks, as real hangar
  // doors do). Returns {geos, cols} for the closed leaves.
  function slidingDoors(W, Hd, zf, open, nLeaves) {
    const n = nLeaves || Math.max(4, Math.round(W / 9) & ~1);
    const lw = W / n, geos = [], frame = [], cols = [];
    const nOpen = Math.min(n - 2, Math.round((open || 0) * n / 2) * 2);   // even, centred
    const firstOpen = (n - nOpen) / 2;
    for (let i = 0; i < n; i++) {
      let x = -W / 2 + lw * (i + 0.5), track = i % 2;
      if (i >= firstOpen && i < firstOpen + nOpen) {
        // slid out of the opening: stacked behind the end leaves
        const left = i < n / 2;
        const k = left ? (i - firstOpen) : (firstOpen + nOpen - 1 - i);
        x = left ? (-W / 2 + lw * 0.5 + (k + 1) * 0.02) : (W / 2 - lw * 0.5 - (k + 1) * 0.02);
        track = 2 + k;
      }
      const z = zf + 0.25 + track * 0.32;
      geos.push(put(boxM(lw - 0.04, Hd, 0.22, 1, true), x, Hd / 2, z));
      // leaf framing: top and bottom rails and a mid rail, darker
      frame.push(put(new THREE.BoxGeometry(lw - 0.04, 0.25, 0.26), x, Hd - 0.13, z));
      frame.push(put(new THREE.BoxGeometry(lw - 0.04, 0.25, 0.26), x, 0.13, z));
      frame.push(put(new THREE.BoxGeometry(lw - 0.04, 0.12, 0.26), x, Hd / 2, z));
      if (!(i >= firstOpen && i < firstOpen + nOpen)) cols.push([x, z, lw, 0.5, 0, 0, Hd]);
    }
    return { geos: geos, frame: frame, cols: cols, gap: nOpen * lw };
  }

  /* HANGAR. type 'arch': a segmental barrel vault on low side walls, ribs
     every 6 m, glazed arch infill over the doors; type 'portal': a portal
     frame with a 6 degree duo-pitch roof, ribbon windows and a door header
     beam. Both: full-width sliding leaves (some open), an epoxy floor,
     high-bay lamps, a work stand. o: { w, d, h, type, open, tint } */
  P.hangar = function (o) {
    const W = o.w || 44, D = o.d || 40, Hh = o.h || 14, type = o.type || "arch";
    const g = new THREE.Group();
    g.name = "hangar";
    const clad = [], roof = [], dark = [], steel = [], glassG = [], floor = [], lampsG = [], yellow = [];
    const cols = [];
    const eave = Hh - Math.tan(6 * Math.PI / 180) * W / 2;
    // the door runs the full width, so the side walls (arch springing /
    // portal eaves) stand above the door head
    const doorH = type === "arch" ? Hh * 0.6 : Math.min(eave - 1.2, 18);
    const zF = D / 2, zB = -D / 2;
    let profile;                                     // the section, as points across x
    if (type === "arch") {
      const hs = doorH + 0.6, rise = Hh - hs, R = ((W / 2) * (W / 2) + rise * rise) / (2 * rise), cy = Hh - R;
      const a0 = Math.asin((W / 2) / R);
      profile = [];
      for (let i = 0; i <= 24; i++) {
        const a = -a0 + (2 * a0) * (i / 24);
        profile.push([R * Math.sin(a), cy + R * Math.cos(a)]);
      }
      profile.unshift([-W / 2, 0]); profile.push([W / 2, 0]);
    } else {
      profile = [[-W / 2, 0], [-W / 2, eave], [0, Hh], [W / 2, eave], [W / 2, 0]];
    }
    // the roof skin (and upper walls) along the depth, profiled sheet
    for (let i = 0; i < profile.length - 1; i++) {
      const a = profile[i], b = profile[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const q = new THREE.PlaneGeometry(D, L);
      uvScale(q, D, L);
      // plane in XY facing +z -> spanning depth (z) and y, facing +/-x, then
      // tilted onto the segment; which way it faces is decided before the
      // tilt so the skin always faces out of the building
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const flip = (Math.sin(ang) * mx - Math.cos(ang) * (my - Hh * 0.3)) < 0;
      q.rotateY(flip ? -Math.PI / 2 : Math.PI / 2);
      q.rotateZ(ang - Math.PI / 2);
      q.translate(mx, my, 0);
      (i === 0 || i === profile.length - 2 ? clad : roof).push(q);
    }
    // gable walls: the back is solid cladding, the front is a header over the door
    const backShape = profile.map(function (p) { return [p[0], p[1]]; });
    const bw = prism(backShape, 0.3);
    bw.translate(0, 0, zB - 0.3);
    clad.push(uvScale(bw, 1, 1));
    // front: everything in the section above the door head
    {
      const fr = profile.filter(function (p) { return p[1] >= doorH; });
      const pts = [[-W / 2, doorH]].concat(fr.filter(function (p) { return p[1] > doorH; })).concat([[W / 2, doorH]]);
      if (type === "arch") {
        // a band of glazing just above the door head, then cladding
        const fp = prism(pts, 0.3);
        fp.translate(0, 0, zF - 0.3);
        clad.push(fp);
        glassG.push(put(new THREE.BoxGeometry(W * 0.8, 1.6, 0.05), 0, doorH + 1.4, zF + 0.02));
      } else {
        const fp = prism(pts, 0.3);
        fp.translate(0, 0, zF - 0.3);
        clad.push(fp);
      }
      // the door header beam and the track
      dark.push(put(new THREE.BoxGeometry(W + 0.4, 1.1, 1.8), 0, doorH + 0.55, zF + 0.6));
      steel.push(put(new THREE.BoxGeometry(W + 6, 0.12, 1.6), 0, 0.06, zF + 0.6));
      // door pockets: the end columns the leaves stack against
      for (const sg of [-1, 1]) dark.push(put(new THREE.BoxGeometry(0.8, doorH + 1.1, 2.0), sg * (W / 2 + 0.2), (doorH + 1.1) / 2, zF + 0.5));
    }
    const doors = slidingDoors(W, doorH, zF, o.open == null ? 0.5 : o.open, o.leaves);
    for (const q of doors.geos) clad.push(q);
    for (const q of doors.frame) dark.push(q);
    for (const c of doors.cols) cols.push(c);
    // side walls: ribbon windows on a portal shed
    if (type !== "arch") {
      for (const sg of [-1, 1]) glassG.push(put(new THREE.BoxGeometry(0.05, 1.2, D * 0.9), sg * (W / 2 + 0.03), Math.min(profile[1][1] - 1.5, 7), 0));
    }
    // arch ribs / portal rafters inside, every 6 m
    for (let z = zB + 3; z < zF - 1; z += 6) {
      for (let i = 1; i < profile.length - 2; i++) {
        const a = profile[i], b = profile[i + 1];
        steel.push(member(a[0] * 0.985, a[1] - 0.35, z, b[0] * 0.985, b[1] - 0.35, z, 0.25, 0.5));
      }
      if (type !== "arch") for (const sg of [-1, 1]) steel.push(put(new THREE.BoxGeometry(0.4, profile[1][1], 0.5), sg * (W / 2 - 0.4), profile[1][1] / 2, z));
      // high-bay lamps hanging from the rafters
      for (const lx of [-W / 4, 0, W / 4]) {
        const top = type === "arch" ? Hh - 1.5 : Hh - 1.2;
        steel.push(put(new THREE.CylinderGeometry(0.01, 0.01, 2.2, 3), lx, top - 1.1, z));
        dark.push(put(new THREE.CylinderGeometry(0.25, 0.42, 0.45, 10, 1, true), lx, top - 2.3, z));
        lampsG.push(put(new THREE.CircleGeometry(0.38, 10), lx, top - 2.52, z, 0, Math.PI / 2));
      }
    }
    // the floor: sealed concrete with a painted aircraft centreline
    floor.push(put(boxM(W - 0.6, 0.06, D - 0.6, 1), 0, 0.03, 0));
    yellow.push(put(new THREE.BoxGeometry(0.2, 0.01, D - 4), 0, 0.065, 0));
    // a maintenance work stand (yellow steel, two decks, stair) and tool chests
    {
      const sx = W * 0.22, sz = -D * 0.1;
      for (const y of [2.2, 4.4]) yellow.push(put(new THREE.BoxGeometry(3.2, 0.08, 6), sx, y, sz));
      for (const cx of [-1.5, 1.5]) for (const cz of [-2.9, 2.9]) yellow.push(put(new THREE.BoxGeometry(0.12, 5.4, 0.12), sx + cx, 2.7, sz + cz));
      for (const y of [3.2, 5.4]) for (const cx of [-1.55, 1.55]) yellow.push(put(new THREE.BoxGeometry(0.05, 0.05, 6), sx + cx, y, sz));
      yellow.push(member(sx - 1.6, 0.0, sz + 5.5, sx - 1.6, 2.2, sz + 2.9, 0.9, 0.08));
      for (let k = 0; k < 4; k++) dark.push(put(boxM(1.2, 1.0, 0.6, 1), -W / 2 + 2 + k * 1.4, 0.5, zB + 1.2));
      cols.push([sx, sz, 3.2, 6, 0, 0, 5.4]);
    }
    // colliders: back wall, side walls, the door pockets
    cols.push([0, zB - 0.15, W, 0.4, 0, 0, Hh]);
    for (const sg of [-1, 1]) {
      cols.push([sg * (W / 2), 0, 0.5, D, 0, 0, Hh * 0.5]);
      cols.push([sg * (W / 2 + 0.2), zF + 0.5, 0.9, 2.0, 0, 0, doorH]);
    }
    // double-sided: the hangar is seen from inside through its open doors
    addMerged(g, clad, P.cladMat2(o.tint || 0xc7ccd1), { cast: true });
    addMerged(g, roof, P.cladMat2(o.roofTint || 0xaab1b8), { cast: true });
    addMerged(g, dark, cmat(0x3b4148), { cast: true });
    addMerged(g, steel, P.steelMat(0x9ea6ad), { cast: false });
    addMerged(g, glassG, P.glassMat(0.5), { cast: false, receive: false });
    addMerged(g, floor, P.concreteMat(0xb9bcbc), {});
    addMerged(g, yellow, cmat(0xe0b020), { cast: true });
    return { group: g, cols: cols, lamps: lampsG, doorGap: doors.gap, doorH: doorH };
  };

  /* SHED: a portal-frame warehouse (cargo, ground-support workshop).
     Profiled walls over a concrete dado, a 6 degree roof, roller shutters
     on the airside (+z) face, truck dock doors with shelters and levellers
     on the landside (-z) face, a canopy over the docks. o: { w, d, h,
     airside: n doors, docks: n, tint } */
  P.shed = function (o) {
    const W = o.w || 60, D = o.d || 30, Hh = o.h || 9;
    const g = new THREE.Group();
    g.name = "shed";
    const clad = [], dado = [], dark = [], shutter = [], roof = [], yellow = [], glassG = [];
    const cols = [];
    const ridge = Hh + Math.tan(6 * Math.PI / 180) * D / 2;
    // walls: dado + profiled cladding, openings left where the doors are
    const nAir = o.airside == null ? 3 : o.airside, nDock = o.docks == null ? 4 : o.docks;
    const airDoors = [], dockDoors = [];
    for (let i = 0; i < nAir; i++) airDoors.push(-W / 2 + W * (i + 0.5) / nAir);
    for (let i = 0; i < nDock; i++) dockDoors.push(-W / 2 + 6 + i * 4.2);
    const adW = 8, adH = 6.5, ddW = 3.0, ddH = 3.2;
    function wallRun(z, doorsX, dw, dh, face) {
      // segments between openings
      const xs = [-W / 2].concat([].concat.apply([], doorsX.map(function (x) { return [x - dw / 2, x + dw / 2]; }))).concat([W / 2]);
      for (let i = 0; i < xs.length; i += 2) {
        const a = xs[i], b = xs[i + 1];
        if (b - a < 0.05) continue;
        clad.push(put(boxM(b - a, Hh - 1.2, 0.2, 1, true), (a + b) / 2, 1.2 + (Hh - 1.2) / 2, z));
        dado.push(put(boxM(b - a, 1.2, 0.25, 1), (a + b) / 2, 0.6, z));
        cols.push([(a + b) / 2, z, b - a, 0.4, 0, 0, Hh]);
      }
      for (const x of doorsX) {
        clad.push(put(boxM(dw, Hh - dh, 0.2, 1, true), x, dh + (Hh - dh) / 2, z));
        // door frame
        for (const sg of [-1, 1]) dark.push(put(new THREE.BoxGeometry(0.25, dh, 0.35), x + sg * (dw / 2 + 0.12), dh / 2, z));
        dark.push(put(new THREE.BoxGeometry(dw + 0.5, 0.5, 0.45), x, dh + 0.25, z));
      }
    }
    wallRun(D / 2, airDoors, adW, adH, 1);
    wallRun(-D / 2, dockDoors, ddW, ddH, -1);
    for (const sg of [-1, 1]) {
      clad.push(put(boxM(0.2, Hh - 1.2, D, 1, true), sg * W / 2, 1.2 + (Hh - 1.2) / 2, 0));
      dado.push(put(boxM(0.25, 1.2, D, 1), sg * W / 2, 0.6, 0));
      // gable triangle
      const tri = prism([[-D / 2, Hh], [D / 2, Hh], [0, ridge]], 0.2);
      tri.rotateY(Math.PI / 2);
      tri.translate(sg * W / 2 - 0.1, 0, 0);
      clad.push(tri);
      cols.push([sg * W / 2, 0, 0.4, D, 0, 0, Hh]);
      glassG.push(put(new THREE.BoxGeometry(0.05, 0.9, D * 0.8), sg * (W / 2 + 0.12), Hh - 1.4, 0));
    }
    // roof planes
    const slope = Math.hypot(D / 2, ridge - Hh);
    for (const sg of [-1, 1]) {
      const q = boxM(W + 0.8, 0.12, slope + 0.5, 1);
      q.rotateX(sg * Math.atan2(ridge - Hh, D / 2));
      q.translate(0, (Hh + ridge) / 2 + 0.06, sg * D / 4);
      roof.push(q);
    }
    // roller shutters: airside half open, dock doors shut
    for (let i = 0; i < airDoors.length; i++) {
      const up = (i % 2 === 0) ? 0.25 : 1.0;
      const hh = adH * up;
      shutter.push(put(boxM(adW, hh, 0.15, 1, true), airDoors[i], adH - hh / 2, D / 2 + 0.05));
      dark.push(put(new THREE.CylinderGeometry(0.45, 0.45, adW + 0.3, 12), airDoors[i], adH + 0.55, D / 2 + 0.35, 0, 0, Math.PI / 2));
      if (up >= 1) cols.push([airDoors[i], D / 2, adW, 0.4, 0, 0, adH]);
    }
    for (const x of dockDoors) {
      shutter.push(put(boxM(ddW, ddH, 0.12, 1, true), x, ddH / 2 + 1.2, -D / 2 - 0.05));
      // dock shelter (black foam pads) + leveller lip + bumpers
      for (const sg of [-1, 1]) dark.push(put(new THREE.BoxGeometry(0.5, ddH + 0.6, 0.9), x + sg * (ddW / 2 + 0.25), 1.2 + ddH / 2, -D / 2 - 0.5));
      dark.push(put(new THREE.BoxGeometry(ddW + 1, 0.6, 0.9), x, 1.2 + ddH + 0.3, -D / 2 - 0.5));
      yellow.push(put(new THREE.BoxGeometry(ddW, 0.1, 0.5), x, 1.25, -D / 2 - 0.3));
      for (const sg of [-1, 1]) dark.push(put(new THREE.BoxGeometry(0.3, 0.4, 0.25), x + sg * 1.2, 0.9, -D / 2 - 0.15));
    }
    // raised dock platform strip along the landside and the canopy over it
    if (nDock) {
      const x0 = dockDoors[0] - 3, x1 = dockDoors[dockDoors.length - 1] + 3;
      roof.push(put(boxM(x1 - x0 + 2, 0.25, 4.5, 1), (x0 + x1) / 2, ddH + 2.6, -D / 2 - 2.25));
      for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / 3) dark.push(put(new THREE.BoxGeometry(0.2, 0.2, 4.6), x, ddH + 2.3, -D / 2 - 2.3));
    }
    addMerged(g, clad, P.cladMat(o.tint || 0xd2d5d8), { cast: true });
    addMerged(g, dado, P.concreteMat(0xb5b1a8), {});
    addMerged(g, roof, P.cladMat(0x9aa3aa), { cast: true });
    addMerged(g, dark, cmat(0x33383e), { cast: true });
    addMerged(g, shutter, P.cladMat(o.shutterTint || 0x8d949b), { cast: true });
    addMerged(g, yellow, cmat(0xe0b020), {});
    addMerged(g, glassG, P.glassMat(0.5), { cast: false, receive: false });
    return { group: g, cols: cols, airDoors: airDoors, dockDoors: dockDoors };
  };

  /* ULD containers (LD3-class, 1.56 x 1.63 m base, 1.53 tall, with the
     contoured shoulder) on their dollies, instanced. pts: [x, z, yaw, stack] */
  P.ulds = function (parent, pts) {
    if (!pts.length) return null;
    const grp = new THREE.Group();
    grp.name = "ulds";
    const body = prism([[-0.78, 0], [0.78, 0], [0.78, 1.53], [-0.4, 1.53], [-1.23, 1.0], [-1.23, 0.0]], 1.53);
    body.translate(0, 0, -0.765);
    const dolly = mergeGeos([
      put(boxM(2.6, 0.12, 1.9, 1), 0, 0.5, 0),
      put(new THREE.BoxGeometry(2.7, 0.05, 0.05), 0, 0.6, 0.95),
      put(new THREE.BoxGeometry(2.7, 0.05, 0.05), 0, 0.6, -0.95),
      put(new THREE.BoxGeometry(0.9, 0.08, 0.1), 1.75, 0.4, 0),
    ]);
    const wheelsG = [];
    for (const wx of [-0.95, 0.95]) for (const wz of [-0.8, 0.8]) wheelsG.push(put(new THREE.CylinderGeometry(0.2, 0.2, 0.15, 10), wx, 0.2, wz, 0, Math.PI / 2));
    const wg = mergeGeos(wheelsG);
    const list = pts.map(function (p) { return [p[0], p[1], "w", 0, p[2] || 0]; });
    grp.add(instanceAt(dolly, cmat(0x6c737a), list, 0));
    grp.add(instanceAt(wg, cmat(0x17191c), list, 0));
    const withBox = [];
    for (const p of pts) if (p[3] !== 0) withBox.push([p[0], p[1], "w", 0.62, p[2] || 0]);
    const tones = [0xb9bfc5, 0xc9ccce, 0xa8aeb4];
    for (let t = 0; t < tones.length; t++) {
      const part = withBox.filter(function (_, i) { return i % tones.length === t; });
      if (part.length) grp.add(instanceAt(body, P.cladMat(tones[t]), part, null));
    }
    parent.add(grp);
    return grp;
  };

  /* FUEL FARM: vertical cone-roof tanks (white, a spiral stair round each,
     a handrail round the roof), a concrete bund wall holding 110 % of the
     largest tank, a pipe rack to a truck fill stand under a canopy, a pump
     house. o: { tanks: [[x, z, r, h]], bund: {x0, z0, x1, z1} } in its frame */
  P.fuelFarm = function (o) {
    const g = new THREE.Group();
    g.name = "fuel-farm";
    const white = [], steel = [], conc = [], dark = [], pipe = [], red = [];
    const cols = [];
    for (const t of o.tanks) {
      const x = t[0], z = t[1], r = t[2], h = t[3];
      white.push(put(new THREE.CylinderGeometry(r, r, h, 36, 1, true), x, h / 2, z));
      white.push(put(new THREE.ConeGeometry(r + 0.15, r * 0.2, 36, 1), x, h + r * 0.1, z));
      conc.push(put(new THREE.CylinderGeometry(r + 0.5, r + 0.6, 0.4, 36), x, 0.2, z));
      // stiffener rings
      for (let y = 2.4; y < h; y += 2.4) steel.push(put(new THREE.TorusGeometry(r + 0.02, 0.05, 4, 36), x, y, z, 0, Math.PI / 2));
      // spiral stair: stringer + treads up one quarter of the shell
      const turns = 0.32, steps = Math.ceil(h / 0.22);
      let prev = null;
      for (let i = 0; i <= steps; i++) {
        const a = Math.PI * 0.25 + (i / steps) * turns * Math.PI * 2;
        const y = (i / steps) * h;
        const px = x + Math.cos(a) * (r + 0.55), pz = z + Math.sin(a) * (r + 0.55);
        const tr = new THREE.BoxGeometry(0.9, 0.04, 0.28);
        tr.rotateY(-a);
        tr.translate(px, y, pz);
        steel.push(tr);
        const ox = x + Math.cos(a) * (r + 1.0), oz = z + Math.sin(a) * (r + 1.0);
        if (prev) {
          steel.push(member(prev[0], prev[1] + 1.0, prev[2], ox, y + 1.0, oz, 0.04));
          steel.push(member(prev[3], prev[1] - 0.1, prev[4], ox, y - 0.1, oz, 0.05, 0.2));
        }
        if (i % 4 === 0) steel.push(put(new THREE.BoxGeometry(0.04, 1.0, 0.04), ox, y + 0.5, oz));
        prev = [ox, y, oz, ox, oz];
      }
      // roof handrail
      steel.push(put(new THREE.TorusGeometry(r - 0.2, 0.03, 4, 36), x, h + 1.0, z, 0, Math.PI / 2));
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2;
        steel.push(put(new THREE.BoxGeometry(0.04, 1.0, 0.04), x + Math.cos(a) * (r - 0.2), h + 0.5, z + Math.sin(a) * (r - 0.2)));
      }
      // a red hazard band and the foam pourer boxes
      red.push(put(new THREE.CylinderGeometry(r + 0.01, r + 0.01, 0.5, 36, 1, true), x, h - 0.6, z));
      cols.push([x, z, r * 1.8, r * 1.8, 0, 0, h + 1]);
    }
    // bund wall
    if (o.bund) {
      const b = o.bund, bh = 1.3;
      const runs = [[b.x0, b.z0, b.x1, b.z0], [b.x1, b.z0, b.x1, b.z1], [b.x1, b.z1, b.x0, b.z1], [b.x0, b.z1, b.x0, b.z0]];
      for (const r of runs) {
        const L = Math.hypot(r[2] - r[0], r[3] - r[1]);
        const yaw = Math.atan2(r[2] - r[0], r[3] - r[1]);
        conc.push(put(boxM(0.3, bh, L, 1), (r[0] + r[2]) / 2, bh / 2, (r[1] + r[3]) / 2, yaw));
        cols.push([(r[0] + r[2]) / 2, (r[1] + r[3]) / 2, Math.abs(r[2] - r[0]) + 0.3, Math.abs(r[3] - r[1]) + 0.3, 0, 0, bh]);
      }
      // stile over the bund wall (a stair up and down)
      const sx = (b.x0 + b.x1) / 2;
      for (const sg of [-1, 1]) for (let k = 0; k < 5; k++) steel.push(put(new THREE.BoxGeometry(1.0, 0.05, 0.28), sx, 0.3 + k * 0.28, b.z1 + sg * (1.6 - k * 0.3)));
      // pipe rack from the tanks to the fill stand
      const px = b.x1, pz0 = (b.z0 + b.z1) / 2;
      const fx = px + 14;
      for (let k = 0; k < 3; k++) pipe.push(tube(o.tanks[0][0], 0.6 + k * 0.45, o.tanks[0][1], fx, 0.6 + k * 0.45, pz0, 0.14, 8));
      for (let x = px - 4; x < fx; x += 4) steel.push(put(new THREE.BoxGeometry(0.2, 1.8, 1.2), x, 0.9, pz0));
      // truck fill stand: a canopy on four columns over two bays, a loading arm
      conc.push(put(boxM(10, 0.2, 16, 1), fx + 5, 0.1, pz0));
      for (const cx of [fx + 0.5, fx + 9.5]) for (const cz of [pz0 - 7, pz0 + 7]) steel.push(put(new THREE.BoxGeometry(0.35, 6, 0.35), cx, 3, cz));
      dark.push(put(boxM(11, 0.5, 17, 1), fx + 5, 6.2, pz0));
      pipe.push(tube(fx + 5, 5.6, pz0, fx + 5, 2.5, pz0 - 3, 0.1, 8));
      pipe.push(tube(fx + 5, 2.5, pz0 - 3, fx + 5, 2.3, pz0 - 5, 0.08, 8));
      dark.push(put(boxM(4, 3, 3, 1), fx + 5, 1.5, pz0 + 10));          // pump house
      cols.push([fx + 5, pz0 + 10, 4, 3, 0, 0, 3]);
    }
    addMerged(g, white, P.steelMat(0xeef0f1), { cast: true });
    addMerged(g, steel, P.steelMat(0xa9b0b6), { cast: true });
    addMerged(g, conc, P.concreteMat(0xbdb9b0), { cast: true });
    addMerged(g, dark, cmat(0x5b636b), { cast: true });
    addMerged(g, pipe, P.steelMat(0xc8b04a), { cast: true });
    addMerged(g, red, cmat(0xb8322a), {});
    return { group: g, cols: cols };
  };

  /* ARFF FIRE STATION: apparatus bays (roller shutters, some up, the
     crash tenders' bays), a watch room on top with raked glass toward the
     runway, a hose-drying tower, the crew block with punched windows.
     Front = local +z (toward the runway). Returns the bay positions so a
     tender can be parked in each. o: { bays, bayW, bayH } */
  P.fireStation = function (o, root) {
    const nb = o.bays || 4, bw = o.bayW || 6.0, bh = o.bayH || 5.5, D = o.d || 24;
    const W = nb * (bw + 1.2) + 14;
    const g = new THREE.Group();
    g.name = "fire-station";
    const brick = [], conc = [], dark = [], shutterUp = [], shutter = [], glassG = [], red = [], lit = [];
    const cols = [];
    const bays = [];
    const H1 = bh + 1.8;
    // apparatus hall
    const hallW = nb * (bw + 1.2) + 1.2, hx0 = -W / 2;
    const zF = D / 2;
    for (let i = 0; i < nb; i++) {
      const x = hx0 + 1.2 + bw / 2 + i * (bw + 1.2);
      bays.push({ x: x, z: zF - D * 0.4, open: i % 2 === 0 });
      // pier between bays
      conc.push(put(boxM(1.2, bh, 0.6, 1), x - bw / 2 - 0.6, bh / 2, zF));
      if (i % 2 === 0) {
        shutterUp.push(put(new THREE.CylinderGeometry(0.5, 0.5, bw + 0.2, 12), x, bh + 0.5, zF - 0.2, 0, 0, Math.PI / 2));
      } else {
        shutter.push(put(boxM(bw, bh, 0.12, 1, true), x, bh / 2, zF - 0.1));
        cols.push([x, zF - 0.1, bw, 0.4, 0, 0, bh]);
      }
    }
    conc.push(put(boxM(1.2, bh, 0.6, 1), hx0 + hallW - 0.6, bh / 2, zF));
    conc.push(put(boxM(hallW, H1 - bh, 0.6, 1), hx0 + hallW / 2, bh + (H1 - bh) / 2, zF));
    red.push(put(new THREE.BoxGeometry(hallW, 0.6, 0.1), hx0 + hallW / 2, bh + 0.9, zF + 0.32));
    // hall side/back walls
    brick.push(put(boxM(hallW, H1, 0.4, 1), hx0 + hallW / 2, H1 / 2, -D / 2));
    cols.push([hx0 + hallW / 2, -D / 2, hallW, 0.5, 0, 0, H1]);
    brick.push(put(boxM(0.4, H1, D, 1), hx0, H1 / 2, 0));
    cols.push([hx0, 0, 0.5, D, 0, 0, H1]);
    conc.push(put(boxM(hallW, 0.5, D, 1), hx0 + hallW / 2, H1 + 0.25, 0));
    // floor with bay lines
    conc.push(put(boxM(hallW, 0.05, D, 1), hx0 + hallW / 2, 0.025, 0));
    // crew block: two storeys, punched windows
    const cx0 = hx0 + hallW, cw = W - hallW, ch = 7.4;
    brick.push(put(boxM(cw, ch, D, 1), cx0 + cw / 2, ch / 2, 0));
    cols.push([cx0 + cw / 2, 0, cw, D, 0, 0, ch]);
    for (const y of [1.7, 5.1]) for (let x = cx0 + 1.5; x < cx0 + cw - 1; x += 2.6) {
      glassG.push(put(new THREE.BoxGeometry(1.5, 1.4, 0.06), x, y, zF + 0.02));
      dark.push(put(new THREE.BoxGeometry(1.7, 0.12, 0.2), x, y - 0.76, zF + 0.08));
    }
    dark.push(put(new THREE.BoxGeometry(1.4, 2.3, 0.08), cx0 + cw - 2, 1.15, zF + 0.03));
    // the watch room: on the crew block roof, glazed on three sides, raked
    {
      const wx = cx0 + cw / 2, wz = zF - 4.5, ww = Math.min(cw - 1, 8), wd = 6;
      const plan = [[wx - ww / 2, wz - wd / 2], [wx + ww / 2, wz - wd / 2], [wx + ww / 2, wz + wd / 2], [wx - ww / 2, wz + wd / 2]];
      const ccw = plan;
      conc.push(loft(ccw, ch, ccw, ch + 1.0, 1));
      glassG.push(loft(ccw, ch + 1.0, offsetPoly(ccw, 0.45), ch + 3.0, 1));
      dark.push(put(boxM(ww + 2.2, 0.4, wd + 2.2, 1), wx, ch + 3.2, wz));
      lit.push(put(new THREE.BoxGeometry(ww - 1, 0.05, 0.3), wx, ch + 2.9, wz));
    }
    // hose-drying tower
    {
      const tx = hx0 - 2.6, tz = -D / 2 + 3;
      conc.push(put(boxM(3.2, 16, 3.2, 1), tx, 8, tz));
      dark.push(put(boxM(3.6, 0.4, 3.6, 1), tx, 16.2, tz));
      for (let y = 3; y < 15; y += 3) glassG.push(put(new THREE.BoxGeometry(0.8, 1.2, 0.05), tx, y, tz + 1.62));
      cols.push([tx, tz, 3.2, 3.2, 0, 0, 16]);
    }
    // a red beacon over the doors, the station's one light that means "out"
    const bm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.2), lamp(0xff2a1a, 0.2, 1.4, root));
    bm.position.set(hx0 + hallW / 2, H1 + 0.62, zF + 0.1);
    g.add(bm);
    addMerged(g, brick, P.plasterMat(0xd9d2c5), { cast: true });
    addMerged(g, conc, P.concreteMat(0xc9c5bc), { cast: true });
    addMerged(g, dark, cmat(0x30353b), { cast: true });
    addMerged(g, shutter, P.cladMat(0xb8322a), { cast: true });
    addMerged(g, shutterUp, cmat(0x9a2a24), { cast: true });
    addMerged(g, glassG, P.glassMat(0.42), { cast: false, receive: false });
    addMerged(g, red, cmat(0xb8322a), {});
    addMerged(g, lit, lamp(0xfff2d8, 0.2, 1.2, root), {});
    return { group: g, cols: cols, bays: bays, w: W, d: D };
  };

  /* MULTI-STOREY CAR PARK: post-tensioned decks at 3.1 m on a 7.8 m
     column grid, spandrel upstands with an open gap to the next slab,
     a stair core at each end with a glazed lift shaft, the ramp between
     split levels, painted bays. Walkable: every deck is a platform and
     the stair cores climb. o: { w, d, levels } (w along local x). */
  P.carPark = function (o, root) {
    const W = o.w || 72, D = o.d || 32, NL = o.levels || 3, FH = 3.1;
    const g = new THREE.Group();
    g.name = "car-park";
    const conc = [], dark = [], glassG = [], white = [], lit = [], yellow = [];
    const cols = [], plats = [];
    const coreW = 5.2;
    const x0 = -W / 2 + coreW, x1 = W / 2 - coreW;           // the deck between the two cores
    for (let L = 1; L <= NL; L++) {
      const y = L * FH;
      conc.push(put(boxM(x1 - x0, 0.3, D, 2), (x0 + x1) / 2, y - 0.15, 0));
      // spandrel upstands (1.1 m) on the long sides and ends
      for (const sg of [-1, 1]) {
        conc.push(put(boxM(x1 - x0, 1.05, 0.25, 1), (x0 + x1) / 2, y + 0.52, sg * (D / 2 - 0.12)));
        cols.push([(x0 + x1) / 2, sg * (D / 2 - 0.12), x1 - x0, 0.3, 0, y - 0.3, y + 1.1]);
      }
      // bay lines + wheel stops
      for (let x = x0 + 1.2; x < x1 - 1; x += 2.5) for (const sg of [-1, 1]) {
        white.push(put(new THREE.BoxGeometry(0.1, 0.01, 5), x, y + 0.006, sg * (D / 2 - 3)));
      }
      for (let x = x0 + 2.45; x < x1 - 1; x += 2.5) for (const sg of [-1, 1]) {
        yellow.push(put(new THREE.BoxGeometry(1.6, 0.12, 0.2), x, y + 0.06, sg * (D / 2 - 1.1)));
      }
      // deck soffit lights for the level below
      for (let x = x0 + 4; x < x1 - 2; x += 7.8) for (const z of [-D / 4, D / 4]) lit.push(put(new THREE.BoxGeometry(1.2, 0.05, 0.2), x, y - 0.33, z));
      // walkable: one platform per deck (a car park is on the world grid)
      plats.push([(x0 + x1) / 2, 0, x1 - x0, D, y]);
    }
    for (let x = x0 + 4; x < x1 - 2; x += 7.8) for (const z of [-D / 4, D / 4]) lit.push(put(new THREE.BoxGeometry(1.2, 0.05, 0.2), x, FH - 0.33, z));
    // columns on a 7.8 m grid
    for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / Math.round((x1 - x0) / 7.8)) {
      for (const z of [-D / 2 + 0.4, 0, D / 2 - 0.4]) {
        conc.push(put(boxM(0.5, NL * FH, 0.5, 1), x, NL * FH / 2, z));
        cols.push([x, z, 0.5, 0.5, 0, 0, NL * FH]);
      }
    }
    // roof level parapet + lamp posts
    for (let x = x0 + 6; x < x1; x += 12) for (const sg of [-1, 1]) {
      dark.push(put(new THREE.CylinderGeometry(0.07, 0.09, 5, 8), x, NL * FH + 2.5, sg * (D / 2 - 0.6)));
      lit.push(put(new THREE.BoxGeometry(0.5, 0.12, 0.3), x, NL * FH + 5.0, sg * (D / 2 - 0.9)));
    }
    // the two stair / lift cores
    for (const sg of [-1, 1]) {
      const cx = sg * (W / 2 - coreW / 2), H = NL * FH + 3.2;
      conc.push(put(boxM(coreW, H, 0.3, 1), cx, H / 2, -D / 2 + 6));
      conc.push(put(boxM(0.3, H, 6, 1), cx + sg * (coreW / 2 - 0.15), H / 2, -D / 2 + 3));
      glassG.push(put(new THREE.BoxGeometry(2.2, H - 0.5, 2.2), cx, (H - 0.5) / 2, -D / 2 + 1.5));   // the lift shaft
      dark.push(put(boxM(coreW + 0.4, 0.4, 6.4, 1), cx, H + 0.2, -D / 2 + 3));
      cols.push([cx, -D / 2 + 1.5, 2.2, 2.2, 0, 0, H]);
      // the stair: switchback flights from grade to each deck, platforms per tread
      for (let L = 0; L < NL; L++) {
        const yA = L * FH, n = 10, rise = FH / n;
        for (let k = 0; k < n; k++) {
          const y = yA + (k + 1) * rise;
          const up = (L % 2 === 0);
          const z = -D / 2 + 3.5 + (up ? k : n - 1 - k) * 0.28 + 0.8;
          const sx = cx - sg * 0.9;
          conc.push(put(boxM(1.6, 0.12, 0.3, 1), sx, y - 0.06, z));
          plats.push([sx, z, 1.6, 0.34, y]);
        }
        plats.push([cx - sg * 0.9, -D / 2 + 7.2, 1.8, 1.6, yA + FH]);   // the landing onto the deck
      }
    }
    // the internal ramp (split between decks), drawn: vehicles use the gate road
    for (let L = 0; L < NL; L++) {
      const yA = L * FH;
      const q = boxM(22, 0.3, 6.5, 1);
      q.rotateZ(Math.atan2(FH, 22) * (L % 2 ? -1 : 1));
      q.translate(0, yA + FH / 2, D / 2 - 5);
      conc.push(q);
    }
    addMerged(g, conc, P.concreteMat(0xc4c0b7), { cast: true });
    addMerged(g, dark, cmat(0x3a3f45), { cast: true });
    addMerged(g, glassG, P.glassMat(0.4), { cast: false, receive: false });
    addMerged(g, white, cmat(0xe6e9ec), {});
    addMerged(g, yellow, cmat(0xe0b020), {});
    addMerged(g, lit, lamp(0xfff0d8, 0.15, 1.3, root), {});
    return { group: g, cols: cols, plats: plats, w: W, d: D, h: NL * FH };
  };

  /* RENTAL CAR RETURN: a steel canopy over a row of bays and a kiosk. */
  P.rentalCanopy = function (o, root) {
    const W = o.w || 40, D = o.d || 14;
    const g = new THREE.Group();
    g.name = "rental";
    const steel = [], roof = [], glassG = [], dark = [], lit = [];
    const cols = [];
    for (let x = -W / 2 + 1; x <= W / 2 - 0.99; x += (W - 2) / 4) {
      steel.push(put(new THREE.CylinderGeometry(0.16, 0.18, 4.4, 10), x, 2.2, -D / 2 + 1));
      cols.push([x, -D / 2 + 1, 0.4, 0.4, 0, 0, 4.4]);
    }
    // a cantilevered canopy from the back row of columns
    roof.push(put(boxM(W, 0.35, D, 1), 0, 4.6, 0));
    dark.push(put(new THREE.BoxGeometry(W + 0.2, 0.6, 0.2), 0, 4.5, D / 2));
    for (let x = -W / 2 + 2; x < W / 2; x += 4) lit.push(put(new THREE.BoxGeometry(1.2, 0.04, 0.3), x, 4.41, 0));
    // kiosk
    dark.push(put(boxM(3, 2.8, 2.4, 1), W / 2 - 2, 1.4, -D / 2 + 2));
    glassG.push(put(new THREE.BoxGeometry(2.6, 1.2, 0.05), W / 2 - 2, 1.8, -D / 2 + 3.22));
    cols.push([W / 2 - 2, -D / 2 + 2, 3, 2.4, 0, 0, 2.8]);
    addMerged(g, steel, P.steelMat(0x8e969d), { cast: true });
    addMerged(g, roof, P.cladMat(0xdfe2e4), { cast: true });
    addMerged(g, dark, cmat(0x2f353b), { cast: true });
    addMerged(g, glassG, P.glassMat(0.4), { cast: false, receive: false });
    addMerged(g, lit, lamp(0xfff0d8, 0.15, 1.2, root), {});
    return { group: g, cols: cols };
  };

  /* ASR RADAR: a 20 m square lattice tower with a railed platform and an
     equipment shelter at its foot, carrying the rotating antenna (a curved
     reflector with its feed horn) at 15 rpm. */
  P.asr = function (o, root) {
    const Ht = o.h || 20;
    const g = new THREE.Group();
    g.name = "asr-radar";
    const steel = [], dark = [], white = [];
    const b0 = 3.2, b1 = 1.6;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) steel.push(member(sx * b0, 0, sz * b0, sx * b1, Ht, sz * b1, 0.14));
    for (let y = 0; y < Ht; y += 3.3) {
      const t0 = y / Ht, t1 = Math.min(1, (y + 3.3) / Ht);
      const a = b0 + (b1 - b0) * t0, b = b0 + (b1 - b0) * t1;
      for (let k = 0; k < 4; k++) {
        const c = [[1, 1], [1, -1], [-1, -1], [-1, 1]][k], d = [[1, 1], [1, -1], [-1, -1], [-1, 1]][(k + 1) % 4];
        steel.push(member(c[0] * a, y, c[1] * a, d[0] * a, y, d[1] * a, 0.08));
        steel.push(member(c[0] * a, y, c[1] * a, d[0] * b, Math.min(Ht, y + 3.3), d[1] * b, 0.05));
      }
    }
    dark.push(put(boxM(4.4, 0.25, 4.4, 1), 0, Ht, 0));
    for (let k = 0; k < 4; k++) {
      const c = [[1, 1], [1, -1], [-1, -1], [-1, 1]][k], d = [[1, 1], [1, -1], [-1, -1], [-1, 1]][(k + 1) % 4];
      steel.push(member(c[0] * 2.2, Ht + 1.1, c[1] * 2.2, d[0] * 2.2, Ht + 1.1, d[1] * 2.2, 0.05));
      steel.push(put(new THREE.BoxGeometry(0.05, 1.1, 0.05), c[0] * 2.2, Ht + 0.55, c[1] * 2.2));
    }
    white.push(put(boxM(4, 2.8, 3, 1), 4.5, 1.4, 0));
    dark.push(put(new THREE.CylinderGeometry(0.5, 0.6, 1.2, 12), 0, Ht + 0.7, 0));   // the pedestal / rotary joint
    addMerged(g, steel, P.steelMat(0xc9cdd0), { cast: true });
    addMerged(g, dark, cmat(0x3a3f45), { cast: true });
    addMerged(g, white, P.plasterMat(0xe8e6e0), { cast: true });
    // the antenna (its own mesh: it turns)
    const ant = new THREE.Group();
    ant.position.set(0, Ht + 1.3, 0);
    const refl = [];
    {
      // a doubly curved reflector: 5.8 m wide, 2.2 m tall, a section of a cylinder bent back
      const q = new THREE.PlaneGeometry(5.8, 2.2, 16, 6);
      const p = q.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i);
        p.setZ(i, -(x * x) / 14 - (y * y) / 6);
        p.setY(i, y + 1.1);
      }
      q.computeVertexNormals();
      refl.push(q);
      refl.push(member(0, 0, 0, 0, 1.1, 1.8, 0.1));             // feed horn arm
      refl.push(put(new THREE.BoxGeometry(0.5, 0.4, 0.4), 0, 1.15, 1.9));
      refl.push(member(-2.5, 0, -0.4, 2.5, 0, -0.4, 0.12));     // back truss
    }
    addMerged(ant, refl, new THREE.MeshLambertMaterial({ color: 0xdfe3e6, side: THREE.DoubleSide }), { cast: true });
    ant.children.forEach(function (c) { c.matrixAutoUpdate = true; });
    ant.userData.dynamic = true;
    g.add(ant);
    P.animate(root || g, function (dt) { ant.rotation.y += dt * Math.PI / 2; });   // 15 rpm
    return { group: g, cols: [[0, 0, b0 * 2, b0 * 2, 0, 0, Ht], [4.5, 0, 4, 3, 0, 0, 2.8]] };
  };

  /* RADOME: a geodesic dome (icosahedral panels, visible seams) on a
     concrete drum tower — a weather radar. */
  P.radome = function (o, root) {
    const Ht = o.h || 16, R = o.r || 4.5;
    const g = new THREE.Group();
    g.name = "radome";
    const conc = [], dome = [], dark = [];
    conc.push(put(new THREE.CylinderGeometry(2.6, 3.0, Ht, 16), 0, Ht / 2, 0));
    dark.push(put(new THREE.CylinderGeometry(R * 0.9, 2.6, 1.0, 16), 0, Ht + 0.5, 0));
    let ico = new THREE.IcosahedronGeometry(R, 2);
    if (ico.index) ico = ico.toNonIndexed();
    // keep the upper 3/4 of the sphere: flatten anything below the equator band
    const p = ico.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < -R * 0.45) p.setY(i, -R * 0.45);
    ico.computeVertexNormals();        // non-indexed: every panel keeps its own flat normal
    dome.push(put(ico, 0, Ht + 1.0 + R * 0.45, 0));
    for (let y = 3; y < Ht; y += 3) dark.push(put(new THREE.CylinderGeometry(2.62 + 0.4 * (1 - y / Ht), 2.62 + 0.4 * (1 - y / Ht), 0.06, 16, 1, true), 0, y, 0));
    dark.push(put(new THREE.BoxGeometry(0.9, 2.1, 0.1), 0, 1.05, 2.95));
    addMerged(g, conc, P.concreteMat(0xd0ccc3), { cast: true });
    addMerged(g, dark, cmat(0x3a3f45), { cast: true });
    // faceted: the panels read because the icosahedron is flat-shaded
    const dm = new THREE.MeshLambertMaterial({ color: 0xf1f1ee });
    addMerged(g, dome, dm, { cast: true });
    const ob = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lamp(0xff3a2a, 0.25, 1.6, root));
    ob.position.set(0, Ht + 1.0 + R * 1.45 + 0.1, 0);
    g.add(ob);
    return { group: g, cols: [[0, 0, 6, 6, 0, 0, Ht + R * 1.9]] };
  };

  /* ILS LOCALIZER: a row of log-periodic dipole antennas on a ground frame,
     square to the runway, beyond its stop end; an equipment shelter off to
     one side. Local +z = toward the runway. */
  P.localizer = function (o) {
    const Wd = o.w || 36, n = o.n || 16;
    const g = new THREE.Group();
    g.name = "ils-localizer";
    const steel = [], dark = [], white = [];
    steel.push(put(new THREE.BoxGeometry(Wd, 0.15, 0.15), 0, 2.0, 0));
    steel.push(put(new THREE.BoxGeometry(Wd, 0.1, 0.1), 0, 0.6, 0));
    for (let i = 0; i < n; i++) {
      const x = -Wd / 2 + (i + 0.5) * Wd / n;
      steel.push(put(new THREE.BoxGeometry(0.1, 2.6, 0.1), x, 1.3, 0));
      // the dipole boom and its elements, shortest at the front
      steel.push(put(new THREE.BoxGeometry(0.05, 0.05, 1.8), x, 2.4, 0.9));
      for (let k = 0; k < 6; k++) {
        const L = 1.4 - k * 0.18;
        white.push(put(new THREE.BoxGeometry(0.03, L, 0.03), x, 2.4, 0.2 + k * 0.3));
      }
    }
    for (const sg of [-1, 1]) dark.push(put(boxM(Wd * 0.02 + 0.6, 0.3, 1.2, 1), sg * Wd / 2, 0.15, 0));
    // monitor antennas out front and the shelter
    for (const sg of [-1, 1]) steel.push(put(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6), sg * 4, 1.25, 60));
    white.push(put(boxM(3.2, 2.7, 2.4, 1), Wd / 2 + 9, 1.35, -3));
    addMerged(g, steel, P.steelMat(0xc3c8cc), { cast: true });
    addMerged(g, dark, P.concreteMat(0xb9b5ad), {});
    addMerged(g, white, P.plasterMat(0xeae8e2), { cast: true });
    return { group: g, cols: [[Wd / 2 + 9, -3, 3.2, 2.4, 0, 0, 2.7]] };
  };
  /* ILS GLIDESLOPE: a 16 m mast with three antennas stacked on its
     runway face, a lattice back, and the equipment shelter. */
  P.glideslope = function () {
    const g = new THREE.Group();
    g.name = "ils-glideslope";
    const steel = [], white = [];
    const Hm = 16;
    for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) steel.push(put(new THREE.BoxGeometry(0.08, Hm, 0.08), sx, Hm / 2, sz));
    for (let y = 1; y < Hm; y += 1.6) {
      steel.push(member(-0.5, y, 0.5, 0.5, y + 1.6, 0.5, 0.04));
      steel.push(member(-0.5, y, -0.5, -0.5, y + 1.6, 0.5, 0.04));
    }
    for (const y of [4.5, 9.0, 13.5]) white.push(put(boxM(1.3, 0.9, 0.5, 1), 0, y, 0.9));
    white.push(put(boxM(3.2, 2.7, 2.4, 1), 4, 1.35, 0));
    addMerged(g, steel, P.steelMat(0xc3c8cc), { cast: true });
    addMerged(g, white, P.plasterMat(0xeae8e2), { cast: true });
    const ob = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lamp(0xff3a2a, 0.25, 1.6, g));
    ob.position.set(0, Hm + 0.15, 0);
    g.add(ob);
    return { group: g, cols: [[0, 0, 1.2, 1.2, 0, 0, Hm], [4, 0, 3.2, 2.4, 0, 0, 2.7]] };
  };

  /* WINDSOCK: a lighted, hinged mast; the fabric sock (orange / white
     bands) hangs from a swivel ring and droops in light air. */
  let _sockTex = null;
  P.windsock = function (parent, x, z, yaw, root) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw || 0;
    const steel = [], lit = [];
    steel.push(put(new THREE.CylinderGeometry(0.07, 0.1, 6.0, 8), 0, 3.0, 0));
    steel.push(put(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 10), 0, 0.06, 0));
    steel.push(put(new THREE.BoxGeometry(0.4, 0.3, 0.2), 0, 2.4, 0));             // the tilt hinge
    steel.push(put(new THREE.TorusGeometry(0.42, 0.025, 5, 16), 0.1, 5.9, 0, Math.PI / 2));
    steel.push(member(0, 5.9, 0, 0.1, 5.9, 0, 0.04));
    // four floodlights on arms at the top, pointing at the sock
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      steel.push(member(0, 5.3, 0, Math.cos(a) * 0.5, 5.3, Math.sin(a) * 0.5, 0.03));
      lit.push(put(new THREE.BoxGeometry(0.14, 0.1, 0.14), Math.cos(a) * 0.5, 5.36, Math.sin(a) * 0.5));
    }
    addMerged(g, steel, cmat(0xdcdfe2), { cast: true });
    addMerged(g, lit, lamp(0xfff1d2, 0.1, 1.6, root || parent), {});
    if (!_sockTex) {
      const c = document.createElement("canvas");
      c.width = 8; c.height = 64;
      const x2 = c.getContext("2d");
      for (let i = 0; i < 5; i++) { x2.fillStyle = i % 2 ? "#f1efe8" : "#e8631f"; x2.fillRect(0, i * 64 / 5, 8, 64 / 5 + 1); }
      _sockTex = new THREE.CanvasTexture(c);
    }
    const sm = once("windsock", function () { return new THREE.MeshLambertMaterial({ map: _sockTex, side: THREE.DoubleSide }); });
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.18, 3.4, 12, 1, true), sm);
    sock.rotation.z = Math.PI / 2 - 0.22;
    sock.position.set(0.1 + 1.66, 5.9 - 0.37, 0);
    sock.castShadow = true;
    g.add(sock);
    parent.add(g);
    return g;
  };

  /* CHAIN-LINK FENCE. runs: [x0, z0, x1, z1]; opts.center is the secure
     side, so the barbed-wire outriggers lean AWAY from it. */
  let _chainTex = null;
  function chainTex() {
    if (_chainTex) return _chainTex;
    _chainTex = canvasTex(128, 128, function (x) {
      x.clearRect(0, 0, 128, 128);
      x.strokeStyle = "rgba(255,255,255,1)"; x.lineWidth = 2.2;
      const n = 8, s = 128 / n;
      for (let i = -n; i <= n * 2; i++) {
        x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s + 128, 128); x.stroke();
        x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s - 128, 128); x.stroke();
      }
    });
    return _chainTex;
  }
  P.fence = function (parent, runs, opts) {
    opts = opts || {};
    const H = opts.height || 2.4, STEP = opts.step || 3.0, TILE = 0.5;
    const cx = opts.center ? opts.center.x : 0, cz = opts.center ? opts.center.z : 0;
    const postG = mergeGeos([
      put(new THREE.CylinderGeometry(0.03, 0.03, H, 6, 1, true), 0, H / 2, 0),
      put(new THREE.CylinderGeometry(0.036, 0.036, 0.05, 6), 0, H + 0.02, 0),
      member(0, H - 0.02, 0, 0, H + 0.42, 0.40, 0.035, 0.035),
    ]);
    const posts = [], wire = [], fabric = [];
    for (const r of runs) {
      const x0 = r[0], z0 = r[1], x1 = r[2], z1 = r[3];
      const L = Math.hypot(x1 - x0, z1 - z0);
      if (L < 0.5) continue;
      const ux = (x1 - x0) / L, uz = (z1 - z0) / L;
      let nx = -uz, nz = ux;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
      const yaw = Math.atan2(nx, nz);
      const n = Math.max(1, Math.round(L / STEP));
      for (let i = 0; i <= n; i++) posts.push([x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n, "w", 0, yaw]);
      wire.push(tube(x0, H - 0.05, z0, x1, H - 0.05, z1, 0.021, 5));
      wire.push(tube(x0, 0.06, z0, x1, 0.06, z1, 0.006, 3));
      for (let s = 1; s <= 3; s++) {
        const o = 0.12 * s, y = H - 0.02 + o * 1.05;
        wire.push(tube(x0 + nx * o, y, z0 + nz * o, x1 + nx * o, y, z1 + nz * o, 0.005, 3));
      }
      const pg = new THREE.PlaneGeometry(L, H - 0.1);
      uvScale(pg, L / TILE, (H - 0.1) / TILE);
      pg.rotateY(-Math.atan2(z1 - z0, x1 - x0));
      pg.translate(mx, (H - 0.1) / 2 + 0.05, mz);
      fabric.push(pg);
    }
    const grp = new THREE.Group();
    grp.name = "airfield-fence";
    if (posts.length && postG) grp.add(instanceAt(postG, P.steelMat(0xa7adb2), posts, 0));
    addMerged(grp, wire, cmat(0x8e9499), { cast: false });
    const fm = once("chainlink", function () {
      return new THREE.MeshLambertMaterial({ color: 0xb9c0c5, map: chainTex(), transparent: true, alphaTest: 0.03, depthWrite: false, side: THREE.DoubleSide });
    });
    addMerged(grp, fabric, fm, { cast: false, receive: false, name: "chain-link" });
    parent.add(grp);
    return grp;
  };

  /* TRAFFIC CONES + WHEEL CHOCKS: instanced. */
  P.cones = function (parent, pts) {
    if (!pts.length) return null;
    const body = new THREE.CylinderGeometry(0.035, 0.16, 0.7, 10, 1, true);
    body.translate(0, 0.37, 0);
    const base = new THREE.BoxGeometry(0.38, 0.03, 0.38);
    base.translate(0, 0.015, 0);
    const bands = mergeGeos([
      put(new THREE.CylinderGeometry(0.078, 0.101, 0.1, 10, 1, true), 0, 0.5, 0),
      put(new THREE.CylinderGeometry(0.118, 0.138, 0.08, 10, 1, true), 0, 0.27, 0),
    ]);
    const list = pts.map(function (p) { return [p[0], p[1], "w", 0.05, 0]; });
    const out = [];
    for (const spec of [[body, 0xf0561c], [base, 0x1d1f22], [bands, 0xeef0f2]]) {
      if (!spec[0]) continue;
      const im = instanceAt(spec[0], cmat(spec[1]), list, 0.05);
      parent.add(im); out.push(im);
    }
    return out;
  };
  P.chocks = function (parent, pts) {
    if (!pts.length) return null;
    const g0 = prism([[-0.25, 0], [0.25, 0], [0.12, 0.2], [-0.12, 0.2]], 0.5);
    g0.translate(0, 0, -0.25);
    const im = instanceAt(g0, cmat(0xe0b020), pts.map(function (p) { return [p[0], p[1], "w", 0.03, p[2] || 0]; }), 0.03);
    parent.add(im);
    return im;
  };
  /* GROUND POWER UNIT: a towable 90 kVA set with its cable reel. */
  P.gpus = function (parent, pts) {
    if (!pts.length) return null;
    const geo = mergeGeos([
      put(boxM(2.4, 1.3, 1.4, 1), 0, 1.05, 0),
      put(new THREE.BoxGeometry(2.5, 0.12, 1.5), 0, 1.76, 0),
      put(new THREE.BoxGeometry(1.2, 0.08, 0.1), 1.8, 0.45, 0),
    ]);
    const wg = [];
    for (const wx of [-0.8, 0.8]) for (const wz of [-0.72, 0.72]) wg.push(put(new THREE.CylinderGeometry(0.28, 0.28, 0.18, 10), wx, 0.28, wz, 0, Math.PI / 2));
    const list = pts.map(function (p) { return [p[0], p[1], "w", 0, p[2] || 0]; });
    parent.add(instanceAt(geo, cmat(0xe7e9eb), list, 0));
    parent.add(instanceAt(mergeGeos(wg), cmat(0x17191c), list, 0));
    return true;
  };

  /* ==============================================================
     THE TERMINAL — a building you walk through, drawn to a real one.

     Section, landside (+z) to airside (-z):
       kerb canopy  the roof runs on over the drop-off lane
       doors        automatic sliding glass door-sets in a full-height
                    curtain wall (1.5 m mullions, transoms every 3.3 m)
       check-in     islands square to the facade: a bag belt down the
                    middle, a bulkhead with the lit position board, a
                    run of desks each side, queue lanes in stanchions
       security     screening lanes (X-ray tunnel + walk-through arch)
                    in a glazed line you pass through
       gates        TWO LEVELS: a stair (and the escalator bank) to the
                    gate floor, lounges at every bridge, the bridge
                    doors in the airside glazing; arrivals and baggage
                    reclaim underneath. ONE LEVEL: the lounge on the
                    ground floor with doors out to the apron.
     The roof is a long-span curved deck on steel tree columns, the
     soffit a lit ceiling. All in the field's local metres.
     ============================================================== */
  // the pure plan (numbers only): the node check and ticketing both read it
  P.terminalPlan = function (T) {
    const x0 = T.x0, x1 = T.x1, z0 = T.z0, z1 = T.z1, D = z1 - z0, W = x1 - x0;
    const two = T.levels === 2;
    const mezzY = two ? (T.mezzY || 4.5) : 0;
    const zm = two ? z0 + Math.min(D * 0.45, T.mezzD || 22) : z0;    // the gate floor's landside edge
    // check-in islands: square to the landside facade, 3.4 m wide, in the hall
    const hall0 = two ? zm + 5 : z0 + D * 0.42, hall1 = z1 - 6;
    const islSpan = two ? W : W - 24;              // one level: the east end is reclaim
    const isl = [];
    const nIsl = Math.max(1, Math.min(T.islands || 4, Math.floor((W - 30) / 20)));
    const islL = Math.max(8, Math.min(24, hall1 - hall0 - 2));
    for (let i = 0; i < nIsl; i++) {
      const x = x0 + islSpan * (i + 1) / (nIsl + 1) + (T.islandShift || 0);
      isl.push({ x: x, z0: hall1 - islL, z1: hall1, positions: Math.floor(islL / 2.0) });
    }
    // the ticket desk the airline sells from: island 0, the first position
    // on its west face, the passenger standing in front of it
    const d0 = isl[0];
    const desk = { lx: d0.x - 1.7 - 1.6, lz: d0.z1 - 1.6, face: Math.PI / 2 };
    // security: a glazed line across the building between landside and the
    // gates — on the gate floor just past the stair head (two levels), or on
    // the ground floor in front of the lounge (one level)
    const secZ = two ? zm - 3.5 : hall0 - 3;
    const secY = two ? mezzY + 0.06 : 0;
    const secLanes = [];
    const nLanes = Math.max(2, Math.min(5, Math.floor(W / 40) + 2));
    const secX = T.securityX != null ? T.securityX : x0 + islSpan / 2;
    for (let i = 0; i < nLanes; i++) secLanes.push(secX + (i - (nLanes - 1) / 2) * 4.2);
    // the stair to the gate floor (two levels): climbs toward airside, lands on the gate floor edge
    const stair = two ? { x: T.stairX != null ? T.stairX : x0 + W * 0.5, w: 3.2, going: 0.3, rise: mezzY / Math.ceil(mezzY / 0.3), n: Math.ceil(mezzY / 0.3), zTop: zm } : null;
    // reclaim: under the gate floor (two levels) or at the east end
    const reclaim = two ? { x: x0 + W * 0.25, z: z0 + (zm - z0) * 0.3, l: 16, w: 5 } : { x: x1 - 12, z: (hall0 + hall1) / 2, l: 12, w: 4 };
    const loungeZ1 = secZ - 4.5;
    return { x0: x0, x1: x1, z0: z0, z1: z1, W: W, D: D, two: two, mezzY: mezzY, zm: zm, hall0: hall0, hall1: hall1, islands: isl, desk: desk, secZ: secZ, secY: secY, secLanes: secLanes, stair: stair, reclaim: reclaim, loungeZ1: loungeZ1 };
  };

  let _fidsTex = null;
  function fidsTex() {
    if (_fidsTex) return _fidsTex;
    _fidsTex = canvasTex(256, 128, function (x, W, H) {
      x.fillStyle = "#06121f"; x.fillRect(0, 0, W, H);
      for (let r = 0; r < 12; r++) {
        const y = 6 + r * 10;
        x.fillStyle = r % 2 ? "#0b1b2e" : "#081626"; x.fillRect(0, y - 1, W, 10);
        // time, destination, gate, status as blocks of glyph-width marks
        const cols = [[4, 22, "#f5d24a"], [32, 90, "#e8eef4"], [132, 18, "#e8eef4"], [160, 60, r % 5 === 2 ? "#6be38c" : "#e8eef4"]];
        for (const c of cols) {
          x.fillStyle = c[2];
          const n = Math.floor(c[1] / 6);
          for (let k = 0; k < n; k++) if (hash01(r, k + c[0], 881) > 0.18) x.fillRect(c[0] + k * 6, y + 1, 4, 6);
        }
      }
    }, true);
    return _fidsTex;
  }

  /* build the terminal into F. ctx: { F, root, solid(lx,lz,w,d,y0,y1),
     plat(lx,lz,w,d,top), door(lx,lz,w,nx,nz), seat(lx,y,lz,face,cushion),
     post(spec), name } */
  P.terminal = function (T, ctx) {
    const pl = P.terminalPlan(T);
    const F = ctx.F, root = ctx.root;
    const x0 = pl.x0, x1 = pl.x1, z0 = pl.z0, z1 = pl.z1, W = pl.W, D = pl.D, cx = (x0 + x1) / 2;
    const two = pl.two, MY = pl.mezzY, zm = pl.zm;
    const Ye = T.eave || (two ? 12.5 : 9.5), RISE = T.rise || (two ? 4.0 : 3.0), RT = 0.9;
    const rz0 = z0 - (T.airOver || 5), rz1 = z1 + (T.canopy || 9);
    const yTop = function (z) { const t = Math.max(0, Math.min(1, (z - rz0) / (rz1 - rz0))); return Ye + RISE * Math.sin(Math.PI * t); };
    const ySof = function (z) { return yTop(z) - RT; };
    const G = new THREE.Group();
    G.name = "terminal";
    F.add(G);
    const floorG = [], frame = [], glassG = [], clad = [], roofTop = [], soffit = [], dark = [], steel = [], lit = [], wood = [], white = [], belt = [], fidsG = [], signG = [];
    // ---- floor(s)
    floorG.push(put(boxM(W, 0.08, D, 2), cx, 0.04, (z0 + z1) / 2));
    if (two) {
      floorG.push(put(boxM(W - 0.6, 0.08, zm - z0 - 0.3, 2), cx, MY + 0.02, (z0 + zm) / 2 - 0.15));
      clad.push(put(boxM(W - 0.6, 0.4, zm - z0 - 0.3, 1), cx, MY - 0.24, (z0 + zm) / 2 - 0.15));
      // the slab edge: a steel fascia and a glass balustrade (gap at the stair head)
      const st = pl.stair;
      const gapA = st.x - st.w / 2 - 0.2, gapB = st.x + st.w / 2 + 0.2;
      white.push(put(new THREE.BoxGeometry(W - 0.6, 0.45, 0.12), cx, MY - 0.2, zm - 0.3));
      for (const seg of [[x0 + 0.3, gapA], [gapB, x1 - 0.3]]) {
        if (seg[1] - seg[0] < 0.2) continue;
        glassG.push(put(new THREE.BoxGeometry(seg[1] - seg[0], 1.05, 0.03), (seg[0] + seg[1]) / 2, MY + 0.55, zm - 0.3));
        steel.push(put(new THREE.BoxGeometry(seg[1] - seg[0], 0.06, 0.08), (seg[0] + seg[1]) / 2, MY + 1.1, zm - 0.3));
        ctx.solid((seg[0] + seg[1]) / 2, zm - 0.3, seg[1] - seg[0], 0.25, MY - 0.1, MY + 1.15);
      }
      ctx.plat(cx, (z0 + zm) / 2 - 0.15, W - 0.6, zm - z0 - 0.3, MY + 0.06);
      // soffit lights under the gate floor
      for (let x = x0 + 4; x < x1 - 2; x += 6) for (let z = z0 + 3; z < zm - 1; z += 6) lit.push(put(new THREE.BoxGeometry(1.0, 0.04, 1.0), x, MY - 0.46, z));
      // columns carrying the gate floor
      for (let x = x0 + 9; x < x1 - 4; x += 18) for (const z of [z0 + (zm - z0) * 0.5]) {
        steel.push(put(new THREE.CylinderGeometry(0.3, 0.3, MY - 0.44, 14), x, (MY - 0.44) / 2, z));
        ctx.solid(x, z, 0.6, 0.6, 0, MY - 0.4);
      }
    }
    // ---- the roof: a long-span curved deck, landside canopy, airside overhang
    {
      const RW = W + 6, rcx = cx;
      function vault(up) {
        const g = new THREE.PlaneGeometry(RW, rz1 - rz0, 1, 30);
        g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
        g.translate(rcx, 0, (rz0 + rz1) / 2);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) p.setY(i, up ? yTop(p.getZ(i)) : ySof(p.getZ(i)));
        uvScale(g, RW, rz1 - rz0);
        g.computeVertexNormals();
        return g;
      }
      roofTop.push(vault(true));
      soffit.push(vault(false));
      for (const z of [rz0, rz1]) dark.push(put(new THREE.BoxGeometry(RW + 0.2, RT + 0.2, 0.3), rcx, yTop(z) - RT / 2, z));
      for (const sg of [-1, 1]) {
        const g = new THREE.PlaneGeometry(rz1 - rz0, 1, 30, 1);
        g.rotateY(sg * Math.PI / 2);
        g.translate(rcx + sg * RW / 2, 0, (rz0 + rz1) / 2);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) > 0 ? yTop(p.getZ(i)) + 0.05 : ySof(p.getZ(i)) - 0.1);
        g.computeVertexNormals();
        dark.push(g);
      }
      // downlights on a 4.5 m grid across the whole soffit
      for (let x = x0 - 1; x < x1 + 2; x += 4.5) for (let z = rz0 + 1.5; z < rz1 - 0.5; z += 4.5) {
        lit.push(put(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 10), x, ySof(z) - 0.03, z));
      }
      // rooflights: a strip of glazing along the crown
      const crown = (rz0 + rz1) / 2;
      glassG.push(put(new THREE.BoxGeometry(W - 8, 0.06, 3.0), cx, yTop(crown) + 0.04, crown));
      // roof plant (set back, screened)
      steel.push(put(boxM(10, 1.8, 5, 1), cx - W * 0.28, yTop(crown - 6) + 0.9, crown - 6));
      steel.push(put(boxM(7, 1.4, 4, 1), cx + W * 0.24, yTop(crown - 5) + 0.7, crown - 5));
      // TREE COLUMNS: a trunk to 2/3 height, four raking branches to the deck
      const rows = two ? [zm + (z1 - zm) * 0.5] : [z0 + D * 0.5];
      for (let x = x0 + 12; x < x1 - 6; x += 24) for (const z of rows) {
        const yt = ySof(z) * 0.6;
        steel.push(put(new THREE.CylinderGeometry(0.34, 0.42, yt, 16), x, yt / 2, z));
        for (const bx of [-1, 1]) for (const bz of [-1, 1]) {
          const ex = x + bx * 4.5, ez = z + bz * 4.5;
          steel.push(tube(x, yt - 0.2, z, ex, ySof(ez) - 0.1, ez, 0.16, 8));
        }
        ctx.solid(x, z, 0.9, 0.9, 0, yt);
      }
      // the canopy's own columns at the kerb edge
      for (let x = x0 + 6; x < x1 - 2; x += 18) {
        const zc = rz1 - 1.2;
        steel.push(put(new THREE.CylinderGeometry(0.22, 0.26, ySof(zc), 12), x, ySof(zc) / 2, zc));
        ctx.solid(x, zc, 0.5, 0.5, 0, ySof(zc));
      }
    }
    // ---- facades
    const BAY = 1.5;
    function curtain(z, out, gaps, yTopFn, yBase) {
      // gaps: [[xa, xb, y0, y1]] openings (door-sets) in this face
      const n = Math.round((W - 1.2) / BAY);
      for (let i = 0; i <= n; i++) {
        const x = x0 + 0.6 + i * ((W - 1.2) / n);
        const yt = yTopFn(z);
        let inGap = false;
        for (const g of gaps) if (x > g[0] + 0.05 && x < g[1] - 0.05 && g[2] <= yBase + 0.01) inGap = true;
        const y0 = inGap ? gaps.find(function (g) { return x > g[0] && x < g[1]; })[3] : yBase;
        frame.push(put(new THREE.BoxGeometry(0.09, yt - y0, 0.22), x, (yt + y0) / 2, z + out * 0.06));
      }
      for (let y = yBase + 3.3; y < yTopFn(z) - 0.5; y += 3.3) frame.push(put(new THREE.BoxGeometry(W - 1.2, 0.1, 0.2), cx, y, z + out * 0.06));
      // glass panes between the gaps
      const xs = [x0 + 0.6];
      const gs = gaps.filter(function (g) { return g[2] <= yBase + 0.01; }).sort(function (a, b) { return a[0] - b[0]; });
      for (const g of gs) { xs.push(g[0], g[1]); }
      xs.push(x1 - 0.6);
      const yt = yTopFn(z);
      for (let i = 0; i < xs.length; i += 2) {
        const a = xs[i], b = xs[i + 1];
        if (b - a > 0.1) glassG.push(put(new THREE.BoxGeometry(b - a, yt - yBase - 0.2, 0.03), (a + b) / 2, yBase + (yt - yBase) / 2, z));
      }
      for (const g of gs) {
        // transom glass over a door-set
        glassG.push(put(new THREE.BoxGeometry(g[1] - g[0], yt - g[3] - 0.2, 0.03), (g[0] + g[1]) / 2, g[3] + (yt - g[3]) / 2, z));
        dark.push(put(new THREE.BoxGeometry(g[1] - g[0] + 0.3, 0.3, 0.35), (g[0] + g[1]) / 2, g[3] + 0.15, z + out * 0.08));
      }
      frame.push(put(new THREE.BoxGeometry(W - 1.2, 0.14, 0.24), cx, yBase + 0.07, z + out * 0.06));
    }
    // landside: door-sets at T.entrances (x centres), 4 m wide, 2.7 tall
    const ENT = (T.entrances && T.entrances.length) ? T.entrances : [cx - W * 0.3, cx, cx + W * 0.3];
    const DW = 4.0, DH = 2.7;
    const landGaps = ENT.map(function (x) { return [x - DW / 2, x + DW / 2, 0, DH]; });
    curtain(z1, 1, landGaps, ySof, 0);
    // airside: two levels — the ground floor is glazed, the gate floor
    // glazed with the bridge doors; one level — ground doors to the apron
    const GD = T.gateDoors || [];
    const airGround = GD.map(function (x) { return [x - 1.4, x + 1.4, 0, 2.6]; });
    const bridgeGaps = (T.bridges || []).map(function (b) { return [b.doorX - 1.2, b.doorX + 1.2, MY + 0.05, MY + 2.5]; });
    if (two) {
      curtain(z0, -1, airGround, function () { return MY - 0.45; }, 0);
      curtain(z0, -1, bridgeGaps, ySof, MY + 0.05);
      clad.push(put(boxM(W, 0.9, 0.3, 1), cx, MY - 0.2, z0));
    } else {
      curtain(z0, -1, airGround, ySof, 0);
    }
    // gables: precast panels with a vertical glazed strip
    for (const x of [x0, x1]) {
      const n = Math.max(2, Math.round(D / 6));
      for (let i = 0; i < n; i++) {
        const za = z0 + D * i / n, zb = z0 + D * (i + 1) / n;
        const h = ySof((za + zb) / 2);
        clad.push(put(boxM(0.4, h, zb - za - 0.03, 1), x, h / 2, (za + zb) / 2));
      }
      glassG.push(put(new THREE.BoxGeometry(0.05, ySof(z0 + D * 0.5) - 1, 2.0), x + (x === x0 ? -0.22 : 0.22), (ySof(z0 + D * 0.5) - 1) / 2 + 0.5, z0 + D * 0.5));
    }
    // ---- wall colliders (door gaps left open; the doors own their own)
    function wallCols(z, gaps, y0, y1) {
      const xs = [x0];
      const gs = gaps.slice().sort(function (a, b) { return a[0] - b[0]; });
      for (const g of gs) xs.push(g[0], g[1]);
      xs.push(x1);
      for (let i = 0; i < xs.length; i += 2) if (xs[i + 1] - xs[i] > 0.05) ctx.solid((xs[i] + xs[i + 1]) / 2, z, xs[i + 1] - xs[i], 0.4, y0, y1);
      for (const g of gs) if (g[3] < y1) ctx.solid((g[0] + g[1]) / 2, z, g[1] - g[0], 0.4, Math.max(y0, g[3]), y1);
    }
    const hiY = ySof(z1);
    wallCols(z1, landGaps, 0, hiY);
    if (two) {
      wallCols(z0, airGround, 0, MY);
      // gate floor band: openings at the bridge doors
      wallCols(z0, bridgeGaps.map(function (g) { return [g[0], g[1], MY, g[3]]; }), MY, ySof(z0));
    } else {
      wallCols(z0, airGround, 0, ySof(z0));
    }
    for (const x of [x0, x1]) ctx.solid(x, (z0 + z1) / 2, 0.5, D, 0, ySof(z0));
    // ---- the automatic doors
    for (const x of ENT) ctx.door(x, z1, DW, 0, -1);
    for (const x of GD) ctx.door(x, z0, 2.8, 0, 1);

    // ---- CHECK-IN ISLANDS
    const posts = [];
    for (let i = 0; i < pl.islands.length; i++) {
      const s = pl.islands[i], L = s.z1 - s.z0, zc = (s.z0 + s.z1) / 2;
      // the bulkhead down the middle (2.4 m) with a lit board on both faces at its head
      clad.push(put(boxM(0.5, 2.4, L, 1), s.x, 1.2, zc));
      belt.push(put(new THREE.BoxGeometry(0.9, 0.5, L), s.x, 0.25, zc));       // collector belt under the bulkhead edge
      for (const sg of [-1, 1]) {
        // desks: a run each side, 1.8 m per position, 1.05 m high, stone top
        for (let k = 0; k < s.positions; k++) {
          const z = s.z0 + 1.0 + k * 2.0;
          if (z > s.z1 - 0.8) break;
          wood.push(put(boxM(0.7, 1.02, 1.6, 1), s.x + sg * 1.1, 0.51, z));
          dark.push(put(new THREE.BoxGeometry(0.9, 0.05, 1.7), s.x + sg * 1.15, 1.05, z));
          // bag scale + feed belt between desks
          belt.push(put(new THREE.BoxGeometry(0.9, 0.35, 0.36), s.x + sg * 1.1, 0.18, z + 0.99));
          // monitor facing the agent (inboard), back to the passenger
          dark.push(put(new THREE.BoxGeometry(0.05, 0.3, 0.48), s.x + sg * 0.9, 1.3, z));
          lit.push(put(new THREE.BoxGeometry(0.02, 0.26, 0.44), s.x + sg * 0.87, 1.3, z));
        }
        // queue lanes: stanchion posts with the belt tape (tensa barrier)
        const qx = s.x + sg * 4.0;
        for (let z = s.z0; z <= s.z1 - 1; z += 2.4) steel.push(put(new THREE.CylinderGeometry(0.03, 0.03, 0.95, 6), qx, 0.47, z));
        dark.push(put(new THREE.BoxGeometry(0.02, 0.05, L - 1), qx, 0.9, zc - 0.5));
        ctx.solid(s.x + sg * 1.1, zc, 0.8, L, 0, 1.05);
      }
      ctx.solid(s.x, zc, 1.0, L, 0, 2.4);
      // the lit board at the head of the island, readable from the hall
      fidsG.push(put(new THREE.BoxGeometry(2.6, 1.0, 0.08), s.x, 3.4, s.z0 - 0.3));
      steel.push(put(new THREE.BoxGeometry(0.08, 1.0, 0.08), s.x, 2.4 + 0.5, s.z0 - 0.3));
      // an agent at the first desk on each face of the first two islands
      // (a body is ~16 draws: the hall is staffed, not crowded)
      if (i < 2) for (const sg of [-1, 1]) {
        const z = s.z1 - 1.0;
        posts.push({ lx: s.x + sg * 0.55, lz: z, face: sg > 0 ? Math.PI / 2 : -Math.PI / 2, id: "ck" + i + (sg > 0 ? "e" : "w") });
      }
    }
    // ---- FIDS: two departure boards hung in the hall, a pair at the gates
    {
      const zb = pl.hall0 - 1.0;
      for (const x of [cx - W * 0.2, cx + W * 0.2]) {
        fidsG.push(put(new THREE.BoxGeometry(4.8, 2.4, 0.1), x, 4.8 + (two ? MY * 0.5 : 0), zb));
        for (const sx of [-2, 2]) steel.push(put(new THREE.CylinderGeometry(0.02, 0.02, ySof(zb) - 6, 4), x + sx, (ySof(zb) + 6) / 2 + (two ? MY * 0.5 : 0) - 0.4, zb));
      }
    }
    // ---- SECURITY: a glazed line across the building with the lanes
    {
      const z = pl.secZ, Y = pl.secY;
      const lanes = pl.secLanes;
      const lx0 = lanes[0] - 2.1, lx1 = lanes[lanes.length - 1] + 2.1;
      for (const x of lanes) {
        // X-ray: tunnel on its roller tables, the arch beside it
        dark.push(put(boxM(1.1, 1.35, 2.6, 1), x - 1.0, Y + 0.68, z));
        steel.push(put(new THREE.BoxGeometry(0.7, 0.08, 3.0), x - 1.0, Y + 0.78, z + 2.8));
        steel.push(put(new THREE.BoxGeometry(0.7, 0.08, 2.4), x - 1.0, Y + 0.78, z - 2.6));
        white.push(put(new THREE.BoxGeometry(0.12, 2.2, 0.6), x + 0.35, Y + 1.1, z));
        white.push(put(new THREE.BoxGeometry(0.12, 2.2, 0.6), x + 1.35, Y + 1.1, z));
        white.push(put(new THREE.BoxGeometry(1.12, 0.15, 0.6), x + 0.85, Y + 2.25, z));
        ctx.solid(x - 1.0, z, 1.2, 8.2, Y, Y + 1.4);
      }
      // the glazed line from the lanes to both side walls (you pass through an arch)
      for (const seg of [[x0 + 0.3, lx0], [lx1, x1 - 0.3]]) {
        if (seg[1] - seg[0] < 0.2) continue;
        glassG.push(put(new THREE.BoxGeometry(seg[1] - seg[0], 2.4, 0.04), (seg[0] + seg[1]) / 2, Y + 1.2, z));
        steel.push(put(new THREE.BoxGeometry(seg[1] - seg[0], 0.08, 0.1), (seg[0] + seg[1]) / 2, Y + 2.44, z));
        ctx.solid((seg[0] + seg[1]) / 2, z, seg[1] - seg[0], 0.2, Y, Y + 2.4);
      }
      // between lanes: the X-ray line is solid; leave the arch (x+0.35..x+1.35) open
      for (let i = 0; i < lanes.length; i++) {
        const a = lanes[i] + 1.41, b = i + 1 < lanes.length ? lanes[i + 1] - 1.6 : lx1;
        if (b - a > 0.1) ctx.solid((a + b) / 2, z, b - a, 0.2, Y, Y + 2.4);
      }
    }
    // ---- THE STAIR to the gate floor (two levels): treads are platforms
    if (two) {
      const st = pl.stair;
      for (let k = 0; k < st.n; k++) {
        const y = (k + 1) * st.rise;
        const z = st.zTop + (st.n - k - 0.5) * st.going;
        clad.push(put(boxM(st.w, 0.12, st.going + 0.02, 1), st.x, y - 0.06, z));
        ctx.plat(st.x, z, st.w, st.going + 0.04, y);
      }
      // stringers + glass balustrades each side
      const zA = st.zTop + st.n * st.going, zB = st.zTop;
      for (const sg of [-1, 1]) {
        steel.push(member(st.x + sg * st.w / 2, 0, zA, st.x + sg * st.w / 2, MY, zB, 0.12, 0.35));
        glassG.push(member(st.x + sg * (st.w / 2 + 0.05), 0.55, zA, st.x + sg * (st.w / 2 + 0.05), MY + 0.55, zB, 0.03, 1.0));
        for (let k = 0; k < st.n; k += 2) {
          const z = st.zTop + (st.n - k - 0.5) * st.going, y = (k + 1) * st.rise;
          ctx.solid(st.x + sg * (st.w / 2 + 0.1), z, 0.2, st.going * 2 + 0.05, 0, y + 1.1);
        }
      }
    }
    // ---- GATE LOUNGES: beam seats facing the glass, a podium desk and the
    //      gate's number on a lit board at every gate
    const gates = (T.bridges && T.bridges.length) ? T.bridges.map(function (b) { return { x: b.doorX, num: b.num }; }) : GD.map(function (x, i) { return { x: x, num: (T.gateNums && T.gateNums[i]) || String(i + 1) }; });
    const seatY = two ? MY + 0.06 : 0.06;
    const cush = (CBZ.propSeatHeight ? +CBZ.propSeatHeight("waiting") : 0) || 0.44;
    const seatList = [], backList = [], armList = [], beamList = [];
    const signFaces = [];
    for (const gt of gates) {
      const rowsZ = [];
      const zFirst = z0 + 5.5, zLast = pl.loungeZ1;
      for (let z = zFirst; z <= zLast; z += 2.6) rowsZ.push(z);
      for (const z of rowsZ) for (const bx of [gt.x - 8, gt.x - 3.5, gt.x + 3.5, gt.x + 8]) {
        if (bx < x0 + 3 || bx > x1 - 3) continue;
        if (two && pl.stair && Math.abs(bx - pl.stair.x) < 4) continue;
        beamList.push([bx, z, "w", seatY + 0.16, 0]);
        for (let s = 0; s < 4; s++) {
          const sx = bx + (s - 1.5) * 0.55;
          seatList.push([sx, z, "w", seatY + cush - 0.05, 0]);
          backList.push([sx, z + 0.23, "w", seatY + cush + 0.22, 0]);
          // seats face the apron glass (-z)
          if (ctx.seat) ctx.seat(sx, seatY, z, Math.PI, cush);
        }
        for (let a = 0; a <= 4; a++) armList.push([bx + (a - 2) * 0.55, z - 0.02, "w", seatY + cush + 0.18, 0]);
      }
      // podium desk at the door
      wood.push(put(boxM(2.4, 1.05, 0.8, 1), gt.x + 3.2, seatY + 0.52, z0 + 2.6));
      dark.push(put(new THREE.BoxGeometry(2.5, 0.05, 0.9), gt.x + 3.2, seatY + 1.06, z0 + 2.6));
      ctx.solid(gt.x + 3.2, z0 + 2.6, 2.4, 0.8, seatY, seatY + 1.05);
      posts.push({ lx: gt.x + 3.2, lz: z0 + 3.5, face: Math.PI, y: seatY, id: "gate" + gt.num, job: "gate agent" });
      // the gate number, lit, on a board hung inside the glazing
      signFaces.push({ x: gt.x, y: seatY + 3.3, z: z0 + 1.2, text: gt.num });
    }
    // a board per gate with its number (one small atlas)
    if (signFaces.length) {
      const tex = canvasTex(64 * signFaces.length, 64, function (x, Wc, Hc) {
        for (let i = 0; i < signFaces.length; i++) {
          x.fillStyle = "#12151a"; x.fillRect(i * 64, 0, 64, 64);
          x.fillStyle = "#ffd451"; x.font = "700 44px Arial Narrow, Arial, sans-serif";
          x.textAlign = "center"; x.textBaseline = "middle";
          x.fillText(signFaces[i].text, i * 64 + 32, 34);
        }
      }, true);
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      const gs = [];
      for (let i = 0; i < signFaces.length; i++) {
        const f = signFaces[i];
        for (const side of [1, -1]) {
          const q = new THREE.PlaneGeometry(1.4, 1.4);
          const uv = q.attributes.uv;
          for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / signFaces.length);
          if (side < 0) q.rotateY(Math.PI);
          q.translate(f.x, f.y, f.z + side * 0.06);
          gs.push(q);
        }
        dark.push(put(new THREE.BoxGeometry(1.6, 1.6, 0.1), f.x, f.y, f.z));
        steel.push(put(new THREE.CylinderGeometry(0.015, 0.015, ySof(z0) - f.y - 0.8, 4), f.x, (ySof(z0) + f.y + 0.8) / 2, f.z));
      }
      const sm = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex });
      P.glow(sm, 0.4, 1.0, root);
      addMerged(G, gs, sm, {});
    }
    if (beamList.length) {
      G.add(instanceAt(new THREE.BoxGeometry(2.3, 0.3, 0.14), cmat(0x6b7178), beamList, null));
      G.add(instanceAt(new THREE.BoxGeometry(0.52, 0.1, 0.5), cmat(0x35506e), seatList, null));
      G.add(instanceAt(new THREE.BoxGeometry(0.52, 0.45, 0.08), cmat(0x2a4360), backList, null));
      G.add(instanceAt(new THREE.BoxGeometry(0.06, 0.05, 0.42), cmat(0x8d959d), armList, null));
    }
    // ---- BAGGAGE RECLAIM: a flat-plate carousel (a stadium loop) fed
    //      through the airside wall
    {
      const r = pl.reclaim;
      const R = r.w / 2, straight = r.l - r.w;
      const sh = [];
      for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + Math.PI * i / 16; sh.push([straight / 2 + Math.cos(a) * R, Math.sin(a) * R]); }
      for (let i = 0; i <= 16; i++) { const a = Math.PI / 2 + Math.PI * i / 16; sh.push([-straight / 2 + Math.cos(a) * R, Math.sin(a) * R]); }
      const body = prism(sh.map(function (p) { return [p[0], p[1]]; }), 0.45);
      body.rotateX(Math.PI / 2);
      body.translate(r.x, 0.45, r.z);
      steel.push(body);
      const inner = prism(sh.map(function (p) { return [p[0] * 0.72, p[1] * 0.55]; }), 0.2);
      inner.rotateX(Math.PI / 2);
      inner.translate(r.x, 0.66, r.z);
      belt.push(inner);
      // the feed belt from the wall, rising over the loop
      belt.push(member(r.x - straight / 2, 1.4, z0 + 0.3, r.x - straight / 2, 0.7, r.z - R * 0.3, 1.0, 0.25));
      ctx.solid(r.x, r.z, r.l, r.w, 0, 0.7);
      fidsG.push(put(new THREE.BoxGeometry(1.6, 0.9, 0.08), r.x + straight / 2 + R + 1.2, 2.6, r.z));
    }
    // ---- the building's name on the landside fascia
    if (T.name) {
      const txt = String(T.name);
      const tex = canvasTex(1024, 96, function (x, Wc, Hc) {
        x.clearRect(0, 0, Wc, Hc);
        x.fillStyle = "#f4f6f8"; x.font = "700 70px Arial, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
        x.fillText(txt, Wc / 2, Hc / 2 + 4);
      }, true);
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      const q = new THREE.PlaneGeometry(Math.min(W * 0.5, txt.length * 1.6), Math.min(W * 0.5, txt.length * 1.6) * 96 / 1024);
      q.translate(cx, yTop(rz1) - RT / 2, rz1 + 0.17);
      const m = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.2, emissive: 0xffffff, emissiveMap: tex });
      P.glow(m, 0.2, 0.9, root);
      addMerged(G, [q], m, {});
    }
    addMerged(G, floorG, P.terrazzoMat(), {});
    addMerged(G, frame, cmat(0x3a414a), { cast: true });
    addMerged(G, glassG, P.glassMat(0.36), { cast: false, receive: false });
    addMerged(G, clad, P.plasterMat(0xe2ded6), { cast: true });
    addMerged(G, roofTop, P.steelMat(0xc4c9cd), { cast: true });
    addMerged(G, soffit, P.woodMat(0xc9b08c), {});
    addMerged(G, dark, cmat(0x2b3037), { cast: true });
    addMerged(G, steel, P.steelMat(0xdadddf), { cast: true });
    addMerged(G, white, P.steelMat(0xeef0f1), { cast: true });
    addMerged(G, wood, P.woodMat(0xa68461), { cast: true });
    addMerged(G, belt, cmat(0x1e2124), {});
    addMerged(G, lit, lamp(0xfff4dc, 0.35, 1.25, root), {});
    if (fidsG.length) {
      const fm = new THREE.MeshLambertMaterial({ map: fidsTex(), emissive: 0xffffff, emissiveMap: fidsTex(), emissiveIntensity: 0.9 });
      addMerged(G, fidsG, fm, {});
    }
    return { group: G, plan: pl, posts: posts, eave: Ye, yTop: yTop, ySof: ySof };
  };

  /* ==============================================================
     BUILD AN AIRFIELD. `spec` is the airports.js registration spec plus
     the field's drawing: everything in LOCAL metres (origin = runway
     midpoint, +X down the runway, +Z the apron side).

       runway {len, w, tdz}      taxiZ, taxiX0, taxiX1, conns: [lx]
       terminal {x0,x1,z0,z1,levels,mezzY,entrances,gateDoors,name,canopy}
       stands [{id, num, lx, bridge}]   (all nose-in, standZ derived)
       aprons [{x0,z0,x1,z1}]  paved [...]   kerbZ
       tower {lx, lz, H} | {external: true}
       fence {runs: [[x0,z0,x1,z1]], center: {x,z}}
       parked: [stand ids]  jets: [{lx, lz, heading}]
       dressing { hangars, sheds, fuel, fire, carpark, rental, asr, radome,
                  ils, approach, masts, windsocks, ulds }
       bounds (world AABB, optional)  extent {x0,x1,z0,z1} (local)
       noSpawn [...] (world rects, optional), road {x, z} (a link out)
       paint(PA, L) extra local paint
     ============================================================== */
  const AL = function () { return (CBZ.airportKit && CBZ.airportKit.scale) || (+CBZ.CONFIG.AIRLINER_SCALE || 1.45); };
  const DIM = function () {
    const d = (CBZ.airportKit && CBZ.airportKit.dims && CBZ.airportKit.dims.airliner) || { length: 37.57, span: 35.8, height: 11.76, fuselage: 3.95 };
    const s = AL();
    return { length: d.length * s, span: d.span * s, fuselage: d.fuselage * s, noseTip: 18.1 * s, tail: 19.5 * s, noseGear: 10 * s, doorX: 10.5 * s, sill: 2.5 * s };
  };
  P.aircraftEnvelope = DIM;

  // where a nose-in stand puts things, from the terminal face (local z)
  P.standPlan = function (termZ0, taxiZ) {
    const E = DIM();
    const standZ = termZ0 - 11 - E.noseTip;            // 11 m from the nose to the glass
    return {
      standZ: standZ, noseTipZ: standZ + E.noseTip, tailZ: standZ - E.tail,
      stopZ: standZ + E.noseGear,
      tailClear: (standZ - E.tail) - (taxiZ + E.span / 2),     // parked tail to a taxiing wingtip
      doorZ: standZ + E.doorX, doorLat: E.fuselage / 2,
    };
  };

  const pending = [];              // fields waiting for their dressing pass this world

  CBZ.buildAirfield = function (city, spec) {
    if (!city || !spec || !city.root || !CBZ.registerAirport) return null;
    const root = city.root;
    const E = DIM();
    const RW = (spec.runway && spec.runway.w) || REAL.runwayW;
    const H0 = ((spec.runway && spec.runway.len) || 900) / 2;
    const TW = REAL.taxiW;
    const T = spec.terminal;
    const SP = P.standPlan(T.z0, spec.taxiZ);
    const tplan = P.terminalPlan(T);
    const two = tplan.two;

    // ---- stands -> gates (nose-in: local heading -PI/2 points the nose at +Z)
    const stands = (spec.stands || []).map(function (s, i) {
      return {
        id: s.id, num: s.num || String(i + 1), lx: s.lx, lz: SP.standZ, bridge: !!s.bridge && two,
        stopZ: SP.stopZ, headZ: T.z0 - 1.5, erlZ: SP.tailZ - 3,
      };
    });
    // bridge rotundas: a bridge per contact stand, on the gate floor
    // (the rotunda hangs on the facade, so it is kept 4 m inside the gables)
    if (two) for (const s of stands) if (s.bridge) s.bridge = { doorX: Math.max(T.x0 + 4, Math.min(T.x1 - 4, s.lx + E.fuselage / 2 + 14)), num: s.num };
    T.bridges = stands.filter(function (s) { return s.bridge; }).map(function (s) { return s.bridge; });
    if (!two && !T.gateDoors) T.gateDoors = stands.map(function (s) { return s.lx + 12; });

    // ---- the extent + world bounds
    const X = spec.extent || { x0: -H0 - 80, x1: H0 + 80, z0: -RW / 2 - 70, z1: (spec.kerbZ || T.z1 + 8) + 60 };
    function toW(lx, lz) {
      const c = Math.cos(spec.yaw || 0), s = Math.sin(spec.yaw || 0);
      return { x: spec.x + lx * c + lz * s, z: spec.z - lx * s + lz * c };
    }
    let bounds = spec.bounds;
    if (!bounds) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const c of [toW(X.x0, X.z0), toW(X.x1, X.z0), toW(X.x0, X.z1), toW(X.x1, X.z1)]) {
        minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
      }
      bounds = { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ };
    }
    const reg = {
      id: spec.id, name: spec.name, code: spec.code, city: spec.city, hub: spec.hub,
      builtBy: spec.builtBy || "airport_kit",
      x: spec.x, z: spec.z, yaw: spec.yaw || 0,
      runway: { len: H0 * 2, w: RW, tdz: (spec.runway && spec.runway.tdz) || P.runwayRules.aimingPoint(H0 * 2).at + 20 },
      connectors: spec.conns,
      taxiZ: spec.taxiZ, apronZ: (spec.taxiZ + T.z0) / 2, standZ: SP.standZ, termZ: (T.z0 + T.z1) / 2,
      kerbZ: spec.kerbZ || T.z1 + 6,
      gates: stands.map(function (s) { return { id: s.id, lx: s.lx, lz: s.lz, heading: -Math.PI / 2, size: "airliner" }; }),
      desk: { lx: tplan.desk.lx, lz: tplan.desk.lz, heading: tplan.desk.face, label: spec.name },
      bounds: bounds,
    };
    const ap = CBZ.registerAirport(reg);
    if (!ap) return null;
    ap.builtBy = reg.builtBy;
    ap.subtitle = spec.subtitle || "Airport";
    ap.biome = spec.biome || "airport";
    const B = ap.bounds;
    const yaw = ap.yaw;
    const cY = Math.cos(yaw), sY = Math.sin(yaw);
    const axis = Math.min(Math.abs(cY), Math.abs(sY)) < 0.03;

    // ---- the resolved layout, published
    const holdZ = Math.min(spec.taxiZ - TW / 2 - 4, Math.max(RW / 2 + 20, REAL.holdFromCL));
    const L = {
      H: H0, RW: RW, taxiW: TW, taxiZ: spec.taxiZ,
      taxiX0: spec.taxiX0 != null ? spec.taxiX0 : -H0 + 20, taxiX1: spec.taxiX1 != null ? spec.taxiX1 : H0 - 20,
      conns: spec.conns, holdZ: holdZ, blast: spec.blast != null ? spec.blast : 60,
      aprons: spec.aprons || [], paved: spec.paved || [], stands: stands, span: E.span,
      stand: SP, terminal: tplan,
      hsRoad: { x0: T.x0 - 20, x1: T.x1 + 20, z: SP.noseTipZ + 4, w: 6.4 },
    };
    ap.layout = L;

    // ================= (1) THE GROUND =================
    // ONE plane with ONE canvas carries the whole movement area and every
    // marking. An axis-aligned field paints the registered bounds; a crooked
    // one paints its own extent in its own frame and a grass ring (the
    // bounds minus that rectangle, a real hole, no overlap) fills the rest.
    let PAINT = null, groundTex = null;
    {
      const planeAxis = axis && spec.bounds;
      const PW = planeAxis ? (B.maxX - B.minX) : (X.x1 - X.x0);
      const PD = planeAxis ? (B.maxZ - B.minZ) : (X.z1 - X.z0);
      const pxW = 4096, pxD = Math.min(2048, Math.max(512, Math.pow(2, Math.round(Math.log2(pxW * PD / PW)))));
      PAINT = P.painter(PW, PD, pxW, pxD);
      // frame: where the field origin sits in plane metres
      let ox, oz, fy;
      if (planeAxis) { ox = ap.x - B.minX; oz = ap.z - B.minZ; fy = 0; }
      else { ox = -X.x0; oz = -X.z0; fy = 0; }
      PAINT.frame(ox, oz, fy);
      PAINT.fill(C.GRASS);
      for (let i = -40; i < 60; i++) PAINT.rect(0, i * 28, 4000, 14, C.GRASS_MOW, 0.07);
      P.paintField(PAINT, ap, L);
      if (spec.paint) { try { spec.paint(PAINT, L, ap); } catch (e) { console.error("[airfield] paint", ap.id, e); } }
      groundTex = PAINT.texture();
      const sm = P.surfaceMaterial(groundTex, PW, PD, {
        frame: { ox: ox, oz: oz, yaw: 0 }, rwy: [-H0, H0, 0, RW / 2], panel: 5,
        tdz: P.runwayRules.aimingPoint(H0 * 2).at + 50,
      });
      const g = new THREE.PlaneGeometry(PW, PD);
      g.rotateX(-Math.PI / 2);
      let m;
      if (planeAxis) {
        g.translate((B.minX + B.maxX) / 2, 0.03, (B.minZ + B.maxZ) / 2);
        m = new THREE.Mesh(g, sm);
      } else {
        g.translate((X.x0 + X.x1) / 2, 0.03, (X.z0 + X.z1) / 2);
        m = new THREE.Mesh(g, sm);
        m.position.set(ap.x, 0, ap.z);
        m.rotation.y = yaw;
        // the grass ring: the registered bounds with the field rectangle cut out
        const sh = new THREE.Shape();
        sh.moveTo(B.minX, -B.minZ); sh.lineTo(B.maxX, -B.minZ); sh.lineTo(B.maxX, -B.maxZ); sh.lineTo(B.minX, -B.maxZ); sh.closePath();
        const hole = new THREE.Path();
        const cs = [toW(X.x0, X.z0), toW(X.x1, X.z0), toW(X.x1, X.z1), toW(X.x0, X.z1)];
        hole.moveTo(cs[0].x, -cs[0].z);
        for (let i = 1; i < 4; i++) hole.lineTo(cs[i].x, -cs[i].z);
        hole.closePath();
        sh.holes.push(hole);
        const rg = new THREE.ShapeGeometry(sh);
        rg.rotateX(-Math.PI / 2);
        rg.translate(0, 0.03, 0);
        const uv = rg.attributes.uv, pos = rg.attributes.position;
        const GW = B.maxX - B.minX, GD = B.maxZ - B.minZ;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - B.minX) / GW, 1 - (pos.getZ(i) - B.minZ) / GD);
        const gt = canvasTex(4, 4, function (x) { x.fillStyle = "#" + C.GRASS.toString(16).padStart(6, "0"); x.fillRect(0, 0, 4, 4); });
        if (CBZ.groundLinear) CBZ.groundLinear(gt);
        const rm = new THREE.Mesh(rg, P.surfaceMaterial(gt, GW, GD, { panel: 5 }));
        rm.receiveShadow = true; rm.matrixAutoUpdate = false; rm.updateMatrix();
        rm.userData.terrain = true; rm.userData.worldSurface = true; rm.userData.unifiedSurface = true;
        rm.userData.surfaceOwner = "airfield:" + ap.id;
        rm.name = "airfield-grass:" + ap.id;
        root.add(rm);
      }
      m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
      m.userData.terrain = true; m.userData.worldSurface = true;
      m.userData.surfaceOwner = "airfield:" + ap.id; m.userData.unifiedSurface = true;
      m.name = "airfield-surface:" + ap.id;
      root.add(m);
      ap.surface = m;
    }
    /* THE ONE PAINT API: anything that belongs painted on this field (the
       airside service roads, a kerb line) paints INTO the canvas in local
       metres — never a ribbon laid on top of the plane. */
    ap.paint = function (fn) {
      try { fn(PAINT); } catch (e) { try { console.error("[airfield] paint", e); } catch (e2) {} }
      if (groundTex) groundTex.needsUpdate = true;
    };

    // ================= (2) THE FIELD GROUP =================
    const F = new THREE.Group();
    F.position.set(ap.x, 0, ap.z);
    F.rotation.y = yaw;
    F.name = "airfield:" + ap.id;
    root.add(F);
    ap.group = F;

    // colliders / platforms from local footprints. The engine's are
    // axis-aligned: a crooked footprint is chopped into cells so the box of
    // each cell stays within ~0.4 m of the thing it stands for.
    function obb(lx, lz, w, d, yawL, fn) {
      const t = yaw + (yawL || 0);
      const c = Math.cos(t), s = Math.sin(t);
      const ac = Math.abs(c), as = Math.abs(s);
      const cL = Math.cos(yawL || 0), sL = Math.sin(yawL || 0);
      const aligned = Math.min(ac, as) < 0.03;
      const thin = Math.min(w, d) < 1.0;
      const cell = aligned ? Infinity : (thin ? 1.5 : 3.0);
      const nx = Math.max(1, Math.ceil(w / cell)), nz = Math.max(1, Math.ceil(d / cell));
      for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
        const ox = -w / 2 + (i + 0.5) * w / nx, oz = -d / 2 + (k + 0.5) * d / nz;
        // cell centre in field-local, then world
        const px = lx + ox * cL + oz * sL, pz = lz - ox * sL + oz * cL;
        const wp = { x: ap.x + px * cY + pz * sY, z: ap.z - px * sY + pz * cY };
        const cw = w / nx, cd = d / nz;
        const hw = (cw * ac + cd * as) / 2, hd = (cw * as + cd * ac) / 2;
        fn(wp.x - hw, wp.x + hw, wp.z - hd, wp.z + hd);
      }
    }
    function solid(lx, lz, w, d, y0, y1, yawL, list) {
      obb(lx, lz, w, d, yawL, function (x0, x1, z0, z1) {
        const col = { minX: x0, maxX: x1, minZ: z0, maxZ: z1, y0: y0, y1: y1, ref: null, noBreach: true, airfield: ap.id };
        CBZ.colliders.push(col);
        if (list) list.push(col);
      });
    }
    function plat(lx, lz, w, d, top, yawL, list) {
      if (!CBZ.platforms) return;
      obb(lx, lz, w, d, yawL, function (x0, x1, z0, z1) {
        const p = { minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: top, airfield: ap.id };
        CBZ.platforms.push(p);
        if (list) list.push(p);
      });
    }
    ap.solidLocal = solid; ap.platLocal = plat;
    // a building placed at (bx, bz, byaw) in field-local: its own footprints
    function placeCols(res, bx, bz, byaw) {
      const c = Math.cos(byaw || 0), s = Math.sin(byaw || 0);
      for (const k of res.cols || []) {
        solid(bx + k[0] * c + k[1] * s, bz - k[0] * s + k[1] * c, k[2], k[3], k[5], k[6], (byaw || 0) + (k[4] || 0));
      }
      for (const p of res.plats || []) {
        plat(bx + p[0] * c + p[1] * s, bz - p[0] * s + p[1] * c, p[2], p[3], p[4], byaw || 0);
      }
    }
    ap.placeCols = placeCols;
    function place(parent, grp, bx, bz, byaw) {
      grp.position.set(bx, 0, bz); grp.rotation.y = byaw || 0;
      parent.add(grp);
      grp.updateMatrix();
      return grp;
    }

    // ================= (3) LIGHTS =================
    {
      const edge = [], inset = [];
      // runway edge: white, 60 m max spacing, both ends included
      const n = Math.ceil((2 * H0) / REAL.edgeLightStep);
      for (let i = 0; i <= n; i++) {
        const x = -H0 + (2 * H0) * i / n;
        const fromEnd = Math.min(x + H0, H0 - x);
        const k = (2 * H0 > 1800 && fromEnd < 600) ? "y" : "w";
        edge.push([x, -RW / 2 - 1.5, k], [x, RW / 2 + 1.5, k]);
      }
      // threshold (green, outboard) and runway end (red, inboard), 3 m spacing
      for (const e of ap.ends) {
        const m = Math.floor(RW / 3);
        for (let k = 0; k <= m; k++) {
          const z = -RW / 2 + RW * k / m;
          edge.push([e.sign * (H0 + 1.2), z, "g"]);
          edge.push([e.sign * (H0 - 1.2), z + RW / (2 * m) * (k < m ? 1 : -1), "r"]);
        }
      }
      // runway centreline, inset every 15 m: white, then alternating, then red
      for (let x = -H0 + 7.5; x < H0 - 7; x += REAL.clLightStep) {
        const d = Math.min(x + H0, H0 - x), idx = Math.round((x + H0) / REAL.clLightStep);
        const k = d < 300 ? "r" : d < 900 ? (idx % 2 ? "r" : "w") : "w";
        inset.push([x + 0.6, 0, k]);
      }
      // taxiway: blue edge on the runway side, green inset centreline
      for (let x = L.taxiX0 + 15; x <= L.taxiX1 - 15; x += 30) {
        let clear = true;
        for (const c of L.conns) if (Math.abs(x - c) < TW / 2 + 20) clear = false;
        if (clear) edge.push([x, L.taxiZ - TW / 2 - 1.2, "b"]);
        inset.push([x, L.taxiZ, "g"]);
      }
      for (const c of L.conns) {
        for (const s of [-1, 1]) for (let z = RW / 2 + 25; z < L.taxiZ - TW / 2 - 18; z += 15) edge.push([c + s * (TW / 2 + 1.2), z, "b"]);
        for (let z = RW / 2 + 30; z < L.taxiZ - 25; z += 15) inset.push([c, z, z < holdZ ? (Math.round(z / 15) % 2 ? "y" : "g") : "g"]);
        // the stop bar at the holding position: red, inset, every 3 m across
        for (let x = -TW / 2 + 1.5; x < TW / 2; x += 3) inset.push([c + x, holdZ - 1.2, "r"]);
      }
      // stand lead-in: green inset centreline to the stop
      for (const st of stands) for (let z = L.taxiZ + 40; z < st.stopZ - 2; z += 7.5) inset.push([st.lx, z, "g"]);
      P.edgeLights(F, edge, root).name = "airfield-lights:" + ap.id;
      P.insetLights(F, inset, root);
      // PAPI at the aiming point of each end, on the pilot's left
      const plan = P.runwayPlan(H0 * 2, RW);
      for (const e of ap.ends) {
        const sg = e.sign;
        P.papi(F, { x: sg * (H0 - plan.aim.at - 20), z: sg * (RW / 2), outx: 0, outz: sg, facex: sg, facez: 0 }, root);
      }
    }

    // ================= (4) SIGNS =================
    {
      const list = [];
      const rn = ap.runwayName.replace("/", "-");
      for (let i = 0; i < L.conns.length; i++) {
        const c = L.conns[i];
        // pilot heading -Z to the runway: the sign stands on his left (-X), facing him
        list.push({ x: c - TW / 2 - 7, z: holdZ + 2, rot: 0, panels: [["mand", rn], ["loc", "A" + (i + 1)]] });
        list.push({ x: c + TW / 2 + 7, z: holdZ + 2, rot: 0, panels: [["mand", rn]] });
        // leaving the runway: on the pilot's left heading +Z
        list.push({ x: c + TW / 2 + 7, z: RW / 2 + 35, rot: Math.PI, panels: [["loc", "A" + (i + 1)]] });
      }
      P.signs(F, list, root);
    }

    // ================= (5) THE TERMINAL =================
    const staffPosts = [];
    const gateSeatRecs = [];
    const doors = CBZ.cityDoorsGet ? CBZ.cityDoorsGet() : null;
    const tctx = {
      F: F, root: root,
      solid: function (lx, lz, w, d, y0, y1) { solid(lx, lz, w, d, y0, y1); },
      plat: function (lx, lz, w, d, top) { plat(lx, lz, w, d, top); },
      seat: function (lx, y, lz, face, cush) {
        if (!CBZ.propRegisterSeat) return;
        const w = toW(lx, lz);
        const rec = CBZ.propRegisterSeat(w.x, y, w.z, face + yaw, "waiting", null, { cushion: cush, floorBelow: y, requireEntry: y < 0.5 });
        if (rec) gateSeatRecs.push(rec);
      },
      /* AUTOMATIC SLIDING DOORS, on city/buildings.js's own door sim: a
         record in the same array, whose `pivot` is an adapter — the sim
         writes pivot.rotation.y = t * maxAng as it does for every swing
         door, and the setter slides the two glass leaves apart instead. So
         proximity, the collider, the nav graph's "open" and the sound are
         the one door system's, and a terminal adds no second one. */
      door: function (lx, lz, w, nx, nz) {
        const leaves = [];
        const lw = w / 2;
        const gm = P.glassMat(0.3);
        for (const s of [-1, 1]) {
          const leaf = new THREE.Group();
          const pane = new THREE.Mesh(new THREE.BoxGeometry(lw, 2.6, 0.04), gm);
          pane.position.y = 1.32;
          const fr = new THREE.Mesh(mergeGeos([
            put(new THREE.BoxGeometry(lw, 0.08, 0.07), 0, 2.6, 0), put(new THREE.BoxGeometry(lw, 0.1, 0.07), 0, 0.05, 0),
            put(new THREE.BoxGeometry(0.06, 2.6, 0.07), -lw / 2 + 0.03, 1.3, 0), put(new THREE.BoxGeometry(0.06, 2.6, 0.07), lw / 2 - 0.03, 1.3, 0),
          ]), cmat(0x3a414a));
          leaf.add(pane); leaf.add(fr);
          leaf.userData.dynamic = true;
          leaf.position.set(lx + s * lw / 2, 0, lz - nz * 0.25);
          F.add(leaf);
          leaves.push({ g: leaf, x0: lx + s * lw / 2, s: s });
        }
        if (!doors) { for (const l of leaves) l.g.position.x = l.x0 + l.s * lw * 0.95; return null; }
        const wp = toW(lx, lz);
        const inx = nx * cY + nz * sY, inz = -nx * sY + nz * cY;
        const col = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, y0: 0, y1: 2.7, ref: null };
        obb(lx, lz, w, 0.4, 0, function (a, b, c, d) { col.minX = a; col.maxX = b; col.minZ = c; col.maxZ = d; });
        CBZ.colliders.push(col);
        const pivot = { rotation: {} };
        let tv = 0;
        Object.defineProperty(pivot.rotation, "y", {
          get: function () { return tv; },
          set: function (v) {
            tv = v;
            const t = Math.max(0, Math.min(1, v));
            for (const l of leaves) l.g.position.x = l.x0 + l.s * lw * 0.95 * t;
          },
        });
        const rec = {
          pivot: pivot, col: col, wx: wp.x, wz: wp.z, t: 0, open: false, hold: 0,
          maxAng: 1, colIn: true, inx: inx, inz: inz, doorY: 1.5, leaf: null, rails: null,
          sliding: true, airfield: ap.id,
        };
        doors.push(rec);
        (ap.doors = ap.doors || []).push(rec);
        return rec;
      },
      post: function (p) { staffPosts.push(p); },
    };
    const term = P.terminal(T, tctx);
    ap.terminal = { plan: term.plan, eave: term.eave, group: term.group, y: term.plan.mezzY };
    for (const p of term.posts) staffPosts.push(p);

    // ================= (6) STANDS, BRIDGES, THE PARKED FLEET =================
    const K = CBZ.airportKit;
    const liveries = [0x2d5fb0, 0xb33636, 0x1f7a4d, 0xc78a1f, 0x7a4ea8, 0x2b6f7a];
    ap.parked = [];
    const parkedSet = new Set(spec.parked || []);
    const standDress = { cones: [], chocks: [], gpus: [] };
    for (let i = 0; i < ap.gates.length; i++) {
      const g = ap.gates[i], st = stands[i];
      st.gate = g;
      g.stand = st;
      g.nose = "in";
      g.pushZ = L.taxiZ;                                 // where a pushback ends (local z)
      // the L1 door, where it will be when an aeroplane is on this stand
      g.doorL = { lx: st.lx + E.fuselage / 2, lz: SP.doorZ, y: E.sill };
      if (K && K.airliner && K.boardable && parkedSet.has(g.id)) {
        try {
          const grp = K.airliner(g.x, g.z, g.worldHeading, liveries[(i + ap.code.charCodeAt(0)) % liveries.length]);
          K.boardable(grp, g.x, g.z, g.worldHeading, 30, 22, "Airliner");
          g.occupant = "parked";
          ap.parked.push(grp);
          const cab = grp.userData && grp.userData.cabin;
          if (cab && cab.doorX != null) g.doorL = { lx: st.lx - cab.doorZ + 0.35, lz: SP.standZ + cab.doorX, y: cab.floorTop };
        } catch (e) { try { console.error("[airfield] parked airliner", ap.id, e); } catch (e2) {} }
        // chocks at the nose gear, cones off the wingtips and at the tail, a GPU at the nose
        standDress.chocks.push([st.lx, SP.stopZ + 0.9, 0], [st.lx, SP.stopZ - 0.9, 0]);
        standDress.cones.push([st.lx - E.span / 2 - 1.2, SP.standZ - 2], [st.lx + E.span / 2 + 1.2, SP.standZ - 2], [st.lx, SP.tailZ - 3]);
        standDress.gpus.push([st.lx - 6, SP.noseTipZ - 3, Math.PI / 2]);
      }
    }
    P.cones(F, standDress.cones);
    P.chocks(F, standDress.chocks);
    P.gpus(F, standDress.gpus);
    // jet bridges: they DOCK when an aeroplane is on the stand and RETRACT
    // when it leaves — rebuilt on the change (a few merges, a few times a
    // flight), with their walkable deck swapped with them
    ap.bridges = [];
    for (const st of stands) {
      if (!st.bridge) continue;
      const b = {
        st: st, gate: st.gate, group: null, cols: [], plats: [], docked: null,
        // the rotunda hangs just off the glass, its column clear of the
        // head-of-stand road that runs under the bridges
        ax: st.bridge.doorX, az: T.z0 - 2.4, ya: tplan.mezzY + 0.06,
      };
      b.build = function (dock) {
        if (b.group) { F.remove(b.group); b.group.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); b.group = null; }
        for (const c of b.cols) { const k = CBZ.colliders.indexOf(c); if (k >= 0) CBZ.colliders.splice(k, 1); }
        for (const p of b.plats) { const k = CBZ.platforms ? CBZ.platforms.indexOf(p) : -1; if (k >= 0) CBZ.platforms.splice(k, 1); }
        b.cols = []; b.plats = [];
        const dl = b.gate.doorL;
        // retracted: the cab parked 5 m short of where a door would be
        const pull = dock ? 0.35 : 5.5;
        const o = {
          ax: b.ax, az: b.az, ya: b.ya, wnx: 0, wnz: -1,
          bx: dl.lx + pull, bz: dl.lz, yb: dock ? dl.y : dl.y + 0.3, nx: 1, nz: 0,
        };
        const jb = P.jetBridge(F, o, root);
        b.group = jb.group;
        for (const d of jb.deck) plat(d[0], d[1], d[2], d[3], d[4], 0, b.plats);
        for (const w of jb.walls) solid(w[0], w[1], w[2], w[3], w[4], w[5], 0, b.cols);
        solid(jb.col.x, jb.col.z, jb.col.w, jb.col.d, 0, jb.col.h, 0, b.cols);
        solid(jb.rotundaCol.x, jb.rotundaCol.z, jb.rotundaCol.w, jb.rotundaCol.d, 0, jb.rotundaCol.h, 0, b.cols);
        b.jb = jb;
        b.docked = dock;
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      };
      b.build(!!(b.gate.occupant));
      ap.bridges.push(b);
    }
    // the dock watcher: an aeroplane standing still on the stand, nose in
    if (ap.bridges.length && CBZ.onUpdate) {
      let acc = 0;
      const watch = function (dt) {
        if (!F.parent) return;
        acc += dt || 0;
        if (acc < 1.0) return;
        acc = 0;
        for (const b of ap.bridges) {
          const occ = b.gate.occupant;
          let here = false;
          const grp = occ && occ.group ? occ.group : (occ === "parked" ? true : null);
          if (grp === true) here = true;
          else if (grp && grp.parent && (grp.position.y || 0) < 0.3) {
            const d = Math.hypot(grp.position.x - b.gate.x, grp.position.z - b.gate.z);
            let dh = grp.rotation.y - b.gate.worldHeading;
            dh = Math.atan2(Math.sin(dh), Math.cos(dh));
            here = d < 1.5 && Math.abs(dh) < 0.1;
          }
          if (here !== !!b.docked) b.build(here);
          // where a passenger stepping off the aeroplane lands: the bridge cab
          if (grp && grp !== true) grp.userData.bridgeDock = here ? { x: toW(b.jb.cab.x, b.jb.cab.z).x, z: toW(b.jb.cab.x, b.jb.cab.z).z, y: b.jb.cab.y } : null;
        }
      };
      CBZ.onUpdate(41.7, watch);
    }
    // business jets on the GA ramp
    if (K && K.jet && K.boardable && spec.jets) {
      for (let i = 0; i < spec.jets.length; i++) {
        const j = spec.jets[i];
        const w = toW(j.lx, j.lz);
        const hd = yaw + (j.heading == null ? -Math.PI / 2 : j.heading);
        try {
          const grp = K.jet(w.x, w.z, hd, [0x355c8a, 0x6a3a6a, 0x2d2f33, 0x8a6a35][i % 4]);
          K.boardable(grp, w.x, w.z, hd, 14, 12, "Private Jet");
          ap.parked.push(grp);
        } catch (e) {}
      }
    }

    // ================= (7) THE TOWER =================
    if (spec.tower && !spec.tower.external) {
      const t = spec.tower;
      const H = t.H || 24;
      const tw = P.tower(F, t.lx, t.lz, { H: H, apothem: 2.6, cabHalf: 4.4, cabH: 3.4, base: { w: 12, d: 10, h: 7 }, slot: true }, root);
      solid(t.lx, t.lz, 12, 10, 0, 7.4);
      solid(t.lx, t.lz, 6, 6, 0, H);
      solid(t.lx, t.lz, 10.4, 10.4, H - 0.5, tw.roofY + 0.6);
    }

    // ================= (8) THE FENCE =================
    if (spec.fence && spec.fence.runs) P.fence(F, spec.fence.runs, { center: spec.fence.center || { x: 0, z: L.taxiZ } });

    // ================= (9) STAFF + SEATED TRAVELLERS (deferred) =================
    if (CBZ.cityStaffVenue) { try { CBZ.cityStaffVenue("airport:" + ap.id, { stations: staffPosts.length, note: "check-in and gates" }); } catch (e) {} }
    if (CBZ.cityStaffPost) {
      for (const p of staffPosts) {
        const w = toW(p.lx, p.lz);
        try {
          CBZ.cityStaffPost({
            venue: "airport:" + ap.id, id: ap.id + ":" + p.id,
            job: p.job || "check-in agent", archetype: "laborer",
            x: w.x, z: w.z, face: (p.face || 0) + yaw,
            opts: p.y ? { floorY: p.y, outfit: 0x2f4f78 } : { outfit: 0x2f4f78 },
            after: function (ped) { ped.job = p.job || "check-in agent"; ped._airportPlaced = true; },
          });
        } catch (e) {}
      }
    }
    if (gateSeatRecs.length && CBZ.onUpdate) {
      let done = false;
      CBZ.onUpdate(55.4, function () {
        if (done || !F.parent) return;
        if (!CBZ.game || CBZ.game.mode !== "city" || !CBZ.city || !CBZ.city.arena) return;
        if (!CBZ.cityPostNpc || !CBZ.propSit || !CBZ.cityPeds) return;
        done = true;
        let n = 0;
        for (let i = 0; i < gateSeatRecs.length && n < 12; i++) {
          const rec = gateSeatRecs[i];
          if (!rec || rec.occupant) continue;
          if (hash01(rec.x, rec.z, 0xa17e) > 0.3) continue;
          const ped = CBZ.cityPostNpc(rec.x, rec.z, { archetype: "tourist", aggr: 0.07, wealth: 0.45, src: "airport:gate-lounge", floorY: rec.y });
          if (!ped) continue;
          ped.job = "traveller";
          if (!CBZ.propSit(ped, rec, { instant: true })) { if (CBZ.cityUnpostNpc) CBZ.cityUnpostNpc(ped); continue; }
          n++;
        }
      });
    }

    // ================= (10) THE WORLD CONTRACTS =================
    if (spec.region !== false) {
      CBZ.registerCityRegion(city, {
        name: ap.name, subtitle: ap.subtitle, biome: ap.biome, kind: "rect",
        minX: B.minX, maxX: B.maxX, minZ: B.minZ, maxZ: B.maxZ, pad: 6,
      });
    }
    // NOBODY WALKS ON THE MOVEMENT AREA: airside keep-out, local rect -> world
    if (CBZ.registerNoSpawnZone) {
      const zones = spec.noSpawn || (function () {
        const c = [toW(X.x0, X.z0), toW(X.x1, X.z0), toW(X.x0, T.z0 - 2), toW(X.x1, T.z0 - 2)];
        const xs = c.map(function (p) { return p.x; }), zs = c.map(function (p) { return p.z; });
        return [{ minX: Math.min.apply(null, xs), maxX: Math.max.apply(null, xs), minZ: Math.min.apply(null, zs), maxZ: Math.max.apply(null, zs), label: ap.id + "-airside" }];
      })();
      for (const z of zones) { try { CBZ.registerNoSpawnZone(city, z); } catch (e) {} }
    }
    // a kerb road on a near-axis field (road records are axis-aligned), and the link out
    if (city.roads && axis && spec.kerbRoad !== false && !spec.bounds) {
      const k0 = toW(T.x0 - 20, ap.kerbZ), k1 = toW(T.x1 + 20, ap.kerbZ);
      const horiz = Math.abs(k1.x - k0.x) >= Math.abs(k1.z - k0.z);
      city.roads.push({
        x: (k0.x + k1.x) / 2, z: (k0.z + k1.z) / 2, vertical: !horiz,
        len: Math.hypot(k1.x - k0.x, k1.z - k0.z), district: "highway",
        w: 18, lanesPerDir: 2, laneW: 3.6, owner: ap.biome,
      });
    }
    if (spec.road && city.roads) {
      const kerb = toW((T.x0 + T.x1) / 2, (spec.kerbZ || T.z1 + 6) + 30);
      const HW = 12;
      const legs = [];
      if (Math.abs(spec.road.z - kerb.z) > 24) legs.push({ vertical: true, x: kerb.x, z0: kerb.z, z1: spec.road.z });
      if (Math.abs(spec.road.x - kerb.x) > 24) legs.push({ vertical: false, z: spec.road.z, x0: kerb.x, x1: spec.road.x });
      for (let i = 0; i < legs.length; i++) {
        const Lg = legs[i];
        const midX = Lg.vertical ? Lg.x : (Lg.x0 + Lg.x1) / 2;
        const midZ = Lg.vertical ? (Lg.z0 + Lg.z1) / 2 : Lg.z;
        const len = Lg.vertical ? Math.abs(Lg.z1 - Lg.z0) : Math.abs(Lg.x1 - Lg.x0);
        const w = Lg.vertical ? HW * 2 : len, d = Lg.vertical ? len : HW * 2;
        const g = new THREE.PlaneGeometry(w, d);
        g.rotateX(-Math.PI / 2); g.translate(midX, 0.06, midZ);
        const lm = cmat(0x3c3f46).clone();
        lm.polygonOffset = true; lm.polygonOffsetFactor = -2; lm.polygonOffsetUnits = -4;
        if (CBZ.asphaltDetail) { try { CBZ.asphaltDetail(lm); } catch (e) {} }
        const m = new THREE.Mesh(g, lm);
        m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
        m.userData.terrain = true; m.userData.worldSurface = true;
        root.add(m);
        CBZ.registerCityRegion(city, {
          name: ap.name + " Link " + (i + 1), subtitle: ap.subtitle, biome: ap.biome, kind: "rect",
          minX: midX - w / 2, maxX: midX + w / 2, minZ: midZ - d / 2, maxZ: midZ + d / 2, pad: 1,
        });
        const link = { x: midX, z: midZ, vertical: Lg.vertical, len: len, district: "highway", w: 20, lanesPerDir: 2, laneW: 3.6, owner: ap.biome };
        if (CBZ.roadClamp) { try { CBZ.roadClamp(link, { owner: link.owner }); } catch (e) {} }
        city.roads.push(link);
      }
    }

    // ================= (11) THE DRESSING, when near =================
    if (spec.dressing) pending.push({ ap: ap, spec: spec, city: city });
    ap.toWorldL = toW;
    return ap;
  };

  /* THE DRESSING PASS. Runs late (order 96) so every region and road in the
     world exists (the approach lights ask them where they may stand), and
     hands each field's hangars, fuel farm, fire station, cargo, car park,
     radar, ILS, approach lights and apron masts to the streamer as one
     job: built with the world when nothing streams, built before it can be
     seen and parked when the player leaves when it does. */
  function buildDressing(ap, spec, city) {
    const d = spec.dressing, root = city.root;
    const D = new THREE.Group();
    D.position.set(ap.x, 0, ap.z);
    D.rotation.y = ap.yaw;
    D.name = "airfield-dressing:" + ap.id;
    root.add(D);
    const L = ap.layout, H0 = L.H, RW = L.RW;
    const solid = ap.solidLocal, plat = ap.platLocal;
    function put3(res, x, z, yawL) {
      res.group.position.set(x, 0, z);
      res.group.rotation.y = yawL || 0;
      D.add(res.group);
      // the builder's lamps join the night with this field
      res.group.traverse(function (o) {
        if (o.material && o.material._afNight != null) { for (const e of glow) if (e.m === o.material && !e.root) e.root = D; }
      });
      ap.placeCols(res, x, z, yawL);
      return res;
    }
    // hangars: lamp discs hung under the rafters glow at night
    for (const h of d.hangars || []) {
      const res = P.hangar(h);
      if (res.lamps && res.lamps.length) addMerged(res.group, res.lamps, lamp(0xfff2dc, 0.4, 1.3, D), {});
      put3(res, h.lx, h.lz, h.yaw);
    }
    for (const s of d.sheds || []) put3(P.shed(s), s.lx, s.lz, s.yaw);
    if (d.fuel) put3(P.fuelFarm(d.fuel), d.fuel.lx, d.fuel.lz, d.fuel.yaw);
    if (d.fire) {
      const res = put3(P.fireStation(d.fire, D), d.fire.lx, d.fire.lz, d.fire.yaw);
      const c = Math.cos(d.fire.yaw || 0), s = Math.sin(d.fire.yaw || 0);
      ap.fire = { bays: res.bays.map(function (b) {
        const lx = d.fire.lx + b.x * c + b.z * s, lz = d.fire.lz - b.x * s + b.z * c;
        const w = ap.toWorldL(lx, lz);
        return { x: w.x, z: w.z, heading: ap.yaw + (d.fire.yaw || 0), open: b.open };
      }) };
    }
    if (d.carpark) put3(P.carPark(d.carpark, D), d.carpark.lx, d.carpark.lz, d.carpark.yaw);
    if (d.rental) put3(P.rentalCanopy(d.rental, D), d.rental.lx, d.rental.lz, d.rental.yaw);
    if (d.asr) put3(P.asr(d.asr, D), d.asr.lx, d.asr.lz, 0);
    if (d.radome) put3(P.radome(d.radome, D), d.radome.lx, d.radome.lz, 0);
    if (d.ulds && d.ulds.length) P.ulds(D, d.ulds);
    for (const w of d.windsocks || []) P.windsock(D, w[0], w[1], w[2] || 0, D);
    if (d.masts && d.masts.length) P.apronMasts(D, d.masts, D);
    // ---- ILS: localizer beyond the stop end, glideslope beside the touchdown
    if (d.ils) {
      const e = ap.ends[d.ils.end || 0];               // the landing threshold
      const sg = e.sign;
      const locD = d.ils.locDist || 300, gsOff = d.ils.gsOffset || 120;
      const loc = P.localizer({ w: Math.min(RW, 36), n: 16 });
      // beyond the OTHER end, facing back down the runway
      put3(loc, -sg * (H0 + locD), 0, sg > 0 ? -Math.PI / 2 : Math.PI / 2);
      const gs = P.glideslope();
      const gside = d.ils.gsSide || -1;
      put3(gs, sg * (H0 - 300), gside * (RW / 2 + gsOff), sg > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
    // ---- approach lighting: MALSR out to 420 m + sequenced flashers, where
    //      the ground and the world let a mast stand
    for (const a of d.approach || []) {
      const e = ap.ends[a.end];
      const sg = e.sign;
      const stations = [];
      const len = a.len || REAL.malsrLen;
      const blocked = function (lx, lz) {
        const w = ap.toWorldL(lx, lz);
        for (const r of city.roads || []) {
          const hw = (r.w || 14) / 2 + 3;
          const hx = r.vertical ? hw : r.len / 2, hz = r.vertical ? r.len / 2 : hw;
          if (Math.abs(w.x - r.x) < hx && Math.abs(w.z - r.z) < hz) return true;
        }
        for (const rg of city.regions || []) {
          if (rg.underlay || rg.name === ap.name) continue;
          if (rg.kind === "circle") { if (Math.hypot(w.x - rg.cx, w.z - rg.cz) < rg.r) return true; }
          else if (w.x > rg.minX && w.x < rg.maxX && w.z > rg.minZ && w.z < rg.maxZ) return true;
        }
        return false;
      };
      const B = ap.bounds;
      const inB = function (lx, lz) { const w = ap.toWorldL(lx, lz); return w.x > B.minX && w.x < B.maxX && w.z > B.minZ && w.z < B.maxZ; };
      for (let dd = REAL.malsrBarStep; dd <= len + 0.1; dd += REAL.malsrBarStep) {
        const lx = sg * (H0 + dd);
        if (blocked(lx, 0)) continue;
        stations.push({ d: dd, x: lx, z: 0, dirx: sg, dirz: 0, y0: inB(lx, 0) ? 0 : -3.5, kind: Math.abs(dd - 300) < 1 ? "cross" : "bar" });
      }
      const nf = a.flashers == null ? REAL.flashers : a.flashers;
      for (let k = 1; k <= nf; k++) {
        const dd = len + k * REAL.flasherStep, lx = sg * (H0 + dd);
        if (blocked(lx, 0)) continue;
        stations.push({ d: dd, x: lx, z: 0, dirx: sg, dirz: 0, y0: inB(lx, 0) ? 0 : -3.5, kind: "flash" });
      }
      P.approachLights(D, stations, D);
      ap.approach = ap.approach || [];
      ap.approach.push({ end: e.name, stations: stations.length });
    }
    D.traverse(function (o) { if (o.isMesh) o.userData.airfieldDressing = true; });
    return D;
  }

  if (CBZ.addLandmass) {
    CBZ.addLandmass(function (city) {
      while (pending.length) {
        const p = pending.shift();
        if (p.city !== city) continue;
        const B = p.ap.bounds;
        const pad = 800;
        const rect = { minX: B.minX - pad, maxX: B.maxX + pad, minZ: B.minZ - pad, maxZ: B.maxZ + pad };
        const run = function () { buildDressing(p.ap, p.spec, city); };
        if (CBZ.sliceAt) CBZ.sliceAt(rect, run, { name: "airfield-dressing:" + p.ap.id, pure: true });
        else run();
      }
    }, 96);
  }
  CBZ.airfieldDressingPending = function () { return pending.length; };
})();
