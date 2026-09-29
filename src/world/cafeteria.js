/* ============================================================
   world/cafeteria.js — the mess hall on the west side of the yard, and
   CBZ.prisonDress, the shared prison dressing kit.

   THE KIT LIVES HERE FOR ONE REASON: LOAD ORDER. index.html parses this
   file before lounge, southblock, roofs, adminwing and prisonwings, so it is
   the earliest prison-dress consumer. CBZ.prisonDress is the one vocabulary
   they all speak: fittings (caged lamp, strip, extinguisher, hose cabinet),
   the bolted round table, and (2026-09-27) the interior FINISH layer —
   floors at real tile scale, closed ceilings with real fittings, vinyl base
   and a painted block dado (see "INTERIOR FINISHES" in the kit).

   The mess hall itself is described where it is built, below the kit.
   systems/capture.js's DAY_BEAT sends the whole block here ("CHOW"), so it
   is a load-bearing room, and world/escape_routes.js has three floor
   hatches inside it that the furniture is laid around.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // Built when the prison is first needed, as if at this script's parse
  // point (core/prisonlazy.js). Body left at its old indent.
  CBZ.definePrison("world/cafeteria.js", function () {
  const { addBox, roomShell } = CBZ;
  const HALF = Math.PI / 2;

  // Walls carry no skin: an untextured prison slab is what world/prisonlook.js
  // paints as running-bond block. The floor is laid by the finish kit below.
  roomShell({
    x0: -29, x1: -19, z0: 6, z1: 22, h: 6,
    wall: 0x8a929c, floor: null, skin: null,
    door: { side: "E", center: 14, width: 3.4 },
  });


  // One-line pipe into city/propuse.js's seat registry, load-order-proof.
  // `cushion` = the seat top ABOVE the floor (propuse's 7th `geom` argument).
  function seat(x, z, face, kind, cushion) {
    const geom = cushion != null ? { cushion: cushion, floorBelow: 0 } : null;
    if (CBZ.roomSeatAnchor) CBZ.roomSeatAnchor(x, 0, z, face, kind, null, geom);
    else if (CBZ.propRegisterSeat) CBZ.propRegisterSeat(x, 0, z, face, kind, null, geom);
  }

  // ========================================================================
  //  CBZ.prisonDress — THE SHARED PRISON DRESSING KIT
  // ========================================================================
  // Every fitting an institution repeats. One-line adoption, no ceremony, no
  // registry: `PD.lamp(x, y, z, "x+")` REPLACES the five boxes the caller was
  // about to type. Consumers (all migrated in the same change): this file,
  // world/lounge.js, world/southblock.js — plus world/building_dress.js's
  // prison facade pass, which reads the shell list this kit collects.
  //
  // FACE CONVENTION: a face string is the OUTWARD normal of the wall the
  // fitting hangs on — "x+" | "x-" | "z+" | "z-" — so a caller never does
  // trigonometry to bolt something to a wall.
  //
  // BUDGET: nothing here casts a shadow (an institutional fitting is small
  // and lit flat), nothing carries userData, and nothing shares a geometry —
  // so core/batch.js merges the lot into a handful of draw calls, and its
  // inert-deco pass is free to dispose the source geometry.
  const PD = (function () {
    const S = CBZ.prisonRoot || CBZ.scene;
    const K = {};
    const h01 = CBZ.hash01 || function () { return 0.5; };
    // a face is "x+" | "x-" | "z+" | "z-", or an {x, z} unit vector for a
    // wall that is not on the axes (world/corridorkit.js's sally ports)
    function nrm(face) {
      if (face && typeof face === "object") return [face.x || 0, face.z || 0];
      return face === "x+" ? [1, 0] : face === "x-" ? [-1, 0]
        : face === "z+" ? [0, 1] : [0, -1];
    }
    K.face = nrm;
    K.h01 = h01;

    // Every prison shell that wants its OUTSIDE dressed registers its rect
    // here; world/building_dress.js's facade pass is the consumer. A plain
    // array, not a registry — pushing is the whole API.
    CBZ.prisonShells = CBZ.prisonShells || [];
    K.shell = function (rec) { CBZ.prisonShells.push(rec); return rec; };

    /* ---- EVERY LAMP THIS KIT DRAWS IS A LIGHT ON THE CLOCK ----------------
       A ROOM WITH A LID NEEDS FIXTURES THAT OBEY LIGHTS-OUT. Before roofs
       existed, a caged lamp was a permanently-emissive box: harmless in an
       open-topped room lit by the sun, a lie the moment the room has a
       ceiling and the schedule turns the block dark at 22:00.

       systems/prisonnight.js already owns the answer — CBZ.prisonLights
       .register drives any mesh with a PRIVATE material for free — but it
       parses ~25 tags after every file that draws a lamp, so nothing could
       register at draw time. So the kit QUEUES what it drew, with the exact
       colours it drew them in, and world/roofs.js flushes the queue on the
       first tick. Result: the thirty-odd caged lamps and strip lights already
       standing in the cafeteria, the dayroom and the south block join the
       timetable without one of those files being edited.

       `mover` keeps core/batch.js's static merge off a mesh whose material is
       written every 0.2 s — the same tag systems/prisonnight.js puts on its
       own driven fittings. */
    K.fixtures = [];
    function fixture(mesh, x, z, color, emissive, r, kind) {
      if (!mesh) return mesh;
      mesh.userData.mover = true;
      K.fixtures.push({ mesh: mesh, x: x, z: z, r: r || 7, kind: kind || "room",
        color: color, emissive: emissive, off: 0x2b2b2b });
      return mesh;
    }
    K.fixture = fixture;

    // ---- a line of paint / wear on a wall (1 mesh) ------------------------
    // The cheapest "this place is used" signal in the game: a scuff at
    // shoulder height, a wainscot band, a wayfinding stripe. Same primitive,
    // three intents, so they can never drift apart in thickness or standoff.
    function wline(x, y, z, len, axis, color, h, t, cast) {
      return addBox(x, y, z, axis === "x" ? len : t, h, axis === "x" ? t : len,
        color, { cast: !!cast, receive: false });
    }
    K.scuff = function (x, y, z, len, axis, o) {
      o = o || {};
      return wline(x, y, z, len, axis, o.color != null ? o.color : 0x5c636c,
        o.h || 0.09, o.t || 0.05, false);
    };
    K.band = function (x, y, z, len, axis, color, o) {
      o = o || {};
      return wline(x, y, z, len, axis, color, o.h || 0.14, o.t || 0.05, false);
    };
    // a wainscot / dado run — the painted lower half every corridor has
    K.dado = function (x, y, z, len, axis, color, o) {
      o = o || {};
      return wline(x, y, z, len, axis, color, o.h || 0.95, o.t || 0.06, false);
    };

    // ---- painted floor wayfinding (1 mesh) --------------------------------
    // PAINT IS FLUSH (2026-09-27, owner: "lines on ground are dumb"). These
    // used to be 2 cm boxes centred at a hand-typed y 0.045: on the yard (floor
    // 0) that stood a 5 cm coloured curb on the concrete, and inside a
    // roomShell (slab top 0.06) it buried the line in the floor. A line is
    // now laid ON whatever floor slab is under it (read at build time), 4 mm thick with its top 3 mm proud, and in a worn tone: paint
    // on a floor people walk on is never the colour on the tin.
    // Walks the root's direct children once per call (a few thousand, build
    // time only) and reads each flat slab's LOCAL transform: matrixWorld is
    // not trustworthy yet (core/matrixskip.js skips the hidden root at load).
    const PAINTED = new WeakSet();
    function floorTop(x, z) {
      const root = CBZ.prisonRoot || CBZ.scene;
      let top = 0;
      for (const m of root.children) {
        if (!m.isMesh || PAINTED.has(m) || !m.geometry) continue;
        const p = m.geometry.parameters; if (!p) continue;
        const r = m.rotation;
        if (m.geometry.type === "BoxGeometry") {
          if (Math.abs(r.x) > 0.01 || Math.abs(r.z) > 0.01 || Math.abs(r.y) > 0.01) continue;
          const h = p.height * m.scale.y; if (h > 0.25) continue;
          const t = m.position.y + h / 2; if (t > 0.3 || t <= top) continue;
          if (Math.abs(x - m.position.x) > p.width * m.scale.x / 2 || Math.abs(z - m.position.z) > p.depth * m.scale.z / 2) continue;
          top = t;
        } else if (m.geometry.type === "PlaneGeometry") {
          if (Math.abs(r.x + Math.PI / 2) > 0.01 || Math.abs(r.y) > 0.01 || Math.abs(r.z) > 0.01) continue;
          const t = m.position.y; if (t > 0.3 || t <= top) continue;
          if (Math.abs(x - m.position.x) > p.width * m.scale.x / 2 || Math.abs(z - m.position.z) > p.height * m.scale.y / 2) continue;
          top = t;
        }
      }
      return top;
    }
    const worn = (c) => { const col = new THREE.Color(c); const g = (col.r + col.g + col.b) / 3;
      col.setRGB((col.r * 0.7 + g * 0.3) * 0.82, (col.g * 0.7 + g * 0.3) * 0.82, (col.b * 0.7 + g * 0.3) * 0.82); return col.getHex(); };
    K.floorTop = floorTop;
    K.floorLine = function (x, z, len, axis, color, o) {
      o = o || {};
      const w = o.w || 0.1, top = floorTop(x, z) + 0.003;
      const m = addBox(x, top - 0.002, z, axis === "x" ? len : w, 0.004,
        axis === "x" ? w : len, worn(color), { cast: false });
      if (m) PAINTED.add(m);
      return m;
    };
    // a direction chevron built from two short strokes (2 meshes)
    K.chevron = function (x, z, axis, sign, color, o) {
      o = o || {};
      const s = o.size || 0.34, top = floorTop(x, z) + 0.003;
      for (const g of [-1, 1]) {
        const m = addBox(x, top - 0.002, z, s, 0.004, 0.08, worn(color), { cast: false });
        if (!m) continue;
        PAINTED.add(m);
        m.rotation.y = (axis === "x" ? 0 : HALF) + g * sign * 0.62;
      }
    };

    // ---- caged wall lamp (4 meshes, 1 emissive) ---------------------------
    // world/cellblock.js's hanging lamp (cage box + warm emissive) promoted
    // into a fitting you can bolt to any wall. This is THE prison light.
    // TWO cage bars, not three: this fitting is placed a dozen times across
    // the compound, so one box saved here is a dozen off the frame budget,
    // and at 3.6 m a third bar is a pixel.
    /* ---- PAINTED MERGE: many small parts in their own colours, ONE mesh on
       one shared vertex-colour material. For the props that are several
       colours at once (a mop bucket, a vending machine, a lamp's housing)
       and would otherwise be a heap of separately coloured boxes. Build in
       the prop's LOCAL frame, then .mesh(x, y, z, ry) or .geometry() to swap
       into a mesh something else already owns (a pushable's part). */
    let VC_MAT = null;
    function vcMat() {
      if (!VC_MAT) VC_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      return VC_MAT;
    }
    function Paint() { this.g = []; }
    Paint.prototype.add = function (g, color) {
      if (g.index) { const t = g.toNonIndexed(); g.dispose(); g = t; }
      for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
      const n = g.attributes.position.count, c = new THREE.Color(color), a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      g.setAttribute("color", new THREE.BufferAttribute(a, 3));
      this.g.push(g); return this;
    };
    Paint.prototype.box = function (x, y, z, w, h, d, color, ry) {
      const g = new THREE.BoxGeometry(w, h, d);
      if (ry) g.rotateY(ry);
      g.translate(x, y, z); return this.add(g, color);
    };
    Paint.prototype.cyl = function (x, y, z, r0, r1, h, color, seg, rx, rz, open) {
      const g = new THREE.CylinderGeometry(r0, r1, h, seg || 14, 1, !!open);
      if (rx) g.rotateX(rx);
      if (rz) g.rotateZ(rz);
      g.translate(x, y, z); return this.add(g, color);
    };
    Paint.prototype.geometry = function () {
      const BGU = THREE.BufferGeometryUtils;
      if (!this.g.length || !BGU || !BGU.mergeBufferGeometries) return null;
      const geo = this.g.length === 1 ? this.g[0] : BGU.mergeBufferGeometries(this.g, false);
      if (this.g.length > 1) for (const q of this.g) q.dispose();
      this.g = [];
      return geo;
    };
    Paint.prototype.mesh = function (x, y, z, ry, o) {
      const geo = this.geometry();
      if (!geo) return null;
      const m = new THREE.Mesh(geo, vcMat());
      m.position.set(x || 0, y || 0, z || 0);
      if (ry) m.rotation.y = ry;
      m.castShadow = !!(o && o.cast); m.receiveShadow = true;
      S.add(m);
      return m;
    };
    K.Paint = Paint;
    K.vcMat = vcMat;

    /* THE PRISON WALL LAMP: a cast bulkhead, not a box with a box on it.
       An oval cast back plate on the wall, the bezel ring, a domed prismatic
       lens (the one lit part, and the mesh the lights-out schedule drives)
       and a wire guard of three hoops and a spine over the dome. Two meshes
       (housing + lens) where it was four boxes, and at night the thing that
       glows is a lens IN a fitting, not a white block hung off a wall.
       (x, y, z) is the plate's centre 6 cm off the wall face, as before.
       o.reach moves the lit record's centre that far out along the face
       (a flood over a door lights the step, not the wall). */
    K.lamp = function (x, y, z, face, o) {
      o = o || {};
      const n = nrm(face), nx = n[0], nz = n[1];
      const w = o.w || 0.46, hh = o.h || 0.30;
      const tone = o.tone != null ? o.tone : 0xffe9a8;
      const em = o.emissive != null ? o.emissive : 0xffcf66;
      const ry = Math.atan2(nx, nz);                     // local +z = out of the wall
      const P = new Paint();
      const plate = new THREE.CylinderGeometry(0.5, 0.5, 1, 28);
      plate.rotateX(HALF); plate.scale(w + 0.06, hh + 0.14, 0.05); plate.translate(0, 0, -0.035);
      P.add(plate, 0x3c424d);
      const bez = new THREE.TorusGeometry(0.5, 0.06, 6, 28);
      bez.scale(w - 0.02, hh + 0.02, 0.4); bez.translate(0, 0, -0.004);
      P.add(bez, 0x30353c);
      const rx = (w - 0.1) / 2, rv = (hh - 0.04) / 2, dz = 0.125;
      const wire = function (pts) {
        return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.0075, 4, false);
      };
      for (const f of [-0.55, 0, 0.55]) {                 // three hoops across the dome
        const k = Math.sqrt(1 - f * f), pts = [];
        for (let i = 0; i <= 8; i++) {
          const a = Math.PI * i / 8;
          pts.push(new THREE.Vector3(Math.cos(a) * (rx * k + 0.014), f * rv, Math.sin(a) * dz * k + 0.012));
        }
        P.add(wire(pts), 0x252a32);
      }
      const spine = [];                                  // and the spine that ties them
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * i / 8;
        spine.push(new THREE.Vector3(0, Math.cos(a) * (rv + 0.014), Math.sin(a) * dz + 0.012));
      }
      P.add(wire(spine), 0x252a32);
      P.mesh(x, y, z, ry);
      const glass = addBox(x, y, z, 0.1, 0.1, 0.1, tone, { emissive: em, ei: o.ei != null ? o.ei : 0.85, cast: false });
      glass.geometry.dispose();
      const dome = new THREE.SphereGeometry(0.5, 20, 8, 0, Math.PI * 2, 0, HALF);
      dome.rotateX(HALF); dome.scale(w - 0.1, hh - 0.04, 0.22);
      glass.geometry = dome;
      glass.rotation.y = ry;
      // a wall lamp lights the metre or two around it, not the room
      const reach = o.reach || 0;
      return fixture(glass, x + nx * reach, z + nz * reach, tone, em, o.r || 5.5, o.kind || "room");
    };

    // ---- fluorescent strip (2 meshes, 1 emissive) -------------------------
    // Hung under the ceiling. (It used to be hung under an OPEN wall top: the
    // prison rooms had no lids so the follow camera could see in. world/
    // roofs.js closed them — the camera's own room probes, CAM_ROOM_BOOM and
    // CAM_TIGHT_FP, are what handle an interior now — so a strip light is a
    // ceiling fitting again, and it is on the schedule's circuit.)
    K.strip = function (x, y, z, len, axis, o) {
      o = o || {};
      addBox(x, y, z, axis === "x" ? len : 0.2, 0.09, axis === "x" ? 0.2 : len,
        0x4a525c, { cast: false });
      const em = o.emissive != null ? o.emissive : 0xffe9a8;
      const tube = addBox(x, y - 0.07, z, axis === "x" ? len - 0.24 : 0.13, 0.05,
        axis === "x" ? 0.13 : len - 0.24, 0xfdf6d8,
        { emissive: em, ei: o.ei != null ? o.ei : 0.85, cast: false });
      // r derived from the tube: a 4 m fitting throws further than a 1.5 m one
      return fixture(tube, x, z, 0xfdf6d8, em, o.r || (2.6 + len * 0.55), o.kind || "room");
    };
    // an open roof beam (1 mesh) — structure without a lid
    K.beam = function (x, y, z, len, axis, o) {
      o = o || {};
      return addBox(x, y, z, axis === "x" ? len : (o.w || 0.18), o.h || 0.22,
        axis === "x" ? (o.w || 0.18) : len, o.color != null ? o.color : 0x515a66,
        { cast: false });
    };

    // ---- service pipe run (1 mesh) + its hanger (1) -----------------------
    // Fresh geometry per call ON PURPOSE: core/batch.js's inert-deco pass
    // disposes the geometry it merges, and a shared CylinderGeometry would
    // take every other consumer down with it.
    K.pipe = function (x, y, z, len, axis, r, color) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8),
        CBZ.cmat ? CBZ.cmat(color) : CBZ.mat(color));
      m.position.set(x, y, z);
      if (axis === "x") m.rotation.z = HALF;
      else if (axis === "z") m.rotation.x = HALF;
      m.castShadow = false; m.receiveShadow = false;
      S.add(m);
      return m;
    };
    K.hanger = function (x, y, z, drop, o) {
      o = o || {};
      return addBox(x, y + drop / 2, z, o.w || 0.05, drop, o.w || 0.05,
        o.color != null ? o.color : 0x6b7480, { cast: false });
    };
    // an elbow / flange collar where a run turns or passes a wall (1 mesh)
    K.elbow = function (x, y, z, s, color) {
      return addBox(x, y, z, s, s, s, color != null ? color : 0x5b6470, { cast: false });
    };

    // ---- fire kit ---------------------------------------------------------
    K.extinguisher = function (x, y, z, face, o) {          // 3 meshes
      o = o || {};
      const n = nrm(face);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.56, 8),
        CBZ.cmat ? CBZ.cmat(0xc0392b) : CBZ.mat(0xc0392b));
      body.position.set(x, y, z); body.castShadow = false; body.receiveShadow = false;
      S.add(body);
      addBox(x, y + 0.36, z, 0.07, 0.16, 0.07, 0x2a2f38, { cast: false });   // neck/valve
      addBox(x - n[0] * 0.11, y - 0.05, z - n[1] * 0.11, n[0] ? 0.08 : 0.24, 0.1,
        n[0] ? 0.24 : 0.08, 0x9aa3ad, { cast: false });                       // wall bracket
    };
    K.hoseCab = function (x, y, z, face, o) {               // 4 meshes
      o = o || {};
      const n = nrm(face), nx = n[0], nz = n[1];
      addBox(x, y, z, nx ? 0.24 : 0.76, 0.86, nx ? 0.76 : 0.24, 0xa8322a, { cast: false });
      addBox(x + nx * 0.13, y, z + nz * 0.13, nx ? 0.03 : 0.6, 0.62, nx ? 0.6 : 0.03,
        0x1b1f26, { cast: false });                                            // glazed door
      addBox(x + nx * 0.15, y + 0.5, z + nz * 0.15, nx ? 0.03 : 0.6, 0.1,
        nx ? 0.6 : 0.03, 0xf2f2e8, { cast: false });                           // FIRE HOSE label
      addBox(x + nx * 0.16, y - 0.05, z + nz * 0.16, nx ? 0.02 : 0.1, 0.1,
        nx ? 0.1 : 0.02, 0xe8d44f, { cast: false });                           // latch
    };

    // ---- pinned paper (1 mesh) --------------------------------------------
    // Thin, tilted a hair off true, deterministic: notice boards, work
    // rosters, a visiting-hours sheet. The tilt is what stops six of them
    // reading as a printed texture.
    K.paper = function (x, y, z, face, w, h, o) {
      o = o || {};
      const n = nrm(face);
      const m = addBox(x, y, z, n[0] ? 0.015 : w, h, n[0] ? w : 0.015,
        o.color != null ? o.color : 0xece7d6, { cast: false, receive: false });
      const tilt = o.tilt != null ? o.tilt : (h01(x, z, 0x9101) - 0.5) * 0.16;
      if (n[0]) m.rotation.x = tilt; else m.rotation.z = tilt;
      return m;
    };

    // ---- milk crate (2 meshes) --------------------------------------------
    // RETURNS ITS MESHES (PRISON_PROP_USE_V1). It returned undefined, so a
    // caller could draw a crate and then had no way to hand it to
    // systems/pushables.js — the same "two services that are both about
    // furniture could not be composed" gap city/furniture.js:266 fixed with
    // its own `parts`. Additive: nothing can regress on a return value that
    // used to be undefined.
    K.crate = function (x, y, z, o) {
      o = o || {};
      const c = o.color != null ? o.color : 0x3a6ea5;
      const s = o.s || 0.44;
      const body = addBox(x, y, z, s, s * 0.72, s, c, { cast: false });
      const rim = addBox(x, y + s * 0.36, z, s + 0.03, 0.05, s + 0.03, 0x2d5580, { cast: false }); // rim
      return { parts: [body, rim], s: s, top: y + s * 0.36 + 0.025 };
    };
    // a stack of cafeteria trays (1 mesh per tray)
    K.trayStack = function (x, y, z, n, color) {
      for (let i = 0; i < n; i++)
        addBox(x, y + i * 0.05, z, 0.46, 0.035, 0.34,
          color != null ? color : 0xb8bec6, { cast: false });
    };

    // ---- the classic bolted round chow table (10 meshes) ------------------
    // Pedestal, four stools on angled arms, no loose furniture — a prison
    // table is one welded object bolted to the slab. Seats are declared to
    // city/propuse.js at their REAL cushion height, so a body sits ON the
    // stool instead of squatting through it.
    K.roundTable = function (x, z, o) {
      o = o || {};
      const top = o.top != null ? o.top : 0.76, seatY = o.seat != null ? o.seat : 0.47;
      const R = o.r != null ? o.r : 0.62, arm = o.arm != null ? o.arm : 0.86;
      const tone = o.tone != null ? o.tone : 0xcfd4cb, steel = 0x6b7480;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.09, 12),
        CBZ.cmat ? CBZ.cmat(tone) : CBZ.mat(tone));
      t.position.set(x, top, z); t.castShadow = false; t.receiveShadow = true;
      S.add(t);
      if (CBZ.colliders) CBZ.colliders.push({    // waist-high obstacle, not a pillar
        minX: x - R, maxX: x + R, minZ: z - R, maxZ: z + R, y0: 0, y1: top + 0.09, ref: t,
      });
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, top, 8),
        CBZ.cmat ? CBZ.cmat(steel) : CBZ.mat(steel));
      ped.position.set(x, top / 2, z); ped.castShadow = false; S.add(ped);
      for (let i = 0; i < 4; i++) {
        const a = (o.spin != null ? o.spin : 0.79) + i * HALF;
        const sx = x + Math.cos(a) * arm, sz = z + Math.sin(a) * arm;
        // r128 rotates local +x to (cos t, -sin t) about Y, so the strut needs
        // ry = -a to lie ALONG the arm. Building it axis-aligned instead gives
        // a square plate at 45 deg, which is what this looked like first pass.
        const armM = addBox((x + sx) / 2, seatY - 0.09, (z + sz) / 2,
          arm, 0.07, 0.09, steel, { cast: false });
        armM.rotation.y = -a;
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 10),
          CBZ.cmat ? CBZ.cmat(o.seatTone != null ? o.seatTone : 0x3a6ea5) : CBZ.mat(0x3a6ea5));
        st.position.set(sx, seatY, sz); st.castShadow = false; st.receiveShadow = true;
        S.add(st);
        // NO DECOYS (world/clutter.js's rule): a stool you walk through is a
        // decoy. Height-gated at 0.55 like the mess benches, so it is a
        // shin-high obstacle rather than an invisible column.
        if (CBZ.colliders) CBZ.colliders.push({
          minX: sx - 0.2, maxX: sx + 0.2, minZ: sz - 0.2, maxZ: sz + 0.2,
          y0: 0, y1: 0.55, ref: st,
        });
        if (CBZ.roomSeatAnchor)
          CBZ.roomSeatAnchor(sx, 0, sz, Math.atan2(x - sx, z - sz), "stool", null,
            { cushion: seatY + 0.035, floorBelow: 0 });
      }
    };

    /* ======================================================================
       INTERIOR FINISHES (2026-09-27, owner: "rearranging interiors, redoing
       ground, ceiling height, ceiling lighting, walls, every scene detail...
       just cleanly make them realistic").

       Every prison room used to be a roomShell: one flat-colour floor slab,
       four 6 m walls, a roof slab at the wall top, fluorescent sticks hung
       0.4 m under it and a painted plank stuck on the wall as a "dado". This
       is the finish layer a real interior has, as four verbs:

         K.floor(x0,x1,z0,z1, kind, tint)   a floor finish at real tile scale
         K.ceiling(rect, y, o)              a closed ceiling at a real height,
                                            with its fittings (one merged lens
                                            mesh per room on the lights-out
                                            schedule, one merged housing mesh)
         K.trim(rect, doors, o)             vinyl cove base + a painted block
                                            dado with its rail, split at doors
         K.finish(rect, o)                  all three, the one-line adoption

       SURFACES are canvas textures at real module sizes (VCT 305 mm, quarry
       tile 152 mm, glazed wall tile 152 mm, lay-in ceiling 610 mm, carpet
       tile 500 mm, sealed slab with saw cuts at 4 m), UVs in world metres via
       world/prisonkit.js's worldUV. WALLS get no texture here on purpose:
       an untextured prison slab is what world/prisonlook.js paints as 400 x
       200 running-bond block (the brick the owner signed off in the cell
       house), so a room's walls just have to stop carrying a skin. The dado
       is tagged prKind 1 so it gets the same joints, one tone darker.
       ====================================================================== */
    const KIT = CBZ.prisonKit || null;
    function fh(x, y, s) {
      let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    // tileable value noise over [0,1)^2 on an f-lattice
    function fn(u, v, f, s) {
      const x = u * f, y = v * f, x0 = Math.floor(x), y0 = Math.floor(y);
      const tx = x - x0, ty = y - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = fh(x0 % f, y0 % f, s), b = fh((x0 + 1) % f, y0 % f, s);
      const c = fh(x0 % f, (y0 + 1) % f, s), d = fh((x0 + 1) % f, (y0 + 1) % f, s);
      return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
    function paintC(size, paint) {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d");
      const img = g.createImageData(size, size), D = img.data, px = [0, 0, 0];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        paint(x / size, y / size, px, x, y);
        const i = (y * size + x) * 4;
        D[i] = px[0] < 0 ? 0 : px[0] > 255 ? 255 : px[0];
        D[i + 1] = px[1] < 0 ? 0 : px[1] > 255 ? 255 : px[1];
        D[i + 2] = px[2] < 0 ? 0 : px[2] > 255 ? 255 : px[2];
        D[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      return c;
    }
    const gr = (px, l) => { px[0] = px[1] = px[2] = l; };
    // distance (in px) to the nearest line of an n x n grid on a size canvas
    const edge = (x, y, cell) => { const a = x % cell, b = y % cell; return Math.min(a, cell - 1 - a, b, cell - 1 - b); };
    const SURF_TILE = { vct: 1.2192, quarry: 1.2192, walltile: 0.6096, acoustic: 1.2192, carpet: 1.0, slab: 4.0 };
    const SURF_CANVAS = {};
    function surfCanvas(kind) {
      if (SURF_CANVAS[kind]) return SURF_CANVAS[kind];
      let c;
      if (kind === "vct") {
        // 4 x 4 tiles of 305 mm; VCT is a pressed-chip sheet, so the mottle is
        // STREAKY, and it runs a quarter turn from tile to tile (ashlar laid)
        c = paintC(512, function (u, v, px, x, y) {
          const tx = (x / 128) | 0, ty = (y / 128) | 0;
          const rot = (tx + ty) & 1;
          const m = rot ? fn(u, v * 0.25 + 0.5, 96, 11 + tx) : fn(u * 0.25 + 0.5, v, 96, 11 + ty);
          let l = 224 + (fh(tx, ty, 7) - 0.5) * 12 + (m - 0.5) * 22 + (fn(u, v, 8, 13) - 0.5) * 8;
          const chip = fn(u, v, 180, 17);
          if (chip > 0.8) l += 14; else if (chip < 0.16) l -= 16;
          const e = edge(x, y, 128);
          if (e < 1) l = 158; else if (e < 2) l -= 12;
          gr(px, l);
        });
      } else if (kind === "quarry") {
        // 8 x 8 red quarry tiles of 152 mm in a 6 mm cement grout
        c = paintC(512, function (u, v, px, x, y) {
          const tx = (x / 64) | 0, ty = (y / 64) | 0;
          const e = edge(x, y, 64);
          if (e < 2) {
            const g = 118 + (fn(u, v, 64, 21) - 0.5) * 26;
            px[0] = g; px[1] = g * 0.95; px[2] = g * 0.88;
            return;
          }
          const k = 1 + (fh(tx, ty, 23) - 0.5) * 0.16 + (fn(u, v, 48, 24) - 0.5) * 0.12 - (e < 4 ? 0.05 : 0);
          const spot = fn(u, v, 200, 25) > 0.83 ? 0.9 : 1;
          px[0] = 158 * k * spot; px[1] = 74 * k * spot; px[2] = 52 * k * spot;
        });
      } else if (kind === "walltile") {
        // 4 x 4 glazed tiles of 152 mm, stack bond, pale grout, cushion edge
        c = paintC(256, function (u, v, px, x, y) {
          const tx = (x / 64) | 0, ty = (y / 64) | 0;
          const e = edge(x, y, 64);
          let l;
          if (e < 1.5) l = 196 + (fn(u, v, 32, 31) - 0.5) * 16;
          else l = 240 + (fh(tx, ty, 33) - 0.5) * 6 - (e < 5 ? (5 - e) * 2.2 : 0) + (fn(u, v, 12, 34) - 0.5) * 4;
          gr(px, l);
        });
      } else if (kind === "acoustic") {
        // 2 x 2 lay-in tiles of 610 mm: fissured mineral fibre on a 24 mm
        // white T-bar grid with a shadow line either side of each tee
        c = paintC(512, function (u, v, px, x, y) {
          const e = edge(x, y, 256);
          if (e < 4) { gr(px, 244); return; }
          if (e < 5.5) { gr(px, 196); return; }
          let l = 232 + (fn(u, v, 140, 41) - 0.5) * 18 + (fn(u, v, 10, 42) - 0.5) * 6;
          if (Math.abs(fn(u, v, 36, 43) - 0.5) < 0.018) l -= 34;          // fissures
          if (fn(u, v, 256, 44) > 0.86) l -= 26;                          // pinholes
          gr(px, l);
        });
      } else if (kind === "carpet") {
        // 2 x 2 carpet tiles of 500 mm, loop pile, laid quarter-turn
        c = paintC(256, function (u, v, px, x, y) {
          const tx = (x / 128) | 0, ty = (y / 128) | 0;
          const rot = (tx + ty) & 1;
          const rib = rot ? Math.sin(u * Math.PI * 2 * 96) : Math.sin(v * Math.PI * 2 * 96);
          let l = 212 + rib * 7 + (fn(u, v, 128, 51) - 0.5) * 26 + (fn(u, v, 6, 52) - 0.5) * 10;
          if (edge(x, y, 128) < 1) l -= 18;
          gr(px, l);
        });
      } else {
        // sealed concrete slab: saw cuts on the 4 m tile edge, trowel clouding,
        // burnish where people walk, pores
        c = paintC(512, function (u, v, px, x, y) {
          let l = 214 + (fn(u, v, 3, 61) - 0.5) * 26 + (fn(u, v, 14, 62) - 0.5) * 12 + (fn(u, v, 60, 63) - 0.5) * 8;
          if (fn(u, v, 220, 64) > 0.87) l -= 22;
          const e = edge(x, y, 512);
          if (e < 1.2) l = 140; else if (e < 2.5) l -= 16;
          gr(px, l);
        });
      }
      SURF_CANVAS[kind] = c;
      return c;
    }
    const SMATS = new Map();
    const SURF_ROUGH = { vct: 0.42, quarry: 0.7, walltile: 0.22, acoustic: 0.96, carpet: 1.0, slab: 0.52 };
    const SURF_BUMP = { vct: 0.002, quarry: 0.012, walltile: 0.006, acoustic: 0.008, carpet: 0.004, slab: 0.004 };
    K.surf = function (kind, tint, rough) {
      const key = kind + ":" + (tint == null ? "" : tint) + ":" + (rough == null ? "" : rough);
      let m = SMATS.get(key);
      if (m) return m;
      const t = new THREE.CanvasTexture(surfCanvas(kind));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      m = new THREE.MeshStandardMaterial({
        color: tint != null ? tint : 0xffffff, map: t, bumpMap: t,
        bumpScale: SURF_BUMP[kind] || 0.003,
        roughness: rough != null ? rough : (SURF_ROUGH[kind] != null ? SURF_ROUGH[kind] : 0.8),
        // LOW env: the shared environment map is the OUTDOOR sky, and at a
        // grazing angle a sealed floor mirrored it as a white sheet across
        // every room. Indoors a finish reflects a ceiling, not the sky.
        metalness: 0, envMap: CBZ.ENV || null, envMapIntensity: kind === "walltile" ? 0.3 : 0.12,
      });
      m.name = "prison-finish-" + key;
      if (typeof CBZ.gfxRegisterPbr === "function") { try { CBZ.gfxRegisterPbr(m); } catch (e) {} }
      SMATS.set(key, m);
      return m;
    };
    // re-skin an addBox mesh with a finish; `anchor` puts a grid line through
    // a chosen point (a room's centre) so the border tiles come out even
    K.skinWith = function (mesh, kind, tint, anchor, rough) {
      if (!mesh || !KIT) return mesh;
      mesh.material = K.surf(kind, tint, rough);
      const p = mesh.position;
      KIT.worldUV(mesh.geometry, SURF_TILE[kind] || 2,
        anchor ? { x: p.x - anchor.x, y: p.y - (anchor.y || 0), z: p.z - anchor.z } : p);
      mesh.userData.prisonSkin = kind;
      mesh.receiveShadow = true;
      return mesh;
    };
    // a floor finish over a whole rect, the same slab roomShell lays (top at
    // 0.06), so K.floorTop and every painted line keep reading it
    K.floor = function (x0, x1, z0, z1, kind, tint, o) {
      o = o || {};
      const m = addBox((x0 + x1) / 2, o.top != null ? o.top - 0.04 : 0.02, (z0 + z1) / 2,
        x1 - x0, 0.08, z1 - z0, tint != null ? tint : 0xb0b4b8, { cast: false });
      // a floor faces the sky term head-on (the rooms' lids cast no shadow), so
      // at the wall's tint it photographs two stops lighter than the wall it
      // meets: floors are laid a shade down to read as the colour asked for
      const t = new THREE.Color(tint != null ? tint : 0xb0b4b8).multiplyScalar(o.lift != null ? o.lift : 0.78).getHex();
      return K.skinWith(m, kind, t, o.anchor || { x: (x0 + x1) / 2, z: (z0 + z1) / 2 }, o.rough);
    };

    // ---- merged geometry: many small parts, one mesh -----------------------
    function Merge() { this.g = []; }
    Merge.prototype.box = function (x, y, z, w, h, d, ry) {
      const g = new THREE.BoxGeometry(w, h, d);
      if (ry) g.rotateY(ry);
      g.translate(x, y, z); this.g.push(g); return this;
    };
    Merge.prototype.cyl = function (x, y, z, r0, r1, h, seg, open, rx, rz) {
      const g = new THREE.CylinderGeometry(r0, r1, h, seg || 10, 1, !!open);
      if (rx) g.rotateX(rx);
      if (rz) g.rotateZ(rz);
      g.translate(x, y, z); this.g.push(g); return this;
    };
    Merge.prototype.mesh = function (material, o) {
      if (!this.g.length) return null;
      const BGU = THREE.BufferGeometryUtils;
      let geo = null;
      if (BGU && BGU.mergeBufferGeometries) {
        const list = this.g.map((q) => q.index ? q.toNonIndexed() : q);
        geo = BGU.mergeBufferGeometries(list, false);
        for (const q of this.g) q.dispose();
      }
      if (!geo) {                                     // no utils: a group of parts
        const grp = new THREE.Group();
        for (const q of this.g) grp.add(new THREE.Mesh(q, material));
        S.add(grp); return grp;
      }
      const m = new THREE.Mesh(geo, material);
      m.castShadow = !!(o && o.cast); m.receiveShadow = true;
      S.add(m);
      this.g = [];
      return m;
    };
    K.Merge = Merge;

    /* ---- K.ceiling(rect, y, o) --------------------------------------------
       rect: the room's INNER faces. y: the finished ceiling height.
       o.kind "acoustic" (lay-in grid) | "slab" (painted hard ceiling)
       o.lights "troffer" | "pendant" | "vapor" | "none"
       o.nx / o.nz fittings each way (derived from the room when absent),
       o.along "x" | "z" for linear fittings, o.drop pendant drop, o.skip(x,z)
       vetoes a position (over a cage, a hood). The slab blocks LOS — the
       camera's ceiling probe and the boom's own sweep both see it — and is
       never solid (world/roofs.js's header says why a lid can't be).
       Registers ONE fixture record per room with the lights-out schedule. */
    K.ceilings = [];
    K.ceiling = function (R, y, o) {
      o = o || {};
      const w = R.x1 - R.x0, d = R.z1 - R.z0, cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2;
      const kind = o.kind || "acoustic";
      const tint = o.tint != null ? o.tint : (kind === "acoustic" ? 0xf2f0ea : 0xd6d8d6);
      const lid = addBox(cx, y + 0.03, cz, w + 0.12, 0.06, d + 0.12, tint, { cast: false, blockLOS: true });
      K.skinWith(lid, kind, tint, { x: cx, y: 0, z: cz });
      // wall angle: the L-trim a lay-in ceiling sits on, or a shadow gap on a
      // hard one. It is what makes the ceiling MEET the wall.
      const trim = new Merge();
      const ta = kind === "acoustic" ? 0.025 : 0.018;
      trim.box(cx, y - ta / 2, R.z0 + 0.012, w, ta, 0.024).box(cx, y - ta / 2, R.z1 - 0.012, w, ta, 0.024)
        .box(R.x0 + 0.012, y - ta / 2, cz, 0.024, ta, d).box(R.x1 - 0.012, y - ta / 2, cz, 0.024, ta, d);
      const lights = o.lights || "troffer";
      const lens = new Merge(), house = new Merge();
      let n = 0;
      const G = 0.6096;
      const along = o.along || (w >= d ? "x" : "z");
      const nx = o.nx || Math.max(1, Math.round(w / (lights === "pendant" ? 3.6 : 3.0)));
      const nz = o.nz || Math.max(1, Math.round(d / (lights === "pendant" ? 3.6 : 3.0)));
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        let x = R.x0 + (i + 0.5) * w / nx, z = R.z0 + (j + 0.5) * d / nz;
        if (lights === "troffer" && kind === "acoustic") {
          // snap into the grid: a 2 x 4 troffer spans two cells the long way
          if (along === "x") { x = cx + Math.round((x - cx) / G) * G; z = cz + (Math.round((z - cz) / G - 0.5) + 0.5) * G; }
          else { z = cz + Math.round((z - cz) / G) * G; x = cx + (Math.round((x - cx) / G - 0.5) + 0.5) * G; }
        }
        if (o.skip && o.skip(x, z)) continue;
        const ax = along === "x";
        if (lights === "troffer") {
          // 2 x 4 parabolic troffer: a white frame, a lens, a louvre spine and
          // three cross blades (the grille is what reads as "office light")
          const L = 1.2192, W = G;
          house.box(x, y - 0.008, z, ax ? L : W, 0.016, ax ? W : L);
          lens.box(x, y - 0.018, z, ax ? L - 0.07 : W - 0.07, 0.008, ax ? W - 0.07 : L - 0.07);
          house.box(x, y - 0.034, z, ax ? L - 0.08 : 0.024, 0.03, ax ? 0.024 : L - 0.08);
          for (const t of [-0.3, 0, 0.3]) house.box(ax ? x + t : x, y - 0.034, ax ? z : z + t, ax ? 0.02 : W - 0.08, 0.03, ax ? W - 0.08 : 0.02);
        } else if (lights === "vapor") {
          // surface vapour-tight linear: grey body, frosted lens, two clips
          const L = 1.26;
          house.box(x, y - 0.045, z, ax ? L : 0.17, 0.09, ax ? 0.17 : L);
          lens.box(x, y - 0.115, z, ax ? L - 0.06 : 0.13, 0.06, ax ? 0.13 : L - 0.06);
          for (const s of [-0.4, 0.4]) house.box(ax ? x + s : x, y - 0.115, ax ? z : z + s, ax ? 0.03 : 0.15, 0.075, ax ? 0.15 : 0.03);
        } else if (lights === "pendant") {
          // industrial dome on a stem, with a wire guard under the lamp
          const drop = o.drop != null ? o.drop : 0.55, by = y - drop;
          house.cyl(x, y - drop / 2, z, 0.018, 0.018, drop, 6);
          house.cyl(x, by + 0.07, z, 0.09, 0.11, 0.14, 10);
          house.cyl(x, by - 0.1, z, 0.12, 0.34, 0.24, 14, true);
          lens.cyl(x, by - 0.2, z, 0.3, 0.3, 0.02, 14);
          house.box(x, by - 0.27, z, 0.6, 0.014, 0.014).box(x, by - 0.27, z, 0.014, 0.014, 0.6);
        }
        n++;
      }
      trim.mesh(CBZ.cmat ? CBZ.cmat(kind === "acoustic" ? 0xeae8e2 : 0x9aa0a6) : CBZ.mat(0xeae8e2));
      // the reflector is an open cone seen from below and inside: its own
      // double-sided material (never a shared cmat, which would flip every
      // other user of that colour to double-sided)
      if (lights === "pendant") house.mesh(new THREE.MeshLambertMaterial({ color: 0x5d656e, side: THREE.DoubleSide }));
      else house.mesh(CBZ.cmat ? CBZ.cmat(lights === "vapor" ? 0xc9cdd1 : 0xe9e7e0) : CBZ.mat(0xe9e7e0));
      const tone = o.tone != null ? o.tone : 0xfff8ea, em = o.emissive != null ? o.emissive : 0xfff0d2;
      const lm = lens.mesh(new THREE.MeshLambertMaterial({ color: tone, emissive: em, emissiveIntensity: 1.0 }));
      if (lm) fixture(lm, cx, cz, tone, em, Math.hypot(w, d) / 2 + 1, o.circuit || "room");
      const rec = { id: o.id || "room", x0: R.x0, x1: R.x1, z0: R.z0, z1: R.z1, y: y, n: n, lid: lid };
      K.ceilings.push(rec);
      return rec;
    };

    /* ---- K.trim(rect, doors, o) -------------------------------------------
       doors: [{ side: "N"|"S"|"E"|"W", a0, a1 }] — the opening's extent along
       that wall (x for N/S, z for E/W). o.base (vinyl cove colour, null = no
       base), o.dado (paint colour, null = none), o.dadoH (1.2), o.rail. */
    K.trim = function (R, doors, o) {
      o = o || {};
      doors = doors || [];
      const base = new Merge(), dado = new Merge(), rail = new Merge();
      const dH = o.dadoH || 1.2;
      const sides = [["N", R.z0, R.x0, R.x1, 1], ["S", R.z1, R.x0, R.x1, -1], ["W", R.x0, R.z0, R.z1, 1], ["E", R.x1, R.z0, R.z1, -1]];
      for (const s of sides) {
        const horiz = s[0] === "N" || s[0] === "S", line = s[1], inw = s[4];
        const gaps = doors.filter((g) => g.side === s[0]).map((g) => [g.a0, g.a1]).sort((a, b) => a[0] - b[0]);
        let cur = s[2];
        const runs = [];
        for (const g of gaps) { if (g[0] > cur + 0.02) runs.push([cur, g[0]]); cur = Math.max(cur, g[1]); }
        if (s[3] > cur + 0.02) runs.push([cur, s[3]]);
        for (const r of runs) {
          const mid = (r[0] + r[1]) / 2, len = r[1] - r[0];
          const put = (M, off, y, h, t) => horiz ? M.box(mid, y, line + inw * off, len, h, t) : M.box(line + inw * off, y, mid, t, h, len);
          if (o.base !== null) put(base, 0.008, 0.06 + 0.05, 0.1, 0.016);
          if (o.dado != null) put(dado, 0.004, 0.06 + dH / 2, dH, 0.008);
          if (o.dado != null && o.rail !== null) put(rail, 0.01, 0.06 + dH, 0.045, 0.02);
        }
      }
      if (o.base !== null) base.mesh(CBZ.cmat ? CBZ.cmat(o.base != null ? o.base : 0x2b2d30) : CBZ.mat(0x2b2d30));
      if (o.dado != null) {
        if (o.tile != null) {
          // a glazed tile wainscot (kitchens, wet rooms): real 152 mm tiles
          const dm = dado.mesh(K.surf("walltile", o.tile));
          if (dm && dm.geometry && KIT) { KIT.worldUV(dm.geometry, SURF_TILE.walltile, null); dm.userData.prisonSkin = "walltile"; }
        } else {
          const dm = dado.mesh(new THREE.MeshLambertMaterial({ color: o.dado }));
          if (dm) dm.userData.prKind = 1;         // world/prisonlook.js: block joints
        }
        rail.mesh(CBZ.cmat ? CBZ.cmat(o.rail != null ? o.rail : 0x3b4550) : CBZ.mat(0x3b4550));
      }
    };

    // the one-line adoption: floor + trim + ceiling for a rect of INNER faces
    K.finish = function (R, o) {
      o = o || {};
      if (o.floor) K.floor(R.x0 - 0.25, R.x1 + 0.25, R.z0 - 0.25, R.z1 + 0.25, o.floor, o.floorTint,
        { anchor: o.floorAnchor, rough: o.floorRough });
      K.trim(R, o.doors, o);
      return o.ceilingY ? K.ceiling(R, o.ceilingY, Object.assign({ id: o.id }, o.ceiling || {})) : null;
    };

    return K;
  })();
  CBZ.prisonDress = PD;

  /* ========================================================================
     THE MESS HALL (rebuilt 2026-09-27, de-slop).
     WHAT WAS HERE: three 4.4 m planks on two end boards with park benches
     either side (CBZ.furnish.bench: slatted wooden benches with cast-iron
     feet), a 1.6 m-tall grey block as a "serving counter" with three glowing
     orange boxes on it for food, a kitchen that was a glowing orange panel
     painted on the wall, three coloured milk crates stacked in a corner for
     no reason, a yellow route line and chevrons on the floor, a painted plank
     for a dado with a grey stripe for a scuff, and joists + sticks hung under
     an open top at 5.6 m.
     WHAT IT IS NOW: a sealed concrete hall under a 4.2 m painted ceiling lit
     by caged pendant fittings; three bolted steel tables with ten fixed
     stools each (the prison fixture: one welded frame, stools on arms, feet
     bolted to the slab); a steel serving line off the west wall with a tray
     slide, food pans in the wells, a sneeze guard and heat lamps, servers
     behind it on quarry tile with the kitchen door and the pass-through
     shutter at their backs; the dish return, bins and mop at the north end.

     GEOMETRY IT HOLDS (world/escape_routes.js's floor hatches):
       Yard Drainage Ditch  x[-26.275,-24.525] z[ 9.625,11.375]
       Perimeter Culvert    x[-26.075,-24.325] z[17.325,19.075]
       Kitchen Grease Duct  x[-27.975,-26.225] z[18.325,20.075]
     The table rows (stools +/-0.8 from z 8.2 / 12.4 / 16.2) clear all three
     in z; the first two hatches lie in the 1.6 m queue lane in front of the
     line, the grease duct at the servers' north end past the counter. The
     door bay (z 12.3..15.7) is clear from the east wall to the tables.
     ======================================================================== */
  const WX0 = -28.75, WX1 = -19.25, WZ0 = 6.25, WZ1 = 21.75;   // inner faces
  const KIT = CBZ.prisonKit || null;
  const steelSkin = (m, tint) => { if (KIT && m) KIT.skinBox(m, "steel", tint); return m; };

  // ---- 1. FINISHES ---------------------------------------------------------
  PD.floor(-29, -19, 6, 22, "slab", 0x8e9296);
  PD.floor(WX0, -27.45, WZ0, WZ1, "quarry", 0xffffff, { top: 0.064 });        // servers' side
  PD.trim({ x0: WX0, x1: WX1, z0: WZ0, z1: WZ1 }, [{ side: "E", a0: 12.3, a1: 15.7 }],
    { dado: 0x6d7784, dadoH: 1.25, base: 0x2b2d30 });
  PD.ceiling({ x0: WX0, x1: WX1, z0: WZ0, z1: WZ1 }, 4.2,
    { id: "cafeteria", kind: "slab", tint: 0xd4d6d4, lights: "pendant", nx: 3, nz: 4, drop: 0.5 });

  // ---- 2. BOLTED STEEL TABLES -----------------------------------------------
  // Long axis x, ten fixed stools on arms off a welded spine, two pedestals
  // bolted to the slab. The top is SOLID and height-gated like the old slab
  // (an obstacle at the waist, not a pillar); each row of stools is one
  // shin-high strip collider; every stool is a declared seat at its real top.
  const TX = -23.1, TL = 3.6, SOFF = 0.62, SEAT_TOP = 0.49;
  const frame = new PD.Merge(), stools = new PD.Merge();
  function messTable(z) {
    steelSkin(addBox(TX, 0.765, z, TL, 0.05, 0.78, 0xc2c7cc, { solid: true, y0: 0, y1: 0.95 }), 0xc2c7cc);
    frame.box(TX, 0.72, z, TL - 0.2, 0.05, 0.6);                       // apron under the top
    frame.box(TX, 0.4, z, TL - 0.5, 0.08, 0.1);                        // the spine
    for (const s of [-1, 1]) {
      frame.box(TX + s * 1.3, 0.39, z, 0.1, 0.66, 0.1);                // pedestal
      frame.box(TX + s * 1.3, 0.075, z, 0.14, 0.03, 0.9);              // bolted foot plate
    }
    for (const side of [-1, 1]) {
      const sz = z + side * SOFF;
      for (let k = 0; k < 5; k++) {
        const sx = TX + (k - 2) * 0.72;
        frame.box(sx, 0.4, z + side * SOFF / 2, 0.05, 0.05, SOFF);     // arm off the spine
        frame.box(sx, 0.43, sz, 0.05, 0.05, 0.05);                     // stool post
        stools.cyl(sx, SEAT_TOP - 0.022, sz, 0.18, 0.17, 0.045, 14);
        seat(sx, sz, side < 0 ? 0 : Math.PI, "stool", SEAT_TOP);
      }
      if (CBZ.colliders) CBZ.colliders.push({ minX: TX - 1.66, maxX: TX + 1.66, minZ: sz - 0.18, maxZ: sz + 0.18, y0: 0, y1: 0.55 });
    }
  }
  [8.2, 12.4, 16.2].forEach(messTable);
  frame.mesh(CBZ.cmat(0x4f5760));
  stools.mesh(CBZ.cmat(0x5a6f86));
  // somebody's unfinished tray: moulded compartments with the day's food
  function tray(x, z, food) {
    addBox(x, 0.8, z, 0.46, 0.02, 0.34, 0xa8743f, { cast: false });
    addBox(x - 0.09, 0.813, z, 0.2, 0.012, 0.24, food[0], { cast: false });
    addBox(x + 0.13, 0.813, z - 0.06, 0.14, 0.012, 0.12, food[1], { cast: false });
    addBox(x + 0.13, 0.813, z + 0.08, 0.14, 0.012, 0.1, food[2], { cast: false });
  }
  tray(-24.2, 8.2 - 0.2, [0x7a4a2a, 0xe6dcb8, 0x6b8a3a]);
  tray(-22.0, 16.2 + 0.2, [0xe9e3cf, 0xd9a640, 0x7a4a2a]);

  // ---- 3. THE SERVING LINE --------------------------------------------------
  // A steel steam table 0.8 m deep off the west wall, servers behind it,
  // the line in front. Top at 0.92 (a real counter), not 1.6.
  const LX = -27.05, LZ = 13.7, LL = 7.8, TOP = 0.92;
  steelSkin(addBox(LX, 0.47, LZ, 0.8, 0.82, LL, 0xaab1b8, { solid: true, y0: 0, y1: TOP }), 0xaab1b8);
  steelSkin(addBox(LX, TOP - 0.02, LZ, 0.9, 0.04, LL + 0.06, 0xd3d8dc, { cast: false }), 0xd3d8dc);
  addBox(LX + 0.39, 0.11, LZ, 0.03, 0.1, LL, 0x2b2f35, { cast: false });              // toe kick
  // the wells and what is in them — five wells, two pans each, real food colours
  const FOOD = [[0x7a4a2a, 0x8a5a34], [0xe9e3cf, 0xe6dcb8], [0x6b8a3a, 0xd9a640], [0xb5552e, 0x7a4a2a], [0xe0c98a, 0x6b8a3a]];
  for (let i = 0; i < 5; i++) {
    const z = LZ - 3.0 + i * 1.5;
    addBox(LX + 0.05, TOP + 0.004, z, 0.6, 0.012, 1.34, 0x3a4048, { cast: false });   // the well rim
    for (const s of [-1, 1])
      addBox(LX + 0.05, TOP + 0.012, z + s * 0.33, 0.52, 0.012, 0.6, FOOD[i][s < 0 ? 0 : 1], { cast: false });
  }
  // tray slide: three tubes on brackets along the customer face
  for (const dx of [0.5, 0.62, 0.74]) PD.pipe(LX + dx, 0.86, LZ, LL - 0.2, "z", 0.016, 0xc3c9d0);
  for (let i = 0; i < 4; i++) addBox(LX + 0.6, 0.83, LZ - 3.6 + i * 2.4, 0.34, 0.03, 0.05, 0x8b95a1, { cast: false });
  // sneeze guard: posts, a clear pane, a top shelf with heat lamps under it
  for (let i = 0; i < 4; i++) addBox(LX + 0.34, TOP + 0.37, LZ - 3.6 + i * 2.4, 0.03, 0.74, 0.03, 0x9aa3ad, { cast: false });
  const glass = addBox(LX + 0.34, TOP + 0.5, LZ, 0.012, 0.42, LL - 0.4, 0xd8f0f7, { cast: false, receive: false });
  glass.material.transparent = true; glass.material.opacity = 0.22; glass.material.depthWrite = false;
  steelSkin(addBox(LX + 0.18, TOP + 0.76, LZ, 0.36, 0.025, LL - 0.2, 0xd3d8dc, { cast: false }), 0xd3d8dc);
  // the heat lamps under the shelf: on the kitchen's circuit, so the line
  // does not glow orange all night in an empty hall
  PD.fixture(addBox(LX + 0.14, TOP + 0.735, LZ, 0.07, 0.02, LL - 0.8, 0xffc98a, { emissive: 0xd8762a, ei: 0.45, cast: false }),
    LX + 0.14, LZ, 0xffc98a, 0xd8762a, 2.5, "room");
  // head of the line: a tray cart with a stack on it, and the cutlery
  // a stainless tray cabinet on casters (the body is still one solid box, a
  // cabinet is), its door, handle and plinth; the cutlery in a divided bin
  // with the handles standing up, not a grey brick
  steelSkin(addBox(LX, 0.47, 9.25, 0.7, 0.74, 0.5, 0xaab1b8, { solid: true, y0: 0, y1: 0.87 }), 0xaab1b8);
  {
    const C = new PD.Paint();
    C.box(0.352, 0.02, 0, 0.004, 0.6, 0.44, 0x8b939b);                                   // door leaf
    C.box(0.362, 0.18, 0.16, 0.02, 0.18, 0.025, 0x5a616a);                                // pull
    C.box(0, -0.38, 0, 0.66, 0.02, 0.46, 0x3a3f44);                                      // base frame
    for (const a of [-1, 1]) for (const b of [-1, 1]) C.cyl(a * 0.28, -0.415, b * 0.18, 0.04, 0.04, 0.03, 0x222428, 10, 0, HALF);
    C.box(0.2, 0.43, -0.2, 0.24, 0.1, 0.16, 0x6b7480);                                   // cutlery bin
    for (let i = 0; i < 9; i++)
      C.box(0.13 + (i % 3) * 0.07, 0.51, -0.25 + ((i / 3) | 0) * 0.05, 0.012, 0.08, 0.02, 0xc8ced4);
    C.mesh(LX, 0.47, 9.25);
  }
  PD.trayStack(LX - 0.08, 0.87, 9.3, 6, 0xa8743f);
  // the servers' wall: kitchen door, a closed pass-through shutter, a pan shelf
  (function serversWall() {
    const wx = WX0 + 0.02;
    addBox(wx + 0.03, 1.1, 7.5, 0.06, 2.2, 1.2, 0x39424e, { cast: false });           // frame
    addBox(wx + 0.06, 1.06, 7.5, 0.05, 2.08, 1.0, 0x6c7680, { cast: false });         // steel door leaf
    addBox(wx + 0.09, 1.55, 7.5, 0.02, 0.36, 0.26, 0x1f252c, { cast: false });        // wired vision panel
    addBox(wx + 0.09, 1.02, 7.18, 0.05, 0.04, 0.14, 0xb8bec4, { cast: false });       // pull
    addBox(wx + 0.09, 0.2, 7.5, 0.02, 0.24, 0.98, 0x9aa3ad, { cast: false });         // kick plate
    const sh = addBox(wx + 0.04, 1.8, 13.8, 0.05, 1.1, 3.2, 0x8d949c, { cast: false }); // shutter
    if (KIT) KIT.skinBox(sh, "roller", 0x8d949c);
    addBox(wx + 0.07, 2.42, 13.8, 0.14, 0.18, 3.4, 0x6b7480, { cast: false });        // shutter box
    for (const s of [-1, 1]) addBox(wx + 0.05, 1.8, 13.8 + s * 1.65, 0.08, 1.3, 0.08, 0x6b7480, { cast: false });
    steelSkin(addBox(wx + 0.16, 1.21, 13.8, 0.32, 0.04, 3.4, 0xd3d8dc, { cast: false }), 0xd3d8dc);   // pass ledge
    steelSkin(addBox(wx + 0.17, 1.95, 17.4, 0.34, 0.03, 1.6, 0xc3c9d0, { cast: false }), 0xc3c9d0);   // pan shelf
    for (let i = 0; i < 3; i++) addBox(wx + 0.17, 2.02 + i * 0.02, 17.4 + (i - 1) * 0.02, 0.3, 0.1, 0.5, 0xb8bec4, { cast: false });
  })();

  // ---- 4. DISH RETURN + SERVICE END (north wall) ----------------------------
  steelSkin(addBox(-24.1, 0.45, 21.3, 2.6, 0.9, 0.8, 0xa8afb8, { solid: true }), 0xa8afb8);
  steelSkin(addBox(-24.1, 0.93, 21.3, 2.7, 0.04, 0.9, 0xd3d8dc, { cast: false }), 0xd3d8dc);
  // the return hatch: an opening framed in stainless in the wall behind the
  // counter, the dark of the scullery beyond it (it was a black box sitting
  // on the counter top)
  addBox(-25.1, 1.4, WZ1 - 0.012, 1.3, 0.62, 0.02, 0x15181c, { cast: false });
  for (const s2 of [-1, 1]) steelSkin(addBox(-25.1 + s2 * 0.68, 1.4, WZ1 - 0.03, 0.06, 0.7, 0.05, 0xc3c9d0, { cast: false }), 0xc3c9d0);
  steelSkin(addBox(-25.1, 1.73, WZ1 - 0.03, 1.42, 0.06, 0.05, 0xc3c9d0, { cast: false }), 0xc3c9d0);
  PD.trayStack(-23.4, 0.96, 21.3, 3, 0x8a7f6d);                                         // dirty trays
  for (const b of [[-26.0, 20.9, 0x2f6b3a], [-25.0, 20.0, 0x3c424d]]) {                 // waste barrels
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.32, 0.9, 12), CBZ.cmat(b[2]));
    d.position.set(b[0], 0.45, b[1]); d.castShadow = false; d.receiveShadow = true;
    (CBZ.prisonRoot || CBZ.scene).add(d);
    // a round lid with a rolled rim, on a round bin (it was a 0.78 m SQUARE slab)
    const lid = addBox(b[0], 0.93, b[1], 0.1, 0.1, 0.1, 0x232a32, { cast: false });
    lid.geometry.dispose();
    lid.geometry = new PD.Paint()
      .cyl(0, 0, 0, 0.375, 0.385, 0.05, 0x232a32, 18)
      .add(new THREE.TorusGeometry(0.38, 0.018, 5, 20).rotateX(HALF).translate(0, -0.02, 0), 0x1b2027)
      .cyl(0, 0.04, 0, 0.05, 0.06, 0.03, 0x1b2027, 10)
      .geometry();
    lid.material = PD.vcMat();
    const bcol = { minX: b[0] - 0.36, maxX: b[0] + 0.36, minZ: b[1] - 0.36, maxZ: b[1] + 0.36, y0: 0, y1: 0.96, ref: d };
    if (CBZ.colliders) CBZ.colliders.push(bcol);
    // a wheelie bin half full of trays is ~22 kg and rolls when you walk into
    // it; a closed lidded drum is also the one thing here a man can stand on
    if (CBZ.pushProp) CBZ.pushProp({
      parts: [d, lid], x: b[0], z: b[1], hx: 0.36, hz: 0.36, y1: 0.96,
      mass: 22, kind: "barrel", col: bcol, leash: 5.0, stand: true, mode: "escape",
    });
  }
  // mop bucket + wringer, parked where the wet floor is
  /* A janitor's mop bucket: a tapered yellow tub on four casters with the
     water in it, the side-press wringer on its rim and the mop standing in
     it. It was a yellow box with a grey box on it and a stick planted in the
     floor beside it that stayed behind when the bucket was shoved. Same two
     parts, footprint and collider; the mop now rides with the bucket. */
  const mopB = addBox(-22.6, 0.28, 20.2, 0.1, 0.1, 0.1, 0xe8b93c, { cast: false });
  const mopW = addBox(-22.6, 0.58, 20.35, 0.1, 0.1, 0.1, 0x9aa3ad, { cast: false });
  mopB.geometry.dispose(); mopW.geometry.dispose();
  {
    const B = new PD.Paint(), Y0 = -0.28;                  // local: the tub mesh sits 0.28 up
    B.cyl(0, Y0 + 0.27, 0, 0.23, 0.19, 0.36, 0xe8b93c, 18, 0, 0, true);                 // tub wall
    B.cyl(0, Y0 + 0.095, 0, 0.19, 0.19, 0.02, 0xd9aa2e, 18);                             // floor
    B.add(new THREE.CircleGeometry(0.215, 18).rotateX(-HALF).translate(0, Y0 + 0.36, 0), 0x6a6e5e);   // grey water
    B.add(new THREE.TorusGeometry(0.23, 0.014, 5, 20).rotateX(HALF).translate(0, Y0 + 0.45, 0), 0xcfa12a);
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      B.cyl(a * 0.15, Y0 + 0.035, b * 0.15, 0.035, 0.035, 0.03, 0x222428, 10, 0, HALF);     // caster
      B.box(a * 0.15, Y0 + 0.075, b * 0.15, 0.04, 0.04, 0.04, 0x55595e);
    }
    B.cyl(0, Y0 + 0.62, -0.09, 0.012, 0.012, 1.2, 0x9a7a4e, 8, 0.18);                    // the mop handle, leaning
    B.cyl(0, Y0 + 0.2, -0.02, 0.1, 0.12, 0.16, 0xb9b6ad, 10);                            // its head, in the water
    mopB.geometry = B.geometry(); mopB.material = PD.vcMat();
    const W = new PD.Paint();                               // local: the wringer mesh sits 0.58 up, 0.15 back
    W.box(0, -0.06, 0, 0.3, 0.16, 0.14, 0x3a3f44);                                       // press box
    W.box(0, -0.06, 0.08, 0.26, 0.12, 0.02, 0x2c3035);
    W.cyl(0.19, 0.12, 0, 0.012, 0.012, 0.5, 0x3a3f44, 6, 0, -0.5);                         // the lever
    mopW.geometry = W.geometry(); mopW.material = PD.vcMat();
  }
  if (CBZ.pushProp) CBZ.pushProp({
    parts: [mopB, mopW], x: -22.6, z: 20.2, hx: 0.25, hz: 0.22, y1: 0.68,
    mass: 16, kind: "mopbucket", solid: true, leash: 5.0, mode: "escape",
  });
  // the wet-floor A-frame beside it: a 2 kg pushable, not a walk-through
  const wfParts = [];
  for (const s of [-1, 1]) {
    const w = addBox(-23.4 + s * 0.14, 0.38, 19.2, 0.03, 0.62, 0.3, 0xffd451, { cast: false });
    w.rotation.z = s * 0.22;
    wfParts.push(w);
  }
  if (CBZ.pushProp) CBZ.pushProp({
    parts: wfParts, x: -23.4, z: 19.2, hx: 0.2, hz: 0.16, y1: 0.69,
    mass: 2, kind: "wetfloor", solid: true, leash: 6.0, mode: "escape",
  });
  // a floor drain in the service end: a square grate flush in the slab
  addBox(-23.0, 0.062, 18.7, 0.34, 0.006, 0.34, 0x3c424d, { cast: false });
  for (let i = -2; i <= 2; i++) addBox(-23.0 + i * 0.06, 0.066, 18.7, 0.02, 0.004, 0.3, 0x1a1d22, { cast: false });

  // ---- 5. THE EAST WALL: menu board, clock, fire kit ------------------------
  // A menu board is a dark slab with light rows on it; into the room from the
  // east wall is -x, so every layer stacks toward more negative x.
  function board(z, y, w, h, rows, hue) {
    addBox(-19.32, y, z, 0.05, h, w, 0x232a32, { cast: false });
    addBox(-19.35, y + h / 2 - 0.12, z, 0.02, 0.14, w - 0.2, hue, { cast: false });
    for (let i = 0; i < rows; i++) {
      const rw = (w - 0.5) * (0.55 + PD.h01(z, i * 3.1, 0x9201) * 0.4);
      addBox(-19.35, y + h / 2 - 0.42 - i * 0.24, z - (w - 0.4 - rw) / 2, 0.02, 0.06, rw, 0xd8d2c4, { cast: false });
    }
  }
  board(18.6, 2.6, 2.4, 1.4, 4, 0xc94d3a);
  board(9.6, 2.5, 1.8, 1.0, 2, 0x3a6ea5);
  (function clock() {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16), CBZ.cmat(0xe6e9ed));
    c.position.set(-19.3, 3.45, 16.9); c.rotation.z = HALF; c.castShadow = false;
    (CBZ.prisonRoot || CBZ.scene).add(c);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.018, 6, 20), CBZ.cmat(0x2a2f38));
    rim.position.set(-19.31, 3.45, 16.9); rim.rotation.y = HALF; (CBZ.prisonRoot || CBZ.scene).add(rim);
    addBox(-19.34, 3.5, 16.9, 0.01, 0.11, 0.02, 0x2a2f38, { cast: false });
    addBox(-19.34, 3.45, 16.97, 0.01, 0.02, 0.15, 0x2a2f38, { cast: false });
  })();
  // a doorway needs a head: roomShell's gap is full height. The head runs
  // to the WALL TOP: it stopped at 4.95 and a blank red board 0.2 m thick
  // (a "sign" with nothing on it) half-filled the 1 m hole left above it.
  addBox(-19, 4.45, 14, 0.5, 3.1, 3.4, 0x8a929c, { cast: false });
  addBox(-19.3, 2.88, 14, 0.14, 0.16, 3.5, 0x6b7480, { cast: false });   // inside lintel nose
  addBox(-18.7, 2.88, 14, 0.14, 0.16, 3.5, 0x6b7480, { cast: false });   // yard-side nose
  // and a DOOR in it (it was a 3.4 m hole): a framed pair of steel leaves
  // with vision panels, hooked back against the yard face for the day's
  // traffic. A working door (world/corridorkit.js door): E shuts it, anybody
  // walking up opens it, a new run hooks it back.
  if (CBZ.corridorKit && CBZ.corridorKit.door) {
    CBZ.corridorKit.door({ id: "prison-canteen-door", label: "The canteen door", axis: "z", a0: 12.3, a1: 15.7, fixed: -19, t: 0.5, h: 2.8, y0: 0.06,
      swing: 1, hinge: 0, max: 1.0, keys: null, startOpen: true, autoShut: Infinity, build: CBZ.corridorKit.steelLeaf(0x4f5d6b) });
  }
  PD.lamp(-18.69, 3.4, 16.9, "x+");                                       // over the door, outside
  PD.extinguisher(-19.42, 1.1, 17.6, "x-");
  PD.hoseCab(-19.45, 1.6, 10.4, "x-");

  // The facade pass (world/building_dress.js) dresses whatever is registered
  // here. One line, and the outside of this room stops being a blank slab.
  if (PD.shell) PD.shell({
    id: "cafeteria", x0: -29, x1: -19, z0: 6, z1: 22, h: 6,
    door: "E", dc: 14, dw: 3.4, tone: 0x8a929c, face: "E",
  });
  });
})();
