/* ============================================================
   systems/wildfire.js — THE WILDFIRE (CBZ.wildfire).

   The fire used to be a graph of ~70 trees heating each other across 12-22 m
   of bare grass: nothing between the trees could burn, so the "front" was a
   chain of torches with green lawn between them, and nothing that is not a
   tree (a house, a car) ever caught. This file is the fire rebuilt on what a
   wildfire is: a SURFACE FIRE running through a fuel bed, which the trees,
   the houses and the cars sit in.

   THE FUEL BED IS A GRID. The island is rasterised once (sliced across frames
   when the arena appears, so the fire costs nothing when it starts) into
   cells of ~2.5 m, each with a fuel model:
     grass   fine, fast, short-lived flame (the head of a grass fire runs)
     brush   shrub patches on the hillsides: taller flame, hotter
     litter  the needle/leaf bed under every crown: slow, long-burning,
             and the ladder that lifts a surface fire into the crown
     none    beach sand, asphalt, scree, building footprints (firebreaks)
   The island builder can answer the question itself (CBZ.island.landcoverAt
   or arena.landcoverAt -> "grass" | "brush" | "litter" | anything else =
   none); otherwise the cover is read off the world: sea level, the road
   test, slope, the volcano's bare cone, a seeded noise for shrub patches.

   SPREAD IS MINIMUM TRAVEL TIME, not dice. When a cell ignites, each of its
   16 neighbours (8 + the knight moves, which kill the raster's octagon) is
   given an arrival time t + d / ROS; a cell ignites when the fire clock
   passes the earliest one. ROS is the published shape of fire behaviour:
     head ROS  = R0(fuel) x load x (1 + phi_w),  phi_w = 0.9 U^1.35 with U the
                 midflame wind (the 10 m wind x the fuel's adjustment factor)
     direction = an ellipse: length-to-breadth from the 10 m wind (Alexander
                 1985: LB = 1 + 8.729 (1 - e^-0.03U)^2.155, U in km/h, capped
                 at 6), polar from the rear focus:
                 R(th) = R_head (1 - e) / (1 - e cos th)
     slope     = McArthur: x2 per 10 deg uphill, /2 per 10 deg downhill
   A seeded per-cell load (0.75-1.25) breaks the ellipse into a real ragged
   front. The heat-cured grass just ahead of the flames browns (the singe
   channel) before it catches.

   CROWN FIRE. A tree is not a cell: it sits on its litter, and the flaming
   litter under it heats its crown (rate rising with the fire's size and
   wind). Low-intensity fires pass under and leave a green crown on a black
   trunk; hot ones TORCH it, and a torching crown radiates into neighbouring
   crowns downwind (active crown fire on a big day), rains burning material
   onto the bed around it, and lofts the embers that spot.

   SPOTTING. Embers come off the head's convection columns (crowns, burning
   buildings, big grass runs) and are tracked to a landing 10-80 m downwind.
   Where they land decides: fine fuel catches by its receptivity, a house
   catches at its vents and windows, sand and asphalt only take a mark.

   HOUSES BURN FROM THE EMBERS. Most homes lost to wildfire are lost to ember
   attack, not to the front: an ember shower in the plume finds an attic vent
   (the fire starts in the top floor) or a window/deck (a low floor). Contact
   and radiant heat from burning fuel, trees, cars or the house next door do
   the rest. Inside, the fire grows to flashover, climbs a floor in a few
   seconds through the windows and drops a floor slowly. Flames lick out of
   the window bays of every burning storey. A wood-frame house's burned
   fraction is paid into THE structural ledger the quake and the tornado use
   (systems/disasters.js structureHit via the def's bridge): the windows go,
   then it collapses on city/collapse.js and leaves a burning rubble heap. A
   concrete tower guts floor by floor and stays standing.

   CARS. A car in burning grass, under a torching tree or beside a burning
   house catches at the engine bay, is fully involved a few seconds later, and
   its tank goes: the def's blast (the "carcook" row on the impact bus, which
   prices a fuel tank). Then it burns down to a charred shell.

   THE SMOKE KILLS MORE PEOPLE THAN THE FLAME, AND ARRIVES FIRST. The plume
   is a physical field: every source (crown, grass block, house, car) lays a
   downwind Gaussian corridor that chokes whoever is in it. The drawn smoke
   is the same field's portrait: convective columns that stand off each
   source and bend over downwind, heavy surface smoke running ahead of the
   front, black smoke off structures and cars. The def tints the sun orange
   by the fire's size and by the smoke you are standing in, and ash falls
   wherever the plume is overhead.

   BLACK IS BLACK. Burned ground stays black (one char texture over the
   island, drawn on lazily built terrain-hugging tiles, whose glow channel is
   the ember bed behind the front), burned trees stand as charred snags, and
   burnt-out cars and houses stay. "The black" is also the one safe place
   once the front has passed: refuge() and threat() know it.

   THE FIRE AS A SERVICE. Other disasters start fires on this same bed:
   the eruption's lava margin, its hot bombs and its density currents call
   CBZ.wildfire.igniteAt(x, z, why, r) / igniteTree(t) / igniteBuilding(b)
   / igniteCar(c) (the host lends its world and ledger once with attach()).
   No wildfire event has to be running: the grid and the FX come up lazily
   (an ignition before the bed is rasterised waits in a queue while the
   bed finishes a slice a frame), and only what is burning is ticked. The
   sky, the fog and the weather stay the running event's; the service never
   touches them. The arena's reset (wrapReset) and hardStop() clear it.

   WHAT THIS FILE DOES NOT DO: fire crews and water-dropping helicopters.
   The island has no firefighting units to call; when it gets them, they
   read CBZ.wildfire.grid()/hazards() and put cells out with douse().

   REUSE: deaths via CBZ.surv.hurt; the wind IS the weather's wind; structure
   damage via the def's bridge into the one ledger; the car blast via the
   def's survBlast; hazard draws on CBZ.survRnd, FX jitter on Math.random.
   Lab: kit "wildfire" (src/lab/kits/wildfire.js) runs this file alone on a
   slope with grass, trees, houses and cars.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.wildfire) return;                    // idempotent family guard
  const THREE = window.THREE;

  // hazard-placing draws come from THE shared survival stream (see the
  // determinism header in systems/disasters.js); FX jitter stays Math.random
  const rnd = () => (CBZ.survRnd ? CBZ.survRnd() : Math.random());
  const jit = () => Math.random();
  function surv() { return CBZ.surv ? CBZ.surv : null; }

  // a deterministic hash of integer coordinates -> [0, 1)
  function h01(a, b, s) {
    let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul((s | 0) + 1, 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, z, s) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = h01(ix, iz, s), b = h01(ix + 1, iz, s), c = h01(ix, iz + 1, s), d = h01(ix + 1, iz + 1, s);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  }

  /* ---- fuel models ------------------------------------------------------
     r0     flat, calm rate of spread (game m/s; the event compresses a real
            afternoon into ~25 s, so every rate here runs ~6x real)
     burn   flaming residence (s), smoulder: glowing bed after it
     flameH flame length (m) at full intensity, catch: ember receptivity
     waf    wind adjustment factor (10 m wind -> midflame wind)
     heat   how hard it heats what stands in it (crowns, cars, people) */
  const FUELS = [
    null,
    { name: "grass",  r0: 0.70, burn: 2.4, smoulder: 3.0, flameH: 1.5, catch: 0.62, waf: 0.45, heat: 0.55 },
    { name: "brush",  r0: 0.50, burn: 4.5, smoulder: 5.0, flameH: 2.9, catch: 0.55, waf: 0.38, heat: 1.0 },
    { name: "litter", r0: 0.35, burn: 6.0, smoulder: 8.0, flameH: 1.9, catch: 0.78, waf: 0.30, heat: 0.85 },
  ];
  const COVER = { grass: 1, brush: 2, shrub: 2, litter: 3, forest: 3 };
  const NB = [];   // the 16 spread neighbours: [dx, dz, length in cells]
  [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
   [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]]
    .forEach((d) => NB.push([d[0], d[1], Math.hypot(d[0], d[1])]));
  const INF = 1e9;
  const WARN_RATE = 0.2;   // the fire clock creeps through the telegraph
  const TILE = 32;         // char tiles, cells per side

  const MAXTREEFLAME = 64, MAXFLAME = 1500, MAXGLOW = 360;
  const MAXSMOKE = 2000, MAXEMBER = 400, MAXASH = 600;

  /* ---- run state -------------------------------------------------------- */
  const F = {
    live: false, arena: null, bridge: null,
    t: 0, clock: 0,
    wx: 1, wz: 0, wspd: 10,
    mag: 0.55, reach: 14, scarAge: 0, _forceMag: null,
    seed: null, intensity: 0,
    spreadCd: 0, spotCd: 2.2, veer: 0,
    burningList: [], sources: [],
    spots: [], smoulders: [],
    smokeLinger: 0, after: false,
    // THE SERVICE (fires another disaster starts; see "THE FIRE AS A SERVICE")
    svc: false, svcArena: null, svcBridge: null, svcQ: [], frame: 0,
  };
  let stats = null;
  function zeroStats() {
    stats = {
      ignitions: 0, treesTorched: 0, treesScorched: 0,
      // fires lit FROM OUTSIDE (CBZ.wildfire.igniteAt / igniteTree / ...), by cause
      lit: {},
      cellsIgnited: 0, burntM2: 0,
      spotLaunched: 0, spotFires: 0, spotMaxM: 0, spotFizzled: 0,
      bldIgnited: 0, bldByVent: 0, bldByWindow: 0, bldByHeat: 0, bldFloorsBurnt: 0, bldCollapsed: 0, bldGutted: 0,
      carsBurnt: 0, carsExploded: 0,
      smokeDamage: 0, flameDamage: 0, smokeDeaths: 0, flameDeaths: 0,
      simMs: 0, simFrames: 0, fxMs: 0, fxFrames: 0, fxMsMax: 0, simMsMax: 0,
    };
  }
  zeroStats();

  /* ---- THE FUEL GRID ------------------------------------------------------ */
  const G = {
    arena: null, ready: false, row: 0,
    n: 0, cs: 2.5, x0: 0, z0: 0,
    fuel: null, load: null, gy: null,
    st: null,        // 0 unburnt, 1 flaming, 2 smouldering, 3 burnt
    tIgn: null, arr: null, life: null,
    pend: [], inPend: null, act: [],
    bld: null,       // footprint cell -> building index + 1
    tex: null, texData: null, texDirty: false, texCd: 0,
    tiles: null, tileN: 0, tileRoot: null, mat: null,
    blk: null, blkN: 0, blkTouched: [],
    flamingN: 0, burntN: 0,
  };
  function world() { return F.arena || G.arena; }
  function ground(x, z) {
    const A = world();
    return A && A.groundHeightAt ? A.groundHeightAt(x, z) : 0;
  }
  function cellOf(x, z) {
    if (!G.ready) return -1;
    return rawCell(x, z);
  }
  function rawCell(x, z) {
    const ix = Math.floor((x - G.x0) / G.cs), iz = Math.floor((z - G.z0) / G.cs);
    if (ix < 0 || iz < 0 || ix >= G.n || iz >= G.n) return -1;
    return iz * G.n + ix;
  }
  function cellX(i) { return G.x0 + ((i % G.n) + 0.5) * G.cs; }
  function cellZ(i) { return G.z0 + (((i / G.n) | 0) + 0.5) * G.cs; }

  function gridStart(A) {
    G.arena = A; G.ready = false; G.row = 0;
    const cx = A.center.x, cz = A.center.z;
    // cover the whole island and its islets: the farthest tree or building
    let ext = A.radius + 8;
    (A.flammable || []).forEach((t) => { ext = Math.max(ext, Math.hypot(t.x - cx, t.z - cz) + 10); });
    (A.fragile || []).forEach((b) => { ext = Math.max(ext, Math.hypot(b.x - cx, b.z - cz) + Math.max(b.w, b.d) + 6); });
    ext = Math.min(ext, A.radius * 1.8 + 20);
    G.cs = Math.max(2.5, (2 * ext) / 192);
    G.n = Math.ceil((2 * ext) / G.cs);
    G.x0 = cx - (G.n * G.cs) / 2; G.z0 = cz - (G.n * G.cs) / 2;
    const N = G.n * G.n;
    G.fuel = new Uint8Array(N); G.load = new Float32Array(N); G.gy = new Float32Array(N);
    G.st = new Uint8Array(N); G.tIgn = new Float32Array(N).fill(-1); G.arr = new Float32Array(N).fill(INF);
    G.life = new Float32Array(N); G.inPend = new Uint8Array(N); G.bld = new Int16Array(N);
    G.pend.length = 0; G.act.length = 0;
    G.texData = new Uint8Array(N * 4);
    for (let i = 0; i < N; i++) G.texData[i * 4 + 3] = 255;
    G.blkN = Math.ceil(G.n / 8);
    G.blk = new Float32Array(G.blkN * G.blkN * 3); G.blkTouched.length = 0;
    G.flamingN = 0; G.burntN = 0;
    if (G.tex) { G.tex.dispose(); G.tex = null; }
    // the char tiles and their material read the OLD texture and origin
    (G.tiles || []).forEach((t) => { if (t) { if (t.parent) t.parent.remove(t); t.geometry.dispose(); } });
    G.tileN = Math.ceil(G.n / TILE);
    G.tiles = new Array(G.tileN * G.tileN).fill(null);
    if (G.mat) { G.mat.dispose(); G.mat = null; }
  }
  // classify rows [r0, r1): height first, then cover
  function gridRows(r0, r1) {
    const A = G.arena, n = G.n, cs = G.cs;
    const I = CBZ.island;
    const lc = (I && typeof I.landcoverAt === "function") ? I.landcoverAt.bind(I)
      : (typeof A.landcoverAt === "function" ? A.landcoverAt.bind(A) : null);
    const oceanY = A.oceanY != null ? A.oceanY : -1e9;
    const vol = A.volcano || (A.hills && A.hills[0] && A.hills[0].peak > 20 ? { x: A.hills[0].x, z: A.hills[0].z, r: A.hills[0].r * 0.62 } : null);
    // the beach: the wet line, the sand ring inside the island's radius, and
    // anything off the main island that is not a dune top (the island plain
    // sits under a metre above the sea, so height alone cannot say "sand")
    const R = A.radius, cxA = A.center.x, czA = A.center.z;
    const sandAt = function (x, z, gy) {
      if (gy < oceanY + 0.35) return true;
      const d = Math.hypot(x - cxA, z - czA);
      if (d > R - 6) return gy - oceanY < 1.6;
      return false;
    };
    for (let iz = r0; iz < r1; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const x = G.x0 + (ix + 0.5) * cs, z = G.z0 + (iz + 0.5) * cs;
        const gy = A.groundHeightAt(x, z);
        G.gy[i] = gy;
        let f = 0;
        if (lc) { const c = lc(x, z); f = COVER[c] || 0; }
        // the island's onRoad(x, z, w, d) answers "within w/2 + a 4.9 m verge
        // corridor"; a negative width trims that to the 7 m carriageway itself,
        // the asphalt that actually stops a grass fire (the verge burns)
        else if (!sandAt(x, z, gy) && !(A.onRoad && A.onRoad(x, z, -2.8, -2.8)) &&
                 !(vol && Math.hypot(x - vol.x, z - vol.z) < vol.r)) {
          // scree: anything steeper than ~38 deg carries no continuous bed
          const sx = A.groundHeightAt(x + 1, z) - A.groundHeightAt(x - 1, z);
          const sz = A.groundHeightAt(x, z + 1) - A.groundHeightAt(x, z - 1);
          const slope = Math.hypot(sx, sz) / 2;
          if (slope < 0.78) {
            const nz = vnoise(x / 15, z / 15, 0x5b);
            f = (nz > 0.66 || (slope > 0.22 && nz > 0.5)) ? 2 : 1;
          }
        }
        // the mosaic: bare, rocky or damp spots the front skips round
        if (f && h01(ix, iz, 0x4d) < 0.05) f = 0;
        G.fuel[i] = f;
        // fuel load / moisture heterogeneity: the front comes out ragged
        G.load[i] = 0.72 + 0.56 * (0.6 * vnoise(x / 7, z / 7, 0x1d) + 0.4 * h01(ix, iz, 0x2e));
      }
    }
  }
  function gridFinish() {
    const A = G.arena, n = G.n, cs = G.cs;
    // litter under every crown (overrides grass/brush, never makes fuel out of sand)
    const tr = A.flammable || [];
    for (let k = 0; k < tr.length; k++) {
      const t = tr[k];
      const r = 4.5, ri = Math.ceil(r / cs);
      const c = rawCell(t.x, t.z);
      if (c < 0) continue;
      const cx = c % n, cz = (c / n) | 0;
      for (let dz = -ri; dz <= ri; dz++) for (let dx = -ri; dx <= ri; dx++) {
        const ix = cx + dx, iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= n || iz >= n) continue;
        if (Math.hypot(dx, dz) * cs > r) continue;
        const i = iz * n + ix;
        if (G.fuel[i]) G.fuel[i] = 3;
      }
      t._wfCell = c;
    }
    // building footprints carry no bed (the house is its own fuel)
    const B = A.fragile || [];
    for (let k = 0; k < B.length; k++) {
      const b = B[k];
      const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
      for (let z = z0 + cs * 0.5; z < z1 + cs * 0.5; z += cs * 0.5) for (let x = x0 + cs * 0.5; x < x1 + cs * 0.5; x += cs * 0.5) {
        const i = rawCell(Math.min(x, x1 - 0.01), Math.min(z, z1 - 0.01));
        if (i >= 0) { G.fuel[i] = 0; G.bld[i] = k + 1; }
      }
    }
    G.ready = true;
  }
  function gridEnsure(A, budgetRows) {
    if (G.arena !== A) gridStart(A);
    if (G.ready) return;
    const end = budgetRows == null ? G.n : Math.min(G.n, G.row + budgetRows);
    gridRows(G.row, end); G.row = end;
    if (G.row >= G.n) gridFinish();
  }

  /* ---- the drawn fire --------------------------------------------------- */
  let FX = null;
  const dummy = new THREE.Object3D();

  function fogUniforms(extra) { return THREE.UniformsUtils.merge([THREE.UniformsLib.fog, extra]); }
  // an ADDITIVE sprite must fade to nothing in fog, not to the fog colour
  const FOG_FADE = `
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        float fogF = 1.0 - exp(- fogDensity * fogDensity * fogDepth * fogDepth);
      #else
        float fogF = smoothstep(fogNear, fogFar, fogDepth);
      #endif
      gl_FragColor.a *= 1.0 - fogF;
    #endif`;

  /* THE ONE FLAME LOOK: a feathered, licking point-sprite tongue. Crowns,
     the grass front, window bays, cars and quake.js's gas fire all draw it. */
  function flameMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: fogUniforms({
        uTime: { value: 0 }, uScale: { value: 320 }, uWind: { value: new THREE.Vector2(1, 0) },
      }),
      vertexShader: `
        uniform float uScale;
        uniform vec2 uWind;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aSeed;
        varying float vAlpha;
        varying float vSeed;
        varying float vWindX;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          mvPosition.z += 0.16 * aSize;   // stand clear of the fuel it burns in
          vec2 vw = (viewMatrix * vec4(uWind.x, 0.0, uWind.y, 0.0)).xy;
          vWindX = length(vw) > 0.001 ? normalize(vw).x : 0.0;
          vAlpha = aAlpha;
          vSeed = aSeed;
          gl_PointSize = min(220.0, max(0.0, aSize * uScale / max(1.0, -mvPosition.z)));
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying float vAlpha;
        varying float vSeed;
        varying float vWindX;
        #include <fog_pars_fragment>
        void main() {
          // gl_PointCoord.y runs DOWNWARD; every term is height above the base
          float y = 1.0 - gl_PointCoord.y;
          float x = gl_PointCoord.x * 2.0 - 1.0;
          float lick = sin(y * 10.0 + vSeed * 17.0 + uTime * 8.5) * (0.035 + y * 0.09);
          float lean = vWindX * y * y * 0.48;
          float width = (0.04 + 0.62 * pow(max(0.0, 1.0 - y), 0.76)) *
            (0.9 + 0.1 * sin(vSeed * 31.0 + uTime * 10.0 - y * 7.0));
          float q = abs(x - lean - lick) / max(0.04, width);
          float body = 1.0 - smoothstep(0.58, 1.08, q);
          body *= 0.90 + 0.10 * sin(y * 18.0 + x * 5.0 + vSeed * 37.0 + uTime * 11.0);
          body *= smoothstep(0.01, 0.10, y);
          body *= 1.0 - smoothstep(0.87 + 0.045 * sin(vSeed * 23.0 + uTime * 7.0), 1.0, y);
          float core = pow(max(0.0, 1.0 - q), 2.1) * pow(max(0.0, 1.0 - y), 0.55);
          vec3 color = mix(vec3(1.0, 0.075, 0.008), vec3(1.0, 0.38, 0.015), body);
          color = mix(color, vec3(1.0, 0.78, 0.16), smoothstep(0.15, 0.78, core) * 0.82);
          float alpha = body * vAlpha * (0.88 + 0.12 * sin(vSeed * 41.0 + uTime * 13.0));
          if (alpha < 0.008) discard;
          gl_FragColor = vec4(color, alpha);
          #include <fog_fragment>
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending, fog: true,
    });
  }

  function smokeMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: fogUniforms({
        uTime: { value: 0 }, uScale: { value: 320 }, uWind: { value: new THREE.Vector2(1, 0) },
      }),
      vertexShader: `
        uniform float uScale;
        uniform vec2 uWind;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aSeed;
        attribute float aSurface;
        attribute float aHot;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSeed;
        varying float vSurface;
        varying float vHot;
        varying vec2 vWind;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vec2 vw = (viewMatrix * vec4(uWind.x, 0.0, uWind.y, 0.0)).xy;
          vWind = length(vw) > 0.001 ? normalize(vw) : vec2(1.0, 0.0);
          vColor = aColor;
          vAlpha = aAlpha;
          vSeed = aSeed;
          vSurface = aSurface;
          vHot = aHot;
          gl_PointSize = min(240.0, max(0.0, aSize * uScale / max(1.0, -mvPosition.z)));
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSeed;
        varying float vSurface;
        varying float vHot;
        varying vec2 vWind;
        #include <fog_pars_fragment>
        void main() {
          vec2 p = (gl_PointCoord - 0.5) * 2.0;
          if (vSurface > 0.5) {
            vec2 crossWind = vec2(-vWind.y, vWind.x);
            float along = dot(p, vWind) * 0.72;
            float across = dot(p, crossWind) * 1.18;
            p = vWind * along + crossWind * across;
          }
          p += vec2(sin(p.y * 4.1 + vSeed * 19.0), sin(p.x * 3.7 + vSeed * 29.0)) * 0.075;
          float angle = atan(p.y, p.x);
          float edge = 0.86 + 0.055 * sin(angle * 3.0 + vSeed * 19.0) +
            0.035 * sin(angle * 7.0 - vSeed * 31.0);
          float d = length(p);
          float q = d / max(0.2, edge);
          float body = exp(-2.65 * q * q) * (1.0 - smoothstep(0.78, 1.12, q));
          float mottled = 0.90 + 0.10 * sin((p.x + vSeed) * 5.0) * sin((p.y - vSeed) * 4.0);
          float alpha = body * mottled * vAlpha;
          if (alpha < 0.006) discard;
          // the fire-lit UNDERSIDE of a young puff
          float h = 1.0 - gl_PointCoord.y;
          float under = (1.0 - smoothstep(0.10, 0.78, h)) * vHot;
          vec3 color = vColor + vec3(0.34, 0.085, 0.012) * under * body;
          gl_FragColor = vec4(color, alpha);
          #include <fog_fragment>
        }
      `,
      transparent: true, depthWrite: false, fog: true,
    });
  }

  function emberMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 320 } },
      vertexShader: `
        uniform float uScale;
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vAlpha = aAlpha;
          gl_PointSize = min(18.0, 1.5 + 0.22 * uScale / max(1.0, -mvPosition.z));
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float alpha = (1.0 - smoothstep(0.12, 1.0, d)) * vAlpha;
          if (alpha < 0.01) discard;
          vec3 color = mix(vec3(1.0, 0.22, 0.015), vec3(1.0, 0.92, 0.42), 1.0 - smoothstep(0.0, 0.5, d));
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }

  // the light a fire throws: window bays, a crown's halo, a car's interior
  function glowMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: fogUniforms({ uScale: { value: 320 }, uTime: { value: 0 } }),
      vertexShader: `
        uniform float uScale;
        uniform float uTime;
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float fl = 0.86 + 0.14 * sin(uTime * 9.0 + position.x * 1.7 + position.z * 1.3);
          vAlpha = aAlpha * fl;
          gl_PointSize = min(256.0, max(0.0, aSize * uScale / max(1.0, -mvPosition.z)));
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        #include <fog_pars_fragment>
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = exp(-3.4 * d * d) * (1.0 - smoothstep(0.75, 1.0, d)) * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(mix(vec3(1.0, 0.30, 0.04), vec3(1.0, 0.62, 0.20), exp(-6.0 * d * d)), a);
          ${FOG_FADE}
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    });
  }

  // falling ash: pale flakes tumbling (the tumble is the flicker of a flat
  // flake turning edge-on), not specks of light
  function ashMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: fogUniforms({ uScale: { value: 320 }, uTime: { value: 0 } }),
      vertexShader: `
        uniform float uScale;
        uniform float uTime;
        attribute float aAlpha;
        attribute float aSeed;
        varying float vAlpha;
        varying float vTone;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float turn = abs(sin(uTime * (2.0 + aSeed * 3.0) + aSeed * 40.0));
          vAlpha = aAlpha * (0.35 + 0.65 * turn);
          vTone = aSeed;
          gl_PointSize = min(9.0, max(1.0, (0.07 + 0.06 * aSeed) * uScale / max(1.0, -mvPosition.z)));
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying float vTone;
        #include <fog_pars_fragment>
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = (1.0 - smoothstep(0.55, 1.0, d)) * vAlpha;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vec3(0.62 + 0.22 * vTone, 0.60 + 0.2 * vTone, 0.56 + 0.18 * vTone), a);
          #include <fog_fragment>
        }
      `,
      transparent: true, depthWrite: false, fog: true,
    });
  }

  /* THE BURN: char, ash, the singe ahead of the front and the ember bed
     behind it, read from one cell texture. A world-space noise warps the
     lookup so the cell grid never shows: the edges come out ragged. */
  function burnMaterial(tex, texel, ox, oz) {
    const m = new THREE.ShaderMaterial({
      uniforms: fogUniforms({
        uMap: { value: null }, uTime: { value: 0 }, uAge: { value: 0 },
        uTexel: { value: texel }, uOrigin: { value: new THREE.Vector2(ox, oz) },
      }),
      vertexShader: `
        varying vec2 vUv;
        varying vec2 vP;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vP = wp.xz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uTime;
        uniform float uAge;
        uniform float uTexel;
        uniform vec2 uOrigin;
        varying vec2 vUv;
        varying vec2 vP;
        #include <fog_pars_fragment>
        // a sin-free hash (Hoskins): cheap on a phone GPU
        float hsh(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float vn(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), f.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          // most of a tile is unburnt: leave before any noise is paid for
          // (the warp is under a texel; bilinear support is one texel, so a
          // zero here is zero after the warp too)
          vec4 m0 = texture2D(uMap, vUv);
          if (m0.r + m0.g + m0.b < 0.002) discard;
          vec2 p = vP - uOrigin;
          float n1 = vn(p * 0.42), n2 = vn(p * 1.7 + 13.1), n3 = vn(p * 4.3 - 7.7);
          vec2 warp = (vec2(n1, vn(p * 0.42 + 31.7)) - 0.5) * uTexel * 1.6;
          vec4 m = texture2D(uMap, vUv + warp);
          float charA = smoothstep(0.18, 0.62, m.r + (n2 - 0.5) * 0.35);
          // fully consumed fine fuel leaves white-grey ash in streaks
          float ash = smoothstep(0.55, 0.85, n3 * 0.6 + n2 * 0.4) * charA * 0.6;
          vec3 charCol = mix(vec3(0.028, 0.024, 0.02), vec3(0.36, 0.34, 0.31), ash);
          charCol = mix(charCol, vec3(0.29, 0.27, 0.23), uAge * 0.8);
          float singe = m.b * (1.0 - charA) * (0.7 + 0.3 * n2);
          vec3 col = mix(vec3(0.36, 0.27, 0.12), charCol, charA);
          float a = max(charA * (0.93 - 0.45 * uAge), singe * 0.5);
          // the ember bed: glowing where it burns, broken and breathing
          float g = m.g * smoothstep(0.25, 0.75, n2 + 0.25 * sin(uTime * 6.0 + n1 * 20.0));
          vec3 hot = mix(vec3(0.85, 0.12, 0.01), vec3(1.0, 0.55, 0.12), g * g);
          col = mix(col, hot * 1.4, clamp(g * 1.3, 0.0, 1.0));
          a = max(a, g);
          if (a < 0.01) discard;
          gl_FragColor = vec4(col, a);
          #include <fog_fragment>
        }
      `,
      transparent: true, depthWrite: false, fog: true,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    m.uniforms.uMap.value = tex;   // after the merge: merge would CLONE a texture
    return m;
  }

  /* A burned broadleaf: its crown's fuel is gone and what stands is the
     charred frame of limbs. One shared geometry (swapped in for the crown's
     own), so the snag rides every transform the crown had. */
  let SNAG = null;
  function snagParts() {
    if (SNAG) return SNAG;
    const parts = [];
    const add = (g, x, y, z, rx, rz) => {
      g.translate(0, g.parameters.height / 2, 0);
      g.rotateZ(rz); g.rotateY(rx); g.translate(x, y, z);
      parts.push(g.toNonIndexed());
    };
    add(new THREE.CylinderGeometry(0.11, 0.17, 1.9, 6), 0, -1.6, 0, 0, 0);
    for (let k = 0; k < 6; k++) {
      const yaw = k * 1.047 + (k % 2) * 0.4, len = 1.3 + (k % 3) * 0.35, tilt = 0.55 + (k % 2) * 0.3;
      add(new THREE.CylinderGeometry(0.025, 0.075, len, 5), 0, -0.9 + (k % 3) * 0.35, 0, yaw, tilt);
      const ex = Math.sin(tilt) * len * 0.7, ey = Math.cos(tilt) * len * 0.7;
      add(new THREE.CylinderGeometry(0.012, 0.03, 0.7, 4), -ex * Math.cos(yaw), -0.9 + (k % 3) * 0.35 + ey, ex * Math.sin(yaw), yaw + 0.5, tilt * 0.6);
    }
    let n = 0; parts.forEach((p) => { n += p.attributes.position.count; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    let o = 0;
    parts.forEach((p) => {
      p.computeVertexNormals();
      pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3);
      o += p.attributes.position.count; p.dispose();
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.computeBoundingSphere();
    SNAG = {
      geo: g,
      mat: new THREE.MeshLambertMaterial({ color: 0x15100c }),
      frond: new THREE.MeshLambertMaterial({ color: 0x1c150f, vertexColors: true, side: THREE.DoubleSide }),
      carMat: new THREE.MeshLambertMaterial({ color: 0x241c17 }),
    };
    SNAG.mat.name = SNAG.frond.name = "wildfire-char";
    SNAG.carMat.name = "wildfire-burnt-car";
    return SNAG;
  }

  function pointsLayer(n, attrs, material, order) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3).fill(-9999), 3).setUsage(THREE.DynamicDrawUsage));
    attrs.forEach((a) => g.setAttribute(a[0], new THREE.BufferAttribute(new Float32Array(n * a[1]), a[1]).setUsage(THREE.DynamicDrawUsage)));
    const p = new THREE.Points(g, material);
    p.renderOrder = order; p.frustumCulled = false; p.userData.transient = true;
    return p;
  }

  function buildFX(root) {
    if (FX) return;
    /* Three.js allocates UUIDs with Math.random(): give construction a private
       stream so building the FX never shifts the game's own random stream. */
    const priorRandom = Math.random;
    let fxSeed = (0x57464d33 ^ ((root && root.id) || 0)) >>> 0;
    Math.random = function () {
      fxSeed = (Math.imul(fxSeed, 1664525) + 1013904223) >>> 0;
      return fxSeed / 4294967296;
    };
    try { buildFXMeshes(root); }
    finally { Math.random = priorRandom; }
  }
  function buildFXMeshes(root) {
    const flame = pointsLayer(MAXFLAME, [["aSize", 1], ["aAlpha", 1], ["aSeed", 1]], flameMaterial(), 8);
    flame.geometry.setDrawRange(0, 0); root.add(flame);
    const glow = pointsLayer(MAXGLOW, [["aSize", 1], ["aAlpha", 1]], glowMaterial(), 7);
    glow.geometry.setDrawRange(0, 0); root.add(glow);
    const smoke = pointsLayer(MAXSMOKE, [["aColor", 3], ["aSize", 1], ["aAlpha", 1], ["aSeed", 1], ["aSurface", 1], ["aHot", 1]], smokeMaterial(), 9);
    const seed = smoke.geometry.attributes.aSeed.array;
    for (let i = 0; i < MAXSMOKE; i++) seed[i] = ((i * 0.61803398875) % 1 + 1) % 1;
    root.add(smoke);
    const embers = pointsLayer(MAXEMBER, [["aAlpha", 1]], emberMaterial(), 10);
    root.add(embers);
    const ash = pointsLayer(MAXASH, [["aAlpha", 1], ["aSeed", 1]], ashMaterial(), 9);
    const aseed = ash.geometry.attributes.aSeed.array;
    for (let i = 0; i < MAXASH; i++) aseed[i] = ((i * 0.7548776662) % 1 + 1) % 1;
    root.add(ash);
    const burnRoot = new THREE.Group(); burnRoot.name = "wildfireBurn"; burnRoot.userData.transient = true;
    root.add(burnRoot);
    FX = {
      root, flame, glow, smoke, embers, ash, burnRoot,
      spuff: new Array(MAXSMOKE).fill(null), sFree: [],
      epuff: new Array(MAXEMBER).fill(null), eFree: [],
      apuff: new Array(MAXASH).fill(null), aFree: [],
      flameN: 0, glowN: 0,
    };
    for (let i = MAXSMOKE - 1; i >= 0; i--) FX.sFree.push(i);
    for (let i = MAXEMBER - 1; i >= 0; i--) FX.eFree.push(i);
    for (let i = MAXASH - 1; i >= 0; i--) FX.aFree.push(i);
    // pools rebuilt over a bed that already burned: put its tiles back
    if (G.ready && G.texData) {
      for (let i = 0; i < G.n * G.n; i++) {
        const o = i * 4;
        if (G.texData[o] || G.texData[o + 1] || G.texData[o + 2]) tileFor(i);
      }
    }
  }
  function disposeFX() {
    if (!FX) return;
    const kill = (m) => {
      if (!m) return;
      if (m.parent) m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material && m.material.dispose) m.material.dispose();
    };
    [FX.flame, FX.glow, FX.smoke, FX.embers, FX.ash].forEach(kill);
    if (G.tiles) G.tiles.forEach((t) => { if (t) { if (t.parent) t.parent.remove(t); t.geometry.dispose(); } });
    if (G.tiles) G.tiles.fill(null);
    if (G.mat) { G.mat.dispose(); G.mat = null; }
    if (FX.burnRoot.parent) FX.burnRoot.parent.remove(FX.burnRoot);
    FX = null;
  }
  function fxAlive() { return FX && FX.smoke && FX.smoke.parent; }

  /* ---- the burn texture + its terrain tiles ----------------------------- */
  function texEnsure() {
    if (G.tex) return G.tex;
    const t = new THREE.DataTexture(G.texData, G.n, G.n, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    G.tex = t;
    return t;
  }
  function tileFor(i) {
    if (!fxAlive()) return;
    const ix = i % G.n, iz = (i / G.n) | 0;
    const tx = (ix / TILE) | 0, tz = (iz / TILE) | 0, k = tz * G.tileN + tx;
    if (G.tiles[k]) return;
    if (!G.mat) G.mat = burnMaterial(texEnsure(), 1 / G.n, G.x0, G.z0);
    const n0x = tx * TILE, n0z = tz * TILE;
    const nx = Math.min(TILE, G.n - n0x), nz = Math.min(TILE, G.n - n0z);
    const vx = nx + 1, vz = nz + 1;
    const pos = new Float32Array(vx * vz * 3), uv = new Float32Array(vx * vz * 2);
    for (let j = 0; j < vz; j++) for (let q = 0; q < vx; q++) {
      const v = j * vx + q;
      const x = G.x0 + (n0x + q) * G.cs, z = G.z0 + (n0z + j) * G.cs;
      pos[v * 3] = x; pos[v * 3 + 1] = ground(x, z) + 0.12; pos[v * 3 + 2] = z;
      uv[v * 2] = (n0x + q) / G.n; uv[v * 2 + 1] = (n0z + j) / G.n;
    }
    const idx = [];
    for (let j = 0; j < nz; j++) for (let q = 0; q < nx; q++) {
      const a = j * vx + q, b = a + 1, c = a + vx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, G.mat);
    m.renderOrder = 3; m.name = "wildfireBurnTile";
    FX.burnRoot.add(m);
    G.tiles[k] = m;
  }
  function texSet(i, ch, v) {
    const o = i * 4 + ch, nv = v < 0 ? 0 : (v > 255 ? 255 : v | 0);
    if (G.texData[o] === nv) return;
    G.texData[o] = nv; G.texDirty = true;
    if (nv) tileFor(i);
  }

  /* ---- smoke / embers / ash pools -------------------------------------- */
  // tone: 0 vegetation smoke (grey-tan), 1 structure/car smoke (black)
  function spawnSmoke(x, y, z, surface, dense, tone) {
    if (!fxAlive() || !FX.sFree.length) return;
    const i = FX.sFree.pop();
    const drift = F.wspd * (surface ? 0.75 : 0.5);
    const cw = (jit() - 0.5) * (surface ? 3.2 : 1.6);
    FX.spuff[i] = {
      x: x + (jit() - 0.5) * 1.6, y, z: z + (jit() - 0.5) * 1.6,
      vx: F.wx * drift * (0.4 + jit() * 0.4), vz: F.wz * drift * (0.4 + jit() * 0.4),
      vy: surface ? 0.15 + jit() * 0.25 : 3.2 + jit() * 2.8, cw,
      age: 0, life: surface ? 9 + jit() * 5 : 5 + jit() * 3.5 + (tone ? 2 : 0),
      surface, dense: !!dense, dark: dense ? 0.75 + jit() * 0.25 : 0.5 + jit() * 0.3, tone: tone || 0,
    };
  }
  function spawnEmber(x, y, z, vx, vy, vz, life) {
    if (!fxAlive() || !FX.eFree.length) return;
    const i = FX.eFree.pop();
    FX.epuff[i] = { x, y, z, vx, vy, vz, age: 0, life };
  }

  /* ---- cells -------------------------------------------------------------- */
  function igniteCell(i, why) {
    if (i < 0 || G.st[i] !== 0 || !G.fuel[i]) return false;
    const f = FUELS[G.fuel[i]];
    G.st[i] = 1; G.tIgn[i] = F.clock; G.arr[i] = F.clock;
    G.life[i] = f.burn * (0.8 + 0.4 * h01(i, 7, 0x3c)) * (0.75 + 0.5 * G.load[i]);
    G.act.push(i);
    stats.cellsIgnited++;
    if (why === "spot") stats.spotFires++;
    // schedule the neighbours: minimum travel time
    const n = G.n, ix = i % n, iz = (i / n) | 0, cs = G.cs, gy = G.gy[i];
    // Alexander (1985): length-to-breadth from the 10 m open wind, km/h
    const lb = Math.min(6, 1 + 8.729 * Math.pow(1 - Math.exp(-0.03 * F.wspd * 3.6), 2.155));
    for (let k = 0; k < NB.length; k++) {
      const jx = ix + NB[k][0], jz = iz + NB[k][1];
      if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
      const j = jz * n + jx;
      if (G.st[j] !== 0 || !G.fuel[j]) continue;
      const fj = FUELS[G.fuel[j]];
      const d = NB[k][2] * cs;
      const ux = NB[k][0] / NB[k][2], uz = NB[k][1] / NB[k][2];
      const U = F.wspd * fj.waf;                     // midflame wind, m/s
      const phiW = 0.9 * Math.pow(U, 1.35);
      const LB = lb;
      const e = LB > 1.0001 ? Math.sqrt(LB * LB - 1) / LB : 0;
      const cosT = ux * F.wx + uz * F.wz;
      const shape = (1 - e) / (1 - e * cosT);
      const deg = Math.atan2(G.gy[j] - gy, d) * 57.2958;
      const slope = Math.max(0.25, Math.pow(2, deg / 10));    // McArthur
      const ros = fj.r0 * G.load[j] * (1 + phiW) * shape * slope;
      const t = F.clock + d / Math.max(0.02, ros);
      if (t < G.arr[j]) {
        G.arr[j] = t;
        if (!G.inPend[j]) { G.inPend[j] = 1; G.pend.push(j); }
      }
      // the grass ahead cures in the heat: it browns before it catches
      if (k < 8 && G.texData[j * 4 + 2] < 200) texSet(j, 2, G.texData[j * 4 + 2] + 70);
    }
    texSet(i, 2, 0);
    return true;
  }
  // a disc of bed set alight at a given rate (a torching crown raining
  // burning material, a car's tank, a collapsing house)
  function igniteDisc(x, z, r, speed) {
    if (!G.ready) return;
    const c = cellOf(x, z); if (c < 0) return;
    const ri = Math.ceil(r / G.cs), n = G.n, cx = c % n, cz = (c / n) | 0;
    for (let dz = -ri; dz <= ri; dz++) for (let dx = -ri; dx <= ri; dx++) {
      const ix = cx + dx, iz = cz + dz;
      if (ix < 0 || iz < 0 || ix >= n || iz >= n) continue;
      const d = Math.hypot(dx, dz) * G.cs; if (d > r) continue;
      const j = iz * n + ix;
      if (G.st[j] !== 0 || !G.fuel[j]) continue;
      const t = F.clock + d / speed;
      if (t < G.arr[j]) { G.arr[j] = t; if (!G.inPend[j]) { G.inPend[j] = 1; G.pend.push(j); } }
    }
  }
  function cellI(i) {   // flame intensity 0..1 of a flaming cell
    const age = F.clock - G.tIgn[i], L = G.life[i];
    return Math.min(1, age / 0.6) * Math.min(1, Math.max(0, (L - age) / (L * 0.35)));
  }

  function cellsTick(dtc, live) {
    // ignite what the front has reached
    if (live) {
      const P = G.pend;
      for (let k = P.length - 1; k >= 0; k--) {
        const j = P[k];
        if (G.st[j] !== 0) { G.inPend[j] = 0; P[k] = P[P.length - 1]; P.pop(); continue; }
        if (G.arr[j] <= F.clock) {
          G.inPend[j] = 0; P[k] = P[P.length - 1]; P.pop();
          igniteCell(j, "front");
        }
      }
    }
    // flaming -> smouldering -> burnt, and the texture's char + glow
    const A = G.act; let fl = 0;
    for (let k = A.length - 1; k >= 0; k--) {
      const i = A[k];
      const age = F.clock - G.tIgn[i], f = FUELS[G.fuel[i]];
      if (G.st[i] === 1) {
        if (age >= G.life[i]) { G.st[i] = 2; }
        else {
          fl++;
          texSet(i, 1, 255 * cellI(i));
          texSet(i, 0, 255 * Math.min(1, age / G.life[i]) * 0.9 + 25);
          continue;
        }
      }
      const sa = age - G.life[i], S = f.smoulder;
      if (sa >= S) {
        G.st[i] = 3; G.burntN++; stats.burntM2 += G.cs * G.cs;
        texSet(i, 0, 255); texSet(i, 1, 0);
        A[k] = A[A.length - 1]; A.pop();
      } else {
        texSet(i, 0, 255);
        texSet(i, 1, 150 * (1 - sa / S) * (1 - sa / S));
      }
    }
    G.flamingN = fl;
  }

  // the starved fire: every flaming cell drops to its glowing bed, nothing
  // new is scheduled (what the director's timer does to the run)
  function cellsStarve() {
    for (let k = 0; k < G.act.length; k++) {
      const i = G.act[k];
      if (G.st[i] === 1) { G.life[i] = Math.max(0, F.clock - G.tIgn[i]); G.st[i] = 2; }
    }
    for (let k = 0; k < G.pend.length; k++) G.inPend[G.pend[k]] = 0;
    G.pend.length = 0;
  }

  /* ---- trees ------------------------------------------------------------ */
  function canopyY(t) { return t.foliage ? t.foliage.position.y : ground(t.x, t.z) + 3.5; }
  function crownR(t) {
    const g = t.foliage && t.foliage.geometry;
    if (g && !g.boundingSphere) g.computeBoundingSphere();
    return g && g.boundingSphere ? g.boundingSphere.radius * 0.8 * (t.foliage.scale.x || 1) : 1.6;
  }
  function isPalm(t) {
    const m = t._wfLeafMat || (t.foliage && t.foliage.material);
    return !!(t.palm || (m && (m.name || "").indexOf("palm") >= 0));
  }

  function restoreTree(t) {
    if (t.foliage) {
      if (t._wfLeafGeo) { t.foliage.geometry = t._wfLeafGeo; t._wfLeafGeo = null; }
      if (t._wfLeafMat) { t.foliage.material = t._wfLeafMat; t._wfLeafMat = null; }
      if (t._wfDepth !== undefined) { t.foliage.customDepthMaterial = t._wfDepth; t._wfDepth = undefined; }
      t.foliage.scale.set(1, 1, 1);
      t.foliage.visible = true;
      if (t.foliage.material && t.foliage.material.emissive) { t.foliage.material.emissive.setHex(0x000000); t.foliage.material.emissiveIntensity = 1; }
    }
    t._wfHeat = 0; t._wfFuel = 0; t._wfCharred = false; t._wfScorched = false; t._wfGround = 0;
  }

  function igniteTree(t, why, src) {
    if (t.burnt || t.burning) return;
    t._wfFuel = 5.5 + rnd() * 2.5;
    t.burning = t._wfFuel;                     // the SAME live field every other def reads
    t._wfHeat = 1;
    stats.ignitions++;
    if (why !== "seed") stats.treesTorched++;
    if (why === "spot") stats.spotFires++;
    if (t.foliage && t.foliage.material) {
      // fuel is dark behind fire: the tongues own the light, the crown glows
      // evenly from within instead of showing a sun-shaded slab
      t.foliage.material.color.setHex(0x0c0705);
      if (t.foliage.material.emissive) { t.foliage.material.emissive.setHex(0x5a1c04); t.foliage.material.emissiveIntensity = 0.40; }
    }
    // a torching crown rains burning material on the bed around and downwind
    igniteDisc(t.x + F.wx * 1.5, t.z + F.wz * 1.5, 3.5 + 2 * F.mag, 2.2);
    if (src) igniteDisc((src.x + t.x) / 2, (src.z + t.z) / 2, 2.5, 2.5);
    if (CBZ.sfxAt) CBZ.sfxAt("fire", t.x, t.z); else if (CBZ.sfx) CBZ.sfx("fire");
  }

  function charTree(t) {
    t.burning = 0; t.burnt = true; t._wfCharred = true;
    if (t.foliage) {
      const S = snagParts();
      if (!t._wfLeafMat) t._wfLeafMat = t.foliage.material;
      if (t._wfDepth === undefined) t._wfDepth = t.foliage.customDepthMaterial;
      t.foliage.customDepthMaterial = undefined;
      if (isPalm(t)) {
        // the fronds burn to black ribs that hang
        t.foliage.material = S.frond;
        t.foliage.scale.set(0.78, 0.62, 0.78);
      } else {
        // the crown is gone: what stands is the charred frame of limbs
        const r = crownR(t);
        if (!t._wfLeafGeo) t._wfLeafGeo = t.foliage.geometry;
        t.foliage.geometry = S.geo;
        t.foliage.material = S.mat;
        const k = Math.max(0.7, Math.min(1.5, r / 2.0));
        t.foliage.scale.set(k, k, k);
      }
    }
    if (t.trunk && t.trunk.material) t.trunk.material.color.setHex(0x140d08);
    igniteDisc(t.x, t.z, 3, 3);
    if (CBZ.debris) CBZ.debris.chips(t.x, ground(t.x, t.z) + 3, t.z, { kind: "wood", color: 0x1a1410, count: 14, power: 0.6, spread: 2, size: 0.06, dustColor: 0x5a5550 });
  }
  // the surface fire passed under and did not take the crown: a black trunk
  // under a heat-browned crown, the commonest tree in any burn scar
  function scorchTree(t) {
    if (t._wfScorched || t.burnt || t.burning) return;
    t._wfScorched = true; stats.treesScorched++;
    if (t.trunk && t.trunk.material) t.trunk.material.color.setHex(0x2a1d14);
    if (t.foliage && t.foliage.material) t.foliage.material.color.lerp(new THREE.Color(0x6b5320), 0.45);
  }

  function treesTick(dt, warn, live) {
    const tr = (world() && world().flammable) || [];
    const B = F.burningList; B.length = 0;
    for (let i = 0; i < tr.length; i++) if (tr[i].burning > 0) B.push(tr[i]);
    if (!live) return;
    // burn down + emit
    for (let i = 0; i < B.length; i++) {
      const t = B[i];
      t.burning -= dt;
      const age = t._wfFuel - t.burning;
      const ph = Math.min(1, age / 1.1) * Math.min(1, Math.max(0, t.burning) / 1.6);
      t._wfPh = ph;
      const y = canopyY(t) + 1.2;
      const rate = (6 + 20 / B.length) * ph * dt * (0.7 + 0.6 * F.mag);
      if (jit() < rate) spawnSmoke(t.x, y, t.z, false, true, 0);
      if (jit() < rate * 1.6) spawnSmoke(t.x, ground(t.x, t.z) + 1.2, t.z, true, true, 0);
      if (jit() < rate * 0.8) spawnSmoke(t.x + F.wx * 6, ground(t.x, t.z) + 1.6, t.z + F.wz * 6, true, false, 0);
      if (jit() < 9 * ph * dt * (0.55 + 0.9 * F.mag)) spawnEmber(t.x + (jit() - 0.5) * 2, y - 1 + jit() * 2, t.z + (jit() - 0.5) * 2,
        (jit() - 0.5) * 2 + F.wx * F.wspd * 0.3, 2 + jit() * 3, (jit() - 0.5) * 2 + F.wz * F.wspd * 0.3, 0.7 + jit());
      if (t.burning <= 0) { charTree(t); B.splice(i, 1); i--; }
    }
    // the bed under a crown heats it: the ladder from surface to crown fire
    if (G.ready) {
      const torch = (0.06 + 0.5 * F.mag + 0.2 * F.wspd / 19) * (warn ? 0.3 : 1);
      const n = G.n;
      for (let k = 0; k < tr.length; k++) {
        const t = tr[k];
        if (t.burning || t.burnt || t._wfCell == null) continue;
        const c = t._wfCell, cx = c % n, cz = (c / n) | 0;
        let I = 0, done = 0, tot = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const ix = cx + dx, iz = cz + dz;
          if (ix < 0 || iz < 0 || ix >= n || iz >= n) continue;
          const j = iz * n + ix;
          if (!G.fuel[j]) continue;
          tot++;
          if (G.st[j] === 1) I += cellI(j) * FUELS[G.fuel[j]].heat;
          else if (G.st[j] >= 2) done++;
        }
        if (I > 0) {
          t._wfHeat = (t._wfHeat || 0) + dt * torch * Math.min(2.5, I) * (0.7 + 0.6 * h01(c, 3, 0x71));
          if (warn && t._wfHeat > 0.95) t._wfHeat = 0.95;
          if (t._wfHeat >= 1) igniteTree(t, "ground");
        } else if (tot && done === tot && t._wfHeat > 0.08) scorchTree(t);
      }
    }
    // crown to crown: elliptical about the wind, uphill-fast
    F.spreadCd -= dt;
    if (F.spreadCd <= 0 && B.length) {
      const step = 0.35;
      F.spreadCd = step;
      const gain = 0.6 + 1.3 * F.mag;
      for (let i = 0; i < B.length; i++) {
        const b = B[i]; if (b._wfPh != null && b._wfPh < 0.25) continue;
        const gy = ground(b.x, b.z);
        for (let j = 0; j < tr.length; j++) {
          const o = tr[j]; if (o.burning || o.burnt) continue;
          const dx = o.x - b.x, dz = o.z - b.z;
          const d = Math.hypot(dx, dz);
          if (d > F.reach || d < 0.01) continue;
          const align = (dx * F.wx + dz * F.wz) / d;
          const wind = (align < 0 ? 0.30 + 0.10 * align : 0.30) +
            2.1 * Math.pow(Math.max(0, align), 1.6) * (0.55 + F.wspd / 24);
          const rise = ground(o.x, o.z) - gy;
          const slope = Math.pow(2, Math.max(-2.5, Math.min(9, rise)) / 3);
          const near = 1 - d / F.reach;
          o._wfHeat = (o._wfHeat || 0) + step * (warn ? gain * 0.3 : gain) * wind * slope * near * (0.85 + rnd() * 0.3);
          if (warn && o._wfHeat > 0.95) o._wfHeat = 0.95;
          if (o._wfHeat >= 1) igniteTree(o, "crown", b);
          else if (o._wfHeat > 0.15 && o.foliage && o.foliage.material && !o._wfScorched) {
            const u = Math.min(1, o._wfHeat);     // the crown DRIES on camera
            o.foliage.material.color.setRGB(0.25 + 0.36 * u, 0.60 - 0.20 * u, 0.31 - 0.16 * u);
          }
        }
      }
    }
  }

  /* ---- buildings -------------------------------------------------------- */
  function bRec(b) {
    if (b._wf) return b._wf;
    const storeys = Math.max(1, b.storeys || Math.round((b.h || 6) / 3.2));
    const FH = (b.h || storeys * 3.2) / storeys;
    const gy = b.gy != null ? b.gy : ground(b.x, b.z);
    const tower = storeys >= 6 || (b.h || 0) > 19;
    const slots = [];
    for (let f = 0; f < 4; f++) {
      const len = f < 2 ? b.w : b.d;
      const ns = Math.max(1, Math.min(4, Math.round(len / 3.6)));
      for (let s = 0; s < ns; s++) {
        const u = (s + 0.5) / ns - 0.5;
        const x = f < 2 ? b.x + u * b.w : b.x + (f === 2 ? -1 : 1) * (b.w / 2 + 0.3);
        const z = f < 2 ? b.z + (f === 0 ? -1 : 1) * (b.d / 2 + 0.3) : b.z + u * b.d;
        slots.push({ x, z, nx: f < 2 ? 0 : (f === 2 ? -1 : 1), nz: f < 2 ? (f === 0 ? -1 : 1) : 0, d: h01(Math.round(x * 3), Math.round(z * 3), 0x51) });
      }
    }
    const fl = [];
    for (let k = 0; k < storeys; k++) fl.push({ s: 0, t: 0, T: (11 + 6 * h01(k, Math.round(b.x), 0x52)) * (tower ? 1.5 : 1) });
    b._wf = { fl, slots, storeys, FH, gy, tower, heat: 0, ember: 0, dep: 0, burning: 0, rubble: 0, done: false, igAt: -1, vuln: tower ? 0.3 : 1 };
    return b._wf;
  }
  function igniteFloor(b, k, how) {
    if (F.quench) return;              // the calm: what burns burns out, nothing new catches
    const r = bRec(b);
    k = Math.max(0, Math.min(r.storeys - 1, k));
    if (r.fl[k].s !== 0 || b.fallen) return;
    r.fl[k].s = 1; r.fl[k].t = 0;
    if (r.igAt < 0) {
      r.igAt = F.t; stats.bldIgnited++;
      if (how === "vent") stats.bldByVent++; else if (how === "window") stats.bldByWindow++; else if (how === "heat") stats.bldByHeat++;
      if (CBZ.sfxAt) CBZ.sfxAt("fire", b.x, b.z);
    }
  }
  // an ember in the attic vent lights the top floor; one through a window or
  // onto a deck lights a low one
  function emberIntoBuilding(b, how) {
    const r = bRec(b);
    if (how === "vent") igniteFloor(b, r.storeys - 1, "vent");
    else igniteFloor(b, Math.min(r.storeys - 1, (rnd() * Math.min(2, r.storeys)) | 0), "window");
  }
  function distToBuilding(b, x, z) {
    const ex = Math.max(0, Math.abs(x - b.x) - b.w / 2), ez = Math.max(0, Math.abs(z - b.z) - b.d / 2);
    return Math.hypot(ex, ez);
  }
  // nothing alight anywhere = nothing to be exposed to (sources is last
  // frame's list: it holds every burning house and car)
  function anyHeat() { return G.flamingN > 0 || F.burningList.length > 0 || F.sources.length > 0; }
  function buildingsTick(dt, live) {
    const A = world(); const L = (A && A.fragile) || [];
    const hot = live && anyHeat();
    // the service (another disaster's fires) prices exposure on a quarter of
    // the houses a frame, each with 4x the dt: the same heat, a quarter the reads
    const stride = F.svc ? 4 : 1;
    for (let k = 0; k < L.length; k++) {
      const b = L[k];
      const r = b._wf;
      if (!r && (!hot || b.fallen)) continue;
      // ---- exposure: contact/radiant from what burns around it ----------
      if (hot && !b.fallen && !(r && r.done) && (stride === 1 || (k + F.frame) % stride === 0)) {
        const dtE = dt * stride;
        let q = 0;
        if (G.ready) {
          // the bed along its walls
          const c0 = cellOf(b.x - b.w / 2 - 3, b.z - b.d / 2 - 3), c1 = cellOf(b.x + b.w / 2 + 3, b.z + b.d / 2 + 3);
          if (c0 >= 0 && c1 >= 0) {
            const n = G.n, x0 = c0 % n, z0 = (c0 / n) | 0, x1 = c1 % n, z1 = (c1 / n) | 0;
            for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
              const j = iz * n + ix;
              if (G.st[j] === 1) q += 0.12 * cellI(j) * FUELS[G.fuel[j]].heat;
            }
          }
        }
        for (let i = 0; i < F.burningList.length; i++) {
          const t = F.burningList[i];
          const d = distToBuilding(b, t.x, t.z);
          if (d < 8) q += 0.35 * (t._wfPh || 0) * (1 - d / 8);
        }
        const cars = (A && A.cars) || [];
        for (let i = 0; i < cars.length; i++) {
          const c = cars[i]._wf; if (!c || c.s !== 1) continue;
          const p = cars[i].group.position, d = distToBuilding(b, p.x, p.z);
          if (d < 5) q += 0.3 * (1 - d / 5);
        }
        for (let i = 0; i < L.length; i++) {
          const o = L[i]; if (o === b || !o._wf || !o._wf.burning) continue;
          const d = Math.max(0, Math.hypot(o.x - b.x, o.z - b.z) - (o.w + o.d) / 4 - (b.w + b.d) / 4);
          if (d < 10) q += 0.18 * o._wf.burning * (1 - d / 10);
        }
        if (q > 0) {
          const rr = bRec(b);
          rr.heat += dtE * q * rr.vuln;
          if (rr.heat >= 1 && !rr.fl[0].s) igniteFloor(b, 0, "heat");
        }
        // EMBER ATTACK: the shower in the plume finds a vent or a window
        const ef = emberAt(b.x, b.z);
        if (ef > 0.05) {
          const rr = bRec(b);
          const lam = 0.10 * ef * rr.vuln * (0.4 + F.mag);
          if (rnd() < 1 - Math.exp(-lam * dtE)) emberIntoBuilding(b, rnd() < 0.6 ? "vent" : "window");
          if (jit() < ef * dtE * 6) spawnEmber(b.x + (jit() - 0.5) * b.w, rr.gy + rr.FH * rr.storeys + 1.5, b.z + (jit() - 0.5) * b.d,
            F.wx * 1.5 + (jit() - 0.5), -0.6, F.wz * 1.5 + (jit() - 0.5), 1.2);
        }
      }
      if (!r) continue;
      // ---- the fire inside: flashover, up fast, down slow ----------------
      let burning = 0, consumed = 0;
      for (let f = 0; f < r.storeys; f++) {
        const fl = r.fl[f];
        if (fl.s === 1) {
          fl.t += dt;
          const I = Math.min(1, fl.t / 3.5) * Math.min(1, (fl.T - fl.t) / (fl.T * 0.25));
          fl.I = Math.max(0, I);
          burning += fl.I;
          if (fl.t > (r.tower ? 7 : 3.2) && f + 1 < r.storeys && r.fl[f + 1].s === 0) igniteFloor(b, f + 1);
          if (fl.t > (r.tower ? 16 : 8) && f > 0 && r.fl[f - 1].s === 0) igniteFloor(b, f - 1);
          if (fl.t >= fl.T) { fl.s = 2; fl.I = 0; stats.bldFloorsBurnt++; }
        }
        consumed += fl.s === 2 ? 1 : (fl.s === 1 ? Math.min(1, fl.t / fl.T) : 0);
      }
      r.burning = b.fallen ? 0 : burning;
      consumed /= r.storeys;
      // the burn is paid into THE structural ledger: glass, then the frame
      if (!b.fallen && consumed > 0) {
        const target = r.tower ? Math.min(0.69, consumed * 0.8) : Math.min(1.05, consumed / 0.55);
        if (target > r.dep + 0.02) {
          const amt = target - r.dep; r.dep = target;
          const br = F.bridge;
          if (br && br.hitBuilding) { try { br.hitBuilding(b, amt, { kind: "fire" }); } catch (e) {} }
          if (b.fallen) {
            stats.bldCollapsed++;
            r.rubble = 16 + 6 * h01(Math.round(b.x), Math.round(b.z), 0x53);
            for (let f = 0; f < r.storeys; f++) if (r.fl[f].s === 1) r.fl[f].s = 2;
            igniteDisc(b.x, b.z, Math.max(b.w, b.d) * 0.5 + 6, 4);
          }
        }
      }
      if (!r.done && consumed >= 0.999) { r.done = true; if (!b.fallen) stats.bldGutted++; }
      if (r.rubble > 0) r.rubble -= dt;
      // smoke: black, off every burning storey's windows and the roof
      if (burning > 0 || r.rubble > 0) {
        const top = r.gy + r.FH * r.storeys;
        const R = (burning + (r.rubble > 0 ? 1.2 : 0));
        if (jit() < 7 * R * dt) {
          const s = r.slots[(jit() * r.slots.length) | 0];
          spawnSmoke(s.x, b.fallen ? r.gy + 2 : top + 1, s.z, false, true, 1);
        }
        if (jit() < 3 * R * dt) spawnSmoke(b.x + F.wx * 4, r.gy + 1.4, b.z + F.wz * 4, true, true, 1);
        if (jit() < 4 * R * dt) spawnEmber(b.x + (jit() - 0.5) * b.w, (b.fallen ? r.gy + 2 : top) + 1, b.z + (jit() - 0.5) * b.d,
          (jit() - 0.5) * 2 + F.wx * F.wspd * 0.3, 2 + jit() * 3, (jit() - 0.5) * 2 + F.wz * F.wspd * 0.3, 0.9 + jit());
      }
    }
  }

  /* ---- cars ------------------------------------------------------------- */
  function carPos(c) { return c.group ? c.group.position : { x: c.x, y: 0, z: c.z }; }
  function charCar(c) {
    const r = c._wf; if (!c.group || r.charred) return;
    r.charred = true; r.orig = [];
    const S = snagParts();
    c.group.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      r.orig.push([o, o.material, o.visible]);
      // the glass is gone in the heat; everything else is a charred shell
      if (m && (m.transparent || (m.opacity != null && m.opacity < 0.99))) o.visible = false;
      else o.material = S.carMat;
    });
  }
  function carRec(c, p) {
    return c._wf || (c._wf = { s: 0, heat: 0, t: 0, boomAt: 6 + 4 * h01(Math.round(p.x), Math.round(p.z), 0x61), boomed: false, charred: false });
  }
  function restoreCar(c) {
    const r = c._wf;
    if (r && r.orig) r.orig.forEach((e) => { e[0].material = e[1]; e[0].visible = e[2]; });
    c._wf = null;
  }
  function carsTick(dt, live) {
    const A = world(); const L = (A && A.cars) || [];
    const hot = live && anyHeat();
    const stride = F.svc ? 4 : 1;
    for (let k = 0; k < L.length; k++) {
      const c = L[k];
      if (c.flung || c.dead && !c._wf) continue;
      let r = c._wf;
      if (!r && !hot) continue;
      const p = carPos(c);
      if (hot && (!r || r.s === 0) && (stride === 1 || (k + F.frame) % stride === 0)) {
        const dtE = dt * stride;
        let q = 0;
        const ci = cellOf(p.x, p.z);
        if (ci >= 0) {
          const n = G.n, cx = ci % n, cz = (ci / n) | 0;
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const ix = cx + dx, iz = cz + dz;
            if (ix < 0 || iz < 0 || ix >= n || iz >= n) continue;
            const j = iz * n + ix;
            if (G.st[j] === 1) q += 0.45 * cellI(j) * FUELS[G.fuel[j]].heat;
          }
        }
        for (let i = 0; i < F.burningList.length; i++) {
          const t = F.burningList[i], d = Math.hypot(t.x - p.x, t.z - p.z);
          if (d < 6) q += 0.4 * (t._wfPh || 0) * (1 - d / 6);
        }
        const B = (A && A.fragile) || [];
        for (let i = 0; i < B.length; i++) {
          const b = B[i]; if (!b._wf || !b._wf.burning) continue;
          const d = distToBuilding(b, p.x, p.z);
          if (d < 5) q += 0.35 * Math.min(2, b._wf.burning) * (1 - d / 5);
        }
        for (let i = 0; i < L.length; i++) {
          const o = L[i]; if (o === c || !o._wf || o._wf.s !== 1) continue;
          const op = carPos(o), d = Math.hypot(op.x - p.x, op.z - p.z);
          if (d < 5) q += 0.3 * (1 - d / 5);
        }
        if (q > 0) {
          r = carRec(c, p);
          r.heat += dtE * q;
          if (r.heat >= 1 && !F.quench) { r.s = 1; r.t = 0; stats.carsBurnt++; }
        }
      }
      if (!r || r.s === 0) continue;
      r.t += dt;
      if (r.s === 1) {
        if (r.t > 3.5) charCar(c);
        if (!r.boomed && r.t >= r.boomAt) {
          r.boomed = true; stats.carsExploded++;
          const br = F.bridge;
          if (br && br.blast) { try { br.blast("carcook", p.x, p.z, { r: 4.5, dmg: 55, cause: "caught in a burning car's blast", knockback: 7, fling: 3 }); } catch (e) {} }
          for (let i = 0; i < 26; i++) spawnEmber(p.x, p.y + 1, p.z, (jit() - 0.5) * 9, 3 + jit() * 6, (jit() - 0.5) * 9, 0.8 + jit() * 0.8);
          for (let i = 0; i < 6; i++) spawnSmoke(p.x, p.y + 1.5, p.z, false, true, 1);
          igniteDisc(p.x, p.z, 6, 6);
          if (!br || !br.blast) { if (CBZ.sfxAt) CBZ.sfxAt("explosion", p.x, p.z); }
        }
        if (r.t >= 22) r.s = 2;
      }
      const I = r.s === 1 ? (r.t < 3.5 ? 0.35 : (r.boomed ? Math.max(0.35, 1 - (r.t - r.boomAt) / 14) : 0.8)) : Math.max(0, 1 - (r.t - 22) / 14);
      r.I = I;
      if (I > 0 && jit() < 6 * I * dt) spawnSmoke(p.x + (jit() - 0.5), p.y + 1.6, p.z + (jit() - 0.5), false, true, 1);
    }
  }

  /* ---- sources: one list the smoke, embers, spotting and heat read --------- */
  let DT_EMIT = 1 / 60;
  function buildSources() {
    const S = F.sources; S.length = 0;
    const B = F.burningList;
    for (let i = 0; i < B.length; i++) {
      const t = B[i], ph = t._wfPh != null ? t._wfPh : 1;
      S.push({ x: t.x, z: t.z, w: 0.3 + 0.7 * ph, ember: ph, kind: 0, y: canopyY(t) + 1.5 });
    }
    // grass/brush blocks (8 x 8 cells) aggregate the bed
    if (G.ready) {
      const bl = G.blk, T = G.blkTouched;
      for (let k = 0; k < T.length; k++) { const b = T[k]; bl[b * 3] = bl[b * 3 + 1] = bl[b * 3 + 2] = 0; }
      T.length = 0;
      for (let k = 0; k < G.act.length; k++) {
        const i = G.act[k]; if (G.st[i] !== 1) continue;
        const b = (((i / G.n) | 0) >> 3) * G.blkN + ((i % G.n) >> 3);
        if (bl[b * 3 + 2] === 0) T.push(b);
        const I = cellI(i);
        bl[b * 3] += cellX(i) * I; bl[b * 3 + 1] += cellZ(i) * I; bl[b * 3 + 2] += I;
      }
      for (let k = 0; k < T.length; k++) {
        const b = T[k], c = bl[b * 3 + 2]; if (c < 0.05) continue;
        const x = bl[b * 3] / c, z = bl[b * 3 + 1] / c;
        const w = Math.min(2.2, c * G.cs * G.cs / 45);
        const gy = ground(x, z);
        S.push({ x, z, w, ember: w * 0.3 * (0.4 + F.mag), kind: 1, n: c, y: gy + 2 });
        // a grass/brush run smokes pale and fast: a low sheet off the front
        // and, once the block is really going, its own column
        const r = (2.5 + 5 * w) * DT_EMIT;
        const half = G.cs * 4;
        if (jit() < r) spawnSmoke(x + (jit() - 0.5) * half, gy + 1.0, z + (jit() - 0.5) * half, true, w > 1, 0);
        if (w > 0.6 && jit() < r * 0.6) spawnSmoke(x + (jit() - 0.5) * half, gy + 2.5, z + (jit() - 0.5) * half, false, w > 1.4, 0);
        if (F.mag > 0.4 && jit() < r * 0.5) spawnEmber(x + (jit() - 0.5) * half, gy + 1, z + (jit() - 0.5) * half,
          F.wx * F.wspd * 0.25 + (jit() - 0.5), 1.5 + jit() * 2, F.wz * F.wspd * 0.25 + (jit() - 0.5), 0.6 + jit() * 0.5);
      }
    }
    const A = world();
    const L = (A && A.fragile) || [];
    for (let k = 0; k < L.length; k++) {
      const r = L[k]._wf; if (!r) continue;
      const w = r.burning * 0.6 + (r.rubble > 0 ? 0.8 : 0);
      if (w > 0.05) S.push({ x: L[k].x, z: L[k].z, w: Math.min(3, w), ember: Math.min(2, w * 0.8), kind: 2, b: L[k], y: r.gy + r.FH * r.storeys + 2 });
    }
    const C = (A && A.cars) || [];
    for (let k = 0; k < C.length; k++) {
      const r = C[k]._wf; if (!r || !(r.I > 0)) continue;
      const p = carPos(C[k]);
      S.push({ x: p.x, z: p.z, w: 0.5 * r.I, ember: 0.15 * r.I, kind: 3, y: p.y + 2 });
    }
  }

  /* ---- the smoke + ember fields ----------------------------------------- */
  function plumeLen() { return (22 + 26 * F.mag) + F.wspd * 2.2; }
  function smokeAt(x, z) {
    const S = F.sources;
    if (!S.length) return 0;
    const L = plumeLen();
    let s = 0;
    for (let i = 0; i < S.length; i++) {
      const b = S[i];
      const rx = x - b.x, rz = z - b.z;
      const down = rx * F.wx + rz * F.wz;
      if (down < -4 || down > L) continue;
      const cross = Math.abs(rz * F.wx - rx * F.wz);
      const sig = 3.5 + down * 0.38;
      if (cross > sig * 3) continue;
      const amp = (down < 0 ? 1 + down / 4 : 1 - 0.78 * (down / L)) * b.w;
      s += amp * Math.exp(-(cross * cross) / (2 * sig * sig));
      if (s > 3) return 3;
    }
    return s;
  }
  function emberAt(x, z) {
    const S = F.sources;
    if (!S.length) return 0;
    const L = 12 + 45 * F.mag;
    let s = 0;
    for (let i = 0; i < S.length; i++) {
      const b = S[i]; if (b.ember < 0.05) continue;
      const rx = x - b.x, rz = z - b.z;
      const down = rx * F.wx + rz * F.wz;
      if (down < 2 || down > L) continue;
      const cross = Math.abs(rz * F.wx - rx * F.wz);
      const sig = 2.5 + down * 0.3;
      if (cross > sig * 3) continue;
      s += b.ember * (1 - down / L) * Math.exp(-(cross * cross) / (2 * sig * sig));
    }
    return s;
  }

  /* ---- spotting ------------------------------------------------------------ */
  function spotTick(dt) {
    F.spotCd -= dt;
    const S = F.sources;
    if (F.spotCd <= 0 && S.length) {
      F.spotCd = ((S.length >= 6 ? 1.1 : 2.0) + rnd() * 0.8) * (1.85 - 1.45 * F.mag);
      if (F.spots.length < 1 + Math.round(4 * F.mag)) {
        // embers loft off the HEAD's convection column
        let src = null, sd = -1e9;
        for (let i = 0; i < S.length; i++) {
          const s = S[i];
          if (s.kind === 1 ? s.w < 1.2 || F.mag < 0.35 : s.ember < 0.4) continue;
          const d0 = s.x * F.wx + s.z * F.wz;
          if (d0 > sd) { sd = d0; src = s; }
        }
        if (src) {
          const grass = src.kind === 1;
          const D = grass ? 6 + rnd() * 16 * F.mag : (10 + 10 * F.mag) + rnd() * (12 + 55 * F.mag);
          const cross = (rnd() - 0.5) * (8 + 12 * F.mag);
          let lx = src.x + F.wx * D - F.wz * cross;
          let lz = src.z + F.wz * D + F.wx * cross;
          const A = world(), ox = lx - A.center.x, oz = lz - A.center.z, od = Math.hypot(ox, oz);
          if (od > A.radius - 4) { lx = A.center.x + ox / od * (A.radius - 4); lz = A.center.z + oz / od * (A.radius - 4); }
          const dist = Math.hypot(lx - src.x, lz - src.z);
          F.spots.push({
            sx: src.x, sy: src.y, sz: src.z, lx, lz, dist,
            u: 0, T: (0.9 + dist / 26) * (1.15 - 0.55 * F.mag), arc: 4 + dist * 0.14,
          });
          stats.spotLaunched++;
        }
      }
    }
    for (let i = F.spots.length - 1; i >= 0; i--) {
      const p = F.spots[i];
      p.u += dt / p.T;
      const u = Math.min(1, p.u);
      const x = p.sx + (p.lx - p.sx) * u, z = p.sz + (p.lz - p.sz) * u;
      const y = p.sy + (ground(x, z) + 0.3 - p.sy) * u + Math.sin(Math.PI * u) * p.arc;
      spawnEmber(x, y, z, (jit() - 0.5), 0.5, (jit() - 0.5), 0.35);
      if (p.u >= 1) {
        F.spots.splice(i, 1);
        F.smoulders.push({ x: p.lx, z: p.lz, t: (0.9 + rnd() * 0.8) * (1.2 - 0.6 * F.mag), dist: p.dist });
      }
    }
    for (let i = F.smoulders.length - 1; i >= 0; i--) {
      const m = F.smoulders[i];
      m.t -= dt;
      if (jit() < 5 * dt) spawnEmber(m.x + (jit() - 0.5), ground(m.x, m.z) + 0.3, m.z + (jit() - 0.5), 0, 0.8, 0, 0.4);
      if (jit() < 2.5 * dt) spawnSmoke(m.x, ground(m.x, m.z) + 0.8, m.z, true, false, 0);
      if (m.t > 0) continue;
      F.smoulders.splice(i, 1);
      landEmber(m.x, m.z, m.dist);
    }
  }
  // where an ember lands decides whether it takes
  function landEmber(x, z, dist) {
    const A = world();
    const L = (A && A.fragile) || [];
    for (let k = 0; k < L.length; k++) {
      const b = L[k]; if (b.fallen) continue;
      const d = distToBuilding(b, x, z);
      if (d > 2.5) continue;
      if (rnd() < 0.55 * bRec(b).vuln) {
        emberIntoBuilding(b, d <= 0 ? "vent" : "window");
        stats.spotFires++;
        if (dist > stats.spotMaxM) stats.spotMaxM = Math.round(dist);
        return;
      }
    }
    const i = cellOf(x, z);
    if (i >= 0 && G.st[i] === 0 && G.fuel[i] && rnd() < FUELS[G.fuel[i]].catch * (0.55 + 0.45 * F.mag)) {
      igniteCell(i, "spot");
      if (dist > stats.spotMaxM) stats.spotMaxM = Math.round(dist);
      return;
    }
    stats.spotFizzled++;
    if (i >= 0 && G.st[i] === 0) texSet(i, 2, Math.max(G.texData[i * 4 + 2], 160));
  }

  /* ---- lifecycle -------------------------------------------------------- */
  function wrapReset(A) {
    if (A._wfResetWrapped) return;
    A._wfResetWrapped = true;
    const orig = A.reset;
    A.reset = function () {
      (A.flammable || []).forEach(restoreTree);
      (A.cars || []).forEach(restoreCar);
      (A.fragile || []).forEach((b) => { b._wf = null; });
      hardStop();
      if (G.arena === A) gridStart(A);      // regrown: a fresh, unburnt bed
      FX = null;                             // transient sweep in orig() takes the meshes
      return orig ? orig.apply(A, arguments) : undefined;
    };
  }

  /* ctx.arena: the world (the island arena, or a lab world of the same shape:
       center, radius, groundHeightAt, flammable, fragile, cars, root, oceanY?,
       onRoad?, landcoverAt?)
     ctx.intensity: the round's escalation; ctx.wind: {x, z, speed} to pin it.
     bridge: what the host lends: hitBuilding(b, amount, opts) (the structural
       ledger), blast(kind, x, z, opts) (a car's tank), sheltered(actor). */
  function beginWarn(ctx, bridge) {
    const A = ctx.arena;
    F.arena = A; F.bridge = bridge || null;
    F.live = true; F.after = false; F.svc = false; F.svcQ.length = 0; F.t = 0; F.intensity = ctx.intensity || 0; F.quench = false;
    F.spreadCd = 0; F.spotCd = 2.4; F.smokeLinger = 0;
    F.spots.length = 0; F.smoulders.length = 0; F.burningList.length = 0; F.sources.length = 0;
    zeroStats();
    buildFX(A.root); wrapReset(A);
    gridEnsure(A);   // finishes a sliced prebuild, or builds it now
    (A.flammable || []).forEach((t) => { if (!t.burnt && !t.burning) { t._wfHeat = 0; t._wfFuel = 0; } });

    const I = Math.max(0, Math.min(1.7, F.intensity));
    F.mag = F._forceMag != null ? F._forceMag : Math.pow(rnd(), 1 / (0.55 + 0.62 * I));
    const w = ctx.wind || (CBZ.weatherWind ? CBZ.weatherWind() : null);
    if (w && (w.speed > 0.5 || ctx.wind)) { const m = Math.hypot(w.x, w.z) || 1; F.wx = w.x / m; F.wz = w.z / m; }
    else { const a = rnd() * 6.28; F.wx = Math.cos(a); F.wz = Math.sin(a); }
    F.wspd = ctx.wind && ctx.wind.speed != null ? ctx.wind.speed : 4 + 15 * F.mag;
    F.reach = 7 + 11 * F.mag;     // crown-to-crown: only a big, windy fire jumps the gaps
    F.scarAge = 0;
    if (G.mat) G.mat.uniforms.uAge.value = 0;      // a new fire re-blackens the old ash
    F.veer = ctx.wind ? 0 : (rnd() - 0.5) * 0.05;   // a pinned wind stays pinned

    /* THE SEED IS UPWIND, on the main island: a downwind-edge seed has no
       fuel to run into, and an islet's palm cannot reach the island. */
    const cx = A.center.x, cz = A.center.z;
    const tr = A.flammable || [];
    const cands = ctx.seed ? [ctx.seed] : tr.filter((t) => !t.burnt && Math.hypot(t.x - cx, t.z - cz) < A.radius * 0.85);
    cands.sort((a, b) => ((a.x - cx) * F.wx + (a.z - cz) * F.wz) - ((b.x - cx) * F.wx + (b.z - cz) * F.wz));
    F.seed = cands.length ? cands[(rnd() * Math.min(6, cands.length)) | 0] : null;
    if (F.seed && F.seed.foliage !== undefined) {
      igniteTree(F.seed, "seed");
      // the seed torches through the WHOLE warn phase: its column is the telegraph
      F.seed._wfFuel += 5.5; F.seed.burning = F.seed._wfFuel;
    } else if (F.seed) {
      const c = cellOf(F.seed.x, F.seed.z); if (c >= 0) igniteCell(c, "seed");
    }
  }

  function begin(ctx) {
    F.intensity = ctx.intensity || F.intensity;
    const tr = (F.arena && F.arena.flammable) || [];
    const s = F.seed;
    if (s) {
      // the fire GROWS out of the seed: an established ground fire round it,
      // its best downwind neighbours drying to the edge
      const c = cellOf(s.x, s.z);
      if (c >= 0) igniteCell(c, "seed");
      igniteDisc(s.x, s.z, 5 + 4 * F.mag, 3);
      const near = tr.filter((t) => t !== s && !t.burning && !t.burnt && Math.hypot(t.x - s.x, t.z - s.z) < F.reach * 1.2);
      near.sort((a, b) => {
        const da = Math.hypot(a.x - s.x, a.z - s.z), db = Math.hypot(b.x - s.x, b.z - s.z);
        const wa = ((a.x - s.x) * F.wx + (a.z - s.z) * F.wz) / (da || 1);
        const wb = ((b.x - s.x) * F.wx + (b.z - s.z) * F.wz) / (db || 1);
        return (db * (1 - wb * 0.7)) - (da * (1 - wa * 0.7));
      });
      const kick = Math.min(1 + Math.round(2.5 * F.mag), near.length);
      for (let i = 0; i < kick; i++) near[i]._wfHeat = Math.max(near[i]._wfHeat || 0, 0.8);
    }
    if (!G.act.length && !tr.some((t) => t.burning) && tr.length) igniteTree(tr[(rnd() * tr.length) | 0], "seed");
  }

  /* the fire's frame. Called by the def during warn and active (and by the
     lab kit). `warn` = the telegraph: one crown torches, the bed round it
     creeps on a slowed clock, no embers loft. */
  function tick(dt, ctx, warn) {
    if (!F.live || !F.arena) return;
    const t0 = performance.now();
    F.intensity = (ctx && ctx.intensity != null) ? ctx.intensity : F.intensity;
    if (!G.ready) gridEnsure(F.arena);
    const ang = Math.atan2(F.wz, F.wx) + F.veer * dt;
    F.wx = Math.cos(ang); F.wz = Math.sin(ang);
    simTick(dt, !!warn, true);
    const ms = performance.now() - t0;
    stats.simMs += ms; stats.simFrames++; if (ms > stats.simMsMax) stats.simMsMax = ms;
  }
  function simTick(dt, warn, live) {
    const dtc = dt * (warn ? WARN_RATE : 1);
    F.clock += dtc;
    treesTick(dt, warn, live);
    if (G.ready) cellsTick(dtc, live);
    buildingsTick(dt, live);
    carsTick(dt, live);
    DT_EMIT = dt;
    buildSources();
    if (live) {
      heatTick(dt);
      if (!warn) spotTick(dt);
      chokeTick(dt);
    }
  }

  function hurtOne(a, dmg, cause, flame) {
    if (!surv() || dmg <= 0) return;
    const deadBefore = a.isPlayer ? CBZ.player.dead : a.dead;
    surv().hurt(a, dmg, { cause });
    const deadAfter = a.isPlayer ? CBZ.player.dead : a.dead;
    if (flame) stats.flameDamage += dmg; else stats.smokeDamage += dmg;
    if (!deadBefore && deadAfter) { if (flame) stats.flameDeaths++; else stats.smokeDeaths++; }
  }

  /* ---- HEAT YOU FEEL BEFORE YOU TOUCH IT ------------------------------------
     Damage ramps with proximity to every flame: the bed (a grass front is
     thin: crossing it fast into the black survives, standing in brush does
     not), torching crowns, burning houses and cars. */
  function heatAt(x, z) {
    let heat = 0, contact = 0;
    const B = F.burningList, R = 7 + 8 * F.mag;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      const ph = b._wfPh != null ? b._wfPh : 1;
      const d = Math.hypot(x - b.x, z - b.z);
      if (d < 2.2 + 1.6 * ph) contact += ph;
      else if (d < R) { const q = 1 - (d - 2.2) / (R - 2.2); heat += ph * q * q; }
    }
    if (G.ready && G.flamingN) {
      const c = cellOf(x, z);
      if (c >= 0) {
        const n = G.n, cx = c % n, cz = (c / n) | 0, ri = Math.ceil(5 / G.cs);
        for (let dz = -ri; dz <= ri; dz++) for (let dx = -ri; dx <= ri; dx++) {
          const ix = cx + dx, iz = cz + dz;
          if (ix < 0 || iz < 0 || ix >= n || iz >= n) continue;
          const j = iz * n + ix; if (G.st[j] !== 1) continue;
          const I = cellI(j) * FUELS[G.fuel[j]].heat;
          const d = Math.hypot(cellX(j) - x, cellZ(j) - z);
          if (d < G.cs * 0.6) contact += I * 0.8;
          else if (d < 5) { const q = 1 - d / 5; heat += I * q * q * 0.6; }
        }
      }
    }
    const A = world();
    const L = (A && A.fragile) || [];
    for (let k = 0; k < L.length; k++) {
      const r = L[k]._wf; if (!r || !(r.burning > 0 || r.rubble > 0)) continue;
      const d = distToBuilding(L[k], x, z);
      if (d < 6) heat += Math.min(1.5, r.burning + (r.rubble > 0 ? 0.6 : 0)) * (1 - d / 6);
    }
    const C = (A && A.cars) || [];
    for (let k = 0; k < C.length; k++) {
      const r = C[k]._wf; if (!r || !(r.I > 0)) continue;
      const p = carPos(C[k]), d = Math.hypot(p.x - x, p.z - z);
      if (d < 1.8) contact += r.I; else if (d < 5) heat += r.I * (1 - d / 5);
    }
    return { heat, contact };
  }
  function heatTick(dt) {
    if (!surv()) return;
    if (!F.sources.length) return;
    surv().forEachActor(function (a) {
      const h = heatAt(a.pos.x, a.pos.z);
      if (h.contact > 0) hurtOne(a, (12 + 24 * F.mag) * Math.min(2, h.contact) * dt, F.svc ? "burned alive in the brush fire" : "burned alive in the wildfire", true);
      else if (h.heat > 0.1) hurtOne(a, (4.5 + 8 * F.mag) * Math.min(1.8, h.heat) * dt, F.svc ? "cooked by the brush fire's heat" : "cooked by the wildfire's heat", true);
    });
  }
  function chokeTick(dt) {
    if (!surv() || !F.sources.length) return;
    const inten = 0.55 + 0.85 * F.mag;
    surv().forEachActor(function (a) {
      const s = smokeAt(a.pos.x, a.pos.z);
      if (s < 0.25) return;
      // a roof helps for a while; the open plume does not
      const shel = sheltered(a) ? 0.35 : 1;
      hurtOne(a, 9 * Math.min(2, s) * shel * inten * dt, F.svc ? "suffocated in the brush fire smoke" : "suffocated in the wildfire smoke", false);
    });
  }
  function sheltered(a) {
    if (F.bridge && F.bridge.sheltered) return !!F.bridge.sheltered(a);
    const plats = CBZ.platforms; if (!plats) return false;
    const head = a.pos.y + 2.1;
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (p.top > head && a.pos.x >= p.minX && a.pos.x <= p.maxX && a.pos.z >= p.minZ && a.pos.z <= p.maxZ) return true;
    }
    return false;
  }

  /* ---- the drawn frame -------------------------------------------------------- */
  function pushFlame(x, y, z, size, alpha, seed) {
    if (FX.flameN >= MAXFLAME) return;
    const g = FX.flame.geometry, j = FX.flameN++;
    const p = g.attributes.position.array;
    p[j * 3] = x; p[j * 3 + 1] = y; p[j * 3 + 2] = z;
    g.attributes.aSize.array[j] = size; g.attributes.aAlpha.array[j] = alpha; g.attributes.aSeed.array[j] = seed;
  }
  function pushGlow(x, y, z, size, alpha) {
    if (FX.glowN >= MAXGLOW) return;
    const g = FX.glow.geometry, j = FX.glowN++;
    const p = g.attributes.position.array;
    p[j * 3] = x; p[j * 3 + 1] = y; p[j * 3 + 2] = z;
    g.attributes.aSize.array[j] = size; g.attributes.aAlpha.array[j] = alpha;
  }

  const CROWN_SPEC = [
    { size: 7.2, rad: 0.0, down: 0.0 },
    { size: 5.8, rad: 0.85, down: 0.25 },
    { size: 4.6, rad: 0.85, down: 0.55 },
  ];
  function drawFlames() {
    FX.flameN = 0; FX.glowN = 0;
    const B = F.burningList;
    // crowns: three tongues in a ring round the trunk
    const n = Math.min(MAXTREEFLAME, B.length);
    for (let i = 0; i < n; i++) {
      const t = B[i];
      const ph = t._wfPh != null ? t._wfPh : 1;
      if (t.foliage) {
        const fuel = Math.max(0, Math.min(1, t.burning / Math.max(0.01, t._wfFuel)));
        const sc = 0.55 + fuel * 0.45;
        t.foliage.scale.set(sc, sc, sc);
      }
      const crownBase = (t.foliage ? t.foliage.position.y - 1.4 : ground(t.x, t.z) + 2);
      const ring = t.x * 0.7 + t.z * 1.3;
      const cr = crownR(t);
      for (let k = 0; k < 3; k++) {
        const s0 = CROWN_SPEC[k];
        const flicker = 0.9 + 0.1 * Math.sin(F.t * (9 + k * 1.7) + t.x * 0.31 + t.z * 0.17);
        const size = s0.size * (0.55 + 0.45 * ph) * flicker * (0.72 + 0.55 * F.mag);
        const a = ring + k * 2.0944;
        pushFlame(t.x + Math.cos(a) * s0.rad * cr + F.wx * s0.down, crownBase + size * 0.43 + k * 0.18,
          t.z + Math.sin(a) * s0.rad * cr + F.wz * s0.down, size, Math.min(1, ph * 1.8) * (0.70 + k * 0.04),
          ((t.x * 0.013 + t.z * 0.017 + k * 0.271) % 1 + 1) % 1);
      }
      pushGlow(t.x, crownBase + 1.5, t.z, 9 * ph * (0.8 + 0.4 * F.mag), 0.35 * ph);
    }
    // the bed: a broken line of low tongues along the front
    if (G.ready && G.flamingN) {
      const budget = MAXFLAME - FX.flameN - 420;
      const per = G.cs > 2.2 ? 2 : 1;
      const stride = Math.max(1, Math.ceil((G.flamingN * per) / Math.max(1, budget)));
      const boost = Math.sqrt(stride);
      const windLen = 1 + 0.035 * F.wspd;
      let q = 0;
      for (let k = 0; k < G.act.length; k++) {
        const i = G.act[k]; if (G.st[i] !== 1) continue;
        if ((q++ % stride) !== 0) continue;
        const I = cellI(i); if (I < 0.05) continue;
        const f = FUELS[G.fuel[i]];
        const ix = i % G.n, iz = (i / G.n) | 0;
        for (let m = 0; m < per; m++) {
          const hx = h01(ix, iz, 0x81 + m), hz = h01(ix, iz, 0x91 + m);
          const x = cellX(i) + (hx - 0.5) * G.cs * 0.9, z = cellZ(i) + (hz - 0.5) * G.cs * 0.9;
          const size = f.flameH * I * (0.75 + 0.6 * F.mag) * (0.8 + 0.4 * hx) * windLen * boost *
            (0.88 + 0.12 * Math.sin(F.t * 11 + ix * 1.3 + iz * 0.7 + m * 2));
          pushFlame(x, G.gy[i] + size * 0.4, z, size, Math.min(1, I * 1.3) * 0.9, (hx * 0.37 + hz * 0.61) % 1);
        }
      }
    }
    // houses: fire out of the window bays of every burning storey
    const A = world();
    const L = (A && A.fragile) || [];
    for (let k = 0; k < L.length; k++) {
      const b = L[k], r = b._wf; if (!r) continue;
      if (b.fallen) {
        if (r.rubble > 0) {
          const I = Math.min(1, r.rubble / 8);
          for (let s = 0; s < r.slots.length; s += 2) {
            const sl = r.slots[s];
            const x = b.x + (sl.x - b.x) * 0.6, z = b.z + (sl.z - b.z) * 0.6;
            const size = 3.4 * I * (0.85 + 0.15 * Math.sin(F.t * 9 + s));
            pushFlame(x, r.gy + 1 + size * 0.4, z, size, I, sl.d);
          }
          pushGlow(b.x, r.gy + 1.5, b.z, Math.max(b.w, b.d) * 1.2, 0.4 * I);
        }
        continue;
      }
      for (let f = 0; f < r.storeys; f++) {
        const fl = r.fl[f]; if (fl.s !== 1 || !(fl.I > 0)) continue;
        const y0 = r.gy + r.FH * f + r.FH * 0.45;
        for (let s = 0; s < r.slots.length; s++) {
          const sl = r.slots[s];
          if (fl.t < sl.d * 2.6) continue;               // the rooms catch one by one
          const I = fl.I * Math.min(1, (fl.t - sl.d * 2.6) / 1.5);
          const size = r.FH * 1.5 * I * (0.85 + 0.15 * Math.sin(F.t * 10 + s * 1.7 + f));
          pushFlame(sl.x + sl.nx * 0.3, y0 + size * 0.38, sl.z + sl.nz * 0.3, size, I, (sl.d + f * 0.31) % 1);
          pushGlow(sl.x + sl.nx * 0.4, y0, sl.z + sl.nz * 0.4, r.FH * 1.6, 0.7 * I);
        }
      }
      // the roof goes when the top floor does
      const top = r.fl[r.storeys - 1];
      if (top.s === 1 && top.I > 0.5 && !r.tower) {
        const I = top.I;
        for (let m = 0; m < 3; m++) {
          const size = (2.5 + Math.min(b.w, b.d) * 0.35) * I * (0.85 + 0.15 * Math.sin(F.t * 8 + m * 2));
          pushFlame(b.x + (m - 1) * b.w * 0.25, r.gy + r.FH * r.storeys + size * 0.4, b.z + (m - 1) * b.d * 0.15, size, I, (m * 0.29 + r.slots[0].d) % 1);
        }
      }
    }
    // cars: the engine bay first, then the whole cabin
    const C = (A && A.cars) || [];
    for (let k = 0; k < C.length; k++) {
      const c = C[k], r = c._wf; if (!r || !(r.I > 0) || r.s === 0) continue;
      const p = carPos(c), yaw = c.group ? c.group.rotation.y : 0;
      const ax = Math.sin(yaw), az = Math.cos(yaw);
      const lit = r.t < 3.5 ? 1 : 4;
      for (let m = 0; m < lit; m++) {
        const u = lit === 1 ? 1.4 : (m - 1.5) * 0.9;
        const size = (lit === 1 ? 1.3 : 2.6) * r.I * (0.85 + 0.15 * Math.sin(F.t * 12 + m * 1.9 + k));
        pushFlame(p.x + ax * u, p.y + 0.9 + size * 0.4, p.z + az * u, size, Math.min(1, r.I * 1.4), (m * 0.23 + k * 0.17) % 1);
      }
      pushGlow(p.x, p.y + 1, p.z, 4.5 * r.I, 0.5 * r.I);
    }
    const fg = FX.flame.geometry;
    fg.setDrawRange(0, FX.flameN);
    fg.attributes.position.needsUpdate = true; fg.attributes.aSize.needsUpdate = true;
    fg.attributes.aAlpha.needsUpdate = true; fg.attributes.aSeed.needsUpdate = true;
    const gg = FX.glow.geometry;
    gg.setDrawRange(0, FX.glowN);
    gg.attributes.position.needsUpdate = true; gg.attributes.aSize.needsUpdate = true; gg.attributes.aAlpha.needsUpdate = true;
  }

  function fxTick(dt) {
    if (!fxAlive()) return;
    const t0 = performance.now();
    F.t += dt; F.frame++;
    // another disaster's fires: the live sim, on only what burns
    if (!F.live && F.svc) svcTick(dt);
    // after the timer: houses and cars burn on, the bed dies down, no spread
    else if (!F.live && F.arena && (F.after || G.act.length)) {
      F.after = false;
      simTick(dt, false, false);
      const A = F.arena;
      F.after = (A.fragile || []).some((b) => b._wf && (b._wf.burning > 0 || b._wf.rubble > 0)) ||
        (A.cars || []).some((c) => c._wf && c._wf.I > 0) || G.act.length > 0;
    }
    const cv = CBZ.canvas;
    const pointScale = Math.max(1, ((cv && cv.height) || 640) * 0.5);
    [FX.flame, FX.smoke, FX.glow, FX.ash].forEach((m) => {
      const u = m.material.uniforms;
      if (u.uTime) u.uTime.value = F.t;
      u.uScale.value = pointScale;
      if (u.uWind) u.uWind.value.set(F.wx, F.wz);
    });
    FX.embers.material.uniforms.uScale.value = pointScale;
    if (G.mat) G.mat.uniforms.uTime.value = F.t;

    drawFlames();

    // the burn texture uploads at ~20 Hz, not per cell change
    G.texCd -= dt;
    if (G.tex && G.texDirty && G.texCd <= 0) { G.tex.needsUpdate = true; G.texDirty = false; G.texCd = 0.05; }

    // smoke: rise, bend downwind, lighten, die
    const sg = FX.smoke.geometry.attributes;
    const sp = sg.position.array, sc = sg.aColor.array, ss = sg.aSize.array, sa = sg.aAlpha.array;
    const ssurf = sg.aSurface.array, shot = sg.aHot.array;
    for (let i = 0; i < MAXSMOKE; i++) {
      const p = FX.spuff[i]; if (!p) continue;
      p.age += dt;
      if (p.age >= p.life) {
        FX.spuff[i] = null; FX.sFree.push(i);
        sp[i * 3] = -9999; sp[i * 3 + 1] = -9999; sp[i * 3 + 2] = -9999;
        ss[i] = 0; sa[i] = 0; shot[i] = 0;
        continue;
      }
      const u = p.age / p.life;
      const grip = p.surface ? 1 : Math.min(1, p.age / 2.2);
      const drift = F.wspd * (p.surface ? 0.75 : 0.55) * grip;
      const cw = p.cw || 0;
      p.vx += ((F.wx * drift - F.wz * cw) - p.vx) * 0.6 * dt;
      p.vz += ((F.wz * drift + F.wx * cw) - p.vz) * 0.6 * dt;
      if (p.surface) p.vy += (0.03 - p.vy) * 0.4 * dt;
      else p.vy += (0.7 - p.vy) * 0.26 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.surface) {
        const g0 = ground(p.x, p.z);
        if (p.y < g0 + 0.9) p.y = g0 + 0.9;
        else if (p.y > g0 + 3.4) p.y = g0 + 3.4;
      }
      sp[i * 3] = p.x; sp[i * 3 + 1] = p.y; sp[i * 3 + 2] = p.z;
      // vegetation smoke is grey-tan and pales as it thins; structure and car
      // smoke is black (plastics, fuel) and stays dark
      if (p.tone) {
        const g = 0.035 + 0.03 * (1 - p.dark) + 0.12 * u;
        sc[i * 3] = g * 1.05; sc[i * 3 + 1] = g; sc[i * 3 + 2] = g * 0.95;
      } else {
        const g = 0.09 + 0.06 * (1 - p.dark) + 0.26 * u;
        sc[i * 3] = g * 1.12; sc[i * 3 + 1] = g * 0.98; sc[i * 3 + 2] = g * 0.84;
      }
      const fadeIn = Math.min(1, u / 0.08);
      const fadeOut = u < 0.58 ? 1 : Math.max(0, (1 - u) / 0.42);
      const base = p.surface ? 5.2 : 4.1;
      // a convection column WIDENS as it climbs (entrainment): its puffs grow
      // and thin, so the column reads as one body, not a string of beads
      const grow = p.surface ? 1.0 : 2.1;
      ss[i] = base * (0.74 + u * grow) * (0.93 + 0.09 * Math.sin(i * 1.7)) * (p.tone ? 1.15 : 1);
      sa[i] = (p.surface ? 0.22 : 0.30 / (1 + u * 0.9)) * fadeIn * fadeOut * (0.75 + p.dark * 0.25) * (p.tone ? 1.25 : 1);
      ssurf[i] = p.surface ? 1 : 0;
      shot[i] = (p.dense ? 1 : 0.35) * Math.max(0, 1 - u * 2.4);
    }
    sg.position.needsUpdate = true; sg.aColor.needsUpdate = true; sg.aSize.needsUpdate = true;
    sg.aAlpha.needsUpdate = true; sg.aSurface.needsUpdate = true; sg.aHot.needsUpdate = true;

    const eg = FX.embers.geometry.attributes;
    const ep = eg.position.array, ea = eg.aAlpha.array;
    for (let i = 0; i < MAXEMBER; i++) {
      const p = FX.epuff[i]; if (!p) continue;
      p.age += dt;
      if (p.age >= p.life) {
        FX.epuff[i] = null; FX.eFree.push(i);
        ep[i * 3] = -9999; ep[i * 3 + 1] = -9999; ep[i * 3 + 2] = -9999; ea[i] = 0;
        continue;
      }
      p.vy -= 1.2 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      ep[i * 3] = p.x; ep[i * 3 + 1] = p.y; ep[i * 3 + 2] = p.z;
      ea[i] = Math.max(0, 1 - p.age / p.life);
    }
    eg.position.needsUpdate = true; eg.aAlpha.needsUpdate = true;

    ashTick(dt);

    if (!F.live && F.smokeLinger > 0) F.smokeLinger -= dt;
    // THE SCAR AGES: wet-black char greys toward ash over the minutes after
    // the fire; a new fire re-blackens it
    if (!F.live && !F.after && !F.svc && G.mat && F.scarAge < 160) {
      F.scarAge += dt;
      G.mat.uniforms.uAge.value = Math.min(1, F.scarAge / 150);
    }
    const ms = performance.now() - t0;
    stats.fxMs += ms; stats.fxFrames++; if (ms > stats.fxMsMax) stats.fxMsMax = ms;
  }

  // ASH FALLS WHERE THE PLUME IS OVERHEAD: flakes are born above the ground
  // the smoke field covers near the viewer, and drift down with the wind
  function ashTick(dt) {
    const ag = FX.ash.geometry.attributes;
    const ap = ag.position.array, aa = ag.aAlpha.array;
    const cam = CBZ.camera;
    if (cam && F.sources.length && FX.aFree.length) {
      const c = cam.position;
      const tries = Math.min(FX.aFree.length, Math.ceil(90 * dt));
      for (let k = 0; k < tries; k++) {
        const a = jit() * 6.283, r = 3 + jit() * 26;
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        const f = smokeAt(x - F.wx * 6, z - F.wz * 6);
        if (jit() > Math.min(1, f * 0.8)) continue;
        const i = FX.aFree.pop();
        FX.apuff[i] = { x, y: c.y + 3 + jit() * 12, z, gy: ground(x, z), vy: -(0.45 + jit() * 0.5), age: 0, life: 9 + jit() * 6, ph: jit() * 6.28 };
      }
    }
    for (let i = 0; i < MAXASH; i++) {
      const p = FX.apuff[i]; if (!p) continue;
      p.age += dt;
      if (p.age >= p.life || p.y < p.gy + 0.05) {
        FX.apuff[i] = null; FX.aFree.push(i);
        ap[i * 3] = -9999; ap[i * 3 + 1] = -9999; ap[i * 3 + 2] = -9999; aa[i] = 0;
        continue;
      }
      p.x += (F.wx * F.wspd * 0.35 + Math.sin(p.age * 2.3 + p.ph) * 0.4) * dt;
      p.z += (F.wz * F.wspd * 0.35 + Math.cos(p.age * 1.9 + p.ph) * 0.4) * dt;
      p.y += p.vy * dt;
      ap[i * 3] = p.x; ap[i * 3 + 1] = p.y; ap[i * 3 + 2] = p.z;
      aa[i] = Math.min(1, p.age / 0.8) * Math.min(1, (p.life - p.age) / 2) * 0.85;
    }
    ag.position.needsUpdate = true; ag.aAlpha.needsUpdate = true;
  }

  CBZ.onUpdate(27.7, function (dt) {
    const inSurv = !!(CBZ.game && CBZ.game.mode === "survival");
    if (!inSurv && !(F.arena && F.arena.lab)) { if (FX) { disposeFX(); F.live = false; F.svc = false; F.svcQ.length = 0; } return; }
    if (FX && !fxAlive()) disposeFX();       // the arena rebuilt under us
    if (inSurv) {
      // pay for the pools and the fuel bed while the island idles, not when
      // the sirens start (quake.js's law: a hitch at the event is a tell)
      const A = CBZ.surv && CBZ.surv.arena;
      if (A && A.root) {
        if (!FX) { buildFX(A.root); wrapReset(A); }
        if (!F.live && !F.svc && (G.arena !== A || !G.ready)) gridEnsure(A, 6);
      }
    }
    if (!FX) return;
    fxTick(dt);
  });
  if (CBZ.bootComplete && CBZ.updaters && CBZ.updaters.sort) {
    CBZ.updaters.sort(function (a, b) { return a.order - b.order; });
  }

  /* ---- THE FIRE AS A SERVICE ------------------------------------------------
     Another disaster lights this bed: the eruption's lava margin, its hot
     bombs, its density currents. serve() brings the run up for that WITHOUT
     a wildfire event: the arena, the bridge the host attached, the pools,
     the reset hook, the grid (if the idle prebuild has not finished, the
     ignitions wait in svcQ while it finishes 12 rows a frame). Its frame is
     svcTick, from fxTick: the same live sim the event runs (spread, crowns,
     spotting, houses, cars, heat and smoke on the roster), on only what
     burns, and it never touches the sky, fog or weather (those are the
     running event's). It ends itself when nothing is left alight. */
  const SVC_MAG = 0.45;   // a fire lit in dry island brush, not a wind-driven run
  function svcWorld() {
    return F.svcArena || (CBZ.surv && CBZ.surv.arena) || F.arena;
  }
  function serve() {
    const A = svcWorld();
    if (!A || !A.groundHeightAt || !A.center) return null;
    if (F.live) return F.arena === A ? A : null;      // the event's run takes it as it is
    if (!F.svc) {
      const idle = F.arena !== A || (!F.after && !G.act.length && !G.pend.length);
      if (idle) {
        zeroStats();
        F.spots.length = 0; F.smoulders.length = 0; F.sources.length = 0; F.burningList.length = 0;
        F.seed = null; F.spreadCd = 0; F.spotCd = 2.4; F.veer = 0; F.scarAge = 0; F.smokeLinger = 0;
        if (G.mat) G.mat.uniforms.uAge.value = 0;      // a new fire re-blackens the old ash
      }
      const br = F.svcBridge;
      F.arena = A; F.bridge = br || null; F.after = false; F.svc = true; F.quench = false;
      F.mag = F._forceMag != null ? F._forceMag : (br && br.mag != null ? Math.max(0, Math.min(1, +br.mag)) : SVC_MAG);
      F.reach = 7 + 11 * F.mag;
      svcWind();
    }
    if (FX && !fxAlive()) disposeFX();
    if (!FX && A.root) buildFX(A.root);
    wrapReset(A);
    if (G.arena !== A) gridStart(A);
    return A;
  }
  function svcWind() {
    const br = F.bridge;
    const w = br && br.wind ? br.wind() : (CBZ.weatherWind ? CBZ.weatherWind() : null);
    if (!w) return;
    const m = Math.hypot(w.x || 0, w.z || 0);
    if (m > 1e-3) { F.wx = w.x / m; F.wz = w.z / m; }
    F.wspd = Math.max(2, Math.min(19, w.speed != null ? +w.speed : m));
  }
  function svcIgnite(x, z, r, why) {
    if (r > G.cs * 0.6) {
      // the disc's centre takes now, the rest within a second or so
      const c = cellOf(x, z);
      const lit = igniteCell(c, why);
      const before = G.pend.length;
      igniteDisc(x, z, r, 6);
      return lit || G.pend.length > before;
    }
    return igniteCell(cellOf(x, z), why);
  }
  function svcBurning() {
    if (G.act.length || G.pend.length || F.burningList.length || F.spots.length || F.smoulders.length || F.svcQ.length) return true;
    const A = F.arena;
    const L = (A && A.fragile) || [];
    for (let k = 0; k < L.length; k++) {
      const r = L[k]._wf; if (!r) continue;
      if (r.rubble > 0) return true;
      if (!L[k].fallen) for (let f = 0; f < r.storeys; f++) if (r.fl[f].s === 1) return true;
    }
    const C = (A && A.cars) || [];
    for (let k = 0; k < C.length; k++) { const r = C[k]._wf; if (r && (r.s === 1 || r.I > 0)) return true; }
    return false;
  }
  function svcTick(dt) {
    const t0 = performance.now();
    const A = F.arena;
    if (!A) { F.svc = false; return; }
    if (!G.ready) {
      gridEnsure(A, 12);
      if (G.ready) { for (let i = 0; i < F.svcQ.length; i++) { const q = F.svcQ[i]; svcIgnite(q.x, q.z, q.r, q.why); } F.svcQ.length = 0; }
    }
    svcWind();
    simTick(dt, false, true);
    if (!svcBurning()) { F.svc = false; F.smokeLinger = 8; }
    const ms = performance.now() - t0;
    stats.simMs += ms; stats.simFrames++; if (ms > stats.simMsMax) stats.simMsMax = ms;
  }
  function litBy(why) { why = why || "other"; stats.lit[why] = (stats.lit[why] || 0) + 1; }
  // the host lends its world and its machinery once (the event's bridge
  // shape: hitBuilding, blast, sheltered; plus wind() and mag)
  function attach(arena, bridge) {
    F.svcArena = arena || null; F.svcBridge = bridge || null;
    if (F.svc && !F.live) { if (arena) F.arena = arena; F.bridge = F.svcBridge; }
  }
  // fire on the bed at (x, z): one cell, or a disc of radius r (m)
  function igniteAtPublic(x, z, why, r) {
    if (!serve()) return false;
    r = r > 0 ? +r : 0;
    if (!G.ready) { F.svcQ.push({ x, z, r, why }); litBy(why); return true; }
    const ok = svcIgnite(x, z, r, why);
    if (ok) litBy(why);
    return ok;
  }
  function igniteTreePublic(t, why) {
    if (!t || t.burnt || t.burning || !serve()) return false;
    igniteTree(t, why || "other");
    litBy(why);
    return true;
  }
  // a house set alight from outside: a hot bomb in the rafters / an ember in
  // the attic lights the top floor, lava or a density current the ground floor
  function igniteBuildingPublic(b, how) {
    if (!b || b.fallen || !serve()) return false;
    const r = bRec(b);
    if (r.igAt >= 0 || r.done) return false;
    if (how === "bomb" || how === "vent") igniteFloor(b, r.storeys - 1, "vent");
    else igniteFloor(b, 0, "heat");
    litBy(how);
    return r.igAt >= 0;
  }
  // a car set alight from outside (a hot bomb, lava under it): fully involved now
  function igniteCarPublic(c, why) {
    if (!c || c.flung || !serve()) return false;
    const r = carRec(c, carPos(c));
    if (r.s !== 0) return false;
    r.s = 1; r.t = 0; r.heat = 1; stats.carsBurnt++;
    litBy(why || "car");
    return true;
  }

  /* ---- end of the event --------------------------------------------------
     The director's timer starves the run, it does not un-burn the island:
     torching crowns char out, the bed drops to embers, the plume drifts off;
     a house already alight burns on to its end and may still come down. */
  function stop() {
    F.live = false;
    F.smokeLinger = 8;
    const tr = (F.arena && F.arena.flammable) || [];
    for (let i = 0; i < tr.length; i++) if (tr[i].burning > 0) charTree(tr[i]);
    F.burningList.length = 0;
    F.spots.length = 0; F.smoulders.length = 0;
    if (G.ready) cellsStarve();
    F.after = true; F.svc = false; F.svcQ.length = 0;
  }
  /* SETTLE: THE FIRE DOES NOT BECOME THE NEXT DISASTER. stop() leaves the
     houses and cars to burn out on their own clocks (a tower runs for minutes)
     and a meteor's or an eruption's service fire kept spreading after its
     event was over, so a "different event" was still eating the island when
     the next warning came. The director's calm calls this: the bed is
     starved, nothing new catches (F.quench), and every floor, car and rubble
     heap still alight finishes inside `secs`. The black, the gutted shells
     and the wrecks stay; they are the scar. */
  function settle(secs) {
    secs = Math.max(0.5, +secs || 8);
    if (F.live || F.svc) stop();
    F.quench = true;
    F.svcQ.length = 0;
    F.smokeLinger = Math.min(F.smokeLinger, secs * 0.5);
    const A = F.arena;
    const L = (A && A.fragile) || [];
    for (let k = 0; k < L.length; k++) {
      const r = L[k]._wf; if (!r) continue;
      for (let f = 0; f < r.storeys; f++) { const fl = r.fl[f]; if (fl.s === 1) fl.T = Math.min(fl.T, fl.t + secs * 0.6); }
      if (r.rubble > 0) r.rubble = Math.min(r.rubble, secs * 0.5);
    }
    const C = (A && A.cars) || [];
    for (let k = 0; k < C.length; k++) {
      const r = C[k]._wf; if (!r || r.s === 0) continue;
      r.boomed = true;                         // no tank goes up in the calm
      r.t = Math.max(r.t, 36 - secs * 0.6);   // 22 s alight + 14 s dying glow
      if (r.s === 1 && r.t >= 22) { r.s = 2; }
    }
    if (G.ready) cellsStarve();
  }
  // something is still alight or still spreading (the burn scar is not)
  function busy() {
    if (F.live || F.svc || G.flamingN > 0 || F.burningList.length) return true;
    const A = F.arena;
    const L = (A && A.fragile) || [];
    for (let k = 0; k < L.length; k++) { const r = L[k]._wf; if (r && (r.burning > 0.02 || r.rubble > 0)) return true; }
    const C = (A && A.cars) || [];
    for (let k = 0; k < C.length; k++) { const r = C[k]._wf; if (r && r.I > 0.02) return true; }
    return false;
  }
  function hardStop() {
    F.quench = false;
    F.live = false; F.after = false; F.burningList.length = 0; F.sources.length = 0;
    F.spots.length = 0; F.smoulders.length = 0; F.seed = null;
    F.svc = false; F.svcQ.length = 0;
  }

  /* ---- bot / threat surface --------------------------------------------- */
  function threat(x, z) {
    let t = 0;
    const B = F.burningList;
    for (let i = 0; i < B.length; i++) {
      const d = Math.hypot(x - B[i].x, z - B[i].z);
      if (d < 10) t = Math.max(t, 1 - d / 10);
    }
    if (G.ready && G.flamingN) {
      const c = cellOf(x, z);
      if (c >= 0) {
        const n = G.n, cx = c % n, cz = (c / n) | 0, ri = Math.ceil(12 / G.cs);
        for (let dz = -ri; dz <= ri; dz += 1) for (let dx = -ri; dx <= ri; dx += 1) {
          const ix = cx + dx, iz = cz + dz;
          if (ix < 0 || iz < 0 || ix >= n || iz >= n) continue;
          const j = iz * n + ix; if (G.st[j] !== 1) continue;
          const d = Math.hypot(dx, dz) * G.cs;
          if (d < 12) t = Math.max(t, (1 - d / 12) * (0.4 + 0.6 * cellI(j)));
        }
      }
    }
    const A = world();
    const L = (A && A.fragile) || [];
    for (let k = 0; k < L.length; k++) {
      const r = L[k]._wf; if (!r || !(r.burning > 0)) continue;
      const d = distToBuilding(L[k], x, z);
      if (d < 8) t = Math.max(t, 0.85 * (1 - d / 8));
    }
    const C = (A && A.cars) || [];
    for (let k = 0; k < C.length; k++) {
      const r = C[k]._wf; if (!r || r.s !== 1) continue;
      const p = carPos(C[k]), d = Math.hypot(p.x - x, p.z - z);
      if (d < 9) t = Math.max(t, (r.boomed ? 0.5 : 0.95) * (1 - d / 9));
    }
    const s = smokeAt(x, z);
    if (s > 0.3) t = Math.max(t, Math.min(1, 0.25 + 0.45 * s));
    return t;
  }
  /* ACROSS THE WIND. Downwind of the fire you cannot outrun the head plus
     its spotting; flanking out of the plume corridor beats racing it. Upwind
     of it, plain distance is honest. */
  function safeDir(x, z) {
    const S = F.sources;
    if (!S.length) return null;
    let cx = 0, cz = 0, W = 0, nd = 1e9, nx = 0, nz = 0;
    for (let i = 0; i < S.length; i++) {
      cx += S[i].x * S[i].w; cz += S[i].z * S[i].w; W += S[i].w;
      const d = Math.hypot(x - S[i].x, z - S[i].z);
      if (d < nd) { nd = d; nx = S[i].x; nz = S[i].z; }
    }
    cx /= W || 1; cz /= W || 1;
    if (nd > 90 && smokeAt(x, z) < 0.3) return null;
    let ax = x - nx, az = z - nz;
    const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    const down = (x - cx) * F.wx + (z - cz) * F.wz;
    if (down > -4) {
      let px = -F.wz, pz = F.wx;
      if (px * ax + pz * az < 0) { px = F.wz; pz = -F.wx; }
      const vx = px + ax * 0.45, vz = pz + az * 0.45;
      const vl = Math.hypot(vx, vz) || 1;
      return { x: vx / vl, z: vz / vl };
    }
    return { x: ax, z: az };
  }
  /* IS THIS GROUND A REFUGE? 1 = bare (road, beach) or already burnt ("the
     black") with clear air and nothing alight beside it; 0 = in the flames. */
  function refuge(x, z) {
    let r = 0.2;
    const c = cellOf(x, z);
    if (c >= 0) {
      if (G.st[c] === 1) return 0;
      if (G.st[c] >= 2 || (!G.fuel[c] && !G.bld[c])) r = 1;
      else if (G.bld[c]) r = 0.5;
    } else r = 0.6;
    const h = heatAt(x, z);
    if (h.contact > 0) return 0;
    r *= Math.max(0, 1 - h.heat);
    r *= Math.max(0, 1 - 0.6 * Math.min(1, smokeAt(x, z)));
    return r;
  }
  // what the minimap marks: the burning blocks, houses and crowns
  function hazards(max) {
    const out = [];
    max = max || 24;
    const S = F.sources;
    for (let i = 0; i < S.length && out.length < max; i++) {
      const s = S[i];
      const r = s.kind === 1 ? 4 + Math.sqrt(s.n || 1) * G.cs * 0.6 : (s.kind === 2 ? Math.max(s.b.w, s.b.d) / 2 + 3 : 4);
      out.push({ x: s.x, z: s.z, r });
    }
    return out;
  }
  // how big the fire is now, 0..1 (sky, sound, the def's grade)
  function size() {
    const area = G.flamingN * G.cs * G.cs + F.burningList.length * 40 + F.sources.filter((s) => s.kind === 2).length * 120;
    return Math.min(1, area / 2500);
  }
  // put cells out (the hook a fire crew or a water drop would call)
  function douse(x, z, r) {
    if (!G.ready) return 0;
    const c = cellOf(x, z); if (c < 0) return 0;
    const ri = Math.ceil(r / G.cs), n = G.n, cx = c % n, cz = (c / n) | 0;
    let k = 0;
    for (let dz = -ri; dz <= ri; dz++) for (let dx = -ri; dx <= ri; dx++) {
      const ix = cx + dx, iz = cz + dz;
      if (ix < 0 || iz < 0 || ix >= n || iz >= n || Math.hypot(dx, dz) * G.cs > r) continue;
      const j = iz * n + ix;
      if (G.st[j] === 1) { G.life[j] = Math.max(0, F.clock - G.tIgn[j]); G.st[j] = 2; k++; }
      else if (G.st[j] === 0 && G.fuel[j]) { G.arr[j] = INF; G.fuel[j] = 0; }   // wetted: no longer fuel
    }
    return k;
  }

  /* ---- audit ------------------------------------------------------------ */
  CBZ.wildfireAudit = function () {
    const A = world();
    const tr = (A && A.flammable) || [];
    let burning = 0, burnt = 0, ccx = 0, ccz = 0;
    for (let i = 0; i < tr.length; i++) {
      if (tr[i].burning > 0) { burning++; ccx += tr[i].x; ccz += tr[i].z; }
      if (tr[i].burnt) burnt++;
    }
    let runM = 0, runDownM = 0, runUpM = 0, runCrossM = 0;
    const s0 = F.seed;
    if (s0 && G.ready) {
      for (let i = 0; i < G.st.length; i++) {
        if (!G.st[i]) continue;
        const dx = cellX(i) - s0.x, dz = cellZ(i) - s0.z;
        const d = Math.hypot(dx, dz);
        if (d > runM) runM = d;
        const down = dx * F.wx + dz * F.wz;
        if (down > runDownM) runDownM = down;
        if (-down > runUpM) runUpM = -down;
        const crossD = Math.abs(dz * F.wx - dx * F.wz);
        if (crossD > runCrossM) runCrossM = crossD;
      }
    }
    let escapeAngleDeg = null;
    if ((burning > 0 || G.flamingN) && CBZ.disasters && CBZ.disasters.fleeVector && F.sources.length) {
      let sx = 0, sz = 0; F.sources.forEach((s) => { sx += s.x; sz += s.z; });
      const px = sx / F.sources.length + F.wx * 28, pz = sz / F.sources.length + F.wz * 28;
      const fv = CBZ.disasters.fleeVector(px, pz);
      if (fv && (fv.x || fv.z)) {
        const dot = Math.max(-1, Math.min(1, (fv.x * F.wx + fv.z * F.wz) / (Math.hypot(fv.x, fv.z) || 1)));
        escapeAngleDeg = Math.round(Math.acos(Math.abs(dot)) * 180 / Math.PI);
      }
    }
    const L = (A && A.fragile) || [];
    const C = (A && A.cars) || [];
    return {
      treesTotal: tr.length, treesBurning: burning, treesBurnt: burnt,
      treesTorched: stats.treesTorched, treesScorched: stats.treesScorched, ignitions: stats.ignitions,
      gridN: G.n, cellM: +G.cs.toFixed(2), cellsFlaming: G.flamingN, cellsIgnited: stats.cellsIgnited,
      burntHa: +(stats.burntM2 / 10000).toFixed(3), scarM2: Math.round(stats.burntM2),
      ignitedM2: Math.round(stats.cellsIgnited * G.cs * G.cs), serving: F.svc, litBy: Object.assign({}, stats.lit),
      spotLaunched: stats.spotLaunched, spotFires: stats.spotFires, spotMaxM: stats.spotMaxM, spotFizzled: stats.spotFizzled,
      buildingsTotal: L.length, buildingsIgnited: stats.bldIgnited, ignitedByVent: stats.bldByVent,
      ignitedByWindow: stats.bldByWindow, ignitedByHeat: stats.bldByHeat,
      buildingsBurning: L.filter((b) => b._wf && b._wf.burning > 0).length,
      floorsBurnt: stats.bldFloorsBurnt, buildingsCollapsed: stats.bldCollapsed, buildingsGutted: stats.bldGutted,
      carsTotal: C.length, carsBurnt: stats.carsBurnt, carsExploded: stats.carsExploded,
      runM: Math.round(runM), runDownwindM: Math.round(runDownM), runUpwindM: Math.round(runUpM), runCrossM: Math.round(runCrossM),
      mag: +F.mag.toFixed(3), wspdMs: +F.wspd.toFixed(1), reachM: Math.round(F.reach),
      smokeDamage: Math.round(stats.smokeDamage), flameDamage: Math.round(stats.flameDamage),
      smokeDeaths: stats.smokeDeaths, flameDeaths: stats.flameDeaths,
      plumeLenM: F.seed ? Math.round(plumeLen()) : 0,
      sources: F.sources.length,
      smokePuffsLive: FX ? MAXSMOKE - FX.sFree.length : 0,
      ashLive: FX ? MAXASH - FX.aFree.length : 0,
      flameSprites: FX ? FX.flameN : 0, glowSprites: FX ? FX.glowN : 0,
      burnTiles: G.tiles ? G.tiles.filter(Boolean).length : 0,
      spotsInFlight: F.spots.length,
      escapeAngleDeg,
      windX: +F.wx.toFixed(2), windZ: +F.wz.toFixed(2),
      simMsAvg: stats.simFrames ? +(stats.simMs / stats.simFrames).toFixed(3) : 0, simMsMax: +stats.simMsMax.toFixed(2),
      fxMsAvg: stats.fxFrames ? +(stats.fxMs / stats.fxFrames).toFixed(3) : 0, fxMsMax: +stats.fxMsMax.toFixed(2),
    };
  };

  CBZ.wildfire = {
    beginWarn, begin, tick, stop, settle, busy,
    // the fire as a service (see "THE FIRE AS A SERVICE")
    attach, igniteAt: igniteAtPublic, igniteTree: igniteTreePublic,
    igniteBuilding: igniteBuildingPublic, igniteCar: igniteCarPublic,
    serving() { return F.svc; },
    threat, safeDir, smokeAt, emberAt, refuge, hazards, size, douse,
    wind() { return { x: F.wx, z: F.wz, speed: F.wspd }; },
    magnitude() { return F.mag; },
    setMagnitude(v) { F._forceMag = v == null ? null : Math.max(0, Math.min(1, +v || 0)); },
    // the fuel bed, read-only, for probes and future fire crews
    grid() {
      return G.ready ? { n: G.n, cs: G.cs, x0: G.x0, z0: G.z0, fuel: G.fuel, st: G.st, tIgn: G.tIgn, gy: G.gy, clock: F.clock } : null;
    },
    puffStats(x, z) {
      let live = 0, surf = 0, near = 0, nd = 1e9, ny = 0;
      if (FX) for (let i = 0; i < FX.spuff.length; i++) {
        const p = FX.spuff[i]; if (!p) continue;
        live++;
        if (!p.surface) continue;
        surf++;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < nd) { nd = d; ny = p.y; }
        if (d < 18) near++;
      }
      return { live, surf, near, nd: nd === 1e9 ? -1 : Math.round(nd), ny: Math.round(ny) };
    },
    seedPos() { return F.seed ? { x: F.seed.x, z: F.seed.z } : null; },
    flameMaterial: flameMaterial,
    live() { return F.live; },
    audit() { return CBZ.wildfireAudit(); },
  };
})();
