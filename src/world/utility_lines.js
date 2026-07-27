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

  // ---- authored dimensions (metres) ------------------------------------
  const POLE_H = 9.4;          // butt to top
  const ARM_Y = 8.45;          // crossarm centre height
  const ARM_SPAN = 2.3;        // crossarm length
  const INSUL_Y = ARM_Y + 0.28;
  const COMMS_Y = 6.35;
  const SPACING = 31;          // pole pitch down a run
  const SAG = 0.048;           // conductor droop as a fraction of span
  const WIRE_R = 0.036;
  const CORE_CLEAR = 62;       // no poles inside this radius of city centre

  const WOOD = 0x6c5a44, WOOD_D = 0x54452f, GLASS = 0x86a8ab, STEEL = 0x8c9298;
  const CAN = 0x9aa1a6, PAD_GREEN = 0x3f5a44, CAB_GREY = 0x9ba1a4, WIRE_C = 0x14161a;

  // =====================================================================
  //  PROTOTYPES
  // =====================================================================
  function poleProto() {
    const p = DK.proto();
    // The shaft tapers like a real class-4 pole: fatter at the butt.
    p.cyl(0.135, 0.205, POLE_H, 8, WOOD, 0, POLE_H / 2, 0);
    // crossarm runs along local X, so a pole yawed to the street puts its
    // arm square across the wire direction
    p.box(ARM_SPAN, 0.13, 0.13, WOOD_D, 0, ARM_Y, 0);
    p.box(0.1, 0.5, 0.1, WOOD_D, 0, ARM_Y - 0.3, 0.09, -0.5, 0, 0);   // diagonal brace
    p.box(0.1, 0.5, 0.1, WOOD_D, 0, ARM_Y - 0.3, -0.09, 0.5, 0, 0);
    // Three glass insulators. BOXES, not cylinders: at 8.7m a 6-sided cylinder
    // costs twice the vertices of a box and reads identically. Prototype
    // vertex count is multiplied by every instance in the world, so shape
    // economy up here is worth more than anywhere else in the pass.
    for (let i = -1; i <= 1; i++) {
      p.box(0.11, 0.2, 0.11, GLASS, i * (ARM_SPAN / 2 - 0.2), INSUL_Y - 0.1, 0);
    }
    // comms/cable-TV bracket lower down
    p.box(0.44, 0.07, 0.07, STEEL, 0.16, COMMS_Y, 0);
    p.box(0.09, 0.13, 0.09, STEEL, 0.34, COMMS_Y + 0.09, 0);
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

  function mastArmProto() {
    // an upsweeping arm; the luminaire itself is a separate emissive batch so
    // it can join the existing dusk-lighting driver.
    const p = DK.proto();
    p.cyl(0.055, 0.075, 2.2, 5, STEEL, 1.05, 0.28, 0, 0, 0, -Math.PI / 2 + 0.14);
    p.box(0.7, 0.07, 0.07, STEEL, 0.36, -0.18, 0, 0, 0, -0.9);      // gusset
    return p.done();
  }

  function lampHeadProto() {
    const p = DK.proto();
    p.box(0.62, 0.16, 0.3, 0xb9bec0, 0, 0.06, 0);
    p.box(0.5, 0.09, 0.24, 0xffe6b8, 0, -0.05, 0);            // the lens
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
        poles.add(x, y, z, { ry: yaw + DK.h11(x, z, 0x2c72) * 0.06, rx: lean, rz: lean * 0.6 });
        DK.solid(x, z, 0.26, 0.26, null);
        DK.claim(x, z);
        poleCount++;

        const h = DK.h01(x, z, 0x2c73);
        // pole-mounted transformer on roughly a fifth of poles
        if (h < 0.2) {
          const bx = x + Math.sin(yaw + Math.PI / 2) * 0.32;
          const bz = z + Math.cos(yaw + Math.PI / 2) * 0.32;
          cans.add(bx, y + 7.0, bz, { ry: yaw });
        }
        // cobra-head mast arm reaching out over the carriageway
        const armOut = -side;                       // arm points at the street
        if (h > 0.62) {
          const ay = y + POLE_H - 1.2;
          const ry = r.vertical ? (armOut > 0 ? 0 : Math.PI) : (armOut > 0 ? -Math.PI / 2 : Math.PI / 2);
          arms.add(x, ay, z, { ry: ry });
          const lx = x + (r.vertical ? armOut * 2.05 : 0);
          const lz = z + (r.vertical ? 0 : armOut * 2.05);
          heads.add(lx, ay + 0.42, lz, { ry: ry });
        }
        run.push({ x: x, y: y, z: z, yaw: yaw, h: h });
      }

      // ---- string the conductors between consecutive standing poles -----
      let firstIdx = -1, lastIdx = -1;
      for (let k = 0; k < run.length; k++) if (run[k]) { if (firstIdx < 0) firstIdx = k; lastIdx = k; }
      for (let k = 0; k + 1 < run.length; k++) {
        const a = run[k], b = run[k + 1];
        if (!a || !b) continue;
        const span = Math.hypot(b.x - a.x, b.z - a.z);
        if (span < 4 || span > SPACING * 1.8) continue;
        const sag = span * SAG;
        // the two outer insulator positions, offset perpendicular to the run
        const px = r.vertical ? (ARM_SPAN / 2 - 0.2) : 0;
        const pz = r.vertical ? 0 : (ARM_SPAN / 2 - 0.2);
        for (let s = -1; s <= 1; s += 2) {
          wireSpan(wires,
            a.x + s * px, a.y + INSUL_Y + 0.02, a.z + s * pz,
            b.x + s * px, b.y + INSUL_Y + 0.02, b.z + s * pz,
            sag, WIRE_R, WIRE_C, 6);
        }
        // the lower comms bundle — thicker, saggier, and only on some spans,
        // which is precisely how a real street looks
        if (a.h < 0.66) {
          wireSpan(wires,
            a.x, a.y + COMMS_Y + 0.1, a.z,
            b.x, b.y + COMMS_Y + 0.1, b.z,
            sag * 1.6, WIRE_R * 1.5, 0x101216, 6);
        }
      }
      // ---- guy wires anchor the ends of a run (where the pull is) -------
      for (const idx of [firstIdx, lastIdx]) {
        if (idx < 0) continue;
        const a = run[idx];
        if (!a) continue;
        const dirX = r.vertical ? 0 : (idx === firstIdx ? -1 : 1);
        const dirZ = r.vertical ? (idx === firstIdx ? -1 : 1) : 0;
        const gx = a.x + dirX * 3.2 + (r.vertical ? side * 0.6 : 0);
        const gz = a.z + dirZ * 3.2 + (r.vertical ? 0 : side * 0.6);
        if (DK.onRoad(gx, gz, 0.2)) continue;
        wireSpan(wires, a.x, a.y + ARM_Y - 0.15, a.z, gx, DK.groundY(gx, gz) + 0.1, gz, 0, WIRE_R * 0.8, 0x1a1c20, 2);
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
    wires.build(root);

    // Join the EXISTING dusk driver rather than inventing a second one:
    // city/props.js keeps city._nightLamps and, every frame in city mode,
    // walks it setting material.emissiveIntensity (props.js:2115). The array
    // is live, so pushing our luminaire batch in after props.js finished is
    // all it takes for these to light with the rest of the street.
    if (headMesh && city._nightLamps) { try { city._nightLamps.push(headMesh); } catch (e) { /* driver absent */ } }
  });
})();
