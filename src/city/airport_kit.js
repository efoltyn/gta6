/* ============================================================
   city/airport_kit.js — BUILD AN AIRFIELD ANYWHERE, FROM ONE SPEC.

   OWNER (2026-08-09): "package the airport so you can just duplicate and put
   it somewhere else easily without rewriting that code."

   systems/airports.js turned an airport into a RECORD with a frame. This file
   turns that record into GROUND: one call, `CBZ.buildAirfield(city, spec)`,
   and a field exists at any origin, on any bearing, with a runway you can
   land on, a taxiway that reaches it, stands with real parked airliners, a
   terminal with a kerb, a tower, a windsock and a fence.

   WHY IT IS NOT A COPY OF island_airport.js. Halloran Field is 3,977 lines
   because it is a HAND-DRESSED PLACE: a concourse you walk through, escalator
   links, a taxi rank, a jet bridge, an airliner mid-pushback, 12 seated
   travellers, a control-tower console with a controller behind it. None of
   that is what makes it an AIRPORT — it is what makes it Halloran. This kit
   authors only the airport: the surfaces, the markings, the lights, the
   stands, the shells. A second field built from it reads as a regional
   airport rather than as a photocopy of the international one, which is
   also the honest outcome.

   WHAT IT REUSES RATHER THAN RE-AUTHORS — the whole point:
     • THE AEROPLANES. `CBZ.airportKit.airliner/jet/boardable`, published by
       island_airport.js's own build. The parked fleet here is therefore the
       SAME airframe: same cabin, same seats, same pilots cast by npclife,
       same doors, same damage model, same hand-off to the player's flight
       physics. Not one vertex of aircraft geometry is authored in this file.
     • THE MATERIAL POOL (`CBZ.cmat`), the collider array (`CBZ.colliders`),
       the region/no-spawn/road registries, `CBZ.hash01` for anything random.
     • THE FRAME (`ap.toWorld`) — every number below is a LOCAL metre.

   DRAW-CALL DISCIPLINE: the whole field (grass, strip, runway, taxiway,
   apron, every marking) is ONE plane with one canvas and one shader; the
   edge lights are one stem mesh plus one lens mesh per colour; the fence is
   one post mesh, one wire mesh and one fabric mesh; the terminal, tower and
   counter are merged per material. A complete second airport costs a few
   dozen draw calls plus its parked aircraft. The parts themselves live in
   CBZ.airfieldParts (below), shared with Halloran.

   Flag: `AIRPORT_KIT_V1=false` → `CBZ.buildAirfield` returns null and any
   field that would have been built simply is not.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.AIRPORT_KIT_V1 == null) CFG.AIRPORT_KIT_V1 = true;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
  const mat = CBZ.mat || cmat;

  // The palette is island_airport.js's, read off its own constants so the two
  // fields are the same asphalt and the same paint.
  const C_GRASS = 0x54683f, C_TARMAC = 0x3c3f44, C_RUNWAY = 0x2c2f33;
  const C_WHITE = 0xdfe3e8, C_YELLOW = 0xd8b53a, C_TERM = 0xb9bfc6, C_GLASS = 0x2b3a4a;

  function hash01(x, z, s) {
    if (CBZ.hash01) return CBZ.hash01(x, z, s);
    const n = Math.sin(x * 127.1 + z * 311.7 + (s || 0) * 0.017) * 43758.5453;
    return n - Math.floor(n);
  }

  /* ==============================================================
     CBZ.airfieldParts — THE REAL HARDWARE, ONCE, FOR EVERY AIRFIELD.

     De-slop wave (2026-09-27). Both airfields were built out of the same
     three primitives: a flat-colour slab per surface, a 0.5 m glowing amber
     cube per "edge light", and a BoxGeometry per building. Halloran and Cape
     Harbor each carried their own copy of that. This block is the one place
     the real versions live, and both island_airport.js and the kit below
     build from it (island_airport.js's landmass builder runs at worldgen,
     long after this file has parsed, so the dependency is honest):

       surfaceMaterial  one plane, one canvas of layout + markings, and a
                        world-scale shader over it: 5 m concrete apron panels
                        with sealed joints, per-slab tint, oil and fuel drips;
                        asphalt aggregate and repair patches; tyre rubber in
                        the touchdown zones; worn paint; mown, patchy grass.
       edgeLights       elevated runway/taxiway fixtures (frangible stem,
                        base plate, lens) in their REAL colours: white runway
                        edge, green threshold, red end, blue taxiway edge.
                        Lenses are nearly dark by day and lit at night.
       fence            galvanised posts with barbed-wire outriggers, top
                        rail, and a see-through chain-link fabric (not the
                        tower glass it used to borrow).
       tower            octagonal concrete shaft with reveal bands, a
                        raked-glass cab with mullions, a deep roof, antenna
                        mast and obstruction light.
       jetBridge        rotunda, glazed telescoping tunnel, drive column on a
                        wheel bogie, cab with its bellows canopy.
       windsock         a striped fabric sock on a hinged frame and mast.
       cones            instanced traffic cones for the stands.

     Everything is merged per material (a few draws per part), uses no light
     objects, and returns plain meshes; colliders stay with the caller, who
     knows what is walkable.
     ============================================================== */
  const P = {};
  CBZ.airfieldParts = P;

  function BGU() { return THREE.BufferGeometryUtils; }
  function mergeGeos(geos) {
    const U = BGU();
    if (!geos.length || !U || !U.mergeBufferGeometries) return null;
    // mergeBufferGeometries refuses a mix of indexed and non-indexed input
    let idx = 0;
    for (const g of geos) if (g.index) idx++;
    if (idx && idx !== geos.length) {
      for (let i = 0; i < geos.length; i++) if (geos[i].index) geos[i] = geos[i].toNonIndexed();
    }
    return U.mergeBufferGeometries(geos);
  }
  // one mesh per material; falls back to loose meshes without the utils
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
  // swap: exchange U and V on every face (turns a board / rib pattern 90 deg).
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
  // rotate (z, x, y order) then translate: the only transform order used here
  function put(g, x, y, z, ry, rx, rz) {
    if (rz) g.rotateZ(rz);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    g.translate(x || 0, y || 0, z || 0);
    return g;
  }
  P.boxM = boxM; P.uvScale = uvScale; P.put = put;

  // A box from a to b (a thin member: rail, strut, stringer, cable).
  function member(ax, ay, az, bx, by, bz, t, tt) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz) || 0.001;
    const g = new THREE.BoxGeometry(t, tt == null ? t : tt, L);
    // local +z -> the member direction
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dx / L, dy / L, dz / L));
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
    g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    return g;
  }
  function tube(ax, ay, az, bx, by, bz, r, seg) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L = Math.hypot(dx, dy, dz) || 0.001;
    const g = new THREE.CylinderGeometry(r, r, L, seg || 6, 1, true);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
    g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    return g;
  }
  P.member = member; P.tube = tube;

  // ---- shared textured materials (built once, reused by every field) ----
  const _mats = new Map();
  function once(key, fn) { let m = _mats.get(key); if (!m) { m = fn(); if (m) m._shared = true; _mats.set(key, m); } return m; }
  // concrete / painted steel with the repo's baked surface maps (1 m tile;
  // callers author UVs in metres). Standard, so the normal map catches light.
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

  /* Canvas-built finishes the surface library does not carry. Each is ONE
     shared texture authored at 1 uv unit = 1 m (callers use boxM, which
     writes metre UVs), so nothing stretches. */
  function canvasTex(w, h, paint) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    paint(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, CBZ.renderer && CBZ.renderer.capabilities ? CBZ.renderer.capabilities.getMaxAnisotropy() : 1);
    return t;
  }
  // TIMBER DECKING: 140 mm boards with 8 mm gaps, each board its own tone,
  // grain streaks, the odd fixing pair. Boards run along V (their length),
  // so a walkway along X gets boards across it.
  P.deckMat = function (tint) {
    return once("deck|" + (tint || 0), function () {
      const tex = canvasTex(256, 256, function (x, W, H) {
        const n = 7, bw = W / n;             // 7 boards per metre: 0.143 m pitch
        for (let i = 0; i < n; i++) {
          const k = hash01(i * 7.3, 11, 401);
          const r = 150 + k * 40, g = 118 + k * 30, b = 80 + k * 22;
          x.fillStyle = "rgb(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + ")";
          x.fillRect(i * bw, 0, bw, H);
          x.globalAlpha = 0.18;
          for (let s = 0; s < 14; s++) {
            const sx = i * bw + 2 + hash01(i, s, 402) * (bw - 4);
            x.fillStyle = hash01(i, s, 403) > 0.5 ? "#4a3522" : "#e8d2ad";
            x.fillRect(sx, 0, 1, H);
          }
          x.globalAlpha = 0.5; x.fillStyle = "#2b2622";
          const fy = hash01(i, 9, 404) * H;
          x.fillRect(i * bw + bw * 0.25, fy, 2, 2); x.fillRect(i * bw + bw * 0.7, fy, 2, 2);
          x.globalAlpha = 1;
          x.fillStyle = "#1c1814";                // the gap
          x.fillRect(i * bw + bw - 2, 0, 2, H);
        }
      });
      return new THREE.MeshLambertMaterial({ color: tint || 0xffffff, map: tex });
    });
  };
  // CORRUGATED / TRAPEZOIDAL STEEL SHEET: ribs along V at 1/7 m pitch,
  // shaded as a profile so it reads under flat light too.
  P.corrugatedMat = function (tint) {
    return once("corr|" + tint, function () {
      const tex = canvasTex(112, 16, function (x, W, H) {
        for (let px = 0; px < W; px++) {
          const ph = (px % 16) / 16;
          // trapezoid: crest, web, trough, web
          let l = ph < 0.3 ? 1.0 : ph < 0.45 ? 0.72 : ph < 0.8 ? 0.86 : 0.62;
          const v = Math.round(200 * l);
          x.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
          x.fillRect(px, 0, 1, H);
        }
      });
      return new THREE.MeshStandardMaterial({ color: tint, map: tex, roughness: 0.55, metalness: 0.35, envMap: CBZ.ENV || null });
    });
  };
  P.steelMat = function (tint) { return surfMat("metal", tint == null ? 0xb8bec4 : tint, 0.55, 0.35); };
  P.glassMat = function (opacity) {
    return once("glass|" + (opacity || 0.45), function () {
      return CBZ.glass ? CBZ.glass({ opacity: opacity || 0.45, side: THREE.DoubleSide })
        : new THREE.MeshLambertMaterial({ color: 0x9fc7df, transparent: true, opacity: opacity || 0.45, side: THREE.DoubleSide });
    });
  };

  /* ---- NIGHT GLOW. Airfield lamps are LAMPS: dark lenses by day, lit at
     night. One slow updater drives every registered material off
     core/daynight.js's CBZ.nightAmount (0 day .. 1 night). A material whose
     world has been torn down is dropped the first time its root is seen
     detached. */
  const glow = [];
  let glowHooked = false, glowT = 0;
  P.glow = function (m, dayEi, nightEi, root) {
    if (!m) return m;
    m._afDay = dayEi; m._afNight = nightEi;
    m.emissiveIntensity = dayEi;
    glow.push({ m: m, root: root || null, seen: false });
    if (!glowHooked && CBZ.onUpdate) {
      glowHooked = true;
      CBZ.onUpdate(48.5, function (dt) {
        glowT -= dt || 0;
        if (glowT > 0) return;
        glowT = 0.5;
        const n = Math.max(0, Math.min(1, CBZ.nightAmount == null ? 0 : CBZ.nightAmount));
        for (let i = glow.length - 1; i >= 0; i--) {
          const e = glow[i];
          if (e.root) {
            if (e.root.parent) e.seen = true;
            else if (e.seen) { glow.splice(i, 1); continue; }
          }
          e.m.emissiveIntensity = e.m._afDay + (e.m._afNight - e.m._afDay) * n;
        }
      });
    }
    return m;
  };

  /* ---- THE SURFACE SHADER. The canvas carries layout and paint at ~3 px/m;
     this adds everything the canvas cannot hold at that density, in plane
     metres (vUv x plane size), so it rotates with a crooked field for free.
     Surface class is read from the canvas colour itself: green = grass,
     light grey = concrete, dark grey = asphalt, white/yellow = paint. */
  const AF_FRAG_PARS = [
    "varying vec3 vAfW;",
    "uniform vec2 afSize; uniform vec4 afRwy; uniform float afPanel; uniform vec4 afXf;",
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
    // the eye from viewMatrix: r128 never uploads cameraPosition to a
    // Lambert program (it reads 0,0,0), so the near grain never switched on
    "  float afD = length( vAfW + viewMatrix[3].xyz * mat3( viewMatrix ) );",
    "  float afNear = 1.0 - smoothstep( 50.0, 200.0, afD );",
    "  vec3 afC = diffuseColor.rgb;",
    // the map is decoded to linear albedo (painter.texture); the surface
    // class is still read off the PAINTED (display) colour it was keyed on
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
    // ---- concrete: slabs, sealed joints, per-slab tint, stains, drips
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
    // ---- asphalt: aggregate, mottle, the odd newer repair patch
    "  float afPc = afH( mod( floor( afLo / vec2( 4.5, 3.2 ) ), 289.0 ) + 11.0 );",
    "  float afAk = ( 1.0 + ( afF - 0.5 ) * 0.24 * afNear ) * ( 1.0 + ( afM - 0.5 ) * 0.10 ) * ( 1.0 + ( afB - 0.5 ) * 0.14 ) * ( afPc > 0.965 ? 0.84 : 1.0 );",
    // ---- grass: clumps + dry patches
    "  float afGk = ( 0.84 + 0.30 * afN( afP * 0.35 + 2.0 ) ) * ( 1.0 + ( afF - 0.5 ) * 0.26 * afNear );",
    "  float afDry = smoothstep( 0.55, 0.82, afB ) * 0.45 * afGr;",
    // ---- paint: scuffed and worn thin in places
    "  float afWr = smoothstep( 0.52, 0.88, afN( afP * 1.9 + 4.0 ) * 0.7 + afF * 0.3 );",
    "  float afPk = ( 1.0 - afWr * 0.26 ) * ( 1.0 + ( afF - 0.5 ) * 0.10 * afNear );",
    "  float afK = 1.0 + afCo * ( afCk - 1.0 ) + afAs * ( afAk - 1.0 ) + afGr * ( afGk - 1.0 ) + afPt * ( afPk - 1.0 );",
    "  afC = mix( afC, vec3( afLl * 1.22, afLl * 1.08, afLl * 0.62 ), afDry );",
    "  afC = mix( afC, afC * vec3( 0.90, 0.88, 0.84 ), afSt * afCo * 0.6 );",
    // ---- runway rubber: black tyre deposits down the wheel tracks of both touchdown zones
    "  float afIn = step( afRwy.x, afLo.x ) * step( afLo.x, afRwy.y ) * step( abs( afLo.y - afRwy.z ), afRwy.w );",
    "  float afDe = min( afLo.x - afRwy.x, afRwy.y - afLo.x );",
    "  float afTq = ( afDe - 200.0 ) / 150.0;",
    "  float afTz = exp( -afTq * afTq );",
    "  float afTr = 1.0 - smoothstep( afRwy.w * 0.12, afRwy.w * 0.55, abs( afLo.y - afRwy.z ) );",
    "  float afSk = afN( vec2( afLo.x * 0.03, afLo.y * 2.3 ) + 50.0 ) * 0.6 + afN( vec2( afLo.x * 0.18, afLo.y * 5.0 ) + 50.0 ) * 0.4;",
    "  float afRb = afIn * afTz * afTr * smoothstep( 0.30, 0.78, afSk );",
    "  afK *= 1.0 - afRb * 0.6;",
    "  diffuseColor.rgb = afC * afK;",
    "}",
  ].join("\n");
  /* surfaceMaterial(tex, W, D, opts): W/D = the plane's size in metres
     (plane metres run from its -x edge and its canvas-top / min-z edge).
     opts.frame = { ox, oz, yaw }: where the FIELD's local origin sits in
     plane metres and its bearing (three.js rotation.y), so the slab grid and
     the runway rubber follow a crooked field. opts.rwy = [x0, x1, zc, halfW]
     in that field-local frame. opts.panel = slab size (5 m). */
  P.surfaceMaterial = function (tex, W, D, opts) {
    opts = opts || {};
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex });
    const r = opts.rwy || [-1, -1, 0, 0];
    const fr = opts.frame || { ox: 0, oz: 0, yaw: 0 };
    const U = {
      afSize: { value: new THREE.Vector2(W, D) },
      afRwy: { value: new THREE.Vector4(r[0], r[1], r[2], r[3]) },
      afPanel: { value: opts.panel || 5 },
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
    m.customProgramCacheKey = function () { return "airfield-surface-v2"; };
    m.userData.afUniforms = U;
    return m;
  };

  /* ---- A PAINTER over one canvas. The canvas maps the plane (W x D metres)
     and `frame(ox, oz, yaw)` sets which coordinate system the drawing calls
     speak: world-minus-origin for an axis-aligned field (Halloran paints in
     WORLD metres with frame(-minX, -minZ, 0)), or a crooked field's own
     local metres. Every airfield paints its layout through this, so a line
     is a line at any resolution and any bearing. */
  P.painter = function (W, D, pxW, pxD) {
    const canvas = document.createElement("canvas");
    canvas.width = pxW; canvas.height = pxD;
    const ctx = canvas.getContext("2d");
    const sx = pxW / W, sz = pxD / D;
    let Fo = { ox: 0, oz: 0, c: 1, s: 0 };
    function css(c) { return "#" + (c >>> 0).toString(16).padStart(6, "0"); }
    function apply() { ctx.setTransform(sx * Fo.c, -sz * Fo.s, sx * Fo.s, sz * Fo.c, sx * Fo.ox, sz * Fo.oz); }
    const api = {
      canvas: canvas, ctx: ctx, sx: sx, sz: sz, css: css,
      frame: function (ox, oz, yaw) { Fo = { ox: ox || 0, oz: oz || 0, c: Math.cos(yaw || 0), s: Math.sin(yaw || 0) }; },
      fill: function (color) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = css(color); ctx.fillRect(0, 0, pxW, pxD);
      },
      // centre + size, frame metres (rot: extra rotation about the centre)
      rect: function (x, z, w, d, color, alpha, rot) {
        apply();
        if (alpha != null) ctx.globalAlpha = alpha;
        ctx.fillStyle = css(color);
        if (rot) { ctx.translate(x, z); ctx.rotate(rot); ctx.fillRect(-w / 2, -d / 2, w, d); }
        else ctx.fillRect(x - w / 2, z - d / 2, w, d);
        ctx.globalAlpha = 1;
      },
      // polyline of [x, z] points, width in metres, optional dash [on, off]
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
      // an arc (stand lead-in curves): centre, radius, a0 -> a1 (radians)
      arc: function (x, z, r, a0, a1, width, color) {
        apply();
        ctx.strokeStyle = css(color); ctx.lineWidth = width; ctx.lineCap = "butt";
        ctx.beginPath(); ctx.arc(x, z, r, a0, a1, a1 < a0); ctx.stroke();
      },
      // painted letters, cap height in metres; widthM stretches to a width
      text: function (str, x, z, sizeM, rot, color, widthM) {
        apply();
        ctx.translate(x, z);
        ctx.rotate(rot || 0);
        const K = 32;                        // author letters at 32 units per metre
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
        // the canvas is painted in sRGB display colours; decoded, the infield
        // is grass (it was pale mint) and the runway asphalt (light grey)
        if (CBZ.groundLinear) CBZ.groundLinear(tex);
        return tex;
      },
    };
    return api;
  };

  /* ---- ELEVATED EDGE LIGHTS. pts: [x, z, kind] with kind one of
     w (runway edge, white) g (threshold, green) r (runway end, red)
     b (taxiway edge, blue) y (amber). One stem mesh + one lens mesh per
     colour, all instanced. */
  const LENS = { w: 0xfff1d2, g: 0x46ff84, r: 0xff3b2e, b: 0x3f7dff, y: 0xffb648 };
  P.edgeLights = function (parent, pts, root) {
    const grp = new THREE.Group();
    grp.name = "airfield-edge-lights";
    const stemG = mergeGeos([
      put(new THREE.CylinderGeometry(0.11, 0.12, 0.035, 10), 0, 0.017, 0),           // base plate
      put(new THREE.CylinderGeometry(0.028, 0.04, 0.26, 6, 1, true), 0, 0.16, 0),     // frangible stem
      put(new THREE.CylinderGeometry(0.075, 0.06, 0.05, 10), 0, 0.30, 0),            // lamp housing
    ]) || new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6);
    const lensG = new THREE.SphereGeometry(0.068, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    lensG.translate(0, 0.325, 0);
    const d = new THREE.Object3D();
    const stems = new THREE.InstancedMesh(stemG, cmat(0xd9b43c), pts.length);
    stems.castShadow = false; stems.receiveShadow = false;
    const byKind = {};
    for (let i = 0; i < pts.length; i++) {
      d.position.set(pts[i][0], 0.08, pts[i][1]); d.updateMatrix();
      stems.setMatrixAt(i, d.matrix);
      const k = LENS[pts[i][2]] ? pts[i][2] : "w";
      (byKind[k] = byKind[k] || []).push(d.matrix.clone());
    }
    stems.instanceMatrix.needsUpdate = true;
    grp.add(stems);
    for (const k in byKind) {
      const list = byKind[k];
      const lm = P.glow(mat(LENS[k], { emissive: LENS[k], ei: 0.12 }), 0.12, 1.25, root || parent);
      lm.color.multiplyScalar(0.55);
      const im = new THREE.InstancedMesh(lensG, lm, list.length);
      im.castShadow = false; im.receiveShadow = false;
      for (let i = 0; i < list.length; i++) im.setMatrixAt(i, list[i]);
      im.instanceMatrix.needsUpdate = true;
      grp.add(im);
    }
    parent.add(grp);
    return grp;
  };

  /* ---- CHAIN-LINK FENCE. runs: [x0, z0, x1, z1]; opts.center (x, z) is the
     field side, so the barbed-wire outriggers lean AWAY from it. */
  let _chainTex = null;
  function chainTex() {
    if (_chainTex) return _chainTex;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    x.clearRect(0, 0, 128, 128);
    x.strokeStyle = "rgba(255,255,255,1)";
    x.lineWidth = 2.2;
    const n = 8, s = 128 / n;
    for (let i = -n; i <= n * 2; i++) {
      x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s + 128, 128); x.stroke();
      x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s - 128, 128); x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(4, CBZ.renderer && CBZ.renderer.capabilities ? CBZ.renderer.capabilities.getMaxAnisotropy() : 1);
    _chainTex = t;
    return t;
  }
  P.fence = function (parent, runs, opts) {
    opts = opts || {};
    const H = opts.height || 2.4, STEP = opts.step || 3.0, TILE = 0.5;
    const cx = opts.center ? opts.center.x : 0, cz = opts.center ? opts.center.z : 0;
    const postG = mergeGeos([
      put(new THREE.CylinderGeometry(0.03, 0.03, H, 6, 1, true), 0, H / 2, 0),
      put(new THREE.CylinderGeometry(0.036, 0.036, 0.05, 6), 0, H + 0.02, 0),              // cap
      member(0, H - 0.02, 0, 0, H + 0.42, 0.40, 0.035, 0.035),                             // 45 degree outrigger
    ]);
    const posts = [];
    const wire = [], fabric = [];
    for (const r of runs) {
      const x0 = r[0], z0 = r[1], x1 = r[2], z1 = r[3];
      const L = Math.hypot(x1 - x0, z1 - z0);
      if (L < 0.5) continue;
      const ux = (x1 - x0) / L, uz = (z1 - z0) / L;
      // outward normal: away from the field centre
      let nx = -uz, nz = ux;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
      const yaw = Math.atan2(nx, nz);            // local +z -> outward
      const n = Math.max(1, Math.round(L / STEP));
      for (let i = 0; i <= n; i++) posts.push([x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n, yaw]);
      // top rail + bottom tension wire + three barbed strands on the outriggers
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
    if (posts.length && postG) {
      const im = new THREE.InstancedMesh(postG, P.steelMat(0xa7adb2), posts.length);
      const d = new THREE.Object3D();
      for (let i = 0; i < posts.length; i++) {
        d.position.set(posts[i][0], 0, posts[i][1]); d.rotation.set(0, posts[i][2], 0); d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = false;
      grp.add(im);
    }
    addMerged(grp, wire, cmat(0x8e9499), { cast: false });
    const fm = once("chainlink", function () {
      return new THREE.MeshLambertMaterial({
        color: 0xb9c0c5, map: chainTex(), transparent: true, alphaTest: 0.03,
        depthWrite: false, side: THREE.DoubleSide,
      });
    });
    addMerged(grp, fabric, fm, { cast: false, receive: false, name: "chain-link" });
    parent.add(grp);
    return grp;
  };

  /* ---- CONTROL TOWER (visual). o: { H: cab floor height, apothem: shaft
     half-width, cabHalf: cab half-width, cabH: glass height, door: true for a
     door on the +z face, drum: equipment level under the cab }. */
  P.tower = function (parent, x, z, o, root) {
    o = o || {};
    const H = o.H || 30, A = o.apothem || 2.2, CH = o.cabH || 3.0;
    const CHF = o.cabHalf || 4.2;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.name = "control-tower";
    const conc = [], dark = [], steel = [], glassG = [];
    const R8 = A / Math.cos(Math.PI / 8), side = 2 * A * Math.tan(Math.PI / 8);
    // shaft: octagon with flats on the axes, slightly battered
    const shaft = new THREE.CylinderGeometry(R8 * 0.94, R8, H, 8, 1, true);
    shaft.rotateY(Math.PI / 8);
    uvScale(shaft, side * 8 / 2, H / 2);
    shaft.translate(0, H / 2, 0);
    conc.push(shaft);
    // reveal bands every 3.5 m (the pour lifts) — dark recessed rings
    for (let y = 3.5; y < H - 1; y += 3.5) {
      const t = y / H, r = R8 * (1 - 0.06 * t) + 0.02;
      const b = new THREE.CylinderGeometry(r, r, 0.06, 8, 1, true);
      b.rotateY(Math.PI / 8); b.translate(0, y, 0);
      dark.push(b);
    }
    // plinth (not where a stair starts at the foot of the shaft)
    if (o.plinth !== false) {
      const pl = new THREE.CylinderGeometry(R8 + 0.25, R8 + 0.3, 0.5, 8);
      pl.rotateY(Math.PI / 8); uvScale(pl, 8, 1); pl.translate(0, 0.25, 0);
      conc.push(pl);
    }
    if (o.slot) {
      // a vertical stair-core window strip on the -z face
      glassG.push(put(new THREE.BoxGeometry(0.7, H - 8, 0.06), 0, (H - 8) / 2 + 4, -A * 0.99 + 0.02));
    }
    if (o.drum) {
      // the equipment level under the cab: wider, with a band of louvres
      const dr = R8 + 1.3;
      const drum = new THREE.CylinderGeometry(dr, R8 * 0.94, 2.6, 8, 1, true);
      drum.rotateY(Math.PI / 8); uvScale(drum, 20, 2); drum.translate(0, H - 1.3, 0);
      conc.push(drum);
      const lv = new THREE.CylinderGeometry(dr + 0.02, dr + 0.02, 0.8, 8, 1, true);
      lv.rotateY(Math.PI / 8); lv.translate(0, H - 1.1, 0);
      dark.push(lv);
    }
    // cab floor slab + sill band — cut round a stair well when the caller
    // brings one up through it (o.floorHole, local x/z)
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
    // the sill: four upstand walls (seen from inside the cab too)
    for (const sg of [-1, 1]) {
      steel.push(put(boxM(CHF * 2, 0.9, 0.12, 1), 0, H + 0.45, sg * (CHF - 0.06)));
      steel.push(put(boxM(0.12, 0.9, CHF * 2 - 0.24, 1), sg * (CHF - 0.06), H + 0.45, 0));
    }
    // raked glazing: a square frustum leaning out 10 degrees, open top/bottom
    const r0 = CHF * Math.SQRT2, lean = Math.tan(10 * Math.PI / 180) * (CH - 0.9);
    const gl = new THREE.CylinderGeometry(r0 + lean * Math.SQRT2, r0, CH - 0.9, 4, 1, true);
    gl.rotateY(Math.PI / 4); gl.translate(0, H + 0.9 + (CH - 0.9) / 2, 0);
    glassG.push(gl);
    // mullions: corners + two per face, leaning with the glass
    const yA = H + 0.9, yB = H + CH;
    const eA = CHF, eB = CHF + lean;
    for (let s = 0; s < 4; s++) {
      const ang = s * Math.PI / 2;
      const c = Math.cos(ang), sn = Math.sin(ang);
      for (const f of [-1, -1 / 3, 1 / 3]) {
        // point on the face: normal (c, sn), tangent (-sn, c)
        const ax = c * eA + (-sn) * eA * f, az = sn * eA + c * eA * f;
        const bx = c * eB + (-sn) * eB * f, bz = sn * eB + c * eB * f;
        dark.push(member(ax, yA, az, bx, yB, bz, 0.09, 0.09));
      }
    }
    // roof: deep overhanging slab + fascia + roof plant
    const RW = (CHF + lean) * 2 + 1.4;
    dark.push(put(boxM(RW, 0.55, RW, 1), 0, yB + 0.27, 0));
    steel.push(put(boxM(RW - 0.6, 0.3, RW - 0.6, 1), 0, yB + 0.7, 0));
    steel.push(put(boxM(1.6, 0.9, 1.1, 1), -CHF * 0.4, yB + 1.3, CHF * 0.3));       // plant box
    // antenna mast + radome
    steel.push(put(new THREE.CylinderGeometry(0.06, 0.09, 5.0, 6), CHF * 0.35, yB + 3.3, -CHF * 0.35));
    steel.push(put(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 4), CHF * 0.35, yB + 4.6, -CHF * 0.35, 0, 0, Math.PI / 2));
    steel.push(put(new THREE.SphereGeometry(0.55, 10, 6), -CHF * 0.3, yB + 1.3, -CHF * 0.4));
    addMerged(g, conc, P.concreteMat(o.tint), { cast: true });
    addMerged(g, dark, cmat(0x2c3238), { cast: true });
    addMerged(g, steel, P.steelMat(0xc3c8cc), { cast: true });
    addMerged(g, glassG, P.glassMat(0.42), { cast: false, receive: false });
    // obstruction light at the mast tip — a lamp, so it follows the night
    const ob = P.glow(mat(0xd83a2c, { emissive: 0xff3a2a, ei: 0.25 }), 0.25, 1.4, root || parent);
    const obm = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), ob);
    obm.position.set(CHF * 0.35, yB + 5.9, -CHF * 0.35);
    g.add(obm);
    parent.add(g);
    return { group: g, roofY: yB + 0.55, glassY0: yA, glassY1: yB };
  };

  /* ---- JET BRIDGE (apron-drive). Built along -z from a terminal wall at
     zWall (the rotunda hangs on it) to a cab whose front face is at zHead.
     o: { floor: tunnel floor height (underside ~0.2 below), zCol: drive
     column position }. Returns { group, col: {x, z, w, d, h} } — the one
     footprint that stands on the ground, for the caller's collider. */
  P.jetBridge = function (parent, x, zWall, zHead, o) {
    o = o || {};
    const F0 = o.floor || 2.55, TH = 2.7, TW = 2.7;
    const zCol = o.zCol != null ? o.zCol : (zHead + 3.2);
    const g = new THREE.Group();
    g.name = "jet-bridge";
    const skin = [], dark = [], rubber = [], glassG = [], conc = [];
    // rotunda: a drum hung on the wall, with its bracket
    const rz = zWall - 1.5;
    skin.push(put(new THREE.CylinderGeometry(1.5, 1.5, TH + 0.3, 16), x, F0 + TH / 2, rz));
    dark.push(put(new THREE.CylinderGeometry(1.56, 1.56, 0.25, 16), x, F0 + TH + 0.25, rz));
    dark.push(put(new THREE.BoxGeometry(2.4, 0.4, 1.2), x, F0 - 0.1, zWall - 0.6));
    // two telescoping sections: the inner (rotunda side) and the outer, a
    // size larger, sliding over it. Floor slopes gently to the cab.
    const zA = rz - 1.2, zB = zHead + 2.7;
    const zMid = (zA + zB) / 2 + 0.6;
    const sect = [[zA, zMid - 1.0, TW, TH], [zMid, zB, TW + 0.24, TH + 0.2]];
    for (const s of sect) {
      const za = s[0], zb = s[1], w = s[2], h = s[3], L = za - zb, cz = (za + zb) / 2;
      skin.push(put(boxM(w, 0.22, L, 1), x, F0 - 0.11, cz));                    // floor pan
      skin.push(put(boxM(w + 0.1, 0.18, L, 1), x, F0 + h - 0.09, cz));          // roof
      for (const sg of [-1, 1]) {
        skin.push(put(boxM(0.08, 0.95, L, 1), x + sg * w / 2, F0 + 0.47, cz)); // lower wall
        skin.push(put(boxM(0.08, 0.5, L, 1), x + sg * w / 2, F0 + h - 0.43, cz)); // upper spandrel
        glassG.push(put(new THREE.BoxGeometry(0.04, h - 1.63, L), x + sg * w / 2, F0 + 0.95 + (h - 1.63) / 2, cz));
        // mullion ribs every 1.2 m
        for (let zz = zb + 0.3; zz < za - 0.2; zz += 1.2) dark.push(put(new THREE.BoxGeometry(0.1, h, 0.08), x + sg * (w / 2 + 0.03), F0 + h / 2 - 0.05, zz));
      }
      // stiffening rings where a section starts
      dark.push(put(new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.14), x, F0 + h / 2 - 0.05, zb + 0.07));
    }
    // drive column: two legs from a cross-head under the outer section down
    // to the wheel bogie, with the lift rams alongside
    const legH = F0 - 0.2;
    dark.push(put(new THREE.BoxGeometry(2.3, 0.35, 0.6), x, legH, zCol));
    for (const sg of [-1, 1]) {
      skin.push(put(boxM(0.32, legH - 0.9, 0.32, 1), x + sg * 0.85, 0.9 + (legH - 0.9) / 2, zCol));
      dark.push(put(new THREE.CylinderGeometry(0.07, 0.07, legH - 1.1, 8), x + sg * 0.55, 1.0 + (legH - 1.1) / 2, zCol + 0.05));
    }
    dark.push(put(new THREE.BoxGeometry(2.6, 0.45, 0.7), x, 0.75, zCol));           // bogie beam
    for (const sg of [-1, 1]) {
      rubber.push(put(new THREE.CylinderGeometry(0.46, 0.46, 0.36, 14), x + sg * 1.05, 0.46, zCol, 0, 0, Math.PI / 2));
      dark.push(put(new THREE.CylinderGeometry(0.2, 0.2, 0.38, 10), x + sg * 1.05, 0.46, zCol, 0, 0, Math.PI / 2));
    }
    // the cab: wider than the tunnel, glazed to the side, a bellows canopy
    // on its face and the leveller wheel under the sill
    const cw = TW + 1.0, ch = TH + 0.3, cd = 2.5, cz = zHead + cd / 2 + 0.35;
    skin.push(put(boxM(cw, 0.25, cd, 1), x, F0 - 0.12, cz));
    skin.push(put(boxM(cw + 0.1, 0.2, cd, 1), x, F0 + ch - 0.1, cz));
    for (const sg of [-1, 1]) {
      skin.push(put(boxM(0.08, 1.0, cd, 1), x + sg * cw / 2, F0 + 0.5, cz));
      glassG.push(put(new THREE.BoxGeometry(0.04, ch - 1.3, cd), x + sg * cw / 2, F0 + 1.0 + (ch - 1.3) / 2, cz));
    }
    skin.push(put(boxM(cw, ch, 0.08, 1), x, F0 + ch / 2, cz + cd / 2));
    // bellows: three dark concertina hoops stepping out to the aircraft face
    for (let i = 0; i < 3; i++) {
      const zz = zHead + 0.3 - i * 0.1, grow = 0.08 * i;
      rubber.push(put(new THREE.BoxGeometry(TW + 0.5 + grow, 0.16, 0.12), x, F0 + ch + 0.05 + grow / 2, zz));
      for (const sg of [-1, 1]) rubber.push(put(new THREE.BoxGeometry(0.16, ch + grow, 0.12), x + sg * (TW + 0.5 + grow) / 2, F0 + ch / 2, zz));
    }
    rubber.push(put(new THREE.BoxGeometry(TW + 0.6, 0.12, 0.35), x, F0 - 0.05, zHead + 0.18));   // bumper sill
    dark.push(put(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 10), x + 0.9, F0 - 0.3, zHead + 0.5, 0, 0, Math.PI / 2));
    addMerged(g, skin, P.steelMat(o.tint == null ? 0xd5d9dd : o.tint), { cast: true });
    addMerged(g, dark, cmat(0x3a4046), { cast: true });
    addMerged(g, rubber, cmat(0x1b1d20), { cast: true });
    addMerged(g, glassG, P.glassMat(0.5), { cast: false, receive: false });
    if (conc.length) addMerged(g, conc, P.concreteMat(), {});
    parent.add(g);
    return { group: g, col: { x: x, z: zCol, w: 2.9, d: 1.0, h: legH } };
  };

  /* ---- WINDSOCK: mast, hinged frame ring, striped orange/white sock. */
  let _sockTex = null;
  P.windsock = function (parent, x, z, yaw) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw || 0;
    const steel = [];
    steel.push(put(new THREE.CylinderGeometry(0.07, 0.1, 6.0, 8), 0, 3.0, 0));
    steel.push(put(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 10), 0, 0.06, 0));
    steel.push(put(new THREE.TorusGeometry(0.42, 0.025, 5, 16), 0.1, 5.9, 0, Math.PI / 2));
    steel.push(member(0, 5.9, 0, 0.1, 5.9, 0, 0.04));
    addMerged(g, steel, cmat(0xdcdfe2), { cast: true });
    if (!_sockTex) {
      const c = document.createElement("canvas");
      c.width = 8; c.height = 64;
      const x2 = c.getContext("2d");
      for (let i = 0; i < 5; i++) { x2.fillStyle = i % 2 ? "#f1efe8" : "#e8631f"; x2.fillRect(0, i * 64 / 5, 8, 64 / 5 + 1); }
      _sockTex = new THREE.CanvasTexture(c);
    }
    const sm = once("windsock", function () { return new THREE.MeshLambertMaterial({ map: _sockTex, side: THREE.DoubleSide }); });
    // a tapered open cone from the ring, drooping a little in a light breeze
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.18, 3.4, 12, 1, true), sm);
    sock.rotation.z = Math.PI / 2 - 0.22;
    sock.position.set(0.1 + 1.66, 5.9 - 0.37, 0);
    sock.castShadow = true;
    g.add(sock);
    parent.add(g);
    return g;
  };

  /* ---- TRAFFIC CONES: instanced, orange with the two reflective bands. */
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
    const d = new THREE.Object3D();
    const out = [];
    for (const spec of [[body, 0xf0561c], [base, 0x1d1f22], [bands, 0xeef0f2]]) {
      if (!spec[0]) continue;
      const im = new THREE.InstancedMesh(spec[0], cmat(spec[1]), pts.length);
      for (let i = 0; i < pts.length; i++) { d.position.set(pts[i][0], 0.08, pts[i][1]); d.updateMatrix(); im.setMatrixAt(i, d.matrix); }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = false;
      parent.add(im);
      out.push(im);
    }
    return out;
  };

  /* ==============================================================
     BUILD. `spec` is the airports.js registration spec plus the few
     numbers that only matter to geometry (how many stands, whether
     the field gets a tower). The airport RECORD is registered here
     so a caller never has to make two calls that can disagree.
     ============================================================== */
  CBZ.buildAirfield = function (city, spec) {
    if (!city || !spec || CFG.AIRPORT_KIT_V1 === false) return null;
    const root = city.root;
    if (!root || !CBZ.registerAirport) return null;

    const ap = CBZ.registerAirport(spec);
    if (!ap) return null;
    ap.builtBy = "airport_kit";

    const B = ap.bounds;
    const H = ap.runway.len / 2, RW = ap.runway.w;
    const TAXI_W = 23, APRON_D = 74;

    // ---- (1) THE GROUND. ONE plane, axis-aligned and exactly the registered
    //      bounds (so the walkable region, the no-spawn rect and the ground
    //      you stand on are the SAME rectangle), carrying the WHOLE field as
    //      paint: strip, runway, shoulders, blast pads, taxiway, connectors,
    //      apron and every marking. The painter speaks the field's own local
    //      metres through its frame, so the crooked runway is drawn crooked
    //      on a straight plane. This replaces eight stacked slabs at 0.02 ..
    //      0.075 m, several of them COPLANAR (apron / taxiway / connectors all
    //      at 0.045) — the regional field z-fought wherever two of them met.
    const PW = B.maxX - B.minX, PD = B.maxZ - B.minZ;
    const PAINT = P.painter(PW, PD, 2048, 1024);
    PAINT.frame(ap.x - B.minX, ap.z - B.minZ, ap.yaw);
    const C_GRASS2 = 0x56713f, C_STRIP = 0x5d7444, C_SHOULDER = 0x3a3d40;
    const C_CONCRETE = 0x8f8d87, C_RED = 0xb8322a;
    const gatesMidX = ap.gates.length ? (ap.gates[0].lx + ap.gates[ap.gates.length - 1].lx) / 2 : 0;
    const apronW = Math.max(160, ap.gates.length * 62 + 60);
    const apronCZ = (ap.taxiZ + ap.termZ) / 2;
    // the apron runs east past the terminal far enough to hold the two
    // business jets parked below, which used to sit on the grass beyond it
    const apronX0 = gatesMidX - apronW / 2, apronX1 = gatesMidX + apronW / 2 + 42;
    const termW = Math.max(90, apronW * 0.72), termCX = gatesMidX;
    const termX0 = termCX - termW / 2, termX1 = termCX + termW / 2;
    // THE TERMINAL STOPS SHORT OF THE KERB. The check-in counter sits at
    // desk.lz (+1.3) with its agent behind it at +2.6; the old 22 m box ran
    // to termZ + 11 and swallowed the counter, the agent and the queue side
    // of it whole. The hall now ends 3 m short of the counter's queue line,
    // and the counter stands outside under the landside canopy, reachable.
    const termZ0 = ap.termZ - 11;
    const termZ1 = ap.desk ? Math.min(ap.termZ + 11, ap.desk.lz - 2) : ap.termZ + 11;
    const termD = termZ1 - termZ0, termCZ = (termZ0 + termZ1) / 2;
    {
      PAINT.fill(C_GRASS2);
      // mowing bands across the whole plot (world axes: they are the mower's)
      for (let i = 0; i < 40; i++) PAINT.rect(0, -300 + i * 28, 2 * H + 400, 14, 0x86a56a, 0.07);
      PAINT.rect(0, 0, 2 * H + 60, RW + 40, C_STRIP);                       // graded strip
      PAINT.rect(0, 0, 2 * H + 60, RW + 12, C_SHOULDER);                    // paved shoulders + blast pads
      PAINT.rect(0, 0, 2 * H, RW, C_RUNWAY);                                // the runway
      PAINT.rect(0, ap.taxiZ, 2 * H - 90, TAXI_W, C_TARMAC);                // parallel taxiway
      const CONN = ap.connectors && ap.connectors.length ? ap.connectors : [-H + 45, 0, H - 45];
      ap.connectors = CONN;
      for (const cx of CONN) {
        PAINT.rect(cx, ap.taxiZ / 2, TAXI_W, ap.taxiZ, C_TARMAC);
        // fillets where the connector meets each pavement
        for (const zz of [RW / 2, ap.taxiZ - TAXI_W / 2]) PAINT.rect(cx, zz, TAXI_W + 14, 8, C_TARMAC);
      }
      PAINT.rect((apronX0 + apronX1) / 2, apronCZ, apronX1 - apronX0, APRON_D, C_CONCRETE);
      // landside: a concrete footway along the hall and the asphalt forecourt
      PAINT.rect(termCX, termZ1 + 2.5, termW + 40, 5, 0xa8a59e);
      PAINT.rect(termCX, ap.kerbZ + 4, termW + 60, 14, 0x45484c);

      // ---- runway markings (ICAO cadence at this runway's width) ----
      PAINT.line([[-H + 60, 0], [H - 60, 0]], 0.9, C_WHITE, [30, 20]);
      for (const s of [-1, 1]) PAINT.line([[-H + 2, s * (RW / 2 - 1)], [H - 2, s * (RW / 2 - 1)]], 0.9, C_WHITE);
      for (const e of ap.ends) {
        const sg = e.sign;
        // piano keys: four each side of a centre gap, 30 m long
        for (let k = 0; k < 4; k++) for (const s of [-1, 1]) {
          PAINT.rect(sg * (H - 21), s * (2.2 + k * 3.4), 30, 1.8, C_WHITE);
        }
        // designator, read from the approach
        PAINT.text(e.name, sg * (H - 52), 0, 9, sg < 0 ? Math.PI / 2 : -Math.PI / 2, C_WHITE, 7.5);
        // aiming point + a touchdown-zone pair
        for (const s of [-1, 1]) {
          PAINT.rect(sg * (H - ap.runway.tdz), s * 7.5, 40, 4, C_WHITE);
          for (const k of [0, 1]) PAINT.rect(sg * (H - ap.runway.tdz - 150), s * (6 + k * 2.4), 22, 1.5, C_WHITE);
        }
        // blast pad chevrons beyond the threshold (yellow, pointing at it)
        for (let k = 0; k < 3; k++) {
          const x0 = sg * (H + 6 + k * 8);
          for (const s of [-1, 1]) PAINT.line([[x0 + sg * 6, s * (RW / 2 - 2)], [x0, 0]], 1.0, C_YELLOW);
        }
        // runway end bar
        PAINT.rect(sg * (H - 0.6), 0, 1.2, RW, C_WHITE);
      }
      // ---- taxiway paint ----
      PAINT.line([[-H + 45, ap.taxiZ], [H - 45, ap.taxiZ]], 0.45, C_YELLOW);
      for (const cx of CONN) {
        PAINT.line([[cx, ap.taxiZ], [cx, RW / 2 + 1]], 0.45, C_YELLOW);
        // runway-holding position: two solid + two dashed bars (solid side
        // toward the taxiway, the side you hold on)
        const hz = RW / 2 + 22;
        PAINT.line([[cx - TAXI_W / 2, hz + 1.8], [cx + TAXI_W / 2, hz + 1.8]], 0.4, C_YELLOW);
        PAINT.line([[cx - TAXI_W / 2, hz + 0.9], [cx + TAXI_W / 2, hz + 0.9]], 0.4, C_YELLOW);
        PAINT.line([[cx - TAXI_W / 2, hz], [cx + TAXI_W / 2, hz]], 0.4, C_YELLOW, [2, 1.5]);
        PAINT.line([[cx - TAXI_W / 2, hz - 0.9], [cx + TAXI_W / 2, hz - 0.9]], 0.4, C_YELLOW, [2, 1.5]);
      }
      // ---- stands: lead-in, stop bar, stand number, wingtip clearance ----
      const nb = ap.gates.length;
      for (let i = 0; i < nb; i++) {
        const g = ap.gates[i];
        const into = g.lz > ap.taxiZ ? 1 : -1;
        PAINT.line([[g.lx, ap.taxiZ], [g.lx, g.lz + into * 24]], 0.4, C_YELLOW);
        PAINT.rect(g.lx, g.lz + into * 24, 7, 0.5, C_YELLOW);
        const num = String(g.id || (i + 1)).replace(/^.*?(\d+)$/, "$1");
        PAINT.text(num, g.lx + 6, g.lz - into * 12, 4, into > 0 ? Math.PI : 0, C_YELLOW);
        if (i < nb - 1) {
          const mx = (g.lx + ap.gates[i + 1].lx) / 2;
          PAINT.line([[mx, ap.taxiZ + TAXI_W / 2 + 4], [mx, apronCZ + APRON_D / 2 - 5]], 0.35, C_RED, [3, 3]);
        }
      }
      // equipment restraint line along the head of the stands
      PAINT.line([[apronX0 + 4, apronCZ + APRON_D / 2 - 6], [apronX1 - 4, apronCZ + APRON_D / 2 - 6]], 0.35, C_RED);
      // apron service road between the restraint line and the hall
      for (const zz of [apronCZ + APRON_D / 2 - 5, apronCZ + APRON_D / 2 - 0.6]) {
        PAINT.line([[apronX0 + 2, zz], [apronX1 - 2, zz]], 0.3, C_WHITE, zz > apronCZ + APRON_D / 2 - 2 ? null : [4, 3]);
      }
      const tex = PAINT.texture();
      const g = new THREE.PlaneGeometry(PW, PD);
      g.rotateX(-Math.PI / 2);
      g.translate((B.minX + B.maxX) / 2, 0.03, (B.minZ + B.maxZ) / 2);
      const sm = P.surfaceMaterial(tex, PW, PD, {
        frame: { ox: ap.x - B.minX, oz: ap.z - B.minZ, yaw: ap.yaw },
        rwy: [-H, H, 0, RW / 2], panel: 5,
      });
      const m = new THREE.Mesh(g, sm);
      m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
      m.userData.terrain = true; m.userData.worldSurface = true;
      m.userData.surfaceOwner = "airfield:" + ap.id; m.userData.unifiedSurface = true;
      m.name = "airfield-surface:" + ap.id;
      root.add(m);
    }

    // ---- (2) THE FIELD GROUP. Everything from here down is authored in LOCAL
    //      metres; the group carries the origin and the bearing. This is the
    //      packaging: move the spec, and every surface below moves with it.
    const F = new THREE.Group();
    F.position.set(ap.x, 0, ap.z);
    F.rotation.y = ap.yaw;
    F.name = "airfield:" + ap.id;
    root.add(F);
    ap.group = F;

    // A world collider for a local-metre footprint. The engine's colliders are
    // axis-aligned, so a rotated footprint gets the extent of its rotated box
    // — never smaller than the thing itself.
    function solidLocal(lx, lz, w, d, y0, y1, ref) {
      const c = Math.abs(ap._c), s = Math.abs(ap._s);
      const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
      const wp = ap.toWorld(lx, lz);
      const col = { minX: wp.x - hw, maxX: wp.x + hw, minZ: wp.z - hd, maxZ: wp.z + hd, y0: y0, y1: y1, ref: ref || null };
      CBZ.colliders.push(col);
      return col;
    }

    // ---- (3) LIGHTS — elevated fixtures in their real colours -------------
    {
      const pts = [];
      for (let x = -H; x <= H + 0.1; x += 60) pts.push([x, -RW / 2 - 1.5, "w"], [x, RW / 2 + 1.5, "w"]);
      for (const e of ap.ends) {
        for (let k = -3; k <= 3; k++) {
          pts.push([e.sign * (H + 1.5), k * (RW / 7), "g"]);
          pts.push([e.sign * (H - 0.8), k * (RW / 7) + RW / 14, "r"]);
        }
      }
      // taxiway edge: the runway side only (the apron side is pavement to pavement)
      const CONN = ap.connectors;
      for (let x = -H + 50; x <= H - 50; x += 30) {
        let clear = true;
        for (const cx of CONN) if (Math.abs(x - cx) < TAXI_W / 2 + 6) clear = false;
        if (clear) pts.push([x, ap.taxiZ - TAXI_W / 2 - 1.2, "b"]);
      }
      for (const cx of CONN) for (const s of [-1, 1]) {
        for (let z = RW / 2 + 8; z < ap.taxiZ - TAXI_W / 2; z += 12) pts.push([cx + s * (TAXI_W / 2 + 1.2), z, "b"]);
      }
      const lg = P.edgeLights(F, pts, root);
      lg.name = "airfield-lights:" + ap.id;
    }

    // ---- (4) THE TERMINAL: a glazed regional hall, not a grey box ---------
    {
      const T = new THREE.Group();
      T.name = "terminal:" + ap.id;
      F.add(T);
      const HALL_H = 8.2, ROOF_T = 0.7;
      const frame = [], glassG = [], clad = [], roof = [], core = [], strips = [], dark = [];
      // the interior volume behind the glass (the hall is not walkable; its
      // glass reads as a lit hall with depth instead of a mirror on a box)
      core.push(P.put(new THREE.BoxGeometry(termW - 2.4, HALL_H - 0.4, termD - 2.4), termCX, (HALL_H - 0.4) / 2, termCZ));
      // curtain walls on both long faces: 1.5 m bays, transoms at 3.2 / 6.4
      const BAY = 1.5;
      for (const sz of [termZ0, termZ1]) {
        const out = sz === termZ0 ? -1 : 1;
        glassG.push(P.put(new THREE.BoxGeometry(termW - 1.2, HALL_H - 0.5, 0.04), termCX, (HALL_H - 0.5) / 2 + 0.25, sz));
        const nb = Math.round((termW - 1.2) / BAY);
        for (let i = 0; i <= nb; i++) {
          const x = termX0 + 0.6 + i * ((termW - 1.2) / nb);
          frame.push(P.put(new THREE.BoxGeometry(0.08, HALL_H - 0.25, 0.18), x, (HALL_H - 0.25) / 2, sz + out * 0.05));
        }
        for (const y of [0.12, 3.2, 6.4]) frame.push(P.put(new THREE.BoxGeometry(termW - 1.2, 0.12, 0.2), termCX, y, sz + out * 0.05));
        // entrance doors: two dark door-sets per face, with a canopy lip
        for (const dx of [-termW * 0.22, termW * 0.22]) {
          dark.push(P.put(new THREE.BoxGeometry(4.2, 2.5, 0.12), termCX + dx, 1.25, sz + out * 0.1));
          frame.push(P.put(new THREE.BoxGeometry(4.5, 0.18, 0.25), termCX + dx, 2.6, sz + out * 0.12));
        }
      }
      // gable ends: clad in precast panels
      for (const sx of [termX0, termX1]) clad.push(P.put(P.boxM(0.5, HALL_H, termD, 1), sx, HALL_H / 2, termCZ));
      // roof: deep flat roof, overhanging 3.5 m airside and running out over
      // the kerb as the landside canopy, with a dark fascia band
      const r0 = termZ0 - 3.5, r1 = ap.kerbZ - 1.0;
      roof.push(P.put(P.boxM(termW + 7, ROOF_T, r1 - r0, 1), termCX, HALL_H + ROOF_T / 2, (r0 + r1) / 2));
      dark.push(P.put(new THREE.BoxGeometry(termW + 7.2, 0.9, 0.25), termCX, HALL_H + 0.25, r0));
      dark.push(P.put(new THREE.BoxGeometry(termW + 7.2, 0.9, 0.25), termCX, HALL_H + 0.25, r1));
      for (const sx of [termCX - termW / 2 - 3.5, termCX + termW / 2 + 3.5]) dark.push(P.put(new THREE.BoxGeometry(0.25, 0.9, r1 - r0), sx, HALL_H + 0.25, (r0 + r1) / 2));
      // rooftop plant, set back from the edges
      roof.push(P.put(P.boxM(9, 1.6, 5, 1), termCX - termW * 0.25, HALL_H + ROOF_T + 0.8, termCZ));
      roof.push(P.put(P.boxM(6, 1.2, 4, 1), termCX + termW * 0.2, HALL_H + ROOF_T + 0.6, termCZ + 1));
      // canopy soffit lights (landside) + the hall's ceiling strips
      for (let x = termX0 + 4; x < termX1 - 2; x += 6) strips.push(P.put(new THREE.BoxGeometry(1.2, 0.05, 0.3), x, HALL_H - 0.03, termZ1 + 3));
      for (let i = 0; i < 4; i++) strips.push(P.put(new THREE.BoxGeometry(termW - 6, 0.06, 0.35), termCX, HALL_H - 0.72, termZ0 + 2 + i * (termD - 4) / 3));
      P.addMerged(T, core, cmat(0x565c62), {});
      P.addMerged(T, frame, cmat(0x39404a), { cast: true });
      P.addMerged(T, dark, cmat(0x252a30), { cast: true });
      P.addMerged(T, clad, P.concreteMat(0xd8d4cb), { cast: true });
      P.addMerged(T, roof, P.steelMat(0xbfc4c8), { cast: true });
      P.addMerged(T, glassG, P.glassMat(0.38), { cast: false, receive: false });
      P.addMerged(T, strips, P.glow(mat(0xfff4dc, { emissive: 0xffe9c2, ei: 0.35 }), 0.35, 1.1, root), {});
      solidLocal(termCX, termCZ, termW, termD, 0, HALL_H + ROOF_T, null).noBreach = true;
    }

    /* THE CHECK-IN COUNTER. The kit draws it because the kit owns geometry;
       city/ticketing.js owns only the verb that happens at it. A counter with
       nobody behind it is the dead prop this repo keeps deleting, so the desk
       gets a real posted body through the shared staff system — data until
       you are within 170 m of it, exactly like every other worker. It stands
       under the canopy on the kerb side of the hall: a counter front with a
       kick plate, a stone worktop, a bag scale and belt at one end, two
       monitors, and the lit airline board hung from the canopy soffit (it
       used to float at 3.1 m on nothing). */
    if (ap.desk) {
      const dx = ap.desk.lx, dz = ap.desk.lz + 1.3;
      const body = [], top = [], dk = [], scr = [];
      body.push(P.put(P.boxM(7.6, 1.0, 0.7, 1), dx, 0.55, dz));
      dk.push(P.put(new THREE.BoxGeometry(7.6, 0.12, 0.66), dx, 0.06, dz + 0.03));
      top.push(P.put(new THREE.BoxGeometry(8.0, 0.06, 0.95), dx, 1.08, dz + 0.1));
      // bag drop: scale plate + belt at the west end, sunk into the counter line
      dk.push(P.put(new THREE.BoxGeometry(1.1, 0.35, 1.2), dx - 4.6, 0.2, dz));
      top.push(P.put(new THREE.BoxGeometry(1.0, 0.03, 1.0), dx - 4.6, 0.39, dz));
      for (const mx of [-1.8, 1.8]) {
        dk.push(P.put(new THREE.BoxGeometry(0.06, 0.35, 0.06), dx + mx, 1.28, dz + 0.3));
        dk.push(P.put(new THREE.BoxGeometry(0.55, 0.36, 0.05), dx + mx, 1.55, dz + 0.3));
        scr.push(P.put(new THREE.BoxGeometry(0.5, 0.31, 0.01), dx + mx, 1.55, dz + 0.27));
      }
      // the airline board, hung by two rods from the canopy soffit at 8.2 m
      scr.push(P.put(new THREE.BoxGeometry(6, 0.9, 0.08), dx, 3.1, dz + 1.3));
      for (const rx of [-2.6, 2.6]) dk.push(P.put(new THREE.CylinderGeometry(0.015, 0.015, 4.7, 4), dx + rx, 5.9, dz + 1.3));
      P.addMerged(F, body, P.steelMat(0xd8dce0), { cast: true });
      P.addMerged(F, top, cmat(0x2b2f34), {});
      P.addMerged(F, dk, cmat(0x30353b), { cast: true });
      P.addMerged(F, scr, P.glow(mat(0x1d5f8a, { emissive: 0x1d5f8a, ei: 0.35 }), 0.35, 0.8, root), {});
      solidLocal(dx - 0.5, dz, 9.0, 1.1, 0, 1.15, null);
      if (CBZ.cityStaffPost) {
        const w = ap.toWorld(ap.desk.lx, ap.desk.lz + 2.6);
        try {
          CBZ.cityStaffPost({
            venue: "airport-desk", id: ap.id + ":desk",
            job: "ticket agent", archetype: "laborer",
            x: w.x, z: w.z, face: ap.dirWorld(Math.PI),
          });
        } catch (e) {}
      }
    }

    // ---- (5) THE TOWER, on the apron's edge with a view down the field ----
    if (spec.tower !== false) {
      const tx = termX0 - 26, tz = ap.apronZ - 6;
      const TH = 16.5;
      const t = P.tower(F, tx, tz, { H: TH, apothem: 2.9, cabHalf: 4.6, cabH: 3.3, drum: true, slot: true }, root);
      solidLocal(tx, tz, 6.4, 6.4, 0, TH, t.group).noBreach = true;
      solidLocal(tx, tz, 10.4, 10.4, TH - 0.5, t.roofY + 0.6, t.group).noBreach = true;
    }
    // ---- (6) WINDSOCK, clear of the taxiway, where a pilot looks for it ----
    P.windsock(F, termX1 + 30, ap.taxiZ - TAXI_W / 2 - 14, 0.9);

    // ---- (7) THE FENCE — airside perimeter, chain-link on galvanised posts.
    //      The hall itself closes the boundary between its two ends; the
    //      landside (the kerb, the forecourt, the access road) is public.
    if (spec.fence !== false) {
      const fx0 = -H - 40, fx1 = H + 40, fz0 = -RW / 2 - 40;
      const fzL = apronCZ + APRON_D / 2 + 1.5;
      P.fence(F, [
        [fx0, fz0, fx1, fz0],
        [fx0, fz0, fx0, fzL],
        [fx1, fz0, fx1, fzL],
        [fx0, fzL, termX0 - 0.5, fzL],
        [termX1 + 0.5, fzL, fx1, fzL],
      ], { center: { x: 0, z: ap.taxiZ } });
    }

    // ---- (8) THE PARKED FLEET — island_airport.js's own airframes ---------
    // Nothing here knows what an airliner looks like. If the kit is not
    // published (a build without island_airport.js) the field is simply an
    // empty aerodrome rather than a broken one.
    const K = CBZ.airportKit;
    const liveries = [0x2d5fb0, 0xb33636, 0x1f7a4d, 0xc78a1f, 0x7a4ea8];
    ap.parked = [];
    if (K && K.airliner && K.boardable) {
      const nPark = Math.max(0, spec.parked == null ? Math.min(2, ap.gates.length) : spec.parked | 0);
      for (let i = 0; i < nPark && i < ap.gates.length; i++) {
        const g = ap.gates[i];
        try {
          const grp = K.airliner(g.x, g.z, g.worldHeading, liveries[(i + ap.gates.length) % liveries.length]);
          K.boardable(grp, g.x, g.z, g.worldHeading, 30, 22, "Airliner");
          g.occupant = "parked";
          ap.parked.push(grp);
        } catch (e) { try { console.error("[airfield] parked airliner", ap.id, e); } catch (e2) {} }
      }
      // a parked airliner is coned: one off each wingtip and one at the tail
      const cones = [];
      const halfSpan = CBZ.CITY_AIRCRAFT_DIMS.airliner.span / 2 + 1.2;
      for (let i = 0; i < nPark && i < ap.gates.length; i++) {
        const g = ap.gates[i];
        cones.push([g.lx - halfSpan, g.lz + 1], [g.lx + halfSpan, g.lz + 1], [g.lx + 2.5, g.lz - (g.lz > ap.taxiZ ? 1 : -1) * 30]);
      }
      if (cones.length) P.cones(F, cones);
      if (K.jet && spec.jets !== false) {
        const jz = ap.apronZ - 4;
        for (let i = 0; i < 2; i++) {
          const lx = termCX + termW / 2 + 34 + i * 22;
          const w = ap.toWorld(lx, jz + (i ? 8 : 0));
          const hd = ap.dirWorld(-Math.PI / 2 + (hash01(lx, jz, 7) - 0.5) * 0.4);
          try {
            const grp = K.jet(w.x, w.z, hd, i ? 0x6a3a6a : 0x355c8a);
            K.boardable(grp, w.x, w.z, hd, 14, 12, "Private Jet");
            ap.parked.push(grp);
          } catch (e) {}
        }
      }
    }

    // ---- (9) THE WORLD CONTRACTS -----------------------------------------
    CBZ.registerCityRegion(city, {
      name: ap.name, subtitle: spec.subtitle || "Airport", biome: spec.biome || "airport", kind: "rect",
      minX: B.minX, maxX: B.maxX, minZ: B.minZ, maxZ: B.maxZ, pad: 6,
    });
    // NOBODY WALKS ON THE MOVEMENT AREA — the same law Halloran keeps, and the
    // reason it is a rect in LOCAL space projected to world: on a rotated field
    // an axis-aligned "everything south of the terminal" would either leak onto
    // the runway or bar the kerb. Landside (z > termZ - 14) stays open.
    if (CBZ.registerNoSpawnZone) {
      const c0 = ap.toWorld(-H - 30, -RW / 2 - 30), c1 = ap.toWorld(H + 30, -RW / 2 - 30);
      const c2 = ap.toWorld(-H - 30, ap.termZ - 14), c3 = ap.toWorld(H + 30, ap.termZ - 14);
      const xs = [c0.x, c1.x, c2.x, c3.x], zs = [c0.z, c1.z, c2.z, c3.z];
      try {
        CBZ.registerNoSpawnZone(city, {
          minX: Math.min.apply(null, xs), maxX: Math.max.apply(null, xs),
          minZ: Math.min.apply(null, zs), maxZ: Math.max.apply(null, zs),
          label: ap.id + "-airside",
        });
      } catch (e) {}
    }
    // A kerb road so the field is a place traffic can reach, and a link out
    // toward whatever the spec names as its road plug (usually the town it
    // serves). Both ride ap.toWorld, so they follow the field.
    /* THE KERB ROAD, and the one thing this kit will not fake. A `city.roads`
       record is AXIS-ALIGNED by construction (`vertical` is a boolean), so a
       kerb on a crooked field cannot be expressed as one: a 217 m frontage at
       16 degrees drifts 60 m off its own canopy, which is a road painted
       through the terminal. So the kerb road exists when the field is
       near-axis (within ~6 degrees, i.e. every field whose runway follows the
       world grid) and is simply absent when it is not — the access link still
       docks at the kerb, the ramp is still walkable, and nothing draws a lane
       where there is no lane. A rotated field that wants kerb traffic needs a
       road record that can carry a bearing; that is a change to the road
       format, not something to approximate here. */
    const axisAligned = Math.min(Math.abs(ap._s), Math.abs(ap._c)) < 0.105;
    if (city.roads && axisAligned) {
      const k0 = ap.toWorld(termCX - termW / 2 - 20, ap.kerbZ), k1 = ap.toWorld(termCX + termW / 2 + 20, ap.kerbZ);
      const horiz = Math.abs(k1.x - k0.x) >= Math.abs(k1.z - k0.z);
      city.roads.push({
        x: (k0.x + k1.x) / 2, z: (k0.z + k1.z) / 2, vertical: !horiz,
        len: Math.hypot(k1.x - k0.x, k1.z - k0.z), district: "highway",
        w: 18, lanesPerDir: 2, laneW: 3.6,
        // OWNERSHIP, not an exception: roadrules.js lets a road run inside the
        // place that OWNS it, and the kerb belongs to the airport it serves.
        owner: spec.biome || "airport",
      });
    }
    /* THE LINK. A field on its own ground needs a way in, and the honest shape
       is almost never one straight deck: the kerb faces whichever way the
       runway does, and the town it serves is somewhere else entirely. So the
       link is an L — down the kerb's axis first, then across — laid as two
       ordinary causeway legs. Both carry "Link" in their name, which is what
       tells the region audit these are meant to touch two shores. */
    if (spec.road && city.roads) {
      const kerb = ap.toWorld(termCX, ap.kerbZ + 8);
      const HW = 12;
      const legs = [];
      if (Math.abs(spec.road.z - kerb.z) > 24) legs.push({ vertical: true, x: kerb.x, z0: kerb.z, z1: spec.road.z });
      if (Math.abs(spec.road.x - kerb.x) > 24) legs.push({ vertical: false, z: spec.road.z, x0: kerb.x, x1: spec.road.x });
      for (let i = 0; i < legs.length; i++) {
        const L = legs[i];
        const midX = L.vertical ? L.x : (L.x0 + L.x1) / 2;
        const midZ = L.vertical ? (L.z0 + L.z1) / 2 : L.z;
        const len = L.vertical ? Math.abs(L.z1 - L.z0) : Math.abs(L.x1 - L.x0);
        const w = L.vertical ? HW * 2 : len, d = L.vertical ? len : HW * 2;
        const g = new THREE.PlaneGeometry(w, d);
        // 6 cm over the field plane (0.03) with a depth bias: the leg's first
        // stretch lies ON the field plane, and 1 cm of separation flickered.
        g.rotateX(-Math.PI / 2); g.translate(midX, 0.06, midZ);
        const lm = cmat(0x3c3f46).clone();
        lm.polygonOffset = true; lm.polygonOffsetFactor = -2; lm.polygonOffsetUnits = -4;
        if (CBZ.asphaltDetail) { try { CBZ.asphaltDetail(lm); } catch (e) {} }
        const m = new THREE.Mesh(g, lm);
        m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
        m.userData.terrain = true; m.userData.worldSurface = true;
        root.add(m);
        CBZ.registerCityRegion(city, {
          name: ap.name + " Link " + (i + 1), subtitle: spec.subtitle || "Airport",
          biome: spec.biome || "airport", kind: "rect",
          minX: midX - w / 2, maxX: midX + w / 2, minZ: midZ - d / 2, maxZ: midZ + d / 2, pad: 1,
        });
        const link = {
          x: midX, z: midZ, vertical: L.vertical, len: len, district: "highway",
          w: 20, lanesPerDir: 2, laneW: 3.6, owner: spec.biome || "airport",
        };
        if (CBZ.roadClamp) { try { CBZ.roadClamp(link, { owner: link.owner }); } catch (e) {} }
        city.roads.push(link);
      }
    }

    return ap;
  };
})();
