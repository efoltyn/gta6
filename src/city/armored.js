/* ============================================================
   city/armored.js — AGENT BRINKS: the ARMORED CASH TRUCK heist target.

   WHY: the city already has cars to steal and roofs to crack, but no
   high-stakes ROLLING SCORE — a target that's genuinely HARD to crack and
   pays a genuinely FAT haul. This is that target: every so often a boxy
   armored cash truck (Brink's-style) joins traffic and drives the roads
   like any other car. It is a real RISK/REWARD play:

     • HARD TO CRACK — the hull is heavily armored. Small-arms fire barely
       dents it (a wrap on cityDamageCar shrugs off ~94% of bullet energy
       against this truck only); you can empty a rifle into it and it just
       sparks. Ramming it does almost nothing.
     • CREW THAT FIGHTS — an armored crew rides with it. The moment you
       open up on the truck (or crack it), the guards BAIL OUT and engage:
       real cops spawned through citySpawnCop, so they shoot back, take
       cover, and the wanted system treats this exactly like cop combat.
     • YOU BLOW IT OPEN — the ONLY reliable way in is EXPLOSIVES. An RPG,
       a grenade, or a stuck C4 charge near the truck routes through the
       EXACT same cityExplosion chain everything else uses; we listen on
       that chain (wrap cityExplosion) and feed the blast straight into the
       truck's armored health. Enough boom = the doors blow → CRACKED.
     • REALISTIC HAUL — a cracked truck SPILLS cash on the street. The haul
       is scaled to real reporting (see RESEARCH below): a typical robbed
       truck mid-route carries several hundred K to ~$1.5M; a full-route
       "fat" truck can approach the insurance-limit ~$2M. The player walks
       over the spilled cash to loot it (auto-collect, like a pickup).
     • ARMED ROBBERY = HEAT — cracking it is a loud, reported armed robbery:
       an instant armed-robbery report + a hard star spike, so the whole
       block lights up. There is no quiet way to take it.

   RESEARCH (web, June 2026 — used to scale the haul):
     • Cash-in-transit loads run ~$50k–$500k per vehicle on a typical run;
       single ATM/branch replenishment tills are ~$100k–$300k each.
     • Real armored-truck robberies (Brink's/Loomis, Philadelphia 2025–26)
       netted $700k, $1.5M, and up to $1.8M from a single truck.
     • Trucks are insurance-limited to ~$2M on the road in practice (a
       theoretical max fully-loaded truck is cited near half a billion, but
       that's not a street-robbery figure — we cap the game haul at ~$2M).
   So: HAUL_MIN $260k, HAUL_MAX $1.5M typical; a rarer "FULL ROUTE" truck
   rolls $1.6M–$2.0M and carries a bigger guard detail. Concrete, grounded.

   PERF / SAFETY:
     • AT MOST ONE truck alive at a time, spawned on a long cooldown only
       when the player is on the street and far from one — so it's an event,
       not a fixture. It IS an ordinary traffic car (CBZ.cityMakeCar), so the
       existing traffic AI drives it for free; we add only a handful of
       armored detail boxes + a beacon to its group (draw-call-cheap, all
       merged-adjacent shared material where possible).
     • Guards are reused cop rigs (citySpawnCop) — no new ped system. They
       only exist while a truck is being robbed, then despawn with the heat.
     • CITY-ONLY: every entry point gates on g.mode==="city"; jail and
       disaster-survival never run a line of this. Headless-guarded.
     • Wraps (cityDamageCar, cityExplosion) are additive: they call through
       to the original for every non-armored-truck car, so nothing else
       changes behaviour. Idempotent install guards prevent double-wrap on
       a hot reload.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  // ---- tuning ---------------------------------------------------------------
  const TUNE = {
    spawnEvery: [80, 140],     // seconds between truck appearances (random in range)
    firstDelay: 35,            // grace before the first one can roll
    spawnFarFrom: 70,          // don't pop one right on top of the player
    maxAlive: 1,               // hard cap: one rolling score at a time
    hullHp: 1000,              // armored-health pool (separate from engineHp); explosives chew this
    bulletShrug: 0.06,         // fraction of bullet damage the hull actually takes (~94% shrugged)
    ramShrug: 0.12,            // fraction of ram/crash damage taken
    blastToHull: 220,          // hull damage from one in-radius RPG/grenade/C4 blast (power 1)
    crackArmRange: 9,          // a blast within this of the truck couples into the hull
    guardsBase: 2,             // crew that bails when you start a fight / crack it
    guardsFull: 3,             // extra crew on a "full route" truck
    haulMin: 260000,           // realistic mid-route haul floor ($260k)
    haulMax: 1500000,          // typical robbed-truck ceiling ($1.5M)
    haulFullMin: 1600000,      // a rarer "FULL ROUTE" truck...
    haulFullMax: 2000000,      // ...up to the ~$2M insurance-limit street load
    fullRouteChance: 0.22,     // chance any given truck is a fat full-route run
    lootRange: 3.2,            // walk this close to spilled cash to grab it
    despawnFar: 360,           // cull an untouched truck that drives way off
  };

  // the armored truck is a cash-in-transit truck: a medium-duty cab and an
  // armoured box (buildArmoredTruck below, registered as the "armored" car
  // style), spawned through the SAME model shape every traffic car uses.
  // body stays "van" so its mass/armour profile in vehicles.js is unchanged.
  const TRUCK_MODEL = {
    name: "Armored Cash Truck",
    value: 38000, rarity: 1.0,
    color: 0x3a3f45,           // gunmetal armor grey
    s: 1.22,                   // a touch larger/heavier than a normal van
    body: "van", detailStyle: "armored", designStyle: "armored",
    armoredTruck: true,
  };

  let _s = 99173;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  function ri(lo, hi) { return lo + rng() * (hi - lo); }

  let truck = null;            // the live armored-truck car record (or null)
  let nextSpawnT = TUNE.firstDelay;   // seconds of in-mode time until the next spawn attempt
  let _lastElapsed = 0;

  /* ============================================================
     THE TRUCK ITSELF — a cash-in-transit truck, built like one (2026-10-31,
     Opus 5.5). What was here: the cargo-van body with ~30 loose boxes bolted
     to its flanks after spawn (slab "armour", a slab grille, a stepped box
     "cupola") — a van wearing cardboard. What is here is the real class: a
     medium-duty conventional chassis (International MV / Freightliner M2
     size) carrying an armoured body, registered as a car style so the
     shared pipeline (vehicles.js) merges, LODs, dents and paints it like any
     other car.
       numbers  6.60 m long, 2.40 m wide over the box, 2.97 m to the roof,
                4.05 m wheelbase, 0.96 m tyres (duals at the back)
       cab      short sloped hood with its grille and lamps, arched fenders,
                a thick-framed armoured windscreen and small armoured door
                glass (the dressed cab shows through), a gun port under each
                door window, mirrors, steps, the saddle tank
       box      radiused armoured body: plate seams and rivet lines, two gun
                ports a side and two in the back, the curb-side crew door
                with its hinges and port, double rear doors with hinge
                knuckles, lock box and handles, a bumper step, roof hatch,
                the body A/C unit, the company stripe and name
       lights   headlamps, cab markers, box clearance markers, round tails,
                and the amber beacon in a Group named "armored_beacon" that
                spawnTruck finds and the update loop blinks
     Nose +Z; ground y = 0. */
  const AT = { L: 6.60, W: 2.40, R: 0.48, zF: 2.30, zR: -1.75, cabB: 0.30, cabF: 1.72, hoodF: 3.08, top: 2.97, boxB: -3.24, boxBot: 0.98 };
  let _liveryMat = null;
  function liveryMat() {
    if (_liveryMat) return _liveryMat;
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 192;
    const x = c.getContext("2d");
    x.clearRect(0, 0, 1024, 192);
    // shield emblem
    x.fillStyle = "#d9a520";
    x.beginPath(); x.moveTo(40, 26); x.lineTo(150, 26); x.lineTo(150, 100); x.quadraticCurveTo(150, 150, 95, 172); x.quadraticCurveTo(40, 150, 40, 100); x.closePath(); x.fill();
    x.fillStyle = "#2c3036"; x.font = "bold 92px Arial, Helvetica, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText("S", 95, 96);
    x.fillStyle = "#f0f1f2"; x.textAlign = "left";
    x.font = "bold 104px Arial, Helvetica, sans-serif";
    x.fillText("SECURIS", 182, 82);
    x.fillStyle = "#d9a520"; x.font = "bold 40px Arial, Helvetica, sans-serif";
    x.fillText("ARMORED  TRANSPORT", 186, 156);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    _liveryMat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    _liveryMat._shared = true;
    return _liveryMat;
  }
  function buildArmoredTruck() {
    const K = CBZ.cityCarKit, SH = K.shape;
    const RBX = SH.RBX, CYLX = SH.CYLX, rod = SH.rod, bar = SH.bar, arc = SH.arc, put = SH.put;
    const root = new THREE.Group();
    const paint = K.paintMat("armored", 0x3a3f45, { metalness: 0.32, roughness: 0.5, envMapIntensity: 0.6 });
    const plate = K.roleMat("cit-plate", "plastic", 0x4a5158);
    const dark = K.roleMat("cit-dark", "plastic", 0x17191c);
    const rubber = K.roleMat("cit-rubber", "plastic", 0x111214);
    const gold = K.roleMat("cit-gold", "plastic", 0xd9a520, { emissive: 0x3a2a05, ei: 0.4 });
    const chrome = K.chromeMat(), glass = K.glassMat();
    const head = K.lightFrontMat(), tail = K.lightTailMat();
    const amber = K.sharedMat("semi-marker", 0xffb347, { emissive: 0xffa028, ei: 0.7 });
    const A = AT, hw = A.W / 2, cx = 1.10, zN = A.L / 2;
    const sides = (f) => { f(1); f(-1); };

    /* ---- CHASSIS + FRONT CLIP ---- */
    sides(function (s) { RBX(root, dark, s * 0.38, s * 0.48, 0.52, 0.78, A.boxB + 0.1, zN - 0.2, 0.01); });
    RBX(root, plate, -1.12, 1.12, 0.48, 0.80, zN - 0.24, zN, 0.06);                 // steel bumper
    RBX(root, dark, -1.0, 1.0, 0.42, 0.50, zN - 0.22, zN - 0.04, 0.01);
    put(root, K.boxGeo(0.30, 0.15, 0.012), K.plateMat(), 0, 0.64, zN + 0.004);
    // hood: crowned and sloped, narrower than the cab
    SH.loft(root, paint, [
      { z: A.cabF - 0.02, y: 1.20, hw: 0.95, hh: 0.47, pt: 5, pb: 14 },
      { z: 2.55, y: 1.18, hw: 0.93, hh: 0.42, pt: 5, pb: 14 },
      { z: A.hoodF, y: 1.12, hw: 0.88, hh: 0.34, pt: 4, pb: 14 },
    ], 28);
    // grille: dark core, bars, surround; the lamps either side
    RBX(root, plate, -0.62, 0.62, 0.82, 1.42, A.hoodF - 0.08, A.hoodF + 0.04, 0.04);
    RBX(root, dark, -0.55, 0.55, 0.87, 1.37, A.hoodF - 0.06, A.hoodF + 0.05, 0.01);
    for (let i = 0; i < 6; i++) { const y = 0.92 + i * 0.085; RBX(root, plate, -0.53, 0.53, y - 0.012, y + 0.012, A.hoodF + 0.03, A.hoodF + 0.06, 0.005); }
    sides(function (s) {
      RBX(root, dark, s * 0.64, s * 0.90, 1.04, 1.30, A.hoodF - 0.10, A.hoodF + 0.02, 0.03);
      RBX(root, head, s * 0.67, s * 0.87, 1.08, 1.26, A.hoodF - 0.02, A.hoodF + 0.03, 0.02);
      RBX(root, amber, s * 0.67, s * 0.87, 0.95, 1.01, A.hoodF - 0.04, A.hoodF + 0.02, 0.01);
      // fender over the steer wheel + liner
      arc(root, paint, A.R + 0.08, 0.36, 0.05, -0.05, Math.PI + 0.2, s * 1.0, A.R, A.zF, 22);
      arc(root, dark, A.R + 0.05, 0.30, 0.02, 0.05, Math.PI, s * 0.98, A.R, A.zF, 16);
      // a push guard upright each side of the grille
      RBX(root, plate, s * 0.66, s * 0.74, 0.50, 1.40, zN - 0.08, zN + 0.02, 0.02);
    });
    RBX(root, plate, -0.74, 0.74, 1.34, 1.40, zN - 0.08, zN + 0.02, 0.02);

    /* ---- CAB ---- */
    RBX(root, paint, -cx, cx, 1.0, 1.72, A.cabB, A.cabF, 0.06);                         // lower cab
    RBX(root, paint, -cx + 0.02, cx - 0.02, 2.48, 2.66, A.cabB, 1.42, 0.08);             // roof
    sides(function (s) {
      // the armoured side: thick pillars, a small window, a gun port under it
      RBX(root, paint, s * (cx - 0.10), s * cx, 1.70, 2.52, A.cabB, 0.62, 0.02);
      RBX(root, paint, s * (cx - 0.10), s * cx, 2.30, 2.52, 0.60, 1.46, 0.02);
      RBX(root, paint, s * (cx - 0.10), s * cx, 1.70, 1.84, 0.60, 1.62, 0.02);
      RBX(root, glass, s * (cx - 0.05), s * (cx - 0.02), 1.82, 2.32, 0.62, 1.44, 0.01);
      bar(root, paint, [s * (cx - 0.06), 1.70, A.cabF - 0.04], [s * (cx - 0.06), 2.56, 1.40], 0.14, 0.14);
      CYLX(root, plate, 0.07, 0.03, s * cx, 1.50, 1.05, "x", 16);
      CYLX(root, dark, 0.04, 0.035, s * cx, 1.50, 1.05, "x", 14);
      // door seams, handle, step, grab handle, marker
      RBX(root, dark, s * (cx - 0.002), s * (cx + 0.006), 1.04, 2.30, 0.58, 0.595, 0.002);
      RBX(root, dark, s * (cx - 0.002), s * (cx + 0.006), 1.04, 2.30, 1.60, 1.615, 0.002);
      RBX(root, chrome, s * cx, s * (cx + 0.025), 1.62, 1.66, 0.70, 0.86, 0.01);
      RBX(root, dark, s * 0.88, s * 1.12, 0.62, 0.66, 0.70, 1.20, 0.01);
      rod(root, chrome, [s * (cx + 0.04), 1.20, 1.66], [s * (cx + 0.04), 2.10, 1.66], 0.016);
      RBX(root, amber, s * (cx - 0.02), s * (cx + 0.015), 2.60, 2.65, 1.30, 1.40, 0.01);
      // mirror
      rod(root, dark, [s * cx, 2.10, 1.50], [s * 1.36, 2.10, 1.54], 0.014);
      rod(root, dark, [s * cx, 1.78, 1.50], [s * 1.36, 1.76, 1.54], 0.014);
      RBX(root, dark, s * 1.32, s * 1.42, 1.72, 2.16, 1.48, 1.60, 0.03);
      RBX(root, glass, s * 1.33, s * 1.41, 1.75, 2.13, 1.475, 1.485, 0.004);
    });
    // armoured windscreen in a heavy frame
    (function () {
      const zb = A.cabF - 0.02, yb = 1.74, zt = 1.42, yt = 2.50;
      const fl = Math.hypot(zt - zb, yt - yb), ang = Math.atan2(zb - zt, yt - yb);
      const m = put(root, K.rboxGeo(1.86, fl * 0.92, 0.02, 0.01), glass, 0, (yb + yt) / 2, (zb + zt) / 2 + 0.005);
      m.rotation.x = -ang;
      const f = put(root, K.rboxGeo(2.06, 0.10, 0.08, 0.02), paint, 0, yb + 0.02, zb - 0.01);
      f.rotation.x = -ang;
      bar(root, paint, [0, yb, zb], [0, yt, zt], 0.08, 0.06);
    })();
    RBX(root, dark, -1.0, 1.0, 2.52, 2.56, 1.40, 1.60, 0.01);                            // visor lip
    [-0.4, 0, 0.4].forEach(function (x) { RBX(root, amber, x - 0.05, x + 0.05, 2.62, 2.67, 1.38, 1.44, 0.01); });
    // saddle tank (curb side) and battery box (street side)
    CYLX(root, plate, 0.24, 0.8, -0.80, 0.64, -0.15, "z", 22);
    [-0.38, 0.08].forEach(function (z) { CYLX(root, dark, 0.25, 0.04, -0.80, 0.64, z, "z", 22); });
    RBX(root, dark, 0.56, 1.02, 0.42, 0.86, -0.55, 0.20, 0.03);
    // exhaust up the back of the cab
    CYLX(root, chrome, 0.06, 1.8, 0.92, 1.85, 0.20, "y", 14);
    rod(root, chrome, [0.92, 0.96, 0.20], [0.55, 0.72, 0.20], 0.055);

    K.dressCabin(root, {
      cabW: (cx - 0.1) * 2, zR: A.cabB + 0.12, zF: A.cabF - 0.12,
      zTR: A.cabB + 0.12, zTF: 1.36, roofW: (cx - 0.12) * 2,
      beltY: 1.80, roofY: 2.44, floorY: 1.26, rows: 1, seatLayout: "cab2",
      doorSpans: [[0.60, 1.60]],
    });

    /* ---- THE ARMOURED BOX ---- */
    const bF = A.cabB - 0.04, bB = A.boxB, bm = (bF + bB) / 2;
    RBX(root, paint, -hw, hw, A.boxBot, A.top, bB, bF, 0.09);
    RBX(root, dark, -hw + 0.1, hw - 0.1, 0.80, A.boxBot + 0.02, bB + 0.1, bF - 0.1, 0.01);  // sub-frame
    sides(function (s) {
      // well liner + steel arch trim over the rear duals
      arc(root, dark, A.R + 0.06, 0.62, 0.02, 0.0, Math.PI, s * 0.92, A.R, A.zR, 18);
      // plate seams + rivet lines
      [-2.35, -1.10, 0.0 - 0.15].forEach(function (z) { RBX(root, dark, s * hw, s * (hw + 0.006), A.boxBot + 0.06, A.top - 0.06, z - 0.006, z + 0.006, 0.002); });
      [A.boxBot + 0.14, A.top - 0.14].forEach(function (y) {
        for (let z = bB + 0.15; z < bF - 0.1; z += 0.22) CYLX(root, plate, 0.012, 0.012, s * (hw + 0.004), y, z, "x", 6);
      });
      // the company stripe and name
      RBX(root, gold, s * hw, s * (hw + 0.008), 1.36, 1.50, bB + 0.06, bF - 0.06, 0.003);
      const nm = put(root, new THREE.PlaneGeometry(2.6, 0.49), liveryMat(), s * (hw + 0.012), 2.02, bm + 0.2, 0, s * Math.PI / 2, 0);
      nm.geometry._shared = true;
      // gun ports: a steel boss with a dark port
      [-2.75, -0.55].forEach(function (z) {
        CYLX(root, plate, 0.075, 0.03, s * (hw + 0.012), 1.70, z, "x", 18);
        CYLX(root, dark, 0.045, 0.035, s * (hw + 0.015), 1.70, z, "x", 14);
      });
      // box clearance markers
      [bB + 0.1, bF - 0.1].forEach(function (z) { RBX(root, amber, s * (hw - 0.02), s * (hw + 0.012), A.top - 0.14, A.top - 0.08, z - 0.05, z + 0.05, 0.01); });
      // rear duals mud flap
      RBX(root, rubber, s * 0.62, s * 1.18, 0.12, 0.62, A.zR - 0.60, A.zR - 0.57, 0.01);
    });
    // the curb-side crew door: frame, hinges, small window, port, handle
    (function () {
      const x = -hw - 0.006, z0 = -0.85, z1 = -0.05;
      RBX(root, dark, x - 0.004, x + 0.004, A.boxBot + 0.06, 2.62, z0 - 0.01, z0 + 0.01, 0.002);
      RBX(root, dark, x - 0.004, x + 0.004, A.boxBot + 0.06, 2.62, z1 - 0.01, z1 + 0.01, 0.002);
      RBX(root, dark, x - 0.004, x + 0.004, 2.61, 2.63, z0, z1, 0.002);
      [1.25, 2.30].forEach(function (y) { CYLX(root, plate, 0.03, 0.14, x - 0.02, y, z1 + 0.02, "y", 10); });
      RBX(root, plate, x - 0.02, x + 0.01, 2.06, 2.40, z0 + 0.22, z1 - 0.22, 0.02);
      RBX(root, glass, x - 0.025, x - 0.018, 2.10, 2.36, z0 + 0.26, z1 - 0.26, 0.01);
      RBX(root, chrome, x - 0.03, x, 1.60, 1.66, z0 + 0.08, z0 + 0.24, 0.01);
      RBX(root, plate, -hw - 0.14, -hw + 0.02, 0.70, 0.75, z0, z1, 0.01);               // step
    })();
    // the rear: double doors, hinge knuckles, lock box, ports, handles, tails
    const rz = bB - 0.006;
    RBX(root, dark, -0.012, 0.012, A.boxBot + 0.06, A.top - 0.10, rz - 0.004, rz + 0.004, 0.002);
    sides(function (s) {
      [1.30, 2.05, 2.70].forEach(function (y) { CYLX(root, plate, 0.035, 0.16, s * (hw - 0.06), y, rz - 0.02, "y", 10); });
      CYLX(root, plate, 0.07, 0.03, s * 0.55, 2.0, rz - 0.01, "z", 18);
      CYLX(root, dark, 0.04, 0.035, s * 0.55, 2.0, rz - 0.015, "z", 14);
      RBX(root, chrome, s * 0.08, s * 0.30, 1.58, 1.64, rz - 0.04, rz, 0.01);
      CYLX(root, tail, 0.07, 0.03, s * (hw - 0.22), 1.20, rz - 0.015, "z", 16);
      CYLX(root, amber, 0.055, 0.03, s * (hw - 0.22), 1.04, rz - 0.015, "z", 14);
      CYLX(root, head, 0.04, 0.03, s * (hw - 0.40), 1.12, rz - 0.015, "z", 12);
      RBX(root, amber, s * (hw - 0.14), s * (hw - 0.04), A.top - 0.12, A.top - 0.06, rz - 0.02, rz, 0.01);
    });
    RBX(root, plate, -0.20, 0.20, 1.44, 1.76, rz - 0.06, rz, 0.02);                      // lock box
    RBX(root, gold, -hw + 0.02, hw - 0.02, 2.62, 2.72, rz - 0.01, rz, 0.003);
    RBX(root, plate, -hw + 0.06, hw - 0.06, 0.50, 0.70, bB - 0.22, bB + 0.05, 0.02);     // bumper step
    for (let i = 0; i < 6; i++) RBX(root, dark, -0.9 + i * 0.36, -0.9 + i * 0.36 + 0.2, 0.70, 0.705, bB - 0.2, bB - 0.02, 0.002);
    // roof: escape hatch, body A/C, the beacon
    RBX(root, plate, -0.40, 0.40, A.top - 0.01, A.top + 0.06, -2.2, -1.5, 0.03);
    RBX(root, dark, -0.30, 0.30, A.top + 0.06, A.top + 0.08, -2.1, -1.6, 0.01);
    RBX(root, plate, -0.55, 0.55, A.top - 0.01, A.top + 0.22, -0.40, 0.18, 0.05);
    for (let i = 0; i < 5; i++) RBX(root, dark, -0.45, 0.45, A.top + 0.222, A.top + 0.226, -0.34 + i * 0.11, -0.30 + i * 0.11, 0.002);
    const bg = new THREE.Group();
    bg.name = "armored_beacon";
    CYLX(bg, dark, 0.13, 0.05, 0, A.top + 0.245, -0.95, "y", 16);
    CYLX(bg, K.sharedMat("cit-beacon", 0xffb030, { basic: true }), 0.10, 0.15, 0, A.top + 0.345, -0.95, "y", 16, 0.11);
    root.add(bg);

    /* ---- WHEELS ---- */
    const rim = "steel";
    sides(function (s) {
      const fw = K.makeWheel(A.R, 0.28, rim, 0.55);
      fw.rotation.z = -s * Math.PI / 2; fw.position.set(s * 1.0, A.R, A.zF); root.add(fw);
      [0.98, 0.68].forEach(function (x) {
        const rw = K.makeWheel(A.R, 0.27, rim, 0.55);
        rw.rotation.z = -s * Math.PI / 2; rw.position.set(s * x, A.R, A.zR); root.add(rw);
      });
    });
    root.userData.loftBody = true;
    root.userData.vehicleDims = { width: A.W, length: A.L, height: A.top + 0.1, wheelbase: A.zF - A.zR };
    return root;
  }
  CBZ.carStyleBuilders = CBZ.carStyleBuilders || {};
  CBZ.carStyleBuilders.armored = buildArmoredTruck;

  // ---- after spawn: hand the update loop the beacon the body was built with --
  // FIXED CONSTANTS ONLY in here: this runs between spawns, so a draw on the
  // module rng() would shift every later spawn roll.
  function dressTruck(grp) {
    let beacon = null;
    grp.traverse(function (o) { if (!beacon && o.name === "armored_beacon") beacon = o; });
    const dress = { userData: { beacon: beacon } };
    grp.userData._armoredDress = dress;
    return dress;
  }
  // ---- spawn ----------------------------------------------------------------
  function spawnTruck() {
    if (truck || g.mode !== "city" || !CBZ.city || !CBZ.city.arena) return;
    if (!CBZ.cityMakeCar) return;
    const A = CBZ.city.arena, P = CBZ.player;
    if (!A.roads || !A.roads.length || !P) return;

    // pick a road segment whose chosen seat is far enough from the player
    let r = null, x = 0, z = 0, along = 0, dirSign = 1, lane = 0, laneIdx = 0, heading = 0, tries = 0;
    do {
      r = A.roads[(rng() * A.roads.length) | 0];
      along = (rng() - 0.5) * r.len * 0.8;
      dirSign = rng() < 0.5 ? 1 : -1;
      // ride the outer (curb) lane — ROAD-AWARE via CBZ.roadLanes so a highway
      // truck sits in the REAL outermost lane (past the median), not the global-2
      // guess (config.js loads first, so the helper is always there).
      laneIdx = CBZ.roadLanesPerDir(r) - 1;
      lane = CBZ.roadLaneCenter(r, dirSign, laneIdx);
      x = r.vertical ? r.x + lane : r.x + along;
      z = r.vertical ? r.z + along : r.z + lane;
      heading = r.vertical ? (dirSign > 0 ? 0 : Math.PI) : (dirSign > 0 ? Math.PI / 2 : -Math.PI / 2);
      tries++;
    } while (tries < 10 && Math.hypot(x - P.pos.x, z - P.pos.z) < TUNE.spawnFarFrom);

    const c = CBZ.cityMakeCar(x, z, heading, r.vertical, TRUCK_MODEL, 0.18);
    if (!c) return;
    // slot it into traffic exactly like spawnCityTraffic does so the AI drives it
    c.road = r; c.lane = lane; c.laneIdx = laneIdx; c.dirSign = dirSign;
    const cruise = (CBZ.CITY && CBZ.CITY.traf && CBZ.CITY.traf.cruise) || [7, 12];
    c.baseV = (cruise[0] + rng() * (cruise[1] - cruise[0])) * 0.85;   // a heavy truck cruises a touch slower
    c.v = c.baseV * 0.6;
    // armored-truck identity + a big armored-health pool that explosives chew
    c.armoredTruck = true;
    c.armoredHull = TUNE.hullHp;
    c.armoredCracked = false;
    c.armoredGuardsOut = false;
    c.armoredGuards = [];
    c.armoredAggroed = false;
    c.armor = 0.32;                          // its engineHp also resists (van-class), but the wrap is what makes it tank
    c.fullRoute = rng() < TUNE.fullRouteChance;
    c.armoredHaul = c.fullRoute
      ? Math.round(ri(TUNE.haulFullMin, TUNE.haulFullMax) / 1000) * 1000
      : Math.round(ri(TUNE.haulMin, TUNE.haulMax) / 1000) * 1000;
    // A TAKE IS A TRANSFER (city/shops.js's CBZ.cityTill). Two things change,
    // and the second is the one that matters:
    //  (1) A TRUCK CARRIES WHAT THE NEIGHBOURHOOD BANKS. The researched
    //      $260k-$2M band above is a real-world load and stays the SCALE, but
    //      a truck working the projects and a truck working the island were
    //      the same roll. The load now rides the ratio of this district's
    //      actual cash flow to the citywide mean — the same districtCash() a
    //      bank vault is derived from, so the two can never disagree.
    //  (2) IT IS A REAL BALANCE. Declared as a cash point, so the spilled
    //      piles are TAKES out of it, an already-looted truck holds what is
    //      left, and CBZ.cityHolds/cityTake can answer for it like anything
    //      else in the world.
    const TL = CBZ.cityTill;
    if (TL && TL.districtCash && TL.districtOf) {
      try {
        const dk = TL.districtOf({ cx: x, cz: z });
        const here = TL.districtCash(dk).cash;
        let tot = 0, n = 0;
        const E = CBZ.cityEcon;
        const keys = (E && E.DISTRICTS) ? Object.keys(E.DISTRICTS) : [dk];
        for (let i = 0; i < keys.length; i++) { const v = TL.districtCash(keys[i]).cash; if (v > 0) { tot += v; n++; } }
        const mean = n > 0 ? tot / n : 0;
        // clamped to a half..double band: a route crosses several districts,
        // so where it happens to be is a lean, not the whole story.
        if (mean > 0 && here > 0) c.armoredHaul = Math.round(c.armoredHaul * Math.max(0.5, Math.min(2, here / mean)) / 1000) * 1000;
      } catch (e) { /* no ledger yet — the researched roll stands */ }
    }
    if (TL && TL.declare) {
      TL.declare(c, { name: "Agent Brinks truck", kind: "armored", point: "vault", amount: c.armoredHaul });
    }
    if (c.fullRoute) c.armoredHull = Math.round(TUNE.hullHp * 1.25);   // fat trucks are even tougher

    try { dressTruck(c.group); } catch (e) { /* dressing is cosmetic — a failure must not lose the truck */ }

    truck = c;
  }

  // ---- guards: a crew bails out and fights when the truck is attacked/cracked --
  function deployGuards(reason) {
    if (!truck || truck.armoredGuardsOut || !CBZ.citySpawnCop) return;
    truck.armoredGuardsOut = true;
    const n = truck.fullRoute ? TUNE.guardsFull : TUNE.guardsBase;
    const a = truck.heading, sx = Math.sin(a), sz = Math.cos(a);
    for (let i = 0; i < n; i++) {
      // drop them around the truck (one at each rear door, the rest flanking)
      const off = i === 0 ? -2.6 : (i === 1 ? 2.4 : 0);
      const side = i >= 2 ? (i % 2 ? 1.8 : -1.8) : ((i % 2) ? 1.2 : -1.2);
      const gx = truck.pos.x + sx * off - sz * side;
      const gz = truck.pos.z + sz * off + sx * side;
      const guard = CBZ.citySpawnCop(gx, gz, false);   // armored-crew guard = a beat-cop rig
      if (guard) {
        guard.name = "Guard";
        guard.armoredGuard = true;
        guard.hp = Math.max(guard.hp || 0, 130);       // a touch hardier than a beat cop
        truck.armoredGuards.push(guard);
      }
    }
    // armed crew engaging IS a reported armed robbery in progress — light it up
    spikeHeat(reason);
    if (CBZ.city && CBZ.city.note) CBZ.city.note("Armored crew bailing out, they're shooting back!", 2.2);
  }

  // ---- the heat spike: armed robbery of an armored truck ----------------------
  function spikeHeat(reason) {
    if (g.mode !== "city" || !truck) return;
    const x = truck.pos.x, z = truck.pos.z;
    if (CBZ.cityCrime) CBZ.cityCrime(140, { instant: true, x: x, z: z, type: "armed-robbery" });
    // a hardened-target robbery is a major incident: shove the heat up hard
    // (forceStars caps at 4★ by design — a 5★ still requires an actual spree).
    if (CBZ.cityForceStars) CBZ.cityForceStars(truck.armoredCracked ? 4 : 3);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // ---- CRACK: enough explosive damage blew the doors → spill the cash ---------
  function crackTruck() {
    if (!truck || truck.armoredCracked || g.mode !== "city") return;
    truck.armoredCracked = true;
    const x = truck.pos.x, z = truck.pos.z;
    // the truck is now a dead, smoking shell on the road — kill its engine through
    // the normal car chain so it stops + smokes + can burn out like any wreck.
    if (CBZ.cityDamageCar) CBZ.cityDamageCar(truck, 999, { byPlayer: true });
    deployGuards("crack");                       // any guards not already out pile out now (also spikes heat)
    spikeHeat("crack");                          // ensure a 4★ armed-robbery spike even if guards were already out
    // the doors are open, so the load LEAVES the truck's balance and lands on
    // the street as piles you can walk to. A truck that has already been
    // partly emptied spills only what is still aboard — the take can never
    // exceed the load, by construction rather than by a clamp.
    const TL = CBZ.cityTill;
    const spill = (TL && TL.take) ? TL.take(truck, { by: "player" }).taken : truck.armoredHaul;
    truck.armoredHaul = spill;
    spillCash(x, z, spill);
    if (CBZ.sfx) CBZ.sfx("explosion");
    if (CBZ.city && CBZ.city.note) CBZ.city.note("Armored truck cracked open downtown. $" + fmt(truck.armoredHaul) + " loose on the street.", 3, { from: "Scanner", app: "news" });
    if (CBZ.city && CBZ.city.note) CBZ.city.note("Doors are open. Grab it and go, sirens already rolling.", 3, { from: "UNKNOWN NUMBER" });
  }

  function fmt(n) { return (n | 0).toLocaleString ? (n | 0).toLocaleString("en-US") : ("" + (n | 0)); }

  // ---- spilled cash: a few duffel/banknote piles the player walks over to grab -
  let CASH_GEO = null, DUFFEL_GEO = null, CASH_MAT = null, DUFFEL_MAT = null;
  const loot = [];   // { mesh, x, z, amount }
  function lootAssets() {
    if (CASH_GEO) return;
    CASH_GEO = new THREE.BoxGeometry(0.4, 0.16, 0.26);
    DUFFEL_GEO = new THREE.BoxGeometry(0.7, 0.32, 0.42);
    CASH_MAT = new THREE.MeshLambertMaterial({ color: 0x6fae5a });   // banded notes
    DUFFEL_MAT = new THREE.MeshLambertMaterial({ color: 0x2b2f36 }); // crew duffel
    CASH_GEO._shared = DUFFEL_GEO._shared = CASH_MAT._shared = DUFFEL_MAT._shared = true;
  }
  /* CASH_BAGS_V1 — THE LOAD IS PHYSICAL NOW, AND IT WAS ALREADY HALF-WAY THERE.
     This file has always spilled real duffel meshes on the tarmac; the lie was
     `grabLoot`, which walked over them and converted them to wallet cash on
     CONTACT. That is the same abstraction wearing a mesh, and the owner's ask
     ("bags that the player can pick up and throw… and put into the back of a
     truck") is precisely the thing the contact-grab prevented.
     So the spill now goes through city/inventory.js's ONE physicalisation call
     and the piles become carryable duffels. ARMORED_INSTANT_CASH is the
     one-line way back to the shipped walk-over-it-and-it's-yours behaviour.  */
  if (CBZ.CONFIG.ARMORED_INSTANT_CASH == null) CBZ.CONFIG.ARMORED_INSTANT_CASH = false;
  function bagsLive() {
    return CBZ.CONFIG.ARMORED_INSTANT_CASH !== true && !!(CBZ.cashBags && CBZ.cashBags.payout);
  }
  function bagsOnGround() {
    if (!CBZ.cashBags || !CBZ.cashBags.list) return false;
    const L = CBZ.cashBags.list();
    for (let i = 0; i < L.length; i++) if (L[i].src === "armored") return true;
    return false;
  }
  function bagsValue() {
    if (!CBZ.cashBags || !CBZ.cashBags.list) return 0;
    const L = CBZ.cashBags.list();
    let s = 0;
    for (let i = 0; i < L.length; i++) if (L[i].src === "armored") s += L[i].amount;
    return s;
  }
  function spillCash(x, z, total) {
    if (bagsLive()) {
      const fy = (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) || 0;
      CBZ.cashBags.payout(x, fy, z, total, {
        src: "armored", srcName: "Agent Brinks", spread: 2.6, cap: 6,
        canvas: 0x2b2f36, flash: 0xd9a520,
      });
      return;
    }
    lootAssets();
    const piles = 3 + (rng() * 2 | 0);          // 3–4 grabbable piles
    const per = Math.round(total / piles);
    let left = total;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    for (let i = 0; i < piles; i++) {
      const a = rng() * 6.2832, d = 0.8 + rng() * 2.4;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const fy = (CBZ.floorAt ? CBZ.floorAt(px, pz) : 0) || 0;
      const grp = new THREE.Group();
      // an open crew duffel with banded stacks spilled beside it (the real
      // assets from city/itemassets.js); the boxes are only the degrade
      const realBag = CBZ.itemAssetBaked ? CBZ.itemAssetBaked(null, null, null, { kind: "moneybag", canvas: 0x2b2f36, flash: 0xd9a520 }) : null;
      const realCash = CBZ.itemAssetBaked ? CBZ.itemAssetBaked(null, null, null, { kind: "cashpile", amount: 6000 }) : null;
      if (realBag && realCash) {
        grp.add(realBag);
        realCash.position.set(0.34, 0, 0.1); realCash.rotation.y = rng() * 6.28; grp.add(realCash);
      } else {
        const bag = new THREE.Mesh(DUFFEL_GEO, DUFFEL_MAT);
        bag.position.y = 0.18; grp.add(bag);
        for (let k = 0; k < 3; k++) {
          const note = new THREE.Mesh(CASH_GEO, CASH_MAT);
          note.position.set((rng() - 0.5) * 0.5, 0.1 + k * 0.05, (rng() - 0.5) * 0.5);
          note.rotation.y = rng() * 6.28; grp.add(note);
        }
      }
      grp.position.set(px, fy + (realBag ? 0 : 0.04), pz);
      grp.rotation.y = rng() * 6.28;
      if (root) root.add(grp);
      const amt = (i === piles - 1) ? left : per;
      left -= amt;
      loot.push({ mesh: grp, x: px, z: pz, amount: amt });
    }
  }
  function clearLoot() {
    for (const l of loot) {
      if (l.mesh && l.mesh.parent) l.mesh.parent.remove(l.mesh);
      if (l.mesh) l.mesh.traverse(function (o) {
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
        if (o.material && !o.material._shared && o.material.dispose) o.material.dispose();
      });
    }
    loot.length = 0;
  }
  function grabLoot() {
    if (!loot.length) return;
    const P = CBZ.player; if (!P || P.dead) return;
    const V = CBZ.verbs;
    if (V && V.pickupOf && V.pickupOf(P)) return;     // one duffel at a time, hand by hand
    for (let i = loot.length - 1; i >= 0; i--) {
      const l = loot[i];
      if (l._taking || Math.hypot(l.x - P.pos.x, l.z - P.pos.z) > TUNE.lootRange) continue;
      // TAKEN WITH A HAND (systems/verbs_pickup.js): the money is yours on the
      // grab frame, the duffel leaves the road in the hand
      l._taking = true;
      const took = function () {
        if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(l.amount);
        if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(4);
        if (CBZ.sfx) CBZ.sfx("coin");
        if (CBZ.city && CBZ.city.note) CBZ.city.note("Grabbed $" + fmt(l.amount) + " from the truck haul.", 1.8);
        if (l.mesh && l.mesh.parent) l.mesh.parent.remove(l.mesh);
        const j = loot.indexOf(l);
        if (j >= 0) loot.splice(j, 1);
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      };
      if (V && V.pickup) V.pickup(P, l.mesh || { x: l.x, y: l.y || 0, z: l.z, kind: "bag" }, { pose: "grip", onTaken: took });
      else took();
      break;
    }
  }

  // ---- teardown of a spent truck (cracked + looted, or driven off, or mode change) --
  function dropTruck() {
    if (truck) {
      // the wreck itself rejoins the normal car lifecycle (it was cityDamageCar'd
      // dead on crack); we just release our handle and dressing reference.
      truck.armoredTruck = false;   // stop the damage wrap from treating it special once spent
      truck = null;
    }
  }
  function fullReset() {
    dropTruck();
    clearLoot();
    nextSpawnT = TUNE.firstDelay;
  }

  // ============================================================
  // WRAP 1 — cityDamageCar: the armor. Bullets/rams barely scratch the truck;
  // explosives are handled separately (WRAP 2). Everything that ISN'T the live
  // armored truck passes straight through to the original, unchanged.
  // ============================================================
  function installDamageWrap() {
    const orig = CBZ.cityDamageCar;
    if (typeof orig !== "function" || orig._armoredWrapped) return;
    CBZ.cityDamageCar = function (car, amount, opts) {
      // The live, un-cracked armored truck tanks small-arms + rams. EXPLOSIVE
      // energy never arrives here as car-damage — it couples through WRAP 2
      // (cityExplosion → hitHull), so cracking only ever happens via a blast.
      if (car && car === truck && car.armoredTruck && !car.armoredCracked) {
        // a bullet or a ram on the hull: the crew notices and bails out.
        if (opts && opts.byPlayer && !car.armoredAggroed) {
          car.armoredAggroed = true;
          deployGuards("attack");
        }
        const ram = !opts || (!opts.point && !opts.crumple);   // crash path passes no point
        const scaled = amount * (ram ? TUNE.ramShrug : TUNE.bulletShrug);
        // still let the tire shot / impact decal play (cosmetic) on a tiny scale
        return orig.call(this, car, scaled, opts);
      }
      return orig.call(this, car, amount, opts);
    };
    CBZ.cityDamageCar._armoredWrapped = true;
    CBZ.cityDamageCar._origArmored = orig;
  }

  // feed explosive energy into the hull pool; crack when it runs out
  function hitHull(car, dmg, byPlayer) {
    if (!car || car.armoredCracked) return;
    if (byPlayer) car._burnByPlayer = true;
    car.armoredHull -= dmg;
    if (!car.armoredAggroed) { car.armoredAggroed = true; deployGuards("attack"); }
    if (car.armoredHull <= 0) crackTruck();
    else {
      // a non-lethal blast still rocks it + alerts the crew — tell the player it held
      if (CBZ.city && CBZ.city.note && byPlayer) {
        const pct = Math.max(0, Math.round(car.armoredHull / (car.fullRoute ? TUNE.hullHp * 1.25 : TUNE.hullHp) * 100));
        CBZ.city.note("Hull holding (" + pct + "%), hit it with more explosives.", 1.6);
      }
    }
  }

  // ============================================================
  // WRAP 2 — cityExplosion: every RPG/grenade/C4/airstrike routes through here.
  // After the real blast runs, if the live armored truck is in radius, couple the
  // blast into its hull pool. This is THE crack path. Additive: we call the
  // original first and only ADD the hull coupling.
  // ============================================================
  function installExplosionWrap() {
    const orig = CBZ.cityExplosion;
    if (typeof orig !== "function" || orig._armoredWrapped) return;
    const wrapped = function (x, z, opts) {
      const r = orig.call(this, x, z, opts);
      try {
        const blastDamages = !opts || !opts.noDamage;   // a no-damage FX puff (heli ember) must not crack it
        if (g.mode === "city" && truck && truck.armoredTruck && !truck.armoredCracked && blastDamages) {
          const power = (opts && opts.power) || 1;
          const dx = truck.pos.x - x, dz = truck.pos.z - z;
          const d = Math.hypot(dx, dz);
          const arm = TUNE.crackArmRange * Math.max(1, power * 0.85);
          if (d <= arm) {
            const falloff = 1 - d / (arm + 0.01);
            const dmg = TUNE.blastToHull * power * Math.max(0.25, falloff);
            hitHull(truck, dmg, !!(opts && opts.byPlayer));
          }
        }
      } catch (e) { /* a coupling failure must never break the shared blast chain */ }
      return r;
    };
    wrapped._armoredWrapped = true;
    // THE EXPLOSION-WRAPPER LAW (CLAUDE.md): copy EVERY `*Wrapped` marker
    // forward, not just one. This used to hand-copy only `_structWrapped`,
    // which silently stripped `_demoWrapped`, `_wildlifeWrapped` and the
    // impact bus's markers. Because this file installs LAST (order 54.3),
    // every sibling then failed its own idempotence guard, re-wrapped an
    // already-wrapped chain, and double-counted its damage for the rest of
    // the session. Three separate domains independently reported it.
    for (const k in orig) if (/Wrapped$/.test(k)) wrapped[k] = orig[k];
    wrapped._origArmored = orig;
    CBZ.cityExplosion = wrapped;
  }

  // (re)install both wraps — lazy, since vehicles.js/crashfx.js may load after us
  function ensureWraps() {
    installDamageWrap();
    installExplosionWrap();
  }

  // ---- per-frame manager ----------------------------------------------------
  CBZ.onUpdate(54.3, function (dt) {
    // fresh-run / hot-reload rewind detection (same trick explosives.js uses)
    const el = g.elapsed || 0;
    if (el + 0.001 < _lastElapsed) fullReset();
    _lastElapsed = el;

    ensureWraps();   // cheap idempotent re-check; survives load-order + hot reloads

    if (g.mode !== "city") {
      if (truck || loot.length) fullReset();
      return;
    }
    if (g.state !== "playing") return;

    // ---- spawn cadence: only when there's no truck and the timer's up --------
    if (!truck) {
      // don't roll a new truck while a haul's still on the ground — and with
      // CASH_BAGS_V1 the haul IS bags, so the same rule has to see them or a
      // second truck rolls while the first one's money is still in the road.
      if (loot.length === 0 && !bagsOnGround()) {
        nextSpawnT -= dt;
        if (nextSpawnT <= 0) {
          spawnTruck();
          nextSpawnT = ri(TUNE.spawnEvery[0], TUNE.spawnEvery[1]);
        }
      }
    } else {
      // ---- manage the live truck ----
      const t = truck;
      // it died/exploded through the car system (rammed off a cliff, burned out
      // before crack, reaped) → if it wasn't cracked, no haul; release the handle.
      if (t.dead || t._reap || CBZ.cityCars.indexOf(t) < 0) {
        if (!t.armoredCracked) dropTruck();
        else dropTruck();   // cracked wreck handled by car system; we just let go
      } else {
        // blink the beacon
        const dress = t.group && t.group.userData && t.group.userData._armoredDress;
        if (dress && dress.userData.beacon) {
          dress.userData.beacon.visible = (((g.elapsed || 0) * 2.2) % 1) < 0.55;
        }
        // Guards only spawn on attack/crack (deployGuards), so a normally-driving
        // truck strands no escort. Once they're out they're real cops and the
        // police AI fully owns them — we keep only a reference list for cleanup.
        // an untouched truck that has driven far away from the player is culled so
        // a missed score doesn't leave a stale handle forever.
        const P = CBZ.player;
        if (P && !t.armoredAggroed && !t.armoredCracked &&
            Math.hypot(t.pos.x - P.pos.x, t.pos.z - P.pos.z) > TUNE.despawnFar) {
          // remove it cleanly from the car system
          if (t.group && t.group.parent) t.group.parent.remove(t.group);
          const idx = CBZ.cityCars.indexOf(t); if (idx >= 0) CBZ.cityCars.splice(idx, 1);
          dropTruck();
        }
      }
    }

    // ---- loot pickup (auto-collect on proximity) -----------------------------
    if (loot.length) grabLoot();

    // ---- guard housekeeping: once the heat's fully gone, retire any guards we
    // spawned so they don't linger as orphan cops (police.js clears its own on
    // wanted-reset/teleport; this just prunes our reference list). --------------
    if ((g.heat || 0) <= 0 && !truck && loot.length === 0) {
      // nothing to do — guards were real cops; police.js maintain() retires them.
    }
  });

  // headless / debug / tool handles
  CBZ.cityArmored = {
    truck: function () { return truck; },
    spawn: spawnTruck,
    crack: crackTruck,
    haulOnGround: function () { let s = bagsValue(); for (const l of loot) s += l.amount; return s; },
    bagged: bagsLive,
    active: function () { return !!truck; },
    _tune: TUNE,
  };
})();
