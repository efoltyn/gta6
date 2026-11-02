/* ============================================================
   world/utility_lines.js — POWER POLES + REAL CATENARY WIRES (layer 2 of 5).

   The highest-value single cue in this whole dressing layer. Almost every
   photograph of a real street has wires crossing it, and until now the game
   had none anywhere. A wire is also the cheapest kind of realism: it is
   pure silhouette, so it costs a handful of triangles and reads instantly.

   WHAT IT BUILDS
     • Creosote poles down one kerb of every ordinary street (the side is
       chosen per-road by position hash, so a run stays on one side like a
       real utility easement) — outside the downtown core, because dense
       cores bury their services and the towers would swallow the poles.
     • Pole-top hardware: a crossarm, glass insulators, a comms bracket,
       climbing steps.
     • Pole-mounted transformer cans on a fraction of poles, plus green
       ground-pad transformers and grey utility cabinets on the pavement.
     • CATENARY-SAGGING conductors between consecutive poles. Real sag, a
       parabola with ~4.5% of span droop — not the straight lines that make
       a "wires" feature look like a wireframe.
     • Guy wires: an anchored diagonal at the end of each run and at bends,
       which is exactly where a real pole needs one.
     • Cobra-head mast arms on a third of poles, registered into the
       existing dusk-lighting driver (city/props.js's city._nightLamps) so
       they light with every other street lamp instead of sitting dead.

   DRAW-CALL BUDGET
     poles 1 · transformers 1 · pad transformers 1 · cabinets 1 ·
     mast arms 1 · lamp heads 1 · ALL wires in the world 1  =  7 draws.

   Determinism: every choice is CBZ.hash01 of the pole's position. No rng.
   Flag: CBZ.CONFIG.DETAIL_UTILITY_LINES (see world/detail_kit.js).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.detailKit) return;
  const THREE = window.THREE;
  const DK = CBZ.detailKit;

  // STREET_WIRES_V2 (owner, with a screenshot: "lightposts all suck, don't
  // connect and have bad physics"). The conductors now hang off the hardware
  // they are supposed to hang off, because both come out of ONE table. One line
  // back to the old independent-endpoints pass.
  if (CBZ.CONFIG.STREET_WIRES_V2 == null) CBZ.CONFIG.STREET_WIRES_V2 = true;

  // ---- authored dimensions (metres) ------------------------------------
  // A 40 ft class-4 distribution pole set 1.8 m in the ground: 9.4 m showing.
  const POLE_H = 9.4;          // butt (ground line) to top
  const POLE_R_TOP = 0.135, POLE_R_BUTT = 0.205;
  const ARM_Y = 8.45;          // crossarm centre height
  const ARM_SPAN = 2.44;       // an 8 ft crossarm
  const ARM_W = 0.09, ARM_H = 0.115;   // 3.5 x 4.5 in timber
  const INSUL_Y = ARM_Y + 0.28;
  const COMMS_Y = 6.35;
  const LAMP_Y = 7.25;         // cobra mast root: under the primary, over the comms
  const CAN_Y = 7.0;           // pole-mounted transformer, centre of the tank
  const SPACING = 31;          // pole pitch down a run
  const SAG = 0.048;           // conductor droop at the DESIGN span, as a fraction
  const WIRE_R = 0.036;
  const CORE_CLEAR = 62;       // no poles inside this radius of city centre
  const MIN_CLEAR = 5.5;       // a conductor never dips closer than this to the ground

  const WOOD = 0x5e5040, WOOD_D = 0x4a3d2e, WOOD_B = 0x3a3027, GLASS = 0x86a8ab, STEEL = 0x8c9298;
  const PORC = 0xb9b6ad, GALV = 0x9da3a6, GALV_D = 0x7a8084, COPPER = 0x8a5a3a;
  const CAN = 0x9aa1a6, PAD_GREEN = 0x3f5a44, CAB_GREY = 0x9ba1a4, WIRE_C = 0x14161a;
  const GUARD_Y = 0xd8c23a;    // the high-vis sleeve on the bottom of a guy

  // the shaft's real radius at a height (it tapers butt -> top)
  function rAt(h) { return POLE_R_BUTT + (POLE_R_TOP - POLE_R_BUTT) * (h / POLE_H); }
  // The crossarm is bolted to the FACE of the pole, not run through its axis:
  // its centre sits one half-thickness off the timber surface on local -Z.
  const ARM_Z = -(rAt(ARM_Y) + ARM_W / 2);

  // =====================================================================
  //  THE ONE TABLE — where a wire may LAND on this pole.
  // =====================================================================
  //  This is the whole fix. Before, the crossarm was drawn from these numbers
  //  and the conductor's endpoint was RE-TYPED further down as a world-axis
  //  offset — which knew nothing about the pole's per-instance yaw jitter
  //  (+-0.06 rad) or its lean (+-0.022 rad in two axes). A 0.022 rad lean at
  //  8.7 m is 0.19 m of displacement against an 0.11 m insulator, so the wire
  //  hung in the air BESIDE the pin it was supposed to sit in — exactly what
  //  the owner photographed. Nothing here nudges a constant: the endpoint is
  //  now the insulator, pushed through the pole's own instance matrix.
  //
  //  The framing is the standard US three-phase tangent: two phases on pin
  //  insulators near the crossarm ends, the third on a POLE-TOP PIN above the
  //  timber. (The old table put the centre pin at x=0 on an arm through the
  //  pole's axis, i.e. inside the pole.)
  const ARM_X = ARM_SPAN / 2 - 0.2;
  const ARM_TOP = ARM_Y + ARM_H / 2;
  const PIN_TOP_Y = POLE_H + 0.16;                 // pole-top bracket's seat
  const ATTACH = {
    phase: [
      { x: -ARM_X, y: INSUL_Y + 0.015, z: ARM_Z },
      { x: 0, y: PIN_TOP_Y + 0.215, z: 0 },
      { x: ARM_X, y: INSUL_Y + 0.015, z: ARM_Z },
    ],
    // The comms bundle hangs off the BRACKET at local x=0.34. It used to be
    // drawn from the pole's AXIS, i.e. straight through the timber.
    comms: { x: 0.34, y: COMMS_Y + 0.10, z: 0 },
    // A guy leaves the pole at its SURFACE just under the crossarm, on the
    // side away from the pull. The radius is the shaft's real taper at that
    // height, not a guess.
    guyY: ARM_Y - 0.35,
    guyR: rAt(ARM_Y - 0.35),
  };

  // =====================================================================
  //  PROTOTYPES
  // =====================================================================
  // A porcelain PIN INSULATOR, base at y0: the steel pin's thread collar, a
  // three-shed skirt, the crown with the conductor groove (whose height is
  // the attach table's +0.215 above the seat), the tie on top.
  function pinInsulator(p, x, y0, z, col) {
    p.box(0.03, 0.05, 0.03, GALV_D, x, y0 + 0.025, z);
    p.lathe([[0.0, 0.04], [0.07, 0.075], [0.046, 0.11], [0.06, 0.15], [0.034, 0.195],
      [0.044, 0.215], [0.0, 0.245]], 6, col, x, y0, z);
  }
  function poleProto() {
    const p = DK.proto();
    // The shaft tapers like a real class-4 pole and weathers in bands: the
    // ground-line soak where the preservative bleeds, the long grey-brown
    // stick, the cut top with its sloped roof.
    const H1 = 1.6;
    p.cyl(rAt(H1), POLE_R_BUTT, H1, 12, WOOD_B, 0, H1 / 2, 0);
    p.cyl(POLE_R_TOP, rAt(H1), POLE_H - H1, 12, WOOD, 0, H1 + (POLE_H - H1) / 2, 0);
    p.cyl(POLE_R_TOP * 0.55, POLE_R_TOP, 0.05, 12, WOOD_D, 0, POLE_H + 0.025, 0);
    // ---- the crossarm on the pole face, through-bolted, two flat braces ---
    p.cbox(ARM_SPAN, ARM_H, ARM_W, 0.012, WOOD_D, 0, ARM_Y, ARM_Z);
    p.cyl(0.011, 0.011, 0.5, 6, GALV_D, 0, ARM_Y, ARM_Z * 0.5, Math.PI / 2, 0, 0);   // through-bolt
    p.cyl(0.035, 0.035, 0.012, 8, GALV, 0, ARM_Y, ARM_Z - ARM_W / 2 - 0.006, Math.PI / 2, 0, 0);  // its square washer
    for (let s = -1; s <= 1; s += 2) {
      // a flat steel V brace: crossarm underside at +-0.6 down to one lag
      // bolt on the pole face 0.6 m below the arm
      p.rod(s * 0.6, ARM_Y - ARM_H / 2, ARM_Z, 0, ARM_Y - 0.62, -rAt(ARM_Y - 0.62) - 0.01, 0.014, 4, GALV);
      p.cyl(0.02, 0.02, 0.016, 6, GALV_D, s * 0.6, ARM_Y - ARM_H / 2 - 0.01, ARM_Z);
    }
    p.cyl(0.026, 0.026, 0.03, 6, GALV_D, 0, ARM_Y - 0.62, -rAt(ARM_Y - 0.62) - 0.012, Math.PI / 2, 0, 0);
    // ---- the two arm phases on pin insulators, AT the attach table's x ----
    for (const i of [0, 2]) pinInsulator(p, ATTACH.phase[i].x, ARM_TOP, ATTACH.phase[i].z, PORC);
    // ---- the pole-top pin: a galvanised bracket lagged to the timber's
    // side, its seat over the axis, and the centre phase's insulator on it --
    p.box(0.05, 0.42, 0.012, GALV, 0, POLE_H - 0.06, rAt(POLE_H - 0.2) + 0.006);
    p.box(0.07, 0.012, rAt(POLE_H) + 0.07, GALV, 0, PIN_TOP_Y - 0.006, (rAt(POLE_H) + 0.07) / 2 - 0.035);
    pinInsulator(p, 0, PIN_TOP_Y, 0, PORC);
    // ---- comms/cable-TV standoff — its clamp is the comms attach ---------
    const rc = rAt(COMMS_Y);
    p.box(0.07, 0.16, 0.012, GALV, rc + 0.006, COMMS_Y, 0, 0, 0, 0);
    p.rod(rc, COMMS_Y, 0, ATTACH.comms.x, COMMS_Y, 0, 0.016, 5, GALV);
    p.cbox(0.07, 0.12, 0.07, 0.01, GALV_D, ATTACH.comms.x, COMMS_Y + 0.05, 0);
    // ---- the ground wire stapled down the -X face to the butt, under its
    // 2.4 m wooden U-guard, and the numbered aluminium pole tag ------------
    const gh = ARM_Y - 0.4;
    p.rod(-rAt(0) - 0.006, 0, 0, -rAt(gh) - 0.006, gh, 0, 0.006, 3, COPPER);
    p.box(0.022, 2.4, 0.05, WOOD_D, -rAt(1.2) - 0.012, 1.2, 0);
    p.box(0.004, 0.11, 0.075, 0xc4c8ca, 0, 1.75, rAt(1.75) + 0.002, 0, Math.PI / 2, 0);
    // ---- climbing steps: galvanised step bolts, alternate faces, every
    // 0.45 m from 2.7 m up to the comms, each turned up at its end ---------
    for (let k = 0; k < 7; k++) {
      const h = 2.7 + k * 0.5, s = k % 2 ? 1 : -1, r0 = rAt(h);
      p.box(0.02, 0.02, 0.19, GALV, 0, h, s * (r0 + 0.075));
      p.box(0.02, 0.05, 0.02, GALV, 0, h + 0.025, s * (r0 + 0.165));
    }
    return p.done();
  }

  // POLE-MOUNTED TRANSFORMER, authored in the POLE'S frame (origin at the
  // butt, the tank hung off local +X) so it takes the pole's exact instance
  // transform, lean and all, and can never float off the timber.
  function transformerProto() {
    const p = DK.proto();
    const R = 0.27, H = 0.86, cx = rAt(CAN_Y) + 0.07 + R, y = CAN_Y;
    // two hanger brackets lagged to the pole, the tank's lugs on them
    for (let s = -1; s <= 1; s += 2) {
      p.cbox(0.1, 0.06, 0.24, 0.008, GALV_D, rAt(y) + 0.03, y + s * 0.26, 0);
      p.box(cx - rAt(y) - R + 0.08, 0.05, 0.06, GALV_D, (rAt(y) + cx - R) / 2 + 0.02, y + s * 0.26, 0);
    }
    p.cyl(R, R, H, 16, CAN, cx, y, 0);
    p.cyl(R + 0.012, R + 0.012, 0.04, 16, 0x868d92, cx, y - H / 2 + 0.02, 0);         // bottom chime
    p.cyl(R + 0.018, R + 0.018, 0.045, 16, 0x868d92, cx, y + H / 2 - 0.01, 0);         // lid band
    p.lathe([[R + 0.012, 0], [R - 0.02, 0.05], [R * 0.6, 0.085], [0, 0.095]], 16, 0x8f969b, cx, y + H / 2 + 0.012, 0);
    // the HV bushing on the lid, its lead rising to the near arm phase, and
    // the three LV bushings on the street face
    pinInsulator(p, cx - 0.05, y + H / 2 + 0.06, 0, 0x6d5e4c);
    const A = ATTACH.phase[2];
    p.rod(cx - 0.05, y + H / 2 + 0.29, 0, A.x, A.y - 0.02, A.z, 0.008, 3, 0x2a2c2e);
    for (let k = -1; k <= 1; k++) {
      p.cyl(0.022, 0.026, 0.07, 8, 0x5a4b3c, cx + R + 0.03, y + 0.24, k * 0.11, 0, 0, Math.PI / 2);
    }
    p.box(0.004, 0.09, 0.07, 0x1d1f21, cx + R + 0.002, y + 0.02, 0);                   // kVA stencil plate
    p.box(0.004, 0.035, 0.18, 0xd8c23a, cx + R + 0.003, y - 0.1, 0);                   // hazard band
    return p.done();
  }

  // PAD-MOUNT TRANSFORMER on its concrete slab: the sloped-shoulder tank,
  // the double front doors with their penta-head bolt and hinges, the
  // radiator fins down the back, the yellow warning decal.
  function padTransformerProto() {
    const p = DK.proto();
    p.cbox(1.9, 0.16, 1.5, 0.03, 0x8d8d86, 0, 0.08, 0);                     // pad, chamfered
    p.cbox(1.5, 1.05, 1.1, 0.025, PAD_GREEN, 0, 0.16 + 0.525, 0);          // tank
    p.cbox(1.54, 0.12, 1.14, 0.045, 0x3a5340, 0, 1.24, 0);                 // sloped roof
    p.box(0.012, 0.92, 0.008, 0x2b3d31, 0, 0.68, 0.554);                   // door meeting seam
    for (let s = -1; s <= 1; s += 2) {
      p.box(0.69, 0.008, 0.008, 0x2b3d31, s * 0.37, 1.15, 0.554);          // door heads
      p.box(0.008, 0.92, 0.008, 0x2b3d31, s * 0.72, 0.68, 0.554);          // door jambs
      for (const hy of [0.4, 0.95]) p.cyl(0.018, 0.018, 0.09, 8, 0x33473a, s * 0.735, hy, 0.56);   // hinge barrels
    }
    p.cyl(0.035, 0.035, 0.03, 5, 0x9aa1a6, 0.08, 0.72, 0.565, Math.PI / 2, 0, 0);   // penta-head bolt
    p.cbox(0.05, 0.16, 0.035, 0.008, 0x2a3a2f, 0.08, 0.86, 0.57);                  // handle
    p.box(0.28, 0.16, 0.004, 0xd9c23a, -0.4, 0.98, 0.555);                         // WARNING decal
    p.box(0.26, 0.04, 0.005, 0x1b1c1e, -0.4, 1.02, 0.556);
    for (let k = 0; k < 7; k++) p.box(0.04, 0.82, 0.16, 0x37503d, -0.48 + k * 0.16, 0.66, -0.63);   // radiator fins
    p.box(1.1, 0.06, 0.1, 0x33473a, 0, 1.06, -0.6);
    p.box(1.1, 0.06, 0.1, 0x33473a, 0, 0.27, -0.6);
    return p.done();
  }

  // TELECOM / SIGNAL CABINET on its plinth: inset door with seams, three
  // hinge knuckles, the lock and handle, side louvres, a rain hood with a drip.
  function cabinetProto() {
    const p = DK.proto();
    p.cbox(0.72, 0.1, 0.46, 0.02, 0x6f6f68, 0, 0.05, 0);                  // plinth
    p.cbox(0.62, 1.12, 0.38, 0.018, CAB_GREY, 0, 0.66, 0);                // body
    p.cbox(0.68, 0.07, 0.44, 0.02, 0x8b9194, 0, 1.25, 0.005);             // rain hood
    p.box(0.66, 0.012, 0.012, 0x7a8083, 0, 1.21, 0.215);                  // drip edge
    // the door, proud by 6 mm, framed by its seam
    p.box(0.52, 0.96, 0.008, 0x8e9497, 0, 0.66, 0.194);
    p.box(0.535, 0.006, 0.006, 0x5e6366, 0, 1.145, 0.199);
    p.box(0.535, 0.006, 0.006, 0x5e6366, 0, 0.175, 0.199);
    for (let k = 0; k < 3; k++) p.cyl(0.011, 0.011, 0.07, 6, 0x6d7275, -0.27, 0.3 + k * 0.36, 0.2);
    p.cbox(0.04, 0.16, 0.03, 0.006, 0x4e5356, 0.2, 0.66, 0.208);         // handle
    p.cyl(0.014, 0.014, 0.012, 8, 0xb59a4a, 0.2, 0.78, 0.2, Math.PI / 2, 0, 0);   // lock
    p.box(0.16, 0.1, 0.004, 0xe3e0d6, -0.08, 0.98, 0.2);                  // ID label
    for (let s = -1; s <= 1; s += 2) for (let k = 0; k < 5; k++)
      p.box(0.006, 0.02, 0.24, 0x6f7578, s * 0.313, 0.9 + k * 0.045, 0, 0.35, 0, 0);   // louvres
    return p.done();
  }

  // The cobra mast runs on city/props.js's shared CBZ.lampMast solve, in ITS
  // frame: local +Z is the carriageway, and the head sits at the arm's TIP
  // because the same function hands back both. poleH:0 puts the prototype's
  // origin at the arm's root on the shaft, which is where arms.add places it.
  const MAST = (CBZ.lampMast ? CBZ.lampMast({ poleH: 0, reach: 2.05, rise: 0.42, poleR: 0.18 })
    : { armLen: 2.03, armRotX: 1.302, armCY: 0.15, armCZ: 1.07, headY: 0.32, headZ: 2.05, tipY: 0.42, tipZ: 2.05 });

  // The mast arm AND the cobra-head housing: everything that does not glow.
  // The luminaire batch below is the lens alone, so at night the light comes
  // off the glass, not off the whole painted housing.
  function mastArmProto() {
    const p = DK.proto();
    const rp = rAt(LAMP_Y);
    // the pole bracket: a curved saddle plate lagged to the timber, two
    // through-bolts, and the arm's socket
    for (const sy of [0.12, -0.16]) p.cyl(rp + 0.008, rp + 0.008, 0.03, 10, GALV_D, 0, sy, 0, 0, 0, 0);   // band straps
    p.cbox(0.12, 0.36, 0.06, 0.012, GALV_D, 0, -0.02, rp + 0.025);
    // the arm: a tapered elliptical tube from socket to tip, an upswept
    // truss under it for stiffness
    const tY = MAST.tipY != null ? MAST.tipY : MAST.headY + 0.1, tZ = MAST.tipZ != null ? MAST.tipZ : MAST.headZ;
    p.rod(0, 0.06, rp + 0.05, 0, tY, tZ - 0.25, 0.042, 8, STEEL, 0.03);
    p.rod(0, -0.14, rp + 0.05, 0, (0.06 + tY) / 2 - 0.02, (rp + tZ) / 2, 0.016, 5, STEEL);
    // the cobra head housing on the tip: slip-fitter, the tapered body,
    // the hinged door line under it
    const hy = tY - 0.02, hz = tZ + 0.08;
    p.cyl(0.05, 0.05, 0.16, 8, 0x8c9195, 0, tY - 0.005, tZ - 0.2, Math.PI / 2 - 0.2, 0, 0);
    const dome = new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(0.85, 0.55, 1.7);
    p.add(dome, 0x979ca0, 0, hy - 0.07, hz);
    const rim = new THREE.CylinderGeometry(0.172, 0.172, 0.02, 12);
    rim.scale(1, 1, 1.75);
    p.add(rim, 0x6f7477, 0, hy - 0.07, hz);
    p.cyl(0.018, 0.018, 0.03, 8, 0x2b2d2f, 0, hy + 0.05, hz - 0.12);     // photocell
    return p.done();
  }

  function lampHeadProto() {
    // THE LENS ONLY: a shallow sag-glass dish under the housing, long along
    // +Z (along the arm it hangs on). This batch carries the emissive.
    const p = DK.proto();
    const g = new THREE.SphereGeometry(0.15, 12, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    g.scale(1, 0.35, 1.7);
    p.add(g, 0xfff1d0, 0, 0, 0.08);
    return p.done();
  }

  // The prototypes, for the asset turntable (tools/lab asset kit) and nothing
  // else: a rebuild is looked at alone on the floor before it ships.
  CBZ.utilityProtos = {
    pole: poleProto, transformer: transformerProto, pad: padTransformerProto,
    cabinet: cabinetProto, mastArm: mastArmProto, lampHead: lampHeadProto, MAST: MAST,
  };

  // =====================================================================
  //  CATENARY WIRE BUILDER
  // =====================================================================
  // A hanging conductor is a catenary; over the short spans a street uses,
  // the parabola y = -4·sag·t·(1-t) is visually identical and far cheaper.
  // Cross-section is two perpendicular quads (an "X" ribbon): the wire stays
  // visible from every angle for 12 verts a segment, and an unlit material
  // keeps it a clean dark silhouette day and night, exactly like a real one.
  const _d = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

  // SAG GOES AS THE SQUARE OF THE SPAN. A conductor's mid-span droop is
  // w*L^2/(8T) — so a short span reads taut and a long one droops, which is
  // most of what makes a line look strung rather than drawn. The old pass used
  // a flat fraction of the span (linear), so every span looked identical no
  // matter how far apart its poles stood. The constant is SOLVED against the
  // authored feel rather than re-picked: sag(SPACING) still equals SPACING*SAG,
  // so the design span is unchanged and every other span is now right RELATIVE
  // to it.
  const SAG_K = SPACING / SAG;
  function sagFor(span, lowEndY, groundY, mul, clear) {
    let s = ((span * span) / SAG_K) * (mul || 1);
    // ...and it never dips under the clearance over the ground. A real utility
    // tensions harder over a road for exactly this reason, and the comms
    // bundle below the power crossarm is allowed to hang lower than the
    // conductors are — which is why the clearance is an argument.
    const head = lowEndY - groundY - (clear != null ? clear : MIN_CLEAR);
    s = Math.min(s, head > 0.1 ? head : 0.1);
    return Math.max(0.08, s);
  }

  // The pole's OWN instance transform applied to a local hard point. This is
  // the same (x,y,z,rx,ry,rz) tuple handed to poles.add — literally the matrix
  // detail_kit composes for the InstancedMesh — so a wire end and the insulator
  // it sits on cannot disagree by construction.
  const _pe = new THREE.Euler(), _pq = new THREE.Quaternion(), _pm = new THREE.Matrix4();
  const _pp = new THREE.Vector3(), _ps = new THREE.Vector3(1, 1, 1), _pt = new THREE.Vector3();
  function worldAt(P, lx, ly, lz, out) {
    _pe.set(P.rx, P.ry, P.rz);
    _pq.setFromEuler(_pe);
    _pp.set(P.x, P.y, P.z);
    _pm.compose(_pp, _pq, _ps);
    _pt.set(lx, ly, lz).applyMatrix4(_pm);
    out = out || {};
    out.x = _pt.x; out.y = _pt.y; out.z = _pt.z;
    out.lx = lx; out.ly = ly; out.lz = lz;
    return out;
  }

  function wireSpan(sheet, ax, ay, az, bx, by, bz, sagAmt, radius, color, segs) {
    const n = Math.max(2, segs || 6);
    const P = [], N = [];
    let px = ax, py = ay, pz = az;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const qx = ax + (bx - ax) * t;
      const qz = az + (bz - az) * t;
      const qy = ay + (by - ay) * t - sagAmt * 4 * t * (1 - t);
      _d.set(qx - px, qy - py, qz - pz);
      if (_d.lengthSq() < 1e-9) { px = qx; py = qy; pz = qz; continue; }
      _d.normalize();
      _u.crossVectors(_d, _up);
      if (_u.lengthSq() < 1e-6) _u.set(1, 0, 0); else _u.normalize();
      _v.crossVectors(_d, _u).normalize();
      const ux = _u.x * radius, uy = _u.y * radius, uz = _u.z * radius;
      const vx = _v.x * radius, vy = _v.y * radius, vz = _v.z * radius;
      quad(P, N, px, py, pz, qx, qy, qz, ux, uy, uz, _v.x, _v.y, _v.z);
      quad(P, N, px, py, pz, qx, qy, qz, vx, vy, vz, _u.x, _u.y, _u.z);
      px = qx; py = qy; pz = qz;
    }
    if (!P.length) return;
    sheet.push(P, N, DK.colArray(color, P.length / 3), null, DK.h01(ax, az, 0x3b17));
  }
  // one flat ribbon between two points, offset ±(ox,oy,oz), normal (nx,ny,nz)
  function quad(P, N, ax, ay, az, bx, by, bz, ox, oy, oz, nx, ny, nz) {
    P.push(ax - ox, ay - oy, az - oz, bx - ox, by - oy, bz - oz, bx + ox, by + oy, bz + oz);
    P.push(ax - ox, ay - oy, az - oz, bx + ox, by + oy, bz + oz, ax + ox, ay + oy, az + oz);
    for (let i = 0; i < 6; i++) N.push(nx, ny, nz);
  }

  // =====================================================================
  //  THE PASS
  // =====================================================================
  DK.register(10, "utility-lines", function (city, DK) {
    // A stale census from a PREVIOUS world would be worse than none — it would
    // report a clean bill of health for poles that no longer exist.
    CBZ.streetPoleCensus = null;
    if (CBZ.CONFIG.DETAIL_UTILITY_LINES === false) return;

    const root = city.root;
    const poles = DK.batch("pole", poleProto(), { cls: "solid", cast: true });
    const cans = DK.batch("pole-transformer", transformerProto(), { cls: "decor", cast: false });
    const pads = DK.batch("pad-transformer", padTransformerProto(), { cls: "solid", cast: true });
    const cabs = DK.batch("utility-cabinet", cabinetProto(), { cls: "solid", cast: true });
    const arms = DK.batch("mast-arm", mastArmProto(), { cls: "decor", cast: false });
    // vertexColors MUST stay on: every prototype in this kit bakes its part
    // colours into a `color` attribute, and a material without it renders the
    // whole fitting in the flat material colour (i.e. pure white).
    const lampM = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, emissive: 0xffd9a0, emissiveIntensity: 0 });
    lampM._shared = true;
    const heads = DK.batch("mast-lamp", lampHeadProto(), { cls: "decor", cast: false, material: lampM });
    const wires = DK.sheet("wires", { cls: "decor", unlit: true, side: THREE.DoubleSide });

    const cx = (city.center && city.center.x) || 0, cz = (city.center && city.center.z) || 0;
    const roads = DK.streetRoads(city);
    // VERTEX BUDGET, not just draw calls: an InstancedMesh still submits
    // count × prototype-vertices every frame. The pole prototype is ~430
    // verts, so 240 poles ≈ 100k verts on ONE draw. That is the real ceiling
    // for this pass, and the tier scaler trims it further on weak hardware.
    const MAX_POLES = DK.count(200);
    let poleCount = 0;
    // ---- the census CBZ.streetAudit() reads (city/props.js) --------------
    const census = { poles: [], spans: 0, dropped: 0, noCollider: 0, mast: 0 };
    const V2 = CBZ.CONFIG.STREET_WIRES_V2 !== false;
    const lampCensus = city._lampCensus = city._lampCensus || { lamps: 0, noCollider: 0, overRoad: 0 };

    // A SPAN THAT WOULD CROSS A BUILDING IS NOT DRAWN. Not nudged, not
    // shortened — deleted, and the run is treated as ENDING there, so the two
    // poles either side get the dead-end guy a real terminated line has.
    function spanClear(ax, az, bx, bz) {
      for (let s = 1; s <= 5; s++) {
        const t = s / 6;
        if (DK.insideBuilding(ax + (bx - ax) * t, az + (bz - az) * t, 0.4)) return false;
      }
      return true;
    }
    // The ONLY way a conductor gets drawn: by ATTACH INDEX, never by raw
    // coordinates. There is no signature here that lets a caller hand-write a
    // world endpoint again, which is what went wrong the first time.
    function stringPhase(a, b, i, sag) {
      const A = a.att[i], B = b.att[i];
      wireSpan(wires, A.x, A.y, A.z, B.x, B.y, B.z, sag, WIRE_R, WIRE_C, 6);
      a.used.push(A); b.used.push(B);
      census.spans++;
    }

    for (let ri = 0; ri < roads.length && poleCount < MAX_POLES; ri++) {
      const r = roads[ri];
      // Which kerb carries the line? One deterministic side per road, so a run
      // reads as a continuous easement rather than a random scatter.
      const side = DK.h01(r.x, r.z, 0x51a3) < 0.5 ? -1 : 1;
      // Poles stand on the PROPERTY line, not the kerb line — that keeps the
      // ~2m walkable pavement band (city/world.js's block slab minus the lot
      // pad) clear for peds instead of putting a 0.5m obstacle in the middle.
      const off = (r.w != null ? r.w : (city.ROAD || 18)) / 2 + 1.7;
      const n = Math.floor(r.len / SPACING);
      if (n < 1) continue;
      const step = r.len / (n + 1);
      const yaw = r.vertical ? 0 : Math.PI / 2;     // crossarm across the wire run
      const run = [];                               // consecutive poles for stringing

      for (let k = 0; k <= n && poleCount < MAX_POLES; k++) {
        const t = -r.len / 2 + (k + 0.5) * step;
        const x = r.vertical ? r.x + side * off : r.x + t;
        const z = r.vertical ? r.z + t : r.z + side * off;
        // dense cores bury their services; poles belong to the outskirts
        if (Math.hypot(x - cx, z - cz) < CORE_CLEAR) { run.push(null); continue; }
        if (!DK.free(x, z, { doorR: 3.6, ring: 1 })) { run.push(null); continue; }
        const y = DK.groundY(x, z);
        const lean = DK.h11(x, z, 0x2c71) * 0.022;       // no two poles are plumb
        // THE POLE'S TRANSFORM IS A RECORD, not four arguments thrown away at
        // the call. Everything that must land on this pole reads it back.
        const P = {
          x: x, y: y, z: z,
          rx: lean, ry: yaw + DK.h11(x, z, 0x2c72) * 0.06, rz: lean * 0.6,
          h: DK.h01(x, z, 0x2c73), att: [], used: [],
        };
        poles.add(x, y, z, { ry: P.ry, rx: P.rx, rz: P.rz });
        // The collider is DERIVED from the prototype's own butt radius rather
        // than typed beside it (it was a hand-written 0.26 against a 0.205
        // pole). Same class of fix as the wires: two numbers that describe one
        // object must come from one place, or they drift.
        DK.solid(x, z, POLE_R_BUTT + 0.01, POLE_R_BUTT + 0.01, null);
        P.solid = true;
        DK.claim(x, z);
        poleCount++;
        for (let i = 0; i < ATTACH.phase.length; i++) {
          P.att.push(worldAt(P, ATTACH.phase[i].x, ATTACH.phase[i].y, ATTACH.phase[i].z));
        }
        P.comms = worldAt(P, ATTACH.comms.x, ATTACH.comms.y, ATTACH.comms.z);
        census.poles.push(P);

        const h = P.h;
        // pole-mounted transformer on roughly a fifth of poles
        if (h < 0.2) {
          // authored in the pole's own frame (butt origin): the SAME transform,
          // lean included, so the hangers stay lagged to the timber
          cans.add(x, y, z, { ry: P.ry, rx: P.rx, rz: P.rz });
        }
        // COBRA-HEAD MAST ARM, on the shared CBZ.lampMast solve: local +Z is
        // the carriageway, so `ry` is simply the bearing from the pole to the
        // road centre and the head lands on the arm's TIP — not at a second,
        // separately-typed offset that could drift from it.
        const armOut = -side;                       // arm points at the street
        if (h > 0.62) {
          // the root is the pole AXIS at LAMP_Y pushed through the pole's own
          // transform, so a leaning pole carries its bracket with it
          const mr = worldAt(P, 0, LAMP_Y, 0);
          const ay = mr.y;
          const ox = r.vertical ? armOut : 0, oz = r.vertical ? 0 : armOut;
          const ry = Math.atan2(ox, oz);
          arms.add(mr.x, ay, mr.z, { ry: ry });
          heads.add(mr.x + ox * MAST.headZ, ay + MAST.headY, mr.z + oz * MAST.headZ, { ry: ry });
          census.mast++;
          lampCensus.lamps++;
          const half = (r.w != null ? r.w : (city.ROAD || 18)) / 2;
          // measured, not assumed: did the luminaire actually end up over the
          // carriageway? (pole at w/2+1.7 from the centreline, reaching 2.05 in)
          if (off - MAST.headZ < half) lampCensus.overRoad++;
        }
        run.push(P);
      }

      // ---- string the conductors between consecutive standing poles -----
      // `linked[k]` records whether the span k->k+1 was ACTUALLY drawn, which
      // is what makes the guys below correct: a pole with no wire on one side
      // is a dead end and gets the anchor a dead end needs, whether that is
      // because the run ran out of poles or because a span was refused.
      const linked = new Array(Math.max(0, run.length - 1)).fill(false);
      for (let k = 0; k + 1 < run.length; k++) {
        const a = run[k], b = run[k + 1];
        if (!a || !b) continue;
        const span = Math.hypot(b.x - a.x, b.z - a.z);
        if (span < 4 || span > SPACING * 1.8) continue;
        // DELETED, not drawn through: a conductor that would pass through a
        // building is not a conductor, it is a bug you can see from the street.
        if (V2 && !spanClear(a.x, a.z, b.x, b.z)) { census.dropped++; continue; }
        const sag = sagFor(span, Math.min(a.att[0].y, b.att[0].y), Math.min(a.y, b.y));
        if (V2) {
          // THREE pins, THREE conductors, each landing on its own insulator.
          for (let i = 0; i < a.att.length; i++) stringPhase(a, b, i, sag);
        } else {
          for (let s = -1; s <= 1; s += 2) {
            const px = r.vertical ? ARM_X : 0, pz = r.vertical ? 0 : ARM_X;
            wireSpan(wires, a.x + s * px, a.y + INSUL_Y + 0.02, a.z + s * pz,
              b.x + s * px, b.y + INSUL_Y + 0.02, b.z + s * pz, sag, WIRE_R, WIRE_C, 6);
            census.spans++;
          }
        }
        // the lower comms bundle — thicker, saggier, hung on the BRACKET (it
        // used to be drawn from the pole's axis, i.e. through the timber) and
        // only on some spans, which is precisely how a real street looks
        if (a.h < 0.66) {
          const A = V2 ? a.comms : { x: a.x, y: a.y + COMMS_Y + 0.1, z: a.z };
          const B = V2 ? b.comms : { x: b.x, y: b.y + COMMS_Y + 0.1, z: b.z };
          wireSpan(wires, A.x, A.y, A.z, B.x, B.y, B.z,
            sagFor(span, Math.min(A.y, B.y), Math.min(a.y, b.y), 1.6, 4.3), WIRE_R * 1.5, 0x101216, 6);
          if (V2) { a.used.push(A); b.used.push(B); }
          census.spans++;
        }
        linked[k] = true;
      }
      // ---- guy wires: a dead-end pole gets one, and it LANDS ON SOMETHING --
      // The old pass guyed the first and last pole of the ARRAY (including
      // slots where no pole was ever built) and ran the strand from the pole's
      // centre-line to a bare point on the ground — a wire terminating in thin
      // air, which is the "runs off to nothing" in the screenshot. Now: the
      // strand leaves the timber at its real SURFACE, lands on a drawn anchor
      // rod, and wears the high-vis guard guy a real one wears.
      for (let k = 0; k < run.length; k++) {
        const a = run[k];
        if (!a) continue;
        const pullPrev = k > 0 && !!linked[k - 1], pullNext = !!linked[k];
        if (pullPrev === pullNext) continue;      // mid-run (both) or orphan (neither)
        const dir = pullNext ? -1 : 1;            // the guy opposes the pull
        const gAX = r.vertical ? 0 : dir, gAZ = r.vertical ? dir : 0;
        const gx = a.x + gAX * 3.4 + (r.vertical ? side * 0.7 : 0);
        const gz = a.z + gAZ * 3.4 + (r.vertical ? 0 : side * 0.7);
        if (DK.onRoad(gx, gz, 0.3)) continue;                 // never anchor in a lane
        if (DK.insideBuilding(gx, gz, 0.2)) continue;         // never anchor in a wall
        const gy = DK.groundY(gx, gz);
        // local +Z is the run direction for both road orientations (yaw 0 keeps
        // +Z world +Z; yaw PI/2 maps local +X to world -Z and +Z to world +X),
        // so the guy leaves on the pole's own surface at `dir`.
        const A = V2 ? worldAt(a, 0, ATTACH.guyY, dir * ATTACH.guyR)
          : { x: a.x, y: a.y + ARM_Y - 0.15, z: a.z };
        const topY = gy + 0.58;
        wireSpan(wires, A.x, A.y, A.z, gx, topY, gz, 0, WIRE_R * 0.8, 0x1a1c20, 2);
        if (V2) {
          a.used.push(A);
          // the anchor rod itself — this is what the strand lands ON
          wireSpan(wires, gx, topY + 0.06, gz, gx, gy - 0.04, gz, 0, 0.05, STEEL, 1);
          // and the yellow guard sleeve over its bottom 2.4 m
          const dx = A.x - gx, dy = A.y - topY, dz = A.z - gz;
          const L = Math.hypot(dx, dy, dz) || 1, f = Math.min(1, 2.4 / L);
          wireSpan(wires, gx, topY, gz, gx + dx * f, topY + dy * f, gz + dz * f, 0, WIRE_R * 1.9, GUARD_Y, 1);
        }
        census.spans++;
      }
    }

    // =====================================================================
    //  GROUND-LEVEL PLANT: pad transformers + utility cabinets
    // =====================================================================
    // These live on the pavement against a building line, never in a doorway
    // approach, and they are genuinely solid — a green pad transformer you can
    // walk through would be worse than not having one.
    let padN = 0, cabN = 0;
    const PAD_MAX = DK.count(34), CAB_MAX = DK.count(70);
    DK.eachKerb(city, 23, 0x7711, function (p) {
      if (padN >= PAD_MAX && cabN >= CAB_MAX) return false;
      const roll = DK.h01(p.x, p.z, 0x7712);
      // push them back off the kerb toward the building line
      const bx = p.x + p.nx * 1.5, bz = p.z + p.nz * 1.5;
      if (!DK.free(bx, bz, { doorR: 4.2, ring: 1 })) return false;
      const y = DK.groundY(bx, bz);
      if (roll < 0.10 && padN < PAD_MAX) {
        pads.add(bx, y, bz, { ry: p.yaw });
        DK.solid(bx, bz, 0.95, 0.78, null);
        DK.claim(bx, bz); padN++;
        return true;
      }
      if (roll > 0.78 && cabN < CAB_MAX) {
        cabs.add(bx, y, bz, { ry: p.yaw, tint: 0.9 + DK.h01(bx, bz, 0x7713) * 0.2 });
        DK.solid(bx, bz, 0.36, 0.26, null);
        DK.claim(bx, bz); cabN++;
        return true;
      }
      return false;
    }, { band: 1.6 });

    // ---- build ---------------------------------------------------------
    poles.build(root);
    cans.build(root);
    pads.build(root);
    cabs.build(root);
    arms.build(root);
    const headMesh = heads.build(root);
    const wireMesh = wires.build(root);

    // Join the EXISTING dusk driver rather than inventing a second one:
    // city/props.js keeps city._nightLamps and, every frame in city mode,
    // walks it setting material.emissiveIntensity (props.js:2115). The array
    // is live, so pushing our luminaire batch in after props.js finished is
    // all it takes for these to light with the rest of the street.
    if (headMesh && city._nightLamps) { try { city._nightLamps.push(headMesh); } catch (e) { /* driver absent */ } }

    /* ------------------------------------------------------------------
       THE CENSUS city/props.js's CBZ.streetAudit() reads. Published as a
       FUNCTION off CBZ (the CBZ.heliFleet pattern) so a second pole source
       costs the audit no edit — and so nothing is measured until somebody
       asks, which keeps a build cheap.

       `wiresDisconnected` is a real re-measurement, not a claim. Every wire
       end was recorded with the LOCAL hard point it came from; the audit
       re-derives its world position from the pole's transform, now, through
       a different code path, and counts any that no longer coincide. An end
       written as a raw world coordinate carries no local point at all and is
       counted immediately — which is exactly the regression to catch, because
       that is the shape the old code had.

       `wireColliders` is measured too: the wire sheet is a Sheet, and Sheets
       never call DK.solid — so we scan CBZ.colliders for anything pointing at
       the mesh rather than asserting it. A wire you can bump into is worse
       than a wire you can walk through. ------------------------------------ */
    const _chk = {};
    CBZ.streetPoleCensus = function () {
      let discon = 0, ends = 0, noCol = 0;
      for (let i = 0; i < census.poles.length; i++) {
        const P = census.poles[i];
        if (!P.solid) noCol++;
        for (let k = 0; k < P.used.length; k++) {
          const e = P.used[k];
          ends++;
          if (e.lx == null) { discon++; continue; }      // a hand-written world endpoint
          worldAt(P, e.lx, e.ly, e.lz, _chk);
          const d = Math.hypot(_chk.x - e.x, _chk.y - e.y, _chk.z - e.z);
          if (d > 0.02) discon++;
        }
      }
      let wireCol = 0;
      const C = CBZ.colliders || [];
      for (let i = 0; i < C.length; i++) if (C[i] && C[i].ref && C[i].ref === wireMesh) wireCol++;
      return {
        poles: census.poles.length,
        wireEnds: ends,
        wiresDisconnected: discon,
        wiresDropped: census.dropped,
        spans: census.spans,
        noCollider: noCol,
        wireColliders: wireCol,
        mastLamps: census.mast,
        // this pass's real draw count: the batches/sheets that got built.
        drawCalls: [poles.mesh, cans.mesh, pads.mesh, cabs.mesh, arms.mesh, headMesh, wireMesh]
          .reduce(function (n, m) { return n + (m ? 1 : 0); }, 0),
      };
    };
  });
})();
