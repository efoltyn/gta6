/* ============================================================
   weapons/appearances/bazooka.js — the RPG-7, loaded with a PG-7V.

   OWNER: "the RPG ammunition is not very real". The old model was a fat
   1.7-unit pipe (a 110 mm tube at this file's scale) with a pencil warhead
   stacked out of flat cylinders, a tan box for a shoulder pad and a
   forward grip nothing like the real launcher.

   THIS IS THE REAL ANATOMY, authored at the gun kit's scale (S = 2 model
   units per real metre, sidearm.js GUN_K, so the one firing hand fits it):
     · a slim steel tube, 40 mm bore, 950 mm long muzzle to venturi lip;
     · two varnished wooden heat shields around the middle, the front one
       ahead of the trigger group (the support hand lives on it) and the
       rear one where the tube sits on the shoulder;
     · the raked pistol grip + trigger guard under the front third, and the
       plain second grip behind it;
     · the flared rear venturi (a real shell of revolution, open bell);
     · the trigger housing welded under the tube, the guard a pressed loop
       with a real finger hole, a curved trigger blade;
     · the PGO-7 on the LEFT: a chamfered OD body with its hooded objective,
       rubber eyecup, range drum and lamp cap, clamped to a dovetail block on
       a bracket plate welded to the tube's flank;
     · the folding irons on top: a post on a clamp band near the muzzle and
       a U-notch leaf above the trigger group, tall enough that the sight
       line clears the PG-7V's bulb;
     · the PG-7V seated in the muzzle: the 85 mm bulb is WIDER than the
       tube, an ogive cone runs to the piezo fuze tip, and the sustainer
       neck disappears into the muzzle. (The folding tail fins ride the
       sustainer, which is inside the tube until it flies: fpsmode draws
       them on the round in flight.)

   The warhead is its own group, g.userData.warhead, so fpsmode can take it
   away when the rocket leaves and put it back when the reload seats a new
   one. CBZ.rpgRound exports the one PG-7V profile so the round in flight
   (fpsmode) and the round in the off hand (gunhands) are this same shape.

   Geometry: every lathe/tube built once per module and marked _shared;
   finishes cached on the caller's material table (gunKit's rule).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  CBZ.weaponAppearance = CBZ.weaponAppearance || {};

  const S = 2.0;                 // model units per real metre (gun-kit scale)
  const BY = 0.05;               // bore axis height (unchanged: the FP framing rides it)
  const TUBE_R = 0.025 * S;      // 50 mm outer tube
  const BORE_R = 0.020 * S;      // 40 mm bore
  const MUZZLE_Z = -0.36 * S;    // the muzzle, 36 cm ahead of the pistol grip
  const TAIL_Z = 0.50 * S;       // tube end, where the venturi starts
  const BELL_LEN = 0.09 * S;     // the venturi flare (tube + bell = 0.95 m)
  const WOOD_R = 0.037 * S;
  const WOOD_F = [-0.23 * S, -0.05 * S];   // front heat shield (z from, to)
  const WOOD_R2 = [0.06 * S, 0.30 * S];    // rear heat shield

  /* ---- the PG-7V, in REAL metres, measured from the sustainer neck at the
     muzzle (y=0) to the fuze tip (y=0.40). [radius, y] ascending, so a
     LatheGeometry faces outward. 85 mm bulb, 40 mm neck. */
  const WARHEAD = [
    [0.000, 0.000], [0.0195, 0.000], [0.0200, 0.030],   // sustainer neck (enters the tube)
    [0.0270, 0.055], [0.0380, 0.090], [0.0425, 0.110],  // rear ogive up to the bulb
    [0.0425, 0.205],                                    // the bulb
    [0.0400, 0.235], [0.0320, 0.285], [0.0215, 0.335],  // the nose cone (slight ogive)
    [0.0120, 0.370], [0.0090, 0.378],
    [0.0065, 0.380], [0.0065, 0.396], [0.0040, 0.400], [0.000, 0.400],   // piezo fuze cap
  ];
  /* the full round in flight: the warhead plus the sustainer motor tube and
     its nozzle (the booster falls away at the muzzle). Nose at y=0, tail -Y. */
  const MOTOR = [
    [0.000, -0.900], [0.0120, -0.900], [0.0215, -0.890], [0.0200, -0.870],   // nozzle
    [0.0195, -0.600], [0.0195, -0.400],                                       // sustainer tube
  ];

  const GEO = new Map();
  function cached(key, make) {
    let g = GEO.get(key);
    if (!g) { g = make(); g._shared = true; GEO.set(key, g); }
    return g;
  }
  function lathe(THREE, key, pts, scale, segs) {
    return cached(key, function () {
      const v = pts.map(function (p) { return new THREE.Vector2(p[0] * scale, p[1] * scale); });
      const g = new THREE.LatheGeometry(v, segs || 16);
      g.computeVertexNormals();
      return g;
    });
  }

  function paint(ctx, key, make) {
    const m = ctx.mat;
    if (!m[key]) { m[key] = make(ctx.THREE); m[key]._shared = true; }
    return m[key];
  }
  function mats(ctx) {
    return {
      steel: paint(ctx, "rpg_steel", (T) => new T.MeshPhongMaterial({ color: 0x2b2f33, shininess: 22, specular: 0x3a4046 })),
      edge: paint(ctx, "rpg_edge", (T) => new T.MeshPhongMaterial({ color: 0x5b6168, shininess: 40, specular: 0x5c636b })),
      wood: paint(ctx, "rpg_wood", (T) => new T.MeshPhongMaterial({ color: 0x9a5426, shininess: 26, specular: 0x4a2a12 })),
      od: paint(ctx, "rpg_od", (T) => new T.MeshPhongMaterial({ color: 0x4d5337, shininess: 10, specular: 0x1f2218 })),
      band: paint(ctx, "rpg_band", (T) => new T.MeshLambertMaterial({ color: 0x15170f })),
      fuze: paint(ctx, "rpg_fuze", (T) => new T.MeshPhongMaterial({ color: 0xa8a492, shininess: 50, specular: 0x8a8778 })),
      black: paint(ctx, "rpg_black", (T) => new T.MeshLambertMaterial({ color: 0x0b0c0d })),
      lens: paint(ctx, "rpg_lens", (T) => new T.MeshPhongMaterial({ color: 0x1d2a33, shininess: 80, specular: 0x8fb4cc })),
    };
  }

  // a mesh through the caller's helper (its shadow/display policy), then the
  // cached geometry swapped in — the gunKit's place() trick
  function place(ctx, parent, geo, material, x, y, z, rx, ry, rz) {
    const m = ctx.box(parent, 1, 1, 1, material, x, y, z, rx, ry, rz);
    if (m) m.geometry = geo;
    return m;
  }

  /* the seated PG-7V as a group: origin at the muzzle (the neck's tail),
     nose toward -Z. Used for the launcher's round and the reload's round. */
  function buildWarhead(ctx, M) {
    const THREE = ctx.THREE;
    const w = new THREE.Group();
    w.name = "pg7v";
    const body = lathe(THREE, "pg7v:body", WARHEAD, S, 18);
    place(ctx, w, body, M.od, 0, 0, 0, -Math.PI / 2);
    // the stencilled band at the back of the bulb and the fuze cap in bare metal
    place(ctx, w, cached("pg7v:band", function () {
      const g = new THREE.CylinderGeometry(0.0428 * S, 0.0428 * S, 0.012 * S, 18, 1, true);
      g.rotateX(-Math.PI / 2); return g;
    }), M.band, 0, 0, -0.118 * S);
    place(ctx, w, cached("pg7v:fuze", function () {
      const g = new THREE.CylinderGeometry(0.0045 * S, 0.0068 * S, 0.022 * S, 10);
      g.rotateX(-Math.PI / 2); return g;
    }), M.fuze, 0, 0, -0.389 * S);
    return w;
  }

  CBZ.weaponAppearance.bazooka = function (ctx) {
    const { THREE, box, cyl, mat } = ctx;
    const K = CBZ.gunKit(ctx);   // sidearm.js (the appearances index) loads first on every page
    const M = mats(ctx);
    const g = new THREE.Group();

    // ---- the tube: steel, 50 mm, muzzle ring, bore -------------------------
    const tubeLen = TAIL_Z - MUZZLE_Z;
    place(ctx, g, cached("rpg:tube", function () {
      const t = new THREE.CylinderGeometry(TUBE_R, TUBE_R, tubeLen, 16, 1, true);
      t.rotateX(-Math.PI / 2); return t;
    }), M.steel, 0, BY, (MUZZLE_Z + TAIL_Z) / 2).name = "rpg:tube";
    // muzzle ring: a thickened lip you can see around the warhead's neck
    place(ctx, g, cached("rpg:muzzleRing", function () {
      const t = new THREE.CylinderGeometry(TUBE_R * 1.10, TUBE_R * 1.10, 0.03 * S, 16);
      t.rotateX(-Math.PI / 2); return t;
    }), M.edge, 0, BY, MUZZLE_Z + 0.015 * S);
    const bore = cyl(g, BORE_R, 0.004, mat.bore || mat.black, 0, BY, MUZZLE_Z + 0.012, Math.PI / 2);
    if (bore) bore.userData.weaponBore = true;

    // ---- the rear venturi: a real flared bell, open at the back ------------
    const bell = [
      [TUBE_R / S, 0.000], [0.0265, 0.020], [0.0330, 0.050], [0.0460, 0.080], [0.0500, 0.090],
      [0.0460, 0.090], [0.0300, 0.060], [0.0220, 0.030], [BORE_R / S, 0.000],
    ];
    place(ctx, g, lathe(THREE, "rpg:bell", bell, S, 18), M.steel, 0, BY, TAIL_Z, Math.PI / 2).name = "rpg:venturi";
    cyl(g, BORE_R, 0.004, mat.bore || mat.black, 0, BY, TAIL_Z + 0.004, Math.PI / 2);   // the throat seen from behind

    // ---- the two wooden heat shields, clamped with steel bands ------------
    function woodSleeve(z0, z1) {
      const L = (z1 - z0) / S, R = WOOD_R / S, r = TUBE_R / S;
      const pts = [[r, 0], [R - 0.004, 0.006], [R, 0.018], [R, L - 0.018], [R - 0.004, L - 0.006], [r, L]];
      const m = place(ctx, g, lathe(THREE, "rpg:wood:" + L.toFixed(3), pts, S, 18), M.wood, 0, BY, z1, -Math.PI / 2);
      for (const bz of [z0 + 0.012 * S, z1 - 0.012 * S]) {
        place(ctx, g, cached("rpg:clamp", function () {
          const t = new THREE.CylinderGeometry(WOOD_R + 0.003, WOOD_R + 0.003, 0.010 * S, 18, 1, true);
          t.rotateX(-Math.PI / 2); return t;
        }), M.steel, 0, BY, bz);
      }
      return m;
    }
    const frontWood = woodSleeve(WOOD_F[0], WOOD_F[1]);
    if (frontWood) frontWood.name = "rpg:frontWood";
    const rearWood = woodSleeve(WOOD_R2[0], WOOD_R2[1]);
    if (rearWood) rearWood.name = "rpg:rearWood";

    // ---- trigger group -----------------------------------------------------
    // The trigger mechanism housing welded under the tube: one side profile,
    // chamfered at both ends, its belly flat where the grip and guard hang.
    const tubeBot = BY - TUBE_R;                        // 0.000
    K.prof(g, "rpg.housing", [
      [-0.064, 0.012], [0.180, 0.012], [0.188, -0.004], [0.170, -0.024], [0.120, -0.034],
      [-0.030, -0.034], [-0.052, -0.022], [-0.066, 0.000],
    ], 0.046, M.steel, { bevel: 0.004 }).name = "rpg:housing";
    // the raked pistol grip (black bakelite, finger swells)
    const R = 0.26;
    K.prof(g, "rpg.grip", K.grip(0.050, tubeBot - 0.032, 0.100, 0.215, R, { swellF: 0.006, swellB: 0.008, grooves: 3 }),
      0.066, M.black, { bevel: 0.007 }).name = "rpg:pistolGrip";
    // the guard: a pressed steel loop from the housing's nose round the
    // trigger to the grip's front strap, a real hole for the finger
    K.prof(g, "rpg.guard2", [
      [0.040, -0.030], [0.170, -0.030], [0.150, -0.100], [0.128, -0.136], [0.024, -0.136], [0.020, -0.118], [0.034, -0.080],
    ], 0.016, M.steel, { bevel: 0.003,
      holes: [[[0.060, -0.036], [0.152, -0.036], [0.136, -0.098], [0.118, -0.122], [0.040, -0.122], [0.040, -0.090]]] });
    // the trigger: a curved blade hung from the housing
    K.prof(g, "rpg.trigger", [
      [0.084, -0.034], [0.098, -0.034], [0.101, -0.060], [0.095, -0.090], [0.083, -0.100], [0.088, -0.086], [0.090, -0.060],
    ], 0.010, M.edge, { bevel: 0.002 });

    // ---- the second (rear) grip under the rear heat shield ---------------
    const REAR_Z = 0.26;                                 // grip centre, model z
    K.prof(g, "rpg.rear", K.grip(-REAR_Z + 0.042, BY - WOOD_R + 0.004, 0.084, 0.180, 0.12, { swellF: 0.004, swellB: 0.004 }),
      0.060, M.black, { bevel: 0.006 }).name = "rpg:rearGrip";

    // ---- PGO-7 on its bracket, on the LEFT (-x) ---------------------------
    // the sight bracket: a plate welded along the tube's left flank, and the
    // dovetail block the scope's clamp rides, bridging out under the body
    K.prof(g, "rpg.bracket", [[-0.050, 0.036], [0.072, 0.036], [0.062, 0.128], [-0.040, 0.128]],
      0.012, M.steel, { bevel: 0.002, x: -TUBE_R - 0.005 });
    // front profile along the barrel (axis "z" mirrors x: authored +x = left)
    K.prof(g, "rpg.dovetail", [[0.052, 0.098], [0.064, 0.098], [0.076, 0.120], [0.134, 0.120], [0.134, 0.138], [0.052, 0.138]],
      0.100, M.steel, { axis: "z", bevel: 0.003, z: -0.010 });
    // the scope body: a chamfered housing, sloped where the reticle prism sits
    const SX = -TUBE_R - 0.058, SY = BY + 0.126;
    K.prof(g, "rpg.pgo", [
      [-0.120, -0.040], [0.110, -0.040], [0.124, -0.026], [0.124, 0.030], [0.100, 0.040], [-0.090, 0.040], [-0.120, 0.024],
    ], 0.058, M.od, { bevel: 0.006, x: SX, y: SY }).name = "rpg:scope";
    // objective with its sun hood and recessed glass; rubber eyecup behind
    place(ctx, g, lathe(THREE, "rpg:pgoObj", [
      [0.020, 0], [0.029, 0.006], [0.029, 0.048], [0.033, 0.054], [0.033, 0.070], [0.029, 0.070], [0.027, 0.060], [0, 0.060],
    ], 1, 16), M.steel, SX, SY + 0.004, -0.118, -Math.PI / 2);
    cyl(g, 0.026, 0.002, M.lens, SX, SY + 0.004, -0.179, Math.PI / 2);                   // objective glass
    place(ctx, g, lathe(THREE, "rpg:pgoEye", [
      [0.018, 0], [0.025, 0.004], [0.025, 0.030], [0.029, 0.040], [0.035, 0.058], [0.032, 0.060], [0.023, 0.046], [0, 0.046],
    ], 1, 16), M.black, SX, SY + 0.004, 0.118, Math.PI / 2);
    // range drum on top, the reticle lamp's battery cap on the left flank
    K.lathe(g, "rpg.drum", [[0.017, 0], [0.017, 0.014], [0.014, 0.020], [0, 0.020]], 12, M.steel, SX, SY + 0.040, -0.030, { axis: "y" });
    K.lathe(g, "rpg.lamp", [[0.012, 0], [0.012, 0.018], [0.009, 0.024], [0, 0.024]], 12, M.steel, SX - 0.029, SY - 0.004, 0.040,
      { axis: "y", rz: Math.PI / 2 });

    // ---- folding iron sights on top ---------------------------------------
    // front: a clamp band round the tube, its block, and the folding post
    // standing up (its tip is what the eye lays on the target); tall enough
    // that the sight line clears the PG-7V's bulb
    const FZ = MUZZLE_Z + 0.10;
    place(ctx, g, lathe(THREE, "rpg:fsBand", [[TUBE_R + 0.001, 0], [TUBE_R + 0.005, 0.003], [TUBE_R + 0.005, 0.027], [TUBE_R + 0.001, 0.030]], 1, 16),
      M.steel, 0, BY, FZ + 0.015, -Math.PI / 2);
    K.prof(g, "rpg.fsBlock", [[-FZ - 0.020, 0.094], [-FZ + 0.020, 0.094], [-FZ + 0.016, 0.108], [-FZ - 0.016, 0.108]],
      0.020, M.steel, { bevel: 0.002 });
    K.prof(g, "rpg.fsPost", [[-FZ - 0.010, 0.104], [-FZ + 0.012, 0.104], [-FZ + 0.004, 0.118], [-FZ + 0.002, 0.160],
      [-FZ - 0.004, 0.160], [-FZ - 0.006, 0.118]], 0.008, M.steel, { bevel: 0.001 });
    // rear: the base on the tube above the trigger group, and the folding
    // leaf standing on it with its U-notch
    const RZ = -0.070;
    K.prof(g, "rpg.rsBase", [[-RZ - 0.030, 0.096], [-RZ + 0.030, 0.096], [-RZ + 0.030, 0.106], [-RZ - 0.024, 0.110], [-RZ - 0.030, 0.106]],
      0.028, M.steel, { bevel: 0.002 });
    K.prof(g, "rpg.rsLeaf", [[-0.017, 0], [0.017, 0], [0.017, 0.060], [0.005, 0.060], [0.003, 0.054], [-0.003, 0.054],
      [-0.005, 0.060], [-0.017, 0.060]], 0.006, M.steel, { axis: "z", bevel: 0.001, y: 0.104, z: RZ });

    // ---- the round, seated ------------------------------------------------
    const warhead = buildWarhead(ctx, M);
    warhead.position.set(0, BY, MUZZLE_Z);
    g.add(warhead);
    g.userData.warhead = warhead;
    // A FRESH round for the reload to carry (first-person only: a body's own
    // hand carries its own copy, gunhands.js). Seated position, hidden.
    if (!ctx.noHand && !ctx.display && mat.skin) {
      const spare = buildWarhead(ctx, M);
      spare.position.copy(warhead.position);
      spare.visible = false;
      g.add(spare);
      g.userData.reloadWarhead = spare;
    }

    // ---- the firing hand on the pistol grip -------------------------------
    // top centre of the grip: front strap at z=-0.050, back at +0.050
    K.hand(g, { at: [tubeBot - 0.032, 0.000], rake: R, gripW: 0.066, gripD: 0.100, trigger: [tubeBot - 0.068, -0.092] });

    // The projectile leaves from the fuze tip — the round that flies IS the
    // round that was seated.
    g.userData.muzzle = new THREE.Vector3(0, BY, MUZZLE_Z - 0.400 * S);
    g.userData.muzzleTube = new THREE.Vector3(0, BY, MUZZLE_Z);   // the tube's mouth (backblast/flash geometry)
    g.userData.venturi = new THREE.Vector3(0, BY, TAIL_Z + BELL_LEN);
    // where the tube rests on the shoulder: on the rear heat shield. The rig
    // (CBZ.gunHold.stockZ) seats THIS in the shoulder pocket, not the venturi
    // half a metre behind the man. It must stay past the 0.26 long-gun line
    // (below it the rig presents the tube like a pistol); 0.40 puts both
    // hands on their grips for every body (tools/gun-hold-check.mjs).
    g.userData.shoulderZ = WOOD_R2[0] + 0.28;
    g.userData.unitsPerMetre = S;
    g.userData.rearGrip = new THREE.Vector3(0, BY - WOOD_R - 0.09, REAR_Z);
    // WHERE THE HANDS GO — see systems/gunhands.js. The support hand holds
    // the FRONT heat shield from underneath, the way the tube is really
    // carried on the right shoulder (the rear grip sits behind the firing
    // hand, under the shoulder, where the left hand cannot reach from the
    // front). The reload runs the off hand to the warhead's bulb at the muzzle.
    const woodMidZ = (WOOD_F[0] + WOOD_F[1]) / 2;
    g.userData.grips = {
      support: new THREE.Vector3(0, BY - WOOD_R, woodMidZ),
      // FP off hand (fpsmode.js fitOffHand): cupped under the round sleeve
      hold: { kind: "guard", y: BY, z: woodMidZ, w: WOOD_R * 2, h: WOOD_R * 2, rc: WOOD_R * 0.95, len: WOOD_F[1] - WOOD_F[0] },
      mag: new THREE.Vector3(0, BY - 0.0425 * S - 0.010, MUZZLE_Z - 0.160 * S),   // under the bulb
      charge: null,
      style: "rocket",
    };
    /* THE ANCHORS (contract: sidearm.js), S = 2 units per real metre.
         grip     mid-palm on the trigger pistol grip, down its raked axis
         support  "tube": the off hand under the FRONT heat shield (where
                  grips.support/hold already put it; the second grip on this
                  launcher sits BEHIND the trigger grip, under the shoulder)
         mag      the loaded PG-7V: its bulb centre, `well` the tube's mouth
                  it seats in (+Y from the round back into the tube)
         stock    the shoulder contact: the underside of the rear heat shield
                  at shoulderZ, where the tube rests on the shoulder
         sight    the PGO-7, the 2.7x optic this launcher is issued with and
                  weapon-data's row names: rear = the ocular glass at the
                  back of the eyecup, front = the objective glass; the eye
                  sits 7.5 cm behind the eyecup, left of the tube. (The
                  folding irons on top are the backup, not the sight line.) */
    const gTop = [(tubeBot - 0.032 + tubeBot - 0.032 + Math.sin(R) * 0.100) / 2, -(0.050 + 0.050 - Math.cos(R) * 0.100) / 2];
    const gAt = (t) => [0, gTop[0] - Math.cos(R) * t, gTop[1] + Math.sin(R) * t];
    K.anchors(g, {
      k: S,
      grip: { pos: gAt(0.090), rake: R },
      trigger: [0, tubeBot - 0.068, -0.097],
      support: { pos: [0, BY - WOOD_R, woodMidZ], kind: "tube", len: WOOD_F[1] - WOOD_F[0] },
      mag: { pos: [0, BY, MUZZLE_Z - 0.160 * S], well: [0, BY, MUZZLE_Z],
        quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)) },
      stock: [0, BY - WOOD_R, g.userData.shoulderZ],
      charge: null,
      sight: { rear: [SX, SY + 0.004, 0.118 + 0.046], front: [SX, SY + 0.004, -0.179], lensR: 0.023, eyeRelief: 0.075 },
      optic: { type: "scope", mag: 2.7 },
    });
    return g;
  };

  /* ---- the one PG-7V shape, for the round in flight and in the hand ----- */
  CBZ.rpgRound = {
    S: S,
    // warhead lathe points [r, y] real metres, neck at 0 → fuze tip at 0.40
    warheadProfile: function () { return WARHEAD.map(function (p) { return p.slice(); }); },
    // the full flying round: nose at y=0, nozzle at y=-0.90 (ascending y)
    flightProfile: function () {
      const out = MOTOR.map(function (p) { return p.slice(); });
      // warhead sits ahead of the motor: shift so the fuze tip lands at y=0
      for (let i = 2; i < WARHEAD.length; i++) out.push([WARHEAD[i][0], WARHEAD[i][1] - 0.40]);
      return out;
    },
    // seat offset of the warhead's bulb centre from its neck (model units)
    bulbZ: -0.160 * S,
    buildWarhead: function (ctx) { return buildWarhead(ctx, mats(ctx)); },
  };
})();
