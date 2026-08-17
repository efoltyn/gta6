/* ============================================================
   city/facades/brickhouse.js — "Brick Colonial House": the red-brick
   Georgian / Colonial dwelling.

   WHAT IS BEING MODELLED. A HOUSE, and specifically the most disciplined house
   in the western vocabulary: solid load-bearing brick, laid up symmetrically
   about a centre door, with a medium-pitch side-gabled roof and a chimney at
   each end. Its entire argument is DECORUM — every opening is the same size,
   every opening is the same distance from its neighbour, the door is exactly in
   the middle, and the only ornament is in the brickwork and the white joinery.
   Where the Chicago loft next door (facades/brick.js) shows you its STRUCTURE —
   piers, spandrels, iron storefront, fire escape — this building hides all of
   that and shows you its MANNERS instead. Nothing here is repeated from that
   file: no piers, no segmental arches, no corbel table, no storefront, no
   parapet. Instead:

     SYMMETRY      the entrance face is solved as an ODD number of bays so the
                   door lands dead centre in the middle bay and the windows
                   count out evenly either side of it. Every other face takes
                   whatever count its own span wants. This is the first thing
                   the eye checks on a house and the first thing that gives it
                   away as a house rather than a block.
     WATER TABLE   a projecting brick plinth with a chamfered cap course, so the
                   wall visibly lands on a thicker footing instead of growing
                   out of the pavement.
     SOLDIER       a course of bricks stood on end at every floor line, laid in
     COURSE        the SILL ZONE where the host's wall is solid. It is the only
                   horizontal the brickwork allows itself, and it is what turns
                   a 4-storey elevation into stacked storeys.
     JACK ARCHES   the head of every opening: three courses of gauged brick
                   splaying gently wider as they rise, with a stone keystone at
                   the crown. A per-building hash (or spec.lintel) swaps them
                   for flat white lintels — both were sold in the same period
                   and a street wants both.
     SHUTTERS      a near-black panelled pair FLANKING every window, never over
                   it. They are also the vertical rhythm that stops the host's
                   continuous glass band from reading as a ribbon.
     QUOINS        toothed brick corner returns, alternating long and short
                   courses in gauged and shadowed brick, tying the four
                   elevations into one block.
     DENTIL        a white boxed cornice — frieze, DENTIL row, bed mould, deep
     CORNICE       corona — carried on the eave faces and returned only a short
                   way around the gable ends, which is the detail that says
                   "domestic classical" rather than "commercial cornice".
     SIDE GABLE    a real pitched roof of stepped shingle courses, ridge along
                   the entrance face, eaves overhanging on the long sides and
                   the rake overhanging the ends, with a BRICK GABLE TRIANGLE
                   under a white raking verge at each end. This owns the
                   silhouette: from 200 m it is a house-shaped black shape, and
                   nothing else in the city makes that shape.
     DORMERS       gabled, pushed clearly proud of the slope, on both slopes
                   when the roof is deep enough to hold them. The centre dormer
                   on the entrance slope is widened, so it reads as the crown of
                   the entrance axis.
     CHIMNEYS      two stacks, one at each gable end, corbelled out at the cap
                   and topped with flue pots. A Colonial with one chimney is a
                   cottage; with two it is a proper house.
     DOORWAY       pilasters, sidelights where the centre bay is wide enough, a
                   transom bar and a fanlight, under a crowned cornice on
                   consoles — and a low stone stoop of two risers you can
                   actually walk up.

   THE HOST'S OWN WINDOWS STAY VISIBLE. The shell glazes one continuous band per
   storey (y = k*FH+0.55 … (k+1)*FH-0.45) and this facade never lays a
   face-spanning solid across it. The brick is clad full-face only in the SILL
   and HEADER zones, which are solid wall; inside the glass band it is emitted
   in VERTICAL segments between the openings, so what survives is a row of
   punched Georgian sashes with the host's glass in them. Sills, jack arches,
   keystones, casings, muntin bars and shutters all FRAME that glass. The one
   element that passes over it — the doorway's corona — is held 0.22 m clear of
   the wall as a genuine overhang.

   COLOUR. Warm red brick with a real mortar-shadow read (a proud, much darker
   joint line every few courses, which is the only thing that makes brick read
   as brick at gameplay distance), crisp — but never pure — white trim, pale
   stone sills and keystones, and a near-black roof and shutters. The host
   colour is mixed in only enough to keep the house in its district's street.

   COST. Everything is ctx.dbox (merged, free) except two carriage lamps at the
   door. Every dimension comes from ctx.w / ctx.d / ctx.storeys / ctx.FH /
   ctx.rTop / ctx.pp or a face span, so an 11x9 one-storey cottage, a 14x11
   two-storey house and a 22x16 four-storey mansion are the same drawing
   re-proportioned rather than the same drawing stretched.

   SPEC OPTIONS (all optional; the facade is complete with {style:"brickhouse"})
     lintel  : "brick" | "white"  — force the window head type.
     dormers : false              — suppress the roof dormers.
     shutters: false              — suppress the shutters.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ---- a horizontal run on one face, INTERRUPTED by holes -----------------
  // holes is a list of [t0,t1] tangent intervals the run must not cross. You
  // do not cut a hole in merged axis-aligned boxes — you decline to draw over
  // it. Lifted from stone.js because every brick band in this file needs it.
  function runBand(ctx, F, f, cy, h, proj, col, holes, over, inset) {
    const L = -f.span / 2 - (over == null ? 0.12 : over);
    const R = -L;
    let x = L;
    const hs = (holes || []).slice().sort(function (a, b) { return a[0] - b[0]; });
    for (let i = 0; i < hs.length; i++) {
      const a = Math.max(L, hs[i][0]), b = Math.min(R, hs[i][1]);
      if (b <= x) continue;
      if (a - x > 0.05) F.box(ctx, f, (x + a) / 2, cy, a - x, h, proj, col, inset);
      x = b;
    }
    if (R - x > 0.05) F.box(ctx, f, (x + R) / 2, cy, R - x, h, proj, col, inset);
  }

  CBZ.registerFacade("brickhouse", {
    label: "Brick Colonial House",
    crownsRoof: true,
    // A Georgian grammar survives four storeys (that is a town mansion) and
    // dies instantly on a tower, so it declares a ceiling and no floor.
    maxStoreys: 4,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), H = ctx.rTop;
      const W = ctx.w, D = ctx.d;
      const unit = Math.min(W, D);            // the building's own ruler
      const e = F.entrance(ctx);
      const faces = F.faces(ctx);
      const sp = spec || {};

      // THE HOST'S GLAZING, which this facade exists to frame and must never
      // brick over: one band per storey, k*FH+GSILL … (k+1)*FH-GHDR. These are
      // the TIGHT (modern) values, so designing to them is safe on the wider
      // non-modern band too — the frames simply overlap a little solid wall.
      const GSILL = 0.55, GHDR = 0.45;

      // ============================================================
      //  1. PALETTE
      // ============================================================
      // Warm red brick, deliberately redder and lighter than the loft block's
      // brown-red so the two never read as the same material on one street.
      const base = (ctx.pal && ctx.pal.wall) || ctx.color;
      const BRICK = F.mix(base, 0xa64c2c, 0.86 + ctx.hash(0x8f21) * 0.09);
      const BRICKL = F.shade(BRICK, 1.13);          // gauged/rubbed brick: arches, quoin faces
      const BRICKD = F.shade(BRICK, 0.84);          // shadowed brick: water table, quoin shorts
      // THE MORTAR SHADOW. A joint line is drawn PROUD of the brick and much
      // darker rather than recessed — a recessed box inside the brick plane is
      // simply invisible, and the dark proud line is what actually reads as
      // coursing from the pavement.
      const JOINT = F.shade(BRICK, 0.54);
      // Crisp white, but never mixed hard to 0xffffff: stone.js's first render
      // came back as one flat cream blur for exactly that reason.
      const TRIMW = F.mix(0xf1eee4, base, 0.12);
      const TRIMD = F.shade(TRIMW, 0.85);           // shadowed joinery
      const STONE = F.mix(0xd7d0bc, base, 0.18);    // sills, keystones, stoop
      const ROOFC = F.shade(F.mix(0x2b2d31, base, 0.07), 0.72);   // near-black shingle
      const ROOFL = F.mix(ROOFC, 0xf0f2f5, 0.11);
      const ROOFD = F.shade(ROOFC, 0.74);
      // The shutter tone is the one place a street of these is allowed to vary:
      // four near-blacks with a bare hint of bottle green, oxblood or navy.
      const SHUTS = [0x1b211c, 0x181c22, 0x201a18, 0x14201c];
      const SHUT = F.shade(F.mix(SHUTS[(ctx.hash(0x2f19) * SHUTS.length) | 0], base, 0.05), 0.92);
      const SHUTL = F.shade(SHUT, 1.45);            // the raised panel inside a shutter
      const PANE = F.mix(0x121a22, base, 0.05);     // DORMER sash only — never over host glass

      // ============================================================
      //  2. RELIEF DEPTHS AND THE RULING GRID
      // ============================================================
      // One brick plane, and everything else measured off it, so the whole
      // elevation is a single material with joinery standing on it.
      const BP = Math.max(0.10, (ctx.WT || 0.4) * 0.28);   // the brick wall plane
      const JP = BP + 0.035;                               // mortar joints, proud of the brick
      const TP = BP + 0.10;                                // white joinery
      const SP = BP + 0.17;                                // shutters stand off the wall

      // SIDE-GABLED means the ridge runs PARALLEL to the entrance face, so the
      // gable ends are the two flanks and the roof pitches across the depth.
      const ridgeX = (ctx.doorSide === 0 || ctx.doorSide === 1);
      const LR = ridgeX ? W : D;               // building length ALONG the ridge
      const CR = ridgeX ? D : W;               // the span the roof pitches ACROSS
      const eaveSide = function (s) { return ridgeX ? (s === 0 || s === 1) : (s === 2 || s === 3); };

      const EAVE = clamp(unit * 0.055, 0.35, 0.75);        // eave overhang past the wall
      const RAKE = clamp(EAVE * 0.80, 0.30, 0.62);         // gable-end rake overhang
      // Medium pitch: rise ≈ 0.6 x half-span, i.e. about 7:12. Clamped so a 16 m
      // deep mansion does not grow a 5 m attic and a 9 m cottage still gets a
      // roof you could stand up in.
      const roofH = clamp(CR * 0.30, 1.9, 4.2);
      // THE WALL HEAD. The host builds a grey parapet on the roof slab whatever
      // a facade does with the roof (buildings.js:3903), and on a house that is
      // a concrete kerb sticking up between the cornice and the shingles. One
      // brick block from the top of the glass up to the roof springing buries
      // it and gives the cornice a solid bed. Its height is ctx.pp's problem,
      // not a constant, and it is entirely ABOVE the top storey's window head.
      const corH = clamp((ctx.pp || 1.05) + 0.28, 1.15, 1.6);
      const yEave = H + corH;                              // the roof springs here
      const halfC0 = CR / 2 + EAVE;                        // half-width at the eave line
      const ridgeY = yEave + roofH;
      const nR = clamp(Math.round(roofH / 0.32), 7, 14);   // shingle courses
      function halfC(u) { return halfC0 * (1 - u); }       // u = 0 eave, 1 ridge

      // place a box in ROOF space: `a` along the ridge, `c` across the pitch.
      function rbox(a, c, cy, la, lc, h, col) {
        if (ridgeX) ctx.dbox(a, cy, c, la, h, lc, col);
        else ctx.dbox(c, cy, a, lc, h, la, col);
      }

      // ---- the bay plan for one face ------------------------------------
      // One opening per ~4.4 m on the long (eave) faces and one per ~5.0 m on
      // the gable ends, which is how a real house is fenestrated: the ends are
      // always sparser than the front. The ENTRANCE face is forced ODD so the
      // door owns the middle bay.
      function bayPlan(f) {
        const per = eaveSide(f.s) ? 4.4 : 5.0;
        let n = clamp(Math.round(f.span / per), 2, 7);
        if (f.s === ctx.doorSide && (n % 2) === 0) n = Math.min(7, n + 1);
        const margin = clamp(f.span * 0.085, 0.9, 1.7);    // keeps the end bay off the quoins
        const bays = F.bays(f, n, margin);
        const step = bays.length ? bays[0].w : f.span;
        // THE BAY'S ORNAMENT BUDGET. Opening + casings + a shutter each side
        // must fit inside the bay with real brick left between neighbours; when
        // they do not, the shutters give way, because touching shutters kill the
        // rhythm the whole style is built on.
        const cell = step - clamp(step * 0.11, 0.30, 0.75);
        const wid = Math.min(clamp(cell * 0.42, 0.78, 1.35), (FH - GSILL - GHDR) * 0.64);
        const jw = clamp(wid * 0.13, 0.12, 0.22);
        let shW = clamp(wid * 0.44, 0.26, 0.62);
        if (wid + jw * 2 + shW * 2 > cell) shW = (cell - wid - jw * 2) / 2;
        return { n: n, margin: margin, bays: bays, step: step, wid: wid, jw: jw, shW: shW };
      }
      const plans = {};
      for (let i = 0; i < faces.length; i++) plans[faces[i].s] = bayPlan(faces[i]);

      // ---- THE DOORWAY'S WIDTH, solved before any brick is laid ----------
      // The surround has to fit INSIDE the middle bay or it collides with the
      // shutters of the windows either side of it, and the brick field has to
      // know how wide a hole to leave. So this comes first.
      const ef = e.f;
      const dPlan = plans[ctx.doorSide];
      // DLEAF / DHEAD are the host's PERSON-scaled door leaf (buildings.js:103,
      // DOORW 1.6 x DOORH 2.25). They are the one place a metre constant is
      // right here: a door is sized by the body walking through it, not by the
      // building. Every dimension measured off them is still clamped against a
      // host span.
      const DLEAF = 0.80, DHEAD = 2.25;
      const surHalf = e.driveIn ? (e.gap / 2 + 0.5)
        : Math.max(DLEAF + 0.30,
          Math.min(dPlan.step / 2 - 0.06, e.gap / 2 + clamp(unit * 0.05, 0.35, 0.65)));
      const pilW = clamp(surHalf * 0.26, 0.22, 0.46);
      const pilT = surHalf - pilW / 2;
      // the water table runs closer in than the wall does: it is only knee-high
      // and cannot foul a doorway, so it stops just clear of the door leaf
      // rather than clear of the whole ornament-free gap.
      const baseHalf = e.driveIn ? (e.gap / 2 + 0.3) : e.gap * 0.30;
      const wallHole = [[-surHalf, surHalf]];
      const baseHole = [[-baseHalf, baseHalf]];
      function holesAt(f, k) {
        if (f.s !== ctx.doorSide || k !== 0) return [];
        return wallHole;
      }

      // ============================================================
      //  3. THE BRICK WALL — clad the solid zones, punch the glass band
      // ============================================================
      // SOLID ZONES FIRST, full face: the sill zone under each glass band and
      // the header zone over it are solid host wall, so brick may cross them
      // edge to edge. This is what stops any of the host's own wall colour from
      // showing through as a stripe between the dressed parts.
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        for (let k = 0; k < ST; k++) {
          runBand(ctx, F, f, k * FH + GSILL / 2, GSILL, BP, BRICK,
            (f.s === ctx.doorSide && k === 0) ? baseHole : [], 0.13);
          runBand(ctx, F, f, (k + 1) * FH - GHDR / 2, GHDR, BP, BRICK, [], 0.13);
        }
      }

      // THE GLASS BAND: brick in VERTICAL segments between the openings only.
      // Crossing the host's continuous ribbon with brick between the windows is
      // precisely what turns it back into a row of punched sashes.
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const p = plans[f.s];
        for (let k = 0; k < ST; k++) {
          const y0 = k * FH + GSILL, y1 = (k + 1) * FH - GHDR;
          const holes = holesAt(f, k).slice();
          for (let b = 0; b < p.bays.length; b++) {
            const t = p.bays[b].t;
            if (f.s === ctx.doorSide && k === 0 && Math.abs(t) < surHalf + p.wid) continue;
            holes.push([t - p.wid / 2, t + p.wid / 2]);
          }
          runBand(ctx, F, f, (y0 + y1) / 2, y1 - y0, BP, BRICK, holes, 0.13);
          // THE MORTAR SHADOW, in the same segments: two proud dark joint lines
          // per band, at the rhythm of a header course every few courses. They
          // never touch the glass because they carry the same holes the brick
          // does.
          for (let m = 1; m <= 2; m++) {
            runBand(ctx, F, f, y0 + (y1 - y0) * m / 3, 0.055, JP, JOINT, holes, 0.13);
          }
        }
      }

      // ============================================================
      //  4. THE WATER TABLE — the wall lands on something thicker
      // ============================================================
      // Two courses inside the ground storey's sill zone: a projecting plinth
      // and a chamfered cap. Top stays under GSILL so it cannot touch glass.
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const hs = (f.s === ctx.doorSide) ? baseHole : [];
        runBand(ctx, F, f, GSILL * 0.36, GSILL * 0.72, BP + 0.15, BRICKD, hs, 0.22);
        runBand(ctx, F, f, GSILL * 0.80, GSILL * 0.20, BP + 0.21, BRICKL, hs, 0.26);
        runBand(ctx, F, f, GSILL * 0.72, 0.05, BP + 0.24, JOINT, hs, 0.26);
      }

      // ============================================================
      //  5. THE SOLDIER COURSE at every floor line
      // ============================================================
      // Bricks stood on end, laid in the SILL ZONE (k*FH … k*FH+0.55) where the
      // wall is solid — the one horizontal a brick house allows itself, and the
      // thing that makes four storeys read as four storeys.
      for (let k = 1; k < ST; k++) {
        const y = k * FH;
        F.ring(ctx, y + 0.04, 0.06, JP, JOINT, 0.28);
        F.ring(ctx, y + 0.23, 0.30, BP + 0.07, BRICKL, 0.30);
        F.ring(ctx, y + 0.40, 0.05, JP + 0.04, JOINT, 0.28);
        // the ends of the stood-up bricks, so the course reads as soldiers and
        // not as a painted stripe. Count from the span, capped so a 22 m
        // elevation does not mint two hundred slivers.
        for (let fi = 0; fi < faces.length; fi++) {
          const f = faces[fi];
          const nt = Math.min(40, Math.max(6, Math.round(f.span / 0.34)));
          const stp = (f.span + 0.2) / nt;
          for (let i = 0; i <= nt; i++) {
            F.box(ctx, f, -(f.span + 0.2) / 2 + i * stp, y + 0.23, 0.05, 0.26, BP + 0.10, JOINT);
          }
        }
      }

      // ============================================================
      //  6. QUOINS — toothed brick corner returns
      // ============================================================
      // Alternating long and short courses in gauged and shadowed brick, from
      // the water table to the wall head, present on both faces of every
      // corner so the arris reads solid. This is what ties four elevations
      // into one block, and it lands on the host's 0.55 m solid end jamb.
      {
        const qh = clamp(FH / 6, 0.45, 0.58);
        const qN = Math.max(2, Math.floor((H - 0.06 - GSILL) / qh));
        for (let i = 0; i < qN; i++) {
          const cy = GSILL + (i + 0.5) * qh;
          const long = (i % 2) === 0;
          F.corners(ctx, cy, qh * 0.90, long ? qh * 1.60 : qh * 0.95, BP + 0.08,
            long ? BRICKL : BRICKD);
          // the bed joint under every LONG course only — eight boxes a course is
          // enough on a 4-storey corner without minting it twice over.
          if (long) F.corners(ctx, cy - qh * 0.47, 0.05, qh * 1.60, BP + 0.12, JOINT);
        }
      }

      // ============================================================
      //  7. THE WINDOWS — Georgian sashes that FRAME the host's glass
      // ============================================================
      // Nothing is drawn over the opening except hairline muntin bars. The
      // sill lives in the sill zone, the head lives in the header zone, and
      // both are solved so they cannot spill into the glass band.
      const jackBrick = sp.lintel ? (sp.lintel === "brick")
        : (ctx.hash(0x6c31) < 0.55);
      const wantShut = sp.shutters !== false;

      function window1(f, t, p, y0, y1, withSill) {
        const wid = p.wid, jw = p.jw;
        // 1. white casing boards each side — vertical, so free to cross glass
        for (const sg of [-1, 1]) {
          F.rib(ctx, f, t + sg * (wid / 2 + jw / 2), y0 - 0.05, y1 + 0.05, jw, TP, TRIMW);
        }
        // 2. the sash bars. A 6-over-6 read at hairline widths: one vertical
        //    muntin, the meeting rail where the two sashes overlap, and one bar
        //    per sash. The host's glass shows between them, which is the point.
        F.rib(ctx, f, t, y0 + 0.04, y1 - 0.04, jw * 0.32, TP - 0.03, TRIMW);
        F.box(ctx, f, t, y0 + (y1 - y0) * 0.52, wid, 0.10, TP - 0.02, TRIMW);
        for (const u of [0.26, 0.78]) {
          F.box(ctx, f, t, y0 + (y1 - y0) * u, wid, 0.05, TP - 0.05, TRIMW);
        }
        // 3. the stone sill and its drip, both inside the sill zone
        if (withSill) {
          F.box(ctx, f, t, y0 - 0.11, wid + jw * 3.4, 0.15, TP + 0.11, STONE);
          F.box(ctx, f, t, y0 - 0.23, wid + jw * 2.2, 0.08, TP + 0.03, TRIMD);
        }
        // 4. THE HEAD, inside the header zone. Either a splayed brick jack arch
        //    — three gauged courses each a little wider than the one below, the
        //    flat arch a bricklayer actually builds — or a flat white lintel.
        //    Both take a stone keystone, and both are sized off the header zone
        //    so the topmost storey's head still clears the cornice.
        const hd = clamp((y1 - y0) * 0.085, 0.15, 0.24);
        if (jackBrick) {
          for (let i = 0; i < 3; i++) {
            F.box(ctx, f, t, y1 + hd * (0.28 + i * 0.40), wid + jw * 2 + i * 0.16,
              hd * 0.42, TP + 0.02, i === 1 ? BRICKL : F.shade(BRICKL, 0.93));
          }
          F.box(ctx, f, t, y1 + hd * 0.10, wid + jw * 2 + 0.34, 0.05, TP + 0.05, JOINT);
        } else {
          F.box(ctx, f, t, y1 + hd * 0.45, wid + jw * 4.2, hd * 0.80, TP + 0.06, TRIMW);
          F.box(ctx, f, t, y1 + hd * 1.00, wid + jw * 5.2, hd * 0.34, TP + 0.12, TRIMW);
        }
        F.box(ctx, f, t, y1 + hd * 0.80, clamp(wid * 0.20, 0.20, 0.36), hd * 1.65,
          TP + 0.14, STONE);
        // 5. SHUTTERS, flanking. A pair beside the glass is the style; a panel
        //    over the glass would be a bug.
        if (!wantShut || p.shW < 0.18) return;
        for (const sg of [-1, 1]) {
          const st = t + sg * (wid / 2 + jw + p.shW / 2);
          F.rib(ctx, f, st, y0 - 0.04, y1 + 0.04, p.shW, SP, SHUT);
          F.box(ctx, f, st, y0 + (y1 - y0) * 0.52, p.shW + 0.03, 0.09, SP + 0.05, SHUTL);
          for (const u of [0.27, 0.78]) {
            F.box(ctx, f, st, y0 + (y1 - y0) * u, p.shW * 0.60, (y1 - y0) * 0.34,
              SP + 0.03, SHUTL);
          }
        }
      }

      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const p = plans[f.s];
        for (let k = 0; k < ST; k++) {
          const y0 = k * FH + GSILL, y1 = (k + 1) * FH - GHDR;
          for (let b = 0; b < p.bays.length; b++) {
            const t = p.bays[b].t;
            // the middle bay of the ground storey is the DOOR, not a window
            if (f.s === ctx.doorSide && k === 0 && Math.abs(t) < surHalf + p.wid) continue;
            // and on the middle bay of the storey directly over the door the
            // doorway's own cornice serves as the sill, exactly as it does on a
            // real Georgian front where the two lines meet.
            const overDoor = (f.s === ctx.doorSide && k === 1 && Math.abs(t) < 0.05 && ST >= 2);
            window1(f, t, p, y0, y1, !overDoor);
          }
        }
      }

      // ============================================================
      //  8. THE WALL HEAD AND THE DENTIL CORNICE
      // ============================================================
      // The block that buries the host's parapet, in brick, with a joint line
      // so it reads as four more courses rather than as a lid. Slightly proud
      // of the brick plane, which also hides the host's coping overhang.
      ctx.dbox(0, H + corH / 2, 0, W + 0.30, corH, D + 0.30, BRICK);
      F.ring(ctx, H + corH * 0.42, 0.05, 0.19, JOINT, 0.32);

      // The cornice sits ENTIRELY above H. That ordering is load-bearing: put
      // the frieze in the top storey's header zone instead and there is no room
      // left for that storey's window heads, which is exactly how a Colonial
      // ends up looking decapitated.
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const isEave = eaveSide(f.s);
        // On the gable ends the cornice only RETURNS a short way around the
        // corner — the raking verge takes over from there. That return is the
        // single most reliable tell of a domestic classical gable.
        const retL = clamp(unit * 0.13, 0.8, 1.8);
        // the return may not fly further than the rake it dies into, or the
        // gable end grows a shelf the roof does not cover.
        const fly = (isEave ? EAVE : RAKE) + 0.14;
        const runs = isEave ? [{ t: 0, len: f.span + RAKE * 2 }]
          : [{ t: -(f.span / 2 - retL / 2), len: retL }, { t: (f.span / 2 - retL / 2), len: retL }];
        for (let r = 0; r < runs.length; r++) {
          const rr = runs[r];
          F.box(ctx, f, rr.t, H + corH * 0.22, rr.len, corH * 0.44, 0.19, TRIMW);   // frieze board
          F.box(ctx, f, rr.t, H + corH * 0.60, rr.len, corH * 0.10, fly * 0.42, TRIMW); // bed mould
          F.box(ctx, f, rr.t, H + corH * 0.78, rr.len, corH * 0.24, fly, TRIMW);        // corona
          F.box(ctx, f, rr.t, H + corH * 0.94, rr.len - 0.10, corH * 0.10, fly * 0.72, TRIMD);
          // DENTILS: a tight run of little blocks under the bed mould. Count
          // from the run's own length so the teeth stay the same size on an
          // 11 m cottage and a 22 m mansion.
          const dn = Math.max(3, Math.min(56, Math.round(rr.len / 0.42)));
          const dstep = rr.len / dn;
          for (let i = 0; i < dn; i++) {
            F.box(ctx, f, rr.t - rr.len / 2 + (i + 0.5) * dstep, H + corH * 0.48,
              dstep * 0.46, corH * 0.16, fly * 0.34, TRIMW);
          }
        }
      }

      // ============================================================
      //  9. THE SIDE-GABLED ROOF
      // ============================================================
      // Stepped courses, nothing rotated: the step size IS the pitch. The prism
      // runs wall-to-wall along the ridge so the two gable ends can be faced in
      // brick, and it is solid, so the host's roof furniture is buried instead
      // of poking through the shingles.
      // Each course is sized at its own MID height, so the staircase straddles
      // the true slope line instead of hanging entirely inside it — that is
      // what keeps the bottom course out at the eave and still leaves a ridge
      // narrow enough for the cap to cover.
      const ledge = halfC0 / nR;                           // the step each course takes in
      for (let i = 0; i < nR; i++) {
        const u0 = i / nR, u1 = (i + 1) / nR;
        const th = roofH / nR;
        const hm = halfC((u0 + u1) / 2);
        const cy = yEave + roofH * (u0 + u1) / 2;
        const col = (i % 3 === 0) ? ROOFC : ((i % 3 === 1) ? ROOFL : ROOFD);
        rbox(0, 0, cy, LR, hm * 2, th + 0.02, col);
        // a thin dark lip laid along the ledge each course leaves. This is the
        // whole reason a stack of boxes reads as lapped shingle courses and not
        // as a smooth ramp.
        for (const sg of [-1, 1]) {
          rbox(0, sg * (hm - ledge / 2), yEave + roofH * u1 + 0.035, LR + 0.02, ledge, 0.07, ROOFD);
        }
      }
      // the ridge cap
      {
        const rc = clamp(unit * 0.03, 0.16, 0.34);
        rbox(0, 0, ridgeY - rc * 0.30, LR + 0.06, rc * 2.6, rc * 1.10, ROOFD);
        rbox(0, 0, ridgeY + rc * 0.34, LR - 0.14, rc * 1.7, rc * 0.66, ROOFC);
      }
      // THE BRICK GABLE TRIANGLE, veneered on the prism's two ends, and the
      // white RAKING VERGE board outboard of it — which is the rake overhang.
      {
        const gv = 0.11;                                   // veneer thickness
        const rw = Math.max(0.14, RAKE - gv);              // so the board's outer
        const ra = LR / 2 + gv + rw / 2;                   // face lands exactly on RAKE
        for (let i = 0; i < nR; i++) {
          const u0 = i / nR, u1 = (i + 1) / nR;
          const th = roofH / nR;
          const hm = halfC((u0 + u1) / 2);
          const cy = yEave + roofH * (u0 + u1) / 2;
          if (hm > 0.10) {
            const col = (i % 2) ? BRICK : F.shade(BRICK, 0.94);
            for (const sa of [-1, 1]) rbox(sa * (LR / 2 + gv / 2), 0, cy, gv, hm * 2, th + 0.02, col);
            for (const sa of [-1, 1]) {
              rbox(sa * (LR / 2 + gv * 0.86), 0, yEave + roofH * u0 + 0.04, gv * 0.6,
                hm * 2 - 0.06, 0.05, JOINT);
            }
          }
          for (const sa of [-1, 1]) for (const sg of [-1, 1]) {
            rbox(sa * ra, sg * (hm - ledge / 2), cy, rw, ledge + th * 0.70, th + 0.02, TRIMW);
          }
        }
      }

      // ============================================================
      //  10. DORMERS — pushed clearly proud of the slope
      // ============================================================
      // The front plane is computed from the slope's cross-width at the dormer's
      // FOOT (its widest point over the dormer's height) and then pushed out, so
      // a dormer can never sink back into the roof it stands on.
      const dormOK = (sp.dormers !== false) && roofH >= 2.25 && LR >= 9.0;
      if (dormOK) {
        const dh = clamp(roofH * 0.50, 1.05, 1.80);
        const u0 = 0.16, u1 = Math.min(0.90, u0 + dh / roofH);
        const push = clamp(unit * 0.048, 0.30, 0.58);
        // measured off the slope's widest point over the dormer's own height,
        // plus half a course for the staircase's overshoot, plus the push
        const cOut = halfC(u0) + ledge / 2 + push;
        const dep = Math.max(0.40, cOut - halfC(u1) + 0.35);
        const efp = plans[ctx.doorSide];
        let nD = Math.min(5, efp.n);
        const dBays = F.bays(ef, nD, efp.margin);
        const dwBase = clamp(efp.step * 0.42, 0.80, 1.65);
        for (const sg of [-1, 1]) {
          for (let i = 0; i < dBays.length; i++) {
            // the centre dormer on the entrance slope is widened, so the
            // entrance axis is announced at the roofline too.
            const mid = (sg === ef.out) && Math.abs(dBays[i].t) < 0.05;
            const dw = dwBase * (mid ? 1.22 : 1.0);
            const jw = clamp(dw * 0.16, 0.12, 0.28);
            const y0 = yEave + roofH * u0;
            const put = function (aa, cy, la, h, ct, cOff, col) {
              rbox(aa, sg * (cOut + (cOff || 0) - ct / 2), cy, la, ct, h, col);
            };
            put(dBays[i].t, y0 + dh / 2, dw + jw * 2, dh, dep, 0, TRIMW);           // cheeks + body
            put(dBays[i].t, y0 + dh * 0.52, dw * 0.88, dh * 0.60, dep * 0.20, 0.05, PANE);
            put(dBays[i].t, y0 + dh * 0.52, 0.06, dh * 0.60, dep * 0.26, 0.09, TRIMW);
            put(dBays[i].t, y0 + dh * 0.52, dw * 0.88, 0.06, dep * 0.26, 0.09, TRIMW);
            for (const sg2 of [-1, 1]) {
              put(dBays[i].t + sg2 * (dw / 2 + jw * 0.4), y0 + dh * 0.52, jw * 0.85,
                dh * 0.68, dep * 0.34, 0.08, TRIMW);
            }
            put(dBays[i].t, y0 + dh * 0.14, dw + jw * 3.0, 0.14, dep * 0.42, 0.15, TRIMW);  // sill
            // the gabled hood: three diminishing courses to a peak, white rake
            const hy = y0 + dh * 0.86;
            put(dBays[i].t, hy, dw + jw * 3.6, 0.16, dep * 0.46, 0.17, TRIMW);
            for (let k = 0; k < 3; k++) {
              const u = (k + 1) / 3;
              put(dBays[i].t, hy + 0.15 + k * 0.18, (dw + jw * 3.0) * (1 - u * 0.60), 0.19,
                dep * (0.42 - k * 0.08), 0.15 - k * 0.02, k === 1 ? ROOFD : ROOFC);
            }
          }
        }
      }

      // ============================================================
      //  11. THE TWO CHIMNEY STACKS
      // ============================================================
      // One at each gable end, rising out of the ridge, corbelled out at the
      // cap and finished with flue pots. They start inside the top storey's
      // HEADER zone, so the stack never crosses a pane of the host's glass.
      {
        const chA = clamp(unit * 0.115, 0.85, 1.70);      // along the ridge
        const chC = clamp(unit * 0.145, 1.00, 2.10);      // across the pitch
        const chTop = ridgeY + clamp(roofH * 0.42, 0.85, 1.70);
        const y0 = H - GHDR * 0.85;
        for (const sa of [-1, 1]) {
          const a = sa * (LR / 2 - chA * 0.30);           // half outside the gable wall
          rbox(a, 0, (y0 + chTop) / 2, chA, chC, chTop - y0, BRICK);
          const nC = Math.max(3, Math.round((chTop - yEave) / 0.55));
          for (let i = 1; i < nC; i++) {
            rbox(a, 0, yEave + (chTop - yEave) * i / nC, chA + 0.04, chC + 0.04, 0.05, JOINT);
          }
          rbox(a, 0, chTop + 0.11, chA + 0.17, chC + 0.17, 0.22, BRICKL);   // corbelled cap
          rbox(a, 0, chTop + 0.30, chA + 0.32, chC + 0.32, 0.15, STONE);    // the wash
          for (const sc of [-1, 1]) {
            rbox(a, sc * chC * 0.25, chTop + 0.58, chA * 0.34, chC * 0.30, 0.44,
              F.shade(STONE, 0.80));                                        // flue pots
          }
        }
      }

      // ============================================================
      //  12. THE DOORWAY — pilasters, fanlight, crowned cornice
      // ============================================================
      // Everything that sits at the wall plane above the door is SURFACE TRIM
      // (proj <= 0.14, the same depth the host's own door casing uses at
      // buildings.js:3155) and clears the 2.25 m opening. Everything with real
      // projection either flanks the doorway outside e.gap or sits at/above
      // e.head — and the one member that passes over the storey above's glass,
      // the corona, is held 0.22 m clear of the wall as an overhang.
      if (!e.driveIn) {
        const entCrown = ST >= 2;
        const yEnt = e.head + 0.04;                       // the entablature bed
        const pilTop = entCrown ? yEnt : (H - 0.06);
        // 1. the pilasters, plinth to capital
        for (const sg of [-1, 1]) {
          const t = sg * pilT;
          F.rib(ctx, ef, t, 0.06, pilTop - 0.20, pilW, TP + 0.06, TRIMW);
          F.box(ctx, ef, t, 0.30, pilW + 0.10, 0.48, TP + 0.11, TRIMW);              // plinth
          F.box(ctx, ef, t, pilTop - 0.13, pilW + 0.13, 0.16, TP + 0.13, TRIMW);     // capital
          // two shallow flutes, drawn as dark slivers — free, and it is what
          // stops a pilaster from reading as a plain board.
          for (const u of [-0.24, 0.24]) {
            F.rib(ctx, ef, t + u * pilW, 0.60, pilTop - 0.34, pilW * 0.16, TP + 0.02, TRIMD);
          }
        }
        // 2. the door casing, and the sidelights when the bay is wide enough.
        //    The casing is clamped against the surround, so a narrow middle bay
        //    squeezes it rather than bursting through the pilasters.
        const casT = Math.min(DLEAF + 0.06, pilT - pilW / 2 - 0.08);
        for (const sg of [-1, 1]) {
          F.rib(ctx, ef, sg * casT, 0.06, DHEAD + 0.21, 0.16, 0.13, TRIMW);
        }
        const slW = pilT - pilW / 2 - (casT + 0.08);
        if (slW > 0.22) {
          const sc = casT + 0.08 + slW / 2;
          for (const sg of [-1, 1]) {
            F.box(ctx, ef, sg * sc, 1.16, slW * 0.94, 0.09, 0.12, TRIMW);        // sidelight rail
            F.rib(ctx, ef, sg * sc, 0.06, 0.62, slW * 0.94, 0.13, TRIMW);        // panelled base
            F.rib(ctx, ef, sg * sc, 0.62, DHEAD + 0.17, 0.06, 0.12, TRIMW);      // its muntin
          }
        }
        // 3. the transom bar and the FANLIGHT, both clear above the door head
        F.box(ctx, ef, 0, DHEAD + 0.25, surHalf * 2 - 0.06, 0.15, 0.14, TRIMW);
        const fanY = DHEAD + 0.35;
        const fanW = Math.min(surHalf * 1.75, surHalf * 2 - 0.20);
        const fanRise = Math.min(surHalf * 0.62, 0.56);
        if (fanW > 1.0 && fanRise > 0.22) {
          F.arch(ctx, ef, 0, fanY, fanW, fanRise, 0.10, 0.13, TRIMW, "round");
          // radiating bars, drawn as verticals of arch-height — a fan at any
          // distance a player will ever stand.
          for (let i = 0; i < 5; i++) {
            const u = ((i + 0.5) / 5) * 2 - 1;
            const hh = Math.sqrt(Math.max(0, 1 - u * u)) * fanRise;
            if (hh < 0.12) continue;
            F.box(ctx, ef, u * fanW * 0.42, fanY + hh / 2, 0.06, hh, 0.12, TRIMW);
          }
        }
        // 4. THE CROWNED CORNICE on consoles. Architrave and dentils stay under
        //    the storey above's sill line; only the corona and its crown mould
        //    pass over glass, and both are held clear of the wall.
        if (entCrown) {
          const cw = surHalf * 2 + 0.60;
          // The sill line of the storey above. Everything the crown lays ON the
          // wall stops under it; everything above it is held clear as a real
          // overhang, so the centre window's glass survives behind the cornice
          // instead of being bricked over by it.
          const yUp = FH + GSILL;
          for (const sg of [-1, 1]) {                                       // consoles
            F.box(ctx, ef, sg * (pilT - pilW * 0.1), yEnt - 0.26, pilW * 0.7, 0.50, TP + 0.20, TRIMW);
          }
          F.box(ctx, ef, 0, (yEnt + yUp) / 2, cw, Math.max(0.10, yUp - yEnt),
            TP + 0.16, TRIMW);                                              // architrave
          const dn = Math.max(5, Math.min(24, Math.round(cw / 0.36)));
          for (let i = 0; i < dn; i++) {
            F.box(ctx, ef, -cw / 2 + (i + 0.5) * (cw / dn), yUp + 0.09,
              (cw / dn) * 0.44, 0.14, 0.16, TRIMW, 0.18);                   // dentils, held clear
          }
          F.box(ctx, ef, 0, yUp + 0.26, cw + 0.22, 0.18, 0.34, TRIMW, 0.22);   // corona, held clear
          F.box(ctx, ef, 0, yUp + 0.40, cw + 0.06, 0.10, 0.26, TRIMD, 0.26);   // crown mould
        }
        // 5. two carriage lamps — the only real meshes this facade mints.
        //    Parked between the surround and the shutter of the window next
        //    door, so a narrow middle bay simply goes without rather than
        //    hanging a lantern through a shutter.
        const winIn = dPlan.step - (dPlan.wid / 2 + dPlan.jw + dPlan.shW);
        const lt = Math.min(surHalf + 0.42, winIn - 0.22);
        if (ef.span > 6 && lt > surHalf + 0.10) {
          const nrm = ef.halfN + TP + 0.12;
          for (const sg of [-1, 1]) {
            F.box(ctx, ef, sg * lt, 2.34, 0.14, 0.42, TP + 0.16, TRIMD);
            const lx = ef.horiz ? sg * lt : ef.out * nrm;
            const lz = ef.horiz ? ef.out * nrm : sg * lt;
            ctx.lamp(lx, 2.10, lz, clamp(unit * 0.016, 0.12, 0.20), 0xffd9a0);
          }
        }

        // ============================================================
        //  13. THE STOOP — two risers, both walkable
        // ============================================================
        // A landing and one tread, TOP well under physics STEP_UP (0.45), so a
        // player walks up and straight in. Registered with ctx.plat as one
        // continuous platform plus one ramp — never a row of tread boxes, or a
        // sprinting rider samples the seam between them.
        const TOP = clamp(FH * 0.11, 0.24, 0.38);
        const landD = clamp((ef.horiz ? ctx.d : ctx.w) * 0.09, 0.95, 1.70);
        const stepD = landD * 0.62;
        const landW = Math.min(ef.span - 1.2, surHalf * 2 + clamp(unit * 0.16, 0.8, 1.9));
        const sw = Math.max(1.2, landW - 0.7);
        const hn = ef.halfN;
        if (ef.horiz) {
          ctx.dbox(0, TOP / 2, ef.out * (hn + landD / 2), landW, TOP, landD, STONE);
          ctx.plat(-landW / 2, landW / 2, ef.out > 0 ? hn : -(hn + landD),
            ef.out > 0 ? hn + landD : -hn, TOP, null);
        } else {
          ctx.dbox(ef.out * (hn + landD / 2), TOP / 2, 0, landD, TOP, landW, STONE);
          ctx.plat(ef.out > 0 ? hn : -(hn + landD), ef.out > 0 ? hn + landD : -hn,
            -landW / 2, landW / 2, TOP, null);
        }
        const th = TOP * 0.5;
        if (ef.horiz) {
          ctx.dbox(0, th / 2, ef.out * (hn + landD + stepD / 2), sw, th, stepD, F.shade(STONE, 0.93));
          const z0 = ef.out * (hn + landD), z1 = ef.out * (hn + landD + stepD);
          ctx.plat(-sw / 2, sw / 2, Math.min(z0, z1), Math.max(z0, z1), TOP,
            { z0: ctx.oz + z1, z1: ctx.oz + z0, y0: 0, y1: TOP });
        } else {
          ctx.dbox(ef.out * (hn + landD + stepD / 2), th / 2, 0, stepD, th, sw, F.shade(STONE, 0.93));
          const x0 = ef.out * (hn + landD), x1 = ef.out * (hn + landD + stepD);
          ctx.plat(Math.min(x0, x1), Math.max(x0, x1), -sw / 2, sw / 2, TOP,
            { axis: "x", x0: ctx.ox + x1, x1: ctx.ox + x0, y0: 0, y1: TOP });
        }
        // low brick cheeks with a stone cap: the flight needs sides or it reads
        // as a puddle of slabs at the bottom of the wall.
        const chD = landD + stepD;
        for (const sg of [-1, 1]) {
          const t = sg * (sw / 2 + 0.28);
          const chH = TOP + 0.20;
          if (ef.horiz) {
            ctx.dbox(t, chH / 2, ef.out * (hn + chD / 2), 0.48, chH, chD, BRICKD);
            ctx.dbox(t, chH + 0.06, ef.out * (hn + chD / 2), 0.62, 0.12, chD + 0.12, STONE);
          } else {
            ctx.dbox(ef.out * (hn + chD / 2), chH / 2, t, chD, chH, 0.48, BRICKD);
            ctx.dbox(ef.out * (hn + chD / 2), chH + 0.06, t, chD + 0.12, 0.12, 0.62, STONE);
          }
        }
      } else {
        // A drive-in ground floor is not a Colonial doorway. Two white jambs and
        // nothing else: a head band over an opening this wide would have to
        // either hang under e.head or lie straight across the storey above's
        // glass, and neither is allowed. Verticals always are.
        for (const sg of [-1, 1]) {
          F.rib(ctx, ef, sg * (e.gap / 2 + 0.22), 0.06, e.head, 0.34, TP + 0.06, TRIMW);
          F.box(ctx, ef, sg * (e.gap / 2 + 0.22), e.head - 0.12, 0.52, 0.20, TP + 0.13, TRIMW);
        }
      }
    },
  });
})();
