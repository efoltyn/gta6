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
  const POLE_H = 9.4;          // butt to top
  const POLE_R_TOP = 0.135, POLE_R_BUTT = 0.205;
  const ARM_Y = 8.45;          // crossarm centre height
  const ARM_SPAN = 2.3;        // crossarm length
  const INSUL_Y = ARM_Y + 0.28;
  const COMMS_Y = 6.35;
  const SPACING = 31;          // pole pitch down a run
  const SAG = 0.048;           // conductor droop at the DESIGN span, as a fraction
  const WIRE_R = 0.036;
  const CORE_CLEAR = 62;       // no poles inside this radius of city centre
  const MIN_CLEAR = 5.5;       // a conductor never dips closer than this to the ground

  const WOOD = 0x6c5a44, WOOD_D = 0x54452f, GLASS = 0x86a8ab, STEEL = 0x8c9298;
  const CAN = 0x9aa1a6, PAD_GREEN = 0x3f5a44, CAB_GREY = 0x9ba1a4, WIRE_C = 0x14161a;
  const GUARD_Y = 0xd8c23a;    // the high-vis sleeve on the bottom of a guy

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
  const ARM_X = ARM_SPAN / 2 - 0.2;
  const ATTACH = {
    // THREE-phase crossarm -> THREE conductors. The old pass drew three
    // insulators and strung two, so the centre pin carried nothing at all.
    phase: [
      { x: -ARM_X, y: INSUL_Y + 0.015, z: 0 },
      { x: 0, y: INSUL_Y + 0.015, z: 0 },
      { x: ARM_X, y: INSUL_Y + 0.015, z: 0 },
    ],
    // The comms bundle hangs off the BRACKET at local x=0.34. It used to be
    // drawn from the pole's AXIS, i.e. straight through the timber.
    comms: { x: 0.34, y: COMMS_Y + 0.10, z: 0 },
    // A guy leaves the pole at its SURFACE just under the crossarm, on the
    // side away from the pull. The radius is the shaft's real taper at that
    // height, not a guess.
    guyY: ARM_Y - 0.35,
    guyR: POLE_R_BUTT + (POLE_R_TOP - POLE_R_BUTT) * ((ARM_Y - 0.35) / POLE_H),
  };

  // =====================================================================
  //  PROTOTYPES
  // =====================================================================
  function poleProto() {
    const p = DK.proto();
    // The shaft tapers like a real class-4 pole: fatter at the butt.
    p.cyl(POLE_R_TOP, POLE_R_BUTT, POLE_H, 8, WOOD, 0, POLE_H / 2, 0);
    // crossarm runs along local X, so a pole yawed to the street puts its
    // arm square across the wire direction
    p.box(ARM_SPAN, 0.13, 0.13, WOOD_D, 0, ARM_Y, 0);
    p.box(0.1, 0.5, 0.1, WOOD_D, 0, ARM_Y - 0.3, 0.09, -0.5, 0, 0);   // diagonal brace
    p.box(0.1, 0.5, 0.1, WOOD_D, 0, ARM_Y - 0.3, -0.09, 0.5, 0, 0);
    // Three glass insulators, drawn AT the attach table's own x — the pins and
    // the conductors can no longer be edited apart. BOXES, not cylinders: at
    // 8.7m a 6-sided cylinder costs twice the vertices of a box and reads
    // identically. Prototype vertex count is multiplied by every instance in
    // the world, so shape economy up here is worth more than anywhere else.
    for (let i = 0; i < ATTACH.phase.length; i++) {
      p.box(0.11, 0.2, 0.11, GLASS, ATTACH.phase[i].x, INSUL_Y - 0.1, 0);
    }
    // comms/cable-TV bracket lower down — the standoff is the comms attach
    p.box(0.44, 0.07, 0.07, STEEL, 0.16, COMMS_Y, 0);
    p.box(0.09, 0.13, 0.09, STEEL, ATTACH.comms.x, COMMS_Y + 0.09, 0);
    // climbing steps — tiny, but they are what stops a pole reading as a stick
    for (let s = 0; s < 2; s++) {
      p.box(0.28, 0.045, 0.045, STEEL, 0, 2.6 + s * 1.6, (s % 2 ? 0.1 : -0.1));
    }
    return p.done();
  }

  function transformerProto() {
    const p = DK.proto();
    p.cyl(0.4, 0.4, 0.92, 8, CAN, 0, 0, 0);
    p.cyl(0.42, 0.42, 0.08, 8, 0x7d848a, 0, 0.5, 0);          // lid rim
    p.box(0.14, 0.22, 0.14, GLASS, -0.16, 0.62, 0);           // HV bushings
    p.box(0.14, 0.22, 0.14, GLASS, 0.16, 0.62, 0);
    p.box(0.5, 0.1, 0.1, 0x7d848a, 0, -0.4, -0.34);           // mounting bracket
    return p.done();
  }

  function padTransformerProto() {
    const p = DK.proto();
    p.box(1.9, 0.16, 1.5, 0x8d8d86, 0, 0.08, 0);              // concrete pad
    p.box(1.5, 1.15, 1.1, PAD_GREEN, 0, 0.73, 0);             // cabinet
    p.box(1.56, 0.09, 1.16, 0x33493a, 0, 1.34, 0);            // lid overhang
    for (let i = 0; i < 4; i++) p.box(1.02, 0.045, 0.03, 0x2c3f33, 0, 0.42 + i * 0.13, 0.552);  // louvres
    p.box(0.16, 0.22, 0.03, 0xc8b24a, -0.5, 1.05, 0.553);     // hazard plate
    return p.done();
  }

  function cabinetProto() {
    const p = DK.proto();
    p.box(0.62, 1.18, 0.38, CAB_GREY, 0, 0.61, 0);
    p.box(0.66, 0.07, 0.42, 0x7f8588, 0, 1.22, 0);            // rain hood
    p.box(0.5, 0.9, 0.02, 0x878d90, 0, 0.6, 0.196);           // door seam
    p.box(0.06, 0.12, 0.04, 0x53585b, 0.16, 0.55, 0.206);     // latch
    p.box(0.7, 0.1, 0.46, 0x6f6f68, 0, 0.05, 0);              // plinth
    return p.done();
  }

  // The cobra mast runs on city/props.js's shared CBZ.lampMast solve, in ITS
  // frame: local +Z is the carriageway, and the head sits at the arm's TIP
  // because the same function hands back both. poleH:0 puts the prototype's
  // origin at the arm's root on the shaft, which is where arms.add places it.
  const MAST = (CBZ.lampMast ? CBZ.lampMast({ poleH: 0, reach: 2.05, rise: 0.42, poleR: 0.18 })
    : { armLen: 2.03, armRotX: 1.302, armCY: 0.15, armCZ: 1.07, headY: 0.32, headZ: 2.05 });

  function mastArmProto() {
    // an upsweeping arm; the luminaire itself is a separate emissive batch so
    // it can join the existing dusk-lighting driver.
    const p = DK.proto();
    p.cyl(0.055, 0.075, MAST.armLen, 5, STEEL, 0, MAST.armCY, MAST.armCZ, MAST.armRotX, 0, 0);
    p.box(0.07, 0.07, 0.66, STEEL, 0, MAST.armCY - 0.30, MAST.armCZ * 0.5, -0.78, 0, 0);   // gusset
    return p.done();
  }

  function lampHeadProto() {
    // long along +Z, i.e. ALONG the arm it hangs on (it used to be long across
    // it, which is a luminaire mounted sideways).
    const p = DK.proto();
    p.box(0.3, 0.16, 0.62, 0xb9bec0, 0, 0.06, 0);
    p.box(0.24, 0.09, 0.5, 0xffe6b8, 0, -0.05, 0);            // the lens
    return p.done();
  }

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
          const bx = x + Math.sin(yaw + Math.PI / 2) * 0.32;
          const bz = z + Math.cos(yaw + Math.PI / 2) * 0.32;
          cans.add(bx, y + 7.0, bz, { ry: yaw });
        }
        // COBRA-HEAD MAST ARM, on the shared CBZ.lampMast solve: local +Z is
        // the carriageway, so `ry` is simply the bearing from the pole to the
        // road centre and the head lands on the arm's TIP — not at a second,
        // separately-typed offset that could drift from it.
        const armOut = -side;                       // arm points at the street
        if (h > 0.62) {
          const ay = y + POLE_H - 1.2;
          const ox = r.vertical ? armOut : 0, oz = r.vertical ? 0 : armOut;
          const ry = Math.atan2(ox, oz);
          arms.add(x, ay, z, { ry: ry });
          heads.add(x + ox * MAST.headZ, ay + MAST.headY, z + oz * MAST.headZ, { ry: ry });
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
