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

     Returned  { w, d, h, seats, top, parts }
       w   extent along the piece's own LATERAL axis
       d   extent along the piece's own FORWARD axis
       h   overall height above `y`
       top world/host Y of the USABLE surface (cushion, mattress, worktop…)
       seats [{x, y, z, face, yaw, kind, cushion, rec}] — WORLD coords, ready
             to hand straight to CBZ.interiorStaff (it reads x/y/z/yaw).
       parts every mesh this call drew, sub-pieces included — hand it straight
             to CBZ.pushables.add({parts, seat}) and the bench you just drew is
             a bench somebody can SHOVE, with its seat anchor riding along.

   PROPORTIONS ARE REAL METRES and are the contract with the character rig:
     chair seat 0.45 · stool 0.68 · sofa cushion 0.40 (back 0.85) ·
     armchair cushion 0.42 · bed mattress top 0.55 · desk/table worktop 0.74 ·
     coffee table top 0.40 · counter 0.92 · boss "throne" cushion 0.50 ·
     deckchair seat 0.38 · lounger deck 0.34. Every one of these is also the
     number city/propuse.js's SEAT_H holds for the same kind string, so the
     drawn box and the pose solved against it can never disagree.

   TWO FLAGS, not one. FURNISH_KIT is the existence switch (above). FURNISH_
   DETAIL is the RICHNESS switch: with it off every piece still draws its
   structure and its cushion/mattress/worktop at the IDENTICAL heights (so the
   audit, the rig and every caller are untouched) and simply skips the
   second-order boxes — cushion seams, arm pads, duvet folds, bed rails,
   drawer faces, apron shadows, leg stretchers. That is the one-line revert if
   the box count ever costs a frame; it is NOT a behaviour change.

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
  // FURNISH_DETAIL — the SECOND-ORDER boxes only: per-seat cushion seams, arm
  // pads, duvet folds, side rails, drawer faces, apron shadows. Every piece
  // still draws its structural boxes (and the EXACT same cushion/mattress/
  // worktop heights, so the audit and the rig are untouched) when this is off,
  // which is the one-line revert if the added box count ever costs a frame.
  // Read at CALL time, never captured, so ?cfg_FURNISH_DETAIL=0 works on a
  // world rebuild without a reload.
  if (CBZ.CONFIG.FURNISH_DETAIL == null) CBZ.CONFIG.FURNISH_DETAIL = true;
  function det() { return CBZ.CONFIG.FURNISH_DETAIL !== false; }

  const HALF_PI = Math.PI / 2;
  const EPS_CUSHION = 0.02;          // 2cm — the audit's mismatch tolerance
  // Minimum AIR between a display's rear face and its bezel. The old screen
  // boxes touched or intersected the bezel by 0-10mm, which depth-fought after
  // batching. Physical separation survives every material/batch path.
  const SCREEN_GAP = 0.025;

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
    duvet:   0x55606e,   // the duvet cover (tone key; same bucket as blanket)
    pillow:  0xe8e8ee,   // pillow                          (buildings.js setBedroom)
    head:    0x55606e,   // headboard                       (buildings.js setBedroom)
    shelf:   0x8a939c,   // shelf board / handle            (interior_programs P.shelf)
    metal:   0x49505b,   // cabinet / locker / rack body    (buildings.js setKitchen)
    metalD:  0x2e2620,   // locker door face                (buildings.js wardrobe)
    lamp:    0xffe6b0,   // warm lamp glow                  (buildings.js setBedroom lamp)
    // THE GREENS + CLAY. The only new buckets in this file, and they replace
    // three different hand-rolled plant palettes (fitout_plans, fitout_work,
    // the exec floor) that each minted their own.
    leaf:    0x3f7a45, leaf2: 0x2f6338, leaf3: 0x5a8f4a, trunk: 0x5a4632,
    pot:     0x3a3a3c, soil: 0x3b2c20, clay: 0x9a5a3c,
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
      /* THE MESHES, HANDED BACK. A piece already returns what it IS (w/d/h/top)
         and what it MEANS (seats/beds) and had no way to say what it DREW — so
         a caller could not hand a bench to systems/pushables.js, which takes
         `parts`. Two services that are both about furniture could not be
         composed, and the workaround is the one this repo bans: draw the bench
         again out of boxes so you own the meshes. Collected here, where every
         box already passes through. A host `box` fn that returns something
         other than an Object3D contributes nothing and costs nothing. */
      parts: [],
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
        const m = draw(p.wx(lat, fwd), cy, p.wz(lat, fwd), w, h, d, color, oo);
        if (m && m.isObject3D) p.parts.push(m);
        return cy + h / 2;
      },
      // register a SEAT. `cushion` is the declared height above the floor;
      // `drawnTop` is what put() returned for the cushion box — the two must
      // agree or the audit counts a mismatch.
      seat: function (lat, fwd, face, kind, cushion, drawnTop) {
        const sx = ox + p.wx(lat, fwd), sz = oz + p.wz(lat, fwd), sy = y + oy;
        if (drawnTop == null || Math.abs((drawnTop - y) - cushion) > EPS_CUSHION) led.mismatched++;
        const geom = { cushion: cushion, floorBelow: 0 };
        /* ...and when propuse has not parsed yet, THE QUEUE — the same shim
           the bed path below uses, for the same load-order reason. The bed
           path's comment already claimed "the SEAT path three lines below
           already uses it"; it did not. propuse.js parses at index.html:1007,
           so for every world/* furnisher outside the city `propRegisterSeat`
           is simply absent and this line dropped the anchor on the floor. The
           rooms that kept their seating kept it only because propuse's own
           `reseat()` re-files anchors afterwards — delete one reseat() call
           and a room silently loses every chair in it. A queued anchor
           registers at `load` and returns null, so `a.rec` is null for those
           callers exactly as it was before. */
        const rec = CBZ.propRegisterSeat
          ? CBZ.propRegisterSeat(sx, sy, sz, face, kind, p.lot, geom)
          : (CBZ.roomSeatAnchor ? CBZ.roomSeatAnchor(sx, sy, sz, face, kind, p.lot, geom) : null);
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
        // ...and when propuse has not parsed yet, the QUEUE. Every world/*
        // furnisher outside the city runs before city/propuse.js (index.html
        // :817), so `propRegisterBed` is simply absent there and this line
        // used to return null and drop the anchor on the floor — measured in
        // the prison: the warden's quarters had a drawn bed and no bed record,
        // so nothing could ever be put in it. world/roombuild.js's shim exists
        // for exactly this and the SEAT path three lines below already uses it.
        // A queued anchor returns null (it registers at `load`), so `p.beds`
        // is unchanged for every caller that had one.
        const rec = CBZ.propRegisterBed
          ? CBZ.propRegisterBed(bx, by, bz, s, c, len, topY + oy, kind, p.lot)
          : (CBZ.roomBedAnchor ? CBZ.roomBedAnchor(bx, by, bz, s, c, len, topY + oy, kind, p.lot) : null);
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
        return { w: w, d: d, h: h, top: top, seats: p.seats, beds: p.beds, parts: p.parts };
      },
    };
    return p;
  }

  // opts pass-through for a sub-piece (a desk's own chair, a table's ring) —
  // the sub-piece must never inherit `len`/`seats`/`solid` sizing knobs.
  function sub(opts, parent) {
    opts = opts || {};
    // `solid` rides along: a cluster's own chairs (desk chair, table ring, the
    // boss's guest chairs) must be as solid as the cluster asked to be, or you
    // walk straight through the chairs in front of the boss's desk.
    // ...and so does the parent's MESH SINK, for the same reason its seats are
    // merged upward six lines below every call site: a caller handed a desk
    // whose `seats` includes the chair's anchor and whose `parts` did not
    // include the chair would be holding a contract that contradicts itself.
    return { box: opts.box, ox: opts.ox, oz: opts.oz, oy: opts.oy, lot: opts.lot, tone: opts.tone, solid: opts.solid,
      _parts: parent ? parent.parts : null };
  }

  const F = {};

  // ======================================================================
  //  SEATING
  // ======================================================================

  // CHAIR — four THIN legs, a seat frame, a pad that OVERHANGS the frame, and a
  // back RAKED by the deckchair stagger trick (boxes are never rotated here, so
  // a lean is drawn as three stacked panels each set a little further aft).
  // Cushion 0.45 — unchanged, and it is the pad's real top, so the audit and
  // entities/character.js's chair solve see exactly what is drawn.
  //
  // WHY THIS SHAPE: the old chair was a 0.06 post at each corner under a slab
  // and one vertical slab behind it — the silhouette of a box, not a chair. The
  // three things the eye actually uses to read "chair" are (a) legs thin enough
  // to see the floor between, (b) a pad whose edge oversails the frame so the
  // seat casts its own line, and (c) a back that is NOT vertical.
  F.chair = function (x, y, z, yaw, opts) {
    const p = pen("chair", x, y, z, yaw, opts);
    // opts.frameCol: the wood/metal of the frame. A dining set is ONE timber:
    // F.table hands its own wood to the chairs round it, and a caller with no
    // opinion keeps the charcoal frame every office and cell chair has.
    const fc = opts && opts.frameCol != null ? opts.frameCol : P.chair;
    const leg = fc, pad = p.col("cloth"), body = fc;
    const D = det();
    const legT = D ? 0.045 : 0.06;                                   // thinner legs read as legs
    // Front legs stop under the seat; the REAR pair keep going as the back's
    // uprights (one box each, not a leg plus a separate post 2 cm off it) —
    // which is how a real chair is built and why the back never looks bolted on.
    for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2)
      p.put(a * 0.205, 0, b * 0.205, legT, (D && b < 0) ? 0.89 : 0.37, legT, leg);
    // the seat FRAME the pad sits proud of (0.44 vs the pad's 0.52 → a 4cm
    // reveal on every side). It also ties the four legs together, which is what
    // stops them reading as four unrelated sticks.
    if (D) p.put(0, 0.37, 0, 0.44, 0.05, 0.44, leg);
    // The pad carries the collider (height-gated to the cushion, so a body can
    // still stand in the chair's footprint to reach the seat anchor) — a chair
    // you walk through is a decoy, and `opts.solid` used to be a no-op here.
    const top = D
      ? p.put(0, 0.39, 0, 0.52, 0.06, 0.52, pad, { solid: true, colH: 0.06 })            // cushion → 0.45
      : p.put(0, 0.37, 0, 0.50, 0.08, 0.50, pad, { solid: true, colH: 0.08 });           // cushion → 0.45
    if (D) {
      // AN OPEN BACK, the way a chair is joined: a top rail and a lower rail
      // tenoned between the two rear uprights, two slats between them, and AIR
      // round the slats. The old back was three solid panels stacked into a
      // wall; the gaps are what make it read as a chair from across a room.
      p.put(0, 0.79, -0.205, 0.41, 0.10, 0.035, body);               // top rail
      p.put(0, 0.53, -0.205, 0.41, 0.045, 0.03, body);               // lower rail
      for (let a = -1; a <= 1; a += 2)
        p.put(a * 0.075, 0.575, -0.205, 0.04, 0.215, 0.022, body);    // slats
    } else {
      p.put(0, 0.49, -0.21, 0.50, 0.55, 0.08, body);                 // backrest (legacy slab)
    }
    p.seat(0, 0, yaw, "chair", 0.45, top);
    return p.done(0.52, D ? 0.55 : 0.50, 0.95, top);
  };

  // TASK CHAIR — the office chair every desk has: a five-spoke base drawn as
  // a cross of spokes with a caster under each end, a gas lift, a seat pan and
  // a pad whose top is 0.45 (the SAME cushion and kind "chair" as F.chair, so
  // the rig and every anchor reader see nothing new), a curved-looking back on
  // its stem, and two armrests. yaw = the way the sitter looks.
  F.taskChair = function (x, y, z, yaw, opts) {
    const p = pen("taskChair", x, y, z, yaw, opts);
    const pad = p.col("cloth"), frame = P.bezel;
    const D = det();
    p.put(0, 0.03, 0, 0.62, 0.03, 0.06, frame);                               // spokes
    p.put(0, 0.03, 0, 0.06, 0.03, 0.62, frame);
    if (D) for (let a = -1; a <= 1; a += 2) {
      p.put(a * 0.29, 0, 0, 0.05, 0.03, 0.05, frame);                          // casters
      p.put(0, 0, a * 0.29, 0.05, 0.03, 0.05, frame);
    }
    p.put(0, 0.06, 0, 0.05, 0.28, 0.05, P.shelf);                              // gas lift
    p.put(0, 0.34, 0, 0.42, 0.04, 0.42, frame);                                // seat pan
    const top = p.put(0, 0.38, 0.01, 0.5, 0.07, 0.5, pad, { solid: true, colH: 0.07 });   // cushion → 0.45
    p.put(0, 0.36, -0.25, 0.06, 0.2, 0.03, frame);                             // back stem
    p.put(0, 0.54, -0.27, 0.46, 0.42, 0.06, pad);                              // back 0.54..0.96
    if (D) p.put(0, 0.58, -0.295, 0.4, 0.34, 0.012, frame);                    // its shell
    if (D) for (let a = -1; a <= 1; a += 2) {
      p.put(a * 0.27, 0.40, -0.02, 0.03, 0.2, 0.03, frame);                    // arm post
      p.put(a * 0.27, 0.60, 0.0, 0.06, 0.03, 0.26, frame);                     // arm pad → 0.63
    }
    p.seat(0, 0, yaw, "chair", 0.45, top);
    return p.done(0.62, 0.62, 0.96, top);
  };

  // ARMCHAIR — a ONE-SEAT sofa, and the documented gap in this kit: world/
  // lounge.js and world/roombuild.js's lounge program both wanted one and both
  // had to spell it as F.chair with a lie for a kind ("armchair" seat anchor on
  // a 0.45 dining chair). Cushion 0.42 — the number city/propuse.js's SEAT_H
  // already holds for kind "armchair", so the rig's pose and the drawn box
  // agree without anybody editing a table.
  F.armchair = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const W = Math.max(0.70, opts.len != null ? +opts.len : 0.94);
    const p = pen("armchair", x, y, z, yaw, opts);
    const cloth = p.col("cloth");
    const D = det();
    // short legs under the body, not a plinth: you see floor under a chair
    for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2)
      p.put(a * (W / 2 - 0.1), 0, b * 0.32, 0.05, 0.10, 0.05, P.darkwood);
    p.put(0, 0.10, 0, W, 0.24, 0.88, cloth, { solid: true, colH: 0.74 });     // body
    const top = p.put(0, 0.34, 0.04, W - 0.30, 0.08, 0.72, cloth);            // cushion → 0.42
    p.put(0, 0.42, -0.34, W - 0.26, 0.40, 0.14, cloth);                       // back cushion → 0.82
    p.put(0, 0.34, -0.42, W, 0.48, 0.06, cloth);                              // back frame → 0.82
    for (let a = -1; a <= 1; a += 2) {
      p.put(a * (W / 2 - 0.08), 0.34, 0.02, 0.16, 0.22, 0.84, cloth);         // arm
      if (D) p.put(a * (W / 2 - 0.08), 0.56, 0.02, 0.18, 0.05, 0.80, cloth);  // soft arm pad → 0.61
    }
    p.seat(0, 0.04, yaw, "armchair", 0.42, top);
    return p.done(W, 0.90, 0.82, top);
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
    const DT = det();
    for (let a = -1; a <= 1; a += 2) {
      p.put(a * (L / 2 - 0.22), 0, 0, 0.10, 0.35, 0.42, P.chair);    // end legs
      if (DT) p.put(a * (L / 2 - 0.22), 0.16, 0, 0.14, 0.06, 0.50, P.chair);   // cast-iron foot
    }
    // A bench is SLATS. Two boards with a 4cm gap between them at the identical
    // height read as a park bench; one 0.48-deep plank reads as a shelf. Both
    // sit at 0.35→0.45, so the declared cushion is still the drawn top.
    // The COLLIDER stays on ONE box either way (a seat frame under the slats,
    // height-gated to the same 0.45 the plank used to reach) so slatting the
    // seat cannot double the bench's collider count.
    if (DT) p.put(0, 0.29, 0, L - 0.06, 0.06, 0.48, P.chair, { solid: true, colH: 0.16 });
    const top = DT
      ? p.put(0, 0.35, 0.11, L, 0.10, 0.22, wood)                                      // front slat → 0.45
      : p.put(0, 0.35, 0, L, 0.10, 0.48, wood, { solid: true, colH: 0.10 });           // plank → 0.45
    if (DT) p.put(0, 0.35, -0.13, L, 0.10, 0.22, wood);                                // rear slat → 0.45
    if (back && DT) {
      p.put(0, 0.50, -0.19, L, 0.16, 0.07, wood);                    // lower back rail
      p.put(0, 0.72, -0.23, L, 0.16, 0.07, wood);                    // upper back rail, stepped aft
      for (let a = -1; a <= 1; a += 2)
        p.put(a * (L / 2 - 0.22), 0.45, -0.21, 0.09, 0.45, 0.09, P.chair);   // back uprights
    } else if (back) {
      p.put(0, 0.55, -0.20, L, 0.42, 0.08, wood);                    // backrest
    }
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
    const D = det();
    // short legs at the corners (and mid-span on a long sofa): the floor
    // shows under it, which is the difference between a sofa and a block of
    // upholstery sitting on the carpet
    for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2)
      p.put(a * (L / 2 - 0.1), 0, b * 0.33, 0.05, 0.12, 0.05, P.darkwood);
    if (L > 1.9) for (let b = -1; b <= 1; b += 2) p.put(0, 0, b * 0.33, 0.05, 0.12, 0.05, P.darkwood);
    p.put(0, 0.12, 0, L, 0.22, 0.85, cloth, { solid: true, colH: 0.73 });   // body
    // THE SEAM IS THE WHOLE READ. A sofa is three cushions, and one 2.24-long
    // slab is a bench with upholstery on it. Draw the cushion ONCE PER SEAT
    // with a 3cm gap between, all at the identical 0.34→0.40 band, so the
    // declared cushion is still the drawn top and `mismatched` stays 0. The
    // FIRST cushion is the one handed to the audit; the others are its clones.
    const inner = L - 0.16, GAP = 0.03;
    const cw = D ? (inner - GAP * 2) / 3 : inner;
    let top = 0;
    for (let i = -1; i <= 1; i++) {
      const t = p.put(D ? i * (cw + GAP) : 0, 0.34, 0.03, cw, 0.06, 0.74, cloth);   // cushion → 0.40
      if (i === -1) top = t;
      if (!D) break;
    }
    // The BACK is a hard frame with soft cushions in front of it, not one slab:
    // the frame is what the arms and the top edge belong to, the cushions are
    // what the shoulders touch, and the 4cm they stand proud is the difference
    // between "sofa" and "padded wall".
    p.put(0, 0.34, -0.375, L, 0.51, 0.10, cloth);                           // back frame → 0.85
    if (D) for (let i = -1; i <= 1; i++)
      p.put(i * (cw + GAP), 0.40, -0.285, cw, 0.36, 0.10, cloth);           // back cushions → 0.76
    for (let a = -1; a <= 1; a += 2) {
      p.put(a * (L / 2 - 0.09), 0.34, 0.02, 0.18, 0.24, 0.80, cloth);       // arm frame → 0.58
      if (D) p.put(a * (L / 2 - 0.09), 0.58, 0.02, 0.20, 0.05, 0.76, cloth); // soft arm pad → 0.63
    }
    for (let i = -1; i <= 1; i++) p.seat(i * (L / 3), 0.03, yaw, "sofa", 0.40, top);
    return p.done(L, 0.85, 0.85, top);
  };

  // ======================================================================
  //  SLEEPING
  // ======================================================================

  // BED — yaw points from the mattress centre toward the PILLOW. Base + side
  // rails, mattress (visible sheet colour), a DUVET with a turned-down fold at
  // the head end, one or two pillows depending on the width, and a shaped
  // headboard (posts + panel + cap). opts.len (2.1) · opts.wide (1.4).
  // Mattress top 0.55 — the contract with the lying-body solve, unchanged.
  //
  // WHY THE FOLD: a made bed reads as made because of ONE line — the turn-down
  // where the duvet is folded back over itself near the pillows. Without it a
  // blanket box is indistinguishable from a second mattress. It costs one box.
  // PILLOW COUNT IS DERIVED, not a knob: a mattress ≥1.15 wide is a double and
  // gets two, anything narrower is a single and gets one, so a bunk, a cell cot
  // and a master bed all come out right from the size the caller already passed.
  F.bed = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const L = Math.max(1.6, opts.len != null ? +opts.len : 2.1);
    const W = Math.max(0.8, opts.wide != null ? +opts.wide : 1.4);
    const p = pen("bed", x, y, z, yaw, opts);
    const linen = p.col("linen"), frame = p.col("frame");
    const D = det();
    p.put(0, 0, 0, W, D ? 0.26 : 0.32, L, frame, { solid: true, colH: 0.32 });    // base
    if (D) {
      for (let a = -1; a <= 1; a += 2)
        p.put(a * (W / 2 - 0.03), 0.26, 0, 0.06, 0.11, L, frame);                 // side rails
      p.put(0, 0.26, -(L / 2 - 0.04), W, 0.17, 0.08, frame);                      // foot rail
    }
    const top = p.put(0, 0.32, 0, W - (D ? 0.14 : 0.08), 0.23, L - (D ? 0.16 : 0.10), linen);   // mattress → 0.55
    if (D) {
      // THE DUVET DRAPES. A cover lies OVER the mattress and falls down its
      // sides and foot to just above the rails, so from the room you see cloth
      // hanging, not a thin slab laid on a second slab. Its top is still 0.61
      // (the lying solve reads the mattress, 0.55, which is untouched).
      const duv = p.col("duvet"), dFoot = -L / 2 + 0.06, dHead = L * 0.09;
      p.put(0, 0.38, (dFoot + dHead) / 2, W - 0.08, 0.23, dHead - dFoot, duv);      // duvet → 0.61
      p.put(0, 0.56, L * 0.17, W - 0.07, 0.10, 0.16, linen);                         // TURNED-DOWN fold → 0.66
    } else {
      p.put(0, 0.55, -L * 0.16, W - 0.04, 0.05, L * 0.55, P.blanket);             // folded blanket
    }
    if (D && W >= 1.15) {
      for (let a = -1; a <= 1; a += 2)
        p.put(a * (W * 0.22), 0.55, L / 2 - 0.34, W * 0.40, 0.14, 0.38, P.pillow); // two pillows
    } else {
      p.put(0, 0.55, L / 2 - 0.34, W - 0.34, 0.14, 0.38, P.pillow);               // one pillow
    }
    if (D) {
      // SHAPED headboard: a recessed panel between two proud posts under a cap
      // rail. Three boxes instead of one slab, and the whole reason a bed reads
      // as furniture rather than a plinth when you walk in the door.
      p.put(0, 0.12, L / 2 + 0.05, W - 0.12, 0.72, 0.09, P.head);                 // panel → 0.84
      for (let a = -1; a <= 1; a += 2)
        p.put(a * (W / 2 + 0.01), 0.06, L / 2 + 0.06, 0.10, 0.86, 0.13, frame);   // posts → 0.92
      p.put(0, 0.84, L / 2 + 0.05, W + 0.14, 0.09, 0.15, P.head);                 // cap rail → 0.93
    } else {
      p.put(0, 0.12, L / 2 + 0.06, W + 0.10, 0.83, 0.12, P.head);                 // headboard
    }
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
    // SLAT SEAMS: three cross battens laid on the deck at the same 0.34, so a
    // sun lounger reads as a slatted frame instead of one canvas plank. Derived
    // from the length, never a magic spacing, so a long or short lounger both
    // come out evenly slatted.
    if (det()) for (let i = -1; i <= 1; i++)
      p.put(0, 0.32, i * (L * 0.24), W - 0.10, 0.02, 0.05, frame);
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

  // A FLAT-PANEL MONITOR on a worktop at `top`, its glass facing -forward (the
  // worker). A slim panel with a thin bezel and a deeper chin, a rear housing,
  // a neck and a foot that sits ON the desk: the old one was a 5 cm slab on a
  // cube with its glass hovering 2.5 cm in front of it (to dodge z-fighting),
  // which from the side read as two floating plates. The glass now sits 3 mm
  // proud of the bezel: separated, so it cannot fight, and flush to the eye.
  function monitor(p, lat, fwd, top, wide) {
    const hgt = wide * 0.6;
    p.put(lat, top, fwd + 0.03, 0.24, 0.012, 0.18, P.bezel);                      // foot
    p.put(lat, top + 0.012, fwd + 0.055, 0.05, 0.16, 0.03, P.bezel);               // neck
    p.put(lat, top + 0.10, fwd + 0.03, wide * 0.55, hgt * 0.62, 0.035, P.bezel);   // rear housing
    p.put(lat, top + 0.08, fwd, wide, hgt, 0.022, P.bezel);                       // the panel
    p.put(lat, top + 0.08 + 0.028, fwd - 0.011 - 0.003 - 0.002, wide - 0.03, hgt - 0.045, 0.004, P.screen,
      { emissive: P.screen, ei: 0.35 });                                         // glass, chin below it
  }

  // DESK — worktop 0.74, drawer pedestal, modesty panel, monitor facing the
  // worker, and a CHAIR BEHIND IT facing the desk (yaw = the worker's look
  // direction, so the desk's public face is the +forward side).
  F.desk = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const L = Math.max(1.0, opts.len != null ? +opts.len : 1.5);
    const D = Math.max(0.6, opts.deep != null ? +opts.deep : 0.75);
    const p = pen("desk", x, y, z, yaw, opts);
    const DT = det();
    p.put(-(L / 2 - 0.26), 0.02, 0, 0.46, 0.64, D - 0.10, P.desk, { solid: true, colH: 0.72 });
    if (DT) {
      // THREE DRAWER FACES on the pedestal, facing the worker (-forward), each
      // with a handle. A pedestal with no lines on it is a filing box; the
      // horizontal splits are what say "desk" from across a room.
      for (let i = 0; i < 3; i++) {
        p.put(-(L / 2 - 0.26), 0.08 + i * 0.19, -(D - 0.10) / 2 - 0.012, 0.40, 0.17, 0.03, P.metalD);
        p.put(-(L / 2 - 0.26), 0.14 + i * 0.19, -(D - 0.10) / 2 - 0.035, 0.16, 0.03, 0.03, P.shelf);
      }
    }
    p.put(L / 2 - 0.05, 0.02, 0, 0.08, 0.66, D - 0.14, P.chair);           // end leg
    p.put(0, 0.16, D / 2 - 0.05, L - 0.14, 0.50, 0.06, P.desk);            // modesty panel
    // APRON SHADOW: a dark recessed rail tucked under the worktop's front lip.
    // The worktop already oversails it by 4cm, so the rail is never lit the way
    // the top is and the top reads as a separate, floating slab.
    if (DT) p.put(0, 0.62, D / 2 - 0.05, L - 0.08, 0.06, 0.06, P.chair);
    const top = p.put(0, 0.68, 0, L, 0.06, D, P.worktop);                  // worktop → 0.74
    if (DT) p.put(0, 0.74, -0.02, 0.44, 0.02, 0.15, P.bezel);              // keyboard, worker side
    monitor(p, 0, D / 2 - 0.22, 0.74, 0.60);
    // the TASK chair behind the desk, facing it (= facing along yaw, over the top)
    const so = sub(opts, p);
    const cr = F.taskChair(p.wx(0, -(D / 2 + 0.42)), y, p.wz(0, -(D / 2 + 0.42)), yaw, so);
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
    const DT = det();
    // Legs run up to the underside of the top with the apron framed between
    // them (a table is a frame and a board), and the board is 35 mm thick:
    // the old 8 cm top on 8 cm posts over a slab apron was a butcher's block,
    // which is exactly the "chunky blocks" read.
    for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2)
      p.put(a * (L / 2 - 0.09), 0, b * (D / 2 - 0.08), DT ? 0.055 : 0.08, DT ? 0.705 : 0.56, DT ? 0.055 : 0.08, wood);
    if (DT) {
      for (let b = -1; b <= 1; b += 2)
        p.put(0, 0.61, b * (D / 2 - 0.08), L - 0.24, 0.09, 0.025, P.darkwood);       // long aprons
      for (let a = -1; a <= 1; a += 2)
        p.put(a * (L / 2 - 0.09), 0.61, 0, 0.025, 0.09, D - 0.2, P.darkwood);        // end aprons
      p.put(0, 0.665, 0, L - 0.2, 0.03, D - 0.2, P.darkwood, { solid: true, colH: 0.08 });   // under-frame (collider)
    } else {
      p.put(0, 0.56, 0, L - 0.16, 0.10, D - 0.16, wood, { solid: true, colH: 0.18 });       // apron
    }
    const top = DT ? p.put(0, 0.705, 0, L, 0.035, D, wood) : p.put(0, 0.66, 0, L, 0.08, D, wood);   // top → 0.74
    // ring: half the chairs down each long side, the remainder at the +x end
    const perSide = Math.floor(n / 2), ends = n - perSide * 2;
    const so = sub(opts, p);
    so.frameCol = opts.frameCol != null ? opts.frameCol : wood;          // the chairs are the table's set
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

  // COFFEE — the LOW OCCASIONAL TABLE, and the second documented hole in this
  // kit: world/lounge.js left its coffee table as authored boxes with a comment
  // saying so, and world/roombuild.js's lounge program had to fake one with a
  // DINING-height F.table (0.74) parked in front of a 0.40 sofa cushion — a
  // table taller than the seat backs of the people using it.
  //
  // Top 0.40: shin height, level with the sofa cushion it serves, which is the
  // real-world relationship (a coffee table is drawn at seat height, never at
  // worktop height). NO seats — nothing sits at one — and no `opts.seats` knob,
  // because the ring belongs to F.table. opts.len (1.1) · opts.deep (0.60).
  // A lower magazine shelf gives it the two-plane silhouette that reads as a
  // piece of furniture rather than a low platform.
  F.coffee = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const L = Math.max(0.6, opts.len != null ? +opts.len : 1.1);
    const D = Math.max(0.4, opts.deep != null ? +opts.deep : 0.60);
    const p = pen("coffee", x, y, z, yaw, opts);
    const wood = p.col("wood");
    const DT = det();
    for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2)
      p.put(a * (L / 2 - 0.09), 0, b * (D / 2 - 0.08), 0.06, 0.35, 0.06, wood);
    if (DT) p.put(0, 0.13, 0, L - 0.16, 0.04, D - 0.14, P.darkwood);        // magazine shelf, housed in the legs
    // The top oversails the legs by 9cm and carries a SHIN-HIGH collider only:
    // a coffee table between a sofa and a screen is an obstacle you step round,
    // never a wall, and never something the body can stand on.
    const top = p.put(0, 0.35, 0, L, 0.05, D, wood, { solid: true, colH: 0.05 });   // top → 0.40
    if (DT) p.put(0, 0.31, 0, L - 0.10, 0.04, D - 0.10, P.darkwood);        // apron shadow under the lip
    return p.done(L, D, 0.40, top);
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
    p.put(L / 2 - 0.42, 0.96, -0.19 - SCREEN_GAP - 0.01, 0.26, 0.14, 0.02, P.screen,
      { emissive: P.screen, ei: 0.35 });                                  // staff-facing glass
    if (opts.stools) {
      const n = Math.max(1, Math.floor(L / 0.9));
      const so = sub(opts, p);
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

  // WARDROBE — a home's hanging cupboard, the domestic twin of F.locker (which
  // is steel, and in a bedroom reads as a locker room). Recessed plinth, a
  // timber carcass, opts.n doors (default from the width) with a shadow gap
  // between each, a bar pull per door and a cornice. opts.len (1.2) ·
  // opts.h (2.0) · opts.deep (0.6). One full-height collider.
  F.wardrobe = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const L = Math.max(0.6, opts.len != null ? +opts.len : 1.2);
    const H = Math.max(1.4, opts.h != null ? +opts.h : 2.0);
    const D = Math.max(0.45, opts.deep != null ? +opts.deep : 0.6);
    const n = Math.max(1, opts.n != null ? (opts.n | 0) : Math.round(L / 0.5));
    const p = pen("wardrobe", x, y, z, yaw, opts);
    const wood = p.col("wood");
    p.put(0, 0, -0.02, L - 0.06, 0.08, D - 0.08, P.darkwood);                   // plinth, set back
    p.put(0, 0.08, 0, L, H - 0.12, D, wood, { solid: true, colH: H - 0.08 });   // carcass
    p.put(0, H - 0.04, 0.01, L + 0.04, 0.04, D + 0.03, wood);                   // cornice
    const dw = L / n;
    for (let i = 0; i < n; i++) {
      const lat = -L / 2 + dw * (i + 0.5);
      p.put(lat, 0.10, D / 2 + 0.006, dw - 0.008, H - 0.16, 0.012, wood);       // door face
      const side = (i % 2 === 0) ? 1 : -1;                                     // pulls meet at the pair's joint
      p.put(lat + side * (dw / 2 - 0.05), H * 0.42, D / 2 + 0.025, 0.018, 0.28, 0.02, P.shelf);
    }
    if (det()) for (let i = 1; i < n; i++)
      p.put(-L / 2 + dw * i, 0.10, D / 2 + 0.004, 0.006, H - 0.16, 0.006, P.darkwood);   // the shadow gap
    return p.done(L, D + 0.04, H, y + H);
  };

  // CREDENZA — the low storage piece under a boardroom screen or behind an
  // executive desk: set-back plinth, a timber carcass, opts.n doors with shadow
  // gaps and slim pulls, and a top that oversails by 2 cm. opts.len (1.8) ·
  // opts.h (0.72) · opts.deep (0.48). No seats; a waist-high collider.
  F.credenza = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const L = Math.max(0.8, opts.len != null ? +opts.len : 1.8);
    const H = Math.max(0.5, opts.h != null ? +opts.h : 0.72);
    const D = Math.max(0.35, opts.deep != null ? +opts.deep : 0.48);
    const n = Math.max(2, opts.n != null ? (opts.n | 0) : Math.round(L / 0.45));
    const p = pen("credenza", x, y, z, yaw, opts);
    const wood = p.col("wood");
    p.put(0, 0, -0.03, L - 0.08, 0.07, D - 0.08, P.darkwood);                          // plinth
    p.put(0, 0.07, 0, L - 0.02, H - 0.105, D - 0.02, wood, { solid: true, colH: H - 0.07 });   // carcass
    const top = p.put(0, H - 0.035, 0, L + 0.02, 0.035, D + 0.01, wood);               // top → H
    const dw = (L - 0.02) / n;
    for (let i = 0; i < n; i++) {
      const lat = -(L - 0.02) / 2 + dw * (i + 0.5);
      p.put(lat, 0.08, (D - 0.02) / 2 + 0.004, dw - 0.008, H - 0.13, 0.01, wood);      // door
      p.put(lat + ((i % 2) ? -1 : 1) * (dw / 2 - 0.04), H * 0.5, (D - 0.02) / 2 + 0.018, 0.012, 0.16, 0.014, P.shelf);
    }
    if (det()) for (let i = 1; i < n; i++)
      p.put(-(L - 0.02) / 2 + dw * i, 0.08, (D - 0.02) / 2 + 0.002, 0.006, H - 0.13, 0.006, P.darkwood);
    return p.done(L + 0.02, D + 0.01, H, top);
  };

  // PLANTER — a potted plant, drawn as a plant and not as green cubes stacked
  // on a brown cube. opts.kind:
  //   "snake"  sansevieria: stiff upright blades, which is the one plant whose
  //            real shape IS axis-aligned plates (the default, desks and sills)
  //   "tree"   a ficus / fiddle-leaf in a big pot: trunk, and ~30 small leaf
  //            plates set round it in a phyllotaxis spiral, bushiest mid-height
  // opts.s scale (1 = a 0.95 m snake plant / a 1.7 m tree) · opts.pot colour.
  // Deterministic: the leaf jitter is CBZ.hash01 of the position.
  F.planter = function (x, y, z, yaw, opts) {
    opts = opts || {};
    const s = Math.max(0.3, opts.s != null ? +opts.s : 1);
    const tree = opts.kind === "tree";
    const p = pen("planter", x, y, z, yaw, opts);
    const potC = opts.pot != null ? opts.pot : P.pot;
    const h = function (i, k) { return CBZ.hash01 ? CBZ.hash01(x * 3.1 + i * 1.7, z * 2.3 - i * 0.9, 0x91A + k) : ((i * 0.618 + k * 0.31) % 1); };
    const pw = (tree ? 0.42 : 0.26) * Math.min(1.2, s), ph = (tree ? 0.44 : 0.28) * Math.min(1.2, s);
    // a tapered pot: a narrower foot, the body, a rolled rim; soil inside it
    p.put(0, 0, 0, pw * 0.8, ph * 0.18, pw * 0.8, potC);
    p.put(0, ph * 0.18, 0, pw, ph * 0.74, pw, potC, { solid: true, colH: ph * 0.74 });
    p.put(0, ph * 0.92, 0, pw + 0.03, ph * 0.08, pw + 0.03, potC);
    p.put(0, ph - 0.015, 0, pw - 0.02, 0.01, pw - 0.02, P.soil);
    const y0 = ph - 0.01;
    const greens = [P.leaf, P.leaf2, P.leaf3];
    if (!tree) {
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996, r = (0.02 + (i % 3) * 0.035) * s;
        const bh = (0.38 + 0.45 * h(i, 1)) * s, bw = (0.05 + 0.025 * h(i, 2)) * s;
        const lat = Math.cos(a) * r, fwd = Math.sin(a) * r;
        const across = (i & 1) ? bw : 0.012, deep = (i & 1) ? 0.012 : bw;
        p.put(lat, y0, fwd, across, bh, deep, greens[i % 3]);
        // the blade narrows toward its tip
        p.put(lat, y0 + bh, fwd, across * ((i & 1) ? 0.55 : 1), bh * 0.18, deep * ((i & 1) ? 1 : 0.55), greens[i % 3]);
      }
      return p.done(pw + 0.03, pw + 0.03, y0 + 0.95 * s, y + ph);
    }
    const TH = 1.7 * s;
    p.put(0, y0, 0, 0.035, TH * 0.78, 0.035, P.trunk);                               // trunk
    p.put(0.03, y0 + TH * 0.35, 0, 0.14, 0.025, 0.025, P.trunk);                      // a limb
    p.put(-0.02, y0 + TH * 0.52, 0.02, 0.025, 0.025, 0.12, P.trunk);
    const n = 30;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a = i * 2.39996 + h(i, 3) * 0.6;
      const r = (0.08 + 0.2 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.05 * h(i, 4)) * s;
      const ly = y0 + TH * (0.32 + 0.66 * t) + (h(i, 5) - 0.5) * 0.06;
      const lat = Math.cos(a) * r, fwd = Math.sin(a) * r;
      const L = (0.15 + 0.07 * h(i, 6)) * s, W = L * 0.68;
      const flat = h(i, 7) < 0.55;
      if (flat) p.put(lat, ly, fwd, (i & 1) ? L : W, 0.012, (i & 1) ? W : L, greens[i % 3]);
      else p.put(lat, ly - L * 0.3, fwd, (i & 1) ? L * 0.8 : 0.012, L * 0.7, (i & 1) ? 0.012 : L * 0.8, greens[(i + 1) % 3]);
    }
    return p.done(0.6 * s, 0.6 * s, y0 + TH, y + ph);
  };

  // LAMP — base, pole, emissive shade. PURPOSE = light (no yaw: a lamp has no
  // front). opts.h (default 1.55) · opts.ei (glow strength).
  F.lamp = function (x, y, z, opts) {
    opts = opts || {};
    const H = Math.max(0.4, opts.h != null ? +opts.h : 1.55);
    const p = pen("lamp", x, y, z, 0, opts);
    const ei = opts.ei != null ? +opts.ei : 0.6;
    // a weighted disc, a thin stem, and a tapered DRUM shade: fabric that is
    // lit through (a soft glow), open at the bottom where the bulb's light
    // falls out (bright). The old one was a lit 34 cm cube on a post.
    p.put(0, 0, 0, 0.30, 0.025, 0.30, P.chair);                              // base
    p.put(0, 0.025, 0, 0.026, H - 0.30, 0.026, P.chair);                     // stem
    p.put(0, H - 0.306, 0, 0.36, 0.006, 0.36, P.lamp, { emissive: P.lamp, ei: Math.min(1, ei * 1.5) });   // open mouth
    p.put(0, H - 0.30, 0, 0.40, 0.16, 0.40, P.lamp, { emissive: P.lamp, ei: ei * 0.55 });                // drum
    const top = p.put(0, H - 0.14, 0, 0.31, 0.14, 0.31, P.lamp, { emissive: P.lamp, ei: ei * 0.45 });    // taper
    return p.done(0.40, 0.40, H, top);
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
    monitor(p, 0.55, D / 2 - 0.34, 0.74, 0.66);

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
    const so = sub(opts, p), gf = D / 2 + 0.55;
    for (let a = -1; a <= 1; a += 2) {
      const cr = F.chair(p.wx(a * 0.62, gf), y, p.wz(a * 0.62, gf), yaw + Math.PI, so);
      for (let i = 0; i < cr.seats.length; i++) p.seats.push(cr.seats[i]);
    }
    return p.done(L, D + 1.6, 1.30, top);
  };

  CBZ.furnish = F;
})();
