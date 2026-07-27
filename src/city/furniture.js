/* ============================================================
   city/furniture.js — THE ONE FURNITURE VOCABULARY (CBZ.furnish).

   OWNER DOCTRINE / BLOCK LAW: "every feature I came up with was built as an
   add-on with all new code when really it just needed to reuse other shit and
   draw some new shit." Today EVERY interior author hand-rolls its own desk,
   chair, bed and sofa out of raw boxes — buildings.js's roomKit sets,
   interior_programs.js's deskfarm/meeting/lobby, exec_office.js, casino.js,
   villagekit.js, world/lounge.js, world/cafeteria.js — and then each one
   SEPARATELY remembers (or forgets) to register a city/propuse.js anchor so
   the piece is actually sittable. A seat anchor floating off its mesh, or a
   chair with no anchor at all, is the bug this file exists to delete.

   THIS BLOCK REPLACES CODE THE CALLER WRITES ANYWAY. The 5-8 `addBox`/`lbox`
   lines plus the `if (CBZ.propRegisterSeat) CBZ.propRegisterSeat(...)` line
   collapse into ONE call that draws the piece AND registers its purpose:

       // before
       b.lbox(cx, Y + 0.45, cz, 0.45, 0.9, 0.45, 0x2a2f37, { cast: false });
       if (CBZ.propRegisterSeat) CBZ.propRegisterSeat(b.ox + cx, Y, b.oz + cz, face, "chair", null);
       // after
       CBZ.furnish.chair(cx, Y, cz, face, { box: b.lbox, ox: b.ox, oz: b.oz });

   DEGRADE-SAFE (BLOCK LAW #2): when CBZ.CONFIG.FURNISH_KIT is false this file
   never defines CBZ.furnish at all, so the universal caller idiom
       CBZ.furnish ? CBZ.furnish.desk(x, y, z, yaw, o) : <the old inline boxes>
   is always a valid, always-safe fallback. Nothing here is required; every
   optional dependency (propuse, hash01, addBox, markCollidersDirty) is
   feature-detected.

   ------------------------------------------------------------------
   API — every piece is  fn(x, y, z, yaw, opts) -> {w, d, h, seats, top}

     x, z   centre of the piece's FOOTPRINT, in the HOST's coordinate space
            (world coords for the default CBZ.addBox path; building-LOCAL
            coords when the caller passes a buildings.js `lbox` as opts.box).
     y      the FLOOR level the piece stands on. Everything is authored
            bottom-up from it, so `y` is also the sitter's feet plane.
     yaw    the direction the piece's FRONT faces, repo convention:
            forward = (sin yaw, cos yaw). For a DESK/bossDesk that is the
            direction the seated worker LOOKS (out across the worktop); for a
            BED it is the direction from the mattress centre toward the PILLOW.

     opts.box    optional host draw fn (x,y,z,w,h,d,color,o) -> mesh|truthy.
                 Lets a batch-safe host own the drawing — buildings.js `b.lbox`
                 and interior_programs.js's `h.b.lbox` satisfy this natively.
                 DEFAULT: CBZ.addBox.
     opts.ox/oz  host origin (building world position) — REQUIRED whenever
                 opts.box draws in host-local coords, because propuse anchors
                 are always WORLD. Default 0. (opts.oy for a lifted host y.)
     opts.lot    lot record passed straight through to the propuse anchors.
     opts.solid  colliders. Default path: big pieces are solid unless this is
                 explicitly false. Host path: the HOST owns solidity, so
                 nothing is marked solid unless the caller passes solid:true.
     opts.tone   palette variant: "warm" | "cool" | "exec" | "clinic" | "auto"
                 ("auto" = deterministic per-position pick via CBZ.hash01).

     Returned  { w, d, h, seats, top }
       w   extent along the piece's own LATERAL axis
       d   extent along the piece's own FORWARD axis
       h   overall height above `y`
       top world/host Y of the USABLE surface (cushion, mattress, worktop…)
       seats [{x, y, z, face, yaw, kind, cushion, rec}] — WORLD coords, ready
             to hand straight to CBZ.interiorStaff (it reads x/y/z/yaw).

   PROPORTIONS ARE REAL METRES and are the contract with the character rig:
     chair seat 0.45 · stool 0.68 · sofa cushion 0.40 (back 0.85) ·
     bed mattress top 0.55 · desk/table worktop 0.74 · counter 0.92 ·
     boss "throne" cushion 0.50 · deckchair seat 0.38 · lounger deck 0.34.

   HARD INVARIANT (the ratchet, BLOCK LAW #5): a seat anchor's y is the FLOOR
   the sitter's feet rest on and `geom.cushion` is the cushion height ABOVE
   that floor — entities/character.js's CHAIR-SIT V2 solve reads exactly that
   pair to land the butt on the cushion and the soles on the floor. Every
   registration in this file is checked against the ACTUAL drawn cushion box
   (its centre + half-height, taken from the numbers handed to the draw call),
   and CBZ.furnishAudit().mismatched counts any disagreement > 2cm. It must be
   0, forever. Copy of the CBZ.treeAudit() shape (world/treeaudit.js).

   DRAW-CALL DISCIPLINE: every box is an opaque cast:false mesh with no
   userData, and the palette REUSES the existing furnisher colour buckets
   (interior_programs.js's P + buildings.js's roomKit sets) rather than minting
   new ones — so core/batch.js folds a whole furnished floor into the buckets
   it already merges, at ≈0 extra draw calls. DETERMINISM: no Math.random
   anywhere; the only variation is CBZ.hash01(x, z, salt) under tone "auto".

   TWO CAVEATS worth knowing before you adopt:
     • CBZ.addBox parents into `CBZ.prisonRoot || CBZ.scene` (captured at
       world/materials.js parse time), so CITY builders should pass opts.box
       (their own lbox) — that is both the batch-safe path and the only one
       whose geometry is torn down with the city.
     • buildings.js's roomKit `k.put` is NOT a drop-in opts.box: its 8th
       argument is a clearFloorPoint PAD, not an options object. Pass the raw
       `b.lbox` (plus ox/oz, and pre-add the floor lift Y yourself), or wrap:
       box: function (lx, ly, lz, w, h, d, c) { return k.put(lx, ly - Y, lz, w, h, d, c); }

   Revert: CBZ.CONFIG.FURNISH_KIT = false (CBZ.furnish disappears; every
   caller's `CBZ.furnish ? … : …` fallback takes over unchanged).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  CBZ.CONFIG = CBZ.CONFIG || {};
  // FURNISH_KIT (BLOCK LAW: "a block must REPLACE code the caller writes
  // anyway"). On → CBZ.furnish exists: one call draws a piece of furniture AND
  // registers its city/propuse.js seat/bed anchor, so no interior author
  // hand-rolls boxes or hand-registers anchors again. Flip false (or
  // ?cfg_FURNISH_KIT=0) and CBZ.furnish is never defined, so every call site's
  // `CBZ.furnish ? … : <old inline boxes>` guard falls back to the exact prior
  // behaviour — a true one-line revert.
  if (CBZ.CONFIG.FURNISH_KIT == null) CBZ.CONFIG.FURNISH_KIT = true;

  const HALF_PI = Math.PI / 2;
  const EPS_CUSHION = 0.02;          // 2cm — the audit's mismatch tolerance

  // ---- THE PALETTE — existing colour buckets ONLY (interior_programs.js's P
  // and buildings.js's roomKit furniture sets). Minting a new hex here would
  // mint a new batch bucket for nothing. ------------------------------------
  const P = {
    frame:   0x4a4036,   // bed frame / warm dark wood      (buildings.js setBedroom)
    wood:    0x6b4a2a,   // table / bench wood              (buildings.js setLiving)
    darkwood:0x3a2b1e,   // meeting table, exec surfaces    (interior_programs P.table)
    desk:    0x55606e,   // desk & counter body             (interior_programs P.desk)
    worktop: 0xc9ccd2,   // pale worktop                    (interior_programs P.worktop)
    bezel:   0x14181e,   // monitor / till bezel            (interior_programs P.bezel)
    screen:  0x9fb0c4,   // opaque lit panel face           (interior_programs P.screen)
    chair:   0x2a2f37,   // chair / bench / legs            (interior_programs P.chair)
    cloth:   0x8a5a2b,   // upholstery                      (buildings.js setLiving sofa)
    linen:   0x6b7da0,   // mattress sheet                  (buildings.js setBedroom linen)
    blanket: 0x55606e,   // folded blanket over the foot    (buildings.js headboard bucket)
    pillow:  0xe8e8ee,   // pillow                          (buildings.js setBedroom)
    head:    0x55606e,   // headboard                       (buildings.js setBedroom)
    shelf:   0x8a939c,   // shelf board / handle            (interior_programs P.shelf)
    metal:   0x49505b,   // cabinet / locker / rack body    (buildings.js setKitchen)
    metalD:  0x2e2620,   // locker door face                (buildings.js wardrobe)
    lamp:    0xffe6b0,   // warm lamp glow                  (buildings.js setBedroom lamp)
  };
  // tone variants — each value is itself an existing bucket, never a new hex.
  const TONES = {
    warm:   { cloth: P.cloth,    linen: 0xb07a3c,   wood: P.wood,     frame: P.frame },
    cool:   { cloth: P.metal,    linen: P.linen,    wood: P.desk,     frame: P.desk },
    exec:   { cloth: P.chair,    linen: P.darkwood, wood: P.darkwood, frame: P.metalD },
    clinic: { cloth: P.worktop,  linen: P.pillow,   wood: P.worktop,  frame: P.shelf },
  };
  const TONE_NAMES = ["warm", "cool", "exec", "clinic"];

  // ---- the audit ledger (BLOCK LAW #5 ratchet) -----------------------------
  const led = { pieces: 0, seats: 0, beds: 0, mismatched: 0, kinds: {} };
  function resetLedger() {
    led.pieces = 0; led.seats = 0; led.beds = 0; led.mismatched = 0; led.kinds = {};
  }
  // A world rebuild re-runs every furnisher, so the ledger has to restart in
  // lockstep with the anchor registry it certifies. Called for free by
  // piggybacking city/propuse.js's own reset (idempotent, feature-detected,
  // marker-guarded like the explosion wrappers).
  CBZ.furnishReset = resetLedger;
  // LAZY RETRY, and it is not belt-and-braces — it is the whole wrap. This file
  // is index.html:366 and city/propuse.js is :667, so CBZ.propPurposeReset does
  // not EXIST when this line first runs: the wrap has been dead since it
  // shipped, and the ledger this file's pinned `mismatched` ratchet is computed
  // from has therefore never reset between world builds (a determinism re-run,
  // which rebuilds the same seed twice, double-counts every piece). Retried from
  // the one place guaranteed to run after every script has parsed — a furnish
  // call — the same lazy-hook pattern city/killfeed.js uses for the same reason.
  function armReset() {
    if (typeof CBZ.propPurposeReset !== "function" || CBZ.propPurposeReset._furnishWrapped) return;
    const prev = CBZ.propPurposeReset;
    const wrapped = function () { resetLedger(); return prev.apply(this, arguments); };
    // CARRY EVERY MARKER FORWARD (CLAUDE.md's explosion-wrapper law). Two files
    // now wrap this one function; if each only stamped its OWN flag, the second
    // wrapper would hide the first's and every retry would add another layer.
    for (const kk in prev) { try { wrapped[kk] = prev[kk]; } catch (e) {} }
    wrapped._furnishWrapped = true;
    CBZ.propPurposeReset = wrapped;
  }
  CBZ.furnishArmReset = armReset;
  armReset();

  // CBZ.furnishAudit() — {pieces, seats, beds, mismatched}. `mismatched` counts
  // seat/bed anchors whose REGISTERED cushion/mattress height disagrees with
  // the height of the box actually drawn under it by more than 2cm. Pin it at
  // ZERO in tools/math-gate.mjs; it may never go up.
  CBZ.furnishAudit = function () {
    const kinds = {};
    for (const k in led.kinds) kinds[k] = led.kinds[k];
    return { pieces: led.pieces, seats: led.seats, beds: led.beds, mismatched: led.mismatched, kinds: kinds };
  };

  if (CBZ.CONFIG.FURNISH_KIT === false) return;   // one-line revert: no CBZ.furnish at all

  // ---- the PEN: one piece's local frame ------------------------------------
  // Local authoring coords are (lat, up, fwd):
  //   lat = lateral offset (+ = the piece's own right)
  //   up  = the BOTTOM of the box above the floor  ← authoring bottom-up is
  //         what makes "cushion top = 0.45" impossible to get wrong
  //   fwd = offset along the facing direction
  // Boxes stay AXIS-ALIGNED (three.js box meshes here are never rotated so
  // core/batch.js folds them and addBox's AABB collider stays exact), so the
  // footprint w/d swap is chosen by the NEAREST CARDINAL yaw while OFFSETS use
  // the exact yaw. Every real caller places furniture on a cardinal axis, where
  // the two agree exactly; an off-axis yaw still puts every anchor precisely on
  // its own mesh (which is what the audit certifies), it just doesn't rotate
  // the box silhouettes.
  function pen(name, x, y, z, yaw, opts) {
    opts = opts || {};
    armReset();                        // see armReset: propuse.js parses AFTER this file
    yaw = +yaw || 0;
    const s = Math.sin(yaw), c = Math.cos(yaw);
    const swap = (Math.round(yaw / HALF_PI) & 1) === 1;
    const hostBox = typeof opts.box === "function" ? opts.box : null;
    const draw = hostBox || CBZ.addBox;
    const ox = opts.ox || 0, oz = opts.oz || 0, oy = opts.oy || 0;
    // Default path → this file owns colliders for big pieces. Host path → the
    // host owns solidity (its lbox already ledgers colliders per building), so
    // nothing is solid unless the caller explicitly asked.
    const solidOn = hostBox ? (opts.solid === true) : (opts.solid !== false);
    // `tone` is normally one of TONE_NAMES. Accept a RAW HEX too: callers
    // migrating an authored room already have the exact colour they were
    // drawing (world/lounge.js's 0x2b3a67 couch) and silently discarding it
    // would repaint their room — the one thing a migration must never do.
    const toneHex = (typeof opts.tone === "number") ? (opts.tone | 0) : null;
    // A LITERAL tone object ({cloth, frame, wood, …}) is accepted too. The four
    // named tones cover interiors, where a room wants one coherent palette; a
    // caller placing many copies of the SAME piece in different colours (beach
    // loungers, market awnings) needs to vary one bucket per instance without
    // inventing a named tone for every shade. Missing keys still fall to P.
    const toneObj = (opts.tone && typeof opts.tone === "object") ? opts.tone : null;
    const tone = toneObj || (toneHex != null ? { cloth: toneHex, wood: toneHex } : (
      TONES[opts.tone] ||
      (opts.tone === "auto" && CBZ.hash01
        ? TONES[TONE_NAMES[(CBZ.hash01(x, z, 0xf07a) * TONE_NAMES.length) | 0]]
        : null)));
    let nSolid = 0;

    const p = {
      lot: opts.lot || null,
      seats: [],
      beds: [],
      col: function (key) { return (tone && tone[key] != null) ? tone[key] : P[key]; },
      // host-space world position of a local (lat, fwd)
      wx: function (lat, fwd) { return x + lat * c + fwd * s; },
      wz: function (lat, fwd) { return z - lat * s + fwd * c; },
      // draw one box; returns its world/host TOP y (what the audit compares to)
      put: function (lat, up, fwd, across, h, deep, color, o) {
        const cy = y + up + h / 2;
        const w = swap ? deep : across, d = swap ? across : deep;
        const oo = { cast: false };
        if (o) {
          if (o.emissive != null) { oo.emissive = o.emissive; oo.ei = o.ei != null ? o.ei : 0.5; }
          if (o.cast) oo.cast = true;
          if (o.solid && solidOn) {
            oo.solid = true;
            oo.y0 = y + up;
            oo.y1 = y + up + (o.colH != null ? o.colH : h);
            if (!hostBox) nSolid++;
          }
        }
        draw(p.wx(lat, fwd), cy, p.wz(lat, fwd), w, h, d, color, oo);
        return cy + h / 2;
      },
      // register a SEAT. `cushion` is the declared height above the floor;
      // `drawnTop` is what put() returned for the cushion box — the two must
      // agree or the audit counts a mismatch.
      seat: function (lat, fwd, face, kind, cushion, drawnTop) {
        const sx = ox + p.wx(lat, fwd), sz = oz + p.wz(lat, fwd), sy = y + oy;
        if (drawnTop == null || Math.abs((drawnTop - y) - cushion) > EPS_CUSHION) led.mismatched++;
        const geom = { cushion: cushion, floorBelow: 0 };
        const rec = CBZ.propRegisterSeat
          ? CBZ.propRegisterSeat(sx, sy, sz, face, kind, p.lot, geom) : null;
        led.seats++;
        const a = { x: sx, y: sy, z: sz, face: face, yaw: face, kind: kind, cushion: cushion, rec: rec };
        p.seats.push(a);
        return a;
      },
      // register a BED. (hx,hz) = mattress centre -> pillow; drawnTop = the
      // mattress box's real top, which must equal the declared mattress top.
      bed: function (len, topY, kind, drawnTop) {
        const bx = ox + x, bz = oz + z, by = y + oy;
        if (drawnTop == null || Math.abs(drawnTop - topY) > EPS_CUSHION) led.mismatched++;
        const rec = CBZ.propRegisterBed
          ? CBZ.propRegisterBed(bx, by, bz, s, c, len, topY + oy, kind, p.lot) : null;
        led.beds++;
        if (rec) p.beds.push(rec);
        return rec;
      },
      // finish: flush colliders, ledger the piece, hand back the contract.
      done: function (w, d, h, top) {
        if (nSolid && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
        led.pieces++;
        led.kinds[name] = (led.kinds[name] | 0) + 1;
        // `beds` is handed back for the same reason `seats` is: a caller that
        // wants to PUT SOMEBODY on the thing it just drew should not have to
        // re-find the anchor by coordinate search.
        return { w: w, d: d, h: h, top: top, seats: p.seats, beds: p.beds };
      },
    };
    return p;
  }

  // opts pass-through for a sub-piece (a desk's own chair, a table's ring) —
  // the sub-piece must never inherit `len`/`seats`/`solid` sizing knobs.
  function sub(opts) {
    opts = opts || {};
    // `solid` rides along: a cluster's own chairs (desk chair, table ring, the
    // boss's guest chairs) must be as solid as the cluster asked to be, or you
    // walk straight through the chairs in front of the boss's desk.
    return { box: opts.box, ox: opts.ox, oz: opts.oz, oy: opts.oy, lot: opts.lot, tone: opts.tone, solid: opts.solid };
  }

  const F = {};

  // ======================================================================
  //  SEATING
  // ======================================================================

  // CHAIR — seat pad, backrest, four legs. Cushion 0.45. Non-solid so a body
  // can actually reach the anchor standing in its footprint.
  F.chair = function (x, y, z, yaw, opts) {
    const p = pen("chair", x, y, z, yaw, opts);
    const leg = P.chair, pad = p.col("cloth"), body = P.chair;
    for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2)
      p.put(a * 0.19, 0, b * 0.19, 0.06, 0.41, 0.06, leg);
    // The pad carries the collider (height-gated to the cushion, so a body can
    // still stand in the chair's footprint to reach the seat anchor) — a chair
    // you walk through is a decoy, and `opts.solid` used to be a no-op here.
    const top = p.put(0, 0.37, 0, 0.50, 0.08, 0.50, pad, { solid: true, colH: 0.08 });   // cushion → 0.45
    p.put(0, 0.49, -0.21, 0.50, 0.55, 0.08, body);                   // backrest
    p.seat(0, 0, yaw, "chair", 0.45, top);
    return p.done(0.50, 0.50, 1.04, top);
  };

  // STOOL — pedestal, foot ring, seat. Cushion 0.68 (counter height).
  F.stool = function (x, y, z, yaw, opts) {
    const p = pen("stool", x, y, z, yaw, opts);
    p.put(0, 0, 0, 0.36, 0.05, 0.36, P.chair);                       // base plate
    p.put(0, 0.05, 0, 0.10, 0.55, 0.10, P.chair);                    // column
    p.put(0, 0.22, 0, 0.30, 0.04, 0.30, P.chair);                    // foot ring
    const top = p.put(0, 0.60, 0, 0.42, 0.08, 0.42, p.col("cloth"), { solid: true, colH: 0.08 }); // cushion → 0.68
    p.seat(0, 0, yaw, "stool", 0.68, top);
    return p.done(0.42, 0.42, 0.68, top);
  };

  // BENCH — plank seat on two end legs, optional back (opts.back:false drops
  // it). opts.len (default 1.8) → floor(len/0.75) seat anchors, cushion 0.45.
  F.bench = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const L = Math.max(0.8, opts.len != null ? +opts.len : 1.8);
    const back = opts.back !== false;
    const p = pen("bench", x, y, z, yaw, opts);
    const wood = p.col("wood");
    for (let a = -1; a <= 1; a += 2)
      p.put(a * (L / 2 - 0.22), 0, 0, 0.10, 0.35, 0.42, P.chair);    // end legs
    const top = p.put(0, 0.35, 0, L, 0.10, 0.48, wood, { solid: true, colH: 0.10 });  // plank → 0.45
    if (back) p.put(0, 0.55, -0.20, L, 0.42, 0.08, wood);            // backrest
    const n = Math.max(1, Math.floor(L / 0.75));
    for (let i = 0; i < n; i++)
      p.seat(-L / 2 + L * (i + 0.5) / n, 0, yaw, "bench", 0.45, top);
    return p.done(L, back ? 0.56 : 0.48, back ? 0.97 : 0.45, top);
  };

  // SOFA — dark plinth, upholstered body, seat cushion (0.40), 0.85 back, two
  // arms. opts.len (default 2.4). Three seats; the sitters face AWAY from the
  // back, i.e. along yaw.
  F.sofa = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const L = Math.max(1.2, opts.len != null ? +opts.len : 2.4);
    const p = pen("sofa", x, y, z, yaw, opts);
    const cloth = p.col("cloth");
    p.put(0, 0, 0, L - 0.10, 0.12, 0.78, P.chair);                          // plinth
    p.put(0, 0.12, 0, L, 0.22, 0.85, cloth, { solid: true, colH: 0.73 });   // body
    const top = p.put(0, 0.34, 0.03, L - 0.16, 0.06, 0.74, cloth);          // cushion → 0.40
    p.put(0, 0.34, -0.335, L, 0.51, 0.18, cloth);                           // back → 0.85
    for (let a = -1; a <= 1; a += 2)
      p.put(a * (L / 2 - 0.09), 0.34, 0.02, 0.18, 0.24, 0.80, cloth);       // arms
    for (let i = -1; i <= 1; i++) p.seat(i * (L / 3), 0.03, yaw, "sofa", 0.40, top);
    return p.done(L, 0.85, 0.85, top);
  };

  // ======================================================================
  //  SLEEPING
  // ======================================================================

  // BED — yaw points from the mattress centre toward the PILLOW. Frame,
  // mattress (visible sheet colour), folded blanket, pillow, headboard.
  // opts.len (default 2.1) · opts.wide (default 1.4). Mattress top 0.55.
  F.bed = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const L = Math.max(1.6, opts.len != null ? +opts.len : 2.1);
    const W = Math.max(0.8, opts.wide != null ? +opts.wide : 1.4);
    const p = pen("bed", x, y, z, yaw, opts);
    const linen = p.col("linen");
    p.put(0, 0, 0, W, 0.32, L, p.col("frame"), { solid: true });            // frame
    const top = p.put(0, 0.32, 0, W - 0.08, 0.23, L - 0.10, linen);         // mattress → 0.55
    p.put(0, 0.55, -L * 0.16, W - 0.04, 0.05, L * 0.55, P.blanket);         // folded blanket
    p.put(0, 0.55, L / 2 - 0.34, W - 0.34, 0.14, 0.38, P.pillow);           // pillow
    p.put(0, 0.12, L / 2 + 0.06, W + 0.10, 0.83, 0.12, P.head);             // headboard
    p.bed(L - 0.10, y + 0.55, "bed", top);
    return p.done(W, L + 0.12, 0.95, top);
  };

  // LOUNGER — a flat sun bed: four short legs, a slatted deck at 0.34, and a
  // bolster at the head end. yaw points toward the HEAD, exactly like F.bed, so
  // a caller that can place a bed can place one of these with no new knowledge.
  //
  // IT IS DELIBERATELY FLAT. A real sun lounger's backrest ratchets up, and the
  // tempting thing to draw is the raised one — but the raised back is what the
  // lying body would clip straight through, and a lounger you can only stand
  // beside is a decoy. Flat deck + low bolster reads as "made up for lying on"
  // and is honest about what the body will actually do on it. The raised-back
  // pose belongs to F.deckchair, which is a SEAT and animates as one.
  // opts.len (default 1.95) · opts.wide (default 0.72).
  F.lounger = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const L = Math.max(1.5, opts.len != null ? +opts.len : 1.95);
    const W = Math.max(0.55, opts.wide != null ? +opts.wide : 0.72);
    const p = pen("lounger", x, y, z, yaw, opts);
    const canvas = p.col("cloth"), frame = p.col("frame");
    for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2)
      p.put(a * (W / 2 - 0.08), 0, b * (L / 2 - 0.22), 0.05, 0.24, 0.05, frame);   // legs
    p.put(0, 0.24, 0, W, 0.04, L, frame);                                          // rails
    // The deck carries the collider but only up to its own top, so the height
    // gate in propuse's entry solve still lets a body stand alongside it.
    const top = p.put(0, 0.28, 0, W - 0.06, 0.06, L - 0.08, canvas, { solid: true, colH: 0.06 });  // deck → 0.34
    p.put(0, 0.34, L / 2 - 0.26, W - 0.20, 0.10, 0.34, P.pillow);                   // head bolster
    p.bed(L - 0.08, y + 0.34, "lounger", top);
    return p.done(W, L, 0.44, top);
  };

  // DECKCHAIR — the folding canvas chair: a low seat at 0.38 and a raked back
  // stepped out of three slabs (boxes here are never rotated, so a rake is
  // drawn as a stagger). yaw = the direction the sitter LOOKS, so on a beach
  // you point it at the water and the body arrives facing the sea.
  F.deckchair = function (x, y, z, yaw, opts) {
    const p = pen("deckchair", x, y, z, yaw, opts);
    const canvas = p.col("cloth"), frame = p.col("frame");
    for (let a = -1; a <= 1; a += 2) {
      p.put(a * 0.27, 0, 0.24, 0.05, 0.40, 0.05, frame);        // front uprights
      p.put(a * 0.27, 0, -0.20, 0.05, 0.34, 0.05, frame);       // rear uprights (shorter)
      p.put(a * 0.27, 0.34, -0.30, 0.05, 0.62, 0.05, frame);    // back frame, staggered aft
    }
    const top = p.put(0, 0.32, 0.02, 0.58, 0.06, 0.56, canvas, { solid: true, colH: 0.06 });  // seat → 0.38
    p.put(0, 0.38, -0.22, 0.54, 0.24, 0.06, canvas);            // back, lower panel
    p.put(0, 0.60, -0.30, 0.54, 0.24, 0.06, canvas);            // back, upper panel
    p.seat(0, 0.02, yaw, "deck", 0.38, top);
    return p.done(0.60, 0.68, 0.96, top);
  };

  // ======================================================================
  //  WORK SURFACES
  // ======================================================================

  // DESK — worktop 0.74, drawer pedestal, modesty panel, monitor facing the
  // worker, and a CHAIR BEHIND IT facing the desk (yaw = the worker's look
  // direction, so the desk's public face is the +forward side).
  F.desk = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const L = Math.max(1.0, opts.len != null ? +opts.len : 1.5);
    const D = Math.max(0.6, opts.deep != null ? +opts.deep : 0.75);
    const p = pen("desk", x, y, z, yaw, opts);
    p.put(-(L / 2 - 0.26), 0.02, 0, 0.46, 0.64, D - 0.10, P.desk, { solid: true, colH: 0.72 });
    p.put(L / 2 - 0.05, 0.02, 0, 0.08, 0.66, D - 0.14, P.chair);           // end leg
    p.put(0, 0.16, D / 2 - 0.05, L - 0.14, 0.50, 0.06, P.desk);            // modesty panel
    const top = p.put(0, 0.68, 0, L, 0.06, D, P.worktop);                  // worktop → 0.74
    p.put(0, 0.74, D / 2 - 0.22, 0.12, 0.06, 0.14, P.bezel);               // monitor stand
    p.put(0, 0.78, D / 2 - 0.22, 0.62, 0.42, 0.05, P.bezel);               // monitor
    p.put(0, 0.80, D / 2 - 0.245, 0.52, 0.32, 0.02, P.screen, { emissive: P.screen, ei: 0.35 });
    // the chair behind the desk, facing it (= facing along yaw, over the top)
    const so = sub(opts);
    const cr = F.chair(p.wx(0, -(D / 2 + 0.42)), y, p.wz(0, -(D / 2 + 0.42)), yaw, so);
    for (let i = 0; i < cr.seats.length; i++) p.seats.push(cr.seats[i]);
    return p.done(L, D + 0.94, 1.20, top);
  };

  // TABLE — worktop 0.74 on an apron and four legs, with opts.seats (default 4)
  // chairs ringed around it, every one facing the centre. opts.len / opts.deep.
  F.table = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const L = Math.max(0.8, opts.len != null ? +opts.len : 1.6);
    const D = Math.max(0.6, opts.deep != null ? +opts.deep : 0.9);
    const n = Math.max(0, opts.seats != null ? (opts.seats | 0) : 4);
    const p = pen("table", x, y, z, yaw, opts);
    const wood = p.col("wood");
    for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2)
      p.put(a * (L / 2 - 0.12), 0, b * (D / 2 - 0.10), 0.08, 0.56, 0.08, wood);
    p.put(0, 0.56, 0, L - 0.16, 0.10, D - 0.16, wood, { solid: true, colH: 0.18 });   // apron
    const top = p.put(0, 0.66, 0, L, 0.08, D, wood);                                  // top → 0.74
    // ring: half the chairs down each long side, the remainder at the +x end
    const perSide = Math.floor(n / 2), ends = n - perSide * 2;
    const so = sub(opts);
    const place = function (lat, fwd, face) {
      const cr = F.chair(p.wx(lat, fwd), y, p.wz(lat, fwd), face, so);
      for (let i = 0; i < cr.seats.length; i++) p.seats.push(cr.seats[i]);
    };
    for (let i = 0; i < perSide; i++) {
      const lat = -L / 2 + L * (i + 0.5) / perSide;
      place(lat, D / 2 + 0.42, yaw + Math.PI);      // far side looks back along -fwd
      place(lat, -(D / 2 + 0.42), yaw);             // near side looks along +fwd
    }
    for (let e = 0; e < ends; e++)
      place((e === 0 ? 1 : -1) * (L / 2 + 0.42), 0, yaw + (e === 0 ? -HALF_PI : HALF_PI));
    return p.done(L, D, 0.74, top);
  };

  // COUNTER — a SERVED-FROM counter: worktop 0.92, kick recess, customer-side
  // bumper rail, and a till facing the staff side (-forward). opts.len (2.6).
  // No seats unless opts.stools — then floor(len/0.9) stools on the customer
  // side, each facing the counter.
  F.counter = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const L = Math.max(0.9, opts.len != null ? +opts.len : 2.6);
    const D = Math.max(0.5, opts.deep != null ? +opts.deep : 0.75);
    const p = pen("counter", x, y, z, yaw, opts);
    p.put(0, 0, 0, L - 0.12, 0.12, D - 0.14, P.chair);                       // kick recess
    p.put(0, 0.12, 0, L, 0.74, D, P.desk, { solid: true, colH: 0.80 });      // body
    const top = p.put(0, 0.86, 0, L + 0.08, 0.06, D + 0.10, P.worktop);      // worktop → 0.92
    p.put(0, 0.60, D / 2 + 0.06, L, 0.06, 0.04, P.worktop);                  // customer-side rail
    p.put(L / 2 - 0.42, 0.92, -0.05, 0.34, 0.22, 0.28, P.bezel);             // till
    p.put(L / 2 - 0.42, 0.96, -0.20, 0.26, 0.14, 0.02, P.screen, { emissive: P.screen, ei: 0.35 });
    if (opts.stools) {
      const n = Math.max(1, Math.floor(L / 0.9));
      const so = sub(opts);
      for (let i = 0; i < n; i++) {
        const lat = -L / 2 + L * (i + 0.5) / n;
        const sr = F.stool(p.wx(lat, D / 2 + 0.50), y, p.wz(lat, D / 2 + 0.50), yaw + Math.PI, so);
        for (let j = 0; j < sr.seats.length; j++) p.seats.push(sr.seats[j]);
      }
    }
    return p.done(L + 0.08, D + 0.10, 1.14, top);
  };

  // ======================================================================
  //  STORAGE + LIGHT
  // ======================================================================

  // SHELF — a storage rack: plinth, back panel, two uprights, three boards and
  // a cap. opts.len (1.8) · opts.deep (0.5) · opts.h (2.0). One full-height
  // collider so it reads as a wall of stock, not a step.
  F.shelf = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const L = Math.max(0.8, opts.len != null ? +opts.len : 1.8);
    const D = Math.max(0.35, opts.deep != null ? +opts.deep : 0.5);
    const H = Math.max(1.0, opts.h != null ? +opts.h : 2.0);
    const p = pen("shelf", x, y, z, yaw, opts);
    p.put(0, 0, 0, L, 0.30, D, P.metal, { solid: true, colH: H });          // plinth (collider = whole rack)
    p.put(0, 0.30, -(D / 2 - 0.03), L, H - 0.30, 0.06, P.metal);            // back panel
    for (let a = -1; a <= 1; a += 2)
      p.put(a * (L / 2 - 0.03), 0.30, 0, 0.06, H - 0.30, D, P.metal);       // uprights
    const gap = (H - 0.35) / 4;
    for (let i = 1; i <= 3; i++)
      p.put(0, 0.30 + gap * i, 0, L - 0.12, 0.05, D - 0.06, P.shelf);       // boards
    const top = p.put(0, H - 0.05, 0, L, 0.05, D, P.shelf);                 // cap → H
    return p.done(L, D, H, top);
  };

  // LOCKER — opts.n (default 3) doors of 0.42 each, 1.9 tall.
  F.locker = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const n = Math.max(1, opts.n != null ? (opts.n | 0) : 3);
    const H = Math.max(1.2, opts.h != null ? +opts.h : 1.9);
    const D = 0.5, W = n * 0.42;
    const p = pen("locker", x, y, z, yaw, opts);
    p.put(0, 0, 0, W, H, D, P.metal, { solid: true });                       // carcass
    for (let i = 0; i < n; i++) {
      const lat = -W / 2 + 0.42 * (i + 0.5);
      p.put(lat, 0.08, D / 2 - 0.005, 0.38, H - 0.16, 0.02, P.metalD);       // door face
      p.put(lat + 0.14, H * 0.52, D / 2 + 0.02, 0.03, 0.16, 0.03, P.shelf);  // handle
    }
    return p.done(W, D, H, y + H);
  };

  // LAMP — base, pole, emissive shade. PURPOSE = light (no yaw: a lamp has no
  // front). opts.h (default 1.55) · opts.ei (glow strength).
  F.lamp = function (x, y, z, opts) {
    opts = opts || {};
    const H = Math.max(0.4, opts.h != null ? +opts.h : 1.55);
    const p = pen("lamp", x, y, z, 0, opts);
    p.put(0, 0, 0, 0.28, 0.05, 0.28, P.chair);                               // base
    p.put(0, 0.05, 0, 0.06, H - 0.30, 0.06, P.chair);                        // pole
    const top = p.put(0, H - 0.26, 0, 0.34, 0.24, 0.34, P.lamp,
      { emissive: P.lamp, ei: opts.ei != null ? +opts.ei : 0.6 });           // shade
    return p.done(0.34, 0.34, H, top);
  };

  // ======================================================================
  //  BOSS DESK — OWNER ASK: a boss's office must read as A PLACE OF POWER.
  //  Oversized desk (2.6 × 1.1) with a full modesty slab and twin pedestals,
  //  a HIGH-BACK "throne" behind it (cushion 0.50, 1.30 back), and two LOWER
  //  guest chairs facing it across the desk. Returns all three seat anchors:
  //  seats[0] = the throne, seats[1..2] = the guests.
  // ======================================================================
  F.bossDesk = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const L = Math.max(1.8, opts.len != null ? +opts.len : 2.6);
    const D = Math.max(0.8, opts.deep != null ? +opts.deep : 1.1);
    const p = pen("bossDesk", x, y, z, yaw, opts);
    const surf = p.col("wood"), cloth = p.col("cloth");
    for (let a = -1; a <= 1; a += 2)
      p.put(a * (L / 2 - 0.32), 0.02, 0, 0.56, 0.64, D - 0.16, P.darkwood);
    p.put(0, 0.06, D / 2 - 0.06, L - 0.20, 0.60, 0.10, P.darkwood, { solid: true, colH: 0.68 });
    const top = p.put(0, 0.66, 0, L, 0.08, D, surf);                         // worktop → 0.74
    p.put(0, 0.74, D / 2 - 0.10, 0.46, 0.05, 0.08, P.worktop);               // nameplate
    p.put(0.55, 0.74, D / 2 - 0.34, 0.12, 0.06, 0.14, P.bezel);              // monitor stand
    p.put(0.55, 0.78, D / 2 - 0.34, 0.66, 0.44, 0.05, P.bezel);              // monitor
    p.put(0.55, 0.80, D / 2 - 0.365, 0.56, 0.34, 0.02, P.screen, { emissive: P.screen, ei: 0.35 });

    // THE THRONE — high-back, on a pedestal column, behind the desk.
    const tf = -(D / 2 + 0.52);
    p.put(0, 0, tf, 0.54, 0.05, 0.54, P.chair);                              // base
    p.put(0, 0.05, tf, 0.14, 0.37, 0.14, P.chair);                           // column
    const tTop = p.put(0, 0.42, tf, 0.62, 0.08, 0.62, cloth);                // cushion → 0.50
    p.put(0, 0.50, tf - 0.27, 0.62, 0.80, 0.10, cloth);                      // high back → 1.30
    for (let a = -1; a <= 1; a += 2)
      p.put(a * 0.31, 0.50, tf, 0.08, 0.16, 0.48, cloth);                    // arms
    p.seat(0, tf, yaw, "throne", 0.50, tTop);                                // looks out over the desk

    // TWO LOWER GUEST CHAIRS, facing the desk across it.
    const so = sub(opts), gf = D / 2 + 0.55;
    for (let a = -1; a <= 1; a += 2) {
      const cr = F.chair(p.wx(a * 0.62, gf), y, p.wz(a * 0.62, gf), yaw + Math.PI, so);
      for (let i = 0; i < cr.seats.length; i++) p.seats.push(cr.seats[i]);
    }
    return p.done(L, D + 1.6, 1.30, top);
  };

  CBZ.furnish = F;
})();
