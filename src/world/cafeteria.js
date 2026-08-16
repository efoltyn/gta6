/* ============================================================
   world/cafeteria.js — the mess hall on the west side of the yard.
   Long tables, a serving counter, trays. Where inmates mill about.

   NO-DECOY FIX (world/clutter.js's doctrine: every prop a body can meet
   must be solid). Every piece in here was drawn with `addBox(..., {})` —
   opts.solid defaults FALSY (world/materials.js:196) — so the mess tables,
   the benches and the 8 m serving counter were all walk-through scenery.
   They are real bodies now.

   PROPS WITH PURPOSE. The benches were sittable-LOOKING geometry that
   nothing could ever sit on. They now route through CBZ.furnish.bench
   (city/furniture.js — the ONE shared furniture kit), which owns the
   geometry AND registers the propuse sit anchors; the serving counter
   routes through CBZ.furnish.counter. Feature-detected: when the kit is
   absent the authored boxes below run instead, now solid and registering
   their own anchors, so the room is correct either way.

   The refectory layout, footprint and palette are UNCHANGED — this is an
   authored prison space, not a generated one. Only the furniture is real.

   LOAD ORDER: index.html parses this file at :405; city/furniture.js and
   city/propuse.js live in the CITY block (:629+). CBZ.roomSeatAnchor
   (world/roombuild.js, :404) is the pipe that makes seat registration
   survive that gap — it queues and flushes on `load`. Move furniture.js
   above roombuild.js and the CBZ.furnish path lights up with no edit here.

   ------------------------------------------------------------------
   PRISON_DRESS_V2 (2026-07-30) — THE CHOW HALL IS A LOAD-BEARING ROOM.
   ------------------------------------------------------------------
   systems/capture.js's DAY_BEAT literally calls this room ("CHOW — the
   line's forming in the cafeteria", :275). A room the sentence loop sends
   you to on a rotation is not scenery, so it gets the polish budget
   CLAUDE.md's gun-room grammar says to spend ASYMMETRICALLY on the rooms
   that matter: a real serving line (tray rail, sneeze guard, steam wells,
   heat lamps), a kitchen pass-through, a dish-return end, and the
   institutional shell (wainscot, scuff, beams, strip lights, signage).

   THE TABLES MOVED, AND THAT IS A BUG FIX, NOT TASTE. world/escape_routes.js
   drops THREE floor hatches inside this room's footprint — the Yard Drainage
   Ditch (-25.4, 10.5), the Perimeter Culvert (-25.2, 18.2) and the Kitchen
   Grease Duct (-27.1, 19.2) — and the two mess tables were sitting squarely
   on the first two. A 0.95 m-gated SOLID table slab over an escape hatch is
   an escape route you cannot stand on. The rows are now at z = 8.2 / 12.4 /
   16.2, every bench clear of all three hatch rects, with the aisle in front
   of the counter opening into three queue bays. Flag off → the old z = 10/18
   pair, byte for byte.

   THE KIT LIVES HERE FOR ONE REASON: LOAD ORDER. index.html parses
   cafeteria (:445) before lounge (:446) and southblock (:450), so this is
   the earliest of the three prison-dress consumers. CBZ.prisonDress is the
   shared vocabulary all three speak (caged lamp, scuff, wayfinding band,
   pipe run, strip light, extinguisher, hose cabinet, pinned paper, milk
   crate, round chow table) — one place to change what a prison fitting
   looks like, instead of three files each re-typing a cage out of boxes.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { addBox, roomShell } = CBZ;
  const HALF = Math.PI / 2;

  // Canonical declaration + doctrine comment: world/southblock.js. The
  // null-check idiom is idempotent, so whichever prison file parses first
  // sets the default and the rest no-op — which is what makes the flag
  // usable in cafeteria (:445) even though its home file loads at :450.
  if (CBZ.CONFIG.PRISON_DRESS_V2 == null) CBZ.CONFIG.PRISON_DRESS_V2 = true;
  const DRESS = !!CBZ.CONFIG.PRISON_DRESS_V2;
  /* PRISON_PROP_USE_V1 — canonical declaration + doctrine: world/southblock.js.
     THIS FILE IS THE SHARED KIT AND IT IS DELIBERATELY BARELY TOUCHED.
     CBZ.prisonDress is consumed by world/prisonwings.js, world/adminwing.js,
     world/roofs.js and world/building_dress.js — four files this pass does not
     own — so a change to lamp(), strip(), band(), dado(), scuff() or
     floorLine() ripples into ~20 rooms audited by somebody else. It stays a
     drawing vocabulary. The only kit change is K.crate handing back the meshes
     it drew (additive: the return value was undefined, so no existing caller
     can see it), and the only room changes are the two free-standing objects
     in the service end that a body walks into and could not move. */
  if (CBZ.CONFIG.PRISON_PROP_USE_V1 == null) CBZ.CONFIG.PRISON_PROP_USE_V1 = true;
  const USE = !!CBZ.CONFIG.PRISON_PROP_USE_V1;

  roomShell({
    x0: -29, x1: -19, z0: 6, z1: 22, h: 6,
    wall: 0x8a929c, floor: 0xb9c0c8,
    door: { side: "E", center: 14, width: 3.4 },
  });

  // sign over the door
  addBox(-19, 5.4, 14, 0.2, 0.9, 3.2, 0xc94d3a, { cast: false });

  // ---- shared plumbing --------------------------------------------------
  // Always invoke THROUGH the namespace (never a detached reference) so a kit
  // implemented with `this` still works, and swallow a throw so a broken kit
  // degrades to the authored boxes instead of killing the room.
  // -> null = the kit didn't draw it, use the fallback.
  function kit(name, x, y, z, yaw, o) {
    const F = CBZ.furnish;
    if (!F || typeof F[name] !== "function") return null;
    try { return { rec: F[name](x, y, z, yaw, o) || null }; } catch (e) { return null; }
  }
  // One-line pipe into city/propuse.js's seat registry, load-order-proof.
  // `cushion` = the cushion top ABOVE the floor, propuse's 7th `geom` argument:
  // without it the seat is undeclared, keeps the legacy squat pose and counts
  // in CBZ.propUseAudit().noGeom. We know our own boxes, so we always declare.
  function seat(x, z, face, kind, cushion) {
    const geom = cushion != null ? { cushion: cushion, floorBelow: 0 } : null;
    if (CBZ.roomSeatAnchor) CBZ.roomSeatAnchor(x, 0, z, face, kind, null, geom);
    else if (CBZ.propRegisterSeat) CBZ.propRegisterSeat(x, 0, z, face, kind, null, geom);
  }
  // re-file whatever anchors the kit reported, CARRYING its declared cushion.
  // propuse dedupes on a decimetre key over the same coordinates the kit used,
  // so this is a no-op when the kit already registered them itself.
  function reseat(r, fallbackFace, kind) {
    if (!r || !r.seats || !r.seats.length) return false;
    for (let i = 0; i < r.seats.length; i++) {
      const s = r.seats[i];
      if (!s) continue;
      seat(s.x, s.z, s.face != null ? s.face : (s.yaw != null ? s.yaw : fallbackFace),
        s.kind || kind, s.cushion);
    }
    return true;
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
    function nrm(face) {
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
    // Hospitals and prisons route people with coloured lines on the DECK, not
    // with signs — and a line on the floor is the one wayfinding a 3rd-person
    // camera can actually read.
    K.floorLine = function (x, z, len, axis, color, o) {
      o = o || {};
      return addBox(x, o.y != null ? o.y : 0.045, z,
        axis === "x" ? len : (o.w || 0.16), 0.02,
        axis === "x" ? (o.w || 0.16) : len, color, { cast: false });
    };
    // a direction chevron built from two short strokes (2 meshes)
    K.chevron = function (x, z, axis, sign, color, o) {
      o = o || {};
      const s = o.size || 0.34, y = o.y != null ? o.y : 0.05;
      for (const g of [-1, 1]) {
        const m = addBox(x, y, z, s, 0.02, 0.1, color, { cast: false });
        m.rotation.y = (axis === "x" ? 0 : HALF) + g * sign * 0.62;
      }
    };

    // ---- caged wall lamp (4 meshes, 1 emissive) ---------------------------
    // world/cellblock.js's hanging lamp (cage box + warm emissive) promoted
    // into a fitting you can bolt to any wall. This is THE prison light.
    // TWO cage bars, not three: this fitting is placed a dozen times across
    // the compound, so one box saved here is a dozen off the frame budget,
    // and at 3.6 m a third bar is a pixel.
    K.lamp = function (x, y, z, face, o) {
      o = o || {};
      const n = nrm(face), nx = n[0], nz = n[1];
      const w = o.w || 0.46, hh = o.h || 0.30;
      const tone = o.tone != null ? o.tone : 0xffe9a8;
      const em = o.emissive != null ? o.emissive : 0xffcf66;
      addBox(x, y, z, nx ? 0.12 : w, hh + 0.18, nx ? w : 0.12, 0x3c424d, { cast: false });
      const glass = addBox(x + nx * 0.13, y, z + nz * 0.13, nx ? 0.14 : w - 0.1, hh, nx ? w - 0.1 : 0.14,
        tone, { emissive: em, ei: o.ei != null ? o.ei : 0.85, cast: false });
      for (const i of [-1, 1])
        addBox(x + nx * 0.21, y + i * hh * 0.3, z + nz * 0.21,
          nx ? 0.04 : w - 0.06, 0.035, nx ? w - 0.06 : 0.04, 0x252a32, { cast: false });
      // a wall lamp lights the metre or two around it, not the room
      return fixture(glass, x, z, tone, em, o.r || 5.5, o.kind || "room");
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

    return K;
  })();
  CBZ.prisonDress = PD;

  // ---- three long mess tables with benches --------------------------------
  // Refectory grammar: the table's long axis runs along X, a bench down each
  // side at 0.7 m off the centreline, each bench facing the table.
  const TABLE_X = -24.5, TABLE_LEN = 4.4, BENCH_OFF = 0.7;
  function messTable(z) {
    // the table slab — SOLID, and height-gated so it's a waist-high obstacle
    // rather than a full-height pillar (its legs stay decorative).
    addBox(TABLE_X, 0.85, z, TABLE_LEN, 0.16, 1.0, 0xd9d2c4, { solid: true, y0: 0, y1: 0.95 });
    addBox(-26.4, 0.42, z, 0.16, 0.84, 1.0, 0x6b7480, { cast: false });   // end supports
    addBox(-22.6, 0.42, z, 0.16, 0.84, 1.0, 0x6b7480, { cast: false });

    // a bench each side, facing the table (yaw 0 = looks +z, yaw pi = looks -z)
    for (const s of [-1, 1]) {
      const bz = z + s * BENCH_OFF;
      const face = s < 0 ? 0 : Math.PI;
      // back:false — a mess bench is a backless plank you slide onto from the
      // end (that is the authored geometry, and what the kit's default adds).
      const fBench = kit("bench", TABLE_X, 0, bz, face,
        { len: TABLE_LEN, back: false, solid: true, tone: 0x9aa0a8 });
      let sat = false;
      if (fBench) {
        sat = reseat(fBench.rec, face, "bench");
      } else {
        addBox(TABLE_X, 0.42, bz, TABLE_LEN, 0.14, 0.35, 0x9aa0a8, { solid: true });  // seat (SOLID)
      }
      // three sit spots down each bench — only if the kit reported none.
      // cushion 0.49 = the authored plank's real top (centre 0.42 + half of 0.14).
      if (!sat) for (const dx of [-1.5, 0, 1.5]) seat(TABLE_X + dx, bz, face, "bench", 0.49);
    }

    // a couple of trays
    addBox(-25.4, 0.96, z, 0.5, 0.06, 0.36, 0x3ad17a, { cast: false });
    addBox(-23.6, 0.96, z, 0.5, 0.06, 0.36, 0xffd451, { cast: false });
  }
  // THE ROWS ARE PLACED AGAINST world/escape_routes.js's HATCH RECTS, not by
  // eye. Its three cafeteria-side floor hatches occupy
  //   Yard Drainage Ditch  x[-26.275,-24.525] z[ 9.625,11.375]
  //   Perimeter Culvert    x[-26.075,-24.325] z[17.325,19.075]
  //   Kitchen Grease Duct  x[-27.975,-26.225] z[18.325,20.075]
  // and the old z = 10 / 18 rows put a SOLID, y-gated table slab on the first
  // two — i.e. two of the block's four escape routes surfaced under furniture
  // you cannot walk into. Every bench edge below clears every rect: the rows
  // sit at 7.325-9.075, 11.525-13.275 and 15.325-17.075, which also opens
  // three real queue bays in front of the serving line instead of one.
  (DRESS ? [8.2, 12.4, 16.2] : [10, 18]).forEach(messTable);

  // ---- serving counter along the far (west) wall -------------------------
  // Front faces +x into the room (yaw = +90 deg), 8 m long.
  const COUNTER_X = -27.8, COUNTER_Z = 14, COUNTER_LEN = 8;
  const fCounter = kit("counter", COUNTER_X, 0, COUNTER_Z, HALF, { len: COUNTER_LEN, solid: true, tone: 0xbfc6cd });
  let topY = 1.6;   // authored worktop height (counter centre 0.8 + half of 1.6)
  if (fCounter) {
    if (fCounter.rec && fCounter.rec.top != null) topY = fCounter.rec.top;
  } else {
    addBox(COUNTER_X, 0.8, COUNTER_Z, 1.0, 1.6, COUNTER_LEN, 0xbfc6cd, { solid: true });  // SOLID
  }
  addBox(-27.2, topY + 0.05, COUNTER_Z, 0.4, 0.1, COUNTER_LEN, 0xe6e9ed, { cast: false }); // serving lip
  // hot-food trays glowing on the counter
  for (let i = -1; i <= 1; i++)
    addBox(-27.2, topY + 0.14, COUNTER_Z + i * 2.2, 0.5, 0.12, 0.7, 0xff7a1a, { emissive: 0xc85c00, ei: 0.5, cast: false });

  // ========================================================================
  //  THE CHOW HALL  (PRISON_DRESS_V2)
  // ========================================================================
  // GEOMETRY THIS ROOM IS BUILT AGAINST — measured, not guessed:
  //   shell interior  x[-28.75,-19.25]  z[6.25,21.75]  wall top 6
  //   doorway (E)     z[12.3,15.7] at x=-19
  //   counter body    x[-28.3,-27.3]  z[10,18], worktop `topY`
  //   serving lip     x[-27.4,-27.0]
  //   mess rows       x[-26.7,-22.3] at z 8.2 / 12.4 / 16.2 (benches +/-0.875)
  //   escape_routes.js also lays a drainage channel through this floor with
  //   kerbs at x ~ -28.4 and x ~ -22.2 — nothing below stands on either.
  // CIRCULATION HELD: the north-south run east of the rows (x -22.3..-19.25,
  // 3.05 m) is untouched end to end, the door bay is clear, and the east-west
  // gaps between rows are 2.0-2.4 m. Nothing here is closer than 1.2 m to a
  // route, and nothing sits on a hatch.
  if (DRESS) (function chowHall() {
    const WX0 = -28.75, WX1 = -19.25, WZ0 = 6.25, WZ1 = 21.75;   // inner faces

    // ---- 1. THE SERVING LINE ---------------------------------------------
    // A steel line reads from three things: the tray rail you push along, the
    // sneeze guard you look through, and the wells the food sits in.
    PD.pipe(-26.93, 1.04, COUNTER_Z, COUNTER_LEN - 0.4, "z", 0.045, 0xc3c9d0);  // tray rail
    for (const z of [10.6, 14, 17.4])                                            // rail brackets
      addBox(-27.12, 0.99, z, 0.3, 0.06, 0.07, 0x8b95a1, { cast: false });
    // sneeze guard: the same clear-glass discipline world/cellblock.js:26 set
    // for barred windows — a tinted PANE, never a grey slab. transparent:true
    // also keeps it out of core/batch.js's opaque merge.
    const guard = addBox(-27.62, topY + 0.62, COUNTER_Z, 0.05, 0.66, COUNTER_LEN - 0.8,
      0xbfe9f7, { cast: false, receive: false });
    guard.material.transparent = true; guard.material.opacity = 0.28;
    for (const z of [COUNTER_Z - 3.4, COUNTER_Z, COUNTER_Z + 3.4])
      addBox(-27.62, topY + 0.5, z, 0.06, 0.9, 0.06, 0x8b95a1, { cast: false });  // guard posts
    addBox(-27.62, topY + 0.97, COUNTER_Z, 0.09, 0.07, COUNTER_LEN - 0.8, 0x8b95a1, { cast: false });
    for (let i = 0; i < 4; i++)                                                   // steam wells
      addBox(-27.9, topY + 0.03, 11 + i * 2, 0.8, 0.06, 1.5, 0x5b6470, { cast: false });
    addBox(-28.1, topY + 1.28, COUNTER_Z, 0.24, 0.12, COUNTER_LEN - 1.2, 0x4a525c, { cast: false });
    addBox(-28.1, topY + 1.19, COUNTER_Z, 0.14, 0.06, COUNTER_LEN - 1.6, 0xffd9a0,
      { emissive: 0xff9a3c, ei: 0.75, cast: false });                             // heat lamp
    // head of the line: clean trays and cutlery, at the south end
    addBox(-27.7, 0.45, 9.2, 0.9, 0.9, 0.7, 0x9aa3ad, { solid: true });           // dispenser
    PD.trayStack(-27.7, 0.94, 9.2, 4, 0xb8bec6);
    addBox(-26.9, 0.96, 9.2, 0.34, 0.12, 0.5, 0x6b7480, { cast: false });         // cutlery bin
    addBox(-26.9, 1.05, 9.2, 0.28, 0.1, 0.1, 0xc3c9d0, { cast: false });

    // ---- 2. KITCHEN PASS-THROUGH (west wall, over the line) ---------------
    // There is no room behind this wall and there never will be — the yard
    // wall is 1 m outside it. So the kitchen is a RECESS with a warm mouth:
    // it reads as somewhere food comes from without pretending to be a place.
    addBox(-28.92, 3.05, COUNTER_Z, 0.32, 1.35, 2.5, 0x14181f, { cast: false });  // recess
    addBox(-28.72, 3.0, COUNTER_Z, 0.05, 1.15, 2.25, 0xffcf8f,
      { emissive: 0xd07a20, ei: 0.55, cast: false });                              // interior glow
    addBox(-28.7, 3.78, COUNTER_Z, 0.1, 0.12, 2.7, 0x9aa3ad, { cast: false });     // head
    addBox(-28.7, 2.32, COUNTER_Z, 0.16, 0.14, 2.7, 0xc3c9d0, { cast: false });    // pass ledge
    for (const s of [-1, 1])
      addBox(-28.7, 3.05, COUNTER_Z + s * 1.32, 0.1, 1.5, 0.12, 0x9aa3ad, { cast: false });
    addBox(-28.68, 4.0, COUNTER_Z, 0.18, 0.28, 2.8, 0x6b7480, { cast: false });    // shutter box
    addBox(-28.62, 3.86, COUNTER_Z, 0.06, 0.16, 2.6, 0x4a525c, { cast: false });   // rolled curtain

    // ---- 3. DISH RETURN + SERVICE END (north strip, off every hatch) ------
    addBox(-24.1, 0.45, 21.3, 2.6, 0.9, 0.8, 0xa8afb8, { solid: true });          // bussing counter
    addBox(-24.1, 0.93, 21.3, 2.7, 0.08, 0.9, 0xc3c9d0, { cast: false });
    addBox(-25.1, 1.06, 21.3, 0.5, 0.2, 0.5, 0x2a2f38, { cast: false });          // return slot
    PD.trayStack(-23.4, 0.99, 21.3, 3, 0x8a7f6d);                                  // dirty trays
    for (const b of [[-26.0, 20.9, 0x2f6b3a], [-25.0, 20.0, 0x3c424d]]) {          // waste barrels
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.32, 0.9, 10), CBZ.cmat(b[2]));
      d.position.set(b[0], 0.45, b[1]); d.castShadow = false; d.receiveShadow = true;
      (CBZ.prisonRoot || CBZ.scene).add(d);
      const lid = addBox(b[0], 0.93, b[1], 0.78, 0.06, 0.78, 0x232a32, { cast: false });
      const bcol = { minX: b[0] - 0.36, maxX: b[0] + 0.36, minZ: b[1] - 0.36, maxZ: b[1] + 0.36, y0: 0, y1: 0.96, ref: d };
      if (CBZ.colliders) CBZ.colliders.push(bcol);
      // a wheelie bin half full of trays is ~22 kg and rolls when you walk into
      // it — the dish-return end of a mess hall is where things get shoved
      if (CBZ.pushProp) CBZ.pushProp({
        // `stand`: a closed 0.72 m drum with a lid is the tallest thing in the
        // prison a man can get on top of unaided — 0.96 m, which is two stools.
        // The mop bucket below is NOT: 0.5 x 0.4 of sloshing plastic is a
        // twisted ankle, and the cones outside are tapered.
        parts: [d, lid], x: b[0], z: b[1], hx: 0.36, hz: 0.36, y1: 0.96,
        mass: 22, kind: "barrel", col: bcol, leash: 5.0, stand: true, mode: "escape",
      });
    }
    // mop bucket + wringer, parked where the wet floor is
    const mopB = addBox(-22.6, 0.22, 20.2, 0.5, 0.44, 0.4, 0xe8b93c, { cast: false });
    const mopW = addBox(-22.6, 0.52, 20.35, 0.44, 0.18, 0.16, 0x9aa3ad, { cast: false });
    if (CBZ.pushProp) CBZ.pushProp({
      parts: [mopB, mopW], x: -22.6, z: 20.2, hx: 0.25, hz: 0.22, y1: 0.62,
      mass: 16, kind: "mopbucket", solid: true, leash: 5.0, mode: "escape",
    });
    PD.pipe(-22.6, 0.85, 20.1, 1.3, "y", 0.03, 0x9a7a4e);                          // mop handle
    // wet-floor A-frame beside it. PRISON_PROP_USE_V1: three boxes standing
    // free on the deck at 0.62 m, drawn cast:false — you walked through the
    // one object in the room whose entire job is to be in your way. It is a
    // 2 kg folding plastic sign parked next to a mop bucket that is ALREADY a
    // pushable (four lines up), so it gets the same treatment and the lightest
    // mass in the compound bar the chalk bucket. `solid:true` here is
    // pushables' own flag — it mints the collider the sign never had.
    const wfParts = [];
    for (const s of [-1, 1]) {
      const w = addBox(-23.4 + s * 0.14, 0.32, 19.2, 0.05, 0.62, 0.44, 0xffd451, { cast: false });
      w.rotation.z = s * 0.22;
      wfParts.push(w);
    }
    wfParts.push(addBox(-23.4, 0.5, 19.2, 0.3, 0.16, 0.02, 0x2a2f38, { cast: false }));
    if (USE && CBZ.pushProp) CBZ.pushProp({
      parts: wfParts, x: -23.4, z: 19.2, hx: 0.2, hz: 0.24, y1: 0.63,
      mass: 2, kind: "wetfloor", solid: true, leash: 6.0, mode: "escape",
    });
    // milk-crate corner (the one place a chow hall is never tidy).
    // PRISON_PROP_USE_V1: six boxes of 0.44 m crate on the floor of the one
    // room the DAY BEAT sends the whole block to, and a body went through all
    // six. A milk crate is the archetypal shovable — 1.5 kg, skitters — so the
    // corner stays exactly as drawn and becomes three things you can kick.
    // The first two are STACKED on one footprint, so they are ONE body: shove
    // the bottom crate of a stack as a separate prop and the top one is left
    // hanging in the air, which is a worse lie than the one being fixed.
    const cLo = PD.crate(-20.3, 0.16, 20.9, { color: 0x3a6ea5 });
    const cHi = PD.crate(-20.3, 0.48, 20.9, { color: 0xc94d3a });
    const cSide = PD.crate(-20.4, 0.16, 20.2, { color: 0x2f6b3a });
    if (USE && CBZ.pushProp) {
      CBZ.pushProp({
        parts: cLo.parts.concat(cHi.parts), x: -20.3, z: 20.9, hx: 0.24, hz: 0.24,
        y1: cHi.top, mass: 3, kind: "crate", solid: true, leash: 5.0, mode: "escape",
      });
      CBZ.pushProp({
        parts: cSide.parts, x: -20.4, z: 20.2, hx: 0.24, hz: 0.24,
        y1: cSide.top, mass: 2, kind: "crate", solid: true, leash: 5.0, mode: "escape",
      });
    }
    // a floor drain in the service end
    (function drain() {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 10), CBZ.cmat(0x3c424d));
      d.position.set(-23.0, 0.075, 18.7); d.castShadow = false; (CBZ.prisonRoot || CBZ.scene).add(d);
      for (const i of [-1, 1]) addBox(-23.0, 0.1, 18.7 + i * 0.13, 0.44, 0.02, 0.05, 0x1a1d22, { cast: false });
    })();

    // ---- 4. SIGNAGE -------------------------------------------------------
    // A menu board is a dark slab with light rows on it; a chalked line reads
    // as text at every distance the player will ever see it from, and costs
    // one box. No canvas, no atlas, no texture.
    // INTO THE ROOM FROM THE EAST WALL IS -X (interior is x[-28.75,-19.25]),
    // so every layer of a board stacks toward MORE NEGATIVE x. Getting that
    // backwards buries the writing inside the slab it is written on.
    function board(z, y, w, h, rows, hue) {
      addBox(-19.32, y, z, 0.06, h, w, 0x232a32, { cast: false });
      addBox(-19.37, y + h / 2 - 0.12, z, 0.03, 0.14, w - 0.2, hue, { cast: false }); // header
      for (let i = 0; i < rows; i++) {
        const rw = (w - 0.5) * (0.55 + PD.h01(z, i * 3.1, 0x9201) * 0.4);
        addBox(-19.37, y + h / 2 - 0.42 - i * 0.24, z - (w - 0.4 - rw) / 2, 0.03, 0.06, rw,
          0xd8d2c4, { cast: false });
      }
    }
    board(18.2, 3.3, 2.6, 1.5, 4, 0xc94d3a);      // TODAY'S MENU
    board(9.6, 3.1, 1.8, 1.0, 2, 0x3a6ea5);       // chow times
    // a wall clock — an institution runs on the clock and shows you it does
    (function clock() {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.07, 12), CBZ.cmat(0xe6e9ed));
      c.position.set(-19.34, 4.3, 17.0); c.rotation.z = HALF; c.castShadow = false;
      (CBZ.prisonRoot || CBZ.scene).add(c);
      addBox(-19.4, 4.36, 17.0, 0.02, 0.16, 0.03, 0x2a2f38, { cast: false });
      addBox(-19.4, 4.3, 17.1, 0.02, 0.03, 0.2, 0x2a2f38, { cast: false });
    })();

    // ---- 5. THE SHELL: wear, structure, light -----------------------------
    // Wainscot + scuff on all four walls. This is the single highest-value
    // pass in the room: a flat 6 m slab with one horizontal break in it stops
    // reading as a box and starts reading as a corridor wall.
    // The east wall's runs are SPLIT around the doorway (z 12.3..15.7): a
    // roomShell door gap is full height, so an unbroken band would hang across
    // the opening as a painted stripe in mid-air.
    const RUNS = [
      [-24.0, WZ0 + 0.03, 9.5, "x"], [-24.0, WZ1 - 0.03, 9.5, "x"],   // north/south walls
      [WX0 + 0.03, 14.0, 15.5, "z"],                                   // west wall
      [WX1 - 0.03, 9.275, 6.05, "z"], [WX1 - 0.03, 18.725, 6.05, "z"], // east wall, either side of the door
    ];
    for (const r of RUNS) {
      PD.dado(r[0], 0.5, r[1], r[2], r[3], 0x6f7a86);
      PD.scuff(r[0], 1.32, r[1], r[2], r[3], { color: 0x59616b });
    }
    // A DOORWAY NEEDS A HEAD. roomShell splits a wall clean from floor to top
    // for its gap, so every prison door is a 6 m slot rather than a door — one
    // box turns it into an opening, with 2.9 m of clearance under it. It stops
    // at 4.95, the underside of the room's own red sign band (y 4.95..5.85,
    // which hangs IN the gap): run it to the wall top and it eats the sign.
    addBox(-19, 3.925, 14, 0.5, 2.05, 3.4, 0x8a929c, { cast: false });
    addBox(-19.3, 2.88, 14, 0.14, 0.16, 3.5, 0x6b7480, { cast: false });   // inside lintel nose
    addBox(-18.7, 2.88, 14, 0.14, 0.16, 3.5, 0x6b7480, { cast: false });   // yard-side nose
    // open roof beams + strip lights. NO LID: the rooms are open-topped so the
    // follow camera can see in, and beams give the enclosed read for free.
    for (const z of [9.0, 14.0, 19.0]) PD.beam(-24.0, 5.62, z, 9.6, "x");
    PD.beam(-26.2, 5.82, 14.0, 15.6, "z", { w: 0.14, h: 0.16 });
    PD.beam(-21.6, 5.82, 14.0, 15.6, "z", { w: 0.14, h: 0.16 });
    for (const z of [10.4, 17.6]) PD.strip(-23.6, 5.44, z, 4.0, "x");
    // caged lamps flanking the doorway, inside and out (the outside pair sits
    // on real wall, never over the gap — there is nothing above a door gap)
    PD.lamp(-19.31, 3.6, 11.4, "x-");
    PD.lamp(-19.31, 3.6, 16.6, "x-");
    PD.lamp(-18.69, 3.4, 16.9, "x+");
    // service runs under the wall head — the pipework a kitchen actually has
    PD.pipe(-28.3, 5.05, 14.0, 14.6, "z", 0.09, 0x6f7a86);
    PD.pipe(-28.05, 4.82, 14.0, 14.6, "z", 0.055, 0x8a6a4e);
    for (const z of [9.0, 14.0, 19.0]) PD.hanger(-28.3, 5.14, z, 0.55);
    // fire kit by the door — the only two red things in a grey room
    PD.extinguisher(-19.42, 1.1, 17.6, "x-");
    PD.hoseCab(-19.45, 1.6, 10.4, "x-");

    // ---- 6. WAYFINDING ----------------------------------------------------
    // Yellow = chow. The line comes in the door, turns, and runs to the head
    // of the serving line — which is exactly the route the DAY BEAT wants you
    // to walk, painted on the floor instead of announced in a popup.
    PD.floorLine(-21.5, 14.6, 5.1, "x", 0xe8c33c);
    PD.floorLine(-24.0, 11.9, 5.4, "z", 0xe8c33c);
    PD.floorLine(-25.6, 9.3, 3.2, "x", 0xe8c33c);
    PD.chevron(-22.6, 14.6, "x", -1, 0xe8c33c);
    PD.chevron(-24.0, 12.6, "z", -1, 0xe8c33c);
    // the same line carried up onto the wall, split around the door gap
    PD.band(WX1 - 0.03, 1.55, 9.275, 6.05, "z", 0xe8c33c);
    PD.band(WX1 - 0.03, 1.55, 18.725, 6.05, "z", 0xe8c33c);
  })();

  // The facade pass (world/building_dress.js) dresses whatever is registered
  // here. One line, and the outside of this room stops being a blank slab.
  if (PD.shell) PD.shell({
    id: "cafeteria", x0: -29, x1: -19, z0: 6, z1: 22, h: 6,
    door: "E", dc: 14, dw: 3.4, tone: 0x8a929c, face: "E",
  });
})();
