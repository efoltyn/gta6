/* ============================================================
   systems/meteor.js — A METEOR IS A BLAST WAVE WITH A LIGHT SHOW IN FRONT.

   What it replaced (2026-10-14): one radiant and a late bang were right, but
   everything that happened on the GROUND was a radius test. fx.blast blew out
   every pane inside 0.85 of the ring the instant it was drawn (before the
   front had got there), a crater was a bowl with no rim and no ejecta
   blanket, trees and cars did not notice, nothing caught fire, and a 2 m
   pebble and a crater-digging iron were the same rock at two sizes.

   This file models the event the way the physics runs it.

   ENTRY. A body arrives along the event's ONE radiant (a shower is one
   debris stream; random headings read as fireworks). Its head is a flickering
   fireball; behind it an IONIZED PLASMA TRAIN glows for a second or two
   (blue-white at the head, the oxygen green, then a dull orange as the gas
   recombines), and behind that the SMOKE TRAIN: ablated dust that hangs in
   the sky for a minute, widening and shearing in the wind, higher puffs
   drifting further (wind grows with height). Bigger bodies FRAGMENT: at
   their break-up altitude the aerodynamic load exceeds their strength, they
   flare (a flash and its own late boom) and go on as a spray of pieces.

   THE ENDING DEPENDS ON THE BODY (CLASSES below):
     pebble        burns up high. A streak, a short train. Harmless.
     pop           a small stony body that airbursts low: a flash, a puff,
                   a little front that breaks nearby glass.
     chelyabinsk   a 20 m-class stony body (scaled): flares, fragments,
                   terminates high. The flash whites out the island, then
                   NOTHING for seconds, then the front arrives and breaks
                   windows across the whole island. Trees stand. People are
                   knocked down and cut by glass.
     tunguska      larger and lower: the front flattens the forest RADIALLY,
                   every trunk pointing away from ground zero, except directly
                   beneath the burst where the wave arrives from above and
                   the trees stay standing, stripped (the "telegraph poles"
                   of the 1908 site). The thermal flash lights fires under it.
     small         a stony meteorite that survives to the ground: a few-metre
                   pit, a dust puff, a small front.
     impact        an iron body that reaches the ground intact: a CRATER
                   (pi-scaling, sized from its diameter, density, speed and
                   entry angle), a raised RIM and an EJECTA BLANKET with rays,
                   an EJECTA CURTAIN (the inverted cone of debris walking
                   outward) with ballistic rocks and SECONDARY IMPACTS, a DUST
                   PLUME, a fireball that starts FIRES, and a ground front
                   that flattens trees, shoves and rolls cars and guts the
                   buildings near ground zero.

   THE FRONT IS ONE PHYSICAL LAW, NOT A RADIUS. Overpressure at slant range
   R from a charge of W kg TNT-equivalent is Kinney & Graham's free-air fit
   on the scaled distance Z = R / W^(1/3):
       dP/P0 = 808 [1+(Z/4.5)^2] / sqrt([1+(Z/0.048)^2][1+(Z/0.32)^2][1+(Z/1.35)^2])
   doubled for the regular reflection off the ground under an airburst
   (hemispherical 1.8 W for a surface impact). From dP the Rankine-Hugoniot
   relations give the wind behind the shock and its dynamic pressure, and
   EVERY consequence is a threshold on those numbers, checked the moment the
   front reaches that object and never before:
       glass                0.5 - 3 kPa (per pane: panes are not identical)
       tree leans           ~5 kPa;  tree blown down ~12 kPa (per tree)
       car                  slides when the drag of the blast wind beats tyre
                            friction (~19 kPa), rolls when the drag moment
                            beats the weight moment (~25 kPa): integrated, not
                            looked up
       building             7 kPa damaged, 20 kPa heavily, 35 kPa gutted
   The airburst energies are HOPKINSON-SCALED: the island is a model of the
   real event with lengths shrunk 1:300 and energy 1:300^3, which keeps the
   overpressure at every scaled point identical to the real one. So
   Chelyabinsk's ~440 kt at ~30 km is 16 kg at ~100 m here, and the measured
   2-5 kPa under the real track is what this file produces under its track.

   THE DELAYS A REAL OBSERVER HAS. Light is instant: the flash, the light
   pulse on the world, the fireball. The front leaves the burst at the speed
   of sound and meets the ground on the sphere r(t) = sqrt((c t)^2 - alt^2),
   so it reaches a point at slant/c, and the bang the listener hears is
   scheduled at exactly that time. c is a dramatic 65 m/s, not 340: at 340 the
   signature silence would be 0.3 s across this island. Same cheat every film
   makes, in the same direction, and the ONE number the lab reports against.

   DIVISION OF LABOUR. This file owns the sky and the WORLD it changes (glass,
   trees, cars, craters, fires, blankets) through ONE world adapter that reads
   CBZ.island when the island publishes it, else the survival arena records
   (fragile / flammable / cars / glass), else whatever `world` the caller
   hands begin() (the lab). Buildings go through ONE adapter, damageBuilding():
   CBZ.collapse.damage when the shared collapse system provides it, else the
   owning def's ledger callback (systems/disasters.js structureHit), else a
   local gut (the lab). The GAME stays with the def: which points get hit
   (seeded), what an impact costs the actors, who the front knocks down.

   FIRE IS THE ISLAND'S ONE FIRE. The thermal pulse, a gutted house and a
   glowing block thrown out of the crater light the wildfire's own fuel bed,
   crowns and houses (CBZ.wildfire.igniteAt / igniteTree / igniteBuilding,
   systems/wildfire.js as a service): it spreads, smokes, chars and pays the
   structural ledger exactly as a wildfire does. This file draws no flame of
   its own any more.

   DRAW CALLS, all instanced and pooled: streaks/trains, glow, smoke+dust,
   front rings. Four, plus two meshes per crater (blanket, curtain). The
   ejecta rocks are systems/debris.js's shared loose bits (stone, hot ones
   glowing): one physics, one reset, one audit for every piece. Nothing allocates per
   frame; every front's targets are sorted ONCE by distance and walked with a
   cursor, so a front costs O(newly reached) per tick, never O(world).

   Ratchet: CBZ.meteorAudit(). Lab: node tools/lab/run.mjs --kit meteor.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const SOUND_SPEED = 65;       // the dramatic speed of sound (see header)
  const P0 = 101.325;           // kPa
  const G = 9.81;               // ejecta fly under real gravity
  const STREAK_CAP = 220, GLOW_CAP = 64, SMOKE_CAP = 640, ROCK_CAP = 220, RING_CAP = 12;

  // per-object thresholds (kPa)
  const GLASS_LO = 0.5, GLASS_HI = 3.0;
  const TREE_LEAN = 5, TREE_FALL = 12;
  const BLDG_LIGHT = 7, BLDG_HEAVY = 20, BLDG_GUT = 35;
  // a parked car, side-on to the wind (the worst case is the common one)
  const CAR = { m: 1300, A: 6.5, Cd: 1.2, mu: 0.75, track: 1.56, hcg: 0.6 };
  const RHO = 1.225;

  /* ---- THE BODIES. Airburst W is Hopkinson-scaled from the real event;
     ground bodies carry L (m), density and speed for the crater law and
     couple ETA of their kinetic energy into the air blast. ---- */
  const CLASSES = {
    pebble:      { air: true,  alt: [130, 210], W: 0,    frag: 0, size: 0.45, speed: [200, 250], train: 0.7, smoke: 0 },
    pop:         { air: true,  alt: [35, 80],   W: 0.004, frag: 0, size: 1.0,  speed: [130, 165], train: 1.2, smoke: 1 },
    chelyabinsk: { air: true,  alt: [92, 120],  W: 16,   frag: 4, breakUp: 70, size: 2.6, speed: [150, 175], train: 2.6, smoke: 2 },
    tunguska:    { air: true,  alt: [32, 44],   W: 380,  frag: 2, breakUp: 55, size: 3.4, speed: [140, 160], train: 3.0, smoke: 2.5, thermal: 1.2 },
    small:       { air: false, L: 0.2,  dens: 3300, v: 3000,  eta: 0.02, frag: 0, size: 1.1, speed: [120, 150], train: 1.4, smoke: 1 },
    impact:      { air: false, L: 0.42, dens: 7800, v: 13000, eta: 0.1, frag: 3, breakUp: 90, size: 3.8, speed: [150, 170], train: 3.2, smoke: 2.6 },
  };
  /* eta: the share of an impact's kinetic energy that becomes air blast. A
     hypervelocity iron couples ~10%; a stony meteorite already slowed by the
     air to a few km/s spends nearly all of it digging and heating (2%). */
  const ETA_COUPLE = 0.1;
  const TNT = 4.184e6;         // J per kg TNT

  // private FX rng, seeded from ONE draw of the shared hazard stream at
  // begin() (core/seed.js's law: the hazard stream is never taxed by jitter)
  let rngState = 1;
  function frnd() { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 4294967296; }
  function lerp(a, b, u) { return a + (b - a) * u; }
  function pick(r) { return Array.isArray(r) ? lerp(r[0], r[1], frnd()) : r; }
  // a position hash: an object's own threshold, the same every run
  function h01(x, z, s) { const v = Math.sin(x * 12.9898 + z * 78.233 + s * 37.719) * 43758.5453; return v - Math.floor(v); }

  /* ======================================================================
     THE BLAST LAW
     ====================================================================== */
  function kgRatio(Z) {
    const a = Z / 4.5, b = Z / 0.048, c = Z / 0.32, d = Z / 1.35;
    return 808 * (1 + a * a) / Math.sqrt((1 + b * b) * (1 + c * c) * (1 + d * d));
  }
  // overpressure (kPa) on the ground at horizontal distance d from a burst
  // `alt` above it: slant range, reflection doubled under an airburst
  function overpressure(d, alt, W, surface) {
    if (!(W > 0)) return 0;
    const R = Math.max(0.5, Math.hypot(d, alt));
    const We = surface ? W * 1.8 : W;
    const p = kgRatio(R / Math.cbrt(We)) * P0;
    return surface ? p : p * 2;
  }
  // Rankine-Hugoniot: the wind behind the shock (m/s) and its dynamic pressure (kPa)
  function windBehind(dp) { const x = dp / (7 * P0); return 5 * x * 340 / Math.sqrt(1 + 6 * x); }
  function dynamicP(dp) { return 2.5 * dp * dp / (7 * P0 + dp); }
  // how far out the front still breaks the weakest glass
  function reachOf(W, alt, surface, cap) {
    let lo = 0, hi = cap;
    if (overpressure(hi, alt, W, surface) >= GLASS_LO * 0.9) return hi;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (overpressure(m, alt, W, surface) >= GLASS_LO * 0.9) lo = m; else hi = m; }
    return lo;
  }
  /* PI-SCALING (Collins, Melosh & Marcus 2005), transient diameter of a
     gravity-regime crater, then the simple-crater collapse to 1.25x */
  function craterOf(L, dens, v, elev) {
    const Dtc = 1.161 * Math.cbrt(dens / 2500) * Math.pow(L, 0.78) * Math.pow(v, 0.44) * Math.pow(G, -0.22) * Math.cbrt(Math.max(0.2, Math.sin(elev)));
    const D = 1.25 * Dtc;
    return { D, R: D / 2, depth: 0.2 * D, rim: 0.036 * D };
  }
  function impactW(L, dens, v, eta) {
    const m = dens * Math.PI / 6 * L * L * L;
    return (eta != null ? eta : ETA_COUPLE) * 0.5 * m * v * v / TNT;
  }

  /* ======================================================================
     THE WORLD ADAPTER — one read of whatever world is live
     ====================================================================== */
  // the first NON-EMPTY list wins: an island that publishes `cars: []`
  // while the arena still holds them must not hide the arena's
  function firstArr(srcs, names) {
    let empty = null;
    for (const s of srcs) {
      if (!s) continue;
      for (const n of names) if (Array.isArray(s[n])) { if (s[n].length) return s[n]; if (!empty) empty = s[n]; }
    }
    return empty || [];
  }
  function resolveWorld(o) {
    const srcs = [o.world, CBZ.island, CBZ.surv && CBZ.surv.arena];
    let ground = o.floor || null, src = null;
    for (const s of srcs) {
      if (!s) continue;
      if (!src && typeof s.reset === "function") src = s;
      if (!ground && typeof s.groundHeightAt === "function") ground = s.groundHeightAt.bind(s);
    }
    return {
      src: src,
      trees: firstArr(srcs, ["trees", "flammable"]),
      cars: firstArr(srcs, ["cars"]),
      buildings: firstArr(srcs, ["buildings", "fragile"]),
      glass: firstArr(srcs, ["glass"]),
      ground: ground || (CBZ.floorAt ? function (x, z) { return CBZ.floorAt(x, z); } : function () { return 0; }),
    };
  }

  /* ---- BUILDINGS: the one adapter (the shared collapse system when it
     offers damage(), else the owning def's ledger, else a local gut) ---- */
  function damageBuilding(b, at, radius, energy, dir) {
    stats.bldgHits++;
    try {
      if (CBZ.collapse && typeof CBZ.collapse.damage === "function") {
        // `energy` is the ledger's fraction (1 = down): collapse.js reads it so
        CBZ.collapse.damage(b, at, radius, energy, dir, { frac: true }); return "collapse";
      }
    } catch (e) {}
    const o = ev && ev.opts;
    if (o && o.damage && o.damage.building) { try { o.damage.building(b, energy, dir); return "ledger"; } catch (e) {} }
    // the lab / an orphan world: our own ledger. Gutting = every pane out,
    // the shell dark, a fire inside.
    const before = b._meteorDmg || 0;
    b._meteorDmg = Math.min(1.2, before + energy);
    return "local";
  }

  /* ======================================================================
     POOLS (made once, reused by every event)
     ====================================================================== */
  const dummy = new THREE.Object3D();
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _ax = new THREE.Vector3(), _v = new THREE.Vector3();
  function makePool(geo, mat, cap, order) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.renderOrder = order == null ? 7 : order;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.visible = false;
    return m;
  }
  function setColor(mesh, i, hex, k) {
    const c = mesh.instanceColor.array, s = k == null ? 1 : k;
    c[i * 3] = ((hex >> 16) & 255) / 255 * s;
    c[i * 3 + 1] = ((hex >> 8) & 255) / 255 * s;
    c[i * 3 + 2] = (hex & 255) / 255 * s;
  }
  let P = null;    // the pools
  function pools() {
    if (P) return P;
    const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    P = {
      streak: makePool(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(Object.assign({ color: 0xffffff, opacity: 0.9 }, add)), STREAK_CAP),
      glow: makePool(new THREE.SphereGeometry(1, 12, 9), new THREE.MeshBasicMaterial(Object.assign({ color: 0xffffff, opacity: 0.95 }, add)), GLOW_CAP),
      // a dodecahedron reads as a puff; a cube reads as a crate
      smoke: makePool(new THREE.DodecahedronGeometry(0.62, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false }), SMOKE_CAP, 6),
      ring: makePool((function () { const g = new THREE.RingGeometry(0.93, 1, 72, 1); g.rotateX(-Math.PI / 2); return g; })(),
        new THREE.MeshBasicMaterial(Object.assign({ color: 0xffffff, opacity: 0.8, side: THREE.DoubleSide }, add)), RING_CAP, 5),
    };
    return P;
  }
  const POOL_KEYS = ["streak", "glow", "smoke", "ring"];

  /* ---- textures for the blanket's rays and the curtain's streaks ---- */
  let rayTex = null, curtainTex = null;
  function texOf(draw) {
    const cv = document.createElement("canvas");
    cv.width = 128; cv.height = 128;
    draw(cv.getContext("2d"));
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }
  function rays() {
    // u = radial (0 rim .. 1 outer edge), v = bearing. A continuous blanket
    // out to ~1.6 crater radii, thinning; beyond it only the RAYS reach.
    return rayTex || (rayTex = texOf(function (x) {
      const img = x.createImageData(128, 128), d = img.data;
      const ray = new Float32Array(128);
      for (let j = 0; j < 128; j++) ray[j] = Math.pow(h01(j, 1, 9), 3) * 0.6 + Math.pow(h01(j >> 2, 2, 9), 4) * 0.9;
      for (let j = 0; j < 128; j++) {
        for (let i = 0; i < 128; i++) {
          const u = i / 127;
          const blanket = u < 0.18 ? 1 : Math.max(0, 1 - (u - 0.18) / 0.32);
          const r = Math.min(1, ray[j] + ray[(j + 1) & 127] * 0.5) * Math.max(0, 1 - u * 0.95);
          const a = Math.min(1, Math.max(blanket, r)) * (u > 0.97 ? (1 - u) / 0.03 : 1);
          const k = (j * 128 + i) * 4;
          d[k] = d[k + 1] = d[k + 2] = Math.round(a * 255); d[k + 3] = 255;
        }
      }
      x.putImageData(img, 0, 0);
    }));
  }
  function curtainStreaks() {
    // u = around, v = up the curtain: ragged top, streaks of thicker debris
    return curtainTex || (curtainTex = texOf(function (x) {
      const img = x.createImageData(128, 128), d = img.data;
      for (let i = 0; i < 128; i++) {
        const s = 0.35 + 0.65 * Math.pow(h01(i, 4, 5), 1.6), top = 0.55 + 0.4 * h01(i >> 1, 6, 5);
        for (let j = 0; j < 128; j++) {
          const v = j / 127;       // canvas row 0 = top of the texture = v 1
          const up = 1 - v;
          const a = s * (up < 0.06 ? up / 0.06 : 1) * (up > top ? Math.max(0, 1 - (up - top) / 0.12) : 1);
          const k = (j * 128 + i) * 4;
          d[k] = d[k + 1] = d[k + 2] = Math.round(Math.max(0, Math.min(1, a)) * 255); d[k + 3] = 255;
        }
      }
      x.putImageData(img, 0, 0);
    }));
  }

  /* ======================================================================
     STATE
     ====================================================================== */
  let ev = null;
  const touched = { trees: [], cars: [], colliders: [], meshes: [] };   // what restore() puts back
  const stats = {};
  function resetStats() {
    Object.assign(stats, {
      events: 0, streaksSpawned: 0, bolides: 0, fragments: 0, flares: 0,
      airbursts: 0, groundImpacts: 0, cratersDug: 0, craterRefused: 0, ejecta: 0, secondaries: 0,
      bangsScheduled: 0, bangsHeard: 0, flashToBangLast: 0, flashToBangMax: 0, bigBursts: 0,
      panes: 0, treesDown: 0, treesLeaning: 0, treesStripped: 0, treesBurning: 0,
      carsPushed: 0, carsRolled: 0, carMaxMove: 0, bldgHits: 0, bldgGutted: 0, fires: 0,
      tickMs: 0, tickMsMax: 0,
    });
  }
  resetStats();
  stats.events = 0;

  function listener() { return (CBZ.camera && CBZ.camera.position) || { x: 0, y: 0, z: 0 }; }

  /* ======================================================================
     CBZ.meteor.begin(opts)
       root       Object3D to parent the pools under (the arena root)
       floor(x,z) ground height (unsubtracted surface)
       rnd()      the SHARED seeded stream — exactly one draw is taken
       cx,cz,R    arena centre + radius
       world      optional explicit world (trees/cars/buildings/glass)
       damage     { impact(x,z,spec), front(x,z,r0,r1,k,big,kPa), building(b,amount,dir) }
     ====================================================================== */
  function begin(opts) {
    if (ev) hardStop();
    rngState = (Math.floor(opts.rnd() * 4294967296) ^ 0x9e3779b9) >>> 0;
    const pl = pools();
    const az = frnd() * Math.PI * 2;
    const elev = 0.62 + frnd() * 0.35;             // 35°–55° descent
    const world = resolveWorld(opts);
    ev = {
      opts, az, elev, world,
      floor: opts.floor || world.ground,
      dirx: Math.cos(az), dirz: Math.sin(az),
      streaks: [], trains: [], bolides: [], smoke: [], flashes: [], fronts: [], sounds: [],
      lightPulses: [], rockN: 0, movers: [], fallers: [], craters: [], curtains: [],
      shower: null, streakCd: 0.1, t: 0, over: false, overT: 0, arrivals: [],
      budget: { glass: 0, dust: 0 },
    };
    for (const k of POOL_KEYS) opts.root.add(pl[k]);
    hookReset(world.src);
    stats.events++;
    return true;
  }

  // the island's own reset must also stand our trees back up: wrapped once,
  // the same way systems/wildfire.js hooks it
  function hookReset(src) {
    if (!src || src._meteorHooked || typeof src.reset !== "function") return;
    const orig = src.reset;
    src.reset = function () { try { restore(); } catch (e) {} return orig.apply(src, arguments); };
    src._meteorHooked = true;
  }

  function radiantVel(speed, jitter) {
    const j = jitter || 0;
    const a = ev.az + (frnd() - 0.5) * j;
    const el = ev.elev + (frnd() - 0.5) * j * 0.6;
    const ch = Math.cos(el);
    return { x: Math.cos(a) * ch * speed, y: -Math.sin(el) * speed, z: Math.sin(a) * ch * speed };
  }

  /* an ambient streak: burns out high, all on the one radiant */
  function spawnStreak(bright) {
    if (ev.streaks.length >= 60) return;
    const o = ev.opts;
    const gx = o.cx + (frnd() - 0.5) * o.R * 1.8, gz = o.cz + (frnd() - 0.5) * o.R * 1.8;
    const v = radiantVel(200 + frnd() * 70, 0.12);
    const life = 0.8 + frnd() * 0.8;
    const y0 = 160 + frnd() * 100;
    ev.streaks.push({
      x: gx - v.x * life * 0.5, y: y0, z: gz - v.z * life * 0.5, vx: v.x, vy: v.y, vz: v.z,
      len: 18 + frnd() * 26, w: (bright ? 1.2 : 0.7) + frnd() * 0.6, t: 0, life,
      color: frnd() < 0.25 ? 0xd9e6ff : 0xfff0d0, trainAcc: 0, bright: !!bright,
    });
    stats.streaksSpawned++;
  }

  /* ======================================================================
     CBZ.meteor.strike(s) — one aimed body. Reaches (x,z) — or its burst
     altitude above it — exactly `eta` s from now, along the radiant.
       cls   pebble|pop|chelyabinsk|tunguska|small|impact (or the old
             {air, big} shorthand)
       alt, W, L, size   optional overrides of the class
     ====================================================================== */
  function strike(s) {
    if (!ev) return false;
    let cls = s.cls;
    if (!cls) cls = s.air ? (s.big ? "chelyabinsk" : "pop") : (s.big ? "impact" : "small");
    const C = CLASSES[cls] || CLASSES.pop;
    const gy = ev.floor(s.x, s.z);
    const alt = C.air ? (s.alt != null ? s.alt : pick(C.alt)) : 0;
    const T = s.eta != null ? s.eta : 1.8;
    const speed = pick(C.speed);
    const v = radiantVel(speed, 0.05);
    const ty = gy + (C.air ? alt : 0.4);
    const b = {
      cls, C, x: s.x - v.x * T, y: ty - v.y * T, z: s.z - v.z * T,
      vx: v.x, vy: v.y, vz: v.z, tx: s.x, ty, tz: s.z, gy, alt,
      t: 0, T, size: s.size || C.size, air: C.air, big: cls === "chelyabinsk" || cls === "tunguska" || cls === "impact",
      W: s.W != null ? s.W : C.W, L: s.L || C.L, spec: s, trainAcc: 0, smokeAcc: 0,
      breakT: -1, nFrag: s.frag != null ? s.frag : C.frag, frag: false,
    };
    if (b.nFrag > 0 && C.breakUp) b.breakT = Math.max(0.2, T - C.breakUp / Math.abs(v.y));
    ev.bolides.push(b);
    stats.bolides++;
    return true;
  }

  /* the BREAK-UP: the body flares and goes on as a spray. For an airburst
     every piece ends in its own smaller burst (Chelyabinsk's several flares);
     an iron keeps its main mass and sheds a strewn field down-range. */
  function breakUp(b) {
    stats.flares++;
    const L = listener();
    ev.flashes.push({ x: b.x, y: b.y, z: b.z, t: 0, life: 0.35, r0: b.size * 2, r1: b.size * 6 });
    ev.lightPulses.push({ t: 0, life: 0.5, k: b.big ? 0.55 : 0.25 });
    if (CBZ.fx && CBZ.fx.flash) CBZ.fx.flash(Math.min(0.35, 70 / Math.max(30, Math.hypot(b.x - L.x, b.y - L.y, b.z - L.z))), 0xfff4e0);
    scheduleBang(b.x, b.y, b.z, 0.35, "rumble");
    for (let i = 0; i < 10; i++) puff(b.x + (frnd() - 0.5) * 6, b.y + (frnd() - 0.5) * 6, b.z + (frnd() - 0.5) * 6, 3 + frnd() * 3, 40 + frnd() * 30, 0x9d948a, 0.25);
    const left = b.T - b.t;
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    for (let i = 0; i < b.nFrag; i++) {
      const a = frnd() * Math.PI * 2, k = 0.04 + frnd() * 0.06;
      const f = {
        cls: b.cls, C: b.C, x: b.x, y: b.y, z: b.z,
        vx: b.vx + Math.cos(a) * sp * k, vy: b.vy * (0.95 + frnd() * 0.08), vz: b.vz + Math.sin(a) * sp * k,
        t: 0, T: left * (0.9 + frnd() * 0.3), size: b.size * (0.35 + frnd() * 0.2), air: true, big: false,
        W: b.air ? b.W * 0.08 : CLASSES.pop.W * 3, spec: b.spec, trainAcc: 0, smokeAcc: 0, breakT: -1, nFrag: 0, frag: true,
      };
      f.tx = f.x + f.vx * f.T; f.tz = f.z + f.vz * f.T;
      f.gy = ev.floor(f.tx, f.tz);
      f.ty = Math.max(f.gy + 12, f.y + f.vy * f.T);
      f.alt = f.ty - f.gy;
      // an iron's pieces that reach the floor fall as `small` meteorites
      if (!b.air && f.y + f.vy * f.T <= f.gy + 2) { f.air = false; f.cls = "small"; f.C = CLASSES.small; f.L = 0.05; f.ty = f.gy + 0.3; f.alt = 0; }
      ev.bolides.push(f);
      stats.fragments++;
    }
    if (b.air) { b.W *= 0.7; b.size *= 0.8; }
  }

  function puff(x, y, z, scale, life, tint, grow, vy, drag) {
    if (ev.smoke.length >= SMOKE_CAP - 2) ev.smoke.shift();
    ev.smoke.push({
      x, y, z, s0: scale, t: 0, life,
      rot: frnd() * 3.14, grow: grow != null ? grow : 0.5 + frnd() * 0.8,
      color: tint || (0x9a9a9a + ((frnd() * 24) | 0) * 0x010101),
      dx: (frnd() - 0.5) * 0.6, dy: vy != null ? vy : 0.4 + frnd() * 0.5, dz: (frnd() - 0.5) * 0.6,
      drag: drag || 0, hw: Math.min(1.8, 0.4 + y / 120),       // higher air moves faster
    });
  }

  function scheduleBang(x, y, z, vol, name) {
    const L = listener();
    const delay = Math.hypot(x - L.x, y - L.y, z - L.z) / SOUND_SPEED;
    ev.sounds.push({ t: delay, name: name || "explosion", x, z, vol });
    ev.sounds.push({ t: delay + 0.7 + frnd() * 0.5, name: "rumble", x, z, vol: vol * 0.6 });
    stats.bangsScheduled++;
    stats.flashToBangLast = +delay.toFixed(2);
    if (delay > stats.flashToBangMax) stats.flashToBangMax = +delay.toFixed(2);
    return delay;
  }

  /* ======================================================================
     THE FRONT — sorted once, walked by cursor
     ====================================================================== */
  function launchFront(x, z, gy, alt, W, surface, big, crater) {
    const o = ev.opts, Wd = ev.world;
    const maxR = reachOf(W, alt, surface, Math.max(120, o.R * 2.4));
    const list = [];
    const near = function (px, pz) { return Math.hypot(px - x, pz - z); };
    for (const gp of Wd.glass) { if (gp && !gp.shattered && gp.x != null) { const d = near(gp.x, gp.z); if (d < maxR) list.push({ d, k: 0, r: gp }); } }
    for (const t of Wd.trees) { if (t && !t._mDown) { const d = near(t.x, t.z); if (d < maxR) list.push({ d, k: 1, r: t }); } }
    for (const c of Wd.cars) { if (c && c.group && !c._mMoving && !(c.flung && !c._mHome)) { const p = c.group.position, d = near(p.x, p.z); if (d < maxR) list.push({ d, k: 2, r: c }); } }
    for (const b of Wd.buildings) { if (b && !b.fallen) { const bx = b.ox != null ? b.ox : b.x, bz = b.oz != null ? b.oz : b.z; const d = Math.max(0, near(bx, bz) - Math.max(b.w || 8, b.d || 8) * 0.5); if (d < maxR) list.push({ d, k: 3, r: b }); } }
    list.sort(function (a, b2) { return a.d - b2.d; });
    const f = {
      x, z, gy, alt, W, surface: !!surface, big: !!big, crater: crater || null,
      t: 0, r: 0, maxR, list, idx: 0, born: ev.t,
      // the observer's own clock: when does the front reach the listener?
      obs: (function () { const L = listener(); return { d: Math.hypot(L.x - x, L.z - z), at: -1 }; })(),
      predict: 0,
    };
    f.predict = Math.hypot(f.obs.d, alt) / SOUND_SPEED;
    ev.fronts.push(f);
    return f;
  }

  function applyFront(f, e) {
    const dp = overpressure(e.d, f.alt, f.W, f.surface);
    const r = e.r;
    if (e.k === 0) {                                   // GLASS
      const thr = GLASS_LO * Math.pow(GLASS_HI / GLASS_LO, h01(r.x, r.z + r.y, 11));
      if (dp >= thr) breakPane(r, f, e.d);
    } else if (e.k === 1) {                            // TREES
      hitTree(r, f, e.d, dp);
    } else if (e.k === 2) {                            // CARS
      shoveCar(r, f, dp);
    } else {                                           // BUILDINGS
      if (dp < BLDG_LIGHT) return;
      const bx = r.ox != null ? r.ox : r.x, bz = r.oz != null ? r.oz : r.z;
      const dl = Math.hypot(bx - f.x, bz - f.z) || 1;
      const sev = dp >= BLDG_GUT ? 1.1 : dp >= BLDG_HEAVY ? 0.55 : 0.2;
      damageBuilding(r, { x: bx, y: (r.gy || 0) + (r.h || 6) * 0.5, z: bz }, Math.max(r.w || 8, r.d || 8), sev,
        { x: (bx - f.x) / dl, y: f.alt > 0 ? -f.alt / Math.hypot(dl, f.alt) : 0, z: (bz - f.z) / dl });
      r._meteorKPa = Math.max(r._meteorKPa || 0, +dp.toFixed(1));
      // everything glazed on it goes too (its panes are in the glass list as
      // well, but a gutted shell is gutted on every face at once)
      if (dp >= BLDG_GUT) {
        if (!r._meteorGutted) { r._meteorGutted = true; stats.bldgGutted++; }
        gutGlass(r, f);
        // a crater's fireball or a low burst's flash lights it: the ground
        // floor from the heat outside, an airburst through the blown-in roof
        if (f.crater || f.alt < 50) fireBuilding(r, f.crater ? "heat" : "vent");
      }
    }
  }

  function gutGlass(b, f) {
    const bx = b.ox != null ? b.ox : b.x, bz = b.oz != null ? b.oz : b.z;
    const hw = (b.w || 8) * 0.5 + 0.6, hd = (b.d || 8) * 0.5 + 0.6;
    const G2 = ev.world.glass;
    for (let i = 0; i < G2.length; i++) {
      const gp = G2[i];
      if (!gp || gp.shattered || Math.abs(gp.x - bx) > hw || Math.abs(gp.z - bz) > hd) continue;
      breakPane(gp, f, Math.hypot(gp.x - f.x, gp.z - f.z));
    }
  }

  function breakPane(gp, f, d) {
    if (gp.shattered) return;
    gp.shattered = true;
    stats.panes++;
    const band = d < 50 ? "0-50" : d < 100 ? "50-100" : d < 150 ? "100-150" : d < 200 ? "150-200" : d < 300 ? "200-300" : "300+";
    (ev.glassByBand || (ev.glassByBand = {}))[band] = (ev.glassByBand[band] || 0) + 1;
    // the shards are blown INWARD, away from the blast
    const dx = gp.x - f.x, dz = gp.z - f.z, dl = Math.hypot(dx, dz) || 1;
    const D = CBZ.debris;
    if (D && ev.budget.glass > 0) {
      ev.budget.glass--;
      try { D.chips(gp.x, gp.y, gp.z, { kind: "glass", count: 6, power: 1.1, dir: { x: dx / dl, y: 0.15, z: dz / dl }, spread: gp.span || 0.5 }); } catch (e) {}
    }
    if (gp.hide) gp.hide(); else if (gp.mesh) gp.mesh.visible = false;
  }

  /* ---- TREES. Blown down radially, lean if merely pushed, and directly
     under an airburst — where the wave comes from above — left standing and
     stripped. A felled trunk is a rigid rod hinged at its base:
     theta'' = (3g / 2L) sin(theta). ---- */
  function treeBase(t) {
    if (t._mBase) return t._mBase;
    const tr = t.trunk, fo = t.foliage;
    t._mBase = {
      tp: tr ? tr.position.clone() : new THREE.Vector3(t.x, ev.floor(t.x, t.z), t.z),
      tq: tr ? tr.quaternion.clone() : null,
      fp: fo ? fo.position.clone() : null,
      fq: fo ? fo.quaternion.clone() : null,
      fvis: fo ? fo.visible : true,
      L: fo ? Math.max(2, fo.position.y - (tr ? tr.position.y : 0)) : 5,
    };
    touched.trees.push(t);
    return t._mBase;
  }
  function poseTree(t, ux, uz, ang) {
    const B = treeBase(t);
    _ax.set(uz, 0, -ux).normalize();
    _q.setFromAxisAngle(_ax, ang);
    if (t.trunk) { t.trunk.quaternion.copy(_q).multiply(B.tq); t.trunk.position.copy(B.tp); }
    if (t.foliage && B.fp) {
      _v.copy(B.fp).sub(B.tp).applyQuaternion(_q).add(B.tp);
      t.foliage.position.copy(_v);
      t.foliage.quaternion.copy(_q).multiply(B.fq);
    }
  }
  function hitTree(t, f, d, dp) {
    if (t._mDown) return;
    const thrF = TREE_FALL * (0.7 + 0.6 * h01(t.x, t.z, 21));
    const thrL = TREE_LEAN * (0.7 + 0.6 * h01(t.x, t.z, 22));
    if (dp < thrL) return;
    const dl = d || 1, ux = (t.x - f.x) / dl, uz = (t.z - f.z) / dl;
    const steep = f.alt > 0 && f.alt / Math.hypot(d, f.alt) > 0.82;
    if (dp >= thrF && steep) {
      // the telegraph poles: crown torn off, trunk scorched, still standing
      treeBase(t);
      t._mDown = "stripped";
      if (t.foliage) t.foliage.visible = false;
      if (t.trunk && t.trunk.material && t.trunk.material.color) t.trunk.material.color.setHex(0x2a211a);
      stats.treesStripped++;
      for (let i = 0; i < 3; i++) puff(t.x, ev.floor(t.x, t.z) + 3 + i, t.z, 1.2, 6, 0x5e6a3a, 0.8);
      return;
    }
    if (dp >= thrF) {
      treeBase(t);
      t._mDown = "down";
      // the push starts it moving; gravity finishes the fall
      ev.fallers.push({ t, ux, uz, a: 0.06, w: 0.35 + Math.min(1.2, (dp - thrF) / 25), target: 1.48 + 0.06 * h01(t.x, t.z, 23), lean: false });
      if (t.trunkCol && CBZ.colliders) {
        const i = CBZ.colliders.indexOf(t.trunkCol);
        if (i >= 0) { CBZ.colliders.splice(i, 1); touched.colliders.push({ c: t.trunkCol, back: true }); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
      }
      stats.treesDown++;
      t._mFellAt = +d.toFixed(1);
      if (!ev.maxFellD || d > ev.maxFellD) ev.maxFellD = +d.toFixed(1);
      return;
    }
    const ang = (4 + 22 * (dp - thrL) / Math.max(1, thrF - thrL)) * Math.PI / 180;
    if (!t._mLean || ang > t._mLean) {
      if (!t._mLean) stats.treesLeaning++;
      t._mLean = ang;
      ev.fallers.push({ t, ux, uz, a: 0, w: 0, target: ang, lean: true });
    }
  }
  function tickFallers(dt) {
    for (let i = ev.fallers.length - 1; i >= 0; i--) {
      const F = ev.fallers[i], B = treeBase(F.t);
      if (F.lean) {
        F.a = Math.min(F.target, F.a + dt * 1.6);
      } else {
        const L = Math.max(2, B.L);
        F.w += (3 * G / (2 * L)) * Math.sin(F.a) * dt;
        F.a += F.w * dt;
      }
      if (F.a >= F.target) {
        F.a = F.target;
        if (!F.lean) {
          // it lands in its own dust, crown first
          const L = B.L;
          const cx = F.t.x + F.ux * L * 0.8, cz = F.t.z + F.uz * L * 0.8;
          for (let k = 0; k < 2; k++) if (ev.budget.dust-- > 0) puff(cx + (frnd() - 0.5) * 2, ev.floor(cx, cz) + 0.6, cz + (frnd() - 0.5) * 2, 1.4, 5 + frnd() * 3, 0x8a7a64, 0.9);
        }
        poseTree(F.t, F.ux, F.uz, F.a);
        ev.fallers.splice(i, 1);
        continue;
      }
      poseTree(F.t, F.ux, F.uz, F.a);
    }
  }

  /* ---- CARS. The blast wind blows for its positive phase; drag against
     the car's side, minus tyre friction, moves it; drag moment past the
     weight moment rolls it. Integrated, so a car at 18 kPa twitches and one
     at 40 kPa goes over and over. ---- */
  function shoveCar(c, f, dp) {
    const g = c.group; if (!g || c._mMoving) return;
    const p = g.position;
    const dl = Math.hypot(p.x - f.x, p.z - f.z) || 1;
    const u0 = windBehind(dp);
    const q = dynamicP(dp) * 1000;
    const F = q * CAR.A * CAR.Cd;
    if (F < CAR.mu * CAR.m * G * 0.9) return;                 // it rocks on its springs, that is all
    if (!c._mHome) {
      c._mHome = { x: p.x, y: p.y, z: p.z, q: g.quaternion.clone() };
      touched.cars.push(c);
    }
    c._mMoving = true;
    c.flung = true;           // the island's reset parks it back where it was
    if (c.collider && CBZ.colliders) {
      const i = CBZ.colliders.indexOf(c.collider);
      if (i >= 0) { CBZ.colliders.splice(i, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
    }
    // the positive phase: how long the wind blows. Real durations scale as
    // W^(1/3); this is that law at the island's (game-readable) clock
    const td = 0.6 + 0.03 * Math.cbrt(f.W * (f.surface ? 1.8 : 1));
    ev.movers.push({ c, ux: (p.x - f.x) / dl, uz: (p.z - f.z) / dl, u0, td, tw: 0, v: 0, roll: 0, rollW: 0, rolled: false, moved: 0, x0: p.x, z0: p.z, y0: p.y - ev.floor(p.x, p.z) });
    stats.carsPushed++;
  }
  function tickMovers(dt) {
    for (let i = ev.movers.length - 1; i >= 0; i--) {
      const M = ev.movers[i], g = M.c.group;
      M.tw += dt;
      const u = M.tw < M.td ? M.u0 * (1 - M.tw / M.td) : 0;
      const rel = u - M.v;
      const Fd = 0.5 * RHO * CAR.Cd * CAR.A * rel * Math.abs(rel);
      // the roll: drag moment about the leeward wheels against the weight's
      if (!M.rolled && Fd * CAR.hcg > CAR.m * G * CAR.track * 0.5) { M.rolled = true; M.rollW = 2 + Math.min(4, (Fd / (CAR.m * G) - 1.3) * 2); }
      const mu = M.roll > 1 ? 0.55 : CAR.mu;
      let a = Fd / CAR.m;
      if (M.v > 0.01 || Math.abs(a) > mu * G) a -= mu * G * Math.sign(M.v || a);
      M.v = Math.max(0, M.v + a * dt);
      if (M.rolled) {
        // it rolls while the wind and its own speed carry it, then drops onto
        // whichever face it reached (side or roof)
        // TIPPING: the wind lifts the windward wheels; short of the balance
        // point (45 deg) when it dies, the car drops back onto them.
        // TUMBLING: past its side, it rolls over the ground it covers (a
        // car's section is ~6 m round, so ~1 rad per metre).
        if (M.roll < Math.PI / 2 && u > 0) M.roll += M.rollW * dt;
        else if (M.roll >= Math.PI / 2 - 0.01 && M.v > 1.5) M.roll += M.v * dt / 1.0;
        else {
          const rest = M.roll < Math.PI / 4 ? 0 : Math.round(M.roll / (Math.PI / 2)) * (Math.PI / 2);
          M.roll += Math.sign(rest - M.roll) * Math.min(Math.abs(rest - M.roll), 4 * dt);
        }
      }
      const dx = M.ux * M.v * dt, dz = M.uz * M.v * dt;
      g.position.x += dx; g.position.z += dz;
      M.moved += Math.hypot(dx, dz);
      // it pivots about its ground line: on its side it stands on half its
      // width, on its roof on its whole height
      const lift = M.rolled ? 0.9 * Math.abs(Math.sin(M.roll)) + 1.5 * Math.max(0, -Math.cos(M.roll)) : 0;
      g.position.y = ev.floor(g.position.x, g.position.z) + M.y0 + lift;
      if (M.rolled) {
        _ax.set(M.uz, 0, -M.ux).normalize();
        _q.setFromAxisAngle(_ax, M.roll);
        g.quaternion.copy(_q).multiply(M.c._mHome.q);
      }
      const settledRoll = !M.rolled || Math.abs(M.roll - Math.round(M.roll / (Math.PI / 2)) * (Math.PI / 2)) < 0.01;
      if (M.tw > M.td && M.v < 0.05 && settledRoll) {
        if (M.moved > stats.carMaxMove) stats.carMaxMove = +M.moved.toFixed(2);
        M.c._mMoved = +M.moved.toFixed(2);
        M.c._mRolled = M.roll > 1;
        if (M.roll > 1) stats.carsRolled++;
        // a solid where it came to rest, removed again by restore()
        if (CBZ.colliders) {
          const col = { minX: g.position.x - 1.6, maxX: g.position.x + 1.6, minZ: g.position.z - 1.6, maxZ: g.position.z + 1.6, ref: g, noCam: true };
          CBZ.colliders.push(col); touched.colliders.push({ c: col, back: false });
          if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
        }
        M.c._mMoving = false;
        ev.movers.splice(i, 1);
      }
    }
  }

  /* ======================================================================
     FIRE — the island's one fire (systems/wildfire.js as a service). The
     thermal pulse lights crowns and the bed under them; a gutted house burns
     floor by floor through the structural ledger; a glowing block lights the
     bed where it lands. Spread, smoke, char and the reset are the wildfire's.
     ====================================================================== */
  function WF() { const W = CBZ.wildfire; return W && W.igniteAt ? W : null; }
  function fireBuilding(b, how) {
    const W = WF();
    if (!W || !W.igniteBuilding) return false;
    let ok = false;
    try { ok = !!W.igniteBuilding(b, how); } catch (e) { ok = false; }
    if (ok) stats.fires++;
    return ok;
  }
  function fireGround(x, z, r) {
    const W = WF();
    if (!W) return false;
    let ok = false;
    try { ok = !!W.igniteAt(x, z, "meteor", r || 0); } catch (e) { ok = false; }
    if (ok) stats.fires++;
    return ok;
  }
  function ignite(cx, cz, R, p0) {
    const W = WF();
    if (!W) return;
    const T = ev.world.trees;
    for (let i = 0; i < T.length; i++) {
      const t = T[i]; if (!t || t.burnt || t.burning || t._mDown === "stripped") continue;
      const d = Math.hypot(t.x - cx, t.z - cz);
      if (d > R) continue;
      if (frnd() > p0 * (1 - d / R)) continue;
      let ok = false;
      try { ok = !!W.igniteTree(t, "meteor"); } catch (e) { ok = false; }
      if (ok) { stats.treesBurning++; stats.fires++; }
    }
  }

  function wind() { return CBZ.weatherWind ? CBZ.weatherWind() : { x: 1, z: 0, speed: 0 }; }

  /* ======================================================================
     TERMINALS
     ====================================================================== */
  function burst(b) {
    const alt = Math.max(4, b.ty - b.gy);
    const big = b.big;
    stats.airbursts++; if (big) stats.bigBursts++;
    ev.lastBurst = { cls: b.cls, x: +b.tx.toFixed(1), y: +b.ty.toFixed(1), z: +b.tz.toFixed(1), alt: +alt.toFixed(1), W: +b.W.toFixed(2), t: +ev.t.toFixed(2), big };
    if (big) ev.lastBig = ev.lastBurst;
    const r1 = b.cls === "tunguska" ? 40 : big ? 34 : 6 + 5 * b.size;
    ev.flashes.push({ x: b.tx, y: b.ty, z: b.tz, t: 0, life: big ? 0.8 : 0.45, r0: b.size * 2.5, r1 });
    const L = listener();
    const d = Math.hypot(b.tx - L.x, b.ty - L.y, b.tz - L.z);
    if (CBZ.fx && CBZ.fx.flash) CBZ.fx.flash(Math.min(big ? 0.95 : 0.5, (big ? 240 : 80) / Math.max(30, d)), 0xfff4e0);
    ev.lightPulses.push({ t: 0, life: big ? 1.6 : 0.6, k: big ? 1 : 0.4 });
    // the dust ball where the body ceased to exist, which then hangs
    const n = big ? 22 : 6;
    for (let i = 0; i < n; i++) {
      const s = big ? 12 : 4;
      puff(b.tx + (frnd() - 0.5) * s, b.ty + (frnd() - 0.5) * s, b.tz + (frnd() - 0.5) * s, (big ? 5 : 2.4) + frnd() * 3, (big ? 50 : 18) + frnd() * 20, big ? 0x9c8f82 : 0x8a8078, 0.8);
    }
    if (b.W > 0) launchFront(b.tx, b.tz, b.gy, alt, b.W, false, big, null);
    if (b.C && b.C.thermal) ignite(b.tx, b.tz, alt * b.C.thermal, 0.65);
    scheduleBang(b.tx, b.ty, b.tz, big ? 1 : 0.5);
  }

  function groundImpact(b) {
    const o = ev.opts;
    stats.groundImpacts++;
    const C = b.C, x = b.tx, z = b.tz, gy = b.gy;
    const L = b.L || C.L, v = C.v || 9000;
    const cr = craterOf(L, C.dens || 3300, v, ev.elev);
    const W = impactW(L, C.dens || 3300, v, C.eta);
    const T0 = performance.now(), sp = {};
    ev.lastImpact = { cls: b.cls, x: +x.toFixed(1), z: +z.toFixed(1), t: +ev.t.toFixed(2), craterR: +cr.R.toFixed(1), W: +W.toFixed(0) };
    if (o.damage && o.damage.impact) { try { o.damage.impact(x, z, Object.assign({ r: cr.R * 1.4 }, b.spec || {}, { cls: b.cls, craterR: cr.R })); } catch (e) {} }
    // THE HOLE: the shared carving, sized by the crater law. The placement
    // law can refuse (slope, water, a building on the spot): then the blanket
    // still lands, around a scar instead of a bowl.
    let shaft = null;
    const big = b.cls === "impact";
    /* craters.js retires its OLDEST hole past CRATER_MAX, so a run of small
       strikes after the big one would fill the island in under it. A small
       body only digs while two slots are still free. */
    const room = !CBZ.craterAudit || big || CBZ.craterAudit().craters < (CBZ.CONFIG.CRATER_MAX || 12) - 2;
    if (CBZ.groundCrater && cr.R >= 2.5 && room) {
      shaft = CBZ.groundCrater(x, z, { force: true, r: Math.min(18, cr.R), depth: Math.min(8, cr.depth), surface: "soil" });
      if (shaft) stats.cratersDug++; else stats.craterRefused++;
    }
    sp.crater = performance.now() - T0;
    const R = shaft ? shaft.r : cr.R;
    const rec = { x: +x.toFixed(1), z: +z.toFixed(1), r: +R.toFixed(1), dug: !!shaft, depth: +(shaft ? shaft.depth : 0).toFixed(1), rim: +Math.min(0.6, cr.rim).toFixed(2), D: +cr.D.toFixed(1) };
    ev.craters.push(rec);
    /* THE FRAME BUDGET. The dig is this frame's whole cost (the shared
       shaft builder); the blanket lands under the dust a frame later and the
       big blocks leave two frames later, so no single frame pays for all of
       it (measured in the lab: impactFrameParts). */
    const rimH = shaft ? Math.min(0.6, cr.rim) : 0;
    later(1, function () { blanket(x, z, R, rimH, big ? 3.4 : 2.6, big); });
    sp.blanket = 0;
    // the fireball (light, now) and the ejecta curtain, rocks and plume
    ev.flashes.push({ x, y: gy + R * 0.4, z, t: 0, life: big ? 1.4 : 0.5, r0: R * 0.4, r1: R * (big ? 1.8 : 1.2), fire: true });
    ev.lightPulses.push({ t: 0, life: big ? 2.2 : 0.7, k: big ? 1 : 0.4 });
    const Ls = listener();
    if (CBZ.fx && CBZ.fx.flash) CBZ.fx.flash(Math.min(big ? 0.9 : 0.4, (big ? 260 : 60) / Math.max(30, Math.hypot(x - Ls.x, z - Ls.z))), 0xffe6c0);
    if (big) curtain(x, z, gy, R);
    ejecta(x, z, gy, R, big ? 150 : 24, big);
    plume(x, z, gy, R, big);
    if (big) { ignite(x, z, R * 2.6, 0.9); fireGround(x, z, R * 1.4); later(2, function () { secondaries(x, z, gy, R); }); }
    sp.ejecta = performance.now() - T0 - sp.crater - sp.blanket;
    launchFront(x, z, gy, 0, W, true, big, rec);
    sp.front = performance.now() - T0 - sp.crater - sp.blanket - sp.ejecta;
    if (big) { stats.impactMs = {}; for (const k in sp) stats.impactMs[k] = +sp[k].toFixed(2); }
    if (CBZ.shake) CBZ.shake(big ? 1.2 : 0.4);
    scheduleBang(x, gy, z, big ? 1 : 0.6, "explosion");
  }

  // run `fn` `frames` ticks from now (the pending queue runs at tick start)
  function later(frames, fn) { (ev.pending || (ev.pending = [])).push({ t: frames * 1e-3, frames: frames, fn: fn }); }

  /* THE RIM AND THE EJECTA BLANKET: overturned subsoil lying on the ground
     round the hole, thickest at the rim crest and thinning as (r/R)^-3
     (McGetchin), the continuous blanket out to ~2 crater radii and only the
     RAYS beyond. Draped on the real terrain, vertex by vertex. */
  function blanket(cx, cz, R, rimH, outer, big) {
    const NA = big ? 64 : 28, NR = big ? 20 : 8;
    const rIn = R * (rimH > 0 ? 0.95 : 0.2), rOut = R * outer;
    const pos = new Float32Array((NA + 1) * (NR + 1) * 3), col = new Float32Array((NA + 1) * (NR + 1) * 3), uv = new Float32Array((NA + 1) * (NR + 1) * 2);
    const idx = [];
    const crest = R * 1.05;
    for (let j = 0; j <= NR; j++) {
      const u = j / NR, rr = rIn + (rOut - rIn) * Math.pow(u, 1.6);
      let h;
      if (rimH <= 0) h = 0.03;
      else if (rr < crest) h = rimH * Math.max(0, (rr - rIn) / (crest - rIn));
      else h = rimH * Math.pow(rr / crest, -3);
      for (let i = 0; i <= NA; i++) {
        const a = (i / NA) * Math.PI * 2;
        const wob = 1 + (h01(Math.cos(a) * 3, Math.sin(a) * 3, 31) - 0.5) * 0.08 * (u < 0.3 ? 1 : 0.4);
        const x = cx + Math.cos(a) * rr * wob, z = cz + Math.sin(a) * rr * wob;
        const k = (j * (NA + 1) + i);
        pos[k * 3] = x; pos[k * 3 + 1] = ev.floor(x, z) + h + 0.05; pos[k * 3 + 2] = z;
        // overturned bedrock is paler near the rim (the deepest layers land
        // closest), browner out on the blanket
        const n = h01(x * 0.7, z * 0.7, 32) * 0.12;
        const pale = Math.max(0, 1 - u * 1.6);
        col[k * 3] = 0.42 + 0.16 * pale + n; col[k * 3 + 1] = 0.36 + 0.13 * pale + n; col[k * 3 + 2] = 0.29 + 0.11 * pale + n;
        uv[k * 2] = u; uv[k * 2 + 1] = i / NA;
      }
    }
    for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) {
      const a = j * (NA + 1) + i, b2 = a + 1, c = a + NA + 1, d = c + 1;
      idx.push(a, c, b2, b2, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, alphaMap: rays(), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true; m.renderOrder = 2;
    m.userData.transient = true;      // the island's reset sweeps it
    m.userData.meteorBlanket = true;
    ev.opts.root.add(m);
    touched.meshes.push(m);
  }

  /* THE EJECTA CURTAIN: an inverted cone of debris that walks outward from
     the rim, its base where the ejecta is landing right now */
  function curtain(x, z, gy, R) {
    const geo = new THREE.CylinderGeometry(1, 0.55, 1, 48, 1, true);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0x7a6853, transparent: true, opacity: 0.0, alphaMap: curtainStreaks(), side: THREE.DoubleSide, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, gy, z); m.renderOrder = 6;
    ev.opts.root.add(m);
    ev.curtains.push({ m, R, t: 0, life: 4.2 });
  }
  function tickCurtains(dt) {
    for (let i = ev.curtains.length - 1; i >= 0; i--) {
      const c = ev.curtains[i]; c.t += dt;
      const u = c.t / c.life;
      if (u >= 1) { c.m.parent && c.m.parent.remove(c.m); c.m.geometry.dispose(); c.m.material.dispose(); ev.curtains.splice(i, 1); continue; }
      // base radius: the ballistic landing front, R at launch, ~2.6R at the end
      const base = c.R * (0.95 + 1.7 * Math.sqrt(u));
      const h = c.R * (0.4 + 2.2 * Math.sqrt(u)) * (1 - 0.35 * u);
      // the geometry's top ring is 1, its bottom 0.55 — scale so the bottom
      // lands on `base` and the wall leans out at ~45 degrees
      const sx = base / 0.55;
      c.m.scale.set(sx, h, sx);
      c.m.material.opacity = 0.75 * Math.min(1, c.t / 0.15) * (1 - u * u);
    }
  }

  /* the rocks of the curtain: launched from inside the transient cavity,
     the inner ones fastest (they land furthest), on real arcs. They are
     the shared loose bits of systems/debris.js (2026-10-15): the same
     gravity, the same floor (a rock that comes down on a roof lies on the
     roof, and falls again if the roof goes), rest, reset and audit as every
     other piece. This file kept a private pool of them that flew through
     buildings, landed on the bare terrain under a roof and was wiped
     (mid-flight too) when the event's pools were torn down. A hot block
     glows and smokes as it cools. */
  function ejecta(x, z, gy, R, n, big) {
    const D = CBZ.debris;
    if (!D || !D.bit) return;
    for (let i = 0; i < n; i++) {
      if (ev.rockN >= ROCK_CAP) break;
      const a = frnd() * Math.PI * 2;
      const r0 = R * (0.2 + 0.7 * frnd());
      const land = R * (1.05 + (big ? 2.6 : 1.2) * Math.pow(1 - r0 / R, 1.5) * (0.6 + 0.8 * frnd()));
      const th = (40 + frnd() * 12) * Math.PI / 180;
      const range = land - r0;
      const vv = Math.sqrt(G * range / Math.sin(2 * th));
      const s = (big ? 0.18 : 0.1) + Math.pow(frnd(), 3) * (big ? 0.6 : 0.25);
      const hot = frnd() < (big ? 0.18 : 0.08);
      try {
        D.bit(x + Math.cos(a) * r0, gy + 0.2, z + Math.sin(a) * r0, {
          shape: "stone", kind: "rock", color: frnd() < 0.5 ? 0x5a4c3e : 0x6e6355, size: s * 1.4,
          vel: { x: Math.cos(a) * vv * Math.cos(th), y: vv * Math.sin(th), z: Math.sin(a) * vv * Math.cos(th) },
          burn: hot ? 25 : 0, owner: "meteor",
        });
      } catch (e) {}
      ev.rockN++;
      stats.ejecta++;
    }
  }

  /* SECONDARY IMPACTS: the big blocks thrown furthest come down as rocks of
     their own (fx.dropDebris: they crush whoever they land on, and stay) */
  function secondaries(x, z, gy, R) {
    if (!CBZ.fx || !CBZ.fx.dropDebris) return;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = frnd() * Math.PI * 2, dist = R * (2.2 + 3.2 * frnd());
      const glow = i < 4;
      const tx = x + Math.cos(a) * dist, tz = z + Math.sin(a) * dist;
      CBZ.fx.dropDebris({
        x: tx, z: tz, fromX: x + Math.cos(a) * R * 0.3, fromZ: z + Math.sin(a) * R * 0.3, fromY: gy + 1.5,
        size: 0.7 + frnd() * 0.8, shape: "rock", glow, color: glow ? 0xff7a26 : 0x4a3a30,
        dmg: 30, linger: glow ? 40 : 20, keep: true,
        onLand: function (lx, lz) {
          if (!ev) return;
          stats.secondaries++;
          const fy = ev.floor(lx, lz);
          for (let k = 0; k < 3; k++) puff(lx + (frnd() - 0.5) * 2, fy + 0.8 + k * 0.6, lz + (frnd() - 0.5) * 2, 1.4 + frnd(), 8 + frnd() * 5, 0x7a6a5a, 1);
          if (glow) fireGround(lx, lz, 0);
        },
      });
    }
  }

  /* THE DUST PLUME: a column that climbs on its own heat, slows, and spreads
     at the top into a cap that hangs over the island */
  function plume(x, z, gy, R, big) {
    const n = big ? 70 : 10;
    for (let i = 0; i < n; i++) {
      const a = frnd() * Math.PI * 2, rr = R * 0.5 * Math.sqrt(frnd());
      const vy = big ? 9 + frnd() * 16 : 3 + frnd() * 4;
      const p = { x: x + Math.cos(a) * rr, y: gy + 1 + frnd() * 3, z: z + Math.sin(a) * rr };
      const delay = frnd() * (big ? 2.5 : 0.6);
      ev.pending = ev.pending || [];
      ev.pending.push({ t: delay, fn: function () {
        puff(p.x, p.y, p.z, (big ? 3.5 : 1.6) + frnd() * 2.5, (big ? 50 : 14) + frnd() * 25, frnd() < 0.5 ? 0x7d6e60 : 0x93857a, big ? 2.2 : 1.2, vy, 0.45);
      } });
    }
  }

  /* ======================================================================
     THE SHOWER — many small bodies over the event, from the one radiant
     ====================================================================== */
  function shower(o) {
    if (!ev) return false;
    o = o || {};
    ev.shower = { rate: o.rate != null ? o.rate : 3, acc: 0, pop: o.pop != null ? o.pop : 0.12, ground: o.ground != null ? o.ground : 0.05, until: o.dur != null ? ev.t + o.dur : Infinity };
    return true;
  }
  function tickShower(dt) {
    const S = ev.shower;
    if (!S || ev.over || ev.t > S.until) return;
    S.acc += dt * S.rate;
    while (S.acc >= 1) {
      S.acc -= 1;
      const o = ev.opts;
      const a = frnd() * Math.PI * 2, d = o.R * 0.85 * Math.sqrt(frnd());
      const x = o.cx + Math.cos(a) * d, z = o.cz + Math.sin(a) * d;
      const q = frnd();
      const cls = q < S.ground ? "small" : q < S.ground + S.pop ? "pop" : "pebble";
      if (cls === "pebble") { spawnStreak(true); continue; }
      strike({ x, z, cls, eta: 1.2 + frnd() * 0.6, size: cls === "small" ? 0.7 : 0.8, L: cls === "small" ? 0.06 : undefined });
    }
  }

  /* ======================================================================
     TICK
     ====================================================================== */
  function tick(dt) {
    if (!ev) return;
    const t0 = performance.now();
    ev.t += dt;
    ev.budget.glass = 10; ev.budget.dust = 6;
    if (ev.over) ev.overT += dt;

    if (!ev.over) {
      ev.streakCd -= dt;
      if (ev.streakCd <= 0) { ev.streakCd = 0.08 + frnd() * 0.18; spawnStreak(false); }
      tickShower(dt);
    }
    if (ev.pending) for (let i = ev.pending.length - 1; i >= 0; i--) {
      const p = ev.pending[i];
      if (p.frames != null) { if (--p.frames >= 0) continue; } else { p.t -= dt; if (p.t > 0) continue; }
      ev.pending.splice(i, 1); p.fn();
    }

    for (let i = ev.streaks.length - 1; i >= 0; i--) {
      const s = ev.streaks[i]; s.t += dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.bright) { s.trainAcc += dt; if (s.trainAcc > 0.06) { s.trainAcc = 0; train(s.x, s.y, s.z, s.vx, s.vy, s.vz, 10, 0.5, 0.6); } }
      if (s.t >= s.life) ev.streaks.splice(i, 1);
    }

    // bolides fly, lay their trains, break up, end
    for (let i = ev.bolides.length - 1; i >= 0; i--) {
      const b = ev.bolides[i]; b.t += dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      const ds = Math.hypot(b.vx, b.vy, b.vz) * dt;
      b.trainAcc += ds; b.smokeAcc += ds;
      const tstep = b.big ? 5 : 7;
      while (b.trainAcc > tstep) { b.trainAcc -= tstep; train(b.x, b.y, b.z, b.vx, b.vy, b.vz, tstep * 1.6, (b.big ? 2.2 : 1.0) * b.size / (b.C.size || 1), b.C.train || 1); }
      // the smoke train only below the burn-up height: the dust is what is
      // left of the body, and it hangs (a minute, widening, shearing)
      // (only a bright fireball leaves a train that lasts; a pop's is brief)
      const sstep = b.big ? 3.5 : 10;
      if (b.C.smoke && b.y < b.gy + (b.big ? 240 : 150)) while (b.smokeAcc > sstep) {
        b.smokeAcc -= sstep;
        puff(b.x + (frnd() - 0.5) * 2, b.y + (frnd() - 0.5) * 2, b.z + (frnd() - 0.5) * 2,
          (b.big ? 2.8 : 1.4) * b.C.smoke * 0.6 + frnd() * 1.2, b.big ? 55 + frnd() * 20 : 12 + frnd() * 10, 0xaaa196, b.big ? 2.6 : 1.5);
      } else if (b.smokeAcc > sstep) b.smokeAcc = 0;
      if (b.breakT > 0 && b.t >= b.breakT) { b.breakT = -1; breakUp(b); }
      if (b.t >= b.T) {
        ev.bolides.splice(i, 1);
        if (b.cls === "pebble") continue;
        if (b.air) burst(b); else groundImpact(b);
      }
    }

    for (let i = ev.trains.length - 1; i >= 0; i--) { const s = ev.trains[i]; s.t += dt; if (s.t >= s.life) ev.trains.splice(i, 1); }
    for (let i = ev.flashes.length - 1; i >= 0; i--) { const f = ev.flashes[i]; f.t += dt; if (f.t >= f.life) ev.flashes.splice(i, 1); }

    // THE FRONTS
    for (let i = ev.fronts.length - 1; i >= 0; i--) {
      const f = ev.fronts[i]; f.t += dt;
      const ct = SOUND_SPEED * f.t;
      const r = ct > f.alt ? Math.sqrt(ct * ct - f.alt * f.alt) : 0;
      if (r > 0) {
        const r0 = f.r;
        while (f.idx < f.list.length && f.list[f.idx].d <= r) applyFront(f, f.list[f.idx++]);
        const o = ev.opts;
        if (o.damage && o.damage.front && r > r0) {
          const dp = overpressure(r, f.alt, f.W, f.surface);
          try { o.damage.front(f.x, f.z, r0, r, Math.min(1, dp / 40), f.big, dp); } catch (e) {}
        }
        if (f.obs.at < 0 && r >= f.obs.d) {
          f.obs.at = f.t;
          ev.arrivals.push({ big: f.big, d: +f.obs.d.toFixed(1), alt: +f.alt.toFixed(1), kPa: +overpressure(f.obs.d, f.alt, f.W, f.surface).toFixed(2), delay: +f.t.toFixed(3), predicted: +f.predict.toFixed(3) });
        }
        // the dust the front raises off the ground where it is still strong
        const dpr = overpressure(r, f.alt, f.W, f.surface);
        if (dpr > 2.5 && ev.budget.dust > 0) {
          const nd = f.big ? 3 : 1;
          for (let k = 0; k < nd && ev.budget.dust-- > 0; k++) {
            const a = frnd() * Math.PI * 2, px = f.x + Math.cos(a) * r, pz = f.z + Math.sin(a) * r;
            puff(px, ev.floor(px, pz) + 0.8, pz, 1.2 + Math.min(3, dpr / 10), 3 + frnd() * 3, 0x9a8b7a, 1.2);
          }
        }
        f.r = r;
      }
      if (f.r >= f.maxR && f.idx >= f.list.length) ev.fronts.splice(i, 1);
    }

    tickFallers(dt);
    tickMovers(dt);
    tickCurtains(dt);

    // smoke drifts on THE wind (stronger aloft) and swells
    const w = wind();
    const wk = 0.5 + (w.speed || 0) * 0.12;
    for (let i = ev.smoke.length - 1; i >= 0; i--) {
      const p = ev.smoke[i]; p.t += dt;
      if (p.drag) { const dk = Math.exp(-p.drag * dt); p.dy *= dk; }
      p.x += (p.dx + w.x * wk * p.hw) * dt; p.y += p.dy * dt; p.z += (p.dz + w.z * wk * p.hw) * dt;
      if (p.t >= p.life) ev.smoke.splice(i, 1);
    }

    for (let i = ev.sounds.length - 1; i >= 0; i--) {
      const s = ev.sounds[i]; s.t -= dt;
      if (s.t <= 0) { ev.sounds.splice(i, 1); if (CBZ.sfxAt) CBZ.sfxAt(s.name, s.x, s.z, { volume: Math.min(1, s.vol) }); stats.bangsHeard++; }
    }
    for (let i = ev.lightPulses.length - 1; i >= 0; i--) { const p = ev.lightPulses[i]; p.t += dt; if (p.t >= p.life) ev.lightPulses.splice(i, 1); }

    draw();
    const ms = performance.now() - t0;
    stats.tickMs = +ms.toFixed(3);
    if (ms > stats.tickMsMax) stats.tickMsMax = +ms.toFixed(3);

    // the afterglow ends when nothing is left moving or burning, or after
    // two minutes either way
    if (ev.over && ((!ev.fronts.length && !ev.bolides.length && !ev.movers.length && !ev.fallers.length && !ev.smoke.length && !ev.curtains.length && !ev.sounds.length) || ev.overT > (ev.settleBy || 120))) hardStop(true);
  }

  // one glowing segment of ionized train
  function train(x, y, z, vx, vy, vz, len, w, k) {
    if (ev.trains.length >= STREAK_CAP - 40) ev.trains.shift();
    ev.trains.push({ x, y, z, vx, vy, vz, len, w, t: 0, life: (0.9 + frnd() * 0.6) * k });
  }

  /* ======================================================================
     DRAW — one matrix rebuild per pool per tick
     ====================================================================== */
  const TRAIN_COLS = [0xe4ecff, 0xa8ffd0, 0xffb070, 0x803820];
  function trainColor(u) {
    const f = Math.min(2.999, u * 3), i = f | 0, k = f - i;
    const a = TRAIN_COLS[i], b = TRAIN_COLS[i + 1];
    const r = lerp((a >> 16) & 255, (b >> 16) & 255, k), g = lerp((a >> 8) & 255, (b >> 8) & 255, k), bl = lerp(a & 255, b & 255, k);
    return (r << 16) | (g << 8) | bl;
  }
  function draw() {
    const pl = P;
    let n = 0;
    const S = pl.streak;
    const put = function (x, y, z, vx, vy, vz, len, w, color, k) {
      if (n >= STREAK_CAP) return;
      dummy.position.set(x, y, z);
      dummy.lookAt(x + vx, y + vy, z + vz);
      dummy.scale.set(w, w, len);
      dummy.updateMatrix();
      S.setMatrixAt(n, dummy.matrix);
      setColor(S, n, color, k);
      n++;
    };
    for (const b of ev.bolides) {
      const s = b.size / (b.C.size || 1);
      put(b.x - b.vx * 0.06, b.y - b.vy * 0.06, b.z - b.vz * 0.06, b.vx, b.vy, b.vz, (b.big ? 34 : 16) * s, (b.big ? 2.6 : 1.1) * s, 0xffc070, 1);
      put(b.x - b.vx * 0.16, b.y - b.vy * 0.16, b.z - b.vz * 0.16, b.vx, b.vy, b.vz, (b.big ? 52 : 24) * s, (b.big ? 1.4 : 0.6) * s, 0xff8040, 1);
    }
    for (const s of ev.streaks) {
      const fade = 1 - s.t / s.life;
      put(s.x, s.y, s.z, s.vx, s.vy, s.vz, s.len * (0.4 + 0.6 * fade), s.w * (0.3 + 0.7 * fade), s.color, 1);
    }
    for (const s of ev.trains) {
      const u = s.t / s.life;
      put(s.x, s.y, s.z, s.vx, s.vy, s.vz, s.len, s.w * (1 + u * 1.8), trainColor(u), (1 - u) * (1 - u) * 0.8);
    }
    S.count = n; S.visible = n > 0;
    S.instanceMatrix.needsUpdate = true; S.instanceColor.needsUpdate = true;

    let g = 0;
    const Gp = pl.glow;
    const orb = function (x, y, z, r, color, k) {
      if (g >= GLOW_CAP) return;
      dummy.position.set(x, y, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(r, r, r); dummy.updateMatrix();
      Gp.setMatrixAt(g, dummy.matrix); setColor(Gp, g, color, k); g++;
    };
    for (const b of ev.bolides) {
      const r = (b.big ? 3.4 : 1.4) * (0.85 + 0.3 * Math.sin(b.t * 37)) * (b.size / (b.C.size || 1));
      orb(b.x, b.y, b.z, r, 0xfff6e6, 1);
      orb(b.x, b.y, b.z, r * 2.3, 0x553311, 1);
    }
    for (const f of ev.flashes) {
      const u = f.t / f.life;
      const rr = f.r0 + (f.r1 - f.r0) * Math.sqrt(u) * (1 - u * 0.3);
      if (f.fire) orb(f.x, f.y, f.z, rr, u < 0.2 ? 0xffffff : u < 0.5 ? 0xffc070 : 0x8a3010, 1 - u * 0.7);
      else orb(f.x, f.y, f.z, rr, u < 0.3 ? 0xffffff : 0xffd9a0, 1 - u * 0.5);
    }
    Gp.count = g; Gp.visible = g > 0;
    Gp.instanceMatrix.needsUpdate = true; Gp.instanceColor.needsUpdate = true;

    let m = 0;
    const Sm = pl.smoke;
    for (const p of ev.smoke) {
      if (m >= SMOKE_CAP) break;
      const u = p.t / p.life;
      const s = p.s0 * (1 + p.grow * u) * (u > 0.75 ? (1 - u) / 0.25 : 1) * Math.min(1, p.t / 0.25 + 0.3);
      if (s < 0.05) continue;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.rot, p.rot * 1.7, p.rot * 0.6);
      dummy.scale.set(s, s * 0.85, s);
      dummy.updateMatrix();
      Sm.setMatrixAt(m, dummy.matrix); setColor(Sm, m, p.color, 1);
      m++;
    }
    Sm.count = m; Sm.visible = m > 0;
    Sm.instanceMatrix.needsUpdate = true; Sm.instanceColor.needsUpdate = true;

    let rg = 0;
    const Rg = pl.ring;
    for (const f of ev.fronts) {
      if (rg >= RING_CAP || f.r <= 0) continue;
      const dp = overpressure(f.r, f.alt, f.W, f.surface);
      const k = Math.min(1, dp / 12);
      if (k < 0.04) continue;
      dummy.position.set(f.x, f.gy + 0.35, f.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(f.r, 1, f.r); dummy.updateMatrix();
      Rg.setMatrixAt(rg, dummy.matrix); setColor(Rg, rg, 0xb8a890, k * 0.7); rg++;
    }
    Rg.count = rg; Rg.visible = rg > 0;
    Rg.instanceMatrix.needsUpdate = true; Rg.instanceColor.needsUpdate = true;
  }

  /* how hard the sky is lighting the world right now, 0..1 */
  function lightBoost() {
    if (!ev) return 0;
    let b = 0;
    for (const p of ev.lightPulses) b = Math.max(b, p.k * (1 - p.t / p.life));
    for (const bo of ev.bolides) {
      const low = Math.max(0, 1 - (bo.y - bo.gy) / 220);
      b = Math.max(b, (bo.big ? 0.55 : 0.12) * low);
    }
    return Math.min(1, b);
  }

  /* stop(): the sky stops; what is already falling, burning or rolling
     finishes (the afterglow ticks itself, below) */
  function stop() {
    if (!ev) return;
    ev.over = true;
    ev.shower = null;
  }
  /* settle(secs): THE SHOWER IS OVER AND THE SKY HAS TO SAY SO. stop() alone
     let the afterglow run to two minutes, because a big body's dust train is
     born with a 55-75 s life: the meteor "lasted way too long" and its haze
     drifted over whatever came next. The director's calm calls this: no new
     bodies, every puff fades out inside `secs`, and whatever is still in the
     air at the deadline is cleared. What it did to the ground (craters,
     blankets, felled trees, moved cars) stays until restore(). */
  function settle(secs) {
    if (!ev) return;
    secs = Math.max(0.5, +secs || 8);
    stop();
    const by = ev.overT + secs;
    ev.settleBy = Math.min(ev.settleBy || 120, by);
    // staggered (golden-ratio spread, not the event's rng) so the haze thins
    // instead of vanishing on one frame
    for (let i = 0; i < ev.smoke.length; i++) { const p = ev.smoke[i]; p.life = Math.min(p.life, p.t + secs * (0.45 + 0.55 * ((i * 0.618034) % 1))); }
    for (const s of ev.trains) s.life = Math.min(s.life, s.t + secs * 0.5);
  }
  function hardStop() {
    if (!ev) return;
    const pl = P;
    for (const k of POOL_KEYS) { const mp = pl[k]; if (mp.parent) mp.parent.remove(mp); mp.count = 0; mp.visible = false; }
    for (const c of ev.curtains) { c.m.parent && c.m.parent.remove(c.m); c.m.geometry.dispose(); c.m.material.dispose(); }
    // anything mid-fall lands where it is headed; anything sliding stops
    for (const F of ev.fallers) poseTree(F.t, F.ux, F.uz, F.target);
    for (const M of ev.movers) M.c._mMoving = false;
    ev = null;
  }
  /* restore(): the next match starts on the island's own world */
  function restore() {
    hardStop();
    for (const t of touched.trees) {
      const B = t._mBase;
      if (B) {
        if (t.trunk) { t.trunk.position.copy(B.tp); t.trunk.quaternion.copy(B.tq); }
        if (t.foliage && B.fp) { t.foliage.position.copy(B.fp); t.foliage.quaternion.copy(B.fq); t.foliage.visible = B.fvis; }
      }
      t._mBase = null; t._mDown = null; t._mLean = 0;
    }
    touched.trees.length = 0;
    for (const c of touched.cars) {
      const H = c._mHome;
      if (H && c.group) { c.group.position.set(H.x, H.y, H.z); c.group.quaternion.copy(H.q); }
      if (c.collider && CBZ.colliders && CBZ.colliders.indexOf(c.collider) < 0) CBZ.colliders.push(c.collider);
      c._mHome = null; c._mMoving = false; c._mMoved = 0; c._mRolled = false;
    }
    touched.cars.length = 0;
    for (const e of touched.colliders) {
      if (!CBZ.colliders) break;
      const i = CBZ.colliders.indexOf(e.c);
      if (e.back) { if (i < 0) CBZ.colliders.push(e.c); }
      else if (i >= 0) CBZ.colliders.splice(i, 1);
    }
    touched.colliders.length = 0;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    for (const m of touched.meshes) { if (m.parent) m.parent.remove(m); m.geometry.dispose(); m.material.dispose(); }
    touched.meshes.length = 0;
  }

  // the afterglow drives itself once the owning def has stopped calling tick
  if (CBZ.onUpdate) CBZ.onUpdate(27.5, function (dt) { if (ev && ev.over) tick(dt); });

  CBZ.meteor = {
    begin, strike, shower, tick, stop, settle, hardStop, restore, lightBoost,
    live: function () { return !!ev && !ev.over; },
    // anything of the event still in the sky (the afterglow included)
    busy: function () { return !!ev; },
    // the physics, exported for the lab and the ratchet
    law: { overpressure, windBehind, dynamicP, craterOf, impactW, reachOf, SOUND_SPEED, CLASSES },
  };

  CBZ.meteorAudit = function () {
    const a = Object.assign({ on: true, live: !!ev && !ev.over, afterglow: !!ev && ev.over, soundSpeed: SOUND_SPEED }, stats);
    a.bolidesSpawned = stats.bolides; a.bolides = [];
    a.lightBoost = +lightBoost().toFixed(3);
    a.drawsOwned = ev ? 6 + (ev.curtains.length) : 0;
    if (ev) {
      a.radiantAz = +ev.az.toFixed(3); a.radiantElev = +ev.elev.toFixed(3);
      a.streaksLive = ev.streaks.length; a.trainsLive = ev.trains.length;
      a.streakDirs = ev.streaks.map(function (s) { return { x: +s.vx.toFixed(2), z: +s.vz.toFixed(2) }; });
      a.bolides = ev.bolides.map(function (b) { return { cls: b.cls, x: +b.x.toFixed(1), y: +b.y.toFixed(1), z: +b.z.toFixed(1), tx: +b.tx.toFixed(1), tz: +b.tz.toFixed(1), big: b.big, air: b.air, eta: +(b.T - b.t).toFixed(2) }; });
      a.lastBurst = ev.lastBurst || null;
      a.lastBigBurst = ev.lastBig || null;
      a.lastImpact = ev.lastImpact || null;
      a.craters = ev.craters.slice();
      a.glassByBand = Object.assign({}, ev.glassByBand || {});
      a.arrivals = ev.arrivals.slice();
      a.maxFellD = ev.maxFellD || 0;
      a.smokeLive = ev.smoke.length; a.rocksLive = ev.rockN;
      a.frontsLive = ev.fronts.length; a.bangsPending = ev.sounds.length;
      a.carsMoving = ev.movers.length; a.treesFalling = ev.fallers.filter(function (f) { return !f.lean; }).length;
    }
    return a;
  };
})();
