/* ============================================================
   units/vehicles/technical.js — THE TECHNICAL: a Toyota Hilux single cab
   4x4 (7th generation, the 2005-2015 "Vigo" body) with a DShKM 12.7 mm
   heavy machine gun on a pedestal welded into the bed, a gunner standing
   behind it, an assistant feeding belts, and whoever else fits.

   REDRAWN FROM SCRATCH (2026-10-11). What was here: a stand-in of five
   boxes (a cab, a bed, a windscreen band) and a black bar on a post.
   What is here, from the truck's and the gun's own numbers:

   THE TRUCK  5.26 m long, 1.84 m over the flares, 1.80 m to the roof;
              3.085 m wheelbase, 1.55 m track, 255/70R15 tyres (0.74 m) on
              six-stud steel wheels. The long hood with the intercooler
              scoop of the 3.0 D-4D, the swept headlamps, the three-bar
              grille, the bumper and fog lamps; the single cab (raked
              windscreen, door glass, the blind rear quarter, the small rear
              window, mirrors, drip rails, door seams, handles, the side
              step); the steel tub with its wheel arches and flares, the
              ribbed floor, the wheel tubs, the tailgate and the tall tail
              lamps; underneath, the ladder frame, double-wishbone front with
              its coil-overs and diff, the leaf-sprung live rear axle, the
              fuel tank, the exhaust out the right rear and the spare slung
              under the bed. Inside: dash, seats and a steering wheel that
              turns with the front wheels.
   THE MILITIA  Factory white, beige or silver, hand-brushed over in the
              side's army colours (the nation's scheme, units/kit/hull.js) with
              dry-brush streaks, chips to the factory paint, rust and dust;
              the nation's flag painted on both doors and the tailgate.
              Improvised armour that is really seen on these trucks: a slotted
              steel plate over the radiator behind a welded pipe bull bar, a
              pipe roll cage behind the cab, rusted mill-steel plates bolted
              to the bed sides, a steel gun shield with a U-notch and angled
              wings. Sandbags against the cab, DShK ammunition boxes, a
              jerrycan, a CB whip on the fender.
   THE GUN    DShKM: 1.62 m, receiver with feed cover, spade grips and
              butterfly trigger, the finned 1.07 m barrel, gas cylinder,
              carrying handle, the flat-sided muzzle brake, the AA ring sight,
              the 50-round belt box on the left and the belt into the feed.
              12.7x108 mm B-32 API, 840 m/s, ~600 rds/min cyclic fired in
              5-8 round bursts, 1,500 m effective against ground targets
              (the DShK is an AA gun too: it elevates to 66 degrees). Every 50
              rounds the box is changed (~9 s: the muzzle goes up, the feed
              cover opens, a new box goes on); with no assistant feeding, the
              gunner does it all and the gun works 1.6x slower.
   CREW       driver and commander in the cab, the gunner standing in the
              bed on the pedestal (he turns with the gun; stands tall to look
              round, leans into the grips to shoot), the assistant gunner
              kneeling at the front of the bed, two riflemen sitting on the
              bed rails with their legs over the side. Militia dress (shirts,
              chest rigs, shemaghs, no helmets). Each is drawn only while his
              seat is filled.
   DRIVE      CBZ.vehicleDrive.wheeled: 6.2 m turning radius, ~0.72 g of
              grip, 0-100 km/h in ~11 s loaded, 108 km/h off-road. Independent
              suspension per wheel over the real ground (the hull kit's
              WheeledRig), soft springs: it pitches and rolls like a loaded
              pickup. Dust off the tyres, diesel haze out of the tail pipe.
   ARMOUR     none. Sheet steel: every rifle round goes through it, and the
              engine block is all that stands in front. Fragile: 220 hp of
              structure. Damage: smoke from the engine, a flat on a shot-out
              tyre, a jammed gun, the windscreen cracked through after a few
              hits; a burning hull burns down to rusted bare steel with its
              glass gone and its tyres burnt off; a brew-up throws the gun and
              its pedestal over.

   TACTICS    a fire-support truck, not a fighting vehicle: it works from
              650 m (its DShK outranges the rifles and the RPGs that would
              kill it), puts its riflemen out at 760 m before it parks, never
              wastes 12.7 on real armour, and keeps clear of launchers.

   SHARED BITS. This file registers the DShK's cartridge and gun row on
   CBZ.ballistics (CART["127x108"], GUN.dshk) when they are not there: the
   flown round is the real one. The hull kit fix that came with this file
   (units/kit/hull.js: the wreck's fire emitter renamed `burn`, it was
   shadowing the contract's rig.fire(shot)) gives every WheeledRig its
   muzzle flash and recoil back.

   Units: metres, m/s, kg, armour in mm RHA equivalent per face. Nose +Z,
   +X is the vehicle's left (the driver's side: left-hand drive).
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ;
  if (!CBZ || !CBZ.unitKit) return;
  const PI = Math.PI;

  /* ---- THE ROUND (additive: weapons/ballistics.js keeps its own table) --- */
  (function registerRound() {
    const B = CBZ.ballistics;
    if (!B || !B.CART || !B.GUN) return;
    if (!B.CART["127x108"]) {
      B.CART["127x108"] = { name: "12.7x108mm B-32 API", g: 48.3, mm: 12.98, v0: 840, dragK: 0.42,
        pen: { flesh: 1.60, wood: 2.40, sand: 0.95, dirt: 0.85, cinder: 1.15, brick: 0.68, concrete: 0.34, steel: 0.042, rha: 0.021 },
        tracer: 0xff6a2a };
    }
    if (!B.GUN.dshk) {
      // a pedestal on a pickup is a worse mount than an M2's tripod or ring
      B.GUN.dshk = { cart: "127x108", moa: 5, zero: 600, sightH: 0, recoil: 2.2, eff: 1500, area: 1800, max: 2500, cls: "lmg", malf: 1 / 4000, tracer: 5, mount: true };
    }
  })();

  // ---- the numbers -----------------------------------------------------------
  const L = 5.26, Wd = 1.835, ROOF = 1.80;
  const AXF = 1.75, AXR = -1.335, TRK = 0.775, R = 0.37, TW = 0.255, RIM = 0.19;
  const FLOOR = 0.885;                      // bed floor (top)
  const PZ = -1.30, PIV = 2.08;             // pedestal: z, top of the post (traverse pivot)
  const GY = 0.05;                          // trunnion above the pivot
  const HIPS = { y: -0.28, z: -0.84 };      // the gunner's hips in turret space

  /* ================================================================ PAINT */
  const FACTORY = [0xe4e2db, 0xcdbd9a, 0xb5b8b8];      // super white, beige, silver
  function lin(hex) { return CBZ.hullKit.lin(hex); }
  function canvasEl(n) {
    if (typeof document === "undefined" || !document.createElement) return null;
    const c = document.createElement("canvas"); c.width = n; c.height = n;
    const g = c.getContext ? c.getContext("2d") : null;
    return g && g.getImageData ? { c: c, g: g } : null;
  }
  function hex(n) { return "#" + ("000000" + (n >>> 0).toString(16)).slice(-6); }
  // draw fn at the 9 tile offsets so the pattern has no seam
  function wrapDraw(S, fn) { for (let ox = -S; ox <= S; ox += S) for (let oy = -S; oy <= S; oy += S) fn(ox, oy); }
  function noise(g, S, rnd, amt) {
    const img = g.getImageData(0, 0, S, S), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * amt;
      d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.9));
    }
    g.putImageData(img, 0, 0);
  }
  function texOf(c) {
    const THREE = W.THREE;
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }
  /* THE MILITIA PAINT JOB: the factory colour, brushed over by hand in the
     army's colours (ragged daubs and dry-brush streaks, not a stencil), then
     chipped back to the factory paint and primer, rust spots that run down,
     dust. One texture per (factory colour, scheme). */
  function paintTex(fi, schemeId) {
    const cv = canvasEl(512);
    if (!cv) return null;
    const S = 512, g = cv.g, rnd = CBZ.hullKit.rng(97 + fi * 31 + schemeId.length * 7 + schemeId.charCodeAt(0));
    const sc = CBZ.hullKit.SCHEMES[schemeId] || CBZ.hullKit.SCHEMES.tan;
    g.fillStyle = hex(FACTORY[fi]); g.fillRect(0, 0, S, S);
    const cols = [sc.base].concat(sc.layers.map(function (l) { return l.col; }));
    // ragged daubs
    for (let i = 0; i < 26; i++) {
      const col = cols[i % 3 === 2 && cols.length > 1 ? 1 + (i % (cols.length - 1)) : 0];
      const cx = rnd() * S, cy = rnd() * S, r = 40 + rnd() * 70, k = 14, pts = [];
      for (let j = 0; j < k; j++) { const a = j * 2 * PI / k, rr = r * (0.45 + rnd() * 0.75); pts.push([Math.cos(a) * rr * 1.5, Math.sin(a) * rr]); }
      g.fillStyle = col; g.globalAlpha = 0.92;
      wrapDraw(S, function (ox, oy) {
        g.beginPath(); g.moveTo(cx + ox + pts[0][0], cy + oy + pts[0][1]);
        for (let j = 1; j < k; j++) g.lineTo(cx + ox + pts[j][0], cy + oy + pts[j][1]);
        g.closePath(); g.fill();
      });
    }
    // dry-brush streaks (the brush ran out), mostly one hand's angle
    g.lineCap = "round";
    for (let i = 0; i < 420; i++) {
      const col = cols[Math.floor(rnd() * cols.length)];
      const x = rnd() * S, y = rnd() * S, a = -0.5 + (rnd() - 0.5) * 0.7, l = 18 + rnd() * 60;
      g.strokeStyle = col; g.globalAlpha = 0.18 + rnd() * 0.35; g.lineWidth = 1 + rnd() * 4;
      wrapDraw(S, function (ox, oy) { g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke(); });
    }
    // chips back to the factory colour and to grey primer
    for (let i = 0; i < 260; i++) {
      const x = rnd() * S, y = rnd() * S, w = 1 + rnd() * 5, h = 1 + rnd() * 3;
      g.globalAlpha = 0.85; g.fillStyle = rnd() < 0.7 ? hex(FACTORY[fi]) : "#8a8a84";
      g.fillRect(x, y, w, h);
    }
    // scratches: bare steel
    g.strokeStyle = "#cfcfc8";
    for (let i = 0; i < 40; i++) {
      const x = rnd() * S, y = rnd() * S, a = rnd() * PI, l = 10 + rnd() * 40;
      g.globalAlpha = 0.25 + rnd() * 0.3; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    // rust: a spot and its run down the panel
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S, y = rnd() * S, r = 1.5 + rnd() * 4;
      g.globalAlpha = 0.75; g.fillStyle = rnd() < 0.5 ? "#6e3a1c" : "#8a4f26";
      g.beginPath(); g.arc(x, y, r, 0, 2 * PI); g.fill();
      g.globalAlpha = 0.22; g.fillRect(x - r * 0.4, y, r * 0.8, 12 + rnd() * 40);
    }
    // dust settled into it
    g.globalAlpha = 1;
    noise(g, S, rnd, 12);
    return texOf(cv.c);
  }
  // mill-scale steel plate: blue-grey scale, rust blooms, grinder marks
  function steelTex() {
    const cv = canvasEl(256);
    if (!cv) return null;
    const S = 256, g = cv.g, rnd = CBZ.hullKit.rng(4111);
    g.fillStyle = "#4b4a46"; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) {
      const x = rnd() * S, y = rnd() * S, r = 8 + rnd() * 34;
      g.globalAlpha = 0.18 + rnd() * 0.4; g.fillStyle = rnd() < 0.55 ? "#7a4524" : (rnd() < 0.5 ? "#5c3a22" : "#3b3d40");
      wrapDraw(S, function (ox, oy) { g.beginPath(); g.arc(x + ox, y + oy, r, 0, 2 * PI); g.fill(); });
    }
    g.strokeStyle = "#8e8d86";
    for (let i = 0; i < 30; i++) {
      const x = rnd() * S, y = rnd() * S;
      g.globalAlpha = 0.25; g.lineWidth = 1;
      g.beginPath(); g.arc(x, y, 6 + rnd() * 12, rnd() * PI, rnd() * PI + 1.5); g.stroke();
    }
    g.globalAlpha = 1;
    noise(g, S, rnd, 18);
    return texOf(cv.c);
  }
  // burnt out: soot, bare steel gone to rust, grey ash
  function burntTex() {
    const cv = canvasEl(256);
    if (!cv) return null;
    const S = 256, g = cv.g, rnd = CBZ.hullKit.rng(777);
    g.fillStyle = "#2b2825"; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      const x = rnd() * S, y = rnd() * S, r = 6 + rnd() * 30;
      g.globalAlpha = 0.25 + rnd() * 0.5; g.fillStyle = ["#7a3f1f", "#9a5a30", "#5a2f18", "#77736c", "#151413"][Math.floor(rnd() * 5)];
      wrapDraw(S, function (ox, oy) { g.beginPath(); g.arc(x + ox, y + oy, r, 0, 2 * PI); g.fill(); });
    }
    g.globalAlpha = 1;
    noise(g, S, rnd, 22);
    return texOf(cv.c);
  }
  // the windscreen after the rounds came through it
  function crackTex() {
    const cv = canvasEl(256);
    if (!cv) return null;
    const S = 256, g = cv.g, rnd = CBZ.hullKit.rng(31337);
    g.fillStyle = "#1b2627"; g.fillRect(0, 0, S, S);
    g.strokeStyle = "#d8dcd8";
    for (let h = 0; h < 4; h++) {
      const cx = rnd() * S, cy = rnd() * S;
      g.globalAlpha = 0.9; g.fillStyle = "#e6e8e4"; g.beginPath(); g.arc(cx, cy, 2.5, 0, 2 * PI); g.fill();
      for (let k = 0; k < 9; k++) {
        let x = cx, y = cy, a = k * 2 * PI / 9 + rnd() * 0.5;
        g.globalAlpha = 0.55; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < 5; s++) { a += (rnd() - 0.5) * 0.6; x += Math.cos(a) * (8 + rnd() * 14); y += Math.sin(a) * (8 + rnd() * 14); g.lineTo(x, y); }
        g.stroke();
      }
      for (let ring = 1; ring < 3; ring++) { g.globalAlpha = 0.35; g.beginPath(); g.arc(cx, cy, 6 * ring + rnd() * 6, 0, 2 * PI); g.stroke(); }
    }
    g.globalAlpha = 1;
    return texOf(cv.c);
  }
  const MAT = { paint: {} };
  function lam(hexc, map) {
    const THREE = W.THREE, l = lin(hexc);
    const m = new THREE.MeshLambertMaterial({ color: map ? 0xffffff : new THREE.Color(l[0], l[1], l[2]), vertexColors: true, map: map || null });
    return m;
  }
  function paintMat(fi, schemeId) {
    const key = fi + ":" + schemeId;
    if (MAT.paint[key]) return MAT.paint[key];
    const t = paintTex(fi, schemeId);
    return (MAT.paint[key] = t ? lam(0, t) : lam(FACTORY[fi]));
  }
  function ownMats() {
    if (MAT.own) return MAT.own;
    const THREE = W.THREE;
    const st = steelTex(), bt = burntTex(), ct = crackTex();
    const chrome = new THREE.MeshPhongMaterial({ color: 0xffffff, vertexColors: true, specular: 0x9a9a9a, shininess: 70 });
    chrome.color.setRGB(0.55, 0.56, 0.57);
    const crack = new THREE.MeshPhongMaterial({ color: 0xffffff, map: ct, specular: 0x8fa2a6, shininess: 60 });
    if (!ct) crack.color.setRGB(0.2, 0.24, 0.25);
    MAT.own = {
      "tk:steel": st ? lam(0, st) : lam(0x4b4a46),
      "tk:burnt": bt ? lam(0, bt) : lam(0x2b2825),
      "tk:vc": lam(0xffffff),
      "tk:chrome": chrome,
      crack: crack,
    };
    return MAT.own;
  }

  /* ================================================================ GEOMETRY */
  // a wheel-arch flare: a band of segments round the arch (top half)
  function flare(G, x, cy, cz, r, w, t, n) {
    for (let i = 0; i <= n; i++) {
      const a = -0.18 + (PI + 0.36) * i / n;          // from just below the front to just below the rear
      const y = cy + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      G.box(x, y, z, w, t, r * (PI + 0.36) / n * 1.08, -(a + PI / 2), 0, 0);
    }
  }
  function archLiner(G, x, cy, cz, r, len) {
    G.save().m("black").c(1);
    G.cyl(x, cy, cz, r, r, len, "x", 14, 0, 0, 0, { a0: PI / 2 + 0.1, a1: 3 * PI / 2 - 0.1 });
    G.restore();
  }
  function tube(G, a, b, r) { G.tube(a, b, r, r, 8); }

  function body() {
    const HK = CBZ.hullKit, G = HK.geo();
    /* ---------------- underneath: frame, running gear (unpainted) -------- */
    G.m("dark").c(1);
    [-1, 1].forEach(function (s) { G.box(s * 0.43, 0.55, -0.35, 0.07, 0.15, 4.75); });           // ladder frame rails
    [2.05, 0.9, -0.4, -1.9, -2.55].forEach(function (z) { G.box(0, 0.55, z, 0.86, 0.10, 0.07); });   // crossmembers
    G.m("metal").c(0.9);
    // front: diff, half-shafts, double wishbones, coil-overs, steering rack
    G.sphere(0.06, R + 0.03, AXF, 0.13, 8, 1.1, 0.85, 1.0);
    [-1, 1].forEach(function (s) {
      G.cyl(s * 0.42, R + 0.01, AXF, 0.028, 0.028, 0.62, "x", 6);
      G.box(s * 0.52, R - 0.08, AXF + 0.05, 0.50, 0.05, 0.12, 0, 0, s * 0.12);
      G.box(s * 0.55, R + 0.20, AXF - 0.04, 0.40, 0.04, 0.09, 0, 0, s * -0.15);
      G.cyl(s * 0.58, R + 0.22, AXF - 0.12, 0.05, 0.05, 0.36, "y", 8, 0, 0, s * 0.25);   // coil-over
      G.cyl(s * 0.70, R, AXF, 0.09, 0.09, 0.08, "x", 10);                              // knuckle / hub
    });
    G.cyl(0, R + 0.06, AXF - 0.22, 0.025, 0.025, 1.1, "x", 6);                          // steering rack
    G.cyl(0, 0.50, 0.30, 0.035, 0.035, 2.5, "z", 6);                                     // propshaft
    G.box(0, 0.65, 1.55, 0.55, 0.40, 0.75);                                                // engine sump / gearbox under
    G.box(0, 0.62, 0.65, 0.35, 0.25, 0.60);                                                // transfer case
    // rear: the live axle on leaf springs
    G.cyl(0, R, AXR, 0.048, 0.048, 1.42, "x", 8);
    G.sphere(0.05, R, AXR, 0.15, 9, 0.9, 1.0, 1.1);
    [-1, 1].forEach(function (s) {
      G.cyl(s * 0.70, R, AXR, 0.09, 0.09, 0.08, "x", 10);                                // drum
      G.box(s * 0.46, R + 0.08, AXR, 0.06, 0.022, 1.30);                                  // leaves
      G.box(s * 0.46, R + 0.055, AXR, 0.06, 0.022, 0.95);
      G.box(s * 0.46, R + 0.032, AXR, 0.06, 0.022, 0.60);
      G.box(s * 0.46, R + 0.18, AXR - 0.66, 0.05, 0.16, 0.04, 0.4, 0, 0);               // shackle
      G.box(s * 0.46, R + 0.16, AXR + 0.66, 0.05, 0.10, 0.06);                            // hanger
      [-1, 1].forEach(function (u) { G.box(s * 0.46 + u * 0.035, R + 0.02, AXR, 0.012, 0.16, 0.012); });   // U-bolts
      G.cyl(s * 0.36, R + 0.17, AXR + 0.15, 0.025, 0.03, 0.40, "y", 6, 0.35, 0, 0);      // shock
    });
    // fuel tank (left, under the bed) and the exhaust (right, out the back)
    G.m("dark").c(0.8).box(0.62, 0.52, -0.95, 0.30, 0.22, 0.75);
    G.m("metal").c(0.75);
    G.cyl(-0.30, 0.44, 0.6, 0.032, 0.032, 2.0, "z", 8);
    G.box(-0.40, 0.44, -0.75, 0.22, 0.14, 0.55);                                           // silencer
    G.cyl(-0.52, 0.42, -1.85, 0.03, 0.03, 1.35, "z", 8, 0, 0.12, 0);
    G.cyl(-0.60, 0.42, -2.56, 0.033, 0.033, 0.10, "z", 8);
    // the spare, slung under the bed behind the axle
    G.save().tf(0, 0.48, -2.22, 0, 0, PI / 2);
    HK.tyre(G, R, TW, RIM, { lug: "ndt", lugs: 18, dep: 0.02 });
    G.restore();
    G.m("dark").c(1).box(0, 0.40, 1.85, 0.85, 0.02, 1.0);                                  // bash plate
    /* ---------------- the front: hood, fenders, grille, lamps ------------ */
    G.m("tk:paint").c(1);
    const hsec = function (bot, top, w, wt) { return [[-w, bot], [w, bot], [w + 0.04, top - 0.04], [wt, top], [-wt, top], [-w - 0.04, top - 0.04]]; };
    G.sect([[2.52, hsec(0.80, 1.045, 0.62, 0.55)], [2.40, hsec(0.70, 1.085, 0.66, 0.58)], [1.30, hsec(0.70, 1.16, 0.68, 0.60)]]);
    // intercooler scoop (3.0 D-4D)
    G.sect([[2.02, [[-0.24, 1.11], [0.24, 1.11], [0.23, 1.15], [-0.23, 1.15]]], [1.62, [[-0.27, 1.13], [0.27, 1.13], [0.25, 1.215], [-0.25, 1.215]]]]);
    G.save().m("black").c(1).box(0, 1.17, 1.995, 0.42, 0.05, 0.02, -0.35, 0, 0).restore();
    [-1, 1].forEach(function (s) {
      // the fender over the wheel
      const fs = function (bot, top) { return [[s * 0.70, bot], [s * 0.885, bot], [s * 0.895, top - 0.07], [s * 0.87, top - 0.02], [s * 0.70, top]]; };
      G.sect([[2.46, fs(0.90, 1.04)], [2.30, fs(0.88, 1.08)], [1.30, fs(0.88, 1.13)]]);
      // the corner ahead of the wheel and the panel behind it down to the sill
      G.box(s * 0.76, 0.74, 2.36, 0.25, 0.34, 0.24);
      G.box(s * 0.80, 0.70, 1.27, 0.17, 0.36, 0.06);
      archLiner(G, s * 0.55, R, AXF, 0.47, 0.30);
      G.save().m("black").c(1);
      flare(G, s * 0.895, R, AXF, 0.47, 0.06, 0.045, 10);
      G.restore();
      // indicator on the fender, side marker
      G.save().m("amber").c(1).box(s * 0.895, 0.98, 2.15, 0.02, 0.04, 0.09).restore();
      // headlamp: swept back round the corner
      G.save().m("black").c(1).box(s * 0.62, 0.95, 2.47, 0.30, 0.14, 0.12, 0, s * 0.42, 0).restore();
      G.save().m("lamp").c(1).box(s * 0.62, 0.955, 2.51, 0.27, 0.11, 0.04, 0, s * 0.42, 0).restore();
      G.save().m("amber").c(1).box(s * 0.76, 0.945, 2.44, 0.07, 0.08, 0.05, 0, s * 0.6, 0).restore();
      // hood / fender shut line
      G.save().m("black").c(1).box(s * 0.70, 1.135, 1.90, 0.012, 0.012, 1.15).restore();
    });
    // grille: the recess, three chrome bars, the badge
    G.save().m("black").c(1).box(0, 0.92, 2.525, 0.88, 0.22, 0.03).restore();
    G.save().m("tk:chrome").c(1);
    [0.99, 0.925, 0.86].forEach(function (y) { G.box(0, y, 2.545, 0.84, 0.028, 0.02); });
    G.cyl(0, 0.925, 2.56, 0.07, 0.07, 0.015, "z", 16, 0, 0, 0);
    G.restore();
    // bumper with the fog lamps and the lower intake
    G.m("tk:paint").c(0.92);
    G.prof(-0.86, 0.86, [[2.47, 0.47], [2.60, 0.50], [2.64, 0.60], [2.62, 0.76], [2.50, 0.80]]);
    [-1, 1].forEach(function (s) { G.box(s * 0.82, 0.63, 2.46, 0.12, 0.30, 0.22, 0, s * 0.5, 0); });
    G.save().m("black").c(1).box(0, 0.56, 2.635, 0.70, 0.08, 0.02).restore();
    [-1, 1].forEach(function (s) {
      G.save().m("black").c(1).cyl(s * 0.62, 0.58, 2.63, 0.05, 0.05, 0.03, "z", 12).restore();
      G.save().m("lamp").c(0.9).cyl(s * 0.62, 0.58, 2.645, 0.038, 0.038, 0.01, "z", 12).restore();
    });
    G.save().m("dark").c(1).cyl(0.30, 0.47, 2.62, 0.03, 0.03, 0.05, "x", 8).restore();     // tow hook
    /* ---------------- THE CAB ------------------------------------------- */
    G.m("tk:paint").c(1);
    const cs = [[-0.87, 0.52], [0.87, 0.52], [0.895, 0.80], [0.885, 1.135], [-0.885, 1.135], [-0.895, 0.80]];
    G.sect([[1.30, cs], [-0.30, cs]]);
    // the greenhouse: glass, then the pillars, roof and rear quarter over it
    G.save().m("glass").c(1);
    const gOut = [[1.20, 1.13], [0.68, 1.70], [0.56, 1.71], [-0.20, 1.71], [-0.27, 1.66], [-0.29, 1.13]];
    const gIn = [[1.31, 1.13], [0.64, 1.785], [0.55, 1.795], [-0.22, 1.795], [-0.295, 1.76], [-0.30, 1.13]];
    G.loft("x", [{ a: -0.862, pts: gOut }, { a: -0.72, pts: gIn }, { a: 0.72, pts: gIn }, { a: 0.862, pts: gOut }]);
    G.restore();
    G.m("tk:paint").c(1);
    G.box(0, 1.80, 0.17, 1.46, 0.03, 0.80);                                                 // roof skin
    G.box(0, 1.79, 0.585, 1.42, 0.03, 0.08, -0.45, 0, 0);                                    // header
    G.box(0, 1.165, 1.27, 1.58, 0.05, 0.10);                                                 // cowl
    [-1, 1].forEach(function (s) {
      tube(G, [s * 0.865, 1.14, 1.22], [s * 0.725, 1.785, 0.63], 0.035);                   // A-pillar
      tube(G, [s * 0.73, 1.79, 0.62], [s * 0.735, 1.79, -0.27], 0.022);                    // drip rail
      G.box(s * 0.825, 1.42, -0.135, 0.04, 0.60, 0.33, 0, 0, s * 0.21);                     // the blind rear quarter
      G.save().m("black").c(1);
      G.box(s * 0.895, 0.84, 1.23, 0.012, 0.60, 0.012);                                     // door seams
      G.box(s * 0.895, 0.84, 0.03, 0.012, 0.60, 0.012);
      G.box(s * 0.815, 1.43, 0.035, 0.016, 0.58, 0.03, 0, 0, s * 0.21);                     // window's rear frame
      G.box(s * 0.90, 1.02, 0.17, 0.02, 0.03, 0.12);                                        // handle
      G.box(s * 0.89, 1.135, 0.63, 0.02, 0.025, 1.20);                                      // belt moulding
      // side step
      G.box(s * 0.93, 0.47, 0.50, 0.13, 0.035, 1.55);
      [1.05, -0.05].forEach(function (z) { G.box(s * 0.88, 0.50, z, 0.05, 0.06, 0.05); });
      // mirror on its arm
      G.box(s * 0.94, 1.20, 1.10, 0.13, 0.03, 0.05);
      G.box(s * 1.03, 1.24, 1.08, 0.05, 0.17, 0.22, 0, s * 0.15, 0);
      // wipers
      G.box(s * 0.35, 1.25, 1.17, 0.02, 0.02, 0.52, -0.95, s * 0.2, 0);
      G.restore();
    });
    // rear wall of the cab and its little window
    G.box(0, 1.46, -0.315, 1.44, 0.66, 0.035);
    G.save().m("glass").c(1).box(0, 1.53, -0.335, 1.00, 0.26, 0.01).restore();
    // inside: floor, dash, seats
    G.save().m("dark").c(0.8);
    G.box(0, 0.60, 0.50, 1.6, 0.04, 1.55);
    G.box(0, 1.17, 1.02, 1.55, 0.16, 0.34);
    G.box(0, 1.27, 1.08, 1.50, 0.06, 0.24, -0.25, 0, 0);
    [-1, 1].forEach(function (s) {
      G.box(s * 0.40, 0.88, 0.36, 0.50, 0.12, 0.50);
      G.box(s * 0.40, 1.22, 0.05, 0.50, 0.60, 0.10, -0.12, 0, 0);
      G.box(s * 0.40, 1.60, 0.02, 0.24, 0.16, 0.08);
    });
    G.restore();
    /* ---------------- THE BED ------------------------------------------- */
    G.m("tk:paint").c(1);
    [-1, 1].forEach(function (s) {
      G.box(s * 0.83, 0.97, -0.62, 0.06, 0.70, 0.44);          // ahead of the arch
      G.box(s * 0.83, 0.97, -2.21, 0.06, 0.70, 0.78);          // behind it
      G.box(s * 0.83, 1.12, -1.33, 0.06, 0.40, 0.98);          // over it
      archLiner(G, s * 0.55, R, AXR, 0.47, 0.30);
      G.save().m("black").c(1);
      flare(G, s * 0.875, R, AXR, 0.47, 0.05, 0.04, 10);
      G.box(s * 0.82, 1.335, -1.50, 0.10, 0.03, 2.22);         // rail cap
      G.box(s * 0.86, 0.47, -1.90, 0.04, 0.22, 0.02);          // mud flap
      G.box(s * 0.86, 0.47, 1.18, 0.04, 0.22, 0.02);
      G.restore();
      // the wheel tub inside the bed
      G.cyl(s * 0.66, 0.62, AXR, 0.49, 0.49, 0.26, "x", 14, 0, 0, 0, { a0: PI / 2, a1: 3 * PI / 2 });
      // tail lamps on the bed's rear corners
      G.save().m("black").c(1).box(s * 0.815, 1.04, -2.605, 0.10, 0.40, 0.03).restore();
      G.save().m("tail").c(1).box(s * 0.815, 1.13, -2.622, 0.08, 0.17, 0.01).restore();
      G.save().m("amber").c(1).box(s * 0.815, 1.00, -2.622, 0.08, 0.08, 0.01).restore();
      G.save().m("lamp").c(1).box(s * 0.815, 0.91, -2.622, 0.08, 0.06, 0.01).restore();
    });
    G.box(0, 0.97, -0.42, 1.66, 0.70, 0.05);                                                // front wall
    G.box(0, 0.86, -1.50, 1.62, 0.05, 2.20);                                                // floor
    for (let i = 0; i < 7; i++) G.box(-0.60 + i * 0.20, 0.89, -1.50, 0.05, 0.012, 2.15);    // floor ribs
    G.box(0, 0.98, -2.62, 1.56, 0.62, 0.05);                                                // tailgate
    G.save().m("tk:paint").c(0.9).box(0, 1.04, -2.648, 1.20, 0.22, 0.01).restore();          // stamped panel
    G.save().m("black").c(1).box(0, 1.22, -2.65, 0.20, 0.05, 0.02).restore();               // latch
    G.save().m("dark").c(1);
    G.box(0, 0.55, -2.70, 1.62, 0.13, 0.14);                                                // step bumper
    G.box(0, 0.50, -2.80, 0.08, 0.06, 0.16).cyl(0, 0.55, -2.86, 0.03, 0.03, 0.06, "y", 8);   // hitch + ball
    G.restore();
    /* ---------------- THE MILITIA'S WORK -------------------------------- */
    // the pedestal: base plate, gussets, the post
    G.save().m("tk:steel").c(1);
    G.box(0, FLOOR + 0.012, PZ, 0.46, 0.025, 0.46);
    for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; G.box(Math.sin(a) * 0.11, FLOOR + 0.13, PZ + Math.cos(a) * 0.11, 0.012, 0.24, 0.16, 0, a, 0); }
    G.restore();
    G.save().m("dark").c(1).cyl(0, (FLOOR + PIV) / 2, PZ, 0.055, 0.06, PIV - FLOOR - 0.04, "y", 10).restore();
    // radiator plate behind a welded pipe bull bar
    G.save().m("tk:steel").c(1).box(0, 0.92, 2.585, 0.98, 0.27, 0.014).restore();
    G.save().m("black").c(1);
    for (let i = 0; i < 5; i++) G.box(-0.32 + i * 0.16, 0.92, 2.594, 0.09, 0.025, 0.006);
    G.restore();
    G.save().m("dark").c(0.85);
    [-1, 1].forEach(function (s) {
      tube(G, [s * 0.38, 0.52, 2.66], [s * 0.38, 1.10, 2.70], 0.03);
      tube(G, [s * 0.38, 0.72, 2.68], [s * 0.80, 0.70, 2.56], 0.025);
      tube(G, [s * 0.80, 0.70, 2.56], [s * 0.80, 0.98, 2.52], 0.025);
    });
    tube(G, [-0.40, 1.10, 2.70], [0.40, 1.10, 2.70], 0.03);
    tube(G, [-0.40, 0.84, 2.69], [0.40, 0.84, 2.69], 0.025);
    // the roll cage behind the cab
    [-1, 1].forEach(function (s) {
      tube(G, [s * 0.76, 1.34, -0.50], [s * 0.66, 2.00, -0.50], 0.032);
      tube(G, [s * 0.66, 2.00, -0.50], [s * 0.76, 1.34, -1.00], 0.026);
    });
    tube(G, [-0.68, 2.00, -0.50], [0.68, 2.00, -0.50], 0.032);
    tube(G, [-0.62, 1.70, -0.50], [0.62, 1.70, -0.50], 0.026);
    G.restore();
    // rusted plates bolted to the bed sides (not a matched pair: what there was)
    G.save().m("tk:steel").c(1);
    G.box(0.872, 1.03, -1.85, 0.014, 0.58, 1.30);
    G.box(-0.872, 1.07, -2.05, 0.014, 0.50, 0.95, 0.04, 0, 0);
    G.restore();
    G.save().m("dark").c(1);
    for (let i = 0; i < 6; i++) G.cyl(0.882, 0.80 + (i % 2) * 0.46, -2.42 + Math.floor(i / 2) * 0.57, 0.014, 0.014, 0.012, "x", 6);
    for (let i = 0; i < 4; i++) G.cyl(-0.882, 0.86 + (i % 2) * 0.40, -2.45 + Math.floor(i / 2) * 0.80, 0.014, 0.014, 0.012, "x", 6);
    G.restore();
    // sandbags against the cab, ammunition boxes, a jerrycan
    G.save().m("canvas").c(1);
    G.sphere(-0.48, FLOOR + 0.07, -0.58, 0.20, 8, 1.35, 0.42, 0.75);
    G.sphere(0.0, FLOOR + 0.07, -0.58, 0.20, 8, 1.35, 0.42, 0.75, 0, PI, 0, 0.1, 0);
    G.sphere(-0.26, FLOOR + 0.19, -0.60, 0.20, 8, 1.35, 0.42, 0.75, 0, PI, 0, -0.08, 0);
    G.restore();
    G.save().m("tk:vc");
    G.c(0x4b5232).box(-0.55, FLOOR + 0.08, -2.38, 0.34, 0.16, 0.13).box(-0.55, FLOOR + 0.24, -2.38, 0.34, 0.16, 0.13, 0, 0.12, 0);
    G.c(0x3a3f28).box(-0.55, FLOOR + 0.165, -2.38, 0.34, 0.01, 0.135).box(-0.55, FLOOR + 0.325, -2.38, 0.30, 0.02, 0.11, 0, 0.12, 0);
    G.c(0x4b5232).box(-0.25, FLOOR + 0.08, -2.44, 0.13, 0.16, 0.34);
    G.c(0x59603a).box(0.56, FLOOR + 0.19, -2.43, 0.17, 0.38, 0.27);
    G.c(0x2f3322).box(0.56, FLOOR + 0.40, -2.43, 0.05, 0.04, 0.16).cyl(0.56, FLOOR + 0.42, -2.36, 0.018, 0.018, 0.04, "y", 6);
    G.restore();
    // CB whip on the right fender, bent back by the wind
    G.save().m("black").c(1);
    G.cyl(-0.84, 1.13, 1.25, 0.02, 0.025, 0.06, "y", 6);
    let py = 1.16, pz = 1.25, a = 0;
    for (let i = 0; i < 6; i++) {
      a += 0.07; const l = 0.26, dy = Math.cos(a) * l, dz = -Math.sin(a) * l;
      G.cyl(-0.84, py + dy / 2, pz + dz / 2, 0.004, 0.006, l, "y", 4, -a, 0, 0);
      py += dy; pz += dz;
    }
    G.restore();
    const geos = G.build({ uv: 2.2, mud: 0.85, mudCol: [0.72, 0.62, 0.48] });

    /* ---------------- THE TURRET (pedestal head + shield), traverse space */
    const Tg = HK.geo();
    Tg.m("dark").c(1);
    Tg.cyl(0, 0.0, 0, 0.07, 0.075, 0.12, "y", 12);                            // swivel
    [-1, 1].forEach(function (s) {
      Tg.box(s * 0.105, GY + 0.01, 0, 0.022, 0.16, 0.12);                     // the yoke's cheeks
      Tg.cyl(s * 0.125, GY, 0, 0.025, 0.025, 0.03, "x", 8);                    // trunnion caps
    });
    Tg.box(0, -0.03, 0.04, 0.24, 0.03, 0.14);
    Tg.box(0, 0.02, 0.17, 0.05, 0.04, 0.28);                                    // shield arm
    Tg.cyl(0, -0.04, -0.12, 0.012, 0.012, 0.14, "z", 6, 0, 0, 0);               // traverse lock
    // the shield: a U-notched plate and two angled wings, welded
    Tg.m("tk:steel").c(1);
    const SZ = 0.33;
    Tg.box(0, 0.02, SZ, 0.70, 0.24, 0.012);
    [-1, 1].forEach(function (s) {
      Tg.box(s * 0.235, 0.29, SZ, 0.23, 0.30, 0.012);
      Tg.box(s * 0.405, 0.15, SZ - 0.09, 0.012, 0.50, 0.22, 0, s * -0.55, 0);
    });
    Tg.m("dark").c(1);
    for (let i = 0; i < 5; i++) Tg.cyl(-0.28 + i * 0.14, -0.06, SZ + 0.008, 0.012, 0.012, 0.01, "z", 6);
    [-1, 1].forEach(function (s) { Tg.box(s * 0.12, 0.29, SZ + 0.008, 0.008, 0.30, 0.008); });      // weld beads
    const tGeos = Tg.build({ uv: 1.6, mud: 0 });

    /* ---------------- THE DShKM, gun space: trunnion at the origin -------- */
    const Gg = HK.geo();
    Gg.save().tf(0, 0.07, 0);
    Gg.m("dark").c(1);
    Gg.box(0, 0, -0.15, 0.13, 0.15, 0.56);                                     // receiver
    Gg.box(0, 0.085, -0.12, 0.12, 0.03, 0.32);                                 // feed cover
    Gg.cyl(0, 0.10, -0.28, 0.015, 0.015, 0.13, "x", 6);                        // its hinge
    Gg.box(0, 0.0, -0.445, 0.15, 0.13, 0.03);                                   // backplate
    [-1, 1].forEach(function (s) { Gg.cyl(s * 0.065, 0.0, -0.49, 0.018, 0.02, 0.13, "y", 6, 0, 0, s * 0.25); });   // spade grips
    Gg.box(0, 0.0, -0.475, 0.06, 0.025, 0.03);                                  // butterfly trigger
    Gg.box(-0.075, -0.02, -0.24, 0.03, 0.035, 0.09);                            // charging handle
    Gg.box(0, -0.09, -0.10, 0.10, 0.03, 0.40);                                  // cradle
    Gg.cyl(0, 0, 0.15, 0.045, 0.045, 0.06, "z", 12);                            // barrel nut
    Gg.cyl(0, 0, 0.64, 0.021, 0.022, 1.0, "z", 10);                             // barrel
    for (let i = 0; i < 19; i++) Gg.cyl(0, 0, 0.18 + i * 0.031, 0.040, 0.040, 0.010, "z", 12);   // cooling fins
    Gg.cyl(0, -0.058, 0.45, 0.012, 0.012, 0.62, "z", 6);                        // gas cylinder
    Gg.box(0, -0.035, 0.78, 0.03, 0.05, 0.04);                                  // gas block
    Gg.box(0, 0.0, 1.17, 0.08, 0.045, 0.11);                                    // the flat muzzle brake
    Gg.m("black").c(1);
    [-1, 1].forEach(function (s) { Gg.box(s * 0.041, 0, 1.15, 0.004, 0.028, 0.025).box(s * 0.041, 0, 1.19, 0.004, 0.028, 0.025); });
    Gg.m("dark").c(1);
    Gg.box(0, 0.045, 1.05, 0.01, 0.05, 0.02);                                   // front sight
    Gg.box(0, 0.115, -0.01, 0.045, 0.035, 0.025);                               // rear leaf
    // carrying handle on the barrel
    Gg.box(0, 0.06, 0.28, 0.02, 0.06, 0.02).box(0, 0.06, 0.40, 0.02, 0.06, 0.02).box(0, 0.095, 0.34, 0.025, 0.02, 0.16);
    // the AA ring sight on its stalk
    Gg.box(0, 0.14, 0.06, 0.012, 0.09, 0.012);
    for (let i = 0; i < 14; i++) {
      const a0 = i * 2 * PI / 14, a1 = (i + 1) * 2 * PI / 14, rr = 0.075, cy = 0.255;
      Gg.tube([Math.cos(a0) * rr, cy + Math.sin(a0) * rr, 0.06], [Math.cos(a1) * rr, cy + Math.sin(a1) * rr, 0.06], 0.004, 0.004, 4);
    }
    Gg.box(0, 0.255, 0.06, 0.15, 0.004, 0.004).box(0, 0.255, 0.06, 0.004, 0.15, 0.004);
    // the belt from the box into the feed (left)
    Gg.m("tk:vc").c(0xa88a3c);
    for (let i = 0; i < 5; i++) Gg.box(0.085 + i * 0.012, 0.02 - i * 0.022, -0.10, 0.02, 0.012, 0.11, 0, 0, -0.5);
    Gg.restore();
    const gGeos = Gg.build({ uv: 1.6, mud: 0 });
    // the 50-round box hung on the left of the cradle (its own mesh: it comes off at a reload)
    const Bg = HK.geo();
    Bg.m("tk:vc").c(0x4b5232).box(0.17, -0.03, -0.12, 0.10, 0.20, 0.30);
    Bg.c(0x343a22).box(0.17, 0.075, -0.12, 0.105, 0.015, 0.305).box(0.225, -0.03, -0.12, 0.01, 0.06, 0.10);
    const boxGeos = Bg.build({ uv: 1, mud: 0 });

    /* ---------------- wheels: AT tyre on a six-stud steel wheel ---------- */
    const Wg = HK.geo();
    HK.tyre(Wg, R, TW, RIM, { lug: "ndt", lugs: 22, dep: 0.022 });
    const tyreGeo = Wg.build({ uv: 1, mud: 0 }).rubber;
    const Rg = HK.geo();
    Rg.m("metal").c(1.1);
    Rg.cyl(TW * 0.33, 0, 0, RIM, RIM, 0.04, "x", 22);
    Rg.cyl(TW * 0.37, 0, 0, RIM * 0.60, RIM * 0.72, 0.05, "x", 18);
    Rg.m("black").c(1);
    for (let i = 0; i < 8; i++) { const a = i * PI / 4 + PI / 8; Rg.box(TW * 0.355, Math.cos(a) * RIM * 0.80, Math.sin(a) * RIM * 0.80, 0.01, 0.045, 0.03, a, 0, 0); }
    Rg.m("dark").c(1);
    for (let i = 0; i < 6; i++) { const a = i * PI / 3; Rg.cyl(TW * 0.40, Math.cos(a) * RIM * 0.42, Math.sin(a) * RIM * 0.42, 0.013, 0.013, 0.03, "x", 6); }
    Rg.cyl(TW * 0.41, 0, 0, 0.045, 0.05, 0.03, "x", 12);
    Rg.m("metal").c(0.7).cyl(-TW * 0.33, 0, 0, RIM, RIM, 0.03, "x", 16);
    const rimGeos = Rg.build({ uv: 1, mud: 0 });

    /* ---------------- the steering wheel (its own mesh: it turns) -------- */
    const Sg = HK.geo();
    Sg.m("black").c(1);
    for (let i = 0; i < 16; i++) {
      const a0 = i * 2 * PI / 16, a1 = (i + 1) * 2 * PI / 16;
      Sg.tube([Math.cos(a0) * 0.19, Math.sin(a0) * 0.19, 0], [Math.cos(a1) * 0.19, Math.sin(a1) * 0.19, 0], 0.016, 0.016, 5);
    }
    [0, PI * 0.85, PI * 1.15 + PI].forEach(function (a) { Sg.tube([0, 0, 0], [Math.cos(a - PI / 2) * 0.18, Math.sin(a - PI / 2) * 0.18, 0], 0.012, 0.012, 4); });
    Sg.cyl(0, 0, -0.02, 0.05, 0.05, 0.05, "z", 10);
    Sg.cyl(0, 0, -0.20, 0.025, 0.025, 0.32, "z", 6);
    const steerGeos = Sg.build({ uv: 1, mud: 0 });

    return { geos: geos, tGeos: tGeos, gGeos: gGeos, boxGeos: boxGeos, tyreGeo: tyreGeo, rimGeos: rimGeos, steerGeos: steerGeos, decals: {} };
  }

  /* ================================================================ THE MEN */
  /* Militia, not soldiers: shirts and trousers that do not match, a chest
     rig, a shemagh wrapped round the head (and over the face for some), no
     helmets, AKs. Hips at the origin, +Z forward. Kinds: stand (the gunner,
     hands on the spade grips), seat (the cab: hands on the wheel or the
     sill), kneel (the assistant gunner with a box of belts), rail (a man on
     the bed rail, legs over the side, his rifle across his knees). */
  const SKIN = [0x8d5a3b, 0xb07a55, 0x5e3a26, 0xc29470, 0x6f4630];
  const SHIRT = [0x6b5a43, 0x3e4a3a, 0x2f3640, 0x7c6f5e, 0x4b4038, 0x5a5f4a];
  const PANTS = [0x5a5246, 0x3c3f36, 0x2b2c2e, 0x6d6352, 0x45403a];
  const WRAP = [0xc9c3b4, 0xa83a32, 0x2a2a2a, 0x8a8370, 0xd6d0c0];
  const VEST = [0x4a4636, 0x5d5a44, 0x3a3a30];
  const FIGS = {};
  function figure(kind, k) {
    const key = kind + "|" + k;
    if (FIGS[key]) return FIGS[key];
    const G = CBZ.hullKit.geo(); G.m("tk:vc");
    const sk = SKIN[k % SKIN.length], sh = SHIRT[(k * 3 + 1) % SHIRT.length], pa = PANTS[(k * 2 + 3) % PANTS.length];
    const wr = WRAP[(k * 5 + 2) % WRAP.length], ve = VEST[k % VEST.length], masked = k % 3 !== 1;
    // torso and head
    G.c(pa).box(0, 0.02, 0, 0.32, 0.18, 0.21);
    G.c(sh).sect([[-0.11, [[-0.16, 0.05], [0.16, 0.05], [0.185, 0.36], [0.19, 0.52], [-0.19, 0.52], [-0.185, 0.36]]],
      [0.10, [[-0.16, 0.05], [0.16, 0.05], [0.185, 0.36], [0.19, 0.52], [-0.19, 0.52], [-0.185, 0.36]]]]);
    G.c(ve).box(0, 0.30, 0.02, 0.35, 0.22, 0.24);
    for (let i = -1; i <= 1; i++) G.box(i * 0.095, 0.27, 0.15, 0.08, 0.13, 0.05);      // AK mag pouches
    G.c(0x3a3830).box(0, 0.42, -0.10, 0.06, 0.30, 0.02, 0, 0, 0.6);                      // sling across the back
    G.c(sk).cyl(0, 0.57, 0, 0.05, 0.055, 0.08, "y", 8);
    G.sphere(0, 0.69, 0.012, 0.098, 9, 0.92, 1.12, 1.0);
    G.c(0x1e1a16).sphere(0, 0.655, 0.035, 0.085, 7, 0.95, 0.75, 0.85, PI * 0.45, PI);           // beard
    // the shemagh: over the crown and the back of the neck, a tail, over the face
    G.c(wr).sphere(0, 0.725, -0.005, 0.112, 9, 1.0, 0.92, 1.06, 0, PI * 0.56);
    G.box(0, 0.62, -0.08, 0.17, 0.16, 0.05);
    G.box(0.05, 0.54, -0.12, 0.08, 0.14, 0.03, 0.2, 0, 0.2);
    if (masked) G.cyl(0, 0.645, 0.012, 0.104, 0.104, 0.075, "y", 10);
    G.c(0x111111).box(0, 0.705, 0.095, 0.11, 0.022, 0.012);                              // eyes in shadow
    const ak = function (x, y, z, rx, ry, rz) {
      G.save().tf(x, y, z, rx, ry, rz);
      G.c(0x23241f).box(0, 0, 0, 0.05, 0.08, 0.40).box(0, -0.10, 0.06, 0.04, 0.13, 0.06, -0.35, 0, 0).cyl(0, 0.015, 0.36, 0.011, 0.011, 0.36, "z", 6);
      G.c(0x6a3e22).box(0, -0.01, -0.33, 0.045, 0.09, 0.28, 0.12, 0, 0).box(0, 0.0, 0.25, 0.055, 0.06, 0.15);
      G.restore();
    };
    G.c(sh);
    if (kind === "stand") {
      [-1, 1].forEach(function (s) {
        G.c(sh).tube([s * 0.19, 0.47, 0.0], [s * 0.22, 0.30, 0.17], 0.052, 0.046);
        G.tube([s * 0.22, 0.30, 0.17], [s * 0.07, 0.40, 0.34], 0.044, 0.038);
        G.c(sk).sphere(s * 0.065, 0.40, 0.355, 0.038, 6);
        G.c(pa).tube([s * 0.10, 0, 0], [s * 0.12, -0.45, 0.03], 0.075, 0.06);
        G.tube([s * 0.12, -0.45, 0.03], [s * 0.12, -0.86, -0.02], 0.055, 0.045);
        G.c(0x2b2520).box(s * 0.12, -0.895, 0.03, 0.11, 0.07, 0.26);
      });
    } else if (kind === "seat") {
      [-1, 1].forEach(function (s) {
        G.c(sh).tube([s * 0.19, 0.47, 0.0], [s * 0.22, 0.28, 0.18], 0.052, 0.046);
        G.tube([s * 0.22, 0.28, 0.18], [s * 0.15, 0.40, 0.40], 0.044, 0.038);
        G.c(sk).sphere(s * 0.15, 0.40, 0.42, 0.038, 6);
        G.c(pa).tube([s * 0.10, 0, 0], [s * 0.11, -0.01, 0.42], 0.075, 0.062);
        G.tube([s * 0.11, -0.01, 0.42], [s * 0.11, -0.44, 0.48], 0.055, 0.045);
        G.c(0x2b2520).box(s * 0.11, -0.47, 0.53, 0.11, 0.07, 0.24);
      });
    } else if (kind === "kneel") {
      // right knee down, left foot planted, a belt box held at the chest
      G.c(pa).tube([0.10, 0, 0], [0.12, -0.10, 0.40], 0.075, 0.06).tube([0.12, -0.10, 0.40], [0.12, -0.50, 0.38], 0.055, 0.045);
      G.c(0x2b2520).box(0.12, -0.53, 0.44, 0.11, 0.07, 0.24);
      G.c(pa).tube([-0.10, 0, 0], [-0.12, -0.48, 0.02], 0.075, 0.06).tube([-0.12, -0.48, 0.02], [-0.12, -0.42, -0.42], 0.055, 0.045);
      G.c(0x2b2520).box(-0.12, -0.47, -0.52, 0.10, 0.12, 0.08);
      [-1, 1].forEach(function (s) {
        G.c(sh).tube([s * 0.19, 0.47, 0.0], [s * 0.21, 0.27, 0.12], 0.052, 0.046);
        G.tube([s * 0.21, 0.27, 0.12], [s * 0.12, 0.30, 0.30], 0.044, 0.038);
      });
      G.c(0x4b5232).box(0, 0.30, 0.34, 0.30, 0.20, 0.11);
    } else {
      // rail: sitting on the bed rail, legs down over the side, AK across the knees
      [-1, 1].forEach(function (s) {
        G.c(pa).tube([s * 0.10, 0, 0], [s * 0.11, -0.05, 0.38], 0.075, 0.062);
        G.tube([s * 0.11, -0.05, 0.38], [s * 0.11, -0.48, 0.44], 0.055, 0.045);
        G.c(0x2b2520).box(s * 0.11, -0.51, 0.49, 0.11, 0.07, 0.24);
        G.c(sh).tube([s * 0.19, 0.47, 0.0], [s * 0.21, 0.27, 0.14], 0.052, 0.046);
        G.tube([s * 0.21, 0.27, 0.14], [s * 0.10, 0.12, 0.33], 0.044, 0.038);
        G.c(sk).sphere(s * 0.10, 0.12, 0.35, 0.036, 6);
      });
      ak(0, 0.13, 0.36, 0, PI / 2 - 0.25, 0);
    }
    if (kind === "stand" || kind === "kneel") ak(0, 0.32, -0.15, 0.2, 0, 1.0);          // slung on the back
    const geo = G.build({ mud: 0 })["tk:vc"];
    return (FIGS[key] = geo);
  }

  /* ================================================================ BUILD */
  let BODY = null;
  function build(ctx) {
    const THREE = W.THREE, HK = CBZ.hullKit;
    if (!THREE || !HK) return null;
    const B = BODY || (BODY = body());
    const side = ctx.side || ctx.team || null, ground = ctx.ground || ctx.arena;
    const seed = (ctx.seed | 0) >>> 0;
    const fi = seed % FACTORY.length;
    const sc = HK.scheme(ctx.nation, ground, side);
    const own = ownMats();
    const M = Object.assign({}, HK.mats(sc), own);
    M["tk:paint"] = paintMat(fi, sc);
    const root = new THREE.Group(); root.name = "technical";
    const bodyG = new THREE.Group(); bodyG.name = "body"; root.add(bodyG);
    HK.meshes(bodyG, B.geos, M, "hull");
    // the pedestal head traverses; the gun elevates in its yoke; the tube recoils
    const turret = new THREE.Group(); turret.name = "turret"; turret.position.set(0, PIV, PZ); bodyG.add(turret);
    const shield = new THREE.Group(); shield.name = "shield"; turret.add(shield);
    HK.meshes(shield, B.tGeos, M, "pedestal");
    const gun = new THREE.Group(); gun.name = "gun"; gun.position.set(0, GY, 0); turret.add(gun);
    const tube = new THREE.Group(); tube.name = "tube"; gun.add(tube);
    HK.meshes(tube, B.gGeos, M, "dshk");
    const ammo = new THREE.Group(); ammo.name = "ammo"; gun.add(ammo);
    HK.meshes(ammo, B.boxGeos, M, "box");
    const muzzle = new THREE.Object3D(); muzzle.name = "muzzle"; muzzle.position.set(0, 0.07, 1.23); tube.add(muzzle);
    // the steering wheel on its column (left-hand drive)
    const wheelS = new THREE.Group(); wheelS.name = "steering"; wheelS.position.set(0.40, 1.30, 0.80); wheelS.rotation.set(-0.55, 0, 0); bodyG.add(wheelS);
    HK.meshes(wheelS, B.steerGeos, M, "steer", false);
    // the men, each drawn only while his seat is filled
    const fig = function (kind, k) { const m = new THREE.Mesh(figure(kind, (seed * 7 + k) % 15), own["tk:vc"]); m.castShadow = kind === "stand" || kind === "rail"; return m; };
    const driver = fig("seat", 0); driver.position.set(0.40, 0.97, 0.36); bodyG.add(driver);
    const cmdr = fig("seat", 1); cmdr.position.set(-0.40, 0.97, 0.36); bodyG.add(cmdr);
    const loader = fig("kneel", 2); loader.position.set(0.50, FLOOR + 0.52, -0.66); loader.rotation.y = -0.5; bodyG.add(loader);
    const p1 = fig("rail", 3); p1.position.set(0.78, 1.40, -2.28); p1.rotation.y = PI / 2; bodyG.add(p1);
    const p2 = fig("rail", 4); p2.position.set(-0.78, 1.40, -2.05); p2.rotation.y = -PI / 2; bodyG.add(p2);
    const gunner = fig("stand", 5); gunner.position.set(0, HIPS.y, HIPS.z); turret.add(gunner);
    // the four wheels, one instanced draw per part
    const wheels = [
      { x: TRK, y: R, z: AXF, r: R, steer: 1 }, { x: -TRK, y: R, z: AXF, r: R, steer: 1 },
      { x: TRK, y: R, z: AXR, r: R, steer: 0 }, { x: -TRK, y: R, z: AXR, r: R, steer: 0 },
    ];
    const WS = HK.wheelSet(root, B.tyreGeo, B.rimGeos, M, 4, [-TRK - TW, 0, AXR - R, TRK + TW, 2 * R, AXF + R]);
    const rig = new HK.WheeledRig({
      root: root, body: bodyG, wheels: wheels, tyreIM: WS.tyreIM, rimIMs: WS.rimIMs, wheelbase: AXF - AXR, track: 2 * TRK,
      travel: [0.11, 0.13], turret: turret, gun: gun, tube: tube, muzzle: muzzle, shield: shield,
      tcfg: TURRET,
      figs: { driver: driver, commander: cmdr, loader: loader, passenger: [p1, p2] },
      gunner: { obj: gunner, seat: "gunner", calm: HIPS.y + 0.03, fight: HIPS.y - 0.04 },
      exhaust: { p: [-0.60, 0.42, -2.62], d: [-0.1, -0.15, -1], soot: 0.6 },
      engine: [0, 1.05, 1.95], cabin: [0, 1.35, 0.40], ground: ground, side: side, seed: seed,
      pitchK: 0.011, rollK: 0.008,
      // the nation's flag, painted on both doors and the tailgate
      decal: { parent: bodyG, cache: B.decals, list: [[0.897, 0.84, 0.66, 1, 0, 0.36], [-0.897, 0.84, 0.66, -1, 0, 0.36], [0, 0.96, -2.652, 0, -1, 0.40]] },
    });
    dress(rig, { fi: fi, ammo: ammo, wheelS: wheelS, bodyG: bodyG, turret: turret });
    rig.mark(ctx.nation, ground, side);
    return { group: root, rig: rig, footW: Wd, footL: L, height: 2.62 };
  }

  /* THE RIG'S OWN LOOK, on top of the hull kit's WheeledRig: the militia
     paint follows the side, the DShK's muzzle blast and belt changes, the
     windscreen cracking, the burn-out and the brew-up. */
  function dress(rig, o) {
    const HK = CBZ.hullKit;
    rig.tk = o;
    rig.reloading = 0;
    rig.holes = 0;
    const mark0 = rig.mark, aim0 = rig.aimTurret, wreck0 = rig.wrecked, dmg0 = rig.damage;
    rig.mark = function (nation, ground, side) {
      mark0.call(this, nation, ground, side);
      if (this.charred) return;
      const pm = paintMat(o.fi, this.schemeId || "tan");
      this.root.traverse(function (m) { if (m.userData && m.userData.hkKey === "tk:paint") m.material = pm; });
    };
    // every round: the gun kicks, the brake throws its blast out to the sides
    rig.fire = function (shot) {
      this.fired(0.45);
      const w = shot && shot.w;
      if (w && w.salvo && ((shot.n + 1) % w.salvo) === 0) this.reloading = w.reload || 9;
      if (!this.muzzle || !this.root.parent || !this.glow) return;
      const e = this.muzzle.matrixWorld.elements, p = this._p;
      p.setFromMatrixPosition(this.muzzle.matrixWorld);
      for (let s = -1; s <= 1; s += 2) {
        this.glow.emit(p.x, p.y, p.z, e[0] * s * 3, e[1] * s * 3 + 0.3, e[2] * s * 3, 0.05, 0.35, 0.7, 0.8, FLASH, 0, 0);
        this.smoke.emit(p.x, p.y, p.z, e[0] * s * 2.5, e[1] * s * 2.5 + 0.5, e[2] * s * 2.5, 1.0 + Math.random() * 0.6, 0.3, 1.5, 0.22, GAS, -0.02, 2.2);
      }
    };
    // a belt change: the muzzle goes up, the feed cover opens, the box comes off
    rig.aimTurret = function (rel, el, dt) { aim0.call(this, rel, this.reloading > 0 ? 0.42 : el, dt); };
    rig.damage = function (vs, res) {
      dmg0.call(this, vs, res);
      if (res && res.pen && res.zone !== "top" && !this.cracked) {
        this.holes++;
        if (this.holes >= 3) {
          this.cracked = true;
          const cm = ownMats().crack;
          this.root.traverse(function (m) { if (m.userData && m.userData.hkKey === "glass") m.material = cm; });
        }
      }
    };
    rig.wrecked = function (dt, u) {
      wreck0.call(this, dt, u);
      if (this.dead && !this.toppled) {
        this.toppled = true;
        o.ammo.visible = !this.cat;
        if (this.cat) {
          // the brew-up: the pedestal bends over, the gun hangs off the side
          o.turret.rotation.z = 0.62; o.turret.rotation.x = 0.3; o.turret.position.y = PIV - 0.48;
        }
      }
      if (!this.charred && (this.burnt || 0) > 16) {
        this.charred = true;
        const bm = ownMats()["tk:burnt"];
        this.root.traverse(function (m) {
          const k = m.userData && m.userData.hkKey;
          if (k === "tk:paint" || k === "tk:vc") m.material = bm;
          else if (k === "glass" || k === "canvas" || k === "lamp" || k === "amber" || k === "tail") m.visible = false;
        });
        if (this.decal && this.decal.mesh) this.decal.mesh.visible = false;
      }
    };
    // the per-step extras (alive): the steering wheel, the belt change
    rig.tick = function (dt, c) {
      if (o.wheelS) o.wheelS.rotation.z += ((c && c.steer ? -c.steer * 2.6 : 0) - o.wheelS.rotation.z) * Math.min(1, dt * 8);
      if (this.reloading > 0) {
        const r0 = this.reloading;
        this.reloading = Math.max(0, r0 - dt);
        const full = 9;
        o.ammo.visible = !(this.reloading < full * 0.85 && this.reloading > full * 0.35);
      } else if (!o.ammo.visible) o.ammo.visible = true;
    };
    return rig;
  }
  const FLASH = [1, 0.62, 0.25], GAS = [0.48, 0.46, 0.42];

  const TURRET = { rate: 1.8, elevRate: 1.6, elevMin: -0.17, elevMax: 1.15 };

  CBZ.unitKit.register("technical", {
    kind: "vehicle",
    domain: "ground",
    drive: "wheeled",
    // Hilux 4x4 single cab: 1,690 kg kerb + gun, pedestal, plate, 4 men, ammunition
    stats: { hp: 220, mass: 2450, speed: 30, reverse: 7, accel: 2.5, turn: 0.8, wheelbase: AXF - AXR, maxSteer: 0.46, grip: 0.72,
      length: L, width: Wd, height: 2.62,
      armour: { front: 1, side: 0, rear: 0, top: 0 }, standoff: 650, dismountAt: 760 },
    turret: TURRET,
    // seat positions in hull space: the crew-casualty line is measured to these
    crew: [
      { seat: "driver", pos: [0.40, 1.35, 0.40] },
      { seat: "gunner", pos: [0, 1.95, -2.10] },
      { seat: "commander", pos: [-0.40, 1.35, 0.40] },
      { seat: "loader", pos: [0.50, 1.40, -0.66] },
    ],
    passengers: 2,
    passengerPos: [[0.78, 1.55, -2.28], [-0.78, 1.55, -2.05]],
    weapons: [
      // DShKM 12.7x108: ~600 rds/min cyclic in short bursts, 50-round belts
      // (a box change every 50), the assistant feeds them (needs: loader)
      { id: "dshk", seat: "gunner", kind: "mg", wid: "lmg", turret: true, rof: 10, burst: 7, pause: 1.4, dmg: 36, pen: 22,
        range: 1500, ammo: 600, salvo: 50, reload: 9, needs: "loader" },
    ],
    tactics: {
      role: "fire support truck (irregular)",
      engage: { soft: 1500, armour: 0, air: 1200, close: 25 },     // 12.7 for men, soft-skins and helicopters; never a tank
      priorities: ["mg", "launcher", "men", "vehicle", "air", "beast"],
      keepFrom: { men: 450, launcher: 500, armour: 2200 },         // outrange the rifles, never inside an RPG's reach
      hullDown: true,                                               // a crest between it and them: only the gun shows
      faceThreat: false,                                            // the gun traverses; the truck stays pointed out of trouble
      reverseOut: false, shootAndScoot: { bursts: 4, move: 40 },    // a few bursts, then drive to the next spot
      screen: null,                                                 // it does not escort anyone: it supports from behind
      withdrawAt: 0.5,                                              // half its structure gone, it leaves
    },
    // a player's ATTACK in this truck works the one gun it has
    moves: function () { return "dshk"; },
    animate: function (veh, dt, c) {
      const H = CBZ.hullKit;
      if (H) H.animate(veh, dt, c); else if (c && c.shared) c.shared(dt);
      const r = veh && veh.rig;
      if (r && r.tick && !(c && c.dead)) r.tick(dt, c);
    },
    build: build,
  });
})();
